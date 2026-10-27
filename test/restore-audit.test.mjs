// Restore-path audit on real compact saves (300 tickets and more): backup export then Restore, Undo restore, last-good fallback, damaged-save
// parking, two tabs while one upgrades plain to compact, the previous build opening a compact save, Close the month, a hub snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadSB, ROOT } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store']);
const { store: S, engine: E, util: U } = SB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 3600e3;
// JSON text of a value; plain-text comparison keeps key order part of the check.
const text = (x) => JSON.stringify(x);
// The state without the revision counter and the undo list (a restore starts with no undo), as text.
const body = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.rev; delete c.undo; return JSON.stringify(c, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v)); };
// Fails with a short note on where two texts first differ.
function same(a, b, what) {
  if (a === b) return;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  assert.fail(what + ': first difference at ' + i + ' of ' + a.length + '/' + b.length + ': ' + a.slice(Math.max(0, i - 50), i + 50) + '  VS  ' + b.slice(Math.max(0, i - 50), i + 50));
}
// A memory storage like the browser's.
function mem(entries) {
  const m = new Map(Object.entries(entries || {}));
  return { m, persistent: true, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), raw: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, JSON.stringify(v)); return true; }, remove: (k) => { m.delete(k); }, keys: (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)) };
}
// A busy kitchen made with the real engine: n finished tickets spread over `days` closed service days. Returns { s, t, dayKeys }.
function busy(n, days = 4) {
  let t = new Date(2026, 8, 1, 12).getTime();
  let s = E.newState({ now: t, blank: true });
  const go = (type, p) => { t += 15000; const x = E.apply(s, type, p, t); if (x.report === 'ok') s = x.state; return x; };
  const dish = go('addMenuItem', { name: 'Plain \u{1F356}', zone: 'pit', cat: 'meat', price: 6.5, prepSec: 60, track: 'one', prepGuess: false }).info.id;
  const dayKeys = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < Math.ceil(n / days); i++) {
      const c = go('createTicket', { customer: 'Guest ' + (i % 40), items: [{ menuId: dish, qty: 1 + (i % 2) }], note: i % 9 ? '' : 'no nuts' });
      const tk = s.tickets[s.tickets.length - 1];
      go('advanceItem', { ticketId: tk.id, itemId: tk.items[0].id }); go('advanceItem', { ticketId: tk.id, itemId: tk.items[0].id }); go('bumpTicket', { ticketId: tk.id });
      go('payOrder', { orderId: c.info.orderId, method: ['cash', 'card'][i % 2], tip: i % 3 ? 0 : 1 });
    }
    dayKeys.push(U.serviceDate(t));
    go('sanitizeDone', { who: 'JM' }); t += 3600e3; go('closeDay', {}); t += 12 * 3600e3;
  }
  return { s: E.tick(s, t).state, t, dayKeys, dish };
}
// Starts the store on a storage and loads the kitchen into it with the same path a restore uses, then saves.
function boot(k, storage, extra, startAt) {
  const clock = { t: startAt || k.t };
  S.init(Object.assign({ storage, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t }, extra || {}));
  assert.equal(S.importAll(JSON.stringify({ v: 1, state: k.s })), 'ok');
  S.flush();
  return clock;
}
const K = busy(360);
assert.ok(K.s.tickets.length >= 300);

test('the busy kitchen is saved in the compact form', () => {
  const b = mem(); boot(K, b);
  assert.equal(JSON.parse(b.m.get('smokebox.v1.state')).fmt, 2);
  S.destroy();
});

test('backup export then Restore brings back exactly that kitchen; the replaced kitchen is kept 7 days and Undo restore returns it', () => {
  const b = mem(); const clock = boot(K, b);
  const backup = S.exportAll();
  assert.equal(JSON.parse(backup).fmt, undefined, 'the export is the readable form');
  same(body(JSON.parse(backup).state), body(S.getState()), 'export equals the live state');
  // the kitchen moves on
  clock.t += 60000; S.dispatch('createTicket', { customer: 'After', items: [{ menuId: K.dish }] }); S.dispatch('sanitizeDone', { who: 'XX' });
  const moved = S.getState(); const movedBody = body(moved);
  clock.t += 60000;
  assert.equal(S.importAll(backup), 'ok');
  const info = S.lastResult().info;
  assert.equal(info.beforeRestore, true); assert.deepEqual(info.repaired, []);
  same(body(S.getState()), body(JSON.parse(backup).state), 'restored equals the backup');
  S.flush();
  assert.equal(JSON.parse(b.m.get('smokebox.v1.state')).fmt, 2);
  const copy = S.beforeRestoreInfo();
  assert.ok(copy && copy.reason === 'before restore');
  assert.equal(S.undoRestore(), 'ok');
  same(body(S.getState()), movedBody, 'undo restore returns the kitchen as it was before the restore');
  S.flush(); S.destroy();
  // and the saved result reloads to the same kitchen
  S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  assert.equal(S.status().corrupt, null); assert.deepEqual(S.status().repaired, []);
  same(body(S.getState()), movedBody, 'reload after undo');
  S.destroy();
});

