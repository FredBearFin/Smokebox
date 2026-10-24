#!/usr/bin/env node
// WHAT THIS FILE IS: Measures what saving and starting cost in a real browser with a slowed CPU (Chromium, CDP throttling), on a kitchen with a
//    given amount of history, with a CPU profile of where the time goes. Run: node tools/savecost-browser.mjs [tickets=1470] [rates=1,6]
//    Prints: save time (flush after one change), time of the change itself, start-up time, and the top functions of each.
// USES: test/_big-kitchen.mjs, dist/smokebox.html, playwright. USED BY: people.
import { toolRequire } from './_deps.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBig } from '../test/_big-kitchen.mjs';

const { chromium } = toolRequire('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST || path.join(ROOT, 'dist/smokebox.html');
const N = Number(process.argv[2] || 1470), RATES = (process.argv[3] || '1,6').split(',').map(Number);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)] * 10) / 10 : null; };
const big = await buildBig({ tickets: N, days: 30 });
const backup = JSON.stringify({ v: 1, savedAt: big.now, rev: big.state.rev, clock: { virtual: big.now, real: big.now, speed: 1 }, state: big.state, mode: 'real' });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let saved = null;
{
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 } });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(DIST).href); await p.waitForFunction(() => window.SB && SB.booted === true);
  await p.evaluate((txt) => { SB.store.importAll(txt); SB.store.flush(); }, backup);
  saved = await p.evaluate(() => localStorage.getItem('smokebox.v1.state'));
  console.log('kitchen: ' + big.state.tickets.length + ' tickets; saved ' + (saved.length / 1e6).toFixed(2) + ' million characters (' + (JSON.parse(saved).fmt === 2 ? 'compact' : 'plain') + ')');
  await ctx.close();
}
// The functions that used the most time in a CPU profile, as text.
function top(profile, n) {
  const self = new Map(); const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const dt = profile.timeDeltas; let total = 0;
  for (let i = 0; i < profile.samples.length; i++) { const nd = nodes.get(profile.samples[i]); const k = nd.callFrame.functionName + ' ' + String(nd.callFrame.url).split('/').pop() + ':' + nd.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); total += dt[i] || 0; }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => '      ' + (v / 1000).toFixed(0).padStart(6) + ' ms  ' + k).join('\n') + '\n      total ' + (total / 1000).toFixed(0) + ' ms';
}
for (const rate of RATES) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await p.addInitScript((txt) => { try { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem('smokebox.v1.state', txt); } } catch (e) { /* too big */ } }, saved);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 300 }); await cdp.send('Profiler.start');
  const t0 = Date.now();
  await p.goto(pathToFileURL(DIST).href);
  await p.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 180000 });
  const bootMs = Date.now() - t0;
  const bootProf = (await cdp.send('Profiler.stop')).profile;
  await p.evaluate(() => SB.floor.setWelcome(false));
  // changes and saves
  const res = await p.evaluate(async () => {
    const out = { change: [], flush: [], tapDone: [] };
    const dish = SB.store.getState().menu.find((m) => !m.archived).id;
    for (let i = 0; i < 12; i++) {
      let t = performance.now(); SB.store.dispatch('sanitizeDone', { who: 'JM' }); out.change.push(performance.now() - t);
      t = performance.now(); SB.store.flush(); out.flush.push(performance.now() - t);
    }
    // a whole ticket: create, finish its dish, bump, pay: the last tap completes it
    for (let i = 0; i < 6; i++) {
      SB.store.dispatch('createTicket', { customer: 'Perf ' + i, items: [{ menuId: dish }] });
      const tk = SB.store.getState().tickets[SB.store.getState().tickets.length - 1];
      SB.store.dispatch('advanceItem', { ticketId: tk.id, itemId: tk.items[0].id }); SB.store.dispatch('advanceItem', { ticketId: tk.id, itemId: tk.items[0].id });
      let t = performance.now(); SB.store.dispatch('bumpTicket', { ticketId: tk.id }); out.tapDone.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 30));
    }
    return out;
  });
  await cdp.send('Profiler.start');
  await p.evaluate(() => { for (let i = 0; i < 12; i++) { SB.store.dispatch('sanitizeDone', { who: 'JM' }); SB.store.flush(); } });
  const saveProf = (await cdp.send('Profiler.stop')).profile;
  console.log('\nCPU x' + rate + ': start-up ' + bootMs + ' ms | one change ' + med(res.change) + ' ms | save (flush) ' + med(res.flush) + ' ms | Done/bump tap ' + med(res.tapDone) + ' ms');
  console.log('    start-up, top functions:\n' + top(bootProf, 8));
  console.log('    12 changes + saves, top functions:\n' + top(saveProf, 8));
  await ctx.close();
}
await browser.close();
