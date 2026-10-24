// Golden hashes: the barbecue starter states and the default settings must stay byte for byte what they were
// before the clean-start work. If one of these fails, the demo or every legacy save would change. (Updated once on purpose: the demo's
// short names on tickets became readable, Pork sandwich and Mac and cheese instead of Pork sand. and Mac.)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine']);
const E = SB.engine;
const T = 1780326000000;
const h = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

test('newState() default is unchanged', () => assert.equal(h(E.newState({ now: T })), 'cbb9cfe4134e13e4'));
test('newState starter+stagger (the demo) is unchanged', () => assert.equal(h(E.newState({ now: T, starter: true, stagger: true })), 'fd9985ec67d6d6f5'));
test('newState starter:false is unchanged', () => assert.equal(h(E.newState({ now: T, starter: false })), '651e3abf165bcc6e'));
test('newState empty:true is unchanged', () => assert.equal(h(E.newState({ now: T, empty: true })), '6cc8a516fbb591d0'));
test('defaultSettings() is unchanged', () => assert.equal(h(E.defaultSettings()), 'f13053e155e5c4dc'));
test('a barbecue demo state passes the backup check with no repairs', () => {
  const v = E.validateBackup(JSON.stringify(E.newState({ now: T, starter: true, stagger: true })));
  assert.equal(v.ok, true);
  assert.deepEqual(v.repaired, []);
});
