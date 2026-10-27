// Shared helpers for the QA journeys (not a test file: the runner skips names that start with "_").
// Everything here drives the app the way a person would (roles, visible words); the few page.evaluate calls only READ state
// or set up a scene (tickets, clock speed) that a journey needs, never to make a check pass.

import { startKitchen } from '../_kitchen.mjs';
export { startKitchen };
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Words that must never appear in rendered text. */
export const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|-Infinity|\[object Object\]|\bnull\b|\bNaN%|\$NaN|Invalid Date/;

export const ZONES = ['pit', 'sides', 'fry', 'cold', 'expo'];
export const ZONE_CODE = { pit: 'PIT', sides: 'HOT', fry: 'FRY', cold: 'CLD', expo: 'EXP' };
export const OFFICE_PAGES = [
  { id: 'pace', title: 'Speed' }, { id: 'tickets', title: 'Tickets' }, { id: 'stations', title: 'Stations' }, { id: 'money', title: 'Sales and money' },
  { id: 'safety', title: 'Safety' }, { id: 'stock', title: 'Stock and 86' }, { id: 'data', title: 'Menu, prices and shop' },
];

export const head = (page) => page.locator('.fl-head');
export const toasts = (page) => page.locator('.toast');
export const dialog = (page, name) => page.getByRole('dialog', { name });

/** Has a feature (a dotted path under window) been built? */
export const has = (page, path) => page.evaluate((p) => { try { return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window) != null; } catch (e) { return false; } }, path);

export async function settle(page, ms = 150) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  await wait(ms);
}

/** A brand-new kitchen is empty (no tickets, no stock). Journeys that need a known board call this: it clears live data and puts the starter hold batches in, so every dish can be sold. */
export async function clearBoard(page) {
  await startKitchen(page); // the barbecue demo kitchen with starter stock and no tickets
  await page.evaluate(() => { SB.store.tick(); });
  await settle(page, 250);
}

/** Four tickets of known shape (same scene the floor owner uses, so the words are predictable): Table 4 overdue, Pickup running late, Drive-thru rush, Walk-up on time. */
export async function seedStandard(page, { clearFirst = true } = {}) {
  if (clearFirst) await startKitchen(page); // the dishes live in the barbecue demo kitchen (a real install starts blank)
  const bad = await page.evaluate((clearFirst) => {
    const S = SB.store, bad = [];
    
    const now = S.now();
    const mk = (customer, channel, items, o = {}) => { const r = S.dispatchEx('createTicket', Object.assign({ customer, channel, items, src: 'demo', allowPast: true }, o), { source: 'sim' }); if (r.report !== 'ok') bad.push(customer + ': ' + r.report); };
    mk('Table 4', 'dine_in', [{ menuId: 'brisket_half', qty: 2 }, { menuId: 'mac' }, { menuId: 'slaw' }, { menuId: 'cornbread', qty: 2 }], { createdAt: now - 14 * 60e3 });
    mk('Pickup, Dana', 'takeout', [{ menuId: 'ribs_full' }, { menuId: 'hushpuppies' }, { menuId: 'tea', qty: 2 }], { createdAt: now - 9.5 * 60e3, note: 'Allergy: peanuts. Keep fry oil separate.' });
    mk('Drive-thru 7', 'drive_thru', [{ menuId: 'brisket_sand', mods: ['No pickles', 'Sauce on the side'] }, { menuId: 'fried_pickles' }], { createdAt: now - 5 * 60e3, rush: true });
    mk('Walk-up', 'dine_in', [{ menuId: 'sausage' }, { menuId: 'pudding' }], { createdAt: now - 40e3 });
    S.tick();
    return bad;
  }, clearFirst);
  await settle(page, 250);
  return bad;
}

