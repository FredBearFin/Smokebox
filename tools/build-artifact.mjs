#!/usr/bin/env node
// WHAT THIS FILE IS: Builds dist/smokebox.artifact.html: the same app as a body-only page for the Artifact
//    host, which wraps the file in its own doctype, head and body. Differences from smokebox.html: (1) no
//    doctype, html, head, body or meta tags (title, font links, styles, markup and scripts stay); (2) every
//    data-theme becomes data-look, because the host writes its own data-theme (light or dark) on the root
//    element; (3) a first script sets data-look to day before first paint.
// PARTS: run build.mjs first, pull out the title, links, styles and body, rename the attribute, check no
//    document tag is left, write.
// USES: build.mjs. Run: node tools/build-artifact.mjs [--in file] [--out file] [--no-build]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// Reads the value after --name on the command line, or the default d.
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const inFile = path.resolve(root, arg('in', 'dist/smokebox.html'));
const outFile = path.resolve(root, arg('out', 'dist/smokebox.artifact.html'));

if (!args.includes('--no-build')) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/build.mjs'), '--out', path.relative(root, inFile), '--quiet'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
} else {
  // WATCH OUT: --no-build trusts the page that is already there; a page older than any source file would ship old code, so it is refused.
  const newest = ['src/js', 'src/css'].flatMap((d) => (fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)).map((f) => path.join(root, d, f)) : []))
    .concat(path.join(root, 'src/index.template.html')).filter((f) => fs.existsSync(f)).reduce((m, f) => Math.max(m, fs.statSync(f).mtimeMs), 0);
  if (!fs.existsSync(inFile) || fs.statSync(inFile).mtimeMs < newest) { console.error(path.relative(root, inFile) + ' is missing or older than the sources; run without --no-build (or build it first).'); process.exit(1); }
}
let html = fs.readFileSync(inFile, 'utf8');

const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, 'Smokebox KDS'])[1].trim();
const links = (html.match(/<link\b[^>]*>/gi) || []).filter((l) => /rel=["']stylesheet["']/i.test(l) && /fonts\.googleapis\.com/.test(l));
const preconnects = (html.match(/<link\b[^>]*>/gi) || []).filter((l) => /rel=["']preconnect["']/i.test(l));

// the body content: everything between <body> and </body>
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) { console.error('no <body> in', inFile); process.exit(1); }
let body = bodyMatch[1];

// styles and the pre-paint script live in <head> of the template: keep them, in order
const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
const head = headMatch ? headMatch[1] : '';
const headStyles = head.match(/<style[\s\S]*?<\/style>/gi) || [];
const headScripts = head.match(/<script[\s\S]*?<\/script>/gi) || [];

const out = [
  `<title>${title}</title>`,
  ...preconnects,
  ...links,
  ...headStyles,
  // first paint: our look before anything draws (the template's own pre-paint script follows and may switch to the saved one)
  `<script>document.documentElement.setAttribute('data-theme','day');</script>`,
  ...headScripts,
  body.trim(),
].join('\n');

const final = out.replace(/data-theme(?![-\w])/g, 'data-look');
const markup = final.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');  // text inside code may mention <body>
if (/<(!doctype|html|head|body)\b/i.test(markup)) { console.error('artifact build still contains a document tag outside script/style'); process.exit(1); }

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, final);
console.log(`built ${path.relative(root, outFile)}  ${(final.length / 1024).toFixed(0)} KB  (data-theme -> data-look: ${(out.match(/data-theme(?![-\w])/g) || []).length} places)`);
