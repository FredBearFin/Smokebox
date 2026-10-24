// First-time owner simulation: three made-up owners drive the real UI from a blank install to a first paid ticket, making the
// slips and typos real people make. The script records what the screen SAID after each slip (so the words can be read and judged),
// every dead end and error, and screenshots. It cannot judge hesitation by itself: the numbered notes in docs/setup-journey-after.md
// come from reading these logs and shots. Headless Chromium; not real people. Run after building: node ux-scripts/first-time-owners.mjs
import fs from 'node:fs';
import path from 'node:path';
import { withPage, ROOT } from '../tools/pw.mjs';
const OUT = path.join(ROOT, 'docs/ux-shots/night/a2/sim');
fs.mkdirSync(OUT, { recursive: true });
const log = [];
let who = '';
const say = (m) => { log.push(who + ': ' + m); console.log(who + ': ' + m); };
// Reads what the open sheet currently shows as messages, errors and status lines.
const words = (page) => page.evaluate(() => [...document.querySelectorAll('.sheet .field-error, .sheet .dp-msg, .sheet .dp-back, .sheet .fs-note, .toast')].filter((e) => e.getClientRects().length && e.textContent.trim()).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).slice(0, 5));
const shot = (page, n) => page.screenshot({ path: path.join(OUT, who + '-' + n + '.png') });
const ready = (page) => page.waitForFunction(() => window.SB && SB.booted === true);

// Owner 1: a food truck, 5 dishes, never touches tax.
who = 'truck';
await withPage({ w: 1024, h: 768, touch: true }, async (page, logs) => {
  await ready(page); await page.waitForTimeout(500);
  await shot(page, '01-first-open');
  await page.click('.fl-first-dish'); await page.waitForSelector('.dp-form');
  // Slip 1: no name, a European-style price.
  await page.fill('.dp-price', '12,50'); await page.click('[data-act=save-again]'); await page.waitForTimeout(250);
  say('blank name -> ' + JSON.stringify(await words(page)));
  await page.fill('.dp-name', 'Pulled pork sandwich'); await page.click('[data-act=save-again]'); await page.waitForTimeout(250);
  say('no station tapped -> ' + JSON.stringify(await words(page)));
  await page.click('.dp-tile[data-zone=pit]'); await page.click('[data-act=save-again]'); await page.waitForTimeout(250);
  const d1 = await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).map((m) => m.name + ' $' + m.price));
  say('after "12,50" saved as -> ' + JSON.stringify(d1) + '; message: ' + JSON.stringify(await words(page)));
  for (const [nm, pr] of [['Loaded fries', '$7'], ['Hot dog', '6.'], ['Lemonade', 'abc'], ['Lemonade', '1500'], ['Lemonade', '3.5'], ['Hot dog', '4']]) {
    await page.fill('.dp-name', nm); await page.fill('.dp-price', pr);
    if (nm === 'Lemonade' || nm === 'Hot dog') await page.click('.dp-tile[data-zone=' + (nm === 'Lemonade' ? 'cold' : 'fry') + ']');
    else await page.click('.dp-tile[data-zone=fry]');
    await page.click('[data-act=save-again]'); await page.waitForTimeout(250);
    say('"' + nm + '" at "' + pr + '" -> ' + JSON.stringify(await words(page)));
  }
  await page.fill('.dp-name', 'x'.repeat(70)); await page.fill('.dp-price', '5'); await page.click('[data-act=save-again]'); await page.waitForTimeout(250);
  say('70-letter name -> ' + JSON.stringify(await words(page)) + ' (box holds ' + (await page.inputValue('.dp-name')).length + ' letters)');
  await page.fill('.dp-name', 'Brisket taco'); await page.fill('.dp-price', '9');
  // Close the sheet in the middle, then go back to it.
  await page.click('.sheet-close'); await page.waitForTimeout(500);
  say('closed the sheet mid-way; board shows card: ' + (await page.locator('.fl-welcome').isVisible()));
  await page.click('.fl-new'); await page.waitForTimeout(400);
  say('New ticket opens: ' + (await page.evaluate(() => (document.querySelector('.sheet .sheet-title') || {}).textContent)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(400);
  const hist = await page.evaluate(() => history.length);
  await page.goBack().catch(() => {}); await page.waitForTimeout(600);
  say('browser Back with the Dishes sheet open (history length ' + hist + '): app alive ' + (await page.evaluate(() => !!window.SB && SB.booted === true)) + ', sheet still open ' + (await page.locator('.sheet:has-text("Dishes and prices")').count()) + ', url ' + (await page.evaluate(() => location.href.slice(-30))));
  await page.reload({ waitUntil: 'load' }); await ready(page); await page.waitForTimeout(500);
  await page.evaluate(() => SB.sheets.open('dishes')); await page.waitForTimeout(400);
  say('after reload the half-typed name is "' + (await page.inputValue('.dp-name')) + '" and price "' + (await page.inputValue('.dp-price')) + '"');
  await page.click('.dp-tile[data-zone=pit]'); await page.click('[data-act=save-done]'); await page.waitForTimeout(300);
  say('dishes now: ' + (await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).length)));
  await page.click('.fl-new'); await page.waitForSelector('.ord-tile');
  await shot(page, '02-order-screen');
  const tiles = await page.$$('.ord-tile:not(.is-86)'); await tiles[0].click(); await tiles[1].click();
  await page.click('.ord-pay [data-id="cash"]'); await shot(page, '03-before-send');
  say('pay note: ' + (await page.locator('.ord-pay-note').textContent()));
  await page.click('.ord-send'); await page.waitForTimeout(500);
  say('toast after send: ' + JSON.stringify(await words(page)));
  await shot(page, '04-after-send');
  say('page errors: ' + logs.pageErrors.length + ', console errors: ' + logs.errors.length);
});
fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));

