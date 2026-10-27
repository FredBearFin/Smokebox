// The compact saved form (fmt 2): lossless on random kitchens and on old saves, old plain saves load and are upgraded on the next save, damaged
// compact saves never crash and fall back to the last good copy, exports stay readable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSB, ROOT } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store']);
const { store: S, engine: E, util: U } = SB;
const NOW = Date.UTC(2026, 9, 17, 20);
// A small seeded random generator so a failing kitchen can be rebuilt.
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
// JSON text of a value (key order is part of what must survive, so the plain JSON text is the comparison).
const text = (x) => JSON.stringify(x);
// Fails with a short note on where two values first differ, never with the whole kitchen.
function same(a, b, what) {
  const x = text(a), y = text(b);
  if (x === y) return;
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  assert.fail(what + ': first difference at ' + i + ': ' + x.slice(Math.max(0, i - 60), i + 60) + '  VS  ' + y.slice(Math.max(0, i - 60), i + 60));
}
// A memory storage like the browser's.
function mem(entries) {
  const m = new Map(Object.entries(entries || {}));
  return { m, persistent: true, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), raw: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, JSON.stringify(v)); return true; }, remove: (k) => { m.delete(k); }, keys: (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)) };
}

// A random kitchen made with the real engine: dishes with odd names, notes with emoji and the marker character, modifiers, voids, discounts,
// closed days, cook-ahead batches and safety readings.
function kitchen(seed) {
  const r = rng(seed);
  let t = new Date(2026, 8, 1 + (seed % 20), 12).getTime();
  let s = E.newState({ now: t, blank: true });
  const go = (type, p) => { t += 1000 + Math.floor(r() * 30000); const x = E.apply(s, type, p, t); if (x.report === 'ok') s = x.state; return x; };
  go('updateSettings', { patch: { modules: { cookAhead: r() < 0.5 }, service: { taxRatePct: r() < 0.5 ? 8.25 : 0 } } });
  const names = ['Pulled pork', 'Mac & cheese \u{1F9C0}', 'Slaw "fresh"', '\u0001odd', 'Café é', 'Tea, sweet', 'Wings'];
  const dishes = [];
  for (let i = 0; i < 4 + Math.floor(r() * 8); i++) { const x = go('addMenuItem', { name: names[i % names.length] + (i >= names.length ? ' ' + i : ''), zone: ['pit', 'fry', 'cold'][i % 3], cat: 'meat', price: 4 + i + (r() < 0.3 ? 0.5 : 0), prepSec: 60, track: i % 2 ? 'one' : 'two', prepGuess: false }); if (x.report === 'ok') dishes.push(x.info.id); }
  let ing = null;
  if (s.settings.modules && s.settings.modules.cookAhead) { const x = go('addIngredient', { name: 'Brisket', tcs: true, hold: 'hot', maxHoldH: 8, costPerKg: 12, parG: 8000, pullG: 1500, thresholdG: 700 }); if (x.report === 'ok') ing = x.info.id; }
  const days = 2 + Math.floor(r() * 4);
  for (let d = 0; d < days; d++) {
    if (ing) { const b = go('addBatch', { ing, tempF: 165, cookedG: 6000 }); if (b.report === 'ok') { go('logTemp', { batchId: b.info.batchId, tempF: 150 + Math.floor(r() * 10), who: 'Aé' }); go('pullBatch', { ing, g: 800 }); if (r() < 0.4) go('discardBatch', { batchId: b.info.batchId, reason: 'quality' }); } }
    const n = 3 + Math.floor(r() * 15);
    for (let i = 0; i < n; i++) {
      const items = [{ menuId: dishes[Math.floor(r() * dishes.length)], qty: 1 + Math.floor(r() * 2), mods: r() < 0.3 ? ['no onion', 'extra \u{1F336}️'] : undefined }];
      if (r() < 0.4) items.push({ menuId: dishes[Math.floor(r() * dishes.length)] });
      const c = go('createTicket', { customer: r() < 0.2 ? 'Zoë \u{1F600}' : 'Guest ' + Math.floor(r() * 50), channel: ['dine_in', 'takeout'][i % 2], items, note: r() < 0.3 ? 'allergy: nuts \u0001 "quoted"' : '', rush: r() < 0.1 });
      if (c.report !== 'ok') continue;
      const tk = s.tickets[s.tickets.length - 1];
      if (r() < 0.1) { go('voidTicket', { ticketId: tk.id, reason: 'oops' }); go('voidOrder', { orderId: c.info.orderId, reason: 'oops' }); continue; }
      for (const it of tk.items) { go('advanceItem', { ticketId: tk.id, itemId: it.id }); go('advanceItem', { ticketId: tk.id, itemId: it.id }); }
      go('bumpTicket', { ticketId: tk.id });
      go('payOrder', { orderId: c.info.orderId, method: ['cash', 'card', 'other'][i % 3], tip: r() < 0.5 ? 1.5 : 0, discount: r() < 0.1 ? 0.5 : 0 });
    }
    go('sanitizeDone', { who: 'JM', ppm: 200 });
    t += 3600e3; go('closeDay', {});
    t += 8 * 3600e3;
  }
  return { s: E.tick(s, t).state, t };
}

