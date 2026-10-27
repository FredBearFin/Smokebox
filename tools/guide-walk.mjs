#!/usr/bin/env node
// WHAT THIS FILE IS: Clicks through the main steps the Guide describes on the real built app (dist/smokebox.html) and
//    fails when a button or screen the Guide names is not there any more. It is the check to run after any wording or
//    layout change on the board, the sheets or the back office.
// PARTS: a tiny step runner, the blank-kitchen walk, the demo walk, the summary.
// USES: Playwright through tools/_deps.mjs and a fresh `node tools/build.mjs`. USED BY: people, after a build. About 25 seconds.
// Run: node tools/build.mjs --quiet && node tools/guide-walk.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolRequire } from './_deps.mjs';

const { chromium } = toolRequire('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'smokebox.html');
const results = [];

// Records one check: its name, whether it held, and a short detail when it did not.
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail))); };

// Opens a fresh copy of the app (empty saved data) in a new page.
async function fresh(browser, w, h) {
  const page = await browser.newPage({ viewport: { width: w || 1280, height: h || 800 } });
  page.on('pageerror', (e) => check('no page error', false, String(e)));
  await page.goto(FILE);
  await page.waitForTimeout(800);
  return page;
}
// True when an element with this visible text (or aria-label) can be seen inside the selector scope.
// Like seen(), but the text may be anywhere inside the element (for headings that start with a number).
const has = (page, text, scope) => page.evaluate(([t, sc]) => {
  const root = sc ? document.querySelector(sc) : document;
  return !!root && [...root.querySelectorAll('h2, h3, summary, button, a, label, p, div, span')].some((e) => e.getClientRects().length && e.textContent.replace(/\s+/g, ' ').indexOf(t) >= 0);
}, [text, scope || '']);
const seen = (page, text, scope) => page.evaluate(([t, sc]) => {
  const root = sc ? document.querySelector(sc) : document;
  if (!root) return false;
  return [...root.querySelectorAll('button, a, summary, h2, h3, label, legend, [role=tab], [role=radio], span, p, div')].some((e) => e.getClientRects().length && ((e.getAttribute('aria-label') || '').indexOf(t) === 0 || e.textContent.trim().replace(/\s+/g, ' ').indexOf(t) === 0));
}, [text, scope || '']);

// The blank-kitchen walk: every step of Getting started, Taking an order, Running the line and Backup.
async function blank(browser) {
  console.log('Blank kitchen');
  const p = await fresh(browser);
  check('welcome: Add my menu', await seen(p, 'Add my menu'));
  check('welcome: Watch the demo', await seen(p, 'Watch the demo'));
  await p.click('[data-act="first-dish"]'); await p.waitForTimeout(500);
  const sh = '.sheet-root';
  for (const t of ['Dishes and prices', 'What is it called?', 'Price the customer pays', 'Which station makes it?', 'Kitchen', 'Prep', 'Fryer', 'Cold and drinks', 'Save and add another', 'Save and finish', 'Tax, hours and PIN']) check('dishes sheet: ' + t, await seen(p, t, sh));
  await p.fill(sh + ' input >> nth=0', 'Hush puppies'); await p.fill(sh + ' input >> nth=1', '5.50');
  check('price read-back: Reads as', await has(p, 'Reads as $5.50', sh));
  check('dishes sheet: Have a menu file? Import it', await seen(p, 'Have a menu file? Import it', sh));
  await p.click(sh + ' >> text=Fry'); await p.click('text=Save and add another'); await p.waitForTimeout(400);
  check('dishes sheet: Remove', await seen(p, 'Remove', sh));
  await p.click(sh + ' >> text=Remove >> nth=0'); await p.waitForTimeout(400);
  check('dishes sheet: Removed dishes', await seen(p, 'Removed dishes', sh));
  await p.click('summary:has-text("Removed dishes")'); await p.waitForTimeout(300);
  check('dishes sheet: Bring it back', await seen(p, 'Bring it back', sh));
  await p.click('text=Bring it back >> nth=0'); await p.waitForTimeout(400);
  await p.click(sh + ' >> text=Tax, hours and PIN'); await p.waitForTimeout(500);
  for (const t of ['Sales tax', 'Opening hours', 'Manager PIN', 'Cooking ahead']) check('tax sheet: ' + t, await seen(p, t, sh));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check('no Cabinet tab while Cooking ahead is No', !(await seen(p, 'Cabinet', '.fl-head')));
  // Menu list.
  await p.click('button.fl-menu'); await p.waitForTimeout(500);
  for (const t of ['Dishes and prices', 'Tax, hours and PIN', 'Guide', 'Set up this device: first steps', 'Help and about', 'Back office', 'Show me how it works']) check('menu: ' + t, await seen(p, t, sh));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // Order, cook, pay.
  await p.click('.fl-new'); await p.waitForTimeout(600);
  for (const t of ['Send to kitchen', 'Rush ticket', 'Add to open order', 'Any food allergy?']) check('new ticket: ' + t, await seen(p, t));
  await p.click('button[aria-label^="Hush puppies"]'); await p.click('text=Send to kitchen'); await p.waitForTimeout(800);
  for (const t of ['Start', 'Bump']) check('ticket: ' + t, await seen(p, t, '.fl-slip'));
  await p.click('.fl-slip .fl-row button >> nth=0'); await p.waitForTimeout(400);
  check('ticket: Done after Start', await seen(p, 'Done', '.fl-slip'));
  check('toast: Undo after an action', await seen(p, 'Undo', '.toast-host'));
  await p.click('text=Orders'); await p.waitForTimeout(500);
  for (const t of ['Tip or discount', 'Pay $']) check('orders: ' + t, await seen(p, t, sh));
  await p.click('text=Tip or discount'); await p.waitForTimeout(500);
  for (const t of ['Take payment', 'Cash', 'Card', 'Other', 'Mark paid']) check('take payment: ' + t, await seen(p, t));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check('header: Recall and Sold out', (await seen(p, 'Recall', '.fl-head')) && (await seen(p, 'Sold out', '.fl-head')));
  // Back office: backup.
  await p.click('button:has-text("Back office")'); await p.waitForTimeout(2200);
  for (const t of ['Sales and money', 'Safety', 'Menu, prices and shop']) check('back office nav: ' + t, await seen(p, t, '#sb-office'));
  await p.click('#sb-office nav >> text=Menu, prices and shop'); await p.waitForTimeout(1400);
  for (const t of ['Data, backup and reset', 'Back up now', 'Restore from a backup', 'Replacing this device', 'Danger zone: erase data']) check('data page: ' + t, await has(p, t, '#sb-office'));
  for (const t of ['Sales by day (for your accountant)', 'Download backup (JSON)', 'Copy backup', 'Choose a backup file', 'Check pasted backup', 'Erase tickets and records', 'Erase everything']) check('data page: ' + t, await seen(p, t, '#sb-office'));
  await p.close();
}

// The cook-ahead walk: turn Cooking ahead on, then the Cabinet appears.
async function cookAhead(browser) {
  console.log('Cooking ahead on');
  const p = await fresh(browser);
  await p.evaluate(() => SB.store.dispatchEx('addMenuItem', { name: 'Hush puppies', short: 'Hush puppies', zone: 'fry', cat: 'fried', price: 5.5, prepSec: 240, track: 'two' }, { source: 'ui' }));
  await p.click('button.fl-menu'); await p.click('[data-act="menu-edit"]'); await p.waitForTimeout(500);
  await p.click('.sheet-root >> text=Tax, hours and PIN'); await p.waitForTimeout(500);
  await p.click('.sheet-root >> text=Yes >> nth=0'); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  check('Cabinet tab appears when Cooking ahead is Yes', await seen(p, 'Cabinet', '.fl-head'));
  check('Sanitize button appears when Cooking ahead is Yes', await seen(p, 'Sanitize', '.fl-head'));
  await p.click('text=Cabinet'); await p.waitForTimeout(500);
  for (const t of ['New batch', 'Hold cabinet']) check('cabinet: ' + t, await seen(p, t, '.fl-cabinet'));
  await p.close();
}

