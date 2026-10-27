// Draft order persistence, counter service, customer chips, and the currency symbol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '13-menu-import', '20-engine', '30-store', '40-metrics']);
const { store: S, engine: E, util: U, config: C, metrics: M, menuImport: MI } = SB;
const T = 1780326000000, MIN = 60e3;
const ok = (r, w) => { assert.equal(r.report, 'ok', w + ': ' + r.report + ' ' + JSON.stringify(r.info)); return r.state; };
function backend(entries) {
  const m = new Map(Object.entries(entries || {})), log = [];
  return { m, log, persistent: true, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), raw: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { log.push(['set', k]); m.set(k, JSON.stringify(v)); return true; }, remove: (k) => { log.push(['remove', k]); m.delete(k); }, keys: (p) => Array.from(m.keys()).filter((k) => k.indexOf(p) === 0) };
}
let clock = T;
const start = (b, mode, extra) => S.init(Object.assign({ storage: b, mode: mode || 'real', blank: true, noTimers: true, noSync: true, now: () => clock }, extra));
const dishes = (s, ...names) => names.reduce((a, n) => ok(E.apply(a, 'addMenuItem', { name: n, zone: 'cold', cat: 'cold', price: 4, prepSec: 600, track: 'two' }, T), 'dish ' + n), s);
const settingsPatch = (s, patch, at) => E.apply(s, 'updateSettings', { patch }, at == null ? T : at);

/* ------------------------------ draft order ------------------------------ */