test('the packer is lossless on 50 random kitchens, including key order, and a repack from its memory gives the same bytes', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { s } = kitchen(seed);
    const pk = U.makePacker();
    const packed = pk.pack(s);
    const wire = JSON.parse(JSON.stringify(packed));
    const back = U.makePacker().unpack(wire);
    same(back, s, 'seed ' + seed);
    same(pk.pack(s), packed, 'the cached repack is identical, seed ' + seed);
    // changing one ticket leaves everything else as it was
    const s2 = Object.assign({}, s, { tickets: s.tickets.map((x, i) => (i === 0 ? Object.assign({}, x, { note: 'changed \u0001' }) : x)) });
    same(U.makePacker().unpack(JSON.parse(JSON.stringify(pk.pack(s2)))), s2, 'changed ticket');
  }
});

test('packText gives exactly the text of the packed tree, on 50 random kitchens, first and from its memory, and after a change', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { s } = kitchen(seed);
    const a = U.makePacker(), b = U.makePacker();
    const want = JSON.stringify(a.pack(s));
    assert.equal(b.packText(s), want, 'seed ' + seed);
    assert.equal(b.packText(s), want, 'again from memory, seed ' + seed);
    const s2 = Object.assign({}, s, { tickets: s.tickets.map((x, i) => (i === 1 ? Object.assign({}, x, { note: 'changed' }) : x)) });
    assert.equal(b.packText(s2), JSON.stringify(a.pack(s2)), 'after a change, seed ' + seed);
    assert.equal(text(U.makePacker().unpack(JSON.parse(b.packText(s2)))), text(s2));
  }
});

test('the packer keeps odd data exactly: the marker character, empty objects and arrays, nested arrays, __proto__ keys, long and unicode strings', () => {
  const odd = JSON.parse('{"a":"\\u0001x","b":"\\u0001\\u0001","c":{},"d":[],"e":[[],[1,[2,[]]],{"__proto__":{"z":1}}],"status":"\\u0001","name":"' + 'n'.repeat(80) + '","type":"caf\\u00e9 \\ud83d\\ude00","n":-0.5,"big":1792497632000,"z":null,"t":true}');
  const pk = U.makePacker();
  const back = U.makePacker().unpack(JSON.parse(JSON.stringify(pk.pack(odd))));
  same(back, odd, 'odd data');
  assert.equal(Object.getPrototypeOf(back.e[2]), Object.prototype, 'a __proto__ key is data, not a prototype');
  assert.ok(Object.prototype.hasOwnProperty.call(back.e[2], '__proto__'));
});

test('the compact save is about half the size and the store reloads exactly the same kitchen', () => {
  for (const seed of [3, 11, 29]) {
    const { s, t } = kitchen(seed);
    const readable = mem(), compact = mem();
    for (const [b, mode] of [[readable, 'never'], [compact, 'always']]) {
      S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => t, compact: mode });
      S.getState();
      const rep = S.importAll(JSON.stringify({ v: 1, state: s }));
      assert.equal(rep, 'ok');
      S.flush(); S.destroy();
    }
    assert.equal(JSON.parse(compact.m.get('smokebox.v1.state')).fmt, 2);
    assert.equal(JSON.parse(readable.m.get('smokebox.v1.state')).fmt, undefined);
    assert.ok(compact.m.get('smokebox.v1.state').length < readable.m.get('smokebox.v1.state').length * 0.7, 'seed ' + seed);
    const load = (b) => { S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => t, compact: 'auto' }); const st = S.status(), x = JSON.parse(JSON.stringify(S.getState())); S.destroy(); return { st, x }; };
    const a = load(readable), c = load(compact);
    assert.equal(c.st.corrupt, null); assert.deepEqual(c.st.repaired, a.st.repaired);
    delete a.x.rev; delete c.x.rev;
    same(c.x, a.x, 'seed ' + seed);
  }
});

