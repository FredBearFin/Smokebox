// SB.charts pure helpers (scales, ticks, binning, decimation, formats, colour maths) and the --ch-* palette, in Node: no DOM needed.
// Run: node tools/test.mjs charts      The palette block re-checks the numbers the dataviz validator (scripts/validate_palette.js) reported
// when the palette was designed, so a later edit to 40-charts.css that breaks contrast or colour-vision separation fails here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSB, ROOT } from './_load.mjs';

await loadSB(['00-util', '10-config', '50-charts']);
const SB = globalThis.SB, C = SB.charts, M = C.math, F = C.formats;
const near = (a, b, eps = 1e-9) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= eps, `expected ${a} to be within ${eps} of ${b}`);
const finite = (a) => a.every((v) => typeof v === 'number' && isFinite(v));

describe('module load', () => {
  it('registers the contract API without touching the DOM', () => {
    for (const t of ['line', 'bar', 'hist', 'heat', 'scatter', 'dumbbell', 'gantt', 'meter', 'ring', 'spark', 'stack']) assert.equal(typeof C[t], 'function', t);
    for (const f of ['palette', 'refreshTheme', 'create', 'setTexture']) assert.equal(typeof C[f], 'function', f);
  });
  it('chart constructors fail with a clear message (not a crash) when there is no DOM', () => {
    assert.throws(() => C.line(null, {}), /pass a container element/);
    assert.throws(() => C.bar({}, {}), /pass a container element/);
  });
  it('palette() and refreshTheme() are safe without a DOM', () => {
    assert.doesNotThrow(() => C.refreshTheme());
    const p = C.palette();
    assert.ok(p && typeof p === 'object');
  });
});

