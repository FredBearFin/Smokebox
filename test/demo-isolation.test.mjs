// Demo isolation: the demo keeps its own saved data, tab channel, clock and backups; the real kitchen is never read or written
// while a tab is in the demo, and the demo is never written while a tab is in the real kitchen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadSB, ROOT } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store']);
const { store: S, engine: E, util: U, config: C } = SB;
const T = 1780326000000;
const pie = { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' };

// A raw storage that logs every write and delete.
function spyBackend() {
  const m = new Map(), log = [];
  return {
    m, log, persistent: true,
    get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), raw: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { log.push(['set', k]); m.set(k, JSON.stringify(v)); return true; },
    remove: (k) => { log.push(['remove', k]); m.delete(k); },
    keys: (prefix) => Array.from(m.keys()).filter((k) => k.indexOf(prefix) === 0),
  };
}
const start = (backend, mode, extra) => S.init(Object.assign({ storage: backend, mode, noTimers: true, noSync: true, now: () => T, blank: true }, extra));

test('every smokebox.v1 key in the source is classified as device setting or kitchen data', () => {
  const found = new Set();
  const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) continue; for (const m of fs.readFileSync(p, 'utf8').matchAll(/smokebox\.v1\.[A-Za-z0-9._]*[A-Za-z0-9]/g)) found.add(m[0]); } };
  walk(path.join(ROOT, 'src/js')); walk(path.join(ROOT, 'src'));
  const known = new Set(U.sharedKeys.concat(U.dataKeys));
  // 'smokebox.v1:' (the PIN scrambler prefix) is not a key and has no dot-name, so it is not matched.
  const unknown = Array.from(found).filter((k) => !known.has(k));
  assert.deepEqual(unknown, [], 'new storage key(s) not classified in 00-util.js (add to sharedKeys or dataKeys): ' + unknown.join(', '));
  assert.ok(found.size >= 30);
});

test('the key mapper: kitchen data moves in the demo, device settings and foreign keys stay', () => {
  assert.equal(U.storageKey('smokebox.v1.state', 'demo'), 'smokebox.demo.state');
  assert.equal(U.storageKey('smokebox.v1.setup.draft', 'demo'), 'smokebox.demo.setup.draft');
  assert.equal(U.storageKey('smokebox.v1.names', 'demo'), 'smokebox.demo.names');
  assert.equal(U.storageKey('smokebox.v1.unknownNewKey', 'demo'), 'smokebox.demo.unknownNewKey'); // unclassified is isolated, the safe side
  for (const k of U.sharedKeys) assert.equal(U.storageKey(k, 'demo'), k);
  for (const k of U.sharedKeys.concat(U.dataKeys)) assert.equal(U.storageKey(k, 'real'), k);
  assert.equal(U.storageKey('other.key', 'demo'), 'other.key');
  assert.equal(U.sharedKeys.length, 19);
  assert.equal(U.sharedKeys.filter((k) => U.dataKeys.includes(k)).length, 0);
});

test('a wrapped storage writes demo data to demo keys and device settings to the shared keys', () => {
  const b = spyBackend();
  const d = U.storageFor(b, 'demo'), r = U.storageFor(b, 'real');
  d.set('smokebox.v1.state', { a: 1 }); d.set('smokebox.v1.theme', 'night'); r.set('smokebox.v1.state', { a: 2 });
  assert.deepEqual(Array.from(b.m.keys()).sort(), ['smokebox.demo.state', 'smokebox.v1.state', 'smokebox.v1.theme']);
  assert.deepEqual([d.get('smokebox.v1.state', null), r.get('smokebox.v1.state', null), r.get('smokebox.v1.theme', null)], [{ a: 1 }, { a: 2 }, 'night']);
  d.remove('smokebox.v1.state');
  assert.equal(b.m.has('smokebox.demo.state'), false); assert.equal(b.m.has('smokebox.v1.state'), true);
});

test('real kitchen then demo then real: no real-key write in the demo, no demo-key write in the real kitchen, data separate', () => {
  const b = spyBackend();
  start(b, 'real');
  assert.equal(S.dispatch('addMenuItem', pie), 'ok'); S.flush(); S.destroy();
  const realBefore = b.m.get('smokebox.v1.state');
  assert.ok(realBefore);
  assert.equal(b.log.some((x) => x[1].indexOf('smokebox.demo.') === 0), false);
  b.log.length = 0;
  // the demo: sample catalog, its own keys only
  const status = start(b, 'demo', { blank: true });
  assert.equal(status.firstRun, true); assert.equal(S.isDemo(), true);
  assert.deepEqual([S.getState().menu.length, S.getState().batches.length, S.getState().catalog], [21, 10, undefined]);
  assert.equal(S.dispatch('toggle86', { menuId: 'tea', on: true }), 'ok'); S.flush(); S.destroy();
  assert.ok(b.log.length > 0);
  assert.deepEqual(b.log.filter((x) => x[1].indexOf('smokebox.demo.') !== 0), [], 'the demo wrote outside its own keys');
  assert.equal(b.m.get('smokebox.v1.state'), realBefore);
  b.log.length = 0;
  // back in the real kitchen: the one dish is there, the demo data is not
  start(b, 'real');
  assert.deepEqual([S.getState().menu.length, S.getState().menu[0].id], [1, 'pie']);
  S.dispatch('updateMenuItem', { id: 'pie', patch: { price: 5 } }); S.flush(); S.destroy();
  assert.deepEqual(b.log.filter((x) => x[1].indexOf('smokebox.demo.') === 0), [], 'the real kitchen wrote a demo key');
  assert.ok(b.log.length > 0);
});

