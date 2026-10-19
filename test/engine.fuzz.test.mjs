// Engine fuzz / model test + mutation checks.
// (b) >= 200 seeded random action sequences x 60 steps, valid and junk payloads mixed, virtual clock advancing between steps.
//     After EVERY step: checkInvariants (I1-I6, I8-I11, I14, I15) plus model checks for I7 (refusal of 86'd lines), I8 (draws only
//     from servable batches), I12 (totality: closed-set report, no throw, same reference on non-ok) and I13 (undo restores).
// (d) Mutation checks: for I2, I5, I7, I8 and I13 a copy of 20-engine.js with the fix broken is loaded into a fresh VM context
//     and the same detectors must go red. See docs/findings.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadSB, ROOT } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine']);
const T0 = new Date(2026, 9, 17, 11, 0, 0).getTime();
const SEC = 1000, MIN = 60 * SEC;
const UNDOABLE = new Set(SB.engine.UNDOABLE);

/* ---------------------------------------------------------------- engine loader (real or mutated) ---------------------------------------------------------------- */
const SRC = {
  util: fs.readFileSync(path.join(ROOT, 'src/js/00-util.js'), 'utf8'),
  config: fs.readFileSync(path.join(ROOT, 'src/js/10-config.js'), 'utf8'),
  engine: fs.readFileSync(path.join(ROOT, 'src/js/20-engine.js'), 'utf8'),
};
function loadEngine(mutations = []) {
  let src = SRC.engine;
  for (const [from, to] of mutations) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, 'mutation target must occur exactly once: ' + from);
    src = src.replace(from, () => to);
  }
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC.util, ctx, { filename: '00-util.js' });
  vm.runInContext(SRC.config, ctx, { filename: '10-config.js' });
  vm.runInContext(src, ctx, { filename: '20-engine.mutant.js' });
  return ctx.SB;
}

/* ---------------------------------------------------------------- helpers ---------------------------------------------------------------- */
const JUNK = [undefined, null, NaN, -1, 0, -0, 1e308, Infinity, -Infinity, 2 ** 53, '', ' ', 'x', '__proto__', 'constructor', 'toString', 'hasOwnProperty',
  [], [1, 2], {}, { a: 1 }, true, false, 'a'.repeat(5000), 10n, Symbol('s'), () => 1, JSON.parse('{"__proto__":{"polluted":1}}'), 't_1', 't_1.1', 'b_1', 't_99999'];
/** canonical JSON: object keys sorted, so equal states compare equal whatever the key insertion order */
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => { o[k] = canon(x[k]); return o; }, {}) : x);
function strip(s) {
  const o = canon(JSON.parse(JSON.stringify(s)));
  delete o.events; delete o.eventArchive; delete o.undo; delete o.rev; delete o.syncs;
  delete o.seq.event; delete o.seq.sync; delete o.seq.undo; delete o.seq.plan;
  return o;
}
const servableIndependent = (b) => !!b && b.canServe === true && b.status !== 'discard' && b.kind !== 'cooling' && b.remainingG > 0;

