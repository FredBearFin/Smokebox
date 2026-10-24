// Loads Smokebox modules into globalThis.SB for Node tests (no DOM needed for the logic layers).
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = root;

/** loadSB(['00-util','10-config','20-engine']) -> globalThis.SB. Missing optional files are skipped with a warning. */
export async function loadSB(names = ['00-util', '10-config', '20-engine']) {
  // The engine plans with the Rust kitchen planner when a station limit is set, so it is loaded (and started) with it.
  const want = names.map((n) => n.replace(/\.js$/, ''));
  if (want.includes('20-engine') && !want.includes('19-planner')) want.splice(want.indexOf('20-engine'), 0, '18-engine-wasm', '19-planner');
  names = want;
  for (const n of names) {
    const file = path.join(root, 'src/js', n.endsWith('.js') ? n : n + '.js');
    if (!fs.existsSync(file)) { console.warn('[load] missing', n); continue; }
    await import(pathToFileURL(file).href);
  }
  if (globalThis.SB && globalThis.SB.planner) globalThis.SB.planner.startSync();
  return globalThis.SB;
}
