#!/usr/bin/env node
// WHAT THIS FILE IS: Fast browser smoke test (about 15 s). Opens dist/smokebox.html in headless Chromium and
// checks the basics a customer meets first: an empty first run with no console errors, New ticket opens, a
// ticket can be sent and bumped, far display toggles, and the Busy-night demo loads the demo kitchen.
// Prints a pass/fail table and exits 1 on any failure. Run: node tools/build.mjs --quiet && node tools/smoke.mjs
// PARTS: check helper, the steps, the table. USES: tools/pw.mjs (Playwright), dist/smokebox.html. USED BY: you, before a PR.
import { withPage } from './pw.mjs';

const started = Date.now();
const rows = [];

// Records one named check with its result and a short detail, and never throws.
function check(name, ok, detail = '') { rows.push({ name, ok: !!ok, detail: String(detail).slice(0, 70) }); }

// Runs fn and turns a thrown error into a failed check so one broken step does not hide the rest.
async function step(name, fn) {
  try { await fn(); } catch (e) { check(name + ' (step crashed)', false, e.message.split('\n')[0]); }
}

// Waits until the page function returns something truthy, up to ms; returns that value or false.
async function until(page, fn, arg, ms = 8000) {
  try { const h = await page.waitForFunction(fn, arg, { timeout: ms }); return await h.jsonValue(); } catch (e) { return false; }
}

await withPage({ w: 1280, h: 800 }, async (page, logs) => {
  page.setDefaultTimeout(5000);
  await step('first run', async () => {
    await until(page, () => document.querySelector('.fl-new'));
    const s = await page.evaluate(() => ({ tickets: SB.store.getState().tickets.length, batches: SB.store.getState().batches.length, empty: !!document.querySelector('.fl-empty-actions') }));
    check('First run is an empty kitchen', s.tickets === 0 && s.batches === 0, `tickets ${s.tickets}, batches ${s.batches}`);
    const k = await page.evaluate(() => ({ dishes: SB.store.getState().menu.length, ings: SB.store.getState().ingredients.length, blank: SB.store.isBlank() }));
    check('First run has no dishes or ingredients', k.dishes === 0 && k.ings === 0 && k.blank, `dishes ${k.dishes}, ingredients ${k.ings}, blank ${k.blank}`);
    check('Empty board offers New ticket and Busy-night demo', s.empty && (await page.locator('.fl-start-demo').count()) === 1);
    check('No console errors on first load', logs.errors.length === 0 && logs.pageErrors.length === 0, logs.errors.concat(logs.pageErrors)[0] || '');
  });
  await step('new ticket', async () => {
    // A new install has no dishes, so the test adds one the way the owner will (the setup screens come later).
    await page.evaluate(() => SB.store.dispatch('addMenuItem', { name: 'Test pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' }));
    await page.click('.fl-new');
    check('New ticket opens the order sheet', await until(page, () => document.querySelectorAll('.ord-tile').length >= 1, undefined, 4000));
  });
  await step('send and bump', async () => {
    await page.click('.ord-tile:has-text("Test pie")');
    await page.click('.ord-send');
    check('A ticket can be sent to the kitchen', await until(page, () => SB.store.getState().tickets.length === 1 && document.querySelector('.fl-bump')));
    await page.click('.slip-item'); // a cold item has no START step: one tap marks it done
    await page.click('.fl-bump');
    const gone = await until(page, () => SB.store.getState().tickets.every((t) => t.status !== 'active'));
    check('The item can be marked done and the ticket bumped', gone);
  });
  await step('far display', async () => {
    await page.click('.fl-menu');
    await page.click('.toggle:has-text("Far display")');
    const on = await page.evaluate(() => SB.floor.farDisplay());
    await page.click('.toggle:has-text("Far display")');
    const off = await page.evaluate(() => !SB.floor.farDisplay());
    check('Far display switches on and off', on && off, `on ${on}, off ${off}`);
    await page.keyboard.press('Escape');
  });
  await step('demo', async () => {
    // The demo loads into a kitchen with nothing of the owner's in it, so start from a fresh install again.
    await page.evaluate(() => { SB.store.destroy(); localStorage.clear(); });
    await page.reload();
    await until(page, () => document.querySelector('.fl-start-demo'), undefined, 4000);
    // The demo is its own mode with its own saved data, entered by a page reload.
    await page.click('.fl-start-demo');
    // One plain question first (Watch the demo?), then the page reloads into the demo.
    await page.locator('.sheet-root button:has-text("Watch the demo"), .dialog button:has-text("Watch the demo"), [role="dialog"] button:has-text("Watch the demo")').last().click({ timeout: 4000 });
    await page.waitForLoadState('load');
    const s = await until(page, () => { const st = typeof SB !== 'undefined' && SB.store && SB.store.isDemo && SB.store.isDemo() ? SB.store.getState() : null; return st && st.batches.length > 0 && st.tickets.length > 0 ? { b: st.batches.length, t: st.tickets.length } : false; }, undefined, 15000);
    await until(page, () => !!localStorage.getItem('smokebox.demo.state'), undefined, 4000); // saved a moment after the first tickets
    const sep = await page.evaluate(() => ({ demoKey: !!localStorage.getItem('smokebox.demo.state'), realKey: !!localStorage.getItem('smokebox.v1.state') }));
    check('The demo keeps its own saved data', s && sep.demoKey, JSON.stringify(sep));
    check('Busy-night demo loads the demo kitchen', !!s, s ? `${s.b} batches, ${s.t} tickets` : 'no batches or tickets within 15 s');
    check('No console errors during the whole run', logs.errors.length === 0 && logs.pageErrors.length === 0, logs.errors.concat(logs.pageErrors)[0] || '');
  });
});

const w = Math.max(...rows.map((r) => r.name.length));
console.log('\nSmokebox smoke test (headless Chromium, simulated only)');
for (const r of rows) console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name.padEnd(w) + (r.detail ? '  ' + r.detail : ''));
const bad = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - bad}/${rows.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s` + (bad ? ` - ${bad} FAILED` : ' - all pass'));
process.exit(bad ? 1 : 0);
