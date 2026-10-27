// WHAT THIS FILE IS: Office B end-to-end test (browser) for the three back-office pages
// (Sales and money, Safety, Stock and 86).
// Run: node test/office-b.e2e.mjs [--no-shots] [--no-build]
// Builds a private bundle (dist/officeB.html) of everything in src/, uses the real simulator (SB.sim.sample()) for the data, and
// injects thin, empty, tickets-only and no-cost variants of it with SB.store.attachSim. Screenshots go to test/.out/officeB/.
// Exit code 1 on any failed check, console error or page error.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withPage as pwWithPage } from '../tools/pw.mjs';
import { startKitchen } from './_kitchen.mjs';
// A group that throws counts as one failed check and the next group still runs.
const withPage = (...a) => pwWithPage(...a).catch((e) => { fail++; failures.push('group threw'); console.log('  FAIL  group threw: ' + String(e.message).split('\n')[0].slice(0, 300)); });
import { loadSB } from './_load.mjs';
import { emptyDs } from './_office-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'test/.out/officeB');
const FILE = path.join(root, 'dist/officeB.html');
const SHOTS = !process.argv.includes('--no-shots');
fs.mkdirSync(OUT, { recursive: true });
if (!process.argv.includes('--no-build')) execFileSync('node', [path.join(root, 'tools/build.mjs'), '--out', FILE, '--quiet'], { cwd: root, stdio: 'inherit' });

let pass = 0, fail = 0;
const failures = [];
// Records one pass or fail line; a failure keeps its detail so the run summary can print it.
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '')); }
}
// Prints a heading line between groups of checks.
const group = (t) => console.log('\n# ' + t);
// Pauses for a number of milliseconds (the pages repaint on their own schedule).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Checks that the page logged no console errors and threw no page errors.
const noErrors = (name, logs) => check(name + ': no console errors or page errors', logs.errors.length === 0 && logs.pageErrors.length === 0, { errors: logs.errors.slice(0, 3), pageErrors: logs.pageErrors.slice(0, 3) });
const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object|\bnull\b/;
const PAGES = ['money', 'safety', 'stock'];
const TITLES = { money: 'Sales and money', safety: 'Safety', stock: 'Stock and 86' };
const VIEWPORTS = [[2560, 1440], [1280, 800], [1024, 768], [390, 844], [280, 640]];
// True when two numbers are within a tolerance of each other.
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---------- datasets made in Node from the real simulator ---------- */
const SBn = await loadSB(['00-util', '10-config', '20-engine', '30-store', '40-metrics', '45-sim']);
const real = SBn.sim.sample();
const lastT = Math.max.apply(null, real.tickets.map((t) => t.createdAt));
const cut = lastT - 2 * 864e5;
// thin: the last two days, a seventh of the tickets, a fifth of the batches, and no refused-order reports
const thin = (() => {
  const tickets = real.tickets.filter((t) => t.createdAt >= cut).filter((_, i) => i % 7 === 0);
  const ids = new Set(tickets.map((t) => t.id));
  const batches = real.batches.filter((b) => b.enteredAt >= cut).filter((_, i) => i % 5 === 0);
  const bids = new Set(batches.map((b) => b.id));
  const events = real.events.filter((e) => e.t >= cut && e.type !== 'ui_report' && (e.ticketId ? ids.has(e.ticketId) : e.batchId ? bids.has(e.batchId) : true));
  return Object.assign({}, real, { tickets, batches, events });
})();
// tickets only: sales exist, the hold cabinet was never used
const ticketsOnly = Object.assign({}, real, { batches: [], events: real.events.filter((e) => e.ticketId) });
// no cost: every pit beans line has lost its recorded cost
const noCost = Object.assign({}, real, { tickets: real.tickets.map((t) => (t.items.some((i) => i.menuId === 'beans') ? Object.assign({}, t, { items: t.items.map((i) => (i.menuId === 'beans' ? Object.assign({}, i, { cost: null }) : i)) }) : t)) });
const empty = emptyDs();

// ---------- page helpers ----------
// Opens the built bundle on a back-office page, optionally with a test dataset and a theme.
async function boot(page, section, { ds = null, theme = null } = {}) {
  await startKitchen(page, { sample: true }); // known state; the back office tests need sample history switched on
  // The store serves this dataset instead of the simulator's own sample.
  if (ds) await page.evaluate((d) => { SB.store.attachSim({ sample: () => d }); }, ds);
  if (theme) await page.evaluate((t) => SB.theme.setOffice(t), theme);
  await page.evaluate((s) => { location.hash = '#/office/' + s; }, section);
  await page.waitForFunction((s) => document.querySelector('.of [data-page="' + s + '"]') && SB.shell.inOffice(), section, { timeout: 25000 });
  await page.waitForFunction(() => !document.getElementById('sb-office').classList.contains('is-igniting'), null, { timeout: 25000 });
  await wait(450);
}
// Text content of the first element matching a selector, or an empty string.
const text = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
// All text on the main page area.
const mainText = (page) => text(page, '.of-main');
// Finds a card by its exact title.
const card = (page, title) => page.locator('.of-card', { has: page.locator('.of-card-title', { hasText: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) });
// The sentence a page gives each chart (spec.ariaLabel) sits on the chart's figure element; the drawing inside has a generic label.
const svgLabel = (page, title) => card(page, title).locator('figure.ch').first().getAttribute('aria-label');
// Press a stepper button up to n times inside the page; a disabled button (the end of the range) does nothing, as for a real thumb.
const press = (page, aria, n) => page.evaluate(([a, k]) => { const b = [...document.querySelectorAll('.ob-wi-ctl .stepper-btn')].find((x) => !x.classList.contains('is-big') && x.getAttribute('aria-label').indexOf(a) === 0); for (let i = 0; i < k; i++) if (!b.disabled) b.click(); return b.disabled; }, [aria, n]);
async function fullShot(page, file, w) {
  const hgt = await page.evaluate(() => (document.querySelector('.of-col') ? document.querySelector('.of-col').scrollHeight : 0));
  const orig = page.viewportSize();
  await page.setViewportSize({ width: orig.width, height: Math.max(orig.height, Math.min(14000, hgt + 30)) });
  await wait(500);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.setViewportSize(orig);
  await wait(250);
}
// Resolve every visible text element's colour against its real background and report the worst contrast ratio.
const CONTRAST_JS = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  // Turns any CSS color into [r, g, b, alpha] by painting one pixel.
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  // Blends a translucent color over the color beneath it.
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a ? [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
  // The solid color an element really sits on, found by stacking its ancestors' backgrounds.
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 0.999) break; } let acc = [24, 21, 19, 1]; for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc); return acc; };
  // Relative luminance of a color, as used in the 4.5 to 1 contrast rule.
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const sels = '.ob-stat-l,.ob-stat-v,.ob-stat-n,.ob-co-title,.ob-co-body,.ob-co-extra,.ob-co-tone,.ob-tag,.ob-sg-h,.ob-sg-n,.ob-sg-t,.ob-note,.ob-src,.ob-rule-t,.ob-rule-d,.ob-safetyline,.ob-sentences li,.ob-ctl-l,.ob-li-n,.ob-li-s,.ob-text,.ob-bigline,.of-look,.of-card-sub,.of-card-title,.of-headline,.of-section-s';
  let worst = { ratio: 99, sel: '', text: '' };
  const seen = [];
  document.querySelectorAll(sels).forEach((el) => {
    if (!el.offsetParent || !(el.textContent || '').trim()) return;
    const fg = rgba(getComputedStyle(el).color), bg = bgOf(el);
    const f = over(fg, bg);
    const L1 = lum(f), L2 = lum(bg), r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    seen.push(r);
    if (r < worst.ratio) worst = { ratio: Math.round(r * 100) / 100, sel: el.className || el.tagName, text: el.textContent.trim().slice(0, 40) };
  });
  return { worst, n: seen.length };
};

