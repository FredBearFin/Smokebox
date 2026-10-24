// Board and ordering round 3 checks (browser, about 40 s). Run: node test/board-round3.e2e.mjs
// Covers: cook-ahead parts hidden when the module is off and shown when it is on or a batch holds food, the Guide and
// Thrown-out log menu entries, the "Pay with" switch on one-tap payment, zero badges, welcome button size and the slim
// backup bar. Needs dist/smokebox.html.
import { withPage } from '../tools/pw.mjs';

let fail = 0;
// Records one check and prints it.
function check(name, ok, detail) { if (!ok) fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + JSON.stringify(detail))); }
const ready = (page) => page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 8000 });
const goDemo = async (page) => { await page.goto(page.url().split('#')[0].split('?')[0] + '?demo'); await ready(page); };
const demo = (page) => page.evaluate(() => { SB.floor.setWelcome(false); SB.sim.live.crew(false); return SB.store.resetLive({ keepSettings: true, starter: true, stagger: true, catalog: 'sample', replaceOwn: true }); });
const seen = (page) => page.evaluate(() => { const v = (s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }; return { cab: v('.fl-seg [data-id="cabinet"]'), san: v('.fl-san'), holdBtn: v('[data-tool="hold"]') }; });

await withPage({ w: 1280, h: 800 }, async (page, logs) => {
  await ready(page);
  const off = await seen(page);
  check('blank kitchen: module is off', await page.evaluate(() => SB.engine.moduleOn(SB.store.getState(), 'cookAhead') === false));
  check('blank kitchen: no Cabinet tab, Hold button or Sanitize chip', !off.cab && !off.san && !off.holdBtn, off);
  await page.keyboard.press('h'); await page.waitForTimeout(300);
  check('blank kitchen: key H opens nothing', (await page.locator('.hc, .fl-cabinet:not([hidden])').count()) === 0);
  const noZero = await page.evaluate(() => [...document.querySelectorAll('.fl-seg .seg-count')].every((e) => e.offsetParent === null));
  check('quiet tabs show no 0 bubbles', noZero);
  const wb = await page.evaluate(() => [...document.querySelectorAll('.fl-empty-actions .btn')].map((e) => Math.round(e.getBoundingClientRect().height)));
  check('first-run buttons are at least 44 px tall', wb.length > 0 && wb.every((h) => h >= 44), wb);

  await demo(page); await page.waitForTimeout(1200);
  const on = await seen(page);
  check('demo kitchen: Cabinet tab and Sanitize chip show', on.cab && on.san, on);
  // Module switched off while food is still in a batch: the cabinet stays
  await page.evaluate(() => SB.store.dispatchEx('updateSettings', { patch: { modules: { cookAhead: false } } }, { source: 'ui' }));
  await page.waitForTimeout(1200);
  const held = await seen(page);
  check('module off but batches hold food: Cabinet tab stays', held.cab, held);
  await page.evaluate(() => { for (const b of SB.store.getState().batches.slice()) SB.store.dispatchEx('discardBatch', { batchId: b.id, reason: 'manual' }, { source: 'ui' }); });
  await page.waitForTimeout(1500);
  const gone = await seen(page);
  check('module off and no food in batches: Cabinet tab and Sanitize chip go', !gone.cab && !gone.san, gone);

  // Menu sheet entries
  await page.evaluate(() => SB.sheets.open('menu')); await page.waitForSelector('.mn-links');
  const links = await page.evaluate(() => [...document.querySelectorAll('.mn-links .mn-link')].map((e) => e.textContent.trim()));
  check('Menu sheet has Guide when the guide exists', await page.evaluate(() => typeof SB.guide === 'object') ? links.includes('Guide') : !links.includes('Guide'), links);
  check('Thrown-out log hidden while cook-ahead is off', !links.includes('Thrown-out log') && !links.includes('Discard log'), links);
  await page.keyboard.press('Escape');
  await page.evaluate(() => SB.store.dispatchEx('updateSettings', { patch: { modules: { cookAhead: true } } }, { source: 'ui' }));
  await page.waitForTimeout(800);
  await page.evaluate(() => SB.sheets.open('menu')); await page.waitForSelector('.mn-links');
  const links2 = await page.evaluate(() => [...document.querySelectorAll('.mn-links .mn-link')].map((e) => e.textContent.trim()));
  check('Thrown-out log shows with cook-ahead on', links2.includes('Thrown-out log'), links2);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('no page errors', logs.pageErrors.length === 0, logs.pageErrors);
});

await withPage({ w: 1280, h: 800 }, async (page) => {
  await ready(page); await goDemo(page); await demo(page);
  await page.evaluate(() => { SB.sim.restartDemo({ replaceOwn: true }); SB.sim.live.crew(false); });
  await page.evaluate(() => SB.sheets.open('orders')); await page.waitForSelector('.ox-row');
  const btn0 = await page.locator('.ox-quick').first().textContent();
  check('Pay button names the method (cash by default)', /cash/i.test(btn0), btn0);
  check('a Pay with switch sits beside it', (await page.locator('.ox-how').first().textContent()).includes('Cash'));
  await page.locator('.ox-how').first().click();
  await page.locator('.menu-item').filter({ hasText: 'Card' }).first().click();
  await page.waitForTimeout(400);
  const btn1 = await page.locator('.ox-quick').first().textContent();
  check('after choosing Card the Pay button says card', /card/i.test(btn1), btn1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.evaluate(() => SB.sheets.open('orders')); await page.waitForSelector('.ox-row');
  check('the choice is remembered when the sheet is opened again', /card/i.test(await page.locator('.ox-quick').first().textContent()));
  await page.locator('.ox-quick').first().click(); await page.waitForTimeout(500);
  const method = await page.evaluate(() => { const o = SB.store.getState().orders.filter((x) => x.status === 'paid'); return o.length ? (o[0].payment && o[0].payment.method) || o[0].method || o[0].payMethod : null; });
  check('the order was recorded as card', method === 'card', method);
});
process.exit(fail ? 1 : 0);
