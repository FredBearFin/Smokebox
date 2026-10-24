// Cold items kept in a fridge: the owner's two limits (days in the fridge, hours out of it), the out-of-fridge clock that
// pauses and adds up, validation, undo, backups and old saves, the cooling readings, and the deadline words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '25-deadlines']);
const { engine: E, util: U, deadlines: D } = SB;
const MIN = 60e3, H = 3600e3;
const T = new Date(2026, 9, 23, 17, 0, 0).getTime();          // 5 pm local on Oct 23
const ok = (r, w) => { assert.equal(r.report, 'ok', (w || '') + ': ' + r.report + ' ' + JSON.stringify(r.info)); return r.state; };
// A sample kitchen plus one cold cooked-ahead item kept in a fridge, with the given limits (undefined = blank), and one batch of it.
function kitchen(limits, at) {
  let s = E.newState({ now: T });
  s = ok(E.apply(s, 'addIngredient', Object.assign({ name: 'Fridge slaw', unit: 'g', tcs: true, hold: 'cold', fridge: true }, limits || {}), T), 'add');
  s = ok(E.apply(s, 'addBatch', { ing: 'fridge_slaw', cookedG: 3000, tempF: 38 }, at == null ? T : at), 'batch');
  return s;
}
const batch = (s) => s.batches.find((b) => b.ing === 'fridge_slaw');
const act = (s, type, p, at) => E.apply(s, type, p, at);

test('a fridge item takes the owner\'s two limits, with no default, and a batch copies them with its made-on date', () => {
  let s = E.newState({ now: T });
  s = ok(E.apply(s, 'addIngredient', { name: 'Fridge slaw', unit: 'g', tcs: true, hold: 'cold', fridge: true }, T));
  const ing = s.ingredients.find((i) => i.id === 'fridge_slaw');
  assert.equal(ing.fridge, true); assert.equal(ing.fridgeDays, undefined); assert.equal(ing.outHours, undefined);
  s = ok(E.apply(s, 'updateIngredient', { id: 'fridge_slaw', patch: { fridgeDays: 3, outHours: 1.5 } }, T));
  s = ok(E.apply(s, 'addBatch', { ing: 'fridge_slaw', cookedG: 2000, tempF: 38 }, T));
  const b = batch(s);
  assert.deepEqual([b.kind, b.fridge, b.place, b.madeOn, b.fridgeDays, b.outHours, b.lineMs], ['cold', true, 'fridge', '2026-10-23', 3, 1.5, 0]);
  // editing the product later does not change the label of a batch already made
  s = ok(E.apply(s, 'updateIngredient', { id: 'fridge_slaw', patch: { fridgeDays: 5 } }, T + MIN));
  assert.equal(batch(s).fridgeDays, 3);
  const info = E.coldInfo(batch(s), T);
  assert.equal(info.useBy, '2026-10-25'); assert.equal(info.noLimit, false); assert.equal(info.place, 'fridge');
});

