// tools/build.mjs wraps every src/js file in its own try block, so a top-level const, let or class in one file is NOT visible in the others.
// A file that uses such a name from another file without declaring it would parse and build fine and then fail only when that line runs.
// This test finds those uses: a name declared with const/let/class at the top of one file and used, undeclared, in another.
// Run: node --test test/cross-file-names.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolRequire } from '../tools/_deps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const acorn = toolRequire('acorn');
const walk = toolRequire('acorn-walk');

// Collects every name a pattern binds (plain names, and the parts of { a, b: [c] } style patterns).
function bound(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.add(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => bound(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((q) => bound(q, out));
  else if (p.type === 'RestElement') bound(p.argument, out);
  else if (p.type === 'AssignmentPattern') bound(p.left, out);
  return out;
}

// Reads one source file: the const/let/class names at its top level, every name it declares anywhere, and the names it uses as values.
export function namesOf(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
  const top = new Set(), declared = new Set(), used = new Set();
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') st.declarations.forEach((d) => bound(d.id, top));
    if (st.type === 'ClassDeclaration') top.add(st.id.name);
  }
  walk.full(ast, (n) => {
    if (n.type === 'VariableDeclarator') bound(n.id, declared);
    else if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) { if (n.id) declared.add(n.id.name); n.params.forEach((p) => bound(p, declared)); }
    else if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') { if (n.id) declared.add(n.id.name); }
    else if (n.type === 'CatchClause') bound(n.param, declared);
  });
  // Names used as values: every identifier except property names, object keys, method names and labels.
  walk.ancestor(ast, {
    Identifier(n, st, anc) {
      const p = anc[anc.length - 2];
      if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
      if (p && (p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key === n && !p.computed && !p.shorthand) return;
      if (p && /^(LabeledStatement|BreakStatement|ContinueStatement)$/.test(p.type)) return;
      used.add(n.name);
    },
  });
  return { top, declared, used };
}

test('no src/js file uses a top-level const, let or class of another file (the build keeps each file in its own block)', () => {
  const dir = path.join(ROOT, 'src/js');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('_')).sort();
  const info = Object.fromEntries(files.map((f) => [f, namesOf(fs.readFileSync(path.join(dir, f), 'utf8'))]));
  const owner = new Map();
  for (const f of files) for (const n of info[f].top) if (!owner.has(n)) owner.set(n, f);
  const bad = [];
  for (const f of files) for (const n of info[f].used) {
    const from = owner.get(n);
    if (from && from !== f && !info[f].declared.has(n) && !info[f].top.has(n)) bad.push(f + ' uses ' + n + ' (a top-level name in ' + from + ', which it cannot see)');
  }
  assert.deepEqual(bad, []);
});

test('the check itself catches a use of another file\'s top-level const', () => {
  const a = namesOf('const HELPER = 1;\nclass Box {}\n'), b = namesOf('function f() { return HELPER + new Box().x + o.HELPER + ({ HELPER: 1 }).HELPER; }\n');
  assert.ok(a.top.has('HELPER') && a.top.has('Box'));
  assert.ok(b.used.has('HELPER') && b.used.has('Box') && !b.declared.has('HELPER'));
  const c = namesOf('function f(HELPER) { return HELPER; }\n');
  assert.ok(c.declared.has('HELPER'), 'a parameter of the same name is the file\'s own');
});
