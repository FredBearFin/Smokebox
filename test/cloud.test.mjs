// Tests for the hosted server (server/cloud.mjs): sign-up and sign-in, sessions that keep a device signed in, the lockout after wrong
// passwords, kitchens kept apart by account, actions stored before "ok" and replayed after a restart, repeated action ids, the live
// stream, and the guards against other sites and strangers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCloud } from '../server/cloud.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cloud-'));
const html = path.join(tmp, 'app.html');
fs.writeFileSync(html, '<!doctype html><html><head><title>t</title></head><body>app</body></html>');
let n = 0;
// Starts a server on a fresh (or given) database and returns { cloud, base, dbFile }.
async function start(opts = {}) {
  const dbFile = opts.dbFile || path.join(tmp, 'db' + (++n) + '.sqlite');
  const cloud = await createCloud(Object.assign({ dbFile, htmlFile: html, tickMs: 50, heartbeatMs: 60000, signupCode: '' }, opts));
  const port = await cloud.listen(0);
  return { cloud, base: 'http://127.0.0.1:' + port, dbFile };
}
// Sends a JSON POST like the app does and returns { status, body, cookie }.
async function post(base, p, body, cookie, headers) {
  const r = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}, headers || {}), body: JSON.stringify(body) });
  const set = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json().catch(() => null), cookie: set ? set.split(';')[0] : null, setCookie: set };
}
// Signs up a new kitchen and returns its session cookie.
async function signup(base, email, kitchen) {
  const r = await post(base, '/api/signup', { email, password: 'grill2026smoke', kitchen });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.cookie;
}
// Reads the first server-sent event from the live stream.
function firstEvent(base, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + '/api/events');
    const req = http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { cookie } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; const i = buf.indexOf('\n\n'); if (i >= 0) { const ev = /^event: (.*)$/m.exec(buf.slice(0, i))[1], data = JSON.parse(/^data: (.*)$/m.exec(buf.slice(0, i))[1]); req.destroy(); resolve({ ev, data }); } });
    });
    req.on('error', reject);
  });
}
// A one-dish menu action for a kitchen.
const dish = { name: 'Freaky Frank', zone: 'pit', cat: 'meat', price: 11, prepSec: 300, track: 'one', prepGuess: false };

test('sign-up makes an account and a kitchen, signs the device in for a year, and the app page knows its kitchen', async () => {
  const { cloud, base } = await start();
  try {
    const r = await post(base, '/api/signup', { email: 'Freddy@Example.com', password: 'grill2026smoke', kitchen: "Freddy's  Franks" });
    assert.equal(r.status, 200);
    assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Lax/); assert.match(r.setCookie, /Max-Age=31536000/);
    const me = await (await fetch(base + '/api/me', { headers: { cookie: r.cookie } })).json();
    assert.deepEqual([me.email, me.kitchen.name], ['freddy@example.com', "Freddy's Franks"]);
    const page = await (await fetch(base + '/', { headers: { cookie: r.cookie } })).text();
    assert.match(page, /window\.SB_CLOUD=\{"kitchen":\{"id":"k_[0-9a-f]+","name":"Freddy's Franks"\}/);
    // the same email cannot sign up twice; bad input is refused in plain words
    assert.equal((await post(base, '/api/signup', { email: 'freddy@example.com', password: 'another-pass', kitchen: 'X' })).status, 409);
    assert.equal((await post(base, '/api/signup', { email: 'nope', password: 'grill2026smoke', kitchen: 'X' })).body.report, 'badEmail');
    assert.equal((await post(base, '/api/signup', { email: 'a@b.co', password: 'short', kitchen: 'X' })).body.report, 'badPassword');
    assert.equal((await post(base, '/api/signup', { email: 'a@b.co', password: 'longenough', kitchen: '' })).body.report, 'badName');
    // the password is never stored as typed
    const row = cloud.db.prepare('SELECT pass FROM accounts').get();
    assert.match(row.pass, /^scrypt\$16384\$8\$1\$/); assert.ok(!row.pass.includes('grill2026smoke'));
  } finally { await cloud.close(); }
});

test('signed out: the page goes to sign-in and the API says so; a wrong password is refused, ten wrong tries lock it', async () => {
  const { cloud, base } = await start();
  try {
    const r = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/login');
    assert.match(await (await fetch(base + '/login')).text(), /Sign in to Smokebox/);
    assert.equal((await fetch(base + '/api/me')).status, 401);
    await signup(base, 'owner@example.com', 'Truck');
    assert.equal((await post(base, '/api/login', { email: 'owner@example.com', password: 'wrong-password' })).status, 401);
    const good = await post(base, '/api/login', { email: 'OWNER@example.com', password: 'grill2026smoke' });
    assert.equal(good.status, 200); assert.ok(good.cookie);
    for (let i = 0; i < 10; i++) await post(base, '/api/login', { email: 'owner@example.com', password: 'wrong-' + i });
    const locked = await post(base, '/api/login', { email: 'owner@example.com', password: 'grill2026smoke' });
    assert.equal(locked.status, 429, 'even the right password waits out the lock');
    // signing out ends that device's session only
    assert.equal((await post(base, '/api/logout', {}, good.cookie)).status, 200);
    assert.equal((await fetch(base + '/api/me', { headers: { cookie: good.cookie } })).status, 401);
  } finally { await cloud.close(); }
});

