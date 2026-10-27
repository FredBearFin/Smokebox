// Wall mode orders pane: the open and paid order lists. (The glance panel has its own tests in glance.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '25-deadlines']);
const E = SB.engine, D = SB.deadlines;
const T0 = Date.UTC(2026, 9, 12, 16, 0, 0), MIN = 60e3;

test('orders pane: an empty kitchen has no orders', () => {
  const s = E.newState({ now: T0, empty: true });
  assert.deepEqual(D.wallOrders(s, T0), { paidCount: 0, open: [], paid: [] });
});

test('orders pane: an open order is listed with its rounds and total, then moves to the paid list when paid', () => {
  let s = E.newState({ now: T0, stagger: true });
  const mi = SB.config.menu.slice(0, 1).map((m) => ({ menuId: m.id, qty: 1 }));
  let r = E.apply(s, 'createTicket', { customer: 'Table 9', channel: 'dine_in', items: mi }, T0 + MIN);
  assert.equal(r.report, 'ok'); s = r.state;
  let g = D.wallOrders(s, T0 + 2 * MIN);
  assert.equal(g.open.length, 1); assert.equal(g.open[0].name, 'Table 9'); assert.equal(g.open[0].rounds, 1); assert.ok(g.open[0].total > 0);
  r = E.apply(s, 'payOrder', { orderId: s.orders[0].id, method: 'cash' }, T0 + 3 * MIN);
  assert.equal(r.report, 'ok'); s = r.state;
  g = D.wallOrders(s, T0 + 4 * MIN);
  assert.equal(g.open.length, 0); assert.equal(g.paid.length, 1); assert.equal(g.paidCount, 1);
  assert.equal(g.paid[0].total, s.orders[0].totals.total);
});

test('orders pane: an order paid on an earlier service day is not listed', () => {
  let s = E.newState({ now: T0, stagger: true });
  const mi = SB.config.menu.slice(0, 1).map((m) => ({ menuId: m.id, qty: 1 }));
  s = E.apply(s, 'createTicket', { customer: 'Old', channel: 'dine_in', items: mi }, T0 + MIN).state;
  s = E.apply(s, 'payOrder', { orderId: s.orders[0].id, method: 'cash' }, T0 + 2 * MIN).state;
  assert.equal(D.wallOrders(s, T0 + 48 * 60 * MIN).paidCount, 0);
});

test('orders pane: an order opened yesterday and paid today counts as paid today (by the time it was paid)', () => {
  let s = E.newState({ now: T0, stagger: true });
  const mi = SB.config.menu.slice(0, 1).map((m) => ({ menuId: m.id, qty: 1 }));
  s = E.apply(s, 'createTicket', { customer: 'Late tab', channel: 'dine_in', items: mi }, T0 + MIN).state;
  const payAt = T0 + 26 * 60 * MIN; // the next service day
  const r = E.apply(s, 'payOrder', { orderId: s.orders[0].id, method: 'cash' }, payAt);
  assert.equal(r.report, 'ok'); s = r.state;
  assert.notEqual(s.orders[0].serviceDate, SB.util.serviceDate(payAt, s.settings.service.dayStartHour));
  const g = D.wallOrders(s, payAt + MIN);
  assert.equal(g.paidCount, 1); assert.equal(g.paid[0].name, 'Late tab');
});

test('orders pane: a tab opened yesterday and paid today counts as paid today, like close-the-day', () => {
  let s = E.newState({ now: T0, stagger: true });
  const mi = SB.config.menu.slice(0, 1).map((m) => ({ menuId: m.id, qty: 1 }));
  s = E.apply(s, 'createTicket', { customer: 'Late tab', channel: 'dine_in', items: mi }, T0 + MIN).state;
  const r = E.apply(s, 'payOrder', { orderId: s.orders[0].id, method: 'cash' }, T0 + 24 * 60 * MIN);
  assert.equal(r.report, 'ok'); s = r.state;
  const g = D.wallOrders(s, T0 + 24 * 60 * MIN + MIN);
  assert.equal(g.paidCount, 1, 'paid today, opened yesterday');
  assert.equal(D.wallOrders(s, T0 + 2 * MIN).paidCount, 0, 'not on the day it was opened');
});
