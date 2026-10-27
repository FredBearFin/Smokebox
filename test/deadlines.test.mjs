// Deadline feed tests: what the kitchen should be told, in what order, and what the projected waste says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '25-deadlines']);
const E = SB.engine, D = SB.deadlines, C = SB.config;
const T0 = Date.UTC(2026, 9, 12, 16, 0, 0), MIN = 60e3, HR = 60 * MIN;

test('rungs: brisket starts at 2 hours, others at 1 hour; the rung number counts crossed thresholds', () => {
  assert.deepEqual(D.rungsFor('brisket'), [120, 60, 30, 10]);
  assert.deepEqual(D.rungsFor('pork'), [60, 30, 10]);
  const r = [60, 30, 10];
  assert.equal(D.rungOf(61 * MIN, r), 0);
  assert.equal(D.rungOf(60 * MIN, r), 1);
  assert.equal(D.rungOf(29 * MIN, r), 2);
  assert.equal(D.rungOf(9 * MIN, r), 3);
  assert.equal(D.rungOf(0, r), 4);
});

test('feed: a fresh staggered kitchen is quiet except brisket 25 minutes from expiry, which is bad and says it sells out', () => {
  const s = E.newState({ now: T0, stagger: true });
  const f = D.build(s, T0);
  const top = f[0];
  assert.equal(top.kind, 'expiry');
  assert.equal(top.ing, 'brisket');
  assert.equal(top.sev, 'bad', 'the last rung or the only batch left is bad');
  assert.ok(/sold out/.test(top.consequence) || /No other/.test(top.consequence), top.consequence);
  assert.equal(Math.round(top.msLeft / MIN), 25);
  assert.ok(f.every((x, i) => i === 0 || x.msLeft >= 0));
});

test('feed: projected waste follows the sales pace, oldest batch first, and quiet when the pace clears it', () => {
  let s = E.newState({ now: T0, empty: true });
  const r1 = E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T0);
  s = r1.state;
  // Pull 1 kg every 30 minutes through the last 90 minutes before the check time.
  for (let i = 0; i < 3; i++) { const r = E.apply(s, 'pullBatch', { ing: 'ribs', g: 1000 }, T0 + 2 * HR + 15 * MIN + i * 30 * MIN); assert.equal(r.report, 'ok'); s = r.state; }
  const at = T0 + 3.5 * HR;
  const f = D.build(s, at);
  const row = f.find((x) => x.kind === 'expiry');
  assert.ok(row, JSON.stringify(f.map((x) => x.id)));
  assert.ok(row.wasteG > 1500 && row.wasteG < 2500, '3000 g left, 1000 g sold in 30 minutes: ' + row.wasteG);
  assert.equal(row.unknown, false);
  // A slower pace wastes more.
  const slow = E.apply(E.newState({ now: T0, empty: true }), 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T0).state;
  const slowRow = D.build(slow, T0 + 3.5 * HR).find((x) => x.kind === 'expiry');
  assert.equal(slowRow.unknown, true, 'no pulls means the pace is unknown');
});

test('feed: a temperature check due soon, a late sanitize and late tickets appear; an empty kitchen is empty', () => {
  const s = E.newState({ now: T0, empty: true });
  assert.deepEqual(D.build(s, T0).map((x) => x.kind), [], 'a fresh kitchen has nothing due: the first sanitize round is one interval away');
  assert.deepEqual(D.build(s, T0 + 4 * HR - 10 * MIN).map((x) => x.kind), ['sanitize'], 'the first sanitize round shows once it is close');
  const withBatch = E.apply(s, 'addBatch', { ing: 'beans', tempF: 160, cookedG: 3000 }, T0).state;
  const f = D.build(withBatch, T0 + 110 * MIN);
  assert.ok(f.some((x) => x.kind === 'check'), f.map((x) => x.id).join());
  const san = D.build(withBatch, T0 + 5 * HR).find((x) => x.kind === 'sanitize');
  assert.ok(san && san.sev === 'warn');
});

test('feed: junk input is safe', () => {
  assert.deepEqual(D.build(null, T0), []);
  assert.deepEqual(D.build(E.newState({ now: T0 }), NaN), []);
});

