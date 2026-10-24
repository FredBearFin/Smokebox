// SB.metrics tests: hand-built fixtures with answers computed by hand (times in seconds after BASE = Fri 2026-10-16 12:00 local).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';
import { ticket, item, event, batch, dataset, quick, quickAt, at, BASE, DAY, local } from './_fixtures.mjs';

await loadSB(['00-util', '10-config', '40-metrics']);
const SB = globalThis.SB, M = SB.metrics, U = SB.util;

const near = (a, b, eps = 1e-6) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= eps, `expected ${a} to be within ${eps} of ${b}`);
const findNaN = (o, p = '') => {
  if (typeof o === 'number') return Number.isNaN(o) ? p : null;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { const r = findNaN(o[k], p + '.' + k); if (r) return r; }
  return null;
};
const noNaN = (o, label) => assert.equal(findNaN(o), null, 'NaN found in ' + label);
const ids = (rows) => rows.map((r) => r.ticketId);
const sumParts = (r) => r.holdMs + r.responseMs + r.workMs + r.dwellMs;

// ---- shared fixtures ----------------------------------------------------------------------------------------------
// T1: item A (two-step) fired 0 started 30 done 200; item B (one-step, paced hold 60) fired 60 done 240; bumped at 270.
const T1 = () => ticket({ id: 'T1', created: 0, expedited: 270, items: [item({ menu: 'brisket_half', fired: 0, started: 30, done: 200 }), item({ menu: 'mac', fired: 60, done: 240 })] });
// T2: critical item two-step: fired 1010 (hold 10) started 1040 (response 30) done 1100 (work 60); other done 1090; bumped 1130 (dwell 30).
const T2 = () => ticket({ id: 'T2', created: 1000, expedited: 1130, items: [item({ menu: 'brisket_half', fired: 1010, started: 1040, done: 1100 }), item({ menu: 'slaw', fired: 1000, done: 1090 })] });

describe('API surface', () => {
  it('every function of SPEC section 12 is exported, plus the helpers the pages use', () => {
    const names = ['ticketAnatomy', 'anatomySummary', 'ticketGantt', 'plateSync', 'thresholds', 'level', 'sla', 'summary', 'paceIndex', 'byHour', 'byWeekdayHour', 'byChannel', 'byZone', 'byItem', 'byDay',
      'throughput', 'histogram', 'ticketHistogram', 'queueLoad', 'pacingCompare', 'calibration', 'eightySixes', 'stockBurn', 'sellOutClock', 'syncLatency', 'compliance', 'wasteByDay', 'batchTimeline',
      'revenueByHour', 'avgTicketValue', 'foodCostPct', 'marginByItem', 'thermal', 'yieldComparison', 'frictionSummary', 'compare', 'rangePresets', 'insights', 'insightRules', 'headline', 'prepare', 'unprepare'];
    for (const n of names) assert.equal(typeof M[n], 'function', n);
    assert.deepEqual(M.CALIBRATION_BOUNDS, { low: 0.8, high: 1.25 });
  });
  it('loading the module touches neither the clock nor the DOM (pure functions of their arguments)', () => {
    const a = M.summary(dataset({ tickets: [quick({ id: 'p1', created: 0, total: 300 })] })), b = M.summary(dataset({ tickets: [quick({ id: 'p1', created: 0, total: 300 })] }));
    assert.deepEqual(a, b);
  });
});

describe('ticket anatomy', () => {
  it('decomposes a one-step critical item: response 0, work = done - fired', () => {
    const [r] = M.ticketAnatomy(dataset({ tickets: [T1()] }));
    assert.equal(r.criticalMenuId, 'mac');
    assert.equal(r.holdMs, 60000);
    assert.equal(r.responseMs, 0);
    assert.equal(r.workMs, 180000);
    assert.equal(r.dwellMs, 30000);
    assert.equal(r.totalMs, 270000);
    assert.equal(r.twoStep, false);
  });
  it('decomposes a two-step critical item: response = started - fired, work = done - started', () => {
    const [r] = M.ticketAnatomy(dataset({ tickets: [T2()] }));
    assert.equal(r.criticalMenuId, 'brisket_half');
    assert.deepEqual([r.holdMs, r.responseMs, r.workMs, r.dwellMs, r.totalMs], [10000, 30000, 60000, 30000, 130000]);
    assert.equal(r.twoStep, true);
  });
  it('parts always sum exactly to totalMs (every row)', () => {
    const rows = M.ticketAnatomy(dataset({ tickets: [T1(), T2()] }));
    assert.equal(rows.length, 2);
    for (const r of rows) assert.equal(sumParts(r), r.totalMs);
  });
  it('a tie on doneAt picks the later-fired item as critical', () => {
    const t = ticket({ id: 'T3', created: 2000, expedited: 2130, items: [item({ menu: 'slaw', fired: 2000, done: 2100 }), item({ menu: 'potato', fired: 2040, done: 2100 })] });
    const [r] = M.ticketAnatomy(dataset({ tickets: [t] }));
    assert.equal(r.criticalMenuId, 'potato');
    assert.equal(r.holdMs, 40000);
    assert.equal(sumParts(r), r.totalMs);
  });
  it('skips tickets with non-monotone timestamps instead of inventing numbers', () => {
    const bad = ticket({ id: 'T4', created: 3000, expedited: 3200, items: [item({ menu: 'slaw', fired: 3100, done: 3050 })] });
    assert.equal(M.ticketAnatomy(dataset({ tickets: [bad] })).length, 0);
  });
  it('anatomySummary averages the parts so they still sum to the average total', () => {
    const a = M.anatomySummary(dataset({ tickets: [T1(), T2()] })).overall;
    assert.deepEqual([a.holdMs, a.responseMs, a.workMs, a.dwellMs, a.totalMs], [35000, 15000, 120000, 30000, 200000]);
    near(a.holdMs + a.responseMs + a.workMs + a.dwellMs, a.totalMs);
    near(a.shares.hold + a.shares.response + a.shares.work + a.shares.dwell, 1);
  });
  it('ticketGantt gives per-item bars in seconds from createdAt plus an expo dwell row', () => {
    const g = M.ticketGantt(dataset({ tickets: [T2()] }), 'T2');
    assert.equal(g.totalSec, 130);
    const brisket = g.rows[0];
    assert.deepEqual(brisket.segments.map((s) => [s.tone, s.start, s.end]), [['hold', 0, 10], ['wait', 10, 40], ['work', 40, 100]]);
    const expo = g.rows[g.rows.length - 1];
    assert.deepEqual([expo.segments[0].tone, expo.segments[0].start, expo.segments[0].end], ['dwell', 100, 130]);
    assert.equal(M.ticketGantt(dataset({ tickets: [T2()] }), 'nope'), null);
  });
});

describe('plate sync', () => {
  it('spread = maxDone - minDone and lamp = mean(maxDone - doneAt_i)', () => {
    const ps = M.plateSync(dataset({ tickets: [T1(), T2()] }));
    assert.equal(ps.count, 2);
    assert.deepEqual(ps.rows.map((r) => [r.spreadMs, r.lampMs]), [[40000, 20000], [10000, 5000]]);
    assert.equal(ps.avgSpreadMs, 25000);
    assert.equal(ps.avgLampMs, 12500);
  });
  it('three items: dones 100/160/220 give spread 120 s and lamp (120+60+0)/3 = 60 s', () => {
    const t = ticket({ id: 'S3', created: 0, expedited: 230, items: [item({ menu: 'slaw', fired: 0, done: 100 }), item({ menu: 'potato', fired: 0, done: 160 }), item({ menu: 'pudding', fired: 0, done: 220 })] });
    const [r] = M.plateSync(dataset({ tickets: [t] })).rows;
    assert.equal(r.spreadMs, 120000);
    assert.equal(r.lampMs, 60000);
  });
  it('lamp is a mean over ALL items, not half the spread: dones 100/120/220 give (120+100+0)/3 = 73.3 s', () => {
    const t = ticket({ id: 'S3b', created: 0, expedited: 230, items: [item({ menu: 'slaw', fired: 0, done: 100 }), item({ menu: 'potato', fired: 0, done: 120 }), item({ menu: 'pudding', fired: 0, done: 220 })] });
    const [r] = M.plateSync(dataset({ tickets: [t] })).rows;
    assert.equal(r.spreadMs, 120000); near(r.lampMs, 220000 / 3, 1e-6); assert.equal(r.items, 3);
  });
  it('single-item tickets have nothing to sync and are left out (not zero-filled)', () => {
    const ps = M.plateSync(dataset({ tickets: [quick({ id: 'one', created: 0, total: 100 })] }));
    assert.equal(ps.count, 0);
    assert.equal(ps.avgSpreadMs, null);
    assert.equal(ps.avgLampMs, null);
  });
});

describe('percentiles and summary', () => {
  const totals = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600];
  const ds = () => dataset({ tickets: totals.map((s, i) => quick({ id: 'p' + i, created: i * 1000, total: s })) });
  it('median, p90, p95, avg, min, max match the hand-computed linear interpolation', () => {
    const s = M.summary(ds());
    assert.equal(s.count, 10);
    assert.equal(s.median, 330000);          // idx 4.5 -> (300+360)/2
    near(s.p90, 546000);                     // idx 8.1 -> 540 + 0.1*60
    near(s.p95, 573000);                     // idx 8.55 -> 540 + 0.55*60
    assert.equal(s.avg, 330000);
    assert.equal(s.min, 60000);
    assert.equal(s.max, 600000);
  });
  it('agrees with SB.util.percentile on the same numbers', () => {
    const s = M.summary(ds());
    const ms = totals.map((x) => x * 1000);
    near(s.median, U.percentile(ms, 50)); near(s.p90, U.percentile(ms, 90)); near(s.p95, U.percentile(ms, 95));
  });
  it('on-time share counts totals under warn: 540 s and 600 s are warn, 8 of 10 are ok', () => {
    const s = M.summary(ds());
    assert.equal(s.ok, 8); assert.equal(s.warn, 2); assert.equal(s.overdue, 0);
    assert.equal(s.onTimePct, 0.8);
  });
  it('perHour divides tickets by active service hours (distinct date+hour slots)', () => {
    const s = M.summary(ds());
    // created at 0,1000,...,9000 s after 12:00 = 12:00 12:16 12:33 12:50 13:06 13:23 13:40 13:56 14:13 14:30 -> hours 12,13,14
    assert.equal(s.activeHours, 3);
    near(s.perHour, 10 / 3);
  });
  it('a single ticket: every percentile is that ticket', () => {
    const s = M.summary(dataset({ tickets: [quick({ id: 'solo', created: 0, total: 123 })] }));
    assert.deepEqual([s.count, s.median, s.p90, s.p95, s.avg], [1, 123000, 123000, 123000, 123000]);
  });
  it('range is half-open: a ticket created exactly at `to` is excluded, at `from` included', () => {
    const d = dataset({ tickets: [quick({ id: 'a', created: 0, total: 60 }), quick({ id: 'b', created: 100, total: 60 })] });
    assert.equal(M.summary(d, { from: at(0), to: at(100) }).count, 1);
    assert.equal(M.summary(d, { from: at(0), to: at(101) }).count, 2);
    assert.equal(M.summary(d, { from: at(1), to: at(100) }).count, 0);
  });
});

describe('SLA levels and boundaries', () => {
  const lv = (secs, settings) => { const d = dataset({ settings }); return secs.map((s) => M.level(d, 'dine_in', s * 1000)); };
  it('exactly at warn is warn, exactly at breach is breach (dine-in 540/780 s)', () => {
    assert.deepEqual(lv([539, 540, 779, 780]), ['ok', 'warn', 'warn', 'breach']);
  });
  it('M.sla counts those four tickets and onTimePct = 1/4', () => {
    const d = dataset({ tickets: [539, 540, 779, 780].map((s, i) => quick({ id: 'x' + i, created: i * 2000, total: s })) });
    const s = M.sla(d);
    assert.deepEqual([s.ok, s.warn, s.breach, s.onTimePct], [1, 2, 1, 0.25]);
    assert.equal(s.byChannel[0].channel, 'dine_in');
  });
  it('settings.channels overrides the config thresholds per channel', () => {
    const settings = { channels: [{ id: 'takeout', warnSec: 100, breachSec: 200 }], service: SB.config.service, pacing: SB.config.pacing };
    const d = dataset({ settings });
    assert.deepEqual([99, 100, 199, 200].map((s) => M.level(d, 'takeout', s * 1000)), ['ok', 'warn', 'warn', 'breach']);
    assert.equal(M.level(d, 'dine_in', 539000), 'ok');        // untouched channel keeps config
    assert.equal(M.thresholds(d, 'takeout').warnMs, 100000);
    assert.equal(M.thresholds(d, 'drive_thru').breachSec, 540);
  });
  it('an unknown channel falls back to the first config channel; non-numbers give null', () => {
    assert.equal(M.thresholds(dataset(), 'mystery').warnSec, 540);
    assert.equal(M.level(dataset(), 'dine_in', NaN), null);
  });
  it('tickets use the override when classifying (summary.warn/overdue)', () => {
    const settings = { channels: [{ id: 'dine_in', warnSec: 100, breachSec: 200 }], service: SB.config.service, pacing: SB.config.pacing };
    const d = dataset({ settings, tickets: [quick({ id: 'a', created: 0, total: 150 }), quick({ id: 'b', created: 1000, total: 250 }), quick({ id: 'c', created: 2000, total: 50 })] });
    const s = M.summary(d);
    assert.deepEqual([s.ok, s.warn, s.overdue], [1, 1, 1]);
  });
});