test('validation: ranges, whole days, null clears, hot and plain items cannot carry the fields', () => {
  const s = E.newState({ now: T });
  const add = (p) => E.apply(s, 'addIngredient', Object.assign({ name: 'X item', unit: 'g', tcs: true, hold: 'cold', fridge: true }, p), T);
  for (const bad of [{ fridgeDays: 0 }, { fridgeDays: 31 }, { outHours: 0.1 }, { outHours: 25 }]) {
    const r = add(bad); assert.equal(r.report, 'outOfBounds', JSON.stringify(bad)); assert.match(r.info.key, /ingredients\.new\.(fridgeDays|outHours)/); assert.ok(r.info.min < r.info.max);
  }
  assert.equal(add({ fridgeDays: 2.5 }).report, 'outOfBounds');
  assert.equal(add({ fridgeDays: '3' }).report, 'badPatch');
  assert.equal(E.apply(s, 'addIngredient', { name: 'Hot thing', unit: 'g', tcs: true, hold: 'hot', fridge: true }, T).report, 'badPatch');
  assert.equal(E.apply(s, 'addIngredient', { name: 'Plain', unit: 'g', fridgeDays: 2 }, T).report, 'badPatch');
  assert.equal(E.apply(s, 'addIngredient', { name: 'No flag', unit: 'g', tcs: true, hold: 'cold', fridgeDays: 2 }, T).report, 'badPatch');
  let k = ok(add({ fridgeDays: 2, outHours: 4 }));
  k = ok(E.apply(k, 'updateIngredient', { id: 'x_item', patch: { fridgeDays: null } }, T));
  assert.equal(k.ingredients.find((i) => i.id === 'x_item').fridgeDays, undefined);
  assert.equal(E.apply(k, 'updateIngredient', { id: 'x_item', patch: { fridgeDays: null } }, T).report, 'nothingToDo');
  k = ok(E.apply(k, 'updateIngredient', { id: 'x_item', patch: { fridge: false } }, T));
  assert.equal(k.ingredients.find((i) => i.id === 'x_item').outHours, undefined);
  assert.equal(E.apply(k, 'updateIngredient', { id: 'brisket', patch: { fridge: true } }, T).report, 'badPatch');   // a hot product
  assert.equal(E.apply(k, 'updateIngredient', { id: 'brisket', patch: { outHours: 2 } }, T).report, 'badPatch');
});

test('the fridge date is a calendar date: the day made is day 1 and the batch ends at midnight after the last day', () => {
  const s = kitchen({ fridgeDays: 2 });
  const midnight2 = new Date(2026, 9, 25, 0, 0, 0).getTime();               // end of Oct 24 (day 2)
  const early = E.tick(s, midnight2 - MIN).state;
  assert.notEqual(batch(early).status, 'discard');
  const late = E.tick(s, midnight2 + MIN).state;
  assert.equal(batch(late).status, 'discard'); assert.equal(batch(late).discardReason, 'fridgeDate');
  const one = kitchen({ fridgeDays: 1 });
  assert.equal(batch(E.tick(one, new Date(2026, 9, 24, 0, 1).getTime()).state).discardReason, 'fridgeDate');
  assert.deepEqual(E.checkInvariants(late, midnight2 + MIN), []);
});

test('no limit set: the app tracks time, says so, and never discards by the clock', () => {
  let s = kitchen({});
  s = ok(act(s, 'coldTakeOut', { batchId: batch(s).id }, T + MIN));
  const c = E.coldInfo(batch(E.tick(s, T + 40 * H).state), T + 40 * H);
  assert.equal(c.noLimit, true); assert.equal(c.outLeftMs, null); assert.equal(c.fridgeLeftMs, null);
  assert.notEqual(batch(E.tick(s, T + 40 * H).state).status, 'discard');
  assert.match(D.coldLine(batch(s), T + 2 * H), /no limit set/);
});

test('out-of-fridge clock: starts at take out, pauses on return, adds up, and ends the batch at the owner\'s hours', () => {
  let s = kitchen({ outHours: 2 });
  const id = batch(s).id;
  s = ok(act(s, 'coldTakeOut', { batchId: id, who: 'AB' }, T + 10 * MIN));
  assert.equal(batch(s).place, 'line'); assert.equal(batch(s).lineSince, T + 10 * MIN);
  s = ok(act(s, 'coldReturn', { batchId: id }, T + 70 * MIN));              // 60 minutes out
  assert.equal(batch(s).lineMs, 60 * MIN); assert.equal(batch(s).place, 'fridge'); assert.equal(batch(s).lineSince, undefined);
  s = E.tick(s, T + 20 * H).state;                                           // a long time in the fridge costs nothing
  assert.equal(E.coldInfo(batch(s), T + 20 * H).outMs, 60 * MIN);
  assert.notEqual(batch(s).status, 'discard');
  s = ok(act(s, 'coldTakeOut', { batchId: id }, T + 20 * H));
  assert.notEqual(batch(E.tick(s, T + 20 * H + 59 * MIN).state).status, 'discard');       // 60 + 59 = 119 minutes
  const over = E.tick(s, T + 20 * H + 61 * MIN).state;                                      // 60 + 61 = 121 minutes
  assert.equal(batch(over).status, 'discard'); assert.equal(batch(over).discardReason, 'outTime');
  assert.ok(over.events.some((e) => e.type === 'batch_out' && e.who === undefined) && over.events.some((e) => e.type === 'batch_back'));
  assert.deepEqual(E.checkInvariants(over, T + 20 * H + 61 * MIN), []);
});