test('two devices of one kitchen share it; another account never sees it', async () => {
  const { cloud, base } = await start();
  try {
    const a1 = await signup(base, 'a@example.com', 'Kitchen A');
    const a2 = (await post(base, '/api/login', { email: 'a@example.com', password: 'grill2026smoke' })).cookie;   // a second device
    const b1 = await signup(base, 'b@example.com', 'Kitchen B');
    assert.equal((await post(base, '/api/action', { type: 'addMenuItem', payload: dish, opId: 'op-1' }, a1)).body.report, 'ok');
    const seenA2 = await firstEvent(base, a2);
    assert.equal(seenA2.ev, 'snapshot');
    assert.deepEqual(seenA2.data.state.menu.map((m) => m.name), ['Freaky Frank']);
    assert.ok(seenA2.data.opIds.includes('op-1'));
    const seenB = await firstEvent(base, b1);
    assert.deepEqual(seenB.data.state.menu, [], 'kitchen B is its own kitchen');
  } finally { await cloud.close(); }
});

test('an action is stored before ok: a restart replays it exactly, a repeated action id gets the first answer and is not applied twice', async () => {
  const { cloud, base, dbFile } = await start({ snapshotEvery: 3 });
  let c = await signup(base, 'r@example.com', 'Restart');
  const add = await post(base, '/api/action', { type: 'addMenuItem', payload: dish, opId: 'm1' }, c);
  const id = add.body.info.id;
  for (let i = 0; i < 4; i++) assert.equal((await post(base, '/api/action', { type: 'createTicket', payload: { customer: 'Guest ' + i, items: [{ menuId: id }] }, opId: 't' + i }, c)).body.report, 'ok');
  const again = await post(base, '/api/action', { type: 'createTicket', payload: { customer: 'Guest 0', items: [{ menuId: id }] }, opId: 't0' }, c);
  assert.equal(again.body.duplicate, true);
  const refused = await post(base, '/api/action', { type: 'createTicket', payload: { customer: 'X', items: [{ menuId: 'nope' }] }, opId: 'bad1' }, c);
  assert.notEqual(refused.body.report, 'ok');
  const before = (await firstEvent(base, c)).data.state;
  assert.equal(before.tickets.length, 4);
  await cloud.close();
  // a fresh server on the same database: the kitchen comes back from its snapshot plus the actions after it
  const s2 = await start({ dbFile });
  try {
    const after = (await firstEvent(s2.base, c)).data.state;
    assert.deepEqual(after.tickets.map((t) => [t.num, t.customer]), before.tickets.map((t) => [t.num, t.customer]));
    assert.equal((await post(s2.base, '/api/action', { type: 'createTicket', payload: { customer: 'Guest 3', items: [{ menuId: id }] }, opId: 't3' }, c)).body.duplicate, true, 'remembered across the restart');
    assert.equal((await post(s2.base, '/api/action', { type: 'createTicket', payload: { customer: 'X', items: [{ menuId: 'nope' }] }, opId: 'bad1' }, c)).body.duplicate, true, 'a refusal is remembered too');
  } finally { await s2.cloud.close(); }
});

test('guards: another site cannot post, a non-JSON post is refused, a big body is refused, and a sign-up code keeps strangers out', async () => {
  const { cloud, base } = await start({ signupCode: 'SMOKE42' });
  try {
    assert.equal((await post(base, '/api/signup', { email: 'x@example.com', password: 'grill2026smoke', kitchen: 'X' })).status, 403);
    const c = (await post(base, '/api/signup', { email: 'x@example.com', password: 'grill2026smoke', kitchen: 'X', code: 'SMOKE42' })).cookie;
    assert.ok(c);
    assert.match(await (await fetch(base + '/signup')).text(), /Sign-up code/);
    assert.equal((await post(base, '/api/action', { type: 'addMenuItem', payload: dish }, c, { origin: 'https://evil.example' })).status, 403);
    const form = await fetch(base + '/api/action', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: c }, body: 'type=addMenuItem' });
    assert.equal(form.status, 415);
    const big = await fetch(base + '/api/action', { method: 'POST', headers: { 'content-type': 'application/json', cookie: c }, body: JSON.stringify({ type: 'x', payload: 'y'.repeat(300 * 1024) }) }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    assert.equal((await post(base, '/api/action', { type: 'addMenuItem', payload: dish }, 'sb_session=forged')).status, 401);
  } finally { await cloud.close(); }
});