describe('live pace index', () => {
  // totals in seconds, bumped at 1000, 1100, ... (seconds after BASE); every ticket is a one-item ticket so total = expedited - created.
  const run = (totals, channels, startAt = 1000) => totals.map((tot, i) => quick({ id: 'p' + i, created: startAt + i * 100 - tot, total: tot, channel: channels ? channels[i % channels.length] : 'dine_in' }));
  const NOW = at(3600);
  it('median of the last 10 finished tickets over the warn threshold: 390 s / 540 s = 0.722, comfortable', () => {
    const tix = run([300, 320, 340, 360, 380, 400, 420, 440, 460, 480]);
    const p = M.paceIndex(dataset({ tickets: tix }), { now: NOW });
    assert.equal(p.n, 10); assert.equal(p.medianMs, 390000); assert.equal(p.targetMs, 540000);
    near(p.index, 390 / 540); assert.equal(p.level, 'comfortable'); assert.equal(p.label, 'Comfortable'); assert.equal(p.thin, false);
  });
  it('only the last 10 inside the 45-minute window count: older, slower and future tickets are ignored', () => {
    const tix = run([300, 320, 340, 360, 380, 400, 420, 440, 460, 480]).concat([
      quick({ id: 'old1', created: 0, total: 600 }),                        // bumped at 600 s, before the window opens at 900 s
      quick({ id: 'old2', created: 100, total: 1000 }),                     // bumped at 1100 s: inside the window, slow, and ties with p1
      quick({ id: 'future', created: 3650, total: 50 }),                    // bumped at 3700 s, after `now`
    ]);
    // Newest 10 by expeditedAt are p9..p2, then p1 and old2 (both 1100 s); p0 (1000 s, 300 s total) falls off the end.
    const p = M.paceIndex(dataset({ tickets: tix }), { now: NOW });
    assert.equal(p.n, 10);
    const totals = [320, 340, 360, 380, 400, 420, 440, 460, 480, 1000].sort((a, b) => a - b);
    assert.equal(p.medianMs, (totals[4] + totals[5]) * 500);                // (400 s + 420 s) / 2 = 410 s
    near(p.index, 410 / 540);
  });
  it('the channel mix sets the target: 5 dine-in (540 s) + 5 drive-thru (360 s) -> 450 s; exactly 1.0 is busy, above is behind', () => {
    const at450 = M.paceIndex(dataset({ tickets: run(Array(10).fill(450), ['dine_in', 'drive_thru']) }), { now: NOW });
    assert.equal(at450.targetMs, 450000); near(at450.index, 1); assert.equal(at450.level, 'busy');
    assert.deepEqual(at450.mix.map((m) => [m.channel, m.share, m.warnMs]), [['dine_in', 0.5, 540000], ['drive_thru', 0.5, 360000]]);
    const slow = M.paceIndex(dataset({ tickets: run(Array(10).fill(460), ['dine_in', 'drive_thru']) }), { now: NOW });
    near(slow.index, 460 / 450); assert.equal(slow.level, 'behind'); assert.equal(slow.label, 'Behind');
    const fast = M.paceIndex(dataset({ tickets: run(Array(10).fill(360), ['dine_in', 'drive_thru']) }), { now: NOW });
    near(fast.index, 0.8); assert.equal(fast.level, 'busy');                // exactly 0.8 is busy, not comfortable
  });
  it('fewer than 3 tickets is thin but still answers; none in the window gives a calm null', () => {
    const two = M.paceIndex(dataset({ tickets: run([300, 600]) }), { now: NOW });
    assert.equal(two.n, 2); assert.equal(two.thin, true); near(two.index, 450 / 540);
    const none = M.paceIndex(dataset({ tickets: run([300, 600]) }), { now: at(9000) });       // everything finished more than 45 minutes ago
    assert.equal(none.n, 0); assert.equal(none.index, null); assert.equal(none.level, null); assert.equal(none.thin, true); noNaN(none, 'paceIndex none');
    assert.equal(M.paceIndex(dataset(), { now: NOW }).index, null);
  });
  it('without opts.now the newest finished ticket is "now"; from/to never matter; voided tickets do not count', () => {
    const tix = run([300, 320, 340, 360, 380, 400, 420, 440, 460, 480]).concat([quick({ id: 'v', created: 1900, total: 50, voided: 1960, expedited: undefined, status: 'voided' })]);
    const p = M.paceIndex(dataset({ tickets: tix }), { from: at(5000), to: at(6000) });
    assert.equal(p.n, 10); near(p.index, 390 / 540);
  });
});

describe('service day rollover', () => {
  const t0045 = local(2026, 10, 17, 0, 45), t0359 = local(2026, 10, 17, 3, 59), t0400 = local(2026, 10, 17, 4, 0);
  const d = () => dataset({ tickets: [quickAt(at(600), 300, { id: 'noon' }), quickAt(t0045, 300, { id: 'late' }), quickAt(t0359, 300, { id: 'last' }), quickAt(t0400, 300, { id: 'next' })] });
  it('12:45 am is hour 24.75 of the previous service date', () => {
    assert.equal(U.serviceDate(t0045), DAY);
    near(U.serviceHour(t0045), 24.75);
  });
  it('byHour puts 12:45 am in hour 24 (label 12 am), 3:59 am in 27, and 4:00 am starts a new day at hour 4', () => {
    const rows = M.byHour(d());
    const get = (h) => rows.find((r) => r.hour === h);
    assert.equal(get(24).count, 1); assert.equal(get(24).label, '12 am');
    assert.equal(get(27).count, 1);
    assert.equal(get(4).count, 1);
    assert.equal(get(12).count, 1);
    assert.equal(rows[0].hour, 4); assert.equal(rows[rows.length - 1].hour, 27);
    assert.equal(rows.length, 24);                                  // contiguous
  });
  it('byDay groups the 12:45 am and 3:59 am tickets with the night they belong to', () => {
    const days = M.byDay(d());
    assert.deepEqual(days.map((x) => [x.date, x.tickets]), [[DAY, 3], ['2026-10-17', 1]]);
    assert.equal(days[0].label, 'Fri 10/16');
  });
  it('the heatmap uses the service-date weekday: 12:45 am Saturday is the Friday row, hour 24', () => {
    const h = M.byWeekdayHour(d());
    const fri = h.rows.indexOf('Fri'), col = h.colIds.indexOf(24);
    assert.deepEqual(h.rows, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.equal(h.values[fri][col], 300000);
    assert.equal(h.counts[fri][col], 1);
    assert.equal(h.values[h.rows.indexOf('Sat')][h.colIds.indexOf(4)], 300000);
    assert.equal(h.values[0][0], null);                              // Monday has no data: null, not 0
  });
});

describe('voided, forced and recalled tickets', () => {
  const build = () => dataset({ tickets: [
    quick({ id: 'n1', created: 0, total: 300 }),
    ticket({ id: 'v1', created: 100, voided: 150, voidReason: 'wrong order', items: [item({ menu: 'slaw', fired: 100 })] }),
    ticket({ id: 'f1', created: 200, expedited: 320, forced: true, items: [item({ menu: 'slaw', fired: 200, done: 260 }), item({ menu: 'potato', fired: 200, done: 280 }), item({ menu: 'brisket_half', fired: 200, started: 210 })] }),
    ticket({ id: 'r1', created: 400, expedited: 800, recalls: 1, items: [item({ menu: 'slaw', fired: 400, done: 500 }), item({ menu: 'potato', fired: 400, done: 700 })] }),
    ticket({ id: 'r2', created: 900, status: 'active', expeditedAt: at(1000), recalls: 1, items: [item({ menu: 'slaw', fired: 900, done: 950 })] }),
  ] });
  it('voided tickets never enter speed stats but are counted as voids', () => {
    const s = M.summary(build());
    assert.equal(s.voids, 1);
    assert.equal(s.count, 3);                                         // n1, f1, r1
  });
  it('median of [120 forced, 300, 400 recalled] is 300 s', () => {
    assert.equal(M.summary(build()).median, 300000);
  });
  it('a recalled ticket uses its latest expeditedAt (800 s -> 400 s total); a ticket currently recalled (active) is not finished', () => {
    const rows = M.ticketAnatomy(build());
    const r1 = rows.find((r) => r.ticketId === 'r1');
    assert.equal(r1.totalMs, 400000);
    assert.deepEqual([r1.holdMs, r1.responseMs, r1.workMs, r1.dwellMs], [0, 0, 300000, 100000]);
    assert.ok(!ids(rows).includes('r2'));
    assert.equal(M.summary(build()).recalls, 2);                       // r1 + r2 both carry recalls: 1
  });
  it('forced bumps are counted and excluded from plate sync and anatomy', () => {
    const d = build();
    assert.equal(M.summary(d).forced, 1);
    assert.deepEqual(ids(M.plateSync(d).rows), ['r1']);              // f1 has two done items, so only the forced flag keeps it out
    assert.ok(!ids(M.ticketAnatomy(d)).includes('f1'));
  });
  it('includeVoided widens created/byDay counts but never the speed count', () => {
    const d = build();
    assert.equal(M.summary(d).created, 4);
    assert.equal(M.summary(d, { includeVoided: true }).created, 5);
    assert.equal(M.summary(d, { includeVoided: true }).count, 3);
    assert.equal(M.byDay(d)[0].tickets, 4);
    assert.equal(M.byDay(d, { includeVoided: true })[0].tickets, 5);
    assert.equal(M.byDay(d)[0].voids, 1);
  });
});

describe('empty, garbage and single-ticket input never throws or yields NaN', () => {
  const calls = {
    ticketAnatomy: (d) => M.ticketAnatomy(d), anatomySummary: (d) => M.anatomySummary(d), plateSync: (d) => M.plateSync(d), sla: (d) => M.sla(d), summary: (d) => M.summary(d),
    paceIndex: (d) => M.paceIndex(d), byHour: (d) => M.byHour(d), byWeekdayHour: (d) => M.byWeekdayHour(d), byChannel: (d) => M.byChannel(d), byZone: (d) => M.byZone(d),
    byItem: (d) => M.byItem(d), byDay: (d) => M.byDay(d), throughput: (d) => M.throughput(d), foldedThroughput: (d) => M.throughput(d, { fold: true }), ticketHistogram: (d) => M.ticketHistogram(d),
    queueLoad: (d) => M.queueLoad(d), foldedQueue: (d) => M.queueLoad(d, { fold: true }), pacingCompare: (d) => M.pacingCompare(d), calibration: (d) => M.calibration(d),
    eightySixes: (d) => M.eightySixes(d), stockBurn: (d) => M.stockBurn(d, { ing: 'brisket' }), sellOutClock: (d) => M.sellOutClock(d), syncLatency: (d) => M.syncLatency(d),
    compliance: (d) => M.compliance(d), wasteByDay: (d) => M.wasteByDay(d), batchTimeline: (d) => M.batchTimeline(d), revenueByHour: (d) => M.revenueByHour(d), sales: (d) => M.sales(d),
    avgTicketValue: (d) => M.avgTicketValue(d), foodCostPct: (d) => M.foodCostPct(d), marginByItem: (d) => M.marginByItem(d), yieldComparison: (d) => M.yieldComparison(d),
    frictionSummary: (d) => M.frictionSummary(d), compare: (d) => M.compare(d), insights: (d) => M.insights(d), ticketGantt: (d) => M.ticketGantt(d, 'x'),
    headlinePace: (d) => M.headline('pace', d), headlineStock: (d) => M.headline('stock', d), headlineData: (d) => M.headline('data', d),
  };
  const inputs = { undefined: undefined, null: null, emptyObject: {}, emptyDataset: dataset(), junk: { tickets: 'x', events: 5, batches: [null, 3], settings: 7, range: 'y' }, nullRows: { tickets: [null, {}, { createdAt: 'a' }], events: [null, { t: 'x' }] } };
  for (const [iname, input] of Object.entries(inputs)) {
    it('input ' + iname + ': all ' + Object.keys(calls).length + ' functions return a well-formed result', () => {
      for (const [name, fn] of Object.entries(calls)) {
        let r; assert.doesNotThrow(() => { r = fn(input); }, name);
        noNaN(r, name);
        if (name.startsWith('headline')) assert.ok(typeof r === 'string' && r.length > 0);
      }
    });
  }
  it('empty summary has count 0 and null (unknown) stats, never 0 or NaN', () => {
    const s = M.summary(dataset());
    assert.equal(s.count, 0); assert.equal(s.median, null); assert.equal(s.onTimePct, null); assert.equal(s.perHour, null);
    assert.deepEqual(M.byHour(dataset()), []);
    assert.deepEqual(M.insights(dataset()), []);
    assert.equal(M.paceIndex(dataset()).index, null);
  });
  it('the thermal helper and histogram helper are total too', () => {
    noNaN(M.thermal(), 'thermal'); noNaN(M.thermal({ endpointC: 'x', holdH: NaN, rawG: 'a' }), 'thermal junk');
    assert.deepEqual(M.histogram([], 60).bins, []);
    assert.deepEqual(M.histogram(null, 60).counts, []);
  });
});

describe('byHour, byChannel, byZone', () => {
  // 12:xx hour: totals 300, 500 (dine_in); 13:xx hour: total 400 (takeout)
  const d = () => dataset({ tickets: [quick({ id: 'h1', created: 0, total: 300 }), quick({ id: 'h2', created: 600, total: 500 }), quick({ id: 'h3', created: 3600, total: 400, channel: 'takeout' })] });
  it('byHour: medians and counts per service hour, x/y ready for charts', () => {
    const rows = M.byHour(d());
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].hour, rows[0].count, rows[0].medianMs, rows[0].avgMs, rows[0].x, rows[0].y], [12, 2, 400000, 400000, 12, 400000]);
    assert.deepEqual([rows[1].hour, rows[1].count, rows[1].medianMs, rows[1].label, rows[1].span], [13, 1, 400000, '1 pm', '1 to 2 pm']);
    assert.equal(rows[0].onTimePct, 1);
  });
  it('byHour: an hour with tickets created but none finished is listed with count 0 and null stats', () => {
    const t = ticket({ id: 'open', created: 7300, items: [item({ menu: 'slaw', fired: 7300 })] });          // 14:01, still open
    const rows = M.byHour(dataset({ tickets: [quick({ id: 'a', created: 0, total: 60 }), t] }));
    assert.deepEqual(rows.map((r) => r.hour), [12, 13, 14]);
    assert.equal(rows[1].count, 0); assert.equal(rows[1].medianMs, null); assert.equal(rows[2].created, 1);
  });
  it('byChannel: only used channels, in config order, with thresholds and shares', () => {
    const rows = M.byChannel(d());
    assert.deepEqual(rows.map((r) => r.channel), ['dine_in', 'takeout']);
    assert.deepEqual([rows[0].count, rows[0].medianMs, rows[0].warnMs, rows[0].breachMs], [2, 400000, 540000, 780000]);
    assert.deepEqual([rows[1].count, rows[1].medianMs, rows[1].warnMs], [1, 400000, 480000]);
    near(rows[0].share, 2 / 3);
  });
  it('channel and zone filters narrow the tickets', () => {
    assert.equal(M.summary(d(), { channel: 'takeout' }).count, 1);
    assert.equal(M.summary(d(), { channel: 'all' }).count, 3);
    assert.equal(M.summary(d(), { zone: 'pit' }).count, 3);          // quick() items are brisket_qtr (pit)
    assert.equal(M.summary(d(), { zone: 'fry' }).count, 0);
  });
  // Z1: pit two-step resp 20 work 80; pit one-step work 50; sides two-step resp 40 work 260 (critical)
  // Z2: pit two-step resp 10 work 100 (critical); cold one-step work 30
  const zd = () => dataset({ tickets: [
    ticket({ id: 'Z1', created: 0, expedited: 300, items: [item({ menu: 'brisket_half', fired: 0, started: 20, done: 100 }), item({ menu: 'brisket_qtr', fired: 0, done: 50 }), item({ menu: 'mac', fired: 0, started: 40, done: 300 })] }),
    ticket({ id: 'Z2', created: 1000, expedited: 1120, items: [item({ menu: 'brisket_half', fired: 1000, started: 1010, done: 1110 }), item({ menu: 'slaw', fired: 1000, done: 1030 })] }),
  ] });
  it('byZone: response only where a start tap exists, work = start (or fire) to done', () => {
    const z = Object.fromEntries(M.byZone(zd()).map((r) => [r.zone, r]));
    assert.deepEqual(Object.keys(z), ['pit', 'sides', 'cold']);
    assert.deepEqual([z.pit.lines, z.pit.qty, z.pit.responseN, z.pit.avgResponseMs, z.pit.workN, z.pit.medianWorkMs], [3, 3, 2, 15000, 3, 80000]);
    near(z.pit.avgWorkMs, 230000 / 3);
    assert.deepEqual([z.sides.avgResponseMs, z.sides.avgWorkMs], [40000, 260000]);
    assert.deepEqual([z.cold.responseN, z.cold.avgResponseMs, z.cold.avgWorkMs], [0, null, 30000]);
  });
  it('byZone: the station of each ticket\'s last item gets the critical count', () => {
    const z = Object.fromEntries(M.byZone(zd()).map((r) => [r.zone, r]));
    assert.deepEqual([z.sides.criticalCount, z.pit.criticalCount, z.cold.criticalCount], [1, 1, 0]);
    assert.equal(z.sides.criticalShare, 0.5);
  });
});

