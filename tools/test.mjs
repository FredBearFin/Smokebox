#!/usr/bin/env node
// WHAT THIS FILE IS: Runs every test/*.test.mjs file with Node's built-in test runner and exits with its
// result. Run: node tools/test.mjs [pattern], where pattern keeps only test files whose name contains it
// (for example "store").
// PARTS: pick the files, run them, list every skipped test by name, pass the exit code on. USES: test/*.test.mjs.
// USED BY: you and CI, from the command line.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pat = process.argv[2];
const files = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.mjs') && (!pat || f.includes(pat))).map((f) => path.join('test', f));
// A pattern that matches nothing is a typo, not a pass.
if (!files.length) { console.log('no tests found' + (pat ? ' for "' + pat + '"' : '')); process.exit(pat ? 1 : 0); }
// A second, machine-readable report goes to a file so skipped tests can be named at the end: a skip counts as a pass
// in the exit code, so without the list a test that never ran looks the same as one that passed.
const tap = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-')), 'report.tap');
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', '--test-reporter-destination=' + tap, ...files], { cwd: root, stdio: 'inherit' });
let skipped = [];
try { skipped = fs.readFileSync(tap, 'utf8').split('\n').filter((l) => /^\s*ok \d+ - .*# SKIP/.test(l)).map((l) => l.trim().replace(/^ok \d+ - /, '')); } catch (e) { /* no report: the exit code still tells */ }
try { fs.rmSync(path.dirname(tap), { recursive: true, force: true }); } catch (e) { /* ignore */ }
if (skipped.length) { console.log('\nSkipped (' + skipped.length + '), not run:'); for (const s of skipped) console.log('  - ' + s); }
process.exit(r.status ?? 1);
