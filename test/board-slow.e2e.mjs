// Old, slow kitchen tablets, emulated (browser, about 6 minutes). Run: node test/board-slow.e2e.mjs   (SLOW_RATES=1,4,6 SLOW_N=60,200)
// Chromium with the CPU slowed 4x and 6x (CDP Emulation.setCPUThrottlingRate), an 800x1280 tablet screen, touch, voice on, a cabinet with 10
// batches, 60 and then 200 open tickets and a saved history of up to 5000 tickets (what the saved copy can hold). Measures: boot to the first
// painted board, tap to the next painted frame for Start, Done, Bump, New ticket (open and Send), Pay, a station tab, the Orders drawer, a burst
// of 12 tickets at once, and every long task (over 100 ms) in between. The budgets are generous and only WARN (this machine is shared and is
// not a tablet); the test fails only on page errors. These are emulated numbers, not a real tablet.
import { toolRequire } from '../tools/_deps.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBig } from './_big-kitchen.mjs';

const { chromium } = toolRequire('playwright');
const DIST = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist/smokebox.html');
const RATES = (process.env.SLOW_RATES || '1,4,6').split(',').map(Number);
const COUNTS = (process.env.SLOW_N || '60,200').split(',').map(Number);
const HISTORY = Number(process.env.SLOW_HISTORY || 5000);
const BUDGET = { tap: 400, boot: 6000, long: 400 }; // warn above these at 4x
let fail = 0, warn = 0;
// Records a page error as a failure.
function check(name, ok, detail) { if (!ok) fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + String(JSON.stringify(detail)).slice(0, 300))); }
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };
const INIT = "window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}"
  + " window.__said = []; window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (u) => window.__said.push(u.text), cancel() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {} } });";

// The saved history: built with the real engine, then loaded through the app and saved by the app, so what boots is what a tablet can keep.
console.log('building a kitchen with ' + HISTORY + ' tickets of history...');
const big = await buildBig({ tickets: HISTORY, days: 90 });
const backup = JSON.stringify({ v: 1, savedAt: big.now, rev: big.state.rev, clock: { virtual: big.now, real: big.now, speed: 1 }, state: big.state, mode: 'real' });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let saved = null, savedInfo = null;
{
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 } });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(DIST).href); await p.waitForFunction(() => window.SB && SB.booted === true);
  const t0 = Date.now();
  const r = await p.evaluate((txt) => { const t = performance.now(); const res = SB.store.importAll(txt); return { res, ms: Math.round(performance.now() - t) }; }, backup);
  console.log('  note  importAll of ' + (backup.length / 1e6).toFixed(1) + ' MB (JSON.parse + validateBackup + adopt): ' + r.ms + ' ms unthrottled (' + (Date.now() - t0) + ' ms wall incl. transfer), result ' + r.res);
  await p.evaluate(() => SB.store.flush());
  savedInfo = await p.evaluate(() => { const t = localStorage.getItem('smokebox.v1.state') || ''; let n = 0; try { n = JSON.parse(t).state.tickets.length; } catch (e) { n = -1; } return { bytes: t.length, tickets: n }; });
  saved = await p.evaluate(() => localStorage.getItem('smokebox.v1.state'));
  console.log('  note  what the browser kept: ' + (savedInfo.bytes / 1e6).toFixed(2) + ' MB, ' + savedInfo.tickets + ' tickets of history');
  await ctx.close();
}

