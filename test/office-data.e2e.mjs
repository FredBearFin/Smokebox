// Office C end-to-end test: the back office page "Menu, prices and shop" (src/js/84-office-data.js).
// Run: node test/office-data.e2e.mjs [--only=<group substring>] [--no-shots] [--vp=w280] (--vp redoes one screenshot size)
//
// Builds a private bundle dist/officeC.html with ONLY what this page needs (tokens, base CSS, util, config, icons, engine, store, metrics, charts, shell,
// the office frame, the Data page, boot), so other agents' work in progress cannot disturb these checks. Everything goes through the real engine, store,
// shell and office frame. A few things the page treats as optional (SB.sim, SB.floor.setSound, window.claude) are stubbed per test and say so.
// Screenshots: test/.out/officeC/*.png (Ember and Paper, 5 viewports). Exit code 1 on any failed check, console error or page error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage as pwWithPage } from '../tools/pw.mjs';
import { startKitchen } from './_kitchen.mjs';
// A group that throws counts as one failed check and the next group still runs.
const withPage = (...a) => pwWithPage(...a).catch((e) => { fail++; failures.push('group threw'); console.log('  FAIL  group threw: ' + String(e.message).split('\n').slice(0, 3).join(' ').replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300) + ' @ ' + ((String(e.stack).match(/office-data\.e2e\.mjs:\d+/) || [''])[0])); });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'test/.out/officeC');
const BUNDLE = path.join(root, 'dist/officeC.html');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json|csv)$/.test(f)) fs.rmSync(path.join(OUT, f));

const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const NO_SHOTS = args.includes('--no-shots');

