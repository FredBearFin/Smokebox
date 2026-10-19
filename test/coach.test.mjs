// Coach tests: the plain orders the Call screen shows at each moment of a ticket's life.
// Run: node tools/test.mjs coach
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '26-coach']);
const E = SB.engine, K = SB.coach;
const T0 = new Date(2026, 9, 17, 12, 0, 0).getTime();
const SEC = 1000;
const mk = (items, awaitStart = true) => E.apply(E.newState({ now: T0 }), 'createTicket', { items, awaitStart }, T0).state;

test('a waiting ticket says Start, with a plain item list and no times', () => {
  const s = mk([{ menuId: 'hushpuppies' }, { menuId: 'tea', qty: 2 }]);
  const c = K.read(s, T0 + 5 * SEC).cards[0];
  assert.equal(c.phase, 'start');
  assert.equal(c.action.type, 'start');
  assert.equal(c.items[1].text, 'Pour 2 x Sweet tea');
});

test('after Start: wait, then put on now, then cooking, then plate and release', () => {
  let s = mk([{ menuId: 'hushpuppies' }, { menuId: 'tea' }]); // 300 s and 25 s: the tea waits 275 s
  s = E.apply(s, 'startTicket', { ticketId: s.tickets[0].id }, T0 + 10 * SEC).state;
  const at = (sec) => K.read(s, T0 + sec * SEC).cards[0];
  const a = at(11);
  assert.equal(a.phase, 'fire');
  assert.equal(a.headline, 'Drop Hush puppies in the fryer');
  assert.equal(a.action, null);
  const b = at(60);
  assert.equal(b.phase, 'run');
  assert.match(b.headline, /^In 3:45: Pour Sweet tea$/);
  const c = at(10 + 275 + 1);
  assert.equal(c.phase, 'fire');
  assert.equal(c.items.find((r) => r.menuId === 'tea').step, 'fire');
  const d = at(10 + 300 + 2);
  assert.equal(d.phase, 'plate');
  assert.equal(d.action.type, 'release');
});

test('late tickets and plates waiting for release come first', () => {
  let s = mk([{ menuId: 'tea' }]);
  s = E.apply(s, 'createTicket', { items: [{ menuId: 'mac' }], awaitStart: true }, T0 + 20 * SEC).state;
  s = E.apply(s, 'startTicket', { ticketId: s.tickets[0].id }, T0 + 21 * SEC).state;
  const list = K.read(s, T0 + 60 * SEC).cards;
  assert.deepEqual(list.map((c) => c.phase), ['plate', 'start']);
  const late = K.read(s, T0 + 900 * SEC);
  assert.equal(late.counts.late, 2);
});
