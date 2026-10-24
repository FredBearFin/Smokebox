// Second review round, engine and store: unknown costs stay unknown (never $0), finished tickets on an open check survive the
// ticket cap, and the other engine and store fixes from the same round. Each test names the finding it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine']);
const E = SB.engine;
const T0 = new Date(2026, 9, 20, 12, 0, 0).getTime(), H = 3600e3, MIN = 60e3;

// A blank kitchen plus a helper that applies one action a second later and keeps the new state when it works.
function kitchen(opts) {
  const k = { now: T0, s: E.newState(Object.assign({ now: T0, blank: true }, opts || {})) };
  k.go = (type, p, at) => { k.now = at != null ? at : k.now + 1000; const r = E.apply(k.s, type, p, k.now, {}); if (r.report === 'ok') k.s = r.state; return r; };
  return k;
}

test('Ada 3: a batch logged by raw weight for an ingredient with no price keeps no cost, and its discard records no cost', () => {
  const k = kitchen();
  assert.equal(k.go('updateSettings', { patch: { modules: { cookAhead: true } } }).report, 'ok');
  const r = k.go('addIngredient', { name: 'Mystery pork', tcs: true, hold: 'hot' });
  assert.equal(r.report, 'ok', JSON.stringify(r.info));
  const ing = k.s.ingredients.find((i) => i.name === 'Mystery pork');
  assert.equal(ing.costPerKg, undefined);
  const b = k.go('addBatch', { ing: ing.id, rawG: 4000, cookedG: 2400, tempF: 165 });
  assert.equal(b.report, 'ok', JSON.stringify(b.info));
  const batch = k.s.batches.find((x) => x.id === b.info.batchId);
  assert.equal(batch.costPerCookedKg, undefined, 'unknown, not $0');
  const d = k.go('discardBatch', { batchId: batch.id, reason: 'manual' });
  assert.equal(d.report, 'ok', JSON.stringify(d.info));
  const ev = E.allEvents(k.s).filter((e) => e.type === 'batch_discard').pop();
  assert.ok(ev, 'a discard event is logged');
  assert.equal(ev.cost, undefined, 'the thrown-out food has no made-up $0 cost');
});

test('Ada 3: with a price per kg, the raw-weight cost is still worked out', () => {
  const k = kitchen();
  k.go('updateSettings', { patch: { modules: { cookAhead: true } } });
  k.go('addIngredient', { name: 'Priced pork', tcs: true, hold: 'hot', costPerKg: 10 });
  const ing = k.s.ingredients.find((i) => i.name === 'Priced pork');
  const b = k.go('addBatch', { ing: ing.id, rawG: 4000, cookedG: 2000, tempF: 165 });
  assert.equal(b.report, 'ok');
  assert.equal(k.s.batches.find((x) => x.id === b.info.batchId).costPerCookedKg, 20);
});

test('Ada 4: the ticket cap never drops a finished round of an order that is still open', () => {
  const old = SB.config.limits.maxTickets, oldO = SB.config.limits.maxOrders;
  SB.config.limits.maxTickets = 20; SB.config.limits.maxOrders = 200;
  try {
    const k = kitchen();
    k.go('updateSettings', { patch: { service: { counter: true } } });
    const dish = k.go('addMenuItem', { name: 'Plain', zone: 'pit', cat: 'meat', price: 5, prepSec: 60, track: 'one', prepGuess: false }).info.id;
    const first = k.go('createTicket', { customer: 'Tab', items: [{ menuId: dish }] });
    assert.equal(first.report, 'ok');
    assert.equal(k.go('bumpTicket', { ticketId: first.info.ticketId, force: true }).report, 'ok');
    const orderId = first.info.orderId;
    const before = E.orderTotals(k.s, k.s.orders.find((o) => o.id === orderId)).total;
    for (let i = 0; i < 40; i++) assert.equal(k.go('createTicket', { customer: 'C' + i, items: [{ menuId: dish }], pay: { method: 'cash' } }).report, 'ok');
    assert.ok(k.s.tickets.length <= 21, 'the cap still trims paid tickets');
    assert.ok(k.s.tickets.some((t) => t.id === first.info.ticketId), 'the open check keeps its finished round');
    assert.equal(E.orderTotals(k.s, k.s.orders.find((o) => o.id === orderId)).total, before);
  } finally { SB.config.limits.maxTickets = old; SB.config.limits.maxOrders = oldO; }
});

