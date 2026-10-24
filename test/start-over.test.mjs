// "Start over with an empty menu" and the one-time clearing of old demo tickets from a real kitchen's reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSB, ROOT } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '13-menu-import', '20-engine', '30-store']);
const { store: S, engine: E, config: C, util: U } = SB;
const T = 1780326000000, MIN = 60e3;
let clock = T;
function backend(entries) {
  const m = new Map(Object.entries(entries || {})), log = [];
  return { m, log, persistent: true, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), raw: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { log.push(['set', k]); m.set(k, JSON.stringify(v)); return true; }, remove: (k) => { log.push(['remove', k]); m.delete(k); }, keys: (p) => Array.from(m.keys()).filter((k) => k.indexOf(p) === 0) };
}
const start = (b, mode, extra) => S.init(Object.assign({ storage: b, mode: mode || 'real', blank: true, noTimers: true, noSync: true, now: () => clock }, extra));
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v));
const body = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.rev; delete c.undo; delete c.avail; c.batches.sort((a, b) => (a.id < b.id ? -1 : 1)); return canon(c); };
const WORD = S.START_OVER_WORD;
// A busy real kitchen: sample menu, orders paid and open, a batch discard, a PIN, tax, custom names and setup choices.
function busyKitchen(b) {
  start(b, 'real', { blank: false, starter: true });
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 8 }, office: { pinHash: 'sha256:' + 'ab12'.repeat(16) } } });
  for (let i = 0; i < 6; i++) {
    clock += 5 * MIN; S.dispatch('createTicket', { customer: 'g' + i, channel: 'dine_in', items: [{ menuId: 'tea', qty: 1 }] }); S.tick();
    const tk = S.getState().tickets.at(-1); S.dispatch('completeItem', { ticketId: tk.id, itemId: tk.items[0].id }); S.dispatch('bumpTicket', { ticketId: tk.id });
    if (i % 2 === 0) S.dispatch('payOrder', { orderId: tk.orderId, method: 'cash', tip: 0, discount: 0 });
  }
  S.dispatch('discardBatch', { batchId: S.getState().batches[0].id, reason: 'manual' });
  const spec = { rename: { zones: { pit: 'Smoker' } }, add: {} }; C.applyCustom(spec); C.saveCustom(spec);
  b.set('smokebox.v1.setup.draft', { name: 'half' }); b.set('smokebox.v1.setup.hiddenCategories', ['fried']); b.set('smokebox.v1.setup.lastCategory', 'meat'); b.set('smokebox.v1.setup.examples', ['tea']); b.set('smokebox.v1.setup.hiddenStations', ['fry']);
  b.set('smokebox.v1.welcome', 'done'); b.set('smokebox.v1.dlog', { initials: { b_1: 'JR' } }); b.set('smokebox.v1.theme', 'night'); b.set('smokebox.v1.lastbackup', 12345);
  S.flush();
}
const cleanNames = () => { C.applyCustom({}); U.storage.remove('smokebox.v1.names'); };

test('start over is refused without the typed word, in the demo, and with bad options; nothing changes', () => {
  clock = T;
  const b = backend(); busyKitchen(b);
  try {
    const before = body(S.getState()), writes = b.log.length;
    for (const confirm of [undefined, '', 'erase it', 'yes', 5, 'ERASE!']) { const r = S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm }); assert.equal(r.ok, false, String(confirm)); assert.equal(r.report, 'confirmWord'); }
    assert.equal(S.startOver().report, 'confirmWord');
    assert.equal(S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD, keepSettings: 'no' }).report, 'badPatch');
    assert.equal(body(S.getState()), before); assert.equal(b.log.length, writes);
    assert.match(E.describe('confirmWord'), /Type the confirmation word/);
  } finally { S.destroy(); cleanNames(); }
  const d = backend(); start(d, 'demo');
  const r = S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD });
  assert.deepEqual([r.ok, r.report], [false, 'notInDemo']); assert.equal(d.log.length, 0);
  S.destroy();
});