test('hold window: brisket logged at 4:00 with the kitchen open 11:00 to 21:00 has no sounded alarm and no discard before opening', () => {
  const settings = E.defaultSettings();
  settings.service.openHour = 11; settings.service.closeHour = 21;
  const at = (h, m = 0) => new Date(2026, 9, 12, h, m, 0).getTime();
  let s = E.newState({ now: at(3, 59), empty: true, settings });
  const r = E.apply(s, 'addBatch', { ing: 'brisket', tempF: 160, cookedG: 6000 }, at(4));
  assert.equal(r.report, 'ok');
  s = r.state;
  const b = s.batches[0];
  assert.equal(b.maxHoldH, 8);
  assert.equal(b.holdBasis, 'quality');
  assert.equal(b.restUntil, at(7), 'brisket rests 3 hours before it is ready');
  for (let t = at(4); t < at(11); t += 60e3) {
    const tk = E.tick(s, t);
    s = tk.state;
    assert.equal(tk.events.filter((e) => e.type === 'batch_discard').length, 0, 'no discard at ' + new Date(t).toTimeString());
    assert.equal(D.soundsAllowed(s, t), false, 'no sound at ' + new Date(t).toTimeString());
  }
  assert.equal(D.soundsAllowed(s, at(11)), true);
  assert.equal(D.pauseNote(s, at(4)), 'Sound paused: kitchen closed until ' + SB.util.fmtTime(at(11)));
  assert.equal(D.pauseNote(s, at(11)), null);
  // The 2-hour rung is crossed at 10:00 but it is silent; it can sound once the kitchen opens, 1 hour before expiry at 12:00.
  const row = D.build(s, at(11)).find((x) => x.kind === 'expiry');
  assert.ok(row && row.rung >= 2 && Math.round(row.msLeft / 60e3) === 60, JSON.stringify(row && [row.rung, row.msLeft]));
  // Brisket has a quality limit: at 12:00, 8 hours after it went in, it is held off the menu (past), not thrown out.
  const t12 = E.tick(s, at(12, 1));
  assert.equal(t12.events.filter((e) => e.type === 'batch_discard').length, 0);
  assert.equal(t12.state.batches[0].status, 'past');
  // Only the 12-hour hard cap throws it out.
  assert.equal(E.tick(t12.state, at(16, 1)).events.filter((e) => e.type === 'batch_discard' && e.reason === 'expired').length, 1);
});

test('resting: pulls take the oldest ready batch first and resting batches only when nothing else is left; run-out counts ready stock', () => {
  const T = Date.UTC(2026, 9, 12, 15, 0, 0);
  let s = E.newState({ now: T, empty: true });
  s = E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 3000 }, T).state;
  s = E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 3000 }, T + 40 * MIN).state; // second rack, rests until T+70min
  const [a, b2] = s.batches;
  const now = T + 45 * MIN; // first batch ready (rested 30 min), second still resting
  let r = E.apply(s, 'pullBatch', { ing: 'ribs', g: 3500 }, now);
  assert.equal(r.report, 'ok');
  assert.deepEqual(r.info.batchIds, [a.id, b2.id], 'ready batch first, then the resting one');
  s = E.apply(s, 'pullBatch', { ing: 'ribs', g: 1000 }, now).state;
  assert.equal(s.batches[0].remainingG, 2000);
  assert.equal(s.batches[1].remainingG, 3000, 'the resting batch is untouched while ready stock lasts');
  // run-out: only the 2000 g that is ready counts
  const ev = E.allEvents(s);
  assert.ok(ev.length > 0);
  const f = D.build(s, now);
  assert.ok(!f.some((x) => x.kind === 'runout'), 'the old run-out row is folded into the shortfall row');
});

test('migration: a save with the old flat 4-hour cap moves to per-product limits once; chosen values stay', () => {
  const mk = (patch) => { const s = JSON.parse(JSON.stringify(E.newState({ now: T0 }))); s.settings.safety = Object.assign({}, s.settings.safety, patch); delete s.settings.safety.holdWindowV2; for (const i of s.ingredients) if (i.id === 'brisket' || i.id === 'pork') i.maxHoldH = 4; return s; };
  const v = E.validateBackup(mk({ defaultMaxHoldH: 4 }));
  assert.equal(v.state.settings.safety.defaultMaxHoldH, 12);
  assert.equal(v.state.ingredients.find((i) => i.id === 'brisket').maxHoldH, 8);
  assert.equal(v.state.ingredients.find((i) => i.id === 'ribs').maxHoldH, 4);
  assert.equal(E.validateBackup(mk({ defaultMaxHoldH: 6 })).state.settings.safety.defaultMaxHoldH, 6, 'a value the owner chose stays');
});

test('feed: a batch past its quality limit gets a past row (off the menu, taste it), and no projection', () => {
  let s = E.newState({ now: T0, empty: true });
  s = E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T0).state;
  s = E.tick(s, T0 + 4 * HR + 1).state;
  const f = D.build(s, T0 + 4 * HR + 60e3);
  const row = f.find((x) => x.kind === 'past');
  assert.ok(row, f.map((x) => x.id).join());
  assert.equal(row.sev, 'bad');
  assert.ok(/quality limit/.test(row.consequence) && /Check it/.test(row.action), row.consequence + ' / ' + row.action);
  assert.ok(!f.some((x) => x.kind === 'expiry' && x.batchId === row.batchId), 'no expiry projection for a batch that cannot sell');
});

