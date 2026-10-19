// SB.quality tests: hand-built tickets with defect counts, DPMO, sigma, Pareto and control limits worked out by hand.
// Run: node tools/test.mjs quality
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';
import { ticket, item, event, batch, dataset, quick, at } from './_fixtures.mjs';

await loadSB(['00-util', '10-config', '41-quality']);
const SB = globalThis.SB, Q = SB.quality;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} to be within ${eps} of ${b}`);

describe('sigma maths', () => {
  it('matches the standard table at the usual points', () => {
    near(Q.sigmaOf(3.4), 6, 0.05);
    near(Q.sigmaOf(6210), 4, 0.05);
    near(Q.sigmaOf(66807), 3, 0.05);
    assert.equal(Q.sigmaOf(0), 6);
    assert.equal(Q.sigmaOf(1e6), 0);
    assert.equal(Q.sigmaOf(null), null);
  });
  it('p-chart limits are three standard errors, clipped to 0 and 1', () => {
    const l = Q.pLimits(0.1, 100);
    near(l.ucl, 0.1 + 3 * Math.sqrt(0.09 / 100));
    assert.equal(Q.pLimits(0.01, 4).lcl, 0);
  });
});

describe('ticket defects', () => {
  // dine-in overdue limit is 780 s. Ticket A: 600 s, clean. B: 900 s, late. C: voided. D: 300 s, recalled.
  const A = quick({ id: 'A', created: 0, total: 600 });
  const B = quick({ id: 'B', created: 1000, total: 900 });
  const C = ticket({ id: 'C', created: 2000, voided: 2100, items: [item({ menu: 'slaw' })] });
  const D = quick({ id: 'D', created: 3000, total: 300, recalls: 1 });
  const r = Q.analyze(dataset({ tickets: [A, B, C, D] }), {});
  it('counts defects, defective tickets and first-pass yield', () => {
    assert.equal(r.tickets.units, 4);
    assert.equal(r.tickets.defective, 3);
    near(r.tickets.firstPass, 0.25);
    const by = Object.fromEntries(r.tickets.types.map((t) => [t.id, t]));
    assert.equal(by.late.defects, 1);
    assert.equal(by.late.opps, 3);
    assert.equal(by.voided.defects, 1);
    assert.equal(by.recalled.defects, 1);
    assert.equal(by.lateStart.opps, 0);
  });
  it('DPMO is defects over opportunities, and the Pareto is biggest first with a running share', () => {
    const t = r.tickets;
    near(t.dpmo, (t.defects / t.opps) * 1e6);
    assert.equal(r.pareto.length, 3);
    near(r.pareto[2].cum, 1);
  });
  it('a late classic ticket is blamed on the station whose item finished last', () => {
    assert.equal(r.causes[0].id, 'zone:pit');
  });
});

describe('overdue limit per channel', () => {
  it('uses the channel starter limit, so a 13-minute takeout ticket is late but a 13-minute dine-in ticket is not', () => {
    const a = Q.analyze(dataset({ tickets: [quick({ id: 'D1', created: 0, total: 750, channel: 'dine_in' }), quick({ id: 'T1', created: 100, total: 750, channel: 'takeout' })] }), {});
    const late = Object.fromEntries(a.tickets.types.map((t) => [t.id, t.defects]));
    assert.equal(late.late, 1);
  });
});

describe('two-tap tickets', () => {
  const mk = (id, startLag, releaseAfterReady, dmax = 300) => ticket({ id, created: 0, dmaxSec: dmax, status: 'expedited', expedited: startLag + dmax + releaseAfterReady,
    items: [item({ menu: 'mac', fired: startLag, done: startLag + dmax })], released: true, startedAt: undefined, startedAtSec: startLag });
  it('judges Start lag and plate wait, and blames the first one that applies', () => {
    const t = mk('S1', 120, 30);
    t.startedAt = t.createdAt + 120000;
    t.expeditedAt = t.startedAt + 300000 + 30000;
    t.released = true;
    const j = Q.judgeTicket(t, { settings: {}, shortTickets: new Set() });
    assert.deepEqual(j.defects.sort(), ['lateStart']);
    const u = mk('S2', 10, 200);
    u.startedAt = u.createdAt + 10000;
    u.expeditedAt = u.startedAt + 300000 + 200000;
    u.released = true;
    const j2 = Q.judgeTicket(u, { settings: {}, shortTickets: new Set() });
    assert.deepEqual(j2.defects.sort(), ['plateWait']);
  });
});

describe('control charts and capability', () => {
  it('flags a day outside the limits and reports no Cpk below 30 tickets', () => {
    const tickets = [];
    for (let d = 0; d < 10; d++) for (let i = 0; i < 20; i++) tickets.push(quick({ id: `x${d}_${i}`, created: d * 86400 + i * 60, total: d === 7 && i < 15 ? 900 : 300 }));
    const r = Q.analyze(dataset({ tickets }), {});
    assert.equal(r.days.length, 10);
    assert.equal(r.days.filter((x) => x.out === 'high').length, 1);
    assert.equal(r.capability.enough, true);
    const small = Q.analyze(dataset({ tickets: tickets.slice(0, 10) }), {});
    assert.equal(small.capability.cpk, null);
  });
});

describe('hold cabinet', () => {
  it('counts discarded batches and late temperature checks as defects', () => {
    const b1 = batch({ id: 'b1', entered: 0, discarded: 4 * 3600, wasteG: 2000, discardReason: 'expired', costPerCookedKg: 20 });
    const b2 = batch({ id: 'b2', entered: 0 });
    const ev = [event({ type: 'temp_logged', at: 100, onTime: true }), event({ type: 'temp_logged', at: 200, onTime: false })];
    const r = Q.analyze(dataset({ batches: [b1, b2], events: ev }), {});
    assert.equal(r.cabinet.units, 4);
    assert.equal(r.cabinet.defects, 2);
    near(r.cost, 40);
  });
});
