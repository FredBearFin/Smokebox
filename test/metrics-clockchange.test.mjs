// Named regression cases found by the independent re-implementation check (test/metrics-reference.test.mjs): office charts and sentences on the two
// clock-change weekends. Before the fix: a chart point at noon on 8 March showed as 11, a point at 3:30 am showed as 26.5 instead of 27.5, the
// folded day put those tickets one slot early, and two tickets in different hours counted as ONE active hour (so tickets per hour came out high).
// Run: TZ=America/New_York node --test test/metrics-clockchange.test.mjs   (also America/Chicago; in UTC nothing changes, so the checks still hold)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '40-metrics']);
const M = SB.metrics;
const MIN = 60e3;
// A finished ticket placed at a wall-clock time, sent out five minutes later.
const mk = (id, y, m, d, h, mi) => { const c = new Date(y, m, d, h, mi).getTime(); return { id, num: 1, channel: 'dine_in', createdAt: c, status: 'expedited', expeditedAt: c + 5 * MIN, items: [] }; };
const ds = (tickets, extra) => Object.assign({ tickets, events: [], batches: [], settings: {}, range: {} }, extra || {});

test('regression: chart points on the spring-forward day carry the hour the kitchen clock shows', () => {
  const d = ds([mk('a', 2026, 2, 7, 22, 10), mk('b', 2026, 2, 8, 12, 10), mk('c', 2026, 2, 9, 3, 30)]);
  const pts = M.throughput(d, { bucketMin: 15 }).points.filter((p) => p.created || p.completed);
  const at = (h, mi) => pts.find((p) => new Date(p.t).getHours() === h && new Date(p.t).getMinutes() === mi && p.created);
  assert.equal(at(22, 0).hour, 22);
  assert.equal(at(12, 0).hour, 12, 'noon on the 23-hour day is hour 12');
  assert.equal(at(3, 30).hour, 27.5, '3:30 am the next morning belongs to the day before and is hour 27.5');
});

test('regression: the folded day puts a clock-change day in the same slot as every other day', () => {
  const normal = [mk('a', 2026, 2, 3, 12, 10)], change = [mk('b', 2026, 2, 8, 12, 10)];
  const slot = (t) => M.throughput(ds(t), { bucketMin: 15, fold: true }).points.find((p) => p.created > 0).slot;
  assert.equal(slot(change), slot(normal), 'noon is the same slot on the clock-change day');
});

test('regression: tickets in two different hours around 4 am on the 23-hour day are two active hours', () => {
  const d = ds([mk('a', 2026, 2, 9, 3, 30), mk('b', 2026, 2, 9, 4, 30)]);
  assert.equal(M.summary(d).activeHours, 2);
  assert.equal(M.summary(d).perHour, 1);
});

test('the fall-back night: the repeated hour is one bucket, hours after it keep the wall-clock hour', () => {
  const first = new Date(2026, 10, 1, 0, 30).getTime() + 90 * MIN, second = first + 60 * MIN;   // 1:30 am EDT, then 1:30 am EST
  const t = (id, c) => ({ id, num: 1, channel: 'dine_in', createdAt: c, status: 'expedited', expeditedAt: c + 5 * MIN, items: [] });
  const d = ds([t('a', first), t('b', second), mk('c', 2026, 10, 1, 12, 10)]);
  const pts = M.throughput(d, { bucketMin: 15 }).points.filter((p) => p.created);
  const dup = pts.filter((p) => new Date(p.t).getHours() === 1);
  if (new Date(second).getHours() === 1) assert.equal(dup.length, 1, 'both 1:30 am tickets share the one wall-clock bucket'), assert.equal(dup[0].created, 2);
  assert.equal(pts.find((p) => new Date(p.t).getHours() === 12).hour, 12, 'noon is hour 12 although 13 hours have passed since midnight');
});

test('regression: the sell-out clock and the stock page give wall-clock hours on a clock-change day', () => {
  const t = new Date(2026, 2, 8, 12, 0).getTime();
  const menu = [{ id: 'br', name: 'Brisket plate', cat: 'meat', zone: 'pit', bom: [{ ing: 'brisket', g: 200 }] }];
  const ingredients = [{ id: 'brisket', name: 'Brisket', tcs: true, hold: 'hot', unit: 'g' }];
  const d = ds([mk('a', 2026, 2, 8, 11, 0)], { menu, ingredients, events: [{ type: 'avail_changed', t, ok: false, reason: 'stock', menuId: 'br', ing: 'brisket' }] });
  const so = M.sellOutClock(d);
  assert.equal(so.rows.length, 1);
  assert.equal(so.rows[0].hour, 12, 'noon is hour 12');
  const batch = { id: 'b1', ing: 'brisket', kind: 'hot', status: 'servable', enteredAt: t, cookedG: 1000, label: 'Brisket' };
  const sb = M.stockBurn(Object.assign({}, d, { batches: [batch] }), { ing: 'brisket', day: '2026-03-08' });
  assert.equal(sb.points[0].hour, 12, 'the stock curve starts at hour 12');
});

test('regression: queue load buckets keep the clock hour on both sides of a clock change in one range', () => {
  // Lines open at noon on 7 March and at noon on 9 March (New York springs forward on 8 March).
  const line = (y, m, d) => { const c = new Date(y, m, d, 12, 0).getTime(); return { id: 'q' + d, num: 1, channel: 'dine_in', createdAt: c, status: 'expedited', expeditedAt: c + 10 * MIN,
    items: [{ id: 'i' + d, menuId: 'x', zone: 'pit', status: 'done', firedAt: c, doneAt: c + 10 * MIN }] }; };
  // Two-hour buckets: a width that does not divide the one-hour change is where a single offset for the range went wrong.
  const q = M.queueLoad(ds([line(2026, 2, 7), line(2026, 2, 9)]), { bucketMin: 120 });
  const busy = q.points.filter((p) => p.total > 0);
  assert.equal(busy.length, 2);
  for (const p of busy) { assert.equal(p.hour, 12, 'noon is hour 12 on both days'); assert.equal(new Date(p.t).getHours(), 12); }
  const f = M.queueLoad(ds([line(2026, 2, 7), line(2026, 2, 9)]), { fold: true, bucketMin: 120 });
  assert.deepEqual(f.points.filter((p) => p.total > 0).map((p) => p.hour), [12], 'both days fold into the same noon slot');
});
