// Keyboard-only walk of the back office (axe cannot judge this): with only Tab, Shift+Tab, Enter, Space, Escape and the arrow keys, every control on the
// seven office pages is reached, there is no keyboard trap, every stop shows a focus ring that contrasts with its background, the tab order follows the
// reading order, headings do not skip levels, and the sheets (Close the day, the food safety record, Close the month) trap focus while open, close with
// Escape and give focus back to the button that opened them. Findings that belong to other owners are printed as NOTE and listed in
// docs/audit/keyboard-audit.md. Run: node test/office-keyboard.e2e.mjs
import { withPage } from '../tools/pw.mjs';
import { realKitchen } from './_kitchen.mjs';

let failed = 0;
const notes = [];
// Prints ok or FAIL for one check and remembers a failure for the exit code.
function check(name, ok, detail) { console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + JSON.stringify(detail))); if (!ok) failed++; }
// Records a finding that is not this owner's to fix.
function note(text) { notes.push(text); console.log('  NOTE  ' + text); }

// Runs in the page: describes the focused element (a short selector, its words, where it is, and how its focus ring looks and contrasts).
const DESCRIBE = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const sel = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute('data-k') ? '[data-k=' + el.getAttribute('data-k') + ']' : '') + (el.getAttribute('data-action') ? '[data-action=' + el.getAttribute('data-action') + ']' : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  // parses the first rgb color in a css value
  const rgb = (v) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v || ''); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  // An outline (offset 0 or more) or an outer shadow is drawn outside the control, so it is judged against what is behind the control, not the control's own fill.
  const outside = !(parseFloat(cs.outlineOffset) < 0) && !/inset/.test(cs.boxShadow || '');
  let bg = [255, 255, 255]; for (let e = outside ? el.parentElement : el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c[3] > 0.5) { bg = c; break; } }
  let ring = null, kind = 'none';
  if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) { ring = rgb(cs.outlineColor); kind = 'outline'; }
  else if (cs.boxShadow && cs.boxShadow !== 'none') { const sh = cs.boxShadow.split(/,(?![^(]*\))/).map((x) => rgb(x)).filter((c) => c && c[3] > 0.3); if (sh.length) { ring = sh[0]; kind = 'shadow'; } }
  let ratio = null; if (ring) { const a = lum(ring) + 0.05, b = lum(bg) + 0.05; ratio = Math.max(a, b) / Math.min(a, b); }
  window.__ringInfo = { ring, bg, kind, outline: cs.outlineColor, shadow: cs.boxShadow, w: cs.outlineWidth };
  const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return { info: window.__ringInfo, kbd: el.getAttribute('data-kbd'), sel, label, top: Math.round(r.top + window.scrollY), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), kind, ratio: ratio === null ? null : Math.round(ratio * 10) / 10, visible: r.width > 0 && r.height > 0 };
};
// Runs in the page: every control a person could reach with Tab inside a root, with a short name.
const CONTROLS = (rootSel) => {
  const root = document.querySelector(rootSel) || document;
  const out = []; let n = 0;
  root.querySelectorAll('[data-kbd]').forEach((e) => e.removeAttribute('data-kbd'));
  for (const el of root.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')) {
    if (el.disabled || el.getAttribute('tabindex') === '-1' || el.hidden || el.closest('[hidden], [inert]')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.type === 'radio' || el.closest('[role=radiogroup], [role=tablist]')) continue;   // arrow-key groups are walked separately
    if (el.closest('.visually-hidden') && el.tagName === 'INPUT' && el.type === 'file') continue;
    el.setAttribute('data-kbd', String(++n));
  }
  return n;
};

