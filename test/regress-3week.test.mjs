// Main-track regression of the owner's numbers: a scripted three-week own kitchen (own dishes, counter service for the middle week,
// voids, a reopened order paid again in the same open day, cold items with readings and a thrown-out batch, days closed) is walked
// through every office number (sales, days, hours, dishes, zones, channels, Close the day, the sales CSV read with a real CSV reader,
// the thrown-out log CSV, the pilot report), plus a second kitchen that is started over midway. Every figure is compared with an
// independent count in whole cents. Run in several time zones: TZ=America/New_York node --test test/regress-3week.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '36-csv', '25-deadlines', '35-pilot', '40-metrics', '76-floor-discards', '87-office-closeday', '88-office-backup']);
const E = SB.engine, M = SB.metrics, U = SB.util, BP = SB.office.backupPure, CD = SB.office.closeDayPure;
const MIN = 60e3;
const c100 = (v) => Math.round(v * 100 + 1e-7);

// A small RFC 4180 reader: quoted cells, doubled quotes, commas and line breaks inside quotes.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// A seeded random generator so every run builds the same kitchen.
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
// Local wall-clock time on day `d` after the start date (daylight-saving safe).
const at = (d, h, m = 0) => new Date(2026, 9, 5 + d, h, m, 0, 0).getTime();

