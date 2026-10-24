#!/usr/bin/env node
/* Proves that adding comments did not change the program.
 *   node tools/code-fingerprint.mjs snapshot [files...]   remember what the code is right now (default: every src file)
 *   node tools/code-fingerprint.mjs check [files...]      compare with the snapshot: prints SAME, CHANGED or NO BASELINE per file; exit 1 on
 *                                                         anything but SAME. With no names it checks every src file AND every file in the snapshot,
 *                                                         so a new file with no snapshot is not passed over.
 *   node tools/code-fingerprint.mjs accept <files...>     same as snapshot for the files named (use after a deliberate code change); refuses to run
 *                                                         with no names, so one command cannot bless every change at once
 * How: JS is parsed with acorn and the syntax tree (without positions) is hashed, so comments, blank lines and indentation do not matter
 * but any real change does. CSS and HTML have their comments removed and whitespace collapsed before hashing.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { toolRequire } from './_deps.mjs';
import { fileURLToPath } from 'node:url';

const acorn = toolRequire('acorn');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(root, 'test/.baseline/fingerprints.json');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** fingerprint(file) -> a hash of the file's program with comments and layout left out, so only real code changes move it. */
export function fingerprint(file) {
  const abs = path.resolve(root, file);
  const src = fs.readFileSync(abs, 'utf8');
  const ext = path.extname(abs);
  if (ext === '.js' || ext === '.mjs') {
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: ext === '.mjs' ? 'module' : 'script', allowHashBang: true });
    return sha(JSON.stringify(ast, (k, v) => (k === 'start' || k === 'end' || k === 'loc' || k === 'range' ? undefined : v)));
  }
  if (ext === '.css') return sha(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim());
  if (ext === '.html') return sha(src.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim());
  throw new Error('unsupported file type: ' + file);
}

// Lists every file the fingerprint covers by default: src JS, CSS and the template, plus the tools.
function defaults() {
  const out = [];
  for (const [dir, ext] of [['src/js', '.js'], ['src/css', '.css'], ['tools', '.mjs']]) {
    const d = path.join(root, dir);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d).sort()) if (f.endsWith(ext)) out.push(path.join(dir, f));
  }
  out.push('src/index.template.html');
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const files = (rest.length ? rest : defaults()).map((f) => path.relative(root, path.resolve(root, f)));
  const base = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {};
  if (cmd === 'accept' && !rest.length) { console.log('accept needs the names of the files you changed on purpose (use snapshot to start over for every file)'); process.exit(2); }
  if (cmd === 'snapshot' || cmd === 'accept') {
    for (const f of files) { try { base[f] = fingerprint(f); console.log('saved   ', f); } catch (e) { console.log('SKIPPED ', f, '-', e.message); } }
    fs.mkdirSync(path.dirname(BASE), { recursive: true });
    fs.writeFileSync(BASE, JSON.stringify(base, null, 1));
  } else if (cmd === 'check') {
    let bad = 0;
    for (const f of rest.length ? files : [...new Set([...files, ...Object.keys(base)])]) {
      if (!base[f]) { console.log('NO BASELINE', f); bad++; continue; }
      let now; try { now = fingerprint(f); } catch (e) { console.log('CHANGED (does not parse: ' + e.message + ')', f); bad++; continue; }
      if (now === base[f]) console.log('SAME    ', f); else { console.log('CHANGED ', f); bad++; }
    }
    process.exit(bad ? 1 : 0);
  } else { console.log('usage: code-fingerprint.mjs snapshot|check|accept [files]'); process.exit(2); }
}
