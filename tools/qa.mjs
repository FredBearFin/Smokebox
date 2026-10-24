#!/usr/bin/env node
/* Smokebox KDS - QA runner (independent QA engineer).
 *
 *   node tools/qa.mjs                      build dist/qa.html, run every test/e2e/*.mjs in name order, print a table, write docs/qa-report.md
 *   node tools/qa.mjs --only office        run only tests whose id or title contains "office" (merged into the previous results)
 *   node tools/qa.mjs --list               list the tests without running them
 *   node tools/qa.mjs --no-build           reuse dist/qa.html
 *   node tools/qa.mjs --no-report          do not write docs/qa-report.md
 *
 * Every test file in test/e2e/ (not starting with "_") default-exports a function that receives the helpers `h` and registers tests:
 *
 *     export default function (h) {
 *       h.test('06-secret-door', 'Five taps open the office', { owner: 'lead', timeout: 40000 }, async (t) => {
 *         const page = await t.open({ w: 1280, h: 800 });          // clean storage, waits for SB.booted, collects console logs
 *         t.check('five taps open it', cond, detail, 'lead');      // soft assertion (the test keeps going), optional owner override
 *         t.skip('feature not built yet');                         // the whole test is SKIP
 *         t.skipCheck('thing', 'reason');                          // one check is skipped, the rest still count
 *         t.note('sample history ms', 412, 'ms');                  // a measurement for the report
 *         await t.shot(page, 'name');                              // test/.out/qa/name.png
 *       });
 *     }
 *
 * A test is PASS when no check failed and nothing threw, FAIL otherwise, SKIP when it called t.skip. Failures are grouped by the
 * suspected owner (the file that most likely holds the defect). Each test starts from empty storage in its own browser context;
 * one Chromium is shared by the whole run (the machine has 2 cores for a dozen agents).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { toolRequire } from './_deps.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startKitchen } from '../test/_kitchen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = toolRequire('playwright');

export const OWNERS = {
  sim: { name: 'Sim', agent: 'ad717b3d4d0948743', files: '45-sim.js' },
  board: { name: 'Floor board', agent: 'a5c9a0e99faa92b34', files: '70-floor-board.js, 20-floor.css' },
  sheets: { name: 'Floor sheets', agent: 'a515d2bea06233e68', files: '71-floor-order.js, 72-floor-sheets.js, 21-floor-sheets.css' },
  officeA: { name: 'Office A', agent: 'ab2a28fc08b3ac410', files: '80-office-core.js, 81-office-pace.js, 30-office.css (frame, Pace, Tickets, Stations)' },
  officeB: { name: 'Office B', agent: 'a5e50a4f63f7caddc', files: '82-office-money.js, 83-office-safety.js, 85-office-stock.js, 31-office-money.css (Sales and money, Safety, Stock and 86)' },
  officeC: { name: 'Office C', agent: 'a0a7d50f16d6349b1', files: '84-office-data.js, 32-office-data.css (Menu, prices and shop)' },
  lead: { name: 'Lead (wave-1 files)', agent: 'lead', files: '00-util, 05-icons, 10-config, 20-engine, 30-store, 40-metrics, 50-charts, 60-shell, 99-boot, 00-tokens.css, 10-base.css, 40-charts.css' },
};

const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const E2E_DIR = path.join(ROOT, 'test/e2e');
const OUT_DIR = path.join(ROOT, 'test/.out/qa');
const BUILD = path.join(ROOT, 'dist/qa.html');
const RESULTS_JSON = path.join(OUT_DIR, 'results.json');
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ====================================================================================================================
 * Registry and helpers handed to every test file
 * ================================================================================================================== */
