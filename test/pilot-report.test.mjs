// The pilot report: counts from the event log, sound log and batches, for a real watched service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '36-csv', '25-deadlines', '35-pilot']);
const E = SB.engine, P = SB.pilot;
const T0 = new Date(2026, 9, 19, 11, 0, 0).getTime(), MIN = 60e3, HR = 60 * MIN;

// A kitchen with a pork batch cooked at 11:00, three pulls, a temperature, one discard, and a ribs batch kept past its limit.
function service() {
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: T0, empty: true, settings });
  const go = (type, p, t) => { const r = E.apply(s, type, p, t); assert.equal(r.report, 'ok', type + ' ' + r.report); s = r.state; return r; };
  go('addBatch', { ing: 'pork', tempF: 160, cookedG: 20000 }, T0);
  go('addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T0);
  go('pullBatch', { ing: 'pork', g: 2500 }, T0 + 90 * MIN);
  go('pullBatch', { ing: 'pork', g: 2500 }, T0 + 120 * MIN);
  go('pullBatch', { ing: 'pork', g: 1000 }, T0 + 150 * MIN);
  go('logTemp', { batchId: s.batches[0].id, tempF: 150 }, T0 + 100 * MIN);
  s = E.tick(s, T0 + 4 * HR + 1).state;                       // ribs go past their 4 hour limit
  go('logTemp', { batchId: s.batches[1].id, tempF: 150 }, T0 + 4 * HR + 2 * MIN);
  go('keepServing', { batchIds: [s.batches[1].id], who: 'FW' }, T0 + 4 * HR + 3 * MIN);
  go('discardBatch', { batchId: s.batches[1].id, reason: 'quality' }, T0 + 4 * HR + 40 * MIN);
  return s;
}

test('pilot report: pulls, discards, keeps and taps are counted from the event log', () => {
  const s = service();
  const r = P.build(s, { from: T0, to: T0 + 5 * HR, cutsCounted: 12 });
  assert.equal(r.pulls.n, 3);
  assert.equal(r.pulls.g, 6000);
  assert.equal(r.pulls.byIng.pork.n, 3);
  assert.equal(r.pulls.tapRate, 25, '3 pulls of 12 counted cuts');
  assert.equal(r.discards.n, 1);
  assert.equal(r.discards.byReason.quality.g > 0, true);
  assert.equal(r.discards.byIng.ribs.cost > 0, true);
  assert.equal(r.keeps.kept, 1);
  assert.equal(r.taps.jobs.pull.n, 3);
  assert.equal(r.taps.jobs['log a temperature'].n, 2);
  assert.equal(r.taps.jobs['new batch'].n, 2);
  assert.equal(r.taps.jobs['keep serving'].n, 1);
  assert.equal(r.taps.jobs.pull.perHour, 0.6);
  assert.equal(r.tickets.used, false);
  assert.equal(r.window.hours, 5);
  // A week at this rate: one day's worth scaled by 7 (the window is under a day, so it is stated as a guess).
  assert.equal(r.discards.perWeekCost > r.discards.cost, true);
  const t = P.toText(r);
  assert.ok(/25 percent got a pull tap/.test(t) && /need at least 50|at least 50/.test(t), t);
  assert.ok(/one service only: a rough guess/.test(t));
});

test('pilot report: the window limits the counts, undone events are left out, demo and sample things are left out and counted', () => {
  let s = service();
  const none = P.build(s, { from: T0 + 10 * HR, to: T0 + 11 * HR });
  assert.equal(none.pulls.n, 0); assert.equal(none.discards.n, 0);
  assert.equal(P.build(s, { from: T0, to: T0 + 110 * MIN }).pulls.n, 1, 'only the pull at 12:30');
  // An undone pull does not count.
  const u = E.apply(s, 'pullBatch', { ing: 'pork', g: 500 }, T0 + 4 * HR + 50 * MIN); s = u.state;
  const un = E.apply(s, 'undo', {}, T0 + 4 * HR + 50 * MIN + 3000); assert.equal(un.report, 'ok'); s = un.state;
  const r = P.build(s, { from: T0, to: T0 + 5 * HR });
  assert.equal(r.pulls.n, 3);
  assert.equal(r.excluded.reverted >= 1, true);
  // Sample batches and demo tickets are not counted as discards or tickets.
  const sm = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 3000, src: 'sample' }, T0 + 5 * HR - MIN).state;
  const d = E.apply(sm, 'discardBatch', { batchId: sm.batches[sm.batches.length - 1].id, reason: 'manual' }, T0 + 5 * HR - 30000);
  assert.equal(d.report, 'ok');
  const r2 = P.build(d.state, { from: T0, to: T0 + 5 * HR });
  assert.equal(r2.discards.n, 1, 'the sample batch discard is left out');
  assert.equal(r2.excluded.sampleOrStarterBatches, 1);
  const dc = P.build(d.state, { from: T0, to: T0 + 5 * HR, demoClock: true });
  assert.ok(/demo clock or demo orders were on/.test(P.toText(dc)));
});

