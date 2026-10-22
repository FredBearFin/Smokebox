import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '05-icons', '60-shell']);

test('far display is a saved ticket size choice', () => {
  SB.theme.setDensity('far');
  assert.equal(SB.theme.density(), 'far');
  SB.theme.setDensity('unknown');
  assert.equal(SB.theme.density(), 'far');
});