/** Everything the board shows, read from the page (not from the store), so a mismatch with the store is a finding. */
export const boardSummary = (page) => page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.fl-seg .seg-opt')).map((b) => ({ id: b.dataset.id, selected: b.getAttribute('aria-selected') === 'true', count: Number((b.querySelector('.seg-count') || {}).textContent || NaN) }));
  const slips = Array.from(document.querySelectorAll('.fl-grid > .fl-slip:not(.fl-leaving)')).map((s) => ({
    id: s.dataset.ticket, level: s.dataset.level, rush: s.dataset.rush, ready: s.dataset.ready,
    customer: (s.querySelector('.slip-who') || {}).textContent, num: (s.querySelector('.slip-num') || {}).textContent,
    badge: (s.querySelector('.fl-bw') || {}).textContent,
    rows: Array.from(s.querySelectorAll('.fl-row')).map((r) => ({ id: r.dataset.item, menu: r.dataset.menu, state: r.dataset.state, kind: r.dataset.kind, text: r.innerText.replace(/\s+/g, ' ').trim() })),
  }));
  return { tabs, slips, hash: location.hash, text: document.querySelector('.fl') ? document.querySelector('.fl').innerText : '' };
});

/** Current store tickets, trimmed. */
export const storeTickets = (page) => page.evaluate(() => SB.store.getState().tickets.map((t) => ({ id: t.id, num: t.num, customer: t.customer, status: t.status, rush: t.rush, channel: t.channel, note: t.note, items: t.items.map((i) => ({ id: i.id, menuId: i.menuId, zone: i.zone, status: i.status, mods: i.mods, qty: i.qty })) })));

/** Click the flame n times with a real mouse, gap ms apart. Returns when the last click is done. */
export async function tapFlame(page, n, gap = 60) {
  const box = await page.locator('.fl-head [data-brand]').first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  for (let i = 0; i < n; i++) { await page.mouse.click(x, y); if (i < n - 1) await wait(gap); }
}

export const officeOpen = (page) => page.evaluate(() => !!(SB.shell && SB.shell.inOffice && SB.shell.inOffice()));

/** Wait until the office is open and its first page has painted (the ignition is about 700 ms, the fade-in a little more). */
export async function waitOffice(page, ms = 4000) {
  await page.waitForFunction(() => SB.shell.inOffice() && document.querySelector('#sb-office .of-main'), null, { timeout: ms }).catch(() => {});
  await wait(1100);
}

/** Go to an office page by hash and wait for it. */
export async function gotoOffice(page, id, ms = 4000) {
  await page.evaluate((id) => { location.hash = '#/office/' + id; }, id);
  await page.waitForFunction((id) => SB.shell.inOffice() && document.querySelector('#sb-office .of[data-page="' + id + '"] .of-main, #sb-office .of-main'), id, { timeout: ms }).catch(() => {});
  await wait(1100);
}

/** Text of the office main area. */
export const officeText = (page) => page.evaluate(() => { const m = document.querySelector('#sb-office .of-main'); return m ? m.innerText : ''; });

/** Charts on the visible office page: how many have marks, how many are empty frames. */
export const chartAudit = (page) => page.evaluate(() => {
  const out = [];
  document.querySelectorAll('#sb-office figure.ch').forEach((f) => {
    const svg = f.querySelector('svg.ch-svg');
    const card = f.closest('.of-card');
    const name = card ? ((card.querySelector('.of-card-head h2, .of-card-head h3, .of-card-head') || {}).textContent || '').trim().split('\n')[0].slice(0, 60) : '(no card)';
    const r = f.getBoundingClientRect();
    // inside a card the View as table button lives in the card header (the chart's own copy stays hidden), so look there first
    const tb = (card && card.querySelector('.of-card-actions .ch-tbtn')) || f.querySelector('.ch-tbtn');
    const tw = f.querySelector('.ch-tblwrap');
    const hiddenForTable = !!(tw && !tw.hidden) || !!(tb && tb.getAttribute('aria-pressed') === 'true');
    let marks = 0;
    if (svg) svg.querySelectorAll('path,rect,circle,line,polygon,polyline').forEach((e) => {
      if (e.closest('defs,pattern,clipPath,.ch-g-x,.ch-g-y,.ch-g-ref')) return;
      const c = e.getAttribute('class') || '';
      if (/\bch-(ax|grid|hit|tex|sw)\b/.test(c) || e.closest('.ch-legend')) return;
      marks++;
    });
    const em = f.querySelector('.ch-empty');
    const cardEmpty = card && Array.from(card.querySelectorAll('.of-empty, .ch-empty')).some((e) => !e.hidden && e.getBoundingClientRect().height > 0);
    out.push({ name, hasCard: !!card, type: f.dataset.chart, marks, w: Math.round(r.width), h: Math.round(r.height), table: hiddenForTable, hasEmptyMsg: (!!em && !em.hidden) || !!cardEmpty, hasTableBtn: !!(tb && !tb.hidden), hasLook: !!(card && card.querySelector('.of-look')) });
  });
  return out;
});