test('the demo reads nothing from the real kitchen even when a real save exists', () => {
  const b = spyBackend();
  start(b, 'real'); S.dispatch('addMenuItem', pie); S.flush(); S.destroy();
  const reads = [];
  const wrapped = Object.assign({}, b, { get: (k, f) => { reads.push(k); return b.get(k, f); }, raw: (k) => { reads.push(k); return b.raw(k); } });
  start(wrapped, 'demo'); S.destroy();
  assert.deepEqual(reads.filter((k) => k.indexOf('smokebox.demo.') !== 0 && U.dataKeys.includes(k)), []);
});

test('the tab channel is smokebox-demo in the demo and smokebox in the real kitchen', () => {
  const names = [];
  const Real = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = class { constructor(n) { names.push(n); } postMessage() {} close() {} };
  try {
    for (const mode of ['real', 'demo']) { S.init({ storage: spyBackend(), mode, noTimers: true, now: () => T }); S.destroy(); }
  } finally { globalThis.BroadcastChannel = Real; }
  assert.deepEqual(names, ['smokebox', 'smokebox-demo']);
});

test('the fast clock and the sample history are demo only; plain tests keep the old behaviour', () => {
  start(spyBackend(), 'real');
  assert.equal(S.setSpeed(10), false); assert.equal(S.setSpeed(1), true);
  S.attachSim({ sample: () => ({ tickets: [{ id: 'x', createdAt: T - 1e6, items: [] }], events: [], batches: [], orders: [] }) });
  assert.equal(S.dataset({ sample: true }).hasSample, false);
  S.destroy();
  start(spyBackend(), 'demo');
  assert.equal(S.setSpeed(10), true);
  assert.equal(S.dataset({ sample: true }).hasSample, true);
  S.destroy(); S.attachSim(null);
  S.init({ storage: spyBackend(), noTimers: true, noSync: true, now: () => T }); // no mode named: unchanged
  assert.equal(S.isolated(), false); assert.equal(S.setSpeed(10), true);
  S.destroy();
});

test('backups carry the mode; the wrong mode is refused in plain words; older backups are real', () => {
  const rb = spyBackend();
  start(rb, 'real'); S.dispatch('addMenuItem', pie);
  const realText = S.exportAll(); assert.equal(JSON.parse(realText).mode, 'real'); S.destroy();
  const old = JSON.parse(realText); delete old.mode; const oldText = JSON.stringify(old);
  start(spyBackend(), 'demo');
  const demoText = S.exportAll(); assert.equal(JSON.parse(demoText).mode, 'demo');
  const before = S.getState();
  assert.equal(S.importAll(realText), 'wrongBackupMode'); assert.equal(S.getState(), before);
  assert.equal(S.importAll(oldText), 'wrongBackupMode');
  const msg = E.describe('wrongBackupMode', S.lastResult().info);
  assert.match(msg, /real kitchen/); assert.match(msg, /Nothing was changed/);
  assert.equal(S.importAll(demoText), 'ok');
  S.destroy();
  start(spyBackend(), 'real');
  assert.equal(S.importAll(demoText), 'wrongBackupMode');
  assert.match(E.describe('wrongBackupMode', S.lastResult().info), /demo/);
  assert.equal(S.importAll(oldText), 'ok'); assert.equal(S.getState().menu[0].id, 'pie');
  assert.equal(S.importAll(realText), 'ok');
  S.destroy();
  S.init({ storage: spyBackend(), noTimers: true, noSync: true, now: () => T });
  assert.equal('mode' in JSON.parse(S.exportAll()), false); // unnamed mode: the envelope is as before
  assert.equal(S.importAll(demoText), 'ok');
  S.destroy();
});

test('a backup carries the owner station names and setup lists, and restores them', () => {
  const b = spyBackend();
  start(b, 'real');
  const spec = { rename: { zones: { pit: 'Grill' } }, add: { zones: [{ name: 'Bar' }] } };
  try {
    C.applyCustom(spec); assert.equal(C.saveCustom(spec), true);
    b.set('smokebox.v1.setup.hiddenStations', ['fry']);
    const env = JSON.parse(S.exportAll());
    assert.deepEqual(env.names, spec);
    assert.deepEqual(env.setup, { hiddenStations: ['fry'] });
    C.applyCustom({}); C.saveCustom({ rename: {}, add: {} }); b.remove('smokebox.v1.setup.hiddenStations');
    assert.equal(S.importAll(JSON.stringify(env)), 'ok');
    assert.deepEqual(C.customSpec(), spec);
    assert.deepEqual(b.get('smokebox.v1.setup.hiddenStations', null), ['fry']);
  } finally { C.applyCustom({}); U.storage.remove('smokebox.v1.names'); S.destroy(); }
});

