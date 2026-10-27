#!/usr/bin/env node
// WHAT THIS FILE IS: The build tool. It glues src/css/*.css and src/js/*.js, in name order (so the
//    two-digit prefixes set the order), into the template and writes dist/smokebox.html: one self-contained
//    file that works offline. Files whose names start with an underscore are skipped. Run: node
//    tools/build.mjs [--out dist/smokebox.html] [--quiet]
// PARTS: read options, list the files, wrap each JS file with a banner line and its own safety wrapper,
//    fill the template, write the result.
// USES: src/index.template.html, src/css, src/js. USED BY: build-artifact.mjs and anyone who needs a fresh
//    dist file.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const outIdx = args.indexOf('--out');
const outFile = path.resolve(root, outIdx >= 0 ? args[outIdx + 1] : 'dist/smokebox.html');

// Sorted names of the files in a folder that end with ext, skipping names that start with an underscore. An
// empty list if the folder is missing.
const list = (dir, ext) => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith(ext) && !f.startsWith('_')).sort()
  : [];

const cssFiles = list(path.join(root, 'src/css'), '.css');
const jsFiles = list(path.join(root, 'src/js'), '.js');
const tplPath = path.join(root, 'src/index.template.html');
if (!fs.existsSync(tplPath)) { console.error('missing src/index.template.html'); process.exit(1); }

let css = '';
for (const f of cssFiles) css += `\n/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(root, 'src/css', f), 'utf8');

let js = '';
for (const f of jsFiles) {
  const body = fs.readFileSync(path.join(root, 'src/js', f), 'utf8');
  // A closing script tag inside the code would end the inline script early, so the build refuses.
  if (/<\/script/i.test(body)) { console.error(`ERROR: ${f} contains "</script" which would end the inline script. Write "<\\/script" instead.`); process.exit(1); }
  // A syntax error in one file would stop the whole inline script before any try/catch runs, so the build refuses it here, by name.
  // vm.Script only compiles the code; nothing runs.
  try { new vm.Script(body, { filename: 'src/js/' + f }); } catch (e) { console.error(`ERROR: src/js/${f} does not parse: ${e.message}`); process.exit(1); }
  // each file is wrapped in its own try/catch boundary so one broken module is reported by name instead of killing the rest silently.
  // WATCH OUT: that block also hides a file's top-level const, let and class from every other file; test/cross-file-names.test.mjs catches a use.
  js += `\n/* ===== ${f} ===== */\n;try{\n${body}\n}catch(e){console.error('[smokebox] module ${f} failed to load:',e);window.__sbLoadErrors=(window.__sbLoadErrors||[]);window.__sbLoadErrors.push({file:'${f}',message:String(e&&e.message||e)});}\n`;
}

const tpl = fs.readFileSync(tplPath, 'utf8');
// The version people see in Settings: the number in package.json plus a short fingerprint of everything built, so two
// builds of different code never show the same label. It comes from the files only (no git, no clock), so the same
// sources always build the same page and CI's dist check still holds.
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const buildId = crypto.createHash('sha256').update(tpl).update(css).update(js).digest('hex').slice(0, 7);
js = `\nwindow.SB_BUILD = { version: ${JSON.stringify(pkgVersion)}, id: ${JSON.stringify(buildId)} };\n` + js;
if (!tpl.includes('<!--SB:CSS-->') || !tpl.includes('<!--SB:JS-->')) { console.error('template needs <!--SB:CSS--> and <!--SB:JS--> markers'); process.exit(1); }
// The replacements are given as functions so any dollar signs in the code are copied exactly as written.
const html = tpl.replace('<!--SB:CSS-->', () => `<style>${css}\n</style>`).replace('<!--SB:JS-->', () => `<script>${js}\n</script>`);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
if (!quiet) {
  console.log(`built ${path.relative(root, outFile)}  ${(html.length / 1024).toFixed(0)} KB`);
  console.log(`  css: ${cssFiles.join(', ') || '(none)'}`);
  console.log(`  js:  ${jsFiles.join(', ') || '(none)'}`);
}