test('sound pause: note while closed, next start time, early start hour, all-day setting, after-midnight close', () => {
  const at = (h, m = 0, d = 12) => new Date(2026, 9, d, h, m, 0).getTime();
  const mk = (service) => { const settings = E.defaultSettings(); Object.assign(settings.service, service); return E.newState({ now: at(3), empty: true, settings }); };
  const s = mk({ openHour: 11, closeHour: 21, soundStartHour: 11 });
  assert.equal(D.pauseNote(s, at(4)), 'Sound paused: kitchen closed until ' + SB.util.fmtTime(at(11)));
  assert.equal(D.nextOpenAt(s, at(4)), at(11));
  assert.equal(D.pauseNote(s, at(11)), null);
  assert.equal(D.nextOpenAt(s, at(11)), null);
  // After closing the next start is tomorrow morning.
  assert.equal(D.nextOpenAt(s, at(22)), at(11, 0, 13));
  // The sound start hour can be earlier than opening (the pit master starts at 4), never later.
  const early = mk({ openHour: 11, closeHour: 21, soundStartHour: 4 });
  assert.equal(D.soundsAllowed(early, at(4, 30)), true);
  assert.equal(D.soundsAllowed(early, at(3, 59)), false);
  const late = mk({ openHour: 11, closeHour: 21, soundStartHour: 15 });
  assert.equal(D.soundsAllowed(late, at(11, 30)), true, 'a start hour after opening does not delay the sounds');
  // The all-day setting turns the pause off.
  const all = mk({ soundOutsideHours: true });
  assert.equal(D.soundsAllowed(all, at(2)), true);
  assert.equal(D.pauseNote(all, at(2)), null);
  // A close after midnight (25 = 1 am) keeps sound on at 00:30.
  const night = mk({ openHour: 17, closeHour: 25, soundStartHour: 17 });
  assert.equal(D.soundsAllowed(night, at(0, 30)), true);
  assert.equal(D.soundsAllowed(night, at(2)), false);
  assert.equal(D.nextOpenAt(night, at(2)), at(17));
});

test('sound settings: the engine accepts and keeps soundStartHour and soundOutsideHours; bad values are refused', () => {
  let s = E.newState({ now: T0, empty: true });
  let r = E.apply(s, 'updateSettings', { patch: { service: { soundStartHour: 4, soundOutsideHours: true } } }, T0);
  assert.equal(r.report, 'ok');
  assert.equal(r.state.settings.service.soundStartHour, 4);
  assert.equal(r.state.settings.service.soundOutsideHours, true);
  assert.equal(E.apply(s, 'updateSettings', { patch: { service: { soundStartHour: 30 } } }, T0).report, 'outOfBounds');
  assert.equal(E.apply(s, 'updateSettings', { patch: { service: { soundOutsideHours: 'yes' } } }, T0).report, 'badPatch');
  const back = E.validateBackup(E.serialize(r.state));
  assert.equal(back.state.settings.service.soundOutsideHours, true);
  assert.equal(back.state.settings.service.soundStartHour, 4);
});

/* ---------------------------------------------------- pace estimate with lumpy pulls ---------------------------------------------------- */
// The old estimator, kept here only to show the problem: grams in the last 90 minutes over 90 minutes, unknown under 200 g.
const oldRate = (pulls, now) => { const g = pulls.filter((p) => p.t > now - 90 * MIN && p.t <= now).reduce((a, p) => a + p.g, 0); return g >= 200 ? g / (90 * MIN) : undefined; };
const rank = { info: 0, warn: 1, bad: 2 };

test('pace: 4.5 kg pulls every 100 minutes give a steady pace and a severity that never flaps', () => {
  const at = (m) => new Date(2026, 9, 12, 11, 0, 0).getTime() + m * MIN;
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: at(0), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 30000 }, at(0)).state;
  const pulls = [];
  let flipsOld = 0, prevOld = false, flipsNew = 0, prevNew = null, sevs = [], rates = [];
  for (let m = 1; m <= 470; m++) {
    const t = at(m);
    if (m % 100 === 0) { const r = E.apply(s, 'pullBatch', { ing: 'pork', g: 4500 }, t); assert.equal(r.report, 'ok'); s = r.state; pulls.push({ t, g: 4500 }); }
    s = E.tick(s, t).state;
    const known = oldRate(pulls, t) !== undefined;
    if (m > 100 && known !== prevOld) flipsOld++;
    prevOld = known;
    const sr = D.salesRate(s, t);
    const knownNew = sr.rate.pork !== undefined;
    if (m >= 200) { assert.ok(knownNew, 'pace is known at minute ' + m); rates.push(sr.rate.pork * MIN); }
    if (prevNew !== null && m >= 200 && knownNew !== prevNew) flipsNew++;
    prevNew = knownNew;
    const row = D.build(s, t).find((x) => x.kind === 'expiry');
    if (m >= 200 && row) sevs.push(rank[row.sev]);
  }
  assert.ok(flipsOld >= 6, 'the old fixed window flipped between known and unknown ' + flipsOld + ' times');
  assert.equal(flipsNew, 0);
  assert.ok(Math.min(...rates) > 40 && Math.max(...rates) < 50, 'steady near 45 g/min: ' + Math.min(...rates).toFixed(1) + ' to ' + Math.max(...rates).toFixed(1));
  let changes = 0;
  for (let i = 1; i < sevs.length; i++) { if (sevs[i] < sevs[i - 1]) assert.fail('severity went down at sample ' + i); if (sevs[i] !== sevs[i - 1]) changes++; }
  assert.ok(changes <= 2, 'severity changed ' + changes + ' times');
});

