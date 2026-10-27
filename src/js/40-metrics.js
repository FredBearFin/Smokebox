/*
 * WHAT THIS FILE IS: The analytics layer (SB.metrics): turns tickets and the event log into numbers (ticket
 *   times, plate sync, sell-outs, safety, money, yield) and 21 insight rules. Read-only.
 * PARTS: helpers; context (makeCtx); anatomy, sync, summary, pace; breakdowns; time buckets; pacing A/B and
 *   calibration; stock and 86s; safety; money and yield; friction; compare; insights; headline; prepare.
 * USES / USED BY: 00-util.js, 10-config.js, optionally SB.engine.REPORTS. Used by office pages 80 to 85.
 */
/* Smokebox KDS - 40-metrics.js
 * Pure analytics layer: SB.metrics. Input is a dataset { tickets, events, batches, learned, menu, ingredients, settings, range:{from,to} }
 * (SPEC sections 5, 6, 12). Nothing here touches the DOM or changes the engine. Only reportWords reads SB.engine.REPORTS (optional wording),
 * and only rangePresets can read the real clock (when it is called without a time).
 *
 * CONVENTIONS (read once, applies to every function):
 *  - Times are epoch ms (virtual time). Durations are ms and end in "Ms". Money is dollars. Weights are grams.
 *  - Fields ending in "Pct" are FRACTIONS 0..1 (0.87 = 87%), so they feed SB.util.fmtPct directly. The only 0..100 numbers are the
 *    hotPct/chilledPct returned by thermal(), which copy the SPEC 7.7 shape.
 *  - null means "unknown / no data". Nothing is zero-filled and nothing returns NaN. Counts are real zeros.
 *  - opts = { from, to, channel, zone, includeVoided, now, bucketMin, ... }. The range is HALF-OPEN: from <= createdAt < to. When from/to are
 *    omitted the dataset's range is used, then unbounded. channel/zone of 'all' or undefined mean no filter.
 *    channel filters tickets; zone keeps tickets that have at least one line in that zone (ticket-level stats) or only that zone's lines
 *    (line-level stats). Event-only functions (safety, stock, and the undo and report counts in friction) honour from/to only.
 *  - Ticket time stats use "speed tickets": status 'expedited' with a finite expeditedAt not earlier than createdAt (a recalled ticket's latest expeditedAt;
 *    a ticket that is currently recalled/active is not finished and is skipped). Voided tickets never enter speed stats; they are counted
 *    in summary.voids. Forced bumps are included in totalMs stats (the clock did stop) but excluded from anatomy and plate sync.
 *    opts.includeVoided only widens volume/money counts (created tickets, byDay.tickets, revenue, queue load).
 *  - Service day = SB.util.serviceDate (a 12:45 am ticket belongs to last night and is hour 24.75). A ticket's hour/day come from createdAt.
 *  - Every function accepts missing/empty/garbage datasets and returns a well-formed empty result (never throws).
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const C = SB.config;
  const M = (SB.metrics = {});

  /* ================= helpers ================= */
  // Milliseconds in an hour and in a minute. All times in this file are in milliseconds.
  const H = 3600e3, MIN = 60e3;
  // True for a real, finite number only. Text, null, NaN and Infinity are rejected, never counted as 0.
  const num = (x) => typeof x === 'number' && x - x === 0;                 // finite number (NaN and +-Infinity fail the subtraction)
  // Like num, but Infinity is allowed (used for range limits such as "no end date").
  const isN = (x) => typeof x === 'number' && !isNaN(x);
  // The list itself, or an empty list if x is not a list, so missing data never crashes a loop.
  const arr = (x) => (Array.isArray(x) ? x : []);
  const EMPTY = Object.freeze([]);
  const pad2 = U.pad2;

  /**
   * Count, sum, average, median (the middle value once sorted), p10, p90, p95 (p90: 9 in 10 values are at
   * or below it), min and max.
   * Non-numbers are skipped; with nothing usable every statistic is null ("not known"), never 0. One sort
   * feeds all the percentiles.
   */
  function stats(values) {
    // Typed array: sorts fast and in true numeric order, which matters at 5000 tickets (F-M16).
    const n0 = values.length; let n = 0; const buf = new Float64Array(n0);
    for (let i = 0; i < n0; i++) { const x = values[i]; if (typeof x === 'number' && x - x === 0) buf[n++] = x; }
    if (!n) return { n: 0, sum: 0, avg: null, median: null, p10: null, p90: null, p95: null, min: null, max: null };
    const v = n === n0 ? buf : buf.subarray(0, n); v.sort();
    // Value at percentile p (0 to 100); between two neighbours it blends them, so p50 of [1, 2] is 1.5.
    const q = (p) => { const idx = (p / 100) * (n - 1); const lo = Math.floor(idx), hi = Math.ceil(idx); return v[lo] + (v[hi] - v[lo]) * (idx - lo); };
    let sum = 0; for (let i = 0; i < n; i++) sum += v[i];
    return { n, sum, avg: sum / n, median: q(50), p10: q(10), p90: q(90), p95: q(95), min: v[0], max: v[n - 1] };
  }
  // Median: the middle ticket if you lined them all up by time. Null when nothing is usable.
  const median = (a) => stats(a).median;
  // Average. Null when nothing is usable.
  const mean = (a) => stats(a).avg;
  // Sum of the real numbers in a list; non-numbers are skipped and an empty list gives 0.
  const sumOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) if (num(a[i])) s += a[i]; return s; };

  /** "6m 31s", "3m 05s", "0m 48s" (always minutes + 2-digit seconds; the wording used in SPEC 12 examples). */
  function mmss(ms) {
    if (!num(ms)) return '-';
    const neg = ms < 0; let s = Math.round(Math.abs(ms) / 1000);
    const m = Math.floor(s / 60); s = s % 60;
    return (neg ? '-' : '') + m + 'm ' + pad2(s) + 's';
  }
  // Fraction to text: 0.87 gives "87%". Unknown gives "-".
  const pctTxt = (x) => (num(x) ? Math.round(x * 100) + '%' : '-');
  // Grams to text: 4800 gives "4.8 kg". Unknown gives "-".
  const kgTxt = (g) => (num(g) ? (U.units && U.units.weight === 'lb' ? U.weightText(g) : (g / 1000).toFixed(1) + ' kg') : '-');
  // Dollars with cents ("$14.00"). Unknown gives "-".
  const money = (n) => U.fmtMoney(n);
  // Dollars without cents ("$14"), for big totals.
  const money0 = (n) => U.fmtMoney(n, 0);
  /** 12 -> "12 to 1 pm", 11 -> "11 am to 12 pm". */
  function hourSpan(h) {
    const a = U.fmtHour(h).split(' '), b = U.fmtHour(h + 1).split(' ');
    return a[1] === b[1] ? a[0] + ' to ' + b[0] + ' ' + b[1] : a[0] + ' ' + a[1] + ' to ' + b[0] + ' ' + b[1];
  }
  /** 12 -> "12 and 1 pm" (for "between ..."). */
  const hourBetween = (h) => hourSpan(h).replace(' to ', ' and ');
  /** "1:42 pm" for an epoch ms. */
  const clock = (ts) => U.fmtTime(ts);

  const dayMsCache = new Map();
  // Midnight of a service-date key like "2026-10-16", remembered so each date is worked out once.
  function dayMs(key) {
    let v = dayMsCache.get(key);
    if (v === undefined) { v = U.dateKeyToMs(key); if (dayMsCache.size > 4000) dayMsCache.clear(); dayMsCache.set(key, v); }
    return v;
  }
  /** Epoch ms of the start of a service day (local dayStartHour on that date key). */
  function dayStartMs(key, dsh) { const p = key.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], dsh, 0, 0, 0).getTime(); }
  /**
   * Epoch ms of local hour h (may exceed 24) on a service-date key: 12:45 am is hour 24.75 of the previous
   * key.
   * WATCH OUT: it adds h whole hours to midnight, so on the two daylight-saving days a year the clock time
   *   can be an hour off.
   */
  // Whole hours are counted on the wall clock (so the two daylight-saving days stay right); only the part of an hour is added as milliseconds.
  function hourMs(key, h) { const p = key.split('-').map(Number); const w = Math.floor(h); return new Date(p[0], p[1] - 1, p[2], w, 0, 0, 0).getTime() + Math.round((h - w) * H); }
  // Local-time offset from UTC at that moment, in ms.
  const tzOff = (ts) => -new Date(ts).getTimezoneOffset() * MIN;
  // Hours on the wall clock from midnight of a service date to a moment (12:45 am the next morning is 24.75). On a clock-change
  // day this is the hour the kitchen's clock shows, not the hours that really passed.
  function wallHourOn(t, date) { const m = dayMs(date); return (t + tzOff(t) - (m + tzOff(m))) / H; }
  // Service-date lookups dominate large datasets, so cache them per 15-minute slot (every real UTC offset is a multiple of 15 minutes and the
  // service-day boundary is a whole number of quarter hours, so a slot never straddles two service dates).
  const slotCache = new Map();
  // Service date, midnight and weekday for a moment, cached per 15-minute slot (see the note above).
  function slotInfo(ts, dsh) {
    const q = dsh * 4, cacheable = q === Math.floor(q) && q >= 0 && q < 256;
    const k = cacheable ? Math.floor(ts / 900000) * 256 + q : -1; let v = cacheable ? slotCache.get(k) : undefined;
    if (v === undefined) {
      const date = U.serviceDate(ts, dsh); v = { date, ms: dayMs(date), wd: U.weekday(date) };
      if (cacheable) { if (slotCache.size > 20000) slotCache.clear(); slotCache.set(k, v); }
    }
    return v;
  }
  // Service date of a moment: the day starts at 4 am, so 12:45 am Saturday is Friday's date (F-M2).
  // Hours since midnight of the service date on the WALL clock (12:45 am the next morning is 24.75), so a day with a clock
  // change still puts noon in hour 12. si is the slotInfo of ts.
  function wallHours(ts, si) {
    const d = new Date(ts), key = U.dateKey(ts);
    const extra = key === si.date ? 0 : 24 * Math.max(1, Math.round((dayMs(key) - si.ms) / 86400e3));
    return extra + d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3600e3;
  }
  // The service date of a moment for a given day-start hour.
  const serviceDateOf = (ts, dsh) => slotInfo(ts, dsh).date;
  /**
   * Channel thresholds: settings.channels override config.channels (per field). An unknown channel uses the
   * first config channel's time limits but shows its own id as the name and short label (known is false).
   */
  function threshold(settings, id) {
    const ov = arr(settings && settings.channels).find((c) => c && c.id === id) || {};
    const base = C.channelById[id] || C.channels[0];
    const warnSec = num(ov.warnSec) ? ov.warnSec : base.warnSec;
    const breachSec = num(ov.breachSec) ? ov.breachSec : base.breachSec;
    const known = !!C.channelById[id];
    return { channel: id, name: known ? base.name : id, short: known ? base.short : id, known, warnSec, breachSec, warnMs: warnSec * 1000, breachMs: breachSec * 1000 };
  }
  /** ok / warn / breach. Boundaries: totalMs >= warnMs is 'warn'; totalMs >= breachMs is 'breach'. */
  const levelOf = (ms, th) => (ms >= th.breachMs ? 'breach' : ms >= th.warnMs ? 'warn' : 'ok');

  // Menu items by id: built-in menu first, then the dataset's menu on top, so the owner's edits win.
  function menuMap(ds) {
    const m = {}; for (const x of C.menu) m[x.id] = x;
    for (const x of arr(ds.menu)) if (x && x.id) m[x.id] = x;
    return m;
  }
  // Ingredients by id, layered the same way: built-in first, dataset on top.
  function ingMap(ds) {
    const m = {}; for (const x of C.ingredients) m[x.id] = x;
    for (const x of arr(ds.ingredients)) if (x && x.id) m[x.id] = x;
    return m;
  }
  // Station name for display ("Pit"); an unknown id is shown as it is.
  const zoneName = (z) => (C.zoneById[z] ? C.zoneById[z].name : z);
  // Channel name for display ("Takeout"); an unknown id is shown as it is.
  const chanName = (c) => (C.channelById[c] ? C.channelById[c].name : c);

  // Quantity of a ticket line; missing, zero or negative counts as 1.
  const lineQty = (it) => (num(it.qty) && it.qty > 0 ? it.qty : 1);
  // Price x quantity of a line, or null when no price was recorded (unknown is not zero).
  const lineRev = (it) => (num(it.price) ? it.price * lineQty(it) : null);
  /**
   * One pass over a ticket item: the facts every line-based metric needs.
   *   work (done lines only) = done - start for a two-step line, done - fire for a one-step line; null when stamps are missing or non-monotone.
   *   resp = start - fire, two-step lines only. qty >= 1 else 1 (lineQty). rev = price x qty or null. cost = recorded cost or null.
   *   scale = quantity factor min(qtyCap, 1 + qtyFactor x (qty - 1)), the same as the engine's qtyScale.
   */
  function lineModel(it, v, pc) {
    const qty = lineQty(it), price = it.price, cost = it.cost, done = it.status === 'done';
    let work = null, resp = null;
    if (done && it.auto !== true) {      // an item finished by counter service has no work or response time to learn from
      const f = it.firedAt, d = it.doneAt, st = it.startedAt;
      if (num(f) && num(d) && d >= f) {
        if (num(st)) { if (st >= f && st <= d) { work = d - st; resp = st - f; } }
        else work = d - f;
      }
    }
    return { it, v, done, qty, rev: num(price) ? price * qty : null, cost: num(cost) ? cost : null, work, resp, scale: Math.min(pc.qtyCap, 1 + pc.qtyFactor * ((num(it.qty) && it.qty >= 1 ? it.qty : 1) - 1)) };
  }

  /* ================= context: one pass over tickets, reused by every metric inside a call ================= */
  // Event types the context keeps as lists (undone ones removed); all other types are ignored for speed.
  const KEEP = { avail_changed: true, sync_done: true, temp_logged: true, sanitize_done: true, batch_status: true, batch_reheat: true, batch_discard: true, batch_in: true, undo: true, ui_report: true };
  /** Event types the context groups: 0 = kept and counted, 1 = counted only, 2 = kept only. evCount() answers for the counted ones. */
  const EV_COUNTED = ['item_done', 'ticket_expedited', 'ticket_voided', 'batch_discard', 'sanitize_done'];
  const EV_SLOTS = new Map();
  for (const k in KEEP) EV_SLOTS.set(k, 2);
  for (const k of EV_COUNTED) EV_SLOTS.set(k, KEEP[k] === true ? 0 : 1);
  // The plain dataset inside a prepared handle, or the argument itself when it is not a handle.
  const unwrap = (ds) => (ds && ds.__sbctx === true ? ds.ds : ds);
  // The shared first pass over a dataset: one row per ticket in range, the not-voided and finished lists,
  // and cached helpers for lines, events and limits. Every metric starts here.
  // A prepared handle passes straight through; junk input gives an empty context, never an error.
  function makeCtx(ds, opts) {
    if (ds && ds.__sbctx === true) {            // a prepared handle (M.prepare) or the shared context insights/headline pass around
      if (opts && typeof opts === 'object' && Object.keys(opts).length) { const d = Object.create(ds); d.o = Object.assign({}, ds.o, { opts: Object.assign({}, ds.o.opts, opts) }); return d; }   // per-call options (bucketMin, fold, minSamples...) only
      return ds;
    }
    ds = ds && typeof ds === 'object' ? ds : {};
    if (typeof opts === 'number') opts = { bucketMin: opts };
    opts = opts && typeof opts === 'object' ? opts : {};
    const settings = ds.settings && typeof ds.settings === 'object' ? ds.settings : {};
    const svc = Object.assign({}, C.service, settings.service);
    const dsh = num(svc.dayStartHour) ? svc.dayStartHour : C.service.dayStartHour;
    const rg = ds.range && typeof ds.range === 'object' ? ds.range : {};
    // The range is half-open: created exactly at from is in, exactly at to is out.
    const from = isN(opts.from) ? opts.from : isN(rg.from) ? rg.from : -Infinity;
    const to = isN(opts.to) ? opts.to : isN(rg.to) ? rg.to : Infinity;
    const o = {
      from, to, opts,
      channel: opts.channel && opts.channel !== 'all' ? opts.channel : null,
      zone: opts.zone && opts.zone !== 'all' ? opts.zone : null,
      includeVoided: !!opts.includeVoided,
      now: isN(opts.now) ? opts.now : null,                // only an explicit opts.now; see ctx.nowMs()
    };
    const store = {};
    const ctx = { __sbctx: true, ds, o, settings, svc, dsh };
    // Runs fn once per context and remembers the answer under key k, so repeat callers reuse it.
    ctx.memo = (k, fn) => (k in store ? store[k] : (store[k] = fn()));
    // Pacing numbers (quantity factor and cap): saved settings laid over the config defaults.
    ctx.pacingCfg = Object.assign({}, C.pacing, settings.pacing);
    const thc = {};
    // Warn and overdue limits for a channel, worked out once per channel.
    ctx.th = (id) => thc[id] || (thc[id] = threshold(settings, id));
    // Menu by id, built once per context.
    ctx.menuMap = () => ctx.memo('menuMap', () => menuMap(ds));
    // Ingredients by id, built once per context.
    ctx.ingMap = () => ctx.memo('ingMap', () => ingMap(ds));
    // Service date of a moment, using this dataset's day-start hour.
    ctx.dateOf = (ts) => serviceDateOf(ts, dsh);

    const all = [];
    for (const t of arr(ds.tickets)) {
      if (!t || typeof t !== 'object' || !num(t.createdAt)) continue;
      if (t.createdAt < from || t.createdAt >= to) continue;
      if (o.channel && t.channel !== o.channel) continue;
      const items = Array.isArray(t.items) ? t.items : EMPTY;
      if (o.zone) { let has = false; for (let i = 0; i < items.length; i++) if (items[i] && items[i].zone === o.zone) { has = true; break; } if (!has) continue; }
      const si = slotInfo(t.createdAt, dsh), date = si.date;
      // sh = hours since midnight of the service date (12:45 am = 24.75); hk numbers each date+hour slot.
      const sh = wallHours(t.createdAt, si);
      all.push({
        t, items, id: t.id, num: t.num, channel: t.channel, createdAt: t.createdAt, date, sh, hour: Math.floor(sh), hk: Math.round(si.ms / 86400e3) * 100 + Math.floor(sh), wd: si.wd,
        voided: t.status === 'voided', forced: t.forced === true, recalls: num(t.recalls) ? t.recalls : 0,
        pacing: typeof t.pacing === 'boolean' ? t.pacing : null, rush: !!t.rush, expeditedAt: null, totalMs: null, level: null,
      });
    }
    all.sort((a, b) => a.createdAt - b.createdAt);
    // Step 2: "spd" = finished and not voided; only these feed time statistics (F-M4).
    const live = [], spd = [];
    for (const v of all) {
      if (v.voided) continue;
      live.push(v);
      const t = v.t;
      if (t.status === 'expedited' && num(t.expeditedAt) && t.expeditedAt >= t.createdAt) {
        v.expeditedAt = t.expeditedAt; v.totalMs = t.expeditedAt - t.createdAt; v.level = levelOf(v.totalMs, ctx.th(v.channel));
        // Counter service closes a ticket when it is paid: that is not a kitchen time, so it stays out of every speed statistic.
        if (t.auto !== true) spd.push(v);
      }
    }
    ctx.all = all;                                     // every ticket in scope (any status)
    ctx.live = live;                                   // not voided
    ctx.vol = o.includeVoided ? all : live;            // volume/money scope
    ctx.spd = spd;                                     // finished, not voided (speed stats)
    ctx.voided = all.filter((v) => v.voided);
    /** Lines (ticket items) with their ticket row and derived facts, computed once: done, qty, rev (price x qty|null), cost|null, work (ms|null, done lines only),
     *  resp (ms|null, two-step only), scale (quantity factor). forMoney=true honours includeVoided; false never includes voided tickets. */
    ctx.lines = (forMoney) => ctx.memo(forMoney && o.includeVoided ? 'linesM' : 'linesS', () => {
      const out = [], pc = ctx.pacingCfg;
      for (const v of forMoney && o.includeVoided ? ctx.vol : live) for (const it of v.items) { if (!it) continue; if (o.zone && it.zone !== o.zone) continue; out.push(lineModel(it, v, pc)); }
      return out;
    });
    // Walks the event log once: lists by type (undone removed) and counts (undone included), in range only.
    const groupEv = () => ctx.memo('ev', () => {
      // One Map lookup per event: types nobody asks for are skipped before any other field is read (the log is mostly ticket/item traffic).
      const lv = {}, cnt = {}, slots = EV_SLOTS;
      for (const e of arr(ds.events)) {
        if (!e) continue;
        const ty = e.type, sl = slots.get(ty);
        if (sl === undefined) continue;
        const t = e.t;
        if (!num(t) || t < from || t >= to) continue;
        if (sl !== 2) cnt[ty] = (cnt[ty] || 0) + 1;                              // counted types include undone events
        if (sl !== 1 && !e.reverted) (lv[ty] || (lv[ty] = [])).push(e);        // kept types drop undone (reverted) events
      }
      return { lv, cnt };
    });
    /** Events of a type inside the range, undone ones (reverted:true) removed. Only the types listed in KEEP are stored. */
    ctx.ev = (type) => groupEv().lv[type] || EMPTY;
    /** How many events of any type were logged in the range, undone ones included (used for rates whose denominator counts undone actions). */
    ctx.evCount = (type) => groupEv().cnt[type] || 0;
    /** "Now" for lines that are still open: opts.now when given, else the newest timestamp on any ticket in scope (never the range end, which may be in the future). */
    ctx.nowMs = () => ctx.memo('nowMs', () => {
      if (num(o.now)) return o.now;
      // Keeps the largest timestamp seen so far.
      let m = null; const up = (x) => { if (num(x) && (m === null || x > m)) m = x; };
      for (const v of all) { up(v.createdAt); up(v.t.expeditedAt); up(v.t.voidedAt); for (const it of v.items) if (it) { up(it.firedAt); up(it.startedAt); up(it.doneAt); } }
      return m;
    });
    // Sorted list of the distinct service dates that have a ticket in scope.
    ctx.dates = () => ctx.memo('dates', () => Array.from(new Set(all.map((v) => v.date))).sort());
    // Quantity factor of a line: 1 for one portion, +20 percent per extra portion, capped at 2x (as in the
    // engine).
    ctx.qtyScale = (it) => { const p = ctx.pacingCfg; const q = num(it.qty) && it.qty >= 1 ? it.qty : 1; return Math.min(p.qtyCap, 1 + p.qtyFactor * (q - 1)); };
    return ctx;
  }

  /* ================= ticket anatomy, plate sync, SLA, summary, pace index ================= */
  // Splits each finished ticket's time into four parts by following its slowest item (the one done last):
  // hold (paced wait before it fired), response (fired, not started), work (cooking), dwell (done, not yet
  // bumped).
  // The parts add up exactly to the ticket time (F-M6). Forced bumps and tickets with impossible time order
  // are left out (F-M4).
  function anatomyRows(ctx) {
    return ctx.memo('anat', () => {
      const out = [];
      for (const v of ctx.spd) {
        // The slowest item decides when the ticket can go out; on a tie the one fired later is blamed.
        if (v.forced) continue;
        let crit = null;
        for (const it of v.items) {
          if (!it || it.status !== 'done' || !num(it.doneAt)) continue;
          if (!crit || it.doneAt > crit.doneAt || (it.doneAt === crit.doneAt && num(it.firedAt) && (!num(crit.firedAt) || it.firedAt > crit.firedAt))) crit = it;
        }
        if (!crit || !num(crit.firedAt)) continue;
        const f = crit.firedAt, d = crit.doneAt, s = num(crit.startedAt) ? crit.startedAt : null;
        if (f < v.createdAt || d < f || (s !== null && (s < f || s > d)) || v.expeditedAt < d) continue; // non-monotone data: skip, never invent
        out.push({
          ticketId: v.id, num: v.num, channel: v.channel, customer: v.t.customer, createdAt: v.createdAt, expeditedAt: v.expeditedAt,
          date: v.date, hour: v.hour, totalMs: v.totalMs,
          holdMs: f - v.createdAt, responseMs: s !== null ? s - f : 0, workMs: s !== null ? d - s : d - f, dwellMs: v.expeditedAt - d,
          criticalItemId: crit.id, criticalMenuId: crit.menuId, criticalName: crit.name, criticalZone: crit.zone, twoStep: s !== null,
          level: v.level, pacing: v.pacing, rush: v.rush, recalls: v.recalls,
        });
      }
      return out;
    });
  }

  /**
   * Critical-path decomposition of every finished, non-forced, non-voided ticket. critical = the done item with the greatest doneAt
   * (tie: the later-fired one). Parts always sum exactly: holdMs + responseMs + workMs + dwellMs === totalMs.
   *   holdMs = critical.firedAt - createdAt (pacing hold, by design); responseMs = startedAt - firedAt (0 for a one-step item with no startedAt);
   *   workMs = doneAt - startedAt (or doneAt - firedAt when there is no startedAt); dwellMs = expeditedAt - critical.doneAt (expo dwell).
   * Tickets with non-monotone timestamps are skipped.
   * @returns {Array<{ticketId,num,channel,customer,createdAt,expeditedAt,date,hour,totalMs,holdMs,responseMs,workMs,dwellMs,
   *   criticalItemId,criticalMenuId,criticalName,criticalZone,twoStep:boolean,level:'ok'|'warn'|'breach',pacing:boolean|null,rush:boolean,recalls:number}>} oldest first
   */
  M.ticketAnatomy = (ds, opts) => anatomyRows(makeCtx(ds, opts)).slice();

  // Averages the four parts over anatomy rows; shares = each part's slice of the average ticket. Null for
  // no rows.
  function partsAvg(rows) {
    const n = rows.length; if (!n) return null;
    let h = 0, r = 0, w = 0, d = 0, t = 0;
    for (const x of rows) { h += x.holdMs; r += x.responseMs; w += x.workMs; d += x.dwellMs; t += x.totalMs; }
    const tot = t / n;
    return { count: n, holdMs: h / n, responseMs: r / n, workMs: w / n, dwellMs: d / n, totalMs: tot,
      shares: { hold: t ? h / t : null, response: t ? r / t : null, work: t ? w / t : null, dwell: t ? d / t : null } };
  }
  /**
   * Average anatomy parts (means, so the four parts sum exactly to totalMs) overall, by channel, by hour and by critical station.
   * @returns {{overall:null|Part, byChannel:Array<Part&{key,label}>, byHour:Array<Part&{key:number,label,hour}>, byZone:Array<Part&{key,label}>}}
   *   Part = {count,holdMs,responseMs,workMs,dwellMs,totalMs,shares:{hold,response,work,dwell}}
   */
  M.anatomySummary = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const rows = anatomyRows(ctx);
    // Groups rows by a key (given order first, then any others) and averages each group.
    const grp = (keyFn, order, labelFn) => {
      const m = {}; for (const r of rows) { const k = keyFn(r); (m[k] || (m[k] = [])).push(r); }
      const keys = Object.keys(m); const ord = order ? order.filter((k) => m[k]).concat(keys.filter((k) => order.indexOf(k) < 0).sort()) : keys.sort((a, b) => a - b);
      return ord.map((k) => Object.assign({ key: k, label: labelFn(k) }, partsAvg(m[k])));
    };
    return {
      overall: partsAvg(rows),
      byChannel: grp((r) => r.channel, C.channels.map((c) => c.id), chanName),
      byHour: grp((r) => r.hour, null, (k) => U.fmtHour(+k)).map((p) => Object.assign(p, { key: +p.key, hour: +p.key })),
      byZone: grp((r) => r.criticalZone, C.workZones, zoneName),
    };
  };

  /**
   * Gantt data for ONE ticket (any status, ignores the range). Times are seconds from createdAt.
   * @returns {null|{ticketId,num,customer,channel,status,totalMs:number|null,totalSec:number|null,level:string|null,
   *   rows:Array<{label,zone,itemId,segments:Array<{start:number,end:number,tone:'hold'|'wait'|'work'|'dwell',label}>,marks:Array<{at:number,label}>}>}}
   */
  M.ticketGantt = (ds, ticketId) => {
    const t = arr(ds && ds.tickets).find((x) => x && x.id === ticketId);
    if (!t || !num(t.createdAt)) return null;
    // Seconds since the ticket was created.
    const rel = (ts) => (ts - t.createdAt) / 1000;
    const rows = []; let lastDone = null;
    for (const it of arr(t.items)) {
      if (!it) continue;
      const segs = [], marks = [];
      if (num(it.firedAt) && it.firedAt > t.createdAt) segs.push({ start: 0, end: rel(it.firedAt), tone: 'hold', label: 'Paced hold' });
      const s = num(it.startedAt) ? it.startedAt : null;
      if (num(it.firedAt) && s !== null && s > it.firedAt) segs.push({ start: rel(it.firedAt), end: rel(s), tone: 'wait', label: 'Waiting for the cook' });
      if (num(it.doneAt) && (s !== null || num(it.firedAt))) {
        const a = s !== null ? s : it.firedAt; segs.push({ start: rel(a), end: rel(it.doneAt), tone: 'work', label: 'Work' });
        marks.push({ at: rel(it.doneAt), label: 'Done' }); lastDone = lastDone === null ? it.doneAt : Math.max(lastDone, it.doneAt);
      }
      if (num(it.firedAt)) marks.unshift({ at: rel(it.firedAt), label: it.override ? 'Fired early' : 'Fired' });
      rows.push({ label: (num(it.qty) && it.qty > 1 ? it.qty + 'x ' : '') + (it.name || it.menuId || 'Item'), zone: it.zone, itemId: it.id, segments: segs, marks });
    }
    const fin = t.status === 'expedited' && num(t.expeditedAt);
    if (fin && lastDone !== null && t.expeditedAt > lastDone) rows.push({ label: 'Expo dwell', zone: 'expo', itemId: null, segments: [{ start: rel(lastDone), end: rel(t.expeditedAt), tone: 'dwell', label: 'Waiting to be bumped' }], marks: [{ at: rel(t.expeditedAt), label: 'Bumped' }] });
    const total = fin ? t.expeditedAt - t.createdAt : null;
    return { ticketId: t.id, num: t.num, customer: t.customer, channel: t.channel, status: t.status, totalMs: total, totalSec: total === null ? null : total / 1000, level: total === null ? null : levelOf(total, threshold(ds.settings, t.channel)), rows };
  };

  // Plate sync per finished, non-forced ticket with 2+ done items (F-M1). spread = last done minus first
  // done; lamp = average wait of a finished item for the last one.
  // Example: items done at 100, 120 and 220 s give spread 120 s and lamp (120 + 100 + 0) / 3 = 73.3 s.
  function syncRows(ctx) {
    return ctx.memo('sync', () => {
      const out = [];
      for (const v of ctx.spd) {
        if (v.forced) continue;
        let n = 0, sum = 0, mx = -Infinity, mn = Infinity;
        for (const it of v.items) { if (!it || it.status !== 'done' || !num(it.doneAt)) continue; n++; sum += it.doneAt; if (it.doneAt > mx) mx = it.doneAt; if (it.doneAt < mn) mn = it.doneAt; }
        if (n < 2) continue;                                 // a one-item ticket has nothing to synchronise
        out.push({ ticketId: v.id, num: v.num, channel: v.channel, date: v.date, hour: v.hour, items: n, spreadMs: mx - mn, lampMs: (n * mx - sum) / n, pacing: v.pacing, rush: v.rush });
      }
      return out;
    });
  }
  // Average, median and p90 (9 in 10 are below it) of spread and lamp. Nulls when there are no rows.
  function syncStats(ctx) {
    return ctx.memo('syncStats', () => {
      const rows = syncRows(ctx); const sp = stats(rows.map((r) => r.spreadMs)), lp = stats(rows.map((r) => r.lampMs));
      return { count: rows.length, avgSpreadMs: sp.avg, avgLampMs: lp.avg, medianSpreadMs: sp.median, medianLampMs: lp.median, p90SpreadMs: sp.p90, p90LampMs: lp.p90 };
    });
  }
  /**
   * Plate sync over finished, non-forced, non-voided tickets with >= 2 done items. spreadMs = maxDone - minDone;
   * lampMs = mean over items of (maxDone - doneAt_i) = how long finished food waits under the heat lamp for the last item.
   * @returns {{count,avgSpreadMs,avgLampMs,medianSpreadMs,medianLampMs,p90SpreadMs,p90LampMs,
   *   rows:Array<{ticketId,num,channel,date,hour,items,spreadMs,lampMs,pacing:boolean|null,rush}>}} stats are null when count is 0
   */
  M.plateSync = (ds, opts) => { const ctx = makeCtx(ds, opts); return Object.assign({}, syncStats(ctx), { rows: syncRows(ctx).slice() }); };

  /** Thresholds for a channel after settings.channels overrides. @returns {{channel,name,short,known,warnSec,breachSec,warnMs,breachMs}} */
  M.thresholds = (ds, channel) => threshold(ds && ds.settings, channel);
  /** 'ok' | 'warn' | 'breach' for a ticket time. totalMs >= warn is 'warn', totalMs >= breach is 'breach'. null when totalMs is not a number. */
  M.level = (ds, channel, totalMs) => (num(totalMs) ? levelOf(totalMs, threshold(ds && ds.settings, channel)) : null);
  // Counts tickets by level, with the on-time share (ok / count) and breach share. Null shares for no
  // tickets.
  function slaOf(rows) {
    let ok = 0, warn = 0, breach = 0; for (const r of rows) { if (r.level === 'ok') ok++; else if (r.level === 'warn') warn++; else breach++; }
    const n = rows.length; return { count: n, ok, warn, breach, onTimePct: n ? ok / n : null, breachPct: n ? breach / n : null };
  }
  /**
   * Service-level result for finished tickets. onTimePct = share with total < warn threshold.
   * @returns {{count,ok,warn,breach,onTimePct,breachPct,byChannel:Array<{channel,name,warnMs,breachMs,count,ok,warn,breach,onTimePct,breachPct}>}}
   */
  M.sla = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const by = {};
    for (const r of ctx.spd) (by[r.channel] || (by[r.channel] = [])).push(r);
    const ids = C.channels.map((c) => c.id).filter((k) => by[k]).concat(Object.keys(by).filter((k) => !C.channelById[k]).sort());
    return Object.assign(slaOf(ctx.spd), { byChannel: ids.map((k) => Object.assign({ channel: k, name: chanName(k), warnMs: ctx.th(k).warnMs, breachMs: ctx.th(k).breachMs }, slaOf(by[k]))) });
  };

  // All headline numbers (see M.summary), remembered on the context so repeat callers pay once.
  function summaryOf(ctx) {
    return ctx.memo('summary', () => {
      const st = stats(ctx.spd.map((r) => r.totalMs)); const s = slaOf(ctx.spd); const sy = syncStats(ctx);
      // perHour counts only hours that had a ticket, so a quiet stretch does not dilute it.
      const hrs = new Set(); for (const v of ctx.vol) hrs.add(v.hk);
      let doneLines = 0, overrides = 0; const zf = ctx.o.zone;
      for (const v of ctx.live) for (const it of v.items) { if (!it || (zf && it.zone !== zf)) continue; if (it.status === 'done') doneLines++; if (it.override === true) overrides++; }
      let recalls = 0, forced = 0; for (const v of ctx.live) recalls += v.recalls; for (const v of ctx.spd) if (v.forced) forced++;
      const rg = ctx.o;
      return {
        count: st.n, created: ctx.vol.length, avg: st.avg, median: st.median, p90: st.p90, p95: st.p95, min: st.min, max: st.max,
        onTimePct: s.onTimePct, ok: s.ok, warn: s.warn, overdue: s.breach, overduePct: s.breachPct,
        avgSpread: sy.avgSpreadMs, avgLamp: sy.avgLampMs, syncCount: sy.count,
        activeHours: hrs.size, perHour: hrs.size ? ctx.vol.length / hrs.size : null, itemsPerHour: hrs.size && doneLines ? doneLines / hrs.size : null, items: doneLines,
        voids: ctx.voided.length, recalls, forced, overrides, range: { from: isFinite(rg.from) ? rg.from : null, to: isFinite(rg.to) ? rg.to : null },
      };
    });
  }
  /**
   * Headline numbers for the filtered range (all durations in ms, *Pct as fractions, null when unknown).
   * count = finished tickets (speed stats); created = tickets placed (volume, honours includeVoided); perHour = created / active service hours
   * (distinct service-date + hour slots that had at least one ticket); itemsPerHour = done lines / active hours; overdue = tickets at/over breach;
   * warn = tickets at/over warn but under breach; voids/recalls/forced/overrides are counted over tickets created in the range.
   * @returns {{count,created,avg,median,p90,p95,min,max,onTimePct,ok,warn,overdue,overduePct,avgSpread,avgLamp,syncCount,activeHours,perHour,itemsPerHour,items,voids,recalls,forced,overrides,range:{from,to}}}
   */
  M.summary = (ds, opts) => Object.assign({}, summaryOf(makeCtx(ds, opts)));

  /**
   * Live pace index: median totalMs of the last 10 finished tickets (expeditedAt within the last 45 min of
   * opts.now) divided by the channel-mix weighted warn threshold of those tickets. < 0.8 comfortable,
   * 0.8..1 busy, > 1 behind.
   * Ignores from/to (it is a "right now" gauge): pass opts.now (the store clock) in the app; without it the
   * newest finished ticket is used as now. thin = fewer than 3 tickets.
   * Example: a median of 270 s against a weighted warn limit of 460 s gives 0.59, which is comfortable.
   * Given a prepared handle it keeps the handle's channel and zone filters and ignores its date range.
   * @returns {{index:number|null,level:'comfortable'|'busy'|'behind'|null,label:string,n:number,thin:boolean,medianMs:number|null,targetMs:number|null,
   *   windowMin:45,lastN:10,mix:Array<{channel,share,warnMs}>}}
   */
  M.paceIndex = (ds, opts) => {
    // A prepared handle keeps its channel and zone filters; only its date range is ignored (this is a right-now gauge).
    const kept = ds && ds.__sbctx === true ? ds.o.opts : {};
    ds = unwrap(ds); const o2 = Object.assign({}, kept, opts && typeof opts === 'object' ? opts : {}, { from: -Infinity, to: Infinity });
    const ctx = makeCtx(ds, o2); let now = ctx.o.now;
    if (now === null) for (const r of ctx.spd) if (now === null || r.expeditedAt > now) now = r.expeditedAt;
    const base = { index: null, level: null, label: 'No tickets finished in the last 45 minutes', n: 0, thin: true, medianMs: null, targetMs: null, windowMin: 45, lastN: 10, mix: [] };
    if (!num(now)) return base;
    // Only tickets bumped in the last 45 minutes, newest first, at most 10.
    const rows = ctx.spd.filter((r) => r.expeditedAt <= now && r.expeditedAt >= now - 45 * MIN).sort((a, b) => b.expeditedAt - a.expeditedAt).slice(0, 10);
    if (!rows.length) return base;
    const med = median(rows.map((r) => r.totalMs)); const cnt = {};
    // Target = each channel's warn limit weighted by how many of these tickets came from that channel.
    for (const r of rows) cnt[r.channel] = (cnt[r.channel] || 0) + 1;
    const mix = Object.keys(cnt).sort().map((k) => ({ channel: k, share: cnt[k] / rows.length, warnMs: ctx.th(k).warnMs }));
    let target = 0; for (const m of mix) target += m.share * m.warnMs;
    const index = target > 0 ? med / target : null;
    // Under 0.8 of target is comfortable, up to and including 1.0 is busy, above that is behind.
    const level = index === null ? null : index < 0.8 ? 'comfortable' : index <= 1 ? 'busy' : 'behind';
    const label = level === 'comfortable' ? 'Comfortable' : level === 'busy' ? 'Busy' : level === 'behind' ? 'Behind' : base.label;
    return { index, level, label, n: rows.length, thin: rows.length < 3, medianMs: med, targetMs: target, windowMin: 45, lastN: 10, mix };
  };

  /* ================= breakdowns: by hour, weekday, channel, station, item and day ================= */
  /** Done lines on tickets in the volume scope (voided tickets only with includeVoided). Money and sales counts come from these. */
  const moneyLines = (ctx) => ctx.memo('moneyLines', () => ctx.lines(true).filter((l) => l.done));
  /** Finished tickets with the value of their done lines (zone filter keeps only that zone's lines). */
  function ticketValues(ctx) {
    return ctx.memo('tvals', () => {
      const out = [];
      for (const v of ctx.spd) {
        let val = 0, n = 0;
        for (const it of v.items) { if (!it || it.status !== 'done') continue; if (ctx.o.zone && it.zone !== ctx.o.zone) continue; const r = lineRev(it); if (r !== null) { val += r; n++; } }
        if (n) out.push({ v, value: val });
      }
      return out;
    });
  }

  // Time statistics for finished-ticket rows: count, average, median, p10, p90, p95, min, max,
  // ok/warn/overdue counts, on-time share.
  function tstats(rows) {
    const st = stats(rows.map((r) => r.totalMs)); const s = slaOf(rows);
    return { count: st.n, avgMs: st.avg, medianMs: st.median, p10Ms: st.p10, p90Ms: st.p90, p95Ms: st.p95, minMs: st.min, maxMs: st.max, ok: s.ok, warn: s.warn, overdue: s.breach, onTimePct: s.onTimePct };
  }
  // Groups rows into lists by a key function: byKey(rows, r => r.channel) gives {takeout: [...], dine_in:
  // [...]}.
  const byKey = (rows, fn) => { const m = {}; for (const r of rows) { const k = fn(r); (m[k] || (m[k] = [])).push(r); } return m; };

  // One row per service hour, first to last hour with a ticket. An hour with none finished has count 0 and
  // null stats.
  function byHourRows(ctx) {
    return ctx.memo('byHour', () => {
      const g = byKey(ctx.spd, (r) => r.hour), cr = byKey(ctx.vol, (r) => r.hour);
      let lo = Infinity, hi = -Infinity;
      for (const k of Object.keys(g).concat(Object.keys(cr))) { if (+k < lo) lo = +k; if (+k > hi) hi = +k; }
      const out = [];
      for (let h = lo; h <= hi; h++) {
        const s = tstats(g[h] || []);
        out.push(Object.assign({ hour: h, x: h, y: s.medianMs, label: U.fmtHour(h), span: hourSpan(h), created: (cr[h] || EMPTY).length }, s));
      }
      return out;
    });
  }
  /**
   * Ticket time by service hour of createdAt (12:45 am is hour 24). Contiguous from the first to the last hour that has any ticket; hours with no
   * finished ticket have count 0 and null stats. x/y are ready for a line chart (x = hour, y = median ms).
   * @returns {Array<{hour:number,x:number,y:number|null,label,span,created:number,count,avgMs,medianMs,p10Ms,p90Ms,p95Ms,minMs,maxMs,ok,warn,overdue,onTimePct}>}
   */
  M.byHour = (ds, opts) => byHourRows(makeCtx(ds, opts)).slice();

  /**
   * Weekday x service-hour heatmap of median ticket time. Rows Mon..Sun (service-date weekday), columns = contiguous hours that have data.
   * @returns {{rows:string[],rowIds:number[],cols:string[],colIds:number[],values:Array<Array<number|null>>,counts:number[][],min:number|null,max:number|null}}
   *   values[r][c] = median totalMs or null (no tickets); rowIds are 0=Sun..6=Sat, colIds are hours.
   */
  M.byWeekdayHour = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const cells = {}; let lo = Infinity, hi = -Infinity;
    // Each cell is keyed weekday x 100 + hour, so Friday (5) at hour 12 is cell 512.
    for (const r of ctx.spd) { const k = r.wd * 100 + r.hour; (cells[k] || (cells[k] = [])).push(r.totalMs); if (r.hour < lo) lo = r.hour; if (r.hour > hi) hi = r.hour; }
    if (lo > hi) return { rows: [], rowIds: [], cols: [], colIds: [], values: [], counts: [], min: null, max: null };
    const rowIds = [1, 2, 3, 4, 5, 6, 0], colIds = []; for (let h = lo; h <= hi; h++) colIds.push(h);
    let mn = null, mx = null; const values = [], counts = [];
    for (const wd of rowIds) {
      const vr = [], cr = [];
      for (const h of colIds) { const a = cells[wd * 100 + h]; const m = a ? median(a) : null; vr.push(m); cr.push(a ? a.length : 0); if (m !== null) { mn = mn === null ? m : Math.min(mn, m); mx = mx === null ? m : Math.max(mx, m); } }
      values.push(vr); counts.push(cr);
    }
    return { rows: rowIds.map((d) => U.WEEKDAYS[d]), rowIds, cols: colIds.map((h) => U.fmtHour(h)), colIds, values, counts, min: mn, max: mx };
  };

  /**
   * Per-channel speed. Only channels with created tickets appear (config order first). Thresholds already include settings overrides.
   * @returns {Array<{channel,name,short,warnMs,breachMs,created,share,count,avgMs,medianMs,p10Ms,p90Ms,p95Ms,minMs,maxMs,ok,warn,overdue,onTimePct,avgSpreadMs,avgLampMs}>}
   */
  M.byChannel = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const sp = byKey(ctx.spd, (r) => r.channel), cr = byKey(ctx.vol, (r) => r.channel), sy = byKey(syncRows(ctx), (r) => r.channel);
    const ids = C.channels.map((c) => c.id).concat(Object.keys(cr).concat(Object.keys(sp)).filter((k) => !C.channelById[k]).sort()).filter((k, i, a) => a.indexOf(k) === i && (cr[k] || sp[k]));
    return ids.map((k) => {
      const t = ctx.th(k);
      return Object.assign({ channel: k, name: t.name || k, short: t.short || k, warnMs: t.warnMs, breachMs: t.breachMs, created: (cr[k] || EMPTY).length, share: ctx.vol.length ? (cr[k] || EMPTY).length / ctx.vol.length : null },
        tstats(sp[k] || []), { avgSpreadMs: mean((sy[k] || EMPTY).map((r) => r.spreadMs)), avgLampMs: mean((sy[k] || EMPTY).map((r) => r.lampMs)) });
    });
  };

  /**
   * Per-station line stats over done lines (no voided tickets). response = fired -> start tap (only two-step lines that have startedAt),
   * work = start (or fire, for one-step lines) -> done. criticalCount = finished tickets whose last item came from this station (anatomy);
   * overdueCritical = those that ended up at/over breach.
   * @returns {Array<{zone,name,code,lines,qty,responseN,avgResponseMs,medianResponseMs,p90ResponseMs,workN,avgWorkMs,medianWorkMs,p90WorkMs,
   *   criticalCount,criticalShare,overdueCritical}>} work zones in config order, only stations with lines
   */
  M.byZone = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const agg = {};
    for (const l of ctx.lines(false)) {
      if (!l.done || !l.it.zone) continue;
      const a = agg[l.it.zone] || (agg[l.it.zone] = { lines: 0, qty: 0, resp: [], work: [] });
      a.lines++; a.qty += l.qty;
      if (l.work !== null) { a.work.push(l.work); if (l.resp !== null) a.resp.push(l.resp); }
    }
    const crit = {}, od = {}; const an = anatomyRows(ctx);
    for (const r of an) { crit[r.criticalZone] = (crit[r.criticalZone] || 0) + 1; if (r.level === 'breach') od[r.criticalZone] = (od[r.criticalZone] || 0) + 1; }
    const ids = C.workZones.filter((z) => agg[z]).concat(Object.keys(agg).filter((z) => C.workZones.indexOf(z) < 0).sort());
    return ids.map((z) => {
      const a = agg[z], rs = stats(a.resp), ws = stats(a.work), zc = C.zoneById[z] || {};
      return { zone: z, name: zc.name || z, code: zc.code || z.toUpperCase(), lines: a.lines, qty: a.qty,
        responseN: rs.n, avgResponseMs: rs.avg, medianResponseMs: rs.median, p90ResponseMs: rs.p90,
        workN: ws.n, avgWorkMs: ws.avg, medianWorkMs: ws.median, p90WorkMs: ws.p90,
        criticalCount: crit[z] || 0, criticalShare: an.length ? (crit[z] || 0) / an.length : null, overdueCritical: od[z] || 0 };
    });
  };

  // One row per menu item over its done lines: sold, revenue, cost, margin, work time per unit, starter vs
  // learned prep. Biggest revenue first.
  function byItemRows(ctx) {
    return ctx.memo('byItem', () => {
      const mm = ctx.menuMap(), learned = ctx.ds.learned && typeof ctx.ds.learned === 'object' ? ctx.ds.learned : {}; const agg = {};
      for (const l of moneyLines(ctx)) {
        const it = l.it, v = l.v, id = it.menuId; if (id == null) continue;
        const a = agg[id] || (agg[id] = { name: it.name, zone: it.zone, sold: 0, lines: 0, revenue: 0, priced: 0, cost: 0, costedRev: 0, costedLines: 0, costedQty: 0, work: [] });
        a.sold += l.qty; a.lines++;
        const rv = l.rev, c = l.cost;
        if (rv !== null) { a.revenue += rv; a.priced++; }
        // Cost and margin use only lines with both a price and a cost, so a missing cost is never treated
        // as free.
        if (rv !== null && c !== null) { a.cost += c; a.costedRev += rv; a.costedLines++; a.costedQty += l.qty; }
        // Work time per unit = work / quantity factor. Fired-early lines and forced bumps are skipped, as
        // in the prep-time learner.
        if (l.work !== null && !v.voided && !v.forced && it.override !== true) a.work.push(l.work / l.scale);
      }
      let totalRev = 0; for (const k in agg) totalRev += agg[k].revenue;
      const rows = Object.keys(agg).map((id) => {
        const a = agg[id], m = mm[id] || {}, L = learned[id], w = stats(a.work);
        return { menuId: id, name: a.name || m.name || id, zone: a.zone || m.zone || null, cat: m.cat || null, sold: a.sold, lines: a.lines,
          costedQty: a.costedQty, revenue: a.priced ? a.revenue : null, cost: a.costedLines ? a.cost : null,
          margin: a.costedLines ? a.costedRev - a.cost : null, marginPct: a.costedRev > 0 ? (a.costedRev - a.cost) / a.costedRev : null, costPct: a.costedRev > 0 ? a.cost / a.costedRev : null,
          costCoverage: a.lines ? a.costedLines / a.lines : null, share: totalRev > 0 && a.priced ? a.revenue / totalRev : null,
          avgWorkMs: w.avg, medianWorkMs: w.median, workN: w.n,
          starterSec: num(m.prepSec) ? m.prepSec : null, learnedSec: L && num(L.est) ? L.est : null, learnedN: L && num(L.n) ? L.n : 0, confirmed: m.prepConfirmed === true };
      });
      rows.sort((a, b) => (b.revenue === null ? -1 : b.revenue) - (a.revenue === null ? -1 : a.revenue) || (a.name < b.name ? -1 : 1));
      return rows;
    });
  }
  /**
   * Per menu item over done lines (voided tickets only with includeVoided). sold = sum of qty. cost/margin use only lines that have a recorded cost
   * (margin = revenue of those lines - cost); costCoverage says how many lines that was. Work times are per unit (divided by the quantity factor), skip
   * overridden items and forced tickets (same rules as the learner). Sorted by revenue desc.
   * @returns {Array<{menuId,name,zone,cat,sold,lines,costedQty,revenue,cost,margin,marginPct,costPct,costCoverage,share,avgWorkMs,medianWorkMs,workN,
   *   starterSec,learnedSec,learnedN,confirmed}>}
   */
  M.byItem = (ds, opts) => byItemRows(makeCtx(ds, opts)).slice();

  /**
   * Daily trend, ascending by service date; only days that have tickets. pacing = true/false when every ticket that day agreed, 'mixed', or null.
   * @returns {Array<{date,label,weekday:number,tickets,voids,forced,count,medianMs,avgMs,p90Ms,onTimePct,overdue,avgSpreadMs,avgLampMs,perHour,
   *   revenue,avgTicketValue,foodCostPct,pacing}>}
   */
  M.byDay = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const vol = byKey(ctx.vol, (r) => r.date), sp = byKey(ctx.spd, (r) => r.date), vd = byKey(ctx.voided, (r) => r.date);
    const sy = byKey(syncRows(ctx), (r) => r.date), ml = byKey(moneyLines(ctx), (l) => l.v.date), tv = byKey(ticketValues(ctx), (x) => x.v.date);
    return Object.keys(vol).sort().map((d) => {
      const rows = vol[d], hrs = new Set(rows.map((r) => r.hour)); let rev = 0, pr = 0, cost = 0, cr = 0, forced = 0;
      for (const l of ml[d] || EMPTY) { const rv = l.rev, c = l.cost; if (rv !== null) { rev += rv; pr++; } if (rv !== null && c !== null) { cost += c; cr += rv; } }
      for (const r of sp[d] || EMPTY) if (r.forced) forced++;
      const pv = new Set(rows.filter((r) => !r.voided && r.pacing !== null).map((r) => r.pacing));
      return Object.assign({ date: d, label: U.fmtDateShort(d), weekday: U.weekday(d), tickets: rows.length, voids: (vd[d] || EMPTY).length, forced }, (() => { const s = tstats(sp[d] || []); return { count: s.count, medianMs: s.medianMs, avgMs: s.avgMs, p90Ms: s.p90Ms, onTimePct: s.onTimePct, overdue: s.overdue }; })(), {
        avgSpreadMs: mean((sy[d] || EMPTY).map((r) => r.spreadMs)), avgLampMs: mean((sy[d] || EMPTY).map((r) => r.lampMs)),
        perHour: hrs.size ? rows.length / hrs.size : null, revenue: pr ? rev : null, avgTicketValue: mean((tv[d] || EMPTY).map((x) => x.value)), foodCostPct: cr > 0 ? cost / cr : null,
        pacing: pv.size === 0 ? null : pv.size === 2 ? 'mixed' : pv.has(true),
      });
    });
  };

  /* ================= time buckets: throughput, histogram, queue load ================= */
  // Bucket width in minutes for throughput and queue charts: opts.bucketMin if valid, otherwise 15.
  const bucketMinOf = (ctx) => { const b = ctx.o.opts.bucketMin; return num(b) && b > 0 ? b : 15; };
  /** Keep, for each service date, only the buckets between its first and last active bucket (no dead overnight stretch). */
  function trimDays(points, active) {
    const first = {}, last = {};
    points.forEach((p, i) => { if (active(p)) { if (!(p.date in first)) first[p.date] = i; last[p.date] = i; } });
    return points.filter((p, i) => p.date in first && i >= first[p.date] && i <= last[p.date]);
  }
  // A moment as its service date plus its hour on that date (12:45 am is 24.75 of the previous date).
  function stamp(ctx, t) { const date = ctx.dateOf(t); return { t, date, hour: wallHourOn(t, date) }; }
  /** Average absolute buckets over service days into time-of-day slots. */
  function foldPoints(ctx, points, bmin, fields) {
    const days = new Set(points.map((p) => p.date)).size; const slots = {};
    for (const p of points) {
      const k = Math.round((p.hour * 60) / bmin); const s = slots[k] || (slots[k] = { slot: k, sums: {} });
      for (const f of fields) s.sums[f] = (s.sums[f] || 0) + (p.v[f] || 0);
    }
    const ks = Object.keys(slots).map(Number); if (!ks.length) return { days: 0, points: [] };
    const out = [];
    for (let k = Math.min.apply(null, ks); k <= Math.max.apply(null, ks); k++) {
      const s = slots[k]; const hour = (k * bmin) / 60; const v = {};
      for (const f of fields) v[f] = days ? ((s && s.sums[f]) || 0) / days : 0;
      out.push({ slot: k, hour, x: hour, v });
    }
    return { days, points: out };
  }

  /**
   * Tickets per bucket. Default: a timeline of absolute buckets (x = t ms) trimmed to each service day's active span. With opts.fold = true the days
   * are averaged into time-of-day slots (x = decimal service hour, y = average per service day) so it lines up under byHour.
   * completed = finished tickets by expeditedAt; created = tickets placed by createdAt (honours includeVoided). y = completed.
   * @param {object} opts {bucketMin=15, fold=false, ...range/channel/zone}
   * @returns {{bucketMin,fold,days:number,total:number,peak:null|{x,hour,y},points:Array<{t?:number,date?:string,x:number,hour:number,y:number,completed:number,created:number}>}}
   */
  M.throughput = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const bmin = bucketMinOf(ctx), bm = bmin * MIN, fold = !!ctx.o.opts.fold;
    const res = { bucketMin: bmin, fold, days: 0, total: ctx.spd.length, peak: null, points: [] };
    const stamps = []; for (const v of ctx.vol) stamps.push(v.createdAt); for (const v of ctx.spd) stamps.push(v.expeditedAt);
    if (!stamps.length) return res;
    let t0 = Infinity, t1 = -Infinity; for (const s of stamps) { if (s < t0) t0 = s; if (s > t1) t1 = s; }
    // Buckets are cut on the wall clock: each moment gets its own UTC offset, so a bucket starts on :00, :15, :30 or :45 of the kitchen's clock
    // also after a clock change inside the range. Bucket number k is "wall minutes since 1970 / width"; the repeated hour of a fall-back
    // night is one bucket, and the hour that does not exist in spring has no bucket.
    const cm = {}, dm = {};
    for (const v of ctx.vol) { const k = Math.floor((v.createdAt + tzOff(v.createdAt)) / bm); cm[k] = (cm[k] || 0) + 1; }
    for (const v of ctx.spd) { const k = Math.floor((v.expeditedAt + tzOff(v.expeditedAt)) / bm); dm[k] = (dm[k] || 0) + 1; }
    const k0 = Math.floor((t0 + tzOff(t0)) / bm), k1 = Math.floor((t1 + tzOff(t1)) / bm); let pts = [];
    // A huge span (over 30 000 buckets) keeps only buckets that have tickets, to avoid a giant list of
    // zeros.
    if (k1 - k0 > 30000) { const ks = Object.keys(cm).concat(Object.keys(dm)).map(Number).filter((k, i, a) => a.indexOf(k) === i).sort((a, b) => a - b); for (const k of ks) { const pt = mkT(k); if (pt) pts.push(pt); } }
    else for (let k = k0; k <= k1; k++) { const pt = mkT(k); if (pt) pts.push(pt); }
    // The real moment a wall-clock reading happened, or null when the kitchen's clock never showed it (spring forward).
    function realOf(wall) {
      const w = new Date(wall), t = new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds(), 0).getTime();
      return t + tzOff(t) === wall ? t : null;
    }
    // Builds the point for bucket number k (null for a wall-clock time that does not exist).
    function mkT(k) { const t = realOf(k * bm); if (t === null) return null; const st = stamp(ctx, t); return Object.assign(st, { x: st.t, completed: dm[k] || 0, created: cm[k] || 0, v: { completed: dm[k] || 0, created: cm[k] || 0 } }); }
    pts = trimDays(pts, (p) => p.completed + p.created > 0);
    if (fold) {
      const f = foldPoints(ctx, pts, bmin, ['completed', 'created']); res.days = f.days;
      res.points = f.points.map((p) => ({ slot: p.slot, x: p.x, hour: p.hour, y: p.v.completed, completed: p.v.completed, created: p.v.created }));
    } else {
      res.days = new Set(pts.map((p) => p.date)).size;
      res.points = pts.map((p) => ({ t: p.t, date: p.date, x: p.t, hour: p.hour, y: p.completed, completed: p.completed, created: p.created }));
    }
    for (const p of res.points) if (!res.peak || p.y > res.peak.y) res.peak = { x: p.x, hour: p.hour, y: p.y };
    if (res.peak && res.peak.y === 0) res.peak = null;
    return res;
  };

  /**
   * Histogram of durations. `valuesMs` are milliseconds, `binSec` is the bin width in SECONDS (default 60). Bins start at floor(min/bin)*bin unless
   * o.min is given; with o.max, larger values are clamped into the last bin (overflow counts them). Non-numbers are skipped.
   * @returns {{binSec,binMs,n:number,min:number|null,max:number|null,overflow:number,bins:Array<{x0:number,x1:number,x0Sec:number,x1Sec:number,label,count:number,share:number}>,counts:number[]}}
   */
  M.histogram = (valuesMs, binSec, o) => {
    o = o || {}; const binMs = (num(binSec) && binSec > 0 ? binSec : 60) * 1000; const v = arr(valuesMs).filter(num);
    const res = { binSec: binMs / 1000, binMs, n: v.length, min: null, max: null, overflow: 0, bins: [], counts: [] };
    if (!v.length) return res;
    let mn = Infinity, mx = -Infinity; for (const x of v) { if (x < mn) mn = x; if (x > mx) mx = x; }
    res.min = mn; res.max = mx;
    const lo = num(o.min) ? o.min : Math.floor(mn / binMs) * binMs;
    const capped = num(o.max);
    let nb = capped ? Math.max(1, Math.ceil((o.max - lo) / binMs)) : Math.floor((mx - lo) / binMs) + 1;
    nb = Math.max(1, Math.min(2000, nb));
    const counts = new Array(nb).fill(0);
    for (const x of v) { let i = Math.floor((x - lo) / binMs); if (i < 0) i = 0; if (i >= nb) { i = nb - 1; if (capped) res.overflow++; } counts[i]++; }
    res.counts = counts;
    res.bins = counts.map((c, i) => ({ x0: lo + i * binMs, x1: lo + (i + 1) * binMs, x0Sec: (lo + i * binMs) / 1000, x1Sec: (lo + (i + 1) * binMs) / 1000, label: U.fmtClock(lo + i * binMs), count: c, share: c / v.length }));
    return res;
  };

  /**
   * Ticket-time histogram of finished tickets with a per-channel split on the same bins and each channel's warn/breach lines.
   * @param {object} opts {binSec=60, maxSec (overflow bin), ...filters}
   * @returns {{binSec,binMs,n,medianMs,p90Ms,bins:Array<{x0,x1,x0Sec,x1Sec,label,count,share,byChannel:Object<string,number>}>,channels:Array<{channel,name,warnMs,breachMs,count}>}}
   */
  M.ticketHistogram = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const o = ctx.o.opts; const rows = ctx.spd;
    const h = M.histogram(rows.map((r) => r.totalMs), num(o.binSec) ? o.binSec : 60, { max: num(o.maxSec) ? o.maxSec * 1000 : undefined });
    const st = stats(rows.map((r) => r.totalMs)); const chs = byKey(rows, (r) => r.channel);
    for (const b of h.bins) b.byChannel = {};
    for (const r of rows) { if (!h.bins.length) break; let i = Math.floor((r.totalMs - h.bins[0].x0) / h.binMs); i = Math.max(0, Math.min(h.bins.length - 1, i)); h.bins[i].byChannel[r.channel] = (h.bins[i].byChannel[r.channel] || 0) + 1; }
    const ids = C.channels.map((c) => c.id).filter((k) => chs[k]).concat(Object.keys(chs).filter((k) => !C.channelById[k]).sort());
    return { binSec: h.binSec, binMs: h.binMs, n: h.n, medianMs: st.median, p90Ms: st.p90, bins: h.bins, channels: ids.map((k) => ({ channel: k, name: chanName(k), warnMs: ctx.th(k).warnMs, breachMs: ctx.th(k).breachMs, count: chs[k].length })) };
  };

  /**
   * Open item lines per station over time, reconstructed from firedAt -> doneAt (lines still open run to opts.now, else the newest timestamp in the data;
   * forced-bumped lines end at the bump, voided ones at voidedAt; a line is capped at 12 h so one stale ticket cannot paint days of load).
   * Each bucket value is the TIME-AVERAGE number of open lines in the bucket. opts.fold = true averages service days into time-of-day slots.
   * @param {object} opts {bucketMin=15, fold=false, now, ...filters}
   * @returns {{bucketMin,fold,days,zones:string[],names:Object<string,string>,peak:null|{x,hour,total,zone},
   *   points:Array<{t?,date?,x,hour,total,byZone:Object<string,number>}>,series:Array<{zone,name,points:Array<[number,number]>}>}}
   *   x = t ms on the timeline, decimal service hour when folded
   */
  M.queueLoad = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const bmin = bucketMinOf(ctx), bm = bmin * MIN, fold = !!ctx.o.opts.fold, now = ctx.nowMs();
    const res = { bucketMin: bmin, fold, days: 0, zones: [], names: {}, peak: null, points: [], series: [] };
    const iv = [];
    // Step 1: turn each open item into an interval from when it fired to when it ended.
    for (const { it, v } of ctx.lines(true)) {
      if (!num(it.firedAt) || !it.zone) continue;
      // A line ends when done; else when its ticket was voided or bumped (a forced bump leaves lines
      // undone); else "now".
      let end = null;
      if (it.status === 'done' && num(it.doneAt)) end = it.doneAt;
      else if (v.t.status === 'voided') end = num(v.t.voidedAt) ? v.t.voidedAt : null;
      else if (v.t.status === 'expedited') end = num(v.t.expeditedAt) ? v.t.expeditedAt : null;
      else end = now;
      if (!num(end) || end <= it.firedAt) continue;
      // A line open over 12 hours is cut off at 12, so one forgotten ticket cannot paint days of load.
      iv.push([it.firedAt, Math.min(end, it.firedAt + 12 * H), it.zone]);
    }
    if (!iv.length) return res;
    // Step 2: per station and bucket, add up the milliseconds of open-line time inside the bucket. Buckets are
    // counted on the wall clock like throughput: each line uses the clock offset at its own start, so a range
    // that crosses a clock change keeps every day's buckets on the hour the kitchen's clock showed.
    const acc = {}; let kmin = Infinity, kmax = -Infinity;
    for (const [s, e, z] of iv) {
      const off = tzOff(s), m = acc[z] || (acc[z] = {});
      const a = Math.floor((s + off) / bm), b = Math.floor((e + off - 1e-6) / bm);
      for (let k = a; k <= b; k++) { const bs = k * bm - off; const ov = Math.min(e, bs + bm) - Math.max(s, bs); if (ov > 0) m[k] = (m[k] || 0) + ov; }
      if (a < kmin) kmin = a; if (b > kmax) kmax = b;
    }
    // Step 3: open lines in a bucket = open time / bucket length.
    const zones = C.workZones.filter((z) => acc[z]).concat(Object.keys(acc).filter((z) => C.workZones.indexOf(z) < 0).sort());
    let pts = [];
    for (let k = kmin; k <= kmax; k++) {
      // The real moment the wall-clock bucket starts; a wall time the clock skipped (spring forward) has no bucket.
      const wall = k * bm, t = wall - tzOff(wall - tzOff(wall));
      if (t + tzOff(t) !== wall) continue;
      const st = stamp(ctx, t); const bs = st.t;
      // The bucket holding an explicit opts.now is divided by the time elapsed so far, not its full width
      // (F-M8).
      const div = ctx.o.now !== null && now > bs && now < bs + bm ? now - bs : bm; const v = {}; let tot = 0;
      for (const z of zones) { const val = ((acc[z][k] || 0) / div); v[z] = val; tot += val; }
      v.total = tot; pts.push(Object.assign(st, { x: st.t, v }));
    }
    pts = trimDays(pts, (p) => p.v.total > 0);
    // Step 4: fold the days into time-of-day slots or keep the timeline, then find the busiest point.
    let out;
    if (fold) {
      const f = foldPoints(ctx, pts, bmin, zones.concat(['total'])); res.days = f.days;
      out = f.points.map((p) => { const bz = {}; for (const z of zones) bz[z] = p.v[z]; return { x: p.x, hour: p.hour, total: p.v.total, byZone: bz }; });
    } else {
      res.days = new Set(pts.map((p) => p.date)).size;
      out = pts.map((p) => { const bz = {}; for (const z of zones) bz[z] = p.v[z]; return { t: p.t, date: p.date, x: p.t, hour: p.hour, total: p.v.total, byZone: bz }; });
    }
    res.zones = zones; for (const z of zones) res.names[z] = zoneName(z);
    res.points = out;
    res.series = zones.map((z) => ({ zone: z, name: zoneName(z), points: out.map((p) => [p.x, p.byZone[z]]) }));
    for (const p of out) if (!res.peak || p.total > res.peak.total) { let bz = null, bv = -1; for (const z of zones) if (p.byZone[z] > bv) { bv = p.byZone[z]; bz = z; } res.peak = { x: p.x, hour: p.hour, total: p.total, zone: bz }; }
    return res;
  };

  /* ================= pacing A/B and calibration ================= */
  /**
   * Finish together on vs off, from ticket.pacing. Rush tickets are left out of both sides (they skip pacing by design).
   * Spread/lamp use tickets with >= 2 done items; medianTotalMs uses every finished ticket of that side.
   * @returns {{comparable:boolean,on:Side,off:Side,lampSavedMs:number|null,lampCutPct:number|null,spreadSavedMs:number|null,medianDeltaMs:number|null}}
   *   Side = {pacing:boolean,label,tickets,syncTickets,days,medianTotalMs,avgTotalMs,avgSpreadMs,avgLampMs,medianSpreadMs,medianLampMs}
   *   saved = off minus on (positive = less food waiting with Finish together on); medianDeltaMs = on minus off (can be positive: pacing is not meant to cut ticket time)
   */
  M.pacingCompare = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const sync = syncRows(ctx);
    // Stats for tickets with Finish together on (true) or off (false). Rush tickets skip pacing by design, so both
    // sides leave them out.
    const side = (flag) => {
      const tix = ctx.spd.filter((r) => r.pacing === flag && !r.rush), sy = sync.filter((r) => r.pacing === flag && !r.rush);
      const t = stats(tix.map((r) => r.totalMs)), sp = stats(sy.map((r) => r.spreadMs)), lp = stats(sy.map((r) => r.lampMs));
      return { pacing: flag, label: flag ? 'Finish together on' : 'Finish together off', tickets: t.n, syncTickets: sy.length, days: new Set(tix.map((r) => r.date)).size,
        medianTotalMs: t.median, avgTotalMs: t.avg, avgSpreadMs: sp.avg, avgLampMs: lp.avg, medianSpreadMs: sp.median, medianLampMs: lp.median };
    };
    const on = side(true), off = side(false); const both = on.syncTickets > 0 && off.syncTickets > 0;
    return { comparable: both, on, off,
      lampSavedMs: both ? off.avgLampMs - on.avgLampMs : null, lampCutPct: both && off.avgLampMs > 0 ? (off.avgLampMs - on.avgLampMs) / off.avgLampMs : null,
      spreadSavedMs: both ? off.avgSpreadMs - on.avgSpreadMs : null, medianDeltaMs: on.tickets && off.tickets ? on.medianTotalMs - off.medianTotalMs : null };
  };

  // An item "drifts" when its real time is under 0.8x or over 1.25x its starter estimate; exactly 0.8 or
  // 1.25 is not drift (F-M11).
  const CAL_LOW = 0.8, CAL_HIGH = 1.25;
  M.CALIBRATION_BOUNDS = { low: CAL_LOW, high: CAL_HIGH };
  /**
   * Starter vs learned vs observed prep time per menu item. observed = median per-unit work time (done - start, or done - fire for one-step lines,
   * divided by the quantity factor; overridden items and forced tickets excluded, like the learner). ratio = observed / starter.
   * flag = enough samples (opts.minSamples, default 5) AND ratio outside [0.8, 1.25] (exactly 0.8 or 1.25 is not drift).
   * Order: flagged (largest drift first), then the rest, then thin items.
   * @returns {Array<{menuId,name,zone,starterSec,learnedSec,learnedN,observedSec,n,ratio,learnedRatio,deltaSec,planGapSec,thin:boolean,flag:boolean,drift:'slow'|'fast'|null,confirmed:boolean}>}
   */
  M.calibration = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const minN = num(ctx.o.opts.minSamples) ? ctx.o.opts.minSamples : 5;
    const rows = byItemRows(ctx).filter((r) => r.workN > 0).map((r) => {
      const obs = r.medianWorkMs / 1000, ratio = num(r.starterSec) && r.starterSec > 0 ? obs / r.starterSec : null, thin = r.workN < minN;
      const flag = !thin && ratio !== null && (ratio < CAL_LOW || ratio > CAL_HIGH);
      return { menuId: r.menuId, name: r.name, zone: r.zone, starterSec: r.starterSec, learnedSec: r.learnedSec, learnedN: r.learnedN, observedSec: obs, n: r.workN, ratio,
        learnedRatio: r.learnedSec !== null && r.starterSec > 0 ? r.learnedSec / r.starterSec : null, deltaSec: r.starterSec !== null ? obs - r.starterSec : null,
        planGapSec: r.learnedSec !== null ? r.learnedSec - obs : null, thin, flag, drift: flag ? (ratio > CAL_HIGH ? 'slow' : 'fast') : null, confirmed: r.confirmed };
    });
    // Distance of the ratio from 1.0 on a log scale, so "twice as slow" and "half as fast" rank equally.
    const mag = (r) => (r.ratio === null ? 0 : Math.abs(Math.log(r.ratio)));
    rows.sort((a, b) => (a.thin - b.thin) || (b.flag - a.flag) || (mag(b) - mag(a)) || (a.name < b.name ? -1 : 1));
    return rows;
  };

  /* ================= stock, 86 and channel sync ================= */
  // Ids of hot-held protein ingredients (TCS: must stay hot for safety) used by meat and sandwich items;
  // the sell-out clock tracks these.
  function proteinIngs(ctx) {
    return ctx.memo('proteins', () => {
      const set = {}, im = ctx.ingMap(), mm = ctx.menuMap();
      for (const id in mm) { const m = mm[id]; if (m.cat === 'meat' || m.cat === 'sandwich') for (const b of arr(m.bom)) { const i = im[b.ing]; if (i && i.tcs && i.hold === 'hot') set[b.ing] = true; } }
      return set;
    });
  }
  // Builds the 86 spells from avail_changed events (unavailable until back; undone events ignored). A spell
  // still open has endT and durationMs null.
  function eightySixList(ctx) {
    return ctx.memo('spells', () => {
      const evs = ctx.ev('avail_changed').slice().sort((a, b) => a.t - b.t), open = {}, out = [], mm = ctx.menuMap();
      for (const e of evs) {
        if (e.menuId == null) continue;
        if (e.ok === false) { if (!open[e.menuId]) open[e.menuId] = { menuId: e.menuId, reason: e.reason || null, ing: e.ing || null, startT: e.t, endT: null }; }
        else if (e.ok === true && open[e.menuId]) { open[e.menuId].endT = e.t; out.push(open[e.menuId]); delete open[e.menuId]; }
      }
      for (const k in open) out.push(open[k]);
      out.sort((a, b) => a.startT - b.startT);
      return out.map((s) => { const date = ctx.dateOf(s.startT); return Object.assign(s, { name: (mm[s.menuId] && mm[s.menuId].name) || s.menuId, date, hour: (s.startT - dayMs(date)) / H, durationMs: s.endT === null ? null : s.endT - s.startT }); });
    });
  }
  /**
   * Every spell during which a menu item was unavailable (avail_changed ok:false ... ok:true). endT/durationMs are null while still 86'd.
   * reason = 'stock' | 'manual' | 'safety' (the reason of the first event of the spell).
   * @returns {Array<{menuId,name,reason,ing,startT,endT:number|null,durationMs:number|null,date,hour}>} oldest first
   */
  M.eightySixes = (ds, opts) => eightySixList(makeCtx(ds, opts)).map((s) => Object.assign({}, s));

  /**
   * Stock level of one ingredient across one service day, rebuilt from batch intake, ticket-item depletion (item.depleted) and discards. TCS: each
   * day's batches are tracked on their own (opening 0, depletions matched by batchId; if no depletion carries a batchId all of the day's depletions are
   * used). Non-TCS: opening = opts.openingG or the ingredient's par (openingAssumed = true) plus restock events.
   * @param {object} opts {day:'YYYY-MM-DD' (default: newest day with data), ing:'brisket', openingG?}
   * The level never shows below zero: grams used beyond what was counted in are added up in overdrawnG instead (with an
   * assumed opening that means the real opening was above par).
   * @returns {{day,ing,name,unit,tcs,thresholdG,parG,openingG,openingAssumed,openMs,closeMs,intakeG,usedG,wasteG,endG,minG,minAt,overdrawnG,
   *   points:Array<{t,hour,g,d,kind:'intake'|'use'|'waste'|'restock'}>,batches:Array<{id,label,enteredAt,cookedG}>}}
   */
  M.stockBurn = (ds, opts) => {
    ds = unwrap(ds); ds = ds && typeof ds === 'object' ? ds : {}; opts = opts && typeof opts === 'object' ? opts : {};
    const ctx = makeCtx(ds, { from: -Infinity, to: Infinity }); const im = ctx.ingMap(); const ing = opts.ing; const meta = im[ing];
    const empty = { day: null, ing: ing || null, name: meta ? meta.name : ing || null, unit: meta ? meta.unit : null, tcs: !!(meta && meta.tcs), thresholdG: meta && num(meta.thresholdG) ? meta.thresholdG : null, parG: meta && num(meta.parG) ? meta.parG : null,
      openingG: null, openingAssumed: false, openMs: null, closeMs: null, intakeG: 0, usedG: 0, wasteG: 0, endG: null, minG: null, minAt: null, overdrawnG: 0, points: [], batches: [] };
    if (!ing) return empty;
    let day = typeof opts.day === 'string' ? opts.day : null;
    if (!day) { const ds2 = []; for (const v of ctx.all) ds2.push(v.date); for (const b of arr(ds.batches)) if (b && num(b.enteredAt)) ds2.push(ctx.dateOf(b.enteredAt)); ds2.sort(); day = ds2.length ? ds2[ds2.length - 1] : null; }
    if (!day) return empty;
    const res = Object.assign({}, empty, { day, openMs: hourMs(day, ctx.svc.openHour), closeMs: hourMs(day, ctx.svc.closeHour) });
    const deltas = []; const tcs = !!(meta && meta.tcs);
    const dep = []; let anyBatchId = false;
    for (const v of ctx.all) for (const it of v.items) {
      if (!it || it.status !== 'done' || !num(it.doneAt) || !Array.isArray(it.depleted)) continue;
      for (const d of it.depleted) if (d && d.ing === ing && num(d.g) && d.g > 0) { dep.push({ t: it.doneAt, g: d.g, b: d.batchId }); if (d.batchId) anyBatchId = true; }
    }
    // Hot-held (TCS) food: stock is only what that day's batches brought in, minus use and discards.
    // Opening is 0.
    if (tcs) {
      // A cooling batch only moves grams that were already counted at intake (F-S6), so it is not new intake.
      const bs = arr(ds.batches).filter((b) => b && b.kind !== 'cooling' && b.ing === ing && num(b.enteredAt) && num(b.cookedG) && ctx.dateOf(b.enteredAt) === day), ids = new Set(bs.map((b) => b.id));
      res.openingG = 0;
      for (const b of bs) {
        deltas.push({ t: b.enteredAt, d: b.cookedG, kind: 'intake' }); res.batches.push({ id: b.id, label: b.label || b.id, enteredAt: b.enteredAt, cookedG: b.cookedG });
        if (num(b.discardedAt) && num(b.wasteG) && b.wasteG > 0) deltas.push({ t: b.discardedAt, d: -b.wasteG, kind: 'waste' });
      }
      for (const x of dep) if (anyBatchId ? ids.has(x.b) : ctx.dateOf(x.t) === day) deltas.push({ t: x.t, d: -x.g, kind: 'use' });
    } else {
      // Other ingredients: start from the given opening count or the par level (openingAssumed says so),
      // plus restocks.
      res.openingG = num(opts.openingG) ? opts.openingG : (meta && num(meta.parG) ? meta.parG : 0); res.openingAssumed = !num(opts.openingG);
      for (const e of arr(ds.events)) if (e && e.type === 'restock' && !e.reverted && e.ing === ing && num(e.t) && num(e.g) && ctx.dateOf(e.t) === day) deltas.push({ t: e.t, d: e.g, kind: 'restock' });
      for (const x of dep) if (ctx.dateOf(x.t) === day) deltas.push({ t: x.t, d: -x.g, kind: 'use' });
    }
    // At the same moment, stock coming in is counted before stock going out, so the level never dips below
    // the truth.
    const rank = { intake: 0, restock: 0, use: 1, waste: 1 };
    deltas.sort((a, b) => a.t - b.t || rank[a.kind] - rank[b.kind]);
    let lvl = res.openingG; res.endG = lvl;
    for (const d of deltas) {
      lvl += d.d;
      // A level below zero is not stock: the count in was too low (often an assumed par), so it is noted, not shown.
      if (lvl < 0) { res.overdrawnG += -lvl; lvl = 0; }
      res.points.push({ t: d.t, hour: wallHourOn(d.t, day), g: lvl, d: d.d, kind: d.kind });
      if (d.kind === 'intake' || d.kind === 'restock') res.intakeG += d.d; else if (d.kind === 'use') res.usedG += -d.d; else res.wasteG += -d.d;
      if (res.minG === null || lvl < res.minG) { res.minG = lvl; res.minAt = d.t; }
    }
    res.endG = lvl; if (!res.points.length) { res.minG = null; res.endG = tcs ? null : res.openingG; }
    return res;
  };

  /**
   * First sell-out per protein per service day: the first avail_changed (ok:false, reason stock or manual) for a menu item that uses that protein,
   * compared with the closing hour (settings.service.closeHour). Safety lockouts are not sell-outs. Days with data but no sell-out appear with empty items.
   * hoursBeforeClose is negative when the 86 happened after close.
   * @returns {{closeHour:number,dayCount:number,proteins:Array<{ing,name,days:number,share:number|null}>,
   *   days:Array<{date,label,weekday,closeMs,items:Array<{ing,name,t,hour,hoursBeforeClose,reason,menuId,menuName}>}>,rows:Array<{date,ing,name,t,hour,hoursBeforeClose,reason,menuId,menuName}>}}
   */
  M.sellOutClock = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const prot = proteinIngs(ctx), im = ctx.ingMap(), mm = ctx.menuMap(), close = num(ctx.svc.closeHour) ? ctx.svc.closeHour : 21;
    const first = {};
    for (const e of ctx.ev('avail_changed')) {
      // Safety lockouts are not sell-outs (F-M13); only stock or manual 86s count.
      if (e.ok !== false || (e.reason !== 'stock' && e.reason !== 'manual')) continue;
      let ing = e.ing && prot[e.ing] ? e.ing : null;
      if (!ing && mm[e.menuId]) for (const b of arr(mm[e.menuId].bom)) if (prot[b.ing]) { ing = b.ing; break; }
      if (!ing) continue;
      const date = ctx.dateOf(e.t), k = date + '|' + ing;
      if (!first[k] || e.t < first[k].t) first[k] = { date, ing, e };
    }
    // Days with tickets but no sell-out still appear (empty), so "3 of 4 days" has the right 4.
    const dates = new Set(ctx.dates()); for (const k in first) dates.add(first[k].date);
    const rows = Object.keys(first).map((k) => {
      const f = first[k], closeMs = hourMs(f.date, close);
      return { date: f.date, ing: f.ing, name: im[f.ing] ? im[f.ing].name : f.ing, t: f.e.t, hour: wallHourOn(f.e.t, f.date), hoursBeforeClose: (closeMs - f.e.t) / H, reason: f.e.reason, menuId: f.e.menuId, menuName: mm[f.e.menuId] ? mm[f.e.menuId].name : f.e.menuId };
    }).sort((a, b) => a.t - b.t);
    const days = Array.from(dates).sort().map((d) => ({ date: d, label: U.fmtDateShort(d), weekday: U.weekday(d), closeMs: hourMs(d, close), items: rows.filter((r) => r.date === d).map((r) => ({ ing: r.ing, name: r.name, t: r.t, hour: r.hour, hoursBeforeClose: r.hoursBeforeClose, reason: r.reason, menuId: r.menuId, menuName: r.menuName })) }));
    const pc = {}; for (const r of rows) pc[r.ing] = (pc[r.ing] || 0) + 1;
    const proteins = Object.keys(prot).map((i) => ({ ing: i, name: im[i] ? im[i].name : i, days: pc[i] || 0, share: days.length ? (pc[i] || 0) / days.length : null }));
    return { closeHour: close, dayCount: days.length, proteins, days, rows };
  };

  /**
   * Simulated channel-sync latency from sync_done events. within = latencyMs <= target (settings.syncTargetSec, default 60 s).
   * @returns {{count,targetSec,medianMs,p90Ms,maxMs,withinCount,withinPct,byTarget:Array<{target,name,count,medianMs,maxMs}>,slowest:Array<{t,menuId,target,latencyMs}>}} stats null when count is 0
   */
  M.syncLatency = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const tgt = num(ctx.settings.syncTargetSec) ? ctx.settings.syncTargetSec : C.syncTargetSec;
    const ev = ctx.ev('sync_done').filter((e) => num(e.latencyMs) && e.latencyMs >= 0), st = stats(ev.map((e) => e.latencyMs));
    const within = ev.filter((e) => e.latencyMs <= tgt * 1000).length, by = byKey(ev, (e) => e.target);
    const ids = C.syncTargets.map((s) => s.id).filter((k) => by[k]).concat(Object.keys(by).filter((k) => !C.syncTargetById[k]).sort());
    return { count: st.n, targetSec: tgt, medianMs: st.median, p90Ms: st.p90, maxMs: st.max, withinCount: within, withinPct: st.n ? within / st.n : null,
      byTarget: ids.map((k) => { const s = stats(by[k].map((e) => e.latencyMs)); return { target: k, name: C.syncTargetById[k] ? C.syncTargetById[k].name : k, count: s.n, medianMs: s.median, maxMs: s.max }; }),
      slowest: ev.slice().sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 3).map((e) => ({ t: e.t, menuId: e.menuId, target: e.target, latencyMs: e.latencyMs })) };
  };

  /* ================= safety ================= */
  // Dollar words for a set of discards ({count, cost, noCostCount}): "cost not recorded" when none has a cost, and the
  // known part named as such when only some do, so an unknown cost never reads as $0.
  M.discardCostWords = (d, fmtMoney) => {
    const f = typeof fmtMoney === 'function' ? fmtMoney : (v) => U.fmtMoney(v, 0), n = d && num(d.noCostCount) ? d.noCostCount : 0;
    if (!d || !d.count) return f(0);
    if (n >= d.count) return 'cost not recorded';
    return f(d.cost) + (n ? ' for the ' + (d.count - n) + ' with a recorded cost' : '');
  };
  // Every discard in the range: batch_discard events, plus discarded batches that have no event. Nothing
  // missed, nothing counted twice.
  function discardList(ctx) {
    return ctx.memo('discards', () => {
      const seen = new Set(), out = [];
      for (const e of ctx.ev('batch_discard')) { if (!num(e.g) || e.g <= 0) continue; seen.add(e.batchId); out.push({ batchId: e.batchId, t: e.t, date: ctx.dateOf(e.t), ing: e.ing, g: e.g, reason: e.reason || 'other', cost: num(e.cost) ? e.cost : null }); }
      for (const b of arr(ctx.ds.batches)) {
        if (!b || seen.has(b.id) || !num(b.discardedAt) || b.discardedAt < ctx.o.from || b.discardedAt >= ctx.o.to || !num(b.wasteG) || b.wasteG <= 0) continue;
        out.push({ batchId: b.id, t: b.discardedAt, date: ctx.dateOf(b.discardedAt), ing: b.ing, g: b.wasteG, reason: b.discardReason || 'other', cost: num(b.costPerCookedKg) ? (b.wasteG / 1000) * b.costPerCookedKg : null });
      }
      return out.sort((a, b) => a.t - b.t);
    });
  }
  // Cooked intake in the range: batch_in events, plus batches with no event (same no-double-count rule as
  // discardList).
  function intakeList(ctx) {
    return ctx.memo('intake', () => {
      const seen = new Set(), out = [];
      for (const e of ctx.ev('batch_in')) if (num(e.cookedG)) { seen.add(e.batchId); out.push({ batchId: e.batchId, t: e.t, date: ctx.dateOf(e.t), ing: e.ing, g: e.cookedG }); }
      for (const b of arr(ctx.ds.batches)) if (b && b.kind !== 'cooling' && !seen.has(b.id) && num(b.enteredAt) && b.enteredAt >= ctx.o.from && b.enteredAt < ctx.o.to && num(b.cookedG)) out.push({ batchId: b.id, t: b.enteredAt, date: ctx.dateOf(b.enteredAt), ing: b.ing, g: b.cookedG });
      return out;
    });
  }
  // Totals discards by reason (count, grams, cost), most grams first.
  const reasonAgg = (list) => {
    const m = {}; for (const d of list) { const a = m[d.reason] || (m[d.reason] = { reason: d.reason, count: 0, g: 0, cost: 0 }); a.count++; a.g += d.g; if (d.cost !== null) a.cost += d.cost; }
    return Object.keys(m).map((k) => m[k]).sort((a, b) => b.g - a.g || (a.reason < b.reason ? -1 : 1));
  };

  // How late a temperature check or sanitize round may be and still count as on time in the reports: a few
  // minutes is how long a busy cook needs to get to it, not a missed check.
  M.CHECK_GRACE_MS = 5 * 60000;
  // True when a check flagged late was logged within the grace above, so it counts as on time.
  M.withinGrace = (e) => !!e && e.onTime === false && num(e.lateMs) && e.lateMs < M.CHECK_GRACE_MS;

  /**
   * Food-safety compliance from events (and batches for discards). onTimePct are fractions of events that say whether they were on time.
   * score = average of the available temperature-check and sanitise on-time shares (null when neither is known).
   * @returns {{tempChecks:{count,onTime,late,onTimePct,avgLateMs,maxLateMs},sanitize:{count,onTime,late,onTimePct,avgLateMs,maxLateMs},
   *   discards:{count,g,cost,noCostCount,byReason:Array<{reason,count,g,cost}>},lockouts:{batchCount:number,spellCount:number,totalMs:number,spells:Array},
   *   reheats:number,batchesIn:number,intakeG:number,wastePct:number|null,score:number|null}}
   */
  M.compliance = (ds, opts) => {
    const ctx = makeCtx(ds, opts);
    // Counts events flagged on time or late (no flag counts for nothing: unknown is not on time) and how
    // late the late ones were. A check logged less than CHECK_GRACE_MS after it was due counts as on time.
    const chk = (evs) => {
      let on = 0, late = 0; const lm = [];
      for (const e of evs) { if (e.onTime === true || M.withinGrace(e)) on++; else if (e.onTime === false) { late++; if (num(e.lateMs) && e.lateMs > 0) lm.push(e.lateMs); } }
      const n = on + late; return { count: n, onTime: on, late, onTimePct: n ? on / n : null, avgLateMs: lm.length ? mean(lm) : null, maxLateMs: lm.length ? Math.max.apply(null, lm) : null };
    };
    const tc = chk(ctx.ev('temp_logged')), sn = chk(ctx.ev('sanitize_done')), dl = discardList(ctx), il = intakeList(ctx);
    const spells = eightySixList(ctx).filter((s) => s.reason === 'safety');
    // Batches, not events: a lockout and the discard that follows it are two events for one batch.
    const bl = new Set(ctx.ev('batch_status').filter((e) => e.action === 'DISCARD_LOCKOUT' || e.to === 'discard').map((e, i) => (e.batchId != null ? e.batchId : '#' + i))).size;
    const dg = sumOf(dl.map((d) => d.g)), ig = sumOf(il.map((d) => d.g)); const parts = [tc.onTimePct, sn.onTimePct].filter(num);
    // WATCH OUT: cost adds only the discards with a known cost; noCostCount says how many had none, so 0 is not "free".
    return { tempChecks: tc, sanitize: sn, discards: { count: dl.length, g: dg, cost: sumOf(dl.map((d) => d.cost)), noCostCount: dl.filter((d) => d.cost === null).length, byReason: reasonAgg(dl) },
      lockouts: { batchCount: bl, spellCount: spells.length, totalMs: sumOf(spells.map((s) => s.durationMs)), spells },
      reheats: ctx.ev('batch_reheat').length, batchesIn: il.length, intakeG: ig, wastePct: ig > 0 ? dg / ig : null, score: parts.length ? mean(parts) : null };
  };

  /**
   * Waste per service day (days with tickets, discards or intake). cost sums the discards that have a known cost. wastePct = discarded g / cooked intake g.
   * @returns {Array<{date,label,weekday,count,g,cost,intakeG,wastePct:number|null,byReason:Array<{reason,count,g,cost}>}>} ascending by date
   */
  M.wasteByDay = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const dl = discardList(ctx), il = intakeList(ctx);
    const dates = new Set(ctx.dates()); for (const d of dl) dates.add(d.date); for (const d of il) dates.add(d.date);
    const bd = byKey(dl, (d) => d.date), bi = byKey(il, (d) => d.date);
    return Array.from(dates).sort().map((d) => {
      const list = bd[d] || [], ig = sumOf((bi[d] || []).map((x) => x.g)), g = sumOf(list.map((x) => x.g));
      return { date: d, label: U.fmtDateShort(d), weekday: U.weekday(d), count: list.length, g, cost: sumOf(list.map((x) => x.cost)), intakeG: ig, wastePct: ig > 0 ? g / ig : null, byReason: reasonAgg(list) };
    });
  };

  // Plain names for the discard reasons, in the order the ledger lists them. "manual" and "other" are
  // folded into one "Other" line. The cold-food limits (fridge date, time out of the fridge, date mark) keep their own
  // lines, since they are safety limits and not "other".
  const DISCARD_WORDS = { expired: 'Expired', quality: 'Quality', temp: 'Temperature', cooling: 'Cooling', fridgeDate: 'Past the fridge date', outTime: 'Out of the fridge too long', datemark: 'Past the date mark', other: 'Other' };
  const DISCARD_ORDER = ['expired', 'quality', 'temp', 'cooling', 'fridgeDate', 'outTime', 'datemark', 'other'];
  // Adds up one window of discards: total, by product and by reason. Dollars are grams x the batch's
  // recorded cost per cooked kg, so a discard with no recorded cost counts in grams but never as $0.
  function discardWindow(raw, from, to, label) {
    const w = makeCtx(raw, { from, to }), im = w.ingMap();
    const sampleIds = new Set(arr(raw.batches).filter((b) => b && b.src === 'sample').map((b) => b.id));
    const list = discardList(w), byIng = {}, byReason = {};
    const tot = { count: 0, g: 0, cost: 0, noCostCount: 0, sampleCount: 0 };
    // Adds one discard into a bucket's count, grams, dollars and no-cost count.
    const add = (b, d) => { b.count++; b.g += d.g; if (d.cost !== null) b.cost += d.cost; else b.noCostCount++; };
    for (const d of list) {
      const r = DISCARD_WORDS[d.reason] && d.reason !== 'other' ? d.reason : 'other';
      add(tot, d);
      if (sampleIds.has(d.batchId)) tot.sampleCount++;
      add(byIng[d.ing] || (byIng[d.ing] = { ing: d.ing, name: im[d.ing] ? im[d.ing].name : d.ing, count: 0, g: 0, cost: 0, noCostCount: 0 }), d);
      add(byReason[r] || (byReason[r] = { reason: r, label: DISCARD_WORDS[r], count: 0, g: 0, cost: 0, noCostCount: 0 }), d);
    }
    // Rounds a dollar amount to whole cents.
    const money = (x) => Math.round(x * 100) / 100;
    // Rounds a bucket's dollars to cents and its grams to whole grams.
    const fin = (o) => Object.assign(o, { cost: money(o.cost), g: Math.round(o.g) });
    return { label, from, to, total: fin(tot),
      byProduct: Object.keys(byIng).map((k) => fin(byIng[k])).sort((a, b) => b.cost - a.cost || b.g - a.g || (a.ing < b.ing ? -1 : 1)),
      byReason: DISCARD_ORDER.filter((k) => byReason[k]).map((k) => fin(byReason[k])) };
  }
  /**
   * "Dollars thrown away": this week against last week. A week is 7 service days ending with today, so
   * the windows follow the day-start hour; "last week" is the 7 days before that. Needs opts.now.
   * Dollars come only from discards with a recorded cost (noCostCount says how many had none).
   * @returns {{thisWeek, lastWeek}} each {label,from,to,total:{count,g,cost,noCostCount,sampleCount},byProduct:Array,byReason:Array}
   */
  M.discardWeeks = (ds, opts) => {
    const raw = unwrap(ds) || {}, ctx = makeCtx(raw, {}); opts = opts && typeof opts === 'object' ? opts : {};
    const now = num(opts.now) ? opts.now : ctx.nowMs();
    const today = U.serviceDate(now, ctx.dsh);
    // The moment a service day starts, n days from today (0 is today, 1 is tomorrow).
    const edge = (n) => dayStartMs(U.addDays(today, n), ctx.dsh);
    return { thisWeek: discardWindow(raw, edge(-6), edge(1), 'This week'), lastWeek: discardWindow(raw, edge(-13), edge(-6), 'Last week') };
  };

  /**
   * One plain sentence about the weekly discard ledger (the result of M.discardWeeks). Says dollars only
   * where a cost is recorded, names the biggest product and reason, and flags sample rows.
   * @returns {string}
   */
  M.discardSentence = (weeks) => {
    const tw = weeks && weeks.thisWeek, lw = weeks && weeks.lastWeek;
    if (!tw || !lw) return 'No discard figures yet.';
    const a = tw.total, b = lw.total;
    // Picks the singular or plural word for a count.
    const plural = (n, one, many) => (n === 1 ? one : many);
    if (!a.count && !b.count) return 'Nothing was thrown away this week or last week.';
    if (!a.count) return 'Nothing was thrown away this week. Last week ' + U.fmtMoney(b.cost) + ' of food went in the trash (' + (U.weightText || U.fmtG)(b.g) + ').';
    const parts = [];
    if (a.cost > 0) {
      let vs = '';
      if (b.count && b.cost > 0) {
        const diff = Math.round((a.cost - b.cost) * 100) / 100;
        vs = diff === 0 ? ', the same as last week' : ', ' + (diff > 0 ? 'up ' : 'down ') + U.fmtMoney(Math.abs(diff)) + ' from last week\'s ' + U.fmtMoney(b.cost);
      } else if (!b.count) vs = ', and nothing was thrown away last week';
      parts.push('You threw away ' + U.fmtMoney(a.cost) + ' of food this week (' + (U.weightText || U.fmtG)(a.g) + ')' + vs + '.');
    } else parts.push(a.count + ' ' + plural(a.count, 'batch was', 'batches were') + ' thrown away this week (' + (U.weightText || U.fmtG)(a.g) + '), but no cost is recorded for ' + plural(a.count, 'it', 'them') + ', so the dollars are not known.');
    const top = tw.byProduct.filter((r) => r.cost > 0)[0] || tw.byProduct[0], why = tw.byReason.slice().sort((x, y) => y.cost - x.cost || y.g - x.g)[0];
    if (top && why && a.cost > 0) parts.push('Most of it was ' + top.name.toLowerCase() + ' (' + U.fmtMoney(top.cost) + '), and the biggest reason was ' + why.label.toLowerCase() + '.');
    if (a.cost > 0 && a.noCostCount > 0) parts.push(a.noCostCount + ' ' + plural(a.noCostCount, 'discard has', 'discards have') + ' no recorded cost, so the real figure is higher.');
    if (a.sampleCount > 0) parts.push(a.sampleCount === a.count ? 'These figures come from sample data, not your kitchen.' : 'Some of these figures come from sample data.');
    return parts.join(' ');
  };

  // Maps a batch status to the colour name the timeline chart uses (chill is drawn as reheat).
  const TONE = { ok: 'ok', check: 'check', reheat: 'reheat', chill: 'reheat', discard: 'discard' };
  /**
   * Gantt rows for the hold-cabinet batches that entered on one service day (opts.day, default newest). Segments follow batch_status events
   * (green ok, amber check, orange reheat/chill, red discard); marks are temperature readings, reheats and the discard. open = batch still in the cabinet.
   * @returns {{day,label,openMs,closeMs,rows:Array<{batchId,label,ing,name,kind,src,cookedG,remainingG,startMs,endMs,open:boolean,status,wasteG,discardReason,reheats,
   *   segments:Array<{start,end,status,tone:'ok'|'check'|'reheat'|'discard',label}>,marks:Array<{at,label}>}>}}
   */
  M.batchTimeline = (ds, opts) => {
    ds = unwrap(ds); ds = ds && typeof ds === 'object' ? ds : {}; opts = opts && typeof opts === 'object' ? opts : {};
    const ctx = makeCtx(ds, { from: -Infinity, to: Infinity }); const im = ctx.ingMap(); const bs = arr(ds.batches).filter((b) => b && num(b.enteredAt));
    let day = typeof opts.day === 'string' ? opts.day : null;
    if (!day && bs.length) day = bs.map((b) => ctx.dateOf(b.enteredAt)).sort().pop();
    const res = { day: day || null, label: day ? U.fmtDateShort(day) : null, openMs: day ? hourMs(day, ctx.svc.openHour) : null, closeMs: day ? hourMs(day, ctx.svc.closeHour) : null, rows: [] };
    if (!day) return res;
    const lastUse = {}; for (const v of ctx.all) for (const it of v.items) if (it && it.status === 'done' && num(it.doneAt) && Array.isArray(it.depleted)) for (const d of it.depleted) if (d && d.batchId) lastUse[d.batchId] = Math.max(lastUse[d.batchId] || 0, it.doneAt);
    const st = byKey(arr(ds.events).filter((e) => e && !e.reverted && num(e.t) && (e.type === 'batch_status' || e.type === 'batch_reheat')), (e) => e.batchId);
    for (const b of bs.filter((x) => ctx.dateOf(x.enteredAt) === day).sort((a, b2) => a.enteredAt - b2.enteredAt)) {
      const evs = (st[b.id] || []).slice().sort((a, c) => a.t - c.t), sts = evs.filter((e) => e.type === 'batch_status' && e.t >= b.enteredAt);
      const lastEv = evs.length ? evs[evs.length - 1].t : b.enteredAt; let end, open = false;
      // A bar ends at the discard; or, if the batch is empty, at its last use; else it is still open and
      // ends at its newest sign of life.
      if (num(b.discardedAt)) end = b.discardedAt;
      else if (b.remainingG === 0) end = lastUse[b.id] || (num(b.lastTempAt) ? b.lastTempAt : b.enteredAt);
      else { open = true; end = Math.max(b.enteredAt, num(b.lastTempAt) ? b.lastTempAt : 0, lastEv); }
      end = Math.max(end, b.enteredAt);
      const segs = []; let cur = 'ok', cs = b.enteredAt;
      // Adds a segment from the current start to "to", clipped to the bar end; zero length adds nothing.
      const push = (to, status) => { if (to > cs) segs.push({ start: cs, end: Math.min(to, end), status, tone: TONE[status] || 'ok', label: status }); };
      for (const e of sts) { if (e.t > end) break; push(e.t, cur); cur = e.to; cs = Math.max(cs, e.t); }
      push(end, cur);
      const marks = arr(b.temps).filter((x) => x && num(x.t) && num(x.f)).map((x) => ({ at: x.t, label: Math.round(x.f) + 'F' }));
      for (const e of evs) if (e.type === 'batch_reheat') marks.push({ at: e.t, label: 'Reheat' + (num(e.f) ? ' to ' + Math.round(e.f) + 'F' : '') });
      if (num(b.discardedAt)) marks.push({ at: b.discardedAt, label: 'Thrown out' + (b.discardReason ? ' (' + b.discardReason + ')' : '') });
      marks.sort((a, c) => a.at - c.at);
      res.rows.push({ batchId: b.id, label: b.label || b.id, ing: b.ing, name: im[b.ing] ? im[b.ing].name : b.ing, kind: b.kind || null, src: b.src || null, cookedG: num(b.cookedG) ? b.cookedG : null,
        remainingG: num(b.remainingG) ? b.remainingG : null, startMs: b.enteredAt, endMs: end, open, status: b.status || null, wasteG: num(b.wasteG) ? b.wasteG : null,
        discardReason: b.discardReason || null, reheats: num(b.reheats) ? b.reheats : 0, segments: segs, marks });
    }
    return res;
  };

  /* ================= money ================= */
  // Sales and food-cost totals over done lines. costPct = cost / revenue of lines with both; coverage =
  // costed / priced lines.
  function moneyTotals(ctx) {
    return ctx.memo('moneyTotals', () => {
      let revenue = 0, priced = 0, cost = 0, costedRev = 0, costed = 0;
      for (const l of moneyLines(ctx)) { const rv = l.rev, c = l.cost; if (rv !== null) { revenue += rv; priced++; if (c !== null) { cost += c; costedRev += rv; costed++; } } }
      return { revenue: priced ? revenue : null, priced, cost: costed ? cost : null, costedRev, costed, costPct: costedRev > 0 ? cost / costedRev : null, coverage: priced ? costed / priced : null };
    });
  }
  /**
   * Sales by service hour of ticket createdAt, from done lines (price x qty). Contiguous hours; hours with no sales have revenue 0 (a real zero).
   * @returns {Array<{hour,x,y:number,label,span,revenue,tickets,items,avgTicket:number|null}>} y = revenue
   */
  M.revenueByHour = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const g = {}; let lo = Infinity, hi = -Infinity;
    for (const l of moneyLines(ctx)) {
      const v = l.v, rv = l.rev; if (rv === null) continue;
      const a = g[v.hour] || (g[v.hour] = { revenue: 0, items: 0, ids: new Set() }); a.revenue += rv; a.items += l.qty; a.ids.add(v.id);
      if (v.hour < lo) lo = v.hour; if (v.hour > hi) hi = v.hour;
    }
    const out = [];
    for (let h = lo; h <= hi; h++) { const a = g[h]; out.push({ hour: h, x: h, y: a ? a.revenue : 0, label: U.fmtHour(h), span: hourSpan(h), revenue: a ? a.revenue : 0, tickets: a ? a.ids.size : 0, items: a ? a.items : 0, avgTicket: a && a.ids.size ? a.revenue / a.ids.size : null }); }
    return out;
  };

  /**
   * Average value of finished tickets (price x qty of their done lines).
   * @returns {{count,total,avg,median,p90,min,max,byChannel:Array<{channel,name,count,total,avg}>}} stats null when count is 0
   */
  M.avgTicketValue = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const tv = ticketValues(ctx), st = stats(tv.map((x) => x.value)), by = byKey(tv, (x) => x.v.channel);
    const ids = C.channels.map((c) => c.id).filter((k) => by[k]).concat(Object.keys(by).filter((k) => !C.channelById[k]).sort());
    return { count: st.n, total: st.n ? st.sum : null, avg: st.avg, median: st.median, p90: st.p90, min: st.min, max: st.max,
      byChannel: ids.map((k) => { const s = stats(by[k].map((x) => x.value)); return { channel: k, name: chanName(k), count: s.n, total: s.sum, avg: s.avg }; }) };
  };

  /**
   * Food cost as a share of menu price (cost / price x qty) over done lines that have a recorded cost.
   * @returns {{costPct:number|null,cost:number|null,revenue:number|null,lines:number,coverage:number|null,
   *   byDay:Array<{date,label,costPct,cost,revenue}>,byCat:Array<{cat,name,costPct,cost,revenue}>}} revenue = revenue of the costed lines
   */
  M.foodCostPct = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const t = moneyTotals(ctx), mm = ctx.menuMap(); const day = {}, cat = {};
    for (const l of moneyLines(ctx)) {
      const it = l.it, v = l.v, rv = l.rev, c = l.cost; if (rv === null || c === null) continue;
      const m = mm[it.menuId] || {}, ck = m.cat || 'other';
      const d = day[v.date] || (day[v.date] = { cost: 0, revenue: 0 }); d.cost += c; d.revenue += rv;
      const k = cat[ck] || (cat[ck] = { cost: 0, revenue: 0 }); k.cost += c; k.revenue += rv;
    }
    const cn = {}; for (const c of C.categories) cn[c.id] = c.name;
    return { costPct: t.costPct, cost: t.cost, revenue: t.costed ? t.costedRev : null, lines: t.costed, coverage: t.coverage,
      byDay: Object.keys(day).sort().map((d) => ({ date: d, label: U.fmtDateShort(d), costPct: day[d].revenue > 0 ? day[d].cost / day[d].revenue : null, cost: day[d].cost, revenue: day[d].revenue })),
      byCat: Object.keys(cat).sort().map((k) => ({ cat: k, name: cn[k] || k, costPct: cat[k].revenue > 0 ? cat[k].cost / cat[k].revenue : null, cost: cat[k].cost, revenue: cat[k].revenue })) };
  };

  /**
   * Margin per item (items with a recorded cost only), best margin in dollars first. marginPerUnit = margin / costed units.
   * @returns {Array<{menuId,name,sold,costedQty,revenue,cost,margin,marginPct,marginPerUnit,costPct}>}
   */
  M.marginByItem = (ds, opts) => byItemRows(makeCtx(ds, opts)).filter((r) => r.margin !== null).map((r) => ({ menuId: r.menuId, name: r.name, sold: r.sold, costedQty: r.costedQty,
    revenue: r.revenue, cost: r.cost, margin: r.margin, marginPct: r.marginPct, marginPerUnit: r.costedQty > 0 ? r.margin / r.costedQty : null, costPct: r.costPct })).sort((a, b) => b.margin - a.margin || (a.name < b.name ? -1 : 1));

  // Paid orders whose payment falls inside the range (a channel filter keeps only that channel), each with the service
  // day and hour it was paid and its frozen amounts in dollars. Orders without frozen totals are skipped, never guessed.
  function paidOrders(ctx) {
    return ctx.memo('paidOrders', () => {
      const out = [];
      for (const o of arr(ctx.ds.orders)) {
        if (!o || o.status !== 'paid' || !num(o.paidAt) || !o.totals || typeof o.totals !== 'object') continue;
        if (o.paidAt < ctx.o.from || o.paidAt >= ctx.o.to) continue;
        if (ctx.o.channel && o.channel !== ctx.o.channel) continue;
        const tt = o.totals, si = slotInfo(o.paidAt, ctx.dsh);
        const sub = num(tt.subtotal) ? tt.subtotal : 0, disc = num(tt.discount) ? tt.discount : 0, tax = num(tt.tax) ? tt.tax : 0, tip = num(o.tip) && o.tip > 0 ? o.tip : 0;
        out.push({ o, date: si.date, hour: Math.floor(wallHours(o.paidAt, si)), channel: o.channel, method: o.method, gross: sub, discount: disc, net: sub - disc, tax, tip, total: sub - disc + tax });
      }
      out.sort((a, b) => a.o.paidAt - b.o.paidAt);
      return out;
    });
  }
  // Adds up a list of paid-order rows into checks, net sales, tax, tips and what was collected in all.
  function addUp(rows) {
    // Money is added in whole cents and turned back into dollars at the end, so long lists never pick up a stray cent.
    const c = (v) => Math.round(v * 100);
    const k = { gross: 0, discounts: 0, net: 0, tax: 0, tips: 0, total: 0 };
    for (const r of rows) { k.gross += c(r.gross); k.discounts += c(r.discount); k.net += c(r.gross) - c(r.discount); k.tax += c(r.tax); k.tips += c(r.tip); k.total += c(r.gross) - c(r.discount) + c(r.tax); }
    return { checks: rows.length, gross: k.gross / 100, discounts: k.discounts / 100, net: k.net / 100, tax: k.tax / 100, tips: k.tips / 100, total: k.total / 100, collected: (k.total + k.tips) / 100 };
  }

  /**
   * What the till took, from orders that were paid in the range (not from menu prices of finished food).
   * net = food sold less discounts; tax and tips sit on top of it; collected = net + tax + tips. Open orders are
   * counted and valued separately, and a voided order is only counted.
   * @returns {{checks,gross,discounts,net,tax,tips,total,collected,avgCheck:number|null,tipPct:number|null,
   *   byMethod:Array<{method,name,checks,collected,tips}>,byDay:Array<{date,label,checks,net,tax,tips,collected}>,
   *   byHour:Array<{hour,label,span,checks,net}>,byChannel:Array<{channel,name,checks,net,avg}>,
   *   open:{orders:number,value:number},voided:number}}
   */
  M.sales = (ds, opts) => {
    const ctx = makeCtx(ds, opts), rows = paidOrders(ctx), tot = addUp(rows);
    const byMethodMap = byKey(rows, (r) => r.method || 'other');
    const methodIds = (C.payMethods || []).map((m) => m.id).filter((k) => byMethodMap[k]).concat(Object.keys(byMethodMap).filter((k) => !(C.payMethodById || {})[k]).sort());
    const byMethod = methodIds.map((k) => { const a = addUp(byMethodMap[k]); return { method: k, name: C.payMethodById && C.payMethodById[k] ? C.payMethodById[k].name : k, checks: a.checks, collected: a.collected, tips: a.tips }; });
    const dayMap = byKey(rows, (r) => r.date);
    const byDay = Object.keys(dayMap).sort().map((d) => { const a = addUp(dayMap[d]); return { date: d, label: U.fmtDateShort(d), checks: a.checks, net: a.net, tax: a.tax, tips: a.tips, collected: a.collected }; });
    const hourMap = byKey(rows, (r) => r.hour), hrs = Object.keys(hourMap).map(Number);
    const byHour = [];
    if (hrs.length) for (let h = Math.min.apply(null, hrs); h <= Math.max.apply(null, hrs); h++) { const a = addUp(hourMap[h] || []); byHour.push({ hour: h, label: U.fmtHour(h), span: hourSpan(h), checks: a.checks, net: a.net }); }
    const chMap = byKey(rows, (r) => r.channel);
    const chIds = C.channels.map((c) => c.id).filter((k) => chMap[k]).concat(Object.keys(chMap).filter((k) => !C.channelById[k]).sort());
    const byChannel = chIds.map((k) => { const a = addUp(chMap[k]); return { channel: k, name: chanName(k), checks: a.checks, net: a.net, avg: a.checks ? a.net / a.checks : null }; });
    // Orders still open or voided, among those started in the range.
    const openIds = new Set();
    let voided = 0;
    for (const o of arr(ctx.ds.orders)) {
      if (!o || !num(o.createdAt) || o.createdAt < ctx.o.from || o.createdAt >= ctx.o.to) continue;
      if (ctx.o.channel && o.channel !== ctx.o.channel) continue;
      if (o.status === 'open') openIds.add(o.id); else if (o.status === 'voided') voided++;
    }
    let openValue = 0;
    if (openIds.size) for (const t of arr(ctx.ds.tickets)) if (t && openIds.has(t.orderId) && t.status !== 'voided') for (const it of arr(t.items)) if (it && num(it.price)) openValue += it.price * lineQty(it);
    return Object.assign(tot, { avgCheck: tot.checks ? tot.net / tot.checks : null, tipPct: tot.net > 0 ? tot.tips / tot.net : null, byMethod, byDay, byHour, byChannel, open: { orders: openIds.size, value: openValue }, voided });
  };

  /**
   * Texas A&M brisket yield regression, same maths as SPEC 7.7 (local copy, no engine dependency).
   * hot% = 72.9 - 0.85 x (T - 75) - 2.1 x holdH with T clamped to [75, 90] C and holdH to [0, 3]; chilled%
   * = max(45, hot% - 2.1).
   * Missing endpointC/holdH use the config defaults (85 C, 2 h). hotPct/chilledPct are 0..100 (as the
   * SPEC), unlike every other percent here (F-M7).
   * Example: 85 C and a 2 h hold give 72.9 - 0.85 x 10 - 2.1 x 2 = 60.2 hot and 58.1 chilled; 10 kg raw
   * then cooks down to 6020 g.
   * @returns {{hotPct:number,chilledPct:number,endpointC:number,holdH:number,cookedG:number|null,trueCostPerCookedKg:number|null}}
   */
  M.thermal = (o) => {
    o = o || {}; const Y = C.yieldModel;
    const T = U.clamp(num(o.endpointC) ? o.endpointC : Y.defaultTempC, Y.tempC[0], Y.tempC[1]), h = U.clamp(num(o.holdH) ? o.holdH : Y.defaultHoldH, Y.holdH[0], Y.holdH[1]);
    const hot = Y.base - Y.perDegC * (T - Y.tempC[0]) - Y.perHoldH * h, chilled = Math.max(Y.chilledFloor, hot - Y.chilledDelta);
    return { hotPct: hot, chilledPct: chilled, endpointC: T, holdH: h, cookedG: num(o.rawG) ? (o.rawG * hot) / 100 : null, trueCostPerCookedKg: num(o.costPerKgRaw) && hot > 0 ? o.costPerKgRaw / (hot / 100) : null };
  };

  /**
   * Static yield assumption vs the thermal model vs what batches really produced, per ingredient that is
   * thermal or has batches with rawG
   * (batches entered in the range; endpointC/holdH are read from the batch when present, else the model
   * defaults). Yields are FRACTIONS (0.55).
   * realisedYield = sum cookedG / sum rawG; modelYield is the raw-weighted average of each batch's model
   * yield; staticYield is the one assumed number.
   * staticCostErr = static cost per cooked kg / true cost - 1 (true = realised, else model): positive means
   * the static yield would have overstated the cost.
   * Example: static 55 percent against a model of 60.2 percent gives 0.0945, so the static number misprices
   * brisket by 9.5 percent.
   * @param {object} opts {staticYield?: fraction override for every ingredient, ing?: only this ingredient}
   * @returns {{rows:Array<{ing,name,thermal,batches,rawG,cookedG,staticYield,modelYield,realisedYield,staticCookedG,modelCookedG,costPerKgRaw,staticCostPerCookedKg,
   *   modelCostPerCookedKg,realisedCostPerCookedKg,trueCostPerCookedKg,truthSource:'realised'|'model'|'static'|null,staticCostErr,line:string|null,
   *   perBatch:Array<{batchId,label,enteredAt,rawG,cookedG,staticYield,modelYield,realisedYield}>}>,primary:object|null}} primary = first thermal row
   */
  M.yieldComparison = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const im = ctx.ingMap(), o = ctx.o.opts; const bs = byKey(arr(ctx.ds.batches).filter((b) => b && b.ing && num(b.enteredAt) && b.enteredAt >= ctx.o.from && b.enteredAt < ctx.o.to), (b) => b.ing);
    const rows = [];
    for (const id of Object.keys(im)) {
      const ing = im[id]; if (o.ing && o.ing !== id) continue;
      const withRaw = (bs[id] || []).filter((b) => num(b.rawG) && b.rawG > 0 && num(b.cookedG));
      if (!ing.thermal && !withRaw.length) continue;
      const sy = num(o.staticYield) ? o.staticYield : num(ing.yield) ? ing.yield : null; const th = !!ing.thermal;
      let raw = 0, cooked = 0, mod = 0; const per = [];
      for (const b of withRaw) {
        const my = th ? M.thermal({ endpointC: b.endpointC, holdH: b.holdH }).hotPct / 100 : null;
        raw += b.rawG; cooked += b.cookedG; if (my !== null) mod += b.rawG * my;
        per.push({ batchId: b.id, label: b.label || b.id, enteredAt: b.enteredAt, rawG: b.rawG, cookedG: b.cookedG, staticYield: sy, modelYield: my, realisedYield: b.cookedG / b.rawG });
      }
      const modelYield = th ? (raw > 0 ? mod / raw : M.thermal({}).hotPct / 100) : null, realised = raw > 0 ? cooked / raw : null;
      // Cost per cooked kg at a given yield (raw cost per kg / yield); null when unknown.
      const cpk = num(ing.costPerKg) ? ing.costPerKg : null, cost = (y) => (cpk !== null && num(y) && y > 0 ? cpk / y : null);
      const sc = cost(sy), mc = cost(modelYield), rc = cost(realised);
      const truth = rc !== null ? rc : mc !== null ? mc : null, src = rc !== null ? 'realised' : mc !== null ? 'model' : null;
      const err = sc !== null && truth !== null && truth > 0 ? sc / truth - 1 : null;
      const ty = realised !== null ? realised : modelYield;
      const line = err !== null ? 'If you had priced ' + ing.name.toLowerCase() + ' with the static ' + Math.round(sy * 100) + '% yield you would have been off by ' + (Math.abs(err) * 100).toFixed(1) + '% (' + money(sc) + ' per cooked kg instead of ' + money(truth) + ', ' + (err > 0 ? 'overstating' : 'understating') + ' the cost).' : null;
      rows.push({ ing: id, name: ing.name, thermal: th, batches: withRaw.length, rawG: raw, cookedG: cooked, staticYield: sy, modelYield, realisedYield: realised,
        staticCookedG: sy !== null ? raw * sy : null, modelCookedG: modelYield !== null && raw > 0 ? raw * modelYield : null, costPerKgRaw: cpk,
        staticCostPerCookedKg: sc, modelCostPerCookedKg: mc, realisedCostPerCookedKg: rc, trueCostPerCookedKg: truth, truthSource: src, trueYield: ty === undefined ? null : ty, staticCostErr: err, line, perBatch: per });
    }
    rows.sort((a, b) => (b.thermal - a.thermal) || (a.name < b.name ? -1 : 1));
    return { rows, primary: rows.find((r) => r.thermal) || null };
  };

  /* ================= line friction (UI-guide instrumentation) ================= */
  // Plain words for each refusal id the engine can report; used only when the engine's own table is not
  // loaded.
  const REPORT_WORDS = { itemUnavailable: 'Item is sold out or on hold', notAllDone: 'Bumped before every item was done', emptyOrder: 'Order had no items', badQty: 'Quantity out of range',
    reasonRequired: 'Void without a reason', alreadyDone: 'Item was already done', alreadyFired: 'Item was already fired', undoExpired: 'Undo pressed after the window', undoConflict: 'Undo no longer possible',
    tempTooLow: 'Reheat temperature too low', notReheatable: 'Batch could not be reheated', badTemp: 'Temperature out of range', badCustomer: 'Customer name missing or too long' };
  // Message for a refusal id: the engine's wording, else the table above, else the id spaced into words.
  function reportWords(id) {
    const e = SB.engine && SB.engine.REPORTS && SB.engine.REPORTS[id]; if (typeof e === 'string') return e;
    return REPORT_WORDS[id] || String(id).replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  }
  /**
   * How hard the interface is to use. Undo rate = undo events / undoable actions logged (item_done, ticket_expedited, ticket_voided, batch_discard,
   * sanitize_done, counting actions that were later undone). Forced/override/recall/void counts come from tickets created in the range.
   * @returns {{tickets,undo:{count,actions,rate:number|null,per100Tickets:number|null},
   *   reports:{count,per100Tickets:number|null,top:Array<{report,message,count,share,topAction:string|null,actions:Array<{action,count}>}>},
   *   forced:{count,pct:number|null},overrides:{count,pct:number|null},recalls:{count,pct:number|null},
   *   voids:{count,pct:number|null,byReason:Array<{reason,count}>}}}  pct are fractions of finished tickets / lines / tickets created
   */
  M.frictionSummary = (ds, opts) => {
    const ctx = makeCtx(ds, opts); const s = summaryOf(ctx); const n = ctx.vol.length;
    // The undo-rate denominator counts every undoable action, including ones later undone (F-M12).
    let actions = 0; for (const t of ['item_done', 'ticket_expedited', 'ticket_voided', 'batch_discard', 'sanitize_done']) actions += ctx.evCount(t);
    const undo = ctx.ev('undo').length, rep = ctx.ev('ui_report'), by = byKey(rep, (e) => e.report || 'unknown');
    const top = Object.keys(by).map((k) => { const ac = byKey(by[k], (e) => e.action || 'unknown'); const al = Object.keys(ac).map((a) => ({ action: a, count: ac[a].length })).sort((a, b) => b.count - a.count || (a.action < b.action ? -1 : 1));
      return { report: k, message: reportWords(k), count: by[k].length, share: rep.length ? by[k].length / rep.length : null, topAction: al.length ? al[0].action : null, actions: al }; }).sort((a, b) => b.count - a.count || (a.report < b.report ? -1 : 1));
    const vr = byKey(ctx.voided, (v) => (v.t.voidReason || 'no reason given'));
    // Share a / b, or null when b is 0.
    const pc = (a, b) => (b > 0 ? a / b : null);
    return { tickets: n, undo: { count: undo, actions, rate: pc(undo, actions), per100Tickets: n ? (undo / n) * 100 : null },
      reports: { count: rep.length, per100Tickets: n ? (rep.length / n) * 100 : null, top },
      forced: { count: s.forced, pct: pc(s.forced, s.count) }, overrides: { count: s.overrides, pct: pc(s.overrides, ctx.lines(false).length) },
      recalls: { count: s.recalls, pct: pc(s.recalls, ctx.live.length) },
      voids: { count: s.voids, pct: pc(s.voids, ctx.all.length), byReason: Object.keys(vr).map((k) => ({ reason: k, count: vr[k].length })).sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1)) } };
  };

  /* ================= compare with the previous equal period, and range presets ================= */
  // The 12 headline tiles: id, label, kind (time, share, count, money) and which direction is good.
  const KPIS = [
    { id: 'medianMs', label: 'Median ticket time', kind: 'time', good: 'lower' }, { id: 'p90Ms', label: 'Slowest 1 in 10', kind: 'time', good: 'lower' },
    { id: 'onTimePct', label: 'On time', kind: 'share', good: 'higher' }, { id: 'perHour', label: 'Tickets per hour', kind: 'count', good: 'neutral' },
    { id: 'avgSpreadMs', label: 'First to last dish', kind: 'time', good: 'lower' }, { id: 'avgLampMs', label: 'Finished food waiting', kind: 'time', good: 'lower' },
    { id: 'count', label: 'Finished tickets', kind: 'count', good: 'neutral' }, { id: 'overdue', label: 'Overdue tickets', kind: 'count', good: 'lower' },
    { id: 'voids', label: 'Voids', kind: 'count', good: 'lower' }, { id: 'revenue', label: 'Sales', kind: 'money', good: 'higher' },
    { id: 'avgTicketValue', label: 'Average ticket', kind: 'money', good: 'higher' }, { id: 'foodCostPct', label: 'Food cost', kind: 'share', good: 'lower' },
  ];
  // KPI values for one date range, from the summary and money totals; null where unknown. _has = any ticket
  // existed.
  function snapshot(ds, o) {
    const ctx = makeCtx(ds, o); const s = summaryOf(ctx), m = moneyTotals(ctx), tv = ticketValues(ctx);
    return { medianMs: s.median, p90Ms: s.p90, onTimePct: s.onTimePct, perHour: s.perHour, avgSpreadMs: s.avgSpread, avgLampMs: s.avgLamp, count: s.count, overdue: s.count ? s.overdue : null,
      voids: s.created + s.voids ? s.voids : null, revenue: m.revenue, avgTicketValue: tv.length ? sumOf(tv.map((x) => x.value)) / tv.length : null, foodCostPct: m.costPct, _has: s.created + s.voids > 0 };
  }
  /**
   * KPI tiles with deltas against the previous period of equal length (from - len .. from). Needs a finite range (opts or dataset.range, else the
   * data's own span). Note: "Today" compared to "Yesterday" compares a possibly partial day with a full one; counts differ, medians stay fair.
   * dir = 'up'|'down'|'flat'|null (null = nothing to compare), better = 'good'|'bad'|'flat'|'neutral'|null, word = faster/slower/higher/lower/about the same.
   * flat = under 2% change (under 0.5 percentage points for shares).
   * @returns {{range:{from,to},prevRange:{from,to}|null,hasPrevious:boolean,list:Kpi[],kpis:Object<string,Kpi>,spark:Object<string,number[]>}}
   *   Kpi = {id,label,kind:'time'|'share'|'count'|'money',current,previous,delta,deltaPct,dir,better,word,text}; spark = per-day values (no nulls) for the current range
   */
  M.compare = (ds, opts) => {
    const base = makeCtx(ds, opts); let from = base.o.from, to = base.o.to;
    if (!isFinite(from) || !isFinite(to)) {
      let lo = Infinity, hi = -Infinity; for (const v of base.all) { if (v.createdAt < lo) lo = v.createdAt; if (v.createdAt > hi) hi = v.createdAt; }
      if (!isFinite(from)) from = lo; if (!isFinite(to)) to = hi + 1;
    }
    const empty = { range: { from: isFinite(from) ? from : null, to: isFinite(to) ? to : null }, prevRange: null, hasPrevious: false, list: [], kpis: {}, spark: {} };
    const raw = unwrap(ds), o2 = Object.assign({}, base.o.opts, opts && typeof opts === 'object' ? opts : {});
    if (!isFinite(from) || !isFinite(to) || to <= from) { return fillKpis(empty, snapshot(raw, Object.assign({}, o2, { from, to })), null, []); }
    const len = to - from; const prev = { from: from - len, to: from };
    const cur = snapshot(raw, Object.assign({}, o2, { from, to })), pre = snapshot(raw, Object.assign({}, o2, prev));
    const days = M.byDay(raw, Object.assign({}, o2, { from, to }));
    const res = fillKpis({ range: { from, to }, prevRange: prev, hasPrevious: pre._has, list: [], kpis: {}, spark: {} }, cur, pre._has ? pre : null, days);
    return res;
  };
  // Fills the tiles with current vs previous: change, direction, good or bad, and a plain sentence (F-M14).
  function fillKpis(res, cur, pre, days) {
    for (const k of KPIS) {
      const c = num(cur[k.id]) ? cur[k.id] : null, p = pre && num(pre[k.id]) ? pre[k.id] : null;
      const delta = c !== null && p !== null ? c - p : null, dp = delta !== null && p > 0 ? delta / p : null;
      const flat = delta !== null && (k.kind === 'share' ? Math.abs(delta) < 0.005 : delta === 0 || (dp !== null && Math.abs(dp) < 0.02));
      const dir = delta === null ? null : flat ? 'flat' : delta > 0 ? 'up' : 'down';
      const better = dir === null ? null : dir === 'flat' ? 'flat' : k.good === 'neutral' ? 'neutral' : ((dir === 'up') === (k.good === 'higher') ? 'good' : 'bad');
      const word = dir === null ? 'no comparison' : dir === 'flat' ? 'about the same' : k.kind === 'time' ? (dir === 'up' ? 'slower' : 'faster') : dir === 'up' ? 'higher' : 'lower';
      const text = dir === null ? 'No earlier period to compare' : dir === 'flat' ? 'About the same as the previous period'
        : (k.kind === 'share' ? (Math.abs(delta) * 100).toFixed(1) + ' points ' : dp !== null ? Math.round(Math.abs(dp) * 100) + '% ' : '') + word + ' than the previous period';
      const kpi = { id: k.id, label: k.label, kind: k.kind, current: c, previous: p, delta, deltaPct: dp, dir, better, word, text };
      res.kpis[k.id] = kpi; res.list.push(kpi);
    }
    const sp = { medianMs: 'medianMs', p90Ms: 'p90Ms', onTimePct: 'onTimePct', perHour: 'perHour', avgSpreadMs: 'avgSpreadMs', avgLampMs: 'avgLampMs', count: 'count', overdue: 'overdue', voids: 'voids', revenue: 'revenue', avgTicketValue: 'avgTicketValue', foodCostPct: 'foodCostPct' };
    for (const k in sp) res.spark[k] = days.map((d) => (k === 'voids' ? d.voids : d[sp[k]])).filter(num);
    return res;
  }

  /**
   * Quick ranges in service-day terms (a service day starts at dayStartHour, default 4 am). The "to" value
   * is exclusive: the start of the next service day.
   * "Last N days" are the N service days ending with today (today included).
   * Example: at 12:45 am on Saturday, "Today" is still Friday night's service day (fromKey and toKey are
   * both Friday).
   * WATCH OUT: when nowMs is missing it falls back to the real clock (Date.now), the only place in this
   *   file that reads it.
   * @returns {Array<{id:'today'|'yesterday'|'last7'|'last14',label,from:number,to:number,fromKey,toKey,days:number}>} toKey = last service date inside the range
   */
  M.rangePresets = (nowMs, dayStartHour) => {
    const dsh = num(dayStartHour) ? dayStartHour : C.service.dayStartHour; const now = num(nowMs) ? nowMs : Date.now(); const today = U.serviceDate(now, dsh);
    // One preset: from the start of service day a to the start of the day after day b (exclusive).
    const mk = (id, label, a, b) => ({ id, label, from: dayStartMs(U.addDays(today, a), dsh), to: dayStartMs(U.addDays(today, b + 1), dsh), fromKey: U.addDays(today, a), toKey: U.addDays(today, b), days: b - a + 1 });
    return [mk('today', 'Today', 0, 0), mk('yesterday', 'Yesterday', -1, -1), mk('last7', 'Last 7 days', -6, 0), mk('last14', 'Last 14 days', -13, 0)];
  };

  /* ================= insights: a deterministic rule engine of 21 plain-English rules ================= */
  // One insight finding in the standard shape; importance decides the order (higher first).
  const F = (id, tone, importance, title, body, metric) => ({ id, tone, title, body, metric: metric || null, importance });
  // The 21 insight rules in evaluation order. Each run(c) returns a finding, or null (silent) when there is
  // too little data. Limits: docs/metrics.md section 3.
  const RULES = [
    // pace-overview: share of finished tickets on time. Needs 20 tickets; tone by 90 / 75 / 60 percent.
    { id: 'pace-overview', run(c) {
      const s = summaryOf(c); if (s.count < 20) return null; const p = s.onTimePct;
      const tone = p >= 0.9 ? 'good' : p >= 0.75 ? 'info' : p >= 0.6 ? 'warn' : 'bad';
      return F(this.id, tone, { good: 30, info: 35, warn: 65, bad: 85 }[tone], pctTxt(p) + ' of tickets were out on time',
        'Median ticket time was ' + mmss(s.median) + ' and 1 in 10 took longer than ' + mmss(s.p90) + '. ' + s.overdue + ' of ' + s.count + ' tickets went past their overdue time.', { label: 'On time', value: p, unit: 'share' });
    } },
    // slow-hour: the hour with the highest median, if 25 percent and 60 s over overall. Needs 40 tickets,
    // 15 in the hour.
    { id: 'slow-hour', run(c) {
      const s = summaryOf(c); if (s.count < 40) return null; const hrs = byHourRows(c).filter((h) => h.count >= 15); if (hrs.length < 2) return null;
      const w = hrs.reduce((a, b) => (b.medianMs > a.medianMs ? b : a));
      if (w.medianMs < 1.25 * s.median || w.medianMs - s.median < 60000) return null;
      return F(this.id, w.onTimePct !== null && w.onTimePct < 0.6 ? 'bad' : 'warn', 60, w.span + ' is your slowest hour',
        'Median ticket time was ' + mmss(w.medianMs) + ' between ' + hourBetween(w.hour) + ', against ' + mmss(s.median) + ' across the whole range (' + w.count + ' tickets that hour, ' + pctTxt(w.onTimePct) + ' on time).', { label: 'Median in the slowest hour', value: w.medianMs, unit: 'ms' });
    } },
    // channel-gap: in one hour the slowest and fastest channel (5+ tickets each) differ by 90 s or more.
    { id: 'channel-gap', run(c) {
      const hc = {}; for (const r of c.spd) { const h = hc[r.hour] || (hc[r.hour] = {}); (h[r.channel] || (h[r.channel] = [])).push(r.totalMs); }
      let best = null;
      for (const h of Object.keys(hc).map(Number).sort((a, b) => a - b)) {
        const ch = Object.keys(hc[h]).filter((k) => hc[h][k].length >= 5).sort().map((k) => ({ k, n: hc[h][k].length, m: median(hc[h][k]) }));
        if (ch.length < 2) continue;
        const slow = ch.reduce((a, b) => (b.m > a.m ? b : a)), fast = ch.reduce((a, b) => (b.m < a.m ? b : a)), gap = slow.m - fast.m;
        if (gap >= 90000 && (!best || gap > best.gap)) best = { h, slow, fast, gap };
      }
      if (!best) return null;
      return F(this.id, 'warn', 55 + Math.min(20, (best.gap / 60000) * 5), chanName(best.slow.k) + ' ran ' + mmss(best.gap) + ' slower than ' + chanName(best.fast.k).toLowerCase(),
        chanName(best.slow.k) + ' ran ' + mmss(best.gap) + ' slower than ' + chanName(best.fast.k).toLowerCase() + ' between ' + hourBetween(best.h) + ': median ' + mmss(best.slow.m) + ' against ' + mmss(best.fast.m) + ' (' + best.slow.n + ' and ' + best.fast.n + ' tickets).',
        { label: 'Channel gap', value: best.gap, unit: 'ms' });
    } },
    // calibration-drift: the item furthest from its starter time. Needs 8 samples; slow warns, fast is
    // info.
    { id: 'calibration-drift', run(c) {
      const fl = M.calibration(c).filter((r) => r.flag && r.n >= 8); if (!fl.length) return null; const r = fl[0], others = fl.length - 1;
      const planned = r.learnedSec !== null && Math.abs(r.learnedSec - r.observedSec) / r.observedSec <= 0.15 && c.pacingCfg.enabled !== false;
      const tail = others > 0 ? ' ' + others + ' other ' + U.plural(others, 'item') + ' also drift.' : '';
      if (r.drift === 'slow') return F(this.id, r.ratio >= 1.6 ? 'bad' : 'warn', 58 + Math.min(20, (r.ratio - 1) * 20), r.name + ' takes ' + mmss(r.observedSec * 1000) + ' on your line',
        'That is ' + mmss(r.deltaSec * 1000) + ' over the starter estimate of ' + mmss(r.starterSec * 1000) + ' (' + r.n + ' samples). ' + (planned ? 'Finish together now plans for it.' : r.learnedSec !== null ? 'Pacing plans for ' + mmss(r.learnedSec * 1000) + ' so far; confirm the new time in Menu, prices and shop.' : 'Confirm the new time in Menu, prices and shop.') + tail, { label: 'Observed over starter', value: r.ratio, unit: 'ratio' });
      return F(this.id, 'info', 40, r.name + ' is quicker than planned',
        r.name + ' takes ' + mmss(r.observedSec * 1000) + ', ' + mmss(-r.deltaSec * 1000) + ' under the starter estimate of ' + mmss(r.starterSec * 1000) + ' (' + r.n + ' samples), so Finish together may fire it too early.' + tail, { label: 'Observed over starter', value: r.ratio, unit: 'ratio' });
    } },
    // pacing-effect: do plates finish together, with less finished food waiting? Finish together on vs off. Needs 15
    // multi-item tickets per side. It never claims faster tickets: Finish together holds early items on purpose, so
    // the median ticket time can rise. The two sides are different tickets, not a controlled test.
    { id: 'pacing-effect', run(c) {
      const p = M.pacingCompare(c); if (!p.comparable || p.on.syncTickets < 15 || p.off.syncTickets < 15) return null;
      const cut = p.lampCutPct, longer = isFinite(p.medianDeltaMs) && p.medianDeltaMs > 0;
      const body = 'Finished food waited ' + mmss(p.off.avgLampMs) + ' per plate with Finish together off and ' + mmss(p.on.avgLampMs) + ' with it on, and the plate spread went from ' + mmss(p.off.avgSpreadMs) + ' to ' + mmss(p.on.avgSpreadMs) + '. ' +
        'Median ticket time was ' + mmss(p.off.medianTotalMs) + ' with Finish together off and ' + mmss(p.on.medianTotalMs) + ' with it on' + (longer ? '; Finish together holds early items on purpose so the plate finishes together, so it is not meant to make tickets faster' : '') + '. ' +
        'Based on ' + p.on.syncTickets + ' paced and ' + p.off.syncTickets + ' unpaced multi-item tickets. These are different tickets, so treat it as a hint, not a controlled test.';
      if (p.lampSavedMs >= 15000 && cut >= 0.2) return F(this.id, 'good', 70, 'With Finish together on, plates finished together: food waited ' + mmss(p.on.avgLampMs) + ' instead of ' + mmss(p.off.avgLampMs), body, { label: 'Less food waiting', value: cut, unit: 'share' });
      if (p.lampSavedMs <= -15000) return F(this.id, 'warn', 62, 'Finish together is not helping plates finish together yet', body, { label: 'Waiting change', value: p.lampSavedMs, unit: 'ms' });
      return F(this.id, 'info', 32, 'Finish together made little difference to plates finishing together', body, { label: 'Waiting change', value: p.lampSavedMs, unit: 'ms' });
    } },
    // sellout-early: a protein went 86 at least 1.5 h before close on a day with 30+ tickets; estimates
    // grams per hour.
    { id: 'sellout-early', run(c) {
      const so = M.sellOutClock(c), dc = byKey(c.vol, (v) => v.date);
      const cand = so.rows.filter((r) => r.hoursBeforeClose >= 1.5 && (dc[r.date] || EMPTY).length >= 30); if (!cand.length) return null;
      const w = cand.reduce((a, b) => (b.hoursBeforeClose > a.hoursBeforeClose ? b : a));
      let n = 0, grams = 0, firstT = Infinity;                  // pace of use before the 86, scanned without building a list
      for (const v of c.all) for (const it of v.items) {
        if (!it || it.status !== 'done' || !num(it.doneAt) || it.doneAt >= w.t || it.doneAt < w.t - 24 * H || !Array.isArray(it.depleted) || c.dateOf(it.doneAt) !== w.date) continue;
        for (const d of it.depleted) if (d && d.ing === w.ing && num(d.g) && d.g > 0) { n++; grams += d.g; if (it.doneAt < firstT) firstT = it.doneAt; }
      }
      let est = '';
      if (n >= 3) { const span = Math.max(1, (w.t - firstT) / H), rate = grams / span; est = ' At the pace before the 86 (' + kgTxt(rate) + ' an hour) roughly ' + kgTxt(rate * w.hoursBeforeClose) + ' more cooked ' + w.name.toLowerCase() + ' would have lasted to close.'; }
      return F(this.id, w.hoursBeforeClose >= 3 ? 'bad' : 'warn', Math.min(90, 70 + w.hoursBeforeClose * 3), w.name + ' went 86 at ' + clock(w.t),
        w.name + ' went 86 at ' + clock(w.t) + ' on ' + U.fmtDateShort(w.date) + ', ' + w.hoursBeforeClose.toFixed(1) + ' hours before close.' + est, { label: 'Hours before close', value: w.hoursBeforeClose, unit: 'hours' });
    } },
    // sellout-repeat: one protein sold out on 3+ days and 40+ percent of days (needs 4 days): the cook
    // count is low.
    { id: 'sellout-repeat', run(c) {
      const so = M.sellOutClock(c); if (so.dayCount < 4) return null;
      const p = so.proteins.filter((x) => x.days >= 3 && x.share >= 0.4).sort((a, b) => b.days - a.days || (a.ing < b.ing ? -1 : 1))[0]; if (!p) return null;
      const hb = so.rows.filter((r) => r.ing === p.ing).map((r) => r.hoursBeforeClose);
      return F(this.id, 'bad', 80, p.name + ' sold out on ' + p.days + ' of ' + so.dayCount + ' days',
        'On those days it went 86 about ' + mean(hb).toFixed(1) + ' hours before close on average. A repeat sell-out means the cook count is too low, not a one-off bad night.', { label: 'Days sold out', value: p.share, unit: 'share' });
    } },
    // waste: cost and weight of discarded batches. Needs 5 kg of cooked intake or 3 discards.
    { id: 'waste', run(c) {
      const k = M.compliance(c), d = k.discards; if (!(k.intakeG >= 5000 || d.count >= 3)) return null; const p = k.wastePct, top = d.byReason[0];
      if (d.count === 0) return k.intakeG >= 20000 ? F(this.id, 'good', 28, 'No cooked food was thrown away', kgTxt(k.intakeG) + ' of cooked food went into the hold cabinet and every batch was served.', { label: 'Waste', value: 0, unit: 'g' }) : null;
      const tone = p !== null && p >= 0.15 ? 'bad' : p !== null && p >= 0.08 ? 'warn' : p !== null && p < 0.03 && k.intakeG >= 20000 ? 'good' : 'info';
      return F(this.id, tone, { good: 28, info: 30, warn: 58, bad: 78 }[tone], 'Discards cost ' + money0(d.cost) + ' (' + kgTxt(d.g) + ')',
        d.count + ' ' + U.plural(d.count, 'batch', 'batches') + ' ' + (d.count === 1 ? 'was' : 'were') + ' thrown away' + (p !== null ? ', ' + pctTxt(p) + ' of the cooked food' : '') + '. Biggest reason: ' + top.reason + ' (' + kgTxt(top.g) + ').', { label: 'Waste cost', value: d.cost, unit: 'money' });
    } },
    // temp-checks: share of temperature readings logged on time. Needs 10 readings with an on-time flag.
    { id: 'temp-checks', run(c) {
      const t = M.compliance(c).tempChecks; if (t.count < 10) return null; const p = t.onTimePct;
      const tone = p >= 0.95 ? 'good' : p >= 0.85 ? 'info' : p >= 0.7 ? 'warn' : 'bad';
      return F(this.id, tone, { good: 25, info: 36, warn: 62, bad: 82 }[tone], pctTxt(p) + ' of temperature checks were on time',
        t.late + ' of ' + t.count + ' readings came late' + (t.avgLateMs !== null ? ', by ' + mmss(t.avgLateMs) + ' on average (worst ' + mmss(t.maxLateMs) + ')' : '') + '. ' + C.safetyLine, { label: 'Checks on time', value: p, unit: 'share' });
    } },
    // sanitize-late: share of sanitise rounds logged on time. Needs 4 rounds.
    { id: 'sanitize-late', run(c) {
      const s = M.compliance(c).sanitize; if (s.count < 4) return null; const p = s.onTimePct;
      if (p === 1) return F(this.id, 'good', 20, 'Every sanitize was on time', 'All ' + s.count + ' surface sanitize logs were inside the 4-hour timer. ' + C.safetyLine, { label: 'Sanitize on time', value: p, unit: 'share' });
      return F(this.id, p < 0.75 ? 'bad' : 'warn', p < 0.75 ? 75 : 55, s.late + ' of ' + s.count + ' sanitizes were late', 'Only ' + pctTxt(p) + ' were logged inside the timer' + (s.avgLateMs !== null ? '; the late ones ran ' + mmss(s.avgLateMs) + ' over on average' : '') + '. ' + C.safetyLine, { label: 'Sanitize on time', value: p, unit: 'share' });
    } },
    // forced-bumps: share of finished tickets bumped with items undone. Needs 20 tickets and 5+ percent
    // forced.
    { id: 'forced-bumps', run(c) {
      const s = summaryOf(c); if (s.count < 20 || s.forced / s.count < 0.05) return null; const r = s.forced / s.count;
      return F(this.id, r >= 0.12 ? 'bad' : 'warn', r >= 0.12 ? 70 : 55, s.forced + ' ' + U.plural(s.forced, 'ticket was', 'tickets were') + ' bumped with food unfinished',
        'That is ' + pctTxt(r) + ' of ' + s.count + ' finished tickets. Forced bumps hide real ticket times and are left out of plate-sync numbers, so check whether customers are leaving or cooks are forgetting to tap.', { label: 'Forced bumps', value: r, unit: 'share' });
    } },
    // undo-rate: how often undo is used. Needs 40 actions and 5+ percent undone.
    { id: 'undo-rate', run(c) {
      const f = M.frictionSummary(c); if (f.undo.actions < 40 || f.undo.rate < 0.05) return null; const top = f.reports.top[0];
      return F(this.id, f.undo.rate >= 0.12 ? 'warn' : 'info', f.undo.rate >= 0.12 ? 55 : 40, 'Undo was used ' + f.undo.count + ' times (' + pctTxt(f.undo.rate) + ' of actions)',
        'Frequent undo usually points at a button that is easy to mis-tap or a step that is unclear.' + (top ? ' The most common error message was "' + top.message + '" (' + top.count + ' times).' : ''), { label: 'Undo rate', value: f.undo.rate, unit: 'share' });
    } },
    // top-error: the most common refusal message. Needs 8 reports, the top one 5+ and 30+ percent.
    { id: 'top-error', run(c) {
      const f = M.frictionSummary(c), top = f.reports.top[0]; if (!top || f.reports.count < 8 || top.count < 5 || top.share < 0.3) return null;
      return F(this.id, 'info', 38, 'Most common mistake: ' + top.message.split(/(?<=[.!?])\s/)[0], top.count + ' of ' + f.reports.count + ' error messages (' + pctTxt(top.share) + ') were "' + top.message + '"' + (top.topAction ? ', mostly while doing "' + top.topAction + '"' : '') + '.', { label: 'Top error share', value: top.share, unit: 'share' });
    } },
    // bottleneck-station: one station finishes last on half or more of tickets. Needs 30 tickets and 2
    // stations.
    { id: 'bottleneck-station', run(c) {
      const an = anatomyRows(c); if (an.length < 30) return null; const z = M.byZone(c).filter((r) => r.lines > 0); if (z.length < 2) return null;
      const t = z.reduce((a, b) => (b.criticalShare > a.criticalShare ? b : a)); if (!(t.criticalShare >= 0.5)) return null;
      const odTot = an.filter((r) => r.level === 'breach').length, odShare = odTot ? t.overdueCritical / odTot : 0;
      return F(this.id, odTot >= 5 && odShare >= 0.6 ? 'warn' : 'info', odTot >= 5 && odShare >= 0.6 ? 60 : 45, t.name + ' is usually the last station to finish',
        pctTxt(t.criticalShare) + ' of ' + an.length + ' tickets waited on ' + t.name + ' for their final item' + (odTot ? ', and so did ' + t.overdueCritical + ' of the ' + odTot + ' overdue tickets' : '') + '. Its lines take ' + mmss(t.avgWorkMs) + ' on average.', { label: 'Final-item share', value: t.criticalShare, unit: 'share' });
    } },
    // expo-dwell: finished food waits 60 s+ and 15+ percent of the ticket before the bump. Needs 20
    // tickets.
    { id: 'expo-dwell', run(c) {
      const a = M.anatomySummary(c).overall; if (!a || a.count < 20 || a.dwellMs < 60000 || a.shares.dwell < 0.15) return null;
      return F(this.id, 'warn', 52, 'Finished tickets wait ' + mmss(a.dwellMs) + ' at expo', pctTxt(a.shares.dwell) + ' of an average ticket (' + mmss(a.totalMs) + ') passes after its last item is done and before it is bumped. Faster packing and bumping would cut ticket times without changing the kitchen.', { label: 'Expo dwell', value: a.dwellMs, unit: 'ms' });
    } },
    // food-cost: ingredient cost as a share of menu price. Needs 30 costed lines; good to 30, warn over 35,
    // bad over 40 percent.
    { id: 'food-cost', run(c) {
      const f = M.foodCostPct(c); if (f.lines < 30 || f.costPct === null) return null; const p = f.costPct;
      const tone = p > 0.4 ? 'bad' : p > 0.35 ? 'warn' : p <= 0.3 ? 'good' : 'info'; const worst = f.byCat.filter((x) => x.costPct !== null).sort((a, b) => b.costPct - a.costPct)[0];
      return F(this.id, tone, { good: 24, info: 28, warn: 54, bad: 72 }[tone], 'Food cost is ' + pctTxt(p) + ' of menu price', 'Across ' + f.lines + ' costed lines the ingredients cost ' + money(f.cost) + ' against ' + money(f.revenue) + ' of menu price.' + (worst ? ' ' + worst.name + ' is the heaviest at ' + pctTxt(worst.costPct) + '.' : ''), { label: 'Food cost', value: p, unit: 'share' });
    } },
    // yield-misprice: the static yield is 5+ percent off the real or model cost. Needs 3 weighed batches
    // (F-M9).
    { id: 'yield-misprice', run(c) {
      const y = M.yieldComparison(c).primary; if (!y || y.batches < 3 || y.staticCostErr === null || Math.abs(y.staticCostErr) < 0.05) return null;
      return F(this.id, y.staticCostErr < -0.1 ? 'bad' : 'warn', 50, 'The static ' + y.name.toLowerCase() + ' yield misprices cost by ' + (Math.abs(y.staticCostErr) * 100).toFixed(1) + '%',
        y.line + ' Starter yields stay estimates until you confirm them.', { label: 'Static vs true cost', value: y.staticCostErr, unit: 'share' });
    } },
    // voids: 4+ percent of tickets were voided. Needs 30 tickets and 3 voids.
    { id: 'voids', run(c) {
      const f = M.frictionSummary(c); if (c.all.length < 30 || f.voids.count < 3 || f.voids.pct < 0.04) return null; const top = f.voids.byReason[0];
      return F(this.id, f.voids.pct >= 0.1 ? 'bad' : 'warn', f.voids.pct >= 0.1 ? 68 : 46, f.voids.count + ' tickets were voided', pctTxt(f.voids.pct) + ' of ' + c.all.length + ' tickets. Most common reason: ' + top.reason + ' (' + top.count + ').', { label: 'Void rate', value: f.voids.pct, unit: 'share' });
    } },
    // recalls: 4+ percent of tickets came back after a bump. Needs 40 tickets and 4 recalls.
    { id: 'recalls', run(c) {
      const f = M.frictionSummary(c); if (c.live.length < 40 || f.recalls.count < 4 || f.recalls.pct < 0.04) return null;
      return F(this.id, 'info', 35, f.recalls.count + ' tickets were recalled after a bump', pctTxt(f.recalls.pct) + ' of ' + c.live.length + ' tickets came back. Recalls usually mean a bump before the plate was checked.', { label: 'Recalls', value: f.recalls.pct, unit: 'share' });
    } },
    // safety-lockouts: items 86'd by a food-safety lockout. Needs 1 spell and 20 tickets.
    { id: 'safety-lockouts', run(c) {
      const l = M.compliance(c).lockouts; if (l.spellCount < 1 || c.all.length < 20) return null; const sp = l.spells.slice(0, 2).map((s) => s.name + (s.durationMs !== null ? ' for ' + mmss(s.durationMs) : ' (still locked)')).join(' and ');
      return F(this.id, 'warn', 66, l.spellCount + ' menu ' + U.plural(l.spellCount, 'item') + ' ' + (l.spellCount === 1 ? 'was' : 'were') + ' 86\'d by a food-safety lockout', 'First: ' + sp + '. A lockout means a batch was out of its safe temperature or time window and could not be served. ' + C.safetyLine, { label: 'Safety lockouts', value: l.spellCount, unit: 'count' });
    } },
  ];

  // When insights/headline pass one shared context, these heavy metrics are computed once per context.
  // (Results are shared: treat them as read-only.)
  // The answer is cached only for calls with no per-call options, because options can change the result.
  ['compliance', 'frictionSummary', 'calibration', 'pacingCompare', 'sellOutClock', 'yieldComparison', 'foodCostPct', 'anatomySummary', 'byZone', 'syncLatency', 'avgTicketValue'].forEach((name) => {
    const f = M[name]; M[name] = (ds, opts) => { const c = makeCtx(ds, opts); return opts && typeof opts === 'object' && Object.keys(opts).length ? f(c) : c.memo('M:' + name, () => f(c)); };
  });
  M._rules = RULES;       // exposed for profiling and tests only

  /** Ids of every insight rule, in evaluation order (for tests and the Data page). */
  M.insightRules = () => RULES.map((r) => r.id);
  /**
   * Plain-English findings from the data, deterministic, at most 8 (opts.limit can lower it or, for tests, raise it to 40), most important first.
   * Every rule has a minimum-sample guard and stays silent on thin data. A rule that throws is skipped, never surfaced.
   * @returns {Array<{id:string,tone:'good'|'info'|'warn'|'bad',title:string,body:string,metric:null|{label,value:number,unit:'ms'|'share'|'ratio'|'hours'|'money'|'g'|'count'},importance:number}>}
   */
  M.insights = (ds, opts) => {
    const c = makeCtx(ds, opts); const lim = num(c.o.opts.limit) ? Math.max(0, Math.min(40, Math.floor(c.o.opts.limit))) : 8, out = [];
    for (const r of RULES) { try { const f = r.run(c); if (f) out.push(f); } catch (e) { /* a broken rule must never break the page */ } }
    out.sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : 1));
    return out.slice(0, lim);
  };

  /* ================= one-sentence headline per office page ================= */
  // The four anatomy parts with the plain words used in the "tickets" headline.
  const PARTS = [['hold', 'the paced hold before items fire'], ['response', 'waiting for a cook to start'], ['work', 'cooking and plating'], ['dwell', 'waiting at expo to be bumped']];
  /**
   * One plain-language sentence for the top of an office page. pageId: 'pace' | 'tickets' | 'stations' | 'money' | 'safety' | 'stock' | 'data'.
   * Always returns a non-empty string; with no data it says so. Numbers come from the same functions the charts use.
   * @returns {string}
   */
  M.headline = (pageId, ds, opts) => {
    const c = makeCtx(ds, opts); const thin = (n, lim) => (n < lim ? ' Only ' + n + ' ' + U.plural(n, 'ticket') + ' so far, so treat this as a rough guide.' : '');
    // One case per office page; each builds a sentence from the same functions the charts use.
    switch (pageId) {
      case 'pace': {
        const s = summaryOf(c); if (!s.count) return 'No finished tickets in this range yet.';
        return 'Half of tickets are out in ' + mmss(s.median) + ' and 9 in 10 within ' + mmss(s.p90) + '; ' + pctTxt(s.onTimePct) + ' beat their warning time' + (s.overdue ? ', ' + U.fmtNum(s.overdue) + ' ran overdue' : '') + '.' + thin(s.count, 10);
      }
      case 'tickets': {
        const a = M.anatomySummary(c).overall; if (!a) return 'No finished tickets to break down yet.';
        const ps = PARTS.map((p) => ({ name: p[1], share: a.shares[p[0]] || 0 })).sort((x, y) => y.share - x.share);
        const h = byHourRows(c).filter((x) => x.count >= 5).sort((x, y) => y.medianMs - x.medianMs)[0];
        return 'Most of a ticket\'s ' + mmss(a.totalMs) + ' average goes to ' + ps[0].name + ' (' + pctTxt(ps[0].share) + '), then ' + ps[1].name + ' (' + pctTxt(ps[1].share) + ').' + (h ? ' ' + h.span + ' is the slowest hour at a median of ' + mmss(h.medianMs) + '.' : '') + thin(a.count, 10);
      }
      case 'stations': {
        const z = M.byZone(c); if (!z.length) return 'No finished items at the stations yet.';
        const t = z.reduce((a, b) => (b.criticalShare > a.criticalShare ? b : a)), fl = M.calibration(c).filter((r) => r.flag).length;
        return (t.criticalShare !== null ? t.name + ' finished last on ' + pctTxt(t.criticalShare) + ' of tickets; ' : z.length + ' ' + U.plural(z.length, 'station', 'stations') + ' worked tickets that are not finished yet; ') + (fl ? fl + ' ' + U.plural(fl, 'item runs', 'items run') + ' outside 0.8 to 1.25 times the starter prep time.' : 'every item with enough samples is close to its starter prep time.');
      }
      case 'money': {
        const t = moneyTotals(c), v = M.avgTicketValue(c), sl = M.sales(c);
        // Sales from paid orders lead the sentence once any exist.
        if (sl.checks) return 'You sold ' + money0(sl.net) + ' of food in ' + U.fmtNum(sl.checks) + ' paid ' + U.plural(sl.checks, 'order') + ' (' + money(sl.avgCheck) + ' average). With tax and tips, ' + money0(sl.collected) + ' was collected' + (sl.tips > 0 ? ', ' + money0(sl.tips) + ' of it tips.' : '.');
        if (t.revenue === null) return 'No sales in this range yet.';
        // WATCH OUT: with no paid order this is finished food at menu price, a different base from Sales, so it says so.
        return 'No paid orders yet. Finished food worth ' + money0(t.revenue) + ' at menu price' + (v.count ? ' over ' + U.fmtNum(v.count) + ' finished tickets, ' + money(v.avg) + ' per ticket' : '') + (t.costPct !== null ? '; ingredients cost ' + pctTxt(t.costPct) + ' of menu price.' : '.');
      }
      case 'safety': {
        const k = M.compliance(c); if (!k.tempChecks.count && !k.sanitize.count && !k.discards.count) return 'No food-safety records in this range yet.';
        // One check reads "the one sanitize round was late", never "0% of 1 ... was on time".
        const share = (x, noun) => (x.count === 1 ? 'the one ' + noun + ' was ' + (x.onTime ? 'on time' : 'late') : pctTxt(x.onTimePct) + ' of ' + U.fmtNum(x.count) + ' ' + noun + 's were on time');
        const temps = k.tempChecks.count ? share(k.tempChecks, 'temperature check') : 'No temperature checks logged';
        return (k.tempChecks.count === 1 ? 'T' + temps.slice(1) : temps) + (k.sanitize.count ? ', ' + share(k.sanitize, 'sanitize round') : '') + '; ' + (k.discards.count ? k.discards.count + ' ' + U.plural(k.discards.count, 'batch', 'batches') + ' thrown out (' + kgTxt(k.discards.g) + ', ' + M.discardCostWords(k.discards, money) + ').' : 'nothing was discarded.');
      }
      case 'stock': {
        const so = M.sellOutClock(c), n = so.rows.length; if (!so.dayCount) return 'No sell-outs in this range yet.';
        const w = so.rows.slice().sort((a, b) => b.hoursBeforeClose - a.hoursBeforeClose)[0];
        return (n ? n + ' protein ' + U.plural(n, 'sell-out') + ' in ' + so.dayCount + ' ' + U.plural(so.dayCount, 'day') + (w ? ', the earliest ' + w.name.toLowerCase() + ' at ' + clock(w.t) + ' (' + Math.max(0, w.hoursBeforeClose).toFixed(1) + ' hours before close)' : '') + '.' : 'No protein sold out before close.');
      }
      case 'data': {
        let sample = 0, live = 0; for (const v of c.all) { if (v.t.src === 'sample') sample++; else live++; }
        return c.all.length ? U.fmtNum(c.all.length) + ' tickets in this range (' + U.fmtNum(sample) + ' sample, ' + U.fmtNum(live) + ' live) and ' + U.fmtNum(c.ds.events ? c.ds.events.length : 0) + ' logged events.' : 'No tickets in this range yet.';
      }
      default: return 'Pick a page to see its summary.';
    }
  };

  /**
   * Build the shared context for one dataset + filter once, then pass the returned handle as the first argument of any metric (instead of the dataset)
   * to avoid re-scanning 5000 tickets for every call. Range and channel/zone/includeVoided are fixed when you prepare; per-call opts may still carry
   * function options (bucketMin, fold, minSamples, binSec, limit, day, ing). Results from a handle are plain data but some are cached and shared between
   * calls on the same handle, so treat them as read-only.
   * prepare() treats the dataset as an immutable snapshot (which is what SB.store.dataset() hands out: the engine never edits a state in place). Calling
   * it again with the same dataset object and the same opts returns the SAME handle while the dataset's tickets / events / batches / settings / menu /
   * ingredients / learned references, their lengths and the range are unchanged, so every widget on a page may simply call M.prepare(ds, filters).
   * Edit a dataset in place (a test, a script) and call prepare() afterwards only with a fresh object, or call M.unprepare(ds).
   * @returns {object} opaque handle
   */
  // Remembered handles per dataset object and options; a WeakMap lets the memory go when the dataset is
  // dropped.
  const PREPARED = new WeakMap();
  // The references and lengths that must be unchanged for a remembered handle to stay valid (F-M17).
  const snapshotOf = (d) => { const r = d.range && typeof d.range === 'object' ? d.range : {}; return [d.tickets, arr(d.tickets).length, d.orders, arr(d.orders).length, d.events, arr(d.events).length, d.batches, arr(d.batches).length, d.settings, d.menu, d.ingredients, d.learned, r.from, r.to]; };
  // Builds the shared context for a dataset and filter, or reuses the remembered one (see the long note
  // above).
  M.prepare = (ds, opts) => {
    const raw = unwrap(ds);
    if (!raw || typeof raw !== 'object') return makeCtx(raw, opts);
    // The options become the cache key; options that cannot be turned into text skip the cache.
    let sig = null; try { sig = JSON.stringify(opts && typeof opts === 'object' ? opts : opts === undefined ? null : [opts]); } catch (e) { sig = null; }
    if (sig === null) return makeCtx(raw, opts);
    const snap = snapshotOf(raw); let slots = PREPARED.get(raw);
    if (slots) { const hit = slots.get(sig); if (hit && hit.snap.length === snap.length && hit.snap.every((x, i) => x === snap[i])) return hit.ctx; }
    else PREPARED.set(raw, (slots = new Map()));
    if (slots.size >= 4) slots.delete(slots.keys().next().value);
    const ctx = makeCtx(raw, opts); slots.set(sig, { snap, ctx });
    return ctx;
  };
  /** Forget the handles prepare() kept for a dataset (only needed after editing a dataset in place). */
  M.unprepare = (ds) => { const raw = unwrap(ds); if (raw && typeof raw === 'object') PREPARED.delete(raw); };

  M.version = 1;
})(typeof globalThis !== 'undefined' ? globalThis : window);