/* ---------- private bundle ---------- */
function buildBundle() {
  const CSS = ['00-tokens.css', '10-base.css', '30-office.css', '32-office-data.css', '40-charts.css'];
  const JS = ['00-util.js', '05-icons.js', '10-config.js', '20-engine.js', '25-deadlines.js', '30-store.js', '40-metrics.js', '50-charts.js', '60-shell.js', '80-office-core.js', '84-office-data.js', '88-office-backup.js', '99-boot.js'];
  let c = '';
  for (const f of CSS) c += `\n/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(root, 'src/css', f), 'utf8');
  let j = '';
  for (const f of JS) {
    const body = fs.readFileSync(path.join(root, 'src/js', f), 'utf8');
    j += `\n/* ===== ${f} ===== */\n;try{\n${body}\n}catch(e){console.error('[smokebox] module ${f} failed to load:',e);window.__sbLoadErrors=(window.__sbLoadErrors||[]);window.__sbLoadErrors.push({file:'${f}',message:String(e&&e.message||e)});}\n`;
  }
  const tpl = fs.readFileSync(path.join(root, 'src/index.template.html'), 'utf8');
  fs.mkdirSync(path.dirname(BUNDLE), { recursive: true });
  fs.writeFileSync(BUNDLE, tpl.replace('<!--SB:CSS-->', () => `<style>${c}\n</style>`).replace('<!--SB:JS-->', () => `<script>${j}\n</script>`));
}
buildBundle();

/* ---------- tiny harness ---------- */
let pass = 0, fail = 0;
const failures = [];
const shots = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let currentGroup = '';
const groups = [];
function group(title, fn) { groups.push({ title, fn }); }
const noErrors = (name, logs) => check(name + ': no console errors or page errors', logs.errors.length === 0 && logs.pageErrors.length === 0, { errors: logs.errors.slice(0, 4), pageErrors: logs.pageErrors.slice(0, 3) });
/** The Data page keeps each dish as a collapsed row (tap to edit) and the less used panels in collapsed "Advanced" details. Open the dishes the tests edit
 *  (opening all 40 makes a 34,000 px page) and every Advanced section, so their fields can be reached. Run again after a reload. */
async function prep(page) {
  await page.evaluate(() => document.querySelectorAll('details.od-adv').forEach((d) => { d.open = true; }));
  await page.evaluate(() => ['brisket_qtr', 'tea'].forEach((id) => { const b = document.querySelector('.od-item[data-id="' + id + '"][data-open="false"] .od-sum'); if (b) b.click(); }));
}
// A fresh browser per call already starts with empty storage; the harness's own clear-once flag is flaky across reloads, so it is switched off.
const open = (opts, fn) => withPage(Object.assign({ w: 1280, h: 900, file: BUNDLE, hash: '#/office/data', query: '?demo', clearStorage: false, reducedMotion: 'reduce' }, opts), async (page, logs) => {
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  await page.waitForSelector('.od .od-panel', { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('.is-igniting, .is-snuffing'), null, { timeout: 5000 }).catch(() => {});
  page.setDefaultTimeout(6000); // a missing element fails in a few seconds, not 30
  await page.waitForTimeout(250);
  await prep(page);
  await page.waitForTimeout(150);
  return fn(page, logs, dialogs);
});

/* ---------- page helpers ---------- */
const MENU = { id: 'brisket_qtr', name: 'Brisket, 1/4 lb' };
const input = (page, aria) => page.locator(`.od input.stepper-input[aria-label="${aria}"]`).first();
async function typeNum(page, aria, text) {
  const inp = input(page, aria);
  // Open the dish row or Advanced section that holds the field, if it is collapsed.
  await inp.evaluate((e) => { const it = e.closest('.od-item'); const b = it && it.dataset.open === 'false' && it.querySelector('.od-sum'); if (b) b.click(); const d = e.closest('details'); if (d) d.open = true; });
  await inp.scrollIntoViewIfNeeded();
  await inp.click();
  await inp.fill(text);
  await inp.press('Enter');
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const waitFor = (page, fn, arg, timeout = 3000) => page.waitForFunction(fn, arg, { timeout });
const item = (id) => `.od-item[data-id="${id}"]`;
const text = async (page, sel) => ((await page.locator(sel).first().textContent()) || '').replace(/\s+/g, ' ').trim();
const visible = (page, sel) => page.locator(sel).first().isVisible();
const eventsOf = (page, type) => page.evaluate((t) => SB.engine.allEvents(SB.store.getState()).filter((e) => e.type === t).length, type);
const stateJson = (page) => page.evaluate(() => JSON.stringify(SB.store.getState()));
// Reads the typed-word erase box that the Data page opens, then cancels it or types the word and confirms. Returns the box text.
async function typedBox(page, which) {
  const box = page.locator('#od-data .od-danger-box:not([hidden])');
  await box.waitFor({ timeout: 8000 });
  const text = await box.innerText();
  if (which === 'cancel') await box.locator('button', { hasText: 'Keep my data' }).click();
  else { await box.locator('input').fill(/Erase everything/.test(text) ? 'ERASE' : 'ERASE'); await box.locator('button.btn-danger').click(); }
  return text;
}
async function confirmSheet(page, which) {
  await page.waitForSelector('.sheet[role="alertdialog"]', { timeout: 8000 });
  const t = await page.locator('.sheet[role="alertdialog"]').first().innerText();
  if (which === 'confirm') await page.locator('.sheet[role="alertdialog"] .sheet-foot .btn-danger').click();
  else if (which === 'cancel') await page.locator('.sheet[role="alertdialog"] .sheet-foot .btn:not(.btn-danger)').first().click();
  if (which) await page.waitForFunction(() => !document.querySelector('.sheet[role="alertdialog"]'), null, { timeout: 3000 });
  return t;
}
async function makeTickets(page, n) {
  await startKitchen(page); // the demo kitchen with starter stock (a real install starts blank)
  return page.evaluate((count) => {
    const ids = SB.config.menu.map((m) => m.id);
    let ok = 0;
    for (let i = 0; i < count; i++) if (SB.store.dispatch('createTicket', { customer: 'Table ' + (i + 1), channel: SB.config.channels[i % 4].id, items: [{ menuId: ids[i % ids.length] }, { menuId: ids[(i + 3) % ids.length] }] }) === 'ok') ok++;
    return ok;
  }, n);
}
async function goPanel(page, id) {
  await page.evaluate((x) => document.getElementById('od-' + x).scrollIntoView({ block: 'start' }), id);
  await page.waitForTimeout(80);
}
async function shot(page, name) {
  if (NO_SHOTS) return;
  const p = path.join(OUT, name + '.png');
  await page.screenshot({ path: p });
  shots.push(p);
}
const overflowReport = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const col = document.querySelector('.of-col');
  const bad = [];
  const rootEl = document.querySelector('.od');
  for (const el of rootEl.querySelectorAll('*')) {
    if (el.closest('.od-toc') || el.closest('.visually-hidden') || el.classList.contains('visually-hidden')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) bad.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  return { vw, docScroll: document.scrollingElement.scrollWidth, colScroll: col ? col.scrollWidth : 0, colClient: col ? col.clientWidth : 0, bad: bad.slice(0, 8), nBad: bad.length };
});

/* ====================================================================================================================
 * 1. Page structure, headline, table of contents
 * ================================================================================================================== */
group('1. Page, headline and contents list', async () => {
  await open({}, async (page, logs, dialogs) => {
    const r = await st(page, () => ({
      loadErrors: (window.__sbLoadErrors || []).map((e) => e.file),
      registered: SB.office.pages().find((p) => p.id === 'data'),
      panels: Array.from(document.querySelectorAll('.od-panel')).map((p) => p.id),
      toc: Array.from(document.querySelectorAll('.od-toc-link')).map((a) => a.textContent),
      title: document.querySelector('.of-title').textContent,
      hasTestHook: typeof SB.dataPage.saveFile,
    }));
    check('84-office-data.js loads without a module error', !r.loadErrors.includes('84-office-data.js'), r.loadErrors);
    check('registered as page "data", title "Menu, prices and shop"', r.registered && r.registered.ready === true && r.registered.title === 'Menu, prices and shop' && r.registered.icon === 'sliders', r.registered);
    check('frame title row says Menu, prices and shop', r.title === 'Menu, prices and shop', r.title);
    check('nine panels in order', JSON.stringify(r.panels) === JSON.stringify(['od-menu', 'od-look', 'od-pin', 'od-ingredients', 'od-times', 'od-safety', 'od-data', 'od-about', 'od-pacing']), r.panels);
    check('contents list has nine entries with plain words', r.toc.length === 9 && r.toc.every((t) => /^[A-Z][a-z]/.test(t) || t === 'PIN'), r.toc);

    // headline: computed from the real state
    const calc = await st(page, () => { const s = SB.store.getState(); return s.menu.filter((m) => !m.archived && !m.prepConfirmed).length + s.ingredients.filter((i) => i.tcs && typeof i.yield === 'number' && !i.yieldConfirmed).length; });
    const head = await text(page, '.od-headline');
    check('headline opens with the saved-on-this-device sentence', head.startsWith('Your settings are saved on this device.'), head);
    check('headline counts starter estimates from the data (' + calc + ')', head.includes(calc + ' starter estimates are still guesses, not confirmed yet.'), head);
    check('headline has no ALL CAPS words, arrows or dot-separated meta strings', !/\b[A-Z]{4,}\b/.test(head) && !/[→←↑↓·]/.test(head), head);

    // table of contents: keyboard friendly, does not leave the office
    const pinLink = page.locator('.od-toc-link', { hasText: 'PIN' });
    await pinLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1100);
    const after = await st(page, () => ({ view: SB.router.view(), hash: location.hash, active: document.activeElement && document.activeElement.id, inOffice: SB.shell.inOffice(), top: document.getElementById('od-pin').getBoundingClientRect().top }));
    check('Enter on a contents link keeps the office page open (the router did not see the anchor)', after.inOffice && after.view.kind === 'office' && after.view.section === 'data' && after.hash === '#/office/data', after);
    check('Enter on a contents link moves focus to that panel heading', after.active === 'od-h-pin', after.active);
    check('the panel is scrolled into view (not hidden under the sticky bars)', after.top >= 0 && after.top < 400, after.top);
    const cur = await st(page, () => Array.from(document.querySelectorAll('.od-toc-link[aria-current]')).map((a) => a.textContent));
    check('contents list marks the current panel', cur.length === 1 && cur[0] === 'PIN', cur);
    const sticky = await st(page, () => { const t = document.querySelector('.od-toc'); const r = t.getBoundingClientRect(); return { top: Math.round(r.top), sticky: getComputedStyle(t).position, visible: r.height > 0 }; });
    check('the contents list stays on screen while scrolling (sticky)', sticky.sticky === 'sticky' && sticky.visible && sticky.top < 200, sticky);

    check('no browser dialogs were used', dialogs.length === 0, dialogs);
    noErrors('page', logs);
  });
});

/* ====================================================================================================================
 * 2. Menu and bills of materials
 * ================================================================================================================== */
group('2. Menu and bills of materials', async () => {
  await open({}, async (page, logs) => {
    const rows = await st(page, () => document.querySelectorAll('.od-item[data-id]:not(.od-ing):not(.od-chan)').length);
    const menuN = await st(page, () => SB.store.getState().menu.length);
    check('every menu item has a row (' + menuN + ')', rows === menuN, rows);

    // price: saves, shows the confirmation, survives in the state
    const ev0 = await eventsOf(page, 'settings_changed');
    await typeNum(page, 'Price of ' + MENU.name, '9.5');
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).price === 9.5, MENU.id);
    const stat = await text(page, item(MENU.id) + ' .od-st');
    check('price edit saved through the engine (state.menu price 9.5)', true);
    check('a saved line appears beside the row and says what changes', /^Saved\./.test(stat) && /New tickets use \$9\.50/.test(stat), stat);
    check('one edit wrote exactly one settings_changed event', (await eventsOf(page, 'settings_changed')) === ev0 + 1, [ev0, await eventsOf(page, 'settings_changed')]);

    // out of range: refused with the allowed range, old value kept, friction counted
    const f0 = await eventsOf(page, 'ui_report');
    await typeNum(page, 'Price of ' + MENU.name, '5000');
    await page.waitForTimeout(150);
    const err = await text(page, item(MENU.id) + ' .od-ferr:not([hidden])');
    const shown = await input(page, 'Price of ' + MENU.name).inputValue();
    check('a price of 5000 is refused in words with the allowed range', /The price has to be between \$0\.00 and \$1,000\.00\./.test(err), err);
    check('the refusal says which value was kept', /Kept \$9\.50\./.test(err), err);
    check('the field goes back to the old value (9.50)', shown === '9.50', shown);
    check('state price is unchanged after the refusal', (await st(page, (id) => SB.store.getState().menu.find((m) => m.id === id).price, MENU.id)) === 9.5);
    check('the refusal was recorded as friction (ui_report)', (await eventsOf(page, 'ui_report')) === f0 + 1, [f0, await eventsOf(page, 'ui_report')]);

    // garbage and absurd values never reach the engine
    const rev0 = await st(page, () => SB.store.getState().rev);
    for (const bad of ['abc', '1e30', '', '--3', 'Infinity', 'NaN']) {
      await typeNum(page, 'Price of ' + MENU.name, bad);
      await page.waitForTimeout(80);
    }
    const errG = await text(page, item(MENU.id) + ' .od-ferr:not([hidden])');
    check('garbage text says it is not a number and what was kept', /not a number/i.test(errG) && /Kept \$9\.50\./.test(errG), errG);
    check('abc, 1e30, empty, --3, Infinity and NaN changed nothing (rev unchanged)', (await st(page, () => SB.store.getState().rev)) === rev0);
    check('the field still shows a real number', /^\d+(\.\d+)?$/.test(await input(page, 'Price of ' + MENU.name).inputValue()));

    // holding the + button writes once, not dozens of times
    const ev1 = await eventsOf(page, 'settings_changed');
    const plus = page.locator(item(MENU.id) + ' .od-block').first().locator('.stepper-btn.is-plus:not(.is-big)');
    await plus.scrollIntoViewIfNeeded();
    const box = await plus.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    await page.waitForTimeout(900);
    const evDelta = (await eventsOf(page, 'settings_changed')) - ev1;
    const price2 = await st(page, (id) => SB.store.getState().menu.find((m) => m.id === id).price, MENU.id);
    check('holding + moved the price up many steps', price2 > 11, price2);
    check('holding + wrote one settings event, not one per step', evDelta === 1, evDelta);

    // prep time and the starter / confirmed toggle
    await typeNum(page, 'Prep time of ' + MENU.name, '125');
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).prepSec === 125, MENU.id);
    check('prep time saved and shown as minutes and seconds beside the field', (await text(page, item(MENU.id) + ' .od-read:not(:empty)')) === '2 min 5 s');
    const seg = page.locator(item(MENU.id) + ' .seg:has([data-id="confirmed"])').first(); // the item also has Station, Category and How it is cooked segments
    check('prep time starts as a starter estimate', (await st(page, (id) => SB.store.getState().menu.find((m) => m.id === id).prepConfirmed, MENU.id)) === false);
    const headBefore = await text(page, '.od-headline');
    await seg.locator('[data-id="confirmed"]').click();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).prepConfirmed === true, MENU.id);
    await page.waitForTimeout(100);
    const headAfter = await text(page, '.od-headline');
    const nb = +headBefore.match(/(\d+) starter/)[1], na = +headAfter.match(/(\d+) starter/)[1];
    check('marking it confirmed saves prepConfirmed and lowers the headline count by one', na === nb - 1, [headBefore, headAfter]);
    check('the row says it was confirmed', /confirmed/i.test(await text(page, item(MENU.id) + ' .od-st')));
    await seg.locator('[data-id="starter"]').click();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).prepConfirmed === false, MENU.id);
    check('toggling back restores the starter label', true);

    // too-small prep time refused in words
    await typeNum(page, 'Prep time of ' + MENU.name, '2');
    await page.waitForTimeout(120);
    const errP = await text(page, item(MENU.id) + ' .od-ferr:not([hidden])');
    check('a 2 second prep time is refused with the range in minutes and seconds', /between 0:05 and 60:00/.test(errP), errP);

    // zone and name
    await page.locator(`${item(MENU.id)} select.select`).first().selectOption('sides');
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).zone === 'sides', MENU.id);
    check('station changed through the engine', true);
    await page.locator(`${item(MENU.id)} select.select`).first().selectOption('pit');
    const nameIn = page.locator(`${item(MENU.id)} input[aria-label="Name of ${MENU.name}"]`);
    await nameIn.fill('Brisket, quarter pound');
    await nameIn.blur();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).name === 'Brisket, quarter pound', MENU.id);
    check('renaming saves', true);
    await nameIn.fill('');
    await nameIn.blur();
    await page.waitForTimeout(100);
    check('an empty name is refused, with the old name shown', /Kept "Brisket, quarter pound"/.test(await text(page, item(MENU.id) + ' .field-error')) && (await nameIn.inputValue()) === 'Brisket, quarter pound');
    await nameIn.fill(MENU.name); await nameIn.blur();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).name === 'Brisket, 1/4 lb', MENU.id);

    // bill of materials: add, edit, validate, remove
    const bomN = () => st(page, (id) => SB.store.getState().menu.find((m) => m.id === id).bom.length, MENU.id);
    check('starter bill of materials has one line', (await bomN()) === 1);
    await page.locator(`${item(MENU.id)} .od-bom-actions .btn`).click();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).bom.length === 2, MENU.id);
    const added = await st(page, (id) => SB.store.getState().menu.find((m) => m.id === id).bom[1], MENU.id);
    check('Add ingredient adds a second line with a sensible amount', !!added.ing && added.qty > 0, added);
    const ingName = await st(page, (i) => SB.store.getState().ingredients.find((x) => x.id === i).name, added.ing);
    const qtyAria = `${ingName} in ${MENU.name}`;
    await typeNum(page, qtyAria, '180');
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).bom[1].qty === 180, MENU.id);
    check('line amount edit saved (grams)', true);
    await typeNum(page, qtyAria, '0');
    await page.waitForTimeout(150);
    const errB = await text(page, item(MENU.id) + ' .od-bom .od-ferr:not([hidden])');
    check('a zero amount is refused: has to be more than 0', /more than 0/.test(errB), errB);
    check('state keeps 180 after the refusal', (await st(page, (id) => SB.store.getState().menu.find((m) => m.id === id).bom[1].qty, MENU.id)) === 180);
    await typeNum(page, qtyAria, '999999');
    await page.waitForTimeout(150);
    check('an absurd amount (999999) is refused too', /100,000/.test(await text(page, item(MENU.id) + ' .od-bom .od-ferr:not([hidden])')));
    await page.locator(`${item(MENU.id)} .od-rm[aria-label^="Remove ${ingName}"]`).click();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).bom.length === 1, MENU.id);
    check('Remove takes the line off again', true);
    // fill the list up to its limit: Add is disabled and says why
    for (let i = 0; i < 12; i++) { const dis = await page.locator(`${item(MENU.id)} .od-bom-actions .btn`).isDisabled(); if (dis) break; await page.locator(`${item(MENU.id)} .od-bom-actions .btn`).click(); await page.waitForTimeout(60); }
    const full = await st(page, (id) => ({ n: SB.store.getState().menu.find((m) => m.id === id).bom.length, ings: SB.store.getState().ingredients.length }), MENU.id);
    check('the list stops at the ingredients that exist (no duplicates)', full.n <= full.ings && new Set(await st(page, (id) => SB.store.getState().menu.find((m) => m.id === id).bom.map((l) => l.ing), MENU.id)).size === full.n, full);

    // archive and unarchive: soft only
    const AM = 'tea';
    const archBtn = page.locator(`${item(AM)} .od-arch`);
    await archBtn.scrollIntoViewIfNeeded();
    await archBtn.click();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).archived === true, AM);
    await page.waitForTimeout(100);
    check('Archive sets archived in the state (item still exists)', (await st(page, (id) => !!SB.store.getState().menu.find((m) => m.id === id), AM)) === true);
    check('an archived item leaves the Active list', !(await visible(page, item(AM))));
    await page.locator('#od-menu .seg [data-id="archived"]').first().click();
    await page.waitForTimeout(100);
    check('it shows under Removed with a Removed chip and a Bring it back button', (await visible(page, item(AM))) && /Removed/.test(await text(page, item(AM) + ' .od-archived')) && /Bring it back/.test(await text(page, item(AM) + ' .od-arch')));
    check('there is no Delete button anywhere in the menu panel', (await page.locator('#od-menu button', { hasText: /delete|remove item/i }).count()) === 0);
    await page.locator(`${item(AM)} .od-arch`).click();
    await waitFor(page, (id) => SB.store.getState().menu.find((m) => m.id === id).archived === false, AM);
    await page.locator('#od-menu .seg [data-id="active"]').first().click();
    await page.waitForTimeout(100);
    check('Bring it back puts it back in the Active list', await visible(page, item(AM)));

    // filters
    await page.selectOption('#od-menu .od-filter-zone', 'cold');
    await page.waitForTimeout(100);
    const coldShown = await st(page, () => Array.from(document.querySelectorAll('#od-menu .od-item[data-id]')).filter((e) => !e.hidden).map((e) => e.dataset.zone));
    check('station filter shows only that station', coldShown.length > 0 && coldShown.every((z) => z === 'cold'), coldShown);
    await page.selectOption('#od-menu .od-filter-zone', 'all');
    await page.locator('#od-menu .od-fchip').click();
    await page.waitForTimeout(100);
    const starterShown = await st(page, () => Array.from(document.querySelectorAll('#od-menu .od-item[data-id]')).filter((e) => !e.hidden).every((e) => e.dataset.confirmed === 'false'));
    check('"Starter estimates only" hides confirmed items', starterShown);
    await page.locator('#od-menu .od-fchip').click();

    // the learned estimate sits beside the starter estimate
    await page.evaluate((id) => {
      const env = JSON.parse(SB.store.exportAll());
      env.state.learned = Object.assign({}, env.state.learned, { [id]: { n: 6, ema: 150, est: 128 } });
      SB.store.importAll(JSON.stringify(env));
    }, MENU.id);
    await page.waitForTimeout(250);
    const lt = await text(page, item(MENU.id) + ' .od-learned');
    check('learned estimate is shown next to the starter estimate', /Learned estimate \d+:\d\d from 6 timings/.test(lt), lt);
    noErrors('menu panel', logs);
  });
});

/* ====================================================================================================================
 * 3. Ingredients
 * ================================================================================================================== */
group('3. Ingredients', async () => {
  await open({}, async (page, logs) => {
    const ing = (id) => st(page, (x) => SB.store.getState().ingredients.find((i) => i.id === x), id);
    const n = await st(page, () => SB.store.getState().ingredients.length);
    check('every ingredient has a row (' + n + ')', (await page.locator('#od-ingredients .od-ing').count()) === n);
    await typeNum(page, 'Opening amount of Brisket', '16000');
    await waitFor(page, () => SB.store.getState().ingredients.find((i) => i.id === 'brisket').parG === 16000);
    check('par saved in grams; the field also reads it as kilograms', (await text(page, '#od-ingredients .od-ing[data-id="brisket"] .od-read')).includes('16 kg'));
    await typeNum(page, 'Sold out at, Brisket', '800');
    await waitFor(page, () => SB.store.getState().ingredients.find((i) => i.id === 'brisket').thresholdG === 800);
    check('86 point saved', true);
    await typeNum(page, 'Cooked yield of Brisket', '58');
    await waitFor(page, () => Math.abs(SB.store.getState().ingredients.find((i) => i.id === 'brisket').yield - 0.58) < 1e-9);
    check('static yield typed as a percentage is stored as a fraction (0.58)', true);
    await typeNum(page, 'Cooked yield of Brisket', '900');
    await page.waitForTimeout(150);
    check('a yield of 900% is refused in words', /between 5% and 300%/.test(await text(page, '#od-ingredients .od-ing[data-id="brisket"] .od-ferr:not([hidden])')), await text(page, '#od-ingredients .od-ing[data-id="brisket"] .od-ferr:not([hidden])'));
    await page.locator('#od-ingredients .od-ing[data-id="brisket"] .seg [data-id="confirmed"]').click();
    await waitFor(page, () => SB.store.getState().ingredients.find((i) => i.id === 'brisket').yieldConfirmed === true);
    check('yield confirmed flag saved', true);
    await typeNum(page, 'Cost per kg of Brisket', '25.5');
    await waitFor(page, () => SB.store.getState().ingredients.find((i) => i.id === 'brisket').costPerKg === 25.5);
    check('cost per kg saved', true);
    await typeNum(page, 'Cost each of Buns', '0.5');
    await waitFor(page, () => SB.store.getState().ingredients.find((i) => i.id === 'buns').costEach === 0.5);
    check('counted items take a cost each and are labelled pieces', /pieces/.test(await text(page, '#od-ingredients .od-ing[data-id="buns"]')));
    const read = await st(page, () => Array.from(document.querySelectorAll('#od-ingredients .od-ing[data-id="brisket"] .chip')).map((c) => c.textContent));
    check('hold type and max hold hours are shown read-only as chips', read.includes('Hot hold') && read.some((t) => /Max hold 8 h/.test(t)), read);
    // The per-product Hold limit, Rest time and Cook time are editable now; the hold TYPE is still read-only.
    check('no editable field for hold type (hot or cold)', (await page.locator('#od-ingredients .od-ing[data-id="brisket"] input[aria-label^="Hold type"]').count()) === 0);
    check('weights are grams or kilograms only (no lb, oz or pounds in the ingredient copy)', !/\b(lbs?|oz|ounces?|pounds?)\b/i.test(await text(page, '#od-ingredients')));
    noErrors('ingredients panel', logs);
  });
});

/* ====================================================================================================================
 * 4. Thresholds per channel
 * ================================================================================================================== */
group('4. Ticket time limits by channel', async () => {
  await open({}, async (page, logs) => {
    const thr = (id) => st(page, (c) => SB.engine.channelThresholds(SB.store.getState().settings, c), id);
    const labels = await st(page, () => Array.from(document.querySelectorAll('#od-times .od-chan')).map((a) => a.dataset.channel + ':' + Array.from(a.querySelectorAll('.od-lab')).map((l) => l.textContent).join('|')));
    check('four channels, each with "Turns amber at" and "Overdue at"', labels.length === 4 && labels.every((l) => /Turns amber at\|Overdue at/.test(l)), labels);
    const prev0 = await text(page, '#od-times .od-chan[data-channel="dine_in"] .od-preview');
    check('live preview line starts from the real thresholds', prev0 === 'A dine-in ticket turns amber at 9:00 and overdue at 13:00.', prev0);
    await typeNum(page, 'Dine-in turns amber at (seconds)', '600');
    await waitFor(page, () => SB.engine.channelThresholds(SB.store.getState().settings, 'dine_in').warnSec === 600);
    check('amber time saved through updateSettings (channels patch)', (await thr('dine_in')).warnSec === 600);
    check('the stepper reads minutes beside the seconds (10 min)', (await text(page, '#od-times .od-chan[data-channel="dine_in"] .od-read')).startsWith('10 min'));
    check('the preview line follows the new value', (await text(page, '#od-times .od-chan[data-channel="dine_in"] .od-preview')) === 'A dine-in ticket turns amber at 10:00 and overdue at 13:00.');
    check('only dine-in changed (takeout is still 8:00)', (await thr('takeout')).warnSec === 480);
    // amber has to stay before overdue
    await typeNum(page, 'Dine-in turns amber at (seconds)', '900');
    await page.waitForTimeout(150);
    const e1 = await text(page, '#od-times .od-nf:has(input[aria-label="Dine-in turns amber at (seconds)"]) .od-ferr:not([hidden])');
    check('amber after overdue is refused with words that say what to do', /Amber has to come before overdue \(13:00\)\. Raise the overdue time first/.test(e1), e1);
    check('amber is back at 10:00 after the refusal', (await thr('dine_in')).warnSec === 600 && (await input(page, 'Dine-in turns amber at (seconds)').inputValue()) === '600');
    await typeNum(page, 'Dine-in overdue at (seconds)', '540');
    await page.waitForTimeout(150);
    const e2 = await text(page, '#od-times .od-nf:has(input[aria-label="Dine-in overdue at (seconds)"]) .od-ferr:not([hidden])');
    check('overdue before amber is refused with the earliest allowed time', /Overdue has to come after amber \(10:00\)\. Use 10:01 or later\./.test(e2), e2);
    await typeNum(page, 'Dine-in overdue at (seconds)', '900');
    await waitFor(page, () => SB.engine.channelThresholds(SB.store.getState().settings, 'dine_in').breachSec === 900);
    await typeNum(page, 'Dine-in turns amber at (seconds)', '5');
    await page.waitForTimeout(150);
    check('amber below the minimum is refused with the range', /between 0:30 and 120:00/.test(await text(page, '#od-times .od-nf:has(input[aria-label="Dine-in turns amber at (seconds)"]) .od-ferr:not([hidden])')), await text(page, '#od-times .od-nf:has(input[aria-label="Dine-in turns amber at (seconds)"]) .od-ferr:not([hidden])'));
    await typeNum(page, 'Drive-thru overdue at (seconds)', '999999');
    await page.waitForTimeout(150);
    check('an absurd overdue time is refused', /between 1:00 and 180:00/.test(await text(page, '#od-times .od-nf:has(input[aria-label="Drive-thru overdue at (seconds)"]) .od-ferr:not([hidden])')));
    const saved = await text(page, '#od-times .od-chan[data-channel="dine_in"] > .od-st');
    check('every saved row says Saved in words', /Saved\./.test(saved), saved);
    await page.locator('#od-times').getByRole('button', { name: 'Reset times to starter values' }).click();
    await waitFor(page, () => SB.engine.channelThresholds(SB.store.getState().settings, 'dine_in').warnSec === 540);
    const all = await st(page, () => SB.config.channels.every((c) => { const t = SB.engine.channelThresholds(SB.store.getState().settings, c.id); return t.warnSec === c.warnSec && t.breachSec === c.breachSec; }));
    check('reset puts all four channels back to the starter times', all);
    check('the fields follow the reset', (await input(page, 'Dine-in overdue at (seconds)').inputValue()) === '780');
    noErrors('times panel', logs);
  });
});

/* ====================================================================================================================
 * 5. Pacing
 * ================================================================================================================== */
group('5. Pacing', async () => {
  await open({}, async (page, logs) => {
    const pc = () => st(page, () => SB.store.getState().settings.pacing);
    const txt = await text(page, '#od-pacing .od-intro');
    check('pacing opens with a two-sentence explanation of meal pacing', (txt.match(/\./g) || []).length === 2 && /slowest item starts first/.test(txt), txt);
    const on0 = (await pc()).enabled;
    await page.locator('#od-pacing-toggle').click();
    await waitFor(page, (v) => SB.store.getState().settings.pacing.enabled === !v, on0);
    check('the on/off switch saves pacing.enabled', (await pc()).enabled === !on0);
    check('and says what it does for new tickets', /Finish together is (on|off)\./.test(await text(page, '#od-pacing .od-st')), await text(page, '#od-pacing .od-st'));
    await page.locator('#od-pacing-toggle').click();
    await waitFor(page, (v) => SB.store.getState().settings.pacing.enabled === v, on0);
    const specs = [['Shortest prep time', '20', 'floorSec', 20], ['Extra time per extra portion', '30', 'qtyFactor', 0.3], ['Most a big line can grow', '3', 'qtyCap', 3], ['How fast it learns your real times', '8', 'learnK', 8], ['Learned time never below', '0.6', 'minFactor', 0.6], ['Learned time never above', '3', 'maxFactor', 3], ['Ignore a timing longer than', '4', 'outlierFactor', 4]];
    for (const [label, typed, key, want] of specs) {
      await typeNum(page, label, typed);
      await waitFor(page, ([k, w]) => Math.abs(SB.store.getState().settings.pacing[k] - w) < 1e-9, [key, want]);
      check(label + ' saved as ' + key + ' = ' + want, true);
    }
    check('each pacing field carries a one-line plain meaning and its allowed range', await st(page, () => Array.from(document.querySelectorAll('#od-pacing .od-nf')).every((n) => /Allowed: /.test(n.querySelector('.od-hint') ? n.querySelector('.od-hint').textContent : ''))));
    // out of bounds, named in words
    const refusals = [['Shortest prep time', '900', /Shortest prep time has to be between 1 s and 600 s\./], ['Extra time per extra portion', '500', /Extra time per extra portion has to be between 0% and 200%\./], ['Most a big line can grow', '11', /Most a big line can grow has to be between 1× and 10×\./], ['How fast it learns your real times', '99', /How fast it learns your real times has to be between 0 timings and 50 timings\./], ['Learned time never below', '2', /Learned time never below has to be between 0\.1 times the starter time and 1 times the starter time\./]];
    for (const [label, typed, re] of refusals) {
      await typeNum(page, label, typed);
      await page.waitForTimeout(120);
      const nf = page.locator('#od-pacing .od-nf', { has: page.locator(`input[aria-label="${label}"]`) });
      const t = (await nf.locator('.od-ferr:not([hidden])').textContent() || '').replace(/\s+/g, ' ');
      check(label + ' ' + typed + ' is refused in words', re.test(t), t);
    }
    const p1 = await pc();
    check('refused values left the saved pacing as it was', p1.floorSec === 20 && p1.qtyCap === 3 && p1.learnK === 8, p1);
    await page.locator('#od-pacing').getByRole('button', { name: 'Reset to starter values' }).click();
    await waitFor(page, () => SB.store.getState().settings.pacing.floorSec === SB.config.pacing.floorSec);
    const p2 = await st(page, () => { const p = SB.store.getState().settings.pacing; return Object.keys(SB.config.pacing).filter((k) => k !== 'enabled').every((k) => p[k] === SB.config.pacing[k]); });
    check('reset puts every pacing number back to the starter value', p2);
    check('reset leaves the on/off switch alone', (await pc()).enabled === on0);
    check('the fields show the starter values again', (await input(page, 'How fast it learns your real times').inputValue()) === '3');
    noErrors('pacing panel', logs);
  });
});

/* ====================================================================================================================
 * 6. Food safety
 * ================================================================================================================== */
group('6. Food safety limits', async () => {
  await open({}, async (page, logs) => {
    const sf = () => st(page, () => SB.store.getState().settings.safety);
    const sline = await text(page, '#od-safety .od-safetyline');
    check('the safety line is shown word for word', sline === await st(page, () => SB.config.safetyLine), sline);
    check('the panel says the FDA Food Code minimum for hot hold is 135 °F', /refuses a hot-hold limit below 135 °F/.test(await text(page, '#od-safety')));
    const hint = await text(page, '#od-safety .od-nf:has(input[aria-label="Hot hold temperature"]) .od-hint');
    check('legal limits are printed under the field (min 135 °F)', /Model Food Code minimum 135 °F/.test(hint) && /Allowed: 135 to 200 °F/.test(hint), hint);
    const f0 = await eventsOf(page, 'ui_report');
    await typeNum(page, 'Hot hold temperature', '120');
    await page.waitForTimeout(150);
    const err = await text(page, '#od-safety .od-nf:has(input[aria-label="Hot hold temperature"]) .od-ferr:not([hidden])');
    check('hot hold of 120 is refused: names the field and the 135 °F minimum', /Hot hold temperature has to be between 135 °F and 200 °F\./.test(err) && /135 °F/.test(err), err);
    check('the old value (135) stays in the field and in the state', (await sf()).hotHoldF === 135 && (await input(page, 'Hot hold temperature').inputValue()) === '135');
    check('the refusal is counted as friction', (await eventsOf(page, 'ui_report')) === f0 + 1);
    await typeNum(page, 'Hot hold temperature', '140');
    await waitFor(page, () => SB.store.getState().settings.safety.hotHoldF === 140);
    check('a legal value (140 °F) is saved', true);
    await typeNum(page, 'Reheat to', '150');
    await page.waitForTimeout(120);
    check('reheat below 165 °F is refused naming the field', /Reheat to has to be between 165 °F and 212 °F/.test(await text(page, '#od-safety .od-nf:has(input[aria-label="Reheat to"]) .od-ferr:not([hidden])')));
    await typeNum(page, 'Cold hold temperature', '45');
    await page.waitForTimeout(120);
    check('cold hold above 41 °F is refused naming the field', /Cold hold temperature has to be between 33 °F and 41 °F/.test(await text(page, '#od-safety .od-nf:has(input[aria-label="Cold hold temperature"]) .od-ferr:not([hidden])')));
    await typeNum(page, 'Time allowed below hot hold', '3');
    await page.waitForTimeout(120);
    check('more than the 2 hour limit below hot hold is refused', /between 0\.5 hours and 2 hours/.test(await text(page, '#od-safety .od-nf:has(input[aria-label="Time allowed below hot hold"]) .od-ferr:not([hidden])')));
    await typeNum(page, 'Sanitize food-contact surfaces every', '6');
    await page.waitForTimeout(120);
    check('sanitize interval above 4 hours is refused', /between 1 hour and 4 hours/.test(await text(page, '#od-safety .od-nf:has(input[aria-label="Sanitize food-contact surfaces every"]) .od-ferr:not([hidden])')));
    // cross-field cooling rule explained
    await typeNum(page, 'Total cooling time', '1.5');
    await page.waitForTimeout(150);
    const ec = await text(page, '#od-safety .od-nf:has(input[aria-label="Total cooling time"]) .od-ferr:not([hidden])');
    check('total cooling shorter than the first stage is refused with words', /longer than the first stage \(2 hours\)/.test(ec), ec);
    await typeNum(page, 'Hold limit for a product with none of its own', '6');
    await waitFor(page, () => SB.store.getState().settings.safety.defaultMaxHoldH === 6);
    await typeNum(page, 'Temperature check every', '45');
    await waitFor(page, () => SB.store.getState().settings.safety.tempCheckEveryMin === 45);
    check('other limits inside their bounds save', true);
    const s = await sf();
    check('refused values never reached the state (reheat 165, cold 41, cooling total 6)', s.reheatF === 165 && s.coldHoldF === 41 && s.cooling.totalH === 6, s);
    noErrors('safety panel', logs);
  });
});

/* ====================================================================================================================
 * 7. Manager PIN
 * ================================================================================================================== */
group('7. Manager PIN', async () => {
  await open({}, async (page, logs) => {
    const hash = () => st(page, () => SB.store.getState().settings.office.pinHash);
    const note = await text(page, '#od-pin');
    check('the honest note about what a PIN is', note.includes('This keeps line cooks out of the back office. It is not real security: anyone with the file or the device can read the data.'), note);
    check('starts with no PIN, and says so', (await hash()) === null && /No PIN is set/.test(note));
    const pin = page.locator('#od-pin');
    await pin.getByRole('button', { name: 'Set a PIN' }).click();
    await pin.getByLabel('New PIN', { exact: true }).pressSequentially('1a2b3c4');
    check('the PIN field accepts digits only', (await pin.getByLabel('New PIN', { exact: true }).inputValue()) === '1234');
    await pin.getByLabel('Type the new PIN again').fill('4321');
    await pin.getByRole('button', { name: 'Set PIN' }).click();
    await page.waitForTimeout(150);
    check('two different entries are refused, nothing saved', /do not match/.test(await text(page, '#od-pin .field-error:not([hidden])')) && (await hash()) === null);
    await pin.getByLabel('Type the new PIN again').fill('1234');
    await pin.getByRole('button', { name: 'Set PIN' }).click();
    await waitFor(page, () => !!SB.store.getState().settings.office.pinHash);
    const h1 = await hash();
    check('PIN stored as a hash, not as digits', /^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(h1) && !h1.includes('1234'), h1);
    check('the page now offers Change and Remove', (await pin.getByRole('button', { name: 'Change PIN' }).count()) === 1 && (await pin.getByRole('button', { name: 'Remove PIN' }).count()) === 1);
    check('a toast confirms it', /PIN set/.test(await text(page, '.toast')));
    // change: needs the current PIN
    await pin.getByRole('button', { name: 'Change PIN' }).click();
    await pin.getByLabel('Current PIN').fill('0000');
    await pin.getByLabel('New PIN', { exact: true }).fill('5678');
    await pin.getByLabel('Type the new PIN again').fill('5678');
    await pin.locator('form button[type="submit"]').click();
    await page.waitForTimeout(250);
    check('a wrong current PIN is refused and nothing changes', /not the current PIN/.test(await text(page, '#od-pin .field-error:not([hidden])')) && (await hash()) === h1);
    await pin.getByLabel('Current PIN').fill('1234');
    await pin.locator('form button[type="submit"]').click();
    await waitFor(page, (x) => SB.store.getState().settings.office.pinHash !== x, h1);
    const h2 = await hash();
    check('with the right current PIN the new one is saved', /^pbkdf2:/.test(h2) && h2 !== h1);
    check('the new PIN works, the old one does not', (await page.evaluate(async () => (await SB.shell.checkPin('5678')) && !(await SB.shell.checkPin('1234')))) === true);
    // the gate shows up next time the office is opened
    await page.evaluate(async () => { await SB.shell.extinguish(); SB.shell.lock(); }); // leaving starts a 2 minute grace; lock() ends it
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__ig = SB.shell.ignite(); });
    await page.waitForSelector('.sheet[role="dialog"] .keypad', { timeout: 4000 }).then(() => check('opening the office again asks for the PIN', true), () => check('opening the office again asks for the PIN', false));
    await page.locator('.sheet .keypad .key', { hasText: /^5$/ }).click();
    await page.locator('.sheet .keypad .key', { hasText: /^6$/ }).click();
    await page.locator('.sheet .keypad .key', { hasText: /^7$/ }).click();
    await page.locator('.sheet .keypad .key', { hasText: /^8$/ }).click();
    await page.waitForFunction(() => SB.shell.inOffice() && !document.querySelector('.sheet .keypad'), null, { timeout: 5000 }).catch(() => {});
    check('the new PIN opens the office', await page.evaluate(() => SB.shell.inOffice()));
    await page.waitForSelector('.od .od-panel');
    await goPanel(page, 'pin');
    // clear
    await page.locator('#od-pin').getByRole('button', { name: 'Remove PIN' }).click();
    await page.locator('#od-pin').getByLabel('Current PIN').fill('5678');
    await page.locator('#od-pin form button[type="submit"]').click();
    await waitFor(page, () => SB.store.getState().settings.office.pinHash === null);
    check('Remove PIN with the current PIN clears the hash', (await hash()) === null && (await page.evaluate(() => SB.shell.hasPin())) === false);
    check('and the page says no PIN is set again', /No PIN is set/.test(await text(page, '#od-pin .od-pinstate')));
    noErrors('pin panel', logs);
  });
});

/* ====================================================================================================================
 * 8. Appearance, service hours, sound
 * ================================================================================================================== */
group('8. Appearance and service hours', async () => {
  await open({}, async (page, logs) => {
    const look = page.locator('#od-look');
    // The page also has a "Warnings may sound outside open hours" switch, so look for the sound switch by its label.
    check('no sound switch when this build has no SB.floor.setSound', (await look.locator('.toggle', { hasText: 'Sound on the line' }).count()) === 0);
    await look.locator('[aria-label="Back office theme"] [data-id="paper"]').click();
    await page.waitForTimeout(150);
    check('Paper makes the office light', (await st(page, () => ({ t: SB.theme.office(), a: document.querySelector('.office').getAttribute('data-otheme') }))).a === 'paper');
    await look.locator('[aria-label="Back office theme"] [data-id="ember"]').click();
    check('Ember brings the dark theme back', (await st(page, () => SB.theme.office())) === 'ember');
    await look.locator('[aria-label="Line theme"] [data-id="night"]').click();
    check('line theme Night is set', (await st(page, () => SB.theme.get())) === 'night');
    await look.locator('[aria-label="Line theme"] [data-id="day"]').click();
    await look.locator('[aria-label="Text size"] [data-id="large"]').click();
    check('text size Large is set', (await st(page, () => SB.theme.textSize())) === 'large' && (await st(page, () => document.documentElement.classList.contains('text-large'))));
    await look.locator('[aria-label="Text size"] [data-id="normal"]').click();
    // a theme change made elsewhere updates the page
    await page.evaluate(() => SB.theme.setOffice('paper'));
    await page.waitForTimeout(100);
    check('a theme change from the frame updates the switch here', (await look.locator('[aria-label="Back office theme"] [aria-checked="true"]').getAttribute('data-id')) === 'paper');
    await page.evaluate(() => SB.theme.setOffice('ember'));
    // service hours
    await typeNum(page, 'Opens at', '10');
    await waitFor(page, () => SB.store.getState().settings.service.openHour === 10);
    check('opening hour saved and read as a time of day', /10 am/.test(await text(page, '#od-look .od-nf:has(input[aria-label="Opens at"]) .od-read')));
    await typeNum(page, 'Closes at', '8');
    await page.waitForTimeout(100);
    const e1 = await text(page, '#od-look .od-nf:has(input[aria-label="Closes at"]) .od-ferr:not([hidden])');
    check('closing before opening is refused with words', /Closing has to be after opening \(10 am\)/.test(e1), e1);
    await typeNum(page, 'Opens at', '23');
    await page.waitForTimeout(100);
    check('opening after closing is refused with words', /Opening has to be before closing \(9 pm\)/.test(await text(page, '#od-look .od-nf:has(input[aria-label="Opens at"]) .od-ferr:not([hidden])')));
    await typeNum(page, 'Closes at', '26');
    await waitFor(page, () => SB.store.getState().settings.service.closeHour === 26);
    check('a closing time past midnight is allowed and read in words', /2 am \(next day\)/.test(await text(page, '#od-look .od-nf:has(input[aria-label="Closes at"]) .od-read')));
    await typeNum(page, 'Service day starts at', '9');
    await page.waitForTimeout(100);
    check('a service day starting after 8 am is refused', /between 12 am and 8 am/.test(await text(page, '#od-look .od-nf:has(input[aria-label="Service day starts at"]) .od-ferr:not([hidden])')));
    await typeNum(page, 'Service day starts at', '5');
    await waitFor(page, () => SB.store.getState().settings.service.dayStartHour === 5);
    check('service day start saved', true);

    // sound, with a stub of the floor's setSound / sound pair (the real floor board is another agent's file)
    await page.evaluate(() => { SB.floor = SB.floor || {}; let on = false; SB.floor.__calls = []; SB.floor.setSound = (v) => { on = !!v; SB.floor.__calls.push(v); return on; }; SB.floor.sound = () => on; SB.office.navigate('pace'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => SB.office.navigate('data'));
    await page.waitForSelector('#od-look');
    await page.locator('#od-look .toggle', { hasText: 'Sound on the line' }).click();
    check('sound switch calls SB.floor.setSound(true) and says so', (await page.evaluate(() => SB.floor.__calls.join(','))) === 'true' && /Sound is on/.test(await text(page, '#od-look .od-st')));
    noErrors('appearance panel', logs);
  });
});

/* ====================================================================================================================
 * 9. Data: counts, sample history, export, import, reset
 * ================================================================================================================== */
const SIM_STUB = () => {
  window.SB = window.SB || {};
  let on = true;
  SB.sim = { __stub: true, calls: [], sampleEnabled: () => on, setSampleEnabled(v) { on = !!v; SB.sim.calls.push(v); }, sampleInfo: () => ({ note: 'Stub note: generated by a simulator that runs the real engine.' }), sample: () => null };
};
group('9a. Data: counts and sample history', async () => {
  await open({}, async (page, logs) => {
    const made = await makeTickets(page, 12);
    await page.waitForTimeout(300);
    const stats = await st(page, () => Object.fromEntries(Array.from(document.querySelectorAll('#od-data .od-stats:not(.od-stats-tight) .od-stat')).map((s) => [s.querySelector('dt').textContent, s.querySelector('dd').textContent])));
    check('counts show tickets, events, batches and storage size', stats['Tickets'] === '12' && /^\d/.test(stats['Logged events']) && /^\d+$/.test(stats['Hold-cabinet batches']) && /(KB|MB|bytes)/.test(stats['Stored on this device']), stats);
    const real = await st(page, () => ({ t: SB.store.getState().tickets.length, e: SB.engine.allEvents(SB.store.getState()).length, b: SB.store.getState().batches.length }));
    check('the counts match the store (' + JSON.stringify(real) + ')', stats['Tickets'] === String(real.t) && stats['Logged events'].replace(/,/g, '') === String(real.e) && stats['Hold-cabinet batches'] === String(real.b), [stats, real]);
    await page.evaluate(() => SB.store.dispatch('createTicket', { customer: 'Demo', channel: SB.config.channels[0].id, items: [{ menuId: SB.config.menu[0].id }], src: 'demo' }));
    await page.waitForTimeout(300);
    check('demo tickets are named as demo, not live', (await text(page, '#od-data .od-stats:not(.od-stats-tight) .od-stat')) .includes('12 live, 1 demo'), await text(page, '#od-data .od-stats:not(.od-stats-tight) .od-stat'));
    check('without a simulator the page says sample history is not available', /Sample history is not available/.test(await text(page, '#od-data .od-sample')) && stats['Sample tickets'] === 'Not loaded', stats['Sample tickets']);
    check('and still explains what sample data is', /not your restaurant/.test(await text(page, '#od-data .od-sample')));
    noErrors('data counts', logs);
  });
  // with a stub simulator
  await open({ init: SIM_STUB }, async (page, logs) => {
    const note = await text(page, '#od-data .od-sample');
    check('with a simulator: the toggle is there and the note comes from SB.sim.sampleInfo().note', /Stub note/.test(note) && (await page.locator('#od-data .od-sample .toggle').count()) === 1, note);
    check('the toggle starts from sampleEnabled() (on)', (await page.locator('#od-data .od-sample .toggle').getAttribute('aria-checked')) === 'true');
    await page.locator('#od-data .od-sample .toggle').click();
    await page.waitForTimeout(100);
    check('turning it off calls setSampleEnabled(false) and says what changes', (await page.evaluate(() => SB.sim.calls.join(','))) === 'false' && /Sample history is off/.test(await text(page, '.toast')));
    await page.evaluate(() => SB.sim.setSampleEnabled(true));
    await page.evaluate(() => SB.office.navigate('pace')); await page.evaluate(() => SB.office.navigate('data'));
    await page.waitForSelector('#od-data');
    check('re-opening the page re-reads sampleEnabled()', (await page.locator('#od-data .od-sample .toggle').getAttribute('aria-checked')) === 'true');
    noErrors('sample toggle', logs);
  });
});

group('9b. Data: saveFile (host, browser, copy)', async () => {
  await open({}, async (page, logs) => {
    const call = (mode) => page.evaluate(async (m) => {
      const calls = [];
      delete window.claude;
      if (m === 'host') window.claude = { use: async (name) => ({ save: async (a) => { calls.push({ name, a }); return { status: 'saved' }; } }) };
      if (m === 'declined') window.claude = { use: async () => ({ save: async (a) => { calls.push(a); const e = new Error('no'); e.code = 'declined'; throw e; } }) };
      if (m === 'other') window.claude = { use: async () => ({ save: async (a) => { calls.push(a); const e = new Error('boom'); e.code = 'unsupported'; throw e; } }) };
      if (m === 'null') window.claude = { use: async () => null };
      if (m === 'usethrows') window.claude = { use: async () => { throw new Error('no capability'); } };
      if (m === 'notfn') window.claude = { use: 5 };
      const r = await SB.dataPage.saveFile('x.json', '{"a":1}', 'application/json');
      return { r, calls };
    }, mode);
    const dl = async (fn) => { const p = page.waitForEvent('download', { timeout: 2500 }).catch(() => null); const r = await fn(); return { r, d: await p }; };

    let o = await dl(() => call('host'));
    check('host capability: save() gets {filename, data} and no browser download starts', o.r.r.how === 'host' && o.r.r.status === 'saved' && o.r.calls.length === 1 && o.r.calls[0].name === 'downloads' && o.r.calls[0].a.filename === 'x.json' && o.r.calls[0].a.data === '{"a":1}' && !o.d, JSON.stringify([o.r, !!o.d]));
    o = await dl(() => call('declined'));
    check('declined: reported as declined, never retried, no browser download', o.r.r.how === 'declined' && o.r.calls.length === 1 && !o.d, JSON.stringify([o.r, !!o.d]));
    o = await dl(() => call('other'));
    check('any other error code falls through to the browser download', o.r.r.how === 'browser' && o.r.calls.length === 1 && !!o.d && o.d.suggestedFilename() === 'x.json', JSON.stringify(o.r));
    o = await dl(() => call('null'));
    check('use("downloads") resolving null falls through to the browser download', o.r.r.how === 'browser' && !!o.d, JSON.stringify(o.r));
    o = await dl(() => call('usethrows'));
    check('use("downloads") throwing falls through to the browser download', o.r.r.how === 'browser' && !!o.d, JSON.stringify(o.r));
    o = await dl(() => call('notfn'));
    check('window.claude without a use function falls through', o.r.r.how === 'browser' && !!o.d, JSON.stringify(o.r));
    o = await dl(() => call('none'));
    check('no window.claude at all: plain browser download with the file name', o.r.r.how === 'browser' && !!o.d && o.d.suggestedFilename() === 'x.json', JSON.stringify(o.r));
    if (o.d) check('the downloaded file holds the exact text', fs.readFileSync(await o.d.path(), 'utf8') === '{"a":1}');

    // through the buttons
    const click = async (sel) => { await goPanel(page, 'data'); await page.locator(sel).first().scrollIntoViewIfNeeded(); await page.locator(sel).first().click(); await page.waitForTimeout(200); };
    await page.evaluate(() => { delete window.claude; });
    const ds = new Date(); const ymd = ds.getFullYear() + '-' + String(ds.getMonth() + 1).padStart(2, '0') + '-' + String(ds.getDate()).padStart(2, '0');
    const [d1] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), click('[data-action="backup-download"]')]);
    check('plain browser: backup file is smokebox-backup-YYYY-MM-DD.json', d1.suggestedFilename() === 'smokebox-backup-' + ymd + '.json', d1.suggestedFilename());
    const backup = fs.readFileSync(await d1.path(), 'utf8');
    const valid = await page.evaluate((t) => { const v = SB.engine.validateBackup(t); return { ok: v.ok, err: v.error, tickets: v.ok ? v.state.tickets.length : -1 }; }, backup);
    check('the exported JSON is accepted by validateBackup', valid.ok, valid);
    check('the page says the download started (and what to do if nothing arrives)', /Download started: smokebox-backup-/.test(await text(page, '#od-data .od-st')) && /Copy backup/.test(await text(page, '#od-data .od-st')));
    await makeTickets(page, 3);
    await page.evaluate(() => { const d = document.querySelector('#od-data .od-more'); if (d) d.open = true; });
    for (const k of ['tickets', 'items', 'events', 'batches']) {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), click(`[data-csv="${k}"]`)]);
      const csv = fs.readFileSync(await d.path(), 'utf8');
      check('CSV ' + k + ': named smokebox-' + k + '-date.csv with a header row', d.suggestedFilename() === `smokebox-${k}-${ymd}.csv` && csv.split('\n')[0].length > 10, [d.suggestedFilename(), csv.split('\n')[0].slice(0, 60)]);
      if (k === 'tickets') check('CSV tickets has one row per ticket plus the header', csv.trim().split('\n').length === 1 + (await st(page, () => SB.store.getState().tickets.length)));
    }
    // host capability through the buttons
    await page.evaluate(() => { window.__saved = []; window.claude = { use: async () => ({ save: async (a) => { window.__saved.push(a); return { status: 'saved' }; } }) }; });
    await click('[data-action="backup-download"]');
    const hs = await page.evaluate(() => window.__saved.map((a) => a.filename));
    check('in the viewer: the backup goes through the host and says Saved', hs.length === 1 && /^smokebox-backup-/.test(hs[0]) && /^Saved smokebox-backup-.*\.json \(/.test(await text(page, '#od-data .od-st')), [hs, await text(page, '#od-data .od-st')]);
    await page.evaluate(() => { window.claude = { use: async () => ({ save: async () => { const e = new Error('x'); e.code = 'declined'; throw e; } }) }; });
    await click('[data-csv="tickets"]');
    check('in the viewer: a decline is said plainly and nothing else happens', /You chose not to save the file/.test(await text(page, '#od-data .od-st')), await text(page, '#od-data .od-st'));
    await page.evaluate(() => { delete window.claude; });

    // copy backup: success and the fallback
    await page.evaluate(() => { window.__clip = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clip = t; return Promise.resolve(); } } }); });
    await click('[data-action="backup-copy"]');
    const clip = await page.evaluate(() => window.__clip);
    check('Copy backup writes the full backup to the clipboard', typeof clip === 'string' && (await page.evaluate((t) => SB.engine.validateBackup(t).ok, clip)));
    check('and says how much was copied', /^Copied \d+ KB to the clipboard\./.test(await text(page, '#od-data .od-st')) || /^Copied \d+ bytes/.test(await text(page, '#od-data .od-st')), await text(page, '#od-data .od-st'));
    check('the fallback box is not shown when copying worked', !(await visible(page, '#od-data .od-fallback')));
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('blocked')) } }); });
    await click('[data-action="backup-copy"]');
    await page.waitForTimeout(150);
    const fbv = await page.evaluate(() => { const t = document.querySelector('#od-data .od-fbtext'); return { shown: !t.closest('[hidden]'), len: t.value.length, sel: t.selectionEnd - t.selectionStart, ro: t.readOnly, focus: document.activeElement === t }; });
    check('when the clipboard is blocked, the backup is shown in a read-only box, selected', fbv.shown && fbv.len > 1000 && fbv.sel === fbv.len && fbv.ro && fbv.focus, fbv);
    check('and the page tells the person to copy it by hand', /backup is selected below/.test(await text(page, '#od-data .od-st')), await text(page, '#od-data .od-st'));
    noErrors('save and copy', logs);
  });
});

group('9c. Data: import', async () => {
  await open({}, async (page, logs, dialogs) => {
    await makeTickets(page, 12);
    await page.waitForTimeout(200);
    const backup = await page.evaluate(() => SB.store.exportAll());
    const nT = 12, nB = await st(page, () => SB.store.getState().batches.length);
    await page.evaluate(() => SB.store.dispatch('resetLive', { keepSettings: true }));
    await page.waitForTimeout(200);
    check('(setup) live data cleared before importing', (await st(page, () => SB.store.getState().tickets.length)) === 0);
    await goPanel(page, 'data');
    const fileIn = page.locator('#od-data input[type="file"]');
    await fileIn.setInputFiles({ name: 'my-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.waitForSelector('#od-data .od-impresult .od-card');
    const card = await text(page, '#od-data .od-impresult .od-card');
    check('a valid file shows a summary before anything changes', /valid Smokebox backup/.test(card) && new RegExp('Tickets' + nT).test(card) && /Kind/.test(card) && /Dishes21/.test(card) && /Orders/.test(card), card);
    check('the summary says it replaces everything on this device, with the real counts', card.includes('This replaces everything on this device: 0 tickets, ' + nB + ' batches') && /Back up first/.test(card), card);
    check('nothing has changed yet', (await st(page, () => SB.store.getState().tickets.length)) === 0);
    await page.locator('[data-action="import-replace"]').click();
    let sheet = await confirmSheet(page, 'cancel');
    check('the confirm step spells out the consequence and is a danger dialog', /can be undone/.test(sheet) && /Replace everything/.test(sheet) && /12 tickets/.test(sheet), sheet);
    check('cancel leaves everything as it was', (await st(page, () => SB.store.getState().tickets.length)) === 0);
    await page.locator('[data-action="import-replace"]').click();
    await confirmSheet(page, 'confirm');
    await waitFor(page, () => SB.store.getState().tickets.length === 12);
    check('confirming replaces the state with the backup (12 tickets)', true);
    check('and says it was restored', /Backup restored: 12 tickets/.test(await text(page, '#od-data .od-impresult')), await text(page, '#od-data .od-impresult'));
    check('the same file imported again is accepted (the picker was reset)', await (async () => { await fileIn.setInputFiles({ name: 'my-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) }); await page.waitForSelector('#od-data .od-impresult [data-action="import-replace"]'); return true; })());
    await page.locator('#od-data .od-impresult').getByRole('button', { name: 'Cancel' }).click();

    // refusals: nothing changes, the reason is given
    const before = await stateJson(page);
    const bad = [
      ['garbage text', 'hello, this is not a backup', /could not be read/],
      ['truncated JSON', backup.slice(0, backup.length >> 1), /could not be read/],
      ['empty file', '', /nothing in it/],
      ['an unrelated JSON object', '{"a":1,"b":[1,2,3]}', /does not say which Smokebox version|not a Smokebox backup/],
      ['a JSON list', '[1,2,3]', /not a Smokebox backup|top level/],
      ['a backup with a wrong version', (() => { const e = JSON.parse(backup); e.state.v = 99; return JSON.stringify(e); })(), /different Smokebox version|does not say which/],
      ['a backup whose tickets are not a list', (() => { const e = JSON.parse(backup); e.state.tickets = 'nope'; return JSON.stringify(e); })(), /no tickets list|not a Smokebox backup|contradict|could not be read/],
    ];
    for (const [label, body, re] of bad) {
      await fileIn.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(body) });
      await page.waitForSelector('#od-data .od-impresult .od-card[data-tone="bad"]', { timeout: 3000 }).catch(() => {});
      const t = await text(page, '#od-data .od-impresult');
      check('refused: ' + label + ', with the reason in words', /cannot be used/.test(t) && re.test(t) && /Nothing was changed\./.test(t), t);
      check('   no replace button is offered for ' + label, (await page.locator('[data-action="import-replace"]').count()) === 0);
    }
    check('after all those refusals the state is byte-for-byte unchanged', (await stateJson(page)) === before);

    // paste instead
    await page.locator('#od-data .od-paste-det summary', { hasText: 'Paste a backup instead' }).click(); // a second details (Replacing this device) also has this class
    await page.locator('#od-data .od-paste').fill(backup);
    await page.locator('[data-action="import-check-paste"]').click();
    await page.waitForSelector('#od-data .od-impresult [data-action="import-replace"]');
    const card2 = await text(page, '#od-data .od-impresult .od-card');
    check('pasting a backup runs the same validation and shows the same summary', /valid Smokebox backup/.test(card2) && /This replaces everything on this device/.test(card2) && /pasted text/.test(card2), card2);
    await page.locator('#od-data .od-paste').fill('{"v":1,');
    await page.locator('[data-action="import-check-paste"]').click();
    await page.waitForTimeout(150);
    check('pasting a broken backup is refused with the reason', /cannot be used/.test(await text(page, '#od-data .od-impresult')) && /could not be read/.test(await text(page, '#od-data .od-impresult')));
    await page.locator('#od-data .od-paste').fill('   ');
    await page.locator('[data-action="import-check-paste"]').click();
    check('pasting nothing says so', /nothing in it/.test(await text(page, '#od-data .od-impresult')));
    check('the state is still unchanged after the paste refusals', (await stateJson(page)) === before);
    // a changed price in the backup proves the import replaces settings too
    const env = JSON.parse(backup); env.state.menu[0].price = 8.25;
    await page.locator('#od-data .od-paste').fill(JSON.stringify(env));
    await page.locator('[data-action="import-check-paste"]').click();
    await page.waitForSelector('[data-action="import-replace"]');
    await page.locator('[data-action="import-replace"]').click();
    await confirmSheet(page, 'confirm');
    await waitFor(page, () => SB.store.getState().menu[0].price === 8.25);
    await page.waitForTimeout(300);
    check('a pasted backup replaces the menu too, and the open price field follows', (await input(page, 'Price of ' + MENU.name).inputValue()) === '8.25');
    check('no browser dialogs were used', dialogs.length === 0, dialogs);
    noErrors('import', logs);
  });
});

group('9d. Data: reset', async () => {
  await open({}, async (page, logs, dialogs) => {
    await makeTickets(page, 9);
    await typeNum(page, 'Price of ' + MENU.name, '9.75');
    await waitFor(page, () => SB.store.getState().menu.find((m) => m.id === 'brisket_qtr').price === 9.75);
    await page.evaluate(() => SB.theme.setOffice('paper'));
    await goPanel(page, 'data');
    const live = page.locator('[data-action="reset-live"]');
    await live.scrollIntoViewIfNeeded();
    await live.click();
    let sheet = await typedBox(page, 'cancel');
    check('reset live data spells out what is cleared, and that settings stay by default', /clears 9 tickets/.test(sheet) && /Your dishes, ingredient edits, limits, Finish together and PIN stay/.test(sheet) && /no undo/i.test(sheet), sheet);
    check('cancel keeps the tickets', (await st(page, () => SB.store.getState().tickets.length)) === 9);
    await live.click();
    await typedBox(page, 'confirm');
    await waitFor(page, () => SB.store.getState().tickets.length === 0);
    check('confirming clears tickets', true);
    check('events and batches are reset to the starter set', await st(page, () => SB.engine.allEvents(SB.store.getState()).filter((e) => e.type === 'ticket_created').length === 0));
    check('settings and menu edits are kept (price 9.75)', (await st(page, () => SB.store.getState().menu.find((m) => m.id === 'brisket_qtr').price)) === 9.75);
    check('the page says what happened', /Live data erased/.test(await text(page, '#od-data')));
    // keep-settings off
    await makeTickets(page, 4);
    await page.locator('#od-data .od-toggle-row .toggle').click();
    await live.click();
    sheet = await typedBox(page, 'confirm');
    await waitFor(page, () => SB.store.getState().tickets.length === 0);
    check('with "keep" switched off, live reset also restores the starter menu and settings', (await st(page, () => SB.store.getState().menu.find((m) => m.id === 'brisket_qtr').price)) === 7.5 && /puts every setting, dish edit and the PIN back/.test(sheet), sheet);
    // everything
    await typeNum(page, 'Price of ' + MENU.name, '8');
    await waitFor(page, () => SB.store.getState().menu.find((m) => m.id === 'brisket_qtr').price === 8);
    await makeTickets(page, 5);
    await page.locator('[data-action="reset-all"]').click();
    sheet = await typedBox(page, 'confirm');
    await waitFor(page, () => SB.store.getState().tickets.length === 0 && SB.store.getState().menu.find((m) => m.id === 'brisket_qtr').price === 7.5);
    check('Reset everything clears tickets and puts the menu and settings back', true);
    check('its warning says it erases the PIN and cannot be undone', /PIN/.test(sheet) && /no undo/i.test(sheet), sheet);
    check('your theme choices are kept (Paper)', (await st(page, () => SB.theme.office())) === 'paper');
    await page.waitForTimeout(300);
    check('the open fields follow the reset', (await input(page, 'Price of ' + MENU.name).inputValue()) === '7.50');
    check('no browser dialogs were used', dialogs.length === 0, dialogs);
    noErrors('reset', logs);
  });
});

/* ====================================================================================================================
 * 10. About, copy rules
 * ================================================================================================================== */
group('10. About and wording', async () => {
  await open({}, async (page, logs) => {
    const about = await text(page, '#od-about');
    check('About says what is simulated (channel sync)', /demo or sample/i.test(about));
    check('About says what is a starter estimate', /starter estimate/.test(about));
    check('About says what has not been tested (real sunlight, other devices)', /real sunlight/.test(about) && /other devices/.test(about));
    check('About says separate devices do not share data and same-browser tablets do', /Separate devices do not share data\. Tablets open in the same browser on the same device do/.test(about));
    check('About does not mention Pitcall', !/Pitcall/.test(about));
    const copy = await st(page, () => {
      const els = Array.from(document.querySelectorAll('.od button, .od .od-lab, .od h2, .od h3, .od dt, .od .toggle-label, .od .seg-opt, .od .od-toc-link, .od summary')).filter((e) => e.offsetParent !== null);
      return els.map((e) => (e.textContent || '').trim()).filter(Boolean);
    });
    const caps = copy.filter((t) => t.length > 3 && t === t.toUpperCase() && /[A-Z]{4}/.test(t));
    check('no ALL-CAPS labels in buttons, headings or labels', caps.length === 0, caps);
    const badCopy = copy.filter((t) => /[→←↑↓⟶·•]/.test(t) || / > /.test(t));
    check('no arrows or middle-dot meta strings in buttons and labels, dish summary rows included', badCopy.length === 0, badCopy);
    const pageText = await st(page, () => document.querySelector('.od').innerText);
    const stray = pageText.match(/\b(NaN|undefined|null|\[object|Infinity|1e\+\d+)\b/g);
    check('no NaN, undefined, null or [object] anywhere on the page', !stray, stray);
    check('sentence case: no Title Case Headings In Panel Titles', await st(page, () => Array.from(document.querySelectorAll('.od-title')).every((h) => !/ [A-Z][a-z]+ [A-Z][a-z]+ [A-Z]/.test(h.textContent))));
    noErrors('about', logs);
  });
});

/* ====================================================================================================================
 * 11. Persistence, two tabs, half-typed values
 * ================================================================================================================== */
group('11. Reload, two tabs, half-typed values', async () => {
  await open({}, async (page, logs) => {
    await typeNum(page, 'Price of ' + MENU.name, '10.25');
    await typeNum(page, 'Dine-in turns amber at (seconds)', '420');
    await typeNum(page, 'Hot hold temperature', '142');
    await waitFor(page, () => SB.store.getState().settings.safety.hotHoldF === 142 && SB.engine.channelThresholds(SB.store.getState().settings, 'dine_in').warnSec === 420 && SB.store.getState().menu[0].price === 10.25);
    await page.evaluate(() => SB.store.flush());
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.od .od-panel'); await prep(page);
    const afterReload = [await input(page, 'Price of ' + MENU.name).inputValue(), await input(page, 'Dine-in turns amber at (seconds)').inputValue(), await input(page, 'Hot hold temperature').inputValue()];
    check('after a reload the price, the amber time and the hot hold are still edited', afterReload.join('|') === '10.25|420|142', afterReload);

    // a second tab on the same browser stays consistent
    const page2 = await page.context().newPage();
    const errors2 = [];
    page2.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_/.test(m.text())) errors2.push(m.text()); });
    page2.on('pageerror', (e) => errors2.push(String(e)));
    await page2.goto(page.url());
    await page2.waitForSelector('.od .od-panel'); await prep(page2);
    check('the second tab shows the saved values', (await input(page2, 'Price of ' + MENU.name).inputValue()) === '10.25', await input(page2, 'Price of ' + MENU.name).inputValue());
    await page.bringToFront();
    await typeNum(page, 'Price of ' + MENU.name, '11.5');
    await waitFor(page, () => SB.store.getState().menu[0].price === 11.5);
    await page.evaluate(() => SB.store.flush());
    await page2.bringToFront();
    await page2.waitForFunction(() => SB.store.getState().menu[0].price === 11.5, null, { timeout: 5000 }).catch(() => {});
    await page2.waitForTimeout(300);
    check('a price edited in tab 1 shows up in tab 2 without a reload', (await input(page2, 'Price of ' + MENU.name).inputValue()) === '11.50', await input(page2, 'Price of ' + MENU.name).inputValue());
    // half-typed value in tab 2 survives tab 1 editing something else
    const pinput = input(page2, 'How fast it learns your real times');
    await pinput.scrollIntoViewIfNeeded();
    await pinput.click();
    await pinput.fill('17');
    await page.bringToFront();
    await typeNum(page, 'Shortest prep time', '25');
    await waitFor(page, () => SB.store.getState().settings.pacing.floorSec === 25);
    await page.evaluate(() => SB.store.flush());
    await page2.bringToFront();
    await page2.waitForFunction(() => SB.store.getState().settings.pacing.floorSec === 25, null, { timeout: 5000 }).catch(() => {});
    await page2.waitForTimeout(300);
    check('tab 2 picked up the other change (floor 25)', (await input(page2, 'Shortest prep time').inputValue()) === '25');
    check('a half-typed value in tab 2 survived the refresh (17 still in the field)', (await pinput.inputValue()) === '17', await pinput.inputValue());
    await pinput.press('Enter');
    await waitFor(page2, () => SB.store.getState().settings.pacing.learnK === 17, null, 4000);
    check('and it saves when committed', true);
    check('no console errors in the second tab', errors2.length === 0, errors2.slice(0, 3));
    await page2.close();

    // half-typed value survives a store change in the same tab
    await page.bringToFront();
    await page.evaluate(() => { const b = document.querySelector('.od-item[data-id="brisket_half"][data-open="false"] .od-sum'); if (b) b.click(); }); // this dish row is collapsed until tapped
    const pi = input(page, 'Prep time of Brisket, 1/2 lb');
    await pi.scrollIntoViewIfNeeded();
    await pi.click();
    await pi.fill('77');
    await page.evaluate(() => { SB.store.dispatch('updateMenuItem', { id: 'brisket_half', patch: { price: 15 } }); SB.store.dispatch('updateSettings', { patch: { pacing: { qtyCap: 4 } } }); });
    await page.waitForTimeout(300);
    check('a store change while a field has focus keeps the half-typed value', (await pi.inputValue()) === '77');
    await pi.press('Enter');
    await waitFor(page, () => SB.store.getState().menu.find((m) => m.id === 'brisket_half').prepSec === 77);
    check('Enter commits it', true);

    // idle: the page does not repaint the world on its own
    const n0 = await page.evaluate(() => { window.__n = 0; const o = SB.store.subscribe(() => { window.__n++; }); window.__off = o; return 0; });
    await page.waitForTimeout(2500);
    const idle = await page.evaluate(() => { window.__off(); return window.__n; });
    check('when nothing is happening the store does not notify (no needless page work), idle notifies: ' + idle, idle <= 3, idle);
    noErrors('persistence', logs);
  });
});

/* ====================================================================================================================
 * 12. Leaks: mount and unmount cleanly
 * ================================================================================================================== */
group('12. Page life cycle', async () => {
  await open({}, async (page, logs) => {
    const c0 = await page.evaluate(() => SB.office._debug.counts());
    for (let i = 0; i < 6; i++) { await page.evaluate(() => SB.office.navigate('pace')); await page.evaluate(() => SB.office.navigate('data')); await page.waitForSelector('#od-menu'); }
    await page.waitForTimeout(200);
    const c1 = await page.evaluate(() => SB.office._debug.counts());
    check('six trips away and back leave no extra timers, listeners or subscriptions', c1.timeouts <= c0.timeouts + 4 && c1.intervals === c0.intervals && c1.subs === c0.subs && c1.listeners === c0.listeners, [c0, c1]);
    const subs = await page.evaluate(async () => { const n0 = document.querySelectorAll('.od').length; return n0; });
    check('exactly one page root exists after those trips', subs === 1, subs);
    await page.evaluate(async () => { await SB.shell.extinguish(); });
    await page.waitForTimeout(300);
    check('closing the office removes the page', (await page.locator('.od').count()) === 0);
    await page.evaluate(() => { SB.shell.ignite(); });
    await page.waitForTimeout(900);
    noErrors('life cycle', logs);
  });
});

/* ====================================================================================================================
 * 13. Looks: Ember and Paper, five viewports, nothing spills sideways
 * ================================================================================================================== */
const VIEWPORTS = [[2560, 1440, 'w2560'], [1280, 800, 'w1280'], [1024, 768, 'w1024'], [390, 844, 'w390'], [280, 640, 'w280']];
group('13. Looks at five sizes in Ember and Paper', async () => {
  const only = (process.argv.find((a) => a.startsWith('--vp=')) || '').slice(5); // e.g. --vp=w280 to redo one size
  for (const [w, hgt, tag] of VIEWPORTS) {
    if (only && only !== tag) continue;
    for (const theme of ['ember', 'paper']) {
      await open({ w, h: hgt, init: SIM_STUB }, async (page, logs) => {
        await page.evaluate((t) => { SB.theme.setOffice(t); }, theme);
        await makeTickets(page, 14);
        await page.evaluate(() => { SB.floor = SB.floor || {}; let on = true; SB.floor.setSound = (v) => { on = !!v; }; SB.floor.sound = () => on; SB.office.navigate('pace'); SB.office.navigate('data'); });
        await page.waitForSelector('#od-menu');
        // give a few rows realistic states: one archived, one confirmed, one refusal showing, one saved line
        await page.evaluate(() => {
          SB.store.dispatch('updateMenuItem', { id: 'tea', patch: { archived: true } });
          SB.store.dispatch('updateMenuItem', { id: 'brisket_half', patch: { prepConfirmed: true } });
          SB.store.dispatch('updateSettings', { patch: { pacing: { qtyCap: 3 } } });
        });
        await page.waitForTimeout(300);
        await typeNum(page, 'Price of ' + MENU.name, '9999');
        await typeNum(page, 'Prep time of Brisket, 1/2 lb', '130');
        await typeNum(page, 'Hot hold temperature', '100');
        await page.waitForTimeout(700);
        const label = `${tag}-${theme}`;
        await page.evaluate(() => document.querySelector('.of-col').scrollTo(0, 0));
        await page.waitForTimeout(120);
        await shot(page, `${label}-01-top`);
        const ov = await overflowReport(page);
        check(`${label}: no horizontal spill (${ov.nBad} elements out of bounds)`, ov.nBad === 0 && ov.docScroll <= ov.vw + 1 && ov.colScroll <= ov.colClient + 1, ov);
        const panels = ['ingredients', 'times', 'pacing', 'safety', 'pin', 'look', 'data', 'about'];
        const wide = w >= 1024;
        for (let i = 0; i < panels.length; i++) {
          if (!wide && (panels[i] === 'pin')) { /* kept: small screens are where PIN forms matter */ }
          await goPanel(page, panels[i]);
          await page.waitForTimeout(120);
          await shot(page, `${label}-${String(i + 2).padStart(2, '0')}-${panels[i]}`);
          // on a phone the heading and intro fill the first screen, so also look at the fields themselves
          const fieldSel = { ingredients: '.od-ing .od-nf', times: '.od-chan .od-nf', pacing: '.od-fgrid .od-nf', safety: '.od-fgrid .od-nf', pin: '.od-pinstate', look: '.od-setting', data: '.od-stats' }[panels[i]];
          if (!wide && fieldSel) {
            await page.evaluate((sel) => { const el = document.querySelector('#od-' + sel[0] + ' ' + sel[1]); if (el) el.scrollIntoView({ block: 'center' }); }, [panels[i], fieldSel]);
            await page.waitForTimeout(120);
            await shot(page, `${label}-${String(i + 2).padStart(2, '0')}b-${panels[i]}-fields`);
          }
          const o2 = await overflowReport(page);
          if (o2.nBad) check(`${label}: ${panels[i]} panel has no element out of bounds`, false, o2);
        }
        // the open states: PIN form, import result, fallback box
        await goPanel(page, 'pin');
        await page.locator('#od-pin').getByRole('button', { name: 'Set a PIN' }).click();
        await page.waitForTimeout(120);
        await shot(page, `${label}-10-pin-form`);
        await page.locator('#od-pin').getByRole('button', { name: 'Cancel' }).click();
        await goPanel(page, 'data');
        const backup = await page.evaluate(() => SB.store.exportAll());
        await page.locator('#od-data input[type="file"]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
        await page.waitForSelector('#od-data .od-impresult .od-card');
        await page.evaluate(() => document.querySelector('#od-data .od-impresult').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(150);
        await shot(page, `${label}-11-import-summary`);
        await page.locator('#od-data input[type="file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
        await page.waitForSelector('#od-data .od-impresult .od-card[data-tone="bad"]');
        await page.evaluate(() => document.querySelector('#od-data .od-impresult').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(150);
        await shot(page, `${label}-12-import-refused`);
        const o3 = await overflowReport(page);
        check(`${label}: import cards fit`, o3.nBad === 0, o3);
        noErrors(label, logs);
      });
    }
  }
});

/* ====================================================================================================================
 * 14. The real stepper widths: every digit visible, everywhere
 * ================================================================================================================== */
group('14. Number fields show every digit', async () => {
  for (const [w, hgt, tag] of [[1280, 800, 'w1280'], [390, 844, 'w390'], [280, 640, 'w280']]) {
    await open({ w, h: hgt }, async (page) => {
      const r = await page.evaluate(() => {
        const bad = [];
        for (const i of document.querySelectorAll('.od input.stepper-input')) {
          if (i.offsetParent === null) continue;
          const clipped = i.scrollWidth > i.clientWidth + 1;
          if (clipped) bad.push(i.getAttribute('aria-label') + ' ' + i.value + ' ' + i.scrollWidth + '/' + i.clientWidth);
        }
        return bad;
      });
      check(tag + ': no stepper input clips its digits', r.length === 0, r.slice(0, 5));
    });
  }
});

/* ---------------------------------------------------------------------------------------------------------------------
 * UI bounds duplicated from the engine: apply min, max and just-outside to the pure engine
 * ------------------------------------------------------------------------------------------------------------------- */
group('15. UI ranges match the engine (min, max, just outside)', async () => {
  await open({}, async (page) => {
    const out = await page.evaluate(() => {
      const fails = [];
      const base = SB.store.getState();
      const probe = (patchOf, lo, hi, label, step, intOnly) => {
        const ap = (v) => SB.engine.apply(base, 'updateSettings', { patch: patchOf(v) }, SB.store.now()).report;
        const ok = (r) => r === 'ok' || r === 'nothingToDo';
        if (!ok(ap(lo))) fails.push(label + ' min ' + lo + ' refused');
        if (!ok(ap(hi))) fails.push(label + ' max ' + hi + ' refused');
        if (ok(ap(lo - step))) fails.push(label + ' below min accepted');
        if (ok(ap(hi + step))) fails.push(label + ' above max accepted');
      };
      const spec = [];
      // read the ranges the page itself uses from its inputs' aria attributes
      for (const i of document.querySelectorAll('#od-pacing input.stepper-input, #od-safety input.stepper-input, #od-look .od-fgrid input.stepper-input')) {
        spec.push({ aria: i.getAttribute('aria-label'), min: +i.getAttribute('aria-valuemin'), max: +i.getAttribute('aria-valuemax') });
      }
      const map = {
        'Shortest prep time': (v) => ({ pacing: { floorSec: v } }), 'Extra time per extra portion': (v) => ({ pacing: { qtyFactor: v / 100 } }), 'Most a big line can grow': (v) => ({ pacing: { qtyCap: v } }),
        'How fast it learns your real times': (v) => ({ pacing: { learnK: v } }), 'Learned time never below': (v) => ({ pacing: { minFactor: v } }), 'Learned time never above': (v) => ({ pacing: { maxFactor: v } }), 'Ignore a timing longer than': (v) => ({ pacing: { outlierFactor: v } }),
        'Hot hold temperature': (v) => ({ safety: { hotHoldF: v } }), 'Cold hold temperature': (v) => ({ safety: { coldHoldF: v } }), 'Reheat to': (v) => ({ safety: { reheatF: v } }),
        'Time allowed below hot hold': (v) => ({ safety: { belowHotGraceH: v } }), 'Time allowed above cold hold': (v) => ({ safety: { aboveColdGraceH: v } }), 'Hold limit for a product with none of its own': (v) => ({ safety: { defaultMaxHoldH: v } }),
        'Temperature check every': (v) => ({ safety: { tempCheckEveryMin: v } }), 'Sanitize food-contact surfaces every': (v) => ({ safety: { sanitizeEveryH: v } }),
        'First cooling stage: cool to': (v) => ({ safety: { cooling: { stage1ToF: v } } }), 'First cooling stage: within': (v) => ({ safety: { cooling: { stage1H: v } } }), 'Cool all the way to': (v) => ({ safety: { cooling: { finalF: v } } }),
        'Service day starts at': (v) => ({ service: { dayStartHour: v } }), 'Opens at': (v) => ({ service: { openHour: v, closeHour: 30 } }), 'Closes at': (v) => ({ service: { openHour: 0, closeHour: v } }), // each also moves its partner so only its own range is tested
      };
      const stepFor = (a) => (/hours|within|Learned|Most a big/.test(a) ? 0.01 : 1);
      let probed = 0;
      for (const s of spec) {
        const f = map[s.aria]; if (!f) continue;
        probed++;
        const lo = s.min, hi = s.max;
        const toEngine = (u) => u;
        probe(f, lo, hi, s.aria, stepFor(s.aria));
      }
      // fields tied to another field (cooling total, open/close) are checked on their own
      const cool = SB.engine.apply(base, 'updateSettings', { patch: { safety: { cooling: { totalH: 6 } } } }, SB.store.now()).report;
      if (cool !== 'ok' && cool !== 'nothingToDo') fails.push('cooling total 6 refused');
      if (SB.engine.apply(base, 'updateSettings', { patch: { safety: { cooling: { totalH: 6.01 } } } }, SB.store.now()).report === 'ok') fails.push('cooling total 6.01 accepted');
      return { probed, fails, total: spec.length };
    });
    check('probed ' + out.probed + ' fields against SB.engine.apply', out.probed >= 18, out);
    check('every UI range equals the engine range (min and max accepted, just outside refused)', out.fails.length === 0, out.fails);
    const ch = await page.evaluate(() => {
      const base = SB.store.getState(); const fails = [];
      const run = (p) => SB.engine.apply(base, 'updateSettings', { patch: p }, SB.store.now()).report;
      const ok = (r) => r === 'ok' || r === 'nothingToDo';
      const c = SB.config.channels[0].id;
      if (!ok(run({ channels: { [c]: { warnSec: 30 } } }))) fails.push('channel warn 30 refused');
      if (ok(run({ channels: { [c]: { warnSec: 29 } } }))) fails.push('channel warn 29 accepted');
      if (!ok(run({ channels: { [c]: { warnSec: 7200, breachSec: 10800 } } }))) fails.push('channel 7200/10800 refused');
      if (ok(run({ channels: { [c]: { warnSec: 7201, breachSec: 10800 } } }))) fails.push('channel warn 7201 accepted');
      if (ok(run({ channels: { [c]: { breachSec: 10801 } } }))) fails.push('channel breach 10801 accepted');
      if (ok(run({ channels: { [c]: { breachSec: 59 } } }))) fails.push('channel breach 59 accepted');
      const mi = (p) => SB.engine.apply(base, 'updateMenuItem', { id: 'brisket_qtr', patch: p }, SB.store.now()).report;
      if (!ok(mi({ price: 0 })) || !ok(mi({ price: 1000 })) || ok(mi({ price: 1000.01 })) || ok(mi({ price: -0.01 }))) fails.push('price range');
      if (!ok(mi({ prepSec: 5 })) || !ok(mi({ prepSec: 3600 })) || ok(mi({ prepSec: 4 })) || ok(mi({ prepSec: 3601 }))) fails.push('prep range');
      const ig = (p) => SB.engine.apply(base, 'updateIngredient', { id: 'brisket', patch: p }, SB.store.now()).report;
      if (!ok(ig({ yield: 0.05 })) || !ok(ig({ yield: 3 })) || ok(ig({ yield: 0.04 })) || ok(ig({ yield: 3.01 }))) fails.push('yield range');
      if (!ok(ig({ parG: 1e7 })) || ok(ig({ parG: 1e7 + 1 }))) fails.push('par range');
      if (!ok(ig({ costPerKg: 10000 })) || ok(ig({ costPerKg: 10001 }))) fails.push('cost range');
      return fails;
    });
    check('channel, price, prep, yield, par and cost ranges equal the engine', ch.length === 0, ch);
  });
});

/* ====================================================================================================================
 * run
 * ================================================================================================================== */
console.log('Office C: Menu, prices and shop, end-to-end');
for (const g of groups) {
  if (ONLY && !g.title.toLowerCase().includes(ONLY)) continue;
  currentGroup = g.title;
  console.log('\n# ' + g.title);
  try { await g.fn(); }
  catch (e) { fail++; failures.push(g.title + ' (threw)'); console.log('  FAIL  group threw: ' + (e && e.stack || e)); }
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ': ' + pass + ' checks passed, ' + fail + ' failed');
if (shots.length) { console.log('\nscreenshots (' + shots.length + ') in ' + path.relative(root, OUT) + '/'); }
if (failures.length) { console.log('\nfailures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