// Owner 2: a cafe that cooks nothing ahead. 25 dishes arrive in a spreadsheet CSV with a blank name, a duplicate, a blank price,
// prices typed as "$4.50", "4,50" and "3".
who = 'cafe';
const CAFE = process.env.CAFE_CSV || path.join(ROOT, 'test/fixtures/menu-import/cafe-spreadsheet.csv');
await withPage({ w: 1024, h: 768, touch: true }, async (page, logs) => {
  await ready(page); await page.waitForTimeout(500);
  await page.click('.fl-first-dish'); await page.waitForSelector('.dp-form');
  await page.locator('.dp-ways summary').click();
  say('import link visible after opening "More ways to add dishes": ' + (await page.locator('[data-act=open-import]').isVisible()));
  await page.click('[data-act=open-import]'); await page.waitForTimeout(400);
  await page.setInputFiles('input[type=file]', CAFE); await page.waitForTimeout(600);
  say('format line: ' + (await page.locator('.dp-fmt').textContent()));
  say('rows: ' + (await page.locator('.dp-prow').count()) + ', problem rows: ' + (await page.locator('.dp-prow[data-ok=false]').count()));
  say('problem lines: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.dp-prow')].filter((r) => r.querySelector('.dp-prob').textContent.trim()).map((r) => r.querySelector('input.input').value + ' => ' + r.querySelector('.dp-prob').textContent.trim()))));
  say('stations chosen in the preview: ' + JSON.stringify(await page.evaluate(() => [...new Set([...document.querySelectorAll('.dp-prow select')].map((s) => s.selectedOptions[0].textContent))])));
  await shot(page, '01-import-preview');
  say('file-level notes: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.dp-preview .fs-note')].map((n) => n.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)))));
  // The cafe owner adds the categories from the file, then puts every dish at one station.
  await page.click('[data-act=import-add-cats]'); await page.waitForTimeout(600);
  say('after "Add these categories": ' + JSON.stringify(await words(page)).slice(0, 200) + '; rows ' + (await page.locator('.dp-prow').count()));
  await page.selectOption('[aria-label="Put every dish at this station"]', 'sides'); await page.waitForTimeout(200);
  await shot(page, '01b-preview-after-fixes');
  const go = await page.locator('[data-act=import-go]').textContent();
  say('import button reads: ' + go.trim());
  await page.click('[data-act=import-go]'); await page.waitForTimeout(600);
  const cats = await page.evaluate(() => { const c = {}; SB.store.getState().menu.filter((m) => !m.archived).forEach((m) => { const n = (SB.config.categoryById[m.cat] || {}).name; c[n] = (c[n] || 0) + 1; }); return c; });
  say('categories the imported dishes landed in: ' + JSON.stringify(cats));
  say('message after import: ' + JSON.stringify(await words(page)));
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(400);
  await page.click('.fl-new'); await page.waitForSelector('.ord-tile');
  await shot(page, '02-order-screen');
  say('order screen tabs: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ord-tabs .seg-opt, .sheet .seg-opt')].map((b) => b.textContent.trim()).slice(0, 10))));
  const tiles = await page.$$('.ord-tile:not(.is-86)'); await tiles[0].click(); await tiles[3].click(); await tiles[9].click();
  await page.click('.ord-pay [data-id="cash"]'); await page.click('.ord-send'); await page.waitForTimeout(500);
  say('toast: ' + JSON.stringify(await words(page)));
  say('stock/86 badge on the board: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^\s*86/.test(b.textContent)).map((b) => b.textContent.replace(/\s+/g, ' ')))));
  say('page errors: ' + logs.pageErrors.length);
});
fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));