test('pilot report: the sound log gives counts by level, repeats, taps, lapses and held-back sounds', () => {
  const s = service();
  const alerts = [
    { t: T0 + 3 * HR, id: 'expiry:b_2:0', kind: 'expiry', level: 2, repeat: false, leader: true },
    { t: T0 + 3.8 * HR, id: 'expiry:b_2:0', kind: 'expiry', level: 3, repeat: false, leader: true },
    { t: T0 + 3.9 * HR, id: 'expiry:b_2:0', kind: 'expiry', level: 3, repeat: true, leader: false },
    { t: T0 + 4 * HR, id: 'past:b_2:0', kind: 'past', level: 4, repeat: false, leader: true },
    { t: T0 + 4.5 * HR, id: 'past:b_2:1792400000000', kind: 'past', level: 4, repeat: false, leader: true },
    { t: T0 + 3.85 * HR, ack: true, id: 'expiry:b_2:0' },
    { t: T0 - HR, id: 'x', kind: 'expiry', level: 1, repeat: false },
  ];
  const r = P.build(s, { from: T0, to: T0 + 5 * HR, alerts });
  assert.deepEqual([r.sounds.total, r.sounds.firstSounds, r.sounds.repeats, r.sounds.acknowledged, r.sounds.lapses, r.sounds.notLeader], [5, 4, 1, 1, 1, 1]);
  assert.deepEqual(r.sounds.byLevel, { 1: 0, 2: 1, 3: 2, 4: 2 });
});

test('pilot report: CSV has one line per fact, safe cells, and an empty window is calm', () => {
  const s = service();
  const csv = P.toCsv(P.build(s, { from: T0, to: T0 + 5 * HR, cutsCounted: 10 }));
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'section,name,value,unit');
  assert.ok(lines.some((l) => l === 'pulls,taps,3,'), 'pulls line');
  assert.ok(lines.some((l) => /^pulls,pull-tap rate,30,%$/.test(l)));
  assert.ok(lines.every((l) => !/^[=+@]/.test(l)));
  const empty = P.build(E.newState({ now: T0, empty: true }), { from: T0, to: T0 + HR });
  assert.equal(empty.pulls.n, 0);
  assert.equal(empty.discards.perWeekCost, 0);
  assert.ok(/Pulls: 0 taps/.test(P.toText(empty)));
  assert.equal(P.build(s, { from: T0 + HR, to: T0 }).window.hours, 0, 'a backwards window is empty, not an error');
});