// Tabs through the page from its start, up to `max` stops, and returns the stops (each described); stops when focus leaves the root or stalls.
async function tabWalk(page, rootSel, max) {
  // Starts at the first control of the page in document order (the browser's own starting point would still be where the last page left it).
  await page.evaluate((s) => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0); const f = document.querySelector(s + ' [data-kbd]'); if (f) f.focus(); }, rootSel);
  const stops = []; let stalled = 0, last = null;
  const first = await page.evaluate(DESCRIBE); if (first) stops.push(first);
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(DESCRIBE);
    if (!d) break;
    if (stops.length === 1 && stops[0].kbd === d.kbd) continue;
    const inRoot = await page.evaluate((s) => { const r = document.querySelector(s); return !r || r.contains(document.activeElement); }, rootSel);
    if (!inRoot) { stops.leftRoot = true; break; }
    const key = d.sel + '|' + d.top + '|' + d.left;
    if (key === last) { stalled++; if (stalled >= 2) { stops.trapped = d; break; } } else stalled = 0;
    last = key; stops.push(d);
    if (stops.length > 2 && stops[0].kbd === d.kbd) { stops.cycled = true; stops.pop(); break; }
  }
  return stops;
}


// Scrolls through a page so every lazily drawn card and chart is built (they draw when they come into view), then back to the top.
async function scrollAll(page) {
  await page.evaluate(async () => {
    const boxes = [document.scrollingElement, ...[...document.querySelectorAll('#sb-office *')].filter((e) => e.scrollHeight > e.clientHeight + 100 && getComputedStyle(e).overflowY !== 'visible')];
    for (let y = 0; y < 9000; y += 400) { for (const b of boxes) b.scrollTop = y; window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)); }
    for (const b of boxes) b.scrollTop = 0; window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
}
// Opens a sheet from its button with the keyboard and checks the whole contract: Enter opens it, focus moves in, Tab and Shift+Tab stay inside,
// Escape closes it and focus goes back to the button. `sheetSel` is something inside the sheet.
async function sheetCheck(page, name, openerPage, openerSel, sheetSel) {
  await page.evaluate((x) => { location.hash = '#/office/' + x; }, openerPage);
  await page.waitForSelector(openerSel, { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll('#sb-office details').forEach((d) => { d.open = true; }));
  await scrollAll(page);
  await page.evaluate((sel) => { const b = document.querySelector(sel); b.scrollIntoView({ block: 'center' }); b.focus(); b.setAttribute('data-opener', '1'); }, openerSel);
  await page.keyboard.press('Enter');
  await page.waitForSelector(sheetSel, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const open = await page.evaluate((sel) => { const e = document.querySelector(sel); return !!(e && e.closest('.sheet, [role=dialog], [role=alertdialog]')); }, sheetSel);
  check(name + ': Enter on the button opens the sheet', open);
  if (!open) return;
  const inside = () => page.evaluate((sel) => { const e = document.querySelector(sel), sh = e && e.closest('.sheet, [role=dialog], [role=alertdialog]'); return !!sh && sh.contains(document.activeElement); }, sheetSel);
  check(name + ': focus moves into the sheet when it opens', await inside());
  let leaked = 0; const seen = new Set();
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await inside())) leaked++; seen.add(await page.evaluate(() => { const e = document.activeElement; return e.tagName + (e.id || '') + (e.innerText || '').slice(0, 20); })); }
  check(name + ': Tab never leaves the sheet (focus cycles through ' + seen.size + ' controls)', leaked === 0 && seen.size >= 1, { leaked });
  let leakedBack = 0; for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) leakedBack++; }
  check(name + ': Shift+Tab stays inside too', leakedBack === 0, { leakedBack });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  check(name + ': Escape closes it', await page.evaluate((sel) => { const e = document.querySelector(sel); return !(e && e.closest('.sheet, [role=dialog], [role=alertdialog]')); }, sheetSel));
  const back = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-opener') === '1');
  check(name + ': focus goes back to the button that opened it', back, await page.evaluate(() => { const e = document.activeElement; return e ? e.tagName + '.' + e.className : null; }));
  await page.evaluate(() => document.querySelectorAll('[data-opener]').forEach((e) => e.removeAttribute('data-opener')));
}

