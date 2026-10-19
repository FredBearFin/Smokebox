// Two-tap ticket tests: Start re-times the plan, Release finishes and bumps, Undo restores both.
// Run: node tools/test.mjs twotap
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine']);
const E = SB.engine;
const T0 = new Date(2026, 9, 17, 12, 0, 0).getTime();
const SEC = 1000;

/** Keeps a state and a clock; checks the invariants after every step. */
class K {
  constructor() { this.s = E.newState({ now: T0 }); this.now = T0; }
  at(t) { this.now = t; return this; }
  do(type, payload, expect = 'ok') {
    const r = E.apply(this.s, type, payload, this.now);
    assert.equal(r.report, expect, `${type} -> ${r.report} ${JSON.stringify(r.info)}`);
    if (r.report === 'ok') this.s = r.state;
    assert.deepEqual(E.checkInvariants(this.s, this.now), []);
    return r;
  }
  tick(t) { this.now = t; this.s = E.tick(this.s, t).state; assert.deepEqual(E.checkInvariants(this.s, t), []); }
  t() { return this.s.tickets.at(-1); }
}
const order = [{ menuId: 'brisket_half' }, { menuId: 'slaw', qty: 2 }, { menuId: 'mac' }];

test('an awaiting ticket fires nothing until Start, then the plan runs from the Start moment', () => {
  const k = new K();
  k.do('createTicket', { items: order, awaitStart: true });
  const id = k.t().id;
  assert.equal(k.t().awaitStart, true);
  k.tick(T0 + 400 * SEC);
  assert.deepEqual(k.t().items.map((i) => i.status), ['queued', 'queued', 'queued']);
  k.do('releaseTicket', { ticketId: id }, 'notStarted');
  k.at(T0 + 60 * SEC).do('startTicket', { ticketId: id });
  const t = k.t();
  assert.equal(t.awaitStart, undefined);
  assert.equal(t.startedAt, T0 + 60 * SEC);
  // offsets 180, 264, 0 seconds after the start
  assert.deepEqual(t.items.map((i) => i.fireAt - t.startedAt), [180000, 264000, 0]);
  assert.deepEqual(t.items.map((i) => i.status), ['queued', 'queued', 'displayed']);
  k.do('startTicket', { ticketId: id }, 'alreadyStarted');
  k.tick(T0 + 60 * SEC + 180000);
  assert.equal(k.t().items[0].status, 'displayed');
  assert.equal(k.t().items[1].status, 'queued');
});

test('Release finishes every item and bumps in one tap, without teaching prep times', () => {
  const k = new K();
  k.do('createTicket', { items: order, awaitStart: true });
  const id = k.t().id;
  k.at(T0 + 10 * SEC).do('startTicket', { ticketId: id });
  k.at(T0 + 400 * SEC).do('releaseTicket', { ticketId: id });
  const t = k.t();
  assert.equal(t.status, 'expedited');
  assert.equal(t.released, true);
  assert.ok(t.items.every((i) => i.status === 'done' && i.released));
  assert.deepEqual(k.s.learned, {});
  assert.ok(k.s.events.some((e) => e.type === 'ticket_released'));
  k.do('releaseTicket', { ticketId: id }, 'ticketNotActive');
});

test('Undo of Release brings the ticket back; undo of Start puts it back to waiting', () => {
  const k = new K();
  k.do('createTicket', { items: order, awaitStart: true });
  const id = k.t().id;
  const before = JSON.stringify(k.t());
  k.at(T0 + 10 * SEC).do('startTicket', { ticketId: id });
  k.at(T0 + 20 * SEC).do('releaseTicket', { ticketId: id });
  k.do('undo', {});
  assert.equal(k.t().status, 'active');
  assert.ok(k.t().items.every((i) => i.status !== 'done' && !i.released));
  k.do('undo', {});
  assert.equal(k.t().awaitStart, true);
  assert.equal(JSON.stringify(k.t()), before);
});

test('a ticket made without awaitStart behaves as before and can still be released', () => {
  const k = new K();
  k.do('createTicket', { items: order });
  assert.equal(k.t().items[2].status, 'displayed');
  k.do('startTicket', { ticketId: k.t().id }, 'alreadyStarted');
  k.at(T0 + 5 * SEC).do('releaseTicket', { ticketId: k.t().id });
  assert.equal(k.t().status, 'expedited');
});
