#!/usr/bin/env node
/* Counts how well the code is explained, so "every function explained" is measured, not hoped.
 *   node tools/comment-audit.mjs [files...] [--max-gap 40] [--min-words 6] [--report]
 * Default files: every src/js/*.js, src/css/*.css, server/*.mjs and src/index.template.html. Exit code 1 if any problem (unless --report).
 * LEAN rules (see docs/comment-style.md). This is a floor, not a goal:
 *  - the file starts with a header comment that has "WHAT THIS FILE IS" (the template has "READ ME FIRST")
 *  - every NAMED function has a comment directly above it (or at the top of its body) of at least --min-words words
 *  - no more than --max-gap lines of code in a row without any note (skipped between "audit:data-start" and "audit:data-end", which must pair up)
 *  - a named function is also one handed to a name through a wrapper call or a choice (const f = debounce(() => {...})) when it spans 3+ lines
 *  - no "</script" in the file
 *  Inline callbacks are not checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { toolRequire } from './_deps.mjs';
import { fileURLToPath } from 'node:url';
const acorn = toolRequire('acorn');
const walk = toolRequire('acorn-walk');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? +args[i + 1] : d; };
const report = args.includes('--report');
const MAX_GAP = opt('max-gap', 40), MIN_WORDS = opt('min-words', 6);
const skip = new Set(); args.forEach((a, i) => { if (a === '--max-gap' || a === '--min-words') skip.add(i).add(i + 1); });
let files = args.filter((a, i) => !a.startsWith('--') && !skip.has(i));
if (!files.length) {
  for (const [dir, ext] of [['src/js', '.js'], ['src/css', '.css'], ['server', '.mjs']]) for (const f of (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)) : []).sort()) if (f.endsWith(ext)) files.push(path.join(dir, f));
  files.push('src/index.template.html');
}

const words = (t) => (t.replace(/[\/*#!<>-]+/g, ' ').match(/[A-Za-z0-9']+/g) || []).length;

/* Turns a flat list of comments into groups: runs of // lines on consecutive lines become one comment. */
function groupComments(list) {
  const out = [];
  for (const c of list) {
    const last = out[out.length - 1];
    if (last && !c.block && !last.block && c.startLine === last.endLine + 1 && !last.trailing && !c.trailing) { last.endLine = c.endLine; last.text += '\n' + c.text; last.end = c.end; }
    else out.push({ ...c });
  }
  return out;
}