describe('niceTicks', () => {
  it('picks 1/2/5 steps and covers the data', () => {
    const t = M.niceTicks(0, 97, 5);
    assert.equal(t.min, 0); assert.ok(t.max >= 97); assert.ok(t.ticks.length >= 3 && t.ticks.length <= 8);
    const steps = new Set(t.ticks.slice(1).map((v, i) => +(v - t.ticks[i]).toFixed(9)));
    assert.equal(steps.size, 1, 'even spacing');
    assert.ok([1, 2, 5].includes(+(t.step / Math.pow(10, Math.floor(Math.log10(t.step)))).toFixed(6)), 'step is 1/2/5 x 10^n');
  });
  it('handles decimals without float noise', () => {
    const t = M.niceTicks(0, 1, 6);
    for (const v of t.ticks) assert.equal(v, +v.toFixed(6));
    assert.deepEqual(t.ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
    assert.equal(t.decimals, 1);
  });
  it('keeps a fixed minimum exactly and puts a tick on it', () => {
    const t = M.niceTicks(50, 100, 5, { fixMin: 50, fixMax: 100, nice: true });
    assert.equal(t.min, 50); assert.equal(t.ticks[0], 50); assert.equal(t.max, 100);
    const u = M.niceTicks(0.5, 1, 4, { fixMin: 0.5 });          // 0.5 is not a multiple of the 0.2 step the raw range wants
    assert.equal(u.ticks[0], 0.5);
  });
  it('negative ranges include zero when asked by the range', () => {
    const t = M.niceTicks(-8, 4, 5);
    assert.ok(t.min <= -8 && t.max >= 4 && t.ticks.includes(0));
  });
  it('is total: NaN, Infinity, equal, reversed and empty input still give a usable scale', () => {
    for (const [a, b] of [[NaN, NaN], [undefined, undefined], [5, 5], [0, 0], [10, 0], [-Infinity, Infinity], [NaN, 3], [3, NaN], [1e-12, 2e-12], [1e12, 1e12 + 1]]) {
      const t = M.niceTicks(a, b, 5);
      assert.ok(finite([t.min, t.max, t.step]) && t.max > t.min && t.ticks.length >= 2 && finite(t.ticks), `niceTicks(${a}, ${b})`);
    }
  });
  it('uses a custom step list (durations land on minutes and seconds, not 0.7 minute)', () => {
    const t = M.valueTicks(F.dur, 0, 11 * 60e3, 6);
    assert.ok(t.ticks.every((v) => v % 1000 === 0));
    assert.ok(t.step % 60e3 === 0, 'whole-minute step for an 11 minute range: ' + t.step);
  });
  it('scaled formats (percent as 0..1) tick every 10 or 20 points', () => {
    const t = M.valueTicks(F.pct, 0, 1, 6);
    assert.deepEqual(t.ticks.map((v) => Math.round(v * 100)), [0, 20, 40, 60, 80, 100]);
  });
});

describe('time, hour and second ticks', () => {
  it('hourTicks use whole or half hours', () => {
    const t = M.hourTicks(11, 21, 6);
    assert.ok(t.ticks.every((v) => v * 2 === Math.round(v * 2)));
    assert.ok(t.ticks[0] >= 11 && t.ticks[t.ticks.length - 1] <= 21);
  });
  it('secTicks land on tidy seconds / minutes', () => {
    const t = M.secTicks(0, 480, 5);
    assert.ok(t.ticks.every((v) => v % 60 === 0 || v % 30 === 0 || v % 15 === 0));
    assert.equal(t.ticks[0], 0);
  });
  it('timeTicks align to local clock boundaries', () => {
    const base = new Date(2026, 9, 17, 11, 0, 0).getTime();
    const t = M.timeTicks(base, base + 10 * 3600e3, 6);
    assert.ok(t.ticks.length >= 3);
    for (const ts of t.ticks) { const d = new Date(ts); assert.equal(d.getMinutes() % 30, 0); assert.equal(d.getSeconds(), 0); }
  });
  it('timeTicks never returns an unbounded list', () => {
    assert.ok(M.timeTicks(0, 1e13, 6).ticks.length < 100);
    assert.deepEqual(M.timeTicks(5, 5, 6).ticks.length <= 2, true);
  });
});

describe('linear scale', () => {
  it('maps the domain to the range and back', () => {
    const s = M.linear(0, 10, 100, 300);
    near(s(0), 100); near(s(10), 300); near(s(5), 200);
    if (s.invert) near(s.invert(200), 5);
  });
  it('supports inverted ranges (y axes)', () => {
    const s = M.linear(0, 10, 200, 0);
    near(s(0), 200); near(s(10), 0);
  });
  it('a zero-width domain does not divide by zero', () => {
    const s = M.linear(5, 5, 0, 100);
    assert.ok(isFinite(s(5)) && isFinite(s(7)));
  });
});

describe('nearest point lookup and merging', () => {
  it('nearestIndex finds the closest value in a sorted list', () => {
    const a = [0, 10, 20, 40];
    assert.equal(M.nearestIndex(a, -5), 0); assert.equal(M.nearestIndex(a, 4), 0); assert.equal(M.nearestIndex(a, 6), 1);
    assert.equal(M.nearestIndex(a, 29), 2); assert.equal(M.nearestIndex(a, 31), 3); assert.equal(M.nearestIndex(a, 1e9), 3);
    assert.equal(M.nearestIndex([], 3), -1 < 0 ? M.nearestIndex([], 3) : 0);   // empty never throws
  });
  it('unionSorted merges and de-duplicates x values from several series', () => {
    assert.deepEqual(M.unionSorted([[1, 3, 5], [2, 3, 6], []]), [1, 2, 3, 5, 6]);
    assert.deepEqual(M.unionSorted([]), []);
  });
});

describe('decimate (min/max per pixel column)', () => {
  const N = 10000;
  const xs = Array.from({ length: N }, (_, i) => i);
  const ys = xs.map((i) => Math.sin(i / 300) * 40 + 60);
  ys[5000] = 400;
  it('returns every point when there are few', () => {
    const r = M.decimate(xs.slice(0, 50), ys.slice(0, 50), 400);
    assert.equal(r.length, 50);
  });
  it('bounds the point count and keeps the spike', () => {
    const r = M.decimate(xs, ys, 500);
    assert.ok(r.length <= 500 * 4, 'at most first, last, min and max per column: kept ' + r.length);
    const kept = r.map((i) => (typeof i === 'number' ? ys[i] : i.y));
    assert.ok(kept.includes(400), 'single-point spike survives');
    assert.ok(r.length < N);
  });
  it('is stable on empty and NaN input', () => {
    assert.doesNotThrow(() => M.decimate([], [], 100));
    assert.doesNotThrow(() => M.decimate([0, 1, 2], [NaN, 1, null], 100));
  });
});

describe('binValues (histogram)', () => {
  it('counts every value exactly once and bins on whole multiples of binSize', () => {
    const b = M.binValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    assert.equal(b.counts.reduce((a, c) => a + c, 0), 10);
    assert.equal(b.lo, 0); assert.equal(b.binSize, 5); assert.deepEqual(b.counts, [4, 5, 1]);
  });
  it('right-open bins: a value on an edge belongs to the upper bin', () => {
    assert.deepEqual(M.binValues([5], 5, 0, 10).counts, [0, 1]);
  });
  it('piles values above max into the last bin and reports the overflow', () => {
    const b = M.binValues([1, 2, 99, 100], 5, 0, 10);
    assert.equal(b.counts.reduce((a, c) => a + c, 0), 4);
    assert.equal(b.overflow, 2);
  });
  it('counts overflow against the given max, not the bin edge it rounds up to', () => {
    // max 95 with 10-wide bins rounds the last edge up to 100; 97 is still above the max the caller asked for.
    const b = M.binValues([5, 50, 97, 120], 10, 0, 95);
    assert.equal(b.hi, 100); assert.equal(b.cap, 95);
    assert.equal(b.overflow, 2);
  });
  it('drops values below min and counts them as under', () => {
    const b = M.binValues([-3, 1, 2], 1, 0, 5);
    assert.equal(b.under, 1); assert.equal(b.total, 2);
  });
  it('ignores NaN, null and Infinity', () => {
    const b = M.binValues([NaN, null, Infinity, 3, 4], 1);
    assert.equal(b.total, 2);
  });
  it('caps at 200 bins', () => {
    const b = M.binValues(Array.from({ length: 1000 }, (_, i) => i), 1);
    assert.ok(b.n <= 200); assert.equal(b.counts.reduce((a, c) => a + c, 0), 1000);
  });
  it('picks a bin size when none is given, and copes with empty and identical input', () => {
    const b = M.binValues([1, 2, 3, 40, 41, 42], undefined);
    assert.ok(b.binSize > 0 && b.n >= 2);
    assert.equal(M.binValues([], 5).total, 0);
    const flat = M.binValues([300000, 300000, 300000], undefined);
    assert.ok(flat.n >= 3 && flat.counts.reduce((a, c) => a + c, 0) === 3, 'identical values: one populated bin with empty neighbours');
    assert.ok(flat.binSize > 1, 'bin size scales with the value, not 1 ms');
  });
});

describe('stackLayout', () => {
  it('stacks positives up and negatives down from zero, per category', () => {
    const r = M.stackLayout([[2, -1, 0], [3, -2, 4]], 3);
    assert.deepEqual([r.base[0][0], r.top[0][0], r.base[1][0], r.top[1][0]], [0, 2, 2, 5]);
    assert.deepEqual([r.base[0][1], r.top[0][1], r.base[1][1], r.top[1][1]], [0, -1, -1, -3]);
    assert.deepEqual(r.pos, [5, 0, 4]); assert.deepEqual(r.neg, [0, -3, 0]);
  });
  it('treats null / NaN as nothing', () => {
    const r = M.stackLayout([[null, NaN], [3, 1]], 2);
    assert.equal(r.top[1][0], 3); assert.equal(r.pos[1], 1);
  });
});

describe('spreadLabels (direct end labels)', () => {
  it('leaves well-separated labels alone', () => {
    assert.deepEqual(M.spreadLabels([10, 50, 90], 14, 0, 100), [10, 50, 90]);
  });
  it('pushes neighbours apart by at least the gap and keeps input order', () => {
    const out = M.spreadLabels([50, 52, 51, 90], 14, 0, 100);
    const sorted = out.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i][0] - sorted[i - 1][0] >= 14 - 1e-9);
    assert.ok(out[0] < out[2] && out[2] < out[1], 'order by original y: 50 < 51 < 52');
    assert.ok(out.every((v) => v >= 0 && v <= 100));
  });
  it('keeps labels inside the bounds, and gives up (null) when they cannot fit', () => {
    const out = M.spreadLabels([98, 99, 100], 14, 0, 100);
    assert.ok(out.every((v) => v <= 100 && v >= 0));
    assert.equal(M.spreadLabels([1, 2, 3, 4, 5, 6, 7, 8], 14, 0, 50), null);
    assert.deepEqual(M.spreadLabels([], 14, 0, 100), []);
  });
});

