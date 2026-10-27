// History fill: how full the saved history is, the calm card and one-time notices before anything is dropped, days dropped to make room,
// the adaptive keep window of Close the month, and the browser's "keep my data" request.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadSB, ROOT } from './_load.mjs';
import { runEndurance } from '../tools/endurance.mjs';

const SB = await loadSB(['00-util', '10-config', '20-engine', '30-store']);
const E = SB.engine, S = SB.store;
const T0 = new Date(2026, 9, 20, 12, 0, 0).getTime(), DAY = 24 * 3600e3;

// A memory storage like the browser's, with a size limit on the characters it holds.
function capStorage(limit) {
  const m = new Map(); let total = 0;
  return {
    persistent: true, m,
    get(k, fb) { const raw = m.get(k); if (raw == null) return fb; try { return JSON.parse(raw); } catch (e) { return fb; } },
    raw(k) { return m.has(k) ? m.get(k) : null; },
    set(k, v) { const t = JSON.stringify(v); const next = total - (m.has(k) ? m.get(k).length : 0) + t.length; if (next > limit) { const e = new Error('Quota'); e.name = 'QuotaExceededError'; throw e; } m.set(k, t); total = next; return true; },
    remove(k) { if (m.has(k)) { total -= m.get(k).length; m.delete(k); } }, keys() { return [...m.keys()]; },
  };
}
// Starts the store as a real kitchen with a plain dish, and returns a way to sell dishes at later times.
function start(storage, quotaBytes) {
  const clock = { t: T0 };
  S.init({ now: () => clock.t, storage, noTimers: true, noSync: true, mode: 'real', blank: true, quotaBytes });
  S.dispatch('addMenuItem', { name: 'Plain', zone: 'pit', cat: 'meat', price: 5, prepSec: 60, track: 'one', prepGuess: false });
  const dish = S.lastResult().info.id;
  const sell = (n) => { for (let i = 0; i < n; i++) { clock.t += 20000; S.dispatch('createTicket', { customer: 'C' + i, items: [{ menuId: dish }] }); const oid = S.lastResult().info.orderId; const tk = S.getState().tickets[S.getState().tickets.length - 1]; clock.t += 20000; S.dispatch('advanceItem', { ticketId: tk.id, itemId: tk.items[0].id }); S.dispatch('advanceItem', { ticketId: tk.id, itemId: tk.items[0].id }); S.dispatch('bumpTicket', { ticketId: tk.id }); S.dispatch('payOrder', { orderId: oid, method: 'cash' }); } S.flush(); };
  return { clock, sell };
}

test('adaptive keep window: a quiet kitchen keeps 35 days, a busy one fewer, never fewer than 3', () => {
  const s = E.newState({ now: T0, blank: true });
  s.settings.pacing.enabled = false;   // the busy days start every dish at once
  assert.equal(E.adaptiveKeepDays(s, T0, null), 35, 'no history');
  // 10 days with 200 tickets a day and the browser space nearly used
  const day0 = new Date(T0 - 9 * DAY);
  const fake = Object.assign({}, s, { tickets: Array.from({ length: 2000 }, (_, i) => ({ id: 't' + i, serviceDate: E.__noop || new Date(day0.getTime() + Math.floor(i / 200) * DAY).toISOString().slice(0, 10), status: 'bumped', items: [] })), events: Array.from({ length: 16000 }, (_, i) => ({ id: 'e' + i, t: T0, type: 'x' })) });
  const k = E.adaptiveKeepDays(fake, T0, { bytes: 4.5e6, quotaBytes: 5e6 });
  assert.ok(k >= 3 && k <= 6, 'busy kitchen keeps few days: ' + k);
  assert.equal(E.adaptiveKeepDays(fake, T0, { bytes: 1e5, quotaBytes: 5e6 }) <= 35, true);
  const quiet = Object.assign({}, s, { tickets: fake.tickets.slice(0, 100), events: fake.events.slice(0, 800) });
  assert.equal(E.adaptiveKeepDays(quiet, T0, { bytes: 2e5, quotaBytes: 5e6 }), 35);
});