describe('money: byItem, revenue, ticket value, food cost, margin', () => {
  const learned = { brisket_half: { n: 4, ema: 150, est: 140 } };
  const md = () => dataset({ learned, tickets: [
    ticket({ id: 'M1', created: 0, expedited: 300, items: [item({ menu: 'brisket_half', qty: 2, price: 14, cost: 6, fired: 0, started: 10, done: 200 }), item({ menu: 'mac', price: 5.5, fired: 0, done: 300 })] }),
    ticket({ id: 'M2', created: 7200, expedited: 7500, items: [item({ menu: 'brisket_half', qty: 1, price: 14, cost: 3, fired: 7200, started: 7210, done: 7400 })] }),
  ] });
  it('byItem: sold, revenue, cost, margin on costed lines only; uncosted item has null margin', () => {
    const rows = M.byItem(md());
    const bh = rows.find((r) => r.menuId === 'brisket_half'), mac = rows.find((r) => r.menuId === 'mac');
    assert.deepEqual([bh.sold, bh.revenue, bh.cost, bh.margin], [3, 42, 9, 33]);
    near(bh.marginPct, 33 / 42); near(bh.costPct, 9 / 42);
    assert.deepEqual([mac.sold, mac.revenue, mac.cost, mac.margin, mac.marginPct], [1, 5.5, null, null, null]);
    assert.equal(rows[0].menuId, 'brisket_half');                      // sorted by revenue
    near(bh.share, 42 / 47.5);
  });
  it('byItem: work per unit divides by the quantity factor (qty 2 -> 1.2); learned and starter come along', () => {
    const bh = M.byItem(md()).find((r) => r.menuId === 'brisket_half');
    assert.equal(bh.workN, 2);
    near(bh.avgWorkMs, (190000 / 1.2 + 190000) / 2);
    assert.deepEqual([bh.starterSec, bh.learnedSec, bh.learnedN, bh.confirmed], [120, 140, 4, false]);
  });
  it('revenueByHour: contiguous hours, a gap hour is a real zero', () => {
    const rows = M.revenueByHour(md());
    assert.deepEqual(rows.map((r) => [r.hour, r.revenue]), [[12, 33.5], [13, 0], [14, 14]]);
    assert.deepEqual([rows[0].tickets, rows[0].items, rows[0].avgTicket, rows[1].avgTicket], [1, 3, 33.5, null]);
  });
  it('avgTicketValue: ticket value = sum of price x qty of done lines', () => {
    const v = M.avgTicketValue(md());
    assert.deepEqual([v.count, v.total, v.avg, v.median], [2, 47.5, 23.75, 23.75]);
    assert.equal(v.byChannel[0].channel, 'dine_in');
  });
  it('foodCostPct: cost / price over costed lines, with coverage and per-category split', () => {
    const f = M.foodCostPct(md());
    assert.equal(f.cost, 9); assert.equal(f.revenue, 42); assert.equal(f.lines, 2);
    near(f.costPct, 9 / 42); near(f.coverage, 2 / 3);
    assert.deepEqual(f.byCat.map((c) => c.cat), ['meat']);
    assert.equal(f.byDay.length, 1);
  });
  it('marginByItem lists only costed items with margin per unit', () => {
    const rows = M.marginByItem(md());
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].menuId, rows[0].margin, rows[0].costedQty, rows[0].marginPerUnit], ['brisket_half', 33, 3, 11]);
  });
  it('byDay carries revenue and average ticket value', () => {
    const [day] = M.byDay(md());
    assert.deepEqual([day.revenue, day.avgTicketValue], [47.5, 23.75]);
    near(day.foodCostPct, 9 / 42);
  });
  it('a line without a price is skipped, not priced at 0', () => {
    const it = item({ menu: 'slaw', fired: 0, done: 10 }); delete it.price;
    const d = dataset({ tickets: [ticket({ id: 'np', created: 0, expedited: 20, items: [it] })] });
    assert.equal(M.byItem(d)[0].revenue, null);
    assert.equal(M.revenueByHour(d).length, 0);
    assert.equal(M.avgTicketValue(d).count, 0);
  });
});

describe('pacing A/B', () => {
  const two = (id, created, pacing, doneA, doneB, exp, extra) => ticket(Object.assign({ id, created, expedited: exp, pacing, items: [item({ menu: 'slaw', fired: created, done: doneA }), item({ menu: 'potato', fired: created, done: doneB })] }, extra));
  const d = () => dataset({ tickets: [
    two('P1', 0, true, 100, 110, 120), two('P2', 1000, true, 1100, 1110, 1120),          // on: spread 10 s, lamp 5 s, total 120 s
    two('U1', 1500, false, 1600, 1720, 1730), two('U2', 2000, false, 2100, 2160, 2170),  // off: spread 120/60 s, lamp 60/30 s, totals 230/170 s
    two('R1', 3000, true, 3100, 3400, 3410, { rush: true }),                              // rush: left out of both sides
  ] });
  it('compares spread, lamp and median total on vs off', () => {
    const p = M.pacingCompare(d());
    assert.equal(p.comparable, true);
    assert.deepEqual([p.on.tickets, p.on.syncTickets, p.on.avgSpreadMs, p.on.avgLampMs, p.on.medianTotalMs], [2, 2, 10000, 5000, 120000]);
    assert.deepEqual([p.off.tickets, p.off.avgSpreadMs, p.off.avgLampMs, p.off.medianTotalMs], [2, 90000, 45000, 200000]);
  });
  it('savings: lamp 45 s -> 5 s is 40 s saved (89%); median total 80 s faster', () => {
    const p = M.pacingCompare(d());
    assert.equal(p.lampSavedMs, 40000); near(p.lampCutPct, 40 / 45);
    assert.equal(p.spreadSavedMs, 80000);
    assert.equal(p.medianDeltaMs, -80000);
  });
  it('one-sided data is not comparable and reports null deltas', () => {
    const p = M.pacingCompare(dataset({ tickets: [two('P1', 0, true, 100, 110, 120)] }));
    assert.equal(p.comparable, false); assert.equal(p.lampSavedMs, null); assert.equal(p.off.avgLampMs, null); assert.equal(p.off.tickets, 0);
  });
});

describe('calibration', () => {
  // build n tickets of one menu item with the given work time (seconds). two-step: started 10 s after fired.
  let off = 0;
  const cal = (menu, n, workSec, o = {}) => Array.from({ length: n }, (_, i) => {
    const c = (off += 700);
    const it = o.oneStep ? item({ menu, qty: o.qty, override: o.override, fired: c, done: c + workSec }) : item({ menu, qty: o.qty, override: o.override, fired: c, started: c + 10, done: c + 10 + workSec });
    return ticket({ id: `cal_${menu}_${o.tag || ''}${i}`, created: c, expedited: c + workSec + 20, items: [it] });
  });
  const build = () => {
    off = 0;
    return dataset({ learned: { mac: { n: 6, ema: 390, est: 380 } }, tickets: [
      ...cal('mac', 6, 390),                                   // starter 300 -> ratio 1.3 -> slow
      ...cal('mac', 3, 900, { override: true, tag: 'ov' }),    // overridden items are not evidence
      ...cal('pork_qtr', 6, 180, { oneStep: true, qty: 6 }),   // qty 6 -> factor min(2, 1+0.2*5)=2 -> 90 s per unit = starter 90 -> ratio 1
      ...cal('slaw', 6, 37.5, { oneStep: true }),              // 37.5 / 30 = exactly 1.25 -> not drift
      ...cal('potato', 6, 24, { oneStep: true }),              // 24 / 30 = exactly 0.8 -> not drift
      ...cal('pudding', 6, 30, { oneStep: true }),             // 30 / 45 = 0.667 -> fast
      ...cal('tea', 3, 100, { oneStep: true }),                // only 3 samples -> thin, never flagged
    ] });
  };
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.menuId, r]));
  it('flags observed/starter outside 0.8..1.25, with direction', () => {
    const c = by(M.calibration(build()));
    assert.deepEqual([c.mac.flag, c.mac.drift, c.pudding.flag, c.pudding.drift], [true, 'slow', true, 'fast']);
    near(c.mac.ratio, 1.3); near(c.pudding.ratio, 30 / 45);
  });
  it('exactly 1.25 and exactly 0.8 are inside the band; an on-target item is quiet', () => {
    const c = by(M.calibration(build()));
    assert.deepEqual([c.slaw.ratio, c.slaw.flag, c.potato.ratio, c.potato.flag, c.pork_qtr.ratio, c.pork_qtr.flag], [1.25, false, 0.8, false, 1, false]);
  });
  it('overridden items are ignored; sample count and learned plan gap come through', () => {
    const c = by(M.calibration(build()));
    assert.equal(c.mac.n, 6); assert.equal(c.mac.observedSec, 390);
    assert.deepEqual([c.mac.starterSec, c.mac.learnedSec, c.mac.planGapSec, c.mac.deltaSec], [300, 380, -10, 90]);
  });
  it('thin items (< 5 samples) are marked thin and never flagged, and sort last', () => {
    const rows = M.calibration(build()); const tea = rows.find((r) => r.menuId === 'tea');
    assert.deepEqual([tea.thin, tea.flag, tea.drift], [true, false, null]);
    assert.equal(rows[rows.length - 1].menuId, 'tea');
    assert.deepEqual(rows.slice(0, 2).map((r) => r.menuId), ['pudding', 'mac']);        // biggest drift first
  });
  it('opts.minSamples changes what counts as thin', () => {
    const tea = by(M.calibration(build(), { minSamples: 3 })).tea;
    assert.deepEqual([tea.thin, tea.flag], [false, true]);
  });
});

describe('stock burn', () => {
  const dep = (g, batchId, ing = 'brisket') => [{ ing, g, batchId }];
  const sd = () => dataset({
    batches: [batch({ id: 'b1', ing: 'brisket', entered: 0, cookedG: 5000 }), batch({ id: 'b2', ing: 'brisket', entered: 1800, cookedG: 3000, discarded: 2400, wasteG: 500, discardReason: 'expired' })],
    tickets: [
      ticket({ id: 'A', created: 500, expedited: 650, items: [item({ menu: 'brisket_qtr', fired: 500, done: 600, depleted: dep(227, 'b1') })] }),
      ticket({ id: 'B', created: 800, expedited: 950, items: [item({ menu: 'brisket_qtr', fired: 800, done: 900, depleted: dep(113, 'b1') })] }),
      ticket({ id: 'C', created: 1100, expedited: 1250, items: [item({ menu: 'brisket_qtr', fired: 1100, done: 1200, depleted: dep(227, 'b1') })] }),
      ticket({ id: 'D', created: 1250, expedited: 1350, items: [item({ menu: 'brisket_qtr', fired: 1250, done: 1300, depleted: dep(100, 'bOLD') })] }),   // another day's batch: ignored
    ],
  });
  it('rebuilds the level from intake, depletion and discard (TCS, matched by batchId)', () => {
    const s = M.stockBurn(sd(), { ing: 'brisket', day: DAY });
    assert.deepEqual(s.points.map((p) => p.g), [5000, 4773, 4660, 4433, 7433, 6933]);
    assert.deepEqual([s.intakeG, s.usedG, s.wasteG, s.endG], [8000, 567, 500, 6933]);
    assert.deepEqual([s.minG, s.minAt], [4433, at(1200)]);
    assert.deepEqual([s.openingG, s.openingAssumed, s.tcs, s.thresholdG], [0, false, true, 700]);
    assert.equal(s.batches.length, 2);
  });
  it('defaults to the newest day with data and returns the service window', () => {
    const s = M.stockBurn(sd(), { ing: 'brisket' });
    assert.equal(s.day, DAY);
    assert.equal(s.openMs, local(2026, 10, 16, 11)); assert.equal(s.closeMs, local(2026, 10, 16, 21));
  });
  it('non-TCS stock starts from par (flagged as assumed) unless openingG is given, and restocks add', () => {
    const t = ticket({ id: 'P', created: 100, expedited: 400, items: [item({ menu: 'fried_pickles', fired: 100, done: 200, depleted: [{ ing: 'pickles', g: 150 }] }), item({ menu: 'brisket_sand', fired: 100, done: 300, depleted: [{ ing: 'pickles', g: 20 }] })] });
    const d = dataset({ tickets: [t], events: [event({ type: 'restock', at: 250, ing: 'pickles', g: 500 })] });
    const s = M.stockBurn(d, { ing: 'pickles', day: DAY });
    assert.deepEqual([s.openingG, s.openingAssumed, s.endG, s.usedG, s.intakeG], [6000, true, 6330, 170, 500]);
    const s2 = M.stockBurn(d, { ing: 'pickles', day: DAY, openingG: 1000 });
    assert.deepEqual([s2.openingAssumed, s2.endG], [false, 1330]);
    // Using more than was counted in never shows a negative stock: the extra is reported apart.
    const s3 = M.stockBurn(dataset({ tickets: [t] }), { ing: 'pickles', day: DAY, openingG: 100 });
    assert.deepEqual([s3.endG, s3.minG, s3.overdrawnG, s3.usedG], [0, 0, 70, 170]);
  });
  it('no ingredient or unknown day gives an empty, well-formed result', () => {
    assert.deepEqual(M.stockBurn(sd(), {}).points, []);
    assert.deepEqual(M.stockBurn(sd(), { ing: 'brisket', day: '2020-01-01' }).points, []);
  });
});