function genAction(rng, s) {
  const pick = (a) => (a && a.length ? a[Math.floor(rng.next() * a.length)] : undefined);
  const junk = () => pick(JUNK);
  const valid = rng.next() < 0.78;
  const active = s.tickets.filter((t) => t.status === 'active');
  const expedited = s.tickets.filter((t) => t.status === 'expedited');
  const t = pick(active.length && rng.next() < 0.85 ? active : s.tickets);
  const it = t ? pick(t.items) : undefined;
  const live = s.batches.filter((b) => b.status !== 'discard');
  const b = pick(live.length && rng.next() < 0.85 ? live : s.batches);
  const menuId = pick(s.menu).id;
  const ing = pick(s.ingredients);
  const orders = s.orders || [];
  const openOrders = orders.filter((o) => o.status === 'open');
  const paidOrders = orders.filter((o) => o.status === 'paid');
  const anyOrder = pick(rng.next() < 0.8 && openOrders.length ? openOrders : orders);
  const tcs = s.ingredients.filter((i) => i.tcs);
  const W = [['createTicket', 16], ['advanceItem', 18], ['completeItem', 5], ['fireNow', 5], ['completeZone', 4], ['bumpTicket', 8], ['startTicket', 6], ['releaseTicket', 5], ['recallTicket', 3],
    ['voidTicket', 3], ['setRush', 3], ['toggle86', 4], ['restock', 3], ['addBatch', 5], ['logTemp', 5], ['reheatBatch', 2], ['startCooling', 1],
    ['discardBatch', 2], ['pullBatch', 3], ['keepServing', 2], ['endKeepServing', 1], ['planBatch', 1.5], ['cancelPlan', 2], ['snoozeAlert', 2], ['clearSnooze', 1.5], ['sanitizeDone', 2], ['updateSettings', 2], ['updateMenuItem', 1], ['addMenuItem', 0.6], ['payOrder', 4], ['reopenOrder', 1], ['voidOrder', 1], ['updateIngredient', 1], ['undo', 7], ['resetLive', 0.2], ['junkType', 2]];
  let r = rng.next() * W.reduce((a, x) => a + x[1], 0);
  let type = W[0][0];
  for (const [k, w] of W) { r -= w; if (r <= 0) { type = k; break; } }
  if (type === 'junkType') return { type: pick(['nope', '__proto__', 'constructor', 'toString', '', 'APPLY', 'undo ']), payload: {} };
  let p;
  switch (type) {
    case 'createTicket': {
      const n = 1 + Math.floor(rng.next() * 4);
      const items = [];
      for (let i = 0; i < n; i++) items.push({ menuId: pick(s.menu).id, qty: rng.next() < 0.8 ? 1 : 1 + Math.floor(rng.next() * 4), mods: rng.next() < 0.2 ? ['No pickles'] : undefined });
      p = { customer: pick(['Table 1', 'Pickup', '', 'Drive 3']), channel: pick(['dine_in', 'takeout', 'drive_thru', 'third_party']), items, rush: rng.next() < 0.1, note: rng.next() < 0.1 ? 'Peanut allergy' : undefined };
      if (rng.next() < 0.4) p.awaitStart = true; // two-tap tickets wait for their Start tap
      if (rng.next() < 0.05) p.createdAt = s.events.length ? undefined : undefined;
      // some orders are added to an existing one, and some are paid at the counter in the same tap
      if (openOrders.length && rng.next() < 0.3) p.orderId = pick(openOrders).id;
      if (rng.next() < 0.15) p.pay = { method: pick(['cash', 'card', 'other', 'gold']), tip: pick([0, 2.5, -1, undefined]), discount: pick([0, 1, 500, undefined]) };
      break;
    }
    case 'advanceItem': case 'completeItem': case 'fireNow': p = { ticketId: t && t.id, itemId: it && it.id }; break;
    case 'completeZone': p = { ticketId: t && t.id, zone: it ? it.zone : 'pit' }; break;
    case 'startTicket': case 'releaseTicket': p = { ticketId: t && t.id }; break;
    case 'bumpTicket': p = { ticketId: t && t.id, force: rng.next() < 0.4 }; break;
    case 'recallTicket': p = { ticketId: (pick(expedited) || t || {}).id }; break;
    case 'voidTicket': p = { ticketId: t && t.id, reason: pick(['wrong order', 'customer left', 'dropped', '']) }; break;
    case 'setRush': p = { ticketId: t && t.id, on: rng.next() < 0.7 }; break;
    case 'toggle86': p = { menuId, on: rng.next() < 0.6 }; break;
    case 'restock': p = { ing: ing.id, g: pick([50, 500, 2000, 8000]) }; break;
    case 'addBatch': {
      const ti = pick(tcs);
      p = rng.next() < 0.5 ? { ing: ti.id, rawG: pick([3000, 6000, 9000]), endpointC: pick([80, 85, 90, undefined]), holdH: pick([0, 1, 2, undefined]), tempF: pick([140, 155, 165, 125, 38, 45]) }
        : { ing: ti.id, cookedG: pick([800, 2000, 5000]), tempF: pick([150, 160, 120, 38, 44]) };
      break;
    }
    case 'logTemp': p = { batchId: b && b.id, tempF: pick([38, 40, 44, 120, 130, 136, 150, 166, 70]) }; break;
    case 'reheatBatch': p = { batchId: b && b.id, tempF: pick([150, 166, 175]) }; break;
    case 'startCooling': p = { batchId: b && b.id, g: rng.next() < 0.5 ? undefined : 500 }; break;
    case 'keepServing': p = { batchIds: s.batches.filter((x) => x.status === 'past' || rng.next() < 0.3).map((x) => x.id).slice(0, 3), forMin: pick([30, 60, undefined, 0, 'x']), who: pick(['AB', '', 'FW']) }; break;
    case 'endKeepServing': p = { batchId: b && b.id, who: pick(['AB', '']), note: 'mis-tap' }; break;
    case 'planBatch': p = { ing: pick(['brisket', 'pork', 'ribs', 'mac', 'tea']), grams: pick([3000, 8000, 0, -5]), offAt: (s.events.length ? s.events[s.events.length - 1].t : T0) + pick([0, 3600e3, 5 * 3600e3, -1e9]) }; break;
    case 'snoozeAlert': p = { batchId: b && b.id, forMin: pick([10, 30, 10, 0, 45, 'x']) }; break;
    case 'clearSnooze': p = { batchId: (Object.keys(s.alertSnoozes || {})[0]) || (b && b.id) }; break;
    case 'cancelPlan': p = { planId: (s.planned && s.planned.length ? pick(s.planned).id : 'pl_0') }; break;
    case 'pullBatch': p = { ing: pick(['brisket', 'pork', 'tea', 'beans']), g: pick([500, 1500, 4500, 0, -3]) }; break;
    case 'discardBatch': p = { batchId: b && b.id, reason: pick(['manual', 'quality', 'temp', 'other', 'bad']) }; break;
    case 'sanitizeDone': p = {}; break;
    case 'updateSettings': p = { patch: pick([{ pacing: { enabled: rng.next() < 0.5 } }, { safety: { tempCheckEveryMin: pick([10, 30, 60]) } }, { safety: { hotHoldF: pick([135, 140, 120]) } },
      { pacing: { learnK: pick([0, 3, 10]), maxFactor: pick([1.5, 2.5]) } }, { undoMs: pick([5000, 10000, 2000]) }, { channels: { takeout: { warnSec: pick([200, 480, 900]) } } }]) }; break;
    case 'updateMenuItem': p = { id: menuId, patch: pick([{ prepSec: pick([30, 120, 400]) }, { price: 9.5 }, { archived: rng.next() < 0.3 }, { bom: [{ ing: 'pork', qty: 120 }] }, { zone: pick(['pit', 'fry', 'expo']) }]) }; break;
    case 'payOrder': p = { orderId: (anyOrder || {}).id, method: pick(['cash', 'card', 'other', 'cash', 'gold']), tip: pick([0, 3, 12.34, undefined, -2]), discount: pick([0, 1, 2.5, undefined, 9999]) }; break;
    case 'reopenOrder': p = { orderId: (pick(rng.next() < 0.8 && paidOrders.length ? paidOrders : orders) || {}).id }; break;
    case 'voidOrder': p = { orderId: (anyOrder || {}).id, reason: pick(['customer left', 'duplicate', '']) }; break;
    case 'addMenuItem': p = { name: 'Dish ' + Math.floor(rng.next() * 40), zone: pick(['pit', 'sides', 'fry', 'cold', 'expo']), cat: pick(['meat', 'side', 'cold', 'other']), price: pick([8, 12.5, 0, -1]), prepSec: pick([60, 240, 900, 4]), track: pick(['one', 'two', 'three']) }; break;
    case 'updateIngredient': p = { id: ing.id, patch: pick([{ thresholdG: pick([0, 100, 900, 5000]) }, { yield: pick([0.5, 0.6]) }, { costPerKg: 12 }]) }; break;
    case 'undo': p = {}; break;
    case 'resetLive': p = { keepSettings: rng.next() < 0.7 }; break;
    default: p = {};
  }
  if (!valid) {
    if (rng.next() < 0.3) p = junk();
    else if (p && typeof p === 'object') {
      const keys = Object.keys(p).concat(['ticketId', 'itemId', 'items', 'g', 'tempF', 'patch']);
      p = Object.assign({}, p, { [pick(keys)]: junk() });
      if (rng.next() < 0.3 && Array.isArray(p.items)) p.items = p.items.concat([{ menuId: junk(), qty: junk() }]);
    }
  }
  return { type, payload: p };
}