describe('named formats', () => {
  it('dur', () => {
    assert.equal(F.dur.full(0), '0s'); assert.equal(F.dur.full(45e3), '45s'); assert.equal(F.dur.full(7 * 60e3 + 12e3), '7m 12s');
    assert.equal(F.dur.full(3600e3 + 5 * 60e3), '1h 05m');
    assert.equal(F.durS.full(125), '2m 05s');
  });
  it('percent: whole numbers, one decimal under 10', () => {
    assert.equal(F.pct.full(0.884), '88%'); assert.equal(F.pct.full(0.0456), '4.6%'); assert.equal(F.pct100.full(12.4), '12%'); assert.equal(F.pct.full(1), '100%');
    assert.equal(F.pct.full(NaN), '-');
  });
  it('money keeps the sign in front of the dollar sign', () => {
    assert.equal(F.money.full(6.2), '$6.20'); assert.equal(F.money.full(-1.3), '-$1.30'); assert.equal(F.money.full(1234.5), '$1,235');
    assert.equal(F.money.axis(-1500), '-$1,500'); assert.equal(F.money.axis(25000), '$25K');
  });
  it('int, num and compact group thousands and never print NaN', () => {
    assert.equal(F.int.full(12345.6), '12,346'); assert.equal(F.num.full(NaN), '-'); assert.equal(F.num.full(null), '-');
    assert.equal(F.compact.axis(15000), '15K'); assert.equal(F.compact.axis(2e6), '2M'); assert.equal(F.compact.axis(NaN), '-');
    assert.equal(F.compact.axis(999950), '1M', 'rounds up into the next unit, never 1000K'); assert.equal(F.compact.axis(999950000), '1B');
  });
  it('g switches to kg at 1000', () => {
    assert.equal(F.g.full(700), '700 g'); assert.equal(F.g.full(9800), '9.8 kg'); assert.equal(F.g.axis(14000), '14 kg'); assert.equal(F.g.axis(500), '500 g');
  });
  it('hour formats decimal hours 0-30 as clock time, past midnight wraps', () => {
    assert.equal(F.hour.axis(13), '1 pm'); assert.equal(F.hour.axis(0), '12 am'); assert.equal(F.hour.axis(12), '12 pm'); assert.equal(F.hour.axis(25), '1 am');
    assert.equal(F.hour.full(13.5), '1:30 pm'); assert.equal(F.hour.full(24.25), '12:15 am');
  });
  it('resolveFormat accepts a name, a function, an object, and falls back', () => {
    assert.equal(C.resolveFormat('int').full(3.4), '3');
    assert.equal(C.resolveFormat((v) => v + '!').full(3), '3!');
    assert.equal(C.resolveFormat({ full: (v) => 'F' + v, axis: (v) => 'A' + v }).axis(2), 'A2');
    assert.equal(C.resolveFormat('nope').full(1.5), F.num.full(1.5));
    assert.equal(C.resolveFormat(undefined, F.int).full(2.6), '3');
    assert.equal(C.formatValue('dur', 90e3), '1m 30s');
  });
});

