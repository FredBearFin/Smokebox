// Quick browser check (about 15 s) of the first-run flow: the empty board with one "Add my menu" button, the
// Dishes and prices form (name, price, station tile, save and add another, remembered station, More options), editing
// and removing a dish, the example menu fold, the Tax, hours and PIN sheet, no "New tablet?" toast, and that closing the
// tab and coming back loses nothing. A brand-new install is blank once the blank-start data work is merged; before that
// this test archives the old sample dishes first, which gives the same "no dishes" state.
import { withPage } from '../tools/pw.mjs';
let bad = 0;
const check = (n, ok, x) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(x))); if (!ok) bad++; };
const SHOT = process.env.SHOTDIR || '/tmp';
await withPage({ w: 1280, h: 800, touch: true }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  // Reaches the blank first-run state whichever way this build starts (blank, or with old sample dishes to archive).
  await page.evaluate(() => { SB.store.getState().menu.filter((m) => !m.archived).forEach((m) => SB.store.dispatchEx('updateMenuItem', { id: m.id, patch: { archived: true } }, { source: 'ui' })); });
  await page.waitForTimeout(500);
  check('first run shows one big Add my menu button', await page.locator('.fl-first-dish').isVisible());
  check('no welcome card and no demo tickets on first run', !(await page.locator('.fl-welcome').isVisible()) && (await page.evaluate(() => SB.store.getState().tickets.length)) === 0);
  await page.screenshot({ path: SHOT + '/first-run.png' });
  check('New ticket with no dishes opens Dishes and prices', await (async () => { await page.click('.fl-new'); await page.waitForTimeout(300); return page.locator('.sheet:has-text("Dishes and prices")').isVisible(); })());
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  await page.click('.fl-first-dish'); await page.waitForTimeout(300);
  const dp = page.locator('.sheet:has-text("Dishes and prices")');
  check('the form opens', await dp.isVisible());
  // A dish with no station is refused with a plain message.
  await page.fill('.dp-name', 'Pulled pork plate'); await page.fill('.dp-price', '12.50');
  await page.click('[data-act=save-again]');
  check('tap-where-it-is-made message when no station is chosen', await page.locator('.dp-tiles ~ .field-error:visible').count() === 1 && (await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).length)) === 0);
  await page.click('.dp-tile[data-zone=pit]'); await page.click('[data-act=save-again]'); await page.waitForTimeout(200);
  const d1 = await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived));
  check('first dish saved with its station, guessed prep time and price', d1.length === 1 && d1[0].zone === 'pit' && d1[0].price === 12.5 && d1[0].prepSec === 300 && d1[0].prepConfirmed === false, d1);
  // The cooked-ahead question is Yes, No or Not sure (no Skip); Not sure counts as No and says what turning it on adds.
  check('the cook-ahead question offers Yes, No and Not sure', await page.locator('.dp-ca [data-act=add-cooked]').isVisible() && await page.locator('.dp-ca [data-act=no-cooked]').isVisible() && await page.locator('.dp-ca [data-act=notsure-cooked]').isVisible() && !(await page.locator('[data-act=skip-cooked]').count()));
  await page.click('.dp-ca [data-act=notsure-cooked]'); await page.waitForTimeout(250);
  check('Not sure leaves it off and says what turning it on adds and where', /Not sure counts as No/.test(await page.locator('.dp-ca').innerText()) && /Settings, Tax, hours and PIN/.test(await page.locator('.dp-ca').innerText()) && (await page.evaluate(() => SB.engine.moduleOn(SB.store.getState(), 'cookAhead'))) === false);
  await page.evaluate(() => localStorage.removeItem('smokebox.v1.setup.cookAheadSkipped'));
  check('the station choice is remembered and the name box is empty', (await page.locator('.dp-tile[aria-checked=true]').getAttribute('data-zone')) === 'pit' && (await page.inputValue('.dp-name')) === '');
  await page.fill('.dp-name', 'Mac and cheese'); await page.fill('.dp-price', '4.5'); await page.click('.dp-tile[data-zone=sides]'); await page.click('[data-act=save-again]');
  await page.fill('.dp-name', 'Sweet tea'); await page.fill('.dp-price', '$3'); await page.click('.dp-tile[data-zone=cold]');
  await page.screenshot({ path: SHOT + '/dishes-form.png' });
  await page.click('[data-act=save-done]'); await page.waitForTimeout(400);
  const d3 = await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).map((m) => [m.name, m.zone, m.cat, m.track]));
  check('three dishes saved with the right category and tap style', d3.length === 3 && d3[2][2] === 'cold' && d3[2][3] === 'one' && d3[1][2] === 'sandwich', d3);
  check('a duplicate name is refused', await (async () => { await page.waitForTimeout(600); await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(500); await page.fill('.dp-name', 'sweet tea'); await page.fill('.dp-price', '3'); await page.click('.dp-tile[data-zone=cold]'); await page.click('[data-act=save-again]'); const c = await page.locator('.dp-form .field-error:visible').count(); if (!c) console.log(await page.evaluate(() => JSON.stringify({ sheets: document.querySelectorAll('.sheet').length, forms: document.querySelectorAll('.dp-form').length, name: document.querySelector('.dp-name').value, status: document.querySelector('.dp-status').textContent, errs: [...document.querySelectorAll('.field-error')].map((e) => e.hidden + e.textContent) }))); return c > 0; })());
  // Edit a price in the list; remove a dish.
  await page.fill('.dp-name', ''); await page.fill('.dp-price', '');
  await page.locator('.dp-rp').first().fill('13'); await page.locator('.dp-rp').first().blur(); await page.waitForTimeout(300);
  check('a price edited in the list is saved', (await page.evaluate(() => SB.store.getState().menu.find((m) => m.name === 'Pulled pork plate').price)) === 13);
  // Generous prices: "12,50" is read back as $12.50 before saving; a category can be changed from the dish row.
  await page.fill('.dp-price', '12,50');
  check('a typed price is read back before saving', /Reads as \$12\.50/.test(await page.locator('.dp-echo').textContent()));
  await page.fill('.dp-price', '');
  const nameFirst = await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived)[0].name);
  await page.selectOption('[aria-label="Section of ' + nameFirst + '"]', 'cold'); await page.waitForTimeout(300);
  check('Move to: the category of a dish changes from its row', await page.evaluate((n) => SB.store.getState().menu.find((m) => m.name === n).cat === 'cold', nameFirst));
  // Menu sections: the add form shows a Menu section list; Change menu sections renames one, marks one Not used (undoable) and adds one.
  check('the add form has a Menu section list', await page.locator('.dp-menusec').isVisible());
  await page.locator('.dp-catfold summary').click();
  await page.fill('[aria-label="Name of section Mains"]', 'Plates'); await page.locator('[aria-label="Name of section Mains"]').blur(); await page.waitForTimeout(300);
  check('a renamed section shows in the list and is saved in the shared names', (await page.locator('.dp-menusec option', { hasText: 'Plates' }).count()) === 1 && JSON.stringify(await page.evaluate(() => SB.config.customSpec())).includes('Plates'));
  await page.locator('.dp-catrow-x, .dp-strow:has([aria-label="Name of section Desserts"]) button').first().click(); await page.waitForTimeout(200);
  check('Not used takes a section out of the list', (await page.locator('.dp-menusec option', { hasText: 'Desserts' }).count()) === 0);
  await page.locator('.dp-strow:has([aria-label="Name of section Desserts"]) button').first().click(); await page.waitForTimeout(200);
  check('Use again puts it back', (await page.locator('.dp-menusec option', { hasText: 'Desserts' }).count()) === 1);
  await page.locator('.dp-catfold summary').click();
  // A section picked by hand is remembered for the next dish.
  await page.selectOption('.dp-menusec', 'cold'); await page.fill('.dp-name', 'Section test'); await page.fill('.dp-price', '2'); await page.click('.dp-tile >> nth=0'); await page.click('[data-act=save-again]'); await page.waitForTimeout(250);
  check('the hand-picked section is kept for the next dish', (await page.inputValue('.dp-menusec')) === 'cold');
  await page.evaluate(() => { const m = SB.store.getState().menu.find((x) => x.name === 'Section test'); SB.store.dispatchEx('updateMenuItem', { id: m.id, patch: { archived: true } }, { source: 'ui' }); });
  // Reorder: move the first dish down, check the menu order and the order screen follow, then Undo.
  const names0 = await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).map((m) => m.name));
  await page.getByRole('button', { name: 'Move ' + names0[0] + ' down' }).click(); await page.waitForTimeout(300);
  const names1 = await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).map((m) => m.name));
  check('a dish moves down one place', names1[0] === names0[1] && names1[1] === names0[0], [names0, names1]);
  check('the first dish cannot move up and the last cannot move down', await page.getByRole('button', { name: 'Move ' + names1[0] + ' up' }).isDisabled());
  await page.click('[data-act=undo-remove]'); await page.waitForTimeout(300);
  check('Undo puts the order back', JSON.stringify(await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).map((m) => m.name))) === JSON.stringify(names0));
  check('a refusal is shown in one consistent bad-tone line', await (async () => { await page.fill('.dp-name', names0[0]); await page.fill('.dp-price', '5'); await page.click('.dp-tile >> nth=0'); await page.click('[data-act=save-again]'); await page.waitForTimeout(250); return page.locator('.dp-form .field-error:visible, .dp-form .dp-msg[data-tone=bad]:visible, .dp-back:visible').count().then((c) => c > 0); })());
  await page.fill('.dp-name', ''); await page.fill('.dp-price', '');
  await page.locator('.dp-row').nth(2).getByRole('button', { name: /Remove/ }).click(); await page.waitForTimeout(300);
  check('Remove archives the dish', (await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).length)) === 2);
  // Example menu fold.
  await page.locator('.dp-ways summary').click(); await page.click('[data-act=example-menu]'); await page.waitForTimeout(300);
  const ex = await page.locator('.dp-ex').count();
  check('example dishes are marked Example (some names may collide with old sample dishes)', ex >= 4, ex);
  await page.click('[data-act=example-remove]'); await page.waitForTimeout(300);
  check('one tap removes every example dish', (await page.locator('.dp-ex').count()) === 0 && (await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).length)) === 2);
  // Removed dishes: Undo, Bring it back, and a taken-by-removed name offers to bring the dish back.
  await page.locator('.dp-row').nth(1).getByRole('button', { name: /Remove/ }).click(); await page.waitForTimeout(200);
  check('Remove offers Undo and Undo puts the dish back', await page.locator('[data-act=undo-remove]').isVisible() && await (async () => { await page.click('[data-act=undo-remove]'); await page.waitForTimeout(250); return (await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).length)) === 2; })());
  await page.locator('.dp-row').nth(1).getByRole('button', { name: /Remove/ }).click(); await page.waitForTimeout(200);
  const goneName = await page.evaluate(() => SB.store.getState().menu.filter((m) => m.archived).slice(-1)[0].name);
  await page.fill('.dp-name', goneName); await page.fill('.dp-price', '9'); await page.click('[data-act=save-again]'); await page.waitForTimeout(200);
  check('a name taken by a removed dish offers Bring it back', await page.locator('[data-act=bring-back]').isVisible());
  await page.click('[data-act=bring-back]'); await page.waitForTimeout(250);
  check('Bring it back un-archives the dish at the typed price', await page.evaluate((n) => { const m = SB.store.getState().menu.find((x) => x.name === n); return !!m && !m.archived && m.price === 9; }, goneName));
  // Stations: rename live, hide down to one (the question disappears), show again.
  await page.locator('.dp-stfold summary').click();
  await page.fill('[aria-label="Name of station Kitchen"]', 'Smoker'); await page.locator('[aria-label="Name of station Smoker"], [aria-label="Name of station Kitchen"]').first().blur(); await page.waitForTimeout(300);
  check('a renamed station is saved in the shared names and shown on its tile', (await page.evaluate(() => JSON.stringify(SB.config.customSpec()))).includes('Smoker') && await page.locator('.dp-tile:has-text("Smoker")').count() === 1);
  await page.screenshot({ path: SHOT + '/stations-three.png' });
  for (const nm of ['Prep', 'Fryer']) { await page.locator('.dp-strow:has([aria-label="Name of station ' + nm + '"]) button').click(); await page.waitForTimeout(150); }
  check('a station marked Not used loses its board tab while it has no tickets', await page.evaluate(() => { const b = document.querySelector('.fl-tabs [data-id=sides], [data-id=sides]'); return !b || b.style.display === 'none'; }));
  check('hiding stations leaves tiles for the rest', await page.locator('.dp-tile').count() === 2);
  await page.locator('.dp-strow:has([aria-label="Name of station Cold and drinks"]) button').click(); await page.waitForTimeout(150);
  check('with one station showing the question is skipped', await page.locator('.dp-tile').count() === 1 && !(await page.locator('.dp-tiles').isVisible()));
  await page.fill('.dp-name', 'Test'); await page.fill('.dp-price', '1'); await page.click('[data-act=save-again]'); await page.waitForTimeout(250);
  check('a dish saves with no station tap when only one station shows', await page.evaluate(() => SB.store.getState().menu.some((m) => m.name === 'Test' && !m.archived)));
  await page.screenshot({ path: SHOT + '/station-one.png' });
  await page.locator('.dp-strow:has([aria-label="Name of station Cold and drinks"]) button').click();
  await page.locator('.dp-strow:has([aria-label="Name of station Prep"]) button').click();
  await page.locator('.dp-strow:has([aria-label="Name of station Fryer"]) button').click(); await page.waitForTimeout(150);
  await page.fill('[aria-label="New station name"]', 'Bar'); await page.getByRole('button', { name: 'Add station' }).click(); await page.waitForTimeout(250);
  check('a new station can be added', await page.evaluate(() => SB.config.workZones.length === 5));
  await page.evaluate(() => { SB.store.getState().menu.filter((m) => m.name === 'Test').forEach((m) => SB.store.dispatchEx('updateMenuItem', { id: m.id, patch: { archived: true } }, { source: 'ui' })); });
  // A half-typed dish survives a reload; dishes survive too.
  await page.fill('.dp-name', 'Brisket pl'); await page.waitForTimeout(100);
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.SB && SB.booted === true); await page.waitForTimeout(500);
  check('after a reload the dishes are still there and the board shows the next-step card', (await page.evaluate(() => SB.setup.dishCount())) === 2 && await page.locator('.fl-welcome').isVisible());
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(300);
  check('the half-typed dish name comes back', (await page.inputValue('.dp-name')) === 'Brisket pl');
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(200);
  // The Tax, hours and PIN sheet.
  await page.evaluate(() => SB.sheets.open('shop')); await page.waitForTimeout(300);
  await page.fill('[aria-label="Sales tax percent"]', '6'); await page.getByRole('button', { name: 'Save tax' }).click();
  await page.selectOption('[aria-label="Opens at"]', '10'); await page.selectOption('[aria-label="Closes at"]', '22'); await page.getByRole('button', { name: 'Save hours' }).click(); await page.waitForTimeout(200);
  const sv = await page.evaluate(() => SB.store.getState().settings.service);
  check('tax and hours saved from the Tax, hours and PIN sheet', sv.taxRatePct === 6 && sv.openHour === 10 && sv.closeHour === 22, sv);
  await page.screenshot({ path: SHOT + '/shop.png' });
  await page.locator('.sheet .seg-opt', { hasText: 'Yes' }).click(); await page.waitForTimeout(250);
  check('the cook-ahead question writes the real setting', await page.evaluate(() => SB.store.getState().settings.modules.cookAhead === true));
  // Cooked-ahead food (module on): the question, add Brisket, link it to a dish, then a first batch can be logged.
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(400);
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(500);
  check('with the module on, the cooked-ahead question shows after a dish', await page.locator('.dp-ca [data-act=add-cooked]').isVisible());
  await page.screenshot({ path: SHOT + '/ca-question.png' });
  await page.click('.dp-ca [data-act=add-cooked]'); await page.waitForTimeout(400);
  await page.fill('.sheet:has-text("Cooked-ahead food") .dp-name', 'Brisket');
  check('the grams boxes start empty and off until a dish is ticked', (await page.locator('.sheet:has-text("Cooked-ahead food") [aria-label^="Grams of it in one"]').evaluateAll((els) => els.every((e) => e.value === '' && e.disabled))));
  await page.locator('.sheet:has-text("Cooked-ahead food") .dp-row', { hasText: 'Pulled pork plate' }).locator('input[type=checkbox]').check();
  await page.fill('[aria-label="Grams of it in one Pulled pork plate"]', '150');
  await page.click('[data-act=save-cooked]'); await page.waitForTimeout(400);
  const ca = await page.evaluate(() => { const s = SB.store.getState(); const i = s.ingredients.find((x) => x.name === 'Brisket'); const d = s.menu.find((m) => m.name === 'Pulled pork plate'); return { ing: i && [i.tcs, i.hold, i.maxHoldH], bom: d && d.bom }; });
  check('Brisket is added as cooked-ahead (hot, 4 h) and linked to the dish', ca.ing && ca.ing[0] === true && ca.ing[1] === 'hot' && ca.ing[2] === 4 && ca.bom.length === 1 && ca.bom[0].qty === 150, ca);
  check('the hot item shows the hours box unchanged and has an Edit button in the Dishes list', await page.evaluate(() => SB.store.getState().ingredients.find((i) => i.name === 'Brisket').maxHoldH === 4) && true);
  await page.screenshot({ path: SHOT + '/ca-added.png' });
  await page.click('[data-act=log-first-batch]'); await page.waitForTimeout(600);
  check('Log a first batch opens the cabinet on the new batch form with Brisket', await page.locator('.hc-form .hc-prod').isVisible() && await page.locator('.hc-form .hc-prod:has-text("Brisket")').count() === 1);
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(400);
  // The later steps use a dish called Coleslaw: make sure it is on the menu (the example menu once supplied it).
  await page.evaluate(() => { const s = SB.store.getState(); const have = s.menu.find((x) => x.name === 'Coleslaw'); if (!have) SB.store.dispatchEx('addMenuItem', { name: 'Coleslaw', zone: 'cold', cat: 'cold', price: 3, prepSec: 60, track: 'one' }, { source: 'ui' }); else if (have.archived) SB.store.dispatchEx('updateMenuItem', { id: have.id, patch: { archived: false } }, { source: 'ui' }); });
  await page.waitForTimeout(300);
  // A cold item end to end: set up with days and hours out, make a batch, Take out, Put back, Undo (A1's cabinet card).
  await page.evaluate(() => SB.sheets.open('cookahead')); await page.waitForTimeout(400);
  const csh = '.sheet:has-text("Cooked-ahead food")';
  await page.locator(csh + ' .seg-opt', { hasText: 'Cold' }).click(); await page.fill(csh + ' .dp-name', 'Chicken salad');
  await page.fill(csh + ' [aria-label="How many days may it stay in the fridge?"]', '3'); await page.fill(csh + ' [aria-label="How many hours may it be out of the fridge?"]', '2');
  await page.locator(csh + ' .dp-row').first().locator('input[type=checkbox]').check(); await page.fill(csh + ' [aria-label^="Grams of it in one"]:enabled >> nth=0', '150'); await page.click('[data-act=save-cooked]'); await page.waitForTimeout(500);
  const cold = await page.evaluate(() => { const i = SB.store.getState().ingredients.find((x) => x.name === 'Chicken salad'); return i && { hold: i.hold, fridge: i.fridge, d: i.fridgeDays, o: i.outHours }; });
  check('the cold item is saved as kept in a fridge with 3 days and 2 hours out', cold && cold.hold === 'cold' && cold.fridge === true && cold.d === 3 && cold.o === 2, cold);
  await page.click('[data-act=log-first-batch]'); await page.waitForTimeout(600); await page.click('.hc-add'); await page.waitForTimeout(500);
  const bt = await page.evaluate(() => SB.store.getState().batches.find((b) => b.ing === 'chicken_salad'));
  check('the batch copies the limits and the made-on date', bt && bt.place === 'fridge' && bt.fridgeDays === 3 && bt.outHours === 2 && /^\d{4}-\d\d-\d\d$/.test(bt.madeOn), bt);
  await page.locator('.sheet .seg-opt', { hasText: 'In the cabinet' }).click(); await page.waitForTimeout(400);
  const card = await page.locator('.hc-card, .sheet').first().innerText();
  check('the cabinet card shows the fridge date and the out-of-fridge limit', /Fridge date/.test(card) && /limit out of the fridge is 2/.test(card));
  await page.locator('[data-act=take-out]:visible').first().click(); await page.waitForTimeout(400);
  if (await page.locator('.sheet:has-text("Who is this")').count()) { await page.fill('.sheet:has-text("Who is this") input', 'JM'); await page.locator('.sheet:has-text("Who is this") button.btn-primary').click(); await page.waitForTimeout(500); }
  check('Take out starts the out-of-fridge clock (Put back appears)', await page.locator('[data-act=put-back]:visible').count() === 1 && (await page.evaluate(() => SB.store.getState().batches.find((b) => b.ing === 'chicken_salad').place)) !== 'fridge');
  await page.locator('[data-act=put-back]:visible').first().click(); await page.waitForTimeout(500);
  if (await page.locator('.sheet:has-text("Who is this")').count()) { await page.fill('.sheet:has-text("Who is this") input', 'JM'); await page.locator('.sheet:has-text("Who is this") button.btn-primary').click(); await page.waitForTimeout(500); }
  check('Put back returns it to the fridge', (await page.evaluate(() => SB.store.getState().batches.find((b) => b.ing === 'chicken_salad').place)) === 'fridge');
  await page.getByRole('button', { name: 'Undo' }).last().click(); await page.waitForTimeout(500);
  check('Undo puts it back out again (the last move is undone)', (await page.evaluate(() => SB.store.getState().batches.find((b) => b.ing === 'chicken_salad').place)) !== 'fridge');
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(400);
  // Portions on hand for a dish that lists no ingredients.
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(500);
  const macRow = page.locator('.dp-row:has(input[aria-label="Name of Coleslaw"])').first();
  await macRow.locator('.dp-por summary').click(); await macRow.locator('.dp-por input').fill('20'); await macRow.getByRole('button', { name: 'Start counting' }).click(); await page.waitForTimeout(400);
  check('portions on hand: the dish row shows 20 left', await page.locator('.dp-row:has(input[aria-label="Name of Coleslaw"])').first().locator('.dp-left').textContent().then((x) => /20 left/.test(x)));
  await page.locator('.dp-row:has(input[aria-label="Name of Coleslaw"])').first().getByRole('button', { name: '+10' }).click(); await page.waitForTimeout(400);
  check('+10 restocks to 30 left', await page.locator('.dp-row:has(input[aria-label="Name of Coleslaw"])').first().locator('.dp-left').textContent().then((x) => /30 left/.test(x)));
  await page.locator('.dp-row:has(input[aria-label="Name of Coleslaw"])').first().getByRole('button', { name: 'Stop counting' }).click(); await page.waitForTimeout(300);
  check('Stop counting offers Undo', await page.locator('[data-act=undo-remove]').isVisible());
  await page.click('[data-act=undo-remove]'); await page.waitForTimeout(400);
  check('Undo brings the count back with the 30 that were left', await page.locator('.dp-row:has(input[aria-label="Name of Coleslaw"])').first().locator('.dp-left').textContent().then((x) => /30 left/.test(x)));
  check('the hidden "Portions of" ingredient is not shown anywhere in the sheet', !(await page.locator('.sheet').first().innerText()).includes('Portions of Coleslaw'));
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  await page.evaluate(() => SB.sheets.open('shop')); await page.waitForTimeout(400);
  await page.locator('.sheet .seg-opt', { hasText: 'No' }).click(); await page.waitForTimeout(250);
  check('cook-ahead can be turned back off', await page.evaluate(() => SB.store.getState().settings.modules.cookAhead === false));
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(9500);
  check('no "New tablet?" toast arrives after about 8 seconds', !(await page.evaluate(() => document.body.innerText.includes('New tablet?'))));
  check('the main menu has a Dishes and prices entry', await (async () => { await page.evaluate(() => SB.sheets.open('menu')); await page.waitForTimeout(300); return page.getByRole('button', { name: /Dishes and prices/ }).isVisible(); })());
  // The first-steps card goes for good once a ticket exists, even if the board is cleared again.
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(200);
  await page.evaluate(() => { const id = SB.store.getState().menu.find((m) => m.name === 'Coleslaw').id; SB.store.dispatchEx('createTicket', { customer: 'T', items: [{ menuId: id, qty: 1 }] }, { source: 'ui' }); });
  await page.waitForTimeout(300);
  check('the first-steps card is gone once a ticket exists', !(await page.locator('.fl-welcome').isVisible()));
  await page.evaluate(() => SB.store.resetLive({ keepSettings: true, starter: false })); await page.waitForTimeout(400);
  check('and it does not come back when the board is cleared', !(await page.locator('.fl-welcome').isVisible()));
  check('no page errors', logs.pageErrors.length === 0, logs.pageErrors);
});
process.exit(bad ? 1 : 0);
