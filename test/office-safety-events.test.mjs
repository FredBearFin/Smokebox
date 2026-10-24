// The safety record shows the engine's REAL events: a changed safety limit (safety_setting_changed) as one plain line, and cold-food
// readings with the time above the cold limit that the engine adds up across stretches. Also the keep time is the engine's own number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '36-csv', '37-retention', '89-office-inspector']);
const E = SB.engine, IP = SB.office.inspectorPure;
const T0 = new Date(2026, 9, 20, 8, 0).getTime(), MIN = 60e3;

// Builds a kitchen with the cook-ahead module on and one cold batch; returns an applier that moves the clock.
function kitchen() {
  const k = { now: T0, s: E.newState({ now: T0, blank: true }) };
  k.go = (type, p, dtMin = 1) => { k.now += dtMin * MIN; const r = E.apply(k.s, type, p, k.now); assert.equal(r.report, 'ok', type + ' ' + r.report + JSON.stringify(r.info)); k.s = r.state; return r; };
  k.go('updateSettings', { patch: { modules: { cookAhead: true } } });
  return k;
}
const rows = (k) => IP.inspectorRows(k.s, T0 - 864e5, k.now + 864e5);

test('the engine exports its keep time and the words use it', () => {
  assert.equal(typeof E.SAFETY_KEEP_DAYS, 'number');
  assert.equal(SB.retention.days(), E.SAFETY_KEEP_DAYS);
  assert.ok(SB.retention.words().includes('about ' + E.SAFETY_KEEP_DAYS + ' days'));
});

test('a real change to a safety number shows as one plain line with the old and new value', () => {
  const k = kitchen();
  k.go('updateSettings', { patch: { safety: { coldHoldF: 39 } } });
  k.go('updateSettings', { patch: { safety: { tempCheckEveryMin: 60 } } });
  k.go('updateSettings', { patch: { service: { taxRatePct: 7 } } });
  const r = rows(k).filter((x) => x.kind === 'Changed a safety limit');
  assert.equal(r.length, 2, 'one entry per changed safety number, and none for tax');
  assert.ok(r.some((x) => x.detail === 'Changed the cold limit from 41 °F to 39 °F'), JSON.stringify(r.map((x) => x.detail)));
  assert.ok(r.some((x) => /^Changed how often temperatures are checked from \d+ min to 60 min$/.test(x.detail)), JSON.stringify(r.map((x) => x.detail)));
});

test('cold readings say when they are above the limit and that earlier time above it still counts', () => {
  const k = kitchen();
  const ing = k.go('addIngredient', { name: 'Slaw mix', unit: 'g', tcs: true, hold: 'cold', costPerKg: 5 }).info.id;
  const b = k.go('addBatch', { ing, tempF: 38, rawG: 2000, cookedG: 2000 }, 5).info;
  const id = b.id || b.batchId;
  k.go('logTemp', { batchId: id, tempF: 50, who: 'AB' }, 10);   // goes out of range
  k.go('logTemp', { batchId: id, tempF: 38, who: 'AB' }, 20);   // back in range after 20 min above
  k.go('logTemp', { batchId: id, tempF: 49, who: 'AB' }, 30);   // out again
  const temps = rows(k).filter((x) => x.kind === 'Temperature reading').sort((a, c) => a.at - c.at);
  assert.equal(temps.length, 3);
  assert.ok(/above the cold limit$/.test(temps[0].detail) && !/earlier/.test(temps[0].detail), temps[0].detail);
  assert.ok(/back in range; 20 min above the cold limit so far, which still counts/.test(temps[1].detail), temps[1].detail);
  assert.ok(/above the cold limit; 20 min above it earlier, which still counts/.test(temps[2].detail), temps[2].detail);
  // the engine agrees: the batch has used those 20 minutes
  assert.equal(Math.round(k.s.batches.find((x) => x.id === id).coldOutMs / MIN), 20);
});

test('cold reading notes read the event log once per record, not once per reading (Milo 9)', () => {
  const k = kitchen();
  const ing = k.go('addIngredient', { name: 'Slaw mix', unit: 'g', tcs: true, hold: 'cold', costPerKg: 5 }).info.id;
  const b = k.go('addBatch', { ing, tempF: 38, rawG: 2000, cookedG: 2000 }, 5).info;
  const id = b.id || b.batchId;
  for (let i = 0; i < 6; i++) k.go('logTemp', { batchId: id, tempF: i % 2 ? 38 : 50, who: 'AB' }, 10);
  const real = E.allEvents;
  let calls = 0;
  E.allEvents = (s) => { calls++; return real(s); };
  try { rows(k); } finally { E.allEvents = real; }
  assert.ok(calls <= 2, 'the log was read ' + calls + ' times for 6 cold readings');
});

test('the month-close entry has a plain label (hand-built entry: the engine event arrives with the Close the month work)', () => {
  const row = IP.rowFor({ id: 'e9', type: 'month_closed', t: T0, before: '2026-09-01', days: 31, tickets: 900 }, { settings: {}, batches: [], ingredients: [] });
  assert.equal(row.kind, 'History saved and cleared');
});
