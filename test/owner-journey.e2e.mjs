/*
 * WHAT THIS FILE IS: The first month of an owner as ONE scripted run of the real UI in Chromium: a blank install, a simulated clock (the page's Date is moved
 * by an offset; timers stay real so the screen draws), then day 0 setup (dishes typed and imported, a price change, how you serve, the cook-ahead question,
 * tablet checks, a PIN with a recovery code), days 1-10 of service (orders, board taps, payments in cash and card, a void, a discount, a reopen, a
 * refused reopen after the day closed, closing each evening with starting cash, a thrown-out batch, readings, a cold item out and back), a backup on
 * day 5, a restore on day 8 with Undo this restore, then the clock moves to day 46 and the Close the month flow runs, the office pages are
 * checked, and Start over (PIN and backup) ends on the blank first screen.
 * EVERY PHASE IS CHECKED against the engine as the oracle (checkInvariants, no refused action) and against an independent LEDGER the script keeps
 * in cents from its own price table (never read back from the app). Console and page errors fail the run. Taps are counted per phase.
 * Where a step has no screen worth driving (marked "store" in the log), the store action is called directly and counted separately.
 * USES: tools/pw.mjs helpers via tools/_deps.mjs (Playwright), test/_load.mjs (engine in Node), dist/smokebox.html.
 * RUN: node test/owner-journey.e2e.mjs   (about 5 minutes). Env: SHOTS=dir keeps the screenshots, TAPS_OUT=file writes the tap table as JSON.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolRequire } from '../tools/_deps.mjs';
import { DIST, ROOT } from '../tools/pw.mjs';
import { loadSB } from './_load.mjs';

const { chromium } = toolRequire('playwright');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'owner-journey-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-journey-dl-'));

let pass = 0, fail = 0;
const failures = [];
// Records one check and prints it.
function check(name, ok, detail) { if (ok) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + String(JSON.stringify(detail)).slice(0, 500) : '')); } }
const group = (t) => console.log('\n# ' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- browser, clock, counters */
const START = new Date(2026, 10, 2, 8, 30, 0); // Monday 2 Nov 2026, 08:30 local: day 0
const DAY = 86400e3;
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET/.test(m.text() + ((m.location() || {}).url || ''))) problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String((e && e.stack) || e).split('\n')[0]));
// A simulated clock: the page's Date is moved by an offset (timers stay real, so the screen draws normally). Set before the app starts.
await page.addInitScript((startMs) => {
  const RealDate = Date, realNow = RealDate.now.bind(RealDate);
  window.__off = startMs - realNow();
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(realNow() + window.__off); else super(...a); }
    static now() { return realNow() + window.__off; }
  }
  window.Date = FakeDate;
}, START.getTime());
await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 15000 });

page.setDefaultTimeout(8000);
const T = { phase: 'start', byPhase: {} };
// Starts a named phase for the tap table.
function phase(name) { T.phase = name; T.byPhase[name] = T.byPhase[name] || { taps: 0, typed: 0, keys: 0, store: 0 }; group(name); }
const cnt = (k, n = 1) => { T.byPhase[T.phase][k] += n; };
// Taps one control the way a person would and counts it. On a miss it prints what was on screen so the script can be fixed.
async function tap(sel, why) {
  try { await page.click(sel, { timeout: 6000 }); } catch (e) { await dump('tap failed: ' + sel + (why ? ' (' + why + ')' : '')); throw e; }
  cnt('taps'); await sleep(60);
}
// Types into one field (one tap to focus it counts, then the text) and counts one typed field.
async function type(sel, text, why) {
  try { await page.click(sel, { timeout: 6000 }); await page.fill(sel, text); } catch (e) { await dump('type failed: ' + sel + (why ? ' (' + why + ')' : '')); throw e; }
  cnt('taps'); cnt('typed');
}
// Calls a store action directly (counted apart from taps, and said so in the log).
async function viaStore(label, type_, payload) {
  const r = await page.evaluate(([t, p]) => { const x = SB.store.dispatchEx(t, p, { source: 'ui' }); return { report: x.report, info: x.info }; }, [type_, payload]);
  cnt('store'); if (r.report !== 'ok') problems.push('store action refused: ' + label + ' ' + r.report + ' ' + JSON.stringify(r.info));
  return r;
}
// Prints the top sheet's title and the buttons on screen, to find the right selector when a step fails.
async function dump(msg) {
  const d = await page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const sheets = [...document.querySelectorAll('.sheet')].filter(vis); const top = sheets[sheets.length - 1] || document.body;
    return { title: (top.querySelector('h1,h2,.sheet-title') || {}).textContent, buttons: [...top.querySelectorAll('button,input,select,textarea,[role=switch]')].filter(vis).map((b) => (b.dataset && b.dataset.act ? '[' + b.dataset.act + '] ' : '') + (b.getAttribute('aria-label') || b.textContent || b.placeholder || b.type).trim().slice(0, 40)).slice(0, 60) };
  });
  const acts = await page.evaluate(() => [...document.querySelectorAll('[data-act]')].map((b) => b.dataset.act + (b.disabled ? '(disabled)' : '') + (b.closest('[hidden]') || !b.getClientRects().length ? '(hidden)' : '')).join(' '));
  console.log('  ## ' + msg + '\n  ## data-act: ' + acts + '\n  ## on screen: ' + d.title + ' | ' + d.buttons.join(' | '));
}
let shotN = 0;
// Saves a numbered screenshot for the key moments.
async function shot(name) { const f = path.join(SHOTS, String(++shotN).padStart(2, '0') + '-' + name + '.png'); await page.screenshot({ path: f }); console.log('  shot ' + f); }
const closeSheets = () => page.evaluate(() => SB.sheets.closeAll());
const openSheet = async (name, opts) => { await page.evaluate(([n, o]) => SB.sheets.open(n, o || {}), [name, opts]); await sleep(300); };
const noToastErrors = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).filter((t) => /could not|refused|went wrong/i.test(t)));

