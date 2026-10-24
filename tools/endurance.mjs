#!/usr/bin/env node
// WHAT THIS FILE IS: The data-layer endurance run. It drives the REAL engine and store (in Node, in memory-only browser storage with a real
//    quota) through months of simulated service for three kinds of kitchen, and checks the data at every day boundary: engine invariants,
//    no NaN or Infinity anywhere in the dataset or summary, saved size and heap growth, safety records never trimmed by size, nothing lost
//    without a repair note. It also does the things that go wrong in real life: weekly backup round trips, Start over, Close the month,
//    a damaged save, a clock jump, two tabs saving in turn, a restore of an old backup, a PIN set and changed.
// Run: node tools/endurance.mjs [--months 6] [--seed 1] [--kitchen blank|cookahead|counter|all] [--quota 5000000] [--days N] [--quiet]
//    (add --expose-gc to node for a cleaner heap column). The unit test test/endurance.test.mjs runs two weeks; ENDURANCE_LONG=1 runs the long one.
// PARTS: storage with a quota, a tab (one copy of the modules), the kitchens, the day loop, the checks, the table.
// USES: src/js/*.js. USED BY: test/endurance.test.mjs, people.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['00-util', '10-config', '20-engine', '30-store', '36-csv', '40-metrics'];
const H = 3600e3, DAY = 24 * H;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A small seeded random generator so a run can be repeated.
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

// Browser-like storage with a size limit: a write that would push the total (keys plus values, in characters) over the limit throws the way a
// full browser does. Tracks the peak and how many writes were refused.
function quotaStorage(limit) {
  const m = new Map();
  let total = 0;
  const st = {
    persistent: true, m, limit, peak: 0, refused: 0,
    get(k, fb) { const raw = m.get(k); if (raw == null) return fb; try { return JSON.parse(raw); } catch (e) { return fb; } },
    raw(k) { return m.has(k) ? m.get(k) : null; },
    set(k, v) {
      const text = JSON.stringify(v);
      const next = total - (m.has(k) ? m.get(k).length + k.length : 0) + text.length + k.length;
      if (next > limit) { st.refused++; const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, text); total = next; if (total > st.peak) st.peak = total; return true;
    },
    remove(k) { if (m.has(k)) { total -= m.get(k).length + k.length; m.delete(k); } },
    keys(prefix) { return [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)); },
    bytes: () => total,
  };
  return st;
}

// One copy of the modules in its own context (one browser tab), sharing whatever storage it is given.
function makeTab() {
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, BroadcastChannel: globalThis.BroadcastChannel };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  const SB = ctx.SB;
  return { SB, S: SB.store, E: SB.engine, U: SB.util, M: SB.metrics, C: SB.config };
}