test('start over takes a backup first, clears everything, keeps settings, and is a brand-new blank kitchen', () => {
  clock = T;
  const b = backend(); busyKitchen(b);
  try {
    const pre = S.getState(), preBody = body(pre);
    assert.ok(pre.menu.length >= 21 && pre.orders.length === 6);
    const r = S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: ' erase ' });                  // any case, spaces around are fine
    assert.equal(r.ok, true); assert.equal(r.report, 'ok');
    assert.ok(r.backup.text.length > 1000 && /\.json$/.test(r.backup.filename) && r.backup.mime === 'application/json');
    assert.equal(JSON.parse(r.backup.text).mode, 'real');
    const s = S.getState();
    assert.deepEqual([s.menu.length, s.ingredients.length, s.batches.length, s.tickets.length, s.orders.length, Object.keys(s.stock).length, E.allEvents(s).length, s.catalog], [0, 0, 0, 0, 0, 0, 0, 'own']);
    assert.equal(S.isBlank(), true); assert.equal(S.isOwn(), true);
    assert.deepEqual([s.settings.service.taxRatePct, s.settings.office.pinHash], [8, 'sha256:' + 'ab12'.repeat(16)]);   // kept
    assert.equal(E.moduleOn(s, 'cookAhead'), false);
    assert.deepEqual(C.customSpec(), { rename: { zones: { pit: 'Smoker' } }, add: {} });                               // station names kept
    for (const k of ['setup.draft', 'setup.examples', 'setup.hiddenStations', 'setup.hiddenCategories', 'setup.lastCategory', 'welcome', 'dlog']) assert.equal(b.m.has('smokebox.v1.' + k), false, k);
    assert.equal(b.get('smokebox.v1.theme', null), 'night'); assert.equal(b.get('smokebox.v1.lastbackup', null), 12345);
    assert.deepEqual(E.checkInvariants(s, S.now()), []);
    // same as a brand-new blank install (ids keep counting so they are never reused)
    const fresh = E.newState({ now: S.now(), blank: true, settings: s.settings, seq: s.seq });
    // except the food safety record, which outlives a start over
    assert.ok(s.safetyKeep.length > 0 && s.safetyKeep.every((e) => e.type === 'batch_discard' || e.type === 'temp_logged' || e.type === 'sanitize_done' || e.type === 'batch_reheat'));
    assert.equal(body(s), body(Object.assign({}, fresh, { sanitize: s.sanitize, learned: s.learned, safetyKeep: s.safetyKeep })));
    // the saved copy is the empty kitchen too
    assert.equal(E.validateBackup(b.m.get('smokebox.v1.state')).state.menu.length, 0);
    // the backup restores everything
    assert.equal(S.importAll(r.backup.text), 'ok');
    assert.equal(body(S.getState()), preBody);
    assert.equal(S.isOwn(), false);
  } finally { S.destroy(); cleanNames(); }
});

test('start over with settings reset also clears tax, PIN, hours and station names; the last good copy is retaken from the empty kitchen', () => {
  clock = T;
  const b = backend(); busyKitchen(b);
  try {
    const r = S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD, keepSettings: false });
    assert.equal(r.ok, true);
    const s = S.getState();
    assert.deepEqual([s.settings.service.taxRatePct, s.settings.office.pinHash, s.settings.service.openHour], [0, null, 11]);
    assert.deepEqual(C.customSpec(), S.STARTER_NAMES);                    // the barbecue-flavored names are gone; the neutral starter names take their place
    const copy = b.get('smokebox.v1.lastgood', null);
    assert.equal(copy.reason, 'startOver'); assert.equal(copy.state.menu.length, 0);           // never the erased kitchen
    assert.equal(copy.state.tickets.length, 0); assert.equal(copy.state.settings.office.pinHash, null);
    assert.equal(b.get('smokebox.v1.corrupt', null), null);
  } finally { S.destroy(); cleanNames(); }
});

test('start over never reads, writes or removes the demo\'s keys', () => {
  clock = T;
  const b = backend(); busyKitchen(b); S.destroy();
  start(b, 'demo'); S.dispatch('toggle86', { menuId: 'tea', on: true }); S.flush(); S.destroy();
  const demoKeys = new Map(Array.from(b.m.entries()).filter(([k]) => k.indexOf('smokebox.demo.') === 0));
  assert.ok(demoKeys.size > 0);
  b.log.length = 0;
  start(b, 'real', { blank: false });
  try {
    assert.equal(S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD }).ok, true);
    S.flush();
    assert.deepEqual(b.log.filter((x) => x[1].indexOf('smokebox.demo.') === 0), []);
    for (const [k, v] of demoKeys) assert.equal(b.m.get(k), v, k);
  } finally { S.destroy(); cleanNames(); }
});