// Builds the kitchen. `from`/`to` pick the service days to run (so a second kitchen can run only the later days).
function build(opts) {
  const r = rng(opts.seed || 5);
  const k = { now: at(opts.from, 7), log: { voidedOrders: 0, reopened: [], refusedReopen: [], closes: [], counterDays: [] } };
  k.s = E.newState({ now: k.now, blank: true });
  k.s.settings.pacing.enabled = false;   // the script starts every dish at once; pacing has its own tests
  // Applies one action at time t (never earlier than the last one) and fails on any refusal unless `allow` names it.
  const go = (type, p, t, allow) => { k.now = Math.max(k.now + 1000, t == null ? k.now : t); const res = E.apply(k.s, type, p, k.now); if (res.report !== 'ok' && res.report !== allow) assert.fail(type + ' -> ' + res.report + ' ' + JSON.stringify(res.info)); if (res.report === 'ok') k.s = res.state; return res; };
  go('updateSettings', { patch: { service: { taxRatePct: 8.25 }, modules: { cookAhead: true } } });
  const dishes = [['Brisket plate', 'pit', 'meat', 16.49], ['Pulled pork', 'pit', 'meat', 12.99], ['Slaw, side', 'cold', 'side', 3.37], ['Mac "n" cheese', 'fry', 'side', 4.51]]
    .map(([name, zone, cat, price]) => go('addMenuItem', { name, zone: C().zones[zone] ? zone : 'pit', cat, price, prepSec: 90, track: 'one', prepGuess: false }).info.id);
  const slaw = go('addIngredient', { name: 'Slaw mix', unit: 'g', tcs: true, hold: 'cold', costPerKg: 6 }).info.id;
  for (let d = opts.from; d <= opts.to; d++) {
    const counter = d >= 7 && d <= 13;
    if (counter !== !!k.s.settings.service.counter) go('updateSettings', { patch: { service: { counter } } }, at(d, 7));
    if (counter) k.log.counterDays.push(d);
    // a cold batch with readings, thrown out on some days
    const b = go('addBatch', { ing: slaw, tempF: 38, rawG: 3000, cookedG: 3000 }, at(d, 8), 'moduleOff');
    go('logEquipmentTemp', { unit: 'cooler', f: 36 + (d % 4), who: 'AB' }, at(d, 8, 10), 'moduleOff');
    if (b.report === 'ok') { go('logTemp', { batchId: b.info.id || b.info.batchId, tempF: 39, who: 'AB' }, at(d, 11), 'moduleOff'); if (d % 3 === 0) go('discardBatch', { batchId: b.info.id || b.info.batchId, reason: 'quality', who: 'AB' }, at(d, 12), 'moduleOff'); }
    const n = 5 + Math.floor(r() * 6);
    let reopenDone = false;
    for (let j = 0; j < n; j++) {
      const t = at(d, 11 + Math.floor((j * 8) / n), (j * 7) % 55);
      const items = []; for (let i = 0; i < 1 + Math.floor(r() * 3); i++) items.push({ menuId: dishes[Math.floor(r() * dishes.length)], qty: 1 + Math.floor(r() * 3) });
      const method = ['cash', 'card', 'other'][Math.floor(r() * 3)], tip = r() < 0.5 ? Math.round(r() * 700) / 100 : 0, discount = r() < 0.2 ? 1.01 : 0;
      const channel = j % 4 === 3 ? 'takeout' : 'dine_in';
      const cr = go('createTicket', { customer: 'D' + d + 'n' + j, channel, items, pay: counter && r() < 0.8 ? { method, tip, discount } : undefined }, t);
      const tk = k.s.tickets.find((x) => x.id === cr.info.ticketId);
      if (!cr.info.paid && r() < 0.1) { go('voidTicket', { ticketId: tk.id, reason: 'oops' }, k.now + 1000); go('voidOrder', { orderId: cr.info.orderId, reason: 'oops' }, k.now + 1000); k.log.voidedOrders++; continue; }
      for (const it of tk.items) { go('completeItem', { ticketId: tk.id, itemId: it.id }, k.now + 20000, 'ticketNotActive'); }
      go('bumpTicket', { ticketId: tk.id }, k.now + 5000, 'ticketNotActive');
      const order = () => k.s.orders.find((o) => o.id === cr.info.orderId);
      if (order().status === 'open') go('payOrder', { orderId: cr.info.orderId, method, tip, discount }, k.now + 3 * MIN);
      // one reopened order, in the SAME open day, paid again with another method
      if (!reopenDone && j === 2 && d % 2 === 1) { reopenDone = true; const rr = go('reopenOrder', { orderId: cr.info.orderId }, k.now + MIN); assert.equal(rr.report, 'ok'); k.log.reopened.push(cr.info.orderId); go('payOrder', { orderId: cr.info.orderId, method: 'card', tip: 1.25 }, k.now + MIN); }
    }
    // close the day at 11 pm, except the last day, which stays open for the "open day" checks
    if (d < opts.to) {
      const cl = go('closeDay', { leftovers: 'keep' }, at(d, 23)); k.log.closes.push({ d, ev: cl.info });
      // a paid order from this closed day can no longer be reopened
      const o = k.s.orders.filter((x) => x.status === 'paid').find((x) => U.serviceDate(x.paidAt, k.s.settings.service.dayStartHour) === U.serviceDate(k.now, k.s.settings.service.dayStartHour));
      if (o) { const rr = E.apply(k.s, 'reopenOrder', { orderId: o.id }, k.now + 1000); k.log.refusedReopen.push(rr.report); }
    }
  }
  return k;
}
// The zone ids this build knows (so the script does not depend on one fixed menu layout).
function C() { return { zones: SB.config.zoneById || {} }; }

const dsOf = (s) => ({ tickets: s.tickets, orders: s.orders, events: E.allEvents(s), batches: s.batches, learned: s.learned || {}, menu: s.menu, ingredients: s.ingredients, settings: s.settings, range: { from: -Infinity, to: Infinity } });

// The independent ledger: whole cents per service day from the paid orders alone.
function ledger(s) {
  const dsh = s.settings.service.dayStartHour, days = {}, tot = { n: 0, sales: 0, disc: 0, tax: 0, tips: 0, coll: 0, cash: 0, card: 0, other: 0 };
  for (const o of s.orders) {
    if (o.status !== 'paid') continue;
    const d = U.serviceDate(o.paidAt, dsh), x = days[d] || (days[d] = { n: 0, sales: 0, disc: 0, tax: 0, tips: 0, coll: 0, cash: 0, card: 0, other: 0 });
    const T = o.totals, sub = c100(T.subtotal), disc = c100(T.discount), tax = c100(T.tax), tip = c100(o.tip || 0), coll = c100(T.total) + tip;
    for (const a of [x, tot]) { a.n++; a.sales += sub - disc; a.disc += disc; a.tax += tax; a.tips += tip; a.coll += coll; a[o.method] += coll; }
  }
  return { days, tot };
}

