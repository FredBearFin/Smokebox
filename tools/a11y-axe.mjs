// WHAT THIS FILE IS: A real accessibility audit. Opens every screen of the app in a headless browser, injects axe-core and runs it with the
//   WCAG 2.0 A and AA, 2.1 AA and 2.2 AA rules (2.2 AA adds the 24 px target size rule), then writes docs/audit/axe-report.md and a JSON file.
// USAGE: node tools/a11y-axe.mjs            every kitchen (seeded, demo, blank), screen, Day / Night / Large text, at 390 and 1280 wide (about 40 minutes)
//        QUICK=1 node tools/a11y-axe.mjs    one look and one size
//        ONLY=Settings node tools/a11y-axe.mjs   only screens whose name contains the text
//        KITCHEN=demo OUT=/tmp/a.json NOREPORT=1 node tools/a11y-axe.mjs   one kitchen, JSON only; then REPORT=1 AFTER=a.json,b.json,c.json BEFORE=docs/audit/axe-before.json node tools/a11y-axe.mjs writes the report
// NOTHING IS TURNED OFF: no rule is disabled or excluded. A violation that is a false positive is listed in the FALSE_POSITIVES table below with its reason, still counted in the JSON.
// USES: Playwright and axe-core (found by tools/_deps.mjs; npm install axe-core@4 in /opt/npm-tools or the repo), dist/smokebox.html. PARTS: seed, screens, runner, report.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage } from './pw.mjs';
import { toolRequire } from './_deps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const axeSource = fs.readFileSync(toolRequire.resolve ? toolRequire.resolve('axe-core/axe.min.js') : path.join('/opt/npm-tools/node_modules/axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
// Known false positives: rule id, a piece of the selector, the reason. They stay in the counts; the report prints them under their own heading.
const FALSE_POSITIVES = [];

const SIZES = process.env.QUICK ? [[390, 844]] : [[390, 844], [1280, 800]];
const LOOKS = process.env.QUICK ? [['light', 'normal']] : [['light', 'normal'], ['dark', 'normal'], ['light', 'large']];
const ONLY = process.env.ONLY || '';
// Which kitchen to open: seeded (a small working kitchen made here), demo (the ?demo sample kitchen) or blank (a first run with nothing set up).
const KITCHENS = (process.env.KITCHEN || 'seeded,demo,blank').split(',');

// Puts a working kitchen in the page: dishes at three stations, cook-ahead on, a cold item with a batch in the cabinet, three open tickets.
async function seed(page) {
  await page.evaluate(() => {
    const d = (t, p) => SB.store.dispatchEx(t, p, { source: 'ui' });
    d('updateSettings', { patch: { modules: { cookAhead: true } } });
    d('addMenuItem', { name: 'Pulled pork plate', zone: 'pit', cat: 'meat', price: 12, prepSec: 120, track: 'two' });
    d('addMenuItem', { name: 'Fries', zone: 'fry', cat: 'fried', price: 4, prepSec: 180, track: 'two' });
    d('addMenuItem', { name: 'Coleslaw', zone: 'cold', cat: 'cold', price: 3, prepSec: 30, track: 'one' });
    const ing = d('addIngredient', { name: 'Coleslaw', unit: 'g', tcs: true, hold: 'cold', maxHoldH: 4, holdBasis: 'safety' });
    if (ing && ing.info && ing.info.id) d('addBatch', { ing: ing.info.id, tempF: 38, cookedG: 3000, src: 'cook' });
    const m = SB.store.getState().menu.filter((x) => !x.archived);
    ['Maria', 'Tom', 'Ana'].forEach((c, i) => d('createTicket', { customer: c, items: [{ menuId: m[i % m.length].id, qty: 1 + i }] }));
  });
  await page.waitForTimeout(400);
}