test('the hours are checked on time even if nobody taps; refusals are named', () => {
  let s = kitchen({ outHours: 1 });
  const id = batch(s).id;
  s = ok(act(s, 'coldTakeOut', { batchId: id }, T + MIN));
  const r = act(s, 'coldReturn', { batchId: id }, T + 3 * H);            // the hour ran out long before; the catch-up already threw it out
  assert.equal(r.report, 'batchNotServable'); assert.equal(batch(E.tick(s, T + 3 * H).state).discardReason, 'outTime');
  assert.equal(act(s, 'coldTakeOut', { batchId: id }, T + 2 * MIN).report, 'nothingToDo');
  assert.equal(act(s, 'coldTakeOut', { batchId: id }, T + 2 * MIN).info.why, 'alreadyOut');
  assert.equal(act(kitchen({}), 'coldReturn', { batchId: 'b_9999' }, T).report, 'unknownBatch');
  assert.equal(act(kitchen({}), 'coldReturn', { batchId: batch(kitchen({})).id }, T).info.why, 'alreadyIn');
  const hot = E.newState({ now: T, stagger: true });
  assert.equal(act(hot, 'coldTakeOut', { batchId: hot.batches[0].id }, T).report, 'notFridgeBatch');
  assert.equal(act(kitchen({}), 'coldTakeOut', { batchId: batch(kitchen({})).id, who: 'ABCDEFGHIJKLMNO' }, T).report, 'badWho');
});

test('undo of a take out or put back restores the old place and clock, even when the move ended the batch', () => {
  let s = kitchen({ outHours: 1 });
  const id = batch(s).id, before = JSON.stringify(batch(s));
  s = ok(act(s, 'coldTakeOut', { batchId: id }, T + MIN));
  s = ok(act(s, 'undo', {}, T + MIN + 1000));
  assert.equal(JSON.stringify(batch(s)), before);
  s = ok(act(s, 'coldTakeOut', { batchId: id }, T + 2 * MIN));
  s = ok(act(s, 'coldReturn', { batchId: id }, T + 20 * MIN));
  assert.equal(batch(s).lineMs, 18 * MIN);
  s = ok(act(s, 'undo', {}, T + 20 * MIN + 1000));
  assert.equal(batch(s).place, 'line'); assert.equal(batch(s).lineSince, T + 2 * MIN); assert.equal(batch(s).lineMs, 0);
  assert.equal(E.checkInvariants(s, T + 20 * MIN + 1000).length, 0);
});

test('property: out time adds up exactly across random moves, restarts and clock jumps, and never goes down or negative', () => {
  const rng = U.rng(4242);
  for (let q = 0; q < 60; q++) {
    let s = kitchen({ outHours: 24 });
    const id = batch(s).id;
    let now = T, model = 0, since = null, last = T, prevMs = 0;
    for (let step = 0; step < 40; step++) {
      const dt = rng.next() < 0.15 ? -Math.round(rng.next() * 30 * MIN) : Math.round(rng.next() * 25 * MIN);   // some clock jumps back
      now += dt;
      if (rng.next() < 0.15) s = JSON.parse(JSON.stringify(s));                                                // a restart: the state comes back from saved text
      const out = batch(s).place === 'line';
      const r = act(s, out ? 'coldReturn' : 'coldTakeOut', { batchId: id }, now);
      if (r.report === 'ok') {
        s = r.state;
        const t = Math.max(last, now);                                  // the move time never goes backwards
        if (!out) since = t; else { model += Math.max(0, t - since); since = null; }
        last = t;
        assert.equal(batch(s).movedAt, t);
        if (batch(s).status === 'discard') break;
      }
      const b = batch(s);
      assert.ok(b.lineMs >= 0 && b.lineMs >= prevMs, 'finished out time only grows'); prevMs = b.lineMs;
      assert.equal(b.lineMs, model, 'finished out time equals the model');
      assert.deepEqual(E.checkInvariants(s, last).filter((x) => /I20/.test(x)), []);
    }
  }
});

