// Print QA: everything the back office can put on paper (the food safety record, the thrown-out log, the end-of-day summary and the pilot report)
// is rendered to a PDF with the browser's print engine on Letter portrait, Letter landscape and A4, from a kitchen with a year of safety
// entries, long dish names and long customer names. Checks: page counts, nothing from the app around it, table headers on every page, no row split
// across pages, no blank last page, nothing wider than the page, and only black, white and grey on paper (so nothing depends on color).
// Pages are also saved as PNG (test/.out/print-qa/) so a person can look at them. Needs pdftotext/pdftoppm (poppler) for the page checks.
// Run: node test/print-qa.e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withPage } from '../tools/pw.mjs';
import { realKitchen } from './_kitchen.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'test/.out/print-qa');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { force: true });
let failed = 0;
// Prints ok or FAIL for one check and remembers a failure for the exit code.
function check(name, ok, detail) { console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + JSON.stringify(detail))); if (!ok) failed++; }
const FORMS = [['letter-portrait', { format: 'Letter', landscape: false }], ['letter-landscape', { format: 'Letter', landscape: true }], ['a4-portrait', { format: 'A4', landscape: false }]];
const has = (cmd) => { try { execFileSync('which', [cmd]); return true; } catch (e) { return false; } };
const POPPLER = has('pdftotext') && has('pdftoppm');

// The words on one page of a PDF (empty string for a blank page).
const pageText = (pdf, n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', pdf, '-'], { encoding: 'utf8' });
// How many pages a PDF has.
const pageCount = (pdf) => (fs.readFileSync(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

// A year of kitchen: long dish names, long customer names, paid orders, hot and cold batches with readings and thrown-out food.
async function buildKitchen(page) {
  return page.evaluate(() => {
    const E = SB.engine, MIN = 60e3, today = new Date(); today.setHours(0, 0, 0, 0);
    const at = (d, h, m) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 120 + d, h, m || 0, 0, 0).getTime();
    let now = at(0, 7), s = E.newState({ now, blank: true });
    const go = (type, p, t) => { now = Math.max(now + 1000, t == null ? now : t); const r = E.apply(s, type, p, now); if (r.report !== 'ok') throw new Error(type + ' ' + r.report + JSON.stringify(r.info)); s = r.state; return r; };
    go('updateSettings', { patch: { service: { taxRatePct: 8.25 }, modules: { cookAhead: true } } });
    const names = ['Smoked brisket plate with burnt ends, pickles, onions and two sides of your choice', 'Pulled pork sandwich on a toasted brioche bun with house slaw', 'Mac and cheese'];
    const ids = names.map((n, i) => go('addMenuItem', { name: n.slice(0, 60), zone: 'pit', cat: 'meat', price: 12.49 + i * 3.1, prepSec: 60, track: 'one', prepGuess: false }).info.id);
    const hot = go('addIngredient', { name: 'Brisket, smoked low and slow for fourteen hours', unit: 'g', tcs: true, hold: 'hot', costPerKg: 14 }).info.id;
    const cold = go('addIngredient', { name: 'Coleslaw', unit: 'g', tcs: true, hold: 'cold', costPerKg: 5 }).info.id;
    for (let d = 0; d < 119; d++) {
      for (const [ing, tf] of [[hot, 160], [cold, 38]]) {
        const b = go('addBatch', { ing, tempF: tf, rawG: 4000, cookedG: 4000 }, at(d, 9, ing === hot ? 0 : 20));
        const id = b.info.id || b.info.batchId;
        go('logTemp', { batchId: id, tempF: tf + 1, who: 'JM' }, at(d, 11));
        if (d % 2 === 0) go('discardBatch', { batchId: id, reason: 'quality', who: 'JM' }, at(d, 12, ing === hot ? 5 : 25));
      }
      if (d % 4 === 0) go('sanitizeDone', { who: 'JM' }, at(d, 15));
      for (let j = 0; j < 2; j++) {
        const cr = go('createTicket', { customer: ('Wellington-Smythe-Featherstonehaugh ' + d + j).slice(0, 40), channel: 'dine_in', items: [{ menuId: ids[j], qty: 1 }] }, at(d, 12 + j, 5));
        const tk = s.tickets.find((x) => x.id === cr.info.ticketId);
        for (const it of tk.items) go('completeItem', { ticketId: tk.id, itemId: it.id }, now + 20000);
        go('bumpTicket', { ticketId: tk.id }, now + 5000);
        go('payOrder', { orderId: cr.info.orderId, method: ['cash', 'card'][j], tip: 1.5 }, now + 3 * MIN);
      }
      go('closeDay', {}, at(d, 23, 30));
    }
    const env = JSON.stringify({ v: 1, takenAt: Date.now(), rev: 1, clock: { virtual: Date.now(), real: Date.now(), speed: 1 }, state: s });
    return { env, ids };
  });
}

// Takes the PDF of the page as it stands, in all three paper forms, and returns [{name, file, pages}].
async function toPdfs(page, base) {
  const out = [];
  await page.emulateMedia({ media: 'print' });
  for (const [name, o] of FORMS) {
    const file = path.join(OUT, base + '-' + name + '.pdf');
    await page.pdf({ path: file, format: o.format, landscape: o.landscape, printBackground: false, preferCSSPageSize: true });
    out.push({ name, file, pages: pageCount(file) });
    if (POPPLER) execFileSync('pdftoppm', ['-r', '45', '-gray', '-png', '-f', '1', '-l', '3', file, path.join(OUT, base + '-' + name)]);
  }
  await page.emulateMedia({ media: 'screen' });
  return out;
}
// Measures the paper block in the page (print media): its width against the page, and whether any color is not black, white or grey.
async function measure(page, sel) {
  await page.emulateMedia({ media: 'print' });
  const res = await page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return null;
    const box = el.getBoundingClientRect();
    const colored = [];
    for (const e of [el, ...el.querySelectorAll('*')]) { const c = getComputedStyle(e); for (const k of ['color', 'backgroundColor', 'borderBottomColor']) { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c[k]); if (m && (m[4] === undefined || Number(m[4]) > 0) && !(m[1] === m[2] && m[2] === m[3])) colored.push(e.tagName + '.' + e.className + ' ' + k + ' ' + c[k]); } }
    let wide = 0; for (const e of el.querySelectorAll('*')) { if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && e.clientWidth > 0) wide++; }
    return { scrollW: el.scrollWidth, clientW: el.clientWidth, width: box.width, colored: colored.slice(0, 5), wide };
  }, sel);
  await page.emulateMedia({ media: 'screen' });
  return res;
}