// Resets the page between screens: sheets closed, back on the board, any open menu closed.
async function home(page) {
  await page.evaluate(() => { try { SB.sheets.closeAll(); SB.floor.setWall(false); SB.floor.setFarDisplay(false); SB.floor.setSound(false); if (SB.floor.showCabinet) SB.floor.showCabinet(false); } catch (e) { /* none open */ } if (location.hash && location.hash !== '#/') location.hash = '#/'; const all = [...document.querySelectorAll('button')].find((b) => /^All\b/.test(b.textContent.trim()) && b.getClientRects().length); if (all) all.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  await page.waitForTimeout(350);
}
const sheet = (name, opts) => async (page) => { await page.evaluate(([n, o]) => SB.sheets.open(n, o), [name, opts || {}]); await page.waitForTimeout(500); };
const hash = (h) => async (page) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(700); };
const click = (sel) => async (page) => { await page.locator(sel).first().click(); await page.waitForTimeout(500); };

// Stands in for the store's Close the month calls so the screens show realistic counts and files (the real ones need 60 days of history).
const monthStubs = () => {
  SB.store.closeMonthPreview = () => ({ ok: true, report: 'ok', preview: { tickets: 412, orders: 398, events: 3120, days: Array.from({ length: 28 }, (_, i) => '2026-08-' + String(i + 1).padStart(2, '0')), from: '2026-08-01', before: '2026-08-29', safetyEventsKept: 640, openTicketsKept: 2, openOrdersKept: 1, uncoveredDays: [] } });
  SB.store.closeMonthExport = () => ({ ok: true, report: 'ok', files: [['smokebox-before-month-close-20260929.json', 'backup', 820000], ['smokebox-orders-2026-08-01-to-2026-08-28.csv', 'orders', 31000], ['smokebox-tickets-2026-08-01-to-2026-08-28.csv', 'tickets', 52000], ['smokebox-days-2026-08-01-to-2026-08-28.csv', 'days', 4000], ['smokebox-month-manifest-2026-08-01-to-2026-08-28.json', 'manifest', 1200]].map(([name, kind, chars]) => ({ name, kind, mime: 'text/plain', text: 'a', chars, sha256: 'a'.repeat(64) })) });
  SB.store.closeMonthPrune = () => ({ ok: true, report: 'ok', info: { before: '2026-08-29', from: '2026-08-01', days: 28, tickets: 412, orders: 398, events: 3120, safetyEventsKept: 640, copyKept: true, copyKeepDays: 7 } });
};
const month = (upTo) => async (p) => {
  await p.evaluate(monthStubs); await p.evaluate(() => SB.sheets.open('closemonth')); await p.waitForTimeout(500);
  if (upTo < 1) return;
  await p.click('[data-act=cm-next1]'); await p.click('[data-act=cm-save-files]'); await p.waitForTimeout(300);
  if (upTo < 2) return;
  await p.check('#cm-saw'); await p.click('[data-act=cm-next2]'); await p.fill('input[aria-label="Type CLOSE to confirm"]', 'CLOSE'); await p.waitForTimeout(600);
  if (upTo < 3) return;
  await p.click('[data-act=cm-go]'); await p.waitForTimeout(300);
};
// Every screen to check: [name, async prep(page)]. The page is on the board with the seeded kitchen when prep starts.
function screens(kitchen) {
  const guide = fs.readdirSync(path.join(ROOT, 'docs/sop')).filter((f) => /^\d\d-.+\.md$/.test(f)).map((f) => f.replace(/^\d\d-/, '').replace(/\.md$/, ''));
  const list = [
    ['Board (all stations)', async () => {}],
    ['Board: Cabinet tab', async (p) => { const b = p.locator('button', { hasText: 'Cabinet' }).first(); if (!(await b.count()) || !(await b.isVisible()) || !(await b.isEnabled())) throw new Error('n/a: this kitchen has no usable Cabinet tab'); await b.click(); await p.waitForTimeout(500); }],
    ['Board: wall mode', async (p) => { await p.evaluate(() => SB.floor.setWall(true)); await p.waitForTimeout(500); }],
    ['Board: far display', async (p) => { await p.evaluate(() => SB.floor.setFarDisplay(true)); await p.waitForTimeout(500); }],
    ['Board: sound bar and notices', async (p) => { await p.evaluate(() => { SB.floor.setSound(true); }); await p.waitForTimeout(600); }],
    ['New ticket', hash('#/new')],
    ['Orders sheet', sheet('orders')],
    ['Recall sheet', sheet('recall')],
    ['Hold cabinet sheet', sheet('hold')],
    ['86 board', sheet('board86')],
    ['Payment box (Take payment)', async (p) => { await sheet('orders')(p); const pay = p.locator('[data-act=pay]').first(); if (await pay.count()) { await pay.click().catch(() => {}); await p.waitForTimeout(400); } }],
    ['Board: late tickets and warnings', async (p) => { await p.evaluate(() => { try { SB.store.setSpeed(400); } catch (e) { /* real kitchens refuse a fast clock */ } }); await p.waitForTimeout(2500); await p.evaluate(() => { try { SB.store.setSpeed(1); } catch (e) { /* none */ } }); await p.waitForTimeout(500); }],
    ['Readings', sheet('readings')],
    ['Thrown-out log', sheet('discards')],
    ['Settings sheet', sheet('menu')],
    ['Help and about', sheet('help')],
    ['Demo and clock', sheet('demo')],
    ['Dishes and prices', sheet('dishes')],
    ['Import preview', async (p) => { await sheet('menuimport')(p); await p.locator('textarea').first().fill('Lemonade 3\nChili 6.50\nBad row'); await p.locator('.sheet button', { hasText: 'Preview' }).first().click().catch(() => {}); await p.waitForTimeout(500); }],
    ['Cooked-ahead form', sheet('cookahead')],
    ['Tax, hours and PIN', sheet('shop')],
    ['How you serve', sheet('serve')],
    ['Set up this device', sheet('setup')],
    ['Device checks', sheet('ready')],
    ['Pilot visit checklist', sheet('pilot')],
    ['Close the month: step 1', month(0)],
    ['Close the month: step 2', month(1)],
    ['Close the month: step 3', month(2)],
    ['Close the month: done', month(3)],
    ['Start over: step 1', sheet('startover')],
    ['Start over: step 2', async (p) => { await sheet('startover')(p); await p.click('[data-act=so-next1]'); await p.waitForTimeout(300); }],
    ['Start over: step 3', async (p) => { await sheet('startover')(p); await p.click('[data-act=so-next1]'); await p.click('[data-act=so-save-backup]').catch(() => {}); await p.check('#so-saw').catch(() => {}); await p.click('[data-act=so-next2]').catch(() => {}); await p.waitForTimeout(300); }],
  ];
  ['pace', 'tickets', 'stations', 'money', 'safety', 'stock', 'data'].forEach((s) => list.push(['Office: ' + s, hash('#/office/' + s)]));
  list.push(['Pilot report (office Data, opened)', async (p) => { await hash('#/office/data')(p); const b = p.locator('summary, button', { hasText: /Pilot report/ }).first(); if (await b.count()) await b.click().catch(() => {}); await p.waitForTimeout(400); }]);
  list.push(['Guide: contents', hash('#/guide')]);
  if (kitchen === 'seeded') guide.forEach((id) => list.push(['Guide: ' + id, hash('#/guide/' + id)]));
  if (kitchen === 'seeded') list.push(['Print view: Guide page', async (p) => { await hash('#/guide/getting-started')(p); await p.emulateMedia({ media: 'print' }); }]);
  list.push(['Print view: Thrown-out log', async (p) => { await sheet('discards')(p); await p.emulateMedia({ media: 'print' }); }]);
  // The PIN screens come last: setting a PIN would put the keypad in front of the office pages above.
  list.push(['PIN keypad', async (p) => { await p.evaluate(async () => { await SB.shell.setPin('1234'); SB.shell.promptPin(); }); await p.waitForTimeout(500); }]);
  list.push(['Recovery code sheet', async (p) => { await p.evaluate(async () => { SB.setup.showRecoveryCode({ verified: true }); }); await p.waitForTimeout(600); }]);
  return list.filter(([n]) => !ONLY || n.toLowerCase().includes(ONLY.toLowerCase()));
}

// Runs axe on the page as it is now; returns the violations in a plain shape.
async function runAxe(page) {
  const res = await page.evaluate(async (tags) => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => /^wcag\d/.test(t)).slice(0, 2), nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), why: (n.failureSummary || '').split('\n').slice(1, 3).join(' ').slice(0, 220) })), count: v.nodes.length }));
  }, TAGS);
  return res;
}

