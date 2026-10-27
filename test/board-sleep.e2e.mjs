// Tablet sleep and wake on the kitchen board (browser, about 2 minutes). Run: node test/board-sleep.e2e.mjs
// The page goes hidden, the clock jumps (Playwright's fake clock: fastForward fires each timer once, like a frozen page that wakes),
// and the page comes back. Checks: one tick right away (never a loop of missed seconds), one calm summary line on the strip
// ("While this screen was asleep: ..."), at most one spoken line and one tone, the strip showing the current state, the "may go to sleep" and
// "Checked" lines, the wake lock asked for again, no call-out twice after waking, a cleared row staying cleared. Needs dist/smokebox.html.
import { toolRequire } from '../tools/_deps.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = toolRequire('playwright');
const DIST = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist/smokebox.html');
let fail = 0;
// Records one check and prints it.
function check(name, ok, detail) { if (!ok) fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + String(JSON.stringify(detail)).slice(0, 400))); }
const SPY = "window.__said = []; window.SpeechSynthesisUtterance = function (t) { this.text = t; }; Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (u) => window.__said.push(u.text), cancel() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {} } }); window.__osc = 0; const AC = window.AudioContext; if (AC) { const co = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__osc++; return co.call(this); }; }";
const WAKE = "window.__wl = { requests: 0, released: 0, listeners: [] }; Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => { window.__wl.requests++; return Promise.resolve({ addEventListener: (t, f) => window.__wl.listeners.push(f), release() { window.__wl.released++; } }); } } });";
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
// Opens the board on a fake clock at noon with the sample kitchen, sound allowed, three open tickets.
async function open({ wake = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.addInitScript(SPY);
  await p.addInitScript(wake ? WAKE : "Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });");
  await p.clock.install({ time: new Date(2026, 9, 17, 12, 0, 0) });
  await p.goto(pathToFileURL(DIST).href + '?demo');
  await p.waitForFunction(() => window.SB && SB.booted === true);
  await p.evaluate(() => { SB.floor.setWelcome(false); SB.sim.live.crew(false); SB.store.resetLive({ keepSettings: true, starter: true }); SB.floor.setSound(true); });
  await p.mouse.click(500, 400);
  await p.clock.runFor(3000);
  for (let i = 0; i < 3; i++) await p.evaluate((i) => SB.store.dispatchEx('createTicket', { customer: 'T' + i, channel: 'dine_in', items: [{ menuId: SB.store.getState().menu[0].id, qty: 1 }], note: '', rush: false }, { source: 'ui' }), i);
  await p.clock.runFor(5000);
  p.ctx = ctx;
  return p;
}
const hide = (p) => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); window.__said.length = 0; window.__osc = 0; });
const show = (p) => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
const strip = (p) => p.evaluate(() => [...document.querySelectorAll('.fl-strip-bar, .fl-strip-row')].filter((e) => e.offsetParent !== null).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));

// 1. Sleeps of 2, 20 and 90 minutes
for (const min of [2, 20, 90]) {
  const p = await open();
  const before = await p.evaluate(() => SB.floor.stats().ticks);
  await hide(p);
  await p.clock.fastForward(min * 60e3);
  const w0 = Date.now();
  await show(p);
  const right = await p.evaluate(() => ({ ticks: SB.floor.stats().ticks, last: SB.floor.stats().lastTickMs }));
  const wall = Date.now() - w0;
  check(min + ' min: the board ticks once right away on waking (not before the next timer)', right.ticks >= before + 1 && right.ticks <= before + 3, { before, right });
  await p.clock.runFor(1500);
  const after = await p.evaluate(() => ({ ticks: SB.floor.stats().ticks, said: window.__said.slice(), osc: window.__osc, now: SB.store.now() }));
  check(min + ' min: no loop of missed seconds (a handful of ticks, not ' + (min * 60) + ')', after.ticks - before <= 6, { before, after: after.ticks });
  check(min + ' min: at most one spoken line and one tone after waking', after.said.length <= 1 && after.osc <= 3, after);
  const lines = await strip(p);
  const joined = lines.join(' | ');
  if (min === 2) check('2 min: a short nap says it was in the background', /in the background for 2 minutes/.test(joined) || /asleep/.test(joined), lines);
  else check(min + ' min: one summary line says what changed while asleep', /While this screen was asleep: .*(went late|passed)/.test(joined), lines);
  check(min + ' min: the strip shows the right current state (the store time moved on the whole sleep)', after.now - (await p.evaluate(() => SB.store.getState().tickets[0].createdAt)) >= min * 60e3 - 20e3, after.now);
  if (min === 90) console.log('  note  wake cost: first tick ' + right.last.toFixed(1) + ' ms in the page, wake round trip ' + wall + ' ms wall');
  await p.ctx.close();
}

