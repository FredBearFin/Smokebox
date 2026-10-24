// Quick browser check (about 15 s) of "How you serve" (Menu, then How you serve): counter service on or off, the order buttons
// (rename, reorder, add, remove, reset, limit of 12) and the currency symbol, each saved at once with Undo, plus the optional
// "How do you serve?" question under the dishes.
import { withPage } from '../tools/pw.mjs';
let bad = 0;
const check = (n, ok, x) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(x))); if (!ok) bad++; };
const SHOT = process.env.SHOTDIR || '/tmp';
const svc = (page) => page.evaluate(() => { const s = SB.store.getState().settings; return { counter: !!(s.service || {}).counter, chips: (s.service || {}).chips, cur: (s.ui || {}).currency }; });
await withPage({ w: 1280, h: 800, touch: true }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  await page.evaluate(() => SB.store.dispatchEx('addMenuItem', { name: 'Taco', zone: 'pit', cat: 'meat', price: 3.5, prepSec: 60, track: 'one' }, { source: 'ui' }));
  await page.waitForTimeout(400);
  // The question under the dishes.
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(400);
  check('the How do you serve? question shows after a dish', await page.locator('.dp-serve').isVisible());
  await page.screenshot({ path: SHOT + '/serve-question.png' });
  await page.click('[data-act=serve-counter]'); await page.waitForTimeout(300);
  let s = await svc(page);
  check('Counter service sets counter service on and a counter list of order buttons', s.counter === true && JSON.stringify(s.chips).includes('Phone'), s);
  check('the answer is remembered and the card says where to change it', /Settings, How you serve/.test(await page.locator('.dp-serve').innerText()));
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  // The sheet.
  await page.click('.fl-menu'); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /How you serve/ }).click(); await page.waitForTimeout(400);
  check('Counter service shows as on', await page.locator('.so-serve [role=switch][aria-checked=true], .so-serve input[type=checkbox]:checked').count() >= 1);
  await page.screenshot({ path: SHOT + '/serve-sheet.png' });
  await page.locator('.so-serve [role=switch], .so-serve input[type=checkbox]').first().click(); await page.waitForTimeout(300);
  s = await svc(page); check('turning it off saves', s.counter === false, s);
  await page.click('[data-act=serve-undo]'); await page.waitForTimeout(300);
  s = await svc(page); check('Undo turns it back on', s.counter === true, s);
  // Order buttons.
  await page.fill('[aria-label="New order button name"]', 'Drive up'); await page.click('[data-act=chip-add]'); await page.waitForTimeout(300);
  s = await svc(page); check('a new order button is added at the end', JSON.stringify(s.chips).includes('Drive up'), s);
  await page.fill('[aria-label="New order button name"]', 'drive up'); await page.click('[data-act=chip-add]'); await page.waitForTimeout(250);
  check('a repeated button name is refused in plain words', /already a button/.test(await page.locator('.so-serve').innerText()));
  check('the buttons now in use show as chips', (await page.locator('.so-chips .so-chip', { hasText: 'Drive up' }).count()) === 1);
  check('the switch says On or Off in words', /Counter service: On/.test(await page.locator('.so-serve [role=switch]').first().innerText()));
  await page.getByRole('button', { name: 'Remove Drive up' }).click(); await page.waitForTimeout(300);
  s = await svc(page); check('Remove takes it out', !JSON.stringify(s.chips).includes('Drive up'), s);
  await page.click('[data-act=serve-undo]'); await page.waitForTimeout(300);
  s = await svc(page); check('Undo brings it back', JSON.stringify(s.chips).includes('Drive up'), s);
  await page.click('[data-act=chips-reset]'); await page.waitForTimeout(300);
  s = await svc(page); check('Reset goes back to the starting list', JSON.stringify(s.chips).includes('Table 1') && !JSON.stringify(s.chips).includes('Drive up'), s);
  // The 12 limit.
  for (let i = 0; i < 6; i++) { await page.fill('[aria-label="New order button name"]', 'Extra ' + i); await page.click('[data-act=chip-add]'); await page.waitForTimeout(200); }
  check('there is a plain refusal past 12 buttons', /up to 12/.test(await page.locator('.so-serve').innerText()) || (await svc(page)).chips.length <= 12);
  await page.click('[data-act=chips-reset]'); await page.waitForTimeout(250);
  // Currency.
  await page.getByRole('radio', { name: '€' }).click().catch(async () => { await page.locator('.so-serve .seg-opt', { hasText: '€' }).click(); }); await page.waitForTimeout(300);
  s = await svc(page); check('the currency symbol is saved', JSON.stringify(s.cur).includes('€'), s);
  await page.screenshot({ path: SHOT + '/serve-sheet-2.png' });
  // Counter service end to end: with it on, a paid order leaves no ticket on the board; with it off, the ticket waits for the kitchen.
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  await page.evaluate(() => SB.store.dispatchEx('updateSettings', { patch: { service: { counter: true } } }, { source: 'ui' })); await page.waitForTimeout(300);
  await page.click('.fl-new'); await page.waitForSelector('.ord-tile');
  await page.locator('.ord-tile:not(.is-86)').first().click(); await page.click('.ord-pay [data-id="cash"]'); await page.click('.ord-send'); await page.waitForTimeout(700);
  const paid1 = await page.evaluate(() => { const s = SB.store.getState(); return { orders: s.orders.filter((o) => o.paid || o.status === 'paid').length, active: s.tickets.filter((x) => x.status === 'active').length }; });
  check('with counter service on, a paid order is recorded and its ticket is finished at once', paid1.orders === 1 && paid1.active === 0, paid1);
  check('the board shows no ticket slip for it', (await page.locator('.fl-grid .fl-slip, .fl-grid [data-ticket], .fl-slip').count()) === 0);
  await page.screenshot({ path: SHOT + '/serve-counter-paid.png' });
  await page.evaluate(() => SB.store.dispatchEx('updateSettings', { patch: { service: { counter: false } } }, { source: 'ui' })); await page.waitForTimeout(300);
  await page.click('.fl-new'); await page.waitForSelector('.ord-tile');
  await page.locator('.ord-tile:not(.is-86)').first().click(); await page.click('.ord-pay [data-id="cash"]'); await page.click('.ord-send'); await page.waitForTimeout(700);
  const paid2 = await page.evaluate(() => SB.store.getState().tickets.filter((x) => x.status === 'active').length);
  check('with counter service off, the same order leaves a ticket for the kitchen', paid2 === 1, paid2);
  check('no page errors', logs.pageErrors.length === 0, logs.pageErrors);
});
process.exit(bad ? 1 : 0);