const results = [];
for (const rate of RATES) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await p.addInitScript(INIT);
  await p.addInitScript((txt) => { try { localStorage.setItem('smokebox.v1.state', txt); } catch (e) { /* too big for this browser */ } }, saved);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
  const t0 = Date.now();
  await p.goto(pathToFileURL(DIST).href);
  await p.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 120000 });
  const bootMs = Date.now() - t0;
  await p.evaluate(() => SB.floor.setWelcome(false));
  await p.waitForSelector('.fl', { timeout: 60000 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const paintMs = Date.now() - t0;
  const prof = (await cdp.send('Profiler.stop')).profile;
  // The five functions that took the most own time while booting (a hint for where to look, not a measurement of the app's own code split).
  const self = new Map(); const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const dt = prof.timeDeltas; prof.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + (n.callFrame.lineNumber + 1); self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
  const top = [...self.entries()].filter((e) => !/^\(idle|\(program|\(garbage/.test(e[0])).sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0].trim() + ' ' + Math.round(e[1]) + 'ms');
  const tickets = await p.evaluate(() => SB.store.getState().tickets.length);
  await p.evaluate(() => { SB.floor.setSound(true); });
  await p.evaluate(() => { const S = SB.store; const ings = S.getState().ingredients.filter((i) => i.tcs && i.hold === 'hot'); const hot = ings.length ? ings : S.getState().ingredients.filter((i) => i.tcs); for (let i = 0; i < 10; i++) S.dispatchEx('addBatch', { ing: hot[i % hot.length].id, tempF: 160, cookedG: 3000 + i * 100 }, { source: 'ui' }); });
  const row = { rate, boot: bootMs, paint: paintMs, historyAtBoot: tickets, top, per: {} };
  for (const n of COUNTS) {
    // Grows the board to n open tickets (the history stays).
    await p.evaluate((n) => { const S = SB.store, menu = S.getState().menu.filter((m) => !m.archived); const have = S.getState().tickets.filter((t) => t.status === 'active').length; for (let i = have; i < n; i++) S.dispatchEx('createTicket', { customer: 'T' + i, channel: i % 3 ? 'dine_in' : 'takeout', items: [{ menuId: menu[i % menu.length].id, qty: 1 }, { menuId: menu[(i + 3) % menu.length].id, qty: 1 }], note: '', rush: i % 17 === 0 }, { source: 'ui' }); }, n);
    await p.waitForTimeout(3000 * Math.min(rate, 4));
    const rows = {};
    // Runs fn in the page, waits two frames, and returns the script time and the time to the painted frame; long tasks inside are counted.
    const time = (fn, arg) => p.evaluate(async ({ src, arg }) => {
      const f = new Function('arg', 'return (' + src + ')(arg)'); const lt0 = window.__lt.length;
      const t0 = performance.now(); f(arg); const sync = performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { sync, paint: performance.now() - t0, longs: window.__lt.slice(lt0).map((x) => x[1]) };
    }, { src: fn.toString(), arg });
    // Repeats one action and keeps the medians and the worst long task.
    async function run(name, fn, times = 5, setup) {
      const sy = [], pa = []; let worst = 0;
      for (let i = 0; i < times; i++) { if (setup) await setup(i); const r = await time(fn, i); sy.push(r.sync); pa.push(r.paint); for (const l of r.longs) worst = Math.max(worst, l); await p.waitForTimeout(150 * Math.min(rate, 4)); }
      rows[name] = { paint: med(pa), sync: med(sy), long: worst };
    }
    const closeSheets = () => p.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await run('Start', () => { const b = [...document.querySelectorAll('.fl-slip button[data-act="item"]')].find((x) => x.offsetParent && !x.disabled); if (b) b.click(); });
    await run('Done', () => { const b = [...document.querySelectorAll('.fl-slip button[data-act="item"]')].find((x) => x.offsetParent && !x.disabled && x.dataset.state && x.dataset.state !== 'displayed'); if (b) b.click(); });
    await run('Bump', (i) => { const t = SB.store.getState().tickets.filter((x) => x.status === 'active')[i]; if (!t) return; t.items.forEach((it) => SB.store.dispatchEx('completeItem', { ticketId: t.id, itemId: it.id }, { source: 'ui' })); const b = document.querySelector('.fl-slip[data-ticket="' + t.id + '"] [data-act="bump"]'); if (b) b.click(); });
    await run('Station tab', (i) => { SB.floor.setZone(['pit', 'all', 'fry', 'all', 'cold', 'all'][i % 6]); });
    await run('Order sheet open', () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true })); }, 3, closeSheets);
    await closeSheets();
    await run('Send (open sheet, 2 dishes, tap Send)', async () => 0, 1);
    // Send is a real tap on the real button: measured separately because it needs the sheet open first.
    {
      const sy = [], pa = []; let worst = 0;
      for (let i = 0; i < 3; i++) {
        await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))); await p.waitForTimeout(500 * Math.min(rate, 4));
        await p.evaluate(() => { const t = document.querySelectorAll('.ord-tile'); if (t[0]) t[0].click(); if (t[1]) t[1].click(); }); await p.waitForTimeout(300);
        const r = await time(() => { const b = document.querySelector('.ord-send'); if (b) b.click(); }, i);
        sy.push(r.sync); pa.push(r.paint); for (const l of r.longs) worst = Math.max(worst, l); await p.waitForTimeout(500);
        await closeSheets();
      }
      rows['Send (tap)'] = { paint: med(pa), sync: med(sy), long: worst }; delete rows['Send (open sheet, 2 dishes, tap Send)'];
    }
    await run('Orders drawer open', () => { SB.sheets.open('orders'); }, 3, closeSheets);
    await p.evaluate(() => SB.sheets.open('orders')); await p.waitForTimeout(800 * Math.min(rate, 4));
    await run('Pay (quick pay)', () => { const b = document.querySelector('.ox-quick'); if (b) b.click(); }, 3);
    await closeSheets();
    await run('Burst of 12 tickets', (i) => { const S = SB.store, menu = S.getState().menu.filter((m) => !m.archived); for (let k = 0; k < 12; k++) S.dispatchEx('createTicket', { customer: 'B' + i + '-' + k, channel: 'takeout', items: [{ menuId: menu[k % menu.length].id, qty: 1 }], note: '', rush: false }, { source: 'ui' }); }, 2);
    row.per[n] = rows;
  }
  const lt = await p.evaluate(() => window.__lt.filter((x) => x[1] >= 100).length);
  row.long100 = lt; row.said = await p.evaluate(() => window.__said.length);
  results.push(row);
  check('rate ' + rate + 'x: no page errors', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

// The table
for (const r of results) {
  console.log('\n== CPU ' + r.rate + 'x, 800x1280, history at boot ' + r.historyAtBoot + ' tickets');
  console.log('  boot to board loaded ' + r.boot + ' ms, to first painted board ' + r.paint + ' ms; long tasks of 100 ms or more in the whole run: ' + r.long100);
  console.log('  boot profile top: ' + r.top.join('; '));
  for (const n of COUNTS) {
    console.log('  ' + n + ' open tickets: tap to paint ms (script ms) [worst long task ms]');
    for (const [k, v] of Object.entries(r.per[n])) {
      const slow = v.paint > BUDGET.tap * (r.rate / 4 > 1 ? r.rate / 4 : 1); if (slow) warn++;
      console.log('    ' + k.padEnd(22) + String(v.paint).padStart(6) + ' (' + String(v.sync).padStart(5) + ') [' + String(v.long).padStart(4) + ']' + (slow ? '  WARN slow' : ''));
    }
  }
}
console.log('\n' + warn + ' warning(s) (budgets only warn).');
await browser.close();
console.log(fail ? fail + ' check(s) failed' : 'all checks passed');
process.exit(fail ? 1 : 0);
