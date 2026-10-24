// Clean start: a brand-new install is an empty kitchen (no dishes, ingredients, prices or stock), marked catalog 'own'.
// Old saves, the barbecue demo and backups must behave exactly as before. A dish with no recipe records no cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store', '40-metrics']);
const { engine: E, store: S, metrics: M } = SB;
const T = 1780326000000;
const pie = { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' };
const mem = () => { const m = new Map(); return { persistent: true, m, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), set: (k, v) => { m.set(k, JSON.stringify(v)); return true; }, raw: (k) => (m.has(k) ? m.get(k) : null), remove: (k) => { m.delete(k); } }; };
const boot = (storage, o) => S.init(Object.assign({ storage, noTimers: true, noSync: true, now: () => T }, o));

test('a blank state is empty, healthy and marked', () => {
  const b = E.newState({ now: T, blank: true });
  assert.deepEqual([b.menu.length, b.ingredients.length, b.batches.length, b.tickets.length, b.orders.length], [0, 0, 0, 0, 0]);
  assert.deepEqual(b.stock, {}); assert.deepEqual(b.avail, {}); assert.deepEqual(b.ledger, {});
  assert.equal(b.catalog, 'own');
  assert.equal(b.settings.service.taxRatePct, 0);
  assert.equal(b.settings.pacing.enabled, true);   // the timing engine is on from the start
  assert.deepEqual(b.settings.modules, { cookAhead: false });
  assert.deepEqual(E.checkInvariants(b, T), []);
  assert.equal(JSON.stringify(b).indexOf('brisket'), -1);
});

test('the module switch: absent means on, only an explicit false is off', () => {
  assert.equal(E.moduleOn(E.newState({ now: T }), 'cookAhead'), true);
  assert.equal(E.moduleOn(E.newState({ now: T, blank: true }), 'cookAhead'), false);
  assert.equal(E.moduleOn(null, 'cookAhead'), true);
});

test('a blank save round-trips with no repairs and the sample is not put back', () => {
  let b = E.newState({ now: T, blank: true });
  let v = E.validateBackup(E.serialize(b));
  assert.equal(v.ok, true); assert.deepEqual(v.repaired, []);
  assert.deepEqual([v.state.menu.length, v.state.ingredients.length, v.state.catalog], [0, 0, 'own']);
  assert.deepEqual(v.state.settings.modules, { cookAhead: false });
  b = E.apply(b, 'addMenuItem', pie, T).state;
  v = E.validateBackup(E.serialize(b));
  assert.deepEqual(v.repaired, []); assert.equal(v.state.menu.length, 1);
});

test('an old-style save with an empty menu still gets the sample back (unchanged repair)', () => {
  const old = E.newState({ now: T, menu: [], ingredients: [] });
  const v = E.validateBackup(E.serialize(old));
  assert.equal(v.state.menu.length, 21); assert.equal(v.state.ingredients.length, 15);
  assert.equal(v.state.catalog, undefined);
});

test('settings accept the modules switch and a save without it still loads', () => {
  const r = E.apply(E.newState({ now: T }), 'updateSettings', { patch: { modules: { cookAhead: false } } }, T);
  assert.equal(r.report, 'ok');
  const v = E.validateBackup(E.serialize(r.state));
  assert.deepEqual(v.repaired, []); assert.deepEqual(v.state.settings.modules, { cookAhead: false });
  assert.equal(E.apply(E.newState({ now: T }), 'updateSettings', { patch: { modules: { other: true } } }, T).report, 'badPatch');
});

test('a dish with no recipe records no cost, and the analytics skip it', () => {
  let s = E.apply(E.newState({ now: T, blank: true }), 'addMenuItem', pie, T).state;
  s = E.apply(s, 'createTicket', { customer: 'a', channel: 'dine_in', items: [{ menuId: 'pie', qty: 1 }] }, T + 1000).state;
  s = E.tick(s, T + 100e3).state;
  const ti = s.tickets[0];
  s = E.apply(s, 'completeItem', { ticketId: ti.id, itemId: ti.items[0].id }, T + 101e3).state;
  const it = s.tickets[0].items[0];
  assert.equal(it.status, 'done'); assert.equal('cost' in it, false);
  assert.equal(E.allEvents(s).find((e) => e.type === 'item_done').cost, undefined);
  assert.deepEqual(E.checkInvariants(s, T + 101e3), []);
  const ds = { tickets: s.tickets, orders: s.orders, events: E.allEvents(s), batches: s.batches, learned: s.learned, menu: s.menu, ingredients: s.ingredients, settings: s.settings, range: { from: T - 864e5, to: T + 864e5 } };
  const f = M.foodCostPct(ds, { from: T - 864e5, to: T + 864e5 });
  assert.equal(f.costPct, null); assert.equal(f.coverage, 0);
  const row = M.byItem(ds, { from: T - 864e5, to: T + 864e5 })[0];
  assert.equal(row.cost, null); assert.equal(row.margin, null);
});

