// Quick browser check (about 15 s) of the cold-item boxes in the Cooked-ahead food form: Cold shows "How many days may it stay in the fridge?"
// and "How many hours may it be out of the fridge?" (both optional, blank means no limit set), Hot keeps the hours box, bad numbers are
// refused in plain words, the limits are saved on the item, and the same form edits them later. No numbers are suggested.
import { withPage } from '../tools/pw.mjs';
let bad = 0;
const check = (n, ok, x) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(x))); if (!ok) bad++; };
const SHOT = process.env.SHOTDIR || '/tmp';
const item = (page, name) => page.evaluate((n) => { const i = SB.store.getState().ingredients.find((x) => x.name === n); return i && { hold: i.hold, tcs: i.tcs, days: i.fridgeDays, out: i.outHours, maxHoldH: i.maxHoldH }; }, name);
await withPage({ w: 1280, h: 800, touch: true }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  await page.evaluate(() => { SB.store.dispatchEx('updateSettings', { patch: { modules: { cookAhead: true } } }, { source: 'ui' }); SB.store.dispatchEx('addMenuItem', { name: 'Potato salad plate', zone: 'cold', cat: 'cold', price: 5, prepSec: 60, track: 'one' }, { source: 'ui' }); });
  await page.waitForTimeout(400);
  await page.evaluate(() => SB.sheets.open('cookahead')); await page.waitForTimeout(400);
  const sheet = '.sheet:has-text("Cooked-ahead food")';
  check('Hot is the start: the hours box shows, the fridge boxes do not', await page.locator(sheet + ' [aria-label="How long may it stay, in hours?"]').isVisible() && !(await page.locator(sheet + ' [aria-label="How many days may it stay in the fridge?"]').isVisible()));
  await page.locator(sheet + ' .seg-opt', { hasText: 'Cold' }).click(); await page.waitForTimeout(200);
  check('Cold shows the two fridge boxes and hides the hot hours box', await page.locator(sheet + ' [aria-label="How many days may it stay in the fridge?"]').isVisible() && await page.locator(sheet + ' [aria-label="How many hours may it be out of the fridge?"]').isVisible() && !(await page.locator(sheet + ' [aria-label="How long may it stay, in hours?"]').isVisible()));
  const text = await page.locator(sheet).innerText();
  check('the one-line note names the health department and suggests no numbers', /Use the limits your local health department gives you/.test(text) && /no limit set/.test(text) && !/\b(3|7|41|135) (days|hours)\b/.test(text));
  await page.screenshot({ path: SHOT + '/cold-form.png' });
  await page.fill(sheet + ' .dp-name', 'Potato salad');
  await page.fill(sheet + ' [aria-label="How many days may it stay in the fridge?"]', '2.5'); await page.click('[data-act=save-cooked]'); await page.waitForTimeout(250);
  check('days that are not a whole number are refused in plain words', /whole number of days/.test(await page.locator(sheet).innerText()));
  await page.fill(sheet + ' [aria-label="How many days may it stay in the fridge?"]', '3'); await page.fill(sheet + ' [aria-label="How many hours may it be out of the fridge?"]', 'abc'); await page.click('[data-act=save-cooked]'); await page.waitForTimeout(250);
  check('hours that are not a number are refused in plain words', /hours from 0.25 to 24/.test(await page.locator(sheet).innerText()));
  await page.fill(sheet + ' [aria-label="How many hours may it be out of the fridge?"]', '2');
  await page.locator(sheet + ' .dp-row', { hasText: 'Potato salad plate' }).locator('input[type=checkbox]').check();
  await page.fill(sheet + ' [aria-label="Grams of it in one Potato salad plate"]', '150');
  await page.click('[data-act=save-cooked]'); await page.waitForTimeout(500);
  let it = await item(page, 'Potato salad');
  check('a cold item is saved with its fridge days and hours out', it && it.hold === 'cold' && it.days === 3 && it.out === 2, it);
  // Blank limits: a second cold item with nothing entered.
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  await page.evaluate(() => SB.sheets.open('cookahead')); await page.waitForTimeout(400);
  await page.locator(sheet + ' .seg-opt', { hasText: 'Cold' }).click(); await page.fill(sheet + ' .dp-name', 'Coleslaw');
  await page.click('[data-act=save-cooked]'); await page.waitForTimeout(250); await page.click('[data-act=save-cooked]'); await page.waitForTimeout(500);
  it = await item(page, 'Coleslaw');
  check('blank limits are accepted and mean no limit set', it && it.hold === 'cold' && it.days == null && it.out == null, it);
  // Editing later from the Dishes sheet.
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(400);
  check('the list says "no limit set" for the item with none', /Cold, no limit set/.test(await page.locator('.dp-ca').innerText()));
  await page.locator('.dp-ca .dp-row', { hasText: 'Coleslaw' }).locator('[data-act=edit-cooked]').click(); await page.waitForTimeout(400);
  const edit = '.sheet:has-text("Edit cooked-ahead food")';
  check('Edit opens the same boxes, filled in, with hot or cold fixed', await page.locator(edit).isVisible() && (await page.inputValue(edit + ' .dp-name')) === 'Coleslaw' && await page.locator(edit + ' [aria-label="How many days may it stay in the fridge?"]').isVisible());
  await page.screenshot({ path: SHOT + '/cold-edit.png' });
  await page.fill(edit + ' [aria-label="How many days may it stay in the fridge?"]', '4'); await page.click('[data-act=save-cooked-edit]'); await page.waitForTimeout(900);
  it = await item(page, 'Coleslaw');
  check('editing saves the new fridge days', it && it.days === 4, it);
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(400);
  await page.locator('.dp-ca .dp-row', { hasText: 'Coleslaw' }).locator('[data-act=edit-cooked]').click(); await page.waitForTimeout(400);
  await page.fill(edit + ' [aria-label="How many days may it stay in the fridge?"]', ''); await page.click('[data-act=save-cooked-edit]'); await page.waitForTimeout(900);
  it = await item(page, 'Coleslaw');
  check('clearing a box goes back to no limit set', it && it.days == null, it);
  check('no page errors', logs.pageErrors.length === 0, logs.pageErrors);
});
process.exit(bad ? 1 : 0);