test('every old save: start over, then restoring the backup recovers the whole kitchen', () => {
  const dir = path.join(ROOT, 'test/fixtures/old-saves');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    clock = Date.UTC(2026, 9, 17, 20);
    const b = backend(fx.storage);
    start(b);
    try {
      const pre = body(S.getState());
      const r = S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD });
      assert.equal(r.ok, true, f);
      assert.equal(S.isBlank(), true, f); assert.deepEqual(E.checkInvariants(S.getState(), S.now()), [], f);
      assert.equal(S.importAll(r.backup.text), 'ok', f);
      assert.equal(body(S.getState()), pre, f);
    } finally { S.destroy(); cleanNames(); }
  }
});

test('random work, start over, more random work: invariants hold and the backup restores', () => {
  for (let seed = 1; seed <= 25; seed++) {
    clock = T;
    let a = seed * 2654435761 >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const b = backend();
    start(b, 'real', { blank: seed % 2 === 0 });
    try {
      const work = (n) => {
        for (let i = 0; i < n; i++) {
          clock += 3 * MIN; S.tick();
          const g = S.getState(), k = Math.floor(rnd() * 8);
          if (k === 0) S.dispatch('addMenuItem', { name: 'D' + Math.floor(rnd() * 20), zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' });
          else if (k === 1) S.dispatch('addIngredient', { name: 'I' + Math.floor(rnd() * 10), costPerKg: 3 });
          else if (k === 2 && g.menu.length) S.dispatch('setPortions', { menuId: g.menu[Math.floor(rnd() * g.menu.length)].id, on: true, count: 5 });
          else if (k === 3 && g.menu.length) S.dispatch('createTicket', { customer: 'c', channel: 'dine_in', items: [{ menuId: g.menu[Math.floor(rnd() * g.menu.length)].id, qty: 1 }] });
          else if (k === 4 && g.tickets.length) { const tk = g.tickets[g.tickets.length - 1]; S.dispatch('completeItem', { ticketId: tk.id, itemId: tk.items[0].id }); S.dispatch('bumpTicket', { ticketId: tk.id }); }
          else if (k === 5 && g.orders.length) S.dispatch('payOrder', { orderId: g.orders[g.orders.length - 1].id, method: 'cash', tip: 0, discount: 0 });
          else if (k === 6) S.dispatch('closeDay', { leftovers: 'keep' });
          else if (k === 7 && g.menu.length > 1) S.dispatch('moveMenuItem', { id: g.menu[0].id, toIndex: g.menu.length - 1 });
          assert.deepEqual(E.checkInvariants(S.getState(), S.now()), [], 'seed ' + seed + ' step ' + i);
        }
      };
      work(40);
      const pre = body(S.getState());
      const r = S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD, keepSettings: rnd() < 0.5 });
      assert.equal(r.ok, true, 'seed ' + seed);
      assert.equal(S.isBlank(), true);
      work(30);
      assert.equal(S.importAll(r.backup.text), 'ok');
      assert.equal(body(S.getState()), pre, 'seed ' + seed);
    } finally { S.destroy(); cleanNames(); }
  }
});

/* ---------------- old demo and sample tickets ---------------- */

// A kitchen with real and old-demo work: returns the state.
function mixedKitchen() {
  let s = E.newState({ now: T, starter: true });
  const now = T + 1000;
  const ap = (type, p, at) => { const r = E.apply(s, type, p, at == null ? now : at); assert.equal(r.report, 'ok', type + ' ' + r.report); s = r.state; return r; };
  const mk = (src, customer) => { const r = ap('createTicket', { customer, channel: 'dine_in', items: [{ menuId: 'tea', qty: 1 }, { menuId: 'slaw', qty: 1 }], src }); return r.info; };
  const finish = (ti, pay) => { s = E.tick(s, T + 600e3).state; const tk = s.tickets.find((t) => t.id === ti.ticketId); for (const it of tk.items) ap('completeItem', { ticketId: tk.id, itemId: it.id }, T + 601e3); ap('bumpTicket', { ticketId: tk.id }, T + 602e3); if (pay) ap('payOrder', { orderId: ti.orderId, method: 'cash', tip: 1, discount: 0 }, T + 603e3); };
  const out = {};
  out.liveA = mk('live', 'Real A'); finish(out.liveA, true);                 // real, paid
  out.liveB = mk('live', 'Real B'); finish(out.liveB, false);                // real, bumped, order open
  out.liveC = mk('live', 'Real C');                                           // real, still cooking
  out.demoA = mk('demo', 'Demo A'); finish(out.demoA, true);                 // demo, paid
  out.demoB = mk('demo', 'Demo B'); finish(out.demoB, false);                // demo, order open
  out.demoC = mk('demo', 'Demo C');                                           // demo, still cooking
  out.sampleA = mk('sample', 'Sample A');                                     // sample
  out.mixed = mk('demo', 'Demo D');                                           // a demo order a real round was added to
  ap('createTicket', { customer: 'Real round', channel: 'dine_in', items: [{ menuId: 'tea', qty: 1 }], orderId: out.mixed.orderId, src: 'live' });
  return { s, out };
}