test('Ada 4: when every order stays open (payment taken elsewhere), the ticket cap still holds', () => {
  const old = SB.config.limits.maxTickets, oldO = SB.config.limits.maxOrders;
  SB.config.limits.maxTickets = 20; SB.config.limits.maxOrders = 200;
  try {
    const k = kitchen();
    const dish = k.go('addMenuItem', { name: 'Plain', zone: 'pit', cat: 'meat', price: 5, prepSec: 60, track: 'one', prepGuess: false }).info.id;
    for (let i = 0; i < 60; i++) {
      const t = k.go('createTicket', { customer: 'C' + i, items: [{ menuId: dish }] });
      assert.equal(t.report, 'ok');
      assert.equal(k.go('bumpTicket', { ticketId: t.info.ticketId, force: true }).report, 'ok');
    }
    assert.ok(k.s.tickets.length <= 20, 'got ' + k.s.tickets.length);
  } finally { SB.config.limits.maxTickets = old; SB.config.limits.maxOrders = oldO; }
});

test('Ada 5: finishing a line whose dish is missing from the menu records no cost, not $0', () => {
  const k = kitchen();
  const dish = k.go('addMenuItem', { name: 'Plain', zone: 'pit', cat: 'meat', price: 5, prepSec: 60, track: 'one', prepGuess: false }).info.id;
  const t = k.go('createTicket', { customer: 'A', items: [{ menuId: dish }] });
  assert.equal(t.report, 'ok');
  // A save where the dish has gone (for example a hand-edited backup): the ticket still points at it.
  const s = JSON.parse(JSON.stringify(k.s));
  s.menu = s.menu.filter((m) => m.id !== dish);
  k.s = s;
  const tk = k.s.tickets.find((x) => x.id === t.info.ticketId);
  const r = k.go('completeItem', { ticketId: tk.id, itemId: tk.items[0].id });
  assert.equal(r.report, 'ok', JSON.stringify(r.info));
  const it = k.s.tickets.find((x) => x.id === tk.id).items[0];
  assert.equal(it.status, 'done');
  assert.equal(it.cost, undefined);
});

// One ribs batch (4-hour quality limit, 12-hour hard cap) with a fresh good reading copied in at `at`, and no tick since it was made.
function ribsAt(at) {
  let s = E.newState({ now: T0, empty: true });
  s = E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T0).state;
  s = JSON.parse(JSON.stringify(s));
  const b = s.batches[0];
  b.lastTempAt = at - MIN; b.lastTempF = 160;
  return { s, id: b.id };
}

test('Bram 9: keep serving is refused once the hard cap has passed, even before a tick has thrown the batch out', () => {
  const { s, id } = ribsAt(T0 + 12 * H + 5 * MIN);
  const r = E.apply(s, 'keepServing', { batchIds: [id], who: 'AB' }, T0 + 12 * H + 5 * MIN, {});
  assert.equal(r.report, 'batchNotServable');
  assert.ok(!(r.events || []).some((e) => e.type === 'quality_extend'), 'no extension is logged');
  // control: inside the hard cap it still works
  const ok = ribsAt(T0 + 5 * H);
  assert.equal(E.apply(ok.s, 'keepServing', { batchIds: [ok.id], who: 'AB' }, T0 + 5 * H, {}).report, 'ok');
});

test('Bram 3: a cooling batch is never kept serving, even when a save gives it a quality limit', () => {
  const { s, id } = ribsAt(T0 + 5 * H);
  s.batches[0].kind = 'cooling';
  const r = E.apply(s, 'keepServing', { batchIds: [id], who: 'AB' }, T0 + 5 * H, {});
  assert.equal(r.report, 'qualityNotDue');
});

test('Bram 8: an empty pan cannot be discarded, so no 0 g waste entry is logged', () => {
  const { s, id } = ribsAt(T0 + 2 * H);
  s.batches[0].remainingG = 0;
  const r = E.apply(s, 'discardBatch', { batchId: id, reason: 'manual' }, T0 + 2 * H, {});
  assert.equal(r.report, 'nothingToDo');
  assert.match(E.describe(r.report, r.info), /already empty/);
});