/** Overflow audit of everything visible: horizontal page scroll, elements wider than the viewport, clipped text, text spilling out of controls, small tap targets. */
export const layoutAudit = (page, { scope = 'body', minTap = 44, tapSel = 'button, a[href], [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, summary', skipTap = '.ch-lg, .ch-hit, .skip-link, .visually-hidden' } = {}) => page.evaluate(({ scope, minTap, tapSel, skipTap }) => {
  const root = document.querySelector(scope) || document.body;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const vis = (e) => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const inInert = (e) => !!e.closest('[inert],[hidden],[aria-hidden="true"],.visually-hidden');
  const desc = (e) => (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + ((e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)) + '"');
  const isPrimary = (e) => e.matches('.btn-primary, .btn-danger, .btn-lg, .fl-bump, .fl-fire, .fl-zone, .ord-send, .ord-review, .btn-success, .toast-undo') && !e.matches('.btn-ghost');
  const wide = [], small = [], smallPrimary = [], clipped = [], spill = [];
  root.querySelectorAll('*').forEach((e) => {
    if (e.closest('svg') && e.tagName !== 'svg') return;
    if (!vis(e) || inInert(e)) return;
    const r = e.getBoundingClientRect();
    let scrolls = false; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) { scrolls = true; break; } }
    if (!scrolls && r.width > vw + 1) wide.push(desc(e) + ' ' + Math.round(r.width) + 'px');
    else if (!scrolls && r.right > vw + 1 && r.left < vw) wide.push(desc(e) + ' right edge ' + Math.round(r.right) + ' > ' + vw);
    else if (!scrolls && r.left < -1 && r.right > 0) wide.push(desc(e) + ' left edge ' + Math.round(r.left));
    if (e.matches(tapSel) && !e.disabled && !e.matches(skipTap) && !e.closest(skipTap)) {
      if (r.height < minTap - 0.5) small.push(desc(e) + ' ' + Math.round(r.height) + 'px');
      if (isPrimary(e) && r.height < minTap - 0.5) smallPrimary.push(desc(e) + ' ' + Math.round(r.height) + 'px');
    }
    if (e.children.length === 0 && e.textContent && e.textContent.trim().length > 1) {
      const cs = getComputedStyle(e);
      if (/(hidden|clip)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis') clipped.push(desc(e) + ' scroll ' + e.scrollWidth + ' > ' + e.clientWidth);
      else if (/(hidden|clip)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 3 && cs.textOverflow !== 'ellipsis' && cs.webkitLineClamp === 'none') clipped.push(desc(e) + ' height scroll ' + e.scrollHeight + ' > ' + e.clientHeight);
    }
    // text that sticks out of its own control: measure the real text boxes (not absolutely positioned badges and not visually-hidden text)
    if (e.matches('button, .chip, .badge, [role=tab], [role=radio], .btn, .seg-opt')) {
      const er = e.getBoundingClientRect(); let over = 0, sample = '';
      const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        if (!n.textContent.trim()) continue;
        const pe = n.parentElement;
        if (pe.closest('.visually-hidden,[aria-hidden="true"],[hidden]')) continue;
        let abs = false; for (let q = pe; q && q !== e.parentElement; q = q.parentElement) { const cp = getComputedStyle(q).position; if (cp === 'absolute' || cp === 'fixed') { abs = true; break; } }
        if (abs) continue;
        const rg = document.createRange(); rg.selectNodeContents(n); const rr = rg.getBoundingClientRect();
        if (rr.width < 1) continue;
        const o = Math.max(rr.right - er.right, er.left - rr.left);
        if (o > over) { over = o; sample = n.textContent.trim().slice(0, 24); }
      }
      if (over > 1.5) spill.push(desc(e) + ' text "' + sample + '" sticks out by ' + Math.round(over) + 'px');
    }
  });
  const docOver = document.documentElement.scrollWidth - vw;
  const bodyOver = document.body.scrollWidth - vw;
  return { vw, vh, docOver, bodyOver, wide: wide.slice(0, 8), small: small.slice(0, 30), smallCount: small.length, smallPrimary: smallPrimary.slice(0, 10), clipped: clipped.slice(0, 8), spill: spill.slice(0, 8) };
}, { scope, minTap, tapSel, skipTap });