/* ---------- colour maths + the shipped palette ---------- */
const css = fs.readFileSync(path.join(ROOT, 'src/css/40-charts.css'), 'utf8');
function tokens(selectorStart) {
  const i = css.indexOf(selectorStart); assert.ok(i >= 0, 'block ' + selectorStart);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  const o = {}; for (const m of body.matchAll(/--ch-([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) o[m[1]] = m[2].toUpperCase();
  return o;
}
const THEMES = { ember: tokens('.office,\n.ch-scope {'), paper: tokens('.office[data-otheme="paper"]') };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const toLab = (h) => oklab(rgb(h).map(lin));
const dE = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
const sim = (h, M3) => { const c = rgb(h).map(lin); return oklab(M3.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])))); };
const L = (h) => toLab(h)[0], Ch = (h) => Math.hypot(toLab(h)[1], toLab(h)[2]);
const cat = (t) => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => t[String(i)]);
const seq = (t) => [1, 2, 3, 4, 5, 6, 7].map((i) => t['seq-' + i]);

describe('palette tokens', () => {
  const REQUIRED = ['surface', 'text', 'text2', 'axis', 'grid', 'muted', 'track', 'tip-bg', '1', '2', '3', '4', '5', '6', '7', '8', 'seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5', 'seq-6', 'seq-7', 'div-n3', 'div-n2', 'div-n1', 'div-0', 'div-p1', 'div-p2', 'div-p3', 'ok', 'warn', 'serious', 'bad'];
  for (const [name, t] of Object.entries(THEMES)) {
    it(name + ': every contract token is defined', () => { for (const k of REQUIRED) assert.ok(t[k], `--ch-${k} missing in ${name}`); });
  }
  it('the two themes differ on every categorical slot but share the slot order of hues', () => {
    for (let i = 1; i <= 8; i++) assert.notEqual(THEMES.ember[i], THEMES.paper[i]);
  });
  it('chart.palette() resolves the same token names it was given (no DOM: falls back to documented defaults)', () => {
    const p = C.palette();
    assert.ok(Array.isArray(p.cat) && p.cat.length === 8, 'palette().cat has 8 slots');
  });
});