test('the old-demo count is exact and never includes real tickets or the orders that hold them', () => {
  const { s, out } = mixedKitchen();
  const c = E.demoLeftovers(s);
  // removable: demo A, B, C and sample A (4 tickets, 4 orders: 1 paid, 3 open); the mixed order is left alone
  assert.deepEqual([c.tickets, c.orders, c.paidOrders, c.openOrders, c.mixedOrders], [4, 4, 1, 3, 1]);
  const ids = [out.demoA, out.demoB, out.demoC, out.sampleA].map((x) => x.ticketId);
  assert.equal(s.tickets.filter((t) => ids.includes(t.id)).length, 4);
  assert.equal(c.events, E.allEvents(s).filter((e) => (e.ticketId && ids.includes(e.ticketId)) || (e.orderId && [out.demoA, out.demoB, out.demoC, out.sampleA].some((x) => x.orderId === e.orderId))).length);
  assert.ok(c.events > 8);
  assert.deepEqual(E.demoLeftovers(E.newState({ now: T, starter: true })), { tickets: 0, orders: 0, paidOrders: 0, openOrders: 0, mixedOrders: 0, events: 0 });
  assert.deepEqual(E.demoLeftovers(null), { tickets: 0, orders: 0, paidOrders: 0, openOrders: 0, mixedOrders: 0, events: 0 });
});

test('clearing removes exactly those, keeps every real ticket, order and payment, and the books balance', () => {
  const { s, out } = mixedKitchen();
  const realTotals = (st) => canon(st.orders.filter((o) => o.src === 'live').map((o) => [o.id, o.status, o.totals, o.tip, o.method, o.paidAt]));
  const before = realTotals(s);
  const c = E.demoLeftovers(E.tick(s, T + 700e3).state);      // the action ticks first, which can add events for cooking tickets
  const r = E.apply(s, 'clearDemoTickets', {}, T + 700e3);
  assert.equal(r.report, 'ok');
  assert.deepEqual([r.info.tickets, r.info.orders, r.info.paidOrders, r.info.events], [c.tickets, c.orders, c.paidOrders, c.events]);
  const n = r.state;
  assert.equal(n.tickets.length, s.tickets.length - 4); assert.equal(n.orders.length, s.orders.length - 4);
  assert.deepEqual(n.tickets.filter((t) => t.src !== 'live').map((t) => t.customer), ['Demo D']);          // the mixed order's own demo ticket stays with it
  assert.deepEqual(['Real A', 'Real B', 'Real C', 'Demo D'].every((c2) => n.tickets.some((t) => t.customer === c2)), true);
  assert.equal(n.tickets.filter((t) => t.src === 'live').length, s.tickets.filter((t) => t.src === 'live').length);   // every real ticket, including the real round added to a demo order
  assert.equal(realTotals(n), before);
  assert.ok(n.orders.some((o) => o.id === out.mixed.orderId));
  assert.deepEqual(E.demoLeftovers(n), { tickets: 0, orders: 0, paidOrders: 0, openOrders: 0, mixedOrders: 1, events: 0 });
  assert.deepEqual(E.checkInvariants(n, T + 700e3), []);
  assert.equal(E.apply(n, 'clearDemoTickets', {}, T + 800e3).report, 'nothingToDo');
  // money truth: the paid real order is still counted and the removed demo payment is not
  assert.equal(n.orders.filter((o) => o.status === 'paid').length, 1);
  const v = E.validateBackup(E.serialize(n));
  assert.deepEqual(v.repaired, []);
  // nothing to clear in a clean kitchen
  assert.equal(E.apply(E.newState({ now: T, starter: true }), 'clearDemoTickets', {}, T).report, 'nothingToDo');
});

