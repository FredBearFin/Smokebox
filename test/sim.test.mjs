// Tests for SB.sim: the 14-day sample (determinism, shape, kitchen realism, crew truth), the persisted on/off switch,
// the live demo controller on the real store with a fake clock, and seedFirstRun.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadSB, ROOT } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store', '40-metrics', '45-sim']);
const { sim: Sim, engine: E, config: C, util: U, metrics: M, store: S } = SB;

// A fixed "today" so the sample is the same on every machine and every day: Saturday 17 Oct 2026, noon.
const ANCHOR = new Date(2026, 9, 17, 12, 0, 0).getTime();
const MIN = 60e3, H = 3600e3;
const SRC = fs.readFileSync(path.join(ROOT, 'src/js/45-sim.js'), 'utf8');

const t0 = performance.now();
const A = Sim.sample({ now: ANCHOR });
const genMs = Math.round(performance.now() - t0);
console.log(`# sample generated in ${genMs} ms (${A.tickets.length} tickets, ${A.events.length} events, ${A.batches.length} batches)`);

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const hour = (t) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60; };
const dsOf = (s) => ({ tickets: s.tickets, events: s.events, batches: s.batches, learned: s.learned, menu: C.menu, ingredients: C.ingredients, settings: E.defaultSettings(), range: { from: s.from, to: s.to } });
const eventsOfDay = (d) => A.events.filter((e) => e.t >= d.openMs - H && e.t <= d.endAt + 1000);
const dayOf = (t) => A.days.find((d) => t >= d.openMs - H && t <= d.endAt + 1000);

test('the sample is deterministic and memoised', () => {
  assert.equal(Sim.sample({ now: ANCHOR }), A, 'a second call returns the same object');
  const key = (s) => JSON.stringify([s.tickets, s.events, s.batches, s.learned, s.days.map((d) => [d.tickets, d.batches, d.invariants])]);
  const first = key(A);
  Sim.clearSample();
  const again = Sim.sample({ now: ANCHOR });
  assert.notEqual(again, A, 'a cleared memo makes a new object');
  assert.equal(key(again), first, 'same seed, same fortnight');
  assert.equal(A.seed, 20261017);
});

test('14 days, in order, ending yesterday, with the shape the office expects', () => {
  assert.equal(A.days.length, 14);
  assert.equal(A.days[13].date, '2026-10-16');
  assert.equal(A.days[0].date, '2026-10-03');
  for (let i = 1; i < 14; i++) assert.ok(A.days[i].date > A.days[i - 1].date);
  assert.ok(A.from < A.to);
  for (const k of ['tickets', 'events', 'batches', 'learned', 'days', 'seed', 'from', 'to']) assert.ok(A[k] !== undefined, k);
  assert.ok(Array.isArray(A.tickets) && Array.isArray(A.events) && Array.isArray(A.batches));
  for (const t of A.tickets) assert.ok(t.createdAt >= A.from && t.createdAt < A.to, 'ticket inside the range');
});

test('tickets per day: busy Fri/Sat, a slow storm day, a surge day', () => {
  const normal = A.days.filter((d) => d.kind === 'normal');
  const base = median(normal.map((d) => d.tickets));
  assert.ok(base >= 150 && base <= 200, 'median normal day ' + base);
  const weekend = normal.filter((d) => d.weekday === 5 || d.weekday === 6).map((d) => d.tickets);
  const midweek = normal.filter((d) => d.weekday >= 1 && d.weekday <= 4).map((d) => d.tickets);
  assert.ok(weekend.length >= 3 && midweek.length >= 4);
  assert.ok(weekend.reduce((a, b) => a + b) / weekend.length > 1.1 * (midweek.reduce((a, b) => a + b) / midweek.length), 'Friday and Saturday are busier');
  const storm = A.days.find((d) => d.kind === 'storm'), surge = A.days.find((d) => d.kind === 'surge');
  assert.ok(storm.tickets < 0.75 * base, 'storm ' + storm.tickets + ' vs ' + base);
  assert.ok(surge.tickets > 1.25 * base, 'surge ' + surge.tickets + ' vs ' + base);
  assert.equal(storm.date, A.stormDay);
  assert.equal(surge.date, A.surgeDay);
});

test('every service day ends with the engine invariants clean', () => {
  for (const d of A.days) assert.deepEqual(d.invariants, [], d.date);
});