test('a compact save pasted into Restore (for example a parked damaged copy) is understood', () => {
  const b = mem(); boot(K, b);
  const pasted = b.m.get('smokebox.v1.state');
  assert.equal(JSON.parse(pasted).fmt, 2);
  S.destroy();
  const b2 = mem(); const clock = { t: K.t };
  S.init({ storage: b2, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  assert.equal(S.importAll(pasted), 'ok');
  same(body(S.getState()), body(K.s), 'a pasted compact save restores the kitchen');
  S.destroy();
});

test('last-good fallback: a damaged compact save comes back from the rolling copy, the damaged text is parked unchanged, and the kitchen keeps working', () => {
  const b = mem(); const clock = boot(K, b);
  clock.t += 1000; S.dispatch('closeDay', {}); S.flush();
  assert.ok(b.m.has('smokebox.v1.lastgood'), 'a rolling copy exists');
  S.destroy();
  const good = b.m.get('smokebox.v1.state');
  const bad = good.slice(0, Math.floor(good.length * 0.7));
  b.m.set('smokebox.v1.state', bad);
  S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  const st = S.status();
  assert.ok(st.corrupt && st.restoredFromCopy, 'reported and restored: ' + JSON.stringify(st.corrupt));
  assert.equal(b.m.get('smokebox.v1.corrupt'), JSON.stringify(bad), 'the damaged text is parked exactly');
  assert.ok(S.getState().tickets.length >= 40 && S.getState().menu.length === 1, 'the menu and recent tickets are back');
  assert.deepEqual(E.checkInvariants(S.getState(), clock.t), []);
  clock.t += 60000; assert.equal(S.dispatch('createTicket', { customer: 'Next', items: [{ menuId: K.dish }] }), 'ok'); S.flush();
  S.destroy();
  S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  assert.equal(S.status().corrupt, null, 'the next start is clean');
  assert.ok(S.getState().tickets.some((x) => x.customer === 'Next'));
  S.destroy();
});

test('the packer keeps its numbering when it reads another tab\'s copy: its remembered rows stay valid for the next save', () => {
  const s1 = busy(40, 2).s, s2 = busy(60, 3).s;
  const a = U.makePacker(), other = U.makePacker();
  a.pack(s1);                                                  // a remembers rows numbered by its own tables
  const foreign = JSON.parse(JSON.stringify(other.pack(s2))); // another tab's copy, numbered by its tables
  const back = a.unpack(foreign);
  same(text(back), text(s2), 'reading the foreign copy');
  const wire = JSON.parse(JSON.stringify(a.pack(s1)));
  same(text(U.makePacker().unpack(wire)), text(s1), 'a save after reading a foreign copy is still exact');
});

test('two tabs: one upgrades the save from plain to compact while the other is open; every ticket survives in both and in the saved copy', async () => {
  const bc = typeof globalThis.BroadcastChannel === 'function';
  if (!bc) return;
  const FILES = ['00-util.js', '10-config.js', '20-engine.js', '30-store.js'];
  const mk = () => { const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, BroadcastChannel: globalThis.BroadcastChannel }; ctx.globalThis = ctx; vm.createContext(ctx); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f }); return ctx.SB.store; };
  const small = busy(290, 3);
  const plainStore = mem(); const clock = { t: small.t };
  S.init({ storage: plainStore, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t }); S.importAll(JSON.stringify({ v: 1, state: small.s })); S.flush(); S.destroy();
  assert.equal(JSON.parse(plainStore.m.get('smokebox.v1.state')).fmt, undefined, 'it starts plain');
  const A = mk(), B = mk();
  const opts = { storage: plainStore, mode: 'real', blank: true, noTimers: true, now: () => clock.t };
  A.init(opts); B.init(opts);
  try {
    for (let i = 0; i < 24; i++) {
      clock.t += 1000; A.dispatch('createTicket', { customer: 'A' + i, items: [{ menuId: small.dish }] }); if (i % 3 === 0) A.flush();
      clock.t += 1000; B.dispatch('createTicket', { customer: 'B' + i, items: [{ menuId: small.dish }] }); if (i % 4 === 0) B.flush();
      await sleep(8);
    }
    for (let k = 0; k < 4; k++) { A.flush(); B.flush(); await sleep(60); }
    const want = small.s.tickets.length + 48;
    assert.equal(A.getState().tickets.length, want); assert.equal(B.getState().tickets.length, want);
    const raw = JSON.parse(plainStore.m.get('smokebox.v1.state'));
    assert.equal(raw.fmt, 2, 'the save became compact');
    assert.equal(S.decodeSaved(raw).state.tickets.length, want);
    assert.equal(new Set(A.getState().tickets.map((t) => t.serviceDate + '#' + t.num)).size, want, 'ticket numbers are unique');
  } finally { A.destroy(); B.destroy(); }
});

