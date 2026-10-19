/*
 * WHAT THIS FILE IS: The defect analysis (SB.quality) behind the back office Quality page. It counts what went
 *    wrong on tickets and in the hold cabinet, then works out defects per million, sigma level, a Pareto,
 *    control-chart limits, process capability and the likely cause of each late ticket. Pure functions of the
 *    data handed in: no page, no clock.
 * PARTS: defect definitions, sigma maths, ticket defects, hold-cabinet defects, daily control charts, capability,
 *    the final report.
 * USES: 00-util.js, 10-config.js. USED BY: 86-office-quality.js and the tests.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util, C = SB.config;
  // True only for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const SEC = 1000;
  // Targets the defects are judged against (starter estimates, owner to confirm): a cook should tap Start within
  // 60 s of a ticket arriving, and a finished plate should leave within 90 s of its planned ready time.
  const TARGETS = { startLagSec: 60, plateWaitSec: 90, earlyReleaseSec: 60 };
  // The wording and meaning of each defect. process: which flow it belongs to. measuredBy: what data it needs.
  // audit:data-start
  const DEFECTS = [
    { id: 'late', process: 'ticket', label: 'Ticket was late', how: 'Order to release took longer than the overdue time for its channel.' },
    { id: 'lateStart', process: 'ticket', label: 'Started late', how: 'The cook tapped Start more than ' + TARGETS.startLagSec + ' seconds after the ticket arrived.' },
    { id: 'plateWait', process: 'ticket', label: 'Plate waited for release', how: 'The plate sat more than ' + TARGETS.plateWaitSec + ' seconds after the app said it was ready.' },
    { id: 'early', process: 'ticket', label: 'Released too early', how: 'Released more than ' + TARGETS.earlyReleaseSec + ' seconds before the app said it was ready.' },
    { id: 'forced', process: 'ticket', label: 'Sent out incomplete', how: 'Bumped with items not marked done.' },
    { id: 'recalled', process: 'ticket', label: 'Recalled', how: 'The ticket came back to the board after it went out.' },
    { id: 'voided', process: 'ticket', label: 'Voided', how: 'The ticket was cancelled.' },
    { id: 'short', process: 'ticket', label: 'Ran out of an item', how: 'An item was made with less stock than it needed.' },
    { id: 'discard', process: 'cabinet', label: 'Batch thrown away', how: 'A batch was discarded with food still in it.' },
    { id: 'lateTemp', process: 'cabinet', label: 'Temperature check late', how: 'A hold-cabinet reading was logged after it was due.' },
  ];
  // audit:data-end
  const DEFECT_BY_ID = {};
  for (const d of DEFECTS) DEFECT_BY_ID[d.id] = d;

  // Sigma level from defects per million opportunities, with the usual 1.5 sigma shift. No defects gives 6 (a
  // floor, not a proof); a rate at or above 933 193 gives 0.
  function sigmaOf(dpmo) {
    if (!isNum(dpmo)) return null;
    if (dpmo <= 0) return 6;
    if (dpmo >= 933193) return 0;
    return Math.max(0, Math.min(6, 0.8406 + Math.sqrt(29.37 - 2.221 * Math.log(dpmo))));
  }

  // Mean and sample standard deviation of a list of numbers; sd is null for fewer than two values.
  function meanSd(xs) {
    const n = xs.length;
    if (!n) return { n: 0, mean: null, sd: null };
    let s = 0;
    for (const x of xs) s += x;
    const mean = s / n;
    if (n < 2) return { n, mean, sd: null };
    let v = 0;
    for (const x of xs) v += (x - mean) * (x - mean);
    return { n, mean, sd: Math.sqrt(v / (n - 1)) };
  }

  // The overdue time in seconds for a channel, from the settings when the owner changed it, else the starter list.
  function breachSec(settings, channel) {
    const own = settings && Array.isArray(settings.channels) ? settings.channels.find((c) => c && c.id === channel) : null;
    if (own && isNum(own.breachSec)) return own.breachSec;
    const base = (C.channels || []).find((c) => c.id === channel);
    return base ? base.breachSec : 780;
  }

  // The planned ready time of a two-tap ticket: its Start moment plus the longest planned item.
  const readyAtOf = (t) => (isNum(t.startedAt) ? t.startedAt + (t.dmaxSec || 0) * SEC : null);

  // Reads one finished or voided ticket and says which defects it has and which it could have had.
  // Returns { defects: [ids], measured: [ids], cause, totalMs }. A defect type that cannot be judged for this
  // ticket (no Start tap, no stock event) is left out of measured, so it is not counted as a clean pass.
  function judgeTicket(t, ctx) {
    const out = { defects: [], measured: [], cause: null, totalMs: null };
    // Records that a defect type was judged for this ticket, and whether the ticket failed it.
    const add = (id, bad) => { out.measured.push(id); if (bad) out.defects.push(id); };
    if (t.status === 'voided') { out.measured.push('voided'); out.defects.push('voided'); return out; }
    if (t.status !== 'expedited' || !isNum(t.expeditedAt)) return null;
    const totalMs = t.expeditedAt - t.createdAt;
    out.totalMs = totalMs;
    const limit = breachSec(ctx.settings, t.channel) * SEC;
    add('late', totalMs > limit);
    add('voided', false);
    add('recalled', (t.recalls || 0) > 0);
    add('forced', t.forced === true);
    add('short', ctx.shortTickets.has(t.id));
    if (isNum(t.startedAt)) {
      add('lateStart', t.startedAt - t.createdAt > TARGETS.startLagSec * SEC);
      const readyAt = readyAtOf(t);
      if (readyAt !== null && t.released === true) {
        add('plateWait', t.expeditedAt - readyAt > TARGETS.plateWaitSec * SEC);
        add('early', readyAt - t.expeditedAt > TARGETS.earlyReleaseSec * SEC);
      }
    }
    if (out.defects.indexOf('late') >= 0) out.cause = causeOf(t, out.defects, limit);
    return out;
  }

  // The most likely reason a ticket ran late, from what was recorded. Order matters: the first rule that fits wins.
  // Returns { id, label }.
  function causeOf(t, defects, limitMs) {
    const has = (id) => defects.indexOf(id) >= 0;
    if (has('short')) return { id: 'stock', label: 'Ran out of an item' };
    if (has('lateStart')) return { id: 'start', label: 'Nobody started it in time' };
    if (has('plateWait')) return { id: 'plate', label: 'Plate waited to be released' };
    if (t.dmaxSec > 0 && t.dmaxSec * SEC > limitMs * 0.9) return { id: 'plan', label: 'The plan itself is near the limit' };
    // Classic tickets: blame the station whose item finished last.
    let last = null;
    for (const it of t.items || []) if (isNum(it.doneAt) && (!last || it.doneAt > last.doneAt)) last = it;
    if (last && C.zoneById && C.zoneById[last.zone]) return { id: 'zone:' + last.zone, label: 'Slowest station: ' + C.zoneById[last.zone].name };
    return { id: 'unknown', label: 'No cause recorded' };
  }

  // Rolls a list of judged units up into per-type counts and the totals: defects, opportunities, DPMO, sigma.
  function rollUp(units, types) {
    const rows = types.map((d) => ({ id: d.id, label: d.label, how: d.how, process: d.process, defects: 0, opps: 0 }));
    const byId = {};
    for (const r of rows) byId[r.id] = r;
    let defective = 0, defects = 0, opps = 0;
    for (const u of units) {
      if (u.defects.length) defective++;
      for (const m of u.measured) if (byId[m]) { byId[m].opps++; opps++; }
      for (const d of u.defects) if (byId[d]) { byId[d].defects++; defects++; }
    }
    for (const r of rows) { r.dpmo = r.opps ? (r.defects / r.opps) * 1e6 : null; r.rate = r.opps ? r.defects / r.opps : null; }
    const dpmo = opps ? (defects / opps) * 1e6 : null;
    return { units: units.length, defective, defects, opps, dpu: units.length ? defects / units.length : null, dpmo, sigma: sigmaOf(dpmo), firstPass: units.length ? 1 - defective / units.length : null, types: rows };
  }

  // p-chart limits for one day: the average share bad plus or minus three standard errors, never below 0 or above 1.
  function pLimits(pbar, n) {
    const se = n > 0 ? Math.sqrt((pbar * (1 - pbar)) / n) : 0;
    return { ucl: Math.min(1, pbar + 3 * se), lcl: Math.max(0, pbar - 3 * se) };
  }

  // Builds the daily control charts: share of tickets with a defect (p-chart) and average ticket minutes
  // (individuals chart with moving-range limits, centre +/- 2.66 x the average moving range).
  function dailyCharts(rows) {
    const days = rows.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    let bad = 0, n = 0;
    for (const d of days) { bad += d.defective; n += d.n; }
    const pbar = n ? bad / n : 0;
    for (const d of days) {
      d.p = d.n ? d.defective / d.n : null;
      const lim = pLimits(pbar, d.n);
      d.ucl = lim.ucl; d.lcl = lim.lcl;
      d.out = d.p !== null && (d.p > d.ucl || d.p < d.lcl) ? (d.p > d.ucl ? 'high' : 'low') : null;
    }
    const means = days.filter((d) => isNum(d.meanMin));
    let mr = 0;
    for (let i = 1; i < means.length; i++) mr += Math.abs(means[i].meanMin - means[i - 1].meanMin);
    const mrbar = means.length > 1 ? mr / (means.length - 1) : null;
    const centre = means.length ? means.reduce((s, d) => s + d.meanMin, 0) / means.length : null;
    const imr = { centre, mrbar, ucl: mrbar === null ? null : centre + 2.66 * mrbar, lcl: mrbar === null ? null : Math.max(0, centre - 2.66 * mrbar) };
    for (const d of days) d.meanOut = imr.ucl !== null && isNum(d.meanMin) ? (d.meanMin > imr.ucl ? 'high' : d.meanMin < imr.lcl ? 'low' : null) : null;
    // A run of 8 days in a row on one side of the centre line is also a signal (the process moved).
    let run = 0, side = 0;
    for (const d of days) {
      const s = d.p === null ? 0 : d.p > pbar ? 1 : d.p < pbar ? -1 : 0;
      if (s !== 0 && s === side) run++; else { run = s === 0 ? 0 : 1; side = s; }
      d.run = run >= 8 ? side : 0;
    }
    return { days, pbar, imr, signals: days.filter((d) => d.out || d.meanOut || d.run).length };
  }

  // Process capability of ticket time against the overdue limit: one-sided Cpk = (limit - mean) / (3 x sd).
  // Needs at least 30 tickets; below that the answer is null so the page says "not enough data" instead of guessing.
  function capability(times, limitMin) {
    const s = meanSd(times);
    const cpk = s.n >= 30 && s.sd > 0 ? (limitMin - s.mean) / (3 * s.sd) : null;
    return { n: s.n, mean: s.mean, sd: s.sd, limit: limitMin, cpk, enough: s.n >= 30 };
  }

  // Hold-cabinet units: one per batch (was it thrown away?) and one per temperature check (was it late?).
  function cabinetUnits(ds, from, to, dsh) {
    const units = [];
    const seen = new Set();
    for (const b of ds.batches || []) {
      if (!b || !isNum(b.enteredAt) || b.enteredAt < from || b.enteredAt >= to) continue;
      const wasted = isNum(b.wasteG) && b.wasteG > 0;
      units.push({ kind: 'batch', date: U.serviceDate(b.enteredAt, dsh), defects: wasted ? ['discard'] : [], measured: ['discard'], g: wasted ? b.wasteG : 0, cost: wasted && isNum(b.costPerCookedKg) ? (b.wasteG / 1000) * b.costPerCookedKg : 0, ing: b.ing, reason: b.discardReason || null, id: b.id });
      seen.add(b.id);
    }
    for (const e of ds.events || []) {
      if (!e || e.reverted || e.type !== 'temp_logged' || typeof e.onTime !== 'boolean' || !isNum(e.t) || e.t < from || e.t >= to) continue;
      units.push({ kind: 'check', date: U.serviceDate(e.t, dsh), defects: e.onTime ? [] : ['lateTemp'], measured: ['lateTemp'], g: 0, cost: 0 });
    }
    return units;
  }

  // The report for the Quality page. ds is the office dataset; opts: { from, to, channel }.
  // Returns { tickets, cabinet, pareto, causes, days, chart, capability, worst, histogram, cost }.
  function analyze(ds, opts) {
    const o = opts || {};
    const from = isNum(o.from) ? o.from : -Infinity, to = isNum(o.to) ? o.to : Infinity;
    const settings = ds.settings || {};
    const dsh = settings.service && isNum(settings.service.dayStartHour) ? settings.service.dayStartHour : 4;
    const shortTickets = new Set();
    for (const e of ds.events || []) if (e && !e.reverted && e.type === 'item_done' && isNum(e.shortG) && e.shortG > 0 && e.ticketId) shortTickets.add(e.ticketId);
    const ctx = { settings, shortTickets };
    const judged = [];
    for (const t of ds.tickets || []) {
      if (!t || !isNum(t.createdAt) || t.createdAt < from || t.createdAt >= to) continue;
      if (o.channel && o.channel !== 'all' && t.channel !== o.channel) continue;
      const j = judgeTicket(t, ctx);
      if (!j) continue;
      j.t = t; j.date = U.serviceDate(t.createdAt, dsh);
      judged.push(j);
    }
    const tTypes = DEFECTS.filter((d) => d.process === 'ticket');
    const cTypes = DEFECTS.filter((d) => d.process === 'cabinet');
    const tickets = rollUp(judged, tTypes);
    const cabUnits = cabinetUnits(ds, from, to, dsh);
    const cabinet = rollUp(cabUnits, cTypes);
    // Pareto: every defect type with at least one defect, biggest first, with the running share.
    const all = tickets.types.concat(cabinet.types).filter((r) => r.defects > 0).sort((a, b) => b.defects - a.defects || (a.id < b.id ? -1 : 1));
    const total = all.reduce((s, r) => s + r.defects, 0);
    let cum = 0;
    const pareto = all.map((r) => { cum += r.defects; return { id: r.id, label: r.label, process: r.process, count: r.defects, share: total ? r.defects / total : 0, cum: total ? cum / total : 0 }; });
    // Causes of late tickets.
    const cm = new Map();
    for (const j of judged) if (j.cause) { const c = cm.get(j.cause.id) || { id: j.cause.id, label: j.cause.label, count: 0, nums: [] }; c.count++; if (c.nums.length < 6) c.nums.push(j.t.num); cm.set(j.cause.id, c); }
    const lateN = Array.from(cm.values()).reduce((s, c) => s + c.count, 0);
    const causes = Array.from(cm.values()).sort((a, b) => b.count - a.count).map((c) => Object.assign(c, { share: lateN ? c.count / lateN : 0 }));
    // Daily rows for the control charts.
    const dayMap = new Map();
    for (const j of judged) {
      const d = dayMap.get(j.date) || { date: j.date, n: 0, defective: 0, mins: [] };
      d.n++; if (j.defects.length) d.defective++;
      if (isNum(j.totalMs)) d.mins.push(j.totalMs / 60000);
      dayMap.set(j.date, d);
    }
    const rows = Array.from(dayMap.values()).map((d) => ({ date: d.date, n: d.n, defective: d.defective, meanMin: d.mins.length ? d.mins.reduce((s, x) => s + x, 0) / d.mins.length : null }));
    const chart = dailyCharts(rows);
    // Ticket-time capability against the dine-in overdue limit, the most common channel; histogram in 1-minute bins.
    const mins = judged.filter((j) => isNum(j.totalMs)).map((j) => j.totalMs / 60000);
    const limitMin = breachSec(settings, o.channel && o.channel !== 'all' ? o.channel : 'dine_in') / 60;
    const bins = [];
    for (const m of mins) { const b = Math.min(30, Math.floor(m)); bins[b] = (bins[b] || 0) + 1; }
    const histogram = [];
    for (let i = 0; i < bins.length; i++) histogram.push({ minute: i, n: bins[i] || 0 });
    // The worst tickets: most defects first, then slowest.
    const worst = judged.filter((j) => j.defects.length).sort((a, b) => b.defects.length - a.defects.length || (b.totalMs || 0) - (a.totalMs || 0)).slice(0, 8)
      .map((j) => ({ id: j.t.id, num: j.t.num, date: j.date, customer: j.t.customer, channel: j.t.channel, minutes: isNum(j.totalMs) ? j.totalMs / 60000 : null, defects: j.defects.map((d) => DEFECT_BY_ID[d].label), cause: j.cause ? j.cause.label : null }));
    const cost = cabUnits.reduce((s, u) => s + (u.cost || 0), 0);
    return { tickets, cabinet, pareto, causes, days: chart.days, chart, capability: capability(mins, limitMin), worst, histogram, cost, targets: TARGETS };
  }

  SB.quality = { DEFECTS, TARGETS, sigmaOf, meanSd, pLimits, capability, judgeTicket, analyze };
})(typeof globalThis !== 'undefined' ? globalThis : window);