// Moves the app's clock forward by ms (the page's own Date and timers), then lets the store tick.
async function advance(ms) { await page.evaluate((d) => { window.__off += d; SB.store.tick(); }, ms); await sleep(150); }
// Moves to a clock time on a given day (day 0 = START), never backwards.
async function gotoTime(day, hour, minute = 0) {
  const target = new Date(START.getFullYear(), START.getMonth(), START.getDate() + day, hour, minute, 0).getTime();
  const now = await page.evaluate(() => Date.now());
  if (target > now) {
    // The app holds a forward jump over 36 hours until the owner accepts it, so long gaps go in steps of 20 hours.
    let left = target - now;
    while (left > 0) { const step = Math.min(left, 20 * 3600e3); await advance(step); left -= step; }
  }
}

/* ---------------------------------------------------------------- the oracle and the ledger */
const E = (await loadSB(['00-util', '10-config', '20-engine'])).engine;
const PIN = '2468';
const LEDGER = { prices: new Map(), orders: [] }; // prices: dish name -> cents. orders: { day, name, cents, method, tip, status }
const dollars = (c) => (c / 100).toFixed(2);
// Reads the page's whole kitchen state through the store.
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(SB.store.getState())));
// Checks the engine's own invariants on the page's state, with the engine loaded here in Node as the oracle.
async function invariants(label) {
  const [s, now] = await Promise.all([state(), page.evaluate(() => SB.store.now())]);
  const bad = E.checkInvariants(s, now);
  check(label + ': engine invariants hold', bad.length === 0, bad);
  return s;
}
// Adds up the paid orders the app holds for a service day, in cents, from the order records (food after discount, tax, tip).
function appTotals(s, day) {
  let n = 0, food = 0, tip = 0, total = 0;
  for (const o of s.orders) if (o.status === 'paid' && o.serviceDate === day) { n++; const t = o.totals || {}; food += Math.round(((t.subtotal || 0) - (t.discount || 0)) * 100); tip += Math.round((o.tip || 0) * 100); total += Math.round(((t.total || 0) + (o.tip || 0)) * 100); }
  return { n, food, tip, total };
}
// The day key (YYYY-MM-DD) of day N at the script's clock.
const dayKey = (n) => { const d = new Date(START.getFullYear(), START.getMonth(), START.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// Sums the ledger for one day: paid orders only. Food is the price table times quantity less the discount; tip as typed.
function ledgerDay(n) {
  const rows = LEDGER.orders.filter((o) => o.day === n && o.status === 'paid');
  return { n: rows.length, food: rows.reduce((a, o) => a + o.cents, 0), tip: rows.reduce((a, o) => a + o.tip, 0), rows };
}

/* ---------------------------------------------------------------- the journey (filled in below) */
const JOURNEY = [];
const step = (name, fn) => JOURNEY.push([name, fn]);

/* ================================================================ DAY 0: first run */
step('day 0 dishes', async () => {
  phase('day 0: first run, dishes');
  await shot('00-blank-first-screen');
  const s0 = await state();
  check('a blank install has no dishes, tickets or orders', s0.menu.length === 0 && s0.tickets.length === 0 && s0.orders.length === 0);
  await tap('.fl-first-dish', 'Add your first dish');
  await page.waitForSelector('.dp-form');
  const dishes = [['Pulled pork plate', '12.50', 'pit'], ['Mac and cheese', '4.50', 'sides'], ['Sweet tea', '3.00', 'cold']];
  let i = 0;
  for (const [name, price, zone] of dishes) {
    i++;
    await page.keyboard.type(name); cnt('typed'); await page.keyboard.press('Enter'); await page.keyboard.type(price); cnt('typed');
    const chosen = await page.evaluate(() => { const t = document.querySelector('.dp-tile[aria-checked="true"]'); return t && t.dataset.zone; });
    if (chosen !== zone) await tap('.dp-tile[data-zone="' + zone + '"]', 'station ' + zone);
    await tap(i < 3 ? '[data-act="save-again"]' : '[data-act="save-done"]', 'save');
    LEDGER.prices.set(name, Math.round(parseFloat(price) * 100));
    await sleep(300);
  }
  const s1 = await state();
  check('three dishes typed in are on the menu with the typed prices', s1.menu.filter((m) => !m.archived).length === 3 && dishes.every(([n, p]) => s1.menu.some((m) => m.name === n && Math.round(m.price * 100) === Math.round(parseFloat(p) * 100))), s1.menu.map((m) => [m.name, m.price]));
  await invariants('after typing dishes');
});

step('day 0 import and price', async () => {
  phase('day 0: import a menu, change a price');
  await tap('.fl-menu', 'Settings');
  await tap('button:has-text("Dishes and prices")', 'Dishes and prices');
  await page.waitForSelector('.dp-list .dp-row');
  await tap('summary:has-text("More ways to add dishes")', 'More ways to add dishes');
  await tap('[data-act="open-import"]', 'import a menu');
  await page.waitForSelector('textarea');
  const csv = 'Fries,4.25,fry\nBrisket sandwich,11.00,pit\nLemonade,3.00,cold\nBad row without a price';
  const csvFile = path.join(DL, 'menu.csv'); fs.writeFileSync(csvFile, 'Dish,Price\nFries,4.25\nBrisket sandwich,11.00\nLemonade,3.00\nChili,6.50\n');
  await page.setInputFiles('input[type=file]', csvFile); cnt('taps');
  await sleep(500);
  await tap('[data-act="import-check"]', 'check the file').catch(() => {});
  await page.waitForSelector('.dp-prow', { timeout: 5000 });
  const rows = await page.locator('.dp-prow').count();
  check('the CSV preview shows its four dishes', rows === 4, rows);
  await tap('[data-act="import-go"]', 'import');
  await sleep(500);
  for (const [n, c] of [['Fries', 425], ['Brisket sandwich', 1100], ['Lemonade', 300], ['Chili', 650]]) LEDGER.prices.set(n, c);
  const s = await state();
  check('the four imported dishes are on the menu with their prices', ['Fries', 'Brisket sandwich', 'Lemonade', 'Chili'].every((n) => s.menu.some((m) => !m.archived && m.name === n && Math.round(m.price * 100) === LEDGER.prices.get(n))), s.menu.map((m) => [m.name, m.price]));
  await invariants('after the import');
  await closeSheets();
  // A price slip: Fries goes up from 4.25 to 4.50 in the Dishes and prices list.
  await tap('.fl-menu', 'Settings'); await tap('button:has-text("Dishes and prices")', 'Dishes and prices');
  await page.waitForSelector('.dp-list .dp-row');
  const pr = page.locator('input[aria-label="Price of Fries"]');
  await pr.click(); cnt('taps'); await pr.fill('4.50'); cnt('typed'); await pr.blur(); await sleep(400);
  LEDGER.prices.set('Fries', 450);
  check('the price change to Fries saved', (await state()).menu.find((m) => m.name === 'Fries').price === 4.5);
  await closeSheets();
});

step('day 0 serve, cook-ahead, checks, PIN', async () => {
  phase('day 0: how you serve, cook-ahead, tablet checks, PIN');
  await tap('.fl-menu', 'Settings');
  await tap('button:has-text("How you serve")', 'How you serve');
  await page.waitForSelector('.so-serve');
  await type('input[aria-label="New order button name"]', 'Window', 'a new order button');
  await tap('[data-act="chip-add"]', 'Add button');
  check('the new order button Window is saved', (await state()).settings.service.chips.includes('Window'), (await state()).settings.service);
  await closeSheets();
  // The cook-ahead question: Dishes and prices, "Yes, I cook ahead".
  await tap('.fl-menu', 'Settings'); await tap('button:has-text("Dishes and prices")', 'Dishes and prices');
  await tap('[data-act="add-cooked"]', 'Yes, I cook ahead');
  await sleep(400);
  // Fills the cooked-ahead form for one item: its name, hot or cold, the hours it may stay, a batch size and the dish that uses it.
  async function cookedItem(name, kind, hours, kg, dish, grams, fridgeDays) {
    await type('input[aria-label="What do you cook ahead?"], .sheet input[placeholder="Soup"]', name, 'name');
    await page.locator('.sheet', { hasText: 'Cooked-ahead food' }).last().getByText(kind, { exact: true }).click(); cnt('taps');
    if (kind === 'Cold' && fridgeDays) { const d = page.locator('input[aria-label="Days it may stay in the fridge"]'); await d.click(); await d.fill(String(fridgeDays)); cnt('taps'); cnt('typed'); }
    if (kind === 'Cold') { const f = page.locator('input[aria-label="Hours it may be out of the fridge"]'); await f.click(); await f.fill(String(hours)); cnt('taps'); cnt('typed'); }
    else await type('input[aria-label="Hours it may stay"]', String(hours), 'hours');
    await type('input[aria-label="Usual batch size in kilograms"]', String(kg), 'batch kg');
    for (const other of (await page.locator('.sheet', { hasText: 'Cooked-ahead food' }).last().locator('input[type=checkbox]:checked').all())) { await other.uncheck(); cnt('taps'); }
    await tap('input[aria-label="' + dish + ' uses it"]', dish + ' uses it');
    await type('input[aria-label="Grams of it in one ' + dish + '"]', String(grams), 'grams');
    await tap('[data-act="save-cooked"]', 'Save cooked-ahead item');
    await sleep(500);
  }
  await cookedItem('Pulled pork', 'Hot', 4, 3, 'Pulled pork plate', 180);
  const st1 = await state();
  check('the hot cooked-ahead item was saved and tracking is on', st1.ingredients.some((i) => i.name === 'Pulled pork') && st1.settings.modules.cookAhead === true, st1.ingredients.map((i) => i.name));
  // The saved item stays on screen with its next steps; the person closes it and taps Add another cooked-ahead item in Dishes and prices.
  await page.locator('.sheet', { hasText: 'Cooked-ahead food' }).last().getByRole('button', { name: 'Close' }).click(); cnt('taps'); await sleep(400);
  await tap('[data-act="add-cooked"]', 'Add another cooked-ahead item');
  await cookedItem('Coleslaw', 'Cold', 4, 2, 'Mac and cheese', 90, 2);
  check('the cold cooked-ahead item was saved', (await state()).ingredients.some((i) => i.name === 'Coleslaw'));
  await closeSheets();
  // Tablet checks.
  await tap('.fl-menu', 'Settings'); await tap('button:has-text("Tablet checks")', 'Tablet checks');
  await page.waitForSelector('[data-act="sound-test"]');
  await tap('[data-act="sound-test"]', 'Play a test sound'); await tap('[data-act="sound-yes"]', 'I heard it');
  await dump('tablet checks');
  await shot('01-tablet-checks');
  await closeSheets();
  // Tax, hours and a manager PIN with a recovery code.
  await tap('.fl-menu', 'Settings'); await tap('button:has-text("Tax, hours and PIN")', 'Tax, hours and PIN');
  await page.waitForSelector('[aria-label="Manager PIN, 4 digits"]');
  await type('input[aria-label="Sales tax percent"]', '8', 'tax'); await tap('button:has-text("Save tax")', 'Save tax');
  await sleep(300);
  check('sales tax 8% saved', (await state()).settings.service.taxRatePct === 8, (await state()).settings.service.taxRatePct);
  LEDGER.taxPct = 8;
  await type('[aria-label="Manager PIN, 4 digits"]', PIN, 'PIN');
  await tap('button:has-text("Set PIN")', 'Set PIN');
  await page.waitForSelector('.rc-code');
  LEDGER.recovery = (await page.locator('.rc-code').innerText()).trim();
  check('a recovery code is shown after the PIN is set', /^[A-Z0-9 -]{8,}$/i.test(LEDGER.recovery), LEDGER.recovery);
  await shot('02-recovery-code');
  await tap('#rc-saved', 'I saved it'); await tap('[data-act="rc-done"]', 'Done');
  check('the manager PIN is set', await page.evaluate(() => SB.shell.hasPin()));
  await closeSheets();
  await invariants('end of day 0');
});
// Types the PIN on the keypad when it is showing (one tap per digit).
async function keypadIfShown() {
  if (!(await page.locator('.keypad').count())) return false;
  for (const d of PIN) await tap('.keypad button:text-is("' + d + '")', 'PIN digit');
  await sleep(400); return true;
}


/* ================================================================ helpers for service days */
// Lets the page draw: nudges the simulated clock a little at a time until the board shows a slip for every active ticket (the page draws on timers the fake clock owns).
async function settleBoard() {
  for (let i = 0; i < 24; i++) {
    const n = (await state()).tickets.filter((t) => t.status !== 'expedited' && t.status !== 'voided').length;
    const have = await page.evaluate(() => document.querySelectorAll('.fl-grid .fl-slip:not(.fl-leaving)').length);
    if (have >= n) return true;
    await sleep(150);
  }
  return false;
}
// Goes back to the board (sheets closed, route home, All stations).
async function toBoard() { await closeSheets(); await sleep(100); await page.evaluate(() => { location.hash = '#/'; }); await sleep(150); const all = page.locator('.fl-seg [data-id="all"]'); if (await all.count()) { await all.first().click(); cnt('taps'); }
  await settleBoard();
}
// Logs a fresh batch of a cooked-ahead product through the Cabinet: Cabinet tab, New batch, pick the product, Put in hold cabinet.
async function logBatch(product) {
  await tap('.fl-seg [data-id="cabinet"]', 'Cabinet');
  await page.locator('button, [role=radio], [role=tab]').filter({ hasText: /^New batch/ }).first().click(); cnt('taps'); await sleep(300);
  await page.locator('button, [role=radio], [role=tab]').filter({ hasText: new RegExp(product) }).last().click(); cnt('taps');
  await tap('button:has-text("Put in hold cabinet")', 'Put in hold cabinet');
  await sleep(500);
  await toBoard();
}
// Takes a new order through the New ticket screen. items: [[dish, qty]]. pay: 'cash' | 'card' | null (pay later). Records it in the ledger and returns it.
async function order(day, items, { customer, pay = null, tip = 0 } = {}) {
  await tap('.fl-new', 'New ticket');
  await page.waitForSelector('.ord-tile');
  for (const [dish, qty] of items) for (let i = 0; i < qty; i++) { await tap('.ord-tile[aria-label^="' + dish + ',"]', 'dish ' + dish); }
  if (customer) { await page.locator('.ord-cust-input').fill(customer); cnt('typed'); }
  // The order screen remembers how the last order was paid, so a tap is needed only when this order differs.
  const want = pay || 'later';
  const have = await page.locator('.ord-pay [aria-checked="true"]').first().getAttribute('data-id').catch(() => '');
  if (have !== want) await tap('.ord-pay [data-id="' + want + '"]', 'pay ' + want);
  if (tip) { await page.locator('.ord-tip-input').fill(dollars(tip)); cnt('typed'); }
  await tap('.ord-send', 'Send to kitchen');
  await sleep(500);
  const cents = items.reduce((a, [d, q]) => a + LEDGER.prices.get(d) * q, 0);
  const o = { day, customer, items, cents, disc: 0, tip, method: pay, status: pay ? 'paid' : 'open', paidLater: !pay };
  LEDGER.orders.push(o);
  await closeSheets();
  return o;
}
// Taps every dish on the board until all tickets are out (start, done, bump), the way a cook would.
async function cookAll() {
  await toBoard();
  const active = async () => (await state()).tickets.filter((t) => t.status !== 'expedited' && t.status !== 'voided').length;
  for (let pass = 0; pass < 4 && await active() > 0; pass++) {
    await settleBoard();
    for (let guard = 0; guard < 60; guard++) {
      const btn = page.locator('.fl-grid .fl-slip:not(.fl-leaving) button[data-act="item"]:not([disabled])').first();
      if (await btn.count() === 0) break;
      await btn.click(); cnt('taps'); await sleep(480);
      await advance(2 * 60e3);
    }
    for (let guard = 0; guard < 30; guard++) {
      const bump = page.locator('.fl-grid .fl-slip:not(.fl-leaving) button[data-act="bump"]:not([disabled])').first();
      if (await bump.count() === 0) break;
      await bump.click(); cnt('taps'); await sleep(450);
    }
  }
  const left = (await state()).tickets.filter((t) => t.status !== 'expedited' && t.status !== 'voided');
  if (left.length) { await shot('cook-failure'); await dump('cookAll left tickets'); }
  check('every ticket was cooked and bumped (' + left.length + ' left)', left.length === 0, left.map((t) => [t.customer, t.status, t.items.map((i) => i.status)]));
}


// Opens the Orders sheet from the header button.
async function ordersSheet() { await closeSheets(); await page.getByRole('button', { name: /Open orders/ }).first().click(); cnt('taps'); await page.waitForSelector('.ox'); await sleep(250); }
// Pays the first open order in the Orders sheet through the Take payment box. Sets the ledger row (found by customer) to paid with the typed choices.
async function payInBox(customer, { method = 'cash', discPct = 0, tipPct = 0 } = {}) {
  if (!(await page.locator('.ox-row:not(.ox-row-paid)', { hasText: customer }).first().isVisible().catch(() => false))) { await page.getByRole('tab', { name: /^Open/ }).click(); cnt('taps'); await sleep(250); }
  const row = page.locator('.ox-row', { hasText: customer }).first();
  await row.locator('.ox-take').click(); cnt('taps');
  await page.waitForSelector('.ox-pay-go');
  // The box starts on the way the last order was paid, so a tap is needed only when this one differs.
  const word = method === 'card' ? 'Card' : method === 'other' ? 'Other' : 'Cash';
  const have = (await page.locator('.ox-method [aria-checked="true"]').first().innerText().catch(() => '')).trim();
  if (have !== word) await page.locator('.ox-method').getByText(word, { exact: true }).click().then(() => cnt('taps'));
  if (discPct) await tap('.ox-pay [aria-label="Quick discounts"] .chip:has-text("' + discPct + '%")', 'discount ' + discPct);
  if (tipPct) await tap('.ox-pay [aria-label="Quick tips"] .chip:has-text("' + tipPct + '%")', 'tip ' + tipPct);
  await tap('.ox-pay-go', 'Mark paid');
  await sleep(400);
  const o = LEDGER.orders.find((x) => x.customer === customer && x.status === 'open');
  o.status = 'paid'; o.method = method; o.disc = Math.round(o.cents * discPct / 100); o.tip = Math.round((o.cents - o.disc) * tipPct / 100);
  return o;
}
// Closes the service day through Orders, Close the day: starting cash typed, leftovers thrown out, then (optionally) the backup button on the done screen.
async function closeTheDay(day, { startCash = '100.00', backup = false, discardLeftovers = true } = {}) {
  await ordersSheet();
  await tap('[data-act="closeday"]', 'Close the day');
  await page.waitForSelector('.cd-page');
  const cash = page.locator('.cd-page input[inputmode="decimal"]').first();
  if (await cash.count()) { await cash.click(); await cash.fill(startCash); cnt('taps'); cnt('typed'); }
  if (discardLeftovers && await page.locator('input[name="cd-left"][value="discard"]').count()) { await tap('input[name="cd-left"][value="discard"]', 'throw leftovers out'); }
  await tap('.cd-page button:has-text("Close the day")', 'Close the day');
  await page.waitForSelector('.cd-done');
  let file = null;
  if (backup) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.cd-actions button:has-text("Back up today")').click()]);
    cnt('taps'); file = path.join(DL, 'backup-day' + day + '.json'); await dl.saveAs(file);
  }
  await tap('.cd-actions button:has-text("Done")', 'Done');
  return file;
}
// Checks one closed day: the app's paid orders for that service day against the ledger (count, food after discount, tips, and total with tax), in cents.
async function checkDayAgainstLedger(day, label) {
  const s = await state(); const app = appTotals(s, dayKey(day)); const led = ledgerDay(day);
  const food = led.rows.reduce((a, o) => a + o.cents - o.disc, 0), tax = led.rows.reduce((a, o) => a + Math.round((o.cents - o.disc) * LEDGER.taxPct / 100), 0);
  check(label + ': paid orders ' + app.n + ' = ledger ' + led.n, app.n === led.n, [app.n, led.n]);
  check(label + ': food after discount ' + dollars(app.food) + ' = ledger ' + dollars(food), app.food === food, [app.food, food]);
  check(label + ': tips ' + dollars(app.tip) + ' = ledger ' + dollars(led.tip), app.tip === led.tip, [app.tip, led.tip]);
  check(label + ': total with tax and tips ' + dollars(app.total) + ' = ledger ' + dollars(food + tax + led.tip), app.total === food + tax + led.tip, [app.total, food + tax + led.tip]);
  const ev = E.allEvents(s).filter((e) => e.type === 'day_closed' && e.day === dayKey(day)).pop();
  if (ev) {
    const c = (x) => Math.round(x * 100);
    check(label + ': day_closed record: ' + ev.orders + ' orders, subtotal ' + ev.subtotal + ', discount ' + ev.discount + ', tax ' + ev.tax + ', tip ' + ev.tip + ' matches the ledger', ev.orders === led.n && c(ev.subtotal) === led.rows.reduce((a, o) => a + o.cents, 0) && c(ev.discount) === led.rows.reduce((a, o) => a + o.disc, 0) && c(ev.tip) === led.tip && c(ev.tax) === tax, { ledger: { n: led.n, sub: led.rows.reduce((a, o) => a + o.cents, 0), disc: led.rows.reduce((a, o) => a + o.disc, 0), tip: led.tip, tax }, ev });
    for (const m of ['cash', 'card']) check(label + ': ' + m + ' count in the day_closed record = ledger', ((ev.byMethod[m] || {}).count || 0) === led.rows.filter((o) => o.method === m).length);
  } else check(label + ': a day_closed record exists', false);
  return s;
}

/* ================================================================ DAYS 1-4 */
step('day 1', async () => {
  await gotoTime(1, 9, 30);
  phase('day 1: first service');
  await logBatch('Pulled pork'); await logBatch('Coleslaw');
  await gotoTime(1, 11, 0);
  await order(1, [['Pulled pork plate', 2], ['Fries', 1]], { customer: 'Maria', pay: 'cash' });
  await order(1, [['Fries', 2], ['Sweet tea', 2]], { customer: 'Tom', pay: 'card' });
  await order(1, [['Brisket sandwich', 1], ['Lemonade', 1]], { customer: 'Ana' });
  await cookAll();
  await gotoTime(1, 12, 15);
  await ordersSheet(); await payInBox('Ana', { method: 'cash', tipPct: 20 });
  await shot('03-orders-paid');
  await closeTheDay(1);
  await checkDayAgainstLedger(1, 'day 1');
  await invariants('day 1');

});

step('day 2 discount', async () => {
  await gotoTime(2, 9, 30);
  phase('day 2: discount');
  await logBatch('Pulled pork'); await logBatch('Coleslaw');
  await gotoTime(2, 11, 0);
  await order(2, [['Pulled pork plate', 1], ['Mac and cheese', 1], ['Lemonade', 2]], { customer: 'Dana', pay: 'cash', tip: 100 });
  await order(2, [['Brisket sandwich', 2], ['Chili', 1]], { customer: 'Lee' });
  await order(2, [['Fries', 3]], { customer: 'Sam', pay: 'card' });
  await cookAll();
  await ordersSheet(); await payInBox('Lee', { method: 'card', discPct: 10, tipPct: 15 });
  await closeTheDay(2);
  await checkDayAgainstLedger(2, 'day 2');
  await invariants('day 2');
});


step('day 3 void and thrown-out', async () => {
  await gotoTime(3, 9, 30);
  phase('day 3: void, thrown-out batch');
  await logBatch('Pulled pork');
  // A batch is thrown out by hand: Cabinet, More for this batch, Discard, a reason, Discard batch.
  await tap('.fl-seg [data-id="cabinet"]', 'Cabinet');
  await tap('[data-act="more"]', 'More for this batch');
  await page.getByRole('menuitem', { name: 'Discard' }).click(); cnt('taps'); await sleep(300);
  await tap('.sheet:has-text("Discard Pulled pork") >> text=Quality', 'reason Quality');
  await tap('.sheet:has-text("Discard Pulled pork") button:has-text("Discard batch")', 'Discard batch'); await sleep(500);
  const afterDiscard = await state();
  check('the batch thrown out by hand is logged as a discard', E.allEvents(afterDiscard).some((e) => e.type === 'batch_discard' && e.t > START.getTime() + 2 * DAY), E.allEvents(afterDiscard).filter((e) => e.type === 'batch_discard').length);
  await toBoard();
  await logBatch('Pulled pork');
  await gotoTime(3, 11, 0);
  // An order is started and then voided: the ticket first (a reason), then the empty order in Orders.
  const v = await order(3, [['Fries', 1]], { customer: 'Void me' });
  await toBoard();
  await tap('.fl-grid .fl-slip button[data-act="more"]', 'More for ticket');
  await page.getByRole('menuitem', { name: 'Void ticket' }).click(); cnt('taps'); await sleep(300);
  await tap('.sheet:has-text("Void ticket #") >> text=Customer left', 'reason'); await tap('.sheet:has-text("Void ticket #") button:has-text("Void ticket")', 'confirm void'); await sleep(500);
  await ordersSheet(); await tap('.ox-row [data-act="void"]', 'Void empty order'); await sleep(400);
  v.status = 'voided';
  check('the voided order is voided and no longer open', (await state()).orders.find((o) => o.customer === 'Void me').status === 'voided');
  await closeSheets();
  await order(3, [['Pulled pork plate', 1], ['Chili', 2]], { customer: 'Kim', pay: 'cash' });
  await cookAll();
  await closeTheDay(3);
  await checkDayAgainstLedger(3, 'day 3');
  const s3 = await invariants('day 3');
  const ev = E.allEvents(s3).filter((e) => e.type === 'day_closed' && e.day === dayKey(3)).pop();
  check('the day_closed record counts the voided order and ticket', ev && ev.voidedOrders === 1 && ev.voidedTickets === 1, ev && [ev.voidedOrders, ev.voidedTickets]);
  await openSheet('discards'); await shot('04-thrown-out-log'); await closeSheets();
});

step('day 4 reopen', async () => {
  await gotoTime(4, 9, 30);
  phase('day 4: reopen, refused reopen');
  await logBatch('Pulled pork');
  await gotoTime(4, 11, 0);
  const joe = await order(4, [['Pulled pork plate', 1], ['Sweet tea', 1]], { customer: 'Joe', pay: 'cash' });
  await order(4, [['Fries', 2]], { customer: 'Rae', pay: 'card', tip: 50 });
  await cookAll();
  // Joe paid cash by mistake: reopen on the same day (Orders, Paid today, Reopen), then pay again by card.
  await ordersSheet();
  await page.getByRole('tab', { name: /Paid today/ }).click().catch(async () => { await page.locator('.ox-tabs [data-id="paid"], button:has-text("Paid today")').first().click(); }); cnt('taps'); await sleep(300);
  await page.locator('.ox-row-paid', { hasText: 'Joe' }).locator('[data-act="reopen"]').click(); cnt('taps'); await sleep(500);
  joe.status = 'open'; joe.method = null;
  check('a paid order reopens on the same day and goes back to Open', (await state()).orders.find((o) => o.customer === 'Joe').status === 'open');
  await payInBox('Joe', { method: 'card' });
  await closeSheets();
  await closeTheDay(4);
  await checkDayAgainstLedger(4, 'day 4');
  await invariants('day 4');
  // After closing the day, Reopen on the same day's paid order is refused in words and nothing changes.
  await ordersSheet();
  await page.getByRole('tab', { name: /Paid today/ }).click().catch(async () => { await page.locator('button:has-text("Paid today")').first().click(); }); cnt('taps'); await sleep(300);
  await page.locator('.ox-row-paid', { hasText: 'Rae' }).locator('[data-act="reopen"]').click(); cnt('taps'); await sleep(500);
  const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText.replace(/\s+/g, ' ')).join(' | '));
  const rae = (await state()).orders.find((o) => o.customer === 'Rae');
  check('reopening an order on a closed day is refused in words: "' + toast.slice(0, 120) + '"', rae.status === 'paid' && /clos/i.test(toast), toast);
  await closeSheets();
});