// The previous build's four files (test/fixtures/prev-build, copied from commit 7ffe92f) as a store in its own context: what a downgrade runs.
function previousBuild() {
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['00-util.js', '10-config.js', '20-engine.js', '30-store.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'test/fixtures/prev-build', f), 'utf8'), ctx, { filename: 'old-' + f });
  return ctx.SB.store;
}

test('downgrade: the previous build sets a compact save aside and uses the last-good copy; the newer build can bring the parked copy back', () => {
  const Old = previousBuild();
  const b = mem(); const clock = boot(K, b);
  clock.t += 1000; S.dispatch('closeDay', {}); S.flush();
  const compactText = b.m.get('smokebox.v1.state');
  const n = S.getState().tickets.length;
  S.destroy();
  // the previous build opens the same browser storage
  Old.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  const st = Old.status();
  assert.ok(st.corrupt, 'the previous build calls the save damaged: ' + st.corrupt);
  assert.ok(st.restoredFromCopy, 'and shows the last good copy');
  assert.equal(b.m.get('smokebox.v1.corrupt'), JSON.stringify(JSON.parse(compactText)), 'the compact text is parked, not deleted');
  assert.equal(Old.getState().menu.length, 1, 'the menu, settings and recent tickets are there');
  Old.flush(); Old.destroy();
  // back on the newer build: it loads what the previous build saved, and can offer the parked full history
  S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  assert.equal(S.status().corrupt, null);
  const parked = S.parkedCopy();
  assert.ok(parked && parked.tickets === n, 'the parked copy is found: ' + JSON.stringify(parked));
  assert.equal(S.restoreParked(), 'ok');
  assert.equal(S.getState().tickets.length, n);
  assert.deepEqual(E.checkInvariants(S.getState(), clock.t), []);
  assert.ok(S.beforeRestoreInfo(), 'the kitchen it replaced is kept for 7 days');
  S.destroy();
});

test('Close the month on a compact save: the export and the 7-day copy are readable, the pruned save reloads exactly, Undo restore brings the month back', () => {
  const b = mem(); const clock = boot(K, b, null, K.t + 35 * DAY);   // the closed days are 35 days old
  const before = '2099-01-01';
  const pv = S.closeMonthPreview({ before, keepDays: 1 });
  assert.equal(pv.ok, true); assert.ok(pv.preview.tickets > 100, JSON.stringify(pv.preview).slice(0, 200));
  const ex = S.closeMonthExport({ before, keepDays: 1 });
  assert.equal(ex.ok, true);
  const backup = ex.files[0];
  assert.equal(JSON.parse(backup.text).fmt, undefined);
  const full = S.getState().tickets.length;
  const pr = S.closeMonthPrune({ before, keepDays: 1, confirmBackupSaved: { filename: backup.name, chars: backup.chars, sha256: backup.sha256 } });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  const pruned = body(S.getState());
  S.flush(); S.destroy();
  S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  assert.equal(S.status().corrupt, null);
  same(body(S.getState()), pruned, 'reload after the prune');
  assert.ok(S.getState().tickets.length < full);
  const copy = S.beforeRestoreInfo(); assert.equal(copy.reason, 'before month close');
  assert.equal(S.undoRestore(), 'ok');
  assert.equal(S.getState().tickets.length, full, 'the whole month is back');
  // and restoring the pre-prune backup file gives the same
  assert.equal(S.importAll(backup.text), 'ok'); assert.equal(S.getState().tickets.length, full);
  S.destroy();
});

test('a hub snapshot (a plain state sent by the hub) is adopted and saved in the compact form, and reloads exactly', () => {
  const b = mem(); const clock = { t: K.t };
  let deliver = null;
  const transport = { name: 'fake-hub', open(d) { deliver = d; return true; }, push: async () => ({ acked: [] }), post() { return true; }, close() {} };
  S.init({ storage: b, mode: 'real', blank: true, noTimers: true, now: () => clock.t, transport });
  deliver({ type: 'state', state: JSON.parse(JSON.stringify(K.s)), opIds: [] });
  assert.equal(S.getState().tickets.length, K.s.tickets.length);
  S.flush();
  assert.equal(JSON.parse(b.m.get('smokebox.v1.state')).fmt, 2);
  const adopted = body(S.getState());
  S.destroy();
  S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
  same(body(S.getState()), adopted, 'reload after adopting a hub snapshot');
  S.destroy();
});

test('a damaged before-restore copy is refused by Undo restore without touching the kitchen', () => {
  const b = mem(); const clock = boot(K, b);
  const backup = S.exportAll();
  clock.t += 1000; S.dispatch('sanitizeDone', { who: 'ZZ' });
  assert.equal(S.importAll(backup), 'ok');
  const g = JSON.parse(b.m.get('smokebox.v1.lastgood'));
  assert.equal(g.fmt, 2, 'the copy of a big kitchen is compact');
  g.p.x = g.p.x.slice(0, 5); b.m.set('smokebox.v1.lastgood', JSON.stringify(g));
  const before = body(S.getState());
  assert.equal(S.undoRestore(), 'invalidBackup');
  same(body(S.getState()), before, 'the kitchen is untouched');
  S.destroy();
});

test('a compact save that parses but will not unpack is parked whole, with its packed body, and a newer format number too', () => {
  for (const tweak of [(o) => { o.p = Array.isArray(o.p) ? o.p.slice(0, 2) : 'x'; }, (o) => { o.fmt = 3; }]) {
    const b = mem(); const clock = boot(K, b);
    S.destroy();
    const saved = JSON.parse(b.m.get('smokebox.v1.state'));
    assert.equal(saved.fmt, 2);
    tweak(saved);
    b.m.set('smokebox.v1.state', JSON.stringify(saved));
    S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => clock.t });
    assert.ok(S.status().corrupt, 'reported');
    const parked = JSON.parse(b.m.get('smokebox.v1.corrupt'));
    assert.ok(parked.p !== undefined && parked.fmt === saved.fmt, 'the packed body is kept in the parked copy');
    S.destroy();
  }
});