test('a dish whose ingredient has no cost records no cost; priced dishes still record one', () => {
  let s = E.newState({ now: T });
  const noCost = s.ingredients.map((i) => (i.id === 'tea' ? Object.assign({}, i, { costPerKg: undefined }) : i));
  const run = (st, id) => {
    let x = E.apply(st, 'createTicket', { customer: 'a', channel: 'dine_in', items: [{ menuId: id, qty: 1 }] }, T + 1000).state;
    x = E.tick(x, T + 100e3).state; const t = x.tickets[0];
    return E.apply(x, 'completeItem', { ticketId: t.id, itemId: t.items[0].id }, T + 101e3).state.tickets[0].items[0];
  };
  assert.equal('cost' in run(Object.assign({}, s, { ingredients: noCost }), 'tea'), false);
  assert.ok(run(s, 'tea').cost > 0);
});

test('resetLive can load the sample catalog; it protects an owner kitchen that has dishes', () => {
  const empty = E.newState({ now: T, blank: true });
  let r = E.apply(empty, 'resetLive', { keepSettings: true, starter: true, stagger: true, catalog: 'sample' }, T);
  assert.equal(r.report, 'ok');
  assert.deepEqual([r.state.menu.length, r.state.ingredients.length, r.state.batches.length, r.state.catalog], [21, 15, 10, undefined]);
  assert.equal(E.moduleOn(r.state, 'cookAhead'), true);
  assert.deepEqual(E.checkInvariants(r.state, T), []);
  const mine = E.apply(empty, 'addMenuItem', pie, T).state;
  assert.equal(E.apply(mine, 'resetLive', { catalog: 'sample' }, T).report, 'badPatch');
  assert.equal(E.apply(mine, 'resetLive', { catalog: 'sample', replaceOwn: true }, T).report, 'ok');
  assert.equal(E.apply(mine, 'resetLive', { catalog: 'bogus' }, T).report, 'badPatch');
  // a plain reset of an owner kitchen stays an owner kitchen; 'blank' empties an old kitchen
  const keep = E.apply(mine, 'resetLive', {}, T).state;
  assert.deepEqual([keep.menu.length, keep.catalog], [1, 'own']);
  const toBlank = E.apply(E.newState({ now: T }), 'resetLive', { catalog: 'blank' }, T).state;
  assert.deepEqual([toBlank.menu.length, toBlank.ingredients.length, toBlank.catalog, toBlank.settings.modules], [0, 0, 'own', { cookAhead: false }]);
});

test('Sim.restartDemo-style sample load leaves the barbecue demo as before', () => {
  const viaSample = E.apply(E.newState({ now: T }), 'resetLive', { keepSettings: true, starter: true, stagger: true, catalog: 'sample' }, T).state;
  const viaOld = E.apply(E.newState({ now: T }), 'resetLive', { keepSettings: true, starter: true, stagger: true }, T).state;
  assert.equal(JSON.stringify(viaSample), JSON.stringify(viaOld));
});

test('store: a brand-new install with blank:true starts empty and writes nothing until used', () => {
  const st = mem();
  const status = boot(st, { blank: true });
  assert.equal(status.firstRun, true);
  assert.equal(S.isBlank(), true); assert.equal(S.isOwn(), true);
  assert.deepEqual([S.getState().menu.length, S.getState().ingredients.length], [0, 0]);
  assert.equal(st.m.size, 0);
  assert.equal(S.dispatch('addMenuItem', pie), 'ok');
  assert.equal(S.isBlank(), false); assert.equal(S.isOwn(), true);
  S.flush();
  S.destroy();
  // a reload keeps the one dish and does not put the sample back
  const again = boot(st, { blank: true });
  assert.equal(again.firstRun, false); assert.deepEqual(again.repaired, []);
  assert.equal(S.getState().menu.length, 1);
  assert.equal(S.getState().ingredients.length, 0);
  // reset of an owner kitchen gives an empty owner kitchen
  S.reset();
  assert.deepEqual([S.getState().menu.length, S.getState().catalog], [0, 'own']);
  S.destroy();
});

test('store: init without blank is unchanged, and saved data always wins over blank', () => {
  const st = mem();
  boot(st);
  assert.equal(S.getState().menu.length, 21); assert.equal(S.isBlank(), false); assert.equal(S.isOwn(), false);
  S.dispatch('updateMenuItem', { id: 'tea', patch: { price: 4.25 } });
  S.flush(); S.destroy();
  boot(st, { blank: true });
  assert.equal(S.getState().menu.length, 21);
  assert.equal(S.getState().menu.find((m) => m.id === 'tea').price, 4.25);
  assert.equal(S.isBlank(), false);
  S.destroy();
});