await withPage({ w: 1280, h: 900, hash: '?demo' }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 20000 });
  await page.evaluate(() => { try { SB.floor.setWelcome(false); } catch (e) { /* no welcome */ } });
  const ids = await page.evaluate(() => SB.office.pages().map((p) => p.id));
  for (const id of ids) {
    await page.evaluate((x) => { location.hash = '#/office/' + x; }, id);
    await page.waitForSelector('#sb-office h1.of-title', { timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { document.querySelectorAll('#sb-office details').forEach((d) => { d.open = true; }); });
    const total = await page.evaluate(CONTROLS, '#sb-office');
    const stops = await tabWalk(page, '#sb-office', total + 60);
    const reached = new Set(stops.map((x) => x.kbd));
    const missed = await page.evaluate((r) => [...document.querySelectorAll('[data-kbd]')].filter((e) => !r.includes(e.getAttribute('data-kbd'))).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0] + ' "' + (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 30) + '"'), [...reached]);
    check(id + ': every control is reached with Tab (' + missed.length + ' missed)', missed.length === 0, missed.slice(0, 8));
    check(id + ': no keyboard trap (Tab always moves on) and the walk covers the page (' + stops.length + ' stops for about ' + total + ' controls)', !stops.trapped && stops.length > 0, stops.trapped);
    const noRing = stops.filter((s) => s.visible && s.kind === 'none');
    const faint = stops.filter((s) => s.visible && s.kind !== 'none' && s.ratio !== null && s.ratio < 3);
    check(id + ': every stop shows a focus ring', noRing.length === 0, noRing.slice(0, 5).map((s) => s.sel + ' "' + s.label + '"'));
    check(id + ': every focus ring contrasts at least 3 to 1 with its background', faint.length === 0, faint.slice(0, 5).map((s) => s.sel + ' ' + s.ratio + ' ' + s.label + ' ' + s.kind + ' ' + JSON.stringify(s.info)));
    const hidden = stops.filter((s) => !s.visible);
    check(id + ': no stop is an invisible element', hidden.length === 0, hidden.slice(0, 5).map((s) => s.sel));
    // reading order: the tab order is the document order (no tabindex above zero), and inside each card that order is also the visual order
    // (top to bottom, then left to right); two cards side by side are allowed to interleave only by whole cards.
    const order = await page.evaluate(() => {
      document.querySelectorAll('#sb-office *').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; });
      const pos = [...document.querySelectorAll('#sb-office [tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).length;
      const bad = [];
      for (const card of document.querySelectorAll('#sb-office .of-card, #sb-office .od-panel, #sb-office .od-fcard, #sb-office .of-filters')) {
        const els = [...card.querySelectorAll('[data-kbd]')].filter((e) => e.closest('.of-card, .od-panel, .od-fcard, .of-filters') === card);
        let prev = null;
        for (const e of els) { const r = e.getBoundingClientRect(); if (!r.width) continue; if (prev && r.top < prev.top - 40 && r.left <= prev.left + 4) bad.push(card.className.split(' ')[0] + ': ' + (e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 30)); prev = r; }
      }
      return { pos, bad };
    });
    check(id + ': tab order follows the reading order (no tabindex above 0; ' + order.bad.length + ' cards out of order)', order.pos === 0 && order.bad.length === 0, order);
    // headings never skip a level
    const hs = await page.evaluate(() => [...document.querySelectorAll('#sb-office h1, #sb-office h2, #sb-office h3, #sb-office h4, #sb-office h5, #sb-office h6')].filter((h) => h.getBoundingClientRect().width > 0).map((h) => +h.tagName[1]));
    const skips = []; for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) skips.push(hs[i - 1] + '->' + hs[i]);
    check(id + ': headings do not skip a level', skips.length === 0, skips);
  }

  await sheetCheck(page, 'Food safety record', 'safety', '[data-k="print-safety-log"]', '.si-actions');
  check('no console or page errors', !logs.errors.length && !logs.pageErrors.length, { e: logs.errors.slice(0, 2), p: logs.pageErrors.slice(0, 2) });
});