const registry = [];
class Skip extends Error { constructor(reason) { super(reason); this.skip = true; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isFontNoise = (text, url) => /fonts\.(googleapis|gstatic)\.com/.test(url || '') || /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_PROXY/.test(text || '');
const short = (v, n = 220) => { let s; try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { s = String(v); } if (s === undefined) s = 'undefined'; return s.length > n ? s.slice(0, n) + '...' : s; };

const helpers = {
  OWNERS, ROOT, OUT_DIR, sleep, short,
  test(id, title, opts, fn) { if (typeof opts === 'function') { fn = opts; opts = {}; } registry.push({ id, title, opts: opts || {}, fn }); },
};

let browser = null;

function makeContext(test) {
  const live = []; // contexts and pages opened by this test
  const t = {
    id: test.id, title: test.title, owner: test.opts.owner || 'lead',
    checks: [], skips: [], notes: [], shots: [], logs: [],
    pages: [],
    check(name, ok, detail, owner) {
      this.checks.push({ name, ok: !!ok, detail: ok ? undefined : short(detail === undefined ? '' : detail, 400), owner: owner || this.owner });
      return !!ok;
    },
    skipCheck(name, reason) { this.skips.push({ name, reason }); },
    skip(reason) { throw new Skip(reason); },
    note(key, value, unit) { this.notes.push({ key, value, unit: unit || '' }); },
    /** Open a fresh page from empty storage. Options: w h hash touch reducedMotion colorScheme scale init(fn) preset(storage object) wait(false to skip SB.booted) file. */
    async open(o = {}) {
      const { w = 1280, h = 800, hash = '', touch = false, kitchen = null, reducedMotion = 'no-preference', colorScheme = 'light', scale = 1, init, preset, wait = true, file = BUILD, clear = true } = o;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: touch, isMobile: false, colorScheme, reducedMotion });
      ctx.setDefaultTimeout(o.actionTimeout || 6000); // a missing element fails in a few seconds, not Playwright's 30
      live.push(ctx);
      // every browser context starts with empty storage; an init script that clears it is NOT used because (Chromium + Playwright) it ran again after page.reload() on a URL with a #hash and wiped the saved data under test
      // planted once per tab: window.name survives reloads (and a #hash), so a reload never plants the data a second time
      if (preset) await ctx.addInitScript((p) => { try { if (window.name !== '__qapreset') { for (const k of Object.keys(p)) localStorage.setItem(k, p[k]); window.name = '__qapreset'; } } catch (e) { /* blocked */ } }, preset);
      if (init) await ctx.addInitScript(init);
      const page = await ctx.newPage();
      this.attach(page);
      await page.goto(pathToFileURL(file).href + (kitchen ? '' : hash), { waitUntil: 'load' }); // with a kitchen, the hash is applied after the kitchen is set
      if (wait) await page.waitForFunction(() => window.SB && window.SB.booted === true, null, { timeout: 10000 }).catch(() => { /* reported by clean() */ });
      // kitchen: true or { sample } puts the kitchen into a known state (starter batches, sample history on or off) instead of relying on first-run content.
      if (kitchen) { await startKitchen(page, kitchen === true ? {} : kitchen).catch(() => { /* reported by the checks that follow */ }); if (hash) await page.evaluate((x) => { location.hash = x; }, hash); }
      return page;
    },
    /** A second page in the same browser context (same storage), for the two-tab test. */
    async newPage(page, hash) {
      const p = await page.context().newPage();
      this.attach(p);
      const base = page.url().replace(/#.*/, '');
      await p.goto(base + (hash || ''), { waitUntil: 'load' });
      await p.waitForFunction(() => window.SB && window.SB.booted === true, null, { timeout: 10000 }).catch(() => { /* reported by clean() */ });
      return p;
    },
    attach(page) {
      const logs = { errors: [], warnings: [], pageErrors: [], failedRequests: [], requests: [] };
      page.logs = logs;
      page.on('console', (m) => { if (m.type() === 'error') { if (!isFontNoise(m.text(), m.location && m.location().url)) logs.errors.push(m.text()); } else if (m.type() === 'warning') logs.warnings.push(m.text()); });
      page.on('pageerror', (e) => logs.pageErrors.push(String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')));
      page.on('requestfailed', (r) => logs.failedRequests.push(r.url()));
      page.on('request', (r) => logs.requests.push(r.url()));
      page.on('dialog', (d) => { logs.errors.push('unexpected browser dialog: ' + d.message()); d.dismiss().catch(() => {}); });
      this.pages.push(page);
    },
    /** console clean, no module failed to load, the app booted. */
    async clean(page, label, owner) {
      const l = page.logs;
      const boot = await page.evaluate(() => ({ booted: !!(window.SB && SB.booted), loadErrors: window.__sbLoadErrors || [], bootError: !!document.getElementById('boot-error') })).catch((e) => ({ booted: false, loadErrors: [{ message: String(e) }], bootError: false }));
      this.check((label ? label + ': ' : '') + 'app booted without a boot error screen', boot.booted && !boot.bootError, boot, owner || 'lead');
      this.check((label ? label + ': ' : '') + 'no module failed to load (__sbLoadErrors empty)', !boot.loadErrors.length, boot.loadErrors, owner || 'lead');
      this.check((label ? label + ': ' : '') + 'console has no errors and no uncaught page errors', !l.errors.length && !l.pageErrors.length, { errors: l.errors.slice(0, 3), pageErrors: l.pageErrors.slice(0, 3) }, owner);
    },
    async shot(page, name, o) {
      const file = path.join(OUT_DIR, name + '.png');
      try { await page.screenshot(Object.assign({ path: file }, o || {})); this.shots.push(path.relative(ROOT, file)); } catch (e) { /* page closed */ }
      return path.relative(ROOT, file);
    },
    async settle(page, ms = 150) { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {}); await sleep(ms); },
    sleep,
    async closeAll() { for (const c of live.splice(0)) await c.close().catch(() => {}); },
  };
  return t;
}

/* ====================================================================================================================
 * Running
 * ================================================================================================================== */
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

async function runOne(test) {
  // a failure picture from an earlier run of this test is stale the moment it runs again
  try { for (const f of fs.readdirSync(OUT_DIR)) if (f.startsWith('fail-' + test.id + '.') || f.startsWith('fail-' + test.id + '-')) fs.unlinkSync(path.join(OUT_DIR, f)); } catch (e) { /* ignore */ }
  const t = makeContext(test);
  const started = Date.now();
  let status = 'PASS', error = null, reason = '';
  const timeout = test.opts.timeout || 60000;
  let timer;
  try {
    await Promise.race([
      test.fn(t),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('test timed out after ' + timeout / 1000 + ' s')), timeout); }),
    ]);
  } catch (e) {
    if (e && e.skip) { status = 'SKIP'; reason = e.message; } else { status = 'FAIL'; error = String((e && e.stack) || e).split('\n').slice(0, 4).join(' | '); }
  } finally { clearTimeout(timer); }
  const failed = t.checks.filter((c) => !c.ok);
  if (status === 'PASS' && failed.length) status = 'FAIL';
  if (status === 'FAIL') {
    // a failure picture of every page that is still open (best effort, a hung page must not stall the run)
    let i = 0;
    for (const p of t.pages) {
      if (p.isClosed()) continue;
      const f = path.join(OUT_DIR, 'fail-' + test.id + (i ? '-' + i : '') + '.png'); i++;
      try { await Promise.race([p.screenshot({ path: f }), sleep(4000)]); if (fs.existsSync(f)) t.shots.push(path.relative(ROOT, f)); } catch (e) { /* ignore */ }
    }
  }
  await t.closeAll();
  return {
    id: test.id, title: test.title, owner: test.opts.owner || 'lead', status, reason, error,
    ms: Date.now() - started,
    checks: t.checks.length, failed: failed.map((c) => ({ name: c.name, detail: c.detail, owner: c.owner })),
    skips: t.skips, notes: t.notes, shots: t.shots, at: new Date().toISOString(),
  };
}