test('Bram 4: a warm cooler or freezer and a thermometer that reads wrong are logged and flagged, never refused', () => {
  const s = E.newState({ now: T0, empty: true });
  const one = (type, p) => { const r = E.apply(s, type, p, T0, {}); assert.equal(r.report, 'ok', r.report); return { info: r.info, ev: r.events.find((e) => e.type === (type === 'logEquipmentTemp' ? 'equip_temp' : 'thermometer_checked')) }; };
  let r = one('logEquipmentTemp', { unit: 'cooler', f: 60 });
  assert.deepEqual([r.ev.outOfRange, r.ev.maxF, r.info.outOfRange], [true, 41, true]);
  r = one('logEquipmentTemp', { unit: 'cooler', f: 41 });
  assert.equal(r.ev.outOfRange, undefined, '41 F is in range');
  r = one('logEquipmentTemp', { unit: 'freezer', f: 12 });
  assert.deepEqual([r.ev.outOfRange, r.ev.maxF], [true, 0]);
  assert.equal(one('logEquipmentTemp', { unit: 'other', f: 150 }).ev.outOfRange, undefined, 'an unknown unit has no limit');
  r = one('logThermometerCheck', { f: 58, method: 'ice' });
  assert.deepEqual([r.ev.outOfRange, r.ev.expectF, r.info.outOfRange], [true, 32, true]);
  assert.equal(one('logThermometerCheck', { f: 33.5, method: 'ice' }).ev.outOfRange, undefined);
  assert.equal(one('logThermometerCheck', { f: 210, method: 'boiling' }).ev.outOfRange, undefined);
  assert.equal(one('logThermometerCheck', { f: 205, method: 'boiling' }).ev.expectF, 212);
  assert.equal(one('logThermometerCheck', { f: 120, method: 'other' }).ev.outOfRange, undefined);
});

test('Bram 7: a restore never trusts a servable flag that is not a real true, or that the batch\'s own readings contradict', () => {
  const a = ribsAt(T0 + 2 * H);
  a.s.batches[0].canServe = 'false';
  const va = E.validateBackup(JSON.stringify(a.s));
  assert.equal(va.ok, true, va.error);
  assert.equal(va.state.batches[0].canServe, false, 'the text "false" is not servable');
  // below 135 F since hour 1, last reading at hour 4: past the 2-hour grace at its own last reading, yet stored as servable
  const b = ribsAt(T0 + 4 * H);
  Object.assign(b.s.batches[0], { outSince: T0 + H, lastTempF: 120, canServe: true, status: 'ok', action: 'NONE' });
  const vb = E.validateBackup(JSON.stringify(b.s));
  assert.equal(vb.ok, true, vb.error);
  assert.equal(vb.state.batches[0].canServe, false);
  assert.ok(vb.repaired.some((x) => /taken off the menu/.test(x)));
  // a healthy batch keeps its flag and no repair is listed
  const c = ribsAt(T0 + 2 * H);
  const vc = E.validateBackup(JSON.stringify(c.s));
  assert.equal(vc.state.batches[0].canServe, true);
  assert.ok(!vc.repaired.some((x) => /taken off the menu/.test(x)));
});

test('Bram 11: closing the month never removes the old events of a ticket that stays (recalled after payment and still on the board)', () => {
  let now = new Date(2026, 7, 1, 11, 0, 0).getTime();
  let s = E.newState({ now, blank: true });
  const go = (type, p) => { now += 1000; const r = E.apply(s, type, p, now); assert.equal(r.report, 'ok', type + ' ' + r.report); s = r.state; return r; };
  const dish = go('addMenuItem', { name: 'Plain', zone: 'pit', cat: 'meat', price: 5, prepSec: 60, track: 'one', prepGuess: false }).info.id;
  const t = go('createTicket', { customer: 'A', items: [{ menuId: dish }] });
  go('bumpTicket', { ticketId: t.info.ticketId, force: true });
  go('payOrder', { orderId: t.info.orderId, method: 'cash' });
  go('recallTicket', { ticketId: t.info.ticketId });
  go('closeDay', {});
  const p = E.monthPlan(s, { before: '2026-12-01', keepDays: 5 }, now + 60 * 24 * H);
  assert.equal(p.ok, true);
  assert.ok(!p.plan.ticketIds.has(t.info.ticketId), 'the live ticket stays');
  const gone = E.allEvents(s).filter((e) => p.plan.eventIds.has(e.id) && e.ticketId === t.info.ticketId);
  assert.deepEqual(gone.map((e) => e.type), [], 'and so do its events');
});

test('Esme 2: a future-dated event never moves the 400-day safety cut forward when old events are trimmed', () => {
  let s = E.newState({ now: T0, empty: true });
  const go = (type, p, at) => { const r = E.apply(s, type, p, at, {}); assert.equal(r.report, 'ok', r.report); s = r.state; };
  go('sanitizeDone', { who: 'AB' }, T0);
  go('logEquipmentTemp', { unit: 'cooler', f: 38 }, T0 + MIN);
  go('sanitizeDone', { who: 'AB' }, T0 + 500 * 24 * H);           // the device clock was set far ahead for this one
  const kept = (st) => (st.safetyKeep || []).filter((e) => e.t < T0 + H).length;
  assert.equal(kept(E.prune(s, { maxEvents: 1, now: T0 + 24 * H })), 2, 'the real time decides what is 400 days old');
  // control: with no time given, the old reference (the newest event) still applies
  assert.equal(kept(E.prune(s, { maxEvents: 1 })), 0);
});