/** Contrast of a named list of [selector, why] against the effective background, using SB.util.contrast. */
export const contrastOf = (page, pairs) => page.evaluate((pairs) => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = (e) => { let acc = null; for (let p = e; p; p = p.parentElement) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { if (c.a >= 0.99) return acc ? mix(acc, c) : c; acc = acc ? mix(acc, c) : c; } } return acc ? mix(acc, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 }; };
  const mix = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return pairs.map(([sel, why, large]) => {
    const e = document.querySelector(sel);
    if (!e) return { sel, why, missing: true };
    const cs = getComputedStyle(e); const fg = parse(cs.color); const bg = bgOf(e);
    const fgm = fg.a < 1 ? mix(fg, bg) : fg;
    const ratio = SB.util.contrast(hex(fgm), hex(bg));
    return { sel, why, ratio: Math.round(ratio * 100) / 100, fg: hex(fgm), bg: hex(bg), size: cs.fontSize, large: !!large };
  });
}, pairs);

/** Press Esc until no sheet is open (a search box with text eats the first Esc), then let the close animation and history step finish. */
export async function closeSheets(page, max = 4) {
  for (let i = 0; i < max; i++) {
    const n = await page.evaluate(() => (SB.sheets && SB.sheets.count ? SB.sheets.count() : 0)).catch(() => 0);
    if (!n) break;
    await page.keyboard.press('Escape');
    await wait(450);
  }
  await wait(250);
}

/** Open a sheet with its keyboard key and wait until it is the open dialog. */
export async function openKey(page, key, name, viaApi = null) {
  await closeSheets(page);
  // viaApi: a sheet that has no key any more (H now shows the Cabinet tab) is opened by its name instead.
  if (viaApi) await page.evaluate((n) => SB.sheets.open(n), viaApi); else await page.keyboard.press(key);
  const d = page.getByRole('dialog', { name });
  await d.waitFor({ state: 'visible', timeout: 10000 });
  await wait(300);
  return d;
}

/** Inner horizontal scrollers that actually overflow (a strip of tabs or a table that scrolls on its own is allowed; the page itself is not). */
export const scrollers = (page, scope = 'body') => page.evaluate((scope) => {
  const root = document.querySelector(scope) || document.body, out = [];
  root.querySelectorAll('*').forEach((e) => {
    const cs = getComputedStyle(e);
    if (!/(auto|scroll)/.test(cs.overflowX) || e.scrollWidth <= e.clientWidth + 1) return;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden],[inert],[aria-hidden="true"]')) return;
    out.push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' ' + e.scrollWidth + '>' + e.clientWidth);
  });
  return out.slice(0, 8);
}, scope);

/** Press Tab n times with a real keyboard and report whether each focused control shows a ring (outline of 2px or more, or a box-shadow) and is on screen. */
export async function focusRings(page, n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    out.push(await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body || e === document.documentElement) return { none: true };
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const ow = parseFloat(cs.outlineWidth) || 0;
      let ring = cs.outlineStyle !== 'none' && ow >= 2 && cs.outlineColor !== 'rgba(0, 0, 0, 0)';
      let shadow = !!cs.boxShadow && cs.boxShadow !== 'none';
      // a field inside a wrapper that draws the ring on :focus-within (the order sheet search box) counts
      for (let q = e.parentElement, k = 0; q && k < 3 && !(ring || shadow); q = q.parentElement, k++) { const qs = getComputedStyle(q); if (q.matches(':focus-within') && ((qs.outlineStyle !== 'none' && parseFloat(qs.outlineWidth) >= 2) || (qs.boxShadow && qs.boxShadow !== 'none'))) ring = true; }
      const name = (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
      return { name, tag: e.tagName.toLowerCase(), ring, shadow, ow, onscreen: r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth };
    }));
  }
  return out;
}

/** Wait until the open sheet has stopped moving (slide-in animation done), so layout measurements are real. */
export async function sheetStable(page, max = 3000) {
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < max) {
    const r = await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); if (!d) return 'none'; const b = d.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((x) => Math.round(x)).join(','); });
    if (r === last && r !== 'none') return true;
    last = r; await wait(150);
  }
  return false;
}