/**
 * Runs `seqs` sequences of `steps` steps against engine `X`; returns the first violations found (empty = all good).
 * Every check is independent of the engine's own helpers except checkInvariants (which is itself under test in the mutants).
 */
function runFuzz(X, { seqs = 200, steps = 60, seed = 20261017, stats } = {}) {
  const E = X.engine;
  const out = [];
  for (let q = 0; q < seqs && out.length < 5; q++) {
    const rng = SB.util.rng(seed + q * 7919);
    let now = T0 + q * 3 * 86400e3;
    let s = E.newState({ now, empty: rng.next() < 0.15 });
    if (rng.next() < 0.3) s = E.apply(s, 'updateSettings', { patch: { pacing: { enabled: false } } }, now).state;
    // time-dependent parts of I5/I8 hold at the moment the state was last produced by apply/tick (a refused action returns the
    // original, un-ticked state by I12, so it is checked at its own evaluation time, not at the wall clock)
    let at = now;
    for (let step = 0; step < steps; step++) {
      const where = `seq ${q} step ${step}`;
      const dt = rng.next() < 0.03 ? (20 + rng.next() * 40) * MIN : rng.next() < 0.01 ? 5 * 60 * MIN : [0, 1, 5, 15, 30, 60, 120, 300][Math.floor(rng.next() * 8)] * SEC;
      now += Math.round(dt);
      if (rng.next() < 0.25) {
        const tr = E.tick(s, now);
        s = tr.state; at = now;
        const v = E.checkInvariants(s, at);
        if (v.length) { out.push(`${where} after tick: ${v[0]}`); break; }
      }
      const { type, payload } = genAction(rng, s);
      const pre = s;
      const base = E.tick(pre, now).state; // what the action sees after its catch-up tick
      let res;
      try { res = E.apply(pre, type, payload, now); } catch (err) { out.push(`${where} I12 ${type} threw ${err}`); break; }
      if (stats) stats[type + ':' + res.report] = (stats[type + ':' + res.report] || 0) + 1;
      if (!E.REPORT_IDS.includes(res.report)) { out.push(`${where} I12 ${type} report outside the closed set: ${res.report}`); break; }
      if (res.info && res.info.internalError) { out.push(`${where} I12 ${type} internal error ${res.info.internalError}`); break; }
      if (res.report !== 'ok' && res.state !== pre) { out.push(`${where} I12 ${type} -> ${res.report} returned a different state`); break; }
      // I7 model: a line that was 86 when the action ran must make createTicket fail
      if (type === 'createTicket' && payload && Array.isArray(payload.items)) {
        const off = payload.items.filter((l) => l && typeof l.menuId === 'string' && base.avail[l.menuId] && base.avail[l.menuId].ok === false);
        if (off.length && res.report === 'ok') { out.push(`${where} I7 createTicket accepted 86 item ${off[0].menuId} (${base.avail[off[0].menuId].reason})`); break; }
      }
      if (res.report === 'ok') {
        // I8 model: every gram drawn by this action came from a batch that was servable when the action ran
        const bmap = new Map(base.batches.map((x) => [x.id, x]));
        const oldItems = new Map();
        for (const t of base.tickets) for (const it of t.items) oldItems.set(it.id, it);
        for (const t of res.state.tickets) for (const it of t.items) {
          if (!it.depleted || (oldItems.get(it.id) && oldItems.get(it.id).depleted)) continue;
          for (const r of it.depleted) if (r.batchId && !servableIndependent(bmap.get(r.batchId))) out.push(`${where} I8 ${it.id} drew ${r.g} g from non-servable batch ${r.batchId}`);
        }
        if (out.length) break;
        // I13: undo right after an undoable action restores every field it changed
        if (UNDOABLE.has(type) && rng.next() < 0.5) {
          const u = E.apply(res.state, 'undo', {}, now);
          if (u.report !== 'ok') { out.push(`${where} I13 undo after ${type} -> ${u.report}`); break; }
          const a = JSON.stringify(strip(u.state)), b2 = JSON.stringify(strip(base));
          if (a !== b2) {
            const sa = strip(u.state), sb = strip(base);
            const diff = Object.keys(sb).filter((k) => JSON.stringify(sa[k]) !== JSON.stringify(sb[k]));
            const k0 = diff[0], A0 = sa[k0], B0 = sb[k0];
            let detail = '';
            if (Array.isArray(B0)) { const i = B0.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(A0[j])); detail = ` first diff at [${i}]: undo ${JSON.stringify(A0[i])} vs before ${JSON.stringify(B0[i])}`; }
            else if (B0 && typeof B0 === 'object') { const kk = Object.keys(B0).find((x) => JSON.stringify(B0[x]) !== JSON.stringify(A0[x])); detail = ` key ${kk}: undo ${JSON.stringify(A0[kk])} vs before ${JSON.stringify(B0[kk])}`; }
            out.push(`${where} I13 undo after ${type} differs in: ${diff.join(', ')}.${detail}`);
            break;
          }
          const v = E.checkInvariants(u.state, now);
          if (v.length) { out.push(`${where} after undo of ${type}: ${v[0]}`); break; }
          s = rng.next() < 0.5 ? u.state : res.state;
        } else s = res.state;
        at = now;
      }
      const v = E.checkInvariants(s, at);
      if (v.length) { out.push(`${where} after ${type} -> ${res.report}: ${v[0]}`); break; }
    }
  }
  return out;
}

