/*
 * WHAT THIS FILE IS: Draws line, bar, histogram, heat-map, scatter, dumbbell, gantt, meter, ring, spark and
 *   stacked charts as SVG (shapes that stay sharp at any size). Call SB.charts.<type>(el, spec).
 * PARTS: 1 maths | 2 formats | 3 colour tokens | 4 drawing helpers | 5 Chart base | 6 axes | 7-15 one
 *   section per chart type | 16 public API.
 * USES / USED BY: 00-util.js and the --ch-* colours in 40-charts.css; used by 60-shell.js,
 *   80-office-core.js, 81-office-pace.js.
 */
// Method: the dataviz rules (thin marks, 2 px gaps between marks, a data table for every chart, status
// colours always paired with a shape and a word). Marks use var(--ch-*) so a theme switch repaints at once.
// Nothing touches the page at load time, so the maths helpers also run in Node tests.
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util || {};
  const C = (SB.charts = SB.charts || {});

  /* =====================================================================================================
   * 1. PURE MATHS (no DOM): nice numbers, ticks, scales, binning, decimation, colour contrast
   * ===================================================================================================== */
  const M = (C.math = {});
  // True only for real, finite numbers (not NaN, Infinity, null or text).
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // Pins a number between a low and a high limit.
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // Trims floating-point noise (0.1 + 0.2 shows as 0.3); anything that is not a number passes through.
  const fix = (x) => (isNum(x) ? +x.toPrecision(15) : x);
  M.isNum = isNum;
  M.clamp = clamp;
  M.fix = fix;

  /** Heckbert nice number: the 1/2/5 x 10^n closest to (round) or at-or-above (ceil) `range`. */
  M.niceNum = function niceNum(range, round) {
    if (!(range > 0) || !isFinite(range)) return 1;
    const exp = Math.floor(Math.log10(range));
    const f = range / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  };

  /** Smallest decimals d (0..6) such that `step` is a multiple of 10^-d. 0.25 -> 2, 5 -> 0. */
  M.decimals = function decimals(step) {
    if (!isNum(step) || step === 0) return 0;
    const a = Math.abs(step);
    for (let d = 0; d <= 6; d++) { const x = a * Math.pow(10, d); if (Math.abs(x - Math.round(x)) < 1e-7 * Math.max(1, x)) return d; }
    return 6;
  };

  // Tick step: the first listed step big enough, else a multiple of the largest; no list means 1/2/5.
  function pickStep(raw, steps) {
    if (steps && steps.length) {
      for (let i = 0; i < steps.length; i++) if (steps[i] >= raw * 0.9999) return steps[i];
      const last = steps[steps.length - 1];
      return last * M.niceNum(raw / last, false);
    }
    return M.niceNum(raw, true);
  }

  /**
   * niceTicks(min, max, count, opts) -> { min, max, step, ticks, decimals }
   *   opts.steps   ascending candidate step sizes (e.g. seconds-friendly for durations); default 1/2/5 x 10^n
   *   opts.fixMin / opts.fixMax  keep that end of the domain exactly (ticks only inside)
   *   opts.nice    false = never extend the domain to a tick (used by fixed domains)
   * Total: NaN, equal, reversed, infinite and empty input all return a usable scale.
   */
  M.niceTicks = function niceTicks(min, max, count, opts) {
    opts = opts || {};
    count = clamp(Math.round(count) || 5, 2, 12);
    if (!isNum(min) && !isNum(max)) { min = 0; max = 1; } else if (!isNum(min)) min = max - 1; else if (!isNum(max)) max = min + 1;
    if (min > max) { const t = min; min = max; max = t; }
    if (min === max) {
      if (min === 0) max = 1;
      else { const d = Math.abs(min) * 0.1; min -= d; max += d; }
    }
    const raw = (max - min) / (count - 1);
    let step = pickStep(raw, opts.steps);
    // True when v sits on a multiple of the step st (allowing for rounding error).
    const aligned = (v, st) => Math.abs(v / st - Math.round(v / st)) < 1e-7;
    if (opts.fixMin != null && isNum(opts.fixMin) && !aligned(opts.fixMin, step)) {      // a fixed minimum should land on a tick, so the baseline is labelled
      for (const div of [2, 4, 5, 10]) { const st = step / div; if (aligned(opts.fixMin, st) && (max - min) / st + 1 <= count * 2.2) { step = st; break; } }
    }
    let lo = opts.fixMin != null && isNum(opts.fixMin) ? opts.fixMin : (opts.nice === false ? min : Math.floor(min / step + 1e-9) * step);
    let hi = opts.fixMax != null && isNum(opts.fixMax) ? opts.fixMax : (opts.nice === false ? max : Math.ceil(max / step - 1e-9) * step);
    lo = fix(lo); hi = fix(hi);
    if (hi <= lo) hi = fix(lo + step);
    const ticks = [];
    const k0 = Math.ceil(lo / step - 1e-9);
    for (let k = k0, n = 0; n < 60; k++, n++) { const v = fix(k * step); if (v > hi + step * 1e-9) break; ticks.push(v); }
    if (opts.fixMin != null && isNum(opts.fixMin) && ticks.length && ticks[0] > lo + step * 1e-6) { if (ticks[0] - lo < step * 0.35) ticks.shift(); ticks.unshift(lo); }
    return { min: lo, max: hi, step: fix(step), ticks, decimals: M.decimals(step) };
  };

  /** Ticks at multiples of a step chosen from `steps` (hours, seconds ...) inside [min, max]. No domain extension. */
  M.stepTicks = function stepTicks(min, max, count, steps) {
    if (!isNum(min) || !isNum(max) || max <= min) return { step: 1, ticks: [] };
    const step = pickStep((max - min) / Math.max(1, count - 1), steps);
    const ticks = [];
    for (let k = Math.ceil(min / step - 1e-9), n = 0; n < 200; k++, n++) { const v = fix(k * step); if (v > max + step * 1e-9) break; ticks.push(v); }
    return { step, ticks };
  };

  const MIN = 6e4, HR = 36e5, DAY = 864e5;
  M.MS = { MIN, HR, DAY };
  // Allowed tick spacings for a clock axis, from 1 minute up to many days, so labels land on tidy times.
  const TSTEPS = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HR, 2 * HR, 3 * HR, 6 * HR, 12 * HR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 28 * DAY, 84 * DAY, 168 * DAY, 336 * DAY, 672 * DAY, 1680 * DAY, 3360 * DAY, 16800 * DAY];
  // Epoch-ms ticks aligned to LOCAL clock boundaries (on the hour, on midnight ...). Returns { step, ticks
  // }.
  // WATCH OUT: steps under a day are fixed lengths counted from local midnight, so on a daylight-saving
  // change day the ticks after the switch are an hour off the usual clock marks.
  M.timeTicks = function timeTicks(min, max, count) {
    if (!isNum(min) || !isNum(max) || max <= min) return { step: HR, ticks: [] };
    count = clamp(Math.round(count) || 6, 2, 14);
    const raw = (max - min) / (count - 1);
    let step = TSTEPS[TSTEPS.length - 1];
    for (let i = 0; i < TSTEPS.length; i++) if (TSTEPS[i] >= raw * 0.9999) { step = TSTEPS[i]; break; }
    const ticks = [];
    if (step < DAY) {
      const d0 = new Date(min); d0.setHours(0, 0, 0, 0);
      let t = d0.getTime(); t += Math.ceil((min - t) / step - 1e-9) * step;
      for (let n = 0; t <= max + 1 && n < 300; t += step, n++) ticks.push(t);
    } else {
      const days = Math.round(step / DAY);
      const d = new Date(min); d.setHours(0, 0, 0, 0); if (d.getTime() < min) d.setDate(d.getDate() + 1);
      for (let n = 0; d.getTime() <= max && n < 300; d.setDate(d.getDate() + days), n++) ticks.push(d.getTime());
    }
    return { step, ticks };
  };

  // Tidy tick spacings: hours, seconds, and the same seconds list in milliseconds.
  M.HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24];
  M.SEC_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
  M.MS_STEPS = M.SEC_STEPS.map((s) => s * 1000);
  // Ticks for decimal hours of the service day (6.5 is 6:30 am), up to 30 so a late night passes midnight.
  M.hourTicks = (min, max, count) => M.stepTicks(min, max, count, M.HOUR_STEPS);
  // Ticks for an axis in seconds, on tidy values such as 30 s, 1 min, 5 min.
  M.secTicks = (min, max, count) => M.stepTicks(min, max, count, M.SEC_STEPS);

  /** Linear scale with invert. Degenerate domains map to the middle of the range. */
  M.linear = function linear(d0, d1, r0, r1) {
    const span = d1 - d0;
    // The scale: data value in, screen position out (middle of the range if the domain has no width).
    const f = (v) => (span === 0 || !isNum(v) ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
    // The reverse: a screen position back to a data value (turns a mouse position into a time or number).
    f.invert = (p) => (r1 === r0 ? d0 : d0 + ((p - r0) / (r1 - r0)) * span);
    f.domain = [d0, d1]; f.range = [r0, r1];
    return f;
  };

  /** Push label centres apart so neighbours are at least `gap` apart, keeping every label within [lo, hi]. Returns positions in input order, or null when they cannot fit. */
  M.spreadLabels = function spreadLabels(ys, gap, lo, hi) {
    const n = ys.length; if (!n) return [];
    if ((n - 1) * gap > hi - lo) return null;
    const idx = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b] || a - b);
    const p = idx.map((i) => clamp(ys[i], lo, hi));
    for (let i = 1; i < n; i++) if (p[i] < p[i - 1] + gap) p[i] = p[i - 1] + gap;
    if (p[n - 1] > hi) { p[n - 1] = hi; for (let i = n - 2; i >= 0; i--) if (p[i] > p[i + 1] - gap) p[i] = p[i + 1] - gap; }
    const out = new Array(n); idx.forEach((i, k) => { out[i] = p[k]; });
    return out;
  };
  // Position of the number closest to x in a list sorted low to high; -1 for an empty list.
  M.nearestIndex = function nearestIndex(arr, x) {
    const n = arr.length; if (!n) return -1;
    let lo = 0, hi = n - 1;
    if (x <= arr[0]) return 0;
    if (x >= arr[hi]) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid; else hi = mid; }
    return x - arr[lo] <= arr[hi] - x ? lo : hi;
  };

  /** Sorted unique finite numbers from several arrays. */
  M.unionSorted = function unionSorted(lists) {
    const s = new Set();
    for (const l of lists) for (let i = 0; i < l.length; i++) if (isNum(l[i])) s.add(l[i]);
    return Array.from(s).sort((a, b) => a - b);
  };

  /**
   * Min/max decimation for dense lines: keeps, per pixel column, the first, last, lowest and highest point (in x order),
   * so spikes survive. xs ascending. Returns the kept indices. Short series come back untouched.
   */
  M.decimate = function decimate(xs, ys, columns) {
    const n = xs.length;
    if (n <= columns * 4 || columns < 1) { const all = new Array(n); for (let i = 0; i < n; i++) all[i] = i; return all; }
    const x0 = xs[0], span = xs[n - 1] - x0 || 1;
    const keep = [];
    let col = -1, first = 0, last = 0, lo = -1, hi = -1;
    // Closes the current pixel column: keeps its first, last, lowest and highest points in x order.
    const flush = () => {
      if (col < 0) return;
      const set = new Set([first, last]); if (lo >= 0) set.add(lo); if (hi >= 0) set.add(hi);
      Array.prototype.push.apply(keep, Array.from(set).sort((a, b) => a - b));
    };
    for (let i = 0; i < n; i++) {
      const c = Math.min(columns - 1, Math.floor(((xs[i] - x0) / span) * columns));
      if (c !== col) { flush(); col = c; first = last = i; lo = hi = isNum(ys[i]) ? i : -1; }
      else {
        last = i;
        if (isNum(ys[i])) { if (lo < 0 || ys[i] < ys[lo]) lo = i; if (hi < 0 || ys[i] > ys[hi]) hi = i; }
      }
    }
    flush();
    return keep;
  };

  /**
   * Histogram binning. binValues(values, binSize, min, max) -> { lo, hi, cap, binSize, counts, total, overflow, under, n }
   * Auto min/max snap to bin edges. When max is given, larger values pile into the last bin and count as `overflow`; values below
   * min are `under` and dropped. At most 200 bins (binSize grows by whole multiples).
   * WATCH OUT: hi is max rounded up to a bin edge, so overflow is counted against max itself and cap keeps it for the note.
   */
  M.binValues = function binValues(values, binSize, min, max) {
    const v = [];
    if (values) for (let i = 0; i < values.length; i++) if (isNum(values[i])) v.push(values[i]);
    if (!v.length) return { lo: isNum(min) ? min : 0, hi: isNum(max) ? max : 1, cap: isNum(max) ? max : 1, binSize: binSize > 0 ? binSize : 1, counts: [], total: 0, overflow: 0, under: 0, n: 0 };
    let dMin = Infinity, dMax = -Infinity;
    for (const x of v) { if (x < dMin) dMin = x; if (x > dMax) dMax = x; }
    const flat = dMax === dMin;                                // every value identical: show one bin with empty neighbours instead of one full-width bar
    if (!(binSize > 0) || !isFinite(binSize)) binSize = M.niceNum(flat ? Math.abs(dMin) * 0.1 || 1 : (dMax - dMin) / 12, true);
    let lo = isNum(min) ? min : Math.floor(dMin / binSize + 1e-9) * binSize - (flat ? 2 * binSize : 0);
    let hi = isNum(max) ? max : (Math.floor(dMax / binSize + 1e-9) + 1) * binSize + (flat ? 2 * binSize : 0);
    if (hi <= lo) hi = lo + binSize;
    let n = Math.ceil((hi - lo) / binSize - 1e-9);
    if (n > 200) { binSize *= Math.ceil(n / 200); n = Math.ceil((hi - lo) / binSize - 1e-9); }
    hi = fix(lo + n * binSize);
    const counts = new Array(n).fill(0);
    let overflow = 0, under = 0;
    for (const x of v) {
      if (x < lo) { under++; continue; }
      let i = Math.floor((x - lo) / binSize + 1e-9);
      if (isNum(max) && x > max + 1e-9) overflow++;
      if (i >= n) i = n - 1;
      counts[i]++;
    }
    return { lo: fix(lo), hi, cap: isNum(max) ? max : hi, binSize: fix(binSize), counts, total: v.length - under, overflow, under, n };
  };

  /** Stack values (per category) for visible series: returns { base[s][c], top[s][c] } with positives stacking up, negatives down. */
  M.stackLayout = function stackLayout(valuesBySeries, nCats) {
    const base = [], top = [];
    const pos = new Array(nCats).fill(0), neg = new Array(nCats).fill(0);
    for (let s = 0; s < valuesBySeries.length; s++) {
      const b = new Array(nCats).fill(0), t = new Array(nCats).fill(0);
      for (let c = 0; c < nCats; c++) {
        const v = valuesBySeries[s][c];
        if (!isNum(v) || v === 0) { b[c] = t[c] = v >= 0 || !isNum(v) ? pos[c] : neg[c]; continue; }
        if (v > 0) { b[c] = pos[c]; pos[c] += v; t[c] = pos[c]; } else { b[c] = neg[c]; neg[c] += v; t[c] = neg[c]; }
      }
      base.push(b); top.push(t);
    }
    return { base, top, pos, neg };
  };

  /* ---------- colour maths (for choosing readable ink on a fill) ---------- */
  // Reads "#rgb", "#rrggbb" or "rgb(r, g, b)" into [red, green, blue], 0 to 255; null if unreadable.
  M.parseColor = function parseColor(str) {
    if (!str) return null;
    str = String(str).trim();
    let m = /^#([0-9a-f]{3})$/i.exec(str);
    if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
    m = /^#([0-9a-f]{6})/i.exec(str);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(str);
    if (m) return [+m[1], +m[2], +m[3]].map((x) => Math.round(x));
    return null;
  };
  // How bright a colour looks, 0 (black) to 1 (white), using the WCAG formula that contrast checks use.
  M.luminance = function luminance(rgb) {
    // Converts one 0-255 colour channel to linear light.
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  // WCAG contrast ratio (1 to 21) between two colours, as text or [r, g, b]; 1 if either is unreadable.
  M.contrast = function contrast(a, b) {
    const A = typeof a === 'string' ? M.parseColor(a) : a, B = typeof b === 'string' ? M.parseColor(b) : b;
    if (!A || !B) return 1;
    const x = M.luminance(A), y = M.luminance(B);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  /** Whichever of two inks reads better on `fill` (a label set inside a coloured fill is the one place text takes a non-text token). */
  M.pickInk = function pickInk(fill, inkA, inkB) { return M.contrast(fill, inkA) >= M.contrast(fill, inkB) ? inkA : inkB; };

  /* =====================================================================================================
   * 2. FORMATS: named formats usable as spec.format / x.format / y.format, or pass your own (v) => string
   * ===================================================================================================== */
  // Number-to-text helpers. grp puts commas in thousands ("12345" becomes "12,345").
  const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Number to text with fixed decimals and commas; "-" when it is not a number.
  const fmtN = (n, d) => (isNum(n) ? grp(n.toFixed(d)) : '-');
  // Drops trailing zeros after a decimal point (1.50 becomes 1.5); text without a point is left alone.
  const trim0 = (s) => (s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s);
  // Exact tooltip text (the little note that pops up on a mark): 0 decimals from 100, 1 from 10, else 2.
  function numFull(v) {
    if (!isNum(v)) return '-';
    const a = Math.abs(v);
    return trim0(fmtN(v, a >= 100 ? 0 : a >= 10 ? 1 : 2));
  }
  // Short axis text: 1.2K, 3.4M, 2B (K starts at 10 000); smaller values stay plain; dec fixes decimals.
  function compact(v, dec) {
    if (!isNum(v)) return '-';
    const a = Math.abs(v);
    // WATCH OUT: the unit is picked after rounding, so 999,950 reads 1M and not 1000K.
    if (a >= 1e9 || Number((a / 1e6).toFixed(0)) >= 1000) return trim0((v / 1e9).toFixed(1)) + 'B';
    if (a >= 1e6 || Number((a / 1e3).toFixed(0)) >= 1000) return trim0((v / 1e6).toFixed(a >= 1e7 ? 0 : 1)) + 'M';
    if (a >= 1e4) return trim0((v / 1e3).toFixed(a >= 1e5 ? 0 : 1)) + 'K';
    if (a >= 1e3 && dec === 0) return grp(String(Math.round(v)));
    return trim0(v.toFixed(dec == null ? (a >= 100 ? 0 : a >= 10 ? 1 : 2) : dec));
  }
  // Duration axis text from milliseconds: "45s", "5m 30s", "2h 15m"; "0" for zero; "-" when negative.
  function durAxis(ms) {
    if (!isNum(ms)) return '-';
    const neg = ms < 0; let s = Math.round(Math.abs(ms) / 1000);
    let out;
    if (s === 0) out = '0';
    else if (s < 60) out = s + 's';
    else if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; out = r ? m + 'm ' + r + 's' : m + 'm'; }
    else { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); out = m ? h + 'h ' + m + 'm' : h + 'h'; }
    return (neg ? '-' : '') + out;
  }
  // Full duration text: the app-wide formatter (SB.util.fmtDur) when it exists, else the axis style.
  const fmtDurMs = (ms) => (U.fmtDur ? U.fmtDur(ms) : durAxis(ms));
  // Decimal hour of the day to clock text (13.25 is "1:15 pm"); wraps past midnight, so 25 is "1 am".
  function hourFull(h) {
    if (!isNum(h)) return '-';
    const total = Math.round(h * 60); const hh = ((Math.floor(total / 60) % 24) + 24) % 24; const mm = ((total % 60) + 60) % 60;
    const ap = hh >= 12 ? 'pm' : 'am'; const x = hh % 12 === 0 ? 12 : hh % 12;
    return x + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '') + ' ' + ap;
  }
  // Hour axis label: whole hours use the app formatter ("1 pm"); other values show minutes.
  const hourAxis = (h) => (Math.abs(h - Math.round(h)) < 1e-6 ? (U.fmtHour ? U.fmtHour(h) : hourFull(h)) : hourFull(h));
  // Clock time of day ("1:42 pm") for a timestamp (milliseconds since 1970).
  function timeOfDay(ts) { return U.fmtTime ? U.fmtTime(ts) : hourFull(new Date(ts).getHours() + new Date(ts).getMinutes() / 60); }
  // Time axis label: short on the hour ("2 pm"), with minutes otherwise ("2:30 pm").
  function timeAxis(ts) {
    const d = new Date(ts); const h = d.getHours(), m = d.getMinutes();
    if (m === 0) return hourFull(h);
    return timeOfDay(ts);
  }
  // Short weekday names; 0 is Sunday, matching JavaScript's getDay().
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Short date label such as "Fri 10/16".
  const dateShort = (ts) => { const d = new Date(ts); return WD[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate(); };
  // With two or more plain lines the colors alone are not enough for a colour-blind reader or a black-and-white print, so
  // the second, third and fourth line get a dashed, dotted and dash-dot pattern. Bands, areas, stacked charts and charts with fewer lines stay solid.
  function autoDash(spec, s, i) {
    const list = Array.isArray(spec.series) ? spec.series : [];
    const plain = list.filter((x) => x && x.kind !== 'band' && !x.area).length;
    if (spec.stacked || s.area || s.kind === 'band' || plain < 2) return null;
    return [null, '9 4', '2 4', '9 4 2 4'][i % 4];
  }
  // Gram axis label: "850 g" below a thousand, "1.5 kg" from there.
  const fmtGAxis = (v) => (!isNum(v) ? '-' : U.units && U.units.weight === 'lb' && U.weightText ? U.weightText(v) : Math.abs(v) >= 1000 ? trim0((v / 1000).toFixed(1)) + ' kg' : Math.round(v) + ' g');

  // Named formats for spec.format. full is the exact tooltip text, axis the short tick-label text, steps
  // the preferred tick spacings, scale converts the value before ticking (pct holds 0..1, ticks in whole
  // percents).
  const F = (C.formats = {
    // num: plain numbers. int: whole numbers with tidy tick steps (1, 2, 5, 10 ...).
    num: { full: numFull, axis: (v, step) => compact(v, step != null ? M.decimals(step) : null) },
    int: { full: (v) => fmtN(Math.round(v), 0), axis: (v) => compact(Math.round(v), 0), steps: [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000] },
    // pct: a 0..1 fraction shown as a percent. pct100: a value already in percent.
    pct: { full: (v) => (isNum(v) ? trim0((v * 100).toFixed(Math.abs(v * 100) < 10 ? 1 : 0)) + '%' : '-'), axis: (v) => Math.round(v * 100) + '%', scale: 100, steps: [1, 2, 5, 10, 20, 25, 50, 100, 200] },
    pct100: { full: (v) => (isNum(v) ? trim0(v.toFixed(Math.abs(v) < 10 ? 1 : 0)) + '%' : '-'), axis: (v) => Math.round(v) + '%', steps: [1, 2, 5, 10, 20, 25, 50, 100, 200] },
    // money: dollars, whole dollars from 100 up. dur: durations in milliseconds.
    money: { full: (v) => (U.fmtMoney ? U.fmtMoney(v, Math.abs(v) >= 100 ? 0 : 2) : '$' + numFull(v)), axis: (v) => (isNum(v) ? (v < 0 ? '-' : '') + ((U.currencySymbol && U.currencySymbol()) || '$') + compact(Math.abs(v), 0) : '-') },
    dur: { full: fmtDurMs, axis: durAxis, steps: M.MS_STEPS },
    // durS: durations in seconds. clock: elapsed clock text such as 05:14 from milliseconds.
    durS: { full: (s) => fmtDurMs(s * 1000), axis: (s) => durAxis(s * 1000), steps: M.SEC_STEPS },
    clock: { full: (ms) => (U.fmtClock ? U.fmtClock(ms) : durAxis(ms)), axis: durAxis, steps: M.MS_STEPS },
    // g: weights in the chosen unit (stored as grams). temp: degrees in the chosen unit (stored as F).
    g: { full: (v) => (U.weightText ? U.weightText(v) : U.fmtG ? U.fmtG(v) : numFull(v) + ' g'), axis: fmtGAxis },
    temp: { full: (v) => (U.tempText ? U.tempText(v) : U.fmtTemp ? U.fmtTemp(v) : Math.round(v) + '°F'), axis: (v) => (U.tempShown ? U.tempShown(v) : Math.round(v)) + '°' },
    // hour: decimal service-day hours. time: timestamp as clock time. date: timestamp as a short date.
    hour: { full: hourFull, axis: hourAxis, steps: M.HOUR_STEPS },
    time: { full: timeOfDay, axis: timeAxis },
    date: { full: dateShort, axis: dateShort },
    // compact: K/M/B text on the axis, full precision in tooltips.
    compact: { full: numFull, axis: (v) => compact(v) },
  });
  M.fmt = { numFull, compact, durAxis, hourFull, timeAxis, dateShort, fmtGAxis };

  /** Resolve spec.format: function, named format, or { full, axis } object. Always returns { full, axis, steps?, scale? }. */
  function resolveFormat(f, fallback) {
    if (typeof f === 'function') return { full: (v) => String(f(v)), axis: (v) => String(f(v)), custom: true };
    if (typeof f === 'string' && F[f]) return F[f];
    if (f && typeof f === 'object' && typeof f.full === 'function') return { axis: f.full, ...f };
    return fallback || F.num;
  }
  C.resolveFormat = resolveFormat;
  // SB.charts.formatValue(format, v): text for one value in any format (name, function or object).
  C.formatValue = (format, v) => resolveFormat(format).full(v);

  /** Ticks for a value axis in format `fmt` over [min, max]. Handles scaled formats (pct 0..1 ticks every 10 %). */
  function valueTicks(fmt, min, max, count, opts) {
    const sc = fmt.scale || 1;
    const t = M.niceTicks(min * sc, max * sc, count, { steps: fmt.steps, fixMin: opts && opts.fixMin != null ? opts.fixMin * sc : undefined, fixMax: opts && opts.fixMax != null ? opts.fixMax * sc : undefined, nice: opts && opts.nice });
    if (sc !== 1) return { min: fix(t.min / sc), max: fix(t.max / sc), step: fix(t.step / sc), ticks: t.ticks.map((v) => fix(v / sc)), decimals: t.decimals };
    return t;
  }
  M.valueTicks = valueTicks;

  /* =====================================================================================================
   * 3. TOKENS, SLOTS AND TONES
   * ===================================================================================================== */
  // Short name for every colour token and the CSS variable that holds it.
  const TOKEN = { text: '--ch-text', text2: '--ch-text2', axis: '--ch-axis', grid: '--ch-grid', surface: '--ch-surface', track: '--ch-track', tipBg: '--ch-tip-bg', muted: '--ch-muted', ok: '--ch-ok', warn: '--ch-warn', serious: '--ch-serious', bad: '--ch-bad' };
  for (let i = 1; i <= 8; i++) TOKEN['cat' + i] = '--ch-' + i;
  for (let i = 1; i <= 7; i++) TOKEN['seq' + i] = '--ch-seq-' + i;
  ['n3', 'n2', 'n1', 'p1', 'p2', 'p3'].forEach((k) => { TOKEN['div' + k] = '--ch-div-' + k; });
  TOKEN.div0 = '--ch-div-0';
  /* Fallbacks = the ember theme, so a chart still draws if 40-charts.css is missing. */
  const FALLBACK = { text: '#EEE6D6', text2: '#BCB3A4', axis: '#766E66', grid: '#332D28', surface: '#211D1A', track: '#332D28', tipBg: '#2B2622', muted: '#958D83', ok: '#5AC485', warn: '#EBBE42', serious: '#F28E42', bad: '#F66D67',
    cat1: '#D26E23', cat2: '#4A72B6', cat3: '#5AA87A', cat4: '#906B02', cat5: '#9D598A', cat6: '#07A6A8', cat7: '#7A6DBC', cat8: '#CC7168',
    seq1: '#804536', seq2: '#A65438', seq3: '#C96736', seq4: '#EA7D2E', seq5: '#FD9D48', seq6: '#FEC080', seq7: '#FEDDB2',
    divn3: '#5AA4E8', divn2: '#4982B6', divn1: '#3F6181', div0: '#44403D', divp1: '#7B533B', divp2: '#AC6B42', divp3: '#DB8650' };
  // The var(--ch-...) text for a palette key, so marks repaint at once when the theme changes.
  const css = (key) => 'var(' + TOKEN[key] + ')';

  /* Entities keep their colour everywhere (colour follows the entity, never its rank). Pass series.slot / series.tone to override. */
  const ENTITY = {
    dine_in: 1, takeout: 2, drive_thru: 3, third_party: 4,           // order channels
    pit: 1, sides: 2, fry: 3, cold: 4, expo: 5,                       // stations
    hold: 'muted', response: 5, work: 6, dwell: 7,                    // ticket anatomy: pacing hold is by design, so it recedes
  };
  C.entitySlots = ENTITY;

  /** tone / slot / entity id -> palette key ('cat3', 'ok', 'muted' ...) or null */
  function keyOfTone(t) {
    if (t == null || t === '') return null;
    if (typeof t === 'number') return t >= 1 && t <= 8 ? 'cat' + Math.round(t) : 'muted';
    const s = String(t);
    if (s === 'ok' || s === 'warn' || s === 'bad' || s === 'serious' || s === 'muted') return s;
    if (s === 'accent') return 'cat1';
    if (s === 'neutral' || s === 'other') return 'muted';
    if (s === 'check') return 'warn';
    if (s === 'reheat') return 'serious';
    if (s === 'discard' || s === 'breach' || s === 'over') return 'bad';
    const m = /^c([1-8])$/.exec(s); if (m) return 'cat' + m[1];
    if (Object.prototype.hasOwnProperty.call(ENTITY, s)) return keyOfTone(ENTITY[s]);
    return null;
  }
  // Picks a series' colour: its tone, else its slot (1 to 8), else its entity id (pit, takeout ...), else
  // its position (first 8 get colours, the rest grey). Returns { key, css }.
  function styleOf(s, i) {
    s = s || {};
    let key = keyOfTone(s.tone);
    if (!key && s.slot != null) key = keyOfTone(s.slot);
    if (!key && s.id != null && Object.prototype.hasOwnProperty.call(ENTITY, s.id)) key = keyOfTone(ENTITY[s.id]);
    if (!key) key = i < 8 ? 'cat' + (i + 1) : 'muted';
    return { key, css: css(key) };
  }
  // True for the four status tones (ok, warn, serious, bad), which always get a shape and a word too.
  const isStatus = (k) => k === 'ok' || k === 'warn' || k === 'serious' || k === 'bad';
  // Hatch-pattern number for a categorical key ('cat3' gives 2); -1 for any other colour (no hatching).
  const texIndex = (key) => (key && key.slice(0, 3) === 'cat' ? +key.slice(3) - 1 : -1);
  const WORDS = { ok: 'On track', warn: 'Watch', serious: 'Act now', bad: 'Over limit' };
  // The word shown with a status tone: the chart's own words if given, else the default.
  const wordFor = (tone, words) => (words && words[tone]) || WORDS[tone] || '';

  // Reads every colour token from an element's computed style (falling back to the built-in ember colours)
  // and guesses the theme from the surface brightness.
  function readPalette(el) {
    const by = {};
    let cs = null; try { cs = g.getComputedStyle(el); } catch (e) { cs = null; }
    for (const k in TOKEN) { const v = cs ? cs.getPropertyValue(TOKEN[k]).trim() : ''; by[k] = v || FALLBACK[k]; }
    const sur = M.parseColor(by.surface) || [30, 34, 36];
    return { by, theme: M.luminance(sur) > 0.4 ? 'paper' : 'ember' };
  }
  /** SB.charts.palette(el?) -> resolved token values for legends and swatches elsewhere in the app. */
  C.palette = function palette(el) {
    let host = el;
    if (!host && hasDOM()) host = g.document.querySelector('.office') || g.document.querySelector('.ch') || g.document.documentElement;
    const p = host ? readPalette(host) : { by: Object.assign({}, FALLBACK), theme: 'ember' };
    const b = p.by;
    return {
      theme: p.theme, surface: b.surface, text: b.text, text2: b.text2, axis: b.axis, grid: b.grid, muted: b.muted, track: b.track,
      cat: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => b['cat' + i]),
      seq: [1, 2, 3, 4, 5, 6, 7].map((i) => b['seq' + i]),
      div: { n3: b.divn3, n2: b.divn2, n1: b.divn1, zero: b.div0, p1: b.divp1, p2: b.divp2, p3: b.divp3 },
      ok: b.ok, warn: b.warn, serious: b.serious, bad: b.bad,
    };
  };
  /** SB.charts.colorFor(slotOrToneOrEntityId, el?) -> resolved colour string (for legends outside the library). */
  C.colorFor = function colorFor(t, el) {
    const k = keyOfTone(t) || 'muted';
    const p = C.palette(el); const b = readPalette(el || (hasDOM() && (g.document.querySelector('.office') || g.document.documentElement)) || {}).by;
    return (b && b[k]) || p.muted;
  };
  // SB.charts.cssVarFor(tone): the var(--ch-...) text for a tone, slot or entity id (grey if unknown).
  C.cssVarFor = function cssVarFor(t) { return css(keyOfTone(t) || 'muted'); };

  /* =====================================================================================================
   * 4. DOM HELPERS
   * ===================================================================================================== */
  // True in a browser page; false in Node, where the maths helpers still work but nothing can be drawn.
  // Charts check it before touching the page.
  const hasDOM = () => typeof g.document !== 'undefined' && !!g.document.createElement;
  // Shorthand for making an HTML element (SB.util.h).
  const H = (...a) => U.h(...a);
  // Shorthand for making an SVG element (SB.util.svg).
  const S = (...a) => U.svg(...a);
  // Rounds to one decimal place, which keeps the drawing text short.
  const r1 = (n) => Math.round(n * 10) / 10;
  // Nearest pixel centre (whole number plus 0.5) so thin lines draw crisp.
  const px = (n) => Math.round(n) + 0.5;                       // 1px lines land on a pixel centre

  /** Rounded data-end bar path. dir = side the data end points to; the baseline end stays square. 'all' rounds every corner. */
  function barPath(x, y, w, h, r, dir) {
    if (!(w > 0) || !(h > 0)) return '';
    x = r1(x); y = r1(y); w = r1(w); h = r1(h);
    const vert = dir === 'up' || dir === 'down';
    r = Math.max(0, Math.min(r, vert ? Math.min(w / 2, h) : Math.min(h / 2, w), dir === 'all' ? Math.min(w, h) / 2 : 1e9));
    if (r < 0.5 || dir === 'none') return `M${x} ${y}H${r1(x + w)}V${r1(y + h)}H${x}Z`;
    const X = r1(x + w), Y = r1(y + h);
    switch (dir) {
      case 'up': return `M${x} ${Y}V${r1(y + r)}A${r} ${r} 0 0 1 ${r1(x + r)} ${y}H${r1(X - r)}A${r} ${r} 0 0 1 ${X} ${r1(y + r)}V${Y}Z`;
      case 'down': return `M${x} ${y}H${X}V${r1(Y - r)}A${r} ${r} 0 0 1 ${r1(X - r)} ${Y}H${r1(x + r)}A${r} ${r} 0 0 1 ${x} ${r1(Y - r)}Z`;
      case 'right': return `M${x} ${y}H${r1(X - r)}A${r} ${r} 0 0 1 ${X} ${r1(y + r)}V${r1(Y - r)}A${r} ${r} 0 0 1 ${r1(X - r)} ${Y}H${x}Z`;
      case 'left': return `M${X} ${y}H${r1(x + r)}A${r} ${r} 0 0 0 ${x} ${r1(y + r)}V${r1(Y - r)}A${r} ${r} 0 0 0 ${r1(x + r)} ${Y}H${X}Z`;
      default: return `M${r1(x + r)} ${y}H${r1(X - r)}A${r} ${r} 0 0 1 ${X} ${r1(y + r)}V${r1(Y - r)}A${r} ${r} 0 0 1 ${r1(X - r)} ${Y}H${r1(x + r)}A${r} ${r} 0 0 1 ${x} ${r1(Y - r)}V${r1(y + r)}A${r} ${r} 0 0 1 ${r1(x + r)} ${y}Z`;
    }
  }
  M.barPath = barPath;

  /** Status glyph centred on 0,0 (about 14 units across): circle-check, triangle, hexagon, diamond-x. Always paired with a word elsewhere. */
  function glyphG(tone, scale) {
    const k = scale || 1;
    const grp = S('g', { transform: k === 1 ? null : `scale(${k})`, 'aria-hidden': 'true' });
    const fill = 'fill:' + css(tone === 'ok' || tone === 'warn' || tone === 'serious' || tone === 'bad' ? tone : 'muted');
    const ink = 'stroke:var(--ch-surface);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round';
    if (tone === 'ok') {
      grp.append(S('circle', { r: 6.5, style: fill }), S('path', { d: 'M-3 .2L-.9 2.5L3.2 -2.3', style: ink }));
    } else if (tone === 'warn') {
      grp.append(S('path', { d: 'M0 -6.8L7 5.4H-7Z', style: fill + ';stroke:' + css('warn') + ';stroke-width:1;stroke-linejoin:round' }), S('path', { d: 'M0 -2.4V1.4', style: ink }), S('circle', { cx: 0, cy: 3.4, r: 0.9, style: 'fill:var(--ch-surface)' }));
    } else if (tone === 'serious') {
      grp.append(S('path', { d: 'M-3.4 -6.2H3.4L6.8 0L3.4 6.2H-3.4L-6.8 0Z', style: fill }), S('path', { d: 'M0 -2.8V1.2', style: ink }), S('circle', { cx: 0, cy: 3.2, r: 0.9, style: 'fill:var(--ch-surface)' }));
    } else if (tone === 'bad') {
      grp.append(S('path', { d: 'M0 -7L7 0L0 7L-7 0Z', style: fill }), S('path', { d: 'M-2.4 -2.4L2.4 2.4M2.4 -2.4L-2.4 2.4', style: ink }));
    } else {
      grp.append(S('circle', { r: 3.5, style: fill }));
    }
    return grp;
  }
  // Wraps a status glyph in its own small SVG (14 px by default), for legends and tooltips.
  function glyphSvg(tone, size) {
    const s = size || 14;
    return S('svg', { width: s, height: s, viewBox: '-7.5 -7.5 15 15', class: 'ch-sw', 'aria-hidden': 'true', focusable: 'false' }, glyphG(tone));
  }

  /** Canvas-measured text width (re-measured after web fonts load). */
  let mctx; const mcache = new Map();
  function textWidth(text, font) {
    text = String(text);
    if (mctx === undefined) { try { mctx = g.document.createElement('canvas').getContext('2d') || null; } catch (e) { mctx = null; } }
    // No canvas (Node or an old browser): guess 6.6 px per character.
    if (!mctx) return text.length * 6.6;
    const key = font + '|' + text;
    let w = mcache.get(key);
    if (w === undefined) { mctx.font = font; w = mctx.measureText(text).width; if (mcache.size > 4000) mcache.clear(); mcache.set(key, w); }
    return w;
  }

  /* =====================================================================================================
   * 5. THE CHART BASE: skeleton (header, legend, plot, table twin, tooltip), lifecycle, hover/keyboard plumbing
   * ===================================================================================================== */
  // TYPES holds each chart type's definition (model, draw, legend, table); LIVE is the charts on screen.
  const TYPES = {};
  const LIVE = new Set();
  // UID numbers charts for unique element ids; TEXTURE: hatching on everywhere; GLOBALS: page listeners
  // installed; ACTIVE_TIP: the chart whose tooltip is open (one at a time).
  let UID = 0, TEXTURE = false, GLOBALS = false, ACTIVE_TIP = null;

  // Small bar-chart icon shown beside the "No data" and error messages.
  const EMPTY_ICON = () => S('svg', { width: 22, height: 22, viewBox: '0 0 22 22', fill: 'none', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'aria-hidden': 'true' },
    S('path', { d: 'M3 18.5H19' }), S('path', { d: 'M6 15V11M11 15V6M16 15V9' }));

  // Installs the page-wide listeners once: hide tooltips on outside tap, scroll, Escape or resize; repaint
  // when the theme attribute changes or web fonts load.
  function setupGlobals() {
    if (GLOBALS || !hasDOM()) return;
    GLOBALS = true;
    const d = g.document;
    d.addEventListener('pointerdown', (e) => { for (const c of LIVE) if (c.tipOn && !c.root.contains(e.target)) c.tipHide(); }, true);
    d.addEventListener('scroll', () => { for (const c of LIVE) if (c.tipOn && !c.kbd) c.tipHide(); }, true);
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const c of LIVE) if (c.tipOn) c.tipHide(); }, true);
    g.addEventListener('resize', () => { for (const c of LIVE) c.tipHide(); });
    // theme toggles: only the two theme attributes are watched, so floor class churn never triggers a repaint
    if (typeof g.MutationObserver === 'function') {
      let queued = false;
      new g.MutationObserver(() => { if (queued) return; queued = true; (g.requestAnimationFrame || setTimeout)(() => { queued = false; C.refreshTheme(); }); })
        .observe(d.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-otheme', 'data-theme'] });
    }
    // Text widths change when the web font arrives, so forget saved measurements and redraw.
    if (d.fonts && d.fonts.ready) {
      const redo = () => { mcache.clear(); for (const c of LIVE) c.render(); };
      d.fonts.ready.then(redo).catch(() => {});
      if (typeof d.fonts.addEventListener === 'function') d.fonts.addEventListener('loadingdone', redo);
    }
  }

  // One chart on the page. It builds the frame, measures the width, asks its type to draw, and wires hover,
  // touch and keyboard. update(spec) REPLACES the old spec (spec is the settings object you pass in).
  class Chart {
    // WATCH OUT: a new chart destroys any chart already living in the same container.
    constructor(type, host, spec) {
      this.type = type; this.def = TYPES[type]; this.host = host; this.uid = ++UID;
      this.spec = {}; this.hidden = new Set(); this.tableOn = false; this.width = 0; this.first = true;
      this.marks = []; this.destroyed = false; this.pal = null; this.tipOn = false; this.kbd = false; this.hot = null; this.legSig = '';
      if (host.__sbChart && host.__sbChart.destroy) host.__sbChart.destroy();
      this._build();
      host.__sbChart = this;
      LIVE.add(this);
      setupGlobals();
      this.update(spec);
    }

    // Creates the empty frame: header with table button, legend, plot, "no data" message, table holder,
    // tooltip and a hidden spot that screen readers read aloud.
    _build() {
      // Unique element id for this chart, used to tie its title and table to it for screen readers.
      const id = (s) => 'ch' + this.uid + '-' + s;
      this.ids = { t: id('t'), s: id('s'), tbl: id('tbl') };
      this.titleEl = H('h3', { class: 'ch-title', id: this.ids.t, hidden: true });
      this.subEl = H('p', { class: 'ch-sub', id: this.ids.s, hidden: true });
      // The "View as table" button flips between the drawing and the data table.
      this.btn = H('button', { type: 'button', class: 'ch-tbtn', 'aria-pressed': 'false', 'aria-controls': this.ids.tbl, hidden: true, text: 'View as table', onClick: () => this.setTable(!this.tableOn) });
      this.head = H('div', { class: 'ch-head' }, H('div', { class: 'ch-titles' }, this.titleEl, this.subEl), this.btn);
      this.legendEl = H('ul', { class: 'ch-legend', role: 'list', hidden: true });
      this.plot = H('div', { class: 'ch-plot' });
      this.emptyEl = H('div', { class: 'ch-empty', role: 'status', hidden: true });
      this.tblWrap = H('div', { class: 'ch-tblwrap', id: this.ids.tbl, tabindex: '0', role: 'region', hidden: true });
      this.tip = H('div', { class: 'ch-tip', role: 'tooltip', hidden: true });
      this.sr = H('div', { class: 'ch-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
      this.root = H('figure', { class: 'ch ch--' + this.type, 'data-chart': this.type }, this.head, this.legendEl, this.plot, this.emptyEl, this.tblWrap, this.tip, this.sr);
      this.host.appendChild(this.root);
      // Redraw when the plot width changes (once per animation frame); sparklines have a fixed width.
      if (typeof g.ResizeObserver === 'function') {
        this.ro = new g.ResizeObserver(() => {
          if (this.destroyed) return;
          const w = Math.floor(this.plot.clientWidth);
          if (w > 0 && Math.abs(w - this.width) >= 1 && !this.def.fixedWidth) { if (this._raf) return; this._raf = (g.requestAnimationFrame || setTimeout)(() => { this._raf = 0; this.render(); }); }
        });
        this.ro.observe(this.plot);
      }
    }

    // ----- public methods: update, destroy, api and setTable -----
    // Replaces the spec (when one is given) and redraws.
    update(spec) { if (spec !== undefined) this.spec = spec || {}; this.render(); }
    // Removes the chart from the page and stops watching it; safe to call twice.
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true; LIVE.delete(this);
      if (this.ro) this.ro.disconnect();
      if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
      if (this.host.__sbChart === this) this.host.__sbChart = null;
    }
    // The handle given to callers: update, destroy, the root element, the type name and setTable.
    api() { const c = this; return { update: (s) => c.update(s), destroy: () => c.destroy(), el: c.root, type: c.type, setTable: (on) => c.setTable(on) }; }

    // Switches between the drawing and the data table, then redraws.
    setTable(on) {
      this.tableOn = !!on;
      this.btn.setAttribute('aria-pressed', this.tableOn ? 'true' : 'false');
      this.render();
    }

    /* ----- measuring ----- */
    // Pixel width of text in this chart's font (size 12, weight 400 by default), plus half a pixel of
    // slack.
    tw(text, size, weight) { return textWidth(text, (weight || 400) + ' ' + (size || 12) + 'px ' + this.fam) + 0.5; }
    /** Fit text into maxW: returns the text, or a truncated version ending in an ellipsis. */
    fit(text, maxW, size, weight) {
      text = String(text == null ? '' : text);
      if (this.tw(text, size, weight) <= maxW) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.tw(text.slice(0, mid) + '…', size, weight) <= maxW) lo = mid; else hi = mid - 1; }
      return lo > 0 ? text.slice(0, lo).replace(/\s+$/, '') + '…' : '…';
    }
    /** Colour of a palette key, resolved. */
    hex(key) { return (this.pal && this.pal.by[key]) || FALLBACK[key] || '#888888'; }
    /** Ink (text token or surface) that reads best on a coloured fill. */
    inkOn(key) { const b = this.pal.by; return M.pickInk(b[key] || FALLBACK[key], b.text, b.surface) === b.text ? css('text') : css('surface'); }

    // ----- render pipeline: render, _fail, _setHeader, _setLegend, _showEmpty, _render -----
    // Redraws the chart; if anything throws, an error message replaces the plot so the page keeps working.
    render() {
      if (this.destroyed) return;
      try { this._render(); } catch (err) { this._fail(err); }
    }
    // Logs the error and shows "This chart could not be drawn" instead of the plot; the data is untouched.
    _fail(err) {
      try { if (g.console && g.console.error) g.console.error('[smokebox charts] ' + this.type + ' failed to draw:', err); } catch (e) { /* ignore */ }
      U.clear(this.plot); this.tableOn = false;
      this.emptyEl.hidden = false; U.clear(this.emptyEl);
      this.emptyEl.append(EMPTY_ICON(), H('span', { text: 'This chart could not be drawn. The data is unchanged.' }));
    }

    // Fills in title, subtitle and table button; returns whether the table view is available.
    _setHeader(spec, def, model) {
      const title = spec.title ? String(spec.title) : '', sub = spec.sub && !def.ownSub ? String(spec.sub) : '';
      this.titleEl.textContent = title; this.titleEl.hidden = !title;
      this.subEl.textContent = sub; this.subEl.hidden = !sub;
      const canTable = def.table && spec.table !== false && !(def.tableOptIn && spec.table !== true) && !model.empty;
      this.btn.hidden = !canTable;
      this.head.hidden = !title && !sub && !canTable;
      if (title && spec.level) this.titleEl.setAttribute('aria-level', String(spec.level));
      if (title) this.root.setAttribute('aria-labelledby', this.ids.t + (sub ? ' ' + this.ids.s : '')); else this.root.removeAttribute('aria-labelledby');
      if (!title) this.root.setAttribute('aria-label', spec.ariaLabel || (def.noun || this.type) + ' chart'); else this.root.removeAttribute('aria-label');
      return canTable;
    }

    // Builds the legend (rebuilt only when its items change). Hidden for one item unless spec.legend is
    // true, and while the table shows.
    _setLegend(items, spec) {
      const show = items && items.length && (items.length >= 2 || spec.legend === true) && spec.legend !== false && !this.tableOn;
      if (!show) { this.legendEl.hidden = true; this.legSig = ''; return; }
      const sig = items.map((i) => i.id + '|' + i.name + '|' + i.css + '|' + (i.kind || '') + '|' + (i.shape || '')).join('~');
      if (sig !== this.legSig) {
        this.legSig = sig; U.clear(this.legendEl);
        for (const it of items) {
          const sw = legendSwatch(it, this);
          const label = H('span', { text: it.name });
          let btn;
          if (it.static || items.length < 2) {
            btn = H('span', { class: 'ch-lg', 'data-static': '' }, sw, label);
          } else {
            // Clicking a legend entry hides or shows that series.
            btn = H('button', { type: 'button', class: 'ch-lg', 'aria-pressed': 'true', 'data-id': it.id, onClick: (e) => this._toggleSeries(it.id, items, e) }, sw, label);
          }
          this.legendEl.appendChild(H('li', null, btn));
        }
      }
      this.legendEl.querySelectorAll('button[data-id]').forEach((b) => b.setAttribute('aria-pressed', this.hidden.has(b.getAttribute('data-id')) ? 'false' : 'true'));
      this.legendEl.hidden = false;
    }
    // Shift or alt click shows only that series (again shows all); the last visible one cannot be hidden.
    _toggleSeries(id, items, e) {
      const visible = items.filter((i) => !this.hidden.has(i.id) && !i.static);
      if (e && (e.shiftKey || e.altKey)) {                      // shift-click isolates one series; shift-click again shows all
        const only = visible.length === 1 && visible[0].id === id;
        this.hidden.clear(); if (!only) items.forEach((i) => { if (i.id !== id) this.hidden.add(i.id); });
      } else if (this.hidden.has(id)) this.hidden.delete(id);
      else if (visible.length > 1) this.hidden.add(id);
      else return;
      const active = g.document.activeElement && g.document.activeElement.getAttribute && g.document.activeElement.getAttribute('data-id');
      this.render();
      if (active) { const b = this.legendEl.querySelector('button[data-id="' + (g.CSS && g.CSS.escape ? g.CSS.escape(active) : active) + '"]'); if (b) b.focus(); }
      if (this.spec.onLegend) { try { this.spec.onLegend({ hidden: Array.from(this.hidden) }); } catch (err) { /* page callback must not break the chart */ } }
    }

    // Shows the "No data" message (spec.empty changes the text) in place of the plot and legend.
    _showEmpty(spec) {
      U.clear(this.plot); U.clear(this.emptyEl);
      this.emptyEl.append(EMPTY_ICON(), H('span', { text: spec.empty || 'No data in this range' }));
      const hh = isNum(spec.height) ? Math.min(spec.height, 220) : (this.def.emptyHeight || 140);
      this.emptyEl.style.minHeight = hh + 'px';
      this.emptyEl.hidden = false; this.plot.hidden = true; this.tblWrap.hidden = true; this.legendEl.hidden = true;
    }

    // The main draw. Steps: build the model from the spec, fill header and legend, then show the empty
    // message, the table, or the SVG drawn at the measured width.
    _render() {
      const spec = this.spec || {}, def = this.def;
      if (!this.pal) this.pal = readPalette(this.root);
      this.fam = (g.getComputedStyle ? g.getComputedStyle(this.root).fontFamily : '') || 'system-ui, sans-serif';
      this.root.dataset.texture = spec.texture === true || TEXTURE ? 'on' : 'off';
      this.tipHide();
      const model = def.model(spec, this);
      this.model = model;
      const canTable = this._setHeader(spec, def, model);
      if (!canTable && this.tableOn) { this.tableOn = false; this.btn.setAttribute('aria-pressed', 'false'); }
      if (model.empty) { this._showEmpty(spec); this.marks = []; return; }
      this.emptyEl.hidden = true; this.plot.hidden = false;
      this._setLegend(def.legend ? def.legend(model, this) : [], spec);
      if (this.tableOn) {
        this.plot.hidden = true; this.tblWrap.hidden = false;
        this._renderTable(def.table(model, this));
        return;
      }
      this.tblWrap.hidden = true;
      const w = def.fixedWidth ? def.fixedWidth(spec) : Math.floor(this.plot.clientWidth);
      if (!(w > 0)) return;                                     // hidden or not laid out yet: the ResizeObserver calls us back
      this.width = w;
      this.marks = []; this.hot = null; this.kbdIdx = 0; this.texBudget = 400; this.defs = null;
      const svg = S('svg', { class: 'ch-svg', role: 'group', focusable: 'false' });
      const h = def.draw(this, model, svg, w);
      svg.setAttribute('width', String(w)); svg.setAttribute('height', String(Math.ceil(h)));
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + Math.ceil(h));
      if (!svg.getAttribute('aria-label')) svg.setAttribute('aria-label', (spec.title || def.noun || this.type) + (model.summary ? '. ' + model.summary : ''));
      U.clear(this.plot); this.plot.appendChild(svg);
      this.svg = svg;
      this._wire(svg);
      // First draw only: a short reveal animation, skipped for reduced motion or when spec.animate is
      // false.
      if (this.first) {
        this.first = false;
        if (!(U.prefersReducedMotion && U.prefersReducedMotion()) && spec.animate !== false) {
          this.root.classList.add('ch--enter');
          setTimeout(() => { if (!this.destroyed) this.root.classList.remove('ch--enter'); }, 450);
        }
      }
    }

    // ----- table twin: the data table shown instead of the drawing -----
    // Fills the table from { head, rows }. Shows at most 500 rows and says so in a caption.
    _renderTable(t) {
      const wrap = this.tblWrap; U.clear(wrap);
      const MAX = 500;
      const rows = t.rows || [];
      const tbl = H('table', { class: 'ch-tbl', 'aria-label': (this.spec.title || this.type) + ' as a table' });
      const tr0 = H('tr');
      (t.head || []).forEach((c) => tr0.appendChild(H('th', { scope: 'col', text: c == null ? '' : String(c) })));
      tbl.appendChild(H('thead', null, tr0));
      const tb = H('tbody');
      for (let i = 0; i < Math.min(rows.length, MAX); i++) {
        const tr = H('tr');
        rows[i].forEach((c, j) => tr.appendChild(H(j === 0 ? 'th' : 'td', j === 0 ? { scope: 'row', text: c == null ? '' : String(c) } : { text: c == null ? '-' : String(c) })));
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      const notes = [];
      if (rows.length > MAX) notes.push('Showing the first ' + MAX + ' of ' + grp(String(rows.length)) + ' rows.');
      if (t.note) notes.push(t.note);
      if (notes.length) tbl.appendChild(H('caption', { text: notes.join(' ') }));
      wrap.appendChild(tbl);
      wrap.setAttribute('aria-label', (this.spec.title || this.type) + ' data table');
    }

    // Registers one hoverable shape (m.el) with its tooltip (m.tip), screen-reader label (m.label), shapes
    // to highlight (m.vis) and onSelect value (m.select). Returns its index.
    addMark(m) {
      const i = this.marks.length;
      this.marks.push(m);
      const el = m.el;
      el.setAttribute('data-m', String(i));
      el.classList.add('ch-m');
      if (m.focus !== false) {
        el.setAttribute('tabindex', '-1');
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', m.label || (m.tip && m.tip.head) || '');
      }
      return i;
    }
    /** Defs + a hatch overlay for categorical fills (opt-in texture: 45 / 135 degrees, never decorative). Returns the overlay or null. */
    texture(svg, parent, d, key, before) {
      const k = texIndex(key);
      if (k < 0 || this.texBudget-- <= 0) return null;
      if (!this.defs) { this.defs = S('defs'); svg.insertBefore(this.defs, svg.firstChild); }
      const pid = 'ch' + this.uid + '-tx' + k;
      if (!this.defs.querySelector('#' + pid)) {
        const sp = [8, 6.5, 5, 3.5][k >> 1] || 6;
        this.defs.appendChild(S('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: sp, height: sp, patternTransform: 'rotate(' + (k % 2 ? 135 : 45) + ')' },
          S('line', { x1: 0, y1: 0, x2: 0, y2: sp, style: 'stroke:var(--ch-surface);stroke-width:1.6;opacity:.55' })));
      }
      const o = S('path', { d, class: 'ch-tex', style: 'fill:url(#' + pid + ');pointer-events:none' });
      if (before) parent.insertBefore(o, before.nextSibling); else parent.appendChild(o);
      return o;
    }
    /** A filled bar shape with its optional hatch overlay. Returns the visible path. */
    fillShape(svg, parent, d, key, extraClass) {
      const p = S('path', { d, class: extraClass || null, style: 'fill:' + css(key) });
      parent.appendChild(p);
      this.texture(svg, parent, d, key, p);
      return p;
    }

    // Wires pointer, touch, click and keyboard handling onto the drawing, with one tab stop for the chart.
    _wire(svg) {
      const spec = this.spec;
      // Finds the registered mark an event target belongs to, if any.
      const markOf = (t) => { const el = t && t.closest ? t.closest('[data-m]') : null; return el ? this.marks[+el.getAttribute('data-m')] : null; };
      svg.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const m = markOf(e.target);
        if (m) this._hover(m, e); else if (!this.def.ownHover) this._unhover();
      });
      svg.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !this.def.ownHover) this._unhover(); });
      svg.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        const m = markOf(e.target);
        if (m && this.hot !== m) this._hover(m, e); else if (!this.def.ownHover || m) this._unhover();
      });
      svg.addEventListener('click', (e) => {
        const m = markOf(e.target);
        if (m && spec.onSelect && m.select !== undefined) { try { spec.onSelect(m.select); } catch (err) { /* page callback must not break the chart */ } }
      });
      svg.addEventListener('focusin', (e) => {
        const m = markOf(e.target);
        if (m) { this.kbd = true; this._hover(m, null, true); const i = this.marks.indexOf(m); if (i >= 0) this._rove(i, false); }
      });
      svg.addEventListener('focusout', (e) => { if (!svg.contains(e.relatedTarget)) { this.kbd = false; this._unhover(); } });
      svg.addEventListener('keydown', (e) => this._key(e, markOf(e.target)));
      // roving tabindex: one tab stop for the whole mark set
      const foc = this.marks.map((m, i) => (m.focus === false ? -1 : i)).filter((i) => i >= 0);
      this.focusable = foc;
      if (foc.length) { this.marks[foc[0]].el.setAttribute('tabindex', '0'); this.kbdIdx = 0; }
      if (this.def.wired) this.def.wired(this, this.model, svg);
    }
    // Moves the single tab stop to mark number markIdx and focuses it when asked.
    _rove(markIdx, focus) {
      const pos = this.focusable.indexOf(markIdx); if (pos < 0) return;
      this.focusable.forEach((i) => this.marks[i].el.setAttribute('tabindex', i === markIdx ? '0' : '-1'));
      this.kbdIdx = pos;
      if (focus) this.marks[markIdx].el.focus();
    }
    // Keyboard movement between marks: arrows, Home, End; Enter or Space selects (heat maps go by
    // row/column).
    _key(e, cur) {
      if (!cur || !this.focusable || !this.focusable.length) return;
      const k = e.key; const idx = this.marks.indexOf(cur); let pos = this.focusable.indexOf(idx);
      let to = pos;
      const grid = this.model && this.model.grid;
      if (grid && cur.rc) {
        const [r, c] = cur.rc; let nr = r, nc = c;
        if (k === 'ArrowRight') nc++; else if (k === 'ArrowLeft') nc--; else if (k === 'ArrowDown') nr++; else if (k === 'ArrowUp') nr--;
        else if (k === 'Home') nc = 0; else if (k === 'End') nc = grid.cols - 1;
        else if (k === 'Enter' || k === ' ') { if (this.spec.onSelect && cur.select !== undefined) { e.preventDefault(); this.spec.onSelect(cur.select); } return; }
        else return;
        const target = this.marks.findIndex((m) => m.rc && m.rc[0] === nr && m.rc[1] === nc && m.focus !== false);
        if (target < 0) { e.preventDefault(); return; }
        to = this.focusable.indexOf(target);
      } else if (k === 'ArrowRight' || k === 'ArrowDown') to = Math.min(this.focusable.length - 1, pos + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp') to = Math.max(0, pos - 1);
      else if (k === 'Home') to = 0;
      else if (k === 'End') to = this.focusable.length - 1;
      else if (k === 'Enter' || k === ' ') { if (this.spec.onSelect && cur.select !== undefined) { e.preventDefault(); try { this.spec.onSelect(cur.select); } catch (err) { /* ignore */ } } return; }
      else return;
      e.preventDefault();
      this._rove(this.focusable[to], true);
    }

    /* ----- hover + tooltip ----- */
    // Highlights a mark and shows its tooltip, anchored on the mark or the pointer as the mark asks;
    // keyboard hover also announces the label.
    _hover(m, evt, kbd) {
      if (this.hot && this.hot !== m) (this.hot.vis || []).forEach((v) => v.classList.remove('ch-hot'));
      this.hot = m;
      (m.vis || []).forEach((v) => v.classList.add('ch-hot'));
      if (!m.tip) return;
      const r = m.el.getBoundingClientRect();
      let a = { x: r.left, y: r.top, w: r.width, h: r.height };
      if (m.anchor === 'pointer' && evt) a = { x: evt.clientX, y: evt.clientY, w: 0, h: 0 };
      else if (evt && !kbd && m.follow) a = { x: clamp(evt.clientX, r.left, r.right), y: r.top, w: 0, h: r.height };
      this.tipShow(m.tip, a, m.pref || 'top');
      if (kbd) this.say(m.label || '');
    }
    // Removes the highlight and hides the tooltip.
    _unhover() {
      if (this.hot) (this.hot.vis || []).forEach((v) => v.classList.remove('ch-hot'));
      this.hot = null; this.tipHide();
    }
    // Announces text to screen readers; the spot is cleared first so a repeated message is read again.
    say(text) { this.sr.textContent = ''; setTimeout(() => { if (!this.destroyed) this.sr.textContent = text; }, 30); }

    // Shows a tooltip ({ head, rows, st, note }) by the anchor; only one tooltip is open at a time.
    tipShow(content, anchor, pref) {
      if (ACTIVE_TIP && ACTIVE_TIP !== this) ACTIVE_TIP.tipHide();
      ACTIVE_TIP = this;
      this._tipBuild(content);
      this.tipOn = true;
      this._tipPlace(anchor, pref || 'top');
    }
    // Hides the tooltip belonging to this chart.
    tipHide() { if (!this.tipOn && this.tip.hidden) return; this.tip.hidden = true; this.tipOn = false; if (ACTIVE_TIP === this) ACTIVE_TIP = null; }
    // Builds the tooltip: heading, colour-key rows, optional status shape and word, optional note.
    _tipBuild(c) {
      const el = this.tip; U.clear(el);
      if (c.head) el.appendChild(H('div', { class: 'ch-tip-h', text: c.head }));
      if (c.rows && c.rows.length) {
        const grid = H('div', { class: 'ch-tip-rows' });
        for (const r of c.rows) {
          const k = r.key;
          let keyEl;
          if (k && k.css) {
            keyEl = H('i', { class: 'ch-key' + (k.shape === 'box' ? ' ch-key--box' : k.shape === 'dot' ? ' ch-key--dot' : k.shape === 'ring' ? ' ch-key--dot ch-key--ring' : ''), style: '--k:' + k.css });
          } else keyEl = H('span');
          grid.appendChild(keyEl);
          grid.appendChild(H('span', { class: 'ch-tip-v', text: r.v == null ? '' : String(r.v) }));
          grid.appendChild(H('span', { class: 'ch-tip-k', text: r.k == null ? '' : String(r.k) }));
        }
        el.appendChild(grid);
      }
      if (c.st && c.st.tone) el.appendChild(H('div', { class: 'ch-tip-st', style: 'margin-top:4px' }, glyphSvg(c.st.tone, 13), H('span', { text: c.st.word || '' })));
      if (c.note) el.appendChild(H('div', { class: 'ch-tip-n', text: c.note }));
    }
    // Puts the fixed tooltip on the preferred side of the anchor (top, bottom, right, left), flips it if it
    // would leave the screen, and keeps it inside the view.
    _tipPlace(a, pref) {
      const tip = this.tip; tip.hidden = false;
      tip.style.left = '0px'; tip.style.top = '0px';
      const vv = g.visualViewport;
      const vw = (vv && vv.width) || g.innerWidth || 1024, vh = (vv && vv.height) || g.innerHeight || 768;
      const r0 = tip.getBoundingClientRect();
      const ox = r0.left, oy = r0.top, tw = r0.width, th = r0.height;   // ox/oy = 0 unless an ancestor re-bases position:fixed
      // 8 px kept clear of the screen edge; 12 px between the mark and the tooltip.
      const m = 8, gap = 12;
      let x, y;
      if (pref === 'right' || pref === 'left' || pref === 'rtop') {
        x = pref === 'left' ? a.x - tw - gap : a.x + a.w + gap;
        if (x + tw > vw - m) x = a.x - tw - gap;
        if (x < m) x = a.x + a.w + gap;
        y = pref === 'rtop' ? a.y : a.y + a.h / 2 - th / 2;
      } else {
        x = a.x + a.w / 2 - tw / 2;
        y = pref === 'bottom' ? a.y + a.h + gap : a.y - th - gap;
        if (pref !== 'bottom' && y < m) y = a.y + a.h + gap;
        else if (pref === 'bottom' && y + th > vh - m) y = a.y - th - gap;
      }
      x = clamp(x, m, Math.max(m, vw - tw - m)); y = clamp(y, m, Math.max(m, vh - th - m));
      tip.style.left = r1(x - ox) + 'px'; tip.style.top = r1(y - oy) + 'px';
    }
  }

  /** Legend swatch: line key for lines, square for fills, dot / ring / diamond for points. */
  function legendSwatch(it, chart) {
    const key = it.key;
    if (key && isStatus(key) && (!it.kind || it.kind === 'rect') && it.glyph !== false) return glyphSvg(key, 14);   // status colours always carry their own shape
    const s = S('svg', { class: 'ch-sw', width: it.kind === 'line' ? 18 : 12, height: 12, viewBox: it.kind === 'line' ? '0 0 18 12' : '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' });
    const fill = 'fill:' + it.css;
    if (it.kind === 'line') {
      s.appendChild(S('line', { x1: 1, y1: 6, x2: 17, y2: 6, style: 'stroke:' + it.css + ';stroke-width:2;stroke-linecap:round', 'stroke-dasharray': it.dash || null }));
      if (it.dot) s.appendChild(S('circle', { cx: 9, cy: 6, r: 3, style: fill + ';stroke:var(--ch-surface);stroke-width:1.5' }));
    } else if (it.kind === 'ring') {
      s.appendChild(S('circle', { cx: 6, cy: 6, r: 4, style: 'fill:var(--ch-surface);stroke:' + it.css + ';stroke-width:2' }));
    } else if (it.kind === 'dot' || it.kind === 'diamond' || it.kind === 'square' || it.kind === 'triangle') {
      s.appendChild(S('path', { d: pointShape(it.kind === 'dot' ? 'circle' : it.kind, 6, 6, 4.2), style: fill }));
    } else if (it.kind === 'tick') {
      s.appendChild(S('rect', { x: 4.25, y: 0.5, width: 3.5, height: 11, rx: 1.75, style: fill }));
    } else if (it.kind === 'glyph') {
      s.appendChild(S('g', { transform: 'translate(6 6) scale(.8)' }, glyphG(it.tone)));
    } else {
      const d = barPath(1, 1, 10, 10, 2, 'all');
      s.appendChild(S('path', { d, style: fill }));
      if (chart && key && texIndex(key) >= 0 && chart.root.dataset.texture === 'on') chart.texture(s, s, d, key);
    }
    return s;
  }

  /** Point marker outline centred on cx, cy with radius r: circle, square, diamond, triangle. */
  function pointShape(shape, cx, cy, r) {
    cx = r1(cx); cy = r1(cy);
    switch (shape) {
      case 'square': { const q = r1(r * 0.88); return `M${r1(cx - q)} ${r1(cy - q)}H${r1(cx + q)}V${r1(cy + q)}H${r1(cx - q)}Z`; }
      case 'diamond': { const q = r1(r * 1.25); return `M${cx} ${r1(cy - q)}L${r1(cx + q)} ${cy}L${cx} ${r1(cy + q)}L${r1(cx - q)} ${cy}Z`; }
      case 'triangle': { const q = r1(r * 1.2); return `M${cx} ${r1(cy - q)}L${r1(cx + q)} ${r1(cy + q * 0.8)}H${r1(cx - q)}Z`; }
      default: return `M${r1(cx - r)} ${cy}a${r} ${r} 0 1 0 ${r1(2 * r)} 0a${r} ${r} 0 1 0 ${r1(-2 * r)} 0Z`;
    }
  }
  const SHAPES = ['circle', 'diamond', 'square', 'triangle'];

  // ----- shared drawing atoms: text, grid lines and reference-line helpers -----
  // Makes an SVG text element at x, y; anchor is 'middle' or 'end' (default start); extra adds attributes.
  function txt(str, x, y, cls, anchor, extra) {
    const t = S('text', Object.assign({ x: r1(x), y: r1(y), class: cls || null, 'text-anchor': anchor && anchor !== 'start' ? anchor : null }, extra || null));
    t.textContent = str; return t;
  }
  // hline and vline draw a one-pixel grid or axis line, snapped to a pixel centre so it stays sharp.
  const hline = (x1, x2, y, cls) => S('line', { x1: r1(x1), x2: r1(x2), y1: px(y), y2: px(y), class: cls || 'ch-gl' });
  const vline = (x, y1, y2, cls) => S('line', { x1: px(x), x2: px(x), y1: r1(y1), y2: r1(y2), class: cls || 'ch-gl' });

  // Colour key for a reference line: its status tone if it has one, else 'muted' (grey and dashed).
  function refTone(r) { const t = keyOfTone(r && r.tone); return t === 'muted' || !t ? 'muted' : t; }


  /* =====================================================================================================
   * 6. CARTESIAN HELPERS (axes, grids, reference lines) shared by line, scatter, hist, bar, dumbbell, gantt
   * ===================================================================================================== */

  // Axis model over [dMin, dMax] along len pixels. kind: 'time', 'hour', 'sec' or plain numbers; cfg: the
  // spec's axis settings. Returns { d0, d1, ticks:[{v,label}], full(v), fmt, step }; fewer ticks when
  // labels would not fit.
  function numAxis(cfg, kind, dMin, dMax, len, o) {
    cfg = cfg || {}; o = o || {};
    const fmtDef = kind === 'time' ? F.time : kind === 'hour' ? F.hour : kind === 'sec' ? F.durS : F.num;
    const fmt = resolveFormat(cfg.format, fmtDef);
    let d0 = isNum(cfg.min) ? cfg.min : dMin, d1 = isNum(cfg.max) ? cfg.max : dMax;
    if (!isNum(d0) || !isNum(d1)) { d0 = 0; d1 = 1; }
    if (d0 > d1) { const t = d0; d0 = d1; d1 = t; }
    // All data at one value would give a zero-width axis, so open it up a little each way.
    if (d0 === d1) { const pad = kind === 'time' ? 18e5 : kind === 'hour' ? 0.5 : kind === 'sec' ? 30 : (d0 === 0 ? 1 : Math.abs(d0) * 0.1); d0 -= pad; d1 += pad; }
    const labW = o.labW || (kind === 'time' ? 64 : kind === 'hour' ? 50 : 46);
    const count = clamp(Math.floor(len / (labW + 22)) + 1, 2, o.maxTicks || 10);
    let ticks = [], step = null, labelOf;
    if (kind === 'time') {
      const tt = M.timeTicks(d0, d1, count); ticks = tt.ticks; step = tt.step;
      const multiDay = d1 - d0 > M.MS.DAY * 1.2;
      labelOf = cfg.format ? (v) => fmt.axis(v) : tt.step >= M.MS.DAY ? dateShort : multiDay ? (v) => WD[new Date(v).getDay()] + ' ' + timeAxis(v) : timeAxis;
    } else if (kind === 'hour') {
      // Whole hours get short labels, other values show minutes.
      const ht = M.hourTicks(d0, d1, count); ticks = ht.ticks; step = ht.step;
      labelOf = (v) => fmt.axis(v);
    } else if (kind === 'sec') {
      // Seconds axis: ticks follow the format's step list (30 s, 1 min ...) without widening the domain.
      const st = M.valueTicks(fmt.steps ? fmt : F.durS, d0, d1, count, { nice: false });
      ticks = st.ticks; step = st.step; labelOf = (v) => fmt.axis(v, step);
    } else {
      const nt = M.valueTicks(fmt, d0, d1, count, { fixMin: isNum(cfg.min) ? cfg.min : undefined, fixMax: isNum(cfg.max) ? cfg.max : undefined, nice: !!o.nice });
      // o.nice widens the domain out to the first and last tick.
      if (o.nice) { d0 = nt.min; d1 = nt.max; }
      ticks = nt.ticks; step = nt.step; labelOf = (v) => fmt.axis(v, step);
    }
    const full = kind === 'time' && !cfg.format
      ? (v) => ((d1 - d0 > M.MS.DAY * 1.2 ? dateShort(v) + ', ' : '') + timeOfDay(v))
      : (v) => fmt.full(v);
    return { kind, d0, d1, step, fmt, full, ticks: ticks.map((v) => ({ v, label: labelOf(v) })) };
  }

  /** Value axis (y of line/scatter/hist/bar-v, x of bar-h/stack): includes zero when asked, honours fixed min/max. */
  function valueAxis(cfg, dMin, dMax, len, o) {
    cfg = cfg || {}; o = o || {};
    const fmt = resolveFormat(o.format != null ? o.format : cfg.format, F.num);
    let lo = isNum(dMin) ? dMin : 0, hi = isNum(dMax) ? dMax : 1;
    // WATCH OUT: bars and areas (zero 'force') ignore a minimum above zero; a cut baseline makes a small bar look tiny.
    const minSet = isNum(cfg.min) && !(o.zero === 'force' && cfg.min > 0);
    if (minSet) lo = cfg.min;
    if (isNum(cfg.max)) hi = cfg.max;
    // Bars always start at zero. Lines start at zero only if the low end is under about half the high end,
    // so a line near 95 is not squashed flat.
    if (o.zero && !minSet && lo > 0 && (o.zero === 'force' || lo < 0.55 * hi)) lo = 0;
    if (o.zero && !isNum(cfg.max) && hi < 0) hi = 0;
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    const count = clamp(Math.floor(len / (o.spacing || 44)) + 1, 3, o.maxTicks || 7);
    const nt = M.valueTicks(fmt, lo, hi, count, { fixMin: minSet ? cfg.min : undefined, fixMax: isNum(cfg.max) ? cfg.max : undefined, nice: true });
    // d0 and d1 are the axis ends after rounding outward to tidy ticks; full(v) is tooltip text.
    return { d0: nt.min, d1: nt.max, step: nt.step, fmt, full: (v) => fmt.full(v), ticks: nt.ticks.map((v) => ({ v, label: fmt.axis(v, nt.step) })) };
  }

  /** Draw a y value axis: hairline grid, recessive labels, stronger zero/baseline. */
  function drawYAxis(parent, chart, ax, Y, l, r, opts) {
    opts = opts || {};
    const gg = S('g', { class: 'ch-g-y' });
    let widest = 0;
    for (const t of ax.ticks) widest = Math.max(widest, chart.tw(t.label, 12));
    for (const t of ax.ticks) {
      const y = Y(t.v);
      const isBase = Math.abs(t.v - ax.d0) < 1e-9 || (t.v === 0 && ax.d0 < 0);
      if (opts.grid !== false || isBase) gg.appendChild(hline(l, r, y, isBase ? 'ch-ax' : 'ch-gl'));
      if (opts.labels !== false) gg.appendChild(txt(t.label, l - 8, y, 'ch-t', 'end', { dy: '.35em' }));
    }
    if (opts.front || !parent.firstChild) parent.appendChild(gg); else parent.insertBefore(gg, parent.firstChild);   // grid lives behind the marks
    return widest;
  }
  /** Draw an x axis of ticks along y = yBase; thins labels that would collide and keeps end labels on the canvas. */
  function drawXAxis(parent, chart, ax, X, l, r, yBase, W, opts) {
    opts = opts || {};
    const gg = S('g', { class: 'ch-g-x' });
    let prevEnd = -1e9;
    ax.ticks.forEach((t, i) => {
      const x = X(t.v);
      if (x < l - 0.5 || x > r + 0.5) return;
      if (opts.grid) gg.appendChild(vline(x, opts.gridTop != null ? opts.gridTop : yBase - opts.gridH, yBase, 'ch-gl'));
      gg.appendChild(S('line', { x1: px(x), x2: px(x), y1: yBase, y2: yBase + 4, class: 'ch-ax' }));
      const lw = chart.tw(t.label, 12);
      let anchor = 'middle', tx = x;
      if (x - lw / 2 < 2) { anchor = 'start'; tx = Math.max(2, x - 2); }
      else if (x + lw / 2 > W - 2) { anchor = 'end'; tx = Math.min(W - 2, x + 2); }
      const x0 = anchor === 'middle' ? tx - lw / 2 : anchor === 'start' ? tx : tx - lw;
      if (x0 < prevEnd + 8) return;
      prevEnd = x0 + lw;
      gg.appendChild(txt(t.label, tx, yBase + 17, 'ch-t', anchor));
    });
    parent.insertBefore(gg, parent.firstChild);
  }

  /** Reference lines + bands: reads {y|x|value, label, tone}. Labels carry a status glyph and the word, so tone is never colour alone. */
  function drawRefLines(parent, chart, refs, o) {
    // o: { orient:'h'|'v', scale, l, r, t, b, labelSide }
    const gg = S('g', { class: 'ch-g-ref' });
    const placed = [];
    (refs || []).forEach((rf) => {
      const v = rf.value != null ? rf.value : o.orient === 'h' ? rf.y : rf.x;
      if (!isNum(v)) return;
      const tone = refTone(rf);
      const col = css(tone === 'muted' ? 'text2' : tone);
      if (o.orient === 'h') {
        const y = o.scale(v);
        if (y < o.t - 1 || y > o.b + 1) return;
        if (o.part !== 'labels') gg.appendChild(S('line', { x1: o.l, x2: o.r, y1: r1(y), y2: r1(y), class: 'ch-rf', style: 'stroke:' + col, 'stroke-dasharray': tone === 'muted' ? '5 4' : null }));
        if (rf.label && o.part !== 'lines') {
          const lw = chart.tw(rf.label, 12) + (tone !== 'muted' ? 16 : 0);
          let ly = y - 6; if (ly < o.t + 8) ly = y + 15;
          // avoid stacking two labels on top of each other
          for (const p of placed) if (Math.abs(p - ly) < 14) ly = ly < y ? y + 15 : y - 6;
          placed.push(ly);
          const x1 = o.r - 2;
          const grp = S('g');
          if (tone !== 'muted') grp.appendChild(S('g', { transform: `translate(${r1(x1 - lw + 6)} ${r1(ly - 4)}) scale(.78)` }, glyphG(tone)));
          grp.appendChild(txt(rf.label, x1, ly, 'ch-lbl ch-halo', 'end'));
          gg.appendChild(grp);
        }
      } else {
        const x = o.scale(v);
        if (x < o.l - 1 || x > o.r + 1) return;
        if (o.part !== 'labels') gg.appendChild(S('line', { y1: o.t, y2: o.b, x1: r1(x), x2: r1(x), class: 'ch-rf', style: 'stroke:' + col, 'stroke-dasharray': tone === 'muted' ? '5 4' : null }));
        if (rf.label && o.part !== 'lines') {
          const lw = chart.tw(rf.label, 12) + (tone !== 'muted' ? 16 : 0);
          const right = x + 6 + lw <= o.r + 4;
          const tx = right ? x + 6 + (tone !== 'muted' ? 14 : 0) : x - 6;
          const ty = (o.labelAbove ? o.t - 6 : o.t + 12) + (o.labelAbove ? -15 : 15) * (placed.filter((p) => Math.abs(p[0] - x) < lw + 20).length);
          placed.push([x, ty]);
          const grp = S('g');
          if (tone !== 'muted') grp.appendChild(S('g', { transform: `translate(${r1(right ? x + 12 : x - 6 - lw + 6)} ${r1(ty - 4)}) scale(.78)` }, glyphG(tone)));
          grp.appendChild(txt(rf.label, tx, ty, 'ch-lbl ch-halo', right ? 'start' : 'end'));
          gg.appendChild(grp);
        }
      }
    });
    parent.appendChild(gg);
    return gg;
  }

  /* =====================================================================================================
   * 7. LINE (also area, band, stacked area)
   * spec: { series:[{id,name,points:[[x,y],...],area?,dash?,tone?,slot?,kind?:'line'|'band'}], x:{type:'time'|'hour'|'linear'|'cat',format,min,max,label,categories},
   *         y:{min,max,format,label,zero}, bands:[{x0,x1,label}], bandY:[{y0,y1,label}], refLines:[{y|x,label,tone}], annotations:[{x,y,label,tone}],
   *         stacked?, markers?:'auto'|'all'|'none', height?, title, sub, ... }
   * ===================================================================================================== */
  // Cleans the spec: works out the x type (categories, time, hours or numbers), makes each series sorted
  // points, and marks the chart empty if nothing can be plotted.
  function lineModel(spec, chart) {
    const xc = spec.x || {};
    const list = Array.isArray(spec.series) ? spec.series.filter((s) => s && Array.isArray(s.points)) : [];
    let type = xc.type;
    if (!type) type = list.some((s) => s.points.some((p) => p && typeof p[0] === 'string')) ? 'cat' : 'linear';
    const cats = [];
    if (type === 'cat') {
      if (Array.isArray(xc.categories)) xc.categories.forEach((c) => cats.push(String(c)));
      else list.forEach((s) => s.points.forEach((p) => { if (p && typeof p[0] === 'string' && cats.indexOf(p[0]) < 0) cats.push(p[0]); }));
    }
    const catIdx = new Map(cats.map((c, i) => [c, i]));
    const series = list.map((s, i) => {
      const st = styleOf(s, i);
      const band = s.kind === 'band';
      const pts = [];
      for (const p of s.points) {
        if (!p) continue;
        let x = p[0];
        if (type === 'cat') x = typeof x === 'string' ? (catIdx.has(x) ? catIdx.get(x) : NaN) : x;
        if (!isNum(x)) continue;
        const y = isNum(p[1]) ? p[1] : null;
        if (band) { if (isNum(p[1]) && isNum(p[2])) pts.push({ x, y: Math.min(p[1], p[2]), y2: Math.max(p[1], p[2]) }); }
        else pts.push({ x, y });
      }
      // Series can arrive in any order, but drawing and hover need x ascending.
      let sorted = true; for (let k = 1; k < pts.length; k++) if (pts[k].x < pts[k - 1].x) { sorted = false; break; }
      if (!sorted) pts.sort((a, b) => a.x - b.x);
      const id = s.id != null ? String(s.id) : 'series' + i;
      return { id, name: s.name != null ? String(s.name) : id, key: st.key, css: st.css, area: !!s.area || !!spec.stacked, dash: s.dash ? '6 4' : autoDash(spec, s, i), band, pts, hidden: chart.hidden.has(id), raw: s };
    });
    const vis = series.filter((s) => !s.hidden);
    const has = vis.some((s) => s.pts.some((p) => p.y != null));
    const xsAll = M.unionSorted(vis.map((s) => s.pts.filter((p) => p.y != null).map((p) => p.x)));
    return { type, cats, series, vis, xsAll, empty: !series.length || !has, summary: has ? vis.map((s) => s.name).join(', ') + ' over ' + (type === 'cat' ? cats.length + ' categories' : xsAll.length + ' points') : '' };
  }

  /** Linear interpolation of a series at x (used for stacked areas whose x positions differ). */
  function interpAt(pts, x) {
    if (!pts.length) return null;
    const n = pts.length; if (x < pts[0].x || x > pts[n - 1].x) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].x <= x) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi];
    if (a.y == null || b.y == null) return a.x === x ? a.y : b.x === x ? b.y : null;
    return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }

  // SVG path text for a line through the points; a missing value lifts the pen so the line breaks there.
  function linePath(xs, ys, X, Y) {
    let d = '', pen = false;
    for (let i = 0; i < xs.length; i++) {
      if (ys[i] == null || !isNum(ys[i])) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + r1(X(xs[i])) + ' ' + r1(Y(ys[i]));
      pen = true;
    }
    return d;
  }

  // Draws line, area, band and stacked-area charts plus the hover layer; returns the height. kind 'band'
  // draws a shaded range; spec.stacked stacks areas.
  function lineDraw(chart, m, svg, W) {
    const spec = chart.spec, xc = spec.x || {}, yc = spec.y || {};
    const vis = m.vis;
    const stacked = !!spec.stacked;
    const H0 = isNum(spec.height) ? spec.height : W < 420 ? 230 : 270;
    // x domain
    let dMin = Infinity, dMax = -Infinity;
    if (m.type === 'cat') { dMin = -0.5; dMax = Math.max(0.5, m.cats.length - 0.5); }
    else {
      m.xsAll.forEach((x) => { if (x < dMin) dMin = x; if (x > dMax) dMax = x; });
      (spec.bands || []).forEach((b) => { if (b && isNum(b.x0)) { dMin = Math.min(dMin, b.x0); } if (b && isNum(b.x1)) dMax = Math.max(dMax, b.x1); });
      (spec.refLines || []).forEach((r) => { if (r && isNum(r.x)) { dMin = Math.min(dMin, r.x); dMax = Math.max(dMax, r.x); } });
    }
    // stacked layout on the union of x
    let stack = null;
    if (stacked) {
      const xs = m.xsAll;
      // Stacking needs every series at the same x values, so missing ones are filled in by interpolation.
      // WATCH OUT: a gap still stacks as 0 so the layers stay closed, but it is remembered so the tooltip says
      // "no data" for it instead of a real-looking 0.
      const miss = vis.map((s) => xs.map((x) => interpAt(s.pts, x) == null));
      const vals = vis.map((s) => xs.map((x) => { const v = interpAt(s.pts, x); return v == null ? 0 : Math.max(0, v); }));
      stack = M.stackLayout(vals, xs.length); stack.xs = xs; stack.miss = miss;
    }
    // y domain: the lowest and highest values any series, band, reference line or annotation needs.
    let yLo = Infinity, yHi = -Infinity;
    const see = (v) => { if (isNum(v)) { if (v < yLo) yLo = v; if (v > yHi) yHi = v; } };
    if (stacked) { stack.pos.forEach(see); see(0); }
    else vis.forEach((s) => s.pts.forEach((p) => { see(p.y); if (s.band) see(p.y2); }));
    // A level line may come as {y} or {value}; both are drawn across, so both must fit in the y range or it is clipped.
    (spec.refLines || []).forEach((r) => { if (r) see(r.value != null ? r.value : r.y); });
    (spec.bandY || []).forEach((b) => { if (b) { see(b.y0); see(b.y1); } });
    (spec.annotations || []).forEach((a) => { if (a) see(a.y); });
    const anyArea = vis.some((s) => s.area);
    // sizes
    const fmtY = resolveFormat(yc.format, F.num);
    const probe = valueAxis(yc, yLo, yHi, H0 - 40, { format: yc.format, zero: stacked || anyArea ? 'force' : yc.zero === false ? false : true });
    let yw = 0; probe.ticks.forEach((t) => { yw = Math.max(yw, chart.tw(t.label, 12)); });
    const top = 8 + (yc.label ? 18 : 0), bottom = 28 + (xc.label ? 16 : 0);
    const l = Math.ceil(yw) + 14;
    // direct labels (series name at the line end) need a right gutter; they are dropped if they would collide or squeeze the plot
    const direct = vis.filter((s) => !s.band);
    let rightPad = 14, wantEnd = false, endW = 0;
    if (direct.length >= 1 && direct.length <= 4 && W >= 420) {
      const labs = direct.map((s) => (direct.length === 1 ? fmtY.full(lastY(s)) : s.name));
      endW = Math.min(130, Math.max.apply(null, labs.map((t) => chart.tw(t, 12, direct.length === 1 ? 600 : 400))));
      if (W - l - (endW + 22) >= 300) { wantEnd = true; rightPad = endW + 24; }
    }
    const r = W - rightPad;
    const pw = Math.max(40, r - l), ph = Math.max(60, H0 - top - bottom);
    const bot = top + ph;
    const ax = valueAxis(yc, yLo, yHi, ph, { format: yc.format, zero: stacked || anyArea ? 'force' : yc.zero === false ? false : true });
    const Y = M.linear(ax.d0, ax.d1, bot, top);
    let xAx;
    // A category axis has no number ticks; its labels are added below, thinned so they never collide.
    if (m.type === 'cat') xAx = { kind: 'cat', d0: dMin, d1: dMax, ticks: [], full: (v) => m.cats[Math.round(v)] || '' };
    else xAx = numAxis(xc, m.type === 'time' ? 'time' : m.type === 'hour' ? 'hour' : 'linear', dMin, dMax, pw, { nice: false });
    const X = M.linear(xAx.d0, xAx.d1, l, r);
    const catStep = m.type === 'cat' ? pw / Math.max(1, m.cats.length) : 0;
    const Xp = m.type === 'cat' ? (v) => l + (v + 0.5) * catStep : X;
    if (m.type === 'cat') {
      // choose a label stride so labels never collide
      const maxLw = Math.max.apply(null, m.cats.map((c) => chart.tw(c, 12)).concat([10]));
      const stride = Math.max(1, Math.ceil((maxLw + 10) / Math.max(8, catStep)));
      xAx.ticks = m.cats.map((c, i) => ({ v: i, label: c })).filter((t, i) => i % stride === 0);
    }
    const gTop = S('g');
    svg.append(gTop);
    const bands = S('g', { class: 'ch-g-band' });
    gTop.appendChild(bands);
    // bands (x ranges), then y bands
    (spec.bands || []).forEach((b) => {
      if (!b || !isNum(b.x0) || !isNum(b.x1)) return;
      const x0 = clamp(Xp(b.x0), l, r), x1 = clamp(Xp(b.x1), l, r);
      if (x1 - x0 < 1) return;
      bands.appendChild(S('rect', { x: r1(x0), y: top, width: r1(x1 - x0), height: ph, class: 'ch-band-x' }));
      if (b.label) {
        const lw = chart.tw(b.label, 12);
        if (lw + 8 <= x1 - x0) bands.appendChild(txt(b.label, x0 + 6, top + 14, 'ch-lbl2'));
      }
    });
    (spec.bandY || []).forEach((b) => {
      if (!b || !isNum(b.y0) || !isNum(b.y1)) return;
      const y0 = clamp(Y(b.y1), top, bot), y1 = clamp(Y(b.y0), top, bot);
      if (y1 - y0 < 1) return;
      bands.appendChild(S('rect', { x: l, y: r1(y0), width: r1(r - l), height: r1(y1 - y0), class: 'ch-band-x' }));
      if (b.label) bands.appendChild(txt(b.label, r - 6, y0 + 14, 'ch-lbl2', 'end'));
    });
    drawYAxis(svg, chart, ax, Y, l, r);
    // series paint
    const marks = S('g', { class: 'ch-g-marks ch-rv-right' });
    const fills = S('g', { class: 'ch-g-fill ch-rv-fade' });
    svg.append(fills, marks);
    const base = Y(Math.max(ax.d0, Math.min(0, ax.d1)));
    const drawn = [];                                     // for hover + end labels
    const cols = Math.ceil(pw);
    if (stacked) {
      const xs = stack.xs;
      vis.forEach((s, si) => {
        const tops = xs.map((_, k) => stack.top[si][k]);
        const bases = xs.map((_, k) => stack.base[si][k]);
        const d = linePath(xs, tops, Xp, Y);
        if (!d) return;
        let area = d;
        for (let k = xs.length - 1; k >= 0; k--) area += 'L' + r1(Xp(xs[k])) + ' ' + r1(Y(bases[k]));
        fills.appendChild(S('path', { d: area + 'Z', style: 'fill:' + s.css + ';fill-opacity:.2' }));
        marks.appendChild(S('path', { d, class: 'ch-ln', style: 'stroke:' + s.css }));
        drawn.push({ s, xs, ys: tops, stackIdx: si });
      });
    } else {
      vis.forEach((s) => {
        const pts = s.pts;
        if (s.band) {
          // range band between lo and hi
          const keep = M.decimate(pts.map((p) => p.x), pts.map((p) => p.y), cols);
          let d = '';
          keep.forEach((k, i) => { d += (i ? 'L' : 'M') + r1(Xp(pts[k].x)) + ' ' + r1(Y(pts[k].y2)); });
          for (let i = keep.length - 1; i >= 0; i--) d += 'L' + r1(Xp(pts[keep[i]].x)) + ' ' + r1(Y(pts[keep[i]].y));
          if (keep.length) fills.appendChild(S('path', { d: d + 'Z', style: 'fill:' + s.css + ';fill-opacity:.17' }));
          drawn.push({ s, xs: pts.map((p) => p.x), ys: pts.map((p) => p.y), ys2: pts.map((p) => p.y2) });
          return;
        }
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const keep = M.decimate(xs, ys, cols);
        const dx = keep.map((k) => xs[k]), dy = keep.map((k) => ys[k]);
        const d = linePath(dx, dy, Xp, Y);
        if (!d) { drawn.push({ s, xs, ys }); return; }
        if (s.area) {
          // area wash per contiguous run of finite values
          let run = [];
          const flush = () => { if (run.length > 1 || run.length === 1) { let a = 'M' + r1(Xp(run[0][0])) + ' ' + r1(base); run.forEach((q) => { a += 'L' + r1(Xp(q[0])) + ' ' + r1(Y(q[1])); }); a += 'L' + r1(Xp(run[run.length - 1][0])) + ' ' + r1(base) + 'Z'; fills.appendChild(S('path', { d: a, style: 'fill:' + s.css + ';fill-opacity:.12' })); } run = []; };
          for (let i = 0; i < dx.length; i++) { if (dy[i] == null) flush(); else run.push([dx[i], dy[i]]); }
          flush();
        }
        marks.appendChild(S('path', { d, class: 'ch-ln', style: 'stroke:' + s.css, 'stroke-dasharray': s.dash || null }));
        drawn.push({ s, xs, ys });
      });
    }
    // markers: every point when sparse, otherwise only the last point (end dot)
    const markMode = spec.markers || 'auto';
    drawn.forEach((dsr) => {
      const s = dsr.s; if (s.band) return;
      const ys = stacked ? dsr.ys : dsr.ys;
      const n = dsr.xs.length;
      const every = markMode === 'all' || (markMode === 'auto' && n <= 14 && (n <= 1 || Xp(dsr.xs[1]) - Xp(dsr.xs[0]) > 14 || m.type === 'cat'));
      const idxs = [];
      if (markMode !== 'none') { if (every) for (let i = 0; i < n; i++) idxs.push(i); else for (let i = n - 1; i >= 0; i--) if (ys[i] != null) { idxs.push(i); break; } }
      idxs.forEach((i) => { if (ys[i] == null) return; marks.appendChild(S('circle', { cx: r1(Xp(dsr.xs[i])), cy: r1(Y(ys[i])), r: 4, class: 'ch-ring', style: 'fill:' + s.css })); });
    });
    // reference lines, annotations
    drawRefLines(svg, chart, spec.refLines, { orient: 'h', scale: Y, l, r, t: top, b: bot });
    if (Array.isArray(spec.refLines)) drawRefLines(svg, chart, spec.refLines.filter((q) => q && isNum(q.x)), { orient: 'v', scale: Xp, l, r, t: top, b: bot });
    drawAnnotations(svg, chart, spec.annotations, Xp, Y, { l, r, t: top, b: bot, cats: m.type === 'cat' ? m.cats : null });
    // x axis last-drawn at the back
    if (m.type === 'cat') drawXAxis(svg, chart, xAx, Xp, l, r, bot, W);
    else drawXAxis(svg, chart, xAx, Xp, l, r, bot, W);
    // axis titles
    if (yc.label) svg.appendChild(txt(yc.label, 0, 12, 'ch-axt'));
    if (xc.label) svg.appendChild(txt(xc.label, r, H0 - 4, 'ch-axt', 'end'));
    // direct end labels
    if (wantEnd) {
      const items = drawn.filter((d) => !d.s.band).map((d) => { let k = d.xs.length - 1; while (k >= 0 && d.ys[k] == null) k--; return k < 0 ? null : { d, y: Y(d.ys[k]), v: d.ys[k], x: Xp(d.xs[k]) }; }).filter(Boolean).sort((a, b) => a.y - b.y);
      const spread = M.spreadLabels(items.map((it) => it.y), 15, top + 6, bot - 4);
      if (items.length && spread) {
        const gl = S('g', { class: 'ch-g-lab ch-rv-fade' });
        items.forEach((it, i) => {
          const label = direct.length === 1 ? fmtY.full(it.v) : chart.fit(it.d.s.name, endW + 2, 12);
          const lx = Math.max(it.x + 10, m.type === 'cat' ? r + 6 : 0), ly = spread[i];
          if (Math.abs(ly - it.y) > 2 || lx > it.x + 12) gl.appendChild(S('path', { d: `M${r1(it.x + 4)} ${r1(it.y)}L${r1(lx - 3)} ${r1(ly)}`, fill: 'none', style: 'stroke:' + it.d.s.css + ';stroke-width:1', opacity: '.7' }));
          gl.appendChild(txt(label, lx, ly, direct.length === 1 ? 'ch-v ch-halo' : 'ch-lbl ch-halo', 'start', { dy: '.35em' }));
        });
        svg.appendChild(gl);
      }
    }
    // hover layer: crosshair, dots, tooltip, keyboard
    const xsU = m.type === 'cat' ? m.cats.map((_, i) => i) : (stacked ? stack.xs : m.xsAll);
    const over = S('g', { class: 'ch-g-over', 'pointer-events': 'none' });
    const cross = S('line', { y1: top, y2: bot, class: 'ch-xh', visibility: 'hidden' });
    over.appendChild(cross);
    const dots = drawn.filter((d) => !d.s.band).map((d) => { const c = S('circle', { r: 5.5, class: 'ch-ring', visibility: 'hidden', style: 'fill:' + d.s.css }); over.appendChild(c); return c; });
    const hit = S('rect', { x: l, y: top, width: pw, height: ph, class: 'ch-hit', style: 'touch-action:pan-y' });
    const kg = S('g', { tabindex: '0', role: 'group', class: 'ch-m ch-kbd', 'aria-label': (spec.title || 'Line chart') + '. Use the left and right arrow keys to move between points.' }, S('rect', { x: l - 2, y: top - 2, width: pw + 4, height: ph + 4, fill: 'none', 'pointer-events': 'none' }));
    svg.append(hit, over, kg);
    const lineSeries = drawn.filter((d) => !d.s.band);
    // Tooltip for x position i: one row per series with a point near there, plus a Total row when stacked.
    function tipFor(i) {
      const x = xsU[i];
      const rows = [];
      let total = 0, any = false;
      drawn.forEach((d, di) => {
        const s = d.s;
        // find a point exactly at x (cat: index; others: within a hair), else nearest within 1.5 steps
        const j = M.nearestIndex(d.xs, x);
        if (j < 0) return;
        const span = d.xs.length > 1 ? (d.xs[d.xs.length - 1] - d.xs[0]) / (d.xs.length - 1) : 0;
        const near = Math.abs(d.xs[j] - x) <= Math.max(1e-9, span * 0.51);
        if (!near || d.ys[j] == null) return;
        any = true;
        if (s.band) rows.push({ key: { css: s.css, shape: 'box' }, v: fmtY.full(d.ys[j]) + ' to ' + fmtY.full(d.ys2[j]), k: s.name });
        else if (stacked && stack.miss[d.stackIdx][j]) rows.push({ key: { css: s.css }, v: 'no data', k: s.name });
        else { rows.push({ key: { css: s.css }, v: fmtY.full(stacked ? (d.ys[j] - (stack.base[d.stackIdx][j] || 0)) : d.ys[j]), k: s.name }); total += stacked ? (d.ys[j] - stack.base[d.stackIdx][j]) : 0; }
      });
      if (stacked && rows.length > 1) rows.push({ key: null, v: fmtY.full(total), k: 'Total' });
      return any ? { head: xAx.full(x), rows } : null;
    }
    // Moves the crosshair and dots to x position i and shows the tooltip next to it.
    function place(i, evt, kbd) {
      const x = xsU[i]; if (x == null) return;
      const cx = Xp(x);
      cross.setAttribute('x1', px(cx)); cross.setAttribute('x2', px(cx)); cross.setAttribute('visibility', 'visible');
      lineSeries.forEach((d, di) => {
        const j = M.nearestIndex(d.xs, x);
        const span = d.xs.length > 1 ? (d.xs[d.xs.length - 1] - d.xs[0]) / (d.xs.length - 1) : 0;
        const ok = j >= 0 && d.ys[j] != null && Math.abs(d.xs[j] - x) <= Math.max(1e-9, span * 0.51);
        const c = dots[di];
        if (ok) { c.setAttribute('cx', r1(Xp(d.xs[j]))); c.setAttribute('cy', r1(Y(d.ys[j]))); c.setAttribute('visibility', 'visible'); } else c.setAttribute('visibility', 'hidden');
      });
      const t = tipFor(i); if (!t) { chart.tipHide(); return; }
      const bb = svg.getBoundingClientRect();
      chart.tipShow(t, { x: bb.left + cx, y: bb.top + top, w: 0, h: 0 }, kbd || (evt && evt.pointerType === 'touch') ? 'top' : 'rtop');
      if (kbd) chart.say(t.head + ': ' + t.rows.map((rw) => rw.k + ' ' + rw.v).join(', '));
    }
    // Hides the crosshair, dots and tooltip.
    function clear() { cross.setAttribute('visibility', 'hidden'); dots.forEach((c) => c.setAttribute('visibility', 'hidden')); chart.tipHide(); }
    // Turns a pointer position into the index of the nearest x position (or category).
    function fromEvent(e) { const bb = svg.getBoundingClientRect(); const x = e.clientX - bb.left; const v = m.type === 'cat' ? clamp(Math.round((x - l) / catStep - 0.5), 0, m.cats.length - 1) : X.invert(x); return m.type === 'cat' ? v : M.nearestIndex(xsU, v); }
    hit.addEventListener('pointermove', (e) => { if (!xsU.length) return; place(fromEvent(e), e, false); });
    hit.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && xsU.length) place(fromEvent(e), e, false); });
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') clear(); });
    let kidx = Math.max(0, xsU.length - 1);
    kg.addEventListener('focus', () => { chart.kbd = true; if (xsU.length) place(kidx, null, true); });
    kg.addEventListener('blur', () => { chart.kbd = false; clear(); });
    kg.addEventListener('keydown', (e) => {
      if (!xsU.length) return;
      const k = e.key; let n = kidx;
      if (k === 'ArrowRight' || k === 'ArrowDown') n = Math.min(xsU.length - 1, kidx + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp') n = Math.max(0, kidx - 1);
      else if (k === 'Home') n = 0; else if (k === 'End') n = xsU.length - 1; else return;
      e.preventDefault(); kidx = n; place(n, null, true);
    });
    chart.lineNav = { place, clear };
    return H0;
  }
  // Last non-missing y value of a series (used for the single-series end label).
  const lastY = (s) => { for (let i = s.pts.length - 1; i >= 0; i--) if (s.pts[i].y != null) return s.pts[i].y; return null; };

  /** Annotation: ring on the point + label with a halo, nudged inside the plot, alternating above/below to avoid collisions. */
  function drawAnnotations(parent, chart, anns, X, Y, box) {
    if (!Array.isArray(anns) || !anns.length) return;
    const gg = S('g', { class: 'ch-g-ann' });
    const placed = [];
    anns.forEach((a) => {
      if (!a || !isNum(a.y)) return;
      let xv = a.x; if (box.cats && typeof xv === 'string') xv = box.cats.indexOf(xv); if (!isNum(xv) || xv < 0) return;
      const x = X(xv), y = Y(a.y);
      if (x < box.l - 1 || x > box.r + 1 || y < box.t - 1 || y > box.b + 1) return;
      const tone = keyOfTone(a.tone); const col = tone && tone !== 'muted' ? css(tone) : css('text');
      gg.appendChild(S('circle', { cx: r1(x), cy: r1(y), r: 6, fill: 'none', style: 'stroke:' + col + ';stroke-width:2' }));
      if (!a.label) return;
      const lw = chart.tw(a.label, 12, 600);
      let up = true; let ly = y - 14;
      if (ly < box.t + 10) { up = false; ly = y + 22; }
      let tries = 0;
      // True when this label would overlap one already placed.
      const clash = () => placed.some((p) => Math.abs(p.y - ly) < 15 && p.x0 < lx0() + lw + 4 && p.x1 > lx0() - 4);
      let lx = clamp(x, box.l + lw / 2 + 2, box.r - lw / 2 - 2);
      // Left edge of the label (it is centred on lx).
      function lx0() { return lx - lw / 2; }
      while (clash() && tries++ < 3) { ly += up ? -16 : 16; }
      placed.push({ y: ly, x0: lx0(), x1: lx0() + lw });
      gg.appendChild(S('line', { x1: r1(x), x2: r1(x), y1: r1(y + (ly < y ? -6 : 6)), y2: r1(ly + (ly < y ? 3 : -11)), class: 'ch-ldr' }));
      gg.appendChild(txt(a.label, lx, ly, 'ch-v ch-halo', 'middle'));
    });
    parent.appendChild(gg);
  }

  // The line chart's definition. ownHover: it manages its own tooltip, so shared wiring does not hide it.
  TYPES.line = {
    noun: 'Line chart', table: true,
    ownHover: true,
    model: lineModel,
    draw: lineDraw,
    // One legend entry per series: bands show as squares, the rest as lines with a dot.
    legend(m, chart) {
      return m.series.map((s) => ({ id: s.id, name: s.name, key: s.key, css: s.css, kind: s.band ? 'rect' : 'line', dash: s.dash, dot: !s.band }));
    },
    // Table twin: a row per x value, a column per series ("a to b" for bands, "-" for no value).
    table(m, chart) {
      const spec = chart.spec, yc = spec.y || {}; const fmtY = resolveFormat(yc.format, F.num);
      const xc = spec.x || {};
      const xs = m.type === 'cat' ? m.cats.map((_, i) => i) : M.unionSorted(m.series.map((s) => s.pts.map((p) => p.x)));
      // Axis text for the first column: category names, or time, hour or number text for the x value.
      const xAx = m.type === 'cat' ? { full: (v) => m.cats[v] } : numAxis(xc, m.type === 'time' ? 'time' : m.type === 'hour' ? 'hour' : 'linear', xs[0], xs[xs.length - 1], 400, {});
      const lookups = m.series.map((s) => { const mp = new Map(); s.pts.forEach((p) => mp.set(p.x, p)); return mp; });
      const rows = xs.map((x) => [xAx.full(x)].concat(m.series.map((s, i) => { const p = lookups[i].get(x); if (!p || p.y == null) return '-'; return s.band ? fmtY.full(p.y) + ' to ' + fmtY.full(p.y2) : fmtY.full(p.y); })));
      return { head: [xc.label || (m.type === 'cat' ? 'Category' : m.type === 'time' ? 'Time' : m.type === 'hour' ? 'Hour' : 'X')].concat(m.series.map((s) => s.name)), rows };
    },
  };

  /* =====================================================================================================
   * 8. BAR and STACK
   * bar spec:   { orient:'v'|'h', categories:[], series:[{id,name,values:[],tone?,slot?}], stacked?, percent?, labels:'auto'|'none'|'all', refLines:[{value|y|x,label,tone}],
   *               format, sort:'desc'|'asc'|'none', tones:[per-category tone], emphasis?:category|index|[...], limit?, axis:{min,max,label}, height? }
   * stack spec: { categories:[], parts:[{id,name,values:[]}], percent?, format, labels, sort, tones?, height? }   (horizontal stacked bars, 2px surface gaps)
   * ===================================================================================================== */
  // Cleans a bar or stack spec: categories, series (missing values become null), display order and
  // per-category tones. 'stack' reads spec.parts and runs horizontal.
  function barModel(spec0, chart, forceStack) {
    const spec = forceStack ? Object.assign({}, spec0, { orient: 'h', stacked: true, series: spec0.parts || spec0.series }) : spec0;
    const orient = spec.orient === 'h' ? 'h' : 'v';
    let cats = Array.isArray(spec.categories) ? spec.categories.map((c) => (c == null ? '' : String(c))) : [];
    const rawSeries = Array.isArray(spec.series) ? spec.series.filter((s) => s) : [];
    if (!cats.length) { const n = Math.max(0, ...rawSeries.map((s) => (Array.isArray(s.values) ? s.values.length : 0))); for (let i = 0; i < n; i++) cats.push(String(i + 1)); }
    const series = rawSeries.map((s, i) => {
      const st = styleOf(s, i); const id = s.id != null ? String(s.id) : 'series' + i;
      return { id, name: s.name != null ? String(s.name) : id, key: st.key, css: st.css, values: cats.map((_, c) => (s.values && isNum(s.values[c]) ? s.values[c] : null)), hidden: chart.hidden.has(id) };
    });
    const vis = series.filter((s) => !s.hidden);
    const toneOf = cats.map((_, i) => (Array.isArray(spec.tones) ? keyOfTone(spec.tones[i]) : null));
    let order = cats.map((_, i) => i);
    // Sum of the visible series for category c (missing counts as 0).
    const total = (c) => vis.reduce((a, s) => a + (isNum(s.values[c]) ? s.values[c] : 0), 0);
    if (spec.sort === 'desc' || spec.sort === 'asc') {
      const dir = spec.sort === 'desc' ? -1 : 1;
      order.sort((a, b) => dir * (total(a) - total(b)) || a - b);
    }
    if (isNum(spec.limit) && spec.limit > 0) order = order.slice(0, Math.floor(spec.limit));
    const emph = spec.emphasis == null ? null : (Array.isArray(spec.emphasis) ? spec.emphasis : [spec.emphasis]).map((e) => (typeof e === 'number' ? e : cats.indexOf(String(e))));
    const anyData = vis.some((s) => s.values.some((v) => v != null));
    return {
      spec, orient, cats, series, vis, order, toneOf, emph, stacked: !!spec.stacked, percent: !!spec.percent && !!spec.stacked,
      grid: null, empty: !cats.length || !vis.length || !anyData, total,
      summary: order.length + ' categories, ' + vis.map((s) => s.name).join(', '),
    };
  }

  // Percent text for a bar segment: whole percents, and "<1%" for tiny shares so nothing reads as 0%.
  const shareCell = (p) => (p > 0 && p < 1 ? '<1%' : Math.round(p) + '%');   // in-segment share labels: whole percents, no false precision
  // Splits a category label into at most two lines that fit maxW, cutting at spaces; truncates if needed.
  function wrapLabel(chart, text, maxW) {
    if (chart.tw(text, 12) <= maxW) return [text];
    const words = text.split(/\s+/);
    if (words.length > 1) {
      for (let cut = 1; cut < words.length; cut++) {
        const a = words.slice(0, cut).join(' '), b = words.slice(cut).join(' ');
        if (chart.tw(a, 12) <= maxW && chart.tw(b, 12) <= maxW) return [a, b];
      }
      // best-effort balanced split with truncation on the second line
      const mid = Math.ceil(words.length / 2);
      return [chart.fit(words.slice(0, mid).join(' '), maxW, 12), chart.fit(words.slice(mid).join(' '), maxW, 12)];
    }
    return [chart.fit(text, maxW, 12)];
  }

  // Draws bar and stack charts (vertical or horizontal; grouped or stacked with 2 px gaps; optionally
  // percent of total) with value labels, axes, reference lines and a hover area per bar. Returns the
  // height.
  function barDraw(chart, m, svg, W) {
    const spec = m.spec, orient = m.orient, fmt0 = resolveFormat(spec.format, F.num);
    const vis = m.vis, n = m.order.length, k = vis.length;
    const stacked = m.stacked, percent = m.percent;
    const fmt = percent ? F.pct100 : fmt0;
    const axc = spec.axis || {};
    const labelsMode = spec.labels || 'auto';
    // --- value domain
    let lo = 0, hi = 0;
    // Value of series s in category c.
    const val = (s, c) => s.values[c];
    // WATCH OUT: percent bars are drawn as shares of the positive total, so their labels and tooltips use it too
    // (the signed total would disagree with the bar sizes once a segment is negative).
    const posTot = (c) => vis.reduce((a, s) => { const v = val(s, c); return a + (isNum(v) && v > 0 ? v : 0); }, 0);
    let stackL = null;
    if (stacked) {
      const vals = vis.map((s) => m.order.map((c) => { const v = val(s, c); return v == null ? null : v; }));
      stackL = M.stackLayout(vals, n);
      if (percent) {
        // convert to share of the positive total per category
        for (let si = 0; si < k; si++) for (let ci = 0; ci < n; ci++) { const tot = stackL.pos[ci] || 0; const f = tot > 0 ? 100 / tot : 0; stackL.base[si][ci] *= f; stackL.top[si][ci] *= f; }
        stackL.pos = stackL.pos.map((t) => (t > 0 ? 100 : 0));
      }
      stackL.pos.forEach((v) => { if (v > hi) hi = v; }); stackL.neg.forEach((v) => { if (v < lo) lo = v; });
    } else {
      vis.forEach((s) => m.order.forEach((c) => { const v = val(s, c); if (isNum(v)) { if (v > hi) hi = v; if (v < lo) lo = v; } }));
    }
    (spec.refLines || []).forEach((r) => { const v = r && (r.value != null ? r.value : orient === 'v' ? r.y : r.x); if (isNum(v)) { if (v > hi) hi = v; if (v < lo) lo = v; } });
    if (hi === 0 && lo === 0) hi = percent ? 100 : 1;
    // --- label strings (needed to size margins)
    const pxText = (t, w) => chart.tw(t, 12, w || 600);
    const allVals = [];
    vis.forEach((s) => m.order.forEach((c) => { if (isNum(val(s, c))) allVals.push(val(s, c)); }));
    const widestVal = Math.max.apply(null, [0].concat(allVals.map((v) => pxText(fmt0.full(v)))), stacked ? Math.max.apply(null, [0].concat(stackL.pos.map((v, ci) => pxText(fmt0.full(percent ? m.total(m.order[ci]) : v))))) : 0);
    const catLabelW = Math.max.apply(null, [0].concat(m.order.map((c) => chart.tw(m.cats[c], 12))));
    let H0, l, r, top, bot, plotW, plotH;
    const g1 = S('g', { class: 'ch-g-bars ' + (orient === 'v' ? 'ch-rv-up' : 'ch-rv-right') });
    const gl = S('g', { class: 'ch-g-vals ch-rv-fade' });
    // Thickness of one bar in a slot of width band holding kk bars: up to 24 px, 2 px apart, at least 2 px.
    const thick = (band, kk) => Math.max(Math.min(2, band * 0.85), Math.min(24, (band * (kk > 1 ? 0.84 : 0.7) - (kk - 1) * 2) / kk));
    // The status tone chosen for category c, if any.
    const tone = (c) => m.toneOf[c];
    // True when category c is emphasised, or when nothing is, so all are.
    const isEmph = (c) => !m.emph || m.emph.indexOf(c) >= 0;
    // Colour key for a bar: category tone if single series, grey if another is emphasised, else series
    // colour.
    const barKey = (s, c) => { const tk = m.toneOf[c]; if (tk && k === 1) return tk; return !isEmph(c) ? 'muted' : s.key; };
    // Tooltip for category c: a row per visible series (with share of total in percent mode), a Total row
    // for stacks, and a status word if it has one.
    const tipFor = (c, hotSi) => {
      const rows = vis.map((s) => {
        const v = val(s, c);
        const share = percent && posTot(c) > 0 && isNum(v) ? ' (' + F.pct100.full((v / posTot(c)) * 100) + ')' : '';
        return { key: { css: css(barKey(s, c)), shape: 'box' }, v: v == null ? '-' : fmt0.full(v) + share, k: s.name };
      });
      if (stacked && vis.length > 1) rows.push({ key: null, v: fmt0.full(m.total(c)), k: 'Total' });
      const tk = m.toneOf[c];
      const t = { head: m.cats[c], rows };
      if (tk && isStatus(tk)) t.st = { tone: tk, word: wordFor(tk, spec.toneWords) };
      return t;
    };
    // Screen-reader sentence for category c, such as "Brisket: Dine in 12, Takeout 7".
    const ariaFor = (c) => m.cats[c] + ': ' + vis.map((s) => s.name + ' ' + (val(s, c) == null ? 'no data' : fmt0.full(val(s, c)))).join(', ') + (m.toneOf[c] && isStatus(m.toneOf[c]) ? ', ' + wordFor(m.toneOf[c], spec.toneWords) : '');
    // What onSelect receives when a category is clicked: its name, index and values by series id.
    const catPick = (c) => ({ category: m.cats[c], index: c, values: vis.reduce((o, s) => { o[s.id] = val(s, c); return o; }, {}) });

    // Vertical bars: left margin from the tick labels, category label wrapping, axis, reference lines, then
    // bars and labels.
    if (orient === 'v') {
      H0 = isNum(spec.height) ? spec.height : W < 420 ? 230 : 260;
      if (lo < 0 && !stacked && labelsMode !== 'none') lo -= (hi - lo) * 22 / Math.max(60, H0 - 72);   // room under a negative bar for its value label
      // first pass: left margin from tick labels
      const probe = valueAxis(axc, lo, hi, H0 - 50, { format: percent ? F.pct100 : spec.format, zero: 'force', spacing: 42 });
      let yw = 0; probe.ticks.forEach((t) => { yw = Math.max(yw, chart.tw(t.label, 12)); });
      l = Math.ceil(yw) + 14; r = W - 12;
      plotW = r - l;
      const catW = plotW / Math.max(1, n);
      // category labels: wrap to two lines when that is enough, otherwise stride
      const lineH = 14;
      let lines = 1, stride = 1, labelLines = null;
      const wraps = m.order.map((c) => wrapLabel(chart, m.cats[c], Math.max(10, catW - 6)));
      if (catW >= 56 || n <= 8) { labelLines = wraps; lines = Math.max.apply(null, wraps.map((w) => w.length)); }
      else { stride = Math.max(1, Math.ceil((catLabelW + 12) / Math.max(0.5, catW))); labelLines = m.order.map((c) => [m.cats[c]]); }
      top = 10 + (axc.label ? 16 : 0);
      bot = H0 - (14 + lines * lineH + 6);
      plotH = Math.max(60, bot - top);
      const ax = valueAxis(axc, lo, hi, plotH, { format: percent ? F.pct100 : spec.format, zero: 'force', spacing: 42 });
      const Y = M.linear(ax.d0, ax.d1, bot, top);
      const y0 = Y(Math.max(ax.d0, Math.min(0, ax.d1)));
      // decide labels before drawing the axis (axis is dropped when every bar is labelled)
      const bw = thick(catW, stacked ? 1 : k);
      const wantVal = labelsMode === 'all' || (labelsMode === 'auto' && !stacked && k === 1 && widestVal + 4 <= catW);
      const wantTotal = stacked && labelsMode !== 'none' && widestVal + 4 <= catW;
      const allLabelled = wantVal && !stacked && k === 1 && m.order.every((c) => val(vis[0], c) != null);
      svg.append(g1, gl);
      if (!allLabelled || spec.axisAlways) drawYAxis(svg, chart, ax, Y, l, r); else svg.insertBefore(hline(l, r, y0, 'ch-ax'), svg.firstChild);
      if (axc.label) svg.appendChild(txt(axc.label, 0, 12, 'ch-axt'));
      drawRefLines(svg, chart, (spec.refLines || []).map((q) => (q.value == null && q.y != null ? Object.assign({}, q, { value: q.y }) : q)), { orient: 'h', scale: Y, l, r, t: top, b: bot });
      // x labels
      const gx = S('g', { class: 'ch-g-x' });
      m.order.forEach((c, ci) => {
        if (ci % stride !== 0) return;
        const cx = l + (ci + 0.5) * catW;
        const ls = labelLines[ci];
        ls.forEach((ln, li) => gx.appendChild(txt(ln, cx, bot + 17 + li * lineH, 'ch-t', 'middle')));
      });
      svg.appendChild(gx);
      // bars
      m.order.forEach((c, ci) => {
        const cx = l + (ci + 0.5) * catW;
        const visEls = [];
        if (stacked) {
          const segs = [];
          vis.forEach((s, si) => {
            const v = val(s, c); if (!isNum(v) || v === 0) return;
            const a = stackL.base[si][ci], b = stackL.top[si][ci];
            segs.push({ s, si, a, b, neg: v < 0 });
          });
          // outermost segment per side gets the rounded data end
          const lastPos = segs.filter((q) => !q.neg).pop(), lastNeg = segs.filter((q) => q.neg).pop();
          segs.forEach((q) => {
            let pa = Y(q.a), pb = Y(q.b);
            let top_ = Math.min(pa, pb), bot_ = Math.max(pa, pb);
            // Trim 1 px where segments meet so the background shows through as a gap.
            if (q.a !== 0) { if (q.neg) top_ += 1; else bot_ -= 1; }
            const outer = q === lastPos || q === lastNeg;
            if (!outer) { if (q.neg) bot_ -= 1; else top_ += 1; }
            if (bot_ - top_ < 1) bot_ = top_ + 1;
            const d = barPath(cx - bw / 2, top_, bw, bot_ - top_, 4, outer ? (q.neg ? 'down' : 'up') : 'none');
            const p = chart.fillShape(svg, g1, d, barKey(q.s, c));
            visEls.push(p);
            if (labelsMode !== 'none' && (labelsMode === 'all' || true)) {
              const tvv = percent ? shareCell(((val(q.s, c)) / (posTot(c) || 1)) * 100) : fmt0.full(val(q.s, c));
              const tw_ = pxText(tvv);
              if (bot_ - top_ >= 16 && tw_ + 8 <= bw && (labelsMode !== 'none')) gl.appendChild(txt(tvv, cx, (top_ + bot_) / 2, 'ch-in', 'middle', { dy: '.35em', style: 'fill:' + chart.inkOn(barKey(q.s, c)) }));
            }
          });
          if (wantTotal) {
            const topY = Y(percent ? 100 : stackL.pos[ci]);
            if (stackL.pos[ci] > 0 || percent) gl.appendChild(txt(fmt0.full(m.total(c)), cx, topY - 6, 'ch-v ch-halo', 'middle'));
          }
        } else {
          vis.forEach((s, si) => {
            const v = val(s, c);
            const x = cx - (k * bw + (k - 1) * 2) / 2 + si * (bw + 2);
            if (isNum(v) && v !== 0) {
              // A non-zero bar is always at least 2 px tall so it stays visible.
              const py = Y(v); let t_ = Math.min(py, y0), h_ = Math.abs(py - y0); if (h_ < 2) { h_ = 2; if (v > 0) t_ = y0 - 2; }
              const d = barPath(x, t_, bw, h_, 4, v < 0 ? 'down' : 'up');
              const p = chart.fillShape(svg, g1, d, barKey(s, c)); visEls.push(p);
              if (wantVal) {
                const tv = fmt0.full(v);
                const ly = v < 0 ? t_ + h_ + 14 : t_ - 6;
                const tk = k === 1 ? m.toneOf[c] : null; const hasG = tk && isStatus(tk);
                gl.appendChild(txt(tv, cx + (hasG ? 7 : 0), ly, 'ch-v ch-halo', 'middle'));
                if (hasG) gl.appendChild(S('g', { transform: `translate(${r1(cx - pxText(tv) / 2 - 2)} ${r1(ly - 4)}) scale(.78)` }, glyphG(tk)));
              } else if (k === 1 && m.toneOf[c] && isStatus(m.toneOf[c])) {
                gl.appendChild(S('g', { transform: `translate(${r1(cx)} ${r1((v < 0 ? t_ + h_ + 10 : t_ - 9))}) scale(.78)` }, glyphG(m.toneOf[c])));
              }
            } else if (isNum(v) && wantVal) {
              const tk = k === 1 ? m.toneOf[c] : null, tv = fmt0.full(v), hasG = tk && isStatus(tk);
              gl.appendChild(txt(tv, cx + (hasG ? 7 : 0), y0 - 6, 'ch-v ch-halo', 'middle'));
              if (hasG) gl.appendChild(S('g', { transform: `translate(${r1(cx - pxText(tv) / 2 - 2)} ${r1(y0 - 10)}) scale(.78)` }, glyphG(tk)));
            }
            if (!stacked && k > 1) {
              // per-bar mark (grouped): hit area is the bar's slot, full plot height
              const hx = x - 1, hw = bw + 2;
              const hit = S('rect', { x: r1(hx), y: top, width: r1(hw), height: r1(plotH), class: 'ch-hit' });
              svg.appendChild(hit);
              chart.addMark({ el: hit, vis: visEls.slice(-1), tip: tipFor(c, si), label: ariaFor(c), pref: 'top', select: catPick(c), follow: false });
            }
          });
          if (k === 1) {
            const hit = S('rect', { x: r1(cx - catW / 2), y: top, width: r1(catW), height: r1(plotH), class: 'ch-hit' });
            svg.appendChild(hit);
            chart.addMark({ el: hit, vis: visEls, tip: tipFor(c), label: ariaFor(c), pref: 'top', select: catPick(c) });
          }
        }
        if (stacked) {
          const hit = S('rect', { x: r1(cx - catW / 2), y: top, width: r1(catW), height: r1(plotH), class: 'ch-hit' });
          svg.appendChild(hit);
          chart.addMark({ el: hit, vis: visEls, tip: tipFor(c), label: ariaFor(c), pref: 'top', select: catPick(c) });
        }
      });
    } else {
      // ---- horizontal
      // Horizontal bars: row height grows with the bars per row; the left margin holds the category names.
      const rowPitch = isNum(spec.height) ? null : Math.max(stacked ? 34 : 30, stacked ? 0 : k * 16 + (k - 1) * 2 + 16);
      const hideAxisWish = (labelsMode !== 'none' && !stacked) || labelsMode === 'all';
      const leftMax = Math.max(80, Math.min(W * 0.38, 220));
      const leftW = Math.min(leftMax, Math.ceil(catLabelW) + 4);
      l = leftW + 12;
      const wantVal = labelsMode === 'all' || (labelsMode === 'auto' && !stacked);
      const wantTotal = stacked && labelsMode !== 'none';
      const valRoom = (wantVal || wantTotal) ? Math.ceil(widestVal) + 12 + (m.toneOf.some((t) => t && isStatus(t)) ? 16 : 0) : 8;
      r = W - Math.max(12, valRoom);
      plotW = Math.max(60, r - l);
      top = 6; const wantAxis = !(hideAxisWish && !stacked && vis.length === 1 && wantVal) || spec.axisAlways;
      const axisH = wantAxis ? 26 : 6;
      bot = isNum(spec.height) ? spec.height - axisH : top + n * rowPitch;
      H0 = bot + axisH;
      plotH = bot - top;
      const pitch = plotH / Math.max(1, n);
      if (lo < 0 && wantVal && !stacked) {                      // a negative bar's value label sits left of its end: keep room for it so it never runs into the category names
        const negW = Math.max.apply(null, allVals.filter((v) => v < 0).map((v) => pxText(fmt0.full(v)))) + 18;
        lo -= (hi - lo) * negW / Math.max(60, plotW - negW);
      }
      const ax = valueAxis(axc, lo, hi, plotW, { format: percent ? F.pct100 : spec.format, zero: 'force', spacing: 64, maxTicks: 6 });
      const V = M.linear(ax.d0, ax.d1, l, r);
      const x0 = V(Math.max(ax.d0, Math.min(0, ax.d1)));
      svg.append(g1, gl);
      // Value axis along the bottom, with labels thinned so they do not collide.
      if (wantAxis) {
        ax.ticks.forEach((t) => { const x = V(t.v); svg.insertBefore(vline(x, top, bot, Math.abs(t.v - Math.max(ax.d0, Math.min(0, ax.d1))) < 1e-9 ? 'ch-ax' : 'ch-gl'), svg.firstChild); });
        let prevEnd = -1e9; const gxl = S('g');
        ax.ticks.forEach((t) => { const x = V(t.v); const lw = chart.tw(t.label, 12); let anc = 'middle', tx = x; if (x + lw / 2 > W - 2) { anc = 'end'; tx = W - 2; } const xs0 = anc === 'middle' ? tx - lw / 2 : tx - lw; if (xs0 < prevEnd + 8) return; prevEnd = xs0 + lw; gxl.appendChild(txt(t.label, tx, bot + 18, 'ch-t', anc)); });
        svg.appendChild(gxl);
      } else svg.insertBefore(vline(x0, top, bot, 'ch-ax'), svg.firstChild);
      if (axc.label) svg.appendChild(txt(axc.label, r, H0 - 2, 'ch-axt', 'end'));
      drawRefLines(svg, chart, (spec.refLines || []).map((q) => (q.value == null && q.x != null ? Object.assign({}, q, { value: q.x }) : q)), { orient: 'v', scale: V, l, r, t: top, b: bot });
      const bwid = thick(pitch, stacked ? 1 : k);
      // One row per category: its name on the left, then its bar or bars.
      m.order.forEach((c, ci) => {
        const cy = top + (ci + 0.5) * pitch;
        const name = chart.fit(m.cats[c], leftW, 12);
        const tk = m.toneOf[c];
        svg.appendChild(txt(name, l - 10, cy, 'ch-t', 'end', { dy: '.35em' }));
        const visEls = [];
        if (stacked) {
          // Stacked row: segments run from base to top; only the outermost segment on each side gets
          // rounded ends.
          const segs = [];
          vis.forEach((s, si) => { const v = val(s, c); if (!isNum(v) || v === 0) return; segs.push({ s, si, a: stackL.base[si][ci], b: stackL.top[si][ci], neg: v < 0 }); });
          const lastPos = segs.filter((q) => !q.neg).pop(), lastNeg = segs.filter((q) => q.neg).pop();
          segs.forEach((q) => {
            let pa = V(q.a), pb = V(q.b); let l_ = Math.min(pa, pb), r_ = Math.max(pa, pb);
            if (q.a !== 0) { if (q.neg) r_ -= 1; else l_ += 1; }
            const outer = q === lastPos || q === lastNeg;
            if (!outer) { if (q.neg) l_ += 1; else r_ -= 1; }
            if (r_ - l_ < 1) r_ = l_ + 1;
            const d = barPath(l_, cy - bwid / 2, r_ - l_, bwid, 4, outer ? (q.neg ? 'left' : 'right') : 'none');
            const p = chart.fillShape(svg, g1, d, barKey(q.s, c)); visEls.push(p);
            const tvv = percent ? shareCell(((val(q.s, c)) / (posTot(c) || 1)) * 100) : fmt0.full(val(q.s, c));
            const tw_ = pxText(tvv);
            if (labelsMode !== 'none' && r_ - l_ >= tw_ + 12 && bwid >= 14) gl.appendChild(txt(tvv, (l_ + r_) / 2, cy, 'ch-in', 'middle', { dy: '.35em', style: 'fill:' + chart.inkOn(barKey(q.s, c)) }));
          });
          if (wantTotal && !percent) { const endX = V(stackL.pos[ci] > 0 ? stackL.pos[ci] : 0); gl.appendChild(txt(fmt0.full(m.total(c)), endX + 8, cy, 'ch-v', 'start', { dy: '.35em' })); }
        } else {
          // Grouped row: one bar per visible series, with its value label just past the bar end.
          vis.forEach((s, si) => {
            const v = val(s, c);
            const yy = cy - (k * bwid + (k - 1) * 2) / 2 + si * (bwid + 2);
            if (isNum(v) && v !== 0) {
              const pv = V(v); let l_ = Math.min(pv, x0), w_ = Math.abs(pv - x0); if (w_ < 2) { w_ = 2; if (v < 0) l_ = x0 - 2; }
              const d = barPath(l_, yy, w_, bwid, 4, v < 0 ? 'left' : 'right');
              const p = chart.fillShape(svg, g1, d, barKey(s, c)); visEls.push(p);
              if (wantVal && bwid >= 11) {
                const tv = fmt0.full(v);
                const ex = v < 0 ? l_ - 8 : l_ + w_ + 8;
                const hasG = k === 1 && tk && isStatus(tk);
                gl.appendChild(txt(tv, ex + (hasG ? 16 : 0), yy + bwid / 2, 'ch-v', v < 0 ? 'end' : 'start', { dy: '.35em' }));
                if (hasG) gl.appendChild(S('g', { transform: `translate(${r1(ex + 6)} ${r1(yy + bwid / 2)}) scale(.78)` }, glyphG(tk)));
              }
            } else if (isNum(v) && wantVal && bwid >= 11) {
              const hasG = k === 1 && tk && isStatus(tk);
              gl.appendChild(txt(fmt0.full(v), x0 + 8 + (hasG ? 16 : 0), yy + bwid / 2, 'ch-v', 'start', { dy: '.35em' }));
              if (hasG) gl.appendChild(S('g', { transform: `translate(${r1(x0 + 14)} ${r1(yy + bwid / 2)}) scale(.78)` }, glyphG(tk)));
            }
            if (k > 1) {
              const hit = S('rect', { x: l, y: r1(yy - 1), width: r1(plotW), height: r1(bwid + 2), class: 'ch-hit' });
              svg.appendChild(hit);
              chart.addMark({ el: hit, vis: visEls.slice(-1), tip: tipFor(c, si), label: ariaFor(c), pref: 'right', select: catPick(c) });
            }
          });
          if (k === 1) {
            const hit = S('rect', { x: 0, y: r1(cy - pitch / 2), width: W, height: r1(pitch), class: 'ch-hit' });
            svg.appendChild(hit);
            chart.addMark({ el: hit, vis: visEls, tip: tipFor(c), label: ariaFor(c), pref: 'right', select: catPick(c), anchorEl: null });
          }
        }
        if (stacked) {
          const hit = S('rect', { x: 0, y: r1(cy - pitch / 2), width: W, height: r1(pitch), class: 'ch-hit' });
          svg.appendChild(hit);
          chart.addMark({ el: hit, vis: visEls, tip: tipFor(c), label: ariaFor(c), pref: 'right', select: catPick(c) });
        }
      });
    }
    return H0;
  }

  // Table twin for bar and stack: a row per category, a column per series, plus Total for stacks.
  const barTable = (m, chart) => {
    const spec = m.spec, fmt0 = resolveFormat(spec.format, F.num);
    const head = [spec.categoryLabel || 'Category'].concat(m.series.map((s) => s.name));
    if (m.stacked && m.series.length > 1) head.push('Total');
    const rows = m.order.map((c) => {
      const row = [m.cats[c]].concat(m.series.map((s) => (s.values[c] == null ? '-' : fmt0.full(s.values[c]))));
      if (m.stacked && m.series.length > 1) row.push(fmt0.full(m.series.reduce((a, s) => a + (isNum(s.values[c]) ? s.values[c] : 0), 0)));
      return row;
    });
    return { head, rows };
  };
  // One legend entry per series, shown as a square in that series' colour.
  const barLegend = (m) => m.series.map((s) => ({ id: s.id, name: s.name, key: s.key, css: s.css, kind: 'rect' }));

  // bar and stack share the model builder and draw function; stack forces horizontal bars from spec.parts.
  TYPES.bar = { noun: 'Bar chart', table: true, model: (s, c) => barModel(s, c, false), draw: barDraw, legend: barLegend, tableFn: barTable };
  TYPES.bar.table = barTable;
  // The stack chart type: horizontal stacked bars built from spec.parts.
  TYPES.stack = { noun: 'Stacked bar chart', table: true, model: (s, c) => barModel(s, c, true), draw: barDraw, legend: barLegend };
  TYPES.stack.table = barTable;

  /* =====================================================================================================
   * 9. HISTOGRAM
   * spec: { values:[], binSize, min?, max?, format, refLines:[{x|value,label,tone}], series?:[{id,name,values}] (overlay step outlines over the pooled bars),
   *         x:{label}, y:{label}, height? }
   * ===================================================================================================== */
  // Bins the values and any overlay series with shared bin edges, so bars and step outlines line up.
  function histModel(spec, chart) {
    const base = Array.isArray(spec.values) ? spec.values.filter(isNum) : [];
    const ov = (Array.isArray(spec.series) ? spec.series : []).filter((s) => s && Array.isArray(s.values)).map((s, i) => {
      const st = styleOf(s, i); const id = s.id != null ? String(s.id) : 'series' + i;
      return { id, name: s.name != null ? String(s.name) : id, key: st.key, css: st.css, values: s.values.filter(isNum), hidden: chart.hidden.has(id) };
    });
    const pool = base.slice(); ov.forEach((s) => s.values.forEach((v) => pool.push(v)));
    const b = M.binValues(pool, spec.binSize, spec.min, spec.max);
    const empty = !pool.length;
    const counts = empty ? [] : (base.length ? M.binValues(base, b.binSize, b.lo, b.hi).counts : null);
    const ovCounts = ov.map((s) => M.binValues(s.values, b.binSize, b.lo, b.hi));
    const overflow = isNum(spec.max) ? b.overflow : 0, under = isNum(spec.min) ? b.under : 0;
    return { spec, b, base, counts, ov, ovCounts, empty, overflow, under, summary: pool.length + ' values in ' + b.n + ' bins' + (under ? ', ' + under + ' below ' + b.lo + ' left out' : '') };
  }
  // Draws a count bar per bin, optional step outlines for overlay series, axes and reference lines; a hover
  // area per bin. Returns the height.
  function histDraw(chart, m, svg, W) {
    const spec = m.spec, b = m.b, xc = Object.assign({}, spec.x, { format: spec.format != null ? spec.format : (spec.x && spec.x.format) });
    const yc = spec.y || {};
    const H0 = isNum(spec.height) ? spec.height : W < 420 ? 220 : 250;
    const visOv = m.ov.map((s, i) => ({ s, c: m.ovCounts[i].counts })).filter((o) => !o.s.hidden);
    let maxC = 1; (m.counts || []).forEach((c) => { if (c > maxC) maxC = c; }); visOv.forEach((o) => o.c.forEach((c) => { if (c > maxC) maxC = c; }));
    const fmtY = F.int;
    const probe = valueAxis(yc, 0, maxC, H0 - 50, { format: 'int', zero: 'force', spacing: 40 });
    let yw = 0; probe.ticks.forEach((t) => { yw = Math.max(yw, chart.tw(t.label, 12)); });
    const l = Math.ceil(yw) + 14, r = W - 14, top = 10 + (yc.label ? 16 : 0), bot = H0 - 30 - (xc.label ? 14 : 0);
    const ax = valueAxis(yc, 0, maxC, bot - top, { format: 'int', zero: 'force', spacing: 40 });
    const Y = M.linear(ax.d0, ax.d1, bot, top);
    const xAx = numAxis(xc, 'linear', b.lo, b.hi, r - l, { nice: false });
    const X = M.linear(b.lo, b.hi, l, r);
    drawYAxis(svg, chart, ax, Y, l, r);
    const g1 = S('g', { class: 'ch-g-bars ch-rv-up' });
    svg.appendChild(g1);
    const showBase = m.counts && m.counts.length;
    const baseKey = visOv.length ? 'muted' : 'cat1';
    const total = b.total;
    // Tooltip for bin i: count and share of the total, each overlay's count, and a note when values above
    // the maximum were piled into the last bin.
    const tipFor = (i) => {
      const a = b.lo + i * b.binSize, e = a + b.binSize;
      const rows = [];
      if (showBase) rows.push({ key: { css: css(baseKey), shape: 'box' }, v: String(m.counts[i]) + (total ? ' (' + F.pct100.full((m.counts[i] / total) * 100) + ')' : ''), k: visOv.length ? 'All' : (spec.unit || 'Count') });
      visOv.forEach((o) => rows.push({ key: { css: o.s.css }, v: String(o.c[i]), k: o.s.name }));
      const t = { head: xAx.full(a) + ' to ' + xAx.full(e), rows };
      if (i === b.n - 1 && m.overflow) t.note = 'Includes ' + m.overflow + ' above ' + xAx.full(b.cap) + '.';
      // Values below the chart's minimum are left out of the bars and the shares, so the first bin says so.
      if (i === 0 && m.under) t.note = 'Leaves out ' + m.under + ' below ' + xAx.full(b.lo) + '; shares are of the rest.';
      return t;
    };
    for (let i = 0; i < b.n; i++) {
      const x0 = X(b.lo + i * b.binSize), x1 = X(b.lo + (i + 1) * b.binSize);
      const vis = [];
      if (showBase && m.counts[i] > 0) {
        // A non-empty bin always gets at least a 2 px bar so it stays visible.
        const hh = bot - Y(m.counts[i]);
        const d = barPath(x0 + 1, bot - Math.max(2, hh), Math.max(1, x1 - x0 - 2), Math.max(2, hh), Math.min(4, (x1 - x0 - 2) / 2), 'up');
        const p = chart.fillShape(svg, g1, d, baseKey);
        if (visOv.length) p.style.fillOpacity = '.42';
        vis.push(p);
      }
      const hit = S('rect', { x: r1(x0), y: top, width: r1(Math.max(1, x1 - x0)), height: r1(bot - top), class: 'ch-hit' });
      svg.appendChild(hit);
      chart.addMark({ el: hit, vis, tip: tipFor(i), label: tipFor(i).head + ': ' + [showBase ? m.counts[i] : ''].concat(visOv.map((o) => o.s.name + ' ' + o.c[i])).filter((q) => q !== '').join(', '), pref: 'top', select: { bin: i, from: b.lo + i * b.binSize, to: b.lo + (i + 1) * b.binSize } });
    }
    // overlay step outlines
    const go = S('g', { class: 'ch-g-ov ch-rv-right' });
    visOv.forEach((o, oi) => {
      let d = '';
      for (let i = 0; i < b.n; i++) {
        const x0 = r1(X(b.lo + i * b.binSize)), x1 = r1(X(b.lo + (i + 1) * b.binSize)), y = r1(Y(o.c[i]));
        d += (i === 0 ? 'M' + x0 + ' ' + r1(bot) + 'V' + y : 'V' + y) + 'H' + x1;
      }
      d += 'V' + r1(bot);
      go.appendChild(S('path', { d: d + 'Z', style: 'fill:' + o.s.css + ';fill-opacity:.1;stroke:none' }));
      go.appendChild(S('path', { d: d.replace(/Z$/, ''), class: 'ch-ln', style: 'stroke:' + o.s.css + ';stroke-linejoin:miter', 'stroke-dasharray': visOv.length >= 2 ? [null, '9 4', '2 4', '9 4 2 4'][oi % 4] : null }));
    });
    svg.appendChild(go);
    drawRefLines(svg, chart, (spec.refLines || []).map((q) => (q.value == null && q.x != null ? Object.assign({}, q, { value: q.x }) : q)), { orient: 'v', scale: X, l, r, t: top, b: bot });
    drawXAxis(svg, chart, xAx, X, l, r, bot, W);
    if (yc.label) svg.appendChild(txt(yc.label, 0, 12, 'ch-axt'));
    if (xc.label) svg.appendChild(txt(xc.label, r, H0 - 3, 'ch-axt', 'end'));
    return H0;
  }
  TYPES.hist = {
    noun: 'Histogram', table: true, model: histModel, draw: histDraw,
    // Legend with overlays: an "All" square (not clickable) plus a clickable line per overlay; else none.
    legend(m) {
      if (!m.ov.length) return [];
      const items = [];
      if (m.counts && m.counts.length) items.push({ id: '__all', name: 'All', key: 'muted', css: css('muted'), kind: 'rect', static: true });
      m.ov.forEach((s) => items.push({ id: s.id, name: s.name, key: s.key, css: s.css, kind: 'line' }));
      return items;
    },
    // Table twin: a row per bin range with the pooled count and each overlay's count.
    table(m, chart) {
      const spec = m.spec, b = m.b, fmt = resolveFormat(spec.format, F.num);
      const head = ['Range'].concat(m.counts && m.counts.length ? [m.ov.length ? 'All' : 'Count'] : []).concat(m.ov.map((s) => s.name));
      const rows = [];
      for (let i = 0; i < b.n; i++) {
        const a = b.lo + i * b.binSize;
        rows.push([fmt.full(a) + ' to ' + fmt.full(a + b.binSize)].concat(m.counts && m.counts.length ? [m.counts[i]] : []).concat(m.ovCounts.map((o) => o.counts[i])));
      }
      return { head, rows };
    },
  };

  /* =====================================================================================================
   * 10. HEAT (sequential or diverging, 7 classes, in-cell text only when it fits)
   * spec: { rows:[], cols:[], values:[[]], scale:'seq'|'div', format, legendLabel, min?, max?, mid?, extent?, cellText:'auto'|'none', height? }
   * ===================================================================================================== */
  // Colour keys for the 7 classes, lowest to highest: sequential, or diverging (negative, middle,
  // positive).
  const SEQ_KEYS = ['seq1', 'seq2', 'seq3', 'seq4', 'seq5', 'seq6', 'seq7'];
  const DIV_KEYS = ['divn3', 'divn2', 'divn1', 'div0', 'divp1', 'divp2', 'divp3'];
  // Builds the value grid and cls(v), which puts a value in one of 7 colour classes (0 to 6; -1 means no
  // data). Diverging centres on mid; sequential spreads lo to hi evenly.
  function heatModel(spec, chart) {
    const rows = Array.isArray(spec.rows) ? spec.rows.map((x) => (x == null ? '' : String(x))) : [];
    const cols = Array.isArray(spec.cols) ? spec.cols.map((x) => (x == null ? '' : String(x))) : [];
    const values = rows.map((_, r) => cols.map((_, c) => { const v = spec.values && spec.values[r] ? spec.values[r][c] : null; return isNum(v) ? v : null; }));
    let mn = Infinity, mx = -Infinity;
    values.forEach((row) => row.forEach((v) => { if (v != null) { if (v < mn) mn = v; if (v > mx) mx = v; } }));
    const has = isFinite(mn);
    const div = spec.scale === 'div';
    const lo = isNum(spec.min) ? spec.min : has ? mn : 0, hi = isNum(spec.max) ? spec.max : has ? mx : 1;
    const mid = isNum(spec.mid) ? spec.mid : 0;
    const extent = isNum(spec.extent) && spec.extent > 0 ? spec.extent : Math.max(Math.abs(lo - mid), Math.abs(hi - mid)) || 1;
    // Colour class 0 to 6 for a value; -1 for missing data.
    const cls = (v) => {
      if (v == null) return -1;
      if (div) return clamp(Math.round(((v - mid) / extent) * 3) + 3, 0, 6);
      if (hi === lo) return 3;
      return clamp(Math.floor(((v - lo) / (hi - lo)) * 7), 0, 6);
    };
    return { spec, rows, cols, values, div, lo, hi, mid, extent, cls, keys: div ? DIV_KEYS : SEQ_KEYS, empty: !rows.length || !cols.length || !has, grid: { rows: rows.length, cols: cols.length }, summary: rows.length + ' by ' + cols.length + ' grid' };
  }
  // Draws the grid of coloured cells with row and column labels, the value inside a cell when it fits, and
  // a 7-step colour scale underneath. Returns the height.
  function heatDraw(chart, m, svg, W) {
    const spec = m.spec, fmt = resolveFormat(spec.format, F.num);
    const nr = m.rows.length, nc = m.cols.length;
    const labW = Math.min(Math.max(70, W * 0.28), Math.ceil(Math.max.apply(null, m.rows.map((t) => chart.tw(t, 12)))) + 4);
    const l = labW + 10, r = W - 4;
    const cw = (r - l) / nc;
    const ch_ = isNum(spec.cellHeight) ? spec.cellHeight : clamp(cw * 0.72, 22, 36);
    const top = 24;
    const bodyH = nr * ch_;
    // column labels: stride so they never collide
    const maxCol = Math.max.apply(null, m.cols.map((t) => chart.tw(t, 12)));
    const stride = Math.max(1, Math.ceil((maxCol + 8) / cw));
    m.cols.forEach((c, i) => { if (i % stride === 0) svg.appendChild(txt(chart.fit(c, cw * stride - 4, 12), l + (i + 0.5) * cw, 14, 'ch-t', 'middle')); });
    m.rows.forEach((t, i) => svg.appendChild(txt(chart.fit(t, labW, 12), l - 10, top + (i + 0.5) * ch_, 'ch-t', 'end', { dy: '.35em' })));
    // text fits?
    let widest = 0; m.values.forEach((row) => row.forEach((v) => { if (v != null) widest = Math.max(widest, chart.tw(fmt.full(v), 12, 600)); }));
    const showText = spec.cellText !== 'none' && widest + 8 <= cw - 2 && ch_ >= 18;
    const gcells = S('g', { class: 'ch-g-cells ch-rv-fade' });
    svg.appendChild(gcells);
    const gt = S('g', { class: 'ch-g-vals' });
    const label = spec.legendLabel || 'Value';
    for (let ri = 0; ri < nr; ri++) for (let ci = 0; ci < nc; ci++) {
      const v = m.values[ri][ci], k = m.cls(v);
      const x = l + ci * cw + 1, y = top + ri * ch_ + 1, w = cw - 2, h = ch_ - 2;
      let cell;
      if (k < 0) cell = S('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(h), rx: 3, fill: 'none', style: 'stroke:var(--ch-grid);stroke-width:1' });
      else cell = S('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(h), rx: 3, style: 'fill:' + css(m.keys[k]) });
      gcells.appendChild(cell);
      if (k >= 0 && showText) gt.appendChild(txt(fmt.full(v), x + w / 2, y + h / 2, 'ch-in', 'middle', { dy: '.35em', style: 'fill:' + chart.inkOn(m.keys[k]) }));
      const tip = { head: m.rows[ri] + ', ' + m.cols[ci], rows: k < 0 ? [] : [{ key: { css: css(m.keys[k]), shape: 'box' }, v: fmt.full(v), k: label }], note: k < 0 ? 'No data' : null };
      chart.addMark({ el: cell, vis: [cell], tip, label: m.rows[ri] + ', ' + m.cols[ci] + ': ' + (k < 0 ? 'no data' : fmt.full(v)), pref: 'top', select: { row: m.rows[ri], col: m.cols[ci], value: v, r: ri, c: ci }, rc: [ri, ci] });
      // An empty cell has no fill, so it needs this to receive pointer events.
      if (k < 0) { cell.style.pointerEvents = 'all'; }
    }
    svg.appendChild(gt);
    // scale legend: seven classes, end labels (and midpoint for diverging)
    const ly = top + bodyH + 16;
    const sw = 22, gap = 2, sh = 10;
    const bar = 7 * sw + 6 * gap;
    const loL = fmt.full(m.lo), hiL = fmt.full(m.hi);
    const lw = chart.tw(loL, 12), hw = chart.tw(hiL, 12);
    const labT = spec.legendLabel ? chart.fit(String(spec.legendLabel), Math.max(60, W - 8), 12) : '';
    const legW = labT ? chart.tw(labT, 12) : 0;
    const rampW = lw + 8 + bar + 8 + hw;
    const inline = labT && l + legW + 14 + rampW <= W;                 // label and ramp share a row when they fit, else the label gets its own row
    let lx = l, ly2 = ly;
    if (labT && inline) { svg.appendChild(txt(labT, l, ly + 9, 'ch-axt', 'start')); lx = l + legW + 14; }
    else if (labT) { svg.appendChild(txt(labT, l, ly + 9, 'ch-axt', 'start')); ly2 = ly + 20; }
    if (!inline && lx + rampW > W) lx = Math.max(0, W - rampW);
    const x0 = lx + lw + 8;
    svg.appendChild(txt(loL, lx, ly2 + 9, 'ch-t', 'start'));
    m.keys.forEach((kk, i) => svg.appendChild(S('rect', { x: r1(x0 + i * (sw + gap)), y: ly2, width: sw, height: sh, rx: 2, style: 'fill:' + css(kk) })));
    svg.appendChild(txt(hiL, x0 + bar + 8, ly2 + 9, 'ch-t', 'start'));
    if (m.div) svg.appendChild(txt(fmt.full(m.mid), x0 + 3 * (sw + gap) + sw / 2, ly2 + sh + 13, 'ch-t', 'middle'));
    return ly2 + sh + (m.div ? 18 : 6);
  }
  TYPES.heat = {
    noun: 'Heat map', table: true, model: heatModel, draw: heatDraw,
    // Table twin: row labels down the side, a column per column label, "-" for missing values.
    table(m, chart) {
      const fmt = resolveFormat(m.spec.format, F.num);
      return { head: [m.spec.rowLabel || ''].concat(m.cols), rows: m.rows.map((r, ri) => [r].concat(m.values[ri].map((v) => (v == null ? '-' : fmt.full(v))))) };
    },
  };

  /* =====================================================================================================
   * 11. SCATTER (nearest-point hover with a generous hit radius, one path per series, shape + colour per series)
   * spec: { series:[{id,name,points:[[x,y,label?]],shape?}], x:{type:'linear'|'time'|'hour',format,min,max,label}, y:{format,min,max,label}, refLines:[{x|y,label,tone}], height? }
   * ===================================================================================================== */
  // Cleans the series (a point needs numeric x and y; a third item is an optional label) and gives each
  // series a marker shape in turn.
  function scatterModel(spec, chart) {
    const list = Array.isArray(spec.series) ? spec.series.filter((s) => s && Array.isArray(s.points)) : [];
    const series = list.map((s, i) => {
      const st = styleOf(s, i); const id = s.id != null ? String(s.id) : 'series' + i;
      const pts = []; for (const p of s.points) if (p && isNum(p[0]) && isNum(p[1])) pts.push({ x: p[0], y: p[1], label: p[2] != null ? String(p[2]) : '' });
      return { id, name: s.name != null ? String(s.name) : id, key: st.key, css: st.css, shape: s.shape && SHAPES.indexOf(s.shape) >= 0 ? s.shape : SHAPES[i % 4], pts, hidden: chart.hidden.has(id) };
    });
    const vis = series.filter((s) => !s.hidden);
    const count = vis.reduce((a, s) => a + s.pts.length, 0);
    return { spec, series, vis, count, empty: !series.length || !series.some((s) => s.pts.length), summary: count + ' points' };
  }
  // Draws one path of markers per series with grid, axes and reference lines. Hover finds the nearest point
  // within 28 px; arrow keys walk the points left to right. Returns the height.
  function scatterDraw(chart, m, svg, W) {
    const spec = m.spec, xc = spec.x || {}, yc = spec.y || {};
    const H0 = isNum(spec.height) ? spec.height : W < 420 ? 250 : 290;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    m.vis.forEach((s) => s.pts.forEach((p) => { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }));
    (spec.refLines || []).forEach((q) => { if (q && isNum(q.y)) { y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); } if (q && isNum(q.x)) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); } });
    if (!isFinite(x0)) { x0 = 0; x1 = 1; } if (!isFinite(y0)) { y0 = 0; y1 = 1; }
    const kind = xc.type === 'time' ? 'time' : xc.type === 'hour' ? 'hour' : 'linear';
    const probe = valueAxis(yc, y0, y1, H0 - 50, { format: yc.format, zero: yc.zero === true ? 'force' : false, spacing: 42 });
    let yw = 0; probe.ticks.forEach((t) => { yw = Math.max(yw, chart.tw(t.label, 12)); });
    const l = Math.ceil(yw) + 14, r = W - 16, top = 10 + (yc.label ? 16 : 0), bot = H0 - 30 - (xc.label ? 14 : 0);
    const ax = valueAxis(yc, y0, y1, bot - top, { format: yc.format, zero: yc.zero === true ? 'force' : false, spacing: 42 });
    const Y = M.linear(ax.d0, ax.d1, bot, top);
    const xAx = numAxis(xc, kind, x0, x1, r - l, { nice: kind === 'linear' });
    const X = M.linear(xAx.d0, xAx.d1, l, r);
    drawYAxis(svg, chart, ax, Y, l, r);
    drawXAxis(svg, chart, xAx, X, l, r, bot, W, { grid: true, gridTop: top });
    const refsY = (spec.refLines || []).filter((q) => q && isNum(q.y)), refsX = (spec.refLines || []).filter((q) => q && isNum(q.x));
    drawRefLines(svg, chart, refsY, { orient: 'h', scale: Y, l, r, t: top, b: bot, part: 'lines' });
    drawRefLines(svg, chart, refsX, { orient: 'v', scale: X, l, r, t: top, b: bot, part: 'lines' });
    if (yc.label) svg.appendChild(txt(yc.label, 0, 12, 'ch-axt'));
    if (xc.label) svg.appendChild(txt(xc.label, r, H0 - 3, 'ch-axt', 'end'));
    // Smaller markers for crowded charts: 4.5 px up to 300 points, 3.5 up to 2000, then 2.5.
    const rad = m.count <= 300 ? 4.5 : m.count <= 2000 ? 3.5 : 2.5;
    const gm = S('g', { class: 'ch-g-marks ch-rv-fade' });
    svg.appendChild(gm);
    const all = [];                                           // flattened for nearest-point and keyboard
    m.vis.forEach((s) => {
      let d = '';
      s.pts.forEach((p) => { const cx = X(p.x), cy = Y(p.y); p.px = cx; p.py = cy; p.s = s; d += pointShape(s.shape, cx, cy, rad); all.push(p); });
      // Crowded charts get see-through markers (no outline above 2000 points) so overlap shows density.
      gm.appendChild(S('path', { d, style: 'fill:' + s.css + ';fill-opacity:' + (m.count > 300 ? '.7' : '1') + ';stroke:var(--ch-surface);stroke-width:' + (m.count > 2000 ? 0 : 1.5) }));
    });
    drawRefLines(svg, chart, refsY, { orient: 'h', scale: Y, l, r, t: top, b: bot, part: 'labels' });      // labels sit above the dots
    drawRefLines(svg, chart, refsX, { orient: 'v', scale: X, l, r, t: top, b: bot, part: 'labels' });
    const over = S('g', { 'pointer-events': 'none' });
    const halo = S('circle', { r: rad + 5, fill: 'none', style: 'stroke:var(--ch-text);stroke-width:2', visibility: 'hidden' });
    over.appendChild(halo);
    const hit = S('rect', { x: l - 8, y: top - 8, width: r - l + 16, height: bot - top + 16, class: 'ch-hit', style: 'touch-action:pan-y' });
    const kg = S('g', { tabindex: '0', role: 'group', class: 'ch-m ch-kbd', 'aria-label': (spec.title || 'Scatter chart') + '. Use the arrow keys to move between points.' }, S('rect', { x: l - 2, y: top - 2, width: r - l + 4, height: bot - top + 4, fill: 'none', 'pointer-events': 'none' }));
    svg.append(hit, over, kg);
    const fx = xAx, fy = { full: ax.full };
    const byX = all.slice().sort((a, b) => a.px - b.px || a.py - b.py);
    // Tooltip for a point: label (or series name), x and y values, and the series name if labelled.
    function tipOf(p) {
      const xl = xc.label || 'X', yl = yc.label || 'Y';
      return { head: p.label || p.s.name, rows: [{ key: { css: p.s.css, shape: 'dot' }, v: fx.full(p.x), k: xl }, { key: null, v: fy.full(p.y), k: yl }], note: p.label && m.vis.length > 1 ? p.s.name : null };
    }
    // Rings the point, shows its tooltip, and announces it to screen readers when reached by keyboard.
    function show(p, kbd, evt) {
      halo.setAttribute('cx', r1(p.px)); halo.setAttribute('cy', r1(p.py)); halo.setAttribute('visibility', 'visible');
      const bb = svg.getBoundingClientRect();
      chart.tipShow(tipOf(p), { x: bb.left + p.px, y: bb.top + p.py, w: 0, h: 0 }, 'top');
      if (kbd) chart.say((p.label || p.s.name) + ': ' + fx.full(p.x) + ', ' + fy.full(p.y));
    }
    // Hides the ring and the tooltip.
    function off() { halo.setAttribute('visibility', 'hidden'); chart.tipHide(); }
    // The point closest to the pointer within 28 px, or null.
    function nearest(e) {
      const bb = svg.getBoundingClientRect(); const mx = e.clientX - bb.left, my = e.clientY - bb.top;
      let best = null, bd = 28 * 28;
      // binary-narrow on x then scan: the sorted list keeps this cheap for 10k points
      let lo = 0, hi = byX.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (byX[mid].px < mx) lo = mid + 1; else hi = mid; }
      for (let dir = -1; dir <= 1; dir += 2) {
        for (let i = lo + (dir < 0 ? -1 : 0); i >= 0 && i < byX.length; i += dir) {
          const p = byX[i]; const dx = p.px - mx; if (dx * dx > bd) break;
          const dy = p.py - my; const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = p; }
        }
      }
      return best;
    }
    hit.addEventListener('pointermove', (e) => { const p = nearest(e); if (p) show(p, false, e); else off(); });
    hit.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { const p = nearest(e); if (p) show(p, false, e); else off(); } });
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') off(); });
    hit.addEventListener('click', (e) => { const p = nearest(e); if (p && spec.onSelect) { try { spec.onSelect({ series: p.s.id, x: p.x, y: p.y, label: p.label }); } catch (err) { /* ignore */ } } });
    let ki = 0;
    kg.addEventListener('focus', () => { chart.kbd = true; if (byX.length) show(byX[ki], true); });
    kg.addEventListener('blur', () => { chart.kbd = false; off(); });
    kg.addEventListener('keydown', (e) => {
      if (!byX.length) return; const k = e.key; let n = ki;
      if (k === 'ArrowRight' || k === 'ArrowDown') n = Math.min(byX.length - 1, ki + 1); else if (k === 'ArrowLeft' || k === 'ArrowUp') n = Math.max(0, ki - 1);
      else if (k === 'Home') n = 0; else if (k === 'End') n = byX.length - 1; else return;
      e.preventDefault(); ki = n; show(byX[n], true);
    });
    return H0;
  }
  TYPES.scatter = {
    noun: 'Scatter plot', table: true, ownHover: true, model: scatterModel, draw: scatterDraw,
    // One legend entry per series, drawn with its own marker shape.
    legend: (m) => m.series.map((s) => ({ id: s.id, name: s.name, key: s.key, css: s.css, kind: s.shape === 'circle' ? 'dot' : s.shape })),
    // Table twin: a row per point (series, label, x, y).
    table(m, chart) {
      const spec = m.spec, xc = spec.x || {}, yc = spec.y || {};
      const kind = xc.type === 'time' ? 'time' : xc.type === 'hour' ? 'hour' : 'linear';
      const xa = numAxis(xc, kind, 0, 1, 300, {}); const ya = valueAxis(yc, 0, 1, 100, { format: yc.format });
      const rows = []; m.series.forEach((s) => s.pts.forEach((p) => rows.push([s.name, p.label || '', xa.full(p.x), ya.full(p.y)])));
      return { head: ['Series', 'Label', xc.label || 'X', yc.label || 'Y'], rows };
    },
  };

  /* =====================================================================================================
   * 12. DUMBBELL (starter vs learned, optional third marker, gap emphasised)
   * spec: { rows:[{label,a,b,c?,aLabel,bLabel,cLabel,flag?}], format, aName,bName,cName, flagWord, flagTone, sort:'gap'|'none', x:{label,max}, height? }
   * ===================================================================================================== */
  // Keeps the rows that have a or b, and sorts by the size of the change when spec.sort is 'gap'.
  function dumbModel(spec, chart) {
    let rows = (Array.isArray(spec.rows) ? spec.rows : []).filter((r) => r && (isNum(r.a) || isNum(r.b))).map((r, i) => ({
      i, label: r.label == null ? '' : String(r.label), a: isNum(r.a) ? r.a : null, b: isNum(r.b) ? r.b : null, c: isNum(r.c) ? r.c : null,
      aLabel: r.aLabel, bLabel: r.bLabel, cLabel: r.cLabel, flag: r.flag,
    }));
    if (spec.sort === 'gap') rows.sort((p, q) => Math.abs((q.b == null || q.a == null ? 0 : q.b - q.a)) - Math.abs((p.b == null || p.a == null ? 0 : p.b - p.a)) || p.i - q.i);
    const hasC = rows.some((r) => r.c != null);
    return { spec, rows, hasC, empty: !rows.length, summary: rows.length + ' rows' };
  }
  // Draws a row per item: open ring for a (starter), solid dot for b (learned), tick for c (observed), a
  // bar joining a and b, value labels and an optional flag word with a status shape. Returns the height.
  function dumbDraw(chart, m, svg, W) {
    const spec = m.spec, fmt = resolveFormat(spec.format, F.num);
    const aName = spec.aName || 'Starter', bName = spec.bName || 'Learned', cName = spec.cName || 'Observed';
    const n = m.rows.length;
    const flagTone = keyOfTone(spec.flagTone) || 'warn';
    const flagWord = spec.flagWord || 'Off estimate';
    const anyFlag = m.rows.some((r) => r.flag);
    const labW = Math.min(Math.max(80, W * 0.34), Math.ceil(Math.max.apply(null, m.rows.map((r) => chart.tw(r.label, 12)))) + 4);
    const flagRoom = anyFlag ? (W < 520 ? 22 : chart.tw(flagWord, 12, 600) + 28) : 0;
    const lblRoom = Math.max.apply(null, m.rows.map((r) => Math.max(chart.tw(r.bLabel != null ? String(r.bLabel) : fmt.full(r.b == null ? 0 : r.b), 12, 600), chart.tw(r.cLabel != null ? String(r.cLabel) : '', 12, 600)))) + 12;
    const l = labW + 12, r = W - 10 - flagRoom - lblRoom * 0 - 6;
    const pitch = isNum(spec.height) ? (spec.height - 34) / Math.max(1, n) : 36;
    const top = 6, bot = top + n * pitch, H0 = bot + 30;
    // The scale runs from zero, or lower when a value is below zero, so no dot lands in the row labels.
    let mx = 0, mn = 0; m.rows.forEach((q) => { [q.a, q.b, q.c].forEach((v) => { if (v != null && v > mx) mx = v; if (v != null && v < mn) mn = v; }); });
    const ax = valueAxis(spec.x || {}, mn, mx || 1, r - l - lblRoom, { format: spec.format, zero: 'force', spacing: 70, maxTicks: 6 });
    // domain padded on the right so end labels fit
    const V = M.linear(ax.d0, ax.d1, l, r - lblRoom);
    ax.ticks.forEach((t) => { const x = V(t.v); svg.appendChild(vline(x, top, bot, Math.abs(t.v - ax.d0) < 1e-9 ? 'ch-ax' : 'ch-gl')); });
    let prevEnd = -1e9;
    ax.ticks.forEach((t) => { const x = V(t.v), lw = chart.tw(t.label, 12); const s0 = x - lw / 2; if (s0 < prevEnd + 8) return; prevEnd = s0 + lw; svg.appendChild(txt(t.label, x, bot + 18, 'ch-t', 'middle')); });
    if ((spec.x || {}).label) svg.appendChild(txt(spec.x.label, r, H0 - 2, 'ch-axt', 'end'));
    const g1 = S('g', { class: 'ch-g-marks ch-rv-fade' });
    svg.appendChild(g1);
    m.rows.forEach((q, i) => {
      const cy = top + (i + 0.5) * pitch;
      svg.appendChild(txt(chart.fit(q.label, labW, 12), l - 12, cy, 'ch-t', 'end', { dy: '.35em' }));
      const pa = q.a == null ? null : V(q.a), pb = q.b == null ? null : V(q.b), pc = q.c == null ? null : V(q.c);
      const flagged = !!q.flag; const ftone = flagged ? (typeof q.flag === 'string' && keyOfTone(q.flag) && isStatus(keyOfTone(q.flag)) ? keyOfTone(q.flag) : flagTone) : null;
      const vis = [];
      if (pa != null && pb != null && Math.abs(pb - pa) > 0.5) {
        const x1 = Math.min(pa, pb), x2 = Math.max(pa, pb);
        const conn = S('path', { d: barPath(x1, cy - 2, x2 - x1, 4, 2, 'all'), style: 'fill:' + (flagged ? css(ftone) : css('muted')) + ';fill-opacity:' + (flagged ? 1 : 0.6) });
        g1.appendChild(conn); vis.push(conn);
      }
      const R = 5.5;
      // the observed value is a tick taller than the dots and drawn behind them, so it still shows when it lands on the learned dot
      if (pc != null) { const c = S('path', { d: barPath(pc - 2, cy - 12, 4, 24, 2, 'all'), class: 'ch-ring', style: 'fill:' + css('cat2') }); g1.appendChild(c); vis.push(c); }
      if (pa != null) { const c = S('circle', { cx: r1(pa), cy: r1(cy), r: R - 1, style: 'fill:var(--ch-surface);stroke:' + css('text2') + ';stroke-width:2' }); g1.appendChild(c); vis.push(c); }
      if (pb != null) { const c = S('circle', { cx: r1(pb), cy: r1(cy), r: R, class: 'ch-ring', style: 'fill:' + css('cat1') }); g1.appendChild(c); vis.push(c); }
      // value labels: smaller end on its left, larger end on its right; one combined label when the ends nearly touch
      const aT = q.a == null ? null : (q.aLabel != null ? String(q.aLabel) : fmt.full(q.a)), bT = q.b == null ? null : (q.bLabel != null ? String(q.bLabel) : fmt.full(q.b));
      let rightmost = Math.max(pa == null ? -1e9 : pa, pb == null ? -1e9 : pb, pc == null ? -1e9 : pc);
      if (pa != null && pb != null) {
        const lowP = Math.min(pa, pb), highP = Math.max(pa, pb), lowT = pa <= pb ? aT : bT, highT = pa <= pb ? bT : aT;
        const both = aT === bT ? bT : aT + ' to ' + bT;
        // Ends that nearly touch share one label on the right; when it does not fit, each end keeps its own label
        // outside the pair, so the starter value is never dropped.
        if (highP - lowP < chart.tw(lowT, 12) + 16 && highP + 14 + chart.tw(both, 12, 600) <= W - flagRoom - 4) {
          svg.appendChild(txt(both, highP + 14, cy, 'ch-v', 'start', { dy: '.35em' }));
        } else {
          svg.appendChild(txt(lowT, lowP - 11, cy, 'ch-lbl2', 'end', { dy: '.35em' }));
          svg.appendChild(txt(highT, highP + 11, cy, 'ch-v', 'start', { dy: '.35em' }));
        }
      } else if (pb != null) svg.appendChild(txt(bT, pb + 11, cy, 'ch-v', 'start', { dy: '.35em' }));
      else if (pa != null) svg.appendChild(txt(aT, pa + 11, cy, 'ch-v', 'start', { dy: '.35em' }));
      if (flagged) {
        const fx = W - 6;
        if (W >= 520) { svg.appendChild(txt(flagWord, fx, cy, 'ch-lbl ch-in', 'end', { dy: '.35em' })); svg.appendChild(S('g', { transform: `translate(${r1(fx - chart.tw(flagWord, 12, 600) - 12)} ${r1(cy)}) scale(.85)` }, glyphG(ftone))); }
        else svg.appendChild(S('g', { transform: `translate(${r1(fx - 8)} ${r1(cy)}) scale(.85)` }, glyphG(ftone)));
      }
      const rows = [];
      if (q.a != null) rows.push({ key: { css: css('text2'), shape: 'ring' }, v: aT, k: aName });
      if (q.b != null) rows.push({ key: { css: css('cat1'), shape: 'dot' }, v: bT, k: bName });
      if (q.c != null) rows.push({ key: { css: css('cat2'), shape: 'box' }, v: q.cLabel != null ? String(q.cLabel) : fmt.full(q.c), k: cName });
      if (q.a != null && q.b != null) { const d = q.b - q.a; rows.push({ key: null, v: (d >= 0 ? '+' : '-') + fmt.full(Math.abs(d)), k: 'Change' }); }
      const hit = S('rect', { x: 0, y: r1(cy - pitch / 2), width: W, height: r1(pitch), class: 'ch-hit' });
      svg.appendChild(hit);
      const tip = { head: q.label, rows }; if (flagged) tip.st = { tone: ftone, word: typeof q.flag === 'string' && !keyOfTone(q.flag) ? q.flag : flagWord };
      chart.addMark({ el: hit, vis, tip, label: q.label + ': ' + rows.map((rw) => rw.k + ' ' + rw.v).join(', ') + (flagged ? ', ' + flagWord : ''), pref: 'top', select: { label: q.label, a: q.a, b: q.b, c: q.c, flag: q.flag } });
    });
    return H0;
  }
  TYPES.dumbbell = {
    noun: 'Dumbbell chart', table: true, model: dumbModel, draw: dumbDraw,
    // Fixed legend: ring = starter, dot = learned, tick = observed (only if a row has one).
    legend(m, chart) {
      const sp = m.spec;
      const items = [{ id: 'a', name: sp.aName || 'Starter', key: 'text2', css: css('text2'), kind: 'ring', static: true }, { id: 'b', name: sp.bName || 'Learned', key: 'cat1', css: css('cat1'), kind: 'dot', static: true }];
      if (m.hasC) items.push({ id: 'c', name: sp.cName || 'Observed', key: 'cat2', css: css('cat2'), kind: 'tick', static: true });
      return items;
    },
    // Table twin: item, a, b, optional c, change and flag word for each row.
    table(m) {
      const sp = m.spec, fmt = resolveFormat(sp.format, F.num);
      const head = ['Item', sp.aName || 'Starter', sp.bName || 'Learned'].concat(m.hasC ? [sp.cName || 'Observed'] : []).concat(['Change', 'Flag']);
      const rows = m.rows.map((q) => [q.label, q.a == null ? '-' : (q.aLabel != null ? q.aLabel : fmt.full(q.a)), q.b == null ? '-' : (q.bLabel != null ? q.bLabel : fmt.full(q.b))].concat(m.hasC ? [q.c == null ? '-' : (q.cLabel != null ? q.cLabel : fmt.full(q.c))] : []).concat([q.a != null && q.b != null ? (q.b - q.a >= 0 ? '+' : '-') + fmt.full(Math.abs(q.b - q.a)) : '-', q.flag ? (typeof q.flag === 'string' ? q.flag : sp.flagWord || 'Drifted') : '']));
      return { head, rows };
    },
  };

  /* =====================================================================================================
   * 13. GANTT (ticket anatomy, batch timelines)
   * spec: { rows:[{label, segments:[{start,end,tone,label?,name?}], marks?:[{at,label,tone?}]}], x:{type:'time'|'sec'|'hour',format,min,max,label},
   *         refLines:[{x|value,label,tone}], toneNames:{tone:name}, legend:false|[{tone,name}], height? }
   * ===================================================================================================== */
  // "reheat_check" becomes "Reheat check": underscores and dashes become spaces, first letter capital.
  const titleCase = (s) => String(s).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  // Cleans the rows: segments (swapped if reversed, sorted by start, colour from tone), event marks, and
  // the tones used for the legend.
  function ganttModel(spec, chart) {
    const rows = (Array.isArray(spec.rows) ? spec.rows : []).filter((r) => r).map((r) => {
      const segs = (Array.isArray(r.segments) ? r.segments : []).filter((s) => s && isNum(s.start) && isNum(s.end)).map((s) => {
        const a = Math.min(s.start, s.end), b = Math.max(s.start, s.end);
        const key = keyOfTone(s.tone) || 'cat1';
        return { start: a, end: b, tone: s.tone, key, label: s.label, name: s.name };
      }).sort((p, q) => p.start - q.start);
      const marks = (Array.isArray(r.marks) ? r.marks : []).filter((mk) => mk && isNum(mk.at)).map((mk) => ({ at: mk.at, label: mk.label, key: keyOfTone(mk.tone) || 'text', tone: mk.tone }));
      return { label: r.label == null ? '' : String(r.label), segs, marks };
    });
    const tones = []; const seen = new Set();
    rows.forEach((r) => r.segs.forEach((s) => { const t = s.tone == null ? 'cat1' : String(s.tone); if (!seen.has(t)) { seen.add(t); tones.push({ tone: t, key: s.key }); } }));
    const any = rows.some((r) => r.segs.length || r.marks.length);
    return { spec, rows, tones, empty: !rows.length || !any, summary: rows.length + ' rows' };
  }
  // Display name of a tone: the spec.toneNames entry if there is one, else the tone id made readable.
  function toneName(spec, t) { const tn = spec.toneNames || {}; if (tn[t] != null) return tn[t]; return titleCase(t); }
  // Draws a row per ticket or batch with coloured segments (2 px gaps), diamonds for events, a time axis
  // and reference lines. Returns the height.
  function ganttDraw(chart, m, svg, W) {
    const spec = m.spec, xc = spec.x || {};
    const kind = xc.type === 'time' ? 'time' : xc.type === 'hour' ? 'hour' : 'sec';
    let d0 = Infinity, d1 = -Infinity;
    m.rows.forEach((r) => { r.segs.forEach((s) => { d0 = Math.min(d0, s.start); d1 = Math.max(d1, s.end); }); r.marks.forEach((q) => { d0 = Math.min(d0, q.at); d1 = Math.max(d1, q.at); }); });
    (spec.refLines || []).forEach((q) => { const v = q && (q.value != null ? q.value : q.x); if (isNum(v)) { d1 = Math.max(d1, v); d0 = Math.min(d0, v); } });
    if (!isFinite(d0)) { d0 = 0; d1 = 1; }
    if (kind === 'sec' && d0 > 0 && !isNum(xc.min)) d0 = 0;
    const n = m.rows.length;
    const labW = Math.min(Math.max(70, W * 0.3), Math.ceil(Math.max.apply(null, m.rows.map((r) => chart.tw(r.label, 12)))) + 4);
    const l = labW + 12, r = W - 14;
    const pitch = isNum(spec.height) ? (spec.height - 32) / Math.max(1, n) : 32;
    const barH = Math.min(24, Math.max(10, pitch - 12));
    const refLab = (spec.refLines || []).some((q) => q && q.label);
    const top = 6 + (refLab ? 18 : 0), bot = top + n * pitch, H0 = bot + 30 + (xc.label ? 14 : 0);
    const ax = numAxis(xc, kind, d0, d1, r - l, { nice: false });
    const X = M.linear(ax.d0, ax.d1, l, r);
    drawXAxis(svg, chart, ax, X, l, r, bot, W, { grid: true, gridTop: top });
    svg.appendChild(hline(l, r, bot, 'ch-ax'));
    if (xc.label) svg.appendChild(txt(xc.label, r, H0 - 3, 'ch-axt', 'end'));
    const g1 = S('g', { class: 'ch-g-bars ch-rv-right' }), gl = S('g', { class: 'ch-g-vals ch-rv-fade' });
    svg.append(g1, gl);
    // Length text for a segment, converting from the axis unit (seconds, hours or milliseconds).
    const dur = (a, b) => (kind === 'sec' ? F.durS.full(b - a) : kind === 'hour' ? F.dur.full((b - a) * 3600e3) : F.dur.full(b - a));
    m.rows.forEach((row, ri) => {
      const cy = top + (ri + 0.5) * pitch;
      svg.appendChild(txt(chart.fit(row.label, labW, 12), l - 12, cy, 'ch-t', 'end', { dy: '.35em' }));
      // pixel intervals with a guaranteed 2px surface gap between touching neighbours
      const iv = row.segs.map((s) => ({ s, a: X(s.start), b: Math.max(X(s.end), X(s.start) + 3) }));
      for (let i = 1; i < iv.length; i++) {
        const p = iv[i - 1], q = iv[i];
        if (q.a - p.b < 2) { const mid = (p.b + q.a) / 2; if (mid - 1 - p.a >= 2) p.b = mid - 1; if (q.b - (mid + 1) >= 2) q.a = mid + 1; }
      }
      iv.forEach((q) => {
        const s = q.s;
        const d = barPath(q.a, cy - barH / 2, Math.max(2, q.b - q.a), barH, 4, 'all');
        const p = chart.fillShape(svg, g1, d, s.key);
        const lbl = s.label != null ? String(s.label) : '';
        if (lbl && chart.tw(lbl, 12, 600) + 12 <= q.b - q.a && barH >= 14) gl.appendChild(txt(lbl, (q.a + q.b) / 2, cy, 'ch-in', 'middle', { dy: '.35em', style: 'fill:' + chart.inkOn(s.key) }));
        const hit = S('rect', { x: r1(q.a - 1), y: r1(cy - pitch / 2), width: r1(Math.max(10, q.b - q.a + 2)), height: r1(pitch), class: 'ch-hit' });
        svg.appendChild(hit);
        const nm = s.name || (s.tone != null ? toneName(spec, String(s.tone)) : '') || lbl;
        const tk = isStatus(s.key) ? s.key : null;
        const tip = { head: row.label, rows: [{ key: { css: css(s.key), shape: 'box' }, v: dur(s.start, s.end), k: nm }], note: ax.full(s.start) + ' to ' + ax.full(s.end) };
        if (tk) tip.st = { tone: tk, word: nm };
        chart.addMark({ el: hit, vis: [p], tip, label: row.label + ', ' + nm + ', ' + dur(s.start, s.end) + ', ' + ax.full(s.start) + ' to ' + ax.full(s.end), pref: 'top', select: { row: row.label, start: s.start, end: s.end, tone: s.tone } });
      });
      row.marks.forEach((q) => {
        const x = X(q.at);
        const mk = S('path', { d: pointShape('diamond', x, cy, 4.2), class: 'ch-ring', style: 'fill:' + css(q.key === 'text' ? 'text' : q.key) });
        g1.appendChild(mk);
        const hit = S('rect', { x: r1(x - 11), y: r1(cy - pitch / 2), width: 22, height: r1(pitch), class: 'ch-hit' });
        svg.appendChild(hit);
        const tip = { head: row.label, rows: [{ key: { css: css(q.key === 'text' ? 'text' : q.key), shape: 'dot' }, v: ax.full(q.at), k: q.label || 'Event' }] };
        chart.addMark({ el: hit, vis: [mk], tip, label: row.label + ', ' + (q.label || 'event') + ' at ' + ax.full(q.at), pref: 'top' });
      });
    });
    drawRefLines(svg, chart, (spec.refLines || []).map((q) => (q.value == null && q.x != null ? Object.assign({}, q, { value: q.x }) : q)), { orient: 'v', scale: X, l, r, t: top, b: bot, labelAbove: true });
    return H0;
  }
  TYPES.gantt = {
    noun: 'Timeline', table: true, model: ganttModel, draw: ganttDraw,
    // Legend from spec.legend (false hides it, or a list of { tone, name }); else one entry per tone used.
    legend(m, chart) {
      const sp = m.spec;
      if (sp.legend === false) return [];
      if (Array.isArray(sp.legend)) return sp.legend.map((q, i) => { const key = keyOfTone(q.tone) || 'cat1'; return { id: 'lg' + i, name: q.name || titleCase(String(q.tone)), key, css: css(key), kind: 'rect', static: true }; });
      return m.tones.map((t) => ({ id: 'tone-' + t.tone, name: toneName(sp, t.tone), key: t.key, css: css(t.key), kind: 'rect', static: true }));
    },
    // Table twin: a line per segment (phase, start, end, length) and one per event mark.
    table(m, chart) {
      const sp = m.spec, xc = sp.x || {};
      const kind = xc.type === 'time' ? 'time' : xc.type === 'hour' ? 'hour' : 'sec';
      const ax = numAxis(xc, kind, 0, 1, 300, {});
      // Length text for a segment in the axis unit (same rule as in ganttDraw).
      const dur = (a, b) => (kind === 'sec' ? F.durS.full(b - a) : kind === 'hour' ? F.dur.full((b - a) * 3600e3) : F.dur.full(b - a));
      const rows = [];
      m.rows.forEach((r) => { r.segs.forEach((s) => rows.push([r.label, s.name || (s.tone != null ? toneName(sp, String(s.tone)) : '') || s.label || '', ax.full(s.start), ax.full(s.end), dur(s.start, s.end)])); r.marks.forEach((q) => rows.push([r.label, q.label || 'Event', ax.full(q.at), '', '']));});
      return { head: ['Row', 'Phase', 'Start', 'End', 'Length'], rows };
    },
  };

  /* =====================================================================================================
   * 14. METER (bullet bar for relative values) and RING (one headline value)
   * meter spec: { value, max, warn?, breach?, invert?, label, sub?, format, words?:{ok,warn,bad}, tone?, showMax? }
   *   warn / breach are thresholds on `value`: by default higher is worse (value >= breach = bad). invert:true = lower is worse (stock levels).
   * ring spec:  { value, max, label, sub, format, warn?, breach?, invert?, target?, words?, size? }
   * ===================================================================================================== */
  // Meter and ring status for value v: 'ok', 'warn' or 'bad' from the warn and breach limits (higher is
  // worse; invert flips it). Null when no limits are set.
  function stateOf(spec, v) {
    if (v == null) return null;
    const has = isNum(spec.warn) || isNum(spec.breach);
    if (!has) return null;
    if (spec.invert) {
      if (isNum(spec.breach) && v <= spec.breach) return 'bad';
      if (isNum(spec.warn) && v <= spec.warn) return 'warn';
      return 'ok';
    }
    if (isNum(spec.breach) && v >= spec.breach) return 'bad';
    if (isNum(spec.warn) && v >= spec.warn) return 'warn';
    return 'ok';
  }
  // The word shown with a status: spec.words overrides; defaults are On track / Near limit / Over limit
  // (inverted: Stocked / Getting low / Low).
  function stateWord(spec, st) {
    const base = spec.invert ? { ok: 'Stocked', warn: 'Getting low', bad: 'Low' } : { ok: 'On track', warn: 'Near limit', bad: 'Over limit' };
    return (spec.words && spec.words[st]) || base[st] || '';
  }
  // Shared by meter and ring: the value (null if missing), the full-scale max (defaults to the value, else
  // 1) and the status.
  function meterModel(spec) {
    const v = isNum(spec.value) ? spec.value : null;
    // WATCH OUT: with no max the value alone would fill the bar every time, so the scale reaches past the larger of
    // the value and the warn and breach limits, and the table says no full scale was set.
    const scaleSet = isNum(spec.max) && spec.max > 0;
    const top = Math.max(v != null && v > 0 ? v : 0, isNum(spec.warn) ? spec.warn : 0, isNum(spec.breach) ? spec.breach : 0);
    const max = scaleSet ? spec.max : top > 0 ? top * 1.25 : 1;
    const st = stateOf(spec, v);
    return { spec, v, max, scaleSet, st, empty: false, summary: '' };
  }
  // Draws label and value text, a track with a filled bar, ticks at the warn and breach limits and an
  // optional sub line; one hover area. Returns the height.
  function meterDraw(chart, m, svg, W) {
    const spec = m.spec, fmt = resolveFormat(spec.format, F.num);
    const label = spec.label != null ? String(spec.label) : '';
    const valT = m.v == null ? 'No data' : fmt.full(m.v) + (spec.showMax ? ' of ' + fmt.full(m.max) : '');
    const word = m.st ? stateWord(spec, m.st) : '';
    const vW = chart.tw(valT, 13, 700), wW = m.st ? chart.tw(word, 12, 600) + 18 : 0;
    const rightW = vW + (m.st ? wW + 10 : 0);
    const barY = label || m.st || m.v != null ? 24 : 4;
    svg.appendChild(txt(chart.fit(label, Math.max(30, W - rightW - 14), 13, 500), 0, 13, 'ch-lbl', 'start', { style: 'font-size:13px;font-weight:500' }));
    svg.appendChild(txt(valT, W, 13, 'ch-v', 'end', { style: 'font-size:13px;font-weight:700' }));
    if (m.st) {
      svg.appendChild(txt(word, W - vW - 10, 13, 'ch-lbl', 'end', { style: 'font-weight:600;font-size:12px' }));
      svg.appendChild(S('g', { transform: `translate(${r1(W - vW - 10 - chart.tw(word, 12, 600) - 10)} 9)` }, glyphG(m.st, 0.82)));
    }
    const frac = m.v == null ? 0 : clamp(m.v / m.max, 0, 1);
    const trackD = barPath(0, barY, W, 10, 4, 'right');
    svg.appendChild(S('path', { d: trackD, style: 'fill:var(--ch-track)' }));
    const key = m.st || keyOfTone(spec.tone) || 'cat1';
    const gb = S('g', { class: 'ch-rv-right' });
    svg.appendChild(gb);
    let vis = [];
    if (frac > 0) { const fw = Math.max(4, frac * W); const p = chart.fillShape(svg, gb, barPath(0, barY, fw, 10, 4, 'right'), key); vis.push(p); }
    [['warn', spec.warn], ['bad', spec.breach]].forEach(([k, t]) => {
      if (!isNum(t) || t < 0 || t > m.max) return;
      const x = clamp((t / m.max) * W, 1, W - 1);
      svg.appendChild(S('line', { x1: px(x), x2: px(x), y1: barY - 3, y2: barY + 13, style: 'stroke:' + css(k) + ';stroke-width:2', 'shape-rendering': 'crispEdges' }));
    });
    let H0 = barY + 14;
    if (spec.sub) { svg.appendChild(txt(chart.fit(String(spec.sub), W, 12), 0, H0 + 12, 'ch-lbl2')); H0 += 18; }
    const rows = [{ key: null, v: valT, k: 'Value' }];
    if (m.v != null) rows.push({ key: null, v: fmt.full(m.max), k: 'Full scale' });
    if (isNum(spec.warn)) rows.push({ key: { css: css('warn'), shape: 'box' }, v: fmt.full(spec.warn), k: spec.invert ? 'Getting low at' : 'Near limit at' });
    if (isNum(spec.breach)) rows.push({ key: { css: css('bad'), shape: 'box' }, v: fmt.full(spec.breach), k: spec.invert ? 'Low at' : 'Over limit at' });
    const tip = { head: label || undefined, rows }; if (m.st) tip.st = { tone: m.st, word };
    const hit = S('rect', { x: 0, y: 0, width: W, height: H0, class: 'ch-hit' });
    svg.appendChild(hit);
    chart.addMark({ el: hit, vis, tip, label: (label ? label + ': ' : '') + valT + (word ? ', ' + word : ''), pref: 'top', follow: true });
    return H0 + 2;
  }
  // Meter and ring show a table only if spec.table is true (tableOptIn), draw their own subtitle (ownSub),
  // and emptyHeight sizes the "no data" message.
  TYPES.meter = { noun: 'Meter', tableOptIn: true, table: (m) => ({ head: ['Measure', 'Value'], rows: [[m.spec.label || 'Value', resolveFormat(m.spec.format, F.num).full(m.v)], ['Full scale', m.scaleSet ? resolveFormat(m.spec.format, F.num).full(m.max) : 'not set']] }), model: meterModel, draw: meterDraw, emptyHeight: 40, ownSub: true };

  // Draws a progress ring: big value in the middle, optional label, status shape and word, target tick and
  // wrapped sub text. Returns the height.
  function ringDraw(chart, m, svg, W) {
    const spec = m.spec, fmt = resolveFormat(spec.format, F.num);
    const D = clamp(Math.min(W, spec.size || 188), 96, 320);
    const sw = Math.max(9, Math.round(D * 0.075));
    const cx = W / 2, cy = D / 2 + 2, R = D / 2 - sw / 2 - 2;
    const circ = 2 * Math.PI * R;
    const frac = m.v == null ? 0 : clamp(m.v / m.max, 0, 1);
    const key = m.st || keyOfTone(spec.tone) || 'cat1';
    svg.appendChild(S('circle', { cx: r1(cx), cy: r1(cy), r: r1(R), fill: 'none', style: 'stroke:var(--ch-track);stroke-width:' + sw }));
    const ga = S('g', { class: 'ch-rv-fade' });
    svg.appendChild(ga);
    if (frac > 0) ga.appendChild(S('circle', { cx: r1(cx), cy: r1(cy), r: r1(R), fill: 'none', transform: `rotate(-90 ${r1(cx)} ${r1(cy)})`, style: 'stroke:' + css(key) + ';stroke-width:' + sw + ';stroke-linecap:' + (frac >= 1 ? 'butt' : 'round'), 'stroke-dasharray': `${r1(frac * circ)} ${r1(circ)}` }));
    // The target tick sits at the target's share of full scale, measured clockwise from the top.
    if (isNum(spec.target) && spec.target > 0 && spec.target <= m.max) {
      const a = (spec.target / m.max) * 2 * Math.PI - Math.PI / 2;
      const r0 = R - sw / 2 - 3, r2 = R + sw / 2 + 3;
      svg.appendChild(S('line', { x1: r1(cx + r0 * Math.cos(a)), y1: r1(cy + r0 * Math.sin(a)), x2: r1(cx + r2 * Math.cos(a)), y2: r1(cy + r2 * Math.sin(a)), style: 'stroke:var(--ch-text);stroke-width:2.5;stroke-linecap:round' }));
    }
    let valT = m.v == null ? '-' : fmt.full(m.v);
    let fs = D * 0.27;
    // Shrink the number until it fits inside the ring.
    while (fs > 14 && chart.tw(valT, fs, 600) * 0.82 > R * 1.5) fs *= 0.92;
    svg.appendChild(txt(valT, cx, cy + (spec.label && D >= 130 ? -2 : fs * 0.1), 'ch-big', 'middle', { style: 'font-size:' + r1(fs) + 'px', 'dominant-baseline': 'central' }));
    if (spec.label && D >= 130) svg.appendChild(txt(chart.fit(String(spec.label), R * 1.5, 13), cx, cy + fs * 0.62, 'ch-lbl2', 'middle', { style: 'font-size:13px' }));
    let y = D + 12;
    const word = m.st ? stateWord(spec, m.st) : '';
    if (m.st) {
      const ww = chart.tw(word, 14, 600);
      svg.appendChild(S('g', { transform: `translate(${r1(cx - ww / 2 - 11)} ${r1(y + 6)})` }, glyphG(m.st, 0.95)));
      svg.appendChild(txt(word, cx + 9, y + 11, 'ch-lbl', 'middle', { style: 'font-size:14px;font-weight:600' }));
      y += 24;
    }
    if (isNum(spec.target) && spec.target > 0 && spec.target <= m.max && spec.showTarget !== false) {
      svg.appendChild(S('line', { x1: r1(cx - chart.tw('Target ' + fmt.full(spec.target), 13) / 2 - 16), x2: r1(cx - chart.tw('Target ' + fmt.full(spec.target), 13) / 2 - 6), y1: r1(y + 8), y2: r1(y + 8), style: 'stroke:var(--ch-text);stroke-width:2.5;stroke-linecap:round' }));
      svg.appendChild(txt('Target ' + fmt.full(spec.target), cx + 6, y + 12, 'ch-lbl2', 'middle', { style: 'font-size:13px' }));
      y += 20;
    }
    if (spec.sub) {
      const words = String(spec.sub).split(/\s+/); const maxW = Math.min(W - 8, 260); const lines = []; let cur = '';
      words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (chart.tw(t, 13) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } });
      if (cur) lines.push(cur);
      lines.slice(0, 3).forEach((ln, i) => svg.appendChild(txt(ln, cx, y + 12 + i * 16, 'ch-lbl2', 'middle', { style: 'font-size:13px' })));
      y += Math.min(3, lines.length) * 16 + 2;
    }
    svg.setAttribute('role', 'meter');
    svg.setAttribute('aria-valuemin', '0'); svg.setAttribute('aria-valuemax', String(m.max));
    if (m.v != null) svg.setAttribute('aria-valuenow', String(m.v));
    svg.setAttribute('aria-valuetext', (m.v == null ? 'No data' : fmt.full(m.v)) + (word ? ', ' + word : ''));
    svg.setAttribute('aria-label', (spec.label || spec.title || 'Value') + (spec.sub ? ', ' + spec.sub : ''));
    return y + 4;
  }
  // The ring reuses the meter's model with its own drawing function.
  TYPES.ring = { noun: 'Ring', tableOptIn: true, table: (m) => ({ head: ['Measure', 'Value'], rows: [[m.spec.label || 'Value', resolveFormat(m.spec.format, F.num).full(m.v)], ['Full scale', m.scaleSet ? resolveFormat(m.spec.format, F.num).full(m.max) : 'not set']] }), model: meterModel, draw: ringDraw, emptyHeight: 120, ownSub: true };

  /* =====================================================================================================
   * 15. SPARK (tiny inline trend). spec: { values:[], prev?:[], area?, ref?, width?, height?, format, labels?:[], tone?, label? }
   * ===================================================================================================== */
  // Missing values become null; has says whether there is anything to draw.
  function sparkModel(spec) {
    const vals = Array.isArray(spec.values) ? spec.values.map((v) => (isNum(v) ? v : null)) : [];
    const prev = Array.isArray(spec.prev) ? spec.prev.map((v) => (isNum(v) ? v : null)) : null;
    const fin = vals.filter((v) => v != null);
    return { spec, vals, prev, empty: false, has: fin.length > 0, summary: '' };
  }
  // Draws a tiny trend line (optional area, previous-period line, reference line, last-point dot) with no
  // axes; hover shows the nearest point. Returns the height (28 px unless set).
  function sparkDraw(chart, m, svg, W) {
    const spec = m.spec, H0 = isNum(spec.height) ? spec.height : 28, fmt = resolveFormat(spec.format, F.num);
    const pad = 4;
    const key = keyOfTone(spec.tone) || 'cat1';
    const all = m.vals.concat(m.prev || []).filter((v) => v != null);
    if (isNum(spec.ref)) all.push(spec.ref);
    // WATCH OUT: with nothing to draw, say "no data" in words; a flat line would read as a steady trend.
    if (!all.length) { svg.appendChild(txt('no data', W / 2, H0 / 2, 'ch-t', 'middle', { dy: '.35em' })); svg.setAttribute('aria-label', (spec.label || 'Trend') + ': no data'); return H0; }
    let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi === lo) { lo -= 1; hi += 1; }
    const n = Math.max(m.vals.length, m.prev ? m.prev.length : 0);
    // x pixel of point i, spread evenly across the width.
    const X = (i) => pad + (n <= 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
    const Y = M.linear(lo, hi, H0 - pad - 2, pad + 2);
    if (isNum(spec.ref)) svg.appendChild(S('line', { x1: pad, x2: W - pad, y1: px(Y(spec.ref)), y2: px(Y(spec.ref)), class: 'ch-gl', style: 'stroke:var(--ch-axis)' }));
    const path = (arr) => { let d = ''; arr.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + r1(X(i)) + ' ' + r1(Y(v)); }); return d; };   // a spark joins across missing points
    if (m.prev) { const d = path(m.prev); if (d) svg.appendChild(S('path', { d, class: 'ch-ln', style: 'stroke:var(--ch-muted);stroke-width:1.5;opacity:.7' })); }
    const d = path(m.vals);
    if (spec.area && d) {
      const first = m.vals.findIndex((v) => v != null); let last = -1; m.vals.forEach((v, i) => { if (v != null) last = i; });
      svg.appendChild(S('path', { d: d + 'L' + r1(X(last)) + ' ' + (H0 - pad) + 'L' + r1(X(first)) + ' ' + (H0 - pad) + 'Z', style: 'fill:' + css(key) + ';fill-opacity:.14' }));
    }
    if (d) svg.appendChild(S('path', { d, class: 'ch-ln', style: 'stroke:' + css(key) }));
    let li = -1; m.vals.forEach((v, i) => { if (v != null) li = i; });
    const dot = li >= 0 ? S('circle', { cx: r1(X(li)), cy: r1(Y(m.vals[li])), r: 3.5, class: 'ch-ring', style: 'fill:' + css(key) }) : null;
    if (dot) svg.appendChild(dot);
    const fin = m.vals.filter((v) => v != null);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', (spec.label || 'Trend') + ': ' + (fin.length ? 'from ' + fmt.full(fin[0]) + ' to ' + fmt.full(fin[fin.length - 1]) + ', low ' + fmt.full(Math.min.apply(null, fin)) + ', high ' + fmt.full(Math.max.apply(null, fin)) : 'no data'));
    // hover: nearest point
    if (spec.tip !== false && fin.length) {
      const cur = S('circle', { r: 4, class: 'ch-ring', visibility: 'hidden', style: 'fill:' + css(key) });
      const hit = S('rect', { x: 0, y: 0, width: W, height: H0, class: 'ch-hit' });
      svg.append(cur, hit);
      // Finds the point nearest the pointer (skipping missing values) and shows its tooltip.
      const at = (e) => {
        const bb = svg.getBoundingClientRect(); const i0 = n <= 1 ? 0 : clamp(Math.round(((e.clientX - bb.left - pad) / (W - 2 * pad)) * (n - 1)), 0, n - 1);
        let i = i0; if (m.vals[i] == null) { for (let k = 1; k < n; k++) { if (m.vals[i0 - k] != null) { i = i0 - k; break; } if (m.vals[i0 + k] != null) { i = i0 + k; break; } } }
        if (m.vals[i] == null) return;
        cur.setAttribute('cx', r1(X(i))); cur.setAttribute('cy', r1(Y(m.vals[i]))); cur.setAttribute('visibility', 'visible');
        const rows = [{ key: { css: css(key) }, v: fmt.full(m.vals[i]), k: spec.label || 'Value' }];
        if (m.prev && m.prev[i] != null) rows.push({ key: { css: 'var(--ch-muted)' }, v: fmt.full(m.prev[i]), k: spec.prevLabel || 'Previous' });
        chart.tipShow({ head: Array.isArray(spec.labels) && spec.labels[i] != null ? String(spec.labels[i]) : 'Point ' + (i + 1) + ' of ' + n, rows }, { x: bb.left + X(i), y: bb.top + Y(m.vals[i]), w: 0, h: 0 }, 'top');
      };
      hit.addEventListener('pointermove', at);
      hit.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') at(e); });
      hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { cur.setAttribute('visibility', 'hidden'); chart.tipHide(); } });
    }
    return H0;
  }
  // Sparklines use a fixed width (spec.width, default 96 px) and have no table.
  TYPES.spark = { noun: 'Trend', ownHover: true, fixedWidth: (spec) => (isNum(spec.width) ? spec.width : 96), model: sparkModel, draw: sparkDraw, table: null };

  /* =====================================================================================================
   * 16. PUBLIC API
   * ===================================================================================================== */
  // Makes a chart of the given type in the container and returns its { update, destroy, setTable, el, type
  // } handle. Throws a clear message with no container or no browser page.
  function create(type, el, spec) {
    if (!el || !hasDOM()) throw new Error('SB.charts.' + type + ': pass a container element');
    return new Chart(type, el, spec).api();
  }
  C.create = create;
  // Adds SB.charts.line(el, spec), .bar(...) and so on, one function per chart type.
  ['line', 'bar', 'hist', 'heat', 'scatter', 'dumbbell', 'gantt', 'meter', 'ring', 'spark', 'stack'].forEach((t) => { C[t] = (el, spec) => create(t, el, spec); });
  C.types = Object.keys(TYPES);

  /** Re-read the --ch-* tokens and repaint every live chart (the office theme toggle calls this; a MutationObserver also does). */
  C.refreshTheme = function refreshTheme() {
    for (const c of LIVE) { c.pal = null; try { c.render(); } catch (e) { /* render() never throws; belt and braces */ } }
  };
  /** Opt-in texture channel (45 / 135 degree hatching) for colour-vision, print and forced-colours use. Always on in print and forced-colours. */
  C.setTexture = function setTexture(on) { TEXTURE = !!on; for (const c of LIVE) c.root.dataset.texture = TEXTURE || c.spec.texture === true ? 'on' : 'off'; };
  // Number of charts currently on the page (used by the office page's resource counts).
  C.live = () => LIVE.size;
  // Destroys every chart on the page.
  C.destroyAll = () => { Array.from(LIVE).forEach((c) => c.destroy()); };
})(typeof globalThis !== 'undefined' ? globalThis : window);