describe('86 spells, sell-out clock, sync latency', () => {
  const av = (t, menuId, ok, reason, ing) => event({ type: 'avail_changed', t, menuId, ok, reason, ing });
  const d = () => dataset({
    tickets: [quickAt(local(2026, 10, 16, 12), 300, { id: 'x1' }), quickAt(local(2026, 10, 17, 12), 300, { id: 'x2' })],
    events: [
      av(local(2026, 10, 16, 13, 42), 'brisket_qtr', false, 'stock', 'brisket'),
      av(local(2026, 10, 16, 14, 10), 'brisket_half', false, 'stock', 'brisket'),    // second brisket 86 the same day: not the first
      av(local(2026, 10, 16, 14, 30), 'brisket_qtr', true, null, null),
      av(local(2026, 10, 16, 15, 0), 'brisket_qtr', false, 'safety', 'brisket'),     // safety lockout: not a sell-out
      av(local(2026, 10, 16, 20, 0), 'pork_half', false, 'manual', null),            // manual 86: protein found through the menu BOM
      av(local(2026, 10, 16, 16, 0), 'mac', false, 'stock', 'mac'),                  // a side, not a protein
    ],
  });
  it('sellOutClock: first stock/manual 86 per protein per day, versus the 9 pm close', () => {
    const s = M.sellOutClock(d());
    const b = s.rows.find((r) => r.ing === 'brisket'), p = s.rows.find((r) => r.ing === 'pork');
    assert.equal(s.rows.length, 2);
    assert.equal(b.t, local(2026, 10, 16, 13, 42)); near(b.hoursBeforeClose, 7.3);
    assert.deepEqual([p.reason, p.menuId], ['manual', 'pork_half']); near(p.hoursBeforeClose, 1);
    near(b.hour, 13.7);
  });
  it('sellOutClock: days without a sell-out are listed empty; proteins report their share of days', () => {
    const s = M.sellOutClock(d());
    assert.deepEqual(s.days.map((x) => [x.date, x.items.length]), [[DAY, 2], ['2026-10-17', 0]]);
    assert.equal(s.dayCount, 2);
    assert.deepEqual(s.proteins.filter((x) => x.days > 0).map((x) => [x.ing, x.days, x.share]), [['brisket', 1, 0.5], ['pork', 1, 0.5]]);
    assert.equal(s.closeHour, 21);
  });
  it('eightySixes: pairs ok:false with the next ok:true; unresolved spells have null duration', () => {
    const sp = M.eightySixes(d());
    assert.deepEqual([sp[0].menuId, sp[0].reason, sp[0].durationMs], ['brisket_qtr', 'stock', 48 * 60000]);
    assert.equal(sp.find((s) => s.reason === 'safety').durationMs, null);
    assert.equal(sp.length, 5);
  });
  it('syncLatency: median, p90, max and the share inside 60 s (60 s counts as inside)', () => {
    const lat = [10000, 20000, 30000, 60000, 61000], tg = ['pos', 'online', 'drive', 'delivery', 'pos'];
    const s = M.syncLatency(dataset({ events: lat.map((l, i) => event({ type: 'sync_done', at: i, syncId: 's' + i, menuId: 'brisket_qtr', target: tg[i], latencyMs: l })) }));
    assert.deepEqual([s.count, s.medianMs, s.maxMs, s.withinCount, s.withinPct, s.targetSec], [5, 30000, 61000, 4, 0.8, 60]);
    near(s.p90Ms, 60600);
    assert.deepEqual(s.byTarget.map((x) => [x.target, x.count]), [['pos', 2], ['online', 1], ['drive', 1], ['delivery', 1]]);
    assert.equal(s.slowest[0].latencyMs, 61000);
  });
});

describe('safety: compliance, waste, batch timeline', () => {
  const ev = (type, sec, f) => event(Object.assign({ type, at: sec }, f));
  const cd = () => dataset({
    tickets: [quick({ id: 'c1', created: 0, total: 60 })],
    events: [
      ...[...Array(8)].map((_, i) => ev('temp_logged', i * 10, { batchId: 'b', f: 150, onTime: true, lateMs: 0 })),
      ev('temp_logged', 90, { batchId: 'b', f: 140, onTime: false, lateMs: 360000 }), ev('temp_logged', 100, { batchId: 'b', f: 140, onTime: false, lateMs: 420000 }),
      ...[true, true, true].map((ok, i) => ev('sanitize_done', 200 + i, { onTime: ok, lateMs: 0 })), ev('sanitize_done', 210, { onTime: false, lateMs: 600000 }),
      ev('batch_discard', 300, { batchId: 'x1', ing: 'brisket', g: 1000, reason: 'expired', cost: 24.36 }),
      ev('batch_discard', 310, { batchId: 'x2', ing: 'pork', g: 500, reason: 'temp', cost: 10 }),
      ev('batch_discard', 320, { batchId: 'x3', ing: 'brisket', g: 700, reason: 'expired', cost: 17 }),
      ev('batch_in', 5, { batchId: 'b', ing: 'brisket', cookedG: 10000, yieldPct: 60, src: 'cook' }), ev('batch_in', 6, { batchId: 'b2', ing: 'pork', cookedG: 10000, yieldPct: 55, src: 'cook' }),
      ev('batch_status', 330, { batchId: 'x1', from: 'ok', to: 'discard', action: 'DISCARD_LOCKOUT' }), ev('batch_status', 331, { batchId: 'x2', from: 'ok', to: 'discard', action: 'DISCARD_LOCKOUT' }),
      ev('avail_changed', 340, { menuId: 'brisket_qtr', ok: false, reason: 'safety', ing: 'brisket' }), ev('avail_changed', 940, { menuId: 'brisket_qtr', ok: true, reason: null, ing: null }),
    ],
  });
  it('compliance: temp checks on time = 8/10, lateness stats', () => {
    const k = M.compliance(cd()).tempChecks;
    assert.deepEqual([k.count, k.onTime, k.late, k.onTimePct, k.avgLateMs, k.maxLateMs], [10, 8, 2, 0.8, 390000, 420000]);
  });
  it('compliance: a check logged a few seconds or minutes after it was due still counts as on time', () => {
    const k = M.compliance(dataset({ tickets: [quick({ id: 'g1', created: 0, total: 60 })], events: [
      ev('sanitize_done', 10, { onTime: false, lateMs: 1000 }), ev('sanitize_done', 20, { onTime: false, lateMs: 4 * 60000 }),
      ev('sanitize_done', 30, { onTime: false, lateMs: 5 * 60000 }), ev('temp_logged', 40, { batchId: 'b', f: 150, onTime: false, lateMs: 1000 }),
    ] }));
    assert.deepEqual([k.sanitize.count, k.sanitize.onTime, k.sanitize.late, k.sanitize.maxLateMs], [3, 2, 1, 300000]);
    assert.deepEqual([k.tempChecks.onTime, k.tempChecks.late, k.tempChecks.maxLateMs], [1, 0, null]);
    assert.equal(M.withinGrace({ onTime: false, lateMs: 1000 }), true);
    assert.equal(M.withinGrace({ onTime: false }), false);
  });
  it('compliance: sanitise 3/4 and the score is the mean of the two on-time shares', () => {
    const k = M.compliance(cd());
    assert.deepEqual([k.sanitize.count, k.sanitize.onTimePct, k.sanitize.avgLateMs], [4, 0.75, 600000]);
    near(k.score, 0.775);
  });
  it('compliance: discards by reason (grams, cost), largest grams first; waste share of cooked intake', () => {
    const k = M.compliance(cd());
    assert.deepEqual(k.discards.byReason.map((r) => [r.reason, r.count, r.g]), [['expired', 2, 1700], ['temp', 1, 500]]);
    near(k.discards.byReason[0].cost, 41.36); near(k.discards.cost, 51.36);
    assert.deepEqual([k.discards.count, k.discards.g, k.intakeG], [3, 2200, 20000]);
    near(k.wastePct, 0.11);
  });
  it('compliance: lockouts count batch lockouts and the time items stayed 86\'d for safety', () => {
    const l = M.compliance(cd()).lockouts;
    assert.deepEqual([l.batchCount, l.spellCount, l.totalMs], [2, 1, 600000]);
    assert.equal(l.spells[0].menuId, 'brisket_qtr');
  });
  it('compliance: a lockout and the discard that follows it on one batch count as one batch', () => {
    const evs = [event({ t: at(0), type: 'batch_status', batchId: 'z1', from: 'servable', to: 'check', action: 'DISCARD_LOCKOUT' }), event({ t: at(60), type: 'batch_status', batchId: 'z1', from: 'check', to: 'discard', action: 'DISCARD_LOCKOUT' })];
    assert.equal(M.compliance(dataset({ events: evs }), { from: at(0) - 3600e3, to: at(0) + 3600e3 }).lockouts.batchCount, 1);
  });
  it('compliance on events without onTime flags counts nothing (unknown is not on time)', () => {
    const k = M.compliance(dataset({ events: [event({ type: 'temp_logged', at: 1, batchId: 'b', f: 150 })] }));
    assert.equal(k.tempChecks.count, 0); assert.equal(k.tempChecks.onTimePct, null); assert.equal(k.score, null);
  });
  it('discards fall back to batch records when no event exists, and never double count', () => {
    const b1 = batch({ id: 'x1', ing: 'brisket', entered: 0, discarded: 100, wasteG: 1000, discardReason: 'expired', costPerCookedKg: 40 });
    const b9 = batch({ id: 'x9', ing: 'brisket', entered: 0, discarded: 200, wasteG: 400, discardReason: 'temp', costPerCookedKg: 40 });
    const d = dataset({ range: { from: BASE - 1000, to: BASE + 1e6 }, batches: [b1, b9], events: [event({ type: 'batch_discard', at: 100, batchId: 'x1', ing: 'brisket', g: 1000, reason: 'expired', cost: 40 })] });
    const k = M.compliance(d).discards;
    assert.deepEqual([k.count, k.g], [2, 1400]); near(k.cost, 40 + 16);
  });
  it('wasteByDay: per service day with waste share of that day\'s intake; clean days are real zeros', () => {
    const d = dataset({
      tickets: [quick({ id: 'w1', created: 0, total: 60 }), quickAt(local(2026, 10, 17, 12), 60, { id: 'w2' })],
      events: [event({ type: 'batch_discard', at: 100, batchId: 'q', ing: 'brisket', g: 1000, reason: 'expired', cost: 20 }), event({ type: 'batch_in', at: 5, batchId: 'q', ing: 'brisket', cookedG: 5000 })],
    });
    const rows = M.wasteByDay(d);
    assert.deepEqual(rows.map((r) => [r.date, r.count, r.g, r.cost, r.intakeG, r.wastePct]), [[DAY, 1, 1000, 20, 5000, 0.2], ['2026-10-17', 0, 0, 0, 0, null]]);
  });
  it('batchTimeline: segments follow batch_status (ok, check, reheat, discard), marks carry readings and the discard', () => {
    const bt1 = batch({ id: 'bt1', label: 'Brisket batch 1', entered: 0, cookedG: 5000, discarded: 7200, wasteG: 800, discardReason: 'temp', temps: [{ t: at(0), f: 150 }, { t: at(1800), f: 148 }] });
    const bt2 = batch({ id: 'bt2', entered: 600, cookedG: 3000, remainingG: 0 });
    const bt3 = batch({ id: 'bt3', entered: 1200, cookedG: 3000, remainingG: 2000, lastTempAt: at(2400) });
    const use = ticket({ id: 'u', created: 2900, expedited: 3050, items: [item({ menu: 'brisket_qtr', fired: 2900, done: 3000, depleted: [{ ing: 'brisket', g: 100, batchId: 'bt2' }] })] });
    const st = (sec, from, to) => event({ type: 'batch_status', at: sec, batchId: 'bt1', from, to, action: 'X' });
    const tl = M.batchTimeline(dataset({ batches: [bt1, bt2, bt3], tickets: [use], events: [st(3600, 'ok', 'check'), st(4000, 'check', 'reheat'), st(6000, 'reheat', 'discard')] }), { day: DAY });
    const r1 = tl.rows[0], r2 = tl.rows[1], r3 = tl.rows[2];
    assert.deepEqual(r1.segments.map((s) => [s.tone, s.start, s.end]), [['ok', at(0), at(3600)], ['check', at(3600), at(4000)], ['reheat', at(4000), at(6000)], ['discard', at(6000), at(7200)]]);
    assert.deepEqual([r1.open, r1.endMs, r1.discardReason], [false, at(7200), 'temp']);
    assert.deepEqual(r1.marks.map((m) => m.label), ['150F', '148F', 'Thrown out (temp)']);
    assert.deepEqual([r2.endMs, r2.open, r2.segments.length], [at(3000), false, 1]);       // ended when its last grams were used
    assert.deepEqual([r3.open, r3.endMs], [true, at(2400)]);
    assert.equal(tl.rows.length, 3);
  });
});

describe('yield: thermal model vs static vs realised', () => {
  it('thermal(): 85 C / 2 h gives hot 60.2 %, chilled 58.1 %, 6020 g from 10 kg, true cost 24.36 / 0.602', () => {
    const t = M.thermal({ endpointC: 85, holdH: 2, rawG: 10000, costPerKgRaw: 24.36 });
    near(t.hotPct, 60.2); near(t.chilledPct, 58.1); near(t.cookedG, 6020); near(t.trueCostPerCookedKg, 24.36 / 0.602);
  });
  it('thermal(): clamps temperature to [75, 90] C and hold to [0, 3] h; defaults to 85 C / 2 h', () => {
    near(M.thermal({ endpointC: 100, holdH: -1 }).hotPct, 72.9 - 0.85 * 15);          // 90 C, 0 h -> 60.15
    near(M.thermal({ endpointC: 20, holdH: 9 }).hotPct, 72.9 - 6.3);                  // 75 C, 3 h -> 66.6
    near(M.thermal({ endpointC: 90, holdH: 3 }).chilledPct, 72.9 - 12.75 - 6.3 - 2.1);
    near(M.thermal({}).hotPct, 60.2);
    assert.equal(M.thermal({}).cookedG, null);
  });
  it('thermal(): same answer as the SPEC formula for a grid of inputs', () => {
    for (const T of [75, 80, 85, 88, 90]) for (const h of [0, 1, 2, 3]) near(M.thermal({ endpointC: T, holdH: h }).hotPct, 72.9 - 0.85 * (T - 75) - 2.1 * h);
  });
  const yd = (extra) => dataset({ batches: [batch({ id: 'y1', ing: 'brisket', entered: 0, rawG: 10000, cookedG: 6020, endpointC: 85, holdH: 2, ...extra })] });
  it('yieldComparison: static 55 % vs model 60.2 % vs realised 60.2 %, cost per cooked kg and the mispricing', () => {
    const y = M.yieldComparison(yd()).primary;
    assert.deepEqual([y.ing, y.thermal, y.batches, y.rawG, y.cookedG, y.staticYield], ['brisket', true, 1, 10000, 6020, 0.55]);
    near(y.modelYield, 0.602); near(y.realisedYield, 0.602); near(y.staticCookedG, 5500);
    near(y.staticCostPerCookedKg, 24.36 / 0.55); near(y.realisedCostPerCookedKg, 24.36 / 0.602); assert.equal(y.truthSource, 'realised');
    near(y.staticCostErr, 0.602 / 0.55 - 1);
    assert.match(y.line, /static 55% yield/); assert.match(y.line, /off by 9\.5%/); assert.match(y.line, /overstating/);
  });
  it('yieldComparison: realised yield differing from the model drives the true cost', () => {
    const y = M.yieldComparison(yd({ cookedG: 5000 })).primary;
    near(y.realisedYield, 0.5); near(y.modelYield, 0.602); near(y.staticCostErr, 0.5 / 0.55 - 1);
    assert.match(y.line, /understating/);
  });
  it('yieldComparison: a thermal ingredient with no batches still shows static vs the model at default conditions', () => {
    const y = M.yieldComparison(dataset()).primary;
    assert.deepEqual([y.batches, y.realisedYield, y.truthSource], [0, null, 'model']);
    near(y.modelYield, 0.602);
  });
  it('yieldComparison: non-thermal ingredients with weighed batches compare static to realised only', () => {
    const d = dataset({ batches: [batch({ id: 'p1', ing: 'pork', entered: 0, rawG: 1000, cookedG: 500 })] });
    const r = M.yieldComparison(d).rows.find((x) => x.ing === 'pork');
    assert.deepEqual([r.thermal, r.modelYield, r.realisedYield, r.staticYield], [false, null, 0.5, 0.55]);
    near(r.staticCostErr, 0.5 / 0.55 - 1);
  });
});