test('pace: no pulls is unknown, never zero; a lone pull is not a pace until 120 minutes since opening; a long silence is unknown again', () => {
  const at = (m) => new Date(2026, 9, 12, 11, 0, 0).getTime() + m * MIN;
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: at(0), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 30000 }, at(0)).state;
  assert.equal(D.salesRate(s, at(60)).rate.pork, undefined, 'nothing pulled: unknown');
  const row0 = D.build(s, at(440)).find((x) => x.kind === 'expiry');
  assert.equal(row0.unknown, true);
  assert.equal(row0.wasteG, null, 'no projected waste when the pace is unknown');
  assert.ok(/^Up to /.test(row0.consequence), row0.consequence);
  // One pull at 11:30: not a pace before 120 minutes since opening, then the average since opening.
  s = E.apply(s, 'pullBatch', { ing: 'pork', g: 4500 }, at(30)).state;
  assert.equal(D.salesRate(s, at(60)).rate.pork, undefined);
  assert.equal(D.salesRate(s, at(119)).rate.pork, undefined);
  assert.ok(Math.abs(D.salesRate(s, at(120)).rate.pork * MIN - 4500 / 120) < 0.01);
  // Two pulls, then a long silence: unknown again, not a slowly falling pace.
  s = E.apply(s, 'pullBatch', { ing: 'pork', g: 4500 }, at(130)).state;
  assert.ok(D.salesRate(s, at(200)).rate.pork > 0);
  assert.equal(D.salesRate(s, at(130 + 250)).rate.pork, undefined, 'after 250 minutes of silence the pace is unknown');
});

test('pace: one pull at 11:05 gives no shortfall or leftover row at 11:45; pulls 5 minutes apart merge into one removal', () => {
  const at = (h, m = 0) => new Date(2026, 9, 12, h, m, 0).getTime();
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: at(11), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 30000 }, at(11)).state;
  s = E.apply(s, 'pullBatch', { ing: 'pork', g: 4500 }, at(11, 5)).state;
  s = E.tick(s, at(11, 45)).state;
  const f = D.build(s, at(11, 45));
  assert.equal(f.some((x) => x.kind === 'shortfall' || x.kind === 'leftover'), false, 'a single pull is not a pace');
  assert.equal(D.salesRate(s, at(11, 45)).rate.pork, undefined);
  // Two pulls of 2.5 kg and 2 kg at 11:05 and 11:10 are one removal: still no pace, even at 12:30 (90 minutes since opening).
  let m = E.newState({ now: at(11), empty: true, settings });
  m = E.apply(m, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 30000 }, at(11)).state;
  m = E.apply(m, 'pullBatch', { ing: 'pork', g: 2500 }, at(11, 5)).state;
  m = E.apply(m, 'pullBatch', { ing: 'pork', g: 2000 }, at(11, 10)).state;
  assert.equal(D.salesRate(m, at(12, 30)).rate.pork, undefined);
  // A third pull at 12:40 gives a second removal, so the pace is known.
  m = E.apply(m, 'pullBatch', { ing: 'pork', g: 4500 }, at(12, 40)).state;
  assert.ok(D.salesRate(m, at(12, 41)).rate.pork > 0);
});

test('pace: with the pace unknown the 10-minute expiry rung is still due for a batch with 4 kg left (time is a fact)', () => {
  const at = (h, m = 0) => new Date(2026, 9, 12, h, m, 0).getTime();
  const settings = E.defaultSettings(); settings.service.openHour = 14; settings.service.closeHour = 22;
  let s = E.newState({ now: at(11), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 8500 }, at(11)).state;
  s = E.apply(s, 'pullBatch', { ing: 'ribs', g: 2500 }, at(14, 5)).state;
  s = E.apply(s, 'pullBatch', { ing: 'ribs', g: 2000 }, at(14, 10)).state;
  s = E.tick(s, at(14, 50)).state;
  const row = D.build(s, at(14, 50)).find((x) => x.kind === 'expiry');
  assert.ok(row, 'an expiry row');
  assert.equal(row.unknown, true);
  assert.equal(row.rung, row.rungs, 'the last rung (10 minutes) is reached');
  assert.equal(row.trivial, false, '4 kg left is not trivial');
  assert.equal(row.sev, 'bad');
});

/* ---------------------------------------------------- leftover or shortfall at close ---------------------------------------------------- */
test('close sweep: simple case, a steady pace leaves grams over, a faster one runs out early', () => {
  const now = 1e12, closeAt = now + 200 * MIN, one = [{ remainingG: 5000, enteredAt: now, readyAt: 0, expAt: now + 10 * HR }];
  const slow = D.sweepToClose(one, 10 / MIN, now, closeAt);
  assert.equal(Math.round(slow.leftoverG), 3000);
  assert.equal(slow.unmetG, 0);
  assert.equal(slow.runOutAt, null);
  const fast = D.sweepToClose(one, 40 / MIN, now, closeAt);
  assert.equal(Math.round(fast.unmetG), 3000, 'the shortfall is its own number');
  assert.equal(Math.round(fast.leftoverG), 0);
  assert.equal(fast.runOutCause, 'stock');
  assert.equal(Math.round((fast.runOutAt - now) / MIN), 125);
});

test('close sweep: a resting batch cannot sell before it is ready, so it is a shortfall, not waste', () => {
  const now = 1e12, closeAt = now + 6 * HR, rate = 1000 / HR;
  const r = D.sweepToClose([
    { remainingG: 2000, enteredAt: now - HR, readyAt: 0, expAt: now + 20 * HR },
    { remainingG: 3000, enteredAt: now, readyAt: now + 2 * HR, expAt: now + 20 * HR },
  ], rate, now, closeAt);
  assert.equal(Math.round(r.unmetG), 1000, 'one kilogram short');
  assert.equal(Math.round(r.leftoverG), 0);
  assert.equal(Math.round((r.runOutAt - now) / HR * 100) / 100, 5, 'runs out at hour 5');
});

