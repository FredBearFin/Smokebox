// Back office frame helpers that run without a browser: the single-day range and the day picker steps,
// including the 4 am service-day boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '40-metrics', '80-office-core']);
const P = SB.office.pure, U = SB.util;
const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0).getTime();

test('dayRange covers one service day from 4 am to 4 am', () => {
  const r = P.dayRange('2026-10-16', 4);
  assert.ok(r.ok);
  assert.equal(r.range.id, 'day');
  assert.equal(r.range.fromKey, '2026-10-16');
  assert.equal(r.range.toKey, '2026-10-16');
  assert.equal(r.range.from, at(2026, 10, 16, 4));
  assert.equal(r.range.to, at(2026, 10, 17, 4));
});

test('a sale at 1 am Saturday falls inside Friday, not Saturday', () => {
  const fri = P.dayRange('2026-10-16', 4).range, sat = P.dayRange('2026-10-17', 4).range;
  const late = at(2026, 10, 17, 1, 30);
  assert.ok(late >= fri.from && late < fri.to);
  assert.ok(!(late >= sat.from && late < sat.to));
  // half open: exactly 4 am belongs to the new day
  assert.ok(at(2026, 10, 17, 4) >= sat.from && at(2026, 10, 17, 4) < sat.to);
  assert.ok(!(at(2026, 10, 17, 4) < fri.to));
});

test('day ranges honor a different start hour', () => {
  const r = P.dayRange('2026-10-16', 6).range;
  assert.equal(r.from, at(2026, 10, 16, 6));
  assert.equal(r.to, at(2026, 10, 17, 6));
});

test('a range that matches rangePresets Today at 1 am has the same bounds as the day picker', () => {
  const now = at(2026, 10, 17, 1, 0); // still Friday's service day
  const today = SB.metrics.rangePresets(now, 4).find((x) => x.id === 'today');
  assert.equal(today.fromKey, '2026-10-16');
  const d = P.dayRange(U.serviceDate(now, 4), 4).range;
  assert.equal(d.from, today.from);
  assert.equal(d.to, today.to);
});

test('the day across a daylight saving change is still 23 or 25 hours long, never skipped', () => {
  const r = P.dayRange('2026-11-01', 4).range; // US clocks fall back on Nov 1 2026
  const hours = (r.to - r.from) / 36e5;
  assert.ok(hours === 24 || hours === 25 || hours === 23, String(hours));
  assert.equal(P.dayRange('2026-11-02', 4).range.from, r.to);
});

test('stepDayKey steps back freely and never past today', () => {
  assert.equal(P.stepDayKey('2026-10-16', -1, '2026-10-16'), '2026-10-15');
  assert.equal(P.stepDayKey('2026-10-16', 1, '2026-10-16'), null);
  assert.equal(P.stepDayKey('2026-10-15', 1, '2026-10-16'), '2026-10-16');
  assert.equal(P.stepDayKey('2026-03-01', -1, '2026-10-16'), '2026-02-28');
  assert.equal(P.stepDayKey('nonsense', -1, '2026-10-16'), null);
});

test('pickerKey shows the last day of a range and never a future day', () => {
  assert.equal(P.pickerKey({ toKey: '2026-10-14' }, '2026-10-16'), '2026-10-14');
  assert.equal(P.pickerKey({ toKey: '2026-10-20' }, '2026-10-16'), '2026-10-16');
  assert.equal(P.pickerKey(null, '2026-10-16'), '2026-10-16');
});

test('coachText tells a brand-new kitchen what to do first on every data page', () => {
  const fresh = { anyLive: false, tickets: 0, batches: 0, records: 0, label: 'Today' };
  assert.match(P.coachText('pace', fresh).title, /No speed numbers yet/);
  assert.match(P.coachText('tickets', fresh).body, /Take an order/);
  assert.match(P.coachText('stations', fresh).title, /No station times yet/);
  assert.notEqual(P.coachText('tickets', fresh).body, P.coachText('stations', fresh).body, 'each page has its own words');
  assert.match(P.coachText('money', fresh).body, /Orders button on the board/);
  assert.match(P.coachText('safety', fresh).title, /first batch/i);
  assert.match(P.coachText('stock', fresh).title, /first batch/i);
});

test('coachText says "pick another day" when the kitchen has data elsewhere but not in this range', () => {
  const quiet = { anyLive: true, tickets: 0, batches: 0, records: 0, label: 'Wed 10/21' };
  const c = P.coachText('money', quiet);
  assert.match(c.title, /No sales on Wed 10\/21/);
  assert.match(c.body, /arrows/);
});

test('coachText is silent when the range has data, and never mentions sample', () => {
  assert.equal(P.coachText('pace', { anyLive: true, tickets: 3 }), null);
  assert.equal(P.coachText('safety', { anyLive: true, records: 1 }), null);
  assert.equal(P.coachText('stock', { anyLive: true, batches: 1 }), null);
  assert.equal(P.coachText('data', { tickets: 0 }), null);
  for (const id of ['pace', 'money', 'safety', 'stock']) {
    for (const f of [{}, { anyLive: true }]) assert.doesNotMatch(JSON.stringify(P.coachText(id, f)), /sample/i);
  }
});

test('a discard counts as data on Sales and money, so the thrown-away ledger is not hidden', () => {
  assert.equal(P.coachText('money', { anyLive: true, tickets: 0, discards: 1 }), null);
});

test('coachText: tickets still on the line are not enough, so a page with none finished stays calm', () => {
  const waiting = P.coachText('pace', { anyLive: true, tickets: 3, finished: 0, batches: 0, records: 0 });
  assert.match(waiting.title, /No speed numbers yet/);
  assert.match(waiting.body, /not finished/);
  assert.equal(P.coachText('tickets', { anyLive: true, tickets: 3, finished: 0, onBoard: 3 }).body, '3 tickets are on the board now; they are listed here with their times once they are sent out.');
  assert.equal(P.coachText('pace', { anyLive: true, tickets: 3, finished: 2, batches: 0, records: 0 }), null);
});

test('headline numbers in other currencies are set in bold like dollars', () => {
  const parts = P.splitNumbers('You sold €1,234.50 in 3 orders and £20 of tips.').filter((x) => x.num).map((x) => x.t);
  assert.deepEqual(parts, ['€1,234.50', '3', '£20']);
  assert.deepEqual(P.splitNumbers('Sold $12.40').filter((x) => x.num).map((x) => x.t), ['$12.40']);
});