// 2. The lines that come and go
{
  const p = await open({ wake: false });
  let t = (await strip(p)).join(' | ');
  check('no wake lock: the "may go to sleep" line shows', /may go to sleep/.test(t), t);
  await hide(p); await p.clock.fastForward(20 * 60e3); await show(p); await p.clock.runFor(1500);
  const checkedNow = await p.evaluate(() => (document.querySelector('.fl-checked') || {}).textContent);
  const expect = await p.evaluate(() => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase());
  check('"Updated" shows the time of waking, not the time before the sleep', !!checkedNow && checkedNow.toLowerCase().replace(/\s/g, '').includes(expect.replace(/\s/g, '')), { checkedNow, expect });
  await p.clock.runFor(11 * 60e3);
  t = (await strip(p)).join(' | ');
  check('ten minutes after waking the "while asleep" line has gone', !/While this screen was asleep/.test(t) && !/in the background/.test(t), t);
  await p.ctx.close();
}
{
  const p = await open({ wake: true });
  await p.clock.runFor(1500);
  const t = (await strip(p)).join(' | ');
  check('with a wake lock the "may go to sleep" line is not shown', !/may go to sleep/.test(t), t);
  await p.ctx.close();
}

// 3. The wake lock is asked for again, and again when the system takes it back
{
  const p = await open({ wake: true });
  const r0 = await p.evaluate(() => window.__wl.requests);
  await hide(p); await p.clock.fastForward(5 * 60e3); await show(p); await p.clock.runFor(300);
  const r1 = await p.evaluate(() => window.__wl.requests);
  check('coming back to the front asks for the wake lock again', r1 > r0, { r0, r1 });
  await p.evaluate(() => window.__wl.listeners.slice(-1)[0] && window.__wl.listeners.slice(-1)[0]()); await p.clock.runFor(1500);
  const r2 = await p.evaluate(() => window.__wl.requests);
  check('when the system takes the lock back the board asks again', r2 > r1, { r1, r2 });
  await p.ctx.close();
}

// 4. A long sleep: the work on waking is bounded
{
  const p = await open();
  await hide(p);
  await p.clock.fastForward(90 * 60e3);
  const before = await p.evaluate(() => SB.floor.stats().ticks);
  const t0 = Date.now();
  await show(p);
  const ms = Date.now() - t0;
  const n = await p.evaluate(() => SB.floor.stats().ticks) - before;
  console.log('  note  waking after 90 minutes: ' + n + ' tick(s), ' + ms + ' ms wall for the wake call');
  check('waking after 90 minutes runs a few ticks, not 5400', n >= 1 && n <= 3, n);
  check('and the wake call returns fast (under 1.5 s on a loaded machine)', ms < 1500, ms);
  await p.ctx.close();
}

// 5. Nothing sounds twice after waking, and a cleared row stays cleared through a sleep
{
  const p = await open();
  await p.clock.runFor(5 * 3600e3 + 60e3); // five hours of normal ticking: ribs pass their 4 hour limit and sound once
  const ruled = await strip(p);
  const rowX = p.locator('.fl-strip-row .fl-strip-x, .fl-strip-rowwrap .fl-strip-x').first();
  const had = (await rowX.count()) > 0;
  check('five hours on: a warning row is showing', had, ruled);
  const rowText = had ? (await strip(p)).find((x) => /^(PAST|NOW|LATE|SOON)/.test(x)) || '' : '';
  console.log('  note  row cleared: ' + rowText.slice(0, 60));
  if (had) { await rowX.click(); await p.clock.runFor(500); }
  await hide(p); await p.clock.fastForward(20 * 60e3); await show(p); await p.clock.runFor(2000);
  const said1 = await p.evaluate(() => window.__said.slice());
  await p.clock.runFor(30e3);
  const said2 = await p.evaluate(() => window.__said.slice());
  check('no spoken line is repeated in the 30 seconds after waking', said2.length === said1.length || said2.slice(said1.length).every((x) => !said1.includes(x)), { said1, said2 });
  check('a row cleared before the sleep is not shown again as new', !rowText || !(await strip(p)).includes(rowText), { rowText, now: await strip(p) });
  await p.ctx.close();
}