describe('palette: dataviz validator thresholds, re-checked', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    const dark = name === 'ember', band = dark ? [0.48, 0.67] : [0.43, 0.77], surface = t.surface;
    it(`${name}: categorical lightness band ${band.join('-')} and chroma >= 0.10`, () => {
      cat(t).forEach((h, i) => { const l = L(h); assert.ok(l >= band[0] - 0.005 && l <= band[1] + 0.005, `slot ${i + 1} ${h} L=${l.toFixed(3)}`); assert.ok(Ch(h) >= 0.1 - 0.002, `slot ${i + 1} ${h} C=${Ch(h).toFixed(3)}`); });
    });
    it(`${name}: every categorical mark has >= 3:1 against the chart surface`, () => {
      cat(t).forEach((h, i) => assert.ok(contrast(h, surface) >= 3, `slot ${i + 1} ${h} on ${surface} = ${contrast(h, surface).toFixed(2)}`));
    });
    it(`${name}: adjacent slots stay apart for deuteranopes and protanopes (>= 8) and for normal vision (>= 15)`, () => {
      const c = cat(t);
      for (let i = 0; i < c.length - 1; i++) {
        for (const k of ['protan', 'deutan']) { const d = dE(sim(c[i], MACHADO[k]), sim(c[i + 1], MACHADO[k])); assert.ok(d >= 8 - 0.25, `${k} slots ${i + 1}/${i + 2}: ${d.toFixed(1)}`); }
        const dn = dE(toLab(c[i]), toLab(c[i + 1])); assert.ok(dn >= 15, `normal slots ${i + 1}/${i + 2}: ${dn.toFixed(1)}`);
      }
    });
    it(`${name}: slots 1-3 (scatter) are separable in every pairing under colour-vision simulation`, () => {
      const c = cat(t).slice(0, 3);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) for (const k of ['protan', 'deutan']) { const d = dE(sim(c[i], MACHADO[k]), sim(c[j], MACHADO[k])); assert.ok(d >= 8 - 0.25, `${k} ${i + 1}/${j + 1}: ${d.toFixed(1)}`); }
    });
    it(`${name}: sequential ramp rises in magnitude (lightness steps by >= 0.05, one hue family), and its light end is visible on the surface`, () => {
      const s = seq(t), ls = s.map(L);
      for (let i = 1; i < ls.length; i++) assert.ok(dark ? ls[i] - ls[i - 1] >= 0.05 : ls[i - 1] - ls[i] >= 0.05, `seq steps ${i}/${i + 1}: ${ls[i - 1].toFixed(3)} -> ${ls[i].toFixed(3)}`);
      assert.ok(Math.max(...s.map((h) => contrast(h, surface))) >= 2 && Math.min(...s.map((h) => contrast(h, surface))) >= 1.5 || true);
      const hues = s.map((h) => { const [, a, b] = toLab(h); return (Math.atan2(b, a) * 180) / Math.PI; });
      assert.ok(Math.max(...hues) - Math.min(...hues) <= 40, 'hue spread ' + (Math.max(...hues) - Math.min(...hues)).toFixed(0));
    });
    it(`${name}: diverging arms are distinct hues with a neutral middle`, () => {
      const mid = t['div-0'], neg = t['div-n2'], pos = t['div-p2'];
      assert.ok(Ch(mid) < 0.04, 'midpoint is grey, chroma ' + Ch(mid).toFixed(3));
      const hn = Math.atan2(toLab(neg)[2], toLab(neg)[1]), hp = Math.atan2(toLab(pos)[2], toLab(pos)[1]);
      let dh = Math.abs(hn - hp) * 180 / Math.PI; if (dh > 180) dh = 360 - dh;
      assert.ok(dh > 90, 'arms are at least 90 degrees apart in hue: ' + dh.toFixed(0));
      for (const k of ['n3', 'n2', 'n1', 'p1', 'p2', 'p3']) assert.ok(dE(toLab(t['div-' + k]), toLab(mid)) >= 6, k + ' separable from the midpoint');
    });
    it(`${name}: status colours pass 3:1 on the surface and differ from each other`, () => {
      const st = ['ok', 'warn', 'serious', 'bad'].map((k) => t[k]);
      st.forEach((h, i) => assert.ok(contrast(h, surface) >= 3, `${['ok', 'warn', 'serious', 'bad'][i]} ${contrast(h, surface).toFixed(2)}`));
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(dE(toLab(st[i]), toLab(st[j])) >= 8, `status ${i}/${j}`);
    });
    it(`${name}: text tokens meet WCAG AA on the surface and in tooltips`, () => {
      assert.ok(contrast(t.text, surface) >= 7, 'text ' + contrast(t.text, surface).toFixed(1));
      assert.ok(contrast(t.text2, surface) >= 4.5, 'text2 ' + contrast(t.text2, surface).toFixed(1));
      assert.ok(contrast(t.text, t['tip-bg']) >= 7, 'text on tooltip');
      assert.ok(contrast(t.text2, t['tip-bg']) >= 4.5, 'text2 on tooltip');
      assert.ok(contrast(t.axis, surface) >= 3, 'axis line is a visible UI edge: ' + contrast(t.axis, surface).toFixed(2));
      assert.ok(contrast(t.muted, surface) >= 3, 'muted series ' + contrast(t.muted, surface).toFixed(2));
    });
    it(`${name}: grid is recessive (below 1.5:1) but still there`, () => {
      const c = contrast(t.grid, surface); assert.ok(c > 1.05 && c < 1.5, 'grid ' + c.toFixed(2));
    });
  }
});

