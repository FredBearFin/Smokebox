// WHAT THIS FILE IS: Builds a busy own kitchen with the real engine, for timing the back office at real volume:
// buildBig({ tickets, days, seed }) gives a state with about `tickets` paid tickets spread over `days` service days,
// with voids, discounts, tips, three payment methods, five stations and temperature and batch records.
// Used by test/office-volume.test.mjs and tools/volume-browser.mjs.
import { loadSB } from './_load.mjs';

// A small seeded random generator so every run builds the same kitchen.
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

// Builds the kitchen. The last day is `endDay` (default 2026-10-20). Returns { SB, state, now }.
export async function buildBig({ tickets = 3000, days = 90, seed = 7, endDay = new Date(2026, 9, 20, 0, 0, 0).getTime(), uncap = false } = {}) {
  const SB = await loadSB(['00-util', '10-config', '20-engine']);
  const E = SB.engine, r = rng(seed);
  if (uncap) Object.assign(SB.config.limits, { maxTickets: 1e6, maxEvents: 1e7, maxOrders: 1e6 });
  const start = new Date(endDay); start.setDate(start.getDate() - (days - 1)); start.setHours(8, 0, 0, 0);
  let now = start.getTime();
  let s = E.newState({ now, blank: true });
  s.settings.pacing.enabled = false;   // these scenarios start every dish at once; they test reports, not pacing
  // Applies one engine action at a later moment; throws when the engine refuses.
  const go = (type, p, at) => { if (at > now) now = at; const res = E.apply(s, type, p, now); if (res.report !== 'ok') throw new Error(type + ' ' + res.report); s = res.state; return res; };
  go('updateSettings', { patch: { service: { taxRatePct: 7.25 }, modules: { cookAhead: true } } }, now + 1000);
  const zones = ['pit', 'fry', 'cold', 'pit', 'fry', 'cold', 'pit', 'fry'];
  const ids = zones.map((z, i) => go('addMenuItem', { name: 'Dish ' + (i + 1), zone: z, cat: 'meat', price: 6 + i * 1.35 + 0.07 * i, prepSec: 120 + 60 * (i % 4), track: 'one', prepGuess: false }, now + 1000).info.id);
  // Two cooked-ahead proteins (hot hold) so the safety and stock pages have batches, readings, pulls and discards to show.
  const ings = ['Brisket', 'Pulled pork'].map((name, i) => go('addIngredient', { name, tcs: true, hold: 'hot', maxHoldH: 8, costPerKg: 9 + 4 * i, parG: 8000, pullG: 1500, thresholdG: 700 }, now + 1000).info.id);
  const perDay = Math.max(1, Math.round(tickets / days));
  for (let d = 0; d < days; d++) {
    const day = new Date(start); day.setDate(start.getDate() + d); day.setHours(0, 0, 0, 0);
    const n = Math.max(1, Math.round(perDay * (0.6 + 0.8 * r())));
    // opening times through the day, sorted
    const times = [];
    for (let k = 0; k < n; k++) times.push(day.getTime() + (11 + r() * 9) * 3600e3);
    times.sort((a, b) => a - b);
    // One morning cook and one afternoon cook per protein: readings, a sanitize round, pulls and a late discard.
    for (const ing of ings) {
      const at = day.getTime() + 9 * 3600e3;
      let b;
      try { b = go('addBatch', { ing, tempF: 160, cookedG: 9000 }, at).info.batchId; } catch (e) { b = null; }
      if (!b) continue;
      try {
        go('logTemp', { batchId: b, tempF: 150 + Math.floor(r() * 10) }, at + 3 * 3600e3);
        go('pullBatch', { ing, g: 1500 + Math.floor(r() * 500) }, at + 4 * 3600e3);
        go('sanitizeDone', { who: 'JM' }, at + 5 * 3600e3);
        if (r() < 0.3) go('discardBatch', { batchId: b, reason: 'quality' }, at + 11 * 3600e3);
      } catch (e) { /* a refusal here only thins the data */ }
    }
    for (const t0 of times) {
      const items = [];
      for (let i = 0, m = 1 + Math.floor(r() * 3); i < m; i++) items.push({ menuId: ids[Math.floor(r() * ids.length)], qty: 1 + Math.floor(r() * 2) });
      let res;
      try { res = go('createTicket', { customer: 'C' + Math.floor(r() * 99), channel: ['dine_in', 'takeout', 'drive_thru', 'third_party'][Math.floor(r() * 4)], items, allowPast: true }, t0); } catch (e) { (globalThis.__refused = globalThis.__refused || {})[String(e.message)] = (globalThis.__refused[String(e.message)] || 0) + 1; continue; }
      const oid = res.info.orderId, tk = s.tickets[s.tickets.length - 1];
      if (r() < 0.04) { try { go('voidTicket', { ticketId: tk.id, reason: 'test' }, now + 5000); go('voidOrder', { orderId: oid, reason: 'test' }, now + 6000); } catch (e) { /* stays */ } continue; }
      for (const it of tk.items) for (let g = 0; g < 2; g++) { const cur = s.tickets.find((x) => x.id === tk.id).items.find((x) => x.id === it.id); if (cur.status !== 'done') go('advanceItem', { ticketId: tk.id, itemId: it.id }, now + (60 + r() * 400) * 1000); }
      go('bumpTicket', { ticketId: tk.id }, now + 5000);
      const sub = tk.items.reduce((a, it) => a + it.price * it.qty, 0);
      go('payOrder', { orderId: oid, method: ['cash', 'card', 'other'][Math.floor(r() * 3)], tip: r() < 0.6 ? Math.round(sub * 0.15 * 100) / 100 : 0, discount: r() < 0.1 ? 1 : 0 }, now + 20000);
    }
  }
  return { SB, state: s, now };
}
