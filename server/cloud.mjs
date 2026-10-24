#!/usr/bin/env node
// WHAT THIS FILE IS: The hosted Smokebox server. Owners sign up and log in; each account has one kitchen; every device signed in to a
//    kitchen sees the same tickets. It grew from the one-kitchen hub (server/server.mjs) and keeps its rules: the pure engine applies every
//    action in one order, an action is stored on disk before anyone is told "ok", a repeated action id gets the first answer back, and every
//    screen hears each change. What is new: accounts, sessions that keep a device signed in, and many kitchens in one SQLite database.
// PARTS: engine loading, database (tables and statements), passwords and sessions, kitchen rooms (load, act, tick, save), the login and
//    sign-up pages, HTTP routes, command line start.
// USES: node:sqlite (built into Node 22), the engine files in src/js, dist/smokebox.html. USED BY: test/cloud.test.mjs, the server install.
// ENV: PORT (default 8790), HOST (default 127.0.0.1), SMOKEBOX_TZ (process time zone), SMOKEBOX_DB (database file, default
//    ./smokebox-cloud.db), SMOKEBOX_HTML (page to serve), SMOKEBOX_SIGNUP_CODE (when set, sign-up needs this code, so strangers cannot
//    open accounts on the owner's server).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The engine's service day (4 am rollover) uses local time, so the time zone is set before any date maths runs.
if (process.env.SMOKEBOX_TZ) process.env.TZ = process.env.SMOKEBOX_TZ;

// Loads the pure engine files into globalThis.SB, the same way the hub and the tests do, and returns SB.
async function loadEngine() {
  for (const n of ['00-util', '10-config', '18-engine-wasm', '19-planner', '20-engine']) await import(pathToFileURL(path.join(ROOT, 'src/js', n + '.js')).href);
  // The Rust kitchen planner must run here too, so the server plans the kitchen exactly as the tablets do.
  if (!globalThis.SB.planner.startSync()) throw new Error('The kitchen planner (WebAssembly) could not start.');
  return globalThis.SB;
}