async function loadTests() {
  const files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(path.join(E2E_DIR, f)).href + '?t=' + Date.now());
      if (typeof mod.default !== 'function') { registry.push({ id: f, title: f + ' has no default export', opts: { owner: 'lead' }, fn: async () => { throw new Error('test file must default-export function (h)'); } }); continue; }
      const before = registry.length;
      await mod.default(helpers);
      for (let i = before; i < registry.length; i++) registry[i].file = f;
    } catch (e) {
      registry.push({ id: f, title: f + ' failed to load', file: f, opts: { owner: 'lead' }, fn: async () => { throw e; } });
    }
  }
}

function buildApp() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--out', 'dist/qa.html', '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(2); }
}

function srcFingerprint() {
  const h = crypto.createHash('sha1');
  for (const d of ['src/js', 'src/css']) for (const f of fs.readdirSync(path.join(ROOT, d)).sort()) h.update(f + ':' + fs.statSync(path.join(ROOT, d, f)).size + ';');
  return h.digest('hex').slice(0, 8);
}

function sourceStatus() {
  const rows = [];
  for (const d of ['src/js', 'src/css']) for (const f of fs.readdirSync(path.join(ROOT, d)).sort()) { const s = fs.statSync(path.join(ROOT, d, f)); rows.push({ f, kb: Math.round(s.size / 1024), m: s.mtime.toISOString().slice(11, 16) }); }
  return rows;
}

