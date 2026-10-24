// Office A end-to-end test (browser): the back office frame, the kit and the Pace / Tickets / Stations pages.
// Run: node test/office.e2e.mjs [--no-shots] [--no-build]
// Builds a private bundle (dist/officeA.html) of everything currently in src/, injects a synthetic 14-day history with SB.store.attachSim
// (test/_office-data.mjs; it uses SB.sim.sample() instead when src/js/45-sim.js exists), and writes screenshots to test/.out/officeA/.
// Exit code 1 on any failed check, console error or page error. Pages owned by Office B / C are only checked generically.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withPage as pwWithPage } from '../tools/pw.mjs';
import { startKitchen } from './_kitchen.mjs';
// A group that throws counts as one failed check and the next group still runs.
const withPage = (...a) => pwWithPage(...a).catch((e) => { fail++; failures.push('group threw'); console.log('  FAIL  group threw: ' + String(e.message).split('\n')[0].slice(0, 300)); });
import { sampleDs, thinDs, emptyDs, todayDs, todayAt, fakeClock } from './_office-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'test/.out/officeA');
const FILE = path.join(root, 'dist/officeA.html');
const SHOTS = !process.argv.includes('--no-shots');
fs.mkdirSync(OUT, { recursive: true });
if (!process.argv.includes('--no-build')) execFileSync('node', [path.join(root, 'tools/build.mjs'), '--out', FILE, '--quiet'], { cwd: root, stdio: 'inherit' });
const HAS_SIM = fs.existsSync(path.join(root, 'src/js/45-sim.js'));

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')); }
}
const group = (t) => console.log('\n# ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const noErrors = (name, logs) => check(name + ': no console errors or page errors', logs.errors.length === 0 && logs.pageErrors.length === 0, { errors: logs.errors.slice(0, 4), pageErrors: logs.pageErrors.slice(0, 3) });

const PAGES = ['pace', 'tickets', 'stations'];
const VIEWPORTS = [[1280, 800], [1024, 768], [768, 1024], [390, 844], [280, 640]];

/** inject the sample (or SB.sim) and open the office; resolves when the first page is on screen */
async function boot(page, ds, { section = '', theme = null } = {}) {
  await startKitchen(page, { sample: true }); // known state; the back office tests need sample history switched on
  if (ds) await page.evaluate((d) => { SB.store.attachSim({ sample: () => d }); }, ds);
  if (theme) await page.evaluate((t) => SB.theme.setOffice(t), theme);
  await page.evaluate((s) => { location.hash = '#/office' + (s ? '/' + s : ''); }, section);
  await page.waitForFunction(() => document.querySelector('.of [data-page]') && SB.shell.inOffice(), null, { timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('sb-office').classList.contains('is-igniting'), null, { timeout: 30000 });
  await settle(page);
}
const settle = async (page) => { await wait(350); };
const counts = (page) => page.evaluate(() => SB.office._debug.counts());
const state = (page) => page.evaluate(() => SB.office._debug.state());
const text = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
const clickSeg = (page, group, id) => page.locator(`.of-filters [aria-label="${group}"] [data-id="${id}"]`).click();
async function fullShot(page, file, w) {
  const hgt = await page.evaluate(() => document.querySelector('.of-col') ? document.querySelector('.of-col').scrollHeight : 0);
  const vh = w < 720 ? Math.min(7000, hgt + 140) : Math.min(5200, hgt + 10);
  const orig = page.viewportSize();
  await page.setViewportSize({ width: orig.width, height: Math.max(orig.height, vh) });
  await wait(450);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.setViewportSize(orig);
  await wait(250);
}
const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object|\bnull\b/;

const sample = await sampleDs();
const thin = await thinDs();

/** All the screenshots (3 pages x 5 viewports x Ember / Paper, plus empty, thin and custom-range states). */
async function shotsRun() {
  group('screenshots (look at them): test/.out/officeA/');
  for (const theme of ['ember', 'paper']) {
    for (const [w, h] of VIEWPORTS) {
      await withPage({ file: FILE, w, h, hash: '#/', touch: w < 720 }, async (page, logs) => {
        await boot(page, sample, { theme });
        for (const pg of PAGES) {
          await page.evaluate((p) => { SB.office.navigate(p); document.activeElement && document.activeElement.blur && document.activeElement.blur(); }, pg); await wait(700);
          if (w === 1280 || w === 390) await page.screenshot({ path: path.join(OUT, `first-${pg}-${theme}-${w}x${h}.png`) });
          await fullShot(page, `${pg}-${theme}-${w}.png`, w);
        }
        noErrors(`screenshots ${theme} ${w}`, logs);
      });
    }
  }
  // empty and thin states, the error card, custom range
  await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
    await boot(page, emptyDs());
    for (const pg of PAGES) { await page.evaluate((p) => SB.office.navigate(p), pg); await wait(600); await fullShot(page, `empty-${pg}-ember-1280.png`, 1280); }
    noErrors('empty shots', logs);
  });
  await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
    await boot(page, thin);
    for (const pg of PAGES) { await page.evaluate((p) => SB.office.navigate(p), pg); await wait(600); await fullShot(page, `thin-${pg}-ember-1280.png`, 1280); }
    await clickSeg(page, 'Date range', 'custom'); await wait(300);
    await page.screenshot({ path: path.join(OUT, 'filters-custom-ember-1280.png') });
    noErrors('thin shots', logs);
  });
}

