// Tests for the whole-kitchen planner (Rust, engine/, through SB.planner) inside the engine: with no station limits nothing
// changes; with a 2-basket fryer the third order of fries waits for a basket and its ticket's other dish waits to match; the
// voice does not call a dish while its station is full; and replaying the same actions gives the same kitchen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '25-deadlines']);
const E = SB.engine, D = SB.deadlines;
const T0 = Date.UTC(2026, 9, 24, 17, 0, 0);
const MIN = 60000;

// A blank kitchen with fries (fryer, 3 min) and a side (1 min), the timing coach on.
function kitchen(capacity) {
  let s = E.newState({ blank: true, now: T0 });
  const run = (type, payload, at) => { const r = E.apply(s, type, payload, at); assert.equal(r.report, 'ok', type + ' ' + JSON.stringify(r.info)); s = r.state; return r; };
  const fries = run('addMenuItem', { name: 'Fries', zone: 'fry', cat: 'fried', price: 4, prepSec: 180, track: 'two', prepGuess: false }, T0).info.id;
  const side = run('addMenuItem', { name: 'Slaw', zone: 'cold', cat: 'cold', price: 3, prepSec: 60, track: 'one', prepGuess: false }, T0).info.id;
  if (capacity) run('updateSettings', { patch: { capacity } }, T0);
  return { get s() { return s; }, run, fries, side };
}
// The item of a ticket (by ticket number and line number, from 1).
const item = (s, num, line) => s.tickets.find((t) => t.num === num).items[line - 1];

test('the planner is running in the engine', () => {
  assert.equal(SB.planner.ready(), true);
});

test('no station limits: tickets keep the old plan, nothing is moved or held', () => {
  const k = kitchen(null);
  for (let i = 0; i < 3; i++) k.run('createTicket', { customer: 'G' + i, items: [{ menuId: k.fries }, { menuId: k.side }] }, T0 + 1000);
  for (const t of k.s.tickets) {
    assert.equal(t.items[1].fireAt, t.createdAt + 120 * 1000, 'slaw waits 2 minutes for the fries');
    for (const it of t.items) { assert.equal(it.moved, undefined); assert.equal(it.held, undefined); assert.equal(it.freeAt, undefined); }
  }
});

test("a 2-basket fryer: the third fries wait for a basket, and that ticket's slaw waits to match", () => {
  const k = kitchen({ fry: 2 });
  for (let i = 0; i < 3; i++) k.run('createTicket', { customer: 'G' + i, items: [{ menuId: k.fries }, { menuId: k.side }] }, T0 + 1000);
  const s = k.s, t3 = s.tickets[2];
  // The third ticket's fries came due at once (its own plan) but the fryer is full until the first two are done.
  assert.equal(item(s, t3.num, 1).status, 'displayed');
  assert.equal(item(s, t3.num, 1).freeAt, T0 + 1000 + 3 * MIN);
  // Its slaw is held so both finish at 6 minutes, not 3.
  assert.equal(item(s, t3.num, 2).fireAt, T0 + 1000 + 5 * MIN);
  assert.equal(item(s, t3.num, 2).moved, true, 'moved to finish with the fries');
  assert.equal(item(s, t3.num, 2).held, undefined, 'the cold station itself is not full');
  assert.deepEqual(E.checkInvariants(s, T0 + 1000), []);
  // The voice calls the first two fries now, not the third.
  const calls = D.calloutWants(s, T0 + 2000, 'fry', 'normal').filter((c) => c.kind === 'start').map((c) => c.ticketNum);
  assert.deepEqual(calls.sort(), [s.tickets[0].num, s.tickets[1].num].sort());
});

test('starting the first fries and finishing them frees the basket for the third ticket', () => {
  const k = kitchen({ fry: 2 });
  for (let i = 0; i < 3; i++) k.run('createTicket', { customer: 'G' + i, items: [{ menuId: k.fries }, { menuId: k.side }] }, T0 + 1000);
  const [a, b, c] = k.s.tickets;
  k.run('advanceItem', { ticketId: a.id, itemId: a.items[0].id }, T0 + 5000);
  k.run('advanceItem', { ticketId: b.id, itemId: b.items[0].id }, T0 + 6000);
  // The first fries come out early, at 2 minutes: a basket is free, so the third fries can go in now.
  k.run('advanceItem', { ticketId: a.id, itemId: a.items[0].id }, T0 + 2 * MIN);
  const c1 = k.s.tickets.find((t) => t.id === c.id).items[0];
  assert.equal(c1.freeAt, T0 + 2 * MIN, 'the basket freed at 2 minutes, and that is when the call is timed from');
  const calls = D.calloutWants(k.s, T0 + 2 * MIN + 1000, 'fry', 'normal').filter((x) => x.kind === 'start').map((x) => x.ticketNum);
  assert.deepEqual(calls, [c.num]);
});

test('the same actions replayed give the same kitchen, byte for byte', () => {
  // Builds the same busy kitchen from scratch, as a server replaying a log would.
  const build = () => {
    const k = kitchen({ fry: 2, cold: 1 });
    for (let i = 0; i < 5; i++) k.run('createTicket', { customer: 'G' + i, items: [{ menuId: k.fries, qty: 1 + (i % 2) }, { menuId: k.side }] }, T0 + 1000 + i * 7000);
    const t = k.s.tickets[0];
    k.run('advanceItem', { ticketId: t.id, itemId: t.items[0].id }, T0 + 40000);
    return E.serialize(k.s);
  };
  assert.equal(build(), build());
});

test('a backup with planned moves loads back with no repairs', () => {
  const k = kitchen({ fry: 1 });
  for (let i = 0; i < 3; i++) k.run('createTicket', { customer: 'G' + i, items: [{ menuId: k.fries }, { menuId: k.side }] }, T0 + 1000);
  const v = E.validateBackup(JSON.parse(E.serialize(k.s)));
  assert.equal(v.ok, true);
  assert.deepEqual(v.repaired, []);
});

test('station limits are checked: known stations, whole numbers 0 to 50', () => {
  const k = kitchen(null);
  assert.equal(E.apply(k.s, 'updateSettings', { patch: { capacity: { nowhere: 2 } } }, T0).report, 'badPatch');
  assert.equal(E.apply(k.s, 'updateSettings', { patch: { capacity: { fry: 51 } } }, T0).report, 'outOfBounds');
  assert.equal(E.apply(k.s, 'updateSettings', { patch: { capacity: { fry: 1.5 } } }, T0).report, 'outOfBounds');
  assert.equal(E.apply(k.s, 'updateMenuItem', { id: k.fries, patch: { perSlot: 4 } }, T0).report, 'ok');
});
