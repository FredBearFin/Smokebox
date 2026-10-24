// Browser test of the hosted setup (about 40 s): the real server (server/cloud.mjs) and the real built page, two devices of one kitchen.
// Sign-up, sign-in, a dish and a ticket crossing between devices, a reload that stays signed in, the tablet losing its connection while
// both devices keep taking orders, and coming back with nothing lost or doubled and every ticket number unique. Then signing one device out.
// Run: node test/cloud.e2e.mjs   (builds dist/smokebox.html first)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toolRequire } from '../tools/_deps.mjs';
import { createCloud } from '../server/cloud.mjs';
import { ROOT } from './_load.mjs';

const { chromium } = toolRequire('playwright');
execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--quiet']);
let failed = 0;
// Prints one check and counts failures.
const check = (what, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok || detail === undefined ? '' : '  ' + JSON.stringify(detail))); if (!ok) failed++; };
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cloud-e2e-')), 'cloud.sqlite');
const cloud = await createCloud({ dbFile, signupCode: '' });
const base = 'http://127.0.0.1:' + (await cloud.listen(0));
const browser = await chromium.launch();
const errs = [];
// Opens one "device": its own browser profile, so its own cookies and saved data.
async function device(name, w, h) { const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message)); return { ctx, p }; }
// Waits until a condition on the page holds (or times out), and says whether it did.
const until = (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const tickets = (p) => p.evaluate(() => SB.store.getState().tickets.map((t) => t.num + ':' + t.customer).sort());

try {
  const L = await device('laptop', 1366, 768), T = await device('tablet', 962, 601);
  await L.p.goto(base + '/');
  check('a signed-out device is sent to sign in', new URL(L.p.url()).pathname === '/login');
  await L.p.goto(base + '/signup');
  await L.p.fill('#email', 'owner@example.com'); await L.p.fill('#password', 'grill2026smoke'); await L.p.fill('#kitchen', 'Test Truck');
  await L.p.click('#go'); await L.p.waitForURL(base + '/'); await L.p.waitForFunction(() => window.SB && SB.booted);
  check('sign-up opens the app on the new kitchen', await L.p.evaluate(() => SB.cloud.on && SB.cloud.kitchen.name === 'Test Truck'));
  await T.p.goto(base + '/login');
  await T.p.fill('#email', 'owner@example.com'); await T.p.fill('#password', 'wrong-password'); await T.p.click('#go');
  check('a wrong password says so', await until(T.p, () => /do not match/.test(document.getElementById('err').textContent)));
  await T.p.fill('#password', 'grill2026smoke'); await T.p.click('#go'); await T.p.waitForURL(base + '/'); await T.p.waitForFunction(() => window.SB && SB.booted);

  await L.p.evaluate(() => SB.store.dispatch('addMenuItem', { name: 'Freaky Frank', zone: 'pit', cat: 'meat', price: 11, prepSec: 300, track: 'one', prepGuess: false }));
  check('a dish added on the laptop reaches the tablet', await until(T.p, () => SB.store.getState().menu.some((m) => m.name === 'Freaky Frank')));
  await T.p.evaluate(() => SB.store.dispatch('createTicket', { customer: 'Jake', items: [{ menuId: SB.store.getState().menu[0].id }] }));
  check('a ticket made on the tablet reaches the laptop', await until(L.p, () => SB.store.getState().tickets.some((t) => t.customer === 'Jake')));
  check('both show the same ticket number', JSON.stringify(await tickets(L.p)) === JSON.stringify(await tickets(T.p)), [await tickets(L.p), await tickets(T.p)]);
  await T.p.reload(); await T.p.waitForFunction(() => window.SB && SB.booted);
  check('after a reload the tablet is still signed in with the kitchen', await until(T.p, () => SB.cloud.on && SB.store.getState().tickets.length === 1));

  // The tablet loses its connection; both devices keep taking orders.
  await T.ctx.setOffline(true);
  for (const c of ['Off 1', 'Off 2', 'Off 3']) await T.p.evaluate((name) => SB.store.dispatch('createTicket', { customer: name, items: [{ menuId: SB.store.getState().menu[0].id }] }), c);
  await L.p.evaluate(() => SB.store.dispatch('createTicket', { customer: 'Online', items: [{ menuId: SB.store.getState().menu[0].id }] }));
  // (Playwright's offline mode can leave the open stream working, so the laptop's ticket may already be here too.)
  check('offline, the tablet still shows its own new tickets', (await T.p.evaluate(() => SB.store.getState().tickets.filter((t) => t.customer.startsWith('Off')).length)) === 3);
  check('offline, the tablet says so after a few seconds', await until(T.p, () => /Not connected/.test(document.body.innerText), null, 20000));
  await T.ctx.setOffline(false);
  check('back online, the laptop gets the three offline tickets', await until(L.p, () => SB.store.getState().tickets.length === 5, null, 90000));
  check('back online, the tablet gets the laptop ticket', await until(T.p, () => SB.store.getState().tickets.length === 5, null, 30000));
  const l = await tickets(L.p), t = await tickets(T.p);
  check('both devices show exactly the same five tickets', JSON.stringify(l) === JSON.stringify(t) && l.length === 5, [l, t]);
  check('every ticket number is unique (the server numbers them)', new Set(l.map((x) => x.split(':')[0])).size === 5, l);
  check('nothing was doubled on the server', (await L.p.evaluate(() => SB.store.getState().tickets.filter((x) => x.customer.startsWith('Off')).length)) === 3);
  check('the not-connected strip goes away', await until(T.p, () => !/Not connected/.test(document.body.innerText), null, 15000));

  // Signing the tablet out leaves the laptop signed in.
  await T.p.evaluate(() => SB.cloud.signOut()); await T.p.waitForURL(base + '/login');
  check('sign out takes the tablet to the sign-in page', new URL(T.p.url()).pathname === '/login');
  check('the laptop stays signed in', (await (await L.ctx.request.get(base + '/api/me')).status()) === 200);
  check('no page errors', errs.length === 0, errs);
} finally {
  await browser.close();
  await cloud.close();
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