test('historyFill: the percent of the tightest limit, near full at 70, warn at 85; the board notice shows once', () => {
  const storage = capStorage(1e9);
  const { sell } = start(storage, 1e9);
  sell(30);
  const used = S.historyFill().bytes;
  assert.ok(used > 0);
  S.destroy();
  // the same kitchen against a browser quota just above what it uses
  for (const [factor, near, warn] of [[3, false, false], [1.3, true, false], [1.1, true, true]]) {
    const st2 = capStorage(1e9);
    const { sell: sell2 } = start(st2, Math.round(used * factor));
    sell2(30);
    const f = S.historyFill();
    assert.equal(f.nearFull, near, 'factor ' + factor + ' pct ' + f.pct); assert.equal(f.warn, warn);
    assert.deepEqual(Object.keys(f).sort(), ['bytes', 'daysLeft', 'events', 'eventsCap', 'keepDays', 'nearFull', 'pct', 'persisted', 'quotaBytes', 'tickets', 'ticketsCap', 'trimmedSince', 'warn']);
    if (warn) {
      const n = S.historyNotice();
      assert.equal(n.kind, 'full'); assert.match(n.words, /^Your saved history is \d+% full\. Close the month/);
      assert.equal(S.historyNoticeSeen('full'), true);
      assert.equal(S.historyNotice(), null, 'shown once');
    } else assert.equal(S.historyNotice(), null);
    S.destroy();
  }
});

test('days dropped to make room are counted, told once, and carried into the dataset; Close the month is not counted as a drop', () => {
  const storage = capStorage(250000);
  const { clock, sell } = start(storage, 250000);
  for (let d = 0; d < 6; d++) { clock.t += DAY; sell(25); }
  const f = S.historyFill();
  assert.ok(f.trimmedSince && f.trimmedSince.days >= 1, JSON.stringify(f));
  assert.match(f.trimmedSince.droppedBefore, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(S.dataset().droppedBefore, f.trimmedSince.droppedBefore);
  const n = S.historyNotice();
  assert.equal(n.kind, 'trimmed'); assert.match(n.words, /^Older history was dropped to make room: \d+ days?\. Close the month regularly/);
  S.historyNoticeSeen('trimmed');
  const nx = S.historyNotice();
  assert.ok(nx === null || nx.kind === 'full', 'only the full notice can come next');
  assert.equal(S.historyFill().trimmedSince, null);
  S.destroy();
});

test('the browser is asked to keep the data, and the answer is in historyFill().persisted', async () => {
  const calls = [];
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, navigator: { storage: { persisted: async () => false, persist: async () => { calls.push('persist'); return true; } } } };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['00-util.js', '10-config.js', '20-engine.js', '30-store.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f });
  const st = ctx.SB.store;
  st.init({ now: () => T0, storage: capStorage(1e9), noTimers: true, noSync: true, mode: 'real', blank: true });
  assert.equal(st.historyFill().persisted, null, 'not known yet');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls, ['persist']);
  assert.equal(st.historyFill().persisted, true);
  st.destroy();
});

test('at 250 tickets a day the nudge comes before anything is dropped, and Close the month every few days keeps it that way', { timeout: 120e3 }, async () => {
  const idle = await runEndurance({ kitchen: 'blank', seed: 1, days: 14, perDayFixed: 250, plain: true, quota: 2.5e6 });
  assert.deepEqual(idle.problems, []);
  assert.ok(idle.summary.firstNearFullDay !== null && idle.summary.firstTrimDay !== null, JSON.stringify(idle.summary));
  assert.ok(idle.summary.firstNearFullDay < idle.summary.firstWarnDay && idle.summary.firstWarnDay < idle.summary.firstTrimDay, 'the card (70) and the notice (85) come before the first drop: ' + JSON.stringify([idle.summary.firstNearFullDay, idle.summary.firstWarnDay, idle.summary.firstTrimDay]));
  const closed = await runEndurance({ kitchen: 'blank', seed: 1, days: 16, perDayFixed: 250, plain: true, quota: 2.5e6, closeMonthAt: [3, 6, 9, 12, 15] });
  assert.deepEqual(closed.problems, []);
  assert.equal(closed.summary.firstTrimDay, null, 'nothing was dropped');
  assert.ok(closed.summary.prunedByCloseMonth > 0 && closed.notes.some((n) => /day 15: Close the month removed/.test(n)), 'day 15 cleared days: ' + closed.notes.join(' | '));
  assert.ok(Math.max(...closed.rows.map((r) => r.pct)) < 90);
});
