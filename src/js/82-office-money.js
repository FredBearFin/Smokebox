/*
 * WHAT THIS FILE IS: The "Sales and money" back-office page (sales, margin, brisket yield, a what-if), and
 * SB.officeB, the small helper set that the Safety and Stock pages share.
 * PARTS: 1 plain helpers (no screen needed), 2 screen helpers (menus, switches, verdict box), 3 the page.
 * USES: 40-metrics.js, 80-office-core.js.   USED BY: 83-office-safety.js, 85-office-stock.js, the office frame.
 * KEPT: weights via kit.fmt.g (kg or lb, as the owner chose), money via kit.fmt.money, a missing cost is "not recorded", never 0.  TRAP: SB.metrics
 * percents are fractions (0 to 1) except thermal() hotPct and chilledPct (0 to 100).
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  // A cost per kilogram shown per pound when the owner weighs in pounds (settings, Weights), and the unit word to match.
  const perW = (v) => (typeof v === 'number' && isFinite(v) && U.units && U.units.weight === 'lb' ? v * 0.45359237 : v);
  const wWord = () => (U.units && U.units.weight === 'lb' ? 'lb' : 'kg');
  const B = (SB.officeB = SB.officeB || {});
  // True only for a real, finite number (not NaN, not text that looks like a number).
  const isNum = (n) => typeof n === 'number' && isFinite(n);

  // ---- 1. Plain helpers (no screen needed), shared by the three pages ----
  // Joins a list into plain words: "a, b and c". Empty items are skipped.
  B.list = (items, conj) => {
    const a = (items || []).filter((x) => x != null && x !== '');
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' ' + (conj || 'and') + ' ' + a[a.length - 1];
  };
  // Picks the singular or plural word for a count; the plural defaults to the singular plus an s.
  B.plural = (n, one, many) => (n === 1 ? one : many || one + 's');
  // Average sales for each weekday (Monday first) from the by-day rows of M.sales, or null when the range is too short to
  // compare days: it needs at least two weeks and ten days with paid orders. Each average is over the days of that weekday
  // that had paid orders, in whole cents. Returns [{wd, name, days, avg}] with avg null for a weekday with no sales day.
  B.weekdayAverages = (byDay) => {
    const rows = Array.isArray(byDay) ? byDay : [];
    if (rows.length < 10) return null;
    const first = rows[0].date, last = rows[rows.length - 1].date;
    const span = Math.round((SB.util.dateKeyToMs(last) - SB.util.dateKeyToMs(first)) / 86400e3) + 1;
    if (span < 14) return null;
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return [1, 2, 3, 4, 5, 6, 0].map((wd, i) => {
      const mine = rows.filter((d) => SB.util.weekday(d.date) === wd);
      const cents = mine.reduce((a, d) => a + Math.round(d.net * 100), 0);
      return { wd, name: names[i], days: mine.length, avg: mine.length ? Math.round(cents / mine.length) / 100 : null };
    });
  };
  // Middle value of the numbers in a list (the mean of the two middle ones when the count is even), or null.
  B.median = (arr) => {
    const a = (arr || []).filter(isNum).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  /** Local midnight of a YYYY-MM-DD key (what the charts' date axis wants). */
  B.dayMs = (key) => { const p = String(key).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); };
  /**
   * Axis range for a chart of whole days: the data padded by half a day and widened to nine days.
   * WATCH OUT: the chart kit puts up to ten ticks on a time axis, so on a shorter range it ticks more often
   * than daily and a date label would print twice. Nine days keeps every tick at a day or more.
   */
  B.dayWindow = (firstMs, lastMs) => {
    const DAY = 864e5;
    let lo = firstMs - DAY / 2, hi = lastMs + DAY / 2;
    if (hi - lo < 9 * DAY) { const extra = (9 * DAY - (hi - lo)) / 2; lo -= extra; hi += extra; }
    return { min: lo, max: hi };
  };
  /** Service settings with the config as fallback. */
  B.settings = (ds) => {
    const C = SB.config || {};
    const s = (ds && ds.settings) || {};
    const service = Object.assign({}, C.service, s.service);
    const safety = Object.assign({}, C.safety, s.safety);
    // Fallbacks match the starter config: day starts at 4 am, doors open 11 am to 9 pm, sync target 60 s.
    return { service, safety, dayStartHour: isNum(service.dayStartHour) ? service.dayStartHour : 4, openHour: isNum(service.openHour) ? service.openHour : 11, closeHour: isNum(service.closeHour) ? service.closeHour : 21, syncTargetSec: isNum(s.syncTargetSec) ? s.syncTargetSec : C.syncTargetSec || 60 };
  };
  // Display name of an ingredient from the data, then from the built-in config, else the plain id.
  B.ingName = (ds, id) => {
    const a = ((ds && ds.ingredients) || []).find((i) => i && i.id === id) || (SB.config && SB.config.ingredientById && SB.config.ingredientById[id]);
    // A hidden counted-stock ingredient ("Portions of X") reads as the dish it counts, never as an ingredient.
    if (a && a.hidden && a.name) return String(a.name).replace(/^Portions of /, '');
    return a ? a.name : id;
  };
  // The whole ingredient record (cost, yield, limits) for an id, or null when nothing knows it.
  B.ingMeta = (ds, id) => ((ds && ds.ingredients) || []).find((i) => i && i.id === id) || (SB.config && SB.config.ingredientById && SB.config.ingredientById[id]) || null;
  /** Cache a derived value per prepared handle (one handle per refresh). */
  B.memoP = (fn) => {
    const wm = new WeakMap();
    return (p, ...rest) => {
      if (!p || typeof p !== 'object') return fn(p, ...rest);
      if (wm.has(p)) return wm.get(p);
      const v = fn(p, ...rest);
      wm.set(p, v);
      return v;
    };
  };
  /** "1.8 hours", "1 hour", "45 minutes" for a duration in hours (used in sentences, not in charts). */
  B.hoursWords = (h) => {
    if (!isNum(h)) return '';
    const a = Math.abs(h);
    if (a < 1) { const m = Math.round(a * 60); return m + ' ' + (m === 1 ? 'minute' : 'minutes'); }
    const r = Math.round(a * 10) / 10;
    return r + ' ' + (r === 1 ? 'hour' : 'hours');
  };

  /** Local epoch ms of a decimal hour (11.5 = 11:30) on the calendar day of `d` (a Date).
   *  Built with the Date constructor so a clock change cannot shift it. */
  const atHourOfDay = (d, hour) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hour), Math.round((hour - Math.floor(hour)) * 60), 0, 0).getTime();
  /**
   * How much of the span [startT, endT] fell inside opening hours, in milliseconds. A lockout or an 86 that
   * starts at 9:18 pm and ends at 10:30 am next day cost only the minutes the kitchen was open.
   * endT null means still going: it runs to capT (usually now).
   */
  B.openOverlapMs = (startT, endT, S, capT) => {
    if (!isNum(startT)) return 0;
    const end = isNum(endT) ? endT : isNum(capT) ? capT : startT;
    if (!(end > startT)) return 0;
    const openH = S && isNum(S.openHour) ? S.openHour : 11;
    const closeRaw = S && isNum(S.closeHour) ? S.closeHour : 21;
    const closeH = closeRaw <= openH ? closeRaw + 24 : closeRaw;
    // Start one day early so a span that began before midnight still meets the previous night's hours.
    const day = new Date(startT); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - 1);
    let total = 0;
    // At most 70 days are walked, so a bad date can never loop forever.
    for (let n = 0; n < 70; n++) {
      const o = atHourOfDay(day, openH), c = atHourOfDay(day, closeH);
      if (o >= end) break;
      total += Math.max(0, Math.min(end, c) - Math.max(startT, o));
      day.setDate(day.getDate() + 1);
    }
    return total;
  };
  /**
   * Groups per-menu-item spells (86s or lockouts) into events a person would recognize: one ingredient running
   * out takes several menu items off at once, so they become ONE row. Spells with the same day, reason and
   * ingredient that start within gapMs of each other merge. opts: {gapMs, S, nowMs}; with S the result also
   * carries openMs (the part inside opening hours). Oldest first.
   */
  B.clusterSpells = (spells, opts) => {
    const o = opts || {};
    // 10 minutes: spells closer together than this count as the same event.
    const gap = isNum(o.gapMs) ? o.gapMs : 10 * 60000;
    const byKey = new Map();
    (spells || []).forEach((s) => { const k = s.date + '|' + s.reason + '|' + (s.ing || s.menuId); const a = byKey.get(k) || []; a.push(s); byKey.set(k, a); });
    const out = [];
    byKey.forEach((arr) => {
      arr.sort((a, b) => a.startT - b.startT);
      let cur = null;
      arr.forEach((s) => {
        if (!cur || s.startT - cur.startT > gap) { cur = { date: s.date, reason: s.reason, ing: s.ing || null, startT: s.startT, endT: s.endT, items: [], names: [] }; out.push(cur); }
        if (cur.items.indexOf(s.menuId) < 0) { cur.items.push(s.menuId); cur.names.push(s.name); }
        if (s.endT === null || cur.endT === null) cur.endT = null; else cur.endT = Math.max(cur.endT, s.endT);
      });
    });
    const today = o.S && isNum(o.nowMs) ? U.serviceDate(o.nowMs, o.S.dayStartHour) : null;
    out.forEach((c) => {
      c.durationMs = c.endT === null ? null : c.endT - c.startT;
      if (!o.S) return;
      // A spell with no end on an earlier day only proves it lasted to closing time that day (the data may
      // simply stop there), so count it to closing time and flag it, rather than running it up to the present.
      let cap = o.nowMs;
      c.unfinished = c.endT === null;
      if (c.unfinished && today && c.date < today) { const d = new Date(B.dayMs(c.date)); cap = atHourOfDay(d, o.S.closeHour > o.S.openHour ? o.S.closeHour : o.S.closeHour + 24); c.cappedAtClose = true; }
      c.openMs = B.openOverlapMs(c.startT, c.endT, o.S, cap);
    });
    return out.sort((a, b) => a.startT - b.startT);
  };

  /** Reasons a batch was thrown away, in words an owner would say. */
  B.REASON = { expired: 'Held too long', temp: 'Out of temperature', cooling: 'Cooled too slowly', manual: 'Thrown out by hand', quality: 'Quality', fridgeDate: 'Past the fridge date', outTime: 'Out of the fridge too long', datemark: 'Past the date mark', other: 'Other reason' };
  // Owner wording for a discard reason; an unknown reason is tidied up instead of shown raw.
  B.reasonWord = (r) => B.REASON[r] || (r ? String(r).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Other reason');

  if (!g.document) return; // Node: the pure helpers are all the tests need
  const doc = g.document;
  const O = SB.office;
  const h = U.h;
  const ico = (name, size, o) => { try { return SB.icons.svg(name, Object.assign({ size: size || 20 }, o || {})); } catch (e) { return doc.createElement('span'); } };

  // ---- 2. Screen helpers shared by the three pages ----
  // Sets an element's text only when it differs, so unchanged text is never redrawn.
  const setText = (el, text) => { const t = text == null ? '' : String(text); if (el && el.textContent !== t) el.textContent = t; };
  B.setText = setText;

  /** Where the numbers on a card come from, in one line: the range, the channel (when it applies)
   *  and, only when they are mixed in, the sample days. */
  B.scopeText = (ctx, o) => {
    o = o || {};
    const F = ctx.filters; let ds = null;
    try { ds = ctx.dataset(); } catch (e) { /* ignore */ }
    const sample = ds && ds.counts ? ds.counts.sample : 0;
    const parts = [F.range.label];
    if (!o.noChannel && F.channel !== 'all') { const c = SB.config && SB.config.channelById && SB.config.channelById[F.channel]; parts.push(c ? c.name : F.channel); }
    // Sample days are only named when they are mixed in; otherwise every number is the owner's own.
    if (F.source === 'all' && sample > 0) parts.push('with sample days');
    return parts.join(', ');
  };

  /** Update the gray source line under a card title without rebuilding the card. */
  B.setSub = (slot, text) => { const el = slot && slot.el && slot.el.querySelector('.of-card-sub'); if (el) setText(el, text); };

  /** Put a control into the card's action area, ahead of the "View as table" button. */
  B.addAction = (slot, node) => {
    const a = slot && slot.el && slot.el.querySelector('.of-card-actions');
    if (!a || !node) return;
    a.insertBefore(node, a.firstChild);
    const head = slot.el.querySelector('.of-card-head'); if (head) head.hidden = false;
  };

  /** A labelled drop-down list. B.select({label, options:[{value,label}], value, onChange}) returns
   *  {el, select, get, set, setOptions(options, value?)}. */
  B.select = (o) => {
    const id = U.uid('obsel');
    const sel = h('select', { class: 'select ob-sel', id });
    const lab = h('label', { class: 'ob-ctl-l', for: id }, o.label || '');
    const wrap = h('div', { class: 'ob-ctl' }, lab, sel);
    if (o.hint) sel.setAttribute('title', o.hint);
    // The last option list drawn: an identical list is not rebuilt, which would close an open drop-down.
    let sig = null;
    const api = {
      el: wrap, select: sel,
      // The value currently picked in the list.
      get: () => sel.value,
      // Picks a value by its code without firing onChange.
      set(v) { if (v != null && sel.value !== String(v)) sel.value = String(v); },
      // Replaces the choices only if they changed, and keeps the pick when it is still there.
      setOptions(opts, value) {
        const s = JSON.stringify(opts);
        if (s !== sig) {
          sig = s; const keep = sel.value; U.clear(sel);
          opts.forEach((op) => sel.appendChild(h('option', { value: op.value }, op.label)));
          if (opts.some((op) => String(op.value) === keep)) sel.value = keep;
        }
        if (value != null) sel.value = String(value);
        sel.disabled = !opts.length;
      },
    };
    if (typeof o.onChange === 'function') sel.addEventListener('change', () => o.onChange(sel.value));
    if (o.options) api.setOptions(o.options, o.value);
    return api;
  };

  /** A segmented switch inside a card header. B.seg({label, options:[{id,label}], value, onChange})
   *  returns the element, which has getValue() and setValue(). */
  B.seg = (o) => {
    const el = SB.ui.segmented({ options: o.options, value: o.value, label: o.label, onChange: o.onChange });
    el.classList.add('ob-seg');
    return el;
  };

  /** A row of small facts: items [{k, label, value, note?, tone?}]. Built once, then edited in place. */
  B.stats = (host, opts) => {
    const ul = h('ul', { class: 'ob-stats' + (opts && opts.cls ? ' ' + opts.cls : '') });
    host.appendChild(ul);
    const nodes = new Map();
    return {
      el: ul,
      // Draws the facts. The list is rebuilt only when the keys change, otherwise the text is edited in place.
      set(items) {
        const keys = items.map((i) => i.k).join('|');
        if (ul.dataset.keys !== keys) {
          U.clear(ul); nodes.clear(); ul.dataset.keys = keys;
          items.forEach((i) => {
            const l = h('span', { class: 'ob-stat-l' }), v = h('span', { class: 'ob-stat-v num' }), n = h('span', { class: 'ob-stat-n' });
            const li = h('li', { class: 'ob-stat', dataset: { k: i.k } }, l, v, n);
            ul.appendChild(li); nodes.set(i.k, { li, l, v, n });
          });
        }
        items.forEach((i) => {
          const n = nodes.get(i.k); if (!n) return;
          setText(n.l, i.label); setText(n.v, i.value); setText(n.n, i.note || ''); n.n.hidden = !i.note;
          if (i.tone) n.li.dataset.tone = i.tone; else delete n.li.dataset.tone;
        });
      },
    };
  };

  /** The plain-words verdict block at the top of Safety and Stock.
   *  set({tone, title, body, extra?, action?:{label,onClick}}) fills it in place. */
  B.callout = (host, kit) => {
    const word = h('span', { class: 'ob-co-word' }), icon = h('span', { class: 'ob-co-icon', 'aria-hidden': 'true' });
    const title = h('p', { class: 'ob-co-title' }), body = h('p', { class: 'ob-co-body' }), extra = h('p', { class: 'ob-co-extra' });
    const act = h('div', { class: 'ob-co-act' });
    const el = h('div', { class: 'ob-callout', role: 'status', dataset: { tone: 'info' } },
      h('div', { class: 'ob-co-tone' }, icon, word), h('div', { class: 'ob-co-text' }, title, body, extra), act);
    host.appendChild(el);
    let lastIcon = '', lastAct = '';
    return {
      el,
      // Fills in the verdict. Icon and button are rebuilt only when they change, so focus survives a refresh.
      set(v) {
        const t = (kit.tone && kit.tone[v.tone]) || { icon: 'info', word: 'Note' };
        el.dataset.tone = v.tone || 'info';
        setText(word, v.word || t.word);
        if (lastIcon !== t.icon) { lastIcon = t.icon; U.clear(icon); icon.appendChild(ico(t.icon, 22)); }
        setText(title, v.title); setText(body, v.body); setText(extra, v.extra || ''); extra.hidden = !v.extra;
        const key = v.action ? v.action.label : '';
        if (key !== lastAct) {
          lastAct = key; U.clear(act);
          // The button is rebuilt only when its label changes, so a refresh does not steal keyboard focus.
          if (v.action) act.appendChild(kit.button({ label: v.action.label, icon: v.action.icon, onClick: () => { if (v.action.onClick) v.action.onClick(); } }));
        }
        act.hidden = !v.action;
      },
    };
  };

  /** A <p class="ob-src"> source line. */
  B.src = (text) => h('p', { class: 'ob-src' }, text);

  /** Wrap a callback so a failure inside never takes the page down (it is logged once). */
  const warned = new Set();
  B.safe = (what, fn) => {
    try { return fn(); } catch (e) {
      if (!warned.has(what)) { warned.add(what); try { console.error('[smokebox] office B: ' + what, e); } catch (x) { /* ignore */ } }
      return undefined;
    }
  };

  // ---- 3. Sales and money ----
  if (!O || typeof O.registerPage !== 'function') return;

  // Builds the Cooked yield section of the Sales and money page (the yield chart, the cost of a wrong yield and the what-if panel) and returns the parts the page result needs.
  function buildYieldSection(env) {
    const { page, scope, yieldPrimary, fmt, cleanups, st, M, ctx } = env;
    /* ---------------------------------------------------------------- yield */
    page.section('Cooked yield', 'Cooked meat loses weight while it cooks and while it waits. Pricing it at a fixed yield can quietly under- or over-charge every plate.');
    const yieldSection = page.lastSection;

    const yieldCard = page.card({
      type: 'bar', span: 7, title: 'Cooked yield: assumed, modeled and real', sub: scope(),
      caption: 'How far the static yield you price with sits from the Texas A&M model and from what your own weighed batches really gave.',
      empty: { title: 'Nothing to compare yet', body: 'Your main cooked-ahead meat needs a recorded cost to compare yields. Batches that are weighed raw and cooked add the real figure.', icon: 'scale' },
      // Up to three bars: the fixed yield, the Texas A&M model and your weighed batches (two or more needed).
      spec: (p) => {
        const y = yieldPrimary(p);
        if (!y) return null;
        const rows = [['Static assumption', y.staticYield], ['Texas A&M model', y.modelYield], ['Your weighed batches', y.realisedYield]].filter((r) => isNum(r[1]));
        if (rows.length < 2) return null;
        return {
          orient: 'h', categories: rows.map((r) => r[0]), sort: 'none', labels: 'all', format: 'pct100', emphasis: rows.length - 1,
          series: [{ id: 'yield', name: 'Cooked yield', values: rows.map((r) => r[1] * 100) }],
          height: 70 * rows.length + 60,
          ariaLabel: 'Bar chart comparing cooked yield: ' + rows.map((r) => r[0] + ' ' + fmt.pct(r[1], 1)).join(', ') + '.',
        };
      },
    });

    // Under the yield chart: what each bar is and where its number comes from.
    const yieldKey = h('ul', { class: 'ob-sentences ob-sentences--card ob-keys', 'aria-label': 'What each bar means', 'data-k': 'yield-key' });
    const yieldBody = yieldCard.el.querySelector('.of-card-body');
    yieldBody.appendChild(yieldKey);
    let lastKey = '';
    // Writes one line per bar saying what it is and where its number comes from; skips the redraw if unchanged.
    function paintYieldKey(p) {
      const y = yieldPrimary(p), YM = (SB.config && SB.config.yieldModel) || {};
      const lines = [];
      if (y) {
        if (isNum(y.staticYield)) lines.push('Static assumption, ' + fmt.pct(y.staticYield, 0) + ': the fixed yield on file for ' + y.name.toLowerCase() + '. A starter estimate: confirm it with your own weighed batches.');
        if (isNum(y.modelYield)) lines.push('Texas A&M model, ' + fmt.pct(y.modelYield, 1) + ': the research regression at ' + (YM.defaultTempC || 85) + ' \u00B0C finish and ' + (YM.defaultHoldH || 2) + ' hours held. A starter model.');
        lines.push(isNum(y.realisedYield) ? 'Your weighed batches, ' + fmt.pct(y.realisedYield, 1) + ': ' + y.batches + ' ' + B.plural(y.batches, 'batch', 'batches') + ' in this range, ' + fmt.g(y.rawG) + ' raw became ' + fmt.g(y.cookedG) + ' cooked.' : 'Your weighed batches: none in this range. Weigh the raw and the cooked meat to add this bar.');
      }
      const sig = lines.join('|');
      if (sig !== lastKey) { lastKey = sig; U.clear(yieldKey); lines.forEach((t) => yieldKey.appendChild(h('li', null, t))); }
      yieldKey.hidden = !lines.length;
    }
    paintYieldKey(ctx.prepared());

    const costOfWrong = page.panel({
      span: 5, title: 'What a fixed yield costs you', sub: scope(),
      caption: 'The real price of a cooked kilogram of your main cooked-ahead meat, and how wrong a fixed yield would have made it.',
      // Builds the big sentence, the three cost figures and the source line; update repaints them in place.
      render: (body, p0) => {
        const big = h('p', { class: 'ob-bigline', 'data-k': 'misprice' });
        const detail = h('p', { class: 'ob-text', 'data-k': 'misprice-detail' });
        const stats = B.stats(body, { cls: 'ob-stats--3' });
        const src = B.src('');
        body.insertBefore(big, body.firstChild); body.insertBefore(detail, stats.el); body.appendChild(src);
        // Shows the off-by sentence and the three per-kilogram costs for the current range.
        const paint = (p) => {
          const y = yieldPrimary(p);
          if (!y) {
            setText(big, 'Yield cannot be compared yet.');
            setText(detail, 'This needs a cost per kilogram and a range with weighed batches. Nothing is guessed in the meantime.');
            stats.set([]); setText(src, ''); src.hidden = true; return;
          }
          src.hidden = false;
          const name = y.name.toLowerCase();
          const err = y.staticCostErr;
          if (isNum(err)) {
            // A tiny gap prints as "less than 0.1" so the sentence never claims an exact 0.0 percent.
            const abs = Math.abs(err) * 100;
            setText(big, 'If you had priced ' + name + ' with the static yield you would have been off by ' + (abs < 0.05 ? 'less than 0.1' : abs.toFixed(1)) + '%.');
            setText(detail, 'The static ' + fmt.pct(y.staticYield, 0) + ' yield puts ' + name + ' at ' + fmt.money(perW(y.staticCostPerCookedKg), 2) + ' per cooked ' + wWord() + '. The true figure is ' + fmt.money(perW(y.trueCostPerCookedKg), 2) + ' per cooked ' + wWord() + ', so the static yield ' + (err > 0 ? 'overstates' : err < 0 ? 'understates' : 'matches') + ' the cost.');
          } else {
            setText(big, 'The cost of ' + name + ' per cooked ' + (wWord() === 'lb' ? 'pound' : 'kilogram') + ' could not be worked out.');
            setText(detail, 'A raw cost per kilogram is needed for this comparison.');
          }
          stats.set([
            { k: 'static', label: 'Static ' + (isNum(y.staticYield) ? fmt.pct(y.staticYield, 0) : ''), value: isNum(y.staticCostPerCookedKg) ? fmt.money(perW(y.staticCostPerCookedKg), 2) : 'Not known', note: 'per cooked ' + wWord() },
            { k: 'model', label: 'Model ' + (isNum(y.modelYield) ? fmt.pct(y.modelYield, 1) : ''), value: isNum(y.modelCostPerCookedKg) ? fmt.money(perW(y.modelCostPerCookedKg), 2) : 'Not known', note: 'per cooked ' + wWord() },
            { k: 'real', label: 'Your batches ' + (isNum(y.realisedYield) ? fmt.pct(y.realisedYield, 1) : ''), value: isNum(y.realisedCostPerCookedKg) ? fmt.money(perW(y.realisedCostPerCookedKg), 2) : 'No weighed batches', note: isNum(y.realisedCostPerCookedKg) ? 'per cooked ' + wWord() : 'weigh raw and cooked to add this' },
          ]);
          setText(src, y.truthSource === 'realised'
            ? 'True cost per cooked ' + wWord() + ': ' + fmt.money(perW(y.trueCostPerCookedKg), 2) + ', from ' + y.batches + ' weighed ' + B.plural(y.batches, 'batch', 'batches') + ' (' + fmt.g(y.rawG) + ' raw became ' + fmt.g(y.cookedG) + ' cooked). Raw cost ' + fmt.money(perW(y.costPerKgRaw), 2) + ' per ' + wWord() + ' is a starter figure.'
            : 'True cost per cooked ' + wWord() + ': ' + (isNum(y.trueCostPerCookedKg) ? fmt.money(perW(y.trueCostPerCookedKg), 2) : 'not known') + ', from the Texas A&M model because no batch in this range was weighed. Raw cost is a starter figure.');
        };
        paint(p0);
        return { update: paint };
      },
    });

    /* ---------------------------------------------------------------- what-if */
    const whatIf = page.panel({
      span: 12, title: 'Try it: what would a different cook do to the yield?',
      sub: 'Based on published brisket cooking research; a starting guess, confirm against your own weighed batches',
      caption: 'Slide the end temperature and the hold time to see what the meat is worth after cooking. A hotter finish or a longer hold means less meat on the board.',
      // Builds the three steppers and the result tiles; any stepper change repaints the result at once.
      render: (body, p0) => {
        // The +5 and -5 buttons need room: on a narrow phone only the plain minus and plus are shown,
        // at full touch size.
        const big = (g.innerWidth || 1280) >= 520;
        const mkStep = (o) => {
          const el = SB.ui.stepper(o);
          cleanups.push(() => { try { el.destroy(); } catch (e) { /* ignore */ } });
          return el;
        };
        // End temperature, 75 to 90 C: the range the starter brisket model is meant for.
        const sT = mkStep({ label: 'End temperature', value: st.endpointC, min: 75, max: 90, step: 1, bigStep: big ? 5 : undefined, unit: '\u00B0C', onChange: (v) => { st.endpointC = v; paint(); } });
        // Hold time in the cabinet, 0 to 3 hours in quarter-hour steps.
        const sH = mkStep({ label: 'Hold time', value: st.holdH, min: 0, max: 3, step: 0.25, bigStep: big ? 1 : undefined, unit: 'h', onChange: (v) => { st.holdH = v; paint(); } });
        // Raw weight put in to cook, 1 to 100 kg in half-kilogram steps (weights stay in g or kg).
        const sW = mkStep({ label: 'Raw weight', value: st.rawKg, min: 1, max: 100, step: 0.5, bigStep: big ? 5 : undefined, unit: 'kg', onChange: (v) => { st.rawKg = v; paint(); } });
        // Puts a visible label above a control so each stepper has a name on screen.
        const fld = (label, node) => h('div', { class: 'ob-ctl ob-ctl--step' }, h('span', { class: 'ob-ctl-l' }, label), node);
        const controls = h('div', { class: 'ob-wi-ctl' }, fld('End temperature, 75 to 90 \u00B0C', sT), fld('Hold time, 0 to 3 hours', sH), fld('Raw weight put in to cook', sW));
        // One result tile: returns its list item and the two text spans to fill in later.
        const out = (k, label) => { const v = h('span', { class: 'ob-stat-v num', 'data-out': k }), n = h('span', { class: 'ob-stat-n' }); return { li: h('li', { class: 'ob-stat' }, h('span', { class: 'ob-stat-l' }, label), v, n), v, n }; };
        const oHot = out('hot', 'Hot yield'), oChill = out('chilled', 'Chilled yield'), oCooked = out('cooked', 'Cooked weight'), oCost = out('cost', 'True cost per cooked ' + wWord());
        const outs = h('ul', { class: 'ob-stats ob-stats--4', 'aria-live': 'polite', 'aria-label': 'What-if result' }, oHot.li, oChill.li, oCooked.li, oCost.li);
        const vs = h('p', { class: 'ob-text', 'data-out': 'vs' });
        const name = h('p', { class: 'ob-src' });
        body.append(controls, outs, vs, name);
        const YM = (SB.config && SB.config.yieldModel) || { chilledDelta: 2.1, chilledFloor: 45 };
        // Raw cost per kg and static yield: from the main comparison, else from the ingredient record.
        function rawCost() {
          const y = yieldPrimary(ctx.prepared());
          if (y && isNum(y.costPerKgRaw)) return { cost: y.costPerKgRaw, name: y.name, staticY: y.staticYield };
          return { cost: null, name: 'the main cooked-ahead meat', staticY: null };
        }
        // Runs the thermal model with the three stepper values and rewrites every result line.
        function paint() {
          const rc = rawCost();
          const rawG = st.rawKg * 1000;
          // hotPct and chilledPct from thermal() are 0 to 100, unlike the fractions elsewhere.
          const t = M.thermal({ endpointC: st.endpointC, holdH: st.holdH, rawG, costPerKgRaw: rc.cost });
          setText(oHot.v, t.hotPct.toFixed(1) + '%'); setText(oHot.n, 'of raw weight, straight from cooking');
          setText(oChill.v, t.chilledPct.toFixed(1) + '%'); setText(oChill.n, 'after chilling overnight');
          const cg = isNum(t.cookedG) ? Math.round(t.cookedG) : null;
          setText(oCooked.v, cg === null ? '-' : fmt.g(cg)); setText(oCooked.n, cg === null ? '' : fmt.g(cg) + ' from ' + fmt.g(rawG) + ' raw');
          setText(oCost.v, isNum(t.trueCostPerCookedKg) ? fmt.money(perW(t.trueCostPerCookedKg), 2) : 'Not known'); setText(oCost.n, isNum(rc.cost) ? 'raw cost ' + fmt.money(perW(rc.cost), 2) + ' per ' + wWord() : 'no raw cost recorded');
          if (isNum(rc.staticY) && cg !== null) {
            const sg = Math.round(rawG * rc.staticY);
            const diff = cg - sg;
            setText(vs, 'The static ' + fmt.pct(rc.staticY, 0) + ' yield would give ' + fmt.g(sg) + ' cooked from the same ' + fmt.g(rawG) + ' raw' + (isNum(rc.cost) ? ' and a cost of ' + fmt.money(perW(rc.cost / rc.staticY), 2) + ' per cooked ' + wWord() : '') + '. This cook gives ' + fmt.g(Math.abs(diff)) + (diff >= 0 ? ' more' : ' less') + '.');
          } else setText(vs, '');
          setText(name, 'Source: Texas A&M regression, hot-hold yield; starter model, confirm against your own weighed batches. Chilled yield is the hot yield minus ' + YM.chilledDelta + ' points, never below ' + YM.chilledFloor + '%.');
        }
        paint();
        // update repaints from the live brisket cost; destroy removes the stepper listeners.
        return { update: () => paint(), destroy: () => { cleanups.splice(0).forEach((f) => f()); } };
      },
    });

    /* ---------------------------------------------------------------- end of day */
    page.panel({
      span: 12, title: 'End of day', sub: 'When service is over',
      // Builds the explanation and the button that opens the Close the day sheet.
      render: (body) => {
        const help = SB.guide && SB.guide.link ? SB.guide.link('closing-the-day', 'closing the day') : null;
        body.append(h('p', { class: 'ob-text' }, 'Close the day when the last order is paid. You get today\'s totals by cash, card and other, a cash-in-the-drawer line, a backup button and a page to print.', help ? h('span', null, ' ', help) : null),
          h('button', { type: 'button', class: 'btn btn-primary', 'data-k': 'close-day', onClick: () => { if (O.openCloseDay) O.openCloseDay(); } }, 'Close the day'));
        // The address #/office/money?close=1 opens the sheet straight away.
        if (O.maybeOpenCloseDay) O.maybeOpenCloseDay();
        return {};
      },
    });
    return { yieldSection, yieldCard, paintYieldKey, costOfWrong, whatIf };
  }

  // Builds the Margin by item section of the Sales and money page (the margin chart with its three readings and the list of items with no recorded cost) and returns the two cards the page result keeps.
  function buildMarginSection(env) {
    const { page, scope, st, M, fmt, kit, itemRows, ctx } = env;
    /* ---------------------------------------------------------------- margin */
    page.section('Margin by item', 'What each item leaves after ingredients. Items with no recorded cost are listed on the right, never shown as zero.');
    // The three ways to read margin: which number to take from each row, how to print it, and the label words.
    const MARGIN = {
      // Margin of one portion: menu price minus ingredient cost.
      unit: { word: 'per portion', value: (r) => r.marginPerUnit, format: 'money', title: 'Margin per portion' },
      // Margin summed over everything sold in the range.
      total: { word: 'in total', value: (r) => r.margin, format: 'money', title: 'Total margin' },
      // Margin as a fraction of the menu price (0 to 1).
      pct: { word: 'as a share of menu price', value: (r) => r.marginPct, format: 'pct', title: 'Margin as a share of price' },
    };
    const marginCard = page.card({
      type: 'bar', span: 8, title: 'Margin by item', sub: scope(),
      caption: 'The items that earn the most for every one you sell, and the popular ones that earn little. Per portion is the fairest comparison.',
      empty: { title: 'No item has a recorded cost yet', body: 'Margin needs an ingredient cost on the menu item. Once a cost is recorded and the item sells, it appears here.', icon: 'dollar' },
      // Top 12 items by the picked margin; items with no recorded cost are left out, never counted as zero.
      spec: (p) => {
        const m = MARGIN[st.marginBy] || MARGIN.unit;
        const rows = M.marginByItem(p).filter((r) => isNum(m.value(r)));
        if (!rows.length) return null;
        const top = rows.slice().sort((a, b) => m.value(b) - m.value(a)).slice(0, 12);
        // Prints a margin value the way the chosen switch shows it, for the screen-reader text.
        const fv = (v) => (m.format === 'pct' ? fmt.pct(v, 0) : fmt.money(v, 2));
        return {
          orient: 'h', categories: top.map((r) => r.name), sort: 'none', labels: 'all', format: m.format,
          series: [{ id: 'margin', name: m.title, values: top.map((r) => m.value(r)) }],
          height: Math.max(170, 32 * top.length + 40),
          ariaLabel: 'Bar chart of margin ' + m.word + ' for ' + top.length + ' items with a recorded cost. ' + top[0].name + ' is highest at ' + fv(m.value(top[0])) + '.',
        };
      },
    });
    // Three-way switch (per portion, total, percent of price); only this card redraws.
    B.addAction(marginCard, B.seg({ label: 'Show margin', value: st.marginBy, options: [{ id: 'unit', label: 'Per portion' }, { id: 'total', label: 'Total' }, { id: 'pct', label: 'Percent of price' }], onChange: (id) => { st.marginBy = id; marginCard.update(ctx.prepared(), ctx); } }));

    const noCost = page.panel({
      span: 4, title: 'Cost not recorded', sub: scope(),
      caption: 'Items that sell but have no cost on file. Their margin is unknown, so they stay out of the margin chart and the food cost figure.',
      // Builds the cost-not-recorded list once; update repaints it only when the list really changed.
      render: (body, p0) => {
        const list = h('ul', { class: 'ob-list', 'aria-label': 'Items with no recorded cost' });
        const none = h('p', { class: 'ob-note', hidden: true });
        // Opens the Menu, prices and shop page, where a missing cost is entered.
        const go = kit.button({ label: 'Open Menu, prices and shop', icon: 'sliders', onClick: () => ctx.navigate('data') });
        const goWrap = h('div', { class: 'ob-actions' }, go);
        // How much of what sold the Food cost tile really covers, since it leaves out items with no cost.
        const cov = h('p', { class: 'ob-note', hidden: true });
        body.append(cov, list, none, goWrap);
        let last = '';
        // Lists items that sold with no cost, then items whose cost covers only part of their sales.
        const paint = (p) => {
          const rows = itemRows(p).filter((r) => r.sold > 0 && (r.cost === null || r.costCoverage === 0)).sort((a, b) => b.sold - a.sold);
          const partial = itemRows(p).filter((r) => r.sold > 0 && r.cost !== null && isNum(r.costCoverage) && r.costCoverage < 1);
          // A signature of what the list shows: if it is unchanged nothing is rebuilt, so there is no flicker.
          const fc = M.foodCostPct(p), share = fc && isNum(fc.coverage) ? fc.coverage : null;
          const sig = JSON.stringify([rows.map((r) => [r.menuId, r.sold]), partial.map((r) => [r.menuId, r.costCoverage]), itemRows(p).length, share]);
          if (sig === last) return; last = sig;
          cov.hidden = !(share !== null && share < 0.995 && share > 0);
          if (!cov.hidden) setText(cov, 'The Food cost figure at the top covers ' + fmt.pct(share, 0) + ' of the priced items sold. The rest have no cost on file, so the real food cost is not known for them.');
          U.clear(list);
          rows.forEach((r) => list.appendChild(h('li', { class: 'ob-li' },
            h('span', { class: 'ob-li-n' }, r.name),
            h('span', { class: 'ob-li-v' }, h('span', { class: 'ob-tag', dataset: { tone: 'warn' } }, 'Cost not recorded'), h('span', { class: 'num ob-li-s' }, fmt.num(r.sold, 0) + ' sold')))));
          partial.forEach((r) => list.appendChild(h('li', { class: 'ob-li' },
            h('span', { class: 'ob-li-n' }, r.name),
            h('span', { class: 'ob-li-v' }, h('span', { class: 'ob-tag', dataset: { tone: 'info' } }, 'Cost on ' + fmt.pct(r.costCoverage, 0) + ' of sales'), h('span', { class: 'num ob-li-s' }, fmt.num(r.sold, 0) + ' sold')))));
          const total = itemRows(p).length;
          list.hidden = !rows.length && !partial.length;
          none.hidden = !!(rows.length || partial.length);
          setText(none, total ? 'Every item that sold has a recorded cost.' : 'Nothing has sold in this range yet, so there is nothing to check.');
          goWrap.hidden = !rows.length;
        };
        paint(p0);
        return { update: paint };
      },
    });

    noCost.el.style.alignSelf = 'start'; // a short list should not stretch to the height of the margin chart
    return { marginCard, noCost };
  }

  // Builds the What sells and what it earns section of the Sales and money page (top items, sales by hour, by order type and cost of goods) and returns the four cards the page result keeps.
  function buildSellsSection(env) {
    const { page, scope, st, itemRows, salesOf, fmt, M, ctx } = env;
    /* ---------------------------------------------------------------- what sells */
    // WATCH OUT: two bases live on this page. Sales by hour and by channel come from paid orders, like the Sales
    // tile. Top items and food cost can only come from finished food at menu price, so they say "menu value".
    page.section('What sells and what it earns', 'Sales by hour and by channel come from paid orders, like the Sales figure at the top. Top items and food cost use the menu price of finished food, before discounts and whether paid yet or not, so their totals can differ from Sales.');

    const topCard = page.card({
      type: 'bar', span: 6, title: 'Top items', sub: scope(),
      caption: 'Whether your best sellers are also your best earners. Switch between how many were sold and their menu value (menu price times number sold, before discounts).',
      empty: { title: 'No sales in this range yet', body: 'Finished tickets with priced items fill this chart. Take and finish an order on the kitchen board, or pick a longer range.', icon: 'chart-bar' },
      // Top 10 items by the picked measure; items with no sales are left out.
      spec: (p) => {
        const by = st.itemsBy;
        const rows = itemRows(p).filter((r) => isNum(by === 'sold' ? r.sold : r.revenue) && (by === 'sold' ? r.sold : r.revenue) > 0);
        if (!rows.length) return null;
        const top = rows.slice().sort((a, b) => (by === 'sold' ? b.sold - a.sold : b.revenue - a.revenue)).slice(0, 10);
        const word = by === 'sold' ? 'number sold' : 'menu value';
        return {
          orient: 'h', categories: top.map((r) => r.name), sort: 'none', labels: 'all', format: by === 'sold' ? 'int' : 'money',
          series: [{ id: by, name: by === 'sold' ? 'Sold' : 'Menu value', values: top.map((r) => (by === 'sold' ? r.sold : r.revenue)) }],
          height: Math.max(170, 32 * top.length + 40),
          ariaLabel: 'Bar chart of the ' + top.length + ' top items by ' + word + '. ' + top[0].name + ' leads with ' + (by === 'sold' ? fmt.num(top[0].sold, 0) + ' sold' : fmt.money(top[0].revenue, 0) + ' in menu value') + '.',
        };
      },
    });
    // Sold or Menu value switch: only this card redraws.
    B.addAction(topCard, B.seg({ label: 'Rank items by', value: st.itemsBy, options: [{ id: 'sold', label: 'Sold' }, { id: 'revenue', label: 'Menu value' }], onChange: (id) => { st.itemsBy = id; topCard.update(ctx.prepared(), ctx); } }));

    const hourCard = page.card({
      type: 'bar', span: 6, title: 'Sales by hour of the day', sub: scope(),
      caption: 'The hours that pay the bills. Staff, prep and the second cook wave should line up with the tallest bars.',
      empty: { title: 'No hourly sales yet', body: 'Paid orders fill this chart, one bar per hour of the day they were paid.', icon: 'chart-bar' },
      // One bar per hour of the day from paid orders, so the bars add up to the Sales tile; empty until some hour has sales.
      spec: (p) => {
        const rows = salesOf(p).byHour;
        if (!rows.length || !rows.some((r) => r.net > 0)) return null;
        const peak = rows.reduce((a, r) => (r.net > a.net ? r : a), rows[0]);
        return {
          orient: 'v', categories: rows.map((r) => r.label), sort: 'none', format: 'money',
          series: [{ id: 'sales', name: 'Sales', values: rows.map((r) => r.net) }],
          height: 270,
          ariaLabel: 'Bar chart of sales for each hour of the day. The busiest hour is ' + peak.span + ' with ' + fmt.money(peak.net, 0) + '.',
        };
      },
    });

    const chanCard = page.card({
      type: 'bar', span: 6, title: 'Average order by channel', sub: scope(),
      caption: 'Which way of ordering brings the biggest orders: sales on paid orders divided by the number of them, like the Average order tile. A low bar is a channel where guests add little to the order.',
      empty: { title: 'No paid orders yet', body: 'Paid orders fill this chart, one bar per order channel.', icon: 'chart-bar' },
      // One bar per order channel from paid orders, with a line at the all-channel average when there is more than one.
      spec: (p) => {
        const s = salesOf(p);
        const rows = (s.byChannel || []).filter((r) => isNum(r.avg));
        if (!rows.length) return null;
        const lead = rows.slice().sort((a, b) => b.avg - a.avg)[0];
        return {
          orient: 'h', categories: rows.map((r) => r.name), sort: 'none', labels: 'all', format: 'money',
          series: [{ id: 'avg', name: 'Average order', values: rows.map((r) => r.avg) }],
          refLines: isNum(s.avgCheck) && rows.length > 1 ? [{ value: s.avgCheck, label: 'All channels ' + fmt.money(s.avgCheck, 2), tone: 'muted' }] : [],
          height: Math.max(150, 46 * rows.length + 40),
          ariaLabel: 'Bar chart of the average paid order for each order channel. ' + lead.name + ' is highest at ' + fmt.money(lead.avg, 2) + '.',
        };
      },
    });

    const costCard = page.card({
      type: 'line', span: 6, title: 'Food cost by day', sub: scope(),
      caption: 'Whether ingredients are eating a bigger share of the menu price. The shaded band is the 28 to 35% range many restaurants aim for, a rule of thumb and not your target; days above it need a look at portions, waste or prices. A day with very few sales is left out.',
      empty: { title: 'No food cost to show yet', body: 'Days with sales whose items have a recorded cost fill this line. Items with no cost are left out, never counted as free.', icon: 'chart-line' },
      spec: (p) => {
        const fc = M.foodCostPct(p);
        // A day with only a handful of sales (today so far, or a day the doors were barely open) gives a
        // misleading percentage, so days under a quarter of the usual day's sales are left out of the line.
        const days = (fc.byDay || []).filter((d) => isNum(d.costPct) && isNum(d.revenue));
        const usual = B.median(days.map((d) => d.revenue));
        const pts = days.filter((d) => !(usual > 0) || d.revenue >= usual * 0.25).map((d) => [U.fmtDateShort(d.date), d.costPct]);
        if (!pts.length) return null;
        return {
          series: [{ id: 'cost', name: 'Food cost', points: pts, slot: 1 }],
          x: { type: 'cat', label: 'Day' }, y: { format: 'pct', zero: false },
          bandY: [{ y0: 0.28, y1: 0.35, label: 'Rule of thumb, 28 to 35%' }],
          markers: pts.length <= 20 ? 'all' : 'auto', height: 270,
          ariaLabel: 'Line chart of food cost as a share of menu price for each day, from ' + fmt.pct(pts[0][1], 1) + ' to ' + fmt.pct(pts[pts.length - 1][1], 1) + ', with a shaded band for the 28 to 35 percent rule of thumb.',
        };
      },
    });
    return { topCard, hourCard, chanCard, costCard };
  }

  // Builds the Money collected section of the Sales and money page (the sales panel, its cards and the daily chart); every part it makes stays on the page.
  function buildTakingsSection(env) {
    const { page, scope, kit, salesOf, fmt, ctx } = env;
    /* ---------------------------------------------------------------- takings */
    page.section('Money collected', 'Sales are the food you sold after discounts. Add tax and tips and you get everything collected. Smokebox only records how an order was paid; it never charges a card.');

    page.panel({
      span: 5, title: 'Sales, tax and tips', sub: scope(),
      caption: 'Sales is the food sold less discounts, and it is the number at the top of this page. Tax and tips are on top of it, and all three together are what was collected.',
      // Builds the figure rows and the notes under them; update repaints them in place.
      render: (body, p0) => {
        const empty = kit.empty({ title: 'No paid orders in this range yet', body: 'Tap the Orders button on the board and pay an order, and the money shows up here. Take an order first if there is none to pay.', icon: 'dollar' }).el;
        const stats = B.stats(body, { cls: 'ob-stats--3' });
        const open = h('p', { class: 'ob-note' });
        body.append(empty, open);
        // Shows the figures, or the empty note when no order was paid in the range.
        const paint = (p) => {
          const s = salesOf(p);
          empty.hidden = s.checks > 0;
          if (!s.checks) stats.set([]);
          else stats.set([
            { k: 'checks', label: 'Orders paid', value: fmt.num(s.checks, 0), note: isNum(s.avgCheck) ? fmt.money(s.avgCheck, 2) + ' average order' : '' },
            { k: 'net', label: 'Sales', value: fmt.money(s.net, 2), note: s.discounts > 0 ? fmt.money(s.discounts, 2) + ' given as discounts' : 'before tax and tips' },
            { k: 'tax', label: 'Tax collected', value: fmt.money(s.tax, 2), note: s.tax > 0 ? '' : (isNum(B.settings(ctx.dataset()).service.taxRatePct) && B.settings(ctx.dataset()).service.taxRatePct > 0 ? 'No tax on these orders' : 'No tax rate is set') },
            { k: 'tips', label: 'Tips', value: fmt.money(s.tips, 2), note: isNum(s.tipPct) ? fmt.pct(s.tipPct, 0) + ' of sales' : '' },
            { k: 'all', label: 'Total collected', value: fmt.money(s.collected, 2), note: 'sales, tax and tips' },
          ]);
          const bits = [];
          if (s.open.orders) bits.push(s.open.orders + ' ' + U.plural(s.open.orders, 'order is', 'orders are') + ' still open, ' + fmt.money(s.open.value, 2) + ' of food not yet paid');
          if (s.voided) bits.push(s.voided + ' ' + U.plural(s.voided, 'order was', 'orders were') + ' voided');
          setText(open, bits.length ? bits.join('; ') + '.' : '');
          open.hidden = !bits.length;
        };
        paint(p0 || ctx.prepared());
        return { update: paint };
      },
    });

    page.card({
      type: 'bar', span: 7, title: 'Sales by day', sub: scope(),
      caption: 'Sales for each day, from the orders paid that day, before tax and tips (so less than the cash and card taken in). A short bar is a slow day or a day with orders still open.',
      empty: { title: 'No paid orders to chart yet', body: 'Each day with a paid order gets one bar.', icon: 'chart-bar' },
      // One bar per day with paid orders.
      spec: (p) => {
        const days = salesOf(p).byDay;
        if (!days.length) return null;
        const best = days.reduce((a, d) => (d.net > a.net ? d : a), days[0]);
        return {
          orient: 'v', categories: days.map((d) => d.label), sort: 'none', format: 'money',
          series: [{ id: 'net', name: 'Sales', values: days.map((d) => d.net) }],
          height: 270,
          ariaLabel: 'Bar chart of sales for each day. The best day is ' + best.label + ' with ' + fmt.money(best.net, 0) + '.',
        };
      },
    });

    page.card({
      type: 'bar', span: 5, title: 'Best day of the week', sub: scope(),
      caption: 'Each bar is the average sales on that weekday, over the days in this range that had paid orders. A day you were closed is not counted. It needs at least two weeks to compare days.',
      empty: { title: 'Needs at least two weeks to compare days', body: 'Pick Last 14 days or a longer range once you have two weeks of paid orders. With fewer days, one busy night would decide the answer.', icon: 'chart-bar' },
      // One bar per weekday, Monday first; null until the range holds two weeks.
      spec: (p) => {
        const wd = B.weekdayAverages(salesOf(p).byDay);
        if (!wd) return null;
        const shown = wd.filter((x) => x.avg !== null);
        if (!shown.length) return null;
        const best = shown.reduce((a, d) => (d.avg > a.avg ? d : a), shown[0]);
        return {
          orient: 'v', categories: shown.map((x) => x.name), sort: 'none', format: 'money',
          series: [{ id: 'avg', name: 'Average sales', values: shown.map((x) => x.avg) }],
          height: 270,
          ariaLabel: 'Bar chart of average sales for each weekday. The best day is ' + best.name + ' with ' + fmt.money(best.avg, 0) + ' on average.',
        };
      },
    });

    page.card({
      type: 'bar', span: 5, title: 'How guests paid', sub: scope(),
      caption: 'Cash, card and other, counting tax and tips. Cash is what should be in the drawer, apart from the starting float.',
      empty: { title: 'No payments yet', body: 'Each way of paying gets one bar once an order is paid.', icon: 'dollar' },
      // One bar per way of paying.
      spec: (p) => {
        const rows = salesOf(p).byMethod;
        if (!rows.length) return null;
        return {
          orient: 'h', categories: rows.map((r) => r.name), sort: 'none', labels: 'all', format: 'money',
          series: [{ id: 'paid', name: 'Collected', values: rows.map((r) => r.collected) }],
          height: Math.max(150, 46 * rows.length + 40),
          ariaLabel: 'Bar chart of the money collected by way of paying. ' + rows.slice().sort((a, b) => b.collected - a.collected)[0].name + ' is the largest.',
        };
      },
    });
  }

  // Builds the Sales and money page into the container and returns {update, destroy} for the frame.
  function render(container, ctx) {
    const kit = ctx.kit || (SB.office && SB.office.kit);
    if (!kit || typeof kit.page !== 'function') throw new Error('The back-office kit is not available (80-office-core.js).');
    const M = ctx.metrics || SB.metrics;
    const fmt = kit.fmt;
    const page = kit.page(container, ctx, { id: 'money' });
    const cleanups = [];
    // Picker state kept across refreshes. The what-if starts at 85 C, 2 hours and 10 kg (starter values).
    const st = { itemsBy: 'sold', marginBy: 'unit', endpointC: 85, holdH: 2, rawKg: 10 };
    // The gray source line under each card title: the range, the channel and whether sample data is in.
    const scope = () => B.scopeText(ctx);
    // Every card that was given the range text as its subtitle, so the text follows the range when it changes.
    const scoped = [];
    const scope0 = scope();
    const cardOf = page.card;
    // Wraps page.card to remember the cards whose subtitle is the range text.
    page.card = (o) => { const c = cardOf.call(page, o); if (o && o.sub === scope0) scoped.push(c); return c; };
    const panelOf = page.panel;
    // Wraps page.panel the same way for panels with a range subtitle.
    page.panel = (o) => { const c = panelOf.call(page, o); if (o && o.sub === scope0) scoped.push(c); return c; };

    /* ---------- derived values, one per prepared handle ---------- */
    // Items sold across all rows, or null when nothing sold, so the tile shows no number instead of 0.
    const soldTotal = (p) => { const rows = M.byItem(p); let n = 0; rows.forEach((r) => { if (isNum(r.sold)) n += r.sold; }); return rows.length ? n : null; };
    // A second prepared handle for the previous period; only the compare arrows on the tiles use it.
    const prevHandle = B.memoP((p) => {
      const c = M.compare(p);
      if (!c || !c.hasPrevious || !c.prevRange) return null;
      return M.prepare(ctx.dataset(), { from: c.prevRange.from, to: c.prevRange.to, channel: ctx.filters.channel, now: ctx.now() });
    });
    const itemRows = B.memoP((p) => M.byItem(p));
    // The main (brisket) yield comparison, or null when it cannot be worked out.
    const yieldPrimary = B.memoP((p) => { const yc = M.yieldComparison(p); return yc && yc.primary ? yc.primary : null; });

    const salesOf = B.memoP((p) => M.sales(p));
    page.headline();
    page.how('Sales is the food on paid orders, less discounts, before tax and tips. Collected is sales plus tax plus tips. An order counts on the day it was paid, and the day starts at the hour set in Menu, prices and shop (4 am to begin with). Open and voided orders are not counted. Average order is sales divided by paid orders. Food cost is ingredient cost as a share of menu price, counted only over items with a cost on file. Every figure is added up in whole cents from the paid orders themselves.');

    page.tiles([
      // The one main money figure: sales after discounts from paid orders (blank until an order is paid).
      { id: 'revenue', kpi: 'revenue', label: 'Sales', kind: 'money', good: 'higher', format: (v) => fmt.money(v, 0),
        // Sales after discounts for the range; blank when no order was paid.
        value: (p) => { const s = salesOf(p); return s.checks ? { value: s.net, spark: s.byDay.map((d) => d.net) } : null; },
        // The same figure for the previous period, or null when it had no paid orders.
        previous: (p) => { const q = prevHandle(p); const s = q ? salesOf(q) : null; return s && s.checks ? s.net : null; } },
      // Average paid order, before tax and tips, so it agrees with the Sales tile.
      { id: 'avgTicket', kpi: 'avgTicketValue', label: 'Average order', format: (v) => fmt.money(v, 2),
        // Sales divided by paid orders; blank when nothing is paid. The daily line is on the same paid basis.
        value: (p) => { const s = salesOf(p); return s.checks ? { value: s.avgCheck, spark: s.byDay.map((d) => (d.checks ? d.net / d.checks : null)) } : null; },
        // WATCH OUT: the ready-made avgTicketValue kpi is finished food at menu price, so the change arrow must come
        // from paid orders here too or it compares two different things.
        kind: 'money', good: 'higher',
        previous: (p) => { const q = prevHandle(p); const s = q ? salesOf(q) : null; return s && s.checks ? s.avgCheck : null; } },
      // Food cost as a share of menu price; blank with a plain note when no item has a recorded cost.
      { id: 'foodCost', kpi: 'foodCostPct', label: 'Food cost', format: (v) => fmt.pct(v, 1), noValue: 'Cost not recorded',
        // Cost share of the items that have a recorded cost; null when none do, never a fake zero.
        value: (p) => { const f = M.foodCostPct(p); return f && f.lines > 0 && isNum(f.costPct) ? f.costPct : null; } },
      // Items sold has no ready-made kpi, so it is summed here and compared with the previous period's handle.
      { id: 'items', label: 'Items sold', kind: 'count', good: 'neutral', format: (v) => fmt.num(v, 0),
        // Sum of all items sold in the range.
        value: (p) => soldTotal(p),
        // The same sum for the previous period, or null when there is none.
        previous: (p) => { const q = prevHandle(p); return q ? soldTotal(q) : null; } },
    ]);

    buildTakingsSection({ page, scope, kit, salesOf, fmt, ctx });

    const { topCard, hourCard, chanCard, costCard } = buildSellsSection({ page, scope, st, itemRows, salesOf, fmt, M, ctx });

    const { marginCard, noCost } = buildMarginSection({ page, scope, st, M, fmt, kit, itemRows, ctx });

    /* ---------------------------------------------------------------- dollars thrown away */
    page.section('Dollars thrown away', 'Food that was discarded, at the cooked cost recorded on each batch. Always the last 7 days against the 7 days before, whatever range is picked above.');
    const weeksOf = B.memoP((p) => M.discardWeeks(p, { now: ctx.now() }));
    page.panel({
      span: 12, title: 'This week against last week',
      caption: 'Look at the biggest line. If one product or one reason keeps showing up, cook less of it, check temperatures sooner, or cool it faster.',
      // Builds the sentence and the two lists (by product, by reason) once; update repaints them only when
      // the figures changed.
      render: (body, p0) => {
        const line = h('p', { class: 'ob-note ob-note--accent' });
        const prodList = h('ul', { class: 'ob-list', 'aria-label': 'Thrown away by product' });
        const reasonList = h('ul', { class: 'ob-list', 'aria-label': 'Thrown away by reason' });
        const cols = h('div', { class: 'ob-twocol' }, h('div', null, h('h3', { class: 'ob-h3' }, 'By product'), prodList), h('div', null, h('h3', { class: 'ob-h3' }, 'By reason'), reasonList));
        const sampleTag = h('span', { class: 'ob-tag', dataset: { tone: 'warn' }, hidden: true }, 'Includes sample data');
        body.append(line, sampleTag, cols);
        let last = '';
        // One list row: the name, this week's dollars (or "cost not recorded") and last week's for comparison.
        const row = (name, a, b) => h('li', { class: 'ob-li' },
          h('span', { class: 'ob-li-n' }, name),
          h('span', { class: 'ob-li-v' }, h('span', { class: 'num' }, a.cost > 0 ? fmt.money(a.cost, 2) : 'cost not recorded'), h('span', { class: 'num ob-li-s' }, fmt.g(a.g) + ' this week' + (a.cost > 0 && a.noCostCount > 0 ? ' (' + a.noCostCount + ' with no cost, not in the dollars)' : '') + ', ' + (b ? (b.cost > 0 ? fmt.money(b.cost, 2) : fmt.g(b.g)) : 'none') + ' last week')));
        // Fills one list from this week's rows, matching each to the same key last week.
        const fill = (ul, rows, lastRows, key, nameOf, none) => {
          U.clear(ul);
          if (!rows.length) { ul.appendChild(h('li', { class: 'ob-li' }, h('span', { class: 'ob-li-n' }, none))); return; }
          rows.forEach((r) => ul.appendChild(row(nameOf(r), r, lastRows.find((x) => x[key] === r[key]))));
        };
        // Redraws the sentence and lists from the discard ledger when it changed.
        const paint = (p) => {
          const w = weeksOf(p), sig = JSON.stringify(w);
          if (sig === last) return; last = sig;
          setText(line, M.discardSentence(w));
          fill(prodList, w.thisWeek.byProduct, w.lastWeek.byProduct, 'ing', (r) => r.name, 'Nothing thrown away this week.');
          fill(reasonList, w.thisWeek.byReason, w.lastWeek.byReason, 'reason', (r) => r.label, 'Nothing thrown away this week.');
          sampleTag.hidden = !(w.thisWeek.total.sampleCount || w.lastWeek.total.sampleCount);
        };
        paint(p0);
        return { update: paint };
      },
    });

    const { yieldSection, yieldCard, paintYieldKey, costOfWrong, whatIf } = buildYieldSection({ page, scope, yieldPrimary, fmt, cleanups, st, M, ctx });

    /* ---------------------------------------------------------------- page result */
    const slots = [topCard, hourCard, chanCard, costCard, marginCard, noCost, yieldCard, costOfWrong, whatIf];
    const yieldBlock = [yieldSection, yieldCard.el, costOfWrong.el, whatIf.el];
    // Shows the yield section only when cooked-ahead food is tracked and some ingredient has a yield to compare.
    const paintYieldVisible = (p) => {
      let on = true;
      try { on = SB.engine.moduleOn(SB.store.getState(), 'cookAhead') && !!yieldPrimary(p); } catch (e) { on = true; }
      yieldBlock.forEach((el) => { if (el) el.hidden = !on; });
    };
    return {
      // Runs on every refresh: keeps the card subtitles and the yield key current.
      update() {
        const s = scope();
        scoped.forEach((c) => B.setSub(c, s));
        paintYieldKey(ctx.prepared());
        paintYieldVisible(ctx.prepared());
      },
      // Runs when the page is left: removes the stepper listeners and drops the card list.
      destroy() {
        cleanups.splice(0).forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
        slots.length = 0;
      },
    };
  }

  O.registerPage('money', { title: 'Sales and money', icon: 'dollar', order: 4, render });
})(typeof globalThis !== 'undefined' ? globalThis : window);