test('property: with time moving forward, the batch is thrown out exactly when out time passes the owner\'s hours', () => {
  const rng = U.rng(99);
  for (let q = 0; q < 60; q++) {
    const hours = [0.5, 1, 2][Math.floor(rng.next() * 3)];
    let s = kitchen({ outHours: hours });
    const id = batch(s).id;
    let now = T, total = 0, since = null;
    for (let step = 0; step < 30; step++) {
      now += Math.round((1 + rng.next() * 20) * MIN);
      const live = total + (since == null ? 0 : now - since);
      s = E.tick(s, now).state;
      if (batch(s).status === 'discard') { assert.ok(live > hours * H, 'thrown out only after the hours were passed'); assert.equal(batch(s).discardReason, 'outTime'); break; }
      assert.ok(live <= hours * H, 'still here only while the hours are not passed');
      s = ok(act(s, since == null ? 'coldTakeOut' : 'coldReturn', { batchId: id }, now));
      if (since == null) since = now; else { total = live; since = null; }
    }
    // far enough on, a batch that is out has always been thrown out
    if (since != null && batch(s).status !== 'discard') assert.equal(batch(E.tick(s, now + 25 * H).state).status, 'discard');
  }
});

test('backups and old saves: fields round trip, bad ones are repaired, and batches without them behave as before', () => {
  let s = kitchen({ fridgeDays: 3, outHours: 2 });
  s = ok(act(s, 'coldTakeOut', { batchId: batch(s).id }, T + MIN));
  const v = E.validateBackup(E.exportBackup ? E.exportBackup(s, T + 2 * MIN) : JSON.stringify({ v: 1, savedAt: T, state: s }));
  assert.equal(v.ok, true);
  assert.deepEqual([batch(v.state).place, batch(v.state).lineSince, batch(v.state).madeOn, batch(v.state).fridgeDays], ['line', T + MIN, '2026-10-23', 3]);
  // damaged copies are repaired, never trusted
  const bad = JSON.parse(JSON.stringify(s));
  Object.assign(batch(bad), { place: 'moon', lineMs: -5, madeOn: 'yesterday', fridgeDays: 99, outHours: -1 });
  const r = E.validateBackup(JSON.stringify({ v: 1, savedAt: T, state: bad }));
  assert.equal(r.ok, true);
  const b = batch(r.state);
  assert.deepEqual([b.place, b.lineMs, b.madeOn, b.fridgeDays, b.outHours], ['fridge', 0, '2026-10-23', undefined, undefined]);   // an unknown place becomes the fridge
  // a batch that is not cold, or whose product is not a fridge item, loses stray place fields
  const stray = JSON.parse(JSON.stringify(E.newState({ now: T, stagger: true })));
  Object.assign(stray.batches[0], { fridge: true, place: 'line', lineSince: T });
  const sr = E.validateBackup(JSON.stringify({ v: 1, savedAt: T, state: stray }));
  assert.equal(sr.state.batches[0].place, undefined); assert.equal(sr.state.batches[0].fridge, undefined);
  // the sample's own cold items have no fridge fields and keep the single hold limit
  const sample = E.newState({ now: T, stagger: true });
  assert.ok(sample.batches.every((x) => x.fridge === undefined && x.place === undefined));
  const slaw = sample.batches.find((x) => x.kind === 'cold');
  assert.ok(slaw);
  assert.equal(E.gate(slaw, T, SB.config.safety).action === 'DISCARD_LOCKOUT', false);
  assert.ok(sample.ingredients.every((i) => i.fridge === undefined));
});