test('old plain saves load unchanged, and the next save upgrades them; exports stay the readable current format', () => {
  const dir = path.join(ROOT, 'test/fixtures/old-saves');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const b = mem(fx.storage);
    S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => NOW, compact: 'never' });
    const before = JSON.parse(JSON.stringify(S.getState())); S.destroy();
    const b2 = mem(fx.storage);
    S.init({ storage: b2, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => NOW, compact: 'always' });
    const st = S.status();
    assert.equal(text(Object.assign(JSON.parse(JSON.stringify(S.getState())), { rev: 0 })), text(Object.assign(before, { rev: 0 })), f + ': same kitchen under either setting');
    S.dispatch('uiReport', { action: 'x', report: 'y' }); S.flush();
    assert.equal(JSON.parse(b2.m.get('smokebox.v1.state')).fmt, 2, f + ': upgraded on the next save');
    const exp = JSON.parse(S.exportAll());
    assert.ok(exp.state && exp.fmt === undefined && exp.p === undefined, 'the export is readable');
    assert.equal(st.corrupt, null);
    S.destroy();
  }
});

test('damaged compact saves never crash: the last good copy comes back, or a blank kitchen, and the damaged text is kept', () => {
  const r = rng(99);
  const { s, t } = kitchen(5);
  const src = mem();
  S.init({ storage: src, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => t, compact: 'always' });
  S.importAll(JSON.stringify({ v: 1, state: s })); S.dispatch('sanitizeDone', { who: 'JM' }); S.flush();
  const good = src.m.get('smokebox.v1.state'), lastgood = src.m.get('smokebox.v1.lastgood');
  S.destroy();
  assert.ok(lastgood, 'a last good copy exists');
  const mutants = [];
  mutants.push(good.slice(0, Math.floor(good.length / 2)), good.slice(0, 40), '{"v":1,"fmt":2}', '{"v":1,"fmt":2,"p":{"d":[],"s":[],"x":5}}', '{"v":1,"fmt":3,"p":{}}', good.replace('"s":[[', '"s":[[1,'));
  for (let i = 0; i < 40; i++) {
    const a = good.split(''); const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) a[Math.floor(r() * a.length)] = String.fromCharCode(32 + Math.floor(r() * 90));
    mutants.push(a.join(''));
  }
  for (let i = 0; i < 25; i++) {      // structural damage that stays valid JSON
    const o = JSON.parse(good);
    const pick = Math.floor(r() * 4);
    if (pick === 0) o.p.x[1 + Math.floor(r() * 5)] = 'zz';
    else if (pick === 1) o.p.s.pop();
    else if (pick === 2) o.p.d = o.p.d.slice(0, 2);
    else o.p.x = o.p.x.slice(0, 3 + Math.floor(r() * 8));
    mutants.push(JSON.stringify(o));
  }
  let fellBack = 0;
  for (const m of mutants) {
    const b = mem({ 'smokebox.v1.state': m, 'smokebox.v1.lastgood': lastgood });
    let st;
    assert.doesNotThrow(() => { st = S.init({ storage: b, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => t }); });
    assert.ok(S.getState() && Array.isArray(S.getState().tickets));
    assert.deepEqual(E.checkInvariants(S.getState(), t), []);
    if (st.corrupt) { fellBack++; assert.ok(b.m.has('smokebox.v1.corrupt'), 'the damaged text is kept'); assert.ok(st.restoredFromCopy, 'the last good copy was used'); }
    S.destroy();
  }
  assert.ok(fellBack >= mutants.length * 0.5, 'most damage is noticed: ' + fellBack + ' of ' + mutants.length);
});