test('Close the month right after a restore leaves the restore\'s undo copy alone; the month backup file is the way back', () => {
  const b = mem(); const clock = boot(K, b, null, K.t + 35 * DAY);
  const pre = S.getState().tickets.length;
  // a restore over this kitchen: the kitchen as it was is kept for Undo restore
  assert.equal(S.importAll(JSON.stringify({ v: 1, state: K.s })), 'ok');
  assert.equal(S.beforeRestoreInfo().reason, 'before restore');
  const takenAt = S.beforeRestoreInfo().takenAt;
  const before = '2099-01-01';
  const ex = S.closeMonthExport({ before, keepDays: 1 });
  const backup = ex.files[0];
  clock.t += 60e3;
  const pr = S.closeMonthPrune({ before, keepDays: 1, confirmBackupSaved: { filename: backup.name, chars: backup.chars, sha256: backup.sha256 } });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  assert.equal(pr.info.copyKept, false); assert.equal(pr.info.restoreCopyKept, true);
  const info = S.beforeRestoreInfo();
  assert.equal(info.reason, 'before restore'); assert.equal(info.takenAt, takenAt);
  assert.equal(S.undoRestore(), 'ok');
  assert.equal(S.getState().tickets.length, pre, 'Undo restore still gives back the kitchen from before the restore');
  S.destroy();
});
