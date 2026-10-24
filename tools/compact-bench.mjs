#!/usr/bin/env node
// WHAT THIS FILE IS: Measures the plain and the compact saved form on a busy kitchen (5,000 tickets): saved size, time of the first save, of a save
//    after one more tap, and of a start-up from the saved copy. Run: node tools/compact-bench.mjs [tickets]
// USES: test/_big-kitchen.mjs, src/js/*.js. USED BY: people.
import { buildBig } from '../test/_big-kitchen.mjs';
import { loadSB } from '../test/_load.mjs';

const tickets = Number(process.argv[2] || 5000);
const { SB, state, now } = await buildBig({ tickets, days: 30, uncap: true });
await loadSB(['30-store']);
const S = SB.store;
const mem = () => { const m = new Map(); return { m, persistent: true, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), raw: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, JSON.stringify(v)); return true; }, setText: (k, t) => { m.set(k, t); return true; }, remove: (k) => { m.delete(k); }, keys: () => [...m.keys()] }; };
const ms = (f) => { const t = performance.now(); const r = f(); return [performance.now() - t, r]; };
// The smallest of several runs: on a busy machine the fastest run is the one that was disturbed least.
const median = (a) => Math.min(...a);
console.log('kitchen: ' + state.tickets.length + ' tickets, ' + SB.engine.allEvents(state).length + ' events, ' + state.orders.length + ' orders');
const out = {};
for (const mode of ['never', 'always']) {
  const storage = mem();
  S.init({ storage, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => now, compact: mode, quotaBytes: 1e9 });
  S.importAll(JSON.stringify({ v: 1, state }));
  const first = ms(() => S.flush())[0];       // the first save works out the whole packed form (the packer remembers it afterwards)
  const warm = [];
  for (let i = 0; i < 15; i++) { S.dispatch('sanitizeDone', { who: 'JM' }); warm.push(ms(() => S.flush())[0]); }
  const bytes = storage.m.get('smokebox.v1.state').length;
  S.destroy();
  const boots = [];
  for (let i = 0; i < 9; i++) { boots.push(ms(() => S.init({ storage, mode: 'real', blank: true, noTimers: true, noSync: true, now: () => now, compact: mode, quotaBytes: 1e9 }))[0]); S.destroy(); }
  out[mode] = { bytes, first, warm: median(warm), boot: median(boots) };
  console.log(mode.padEnd(7), 'saved ' + bytes + ' chars | first save ' + first.toFixed(0) + ' ms | later save ' + median(warm).toFixed(0) + ' ms | start-up ' + median(boots).toFixed(0) + ' ms');
}
const r = (k) => (out.always[k] / out.never[k]);
console.log('compact vs plain: size ' + (100 * r('bytes')).toFixed(0) + '%, first save x' + r('first').toFixed(2) + ', later save x' + r('warm').toFixed(2) + ', start-up x' + r('boot').toFixed(2));