// ---- sheets and dialogs in a real own kitchen (the demo hides Close the month and the erase buttons) ----
await withPage({ w: 1280, h: 900, hash: '' }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 20000 });
  await page.evaluate(() => { try { SB.floor.setWelcome(false); } catch (e) { /* no welcome */ } });
  await realKitchen(page, { dishes: 3, orders: 4 });
  // pay the orders so the sales page has numbers (its cards stay hidden until there is something to show)
  await page.evaluate(() => { const S = SB.store; for (const t of S.getState().tickets) { for (const it of t.items) S.dispatchEx('completeItem', { ticketId: t.id, itemId: it.id }, { source: 'ui' }); S.dispatchEx('bumpTicket', { ticketId: t.id }, { source: 'ui' }); S.dispatchEx('payOrder', { orderId: t.orderId, method: 'cash', tip: 1 }, { source: 'ui' }); } });
  await page.evaluate(() => { location.hash = '#/office/money'; });
  await page.waitForSelector('#sb-office .ch-tbtn', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(1500);
  await scrollAll(page);
  const tbtn = await page.evaluate(() => { const b = [...document.querySelectorAll('#sb-office .ch-tbtn')].find((x) => x.getBoundingClientRect().width > 0); if (!b) return null; b.scrollIntoView({ block: 'center' }); b.focus(); b.setAttribute('data-tb', '1'); return { label: b.innerText.trim() }; });
  if (tbtn) {
    await page.keyboard.press('Space'); await page.waitForTimeout(700);
    const after = await page.evaluate(() => { const b = document.querySelector('[data-tb]'); return { pressed: b && b.getAttribute('aria-pressed'), tables: document.querySelectorAll('#sb-office .ch-tblwrap:not([hidden])').length, focused: !!b && document.activeElement === b }; });
    check('Space on "View as table" shows a table and keeps focus on the button', after.tables === 1 && after.focused && after.pressed === 'true', after);
    await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    const again = await page.evaluate(() => { const b = document.querySelector('[data-tb]'); return { pressed: b && b.getAttribute('aria-pressed'), tables: document.querySelectorAll('#sb-office .ch-tblwrap:not([hidden])').length, focused: !!b && document.activeElement === b }; });
    check('Enter on it hides the table again', again.tables === 0 && again.focused && again.pressed === 'false', again);
  } else note('no visible "View as table" button on the Sales and money page in this kitchen');
  // ---- arrow-key groups and the table buttons, on the Sales and money page (it has both) ----
  await page.evaluate(() => { location.hash = '#/office/money'; });
  await page.waitForSelector('#sb-office .seg[role=radiogroup]', { timeout: 15000 });
  await page.waitForTimeout(900);
  await scrollAll(page);
  const groups = await page.evaluate(() => [...document.querySelectorAll('#sb-office .seg[role=radiogroup]')].map((g, i) => { g.setAttribute('data-kg', String(i)); return { i, label: g.getAttribute('aria-label') || '', n: g.querySelectorAll('[role=radio]').length, tab: g.querySelectorAll('[role=radio]:not([tabindex="-1"])').length }; }));
  check('each filter group is a single tab stop (roving tabindex): ' + groups.map((g) => g.label + ' ' + g.tab + '/' + g.n).join(', '), groups.length > 0 && groups.every((g) => g.tab === 1), groups);
  for (const g of groups) {
    await page.evaluate((i) => { document.querySelector('[data-kg="' + i + '"]').scrollIntoView({ block: 'center' }); }, g.i);
    await page.waitForTimeout(500);
    const before = await page.evaluate((i) => { const r = document.querySelector('[data-kg="' + i + '"]'); const cur = r.querySelector('[role=radio]:not([tabindex="-1"])'); cur.focus(); return { id: cur.dataset.id, took: document.activeElement === cur }; }, g.i);
    if (!before.took) { check('"' + g.label + '" can take keyboard focus', false, before); continue; }
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
    const after = await page.evaluate((i) => { const r = document.querySelector('[data-kg="' + i + '"]'); const f = document.activeElement; return { alive: !!r && document.body.contains(r), inside: !!r && r.contains(f), id: f.dataset && f.dataset.id, tag: f.tagName }; }, g.i);
    check('arrow keys move inside "' + g.label + '" and keep focus in the group (it must not be lost when the card redraws)', after.inside && (g.n < 2 || after.id !== before.id), { before, after });
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
  }
  await sheetCheck(page, 'Close the day', 'money', '[data-k="close-day"]', '.cd-page');
  // Close the month is A2's sheet; the card's button is off in a young kitchen, so the sheet is opened the way the button does it, from the focused button
  await page.evaluate(() => { location.hash = '#/office/data'; });
  await page.waitForSelector('[data-action="close-month"]', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const b = document.querySelector('[data-action="close-month"]'); b.disabled = false; b.scrollIntoView({ block: 'center' }); b.focus(); b.setAttribute('data-opener', '1'); SB.setup.openCloseMonth(); });
  await page.waitForTimeout(900);
  const cm = await page.evaluate(() => { const sh = document.querySelector('.sheet'); return { open: !!sh, inside: !!sh && sh.contains(document.activeElement) }; });
  check('Close the month: the sheet opens and focus moves into it', cm.open && cm.inside, cm);
  let cmLeak = 0; for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => { const sh = document.querySelector('.sheet'); return !sh || sh.contains(document.activeElement); }))) cmLeak++; }
  check('Close the month: Tab never leaves the sheet', cmLeak === 0, { cmLeak });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  check('Close the month: Escape closes it and focus goes back to the card button', await page.evaluate(() => !document.querySelector('.sheet') && document.activeElement && document.activeElement.getAttribute('data-opener') === '1'), await page.evaluate(() => { const e = document.activeElement; return e ? e.tagName + '.' + e.className : null; }));
  // the pilot report buttons answer to Space and Enter, and the report can be read afterwards
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-pilot="report"] button')].find((x) => x.textContent.trim() === 'Show report'); const d = b.closest('details'); if (d) d.open = true; b.scrollIntoView({ block: 'center' }); b.focus(); });
  await page.keyboard.press('Space'); await page.waitForTimeout(500);
  check('Space on "Show report" shows the pilot report', await page.evaluate(() => { const r = document.querySelector('.od-report'); return !!r && !r.hidden && r.textContent.length > 20; }));
  // landmarks: the rail is a navigation and the page has one main area
  const lm = await page.evaluate(() => ({ nav: document.querySelectorAll('#sb-office nav, #sb-office [role=navigation]').length, main: document.querySelectorAll('#sb-office main, #sb-office [role=main]').length, h1: document.querySelectorAll('#sb-office h1').length }));
  check('the back office has a navigation landmark, a main area and one top heading', lm.nav >= 1 && lm.main === 1 && lm.h1 === 1, lm);
  // the erase box
  await page.evaluate(() => { const b = document.querySelector('[data-action="reset-live"]'); b.scrollIntoView({ block: 'center' }); b.focus(); });
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const erase = await page.evaluate(() => { const box = document.querySelector('.od-danger-box'); return { shown: !!box && !box.hidden, focusInside: !!box && box.contains(document.activeElement), confirmOff: [...(box ? box.querySelectorAll('button') : [])].some((b) => b.disabled) }; });
  check('Enter on "Erase tickets and records" opens the typed-word box and moves focus into it', erase.shown && erase.focusInside, erase);
  check('the confirm button stays off until the word is typed', erase.confirmOff, erase);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('Escape closes the erase box and focus returns to the erase button', await page.evaluate(() => { const box = document.querySelector('.od-danger-box'); return (!box || box.hidden) && document.activeElement && document.activeElement.getAttribute('data-action') === 'reset-live'; }), await page.evaluate(() => { const e = document.activeElement; return e ? e.tagName + '.' + e.className : null; }));

  // ---- the restore confirmation dialog: opened from the Data page's "Replace everything with this backup" ----
  const sheetInside = (name) => page.evaluate((n) => { const d = document.querySelector('.sheet[role=alertdialog], .sheet[role=dialog]'); return { open: !!d, inside: !!d && d.contains(document.activeElement), danger: !!d && !!document.activeElement && document.activeElement.classList.contains('btn-danger') }; });
  const backup = await page.evaluate(() => SB.store.exportAll());
  const ticketsBefore = await page.evaluate(() => SB.store.getState().tickets.length);
  await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = '#/office/data'; });
  await page.waitForSelector('#od-data input[type="file"]', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(600);
  await page.locator('#od-data input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await page.waitForSelector('[data-action="import-replace"]', { timeout: 10000 });
  await page.evaluate(() => { const b = document.querySelector('[data-action="import-replace"]'); b.scrollIntoView({ block: 'center' }); b.focus(); b.setAttribute('data-opener', '1'); });
  await page.keyboard.press('Enter'); await page.waitForSelector('.sheet[role=alertdialog]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
  let d1 = await sheetInside();
  check('Restore confirmation: Enter on "Replace everything" opens the dialog and focus moves inside', d1.open && d1.inside, d1);
  check('Restore confirmation: focus does not start on the destructive button', !d1.danger, d1);
  let leak = 0; for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); if (!(await sheetInside()).inside) leak++; }
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Tab'); if (!(await sheetInside()).inside) leak++; }
  check('Restore confirmation: Tab and Shift+Tab stay inside the dialog', leak === 0, { leak });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  check('Restore confirmation: Escape cancels, nothing was replaced, and focus goes back to the button', await page.evaluate((n) => !document.querySelector('.sheet[role=alertdialog]') && SB.store.getState().tickets.length === n && document.activeElement && document.activeElement.getAttribute('data-opener') === '1', ticketsBefore), await page.evaluate(() => { const e = document.activeElement; return e ? e.tagName + '.' + e.className : null; }));
  // and the keyboard path to confirming works: Enter opens, Tab to the danger button, Enter replaces
  await page.keyboard.press('Enter'); await page.waitForSelector('.sheet[role=alertdialog]', { timeout: 8000 }); await page.waitForTimeout(300);
  let reached = false; for (let i = 0; i < 8 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await sheetInside()).danger; }
  check('Restore confirmation: the destructive button can be reached with Tab', reached);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  check('Restore confirmation: Enter on it restores the backup and closes the dialog', await page.evaluate(() => !document.querySelector('.sheet[role=alertdialog]') && /Backup restored/.test((document.querySelector('.od-impresult') || {}).innerText || '')));

  // ---- the manager PIN keypad ----
  await page.evaluate(async () => { await SB.shell.setPin('1234'); });
  await page.evaluate(() => { location.hash = '#/office/data'; }); await page.waitForTimeout(600);
  const pinInside = () => page.evaluate(() => { const d = [...document.querySelectorAll('.sheet')].find((x) => x.querySelector('.keypad')); return { open: !!d, inside: !!d && d.contains(document.activeElement), label: document.activeElement ? document.activeElement.getAttribute('aria-label') : null }; });
  await page.evaluate(() => { const b = [...document.querySelectorAll('#od-data button')].find((x) => x.getBoundingClientRect().width > 0 && !x.disabled); b.scrollIntoView({ block: 'center' }); b.setAttribute('data-opener', '1'); b.focus(); window.__pin = null; SB.shell.promptPin().then((r) => { window.__pin = r; }); });
  await page.waitForSelector('.keypad', { timeout: 8000 }); await page.waitForTimeout(400);
  let pk = await pinInside();
  check('PIN keypad: it opens with focus on the first key ("' + pk.label + '")', pk.open && pk.inside && pk.label === 'Digit 1', pk);
  const keyNames = await page.evaluate(() => [...document.querySelectorAll('.keypad button')].map((b) => ({ vis: b.innerText.trim(), name: b.getAttribute('aria-label') })));
  check('PIN keypad: all 12 keys have a spoken name that contains the digit drawn on them', keyNames.length === 12 && keyNames.every((k) => k.name && (!k.vis || k.name.includes(k.vis) || k.name.toLowerCase().includes(k.vis.toLowerCase()))), keyNames);
  let pleak = 0; for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); if (!(await pinInside()).inside) pleak++; }
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Tab'); if (!(await pinInside()).inside) pleak++; }
  check('PIN keypad: Tab and Shift+Tab stay inside the sheet', pleak === 0, { pleak });
  await page.locator('.keypad button').first().focus();
  for (const k of '1111') await page.keyboard.press(k);
  await page.waitForTimeout(500);
  check('PIN keypad: typing a wrong PIN with the keyboard says so in an alert region and keeps the keypad open', await page.evaluate(() => /Wrong PIN\. 4 tries left/.test((document.querySelector('.pin-msg') || {}).textContent || '') && document.querySelector('.pin-msg').getAttribute('role') === 'alert' && !!document.querySelector('.keypad') && window.__pin === null));
  check('PIN keypad: the entered digits are announced politely ("0 of 4 digits entered")', await page.evaluate(() => { const st = document.querySelector('.sheet [role=status][aria-live=polite]'); return !!st && /\d of 4 digits entered/.test(st.textContent); }));
  for (const k of '1234') await page.keyboard.press(k);
  await page.waitForTimeout(700);
  check('PIN keypad: the right PIN opens the way, closes the keypad and gives focus back', await page.evaluate(() => window.__pin === true && !document.querySelector('.keypad') && document.activeElement && document.activeElement.getAttribute('data-opener') === '1'), await page.evaluate(() => ({ pin: window.__pin, a: document.activeElement && document.activeElement.tagName })));
  await page.evaluate(() => { window.__pin = null; SB.shell.promptPin().then((r) => { window.__pin = r; }); });
  await page.waitForSelector('.keypad', { timeout: 8000 }); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  check('PIN keypad: Escape cancels (answer is no) and focus goes back to the opener', await page.evaluate(() => window.__pin === false && !document.querySelector('.keypad') && document.activeElement && document.activeElement.getAttribute('data-opener') === '1'), await page.evaluate(() => ({ pin: window.__pin })));
  await page.evaluate(async () => { await SB.shell.setPin(null, { verified: true }); });

  // ---- A1's thrown-out log sheet ----
  await page.evaluate(() => { location.hash = '#/office/safety'; }); await page.waitForTimeout(800);
  await page.evaluate(() => { const b = document.querySelector('#sb-office button'); b.setAttribute('data-opener', '1'); b.focus(); SB.sheets.open('discards'); });
  await page.waitForSelector('.sheet .dlog-wrap', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  const dl = () => page.evaluate(() => { const sh = document.querySelector('.dlog-wrap') && document.querySelector('.dlog-wrap').closest('.sheet'); return { open: !!sh, inside: !!sh && sh.contains(document.activeElement) }; });
  let dlo = await dl();
  check('Thrown-out log: the sheet opens and focus moves inside', dlo.open && dlo.inside, dlo);
  let dleak = 0; for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await dl()).inside) dleak++; }
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Tab'); if (!(await dl()).inside) dleak++; }
  check('Thrown-out log: Tab and Shift+Tab stay inside the sheet', dleak === 0, { dleak });
  const dnames = await page.evaluate(() => { const sh = document.querySelector('.dlog-wrap').closest('.sheet'); return { unnamed: [...sh.querySelectorAll('button, input, select, textarea')].filter((e) => !(e.getAttribute('aria-label') || (e.innerText || '').trim() || (e.labels && e.labels.length) || e.getAttribute('title'))).map((e) => e.tagName + '.' + String(e.className).split(' ')[0]), th: sh.querySelectorAll('th').length, caption: !!sh.querySelector('caption') }; });
  check('Thrown-out log: every control in it has a name', dnames.unnamed.length === 0, dnames);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  check('Thrown-out log: Escape closes it and focus goes back to where it was', await page.evaluate(() => !document.querySelector('.dlog-wrap') && document.activeElement && document.activeElement.getAttribute('data-opener') === '1'), await page.evaluate(() => { const e = document.activeElement; return e ? e.tagName + '.' + e.className : null; }));

  // ---- the manager glance, drawn the way the wall board draws it ----
  const gl = await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'glance-host'; document.body.appendChild(host);
    const h = SB.office.glance(host, { size: 'wall' });
    const ctl = [...host.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')];
    const out = { controls: ctl.length, unnamed: ctl.filter((e) => !(e.getAttribute('aria-label') || (e.innerText || '').trim() || e.getAttribute('title'))).length, live: host.querySelectorAll('[aria-live], [role=status], [role=alert]').length, region: !!host.querySelector('[role=region], section[aria-label], [aria-label]'), text: host.innerText.slice(0, 80) };
    if (h && h.destroy) h.destroy(); host.remove();
    return out;
  });
  check('Manager glance: every control in it has a name and it has a labelled region (' + gl.controls + ' controls, ' + gl.live + ' live regions)', gl.unnamed === 0 && gl.region, gl);
  check('no console or page errors (sheets)', !logs.errors.length && !logs.pageErrors.length, { e: logs.errors.slice(0, 2), p: logs.pageErrors.slice(0, 2) });
});
console.log(notes.length ? '\n' + notes.length + ' notes for others' : '');
process.exit(failed ? 1 : 0);
