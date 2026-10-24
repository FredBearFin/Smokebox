/*
 * WHAT THIS FILE IS: The back office frame (side rail, title row, sticky filters, data banner, refresh
 * loop) and the kit every office page is built from (cards, KPI tiles, tables, findings).
 * PARTS: pure helpers (run in Node tests too), tracked timers, number formats, ctx for pages, the kit,
 * kit.page, the frame (rail, filters, banner, pages), the refresh loop, mount and unmount.
 * USES: SB.util, metrics, charts, store, sim, ui, icons.   USED BY: 60-shell.js (mount, navigate, unmount)
 * and the page files 81 to 85 (registerPage and the kit). Contract: docs/office-contract.md.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const doc = g.document || null;
  const O = (SB.office = SB.office || {});
  // True for a real, finite number: not NaN, not infinity, not text that looks like a number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // 864e5 ms is one day.
  const DAY = 864e5;

  /** The seven pages, in order. A page file may override title / icon / order when it registers. */
  const PAGES = [
    { id: 'pace', title: 'Speed', short: 'Speed', icon: 'gauge' },
    { id: 'tickets', title: 'Tickets', short: 'Tickets', icon: 'receipt' },
    { id: 'stations', title: 'Stations', short: 'Stations', icon: 'layers' },
    { id: 'money', title: 'Sales and money', short: 'Money', icon: 'dollar' },
    { id: 'safety', title: 'Safety', short: 'Safety', icon: 'shield-check' },
    { id: 'stock', title: 'Stock and 86', short: 'Stock', icon: 'package' },
    { id: 'data', title: 'Menu, prices and shop', short: 'Menu & shop', icon: 'sliders' },
  ];
  const PAGE_IDS = PAGES.map((p) => p.id);
  // Turns any page name into one of the seven page ids. A name we do not know gives the Pace page.
  const pageIdOf = (s) => (PAGE_IDS.indexOf(s) >= 0 ? s : 'pace');

  /** Start of a service day (local dayStartHour on a YYYY-MM-DD key). */
  function dayStartMs(key, dsh) { const p = String(key).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], dsh, 0, 0, 0).getTime(); }
  const validKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(new Date(k + 'T12:00:00').getTime());

  /** Custom range from two inclusive date keys. Returns {ok, range} or {ok:false, message}. */
  function customRange(fromKey, toKey, dsh) {
    if (!validKey(fromKey) || !validKey(toKey)) return { ok: false, message: 'Pick a start and an end date.' };
    if (fromKey > toKey) return { ok: false, message: 'The end date is before the start date.' };
    const from = dayStartMs(fromKey, dsh), to = dayStartMs(U.addDays(toKey, 1), dsh);
    const label = fromKey === toKey ? U.fmtDateShort(fromKey) : U.fmtDateShort(fromKey) + ' to ' + U.fmtDateShort(toKey);
    return { ok: true, range: { id: 'custom', from, to, label, fromKey, toKey } };
  }

  // One service day as a range with id 'day' (not 'custom'), so the clock never rolls it forward. A day
  // runs from dsh (4 am default) to dsh the next morning, so 1 am Saturday still belongs to Friday.
  function dayRange(key, dsh) {
    const r = customRange(key, key, dsh);
    if (!r.ok) return r;
    r.range.id = 'day';
    return r;
  }

  // The service date one step before or after a date, never later than today. Returns null when the step
  // would go past today (the Next arrow is then off) or the date is not valid.
  function stepDayKey(key, delta, todayKey) {
    if (!validKey(key) || !validKey(todayKey)) return null;
    const next = U.addDays(key, delta);
    return next > todayKey ? null : next;
  }

  // The date the day picker shows for a range: its last day. A range that ends after today (clock moved
  // back) is pulled to today.
  function pickerKey(range, todayKey) {
    const k = range && validKey(range.toKey) ? range.toKey : todayKey;
    return k > todayKey ? todayKey : k;
  }

  // The plain next-step message for a page with nothing in its range, or null when the page has data (or
  // is the settings page). f = {anyLive, tickets, finished, onBoard, paid, batches, records, label}: whether
  // any live ticket exists at all, and how many tickets (finished, still on the board, paid), batches and
  // safety records fall in the range. Each page has its own words and next step.
  function coachText(pageId, f) {
    f = f || {};
    const never = !f.anyLive && !f.batches && !f.records;
    const where = f.label ? ' on ' + f.label : ' in this range';
    // "3 tickets on the board now" when tickets are waiting, else '' (onBoard may be missing in old callers).
    const board = isNum(f.onBoard) && f.onBoard > 0 ? f.onBoard + ' ' + (f.onBoard === 1 ? 'ticket is' : 'tickets are') + ' on the board now' : '';
    const KITCHEN = {
      pace: { first: 'No speed numbers yet', wait: 'times appear here once they are sent out.', start: 'Take an order on the board and tap Bump when it goes out. How fast your tickets go out shows here.' },
      tickets: { first: 'No finished tickets yet', wait: 'they are listed here with their times once they are sent out.', start: 'Every ticket you send out is listed here with its times. Take an order on the board and tap Bump when it goes out.' },
      stations: { first: 'No station times yet', wait: 'each station\'s times appear here once they are sent out.', start: 'Each station\'s speed shows here once its items are done. Take an order on the board and send it out.' },
    };
    if (KITCHEN[pageId]) {
      const k = KITCHEN[pageId];
      // With a finished-ticket count, the page needs finished tickets to say anything; tickets still on the line are not enough.
      if (isNum(f.finished) ? f.finished > 0 : f.tickets > 0) return null;
      if (isNum(f.finished) && f.tickets > 0) return { title: k.first, body: (board || 'The tickets so far are not finished') + '; ' + k.wait };
      return never || !f.anyLive
        ? { title: k.first, body: k.start }
        : { title: 'No tickets' + where, body: 'Nothing was ordered in this range. Use the arrows or the range buttons to look at a day you were open.' };
    }
    if (pageId === 'money') {
      // the thrown-away ledger on this page needs no sales, so a discard also counts as data here
      if (isNum(f.paid) ? f.paid > 0 || f.discards > 0 : f.tickets > 0 || f.discards > 0) return null;
      if (isNum(f.paid) && f.tickets > 0) return { title: 'No paid orders yet', body: 'The orders so far are not paid. Tap the Orders button on the board, pay an order, and the money shows up here.' };
      return !f.anyLive
        ? { title: 'Take your first order', body: 'Sales come from your own orders. Take an order on the board, pay it with the Orders button on the board, and the money shows up here.' }
        : { title: 'No sales' + where, body: 'Nothing was sold in this range. Use the arrows or the range buttons to look at a day you were open.' };
    }
    if (pageId === 'safety') {
      if (f.batches > 0 || f.records > 0) return null;
      return never
        ? { title: 'Log your first batch', body: 'Safety is built from your own records. Log a batch into the hold cabinet, take its temperature when the app asks, and log a sanitize round.' }
        : { title: 'No food-safety records' + where, body: 'No batch, temperature reading or sanitize round was logged in this range. Use the arrows or the range buttons to pick another day.' };
    }
    if (pageId === 'stock') {
      if (f.batches > 0 || f.tickets > 0) return null;
      return never
        ? { title: 'Log your first batch', body: 'Stock and 86 come from your own cooking and orders. Log a batch into the hold cabinet, then take orders, and this page shows when each protein runs out.' }
        : { title: 'No stock activity' + where, body: 'No food was cooked or sold in this range. Use the arrows or the range buttons to pick another day.' };
    }
    return null;
  }

  // The currency symbol the shared money formatter prints ($ unless the owner chose another one).
  const curSym = () => { try { return (U.currencySymbol && U.currencySymbol()) || '$'; } catch (e) { return '$'; } };

  // Split a sentence into number tokens (kept) and plain text so the headline can set the numbers in
  // bold.
  const NUM_RE = /([$€£¥₹]\d[\d,]*(?:\.\d+)?|\d+h \d{2}m|\d+m \d{2}s|\d+(?:\.\d+)?(?:%| kg| g\b| hours?)?|\d[\d,]*)/g;
  function splitNumbers(text) {
    const out = []; let last = 0; const s = String(text == null ? '' : text); let m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(s))) {
      if (m.index > last) out.push({ t: s.slice(last, m.index), num: false });
      out.push({ t: m[0], num: true }); last = m.index + m[0].length;
      if (m[0].length === 0) NUM_RE.lastIndex++;
    }
    if (last < s.length) out.push({ t: s.slice(last), num: false });
    return out;
  }

  // "6m 42s" -> [{n:'6',u:'m'},{n:'42',u:'s'}]; "87%" -> [{n:'87',u:'%'}]; "$12.40" ->
  // [{u:'$'},{n:'12.40'}]. For the big KPI numbers.
  function tileParts(text) {
    const out = []; const re = /(-?\d[\d,]*(?:\.\d+)?)|([^\d\s-]+)/g; let m;
    const s = String(text == null ? '' : text);
    while ((m = re.exec(s))) { if (m[1] != null) out.push({ n: m[1] }); else out.push({ u: m[2] }); }
    return out;
  }

  // Sort rows by a column. Unknown values (null, NaN, '') go last whichever way the column runs. dir = 1
  // or -1.
  function sortRows(rows, col, dir) {
    const key = col.sortKey || col.key;
    // The value a row sorts by. Empty, missing and NaN count as unknown, so they always sort last.
    const val = (r) => { const v = typeof col.sortValue === 'function' ? col.sortValue(r) : r[key]; return v === '' || v == null || (typeof v === 'number' && !isFinite(v)) ? null : v; };
    const keyed = rows.map((r, i) => ({ r, i, v: val(r) }));
    keyed.sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      let c;
      if (typeof a.v === 'number' && typeof b.v === 'number') c = a.v - b.v;
      else if (typeof a.v === 'boolean' || typeof b.v === 'boolean') c = (a.v ? 1 : 0) - (b.v ? 1 : 0);
      else c = String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
      return c * dir || a.i - b.i;
    });
    return keyed.map((k) => k.r);
  }

  // Signature of a chart spec: same signature means the chart need not be touched. Functions count only
  // by their presence.
  function sig(x) { try { return JSON.stringify(x, (k, v) => (typeof v === 'function' ? 'fn' : v)); } catch (e) { return 'x' + Math.random(); } }

  // Honest one-line banner. info = {sampleDays, sampleTickets, live, demo, sampleEnabled, sampleLoaded,
  // sampleWanted, total}. It only speaks when sample days exist and are switched on (then the Show
  // buttons are on screen too); otherwise there is nothing to tell apart and the text is empty.
  function bannerText(info) {
    const pl = (n, a, b) => (n === 1 ? a : b || a + 's');
    if (!info.sampleLoaded || !info.sampleEnabled) return { kind: 'live', text: '' };
    // the owner's own tickets in the range, and the demo ones a first run starts with
    const own = [info.live > 0 ? info.live + ' of your ' + pl(info.live, 'ticket') : '', info.demo > 0 ? info.demo + ' demo ' + pl(info.demo, 'ticket') : ''].filter(Boolean).join(' and ');
    if (info.sampleTickets > 0) {
      return { kind: 'sample', text: info.sampleDays + ' sample ' + pl(info.sampleDays, 'day') + ' (made up by the app)' + (own ? ' plus ' + own : '') + '.' };
    }
    if (!info.sampleWanted) return { kind: 'live', text: 'Your tickets only: ' + (info.total ? own : 'none') + ' in this range.' };
    return { kind: 'live', text: (info.total ? own + ' in this range.' : 'No tickets in this range.') + ' No sample days fall in this range.' };
  }

  // Delta between two numbers in the compare() shape, for tiles that supply their own previous value.
  // good = 'lower' | 'higher' | 'neutral'.
  function makeDelta(cur, prev, kind, good) {
    if (!isNum(cur) || !isNum(prev)) return { dir: null, better: null, word: 'no comparison', text: 'No earlier period to compare', deltaPct: null, delta: null };
    const delta = cur - prev, dp = prev > 0 ? delta / prev : null;
    const flat = kind === 'share' ? Math.abs(delta) < 0.005 : delta === 0 || (dp !== null && Math.abs(dp) < 0.02);
    const dir = flat ? 'flat' : delta > 0 ? 'up' : 'down';
    const better = flat ? 'flat' : good === 'neutral' ? 'neutral' : ((dir === 'up') === (good === 'higher') ? 'good' : 'bad');
    const word = flat ? 'about the same' : kind === 'time' ? (dir === 'up' ? 'slower' : 'faster') : dir === 'up' ? 'higher' : 'lower';
    const text = flat ? 'About the same as the previous period' : (kind === 'share' ? (Math.abs(delta) * 100).toFixed(1) + ' points ' : dp !== null ? Math.round(Math.abs(dp) * 100) + '% ' : '') + word + ' than the previous period';
    return { dir, better, word, text, deltaPct: dp, delta };
  }

  // The calm note for a range that reaches days already saved to the month files and cleared from this tablet, or '' when it does
  // not. `before` is the state's archivedBefore day, `from` the range start (ms), `dsh` the day-start hour.
  function archivedWords(before, from, dsh) {
    if (typeof before !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(before)) return '';
    if (isNum(from) && from >= dayStartMs(before, isNum(dsh) ? dsh : 4)) return '';
    return 'Days before ' + U.fmtDateShort(before) + ' were saved to your month files and cleared from this tablet. Totals for those days are not shown here.';
  }
  O.archivedWords = archivedWords;
  // The matching note for days dropped to make room when the saved history filled up (`day` is the first day still kept), or '' when the
  // range starts on or after it.
  function droppedRangeWords(day, from, dsh) {
    if (typeof day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(day)) return '';
    if (isNum(from) && from >= dayStartMs(day, isNum(dsh) ? dsh : 4)) return '';
    return 'Older history was dropped to make room: days before ' + U.fmtDateShort(day) + ' are not here, so totals for those days are missing.';
  }
  O.droppedRangeWords = droppedRangeWords;

  // A weight in the owner's unit (g and kg, or oz and lb) without trailing zeros: "14 kg", "2.4 kg", "7 oz".
  // Every back-office page shows weights through this, so a pounds kitchen sees pounds everywhere.
  O.weightText = (g) => String(U.weightText ? U.weightText(g) : U.fmtG(g)).replace(/(\.\d*?)0+ (kg|lb|oz)$/, '$1 $2').replace(/\. (kg|lb|oz)$/, ' $1');

  O.pure = { PAGES, customRange, coachText, dayRange, stepDayKey, pickerKey, splitNumbers, tileParts, sortRows, sig, bannerText, makeDelta, dayStartMs };

  if (!doc) return; // Node: the pure helpers are all the tests need

  // Everything still alive (timers, subscriptions, listeners), so a test can prove nothing is left after
  // unmount.
  const live = { timeouts: new Set(), intervals: new Set(), subs: new Set(), listeners: new Set() };
  const setT = (fn, ms) => { const id = setTimeout(() => { live.timeouts.delete(id); fn(); }, ms); live.timeouts.add(id); return id; };
  const clrT = (id) => { clearTimeout(id); live.timeouts.delete(id); };
  const setI = (fn, ms) => { const id = setInterval(fn, ms); live.intervals.add(id); return id; };
  const clrI = (id) => { clearInterval(id); live.intervals.delete(id); };
  /** Wrap an unsubscribe function so it is counted and idempotent. */
  const tracked = (kind, off) => { const rec = {}; live[kind].add(rec); return () => { if (live[kind].delete(rec)) { try { off(); } catch (e) { /* ignore */ } } }; };
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); return tracked('listeners', () => target.removeEventListener(type, fn, opts)); };
  const kitPagesLive = new Set();
  const cardsLive = new Set();

  const h = U.h;
  // Draws an icon by name. A missing icon gives an empty span, so the page still builds.
  const ico = (name, size, o) => { try { return SB.icons.svg(name, Object.assign({ size: size || 20 }, o || {})); } catch (e) { return doc.createElement('span'); } };
  const warnOnce = (() => { const seen = new Set(); return (key, err) => { if (seen.has(key)) return; seen.add(key); if (seen.size > 200) seen.clear(); try { console.error('[smokebox] office: ' + key, err); } catch (e) { /* ignore */ } }; })();

  // Number formats: thin wrappers over SB.util that give a dash for an unknown value instead of NaN.
  const fmt = {
    // ms and sec turn milliseconds or seconds into words such as 4m 30s.
    ms: (ms) => U.fmtDur(ms),
    sec: (s) => (isNum(s) ? U.fmtDur(s * 1000) : '-'),
    // pct takes a fraction (0.87 gives 87%) and keeps one decimal for small shares. money gives dollars
    // such as $12.40.
    pct: (x, d) => U.fmtPct(x, d == null ? (isNum(x) && Math.abs(x) > 0 && Math.abs(x) < 0.1 ? 1 : 0) : d),
    money: (n, d) => U.fmtMoney(n, d == null ? 2 : d),
    // g gives a weight in the owner's unit (g and kg, or oz and lb) without trailing zeros: "14 kg",
    // "2.4 kg", "7 oz". num gives a plain number with the decimals asked for.
    g: (n) => O.weightText(n),
    num: (n, d) => U.fmtNum(n, d || 0),
    // hour gives a service hour such as 7 pm. clock gives the time of day for a time stamp.
    hour: (hr) => (isNum(hr) ? U.fmtHour(hr) : '-'),
    clock: (ts) => (isNum(ts) ? U.fmtTime(ts) : '-'),
    // date gives a short date such as Fri 10/16 from a time stamp or a YYYY-MM-DD key. mmss gives minutes
    // and seconds.
    date: (v) => { if (isNum(v)) return U.fmtDateShort(U.dateKey(v)); if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return U.fmtDateShort(v.slice(0, 10)); return '-'; },
    mmss: (ms) => (isNum(ms) ? U.fmtClock(ms) : '-'),
  };
  // Icon and word for each kind of finding, so colour is never the only clue.
  const TONE = {
    good: { icon: 'check-circle', word: 'Good' },
    info: { icon: 'info', word: 'Note' },
    warn: { icon: 'alert', word: 'Watch' },
    bad: { icon: 'alert-circle', word: 'Problem' },
  };

  // Registered pages, the mounted frame (null when closed) and the filter start a test may override.
  const registry = {};           // id -> {id, title, icon, order, render}
  let M = null;                  // the mounted frame
  let lastFilterDefaults = null;

  // The hour a service day starts (4 am unless settings say otherwise). Earlier times belong to the day
  // before.
  const svcHour = () => {
    try { const s = SB.store && SB.store.select && SB.store.select.settings(); const v = s && s.service && s.service.dayStartHour; if (isNum(v)) return v; } catch (e) { /* ignore */ }
    return (SB.config && SB.config.service && SB.config.service.dayStartHour) || 4;
  };
  // The current time from the store's clock, so a sped-up demo shows through. Falls back to the real
  // clock.
  const nowMs = () => { try { return SB.store.now(); } catch (e) { return Date.now(); } };
  // The order channels (dine-in, takeout and so on) from settings, or an empty list.
  const channelList = () => (SB.config && SB.config.channels) || [];
  // True when sample history is switched on in Menu, prices and shop. It counts as on when the simulator is
  // missing.
  const sampleFlag = () => { const s = SB.sim; if (s && typeof s.sampleEnabled === 'function') { try { return !!s.sampleEnabled(); } catch (e) { return false; } } return true; };
  // The store's data with or without sample history. If the store fails, an empty dataset keeps pages in
  // their empty state.
  const storeDataset = (wantSample) => { try { return SB.store.dataset({ sample: !!wantSample }); } catch (e) { warnOnce('dataset', e); return { tickets: [], events: [], batches: [], learned: {}, menu: [], ingredients: [], settings: {}, range: { from: 0, to: 0 }, counts: { live: 0, sample: 0 }, hasSample: false }; } };
  // True when sample history exists in the data (it may be switched off, or not generated yet).
  const sampleLoaded = () => { try { return !!storeDataset(true).hasSample; } catch (e) { return false; } };

  // The ready-made ranges (Today, Yesterday, Last 7 days, Last 14 days) worked out from the current time.
  function presetRanges() {
    const t = nowMs(), dsh = svcHour();
    try { return SB.metrics.rangePresets(t, dsh); } catch (e) { return []; }
  }
  // One ready-made range by id. An id we do not know gives Today.
  function presetRange(id) {
    const p = presetRanges().find((x) => x.id === id) || presetRanges().find((x) => x.id === 'today');
    return p ? { id: p.id, from: p.from, to: p.to, label: p.label, fromKey: p.fromKey, toKey: p.toKey } : { id: 'today', from: nowMs() - DAY, to: nowMs() + 1, label: 'Today' };
  }
  // Where the filters start: Last 14 days with sample data when it is loaded, otherwise Today with live
  // data only (or the last 7 days when today has no tickets yet but the week does).
  function defaultFilters() {
    const sampleOk = sampleFlag() && sampleLoaded();
    if (sampleOk) return { range: presetRange('last14'), channel: 'all', source: 'all' };
    // With nothing sold yet today but tickets in the past week, start on the last 7 days so the first screen is not empty.
    try {
      const tickets = (storeDataset(false).tickets || []), today = presetRange('today'), week = presetRange('last7');
      // True when any ticket was created inside the range.
      const inR = (r) => tickets.some((t) => t && isNum(t.createdAt) && t.createdAt >= r.from && t.createdAt < r.to);
      if (!inR(today) && inR(week)) return { range: week, channel: 'all', source: 'live' };
    } catch (e) { /* fall back to today */ }
    return { range: presetRange('today'), channel: 'all', source: 'live' };
  }

  // Builds the ctx a page receives: filters, the data, the one shared metrics handle and a few helpers.
  // WATCH OUT: pages must use ctx.prepared() and ctx.previous(), which are cached once per refresh, never
  // prepare their own.
  function makeCtx(rec) {
    const F = M.filters;
    const ctx = {
      filters: F,
      // dataset gives the data for the current source filter. opts gives the range, channel and clock
      // SB.metrics needs.
      dataset: () => storeDataset(F.source === 'all' && sampleFlag()),
      opts: () => ({ from: F.range.from, to: F.range.to, channel: F.channel, now: nowMs() }),
      // The metrics handle for the current filters, shared by every card so the numbers are worked out
      // once per refresh.
      prepared() {
        const ds = ctx.dataset();
        const m = M.prep;
        if (m && m.gen === M.gen && m.ds === ds && m.from === F.range.from && m.to === F.range.to && m.channel === F.channel) return m.p;
        const p = SB.metrics.prepare(ds, ctx.opts());
        M.prep = { gen: M.gen, ds, from: F.range.from, to: F.range.to, channel: F.channel, p };
        return p;
      },
      // Prepared handle for the previous period of equal length (what the tile arrows compare with). Same
      // memo rules as prepared().
      previous() {
        const ds = ctx.dataset(), len = F.range.to - F.range.from;
        const m = M.prevPrep;
        if (m && m.gen === M.gen && m.ds === ds && m.from === F.range.from && m.to === F.range.to && m.channel === F.channel) return m.p;
        const p = SB.metrics.prepare(ds, { from: F.range.from - len, to: F.range.from, channel: F.channel, now: nowMs() });
        M.prevPrep = { gen: M.gen, ds, from: F.range.from, to: F.range.to, channel: F.channel, p };
        return p;
      },
      // 0..1: the share of the previous period's service days that have any tickets (an arrow against one
      // thin day would claim a change that is not there)
      previousCoverage() {
        const ds = ctx.dataset(), len = F.range.to - F.range.from;
        const m = M.prevCov;
        if (m && m.gen === M.gen && m.ds === ds && m.from === F.range.from && m.to === F.range.to && m.channel === F.channel) return m.v;
        const pf = F.range.from - len, days = new Set(), dsh = svcHour();
        for (const t of ds.tickets || []) { if (t && isNum(t.createdAt) && t.createdAt >= pf && t.createdAt < F.range.from && (F.channel === 'all' || t.channel === F.channel)) days.add(U.serviceDate(t.createdAt, dsh)); }
        const v = Math.min(1, days.size / Math.max(1, Math.round(len / DAY)));
        M.prevCov = { gen: M.gen, ds, from: F.range.from, to: F.range.to, channel: F.channel, v };
        return v;
      },
      now: nowMs,
      metrics: SB.metrics,
      // onFilterChange registers a page callback for filter or data changes and returns a function that
      // removes it.
      onFilterChange(fn) { rec.listeners.push(fn); return () => { const i = rec.listeners.indexOf(fn); if (i >= 0) rec.listeners.splice(i, 1); }; },
      navigate: (id) => O.navigate(id),
      // openSheet opens a sheet by name. theme says which office look ('ember' for Night, 'paper' for Day) is showing.
      openSheet: (name, opts) => (SB.sheets ? SB.sheets.open(name, opts) : null),
      theme: () => (SB.theme ? SB.theme.office() : 'ember'),
      kit: O.kit,
      _rec: rec,
    };
    return ctx;
  }

  const kit = (O.kit = { fmt, tone: TONE });

  kit.chip = function (o) { const el = SB.ui.chip(o); el.el = el; return el; };
  // button({label, icon, onClick, kind:'primary'|'ghost'|'danger'|'success'|'', small, ariaLabel}) ->
  // <button class="btn"> (also has .el)
  kit.button = function (o) {
    o = o || {};
    const el = h('button', { type: 'button', class: 'btn' + (o.kind ? ' btn-' + o.kind : '') + (o.small ? ' btn-sm' : '') + (o.label ? '' : ' btn-icon') });
    if (o.ariaLabel) el.setAttribute('aria-label', o.ariaLabel);
    if (o.icon) el.appendChild(ico(o.icon, o.small ? 18 : 20));
    if (o.label) el.appendChild(h('span', null, o.label));
    if (typeof o.onClick === 'function') el.addEventListener('click', o.onClick);
    el.el = el;
    return el;
  };

  /** empty({title, body, action:{label,onClick}}) -> {el}. Helpful, never a bare "no data". */
  kit.empty = function (o) {
    o = o || {};
    const el = h('div', { class: 'of-empty', role: 'status' }, ico(o.icon || 'chart-bar', 26),
      h('h3', { class: 'of-empty-t' }, o.title || 'Not enough data yet'),
      o.body ? h('p', { class: 'of-empty-b' }, o.body) : null);
    if (o.action && o.action.label) el.appendChild(kit.button({ label: o.action.label, onClick: o.action.onClick, small: true }));
    return { el };
  };

  /** errorCard({title, body, details}) -> {el}. Inline, names the thing that failed, says what to do. */
  kit.errorCard = function (o) {
    o = o || {};
    const el = h('div', { class: 'of-error', role: 'alert' },
      h('h3', { class: 'of-error-t' }, ico('alert-circle', 22), h('span', null, o.title || 'This part could not be drawn')),
      h('p', null, o.body || 'Something went wrong. The rest of the back office still works. Open another page, then come back.'));
    if (o.details) {
      const d = h('details', { class: 'of-error-d' }, h('summary', null, 'Technical details'), h('pre', null, String(o.details)));
      el.appendChild(d);
    }
    return { el };
  };

  // drawer({title, sub, width, render(body, close) -> {destroy?}, onClose}) -> sheet api. A right-hand
  // panel in the office theme.
  kit.drawer = function (o) {
    o = o || {};
    let inst = null;
    const sh = SB.ui.sheet({
      title: o.title || '', side: 'right', width: o.width || 640, name: o.name || 'office-drawer',
      // When the panel closes: run the page's own cleanup, then the caller's onClose. Errors are logged,
      // never thrown.
      onClose: () => { try { if (inst && inst.destroy) inst.destroy(); } catch (e) { warnOnce('drawer destroy', e); } inst = null; if (typeof o.onClose === 'function') { try { o.onClose(); } catch (e) { warnOnce('drawer onClose', e); } } },
    });
    if (o.sub) sh.body.appendChild(h('p', { class: 'of-drawer-sub' }, o.sub));
    const holder = h('div', { class: 'of-drawer-body' }); sh.body.appendChild(holder);
    try { inst = typeof o.render === 'function' ? o.render(holder, () => sh.close('api')) : null; }
    catch (e) { warnOnce('drawer render', e); holder.appendChild(kit.errorCard({ title: 'This panel could not be drawn', details: e && e.stack }).el); }
    return sh;
  };

  // Draws the headline sentence into el with its numbers in bold. Skips the redraw when the words are
  // unchanged.
  function paintHeadline(el, text) {
    if (el.__text === text) return;
    el.__text = text; U.clear(el);
    splitNumbers(text).forEach((s) => el.appendChild(s.num ? h('b', { class: 'of-hn' }, s.t) : doc.createTextNode(s.t)));
  }

  // Which format a metric's kind uses when a tile does not name one.
  const KIND_FMT = { time: 'ms', share: 'pct', count: 'num', money: 'money' };
  // Turns a tile's number into its big text. f can be a format name, a function, or empty (the metric
  // kind decides).
  function formatTile(v, f, kindHint) {
    if (typeof f === 'function') return String(f(v));
    const k = f || KIND_FMT[kindHint] || 'num';
    if (!isNum(v)) return '-';
    if (k === 'ms') return fmt.ms(v);
    if (k === 'sec') return fmt.sec(v);
    if (k === 'pct') return fmt.pct(v);
    if (k === 'money') return fmt.money(v);
    if (k === 'g') return fmt.g(v);
    if (k === 'num1') return fmt.num(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0);
    return fmt.num(v, Number.isInteger(v) ? 0 : Math.abs(v) < 10 ? 1 : 0);
  }
  const THIN_PREV = 0.5;   // tile arrows need at least half of the previous period's days to have tickets
  const ARROW = { up: 'arrow-up', down: 'arrow-down', flat: 'minus' };

  // Builds one KPI tile: label, big number, change arrow with a word, and a sparkline. Returns {el,
  // update(p, ctx), destroy()}.
  function makeTile(def, owner) {
    const li = h('li', { class: 'of-tile', dataset: { id: def.id || '' } });
    const label = h('div', { class: 'of-tile-label' }, def.label || (def.kpi ? '' : def.id || ''));
    const val = h('div', { class: 'of-tile-val', 'aria-hidden': 'true' });
    const delta = h('div', { class: 'of-tile-delta' });
    const sparkHost = h('div', { class: 'of-tile-spark', 'aria-hidden': 'true' });
    const sr = h('span', { class: 'visually-hidden' });
    li.append(label, val, delta, sparkHost, sr);
    let spark = null, lastSpark = '';
    // Redraws the tile text, arrow and sparkline. thin means the earlier period has too few days, so no
    // arrow is claimed.
    function paint(textVal, d, text, sparkVals, kpiLabel, kindName, hasValue, thin) {
      if (!def.label && kpiLabel) label.textContent = kpiLabel;
      U.clear(val);
      const parts = tileParts(textVal);
      if (!parts.length) parts.push({ n: '-' });
      parts.forEach((p, i) => { if (p.n != null) val.appendChild(h('span', { class: 'of-n' }, p.n)); else val.appendChild(h('span', { class: p.u === curSym() ? 'of-cur' : 'of-u' }, p.u)); if (i < parts.length - 1 && p.u && p.u !== curSym() && parts[i + 1].n != null) val.appendChild(doc.createTextNode(' ')); });
      if (def.unit) val.appendChild(h('span', { class: 'of-uw' }, def.unit));
      U.clear(delta);
      const tone = d && d.better ? d.better : 'neutral';
      delta.setAttribute('data-tone', tone);
      if (d && d.dir) {
        const word = d.dir === 'flat' ? 'steady' : d.word;
        let amount = '';
        if (d.dir !== 'flat' && isNum(d.deltaPct)) amount = Math.round(Math.abs(d.deltaPct) * 100) + '% ';
        else if (d.dir !== 'flat' && isNum(d.delta) && d.points) amount = d.points;
        delta.append(ico(ARROW[d.dir], 16, { stroke: 2.4 }), h('span', null, amount + word));
      } else {
        delta.appendChild(h('span', { class: 'of-nocmp' }, !hasValue ? (def.noValue || def.noCompare || 'Not enough data') : (def.noCompare && !thin ? def.noCompare : thin ? '' : 'No earlier period')));
      }
      sr.textContent = (def.label || kpiLabel || '') + ': ' + textVal + (def.unit ? ' ' + def.unit : '') + '. ' + (d && d.text ? d.text : !hasValue ? 'Not enough data in this range.' : thin ? 'There is no full earlier period to compare with.' : 'No earlier period to compare.');
      // sparkline
      const vals = Array.isArray(sparkVals) ? sparkVals.filter(isNum) : [];
      if (vals.length >= 3) {
        const key = JSON.stringify(vals);
        sparkHost.hidden = false;
        const fmtName = typeof def.format === 'function' ? def.format : kindName === 'share' ? 'pct' : kindName === 'time' ? 'dur' : kindName === 'money' ? 'money' : 'num';
        const spec = { values: vals, area: true, width: 112, height: 30, label: (def.label || kpiLabel || 'Trend') + ' by day', format: fmtName, tone: 'accent' };
        if (!spark) { spark = SB.charts.spark(sparkHost, spec); lastSpark = key; }
        else if (key !== lastSpark) { lastSpark = key; spark.update(spec); }
      } else { sparkHost.hidden = true; if (spark) { spark.destroy(); spark = null; lastSpark = ''; } }
    }
    return {
      el: li,
      // Reads this tile's value, earlier value and daily series from the metrics handle p, then repaints.
      update(p, ctx) {
        let cmp = null, k = null;
        if (def.kpi) { cmp = owner.compare(p); k = cmp && cmp.kpis ? cmp.kpis[def.kpi] : null; }
        let raw = k ? k.current : null, d = k && k.dir !== undefined ? k : null, sparkVals = k && cmp.spark ? cmp.spark[def.kpi] : null;
        if (typeof def.value === 'function') {
          const r = def.value(p, ctx);
          if (r && typeof r === 'object' && !Array.isArray(r)) { raw = r.value; if (r.delta) d = r.delta; if (r.spark) sparkVals = r.spark; } else raw = r;
        }
        const thin = typeof ctx.previousCoverage === 'function' && ctx.previousCoverage() < THIN_PREV;
        if (thin) d = null;
        if (typeof def.previous === 'function') {
          d = thin ? null : makeDelta(raw, def.previous(p, ctx), def.kind || 'count', def.good || 'neutral');
        }
        if (typeof def.spark === 'function') sparkVals = def.spark(p, ctx);
        const text = formatTile(raw, def.format, k ? k.kind : def.kind);
        paint(text, d, text, sparkVals, k ? k.label : '', k ? k.kind : def.kind, isNum(raw), thin);
      },
      // Frees the sparkline chart when the tile goes away.
      destroy() { if (spark) { try { spark.destroy(); } catch (e) { /* ignore */ } spark = null; } },
    };
  }

  // Builds a sortable, paged table (a real table element) inside host. Returns {el, update(rows),
  // destroy()}.
  function makeTable(host, def, labelText) {
    const cols = def.columns || [];
    const pageSize = def.pageSize > 0 ? def.pageSize : 10;
    let rows = [], sortKey = def.defaultSort || null, sortDir = def.defaultDir === 'asc' ? 1 : -1, page = 0, lastSig = '';
    const table = h('table', { class: 'of-table', 'aria-label': labelText || def.title || 'Table' });
    const thead = h('thead'), tbody = h('tbody'), tr0 = h('tr');
    const ths = {};
    cols.forEach((c) => {
      const th = h('th', { scope: 'col', class: 'of-th' + (c.align === 'right' ? ' is-num' : '') + (c.wideOnly ? ' is-wide' : ''), 'aria-sort': c.sort ? 'none' : null });
      if (c.width) th.style.width = typeof c.width === 'number' ? c.width + 'px' : c.width;
      if (c.sort) {
        const b = h('button', { type: 'button', class: 'of-sortbtn' }, h('span', null, c.label), ico('chevron-down', 14, { stroke: 2.4, class: 'of-sorticon' }));
        b.setAttribute('aria-label', 'Sort by ' + c.label);
        b.addEventListener('click', () => setSort(c.key));
        th.appendChild(b); ths[c.key] = th;
      } else th.appendChild(h('span', null, c.label));
      tr0.appendChild(th);
    });
    thead.appendChild(tr0); table.append(thead, tbody);
    const wrap = h('div', { class: 'of-tablewrap', tabindex: '0', role: 'region', 'aria-label': (labelText || def.title || 'Table') + ' (scrolls sideways when narrow)' }, table);
    const foot = h('div', { class: 'of-tfoot' });
    const info = h('span', { class: 'of-tinfo', 'aria-live': 'polite' });
    // Previous and Next buttons, shown when there are more rows than one page holds.
    const prev = kit.button({ label: 'Previous', icon: 'chevron-left', small: true, onClick: () => { if (page > 0) { page--; paintBody(); } } });
    const next = kit.button({ label: 'Next', icon: 'chevron-right', small: true, onClick: () => { page++; paintBody(); } });
    foot.append(info, h('div', { class: 'of-tpager' }, prev, next));
    const emptyEl = h('div', { class: 'of-tempty', hidden: true });
    host.append(wrap, foot, emptyEl);

    // A click on a column heading: the same column flips direction, a new column starts in its natural
    // direction.
    function setSort(key) {
      if (sortKey === key) sortDir = -sortDir; else { sortKey = key; const c = cols.find((x) => x.key === key); sortDir = c && c.firstDir === 'asc' ? 1 : (c && c.align === 'right') ? -1 : 1; }
      page = 0; paintHead(); paintBody();
    }
    // Marks which column is sorted, for screen readers and for the arrow icon.
    function paintHead() { Object.keys(ths).forEach((k) => { ths[k].setAttribute('aria-sort', k === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'); }); }
    // The content of one cell: the column's format function, or the plain value with a dash when unknown.
    function cell(c, r) {
      let v = r[c.key];
      let content = typeof c.format === 'function' ? c.format(v, r) : (v == null || (typeof v === 'number' && !isFinite(v)) ? '-' : typeof v === 'number' ? fmt.num(v, Number.isInteger(v) ? 0 : 1) : String(v));
      if (content == null) content = '-';
      return content;
    }
    // Draws the current page of rows in sorted order, plus the 'Showing 1 to 8 of 50' line and the pager
    // state.
    function paintBody() {
      const col = cols.find((c) => c.key === sortKey);
      const sorted = col ? sortRows(rows, col, sortDir) : rows;
      const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
      if (page >= pages) page = pages - 1;
      const slice = sorted.slice(page * pageSize, page * pageSize + pageSize);
      U.clear(tbody);
      slice.forEach((r) => {
        const tr = h('tr', { class: def.onRow ? 'is-click' : null });
        cols.forEach((c, ci) => {
          const content = cell(c, r);
          const td = h('td', { class: (c.align === 'right' ? 'is-num' : '') + (c.nowrap ? ' is-nw' : '') + (c.wideOnly ? ' is-wide' : '') || null });
          if (def.onRow && ci === 0) {
            const b = h('button', { type: 'button', class: 'of-rowbtn' });
            if (content && content.nodeType) b.appendChild(content); else b.textContent = String(content);
            b.setAttribute('aria-label', (def.rowLabel ? def.rowLabel(r) : 'Open ' + (b.textContent || 'row')));
            b.addEventListener('click', (e) => { e.stopPropagation(); def.onRow(r); });
            td.appendChild(b);
          } else if (content && content.nodeType) td.appendChild(content); else td.textContent = String(content);
          tr.appendChild(td);
        });
        if (def.onRow) tr.addEventListener('click', () => def.onRow(r));
        tbody.appendChild(tr);
      });
      const n = sorted.length;
      wrap.hidden = n === 0; foot.hidden = n === 0 || n <= pageSize;
      emptyEl.hidden = n !== 0;
      info.textContent = n ? 'Showing ' + (page * pageSize + 1) + ' to ' + (page * pageSize + slice.length) + ' of ' + n : '';
      prev.disabled = page <= 0; next.disabled = page >= pages - 1;
    }
    // Sets the message shown in place of the table when there are no rows.
    function setEmpty(e) {
      U.clear(emptyEl);
      const o = typeof e === 'string' ? { body: e } : e || {};
      emptyEl.appendChild(kit.empty({ title: o.title || 'Nothing to list yet', body: o.body || 'Rows appear here once there is data in this range.', action: o.action, icon: o.icon || 'list' }).el);
    }
    setEmpty(def.empty);
    paintHead();
    return {
      el: wrap,
      update(newRows) {
        const s = sig(newRows);
        if (s === lastSig) return;
        // keep keyboard focus: do not rebuild while the user is inside the table body
        if (doc.activeElement && tbody.contains(doc.activeElement) && lastSig) return;
        lastSig = s; rows = newRows || []; paintBody();
      },
      // Empties the table body so nothing stays in memory.
      destroy() { U.clear(tbody); },
    };
  }

  // Builds the findings list from SB.metrics.insights. def.only keeps just the findings that fit this
  // page.
  function makeInsights(host, def) {
    const list = h('ul', { class: 'of-insights' });
    const empty = h('div', { hidden: true });
    host.append(list, empty);
    let last = '';
    return {
      // Fetches the findings and redraws the list only when they changed.
      update(p) {
        let items = SB.metrics.insights(p, { limit: def.only ? 40 : def.limit || 8 });
        if (def.only) items = items.filter((i) => def.only.indexOf(i.id) >= 0).slice(0, def.limit || 8);
        const s = sig(items); if (s === last) return; last = s;
        U.clear(list); U.clear(empty);
        if (!items.length) {
          empty.hidden = false; list.hidden = true;
          empty.appendChild(kit.empty({ title: 'No findings yet', body: def.empty || 'Findings appear once there are about 20 finished tickets in the range. A longer range or sample history gives them more to work with.', icon: 'sparkle' }).el);
          return;
        }
        empty.hidden = true; list.hidden = false;
        items.forEach((it) => {
          const t = TONE[it.tone] || TONE.info;
          const li = h('li', { class: 'of-insight', dataset: { tone: it.tone } },
            h('span', { class: 'of-ins-tone' }, ico(t.icon, 18), h('span', null, t.word)),
            h('div', { class: 'of-ins-text' }, h('h3', { class: 'of-ins-title' }, it.title), h('p', { class: 'of-ins-body' }, it.body)));
          list.appendChild(li);
        });
      },
      // Empties the findings list when the page goes away.
      destroy() { U.clear(list); },
    };
  }

  // The box every card shares: title, subtitle, 'What to look for' line, action buttons and a body to
  // draw into. sub and caption may be functions of (p, ctx), so their words can follow the data.
  function cardShell(o, type) {
    const span = [3, 4, 6, 8, 12].indexOf(o.span) >= 0 ? o.span : o.span === 5 || o.span === 7 || o.span === 9 ? o.span : 6;
    const el = h('section', { class: 'of-card' + (o.variant ? ' of-card--' + o.variant : ''), dataset: { span: String(span), type: type || '' } });
    const titleId = U.uid('ct');
    const titles = h('div', { class: 'of-card-titles' });
    if (o.title) titles.appendChild(h('h2', { class: 'of-card-title', id: titleId }, o.title));
    const subEl = o.sub ? h('p', { class: 'of-card-sub' }, typeof o.sub === 'function' ? '' : o.sub) : null;
    if (subEl) titles.appendChild(subEl);
    const actions = h('div', { class: 'of-card-actions' });
    const head = h('header', { class: 'of-card-head' }, titles, actions);
    if (!o.title && !o.sub) head.hidden = true;
    if (o.title) el.setAttribute('aria-labelledby', titleId);
    el.appendChild(head);
    let captionEl = null;
    let captionText = null;
    if (o.caption) { captionText = doc.createTextNode(typeof o.caption === 'function' ? '' : o.caption); captionEl = h('p', { class: 'of-look' }, h('span', { class: 'of-look-l' }, 'What to look for: '), captionText); el.appendChild(captionEl); }
    const body = h('div', { class: 'of-card-body' });
    el.appendChild(body);
    (o.actions || []).forEach((a) => { if (a) actions.appendChild(kit.button({ label: a.label, icon: a.icon, onClick: a.onClick, small: true, ariaLabel: a.ariaLabel })); });
    // sub and caption may be functions of (p, ctx): they are re-read on every refresh and only touch the
    // DOM when the words changed
    function refreshText(p, c) {
      try {
        if (typeof o.sub === 'function' && subEl) { const t = String(o.sub(p, c) || ''); if (subEl.textContent !== t) subEl.textContent = t; subEl.hidden = !t; }
        if (typeof o.caption === 'function' && captionEl) { const t = String(o.caption(p, c) || ''); if (captionText.nodeValue !== t) captionText.nodeValue = t; captionEl.hidden = !t; }
      } catch (e) { warnOnce('card text', e); }
    }
    return { el, head, titles, subEl, actions, body, captionEl, refreshText };
  }

  // Builds one page inside container: a headline, a row of KPI tiles and a 12-column grid of cards.
  // Returns the page object whose methods (headline, tiles, section, card, panel, table, insights) add
  // the parts.
  kit.page = function (container, ctx, opts) {
    opts = opts || {};
    const id = opts.id || 'page';
    const root = h('div', { class: 'of-page', dataset: { page: id } });
    const headEl = h('p', { class: 'of-headline', hidden: true });
    const tilesHost = h('div', { class: 'of-tiles-wrap', hidden: true });
    const grid = h('div', { class: 'of-grid' });
    const coachEl = h('div', { class: 'of-coach', role: 'status', hidden: true });
    root.append(headEl, coachEl, tilesHost, grid);
    container.appendChild(root);
    const state = { headline: false, tileSets: [], slots: [], destroyed: false, cmp: null, cmpP: null, lastText: '' };
    const owner = {
      // compare gives this period against the one before, once per handle. kindOf says if a KPI is a
      // time, share or count.
      compare(p) { if (state.cmpP === p) return state.cmp; let c = null; try { c = SB.metrics.compare(p); } catch (e) { warnOnce('compare', e); } state.cmp = c; state.cmpP = p; return c; },
      kindOf(kpi) { const c = state.cmp && state.cmp.kpis && state.cmp.kpis[kpi]; return c ? c.kind : 'count'; },
    };
    // Runs fn and logs a failure once instead of throwing, so one broken card cannot blank the page.
    const guard = (what, fn) => { try { return fn(); } catch (e) { warnOnce(id + ' ' + what + ': ' + (e && e.message), e); return undefined; } };

    const page = {
      el: root, grid,
      // how adds a one-tap "How is this worked out?" note under the headline, in plain words.
      how(text) {
        const d = h('details', { class: 'of-how' }, h('summary', null, 'How is this worked out?'), h('p', null, text));
        headEl.after(d);
        return page;
      },
      // headline switches the headline sentence on and draws it. _paintHeadline redraws it from the
      // metrics handle p.
      headline() { state.headline = true; headEl.hidden = false; paintCoach(); this._paintHeadline(ctx.prepared()); return page; },
      _paintHeadline(p) {
        if (!state.headline) return;
        const text = guard('headline', () => SB.metrics.headline(id, p)) || 'No data to summarize yet.';
        paintHeadline(headEl, text);
      },
      // Adds a row of KPI tiles (value, change arrow with a word, sparkline) from the tile definitions.
      tiles(defs) {
        tilesHost.hidden = false;
        const list = h('ul', { class: 'of-tiles' });
        const p = ctx.prepared();
        const tiles = (defs || []).map((d) => makeTile(d, owner));
        tiles.forEach((t) => list.appendChild(t.el));
        const noteT = h('span');
        const note = h('p', { class: 'of-tiles-note' }, ico('arrow-right', 14), noteT);
        list.setAttribute('data-n', String(Math.min(6, Math.max(1, tiles.length))));
        tilesHost.append(list, note);
        const set = { tiles, note, list, noteT };
        state.tileSets.push(set);
        paintNote(set);
        guard('tiles', () => tiles.forEach((t) => t.update(p, ctx)));
        return page;
      },
      // Adds a full-width heading with an optional one-line explanation.
      section(title, sub) {
        const sec = h('div', { class: 'of-section' }, h('h2', { class: 'of-section-t' }, title), sub ? h('p', { class: 'of-section-s' }, sub) : null);
        grid.appendChild(sec); page.lastSection = sec;
        if (state.moreOn) sec.dataset.more = '1';
        return page;
      },
      // more adds a quiet button row; everything added after it stays folded away until the button is pressed.
      more(label) {
        state.moreOn = true;
        const btn = h('button', { type: 'button', class: 'btn of-more-btn', 'aria-expanded': 'false' }, label || 'Show more');
        // Opens or folds the extra cards, then nudges charts to measure themselves again.
        const toggle = () => {
          const open = grid.dataset.moreOpen !== 'true';
          grid.dataset.moreOpen = open ? 'true' : 'false'; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          btn.textContent = open ? 'Show less' : (label || 'Show more');
          if (open) { try { g.dispatchEvent(new Event('resize')); } catch (e) { /* charts catch up on the next refresh */ } }
        };
        btn.addEventListener('click', toggle);
        grid.dataset.moreOpen = 'false';
        grid.appendChild(h('div', { class: 'of-more' }, btn));
        return page;
      },
      // card adds a chart card and panel adds a free-form box. Both go in the grid in the order they are
      // called.
      card(o) { return addSlot(makeCard(o)); },
      panel(o) { return addSlot(makePanel(o)); },
      // table adds a sortable table card and insights adds the findings list.
      table(o) { return addSlot(makeTableCard(o)); },
      insights(o) { return addSlot(makeInsightsCard(o || {})); },
      // refresh redraws everything now. destroy removes the page and everything it built, charts
      // included.
      refresh() { refreshAll(ctx.prepared()); return page; },
      destroy() {
        if (state.destroyed) return; state.destroyed = true;
        state.slots.slice().forEach((s) => { guard('destroy', () => s.destroy()); });
        state.slots.length = 0;
        state.tileSets.forEach((s) => s.tiles.forEach((t) => guard('tile destroy', () => t.destroy())));
        state.tileSets.length = 0;
        kitPagesLive.delete(page);
        if (ctx._rec) ctx._rec.kitPages.delete(page);
        if (offFilter) { offFilter(); offFilter = null; }
        root.remove();
      },
      // The frame calls this with the new metrics handle after a filter or data change.
      _refresh(p) { refreshAll(p); },
    };
    let offFilter = null;
    kitPagesLive.add(page);
    if (ctx._rec) ctx._rec.kitPages.add(page); else offFilter = ctx.onFilterChange(() => page.refresh());

    // Adds a built card to the grid, remembers it for refresh and clean-up, and draws it once.
    function addSlot(slot) {
      state.slots.push(slot); grid.appendChild(slot.el);
      if (state.moreOn) slot.el.dataset.more = '1';
      cardsLive.add(slot);
      // Wraps the card's destroy so it also leaves the live-card list that the leak counters read.
      const orig = slot.destroy; slot.destroy = () => { cardsLive.delete(slot); orig(); };
      guard('first paint', () => slot.update(ctx.prepared(), ctx));
      return slot;
    }
    // Sets the small note under the tiles: what the arrows compare with, or why there are no arrows.
    function paintNote(set) {
      const days = Math.max(1, Math.round((ctx.filters.range.to - ctx.filters.range.from) / DAY));
      const thin = typeof ctx.previousCoverage === 'function' && ctx.previousCoverage() < THIN_PREV;
      const t = thin ? 'Not enough earlier days to compare with, so no arrows. Last 7 days has a full week before it.' : 'Arrows compare with the ' + (days === 1 ? 'day' : days + ' days') + ' before this range.';
      if (set.noteT.textContent !== t) set.noteT.textContent = t;
    }
    // Counts what falls inside the range (tickets, batches, safety records) for the empty-state coach.
    function coachFacts() {
      const ds = ctx.dataset(), r = ctx.filters.range, inR = (t) => isNum(t) && t >= r.from && t < r.to;
      let tickets = 0, batches = 0, records = 0, discards = 0, finished = 0, paid = 0;
      let onBoard = 0;
      for (const t of ds.tickets || []) if (inR(t.createdAt)) { tickets++; if (t.status === 'active') onBoard++; else if (t.status !== 'voided') finished++; }
      for (const o of ds.orders || []) { if (inR(o.createdAt)) tickets++; if (o.status === 'paid' && inR(o.paidAt)) paid++; }
      for (const b of ds.batches || []) if (b.src !== 'starter' && inR(b.enteredAt)) batches++;
      for (const e of ds.events || []) if (e && (e.type === 'temp_logged' || e.type === 'sanitize_done' || e.type === 'batch_discard') && inR(e.t)) { records++; if (e.type === 'batch_discard') discards++; }
      return { anyLive: !!(ds.counts && ds.counts.live > 0), tickets, finished, onBoard, paid, batches, records, discards, label: r.label };
    }
    // Shows the "what to do next" message in place of blank tiles and charts when the range has no data.
    function paintCoach() {
      const c = guard('coach', () => coachText(id, coachFacts()));
      const on = !!c;
      root.dataset.coach = on ? 'on' : 'off'; coachEl.hidden = !on;
      if (!on) { coachEl.__key = ''; return; }
      const canSample = !!(SB.sim && typeof SB.sim.setSampleEnabled === 'function') && !sampleFlag() && id !== 'data';
      const key = c.title + '|' + c.body + '|' + canSample;
      if (coachEl.__key === key) return;
      coachEl.__key = key;
      const pg = PAGES.find((x) => x.id === id);
      const kids = [h('span', { class: 'of-coach-i', 'aria-hidden': 'true' }, ico(pg ? pg.icon : 'info', 28)), h('h2', { class: 'of-coach-t' }, c.title), h('p', { class: 'of-coach-b' }, c.body)];
      if (canSample) kids.push(h('button', { type: 'button', class: 'btn btn-sm of-coach-sample', onClick: showSampleNumbers }, 'Show sample numbers'),
        h('p', { class: 'of-coach-n' }, 'Sample numbers are generated so you can see what this page looks like. They are labeled sample and never mixed into your own.'));
      coachEl.replaceChildren(...kids);
    }
    // Redraws the headline, the tiles and every card from the metrics handle p.
    function refreshAll(p) {
      if (state.destroyed) return;
      paintCoach();
      page._paintHeadline(p);
      state.tileSets.forEach((s) => { paintNote(s); guard('tiles', () => s.tiles.forEach((t) => t.update(p, ctx))); });
      state.slots.forEach((s) => s.update(p, ctx));
    }

    // Builds a chart card. The chart is only touched when its spec changed since the last refresh.
    function makeCard(o) {
      o = o || {};
      const sh = cardShell(o, o.type);
      const hostEl = h('div', { class: 'of-chart' });
      const emptyHost = h('div', { class: 'of-card-empty', hidden: true });
      const errHost = h('div', { class: 'of-card-err', hidden: true });
      sh.body.append(hostEl, emptyHost, errHost);
      let chart = null, lastSig = '', lastErr = '', btn = null;
      const emptyText = typeof o.empty === 'string' ? o.empty : null;
      const slot = {
        // A chart card: el is the card, chart is the live chart (null while empty), setTable flips View
        // as table.
        el: sh.el, get chart() { return chart; }, card: true,
        setTable(on) { if (chart) chart.setTable(!!on); },
        // Reads the spec from the page. No spec shows the empty message, a throw shows an error card in
        // place, otherwise the chart is drawn or updated.
        update(p, c) {
          let spec;
          sh.refreshText(p, c || ctx);
          try { spec = o.spec ? o.spec(p, c || ctx) : null; errHost.hidden = true; lastErr = ''; }
          catch (e) {
            const msg = (e && e.message) || String(e);
            if (msg !== lastErr) { lastErr = msg; warnOnce((o.title || o.type) + ' spec: ' + msg, e); }
            U.clear(errHost); errHost.hidden = false; errHost.appendChild(kit.errorCard({ title: (o.title || 'This chart') + ' could not be drawn', body: 'The data is unchanged. Try another range, or open another page and come back.', details: e && e.stack }).el);
            hostEl.hidden = true; emptyHost.hidden = true; return;
          }
          if (!spec) {
            hostEl.hidden = true; errHost.hidden = true;
            if (chart) { chart.destroy(); chart = null; btn = null; lastSig = ''; }
            const eo = o.empty && typeof o.empty === 'object' ? o.empty : { body: emptyText };
            U.clear(emptyHost); emptyHost.hidden = false;
            emptyHost.appendChild(kit.empty({ title: eo.title || 'Not enough data yet', body: eo.body || 'Finished tickets in this range will fill this chart.', icon: eo.icon || 'chart-bar', action: eo.action }).el);
            return;
          }
          emptyHost.hidden = true; hostEl.hidden = false;
          const full = Object.assign({ table: o.table !== false, empty: (o.empty && typeof o.empty === 'object' ? o.empty.body : emptyText) || 'Not enough data yet. Finished tickets in this range will fill this chart.' }, spec);
          if (o.height && !full.height) full.height = o.height;
          if (o.onSelect && !full.onSelect) full.onSelect = o.onSelect;
          if (!full.ariaLabel) full.ariaLabel = (o.title || 'Chart') + (o.caption ? '. ' + o.caption : '');
          const s = sig(full);
          if (chart && s === lastSig) return;
          lastSig = s;
          if (!chart) {
            if (typeof SB.charts[o.type] !== 'function') throw new Error('Unknown chart type "' + o.type + '"');
            chart = SB.charts[o.type](hostEl, full);
            // the chart brings its own "View as table" button; it lives in the card header next to the
            // other actions
            btn = chart.el.querySelector('.ch-tbtn');
            if (btn) sh.actions.appendChild(btn);
          } else chart.update(full);
          sh.head.hidden = !(o.title || o.sub || sh.actions.querySelector('button:not([hidden])'));
        },
        // Destroys the chart and removes the card.
        destroy() { if (chart) { guard('chart destroy', () => chart.destroy()); chart = null; } btn = null; sh.el.remove(); },
      };
      return slot;
    }

    // Builds a free-form card: the page draws whatever it likes into the body and may return {update,
    // destroy}.
    function makePanel(o) {
      o = o || {};
      const sh = cardShell(o, 'panel');
      let inst = null, created = false;
      const slot = {
        el: sh.el, body: sh.body, panel: true,
        // The first call runs the page's render function. Later calls pass the new handle to its update.
        update(p, c) {
          sh.refreshText(p, c || ctx);
          if (!created) {
            created = true;
            try { inst = typeof o.render === 'function' ? o.render(sh.body, p, c || ctx) : null; }
            catch (e) { warnOnce((o.title || 'panel') + ' render: ' + (e && e.message), e); U.clear(sh.body); sh.body.appendChild(kit.errorCard({ title: (o.title || 'This panel') + ' could not be drawn', details: e && e.stack }).el); }
            return;
          }
          if (inst && typeof inst.update === 'function') { try { inst.update(p, c || ctx); } catch (e) { warnOnce((o.title || 'panel') + ' update: ' + (e && e.message), e); } }
        },
        // Runs the page's own cleanup, then removes the card.
        destroy() { if (inst && typeof inst.destroy === 'function') { try { inst.destroy(); } catch (e) { warnOnce('panel destroy', e); } } inst = null; sh.el.remove(); },
      };
      return slot;
    }

    // Builds a card around a sortable table. The rows come from the page's rows(p, ctx) function.
    function makeTableCard(o) {
      o = o || {};
      const sh = cardShell(Object.assign({ span: 12 }, o), 'table');
      let tbl = null;
      return {
        el: sh.el, table: true,
        // Re-reads the rows and hands them to the table, which redraws only if they changed.
        update(p, c) {
          sh.refreshText(p, c || ctx);
          if (!tbl) tbl = makeTable(sh.body, o, o.title);
          let rows = [];
          try { rows = (o.rows ? o.rows(p, c || ctx) : []) || []; } catch (e) { warnOnce((o.title || 'table') + ' rows: ' + (e && e.message), e); rows = []; }
          tbl.update(rows);
        },
        // Removes the table and its card.
        destroy() { if (tbl) tbl.destroy(); tbl = null; sh.el.remove(); },
      };
    }

    // Builds the findings card (default title 'What the data says') around the findings list.
    function makeInsightsCard(o) {
      const sh = cardShell({ span: o.span || 12, title: o.title || 'What the data says', sub: o.sub || 'Plain findings from the numbers on this page, most important first.', variant: o.variant || 'plain' }, 'insights');
      const ins = makeInsights(sh.body, o);
      // update passes the new handle to the list. destroy empties the list and removes the card.
      return { el: sh.el, update: (p) => ins.update(p), destroy() { ins.destroy(); sh.el.remove(); } };
    }

    return page;
  };

  O.registerPage = function (id, def) {
    // Registers a page file's page (id, title, icon, order, render) so the rail and router can show it.
    if (typeof id !== 'string' || !def || typeof def.render !== 'function') return false;
    const base = PAGES.find((p) => p.id === id) || { id, title: id, icon: 'list' };
    registry[id] = { id, title: def.title || base.title, short: base.short || def.title || id, icon: def.icon || base.icon, order: isNum(def.order) ? def.order : PAGE_IDS.indexOf(id) + 1, render: def.render };
    if (M) { paintRail(); if (M.pageId === id && M.cur && M.cur.placeholder) showPage(id, { focus: false }); }
    return true;
  };
  // The seven pages with their titles and whether each is registered yet. The rail reads this.
  O.pages = () => PAGES.map((p) => Object.assign({}, p, registry[p.id] ? { title: registry[p.id].title, icon: registry[p.id].icon, ready: true } : { ready: false }));
  // current says which page is showing and isMounted says if the office is open.
  O.current = () => (M ? M.pageId : null);
  O.isMounted = () => !!M;
  // filters gives the live filter state. refresh redraws the page now (for other files and tests).
  O.filters = () => (M ? M.filters : null);
  O.refresh = () => { if (M) refreshNow(true); };

  // Builds the empty frame: rail, title row, filter bar and main area. Pages are drawn into main later.
  function buildFrame() {
    const rail = h('nav', { class: 'of-rail', 'aria-label': 'Back office pages' });
    const railBrand = h('div', { class: 'of-rail-brand' }, SB.icons.brand ? SB.icons.brand(30) : ico('flame', 28), h('span', { class: 'of-rail-name' }, 'Back office'));
    const railList = h('ul', { class: 'of-rail-list' });
    rail.append(railBrand, railList);

    const title = h('h1', { class: 'of-title', id: 'of-title', tabindex: '-1' }, 'Speed');
    const themeBtn = h('button', { type: 'button', class: 'btn btn-ghost of-theme' });
    const backBtn = h('button', { type: 'button', class: 'btn of-back', dataset: { backToLine: '' } }, ico('door', 22), h('span', null, 'Back to the board'));
    const top = h('header', { class: 'of-top' }, title, h('div', { class: 'of-top-actions' }, themeBtn, backBtn));

    const filters = h('div', { class: 'of-filters', role: 'group', 'aria-label': 'Filters', dataset: { open: 'false' } });
    const main = h('main', { class: 'of-main', id: 'of-main' });
    const col = h('div', { class: 'of-col' }, top, filters, main);
    const root = h('div', { class: 'of', dataset: { page: 'pace' } }, rail, col);
    return { root, rail, railList, title, themeBtn, backBtn, top, filters, main, col };
  }

  // One rail entry: a link for a registered page, or a greyed 'coming soon' entry that does nothing.
  function railItem(p) {
    const r = registry[p.id];
    const title = r ? r.title : p.title;
    const icon = r ? r.icon : p.icon;
    const current = M && M.pageId === p.id;
    if (!r) {
      return h('li', { class: 'of-rail-li' }, h('span', { class: 'of-nav is-soon', role: 'link', 'aria-disabled': 'true', 'aria-label': title + ', coming soon', title: title + ' is coming soon' },
        ico(icon, 22), h('span', { class: 'of-nav-w' }, h('span', { class: 'of-nav-full' }, title), h('span', { class: 'of-nav-short', 'aria-hidden': 'true' }, p.short), h('span', { class: 'of-soon' }, 'Coming soon'))));
    }
    const a = h('a', { class: 'of-nav', href: '#/office' + (p.id === 'pace' ? '' : '/' + p.id), dataset: { page: p.id }, title });
    if (current) a.setAttribute('aria-current', 'page');
    const off = pageIsOff(p.id);
    if (off) { a.classList.add('is-off'); a.title = title + (COUNTER_PAGES[p.id] && counterOn() ? ' (counter service: not measured)' : ' (not tracking cooked-ahead food)'); }
    a.append(ico(icon, 22), h('span', { class: 'of-nav-w' }, h('span', { class: 'of-nav-full' }, title), h('span', { class: 'of-nav-short' }, p.short), off ? h('span', { class: 'of-nav-off' }, COUNTER_PAGES[p.id] ? 'Not measured' : 'Not tracking') : null));
    a.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return; e.preventDefault(); O.navigate(p.id); });
    return h('li', { class: 'of-rail-li' }, a);
  }
  // Redraws the rail (needed when a page registers late or the current page changes).
  function paintRail() {
    if (!M) return;
    U.clear(M.f.railList);
    PAGES.forEach((p) => M.f.railList.appendChild(railItem(p)));
  }

  // Shows the Day/Night button for the look you would switch to (sun for Day, moon for Night), the same
  // words as the board's Settings.
  function paintThemeBtn() {
    if (!M) return;
    const dark = (SB.theme ? SB.theme.office() : 'ember') === 'ember';
    const b = M.f.themeBtn; U.clear(b);
    b.append(ico(dark ? 'sun' : 'moon', 20), h('span', { class: 'of-theme-w' }, dark ? 'Day' : 'Night'));
    b.setAttribute('aria-label', 'Switch to ' + (dark ? 'Day (light)' : 'Night (dark)'));
  }

  // Builds the sticky filter bar: range buttons, two custom date boxes, channel menu, source buttons and
  // the banner.
  function buildFilters() {
    const F = M.filters, f = M.f, sc = M.scope;
    const summary = h('button', { type: 'button', class: 'of-fsum', 'aria-expanded': 'false', 'aria-controls': 'of-fbody' });
    const body = h('div', { class: 'of-fbody', id: 'of-fbody' });
    const presets = [{ id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'last7', label: 'Last 7 days' }, { id: 'last14', label: 'Last 14 days' }, { id: 'day', label: 'Pick a day' }, { id: 'custom', label: 'Custom' }];

    // The range buttons: Today, Yesterday, Last 7 days, Last 14 days and Custom.
    const rangeSeg = SB.ui.segmented({ options: presets, value: F.range.id, label: 'Date range', onChange: (id) => setRange(id) });
    rangeSeg.classList.add('of-seg');
    const dFrom = h('input', { type: 'date', class: 'input of-date', 'aria-label': 'From date' });
    const dTo = h('input', { type: 'date', class: 'input of-date', 'aria-label': 'To date (included)' });
    const dErr = h('p', { class: 'of-ferr', role: 'alert', hidden: true });
    // The day picker: one date with Previous day and Next day arrows beside the presets.
    const dayPrev = h('button', { type: 'button', class: 'btn of-daybtn', 'aria-label': 'Previous day' }, ico('chevron-left', 20));
    const dayNext = h('button', { type: 'button', class: 'btn of-daybtn', 'aria-label': 'Next day' }, ico('chevron-right', 20));
    const dayIn = h('input', { type: 'date', class: 'input of-date of-dayin', 'aria-label': 'Pick one day' });
    const dayErr = h('p', { class: 'of-ferr', role: 'alert', hidden: true });
    const dayBox = h('div', { class: 'of-daypick', role: 'group', 'aria-label': 'Single day' }, dayPrev, dayIn, dayNext);
    const custom = h('div', { class: 'of-custom', hidden: F.range.id !== 'custom' }, h('label', { class: 'of-flab' }, h('span', null, 'From'), dFrom), h('label', { class: 'of-flab' }, h('span', null, 'To'), dTo), dErr);

    const chanSel = h('select', { class: 'select of-select', id: 'of-channel', 'aria-label': 'Channel' },
      h('option', { value: 'all' }, 'All channels'), channelList().map((c) => h('option', { value: c.id }, c.name)));
    chanSel.value = F.channel;
    // The Show buttons: your own tickets only, or with the made-up sample days. Shown only while sample days exist.
    const srcSeg = SB.ui.segmented({ options: [{ id: 'live', label: 'Your tickets only' }, { id: 'all', label: 'With sample days' }], value: F.source, label: 'Show', onChange: (id) => setSource(id) });
    srcSeg.classList.add('of-seg');
    const srcNote = h('span', { class: 'of-fnote', hidden: true });

    // The Day group only shows for Yesterday or Pick a day, so the other filters fit on one row.
    // Seven weekday buttons: each jumps to the most recent such day (today counts once something was ordered), so "Friday" is one tap.
    const wdRow = h('div', { class: 'of-wdrow', role: 'group', 'aria-label': 'Jump to a weekday' });
    // Shows the most recent day with this weekday number (0 is Sunday), looking back up to a week.
    const jumpWeekday = (wd) => {
      const today = U.serviceDate(nowMs(), svcHour());
      let todayHas = false;
      try { todayHas = (storeDataset(false).tickets || []).some((t) => t && t.serviceDate === today); } catch (e) { todayHas = false; }
      // Today only counts when something was ordered today; otherwise the same weekday last week is meant.
      for (let i = todayHas ? 0 : 1; i < 8; i++) { const k = U.addDays(today, -i); if (U.weekday(k) === wd) { showDay(k, true); return; } }
    };
    [1, 2, 3, 4, 5, 6, 0].forEach((wd) => {
      // Handles a tap on one weekday button.
      const onTap = () => jumpWeekday(wd);
      wdRow.appendChild(h('button', { type: 'button', class: 'btn btn-sm of-wd', onClick: onTap }, U.WEEKDAYS[wd]));
    });
    const dayGroup = h('div', { class: 'of-fg', hidden: true }, h('span', { class: 'of-fl' }, 'Day'), dayBox, wdRow, dayErr);
    body.append(
      h('div', { class: 'of-fg' }, h('span', { class: 'of-fl' }, 'Range'), rangeSeg),
      dayGroup,
      custom,
      h('div', { class: 'of-fg' }, h('label', { class: 'of-fl', for: 'of-channel' }, 'Channel'), chanSel),
      h('div', { class: 'of-fg of-srcg' }, h('span', { class: 'of-fl' }, 'Show'), srcSeg, srcNote));
    const banner = h('p', { class: 'of-banner', role: 'status' }, h('span', { class: 'of-chip', hidden: true }, 'Sample data'), h('span', { class: 'of-banner-t' }));
    f.filters.append(summary, body, banner);
    Object.assign(M, { dayGroup, dayPrev, dayNext, dayIn, dayErr, rangeSeg, srcSeg, chanSel, dFrom, dTo, dErr, custom, banner, summary, srcNote, fbody: body });

    sc.on(summary, 'click', () => { const open = f.filters.dataset.open !== 'true'; f.filters.dataset.open = open ? 'true' : 'false'; summary.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    sc.on(chanSel, 'change', () => { F.channel = chanSel.value; filtersChanged('Channel: ' + (chanSel.selectedOptions[0] ? chanSel.selectedOptions[0].textContent : F.channel)); });
    // Either date box changing re-checks the custom range.
    const onDate = () => applyCustom();
    sc.on(dFrom, 'change', onDate); sc.on(dTo, 'change', onDate);
    // The arrows step one service day; the box jumps to any date up to today.
    sc.on(dayPrev, 'click', () => stepDay(-1));
    sc.on(dayNext, 'click', () => stepDay(1));
    sc.on(dayIn, 'change', () => pickDay(dayIn.value));
    paintDayPicker();
    paintSourceNote();
    paintFilterSummary();
  }

  // Keeps the day picker in step with the range: shows its last day, stops the date box going past
  // today, and turns Next off when today is already showing.
  function paintDayPicker() {
    if (!M.dayIn) return;
    const today = U.serviceDate(nowMs(), svcHour());
    const key = pickerKey(M.filters.range, today);
    M.dayIn.max = today; M.dayIn.value = key;
    M.dayNext.disabled = key >= today;
    M.dayErr.hidden = true; M.dayIn.removeAttribute('aria-invalid');
    M.dayGroup.hidden = !(M.filters.range.id === 'day' || M.filters.range.id === 'yesterday');
  }
  // Shows exactly one service day. Stepping onto today gives the live Today preset so it keeps rolling
  // forward; any other day (or the Pick a day button, fixed = true) is a fixed 'day' range.
  function showDay(key, fixed) {
    const dsh = svcHour(), F = M.filters;
    M.custom.hidden = true; M.dErr.hidden = true;
    if (!fixed && key === U.serviceDate(nowMs(), dsh)) { F.range = presetRange('today'); M.rangeSeg.setValue('today'); }
    else { const r = dayRange(key, dsh); if (!r.ok) return; F.range = r.range; M.rangeSeg.setValue('day'); }
    M.bannerCache = null;
    filtersChanged(F.range.label);
  }
  // An arrow was pressed: one service day earlier or later than the day showing (or than today when a
  // many-day range is showing).
  function stepDay(delta) {
    const today = U.serviceDate(nowMs(), svcHour()), F = M.filters;
    const base = F.range.fromKey && F.range.fromKey === F.range.toKey ? F.range.toKey : today;
    const next = stepDayKey(base, delta, today);
    if (next) showDay(next);
  }
  // The date box changed: a valid date up to today is shown, anything else gets a plain message.
  function pickDay(value) {
    const today = U.serviceDate(nowMs(), svcHour());
    if (!validKey(value) || value > today) {
      M.dayErr.textContent = validKey(value) ? 'That day has not happened yet.' : 'Pick a date.';
      M.dayErr.hidden = false; M.dayIn.setAttribute('aria-invalid', 'true'); return;
    }
    showDay(value);
  }

  // A range button was pressed. Custom opens the two date boxes pre-filled; the others apply at once.
  function setRange(id) {
    const F = M.filters;
    if (id === 'day') { showDay(pickerKey(F.range, U.serviceDate(nowMs(), svcHour())), true); return; }
    if (id === 'custom') {
      const base = F.range.id === 'custom' ? F.range : presetRange('last14');
      M.dFrom.value = base.fromKey || ''; M.dTo.value = base.toKey || '';
      M.custom.hidden = false;
      const dsh = svcHour();
      const today = U.serviceDate(nowMs(), dsh);
      M.dFrom.max = today; M.dTo.max = today;
      const r = customRange(M.dFrom.value, M.dTo.value, dsh);
      if (r.ok) F.range = r.range;
      filtersChanged('Custom range: ' + F.range.label);
      try { M.dFrom.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      return;
    }
    M.custom.hidden = true; M.dErr.hidden = true;
    F.range = presetRange(id);
    filtersChanged(F.range.label);
  }
  // Checks the two dates and applies the custom range, or shows a plain message when they are wrong.
  function applyCustom() {
    const r = customRange(M.dFrom.value, M.dTo.value, svcHour());
    if (!r.ok) { M.dErr.textContent = r.message + ' Pick dates in order.'; M.dErr.hidden = false; M.dFrom.setAttribute('aria-invalid', 'true'); M.dTo.setAttribute('aria-invalid', 'true'); return; }
    M.dErr.hidden = true; M.dFrom.removeAttribute('aria-invalid'); M.dTo.removeAttribute('aria-invalid');
    M.filters.range = r.range;
    filtersChanged('Range: ' + r.range.label);
  }
  // A source button was pressed. Live plus sample is refused, with a spoken reason, when there is no
  // sample history.
  function setSource(id) {
    const F = M.filters;
    if (id === 'all' && !(sampleFlag() && sampleLoaded())) {
      M.srcSeg.setValue('live'); F.source = 'live';
      if (SB.ui && SB.ui.announce) SB.ui.announce('There are no sample days to show.');
      paintSourceNote(); return;
    }
    M.forcedLive = false; F.source = id; filtersChanged(id === 'all' ? 'your tickets with sample days' : 'your tickets only');
  }
  // Hides the Show buttons when there are no sample days to mix in (none made, or switched off), and
  // falls back to your own tickets only.
  function paintSourceNote() {
    const ok = sampleFlag() && sampleLoaded();
    const grp = M.srcSeg.closest('.of-srcg');
    if (grp) grp.hidden = !ok;
    M.srcNote.hidden = true;
    if (!ok && M.filters.source === 'all') { M.filters.source = 'live'; M.forcedLive = true; M.srcSeg.setValue('live'); }
  }
  // The one-line summary of the filters that stands in for the filter bar on a phone.
  function paintFilterSummary() {
    const F = M.filters;
    const chan = F.channel === 'all' ? 'All channels' : ((channelList().find((c) => c.id === F.channel) || {}).name || F.channel);
    // The sample choice is only named while sample days exist.
    const src = sampleFlag() && sampleLoaded() ? ', ' + (F.source === 'all' ? 'with sample days' : 'your tickets only') : '';
    M.summary.replaceChildren(h('span', { class: 'of-fsum-t' }, F.range.label + ', ' + chan + src), ico('chevron-down', 18, { class: 'of-fsum-i' }));
    M.summary.setAttribute('aria-label', 'Filters: ' + F.range.label + ', ' + chan + src + '. Show or hide the filters');
  }
  // After any filter change: update the summary, redraw every card now and tell screen readers what is
  // showing.
  function filtersChanged(announce) {
    paintFilterSummary();
    paintDayPicker();
    paintSourceNote();
    refreshNow(true);
    if (announce && SB.ui && SB.ui.announce) SB.ui.announce('Showing ' + announce);
  }

  // Redraws the one-line data banner (sample days, live and demo tickets) from the tickets inside the
  // range. The count is cached while the range, channel and data stay the same.
  function paintBanner(ctx) {
    const F = M.filters, ds = ctx.dataset();
    const key = ds && ds.tickets ? ds : null;
    let info;
    const c = M.bannerCache;
    if (c && c.ds === key && c.from === F.range.from && c.to === F.range.to && c.channel === F.channel && c.n === (key ? key.tickets.length : 0)) info = c.info;
    else {
      const days = new Set(); let sampleTickets = 0, liveN = 0, demo = 0, total = 0;
      const dsh = svcHour();
      for (const t of (ds && ds.tickets) || []) {
        if (!t || !isNum(t.createdAt) || t.createdAt < F.range.from || t.createdAt >= F.range.to) continue;
        if (F.channel !== 'all' && t.channel !== F.channel) continue;
        total++;
        if (t.src === 'sample') { sampleTickets++; days.add(U.serviceDate(t.createdAt, dsh)); } else if (t.src === 'demo') demo++; else liveN++;
      }
      info = { sampleDays: days.size, sampleTickets, live: liveN, demo, total: liveN + demo, sampleLoaded: sampleLoaded(), sampleEnabled: sampleFlag(), sampleWanted: F.source === 'all' };
      M.bannerCache = { ds: key, from: F.range.from, to: F.range.to, channel: F.channel, n: key ? key.tickets.length : 0, info };
    }
    const b = bannerText(info);
    // Pages that add up history say when the range reaches days that were cleared from this tablet (the safety record keeps its own).
    if (M.pageId !== 'safety' && M.pageId !== 'data') { const aw = O.archivedWords(ds && ds.archivedBefore, F.range.from, svcHour()); if (aw) b.text += (b.text ? ' ' : '') + aw; const dw = O.droppedRangeWords(ds && ds.droppedBefore, F.range.from, svcHour()); if (dw) b.text += (b.text ? ' ' : '') + dw; }
    // The Menu, prices and shop page has no range, so it gets no range line.
    if (M.pageId === 'data') b.text = '';
    const t = M.banner.querySelector('.of-banner-t');
    if (t.textContent !== b.text) t.textContent = b.text;
    M.banner.hidden = !b.text;
    M.banner.dataset.kind = b.kind;
    M.banner.querySelector('.of-chip').hidden = b.kind !== 'sample';
  }

  // Shows one page: tears down the old one, updates the title and rail, then builds the new one.
  // WATCH OUT: a page that throws becomes an inline error card, and the other pages keep working.
  function showPage(id, o) {
    o = o || {};
    if (!M) return;
    const f = M.f;
    // tear the old page down
    destroyCurrent();
    M.pageId = id;
    f.root.dataset.page = id;
    const reg = registry[id], base = PAGES.find((p) => p.id === id);
    f.title.textContent = (reg ? reg.title : base.title);
    paintRail();
    M.gen++; M.prep = null;
    const rec = { id, listeners: [], kitPages: new Set(), inst: null, container: h('div', { class: 'of-slot' }), placeholder: false };
    M.cur = rec;
    U.clear(f.main); f.main.appendChild(rec.container);
    f.col.scrollTop = 0;
    const ctx = makeCtx(rec); rec.ctx = ctx;
    f.root.dataset.gated = pageIsOff(id) ? 'true' : 'false';
    if (pageIsOff(id)) {
      // Nothing to chart: say so in one plain card with a way to turn the tracking on.
      const g = gateFor(id);
      rec.container.appendChild(kit.empty({ title: g.title, body: g.body, icon: base.icon, action: g.action }).el);
    } else if (!reg) {
      rec.placeholder = true;
      // A page that is not registered yet shows a 'coming soon' box with a way back to Pace.
      rec.container.appendChild(kit.empty({ title: base.title + ' is coming soon', body: 'This page is not part of this build yet. The other pages work, and your data is not affected.', icon: base.icon, action: id === 'pace' ? null : { label: 'Go to Pace', onClick: () => O.navigate('pace') } }).el);
    } else {
      try { rec.inst = reg.render(rec.container, ctx) || null; }
      catch (e) {
        console.error('[smokebox] office page "' + id + '" failed to render', e);
        destroyKitPages(rec);
        U.clear(rec.container);
        rec.container.appendChild(kit.errorCard({ title: reg.title + ' could not be drawn', body: 'Something went wrong while building this page. The other pages still work. Open one of them, then come back and try again.', details: (e && e.stack) || String(e) }).el);
        rec.inst = null;
      }
    }
    // The Safety page gets a small bar to print the food safety record (only when cooked-ahead food is tracked).
    if (id === 'safety' && !pageIsOff(id) && typeof O.safetyLogBar === 'function' && rec.container.firstChild) { try { rec.container.insertBefore(O.safetyLogBar(), rec.container.firstChild); } catch (e) { warnOnce('safety log bar', e); } }
    paintBanner(ctx);
    if (o.focus) { try { f.title.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  // Pages that only make sense when the owner tracks cooked-ahead food (batches, hold cabinet, temperature checks).
  const GATED = {
    safety: { title: 'Safety records are off', body: 'You are not tracking cooked-ahead food, so there are no batches, temperature checks or hold times to report on. If you cook food ahead and hold it hot or cold, tap Yes, I cook food ahead below.' },
    stock: { title: 'Stock tracking is off', body: 'You are not tracking cooked-ahead food, so this page has no stock to show. If you cook food ahead and want to know when it runs out, tap Yes, I cook food ahead below.' },
  };
  // True when the cook-ahead module is on; a missing setting counts as on, so old saves and the demo are unchanged.
  function cookAheadOn() {
    try { return !(SB.engine && SB.store && typeof SB.engine.moduleOn === 'function') || SB.engine.moduleOn(SB.store.getState(), 'cookAhead'); } catch (e) { return true; }
  }
  // True when this page is one of the gated pages and the owner is not tracking cooked-ahead food.
  const pageIsOff = (id) => (!!GATED[id] && !cookAheadOn()) || (!!COUNTER_PAGES[id] && counterOn());
  // Pages about kitchen speed: with counter service the kitchen does not send tickets out one by one, so these times are not measured.
  const COUNTER_PAGES = { pace: 1, tickets: 1, stations: 1 };
  // True when the kitchen runs counter service (orders are paid and handed over at the counter). An absent setting means no.
  function counterOn() {
    try { const s = SB.store.getState(); return !!(s && s.settings && s.settings.service && s.settings.service.counter === true); } catch (e) { return false; }
  }
  // Opens the Sales and money page from the counter-service card.
  const goMoney = () => O.navigate('money');
  // The explanation card for a page that is switched off, with its one action.
  function gateFor(id) {
    if (COUNTER_PAGES[id] && counterOn()) return { title: 'Counter service: kitchen times are not measured', body: 'With counter service an order is paid and handed over at the counter, so the kitchen does not send tickets out one by one. Speed numbers would be meaningless here, so this page is off. Your sales are on Sales and money.', action: { label: 'Open Sales and money', onClick: goMoney } };
    // Turns on cooked-ahead tracking for the page that was switched off.
    const turnOn = () => turnOnCookAhead(id);
    return Object.assign({}, GATED[id], { action: { label: 'Yes, I cook food ahead', onClick: turnOn } });
  }
  // Turns the cook-ahead module on from the explanation card, then shows the page again.
  function turnOnCookAhead(id) {
    let rep = 'error';
    try { rep = SB.store.dispatch('updateSettings', { patch: { modules: { cookAhead: true } } }); } catch (e) { /* shown below */ }
    if (rep !== 'ok' && SB.ui && SB.ui.toast) { SB.ui.toast('Could not turn it on. On the board, tap Settings, then Dishes and prices, then Yes, I cook ahead.', { tone: 'bad' }); return; }
    if (M) showPage(id, { focus: false });
  }

  // Destroys every kit page that this page built, then forgets them.
  function destroyKitPages(rec) { Array.from(rec.kitPages).forEach((kp) => { try { kp.destroy(); } catch (e) { warnOnce('kit page destroy', e); } }); rec.kitPages.clear(); }
  // Tears down the page on screen: its own destroy, its kit pages and its listeners.
  function destroyCurrent() {
    const rec = M && M.cur; if (!rec) return;
    try { if (rec.inst && typeof rec.inst.destroy === 'function') rec.inst.destroy(); } catch (e) { warnOnce('page destroy: ' + rec.id, e); }
    destroyKitPages(rec);
    rec.listeners.length = 0;
    U.clear(M.f.main);
    M.cur = null;
  }

  // Shows another page and makes the address bar agree, without adding history for the page already
  // showing.
  O.navigate = function (section) {
    if (!M) return false;
    const id = pageIdOf(section);
    if (id !== M.pageId) showPage(id, { focus: true });
    try {
      const R = SB.router;
      if (R) { const v = R.view(); if (v.kind === 'office' && v.section !== id) R.go({ kind: 'office', section: id }); }
    } catch (e) { warnOnce('router sync', e); }
    return true;
  };
  // The [ and ] keys: go to the previous or next ready page, wrapping round at the ends.
  function stepPage(dir) {
    const ready = PAGES.filter((p) => registry[p.id]).map((p) => p.id);
    if (!ready.length) return;
    let i = ready.indexOf(M.pageId); if (i < 0) i = 0;
    const j = (i + dir + ready.length) % ready.length;
    O.navigate(ready[j]);
  }

  const REFRESH_MS = 3000, HEARTBEAT_MS = 30000, BUSY_CAP_MS = 10000;
  // True while someone is using a chart, a table or a field, or a tooltip is open, so a refresh must
  // wait.
  function interacting() {
    // Refresh at most every 3 s, a 30 s heartbeat, and wait at most 10 s while someone is using a chart
    // or table.
    if (!M) return false;
    const a = doc.activeElement;
    if (a && M.f.root.contains(a) && a.closest && a.closest('.ch, .of-tablewrap, input, select, textarea')) return true;
    if (M.f.root.querySelector('.ch-tip:not([hidden])')) return true;
    return false;
  }
  // Redraws everything from the latest data: rolls ranges such as Today forward, re-prepares the metrics,
  // updates the cards and repaints the banner.
  function refreshNow(force) {
    if (!M || M.refreshing) return;
    // The cook-ahead switch changed somewhere else (a setup sheet): redraw a gated page the other way.
    if ((GATED[M.pageId] || COUNTER_PAGES[M.pageId]) && (M.f.root.dataset.gated === 'true') !== pageIsOff(M.pageId)) { showPage(M.pageId, { focus: false }); return; }
    M.refreshing = true;
    try {
      clrT(M.timer); M.timer = 0; M.dirty = false; M.deferredSince = 0;
      M.lastRefresh = Date.now();
      // roll preset ranges forward (a service day ends at 4 am)
      const F = M.filters;
      if (F.range.id !== 'custom' && F.range.id !== 'day') { const nr = presetRange(F.range.id); if (nr.from !== F.range.from || nr.to !== F.range.to) { F.range = nr; M.bannerCache = null; } else F.range.to = nr.to; }
      M.gen++; M.prep = null;
      paintSourceNote();
      const rec = M.cur; if (!rec) return;
      const ctx = rec.ctx;
      let p = null;
      try { p = ctx.prepared(); } catch (e) { warnOnce('prepare', e); }
      if (p) rec.kitPages.forEach((kp) => { try { kp._refresh(p); } catch (e) { warnOnce('kit page refresh', e); } });
      if (rec.inst && typeof rec.inst.update === 'function') { try { rec.inst.update(ctx); } catch (e) { warnOnce('page update: ' + rec.id, e); } }
      rec.listeners.slice().forEach((fn) => { try { fn(ctx); } catch (e) { warnOnce('filter listener: ' + rec.id, e); } });
      paintBanner(ctx);
    } finally { if (M) M.refreshing = false; }
  }
  // Plans one refresh after delay ms (one at a time). It waits while the page is hidden or in use, for up
  // to 10 s.
  function schedule(delay) {
    if (!M || M.timer) return;
    M.timer = setT(() => {
      if (!M) return;
      M.timer = 0;
      if (doc.hidden) { M.dirty = true; return; }
      if (interacting()) {
        if (!M.deferredSince) M.deferredSince = Date.now();
        if (Date.now() - M.deferredSince < BUSY_CAP_MS) { schedule(1000); return; }
      }
      refreshNow(false);
    }, delay);
  }
  // The store changed: mark the page stale and refresh at most once every 3 seconds.
  function onStoreChange() {
    if (!M) return;
    M.dirty = true;
    const wait = Math.max(0, REFRESH_MS - (Date.now() - M.lastRefresh));
    schedule(wait);
  }

  // The empty-page button: turns the sample history on and looks at the last 14 days of it, labeled as sample.
  function showSampleNumbers() {
    if (!M || !SB.sim || typeof SB.sim.setSampleEnabled !== 'function') return;
    SB.sim.setSampleEnabled(true);
    M.forcedLive = false; M.filters.source = 'all'; M.srcSeg.setValue('all');
    setRange('last14');
  }

  // The Data page switched the sample history on or off: show it, or fall back to live only, and redraw
  // now.
  function onSampleChange(on) {
    if (!M) return;
    if (on && M.forcedLive) { M.forcedLive = false; M.filters.source = 'all'; M.srcSeg.setValue('all'); }
    M.bannerCache = null;
    refreshNow(true);
    paintFilterSummary();
  }

  // Switches every office surface to the Paper look while printing (on true), or back to the owner's chosen look (on false).
  function paperForPrint(on) {
    const want = on ? 'paper' : (SB.theme && SB.theme.office ? SB.theme.office() : 'ember');
    doc.querySelectorAll('.office[data-otheme]').forEach((el) => el.setAttribute('data-otheme', want));
    try { if (SB.charts && SB.charts.refreshTheme) SB.charts.refreshTheme(); } catch (e) { warnOnce('refreshTheme', e); }
  }

  // Opens the office inside el: builds the frame and filters, subscribes to the store, theme and sample
  // switch, then shows the page.
  // WATCH OUT: everything made here (timers, subscriptions, listeners) is tracked so unmount removes all of it.
  O.mount = function (el, section) {
    if (M) O.unmount();
    const f = buildFrame();
    // Adds an event listener that unmount removes again.
    const scope = { offs: [], on(target, type, fn, o) { this.offs.push(listen(target, type, fn, o)); } };
    M = { el, f, scope, filters: null, gen: 0, prep: null, pageId: null, cur: null, timer: 0, dirty: false, lastRefresh: 0, refreshing: false, deferredSince: 0, bannerCache: null };
    M.filters = lastFilterDefaults ? lastFilterDefaults() : defaultFilters();
    U.clear(el); el.appendChild(f.root);
    buildFilters();
    paintThemeBtn();
    paintRail();
    scope.on(f.themeBtn, 'click', () => { if (SB.theme) SB.theme.toggle(); });
    scope.offs.push(tracked('subs', SB.theme ? SB.theme.onChange((what) => { if (what === 'office') { paintThemeBtn(); try { if (SB.charts && SB.charts.refreshTheme) SB.charts.refreshTheme(); } catch (e) { warnOnce('refreshTheme', e); } } }) : () => {}));
    scope.offs.push(tracked('subs', SB.store && SB.store.subscribe ? SB.store.subscribe(onStoreChange) : () => {}));
    scope.offs.push(tracked('subs', SB.sim && SB.sim.onSampleChange ? SB.sim.onSampleChange(onSampleChange) : () => {}));
    scope.on(doc, 'visibilitychange', () => { if (!doc.hidden && M && M.dirty) schedule(0); });
    // Browser print (Ctrl+P) of an office page uses the light Paper look, so cards and chart labels stay dark on white paper
    // (browsers drop the dark backgrounds when printing); the chosen look comes back after.
    scope.on(g, 'beforeprint', () => paperForPrint(true));
    scope.on(g, 'afterprint', () => paperForPrint(false));
    scope.on(doc, 'keydown', (e) => {
      if (!M || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== '[' && e.key !== ']') return;
      if (SB.shell && SB.shell.inOffice && !SB.shell.inOffice()) return;
      if (SB.sheets && SB.sheets.count && SB.sheets.count() > 0) return;
      const t = e.target; const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      e.preventDefault(); stepPage(e.key === ']' ? 1 : -1);
    });
    M.heartbeat = setI(() => { if (!M || doc.hidden) return; M.dirty = true; schedule(0); }, HEARTBEAT_MS);
    M.lastRefresh = Date.now();
    showPage(pageIdOf(section), { focus: false });
    O.mounts = (O.mounts || 0) + 1;
  };

  // Closes the office: destroys the page, stops the timers and removes every subscription and listener.
  O.unmount = function () {
    if (!M) return;
    const m = M;
    destroyCurrent();
    clrT(m.timer); m.timer = 0;
    clrI(m.heartbeat); m.heartbeat = 0;
    m.scope.offs.splice(0).forEach((off) => off());
    kitPagesLive.forEach((kp) => { try { kp.destroy(); } catch (e) { /* ignore */ } });
    cardsLive.clear();
    try { if (m.el) U.clear(m.el); } catch (e) { /* ignore */ }
    M = null;
    // anything still alive is a leak; clear defensively so the next mount starts clean
    live.timeouts.forEach((id) => clearTimeout(id)); live.timeouts.clear();
    live.intervals.forEach((id) => clearInterval(id)); live.intervals.clear();
  };

  O._debug = {
    // Leak counters for tests: live timers, subscriptions, listeners, charts, pages and cards. The app
    // never reads them.
    counts: () => ({ timeouts: live.timeouts.size, intervals: live.intervals.size, subs: live.subs.size, listeners: live.listeners.size, charts: SB.charts && SB.charts.live ? SB.charts.live() : 0, kitPages: kitPagesLive.size, cards: cardsLive.size, mounted: !!M }),
    state: () => (M ? { page: M.pageId, filters: JSON.parse(JSON.stringify(M.filters)), gen: M.gen, lastRefresh: M.lastRefresh } : null),
    // refreshNow forces a redraw. setFilterDefaults lets a test choose where the filters start.
    refreshNow: () => refreshNow(true),
    setFilterDefaults: (fn) => { lastFilterDefaults = fn; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
