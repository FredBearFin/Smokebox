/*
 * WHAT THIS FILE IS: The deadline feed (SB.deadlines). One list of everything about to go wrong in the kitchen,
 *    sorted by urgency, each with what happens if nobody acts and what to do. It reads the whole state and the
 *    time and changes nothing.
 * PARTS: warning rungs, sales rate, batch rows (expiry with projected waste, run-out), safety rows (checks,
 *    reheat, chill, cooling), ticket and sanitize rows, the sorted list.
 * USES: 00-util.js, 10-config.js, 20-engine.js. USED BY: the attention strip and the warning ladder in the
 *    kitchen screens.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util, C = SB.config;
  const MIN = 60e3, H = 3600e3;
  // The engine, looked up each time so tests can swap it.
  const E = () => SB.engine;
  // Sales pace is trusted only with at least this many grams seen in the window; below it the pace is "no data".
  const RATE_MIN_G = 200;
  // How far back removals count (6 hours), at most how many of them, and the shortest span a pace is worked over.
  const RECENT_MS = 6 * H, MIN_SPAN_MS = 30 * MIN;
  // Pace tuning: removals closer than 15 minutes merge; dense needs 5 merged removals in 2 hours; a lone removal counts only
  // after 120 minutes since opening; the sparse span never counts for less than 90 minutes.
  const MERGE_MS = 15 * MIN, DENSE_WINDOW_MS = 2 * H, DENSE_MIN = 5, SINGLE_PULL_MS = 120 * MIN, SPARSE_FLOOR_MS = 90 * MIN;
  // Under this many grams left a batch is not worth a sounded warning.
  const TRIVIAL_G = 300;
  // Projected waste counts as worth a sounded warning only from this many grams, or this share of the batch.
  const NOTABLE_G = 500, NOTABLE_SHARE = 0.15;
  // Ordering of severities, worst first.
  const SEV_RANK = { bad: 0, warn: 1, info: 2 };

  // Minutes-before-the-deadline at which each warning rung fires, for one ingredient: the owner's list from the settings
  // (settings.alerts.ladderThresholds, when given), else the built-in one. Brisket starts earlier because a long cook
  // cannot be replaced in an hour. The settings argument is optional.
  function rungsFor(ingId, settings) {
    const o = settings && settings.alerts ? settings.alerts.ladderThresholds : null;
    if (o) { if (o.byIng && o.byIng[ingId]) return o.byIng[ingId]; if (o.default) return o.default; }
    const L = C.ladderMin || {};
    return (L.byIng && L.byIng[ingId]) || L.defaultMin || [60, 30, 10];
  }
  // Which rung a deadline is on: 0 means none yet, 1 to n means that many thresholds have been crossed, and
  // n + 1 means the deadline has passed.
  function rungOf(msLeft, rungsMin) {
    if (msLeft <= 0) return rungsMin.length + 1;
    let r = 0;
    for (const m of rungsMin) if (msLeft <= m * MIN) r++;
    return r;
  }
  // The most recent opening time at or before now, in ms, from the service hours; null when the settings have none.
  function lastOpenAt(state, now) {
    const sv = state.settings && state.settings.service ? state.settings.service : C.service;
    if (!U.isNum(sv.openHour)) return null;
    const d = new Date(now);
    d.setHours(Math.floor(sv.openHour), Math.round((sv.openHour % 1) * 60), 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  // Merges removals that fall inside one 15-minute stretch (counted from the first of them) into a single event: grams
  // summed, time of the last. A burst of small items, or two pulls a few minutes apart, is one removal for pacing.
  function mergeRemovals(list) {
    const out = [];
    let start = null;
    for (const x of list.slice().sort((p, q) => p.t - q.t)) {
      if (start !== null && x.t - start < MERGE_MS) { const l = out[out.length - 1]; l.g += x.g; l.t = x.t; } else { out.push({ t: x.t, g: x.g }); start = x.t; }
    }
    return out;
  }
  // Each cooked ingredient's grams per millisecond leaving the cabinet, from finished tickets and hand pulls. A pure
  // function of the state: no memory between calls.
  //   Removals are merged (see mergeRemovals). Dense: 5 or more merged removals in the last 2 hours, the pace is the
  //   grams in that window over the time it covers (since opening if that is shorter, never under 30 minutes).
  //   Sparse: fewer, the pace is a renewal estimate, total grams over the span from the first to the latest removal plus
  //   one average interval (never under 90 minutes), which reads a lumpy cadence such as a whole brisket every 100
  //   minutes steadily. After a silence of more than two intervals (and 90 minutes) it is unknown again.
  //   A pace needs 2 removals, or 120 minutes since opening for a single removal. No removals, or too little food
  //   moved, means the pace is UNKNOWN: the ingredient is missing from `rate`, which is not the same as zero.
  // Returns { rate: {ingId: g per ms}, seenG: {ingId: grams} }.
  function salesRate(state, now) {
    const from = now - RECENT_MS, list = Object.create(null);
    // Finished items carry the grams they used; walk back from the newest tickets and stop once they are old.
    for (let i = state.tickets.length - 1; i >= 0; i--) {
      const t = state.tickets[i];
      if (t.createdAt < from - 12 * H) break;
      for (const it of t.items) {
        if (it.status !== 'done' || !(it.doneAt >= from) || !it.depleted) continue;
        for (const r of it.depleted) if (r.g > 0 && r.batchId) (list[r.ing] = list[r.ing] || []).push({ t: it.doneAt, g: r.g });
      }
    }
    for (const e of E().allEvents(state)) if (e.type === 'cabinet_pull' && e.t >= from && e.t <= now && !e.reverted) (list[e.ing] = list[e.ing] || []).push({ t: e.t, g: e.g });
    const openAt = lastOpenAt(state, now), sinceOpen = openAt == null ? 0 : now - openAt;
    const rate = Object.create(null), seen = Object.create(null);
    for (const k of Object.keys(list)) {
      const ev = mergeRemovals(list[k]);
      const total = ev.reduce((a, x) => a + x.g, 0);
      seen[k] = total;
      if (total < RATE_MIN_G) continue;
      const r = estimateRate(ev, total, now, openAt, sinceOpen);
      if (r !== undefined) rate[k] = r;
    }
    return { rate, seenG: seen };
  }
  // The pace for one ingredient from its merged removals, or undefined when unknown. See salesRate.
  function estimateRate(ev, total, now, openAt, sinceOpen) {
    const win = ev.filter((x) => x.t >= now - DENSE_WINDOW_MS);
    if (ev.length < 2 && sinceOpen < SINGLE_PULL_MS) return undefined;
    if (win.length >= DENSE_MIN) {
      const g = win.reduce((a, x) => a + x.g, 0);
      const covered = openAt == null ? now - win[0].t : Math.min(DENSE_WINDOW_MS, now - openAt);
      return g / Math.max(covered, MIN_SPAN_MS);
    }
    if (ev.length < 2) return total / Math.max(sinceOpen, SPARSE_FLOOR_MS);
    const span = ev[ev.length - 1].t - ev[0].t, mean = span / (ev.length - 1);
    // A silence longer than two intervals (and 90 minutes) is not a pace of zero: pulls may simply not be logged.
    if (now - ev[ev.length - 1].t > Math.max(2 * mean, SPARSE_FLOOR_MS)) return undefined;
    // The floor is 90 minutes, or the time since opening when that is shorter (never under 30 minutes), so a busy
    // start is not diluted by time before the doors opened.
    const floor = Math.max(MIN_SPAN_MS, Math.min(SPARSE_FLOOR_MS, openAt == null ? SPARSE_FLOOR_MS : sinceOpen));
    return total / Math.max(span + mean, floor);
  }
  // Picks the severity for a countdown: the last rung or expiry is bad, the middle rungs are warnings, and it is
  // one step worse when no other batch of that food is left to take over.
  function sevOf(rung, n, lastOne) {
    if (rung >= n) return 'bad';
    if (lastOne && rung >= 2) return 'bad';
    if (rung >= 2 || (rung >= 1 && lastOne)) return 'warn';
    return rung >= 1 ? 'warn' : 'info';
  }
  // The row for a batch that is past its quality limit: it is off the menu and waits for a taste test.
  function pastRow(state, b, now, out) {
    const ing = state.ingredients.find((x) => x.id === b.ing);
    const name = ing ? ing.name : b.ing;
    const left = state.batches.some((x) => x !== b && x.ing === b.ing && x.status !== 'discard' && x.canServe === true && x.remainingG > 0);
    const amount = U.weightText(b.remainingG) + (U.isNum(b.costPerCookedKg) ? ' (' + U.currencySymbol() + (b.remainingG / 1000 * b.costPerCookedKg).toFixed(0) + ')' : '');
    out.push({ id: 'past:' + b.id + ':' + (U.isNum(b.keepUntil) ? b.keepUntil : 0), epoch: U.isNum(b.keepUntil) ? b.keepUntil : 0, kind: 'past', step: 'last', ing: b.ing, batchId: b.id, label: b.label || name, at: b.enteredAt + E()._internal.holdLimitMs(b, state.settings.safety ? Object.assign({}, C.safety, state.settings.safety) : C.safety), msLeft: 0, rung: 0, rungs: 0, sev: 'bad',
      consequence: amount + ' is past its quality limit and off the menu' + (left ? '.' : ', so ' + name + ' is sold out.'), action: 'Check it, then decide: keep serving or throw it out. Your food-safety plan comes first.', trivial: b.remainingG < TRIVIAL_G, unknown: false });
  }
  // The next closing time after now, in ms, from the service hours (a close above 24 means after midnight, so last
  // night's close can still be ahead at 12:30 am). Null once today's close has passed.
  function closeAtMs(state, now) {
    const sv = state.settings && state.settings.service ? state.settings.service : C.service;
    if (!U.isNum(sv.closeHour)) return null;
    let best = null;
    for (const day of [-1, 0]) {
      const d = new Date(now);
      d.setDate(d.getDate() + day); d.setHours(0, 0, 0, 0);
      // Whole hours go on the wall clock, so a clock-change day still closes at the clock time set; only the part
      // of an hour is added as milliseconds.
      const w = Math.floor(sv.closeHour);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), w, 0, 0, 0).getTime() + Math.round((sv.closeHour - w) * H);
      if (at > now && (best == null || at < best)) best = at;
    }
    return best;
  }
  // Walks from now to close in steps between the moments something changes (a resting batch becomes ready, a
  // batch passes its limit), serving the pace from the oldest ready batch first. Each batch is { remainingG,
  // enteredAt, readyAt, expAt, id?, quality? }. Returns two separate numbers, since either can matter and one
  // ingredient can have both: leftoverG (grams in batches still alive at close) and unmetG (demand nobody could
  // serve). Also runOutAt (the first moment demand went unserved), runOutCause ('rest-gap' when a batch is still
  // resting and ready later, gapEndAt; 'limit' when a batch passing its limit ended the supply, limitBatchId and
  // limitQuality; else 'stock'), wasteBefore (grams that passed their limit before close), wasteById (the same
  // grams per batch id) and plannedLeftG (the part of leftoverG in planned batches, ids starting 'plan:').
  function sweepToClose(batches, rate, now, closeAt) {
    const bs = batches.map((b) => ({ rem: b.remainingG, ent: b.enteredAt, ready: Math.max(now, b.readyAt || 0), exp: b.expAt, id: b.id, quality: !!b.quality })).sort((x, y) => x.ent - y.ent);
    const marks = new Set([now, closeAt]);
    for (const b of bs) for (const t of [b.ready, b.exp]) if (t > now && t < closeAt) marks.add(t);
    const times = Array.from(marks).sort((x, y) => x - y);
    const wasteById = Object.create(null);
    let unmet = 0, gapUnmet = 0, runOutAt = null, wasteBefore = 0, cause = null, gapEndAt = null, limitBatchId = null, limitQuality = false, lastLimit = null;
    for (let i = 0; i + 1 < times.length; i++) {
      const a = times[i], z = times[i + 1], dem = rate * (z - a);
      let need = dem;
      for (const b of bs) { if (need <= 0) break; if (b.rem > 0 && b.ready <= a && b.exp > a) { const take = Math.min(need, b.rem); b.rem -= take; need -= take; } }
      if (need > 1e-6) {
        if (runOutAt == null) {
          runOutAt = a + (dem - need) / rate;
          const gap = bs.filter((b) => b.rem > 0 && b.ready > runOutAt && b.ready < closeAt && b.exp > b.ready).sort((x, y) => x.ready - y.ready)[0];
          if (gap) { cause = 'rest-gap'; gapEndAt = gap.ready; }
          else if (lastLimit && Math.abs(lastLimit.exp - runOutAt) < 1000) { cause = 'limit'; limitBatchId = lastLimit.id; limitQuality = lastLimit.quality; }
          else cause = 'stock';
        }
        unmet += need;
        if (cause === 'rest-gap' && z <= gapEndAt) gapUnmet += need;
      }
      for (const b of bs) if (b.exp <= z && b.rem > 0) { wasteBefore += b.rem; if (b.id != null) wasteById[b.id] = (wasteById[b.id] || 0) + b.rem; b.rem = 0; if (!lastLimit || b.exp >= lastLimit.exp) lastLimit = { exp: b.exp, id: b.id, quality: b.quality }; }
    }
    const alive = bs.reduce((acc, b) => acc + (b.exp > closeAt ? b.rem : 0), 0);
    const plannedLeft = bs.reduce((acc, b) => acc + (b.exp > closeAt && String(b.id).indexOf('plan:') === 0 ? b.rem : 0), 0);
    return { leftoverG: alive, plannedLeftG: plannedLeft, unmetG: unmet, gapUnmetG: gapUnmet, runOutAt, runOutCause: cause, gapEndAt, limitBatchId, limitQuality, wasteBefore, wasteById };
  }
  // Grams of each batch the pace will not sell before that batch's own limit, keyed by batch id. Runs the same
  // time-stepped sweep as the close check, but past close to the last limit, so a younger batch only sells once the
  // older ones are gone or expired. Each batch is { id, remainingG, enteredAt, readyAt, expAt }.
  function batchWaste(batches, rate, now) {
    const end = batches.reduce((m, b) => Math.max(m, b.expAt), now) + 1;
    return sweepToClose(batches, rate, now, end).wasteById;
  }
  // Whether a new batch started now would be ready before close: now + cook time + rest time against closing. Returns
  // null when the product has no cook time, else { readyAt, fits }.
  function nextBatchFit(ing, now, closeAt) {
    if (!ing || !U.isNum(ing.cookH) || !(ing.cookH > 0)) return null;
    const readyAt = now + (ing.cookH + (U.isNum(ing.restH) ? ing.restH : 0)) * H;
    return { readyAt, fits: readyAt < closeAt };
  }
  // The sweep to close for one ingredient at the current pace, or null (closed, nothing servable). Only batches that
  // can be served count; a pull counts as sold, so food already on the block is not counted.
  function closeInfo(state, ing, list, rate, now, S) {
    const closeAt = closeAtMs(state, now);
    if (closeAt == null) return null;
    const bs = list.filter((b) => b.canServe !== false).map((b) => {
      const hardAt = b.enteredAt + (U.isNum(S.hardCapH) ? S.hardCapH : S.defaultMaxHoldH) * H, limAt = b.enteredAt + E()._internal.holdLimitMs(b, S);
      const q = b.holdBasis === 'quality' && limAt < hardAt;
      return { id: b.id, quality: q, remainingG: b.remainingG, enteredAt: b.enteredAt, readyAt: b.restUntil, expAt: q && U.isNum(b.keepUntil) && b.keepUntil > now ? Math.min(b.keepUntil, hardAt) : limAt };
    });
    if (!bs.length) return null;
    // Planned batches are supply from the moment they have rested. They are not stock, so they stay out of the stock total.
    const stock0 = bs.reduce((acc, b) => acc + b.remainingG, 0);
    for (const e of state.planned || []) {
      if (e.ing !== ing.id || now >= e.readyAt + 2 * H) continue;
      bs.push({ id: 'plan:' + e.id, quality: false, remainingG: e.grams, enteredAt: e.offAt, readyAt: e.readyAt, expAt: e.offAt + E()._internal.holdLimitMs({ maxHoldH: ing.maxHoldH }, S) });
    }
    return { closeAt, stock: stock0, r: sweepToClose(bs, rate, now, closeAt) };
  }
  // What to do about a run-out at runOutAt: start a new batch by a time that is still ahead, or say it is too late.
  // Null when the product has no cook time. The text never counts anything still on the smoker.
  function startBy(ing, now, runOutAt, unmetG) {
    if (!ing || !U.isNum(ing.cookH) || !(ing.cookH > 0)) return null;
    const latest = runOutAt - (ing.cookH + (U.isNum(ing.restH) ? ing.restH : 0)) * H;
    if (latest > now) return { ahead: true, latestStart: latest, text: 'Start the next batch by ' + U.fmtTime(latest) + ', not counting anything still on the smoker.' };
    return { ahead: false, latestStart: latest, text: 'Too late for a new batch to cover it: about ' + U.weightText(unmetG) + ' of demand with nothing to sell. Shorten portions, stop preorders, run a special.' };
  }
  // Rows for one ingredient from its close sweep: grams left over at close (waste, silent) and demand with nothing to
  // sell (a silent caution with what to do). Either can raise a row. A shortfall that a quality limit causes has no row
  // of its own: the batch's expiry row says it and carries the start-by line.
  function closeRows(info, ing, name, now, out) {
    if (!info) return;
    const { closeAt, stock, r } = info;
    // WATCH OUT: grams in a planned batch were never cooked, so they are not food to sell off; they are told apart as
    // a smaller plan.
    const planLeft = r.plannedLeftG || 0, realLeft = Math.max(0, r.leftoverG - planLeft);
    const realNote = realLeft >= Math.max(NOTABLE_G, NOTABLE_SHARE * stock), planNote = planLeft >= NOTABLE_G;
    if (realNote || planNote) {
      const consequence = (realNote ? 'At the current pace about ' + U.weightText(realLeft) + ' of ' + name + ' will be left at close, not counting what is already on the block.' : '')
        + (planNote ? (realNote ? ' ' : '') + 'The planned batch would leave about ' + U.weightText(planLeft) + (realNote ? ' more' : ' of ' + name) + ' at close.' : '');
      const action = realNote ? 'Sell it: run a special, tell the front.' + (planNote ? ' Plan a smaller batch.' : '') : 'Plan a smaller batch, or none.';
      out.push({ id: 'leftover:' + ing.id, kind: 'leftover', ing: ing.id, label: name, at: closeAt, msLeft: closeAt - now, rung: 0, rungs: 0, sev: 'info', leftoverG: realLeft, plannedLeftG: planLeft,
        consequence, action, unknown: false });
    }
    if ((r.runOutCause === 'rest-gap' ? r.gapUnmetG : r.unmetG) < NOTABLE_G || r.runOutAt == null || (r.runOutCause === 'limit' && r.limitQuality)) return;
    let consequence, action, sb = null;
    if (r.runOutCause === 'rest-gap') {
      consequence = 'At the current pace ' + name + ' runs out at ' + U.fmtTime(r.runOutAt) + ', next batch ready at ' + U.fmtTime(r.gapEndAt) + ', about ' + U.weightText(r.gapUnmetG) + ' of demand with nothing to sell in between.';
      action = 'Shorten portions, stop preorders, run a special until then.';
    } else {
      sb = startBy(ing, now, r.runOutAt, r.unmetG);
      const verb = r.runOutCause === 'limit' ? ' is thrown out at ' : ' runs out at ';
      consequence = 'At the current pace ' + name + verb + U.fmtTime(r.runOutAt) + '.' + (sb && !sb.ahead ? ' ' + sb.text.split(' Shorten')[0] : sb ? '' : ' About ' + U.weightText(r.unmetG) + ' of demand will have nothing to sell.');
      action = sb && sb.ahead ? sb.text : 'Shorten portions, stop preorders, run a special.';
    }
    out.push({ id: 'shortfall:' + ing.id, kind: 'shortfall', ing: ing.id, label: name, at: r.runOutAt, msLeft: r.runOutAt - now, rung: 0, rungs: 0, sev: 'warn', leftoverG: r.leftoverG, shortG: r.unmetG, unmetG: r.runOutCause === 'rest-gap' ? r.gapUnmetG : r.unmetG,
      runOutCause: r.runOutCause, gapEndAt: r.gapEndAt, startBy: sb ? sb.latestStart : null, planFor: { ing: ing.id, grams: r.runOutCause === 'rest-gap' ? r.gapUnmetG : r.unmetG, by: r.runOutAt }, consequence, action, unknown: false });
  }
  // When a batch's early warnings are put off until, or 0 when they are not.
  function snoozeOf(state, batchId, now) { const t = state.alertSnoozes ? state.alertSnoozes[batchId] : 0; return U.isNum(t) && t > now ? t : 0; }
  // Rows for the cooked batches: expiry with projected waste, and run-out time, per ingredient.
  function batchRows(state, now, S, sales, out) {
    const byIng = Object.create(null);
    for (const b of state.batches) {
      if (b.status === 'discard' || !(b.remainingG > 0) || b.kind === 'cooling' || b.fridge === true) continue;
      // A batch past its quality limit is off the menu: it cannot sell, so it gets its own row and no projection.
      if (b.status === 'past') { pastRow(state, b, now, out); continue; }
      (byIng[b.ing] = byIng[b.ing] || []).push(b);
    }
    for (const ingId of Object.keys(byIng)) {
      const ing = state.ingredients.find((x) => x.id === ingId);
      const name = ing ? ing.name : ingId;
      const list = byIng[ingId].slice().sort((a, b) => a.enteredAt - b.enteredAt);
      const rungs = rungsFor(ingId, state.settings), rate = sales.rate[ingId];
      // The close sweep first: a quality limit that ends the supply is told in that batch's own expiry row.
      const ci = rate !== undefined ? closeInfo(state, ing, list, rate, now, S) : null;
      const lim = ci && ci.r.runOutCause === 'limit' && ci.r.limitQuality && ci.r.unmetG >= NOTABLE_G ? ci.r : null;
      const limSb = lim ? startBy(ing, now, lim.runOutAt, lim.unmetG) : null;
      // A quality limit is a house rule: the batch passes it and waits for a taste test. A kept batch counts down
      // to the end of its extension instead.
      const expInfo = (b) => {
        const hardAt = b.enteredAt + (U.isNum(S.hardCapH) ? S.hardCapH : S.defaultMaxHoldH) * H, limAt = b.enteredAt + E()._internal.holdLimitMs(b, S);
        const q = b.holdBasis === 'quality' && limAt < hardAt;
        return { q, exp: q && U.isNum(b.keepUntil) && b.keepUntil > now ? Math.min(b.keepUntil, hardAt) : limAt };
      };
      // WATCH OUT: per-batch waste must time-step like the close sweep. Subtracting older batches' sales over this
      // batch's whole window overstates waste when an older batch expires first.
      const wasteBy = rate !== undefined ? batchWaste(list.map((b, i) => ({ id: i, remainingG: b.remainingG, enteredAt: b.enteredAt, readyAt: b.restUntil, expAt: expInfo(b).exp })), rate, now) : null;
      list.forEach((b, i) => {
        const { q, exp } = expInfo(b);
        const msLeft = exp - now;
        const rung = rungOf(msLeft, rungs);
        const lastOne = list.length === 1;
        // How much of this batch the sales pace will not clear before it expires, oldest batch served first. A batch
        // that is still resting only sells from the moment it is ready.
        const waste = wasteBy ? (wasteBy[i] || 0) : null;
        // A few hundred grams left is not worth a warning: the row still shows but never sounds.
        const trivial = b.remainingG < TRIVIAL_G || (waste != null && waste < NOTABLE_G && waste < NOTABLE_SHARE * b.remainingG);
        const usd = waste != null && U.isNum(b.costPerCookedKg) ? waste / 1000 * b.costPerCookedKg : null;
        let consequence, action;
        const amount = U.weightText(b.remainingG) + (U.isNum(b.costPerCookedKg) ? ' (worth ' + U.currencySymbol() + (b.remainingG / 1000 * b.costPerCookedKg).toFixed(0) + ')' : '');
        const goes86 = lastOne ? ', and then ' + name + ' is sold out' : '';
        const fate = q ? 'go past its quality limit' : 'be thrown out';
        if (msLeft <= 0) { consequence = 'Expired: ' + amount + ' must be thrown out' + goes86 + '.'; action = 'Discard and log it.'; }
        else if (waste == null) { consequence = 'Up to ' + amount + ' may ' + fate + ' when the time is up' + goes86 + '.'; action = 'Use it first.'; }
        else if (waste > 50) { consequence = 'About ' + U.weightText(waste) + ' of ' + U.weightText(b.remainingG) + ' will ' + fate + (usd != null ? ' (worth ' + U.currencySymbol() + usd.toFixed(0) + ')' : '') + goes86 + '.'; action = 'Sell it: run a special, tell the front.'; }
        else { consequence = 'On pace to sell all ' + U.weightText(b.remainingG) + ' in time.'; action = 'Nothing to do.'; }
        // A batch gets a row once a rung is crossed, or earlier when the pace says food will be thrown out within 2 hours.
        const isLim = !!lim && lim.limitBatchId === b.id;
        if (isLim) {
          consequence = name + ' passes its quality limit at ' + U.fmtTime(exp) + ', with about ' + U.weightText(lim.unmetG) + ' of demand after it' + (waste != null && waste > 50 ? ' and about ' + U.weightText(waste) + ' of this batch unsold' : '') + '.';
          action = limSb ? limSb.text : 'Shorten portions, stop preorders, run a special.';
        }
        if (rung >= 1 || (waste != null && waste > 50 && msLeft <= 2 * H) || isLim) {
          const quiet = rung === 0 || trivial;
          out.push({ id: 'expiry:' + b.id + ':' + (q && U.isNum(b.keepUntil) && b.keepUntil > now ? b.keepUntil : 0), epoch: q && U.isNum(b.keepUntil) && b.keepUntil > now ? b.keepUntil : 0, kind: 'expiry', ing: ingId, batchId: b.id, label: b.label || name, at: exp, msLeft, rung, rungs: rungs.length, rungsMin: rungs, step: rung >= rungs.length ? 'last' : rung <= 1 ? 'first' : 'middle', snoozedUntil: snoozeOf(state, b.id, now),
            sev: quiet ? 'info' : sevOf(rung, rungs.length, lastOne), consequence, action, planFor: isLim ? { ing: ingId, grams: lim.unmetG, by: lim.runOutAt } : undefined, wasteG: waste, wasteUsd: usd, goes86: lastOne, quality: q, trivial, unknown: rate === undefined });
        }
      });
      // What is left at close, or when it runs out early, at the current pace.
      closeRows(ci, ing, name, now, out);
    }
  }
  // Rows for food-safety gates: a temperature check due, a reheat or chill decision, a cooling stage.
  function safetyRows(state, now, S, out) {
    for (const b of state.batches) {
      if (b.status === 'discard' || !(b.remainingG > 0)) continue;
      const gt = E().gate(b, now, S);
      if (gt.action === 'NONE' && !(b.kind === 'cooling')) {
        const due = gt.nextDeadlineAt;
        if (U.isNum(due) && due !== Infinity && due - now <= 15 * MIN && (b.fridge === true || b.enteredAt + E()._internal.holdLimitMs(b, S) > due)) {
          out.push({ id: 'check:' + b.id, kind: 'check', ing: b.ing, batchId: b.id, label: b.label || b.ing, at: due, msLeft: due - now, rung: 0, rungs: 0, sev: 'info',
            consequence: 'A temperature reading is due at ' + U.fmtTime(due) + '.', action: 'Log a temperature.', unknown: false });
        }
        continue;
      }
      if (gt.action === 'NONE' || gt.action === 'DISCARD_LOCKOUT' || gt.action === 'PAST_QUALITY') continue;
      const at = U.isNum(gt.nextDeadlineAt) && gt.nextDeadlineAt !== Infinity ? gt.nextDeadlineAt : now;
      const kind = gt.action === 'CHECK_TEMP' ? 'check' : gt.action === 'REHEAT_IMMEDIATE' ? 'reheat' : gt.action === 'CHILL_NOW' ? 'chill' : 'cooling';
      const text = (gt.text || '').replace(' ' + C.safetyLine, '');
      out.push({ id: kind + ':' + b.id, kind, ing: b.ing, batchId: b.id, label: b.label || b.ing, at, msLeft: at - now, rung: 0, rungs: 0, sev: gt.severity === 'bad' ? 'bad' : 'warn',
        consequence: text, action: kind === 'check' ? 'Log a temperature.' : kind === 'reheat' ? 'Reheat it and log the reading.' : kind === 'chill' ? 'Chill it now.' : 'Log a reading as it cools.', unknown: false });
    }
  }
  // Plain words about a cold batch kept in a fridge, for a card line or a call-out: where it is, the date mark and the time left
  // against the owner's own limits. Never states a rule: it says "your limit". Returns '' for any other batch.
  function coldLine(b, now) {
    const c = E().coldInfo(b, now);
    if (!c) return '';
    const parts = [c.place === 'line' ? 'Out of the fridge' + (c.outSince != null ? ' since ' + U.fmtTime(c.outSince) : '') : 'In the fridge'];
    if (c.madeOn) parts.push('made ' + U.fmtDateShort(c.madeOn));
    if (c.fridgeDays != null) parts.push('your fridge limit ' + c.fridgeDays + (c.fridgeDays === 1 ? ' day' : ' days') + ', last day ' + U.fmtDateShort(c.useBy));
    if (c.outHours != null) parts.push(c.outMs > 0 || c.place === 'line' ? U.fmtDur(c.outMs) + ' out so far, ' + (c.outLeftMs > 0 ? U.fmtDur(c.outLeftMs) + ' left of' : 'over') + ' your ' + c.outHours + '-hour limit' : 'your out-of-fridge limit ' + c.outHours + ' hours');
    if (c.noLimit) parts.push('no limit set');
    else if (c.outHours == null && c.fridgeDays != null) parts.push('no out-of-fridge limit set');
    else if (c.fridgeDays == null && c.outHours != null) parts.push('no fridge limit set');
    return parts.join(' - ');
  }
  // Rows for cold batches kept in a fridge: the out-of-fridge hours running low, and the last day of the fridge limit. The words
  // say "your limit"; the app does not know the local rule.
  function coldRows(state, now, out) {
    for (const b of state.batches) {
      if (b.fridge !== true || b.status === 'discard' || !(b.remainingG > 0)) continue;
      const c = E().coldInfo(b, now);
      const label = b.label || b.ing;
      if (c.place === 'line' && c.outLeftMs != null && c.outLeftMs <= 30 * MIN) {
        out.push({ id: 'coldout:' + b.id, epoch: 0, kind: 'coldOut', ing: b.ing, batchId: b.id, label, at: now + c.outLeftMs, msLeft: c.outLeftMs, rung: 0, rungs: 0, sev: c.outLeftMs <= 10 * MIN ? 'bad' : 'warn',
          consequence: c.outLeftMs > 0 ? U.fmtDur(c.outLeftMs) + ' left of your ' + c.outHours + '-hour limit out of the fridge.' : 'Past your ' + c.outHours + '-hour limit out of the fridge.', action: 'Put it back in the fridge, or use it. Your food-safety plan comes first.', unknown: false });
      }
      if (c.fridgeLeftMs != null && c.fridgeLeftMs <= 6 * H) {
        out.push({ id: 'colddate:' + b.id, epoch: 0, kind: 'coldDate', ing: b.ing, batchId: b.id, label, at: now + c.fridgeLeftMs, msLeft: c.fridgeLeftMs, rung: 0, rungs: 0, sev: c.fridgeLeftMs <= 2 * H ? 'bad' : 'warn',
          consequence: 'The last day of your fridge limit (' + U.fmtDateShort(c.useBy) + ') ends at midnight.', action: 'Use it today, or check it against your food-safety plan.', unknown: false });
      }
    }
  }
  // Rows for batches that expired and were thrown out in the last 30 minutes, so the loss is not silent.
  function expiredRows(state, now, out) {
    for (const b of state.batches) {
      if (b.status !== 'discard' || !(b.discardReason === 'expired' || b.discardReason === 'fridgeDate' || b.discardReason === 'outTime') || !U.isNum(b.discardedAt) || now - b.discardedAt > 30 * MIN || !(b.wasteG >= TRIVIAL_G)) continue;
      const ing = state.ingredients.find((x) => x.id === b.ing);
      const name = ing ? ing.name : b.ing;
      const left = state.batches.some((x) => x.ing === b.ing && x.status !== 'discard' && x.remainingG > 0 && x.kind !== 'cooling');
      const usd = U.isNum(b.costPerCookedKg) && b.wasteG > 0 ? ' (' + U.currencySymbol() + (b.wasteG / 1000 * b.costPerCookedKg).toFixed(0) + ')' : '';
      out.push({ id: 'expired:' + b.id + ':0', epoch: 0, kind: 'expired', step: 'last', ing: b.ing, batchId: b.id, label: b.label || name, at: b.discardedAt, msLeft: b.discardedAt - now, rung: 0, rungs: 0, sev: 'bad',
        consequence: (b.discardReason === 'expired' ? 'Expired and thrown out: ' : 'Past your limit and thrown out: ') + U.weightText(b.wasteG) + usd + (left ? '.' : '. ' + name + ' is sold out.'), action: 'Tap to confirm it is logged.', unknown: false });
    }
  }
  // Rows for batches that are being kept serving: shown from 15 minutes before the extension ends, or when the last
  // reading is older than the check interval, to say what is needed to keep it longer. Information only: no sound.
  function keepRows(state, now, S, out) {
    for (const b of state.batches) {
      if (b.status === 'discard' || !U.isNum(b.keepUntil) || !(b.keepUntil > now)) continue;
      const stale = !U.isNum(b.lastTempAt) || now - b.lastTempAt > S.tempCheckEveryMin * MIN;
      if (b.keepUntil - now > 15 * MIN && !stale) continue;
      const cold = b.kind === 'cold';
      const need = cold ? U.tempText(S.coldHoldF) + ' or lower' : U.tempText(S.hotHoldF) + ' or higher';
      out.push({ id: 'keepcheck:' + b.id + ':' + b.keepUntil, epoch: b.keepUntil, kind: 'keepcheck', ing: b.ing, batchId: b.id, label: b.label || b.ing, at: b.keepUntil, msLeft: b.keepUntil - now, rung: 0, rungs: 0, sev: 'info',
        consequence: 'Kept serving until ' + U.fmtTime(b.keepUntil) + '. Log a temperature of ' + need + ' before then to keep it longer.', action: 'Log a temperature.', unknown: false });
    }
  }
  // Rows for tickets and the sanitize timer.
  function otherRows(state, now, out) {
    const C0 = E().views.counts(state, now);
    // One late ticket already says so itself (red, "Do this first"); a strip row for it would say the same thing twice.
    if (C0.overdue > 1) out.push({ id: 'late', kind: 'late', label: 'Late tickets', at: now, msLeft: 0, rung: 0, rungs: 0, sev: 'warn',
      consequence: C0.overdue + ' ' + U.plural(C0.overdue, 'ticket is', 'tickets are') + ' past ' + U.plural(C0.overdue, 'its', 'their') + ' time limit.', action: 'Clear the oldest ticket first.', unknown: false });
    if (U.isNum(C0.sanitizeDueAt) && C0.sanitizeDueAt - now <= 15 * MIN) {
      const late = C0.sanitizeDueAt < now;
      out.push({ id: 'sanitize', kind: 'sanitize', label: 'Sanitize surfaces', at: C0.sanitizeDueAt, msLeft: C0.sanitizeDueAt - now, rung: 0, rungs: 0, sev: late && now - C0.sanitizeDueAt > 15 * MIN ? 'warn' : 'info',
        consequence: late ? 'Food-contact surfaces are overdue for sanitizing.' : 'Food-contact surfaces are due for sanitizing at ' + U.fmtTime(C0.sanitizeDueAt) + '.', action: 'Sanitize and tick it off.', unknown: false });
    }
  }
  // The hour of day (0 to 24 and a fraction) that warning sounds may start: the sound start hour, or opening if that
  // is earlier. Returns the service settings with it.
  function soundWindow(state) {
    const sv = state && state.settings && state.settings.service ? state.settings.service : C.service;
    const start = Math.min(U.isNum(sv.soundStartHour) ? sv.soundStartHour : sv.openHour, sv.openHour);
    return { start, end: sv.closeHour, all: sv.soundOutsideHours === true };
  }
  // True when warning sounds may play: from the sound start hour (opening unless set earlier) to closing, or any
  // hour when the owner allows sound outside open hours. Before that and after closing the strip still shows the
  // rows, but nothing beeps or speaks into an empty kitchen. Rungs missed while quiet sound once when it opens.
  function soundsAllowed(state, now) {
    if (!state || !U.isNum(now)) return false;
    const w = soundWindow(state);
    if (w.all) return true;
    const d = new Date(now);
    const hr = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    return (hr >= w.start && hr < w.end) || (hr + 24 >= w.start && hr + 24 < w.end);
  }
  // The next moment warning sounds start, or null when they may sound now.
  function nextOpenAt(state, now) {
    if (!state || !U.isNum(now) || soundsAllowed(state, now)) return null;
    const w = soundWindow(state);
    const whole = Math.floor(w.start), mins = Math.round((w.start - whole) * 60);
    for (let day = 0; day < 3; day++) {
      const d = new Date(now);
      d.setDate(d.getDate() + day); d.setHours(whole, mins, 0, 0);
      if (d.getTime() > now) return d.getTime();
    }
    return null;
  }
  // The words for the strip while sounds are paused, for example "Sound paused: kitchen closed until 11:00 am", or null.
  function pauseNote(state, now) {
    const at = nextOpenAt(state, now);
    return at == null ? null : 'Sound paused: kitchen closed until ' + U.fmtTime(at);
  }
  // How long a loud tone waits before repeating while nobody has tapped the row: 20 seconds of kitchen time.
  const LOUD_REPEAT_MS = 20e3;
  // Ladder memory entries older than this (kitchen time) are dropped.
  const LADDER_KEEP_MS = 24 * H;
  // The warning ladder as a pure object, so it can be tested without a screen. It remembers, per deadline id, the
  // rung already announced, the rung a person acknowledged by tapping, and when the loud tone last played.
  //   decide(feed, now, state) returns the sounds due right now as [{ level, d, repeat }] (level 1 chime, 2 voice,
  //   3 loud tone, 4 expiry or past) and updates the memory. now is kitchen time (the app clock), so the loud-tone
  //   spacing follows the same clock as everything else.
  //   A row whose id carries a new epoch (a keep that changed keepUntil) starts a fresh entry with every rung
  //   already crossed marked announced and acknowledged, so tapping "keep serving" never beeps by itself; the later
  //   rungs, the end of the extension and each lapse sound as usual. Past and expired notices always sound once.
  //   Entries for batches that are gone, and entries older than 24 hours, are dropped.
  function makeLadder() {
    const memory = new Map();
    // Decides the sound for one deadline row, or null. The memory per row keeps the smallest threshold (in minutes) that
    // has been announced, so editing the ladder mid-countdown cannot replay or degrade a warning. Which sound a rung
    // makes follows its place in the list: the first of several is a chime, the ones between are voice calls, the last
    // is the loud tone with speech (a one-rung list is just the loud tone).
    function one(d, now) {
      let st = memory.get(d.id);
      if (d.kind === 'expired' || d.kind === 'past') {
        if (st) return null;
        memory.set(d.id, { minAnn: 0, ack: false, loudAt: -Infinity, batchId: d.batchId, born: now, sig: '' });
        return d.trivial ? null : { level: 4, d, repeat: false };
      }
      if (d.kind !== 'expiry' || d.rung < 1) return null;
      const R = Array.isArray(d.rungsMin) && d.rungsMin.length ? d.rungsMin : rungsFor(d.ing);
      const sig = R.join(',');
      const fresh = !st;
      if (fresh) { st = { minAnn: Infinity, ack: false, loudAt: -Infinity, batchId: d.batchId, born: now, sig }; memory.set(d.id, st); }
      const crossed = R.filter((m) => d.msLeft <= m * MIN);
      const cur = crossed.length ? Math.min.apply(null, crossed) : Infinity;
      const lastMin = R[R.length - 1];
      // No sound when it is on pace to sell out in time, or when almost nothing is left in the batch.
      if (d.trivial || (U.isNum(d.wasteG) && d.wasteG <= 50)) { st.minAnn = Math.min(st.minAnn, cur); st.sig = sig; return null; }
      // A new extension epoch: everything already crossed counts as announced.
      if (fresh && d.epoch) { st.minAnn = cur; st.ack = true; return null; }
      // The thresholds were edited since this row was last looked at: rungs already crossed count as announced, except the last, which always sounds in full.
      if (st.sig !== sig) {
        st.sig = sig;
        const earlier = crossed.filter((m) => m !== lastMin);
        if (earlier.length) st.minAnn = Math.min(st.minAnn, Math.min.apply(null, earlier));
      }
      // At the very limit the batch is still alive for one more tick; its own past or expired row sounds next, so this one stays quiet (else the same moment sounds twice).
      if (d.msLeft <= 0) { st.minAnn = Math.min(st.minAnn, cur); return null; }
      const last = cur === lastMin;
      if (cur < st.minAnn) {
        // Put off with "remind me later": the chime and voice rungs wait (and sound when the time is up); the last rung never does.
        if (d.snoozedUntil > now && !last) return null;
        st.minAnn = cur; st.ack = false;
        if (last) { st.loudAt = now; return { level: 3, d, repeat: false }; }
        if (R.indexOf(cur) >= 1) return { level: 2, d, repeat: false };
        // With no pace to show waste, the first (soft) rung stays silent: it would chime for food that may sell.
        return d.unknown ? null : { level: 1, d, repeat: false };
      }
      if (last && !st.ack && now - st.loudAt >= LOUD_REPEAT_MS) { st.loudAt = now; return { level: 3, d, repeat: true }; }
      return null;
    }
    // Drops entries for batches that no longer exist and entries older than 24 hours of kitchen time.
    function prune(state, now) {
      const alive = new Set(state && Array.isArray(state.batches) ? state.batches.map((b) => b.id) : []);
      for (const [id, st] of memory) if ((state && st.batchId && !alive.has(st.batchId)) || now - st.born > LADDER_KEEP_MS) memory.delete(id);
    }
    return {
      memory,
      decide(feed, now, state) { prune(state, now); const calls = []; for (const d of feed) { const c = one(d, now); if (c) calls.push(c); } return calls; },
      // A tap on a row counts as seeing it: the loud tone stops until the next rung.
      acknowledge(id) { const st = memory.get(id); if (st) st.ack = st.minAnn < Infinity; },
      // True when the row has been acknowledged.
      isAcked(id) { const st = memory.get(id); return !!(st && st.ack); },
      size: () => memory.size,
    };
  }
  // Which tab makes the sound when the lock service is missing: from the hellos heard (and this tab), the visible tab wins,
  // then the lowest tab id, among tabs that can make sound. A tab not heard from for 15 seconds is gone. hellos:
  // [{ tab, visible, eligible, t }]; the answer is true when selfId is the one.
  function electLeader(hellos, now, selfId) {
    const live = (hellos || []).filter((x) => x && x.eligible && (x.tab === selfId || now - x.t <= 15000));
    if (!live.some((x) => x.tab === selfId)) return false;
    live.sort((a, b) => ((b.visible ? 1 : 0) - (a.visible ? 1 : 0)) || (a.tab < b.tab ? -1 : a.tab > b.tab ? 1 : 0));
    return live[0].tab === selfId;
  }
  // The sounds a follower tab held back, so a sound is not lost when the tab that should have played it goes away.
  //   add(call) keeps one (key: row id, level and epoch); played(keys) forgets what the leader played; forget(id) forgets a
  //   row someone acknowledged; drain(feed, isAcked) returns the one strongest call that is still true now (its row is
  //   still in the feed, not acknowledged, and for warnings the batch is not past its time) and empties the queue.
  function makePending() {
    const q = new Map(), done = new Map();
    // The key that names one held sound: its row, its level and its keep epoch.
    const keyOf = (c) => c.d.id + ':' + c.level + ':' + (c.d.epoch || 0);
    return {
      // A sound the leader already played (its message can arrive before this tab has even decided) is not held back.
      add(c, now) { const t = U.isNum(now) ? now : Date.now(), k = keyOf(c); if (done.has(k) && t - done.get(k) < 60000) return; q.set(k, c); },
      played(keys, now) { const t = U.isNum(now) ? now : Date.now(); for (const k of keys || []) { q.delete(k); done.set(k, t); } if (done.size > 200) for (const [k, v] of done) if (t - v > 60000) done.delete(k); },
      // Forgets every held sound for one row (someone acknowledged it).
      forget(id) { for (const k of Array.from(q.keys())) if (q.get(k).d.id === id) q.delete(k); },
      // Takes what is still true out of the queue: the one strongest sound, or nothing.
      drain(feed, isAcked) {
        const live = new Map((feed || []).map((d) => [d.id, d]));
        const ok = Array.from(q.values()).filter((c) => { const d = live.get(c.d.id); return d && (d.epoch || 0) === (c.d.epoch || 0) && !isAcked(d.id) && (c.level === 4 || d.msLeft > 0); });
        q.clear();
        if (!ok.length) return [];
        ok.sort((a, b) => (b.level - a.level) || (a.d.msLeft - b.d.msLeft));
        return [{ level: ok[0].level, d: live.get(ok[0].d.id), repeat: false }];
      },
      // Says how many sounds are being held back right now.
      size: () => q.size,
    };
  }
  // Voice call-outs: a short spoken line for a new ticket and for "start this dish now" when a dish's planned start
  // (fireAt) arrives. Nothing here speaks; it only works out what is worth saying and in what order.

  // A call older than this (45 s) is stale and dropped instead of read out late; at most this many calls wait (6).
  const CALL_STALE_MS = 45e3, CALL_MAX_WAIT = 6;
  // A dish name made speakable: the short name, with the abbreviation dot spelled out.
  const spokenName = (it) => String(it.short || it.name || 'item').replace(/ sand\.$/, ' sandwich');
  // Joins up to three dishes ("2 brisket, ribs and 1 more") for a spoken line.
  function nameList(items) {
    const bits = items.slice(0, 3).map((it) => (it.qty > 1 ? it.qty + ' ' : '') + spokenName(it));
    return bits.join(', ') + (items.length > 3 ? ' and ' + (items.length - 3) + ' more' : '');
  }
  /* ---------- making text speakable: numbers, units, times and symbols the way a person says them ---------- */
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  // A whole number in words ("twenty-eight", "four hundred fifty"); numbers over a million stay as digits.
  function numWords(n) {
    n = Math.floor(Math.abs(Number(n)) || 0);
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
    if (n < 1e6) return numWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numWords(n % 1000) : '');
    return String(n);
  }
  // A number that may have a fraction, in words: 4.5 is "four and a half", 0.25 is "a quarter", 4.2 is "four point two".
  function amountWords(x) {
    const neg = x < 0 ? 'minus ' : '', a = Math.abs(x), whole = Math.floor(a + 1e-9), frac = Math.round((a - whole) * 100) / 100;
    if (!frac) return neg + numWords(whole);
    const word = frac === 0.5 ? 'a half' : frac === 0.25 ? 'a quarter' : frac === 0.75 ? 'three quarters' : null;
    if (word) return neg + (whole ? numWords(whole) + ' and ' + word : word === 'a half' ? 'half' : word);
    const digits = String(frac).slice(2).split('').map((c) => ONES[Number(c)]).join(' ');
    return neg + numWords(whole) + ' point ' + digits;
  }
  // A count of one unit in words ("one hour", "twenty minutes"); the unit is singular only for exactly one.
  const unitWords = (n, one, many) => amountWords(n) + ' ' + (Math.abs(n) === 1 ? one : many);
  // Turns a line meant for the screen into one a speech voice reads well: no raw abbreviations, digits or symbols. Pure; the same text
  // always gives the same words. "4.50 kg" is "four and a half kilograms", "1:20" is "one minute twenty seconds", "#12" is "ticket twelve".
  function spoken(text) {
    let t = ' ' + String(text == null ? '' : text) + ' ';
    t = t.replace(/(\d),(\d{3})\b/g, '$1$2');
    // clock times first: 2:41 pm
    t = t.replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/gi, (m, h, mi, ap) => { const mm = Number(mi); return ' ' + numWords(Number(h)) + (mm === 0 ? '' : mm < 10 ? ' oh ' + numWords(mm) : ' ' + numWords(mm)) + (ap.toLowerCase() === 'a' ? ' A M' : ' P M') + ' '; });
    // timer forms: 1:20 is one minute twenty seconds, 0:45 is forty-five seconds, 10:00 is ten minutes
    t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, a, b) => { const mn = Number(a), sc = Number(b); return ' ' + (mn ? unitWords(mn, 'minute', 'minutes') : '') + (mn && sc ? ' ' : '') + (sc || !mn ? unitWords(sc, 'second', 'seconds') : '') + ' '; });
    // durations: 1 h 20 min, 2h 10m, 25 min, 1 hour
    t = t.replace(/\b(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m(?:ins?|inutes?)?\b/gi, (m, h, mi) => ' ' + unitWords(Number(h), 'hour', 'hours') + ' ' + unitWords(Number(mi), 'minute', 'minutes') + ' ');
    t = t.replace(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/gi, (m, h) => ' ' + unitWords(Number(h), 'hour', 'hours') + ' ');
    t = t.replace(/\b(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/gi, (m, v) => ' ' + unitWords(Number(v), 'minute', 'minutes') + ' ');
    t = t.replace(/\b(\d+)\s*(?:seconds?|secs?|s)\b/gi, (m, v) => ' ' + unitWords(Number(v), 'second', 'seconds') + ' ');
    // temperatures, weights, money, percent
    t = t.replace(/(-?\d+(?:\.\d+)?)\s*°\s*([FC])?/g, (m, v, u) => ' ' + amountWords(Number(v)) + ' degrees' + (u ? (u === 'F' ? ' Fahrenheit' : ' Celsius') : '') + ' ');
    t = t.replace(/(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz)\b/gi, (m, v, u) => { const k = u.toLowerCase(), n = Number(v); const nm = k === 'kg' ? ['kilogram', 'kilograms'] : k === 'g' ? ['gram', 'grams'] : k === 'oz' ? ['ounce', 'ounces'] : ['pound', 'pounds']; return ' ' + (n === 0.5 ? 'half a ' + nm[0] : unitWords(n, nm[0], nm[1])) + ' '; });
    t = t.replace(/\$\s*(\d+)(?:\.(\d{2}))?/g, (m, d, c) => ' ' + unitWords(Number(d), 'dollar', 'dollars') + (c && Number(c) ? ' ' + numWords(Number(c)) : '') + ' ');
    t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, (m, v) => ' ' + amountWords(Number(v)) + ' percent ');
    // tickets, counts and fractions
    t = t.replace(/#\s*(\d+)/g, (m, v) => ' ticket ' + numWords(Number(v)) + ' ');
    t = t.replace(/\+\s*(\d+)\s+more\b/gi, (m, v) => ' and ' + numWords(Number(v)) + ' more');
    t = t.replace(/(?:\b|\s)[x×]\s*(\d+)\b/g, (m, v) => ' ' + numWords(Number(v)) + ' of them ');
    t = t.replace(/\b(\d+)\s*[x×](?=\s|$|[,.!])/g, (m, v) => ' ' + numWords(Number(v)) + ' ');
    t = t.replace(/\b1\/2\b/g, ' half ').replace(/\b1\/4\b/g, ' quarter ').replace(/\b3\/4\b/g, ' three quarters ');
    // names and symbols
    t = t.replace(/\bsand\./gi, 'sandwich').replace(/\bapprox\.?/gi, 'about').replace(/&/g, ' and ').replace(/\bvs\.?\b/gi, ' versus ');
    t = t.replace(/(\d+(?:\.\d+)?)/g, (m, v) => ' ' + amountWords(Number(v)) + ' ');
    t = t.replace(/[#*_~^|<>\[\]{}()\\/]/g, ' ').replace(/[+=]/g, ' plus ');
    t = t.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Keeps a spoken line short (about 14 words): cuts at the last sentence end inside the limit, else at the limit, and ends it with a stop.
  function clipWords(text, max) {
    const lim = max || 14, words = String(text).split(' ');
    if (words.length <= lim) return text;
    const cut = words.slice(0, lim).join(' ');
    const stop = Math.max(cut.lastIndexOf('! '), cut.lastIndexOf('. '), cut.lastIndexOf('? '));
    return (stop > 8 ? cut.slice(0, stop + 1) : cut.replace(/[,;:]$/, '') + '.');
  }
  // How a line is delivered: calm for a heads-up, brisk for a new ticket, fast and loud for "fire now" and past quality. rate and pitch are
  // multiples of normal speech, volume is 0 to 1. kind is the phrase kind.
  const DELIVERY = {
    expire: { rate: 1.0, pitch: 1.0, volume: 0.85 }, new_all: { rate: 1.1, pitch: 1.05, volume: 0.9 }, new_zone: { rate: 1.1, pitch: 1.05, volume: 0.9 },
    summary: { rate: 1.1, pitch: 1.05, volume: 0.9 }, ready: { rate: 1.1, pitch: 1.05, volume: 0.9 }, start: { rate: 1.2, pitch: 1.15, volume: 1 },
    start_again: { rate: 1.25, pitch: 1.2, volume: 1 }, ready_again: { rate: 1.2, pitch: 1.15, volume: 1 }, past: { rate: 1.2, pitch: 1.15, volume: 1 },
    expired: { rate: 1.25, pitch: 1.2, volume: 1 },
  };
  // The rate, pitch and volume for one kind of line (a plain heads-up if the kind is unknown).
  function delivery(kind) { return DELIVERY[kind] || DELIVERY.expire; }
  // The kitchen's voice is one fixed style: a fast, sharp chef calling the line. Rate and pitch for the speech engine.
  const CHEF_VOICE = { rate: 1.15, pitch: 1.1 };
  // One spoken line in the chef's voice. kind is new_all, new_zone, start, expire, past or expired; d holds the numbers
  // and names. Short, loud and to the point, the way a chef calls the pass.
  function phrase(kind, d) {
    // A length of time for a heads-up: minutes under an hour, else hours and minutes.
    const dur = (mins) => (mins < 60 ? mins + ' ' + U.plural(mins, 'minute') : Math.floor(mins / 60) + ' h ' + (mins % 60 ? (mins % 60) + ' min' : '')).trim();
    let t;
    if (kind === 'new_all') t = 'Order up! Ticket ' + d.num + '! ' + d.count + ' ' + U.plural(d.count, 'item') + '!';
    else if (kind === 'new_zone') t = 'Order up, ticket ' + d.num + '! ' + d.names + '!';
    else if (kind === 'summary') t = d.count + ' new tickets. First up, ticket ' + d.first + '.';
    else if (kind === 'start') t = 'Fire ' + d.name + ' now! Ticket ' + d.num + '!';
    else if (kind === 'start_again') t = 'Still waiting on ' + d.name + '! Fire it now! Ticket ' + d.num + '!';
    else if (kind === 'step') t = d.name + ': ' + d.say + '! Ticket ' + d.num + '!';
    else if (kind === 'ready') t = 'Ticket ' + d.num + ' is up! Ring it out!';
    else if (kind === 'ready_again') t = 'Ticket ' + d.num + ' is waiting! Ring it out now!';
    else if (kind === 'past') t = d.who + (d.many ? ' are past quality!' : ' is past quality!') + ' Check it now!';
    else if (kind === 'expired') t = d.who + ' expired! Pull it and log it now!';
    else t = 'Heads up! ' + d.who + (d.goes86 && !d.many ? ' runs out' : d.many ? ' expire' : ' expires') + ' in ' + (d.approx ? 'about ' : '') + dur(d.mins) + '! Act now!';
    return clipWords(spoken(t), 14);
  }
  // Picks the voice that speaks: the one the owner chose in Settings when this device still has it, else the best-sounding
  // English voice the device has (natural, neural or online ones first, then premium, Google and well-known named voices);
  // null when there is none, so the device default is used.
  function pickVoice(voices, chosen) {
    if (typeof chosen === 'string' && chosen) { const c = (voices || []).find((v) => v && v.name === chosen); if (c) return c; }
    const NOVELTY = /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|ralph|kathy|princess|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i;
    const en = (voices || []).filter((v) => v && /^en/i.test(String(v.lang || '').replace('_', '-')) && !NOVELTY.test(String(v.name || '')));
    // How good a voice sounds for a kitchen call, higher is better. Voices stored on the tablet come first (a kitchen may be offline and
    // a network voice can stall); then the better-sounding names; novelty voices are avoided.
    const score = (v) => {
      const n = String(v.name || '');
      let sc = 0;
      if (v.localService === true) sc += 50; else if (v.localService === false) sc -= 5;
      if (/premium|enhanced|siri/i.test(n)) sc += 30;
      if (/natural|neural/i.test(n)) sc += 12;
      if (/google/i.test(n)) sc += 14;
      if (/samantha|daniel|aaron|nicky|karen|moira|alex|aria|jenny|guy|ava|allison|zira|david|mark|susan|tessa|arthur|serena/i.test(n)) sc += 10;
      if (/en[-_]us/i.test(String(v.lang))) sc += 5; else if (/en[-_](gb|au|ie|ca)/i.test(String(v.lang))) sc += 3;
      if (/^en-us-x-[a-z]{3}#(female|male)_\d-local$/i.test(n)) sc += 8;
      return sc;
    };
    let best = null, bs = -Infinity;
    for (const v of en) { const sc = score(v); if (sc > bs) { best = v; bs = sc; } }
    return best;
  }
  // Which voice would speak right now and whether it lives on the tablet, for the Test the voice line: { name, lang, local } or null.
  function voiceInfo(voices, chosen) {
    const v = pickVoice(voices, chosen);
    return v ? { name: String(v.name || 'Default'), lang: String(v.lang || ''), local: v.localService !== false } : null;
  }
  // How much the voice talks, per level. repeatStartSec is the gap between "still waiting" reminders for a dish that is
  // due and not started, up to startRepeats of them; readyRepeats is how many "ring it out" reminders follow a finished
  // ticket (every readyRepeatSec); newTicket says whether a new ticket gets its own call.
  const VOICE_LEVELS = {
    light: { newTicket: false, startRepeats: 0, repeatStartSec: 0, readyRepeats: 0, readyRepeatSec: 0 },
    normal: { newTicket: true, startRepeats: 1, repeatStartSec: 25, readyRepeats: 1, readyRepeatSec: 30 },
    full: { newTicket: true, startRepeats: 4, repeatStartSec: 20, readyRepeats: 2, readyRepeatSec: 30 },
  };
  // The settings for a level name; an unknown name gets normal.
  function voiceLevel(level) { return VOICE_LEVELS[level] || VOICE_LEVELS.normal; }
  // Every call that is true right now for one station tab: { id, kind, at, text, ticketNum }. kind is "new" (a ticket
  // arrived), "start" (dishes whose start time has come, said again as a reminder while they wait), or "ready" (every dish
  // on a ticket is done: ring it out, said again while it waits). zone is "all", a station id, or "expo" (tickets only, no
  // start calls). level is light, normal or full (how much the voice talks).
  // WATCH OUT: a station only gets calls for its own dishes; a ticket with nothing for it makes no call.
  function calloutWants(state, now, zone, level) {
    const out = [];
    if (!state || !Array.isArray(state.tickets) || !U.isNum(now)) return out;
    const z = zone || 'all', cfg = voiceLevel(level);
    for (const t of state.tickets) {
      if (t.status !== 'active' || !Array.isArray(t.items) || !t.items.length) continue;
      // Everything done: the counter and expo hear "ring it out".
      if (t.items.every((it) => it.status === 'done')) {
        if (z !== 'all' && z !== 'expo') continue;
        const readyAt = t.items.reduce((m, it) => Math.max(m, U.isNum(it.doneAt) ? it.doneAt : 0), 0) || t.createdAt;
        out.push({ id: 'r:' + t.id, kind: 'ready', style: 'ready', at: readyAt, text: phrase('ready', { num: t.num }), ticketNum: t.num });
        for (let k = 1; k <= cfg.readyRepeats; k++) {
          const at = readyAt + k * cfg.readyRepeatSec * 1000;
          if (now >= at) out.push({ id: 'r:' + t.id + ':' + k, kind: 'ready', style: 'ready_again', at, text: phrase('ready_again', { num: t.num }), ticketNum: t.num });
        }
        continue;
      }
      const mine = t.items.filter((it) => (z === 'all' || z === 'expo' || it.zone === z) && it.status !== 'done');
      if (!mine.length) continue;
      if (cfg.newTicket) {
        const text = z === 'all' || z === 'expo' ? phrase('new_all', { num: t.num, count: t.items.length }) : phrase('new_zone', { num: t.num, names: nameList(mine) });
        out.push({ id: 'n:' + t.id, kind: 'new', style: z === 'all' || z === 'expo' ? 'new_all' : 'new_zone', at: t.createdAt, text, ticketNum: t.num });
      }
      if (z === 'expo') continue;
      // Dishes that are due and not started, grouped by the second they became due so one ticket makes one call.
      const groups = new Map();
      for (const it of mine) {
        const due = it.status === 'displayed' || (it.status === 'queued' && it.fireAt <= now);
        if (!due || !U.isNum(it.fireAt)) continue;
        const key = Math.floor(it.fireAt / 1000);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }
      // Cook steps: while a dish cooks, each step the owner set for it is called when its share of the cook time has passed.
      const menuById = new Map((state.menu || []).map((x) => [x.id, x]));
      for (const it of mine) {
        if (it.status !== 'cooking' || !U.isNum(it.startedAt) || !(it.prepSec > 0)) continue;
        const md = menuById.get(it.menuId);
        if (!md || !Array.isArray(md.steps)) continue;
        md.steps.forEach((st, i) => {
          const at = it.startedAt + Math.round(it.prepSec * 10 * st.at);
          if (now >= at) out.push({ id: 'c:' + t.id + ':' + it.id + ':' + i, kind: 'step', style: 'start', at, text: phrase('step', { name: it.short || it.name, say: st.say, num: t.num }), ticketNum: t.num });
        });
      }
      for (const [key, its] of groups) {
        const at = key * 1000, name = nameList(its);
        out.push({ id: 's:' + t.id + ':' + key, kind: 'start', style: 'start', at, text: phrase('start', { name, num: t.num }), ticketNum: t.num });
        for (let k = 1; k <= cfg.startRepeats; k++) {
          const rat = at + k * cfg.repeatStartSec * 1000;
          if (now >= rat) out.push({ id: 's:' + t.id + ':' + key + ':' + k, kind: 'start', style: 'start_again', at: rat, text: phrase('start_again', { name, num: t.num }), ticketNum: t.num });
        }
      }
    }
    return out;
  }
  // The waiting line of calls. sync(wants, now) takes the calls that are true now: new ones join, ones no longer true
  // (bumped, started) and ones older than the stale limit leave, and only the newest few are kept. next(now) hands out
  // the oldest call still fresh, or null. prime(wants) marks what is already true as heard, for a fresh start.
  function makeCallouts(o) {
    const staleMs = o && U.isNum(o.staleMs) ? o.staleMs : CALL_STALE_MS, maxWait = o && U.isNum(o.maxWait) ? o.maxWait : CALL_MAX_WAIT;
    const seen = new Set(), q = [], lostNew = [];
    let dropped = 0;
    // Remembers a call id as handled; the memory is trimmed to the latest 600.
    const mark = (id) => { seen.add(id); if (seen.size > 600) seen.delete(seen.values().next().value); };
    return {
      // Marks the calls true right now as already heard and empties the waiting line.
      prime(wants) { q.length = 0; (wants || []).forEach((w) => mark(w.id)); },
      // Brings the waiting line in step with what is true now; drops gone, stale and surplus calls.
      sync(wants, now) {
        const live = new Set(wants.map((w) => w.id));
        for (let i = q.length - 1; i >= 0; i--) if (!live.has(q[i].id) || now - q[i].at > staleMs) { q.splice(i, 1); dropped++; }
        for (const w of wants) {
          if (seen.has(w.id)) continue;
          mark(w.id);
          if (now - w.at > staleMs) { dropped++; continue; }
          q.push(w);
        }
        q.sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : 1));
        while (q.length > maxWait) { const lost = q.shift(); dropped++; if (lost.kind === 'new') lostNew.push(lost); }
      },
      // Hands out the oldest call that is still fresh, or null when none is left.
      next(now) {
        for (let i = q.length - 1; i >= 0; i--) if (now - q[i].at > staleMs) { q.splice(i, 1); dropped++; }
        if (!q.length) return null;
        // Three or more new-ticket calls waiting become one summary line, so a burst is not a wall of speech.
        const news = lostNew.filter((c) => now - c.at <= staleMs).concat(q.filter((c) => c.kind === 'new')).sort((a, b) => a.at - b.at);
        if (news.length >= 3 && !q.some((c) => c.kind === 'start' && c.at <= news[0].at)) {
          for (const c of news) { const i = q.indexOf(c); if (i >= 0) q.splice(i, 1); }
          lostNew.length = 0;
          return { id: 'burst:' + news[0].id, kind: 'new', style: 'summary', at: news[0].at, ticketNum: news[0].ticketNum, text: phrase('summary', { count: news.length, first: news[0].ticketNum }) };
        }
        // Dishes to fire come before a finished ticket, and a finished ticket before a new one; oldest first inside each.
        const rank = (c) => (c.kind === 'start' || c.kind === 'step' ? 0 : c.kind === 'ready' ? 1 : 2);
        let bi = 0;
        for (let i = 1; i < q.length; i++) if (rank(q[i]) < rank(q[bi])) bi = i;
        return q.splice(bi, 1)[0];
      },
      // How many calls are waiting to be spoken right now.
      size: () => q.length,
      // How many calls were thrown away unspoken, for tests and the pilot notes.
      dropped: () => dropped,
    };
  }
  // Wall mode, orders pane: the open orders (oldest first, with rounds and total) and the orders paid on this service
  // day (newest first), plus how many were paid. Reads the state and changes nothing.
  function wallOrders(state, now) {
    const out = { paidCount: 0, open: [], paid: [] };
    if (!state || !U.isNum(now)) return out;
    const dsh = state.settings && state.settings.service ? state.settings.service.dayStartHour : undefined;
    const day = U.serviceDate(now, dsh);
    // WATCH OUT: an order counts on the day it was paid, like close-the-day, not the day it was opened (o.serviceDate).
    const totals = E().openOrderTotals(state);
    for (const o of Array.isArray(state.orders) ? state.orders : []) {
      const t = totals.get(o.id);
      if (o.status === 'open') out.open.push({ id: o.id, name: o.customer, rounds: t ? t.rounds : 0, total: t ? t.total : 0, at: o.createdAt });
      else if (o.status === 'paid' && U.isNum(o.paidAt) && U.serviceDate(o.paidAt, dsh) === day && o.totals) { out.paidCount++; out.paid.push({ id: o.id, name: o.customer, total: o.totals.total, method: o.method, at: o.paidAt }); }
    }
    out.open.sort((a, b) => a.at - b.at);
    out.paid.sort((a, b) => b.at - a.at);
    return out;
  }
  // Builds the feed: every deadline worth showing right now, worst first. Each row has id, kind, label, at,
  // msLeft, rung, sev (bad, warn, info), consequence and action. Batch rows also carry projected waste.
  function build(state, now) {
    const out = [];
    if (!state || !U.isNum(now)) return out;
    const S = state.settings && state.settings.safety ? Object.assign({}, C.safety, state.settings.safety) : C.safety;
    // With the cook-ahead module off and nothing in the cabinet there are no batch, safety or sanitize rows; ticket rows stay.
    const cook = E().cookAheadActive ? E().cookAheadActive(state) : true;
    if (cook) {
      const sales = salesRate(state, now);
      batchRows(state, now, S, sales, out);
      safetyRows(state, now, S, out);
      coldRows(state, now, out);
      expiredRows(state, now, out);
      keepRows(state, now, S, out);
    }
    otherRows(state, now, out);
    // Rows whose reminder was put off come after the others of the same severity, so they do not take a strip slot from a live one.
    out.sort((a, b) => (SEV_RANK[a.sev] - SEV_RANK[b.sev]) || ((a.snoozedUntil ? 1 : 0) - (b.snoozedUntil ? 1 : 0)) || (a.msLeft - b.msLeft) || (a.id < b.id ? -1 : 1));
    return out;
  }
  // Public API: build(state, now) gives the sorted feed; rungOf, rungsFor and soundsAllowed are shared with the sound ladder.
  SB.deadlines = { spoken, clipWords, delivery, numWords, voiceInfo, build, coldLine, rungOf, rungsFor, salesRate, soundsAllowed, nextOpenAt, pauseNote, closeAtMs, sweepToClose, batchWaste, nextBatchFit, makeLadder, electLeader, makePending, calloutWants, makeCallouts, wallOrders, CHEF_VOICE, phrase, pickVoice, voiceLevel };
})(typeof globalThis !== 'undefined' ? globalThis : window);