const K = build({ from: 0, to: 20, seed: 5 });
const S = K.s, L = ledger(S), ds = dsOf(S);

test('the scripted kitchen is what the brief says it is', () => {
  assert.ok(Object.keys(L.days).length >= 20, 'days with sales ' + Object.keys(L.days).length);
  assert.ok(L.tot.n > 100, 'orders ' + L.tot.n);
  assert.ok(K.log.counterDays.length === 7, 'a week of counter service');
  assert.ok(K.log.reopened.length >= 5, 'reopened orders ' + K.log.reopened.length);
  assert.ok(S.orders.some((o) => o.status === 'voided'), 'some voids');
  assert.ok(S.batches.some((b) => b.status === 'discard'), 'some thrown-out cold food');
  assert.ok(E.safetyLog(S).length > 20, 'safety readings are on record');
  assert.ok(S.orders.some((o) => o.status === 'open') === false, 'nothing left open');
});

test('closed days refuse a reopen with dayClosed, in the engine path the Orders drawer uses, and nothing moves', () => {
  assert.ok(K.log.refusedReopen.length >= 15, 'attempts ' + K.log.refusedReopen.length);
  assert.ok(K.log.refusedReopen.every((x) => x === 'dayClosed'), JSON.stringify(K.log.refusedReopen));
  // the last (still open) day can still be reopened and paid again, and a day_closed event is never counted for the same order twice
  const last = S.orders.filter((o) => o.status === 'paid').sort((a, b) => b.paidAt - a.paidAt)[0];
  const before = JSON.stringify(ledger(S).tot);
  const r = E.apply(S, 'reopenOrder', { orderId: last.id }, K.now + MIN);
  assert.equal(r.report, 'ok');
  assert.equal(JSON.stringify(ledger(r.state).tot) === before, false, 'reopening takes the sale out of the paid totals');
  const p = E.apply(r.state, 'payOrder', { orderId: last.id, method: last.method, tip: last.tip, discount: last.totals.discount }, K.now + 2 * MIN);
  assert.equal(p.report, 'ok');
  assert.equal(JSON.stringify(ledger(p.state).tot), before, 'paying it again brings back exactly the same cents');
  const closed = S.events.filter((e) => e.type === 'day_closed');
  assert.equal(closed.reduce((a, e) => a + e.orders, 0), L.tot.n - (L.days[Object.keys(L.days).sort().pop()].n), 'day_closed events cover each closed day once; the open day is not in them');
});