// Owner 3: a rural diner that cooks pots of food ahead. Seven dishes, then three cooked-ahead items linked to dishes, a first batch,
// and a paid order. Slips: hours typed with a word, an hour value out of range, a repeated item name, saving with no dish ticked,
// closing the cooked-ahead sheet half done, reloading in the middle.
who = 'diner';
await withPage({ w: 1024, h: 768, touch: true }, async (page, logs) => {
  await ready(page); await page.waitForTimeout(500);
  await page.click('.fl-first-dish'); await page.waitForSelector('.dp-form');
  const add = async (nm, pr, z) => { await page.fill('.dp-name', nm); await page.fill('.dp-price', pr); if (z) await page.click('.dp-tile[data-zone=' + z + ']'); await page.click('[data-act=save-again]'); await page.waitForTimeout(200); };
  await add('Meatloaf plate', '11.95', 'sides'); await add('Pot roast plate', '13.50', 'sides'); await add('Chicken and dumplings', '10', 'sides');
  await add('Green beans', '3.25', 'sides'); await add('Mashed potatoes', '3.25', 'sides'); await add('Potato salad', '3', 'cold'); await add('Coffee', '1.75', 'cold');
  say('dishes: ' + (await page.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).length)));
  await page.evaluate(() => { const c = document.querySelector('.dp-ca'); if (c) c.scrollIntoView(); }); await page.waitForTimeout(200);
  say('question card text: ' + ((await page.locator('.dp-ca').textContent()) || '').replace(/\s+/g, ' ').slice(0, 160));
  await shot(page, '01-question');
  await page.click('.dp-ca [data-act=add-cooked]'); await page.waitForTimeout(500);
  await page.fill('.sheet:has-text("Cooked-ahead food") .dp-name', 'Pot roast');
  const hrs = page.locator('[aria-label="How long may it stay, in hours?"]');
  await hrs.fill('4 hrs'); await page.click('[data-act=save-cooked]'); await page.waitForTimeout(250);
  say('hours "4 hrs" -> ' + JSON.stringify(await words(page)));
  await hrs.fill('13'); await page.click('[data-act=save-cooked]'); await page.waitForTimeout(250);
  say('hours "13" -> ' + JSON.stringify(await words(page)));
  await hrs.fill('4'); await page.fill('[aria-label="Usual batch size, in kg"]', '6 kg'); await page.click('[data-act=save-cooked]'); await page.waitForTimeout(250);
  say('batch "6 kg" -> ' + JSON.stringify(await words(page)));
  await page.fill('[aria-label="Usual batch size, in kg"]', '6');
  await shot(page, '02-cooked-sheet');
  await page.click('[data-act=save-cooked]'); await page.waitForTimeout(400);
  say('saved with no dish selected -> ' + JSON.stringify(await words(page)).slice(0, 220));
  // The first save stopped with a warning (no dish selected); the owner reads it and taps Save again to keep it without one.
  await page.click('[data-act=save-cooked]'); await page.waitForTimeout(400);
  say('second Save -> ' + JSON.stringify(await words(page)).slice(0, 200));
  await page.click('[data-act=log-first-batch]'); await page.waitForTimeout(600);
  say('cabinet new-batch form shows product: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.hc-prod .seg-opt')].map((b) => b.textContent.trim().replace('needs attention', '')))));
  await shot(page, '03-cabinet-form');
  say('first temperature reading preset: ' + (await page.evaluate(() => (document.querySelector('.hc-hint') || {}).textContent)));
  await page.click('.hc-add'); await page.waitForTimeout(500);
  say('after Put in hold cabinet: ' + JSON.stringify(await words(page)).slice(0, 220) + ' batches ' + (await page.evaluate(() => SB.store.getState().batches.length)));
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'load' }); await ready(page); await page.waitForTimeout(600);
  say('after reload: batches ' + (await page.evaluate(() => SB.store.getState().batches.length)) + ', Pot roast plate recipe lines ' + (await page.evaluate(() => (SB.store.getState().menu.find((m) => m.name === 'Pot roast plate').bom || []).length)));
  await page.click('.fl-new'); await page.waitForSelector('.ord-tile'); await shot(page, '04-order');
  say('tiles sold out on the order screen: ' + (await page.locator('.ord-tile.is-86').count()) + ' of ' + (await page.locator('.ord-tile').count()) + '; reasons: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ord-tile.is-86')].map((t) => t.querySelector('.ord-tile-name').textContent + ': ' + t.querySelector('.ord-tile-why').textContent).slice(0, 3))));
  const t = await page.$$('.ord-tile:not(.is-86)'); if (t.length) { await t[0].click(); await page.click('.ord-pay [data-id="cash"]'); await page.click('.ord-send'); await page.waitForTimeout(500); say('toast: ' + JSON.stringify(await words(page))); }
  say('page errors: ' + logs.pageErrors.length);
});
fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));