test('invariant I20 catches broken place data', () => {
  const s = kitchen({ outHours: 2 });
  const bend = (f) => { const c = JSON.parse(JSON.stringify(s)); f(batch(c)); return E.checkInvariants(c, T).join('|'); };
  assert.match(bend((b) => { b.place = 'line'; }), /I20/);                 // out without a start time
  assert.match(bend((b) => { b.lineMs = -1; }), /I20/);
  assert.match(bend((b) => { b.place = 'sky'; }), /I20/);
  assert.match(bend((b) => { b.kind = 'hot'; }), /I20/);
  assert.equal(bend(() => {}), '');
});

test('cooling readings: the reading that reached each mark is kept with its time', () => {
  let s = E.newState({ now: T, stagger: true });
  const hot = s.batches.find((b) => b.kind === 'hot' && b.remainingG > 0);
  s = ok(act(s, 'startCooling', { batchId: hot.id }, T));
  const cid = s.batches.find((b) => b.kind === 'cooling' && b.from === hot.id).id;
  s = ok(act(s, 'logTemp', { batchId: cid, tempF: 68, who: 'AB' }, T + 90 * MIN));
  let c = s.batches.find((b) => b.id === cid);
  assert.deepEqual([c.stage1F, c.stage1At, c.finalF], [68, T + 90 * MIN, undefined]);
  s = ok(act(s, 'logTemp', { batchId: cid, tempF: 40 }, T + 5 * H));
  c = s.batches.find((b) => b.id === cid);
  assert.deepEqual([c.stage1F, c.finalF, c.finalAt], [68, 40, T + 5 * H]);
});

test('deadline words: a card line and call-outs that say "your limit" and never state a rule', () => {
  let s = kitchen({ fridgeDays: 1, outHours: 2 });
  const id = batch(s).id;
  assert.match(D.coldLine(batch(s), T), /^In the fridge - made .* - your fridge limit 1 day, last day /);
  s = ok(act(s, 'coldTakeOut', { batchId: id }, T + 10 * MIN));
  const at = T + 10 * MIN + 100 * MIN;                                       // 100 minutes out of a 2 hour limit: 20 minutes left
  const line = D.coldLine(batch(s), at);
  assert.match(line, /^Out of the fridge since /); assert.match(line, /left of your 2-hour limit/);
  const rows = D.build(E.tick(s, at).state, at).filter((r) => r.batchId === id);
  const out = rows.find((r) => r.kind === 'coldOut');
  assert.ok(out && out.sev === 'warn', JSON.stringify(rows));
  assert.match(out.consequence, /your 2-hour limit/);
  // the fridge date row appears in the last six hours of the last day
  const eve = new Date(2026, 9, 23, 20, 0).getTime();
  const back = ok(act(s, 'coldReturn', { batchId: id }, T + 20 * MIN));
  const dateRow = D.build(E.tick(back, eve).state, eve).find((r) => r.kind === 'coldDate' && r.batchId === id);
  assert.ok(dateRow && /your fridge limit/.test(dateRow.consequence));
  for (const r of rows.concat(dateRow)) assert.doesNotMatch(r.consequence + r.action, /FDA|required|legal|the law|must be/i);
  // thrown out because of a limit: a row for 30 minutes
  const gone = E.tick(back, new Date(2026, 9, 24, 0, 5).getTime()).state;
  const er = D.build(gone, new Date(2026, 9, 24, 0, 10).getTime()).find((r) => r.kind === 'expired');
  assert.ok(er && /Past your limit/.test(er.consequence));
  // other batches keep their old rows: no cold row for a batch without the fields
  assert.ok(D.build(E.newState({ now: T, stagger: true }), T).every((r) => r.kind !== 'coldOut' && r.kind !== 'coldDate'));
});

