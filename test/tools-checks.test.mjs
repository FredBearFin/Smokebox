// The check tools must not report green when they should not: the comment audit sees wrapped functions and unpaired data markers, the code
// fingerprint refuses to bless everything at once and counts a file with no snapshot as a failure, and the contract check turns a failed
// inspection or a broken contract into a problem. Run: node --test test/tools-checks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbtools-'));
const HEAD = '// WHAT THIS FILE IS: a scratch file for the tool tests, nothing more.\nx();\n\n';
// Writes a scratch JS file and runs the comment audit on it alone.
const audit = (name, body) => {
  const f = path.join(tmp, name); fs.writeFileSync(f, HEAD + body);
  return spawnSync(process.execPath, [path.join(ROOT, 'tools/comment-audit.mjs'), f], { encoding: 'utf8' });
};

test('comment audit: a several-line function handed to a name through a wrapper call needs its comment like any named function', () => {
  const r = audit('wrap.js', 'const save = debounce(() => {\n  a();\n  b();\n});\n');
  assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /function save: needs a plain-words comment/);
  const ok = audit('wrap-ok.js', '// Saves the order a moment after the last key press.\nconst save = debounce(() => {\n  a();\n  b();\n});\n');
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(audit('one-line.js', 'const now = opts.now || (() => Date.now());\n').status, 0, 'a one-line default stays an inline callback');
});

test('comment audit: a data block that is never closed is a problem, not a silent end to the gap rule', () => {
  const r = audit('data.js', '// audit:data-start\nconst A = [1];\n' + 'x();\n'.repeat(60));
  assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /has no audit:data-end/);
  assert.match(audit('end.js', 'x();\n// audit:data-end\n').stdout, /with no audit:data-start/);
  assert.equal(audit('paired.js', '// audit:data-start\n' + 'x();\n'.repeat(60) + '// audit:data-end\n').status, 0);
});

test('code fingerprint: accept with no file names refuses, and check fails on a file with no snapshot', () => {
  const fp = path.join(ROOT, 'tools/code-fingerprint.mjs');
  const a = spawnSync(process.execPath, [fp, 'accept'], { encoding: 'utf8' });
  assert.equal(a.status, 2, a.stdout); assert.match(a.stdout, /accept needs the names/);
  const f = path.join(tmp, 'new.js'); fs.writeFileSync(f, 'x();\n');
  const c = spawnSync(process.execPath, [fp, 'check', f], { encoding: 'utf8' });
  assert.equal(c.status, 1, c.stdout); assert.match(c.stdout, /NO BASELINE/);
});

test('guide builder: Markdown the Guide does not understand stops the build instead of turning into plain text', async () => {
  const { parsePage } = await import('../tools/build-guide.mjs');
  for (const bad of ['- [x] done', '1) first', '* item', '### Small heading', '```', '# A second title']) {
    assert.throws(() => parsePage('01-x.md', '# Title\n\nSummary.\n\n' + bad + '\n'), /not understood/, bad);
  }
  const ok = parsePage('01-x.md', '# Title\n\nSummary.\n\n## Part\n\n1. one\n\n- two\n\n- [ ] three\n');
  assert.equal(ok.title, 'Title'); assert.deepEqual(ok.blocks.map((b) => b.t), ['h', 'ol', 'ul', 'check']);
});

test('artifact builder: --no-build refuses a page older than the sources', () => {
  const stale = path.join(tmp, 'stale.html'); fs.writeFileSync(stale, '<html><body>old</body></html>'); fs.utimesSync(stale, new Date(0), new Date(0));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-artifact.mjs'), '--no-build', '--in', stale, '--out', path.join(tmp, 'a.html')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /older than the sources/);
  assert.ok(!fs.existsSync(path.join(tmp, 'a.html')));
});

test('contract check: failed inspections and broken contracts are problems, and only "performance:"/"timing:" tests count as timing', async () => {
  const { analyze, emptyScan } = await import('../tools/contract-check.mjs');
  const err = { __err: 'Execution context was destroyed' };
  const R = {
    boot: { booted: true, floorMounted: true, sheetNames: [], actions: [], iconNames: [], chartTypes: [] },
    smoke: {
      sheets: [Object.assign({ name: 'order' }, err)], officeMounted: true,
      pages: [{ id: 'pace', inspectErr: err.__err }, { id: 'menu', cur: 'pace', cards: 3, text: 900 }],
      paceBaseline: { timers: 0 }, leaks: [{ id: 'menu', inspectErr: err.__err }], afterClose: err,
      misc: [err, { name: 'sim.sample', days: 13 }, { name: 'sim.live', skipped: 'SB.sim.live missing' }],
    },
  };
  const unit = { ran: true, pass: 10, fail: 2, failing: ['syncLatency: median, p90, max and the share inside 60 s', 'performance: 5000 tickets / 40000 events'] };
  const { problems } = analyze(emptyScan(), R, null, { unit });
  const keys = problems.map((p) => p.key);
  const has = (re) => assert.ok(keys.some((k) => re.test(k)), re + ' in ' + keys.join(' ; '));
  has(/^smoke-inspect\|71-floor-order\.js\|order:inspect$/); has(/^smoke-inspect\|.*\|pace:inspect$/); has(/^smoke-inspect\|.*\|menu:leak-inspect$/);
  has(/^smoke-inspect\|60-shell\.js\|afterclose:inspect$/); has(/^smoke-inspect\|45-sim\.js\|misc:inspect/);
  has(/^office-page\|.*\|menu:landed:pace$/); has(/^contract\|45-sim\.js\|sample-days:13$/); has(/^smoke\|45-sim\.js\|sim\.live:skipped$/);
  has(/^unit\|test\/\|unit:syncLatency/);
  const onlyTiming = analyze(emptyScan(), null, null, { unit: { ran: true, pass: 10, fail: 1, failing: ['timing: generation time is within budget'] } });
  assert.ok(!onlyTiming.problems.some((p) => p.kind === 'unit') && onlyTiming.notes.some((n) => n.kind === 'unit-perf'), 'a timing-only failure stays a note');
});