describe('line friction', () => {
  const fd = () => {
    const a = (i, extra) => quick(Object.assign({ id: 'a' + i, created: i * 1000, total: 100 }, extra));
    const a1 = a(1); a1.items[0].override = true;
    return dataset({
      tickets: [a1, a(2, { recalls: 1 }), a(3), a(4),
        ticket({ id: 'f1', created: 5000, expedited: 5100, forced: true, items: [item({ menu: 'slaw', fired: 5000, done: 5050 }), item({ menu: 'brisket_half', fired: 5000, started: 5010 })] }),
        ticket({ id: 'v1', created: 6000, voided: 6050, voidReason: 'wrong order', items: [item({ menu: 'slaw', fired: 6000 })] })],
      events: [
        ...[...Array(10)].map((_, i) => event({ type: 'item_done', at: i, reverted: i === 0 ? true : undefined })), ...[...Array(4)].map((_, i) => event({ type: 'ticket_expedited', at: 20 + i })),
        event({ type: 'undo', at: 30 }), event({ type: 'undo', at: 31 }),
        ...[...Array(3)].map((_, i) => event({ type: 'ui_report', at: 40 + i, action: 'createTicket', report: 'itemUnavailable' })), ...[...Array(2)].map((_, i) => event({ type: 'ui_report', at: 50 + i, action: 'bumpTicket', report: 'notAllDone' })),
      ],
    });
  };
  it('undo rate = undo events / undoable actions (undone ones included): 2 / 14', () => {
    const f = M.frictionSummary(fd());
    assert.deepEqual([f.undo.count, f.undo.actions], [2, 14]); near(f.undo.rate, 2 / 14);
    assert.equal(f.tickets, 5);
    near(f.undo.per100Tickets, 40);
  });
  it('ui_report counts by report with share and the action that triggers them most', () => {
    const f = M.frictionSummary(fd());
    assert.deepEqual(f.reports.top.map((t) => [t.report, t.count, t.share, t.topAction]), [['itemUnavailable', 3, 0.6, 'createTicket'], ['notAllDone', 2, 0.4, 'bumpTicket']]);
    assert.ok(f.reports.top[0].message.length > 0);
  });
  it('forced bumps, overrides, recalls and voids come from the tickets', () => {
    const f = M.frictionSummary(fd());
    assert.deepEqual([f.forced.count, f.forced.pct], [1, 0.2]);                     // 1 of 5 finished tickets
    assert.deepEqual([f.overrides.count], [1]); near(f.overrides.pct, 1 / 6);       // 1 of 6 lines on non-voided tickets
    assert.deepEqual([f.recalls.count, f.recalls.pct], [1, 0.2]);
    assert.deepEqual([f.voids.count, f.voids.byReason], [1, [{ reason: 'wrong order', count: 1 }]]); near(f.voids.pct, 1 / 6);
  });
});

describe('compare with the previous equal period, and range presets', () => {
  const HR = 3600e3, opts = { from: BASE, to: BASE + 3 * HR };
  const cur = (total) => [0, 600, 1200].map((s, i) => quick({ id: 'c' + i, created: s, total }));
  const prev = (total) => [-9000, -8000, -7000].map((s, i) => quick({ id: 'p' + i, created: s, total }));
  it('median 300 s now vs 600 s before: down 50 %, "faster", good', () => {
    const c = M.compare(dataset({ tickets: [...cur(300), ...prev(600)] }), opts);
    const k = c.kpis.medianMs;
    assert.deepEqual([k.current, k.previous, k.delta, k.deltaPct, k.dir, k.better, k.word], [300000, 600000, -300000, -0.5, 'down', 'good', 'faster']);
    assert.equal(k.text, '50% faster than the previous period');
    assert.deepEqual(c.prevRange, { from: BASE - 3 * HR, to: BASE }); assert.equal(c.hasPrevious, true);
  });
  it('share KPIs compare in points; going from 0 % to 100 % on time is "higher" and good', () => {
    const k = M.compare(dataset({ tickets: [...cur(300), ...prev(600)] }), opts).kpis.onTimePct;
    assert.deepEqual([k.current, k.previous, k.dir, k.better, k.word, k.deltaPct], [1, 0, 'up', 'good', 'higher', null]);
  });
  it('identical periods are flat; counts are neutral, not good or bad', () => {
    const c = M.compare(dataset({ tickets: [...cur(300), ...prev(300)] }), opts);
    assert.deepEqual([c.kpis.medianMs.dir, c.kpis.medianMs.better, c.kpis.count.dir], ['flat', 'flat', 'flat']);
    const c2 = M.compare(dataset({ tickets: [...cur(300), ...prev(300), quick({ id: 'x', created: 1800, total: 300 })] }), opts);
    assert.deepEqual([c2.kpis.count.dir, c2.kpis.count.better], ['up', 'neutral']);
  });
  it('no earlier data: hasPrevious false and nothing to compare (dir null, never a fake 0 delta)', () => {
    const c = M.compare(dataset({ tickets: cur(300) }), opts);
    assert.equal(c.hasPrevious, false);
    assert.deepEqual([c.kpis.medianMs.previous, c.kpis.medianMs.dir, c.kpis.medianMs.word], [null, null, 'no comparison']);
  });
  it('spark arrays carry one value per day of the current range', () => {
    const c = M.compare(dataset({ tickets: [...cur(300), ...prev(600)] }), opts);
    assert.deepEqual(c.spark.medianMs, [300000]);
    assert.equal(c.list.length, 12);
  });
  it('rangePresets are service-day ranges: at 12:45 am Saturday "Today" is still Friday night', () => {
    const p = Object.fromEntries(M.rangePresets(local(2026, 10, 17, 0, 45)).map((x) => [x.id, x]));
    assert.deepEqual([p.today.from, p.today.to, p.today.fromKey, p.today.toKey], [local(2026, 10, 16, 4), local(2026, 10, 17, 4), DAY, DAY]);
    assert.deepEqual([p.yesterday.from, p.yesterday.to, p.yesterday.fromKey], [local(2026, 10, 15, 4), local(2026, 10, 16, 4), '2026-10-15']);
    assert.deepEqual([p.last7.from, p.last7.to, p.last7.days, p.last7.fromKey], [local(2026, 10, 10, 4), local(2026, 10, 17, 4), 7, '2026-10-10']);
    assert.deepEqual([p.last14.from, p.last14.days], [local(2026, 10, 3, 4), 14]);
    assert.deepEqual(M.rangePresets(local(2026, 10, 17, 0, 45)).map((x) => x.label), ['Today', 'Yesterday', 'Last 7 days', 'Last 14 days']);
  });
  it('rangePresets: 4:00 am is the first moment of the new service day', () => {
    assert.equal(M.rangePresets(local(2026, 10, 17, 3, 59))[0].fromKey, DAY);
    assert.equal(M.rangePresets(local(2026, 10, 17, 4, 0))[0].fromKey, '2026-10-17');
  });
});

describe('throughput, histogram, queue load', () => {
  const td = (dayOffsetSec = 0) => [quick({ id: 'a' + dayOffsetSec, created: dayOffsetSec, total: 100 }), quick({ id: 'b' + dayOffsetSec, created: dayOffsetSec, total: 200 }), quick({ id: 'c' + dayOffsetSec, created: dayOffsetSec + 900, total: 100 }), quick({ id: 'd' + dayOffsetSec, created: dayOffsetSec + 900, total: 100 })];
  it('throughput: tickets finished and created per 15-minute bucket', () => {
    const t = M.throughput(dataset({ tickets: td() }));
    assert.equal(t.bucketMin, 15);
    assert.deepEqual(t.points.map((p) => [p.hour, p.completed, p.created, p.y]), [[12, 2, 2, 2], [12.25, 2, 2, 2]]);
    assert.equal(t.total, 4);
    assert.equal(M.throughput(dataset({ tickets: td() }), 30).points.length, 1);                    // a plain number is the bucket size
    assert.equal(M.throughput(dataset({ tickets: td() }), { bucketMin: 5 }).points[0].completed, 2);
  });
  it('throughput fold: two days averaged into time-of-day slots', () => {
    const t = M.throughput(dataset({ tickets: [...td(0), ...td(86400)] }), { fold: true });
    assert.equal(t.days, 2);
    assert.deepEqual(t.points.map((p) => [p.x, p.y, p.completed, p.created]), [[12, 2, 2, 2], [12.25, 2, 2, 2]]);
    assert.deepEqual(t.peak, { x: 12, hour: 12, y: 2 });
  });
  it('histogram: bins of binSec seconds over millisecond values; the max value gets its own bin', () => {
    const h = M.histogram([30000, 60000, 90000, 150000], 60);
    assert.deepEqual(h.counts, [1, 2, 1]);
    assert.deepEqual([h.bins[1].x0, h.bins[1].x1, h.bins[1].x0Sec, h.n, h.binSec], [60000, 120000, 60, 4, 60]);
    near(h.bins[1].share, 0.5);
  });
  it('histogram: opts.max clamps big values into the last bin and counts the overflow', () => {
    const h = M.histogram([30000, 60000, 90000, 150000], 60, { max: 120000 });
    assert.deepEqual([h.counts, h.overflow], [[1, 3], 1]);
  });
  it('ticketHistogram: per-channel counts on the same bins plus each channel\'s warn/breach lines', () => {
    const d = dataset({ tickets: [quick({ id: 'h1', created: 0, total: 30 }), quick({ id: 'h2', created: 100, total: 90, channel: 'takeout' }), quick({ id: 'h3', created: 200, total: 100, channel: 'takeout' })] });
    const h = M.ticketHistogram(d, { binSec: 60 });
    assert.deepEqual(h.bins.map((b) => b.count), [1, 2]);
    assert.deepEqual(h.bins[1].byChannel, { takeout: 2 });
    assert.deepEqual(h.channels.map((c) => [c.channel, c.warnMs, c.breachMs, c.count]), [['dine_in', 540000, 780000, 1], ['takeout', 480000, 720000, 2]]);
  });
  it('queueLoad: time-averaged open lines per station per bucket, rebuilt from firedAt/doneAt', () => {
    // pit A open 0-900 s, pit B open 450-1350 s, sides C open 0-450 s
    const t = ticket({ id: 'Q', created: 0, expedited: 1350, items: [item({ menu: 'brisket_qtr', fired: 0, done: 900 }), item({ menu: 'brisket_qtr', fired: 450, done: 1350 }), item({ menu: 'mac', fired: 0, done: 450 })] });
    const q = M.queueLoad(dataset({ tickets: [t] }));
    assert.deepEqual(q.zones, ['pit', 'sides']);
    assert.deepEqual(q.points.map((p) => [p.hour, p.byZone.pit, p.byZone.sides, p.total]), [[12, 1.5, 0.5, 2], [12.25, 0.5, 0, 0.5]]);
    assert.deepEqual(q.peak, { x: q.points[0].x, hour: 12, total: 2, zone: 'pit' });
    assert.deepEqual(q.series[0].points.map((p) => p[1]), [1.5, 0.5]);
  });
  it('queueLoad: lines still open run to `now`, and a stale ticket is capped at 12 hours', () => {
    const open = ticket({ id: 'O', created: 0, items: [item({ menu: 'brisket_qtr', fired: 0 })] });
    const q = M.queueLoad(dataset({ tickets: [open] }), { now: at(1800) });
    assert.deepEqual(q.points.map((p) => p.total), [1, 1]);
    const stale = M.queueLoad(dataset({ tickets: [open] }), { now: at(5 * 86400), bucketMin: 60 });
    assert.equal(stale.points.length, 12);
  });
});

// ---- insights --------------------------------------------------------------------------------------------------------------------------
// craft(n): n dine-in/takeout tickets, one every 5 minutes from 12:00. brisket_half 100 s of work, mac 390 s of work (starter 300 s), bumped 20 s after
// the last item (total 440 s, on time). Optional 86 of brisket at 1:42 pm.
function craft(n, o = {}) {
  const tickets = [], events = [];
  for (let i = 0; i < n; i++) {
    const c = i * 300;
    tickets.push(ticket({ id: 'k' + i, created: c, expedited: c + 440, channel: i % 2 ? 'takeout' : 'dine_in', items: [
      item({ menu: 'brisket_half', fired: c, started: c + 20, done: c + 120, depleted: [{ ing: 'brisket', g: 227 }] }),
      item({ menu: 'mac', fired: c, started: c + 30, done: c + 420 })] }));
  }
  if (o.sellout !== false) events.push(event({ type: 'avail_changed', t: local(2026, 10, 16, 13, 42), menuId: 'brisket_qtr', ok: false, reason: 'stock', ing: 'brisket' }));
  return dataset({ tickets, events: events.concat(o.events || []), batches: o.batches || [], learned: { mac: { n: 40, ema: 390, est: 385 } } });
}
const fire = (d, opts) => M.insights(d, Object.assign({ limit: 40 }, opts));
const idsOf = (d, opts) => fire(d, opts).map((f) => f.id);
const find = (d, id, opts) => fire(d, opts).find((f) => f.id === id);
const evs = (type, n, f) => [...Array(n)].map((_, i) => event(Object.assign({ type, at: 1000 + i }, typeof f === 'function' ? f(i) : f)));