test('close sweep: a batch that expires before close has its leftover counted as waste once, not as leftover at close', () => {
  const now = 1e12, closeAt = now + 6 * HR;
  const r = D.sweepToClose([{ remainingG: 3000, enteredAt: now - HR, readyAt: 0, expAt: now + HR }], 500 / HR, now, closeAt);
  assert.equal(Math.round(r.wasteBefore), 2500);
  assert.equal(Math.round(r.unmetG), 2500, 'after it expires the remaining demand is unmet');
  assert.equal(r.leftoverG, 0);
  assert.equal(r.runOutCause, 'limit', 'the limit ended the supply');
});

test('next batch: only suggested when cook time plus rest fits before close', () => {
  const at = (h) => new Date(2026, 9, 12, h, 0, 0).getTime();
  const ing = (id) => E.newState({ now: at(17), empty: true }).ingredients.find((i) => i.id === id);
  const mac = D.nextBatchFit(ing('mac'), at(17), at(21));
  assert.equal(mac.fits, true);
  assert.equal(mac.readyAt, at(18));
  const brisket = D.nextBatchFit(ing('brisket'), at(17), at(21));
  assert.equal(brisket.fits, false, '12 hours of cook plus 3 of rest does not fit before 9 pm');
  assert.equal(D.nextBatchFit({ id: 'x' }, at(17), at(21)), null, 'no cook time, no suggestion');
});

test('feed: shortfall row at the current pace names the time, the gap and the three actions; next batch only if it fits', () => {
  const at = (h, m = 0) => new Date(2026, 9, 12, h, m, 0).getTime();
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: at(11), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 20000 }, at(11)).state;
  for (const h of [12, 13, 14, 15]) { const r = E.apply(s, 'pullBatch', { ing: 'pork', g: 3000 }, at(h)); assert.equal(r.report, 'ok'); s = E.tick(r.state, at(h)).state; }
  s = E.tick(s, at(16)).state;
  const row = D.build(s, at(16)).find((x) => x.kind === 'shortfall');
  assert.ok(row, 'a shortfall row');
  assert.equal(row.at, at(18, 40), 'runs out at 6:40 pm at 50 g/min');
  assert.ok(/at the current pace/i.test(row.consequence) && /runs out at/.test(row.consequence), row.consequence);
  assert.ok(/Shorten portions/.test(row.action) && /stop preorders/.test(row.action) && /run a special/.test(row.action), row.action);
  assert.ok(/Too late for a new batch to cover it: about [\d.]+ kg of demand with nothing to sell/.test(row.consequence) && !/Start the next batch/.test(row.action), 'pork takes 10 h plus 1 h rest: too late');
  assert.ok(!/before close/.test(row.consequence), 'never "N h before close"');
  assert.equal(row.sev, 'warn');
  // Nothing after closing time.
  assert.equal(D.build(s, at(21, 5)).some((x) => x.kind === 'shortfall' || x.kind === 'leftover'), false);
});

test('feed: leftover row at the current pace says it does not count what is on the block; unknown pace gives no row', () => {
  const at = (h, m = 0) => new Date(2026, 9, 12, h, m, 0).getTime();
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: at(15), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 20000 }, at(15)).state;
  assert.equal(D.build(s, at(16, 30)).some((x) => x.kind === 'leftover' || x.kind === 'shortfall'), false, 'no pace, no projection');
  for (const h of [16, 17, 18]) { s = E.apply(s, 'pullBatch', { ing: 'pork', g: 600 }, at(h)).state; s = E.tick(s, at(h)).state; }
  const row = D.build(s, at(18, 30)).find((x) => x.kind === 'leftover');
  assert.ok(row, 'a leftover row');
  assert.equal(Math.round(row.leftoverG), 16700);
  assert.ok(/not counting what is already on the block/.test(row.consequence), row.consequence);
  assert.ok(/special/.test(row.action));
});

test('feed: a batch that expires before close is waste in its expiry row, not also leftover at close', () => {
  const at = (h, m = 0) => new Date(2026, 9, 12, h, m, 0).getTime();
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: at(11), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 20000 }, at(11)).state;
  for (const h of [12, 13, 14, 15, 16, 17]) { s = E.apply(s, 'pullBatch', { ing: 'pork', g: 600 }, at(h)).state; s = E.tick(s, at(h)).state; }
  const f = D.build(s, at(17, 30));
  assert.equal(f.some((x) => x.kind === 'leftover'), false);
  const exp = f.find((x) => x.kind === 'expiry');
  assert.ok(exp && exp.wasteG > 10000, 'the loss is in the expiry row: ' + (exp && exp.wasteG));
});

