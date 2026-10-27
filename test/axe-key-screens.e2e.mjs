// Quick accessibility check with axe-core on seven key screens (browser, about 40 s). Run: node test/axe-key-screens.e2e.mjs
// Opens the board, New ticket, the Settings sheet, Dishes and prices, the Device checks, Close the month (stand-in counts) and a first-run (blank) board, in Day
// at phone width and in Night with Large text at desktop width. Fails on any serious or critical axe violation (WCAG 2.0 A/AA,
// 2.1 AA, 2.2 AA tags). No rule is turned off. The full audit is tools/a11y-axe.mjs. Needs dist/smokebox.html and axe-core.
import { withPage } from '../tools/pw.mjs';
import { toolRequire } from '../tools/_deps.mjs';

const axeSource = toolRequire('axe-core').source;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
let fail = 0;
// Records one check and prints it.
function check(name, ok, detail) { if (!ok) fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + JSON.stringify(detail))); }
const sheet = (name) => async (page) => { await page.evaluate((n) => SB.sheets.open(n, {}), name); await page.waitForTimeout(500); };
const SCREENS = [
  ['board with tickets', true, async () => {}],
  ['New ticket', true, async (page) => { await page.evaluate(() => { location.hash = '#/new'; }); await page.waitForTimeout(700); }],
  ['Settings sheet', true, sheet('menu')],
  ['Dishes and prices', true, sheet('dishes')],
  ['Device checks', true, sheet('ready')],
  ['Close the month (save the files step)', true, async (page) => {
    await page.evaluate(() => {
      SB.store.closeMonthPreview = () => ({ ok: true, report: 'ok', preview: { tickets: 412, orders: 398, events: 3120, days: ['2026-08-01'], from: '2026-08-01', before: '2026-08-29', safetyEventsKept: 640, openTicketsKept: 2, openOrdersKept: 1, uncoveredDays: [] } });
      SB.store.closeMonthExport = () => ({ ok: true, report: 'ok', files: [['smokebox-before-month-close-20260929.json', 'backup', 820000], ['smokebox-orders-2026-08-01-to-2026-08-28.csv', 'orders', 31000]].map(([name, kind, chars]) => ({ name, kind, mime: 'text/plain', text: 'a', chars, sha256: 'a'.repeat(64) })) });
      SB.sheets.open('closemonth');
    });
    await page.waitForTimeout(500); await page.click('[data-act=cm-next1]'); await page.click('[data-act=cm-save-files]'); await page.waitForTimeout(300);
  }],
  ['first-run board (blank kitchen)', false, async () => {}],
];

// Puts three dishes and three open tickets in the page so the board has something to show.
async function seed(page) {
  await page.evaluate(() => {
    const d = (t, p) => SB.store.dispatchEx(t, p, { source: 'ui' });
    d('addMenuItem', { name: 'Pulled pork plate', zone: 'pit', cat: 'meat', price: 12, prepSec: 120, track: 'two' });
    d('addMenuItem', { name: 'Fries', zone: 'fry', cat: 'fried', price: 4, prepSec: 180, track: 'two' });
    d('addMenuItem', { name: 'Coleslaw', zone: 'cold', cat: 'cold', price: 3, prepSec: 30, track: 'one' });
    const m = SB.store.getState().menu.filter((x) => !x.archived);
    ['Maria', 'Tom', 'Ana'].forEach((c, i) => d('createTicket', { customer: c, items: [{ menuId: m[i % m.length].id, qty: 1 + i }] }));
  });
  await page.waitForTimeout(400);
}

for (const [w, h, theme, text] of [[390, 844, 'light', 'normal'], [1280, 800, 'dark', 'large']]) {
  await withPage({ w, h, touch: true }, async (page) => {
    await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 8000 });
    await page.addScriptTag({ content: axeSource });
    await page.evaluate(([t, x]) => { SB.theme.set(t); SB.theme.setTextSize(x); }, [theme, text]);
    let seeded = false;
    // The blank screen has to be checked before the page gets dishes, so it goes first.
    const order = [...SCREENS].sort((a, b) => (a[1] === b[1] ? 0 : a[1] ? 1 : -1));
    for (const [name, needsKitchen, prep] of order) {
      if (needsKitchen && !seeded) { await seed(page); seeded = true; }
      await page.evaluate(() => { try { SB.sheets.closeAll(); } catch (e) { /* none open */ } location.hash = '#/'; });
      await page.waitForTimeout(300);
      await prep(page);
      const bad = await page.evaluate(async (tags) => {
        const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
        return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ rule: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      }, TAGS);
      check(name + ' at ' + w + ' ' + theme + ' ' + text + ': no serious or critical violations', bad.length === 0, bad);
    }
  });
}
console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok');
process.exit(fail ? 1 : 0);