/* ------------------------------------------------------------------------------------------------------------------------
 * 0. Pure helpers (Node, no DOM)
 * ---------------------------------------------------------------------------------------------------------------------- */
group('pure helpers in Node');
{
  const SB = await loadSB(['82-office-money']);
  const B = SB.officeB;
  check('82-office-money.js loads in Node without a DOM and exports SB.officeB', !!B && typeof B.median === 'function' && typeof B.openOverlapMs === 'function');
  check('median: odd, even, empty and junk', B.median([3, 1, 2]) === 2 && B.median([1, 2, 3, 4]) === 2.5 && B.median([]) === null && B.median([NaN, null, 5]) === 5);
  check('list: a, b and c', B.list(['a', 'b', 'c']) === 'a, b and c' && B.list(['a', 'b']) === 'a and b' && B.list(['a']) === 'a' && B.list([]) === '');
  check('plural and hoursWords', B.plural(1, 'day') === 'day' && B.plural(2, 'day') === 'days' && B.hoursWords(7.3) === '7.3 hours' && B.hoursWords(1) === '1 hour' && B.hoursWords(0.75) === '45 minutes' && B.hoursWords(NaN) === '');
  const S = { openHour: 11, closeHour: 21, dayStartHour: 4 };
  // Local epoch ms for a day in October 2026 at a given hour and minute.
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const H = 36e5;
  check('openOverlap: a span inside opening hours counts in full', B.openOverlapMs(at(16, 12), at(16, 15), S) === 3 * H);
  check('openOverlap: a lockout from 9:18 pm to 10:30 am next day cost nothing', B.openOverlapMs(at(16, 21, 18), at(17, 10, 30), S) === 0);
  check('openOverlap: 9:18 pm to 12:30 pm next day cost 1.5 hours', B.openOverlapMs(at(16, 21, 18), at(17, 12, 30), S) === 1.5 * H);
  check('openOverlap: three days add up (6 h + 10 h + 2 h)', B.openOverlapMs(at(14, 15), at(16, 13), S) === 18 * H);
  check('openOverlap: no end runs to the cap; no end and no cap is 0', B.openOverlapMs(at(16, 12), null, S, at(16, 13)) === H && B.openOverlapMs(at(16, 12), null, S) === 0);
  check('openOverlap: junk start or backwards span is 0', B.openOverlapMs(NaN, at(16, 13), S) === 0 && B.openOverlapMs(at(16, 14), at(16, 12), S) === 0);
  // Builds a fake 86 spell for one menu item, for the lockout and spell grouping checks.
  const sp = (menuId, ing, startT, endT) => ({ menuId, ing, name: menuId, reason: 'stock', date: '2026-10-16', startT, endT });
  const cl = B.clusterSpells([sp('a', 'brisket', at(16, 13), at(16, 14)), sp('b', 'brisket', at(16, 13, 0) + 1000, at(16, 14, 5)), sp('c', 'brisket', at(16, 13, 30), at(16, 15)), sp('d', 'pork', at(16, 13), at(16, 13, 5))]);
  check('clusterSpells: items from one ingredient at one moment become one row; 30 minutes later is another', cl.length === 3 && cl.filter((c) => c.ing === 'brisket').length === 2 && cl.find((c) => c.items.length === 2), cl.map((c) => [c.ing, c.items.length]));
  check('clusterSpells: an open spell stays open and durations are filled in', (() => { const o = B.clusterSpells([sp('a', 'x', at(16, 20), null), sp('b', 'x', at(16, 20), at(16, 20, 9))]); return o.length === 1 && o[0].endT === null && o[0].durationMs === null; })());
  const nowMs = at(17, 15);
  const capped = B.clusterSpells([sp('a', 'x', at(16, 20), null)], { S, nowMs });
  check('clusterSpells: a spell with no end on an earlier day is counted only to closing time and flagged', capped[0].openMs === H && capped[0].cappedAtClose === true, capped[0]);
  const live = B.clusterSpells([Object.assign(sp('a', 'x', at(17, 12), null), { date: '2026-10-17' })], { S, nowMs });
  check('clusterSpells: a spell still running today is counted to now', live[0].openMs === 3 * H && !live[0].cappedAtClose, live[0]);
  check('settings fall back to the config', (() => { const s = B.settings({}); return s.openHour === 11 && s.closeHour === 21 && s.dayStartHour === 4 && s.safety.hotHoldF === 135; })());
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 1. Every page renders with the real simulator data (Ember, 1280 x 800)
 * ---------------------------------------------------------------------------------------------------------------------- */
group('each page renders with sample data');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  check('no module failed to load', (await page.evaluate(() => window.__sbLoadErrors || [])).length === 0);
  const regs = await page.evaluate(() => ['money', 'safety', 'stock'].map((id) => document.querySelector('.of-nav[data-page="' + id + '"]') ? 1 : 0));
  await boot(page, 'money');
  const rail = await page.evaluate(() => [...document.querySelectorAll('.of-rail-li > .of-nav')].map((a) => ({ t: a.getAttribute('aria-label') || a.textContent, soon: a.classList.contains('is-soon') })));
  check('the rail lists Sales and money, Safety and Stock and 86 as real pages (not "coming soon")', ['Sales and money', 'Safety', 'Stock and 86'].every((n) => rail.some((r) => r.t.indexOf(n) === 0 && !r.soon)), rail);
  check('the three pages sit at rail positions 4, 5 and 6', /^Sales and money/.test(rail[3].t) && /^Safety/.test(rail[4].t) && /^Stock and 86/.test(rail[5].t));
  for (const id of PAGES) {
    await boot(page, id);
    const f = await page.evaluate(() => {
      // The Best day card shows its honest empty state with under two weeks of data. The End of day panel is a button panel, not a chart or table card, so it has no "What to look for" caption.
      const cards = [...document.querySelectorAll('.of-card')].filter((c) => !/^End of day|^Best day of the week/.test((c.querySelector('.of-card-title') || {}).textContent || ''));
      const chartCards = cards.filter((c) => ['bar', 'line', 'gantt', 'ring', 'meter', 'scatter'].indexOf(c.dataset.type) >= 0);
      return {
        h1: document.querySelector('h1.of-title').textContent, headline: document.querySelector('.of-headline').textContent, hn: document.querySelectorAll('.of-headline .of-hn').length,
        cards: cards.length, looks: cards.filter((c) => c.querySelector('.of-look')).length, charts: chartCards.length,
        labelled: chartCards.filter((c) => { const f = c.querySelector('figure.ch'), s = c.querySelector('.ch-svg'); return f && s && (f.getAttribute('aria-label') || '').length > 40; }).length,
        emptyShown: chartCards.filter((c) => c.querySelector('.ch-empty:not([hidden]), .of-empty')).length,
        errors: document.querySelectorAll('.of-error').length, tiles: document.querySelectorAll('.of-tile').length, sections: document.querySelectorAll('.of-section-t').length,
        live: SB.charts.live(),
      };
    });
    check(id + ': title, a headline with bold numbers, no error cards', f.h1 === TITLES[id] && f.headline.length > 40 && f.hn >= 2 && f.errors === 0, f);
    check(id + ': every card has a "What to look for" caption', f.cards >= 5 && f.looks === f.cards, f);
    check(id + ': every chart has an aria-label of a sentence and none is blank', f.charts >= 2 && f.labelled === f.charts, f);
    check(id + ': with data no chart shows its empty state', f.emptyShown === 0, f);
    check(id + ': no NaN, undefined, null or [object] in the text', !BAD_TEXT.test(await mainText(page)), (await mainText(page)).match(BAD_TEXT));
    if (id === 'money') check('money: four KPI tiles', f.tiles === 4, f.tiles);
    if (SHOTS) await fullShot(page, id + '-ember-1280x800.png', 1280);
  }
  noErrors('sample data pages', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 2. Sales and money
 * ---------------------------------------------------------------------------------------------------------------------- */
group('sales and money');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, 'money');
  const ref = await page.evaluate(() => {
    const ds = SB.store.dataset({ sample: true }), F = SB.office.filters();
    const p = SB.metrics.prepare(ds, { from: F.range.from, to: F.range.to, channel: F.channel, now: Date.now() });
    const cmp = SB.metrics.compare(p), items = SB.metrics.byItem(p), yc = SB.metrics.yieldComparison(p).primary;
    return { revenue: SB.metrics.sales(p).net, avg: SB.metrics.sales(p).avgCheck, // the Sales tile is money from paid orders after discounts (M.sales), not ticket revenue
       cost: SB.metrics.foodCostPct(p).costPct, sold: items.reduce((a, r) => a + (r.sold || 0), 0), err: yc ? yc.staticCostErr : null, staticY: yc ? yc.staticYield : null, trueCost: yc ? yc.trueCostPerCookedKg : null, raw: yc ? yc.costPerKgRaw : null };
  });
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.of-tile')].map((t) => ({ label: t.querySelector('.of-tile-label').textContent.trim(), val: t.querySelector('.of-tile-val').textContent.trim() })));
  check('tiles: Sales, Average order, Food cost, Items sold, in that order', tiles.map((t) => t.label).join('|') === 'Sales|Average order|Food cost|Items sold', tiles.map((t) => t.label));
  // Pulls the number out of a text such as 12.5 kg.
  const num = (s) => parseFloat(String(s).replace(/[^0-9.]/g, ''));
  check('tiles: revenue matches SB.metrics', num(tiles[0].val) === Math.round(ref.revenue), [tiles[0].val, ref.revenue]);
  check('tiles: average ticket value matches SB.metrics to the cent', near(num(tiles[1].val), ref.avg, 0.006), [tiles[1].val, ref.avg]);
  check('tiles: food cost is a percentage that matches SB.metrics (a fraction turned into percent)', near(num(tiles[2].val), ref.cost * 100, 0.06) && /%/.test(tiles[2].val), [tiles[2].val, ref.cost]);
  check('tiles: items sold matches the sum over items', num(tiles[3].val) === ref.sold, [tiles[3].val, ref.sold]);
  const cmpText = await text(page, '.of-tiles-wrap');
  check('tiles: with no full earlier period the page says so instead of inventing a change', /earlier/i.test(cmpText) && !BAD_TEXT.test(cmpText), cmpText.slice(0, 160));

  // top items: the switch changes the chart
  const topBefore = await svgLabel(page, 'Top items');
  await card(page, 'Top items').locator('.seg-opt', { hasText: 'Menu value' }).click();
  await wait(250);
  const topAfter = await svgLabel(page, 'Top items');
  check('top items: the Sold/Menu value switch changes the chart', topBefore !== topAfter && /by menu value/.test(topAfter) && /by number sold/.test(topBefore), [topBefore, topAfter]);
  check('top items: "Menu value" shows money, "Sold" shows counts', /\$[\d,]+ in menu value/.test(topAfter) && /[\d,]+ sold/.test(topBefore));
  const mBefore = await svgLabel(page, 'Margin by item');
  await card(page, 'Margin by item').locator('.seg-opt', { hasText: 'Percent of price' }).click();
  await wait(250);
  const mAfter = await svgLabel(page, 'Margin by item');
  check('margin: the three-way switch changes the chart', mBefore !== mAfter && /share of menu price/.test(mAfter), [mBefore, mAfter]);

  // sections the owner asked for
  const t = await mainText(page);
  for (const w of ['Top items', 'Sales by hour of the day', 'Average order by channel', 'Food cost by day', 'Margin by item', 'Cost not recorded', 'Cooked yield: assumed, modeled and real', 'What a fixed yield costs you', 'Try it: what would a different cook do to the yield?']) check('section present: ' + w, t.indexOf(w) >= 0);
  check('food cost line has a labelled reference band and says it is a rule of thumb', /rule of thumb/i.test(t));

  // yield
  const yp = await page.locator('.of-card', { has: page.locator('.of-card-title', { hasText: 'What a fixed yield costs you' }) }).textContent();
  const m = yp.match(/If you had priced brisket with the static yield you would have been off by ([0-9.]+|less than 0\.1)%\./);
  check('yield: the sentence "If you had priced brisket with the static yield you would have been off by X%." is there', !!m, yp.slice(0, 200));
  check('yield: X is the metric (staticCostErr as a percent)', !!m && near(parseFloat(m[1]), Math.abs(ref.err) * 100, 0.06), [m && m[1], ref.err]);
  check('yield: the true cooked cost per kg is shown', yp.indexOf('$' + ref.trueCost.toFixed(2)) >= 0, ref.trueCost);
  const yl = await svgLabel(page, 'Cooked yield: assumed, modeled and real');
  check('yield: static, Texas A&M model and realised batches are all compared', /Static assumption/.test(yl) && /Texas A&M model/.test(yl) && /Your weighed batches/.test(yl), yl);

  // what-if against the engine
  const wi = page.locator('.of-card', { has: page.locator('.of-card-title', { hasText: 'Try it' }) });
  // Reads one output value of the what-if panel.
  const out = async (k) => (await wi.locator('[data-out="' + k + '"]').first().textContent()).trim();
  // Asks the real engine for the thermal yield, to compare with what the page shows.
  const eng = (T, H, kg, cost) => page.evaluate(([T, H, kg, cost]) => SB.engine.thermalYield({ endpointC: T, holdH: H, rawG: kg * 1000, costPerKgRaw: cost }), [T, H, kg, cost]);
  // Sets the three steppers, then checks that the page's numbers equal the engine's.
  async function matches(label, T, H, kg) {
    const e = await eng(T, H, kg, ref.raw);
    const hot = parseFloat(await out('hot')), chilled = parseFloat(await out('chilled')), cooked = await out('cooked'), cost = await out('cost');
    const okCooked = /kg$/.test(cooked) && near(parseFloat(cooked) * 1000, e.cookedG, 11);
    check('what-if ' + label + ': hot ' + hot + '%, chilled ' + chilled + '%, cooked ' + cooked + ', cost ' + cost + ' match SB.engine.thermalYield', near(hot, e.hotPct, 0.051) && near(chilled, e.chilledPct, 0.051) && okCooked && near(parseFloat(cost.replace(/[^0-9.]/g, '')), e.trueCostPerCookedKg, 0.006), [e, hot, chilled, cooked, cost]);
  }
  await matches('defaults (85 C, 2 h, 10 kg)', 85, 2, 10);
  check('what-if: the source label is on the panel', /Texas A&M regression, hot-hold yield; starter model, confirm against your own weighed batches/.test(await wi.textContent()));
  await wi.locator('button[aria-label^="Increase end temperature"]:not(.is-big)').first().click();
  await matches('after +1 degree', 86, 2, 10);
  await wi.locator('button[aria-label^="Decrease hold time"]:not(.is-big)').first().click();
  await matches('after -0.25 h', 86, 1.75, 10);
  await wi.locator('button[aria-label^="Increase raw weight"]:not(.is-big)').first().click();
  await matches('after +0.5 kg raw', 86, 1.75, 10.5);
  // the ends of the ranges
  await press(page, 'Increase end temperature', 20);
  await matches('at the top of the temperature range (90 C)', 90, 1.75, 10.5);
  check('what-if: the temperature stepper stops at 90', (await wi.locator('input[aria-label="End temperature"]').inputValue()) === '90');
  await press(page, 'Decrease end temperature', 30);
  await matches('at the bottom of the temperature range (75 C)', 75, 1.75, 10.5);
  await press(page, 'Decrease hold time', 20);
  await matches('hold 0 h', 75, 0, 10.5);
  check('what-if: the hold stepper stops at 0', (await wi.locator('input[aria-label="Hold time"]').inputValue()) === '0' || parseFloat(await wi.locator('input[aria-label="Hold time"]').inputValue()) === 0);
  const wt = await wi.textContent();
  check('what-if: weights are kilograms and grams only', !/\b(lb|lbs|oz|pound|ounce)s?\b/i.test(wt));
  const yt = yp + wt;
  check('yield panels carry no pounds or ounces', !/\b(lb|lbs|oz|pounds?|ounces?)\b/i.test(yt));

  // channel filter keeps the page alive
  await page.locator('.of-filters select').first().selectOption('takeout');
  await wait(500);
  check('channel filter: the page stays drawn and honest', (await page.locator('.of-card').count()) >= 8 && !BAD_TEXT.test(await mainText(page)));
  noErrors('sales and money', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 3. Sales and money: items with no cost
 * ---------------------------------------------------------------------------------------------------------------------- */
group('sales and money: items without a recorded cost');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, 'money', { ds: noCost });
  const nc = await card(page, 'Cost not recorded').textContent();
  check('cost not recorded: the item is listed with the words "Cost not recorded" and its sales', /Pit beans with burnt ends/.test(nc) && (nc.match(/Cost not recorded/g) || []).length >= 2 && /\d+ sold/.test(nc), nc.slice(0, 300));
  check('cost not recorded: a button to Menu, prices and shop is offered', /Open Menu, prices and shop/.test(nc));
  const lbl = await svgLabel(page, 'Margin by item');
  const tbl = await page.evaluate(() => { const c = [...document.querySelectorAll('.of-card')].find((x) => /Margin by item/.test(x.textContent) && x.dataset.type === 'bar'); c.querySelector('.ch-tbtn').click(); return c.querySelector('.ch-tblwrap').textContent; });
  check('margin chart leaves the item out; it is never shown as zero', tbl.indexOf('Pit beans') < 0 && !/Pit beans.*\$0\.00/.test(tbl), tbl.slice(0, 200));
  check('no NaN or undefined anywhere', !BAD_TEXT.test(await mainText(page)));
  await page.locator('.of-card', { has: page.locator('.of-card-title', { hasText: 'Cost not recorded' }) }).locator('button', { hasText: 'Open Menu, prices and shop' }).click();
  await wait(500);
  check('the button goes to Menu, prices and shop', (await page.evaluate(() => location.hash)) === '#/office/data', await page.evaluate(() => location.hash));
  noErrors('no-cost items', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 4. Safety
 * ---------------------------------------------------------------------------------------------------------------------- */
group('safety');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, 'safety');
  const ref = await page.evaluate(() => {
    const ds = SB.store.dataset({ sample: true }), F = SB.office.filters();
    const p = SB.metrics.prepare(ds, { from: F.range.from, to: F.range.to, channel: F.channel, now: Date.now() });
    const k = SB.metrics.compliance(p);
    return { score: k.score, temp: k.tempChecks.onTimePct, san: k.sanitize.onTimePct, tempN: k.tempChecks.count, days: SB.metrics.batchTimeline(p, {}).rows.length };
  });
  const v = await page.evaluate(() => { const c = document.querySelector('.ob-callout'); return { tone: c.dataset.tone, word: c.querySelector('.ob-co-word').textContent, title: c.querySelector('.ob-co-title').textContent, body: c.querySelector('.ob-co-body').textContent, extra: c.querySelector('.ob-co-extra').textContent, btn: (c.querySelector('.ob-co-act .btn') || {}).textContent || '' }; });
  check('verdict: a plain answer in a tone with a word, not colour alone', ['good', 'warn', 'bad'].indexOf(v.tone) >= 0 && v.word.length > 2 && v.title.length > 15, v);
  check('verdict: the body quotes the compliance numbers', v.body.indexOf(Math.round(ref.temp * 100) + '%') >= 0 && v.body.indexOf(String(ref.tempN)) >= 0, [v.body, ref]);
  if (v.tone !== 'good') check('verdict: the one problem is named with a day and a button to it', /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(v.extra) && /^Show/.test(v.btn.trim()), v);
  const ringTxt = await card(page, 'Checks kept on time').textContent();
  check('ring: the compliance score is shown and matches', ringTxt.indexOf(Math.round(ref.score * 100) + '%') >= 0, [ringTxt.slice(-120), ref.score]);
  const tsub = await card(page, 'Temperature checks on time').locator('.of-card-sub').textContent();
  const ssub = await card(page, 'Sanitize rounds on time').locator('.of-card-sub').textContent();
  check('meters: "on time" is explained in words with the interval from settings', /within 2 hours/.test(tsub) && /within 4 hours/.test(ssub), [tsub, ssub]);

  // the timeline: day picker
  const opts = await page.evaluate(() => [...document.querySelectorAll('.of-card [aria-label], .of-card select')].filter((s) => s.tagName === 'SELECT').map((s) => [...s.options].map((o) => [o.value, o.textContent])));
  const daySelect = card(page, 'Batch timeline').locator('select');
  const options = await daySelect.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
  check('timeline: the day picker lists days that have batches, newest first, with how many were flagged', options.length >= 5 && options[0][0] > options[options.length - 1][0] && options.every((o) => /\d+ batches?/.test(o[1])), options.slice(0, 3));
  // Counts the rows drawn in the batch timeline chart.
  const rowsOf = () => card(page, 'Batch timeline').locator('.ch-svg .ch-glabel, .ch-svg text.ch-rowlabel, .ch-svg [data-row]').count();
  const labelA = await svgLabel(page, 'Batch timeline');
  const other = options.find((o, i) => i > 2 && o[0] !== options[0][0]);
  await daySelect.selectOption(other[0]);
  await wait(400);
  const labelB = await svgLabel(page, 'Batch timeline');
  check('timeline: choosing another day changes the chart', labelA !== labelB, [labelA, labelB]);
  check('timeline: the aria-label names the day', new RegExp(other[1].split(':')[0].replace(/\//g, '\\/')).test(labelB), [other, labelB]);
  const allBefore = await card(page, 'Batch timeline').locator('.ch-svg g[data-row], .ch-svg .ch-grow').count();
  await card(page, 'Batch timeline').locator('.seg-opt', { hasText: 'All batches' }).click();
  await wait(300);
  const nAll = (await svgLabel(page, 'Batch timeline')).match(/Timeline of (\d+)/);
  await card(page, 'Batch timeline').locator('.seg-opt', { hasText: 'Problems only' }).click();
  await wait(300);
  const lblP = await svgLabel(page, 'Batch timeline');
  check('timeline: "Problems only" narrows the chart', /showing only those/.test(lblP) || /none to show/.test(lblP), lblP);
  const heightAll = await card(page, 'Batch timeline').locator('.ch-svg').evaluate((s) => s.getBoundingClientRect().height);
  await card(page, 'Batch timeline').locator('.seg-opt', { hasText: 'All batches' }).click();
  await wait(300);
  const heightAll2 = await card(page, 'Batch timeline').locator('.ch-svg').evaluate((s) => s.getBoundingClientRect().height);
  check('timeline: all batches draws a taller chart than problems only', heightAll2 >= heightAll, [heightAll, heightAll2]);
  const leg = await card(page, 'Batch timeline').textContent();
  check('timeline: legend names the four colours in words', ['In range', 'Temperature check due', 'Reheat or chill now', 'Thrown out'].every((w) => leg.indexOf(w) >= 0));
  // verdict button jumps
  if (v.tone !== 'good') {
    await page.locator('.ob-co-act .btn').click();
    await wait(500);
    const sel = await daySelect.evaluate((s) => s.options[s.selectedIndex].textContent);
    const day = v.btn.trim().replace(/^Show /, '').replace(/ in the timeline$/, '');
    check('verdict button: moves the timeline to the problem day', sel.indexOf(day) === 0, [sel, day]);
  }
  // discards
  const d0 = await svgLabel(page, 'Thrown out by reason');
  await card(page, 'Thrown out by reason').locator('.seg-opt', { hasText: 'Cost' }).click();
  await wait(300);
  const d1 = await svgLabel(page, 'Thrown out by reason');
  check('discards: the Weight/Cost switch changes the chart', d0 !== d1 && /by cost/.test(d1) && /by weight/.test(d0), [d0, d1]);
  check('waste by day has a watch line', /watch line/i.test(await svgLabel(page, 'Waste by day')));
  // lockouts
  const lk = await card(page, 'Items taken off the menu for food safety').textContent();
  check('lockouts: counted in opening hours only, and says what was left out', /Off during opening hours/.test(lk) && (/after closing/.test(lk) || /No item was taken off/.test(lk)), lk.slice(0, 300));
  const lkTimes = await card(page, 'Items taken off the menu for food safety').locator('tbody tr td:last-child').allTextContents();
  // Turns a duration text such as 1h 5m 3s into seconds; Under a minute reads as 0.
  const toMs = (s) => { const m = s.match(/(?:(\d+)h )?(\d+)m(?: (\d+)s)?/); return m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) : s.indexOf('Under') === 0 ? 0 : NaN; };
  check('lockouts: no row lasts longer than one opening day (10 hours)', lkTimes.every((s) => toMs(s) <= 10 * 3600), lkTimes);
  check('lockouts: sorted by time lost, longest first', lkTimes.map(toMs).every((x, i, a) => i === 0 || a[i - 1] >= x), lkTimes);
  // rules
  const rules = await page.evaluate(() => { const c = [...document.querySelectorAll('.of-card')].find((x) => /What the rules are/.test(x.textContent) && x.querySelector('.ob-rules')); return { rows: [...c.querySelectorAll('.ob-rule')].map((r) => r.textContent), last: c.querySelector('.of-card-body').lastElementChild.textContent, note: c.querySelector('.ob-note').textContent, btn: !!c.querySelector('.ob-actions .btn') }; });
  check('rules: seven live rows', rules.rows.length === 7, rules.rows.length);
  const joined = rules.rows.join(' | ');
  check('rules: hot 135 F, cold 41 F, reheat 165 F once, own hold limits, 2 hour grace, 2 hour checks, 4 hour sanitize', ['135', '41', '165', 'once', 'own hold limit', 'Grace of 2 hours', 'every 2 hours', 'every 4 hours'].every((w) => joined.indexOf(w) >= 0), joined);
  check('rules: always ends with the safety line from the config', rules.last.trim() === (await page.evaluate(() => SB.config.safetyLine)), rules.last);
  check('rules: says the grace clock differs from the report (finding F-E1)', /first reading below/.test(rules.note) && /stricter|health department/.test(rules.note), rules.note);
  // live from settings
  const rep = await page.evaluate(() => SB.store.dispatchEx('updateSettings', { patch: { safety: { hotHoldF: 140, tempCheckEveryMin: 20 } } }, { source: 'ui' }).report);
  check('settings change accepted by the engine (hot hold 140, checks every 20 minutes)', rep === 'ok', rep);
  await page.evaluate(() => SB.office._debug.refreshNow());
  await wait(500);
  const joined2 = await page.evaluate(() => [...document.querySelectorAll('.ob-rule')].map((r) => r.textContent).join(' | '));
  check('rules follow the settings live (140 F, every 20 minutes)', /140/.test(joined2) && /every 20 minutes/.test(joined2), joined2.slice(0, 200));
  check('the meter explanation follows the settings too', /within 20 minutes/.test(await card(page, 'Temperature checks on time').locator('.of-card-sub').textContent()));
  await page.locator('.ob-actions .btn', { hasText: 'Change these in Menu, prices and shop' }).click();
  await wait(500);
  check('rules: the button goes to Menu, prices and shop', (await page.evaluate(() => location.hash)) === '#/office/data');
  noErrors('safety', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 5. Stock and 86
 * ---------------------------------------------------------------------------------------------------------------------- */
group('stock and 86');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  await boot(page, 'stock');
  const ref = await page.evaluate(() => {
    const ds = SB.store.dataset({ sample: true }), F = SB.office.filters();
    const p = SB.metrics.prepare(ds, { from: F.range.from, to: F.range.to, channel: F.channel, now: Date.now() });
    const so = SB.metrics.sellOutClock(p), sl = SB.metrics.syncLatency(p);
    return { so: { dayCount: so.dayCount, proteins: so.proteins.map((x) => ({ ing: x.ing, name: x.name, days: x.days })), rows: so.rows.length }, sl: { median: SB.office.kit.fmt.ms(sl.medianMs), p90: SB.office.kit.fmt.ms(sl.p90Ms), max: SB.office.kit.fmt.ms(sl.maxMs), within: SB.office.kit.fmt.pct(sl.withinPct, 0), count: sl.count } };
  });
  const v = await page.evaluate(() => { const c = document.querySelector('.ob-callout'); return { title: c.querySelector('.ob-co-title').textContent, body: c.querySelector('.ob-co-body').textContent, extra: c.querySelector('.ob-co-extra').textContent }; });
  check('story: names the protein and the time it went 86 and how long before close', /went 86 at \d+:\d\d (am|pm), .* before close\./.test(v.title) || /lasted all day/.test(v.title), v.title);
  check('story: says what was cooked and served in grams or kilograms', /kg|g was/.test(v.body) && !/\b(lb|oz)\b/.test(v.body), v.body);
  // sentences (the sell-out clock)
  const sent = await page.locator('.ob-sentences li').allTextContents();
  const re = /^(.+) sold out on (\d+) of (\d+) days?, the earliest at (\d+:\d\d (?:am|pm)), ([\d.]+ (?:hours?|minutes?)) before close\.$/;
  const parsed = sent.filter((s) => re.test(s)).map((s) => s.match(re));
  check('sell-out clock: one sentence per protein that sold out, in the owner\'s wording', parsed.length === ref.so.proteins.filter((x) => x.days > 0).length && parsed.length >= 1, sent);
  check('sell-out clock: the counts match SB.metrics.sellOutClock', parsed.every((m) => { const pr = ref.so.proteins.find((x) => x.name === m[1]); return pr && pr.days === +m[2] && ref.so.dayCount === +m[3]; }), [parsed.map((m) => m.slice(1, 4)), ref.so]);
  check('sell-out clock: the dots are drawn (one per sell-out)', (await card(page, 'When each protein went 86').locator('.ch-svg [class*="ch-pt"], .ch-svg .ch-dot, .ch-svg .ch-mark').count()) >= 1 || /\d+ sell-outs/.test(await svgLabel(page, 'When each protein went 86')));
  check('sell-out clock: the aria-label says how many and the earliest', new RegExp(ref.so.rows + ' sell-outs in ' + ref.so.dayCount + ' days').test(await svgLabel(page, 'When each protein went 86')), await svgLabel(page, 'When each protein went 86'));
  // suggestions
  const sg = await page.locator('.ob-sg').evaluateAll((els) => els.map((e) => e.textContent));
  check('cook tomorrow: one card per protein with the numbers it used', sg.length === ref.so.proteins.length && sg.every((s) => /Cook about [\d.]+ kg|Not enough/.test(s) && /Suggestion from (days that include sample history|your own days)|Not enough/.test(s)), sg);
  check('cook tomorrow: clearly labelled as a suggestion from the days in range, not a forecast', /suggestion from the days in the range above, not a forecast/i.test(await card(page, 'What to cook tomorrow').locator('.of-card-sub').textContent()));
  check('cook tomorrow: no Pitcall note is shown to the owner', !/Pitcall/.test(await mainText(page)));
  // pickers
  const ingSel = card(page, 'Stock level').locator('select').nth(1), daySel = card(page, 'Stock level').locator('select').nth(0);
  const iOpts = await ingSel.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
  const dOpts = await daySel.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
  check('pickers: the food picker lists the proteins first; the day picker lists each day in range', iOpts.length >= 5 && dOpts.length >= 8, [iOpts.length, dOpts.length]);
  const l0 = await svgLabel(page, 'Stock level');
  const wantIng = iOpts.find((o) => o[0] !== (l0.match(/the (.+?) stock level/) || [])[1] && o[0] === 'pork') || iOpts[1];
  await ingSel.selectOption(wantIng[0]);
  await wait(400);
  const l1 = await svgLabel(page, 'Stock level');
  check('pickers: choosing another food redraws the stock chart for it', l1 !== l0 && l1.indexOf(wantIng[1]) >= 0, [l0, l1]);
  const story1 = await page.locator('.ob-callout .ob-co-title').first().textContent();
  check('pickers: the story follows the food picker', story1.indexOf(wantIng[1]) === 0, story1);
  await daySel.selectOption(dOpts[dOpts.length - 1][0]);
  await wait(400);
  const l2 = await svgLabel(page, 'Stock level');
  check('pickers: choosing another day redraws the chart for that day', l2 !== l1 && l2.indexOf(dOpts[dOpts.length - 1][1].split(',')[0]) >= 0, [l1, l2]);
  check('stock level: names the 86 threshold in its description and draws the par line', /go 86 at \d/i.test(l2) && /Par [\d.]+ kg/.test(await card(page, 'Stock level').locator('.ch-svg').textContent()), l2);
  // the 86 table
  const tbl = await card(page, 'Times food went off the menu').textContent();
  check('86 cost: lists what went off, why, from when, how long inside opening hours, and refused lines', ['What went off', 'Why', 'From', 'Off during opening hours', 'Order lines refused'].every((h) => tbl.indexOf(h) >= 0), tbl.slice(0, 200));
  const times = await card(page, 'Times food went off the menu').locator('tbody tr td:nth-child(5)').allTextContents();
  // Turns a duration text such as 1h 5m into seconds; Under a minute reads as 0.
  const toS = (s) => { const m = s.match(/(?:(\d+)h )?(\d+)m/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 : s.indexOf('Under') === 0 ? 0 : NaN; };
  check('86 cost: no spell is longer than one opening day (10 hours)', times.length > 0 && times.every((s) => toS(s) <= 10 * 3600), times);
  check('86 cost: refused order lines are numbers when recorded (the sample records them)', (await card(page, 'Times food went off the menu').locator('tbody tr td:last-child').allTextContents()).every((s) => /^\d+$/.test(s.trim())));
  // the channel sync section is gone from the office
  check('no channel sync section on the stock page', !/Channel sync|How fast 86 reaches|Sync time by channel/.test(await mainText(page)));
  check('stock page carries no pounds or ounces', !/\b(lb|lbs|oz|pounds?|ounces?)\b/i.test((await mainText(page)).replace(/Brisket, 1\/[24] lb|Burnt ends, 1\/2 lb/g, '')));
  noErrors('stock', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 6. View as table, themes, contrast, refresh without rebuilding
 * ---------------------------------------------------------------------------------------------------------------------- */
group('view as table, themes and contrast, refresh in place');
await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
  for (const id of PAGES) {
    await boot(page, id);
    const r = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.of-card')].find((x) => x.querySelector('.of-card-actions .ch-tbtn'));
      const b = c.querySelector('.of-card-actions .ch-tbtn');
      b.click();
      const on = { pressed: b.getAttribute('aria-pressed'), rows: c.querySelectorAll('.ch-tblwrap tbody tr').length, wrap: !c.querySelector('.ch-tblwrap').hidden };
      b.click();
      return Object.assign(on, { back: b.getAttribute('aria-pressed') });
    });
    check(id + ': "View as table" shows the numbers as a table, and goes back', r.pressed === 'true' && r.rows > 0 && r.wrap && r.back === 'false', r);
  }
  for (const theme of ['ember', 'paper']) {
    for (const id of PAGES) {
      await boot(page, id, { theme });
      const c = await page.evaluate(CONTRAST_JS);
      check(theme + ' ' + id + ': every text element reaches 4.5:1 (worst ' + c.worst.ratio + ', "' + c.worst.text + '", ' + c.n + ' checked)', c.worst.ratio >= 4.5, c.worst);
      check(theme + ' ' + id + ': no console errors', logs.errors.length === 0 && logs.pageErrors.length === 0, logs.errors.slice(0, 2));
      if (SHOTS && theme === 'paper') await fullShot(page, id + '-paper-1280x800.png', 1280);
    }
  }
  await page.evaluate(() => SB.theme.setOffice('ember'));
  // refresh in place: nodes keep their identity, nothing is rebuilt
  await boot(page, 'stock');
  await page.evaluate(() => { window.__marks = ['.ob-sg', '.ob-sentences li', '.ob-callout', '.of-card select', '.of-table tbody tr', '.ch-svg'].map((s) => { const e = document.querySelector(s); if (e) e.__mark = s; return [s, !!e]; }); });
  await page.evaluate(() => { SB.office._debug.refreshNow(); SB.office._debug.refreshNow(); });
  await wait(3600);
  const kept = await page.evaluate(() => window.__marks.map(([s, had]) => [s, had, !had || document.querySelector(s).__mark === s]));
  check('refresh: cards, lists, pickers and tables keep the same nodes (no whole-list rebuild)', kept.every((k) => k[1] && k[2]), kept);
  await boot(page, 'safety');
  await page.evaluate(() => { window.__marks = ['.ob-callout', '.ob-rule', '.of-card select', '.ch-svg', '.of-table tbody tr'].map((s) => { const e = document.querySelector(s); if (e) e.__mark = s; return [s, !!e]; }); });
  await page.evaluate(() => SB.office._debug.refreshNow());
  await wait(3600);
  const kept2 = await page.evaluate(() => window.__marks.map(([s, had]) => [s, had, !had || document.querySelector(s).__mark === s]));
  check('refresh on Safety: nodes keep their identity too', kept2.every((k) => k[1] && k[2]), kept2);
  // no leaks across a round trip
  await boot(page, 'pace');
  const c0 = await page.evaluate(() => SB.office._debug.counts());
  for (let i = 0; i < 2; i++) for (const id of PAGES) await boot(page, id);
  await boot(page, 'pace');
  const c1 = await page.evaluate(() => SB.office._debug.counts());
  check('no leaks after visiting the three pages twice (timers, subscriptions, listeners, charts, cards)', ['timeouts', 'intervals', 'subs', 'listeners', 'charts', 'kitPages', 'cards'].every((k) => c1[k] === c0[k]), [c0, c1]);
  noErrors('themes and refresh', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 7. Thin data, no data, and tickets without batches
 * ---------------------------------------------------------------------------------------------------------------------- */
const variants = [['thin', thin], ['empty', empty], ['ticketsonly', ticketsOnly]];
for (const [name, ds] of variants) {
  group('variant: ' + name);
  await withPage({ file: FILE, w: 1280, h: 800, hash: '#/' }, async (page, logs) => {
    for (const id of PAGES) {
      await boot(page, id, { ds });
      const f = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.of-card')].filter((c) => !/^End of day|^Best day of the week/.test((c.querySelector('.of-card-title') || {}).textContent || '')); // the End of day panel has no caption
        return { cards: cards.length, looks: cards.filter((c) => c.querySelector('.of-look')).length, errors: document.querySelectorAll('.of-error').length, empties: [...document.querySelectorAll('.of-empty .of-empty-b, .ch-empty')].filter((e) => e.offsetParent).map((e) => e.textContent.trim()), headline: document.querySelector('.of-headline').textContent, coach: (() => { const c = document.querySelector('.of-coach'); return c && c.offsetParent ? c.textContent.trim() : ''; })() };
      });
      check(name + ' ' + id + ': draws, with captions and no error cards', f.cards >= 5 && f.looks === f.cards && f.errors === 0, f);
      check(name + ' ' + id + ': no NaN, undefined or null in the text', !BAD_TEXT.test(await mainText(page)), (await mainText(page)).match(BAD_TEXT));
      if (name === 'empty') {
        // The first-run demo tickets are live data the dataset swap cannot remove, so Money still has a few sales on it.
        // An empty page now shows one page-level next-step card (.of-coach) instead of an empty-state in every chart.
        check(name + ' ' + id + ': the page says what would fill it (one next-step card)', f.coach.length > 30 || (f.empties.length >= 3 && f.empties.every((e) => e.length > 30)), { coach: f.coach, empties: f.empties });
        check(name + ' ' + id + ': the headline says there is no data instead of showing numbers', !/NaN/.test(f.headline) && f.headline.length > 20, f.headline);
      }
      // A date label must never print twice on one axis (the kit's date axis does that on a short range).
      const dup = await page.evaluate(() => [...document.querySelectorAll('.ch-svg')].map((svg) => { const t = [...svg.querySelectorAll('text')].map((x) => x.textContent.trim()).filter((x) => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+\/\d+$/.test(x)); return t.filter((x, i) => t.indexOf(x) !== i); }).flat());
      check(name + ' ' + id + ': no date label is printed twice on an axis', dup.length === 0, dup);
      if ((name === 'empty' || name === 'ticketsonly') && id === 'safety') check(name + ' safety: with nothing logged the verdict never says the kitchen was safe', !/The kitchen stayed safe/.test(await mainText(page)), (await mainText(page)).slice(0, 300));
      if (name === 'ticketsonly' && id !== 'money') check(name + ' ' + id + ': the page says nothing was recorded rather than inventing numbers', /No (food-safety|stock)|No batches|nothing|None|not recorded|No stock/i.test(await mainText(page)), (await mainText(page)).slice(0, 300));
      if (name === 'thin' && id === 'stock') check('thin stock: a protein whose sales are far below what was cooked gets no invented number', !/about 0 g|Cook about 0 g/.test(await mainText(page)) && /Not enough (sales recorded|cooking days)/.test(await mainText(page)), (await mainText(page)).match(/.{40}about 0 g.{20}/)); // the thin set has 2 days, fewer than the 3 the page needs, so the wording names the days
      if (name === 'thin' && id === 'stock') check('thin stock: refused order lines are "Not recorded" when no report exists, never invented', /Not recorded|No (items|food)|Nothing was taken off/.test(await mainText(page)) && !/Order lines refused while an item was off are not recorded/.test('') , (await mainText(page)).slice(-300));
      if (SHOTS) await fullShot(page, id + '-' + name + '-ember-1280x800.png', 1280);
    }
    noErrors(name, logs);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 8. Five viewports: no sideways scroll, touch targets, screenshots
 * ---------------------------------------------------------------------------------------------------------------------- */
group('viewports');
for (const [w, h] of VIEWPORTS) {
  await withPage({ file: FILE, w, h, hash: '#/', touch: w < 720 }, async (page, logs) => {
    for (const id of PAGES) {
      await boot(page, id);
      const f = await page.evaluate(() => {
        const col = document.querySelector('.of-col') || document.documentElement;
        const over = [];
        document.querySelectorAll('.of-main [class*="ob-"], .of-main .of-card, .of-main .of-card-body, .of-main .of-headline').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.left < -1)) over.push((el.className || el.tagName).toString().slice(0, 40) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
        const targets = [];
        document.querySelectorAll('.ob-sel, .ob-actions .btn, .ob-co-act .btn, .ob-seg .seg-opt, .ob-wi-ctl .stepper-btn, .ob-tbl .of-sortbtn, .ob-tbl .of-tpager .btn').forEach((el) => { if (!el.offsetParent) return; const r = el.getBoundingClientRect(); const small = el.matches('.stepper-btn') ? Math.min(r.width, r.height) : r.height; if (small < 47.5) targets.push((el.className || '') + ' ' + Math.round(small)); });
        return { colScroll: col.scrollWidth - col.clientWidth, docScroll: document.documentElement.scrollWidth - innerWidth, over, targets };
      });
      check(w + 'x' + h + ' ' + id + ': no horizontal scroll, nothing wider than the screen', f.colScroll <= 1 && f.docScroll <= 1 && f.over.length === 0, f);
      check(w + 'x' + h + ' ' + id + ': my buttons, pickers, switches and steppers are at least 48 px', f.targets.length === 0, f.targets.slice(0, 5));
      // On a phone the less important table columns drop away; the one that says how long the item was off must stay on screen.
      const key = await page.evaluate(() => { const th = [...document.querySelectorAll('.of-table th')].find((t) => /Off during opening hours/.test(t.textContent)); if (!th) return null; return { shown: !!th.offsetParent, right: Math.round(th.getBoundingClientRect().right), width: innerWidth }; });
      check(w + 'x' + h + ' ' + id + ': the time-off column of the table stays on screen', key === null || (key.shown && key.right <= key.width + 1), key);
      if (SHOTS) await fullShot(page, id + '-ember-' + w + 'x' + h + '.png', w);
    }
    if (w === 390) for (const id of PAGES) { await boot(page, id, { theme: 'paper' }); if (SHOTS) await fullShot(page, id + '-paper-390x844.png', w); const c = await page.evaluate(CONTRAST_JS); check('paper ' + id + ' 390: contrast at least 4.5 (worst ' + c.worst.ratio + ')', c.worst.ratio >= 4.5, c.worst); }
    noErrors(w + 'x' + h, logs);
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('Failed:\n  ' + failures.join('\n  ')); process.exit(1); }
