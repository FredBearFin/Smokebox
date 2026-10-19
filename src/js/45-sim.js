/*
 * WHAT THIS FILE IS: the kitchen simulator (SB.sim): a 14-day sample history made by running the real engine
 *    on a fake clock with a simulated crew, plus live demo traffic. Needs no page, so Node can load it.
 * PARTS: 1 helpers, 2 hidden crew speeds, 3 orders, 4 day plan, 5 cook habits, 6 one day, 7 the fortnight,
 *    8 live demo traffic, 9 first-run tickets.
 * USES / USED BY: 00-util, 10-config, 20-engine, SB.store (parts 8, 9) / 30-store, Data page, shell, sim tests.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const C = SB.config;
  // The engine is looked up at call time so tests can swap it.
  const E = () => SB.engine;
  const Sim = (SB.sim = {});

  // Fixed seed: the same fortnight on every machine.
  const SEED = 20261017;
  // Length of the sample history in service days.
  const DAYS = 14;
  // Milliseconds in an hour, a minute and a second.
  const H = 3600e3, MIN = 60e3, SEC = 1000;
  // Where the on/off switch for the sample is kept in the browser notebook.
  const ENABLED_KEY = 'smokebox.v1.sample';
  // Sample records get ids far above anything a live state will reach, so a merged dataset never has two
  // tickets/events/batches with one id.
  const ID_BASE = 9000000;
  // Doors open at 11:00 and close at 21:00 (decimal hours).
  const OPEN_H = 11, CLOSE_H = 21;
  // True for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // Keeps n between lo and hi.
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // How a guest pays, worked out from the ticket id alone, so adding payments never reshuffles the random streams the
  // rest of the simulation uses. Gives the method, a tip and a discount in dollars, and how many seconds after the
  // ticket the bill is settled (at once at the counter, later at a table).
  function payPlan(key, channel, subtotal) {
    const r = U.rng(E().helpers.hashStr(key + '|pay'));
    const u = r.next();
    const method = channel === 'third_party' ? 'other' : u < 0.4 ? 'cash' : u < 0.97 ? 'card' : 'other';
    let tip = 0;
    if (channel !== 'third_party') {
      const dine = channel === 'dine_in';
      if (method === 'card') { if (r.chance(dine ? 0.78 : 0.35)) tip = Math.round(subtotal * r.range(dine ? 0.12 : 0.08, dine ? 0.22 : 0.18) * 4) / 4; }
      else if (method === 'cash' && r.chance(dine ? 0.4 : 0.12)) tip = r.pick([1, 2, 2, 3, 5]);
    }
    const discount = r.chance(0.03) ? Math.round(subtotal * 0.1 * 100) / 100 : 0;
    const delaySec = channel === 'dine_in' ? 600 + r.next() * 2400 : 0;
    return { method, tip, discount, delaySec };
  }

  /* ======================================================================================================
   * 1. Small helpers: time of day, random streams and a queue of future jobs
   * ==================================================================================================== */
  // Local epoch ms of `hour` (decimal) on service date `key`. Built with the Date constructor so a DST
  // change cannot shift it.
  function atHour(key, hour) {
    const p = key.split('-').map(Number);
    const h = Math.floor(hour), m = Math.round((hour - h) * 60);
    return new Date(p[0], p[1] - 1, p[2], h, m, 0, 0).getTime();
  }
  // Independent random streams per day and purpose, so changing one part of the model does not reshuffle
  // the others.
  const stream = (day, salt) => U.rng(((SEED + 1 + day * 100003 + salt * 7919) >>> 0));

  // A queue of future jobs, earliest first (ties keep the order they were added). Built as a binary heap:
  // a tree stored in a list where each parent is earlier than its children, so push and pop stay fast.
  function Heap() { this.a = []; this.n = 0; }
  const before = (x, y) => x.t < y.t || (x.t === y.t && x.s < y.s);
  // Adds job fn to run at time t (rounded to a whole millisecond, like a real clock).
  Heap.prototype.push = function (t, fn) {
    const e = { t: Math.round(t), s: this.n++, fn };
    const a = this.a; let i = a.length; a.push(e);
    while (i > 0) { const p = (i - 1) >> 1; if (!before(e, a[p])) break; a[i] = a[p]; i = p; }
    a[i] = e;
  };
  // The next job without removing it.
  Heap.prototype.peek = function () { return this.a[0]; };
  // How many jobs are still waiting to run.
  Heap.prototype.size = function () { return this.a.length; };
  // Removes and returns the next job.
  Heap.prototype.pop = function () {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      let i = 0; const n = a.length;
      for (;;) {
        const l = 2 * i + 1; if (l >= n) break;
        const r = l + 1; const c = r < n && before(a[r], a[l]) ? r : l;
        if (!before(a[c], last)) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return top;
  };

  /* ======================================================================================================
   * 2. The hidden truth about the line: what the crew really needs, which the app must discover by itself.
   *    Starter times in config are guesses; these factors are the gap analytics should find (SPEC 11, F-E7).
   * ==================================================================================================== */
  // How much slower (above 1) or faster (below 1) each dish really is than its starter time.
  const TRUE_FACTOR = {
    brisket_qtr: 1.10, brisket_half: 1.10, burnt_ends: 1.12, brisket_sand: 1.08,
    pork_qtr: 0.92, pork_half: 0.95, pork_sand: 0.97,
    ribs_half: 1.14, ribs_full: 1.10, sausage: 0.86, turkey_half: 1.02,
    mac: 1.30,          // 300 s starter, really about 6:30
    mac_lg: 1.22,
    beans: 0.90, cornbread: 1.05,
    fried_pickles: 0.75, // 360 s starter, really about 4:30
    hushpuppies: 0.93, slaw: 1.15, potato: 0.88, pudding: 1.10, tea: 0.95,
  };
  // The crew's true seconds for one unit of a dish. WATCH OUT: it starts from the starter time in config and
  // never reads the ticket's prepSec or the learned plan, or the app would learn from its own guesses (F-E7).
  function trueSec(menuId) {
    const mi = C.menuById[menuId];
    return mi.prepSec * (TRUE_FACTOR[menuId] || 1);
  }
  // Open lines each station handles comfortably; every extra open line slows the crew by 5 percent.
  const COMFORT = { pit: 4, sides: 4, fry: 3, cold: 6 };
  // Slow-down multiplier for a station with this many open lines (never more than 1.9 times).
  const loadFactor = (zone, open) => clamp(1 + 0.05 * Math.max(0, open - (COMFORT[zone] || 4)), 1, 1.9);

  // Seconds a cook takes to notice a new item: median 12 s with a long tail, slower when the station is
  // swamped.
  function responseSec(rng, open, rush) {
    const base = rng.logNormal(12, 0.85) * (1 + 0.035 * open) * (rush ? 0.55 : 1);
    return clamp(base, 2, 420);
  }
  // Seconds the crew really works on one line: true time, quantity scaling (the engine's own rule), random
  // scatter, station load and a day factor (storm days are slower).
  function workSec(rng, menuId, qty, zone, open, dayFactor, pacingCfg) {
    const scale = E().helpers.qtyScale(qty, pacingCfg);
    return Math.max(8, trueSec(menuId) * scale * rng.logNormal(1, 0.25) * loadFactor(zone, open) * dayFactor);
  }
  // Seconds the expo waits after the last item is done before bumping the ticket (5 to 40, usually about 15).
  const expoDelaySec = (rng) => clamp(rng.logNormal(15, 0.55), 5, 40);

  /* ======================================================================================================
   * 3. Orders: what people order and how they arrive. Everything here follows from the random stream given.
   * ==================================================================================================== */
  // Menu id and weight (how often it is chosen) for the main dish and for the sides of a basket.
  const MAINS = [['brisket_sand', 9], ['brisket_half', 7], ['brisket_qtr', 4], ['burnt_ends', 4.5], ['pork_sand', 8], ['pork_half', 4.5], ['pork_qtr', 3],
    ['ribs_half', 4], ['ribs_full', 0.9], ['sausage', 9.5], ['turkey_half', 4.5]];
  const SIDES = [['mac', 8], ['mac_lg', 1.4], ['beans', 8], ['cornbread', 9], ['fried_pickles', 8], ['hushpuppies', 6], ['slaw', 9], ['potato', 6.5]];
  // Chance of a basket having 1 to 5 lines, by channel (third-party orders are the biggest).
  const LINES_BY_CHANNEL = {
    dine_in:     [[1, 0.10], [2, 0.28], [3, 0.30], [4, 0.20], [5, 0.12]],
    takeout:     [[1, 0.08], [2, 0.24], [3, 0.30], [4, 0.22], [5, 0.16]],
    drive_thru:  [[1, 0.22], [2, 0.40], [3, 0.26], [4, 0.09], [5, 0.03]],
    third_party: [[1, 0.05], [2, 0.20], [3, 0.30], [4, 0.25], [5, 0.20]],
  };
  const FIRST_NAMES = ['Maria', 'Jake', 'Priya', 'Dev', 'Tanya', 'Luis', 'Chen', 'Ola', 'Sam', 'Rosa', 'Ben', 'Ines', 'Kofi', 'Amy', 'Ravi', 'Nora', 'Eli', 'Mina', 'Hank', 'Zoe'];
  const APPS = ['DoorDash', 'Uber Eats', 'Grubhub'];
  const ALLERGY_NOTES = ['Peanut allergy, separate tongs', 'Gluten allergy: no hush puppies, no bun', 'Dairy allergy, no mac or cornbread butter', 'Shellfish allergy, clean surface please', 'Sesame allergy, no bun'];
  const OTHER_NOTES = ['Extra napkins', 'Birthday, add a candle if you can', 'Sauce on the side', 'Pack sides separately', 'Cut sandwiches in half', 'Ready by 12:30 please', 'No plastic cutlery'];
  // What a cashier offers instead when a dish is 86'd.
  const SUBSTITUTE = {
    brisket_qtr: 'pork_qtr', brisket_half: 'pork_half', burnt_ends: 'pork_half', brisket_sand: 'pork_sand', pork_qtr: 'brisket_qtr', pork_half: 'brisket_half',
    pork_sand: 'brisket_sand', ribs_half: 'pork_half', ribs_full: 'ribs_half', sausage: 'pork_qtr', turkey_half: 'pork_half', mac: 'beans', mac_lg: 'beans', beans: 'mac',
    slaw: 'potato', potato: 'slaw', fried_pickles: 'hushpuppies', hushpuppies: 'fried_pickles', cornbread: 'hushpuppies',
  };
  // Demand by weekday (Sunday 0 to Saturday 6): Friday and Saturday are busier.
  const WEEKDAY_FACTOR = [1.02, 0.92, 0.95, 1.0, 1.05, 1.20, 1.31];
  // Tickets on an average weekday, before the weekday factor (a starter estimate to match a 150 to 190
  // ticket day).
  const BASE_TICKETS = 164;
  // How busy each quarter hour is from 11:00 to 20:45 (last orders at a quarter to nine), with a lunch peak
  // (12:00 to 13:30) and a dinner peak (17:30 to 19:30). The afternoon lull is kept shallow on purpose.
  const SLOTS = [0.7, 0.95, 1.3, 1.7, 2.1, 2.4, 2.55, 2.4, 2.2, 1.85, 1.4, 1.15, 1.0, 0.95, 0.9, 0.85, 0.85, 0.9, 0.95, 1.05, 1.15, 1.25, 1.4, 1.6,
    1.85, 2.1, 2.35, 2.5, 2.6, 2.55, 2.4, 2.25, 2.0, 1.75, 1.45, 1.2, 0.95, 0.75, 0.5];

  // Picks one id from a weighted list, leaving out ids already used in this basket.
  const pickW = (rng, list, skip) => rng.weighted(skip ? list.filter((x) => !skip[x[0]]) : list, (x) => x[1])[0];
  // How many of a dish one line asks for: mostly 1, more often 2 or 3 for takeout and third party, tea in
  // pairs.
  function qtyFor(rng, menuId, channel) {
    const bump = channel === 'third_party' ? 1.5 : channel === 'takeout' ? 1.2 : 1;
    const cat = C.menuById[menuId].cat;
    const r = rng.next();
    if (cat === 'cold' && menuId === 'tea') return r < 0.58 ? 1 : r < 0.84 ? 2 : r < 0.94 ? 3 : 4;
    if (r < 0.80 / bump) return 1;
    if (r < 0.95 / Math.sqrt(bump)) return 2;
    return rng.chance(0.6) ? 3 : 4;
  }
  // One time in ten a line carries a small request such as sauce on the side.
  function maybeMods(rng, menuId) {
    if (!rng.chance(0.10)) return undefined;
    const mi = C.menuById[menuId];
    const pool = mi.cat === 'sandwich' ? ['No pickles', 'Sauce on the side', 'Extra sauce'] : mi.cat === 'meat' ? ['Lean cut', 'Moist cut', 'Extra bark', 'Sauce on the side'] : menuId === 'slaw' ? ['No jalapenos'] : ['Sauce on the side'];
    return [rng.pick(pool)];
  }
  // One basket of 1 to 5 lines with realistic combos (plate, sandwich meal, or a main plus sides). It ignores
  // what is 86'd; the cashier deals with that when ringing the order in.
  function makeBasket(rng, channel) {
    const r = rng.next();
    if (channel !== 'third_party' && r < 0.06) return C.comboById.plate.lines.map((l) => ({ menuId: l.menu, qty: 1 }));
    if (r < 0.15) return C.comboById.sandy.lines.map((l) => ({ menuId: l.menu, qty: 1 }));
    const n = rng.weighted(LINES_BY_CHANNEL[channel], (x) => x[1])[0];
    const used = {}, lines = [];
    // Adds a dish to the basket and marks it used so it is not picked twice.
    const add = (id) => { used[id] = true; lines.push({ menuId: id, qty: qtyFor(rng, id, channel), mods: maybeMods(rng, id) }); };
    if (rng.chance(n === 1 ? 0.78 : 0.92)) add(pickW(rng, MAINS, used));
    else add(pickW(rng, SIDES, used));
    while (lines.length < n) {
      const q = rng.next();
      if (q < 0.12 && lines.filter((l) => C.menuById[l.menuId].zone === 'pit').length < 2) add(pickW(rng, MAINS, used));
      else if (q < 0.66) add(pickW(rng, SIDES, used));
      else if (q < 0.86 && !used.tea) add('tea');
      else if (q < 0.93 && !used.pudding) add('pudding');
      else add(pickW(rng, SIDES, used));
    }
    return lines.map((l) => (l.mods ? l : { menuId: l.menuId, qty: l.qty }));
  }
  // Picks dine-in, takeout, drive-thru or third party: about 38, 30, 20 and 12 percent, with drive-thru
  // stronger at lunch and apps stronger at dinner.
  function pickChannel(rng, hour) {
    const lunch = hour >= 11.5 && hour < 14, dinner = hour >= 17.5 && hour < 20;
    const w = { dine_in: 38, takeout: 30, drive_thru: 20 + (lunch ? 4 : 0) - (dinner ? 2 : 0), third_party: 12 + (dinner ? 4 : 0) - (lunch ? 2 : 0) };
    return rng.weighted(C.channels, (c) => w[c.id]).id;
  }
  // A believable name on the ticket: a table, a first name, a lane and car, or an app and order number.
  function customerFor(rng, channel) {
    if (channel === 'dine_in') return 'Table ' + rng.int(1, 12);
    if (channel === 'takeout') return rng.chance(0.3) ? 'Pickup' : rng.pick(FIRST_NAMES);
    if (channel === 'drive_thru') return 'Lane ' + rng.int(1, 2) + ' car ' + rng.int(1, 40);
    return rng.pick(APPS) + ' ' + rng.int(1000, 9999);
  }

  /* ======================================================================================================
   * 4. The plan for one service day: who orders what and when, and what the cook can forecast from it.
   *    Decided up front; the simulation then plays it through the engine. Knowing the demand curve lets us
   *    place the sell-outs where we want them (brisket 86 at 1:40 pm on the busiest day) without tuning.
   * ==================================================================================================== */
  // Ids of the foods that are cooked and held in the hot/cold cabinet (the ones with a hold limit).
  const TCS = C.ingredients.filter((i) => i.tcs).map((i) => i.id);
  // Plans one service day: the ticket count (weekday, storm or surge, small random scatter), the arrival
  // times, every ticket's basket and special event, and the grams of each held food ordered over time.
  function planDay(di, key, kind) {
    const wd = U.weekday(key);
    const A = stream(di, 1), B = stream(di, 2), M = stream(di, 3);
    const kindF = kind === 'storm' ? 0.65 : kind === 'surge' ? 1.40 : 1;
    const N = Math.round(BASE_TICKETS * WEEKDAY_FACTOR[wd] * kindF * A.logNormal(1, 0.045));
    // Lumpy on purpose: every quarter hour gets its own multiplier, plus one rush half hour and one dead
    // half hour.
    const w = SLOTS.map((s) => s * A.logNormal(1, 0.30));
    const peakAt = A.pick([5, 6, 7, 26, 27, 28, 29]);
    w[peakAt] *= 2.1; w[peakAt + 1] *= 1.9;
    const deadAt = A.pick([13, 14, 15, 16, 17, 21, 22, 35, 36]);
    w[deadAt] *= 0.45; w[deadAt + 1] *= 0.5;
    const cum = []; let tot = 0; for (const x of w) { tot += x; cum.push(tot); }
    const times = [];
    for (let i = 0; i < N; i++) {
      const u = A.next() * tot; let s = 0; while (s < cum.length - 1 && cum[s] < u) s++;
      times.push(OPEN_H + (s + A.next()) * 0.25);
    }
    times.sort((a, b) => a - b);
    // Build each ticket and add its grams to the running demand for the cook's forecast.
    const tickets = [];
    const demand = {}; for (const id of TCS) demand[id] = { ts: [], cum: [], total: 0 };
    for (let i = 0; i < N; i++) {
      const hour = times[i];
      const channel = pickChannel(B, hour);
      const lines = makeBasket(B, channel);
      const allergy = B.chance(0.03);
      let note = allergy ? B.pick(ALLERGY_NOTES) : B.chance(0.06) ? B.pick(OTHER_NOTES) : '';
      if (allergy) for (const l of lines) { l.mods = (l.mods || []).concat(['Allergy, see note']).slice(0, 3); }
      // At most one special thing happens to a ticket (void, recall, force-bump or an undo); the ranges
      // must not overlap (F-S1).
      const sp = M.next();
      const tp = { hour, t: atHour(key, hour) + Math.floor(M.next() * 59000), channel, customer: customerFor(B, channel), lines, note, rush: M.chance(0.02), special: null };
      if (sp < 0.015) tp.special = { kind: 'void', reason: M.weighted([['customer left', 4], ['wrong order', 4], ['dropped', 2], ['other', 1]], (x) => x[1])[0] };
      else if (sp < 0.03) tp.special = { kind: 'recall' };
      else if (sp < 0.065) { if (lines.length >= 2) tp.special = { kind: 'force' }; }
      else if (sp < 0.0685) tp.special = { kind: 'undoDone' };
      else if (sp < 0.071) tp.special = { kind: 'undoBump' };
      tp.fireNow = !tp.special && lines.length >= 2 && M.chance(0.06);
      tickets.push(tp);
      for (const l of lines) {
        const mi = C.menuById[l.menuId];
        for (const b of mi.bom) {
          const d = demand[b.ing]; if (!d) continue;
          d.total += b.qty * l.qty; d.ts.push(tp.t); d.cum.push(d.total);
        }
      }
    }
    // How far off the cook's own forecast is, per food and day (about 9 percent either way).
    const noise = {}; for (const id of TCS) noise[id] = M.logNormal(1, 0.09);
    return { index: di, date: key, weekday: wd, kind, N, tickets, demand, noise, sellOut: {}, dips: [], manual86: null, openMs: atHour(key, OPEN_H), closeMs: atHour(key, CLOSE_H) };
  }
  // Grams of one food ordered up to time t, as planned (before any 86 swap). Binary search over the running
  // total.
  function cumDemand(plan, ing, t) {
    const d = plan.demand[ing]; if (!d || !d.ts.length) return 0;
    let lo = 0, hi = d.ts.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (d.ts[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans < 0 ? 0 : d.cum[ans];
  }

  /* ======================================================================================================
   * 5. The cook's habits for the hold cabinet, in grams of cooked food. Every 3 minutes the cook checks each
   *    food and cooks a new pan when what can be served (above the 86 line) will not cover the next stretch.
   * ==================================================================================================== */
  // Per food: min and max pan size, urg = smallest emergency pan, lead = minutes of orders to cover, gap =
  // minutes between ordinary pans, cov and pad = extra cover (multiplier and grams), safe = share of
  // expected orders a pan is sized for (lower for slow movers). All starter estimates tuned to give 2 to 4
  // brisket pans a day.
  const COOK = {
    brisket: { min: 5600, max: 10500, urg: 2200, lead: 40, gap: 40, cov: 1.10, pad: 300, safe: 0.95 },
    pork:    { min: 3000, max: 7000, urg: 900, lead: 40, gap: 40, cov: 1.12, pad: 300, safe: 0.93 },
    ribs:    { min: 3200, max: 7500, urg: 1200, lead: 40, gap: 40, cov: 1.12, pad: 300, safe: 0.86 },
    sausage: { min: 1300, max: 2800,  lead: 40, gap: 45, cov: 1.2, pad: 250, safe: 0.8 },
    turkey:  { min: 1300, max: 3200,  lead: 40, gap: 50, cov: 1.2, pad: 250, safe: 0.78 },
    mac:     { min: 3200, max: 7000,  lead: 40, gap: 35, cov: 1.10, pad: 300, safe: 0.93 },
    beans:   { min: 2000, max: 4800,  lead: 40, gap: 40, cov: 1.12, pad: 300, safe: 0.84 },
    slaw:    { min: 1600, max: 3600,  lead: 40, gap: 45, cov: 1.15, pad: 250, safe: 0.86 },
    potato:  { min: 1400, max: 3200,  lead: 40, gap: 50, cov: 1.2, pad: 250, safe: 0.82 },
    pudding: { min: 1400, max: 3200,  lead: 40, gap: 50, cov: 1.2, pad: 250, safe: 0.82 },
  };

  // Foods recorded from raw weight (cooked weight = raw x yield, with a little real-world scatter).
  const FROM_RAW = { pork: 1, ribs: 1, sausage: 1, turkey: 1, slaw: 1 };

  /* ======================================================================================================
   * 6. One service day, played through its own private engine state on a virtual clock
   * ==================================================================================================== */
  function simulateDay(plan, carry) {
    const eng = E();
    const di = plan.index, date = plan.date;
    const R = stream(di, 4), K = stream(di, 5), X = stream(di, 6);
    const dayFactor = plan.kind === 'storm' ? 1.22 : plan.kind === 'surge' ? 1.05 : 1;
    const stateNow = atHour(date, 11);
    const closeMs = plan.closeMs, openMs = plan.openMs;
    const dayZero = atHour(date, 0);        // midnight; the cook's hour-of-day checks count from here
    let st = eng.newState({ now: stateNow, empty: true, learned: carry.learned, seq: carry.seq });
    // Shelf-stable stock opens at par each morning; hold-cabinet food starts empty because it is cooked
    // fresh.
    for (const ing of st.ingredients) if (!ing.tcs) { st.stock[ing.id] = ing.parG; st.ledger[ing.id].open = ing.parG; }
    { const av = eng.computeAvail(st); for (const k in av) av[k].since = stateNow; st.avail = av; }
    const ingById = {}; for (const i of st.ingredients) ingById[i.id] = i;
    const Q = new Heap();
    let clock = atHour(date, 9.5);          // the virtual clock; it only moves forward
    const pacingCfg = Object.assign({}, st.settings.pacing, { enabled: plan.pacing });
    const stat = { walked: 0, refused: 0, substituted: 0, undoDone: 0, undoBump: 0, forced: 0, recalled: 0, voided: 0, fireNow: 0, restocks: 0, dips: 0 };

    // Applies one engine action at virtual time t and keeps the new state only if the engine accepted it.
    // Returns the engine's own result so callers can see why it refused.
    function act(type, payload, t) {
      if (t > clock) clock = t;
      const r = eng.apply(st, type, payload, clock);
      if (r.report === 'ok') st = r.state;
      return r;
    }
    // Moves the virtual clock to t and lets the engine do whatever it owes by then (show paced items,
    // expire pans).
    function tickTo(t) {
      if (t > clock) clock = t;
      const r = eng.tick(st, clock);
      if (r.state !== st) st = r.state;
      // The crew throws out any pan that has gone past its quality limit rather than leaving it on the board.
      for (const b of st.batches) if (b.status === 'past') act('discardBatch', { batchId: b.id, reason: 'quality' }, clock);
    }
    // Next time the engine has something due on its own (paced item to show, channel sync to finish, hold
    // limit to pass).
    function nextDueAt() {
      const nd = eng._internal && eng._internal.nextDue ? eng._internal.nextDue(st) : null;
      if (!nd) return Infinity;
      return Math.min(nd.fs, isFinite(nd.bd) ? nd.bd + 1 : Infinity);
    }
    // Ticks the engine at each moment it has work due, up to limit, so nothing due is skipped when the
    // clock jumps.
    function catchUp(limit) {
      for (let guard = 0; guard < 400; guard++) {
        const d = nextDueAt();
        if (!(d > clock && d <= limit)) break;
        tickTo(Math.ceil(d));
      }
    }
    // Plays the queue of future jobs in time order until it is empty, catching the engine up before each job.
    function run() {
      while (Q.size()) {
        const ev = Q.peek();
        catchUp(ev.t - 1);
        Q.pop();
        if (ev.t > clock) clock = ev.t;
        ev.fn(clock);
      }
    }

    /* ---------- crew bookkeeping ---------- */
    const meta = new Map();
    const openZ = { pit: 0, sides: 0, fry: 0, cold: 0 };      // open lines per station, which slows the crew down
    const burn = {}; for (const id of TCS) burn[id] = { t: [], g: [], p: 0, sum: 0 };
    // Records the grams of each held food a finished line used, so the cook can feel how fast the shelf is
    // emptying.
    function noteUse(menuId, qty, now) {
      for (const b of C.menuById[menuId].bom) { const q = burn[b.ing]; if (q) { q.t.push(now); q.g.push(b.qty * qty); q.sum += b.qty * qty; } }
    }
    /** Grams per minute actually used over the last 30 minutes. */
    function burnPerMin(id, now) {
      const q = burn[id]; const cut = now - 30 * MIN;
      while (q.p < q.t.length && q.t[q.p] < cut) { q.sum -= q.g[q.p]; q.p++; }
      return q.sum / 30;
    }
    // Frees the station slot an item was holding so the next item finds a calmer station.
    const release = (im) => { if (im.open) { im.open = false; openZ[im.zone]--; } };

    // An item appears on the screen. The cook notices it after a reaction delay (shorter for one-step items).
    function show(m, i, now) {
      const im = m.items[i];
      if (im.shown || m.closed || im.done) return;
      im.shown = true; im.open = true; openZ[im.zone]++;
      const resp = responseSec(R, openZ[im.zone] - 1, m.rush) * (im.track === 'one' ? 0.45 : 1);
      Q.push(now + resp * SEC, (t) => begin(m, i, t));
    }
    // The cook starts the item (two-step items get a start tap first) and works for its true prep time.
    function begin(m, i, now) {
      const im = m.items[i];
      if (m.closed || im.done) return;
      if (im.track === 'two') {
        const r = act('advanceItem', { ticketId: m.id, itemId: im.id }, now);
        if (r.report !== 'ok') { release(im); return; }
      }
      const w = workSec(R, im.menuId, im.qty, im.zone, openZ[im.zone], dayFactor, pacingCfg) * (m.rush ? 0.85 : 1);
      Q.push(now + w * SEC, (t) => finish(m, i, t));
    }
    // The cook taps the item done. A few taps are undone a moment later, and the last item starts the expo
    // bump.
    function finish(m, i, now) {
      const im = m.items[i];
      if (m.closed || im.done) return;
      const r = act('advanceItem', { ticketId: m.id, itemId: im.id }, now);
      if (r.report !== 'ok') { release(im); return; }
      im.done = true; release(im); m.remaining--;
      noteUse(im.menuId, im.qty, now);
      const sp = m.tp.special;
      // An undo is only valid while this finish is still the newest undoable action, so check that before
      // using it.
      if (sp && sp.kind === 'undoDone' && !m.undoUsed) {
        m.undoUsed = true;
        const top = st.undo.length ? st.undo[st.undo.length - 1].id : null;
        Q.push(now + (1200 + X.next() * 3300), (t) => {
          if (m.closed || !top || !st.undo.length || st.undo[st.undo.length - 1].id !== top) return;
          const u = act('undo', {}, t);
          if (u.report !== 'ok') return;
          stat.undoDone++;
          im.done = false; im.open = true; openZ[im.zone]++; m.remaining++; m.bumpTok++;
          Q.push(t + (8 + X.next() * 17) * SEC, (t2) => finish(m, i, t2));
        });
      }
      if (m.remaining === 0) scheduleBump(m, now);
      else if (m.remaining === 1 && sp && sp.kind === 'force' && !m.forceTried) {
        m.forceTried = true;
        const tok = m.bumpTok;
        Q.push(now + (6 + X.next() * 16) * SEC, (t) => forceBump(m, tok, t));
      }
    }
    // Books the expo's bump after its delay. The token cancels it if an undo reopens an item in the meantime.
    function scheduleBump(m, now) {
      const tok = ++m.bumpTok;
      Q.push(now + expoDelaySec(X) * SEC, (t) => bump(m, tok, t));
    }
    // Bumps a finished ticket. Some tickets are then recalled or have the bump undone, as happens on a real
    // pass.
    function bump(m, tok, now) {
      if (m.closed || tok !== m.bumpTok || m.remaining !== 0) return;
      const r = act('bumpTicket', { ticketId: m.id }, now);
      if (r.report !== 'ok') return;
      m.closed = true;
      const sp = m.tp.special;
      if (sp && sp.kind === 'recall' && !m.recalled) {
        m.recalled = true;
        Q.push(now + (25 + X.next() * 155) * SEC, (t) => {
          const rr = act('recallTicket', { ticketId: m.id }, t);
          if (rr.report !== 'ok') return;
          stat.recalled++; m.closed = false;
          Q.push(t + (20 + X.next() * 70) * SEC, (t2) => { scheduleBump(m, t2); });
        });
      } else if (sp && sp.kind === 'undoBump' && !m.undoBumped) {
        m.undoBumped = true;
        const top = st.undo.length ? st.undo[st.undo.length - 1].id : null;
        Q.push(now + (1500 + X.next() * 2500), (t) => {
          if (!top || !st.undo.length || st.undo[st.undo.length - 1].id !== top) return;
          const u = act('undo', {}, t);
          if (u.report !== 'ok') return;
          stat.undoBump++; m.closed = false;
          Q.push(t + (4 + X.next() * 10) * SEC, (t2) => { scheduleBump(m, t2); });
        });
      }
    }
    // The expo bumps with one item still open, is refused, reports it, and forces the bump (counted as a
    // force).
    function forceBump(m, tok, now) {
      if (m.closed || m.remaining !== 1 || tok !== m.bumpTok) return;
      const r1 = act('bumpTicket', { ticketId: m.id }, now);
      if (r1.report === 'ok') { m.closed = true; return; }
      if (r1.report !== 'notAllDone') return;
      if (X.chance(0.8)) act('uiReport', { action: 'bumpTicket', report: 'notAllDone' }, now);
      const r = act('bumpTicket', { ticketId: m.id, force: true }, now + 1500);
      if (r.report !== 'ok') return;
      stat.forced++; m.closed = true;
      for (const im of m.items) release(im);
    }
    // The order is cancelled or wrong, so the ticket is voided and its stations are freed.
    function voidTicket(m, now) {
      if (m.closed) return;
      const r = act('voidTicket', { ticketId: m.id, reason: m.tp.special.reason }, now);
      if (r.report !== 'ok') return;
      // The bill goes with it: nothing is left on the order to pay.
      if (m.orderId) act('voidOrder', { orderId: m.orderId, reason: m.tp.special.reason }, now);
      stat.voided++; m.closed = true;
      for (const im of m.items) release(im);
    }

    /* ---------- ringing in an order (the cashier sees 86 and offers a swap) ---------- */
    // Takes an 86'd dish out of a basket, or swaps in a near substitute when the customer agrees (72
    // percent). Returns the new list of lines.
    function substitute(lines, menuId) {
      const idx = lines.findIndex((l) => l.menuId === menuId);
      if (idx < 0) return [];
      const out = lines.slice();
      const l = out[idx];
      const sub = SUBSTITUTE[menuId];
      const subOk = sub && st.avail[sub] && st.avail[sub].ok;
      if (subOk && X.chance(0.72)) {
        stat.substituted++;
        const j = out.findIndex((x) => x.menuId === sub);
        if (j >= 0) { out[j] = { menuId: sub, qty: Math.min(out[j].qty + l.qty, 8) }; out.splice(idx, 1); } else out[idx] = { menuId: sub, qty: l.qty };
      } else out.splice(idx, 1);
      return out;
    }
    // The cashier rings in a planned order. When the engine says a dish is 86'd the cashier offers a swap
    // or drops it and tries again (up to 6 times), or the guest walks away. Nothing is returned; it queues
    // the crew's work.
    function ringIn(tp, now) {
      let lines = tp.lines.map((l) => (l.mods ? { menuId: l.menuId, qty: l.qty, mods: l.mods.slice() } : { menuId: l.menuId, qty: l.qty }));
      let r = null;
      for (let attempt = 0; attempt < 6 && lines.length; attempt++) {
        r = act('createTicket', { customer: tp.customer, channel: tp.channel, items: lines, note: tp.note, rush: tp.rush, src: 'sample' }, now);
        if (r.report === 'ok') break;
        if (r.report !== 'itemUnavailable') { r = null; break; }
        stat.refused++;
        if (X.chance(0.7)) act('uiReport', { action: 'createTicket', report: 'itemUnavailable' }, now);
        lines = substitute(lines, r.info.menuId);
        r = null;
      }
      if (!r || r.report !== 'ok') { stat.walked++; return; }
      const tk = eng.findTicket(st, r.info.ticketId);
      const m = { id: tk.id, orderId: tk.orderId, tp, rush: tk.rush, remaining: tk.items.length, closed: false, bumpTok: 0,
        items: tk.items.map((it) => ({ id: it.id, menuId: it.menuId, zone: it.zone, qty: it.qty, track: it.track, shown: false, open: false, done: false })) };
      meta.set(tk.id, m);
      // The guest settles the bill (a ticket that is going to be voided never is paid).
      if (!(tp.special && tp.special.kind === 'void')) {
        const sub = eng.orderTotals(st, eng.findOrder(st, tk.orderId)).subtotal;
        const pl = payPlan(tk.id, tp.channel, sub);
        Q.push(now + pl.delaySec * SEC, (t) => { act('payOrder', { orderId: tk.orderId, method: pl.method, tip: pl.tip, discount: pl.discount }, t); });
      }
      // Items the engine shows now start at once; held (paced) ones start when their fire time comes.
      for (let i = 0; i < tk.items.length; i++) {
        const it = tk.items[i];
        if (it.status === 'displayed') show(m, i, now);
        else Q.push(it.fireAt, (t) => { tickTo(t); show(m, i, t); });
      }
      const sp = tp.special;
      if (sp && sp.kind === 'void') {
        const delay = sp.reason === 'dropped' ? 150 + X.next() * 240 : sp.reason === 'wrong order' ? 20 + X.next() * 80 : 45 + X.next() * 200;
        Q.push(now + delay * SEC, (t) => voidTicket(m, t));
      }
      // A guest asks for a held item to be fired early (the "fire now" button).
      if (tp.fireNow) {
        Q.push(now + (8 + X.next() * 32) * SEC, (t) => {
          if (m.closed) return;
          let pick = -1;
          for (let i = 0; i < m.items.length; i++) if (!m.items[i].shown && !m.items[i].done) { pick = i; break; }
          if (pick < 0) return;
          const rr = act('fireNow', { ticketId: m.id, itemId: m.items[pick].id }, t);
          if (rr.report === 'ok') { stat.fireNow++; show(m, pick, t); }
        });
      }
    }

    /* ---------- the hold cabinet ---------- */
    const lastAdd = {}, cooked = {}, ready = {};       // per food: last pan time, grams cooked today, first pan time
    for (const id of TCS) { lastAdd[id] = -Infinity; cooked[id] = 0; ready[id] = atHour(date, 10) + K.range(5, 45) * MIN; }
    // Grams of a food the cook expects to be ordered between t0 and t1: the real plan times the cook's own
    // error.
    const forecast = (id, t0, t1) => (cumDemand(plan, id, t1) - cumDemand(plan, id, t0 - 1)) * plan.noise[id];
    // Finds a pan by id (newest first); null when there is none.
    const batchOf = (id) => { for (let i = st.batches.length - 1; i >= 0; i--) if (st.batches[i].id === id) return st.batches[i]; return null; };

    // Books a pan's next temperature check about one check interval out. Some come late and some are skipped,
    // as in a real kitchen. The gaps scale with the interval in the safety settings.
    function scheduleTemp(batchId, from) {
      const iv = C.safety.tempCheckEveryMin, k = iv / 30;
      let gap = iv - K.range(1.5, 7) * k;
      const u = K.next();
      if (u < 0.045) gap = iv + K.range(3, 22) * k;          // a late check
      else if (u < 0.065) gap = 1.5 * iv + K.range(3, 14) * k; // a missed check: the next reading is half an interval later still
      if (from + gap * MIN > closeMs + 5 * MIN) return;             // the crew stops walking the cabinet once the doors are shut
      Q.push(from + gap * MIN, (t) => tempCheck(batchId, t));
    }
    // Takes and logs a pan's temperature, then books the next one. Gone, empty or pulled-out pans are left
    // alone.
    function tempCheck(batchId, now) {
      if (now > closeMs + 5 * MIN) return;
      const b = batchOf(batchId);
      if (!b || b.status === 'discard' || !(b.remainingG > 0) || b.outSince != null) return;
      const f = b.kind === 'cold' ? clamp(K.normal(38, 1.3), 34, 40.4) : clamp(K.normal(150, 4.5), 138, 167);
      act('logTemp', { batchId, tempF: Math.round(f) }, now);
      scheduleTemp(batchId, now);
    }
    // Cooks a pan of about `size` grams and loads it into the cabinet (brisket and the raw-weight foods are
    // logged from raw weight). Returns the new batch id, or null if the engine refused.
    function addBatchNow(id, size, now) {
      const ing = ingById[id];
      const hot = ing.hold !== 'cold';
      const p = { ing: id, tempF: Math.round(hot ? K.range(158, 176) : K.range(36, 39.5)), src: 'sample' };
      if (id === 'brisket') {
        const endpointC = clamp(Math.round(K.normal(85, 2.2)), 80, 90);
        const holdH = Math.round(K.range(1, 2.5) * 4) / 4;
        const ty = eng.thermalYield({ endpointC, holdH });
        p.rawG = Math.round(size / (ty.hotPct / 100) / 10) * 10; p.endpointC = endpointC; p.holdH = holdH;
        p.cookedG = Math.round(p.rawG * (ty.hotPct / 100) * K.logNormal(1, 0.035));
      } else if (FROM_RAW[id]) {
        p.rawG = Math.round(size / ing.yield / 10) * 10;
        p.cookedG = Math.round(p.rawG * ing.yield * K.logNormal(1, 0.035));
      } else p.cookedG = Math.round(size / 10) * 10;
      const r = act('addBatch', p, now);
      if (r.report !== 'ok') return null;
      cooked[id] += p.cookedG; lastAdd[id] = now;
      scheduleTemp(r.info.batchId, now);
      return r.info.batchId;
    }
    // Grams already on the shelf that will actually be sold: pans are used oldest first, and a pan cannot
    // sell more than is ordered before its own hold limit, so food that is bound to expire does not count
    // towards the next pan.
    function sellableOnShelf(id, from) {
      const pans = st.batches.filter((b) => b.ing === id && b.status !== 'discard' && b.remainingG > 0 && b.kind !== 'cooling');
      pans.sort((a, b) => a.enteredAt - b.enteredAt);
      let used = 0;
      for (const b of pans) {
        const until = Math.min(b.enteredAt + b.maxHoldH * H, closeMs);
        const room = Math.max(0, forecast(id, from, until) - used);
        used += Math.min(b.remainingG, room);
      }
      return used;
    }
    // The cook cooks when what the line can serve (above the 86 line) will not last the lead time, and
    // sizes the batch to what will be ordered over the next stretch, but never more than can be sold before
    // the 4-hour hold limit runs out.
    function considerBatch(id, now) {
      const S = COOK[id]; const ing = ingById[id];
      if (now < ready[id]) return;
      const hour = (now - dayZero) / H;
      const thr = ing.thresholdG;
      // a pan waiting for its reheat is still on the line as far as the cook is concerned; only a
      // thrown-out pan is gone
      let have = eng.servable(st, id);
      for (const b of st.batches) if (b.ing === id && b.status === 'reheat' && b.remainingG > 0) have += b.remainingG;
      const spare = have - thr;
      const win0 = Math.max(now, openMs);
      // what the next stretch will take: the forecast, nudged up when the line has been burning faster than
      // expected (but never chasing a rush that is over) When people are being steered onto this food
      // (something else is 86'd) the line burns faster than the forecast says; the cook sees it and scales
      // up.
      const adj = clamp((burnPerMin(id, now) * 30 + 150) / (forecast(id, now - 30 * MIN, now) + 150), 1, 1.6);
      const fcLead = forecast(id, win0, win0 + S.lead * MIN) * adj;
      const leadNeed = Math.max(fcLead, Math.min(burnPerMin(id, now) * S.lead * 0.7, fcLead * 1.5 + S.pad * 0.5));
      if (!(spare < leadNeed * S.cov + S.pad)) return;
      const urgent = spare < leadNeed * 0.8;
      if (!urgent && (now - lastAdd[id]) / MIN < S.gap && have > thr) return;
      if (hour > 20.3) return;
      if (hour > 16.8 && hour < 17.2 && spare > leadNeed * 0.8) return;   // a pan started now would run out its 4 hours just after closing and be thrown away
      const lim = plan.sellOut[id];
      let room = Infinity;
      if (lim) { room = lim.limitG - cooked[id]; if (room < thr * 0.8) return; }
      // Everything on the shelf is eaten first-in-first-out, including the grams under the 86 line once a
      // newer pan exists, so a new pan only has to cover what will be ordered before ITS hold limit minus
      // all that is already there.
      const HZ = 226 * MIN;
      const tail = now + HZ >= closeMs;
      const endAt = Math.min(now + HZ, closeMs);
      // a pan that will still be good at closing time can be cooked generously; one that expires
      // mid-service is cooked tight
      const useful = (tail ? 1.12 : S.safe) * forecast(id, win0, endAt) - sellableOnShelf(id, win0);
      const floor = urgent ? Math.max(clamp(leadNeed * S.cov + S.pad - spare, thr * 0.6, thr * 1.5), S.urg || 0) : Math.max(thr * 1.4, S.min * 0.42);
      if (useful < floor && !urgent) return;
      const size = Math.min(Math.max(useful, floor), S.max, room);       // an empty line gets a small pan, not a big one
      if (!(size > 0)) return;
      addBatchNow(id, size, now);
    }
    // A scripted food-safety incident: a reading under 135 F on the one pan that is serving, then a reheat
    // (or nobody notices).
    function maybeDip(now) {
      const hour = (now - dayZero) / H;
      for (const d of plan.dips) {
        if (d.done || hour < d.hour) continue;
        const cands = st.batches.filter((b) => b.ing === d.ing && b.status !== 'discard' && b.canServe && b.remainingG >= d.minG);
        const single = st.batches.filter((b) => b.ing === d.ing && b.status !== 'discard' && b.canServe && b.remainingG > 0).length === 1;
        if (!cands.length || (!single && hour < d.hour + 1.5)) continue;
        d.done = true; stat.dips++;
        const b = cands.reduce((a, c) => (c.remainingG > a.remainingG ? c : a));
        act('logTemp', { batchId: b.id, tempF: Math.round(K.range(127, 133)) }, now);
        if (d.kind === 'reheat') {
          Q.push(now + K.range(6, 14) * MIN, (t) => {
            const r = act('reheatBatch', { batchId: b.id, tempF: Math.round(K.range(166, 173)) }, t);
            if (r.report === 'ok') scheduleTemp(b.id, t);
          });
        }
      }
    }
    // Every three minutes: the cook looks at each held food, then any scripted temperature dip is tried.
    function cabinetCheck(now) {
      for (const id of TCS) considerBatch(id, now);
      maybeDip(now);
      if (now < closeMs - 2 * MIN) Q.push(now + 3 * MIN, cabinetCheck);
    }

    /* ---------- shelf-stable stock, sanitising, one manual 86 ---------- */
    // Every ten minutes: tops up any shelf-stable item that has run low (a delivery of 70 percent of par).
    function restockCheck(now) {
      for (const ing of st.ingredients) {
        if (ing.tcs) continue;
        const have = st.stock[ing.id];
        if (have < Math.max(3 * ing.thresholdG, 0.3 * ing.parG)) {
          const r = act('restock', { ing: ing.id, g: Math.round(ing.parG * 0.7) }, now);
          if (r.report === 'ok') stat.restocks++;
        }
      }
      if (now < closeMs - 20 * MIN) Q.push(now + 10 * MIN, restockCheck);
    }
    let sanitizeRounds = 0;
    // Logs one sanitiser round and books the next one.
    function sanitizeRound(now) {
      act('sanitizeDone', {}, now);
      sanitizeRounds++;
      scheduleSanitize(now);
    }
    // Picks the next round: usually a few minutes before it is due, about one in ten late.
    function scheduleSanitize(now) {
      if (now > closeMs) return;
      const due = st.sanitize.dueAt;
      // about one round in ten is late, and the mid-afternoon round is always late on every third day so
      // the compliance page has something to show
      const late = K.chance(0.10) || (di % 3 === 1 && sanitizeRounds === 2);
      let t = late ? due + K.range(4, 40) * MIN : due - K.range(3, 28) * MIN;
      if (t > closeMs + 11 * MIN) t = closeMs + K.range(3, 11) * MIN;   // the closing sanitise
      if (t <= now) t = now + 3 * MIN;
      Q.push(t, sanitizeRound);
    }

    /* ---------- the day starts: queue every job, then play them ---------- */
    if (!plan.pacing) Q.push(atHour(date, 9.5), (t) => { act('updateSettings', { patch: { pacing: { enabled: false } } }, t); });
    Q.push(atHour(date, 10) - 1, cabinetCheck);
    Q.push(atHour(date, 10.5) + K.range(0, 20) * MIN, sanitizeRound);
    Q.push(atHour(date, 10.5), restockCheck);
    for (const tp of plan.tickets) Q.push(tp.t, (t) => ringIn(tp, t));
    if (plan.manual86) {
      Q.push(atHour(date, plan.manual86.from), (t) => { act('toggle86', { menuId: plan.manual86.menuId, on: true }, t); });
      Q.push(atHour(date, plan.manual86.to), (t) => { act('toggle86', { menuId: plan.manual86.menuId, on: false }, t); });
    }
    run();
    // Run to 12 minutes after close so the closing sanitise and the last bumps land before the day is judged.
    const endAt = Math.max(clock, closeMs + 12 * MIN);
    catchUp(endAt); tickTo(endAt);
    const invariants = eng.checkInvariants(st, clock);
    return { state: st, endAt: clock, stat, cooked, invariants };
  }

  /* ======================================================================================================
   * 7. The fortnight: plan 14 days, place the sell-outs and incidents, play each day, assemble the dataset
   * ==================================================================================================== */
  // Builds the whole 14-day dataset: plans every day, places the sell-outs and food-safety incidents, plays
  // each day through the engine in turn (the learned prep times carry over from day to day) and gathers the
  // results.
  function generate(anchorMs) {
    const started = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const eng = E();
    const today = U.serviceDate(anchorMs);
    const keys = [];
    for (let i = 0; i < DAYS; i++) keys.push(U.addDays(today, i - DAYS));
    const wd = keys.map((k) => U.weekday(k));
    // The storm hits a quiet weekday in the pacing-on block and the surge a weekday in the pacing-off block,
    // so both pacing settings are seen under strain.
    let storm = -1;
    for (let i = 6; i <= 10 && storm < 0; i++) if (wd[i] >= 2 && wd[i] <= 4) storm = i;
    if (storm < 0) storm = 8;
    let surge = -1;
    for (const w of [3, 4, 2, 1]) { for (let i = 1; i <= 4 && surge < 0; i++) if (wd[i] === w && i !== storm) surge = i; if (surge >= 0) break; }
    if (surge < 0) surge = 2;
    const plans = keys.map((k, i) => {
      const p = planDay(i, k, i === storm ? 'storm' : i === surge ? 'surge' : 'normal');
      p.pacing = i >= 5;           // days 1 to 5 run with pacing OFF, days 6 to 14 with pacing ON
      return p;
    });
    // Genuine sell-outs: the four busiest normal days run out of brisket (the busiest at about 1:40 pm),
    // and ribs on two of them. Each limit is the grams the day's orders reach at that hour (less 5
    // minutes), plus the 86 line.
    const busiest = plans.map((p, i) => i).filter((i) => i !== storm).sort((a, b) => plans[b].N - plans[a].N || a - b);
    const brisketHours = [13.7, 17.3, 19.0, 16.6];
    busiest.slice(0, 4).forEach((i, r) => {
      const p = plans[i];
      p.sellOut.brisket = { hour: brisketHours[r], limitG: cumDemand(p, 'brisket', atHour(p.date, brisketHours[r]) - 5 * MIN) + C.ingredientById.brisket.thresholdG + 40 };
    });
    [[busiest[0], 18.75], [busiest[2], 19.35]].forEach(([i, hr]) => {
      const p = plans[i];
      p.sellOut.ribs = { hour: hr, limitG: cumDemand(p, 'ribs', atHour(p.date, hr) - 5 * MIN) + C.ingredientById.ribs.thresholdG + 40 };
    });
    // Food-safety incidents: three pans dip under 135 F and are reheated; one dips and nobody reheats it,
    // so the engine throws it out after the grace period.
    plans[2].dips.push({ ing: 'pork', hour: 12.4, kind: 'reheat', minG: 900, done: false });
    plans[4].dips.push({ ing: 'mac', hour: 13.2, kind: 'forget', minG: 1500, done: false });
    plans[7].dips.push({ ing: 'ribs', hour: 17.8, kind: 'reheat', minG: 900, done: false });
    plans[11].dips.push({ ing: 'turkey', hour: 12.9, kind: 'reheat', minG: 600, done: false });
    plans[5].manual86 = { menuId: 'hushpuppies', from: 14.1, to: 14.95 };

    // What one day hands to the next: learned prep times and id counters (ids stay unique across all 14
    // days).
    let carry = { learned: {}, seq: { ticket: ID_BASE, order: ID_BASE, batch: ID_BASE, event: ID_BASE, sync: ID_BASE, undo: 0 } };
    const out = { tickets: [], orders: [], events: [], batches: [], days: [] };
    for (const plan of plans) {
      const r = simulateDay(plan, carry);
      const st = r.state;
      carry = { learned: st.learned, seq: { ticket: st.seq.ticket, order: st.seq.order, batch: st.seq.batch, event: st.seq.event, sync: st.seq.sync, undo: st.seq.undo } };
      for (const t of st.tickets) out.tickets.push(t);
      for (const o of st.orders) out.orders.push(o);
      const evs = eng.allEvents(st);
      for (const e of evs) out.events.push(e);
      for (const b of st.batches) out.batches.push(b);
      let voided = 0, forced = 0, recalled = 0, rush = 0, done = 0;
      for (const t of st.tickets) { if (t.status === 'voided') voided++; if (t.forced) forced++; if (t.recalls > 0) recalled++; if (t.rush) rush++; if (t.status === 'expedited') done++; }
      // First time each food went 86 for lack of stock, for the day summary.
      const firstOut = {};
      for (const e of evs) if (e.type === 'avail_changed' && e.ok === false && e.reason === 'stock' && e.ing && firstOut[e.ing] === undefined) firstOut[e.ing] = e.t;
      out.days.push({
        index: plan.index, date: plan.date, label: U.fmtDateShort(plan.date), weekday: plan.weekday, kind: plan.kind, pacing: plan.pacing,
        openMs: plan.openMs, closeMs: plan.closeMs, endAt: r.endAt, planned: plan.N, tickets: st.tickets.length, finished: done, voided, forced, recalled, rush,
        batches: st.batches.length, firstSellOut: firstOut, sellOutPlan: Object.keys(plan.sellOut).reduce((o, k) => { o[k] = plan.sellOut[k].hour; return o; }, {}),
        refused: r.stat.refused, substituted: r.stat.substituted, walkedAway: r.stat.walked, restocks: r.stat.restocks, undos: r.stat.undoDone + r.stat.undoBump,
        dips: r.stat.dips, manual86: plan.manual86 ? plan.manual86.menuId : null, events: evs.length, invariants: r.invariants,
      });
    }
    const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    return {
      tickets: out.tickets, orders: out.orders, events: out.events, batches: out.batches, learned: carry.learned, days: out.days, seed: SEED,
      from: atHour(keys[0], C.service.dayStartHour), to: atHour(today, C.service.dayStartHour), anchorDate: today,
      stormDay: keys[storm], surgeDay: keys[surge],
      pacingOffDays: keys.filter((k, i) => i < 5), pacingOnDays: keys.filter((k, i) => i >= 5),
      src: 'sample', generatedMs: Math.round(t1 - started),
    };
  }

  let memo = new Map();       // service date -> dataset; three dates at most so a long session cannot grow it
  // The 14-day sample dataset ending yesterday: { tickets, events, batches, learned, days, seed, from, to,
  // stormDay, surgeDay, ... }. opts.now anchors "yesterday" (tests); default is the current time. Memoised
  // per service date. Does not look at sampleEnabled().
  Sim.sample = function (opts) {
    const anchor = opts && isNum(opts.now) ? opts.now : Date.now();
    const key = U.serviceDate(anchor);
    if (memo.has(key)) return memo.get(key);
    const data = generate(anchor);
    if (memo.size >= 3) memo = new Map();
    memo.set(key, data);
    return data;
  };
  Sim._internal = { planDay, cumDemand, makeBasket, simulateDay, atHour, trueSec, TRUE_FACTOR, COOK };
  // Forgets the memoised sample so the next call to sample() builds it again (tests use this).
  Sim.clearSample = function () { memo = new Map(); };

  // Facts about the sample for the Data page: days, dates, ticket counts, pacing blocks, and a plain-words
  // note saying the data is simulated.
  Sim.sampleInfo = function (opts) {
    const s = Sim.sample(opts);
    const first = s.days[0], last = s.days[s.days.length - 1];
    const off = s.pacingOffDays, on = s.pacingOnDays;
    // Formats the first and last date of a list as "from to until".
    const span = (a) => U.fmtDateShort(a[0]) + ' to ' + U.fmtDateShort(a[a.length - 1]);
    return {
      days: s.days.length, from: s.from, to: s.to, fromDate: first.date, toDate: last.date, tickets: s.tickets.length,
      ticketsPerDay: Math.round(s.tickets.length / s.days.length),
      pacingOffDays: off.slice(), pacingOnDays: on.slice(), seed: s.seed, stormDay: s.stormDay, surgeDay: s.surgeDay,
      note: 'Generated by a simulator that drives the real engine through ' + s.days.length + ' service days (' + span([first.date, last.date]) + ') with a simulated crew; not your restaurant\'s data. ' +
        'Pacing was off on ' + span(off) + ' and on from ' + U.fmtDateShort(on[0]) + ', so the comparison charts have both sides. ' +
        U.fmtDateShort(s.stormDay) + ' is a slow storm day and ' + U.fmtDateShort(s.surgeDay) + ' is a surge day. Sample tickets are labeled sample and are separate from your live tickets.',
    };
  };

  /* ---------- whether the back office shows the sample (persisted, default on) ---------- */
  let enabled = null;       // null until first read from storage
  const enabledListeners = new Set();
  // True when the back office should show the sample. Read from storage on first use; the default is on.
  Sim.sampleEnabled = function () {
    if (enabled === null) enabled = U.storage.get(ENABLED_KEY, true) !== false;
    return enabled;
  };
  // Turns the sample on or off, saves the choice, and tells listeners. Returns the new setting.
  Sim.setSampleEnabled = function (on) {
    enabled = !!on;
    U.storage.set(ENABLED_KEY, enabled);
    enabledListeners.forEach((fn) => { try { fn(enabled); } catch (e) { /* a listener must not break the switch */ } });
    return enabled;
  };
  // Calls fn(enabled) whenever the switch changes. Returns a function that removes the listener.
  Sim.onSampleChange = function (fn) {
    if (typeof fn !== 'function') return () => {};
    enabledListeners.add(fn);
    return () => { enabledListeners.delete(fn); };
  };

  /* ======================================================================================================
   * 8. Live demo traffic: random orders and a simulated crew working on the REAL store, on its virtual clock.
   * ==================================================================================================== */
  // Mean seconds of virtual time between new tickets for each speed of demo.
  const LIVE_RATE_SEC = { slow: 90, normal: 40, rush: 15 };
  // Most tickets one clock tick may add and most crew actions one tick may run, so a long pause (hidden
  // tab, huge demo speed) cannot flood the board.
  const LIVE_MAX_ARRIVALS = 12, LIVE_MAX_ACTIONS = 240;
  // True when the Call screen is on, so demo tickets wait for the Start tap.
  const callOn = () => !!(SB.floor && SB.floor.callMode && SB.floor.callMode());
  const live = (function () {
    const S = { running: false, rate: 'normal', crew: true, sent: 0, completed: 0 };
    const listeners = new Set();
    let rng = null, crewRng = null, off = null, nextAt = 0, seed = 0;
    let queue = new Heap();
    // The four sets below are cleared together on stop and when the crew is turned off, so no stale job
    // runs later.
    let planned = new Set();      // item ids the crew already has a plan for
    let startPlanned = new Set(); // ticket ids the crew will tap Start on
    let bumpPlanned = new Set();  // ticket ids with a bump on the way
    let tempAt = new Map();       // batch id -> {last, at}: when the crew will next log its temperature
    let sanitizeAt = null;        // {due, at}

    // The store, looked up late because it may not exist when this file loads (null in Node tests without
    // one).
    const store = () => SB.store || null;
    /** Tells every listener something changed. A broken listener cannot stop the others. */
    function changed() { listeners.forEach((fn) => { try { fn(status()); } catch (e) { /* ignore */ } }); }
    /** Where things stand: { running, rate, crew, speed, sent, completed }. */
    function status() {
      const st = store();
      return { running: S.running, rate: S.rate, crew: S.crew, speed: st && typeof st.speed === 'function' ? st.speed() : 1, sent: S.sent, completed: S.completed };
    }
    /** Seconds until the next ticket: exponential gaps make arrivals a Poisson stream. */
    const gapMs = () => -Math.log(1 - rng.next()) * LIVE_RATE_SEC[S.rate] * SEC;
    /** Is this dish on the menu right now? Reads the store's own availability answer. */
    function onMenu(menuId) {
      try { const a = store().select.availability(menuId); return !a || a.ok === true; } catch (e) { return true; }
    }
    /** One random order made from dishes that can be sold now, or null when nothing can. */
    function makeOrder(atMs) {
      const hour = new Date(atMs).getHours() + new Date(atMs).getMinutes() / 60;
      for (let tries = 0; tries < 4; tries++) {
        const channel = pickChannel(rng, hour);
        const lines = makeBasket(rng, channel).filter((l) => onMenu(l.menuId));
        if (!lines.length) continue;
        const allergy = rng.chance(0.03);
        if (allergy) for (const l of lines) l.mods = (l.mods || []).concat(['Allergy, see note']).slice(0, 3);
        return { customer: customerFor(rng, channel), channel, items: lines, note: allergy ? rng.pick(ALLERGY_NOTES) : rng.chance(0.06) ? rng.pick(OTHER_NOTES) : '', rush: rng.chance(0.02), src: 'demo', createdAt: atMs };
      }
      return null;
    }
    // Sends one order to the store. If a dish was 86'd a moment ago it is dropped and the rest is sent.
    // Returns true if a ticket was made.
    function send(order) {
      const st = store();
      for (let attempt = 0; attempt < 5 && order.items.length; attempt++) {
        if (callOn()) order = Object.assign({}, order, { awaitStart: true });
        const r = st.dispatchEx('createTicket', order, { source: 'sim' });
        if (r.report === 'ok') { S.sent++; return true; }
        if (r.report !== 'itemUnavailable' || !r.info || !r.info.menuId) return false;
        order = Object.assign({}, order, { items: order.items.filter((l) => l.menuId !== r.info.menuId) });
      }
      return false;
    }
    /** Open lines now at one station, used to slow the crew when it is swamped. */
    function openAt(zone, tickets) {
      let n = 0;
      for (const t of tickets) for (const it of t.items) if (it.zone === zone && (it.status === 'displayed' || it.status === 'cooking')) n++;
      return n;
    }
    // Gives every new on-screen item of a demo ticket a plan: when the cook picks it up and when it is
    // done.
    function planCrew(tickets, st, n) {
      const pacing = st.getState().settings.pacing;
      for (const t of tickets) {
        if (t.src !== 'demo') continue;
        // Two-tap tickets: the crew taps Start after a short reaction time, then Release a little after the plan says ready.
        if (t.awaitStart || (t.startedAt != null && !t.released)) {
          const tid = t.id;
          if (t.awaitStart && !startPlanned.has(tid)) {
            startPlanned.add(tid);
            queue.push(n + responseSec(crewRng, tickets.length, t.rush) * SEC, () => act('startTicket', { ticketId: tid }));
          }
          if (t.startedAt != null && !bumpPlanned.has(tid)) {
            bumpPlanned.add(tid);
            const readyAt = t.startedAt + (t.dmaxSec || 0) * 1000;
            queue.push(Math.max(n, readyAt) + expoDelaySec(crewRng) * SEC, () => { const r = act('releaseTicket', { ticketId: tid }); if (r === 'ok') { S.completed++; changed(); payLive(tid); } });
          }
          continue;
        }
        for (const it of t.items) {
          if (planned.has(it.id) || (it.status !== 'displayed' && it.status !== 'cooking')) continue;
          planned.add(it.id);
          const open = openAt(it.zone, tickets);
          const work = workSec(crewRng, it.menuId, it.qty, it.zone, open, 1, pacing) * (t.rush ? 0.85 : 1) * SEC;
          const wait = it.status === 'cooking' ? 0 : responseSec(crewRng, open, t.rush) * (it.track === 'one' ? 0.45 : 1) * SEC;
          const tid = t.id, iid = it.id;
          if (it.track === 'two' && it.status === 'displayed') {
            queue.push(n + wait, () => act('advanceItem', { ticketId: tid, itemId: iid }));
            queue.push(n + wait + work, () => act('advanceItem', { ticketId: tid, itemId: iid }));
          } else queue.push(n + wait + work, () => act('advanceItem', { ticketId: tid, itemId: iid }));
        }
        if (!bumpPlanned.has(t.id) && t.items.every((it) => it.status === 'done')) {
          bumpPlanned.add(t.id);
          const tid = t.id;
          queue.push(n + expoDelaySec(crewRng) * SEC, () => { const r = act('bumpTicket', { ticketId: tid }); if (r === 'ok') { S.completed++; changed(); payLive(tid); } });
        }
      }
    }
    // After a demo ticket goes out, its guest settles the bill: at once for takeout and drive-thru, a little later at a
    // table. Tickets on an order that is already paid or voided are left alone.
    function payLive(tid) {
      try {
        const st = store(), s = st.getState(), t = E().findTicket(s, tid);
        const o = t && t.orderId ? E().findOrder(s, t.orderId) : null;
        if (!o || o.status !== 'open') return;
        const tot = E().orderTotals(s, o);
        if (!tot || !(tot.subtotal > 0)) return;
        const pl = payPlan(t.id, t.channel, tot.subtotal);
        const oid = o.id;
        queue.push(st.now() + pl.delaySec * SEC, () => act('payOrder', { orderId: oid, method: pl.method, tip: pl.tip, discount: pl.discount }));
      } catch (e) { /* a missed payment is only a missing sample sale */ }
    }
    /** One crew action, quietly. Returns the engine's report word. */
    function act(type, payload) {
      try { return store().dispatchEx(type, payload, { source: 'sim' }).report; } catch (e) { return 'error'; }
    }
    // The crew logs each pan's temperature about every check interval (5 in 100 times late) and sanitises when
    // it is due.
    function planChecks(st, n) {
      const state = st.getState();
      for (const b of state.batches) {
        if (b.status === 'discard' || b.kind === 'cooling') continue;
        const last = b.lastTempAt != null ? b.lastTempAt : b.enteredAt;
        const have = tempAt.get(b.id);
        if (have && have.last === last) continue;
        const due = last + C.safety.tempCheckEveryMin * MIN;
        const at = crewRng.chance(0.05) ? due + crewRng.range(3, 20) * MIN : due - crewRng.range(2, 7) * MIN;
        tempAt.set(b.id, { last, at });
        const bid = b.id, cold = b.kind === 'cold';
        queue.push(Math.max(at, n), () => {
          const tempF = Math.round(cold ? clamp(crewRng.normal(38, 1.3), 34, 40.4) : clamp(crewRng.normal(150, 4.5), 138, 167));
          act('logTemp', { batchId: bid, tempF });
        });
      }
      const due = state.sanitize && state.sanitize.dueAt;
      if (isNum(due) && (!sanitizeAt || sanitizeAt.due !== due)) {
        const at = crewRng.chance(0.10) ? due + crewRng.range(4, 30) * MIN : due - crewRng.range(2, 20) * MIN;
        sanitizeAt = { due, at };
        queue.push(Math.max(at, n), () => act('sanitizeDone', {}));
      }
    }
    // The store calls this every second with the virtual time. Adds arrivals, then runs whatever the crew
    // has due. Never throws.
    function onTick(n) {
      try {
        if (!S.running || !isNum(n)) return;
        const st = store();
        if (nextAt < n - 5 * MIN) nextAt = n;                       // after a long pause, skip the missed orders instead of replaying them
        for (let k = 0; k < LIVE_MAX_ARRIVALS && nextAt <= n; k++) {
          const o = makeOrder(nextAt);
          if (o) send(o);
          nextAt += gapMs();
        }
        if (S.crew) {
          planCrew(st.select.activeTickets(), st, n);
          planChecks(st, n);
          for (let k = 0; k < LIVE_MAX_ACTIONS && queue.size() && queue.peek().t <= n; k++) queue.pop().fn();
        }
        changed();
      } catch (e) { /* the demo must never break the app */ }
    }
    // Starts (or retunes) the demo: opts.rate 'slow' | 'normal' | 'rush', opts.seed for repeatable traffic.
    // Returns the status.
    function start(opts) {
      const st = store();
      if (!st || typeof st.subscribeTick !== 'function') return status();
      opts = opts || {};
      if (opts.rate && LIVE_RATE_SEC[opts.rate]) S.rate = opts.rate;
      if (S.running) { changed(); return status(); }
      seed = isNum(opts.seed) ? opts.seed >>> 0 : (Date.now() ^ 0x5bd1e995) >>> 0;
      rng = U.rng(seed); crewRng = U.rng((seed + 7919) >>> 0);
      queue = new Heap(); planned = new Set(); bumpPlanned = new Set(); startPlanned = new Set(); tempAt = new Map(); sanitizeAt = null;
      S.sent = 0; S.completed = 0; S.running = true;
      nextAt = st.now() + gapMs();
      off = st.subscribeTick(onTick);
      changed();
      return status();
    }
    /** Stops the demo and leaves nothing scheduled. Tickets already on the board stay. */
    function stop() {
      if (off) { try { off(); } catch (e) { /* ignore */ } off = null; }
      S.running = false;
      queue = new Heap(); planned = new Set(); bumpPlanned = new Set(); startPlanned = new Set(); tempAt = new Map(); sanitizeAt = null;
      changed();
      return status();
    }
    // Drops n orders on the board at once (default 12, at most 40), a few seconds apart. Returns how many
    // tickets were made.
    function burst(n) {
      const st = store();
      if (!st) return 0;
      if (!rng) { seed = (Date.now() ^ 0x5bd1e995) >>> 0; rng = U.rng(seed); crewRng = U.rng((seed + 7919) >>> 0); }
      const count = clamp(isNum(n) ? Math.floor(n) : 12, 1, 40);
      const now = st.now();
      let made = 0;
      for (let i = 0; i < count; i++) {
        const o = makeOrder(now - (count - 1 - i) * 3 * SEC);
        if (o && send(o)) made++;
      }
      changed();
      return made;
    }
    // Turns the simulated crew on or off. With it off, tickets just sit until a person works them. Returns
    // the status.
    function crew(on) {
      S.crew = on !== false && !!on;
      if (!S.crew) { queue = new Heap(); planned = new Set(); bumpPlanned = new Set(); startPlanned = new Set(); tempAt = new Map(); sanitizeAt = null; }
      changed();
      return status();
    }
    /** Calls fn(status) when anything changes. Returns a function that removes it. */
    function onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    }
    return { start, stop, burst, crew, status, onChange };
  })();
  Sim.live = live;

  /* ======================================================================================================
   * 9. The first thing a new user sees: three fresh demo tickets
   * ==================================================================================================== */
  let seeded = false;
  // Three orders that have just come in, so nothing is late and every dish is at the start: the slow ones can be
  // started now and the quick ones wait for their turn. Age in seconds is how long ago it was rung in; then who
  // and where, and what.
  const FIRST_RUN = [
    { age: 25, channel: 'dine_in', customer: 'Table 4', items: [['brisket_half', 1], ['mac', 1], ['slaw', 1]] },
    { age: 12, channel: 'takeout', customer: 'Priya', items: [['pork_sand', 1], ['fried_pickles', 1], ['beans', 1]], note: 'Gluten allergy: no hush puppies, no bun', allergy: true },
    { age: 3, channel: 'third_party', customer: 'DoorDash 4471', items: [['ribs_half', 1], ['cornbread', 2], ['potato', 1]] },
  ];
  // Puts the fresh demo tickets on an empty board so the first screen is alive. Returns how many it made. Does
  // nothing (returns 0) if it already ran this session or the store already has tickets, unless opts.force is set
  // by a caller that has just cleared the board.
  Sim.seedFirstRun = function (opts) {
    try {
      const st = SB.store, force = !!(opts && opts.force);
      if (!st || typeof st.getState !== 'function' || (seeded && !force)) return 0;
      const state = st.getState();
      if (!state || (state.tickets.length && !force)) return 0;
      seeded = true;
      const n = st.now();
      let made = 0;
      for (const spec of FIRST_RUN) {
        const items = spec.items.map((x) => {
          const line = { menuId: x[0], qty: x[1] };
          if (spec.allergy) line.mods = ['Allergy, see note'];
          return line;
        }).filter((l) => onMenuNow(st, l.menuId));
        if (!items.length) continue;
        const r = st.dispatchEx('createTicket', { customer: spec.customer, channel: spec.channel, items, note: spec.note || '', src: 'demo', createdAt: n - spec.age * SEC, allowPast: true, awaitStart: callOn() }, { source: 'sim' });
        if (r.report === 'ok') made++;
      }
      // Items already due show up on the next tick.
      if (typeof st.tick === 'function') st.tick();
      return made;
    } catch (e) { return 0; }
  };
  // Starts the demo over: stops the simulator, puts the clock back to real time, clears live data (settings stay)
  // and puts the fresh tickets back. Returns how many tickets it made, or -1 when the clear was refused.
  Sim.restartDemo = function () {
    const st = SB.store;
    try { live.stop(); } catch (e) { /* the simulator may not be running */ }
    st.setSpeed(1);
    if (st.resetLive({ keepSettings: true }) !== 'ok') return -1;
    return Sim.seedFirstRun({ force: true });
  };
  /** True when the dish can be sold in this store right now (unknown counts as yes). */
  function onMenuNow(st, menuId) {
    try { const a = st.select.availability(menuId); return !a || a.ok === true; } catch (e) { return true; }
  }

})(typeof globalThis !== 'undefined' ? globalThis : window);