/** Targeted scenarios, one per invariant under mutation (the same ones as the unit tests, engine passed in). */
function scenarios(X) {
  const E = X.engine;
  const out = [];
  const go = (s, type, p, now) => { const r = E.apply(s, type, p, now); if (r.report !== 'ok') out.push(`${type} -> ${r.report}`); return r.state; };
  // I2: undo of a done after the batch it drew from was discarded
  {
    let s = E.newState({ now: T0, empty: true });
    s = go(s, 'addBatch', { ing: 'brisket', cookedG: 1000, tempF: 160 }, T0);
    s = go(s, 'logTemp', { batchId: 'b_1', tempF: 120 }, T0);
    s = go(s, 'reheatBatch', { batchId: 'b_1', tempF: 170 }, T0);
    s = go(s, 'createTicket', { items: [{ menuId: 'brisket_half' }] }, T0);
    s = go(s, 'completeItem', { ticketId: 't_1', itemId: 't_1.1' }, T0);
    s = go(s, 'logTemp', { batchId: 'b_1', tempF: 120 }, T0);
    s = go(s, 'undo', {}, T0);
    for (const v of E.checkInvariants(s, T0)) out.push('I2 scenario: ' + v);
  }
  // I5: pacing plan and rush
  {
    let s = E.newState({ now: T0 });
    s = go(s, 'createTicket', { items: [{ menuId: 'brisket_half' }, { menuId: 'slaw' }, { menuId: 'mac' }] }, T0);
    for (const v of E.checkInvariants(s, T0)) out.push('I5 scenario (paced): ' + v);
    s = go(s, 'setRush', { ticketId: 't_1', on: true }, T0 + 10 * SEC);
    for (const v of E.checkInvariants(s, T0 + 10 * SEC)) out.push('I5 scenario (rush): ' + v);
  }
  // I7: an 86'd line is refused and nothing changes
  {
    let s = E.newState({ now: T0 });
    s = go(s, 'toggle86', { menuId: 'mac', on: true }, T0);
    const r = E.apply(s, 'createTicket', { items: [{ menuId: 'brisket_half' }, { menuId: 'mac' }] }, T0);
    if (r.report !== 'itemUnavailable' || r.state !== s) out.push('I7 scenario: createTicket with an 86 line -> ' + r.report);
  }
  // I8: a locked (older) batch is never drawn from
  {
    let s = E.newState({ now: T0, empty: true });
    s = go(s, 'addBatch', { ing: 'brisket', cookedG: 1000, tempF: 160 }, T0);
    s = go(s, 'addBatch', { ing: 'brisket', cookedG: 1000, tempF: 160 }, T0 + SEC);
    s = go(s, 'logTemp', { batchId: 'b_1', tempF: 120 }, T0 + SEC);
    const pre = s;
    s = go(s, 'createTicket', { items: [{ menuId: 'brisket_half' }] }, T0 + SEC);
    s = go(s, 'completeItem', { ticketId: 't_1', itemId: 't_1.1' }, T0 + SEC);
    const dep = (s.tickets[0] && s.tickets[0].items[0].depleted) || [];
    for (const r of dep) if (r.batchId && !servableIndependent(pre.batches.find((b) => b.id === r.batchId))) out.push('I8 scenario: drew from locked ' + r.batchId);
  }
  // I13: undo of a learned completion restores learned too
  {
    let s = E.newState({ now: T0 });
    s = go(s, 'createTicket', { items: [{ menuId: 'slaw' }] }, T0);
    const base = s;
    s = go(s, 'completeItem', { ticketId: 't_1', itemId: 't_1.1' }, T0 + 40 * SEC);
    s = go(s, 'undo', {}, T0 + 40 * SEC);
    const bt = E.tick(base, T0 + 40 * SEC).state;
    if (JSON.stringify(strip(s)) !== JSON.stringify(strip(bt))) out.push('I13 scenario: undo did not restore every field');
  }
  return out;
}