// A plain service day: batches, three orders (one paid later), cook, pay, close. Returns the close's backup file when asked.
async function plainDay(n, { backup = false, extra } = {}) {
  await gotoTime(n, 9, 30);
  phase('day ' + n + ': service' + (backup ? ', backup' : ''));
  await logBatch('Pulled pork'); await logBatch('Coleslaw');
  await gotoTime(n, 11, 0);
  await order(n, [['Pulled pork plate', 1 + (n % 2)], ['Fries', 1]], { customer: 'Cust' + n + 'a', pay: 'cash', tip: 75 });
  await order(n, [['Mac and cheese', 2], ['Lemonade', 1]], { customer: 'Cust' + n + 'b', pay: 'card' });
  await order(n, [['Chili', 1], ['Brisket sandwich', 1]], { customer: 'Cust' + n + 'c' });
  if (extra) await extra();
  await cookAll();
  await ordersSheet(); await payInBox('Cust' + n + 'c', { method: n % 2 ? 'cash' : 'card', tipPct: 18 });
  const f = await closeTheDay(n, { backup });
  await checkDayAgainstLedger(n, 'day ' + n);
  await invariants('day ' + n);
  return f;
}
step('day 5 with backup', async () => {
  LEDGER.backup5 = await plainDay(5, { backup: true });
  check('the day-5 backup file was downloaded', fs.existsSync(LEDGER.backup5) && fs.statSync(LEDGER.backup5).size > 1000, LEDGER.backup5);
  LEDGER.ordersAtBackup = LEDGER.orders.length; LEDGER.ticketsAtBackup = (await state()).tickets.length;
  await shot('05-backup-done');
});
step('day 6 readings', async () => {
  await plainDay(6, { extra: async () => {
    await tap('.fl-seg [data-id="cabinet"]', 'Cabinet');
    const before = E.allEvents(await state()).filter((e) => e.type === 'temp_logged').length;
    await tap('[data-act="log"]', 'Log temp'); await sleep(300);
    await page.getByRole('button', { name: 'Save reading' }).click(); cnt('taps'); await sleep(500);
    await whoIfAsked();
    check('a temperature reading was logged from the cabinet', E.allEvents(await state()).filter((e) => e.type === 'temp_logged').length === before + 1, before);
    await toBoard();
  } });
});
step('day 7 cold item', async () => {
  await plainDay(7, { extra: async () => {
    await tap('.fl-seg [data-id="cabinet"]', 'Cabinet');
    const col = page.locator('[aria-label^="Coleslaw"]').first();
    await col.locator('[data-act="take-out"]').click(); cnt('taps'); await sleep(500);
    await whoIfAsked();
    check('the cold batch was taken out of the fridge', E.allEvents(await state()).filter((e) => e.type === 'batch_out').length >= 1, (await state()).batches.map((b) => [b.label, b.status, b.out]));
    await page.locator('[data-act="put-back"]:visible').first().click(); cnt('taps'); await sleep(500);
    await whoIfAsked();
    check('and put back', E.allEvents(await state()).filter((e) => e.type === 'batch_back').length >= 1);
    await toBoard();
  } });
});
// The first safety action on a tablet asks "Who is this?": types initials and confirms (once per tablet for two hours).
async function whoIfAsked(initials = 'JM') {
  const dlg = page.locator('.sheet:has-text("Who is this?")');
  if (!(await dlg.count())) return false;
  await dlg.locator('input').first().fill(initials); cnt('typed');
  await dlg.locator('button:not([data-act="skip-who"])').filter({ hasNotText: /^Close$|Cancel/ }).last().click(); cnt('taps'); await sleep(500);
  return true;
}