/* ---------- database ---------- */
// Opens (or creates) the database with the tables the server needs. WAL journal and FULL sync: a stored action survives a power cut.
// node:sqlite prints a one-line "experimental" notice in Node 22; the API used here is the stable subset.
async function openDb(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS kitchens (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL, created_at INTEGER NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0, snapshot TEXT, snapshot_seq INTEGER NOT NULL DEFAULT 0, snapshot_at INTEGER);
    CREATE TABLE IF NOT EXISTS actions (kitchen_id TEXT NOT NULL REFERENCES kitchens(id), n INTEGER NOT NULL, seq INTEGER NOT NULL, op_id TEXT, type TEXT NOT NULL,
      payload TEXT NOT NULL, at INTEGER NOT NULL, by TEXT, applied INTEGER NOT NULL, reply TEXT NOT NULL, PRIMARY KEY (kitchen_id, n));
    CREATE UNIQUE INDEX IF NOT EXISTS actions_op ON actions (kitchen_id, op_id) WHERE op_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), kitchen_id TEXT NOT NULL REFERENCES kitchens(id),
      device TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_fails (key TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL);
  `);
  return db;
}

/* ---------- passwords and sessions ---------- */
// scrypt settings: about 50 ms per guess on a small server, so a stolen database is slow to attack and logins stay quick.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
// Turns a password into a stored line "scrypt$N$r$p$salt$hash" with a fresh random salt.
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}
// True when the password matches the stored line. Compares in constant time; any malformed line is a plain "no".
function checkPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, 'base64');
  let got;
  try { got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) }); } catch (e) { return false; }
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
// The database keeps only a hash of each session token, so a copied database cannot be used to sign in as anyone.
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
// A new random id with a short readable prefix, like "k_3f9a…".
const newId = (prefix) => prefix + '_' + crypto.randomBytes(12).toString('hex');
// Reads one cookie value from the request, or '' when it is not there.
function cookieOf(req, name) {
  const c = String(req.headers.cookie || '');
  for (const part of c.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return '';
}
const COOKIE = 'sb_session';
const SESSION_MS = 365 * 24 * 3600e3; // a kitchen device stays signed in for a year; every use pushes the date out again
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/* ---------- pages ---------- */

// The sign-in and sign-up page: one small self-contained page in the app's colors. mode is 'login' or 'signup'.
function authPage(mode, needCode) {
  const signup = mode === 'signup';
  const title = signup ? 'Create your Smokebox kitchen' : 'Sign in to Smokebox';
  // Escapes text for HTML, so a kitchen name can never become page code.
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#F5F2EB;--paper:#fff;--ink:#1F2326;--ink2:#4A5258;--line:#C9C2B4;--amber:#B85C38;--bad:#9B2C2C}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
main{width:100%;max-width:420px;background:var(--paper);border:2px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:26px;margin:0 0 6px}p{margin:0 0 18px;color:var(--ink2)}label{display:block;font-weight:600;margin:14px 0 6px}
input{width:100%;font:inherit;padding:12px;border:2px solid var(--line);border-radius:10px;background:#fff;color:var(--ink)}input:focus{outline:3px solid var(--amber);outline-offset:1px}
button{width:100%;margin-top:22px;min-height:52px;font:inherit;font-weight:700;color:#fff;background:var(--amber);border:0;border-radius:10px;cursor:pointer}
button:disabled{opacity:.6}.err{color:var(--bad);font-weight:600;min-height:1.4em;margin:12px 0 0}.alt{margin:18px 0 0;text-align:center}a{color:var(--amber)}
</style></head><body><main><h1>${esc(title)}</h1><p>${signup ? 'One account holds your whole kitchen. Every tablet and computer you sign in on shows the same tickets.' : 'Sign in once on each tablet or computer. It stays signed in.'}</p>
<form id="f" novalidate>
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required>
${signup ? '<label for="kitchen">Kitchen name</label><input id="kitchen" name="kitchen" type="text" maxlength="60" placeholder="Freddy\'s Franks" required>' : ''}
${signup && needCode ? '<label for="code">Sign-up code</label><input id="code" name="code" type="text" autocomplete="off" required>' : ''}
<button id="go" type="submit">${signup ? 'Create my kitchen' : 'Sign in'}</button><p class="err" id="err" role="alert"></p></form>
<p class="alt">${signup ? 'Already have a kitchen? <a href="/login">Sign in</a>' : 'New here? <a href="/signup">Create a kitchen</a>'}</p></main>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const go = document.getElementById('go'), err = document.getElementById('err');
  const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : undefined; };
  go.disabled = true; err.textContent = '';
  try {
    const r = await fetch('/api/${signup ? 'signup' : 'login'}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: v('email'), password: document.getElementById('password').value, kitchen: v('kitchen'), code: v('code'), device: navigator.userAgent.slice(0, 120) }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok) { location.href = '/'; return; }
    err.textContent = b.words || 'That did not work. Try again.';
  } catch (e) { err.textContent = 'No connection to the server. Check the internet and try again.'; }
  go.disabled = false;
});
<\/script></body></html>`;
}

/* ---------- the server ---------- */
/** createCloud(opts) -> { server, listen(port, host), close(), room(kitchenId), db }. Options: dbFile, htmlFile, now, tickMs, heartbeatMs,
 *  signupCode, snapshotEvery (actions between saved snapshots), idleUnloadMs. */