// Runs every kitchen, size and look; returns one record per screen run.
async function runAll() {
  const all = [];
  for (const kitchen of KITCHENS) for (const [w, h] of SIZES) for (const [theme, text] of LOOKS) {
    const tag = w + ' ' + theme + ' ' + text;
    await withPage({ w, h, file: process.env.DIST || undefined, touch: true, query: kitchen === 'demo' ? '?demo' : '' }, async (page) => {
      await page.waitForFunction(() => window.SB && SB.booted === true);
      await page.addScriptTag({ content: axeSource });
      await page.evaluate(([t, x]) => { SB.theme.set(t); SB.theme.setTextSize(x); }, [theme, text]);
      if (kitchen === 'seeded') await seed(page);
      for (const [name, prep] of screens(kitchen)) {
        const label = kitchen + ': ' + name;
        try {
          await home(page); await page.emulateMedia({ media: 'screen' });
          await prep(page);
          const v = await runAxe(page);
          // What was on screen, so the report can show each screen really opened: the top sheet's heading or the page hash.
          const shown = await page.evaluate(() => { const s = [...document.querySelectorAll('.sheet')].pop(); return (s ? 'sheet: ' + (s.querySelector('h1,h2,.sheet-title') || s).textContent.trim().slice(0, 40) : 'page ' + location.hash); });
          all.push({ screen: label, look: tag, shown, violations: v });
        } catch (e) { const msg = String(e.message || e).split('\n')[0].slice(0, 160); all.push({ screen: label, look: tag, ...(msg.startsWith('n/a:') ? { skipped: msg } : { error: msg }), violations: [] }); }
      }
    });
    console.log('done', kitchen, tag, all.length);
  }
  return all;
}