step('day 8 restore and undo', async () => {
  await gotoTime(8, 9, 30);
  phase('day 8: restore from the day-5 backup, undo');
  const pre = await state();
  const preCounts = { tickets: pre.tickets.length, orders: pre.orders.length };
  await toBoard();
  await tap('button:has-text("Back office")', 'Back office'); await sleep(500); await keypadIfShown();
  await page.getByText('Menu, prices and shop').first().click(); cnt('taps'); await sleep(800);
  await page.locator('input[type=file]').first().setInputFiles(LEDGER.backup5); cnt('taps'); await sleep(900);
  await shot('06-restore-preview');
  await tap('button:has-text("Replace everything with this backup")', 'Replace everything'); await sleep(500);
  await keypadIfShown();
  await page.getByRole('button', { name: 'Replace everything', exact: true }).click(); cnt('taps'); await sleep(1200);
  await keypadIfShown();
  await dump('after restore');
  await shot('07-after-restore');
  const post = await state();
  check('after the restore the kitchen is the day-5 one (tickets ' + post.tickets.length + ' of ' + preCounts.tickets + ')', post.tickets.length === LEDGER.ticketsAtBackup && post.tickets.length < preCounts.tickets, [post.tickets.length, LEDGER.ticketsAtBackup]);
  const led5 = [1, 2, 3, 4, 5].reduce((a, d) => a + ledgerDay(d).n, 0);
  check('paid orders after the restore = ledger through day 5 (' + led5 + ')', post.orders.filter((o) => o.status === 'paid').length === led5, post.orders.filter((o) => o.status === 'paid').length);
  await invariants('after restore');
  await tap('button:has-text("Undo this restore")', 'Undo this restore'); await sleep(600);
  await page.getByRole('button', { name: 'Put my old kitchen back' }).click(); cnt('taps'); await sleep(900);
  await keypadIfShown(); await sleep(600);
  const back = await state();
  check('Undo this restore brings back days 6 and 7 (tickets ' + back.tickets.length + ' = ' + preCounts.tickets + ', orders ' + back.orders.length + ')', back.tickets.length === preCounts.tickets && back.orders.length === preCounts.orders, [back.tickets.length, preCounts.tickets, back.orders.length, preCounts.orders]);
  await invariants('after undo restore');
  for (const d of [6, 7]) await checkDayAgainstLedger(d, 'day ' + d + ' after the undo');
  await toBoard();
});

