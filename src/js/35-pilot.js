/*
 * WHAT THIS FILE IS: The pilot report. For a real watched service, it turns the event log, the batches and the
 *    saved sound log into the few numbers the real-service gate needs: pulls logged against the cuts an observer
 *    counted, sounds and what people did about them, discards and their weekly cost, taps per job, and how the
 *    pace estimate compares with what was really pulled. Pure functions: no screen, no storage.
 * PARTS: 1 helpers, 2 the report, 3 text and CSV.
 * USES: 00-util, 10-config, 20-engine (allEvents), 25-deadlines (salesRate, optional).
 *    USED BY: the Data page of the back office, the board (saved sound log), tests.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const C = SB.config;
  const MIN = 60e3, H = 3600e3;
  // The engine, looked up when used so tests can swap it.
  const E = () => SB.engine;

  // ---------- 1. helpers ----------
  // Rounds a number to one decimal place for the report.
  const r1 = (n) => Math.round(n * 10) / 10;
  // A count per hour over a window, or null when the window is empty.
  const perHour = (n, hours) => (hours > 0 ? r1(n / hours) : null);
  // The middle value of a list of numbers, or null when empty.
  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // The start of the current service day's opening, from the service hours, as the default start of a report.
  function defaultFrom(state, now) {
    const sv = state.settings && state.settings.service ? state.settings.service : C.service;
    const d = new Date(now);
    d.setHours(Math.floor(sv.openHour || 0), Math.round(((sv.openHour || 0) % 1) * 60), 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  // ---------- 2. the report ----------
  // Builds the report for the window opts.from to opts.to (default: since opening, until now). opts.alerts is the
  // saved sound log, opts.cutsCounted the number of cuts an observer counted by eye (or null). Events that were
  // undone and tickets or batches made by the demo or the sample data are left out and counted.
  function build(state, opts) {
    opts = opts || {};
    const to = U.isNum(opts.to) ? opts.to : (U.isNum(opts.now) ? opts.now : Date.now());
    const from = U.isNum(opts.from) ? opts.from : defaultFrom(state, to);
    const hours = Math.max(0, (to - from) / H);
    // True when a time falls inside the report window.
    const inWin = (t) => U.isNum(t) && t >= from && t <= to;
    const all = E().allEvents(state).filter((e) => inWin(e.t));
    const ev = all.filter((e) => !e.reverted);
    const demoTickets = new Set((state.tickets || []).filter((t) => t.src === 'demo' || t.src === 'sample').map((t) => t.id));
    const sampleBatches = new Set((state.batches || []).filter((b) => b.src === 'sample' || b.src === 'starter').map((b) => b.id));
    const out = {
      window: { from, to, hours: r1(hours) },
      demo: !!opts.demo,
      excluded: { reverted: all.length - ev.length, demoTickets: demoTickets.size, sampleOrStarterBatches: sampleBatches.size, demoClock: !!opts.demoClock },
      pulls: { n: 0, g: 0, byIng: {}, cutsCounted: U.isNum(opts.cutsCounted) && opts.cutsCounted > 0 ? Math.round(opts.cutsCounted) : null, tapRate: null },
      sounds: { total: 0, firstSounds: 0, repeats: 0, byLevel: { 1: 0, 2: 0, 3: 0, 4: 0 }, acknowledged: 0, notLeader: 0, lapses: 0, warnings: 0, warningsAcked: 0, ackRate: null },
      batches: { n: 0, observerCount: U.isNum(opts.batchesCounted) && opts.batchesCounted > 0 ? Math.round(opts.batchesCounted) : null, rate: null, cookAheadOn: true },
      costs: { ingredientsWithoutCost: [], ingredientsTotal: 0 },
      gate: { pullTap: null, batches: null },
      kitchen: { counterService: !!(state.settings && state.settings.service && state.settings.service.counter), coldItems: 0 },
      firstTicket: { minutes: null, from: null },
      undo: { undone: 0, undoTaps: 0, errors: 0 },
      undos: 0, refused: 0,
      keeps: { kept: 0, corrected: 0, snoozed: 0 },
      discards: { n: 0, g: 0, cost: null, costKnownN: 0, costUnknownN: 0, byIng: {}, byReason: {}, perDayCost: null, perWeekCost: null, days: r1(Math.max(hours / 24, 0)) },
      taps: { hours: r1(hours), jobs: {} },
      tickets: { used: false, n: 0, medianSec: null },
      settings: {
        hotHoldF: state.settings && state.settings.safety ? state.settings.safety.hotHoldF : C.safety.hotHoldF,
        tempCheckEveryMin: state.settings && state.settings.safety ? state.settings.safety.tempCheckEveryMin : C.safety.tempCheckEveryMin,
        hardCapH: state.settings && state.settings.safety ? state.settings.safety.hardCapH : C.safety.hardCapH,
        ladder: state.settings && state.settings.alerts && state.settings.alerts.ladderThresholds ? state.settings.alerts.ladderThresholds : 'built in',
      },
    };
    const job = (name, n) => { out.taps.jobs[name] = { n, perHour: perHour(n, hours) }; };
    // Pulls: per product, with the pace the board estimates now beside what was pulled in the last 2 hours.
    const recent = to - 2 * H;
    for (const e of ev) {
      if (e.type !== 'cabinet_pull' || !U.isNum(e.g)) continue;
      // A pull drawn only from sample or starter batches is pretend food, left out like the other sample things.
      if (Array.isArray(e.batchIds) && e.batchIds.length && e.batchIds.every((id) => sampleBatches.has(id))) continue;
      out.pulls.n++; out.pulls.g += e.g;
      const p = out.pulls.byIng[e.ing] || (out.pulls.byIng[e.ing] = { n: 0, g: 0, last2hG: 0, estGPerMin: null, realizedGPerMin: null });
      p.n++; p.g += e.g;
      if (e.t >= recent) p.last2hG += e.g;
    }
    const span2h = Math.max(30, Math.min(120, hours * 60));
    let est = null;
    try { est = SB.deadlines && SB.deadlines.salesRate ? SB.deadlines.salesRate(state, to).rate : null; } catch (e) { est = null; }
    for (const id of Object.keys(out.pulls.byIng)) {
      const p = out.pulls.byIng[id];
      p.g = Math.round(p.g);
      p.realizedGPerMin = r1(p.last2hG / span2h);
      p.estGPerMin = est && U.isNum(est[id]) ? r1(est[id] * MIN) : null;
      delete p.last2hG;
    }
    out.pulls.g = Math.round(out.pulls.g);
    if (out.pulls.cutsCounted) out.pulls.tapRate = Math.round(1000 * out.pulls.n / out.pulls.cutsCounted) / 10;
    // Discards: grams, cost, per product and reason, and what a week would cost at this day's rate. A discard with no cost
    // on record is counted as unknown: it never adds zero, and a group where nothing is known reads as unknown (null).
    const money = (o) => { o.cost = o.known ? Math.round(o.sum * 100) / 100 : null; o.costUnknownN = o.unknown; delete o.sum; delete o.known; delete o.unknown; };
    const grp = (o, k) => o[k] || (o[k] = { g: 0, sum: 0, known: 0, unknown: 0 });
    let sumKnown = 0;
    for (const e of ev) {
      if (e.type !== 'batch_discard' || sampleBatches.has(e.batchId)) continue;
      const g0 = U.isNum(e.g) ? e.g : 0, hasCost = U.isNum(e.cost);
      out.discards.n++; out.discards.g += g0;
      if (hasCost) { out.discards.costKnownN++; sumKnown += e.cost; } else out.discards.costUnknownN++;
      for (const gp of [grp(out.discards.byIng, e.ing), grp(out.discards.byReason, e.reason || 'other')]) { gp.g += g0; if (hasCost) { gp.sum += e.cost; gp.known++; } else gp.unknown++; }
    }
    out.discards.g = Math.round(out.discards.g);
    out.discards.cost = out.discards.costKnownN ? Math.round(sumKnown * 100) / 100 : out.discards.n ? null : 0;       // no discards is a calm 0; discards with no cost on record are unknown
    for (const o of [out.discards.byIng, out.discards.byReason]) for (const k of Object.keys(o)) { o[k].g = Math.round(o[k].g); money(o[k]); }
    const days = Math.max(hours / 24, 1 / 3);
    out.discards.perDayCost = out.discards.cost == null ? null : Math.round(out.discards.cost / days * 100) / 100;
    out.discards.perWeekCost = out.discards.cost == null ? null : Math.round(out.discards.cost / days * 7 * 100) / 100;
    // Sounds from the saved log (real tablets only keep what the board wrote).
    const warned = new Set(), acked = new Set();
    for (const a of opts.alerts || []) {
      if (!inWin(a.t)) continue;
      if (a.ack) { out.sounds.acknowledged++; if (typeof a.id === 'string') acked.add(a.id); continue; }
      if (typeof a.id === 'string') warned.add(a.id);
      out.sounds.total++;
      if (a.repeat) out.sounds.repeats++; else out.sounds.firstSounds++;
      if (out.sounds.byLevel[a.level] !== undefined) out.sounds.byLevel[a.level]++;
      if (a.leader === false) out.sounds.notLeader++;
      if (a.kind === 'past' && !a.repeat && /:[1-9]\d*$/.test(a.id || '')) out.sounds.lapses++;
    }
    // Each distinct warning counts once, however many times it repeated; it is acknowledged when someone tapped it.
    out.sounds.warnings = warned.size;
    out.sounds.warningsAcked = Array.from(warned).filter((id) => acked.has(id)).length;
    out.sounds.ackRate = warned.size ? Math.round(1000 * out.sounds.warningsAcked / warned.size) / 10 : null;
    // Undos and refused taps (the screen reports a refusal back to the log) in the window; undone events themselves stay excluded.
    out.undos = ev.filter((e) => e.type === 'undo').length;
    out.refused = ev.filter((e) => e.type === 'ui_report').length;
    for (const e of ev) {
      if (e.type === 'quality_extend') out.keeps.kept++;
      else if (e.type === 'quality_extend_corrected') out.keeps.corrected++;
      else if (e.type === 'alert_snoozed') out.keeps.snoozed++;
    }
    // Taps per job: each job is one dispatched action, so the events that record it are the count.
    const count = (type, pred) => ev.filter((e) => e.type === type && (!pred || pred(e))).length;
    job('pull', out.pulls.n);
    job('log a temperature', count('temp_logged'));
    job('new batch', count('batch_in', (e) => e.src === 'cook' && !sampleBatches.has(e.batchId)));
    job('keep serving', out.keeps.kept);
    job('discard', out.discards.n);
    job('remind me later', out.keeps.snoozed);
    // Tickets, only when Smokebox tickets were used (a pit-only pilot has none).
    const secs = [];
    for (const t of state.tickets || []) {
      if (demoTickets.has(t.id) || !inWin(t.createdAt)) continue;
      out.tickets.n++;
      if (U.isNum(t.expeditedAt) && !t.auto) secs.push((t.expeditedAt - t.createdAt) / 1000);
    }
    out.tickets.used = out.tickets.n > 0;
    out.tickets.medianSec = secs.length ? Math.round(median(secs)) : null;
    // Batches logged by cooking (not sample or starter), against the observer's own count.
    out.batches.n = ev.filter((e) => e.type === 'batch_in' && e.src === 'cook' && !sampleBatches.has(e.batchId)).length;
    if (out.batches.observerCount) out.batches.rate = Math.round(1000 * out.batches.n / out.batches.observerCount) / 10;
    try { out.batches.cookAheadOn = !E().moduleOn || E().moduleOn(state, 'cookAhead') !== false; } catch (e) { out.batches.cookAheadOn = true; }
    out.kitchen.coldItems = (state.batches || []).filter((b) => b && b.kind === 'cold' && b.src !== 'sample' && b.src !== 'starter').length;
    // Ingredient costs: which protein or cooked-ahead ingredients have no cost per kg, so discard cost reads as zero.
    const tcs = (state.ingredients || []).filter((i) => i && i.tcs);
    out.costs.ingredientsTotal = tcs.length;
    out.costs.ingredientsWithoutCost = tcs.filter((i) => !(U.isNum(i.costPerKg) && i.costPerKg > 0)).map((i) => i.name || i.id);
    // Undo and error counts: undone events, undo taps, and refusals the screens reported.
    out.undo.undone = out.excluded.reverted;
    out.undo.undoTaps = ev.filter((e) => e.type === 'undo').length;
    out.undo.errors = ev.filter((e) => e.type === 'ui_report').length;
    // Time to the first ticket: from the first record in the log (the app keeps no setup clock) to the first real ticket.
    const realTickets = (state.tickets || []).filter((t) => t && !demoTickets.has(t.id) && U.isNum(t.createdAt));
    const allT = E().allEvents(state).filter((e) => U.isNum(e.t)).map((e) => e.t);
    if (realTickets.length && allT.length) {
      const first = Math.min.apply(null, realTickets.map((t) => t.createdAt)), t0 = Math.min.apply(null, allT);
      if (first >= t0) { out.firstTicket.minutes = Math.round((first - t0) / MIN); out.firstTicket.from = t0; }
    }
    // The gate numbers in one place. Only the two the app can count are given a verdict; the rest are for the observer.
    // WATCH OUT: a rate over 100 percent means the app logged more than the observer counted, so the observer's count is
    // off; it is flagged (over) and never passes the gate.
    out.gate.pullTap = out.pulls.tapRate == null || !out.batches.cookAheadOn ? null : { rate: out.pulls.tapRate, pass: out.pulls.tapRate >= 50 && out.pulls.tapRate <= 100, over: out.pulls.tapRate > 100 };
    out.gate.batches = out.batches.rate == null ? null : { rate: out.batches.rate, over: out.batches.rate > 100 };
    return out;
  }

  // ---------- 3. text and CSV ----------
  // Writes a money amount in dollars with two cents digits.
  const usd = (n) => (U.isNum(n) ? U.currencySymbol() + n.toFixed(2) : 'unknown');
  // Plain-words summary of a report, one line per fact, for the screen and for pasting into notes.
  function toText(r) {
    const L = [];
    // Writes a time in the reader's own date format.
    const when = (t) => new Date(t).toLocaleString();
    if (r.demo) L.push('DEMO KITCHEN: these numbers come from demo data and are NOT pilot data. Do not use them for the gate.');
    L.push('Pilot report: ' + when(r.window.from) + ' to ' + when(r.window.to) + ' (' + r.window.hours + ' hours).');
    if (r.excluded.demoClock) L.push('WARNING: the demo clock or demo orders were on; demo pulls cannot be told apart, so do not trust these numbers.');
    L.push('');
    L.push('THE GATES, IN PLAIN WORDS');
    L.push('1. Pull taps: ' + (!r.batches.cookAheadOn ? 'cook-ahead is turned off in this kitchen, so there are no pulls to count and this gate does not apply.' : r.gate.pullTap ? r.gate.pullTap.rate + ' percent of the observer\'s cuts got a tap. ' + (r.gate.pullTap.over ? 'That is more taps than cuts, so the observer\'s count looks too low: recount before using this gate.' : r.gate.pullTap.pass ? 'That is at or above the 50 percent gate.' : 'That is below the 50 percent gate.') : 'enter the number of cuts the observer counted to get the rate (the gate needs at least 50 percent).'));
    L.push('2. Batches: ' + (r.batches.cookAheadOn ? r.batches.n + ' batches logged' + (r.batches.observerCount ? ' of ' + r.batches.observerCount + ' the observer counted (' + r.batches.rate + ' percent' + (r.batches.rate > 100 ? ', more than the observer counted, so check that count' : '') + ').' : '. Enter the observer\'s batch count to compare.') : 'cook-ahead is turned off in this kitchen, so there are no batches or pulls to count.'));
    if (r.costs.ingredientsTotal && r.costs.ingredientsWithoutCost.length) L.push('3. Discard cost: ' + usd(r.discards.cost) + ', but ' + r.costs.ingredientsWithoutCost.length + ' of ' + r.costs.ingredientsTotal + ' cooked-ahead ingredients have no cost per kg (' + r.costs.ingredientsWithoutCost.slice(0, 6).join(', ') + '), so the cost is too low. To fix it, open Settings, Dishes and prices, and type the cost per kg for each one; it takes about a minute each.');
    else L.push('3. Discard cost: ' + usd(r.discards.cost) + ' from ' + r.discards.n + ' discards' + (r.discards.costUnknownN ? ' (' + r.discards.costUnknownN + ' had no cost on record)' : '') + '. Ask the owner to say their own weekly figure and compare it with the price.');
    L.push('4. Warnings: ' + r.sounds.firstSounds + ' shown (sounded), ' + r.sounds.acknowledged + ' tapped. The app cannot know a warning was heard; the observer writes that down.');
    L.push('Time to the first ticket: ' + (r.firstTicket.minutes == null ? 'not available (no real ticket yet, or Smokebox tickets were not used).' : r.firstTicket.minutes + ' minutes after the first record in the log. Smokebox keeps no setup clock, so treat it as approximate and time setup with a watch.'));
    L.push('Undo and errors: ' + r.undo.undoTaps + ' undo taps, ' + r.undo.undone + ' events undone, ' + r.undo.errors + ' refusals shown on screen.');
    if (r.kitchen.counterService) L.push('Counter service is on: tickets are finished when paid, so ticket times are not measured.');
    L.push('');
    L.push('Left out: ' + r.excluded.reverted + ' undone events, ' + r.excluded.demoTickets + ' demo tickets, ' + r.excluded.sampleOrStarterBatches + ' sample or starter batches.');
    L.push('Pulls: ' + r.pulls.n + ' taps, ' + U.fmtG(r.pulls.g) + '.' + (r.pulls.cutsCounted ? ' Observer counted ' + r.pulls.cutsCounted + ' cuts: ' + r.pulls.tapRate + ' percent got a pull tap (the gate needs at least 50).' : ' No observer count entered yet.'));
    for (const id of Object.keys(r.pulls.byIng)) { const p = r.pulls.byIng[id]; L.push('  ' + id + ': ' + p.n + ' pulls, ' + U.fmtG(p.g) + '; last 2 h pulled ' + p.realizedGPerMin + ' g/min, board estimates ' + (p.estGPerMin == null ? 'unknown' : p.estGPerMin + ' g/min') + '.'); }
    L.push('Sounds: ' + r.sounds.total + ' (' + r.sounds.firstSounds + ' first sounds, ' + r.sounds.repeats + ' repeats; chime ' + r.sounds.byLevel[1] + ', voice ' + r.sounds.byLevel[2] + ', loud ' + r.sounds.byLevel[3] + ', limit ' + r.sounds.byLevel[4] + '); ' + r.sounds.acknowledged + ' taps on a warning; ' + r.sounds.lapses + ' lapses after a keep; ' + r.sounds.notLeader + ' held back by another tab.');
    L.push('Batches kept serving: ' + r.keeps.kept + ' (' + r.keeps.corrected + ' corrected); reminders put off: ' + r.keeps.snoozed + '.');
    const dc = r.discards;
    L.push('Discards: ' + dc.n + ' batches, ' + U.fmtG(dc.g) + ', ' + (dc.cost == null ? (dc.n ? 'cost unknown (no ingredient cost on record)' : usd(0)) : usd(dc.cost) + (dc.costUnknownN ? ' plus ' + dc.costUnknownN + ' with no cost recorded' : '')) + (dc.perWeekCost == null ? '.' : r.window.hours < 12 ? ' in this window. A week at this rate would be about ' + usd(dc.perWeekCost) + ' (one service only: a rough guess).' : '; about ' + usd(dc.perWeekCost) + ' a week at this rate.'));
    L.push('Warnings: ' + r.sounds.warnings + ' distinct, ' + r.sounds.warningsAcked + ' acknowledged' + (r.sounds.ackRate == null ? '' : ' (' + r.sounds.ackRate + ' percent)') + '. Undos: ' + r.undos + '. Refused taps: ' + r.refused + '.');
    L.push('Taps per hour: ' + Object.keys(r.taps.jobs).map((k) => k + ' ' + r.taps.jobs[k].n + (r.taps.jobs[k].perHour == null ? '' : ' (' + r.taps.jobs[k].perHour + '/h)')).join(', ') + '.');
    L.push(r.tickets.used ? 'Tickets: ' + r.tickets.n + ', median ' + (r.tickets.medianSec == null ? 'unknown' : r.tickets.medianSec + ' s') + ' to bump.' : 'Tickets: Smokebox tickets were not used.');
    L.push('Settings in force: hot hold ' + r.settings.hotHoldF + ' F, temperature check every ' + r.settings.tempCheckEveryMin + ' min, hard cap ' + r.settings.hardCapH + ' h, warning times ' + (typeof r.settings.ladder === 'string' ? r.settings.ladder : JSON.stringify(r.settings.ladder)) + '.');
    L.push('');
    L.push('WHAT THE APP CANNOT MEASURE BY ITSELF: whether a warning was heard from the pit, cuts nobody tapped (the observer counts them), batches cooked but never logged, whether the owner can name their discard cost, whether the owner would pay, and how long setup really took.');
    return L.join('\n');
  }
  // CSV text of the report in a long layout (section, name, value, unit): easy to open in a spreadsheet and to paste into notes.
  function toCsv(r) {
    const rows = [['section', 'name', 'value', 'unit']];
    // Adds one fact as a line of the table.
    const add = (s, n, v, u) => rows.push([s, n, v == null ? '' : v, u || '']);
    add('window', 'from', new Date(r.window.from).toISOString()); add('window', 'to', new Date(r.window.to).toISOString()); add('window', 'hours', r.window.hours, 'h');
    add('window', 'demo kitchen', r.demo ? 'yes' : 'no');
    for (const k of Object.keys(r.excluded)) add('excluded', k, r.excluded[k]);
    add('batches', 'logged', r.batches.n); add('batches', 'observer count', r.batches.observerCount); add('batches', 'logged vs observer', r.batches.rate, '%');
    add('gate', 'pull-tap at least 50%', r.gate.pullTap ? (r.gate.pullTap.over ? 'check the observer count (over 100%)' : r.gate.pullTap.pass ? 'yes' : 'no') : '');
    add('costs', 'discards with no cost', r.discards.costUnknownN); add('costs', 'ingredients with no cost per kg', r.costs.ingredientsWithoutCost.length); add('costs', 'cooked-ahead ingredients', r.costs.ingredientsTotal);
    add('warnings', 'shown', r.sounds.firstSounds); add('warnings', 'tapped', r.sounds.acknowledged); add('warnings', 'heard', '', 'observer writes this down');
    add('first ticket', 'minutes after first record', r.firstTicket.minutes, 'min');
    add('undo', 'undo taps', r.undo.undoTaps); add('undo', 'events undone', r.undo.undone); add('undo', 'refusals shown', r.undo.errors);
    add('pulls', 'taps', r.pulls.n); add('pulls', 'grams', r.pulls.g, 'g'); add('pulls', 'cuts counted by observer', r.pulls.cutsCounted); add('pulls', 'pull-tap rate', r.pulls.tapRate, '%');
    for (const id of Object.keys(r.pulls.byIng)) { const p = r.pulls.byIng[id]; add('pulls ' + id, 'taps', p.n); add('pulls ' + id, 'grams', p.g, 'g'); add('pulls ' + id, 'realized last 2h', p.realizedGPerMin, 'g/min'); add('pulls ' + id, 'board estimate', p.estGPerMin, 'g/min'); }
    for (const k of Object.keys(r.sounds)) if (k !== 'byLevel') add('sounds', k, r.sounds[k]);
    for (const l of [1, 2, 3, 4]) add('sounds', 'level ' + l, r.sounds.byLevel[l]);
    for (const k of Object.keys(r.keeps)) add('keeps', k, r.keeps[k]);
    add('discards', 'batches', r.discards.n); add('discards', 'grams', r.discards.g, 'g'); add('discards', 'cost', r.discards.cost, '$'); add('discards', 'batches with no cost recorded', r.discards.costUnknownN);
    add('warnings', 'distinct', r.sounds.warnings); add('warnings', 'acknowledged', r.sounds.warningsAcked); add('warnings', 'acknowledged rate', r.sounds.ackRate, '%'); add('undo', 'undos', r.undos); add('undo', 'refused taps', r.refused); add('discards', 'cost per week at this rate' + (r.window.hours < 12 ? ' (rough guess from one service)' : ''), r.discards.perWeekCost, '$');
    for (const id of Object.keys(r.discards.byIng)) add('discards ' + id, 'cost', r.discards.byIng[id].cost, '$');
    for (const k of Object.keys(r.discards.byReason)) add('discards by reason', k, r.discards.byReason[k].cost, '$');
    for (const k of Object.keys(r.taps.jobs)) { add('taps', k, r.taps.jobs[k].n); add('taps', k + ' per hour', r.taps.jobs[k].perHour, '/h'); }
    add('tickets', 'count', r.tickets.n); add('tickets', 'median seconds to bump', r.tickets.medianSec, 's');
    add('settings', 'hot hold', r.settings.hotHoldF, 'F'); add('settings', 'temperature check', r.settings.tempCheckEveryMin, 'min'); add('settings', 'hard cap', r.settings.hardCapH, 'h');
    // Every cell goes through the shared guard (36-csv.js): text that could run as a formula gets a leading apostrophe.
    return rows.map((x) => SB.csv.line(x)).join('\n') + '\n';
  }

  SB.pilot = { build, toText, toCsv, defaultFrom, KEY_ALERTLOG: 'smokebox.v1.alertlog', LOG_MAX: 400 };
})(typeof globalThis !== 'undefined' ? globalThis : window);
