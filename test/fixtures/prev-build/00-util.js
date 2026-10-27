/*
 * WHAT THIS FILE IS: Small shared helpers: maths, dates (including the 4 am service day), text formatting,
 *    seeded dice, safe browser storage and tiny page-building tools. All of them hang on SB.util.
 * PARTS: numbers and lists, seeded dice, formatting, dates, colour contrast, storage, page helpers.
 * USES: nothing. USED BY: every other file. Loads in Node (tests): nothing touches the page at load time.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = (SB.util = {});

  /* ---------- numbers & collections ---------- */
  // True only for a real, finite number (not text, not "not a number", not infinity).
  // Used before any maths on values that may be missing.
  U.isNum = (n) => typeof n === 'number' && isFinite(n);
  // Removes characters nobody can see that can fool a reader: text-direction controls (U+202A to U+202E, U+2066 to U+2069) and zero-width
  // characters (U+200B, U+200C, U+2060, U+FEFF). A zero-width joiner (U+200D) is kept only inside an emoji sequence (a pictograph on both
  // sides, with an optional variation selector or skin tone before it), so family and flag emoji still work; anywhere else it is removed.
  const INVISIBLE_RE = /[\u200B\u200C\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
  const ZWJ_RE = /(\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]*\u200D(?=\p{Extended_Pictographic}))|\u200D/gu;
  // Returns the text with those invisible characters removed (emoji joiners stay).
  U.stripInvisible = (s) => String(s).replace(INVISIBLE_RE, '').replace(ZWJ_RE, (m, keep) => (keep ? m : ''));
  // SHA-256 of a text (its UTF-8 bytes) as 64 lower-case hex digits. Plain code with no browser calls, so it works the same in a page and in Node,
  // and answers at once (a 20 MB backup takes about a second). Used to prove that the file the owner saved is the file Smokebox made.
  U.sha256Hex = (text) => {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    // UTF-8 bytes of the text (a lone half of a surrogate pair becomes U+FFFD, as TextEncoder does).
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(++i) - 0xDC00); }
      else if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    const n = bytes.length;
    const total = ((n + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    for (let i = 0; i < n; i++) buf[i] = bytes[i];
    buf[n] = 0x80;
    const bitsHi = Math.floor((n * 8) / 4294967296), bitsLo = (n * 8) >>> 0;
    buf[total - 8] = bitsHi >>> 24; buf[total - 7] = bitsHi >>> 16; buf[total - 6] = bitsHi >>> 8; buf[total - 5] = bitsHi;
    buf[total - 4] = bitsLo >>> 24; buf[total - 3] = bitsLo >>> 16; buf[total - 2] = bitsLo >>> 8; buf[total - 1] = bitsLo;
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    // Rotates the 32 bits of x right by k places (a step of the SHA-256 mixing).
    const rr = (x, k) => (x >>> k) | (x << (32 - k));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g2, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g2)) + K[i] + w[i]) | 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g2; g2 = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g2) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map((x) => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
  };
  // Cleans typed text for names and notes: strips the invisible characters, squeezes runs of white space to single spaces and trims both ends.
  U.cleanText = (s) => U.stripInvisible(s).replace(/\s+/g, ' ').trim();
  /* ---------- secret hashing (PIN and recovery code) ---------- */
  // Rounds of PBKDF2 for a saved PIN or recovery code: about a tenth of a second on a tablet. A 4-digit PIN stays a door latch whatever this is.
  const KDF_ROUNDS = 100000;
  // Turns bytes into lowercase hex text, two characters each.
  const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
  // The browser's crypto when it can do PBKDF2 and random bytes, else null.
  const subtleOf = () => { const c = g.crypto; return c && c.subtle && typeof c.subtle.deriveBits === 'function' && typeof c.getRandomValues === 'function' && typeof TextEncoder !== 'undefined' ? c.subtle : null; };
  // Runs PBKDF2-SHA256 over text with a salt and a round count and returns the bytes.
  async function derive(sub, text, salt, rounds) {
    const key = await sub.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
    return sub.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
  }
  // Scrambles a secret into 'pbkdf2:<rounds>:<salt>:<hash>' with a fresh random salt; null where this browser cannot (the caller then keeps the old plain
  // SHA-256 form). domain is a fixed label put in front of the secret so a PIN hash and a recovery hash never match each other.
  U.secretHash = async (domain, plain) => {
    const sub = subtleOf();
    if (!sub) return null;
    try {
      const salt = g.crypto.getRandomValues(new Uint8Array(16));
      return 'pbkdf2:' + KDF_ROUNDS + ':' + toHex(salt) + ':' + toHex(await derive(sub, domain + String(plain), salt, KDF_ROUNDS));
    } catch (e) { return null; }
  };
  // Checks a secret against a saved scramble of either form. Returns { ok, legacy }: legacy is true for the old unsalted 'sha256:' form, which still
  // works; the caller should save a fresh U.secretHash after an ok legacy check. ok is false (never a throw) for anything unreadable.
  U.secretCheck = async (domain, plain, stored) => {
    try {
      const sub = g.crypto && g.crypto.subtle;
      if (typeof stored !== 'string' || !sub) return { ok: false, legacy: false };
      if (stored.indexOf('pbkdf2:') === 0) {
        const m = /^pbkdf2:(\d{1,7}):([0-9a-f]{2,128}):([0-9a-f]{64})$/.exec(stored);
        const sk = subtleOf();
        if (!m || !sk || Number(m[1]) < 1 || Number(m[1]) > 2000000) return { ok: false, legacy: false };
        const salt = new Uint8Array(m[2].match(/../g).map((h) => parseInt(h, 16)));
        return { ok: toHex(await derive(sk, domain + String(plain), salt, Number(m[1]))) === m[3], legacy: false };
      }
      if (stored.indexOf('sha256:') === 0 && typeof sub.digest === 'function' && typeof TextEncoder !== 'undefined') {
        return { ok: 'sha256:' + toHex(await sub.digest('SHA-256', new TextEncoder().encode(domain + String(plain)))) === stored, legacy: true };
      }
    } catch (e) { /* unreadable: no match */ }
    return { ok: false, legacy: false };
  };
  // Forces a number into the range lo to hi, so clamp(15, 0, 10) gives 10.
  U.clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // Slides from a to b by the fraction t (t = 0 gives a, t = 1 gives b).
  U.lerp = (a, b, t) => a + (b - a) * t;
  // Adds up a list of numbers. An empty list gives 0.
  U.sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  // Average of a list. An empty list gives 0 instead of a divide-by-zero.
  U.mean = (a) => (a.length ? U.sum(a) / a.length : 0);
  // Value at percent p (0 to 100) of a list, blending the two nearest entries when p falls between them.
  // Works on a sorted copy, so the caller's list keeps its order. An empty list gives 0.
  U.percentile = (arr, p) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((x, y) => x - y);
    const idx = (U.clamp(p, 0, 100) / 100) * (s.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  // The middle value of a list (the 50th percentile).
  U.median = (a) => U.percentile(a, 50);
  // Sorts a list into labelled piles. fn(item) names the pile; the result has one list per label.
  U.groupBy = (arr, fn) => {
    const m = {};
    for (const x of arr) { const k = fn(x); (m[k] || (m[k] = [])).push(x); }
    return m;
  };
  // Rounds to d decimal places (0 by default).
  U.round = (n, d = 0) => { const f = Math.pow(10, d); return Math.round(n * f) / f; };
  // Picks the singular or plural word for a count. "many" defaults to the singular plus "s".
  U.plural = (n, one, many) => (n === 1 ? one : many || one + 's');
  // Words for a number of minutes: "30 minutes", "1 hour", "2 hours", "90 minutes".
  U.minutesText = (m) => (m >= 60 && m % 60 === 0 ? (m / 60) + ' ' + U.plural(m / 60, 'hour') : m + ' ' + U.plural(m, 'minute'));
  // Makes a fully independent copy of plain data, so changing the copy never changes the original.
  U.clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  // Wraps fn so a burst of calls becomes one run, ms after the last call.
  // WATCH OUT: .flush() runs fn at once with no arguments, even if no call is waiting.
  U.debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => { clearTimeout(t); fn(); }; return d; };
  // Wraps fn so it runs at most once every ms. A call made too soon is held and runs when the wait is over.
  U.throttle = (fn, ms) => { let last = 0, t; return (...a) => { const n = Date.now(); const rem = ms - (n - last); if (rem <= 0) { last = n; fn(...a); } else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, rem); } }; };

  let uidN = 0;
  // Makes an id like "t_3k9f": the prefix, a counter and a random part. For labels, not for security.
  U.uid = (prefix) => (prefix || 'id') + '_' + (++uidN).toString(36) + Math.floor(Math.random() * 46656).toString(36);

  /* ---------- seeded random (mulberry32). Used by the simulator so sample history is reproducible. ---------- */
  // Seeded dice (the mulberry32 formula). The same seed always rolls the same numbers, which is how the
  // sample
  // history comes out identical every time. Returns an object with next, range, int, chance, pick, normal,
  // logNormal, weighted and shuffle.
  U.rng = function (seed) {
    let a = seed >>> 0;
    // Next random number from 0 up to, but not including, 1. Each call moves the seed along.
    const next = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = {
      next,
      // Random number between lo and hi.
      range: (lo, hi) => lo + next() * (hi - lo),
      // Random whole number from lo to hi, both ends possible.
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      // True with probability p, so chance(0.2) is true about one time in five.
      chance: (p) => next() < p,
      // One random entry from a list.
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      // Bell-curve number centred on mu with spread sd (Box-Muller method).
      normal: (mu = 0, sd = 1) => {
        let u = 0, v = 0;
        // Zero is skipped because the logarithm below cannot take it.
        while (u === 0) u = next();
        while (v === 0) v = next();
        return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      // Random number whose middle is "median", with a long tail of slower values: most cooks near the
      // usual time, a few much slower. Right shape for item times. Bigger sigma means a longer tail.
      logNormal: (median, sigma) => median * Math.exp(sigma * r.normal()),
      // Picks one item, favouring items whose wfn(item) is larger. Negative weights count as 0.
      weighted: (items, wfn) => {
        let tot = 0; const w = items.map((it) => { const x = Math.max(0, wfn(it)); tot += x; return x; });
        let t = next() * tot;
        for (let i = 0; i < items.length; i++) { t -= w[i]; if (t <= 0) return items[i]; }
        return items[items.length - 1];
      },
      // Returns a shuffled copy of a list (Fisher-Yates). The original is left alone.
      shuffle: (arr) => { const s = arr.slice(); for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; },
    };
    return r;
  };

  /* ---------- formatting ---------- */
  // Pads a number to two digits: 7 becomes "07".
  // Used by the clock and date text.
  U.pad2 = (n) => (n < 10 ? '0' : '') + n;
  /** Elapsed clock "05:14". Minutes grow past 99 ("100:05"). Negative values get a leading minus. */
  U.fmtClock = (ms) => {
    const neg = ms < 0; let s = Math.floor(Math.abs(ms) / 1000);
    const m = Math.floor(s / 60); s = s % 60;
    return (neg ? '-' : '') + U.pad2(m) + ':' + U.pad2(s);
  };
  /** Human duration "5m 14s", "42s", "1h 05m". */
  U.fmtDur = (ms) => {
    if (!U.isNum(ms)) return '-';
    const neg = ms < 0; let s = Math.round(Math.abs(ms) / 1000);
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
    let out;
    if (h > 0) out = h + 'h ' + U.pad2(m) + 'm';
    else if (m > 0) out = m + 'm ' + U.pad2(sec) + 's';
    else out = sec + 's';
    return (neg ? '-' : '') + out;
  };
  /** Local time of day "1:42 pm". */
  U.fmtTime = (ts) => {
    const d = new Date(ts); let h = d.getHours(); const m = d.getMinutes();
    const ap = h >= 12 ? 'pm' : 'am'; h = h % 12; if (h === 0) h = 12;
    return h + ':' + U.pad2(m) + ' ' + ap;
  };
  /** Hour-of-service label for a decimal hour ("13.25" -> "1 pm", 24.75 -> "12 am"). */
  U.fmtHour = (h) => { const hh = ((Math.floor(h) % 24) + 24) % 24; const ap = hh >= 12 ? 'pm' : 'am'; const x = hh % 12 === 0 ? 12 : hh % 12; return x + ' ' + ap; };
  // The money symbol shown before amounts: $ unless the owner set another (settings.ui.currency). One short word of 1 to 3
  // letters or currency signs, such as $, a euro sign, a pound sign or KSh. Everything that shows money goes through here.
  let CURRENCY = '$';
  // True when text is an allowed money symbol (1 to 3 letters, currency signs or dots, nothing else).
  U.validCurrency = (c) => typeof c === 'string' && /^[\p{L}\p{Sc}.]{1,3}$/u.test(c);
  // Sets the symbol (an invalid or missing one means $). Returns the symbol now in use.
  U.setCurrency = (c) => { CURRENCY = U.validCurrency(c) ? c : '$'; return CURRENCY; };
  // The money symbol that is in use right now.
  U.currencySymbol = () => CURRENCY;
  // Money with thousands commas, like "$1,234.50" (the symbol is the owner's). Negatives read "-$5.00". Not a number gives "-".
  U.fmtMoney = (n, dec = 2) => {
    if (!U.isNum(n)) return '-';
    const neg = n < 0; const s = Math.abs(n).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + CURRENCY + s;
  };
  // Reads typed dollars like "2.50", "$3" or ".5" into a number rounded to cents. A blank box is 0, anything else
  // (letters, a minus sign, more than two decimals, over 99,999.99) is NaN so the screen can say what is wrong.
  U.parseDollars = (txt) => {
    const t = String(txt == null ? '' : txt).trim().replace(/^[\p{Sc}]|^\p{L}{1,3}(?=\s*\d)/u, '').trim();
    if (t === '') return 0;
    if (!/^\d{0,5}(\.\d{0,2})?$/.test(t) || t === '.') return NaN;
    return Math.round(parseFloat(t) * 100) / 100;
  };
  /** Grams for display. User preference: weights in grams, not cups. 850 -> "850 g", 2400 -> "2.40 kg". */
  U.fmtG = (g) => { if (!U.isNum(g)) return '-'; return Math.abs(g) >= 1000 ? (g / 1000).toFixed(2) + ' kg' : Math.round(g) + ' g'; };
  // Fraction to percent text: 0.874 gives "87%" (d = number of decimals). Not a number gives "-".
  U.fmtPct = (x, d = 0) => (U.isNum(x) ? (x * 100).toFixed(d) + '%' : '-');
  // Number with thousands commas and d decimals. Not a number gives "-".
  U.fmtNum = (n, d = 0) => (U.isNum(n) ? n.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-');
  // Whole degrees Fahrenheit with the degree sign, like "135 F". Not a number gives "-".
  U.fmtTemp = (f) => (U.isNum(f) ? Math.round(f) + '°F' : '-');

  /* ---------- units setting: store in degrees F and grams, format only at the edges ---------- */
  // The units the owner chose (settings.ui.tempUnit and weightUnit). The store keeps this in step with the
  // settings; screens call the helpers below and never read it directly.
  U.units = { temp: 'F', weight: 'kg' };
  // Takes the ui part of the settings and remembers the temperature unit (F or C) and weight unit (kg or lb).
  // Anything else leaves the old choice alone.
  U.setUnits = (ui) => {
    if (!ui || typeof ui !== 'object') return U.units;
    if (ui.tempUnit === 'F' || ui.tempUnit === 'C') U.units.temp = ui.tempUnit;
    if (ui.weightUnit === 'kg' || ui.weightUnit === 'lb') U.units.weight = ui.weightUnit;
    return U.units;
  };
  const G_PER_LB = 453.59237;
  // Degrees Celsius to Fahrenheit, and back. Stored temperatures stay Fahrenheit (the food code is in F).
  U.cToF = (c) => (c * 9) / 5 + 32;
  U.fToC = (f) => ((f - 32) * 5) / 9;
  // The unit word shown next to a temperature or weight: "°F", "°C", "kg" or "lb". kind is "temp" or "weight".
  U.unitLabel = (kind) => (kind === 'weight' ? U.units.weight : '°' + U.units.temp);
  // A stored Fahrenheit value as the number to show (whole degrees) in the chosen unit; NaN when not a number.
  U.tempShown = (f) => (U.isNum(f) ? Math.round(U.units.temp === 'C' ? U.fToC(f) : f) : NaN);
  // A number the person typed (in the chosen unit) back to stored Fahrenheit, rounded to a tenth.
  U.tempStored = (v) => (U.isNum(v) ? Math.round((U.units.temp === 'C' ? U.cToF(v) : v) * 10) / 10 : NaN);
  // Stored Fahrenheit as text in the chosen unit: 135 gives "135 °F" or "57 °C". Not a number gives "-".
  U.tempText = (f) => (U.isNum(f) ? U.tempShown(f) + ' ' + U.unitLabel('temp') : '-');
  // Stored degrees Celsius (cook endpoints are kept in C) as text in the chosen unit: 85 gives "85 °C" or "185 °F".
  U.tempTextC = (c) => (U.isNum(c) ? U.tempText(U.cToF(c)) : '-');
  // Stored grams as the number to show in the chosen weight unit (kg or lb), not rounded. NaN when not a number.
  U.weightShown = (g) => (U.isNum(g) ? (U.units.weight === 'lb' ? g / G_PER_LB : g / 1000) : NaN);
  // A weight typed in the chosen unit back to stored grams, rounded to a tenth of a gram.
  U.weightStored = (v) => (U.isNum(v) ? Math.round((U.units.weight === 'lb' ? v * G_PER_LB : v * 1000) * 10) / 10 : NaN);
  // Stored grams as text in the chosen unit. Kilograms read like fmtG ("850 g", "2.40 kg"); pounds read
  // "7.0 oz" under a pound and "5.29 lb" above.
  U.weightText = (g) => {
    if (!U.isNum(g)) return '-';
    if (U.units.weight !== 'lb') return U.fmtG(g);
    const lb = g / G_PER_LB;
    return Math.abs(lb) < 1 ? (lb * 16).toFixed(1) + ' oz' : lb.toFixed(2) + ' lb';
  };

  /* ---------- dates (all local time). The "service day" runs from dayStartHour (4 am) so a 12:45 am sale belongs to last night. ---------- */
  // 4 am: the service day turns over at 4 am, so a 12:45 am sale still belongs to the night before.
  U.DAY_START_HOUR = 4;
  // Local calendar date of a moment as "YYYY-MM-DD" (a moment is a timestamp: milliseconds since 1970).
  U.dateKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate()); };
  // The service day a moment belongs to. 12:45 am on the 18th gives the 17th, because the day only
  // turns over at dayStartHour (4 am unless given).
  // WATCH OUT: it goes by the clock on the wall, not by subtracting hours, so on the two daylight-saving nights the day still
  // turns over at 4 am by the wall clock (subtracting 4 hours of real time moved the turn-over to 3 am or 5 am).
  U.serviceDate = (ts, dayStartHour) => {
    const h = dayStartHour == null ? U.DAY_START_HOUR : dayStartHour;
    const d = new Date(ts);
    const early = d.getHours() + d.getMinutes() / 60 < h;
    return U.dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (early ? 1 : 0), 12).getTime());
  };
  // Turns "YYYY-MM-DD" back into the moment of local midnight starting that date.
  U.dateKeyToMs = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  // Date text n days later (earlier if n is negative). It steps from midday so a daylight-saving change
  // cannot slip the answer by a day.
  U.addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return U.dateKey(new Date(y, m - 1, d + n).getTime() + 12 * 3600e3); };
  // Day of the week for a "YYYY-MM-DD" text.
  U.weekday = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getDay(); }; // 0 = Sunday
  // Short day names in the same order as U.weekday numbers.
  U.WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  /** Decimal hour since midnight of the service date. 12:45 am after a night service = 24.75. */
  // Hours since midnight of the moment's service date, as a decimal.
  // Right after a night service, 12:45 am is hour 24.75.
  U.serviceHour = (ts, dayStartHour) => (ts - U.dateKeyToMs(U.serviceDate(ts, dayStartHour))) / 3600e3;
  // Short label for a "YYYY-MM-DD" text, like "Sat 10/17".
  U.fmtDateShort = (key) => { const [y, m, d] = key.split('-').map(Number); return U.WEEKDAYS[new Date(y, m - 1, d).getDay()] + ' ' + m + '/' + d; };

  /* ---------- contrast (used by the live Specs panel so claims are computed, not typed) ---------- */
  // How bright a "#RRGGBB" colour is, from 0 (black) to 1 (white), by the standard web-accessibility
  // formula.
  U.luminance = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    // Converts one colour channel (0 to 255) to its light level. The 0.03928 switch is part of the standard.
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  // Contrast ratio of two "#RRGGBB" colours, 1 to 21. Small text needs 4.5 or more;
  // large text and borders need 3.
  U.contrast = (a, b) => { const x = U.luminance(a), y = U.luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  /* ---------- safe storage: never throws, falls back to memory (private windows, previews, blocked storage) ---------- */
  // Probe: write and delete a test key. Some browsers show storage but refuse to use it (private windows,
  // blocked site data); then "ls" stays null and everything is kept in memory instead.
  const mem = new Map();
  let ls = null;
  try { ls = g.localStorage || null; if (ls) { ls.setItem('__sb_probe', '1'); ls.removeItem('__sb_probe'); } } catch (e) { ls = null; }
  const rawStorage = {
    persistent: !!ls,
    // Reads a saved value. Gives fallback if it is missing, unreadable, or storage is blocked. Never throws.
    get(key, fallback) {
      try { const raw = ls ? ls.getItem(key) : mem.get(key); if (raw == null) return fallback; return JSON.parse(raw); } catch (e) { return fallback; }
    },
    // The saved text exactly as stored, or null if nothing is saved or storage is blocked. Lets a caller tell
    // "nothing saved" apart from "saved but unreadable", which get() cannot (it gives the fallback for both).
    raw(key) {
      try { const raw = ls ? ls.getItem(key) : mem.get(key); return raw == null ? null : String(raw); } catch (e) { return null; }
    },
    // Saves a value as text. Returns false if the value cannot be turned into text or the browser refused it
    // (then it is kept in memory only, so the page still works until it is closed).
    set(key, val) {
      let raw; try { raw = JSON.stringify(val); } catch (e) { return false; }
      try { if (ls) ls.setItem(key, raw); else mem.set(key, raw); return true; } catch (e) { mem.set(key, raw); return false; }
    },
    // Deletes a saved value from the browser and from memory.
    remove(key) { try { if (ls) ls.removeItem(key); } catch (e) { /* ignore */ } mem.delete(key); },
    // Every saved key that starts with the prefix (browser and memory). Never throws.
    keys(prefix) {
      const out = new Set();
      try { if (ls) for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.indexOf(prefix) === 0) out.add(k); } } catch (e) { /* ignore */ }
      mem.forEach((v, k) => { if (k.indexOf(prefix) === 0) out.add(k); });
      return Array.from(out);
    },
  };

  /* ---------- demo and real kitchen keep separate saved data ---------- */
  // The settings that belong to the device, not to a kitchen (look, sound, which station this tablet shows). They
  // are the same in the demo and the real kitchen. Every other smokebox.v1 key is kitchen data and gets its own
  // copy in the demo (smokebox.demo.<name>), so the demo can never read or write the real kitchen's data.
  const SHARED_KEYS = ['theme', 'otheme', 'textsize', 'density', 'hints', 'zone', 'role', 'sound', 'volume', 'speech', 'voicelevel', 'callouts', 'far', 'wall', 'dock'].map((k) => 'smokebox.v1.' + k);
  // The kitchen-data keys, listed so a test can prove every key in the code is classified. A key that is in neither list
  // is treated as kitchen data (the safe side).
  const DATA_KEYS = ['state', 'sid', 'writer', 'histtrim', 'histnotice', 'outbox', 'corrupt', 'names', 'sample', 'welcome', 'lastbackup', 'dlog', 'alertlog', 'lastbatch', 'initials', 'pinlock', 'paymethod',
    'setup.draft', 'setup.examples', 'setup.hiddenStations', 'setup.lastZone', 'setup.hiddenCategories', 'setup.lastCategory', 'setup.cookAheadSkipped', 'setup.serveSkipped', 'setup.serveAnswer', 'readings', 'lastproduct', 'lastgood', 'corruptat', 'dropped', 'droppedat', 'orderdraft', 'office.startCash', 'pinrecovery', 'demoLeftoversKept'].map((k) => 'smokebox.v1.' + k);
  const MODE_KEY = 'smokebox.mode'; // sessionStorage: this tab is in the demo (per tab, gone when the tab closes)
  // Which kitchen this tab shows, decided once at load: a ?demo address or the tab's own saved choice means the demo.
  function detectMode() {
    try {
      const q = g.location && typeof g.location.search === 'string' ? g.location.search : '';
      if (/[?&]demo(=|&|$)/.test(q)) { try { g.sessionStorage.setItem(MODE_KEY, 'demo'); } catch (e) { /* the address alone still works for this load */ } return 'demo'; }
      return g.sessionStorage && g.sessionStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'real';
    } catch (e) { return 'real'; }
  }
  let curMode = detectMode();
  // The kitchen this page shows: 'real' or 'demo'.
  U.mode = () => curMode;
  // Changes the mode inside this page (tests, and the store when it starts in a named mode). Does not reload.
  U.setMode = (m) => { curMode = m === 'demo' ? 'demo' : 'real'; return curMode; };
  U.MODE_KEY = MODE_KEY;
  U.sharedKeys = SHARED_KEYS.slice();
  U.dataKeys = DATA_KEYS.slice();
  // The key a value is really saved under: in the demo, kitchen data moves to smokebox.demo.*; device settings and
  // anything outside smokebox.v1 keep their name.
  function keyFor(key, m) {
    return m === 'demo' && typeof key === 'string' && key.indexOf('smokebox.v1.') === 0 && SHARED_KEYS.indexOf(key) < 0 ? 'smokebox.demo.' + key.slice('smokebox.v1.'.length) : key;
  }
  U.storageKey = keyFor;
  // Wraps a storage object so every key is translated for the mode (a name, or a function giving it). The wrapper
  // has the same get, raw, set and remove, so code written against storage does not change.
  function storageFor(base, modeOf) {
    const m = () => (typeof modeOf === 'function' ? modeOf() : modeOf);
    // The wrapper below passes each call to the real storage with the key translated for the mode.
    return {
      // Whether the browser really keeps what is saved (false in a private window).
      get persistent() { return base.persistent; },
      // Reads a value through the translated key.
      get: (key, fb) => base.get(keyFor(key, m()), fb),
      // The saved text exactly as stored, through the translated key.
      raw: (key) => (typeof base.raw === 'function' ? base.raw(keyFor(key, m())) : null),
      // Saves a value through the translated key.
      set: (key, val) => base.set(keyFor(key, m()), val),
      // Deletes a value through the translated key.
      remove: (key) => base.remove(keyFor(key, m())),
      // Every saved key with this prefix, exactly as named in the browser (not translated).
      keys: (prefix) => (typeof base.keys === 'function' ? base.keys(prefix) : []),
    };
  }
  U.storageFor = storageFor;
  U.rawStorage = rawStorage;
  // The storage every screen uses: follows the page's mode.
  U.storage = storageFor(rawStorage, () => curMode);

  /* ---------- DOM helpers (browser only; call after load) ---------- */
  // Makes text safe to place inside page markup by replacing & < > and quotes.
  // Use it on anything a person typed.
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // First page element matching a selector (an address like ".slip"), looking inside root or the whole page.
  U.$ = (sel, root) => (root || document).querySelector(sel);
  // Same as U.$ but returns a list of every match.
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Copies a labelled card of settings onto an element: class, style, dataset, onClick-style handlers, text,
  // or a plain attribute. Skips null and false. A value of true sets an empty attribute (like "disabled").
  function applyProps(el, props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.setAttribute('class', v);
      else if (k === 'style') { if (typeof v === 'string') el.setAttribute('style', v); else Object.assign(el.style, v); }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  // Adds children to an element. Text and numbers become text, nested lists are flattened,
  // null and false are skipped.
  function appendKids(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) appendKids(el, k);
      else el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }
  /** h('div', {class:'x', onClick:fn}, child, 'text', [more]) -> HTMLElement. Text is always escaped (textNodes). */
  U.h = (tag, props, ...kids) => { const el = document.createElement(tag); if (props) applyProps(el, props); appendKids(el, kids); return el; };
  // svg("path", {d: "..."}) makes a drawing-namespace element, the same way h() makes a normal one.
  U.svg = (tag, props, ...kids) => { const el = document.createElementNS(SVGNS, tag); if (props) applyProps(el, props); appendKids(el, kids); return el; };
  // Removes every child from an element and returns the element.
  U.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  // True when the device asks for less animation. False if the browser cannot say.
  U.prefersReducedMotion = () => { try { return g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
})(typeof globalThis !== 'undefined' ? globalThis : window);
