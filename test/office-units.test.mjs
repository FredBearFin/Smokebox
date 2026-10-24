// The units setting reaches the back office text: weights follow kg or lb, temperatures follow F or C.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '80-office-core', '86-office-glance']);
const U = SB.util;
const { runOutLine } = SB.office.glancePure;
const now = new Date(2026, 9, 16, 18, 0, 0).getTime();

test('the run-out line shows kilograms by default (no trailing zeros) and pounds when the owner chose pounds', () => {
  U.setUnits({ weightUnit: 'kg' });
  assert.match(runOutLine({ name: 'Brisket', onHandG: 14000, shortfallAt: null, rateKnown: false }, now).text, /14 kg on hand/);
  U.setUnits({ weightUnit: 'lb' });
  assert.match(runOutLine({ name: 'Brisket', onHandG: 14000, shortfallAt: null, rateKnown: false }, now).text, /30\.86 lb on hand/);
  U.setUnits({ weightUnit: 'kg' });
});

test('temperatures are stored in Fahrenheit and shown in the chosen unit', () => {
  U.setUnits({ tempUnit: 'F' });
  assert.equal(U.tempText(135), '135 °F');
  U.setUnits({ tempUnit: 'C' });
  assert.equal(U.tempText(135), '57 °C');
  assert.equal(U.tempShown(41), 5);
  U.setUnits({ tempUnit: 'F' });
});
