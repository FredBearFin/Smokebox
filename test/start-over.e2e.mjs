// Quick browser check (about 15 s) of "Start over with an empty menu": it lives at the bottom of the Menu sheet, explains what goes and
// what stays, makes the owner save a backup (or say they have one), needs the typed word, empties the kitchen, keeps or resets tax and
// hours as chosen, and lands on the first-run screen. In the demo the Menu sheet offers the way back instead.
import { withPage } from '../tools/pw.mjs';
let bad = 0;
const check = (n, ok, x) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(x))); if (!ok) bad++; };
const SHOT = process.env.SHOTDIR || '/tmp';
await withPage({ w: 1280, h: 800, touch: true }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  await page.evaluate(() => {
    ['Pulled pork plate', 'Sweet tea'].forEach((n, i) => SB.store.dispatchEx('addMenuItem', { name: n, zone: i ? 'cold' : 'pit', cat: i ? 'cold' : 'meat', price: 10, prepSec: 120, track: 'two' }, { source: 'ui' }));
    SB.store.dispatchEx('updateSettings', { patch: { service: { taxRatePct: 6 } } }, { source: 'ui' });
    // One real ticket: with something real to lose, Start over keeps its three careful steps.
    SB.store.dispatchEx('createTicket', { customer: 'Ann', items: [{ menuId: SB.store.getState().menu[0].id, qty: 1 }] }, { source: 'ui' });
  });
  await page.waitForTimeout(500);
  await page.click('.fl-menu'); await page.waitForTimeout(400);
  check('Start over is in the Menu sheet, apart from the everyday links', await page.getByRole('button', { name: /Start over with an empty menu/ }).isVisible());
  await page.getByRole('button', { name: /Start over with an empty menu/ }).click(); await page.waitForTimeout(500);
  check('step 1 says what goes and what stays, and that it cannot be undone', /This goes/.test(await page.locator('.so').innerText()) && /cannot be undone/i.test(await page.locator('.so').innerText()) && !/sorry/i.test(await page.locator('.so').innerText()));
  check('the keep box starts ticked', await page.locator('#so-keep').isChecked());
  await page.screenshot({ path: SHOT + '/startover-1.png' });
  await page.click('[data-act=so-next1]');
  check('step 2 explains the automatic backup and nothing is erased yet', /backup/i.test(await page.locator('.so').innerText()) && (await page.evaluate(() => SB.store.getState().menu.length)) === 2);
  await page.screenshot({ path: SHOT + '/startover-2.png' });
  check('step 2: Next is off and the tick box is off until the backup is saved', await page.locator('[data-act=so-next2]').isDisabled() && await page.locator('#so-saw').isDisabled());
  const dl0 = page.waitForEvent('download', { timeout: 5000 });
  await page.click('[data-act=so-save-backup]'); const dwn0 = await dl0;
  check('Save my backup file now downloads a before-start-over file, with nothing erased yet', /before-start-over.*\.json$/.test(dwn0.suggestedFilename()) && (await page.evaluate(() => SB.store.getState().menu.length)) === 2);
  check('after saving, Next is still off until the person says they can find the file', await page.locator('[data-act=so-next2]').isDisabled() && await page.locator('#so-saw').isEnabled());
  await page.check('#so-saw'); check('ticking "I saved the backup file" turns Next on', await page.locator('[data-act=so-next2]').isEnabled());
  await page.click('[data-act=so-next2]');
  const WORD = await page.evaluate(() => SB.store.START_OVER_WORD);
  check('the screen asks for the store\'s own confirm word (' + WORD + ')', (await page.locator('.so').innerText()).includes(WORD));
  check('step 3: the red button is off until the word is typed', await page.locator('[data-act=so-go]').isDisabled());
  await page.fill('.so input.input', WORD.slice(0, 3).toLowerCase()); check('a part of the word is not enough', await page.locator('[data-act=so-go]').isDisabled());
  await page.fill('.so input.input', WORD.toLowerCase()); check('the word, in any case, switches it on', await page.locator('[data-act=so-go]').isEnabled());
  await page.screenshot({ path: SHOT + '/startover-3.png' });
  const dl = page.waitForEvent('download', { timeout: 5000 });
  await page.click('[data-act=so-go]'); const dwn = await dl; await page.waitForTimeout(600);
  check('the backup downloads from the same click that erases', /\.json$/.test(dwn.suggestedFilename()));
  const s = await page.evaluate(() => { const st = SB.store.getState(); return { dishes: st.menu.filter((m) => !m.archived).length, tax: st.settings.service.taxRatePct, blank: SB.store.isBlank() }; });
  check('everything is erased and the tax stayed (box was ticked)', s.dishes === 0 && s.tax === 6 && s.blank, s);
  check('the done screen says so and offers the first screen', /Done/.test(await page.locator('.so').innerText()) && await page.locator('[data-act=so-finish]').isVisible());
  await page.screenshot({ path: SHOT + '/startover-done.png' });
  await page.click('[data-act=so-finish]'); await page.waitForTimeout(500);
  check('back on the empty first screen', await page.locator('.fl-first-dish').isVisible());
  // Second time: untick the keep box.
  await page.evaluate(() => { SB.store.dispatchEx('updateSettings', { patch: { service: { taxRatePct: 8 } } }, { source: 'ui' }); SB.store.dispatchEx('addMenuItem', { name: 'Tea', zone: 'cold', cat: 'cold', price: 3, prepSec: 60, track: 'one' }, { source: 'ui' }); });
  await page.waitForTimeout(400);
  // Second time the kitchen has only a dish: one plain confirm, no backup file and no typed word.
  await page.evaluate(() => SB.sheets.open('startover')); await page.waitForTimeout(400);
  check('a kitchen with only dishes gets one step: no backup, no typed word', await page.locator('[data-act=so-quick]').isVisible() && (await page.locator('[data-act=so-next1]').count()) === 0);
  let downloaded = false; page.once('download', () => { downloaded = true; });
  await page.locator('#so-keep').uncheck(); await page.click('[data-act=so-quick]'); await page.waitForTimeout(600);
  check('with the box unticked the tax goes back to its start', await page.evaluate(() => SB.store.getState().settings.service.taxRatePct === 0));
  check('the one step empties the menu without forcing a download', !downloaded && (await page.evaluate(() => SB.store.getState().menu.length)) === 0 && await page.locator('[data-act=so-finish]').isVisible());
  // Old demo tickets in real reports: a small card with a plain count, Clear them and Keep them.
  await page.evaluate(() => { SB.store.dispatchEx('addMenuItem', { name: 'Soup', zone: 'sides', cat: 'side', price: 5, prepSec: 60, track: 'one' }, { source: 'ui' }); const id = SB.store.getState().menu.find((m) => m.name === 'Soup').id; SB.store.dispatchEx('createTicket', { customer: 'Demo', src: 'demo', items: [{ menuId: id, qty: 1 }] }, { source: 'ui' }); });
  await page.waitForTimeout(400);
  const offer = await page.evaluate(() => SB.store.demoLeftovers().offer);
  await page.evaluate(() => { SB.sheets.closeAll(); }); await page.waitForTimeout(300);
  await page.click('.fl-menu'); await page.waitForTimeout(400);
  check('the old-demo card shows with a plain count when there is something to clear (offer ' + offer + ')', offer === true && await page.locator('[data-act=demo-leftovers]').isVisible() && /1 ticket/.test(await page.locator('[data-act=demo-leftovers]').innerText()));
  await page.screenshot({ path: SHOT + '/leftovers-card.png' });
  await page.click('[data-act=leftovers-clear]'); await page.waitForTimeout(400);
  check('Clear them removes the demo tickets and says so', (await page.evaluate(() => SB.store.demoLeftovers().tickets)) === 0 && /Cleared 1 ticket/.test(await page.locator('[data-act=demo-leftovers]').innerText()));
  await page.evaluate(() => { const id = SB.store.getState().menu.find((m) => m.name === 'Soup').id; SB.store.dispatchEx('createTicket', { customer: 'Demo', src: 'demo', items: [{ menuId: id, qty: 1 }] }, { source: 'ui' }); SB.sheets.closeAll(); }); await page.waitForTimeout(400);
  await page.click('.fl-menu'); await page.waitForTimeout(400);
  await page.click('[data-act=leftovers-keep]'); await page.waitForTimeout(300);
  check('Keep them remembers the choice: the card does not come back', !(await page.evaluate(() => SB.store.demoLeftovers().offer)));
  check('no page errors', logs.pageErrors.length === 0, logs.pageErrors);
});
await withPage({ w: 1280, h: 800, hash: '?demo' }, async (page) => {
  await page.waitForFunction(() => window.SB && SB.booted === true); await page.waitForTimeout(400);
  await page.click('.fl-menu'); await page.waitForTimeout(400);
  check('in the demo the Menu sheet has Back to my kitchen and no Start over', await page.getByRole('button', { name: /Back to my kitchen/ }).count() >= 1 && (await page.getByRole('button', { name: /Start over with an empty menu/ }).count()) === 0);
});
process.exit(bad ? 1 : 0);