test('records are valid, labelled sample, and ids never collide', () => {
  const ids = new Set();
  for (const t of A.tickets) {
    assert.equal(t.src, 'sample');
    assert.ok(!ids.has(t.id), 'unique ' + t.id); ids.add(t.id);
    assert.ok(['active', 'expedited', 'voided'].includes(t.status));
    assert.ok(t.items.length >= 1 && t.items.length <= 5, 'basket of 1 to 5 lines');
    assert.ok(C.channels.some((c) => c.id === t.channel));
    for (const it of t.items) {
      assert.ok(C.menuById[it.menuId], it.menuId);
      assert.ok(Number.isInteger(it.qty) && it.qty >= 1);
      if (it.status === 'done') assert.ok(it.doneAt >= t.createdAt);
    }
    if (t.status === 'expedited') assert.ok(t.expeditedAt >= t.createdAt && (t.forced || t.items.every((i) => i.status === 'done')), 'a bumped ticket has every line done unless it was force-bumped');
  }
  for (const b of A.batches) { assert.equal(b.src, 'sample'); assert.ok(!ids.has(b.id)); ids.add(b.id); assert.ok(b.cookedG > 0 && b.remainingG >= 0); }
  const evIds = new Set();
  for (const e of A.events) { assert.ok(!evIds.has(e.id)); evIds.add(e.id); }
  for (let i = 1; i < A.events.length; i++) assert.ok(A.events[i].t >= A.events[i - 1].t, 'events are in time order');
  assert.ok(A.events.every((e) => Number.isInteger(e.t)) && A.tickets.every((t) => Number.isInteger(t.createdAt)), 'times are whole milliseconds, like a real clock');
  // ids sit far above anything a live state will reach, so a merged dataset never doubles up
  assert.ok(A.tickets.every((t) => Number(t.id.slice(2)) >= 9000000));
  // the generator never uses the store, and never asks for old-dated tickets through allowPast
  const gen = SRC.slice(0, SRC.indexOf('8. Live demo traffic'));
  assert.ok(!/SB\.store/.test(gen.replace(/\/\*[\s\S]*?\*\//g, '')), 'sample code does not touch SB.store');
  assert.ok(!/allowPast/.test(gen.replace(/\/\*[\s\S]*?\*\//g, '')), 'sample code does not use allowPast');
});

test('the mix looks like a restaurant: channels, basket sizes, allergy notes, rush, special events', () => {
  const n = A.tickets.length;
  const share = (ch) => A.tickets.filter((t) => t.channel === ch).length / n;
  assert.ok(Math.abs(share('dine_in') - 0.38) < 0.05, 'dine in ' + share('dine_in'));
  assert.ok(Math.abs(share('takeout') - 0.30) < 0.05);
  assert.ok(Math.abs(share('drive_thru') - 0.20) < 0.05);
  assert.ok(Math.abs(share('third_party') - 0.12) < 0.04);
  const allergy = A.tickets.filter((t) => /allergy/i.test(t.note)).length / n;
  assert.ok(allergy > 0.015 && allergy < 0.05, 'allergy share ' + allergy);
  const rush = A.tickets.filter((t) => t.rush).length / n;
  assert.ok(rush > 0.01 && rush < 0.035, 'rush share ' + rush);
  const forced = A.tickets.filter((t) => t.forced).length / n;
  assert.ok(forced > 0.005 && forced < 0.05, 'force-bumped share ' + forced);
  const voided = A.tickets.filter((t) => t.status === 'voided');
  assert.ok(voided.length >= 10 && voided.length / n < 0.03, 'voided ' + voided.length);
  assert.ok(A.events.filter((e) => e.type === 'ticket_voided').every((e) => e.reason), 'every void has a reason');
  assert.ok(A.tickets.filter((t) => t.recalls > 0).length >= 10, 'some tickets were recalled and bumped again');
  assert.ok(A.events.filter((e) => e.type === 'undo').length >= 3, 'a few undo taps');
  assert.ok(A.events.filter((e) => e.type === 'ui_report').length >= 20, 'refused attempts leave friction events');
  const fireNow = A.events.filter((e) => e.type === 'item_fired' && e.override).length + A.tickets.reduce((a, t) => a + t.items.filter((i) => i.override).length, 0);
  assert.ok(fireNow >= n * 0.01, 'some lines were fired early by hand');
  const lines = A.tickets.map((t) => t.items.length);
  for (let k = 1; k <= 5; k++) assert.ok(lines.includes(k), 'baskets of ' + k);
  // lunch and dinner peaks: more orders in 12:00 to 13:30 than in 15:00 to 16:30
  const inWin = (a, b) => A.tickets.filter((t) => hour(t.createdAt) >= a && hour(t.createdAt) < b).length;
  assert.ok(inWin(12, 13.5) > 1.4 * inWin(15, 16.5), 'lunch peak');
  assert.ok(inWin(17.5, 19.5) > 1.4 * inWin(15, 16.5), 'dinner peak');
});

test('pacing is off on days 1 to 5 and on from day 6, and it shortens the time food waits under the lamp', () => {
  A.days.forEach((d, i) => {
    assert.equal(d.pacing, i >= 5, d.date);
    const ts = A.tickets.filter((t) => t.createdAt >= d.openMs && t.createdAt < d.closeMs);
    assert.ok(ts.length > 0 && ts.every((t) => t.pacing === (i >= 5)), 'ticket flags on ' + d.date);
  });
  assert.equal(A.pacingOffDays.length, 5);
  assert.equal(A.pacingOnDays.length, 9);
  const p = M.pacingCompare(dsOf(A));
  assert.equal(p.comparable, true);
  console.log(`# lamp time: pacing off ${(p.off.avgLampMs / 1000).toFixed(0)} s, on ${(p.on.avgLampMs / 1000).toFixed(0)} s; median ticket ${(p.off.medianTotalMs / 1000).toFixed(0)} s off, ${(p.on.medianTotalMs / 1000).toFixed(0)} s on`);
  assert.ok(p.on.avgLampMs < p.off.avgLampMs, 'lamp time is smaller with pacing on');
  assert.ok(p.on.avgLampMs < 0.8 * p.off.avgLampMs, 'by a clear margin');
});

test('the crew is slow where the kitchen is slow: mac about 6:30, fried pickles about 4:30, and the learner moves towards the truth', () => {
  const cal = Object.fromEntries(M.calibration(dsOf(A)).map((r) => [r.menuId, r]));
  assert.ok(cal.mac.observedSec > 360 && cal.mac.observedSec < 420, 'mac ' + cal.mac.observedSec);
  assert.ok(cal.fried_pickles.observedSec > 250 && cal.fried_pickles.observedSec < 295, 'fried pickles ' + cal.fried_pickles.observedSec);
  assert.ok(cal.mac.flag && cal.mac.drift === 'slow');
  assert.ok(cal.fried_pickles.flag && cal.fried_pickles.drift === 'fast');
  // after two weeks the learned plan sits between the starter guess and what the crew really does
  assert.ok(cal.mac.learnedSec > 300 && cal.mac.learnedSec <= 1.2 * cal.mac.observedSec, 'learned mac ' + cal.mac.learnedSec);
  assert.ok(cal.fried_pickles.learnedSec < 340 && cal.fried_pickles.learnedSec >= 0.9 * cal.fried_pickles.observedSec);
  const brisket = cal.brisket_half;
  assert.ok(brisket.ratio > 1.0 && brisket.ratio < 1.35, 'brisket about 1.1x: ' + brisket.ratio);
});

test('ticket times by channel look real: slower on third party, faster at the window, with some awful and some perfect tickets', () => {
  const by = Object.fromEntries(M.byChannel(dsOf(A)).map((r) => [r.channel || r.id, r]));
  const med = (id) => (by[id].medianTotalMs !== undefined ? by[id].medianTotalMs : by[id].medianMs);
  console.log('# median ticket time: ' + ['dine_in', 'takeout', 'drive_thru', 'third_party'].map((id) => id + ' ' + (med(id) / 60000).toFixed(1) + ' min').join(', '));
  for (const id of ['dine_in', 'takeout', 'drive_thru', 'third_party']) assert.ok(med(id) > 150e3 && med(id) < 600e3, id);
  assert.ok(med('third_party') > med('drive_thru'));
  const sm = M.summary(dsOf(A));
  assert.ok(sm.onTimePct > 0.6 && sm.onTimePct < 0.92, 'on time ' + sm.onTimePct);
  const totals = A.tickets.filter((t) => t.status === 'expedited').map((t) => t.expeditedAt - t.createdAt);
  assert.ok(Math.max(...totals) > 12 * MIN, 'at least one awful ticket');
  assert.ok(totals.filter((x) => x < 90e3).length >= 3, 'a few perfect ones');
});

test('stock and 86s: brisket runs out on four days (one early afternoon), ribs on two, a manual 86, and safety lockouts', () => {
  const outs = [];     // { day, ing, t, reason } for the first stock-out of each protein on each day
  const ingOf = (m) => { const mi = C.menuById[m]; const b = mi && mi.bom.find((x) => C.ingredientById[x.ing].tcs); return b ? b.ing : null; };
  for (const d of A.days) {
    const seen = {};
    for (const e of eventsOfDay(d)) {
      if (e.type !== 'avail_changed' || e.ok !== false || e.reason !== 'stock') continue;
      const ing = e.ing || ingOf(e.menuId);
      if (ing === 'brisket' || ing === 'ribs') { if (!seen[ing]) { seen[ing] = true; outs.push({ day: d.date, ing, t: e.t }); } }
    }
  }
  // a real sell-out is still out 20 minutes later; a one-minute flicker between two pans is not counted
  const stays = (o) => { const d = dayOf(o.t); const back = eventsOfDay(d).find((e) => e.type === 'avail_changed' && e.ok === true && e.t > o.t && ingOf(e.menuId) === o.ing); return !back || back.t - o.t > 20 * MIN; };
  const brisket = outs.filter((o) => o.ing === 'brisket' && stays(o)), ribs = outs.filter((o) => o.ing === 'ribs' && stays(o));
  console.log('# brisket sell-outs: ' + brisket.map((o) => o.day.slice(5) + ' ' + Math.floor(hour(o.t)) + ':' + String(Math.round((hour(o.t) % 1) * 60)).padStart(2, '0')).join(', ') +
    ' | ribs: ' + ribs.map((o) => o.day.slice(5) + ' ' + Math.floor(hour(o.t)) + ':' + String(Math.round((hour(o.t) % 1) * 60)).padStart(2, '0')).join(', '));
  assert.ok(brisket.length >= 4, 'brisket sold out on ' + brisket.length + ' days');
  assert.ok(brisket.some((o) => hour(o.t) > 13 && hour(o.t) < 14.3), 'one sell-out around 1:40 pm');
  assert.ok(new Set(brisket.map((o) => o.day)).size === brisket.length);
  assert.ok(ribs.length >= 2, 'ribs sold out on ' + ribs.length + ' days');
  // exactly the scripted manual 86
  const manual = A.events.filter((e) => e.type === 'avail_changed' && e.ok === false && e.reason === 'manual');
  assert.ok(manual.length >= 1 && manual.every((e) => e.menuId === 'hushpuppies'));
  // food-safety lockouts on at least two different days (a pan below 135 F makes its dishes unsellable)
  const lockDays = new Set(A.events.filter((e) => e.type === 'avail_changed' && e.ok === false && e.reason === 'safety').map((e) => dayOf(e.t).date));
  assert.ok(lockDays.size >= 2, 'safety lockouts on ' + [...lockDays].join(', '));
  // shelf-stable items are restocked
  assert.ok(A.events.filter((e) => e.type === 'restock').length >= 14, 'restocks');
});

test('the hold cabinet: brisket pans with raw weight, temperature logs with late and missed checks, dips, reheats, discards, sanitising', () => {
  const brisket = A.batches.filter((b) => b.ing === 'brisket');
  assert.ok(brisket.length >= 14 * 2, 'at least two brisket pans a day');
  for (const b of brisket) { assert.ok(b.rawG > b.cookedG, 'raw weight recorded'); assert.ok(b.endpointC >= 80 && b.endpointC <= 90 && b.holdH >= 1 && b.holdH <= 2.5); }
  const perDay = A.days.map((d) => brisket.filter((b) => b.enteredAt >= d.openMs - H && b.enteredAt < d.closeMs).length);
  assert.ok(perDay.filter((n) => n >= 2 && n <= 6).length >= 10, 'about 2 to 4 brisket pans on most days: ' + perDay.join(' '));
  const kinds = new Set(A.batches.map((b) => b.ing));
  for (const ing of ['pork', 'ribs', 'sausage', 'slaw', 'potato', 'pudding']) assert.ok(kinds.has(ing), ing);
  const temps = A.events.filter((e) => e.type === 'temp_logged');
  const late = temps.filter((e) => e.onTime === false);
  assert.ok(late.length / temps.length > 0.02 && late.length / temps.length < 0.12, 'late or missed checks ' + late.length + ' of ' + temps.length);
  assert.ok(late.some((e) => e.lateMs > 30 * MIN), 'at least one check missed outright (next reading an hour after the last)');
  const dips = temps.filter((e) => e.f < 135 && e.f > 100);
  assert.ok(dips.length >= 3 && dips.length <= 6, 'dips under 135 F: ' + dips.length);
  assert.ok(A.events.filter((e) => e.type === 'batch_reheat').length >= 2, 'reheats');
  const disc = A.events.filter((e) => e.type === 'batch_discard');
  assert.ok(disc.some((e) => e.reason === 'temp'), 'a pan thrown out for temperature');
  assert.ok(disc.some((e) => e.reason === 'expired' || e.reason === 'quality'), 'pans thrown out at the hold limit');
  console.log(`# discards: ${disc.length} (${disc.filter((e) => e.reason === 'temp').length} temperature), ${(disc.reduce((a, e) => a + e.g, 0) / 1000).toFixed(0)} kg of ${(A.batches.reduce((a, b) => a + b.cookedG, 0) / 1000).toFixed(0)} kg cooked`);
  assert.ok(disc.reduce((a, e) => a + e.g, 0) < 0.06 * A.batches.reduce((a, b) => a + b.cookedG, 0), 'waste under 6 percent of food cooked');
  const san = A.events.filter((e) => e.type === 'sanitize_done');
  assert.ok(san.length >= 14 * 3, 'sanitise about every 4 hours: ' + san.length);
  const comp = M.compliance(dsOf(A));
  assert.ok(comp.sanitize.late >= 1 || comp.sanitize.onTimePct < 1, 'a few sanitise rounds were late');
});

test('the crew never reads the learned plan or item.prepSec (differential test in a vm copy, with a mutant that does)', () => {
  const files = ['00-util', '10-config', '20-engine', '45-sim'];
  const load = (mutate, poison) => {
    const ctx = vm.createContext({ console, setTimeout, clearTimeout, performance });
    for (const f of files) {
      let code = fs.readFileSync(path.join(ROOT, 'src/js', f + '.js'), 'utf8');
      if (f === '45-sim' && mutate) {
        const from = 'return mi.prepSec * (TRUE_FACTOR[menuId] || 1);';
        assert.ok(code.includes(from), 'the mutation point still exists in 45-sim.js');
        code = code.replace(from, 'return mi.prepSec * (TRUE_FACTOR[menuId] || 1) * (SB.__peek ? SB.__peek(menuId) : 1);');
      }
      vm.runInContext(code, ctx, { filename: f + '.js' });
      if (f === '20-engine' && poison) {
        // every dish "learned" to take 11 seconds, so the plan on every ticket is nonsense
        const eng = ctx.SB.engine, orig = eng.newState;
        const learned = {}; for (const mi of ctx.SB.config.menu) learned[mi.id] = { est: 11, ema: 11, n: 40 };
        eng.newState = (o) => orig(Object.assign({}, o, { learned: o && o.learned && Object.keys(o.learned).length ? o.learned : JSON.parse(JSON.stringify(learned)) }));
        ctx.SB.__peek = (id) => 11 / ctx.SB.config.menuById[id].prepSec;
      }
    }
    const I = ctx.SB.sim._internal;
    const plan = I.planDay(0, '2026-10-03', 'normal'); plan.pacing = false;
    const r = I.simulateDay(plan, { learned: {}, seq: { ticket: 9e6, batch: 9e6, event: 9e6, sync: 9e6, undo: 0 } });
    const dur = {}, planned = {};
    for (const t of r.state.tickets) for (const it of t.items) {
      if (it.track === 'two' && it.qty === 1 && it.startedAt != null && it.doneAt != null && !it.override) (dur[it.menuId] = dur[it.menuId] || []).push((it.doneAt - it.startedAt) / 1000);
      if (it.menuId === 'mac' && planned.mac === undefined) planned.mac = it.prepSec;
    }
    return { macMed: median(dur.mac || []), picklesMed: median(dur.fried_pickles || []), brisketMed: median(dur.brisket_half || []), macPlan: planned.mac };
  };
  const clean = load(false, false), poisoned = load(false, true), mutant = load(true, true);
  console.log(`# mac work time: clean ${clean.macMed.toFixed(0)} s, poisoned plan ${poisoned.macMed.toFixed(0)} s, mutant that reads the plan ${mutant.macMed.toFixed(0)} s`);
  // the poison really reached the engine's plan ...
  assert.ok(clean.macPlan > 200, 'clean plan ' + clean.macPlan);
  assert.ok(poisoned.macPlan < 0.6 * clean.macPlan, 'poisoned plan ' + poisoned.macPlan + ' vs ' + clean.macPlan);   // the engine will not plan below half the starter time
  // ... and did not move what the crew really does
  assert.ok(Math.abs(poisoned.macMed - clean.macMed) / clean.macMed < 0.12, 'crew time unchanged by the plan: ' + clean.macMed + ' vs ' + poisoned.macMed);
  assert.ok(clean.macMed > 330 && clean.macMed < 450);
  assert.ok(clean.picklesMed > 230 && clean.picklesMed < 310);
  // the same detector catches a crew that does read the plan
  assert.ok(mutant.macMed < 0.4 * clean.macMed, 'mutant crew follows the plan: ' + mutant.macMed);
});

test('sampleInfo agrees with the sample', () => {
  const info = Sim.sampleInfo({ now: ANCHOR });
  const s = Sim.sample({ now: ANCHOR });
  assert.equal(info.days, 14);
  assert.equal(info.tickets, s.tickets.length);
  assert.equal(info.ticketsPerDay, Math.round(s.tickets.length / 14));
  assert.equal(info.fromDate, '2026-10-03');
  assert.equal(info.toDate, '2026-10-16');
  assert.deepEqual(info.pacingOffDays, s.pacingOffDays);
  assert.equal(info.pacingOnDays.length, 9);
  assert.equal(info.stormDay, s.stormDay);
  assert.equal(info.surgeDay, s.surgeDay);
  assert.equal(typeof info.note, 'string');
  assert.ok(/not your restaurant/i.test(info.note) && /sample/i.test(info.note), 'the note says plainly that this is sample data');
});

test('the sample switch is persisted under smokebox.v1.sample and defaults to off', () => {
  assert.equal(Sim.sampleEnabled(), false);
  const heard = [];
  const off = Sim.onSampleChange((v) => heard.push(v));
  assert.equal(Sim.setSampleEnabled(true), true);
  assert.equal(U.storage.get('smokebox.v1.sample', null), true);
  assert.equal(Sim.setSampleEnabled(false), false);
  assert.equal(U.storage.get('smokebox.v1.sample', null), false);
  assert.deepEqual(heard, [true, false]);
  off();
  Sim.setSampleEnabled(true); Sim.setSampleEnabled(false);
  assert.deepEqual(heard, [true, false], 'removed listeners stay quiet');
  Sim.setSampleEnabled(true);
  // a fresh copy reads the stored value
  assert.equal(Sim.sampleEnabled(), true);
});

test('timing: generation time is within budget', () => {
  // CPU time, not wall time: other jobs on a shared machine slow the clock on the wall but not the work done.
  Sim.clearSample();
  const c0 = process.cpuUsage(), a = performance.now();
  const s = Sim.sample({ now: ANCHOR });
  const wall = Math.round(performance.now() - a), c1 = process.cpuUsage(c0), cpu = Math.round((c1.user + c1.system) / 1000);
  console.log(`# generation in Node: ${cpu} ms of CPU, ${wall} ms on the wall clock (first run ${genMs} ms; target under 4000 ms)`);
  assert.ok(cpu < 4000, 'took ' + cpu + ' ms of CPU');
  assert.ok(s.tickets.length > 2000);
});

/* ---------- live demo traffic and the first run, on the real store with a fake clock ---------- */
const T0 = new Date(2026, 9, 17, 12, 0, 0).getTime();
function memStorage() {
  const m = new Map();
  return { persistent: true, get(k, fb) { const r = m.get(k); return r == null ? fb : JSON.parse(r); }, set(k, v) { m.set(k, JSON.stringify(v)); return true; }, remove(k) { m.delete(k); } };
}
function boot() {
  Sim.live.stop();
  const clock = { real: T0 };
  S.init({ now: () => clock.real, storage: memStorage(), noTimers: true, noSync: true });
  S.resetLive({ keepSettings: true, starter: true, stagger: true }); // the demo kitchen, which a real first run no longer starts with
  const tick = (secs, step = 1) => { for (let s = 0; s < secs; s += step) { clock.real += step * 1000; S.tick(); } };
  return { clock, tick };
}

test('live: tickets flow at the chosen rate for 5 virtual minutes at speed 30, then stop leaves nothing running', () => {
  const { tick } = boot();
  S.setSpeed(30);
  const seen = [];
  const off = Sim.live.onChange((st) => seen.push(st.sent));
  const st0 = Sim.live.start({ rate: 'normal', seed: 7 });
  assert.equal(st0.running, true);
  assert.equal(st0.rate, 'normal');
  assert.equal(st0.speed, 30);
  tick(10);                       // 10 real seconds at speed 30 = 5 virtual minutes
  const st1 = Sim.live.status();
  assert.ok(st1.sent >= 3 && st1.sent <= 16, 'about one ticket per 40 s: ' + st1.sent);
  const tix = S.getState().tickets;
  assert.equal(tix.length, st1.sent);
  assert.ok(tix.every((t) => t.src === 'demo'));
  assert.ok(tix.every((t) => t.createdAt <= S.now()), 'never dated in the future');
  assert.ok(seen.length > 0 && seen.at(-1) === st1.sent, 'onChange heard the count');
  assert.ok(tix.some((t) => t.items.some((i) => i.status !== 'queued')), 'the crew picked work up');
  tick(300);                      // more crew work: some tickets finish
  assert.ok(Sim.live.status().completed >= 1, 'some tickets bumped');
  assert.deepEqual(E.checkInvariants(S.getState(), S.now()), []);
  // stop: nothing more happens however long the clock runs
  Sim.live.stop();
  const n = S.getState().tickets.length, ev = E.allEvents(S.getState()).length;
  const sentAtStop = Sim.live.status().sent;
  tick(60);
  assert.equal(Sim.live.status().running, false);
  assert.equal(S.getState().tickets.length, n);
  assert.equal(Sim.live.status().sent, sentAtStop);
  const freshTypes = new Set(E.allEvents(S.getState()).slice(ev).map((e) => e.type));
  assert.ok(!freshTypes.has('ticket_created') && !freshTypes.has('item_done') && !freshTypes.has('ticket_expedited'), 'no crew activity after stop');
  off();
  S.destroy();
});

test('live: the same seed gives the same traffic; rates differ; crew off leaves tickets untouched', () => {
  const run = (rate, seed, crew) => {
    const { tick } = boot();
    S.setSpeed(30);
    Sim.live.crew(crew);
    Sim.live.start({ rate, seed });
    tick(20);
    const out = S.getState().tickets.map((t) => [t.customer, t.items.map((i) => i.menuId + i.qty).join(','), t.status]);
    const done = S.getState().tickets.reduce((a, t) => a + t.items.filter((i) => i.status === 'done').length, 0);
    Sim.live.stop(); S.destroy();
    return { out, done };
  };
  const a = run('normal', 11, true), b = run('normal', 11, true);
  assert.deepEqual(a.out, b.out, 'repeatable');
  const slow = run('slow', 11, true).out.length, rush = run('rush', 11, true).out.length;
  assert.ok(rush > 2 * slow, `rush ${rush} vs slow ${slow}`);
  const noCrew = run('normal', 11, false);
  assert.equal(noCrew.done, 0, 'with the crew off nobody works the tickets');
  assert.ok(noCrew.out.length > 3);
  Sim.live.crew(true);
});

test('live: burst, 86d dishes are skipped, odd clocks and speed changes never throw', () => {
  const { clock, tick } = boot();
  assert.equal(Sim.live.burst(12), 12);
  assert.equal(S.getState().tickets.length, 12);
  assert.equal(Sim.live.burst(500) <= 40, true, 'a burst is capped');
  // 86 two dishes by hand; no new demo ticket may contain them
  assert.equal(S.dispatch('toggle86', { menuId: 'brisket_half', on: true }), 'ok');
  assert.equal(S.dispatch('toggle86', { menuId: 'mac', on: true }), 'ok');
  const before = S.getState().tickets.length;
  Sim.live.burst(40);
  Sim.live.start({ rate: 'rush', seed: 3 });
  tick(30);
  const fresh = S.getState().tickets.slice(before);
  assert.ok(fresh.length > 20);
  assert.ok(fresh.every((t) => t.items.every((i) => i.menuId !== 'brisket_half' && i.menuId !== 'mac')), 'no 86d dish on a new ticket');
  // the speed changes under it, a whole hour passes in one tick, the clock repeats itself: nothing throws and arrivals are capped
  S.setSpeed(500);
  tick(3);
  S.setSpeed(1);
  const n1 = S.getState().tickets.length;
  clock.real += 3600e3; S.tick();
  assert.ok(S.getState().tickets.length - n1 <= 12 + 1, 'a long gap does not flood the board');
  S.tick(); S.tick();
  assert.deepEqual(E.checkInvariants(S.getState(), S.now()), []);
  Sim.live.stop();
  assert.equal(Sim.live.stop().running, false, 'stop twice is fine');
  assert.equal(typeof Sim.live.onChange(() => {}), 'function');
  S.destroy();
});

test('live: without a store it does nothing and does not throw', () => {
  const ctx = vm.createContext({ console, performance });
  for (const f of ['00-util', '10-config', '20-engine', '45-sim']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  const L = ctx.SB.sim.live;
  assert.equal(L.start({ rate: 'rush' }).running, false);
  assert.equal(L.burst(5), 0);
  assert.equal(L.stop().running, false);
  assert.equal(ctx.SB.sim.seedFirstRun(), 0);
});

test('seedFirstRun: three fresh demo tickets, none late, once per session, never over existing tickets', () => {
  const fresh = (hasTickets) => {
    const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout });
    for (const f of ['00-util', '10-config', '20-engine', '30-store', '45-sim']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
    const clock = { real: T0 };
    ctx.SB.store.init({ now: () => clock.real, storage: memStorage(), noTimers: true, noSync: true });
  ctx.SB.store.resetLive({ keepSettings: true, starter: true, stagger: true });
    ctx.SB.store.resetLive({ keepSettings: true, starter: true, stagger: true });
    if (hasTickets) assert.equal(ctx.SB.store.dispatch('createTicket', { customer: 'Walk-in', items: [{ menuId: 'slaw' }] }), 'ok');
    return ctx.SB;
  };
  const sb = fresh(false);
  assert.equal(sb.sim.seedFirstRun(), 3);
  assert.equal(sb.sim.seedFirstRun(), 0, 'second call does nothing');
  const st = sb.store.getState(), now = sb.store.now();
  assert.equal(st.tickets.length, 3);
  assert.ok(st.tickets.every((t) => t.src === 'demo'));
  const ages = Array.from(st.tickets, (t) => Math.round((now - t.createdAt) / 1000));
  assert.equal(JSON.stringify(ages), '[25,12,3]');
  assert.ok(st.tickets.every((t) => !t.rush), 'no rush, so pacing shows');
  assert.ok(st.tickets.some((t) => /allergy/i.test(t.note)), 'an allergy note');
  assert.ok(st.tickets.every((t) => t.items.every((i) => i.status === 'queued' || i.status === 'displayed')), 'every dish is at the start');
  assert.ok(st.tickets.some((t) => t.items.some((i) => i.status === 'queued')), 'a dish is waiting for its turn');
  assert.ok(st.tickets.some((t) => t.items.some((i) => i.status === 'displayed')), 'a dish is ready to start');
  assert.equal(sb.engine.checkInvariants(st, now).length, 0);
  const busy = fresh(true);
  assert.equal(busy.sim.seedFirstRun(), 0, 'live tickets are never mixed with demo tickets');
  assert.equal(busy.store.getState().tickets.length, 1);
});

test('restartDemo: clears the board and the fast clock, then puts the three fresh tickets back', () => {
  const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout });
  for (const f of ['00-util', '10-config', '20-engine', '30-store', '45-sim']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  const clock = { real: T0 };
  ctx.SB.store.init({ now: () => clock.real, storage: memStorage(), noTimers: true, noSync: true });
  const { sim, store, engine } = ctx.SB;
  store.resetLive({ keepSettings: true, starter: true, stagger: true });
  assert.equal(sim.seedFirstRun(), 3);
  assert.equal(store.dispatch('createTicket', { customer: 'Walk-in', items: [{ menuId: 'slaw' }] }), 'ok');
  store.setSpeed(30);
  assert.equal(store.getState().tickets.length, 4);
  assert.equal(sim.restartDemo(), 3);
  const st = store.getState();
  assert.equal(st.tickets.length, 3);
  assert.ok(st.tickets.every((t) => t.src === 'demo' && t.status === 'active'));
  assert.equal(store.speed(), 1, 'the clock is back to real time');
  assert.equal(engine.checkInvariants(st, store.now()).length, 0);
  assert.equal(sim.restartDemo(), 3, 'it can be restarted again and again');
});
