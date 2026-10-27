// WHAT THIS FILE IS: Finds the two outside tools the scripts need (Playwright and acorn). Look order: the folder
// named in the SMOKEBOX_TOOLS environment variable (a node_modules folder or its parent), then ./node_modules in
// this repository, then the old /opt/npm-tools/node_modules path, then Node's normal lookup (NODE_PATH, global). A pinned tool
// (package.json) found outside the repository is named on stderr, since its version may differ from CI's.
// PARTS: candidate folders, toolRequire. USES: nothing. USED BY: the scripts in tools/ and a few in test/.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lists the folders to try, in order, each ending in a slash so createRequire treats it as a directory.
function candidates() {
  const list = [];
  const env = process.env.SMOKEBOX_TOOLS;
  if (env) {
    const nm = path.join(env, 'node_modules');
    list.push((fs.existsSync(nm) ? nm : env) + path.sep);
  }
  list.push(path.join(ROOT, 'node_modules') + path.sep, '/opt/npm-tools/node_modules/', ROOT + path.sep);
  return list;
}

const warned = new Set();   // tools already reported as loaded from outside the repository
// The tools package.json pins (acorn, acorn-walk); only those have a "right" version to warn about.
const PINNED = (() => { try { return new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies || {})); } catch (e) { return new Set(); } })();

/** toolRequire('acorn') -> the module, from the first place that has it; throws one clear message if none does. */
export function toolRequire(name) {
  const tried = [];
  const repo = path.join(ROOT, 'node_modules') + path.sep;
  for (const dir of candidates()) {
    try {
      const mod = createRequire(dir)(name);
      // WATCH OUT: a copy from outside this repository may be another version than package-lock.json names, so results could differ
      // from CI's; say where it came from (once per tool) so a difference can be traced.
      if (dir !== repo && PINNED.has(name) && !process.env.SMOKEBOX_TOOLS && !warned.has(name)) { warned.add(name); console.error('note: "' + name + '" was loaded from ' + dir + ', not from this repository (run "npm ci" to use the pinned version).'); }
      return mod;
    } catch (e) { if (e && e.code !== 'MODULE_NOT_FOUND') throw e; tried.push(dir); }
  }
  throw new Error('Cannot find "' + name + '". Run "npm install" in the repository, or set SMOKEBOX_TOOLS to a folder that has node_modules with it. Tried: ' + tried.join(', '));
}
