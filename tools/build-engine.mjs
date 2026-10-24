#!/usr/bin/env node
// WHAT THIS FILE IS: Builds the Rust kitchen engine (engine/) into WebAssembly and writes it into the app as
//    src/js/18-engine-wasm.js, a plain script that holds the engine's bytes as base64. The app then needs no extra
//    file and still works offline; the servers load the same file. Run after changing anything in engine/:
//    node tools/build-engine.mjs   (then node tools/build.mjs as usual). Needs Rust (see engine/rust-toolchain.toml).
// PARTS: compile with paths that do not depend on this machine, read the .wasm, write the script.
// USES: cargo, engine/. USED BY: anyone changing the engine; the committed 18-engine-wasm.js is what ships.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(root, 'engine');
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
// Machine paths are replaced with fixed names inside the compiled file, so the same source gives the same bytes anywhere.
const env = Object.assign({}, process.env, { RUSTFLAGS: '--remap-path-prefix=' + cargoHome + '=/cargo --remap-path-prefix=' + engine + '=/engine' });
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], { cwd: engine, env, stdio: 'inherit' });
const wasm = fs.readFileSync(path.join(engine, 'target/wasm32-unknown-unknown/release/smokebox_engine.wasm'));
const sha = crypto.createHash('sha256').update(wasm).digest('hex');
const out = [
  '/*',
  ' * WHAT THIS FILE IS: The Rust kitchen engine (engine/), compiled to WebAssembly and stored here as base64. Do not edit:',
  ' *    it is written by tools/build-engine.mjs. 19-planner.js turns it into SB.planner.',
  ' * PARTS: the bytes (' + wasm.length + ' bytes, sha256 ' + sha + ').',
  ' * USES: nothing. USED BY: 19-planner.js, server/server.mjs and server/cloud.mjs (through the same file).',
  ' */',
  '(function (g) {',
  "  'use strict';",
  '  const SB = (g.SB = g.SB || {});',
  '  // audit:data-start',
  "  SB.engineWasm = { sha256: '" + sha + "', base64: '" + wasm.toString('base64') + "' };",
  '  // audit:data-end',
  "})(typeof globalThis !== 'undefined' ? globalThis : window);",
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'src/js/18-engine-wasm.js'), out);
console.log('engine: ' + wasm.length + ' bytes, sha256 ' + sha.slice(0, 12) + ', written to src/js/18-engine-wasm.js');