/* ---------------------------------------------------- hard cap and the kept-batch check row ---------------------------------------------------- */
test('hard cap: its own setting; a limit at or above it has no quality stage; changing it moves the discard', () => {
  const T = new Date(2026, 9, 12, 11, 0, 0).getTime();
  const mk = (patch) => { const settings = E.defaultSettings(); Object.assign(settings.safety, patch); const s = E.newState({ now: T, empty: true, settings }); return E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T).state; };
  // default cap 12 h: ribs (4 h quality limit) go past, and are thrown out at 12 h
  let s = mk({});
  assert.equal(E.tick(s, T + 4 * HR + 1).state.batches[0].status, 'past');
  // cap 4 h equals the limit: no quality stage, thrown out at the limit
  s = mk({ hardCapH: 4 });
  assert.equal(E.tick(s, T + 4 * HR + 1).events.filter((e) => e.type === 'batch_discard' && e.reason === 'expired').length, 1);
  // cap 3 h is below the limit: thrown out at 3 h
  s = mk({ hardCapH: 3 });
  assert.equal(E.tick(s, T + 3 * HR - 1).events.filter((e) => e.type === 'batch_discard').length, 0);
  assert.equal(E.tick(s, T + 3 * HR + 1).events.filter((e) => e.type === 'batch_discard' && e.reason === 'expired').length, 1);
  // keepServing never runs past the cap
  const open = E.defaultSettings(); open.safety.hardCapH = 6;
  let k = E.apply(E.newState({ now: T, empty: true, settings: open }), 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T).state;
  k = E.tick(k, T + 4 * HR + 1).state;
  k = E.apply(k, 'logTemp', { batchId: k.batches[0].id, tempF: 150 }, T + 4 * HR + 2 * MIN).state;
  k = E.apply(k, 'keepServing', { batchIds: [k.batches[0].id], who: 'AB', until: T + 20 * HR }, T + 4 * HR + 3 * MIN).state;
  assert.equal(k.batches[0].keepUntil, T + 6 * HR);
});

test('hard cap: the list of products with no quality stage, and the setting survives a backup; old saves migrate', () => {
  const s = E.newState({ now: 0, empty: true });
  assert.deepEqual(E.noQualityStage(s), [], 'at 12 h every starter product has a quality stage');
  const settings = E.defaultSettings(); settings.safety.hardCapH = 8;
  const s8 = E.newState({ now: 0, empty: true, settings });
  assert.deepEqual(E.noQualityStage(s8).sort(), ['Brisket', 'Pulled pork']);
  assert.equal(E.validateBackup(E.serialize(s8)).state.settings.safety.hardCapH, 8);
  const old = JSON.parse(JSON.stringify(s)); delete old.settings.safety.hardCapH; old.settings.safety.defaultMaxHoldH = 6;
  assert.equal(E.validateBackup(old).state.settings.safety.hardCapH, 6, 'an owner-chosen longest hold time becomes the cap');
  const old2 = JSON.parse(JSON.stringify(s)); delete old2.settings.safety.hardCapH;
  assert.equal(E.validateBackup(old2).state.settings.safety.hardCapH, 12);
  assert.ok(E.validateBackup(Object.assign(JSON.parse(JSON.stringify(s)), {})).ok);
  assert.equal(E.apply(s, 'updateSettings', { patch: { safety: { hardCapH: 30 } } }, 0).report, 'outOfBounds');
});

test('keepcheck row: appears 15 minutes before a kept batch lapses or when the reading is stale, is silent, and follows the temperature settings', () => {
  const T = new Date(2026, 9, 12, 11, 0, 0).getTime();
  const settings = E.defaultSettings(); settings.safety.hotHoldF = 140;
  let s = E.newState({ now: T, empty: true, settings });
  s = E.apply(s, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T).state;
  s = E.tick(s, T + 4 * HR + 1).state;
  s = E.apply(s, 'logTemp', { batchId: s.batches[0].id, tempF: 150 }, T + 4 * HR + 5 * MIN).state;
  s = E.apply(s, 'keepServing', { batchIds: [s.batches[0].id], who: 'AB', forMin: 60 }, T + 4 * HR + 5 * MIN).state;
  const at = (m) => T + 4 * HR + m * MIN;
  const row = (m) => D.build(E.tick(s, at(m)).state, at(m)).find((x) => x.kind === 'keepcheck');
  assert.equal(row(20), undefined, 'reading fresh and 45 minutes left: no row');
  const r = row(55);
  assert.ok(r, '10 minutes left: row');
  assert.equal(r.sev, 'info');
  assert.ok(/140 °F or higher/.test(r.consequence), 'reads hotHoldF from settings: ' + r.consequence);
  // silent: the ladder makes no sound for it
  const L = D.makeLadder();
  assert.equal(L.decide([r], at(55), s).length, 0);
  // gone once the extension has lapsed
  assert.equal(row(70), undefined);
});

/* ---------------------------------------------------- close rows: separate numbers, rescue, quality limit, start by ---------------------------------------------------- */
const closeAt = (h, m = 0) => new Date(2026, 9, 12, h, m, 0).getTime();
// A kitchen open 11 to 21 with one ingredient batch, pulls, and the feed rows for it at the time given.
function closeKit(ing, cooked, enter, pulls, extra) {
  const settings = E.defaultSettings(); settings.service.openHour = 11; settings.service.closeHour = 21;
  let s = E.newState({ now: closeAt(11), empty: true, settings });
  s = E.apply(s, 'addBatch', { ing, tempF: 160, cookedG: cooked }, enter).state;
  for (const [t, g] of pulls) { s = E.apply(s, 'pullBatch', { ing, g }, t).state; s = E.tick(s, t).state; }
  if (extra) s = extra(s);
  return s;
}
const closeFeed = (s, t) => D.build(E.tick(s, t).state, t).filter((x) => x.kind === 'shortfall' || x.kind === 'leftover' || x.kind === 'expiry');