export async function createCloud(opts = {}) {
  const SB = await loadEngine();
  const E = SB.engine;
  const now = opts.now || (() => Date.now());
  const tickMs = opts.tickMs ?? 1000, heartbeatMs = opts.heartbeatMs ?? 15000;
  const htmlFile = opts.htmlFile || process.env.SMOKEBOX_HTML || path.join(ROOT, 'dist/smokebox.html');
  const signupCode = opts.signupCode !== undefined ? opts.signupCode : (process.env.SMOKEBOX_SIGNUP_CODE || '');
  const snapshotEvery = opts.snapshotEvery ?? 200, idleUnloadMs = opts.idleUnloadMs ?? 30 * 60e3;
  const MAX_BODY = 256 * 1024, MAX_SCREENS_PER_KITCHEN = 50, MAX_FAILS = 10, FAIL_WINDOW_MS = 15 * 60e3;
  const db = await openDb(opts.dbFile || process.env.SMOKEBOX_DB || path.join(process.cwd(), 'smokebox-cloud.db'));
  const q = {
    accountByEmail: db.prepare('SELECT * FROM accounts WHERE email = ?'),
    insAccount: db.prepare('INSERT INTO accounts (id, email, pass, created_at) VALUES (?, ?, ?, ?)'),
    insKitchen: db.prepare('INSERT INTO kitchens (id, account_id, name, created_at) VALUES (?, ?, ?, ?)'),
    kitchenOfAccount: db.prepare('SELECT * FROM kitchens WHERE account_id = ? ORDER BY created_at LIMIT 1'),
    kitchen: db.prepare('SELECT * FROM kitchens WHERE id = ?'),
    insSession: db.prepare('INSERT INTO sessions (token_hash, account_id, kitchen_id, device, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT s.*, a.email, k.name AS kitchen_name FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN kitchens k ON k.id = s.kitchen_id WHERE s.token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    actionsAfter: db.prepare('SELECT * FROM actions WHERE kitchen_id = ? AND n > ? ORDER BY n'),
    lastN: db.prepare('SELECT MAX(n) AS n FROM actions WHERE kitchen_id = ?'),
    actionByOp: db.prepare('SELECT reply FROM actions WHERE kitchen_id = ? AND op_id = ?'),
    insAction: db.prepare('INSERT INTO actions (kitchen_id, n, seq, op_id, type, payload, at, by, applied, reply) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    saveSnapshot: db.prepare('UPDATE kitchens SET snapshot = ?, snapshot_seq = ?, snapshot_at = ?, seq = ? WHERE id = ?'),
    setSeq: db.prepare('UPDATE kitchens SET seq = ? WHERE id = ?'),
    fail: db.prepare('SELECT * FROM login_fails WHERE key = ?'),
    setFail: db.prepare('INSERT INTO login_fails (key, count, first_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, first_at = excluded.first_at'),
    clearFail: db.prepare('DELETE FROM login_fails WHERE key = ?'),
  };

  /* ----- kitchen rooms: one live kitchen in memory per kitchen with screens or recent use ----- */
  const rooms = new Map();
  // Loads a kitchen into memory: the saved snapshot (or a new empty kitchen), then every stored action after it, replayed in order at the
  // time it was first applied. This is how a restart or a crash comes back exactly where the screens were told it was.
  function loadRoom(kitchenId) {
    if (rooms.has(kitchenId)) return rooms.get(kitchenId);
    const k = q.kitchen.get(kitchenId);
    if (!k) return null;
    let state = null;
    if (k.snapshot) { const v = E.validateBackup(k.snapshot); if (v.ok) state = v.state; else console.warn('[cloud] kitchen ' + kitchenId + ' snapshot unreadable (' + v.error + '); rebuilding from its actions'); }
    const fromN = state ? k.snapshot_seq : 0;
    if (!state) state = E.newState({ now: k.created_at, blank: true });
    const room = { id: kitchenId, state, seq: k.seq, n: fromN, lastAt: 0, clients: new Set(), opIds: [], sinceSnap: 0, idleSince: now() };
    for (const a of q.actionsAfter.all(kitchenId, fromN)) {
      room.n = a.n;
      if (a.op_id) remember(room, a.op_id);
      if (!a.applied) continue;
      const r = E.apply(room.state, a.type, JSON.parse(a.payload), a.at);
      if (r.report === 'ok') { room.state = r.state; room.lastAt = Math.max(room.lastAt, a.at); room.seq = Math.max(room.seq, a.seq); room.sinceSnap++; }
    }
    const last = q.lastN.get(kitchenId);
    room.n = Math.max(room.n, last && Number.isInteger(last.n) ? last.n : 0);
    room.state = E.tick(room.state, now()).state;
    rooms.set(kitchenId, room);
    return room;
  }
  // Keeps the most recent action ids, so screens can tell which of their own queued actions the state already holds.
  function remember(room, opId) { room.opIds.push(opId); if (room.opIds.length > 2000) room.opIds.splice(0, room.opIds.length - 2000); }
  // What every screen gets: the whole kitchen, the server clock, the change counter and the recent action ids.
  const view = (room) => ({ state: room.state, serverNow: now(), seq: room.seq, opIds: room.opIds.slice() });
  // Sends one named server-sent event to one screen. A screen that stopped reading (backlog over 4 MB) is cut off; it reconnects fresh.
  function send(room, res, event, data) {
    if (res.writableLength > 4 * 1024 * 1024) { room.clients.delete(res); res.destroy(); return; }
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  }
  // Tells every screen of the kitchen about the new state.
  function broadcast(room) { const v = view(room); for (const res of Array.from(room.clients)) send(room, res, 'state', v); }
  // Writes a snapshot of the kitchen so a later load replays only the actions after it.
  function snapshot(room) {
    try { q.saveSnapshot.run(E.serialize(room.state), room.n, now(), room.seq, room.id); room.sinceSnap = 0; } catch (e) { console.warn('[cloud] snapshot failed for ' + room.id + ': ' + e.message); }
  }
  // Runs one action for a kitchen with the server clock. The action row is stored BEFORE the state changes or any screen hears of it; if
  // the disk refuses it, nothing changes and the sender gets 503 (its action id is not remembered, so sending it again later works).
  function runAction(room, body, by) {
    const { type, payload, opId, at } = body || {};
    if (typeof type !== 'string' || !type) return { status: 400, body: { report: 'unknownAction', info: {}, seq: room.seq } };
    const op = typeof opId === 'string' && opId.length <= 80 ? opId : null;
    if (op) { const prev = q.actionByOp.get(room.id, op); if (prev) return { status: 200, body: Object.assign(JSON.parse(prev.reply), { duplicate: true }) }; }
    // A queued action replayed after being offline may say when it happened; that time is trusted only between the last applied action
    // and the server clock, so time never runs backwards or into the future.
    const t = typeof at === 'number' && isFinite(at) ? Math.min(now(), Math.max(room.lastAt, at)) : Math.max(room.lastAt, now());
    const r = E.apply(room.state, type, payload, t);
    const ok = r.report === 'ok';
    const reply = ok ? { report: 'ok', info: r.info, seq: room.seq + 1 } : { report: r.report, info: r.info, seq: room.seq };
    try { q.insAction.run(room.id, room.n + 1, ok ? room.seq + 1 : room.seq, op, type, JSON.stringify(payload ?? {}), t, by || null, ok ? 1 : 0, JSON.stringify(reply)); }
    catch (e) { console.warn('[cloud] could not store an action: ' + e.message); return { status: 503, body: { report: 'badPatch', info: { error: 'the server could not save this action; nothing was changed' }, seq: room.seq } }; }
    room.n++;
    if (op) remember(room, op);
    if (ok) {
      room.state = r.state; room.lastAt = t; room.seq++; room.sinceSnap++;
      broadcast(room);
      if (room.sinceSnap >= snapshotEvery) snapshot(room); else q.setSeq.run(room.seq, room.id);
    }
    return { status: 200, body: reply };
  }

  /* ----- sessions ----- */

  // Starts a session for an account's kitchen and returns the Set-Cookie header. secure is true behind HTTPS.
  function startSession(acc, kitchen, device, secure) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    q.insSession.run(tokenHash(token), acc.id, kitchen.id, String(device || '').slice(0, 120), t, t, t + SESSION_MS);
    return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_MS / 1000) + (secure ? '; Secure' : '');
  }
  // The signed-in session for a request, or null. A session in use is kept alive (its expiry moves a year out, at most once an hour).
  function sessionOf(req) {
    const token = cookieOf(req, COOKIE);
    if (!token) return null;
    const h = tokenHash(token);
    const s = q.session.get(h);
    if (!s || s.expires_at < now()) return null;
    if (now() - s.last_seen > 3600e3) q.touchSession.run(now(), now() + SESSION_MS, h);
    return s;
  }
  // Counts a failed sign-in for a key (an email or an address). True when the key is now locked out for the rest of the window.
  function noteFail(key) {
    const t = now(), f = q.fail.get(key);
    const count = f && t - f.first_at < FAIL_WINDOW_MS ? f.count + 1 : 1;
    q.setFail.run(key, count, f && t - f.first_at < FAIL_WINDOW_MS ? f.first_at : t);
    return count >= MAX_FAILS;
  }
  // True while a key has had too many failed sign-ins in the window.
  function locked(key) { const f = q.fail.get(key); return !!(f && now() - f.first_at < FAIL_WINDOW_MS && f.count >= MAX_FAILS); }

  /* ----- HTTP ----- */

  // True when the request came over HTTPS (directly, or through the web server in front, which says so in X-Forwarded-Proto).
  const isSecure = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
  // Sends a JSON answer with the usual safety headers.
  function json(res, status, body, extra) {
    res.writeHead(status, Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, extra || {}));
    res.end(JSON.stringify(body));
  }
  // Reads a JSON body of at most MAX_BODY bytes and calls back with the object, or null for anything that is not a JSON object.
  function readJson(req, res, cb) {
    let n = 0, done = false; const chunks = [];
    if (Number(req.headers['content-length']) > MAX_BODY) { json(res, 413, { report: 'badPatch', words: 'Too large.' }, { connection: 'close' }); req.destroy(); return; }
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY && !done) { done = true; json(res, 413, { report: 'badPatch', words: 'Too large.' }, { connection: 'close' }); req.destroy(); } else if (!done) chunks.push(c); });
    req.on('end', () => {
      if (done) return; done = true;
      let b = null; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { b = null; }
      cb(b && typeof b === 'object' && !Array.isArray(b) ? b : null);
    });
    req.on('error', () => { done = true; });
  }
  // Cross-site request forgery guard for every POST: the body must be JSON (a page on another site cannot send that without a permission
  // check this server never grants) and a request that names another origin is refused. Answers and returns false when refused.
  function sameSitePost(req, res) {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    let same = true;
    if (req.headers.origin) { try { same = new URL(req.headers.origin).host === req.headers.host; } catch (e) { same = false; } }
    if (ct.startsWith('application/json') && same) return true;
    json(res, same ? 415 : 403, { report: 'badPatch', words: same ? 'Send JSON.' : 'Refused: request from another site.' }, { connection: 'close' });
    req.resume();
    return false;
  }
  // Sends the app page with the signed-in kitchen's name and the server mode written in, so the page knows to talk to this server.
  function sendApp(res, s) {
    let html;
    try { html = fs.readFileSync(htmlFile, 'utf8'); } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('The app page is not built (dist/smokebox.html).'); return; }
    const cfg = JSON.stringify({ kitchen: { id: s.kitchen_id, name: s.kitchen_name }, email: s.email }).replace(/</g, '\\u003c');
    html = html.replace('<head>', '<head><script>window.SB_CLOUD=' + cfg + ';<\/script>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    res.end(html);
  }
  // Sends a small HTML page (sign-in or sign-up).
  function page(res, html) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' }); res.end(html); }

  // Creates an account and its kitchen, then signs this device in. Checks the email, an 8-character password, the kitchen name and, when
  // the server has one, the sign-up code.
  function signup(req, res, b) {
    const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || ''), name = String(b.kitchen || '').trim().replace(/\s+/g, ' ');
    if (signupCode && String(b.code || '').trim() !== signupCode) return json(res, 403, { report: 'badCode', words: 'That sign-up code is not right.' });
    if (!EMAIL_RE.test(email)) return json(res, 400, { report: 'badEmail', words: 'Type a full email address, like you@example.com.' });
    if (pw.length < 8 || pw.length > 200) return json(res, 400, { report: 'badPassword', words: 'Use a password of at least 8 characters.' });
    if (!name || name.length > 60) return json(res, 400, { report: 'badName', words: 'Type your kitchen\'s name (up to 60 characters).' });
    if (q.accountByEmail.get(email)) return json(res, 409, { report: 'taken', words: 'There is already a kitchen for that email. Sign in instead.' });
    const t = now(), acc = { id: newId('a') }, kitchen = { id: newId('k') };
    try {
      db.exec('BEGIN');
      q.insAccount.run(acc.id, email, hashPassword(pw), t);
      q.insKitchen.run(kitchen.id, acc.id, name, t);
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* nothing to undo */ } return json(res, 500, { report: 'error', words: 'The kitchen could not be created. Try again.' }); }
    json(res, 200, { ok: true, kitchen: { id: kitchen.id, name } }, { 'set-cookie': startSession(acc, kitchen, b.device, isSecure(req)) });
  }
  // Signs a device in. Ten wrong tries for one email, or from one address, lock that for 15 minutes; the answer never says which part was wrong.
  function login(req, res, b) {
    const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    const ipKey = 'ip:' + (req.socket.remoteAddress || '?'), emKey = 'em:' + email;
    if (locked(ipKey) || locked(emKey)) return json(res, 429, { report: 'locked', words: 'Too many tries. Wait 15 minutes and try again.' });
    const acc = q.accountByEmail.get(email);
    if (!acc || !checkPassword(pw, acc.pass)) { noteFail(ipKey); noteFail(emKey); return json(res, 401, { report: 'wrong', words: 'That email and password do not match.' }); }
    q.clearFail.run(emKey);
    const kitchen = q.kitchenOfAccount.get(acc.id);
    if (!kitchen) return json(res, 500, { report: 'noKitchen', words: 'This account has no kitchen yet.' });
    json(res, 200, { ok: true, kitchen: { id: kitchen.id, name: kitchen.name } }, { 'set-cookie': startSession(acc, kitchen, b.device, isSecure(req)) });
  }

  // Answers one HTTP request: health, the sign-in pages, the account calls, the app page, the live stream and actions.
  function handle(req, res) {
    const url = (req.url || '/').split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && url === '/health') return json(res, 200, { ok: true, kitchensOpen: rooms.size });
    // Pages and calls that work without being signed in.
    if (req.method === 'GET' && (url === '/login' || url === '/signup')) return page(res, authPage(url.slice(1), !!signupCode));
    if (req.method === 'POST' && (url === '/api/signup' || url === '/api/login')) {
      if (!sameSitePost(req, res)) return;
      return readJson(req, res, (b) => { if (!b) return json(res, 400, { report: 'badPatch', words: 'Bad request.' }); try { (url === '/api/signup' ? signup : login)(req, res, b); } catch (e) { console.warn('[cloud] ' + url + ': ' + e.message); json(res, 500, { report: 'error', words: 'Something went wrong. Try again.' }); } });
    }
    // Everything below needs a signed-in device; the page sends a signed-out device to sign in.
    const s = sessionOf(req);
    if (req.method === 'POST' && url === '/api/logout') {
      if (!sameSitePost(req, res)) return;
      const token = cookieOf(req, COOKIE); if (token) q.delSession.run(tokenHash(token));
      req.resume();
      return json(res, 200, { ok: true }, { 'set-cookie': COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (isSecure(req) ? '; Secure' : '') });
    }
    if (req.method === 'GET' && (url === '/' || url === '/smokebox.html')) { if (!s) { res.writeHead(302, { location: '/login', 'cache-control': 'no-store' }); return res.end(); } return sendApp(res, s); }
    if (!s && url.startsWith('/api/')) { req.resume(); return json(res, 401, { report: 'signedOut', words: 'This device is signed out. Sign in again.' }); }
    if (req.method === 'GET' && url === '/api/me') return json(res, 200, { email: s.email, kitchen: { id: s.kitchen_id, name: s.kitchen_name } });
    // The live stream: the whole kitchen now, then every change, for as long as the screen stays connected.
    if (req.method === 'GET' && url === '/api/events') {
      const room = loadRoom(s.kitchen_id);
      if (!room) return json(res, 404, { report: 'noKitchen', words: 'Kitchen not found.' });
      if (room.clients.size >= MAX_SCREENS_PER_KITCHEN) return json(res, 503, { report: 'full', words: 'Too many screens are connected to this kitchen.' }, { 'retry-after': '10' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', connection: 'keep-alive' });
      room.clients.add(res);
      req.on('close', () => { room.clients.delete(res); if (!room.clients.size) room.idleSince = now(); });
      return send(room, res, 'snapshot', view(room));
    }
    // One action from a screen, applied in the kitchen's one order and answered with the engine's report.
    if (req.method === 'POST' && url === '/api/action') {
      if (!sameSitePost(req, res)) return;
      return readJson(req, res, (b) => {
        const room = loadRoom(s.kitchen_id);
        let out;
        try { out = !room ? { status: 404, body: { report: 'noKitchen' } } : b ? runAction(room, b, typeof b.clientId === 'string' ? b.clientId.slice(0, 40) : null) : { status: 400, body: { report: 'badPatch', info: { error: 'not a JSON object' } } }; }
        catch (e) { console.warn('[cloud] action failed: ' + e.message); out = { status: 500, body: { report: 'badPatch', info: { error: 'action failed' } } }; }
        json(res, out.status, out.body);
      });
    }
    req.resume();
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  }

  const server = http.createServer(handle);
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  let tickTimer = null, hbTimer = null;
  // Starts listening, the 1-second tick (deadlines and expiries move on; screens hear only real changes) and the heartbeat. Idle kitchens
  // are saved and let go of after idleUnloadMs. Resolves with the port in use.
  function listen(port = 0, host = '127.0.0.1') {
    tickTimer = setInterval(() => {
      for (const room of Array.from(rooms.values())) {
        const t = E.tick(room.state, now());
        if (t.state !== room.state) { room.state = t.state; room.seq++; broadcast(room); }
        if (!room.clients.size && now() - room.idleSince > idleUnloadMs) { snapshot(room); rooms.delete(room.id); }
      }
    }, tickMs);
    hbTimer = setInterval(() => { for (const room of rooms.values()) for (const res of Array.from(room.clients)) send(room, res, 'hb', { serverNow: now(), seq: room.seq }); }, heartbeatMs);
    return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
  }
  // Stops the timers, saves a snapshot of every open kitchen, ends every stream and closes the server and the database.
  function close() {
    clearInterval(tickTimer); clearInterval(hbTimer);
    for (const room of rooms.values()) { snapshot(room); for (const res of room.clients) res.end(); room.clients.clear(); }
    rooms.clear();
    return new Promise((resolve) => { server.close(() => { try { db.close(); } catch (e) { /* already closed */ } resolve(); }); server.closeAllConnections?.(); });
  }
  // room(id) loads a kitchen (tests read it); _unload drops one from memory without saving (tests of a crash).
  return { server, listen, close, db, room: (id) => loadRoom(id), _unload: (id) => { const r = rooms.get(id); if (r) { rooms.delete(id); } } };
}

// Command line start: reads PORT and HOST, prints the address, and saves every open kitchen on Ctrl-C or a stop from the service manager.
async function main() {
  let cloud;
  try { cloud = await createCloud(); } catch (e) { console.error('[cloud] ' + e.message); process.exit(1); }
  const host = process.env.HOST || '127.0.0.1';
  const port = await cloud.listen(Number(process.env.PORT || 8790), host);
  console.log('[cloud] Smokebox on http://' + host + ':' + port + ' (time zone ' + (process.env.TZ || 'system') + ')');
  // Closes cleanly (every open kitchen saved) and exits.
  const stop = () => cloud.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