describe('insights: structure, guards and determinism', () => {
  it('has at least 12 rules with unique, stable ids', () => {
    const r = M.insightRules();
    assert.ok(r.length >= 12, 'only ' + r.length + ' rules');
    assert.equal(new Set(r).size, r.length);
    assert.ok(r.includes('pace-overview') && r.includes('calibration-drift') && r.includes('pacing-effect') && r.includes('sellout-early'));
  });
  it('is silent on empty and thin data (5 tickets)', () => {
    assert.deepEqual(M.insights(dataset()), []);
    assert.deepEqual(M.insights(craft(5)), []);
    assert.deepEqual(M.insights({}), []);
  });
  it('pace-overview needs 20 finished tickets: silent at 19, speaks at 20', () => {
    assert.ok(!idsOf(craft(19)).includes('pace-overview'));
    assert.ok(idsOf(craft(20)).includes('pace-overview'));
  });
  it('crafted line data fires exactly the expected findings, most important first', () => {
    assert.deepEqual(idsOf(craft(40)), ['sellout-early', 'calibration-drift', 'bottleneck-station', 'pace-overview']);
  });
  it('findings cite real numbers: mac takes 6m 30s, 1m 30s over the 5m 00s starter, pacing already plans for it', () => {
    const f = find(craft(40), 'calibration-drift');
    assert.equal(f.tone, 'warn');
    assert.match(f.title, /Smoked mac and cheese takes 6m 30s on your line/);
    assert.match(f.body, /1m 30s over the starter estimate of 5m 00s/);
    assert.match(f.body, /Finish together now plans for it/);
    assert.match(f.body, /40 samples/);
  });
  it('without a matching learned estimate the finding tells the owner to confirm instead', () => {
    const d = craft(40); d.learned = {};
    assert.match(find(d, 'calibration-drift').body, /Confirm the new time in Menu, prices and shop/);
  });
  it('sellout-early names the time, hours before close and a gram-based shortfall estimate', () => {
    const f = find(craft(40), 'sellout-early');
    assert.equal(f.tone, 'bad');
    assert.equal(f.title, 'Smoked brisket'.replace('Smoked brisket', 'Brisket') + ' went 86 at 1:42 pm');
    assert.match(f.body, /7\.3 hours before close/);
    assert.match(f.body, /kg more cooked brisket would have lasted to close/);
    assert.doesNotMatch(f.body, /Pitcall/);
  });
  it('sellout-early stays silent on a thin day (< 30 tickets) and for an 86 in the last 90 minutes', () => {
    assert.ok(!idsOf(craft(25)).includes('sellout-early'));
    const late = craft(40, { sellout: false, events: [event({ type: 'avail_changed', t: local(2026, 10, 16, 19, 45), menuId: 'brisket_qtr', ok: false, reason: 'stock', ing: 'brisket' })] });
    assert.ok(!idsOf(late).includes('sellout-early'));
  });
  it('is deterministic and every finding has id, tone, title, body with a number in it', () => {
    const d = craft(40);
    assert.deepEqual(M.insights(d), M.insights(d));
    for (const f of fire(d)) {
      assert.ok(['good', 'info', 'warn', 'bad'].includes(f.tone));
      assert.ok(typeof f.id === 'string' && f.title.length > 0 && /\d/.test(f.body), f.id);
    }
  });
  it('returns at most 8, sorted by importance, and opts.limit trims further', () => {
    const extra = [
      ...evs('temp_logged', 10, (i) => ({ batchId: 'b', f: 150, onTime: i < 4, lateMs: i < 4 ? 0 : 600000 })),
      ...evs('sanitize_done', 4, (i) => ({ onTime: i < 3, lateMs: i < 3 ? 0 : 720000 })),
      ...evs('batch_discard', 3, (i) => ({ batchId: 'w' + i, ing: 'brisket', g: 1000, reason: 'expired', cost: 20 })), ...evs('batch_in', 1, { batchId: 'bi', ing: 'brisket', cookedG: 20000 }),
      ...evs('sync_done', 10, (i) => ({ syncId: 's' + i, menuId: 'brisket_qtr', target: 'pos', latencyMs: i < 7 ? 10000 : 90000 })),
      ...evs('ui_report', 8, (i) => ({ action: 'createTicket', report: i < 5 ? 'itemUnavailable' : 'badQty' })),
      event({ type: 'avail_changed', at: 2000, menuId: 'mac', ok: false, reason: 'safety', ing: 'mac' }), event({ type: 'avail_changed', at: 2600, menuId: 'mac', ok: true, reason: null, ing: null }),
    ];
    const d = craft(40, { events: extra });
    const all = fire(d), top = M.insights(d);
    assert.ok(all.length >= 9, 'expected >= 9 findings, got ' + all.length);
    assert.equal(top.length, 8);
    assert.deepEqual(top.map((f) => f.id), all.slice(0, 8).map((f) => f.id));
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].importance >= all[i].importance);
    assert.ok(!top.map((f) => f.id).includes('pace-overview'));            // the calm "good" note drops out first
    assert.equal(M.insights(d, { limit: 3 }).length, 3);
  });
});

describe('insights: each rule fires on crafted data and has its own guard', () => {
  const twoItem = (id, c, pacing, spread) => ticket({ id, created: c, expedited: c + spread + 30, pacing, items: [item({ menu: 'slaw', fired: c, done: c + 100 }), item({ menu: 'potato', fired: c, done: c + 100 + spread })] });
  const many = (n, make) => [...Array(n)].map((_, i) => make(i));
  it('pacing-effect: lamp 1m 00s -> 0m 05s per plate (needs 15 multi-item tickets on each side)', () => {
    const mk = (n) => dataset({ tickets: [...many(n, (i) => twoItem('p' + i, i * 400, true, 10)), ...many(n, (i) => twoItem('u' + i, 100000 + i * 400, false, 120))] });
    const f = find(mk(15), 'pacing-effect');
    assert.equal(f.tone, 'good');
    assert.equal(f.title, 'With Finish together on, plates finished together: food waited 0m 05s instead of 1m 00s');
    assert.match(f.body, /plate spread went from 2m 00s to 0m 10s/);
    assert.match(f.body, /different tickets, so treat it as a hint, not a controlled test/);
    assert.doesNotMatch(f.title + ' ' + f.body, /faster tickets|quicker tickets/);
    assert.equal(find(mk(14), 'pacing-effect'), undefined);
  });
  it('pacing-effect says pacing is not meant to make tickets faster when the median rose with Finish together on', () => {
    // paced tickets are held 300 s before the last item is done, so their median ticket time is longer
    const slowTwo = (id, c, spread) => ticket({ id, created: c, expedited: c + 400 + spread, pacing: true, items: [item({ menu: 'slaw', fired: c + 300, done: c + 400 }), item({ menu: 'potato', fired: c + 300, done: c + 400 + spread })] });
    const d = dataset({ tickets: [...many(15, (i) => slowTwo('p' + i, i * 600, 10)), ...many(15, (i) => twoItem('u' + i, 100000 + i * 400, false, 120))] });
    const f = find(d, 'pacing-effect');
    assert.equal(f.tone, 'good');
    assert.match(f.body, /not meant to make tickets faster/);
    assert.match(f.body, /Median ticket time was \d+m \d+s with Finish together off and \d+m \d+s with it on/);
  });
  it('pacing-effect warns when pacing made plates wait longer', () => {
    const d = dataset({ tickets: [...many(15, (i) => twoItem('p' + i, i * 400, true, 120)), ...many(15, (i) => twoItem('u' + i, 100000 + i * 400, false, 10))] });
    assert.equal(find(d, 'pacing-effect').tone, 'warn');
  });
  it('temp-checks: 40 % on time is bad; silent below 10 readings', () => {
    const mk = (n) => dataset({ tickets: [quick({ id: 'q' })], events: evs('temp_logged', n, (i) => ({ batchId: 'b', f: 150, onTime: i < 4, lateMs: i < 4 ? 0 : 600000 })) });
    const f = find(mk(10), 'temp-checks');
    assert.equal(f.tone, 'bad'); assert.equal(f.title, '40% of temperature checks were on time'); assert.match(f.body, /6 of 10 readings came late, by 10m 00s on average/);
    assert.match(f.body, /local health-code rules override this/);
    assert.equal(find(mk(9), 'temp-checks'), undefined);
  });
  it('sanitize-late: all on time is good, 3 of 4 is a warning, < 4 events is silent', () => {
    const mk = (n, ok) => dataset({ events: evs('sanitize_done', n, (i) => ({ onTime: i < ok, lateMs: 600000 })) });
    assert.equal(find(mk(4, 4), 'sanitize-late').title, 'Every sanitize was on time');
    const w = find(mk(4, 3), 'sanitize-late'); assert.deepEqual([w.tone, w.title], ['warn', '1 of 4 sanitizes were late']);
    assert.equal(find(mk(3, 3), 'sanitize-late'), undefined);
  });
  it('forced-bumps: 2 of 20 finished tickets (10 %) warns', () => {
    const forcedT = (i) => ticket({ id: 'f' + i, created: 10000 + i * 400, expedited: 10100 + i * 400, forced: true, items: [item({ menu: 'slaw', fired: 10000 + i * 400, done: 10050 + i * 400 }), item({ menu: 'brisket_half', fired: 10000 + i * 400, started: 10010 + i * 400 })] });
    const d = dataset({ tickets: [...many(18, (i) => quick({ id: 'n' + i, created: i * 400, total: 100 })), forcedT(0), forcedT(1)] });
    const f = find(d, 'forced-bumps');
    assert.deepEqual([f.tone, f.title], ['warn', '2 tickets were bumped with food unfinished']);
    assert.match(f.body, /10% of 20 finished tickets/);
    assert.equal(find(dataset({ tickets: [...many(18, (i) => quick({ id: 'n' + i, created: i * 400, total: 100 })), forcedT(0)] }), 'forced-bumps'), undefined);   // 1 of 19 = 5.3 %, but under 20 tickets -> silent
  });
  it('waste: 3 kg thrown away of 20 kg cooked is 15 % -> bad; thin data is silent', () => {
    const mk = (nd, intake) => dataset({ tickets: [quick({ id: 'q' })], events: [...evs('batch_discard', nd, (i) => ({ batchId: 'w' + i, ing: 'brisket', g: 1000, reason: 'expired', cost: 20 })), ...evs('batch_in', 1, { batchId: 'bi', ing: 'brisket', cookedG: intake })] });
    const f = find(mk(3, 20000), 'waste');
    assert.deepEqual([f.tone, f.title], ['bad', 'Discards cost $60 (3.0 kg)']);
    assert.match(f.body, /3 batches were thrown away, 15% of the cooked food\. Biggest reason: expired \(3\.0 kg\)/);
    assert.equal(find(mk(2, 4000), 'waste'), undefined);
    assert.equal(find(mk(0, 25000), 'waste').tone, 'good');
  });
  it('food-cost: 40 % of menu price warns; needs 30 costed lines', () => {
    const mk = (n) => dataset({ tickets: many(n, (i) => quick({ id: 'c' + i, created: i * 400, total: 100, cost: 3 })) });
    const f = find(mk(30), 'food-cost');
    assert.deepEqual([f.tone, f.title], ['warn', 'Food cost is 40% of menu price']);
    assert.match(f.body, /30 costed lines the ingredients cost \$90\.00 against \$225\.00/);
    assert.equal(find(mk(29), 'food-cost'), undefined);
  });
  it('yield-misprice: static 55 % vs model 60.2 % is 9.5 % off; needs 3 weighed batches', () => {
    const mk = (n) => dataset({ batches: many(n, (i) => batch({ id: 'y' + i, ing: 'brisket', entered: i * 100, rawG: 10000, cookedG: 6020, endpointC: 85, holdH: 2 })) });
    const f = find(mk(3), 'yield-misprice');
    assert.deepEqual([f.tone, f.title], ['warn', 'The static brisket yield misprices cost by 9.5%']);
    assert.match(f.body, /\$44\.29 per cooked kg instead of \$40\.47/);
    assert.equal(find(mk(2), 'yield-misprice'), undefined);
  });
  it('voids: 3 of 30 tickets (10 %) is bad; recalls: 4 of 40 is info', () => {
    const vd = (i) => ticket({ id: 'v' + i, created: 20000 + i * 400, voided: 20050 + i * 400, voidReason: 'customer left', items: [item({ menu: 'slaw', fired: 20000 + i * 400 })] });
    const f = find(dataset({ tickets: [...many(27, (i) => quick({ id: 'n' + i, created: i * 400, total: 100 })), vd(0), vd(1), vd(2)] }), 'voids');
    assert.deepEqual([f.tone, f.title], ['bad', '3 tickets were voided']); assert.match(f.body, /Most common reason: customer left \(3\)/);
    const r = find(dataset({ tickets: many(40, (i) => quick({ id: 'r' + i, created: i * 400, total: 100, recalls: i < 4 ? 1 : 0 })) }), 'recalls');
    assert.deepEqual([r.tone, r.title], ['info', '4 tickets were recalled after a bump']);
  });
  it('safety-lockouts: an item 86\'d by a safety lockout is reported with its duration', () => {
    const d = dataset({ tickets: many(20, (i) => quick({ id: 'n' + i, created: i * 400, total: 100 })), events: [event({ type: 'avail_changed', at: 100, menuId: 'brisket_qtr', ok: false, reason: 'safety', ing: 'brisket' }), event({ type: 'avail_changed', at: 1300, menuId: 'brisket_qtr', ok: true, reason: null, ing: null })] });
    const f = find(d, 'safety-lockouts');
    assert.equal(f.tone, 'warn'); assert.match(f.body, /Brisket, 1\/4 lb for 20m 00s/);
  });
  it('slow-hour: 1-2 pm median 8m 20s against 6m 40s overall', () => {
    const d = dataset({ tickets: [...many(20, (i) => quick({ id: 'a' + i, created: i * 100, total: 300 })), ...many(20, (i) => quick({ id: 'b' + i, created: 3600 + i * 100, total: 500 }))] });
    const f = find(d, 'slow-hour');
    assert.equal(f.title, '1 to 2 pm is your slowest hour');
    assert.match(f.body, /between 1 and 2 pm/); assert.match(f.body, /8m 20s/); assert.match(f.body, /6m 40s across the whole range/);
  });
  it('channel-gap: takeout 3m 20s slower than dine-in between 12 and 1 pm', () => {
    const d = dataset({ tickets: [...many(6, (i) => quick({ id: 'd' + i, created: i * 200, total: 300 })), ...many(6, (i) => quick({ id: 't' + i, created: 100 + i * 200, total: 500, channel: 'takeout' }))] });
    const f = find(d, 'channel-gap');
    assert.equal(f.title, 'Takeout ran 3m 20s slower than dine-in');
    assert.match(f.body, /between 12 and 1 pm: median 8m 20s against 5m 00s \(6 and 6 tickets\)/);
    const thin = dataset({ tickets: [...many(4, (i) => quick({ id: 'd' + i, created: i * 200, total: 300 })), ...many(4, (i) => quick({ id: 't' + i, created: 100 + i * 200, total: 500, channel: 'takeout' }))] });
    assert.equal(find(thin, 'channel-gap'), undefined);
  });
  it('top-error and undo-rate: most common error message, and undo at 10 % of actions', () => {
    const d = dataset({ tickets: [quick({ id: 'q' })], events: [...evs('ui_report', 8, (i) => ({ action: 'createTicket', report: i < 5 ? 'itemUnavailable' : 'badQty' })), ...evs('item_done', 40, {}), ...evs('undo', 4, {})] });
    const e = find(d, 'top-error'); assert.equal(e.tone, 'info'); assert.match(e.body, /5 of 8 error messages \(63%\)/);
    const u = find(d, 'undo-rate'); assert.equal(u.title, 'Undo was used 4 times (10% of actions)');
    assert.equal(find(dataset({ events: [...evs('item_done', 39, {}), ...evs('undo', 4, {})] }), 'undo-rate'), undefined);       // < 40 actions
  });
  it('expo-dwell: 3m 20s waiting at expo is flagged', () => {
    const d = dataset({ tickets: many(20, (i) => ticket({ id: 'e' + i, created: i * 400, expedited: i * 400 + 300, items: [item({ menu: 'slaw', fired: i * 400, done: i * 400 + 100 })] })) });
    const f = find(d, 'expo-dwell'); assert.equal(f.title, 'Finished tickets wait 3m 20s at expo'); assert.match(f.body, /67% of an average ticket \(5m 00s\)/);
  });
  it('sellout-repeat: the same protein sold out on 3 of 4 days is flagged bad', () => {
    const day = (d, sell) => [quickAt(local(2026, 10, d, 12), 300, { id: 'd' + d }), ...(sell ? [event({ type: 'avail_changed', t: local(2026, 10, d, 15), menuId: 'brisket_qtr', ok: false, reason: 'stock', ing: 'brisket' })] : [])];
    const parts = [day(10, true), day(11, true), day(12, true), day(13, false)];
    const f = find(dataset({ tickets: parts.flatMap((p) => p.filter((x) => x.items)), events: parts.flatMap((p) => p.filter((x) => !x.items)) }), 'sellout-repeat');
    assert.deepEqual([f.tone, f.title], ['bad', 'Brisket sold out on 3 of 4 days']);
    assert.match(f.body, /6\.0 hours before close/);
  });
});