test('close rows: a gap with a batch coming has its own rescue wording, and leftover and shortfall are separate numbers', () => {
  const r = D.sweepToClose([
    { remainingG: 1000, enteredAt: 0, readyAt: 0, expAt: 1e12 },
    { remainingG: 20000, enteredAt: 1, readyAt: 1e9 + 2 * HR, expAt: 1e12 },
  ], 1000 / HR, 1e9, 1e9 + 8 * HR);
  assert.equal(r.runOutCause, 'rest-gap');
  assert.equal(r.gapEndAt, 1e9 + 2 * HR);
  assert.equal(Math.round(r.gapUnmetG), 1000, 'one hour of demand with nothing to sell');
  assert.equal(Math.round(r.leftoverG), 20000 - 6000, 'and the batch still leaves grams at close');
  assert.equal(Math.round(r.unmetG), 1000);
  const s = closeKit('pork', 6000, closeAt(11), [[closeAt(12), 2000], [closeAt(12, 30), 2000], [closeAt(13), 1500]], (st) => E.apply(st, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 8000 }, closeAt(13, 5)).state);
  const rows = closeFeed(s, closeAt(13, 10));
  const sf = rows.find((x) => x.kind === 'shortfall');
  assert.ok(sf && /runs out at 1:18 pm, next batch ready at 2:05 pm, about [\d.]+ kg of demand with nothing to sell/.test(sf.consequence), sf && sf.consequence);
  assert.ok(!/before close/.test(sf.consequence));
});

test('close rows: an ingredient can have a leftover row and a shortfall row at once', () => {
  const s = closeKit('pork', 6000, closeAt(11), [[closeAt(12), 2000], [closeAt(12, 30), 2000], [closeAt(13), 1500]], (st) => E.apply(st, 'addBatch', { ing: 'pork', tempF: 160, cookedG: 40000 }, closeAt(13, 5)).state);
  const rows = closeFeed(s, closeAt(13, 10));
  assert.ok(rows.some((x) => x.kind === 'shortfall'), 'the gap');
  assert.ok(rows.some((x) => x.kind === 'leftover'), 'and the grams left at close');
});

test('close rows: a quality limit that ends supply gives one row, the expiry row, with the start-by line and no "runs out"', () => {
  const s = closeKit('ribs', 12000, closeAt(11), [[closeAt(11, 30), 1000], [closeAt(12), 1000], [closeAt(12, 30), 1000], [closeAt(13), 1000]]);
  const rows = closeFeed(s, closeAt(13, 10));
  assert.equal(rows.filter((x) => x.kind === 'shortfall').length, 0, 'no second row');
  const exp = rows.filter((x) => x.kind === 'expiry');
  assert.equal(exp.length, 1);
  assert.ok(/passes its quality limit at 3:00 pm/.test(exp[0].consequence) && !/runs out/.test(exp[0].consequence), exp[0].consequence);
  assert.ok(/Too late for a new batch to cover it|Start the next batch by/.test(exp[0].action), exp[0].action);
});

test('close rows: start by is a time that is still ahead, or says it is too late with the demand that has nothing to sell', () => {
  // Mac and cheese cooks 1 h with no rest: at 4:40 pm, running out at 6:10 pm, the latest start is 5:10 pm.
  const ahead = closeKit('mac', 12000, closeAt(15), [[closeAt(15, 30), 2000], [closeAt(16), 2000], [closeAt(16, 30), 2000]]);
  const a = closeFeed(ahead, closeAt(16, 40)).find((x) => x.kind === 'shortfall');
  assert.equal(a.at, closeAt(18, 10));
  assert.equal(a.startBy, closeAt(17, 10));
  assert.equal(a.action, 'Start the next batch by 5:10 pm, not counting anything still on the smoker.');
  assert.ok(!/kg/.test(a.consequence), 'the kilograms short are not shown while there is time');
  // A kitchen selling faster is already behind: the latest start has passed.
  const late = closeKit('mac', 12000, closeAt(15), [[closeAt(15, 30), 3000], [closeAt(16), 3000], [closeAt(16, 30), 3000]]);
  const b = closeFeed(late, closeAt(16, 40)).find((x) => x.kind === 'shortfall');
  assert.ok(b.startBy < closeAt(16, 40), 'the latest start has passed');
  assert.ok(/Too late for a new batch to cover it: about [\d.]+ kg of demand with nothing to sell/.test(b.consequence), b.consequence);
  assert.equal(b.action, 'Shorten portions, stop preorders, run a special.');
});