test('clearing one demo ticket by id (the walkthrough cleaning up) removes only that ticket and its own order', () => {
  const { s, out } = mixedKitchen();
  const r = E.apply(s, 'clearDemoTickets', { ticketId: out.demoA.ticketId }, T + 700e3);
  assert.equal(r.report, 'ok');
  assert.deepEqual([r.info.tickets, r.info.orders], [1, 1]);
  assert.equal(r.state.tickets.length, s.tickets.length - 1); assert.equal(r.state.orders.length, s.orders.length - 1);
  assert.ok(!r.state.tickets.some((t) => t.id === out.demoA.ticketId));
  assert.ok(r.state.tickets.some((t) => t.id === out.demoB.ticketId));
  assert.deepEqual(E.checkInvariants(r.state, T + 700e3), []);
  // a real ticket, an unknown id or a bad id is never removed
  const real = s.tickets.find((t) => t.src === 'live');
  assert.equal(E.apply(s, 'clearDemoTickets', { ticketId: real.id }, T + 700e3).report, 'nothingToDo');
  assert.equal(E.apply(s, 'clearDemoTickets', { ticketId: 'nope' }, T + 700e3).report, 'nothingToDo');
  assert.equal(E.apply(s, 'clearDemoTickets', { ticketId: 5 }, T + 700e3).report, 'badPatch');
});

test('the store offers the clean-up once, remembers "keep", and does nothing in the demo', () => {
  clock = T;
  const b = backend();
  const { s } = mixedKitchen();
  b.set('smokebox.v1.state', { v: 1, savedAt: T, rev: s.rev, clock: { virtual: T + 700e3, real: T + 700e3, speed: 1 }, state: s });
  clock = T + 700e3;
  start(b);
  try {
    let c = S.demoLeftovers();
    assert.deepEqual([c.tickets, c.orders, c.kept, c.offer], [4, 4, false, true]);
    assert.equal(S.keepDemoLeftovers(), true);
    c = S.demoLeftovers(); assert.deepEqual([c.kept, c.offer, c.tickets], [true, false, 4]);
    assert.equal(b.get('smokebox.v1.demoLeftoversKept', null), true);
    const r = S.clearDemoLeftovers();
    assert.deepEqual([r.ok, r.info.tickets, r.info.orders], [true, 4, 4]);
    c = S.demoLeftovers(); assert.deepEqual([c.tickets, c.orders, c.offer], [0, 0, false]);
    assert.equal(S.clearDemoLeftovers().report, 'nothingToDo');
    assert.equal(E.validateBackup(b.m.get('smokebox.v1.state')).state.tickets.length, s.tickets.length - 4);
  } finally { S.destroy(); }
  // the demo: demo tickets belong there, nothing is counted or cleared, and no real key is written
  const d = backend(); start(d, 'demo');
  try {
    assert.deepEqual([S.demoLeftovers().tickets, S.demoLeftovers().offer], [0, false]);
    assert.equal(S.keepDemoLeftovers(), false);
    assert.deepEqual([S.clearDemoLeftovers().ok, S.clearDemoLeftovers().report], [false, 'notInDemo']);
  } finally { S.destroy(); }
  assert.ok(U.dataKeys.includes('smokebox.v1.demoLeftoversKept'));
});