/* ---------------------------------------------------------------- tests ---------------------------------------------------------------- */
test('fuzz: 200 random sequences x 60 steps keep I1-I15 after every step', () => {
  const stats = {};
  const t0 = performance.now();
  const v = runFuzz(SB, { seqs: 200, steps: 60, stats });
  const ms = performance.now() - t0;
  assert.deepEqual(v, []);
  const ok = Object.entries(stats).filter(([k]) => k.endsWith(':ok')).reduce((a, [, n]) => a + n, 0);
  const total = Object.values(stats).reduce((a, n) => a + n, 0);
  assert.equal(total, 200 * 60);
  // coverage: every action type succeeded at least once, and a healthy share of steps changed the state
  // keepServing and endKeepServing need a past-quality batch with a fresh reading; the unit tests cover their success paths.
  for (const type of Object.keys(SB.engine.ACTIONS).filter((x) => x !== 'uiReport' && x !== 'keepServing' && x !== 'endKeepServing')) assert.ok(stats[type + ':ok'] > 0, 'never succeeded: ' + type);
  assert.ok(ok / total > 0.25, 'ok share ' + ok / total);
  const distinct = new Set(Object.keys(stats).map((k) => k.split(':')[1]));
  assert.ok(distinct.size >= 25, 'reports exercised: ' + distinct.size);
  console.log(`fuzz: ${total} steps, ${ok} ok, ${distinct.size} distinct reports, ${ms.toFixed(0)} ms`);
});