test('old saves from earlier builds load with no cold fields and the same batch states they had', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'old-saves');
  let seen = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (typeof fx.backup !== 'string') continue;
    const v = E.validateBackup(fx.backup);
    assert.equal(v.ok, true, f);
    seen++;
    assert.ok(v.state.batches.every((b) => b.fridge === undefined && b.place === undefined && b.madeOn === undefined && b.lineMs === undefined), f);
    assert.ok(v.state.ingredients.every((i) => i.fridge === undefined && i.fridgeDays === undefined && i.outHours === undefined), f);
    const raw = JSON.parse(fx.backup).state;
    const rawBatches = (raw && raw.batches) || [];
    for (const b of v.state.batches) { const r = rawBatches.find((x) => x.id === b.id); if (r) assert.equal(b.status, r.status, f + ' ' + b.id); }
    const at = JSON.parse(fx.backup).savedAt || T;
    assert.deepEqual(E.checkInvariants(E.tick(v.state, at).state, at).filter((x) => /I20/.test(x)), [], f);
  }
  assert.ok(seen >= 4);
});

test('the result of a move tells the truth: discarded is false normally, and a batch already thrown out is refused by name', () => {
  let s = kitchen({ outHours: 1 });
  const id = batch(s).id;
  const r = act(s, 'coldTakeOut', { batchId: id }, T + MIN);
  assert.equal(r.info.discarded, false); assert.equal(r.info.words, undefined);
  s = r.state;
  // an hour later the hours are used up: the catch-up throws it out first, so the move is refused with the specific code, never a plain ok
  const late = act(s, 'coldReturn', { batchId: id }, T + 3 * H);
  assert.equal(late.report, 'batchNotServable');
  assert.equal(batch(E.tick(s, T + 3 * H).state).discardReason, 'outTime');
});

test('safety log extras: equipment temperature, thermometer check, sanitizer strip details, a note on a discard, and the date mark reason', () => {
  let s = E.newState({ now: T, stagger: true });
  s = ok(act(s, 'logEquipmentTemp', { unit: 'cooler', f: 38, label: 'Walk-in', who: 'AB' }, T));
  let ev = s.events.at(-1);
  assert.deepEqual([ev.type, ev.unit, ev.f, ev.label, ev.who], ['equip_temp', 'cooler', 38, 'Walk-in', 'AB']);
  assert.equal(act(s, 'logEquipmentTemp', { unit: 'sky', f: 38 }, T).report, 'badPatch');
  assert.equal(act(s, 'logEquipmentTemp', { unit: 'freezer', f: 999 }, T).report, 'outOfBounds');
  assert.equal(act(s, 'logEquipmentTemp', { unit: 'freezer', f: 0, label: 'x'.repeat(40) }, T).report, 'outOfBounds');
  s = ok(act(s, 'logThermometerCheck', { f: 32, method: 'ice' }, T + MIN));
  ev = s.events.at(-1); assert.deepEqual([ev.type, ev.f, ev.method], ['thermometer_checked', 32, 'ice']);
  assert.equal(act(s, 'logThermometerCheck', { f: 32, method: 'moon' }, T).report, 'badPatch');
  assert.equal(act(s, 'logThermometerCheck', { f: 'cold' }, T).report, 'outOfBounds');
  s = ok(act(s, 'sanitizeDone', { who: 'AB', ppm: 200, product: 'Quat', where: 'Prep table' }, T + 2 * MIN));
  ev = s.events.at(-1); assert.deepEqual([ev.type, ev.ppm, ev.product, ev.where], ['sanitize_done', 200, 'Quat', 'Prep table']);
  assert.equal(act(s, 'sanitizeDone', { ppm: -1 }, T + 3 * MIN).report, 'outOfBounds');
  const plain = ok(act(s, 'sanitizeDone', {}, T + 3 * MIN)); ev = plain.events.at(-1);
  assert.equal(ev.ppm, undefined); assert.equal(ev.product, undefined);                       // nothing extra when not given
  const hot = s.batches.find((b) => b.remainingG > 0);
  s = ok(act(s, 'discardBatch', { batchId: hot.id, reason: 'other', note: '  dropped on the floor ', who: 'AB' }, T + 4 * MIN));
  assert.equal(s.events.filter((e) => e.type === 'batch_discard').at(-1).note, 'dropped on the floor');
  const other = s.batches.find((b) => b.remainingG > 0);
  s = ok(act(s, 'discardBatch', { batchId: other.id, reason: 'datemark' }, T + 5 * MIN));
  assert.equal(s.batches.find((b) => b.id === other.id).discardReason, 'datemark');
  assert.equal(act(s, 'discardBatch', { batchId: s.batches.find((b) => b.remainingG > 0).id, reason: 'other', note: 'x'.repeat(2000) }, T + 6 * MIN).report, 'noteTooLong');
  // they are safety entries, so they are kept with the rest and can be corrected
  const log = E.safetyLog(s).map((x) => x.event.type);
  assert.ok(['equip_temp', 'thermometer_checked', 'sanitize_done', 'batch_discard'].every((t) => log.includes(t)));
  s = ok(act(s, 'correctSafety', { eventId: s.events.find((e) => e.type === 'equip_temp').id, note: 'wrong unit', who: 'AB' }, T + 7 * MIN));
});