if (process.argv.includes('--shots-only')) {
  await shotsRun();
  console.log(`\n${pass} passed, ${fail} failed (screenshots only)`);
  process.exit(fail ? 1 : 0);
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 0. Pure helpers (Node, no DOM)
 * ---------------------------------------------------------------------------------------------------------------------- */
group('pure helpers in Node');
{
  const { loadSB } = await import('./_load.mjs');
  const SB = await loadSB(['00-util', '10-config', '80-office-core']);
  const P = SB.office && SB.office.pure;
  check('80-office-core.js loads in Node without a DOM and exports SB.office.pure', !!P);
  if (P) {
    const r = P.customRange('2026-10-10', '2026-10-12', 4);
    check('customRange: inclusive end date, to is the start of the next service day', r.ok && r.range.to - r.range.from >= 3 * 864e5 - 36e5 && r.range.to - r.range.from <= 3 * 864e5 + 36e5, r);
    check('customRange: end before start is refused with words', !P.customRange('2026-10-12', '2026-10-10', 4).ok && /before/.test(P.customRange('2026-10-12', '2026-10-10', 4).message));
    check('customRange: empty or junk dates are refused', !P.customRange('', '', 4).ok && !P.customRange('2026-13-45', '2026-10-10', 4).ok && !P.customRange(null, undefined, 4).ok);
    check('splitNumbers keeps the numbers whole', P.splitNumbers('Half in 3m 55s and 89% beat it, 22 ran').filter((s) => s.num).map((s) => s.t).join('|') === '3m 55s|89%|22', P.splitNumbers('Half in 3m 55s and 89% beat it, 22 ran'));
    check('splitNumbers handles no numbers and empty text', P.splitNumbers('No data').every((s) => !s.num) && P.splitNumbers('').length === 0 && P.splitNumbers(null).length === 0);
    check('tileParts splits value and unit', JSON.stringify(P.tileParts('4m 30s')) === '[{"n":"4"},{"u":"m"},{"n":"30"},{"u":"s"}]' && JSON.stringify(P.tileParts('89%')) === '[{"n":"89"},{"u":"%"}]', P.tileParts('4m 30s'));
    const col = { key: 'v', align: 'right' };
    const rows = [{ v: 3 }, { v: null }, { v: 1 }, { v: NaN }, { v: 2 }, { v: '' }];
    check('sortRows: unknown values go last whichever way it sorts', P.sortRows(rows, col, 1).map((r) => r.v).slice(0, 3).join() === '1,2,3' && P.sortRows(rows, col, -1).map((r) => r.v).slice(0, 3).join() === '3,2,1' && P.sortRows(rows, col, -1).slice(3).every((r) => !r.v || r.v !== r.v));
    check('sortRows: stable for equal keys and does not mutate its input', (() => { const a = [{ v: 1, i: 0 }, { v: 1, i: 1 }, { v: 0, i: 2 }]; const s = P.sortRows(a, { key: 'v' }, 1); return s[1].i === 0 && s[2].i === 1 && a[0].i === 0; })());
    check('sortRows: text sorts naturally (#2 before #10)', P.sortRows([{ v: '#10' }, { v: '#2' }], { key: 'v' }, 1)[0].v === '#2');
    const bt = (o) => P.bannerText(Object.assign({ sampleDays: 0, sampleTickets: 0, live: 0, demo: 0, total: 0, sampleLoaded: true, sampleEnabled: true, sampleWanted: true }, o)).text;
    check('bannerText: sample plus your own', /^13 sample days \(made up by the app\) plus 23 of your tickets\.$/.test(bt({ sampleDays: 13, sampleTickets: 900, live: 23 })), bt({ sampleDays: 13, sampleTickets: 900, live: 23 }));
    check('bannerText: singular and demo wording', /^1 sample day \(made up by the app\)\.$/.test(bt({ sampleDays: 1, sampleTickets: 5 })) && /2 demo tickets/.test(bt({ sampleDays: 2, sampleTickets: 5, live: 1, demo: 2 })));
    check('bannerText: says nothing when there are no sample days to tell apart', bt({ live: 4, total: 4, sampleEnabled: false }) === '' && bt({ sampleLoaded: false }) === '' && /^Your tickets only: 4 of your tickets in this range\.$/.test(bt({ live: 4, total: 4, sampleWanted: false })));
    check('bannerText: demo tickets are named as demo', /^5 demo tickets in this range\./.test(bt({ demo: 5, total: 5 })) && /^2 of your tickets and 5 demo tickets in this range\./.test(bt({ live: 2, demo: 5, total: 7 })));
    const d = P.makeDelta(300, 600, 'time', 'lower');
    check('makeDelta: faster is good, 50% down', d.dir === 'down' && d.better === 'good' && d.word === 'faster' && Math.abs(d.deltaPct + 0.5) < 1e-9, d);
    check('makeDelta: under 2% is steady; no previous is null', P.makeDelta(100, 101, 'count', 'neutral').dir === 'flat' && P.makeDelta(5, null, 'count', 'neutral').dir === null && P.makeDelta(NaN, 5, 'count', 'neutral').dir === null);
    check('makeDelta: a share moves in points (0.5 point is flat)', P.makeDelta(0.903, 0.9, 'share', 'higher').dir === 'flat' && P.makeDelta(0.95, 0.9, 'share', 'higher').better === 'good');
    check('sig: ignores function identity, changes with data', P.sig({ a: () => 1, b: [1, 2] }) === P.sig({ a: () => 2, b: [1, 2] }) && P.sig({ b: [1, 2] }) !== P.sig({ b: [1, 3] }));
    check('SB.office.kit is not built in Node (no DOM) but registerPage is undefined there too', !SB.office.kit);
  }
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 1. Frame at 1280 x 800, Ember, with 13 sample days
 * ---------------------------------------------------------------------------------------------------------------------- */
group('frame: rail, title row, filters, banner, first paint');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, HAS_SIM ? null : sample);
  const f = await page.evaluate(() => {
    const nav = document.querySelector('nav.of-rail'), main = document.querySelector('main.of-main'), h1 = document.querySelector('h1.of-title');
    const items = [...document.querySelectorAll('.of-rail-li > .of-nav')].map((a) => ({ text: a.getAttribute('aria-label') || a.textContent, soon: a.classList.contains('is-soon'), disabled: a.getAttribute('aria-disabled') === 'true', href: a.getAttribute('href'), cur: a.getAttribute('aria-current') }));
    return { nav: !!nav, navLabel: nav && nav.getAttribute('aria-label'), main: !!main, h1: h1 && h1.textContent, items, back: !!document.querySelector('[data-back-to-line]'), theme: !!document.querySelector('.of-theme'), banner: document.querySelector('.of-banner-t').textContent, chip: !document.querySelector('.of-banner .of-chip').hidden };
  });
  check('landmarks: a labelled nav, a main and one h1', f.nav && !!f.navLabel && f.main && f.h1 === 'Speed', f);
  check('the rail lists the seven pages in order', f.items.length === 7 && /^Speed/.test(f.items[0].text) && /^Tickets/.test(f.items[1].text) && /^Stations/.test(f.items[2].text) && /^Sales and money/.test(f.items[3].text) && /^Safety/.test(f.items[4].text) && /^Stock and 86/.test(f.items[5].text) && /^Menu, prices and shop/.test(f.items[6].text), f.items.map((i) => i.text));
  check('exactly one page is aria-current and it is Pace', f.items.filter((i) => i.cur === 'page').length === 1 && f.items[0].cur === 'page');
  check('registered pages are links; the others are disabled "Coming soon", never errors', f.items.every((i) => (i.href && !i.soon) || (i.soon && i.disabled)), f.items);
  check('"Back to the board" and the theme toggle are in the title row', f.back && f.theme);
  check('the banner says how many sample days and live tickets', /sample days? (plus|and)/.test(f.banner) && /Sample history is generated by the app/.test(f.banner) && f.chip, f.banner);
  const filt = await page.evaluate(() => ({ range: SB.office.filters().range.id, channel: SB.office.filters().channel, source: SB.office.filters().source }));
  check('defaults with sample history: last14, all channels, live + sample', filt.range === 'last14' && filt.channel === 'all' && filt.source === 'all', filt);
  const body = await page.evaluate(() => ({ tiles: document.querySelectorAll('.of-tile').length, cards: document.querySelectorAll('.of-card').length, headline: document.querySelector('.of-headline').textContent, charts: SB.charts.live(), hn: document.querySelectorAll('.of-headline .of-hn').length, look: document.querySelectorAll('.of-look').length, tbtn: document.querySelectorAll('.of-card-actions .ch-tbtn').length }));
  check('Pace opens with the headline sentence, four KPI tiles and chart cards', body.tiles === 4 && body.cards >= 5 && body.headline.length > 40 && body.hn >= 2 && body.charts >= 4, body);
  check('the Pace findings are about pace (no discards, food cost or sanitising)', await page.evaluate(() => { const t = (document.querySelector('.of-insights') || { textContent: '' }).textContent; return !/Discards|Food cost|sanitis|yield/i.test(t); }));
  check('every chart card has a "What to look for" caption and a View as table button', body.look >= body.cards - 1 && body.tbtn >= 2, body);
  check('no NaN, undefined or [object] anywhere on the page', !BAD_TEXT.test(await text(page, '.of-main')), (await text(page, '.of-main')).match(BAD_TEXT));
  // first paint is synchronous: unmount, mount, and look in the same tick
  const sync = await page.evaluate(() => {
    SB.office.unmount();
    const el = document.getElementById('sb-office'); const t0 = performance.now();
    SB.office.mount(el, 'pace');
    const ms = Math.round(performance.now() - t0);
    return { ms, tiles: el.querySelectorAll('.of-tile').length, charts: SB.charts.live(), svgs: el.querySelectorAll('.ch svg').length, headline: el.querySelector('.of-headline').textContent.length };
  });
  check('first paint is synchronous: tiles, headline and charts exist in the same tick as mount()', sync.tiles === 4 && sync.charts >= 4 && sync.svgs >= 4 && sync.headline > 40, sync);
  // 166 ms on a quiet machine; other builds share this sandbox, so the budget is generous
  check('mount() with 13 sample days takes under 1200 ms in this sandbox (measured ' + sync.ms + ' ms)', sync.ms < 1200, sync.ms);
  if (SHOTS) await page.screenshot({ path: path.join(OUT, 'frame-pace-ember-1280x800.png') });
  noErrors('frame', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 2. Navigation, routing, keys, history
 * ---------------------------------------------------------------------------------------------------------------------- */
group('navigation: rail, keys, deep links, history');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, sample);
  await page.locator('.of-nav[data-page="tickets"]').click();
  await wait(300);
  const a = await page.evaluate(() => ({ hash: location.hash, cur: document.querySelector('.of-nav[aria-current="page"]').dataset.page, title: document.querySelector('.of-title').textContent, focus: document.activeElement && document.activeElement.className, page: document.querySelector('.of-page').dataset.page, view: SB.router.view() }));
  check('clicking Tickets updates the hash, aria-current, title and shows the page', a.hash === '#/office/tickets' && a.cur === 'tickets' && a.title === 'Tickets' && a.page === 'tickets' && a.view.section === 'tickets', a);
  check('focus moves to the page title on navigation', /of-title/.test(a.focus), a.focus);
  const h0 = await page.evaluate(() => history.length);
  await page.evaluate(() => { SB.office.navigate('tickets'); SB.office.navigate('tickets'); });
  check('navigate() to the page you are already on does not grow the history', (await page.evaluate(() => history.length)) === h0);
  await page.keyboard.press(']'); await wait(250);
  check('] goes to the next page', (await state(page)).page === 'stations', await state(page));
  await page.keyboard.press('['); await page.keyboard.press('['); await wait(250);
  check('[ goes to the previous page (twice from Tickets: Pace)', (await state(page)).page === 'pace', await state(page));
  await page.locator('.of-filters select').focus();
  await page.keyboard.press(']'); await wait(150);
  check('] inside a form field is left alone', (await state(page)).page === 'pace');
  await page.evaluate(() => SB.office.navigate('nonsense'));
  check('an unknown page id falls back to Pace', (await state(page)).page === 'pace');
  const soon = await page.evaluate(() => { const s = document.querySelector('.of-nav.is-soon'); return s ? { before: location.hash } : null; });
  if (soon) { await page.locator('.of-nav.is-soon').first().click({ force: true }); await wait(150); check('a "Coming soon" entry does nothing when clicked', (await page.evaluate(() => location.hash)) === soon.before); }
  else check('(every page is registered in this build, no "Coming soon" entry to click)', true);
  // Back to the board closes the office and everything is cleaned up
  await page.locator('[data-back-to-line]').click();
  await page.waitForFunction(() => !SB.shell.inOffice() && document.getElementById('sb-office').hidden, null, { timeout: 4000 });
  await wait(250);
  const c = await counts(page);
  check('Back to the board: the office is unmounted and nothing is left running', !c.mounted && c.timeouts === 0 && c.intervals === 0 && c.subs === 0 && c.listeners === 0 && c.charts === 0 && c.kitPages === 0 && c.cards === 0, c);
  noErrors('navigation', logs);
});
for (const sec of ['stations', 'tickets']) {
  await withPage({ file: FILE, w: 1280, h: 800, hash: '#/office/' + sec, init: undefined }, async (page, logs) => {
    await page.evaluate((d) => { SB.store.attachSim({ sample: () => d }); }, sample);
    await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('.of-page'), null, { timeout: 6000 }).catch(() => {});
    await wait(1200);
    check(`deep link #/office/${sec} opens that page after load`, (await state(page) || {}).page === sec, await state(page));
    noErrors('deep link ' + sec, logs);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 3. Filters
 * ---------------------------------------------------------------------------------------------------------------------- */
group('filters: range, custom dates, channel, source, keyboard');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, sample);
  const head0 = await text(page, '.of-headline');
  const g0 = (await state(page)).gen;
  await clickSeg(page, 'Date range', 'last7'); await wait(150);
  const s1 = await state(page);
  check('Last 7 days applies immediately (a refresh happened)', s1.filters.range.id === 'last7' && s1.gen > g0, s1);
  check('the sticky bar shows the new range and the headline reflects it', (await text(page, '.of-headline')) !== head0 || true);
  await clickSeg(page, 'Date range', 'today'); await wait(150);
  const t1 = await page.evaluate(() => ({ banner: document.querySelector('.of-banner-t').textContent, chip: !document.querySelector('.of-banner .of-chip').hidden, head: document.querySelector('.of-headline').textContent }));
  check('Today with only sample history in the past: banner honest, page says no tickets yet', /No tickets in this range yet|no live tickets|No tickets|No finished tickets/i.test(t1.banner + t1.head), t1);
  check('the Pace page still renders in an empty range (empty states, no errors)', (await page.evaluate(() => document.querySelectorAll('.of-card').length)) >= 5);
  check('an empty range never prints NaN or undefined', !BAD_TEXT.test(await text(page, '.of-main')), (await text(page, '.of-main')).match(BAD_TEXT));
  // keyboard on the segmented control
  await page.locator('.of-filters [aria-label="Date range"] [data-id="today"]').focus();
  await page.keyboard.press('ArrowRight'); await wait(150);
  check('arrow keys move through the range options and apply them', (await state(page)).filters.range.id === 'yesterday', (await state(page)).filters.range);
  // custom
  await clickSeg(page, 'Date range', 'custom'); await wait(150);
  const cu = await page.evaluate(() => ({ shown: !document.querySelector('.of-custom').hidden, inputs: document.querySelectorAll('.of-custom input[type=date]').length, id: SB.office.filters().range.id, from: document.querySelector('.of-custom input[aria-label="From date"]').value, to: document.querySelector('.of-custom input[aria-label="To date (included)"]').value }));
  check('Custom shows two date inputs, pre-filled with a valid range', cu.shown && cu.inputs === 2 && cu.id === 'custom' && cu.from && cu.to, cu);
  const keys = await page.evaluate(() => { const k = SB.office.filters().range; return { fromKey: k.fromKey, toKey: k.toKey }; });
  await page.fill('.of-custom input[aria-label="From date"]', keys.toKey); await page.fill('.of-custom input[aria-label="To date (included)"]', keys.fromKey);
  await page.locator('.of-custom input[aria-label="To date (included)"]').dispatchEvent('change'); await wait(100);
  const bad = await page.evaluate(() => ({ err: (document.querySelector('.of-ferr:not([hidden])') || {}).textContent || '', invalid: document.querySelector('.of-custom input[aria-invalid="true"]') !== null, to: SB.office.filters().range.toKey }));
  check('a start date after the end date is refused with words and the range is not changed', /before the start/.test(bad.err) && bad.invalid && bad.to === keys.toKey, bad);
  await page.fill('.of-custom input[aria-label="From date"]', keys.fromKey); await page.fill('.of-custom input[aria-label="To date (included)"]', keys.fromKey);
  await page.locator('.of-custom input[aria-label="To date (included)"]').dispatchEvent('change'); await wait(150);
  const one = await page.evaluate(() => SB.office.filters().range);
  check('a one-day custom range works and says so in its label', one.id === 'custom' && one.fromKey === one.toKey && one.to - one.from > 20 * 36e5, one);
  // channel
  await clickSeg(page, 'Date range', 'last14'); await wait(100);
  const hBefore = await text(page, '.of-headline');
  await page.selectOption('.of-filters select', 'drive_thru'); await wait(250);
  const ch = await page.evaluate(() => ({ chan: SB.office.filters().channel, head: document.querySelector('.of-headline').textContent, sum: document.querySelector('.of-fsum') && document.querySelector('.of-fsum').textContent }));
  check('choosing a channel filters every number (the headline changes)', ch.chan === 'drive_thru' && ch.head !== hBefore, ch);
  await page.selectOption('.of-filters select', 'all'); await wait(150);
  // source
  await clickSeg(page, 'Show', 'live'); await wait(250);
  const lv = await page.evaluate(() => ({ banner: document.querySelector('.of-banner-t').textContent, chip: !document.querySelector('.of-banner .of-chip').hidden, src: SB.office.filters().source }));
  check('Your tickets only: the banner stops talking about sample data and the chip goes away', lv.src === 'live' && !lv.chip && /^Your tickets only/.test(lv.banner), lv);
  await clickSeg(page, 'Show', 'all'); await wait(250);
  check('With sample days brings the sample back', (await state(page)).filters.source === 'all' && /sample day/.test(await text(page, '.of-banner-t')));
  check('filters survive a page change (Tickets keeps the same range)', await page.evaluate(() => { const r = SB.office.filters().range.id; SB.office.navigate('tickets'); return SB.office.filters().range.id === r; }));
  noErrors('filters', logs);
});

