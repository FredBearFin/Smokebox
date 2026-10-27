/*
 * WHAT THIS FILE IS: Browser check that, once a manager PIN is set, changing it, making a new recovery code and Start over all ask for
 * the current PIN first (the keypad), and that setPin refuses without proof. Also the Start over backup steps need the saved-file tick.
 * USES: tools/pw.mjs, dist/smokebox.html. RUN: node test/pin-guard.e2e.mjs
 */
import { withPage } from '../tools/pw.mjs';
let fails = 0;
// Records one check result and prints it.
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
// Types four digits on the PIN keypad.
async function keypad(page, pin) { await page.waitForSelector('.keypad'); for (const d of pin) await page.locator('.keypad button', { hasText: new RegExp('^' + d + '$') }).first().click(); await page.waitForTimeout(400); }
await withPage({ w: 1024, h: 800 }, async (page, logs) => {
  await page.evaluate(() => SB.store.dispatchEx('addMenuItem', { name: 'Chili', price: 6 }, { source: 'ui' }));
  // One real ticket, so Start over keeps its careful steps (an empty kitchen gets a one-step confirm instead).
  await page.evaluate(() => { const id = SB.store.dispatchEx('addMenuItem', { name: 'Soup', zone: 'sides', cat: 'side', price: 5, prepSec: 60, track: 'one' }, { source: 'ui' }).info.id; SB.store.dispatchEx('createTicket', { customer: 'Ann', items: [{ menuId: id, qty: 1 }] }, { source: 'ui' }); });
  const menuBefore = await page.evaluate(() => SB.store.getState().menu.length);
  const first = await page.evaluate(async () => (await SB.shell.setPin('1234')).ok);
  ok(first === true, 'with no PIN, setting one needs nothing');
  const bare = await page.evaluate(async () => (await SB.shell.setPin('0000')).report);
  ok(bare === 'pinRequired', 'setPin refuses to change an existing PIN without proof: ' + bare);
  ok(await page.evaluate(() => SB.shell.checkPin('1234')), 'the old PIN still works after the refusal');
  // the floor sheet asks for the current PIN
  await page.evaluate(() => SB.sheets.open('shop')); await page.waitForSelector('[aria-label="Manager PIN, 4 digits"]');
  await page.fill('[aria-label="Manager PIN, 4 digits"]', '0000'); await page.getByRole('button', { name: 'Set PIN' }).click();
  await page.waitForSelector('.keypad');
  ok(true, 'Set PIN with a PIN already set opens the keypad first');
  await page.getByRole('button', { name: 'Cancel' }).last().click(); await page.waitForTimeout(400);
  ok(await page.evaluate(() => SB.shell.checkPin('1234')) && !(await page.evaluate(() => SB.shell.checkPin('0000'))), 'cancelling the keypad leaves the PIN as it was');
  await page.getByRole('button', { name: 'Set PIN' }).click(); await keypad(page, '1234');
  await page.waitForSelector('.rc-code', { timeout: 5000 });
  ok(await page.evaluate(() => SB.shell.checkPin('0000')), 'with the right current PIN the new PIN is saved, and a recovery code is shown');
  await page.evaluate(() => SB.sheets.closeAll());
  // Start over asks for the PIN
  await page.evaluate(() => SB.sheets.open('startover')); await page.waitForSelector('.keypad');
  ok(await page.locator('[data-act="so-next1"]').count() === 0, 'Start over: the keypad comes first, the sheet is not open');
  await page.getByRole('button', { name: 'Cancel' }).last().click(); await page.waitForTimeout(400);
  const left = await page.evaluate(() => SB.store.getState().menu.length); ok(await page.locator('[data-act="so-next1"]').count() === 0 && left === menuBefore, 'cancelled: nothing opened, nothing erased (dishes: ' + left + ', sheets: ' + await page.locator('[data-act="so-next1"]').count() + ')');
  await page.evaluate(() => SB.sheets.open('startover')); await keypad(page, '0000');
  await page.waitForSelector('[data-act="so-next1"]');
  ok(true, 'the right PIN opens Start over');
  await page.click('[data-act="so-next1"]');
  ok(await page.locator('[data-act="so-next2"]').isDisabled(), 'the backup step holds Next until the file is saved and ticked');
});
process.exit(fails ? 1 : 0);