test('an above-cold fridge batch cannot be taken out, and an old save with one on the line still cannot serve', () => {
  let s = kitchen({ fridgeDays: 3, outHours: 4 });
  const id = batch(s).id;
  s = ok(act(s, 'logTemp', { batchId: id, tempF: 50 }, T + 10 * MIN));
  assert.equal(batch(s).canServe, false);
  assert.equal(act(s, 'coldTakeOut', { batchId: id }, T + 11 * MIN).report, 'needsChill');
  // a batch that reached the line with the flag still set (an older build) is held until a cold reading
  const forced = JSON.parse(JSON.stringify(s));
  Object.assign(batch(forced), { place: 'line', lineSince: T + 11 * MIN });
  const g = E.gate(batch(forced), T + 12 * MIN, forced.settings.safety);
  assert.equal(g.canServe, false); assert.equal(g.action, 'CHILL_NOW');
  // an earlier above-cold stretch shortens the grace, and the stored deadline agrees with the gate
  s = ok(act(s, 'logTemp', { batchId: id, tempF: 38 }, T + 70 * MIN));
  s = ok(act(s, 'logTemp', { batchId: id, tempF: 50 }, T + 80 * MIN));
  const lim = batch(s).outSince + s.settings.safety.aboveColdGraceH * H - batch(s).coldOutMs;
  assert.equal(E.gate(batch(s), lim + MIN, s.settings.safety).action, 'DISCARD_LOCKOUT');
  assert.equal(batch(E.tick(s, lim + MIN).state).status, 'discard');
});

test('reset live data keeps the food safety record; loading the demo sample starts it clean', () => {
  let s = kitchen({ fridgeDays: 3 });
  s = ok(act(s, 'logTemp', { batchId: batch(s).id, tempF: 38 }, T + 10 * MIN));
  const logged = (x) => x.safetyKeep.concat(E.allEvents(x)).filter((e) => e.type === 'temp_logged').length;
  assert.ok(logged(s) >= 1);
  const r = ok(act(s, 'resetLive', { starter: false }, T + H));
  assert.equal(r.tickets.length, 0); assert.equal(r.batches.length, 0);
  assert.equal(logged(r), logged(s));
  assert.deepEqual(E.checkInvariants(r, T + H), []);
  // a second reset does not copy the record twice
  assert.equal(logged(ok(act(r, 'resetLive', { starter: false }, T + 2 * H))), logged(s));
  assert.equal(logged(ok(act(s, 'resetLive', { catalog: 'sample', replaceOwn: true }, T + H))), 0);
});