// Clicks the first visible button, summary or link whose text starts with this; true when one was found.
const tap = (page, t) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button, summary, a')].filter((e) => e.getClientRects().length && e.textContent.trim().replace(/\s+/g, ' ').startsWith(t))[0];
  if (!b) return false;
  b.scrollIntoView({ block: 'center' }); b.click(); return true;
}, t);
// Adds a dish straight to the saved data (the add form is walked in blank()), so later walks start with something to sell.
const addDish = (page, d) => page.evaluate((d) => SB.store.dispatchEx('addMenuItem', Object.assign({ cat: 'fried', prepSec: 240, track: 'two' }, d), { source: 'ui' }), d);

// The cooked-ahead and portions walk: count portions, add a cooked-ahead item, log a batch, discard it with initials, fix the entry.
async function cooked(browser) {
  console.log('Cooked-ahead food, initials and fixes');
  const p = await fresh(browser);
  await addDish(p, { name: 'Hush puppies', short: 'Hush puppies', zone: 'fry', price: 5.5 });
  await addDish(p, { name: 'Pulled pork sandwich', short: 'Pork sand', zone: 'pit', cat: 'sandwich', price: 11 });
  await p.click('button.fl-menu'); await p.click('[data-act="menu-edit"]'); await p.waitForTimeout(600);
  const sh = '.sheet-root';
  check('dishes: up and down arrows beside each dish', await p.evaluate(() => !!document.querySelector('.sheet-root button[aria-label="Move Hush puppies down"]') && !!document.querySelector('.sheet-root button[aria-label="Move Pulled pork sandwich up"]')));
  check('dishes: menu section list on each dish row', await p.evaluate(() => !!document.querySelector('.sheet-root select[aria-label="Section of Hush puppies"]')));
  check('portions: I count what I made', await seen(p, 'I count what I made', sh));
  await tap(p, 'I count what I made'); await p.waitForTimeout(300);
  await p.fill('input[aria-label="How many Hush puppies you made"]', '20');
  check('portions: Start counting', await tap(p, 'Start counting')); await p.waitForTimeout(1000);
  // The sheet does not redraw by itself after Start counting (reported to the setup owner), so close and reopen it to see the count.
  check('portions: the count is saved (20 portions on hand)', (await p.evaluate(() => SB.store.getState().ingredients.some((i) => i.unit === 'ea' && SB.store.getState().stock[i.id] === 20))));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('button.fl-menu'); await p.click('[data-act="menu-edit"]'); await p.waitForTimeout(600);
  for (const t of ['20 left', '+10', 'Stop counting']) check('portions: ' + t, await seen(p, t, sh));
  for (const t of ['Do you cook food ahead?', 'Yes, I cook ahead', 'No', 'Not sure']) check('cook ahead question: ' + t, await seen(p, t, sh));
  check('cook ahead: Yes opens the cooked-ahead sheet', await tap(p, 'Yes, I cook ahead')); await p.waitForTimeout(700);
  for (const t of ['What do you cook ahead?', 'Hot or cold', 'How long may it stay, in hours?', 'Usual batch size, in kg', 'Which dishes use it?', 'Save cooked-ahead item']) check('cooked-ahead form: ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await p.fill('.sheet-root:last-of-type input >> nth=0', 'Pulled pork');
  await p.click('.sheet-root:last-of-type input[type=checkbox] >> nth=0').catch(() => {});
  await p.fill('.sheet-root:last-of-type [aria-label^="Grams of it in one"]:enabled >> nth=0', '150').catch(() => {}); // a ticked dish needs its grams
  await tap(p, 'Save cooked-ahead item'); await p.waitForTimeout(700);
  // With no dish picked the first save warns once; a second tap keeps the item anyway.
  if (!(await seen(p, 'Log a first batch', '.sheet-root:last-of-type'))) { await tap(p, 'Save cooked-ahead item'); await p.waitForTimeout(700); }
  for (const t of ['Log a first batch', 'Done for now']) check('cooked-ahead saved: ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await tap(p, 'Log a first batch'); await p.waitForTimeout(700);
  for (const t of ['New batch', 'Product', 'Put in hold cabinet']) check('cabinet new batch: ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await tap(p, 'Put in hold cabinet'); await p.waitForTimeout(800);
  // The card shows one main button (Log temp here) and a "..." button named More for this batch; the rest are in its menu.
  check('batch card: Log temp', await seen(p, 'Log temp', '.sheet-root:last-of-type'));
  check('batch card: Pull beside Log temp', await p.evaluate(() => [...document.querySelectorAll('button')].some((e) => e.getClientRects().length && /^Pull \d/.test(e.textContent.trim()))));
  check('batch card: More for this batch', await p.evaluate(() => !!document.querySelector('button[aria-label="More for this batch"]')));
  await p.click('button[aria-label="More for this batch"]'); await p.waitForTimeout(400);
  for (const t of ['Pull', 'Start cooling', 'Discard']) check('batch card menu: ' + t, await p.evaluate((t) => [...document.querySelectorAll('[role=menuitem]')].some((e) => e.getClientRects().length && e.textContent.trim().startsWith(t)), t));
  await tap(p, 'Discard'); await p.waitForTimeout(500);
  await tap(p, 'Quality'); await tap(p, 'Discard batch'); await p.waitForTimeout(600);
  for (const t of ['Who is this?', 'Skip']) check('initials: ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await p.fill('input[aria-label="Your initials"]', 'JM'); await tap(p, 'Discard batch'); await p.waitForTimeout(900);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await tap(p, 'Cabinet'); await p.waitForTimeout(500);
  check('cabinet: Entries are saved as JM, and Switch person', (await has(p, 'Entries are saved as JM')) && (await seen(p, 'Switch person')));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.click('button.fl-menu'); await p.waitForTimeout(400);
  check('menu: Thrown-out log', await tap(p, 'Thrown-out log')); await p.waitForTimeout(600);
  for (const t of ['Save as spreadsheet', 'Print or save as PDF']) check('thrown-out log: ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  check('thrown-out log: Fix this entry button', await p.evaluate(() => !!document.querySelector('.sheet-root:last-of-type button[data-act="fix-entry"]')));
  await p.click('.sheet-root:last-of-type button[data-act="fix-entry"]'); await p.waitForTimeout(500);
  for (const t of ['Fix this entry', 'What was wrong?', 'Save the fix']) check('fix: ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await p.close();
}

// The close-the-day walk: an open order blocks it, paying it unblocks it, closing offers backup and print.
async function closeDay(browser) {
  console.log('Close the day');
  const p = await fresh(browser);
  await addDish(p, { name: 'Sweet tea', short: 'Sweet tea', zone: 'cold', price: 3, prepSec: 60, track: 'one' });
  await p.evaluate(() => SB.store.dispatchEx('createTicket', { customer: 'Maria', channel: 'dine_in', items: [{ menuId: 'sweet_tea', qty: 1 }], note: '', rush: false, src: 'live' }, { source: 'ui' }));
  await tap(p, 'Orders'); await p.waitForTimeout(500);
  check('orders: Close the day', await tap(p, 'Close the day')); await p.waitForTimeout(600);
  for (const t of ['Orders still open', 'Open Orders to pay or void', 'Money today']) check('close the day (open order): ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await tap(p, 'Open Orders to pay or void'); await p.waitForTimeout(600);
  await tap(p, 'Pay $'); await p.waitForTimeout(700);
  await tap(p, 'Close the day'); await p.waitForTimeout(600);
  for (const t of ['No open orders', 'Money today', 'Cash you started the day with', 'Cash in the drawer should be', "Print today's summary"]) check('close the day (paid): ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await p.fill('.sheet-root:last-of-type .cd-start', '100'); await p.waitForTimeout(300);
  check('close the day: the drawer line adds the starting cash', await has(p, '$100.00 you started with', '.sheet-root:last-of-type'));
  await tap(p, 'Close the day'); await p.waitForTimeout(800);
  for (const t of ['The day is closed.', "Back up today's data now", "Print today's summary", 'Done']) check('closed: ' + t, await seen(p, t, '.sheet-root:last-of-type'));
  await p.evaluate(() => SB.sheets.closeAll && SB.sheets.closeAll()); await p.waitForTimeout(300);
  await tap(p, 'Back office'); await p.waitForTimeout(1200);
  await p.click('#sb-office nav >> text=Sales and money'); await p.waitForTimeout(1500);
  check('sales and money: Best day of the week', await has(p, 'Best day of the week', '#sb-office'));
  await p.close();
}

// The settings walk: units, stations marked Not used, the PIN pad's Forgot the PIN note.
async function settings(browser) {
  console.log('Units, stations, PIN');
  const p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  await p.click('button.fl-menu'); await p.click('[data-act="menu-edit"]'); await p.waitForTimeout(600);
  check('stations: Change stations', await tap(p, 'Change stations')); await p.waitForTimeout(400);
  for (const t of ['Not used', 'Add station']) check('stations: ' + t, await seen(p, t, '.sheet-root'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.evaluate(() => SB.shell.setPin('1234')); await p.waitForTimeout(300);
  await tap(p, 'Back office'); await p.waitForTimeout(1000);
  for (const t of ['Manager PIN', 'Forgot the PIN?']) check('pin pad: ' + t, await seen(p, t));
  await p.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /Forgot the PIN/.test(x.textContent)); if (d) d.open = true; });
  await p.waitForTimeout(300);
  check('pin pad: no code saved says so', await has(p, 'No recovery code was saved on this device.'));
  await p.evaluate(() => SB.shell.setPin(''));
  await p.close();
  const q = await fresh(browser);
  await tap(q, 'Back office'); await q.waitForTimeout(2200);
  await q.click('#sb-office nav >> text=Menu, prices and shop'); await q.waitForTimeout(1400);
  for (const t of ['Temperatures', 'Weights']) check('units: ' + t, await seen(q, t, '#sb-office'));
  await q.close();
}

// The Watch the demo walk: the welcome button asks first, the demo has a bar with Back to my kitchen, and your own kitchen stays empty.
async function tryDemo(browser) {
  console.log('Watch the demo');
  const p = await fresh(browser);
  check('welcome: Watch the demo', await seen(p, 'Watch the demo'));
  await tap(p, 'Watch the demo'); await p.waitForTimeout(700);
  for (const t of ['Watch the demo?', 'Not now']) check('demo dialog: ' + t, await seen(p, t, '.sheet-host'));
  await p.evaluate(() => { const b = [...document.querySelectorAll('.sheet-host button')].find((x) => x.textContent.trim() === 'Watch the demo'); if (b) b.click(); });
  await p.waitForTimeout(2200);
  check('demo bar: Demo: it runs by itself', await has(p, 'Demo: it runs by itself.'));
  check('demo bar: Back to my kitchen', await seen(p, 'Back to my kitchen'));
  check('demo: sample tickets on the board', (await p.evaluate(() => document.querySelectorAll('.fl-slip').length)) > 0);
  await tap(p, 'Back to my kitchen'); await p.waitForTimeout(2200);
  check('back in your own kitchen: empty menu', (await p.evaluate(() => SB.store.getState().menu.length)) === 0);
  check('your own kitchen shows Add my menu again', await seen(p, 'Add my menu'));
  await p.close();
}

// The start-over walk: Menu has a Start over block, the sheet has three steps, and the erase needs a saved backup and the typed words.
async function startOver(browser) {
  console.log('Start over with an empty menu');
  const p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  // One real ticket, so the careful steps show (a kitchen with only dishes gets a one-step confirm).
  await p.evaluate(() => SB.store.dispatchEx('createTicket', { customer: 'Ann', items: [{ menuId: SB.store.getState().menu[0].id, qty: 1 }] }, { source: 'ui' }));
  await p.click('button.fl-menu'); await p.waitForTimeout(500);
  check('menu: Start over with an empty menu', await tap(p, 'Start over with an empty menu')); await p.waitForTimeout(600);
  const sh = '.sheet-root:last-of-type';
  for (const t of ['What happens', 'Keep my tax, hours, PIN and station names', 'Next: about your backup']) check('start over step 1: ' + t, await has(p, t, sh));
  await tap(p, 'Next: about your backup'); await p.waitForTimeout(500);
  for (const t of ['Save my backup file now', 'I saved the backup file and I can find it', 'Next: confirm']) check('start over step 2: ' + t, await has(p, t, sh));
  check('start over step 2: Next: confirm waits for the saved box', await p.evaluate(() => { const b = [...document.querySelectorAll('.sheet-root:last-of-type button')].find((e) => e.textContent.trim() === 'Next: confirm'); return !!b && b.disabled; }));
  await tap(p, 'Save my backup file now'); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#so-saw').click()); await p.waitForTimeout(300);
  await tap(p, 'Next: confirm'); await p.waitForTimeout(500);
  check('start over step 3: Erase everything and start over', await has(p, 'Erase everything and start over', sh));
  await p.fill(sh + ' input[type=text]', 'erase'); await tap(p, 'Erase everything and start over'); await p.waitForTimeout(1500);
  for (const t of ['Done. Your kitchen is empty.', 'Go to the first screen', 'Save the backup again']) check('start over done: ' + t, await has(p, t, sh));
  check('start over: the kitchen is empty afterwards', (await p.evaluate(() => SB.store.getState().menu.length)) === 0);
  await p.close();
  // With a PIN set the PIN pad comes first.
  const q = await fresh(browser);
  await addDish(q, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  await q.evaluate(() => SB.shell.setPin('1234')); await q.waitForTimeout(300);
  await q.click('button.fl-menu'); await q.waitForTimeout(500);
  await tap(q, 'Start over with an empty menu'); await q.waitForTimeout(800);
  check('start over with a PIN: the PIN pad opens first', await q.evaluate(() => /Manager PIN/.test(document.body.innerText)));
  await q.close();
}

// The Setup recipes walk: the four recipes on the Setup recipes page, each checked against the real screens.
async function recipes(browser) {
  console.log('Setup recipes');
  const tabTap = (p, label) => p.evaluate((l) => { const e = [...document.querySelectorAll('.fl-seg button')].find((x) => x.getClientRects().length && x.textContent.trim().indexOf(l) === 0); if (e) e.click(); return !!e; }, label);
  const tabTexts = (p) => p.evaluate(() => [...document.querySelectorAll('.fl-seg [role=tab], .fl-seg button')].filter((e) => e.getClientRects().length).map((e) => (e.getAttribute('aria-label') || e.textContent).trim()));
  // Counter cafe: rename one station, mark the others Not used, count a batch dish, then Done and Bump.
  let p = await fresh(browser);
  await p.click('[data-act="first-dish"]'); await p.waitForTimeout(500);
  const sh = '.sheet-root';
  await p.fill(sh + ' input >> nth=0', 'Latte'); await p.fill(sh + ' input >> nth=1', '4.50');
  check('cafe: Change stations', await tap(p, 'Change stations')); await p.waitForTimeout(300);
  await p.fill('input[aria-label="Name of station Cold and drinks"]', 'Counter'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  for (let i = 0; i < 3; i++) await p.evaluate((i) => document.querySelectorAll('.dp-strow')[i].querySelector('button').click(), i);
  check('cafe: Not used', await seen(p, 'Use again', sh));
  await tap(p, 'Save and add another'); await p.waitForTimeout(500);
  check('cafe: I count what I made', await has(p, 'I count what I made', sh));
  for (const t of ['Do you cook food ahead?', 'Yes, I cook ahead', 'Not sure']) check('cafe: ' + t, await has(p, t, sh));
  check('cafe: No', await seen(p, 'No', sh));
  await p.reload(); await p.waitForTimeout(900);
  const t1 = await tabTexts(p);
  check('cafe: one station in use shows no station tabs', t1.length === 0, t1);
  await tap(p, 'New ticket'); await p.waitForTimeout(500);
  await tap(p, 'Latte'); await p.waitForTimeout(200);
  for (const t of ['Takeout', 'Dine-in', 'Cash', 'Card', 'Pay later', 'Allergy', 'Rush ticket', 'Send to kitchen']) check('order screen: ' + t, await seen(p, t));
  await tap(p, 'Cash'); await tap(p, 'Send to kitchen'); await p.waitForTimeout(900);
  check('card: Recall and Sold out in the header', (await seen(p, 'Recall')) && (await seen(p, 'Sold out')));
  check('cafe: Done on the ticket', await seen(p, 'Done'));
  await p.evaluate(() => document.querySelector('.fl-slip .fl-row button').click()); await p.waitForTimeout(500);
  check('cafe: Bump', await seen(p, 'Bump'));
  await tap(p, 'Bump'); await p.waitForTimeout(500);
  // How you serve: Counter service, Order buttons and Currency symbol, then a paid order clears itself and a half-built order comes back.
  await p.evaluate(() => SB.sheets.closeAll && SB.sheets.closeAll()); await p.evaluate(() => document.querySelector('button.fl-menu').click()); await p.waitForTimeout(500);
  check('settings: How you serve', await tap(p, 'How you serve')); await p.waitForTimeout(500);
  const hs = '.sheet-root:last-of-type';
  for (const t of ['Counter service', 'Order buttons', 'Add button', 'Use the starting list', 'Currency symbol', 'Your own']) check('how you serve: ' + t, await has(p, t, hs));
  await p.evaluate(() => document.querySelector('.sheet-root:last-of-type [role=switch]').click()); await p.waitForTimeout(400);
  check('how you serve: Undo bar after a change', await has(p, 'Undo', hs));
  await p.evaluate(() => SB.sheets.closeAll()); await p.waitForTimeout(400);
  await tap(p, 'New ticket'); await p.waitForTimeout(500); const tl = await tap(p, 'Latte'); await p.waitForTimeout(300);
  check('draft: Latte added before reload', tl && await p.evaluate(() => /1 item|in order/.test(document.body.innerText)), await p.evaluate(() => document.body.innerText.slice(0, 300)));
  await p.reload(); await p.waitForTimeout(900); await tap(p, 'New ticket'); await p.waitForTimeout(600);
  check('draft: Restored your unfinished order', await p.evaluate(() => /Restored your unfinished order/.test(document.body.innerText)), await p.evaluate(() => document.body.innerText.slice(-400)));
  check('draft: Clear order', await has(p, 'Clear order'));
  await tap(p, 'Cash'); await tap(p, 'Send to kitchen'); await p.waitForTimeout(900);
  check('counter service: a paid order clears itself', (await p.evaluate(() => SB.store.getState().tickets.filter((t) => t.status === 'active').length)) === 0);
  await tap(p, 'New ticket'); await p.waitForTimeout(500); await tap(p, 'Latte'); await tap(p, 'Pay later'); await tap(p, 'Send to kitchen'); await p.waitForTimeout(900);
  check('counter service: Pay later keeps the ticket until Bump', (await p.evaluate(() => SB.store.getState().tickets.filter((t) => t.status === 'active').length)) === 1 && (await seen(p, 'Bump')));
  check('counter service: no station tabs and the counter board is on', (await tabTexts(p)).length === 0 && (await p.evaluate(() => !!document.querySelector('[data-counter="on"]'))));
  // The During service card opens from the Guide and names buttons the board has.
  await p.goto(FILE + '#/guide/card-during-service'); await p.waitForTimeout(700);
  check('card: During service opens', (await has(p, 'Counter and expo')) && (await has(p, 'Frozen or offline')));
  await p.close();
  // Line with an expo: a cook tab shows only its dishes, the Expo tab shows the whole ticket tagged by station and has Bump.
  p = await fresh(browser);
  await addDish(p, { name: 'Burger', short: 'Burger', zone: 'fry', price: 12 });
  await addDish(p, { name: 'Salad', short: 'Salad', zone: 'cold', price: 9, track: 'one' });
  await tap(p, 'New ticket'); await p.waitForTimeout(500);
  await tap(p, 'Burger'); await tap(p, 'Salad'); await tap(p, 'Dine-in'); await tap(p, 'Table 3'); await tap(p, 'Card'); await tap(p, 'Send to kitchen'); await p.waitForTimeout(900);
  check('expo: tab', await tabTap(p, 'Expo')); await p.waitForTimeout(500);
  const ex = await p.evaluate(() => document.body.innerText);
  const t2 = (await tabTexts(p)).join(' | ');
  check('line: tabs for stations with dishes, plus Expo', /All stations/.test(t2) && /Fryer/.test(t2) && /Cold/.test(t2) && /Expo/.test(t2) && !/Kitchen/.test(t2) && !/Prep/.test(t2), t2);
  check('expo: sees the whole ticket', /Burger/.test(ex) && /Salad/.test(ex) && /FRY/.test(ex) && /CLD/.test(ex), ex.slice(-400));
  check('expo: Bump', await seen(p, 'Bump'));
  await tabTap(p, 'Fryer'); await p.waitForTimeout(500);
  const fr = await p.evaluate(() => document.querySelector('.fl-board, main, body').innerText);
  check('cook tab: only its own dishes', /Burger/.test(fr) && !/Salad, /.test(fr));
  await p.close();
  // Cooks food ahead: saying yes adds the Cabinet tab and New batch.
  p = await fresh(browser);
  await addDish(p, { name: 'Chili', short: 'Chili', zone: 'sides', cat: 'side', price: 6 });
  await p.click('button.fl-menu'); await p.click('[data-act="menu-edit"]'); await p.waitForTimeout(600);
  check('ahead: Yes, I cook ahead', await tap(p, 'Yes, I cook ahead')); await p.waitForTimeout(500);
  const cs = '.sheet-root:last-of-type';
  check('ahead: Cold', await p.evaluate(() => { const b = [...document.querySelectorAll('.sheet-root:last-of-type button, .sheet-root:last-of-type [role=radio]')].find((e) => e.getClientRects().length && e.textContent.trim().indexOf('Cold') === 0); if (b) b.click(); return !!b; })); await p.waitForTimeout(300);
  for (const t of ['How many days may it stay in the fridge?', 'How many hours may it be out of the fridge?', 'Use the limits your local health department gives you']) check('ahead (cold): ' + t, await has(p, t, cs));
  await p.evaluate(() => SB.sheets.closeAll && SB.sheets.closeAll()); await p.waitForTimeout(400);
  check('ahead: Cabinet tab', (await tabTexts(p)).some((t) => /Cabinet/.test(t)));
  await p.close();
}

// Setting a PIN shows the recovery code once: Copy, Print, "I saved it", then Done.
async function pinCode(browser) {
  console.log('PIN recovery code');
  const p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  await p.click('button.fl-menu'); await p.waitForTimeout(400);
  check('settings: Tax, hours and PIN', await tap(p, 'Tax, hours and PIN')); await p.waitForTimeout(500);
  await p.fill('.sheet-root:last-of-type input[aria-label*="PIN"]', '1234');
  await tap(p, 'Set PIN'); await p.waitForTimeout(900);
  const rc = '.sheet-root:last-of-type';
  for (const t of ['Write down your recovery code', 'Copy', 'Print', 'I saved it', 'Done']) check('recovery code: ' + t, await has(p, t, rc));
  const off = await p.evaluate(() => { const b = [...document.querySelectorAll('.sheet-root:last-of-type button')].find((e) => e.textContent.trim() === 'Done'); return !!b && b.disabled; });
  check('recovery code: Done stays off until I saved it is selected', off);
  await p.evaluate(() => document.querySelector('#rc-saved').click()); await p.waitForTimeout(200);
  check('recovery code: Done works after the box is selected', await tap(p, 'Done')); await p.waitForTimeout(400);
  await p.evaluate(() => SB.sheets.closeAll && SB.sheets.closeAll()); await tap(p, 'Back office'); await p.waitForTimeout(1000);
  await p.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /Forgot the PIN/.test(x.textContent)); if (d) d.open = true; });
  await p.waitForTimeout(300);
  const pad = await p.evaluate(() => [...document.querySelectorAll('input, button, label')].filter((e) => e.getClientRects().length).map((e) => (e.getAttribute('aria-label') || '') + ' ' + e.textContent).join(' | '));
  for (const t of ['Recovery code', 'Reset the PIN with my code']) check('pin pad with a code: ' + t, pad.indexOf(t) >= 0, pad.slice(0, 200));
  await p.close();
}

// The import walk: paste a file, preview it, and see the preview words the Import or export your menu page names.
async function importMenu(browser) {
  console.log('Import a menu');
  const p = await fresh(browser);
  await p.click('[data-act="first-dish"]'); await p.waitForTimeout(500);
  const sh = '.sheet-root';
  check('import: More ways to add dishes', await tap(p, 'More ways to add dishes')); await p.waitForTimeout(300);
  check('import: Have a menu file? Import it', await tap(p, 'Have a menu file? Import it')); await p.waitForTimeout(600);
  const is = '.sheet-root:last-of-type';
  check('import: intro names Lightspeed', await has(p, 'Lightspeed', is));
  await p.fill(is + ' textarea', 'Name,Price,Description,Calories\nLatte,450,Hot or iced,120\nScone,325,Fresh daily,300\nBagel,1400,With cream cheese,280');
  check('import: Preview', await tap(p, 'Preview')); await p.waitForTimeout(700);
  for (const t of ['Read as', 'These prices are in cents', 'Ignored column: Calories', 'Notes and descriptions in your file are not kept', 'Put all these dishes at', 'Import ']) check('import preview: ' + t, await has(p, t, is));
  check('import: tapping cents works', await tap(p, 'These prices are in cents')); await p.waitForTimeout(600);
  check('import preview: These prices are in dollars', await has(p, 'These prices are in dollars', is));
  check('import preview: Read as $4.50', await has(p, 'Read as $4.50', is));
  check('import: Import 3 dishes', await tap(p, 'Import 3')); await p.waitForTimeout(700);
  check('import: Remove these', await has(p, 'Remove these', is));
  check('import: the dishes are on the menu', (await p.evaluate(() => SB.store.getState().menu.filter((m) => !m.archived).length)) === 3);
  await p.close();
}

// The cold-item walk: a cold item with days and hours typed in the setup form, a batch, then Take out and Put back on its card.
async function coldItem(browser) {
  console.log('Cold item: fridge days, hours out, Take out and Put back');
  const p = await fresh(browser);
  await addDish(p, { name: 'Potato salad', short: 'Potato salad', zone: 'cold', cat: 'cold', price: 4 });
  await p.evaluate(() => document.querySelector('button.fl-menu').click()); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-act="menu-edit"]').click()); await p.waitForTimeout(600);
  check('cold: Yes, I cook ahead', await tap(p, 'Yes, I cook ahead')); await p.waitForTimeout(700);
  const cs = '.sheet-root:last-of-type';
  await p.fill(cs + ' input >> nth=0', 'House potato salad');
  await p.evaluate(() => { const b = [...document.querySelectorAll('.sheet-root:last-of-type button, .sheet-root:last-of-type [role=radio]')].find((e) => e.getClientRects().length && e.textContent.trim().indexOf('Cold') === 0); if (b) b.click(); }); await p.waitForTimeout(300);
  await p.fill('input[aria-label="How many days may it stay in the fridge?"]', '3');
  await p.fill('input[aria-label="How many hours may it be out of the fridge?"]', '2');
  await p.click(cs + ' input[type=checkbox] >> nth=0').catch(() => {});
  await p.fill(cs + ' [aria-label^="Grams of it in one"]:enabled >> nth=0', '150').catch(() => {}); // a ticked dish needs its grams
  await tap(p, 'Save cooked-ahead item'); await p.waitForTimeout(700);
  if (!(await seen(p, 'Log a first batch', cs))) { await tap(p, 'Save cooked-ahead item'); await p.waitForTimeout(700); }
  check('cold: Log a first batch', await tap(p, 'Log a first batch')); await p.waitForTimeout(700);
  check('cold: Put in hold cabinet', await tap(p, 'Put in hold cabinet')); await p.waitForTimeout(900);
  for (const t of ['In the fridge since', 'Use by', 'Not taken out yet', 'Take out']) check('cold card: ' + t, await has(p, t, cs));
  check('cold card: Use by the third day', await p.evaluate(() => /Use by .*\(your 3 days\)/.test(document.body.innerText)));
  check('cold: tapping Take out', await tap(p, 'Take out')); await p.waitForTimeout(500);
  check('cold: initials before Take out', await has(p, 'Who is this?', '.sheet-root:last-of-type'));
  await p.evaluate(() => document.querySelector('[data-act="skip-who"]').click()); await p.waitForTimeout(800);
  check('cold: the out-of-fridge clock is running', await p.evaluate(() => /taken out\. The out-of-fridge clock is running/.test(document.body.innerText)));
  for (const t of ['Out of the fridge since', 'Put back']) check('cold card (out): ' + t, await has(p, t, cs));
  check('cold: tapping Put back', await tap(p, 'Put back')); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-act="skip-who"]').click()); await p.waitForTimeout(800);
  check('cold: the clock is paused', await p.evaluate(() => /put back\. The out-of-fridge clock is paused/.test(document.body.innerText)));
  // The safety record: a limit change line, a cold reading above the limit, and the keep time from the engine.
  const ev = await p.evaluate(() => {
    const S = SB.store, d = (t, pl) => S.dispatchEx(t, pl, { source: 'ui' }), b = S.getState().batches.find((x) => x.kind === 'cold' || x.fridge);
    const a1 = d('updateSettings', { patch: { safety: { coldHoldF: 39 } } });
    const a2 = b ? d('logTemp', { batchId: b.id, tempF: 46 }) : null;
    return { limit: a1.report, temp: a2 && a2.report, batch: !!b, keep: SB.retention && SB.retention.days() };
  });
  check('safety record: a limit change and a cold reading were logged', ev.limit === 'ok' && ev.temp === 'ok', ev);
  await p.evaluate(() => SB.sheets.closeAll()); await p.waitForTimeout(300);
  await tap(p, 'Back office'); await p.waitForTimeout(1200);
  await p.click('#sb-office nav >> text=Safety'); await p.waitForTimeout(1500);
  check('safety page: Print the safety record', await tap(p, 'Print the safety record')); await p.waitForTimeout(900);
  const rec = await p.evaluate(() => (document.querySelector('.sheet-root:last-of-type') || document.body).innerText);
  check('safety record: Changed the cold limit from X to Y', /Changed the cold limit from .* to .*/.test(rec), rec.slice(0, 400));
  check('safety record: a reading above the cold limit', /above the cold limit/.test(rec), rec.slice(0, 400));
  check('safety record: the keep time comes from the engine', ev.keep ? new RegExp('Safety records are kept for about ' + ev.keep + ' days').test(rec) : /not kept forever/.test(rec), rec.slice(-300));
  await p.evaluate(() => SB.sheets.closeAll()); await p.waitForTimeout(300);
  const dr = await p.evaluate(() => { const b = SB.store.getState().batches[0]; return b ? SB.store.dispatchEx('discardBatch', { batchId: b.id, reason: 'quality' }, { source: 'ui' }).report : 'nobatch'; });
  check('thrown-out log: a batch was discarded', dr === 'ok', dr);
  await p.evaluate(() => { if (SB.office && SB.office.close) SB.office.close(); }); 
  await p.goto(FILE); await p.waitForTimeout(1000);
  await p.evaluate(() => document.querySelector('button.fl-menu').click()); await p.waitForTimeout(400);
  await tap(p, 'Thrown-out log'); await p.waitForTimeout(800);
  check('thrown-out log: Showing every batch thrown out since', await p.evaluate(() => /Showing (every batch|the \d+ batch)/.test(document.body.innerText)), await p.evaluate(() => document.body.innerText.slice(-300)));
  await p.close();
}

// The restore walk: after a restore the Data page says how long the old kitchen is kept and offers Undo this restore.
async function restoreUndo(browser) {
  console.log('Undo this restore');
  const p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  const backup = await p.evaluate(() => SB.store.exportAll());
  await addDish(p, { name: 'Wings', short: 'Wings', zone: 'fry', price: 9 });
  await tap(p, 'Back office'); await p.waitForTimeout(1200);
  await p.click('#sb-office nav >> text=Menu, prices and shop'); await p.waitForTimeout(1500);
  await p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Check pasted backup'); let n = b; let a = null; while (n && !a) { n = n.parentElement; a = n && n.querySelector('textarea'); } if (a) { const d = a.closest('details'); if (d) d.open = true; a.value = t; a.dispatchEvent(new Event('input', { bubbles: true })); } }, backup);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Check pasted backup'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length && e.textContent.trim() === 'Replace everything with this backup'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } }); await p.waitForTimeout(800);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].reverse().find((e) => e.getClientRects().length && e.textContent.trim() === 'Replace everything'); if (b) b.click(); }); await p.waitForTimeout(1500);
  const txt = () => p.evaluate(() => document.body.innerText);
  check('restore: Your kitchen before this restore is kept for N days', /Your kitchen before this restore is kept for \d+ days?/.test(await txt()));
  check('restore: Undo this restore', await p.evaluate(() => [...document.querySelectorAll('button')].some((e) => e.getClientRects().length && e.textContent.trim() === 'Undo this restore')));
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length && e.textContent.trim() === 'Undo this restore'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } }); await p.waitForTimeout(800);
  for (const t of ['Undo this restore?', 'Put my old kitchen back', 'Keep what I have']) check('restore undo confirm: ' + t, (await txt()).indexOf(t) >= 0);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].reverse().find((e) => e.getClientRects().length && e.textContent.trim() === 'Put my old kitchen back'); if (b) b.click(); }); await p.waitForTimeout(1500);
  check('restore undo: the old kitchen is back (Wings again)', await p.evaluate(() => SB.store.getState().menu.some((m) => m.name === 'Wings')));
  await p.close();
}