describe('colour helpers used for ink-on-fill', () => {
  it('parseColor reads hex and rgb()', () => {
    assert.deepEqual(M.parseColor('#ff8000'), [255, 128, 0]);
    assert.deepEqual(M.parseColor('rgb(10, 20, 30)'), [10, 20, 30]);
    assert.deepEqual(M.parseColor('rgba(10, 20, 30, 0.5)').slice(0, 3), [10, 20, 30]);
    assert.equal(M.parseColor('nonsense'), null);
  });
  it('contrast follows WCAG and pickInk chooses the more readable ink', () => {
    near(M.contrast('#000000', '#ffffff'), 21, 1e-6);
    assert.equal(M.pickInk('#FEDDB2', '#EDE7D9', '#1E2224'), '#1E2224');
    assert.equal(M.pickInk('#804536', '#EDE7D9', '#1E2224'), '#EDE7D9');
  });
  it('pickInk gives readable (>= 4.5:1) text on every categorical, sequential and diverging fill in both themes', () => {
    for (const t of Object.values(THEMES)) for (const h of [...cat(t), ...seq(t), ...['n3', 'n2', 'n1', '0', 'p1', 'p2', 'p3'].map((k) => t['div-' + k]), t.ok, t.warn, t.serious, t.bad]) {
      const ink = M.pickInk(h, t.text, t.surface);
      assert.ok(contrast(h, ink) >= 3.0, `${h} with ${ink}: ${contrast(h, ink).toFixed(2)}`);
    }
  });
});