test('Sales and money: every figure equals the cents ledger; days, methods and channels add up with no double counting', () => {
  const sales = M.sales(ds, { from: -Infinity, to: Infinity });
  assert.equal(sales.checks, L.tot.n); assert.equal(c100(sales.net), L.tot.sales); assert.equal(c100(sales.discounts), L.tot.disc);
  assert.equal(c100(sales.tax), L.tot.tax); assert.equal(c100(sales.tips), L.tot.tips); assert.equal(c100(sales.collected), L.tot.coll);
  assert.equal(sales.byDay.length, Object.keys(L.days).length);
  sales.byDay.forEach((d) => { assert.equal(c100(d.collected), L.days[d.date].coll, d.date); assert.equal(d.checks, L.days[d.date].n, d.date); });
  assert.equal(sales.byDay.reduce((a, d) => a + c100(d.collected), 0), L.tot.coll);
  sales.byMethod.forEach((m) => assert.equal(c100(m.collected), L.tot[m.method], m.method));
  assert.equal(sales.byMethod.reduce((a, m) => a + c100(m.collected), 0), L.tot.coll);
  assert.equal(sales.byChannel.reduce((a, c) => a + c.checks, 0), L.tot.n, 'channels add up to the orders');
  assert.equal(sales.byChannel.reduce((a, c) => a + c100(c.net), 0), L.tot.sales, 'channels add up to net sales');
  // sales by hour add up to the same net, counted once
  const rh = M.revenueByHour ? M.revenueByHour(ds, { from: -Infinity, to: Infinity }) : null;
  if (rh && Array.isArray(rh.rows || rh.hours)) { const rows = rh.rows || rh.hours; const sum = rows.reduce((a, x) => a + c100(x.net != null ? x.net : (x.revenue || 0)), 0); assert.ok(sum <= L.tot.sales + L.tot.tax + L.tot.tips, 'hourly revenue never exceeds the money taken'); }
  // each day's range gives that day's numbers alone
  for (const d of Object.keys(L.days).slice(3, 6)) { const one = M.sales(ds, { from: new Date(d + 'T04:00:00').getTime(), to: new Date(d + 'T04:00:00').getTime() + 86400e3 }); assert.equal(c100(one.collected), L.days[d].coll, 'range of ' + d); }
});

test('Pace, Tickets and Stations: ticket counts agree with the board data, voids are not counted as served, counter service is not timed', () => {
  const real = S.tickets.filter((t) => t.status !== 'voided');
  const summ = M.summary(ds);
  const sold = M.byItem(ds); const zones = M.byZone(ds);
  const rowsOf = (x) => (Array.isArray(x) ? x : x && (x.rows || x.items || x.zones)) || [];
  const dishQty = rowsOf(sold).reduce((a, r) => a + (r.sold || 0), 0);
  const itemQty = S.tickets.filter((t) => t.status !== 'voided').reduce((a, t) => a + t.items.filter((i) => i.status !== 'voided').reduce((q, i) => q + i.qty, 0), 0);
  assert.equal(dishQty, itemQty, 'units sold by dish equal units on non-voided tickets (' + dishQty + ' vs ' + itemQty + ')');
  const zoneQty = rowsOf(zones).reduce((a, r) => a + (r.qty || 0), 0);
  assert.equal(zoneQty, itemQty, 'units by station equal the same count');
  const dayRows = rowsOf(M.byDay(ds));
  assert.equal(dayRows.reduce((a, r) => a + (r.tickets || 0), 0), real.length, 'every ticket is on exactly one day');
  assert.equal(dayRows.reduce((a, r) => a + (r.voids || 0), 0), S.tickets.length - real.length, 'voided tickets are counted as voids, not as served');
  assert.ok(summ && real.length > 0);
});

test('Close the day sheet equals the ledger for a closed day and for the open day', () => {
  const dsh = S.settings.service.dayStartHour;
  for (const c of S.events.filter((e) => e.type === 'day_closed').slice(0, 20)) {
    const day = U.serviceDate(c.t, dsh);
    assert.equal(c100(c.total) + c100(c.tip), L.days[day].coll, 'closed ' + day);
    assert.equal(c.orders, L.days[day].n, 'orders ' + day);
  }
  const model = CD.closeDayModel(S, K.now), day = U.serviceDate(K.now, dsh);
  assert.equal(c100(model.collected), L.days[day].coll, 'open day sheet');
  assert.equal(model.paid, L.days[day].n);
  assert.equal(model.methods.reduce((a, m) => a + c100(m.collected), 0), L.days[day].coll, 'methods add up on the sheet');
});