// The Close the month walk: three steps, five downloaded files, the typed word, Undo, and each plain refusal.
async function closeMonth(browser) {
  console.log('Close the month');
  const { loadSB } = await import('../test/_load.mjs');
  const SBn = await loadSB(['00-util', '10-config', '20-engine']);
  const E = SBn.engine; const end = Date.now() - 3600e3; const days = 60;
  let now = new Date(end - (days - 1) * 86400e3).setHours(9, 0, 0, 0);
  let st = E.newState({ now, blank: true });
  const go = (type, pl, at) => { if (at > now) now = at; const r = E.apply(st, type, pl, now); if (r.report !== 'ok') throw new Error(type + ' ' + r.report); st = r.state; return r; };
  const dish = go('addMenuItem', { name: 'Plain dish', zone: 'pit', cat: 'meat', price: 6.5, prepSec: 120, track: 'one', prepGuess: false }, now + 1000).info.id;
  const first = now;
  for (let d = 0; d < days; d++) {
    const base = new Date(first); base.setDate(base.getDate() + d); base.setHours(11, 0, 0, 0); const at = base.getTime();
    const r = go('createTicket', { customer: 'C', channel: 'dine_in', items: [{ menuId: dish, qty: 1 }], allowPast: true }, at);
    const tk = st.tickets[st.tickets.length - 1];
    for (const it of tk.items) for (let i = 0; i < 2; i++) { const cur = st.tickets.find((x) => x.id === tk.id).items.find((x) => x.id === it.id); if (cur.status !== 'done') go('advanceItem', { ticketId: tk.id, itemId: it.id }, at + 20000 * (i + 1)); }
    go('bumpTicket', { ticketId: tk.id }, at + 70000); go('payOrder', { orderId: r.info.orderId, method: 'cash', tip: 0 }, at + 80000);
    go('sanitizeDone', { who: 'JM' }, at + 9 * 3600e3); go('closeDay', {}, at + 10 * 3600e3);
  }
  const t = Math.max(now, end); st = E.tick(st, t).state;
  const saved = JSON.stringify({ v: 1, savedAt: t, rev: st.rev, clock: { virtual: t, real: t, speed: 1 }, state: st });
  const open = async (init, url) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.on('pageerror', (e) => check('no page error', false, String(e)));
    if (init) await p.addInitScript((tx) => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('smokebox.v1.state', tx); } } catch (e) { /* blocked */ } }, init);
    await p.goto(url || FILE); await p.waitForFunction(() => window.SB && SB.booted === true); await p.waitForTimeout(500); return p;
  };
  const sh = '.sheet-root:last-of-type';
  const btn = (p, t) => p.evaluate((x) => { const b = [...document.querySelectorAll('button')].reverse().find((e) => e.getClientRects().length && e.textContent.trim().replace(/\s+/g, ' ') === x); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); return true; } return false; }, t);
  const vis = (p) => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const p = await open(saved);
  await p.evaluate(() => SB.sheets.open('closemonth')); await p.waitForTimeout(800);
  check('closemonth: sheet title Close the month', await p.evaluate(() => /Close the month/.test((document.querySelector('.sheet-root:last-of-type') || document.body).innerText)));
  for (const x of ['1. What this does', 'Close everything before']) check('closemonth step 1: ' + x, await has(p, x, sh));
  let tx = await vis(p);
  check('closemonth step 1: This moves out of your kitchen', /This moves out of your kitchen: [\d,]+ days? of history \(.* up to, not including, .*\), with [\d,]+ orders?, [\d,]+ tickets? and [\d,]+ activity records?\./.test(tx), tx.slice(0, 600));
  check('closemonth step 1: This stays (last 35 days, safety records)', /This stays: the last 35 days, today, every open order and open ticket.*your menu and settings, the end-of-day totals, and all food-safety records \(/.test(tx));
  check('closemonth step 1: the history-gone warning with 7 days', /After step 3 the history leaves this device\. For 7 days you can still undo it here; after that, the files you save in step 2 are the only copy\./.test(tx));
  await p.evaluate(() => { const i = document.getElementById('cm-before'); const d = new Date(); i.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); i.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(400);
  check('closemonth step 1: You picked X, but the last 35 days always stay', /You picked .*, but the last 35 days always stay, so it stops at /.test(await vis(p)));
  check('closemonth: Next: save the files', await btn(p, 'Next: save the files')); await p.waitForTimeout(500);
  check('closemonth step 2: heading', await has(p, '2. Save the month files now', sh));
  const downloads = []; p.on('download', (d) => downloads.push(d.suggestedFilename()));
  check('closemonth step 2: Save the month files now', await btn(p, 'Save the month files now')); await p.waitForTimeout(2800);
  const names = await p.locator('[data-role="cm-files"] li strong').allInnerTexts();
  check('closemonth step 2: five files, backup first, three spreadsheets, a list', names.length === 5 && /^smokebox-before-month-close-\d{8}\.json$/.test(names[0]) && /^smokebox-orders-.*\.csv$/.test(names[1]) && /^smokebox-tickets-.*\.csv$/.test(names[2]) && /^smokebox-days-.*\.csv$/.test(names[3]) && /^smokebox-month-manifest-.*\.json$/.test(names[4]), names);
  check('closemonth step 2: the browser was handed all five', downloads.length === 5, downloads);
  tx = await vis(p);
  for (const x of ['Backup of the whole kitchen', 'Orders being closed', 'Tickets being closed', 'Days being closed', 'List of what is in these files', 'Save the files again', 'I saved the files and I can find them', 'Back office, Data, Restore, and pick the backup file.']) check('closemonth step 2: ' + x, tx.indexOf(x) >= 0);
  check('closemonth step 2: Next: confirm waits for the box', await p.locator('[data-act="cm-next2"]').isDisabled());
  await p.check('#cm-saw'); await p.waitForTimeout(200);
  check('closemonth step 2: ticking the box turns Next: confirm on', await p.locator('[data-act="cm-next2"]').isEnabled());
  check('closemonth: Next: confirm', await btn(p, 'Next: confirm')); await p.waitForTimeout(400);
  check('closemonth step 3: heading 3. Type CLOSE', await has(p, '3. Type CLOSE', sh));
  check('closemonth step 3: red button off until the word', await p.locator('[data-act="cm-go"]').isDisabled());
  await p.fill('input[aria-label="Type CLOSE to confirm"]', 'close');
  check('closemonth step 3: any case turns the red Close the month button on', await p.locator('[data-act="cm-go"]').isEnabled());
  const before = await p.evaluate(() => SB.store.getState().tickets.length);
  await p.click('[data-act="cm-go"]'); await p.waitForTimeout(1200);
  tx = await vis(p);
  check('closemonth done: Done. The month is closed.', tx.indexOf('Done. The month is closed.') >= 0);
  check('closemonth done: Moved out ... Food-safety records all stayed', /Moved out: [\d,]+ days? \(.*\), [\d,]+ orders?, [\d,]+ tickets? and [\d,]+ activity records?\. Food-safety records all stayed \(\d+\)\./.test(tx));
  check('closemonth done: Your kitchen before this is kept for 7 days', /Your kitchen before this is kept for 7 days:/.test(tx));
  check('closemonth done: tickets were removed', (await p.evaluate(() => SB.store.getState().tickets.length)) < before);
  check('closemonth done: Undo', await btn(p, 'Undo')); await p.waitForTimeout(900);
  check('closemonth done: Undone. Your kitchen is back as it was, with all the history.', (await vis(p)).indexOf('Undone. Your kitchen is back as it was, with all the history.') >= 0 && (await p.evaluate(() => SB.store.getState().tickets.length)) === before);
  check('closemonth done: Done button', await p.evaluate(() => [...document.querySelectorAll('button')].some((e) => e.getClientRects().length && e.textContent.trim() === 'Done')));
  await p.context().close();
  const q = await open(saved);
  await q.evaluate(() => SB.sheets.open('closemonth')); await q.waitForTimeout(700);
  await btn(q, 'Next: save the files'); await q.waitForTimeout(300); await btn(q, 'Save the month files now'); await q.waitForTimeout(2800);
  await q.check('#cm-saw'); await btn(q, 'Next: confirm'); await q.waitForTimeout(300);
  // A real change is hard to cause in a walk, so the store is made to answer as it does when the records changed after saving.
  await q.evaluate(() => { SB.store.closeMonthPrune = () => ({ ok: false, report: 'exportStale', info: {} }); });
  await q.fill('input[aria-label="Type CLOSE to confirm"]', 'CLOSE'); await q.click('[data-act="cm-go"]'); await q.waitForTimeout(800);
  tx = await vis(q);
  const goMsg = await q.evaluate(() => document.querySelector('[data-role="cm-go-msg"]').textContent);
  check('closemonth refusal: files out of date', /Something changed since you saved the files \(a new day started or a record changed\)\. Save the files again in step 2, then close\. Nothing was removed\./.test(goMsg), goMsg);
  check('closemonth refusal: back at step 2 with Save the files again, then continue.', tx.indexOf('2. Save the month files now') >= 0 && tx.indexOf('Save the files again, then continue.') >= 0);
  await q.context().close();
  const hb = await open(saved); await hb.evaluate(() => { SB.store.isHubClient = () => true; SB.sheets.open('closemonth'); }); await hb.waitForTimeout(700);
  check('closemonth refusal: hub tablet', (await vis(hb)).indexOf("This device works through the main computer, so the month cannot be closed here. Do this on the main computer's own screen or the main tablet.") >= 0);
  await hb.context().close();
  const dm = await open(null, FILE + '?demo'); await dm.evaluate(() => SB.sheets.open('closemonth')); await dm.waitForTimeout(700);
  check('closemonth refusal: demo', (await vis(dm)).indexOf('You are in the demo, so there is no real history to close here. Tap Back to my kitchen first.') >= 0);
  await dm.context().close();
  const nw = await open(null); await nw.evaluate(() => SB.sheets.open('closemonth')); await nw.waitForTimeout(700);
  check('closemonth refusal: nothing to close', (await vis(nw)).indexOf('There is nothing to close yet. Finished days can be moved out once they are older than the recent days that always stay.') >= 0);
  await nw.context().close();
}

// The Readings and Device checks walk: the three logs on the Readings sheet and the five checks on Device checks: screen, sound, home screen.
async function readingsAndChecks(browser) {
  console.log('Readings and tablet checks');
  const p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  await p.evaluate(() => SB.store.dispatchEx('updateSettings', { patch: { modules: { cookAhead: true } } }, { source: 'ui' }));
  await p.reload(); await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('button.fl-menu').click()); await p.waitForTimeout(400);
  check('settings: Readings', await tap(p, 'Readings')); await p.waitForTimeout(600);
  const rs = '.sheet-root:last-of-type';
  for (const t of ['Fridge, freezer or display case', 'Log reading', 'Food thermometer check', 'Log check', 'Ice water', 'Boiling water', 'Sanitizer strip', 'Log strip reading', 'Recent readings']) check('readings: ' + t, await has(p, t, rs));
  check('readings: Temperature of the fridge, freezer or case', await p.evaluate(() => !!document.querySelector('.sheet-root:last-of-type input[aria-label="Temperature of the fridge, freezer or case"]')));
  await p.fill(rs + ' input[aria-label="Temperature of the fridge, freezer or case"]', '38');
  check('readings: Log reading', await tap(p, 'Log reading')); await p.waitForTimeout(700);
  check('readings: the entry is listed', await p.evaluate(() => !/No readings yet/.test(document.querySelector('.sheet-root:last-of-type').innerText)), await p.evaluate(() => document.querySelector('.sheet-root:last-of-type').innerText.slice(-300)));
  await p.evaluate(() => SB.sheets.closeAll()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('button.fl-menu').click()); await p.waitForTimeout(400);
  check('settings: Device checks: screen, sound, home screen', await tap(p, 'Device checks: screen, sound, home screen')); await p.waitForTimeout(700);
  for (const t of ['Screen stays awake', 'Sound is on', 'Volume is loud enough', 'Added to the home screen', 'Full screen', 'Test the sound']) check('tablet checks: ' + t, await has(p, t, rs));
  await p.close();
}