describe('headline sentences', () => {
  it('pace: median, p90, on-time share, and a caution on thin data', () => {
    const h = M.headline('pace', craft(40));
    assert.match(h, /Half of tickets are out in 7m 20s and 9 in 10 within 7m 20s; 100% beat their warning time\./);
    assert.match(M.headline('pace', craft(5)), /Only 5 tickets so far/);
    assert.equal(M.headline('pace', dataset()), 'No finished tickets in this range yet.');
  });
  it('tickets, stations, money, safety, stock, data each speak in numbers', () => {
    const d = craft(40, { events: evs('temp_logged', 10, (i) => ({ batchId: 'b', f: 150, onTime: i < 4, lateMs: 600000 })) });
    assert.match(M.headline('tickets', d), /Most of a ticket's 7m 20s average goes to cooking and plating \(89%\)/);
    assert.match(M.headline('stations', d), /Hot sides finished last on 100% of tickets; 1 item runs outside 0\.8 to 1\.25 times the starter prep time/);
    assert.match(M.headline('money', d), /No paid orders yet\. Finished food worth \$780 at menu price over 40 finished tickets, \$19\.50 per ticket/);
    assert.match(M.headline('safety', d), /40% of 10 temperature checks were on time/);
    const one = dataset({ tickets: [quick({ id: 'o1', created: 0, total: 60 })], events: [event({ type: 'sanitize_done', at: 10, onTime: false, lateMs: 600000 })] });
    assert.match(M.headline('safety', one), /^No temperature checks logged, the one sanitize round was late;/);
    assert.match(M.headline('stock', d), /1 protein sell-out in 1 day, the earliest brisket at 1:42 pm \(7\.3 hours before close\)/);
    assert.match(M.headline('data', d), /40 tickets in this range \(0 sample, 40 live\)/);
  });
  it('every page has a calm no-data sentence and an unknown page still answers', () => {
    for (const p of ['pace', 'tickets', 'stations', 'money', 'safety', 'stock', 'data']) assert.match(M.headline(p, dataset()), /^No .+\.$/, p);
    assert.ok(M.headline('mystery', dataset()).length > 0);
  });
});

describe('prepare(): one shared pass per dataset snapshot', () => {
  const base = () => dataset({ tickets: [quick({ id: 'a', created: 0, total: 300 }), quick({ id: 'b', created: 60, total: 420, channel: 'takeout' }), quick({ id: 'c', created: 120, total: 360 })], range: { from: at(-10), to: at(5000) } });
  it('a handle answers every metric exactly like the dataset does', () => {
    const d = base(), p = M.prepare(d);
    assert.deepEqual(M.summary(p), M.summary(d)); assert.deepEqual(M.byHour(p), M.byHour(d)); assert.deepEqual(M.insights(p), M.insights(d));
    assert.deepEqual(M.byChannel(p), M.byChannel(d)); assert.deepEqual(M.compare(p), M.compare(d)); assert.equal(M.headline('pace', p), M.headline('pace', d));
  });
  it('the same dataset and options give the same handle; other options or an edited snapshot give a new one', () => {
    const d = base(), p = M.prepare(d);
    assert.equal(M.prepare(d), p); assert.equal(M.prepare(p), p);                                   // a handle prepares to itself
    assert.notEqual(M.prepare(d, { channel: 'takeout' }), p);
    assert.equal(M.summary(M.prepare(d, { channel: 'takeout' })).count, 1);
    assert.equal(M.summary(p).count, 3);
    d.tickets.push(quick({ id: 'd', created: 200, total: 300 }));                                    // grows in place: the length check notices
    const p2 = M.prepare(d); assert.notEqual(p2, p); assert.equal(M.summary(p2).count, 4);
    d.tickets = d.tickets.slice(0, 2);                                                               // replaced array: the reference check notices
    const p3 = M.prepare(d); assert.notEqual(p3, p2); assert.equal(M.summary(p3).count, 2);
    const d2 = Object.assign({}, d, { range: { from: at(-10), to: at(30) } });                       // other range, one ticket in it
    assert.notEqual(M.prepare(d2), p3); assert.equal(M.summary(M.prepare(d2)).count, 1);
    M.unprepare(d); assert.notEqual(M.prepare(d), p3);
  });
  it('junk input still returns a usable handle', () => {
    for (const bad of [undefined, null, 5, 'x', [], {}]) { const p = M.prepare(bad); assert.equal(M.summary(p).count, 0); noNaN(M.insights(p), 'prepare junk'); }
  });
});

describe('agreement with the engine (only when SB.engine is loaded)', { skip: !(await loadSB(['20-engine']).then((x) => !!(x.engine && x.engine.thermalYield)).catch(() => false)) }, () => {
  it('thermal() matches SB.engine.thermalYield on a grid of temperatures and hold times', () => {
    for (const endpointC of [undefined, 60, 75, 80, 85, 90, 99]) for (const holdH of [undefined, -1, 0, 1, 2, 3, 5]) {
      const a = M.thermal({ endpointC, holdH, rawG: 10000, costPerKgRaw: 12 }), b = SB.engine.thermalYield({ endpointC, holdH, rawG: 10000, costPerKgRaw: 12 });
      assert.equal(a.endpointC, b.endpointC); assert.equal(a.holdH, b.holdH);
      near(a.hotPct, b.hotPct, 1e-3); near(a.chilledPct, b.chilledPct, 1e-3); near(a.cookedG, b.cookedG, 1); near(a.trueCostPerCookedKg, b.trueCostPerCookedKg, 0.01);
    }
  });
  it('a real engine run produces a dataset the metrics read without a single NaN', () => {
    const E = SB.engine; let st = E.newState({ now: BASE });
    const step = (type, payload, t) => { const r = E.apply(st, type, payload, t); assert.equal(r.report, 'ok', type + ' ' + r.report); st = r.state; return r; };
    step('addBatch', { ing: 'brisket', tempF: 150, rawG: 8000, cookedG: 4800 }, BASE);
    const made = [];
    for (let i = 0; i < 6; i++) made.push(step('createTicket', { customer: 'T' + i, channel: i % 2 ? 'takeout' : 'dine_in', items: [{ menuId: 'brisket_half' }, { menuId: 'slaw' }] }, BASE + i * 60000).info);
    for (const info of made) {
      const t = E.findTicket(st, info.ticketId);
      for (const it of t.items) { step('advanceItem', { ticketId: t.id, itemId: it.id }, BASE + 600000); if (E.findTicket(st, t.id).items.find((x) => x.id === it.id).status !== 'done') step('completeItem', { ticketId: t.id, itemId: it.id }, BASE + 900000); }
      step('bumpTicket', { ticketId: t.id }, BASE + 960000);
    }
    step('logTemp', { batchId: E.allEvents(st).find((e) => e.type === 'batch_in').batchId, tempF: 148 }, BASE + 1000000);
    const ds = { tickets: st.tickets, events: E.allEvents(st), batches: st.batches, learned: st.learned, menu: st.menu, ingredients: st.ingredients, settings: st.settings, range: { from: BASE - 1, to: BASE + 2000000 } };
    const p = M.prepare(ds, { now: BASE + 2000000 });
    const out = [M.summary(p), M.ticketAnatomy(p), M.anatomySummary(p), M.plateSync(p), M.sla(p), M.byHour(p), M.byWeekdayHour(p), M.byChannel(p), M.byZone(p), M.byItem(p), M.byDay(p), M.throughput(p), M.queueLoad(p),
      M.pacingCompare(p), M.calibration(p), M.stockBurn(p, { ing: 'brisket' }), M.sellOutClock(p), M.syncLatency(p), M.compliance(p), M.wasteByDay(p), M.batchTimeline(p), M.revenueByHour(p), M.avgTicketValue(p),
      M.foodCostPct(p), M.marginByItem(p), M.yieldComparison(p), M.frictionSummary(p), M.compare(p), M.paceIndex(p), M.insights(p), M.headline('pace', p)];
    noNaN(out, 'engine run');
    assert.equal(M.summary(p).count, 6); assert.equal(M.summary(p).forced, 0);
    assert.equal(M.ticketAnatomy(p).length, 6); assert.ok(M.ticketAnatomy(p).every((r) => sumParts(r) === r.totalMs));
    assert.equal(M.compliance(p).tempChecks.count, 1);
  });
});

describe('performance: 5000 tickets / 40000 events', () => {
  function big() {
    const rng = U.rng(20261017), tickets = [], events = [];
    const menus = ['brisket_half', 'mac', 'slaw', 'pork_qtr', 'fried_pickles', 'cornbread', 'ribs_half', 'tea'];
    for (let i = 0; i < 5000; i++) {
      const day = Math.floor(i / 360), created = local(2026, 10, 1 + day, 11) + Math.floor(rng.range(0, 10 * 3600)) * 1000, ch = rng.pick(['dine_in', 'dine_in', 'takeout', 'drive_thru', 'third_party']);
      const items = []; let last = created;
      for (let k = 0; k < 4; k++) {
        const menu = rng.pick(menus), fired = created + (day >= 5 ? Math.floor(rng.range(0, 120)) * 1000 : 0), started = fired + Math.floor(rng.range(5, 40)) * 1000, done = started + Math.floor(rng.range(30, 420)) * 1000;
        items.push(item({ menu, firedAt: fired, startedAt: SB.config.menuById[menu].track === 'two' ? started : undefined, doneAt: done, cost: 1.5, depleted: [{ ing: 'brisket', g: 100 }] })); if (done > last) last = done;
      }
      const forced = rng.chance(0.02), voided = rng.chance(0.02);
      tickets.push(ticket({ id: 'b' + i, num: 100 + i, createdAt: created, expeditedAt: voided ? undefined : last + 20000, channel: ch, pacing: day >= 5, forced: forced || undefined, status: voided ? 'voided' : 'expedited', items }));
      events.push(event({ type: 'ticket_created', t: created }), event({ type: 'item_done', t: last }), event({ type: 'item_done', t: last }), event({ type: 'item_done', t: last }), event({ type: 'item_done', t: last }), event({ type: 'ticket_expedited', t: last + 20000 }), event({ type: 'item_fired', t: created }));
    }
    const base = local(2026, 10, 1, 11);
    for (let i = 0; i < 5000; i++) {
      const t = base + Math.floor(rng.range(0, 14 * 86400)) * 1000, k = i % 8;
      events.push(k === 0 ? event({ type: 'temp_logged', t, batchId: 'b', f: 150, onTime: rng.chance(0.9), lateMs: 600000 }) : k === 1 ? event({ type: 'sync_done', t, menuId: 'brisket_qtr', target: 'pos', latencyMs: Math.floor(rng.range(2000, 40000)) })
        : k === 2 ? event({ type: 'avail_changed', t, menuId: 'brisket_qtr', ok: rng.chance(0.5), reason: 'stock', ing: 'brisket' }) : k === 3 ? event({ type: 'ui_report', t, action: 'createTicket', report: 'itemUnavailable' })
        : k === 4 ? event({ type: 'undo', t }) : k === 5 ? event({ type: 'batch_discard', t, batchId: 'w' + i, ing: 'brisket', g: 500, reason: 'expired', cost: 10 }) : k === 6 ? event({ type: 'batch_in', t, batchId: 'i' + i, ing: 'brisket', cookedG: 5000 }) : event({ type: 'sanitize_done', t, onTime: rng.chance(0.9), lateMs: 60000 }));
    }
    return dataset({ tickets, events });
  }
  // Timing on a shared, loaded VM is noisy, so each measurement is taken up to five times on a fresh shallow copy of the dataset (new context, nothing memoised from the
  // previous attempt) and the best one is judged. Attempt 1 is the cold reading (JIT not yet warmed past the small slice below) and is printed too.
  const four = (src) => { const t0 = performance.now(), s = M.summary(src), t1 = performance.now(), bh = M.byHour(src), t2 = performance.now(), hm = M.byWeekdayHour(src), t3 = performance.now(), ins = M.insights(src), t4 = performance.now(); return { ms: t4 - t0, parts: [t1 - t0, t2 - t1, t3 - t2, t4 - t3], s, bh, hm, ins }; };
  // The budget is judged on the MEDIAN of three timed runs (after one untimed warm-up of the whole path), so one slow moment on a busy machine
  // cannot fail it. The limit is 400 ms (a quiet machine reads about 240 ms); a real slowdown of the analytics still shows up well above it.
  const budget = (label, run, t) => {
    run(); // warm-up, not timed
    const tries = []; let last;
    for (let i = 0; i < 3; i++) { last = run(); tries.push(last.ms); }
    const sorted = tries.slice().sort((x, y) => x - y), median = sorted[1];
    t.diagnostic(`${label} over 5000 tickets / 40000 events: median ${median.toFixed(1)} ms of ${tries.map((x) => x.toFixed(0)).join(', ')} (last split: summary ${last.parts[0].toFixed(0)}, byHour ${last.parts[1].toFixed(0)}, heatmap ${last.parts[2].toFixed(0)}, insights ${last.parts[3].toFixed(0)})`);
    assert.ok(median < 400, `median ${median.toFixed(1)} ms (runs ${tries.map((x) => x.toFixed(0)).join(', ')})`);
    return last;
  };
  it('timing: summary + byHour + heatmap + insights finish in under 400 ms (median of three)', (t) => {
    const d = big();
    assert.equal(d.tickets.length, 5000); assert.equal(d.events.length, 40000);
    M.insights(dataset({ tickets: d.tickets.slice(0, 100), events: d.events.slice(0, 500) }));      // warm-up on a small slice so JIT start-up is not billed to the budget
    const r = budget('direct calls (summary + byHour + heatmap + insights)', () => four(Object.assign({}, d)), t);
    assert.ok(r.s.count > 4000 && r.bh.length > 8 && r.hm.rows.length === 7 && Array.isArray(r.ins));
  });
  it('a prepared handle gives the same answers and stays inside the same budget', (t) => {
    const d = big();
    M.insights(dataset({ tickets: d.tickets.slice(0, 100), events: d.events.slice(0, 500) }));
    const r = budget('prepared handle (M.prepare, one shared pass)', () => { const t0 = performance.now(), p = M.prepare(Object.assign({}, d)), o = four(p); o.ms = performance.now() - t0; return o; }, t);
    const direct = four(Object.assign({}, d));
    assert.deepEqual(r.s, direct.s); assert.deepEqual(r.bh, direct.bh); assert.deepEqual(r.hm, direct.hm); assert.deepEqual(r.ins, direct.ins);
  });
  it('the other breakdowns stay fast and well-formed at this size', () => {
    const d = big(), t0 = performance.now();
    const out = [M.byChannel(d), M.byZone(d), M.byItem(d), M.byDay(d), M.throughput(d), M.queueLoad(d), M.calibration(d), M.compliance(d), M.pacingCompare(d), M.compare(d), M.frictionSummary(d), M.sellOutClock(d)];
    const ms = performance.now() - t0;
    noNaN(out, 'big');
    assert.ok(ms < 1500, `took ${ms.toFixed(1)} ms`);
  });
});

describe('fixes found while commenting', () => {
  // seconds after BASE, one-item tickets: total = bumped - created
  const mk = (id, bumped, tot, channel) => quick({ id, created: bumped - tot, total: tot, channel });
  it('an unknown channel keeps its own id as the name (not the first channel\'s name)', () => {
    const d = dataset({ tickets: [mk('a', 1000, 300, 'mystery'), mk('b', 1100, 300, 'dine_in')] });
    const row = M.byChannel(d).find((c) => c.channel === 'mystery');
    assert.equal(row.name, 'mystery'); assert.equal(row.short, 'mystery');
    assert.equal(M.byChannel(d).find((c) => c.channel === 'dine_in').name, SB.config.channelById.dine_in.name);
  });
  it('a cooling batch moves grams that were already counted, so it is not new intake (F-S6)', () => {
    const hot = batch({ id: 'h1', cookedG: 3000, entered: 100 });
    const cool = batch({ id: 'c1', kind: 'cooling', cookedG: 1000, entered: 900, ing: 'brisket' });
    const d = dataset({ batches: [hot, cool] });
    assert.equal(M.compliance(d).intakeG, 3000); assert.equal(M.compliance(d).batchesIn, 1);
  });
  it('paceIndex through a prepared handle keeps the handle\'s channel filter', () => {
    const tix = []; for (let i = 0; i < 6; i++) { tix.push(mk('d' + i, 1000 + i * 50, 300, 'dine_in')); tix.push(mk('t' + i, 1025 + i * 50, 300, 'drive_thru')); }
    const d = dataset({ tickets: tix }), now = at(3600);
    assert.equal(M.paceIndex(d, { now }).n, 10);
    const h = M.prepare(d, { channel: 'drive_thru' });
    const p = M.paceIndex(h, { now });
    assert.equal(p.n, 6); assert.deepEqual(p.mix.map((m) => m.channel), ['drive_thru']);
  });
});

describe('sales: what the till took from paid orders', () => {
  // A paid order as the engine freezes it: food, discount and tax in totals, the tip and method beside them.
  const paid = (id, sec, o = {}) => ({ id, status: 'paid', createdAt: at(sec - 600), paidAt: at(sec), channel: o.channel || 'dine_in', method: o.method || 'cash', tip: o.tip || 0,
    totals: { subtotal: o.sub, discount: o.disc || 0, tax: o.tax || 0, total: o.sub - (o.disc || 0) + (o.tax || 0), qty: 1, rounds: 1, taxRate: 0 } });
  const range = { from: at(-3600), to: at(86400) };
  it('adds up net sales, tax, tips and what was collected, with a check average', () => {
    const d = dataset({ range, orders: [paid('o_1', 0, { sub: 20, tax: 1.3, tip: 4, method: 'card' }), paid('o_2', 120, { sub: 10, disc: 2, tax: 0.52, method: 'cash' }), paid('o_3', 3700, { sub: 30, channel: 'takeout', method: 'cash', tip: 2 })] });
    const s = M.sales(d);
    assert.deepEqual([s.checks, s.gross, s.discounts, s.net], [3, 60, 2, 58]);
    near(s.tax, 1.82); near(s.tips, 6); near(s.total, 59.82); near(s.collected, 65.82);
    near(s.avgCheck, 58 / 3); near(s.tipPct, 6 / 58);
    assert.deepEqual(s.byMethod.map((m) => [m.method, m.checks]), [['cash', 2], ['card', 1]]);
    assert.deepEqual(s.byChannel.map((c) => [c.channel, c.checks]), [['dine_in', 2], ['takeout', 1]]);
    assert.equal(s.byDay.length, 1);
    assert.deepEqual(s.byHour.map((h) => [h.hour, h.checks]), [[12, 2], [13, 1]]);
    noNaN(s, 'sales');
  });
  it('counts open and voided orders on the side and keeps them out of the takings', () => {
    const open = { id: 'o_4', status: 'open', createdAt: at(30), channel: 'dine_in' };
    const gone = { id: 'o_5', status: 'voided', createdAt: at(40), channel: 'dine_in' };
    const t = ticket({ id: 'T9', created: 30, items: [item({ menu: 'slaw', qty: 2 })] }); t.orderId = 'o_4';
    const d = dataset({ range, tickets: [t], orders: [paid('o_1', 0, { sub: 20 }), open, gone] });
    const s = M.sales(d);
    assert.deepEqual([s.checks, s.net, s.open.orders, s.voided], [1, 20, 1, 1]);
    near(s.open.value, 2 * SB.config.menuById.slaw.price);
  });
  it('honors the range and a channel filter, and skips orders with no frozen totals', () => {
    const noTotals = { id: 'o_6', status: 'paid', createdAt: at(0), paidAt: at(10), channel: 'dine_in', method: 'cash' };
    const d = dataset({ range, orders: [paid('o_1', 0, { sub: 20 }), paid('o_2', 90000, { sub: 50 }), paid('o_3', 60, { sub: 5, channel: 'takeout' }), noTotals] });
    assert.equal(M.sales(d).checks, 2);
    assert.equal(M.sales(d, { channel: 'takeout' }).net, 5);
    assert.equal(M.sales(d, { from: at(-100), to: at(200000) }).checks, 3);
  });
  it('gives zeros and no averages when nothing was paid', () => {
    const s = M.sales(dataset({ range }));
    assert.deepEqual([s.checks, s.net, s.collected, s.avgCheck, s.tipPct, s.byDay.length], [0, 0, 0, null, null, 0]);
  });
});

describe('parseDollars: typed money in the pay box', () => {
  it('reads plain, dollar-signed and short amounts and rounds to cents', () => {
    assert.equal(U.parseDollars('2.50'), 2.5);
    assert.equal(U.parseDollars(' $3 '), 3);
    assert.equal(U.parseDollars('.5'), 0.5);
    assert.equal(U.parseDollars('99999.99'), 99999.99);
    assert.equal(U.parseDollars('1.'), 1);
  });
  it('treats a blank box as zero', () => {
    for (const v of ['', '   ', null, undefined, '$']) assert.equal(U.parseDollars(v), 0);
  });
  it('refuses junk, minus signs, extra decimals and huge amounts with NaN', () => {
    for (const v of ['abc', '-2', '1.234', '100000', '1,000', '.', '1e3', '$$2', '2 5']) assert.ok(Number.isNaN(U.parseDollars(v)), 'should refuse ' + JSON.stringify(v));
  });
});

describe('discardWeeks: dollars thrown away, this week against last week', () => {
  const D = (n) => at(0) + n * 864e5; // BASE is Fri 2026-10-16 12:00, so D(0) is a Friday noon
  const disc = (id, ing, g, reason, cost, t) => event({ t, type: 'batch_discard', batchId: id, ing, g, reason, cost });
  const mk = (events, batches = []) => dataset({ events, batches });
  it('adds grams times cost per cooked kg by product and by reason, week against week', () => {
    const d = mk([
      disc('b1', 'brisket', 2000, 'expired', 24, D(0)),       // this week
      disc('b2', 'brisket', 1000, 'temp', 12, D(-2)),         // this week
      disc('b3', 'pork', 500, 'quality', 4, D(-1)),           // this week
      disc('b4', 'brisket', 3000, 'cooling', 36, D(-8)),      // last week
    ]);
    const w = M.discardWeeks(d, { now: D(0) + 3600e3 });
    assert.equal(w.thisWeek.total.cost, 40);
    assert.equal(w.thisWeek.total.g, 3500);
    assert.equal(w.thisWeek.total.count, 3);
    assert.equal(w.lastWeek.total.cost, 36);
    assert.deepEqual(w.thisWeek.byProduct.map((r) => [r.ing, r.cost]), [['brisket', 36], ['pork', 4]]);
    assert.deepEqual(w.thisWeek.byReason.map((r) => [r.reason, r.cost]), [['expired', 24], ['quality', 4], ['temp', 12]]);
    assert.deepEqual(w.lastWeek.byReason.map((r) => r.reason), ['cooling']);
  });
  it('keeps the cold-food limits (fridge date, out of the fridge) as their own reasons, not Other', () => {
    const d = mk([disc('b1', 'slaw', 1000, 'fridgeDate', 3, D(0)), disc('b2', 'slaw', 500, 'outTime', 2, D(0))]);
    const w = M.discardWeeks(d, { now: D(0) + 3600e3 }).thisWeek;
    assert.deepEqual(w.byReason.map((r) => [r.reason, r.label]), [['fridgeDate', 'Past the fridge date'], ['outTime', 'Out of the fridge too long']]);
  });
  it('folds manual and unknown reasons into Other and never counts a missing cost as zero dollars', () => {
    const d = mk([disc('b1', 'brisket', 1000, 'manual', null, D(0)), disc('b2', 'brisket', 1000, 'expired', 10, D(0))]);
    const w = M.discardWeeks(d, { now: D(0) + 3600e3 }).thisWeek;
    assert.equal(w.total.count, 2);
    assert.equal(w.total.cost, 10);
    assert.equal(w.total.noCostCount, 1);
    assert.deepEqual(w.byReason.map((r) => r.label), ['Expired', 'Other']);
  });
  it('puts a 1 am discard in the service day before, across the week edge', () => {
    // 1 am Saturday (D(1) is Sat noon, minus 11 h) still belongs to Friday's service day
    const t = D(1) - 11 * 3600e3;
    const d = mk([disc('b1', 'brisket', 1000, 'expired', 5, t)]);
    // at 1:30 am Saturday "today" is still Friday, so the week runs Sat Oct 10 to Fri Oct 16 and holds it
    const lateNight = M.discardWeeks(d, { now: t + 30 * 60e3 });
    assert.equal(lateNight.thisWeek.total.count, 1);
    assert.equal(lateNight.thisWeek.label, 'This week');
    // a week later the same discard is last week
    assert.equal(M.discardWeeks(d, { now: t + 7 * 864e5 }).lastWeek.total.count, 1);
    // and a discard at 3:59 am Fri-a-week-ago is last week, 4:00 am is this week
    const edge = new Date(2026, 9, 10, 4, 0, 0).getTime();         // Sat Oct 10 4 am: first moment of this week when today is Fri Oct 16
    const e = mk([disc('x', 'brisket', 1000, 'temp', 1, edge - 1), disc('y', 'brisket', 1000, 'temp', 1, edge)]);
    const w = M.discardWeeks(e, { now: D(0) });
    assert.equal(w.thisWeek.total.count, 1);
    assert.equal(w.lastWeek.total.count, 1);
  });
  it('counts sample-batch discards separately so the page can label them', () => {
    const d = mk([disc('s1', 'brisket', 1000, 'expired', 5, D(0))], [batch({ id: 's1', src: 'sample' })]);
    assert.equal(M.discardWeeks(d, { now: D(0) }).thisWeek.total.sampleCount, 1);
  });
  it('is quiet and well formed with no data', () => {
    const w = M.discardWeeks(dataset({}), { now: D(0) });
    assert.deepEqual([w.thisWeek.total.count, w.thisWeek.byProduct.length, w.lastWeek.byReason.length], [0, 0, 0]);
  });
});

describe('discardSentence: the plain line above the weekly ledger', () => {
  const win = (cost, g, count, extra = {}) => ({ total: Object.assign({ count, g, cost, noCostCount: 0, sampleCount: 0 }, extra.total),
    byProduct: extra.byProduct || [], byReason: extra.byReason || [] });
  it('says dollars, the change from last week, the biggest product and reason', () => {
    const tw = win(40, 3500, 3, { byProduct: [{ name: 'Brisket', cost: 36, g: 3000 }], byReason: [{ label: 'Expired', cost: 24, g: 2000 }, { label: 'Temperature', cost: 12, g: 1000 }] });
    const s = M.discardSentence({ thisWeek: tw, lastWeek: win(30, 2000, 1) });
    assert.match(s, /You threw away \$40\.00 of food this week \(3\.5 kg\), up \$10\.00 from last week's \$30\.00\./);
    assert.match(s, /Most of it was brisket \(\$36\.00\), and the biggest reason was expired\./);
  });
  it('does not turn an unknown cost into zero dollars', () => {
    const s = M.discardSentence({ thisWeek: win(0, 1000, 1, { byProduct: [{ name: 'Brisket', cost: 0, g: 1000 }], byReason: [{ label: 'Other', cost: 0, g: 1000 }] }), lastWeek: win(0, 0, 0) });
    assert.match(s, /no cost is recorded/);
    assert.doesNotMatch(s, /\$0\.00/);
  });
  it('flags sample data and says when nothing was thrown away', () => {
    assert.match(M.discardSentence({ thisWeek: win(5, 500, 1, { total: { sampleCount: 1 } }), lastWeek: win(0, 0, 0) }), /sample data, not your kitchen/);
    assert.equal(M.discardSentence({ thisWeek: win(0, 0, 0), lastWeek: win(0, 0, 0) }), 'Nothing was thrown away this week or last week.');
  });
});

describe('discard cost words: an unknown cost never reads as $0', () => {
  const disc = (id, g, cost) => event({ t: at(0), type: 'batch_discard', batchId: id, ing: 'brisket', g, reason: 'expired', cost });
  const R = { from: at(0) - 3600e3, to: at(0) + 3600e3 };
  it('compliance counts the discards with no cost, and the words name them', () => {
    const none = M.compliance(dataset({ events: [disc('b1', 1000, null), disc('b2', 500, null)] }), R).discards;
    assert.equal(none.noCostCount, 2);
    assert.equal(M.discardCostWords(none), 'cost not recorded');
    const part = M.compliance(dataset({ events: [disc('b1', 1000, null), disc('b2', 500, 6)] }), R).discards;
    assert.equal(part.noCostCount, 1);
    assert.match(M.discardCostWords(part), /^\$6 for the 1 with a recorded cost$/);
    assert.equal(M.discardCostWords({ count: 2, cost: 12, noCostCount: 0 }), '$12');
  });
});