test('fuzz: a second seed family (longer sequences, 40 x 150 steps; SB_FUZZ_SEQS / SB_FUZZ_SEED widen it)', () => {
  const seqs = Number(process.env.SB_FUZZ_SEQS) || 40, seed = Number(process.env.SB_FUZZ_SEED) || 777;
  assert.deepEqual(runFuzz(SB, { seqs, steps: 150, seed }), []);
});

test('scenarios pass on the real engine (loaded the same way the mutants are)', () => {
  assert.deepEqual(scenarios(loadEngine([])), []);
  assert.deepEqual(scenarios(SB), []);
});

const MUTANTS = {
  I2: { why: 'undo of a done whose batch was discarded drops the grams without booking them in ledger.dropped',
    m: [['const L = tx.ledger(r.ing); L.dropped = (L.dropped || 0) + r.g; /*@I2*/', '/*@I2 mutated*/']] },
  I5a: { why: 'pacing offset computed off by one second',
    m: [['const offsetSec = paced ? dmax - prepSec : 0; /*@I5a*/', 'const offsetSec = paced ? dmax - prepSec + 1 : 0; /*@I5a mutated*/']] },
  I5b: { why: 'setRush fires queued items but leaves their planned offset/fireAt',
    m: [['wi.offsetSec = 0; wi.fireAt = t.createdAt; wi.rushed = true; /*@I5b*/', 'wi.rushed = true; /*@I5b mutated*/']] },
  I7: { why: 'createTicket skips the availability check',
    m: [['if (!a || a.ok !== true) {', 'if (false) {']] },
  I8: { why: 'FIFO and servable stock ignore canServe (locked batches are drawn from)',
    m: [['const servableBatch = (b) => b.canServe === true && b.status', 'const servableBatch = (b) => b.status']] },
  I13: { why: 'undo of a completion does not restore the learned prep time',
    m: [['if (lr.before) w[lr.menuId] = lr.before; else delete w[lr.menuId]; /*@I13L*/', '/*@I13L mutated*/']] },
};
for (const [inv, mu] of Object.entries(MUTANTS)) {
  test(`mutation ${inv}: ${mu.why} -> the tests go red`, () => {
    const X = loadEngine(mu.m);
    const sc = scenarios(X);
    const fz = runFuzz(X, { seqs: 200, steps: 60 });
    const tag = inv.slice(0, 2) === 'I5' ? 'I5' : inv;
    const caught = sc.concat(fz).filter((x) => x.includes(tag));
    assert.ok(caught.length > 0, `mutant ${inv} survived. scenarios: ${JSON.stringify(sc)} fuzz: ${JSON.stringify(fz)}`);
    console.log(`mutant ${inv} killed by ${sc.some((x) => x.includes(tag)) ? 'scenario' : ''}${sc.some((x) => x.includes(tag)) && fz.some((x) => x.includes(tag)) ? ' + ' : ''}${fz.some((x) => x.includes(tag)) ? 'fuzz' : ''}: ${caught[0]}`);
  });
}