test('a failed save shows on screen at once: the store announces it', async () => {
  clock = T;
  const b = backend();
  let full = false;
  b.set = (k, v) => { if (full && k === 'smokebox.v1.state') return false; b.m.set(k, JSON.stringify(v)); return true; };
  start(b);
  let hits = 0;
  const off = S.subscribe(() => { hits++; });
  try {
    S.dispatch('addMenuItem', { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' }); S.flush();
    await new Promise((r) => setTimeout(r, 30)); hits = 0;
    full = true; S.dispatch('addMenuItem', { name: 'Cake', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' });
    await new Promise((r) => setTimeout(r, 30)); hits = 0;
    S.flush();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(S.status().lastSaveOk, false); assert.ok(hits >= 1, 'subscribers were told about the failed save');
    hits = 0; full = false; S.flush();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(S.status().lastSaveOk, true); assert.ok(hits >= 1, 'and about the recovery');
  } finally { off(); S.destroy(); }
});

/* ---------------- neutral starter names for a new empty kitchen ---------------- */

test('a new empty kitchen gets neutral station and section names; old kitchens, the demo and owner choices are left alone', () => {
  const zoneNames = () => C.zones.map((z) => z.name).join('|'), catNames = () => C.categories.map((c) => c.name).join('|');
  const orig = [zoneNames(), catNames()];
  clock = T;
  try {
    const b = backend(); start(b);
    assert.equal(S.applyStarterNames(), true);
    assert.equal(zoneNames(), 'Kitchen|Prep|Fryer|Cold and drinks|Expo');
    assert.equal(catNames(), 'Mains|Sides|Snacks|Desserts|Cold food and drinks');
    assert.deepEqual(C.zones.map((z) => z.id), ['pit', 'sides', 'fry', 'cold', 'expo']);                 // ids never change
    assert.equal(C.zoneById.pit.code, 'KIT');
    assert.deepEqual(JSON.parse(S.exportAll()).names, S.STARTER_NAMES);                                   // saved with the kitchen and carried in backups
    assert.equal(S.applyStarterNames(), false);                                                           // once only
    assert.equal(S.dispatch('addMenuItem', { name: 'Slice', zone: 'pit', cat: 'meat', price: 4, prepSec: 60, track: 'one' }), 'ok');
    S.destroy(); cleanNames();
    // a kitchen with dishes, an old kitchen, the demo, and a kitchen whose owner chose names
    const withDish = backend(); start(withDish); S.dispatch('addMenuItem', { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' });
    assert.equal(S.applyStarterNames(), false); S.destroy();
    start(backend(), 'real', { blank: false, starter: true }); assert.equal(S.applyStarterNames(), false); S.destroy();
    start(backend(), 'demo'); assert.equal(S.applyStarterNames(), false); S.destroy();
    assert.deepEqual([zoneNames(), catNames()], orig);
    const mine = { rename: { zones: { pit: 'Smoker' } }, add: {} }; C.applyCustom(mine); C.saveCustom(mine);
    start(backend()); assert.equal(S.applyStarterNames(), false); assert.equal(C.zoneById.pit.name, 'Smoker'); S.destroy();
    cleanNames();
    // start over with settings reset puts the neutral names back instead of the barbecue ones
    const b2 = backend(); busyKitchen(b2);
    assert.equal(S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD, keepSettings: false }).ok, true);
    assert.equal(zoneNames(), 'Kitchen|Prep|Fryer|Cold and drinks|Expo'); S.destroy();
    cleanNames();
    const b3 = backend(); busyKitchen(b3);
    S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD, keepSettings: true });
    assert.equal(C.zoneById.pit.name, 'Smoker'); S.destroy();                                            // kept names stay
  } finally { cleanNames(); }
  assert.deepEqual([zoneNames(), catNames()], orig);
});

test('quick start over: a kitchen with only dishes starts over in one step; any ticket, order or batch needs the careful steps', () => {
  clock = T;
  try {
    // Only dishes: no word, no backup file, and it works.
    const b = backend(); start(b);
    assert.equal(S.nothingToLose(), true);                                                              // nothing at all
    assert.equal(S.dispatch('addMenuItem', { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' }), 'ok');
    assert.equal(S.nothingToLose(), true);                                                              // dishes only
    const r = S.startOver({ quick: true });
    assert.equal(r.ok, true, r.report);
    assert.equal(S.getState().menu.length, 0);
    assert.ok(r.backup && r.backup.chars > 0);                                                          // a copy is still offered, never forced
    S.destroy(); cleanNames();
    // One ticket: quick is refused, nothing changes, and the full flow still works.
    const b2 = backend(); start(b2);
    S.dispatch('addMenuItem', { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' });
    S.dispatch('createTicket', { customer: 'Ann', channel: 'dine_in', items: [{ menuId: S.getState().menu[0].id, qty: 1 }] });
    assert.equal(S.nothingToLose(), false);
    const before = body(S.getState());
    const q = S.startOver({ quick: true });
    assert.deepEqual([q.ok, q.report], [false, 'backupRequired']);
    assert.equal(body(S.getState()), before);
    assert.equal(S.startOver({ quick: true, confirm: WORD }).report, 'backupRequired');               // the word alone is not enough
    assert.equal(S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: WORD }).ok, true);
    S.destroy(); cleanNames();
    // A busy kitchen has plenty to lose; the demo never starts over.
    const b3 = backend(); busyKitchen(b3);
    assert.equal(S.nothingToLose(), false); assert.equal(S.startOver({ quick: true }).ok, false);
    S.destroy(); cleanNames();
    start(backend(), 'demo'); assert.equal(S.nothingToLose(), false); assert.equal(S.startOver({ quick: true }).report, 'notInDemo'); S.destroy();
  } finally { cleanNames(); }
});
