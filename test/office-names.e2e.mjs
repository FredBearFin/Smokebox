// Accessible-name audit of every office page (what a screen reader says): every control has a name; a control's name contains its visible words
// (label in name); aria-labelledby, aria-controls and aria-describedby point at elements that exist; nothing focusable hides inside aria-hidden;
// roles are used on elements that can have them; ids are unique; charts and tables are named; each page has a live region for what changes. axe's
// experimental label-content-name-mismatch rule runs too. Run: node test/office-names.e2e.mjs
import fs from 'node:fs';
import { withPage } from '../tools/pw.mjs';
import { toolRequire } from '../tools/_deps.mjs';
import { realKitchen } from './_kitchen.mjs';

let failed = 0;
// Prints ok or FAIL for one check and remembers a failure for the exit code.
function check(name, ok, detail) { console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + JSON.stringify(detail))); if (!ok) failed++; }
const axeSource = fs.readFileSync(toolRequire.resolve ? toolRequire.resolve('axe-core/axe.min.js') : '/opt/npm-tools/node_modules/axe-core/axe.min.js', 'utf8');

// Runs in the page: collects the problems on the office page that is showing.
const AUDIT = () => {
  const root = document.getElementById('sb-office'), out = { noName: [], notInName: [], badRef: [], hiddenFocus: [], dupId: [], badRole: [], live: 0, tables: [], charts: [] };
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9%$.]+/g, ' ').trim();
  const visible = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const text = (e) => (e.innerText || e.textContent || '').trim();
  const nameOf = (e) => {
    const lb = e.getAttribute('aria-labelledby');
    if (lb) return lb.split(/\s+/).map((id) => { const x = document.getElementById(id); return x ? text(x) : ''; }).join(' ').trim();
    const al = e.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    if (e.labels && e.labels.length) return [...e.labels].map(text).join(' ').trim();
    if (e.tagName === 'IMG') return e.getAttribute('alt') || '';
    if (e.tagName === 'INPUT' && ['button', 'submit'].includes(e.type)) return e.value;
    const t = text(e); if (t) return t;
    const img = e.querySelector('img[alt], svg[aria-label], [role=img][aria-label]'); if (img) return img.getAttribute('alt') || img.getAttribute('aria-label') || '';
    return e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=radio], [role=tab], [role=checkbox], [role=switch], [role=link], [role=menuitem], [role=slider], [role=spinbutton], [role=combobox], [tabindex="0"]';
  for (const e of root.querySelectorAll(sel)) {
    if (!visible(e) && !(e.type === 'file')) continue;
    if (e.closest('[aria-hidden=true]')) { if (!e.hasAttribute('tabindex') || e.getAttribute('tabindex') !== '-1') out.hiddenFocus.push(e.tagName + '.' + String(e.className).split(' ')[0] + ' "' + text(e).slice(0, 25) + '"'); continue; }
    const n = nameOf(e), id = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0];
    if (!n) { out.noName.push(id); continue; }
    const vis = text(e);
    // label in name (WCAG 2.5.3): when there is visible text and a separate accessible name, the name must contain the visible words
    if (vis && (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby')) && e.tagName !== 'SELECT') { const a = norm(n), b = norm(vis); if (b && !a.includes(b)) out.notInName.push(id + ': name "' + n.slice(0, 50) + '" lacks visible "' + vis.slice(0, 30) + '"'); }
  }
  for (const e of root.querySelectorAll('[aria-labelledby], [aria-controls], [aria-describedby], [aria-owns], label[for]')) {
    for (const a of ['aria-labelledby', 'aria-controls', 'aria-describedby', 'aria-owns']) { const v = e.getAttribute(a); if (v) for (const id of v.split(/\s+/)) if (!document.getElementById(id)) out.badRef.push(e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' ' + a + '=' + id); }
    if (e.tagName === 'LABEL' && e.htmlFor && !document.getElementById(e.htmlFor)) out.badRef.push('label for=' + e.htmlFor);
  }
  const seen = {}; for (const e of document.querySelectorAll('[id]')) { if (seen[e.id]) out.dupId.push(e.id); seen[e.id] = 1; }
  const roleOk = { button: 'a,button,div,span,li,summary,input'.split(','), img: null };
  for (const e of root.querySelectorAll('button[role]')) { const r = e.getAttribute('role'); if (!['radio', 'tab', 'menuitem', 'switch', 'checkbox', 'link', 'option', 'menuitemradio', 'menuitemcheckbox', 'button', 'treeitem', 'presentation', 'none'].includes(r)) out.badRole.push('button role=' + r); if (r === 'presentation' || r === 'none') out.badRole.push('focusable button with role=' + r); }
  for (const e of root.querySelectorAll('li[role=presentation], ul[role=presentation]')) out.badRole.push(e.tagName + ' role=presentation ' + String(e.className).split(' ')[0]);
  out.live = root.querySelectorAll('[aria-live], [role=status], [role=alert], [role=log]').length;
  for (const t of root.querySelectorAll('table')) { if (!visible(t)) continue; const hasName = t.getAttribute('aria-label') || t.getAttribute('aria-labelledby') || (t.querySelector('caption') && t.querySelector('caption').textContent.trim()); const th = t.querySelectorAll('th').length; if (!hasName || !th) out.tables.push((t.className || 'table') + (hasName ? '' : ' no name') + (th ? '' : ' no th')); }
  for (const s of root.querySelectorAll('svg.ch-svg')) { if (!visible(s)) continue; if (!(s.getAttribute('aria-label') || s.getAttribute('aria-labelledby')) || !s.getAttribute('role')) out.charts.push('svg without name or role: ' + (s.getAttribute('aria-label') || '').slice(0, 30)); }
  return out;
};