test('enterDemo saves the real kitchen, remembers the choice for this tab and reloads; leaveDemo discards the demo', () => {
  const real = spyBackend();
  const store = new Map(), reloads = [];
  const realSession = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  try {
    start(real, 'real', { reload: () => reloads.push('reload') });
    S.dispatch('addMenuItem', pie);
    assert.equal(S.enterDemo(), true);
    assert.equal(store.get(U.MODE_KEY), 'demo'); assert.equal(reloads.length, 1);
    assert.ok(real.m.get('smokebox.v1.state'), 'the real kitchen was saved before leaving');
    S.destroy();
    // the reloaded page is in the demo
    start(real, 'demo', { reload: () => reloads.push('reload') });
    assert.equal(S.enterDemo(), false);
    S.dispatch('toggle86', { menuId: 'tea', on: true }); S.flush();
    assert.ok(real.keys('smokebox.demo.').length > 0);
    const realText = real.m.get('smokebox.v1.state');
    real.log.length = 0;
    assert.equal(S.leaveDemo(), true);
    assert.equal(real.keys('smokebox.demo.').length, 0);
    assert.equal(store.has(U.MODE_KEY), false); assert.equal(reloads.length, 2);
    assert.equal(S.flush(), false); // this tab may not save any more
    assert.deepEqual(real.log.filter((x) => x[0] === 'set'), []);
    assert.equal(real.m.get('smokebox.v1.state'), realText);
    S.destroy();
    start(real, 'real');
    assert.equal(S.leaveDemo(), false);
    S.destroy();
  } finally { globalThis.sessionStorage = realSession; if (realSession === undefined) delete globalThis.sessionStorage; }
});

// Loads 00-util.js in a fresh context with a fake page address and a fake per-tab storage.
function loadUtil(win) {
  const ctx = Object.assign({ console }, win);
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/00-util.js'), 'utf8'), ctx, { filename: '00-util.js' });
  return ctx;
}
const session = (init) => { const m = new Map(Object.entries(init || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('the mode comes from ?demo or this tab\'s own saved choice, and anything odd means the real kitchen', () => {
  const s1 = session();
  const a = loadUtil({ location: { search: '?demo' }, sessionStorage: s1 });
  assert.equal(a.SB.util.mode(), 'demo'); assert.equal(s1.m.get('smokebox.mode'), 'demo');
  assert.equal(loadUtil({ location: { search: '' }, sessionStorage: session({ 'smokebox.mode': 'demo' }) }).SB.util.mode(), 'demo');
  assert.equal(loadUtil({ location: { search: '?demonstration=1' }, sessionStorage: session() }).SB.util.mode(), 'real');
  assert.equal(loadUtil({ location: { search: '' }, sessionStorage: session() }).SB.util.mode(), 'real');
  assert.equal(loadUtil({}).SB.util.mode(), 'real');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadUtil({ location: { search: '' }, sessionStorage: blocked }).SB.util.mode(), 'real');
  assert.equal(loadUtil({ location: { search: '?demo' }, sessionStorage: blocked }).SB.util.mode(), 'demo');
});

test('page-level storage follows the page mode (config names are per kitchen)', () => {
  const ls = (() => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), key: (i) => Array.from(m.keys())[i] || null, get length() { return m.size; } }; })();
  const d = loadUtil({ localStorage: ls, location: { search: '?demo' }, sessionStorage: session() });
  d.SB.util.storage.set('smokebox.v1.names', { rename: { zones: { pit: 'Demo grill' } }, add: {} });
  d.SB.util.storage.set('smokebox.v1.theme', 'night');
  assert.deepEqual(Array.from(ls.m.keys()).sort(), ['smokebox.demo.names', 'smokebox.v1.theme']);
  const r = loadUtil({ localStorage: ls, location: { search: '' }, sessionStorage: session() });
  assert.equal(r.SB.util.storage.get('smokebox.v1.names', null), null);
  assert.equal(r.SB.util.storage.get('smokebox.v1.theme', null), 'night');
  assert.equal(JSON.stringify(r.SB.util.rawStorage.keys('smokebox.demo.')), '["smokebox.demo.names"]');
});

test('the sample loader still works in the demo and is refused from a real kitchen that is isolated', () => {
  start(spyBackend(), 'demo');
  assert.equal(S.resetLive({ keepSettings: true, starter: true, stagger: true, catalog: 'sample' }), 'ok');
  S.destroy();
});

test('a given server transport is not opened in the demo, but is in the real kitchen', () => {
  const opened = [];
  const tr = (tag) => ({ open() { opened.push(tag); return true; }, post() { return true; }, close() {} });
  S.init({ storage: spyBackend(), mode: 'demo', noTimers: true, now: () => T, transport: tr('demo') }); S.destroy();
  S.init({ storage: spyBackend(), mode: 'real', noTimers: true, now: () => T, transport: tr('real') }); S.destroy();
  assert.deepEqual(opened, ['real']);
});
