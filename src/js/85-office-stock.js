/*
 * WHAT THIS FILE IS: The "Stock and 86" back-office page: why one protein ran out, a plain cook-count
 * suggestion per protein, the sell-out clock, the stock level through a day, what 86 cost.
 * PARTS: 1 pure helpers, 2 numbers per refresh, 3 the story and the suggestions, 4 the page and its cards.
 * USES: 82-office-money.js (helpers), 80-office-core.js (the kit), 40-metrics.js.   USED BY: the office frame.
 * HONEST: suggestions come from the days in range (sample days are labeled), and refused order lines are
 * counted only where the app recorded them.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  if (!g.document) return;
  const U = SB.util;
  const O = SB.office;
  const B = SB.officeB;
  // True only for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  if (!O || typeof O.registerPage !== 'function') return;

  if (!B || typeof B.callout !== 'function') {
    // The shared helpers (82-office-money.js) did not load: say so on the page instead of showing a blank one.
    O.registerPage('stock', { title: 'Stock and 86', icon: 'package', order: 6, render() { throw new Error('The shared helpers for the Stock page (82-office-money.js) did not load.'); } });
    return;
  }
  const h = U.h;
  // 60 000 ms in a minute and 3 600 000 ms in an hour; weekday names; the words for why a food went off.
  const MIN = 6e4, HOUR = 36e5;
  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WHY = { stock: 'Ran out', manual: 'Turned off by hand', safety: 'Food safety' };
  const TOP_UP = 1; // hours before the usual sell-out that a top-up batch should be ready
  const PADDING = 1.1; // starter estimate, owner to confirm: cook 10% over typical demand so the last guests are not turned away
  const MIN_DAYS = 3; // fewer cooking days than this is too little to suggest a number

  // ---- 1. Pure helpers ----
  // Median share of a day's use that is already gone by `hour`, over days that did not sell out.
  // profiles = [{hours:[..], used:[..]}] with hours as the end of each service hour.
  function cumulativeShare(profiles, hour) {
    const shares = [];
    profiles.forEach((pr) => {
      const total = pr.used.reduce((a, b) => a + b, 0);
      if (!(total > 0)) return;
      let sum = 0;
      for (let i = 0; i < pr.hours.length; i++) if (pr.hours[i] <= hour) sum += pr.used[i];
      shares.push(sum / total);
    });
    return B.median(shares);
  }
  // Shared on SB.officeB so the share maths can be checked from the browser console.
  B.stockPure = { cumulativeShare };

  // Builds the What 86 cost section of the Stock page (how often and for how long food was taken off the menu) and returns the parts the page result needs.
  function buildCostSection(env) {
    const { page, base, M, scope, fmt, dayLabel, paintClockWords, ctx } = env;
    // ---------- what 86 cost ----------
    page.section('What 86 cost', 'Every time food was taken off the menu, and for how long it stayed off while the restaurant was open.');
    // Times (ms) of orders refused because an item was unavailable. The event does not say which item.
    const refusedTimes = B.memoP((p) => {
      const from = ctx.filters.range.from, to = ctx.filters.range.to;
      return (ctx.dataset().events || []).filter((e) => e && !e.reverted && e.type === 'ui_report' && e.report === 'itemUnavailable' && isNum(e.t) && e.t >= from && e.t < to).map((e) => e.t);
    });
    // The 86 spells grouped into events, with the open-hours part of each and the refused order lines that can
    // be pinned on it. A refusal counts for a spell only when exactly one food was off at that moment; the rest
    // are reported as not pinned down.
    const spellsOf = B.memoP((p) => {
      const b = base(p);
      const cl = B.clusterSpells(M.eightySixes(p), { S: b.S, nowMs: ctx.now() });
      const ev = refusedTimes(p);
      const recorded = ev.length > 0;
      let loose = 0;
      cl.forEach((c) => { c.refused = recorded ? 0 : null; });
      ev.forEach((t) => {
        const live = cl.filter((c) => c.startT <= t && (c.endT === null || t <= c.endT));
        const foods = new Set(live.map((c) => c.ing || c.items[0]));
        // Spells come sorted by start (B.clusterSpells), so overlapping spells of one food credit the one that began first.
        if (foods.size === 1) live[0].refused++; else loose++;
      });
      return { cl, recorded, loose, total: ev.length };
    });
    const spellTable = page.table({
      span: 12, title: 'Times food went off the menu', sub: scope,
      caption: 'Long spells at busy hours are the expensive ones. Only time inside opening hours counts. The last column counts order lines staff tried to add while the item was off, where the app recorded them.',
      empty: { title: 'Nothing was taken off the menu in opening hours', body: 'Each time food runs out, is turned off by hand or is locked out for safety, it is listed here with how long it stayed off while you were open.', icon: 'package' },
      columns: [
        { key: 'label', label: 'Day', sort: true, sortKey: 'date', nowrap: true },
        // Name, plus (on phones only) the reason and refused count, since those columns are hidden there.
        { key: 'what', label: 'What went off', sort: true, firstDir: 'asc', format: (v, r) => h('span', null, v, h('span', { class: 'ob-why-n' }, ', ' + r.why.toLowerCase() + (r.refused > 0 ? ', ' + fmt.num(r.refused, 0) + ' order ' + B.plural(r.refused, 'line', 'lines') + ' refused' : ''))) },
        { key: 'why', label: 'Why', sort: true, firstDir: 'asc', wideOnly: true },
        // Start time of the spell, shown as a clock time.
        { key: 'startT', label: 'From', align: 'right', sort: true, wideOnly: true, format: (v) => fmt.clock(v) },
        // Time off during opening hours; under a minute is said in words.
        { key: 'openMs', label: 'Off during opening hours', align: 'right', sort: true, format: (v) => (v < 60000 ? 'Under a minute' : fmt.ms(v)) },
        // Refused order lines; reads Not recorded when the app logged none in this range.
        { key: 'refused', label: 'Order lines refused', align: 'right', sort: true, wideOnly: true, format: (v) => (v === null ? 'Not recorded' : fmt.num(v, 0)) },
      ],
      defaultSort: 'openMs', defaultDir: 'desc', pageSize: 8,
      // Rows are the spells with some time inside opening hours, one per event.
      rows: (p) => spellsOf(p).cl.filter((c) => c.openMs > 0).map((c) => ({
        date: c.date, label: dayLabel(c.date), startT: c.startT, openMs: c.openMs, refused: c.refused,
        what: c.ing ? B.ingName(base(p).ds, c.ing) + (c.items.length > 1 ? ' (' + c.items.length + ' menu items)' : '') : c.names[0],
        why: WHY[c.reason] || 'Other',
      })),
    });
    spellTable.el.classList.add('ob-tbl');
    const spellNote = h('p', { class: 'ob-note', 'data-k': 'spell-note' });
    spellTable.el.querySelector('.of-card-body').appendChild(spellNote);

    paintClockWords(ctx.prepared());
    return { spellsOf, spellTable, spellNote };
  }

  // Builds the Stock through the day section of the Stock page (the stock curve for one food on one day with its day picker) and returns the parts the page result needs.
  function buildBurnSection(env) {
    const { page, scope, syncPick, st, burn, base, dayLabel, M, fmt, ingSlot, ingSel, daySel, ctx } = env;
    // ---------- stock through the day ----------
    page.section('Stock through the day', 'How the level in the cabinet moved for one food on one day.');
    const burnCard = page.card({
      type: 'line', span: 12, title: 'Stock level', sub: scope,
      caption: 'The line falls as plates go out and jumps when a batch lands. When it touches the red line the menu items made from it go 86. The gray line is your par.',
      empty: { title: 'No stock movements to show', body: 'Pick a day and a food that was cooked and sold. The chart fills as batches land in the cabinet and tickets use them.', icon: 'chart-line' },
      // Stock level of the picked food on the picked day, with the 86 line, par line, sold-out bands, labels.
      spec: (p) => {
        syncPick(p);
        if (!st.day || !st.ing) return null;
        const sb = burn(p, st.day, st.ing);
        const b = base(p);
        const name = B.ingName(b.ds, st.ing), lbl = dayLabel(st.day);
        if (!sb || !(sb.points && sb.points.length)) return { series: [], empty: 'No stock movements for ' + name + ' on ' + lbl + '. Nothing was cooked into the cabinet or used from it that day.', ariaLabel: 'Stock level of ' + name + ' on ' + lbl + ': no movements.' };
        const pts = sb.points.map((pt) => [pt.t, pt.g]);
        const lastT = pts[pts.length - 1][0];
        // Run to closing time, or to the last movement if that came after closing; today only runs to now.
        let endT = Math.max(isNum(sb.closeMs) ? sb.closeMs : lastT, lastT);
        if (st.day >= b.today) endT = Math.min(endT, Math.max(ctx.now(), lastT));
        if (endT > lastT) pts.push([endT, pts[pts.length - 1][1]]);
        const cl = B.clusterSpells(M.eightySixes(p).filter((s) => s.ing === st.ing && s.date === st.day && s.reason !== 'safety'));
        const bands = cl.map((c) => ({ x0: c.startT, x1: c.endT === null ? endT : Math.min(c.endT, endT), label: 'Sold out' })).filter((x) => x.x1 - x.x0 >= 5 * MIN);
        const refs = [];
        if (isNum(sb.thresholdG) && sb.thresholdG > 0) refs.push({ y: sb.thresholdG, label: 'Goes 86 at ' + fmt.g(sb.thresholdG), tone: 'bad' });
        if (isNum(sb.parG) && sb.parG > 0) refs.push({ y: sb.parG, label: 'Par ' + fmt.g(sb.parG), tone: 'muted' });
        // Label the sell-outs, and the batches that landed, except where a batch label would sit on top of a
        // sell-out label or on the par label, which is drawn at the right-hand end of its line. A phone is too
        // narrow for any of these labels; the story above the chart gives the time.
        const sold = cl.slice(0, 3), narrow = (g.innerWidth || 1280) < 520;
        const x0 = Math.min(pts[0][0], isNum(sb.openMs) ? sb.openMs : pts[0][0]);
        // True for a batch label that would sit on top of the par label at the right-hand end of the line.
        const nearPar = (pt) => isNum(sb.parG) && Math.abs(pt.g - sb.parG) < 0.12 * sb.parG && pt.t > endT - 0.2 * (endT - x0);
        const notes = narrow ? [] : sb.points.filter((pt) => (pt.kind === 'intake' || pt.kind === 'restock') && !nearPar(pt) && !sold.some((c) => Math.abs(c.startT - pt.t) < 40 * MIN)).slice(0, 6).map((pt) => ({ x: pt.t, y: pt.g, label: '+' + fmt.g(pt.d) }));
        if (!narrow) sold.forEach((c) => notes.push({ x: c.startT, y: isNum(sb.thresholdG) ? sb.thresholdG : 0, label: 'Went 86, ' + fmt.clock(c.startT), tone: 'bad' }));
        return {
          series: [{ id: 'level', name: name + ' in the cabinet', points: pts, slot: ingSlot(b, st.ing) }],
          x: { type: 'time', min: x0, max: endT }, y: { format: 'g', min: 0 },
          refLines: refs, bands, annotations: notes, markers: 'none', height: 320,
          ariaLabel: 'Line chart of the ' + name + ' stock level on ' + lbl + ', from ' + fmt.g(pts[0][1]) + ' to ' + fmt.g(pts[pts.length - 1][1]) + ', with a line where the menu items go 86 at ' + fmt.g(sb.thresholdG) + '.',
        };
      },
    });
    B.addAction(burnCard, ingSel.el);
    B.addAction(burnCard, daySel.el);
    return { burnCard };
  }

  // Builds the Sell-out clock section of the Stock page (one dot for the first sell-out of each protein on each day) and returns the parts the page result needs.
  function buildClockSection(env) {
    const { page, scope, st, refreshPicks, base, ingSlot, dayLabel, fmt } = env;
    // ---------- the sell-out clock ----------
    page.section('Sell-out clock', 'Each dot is the moment a protein went 86 on one day. The dashed line is closing time.');
    const clock = page.card({
      type: 'scatter', span: 12, title: 'When each protein went 86', sub: scope,
      caption: 'Dots near the closing line are fine. Dots in the early afternoon mean guests were turned away at the busiest part of the day; a day with no dot means everything lasted.',
      empty: { title: 'Nothing sold out', body: 'A dot appears here each time a protein goes 86 because it ran out or was turned off by hand. No dots in a busy range means the cook count is right.', icon: 'package' },
      // Clicking a dot picks that day and food, then redraws the story and the stock chart.
      onSelect: (sel) => {
        if (!sel || !isNum(sel.x)) return;
        st.ing = sel.series; st.day = U.dateKey(sel.x); st.picked = true;
        refreshPicks();
      },
      // One dot per sell-out, by day (across) and time of day (up), one series per protein.
      spec: (p) => {
        const b = base(p), so = b.so;
        if (!so.rows.length) return null;
        const names = {};
        so.proteins.forEach((x) => { names[x.ing] = x.name; });
        const series = so.proteins.filter((x) => x.days > 0).map((x) => ({
          id: x.ing, name: x.name, slot: ingSlot(b, x.ing),
          points: so.rows.filter((r) => r.ing === x.ing).map((r) => [B.dayMs(r.date), r.hour, dayLabel(r.date) + ', ' + names[r.ing] + ' (' + r.menuName + ')']),
        }));
        const first = so.days[0], last = so.days[so.days.length - 1];
        const early = so.rows.slice().sort((x, y) => y.hoursBeforeClose - x.hoursBeforeClose)[0];
        // The time axis is padded by dayWindow so a short range does not print the same date twice.
        return {
          series, x: Object.assign({ type: 'time', format: 'date' }, B.dayWindow(B.dayMs(first.date), B.dayMs(last.date))),
          y: { format: 'hour', min: b.S.openHour, max: b.S.closeHour + 1, label: 'Time of day' },
          refLines: [{ y: so.closeHour, label: 'Closing time, ' + U.fmtHour(so.closeHour), tone: 'muted' }], height: 320,
          ariaLabel: 'Scatter plot with one dot for each time a protein went 86, by day and time of day, against closing time at ' + U.fmtHour(so.closeHour) + '. ' + so.rows.length + ' sell-outs in ' + so.dayCount + ' days. The earliest was ' + early.name + ' at ' + fmt.clock(early.t) + '.',
        };
      },
    });
    // One sentence per protein above the dots, so the numbers are readable without the chart.
    const clockWords = h('ul', { class: 'ob-sentences ob-sentences--card', 'aria-label': 'Sell-outs by protein', 'data-k': 'clock-words' });
    const clockBody = clock.el.querySelector('.of-card-body');
    clockBody.insertBefore(clockWords, clockBody.firstChild);
    let lastWords = '';
    // Writes one sentence per protein that sold out and one for those that never did; skipped if unchanged.
    function paintClockWords(p) {
      const b = base(p);
      const sentences = b.so.proteins.filter((x) => x.days > 0).sort((a, c) => c.days - a.days).map((x) => {
        const e = b.so.rows.filter((r) => r.ing === x.ing).sort((a, c) => c.hoursBeforeClose - a.hoursBeforeClose)[0];
        return x.name + ' sold out on ' + x.days + ' of ' + b.so.dayCount + ' ' + B.plural(b.so.dayCount, 'day') + ', the earliest at ' + fmt.clock(e.t) + ', ' + B.hoursWords(e.hoursBeforeClose) + ' before close.';
      });
      const none = b.so.proteins.filter((x) => x.days === 0).map((x) => x.name);
      if (none.length && b.so.dayCount) sentences.push(B.list(none) + ' never sold out.');
      const sig = sentences.join('|');
      if (sig !== lastWords) { lastWords = sig; U.clear(clockWords); sentences.forEach((s) => clockWords.appendChild(h('li', null, s))); }
      clockWords.hidden = !sentences.length;
    }
    return { paintClockWords };
  }

  // Builds the Stock and 86 page into the container and returns {update, destroy} for the frame.
  function render(container, ctx) {
    const kit = ctx.kit || (SB.office && SB.office.kit);
    if (!kit || typeof kit.page !== 'function') throw new Error('The back-office kit is not available (80-office-core.js).');
    const M = ctx.metrics || SB.metrics;
    const fmt = kit.fmt;
    const page = kit.page(container, ctx, { id: 'stock' });
    // Picker state: the day and food shown, and whether the owner chose them (otherwise a default is used).
    const st = { day: null, ing: null, picked: false };
    const setText = B.setText;
    // The gray source line under card titles. Stock ignores the channel filter, so no channel is named.
    const scope = () => B.scopeText(ctx, { noChannel: true });
    // A short readable date for a service-day key.
    const dayLabel = (key) => U.fmtDateShort(key);
    // Stock-burn results for finished days, so switching days or foods is instant (see burn).
    const usageCache = new Map();

    // ---- 2. Numbers, once per prepared data handle ----
    // Settings, the sell-out clock and the list of proteins. `today` is the service date, which rolls over
    // at the day start hour.
    const base = B.memoP((p) => {
      const ds = ctx.dataset(), S = B.settings(ds);
      const so = M.sellOutClock(p);
      const today = U.serviceDate(ctx.now(), S.dayStartHour);
      return { ds, S, so, protein: so.proteins.map((x) => x.ing), today, pastSig: pastSig(ds, B.dayMs(today) + S.dayStartHour * HOUR) };
    });
    // A cheap fingerprint of everything dated before today: counts and grams that change when a past day is edited
    // (a backdated batch or reading, a voided ticket, a discard), but not when today's service moves on.
    function pastSig(ds, todayMs) {
      let nt = 0, nv = 0, nb = 0, gb = 0, ne = 0;
      for (const t of ds.tickets || []) if (t && t.createdAt < todayMs) { nt++; if (t.status === 'voided') nv++; }
      for (const x of ds.batches || []) if (x && x.enteredAt < todayMs) { nb++; gb += (isNum(x.remainingG) ? x.remainingG : 0) + (x.status === 'discard' ? 1e9 : 0); }
      for (const e of ds.events || []) if (e && e.t < todayMs) ne += e.reverted ? 1e6 : 1;
      return [nt, nv, nb, Math.round(gb), ne].join(':');
    }
    // Chart color slot of a protein: its place in the protein list, or 6 for any other food.
    const ingSlot = (b, ing) => { const i = b.protein.indexOf(ing); return i >= 0 ? i + 1 : 6; };

    // stockBurn for a (day, ingredient). It costs about 2 ms and a finished day never changes, so past days
    // are remembered.
    function burn(p, day, ing) {
      const b = base(p);
      // WATCH OUT: the stamp must change when a past day is edited, or the story shows stale numbers.
      const stamp = (b.ds.counts ? b.ds.counts.sample : 0) + ':' + (b.ds.range ? b.ds.range.from : 0) + ':' + b.pastSig;
      const key = day + '|' + ing;
      const past = day < b.today;
      if (past) { const c = usageCache.get(key); if (c && c.stamp === stamp) return c.v; }
      const v = B.safe('stockBurn', () => M.stockBurn(p, { day, ing })) || null;
      if (past && v) { if (usageCache.size > 600) usageCache.clear(); usageCache.set(key, { stamp, v }); }
      return v;
    }

    // Grams used in each service hour on a day, from a stockBurn result. hours[] holds the END of each hour.
    function hourlyUse(sb) {
      const m = new Map();
      (sb.points || []).forEach((pt) => { if (pt.kind === 'use') { const hr = Math.floor(pt.hour); m.set(hr, (m.get(hr) || 0) - pt.d); } });
      const keys = Array.from(m.keys()).sort((a, b) => a - b);
      return { hours: keys.map((k) => k + 1), used: keys.map((k) => m.get(k)), map: m };
    }

    // The day and food to show first: the protein that ran out most often, on the day it ran out earliest.
    const defaultPick = B.memoP((p) => {
      const so = base(p).so;
      if (!so.dayCount) return null;
      const top = so.proteins.slice().sort((x, y) => y.days - x.days)[0];
      if (top && top.days > 0) {
        const rows = so.rows.filter((r) => r.ing === top.ing).sort((x, y) => y.hoursBeforeClose - x.hoursBeforeClose);
        if (rows.length) return { ing: top.ing, day: rows[0].date };
      }
      const last = so.days[so.days.length - 1];
      // No hard-coded fallback food: a kitchen with no tracked protein simply has no default pick.
      const first = so.proteins[0] && so.proteins[0].ing;
      return last && first ? { ing: first, day: last.date } : null;
    });

    // What a normal day looks like for one food: median cooked and median served over the days with any intake.
    const typicalCache = new WeakMap();
    function typicalDay(p, ing) {
      let m = typicalCache.get(p);
      if (!m) typicalCache.set(p, (m = new Map()));
      if (m.has(ing)) return m.get(ing);
      const rows = [];
      base(p).so.days.forEach((d) => {
        const sb = burn(p, d.date, ing);
        if (sb && sb.intakeG > 0) rows.push({ date: d.date, intakeG: sb.intakeG, usedG: sb.usedG, wasteG: sb.wasteG });
      });
      const v = { n: rows.length, medianIntake: B.median(rows.map((r) => r.intakeG)), medianUsed: B.median(rows.map((r) => r.usedG)), medianWaste: B.median(rows.map((r) => r.wasteG || 0)), rows };
      m.set(ing, v);
      return v;
    }

    // ---- 3. The story of the chosen day and the cook-count suggestions ----
    // Plain-words account of the picked day and food: when it ran out, what was cooked and served,
    // and the most likely reason.
    function storyOf(p) {
      const b = base(p), so = b.so;
      if (!so.dayCount) return { tone: 'info', word: 'Nothing yet', title: 'No stock or 86 records in this range yet.', body: 'Once tickets use up food from the hold cabinet, this page shows when each protein ran out and why. Log a batch, then take orders, or pick a longer range.', extra: '' };
      if (!st.day || !st.ing) return { tone: 'info', title: 'Pick a day and a food in the stock chart below.', body: '', extra: '' };
      const sb = burn(p, st.day, st.ing);
      const name = B.ingName(b.ds, st.ing);
      const row = so.rows.find((r) => r.date === st.day && r.ing === st.ing);
      if (!sb || !(sb.points && sb.points.length)) return { tone: 'info', title: name + ' has no stock movements on ' + dayLabel(st.day) + '.', body: 'Nothing was cooked into the cabinet or used from it that day, so there is no story to tell. Pick another day or food.', extra: '' };
      const nb = (sb.batches || []).length;
      const parts = [];
      // Today before closing is still in progress: tell it in the present tense, never as "left at close".
      const open = st.day >= b.today && isNum(sb.closeMs) && ctx.now() < sb.closeMs;
      const was = open ? 'has been' : 'was';
      parts.push((open ? 'So far today ' : 'That day ') + fmt.g(sb.intakeG) + ' ' + was + ' ' + (sb.tcs ? 'cooked' : 'restocked') + (sb.tcs && nb ? ' in ' + nb + ' ' + B.plural(nb, 'batch', 'batches') + ', the last at ' + fmt.clock(sb.batches[nb - 1].enteredAt) : '') + '; ' + fmt.g(sb.usedG) + ' ' + was + ' served' + (sb.wasteG > 0 ? ' and ' + fmt.g(sb.wasteG) + ' ' + was + ' thrown away' : '') + '.');
      if (sb.overdrawnG > 0) parts.push(fmt.g(sb.overdrawnG) + ' more was used than was counted in' + (sb.openingAssumed ? ', so the day started with more than the par level the chart assumes.' : '.'));
      const typ = typicalDay(p, st.ing);
      if (typ.n >= MIN_DAYS) parts.push('A typical day in this range cooks ' + fmt.g(typ.medianIntake) + ' and serves ' + fmt.g(typ.medianUsed) + '.');
      let busy = null;
      hourlyUse(sb).map.forEach((v, hr) => { if (!busy || v > busy.g) busy = { hr, g: v }; });
      if (busy && busy.g > 0) parts.push('The busiest hour was ' + U.fmtHour(busy.hr) + ' to ' + U.fmtHour(busy.hr + 1) + ', when ' + fmt.g(busy.g) + ' went out.');
      if (!row) {
        const left = isNum(sb.endG) ? ' ' + fmt.g(sb.endG) + (open ? ' is in the cabinet now.' : ' was left at close.') : '';
        return { tone: 'good', word: open ? 'Not out yet' : 'Lasted', title: open ? name + ' has not run out so far today.' : name + ' lasted all day on ' + dayLabel(st.day) + '.', body: parts.join(' ') + left, extra: '' };
      }
      // The most likely reason, in order: less cooked than a normal day cooks, a lot thrown away, or simply
      // more orders than usual. WATCH OUT: compare cooked with cooked; a normal day's served grams leave out its
      // waste, so comparing with them would flag a normal cook as short.
      let why = '';
      if (typ.n >= MIN_DAYS && sb.intakeG < typ.medianIntake * 0.95) why = 'You cooked ' + fmt.g(typ.medianIntake - sb.intakeG) + ' less than a normal day, so it ran out early.';
      else if (sb.wasteG > 0 && sb.wasteG >= 0.1 * sb.intakeG) why = fmt.g(sb.wasteG) + ' of what was cooked was thrown away before it could be served, which cut the day short.';
      else if (typ.n >= MIN_DAYS) why = 'You cooked about the usual amount, so guests simply ordered more than usual that day.';
      const early = row.hoursBeforeClose >= 3;
      return { tone: early ? 'warn' : 'info', word: early ? 'Ran out early' : 'Ran out late', title: name + ' went 86 at ' + fmt.clock(row.t) + ', ' + B.hoursWords(row.hoursBeforeClose) + ' before close.', body: parts.join(' '), extra: why };
    }

    // One suggestion per protein. Demand on a day it sold out is estimated from how much of a normal day's use
    // had gone by that hour; the suggestion is the median demand plus PADDING, and the text names its numbers.
    function suggestions(p) {
      const b = base(p), so = b.so;
      const tomorrowWd = (U.weekday(b.today) + 1) % 7;
      return so.proteins.map((pr) => {
        const ing = pr.ing, name = B.ingName(b.ds, ing), meta = B.ingMeta(b.ds, ing) || {};
        const tp = typicalDay(p, ing);
        const out = { ing, name, n: tp.n, parG: isNum(meta.parG) ? meta.parG : null };
        if (tp.n < MIN_DAYS) { out.parts = ['Not enough cooking days yet to suggest a number (need ' + MIN_DAYS + ', have ' + tp.n + ').']; out.text = out.parts[0]; return out; }
        // Under a quarter of the cooked food showing as served usually means incomplete tickets, so no number.
        if (tp.medianIntake > 0 && tp.medianUsed < 0.25 * tp.medianIntake) {
          out.parts = ['Not enough sales recorded to suggest a number: only ' + fmt.g(tp.medianUsed) + ' of the ' + fmt.g(tp.medianIntake) + ' cooked on a normal day shows as served, so the tickets in this range may be incomplete.'];
          out.text = out.parts[0]; return out;
        }
        const soRows = so.rows.filter((r) => r.ing === ing);
        const soDays = new Set(soRows.map((r) => r.date));
        const profiles = tp.rows.filter((r) => !soDays.has(r.date)).map((r) => hourlyUse(burn(p, r.date, ing)));
        const demand = tp.rows.map((r) => {
          if (!soDays.has(r.date)) return { date: r.date, g: r.usedG, est: false };
          const hit = soRows.find((x) => x.date === r.date);
          const share = profiles.length >= 2 && hit ? cumulativeShare(profiles, hit.hour) : null;
          // A usable share is above 15%; otherwise add a flat 15% for the guests who were turned away.
          return { date: r.date, g: share && share > 0.15 ? Math.min(r.usedG / share, r.usedG * 2.5) : r.usedG * 1.15, est: true };
        });
        // Same weekday as tomorrow when there are enough such days, since a Saturday differs from a Tuesday.
        const sameWd = demand.filter((d) => U.weekday(d.date) === tomorrowWd);
        const useWd = sameWd.length >= MIN_DAYS;
        const pool = useWd ? sameWd : demand;
        const med = B.median(pool.map((d) => d.g));
        // Rounded up to the next 100 g so the number reads like one a cook would use.
        const suggest = Math.ceil((med * PADDING) / 100) * 100;
        Object.assign(out, { suggestG: suggest, sold: soRows.length > 0 });
        // Where the days come from: simulated sample days must never read as the owner's own kitchen.
        const srcWord = b.ds.counts && b.ds.counts.sample > 0 ? 'Suggestion from days that include sample history (not your kitchen)' : 'Suggestion from your own days in this range';
        const parts = [];
        if (soRows.length) {
          const earliest = soRows.slice().sort((x, y) => y.hoursBeforeClose - x.hoursBeforeClose)[0];
          parts.push('Sold out on ' + soRows.length + ' of ' + so.dayCount + ' days, as early as ' + fmt.clock(earliest.t) + '. A normal day: cooks ' + fmt.g(tp.medianIntake) + ', serves ' + fmt.g(tp.medianUsed) + '.');
          const t = B.median(soRows.map((r) => r.hour)) - TOP_UP;
          const topUp = 'have a top-up batch ready by about ' + U.fmtTime(B.dayMs(b.today) + t * HOUR);
          if (suggest > tp.medianIntake * 1.03) parts.push(srcWord + ': ' + fmt.g(suggest - tp.medianIntake) + ' more than usual, and ' + topUp + '.');
          else parts.push(srcWord + ': keep the amount and ' + topUp + '. It looks like timing, not quantity.');
        } else {
          const wasted = tp.medianWaste > 0 ? ' and throws away ' + fmt.g(tp.medianWaste) : '';
          parts.push('Never sold out. A normal day: cooks ' + fmt.g(tp.medianIntake) + ', serves ' + fmt.g(tp.medianUsed) + wasted + '.');
          // WATCH OUT: the suggestion is what guests ate. Food thrown away during service (past its hold limit) is cooked food that
          // never reached a plate, so cutting by the whole gap is only safe when that waste goes too; the text says so.
          if (suggest < tp.medianIntake * 0.85) parts.push(srcWord + ': ' + fmt.g(tp.medianIntake - suggest) + ' less than usual would still cover what guests ate' + (tp.medianWaste > 0 ? ', as long as less is thrown away. Check the Thrown-out log first: food that passed its hold limit during service needs a later, smaller batch, not less food.' : '.'));
          else parts.push(srcWord + ': the cook count looks about right.');
        }
        out.parts = parts; out.text = parts.join(' ');
        return out;
      });
    }
    const suggestOf = B.memoP((p) => suggestions(p));

    // ---- 4. The page ----
    // The two pickers for the stock chart. They are built once and live in that card's header.
    const daySel = B.select({ label: 'Day', options: [], onChange: (v) => { st.day = v; st.picked = true; refreshPicks(); } });
    const ingSel = B.select({ label: 'Food', options: [], onChange: (v) => { st.ing = v; st.picked = true; refreshPicks(); } });

    // Keep the pickers in step with the data: options for the days in range, and a default pick until the
    // owner chooses.
    function syncPick(p) {
      const b = base(p);
      const days = b.so.days;
      daySel.setOptions(days.slice().reverse().map((d) => {
        const n = b.so.rows.filter((r) => r.date === d.date).length;
        return { value: d.date, label: d.label + (n ? ', ' + n + ' ' + B.plural(n, 'food') + ' sold out' : '') };
      }));
      const ings = (b.ds.ingredients || []).filter((i) => i && i.id && !i.hidden).map((i) => i.id);
      const order = b.protein.concat(ings.filter((id) => b.protein.indexOf(id) < 0));
      ingSel.setOptions(order.map((id) => ({ value: id, label: B.ingName(b.ds, id) })));
      if (!days.length) { st.day = null; st.ing = null; return; }
      if (!days.some((d) => d.date === st.day) || order.indexOf(st.ing) < 0) st.picked = false;
      if (!st.picked) { const dp = defaultPick(p); st.day = dp ? dp.day : days[days.length - 1].date; st.ing = dp ? dp.ing : order[0]; }
      daySel.set(st.day); ingSel.set(st.ing);
    }
    // The stock curve card, made by buildBurnSection below; the pickers redraw it through refreshPicks.
    let burnCard = null;
    // After the owner picks a day or food (or clicks a dot in the sell-out clock), redraw the chart and story.
    function refreshPicks() {
      const p = ctx.prepared();
      syncPick(p);
      if (burnCard) burnCard.update(p, ctx);
      story.update(p, ctx);
    }

    page.headline();

    // The story box: a plain-words account of the picked day and food.
    const story = page.panel({
      span: 12, title: 'Why it ran out', sub: scope,
      caption: 'The facts of one sell-out day in plain words. Change the day or food in the stock chart below, or click a dot in the sell-out clock.',
      // Fills the story box from the picked day and food; update repaints it in place.
      render: (body, p0) => {
        const co = B.callout(body, kit);
        // Re-syncs the pickers, then shows the story for the current pick.
        const paint = (p) => {
          syncPick(p);
          const v = storyOf(p);
          co.set({ tone: v.tone, word: v.word, title: v.title, body: v.body, extra: v.extra });
        };
        paint(p0);
        return { update: paint };
      },
    });

    page.panel({
      span: 12, title: 'What to cook tomorrow', sub: 'A suggestion from the days in the range above, not a forecast. Sample history days are labeled when they are included.',
      caption: 'A starting number per protein: the typical amount used on the days in this range, plus 10%. Your own judgment about tomorrow comes first.',
      // Builds the intro and the list once; update redraws the list only when it changed.
      render: (body, p0) => {
        const intro = h('p', { class: 'ob-text', 'data-k': 'tomorrow-intro' });
        const list = h('ul', { class: 'ob-sugg', 'aria-label': 'Cook-count suggestions' });
        body.append(intro, list);
        let last = '';
        // Draws one card per protein with its suggestion; skipped when nothing changed, so there is no flicker.
        const paint = (p) => {
          const sug = suggestOf(p);
          setText(intro, sug.length ? 'Tomorrow is ' + WEEKDAY[(U.weekday(base(p).today) + 1) % 7] + '. The numbers are cooked weights, as they go into the hot cabinet, not raw weights. Each card says what it is based on.' : 'Suggestions appear once the range holds a few days of cooking and selling.');
          const sig = JSON.stringify(sug.map((s) => [s.ing, s.text, s.suggestG]));
          if (sig === last) return;
          last = sig;
          U.clear(list);
          sug.forEach((s) => {
            list.appendChild(h('li', { class: 'ob-sg', dataset: { ing: s.ing, tone: s.sold ? 'warn' : 'ok' } },
              h('span', { class: 'ob-sg-h' }, s.name),
              s.suggestG ? h('span', { class: 'ob-sg-n num' }, 'Cook about ' + fmt.g(s.suggestG)) : null,
              s.parts.map((t, i) => h('span', { class: 'ob-sg-t' + (s.parts.length > 1 && i === s.parts.length - 1 ? ' ob-sg-sug' : '') }, t))));
          });
          if (!sug.length) list.appendChild(h('li', { class: 'ob-sg' }, h('span', { class: 'ob-sg-t' }, 'No cooked proteins have sold in this range yet.')));
        };
        paint(p0);
        return { update: paint };
      },
    });

    const { paintClockWords } = buildClockSection({ page, scope, st, refreshPicks, base, ingSlot, dayLabel, fmt });

    burnCard = buildBurnSection({ page, scope, syncPick, st, burn, base, dayLabel, M, fmt, ingSlot, ingSel, daySel, ctx }).burnCard;

    const { spellsOf, spellTable, spellNote } = buildCostSection({ page, base, M, scope, fmt, dayLabel, paintClockWords, ctx });

    return {
      // The frame calls this on every refresh: repaint only the words that depend on the data.
      update() {
        const p = ctx.prepared();
        paintClockWords(p);
        const sp = spellsOf(p);
        const inHours = sp.cl.filter((c) => c.openMs > 0);
        const after = sp.cl.length - inHours.length;
        const off = inHours.reduce((a, c) => a + c.openMs, 0);
        B.setSub(spellTable, scope() + (inHours.length ? '. ' + inHours.length + ' ' + B.plural(inHours.length, 'time') + ', ' + (off >= 60000 ? fmt.ms(off) : 'under a minute') + ' in total during opening hours' + (inHours.some((c) => c.endT === null) ? ', plus one still running' : '') : ''));
        const bits = [];
        const open = inHours.filter((c) => c.cappedAtClose).length;
        if (open) bits.push(open + ' ' + B.plural(open, 'spell was', 'spells were') + ' still running when the data ends, so ' + B.plural(open, 'its time is', 'their time is') + ' counted only to closing time on the day it began.');
        if (after) bits.push(after + ' more ' + B.plural(after, 'spell began', 'spells began') + ' after closing and cost no sales, so ' + B.plural(after, 'it is', 'they are') + ' not listed.');
        if (sp.recorded) bits.push(sp.total + ' order ' + B.plural(sp.total, 'line was', 'lines were') + ' refused because an item was unavailable' + (sp.loose ? '; ' + sp.loose + ' could not be pinned on one food because two were off at once' : '') + '. The app does not record which item, and guests turned away before ordering are not counted.');
        else bits.push('Order lines refused while an item was off are not recorded in this range: the app only counts them when staff try to add an 86\'d item on the live screen. Nothing is estimated.');
        setText(spellNote, bits.join(' '));
      },
      // Runs when the page is left: forgets the remembered stock-burn results.
      destroy() { usageCache.clear(); },
    };
  }

  O.registerPage('stock', { title: 'Stock and 86', icon: 'package', order: 6, render });
})(typeof globalThis !== 'undefined' ? globalThis : window);