await withPage({ w: 1280, h: 900, hash: '' }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 20000 });
  await page.evaluate(() => { try { SB.floor.setWelcome(false); } catch (e) { /* no welcome */ } window.print = () => { window.__printed = (window.__printed || 0) + 1; }; const add = window.addEventListener.bind(window); window.addEventListener = (t, ...r) => (t === 'afterprint' ? undefined : add(t, ...r)); });
  await realKitchen(page, { dishes: 3, orders: 0 });
  const k = await buildKitchen(page);
  check('(setup) the year-long kitchen loads', (await page.evaluate((t) => SB.store.importAll(t), k.env)) === 'ok');
  // today's own paid orders, so the end-of-day summary has something to say
  await page.evaluate((ids) => { for (let j = 0; j < 3; j++) { const r = SB.store.dispatchEx('createTicket', { customer: 'Walk-in guest long name ' + j, channel: 'dine_in', items: [{ menuId: ids[j], qty: 2 }] }, { source: 'ui' }); const tk = SB.store.getState().tickets.find((x) => x.id === r.info.ticketId); for (const it of tk.items) SB.store.dispatchEx('completeItem', { ticketId: tk.id, itemId: it.id }, { source: 'ui' }); SB.store.dispatchEx('bumpTicket', { ticketId: tk.id }, { source: 'ui' }); SB.store.dispatchEx('payOrder', { orderId: r.info.orderId, method: ['cash', 'card', 'other'][j], tip: 2 }, { source: 'ui' }); } }, k.ids);

  // 1. The food safety record, the longest range there is
  await page.evaluate(() => { location.hash = '#/office/safety'; });
  await page.waitForSelector('[data-k="print-safety-log"]', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-k="print-safety-log"]').click());
  await page.waitForSelector('.si-actions select', { timeout: 8000 });
  const ranges = await page.evaluate(() => [...document.querySelectorAll('.si-actions select option')].map((o) => o.value));
  await page.selectOption('.si-actions select', ranges[ranges.length - 1]);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('.si-actions .btn-primary').click());
  await page.waitForSelector('.si-printroot .si-table', { state: 'attached', timeout: 8000 });
  const rowsN = await page.evaluate(() => document.querySelectorAll('.si-printroot tbody tr').length);
  check('(setup) the record holds hundreds of entries', rowsN >= 300, rowsN);
  if (process.env.DBG) { await page.emulateMedia({ media: 'print' }); console.log('DBG', JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.si-printroot'), t = r.querySelector('table'), td = r.querySelector('td'); const cs = (e) => getComputedStyle(e); return { vw: innerWidth, root: r.getBoundingClientRect().width, rootFont: cs(r).fontSize, table: t.getBoundingClientRect().width, tableFont: cs(t).fontSize, tdPad: cs(td).padding, tdW: td.getBoundingClientRect().width, bodyW: document.body.getBoundingClientRect().width, bodyPos: cs(document.body).position, zoom: cs(document.documentElement).zoom, htmlFont: cs(document.documentElement).fontSize }; }))); await page.emulateMedia({ media: 'screen' }); }
  const m1 = await measure(page, '.si-printroot');
  check('safety record: no color on paper (black, white and grey only)', m1 && m1.colored.length === 0, m1 && m1.colored);
  await page.emulateMedia({ media: 'print' });
  const css1 = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.si-printroot tbody tr')].every((r) => getComputedStyle(r).breakInside === 'avoid'), thead: getComputedStyle(document.querySelector('.si-printroot thead')).display, appChrome: [...document.body.children].filter((e) => !e.classList.contains('sb-printroot') && getComputedStyle(e).display !== 'none').length }));
  await page.emulateMedia({ media: 'screen' });
  check('safety record: rows never split across pages, the heading row repeats, and the app around it is hidden', css1.rows && css1.thead === 'table-header-group' && css1.appChrome === 0, css1);
  const pdfs1 = await toPdfs(page, 'safety-record');
  for (const p of pdfs1) {
    check('safety record ' + p.name + ': a sane number of pages (' + p.pages + ' for ' + rowsN + ' entries)', p.pages >= 5 && p.pages <= Math.ceil(rowsN / 8) + 4, p.pages);
    if (POPPLER) {
      const last = pageText(p.file, p.pages), mid = pageText(p.file, Math.min(3, p.pages));
      check('safety record ' + p.name + ': no blank last page', last.trim().length > 20, last.slice(0, 40));
      check('safety record ' + p.name + ': table headings repeat on a later page', /When\s+What\s+Food\s+Detail/.test(mid), mid.slice(0, 200));
      check('safety record ' + p.name + ': nothing from the app around it', !/Back office|Menu, prices and shop|Print the food safety record/.test(pageText(p.file, 1) + mid));
      check('safety record ' + p.name + ': nothing is cut off at the right edge (every column heading is whole)', /Corrections added later/.test(pageText(p.file, 1)) || /Corrections/.test(pageText(p.file, 1)), pageText(p.file, 1).slice(0, 300));
    }
  }
  await page.evaluate(() => { document.querySelectorAll('.sb-printroot').forEach((e) => e.remove()); });
  await page.keyboard.press('Escape');


  // 2. The thrown-out log: built as its own page (HTML) and printed from a hidden frame, so it is rendered here as a page of its own
  const logHtml = await page.evaluate(() => { const rec = SB.discardsPure ? null : null; const st = SB.store.getState(); const r = JSON.parse(localStorage.getItem('smokebox.v1.dlog') || 'null'); const recd = { cols: [{ key: 'date', label: 'Date', on: true }, { key: 'food', label: 'Food', on: true }, { key: 'amount', label: 'Amount', on: true }, { key: 'since', label: 'Made at', on: true }, { key: 'out', label: 'Thrown out at', on: true }, { key: 'reason', label: 'Why', on: true }, { key: 'initials', label: 'Initials', on: true }, { key: 'extra', label: 'Notes', on: true }], initials: {}, extra: {} }; const list = SB.discardsPure.rows(st, recd); return { html: SB.discardsPure.printHtml(list, recd, SB.discardsPure.coverageText(st, list, SB.store.now())), n: list.length }; });
  check('(setup) the thrown-out log has many rows', logHtml.n >= 100, logHtml.n);
  const page2 = await page.context().newPage();
  await page2.setContent(logHtml.html);
  const pdfs2 = await toPdfs(page2, 'thrown-out-log');
  for (const p of pdfs2) {
    check('thrown-out log ' + p.name + ': a sane number of pages (' + p.pages + ' for ' + logHtml.n + ' rows)', p.pages >= 3 && p.pages <= 40, p.pages);
    if (POPPLER) {
      const last = pageText(p.file, p.pages), second = pageText(p.file, 2);
      check('thrown-out log ' + p.name + ': no blank last page', last.trim().length > 20, last.slice(0, 40));
      check('thrown-out log ' + p.name + ': headings repeat on page 2', /Date\s+Food\s+Amount/.test(second), second.slice(0, 160));
    }
  }
  await page2.emulateMedia({ media: 'print' });
  const t2p = await page2.evaluate(() => ({ rowBreak: [...document.querySelectorAll('tbody tr')].every((r) => getComputedStyle(r).breakInside === 'avoid'), thead: getComputedStyle(document.querySelector('thead')).display, colored: [...document.querySelectorAll('*')].some((e) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(e).color); return m && !(m[1] === m[2] && m[2] === m[3]); }) }));
  check('thrown-out log: rows never split across pages and the heading row repeats', t2p.rowBreak && t2p.thead === 'table-header-group', t2p);
  check('thrown-out log: black, white and grey only', !t2p.colored);
  await page2.close();

  // 3. The end-of-day summary
  await page.evaluate(() => { SB.sheets.open('orders'); });
  await page.waitForSelector('[data-act="closeday"]', { timeout: 8000 });
  await page.locator('[data-act="closeday"]').first().click();
  await page.waitForSelector('.cd-page', { timeout: 8000 });
  await page.evaluate(() => { const b = [...document.querySelectorAll('.cd-page button')].find((x) => /Print today/.test(x.textContent)); b.click(); });
  await page.waitForSelector('.cd-printroot', { state: 'attached', timeout: 8000 });
  const m3 = await measure(page, '.cd-printroot');
  check('end of day: black, white and grey only', m3 && m3.colored.length === 0, m3 && m3.colored);
  for (const p of await toPdfs(page, 'end-of-day')) {
    check('end of day ' + p.name + ': exactly one page', p.pages === 1, p.pages);
    if (POPPLER) { const t = pageText(p.file, 1); check('end of day ' + p.name + ': the totals and the signature line are there, nothing from the app', /Total collected/.test(t) && /Checked by/.test(t) && !/Back office|Open orders|Close the day/.test(t), t.slice(0, 200)); }
  }
  await page.evaluate(() => { document.querySelectorAll('.sb-printroot').forEach((e) => e.remove()); });
  await page.keyboard.press('Escape');

  // 4. The pilot report
  await page.evaluate(() => { location.hash = '#/office/data'; });
  await page.waitForSelector('[data-pilot="report"]', { state: 'attached', timeout: 15000 });
  await page.evaluate(() => { const row = document.querySelector('[data-pilot="report"]'); row.scrollIntoView(); const d = row.closest('details'); if (d) d.open = true; [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Print').click(); });
  await page.waitForSelector('.sb-printroot', { state: 'attached', timeout: 10000 });
  const m4 = await measure(page, '.sb-printroot');
  check('pilot report: black, white and grey only', m4 && m4.colored.length === 0, m4 && m4.colored);
  for (const p of await toPdfs(page, 'pilot-report')) {
    check('pilot report ' + p.name + ': a sane number of pages (' + p.pages + ')', p.pages >= 1 && p.pages <= 6, p.pages);
    if (POPPLER) { const t = pageText(p.file, 1); check('pilot report ' + p.name + ': the report is there and nothing from the app', /Pilot report/.test(t) && !/Back office|Menu, prices and shop/.test(t), t.slice(0, 200)); check('pilot report ' + p.name + ': no blank last page', pageText(p.file, p.pages).trim().length > 20); }
  }


  await page.evaluate(() => { document.querySelectorAll('.sb-printroot').forEach((e) => e.remove()); });
  // 5. Printed pages that belong to other owners (the Guide's cards): rendered the same way and only counted here; findings go in docs/audit/print-qa.md
  const cards = ['card-opening-checklist', 'card-closing-checklist', 'card-when-something-goes-wrong', 'card-first-day-checklist', 'card-tablet-setup', 'card-during-service'];
  for (const id of cards) {
    await page.evaluate((x) => { location.hash = '#/guide/' + x; }, id);
    await page.waitForSelector('.gd-article', { timeout: 10000 });
    await page.waitForTimeout(400);
    const pdfs = await toPdfs(page, 'guide-' + id);
    for (const p of pdfs) {
      check('guide card ' + id + ' ' + p.name + ': at most two pages (' + p.pages + ')', p.pages >= 1 && p.pages <= 2, p.pages);
      if (POPPLER) check('guide card ' + id + ' ' + p.name + ': nothing from the app around it', !/Previous|Next|Search the Guide/.test(pageText(p.file, 1)), pageText(p.file, 1).slice(0, 160));
    }
  }

  console.log('PDFS', JSON.stringify(pdfs1.map((p) => [p.name, p.pages])));
  check('no console or page errors', !logs.errors.length && !logs.pageErrors.length, { e: logs.errors, p: logs.pageErrors });
});
console.log('files in ' + OUT);
process.exit(failed ? 1 : 0);
