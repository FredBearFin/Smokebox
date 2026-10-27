#!/usr/bin/env node
/* Smokebox integration watcher: finds cross-file breakage while the owners are still working.
 *
 *   node tools/contract-check.mjs [--no-build] [--static] [--unit | --no-unit] [--json] [--log] [--verbose]
 *
 *  1. builds dist/integ.html (private build) and boots it in Chromium: window.__sbLoadErrors, console errors, page errors, boot-error screen.
 *     Page errors are mapped back from dist/integ.html line numbers to src/js/<file>:<line>.
 *  2. static scan (acorn) of every src/js/*.js: each SB.<ns>.<member> reference (aliases like `const U = SB.util` and `const {h} = U` resolved),
 *     checked in the booted page, split into UNGUARDED (a real problem when missing) and guarded (a note). Also: dispatch action names vs
 *     SB.engine.ACTIONS, sheet names vs SB.sheets, icon names vs SB.icons, chart types vs SB.charts, kpi ids vs docs/metrics.md, registerPage args vs
 *     docs/office-contract.md, ctx.* and page.* members vs the real ones, load order (a file using at load time a namespace a later file defines).
 *  3. contract list (SPEC 19, SPEC 20, SPEC 11, docs/office-contract.md, docs/metrics.md) asserted in the live page, plus a smoke run: every sheet opens,
 *     every office page renders without an error card, the office releases its timers and subscriptions, sim.live starts and stops, the floor takes a zone.
 *  4. heuristics (notes only): duplicate ids, CSS classes used in JS that no CSS defines, data-* hooks read but never set, a sheet/page registered twice.
 *  5. the unit suite (node tools/test.mjs), at most once per 25 minutes unless --unit.
 *
 * Output: PROBLEMS (definite breakage) and NOTES (informational). Exit code 1 when there is any problem (2 if the tool itself crashes).
 * State between runs lives in test/.out/contract/ (streak counter for "still broken on the second run", last.txt, last.json, unit.stamp).
 * --log appends this run to docs/integration-log.md. --static skips the browser and the unit suite.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolRequire } from './_deps.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const acorn = toolRequire('acorn');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_JS = path.join(ROOT, 'src/js');
const SRC_CSS = path.join(ROOT, 'src/css');
const OUT_DIR = path.join(ROOT, 'test/.out/contract');
export const DIST_FILE = 'dist/integ.html';

/* ============================================================================================================================
 * Owners
 * ========================================================================================================================== */
const OWN = {
  sim: ['Sim', 'ad717b3d4d0948743'], board: ['Floor board', 'a5c9a0e99faa92b34'], sheets: ['Floor sheets', 'a515d2bea06233e68'],
  offA: ['Office A', 'ab2a28fc08b3ac410'], offB: ['Office B', 'a5e50a4f63f7caddc'], offC: ['Office C', 'a0a7d50f16d6349b1'], lead: ['Lead', 'lead'],
};
const OWNER_OF = {
  '45-sim.js': OWN.sim, '70-floor-board.js': OWN.board, '20-floor.css': OWN.board,
  '71-floor-order.js': OWN.sheets, '72-floor-sheets.js': OWN.sheets, '21-floor-sheets.css': OWN.sheets,
  '80-office-core.js': OWN.offA, '81-office-pace.js': OWN.offA, '30-office.css': OWN.offA,
  '82-office-money.js': OWN.offB, '83-office-safety.js': OWN.offB, '85-office-stock.js': OWN.offB, '31-office-money.css': OWN.offB,
  '84-office-data.js': OWN.offC, '32-office-data.css': OWN.offC,
};
export const ownerOf = (file) => (OWNER_OF[file] || (/^(0\d|[1-6]\d)-|^99-/.test(file) ? OWN.lead : ['?', '?']))[0];
export const ownerId = (file) => (OWNER_OF[file] || OWN.lead)[1];
/** which source file provides each namespace (used to say who must add a missing member) */
const NS_FILE = {
  util: '00-util.js', icons: '05-icons.js', config: '10-config.js', engine: '20-engine.js', store: '30-store.js', metrics: '40-metrics.js', sim: '45-sim.js',
  charts: '50-charts.js', ui: '60-shell.js', sheets: '60-shell.js', router: '60-shell.js', theme: '60-shell.js', shell: '60-shell.js', boot: '99-boot.js',
  floor: '70-floor-board.js', office: '80-office-core.js',
};
const SUB_FILE = { 'office.kit': '80-office-core.js', 'sim.live': '45-sim.js' };
const providerFile = (p) => { const s = p.split('.'); return SUB_FILE[s.slice(1, 3).join('.')] || NS_FILE[s[1]] || '?'; };

/* ============================================================================================================================
 * The contract (what the specs promise exists)
 * ========================================================================================================================== */