function auditJs(file, src) {
  const problems = [];
  const raw = [];
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: file.endsWith('.mjs') ? 'module' : 'script', locations: true, allowHashBang: true,
    onComment: (block, text, start, end, s, e) => raw.push({ block, text, start, end, startLine: s.line, endLine: e.line, trailing: false }) });
  const lines = src.split('\n');
  // a comment is "trailing" when code comes before it on its first line
  for (const c of raw) c.trailing = /\S/.test(src.slice(src.lastIndexOf('\n', c.start - 1) + 1, c.start));
  const groups = groupComments(raw);
  const commentLines = new Set(); for (const g of groups) if (!g.trailing) for (let l = g.startLine; l <= g.endLine; l++) commentLines.add(l);
  const noteLines = new Set(commentLines); for (const g of groups) if (g.trailing) noteLines.add(g.startLine);
  const above = (line) => groups.find((g) => !g.trailing && g.endLine <= line - 1 && g.endLine >= line - 2);
  const topInside = (fn) => { const b = fn.body.type === 'BlockStatement' ? fn.body : null; if (!b) return null; return groups.find((g) => g.startLine >= b.loc.start.line && g.startLine <= b.loc.start.line + 3 && g.start > b.start); };

  // 1. file header
  const first = groups[0];
  if (!first || first.startLine > 3 || !/WHAT THIS FILE IS/i.test(first.text)) problems.push([1, 'file header with "WHAT THIS FILE IS" is missing']);

  // 2. functions
  let named = 0, inline = 0, covered = 0;
  const stmtOf = (anc) => { for (let i = anc.length - 2; i >= 0; i--) { const t = anc[i].type; if (t !== 'BlockStatement' && (/Statement$|Declaration$/.test(t) || t === 'Property' || t === 'MethodDefinition' || t === 'PropertyDefinition')) return anc[i]; } return null; };
  // A function is named when it is what a name is given to: directly, or (when it spans three lines or more) through one wrapper call or
  // choice in between (const f = debounce(() => {...}), const f = ok ? () => {...} : null), so wrapping a real function does not hide it.
  // One-line choices such as "opts.now || (() => Date.now())" stay inline.
  const namesIt = (p, child) => p && ((p.type === 'VariableDeclarator' && p.init === child) || (p.type === 'AssignmentExpression' && p.right === child)
      || (p.type === 'Property' && p.value === child) || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition');
  const check = (node, state, anc) => {
    let parent = anc[anc.length - 2];
    const wrap = parent && node.loc.end.line - node.loc.start.line >= 2
      && ((parent.type === 'CallExpression' && parent.callee.type === 'Identifier' && parent.arguments.length === 1) || parent.type === 'ConditionalExpression' || parent.type === 'LogicalExpression');
    const viaWrap = wrap && namesIt(anc[anc.length - 3], parent);
    if (viaWrap) parent = anc[anc.length - 3];
    const isNamed = node.type === 'FunctionDeclaration' || viaWrap || namesIt(parent, node);
    const iife = parent && parent.type === 'CallExpression' && parent.callee === node;
    if (iife) return;
    const len = node.loc.end.line - node.loc.start.line + 1;
    const st = isNamed ? (node.type === 'FunctionDeclaration' ? node : stmtOf(anc)) : stmtOf(anc);
    const stLine = st ? st.loc.start.line : node.loc.start.line;
    const d = above(stLine) || (isNamed ? topInside(node) : null);
    const name = (node.id && node.id.name) || (parent && parent.type === 'VariableDeclarator' && parent.id.name) || (parent && parent.type === 'Property' && (parent.key.name || parent.key.value)) || (parent && parent.type === 'AssignmentExpression' && src.slice(parent.left.start, parent.left.end)) || (parent && parent.type === 'MethodDefinition' && parent.key.name) || '(anonymous)';
    if (isNamed) {
      named++;
      if (!d || words(d.text) < MIN_WORDS) { problems.push([node.loc.start.line, `function ${name}: needs a plain-words comment above it (at least ${MIN_WORDS} words)`]); return; }
      covered++;
    } else {
      inline++; covered++; // inline callbacks are not checked in the lean standard
    }
  };
  walk.ancestor(ast, { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check });

  // 3. gaps
  let run = 0, runStart = 0, codeLines = 0, flagged = false;
  const dm = { inData: false, at: 0 };
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1, t = lines[i].trim();
    if (dataMark(t, n, dm, problems)) { run = 0; continue; }
    if (commentLines.has(n)) { run = 0; flagged = false; continue; }
    if (!t) continue;
    codeLines++;
    if (noteLines.has(n)) { run = 0; flagged = false; continue; }
    if (dm.inData) continue;
    if (!run) runStart = n;
    run++;
    if (run > MAX_GAP && !flagged) { problems.push([runStart, `more than ${MAX_GAP} lines of code in a row with no note (starting here)`]); flagged = true; }
  }
  dataUnclosed(dm, problems);
  // Tool scripts are never placed inside the page, so only files under src/ must avoid a closing script tag.
  if (!file.replace(/\\/g, '/').startsWith('tools/') && /<\/script/i.test(src)) problems.push([0, 'contains "</script" (the build refuses it)']);
  return { problems, named, inline, covered, commentLines: commentLines.size, codeLines };
}