// Walks any value and returns the path of the first number that is NaN or infinite, or null.
function findBad(o, p = '', depth = 0) {
  if (typeof o === 'number') return Number.isFinite(o) ? null : p;
  if (o && typeof o === 'object' && depth < 12) {
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const r = findBad(o[i], p + '[' + i + ']', depth + 1); if (r) return r; } return null; }
    for (const k of Object.keys(o)) { const r = findBad(o[k], p + '.' + k, depth + 1); if (r) return r; }
  }
  return null;
}
// The state as plain data without the parts that are rebuilt on every load (the revision counter and the availability cache).
// JSON text with object keys in sorted order, so two values compare by content and not by key order.
function canon(v) { return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x)); }
// Where two plain values first differ, as a short path with both values, or null.
function firstDiff(a, b, p = '') {
  if (canon(a) === canon(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  return p + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
}
function plain(state) { const c = JSON.parse(JSON.stringify(state)); delete c.rev; delete c.avail; return c; }

/**
 * runEndurance({ kitchen, seed, days, quota, perDay: [lo, hi], long, onLog }) -> { rows, problems, notes, summary }
 * kitchen: 'blank' (own kitchen, 15 dishes, no ingredients), 'cookahead' (batches, cold items), 'counter' (pay at the counter).
 * problems is empty when every check held. notes lists things worth reading that are not failures.
 */
export async function runEndurance(opts) {
  const kitchen = opts.kitchen || 'blank', seed = opts.seed || 1, days = opts.days || 14, quota = opts.quota || 5e6;
  const perDay = opts.perDay || [80, 250];
  const r = rng(seed * 7919 + kitchen.length);
  const problems = [], notes = [], rows = [];
  const bad = (day, msg) => { if (problems.length < 60) problems.push('day ' + day + ': ' + msg); };
  const t0 = Date.now();
  const storage = quotaStorage(quota);
  const clock = { real: 0 };
  const tab = makeTab();
  let { S, E, U, M, C } = tab;
  const KEY = 'smokebox.v1.state';
  // Starts (or restarts, as after a reload) the store on the shared storage. sync turns on the tab channel for the two-tab episodes.
  const boot = (sync) => S.init({ now: () => clock.real, storage, noTimers: true, noSync: !sync, mode: 'real', blank: true, quotaBytes: quota });
  // Start dates: a spring run crosses the US clock change in March; an autumn run crosses November and the following March.
  const start = seed % 2 ? new Date(2026, 2, 1, 6, 0, 0) : new Date(2026, 8, 20, 6, 0, 0);
  clock.real = start.getTime();
  boot(false);

  const zones = C.workZones.slice(), cats = C.categories.map((c) => c.id);
  const disp = (type, p) => S.dispatch(type, p);
  const must = (day, type, p) => { const rep = disp(type, p); if (rep !== 'ok' && rep !== 'nothingToDo') bad(day, type + ' refused: ' + rep + ' ' + JSON.stringify(S.lastResult() && S.lastResult().info).slice(0, 120)); return rep; };
  let dishIds = [], ings = {};
  // Builds the menu and the kitchen type's extras from an empty kitchen.
  function setup(day) {
    dishIds = [];
    // The simulated cooks start every dish the moment a ticket arrives, so pacing (on in a new kitchen) is switched off: this run
    // measures storage over weeks, and pacing has its own tests.
    disp('updateSettings', { patch: { pacing: { enabled: false } } });
    for (let i = 0; i < 15; i++) {
      const rep = disp('addMenuItem', { name: 'Dish ' + (i + 1), zone: zones[i % zones.length], cat: cats[i % cats.length], price: 5 + i * 0.75, prepSec: 90 + 30 * (i % 5), track: 'one', prepGuess: false });
      if (rep !== 'ok') bad(day, 'addMenuItem ' + rep); else dishIds.push(S.lastResult().info.id);
    }
    if (kitchen === 'counter') must(day, 'updateSettings', { patch: { service: { counter: true, taxRatePct: 8.25 } } });
    else must(day, 'updateSettings', { patch: { service: { taxRatePct: 8.25 } } });
    ings = {};
    if (kitchen === 'cookahead') {
      must(day, 'updateSettings', { patch: { modules: { cookAhead: true } } });
      for (const [key, o] of [['pork', { name: 'Pulled pork', tcs: true, hold: 'hot', maxHoldH: 6, costPerKg: 9, parG: 8000, pullG: 1500, thresholdG: 700 }], ['brisket', { name: 'Brisket', tcs: true, hold: 'hot', maxHoldH: 8, costPerKg: 12, parG: 8000, pullG: 1500, thresholdG: 700 }],
        ['slaw', { name: 'Coleslaw', tcs: true, hold: 'cold', fridge: true, fridgeDays: 3, outHours: 2, costPerKg: 3, parG: 4000, pullG: 800, thresholdG: 300 }]]) {
        if (disp('addIngredient', o) === 'ok') ings[key] = S.lastResult().info.id; else bad(day, 'addIngredient ' + key + ' refused');
      }
    }
  }
  setup(0);

  // ---- bookkeeping across the run ----
  const seenSafety = new Map();          // safety event id -> time, for "never trimmed by size"
  const backups = [];                    // weekly backup texts (kept: the last 3)
  let created = 0, closedPruned = 0, lostByEvents = 0, trimmedSaves = 0, refusals = {}, startedOver = false, damaged = false, jumped = false, restored = false, pinSet = null;
  let batchOpen = [];                    // ids of cook-ahead batches made today
  const total = { bad: 0 };
  const pd = (day) => (perDay[0] + Math.floor(r() * (perDay[1] - perDay[0] + 1)));

  // Reads the state and checks it, returning counts for the table.
  function boundaryChecks(day, deep) {
    if (typeof S.tick === 'function') S.tick();
    const state = S.getState(), now = clock.real;
    const inv = E.checkInvariants(state, now);
    if (inv.length) bad(day, 'invariants: ' + inv.slice(0, 3).join(' | '));
    const stt = S.status();
    if (stt.lastSaveOk === false) bad(day, 'the save failed');
    if (stt.trimmed) trimmedSaves++;
    // safety records: everything seen earlier and younger than the keep time is still there, in memory and in the saved copy
    const nowIds = new Map();
    for (const row of E.safetyLog(state)) nowIds.set(row.event.id, row.event.t);
    for (const [id, t] of seenSafety) if (now - t < E.SAFETY_KEEP_MS && !nowIds.has(id)) { bad(day, 'safety entry ' + id + ' vanished'); seenSafety.delete(id); }
    for (const [id, t] of nowIds) seenSafety.set(id, t);
    if (deep) {
      const saved = S.decodeSaved(storage.get(KEY, null));
      const v = saved ? E.validateBackup(saved) : { ok: false, error: 'nothing saved' };
      if (!v.ok) bad(day, 'saved copy does not load: ' + v.error);
      else {
        const savedIds = new Set(E.safetyLog(v.state).map((x) => x.event.id));
        let missing = 0;
        for (const [id, t] of nowIds) if (!savedIds.has(id)) missing++;
        if (missing) bad(day, missing + ' safety entries are in memory but not in the saved copy');
        if (v.repaired.length) bad(day, 'the saved copy needed repairs: ' + v.repaired.slice(0, 2).join(' | '));
      }
      const ds = S.dataset();
      const b1 = findBad(ds.settings) || findBad(ds.tickets.slice(-400)) || findBad(ds.orders.slice(-400));
      if (b1) bad(day, 'non-finite number in the dataset at ' + b1);
      let sm;
      try { sm = M.summary(ds, {}); } catch (e) { bad(day, 'metrics.summary threw ' + e.message); }
      const b2 = sm && findBad(sm);
      if (b2) bad(day, 'non-finite number in summary at ' + b2);
      for (const fn of ['byDay', 'byHour', 'byItem', 'insights']) { try { const out = M[fn](ds, {}); const b3 = findBad(out); if (b3) bad(day, 'non-finite number in metrics.' + fn + ' at ' + b3); } catch (e) { bad(day, 'metrics.' + fn + ' threw ' + e.message); } }
    }
    return { tickets: state.tickets.length, orders: state.orders.length, events: E.allEvents(state).length, safety: nowIds.size };
  }

  // One ticket from order to payment. Returns false when the engine refused to take it.
  function serveOne(day, t) {
    clock.real = t;
    const nItems = 1 + Math.floor(r() * 3), items = [];
    for (let i = 0; i < nItems; i++) items.push({ menuId: dishIds[Math.floor(r() * dishIds.length)], qty: 1 + Math.floor(r() * 2) });
    const ch = ['dine_in', 'takeout', 'drive_thru', 'third_party'][Math.floor(r() * 4)];
    const method = ['cash', 'card', 'other'][Math.floor(r() * 3)], tip = r() < 0.5 ? Math.round(r() * 400) / 100 : 0;
    const payload = { customer: 'Guest ' + Math.floor(r() * 99), channel: ch, items };
    if (r() < 0.3) payload.note = 'no onions ' + Math.floor(r() * 9);
    if (kitchen === 'counter') payload.pay = { method, tip };
    const rep = disp('createTicket', payload);
    if (rep !== 'ok') { refusals[rep] = (refusals[rep] || 0) + 1; if (refusals[rep] === 1) notes.push('day ' + day + ': first ' + rep + ' refusal of createTicket: ' + JSON.stringify(S.lastResult().info).slice(0, 160)); return false; }
    created++;
    const info = S.lastResult().info, tk = S.getState().tickets[S.getState().tickets.length - 1];
    if (kitchen === 'counter') return true;
    if (r() < 0.04) { disp('voidTicket', { ticketId: tk.id, reason: 'test' }); clock.real += 1000; disp('voidOrder', { orderId: info.orderId, reason: 'test' }); return true; }
    for (const it of tk.items) { clock.real += 5000 + Math.floor(r() * 20000); disp('advanceItem', { ticketId: tk.id, itemId: it.id }); const cur = S.getState().tickets.find((x) => x.id === tk.id); const c2 = cur && cur.items.find((x) => x.id === it.id); if (c2 && c2.status !== 'done') disp('advanceItem', { ticketId: tk.id, itemId: it.id }); }
    clock.real += 3000; disp('bumpTicket', { ticketId: tk.id });
    clock.real += 5000; const rp = disp('payOrder', { orderId: info.orderId, method, tip });
    if (rp !== 'ok') refusals['pay:' + rp] = (refusals['pay:' + rp] || 0) + 1;
    return true;
  }

  // The morning and evening routines that write safety records and, for the cook-ahead kitchen, batches.
  function morning(day, d0) {
    clock.real = d0;
    disp('sanitizeDone', { who: 'JM', ppm: 200 });
    clock.real += 60000; disp('logThermometerCheck', { f: 32, method: 'ice', who: 'JM' });
    clock.real += 60000; disp('logEquipmentTemp', { unit: 'cooler', f: 36 + Math.floor(r() * 4), label: 'Walk-in', who: 'JM' });
    batchOpen = [];
    if (kitchen === 'cookahead') {
      for (const k of Object.keys(ings)) {
        clock.real += 120000;
        const cold = k === 'slaw';
        if (disp('addBatch', { ing: ings[k], tempF: cold ? 38 : 165, cookedG: cold ? 3000 : 7000 }) === 'ok') batchOpen.push(S.lastResult().info.batchId);
      }
    }
  }
  function midday(day, t) {
    if (kitchen !== 'cookahead') return;
    clock.real = t;
    for (const id of batchOpen) {
      const b = S.getState().batches.find((x) => x.id === id);
      if (!b || b.status === 'discard') continue;
      disp('logTemp', { batchId: id, tempF: b.kind === 'cold' ? 36 + Math.floor(r() * 4) : 150 + Math.floor(r() * 12) });
      clock.real += 30000;
    }
    for (const k of Object.keys(ings)) { disp('pullBatch', { ing: ings[k], g: 600 + Math.floor(r() * 500) }); clock.real += 20000; }
  }
  function evening(day, t) {
    clock.real = t;
    if (kitchen === 'cookahead') for (const id of batchOpen) { const b = S.getState().batches.find((x) => x.id === id); if (b && b.status !== 'discard' && b.remainingG > 0 && r() < 0.5) { disp('discardBatch', { batchId: id, reason: 'quality' }); clock.real += 10000; } }
    const rep = disp('closeDay', { leftovers: kitchen === 'cookahead' ? 'discard' : 'keep' });
    if (rep !== 'ok') bad(day, 'closeDay ' + rep + ' ' + JSON.stringify(S.lastResult().info).slice(0, 100));
    S.flush();
  }

  // ---- episodes ----
  // A backup export and import round trip must lose nothing. The state is loaded back through the same check that restore uses.
  function backupRoundTrip(day) {
    const before = S.getState();
    const text = S.exportAll();
    if (text == null) { bad(day, 'export refused: ' + JSON.stringify(S.lastResult())); return; }
    const v = E.validateBackup(text);
    if (!v.ok) { bad(day, 'own export does not load: ' + v.error); return; }
    if (v.repaired.length) bad(day, 'own export needed repairs: ' + v.repaired.slice(0, 3).join(' | '));
    const a = plain(before), b = plain(v.state);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === 'undo') continue;           // a backup never carries the undo list, on purpose
      if (canon(a[k]) !== canon(b[k])) { bad(day, 'round trip changed ' + String(firstDiff(a[k], b[k], k)).slice(0, 300)); break; }
    }
    backups.push({ day, text, tickets: before.tickets.length, orders: before.orders.length });
    if (backups.length > 3) backups.shift();
  }
  // A real import of the kitchen's own export in the middle of the run: the kitchen keeps working and counts match.
  function liveImport(day) {
    const text = S.exportAll(), n = S.getState().tickets.length;
    const rep = S.importAll(text);
    if (rep !== 'ok') { bad(day, 'importAll of own export: ' + rep); return; }
    if (S.getState().tickets.length !== n) bad(day, 'importAll changed the ticket count');
    const rp = S.lastResult().info.repaired;
    if (rp && rp.length) bad(day, 'importAll repaired: ' + rp.slice(0, 2).join(' | '));
  }
  // Close the month: books balance before and after, day totals are kept, metrics still work.
  function closeTheMonth(day, dayKey) {
    const before = dayKey;
    const pv = S.closeMonthPreview({ before });
    if (!pv.ok) { bad(day, 'closeMonthPreview ' + pv.report); return; }
    if (!pv.preview.tickets && !pv.preview.events) { notes.push('day ' + day + ': Close the month found nothing to remove (history already trimmed by the size caps)'); return; }
    const sumDays = (st) => E.allEvents(st).filter((e) => e.type === 'day_closed').reduce((a, e) => a + Math.round(e.total * 100), 0);
    const s0 = S.getState(), t0n = s0.tickets.length, days0 = sumDays(s0);
    const inv0 = E.checkInvariants(s0, clock.real);
    if (inv0.length) bad(day, 'invariants before closing the month: ' + inv0[0]);
    const ex = S.closeMonthExport({ before });
    if (!ex.ok) { bad(day, 'closeMonthExport ' + ex.report); return; }
    for (const f of ex.files) if (f.sha256 !== U.sha256Hex(f.text)) bad(day, 'file hash wrong: ' + f.name);
    const f = ex.files[0];
    const pr = S.closeMonthPrune({ before, confirmBackupSaved: { filename: f.name, chars: f.chars, sha256: f.sha256 } });
    if (!pr.ok) { bad(day, 'closeMonthPrune ' + pr.report); return; }
    closedPruned += t0n - S.getState().tickets.length;
    const s1 = S.getState();
    const inv1 = E.checkInvariants(s1, clock.real);
    if (inv1.length) bad(day, 'invariants after closing the month: ' + inv1[0]);
    if (sumDays(s1) !== days0) bad(day, 'day totals changed by closing the month');
    boundaryChecks(day, true);
    // the pre-prune backup restores the whole month (checked, not applied)
    const v = E.validateBackup(f.text);
    if (!v.ok || v.state.tickets.length !== t0n) bad(day, 'the pre-prune backup does not restore the tickets');
    notes.push('day ' + day + ': Close the month removed ' + pv.preview.tickets + ' tickets, ' + pv.preview.orders + ' orders, ' + pv.preview.events + ' events');
  }
  // Start over: the kitchen is empty, valid, and a new menu can be built on it.
  function startOver(day) {
    const text = S.exportAll(), st0n = S.getState().tickets.length;
    const res = S.startOver({ confirm: 'ERASE', keepSettings: true, backupSaved: { filename: 'before-start-over.json', chars: text.length } });
    if (!res.ok) { bad(day, 'startOver ' + res.report); return; }
    const st = S.getState();
    if (st.tickets.length || st.orders.length) bad(day, 'start over left tickets');
    const inv = E.checkInvariants(st, clock.real);
    if (inv.length) bad(day, 'invariants after start over: ' + inv[0]);
    lostByEvents += st0n;
    seenSafety.clear();                    // Start over clears the safety records on purpose (the backup file holds them)
    setup(day);
    startedOver = true;
  }
  // A damaged save: the stored text becomes garbage and the tab reloads. The store must say so, restore the last good copy, and keep the bad text.
  function damagedSave(day) {
    S.flush();
    const nOrders = S.getState().orders.length, nT = S.getState().tickets.length;
    S.destroy();
    storage.m.set(KEY, '{"v":1,"state":{broken');
    boot(false);
    const stt = S.status();
    if (!stt.corrupt) bad(day, 'a damaged save was not reported');
    if (!storage.keys().some((k) => k === 'smokebox.v1.corrupt')) bad(day, 'the damaged text was not kept');
    const st = S.getState();
    if (stt.restoredFromCopy) notes.push('day ' + day + ': damaged save restored from the last good copy of ' + new Date(stt.restoredFromCopy).toISOString() + ' (' + st.orders.length + ' of ' + nOrders + ' orders back)');
    else notes.push('day ' + day + ': damaged save, no last good copy: started empty-handed (' + st.orders.length + ' orders)');
    const inv = E.checkInvariants(st, clock.real);
    if (inv.length) bad(day, 'invariants after recovery: ' + inv[0]);
    seenSafety.clear();
    for (const row of E.safetyLog(st)) seenSafety.set(row.event.id, row.event.t);
    lostByEvents += nT - st.tickets.length;
    // Without a last good copy the kitchen starts empty (menu, settings and PIN included); the owner would set it up again, so the run does too.
    if (!st.menu.some((m) => !m.archived)) { notes.push('day ' + day + ': the menu, settings and PIN were gone with the history; set up again'); setup(day); }
    const pinNow = S.getState().settings.office.pinHash;
    if (pinSet && pinNow !== pinSet) { notes.push('day ' + day + ': the PIN went back to ' + (pinNow ? 'an older one' : 'none') + ' with the recovery'); pinSet = pinNow; }
    damaged = true;
  }
  // A big forward step of the device clock: the store holds time until the owner accepts it.
  function clockJump(day) {
    S.flush();
    const t = clock.real;
    clock.real += 40 * H;
    S.now();
    const dis = S.status().clockSuspect;
    if (!dis) bad(day, 'a 40-hour clock jump was not held for the owner');
    disp('sanitizeDone', { who: 'JM', ppm: 200 });
    if (!S.acceptClockJump()) bad(day, 'acceptClockJump found no jump');
    if (S.status().clockSuspect) bad(day, 'jump still pending after accepting');
    boundaryChecks(day, false);
    jumped = true;
    return t;
  }
  // Two tabs saving in turn on one storage: every ticket from both survives in both tabs and in the saved copy.
  async function twoTabs(day) {
    const pre = 'T' + day + 'x';
    S.flush(); S.destroy();
    boot(true);
    const B = makeTab();
    B.S.init({ now: () => clock.real, storage, noTimers: true, noSync: false, mode: 'real', blank: true });
    try {
      const want = { A: 0, B: 0 };
      for (let i = 0; i < 4; i++) {
        clock.real += 2000; if (B.S.dispatch('createTicket', { customer: pre + 'B' + i, items: [{ menuId: dishIds[i] }] }) === 'ok') want.B++;
        B.S.flush(); await sleep(25);
        clock.real += 2000; if (disp('createTicket', { customer: pre + 'A' + i, items: [{ menuId: dishIds[i + 4] }] }) === 'ok') want.A++;
        S.flush(); await sleep(25);
      }
      await sleep(80); S.flush(); B.S.flush(); await sleep(80);
      const count = (s, p) => s.getState().tickets.filter((t) => t.customer.indexOf(p) === 0).length;
      for (const [name, s] of [['A', S], ['B', B.S]]) {
        if (count(s, pre + 'A') !== want.A || count(s, pre + 'B') !== want.B) bad(day, 'tab ' + name + ' has wrong ticket counts: A ' + count(s, pre + 'A') + '/' + want.A + ', B ' + count(s, pre + 'B') + '/' + want.B);
      }
      const saved = S.decodeSaved(storage.get(KEY, null));
      const sv = saved && saved.state && saved.state.tickets.filter((t) => t.customer.indexOf(pre) === 0).length;
      if (sv !== want.A + want.B) bad(day, 'saved copy has ' + sv + ' of ' + (want.A + want.B) + ' two-tab tickets');
      created += want.A + want.B;
    } finally {
      // The test orders are paid so the day can close.
      for (const o of S.getState().orders) if (o.status === 'open') { clock.real += 1000; disp('payOrder', { orderId: o.id, method: 'cash' }); }
      S.flush(); B.S.destroy(); S.destroy(); boot(false);
    }
  }
  // Restores an old weekly backup: the result says a copy was kept, the kitchen is the old one, and it keeps working.
  function restoreOld(day) {
    const old = backups[0];
    if (!old) return;
    const cur = S.getState().tickets.length;
    const rep = S.importAll(old.text);
    if (rep !== 'ok') { bad(day, 'restore of the old backup: ' + rep); return; }
    const info = S.lastResult().info;
    if (!info.beforeRestore) notes.push('day ' + day + ': restore kept no before-restore copy (storage had no room)');
    const st = S.getState();
    if (st.tickets.length !== old.tickets) bad(day, 'restore gave ' + st.tickets.length + ' tickets, backup had ' + old.tickets);
    if (info.repaired && info.repaired.length) bad(day, 'restore repaired: ' + info.repaired.slice(0, 2).join(' | '));
    const inv = E.checkInvariants(st, clock.real);
    if (inv.length) bad(day, 'invariants after restore: ' + inv[0]);
    seenSafety.clear();
    for (const row of E.safetyLog(st)) seenSafety.set(row.event.id, row.event.t);
    lostByEvents += cur - st.tickets.length;
    restored = true;
    notes.push('day ' + day + ': restored the backup of day ' + old.day + ' (' + cur + ' -> ' + st.tickets.length + ' tickets)');
  }

  // ---- the day loop ----
  const midMonth = (d) => Math.max(3, Math.round(days * d));
  const episodeDays = {
    pin1: 2, pin2: midMonth(0.55), damaged: midMonth(0.25), jump: midMonth(0.35), startOver: kitchen === 'cookahead' ? midMonth(0.5) : -1,
    twoTabs: [Math.min(days - 1, 4), midMonth(0.45)], restore: midMonth(0.85), monthEnd: [],
  };
  // plain: no special episodes (pin, damaged save, clock jump, start over, two tabs, restore, calendar month close); closeMonthAt: days on which to close the month.
  if (opts.plain) { for (const k of Object.keys(episodeDays)) episodeDays[k] = Array.isArray(episodeDays[k]) ? [] : -1; }
  for (let d = 0; d < days; d++) {
    const dayDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, 10, 30, 0);
    const key = U.serviceDate(dayDate.getTime());
    if (clock.real < dayDate.getTime()) clock.real = dayDate.getTime();
    morning(d, clock.real);
    const n = opts.perDayFixed || pd(d);
    let t = clock.real + 600000;
    const gap = Math.max(8000, Math.min(140000, Math.floor((9.5 * H) / n)));
    for (let i = 0; i < n; i++) {
      serveOne(d, t);
      t = clock.real + 2000 + Math.floor(r() * gap);
      if (i === Math.floor(n / 2)) midday(d, t);
    }
    evening(d, clock.real + 600000);
    const weekly = d % 7 === 6;
    // episodes
    if (d === episodeDays.pin1) { must(d, 'updateSettings', { patch: { office: { pinHash: 'pbkdf2$1$' + 'a'.repeat(40) } } }); pinSet = 'pbkdf2$1$' + 'a'.repeat(40); }
    if (d === episodeDays.pin2) { must(d, 'updateSettings', { patch: { office: { pinHash: 'pbkdf2$1$' + 'b'.repeat(40) } } }); pinSet = 'pbkdf2$1$' + 'b'.repeat(40); }
    if (pinSet && S.getState().settings.office.pinHash !== pinSet && !(restored && d >= episodeDays.restore)) bad(d, 'the PIN hash changed by itself');
    if (weekly) { backupRoundTrip(d); }
    if (d > 0 && d % 30 === 29 && d !== episodeDays.startOver) liveImport(d);
    if (d === episodeDays.damaged) damagedSave(d);
    if (d === episodeDays.startOver) startOver(d);
    for (const td of episodeDays.twoTabs) if (d === td) await twoTabs(d);
    if (d === episodeDays.jump) clockJump(d);
    // end of each calendar month: close the month
    const next = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() + 1);
    if ((opts.closeMonthAt || []).includes(d)) closeTheMonth(d, '2099-01-01');
    else if (!opts.plain && next.getDate() === 1 && d >= 20) closeTheMonth(d, U.dateKey(next.getTime()));
    if (d === episodeDays.restore) restoreOld(d);
    const c = boundaryChecks(d, weekly || d === days - 1);
    if (pinSet === null && false) notes.push('');
    if (typeof globalThis.gc === 'function' && d % 7 === 6) globalThis.gc();      // with --expose-gc the heap column is the live data, not garbage
    const mem = process.memoryUsage();
    const fill = S.historyFill();
    const row = { pct: fill ? fill.pct : null, daysLeft: fill ? fill.daysLeft : null, keepDays: fill ? fill.keepDays : null, lostDays: fill && fill.trimmedSince ? fill.trimmedSince.days : 0, day: d, date: key, tickets: c.tickets, orders: c.orders, events: c.events, safety: c.safety, bytes: storage.bytes(), heapMB: Math.round(mem.heapUsed / 1048576) };
    rows.push(row);
    if (opts.onLog && (d % (opts.logEvery || 7) === 6 || d === days - 1)) opts.onLog(row);
  }
  // final: everything saved loads again, no repairs, and a reload gives the same kitchen
  S.flush();
  const finalChecks = () => {
    const before = plain(S.getState()), wasTrimmed = !!S.status().trimmed, safeBefore = new Set(E.safetyLog(S.getState()).map((x) => x.event.id));
    S.destroy(); boot(false);
    const stt = S.status();
    if (stt.corrupt) bad(days, 'the final reload found the save unreadable');
    if (stt.repaired && stt.repaired.length) bad(days, 'the final reload repaired: ' + stt.repaired.slice(0, 2).join(' | '));
    const after = plain(S.getState());
    // A save that had to be trimmed to fit the browser holds fewer old tickets, orders and events than memory did; everything else must match,
    // the newest tickets must be the same, and every safety entry must still be there.
    const trimmedSave = wasTrimmed;
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (k === 'undo') continue;
      if (trimmedSave && ['tickets', 'orders', 'events', 'eventArchive', 'ledger', 'rev', 'safetyKeep'].includes(k)) continue;
      if (canon(before[k]) !== canon(after[k])) { bad(days, 'a reload changed ' + String(firstDiff(before[k], after[k], k)).slice(0, 300)); break; }
    }
    if (trimmedSave) {
      const bt = before.tickets, at = after.tickets;
      const ids = new Set(bt.map((t) => t.id));
      if (at.length > bt.length || at.some((t) => !ids.has(t.id))) bad(days, 'after a trimmed save the reloaded tickets are not a subset of the ones in memory');
      const keptIds = new Set(at.map((t) => t.id));
      if (bt.slice(-50).some((t) => !keptIds.has(t.id))) bad(days, 'after a trimmed save the newest tickets were not all kept');
      // every safety entry (kept bucket plus the log) survives a trimmed save
      const safeAfter = new Set(E.safetyLog(S.getState()).map((x) => x.event.id));
      for (const id of safeBefore) if (!safeAfter.has(id)) { bad(days, 'a trimmed save lost safety entry ' + id); break; }
      notes.push('the saved copy was trimmed to fit the browser: memory held ' + bt.length + ' tickets, a reload gives ' + at.length);
    }
  };
  finalChecks();
  S.destroy();
  const last = rows[rows.length - 1] || {};
  const trimmed = created - (last.tickets || 0) - closedPruned - lostByEvents;
  const summary = {
    kitchen, seed, days, quota, ticketsServed: created, ticketsKept: last.tickets, trimmedBySizeCap: Math.max(0, trimmed), prunedByCloseMonth: closedPruned, droppedByRecoveryRestoreStartOver: lostByEvents,
    peakBytes: storage.peak, refusedWrites: storage.refused, trimmedSaves, finalBytes: last.bytes, maxHeapMB: Math.max(0, ...rows.map((x) => x.heapMB)), refusals,
    firstNearFullDay: (rows.find((x) => x.pct >= 70) || {}).day ?? null, firstTrimDay: (rows.find((x) => x.lostDays > 0) || {}).day ?? null, firstWarnDay: (rows.find((x) => x.pct >= 85) || {}).day ?? null,
    episodes: { startedOver, damaged, jumped, restored }, seconds: Math.round((Date.now() - t0) / 100) / 10, problems: problems.length,
  };
  return { rows, problems, notes, summary };
}