const PAGE_TABLE = [
  { id: 'pace', title: 'Speed', icon: 'gauge', order: 1 }, { id: 'tickets', title: 'Tickets', icon: 'receipt', order: 2 },
  { id: 'stations', title: 'Stations', icon: 'layers', order: 3 }, { id: 'money', title: 'Sales and money', icon: 'dollar', order: 4 },
  { id: 'safety', title: 'Safety', icon: 'shield-check', order: 5 }, { id: 'stock', title: 'Stock and 86', icon: 'package', order: 6 },
  { id: 'data', title: 'Menu, prices and shop', icon: 'sliders', order: 7 },
];
const PAGE_FILE = { pace: '81-office-pace.js', tickets: '81-office-pace.js', stations: '81-office-pace.js', money: '82-office-money.js', safety: '83-office-safety.js', stock: '85-office-stock.js', data: '84-office-data.js' };
const SHEET_NAMES = 'order hold board86 recall demo help specs menu'.split(' ');
const CTX_KEYS = 'filters dataset opts prepared now metrics onFilterChange navigate openSheet theme kit'.split(' ');
const PAGE_METHODS = 'headline tiles section card panel table insights refresh destroy'.split(' ');
const REQUIRED_ICONS = ('flame pot fry snow bag plate car phone plus minus x check check-circle clock alert alert-circle history undo redo settings sliders thermometer shield shield-check package chart-line chart-bar gauge list grid search trash edit download upload refresh play pause fast-forward sun moon volume volume-off lock unlock info help keyboard home eye arrow-up arrow-down arrow-right chevron-left chevron-right chevron-up chevron-down bell users receipt scale timer flag ban zap layers menu more copy filter calendar dollar trending-up trending-down door sparkle smoke target pulse stack book').split(' ');
const w = (s) => s.split(/\s+/).filter(Boolean);
const CONTRACT = [
  { src: 'SPEC 19', base: 'SB.ui', fn: w('sheet confirm toast menu tooltip announce stepper segmented chip badge') },
  { src: 'design-notes (shell)', base: 'SB.ui', fn: w('toggle meter field errorCard copyText closeMenu') },
  { src: 'SPEC 19', base: 'SB.sheets', fn: w('register open closeAll has names isOpen') },
  { src: 'SPEC 19', base: 'SB.router', fn: w('view go hashFor viewFor onChange') },
  { src: 'SPEC 19', base: 'SB.theme', fn: w('get set office setOffice textSize setTextSize') },
  { src: 'SPEC 19', base: 'SB.shell', fn: w('mount ignite extinguish inOffice') },
  { src: 'SPEC 19', base: 'SB.icons', fn: w('svg html has names') },
  { src: 'SPEC 19', base: 'SB.floor', fn: w('mount unmount setZone highlight setSound sound'), any: w('shortcuts') },
  { src: 'SPEC 19 + office-contract', base: 'SB.office', fn: w('mount navigate unmount registerPage'), obj: w('kit') },
  { src: 'office-contract 3', base: 'SB.office.kit', fn: w('page empty errorCard chip button'), obj: w('fmt') },
  { src: 'office-contract 3', base: 'SB.office.kit.fmt', fn: w('ms sec pct money g num hour clock date') },
  { src: 'SPEC 11', base: 'SB.sim', fn: w('sample sampleInfo sampleEnabled setSampleEnabled seedFirstRun'), obj: w('live') },
  { src: 'SPEC 11', base: 'SB.sim.live', fn: w('start stop burst crew status onChange') },
  { src: 'SPEC 20', base: 'SB.store', fn: w('init destroy status getState now tick dispatch dispatchEx lastResult subscribe subscribeTick flushNotify setSpeed speed clock flush exportAll importAll exportCsv reset resetLive attachSim dataset'), obj: w('select'), any: w('KEY CORRUPT_KEY') },
  { src: 'SPEC 20', base: 'SB.store.select', fn: w('activeTickets ticketsForZone expoTickets recent voided allDay availability unavailable batches counts timing events menu ingredients settings dataset') },
  { src: 'SPEC 20', base: 'SB.engine', fn: w('apply tick newState availability computeAvail servable allDay gate thermalYield staticYieldComparison pacingPlan planFor ticketTiming ticketProgress checkInvariants validateBackup serialize deserialize allEvents prune channelThresholds defaultSettings describe'), obj: w('views REPORTS ACTIONS helpers'), any: w('REPORT_IDS UNDOABLE DISCARD_REASONS') },
  { src: 'SPEC 20', base: 'SB.engine.views', fn: w('ticketsForZone batches counts') },
  { src: 'SPEC 13/20', base: 'SB.charts', fn: w('line bar hist heat scatter dumbbell gantt meter ring spark stack refreshTheme') },
];
function metricsDocFns() {
  try {
    const t = fs.readFileSync(path.join(ROOT, 'docs/metrics.md'), 'utf8');
    const names = new Set(); const re = /^\| `([A-Za-z_]\w*)\(/gm; let m;
    while ((m = re.exec(t))) names.add(m[1]);
    return [...names];
  } catch (e) { return []; }
}
function kpiIdsFromDocs() {
  try {
    const t = fs.readFileSync(path.join(ROOT, 'docs/metrics.md'), 'utf8');
    const m = /ids: ([\w, ]+?) \|/.exec(t);
    return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  } catch (e) { return []; }
}

/* ============================================================================================================================
 * Static scan with acorn
 * ========================================================================================================================== */
function walk(node, stack, fn) {
  fn(node, stack);
  stack.push(node);
  for (const k in node) {
    if (k === 'type' || k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, stack, fn); }
    else if (v && typeof v.type === 'string') walk(v, stack, fn);
  }
  stack.pop();
}
const unparen = (n) => { while (n && (n.type === 'ChainExpression' || n.type === 'ParenthesizedExpression')) n = n.expression; return n; };

function chainOf(n, al) {
  n = unparen(n);
  if (!n) return null;
  if (n.type === 'Identifier') { if (n.name === 'SB') return ['SB']; return al && al[n.name] ? al[n.name].slice() : null; }
  if (n.type === 'MemberExpression') {
    const base = chainOf(n.object, al);
    if (!base) return null;
    if (!n.computed && n.property.type === 'Identifier') return base.concat(n.property.name);
    if (n.computed && n.property.type === 'Literal' && typeof n.property.value === 'string') return base.concat(n.property.value);
    return null;
  }
  return null;
}
function initChain(init, al) {
  init = unparen(init);
  if (!init) return null;
  const c = chainOf(init, al);
  if (c) return c.length >= 2 ? c : null;
  if (init.type === 'AssignmentExpression' && init.operator === '=') return initChain(init.left, al) || initChain(init.right, al);
  if (init.type === 'LogicalExpression') {
    const l = initChain(init.left, al), r = initChain(init.right, al);
    return init.operator === '&&' ? (r || l) : (l || r);
  }
  return null;
}
const jn = (c) => c.join('.');
const isFn = (n) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const strLit = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : null);
function keyName(p) { if (!p || p.type !== 'Property') return null; if (!p.computed && p.key.type === 'Identifier') return p.key.name; return strLit(p.key); }
function objProp(obj, name) { if (!obj || obj.type !== 'ObjectExpression') return null; for (const p of obj.properties) if (keyName(p) === name) return p.value; return null; }
function exits(s) {
  if (!s) return false;
  if (['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement'].includes(s.type)) return true;
  if (s.type === 'BlockStatement') return s.body.some(exits);
  if (s.type === 'IfStatement') return !!s.alternate && exits(s.consequent) && exits(s.alternate);
  return false;
}
/** every SB.* chain (length >= 2) mentioned anywhere under node, as dotted strings */
const mentionCache = new WeakMap();
function mentions(node, al) {
  if (mentionCache.has(node)) return mentionCache.get(node);
  const set = new Set();
  walk(node, [], (n) => {
    if (n.type === 'MemberExpression' || n.type === 'Identifier') { const c = chainOf(n, al); if (c && c.length >= 2) set.add(jn(c)); }
  });
  mentionCache.set(node, set);
  return set;
}
function covers(set, pj) { for (const q of set) if (pj === q || pj.startsWith(q + '.')) return true; return false; }
function hasOptional(node) {
  let n = node;
  while (n) {
    n = n.type === 'ChainExpression' ? n.expression : n;
    if (n.type === 'MemberExpression') { if (n.optional) return true; n = n.object; } else break;
  }
  return false;
}
function isFeatureTest(node, par) {
  if (!par) return false;
  if (par.type === 'LogicalExpression') return true;
  if (par.type === 'UnaryExpression' && par.operator === '!') return true;
  if ((par.type === 'IfStatement' || par.type === 'ConditionalExpression' || par.type === 'WhileStatement') && par.test === node) return true;
  if (par.type === 'BinaryExpression' && /^(==|===|!=|!==)$/.test(par.operator)) {
    const o = par.left === node ? par.right : par.left;
    if ((o.type === 'Literal' && o.value === null) || (o.type === 'Identifier' && o.name === 'undefined') || (o.type === 'UnaryExpression' && o.operator === 'void')) return true;
  }
  if (par.type === 'CallExpression' && par.callee.type === 'Identifier' && par.callee.name === 'Boolean') return true;
  return false;
}
function guardOf(node, stack, pj, al, usage) {
  const par = stack[stack.length - 1];
  if (hasOptional(node)) return 'optional';
  if (par && par.type === 'CallExpression' && par.callee === node && par.optional) return 'optional';
  if (par && par.type === 'UnaryExpression' && par.operator === 'typeof') return 'typeof';
  if (usage === 'read' && isFeatureTest(node, par)) return 'test';
  let crossedFn = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    const anc = stack[i]; const child = i === stack.length - 1 ? node : stack[i + 1];
    if (isFn(anc)) { crossedFn = true; continue; }
    switch (anc.type) {
      case 'TryStatement': if (anc.block === child && anc.handler && !crossedFn) return 'try-catch'; break;
      case 'IfStatement': if (child !== anc.test && covers(mentions(anc.test, al), pj)) return 'if'; break;
      case 'ConditionalExpression': if (child !== anc.test && covers(mentions(anc.test, al), pj)) return '?:'; break;
      case 'LogicalExpression': if (child === anc.right && covers(mentions(anc.left, al), pj)) return anc.operator; break;
      case 'BlockStatement': case 'Program': {
        const idx = anc.body.indexOf(child);
        for (let j = 0; j < idx; j++) { const s = anc.body[j]; if (s.type === 'IfStatement' && exits(s.consequent) && covers(mentions(s.test, al), pj)) return 'early-exit'; }
        break;
      }
      default:
    }
  }
  return null;
}
/** class tokens contributed by an expression (literal parts only; partial tokens at dynamic boundaries are dropped) */
function classTokens(n) {
  const out = [];
  const parts = [];
  (function flat(x) {
    x = unparen(x);
    if (!x) return;
    if (x.type === 'Literal' && typeof x.value === 'string') parts.push({ s: x.value });
    else if (x.type === 'TemplateLiteral') x.quasis.forEach((q, i) => { parts.push({ s: q.value.cooked == null ? '' : q.value.cooked }); if (i < x.expressions.length) parts.push({ dyn: true }); });
    else if (x.type === 'BinaryExpression' && x.operator === '+') { flat(x.left); flat(x.right); }
    else if (x.type === 'ConditionalExpression') { flat(x.consequent); parts.push({ dyn: true, sep: true }); flat(x.alternate); }
    else if (x.type === 'LogicalExpression') { flat(x.left); parts.push({ dyn: true, sep: true }); flat(x.right); }
    else parts.push({ dyn: true });
  })(n);
  parts.forEach((p, i) => {
    if (p.dyn) return;
    const toks = p.s.split(/\s+/);
    toks.forEach((t, k) => {
      if (!t) return;
      const first = k === 0, last = k === toks.length - 1;
      if (first && i > 0 && parts[i - 1].dyn && !parts[i - 1].sep && !/^\s/.test(p.s)) return;
      if (last && i < parts.length - 1 && parts[i + 1].dyn && !parts[i + 1].sep && !/\s$/.test(p.s)) return;
      if (/[-_:]$/.test(t) || /[^\w-]/.test(t)) return;
      out.push(t);
    });
  });
  return out;
}

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function scanStatic() {
  const files = fs.readdirSync(SRC_JS).filter((f) => f.endsWith('.js') && !f.startsWith('_')).sort();
  const S = {
    files: {}, refs: [], defs: new Map(), regs: { sheets: [], pages: [] }, calls: { sheetOpen: [], dispatch: [], navigate: [], icons: [], cards: [], kpis: [], ctxUse: [], pageUse: [] },
    ids: [], classes: [], dataSet: [], dataRead: [], parseErrors: [], nsDefiner: new Map(), aliasNotes: [], lint: [], uiAccepted: {}, uiCalls: [], shellProps: new Set(),
  };
  for (const file of files) {
    const full = path.join(SRC_JS, file);
    const src = fs.readFileSync(full, 'utf8');
    const st = fs.statSync(full);
    S.files[file] = { lines: src.split('\n').length, mtime: st.mtimeMs, bytes: st.size };
    let ast;
    try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true }); }
    catch (e) { S.parseErrors.push({ file, line: e.loc ? e.loc.line : 0, message: String(e.message).replace(/\s*\(\d+:\d+\)$/, '') }); continue; }
    scanFile(S, file, ast);
  }
  return S;
}


// keys an option-object parameter is read for: o.x, const {x} = o, and one level of hand-over to local helper functions (makeCard(o) -> cardShell(o))
function deriveKeys(fn, idx, locals, depth, seen) {
  const out = { keys: new Set(), pass: false };
  const p = fn.params[idx]; if (!p) return out;
  const nm = p.type === 'Identifier' ? p.name : p.type === 'AssignmentPattern' && p.left.type === 'Identifier' ? p.left.name : null;
  if (!nm) { if (p.type === 'ObjectPattern') p.properties.forEach((q) => { const k = keyName(q); if (k) out.keys.add(k); }); return out; }
  walk(fn.body, [], (n, st) => {
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === nm) { if (!n.computed && n.property.type === 'Identifier') out.keys.add(n.property.name); else if (strLit(n.property)) out.keys.add(strLit(n.property)); else out.pass = true; }
    else if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && n.init && n.init.type === 'Identifier' && n.init.name === nm) n.id.properties.forEach((q) => { const k = keyName(q); if (k) out.keys.add(k); else out.pass = true; });
    else if (n.type === 'Identifier' && n.name === nm) {
      const pp = st[st.length - 1];
      if (pp && pp.type === 'CallExpression' && pp.arguments.includes(n)) {
        const callee = pp.callee.type === 'Identifier' ? pp.callee.name : null; const ai = pp.arguments.indexOf(n);
        if (callee && locals[callee] && depth < 3 && !seen.has(callee)) {
          seen.add(callee); const sub = deriveKeys(locals[callee], ai, locals, depth + 1, seen);
          sub.keys.forEach((k) => out.keys.add(k)); if (sub.pass) out.pass = true;
        } else out.pass = true;
      } else if (pp && (pp.type === 'SpreadElement' || pp.type === 'ReturnStatement')) out.pass = true;
    }
  });
  return out;
}
function deriveAll(fn, locals) { const acc = {}; fn.params.forEach((p, i) => { acc[i] = deriveKeys(fn, i, locals, 0, new Set()); }); return acc; }

export function emptyScan() {
  return { files: {}, refs: [], defs: new Map(), regs: { sheets: [], pages: [] }, calls: { sheetOpen: [], dispatch: [], navigate: [], icons: [], cards: [], kpis: [], ctxUse: [], pageUse: [] }, ids: [], classes: [], dataSet: [], dataRead: [], parseErrors: [], nsDefiner: new Map(), aliasNotes: [], lint: [], uiAccepted: {}, uiCalls: [], shellProps: new Set() };
}
export function scanSource(S, file, src) { scanFile(S, file, acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true })); return S; }
function scanFile(S, file, ast) {
  const isOffice = /^8\d-/.test(file);
  const L = (n) => n.loc.start.line;
  // ---- pass 1: declarations and aliases
  const decls = {}; const cand = [];
  const addDecl = (name) => { decls[name] = (decls[name] || 0) + 1; };
  const patNames = (p, out) => {
    if (!p) return;
    if (p.type === 'Identifier') out.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => patNames(q.type === 'RestElement' ? q.argument : q.value, out));
    else if (p.type === 'ArrayPattern') p.elements.forEach((q) => patNames(q, out));
    else if (p.type === 'AssignmentPattern') patNames(p.left, out);
    else if (p.type === 'RestElement') patNames(p.argument, out);
  };
  walk(ast, [], (n) => {
    if (n.type === 'VariableDeclarator') {
      if (n.id.type === 'Identifier') cand.push(n); else { const ns = []; patNames(n.id, ns); ns.forEach(addDecl); }
    } else if (isFn(n)) {
      if (n.id) addDecl(n.id.name);
      const ns = []; n.params.forEach((p) => patNames(p, ns)); ns.forEach(addDecl);
    } else if (n.type === 'CatchClause' && n.param) { const ns = []; patNames(n.param, ns); ns.forEach(addDecl); }
    else if (n.type === 'ClassDeclaration' && n.id) addDecl(n.id.name);
  });
  const al = {};
  for (let pass = 0; pass < 4; pass++) {
    for (const d of cand) {
      const c = initChain(d.init, al);
      if (c) al[d.id.name] = c;
    }
  }
  // names declared more than once with different meanings are not trusted
  for (const name of Object.keys(al)) {
    const sameCand = cand.filter((d) => d.id.name === name);
    const chains = new Set(sameCand.map((d) => { const c = initChain(d.init, al); return c ? jn(c) : 'x:' + L(d); }));
    if (decls[name] > 0 || chains.size > 1) { delete al[name]; S.aliasNotes.push(file + ': "' + name + '" is declared more than once, alias not resolved'); }
  }
  // wrapper functions: ico(name) -> SB.icons.svg(name); run(type, payload) -> store.dispatchEx(type, payload)
  const iconWrappers = new Set(['ico', 'icon']);
  const dispatchWrappers = new Set();
  const noteWrapper = (name, fnNode) => {
    if (!name || !fnNode || !fnNode.params.length || fnNode.params[0].type !== 'Identifier') return;
    const p0 = fnNode.params[0].name;
    walk(fnNode.body, [], (n) => {
      if (n.type !== 'CallExpression') return;
      const c = chainOf(n.callee, al);
      const a0 = n.arguments[0];
      if (a0 && a0.type === 'Identifier' && a0.name === p0) {
        if (c && (jn(c) === 'SB.icons.svg' || jn(c) === 'SB.icons.html')) iconWrappers.add(name);
        const pn = n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.name;
        if (pn === 'dispatch' || pn === 'dispatchEx') dispatchWrappers.add(name);
      }
    });
  };
  walk(ast, [], (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) noteWrapper(n.id.name, n);
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && isFn(n.init)) noteWrapper(n.id.name, n.init);
  });
  // page variables: const page = kit.page(container, ctx, {...})
  const pageVars = new Set();
  walk(ast, [], (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && n.init.type === 'CallExpression' && n.init.callee.type === 'MemberExpression' && !n.init.callee.computed && n.init.callee.property.name === 'page' && n.init.arguments.length >= 2) pageVars.add(n.id.name);
  });

  const locals = {};
  walk(ast, [], (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) locals[n.id.name] = n;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && isFn(n.init)) locals[n.id.name] = n.init;
  });

  // ---- pass 2: references and everything else
  const rec = (arr, node, extra) => arr.push(Object.assign({ file, line: L(node) }, extra));
  const htmlScan = (text, node) => {
    let m;
    const reId = /\bid=["']([A-Za-z][\w:-]*)["']/g; while ((m = reId.exec(text))) rec(S.ids, node, { id: m[1], via: 'html' });
    const reCls = /\bclass=["']([^"'$]*)["']/g;
    while ((m = reCls.exec(text))) m[1].split(/\s+/).filter((t) => t && !/[^\w-]/.test(t) && !/-$/.test(t)).forEach((t) => rec(S.classes, node, { cls: t, via: 'html' }));
    const reDs = /\bdata-([a-z][\w-]*)\s*=/g; while ((m = reDs.exec(text))) rec(S.dataSet, node, { attr: 'data-' + m[1] });
  };
  const addDef = (p) => S.defs.set(p, (S.defs.get(p) || new Set()).add(file));
  walk(ast, [], (node, stack) => {
    const par = stack[stack.length - 1];
    switch (node.type) {
      case 'MemberExpression': {
        const ch = chainOf(node, al);
        if (!ch || ch.length < 2) break;
        if (par && par.type === 'MemberExpression' && par.object === node && chainOf(par, al)) break; // not the top of its chain
        const cap = ch.slice(0, 4);
        let usage = 'read';
        if (par) {
          if (par.type === 'CallExpression' && par.callee === node) usage = 'call';
          else if (par.type === 'NewExpression' && par.callee === node) usage = 'new';
          else if (par.type === 'AssignmentExpression' && par.left === node) usage = 'assign';
          else if (par.type === 'MemberExpression' && par.object === node) usage = 'index';
          else if (par.type === 'UpdateExpression') usage = 'assign';
        }
        if (cap.length < ch.length) usage = 'index';
        const pj = jn(cap);
        if (usage === 'assign') {
          addDef(pj);
          if (cap.length === 2) { if (!S.nsDefiner.has(pj)) S.nsDefiner.set(pj, new Set()); S.nsDefiner.get(pj).add(file); }
          const rhs = par.right && unparen(par.right);
          if (rhs && rhs.type === 'ObjectExpression') rhs.properties.forEach((p) => { const k = keyName(p); if (k) addDef(pj + '.' + k); });
          if (par.type === 'UpdateExpression' || par.operator !== '=') usage = 'index'; else break;
        }
        // is the reference executed while the file loads (no deferred function around it)?
        let deferred = false;
        for (let i = stack.length - 1; i >= 0; i--) {
          const a = stack[i];
          if (isFn(a)) { const pa = stack[i - 1]; const iife = pa && pa.type === 'CallExpression' && pa.callee === a; if (!iife) { deferred = true; break; } }
        }
        S.refs.push({ file, line: L(node), path: pj, usage, guard: guardOf(node, stack, pj, al, usage), loadTime: !deferred });
        break;
      }
      case 'VariableDeclarator': {
        if (node.id.type === 'ObjectPattern') {
          const c = initChain(node.init, al);
          if (c) node.id.properties.forEach((p) => {
            const k = p.type === 'Property' ? keyName(p) : null;
            if (k) S.refs.push({ file, line: L(p), path: jn(c.concat(k).slice(0, 4)), usage: 'read', guard: guardOf(node, stack, jn(c.concat(k)), al, 'index'), loadTime: false, destructured: true });
          });
        }
        break;
      }
      case 'AssignmentExpression': {
        const l = node.left;
        const lc0 = chainOf(l, al); const rf = unparen(node.right);
        if (lc0 && lc0.length === 3 && lc0[1] === 'ui' && node.operator === '=' && isFn(rf)) S.uiAccepted[lc0[2]] = deriveAll(rf, locals);
        if (l.type === 'MemberExpression' && !l.computed && l.property.type === 'Identifier') {
          if (l.property.name === 'id' && strLit(node.right)) rec(S.ids, node, { id: strLit(node.right), via: '.id=' });
          if (l.property.name === 'className') classTokens(node.right).forEach((t) => rec(S.classes, node, { cls: t, via: 'className' }));
          if (l.object.type === 'MemberExpression' && !l.object.computed && l.object.property.name === 'dataset') rec(S.dataSet, node, { attr: 'data-' + kebab(l.property.name) });
        }
        break;
      }
      case 'Property': {
        const k = keyName(node);
        if (file === '80-office-core.js' && /^(card|panel|table|insights)$/.test(k || '') && isFn(node.value) && par && par.type === 'ObjectExpression') S.uiAccepted['page.' + k] = deriveAll(node.value, locals);
        if (k === 'class' || k === 'className') classTokens(node.value).forEach((t) => rec(S.classes, node, { cls: t, via: 'class:' }));
        if (k && /^data-[a-z]/.test(k)) rec(S.dataSet, node, { attr: k });
        if (k === 'icon' && strLit(node.value) && par && par.type === 'ObjectExpression') rec(S.calls.icons, node, { name: strLit(node.value), via: 'icon:' });
        if (k === 'kpi' && strLit(node.value)) rec(S.calls.kpis, node, { id: strLit(node.value) });
        if (k === 'dataset' && node.value.type === 'ObjectExpression') node.value.properties.forEach((p) => { const dk = keyName(p); if (dk) rec(S.dataSet, p, { attr: 'data-' + kebab(dk) }); });
        if (k === 'id' && strLit(node.value) && par && par.type === 'ObjectExpression') {
          const gp = stack[stack.length - 2];
          if (gp && gp.type === 'CallExpression' && gp.arguments[1] === par) {
            const cn = gp.callee.type === 'Identifier' ? gp.callee.name : gp.callee.type === 'MemberExpression' ? gp.callee.property.name : '';
            if (/^(h|el|svg|create|mk|make|node)$/.test(cn)) rec(S.ids, node, { id: strLit(node.value), via: 'h(...,{id})' });
          }
        }
        break;
      }
      case 'Literal': case 'TemplateLiteral': {
        const text = node.type === 'Literal' ? (typeof node.value === 'string' ? node.value : '') : node.quasis.map((q) => q.value.cooked || '').join('\u0000');
        if (!text) break;
        if (/https?:\/\/(?!www\.w3\.org)/.test(text)) rec(S.lint, node, { kind: 'external-url', text: text.slice(0, 60) });
        if (/[→←↔➜➔▶►]/.test(text)) rec(S.lint, node, { kind: 'arrow-in-copy', text: text.slice(0, 60) });
        if ((text.match(/ · /g) || []).length >= 2) rec(S.lint, node, { kind: 'meta-string', text: text.slice(0, 60) });
        if (/\b(cups?|tbsp|tsp)\b/i.test(text) && !/never|not cups|no cups/i.test(text) && text.length < 200 && /\s/.test(text)) rec(S.lint, node, { kind: 'non-metric', text: text.slice(0, 60) });
        if (text.indexOf('=') >= 0 && (text.indexOf('id=') >= 0 || text.indexOf('class=') >= 0 || text.indexOf('data-') >= 0)) htmlScan(text, node);
        if (text.indexOf('[data-') >= 0) { let m; const re = /\[data-([a-z][\w-]*)/g; while ((m = re.exec(text))) rec(S.dataRead, node, { attr: 'data-' + m[1], via: 'selector' }); }
        break;
      }
      default:
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
      if (file === '60-shell.js') S.shellProps.add(node.property.name);
      // .dataset.foo reads
      if (node.object.type === 'MemberExpression' && !node.object.computed && node.object.property.name === 'dataset') {
        if (!(par && par.type === 'AssignmentExpression' && par.left === node)) rec(S.dataRead, node, { attr: 'data-' + kebab(node.property.name), via: 'dataset' });
      }
      if (isOffice && node.object.type === 'Identifier') {
        if (node.object.name === 'ctx') rec(S.calls.ctxUse, node, { name: node.property.name });
        else if (pageVars.has(node.object.name)) rec(S.calls.pageUse, node, { name: node.property.name, via: node.object.name });
      }
    }
    if (node.type === 'CallExpression') {
      const c = chainOf(node.callee, al);
      const cj = c ? jn(c) : '';
      const a0 = node.arguments[0];
      const callee = unparen(node.callee);
      const propName = callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : callee.type === 'Identifier' ? callee.name : '';
      if (callee.type === 'Identifier' && /^(alert|confirm|prompt|eval)$/.test(callee.name) && !al[callee.name]) rec(S.lint, node, { kind: callee.name === 'eval' ? 'eval' : 'native-dialog', text: callee.name + '(...)' });
      if (callee.type === 'MemberExpression' && !callee.computed && callee.object.name === 'console' && callee.property.name === 'log') rec(S.lint, node, { kind: 'console-log', text: 'console.log' });
      if (isOffice && callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && pageVars.has(callee.object.name) && /^(card|table|panel|insights)$/.test(propName) && node.arguments[0] && node.arguments[0].type === 'ObjectExpression') {
        const a = node.arguments[0]; S.uiCalls.push({ file, line: L(node), fn: 'page.' + propName, i: 0, keys: a.properties.filter((q) => q.type === 'Property').map((q) => ({ k: keyName(q), line: L(q) })).filter((q) => q.k), spread: false });
      }
      if (/^SB\.ui\.\w+$/.test(cj)) node.arguments.forEach((a, i) => { if (a && a.type === 'ObjectExpression') S.uiCalls.push({ file, line: L(node), fn: cj.slice(6), i, keys: a.properties.filter((q) => q.type === 'Property').map((q) => ({ k: keyName(q), line: L(q) })).filter((q) => q.k), spread: a.properties.some((q) => q.type !== 'Property') }); });
      if (cj === 'SB.sheets.register' && strLit(a0)) rec(S.regs.sheets, node, { name: strLit(a0) });
      if (cj === 'SB.office.registerPage' && strLit(a0)) {
        const o = node.arguments[1];
        const val = (k) => { const v = objProp(o, k); return v && v.type === 'Literal' ? v.value : undefined; };
        rec(S.regs.pages, node, { id: strLit(a0), title: val('title'), icon: val('icon'), order: val('order'), inFallback: stack.some((a) => a.type === 'IfStatement' && exits(a.consequent) === true) });
      }
      if ((cj === 'SB.sheets.open' || propName === 'openSheet') && strLit(a0)) rec(S.calls.sheetOpen, node, { name: strLit(a0) });
      if ((propName === 'dispatch' || propName === 'dispatchEx' || dispatchWrappers.has(propName)) && strLit(a0)) rec(S.calls.dispatch, node, { type: strLit(a0), via: propName });
      if (propName === 'navigate' && strLit(a0) && isOffice) rec(S.calls.navigate, node, { id: strLit(a0) });
      if ((cj === 'SB.icons.svg' || cj === 'SB.icons.html' || (callee.type === 'Identifier' && iconWrappers.has(callee.name))) && strLit(a0)) rec(S.calls.icons, node, { name: strLit(a0), via: 'call' });
      if (propName === 'card' && a0 && a0.type === 'ObjectExpression') { const t = objProp(a0, 'type'); if (strLit(t)) rec(S.calls.cards, node, { type: strLit(t) }); }
      if (propName === 'setAttribute' && strLit(a0)) {
        if (strLit(a0) === 'id' && strLit(node.arguments[1])) rec(S.ids, node, { id: strLit(node.arguments[1]), via: 'setAttribute' });
        if (/^data-/.test(strLit(a0))) rec(S.dataSet, node, { attr: strLit(a0) });
        if (strLit(a0) === 'class') classTokens(node.arguments[1]).forEach((t) => rec(S.classes, node, { cls: t, via: 'setAttribute' }));
      }
      if ((propName === 'getAttribute' || propName === 'hasAttribute' || propName === 'removeAttribute') && /^data-/.test(strLit(a0) || '')) rec(S.dataRead, node, { attr: strLit(a0), via: propName });
      if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'MemberExpression' && callee.object.property.name === 'classList' && /^(add|remove|toggle|contains|replace)$/.test(propName)) {
        node.arguments.slice(0, propName === 'replace' ? 2 : 1).forEach((a) => classTokens(a).forEach((t) => rec(S.classes, node, { cls: t, via: 'classList.' + propName })));
      }
      if (cj === 'Object.assign' || (callee.type === 'MemberExpression' && !callee.computed && callee.object.name === 'Object' && propName === 'assign')) {
        const target = chainOf(node.arguments[0], al); const o = node.arguments[1];
        if (target && o && o.type === 'ObjectExpression') o.properties.forEach((p) => { const k = keyName(p); if (k) addDef(jn(target) + '.' + k); });
      }
    }
  });
}

/* ============================================================================================================================
 * Build + browser
 * ========================================================================================================================== */
function runBuild(quiet) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['tools/build.mjs', '--out', DIST_FILE, '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  if (!quiet) console.error('build: ' + (r.status === 0 ? 'ok' : 'FAILED') + ' in ' + (Date.now() - t0) + ' ms');
  return { ok: r.status === 0, stderr: (r.stderr || '') + (r.stdout || '') };
}
/** map "integ.html:LINE:COL" in a message back to src/js/<file>:<line> */
function makeStackMapper() {
  let lines = [];
  try { lines = fs.readFileSync(path.join(ROOT, DIST_FILE), 'utf8').split('\n'); } catch (e) { return (s) => s; }
  const marks = [];
  lines.forEach((l, i) => { const m = /^\/\* ===== (\d\d-[\w-]+\.js) ===== \*\/$/.exec(l); if (m) marks.push({ file: m[1], line: i + 1 }); });
  const map = (Ln) => { let best = null; for (const m of marks) if (m.line < Ln) best = m; else break; return best ? { file: best.file, line: Ln - (best.line + 1) } : null; };
  return (s) => String(s).replace(/integ\.html:(\d+):(\d+)/g, (all, l) => { const r = map(+l); return r ? r.file + ':' + r.line : all; });
}

const PAGE_FNS = {
  resolve: (paths) => {
    const out = {};
    for (const p of paths) {
      const segs = p.split('.'); let cur = window; let ok = true;
      for (let i = 0; i < segs.length; i++) {
        if (cur == null || (typeof cur !== 'object' && typeof cur !== 'function')) { ok = false; break; }
        let v; try { v = cur[segs[i]]; } catch (e) { v = undefined; }
        if (v === undefined) { ok = false; break; }
        cur = v;
      }
      out[p] = ok ? (cur === null ? 'null' : Array.isArray(cur) ? 'array' : typeof cur) : null;
    }
    return out;
  },
  keysOf: (paths) => {
    const out = {};
    for (const p of paths) {
      let cur = window; try { for (const s of p.split('.')) cur = cur[s]; } catch (e) { cur = null; }
      out[p] = cur && (typeof cur === 'object' || typeof cur === 'function') ? Object.getOwnPropertyNames(cur).filter((k) => !/^(length|name|prototype|arguments|caller)$/.test(k)) : null;
    }
    return out;
  },
  dupIds: () => {
    const seen = {}; document.querySelectorAll('[id]').forEach((e) => { (seen[e.id] = seen[e.id] || []).push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '')); });
    return Object.keys(seen).filter((k) => seen[k].length > 1).map((k) => ({ id: k, count: seen[k].length, els: seen[k].slice(0, 3) }));
  },
};

const sleep = (page, ms) => page.waitForTimeout(ms);

export async function runBrowser(S) {
  const { withPage } = await import(pathToFileURL(path.join(ROOT, 'tools/pw.mjs')).href);
  const mapStack = makeStackMapper();
  const R = { boot: {}, errors: [], resolveA: {}, resolveB: {}, smoke: { sheets: [], pages: [], leaks: [], misc: [] }, probe: null, keys: {}, mapStack };
  const refPaths = [...new Set(S.refs.map((r) => r.path))];
  const contractPaths = [];
  CONTRACT.forEach((c) => { for (const k of ['fn', 'obj', 'any']) (c[k] || []).forEach((m) => contractPaths.push(c.base + '.' + m)); });
  const mfns = metricsDocFns();
  mfns.forEach((m) => contractPaths.push('SB.metrics.' + m));
  const allPaths = [...new Set([...refPaths, ...contractPaths, 'SB.booted', 'SB.dev'])];
  R.metricsDocFns = mfns;

  await withPage({ file: path.join(ROOT, DIST_FILE), w: 1280, h: 800, hash: '#/', query: '?demo', reducedMotion: 'reduce' }, async (page, logs) => { // the demo kitchen has dishes; a normal page starts blank
    let ei = 0, pi = 0;
    const take = (tag) => {
      const e = logs.errors.slice(ei).map((m) => ({ phase: tag, kind: 'console', text: mapStack(m) })); ei = logs.errors.length;
      const p = logs.pageErrors.slice(pi).map((m) => ({ phase: tag, kind: 'page', text: mapStack(m) })); pi = logs.pageErrors.length;
      R.errors.push(...e, ...p);
      return e.length + p.length;
    };
    const ev = (fn, arg) => page.evaluate(fn, arg).catch((e) => ({ __err: String(e && e.message || e) }));
    await page.waitForFunction(() => window.SB && (window.SB.booted || document.getElementById('boot-error')), null, { timeout: 25000 }).catch(() => {});
    await sleep(page, 600);
    R.boot = await ev(() => ({
      booted: !!(window.SB && window.SB.booted), bootError: (document.getElementById('boot-error') || {}).textContent || null,
      loadErrors: window.__sbLoadErrors || [], floorMounted: !!(window.SB && SB.floor && SB.floor.isMounted && SB.floor.isMounted()),
      floorPlaceholder: !!document.querySelector('.ph .ph-note'), sheetNames: window.SB && SB.sheets && SB.sheets.names ? SB.sheets.names() : [],
      pages: window.SB && SB.office && SB.office.pages ? SB.office.pages() : null,
      iconNames: window.SB && SB.icons && SB.icons.names ? SB.icons.names() : [], actions: window.SB && SB.engine && SB.engine.ACTIONS ? Object.keys(SB.engine.ACTIONS) : [],
      chartTypes: window.SB && SB.charts ? Object.keys(SB.charts).filter((k) => typeof SB.charts[k] === 'function') : [],
    }));
    if (R.boot && R.boot.__err) R.boot = { booted: false, bootError: 'Could not inspect the page: ' + R.boot.__err, loadErrors: [] };
    take('boot');
    R.resolveA = await ev(PAGE_FNS.resolve, allPaths);
    if (!R.boot.booted) { R.resolveB = R.resolveA; return; }

    /* ---- floor ---- */
    R.smoke.misc.push(await ev(() => {
      const r = { name: 'floor' };
      try {
        const F = SB.floor; if (!F) { r.skipped = 'SB.floor missing'; return r; }
        if (F.setZone) { F.setZone('pit'); F.setZone('all'); }
        r.zone = F.zone && F.zone(); r.sound = F.sound && F.sound();
        if (F.highlight) F.highlight(null);
        r.shortcuts = Array.isArray(F.shortcuts) ? F.shortcuts.length : typeof F.shortcuts;
      } catch (e) { r.err = String(e && e.message || e); }
      return r;
    }));
    await sleep(page, 200);
    take('floor');

    /* ---- sheets ---- */
    for (const name of [...new Set([...SHEET_NAMES, ...(R.boot.sheetNames || [])])]) {
      const r = await ev((n) => {
        const o = { name: n };
        try {
          if (!SB.sheets.has(n)) { o.registered = false; return o; }
          o.registered = true;
          const api = SB.sheets.open(n);
          o.opened = SB.sheets.isOpen(n);
          const dlg = document.querySelectorAll('.sheet[role=dialog],.sheet[role=alertdialog]'); const d = dlg[dlg.length - 1];
          o.dialog = !!d;
          if (d) {
            const lb = d.getAttribute('aria-labelledby'); const t = lb && document.getElementById(lb);
            o.labelled = !!(t && t.textContent.trim());
            o.hasContent = d.textContent.trim().length > 20; o.title = t ? t.textContent.trim().slice(0, 40) : null;
            o.hasTitleHeading = !!d.querySelector('h1,h2,h3');
          }
          o.api = api ? Object.keys(api).slice(0, 12) : null;
        } catch (e) { o.err = String(e && e.message || e); }
        return o;
      }, name);
      if (r.__err) r.name = name;   // a failed inspection keeps its sheet's name, so the report can say which one
      await sleep(page, 300);
      r.focusInside = await ev(() => { const dlg = document.querySelectorAll('.sheet[role=dialog],.sheet[role=alertdialog]'); const d = dlg[dlg.length - 1]; return d ? d.contains(document.activeElement) : null; });
      r.dupIds = await ev(PAGE_FNS.dupIds);
      await ev(() => { try { SB.sheets.closeAll(); } catch (e) { /* ignore */ } });
      await sleep(page, 180);
      r.errorsAfter = take('sheet:' + name);
      R.smoke.sheets.push(r);
    }

    /* ---- office ---- */
    await ev(() => {
      const K = SB.office && SB.office.kit; if (!K || !K.page || K.__probed) return;
      K.__probed = true; const orig = K.page;
      window.__probe = { pages: [], cards: [], ctxKeys: null };
      K.page = function (container, ctx, o) {
        const pg = orig.apply(this, arguments);
        try {
          if (ctx && !window.__probe.ctxKeys) window.__probe.ctxKeys = Object.keys(ctx);
          window.__probe.pages.push({ id: o && o.id, methods: Object.keys(pg) });
          const oc = pg.card;
          if (typeof oc === 'function') pg.card = function (c) { try { window.__probe.cards.push({ page: o && o.id, type: c && c.type, span: c && c.span, title: c && c.title }); } catch (e) { /* ignore */ } return oc.apply(this, arguments); };
        } catch (e) { /* ignore */ }
        return pg;
      };
    });
    await ev(() => { location.hash = '#/office/pace'; });
    const mounted = await page.waitForFunction(() => window.SB && SB.office && SB.office.isMounted && SB.office.isMounted(), null, { timeout: 8000 }).then(() => true, () => false);
    R.smoke.officeMounted = mounted;
    if (mounted) {
      await sleep(page, 900);
      take('office-open');
      const ids = PAGE_TABLE.map((p) => p.id);
      const visit = async (id, wait) => {
        const t1 = Date.now();
        const r = await ev((pid) => {
          const o = { id: pid };
          const t0 = performance.now();
          try { SB.office.navigate(pid); } catch (e) { o.err = String(e && e.message || e); }
          o.renderMs = Math.round(performance.now() - t0);
          return o;
        }, id);
        await sleep(page, wait);
        const info = await ev(() => {
          const errs = [...document.querySelectorAll('.of-error,.error-card')].map((e) => ({ title: ((e.querySelector('h3,h2') || e).textContent || '').trim().slice(0, 80), text: (e.textContent || '').trim().slice(0, 160) }));
          const main = document.querySelector('.office main') || document.querySelector('main') || document.body;
          return {
            cur: SB.office.current(), errs, cards: document.querySelectorAll('.ch-card').length, text: ((main && main.textContent) || '').trim().length,
            counts: SB.office._debug && SB.office._debug.counts ? SB.office._debug.counts() : null,
          };
        });
        if (r.__err || (info && info.__err)) r.inspectErr = r.__err || info.__err;   // reported as a problem, never as a clean page
        Object.assign(r, info && !info.__err ? info : {});
        r.ms = Date.now() - t1; r.errorsAfter = take('page:' + id);
        return r;
      };
      for (const id of ids) {
        const r = await visit(id, 900);
        r.dupIds = await ev(PAGE_FNS.dupIds);
        R.smoke.pages.push(r);
      }
      // leak check: back to pace, take the baseline, then visit each page and come back
      const base = await visit('pace', 400);
      R.smoke.paceBaseline = base.counts;
      for (const id of ids.filter((x) => x !== 'pace')) {
        await visit(id, 350);
        const back = await visit('pace', 350);
        R.smoke.leaks.push({ id, counts: back.counts, inspectErr: back.inspectErr });
      }
      R.probe = await ev(() => window.__probe || null);
      // themes and text size while the office is open (charts must follow, nothing may throw)
      for (const [label, fn] of [['office paper', () => SB.theme.setOffice('paper')], ['office ember', () => SB.theme.setOffice('ember')], ['text large', () => SB.theme.setTextSize('large')], ['text normal', () => SB.theme.setTextSize('normal')]]) {
        const r = await ev(`(() => { try { (${fn.toString()})(); return {}; } catch (e) { return { err: String(e && e.message || e) }; } })()`);
        await sleep(page, 350);
        const e2 = await ev(() => ({ errs: [...document.querySelectorAll('.of-error,.error-card')].length, page: SB.office.current() }));
        R.smoke.misc.push({ name: 'theme:' + label, err: r && r.err, errCards: e2 && e2.errs });
        take('theme:' + label);
      }
      // leave the office
      await ev(() => { const b = document.querySelector('[data-back-to-line]'); if (b) b.click(); else if (SB.shell && SB.shell.extinguish) SB.shell.extinguish(); });
      await sleep(page, 900);
      R.smoke.afterClose = await ev(() => ({ inOffice: SB.shell.inOffice(), mounted: SB.office.isMounted(), counts: SB.office._debug && SB.office._debug.counts ? SB.office._debug.counts() : null, hash: location.hash }));
      take('office-close');
    } else {
      take('office-open');
    }

    /* ---- sim live + sample ---- */
    for (const [label, fn] of [['floor night', () => SB.theme.set('night')], ['floor day', () => SB.theme.set('day')]]) {
      const r = await ev(`(() => { try { (${fn.toString()})(); return {}; } catch (e) { return { err: String(e && e.message || e) }; } })()`);
      await sleep(page, 300);
      R.smoke.misc.push({ name: 'theme:' + label, err: r && r.err });
      take('theme:' + label);
    }
    R.smoke.misc.push(await ev(async () => {
      const r = { name: 'sim.live' };
      try {
        const L = SB.sim && SB.sim.live; if (!L) { r.skipped = 'SB.sim.live missing'; return r; }
        if (L.start) L.start({ rate: 'normal' });
        if (L.crew) L.crew(true);
        if (L.burst) L.burst(2);
        r.status = L.status ? L.status() : null; r.statusType = typeof r.status;
        if (L.onChange) { const off = L.onChange(() => {}); r.onChangeReturns = typeof off; if (typeof off === 'function') off(); }
        await new Promise((res) => setTimeout(res, 500));
        if (L.stop) L.stop();
      } catch (e) { r.err = String(e && e.message || e); }
      return r;
    }));
    await sleep(page, 200);
    take('sim.live');
    R.smoke.misc.push(await ev(() => {
      const r = { name: 'sim.sample' };
      try {
        const s = SB.sim.sample(); r.days = s && s.days && s.days.length; r.tickets = s && s.tickets && s.tickets.length; r.info = !!SB.sim.sampleInfo();
        SB.store.dataset({ sample: true });
        const t = performance.now(); SB.store.dataset({ sample: true }); r.datasetMs = Math.round(performance.now() - t);
      } catch (e) { r.err = String(e && e.message || e); }
      return r;
    }));
    take('sim.sample');
    R.resolveB = await ev(PAGE_FNS.resolve, allPaths);
    // keys of the parent objects of anything still missing (for "did you mean")
    const missing = allPaths.filter((p) => !(R.resolveA[p] || R.resolveB[p]));
    const parents = [...new Set(missing.map((p) => p.split('.').slice(0, -1).join('.')))];
    const best = [];
    for (const p of parents) { let q = p; while (q.includes('.') && !(R.resolveB[q] || R.resolveA[q])) q = q.split('.').slice(0, -1).join('.'); best.push(q); }
    R.keys = await ev(PAGE_FNS.keysOf, [...new Set([...parents, ...best])]);
    take('end');
  });
  return R;
}

/* ============================================================================================================================
 * CSS
 * ========================================================================================================================== */
function scanCss() {
  const classes = new Set(); const attrs = new Set();
  const files = fs.existsSync(SRC_CSS) ? fs.readdirSync(SRC_CSS).filter((f) => f.endsWith('.css') && !f.startsWith('_')).sort() : [];
  const grab = (text) => {
    const t = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/url\([^)]*\)/g, ' ').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ');
    let m; const re = /\.(-?[_a-zA-Z][\w-]*)/g; while ((m = re.exec(t))) classes.add(m[1]);
  };
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SRC_CSS, f), 'utf8');
    grab(raw);
    let m; const re = /\[\s*data-([a-z][\w-]*)/g; const noC = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
    while ((m = re.exec(noC))) attrs.add('data-' + m[1]);
  }
  let tplText = '';
  try { tplText = fs.readFileSync(path.join(ROOT, 'src/index.template.html'), 'utf8'); grab(tplText); let m; const re = /\bclass=["']([^"']*)["']/g; while ((m = re.exec(tplText))) m[1].split(/\s+/).forEach((c) => c && classes.add(c)); } catch (e) { /* none */ }
  const tplAttrs = new Set(); { let m; const re = /\bdata-([a-z][\w-]*)/g; while ((m = re.exec(tplText))) tplAttrs.add('data-' + m[1]); }
  return { classes, attrs, files, tplAttrs };
}

/* ============================================================================================================================
 * Analysis: turn the raw facts into PROBLEMS and NOTES
 * ========================================================================================================================== */
const lev = (a, b) => {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
};
const nearest = (name, list) => {
  const lc = String(name).toLowerCase(); let best = null, bd = 99;
  for (const k of list || []) { const kl = k.toLowerCase(); const d = Math.min(lev(lc, kl), kl.includes(lc) || lc.includes(kl) ? 1 : 99); if (d < bd) { bd = d; best = k; } }
  return best && bd <= Math.max(2, Math.floor(lc.length / 4)) ? best : null;
};

export function analyze(S, R, CSS, extras) {
  const P = []; const N = [];
  const age = (file) => (S.files[file] ? Math.round((Date.now() - S.files[file].mtime) / 60000) : null);
  const problem = (kind, file, line, key, what, fix, more) => P.push(Object.assign({ kind, file, line, key: kind + '|' + file + '|' + key, owner: ownerOf(file), ownerId: ownerId(file), what, fix, ageMin: age(file) }, more || {}));
  const note = (kind, file, line, text) => N.push({ kind, file, line, text, owner: ownerOf(file) });
  const live = !!(R && R.boot && R.boot.booted);

  // --- parse errors
  for (const e of S.parseErrors) problem('syntax', e.file, e.line, e.message, 'Syntax error: ' + e.message + '. The whole inline script fails to parse, so NOTHING runs.', 'Fix the syntax at this line.');

  if (R) {
    const b = R.boot || {};
    if (R.buildFailed) problem('build', 'tools/build.mjs', 0, 'build', 'Build failed: ' + R.buildFailed.slice(0, 200), 'Fix the build error (a file containing "</script"?).');
    for (const e of b.loadErrors || []) problem('load', e.file, 0, String(e.message).slice(0, 60), 'Module failed to load: ' + e.message, 'Fix the exception thrown while the file loads.');
    if (b.bootError) problem('boot', '99-boot.js', 0, 'boot', 'Boot error screen is showing: ' + String(b.bootError).split('\n').slice(0, 3).join(' | ').slice(0, 220), 'See Message/Stage in the boot error; usually a module above failed to load.');
    else if (b.booted === false && !R.buildFailed && !S.parseErrors.length) problem('boot', '99-boot.js', 0, 'notbooted', 'SB.booted is not true after 25 s and no boot error is shown.', 'Check that SB.shell.mount is reached.');
    if (live && !b.floorMounted) note('floor', '70-floor-board.js', 0, 'SB.floor is not mounted (the shell shows its placeholder: ' + (b.floorPlaceholder ? 'yes' : 'no') + ').');
    const seenErr = new Set();
    for (const e of R.errors || []) {
      const m = /(\d\d-[\w-]+\.js):(\d+)/.exec(e.text);
      const file = m ? m[1] : '(unattributed)';
      const first = e.text.split('\n')[0].slice(0, 200);
      const k = e.kind + first;
      if (seenErr.has(k)) continue; seenErr.add(k);
      if (/module .* failed to load/.test(e.text)) continue; // echo of a load error, already reported
      problem(e.kind === 'page' ? 'pageerror' : 'console', file, m ? +m[2] : 0, first.slice(0, 80), (e.kind === 'page' ? 'Uncaught error' : 'console.error') + ' during ' + e.phase + ': ' + first + (m ? '' : ' (no source line in the stack)'), 'Stack: ' + (m ? file + ':' + m[2] : e.text.split('\n').slice(1, 3).join(' ').slice(0, 120)));
    }
  }

  // --- static refs vs runtime
  const exists = (p) => !!(R && ((R.resolveA && R.resolveA[p]) || (R.resolveB && R.resolveB[p])));
  const defsOf = (p) => (S.defs.get(p) ? [...S.defs.get(p)] : []);
  if (live) {
    const grouped = new Map();
    for (const r of S.refs) {
      if (exists(r.path)) continue;
      // A name that starts with an underscore (SB.floor._alerts) is a private slot made on first use, not part of the contract.
      if (r.path.split('.').some((seg, i) => i > 1 && seg.startsWith('_'))) continue;
      // page.lastSection is set by kit.page() as each section is added, so it is absent from the first look at the object.
      if (/\.lastSection$/.test(r.path)) continue;
      const k = r.file + '|' + r.path;
      if (!grouped.has(k)) grouped.set(k, { file: r.file, path: r.path, sites: [] });
      grouped.get(k).sites.push(r);
    }
    for (const g of grouped.values()) {
      const sites = g.sites;
      const bad = sites.filter((s) => !s.guard);
      const first = bad[0] || sites[0];
      const segs = g.path.split('.');
      let k = segs.length; while (k > 1 && !exists(segs.slice(0, k).join('.'))) k--;
      const parent = segs.slice(0, k).join('.');
      const missingSeg = segs[k] || segs[segs.length - 1];
      const keys = (R.keys && R.keys[parent]) || [];
      const sug = nearest(missingSeg, keys);
      const prov = providerFile(g.path);
      const definers = defsOf(g.path);
      const where = definers.length ? 'assigned in ' + definers.join(', ') + ' but not present at run time' : 'defined nowhere in src/js';
      const what = g.path + ' (' + [...new Set(sites.map((s) => s.usage))].join('/') + ') does not exist at run time; ' + where + '; ' + sites.length + ' site' + (sites.length > 1 ? 's' : '') + (bad.length ? ', ' + bad.length + ' unguarded' : ', all guarded');
      if (bad.length) {
        problem('missing-api', g.file, first.line, g.path, what, sug ? 'Did you mean ' + parent + '.' + sug + '? Otherwise ' + prov + ' (' + ownerOf(prov) + ') must add it, or guard the use.' : prov + ' (' + ownerOf(prov) + ') must add ' + g.path + ', or ' + g.file + ' must guard/rename it.', { provider: prov, providerAgeMin: age(prov), sites: bad.slice(0, 4).map((s) => s.file + ':' + s.line) });
      } else {
        note('guarded-missing', g.file, first.line, what + ' [' + [...new Set(sites.map((s) => s.guard))].join(',') + ']');
      }
    }
    // used at load time, but only created by a later file
    const seenLO = new Set();
    for (const r of S.refs) {
      if (!r.loadTime || r.guard || r.usage === 'assign') continue;
      const ns = r.path.split('.').slice(0, 2).join('.');
      const definers = [...(S.nsDefiner.get(ns) || [])];
      if (!definers.length || !definers.every((f) => f > r.file)) continue;
      const k = r.file + ns; if (seenLO.has(k)) continue; seenLO.add(k);
      problem('load-order', r.file, r.line, ns, r.path + ' is used while ' + r.file + ' loads, but ' + ns + ' is only created by ' + definers.join(', ') + ' (a later file).', 'Move the use into a function that runs after boot, or guard it.');
    }
  }

  // --- options passed to SB.ui.* that the function never reads (silently ignored)
  for (const c of S.uiCalls) {
    const acc = S.uiAccepted[c.fn] && S.uiAccepted[c.fn][c.i];
    if (!acc || acc.pass || acc.keys.size === 0) continue;
    for (const kk of c.keys) {
      if (acc.keys.has(kk.k) || S.shellProps.has(kk.k)) continue;
      const near = nearest(kk.k, [...acc.keys]);
      if (near) problem('ui-option', c.file, kk.line, c.fn + '.' + kk.k, (c.fn.startsWith('page.') ? 'kit ' : 'SB.ui.') + c.fn + ' is given the option "' + kk.k + '" but only reads: ' + [...acc.keys].join(', ') + '. It is silently ignored.', 'Rename it to "' + near + '".');
      else note('ui-option-unknown', c.file, kk.line, (c.fn.startsWith('page.') ? 'kit ' : 'SB.ui.') + c.fn + ' is given "' + kk.k + '", which the function never reads (reads: ' + [...acc.keys].join(', ') + ').');
    }
  }

  // --- registrations and cross-file names
  const bySheet = {}; S.regs.sheets.forEach((r) => { (bySheet[r.name] = bySheet[r.name] || []).push(r); });
  for (const [name, regs] of Object.entries(bySheet)) {
    const filesN = [...new Set(regs.map((r) => r.file))];
    if (filesN.length > 1) problem('dup-sheet', regs[1].file, regs[1].line, name, 'Sheet "' + name + '" is registered by ' + filesN.join(' and ') + '; the second registration silently replaces the first.', 'Only one file registers each sheet name.');
    else if (regs.length > 1) note('dup-sheet', regs[1].file, regs[1].line, 'Sheet "' + name + '" is registered twice inside ' + regs[0].file + ' (lines ' + regs.map((r) => r.line).join(', ') + ').');
  }
  for (const n of SHEET_NAMES) if (!bySheet[n]) note('not-landed-yet', '71/72', 0, 'Sheet "' + n + '" is not registered by any file in src/js yet.');
  const byPage = {}; S.regs.pages.forEach((r) => { (byPage[r.id] = byPage[r.id] || []).push(r); });
  for (const [id, regs] of Object.entries(byPage)) {
    const filesN = [...new Set(regs.map((r) => r.file))];
    const def = PAGE_TABLE.find((p) => p.id === id);
    if (!def) { problem('page-id', regs[0].file, regs[0].line, id, 'Page id "' + id + '" is not one of pace tickets stations money safety stock data.', 'Use the ids in docs/office-contract.md section 1.'); continue; }
    if (filesN.length > 1) problem('dup-page', regs[1].file, regs[1].line, id, 'Page "' + id + '" is registered by ' + filesN.join(' and ') + '.', 'Only the owner registers a page.');
    for (const r of regs) {
      if (r.inFallback) continue;
      const diff = [];
      if (r.title !== undefined && r.title !== def.title) diff.push('title "' + r.title + '" (contract "' + def.title + '")');
      if (r.icon !== undefined && r.icon !== def.icon) diff.push('icon "' + r.icon + '" (contract "' + def.icon + '")');
      if (r.order !== undefined && r.order !== def.order) diff.push('order ' + r.order + ' (contract ' + def.order + ')');
      if (diff.length) problem('page-contract', r.file, r.line, id + ':' + diff.join(), 'registerPage("' + id + '") differs from docs/office-contract.md: ' + diff.join('; '), 'Use the title, icon and order from the contract table.');
    }
  }
  for (const p of PAGE_TABLE) if (!byPage[p.id]) note('not-landed-yet', PAGE_FILE[p.id], 0, 'Page "' + p.id + '" is not registered by any file in src/js yet.');

  // --- literal arguments checked against the live registries
  if (live) {
    const sheetSet = new Set([...(R.boot.sheetNames || []), ...SHEET_NAMES]);
    for (const c of S.calls.sheetOpen) if (!sheetSet.has(c.name)) problem('sheet-name', c.file, c.line, c.name, 'SB.sheets.open("' + c.name + '"): no such sheet (' + SHEET_NAMES.join(', ') + '). The user would see "not part of this build yet".', 'Use a registered sheet name' + (nearest(c.name, [...sheetSet]) ? ' (did you mean "' + nearest(c.name, [...sheetSet]) + '"?)' : '') + '.');
    for (const n of SHEET_NAMES) if (!(R.boot.sheetNames || []).includes(n) && bySheet[n]) note('sheet-notloaded', bySheet[n][0].file, bySheet[n][0].line, 'Sheet "' + n + '" is registered in source but not at run time.');
    const acts = new Set(R.boot.actions || []);
    if (acts.size) for (const c of S.calls.dispatch) if (!acts.has(c.type)) problem('action-name', c.file, c.line, c.type, c.via + '("' + c.type + '"): not an engine action (SB.engine.ACTIONS). The engine would refuse it.', 'Use one of SB.engine.ACTIONS' + (nearest(c.type, [...acts]) ? ' (did you mean "' + nearest(c.type, [...acts]) + '"?)' : '') + '.');
    const icons = new Set(R.boot.iconNames || []);
    if (icons.size) {
      const seenI = new Set();
      for (const c of S.calls.icons) {
        if (icons.has(c.name)) continue; const k = c.file + c.name; if (seenI.has(k)) continue; seenI.add(k);
        problem('icon-name', c.file, c.line, c.name, 'Icon "' + c.name + '" (' + c.via + ') does not exist; the page draws a dashed empty square.', 'Use a name from SB.icons.names()' + (nearest(c.name, [...icons]) ? ' (did you mean "' + nearest(c.name, [...icons]) + '"?)' : '') + ' or ask the shell owner for the icon.');
      }
    }
    const charts = new Set(R.boot.chartTypes || []);
    for (const c of S.calls.cards) if (charts.size && !charts.has(c.type)) problem('chart-type', c.file, c.line, c.type, 'kit.card type "' + c.type + '" is not an SB.charts function (' + [...charts].join(' ') + '); the card shows an error.', 'Use one of the chart types' + (nearest(c.type, [...charts]) ? ' (did you mean "' + nearest(c.type, [...charts]) + '"?)' : '') + '.');
    const kpis = new Set(kpiIdsFromDocs());
    if (kpis.size) for (const c of S.calls.kpis) if (!kpis.has(c.id)) note('kpi-id', c.file, c.line, 'tiles kpi "' + c.id + '" is not one of the SB.metrics.compare kpis (' + [...kpis].join(' ') + '); fine only if a value() is supplied.');
    const pids = PAGE_TABLE.map((p) => p.id);
    for (const c of S.calls.navigate) if (!pids.includes(c.id)) problem('nav-id', c.file, c.line, c.id, 'navigate("' + c.id + '"): not a page id; the office falls back to Pace without saying so.', 'Use one of ' + pids.join(' ') + '.');
    if (R.probe) {
      const ctxKeys = new Set(R.probe.ctxKeys || CTX_KEYS);
      const seenC = new Set();
      for (const c of S.calls.ctxUse) {
        if (ctxKeys.has(c.name) || seenC.has(c.file + c.name)) continue; seenC.add(c.file + c.name);
        problem('ctx-member', c.file, c.line, c.name, 'ctx.' + c.name + ' does not exist on the page context (' + [...ctxKeys].join(' ') + ').', 'Use a documented ctx member (docs/office-contract.md section 2)' + (nearest(c.name, [...ctxKeys]) ? '; did you mean ctx.' + nearest(c.name, [...ctxKeys]) + '?' : '') + '.');
      }
      const pm = new Set((R.probe.pages[0] && R.probe.pages[0].methods) || PAGE_METHODS);
      const seenP = new Set();
      for (const c of S.calls.pageUse) {
        if (pm.has(c.name) || c.name === 'lastSection' || seenP.has(c.file + c.name)) continue; // lastSection is set as each section is added seenP.add(c.file + c.name);
        problem('page-member', c.file, c.line, c.name, c.via + '.' + c.name + ' does not exist on the object kit.page() returns (' + [...pm].join(' ') + ').', 'Use a documented page method' + (nearest(c.name, [...pm]) ? '; did you mean ' + nearest(c.name, [...pm]) + '?' : '') + '.');
      }
    }
  }

  // --- contract list
  if (live) {
    const miss = [];
    for (const c of CONTRACT) {
      for (const kind of ['fn', 'obj', 'any']) for (const m of c[kind] || []) {
        const p = c.base + '.' + m; const t = (R.resolveA && R.resolveA[p]) || (R.resolveB && R.resolveB[p]);
        const okType = kind === 'fn' ? t === 'function' : kind === 'obj' ? (t === 'object' || t === 'function' || t === 'array') : !!t;
        if (!okType) miss.push({ path: p, got: t || 'missing', src: c.src });
      }
    }
    for (const m of R.metricsDocFns || []) { const p = 'SB.metrics.' + m; const t = (R.resolveA && R.resolveA[p]) || (R.resolveB && R.resolveB[p]); if (t !== 'function') miss.push({ path: p, got: t || 'missing', src: 'docs/metrics.md' }); }
    const byProv = new Map();
    miss.forEach((x) => { const f = providerFile(x.path); if (!byProv.has(f)) byProv.set(f, []); byProv.get(f).push(x); });
    for (const [f, list] of byProv) {
      problem('contract', f, 0, list.map((x) => x.path).join(',').slice(0, 120), 'Documented API missing or wrong type (' + list.length + '): ' + list.map((x) => x.path.replace(/^SB\./, '') + (x.got === 'missing' ? '' : ' is ' + x.got)).join(', ') + ' [' + [...new Set(list.map((x) => x.src))].join('; ') + ']', 'Add them in ' + f + ' (' + ownerOf(f) + ') or correct the spec.');
    }
    const have = new Set(R.boot.iconNames || []);
    const missIcons = REQUIRED_ICONS.filter((n) => !have.has(n));
    if (missIcons.length) problem('contract', '05-icons.js', 0, 'icons:' + missIcons.join(','), 'SPEC 19 required icons missing: ' + missIcons.join(', '), 'Add the icons.');
    if (have.size && have.size < 70) problem('contract', '05-icons.js', 0, 'icons-count', 'SPEC 19 asks for >= 70 icons; found ' + have.size, 'Add icons.');
    if (R.boot.pages) for (const p of R.boot.pages) if (!p.ready) note('not-landed-yet', PAGE_FILE[p.id], 0, 'Office page "' + p.id + '" is not registered at run time (the frame shows its placeholder).');
    if (R.probe && R.probe.pages && R.probe.pages.length) {
      const allMiss = new Set();
      R.probe.pages.forEach((pg) => PAGE_METHODS.filter((m) => !pg.methods.includes(m)).forEach((m) => allMiss.add(m)));
      if (allMiss.size) problem('contract', '80-office-core.js', 0, 'kit.page-methods:' + [...allMiss].join(','), 'kit.page() result is missing: ' + [...allMiss].join(', ') + ' (office-contract section 3)', 'Add the methods.');
      const miss3 = CTX_KEYS.filter((k) => !(R.probe.ctxKeys || []).includes(k));
      if (R.probe.ctxKeys && miss3.length) problem('contract', '80-office-core.js', 0, 'ctx:' + miss3.join(','), 'The page ctx is missing: ' + miss3.join(', ') + ' (office-contract section 2)', 'Add them to ctx.');
    }
  }

  // --- smoke results
  if (live && R.smoke) {
    for (const s of R.smoke.sheets) {
      const f = s.name === 'order' ? '71-floor-order.js' : '72-floor-sheets.js';
      if (s.registered === false) continue;
      if (s.name === 'wizard') continue; // an old name kept for older links: it opens the dishes setup, not a plain dialog
      // WATCH OUT: an inspection that failed proves nothing, so it is a problem; skipping it would count the sheet as fine.
      if (s.__err) { problem('smoke-inspect', f, 0, s.name + ':inspect', 'Could not inspect sheet "' + s.name + '": ' + s.__err, 'Run the check again; if it repeats, open the sheet by hand and read the console.'); continue; }
      if (s.err) problem('sheet-open', f, 0, s.name + ':err', 'SB.sheets.open("' + s.name + '") threw: ' + s.err, 'Fix the exception in the sheet function.');
      else {
        if (s.opened === false || s.dialog === false) problem('sheet-open', f, 0, s.name + ':notopen', 'SB.sheets.open("' + s.name + '") did not produce a dialog (opened=' + s.opened + ', dialog=' + s.dialog + ').', 'The sheet function must call SB.ui.sheet and return its handle.');
        else {
          if (s.labelled === false) note('sheet-a11y', f, 0, 'Sheet "' + s.name + '": the dialog has no readable aria-labelledby title (pass a title to SB.ui.sheet).');
          if (s.hasContent === false) note('sheet-empty', f, 0, 'Sheet "' + s.name + '" opens nearly empty (' + (s.hasTitleHeading ? 'has a heading' : 'no heading') + ').');
          if (s.focusInside === false) note('sheet-focus', f, 0, 'Sheet "' + s.name + '": focus is not inside the dialog after opening.');
        }
        if (Array.isArray(s.dupIds) && s.dupIds.length) note('dup-id-runtime', f, 0, 'Sheet "' + s.name + '" open: duplicate ids in the document: ' + s.dupIds.slice(0, 4).map((d) => d.id + ' x' + d.count).join(', '));
      }
    }
    if (R.smoke.officeMounted === false) problem('office-mount', '80-office-core.js', 0, 'nomount', 'Navigating to #/office/pace did not mount the office within 8 s.', 'Check SB.office.mount and the shell ignition (PIN prompt? placeholder?).');
    for (const pg of R.smoke.pages) {
      const f = PAGE_FILE[pg.id];
      if (pg.inspectErr) problem('smoke-inspect', f, 0, pg.id + ':inspect', 'Could not inspect office page "' + pg.id + '": ' + pg.inspectErr, 'Run the check again; if it repeats, open #/office/' + pg.id + ' and read the console.');
      if (pg.err) problem('office-page', f, 0, pg.id + ':err', 'Navigating to office page "' + pg.id + '" threw: ' + pg.err, 'Fix the exception.');
      if (pg.errs && pg.errs.length) problem('office-page', f, 0, pg.id + ':errorcard:' + pg.errs[0].title, 'Office page "' + pg.id + '" shows ' + pg.errs.length + ' error card' + (pg.errs.length > 1 ? 's' : '') + ': ' + pg.errs.slice(0, 3).map((e) => '"' + e.title + '"').join(', '), 'Open #/office/' + pg.id + ' and read the console error / the card\'s Technical details.');
      if (pg.cur && pg.cur !== pg.id) problem('office-page', f, 0, pg.id + ':landed:' + pg.cur, 'SB.office.navigate("' + pg.id + '") left the office on "' + pg.cur + '".', 'Check that the page is registered and that navigate does not fall back to another page.');
      if (pg.renderMs > 600) note('slow-page', f, 0, 'Office page "' + pg.id + '" took ' + pg.renderMs + ' ms to render synchronously on navigate (the contract wants metric calls < 150 ms and charts < 100 ms each; the machine is shared, so measure again on a quiet one).');
      if (pg.ms > 2500) note('slow-page', f, 0, 'Office page "' + pg.id + '" took ' + pg.ms + ' ms to navigate and settle (includes a ' + 900 + ' ms wait; the machine is shared).');
      if (pg.cards === 0 && pg.text < 200) note('empty-page', f, 0, 'Office page "' + pg.id + '" shows almost nothing yet (' + pg.cards + ' chart cards, ' + pg.text + ' characters).');
      if (Array.isArray(pg.dupIds) && pg.dupIds.length) note('dup-id-runtime', f, 0, 'Office page "' + pg.id + '": duplicate ids in the document: ' + pg.dupIds.slice(0, 4).map((d) => d.id + ' x' + d.count).join(', '));
    }
    const base = R.smoke.paceBaseline;
    if (base) for (const l of R.smoke.leaks) {
      if (l.inspectErr) { problem('smoke-inspect', PAGE_FILE[l.id], 0, l.id + ':leak-inspect', 'Could not read the counts after leaving office page "' + l.id + '", so its leak check did not run: ' + l.inspectErr, 'Run the check again.'); continue; }
      if (!l.counts) continue;
      const grow = Object.keys(base).filter((k) => typeof base[k] === 'number' && l.counts[k] > base[k]);
      const f = PAGE_FILE[l.id];
      const hard = grow.filter((k) => k !== 'timeouts');
      if (hard.length) problem('leak', f, 0, l.id + ':' + hard.join(','), 'Visiting office page "' + l.id + '" and leaving it leaves more behind than before: ' + hard.map((k) => k + ' ' + base[k] + ' -> ' + l.counts[k]).join(', ') + ' (SB.office._debug.counts).', 'Release the page\'s timers, subscriptions, charts and listeners in destroy() (use the kit helpers so the frame tracks them).');
      else if (grow.length) note('leak', f, 0, 'Office page "' + l.id + '": ' + grow.map((k) => k + ' ' + base[k] + ' -> ' + l.counts[k]).join(', ') + ' after leaving it (probably a pending timeout).');
    }
    const a = R.smoke.afterClose;
    if (a && a.__err) problem('smoke-inspect', '60-shell.js', 0, 'afterclose:inspect', 'Could not inspect the page after leaving the office, so the unmount and leak checks did not run: ' + a.__err, 'Run the check again.');
    if (a && !a.__err) {
      if (a.mounted) problem('leak', '60-shell.js', 0, 'unmount', 'After "Back to the line" the office is still mounted (SB.office.isMounted() is true).', 'The shell must call SB.office.unmount() after the close animation.');
      else if (a.counts) {
        const left = Object.keys(a.counts).filter((k) => typeof a.counts[k] === 'number' && a.counts[k] > 0 && k !== 'mounted');
        if (left.length) problem('leak', '80-office-core.js', 0, 'afterclose:' + left.join(','), 'After leaving the office, SB.office._debug.counts still shows ' + left.map((k) => k + '=' + a.counts[k]).join(', ') + '.', 'unmount() must release every timer, subscription, listener and chart (some page does not release them in destroy()).');
      }
    }
    for (const m of R.smoke.misc) {
      if (!m) continue;
      if (m.__err) { problem('smoke-inspect', '45-sim.js', 0, 'misc:inspect:' + String(m.__err).slice(0, 40), 'A smoke step could not be inspected: ' + m.__err, 'Run the check again; the console output names the step.'); continue; }
      if (/^theme:/.test(m.name)) {
        if (m.err) problem('smoke', '60-shell.js', 0, m.name + ':err', m.name + ' threw: ' + m.err, 'Fix the exception in the theme change path.');
        if (m.errCards) problem('office-page', '80-office-core.js', 0, m.name + ':errcards', 'After "' + m.name + '" the office shows ' + m.errCards + ' error card(s).', 'Check SB.charts.refreshTheme and the pages\' theme handling.');
        continue;
      }
      const f = m.name === 'floor' ? '70-floor-board.js' : '45-sim.js';
      if (m.err) problem('smoke', f, 0, m.name + ':err', m.name + ' threw during the smoke run: ' + m.err, 'Fix the exception.');
      else if (m.skipped) problem('smoke', f, 0, m.name + ':skipped', m.name + ' could not be exercised: ' + m.skipped + '.', 'The module the contract names is missing; restore it.');
      if (m.name === 'sim.live' && !m.skipped && !m.err && m.statusType !== 'object') note('smoke', f, 0, 'sim.live.status() returned ' + m.statusType + ', expected an object.');
      if (m.name === 'sim.sample' && !m.err) {
        if (m.days !== 14) problem('contract', f, 0, 'sample-days:' + m.days, 'SB.sim.sample() has ' + m.days + ' days (SPEC 11: 14).', 'Make the sample cover 14 days, or change SPEC 11 on purpose.');
        if (m.datasetMs > 400) note('slow', f, 0, 'store.dataset({sample:true}) took ' + m.datasetMs + ' ms on the second call (should be memoised).');
      }
    }
  }

  // --- unit suite
  if (extras && extras.unit) {
    const u = extras.unit;
    // Only tests named "performance: ..." or "timing: ..." count as timing tests. A looser match on words like "within 60 s" or "throughput"
    // hid real failures (for example "syncLatency ... inside 60 s" checks numbers, not speed).
    const perf = (n) => /^(performance|timing):/i.test(n);
    const hard = u.ran ? (u.failing || []).filter((n) => !perf(n)) : [];
    if (u.ran && u.fail && !hard.length && u.failing.length) note('unit-perf', 'test/', 0, 'Only timing tests failed (the machine is shared, so this is probably load, not a bug): ' + u.failing.slice(0, 4).join(' ; ') + '. Full output: test/.out/contract/unit.txt');
    else if (u.ran && u.fail) problem('unit', 'test/', 0, 'unit:' + u.failing.slice(0, 3).join('|').slice(0, 100), 'node tools/test.mjs: ' + u.pass + ' passed, ' + u.fail + ' failed. First failures: ' + u.failing.slice(0, 4).join(' ; '), 'Run node tools/test.mjs <pattern> to see the diff; the test file name tells the owner.');
    else if (!u.ran) note('unit', 'test/', 0, u.reason);
  }

  // --- heuristics (notes only)
  const idSites = {};
  S.ids.forEach((x) => { (idSites[x.id] = idSites[x.id] || []).push(x); });
  for (const [id, xs] of Object.entries(idSites)) {
    const uniq = new Map(); xs.forEach((x) => uniq.set(x.file + ':' + x.line, x));
    const sites = [...uniq.values()]; if (sites.length < 2) continue;
    const filesN = [...new Set(sites.map((x) => x.file))];
    note(filesN.length > 1 ? 'dup-id-cross-file' : 'dup-id', sites[1].file, sites[1].line, 'id "' + id + '" is created at ' + sites.slice(0, 4).map((x) => x.file + ':' + x.line).join(', ') + (filesN.length > 1 ? ' (several files)' : ' (same file; fine if only one is on screen at once)'));
  }
  { // copy and hard-rule lint (notes)
    const g = new Map();
    for (const x of S.lint) { const k = x.kind + '|' + x.file; if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    for (const [k, xs] of g) note('lint-' + xs[0].kind, xs[0].file, xs[0].line, xs.length + 'x ' + xs.slice(0, 4).map((x) => x.line + ' "' + x.text.replace(/\s+/g, ' ') + '"').join('; '));
  }
  if (CSS) {
    const missCls = new Map();
    for (const c of S.classes) { if (CSS.classes.has(c.cls)) continue; const k = c.file + '|' + c.cls; if (!missCls.has(k)) missCls.set(k, c); }
    const byFile = new Map();
    for (const c of missCls.values()) { if (!byFile.has(c.file)) byFile.set(c.file, []); byFile.get(c.file).push(c); }
    for (const [file, list] of byFile) note('class-no-css', file, list[0].line, list.length + ' class name' + (list.length > 1 ? 's' : '') + ' used in JS but defined in no CSS file: ' + list.slice(0, 14).map((c) => c.cls + ':' + c.line).join(', ') + (list.length > 14 ? ' ... +' + (list.length - 14) : ''));
    const setAttrs = new Set(S.dataSet.map((d) => d.attr)); CSS.tplAttrs.forEach((a) => setAttrs.add(a));
    const reads = new Map();
    S.dataRead.forEach((d) => { if (!setAttrs.has(d.attr)) { const k = d.file + '|' + d.attr; if (!reads.has(k)) reads.set(k, d); } });
    CSS.attrs.forEach((a) => { if (!setAttrs.has(a)) reads.set('css|' + a, { file: 'css', attr: a, line: 0, via: 'CSS selector' }); });
    const rf = new Map();
    for (const d of reads.values()) { if (!rf.has(d.file)) rf.set(d.file, []); rf.get(d.file).push(d); }
    for (const [file, list] of rf) note('data-hook', file, list[0].line, list.length + ' data-* hook' + (list.length > 1 ? 's' : '') + ' read here but set by no file: ' + list.slice(0, 10).map((d) => d.attr + (d.line ? ':' + d.line : '') + ' (' + d.via + ')').join(', '));
  }
  return { problems: P, notes: N };
}

/* ============================================================================================================================
 * Unit suite
 * ========================================================================================================================== */
function runUnit(force, noUnit) {
  const stamp = path.join(OUT_DIR, 'unit.stamp');
  let last = 0; try { last = +fs.readFileSync(stamp, 'utf8') || 0; } catch (e) { /* none */ }
  const due = Date.now() - last > 25 * 60000;
  if (noUnit) return { ran: false, reason: 'Unit suite skipped (--no-unit).' };
  if (!force && !due) return { ran: false, reason: 'Unit suite not due (last run ' + Math.round((Date.now() - last) / 60000) + ' min ago; it runs every 25 min, or use --unit).' };
  const r = spawnSync(process.execPath, ['tools/test.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // WATCH OUT: a run that could not start or was cut off (no exit status) is a failure, and only a clean pass is remembered for 25 min;
  // otherwise a broken run would be cached as "done" and the next runs would say "not due" instead of showing it.
  if (r.error || r.status === null) return { ran: true, pass: 0, fail: 1, failing: ['the unit suite did not finish (' + (r.error ? r.error.message : 'stopped by ' + r.signal) + ')'], status: r.status };
  if (r.status === 0) fs.writeFileSync(stamp, String(Date.now()));
  const out = (r.stdout || '') + (r.stderr || '');
  const num = (re) => { const m = re.exec(out); return m ? +m[1] : 0; };
  try { fs.writeFileSync(path.join(OUT_DIR, 'unit.txt'), out); } catch (e) { /* ignore */ }
  const failing = []; out.split('\n').forEach((l) => { const m = /^\s*✖\s+(.*?)(?:\s+\(\d+(?:\.\d+)?ms\))?$/.exec(l); if (m && !/:$/.test(m[1].trim())) failing.push(m[1].trim()); });
  const fail = num(/(?:# fail|ℹ fail) (\d+)/);
  return { ran: true, pass: num(/(?:# pass|ℹ pass) (\d+)/), fail: fail || (r.status ? 1 : 0), failing: [...new Set(failing)], status: r.status };
}

/* ============================================================================================================================
 * Reporting
 * ========================================================================================================================== */
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const where = (x) => x.file + (x.line ? ':' + x.line : '');

function streaks(problems, carryKinds) {
  const f = path.join(OUT_DIR, 'state.json');
  let st = { run: 0, p: {} };
  try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* first run */ }
  const prev = st.p || {}; const run = (st.run || 0) + 1; const next = {};
  const carry = (k) => (carryKinds || []).some((c) => k.startsWith(c + '|'));
  for (const k of Object.keys(prev)) if (carry(k) && prev[k].last === st.run && !problems.some((p) => p.key === k)) next[k] = Object.assign({}, prev[k], { last: run });
  const fixed = Object.keys(prev).filter((k) => prev[k].last === st.run && !carry(k) && !problems.some((p) => p.key === k)).map((k) => ({ key: k, what: prev[k].what, file: prev[k].file }));
  const isNew = [];
  for (const p of problems) {
    const was = prev[p.key];
    const cont = was && was.last === st.run;
    p.runs = cont ? was.runs + 1 : 1;
    if (p.runs === 1) isNew.push(p);
    p.messaged = !!(cont && was.messaged);
    next[p.key] = { runs: p.runs, last: run, what: p.what.slice(0, 120), file: p.file, messaged: p.messaged };
  }
  return { run, fixed, isNew, save: () => { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ run, p: next }, null, 1)); } };
}

function printReport(A, meta, sk) {
  const out = [];
  out.push('SMOKEBOX CONTRACT CHECK  ' + new Date().toString().replace(/ GMT.*/, '') + '  (run ' + sk.run + ', ' + meta.seconds + ' s)');
  out.push(meta.summary);
  out.push('');
  out.push('PROBLEMS (' + A.problems.length + ')');
  if (A.problems.length) {
    out.push('| # | kind | where | owner | what | suggested fix | seen |');
    out.push('|---|---|---|---|---|---|---|');
    A.problems.forEach((p, i) => out.push('| ' + (i + 1) + ' | ' + p.kind + ' | ' + esc(where(p)) + (p.ageMin != null ? ' (file edited ' + p.ageMin + ' min ago)' : '') + ' | ' + p.owner + ' | ' + esc(p.what) + ' | ' + esc(p.fix) + ' | ' + p.runs + 'x' + (p.messaged ? ', owner told' : '') + ' |'));
  } else out.push('none');
  out.push('');
  out.push('NOTES (' + A.notes.length + ')');
  const grouped = {};
  A.notes.forEach((n) => { (grouped[n.kind] = grouped[n.kind] || []).push(n); });
  for (const [kind, list] of Object.entries(grouped)) {
    const lim = meta.verbose ? 999 : 5;
    out.push('- ' + kind + ' (' + list.length + ')');
    list.slice(0, lim).forEach((n) => out.push('    ' + where(n) + '  ' + n.text));
    if (list.length > lim) out.push('    ... ' + (list.length - lim) + ' more (use --verbose)');
  }
  if (sk.fixed.length) { out.push(''); out.push('FIXED since last run (' + sk.fixed.length + ')'); sk.fixed.forEach((f) => out.push('- ' + f.file + ': ' + f.what)); }
  return out.join('\n');
}

function logEntry(A, meta, sk) {
  const L = [];
  L.push('## ' + new Date().toString().replace(/ GMT.*/, '') + ' (run ' + sk.run + ')');
  L.push('');
  L.push(meta.summary);
  L.push('');
  L.push('New problems: ' + sk.isNew.length + '. Still open from before: ' + (A.problems.length - sk.isNew.length) + '. Fixed since last run: ' + sk.fixed.length + '.');
  L.push('');
  if (sk.fixed.length) { L.push('Fixed:'); sk.fixed.forEach((f) => L.push('- ' + f.file + ': ' + f.what)); L.push(''); }
  if (A.problems.length) {
    L.push('| # | kind | where | owner | what | suggested fix | seen |');
    L.push('|---|---|---|---|---|---|---|');
    A.problems.forEach((p, i) => L.push('| ' + (i + 1) + ' | ' + p.kind + ' | ' + esc(where(p)) + ' | ' + p.owner + ' | ' + esc(p.what.slice(0, 300)) + ' | ' + esc(p.fix.slice(0, 200)) + ' | ' + p.runs + 'x' + (p.messaged ? ' (owner told)' : '') + ' |'));
  } else L.push('Problems: none.');
  L.push('');
  const g = {}; A.notes.forEach((n) => { g[n.kind] = (g[n.kind] || 0) + 1; });
  L.push('Notes: ' + (Object.keys(g).length ? Object.entries(g).map(([k, v]) => k + ' ' + v).join(', ') : 'none') + '.');
  L.push('');
  return L.join('\n');
}

/* ============================================================================================================================
 * main
 * ========================================================================================================================== */
export async function run(args) {
  const flag = (f) => args.includes(f);
  try { os.setPriority(0, 10); } catch (e) { /* not allowed: fine */ }
  const t0 = Date.now();
  let buildFailed = null;
  if (!flag('--no-build')) { const b = runBuild(flag('--quiet')); if (!b.ok) buildFailed = b.stderr; }
  const S = scanStatic();
  let R = null;
  if (!flag('--static')) {
    if (buildFailed || S.parseErrors.length) R = { boot: { booted: false, loadErrors: [] }, errors: [], resolveA: {}, resolveB: {}, smoke: { sheets: [], pages: [], leaks: [], misc: [] } };
    else {
      try { R = await runBrowser(S); }
      catch (e) { R = { boot: { booted: false, bootError: 'Browser run failed: ' + (e && e.message || e), loadErrors: [] }, errors: [], resolveA: {}, resolveB: {}, smoke: { sheets: [], pages: [], leaks: [], misc: [] } }; }
    }
    if (buildFailed) R.buildFailed = buildFailed;
  }
  const CSS = scanCss();
  const unit = flag('--static') ? { ran: false, reason: 'Unit suite skipped (--static).' } : runUnit(flag('--unit'), flag('--no-unit'));
  const A = analyze(S, R, CSS, { unit });
  const sk = streaks(A.problems, unit.ran ? [] : ['unit']);
  const meta = {
    seconds: Math.round((Date.now() - t0) / 1000), verbose: flag('--verbose'),
    summary: 'Files: ' + Object.keys(S.files).length + ' js, ' + CSS.files.length + ' css. Static refs: ' + S.refs.length + ' (' + new Set(S.refs.map((r) => r.path)).size + ' distinct paths). ' +
      (R && R.boot ? 'Boot: ' + (R.boot.booted ? 'ok' : 'FAILED') + ', load errors ' + ((R.boot.loadErrors || []).length) + ', console/page errors ' + ((R.errors || []).length) + '. ' : 'Browser not run. ') +
      (R && R.smoke && R.boot && R.boot.booted ? 'Smoke: ' + R.smoke.sheets.filter((s) => s.opened).length + '/' + R.smoke.sheets.length + ' sheets opened, ' + R.smoke.pages.filter((p) => !(p.errs && p.errs.length) && p.cur === p.id).length + '/' + R.smoke.pages.length + ' office pages rendered clean. ' : '') +
      'Unit: ' + (unit.ran ? unit.pass + ' passed, ' + unit.fail + ' failed' : 'not run') + '.',
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!flag('--static')) sk.save(); // a static-only run must not make browser problems look fixed
  const text = printReport(A, meta, sk);
  fs.writeFileSync(path.join(OUT_DIR, 'last.txt'), text);
  if (flag('--json')) fs.writeFileSync(path.join(OUT_DIR, 'last.json'), JSON.stringify({ at: new Date().toISOString(), meta, problems: A.problems, notes: A.notes, smoke: R && R.smoke, boot: R && R.boot, probe: R && R.probe }, null, 1));
  console.log(text);
  if (flag('--log')) {
    const logPath = path.join(ROOT, 'docs/integration-log.md');
    const head = fs.existsSync(logPath) ? '' : '# Integration log\n\nWritten by the integration watcher (`node tools/contract-check.mjs --log`). One entry per run, newest last. Problems are definite breakage; notes are informational.\n\n';
    fs.appendFileSync(logPath, head + logEntry(A, meta, sk) + '\n');
  }
  return { A, S, R, sk, meta, exit: A.problems.length ? 1 : 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((r) => { process.exit(r.exit); }, (e) => { console.error('contract-check crashed:', e && e.stack || e); process.exit(2); });
}