// 6. A put-off ("remind me later") reminder across a sleep: quiet while put off, one call when it is due, never twice
{
  const p = await open();
  // Only the ribs batch stays, so every spoken line is about it.
  await p.evaluate(() => { for (const b of SB.store.getState().batches) if (b.id !== 'b_13') SB.store.dispatchEx('discardBatch', { batchId: b.id, reason: 'manual' }, { source: 'ui' }); });
  await p.clock.runFor(215 * 60e3); // the 45 minute call is already past; the next rung (20 minutes left) comes at 220
  await p.evaluate(() => { window.__said.length = 0; });
  const sn = await p.evaluate(() => SB.store.dispatchEx('snoozeAlert', { batchId: 'b_13', forMin: 10 }, { source: 'ui' }).report);
  check('the reminder was put off for ten minutes', sn === 'ok', sn);
  await hide(p); await p.clock.fastForward(7 * 60e3); await show(p); await p.clock.runFor(2000);
  const q1 = await p.evaluate(() => ({ said: window.__said.slice(), until: SB.store.getState().alertSnoozes && SB.store.getState().alertSnoozes.b_13, now: SB.store.now() }));
  check('a sleep that crosses a rung inside the put-off time: nothing is said, and the put-off survived', q1.said.length === 0 && q1.until > q1.now, q1);
  await hide(p); await p.clock.fastForward(6 * 60e3); await show(p); await p.clock.runFor(2000);
  const said1 = await p.evaluate(() => window.__said.slice());
  console.log('  note  after the put-off: ' + JSON.stringify({ said: said1, osc: await p.evaluate(() => window.__osc), rows: await p.evaluate(() => SB.deadlines.build(SB.store.getState(), SB.store.now()).filter((d) => d.batchId === 'b_13').map((d) => [d.kind, d.rung, Math.round(d.msLeft / 60e3), d.snoozedUntil || 0])) }));
  check('a sleep past the put-off time: the reminder is spoken once, about the ribs', said1.length === 1 && /ribs/i.test(said1[0]), said1);
  await p.clock.runFor(30e3);
  const said2 = await p.evaluate(() => window.__said.slice());
  check('and not again in the next 30 seconds', said2.length === said1.length || said2.slice(1).every((x) => x !== said1[0]), said2);
  await p.ctx.close();
}

// 7. The browser discarded the page and reloaded it after 90 minutes: back from the saved state with one summary line
{
  const p = await open();
  await p.evaluate(() => SB.store.flush());
  await hide(p);
  await p.clock.fastForward(90 * 60e3);
  const t0 = Date.now();
  await p.reload();
  await p.waitForFunction(() => window.SB && SB.booted === true);
  const boot = Date.now() - t0;
  await p.evaluate(() => { SB.floor.setWelcome(false); });
  await p.clock.runFor(1500);
  const r = await p.evaluate(() => ({ slips: document.querySelectorAll('.fl-slip').length, tickets: SB.store.getState().tickets.length, said: window.__said.slice(), osc: window.__osc }));
  check('after the reload the board shows the saved tickets', r.slips === 3 && r.tickets === 3, r);
  check('and nothing is spoken or sounded before anyone has tapped', r.said.length === 0 && r.osc === 0, r);
  await p.mouse.click(500, 400); await p.clock.runFor(1500);
  const r2 = await p.evaluate(() => ({ said: window.__said.slice(), osc: window.__osc }));
  check('after the first tap at most one spoken line and one tone', r2.said.length <= 1 && r2.osc <= 3, r2);
  const lines = (await strip(p)).join(' | ');
  check('one summary line says what changed while the page was away', /While this screen was asleep: .*went late/.test(lines), lines);
  console.log('  note  reload after 90 minutes: boot ' + boot + ' ms wall');
  await p.ctx.close();
}

// 8. The one-time notice about saved history (the store's historyNotice / historyNoticeSeen): shown calmly, marked seen once, gone when cleared
{
  const p = await open();
  await p.evaluate(() => { window.__hs = []; let on = true; SB.store.historyNotice = () => (on ? { kind: 'trimmed', words: 'Older history was dropped to make room: 12 days. Close the month regularly to keep it in files.' } : null); SB.store.historyNoticeSeen = (k) => { window.__hs.push(k); on = false; }; });
  await p.clock.runFor(8000);
  const lines = (await strip(p)).join(' | ');
  check('the history notice shows as a calm strip line', /Older history was dropped to make room: 12 days/.test(lines), lines);
  check('it is marked seen exactly once, with its kind', JSON.stringify(await p.evaluate(() => window.__hs)) === '["trimmed"]', await p.evaluate(() => window.__hs));
  await p.clock.runFor(8000);
  check('and it stays up (one line, not repeated) until cleared', ((await strip(p)).join(' | ').match(/Older history/g) || []).length === 1, await strip(p));
  const x = p.locator('.fl-bar-pause .fl-strip-x:visible').first();
  if (await x.count()) { await x.click(); await p.clock.runFor(2000); }
  check('clearing it removes it for good', !/Older history/.test((await strip(p)).join(' | ')), await strip(p));
  await p.ctx.close();
}
check('no uncaught page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
console.log(fail ? fail + ' check(s) failed' : 'all checks passed');
process.exit(fail ? 1 : 0);