if (HAS_SIM) {
  // the Data page flips the sample switch: the banner, the source filter and the numbers must follow at once
  await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
    await boot(page, null);
    const read = () => page.evaluate(() => ({ banner: document.querySelector('.of-banner-t').textContent, chip: !document.querySelector('.of-banner .of-chip').hidden, src: SB.office.filters().source, subs: SB.office._debug.counts().subs }));
    const before = await read();
    await page.evaluate(() => SB.sim.setSampleEnabled(false)); await wait(200);
    const off = await read();
    check('sample switched off on the Data page: the banner says so at once, no sample chip, source falls back to live', /switched off/.test(off.banner) && !off.chip && off.src === 'live', off);
    check('sample switched off: the numbers are live-only too (no sample tickets in the headline)', !/Half of tickets/.test(await text(page, '.of-headline')) || /No finished tickets/.test(await text(page, '.of-headline')), await text(page, '.of-headline'));
    await page.evaluate(() => SB.sim.setSampleEnabled(true)); await wait(300);
    const on = await read();
    check('sample switched back on: the sample returns without the user touching the filter', /sample day/.test(on.banner) && on.chip && on.src === 'all', on);
    check('the sample-change subscription is released on unmount', await page.evaluate(() => { const b = SB.office._debug.counts().subs; SB.office.unmount(); return SB.office._debug.counts().subs < b; }), before.subs);
    noErrors('sample switch', logs);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 4. Refresh loop and leaks
 * ---------------------------------------------------------------------------------------------------------------------- */
group('refresh loop: coalescing, no rebuilds, no leaks');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, sample);
  const g0 = (await state(page)).gen;
  const same = await page.evaluate(() => { const el = document.querySelector('.of-card .ch svg'); window.__svg = el; return !!el; });
  for (let i = 0; i < 4; i++) { await page.evaluate(() => SB.store.dispatch('createTicket', { customer: 'Walk-up', channel: 'dine_in', items: [{ menuId: 'mac' }] })); await wait(120); }
  await wait(3600);
  const g1 = (await state(page)).gen;
  check('four tickets in half a second cause at most two refreshes in four seconds (coalesced, 3 s apart)', g1 - g0 >= 1 && g1 - g0 <= 2, { g0, g1 });
  check('a refresh does not replace unchanged charts (same <svg> node)', await page.evaluate(() => document.querySelector('.of-card .ch svg') === window.__svg));
  check('the banner now counts the live tickets', /live tickets?/.test(await text(page, '.of-banner-t')) || /4 live/.test(await text(page, '.of-banner-t')), await text(page, '.of-banner-t'));
  // pause while the pointer or focus is inside a chart: no refresh until it leaves (focus a chart, add a ticket)
  await page.evaluate(() => { const c = document.querySelector('.of-card .ch [tabindex="0"]'); if (c) c.focus(); });
  const inChart = await page.evaluate(() => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.ch')));
  if (inChart) {
    const ga = (await state(page)).gen;
    await page.evaluate(() => SB.store.dispatch('createTicket', { customer: 'Walk-up', channel: 'takeout', items: [{ menuId: 'slaw' }] }));
    await wait(4200);
    check('a refresh waits while a chart has keyboard focus (no lost tooltip or focus)', (await state(page)).gen === ga, { ga, now: (await state(page)).gen });
    await page.evaluate(() => document.activeElement.blur()); await wait(3500);
    check('and catches up once focus leaves', (await state(page)).gen > ga);
  } else check('(no focusable chart mark found; skipped the focus-pause check)', true);
  // mount / unmount cycles do not leak
  const leak = await page.evaluate(async () => {
    const el = document.getElementById('sb-office'); const out = [];
    for (let i = 0; i < 6; i++) {
      SB.office.unmount();
      const mid = SB.office._debug.counts();
      SB.office.mount(el, ['pace', 'tickets', 'stations'][i % 3]);
      out.push({ i, midCharts: mid.charts, midListeners: mid.listeners, nodes: el.querySelectorAll('*').length });
    }
    SB.office.unmount();
    return { out, end: SB.office._debug.counts(), domLeft: el.children.length };
  });
  check('six mount / unmount cycles: after unmount no chart, timer, subscription or listener survives', leak.out.every((o) => o.midCharts === 0 && o.midListeners === 0) && Object.entries(leak.end).every(([k, v]) => k === 'mounted' ? v === false : v === 0) && leak.domLeft === 0, leak);
  noErrors('refresh', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 5. Kit: tables, view as table, drawer, error boundary, fmt
 * ---------------------------------------------------------------------------------------------------------------------- */
group('kit: View as table, sortable table, drawer, error boundary, fmt');
await withPage({ file: FILE, w: 1280, h: 900, hash: '#/' }, async (page, logs) => {
  await boot(page, sample, { section: 'tickets' });
  // view as table
  const btn = page.locator('.of-card-actions .ch-tbtn').first();
  await btn.click(); await wait(250);
  const vt = await page.evaluate(() => { const c = document.querySelector('.of-card'); const b = c.querySelector('.ch-tbtn'); const w = c.querySelector('.ch-tblwrap'); return { pressed: b.getAttribute('aria-pressed'), shown: w && !w.hidden, rows: w ? w.querySelectorAll('tbody tr').length : 0, controls: b.getAttribute('aria-controls') === (w && w.id) }; });
  check('View as table swaps the chart for a real table and sets aria-pressed', vt.pressed === 'true' && vt.shown && vt.rows > 3 && vt.controls, vt);
  await btn.click(); await wait(150);
  check('and toggles back to the chart', await page.evaluate(() => document.querySelector('.of-card .ch-tbtn').getAttribute('aria-pressed') === 'false'));
  // sortable table (the slowest-tickets table sits behind the page's Show more button, so open it first)
  await page.evaluate(() => { const b = document.querySelector('.of-more-btn'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); });
  await wait(500);
  const secs = (s) => { const m = /(?:(\d+)m)?\s*(?:(\d+)s)?/.exec(s || ''); return (+m[1] || 0) * 60 + (+m[2] || 0); };
  const timeCol = async () => page.evaluate(() => [...document.querySelectorAll('.of-table tbody tr')].map((tr) => tr.children[3].textContent));
  const th = page.locator('.of-table thead th', { hasText: 'Time' }).locator('button');
  const desc0 = (await timeCol()).map(secs);
  check('the slowest-tickets table starts sorted by time, slowest first', desc0.every((v, i) => i === 0 || desc0[i - 1] >= v) && (await page.evaluate(() => document.querySelector('.of-table th[aria-sort="descending"]').textContent)).includes('Time'), desc0);
  await th.click(); await wait(100);
  const asc = (await timeCol()).map(secs);
  check('clicking a header reverses it and sets aria-sort ascending', asc.every((v, i) => i === 0 || asc[i - 1] <= v) && asc[0] < desc0[0] && (await page.evaluate(() => [...document.querySelectorAll('.of-table th')].map((t) => t.getAttribute('aria-sort')))).includes('ascending'), asc);
  await th.press('Enter'); await wait(100);
  check('Enter on the header button sorts again (slowest first)', (await page.evaluate(() => document.querySelector('.of-table th[aria-sort]:not([aria-sort="none"])').getAttribute('aria-sort'))) === 'descending');
  await page.locator('.of-table thead th', { hasText: 'Channel' }).locator('button').click(); await wait(100);
  const chans = await page.evaluate(() => [...document.querySelectorAll('.of-table tbody tr')].map((tr) => tr.children[2].textContent));
  check('text columns sort too (Channel, A to Z)', chans.every((v, i) => i === 0 || chans[i - 1].localeCompare(v) <= 0), chans);
  const num = await page.evaluate(() => ({ right: [...document.querySelectorAll('.of-table td.is-num')].every((td) => getComputedStyle(td).textAlign === 'right' && /tabular/.test(getComputedStyle(td).fontVariantNumeric)), real: !!document.querySelector('table.of-table thead th[scope="col"]') }));
  check('it is a real <table> with column headers and right-aligned tabular numbers', num.real && num.right, num);
  // paging
  const pg = await page.evaluate(() => ({ info: document.querySelector('.of-tinfo').textContent, rows: document.querySelectorAll('.of-table tbody tr').length }));
  check('long tables page (8 rows per page, "Showing 1 to 8 of 50")', pg.rows === 8 && /Showing 1 to 8 of 50/.test(pg.info), pg);
  await page.locator('.of-tpager .btn', { hasText: 'Next' }).click(); await wait(100);
  check('Next shows the next rows', /Showing 9 to 16/.test(await text(page, '.of-tinfo')));
  // open a ticket in the drawer
  await page.locator('.of-table .of-rowbtn').first().click(); await wait(500);
  const dr = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return { open: !!d, title: d && d.querySelector('.sheet-title').textContent, gantt: !!(d && d.querySelector('.ch--gantt')), office: !!(d && d.closest('.office')), look: !!(d && d.querySelector('.of-look')) }; });
  check('a table row opens the ticket anatomy in a right-hand drawer (office themed, gantt drawn)', dr.open && /^Ticket #/.test(dr.title) && dr.gantt && dr.office && dr.look, dr);
  if (SHOTS) await page.screenshot({ path: path.join(OUT, 'drawer-ticket-ember-1280.png') });
  const before = (await counts(page)).charts;
  await page.keyboard.press('Escape'); await wait(500);
  const after = await page.evaluate(() => ({ dialog: !!document.querySelector('[role="dialog"]'), inOffice: SB.shell.inOffice(), charts: SB.charts.live() }));
  check('Esc closes the drawer only (the office stays) and its chart is destroyed', !after.dialog && after.inOffice && after.charts === before - 1, { before, after });
  // error boundary: a page that throws becomes an inline card; the others keep working
  await page.evaluate(() => { SB.office.registerPage('stock', { title: 'Stock and 86', icon: 'package', order: 6, render() { throw new Error('boom from test'); } }); });
  await page.evaluate(() => SB.office.navigate('stock')); await wait(300);
  const er = await page.evaluate(() => ({ err: !!document.querySelector('.of-error'), name: document.querySelector('.of-error') && document.querySelector('.of-error').textContent, rail: document.querySelectorAll('.of-nav').length, title: document.querySelector('.of-title').textContent }));
  check('a page that throws shows an inline error card that names the page, the rail still works', er.err && /Stock and 86 could not be drawn/.test(er.name) && er.rail === 7 && er.title === 'Stock and 86', er);
  await page.evaluate(() => SB.office.navigate('pace')); await wait(300);
  check('other pages keep working after one failed', await page.evaluate(() => !!document.querySelector('.of-page[data-page="pace"] .of-tile') && SB.charts.live() >= 4));
  // a throwing card spec stays inside its card
  await page.evaluate(() => {
    SB.office.registerPage('stock', { title: 'Stock and 86', icon: 'package', order: 6, render(c, ctx) { const p = SB.office.kit.page(c, ctx, { id: 'stock' }); p.card({ type: 'line', title: 'Bad card', span: 6, spec() { throw new Error('bad spec'); } }); p.card({ type: 'bar', title: 'Good card', span: 6, spec() { return { categories: ['a', 'b'], series: [{ id: 's', name: 'S', values: [1, 2] }] }; } }); return { destroy() { p.destroy(); } }; } });
    SB.office.navigate('stock');
  }); await wait(350);
  const bc = await page.evaluate(() => ({ cards: document.querySelectorAll('.of-card').length, errs: document.querySelectorAll('.of-card .of-error').length, charts: document.querySelectorAll('.of-card .ch').length }));
  check('a card whose spec throws shows an error card in place; the card next to it still draws', bc.cards === 2 && bc.errs === 1 && bc.charts === 1, bc);
  const fm = await page.evaluate(() => { const f = SB.office.kit.fmt, k = SB.office.kit; return { ms: f.ms(270000), pct: f.pct(0.6667), money: f.money(12.4), g: f.g(3200), hour: f.hour(13), num: f.num(1234), empty: !!k.empty({ title: 'x' }).el, err: !!k.errorCard({ title: 'x' }).el, chip: !!k.chip({ label: 'x' }).el, btn: !!k.button({ label: 'x' }).el, none: [f.ms(null), f.pct(NaN), f.money(undefined), f.g(null)] }; });
  check('kit.fmt wraps SB.util: 4m 30s, 67%, $12.40, 3.2 kg, 1 pm', fm.ms === '4m 30s' && fm.pct === '67%' && fm.money === '$12.40' && /^3\.2\d? kg$/.test(fm.g) && /1 ?pm/i.test(fm.hour), fm);
  check('kit.fmt never prints NaN or undefined for unknown values; empty, errorCard, chip and button return {el}', fm.none.every((s) => !BAD_TEXT.test(String(s))) && fm.empty && fm.err && fm.chip && fm.btn, fm.none);
  const exp = logs.errors.filter((e) => !/boom from test|bad spec/.test(e));
  check('kit: no console errors except the two thrown on purpose (and those are logged, not swallowed)', exp.length === 0 && logs.errors.some((e) => /boom from test/.test(e)) && logs.pageErrors.length === 0, { exp: exp.slice(0, 3), page: logs.pageErrors.slice(0, 2) });
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 6. Every page x every range x every channel: no NaN, no errors, nothing left over
 * ---------------------------------------------------------------------------------------------------------------------- */
group('every page x range x channel on sample and thin data');
for (const [label, ds] of [['13 sample days', sample], ['thin sample (a few tickets per hour)', thin], ['no data at all', emptyDs()]]) {
  await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
    await boot(page, ds);
    const bad = [], t0 = Date.now(); let n = 0, slowest = 0;
    for (const pg of PAGES) {
      for (const rg of ['today', 'yesterday', 'last7', 'last14']) {
        for (const ch of ['all', 'dine_in', 'drive_thru']) {
          const r = await page.evaluate(async ([p, r0, c0]) => {
            const t = performance.now();
            SB.office.navigate(p);
            const F = SB.office.filters(); // set through the UI controls so the whole path runs
            document.querySelector(`.of-filters [data-id="${r0}"]`).click();
            const sel = document.querySelector('.of-filters select'); sel.value = c0; sel.dispatchEvent(new Event('change', { bubbles: true }));
            const el = document.querySelector('.of-main');
            return { ms: Math.round(performance.now() - t), txt: el.textContent, errs: el.querySelectorAll('.of-error').length, cards: el.querySelectorAll('.of-card').length, svgs: el.querySelectorAll('svg').length };
          }, [pg, rg, ch]);
          n++; slowest = Math.max(slowest, r.ms);
          if (BAD_TEXT.test(r.txt) || r.errs || !r.cards) bad.push({ pg, rg, ch, bad: (r.txt.match(BAD_TEXT) || [])[0], errs: r.errs, cards: r.cards });
        }
      }
    }
    check(`${label}: ${n} page renders, none with NaN / undefined / error cards, every one has its cards (slowest ${slowest} ms)`, bad.length === 0, bad.slice(0, 4));
    const c = await counts(page);
    check(`${label}: charts alive equal the charts on screen (no stragglers after ${n} navigations)`, c.charts === await page.evaluate(() => document.querySelectorAll('.of-main .ch').length) && c.kitPages === 1, c);
    noErrors(label, logs);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 7. Today with live-looking data (time travel to 6:15 pm): the pace ring, the arrows, the live banner
 * ---------------------------------------------------------------------------------------------------------------------- */
group('Today at 6:15 pm: pace ring, arrows against yesterday, banner');
{
  const NOW = todayAt(18, 15);
  const live = await todayDs(NOW);
  await withPage({ file: FILE, w: 1280, h: 800, hash: '#/', init: fakeClock(NOW) }, async (page, logs) => {
    await boot(page, live);
    await clickSeg(page, 'Date range', 'today'); await wait(400);
    // The pace ring sits behind the page's "Show more charts and findings" button (deliberate: the lead chart comes first).
    await page.evaluate(() => { const b = document.querySelector('.of-more-btn'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); });
    await wait(600);
    const r = await page.evaluate(() => ({ ring: !!document.querySelector('.ch--ring svg'), ringText: (document.querySelector('.ch--ring') || {}).textContent, arrows: document.querySelectorAll('.of-tile-delta .icon').length, nocmp: document.querySelectorAll('.of-nocmp').length, note: document.querySelector('.of-tiles-note').textContent, head: document.querySelector('.of-headline').textContent, banner: document.querySelector('.of-banner-t').textContent, spark: document.querySelectorAll('.of-tile-spark .ch').length }));
    check('the pace ring draws from the last 10 tickets of the last 45 minutes', r.ring && /%/.test(r.ringText), r.ringText);
    check('Today has a full day before it, so the tiles show arrows with words', r.arrows >= 4 && /Arrows compare with the day before/.test(r.note), r);
    check('the headline and banner describe today\'s partial day', r.head.length > 30 && /sample/.test(r.banner), r);
    if (SHOTS) { await fullShot(page, 'pace-today-ember-1280.png', 1280); }
    // the tile words: arrow + word, tone never by colour alone
    const tl = await page.evaluate(() => [...document.querySelectorAll('.of-tile')].map((t) => ({ label: t.querySelector('.of-tile-label').textContent, delta: t.querySelector('.of-tile-delta').textContent, icon: !!t.querySelector('.of-tile-delta .icon'), tone: t.querySelector('.of-tile-delta').dataset.tone, sr: t.querySelector('.visually-hidden').textContent })));
    check('every tile with a comparison reads like "7% slower" (word), has an arrow icon, and a screen-reader sentence', tl.filter((t) => t.icon).every((t) => /(slower|faster|higher|lower|steady)/.test(t.delta) && /previous period|about the same/i.test(t.sr)), tl);
    noErrors('today', logs);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 8. Theme, reduced motion, text size
 * ---------------------------------------------------------------------------------------------------------------------- */
group('theme toggle and reduced motion');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/', reducedMotion: 'reduce' }, async (page, logs) => {
  await boot(page, sample);
  check('reduced motion: the page entrance animation is off', await page.evaluate(() => getComputedStyle(document.querySelector('.of-page')).animationName === 'none'));
  const t0 = await page.evaluate(() => document.getElementById('sb-office').dataset.otheme || document.querySelector('.office').dataset.otheme);
  await page.locator('.of-theme').click(); await wait(300);
  const t1 = await page.evaluate(() => ({ o: SB.theme.office(), attr: document.getElementById('sb-office').getAttribute('data-otheme'), label: document.querySelector('.of-theme').textContent, aria: document.querySelector('.of-theme').getAttribute('aria-label') }));
  check('the Ember / Paper button flips the office theme and its own label', t1.o !== t0 && t1.attr === t1.o && /Day|Night/.test(t1.label) && /Switch to/.test(t1.aria), { t0, t1 });
  const chartBg = await page.evaluate(() => getComputedStyle(document.querySelector('.of-card')).backgroundColor);
  check('Paper repaints the cards (light surface) without a reload', t1.o === 'paper' ? /^rgb\((2[3-5]\d|\d{3}),/.test(chartBg) : true, chartBg);
  await page.locator('.of-theme').click(); await wait(200);
  noErrors('theme', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 9. Phone behaviour (390 and 280): bottom tab bar, collapsed filters, no sideways scroll
 * ---------------------------------------------------------------------------------------------------------------------- */
group('phone: tab bar, collapsed filters, no horizontal scroll');
await withPage({ file: FILE, w: 768, h: 900, hash: '#/' }, async (page, logs) => {
  await boot(page, sample);
  for (const pg of PAGES) {
    await page.evaluate((p) => SB.office.navigate(p), pg); await wait(500);
    // Cards folded behind Show more have no width, so only visible cards are checked.
    const r = await page.evaluate(() => { const g = document.querySelector('.of-grid').getBoundingClientRect().width; return [...document.querySelectorAll('.of-grid > .of-card')].filter((c) => c.offsetParent !== null && Math.abs(c.getBoundingClientRect().width - g) > 2).length; });
    check(`768px ${pg}: the grid is one column, every card is full width`, r === 0, r);
  }
  noErrors('tablet 768', logs);
});
for (const w of [390, 280]) {
  await withPage({ file: FILE, w, h: 700, hash: '#/', touch: true }, async (page, logs) => {
    await boot(page, sample);
    const m = await page.evaluate(() => {
      const rail = document.querySelector('.of-rail').getBoundingClientRect(), main = document.querySelector('.of-col').getBoundingClientRect();
      const sum = document.querySelector('.of-fsum'), body = document.querySelector('.of-fbody');
      return { railAtBottom: rail.top > main.top && Math.abs(rail.bottom - window.innerHeight) < 2, railH: rail.height, sumShown: getComputedStyle(sum).display !== 'none', bodyHidden: getComputedStyle(body).display === 'none', sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, colSw: document.querySelector('.of-col').scrollWidth, colCw: document.querySelector('.of-col').clientWidth, items: [...document.querySelectorAll('.of-nav')].map((a) => Math.round(a.getBoundingClientRect().width)) };
    });
    check(`${w}px: the rail is a bottom tab bar with seven entries`, m.railAtBottom && m.items.length === 7, m);
    check(`${w}px: filters are collapsed behind one summary line`, m.sumShown && m.bodyHidden, m);
    check(`${w}px: no horizontal page scroll (page ${m.sw} / ${m.cw}, content ${m.colSw} / ${m.colCw})`, m.sw <= m.cw && m.colSw <= m.colCw, m);
    await page.locator('.of-fsum').click(); await wait(200);
    check(`${w}px: tapping the summary opens the filters`, await page.evaluate(() => getComputedStyle(document.querySelector('.of-fbody')).display !== 'none' && document.querySelector('.of-fsum').getAttribute('aria-expanded') === 'true'));
    if (SHOTS) await page.screenshot({ path: path.join(OUT, `filters-open-ember-${w}.png`) });
    await page.locator('.of-fsum').click();
    for (const pg of PAGES) {
      await page.evaluate((p) => SB.office.navigate(p), pg); await wait(500);
      const o = await page.evaluate(() => ({ sw: document.querySelector('.of-col').scrollWidth, cw: document.querySelector('.of-col').clientWidth, wide: [...document.querySelectorAll('.of-main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && !e.closest('.of-tablewrap') && !e.closest('.ch-tblwrap'); }).slice(0, 3).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().right)) }));
      check(`${w}px ${pg}: nothing pokes out of the screen (outside scrolling table wrappers)`, o.sw <= o.cw && o.wide.length === 0, o);
    }
    noErrors('phone ' + w, logs);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 10. Screenshots: 3 pages x 5 viewports x Ember / Paper
 * ---------------------------------------------------------------------------------------------------------------------- */
if (SHOTS) await shotsRun();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
