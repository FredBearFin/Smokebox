// Units setting: F or C and kg or lb, stored in F and grams, formatted only at the edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store']);
const { util: U, engine: E, store: S } = SB;
const T0 = new Date(2026, 9, 17, 12, 0, 0).getTime();

test('defaults are F and kg and the helpers match the old formats', () => {
  U.setUnits({ tempUnit: 'F', weightUnit: 'kg' });
  assert.deepEqual(E.defaultSettings().ui.tempUnit + E.defaultSettings().ui.weightUnit, 'Fkg');
  assert.equal(U.tempText(135), '135 °F');
  assert.equal(U.weightText(850), U.fmtG(850));
  assert.equal(U.weightText(2400), '2.4 kg');
  assert.equal(U.tempText(NaN), '-');
  assert.equal(U.weightText(undefined), '-');
});

test('Celsius and pounds convert both ways without drifting the stored value', () => {
  U.setUnits({ tempUnit: 'C', weightUnit: 'lb' });
  assert.equal(U.tempText(135), '57 °C');
  assert.equal(U.tempText(41), '5 °C');
  U.setUnits({ tempUnit: 'F' });
  assert.equal(U.tempTextC(85), '185 °F');
  U.setUnits({ tempUnit: 'C' });
  assert.equal(U.tempTextC(85), '85 °C');
  assert.equal(U.tempStored(57.2), 135);
  assert.equal(U.tempShown(165), 74);
  assert.equal(U.weightText(453.59237), '1 lb');
  assert.equal(U.weightText(226.796185), '8 oz');
  assert.equal(U.weightText(2400), '5.29 lb');
  assert.equal(U.weightStored(U.weightShown(9000)), 9000);
  assert.equal(U.unitLabel('temp'), '°C');
  assert.equal(U.unitLabel('weight'), 'lb');
  U.setUnits({ tempUnit: 'X', weightUnit: 5 }); // junk keeps the old choice
  assert.deepEqual(U.units, { temp: 'C', weight: 'lb' });
  U.setUnits({ tempUnit: 'F', weightUnit: 'kg' });
});

test('the setting is validated, saved, restored for old saves, and drives the helpers through the store', () => {
  const storage = { persistent: true, m: new Map(), get(k, fb) { const r = this.m.get(k); return r == null ? fb : JSON.parse(r); }, set(k, v) { this.m.set(k, JSON.stringify(v)); return true; }, remove(k) { this.m.delete(k); } };
  S.init({ now: () => T0, storage, noTimers: true, noSync: true });
  assert.equal(S.dispatch('updateSettings', { patch: { ui: { tempUnit: 'Kelvin' } } }), 'badPatch');
  assert.equal(S.dispatch('updateSettings', { patch: { ui: { weightUnit: 'stone' } } }), 'badPatch');
  assert.equal(S.dispatch('updateSettings', { patch: { ui: { tempUnit: 'C', weightUnit: 'lb' } } }), 'ok');
  assert.equal(U.tempText(135), '57 °C');
  assert.equal(S.getState().settings.ui.weightUnit, 'lb');
  S.flush(); S.destroy();
  U.setUnits({ tempUnit: 'F', weightUnit: 'kg' });
  S.init({ now: () => T0, storage, noTimers: true, noSync: true });
  assert.equal(U.tempText(135), '57 °C'); // restored from the save
  S.destroy();
  // an old save with no units gets the defaults
  const old = JSON.parse(E.serialize(E.newState({ now: T0 })));
  delete old.settings.ui.tempUnit; delete old.settings.ui.weightUnit;
  const r = E.validateBackup(JSON.stringify(old));
  assert.equal(r.ok, true);
  assert.deepEqual([r.state.settings.ui.tempUnit, r.state.settings.ui.weightUnit], ['F', 'kg']);
  U.setUnits({ tempUnit: 'F', weightUnit: 'kg' });
});
