// Independent-review follow-up: a restore first keeps a copy of the kitchen it replaces (the 'before restore' copy), for 7 days.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store']);
const { store: S, engine: E } = SB;
const T0 = new Date(2026, 9, 20, 12, 0, 0).getTime(), H = 3600e3, DAY = 24 * H;

// A memory storage like the app's browser storage.
function memStorage() {
  const m = new Map();
  return {
    persistent: true, m,
    get(k, fb) { const raw = m.get(k); if (raw == null) return fb; try { return JSON.parse(raw); } catch (e) { return fb; } },
    set(k, v) { m.set(k, JSON.stringify(v)); return true; },
    remove(k) { m.delete(k); },
    keys(prefix) { return [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)); },
  };
}
const boot = (clock, storage) => S.init({ now: () => clock.real, storage, noTimers: true, noSync: true, starter: true, mode: 'real' });
const taxOf = () => S.getState().settings.service.taxRatePct;

test('restore #5: importAll keeps the current kitchen as a before-restore copy and says so', () => {
  const clock = { real: T0 }, storage = memStorage();
  boot(clock, storage);
  assert.ok(['ok', 'nothingToDo'].includes(S.dispatch('updateSettings', { patch: { service: { taxRatePct: 5 } } })));
  const backup = S.exportAll();
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 9 } } });
  clock.real += 1000;
  assert.equal(S.importAll(backup), 'ok');
  const info = S.lastResult().info;
  assert.equal(info.beforeRestore, true);
  assert.equal(info.beforeRestoreKeepDays, 7);
  assert.equal(taxOf(), 5);
  const copy = S.beforeRestoreInfo();
  assert.ok(copy && copy.expiresAt - copy.takenAt === 7 * DAY);
  const env = storage.get('smokebox.v1.lastgood', null);
  assert.equal(env.reason, 'before restore');
  assert.equal(E.validateBackup(env).state.settings.service.taxRatePct, 9);
  // undo: the replaced kitchen comes back
  assert.equal(S.undoRestore(), 'ok');
  assert.equal(taxOf(), 9);
  S.destroy();
});

test('restore #5: the 6-hour refresh leaves the before-restore copy alone for 7 days, then it may be replaced', () => {
  const clock = { real: T0 }, storage = memStorage();
  boot(clock, storage);
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 5 } } });
  const backup = S.exportAll();
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 9 } } });
  S.importAll(backup);
  clock.real += 8 * H; S.dispatch('updateSettings', { patch: { service: { taxRatePct: 6 } } }); S.flush();
  assert.equal(storage.get('smokebox.v1.lastgood', null).reason, 'before restore');
  clock.real += 8 * DAY; S.dispatch('updateSettings', { patch: { service: { taxRatePct: 7 } } }); S.flush();
  assert.notEqual(storage.get('smokebox.v1.lastgood', null).reason, 'before restore');
  assert.equal(S.beforeRestoreInfo(), null);
  assert.equal(S.undoRestore(), 'noCopy');
  S.destroy();
});

test('restore #5: a refused backup changes nothing and keeps no copy', () => {
  const clock = { real: T0 }, storage = memStorage();
  boot(clock, storage);
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 5 } } });
  assert.equal(S.importAll('{"nope":1}'), 'invalidBackup');
  assert.equal(S.beforeRestoreInfo(), null);
  assert.equal(taxOf(), 5);
  S.destroy();
});

test('restore undo (Nia 4): undoing a restore puts back the names and setup lists the restore overwrote', () => {
  const clock = { real: T0 }, storage = memStorage(), C = SB.config;
  boot(clock, storage);
  // The backup has a renamed station and one hidden station.
  C.saveCustom({ rename: { zones: { pit: 'Firebox' } }, add: {} }); C.applyCustom(C.customSpec());
  storage.set('smokebox.v1.setup.hiddenStations', ['fry']);
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 5 } } });
  const backup = S.exportAll();
  // The kitchen being replaced has no names and no hidden stations.
  C.saveCustom({ rename: {}, add: {} }); C.applyCustom(C.customSpec());
  storage.remove('smokebox.v1.setup.hiddenStations');
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 9 } } });
  clock.real += 1000;
  assert.equal(S.importAll(backup), 'ok');
  assert.equal(C.zoneById.pit.name, 'Firebox');
  assert.deepEqual(storage.get('smokebox.v1.setup.hiddenStations', null), ['fry']);
  assert.equal(S.beforeRestoreInfo().trimmed, false, 'a whole copy fit');
  assert.equal(S.undoRestore(), 'ok');
  assert.equal(taxOf(), 9);
  assert.notEqual(C.zoneById.pit.name, 'Firebox', 'the rename the restore brought is undone');
  assert.deepEqual(C.customSpec(), { rename: {}, add: {} });
  assert.deepEqual(storage.get('smokebox.v1.setup.hiddenStations', null), [], 'the hidden-station list the restore brought is undone');
  S.destroy();
});
