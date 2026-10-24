// Second review round, store: start over also drops the copy kept from before a repair at load, and clearing live data or starting over
// never shows up later as "older history was dropped" (even after a reload).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSB } from './_load.mjs';

const SB = await loadSB(['00-util', '10-config', '13-menu-import', '20-engine', '30-store']);
const { store: S } = SB;
const T = 1780326000000, MIN = 60e3, DAY = 24 * 3600e3;
let clock = T;
// An in-memory stand-in for the browser's storage that the store can use.
function backend(entries) {
  const m = new Map(Object.entries(entries || {}));
  return { m, persistent: true, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), raw: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, JSON.stringify(v)); return true; }, remove: (k) => { m.delete(k); }, keys: (p) => Array.from(m.keys()).filter((k) => k.indexOf(p) === 0) };
}
const start = (b) => S.init({ storage: b, mode: 'real', blank: false, starter: true, noTimers: true, noSync: true, now: () => clock });
// Sells one tea now and finishes it, so the save holds a ticket of today's service day.
function sale() {
  S.dispatch('createTicket', { customer: 'g', channel: 'dine_in', items: [{ menuId: 'tea', qty: 1 }] });
  const tk = S.getState().tickets.at(-1);
  S.dispatch('completeItem', { ticketId: tk.id, itemId: tk.items[0].id }); S.dispatch('bumpTicket', { ticketId: tk.id });
  S.flush();
}
const histDays = (b) => (b.get('smokebox.v1.histtrim', null) || { days: 0 }).days;

test('Cleo 2: while a before-restore copy is kept, the 6-hour copy still refreshes, and a damaged save comes back from the newer one', () => {
  clock = T;
  const b = backend();
  start(b);
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 5 } } });
  const backup = S.exportAll();
  S.dispatch('updateSettings', { patch: { service: { taxRatePct: 9 } } });
  assert.equal(S.importAll(backup), 'ok');                    // keeps the tax-9 kitchen as the before-restore copy
  clock += 8 * 3600e3; S.dispatch('updateSettings', { patch: { service: { taxRatePct: 6 } } }); S.flush();
  assert.equal(b.get('smokebox.v1.lastgood', null).reason, 'before restore', 'the way back is untouched');
  assert.equal(b.get('smokebox.v1.lastgood2', null).state.settings.service.taxRatePct, 6, 'the rolling copy is fresh');
  S.destroy && S.destroy();
  b.m.set('smokebox.v1.state', '{"damaged": true');               // the live save is damaged
  clock += 3600e3;
  start(b);
  assert.equal(S.getState().settings.service.taxRatePct, 6, 'recovered from the copy taken 1 hour ago, not the one from before the restore');
  S.destroy && S.destroy();
});

test('Cleo 7: a second damaged save does not wipe the first damaged copy before anyone looked at it', () => {
  clock = T;
  const b = backend({ 'smokebox.v1.corrupt': JSON.stringify('first damaged text'), 'smokebox.v1.corruptat': JSON.stringify(T - DAY) });
  b.m.set('smokebox.v1.state', '{"second damaged');
  start(b);
  assert.equal(b.get('smokebox.v1.corrupt', null), '{"second damaged', 'the new damaged text is parked');
  assert.equal(b.get('smokebox.v1.corrupt.prev', null), 'first damaged text', 'the first one is kept behind it');
  assert.equal(b.get('smokebox.v1.corruptat.prev', null), T - DAY);
  S.destroy && S.destroy();
});

test('Cleo 5: after the device clock steps back an hour, the kitchen clock keeps moving instead of freezing for that hour', () => {
  clock = T;
  const b = backend();
  start(b);
  clock += 10 * MIN;
  const before = S.now();
  clock -= 3600e3;                                      // the device corrects its clock by an hour
  assert.equal(S.now(), before, 'never backwards');
  clock += 5 * MIN;
  assert.equal(S.now(), before + 5 * MIN, 'five real minutes later it is five minutes later');
  S.destroy && S.destroy();
});

test('Cleo 8: a copy another tab saved that this tab cannot read is set aside before this tab saves over it', () => {
  clock = T;
  const b = backend();
  start(b); sale();
  const newer = { v: 1, fmt: 9, p: 'a format from a newer build', savedAt: T };
  b.set('smokebox.v1.state', newer); b.set('smokebox.v1.sid', 'tab_other:7');   // another tab, another build
  clock += MIN; sale();
  assert.deepEqual(b.get('smokebox.v1.corrupt', null), newer, 'the other copy is kept');
  assert.ok(b.get('smokebox.v1.state', null).state, 'and this tab still saves its kitchen');
  S.destroy && S.destroy();
});

test('Cleo 3: start over also removes the copy kept from before a repair at load (it holds the whole old kitchen)', () => {
  clock = T;
  const b = backend({ 'smokebox.v1.dropped': JSON.stringify('{"old":"kitchen"}'), 'smokebox.v1.droppedat': JSON.stringify(T - DAY) });
  start(b); sale();
  assert.ok(b.m.has('smokebox.v1.dropped'), 'the copy is there before the erase');
  const r = S.startOver({ confirm: S.START_OVER_WORD, backupSaved: { filename: 'b.json', chars: 10 } });
  assert.equal(r.ok, true, r.report);
  assert.equal(b.m.has('smokebox.v1.dropped'), false);
  assert.equal(b.m.has('smokebox.v1.droppedat'), false);
  S.destroy && S.destroy();
});

test('Cleo 6: clearing live data is not counted later as history dropped for lack of space', () => {
  clock = T;
  const b = backend();
  start(b); sale();
  clock += 3 * DAY;
  assert.equal(S.resetLive({}), 'ok');
  clock += MIN; sale();
  assert.equal(histDays(b), 0, 'no days are reported as dropped');
  S.destroy && S.destroy();
});

test('Cleo 6: the same holds after a reload, when an earlier real trim left its oldest day in storage', () => {
  clock = T;
  const b = backend();
  start(b); sale();
  // an earlier trim for lack of space recorded 2 days, with the then-oldest day
  b.set('smokebox.v1.histtrim', { oldest: S.getState().tickets[0].serviceDate, days: 2, at: T, droppedBefore: S.getState().tickets[0].serviceDate });
  S.destroy && S.destroy();
  start(b);
  clock += 3 * DAY;
  assert.equal(S.resetLive({}), 'ok');
  S.destroy && S.destroy();
  start(b);                      // a reload in between
  clock += MIN; sale();
  assert.equal(histDays(b), 2, 'only the real trim is counted');
  S.destroy && S.destroy();
});
