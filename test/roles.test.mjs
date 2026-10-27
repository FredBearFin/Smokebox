// Device roles on the board: which shortcut keys each role may use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '70-floor-board']);
const F = SB.floor;

test('all-in-one and manager devices keep every shortcut key', () => {
  for (const role of ['all', 'manager', undefined]) for (const k of F.shortcuts.flatMap((s) => s.keys)) assert.equal(F.roleAllows(role, k === 'Esc' ? 'Escape' : k), true, role + ' ' + k);
});

test('kitchen: board, cabinet, 86, recall, stations, undo and help only', () => {
  for (const k of ['r', 'h', '8', 'z', '?', '1', '6', 'Escape']) assert.equal(F.roleAllows('kitchen', k), true, k);
  for (const k of ['n', 'o', 'd']) assert.equal(F.roleAllows('kitchen', k), false, k);
});

test('front: everything except the cabinet key', () => {
  for (const k of ['n', 'o', 'r', '8', 'd', 'z', '?', '3', 'Escape']) assert.equal(F.roleAllows('front', k), true, k);
  assert.equal(F.roleAllows('front', 'h'), false);
});

test('bump-bar keys: Enter and the arrows work on kitchen and front devices', () => {
  for (const role of ['kitchen', 'front']) for (const k of ['Enter', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) assert.equal(F.roleAllows(role, k), true, role + ' ' + k);
  assert.equal(F.roleAllows('kitchen', 'Tab'), false);
});