// ---- command line ----
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
  const months = Number(arg('months', 6)), seeds = arg('seed', '1').split(',').map(Number), quota = Number(arg('quota', 5e6));
  const days = Number(arg('days', Math.round(months * 30.4)));
  const kitchens = arg('kitchen', 'all') === 'all' ? ['blank', 'cookahead', 'counter'] : [arg('kitchen')];
  const quiet = process.argv.includes('--quiet');
  let failed = 0;
  for (const seed of seeds) for (const kitchen of kitchens) {
    console.log('\n=== kitchen ' + kitchen + ', seed ' + seed + ', ' + days + ' days, quota ' + quota + ' ===');
    if (!quiet) console.log('day   date        tickets  orders  events  safety     bytes  heapMB');
    const res = await runEndurance({ kitchen, seed, days, quota, onLog: quiet ? null : (r) => console.log(String(r.day + 1).padStart(3) + '   ' + r.date + '  ' + String(r.tickets).padStart(7) + String(r.orders).padStart(8) + String(r.events).padStart(8) + String(r.safety).padStart(8) + String(r.bytes).padStart(10) + String(r.heapMB).padStart(8)) });
    for (const n of res.notes) console.log('  note: ' + n);
    console.log('  summary: ' + JSON.stringify(res.summary));
    if (res.problems.length) { failed += res.problems.length; for (const p of res.problems) console.log('  PROBLEM ' + p); }
  }
  console.log('\n' + (failed ? failed + ' problem(s)' : 'all checks held'));
  process.exit(failed ? 1 : 0);
}