test('the sales CSV read with a real reader equals the ledger, row by row, in any time zone', () => {
  const rows = parseCsv(BP.salesCsv(S, S.settings.service.dayStartHour));
  const head = rows.shift(), tot = rows.pop();
  assert.equal(head.length, 10); assert.ok(rows.every((r) => r.length === 10));
  assert.ok(rows.every((r) => /^\d{4}-\d\d-\d\d$/.test(r[0])) && rows.every((r, i) => i === 0 || rows[i - 1][0] < r[0]), 'dates sorted, one row per day');
  assert.ok(rows.flat().slice(1).every((v) => /^-?\d+(\.\d\d)?$/.test(v) || /^\d{4}-/.test(v)), 'plain digits only');
  const cents = (v) => Math.round(Number(v) * 100);
  rows.forEach((r) => { const d = L.days[r[0]]; assert.equal(Number(r[1]), d.n); assert.equal(cents(r[2]), d.sales); assert.equal(cents(r[3]), d.disc); assert.equal(cents(r[4]), d.tax); assert.equal(cents(r[5]), d.tips); assert.equal(cents(r[6]), d.coll); assert.equal(cents(r[7]) + cents(r[8]) + cents(r[9]), d.coll); });
  assert.equal(tot[0], 'Total'); assert.equal(Number(tot[1]), L.tot.n); assert.equal(cents(tot[6]), L.tot.coll);
  for (let c = 1; c <= 9; c++) assert.equal(rows.reduce((a, r) => a + (c === 1 ? Number(r[c]) : cents(r[c])), 0), c === 1 ? Number(tot[c]) : cents(tot[c]), 'column ' + c + ' adds up');
});

test('the thrown-out log CSV and the pilot report agree with the batches and the safety record', () => {
  const rec = { cols: [{ key: 'date', label: 'Date', on: true }, { key: 'food', label: 'Food', on: true }, { key: 'amount', label: 'Amount', on: true }, { key: 'reason', label: 'Why', on: true }, { key: 'initials', label: 'Initials', on: true }], initials: {}, extra: {} };
  const list = SB.discardsPure.rows(S, rec);
  const discards = E.safetyLog(S).filter((r) => r.event.type === 'batch_discard' && r.event.batchId);
  assert.equal(list.length, discards.length, 'one row per discard on record');
  assert.equal(S.batches.filter((b) => b.status === 'discard').length, list.length, 'and no discard is listed twice');
  const out = parseCsv(SB.discardsPure.csv(list, rec, ''));
  assert.equal(out.length, list.length + 1); assert.deepEqual(out[0], ['Date', 'Food', 'Amount', 'Why', 'Initials']);
  assert.ok(out.slice(1).every((r) => /^Slaw mix/.test(r[1]) && r[2] === '3 kg' && r[3].length > 0), JSON.stringify(out[1]));
  const rep = SB.pilot.build(S, { from: at(0, 0), to: K.now + MIN, now: K.now });
  assert.equal(rep.discards.n, list.length, 'the pilot report counts the same discards');
  assert.equal(rep.discards.g, S.batches.filter((b) => b.status === 'discard').reduce((a, b) => a + (b.wasteG || 0), 0), 'and the same grams');
  const csv = parseCsv(SB.pilot.toCsv(rep));
  assert.ok(csv.every((r) => r.length === 4), 'every pilot CSV row has four cells');
  assert.equal(Number(csv.find((r) => r[0] === 'discards' && r[1] === 'batches')[2]), list.length);
});

test('a second kitchen that is started over midway holds only the later days, and the first kitchen is unchanged', () => {
  const B = build({ from: 10, to: 20, seed: 5 });
  const LB = ledger(B.s);
  assert.ok(Object.keys(LB.days).every((d) => d >= U.serviceDate(at(10, 12), 4)), 'no day before the restart');
  assert.ok(LB.tot.n > 0 && LB.tot.n < L.tot.n);
  const sB = M.sales(dsOf(B.s), { from: -Infinity, to: Infinity });
  assert.equal(c100(sB.collected), LB.tot.coll); assert.equal(sB.checks, LB.tot.n);
  const rows = parseCsv(BP.salesCsv(B.s, 4)); const tot = rows.pop();
  assert.equal(Math.round(Number(tot[6]) * 100), LB.tot.coll);
  assert.equal(c100(M.sales(ds, { from: -Infinity, to: Infinity }).collected), L.tot.coll, 'the first kitchen did not move');
});