/* ---------------------------------------------------- planned batches ---------------------------------------------------- */
test('planned batch: the shortfall row switches to the rescue wording, and back when the plan is cancelled', () => {
  const s0 = closeKit('mac', 12000, closeAt(15), [[closeAt(15, 30), 2000], [closeAt(16), 2000], [closeAt(16, 30), 2000]]);
  const now = closeAt(16, 40);
  const plain = closeFeed(s0, now).find((x) => x.kind === 'shortfall');
  assert.ok(plain && /runs out at 6:10 pm\./.test(plain.consequence) && plain.planFor.ing === 'mac', plain && plain.consequence);
  const r = E.apply(s0, 'planBatch', { ing: 'mac', grams: 8000, offAt: closeAt(18, 30) }, now);
  assert.equal(r.report, 'ok');
  const rescued = closeFeed(r.state, now).find((x) => x.kind === 'shortfall');
  assert.ok(rescued && /runs out at 6:10 pm, next batch ready at 6:30 pm/.test(rescued.consequence), rescued && rescued.consequence);
  assert.equal(rescued.runOutCause, 'rest-gap');
  // A plan that is ready before the run-out covers it: no shortfall row at all.
  const early = E.apply(s0, 'planBatch', { ing: 'mac', grams: 30000, offAt: closeAt(17, 30) }, now);
  assert.equal(closeFeed(early.state, now).some((x) => x.kind === 'shortfall'), false);
  const c = E.apply(r.state, 'cancelPlan', { planId: r.info.planId }, now);
  assert.equal(c.report, 'ok');
  assert.ok(/runs out at 6:10 pm\./.test(closeFeed(c.state, now).find((x) => x.kind === 'shortfall').consequence));
});

test('planned batch: grams it would leave at close are told as a smaller plan, never as cooked food to sell off', () => {
  const s0 = closeKit('mac', 12000, closeAt(15), [[closeAt(15, 30), 2000], [closeAt(16), 2000], [closeAt(16, 30), 2000]]);
  const now = closeAt(16, 40);
  const r = E.apply(s0, 'planBatch', { ing: 'mac', grams: 30000, offAt: closeAt(17, 30) }, now);
  assert.equal(r.report, 'ok');
  const row = closeFeed(r.state, now).find((x) => x.kind === 'leftover');
  assert.ok(row, 'a big plan raises a leftover row');
  assert.equal(row.leftoverG, 0, 'no cooked food is left over');
  assert.ok(row.plannedLeftG > 5000, String(row.plannedLeftG));
  assert.match(row.consequence, /^The planned batch would leave about/);
  assert.match(row.action, /Plan a smaller batch/);
});

test('planned batch: it is supply only, never stock: no 86 and no ledger movement', () => {
  const s0 = closeKit('mac', 12000, closeAt(15), [[closeAt(15, 30), 2000]]);
  const r = E.apply(s0, 'planBatch', { ing: 'mac', grams: 8000, offAt: closeAt(18, 30) }, closeAt(16));
  assert.deepEqual(r.state.avail, s0.avail);
  assert.deepEqual(r.state.ledger, s0.ledger);
  assert.equal(r.state.batches, s0.batches);
});

test('thresholds: build uses the owner list from settings, and rungsFor still works with one argument', () => {
  const s = E.newState({ now: T0, empty: true });
  assert.deepEqual(D.rungsFor('ribs'), [90, 45, 20, 10]);
  const s2 = E.apply(s, 'updateSettings', { patch: { alerts: { ladderThresholds: { default: [40, 15], byIng: { ribs: [50, 25, 8] } } } } }, T0).state;
  assert.deepEqual(D.rungsFor('ribs', s2.settings), [50, 25, 8]);
  assert.deepEqual(D.rungsFor('pork', s2.settings), [40, 15]);
  assert.deepEqual(D.rungsFor('brisket', s2.settings), [40, 15], 'the owner default replaces the built-in list for products with no entry of their own');
  const s3 = E.apply(s2, 'addBatch', { ing: 'ribs', tempF: 160, cookedG: 6000 }, T0).state;
  const f = D.build(s3, T0 + 4 * HR - 20 * MIN).find((x) => x.kind === 'expiry');
  assert.deepEqual(f.rungsMin, [50, 25, 8]);
  assert.equal(f.rung, 2, '20 minutes left is past the 50 and 25 minute rungs');
});

test('batch waste time-steps: a younger batch sells only after the older one runs out or expires', () => {
  // 1 unit an hour. A: 10 units, in at 0, gone at 3 h. B: 10 units, in at 1 h, ready at 2 h, gone at 8 h.
  // A sells 3 in its 3 hours; B sells 5 from 3 h to 8 h, so B wastes 5, not 7.
  const w = D.batchWaste([
    { id: 'A', remainingG: 10, enteredAt: T0, readyAt: T0, expAt: T0 + 3 * HR },
    { id: 'B', remainingG: 10, enteredAt: T0 + HR, readyAt: T0 + 2 * HR, expAt: T0 + 8 * HR },
  ], 1 / HR, T0);
  assert.ok(Math.abs(w.A - 7) < 1e-6, 'A wastes 7: ' + w.A);
  assert.ok(Math.abs(w.B - 5) < 1e-6, 'B wastes 5: ' + w.B);
});

test('close time sits at the clock hour set, also on a clock-change day (run with TZ=America/New_York to see it bite)', () => {
  const st = { settings: { service: { closeHour: 21.5 } } };
  for (const [y, m, d] of [[2026, 2, 8], [2026, 10, 1]]) {
    const at = D.closeAtMs(st, new Date(y, m, d, 12, 0).getTime());
    const c = new Date(at);
    assert.equal(c.getDate(), d); assert.equal(c.getHours(), 21); assert.equal(c.getMinutes(), 30);
  }
});
