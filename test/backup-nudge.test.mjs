// Backup nudge tests: when the close-of-service backup reminder is due, snoozed, or already satisfied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '05-icons', '10-config', '60-shell']);
const due = SB.shell.backupDue;
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 9, 20 + dayOffset, h, m, 0).getTime();
const sv = { closeHour: 21 };

test('not due before closing', () => {
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(20, 59), hasData: true }), false);
});
test('due at closing with no backup yet', () => {
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(21, 1), hasData: true }), true);
});
test('quiet when a backup was made in the 2 hours before closing or since', () => {
  assert.equal(due({ service: sv, lastBackupAt: at(19, 30), now: at(21, 30), hasData: true }), false);
  assert.equal(due({ service: sv, lastBackupAt: at(21, 10), now: at(21, 30), hasData: true }), false);
  assert.equal(due({ service: sv, lastBackupAt: at(17, 0), now: at(21, 30), hasData: true }), true);
});
test('snooze, empty kitchen and the 10 hour window all stay quiet', () => {
  assert.equal(due({ service: sv, lastBackupAt: null, snoozeUntil: at(22, 0), now: at(21, 30), hasData: true }), false);
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(21, 30), hasData: false }), false);
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(31 - 24, 1, 1), hasData: true }), false);
});
test('a close after midnight still counts at 12:30 am', () => {
  assert.equal(due({ service: { closeHour: 25 }, lastBackupAt: null, now: at(1, 30, 1), hasData: true }), true);
  assert.equal(due({ service: { closeHour: 25 }, lastBackupAt: null, now: at(0, 30, 1), hasData: true }), false);
});
test('bad input is never due and never throws', () => {
  for (const a of [null, undefined, {}, { service: {} }, { service: { closeHour: 'x' }, hasData: true, now: 1 }]) assert.equal(due(a), false);
});
test('quiet while a ticket is on the board or an order is open', () => {
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(21, 30), hasData: true, openWork: 2 }), false);
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(21, 30), hasData: true, openWork: 0 }), true);
});
test('Close the day before closing time starts the nudge early', () => {
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(19, 30), hasData: true, openWork: 0, closedAt: at(19, 0) }), true);
  assert.equal(due({ service: sv, lastBackupAt: at(19, 10), now: at(19, 30), hasData: true, openWork: 0, closedAt: at(19, 0) }), false);
  assert.equal(due({ service: sv, lastBackupAt: null, now: at(19, 30), hasData: true, openWork: 0, closedAt: at(19, 0, -1) }), false);
});