/* ====================================================================================================================
 * Report
 * ================================================================================================================== */
async function writeReport(results, meta) {
  let notes = [];
  try { const m = await import(pathToFileURL(path.join(E2E_DIR, '_visual-notes.mjs')).href + '?t=' + Date.now()); notes = m.default || []; } catch (e) { /* none yet */ }
  const by = (s) => results.filter((r) => r.status === s);
  const L = [];
  const stamp = (r) => (r.at < meta.runStart ? ' (earlier run)' : '');
  L.push('# Smokebox QA report', '');
  L.push(`Run: ${meta.when}  |  build: dist/qa.html, ${meta.kb} KB, source fingerprint ${meta.fp}  |  machine load ${meta.load}  |  Chromium via Playwright`, '');
  L.push(`**${by('PASS').length} pass, ${by('FAIL').length} fail, ${by('SKIP').length} skip** (${results.length} tests, ${results.reduce((a, r) => a + r.checks, 0)} checks, ${Math.round(results.reduce((a, r) => a + r.ms, 0) / 1000)} s of test time).`, '');
  L.push('Run it again with `node tools/qa.mjs` (about every 10 minutes at most: the machine is shared). The suite never edits app files.', '');
  L.push('## Results', '', '| id | test | result | s | checks | suspected owner |', '|---|---|---|---|---|---|');
  for (const r of results) L.push(`| ${r.id} | ${r.title} | ${r.status}${stamp(r)} | ${(r.ms / 1000).toFixed(1)} | ${r.checks - r.failed.length}/${r.checks} | ${OWNERS[r.owner] ? OWNERS[r.owner].name : r.owner} |`);
  L.push('');

  const fails = results.filter((r) => r.status === 'FAIL');
  L.push('## Failures by suspected owner', '');
  if (!fails.length) L.push('None.', '');
  for (const key of Object.keys(OWNERS)) {
    const rows = [];
    for (const r of fails) {
      for (const c of r.failed) if (c.owner === key) rows.push({ r, text: c.name, detail: c.detail });
      if (r.error && r.owner === key) rows.push({ r, text: 'The test threw: ' + r.error, detail: '' });
    }
    if (!rows.length) continue;
    const o = OWNERS[key];
    L.push(`### ${o.name} (${o.agent})`, `Files: ${o.files}`, '');
    for (const x of rows) L.push(`- **${x.r.id}** ${x.r.title}: ${x.text}${x.detail ? '  \n  Detail: `' + String(x.detail).replace(/`/g, "'").replace(/\n/g, ' ') + '`' : ''}${x.r.shots.find((s) => /fail-/.test(s)) ? '  \n  Screenshot: ' + x.r.shots.find((s) => /fail-/.test(s)) : ''}`);
    L.push('');
  }

  const skips = results.filter((r) => r.status === 'SKIP' || r.skips.length);
  L.push('## Skipped (feature not built yet, or not measurable here)', '');
  if (!skips.length) L.push('None.', '');
  for (const r of skips) {
    if (r.status === 'SKIP') L.push(`- **${r.id}** ${r.title}: ${r.reason}`);
    for (const s of r.skips) L.push(`- **${r.id}** (check) ${s.name}: ${s.reason}`);
  }
  L.push('');

  const allNotes = results.flatMap((r) => r.notes.map((n) => ({ id: r.id, ...n })));
  L.push('## Measurements', '', 'Numbers from this run on a shared 2-core machine (several agents run at once), so read them as upper bounds.', '', '| test | what | value |', '|---|---|---|');
  for (const n of allNotes) L.push(`| ${n.id} | ${n.key} | ${typeof n.value === 'number' ? Math.round(n.value * 10) / 10 : n.value}${n.unit ? ' ' + n.unit : ''} |`);
  L.push('');

  if (notes.length) {
    L.push('## Visual defects seen in the screenshots', '', 'Found by looking at the contact sheets (not by a script).', '', '| # | where | what | owner | screenshot |', '|---|---|---|---|---|');
    notes.forEach((n, i) => L.push(`| V${i + 1} | ${n.where} | ${n.what} | ${OWNERS[n.owner] ? OWNERS[n.owner].name : n.owner} | ${n.shot || ''} |`));
    L.push('');
  }

  L.push('## Screenshots index', '');
  const contact = fs.readdirSync(OUT_DIR).filter((f) => /^contact-.*\.png$/.test(f)).sort();
  if (contact.length) L.push('Contact sheets (many pictures on one image, made by `node tools/qa-contact.mjs`):', '', ...contact.map((f) => `- test/.out/qa/${f}`), '');
  const shotLines = results.filter((r) => r.shots.length).map((r) => `- ${r.id}: ${r.shots.map((s) => s.replace('test/.out/qa/', '')).join(', ')}`);
  if (shotLines.length) L.push('Per test (folder test/.out/qa/):', '', ...shotLines, '');

  L.push('## Source files at run time', '', '| file | KB | modified (UTC) |', '|---|---|---|', ...meta.sources.map((s) => `| ${s.f} | ${s.kb} | ${s.m} |`), '');
  fs.writeFileSync(path.join(ROOT, 'docs/qa-report.md'), L.join('\n'));
}

/* ====================================================================================================================
 * Main
 * ================================================================================================================== */
async function main() {
  await loadTests();
  const only = opt('only', null);
  let list = registry;
  if (only) list = registry.filter((t) => (t.id + ' ' + t.title).toLowerCase().includes(only.toLowerCase()));
  if (flag('list')) { for (const t of list) console.log(pad(t.id, 28) + ' ' + t.title); return; }
  if (!flag('no-build')) buildApp();
  const kb = Math.round(fs.statSync(BUILD).size / 1024);
  const runStart = new Date().toISOString();
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  console.log(`Smokebox QA: ${list.length} tests, build ${kb} KB, load ${os.loadavg().map((x) => x.toFixed(1)).join(' ')}\n`);
  console.log(pad('id', 26) + pad('result', 7) + pad('time', 7) + pad('checks', 8) + 'title');
  console.log('-'.repeat(100));
  for (const test of list) {
    const r = await runOne(test);
    results.push(r);
    console.log(pad(r.id, 26) + pad(r.status, 7) + pad((r.ms / 1000).toFixed(1) + 's', 7) + pad(r.checks - r.failed.length + '/' + r.checks, 8) + r.title);
    if (r.status === 'SKIP') console.log('    skip: ' + r.reason);
    for (const c of r.failed) console.log('    FAIL ' + c.name + (c.detail ? '\n         ' + c.detail : ''));
    if (r.error) console.log('    ERROR ' + r.error);
    for (const s of r.skips) console.log('    skip: ' + s.name + ' (' + s.reason + ')');
    const fs_ = r.shots.find((s) => /fail-/.test(s)); if (r.status === 'FAIL' && fs_) console.log('    screenshot: ' + fs_);
  }
  await browser.close();
  // merge with earlier results when only a subset ran, so the report always covers the whole suite
  let all = results;
  if (only && fs.existsSync(RESULTS_JSON)) {
    try {
      const prev = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8')).results || [];
      const ran = new Set(results.map((r) => r.id));
      all = registry.map((t) => results.find((r) => r.id === t.id) || prev.find((r) => r.id === t.id)).filter(Boolean);
      for (const p of prev) if (!ran.has(p.id) && !all.includes(p) && registry.some((t) => t.id === p.id)) all.push(p);
    } catch (e) { /* ignore a damaged file */ }
  }
  fs.writeFileSync(RESULTS_JSON, JSON.stringify({ runStart, results: all }, null, 1));
  const count = (s) => all.filter((r) => r.status === s).length;
  console.log('-'.repeat(100));
  console.log(`PASS ${count('PASS')}   FAIL ${count('FAIL')}   SKIP ${count('SKIP')}   (${all.reduce((a, r) => a + r.checks, 0)} checks)`);
  if (!flag('no-report')) {
    await writeReport(all, { when: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC', kb, fp: srcFingerprint(), load: os.loadavg().map((x) => x.toFixed(1)).join(' '), sources: sourceStatus(), runStart });
    console.log('wrote docs/qa-report.md');
  }
  process.exitCode = count('FAIL') ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