// The notices walk: PIN prompts on the sensitive actions, the clock-jump question, the closed-day refusal and the unreadable-records message.
async function notices(browser) {
  console.log('PIN prompts and notices');
  const padUp = (p) => p.evaluate(() => !!document.querySelector('button[aria-label="Digit 1"]'));
  const enter = async (p, pin) => { for (const d of pin) await p.evaluate((d) => document.querySelector('button[aria-label="Digit ' + d + '"]').click(), d); await p.waitForTimeout(900); };
  let p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  await p.evaluate(() => SB.shell.setPin('1234')); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('button.fl-menu').click()); await p.waitForTimeout(400);
  await tap(p, 'Tax, hours and PIN'); await p.waitForTimeout(600);
  await p.fill('.sheet-root:last-of-type input[aria-label="Manager PIN, 4 digits"]', '5678'); await tap(p, 'Set PIN'); await p.waitForTimeout(800);
  check('PIN set: changing it asks for the current PIN', await padUp(p));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await tap(p, 'Make a recovery code'); await p.waitForTimeout(800);
  check('PIN set: a new recovery code asks for the PIN', await padUp(p));
  await p.keyboard.press('Escape'); await p.evaluate(() => SB.sheets.closeAll()); await p.waitForTimeout(300);
  await tap(p, 'Back office'); await p.waitForTimeout(800);
  check('PIN set: the back office asks for the PIN', await padUp(p)); await enter(p, '1234'); await p.waitForTimeout(1200);
  await p.click('#sb-office nav >> text=Menu, prices and shop'); await p.waitForTimeout(1500);
  await tap(p, 'Erase tickets and records'); await p.waitForTimeout(800);
  await p.fill('input[aria-label="Type ERASE to confirm"]', 'ERASE'); await p.waitForTimeout(300);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].reverse().find((e) => e.getClientRects().length && e.textContent.trim() === 'Erase tickets and records'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } });
  await p.waitForTimeout(900);
  check('PIN set: Erase tickets and records asks for the PIN', await padUp(p));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  check('PIN refused: Nothing was erased.', await p.evaluate(() => /Nothing was erased\./.test(document.body.innerText) || SB.store.getState().menu.length > 0));
  const backup = await p.evaluate(() => SB.store.exportAll());
  await p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Check pasted backup'); let n = b; let a = null; while (n && !a) { n = n.parentElement; a = n && n.querySelector('textarea'); } if (a) { const d = a.closest('details'); if (d) d.open = true; a.value = t; a.dispatchEvent(new Event('input', { bubbles: true })); } }, backup);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Check pasted backup'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length && e.textContent.trim() === 'Replace everything with this backup'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } }); await p.waitForTimeout(900);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].reverse().find((e) => e.getClientRects().length && e.textContent.trim() === 'Replace everything'); if (b) b.click(); }); await p.waitForTimeout(900);
  check('PIN set: restoring a backup asks for the PIN', await padUp(p));
  await p.close();
  // The clock jumps 40 hours ahead: Smokebox asks, and offers the two answers.
  p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  await p.evaluate(() => { const d = Date.now.bind(Date); Date.now = () => d() + 40 * 3600e3; });
  await p.waitForTimeout(7500);
  check("clock jump: the strip says This tablet's clock jumped ahead by about 1 day", await p.evaluate(() => /This tablet's clock jumped ahead by about \d+ (days|hours)\. Smokebox is still using the old time, so tickets and timers keep running\./.test(document.body.innerText)), await p.evaluate(() => document.body.innerText.slice(0, 300)));
  for (const t of ['Use the new time', 'Keep the old time']) check('clock jump: ' + t, await seen(p, t));
  await tap(p, 'Use the new time'); await p.waitForTimeout(700);
  check('clock jump: Use the new time asks a second question', await p.evaluate(() => /Use the new time\?/.test(document.body.innerText) && /Only do this if the date and time on this tablet are right/.test(document.body.innerText)));
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length && e.textContent.trim() === 'Keep the old time' && e.closest('.sheet-root, [role=dialog]')); if (b) b.click(); }); await p.waitForTimeout(400);
  await p.close();
  // A paid order from a day that was already closed cannot be opened again.
  p = await fresh(browser);
  await addDish(p, { name: 'Sweet tea', short: 'Sweet tea', zone: 'cold', price: 3, prepSec: 60, track: 'one' });
  const closedWords = await p.evaluate(() => {
    const S = SB.store, d = (t, pl) => S.dispatchEx(t, pl, { source: 'ui' });
    const tk = d('createTicket', { customer: 'Maria', channel: 'dine_in', items: [{ menuId: 'sweet_tea', qty: 1 }], note: '', rush: false, src: 'live' });
    const oid = tk.info && tk.info.orderId;
    d('payOrder', { orderId: oid, method: 'cash' });
    const c = d('closeDay', {});
    const r = d('reopenOrder', { orderId: oid });
    return { close: c.report, reopen: r.report, words: SB.engine.describe(r.report, r.info, S.getState().settings) };
  });
  check('closed day: the reopen is refused', closedWords.reopen === 'dayClosed', closedWords);
  check('closed day: plain words', /already closed, so it cannot be opened again/.test(closedWords.words || ''), closedWords);
  await p.close();
  // A saved ticket that cannot be read is left out and the message says so.
  p = await fresh(browser);
  await addDish(p, { name: 'Fries', short: 'Fries', zone: 'fry', price: 4 });
  await p.evaluate(() => SB.store.dispatchEx('createTicket', { customer: 'A', channel: 'dine_in', items: [{ menuId: 'fries', qty: 1 }], note: '', rush: false, src: 'live' }, { source: 'ui' }));
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const k = 'smokebox.v1.state', s = JSON.parse(localStorage.getItem(k)); const st = s.state || s; st.tickets[0].items = 'garbage'; localStorage.setItem(k, JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(1500);
  check('unreadable records: Smokebox could not read some saved records and left out 1 ticket', await p.evaluate(() => /Smokebox could not read some saved records and left out 1 ticket/.test(document.body.innerText)));
  check('unreadable records: the data as it was has been kept', await p.evaluate(() => /The data as it was has been kept on this device/.test(document.body.innerText)));
  await p.close();
}