function auditCssLike(file, src, isHtml) {
  const problems = [];
  const cm = []; const re = isHtml ? /<!--([\s\S]*?)-->/g : /\/\*([\s\S]*?)\*\//g; let m;
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  while ((m = re.exec(src))) cm.push({ startLine: lineOf(m.index), endLine: lineOf(m.index + m[0].length), text: m[1] });
  const head = cm[0];
  if (!head || head.startLine > 3 || !new RegExp(isHtml ? 'READ ME FIRST' : 'WHAT THIS FILE IS', 'i').test(head.text)) problems.push([1, isHtml ? 'needs a "READ ME FIRST" comment at the top' : 'file header with "WHAT THIS FILE IS" is missing']);
  const commentLines = new Set(); for (const c of cm) for (let l = c.startLine; l <= c.endLine; l++) commentLines.add(l);
  const lines = src.split('\n'); let run = 0, runStart = 0, codeLines = 0, flagged = false;
  const dm = { inData: false, at: 0 };
  const gap = isHtml ? 60 : MAX_GAP;
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1, t = lines[i].trim();
    if (dataMark(t, n, dm, problems)) continue;
    if (commentLines.has(n)) { run = 0; flagged = false; continue; }
    if (!t) continue; codeLines++; if (dm.inData) continue; if (!run) runStart = n; run++;
    if (run > gap && !flagged) { problems.push([runStart, `more than ${gap} lines in a row with no note (starting here)`]); flagged = true; }
  }
  dataUnclosed(dm, problems);
  return { problems, named: 0, inline: 0, covered: 0, commentLines: commentLines.size, codeLines };
}

// Reads one line for the "audit:data-start" / "audit:data-end" markers and keeps track of being inside a data block. A start inside a block
// and an end with no start are problems. Returns true when the line is a marker.
function dataMark(t, n, dm, problems) {
  if (/audit:data-start/.test(t)) {
    if (dm.inData) problems.push([n, 'audit:data-start inside another data block (the one at line ' + dm.at + ' has no audit:data-end)']);
    dm.inData = true; dm.at = n; return true;
  }
  if (/audit:data-end/.test(t)) {
    if (!dm.inData) problems.push([n, 'audit:data-end with no audit:data-start before it']);
    dm.inData = false; return true;
  }
  return false;
}
// WATCH OUT: a data block that is never closed would switch the gap rule off for the rest of the file, so it is a problem of its own.
function dataUnclosed(dm, problems) {
  if (dm.inData) problems.push([dm.at, 'audit:data-start has no audit:data-end, so the gap rule would be off to the end of the file']);
}

let bad = 0, T = { named: 0, covered: 0, inline: 0, cl: 0, code: 0 };
console.log('file'.padEnd(34), 'funcs'.padStart(6), 'noted'.padStart(6), 'comment%'.padStart(9), ' problems');
for (const f of files) {
  const abs = path.resolve(root, f);
  if (!fs.existsSync(abs)) { console.log(f.padEnd(34), '(missing)'); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  let r;
  try { r = /\.m?js$/.test(f) ? auditJs(f, src) : auditCssLike(f, src, f.endsWith('.html')); } catch (e) { r = { problems: [[0, 'does not parse: ' + e.message]], named: 0, inline: 0, covered: 0, commentLines: 0, codeLines: 1 }; }
  const total = r.named + r.inline;
  const pct = Math.round((100 * r.commentLines) / Math.max(1, r.commentLines + r.codeLines));
  console.log(f.replace('src/', '').padEnd(34), String(total).padStart(6), String(r.covered).padStart(6), (pct + '%').padStart(9), ' ', r.problems.length ? r.problems.length + ' problem(s)' : 'ok');
  for (const [line, msg] of r.problems.slice(0, 12)) console.log('      line ' + String(line).padStart(5) + ': ' + msg);
  if (r.problems.length > 12) console.log('      ... and ' + (r.problems.length - 12) + ' more');
  if (r.problems.length) bad++;
  T.named += r.named; T.inline += r.inline; T.covered += r.covered; T.cl += r.commentLines; T.code += r.codeLines;
}
console.log(`\n${files.length} files, ${T.named + T.inline} functions (${T.named} named, ${T.inline} inline callbacks), ${T.covered} explained, comment lines ${T.cl} vs code lines ${T.code}`);
console.log(bad ? `${bad} file(s) need work` : 'all files pass');
process.exit(bad && !report ? 1 : 0);