step('days 8-10', async () => {
  await plainDay(8);
  await plainDay(9);
  await plainDay(10);
  const s = await state();
  const all = Array.from({ length: 10 }, (_, i) => i + 1).reduce((a, d) => a + ledgerDay(d).n, 0);
  check('after ten days the app holds every paid order the ledger has (' + all + ')', s.orders.filter((o) => o.status === 'paid').length === all, s.orders.filter((o) => o.status === 'paid').length);
});

/* ================================================================ DAY 46: Close the month */
step('later days and Close the month', async () => {
  // The days between are quiet. The clock moves in steps under 36 hours (a bigger jump is held for the owner's yes), then two more days of service.
  await gotoTime(43, 8, 0);
  await plainDay(44); await plainDay(45);
  await gotoTime(46, 9, 0);
  phase('day 46: Close the month');
  const pre = await state();
  const keptLedger = [44, 45].reduce((a, d) => a + ledgerDay(d).n, 0);
  // Every order of days 1-10 goes, the voided one included (the ledger keeps voided rows too).
  const oldLedger = LEDGER.orders.filter((o) => o.day >= 1 && o.day <= 10).length;
  const pv = await page.evaluate(() => SB.store.closeMonthPreview({ before: new Date(SB.store.now()).getFullYear() + '-' + String(new Date(SB.store.now()).getMonth() + 1).padStart(2, '0') + '-01' }));
  check('the store would move out the ten service days and keep the last 35 days (' + pv.preview.days.length + ' days, ' + pv.preview.orders + ' orders)', pv.ok && pv.preview.orders === oldLedger && pv.preview.days.length === 10, [pv.preview && pv.preview.orders, oldLedger, pv.preview && pv.preview.days]);
  await toBoard();
  await page.evaluate(() => SB.sheets.open('closemonth')); await sleep(500); // the Data page card that opens this is on another branch, so the sheet is opened by its name
  await keypadIfShown();
  await page.waitForSelector('[data-act="cm-next1"]');
  const t1 = await page.locator('[data-role="cm-counts"]').innerText();
  check('step 1 shows the same counts as the store: ' + pv.preview.orders + ' orders', new RegExp(pv.preview.orders + ' orders').test(t1), t1.slice(0, 200));
  await shot('08-close-month-step1');
  await tap('[data-act="cm-next1"]', 'Next: save the files');
  const downloads = []; page.on('download', async (d) => { const f = path.join(DL, 'month-' + d.suggestedFilename()); await d.saveAs(f); downloads.push(f); });
  await tap('[data-act="cm-save-files"]', 'Save the month files now'); await sleep(2800);
  check('five month files were downloaded', downloads.length === 5, downloads);
  await tap('#cm-saw', 'I saved the files'); await tap('[data-act="cm-next2"]', 'Next: confirm');
  await type('input[aria-label="Type CLOSE to confirm"]', 'CLOSE', 'word');
  await tap('[data-act="cm-go"]', 'Close the month');
  await page.waitForSelector('[data-role="cm-done"]:not([hidden])');
  await shot('09-close-month-done');
  const done = await page.locator('[data-role="cm-done"]').innerText();
  const post = await invariants('after Close the month');
  check('the old days are gone (' + pre.orders.length + ' to ' + post.orders.length + ' orders)', post.orders.length === pre.orders.length - oldLedger, [pre.orders.length, post.orders.length, oldLedger]);
  check('the kept window still reconciles with the ledger (days 44 and 45)', [44, 45].every((d) => { const a = appTotals(post, dayKey(d)), l = ledgerDay(d); return a.n === l.n && a.tip === l.tip; }));
  for (const d of [44, 45]) await checkDayAgainstLedger(d, 'day ' + d + ' after Close the month');
  check('the done screen offers Undo for 7 days', /kept for 7 days/.test(done) && await page.locator('[data-act="cm-undo"]').count() === 1, done.slice(0, 200));
  check('a month_closed record was written and safety records stayed', E.allEvents(post).some((e) => e.type === 'month_closed'));
  // Office pages still open and read the numbers.
  await tap('[data-act="cm-finish"]', 'Done');
  await tap('button:has-text("Back office")', 'Back office'); await sleep(500); await keypadIfShown();
  const pages = ['Speed', 'Tickets', 'Stations', 'Sales and money', 'Safety', 'Stock and 86', 'Menu, prices and shop'];
  for (const name of pages) {
    // The office navigation: a link or tab with the page's name (not other text that happens to say the same word).
    await page.locator('.of-nav-full').filter({ hasText: new RegExp('^\\s*' + name + '\\s*$') }).first().click(); cnt('taps'); await sleep(700);
    const txt = await page.evaluate(() => document.body.innerText);
    check('office page "' + name + '" renders without NaN, undefined or null', !/\bNaN\b|undefined|\bnull\b|Invalid Date|\[object/.test(txt), (txt.match(/.{20}(NaN|undefined|null|Invalid Date).{20}/) || [])[0]);
    if (name === 'Sales and money') {
      await shot('10-office-money');
      const note = /archiv|closed the month|moved out/i.test(txt);
      console.log('  note  office Sales and money ' + (note ? 'mentions' : 'does NOT mention') + ' the closed month (archivedBefore ' + post.archivedBefore + ')');
    }
  }
  await tap('button:has-text("Back to the line")', 'Back to the line');
});

/* ================================================================ Start over */
step('Start over', async () => {
  phase('Start over: PIN, backup, blank first screen');
  await toBoard();
  await tap('.fl-menu', 'Settings');
  await page.locator('.mn-links button, button', { hasText: /Start over/ }).first().click(); cnt('taps'); await sleep(500);
  await keypadIfShown();
  await page.waitForSelector('[data-act="so-next1"]');
  await tap('[data-act="so-next1"]', 'Next: about your backup');
  const dl = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="so-save-backup"]').click()]); cnt('taps');
  await dl[0].saveAs(path.join(DL, 'before-start-over.json'));
  await tap('#so-saw', 'I saved the backup'); await tap('[data-act="so-next2"]', 'Next: confirm');
  await type('input[aria-label="Type ERASE to confirm"]', 'ERASE', 'word');
  await tap('[data-act="so-go"]', 'Erase everything');
  await page.waitForSelector('[data-act="so-finish"]');
  await shot('11-start-over-done');
  await tap('[data-act="so-finish"]', 'Go to the first screen'); await sleep(800);
  const s = await invariants('after Start over');
  check('the kitchen is empty: no dishes, tickets or orders', s.menu.filter((m) => !m.archived).length === 0 && s.tickets.length === 0 && s.orders.length === 0, [s.menu.length, s.tickets.length, s.orders.length]);
  check('the tax, hours and PIN stayed (the box was ticked)', s.settings.service.taxRatePct === 8 && await page.evaluate(() => SB.shell.hasPin()));
  await toBoard();
  check('the blank first screen shows Add your first dish again', await page.locator('.fl-first-dish').isVisible());
  await shot('12-blank-first-screen-again');
});
/*STEPS*/
for (const [name, fn] of JOURNEY) { try { await fn(); } catch (e) { await dump('step failed: ' + name).catch(() => {}); check('step "' + name + '" ran to the end', false, String(e.message || e).split('\n').slice(0, 3).join(' ')); await shot('failure').catch(() => {}); break; } }

/* ---------------------------------------------------------------- the end */
group('summary');
check('no console or page errors during the whole journey', problems.length === 0, problems.slice(0, 6));
console.log('\nTAPS per phase (taps, typed fields, store calls):');
for (const [k, v] of Object.entries(T.byPhase)) console.log('  ' + k.padEnd(44) + v.taps + ' taps, ' + v.typed + ' typed, ' + v.store + ' store');
if (process.env.TAPS_OUT) fs.writeFileSync(process.env.TAPS_OUT, JSON.stringify(T.byPhase, null, 1));
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed' + (fail ? ': ' + failures.join('; ') : ''));
process.exit(fail ? 1 : 0);