test('pilot report: a 3-day simulated pilot answers the gate questions in plain words', () => {
  const DAY = 24 * HR;
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: T0, empty: true, settings });
  s.ingredients = s.ingredients.map((i) => (i.id === 'ribs' ? Object.assign({}, i, { costPerKg: undefined }) : i));
  const go = (type, p, t) => { const r = E.apply(s, type, p, t); assert.equal(r.report, 'ok', type + ' ' + r.report); s = r.state; return r; };
  for (let d = 0; d < 3; d++) {
    const t = T0 + d * DAY;
    go('addBatch', { ing: 'pork', tempF: 160, cookedG: 20000 }, t);
    go('addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, t + MIN);
    const mi = s.menu.find((m) => E.apply(s, 'createTicket', { items: [{ menuId: m.id }] }, t + 30 * MIN).report === 'ok');
    go('createTicket', { items: [{ menuId: mi.id }] }, t + 30 * MIN);
    for (let k = 0; k < 4; k++) go('pullBatch', { ing: 'pork', g: 1500 }, t + (60 + 20 * k) * MIN);
    s = E.tick(s, t + 4 * HR + 1).state;
    go('discardBatch', { batchId: s.batches.find((b) => b.ing === 'ribs' && b.status !== 'discard').id, reason: 'quality' }, t + 5 * HR);
  }
  const alerts = [{ t: T0 + 3 * HR, id: 'expiry:b:0', kind: 'expiry', level: 2, repeat: false, leader: true }, { t: T0 + 3 * HR + 20000, ack: true, id: 'expiry:b:0' }];
  const r = P.build(s, { from: T0, to: T0 + 3 * DAY, cutsCounted: 30, batchesCounted: 8, alerts });
  assert.equal(r.batches.n, 6);
  assert.equal(r.batches.rate, 75);
  assert.equal(r.gate.pullTap.pass, false, '12 pulls of 30 cuts is 40 percent');
  assert.equal(r.discards.costUnknownN, 3);
  assert.deepEqual(r.costs.ingredientsWithoutCost, ['St. Louis ribs']);
  assert.equal(r.sounds.firstSounds, 1);
  assert.equal(r.sounds.acknowledged, 1);
  assert.equal(r.firstTicket.minutes, 30);
  const t = P.toText(r);
  for (const re of [/THE GATES/, /below the 50 percent gate/, /6 batches logged of 8 the observer counted \(75 percent\)/, /1 shown \(sounded\), 1 tapped/, /cannot know a warning was heard/, /St\. Louis ribs/, /30 minutes after the first record/, /WHAT THE APP CANNOT MEASURE/]) assert.ok(re.test(t), String(re));
  const csv = P.toCsv(r);
  assert.ok(/^batches,logged,6,$/m.test(csv) && /^warnings,heard,,observer writes this down$/m.test(csv));
  assert.ok(/DEMO KITCHEN/.test(P.toText(P.build(s, { from: T0, to: T0 + DAY, demo: true }))));
  assert.ok(/cook-ahead is turned off/.test(P.toText(Object.assign(P.build(s, { from: T0, to: T0 + DAY }), { batches: { n: 0, cookAheadOn: false } }))));
});

test('pilot report: counter-service auto tickets give no ticket time, and a fresh kitchen after Start over reads calmly', () => {
  const s = Object.assign({}, service(), { tickets: [{ id: 't1', createdAt: T0 + MIN, expeditedAt: T0 + 2 * MIN, auto: true }, { id: 't2', createdAt: T0 + 3 * MIN, expeditedAt: T0 + 9 * MIN }] });
  const r = P.build(s, { from: T0, to: T0 + 5 * HR });
  assert.equal(r.tickets.n, 2);
  assert.equal(r.tickets.medianSec, 360, 'only the hand-finished ticket is timed');
  const fresh = E.newState({ now: T0, empty: true });
  const t = P.toText(P.build(fresh, { from: T0, to: T0 + HR, batchesCounted: 4 }));
  assert.ok(/0 batches logged of 4/.test(t) && /Tickets: Smokebox tickets were not used/.test(t), t);
});

test('rates over 100 percent never pass the gate: the observer count is flagged as too low', () => {
  let s = E.newState({ now: T0, empty: true });
  for (let k = 0; k < 6; k++) { const r = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 5000 }, T0 + k * MIN); s = r.state; }
  for (let k = 0; k < 6; k++) s = E.apply(s, 'pullBatch', { ing: 'pork', g: 500 }, T0 + (10 + k) * MIN).state;
  const r = P.build(s, { from: T0, to: T0 + HR, cutsCounted: 2, batchesCounted: 2 });
  assert.ok(r.pulls.tapRate > 100, String(r.pulls.tapRate));
  assert.equal(r.gate.pullTap.pass, false); assert.equal(r.gate.pullTap.over, true);
  const t = P.toText(r);
  assert.match(t, /more taps than cuts/); assert.match(t, /more than the observer counted/);
  assert.match(P.toCsv(r), /cost per week at this rate \(rough guess from one service\)/);
});