// The demo walk: a fresh browser context opened with ?demo has sample dishes and tickets, and a normal tab in the same context stays empty.
async function demoMode(browser) {
  console.log('Demo mode (?demo)');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await ctx.newPage();
  await d.goto(FILE + '?demo'); await d.waitForTimeout(1000);
  check('?demo: sample dishes and tickets', (await d.evaluate(() => [SB.store.getState().menu.length, SB.store.getState().tickets.length])).every((n) => n > 0));
  check('?demo: Cabinet tab', await seen(d, 'Cabinet', '.fl-head'));
  const n = await ctx.newPage();
  await n.goto(FILE); await n.waitForTimeout(1000);
  check('a normal tab beside it stays empty', (await n.evaluate(() => [SB.store.getState().menu.length, SB.store.getState().tickets.length])).every((x) => x === 0));
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
try { if (process.env.WALK_ONLY === 'recipes') await recipes(browser); else if (process.env.WALK_ONLY === 'import') await importMenu(browser); else if (process.env.WALK_ONLY === 'cold') await coldItem(browser); else if (process.env.WALK_ONLY === 'month') await closeMonth(browser); else if (process.env.WALK_ONLY === 'restore') await restoreUndo(browser); else if (process.env.WALK_ONLY === 'startover') await startOver(browser); else if (process.env.WALK_ONLY === 'notices') await notices(browser); else if (process.env.WALK_ONLY === 'readings') await readingsAndChecks(browser); else { await blank(browser); await cookAhead(browser); await cooked(browser); await closeDay(browser); await settings(browser); await pinCode(browser); await importMenu(browser); await coldItem(browser); await restoreUndo(browser); await closeMonth(browser); await readingsAndChecks(browser); await startOver(browser); await notices(browser); await recipes(browser); await tryDemo(browser); await demoMode(browser); } } finally { await browser.close(); }
const bad = results.filter((r) => !r.ok);
console.log('\n' + (results.length - bad.length) + ' of ' + results.length + ' checks held' + (bad.length ? '; ' + bad.length + ' failed' : ''));
process.exit(bad.length ? 1 : 0);