// Visits every office page, expands its details, scrolls it so lazy cards draw, runs the audit and axe's label-in-name rule.
async function audit(page, label) {
  const ids = await page.evaluate(() => SB.office.pages().map((p) => p.id));
  for (const id of ids) {
    await page.evaluate((x) => { location.hash = '#/office/' + x; }, id);
    await page.waitForSelector('#sb-office h1.of-title', { timeout: 15000 });
    await page.waitForTimeout(1100);
    await page.evaluate(async () => { document.querySelectorAll('#sb-office details').forEach((d) => { d.open = true; }); const boxes = [document.scrollingElement, ...[...document.querySelectorAll('#sb-office *')].filter((e) => e.scrollHeight > e.clientHeight + 100 && getComputedStyle(e).overflowY !== 'visible')]; for (let y = 0; y < 9000; y += 450) { for (const b of boxes) b.scrollTop = y; await new Promise((r) => setTimeout(r, 60)); } for (const b of boxes) b.scrollTop = 0; });
    await page.waitForTimeout(300);
    const r = await page.evaluate(AUDIT);
    const tag = label + ' / ' + id + ': ';
    check(tag + 'every control has an accessible name', r.noName.length === 0, r.noName.slice(0, 6));
    check(tag + 'a name that differs from the visible words still contains them', r.notInName.length === 0, r.notInName.slice(0, 6));
    check(tag + 'aria-labelledby, aria-controls, aria-describedby and label for point at real elements', r.badRef.length === 0, r.badRef.slice(0, 6));
    check(tag + 'nothing focusable is hidden inside aria-hidden', r.hiddenFocus.length === 0, r.hiddenFocus.slice(0, 6));
    check(tag + 'ids are unique', r.dupId.length === 0, r.dupId.slice(0, 6));
    check(tag + 'roles are valid on what they are put on', r.badRole.length === 0, r.badRole.slice(0, 6));
    check(tag + 'tables are named and have heading cells; charts are named', r.tables.length === 0 && r.charts.length === 0, r.tables.concat(r.charts).slice(0, 6));
    check(tag + 'the page has a live region for what changes (' + r.live + ')', r.live >= 1, r.live);
    await page.evaluate(axeSource);
    const ax = await page.evaluate(async () => { const res = await window.axe.run(document.getElementById('sb-office'), { rules: { 'label-content-name-mismatch': { enabled: true } }, runOnly: { type: 'rule', values: ['label-content-name-mismatch', 'aria-valid-attr-value', 'aria-allowed-role', 'aria-hidden-focus', 'button-name', 'link-name', 'input-button-name', 'select-name', 'label', 'aria-input-field-name', 'aria-toggle-field-name', 'role-img-alt', 'svg-img-alt', 'aria-command-name', 'aria-required-children', 'aria-required-parent', 'duplicate-id-aria', 'scrollable-region-focusable'] } }); return res.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')); });
    check(tag + 'axe name, role and label-in-name rules find nothing', ax.length === 0, ax);
  }
}

for (const w of [1280, 390]) await withPage({ w, h: 900, hash: '?demo' }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 20000 });
  await page.evaluate(() => { try { SB.floor.setWelcome(false); } catch (e) { /* no welcome */ } });
  await audit(page, 'demo ' + w);
  check('no console or page errors (demo ' + w + ')', !logs.errors.length && !logs.pageErrors.length, { e: logs.errors.slice(0, 2), p: logs.pageErrors.slice(0, 2) });
});
await withPage({ w: 1280, h: 900, hash: '' }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 20000 });
  await page.evaluate(() => { try { SB.floor.setWelcome(false); } catch (e) { /* no welcome */ } });
  await realKitchen(page, { dishes: 3, orders: 4 });
  await page.evaluate(() => { const S = SB.store; for (const t of S.getState().tickets) { for (const it of t.items) S.dispatchEx('completeItem', { ticketId: t.id, itemId: it.id }, { source: 'ui' }); S.dispatchEx('bumpTicket', { ticketId: t.id }, { source: 'ui' }); S.dispatchEx('payOrder', { orderId: t.orderId, method: 'cash', tip: 1 }, { source: 'ui' }); } });
  await audit(page, 'own kitchen');
  check('no console or page errors (own kitchen)', !logs.errors.length && !logs.pageErrors.length, { e: logs.errors.slice(0, 2), p: logs.pageErrors.slice(0, 2) });
});
process.exit(failed ? 1 : 0);