const IMPACTS = ['critical', 'serious', 'moderate', 'minor'];
// Counts a result set: nodes by impact (every failing element), hits by impact (one per rule per screen run) and the rules seen.
function tally(all) {
  const nodes = {}, hits = {}; const rules = {};
  for (const r of all) for (const v of r.violations) {
    nodes[v.impact] = (nodes[v.impact] || 0) + v.count; hits[v.impact] = (hits[v.impact] || 0) + 1;
    const k = rules[v.id] || (rules[v.id] = { id: v.id, impact: v.impact, help: v.help, tags: v.tags, nodes: 0, screens: new Map() });
    k.nodes += v.count;
    const s = k.screens.get(r.screen) || { looks: new Set(), ex: v.nodes[0] }; s.looks.add(r.look); k.screens.set(r.screen, s);
  }
  return { nodes, hits, rules };
}
const load = (list) => (list ? list.split(',').filter(Boolean).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) : null);

// Writes the markdown report from the after results and, when given, the before results.
function report(all, before) {
  const t = tally(all), b = before ? tally(before) : null;
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const rules = Object.values(t.rules).sort((x, y) => (order[x.impact] - order[y.impact]) || y.nodes - x.nodes);
  const errs = all.filter((r) => r.error); const skips = [...new Set(all.filter((r) => r.skipped).map((r) => r.screen + ' (' + r.skipped.slice(5) + ')'))];
  const kitchens = [...new Set(all.map((r) => r.screen.split(':')[0]))];
  let md = '# Accessibility audit with axe-core\n\nGenerated by `node tools/a11y-axe.mjs` (axe-core, tags ' + TAGS.join(', ') + '). Headless Chromium, not a screen reader, not a real tablet or phone. ' + all.length + ' screen runs: ' + new Set(all.map((r) => r.screen)).size + ' screens (kitchens: ' + kitchens.join(', ') + ') x ' + new Set(all.map((r) => r.look)).size + ' looks (width, Day or Night, normal or Large text).\n\n';
  md += '## Counts before and after\n\nNodes are failing elements; hits are one rule failing on one screen in one look.\n\n| Impact | Nodes before | Nodes after | Hits before | Hits after |\n|---|---|---|---|---|\n';
  for (const i of IMPACTS) md += '| ' + i + ' | ' + (b ? (b.nodes[i] || 0) : 'n/a') + ' | ' + (t.nodes[i] || 0) + ' | ' + (b ? (b.hits[i] || 0) : 'n/a') + ' | ' + (t.hits[i] || 0) + ' |\n';
  if (b) md += '| rules failing | ' + Object.keys(b.rules).length + ' | ' + rules.length + ' | | |\n';
  if (errs.length) md += '\n**Screens that could not be opened (' + errs.length + ' runs):** ' + [...new Set(errs.map((e) => e.screen + ' (' + e.error + ')'))].join('; ') + '\n';
  if (skips.length) md += '\nNot shown in that kitchen, so not run: ' + skips.join('; ') + '.\n';
  md += '\n## By rule (after)\n\n' + (rules.length ? '| Rule | Impact | WCAG | Nodes | Screens | Before nodes | What it means |\n|---|---|---|---|---|---|---|\n' : 'No violations.\n');
  for (const r of rules) md += '| `' + r.id + '` | ' + r.impact + ' | ' + r.tags.join(' ') + ' | ' + r.nodes + ' | ' + r.screens.size + ' | ' + (b ? (b.rules[r.id] ? b.rules[r.id].nodes : 0) : 'n/a') + ' | ' + r.help + ' |\n';
  if (b) {
    md += '\n## Rules that failed before and pass now\n\n';
    const fixed = Object.values(b.rules).filter((r) => !t.rules[r.id]);
    md += fixed.length ? fixed.map((r) => '- `' + r.id + '` (' + r.impact + ', ' + r.nodes + ' nodes): ' + r.help).join('\n') + '\n' : 'None.\n';
  }
  md += '\n## By rule and screen (first failing element)\n';
  for (const r of rules) {
    md += '\n### `' + r.id + '` (' + r.impact + ')\n\n';
    for (const [s, info] of r.screens) md += '- **' + s + '** (' + [...info.looks].join('; ') + '): `' + (info.ex ? info.ex.target : '') + '`' + (info.ex && info.ex.why ? ' - ' + info.ex.why.replace(/\s+/g, ' ') : '') + '\n';
  }
  md += '\n## False positives\n\n' + (FALSE_POSITIVES.length ? FALSE_POSITIVES.map((f) => '- `' + f[0] + '` on `' + f[1] + '`: ' + f[2]).join('\n') : 'None recorded. No rule is turned off or excluded.') + '\n';
  md += '\n## For others\n\nSelectors in files owned by other teams. Nothing was sent to them; this list is the hand-off.\n\n' + (fs.existsSync(FOR_OTHERS) ? fs.readFileSync(FOR_OTHERS, 'utf8') : '_(none yet)_\n');
  md += '\n## Not checked\n\n- Screen readers (VoiceOver, TalkBack, NVDA), real tablets and phones, real touch use and real lighting: only headless Chromium with axe-core was used.\n- axe cannot judge reading order, whether a label makes sense, color-only meaning on charts, or sound and speech output. A person must check those.\n- States that need a real event (a printer, a hub on the network, a real 4-hour hold running out) were reached only as far as the sample data allows.\n';
  return md;
}

const FOR_OTHERS = path.join(ROOT, 'docs/audit/axe-for-others.md');
const out = process.env.OUT || path.join(ROOT, 'docs/audit/axe-after.json');
let all;
if (process.env.REPORT) all = load(process.env.AFTER);
else { all = await runAll(); fs.writeFileSync(out, JSON.stringify(all)); }
const before = load(process.env.BEFORE || (fs.existsSync(path.join(ROOT, 'docs/audit/axe-before.json')) ? path.join(ROOT, 'docs/audit/axe-before.json') : ''));
const t = tally(all);
if (!process.env.NOREPORT) fs.writeFileSync(path.join(ROOT, 'docs/audit/axe-report.md'), report(all, before));
console.log('nodes', JSON.stringify(t.nodes), 'hits', JSON.stringify(t.hits), 'rules', Object.keys(t.rules).length, 'errors', all.filter((r) => r.error).length);