test('a half-built order is saved, survives a reload, is cleared on send, and is never mixed with the demo', () => {
  clock = T;
  const b = backend(); start(b);
  const draft = { customer: 'Table 3', channel: 'dine_in', lines: [{ menuId: 'pie', qty: 2, mods: ['No nuts'] }], note: 'allergy' };
  assert.equal(S.loadDraft(), null);
  assert.equal(S.saveDraft(draft), true);
  assert.deepEqual(S.loadDraft(), draft);
  S.destroy();
  clock = T + 3 * 3600e3; start(b);                                                       // a reload three hours later
  assert.deepEqual(S.loadDraft(), draft);
  const copy = S.loadDraft(); copy.lines.push('x'); assert.deepEqual(S.loadDraft(), draft);   // the screen gets a copy
  S.dispatch('addMenuItem', { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' });
  assert.equal(S.dispatch('createTicket', { customer: 'a', channel: 'dine_in', items: [{ menuId: 'pie', qty: 1 }] }), 'ok');
  assert.equal(S.loadDraft(), null);                                                      // sending an order clears it
  S.saveDraft(draft); S.clearDraft(); assert.equal(S.loadDraft(), null);                  // cancelling clears it
  assert.equal(b.keys('smokebox.v1.orderdraft').length, 0);
  // not in backups
  S.saveDraft(draft);
  assert.equal(S.exportAll().indexOf('Table 3'), -1);
  S.destroy();
  // the demo keeps its own
  const d = backend(); start(d, 'demo'); S.saveDraft({ customer: 'demo' }); S.destroy();
  assert.deepEqual(d.keys('smokebox.'), ['smokebox.demo.orderdraft']);
  start(b); S.saveDraft(draft); assert.equal(b.keys('smokebox.demo.').length, 0); S.destroy();
  assert.ok(U.dataKeys.includes('smokebox.v1.orderdraft'));
});

test('drafts are size-capped, expire after 12 hours, and a damaged draft is ignored and removed', () => {
  clock = T;
  const b = backend(); start(b);
  try {
    assert.equal(S.saveDraft({ note: 'x'.repeat(25000) }), false);
    for (const bad of [null, undefined, 5, 'text', [1, 2], () => 1]) assert.equal(S.saveDraft(bad), false, String(bad));
    assert.equal(S.saveDraft({ cyc: (() => { const o = {}; o.o = o; return o; })() }), false);          // not plain JSON
    assert.equal(b.keys('smokebox.v1.orderdraft').length, 0);
    S.saveDraft({ a: 1 });
    clock = T + 11 * 3600e3; assert.deepEqual(S.loadDraft(), { a: 1 });
    clock = T + 13 * 3600e3; assert.equal(S.loadDraft(), null); assert.equal(b.keys('smokebox.v1.orderdraft').length, 0);
    clock = T;
    for (const junk of ['{not json', 'null', '"text"', '[1]', '{"v":2,"at":1,"draft":{}}', '{"v":1,"at":"x","draft":{}}', '{"v":1,"at":' + T + ',"draft":5}', '{"v":1,"at":' + (T + 99 * 3600e3) + ',"draft":{}}']) {
      b.m.set('smokebox.v1.orderdraft', junk);
      assert.equal(S.loadDraft(), null, junk); assert.equal(b.keys('smokebox.v1.orderdraft').length, 0, junk);
    }
  } finally { S.destroy(); }
});

test('start over clears the draft', () => {
  clock = T;
  const b = backend(); start(b); S.dispatch('addMenuItem', { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' });
  S.saveDraft({ customer: 'x' });
  assert.equal(S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: S.START_OVER_WORD }).ok, true);
  assert.equal(S.loadDraft(), null); S.destroy();
});

/* ------------------------------ counter service ------------------------------ */

function counterKitchen(counter) {
  let s = E.newState({ now: T, blank: true });
  if (counter) s = ok(settingsPatch(s, { service: { counter: true } }), 'counter on');
  s = dishes(s, 'Bun', 'Latte');
  s = ok(E.apply(s, 'setPortions', { menuId: 'bun', on: true, count: 10 }, T), 'portions');
  return s;
}
const order = (s, at, extra) => E.apply(s, 'createTicket', Object.assign({ customer: 'c', channel: 'takeout', items: [{ menuId: 'bun', qty: 2 }, { menuId: 'latte', qty: 1 }] }, extra || {}), at);

test('counter service is off by default: payment does not touch the tickets', () => {
  assert.equal(E.counterOn(E.defaultSettings()), false);
  const s0 = counterKitchen(false);
  let s = ok(order(s0, T + 1000), 'order');
  s = ok(E.apply(s, 'payOrder', { orderId: 'o_1', method: 'cash' }, T + 5 * MIN), 'pay');
  assert.deepEqual([s.tickets[0].status, s.tickets[0].items.map((i) => i.status).join()], ['active', 'displayed,displayed']);
  assert.equal(s.stock[s.ingredients[0].id], 10);
});

test('counter service: paying finishes and bumps the order at once, flagged auto, stock used, nothing learned, invariants hold', () => {
  const s0 = counterKitchen(true);
  assert.equal(E.counterOn(s0.settings), true);
  let s = ok(order(s0, T + 1000), 'order');
  assert.equal(s.tickets[0].status, 'active');                                           // on the board until paid
  const r = E.apply(s, 'payOrder', { orderId: 'o_1', method: 'cash', tip: 1 }, T + 6 * MIN);
  s = ok(r, 'pay');
  assert.equal(r.info.autoFinished, 2);
  const t = s.tickets[0];
  assert.deepEqual([t.status, t.auto, t.forced], ['expedited', true, undefined]);
  assert.ok(t.items.every((i) => i.status === 'done' && i.auto === true && i.doneAt >= i.firedAt && i.firedAt >= t.createdAt));
  assert.ok(t.expeditedAt >= t.items[0].doneAt);
  assert.equal(s.stock[s.ingredients[0].id], 8);                                          // two buns left the portion count
  assert.deepEqual(s.learned, {});                                                        // no prep time is learned from a paid-at-once order
  const evs = E.allEvents(s);
  assert.ok(evs.filter((e) => e.type === 'item_done').every((e) => e.auto === true && e.workMs === 0));
  assert.equal(evs.filter((e) => e.type === 'ticket_expedited')[0].auto, true);
  assert.deepEqual(E.checkInvariants(s, T + 7 * MIN), []);
  assert.deepEqual(E.views.counts(s, T + 20 * MIN).all, 0);                              // nothing late on the board
  // pay at the counter in one tap (createTicket with pay)
  let q = ok(order(s0, T + 1000, { pay: { method: 'card' } }), 'pay now');
  assert.deepEqual([q.tickets[0].status, q.tickets[0].auto, q.orders[0].status], ['expedited', true, 'paid']);
  assert.deepEqual(E.checkInvariants(q, T + 2000), []);
  // a bad payment changes nothing
  assert.equal(E.apply(s0, 'payOrder', { orderId: 'o_1', method: 'gold' }, T).report, 'unknownOrder');
});

test('counter service: earlier rounds, voided tickets, sold-out portions and reopened orders behave', () => {
  let s = counterKitchen(true);
  s = ok(order(s, T + 1000), 'round 1');
  // round 1 is finished and bumped by hand before payment
  s = E.tick(s, T + 700e3).state;
  const t1 = s.tickets[0];
  for (const it of t1.items) s = ok(E.apply(s, 'completeItem', { ticketId: t1.id, itemId: it.id }, T + 701e3), 'done');
  s = ok(E.apply(s, 'bumpTicket', { ticketId: t1.id }, T + 702e3), 'bump');
  s = ok(order(s, T + 800e3, { orderId: 'o_1' }), 'round 2');
  s = ok(order(s, T + 801e3, { orderId: 'o_1' }), 'round 3');
  s = ok(E.apply(s, 'voidTicket', { ticketId: 't_3', reason: 'wrong' }, T + 802e3), 'void round 3');
  const r = E.apply(s, 'payOrder', { orderId: 'o_1', method: 'cash' }, T + 900e3);
  s = ok(r, 'pay');
  assert.equal(r.info.autoFinished, 2);                                                   // only round 2 (its two items)
  assert.deepEqual(s.tickets.map((t) => [t.status, t.auto === true]), [['expedited', false], ['expedited', true], ['voided', false]]);
  assert.equal(s.stock[s.ingredients[0].id], 10 - 2 - 2);
  assert.deepEqual(E.checkInvariants(s, T + 901e3), []);
  // reopen, add a round, pay again: only the new round is finished
  s = ok(E.apply(s, 'reopenOrder', { orderId: 'o_1' }, T + 910e3), 'reopen');
  s = ok(order(s, T + 920e3, { orderId: 'o_1' }), 'round 4');
  const r2 = E.apply(s, 'payOrder', { orderId: 'o_1', method: 'card' }, T + 930e3);
  assert.equal(r2.info.autoFinished, 2);
  assert.deepEqual(E.checkInvariants(r2.state, T + 931e3), []);
  // an item that shorts the stock still finishes (stock_short is recorded as for any finished item)
  let low = counterKitchen(true);
  low = ok(E.apply(low, 'setPortions', { menuId: 'latte', on: true, count: 1 }, T), 'tea portions');
  low = ok(E.apply(low, 'createTicket', { customer: 'c', channel: 'takeout', items: [{ menuId: 'latte', qty: 3 }] }, T + 1000), 'big order');
  low = ok(E.apply(low, 'payOrder', { orderId: 'o_1', method: 'cash' }, T + 2000), 'pay');
  assert.equal(low.tickets[0].status, 'expedited'); assert.ok(E.allEvents(low).some((e) => e.type === 'stock_short'));
  assert.deepEqual(E.checkInvariants(low, T + 3000), []);
});

test('counter service does not pollute the pace and analytics numbers; sales still count', () => {
  // three ordinary tickets with real kitchen times, plus three counter tickets paid twenty minutes after they were rung up
  const build = (withCounter) => {
    let s = E.newState({ now: T, blank: true });
    s = dishes(s, 'Bun');
    let t = T;
    for (let i = 0; i < 3; i++) {
      t += 10 * MIN; s = ok(E.apply(s, 'createTicket', { customer: 'n' + i, channel: 'dine_in', items: [{ menuId: 'bun', qty: 1 }] }, t), 'n');
      s = E.tick(s, t + 11 * MIN).state; const tk = s.tickets.at(-1);
      s = ok(E.apply(s, 'advanceItem', { ticketId: tk.id, itemId: tk.items[0].id }, t + 11 * MIN), 'start');
      s = ok(E.apply(s, 'completeItem', { ticketId: tk.id, itemId: tk.items[0].id }, t + 14 * MIN), 'done');
      s = ok(E.apply(s, 'bumpTicket', { ticketId: tk.id }, t + 15 * MIN), 'bump');
      s = ok(E.apply(s, 'payOrder', { orderId: tk.orderId, method: 'cash' }, t + 16 * MIN), 'pay');
    }
    if (withCounter) {
      s = ok(settingsPatch(s, { service: { counter: true } }, t + 17 * MIN), 'counter on');
      for (let i = 0; i < 3; i++) {
        t += 40 * MIN; const r = ok(E.apply(s, 'createTicket', { customer: 'c' + i, channel: 'dine_in', items: [{ menuId: 'bun', qty: 1 }] }, t), 'c'); s = r;
        s = ok(E.apply(s, 'payOrder', { orderId: s.orders.at(-1).id, method: 'cash' }, t + 20 * MIN), 'pay c');
      }
    }
    return s;
  };
  const range = { from: T - 864e5, to: T + 864e5 };
  const ds = (s) => ({ tickets: s.tickets, orders: s.orders, events: E.allEvents(s), batches: s.batches, learned: s.learned, menu: s.menu, ingredients: s.ingredients, settings: s.settings, range });
  const plain = ds(build(false)), mixed = ds(build(true));
  assert.equal(mixed.tickets.length, 6);
  const a = M.anatomySummary(plain, range), b = M.anatomySummary(mixed, range);
  assert.equal(b.count, a.count);                                                          // the counter tickets are not speed tickets
  assert.equal(M.byItem(mixed, range)[0].workN, M.byItem(plain, range)[0].workN);          // no invented prep times
  assert.equal(M.byItem(mixed, range)[0].avgWorkMs, M.byItem(plain, range)[0].avgWorkMs);
  assert.equal(M.byItem(mixed, range)[0].sold, 6); assert.equal(M.byItem(plain, range)[0].sold, 3);   // but they are sales
  const sa = M.sales(plain, range), sb = M.sales(mixed, range);
  assert.equal(sb.checks, 6); assert.ok(sb.gross > sa.gross);
  for (const s of [build(true)]) assert.deepEqual(E.checkInvariants(s, T + 10 * 3600e3), []);
  assert.deepEqual(build(true).learned, build(false).learned);
});

/* ------------------------------ customer chips ------------------------------ */

test('the customer chips: default list, the owner\'s list, none, validation, undo, backups', () => {
  let s = E.newState({ now: T, blank: true });
  assert.deepEqual(E.chipsOf(s.settings), []);                                              // a new kitchen gets no made-up names
  assert.deepEqual(E.chipsOf(E.newState({ now: T }).settings), C.quickNames);                // the demo and old kitchens keep the standard list
  assert.equal(E.CHIP_MAX, 12); assert.equal(E.CHIP_LEN, 24);
  const bakery = ['Counter', 'Pickup', 'Order 1'];
  s = ok(E.apply(s, 'setChips', { chips: ['  Counter ', 'Pickup', 'Order  1'] }, T), 'set');
  assert.deepEqual(E.chipsOf(s.settings), bakery); assert.deepEqual(s.settings.service.chips, bakery);   // tidied
  assert.equal(E.apply(s, 'setChips', { chips: bakery }, T).report, 'nothingToDo');
  const none = ok(E.apply(s, 'setChips', { chips: [] }, T + 1), 'none');
  assert.deepEqual(E.chipsOf(none.settings), []);                                           // a truck: no chips
  const back = ok(E.apply(none, 'setChips', { chips: null }, T + 2), 'default again');
  assert.deepEqual(E.chipsOf(back.settings), C.quickNames); assert.equal('chips' in back.settings.service, false);
  // validation
  const bad = (chips, code) => assert.equal(E.apply(s, 'setChips', { chips }, T).report, code, JSON.stringify(chips));
  bad('Counter', 'badPatch'); bad(undefined, 'badPatch'); bad([5], 'badPatch'); bad([''], 'outOfBounds'); bad(['a', 'A'], 'badPatch'); bad(['bad\u0001'], 'badPatch');
  bad(Array.from({ length: 13 }, (_, i) => 'Chip ' + i), 'outOfBounds'); bad(['x'.repeat(25)], 'outOfBounds');
  assert.equal(E.apply(s, 'setChips', { chips: Array.from({ length: 12 }, (_, i) => 'Chip ' + i) }, T).report, 'ok');
  assert.equal(E.apply(s, 'setChips', { chips: ['x'.repeat(24)] }, T).report, 'ok');
  // the same through the settings patch (not undoable)
  const viaPatch = ok(settingsPatch(s, { service: { chips: ['Phone', 'Delivery'] } }), 'patch');
  assert.deepEqual(E.chipsOf(viaPatch.settings), ['Phone', 'Delivery']);
  assert.equal(settingsPatch(s, { service: { chips: ['Phone', 'phone'] } }).report, 'badPatch');
  assert.equal(settingsPatch(s, { service: { chips: bakery } }).report, 'nothingToDo');
  // undo
  const u = ok(E.apply(s, 'undo', {}, T + 500), 'undo'); assert.deepEqual(E.chipsOf(u.settings), []);   // back to the new kitchen's empty list
  const s2 = ok(E.apply(s, 'setChips', { chips: ['Only'] }, T + 600), 'again');
  assert.deepEqual(E.chipsOf(ok(E.apply(s2, 'undo', {}, T + 700), 'undo 2').settings), bakery);
  const moved = ok(settingsPatch(s2, { service: { chips: ['Other'] } }, T + 800), 'changed elsewhere');
  assert.equal(E.apply(moved, 'undo', {}, T + 900).report, 'undoConflict');
  // backups keep them, and a damaged list in a backup is reset, not trusted
  const v = E.validateBackup(E.serialize(s)); assert.deepEqual(v.repaired, []); assert.deepEqual(v.state.settings.service.chips, bakery);
  const dam = JSON.parse(E.serialize(s)); dam.settings.service.chips = ['a', 'a', 5];
  const v2 = E.validateBackup(JSON.stringify(dam)); assert.equal(v2.ok, true); assert.ok(v2.repaired.some((r) => /chips/.test(r))); assert.equal('chips' in v2.state.settings.service, false);
  assert.deepEqual(E.checkInvariants(s, T), []);
});

/* ------------------------------ currency ------------------------------ */

test('the currency symbol: one formatter, a short allowed list, a custom 1 to 3 character symbol', () => {
  try {
    assert.equal(U.currencySymbol(), '$'); assert.equal(U.fmtMoney(1234.5), '$1,234.50'); assert.equal(U.fmtMoney(-5), '-$5.00');
    for (const [sym, text] of [['€', '€1,234.50'], ['£', '£1,234.50'], ['KSh', 'KSh1,234.50'], ['Rs', 'Rs1,234.50'], ['R$', 'R$1,234.50'], ['¥', '¥1,234.50']]) { assert.equal(U.setCurrency(sym), sym); assert.equal(U.fmtMoney(1234.5), text, sym); }
    assert.equal(U.fmtMoney(-5), '-¥5.00'); assert.equal(U.fmtMoney(1234.5, 0), '¥1,235'); assert.equal(U.fmtMoney(null), '-');
    for (const bad of ['', 'abcd', '1', '<b>', ' $', '$$$$', 5, null, undefined, '"', 'a b']) { assert.equal(U.validCurrency(bad), false, String(bad)); assert.equal(U.setCurrency(bad), '$'); }
    U.setCurrency('€');
    assert.equal(U.parseDollars('€3.50'), 3.5); assert.equal(U.parseDollars('3.5'), 3.5); assert.ok(Number.isNaN(U.parseDollars('abc')));
    U.setCurrency('$'); assert.equal(U.parseDollars('$3'), 3);
  } finally { U.setCurrency('$'); }
});

test('settings.ui.currency is validated, saved, restored on start and shown by every money formatter', () => {
  clock = T;
  try {
    let s = E.newState({ now: T, blank: true });
    assert.equal(E.defaultSettings().ui.currency, undefined);                              // absent means $
    for (const good of ['$', '€', '£', 'KSh', 'R']) assert.equal(settingsPatch(s, { ui: { currency: good } }).report, 'ok', good);
    for (const bad of ['', 'abcd', 5, null, '1', '<']) assert.equal(settingsPatch(s, { ui: { currency: bad } }).report, 'badPatch', String(bad));
    const b = backend(); start(b);
    assert.equal(S.dispatch('updateSettings', { patch: { ui: { currency: '€' } } }), 'ok');
    assert.equal(U.fmtMoney(3), '€3.00'); S.flush(); S.destroy();
    U.setCurrency('$');
    start(b);
    assert.equal(U.currencySymbol(), '€');                                                // restored from the saved kitchen
    assert.equal(MI.parse('Pie, €4.50\n').rows[0].price, 4.5); assert.equal(MI.parse('Pie €4,50\n').rows[0].price, 4.5);                           // the importer reads it
    assert.match(MI.parse('Pie, 0\n').rows[0].problems[0].message, /€0\.00/);
    U.setCurrency('KSh'); assert.equal(MI.parse('Pie, KSh 4\n').rows[0].price, 4); U.setCurrency('€');
    // exports stay plain digits
    S.dispatch('addMenuItem', { name: 'Pie', zone: 'cold', cat: 'cold', price: 4, prepSec: 30, track: 'one' });
    S.dispatch('createTicket', { customer: 'a', channel: 'dine_in', items: [{ menuId: 'pie', qty: 1 }] });
    S.dispatch('payOrder', { orderId: 'o_1', method: 'cash', tip: 1 });
    for (const kind of ['tickets', 'orders', 'batches']) { const csv = S.exportCsv(kind); if (csv) assert.equal(/[€$£]/.test(csv), false, kind); }
    assert.equal(JSON.parse(S.exportAll()).state.orders[0].totals.total, 4);               // a backup holds numbers; the symbol is only in the settings
    S.destroy();
    const j = JSON.parse(backendText(b)); assert.equal(j.state.settings.ui.currency, '€');
    // a damaged saved symbol falls back to $
    const dam = JSON.parse(backendText(b)); dam.state.settings.ui.currency = 'way too long';
    const v = E.validateBackup(JSON.stringify(dam)); assert.equal(v.ok, true); assert.ok(v.repaired.some((r) => /currency/.test(r))); assert.equal(U.setCurrency(v.state.settings.ui.currency), '$');
  } finally { U.setCurrency('$'); S.destroy(); }
});
const backendText = (b) => b.m.get('smokebox.v1.state');

test('new settings leave today\'s defaults and start states unchanged', () => {
  const d = E.defaultSettings();
  assert.deepEqual([d.service.counter, d.service.chips, d.ui.currency], [undefined, undefined, undefined]);
  assert.equal(E.counterOn(d), false);
});

test('meal pacing is on for a new empty kitchen and unchanged for existing kitchens', () => {
  clock = T;
  assert.equal(E.newState({ now: T, blank: true }).settings.pacing.enabled, true);
  assert.equal(E.newState({ now: T }).settings.pacing.enabled, true);                       // the sample and old kitchens
  const old = JSON.parse(JSON.stringify(E.newState({ now: T })));                           // an existing saved kitchen keeps its choice
  old.settings.pacing.enabled = true;
  assert.equal(E.validateBackup(JSON.stringify(old)).state.settings.pacing.enabled, true);
  old.settings.pacing.enabled = false;
  assert.equal(E.validateBackup(JSON.stringify(old)).state.settings.pacing.enabled, false);
  const b = backend(); start(b);
  try {
    S.dispatch('updateSettings', { patch: { pacing: { enabled: false } } });                 // the owner turns it off
    assert.equal(S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: S.START_OVER_WORD, keepSettings: true }).ok, true);
    assert.equal(S.getState().settings.pacing.enabled, false);                               // kept with the settings
    assert.equal(S.startOver({ backupSaved: { filename: 'b.json', chars: 1 }, confirm: S.START_OVER_WORD, keepSettings: false }).ok, true);
    assert.equal(S.getState().settings.pacing.enabled, true);                                // a fresh start is on again
  } finally { S.destroy(); }
});
