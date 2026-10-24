/*
 * WHAT THIS FILE IS: The "Safety" back-office page: a plain verdict, how well the checks were kept, the
 * hold-cabinet timeline, discards, waste, lockouts and the live food-safety limits.
 * PARTS: facts per refresh, the verdict, ring and meters, timeline, discards, lockouts, the rules panel.
 * USES: 82-office-money.js (helpers), 80-office-core.js (the kit), SB.metrics.   USED BY: the office frame.
 * KEPT: late checks per day are counted here from the same events as metrics.compliance, so the day the
 * verdict blames always adds up to the totals shown.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  if (!g.document) return;
  const U = SB.util;
  const O = SB.office;
  const B = SB.officeB;
  // True only for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  if (!O || typeof O.registerPage !== 'function') return;

  if (!B || typeof B.callout !== 'function') {
    // The shared helpers (82-office-money.js) did not load: say so on the page instead of showing a blank one.
    O.registerPage('safety', { title: 'Safety', icon: 'shield-check', order: 5, render(container, ctx) { throw new Error('The shared helpers for the Safety page (82-office-money.js) did not load.'); } });
    return;
  }
  const h = U.h;

  // Legend words, chart color slots, stacking order, and which discard reasons count as safety breaches.
  const TONE_NAMES = { ok: 'In range', check: 'Temperature check due', reheat: 'Reheat or chill now', discard: 'Thrown out' };
  const REASON_SLOT = { expired: 1, temp: 2, cooling: 3, manual: 4, quality: 5, other: 6, fridgeDate: 7, datemark: 7, outTime: 8 };
  const REASON_ORDER = ['temp', 'expired', 'cooling', 'fridgeDate', 'outTime', 'datemark', 'manual', 'quality', 'other'];
  // The cold-food limits are time limits too, so they count as safety discards in the verdict.
  const SAFETY_REASONS = { temp: 1, expired: 1, cooling: 1, fridgeDate: 1, outTime: 1, datemark: 1 };

  // Builds the Safety page into the container and returns {update, destroy} for the frame.
  function render(container, ctx) {
    const kit = ctx.kit || (SB.office && SB.office.kit);
    if (!kit || typeof kit.page !== 'function') throw new Error('The back-office kit is not available (80-office-core.js).');
    const M = ctx.metrics || SB.metrics;
    const fmt = kit.fmt;
    const page = kit.page(container, ctx, { id: 'safety' });
    // Picker state kept across refreshes: the day shown, whether the owner chose it, and the batch filter.
    const st = { day: null, picked: false, show: 'all', showTouched: false, discardBy: 'g' };
    // The gray source line under card titles. Safety ignores the channel filter, so no channel is named.
    const scope = () => B.scopeText(ctx, { noChannel: true });
    // A short readable date for a service-day key.
    const dayLabel = (key) => U.fmtDateShort(key);

    // ---------- facts, once per prepared handle ----------
    // Counts late checks per day and collects discards and lockouts, once per refresh.
    const facts = B.memoP((p) => {
      const ds = ctx.dataset(), S = B.settings(ds), dsh = S.dayStartHour;
      const from = ctx.filters.range.from, to = ctx.filters.range.to;
      // True when a time falls inside the filter range.
      const inRange = (t) => isNum(t) && t >= from && t < to;
      const days = {};
      // The counter row for one service day, created on first use.
      const dayRec = (d) => days[d] || (days[d] = { tempN: 0, tempLate: 0, tempMaxLate: 0, sanN: 0, sanLate: 0, sanMaxLate: 0 });
      const dis = [], seen = new Set();
      for (const e of ds.events || []) {
        // Undone events and events outside the range are skipped; only checks with an on-time flag are counted.
        if (!e || e.reverted || !inRange(e.t)) continue;
        // A check a few minutes past due counts as on time here too (SB.metrics.withinGrace), matching the totals.
        const late = e.onTime === false && !(SB.metrics.withinGrace && SB.metrics.withinGrace(e));
        if (e.type === 'temp_logged' && typeof e.onTime === 'boolean') { const r = dayRec(U.serviceDate(e.t, dsh)); r.tempN++; if (late) { r.tempLate++; if (isNum(e.lateMs)) r.tempMaxLate = Math.max(r.tempMaxLate, e.lateMs); } }
        else if (e.type === 'sanitize_done' && typeof e.onTime === 'boolean') { const r = dayRec(U.serviceDate(e.t, dsh)); r.sanN++; if (late) { r.sanLate++; if (isNum(e.lateMs)) r.sanMaxLate = Math.max(r.sanMaxLate, e.lateMs); } }
        else if (e.type === 'batch_discard' && isNum(e.g) && e.g > 0) { seen.add(e.batchId); dis.push({ t: e.t, date: U.serviceDate(e.t, dsh), ing: e.ing, g: e.g, reason: e.reason || 'other', cost: isNum(e.cost) ? e.cost : null }); }
      }
      // Batches thrown away without a discard event are added from the batch record, so no waste is missed.
      for (const b of ds.batches || []) {
        if (!b || seen.has(b.id) || !inRange(b.discardedAt) || !isNum(b.wasteG) || b.wasteG <= 0) continue;
        dis.push({ t: b.discardedAt, date: U.serviceDate(b.discardedAt, dsh), ing: b.ing, g: b.wasteG, reason: b.discardReason || 'other', cost: isNum(b.costPerCookedKg) ? (b.wasteG / 1000) * b.costPerCookedKg : null });
      }
      const k = M.compliance(p);
      // One row per ingredient that ran out of safe food, with the part of it that fell inside opening hours
      // (a lockout that starts after closing and ends the next morning cost no sales).
      const lock = B.clusterSpells(k.lockouts.spells, { S, nowMs: ctx.now() });
      return { ds, S, k, days, dis, waste: M.wasteByDay(p), lock };
    });

    // ---------- days that have batches (inside the range) for the timeline ----------
    // Days with at least one batch in range, newest first, with how many were flagged, for the day picker.
    const batchDays = B.memoP((p) => {
      const ds = ctx.dataset(), dsh = B.settings(ds).dayStartHour, from = ctx.filters.range.from, to = ctx.filters.range.to;
      const m = new Map();
      for (const b of ds.batches || []) {
        if (!b || !isNum(b.enteredAt) || b.enteredAt < from || b.enteredAt >= to) continue;
        const d = U.serviceDate(b.enteredAt, dsh); const r = m.get(d) || { date: d, label: dayLabel(d), count: 0, problems: 0 };
        r.count++; if (b.status === 'discard' || isNum(b.discardedAt) || (b.reheats || 0) > 0 || b.status === 'reheat' || b.status === 'chill') r.problems++;
        m.set(d, r);
      }
      return Array.from(m.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
    });

    // ---------- the verdict ----------
    // Weight in plain words, always in g or kg.
    const kgWords = (gm) => fmt.g(gm);
    const COSTLY_MS = 10 * 60000; // a lockout shorter than 10 minutes in opening hours is mentioned but does not turn the verdict red
    // Removes repeated names from a list, keeping the first of each.
    const onceEach = (arr) => arr.filter((x, i) => arr.indexOf(x) === i);
    // Turns the facts into the verdict: a tone, a title, a body and the one problem to look at first (or null).
    // WATCH OUT: with no readings logged it says there is nothing to judge, never that the kitchen was safe.
    function judge(f) {
      const k = f.k;
      const none = !(k.tempChecks.count || k.sanitize.count || k.discards.count || k.batchesIn || k.lockouts.spellCount);
      if (none) return { tone: 'info', word: 'Nothing yet', title: 'No food-safety records in this range yet.', body: 'Temperature readings, sanitize rounds and thrown-out batches fill this page once the hold cabinet has been used. Log a batch and its temperature on the kitchen board, or pick a longer range.', problem: null };
      // Food went into the cabinet but nothing was logged: that is not the same as safe, so say so.
      if (!k.tempChecks.count && !k.sanitize.count && !k.discards.count && !k.lockouts.spellCount) return { tone: 'info', word: 'Nothing to judge', title: 'No temperature checks or sanitize rounds were logged in this range.', body: 'Food went into the hold cabinet, but without readings there is nothing to show whether it stayed in range. Log temperature checks from the kitchen board.', problem: null };
      const safetyDis = f.dis.filter((d) => SAFETY_REASONS[d.reason]);
      const score = k.score;
      const costly = f.lock.filter((c) => c.openMs >= COSTLY_MS);
      const brief = f.lock.filter((c) => c.openMs > 0 && c.openMs < COSTLY_MS);
      const lowScore = isNum(score) && score < 0.9;
      const highWaste = isNum(k.wastePct) && k.wastePct > 0.08;
      // Red when a day lost half an hour of selling to lockouts or checks fell below 75%; amber for less.
      const lostByDay = {};
      costly.forEach((c) => { lostByDay[c.date] = (lostByDay[c.date] || 0) + c.openMs; });
      const worstLoss = Math.max.apply(null, [0].concat(Object.values(lostByDay)));
      let tone = 'good';
      if (worstLoss >= 30 * 60000 || (isNum(score) && score < 0.75)) tone = 'bad';
      else if (costly.length || lowScore || highWaste) tone = 'warn';
      // Discards or lockouts with no readings at all are never "on track": nothing shows the food stayed in range.
      const noChecks = !k.tempChecks.count && !k.sanitize.count;
      if (noChecks && tone === 'good') tone = 'warn';

      // The one problem, in order of what it cost: a lockout (a sale was lost), then late checks,
      // then the heaviest day of waste.
      let problem = null;
      if (costly.length) {
        const byDay = {};
        costly.forEach((c) => {
          const d = byDay[c.date] || (byDay[c.date] = { date: c.date, open: 0, names: [] });
          d.open += c.openMs; d.names.push(c.ing ? B.ingName(f.ds, c.ing) : c.names[0]);
        });
        const worst = Object.values(byDay).sort((a, b) => b.open - a.open)[0];
        const names = onceEach(worst.names);
        const what = B.list(names.slice(0, 2)) + (names.length > 2 ? ' and ' + (names.length - 2) + ' more' : '');
        problem = { date: worst.date, text: what + ' ' + (names.length === 1 ? 'was' : 'were') + ' taken off the menu for a time or temperature limit on ' + dayLabel(worst.date) + ', for ' + fmt.ms(worst.open) + ' of opening hours. A batch could not be served, so sales were lost.' };
      }
      // Second choice: with a low score, blame the day with the most late temperature checks, else sanitize.
      if (!problem && lowScore) {
        const lateDays = Object.keys(f.days).map((d) => Object.assign({ date: d }, f.days[d])).filter((r) => r.tempLate > 0 || r.sanLate > 0);
        const worstT = lateDays.filter((r) => r.tempLate > 0).sort((a, b) => b.tempLate - a.tempLate || b.tempMaxLate - a.tempMaxLate)[0];
        const worstS = lateDays.filter((r) => r.sanLate > 0).sort((a, b) => b.sanMaxLate - a.sanMaxLate)[0];
        if (worstT) problem = { date: worstT.date, text: 'Most late temperature checks were on ' + dayLabel(worstT.date) + ': ' + worstT.tempLate + ' of ' + worstT.tempN + ' readings were late, the worst by ' + fmt.ms(worstT.tempMaxLate) + '.' };
        else if (worstS) problem = { date: worstS.date, text: 'The latest sanitize round was on ' + dayLabel(worstS.date) + ', ' + fmt.ms(worstS.sanMaxLate) + ' after it was due.' };
      }
      // Last choice: the day with the most food thrown away, named by its main reason and food.
      if (!problem && tone !== 'good' && f.dis.length) {
        const byDay = {};
        f.dis.forEach((d) => { const r = byDay[d.date] || (byDay[d.date] = { date: d.date, g: 0, cost: 0, reasons: {}, ings: {} }); r.g += d.g; r.cost += d.cost || 0; r.reasons[d.reason] = (r.reasons[d.reason] || 0) + d.g; r.ings[d.ing] = (r.ings[d.ing] || 0) + d.g; });
        const worst = Object.values(byDay).sort((a, b) => b.g - a.g)[0];
        const topReason = Object.keys(worst.reasons).sort((a, b) => worst.reasons[b] - worst.reasons[a])[0];
        const topIng = Object.keys(worst.ings).sort((a, b) => worst.ings[b] - worst.ings[a])[0];
        problem = { date: worst.date, text: 'The most food was thrown out on ' + dayLabel(worst.date) + ': ' + kgWords(worst.g) + ' (' + B.reasonWord(topReason).toLowerCase() + ', mostly ' + B.ingName(f.ds, topIng).toLowerCase() + (worst.cost > 0 ? ', ' + fmt.money(worst.cost, 0) : '') + ').' };
      }

      // The body sentence: on-time rates for both checks, then what was thrown away, then any short lockouts.
      const parts = [];
      // "3 of 4 temperature checks were on time", in counts, so one check never reads as 0%.
      const kept = (x, noun) => x.onTime + ' of ' + x.count + ' ' + noun + (x.count === 1 ? ' was' : 's were') + ' on time';
      if (k.tempChecks.count) parts.push(kept(k.tempChecks, 'temperature check'));
      if (k.sanitize.count) parts.push(kept(k.sanitize, 'sanitize round'));
      if (parts[0]) parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);
      let body = parts.length ? parts[0] + (parts[1] ? '; ' + parts[1] : '') + '.' : 'No temperature checks or sanitize rounds were logged.';
      if (k.discards.count) body += ' ' + k.discards.count + ' ' + B.plural(k.discards.count, 'batch was', 'batches were') + ' thrown out (' + kgWords(k.discards.g) + ', ' + SB.metrics.discardCostWords(k.discards, (v) => fmt.money(v, 0)) + '), ' + safetyDis.length + ' for time or temperature rules.';
      else body += ' Nothing was thrown out.';
      if (brief.length) body += brief.length === 1 ? ' A time or temperature limit also took an item off the menu once, for ' + fmt.ms(brief[0].openMs) + '.' : ' Time or temperature limits also took items off the menu ' + brief.length + ' times for a few minutes each, the longest ' + fmt.ms(Math.max.apply(null, brief.map((c) => c.openMs))) + '.';
      // A red verdict is worded by cause: lost selling time, or checks that fell behind.
      const title = tone === 'good' ? (safetyDis.length ? 'All checks were kept. Food past a time or temperature limit was thrown out, as it should be.' : 'All checks were kept and no food was thrown out for time or temperature.')
        : tone === 'warn' ? (noChecks ? 'No temperature checks or sanitize rounds were logged, so nothing shows the food stayed in range.' : 'Most checks were kept, with one thing to look at.') : worstLoss >= 30 * 60000 ? 'Some checks were missed and a dish was off the menu.' : 'Temperature or sanitize checks fell behind.';
      return { tone, title, body, problem };
    }

    // One verdict per refresh, shared by the panel and by the timeline's choice of day.
    const verdictOf = B.memoP((p) => judge(facts(p)));
    const verdict = page.panel({
      span: 12, title: 'How did the checks go?', sub: scope(),
      // Fills the verdict box. Its button jumps the timeline to the day named as the problem.
      render: (body, p0) => {
        const co = B.callout(body, kit);
        // Shows the current verdict; the tone picks the word (On track, Watch or Needs attention) and the button.
        const paint = (p) => {
          const v = verdictOf(p);
          co.set({
            tone: v.tone, word: v.tone === 'good' ? 'On track' : v.tone === 'warn' ? 'Watch' : v.tone === 'bad' ? 'Needs attention' : undefined,
            title: v.title, body: v.body, extra: v.problem ? v.problem.text : (v.tone === 'good' ? 'No single problem stands out.' : ''),
            // The button takes the owner to the problem day in the timeline.
            action: v.problem ? { label: 'Show ' + dayLabel(v.problem.date) + ' in the timeline', icon: 'calendar', onClick: () => { jumpTo(v.problem.date); } } : null,
          });
        };
        paint(p0);
        return { update: paint };
      },
    });

    page.headline();

    // ---------- compliance: ring and the two meters ----------
    page.section('How well the checks were kept', 'On time means the check was logged before the interval you set ran out, or within 5 minutes after.');
    // Check intervals are read live from settings, so a changed limit shows at the next refresh.
    const intervalTemp = () => B.settings(ctx.dataset()).safety.tempCheckEveryMin;
    const intervalSan = () => B.settings(ctx.dataset()).safety.sanitizeEveryH;
    // Words the meters show for on track, slipping and needs attention.
    const WORDS = { ok: 'On track', warn: 'Slipping', bad: 'Needs attention' };

    const ringCard = page.card({
      type: 'ring', span: 4, title: 'Checks kept on time', sub: 'Temperature checks and sanitize rounds together',
      caption: 'One number for the whole night. Green is 90% or better; below 75% a check or two were being skipped.',
      empty: { title: 'No score yet', body: 'The score needs temperature checks or sanitize rounds to be logged in this range.', icon: 'shield-check' },
      // Compliance ring: the average of the two on-time rates, empty until a check is logged.
      spec: (p) => {
        const k = facts(p).k;
        if (!isNum(k.score)) return null;
        // Thresholds in percent: below 90 warns, below 75 breaches; inverted because a higher score is better.
        return { value: k.score * 100, max: 100, label: 'Checks kept', sub: 'Temperature checks and sanitize rounds on time', format: 'pct100', warn: 90, breach: 75, invert: true, words: WORDS, size: 188,
          ariaLabel: 'Checks kept on time ' + fmt.pct(k.score, 0) + (k.tempChecks.count && k.sanitize.count ? ', the average of temperature checks and sanitize rounds logged on time.' : k.tempChecks.count ? ', from temperature checks alone; no sanitize rounds were logged.' : ', from sanitize rounds alone; no temperature checks were logged.') };
      },
    });
    const tempCard = page.card({
      type: 'meter', span: 4, title: 'Temperature checks on time', sub: 'A reading is on time when it is logged within ' + U.minutesText(intervalTemp()) + ' of the last one',
      caption: 'Whether every pan in the cabinet is being checked as often as you decided. Late checks are the first sign of a slipping night.',
      empty: { title: 'No temperature checks yet', body: 'Readings logged on the line fill this meter.', icon: 'thermometer' },
      // Meter of temperature checks logged on time; empty until a reading is logged.
      spec: (p) => {
        const t = facts(p).k.tempChecks;
        if (!t.count) return null;
        return { value: t.onTimePct * 100, max: 100, label: t.onTime + ' of ' + t.count + ' on time', sub: t.late ? t.late + ' late' + (isNum(t.maxLateMs) ? ', the worst by ' + fmt.ms(t.maxLateMs) : '') : 'None late', format: 'pct100', warn: 90, breach: 75, invert: true, words: WORDS,
          ariaLabel: 'Temperature checks on time: ' + fmt.pct(t.onTimePct, 0) + ', ' + t.onTime + ' of ' + t.count + ' readings.' };
      },
    });
    const sanCard = page.card({
      type: 'meter', span: 4, title: 'Sanitize rounds on time', sub: 'A round is on time when it is logged within ' + intervalSan() + ' hours of the last one',
      caption: 'Whether food-contact surfaces were wiped down on schedule. A late round never stops service, but it is on the record.',
      empty: { title: 'No sanitize rounds yet', body: 'Rounds logged from the line fill this meter.', icon: 'drop' },
      // Meter of sanitize rounds logged on time; empty until a round is logged.
      spec: (p) => {
        const t = facts(p).k.sanitize;
        if (!t.count) return null;
        return { value: t.onTimePct * 100, max: 100, label: t.onTime + ' of ' + t.count + ' on time', sub: t.late ? t.late + ' late' + (isNum(t.maxLateMs) ? ', the worst by ' + fmt.ms(t.maxLateMs) : '') : 'None late', format: 'pct100', warn: 90, breach: 75, invert: true, words: WORDS,
          ariaLabel: 'Sanitize rounds on time: ' + fmt.pct(t.onTimePct, 0) + ', ' + t.onTime + ' of ' + t.count + ' rounds.' };
      },
    });

    // ---------- hold-cabinet timeline ----------
    page.section('Hold cabinet', 'Every batch that went into the hot or cold cabinet on the day you pick.');
    // Day picker: choosing a day marks it as the owner's pick, so a refresh will not switch it back.
    const daySel = B.select({ label: 'Day', options: [], onChange: (v) => { st.day = v; st.picked = true; timeline.update(ctx.prepared(), ctx); } });
    // All batches or problems only; once touched, the owner's choice wins over the automatic one.
    const showSeg = B.seg({ label: 'Show batches', value: st.show, options: [{ id: 'all', label: 'All batches' }, { id: 'problems', label: 'Problems only' }], onChange: (id) => { st.show = id; st.showTouched = true; timeline.update(ctx.prepared(), ctx); } });

    // Refreshes the day picker's choices and picks the problem day on first view. Returns the list of days.
    function syncDays(p) {
      const days = batchDays(p);
      daySel.setOptions(days.map((d) => ({ value: d.date, label: d.label + ': ' + d.count + ' ' + B.plural(d.count, 'batch', 'batches') + (d.problems ? ', ' + d.problems + ' flagged' : '') })));
      if (!days.length) { st.day = null; return days; }
      if (!days.some((d) => d.date === st.day)) st.picked = false;
      if (!st.picked) {
        const v = verdictOf(p);
        const pref = v.problem && days.find((d) => d.date === v.problem.date);
        st.day = (pref || days[0]).date;
      }
      daySel.set(st.day);
      return days;
    }
    // Builds the timeline chart for the chosen day, or an empty-state message when there is nothing to show.
    function timelineSpec(p) {
      const days = syncDays(p);
      if (!st.day || !days.length) return null;
      const t = M.batchTimeline(p, { day: st.day });
      const all = t.rows || [];
      // A batch counts as a problem if any part of it was unsafe, any food was wasted, or it was reheated.
      const isProblem = (r) => r.segments.some((s) => s.tone !== 'ok') || isNum(r.wasteG) && r.wasteG > 0 || (r.reheats || 0) > 0;
      const problems = all.filter(isProblem).length;
      // A long day opens on its problems only (a 50-row chart hides the one that matters); the owner's own
      // choice wins once made.
      if (!st.showTouched) { st.show = all.length > 16 && problems > 0 ? 'problems' : 'all'; try { showSeg.setValue(st.show); } catch (e) { /* ignore */ } }
      const rows = st.show === 'problems' ? all.filter(isProblem) : all;
      const lbl = dayLabel(st.day);
      const legend = ['ok', 'check', 'reheat', 'discard'].map((tone) => ({ tone, name: TONE_NAMES[tone] }));
      // Shapes one batch for the chart: its bars, and marks for readings, reheats and discards.
      const row = (r) => ({
        label: r.label,
        segments: r.segments.map((s) => ({ start: s.start, end: s.end, tone: s.tone, name: TONE_NAMES[s.tone] || s.label })),
        marks: r.marks.map((m) => ({ at: m.at, label: m.label, tone: /^Reheat/.test(m.label) ? 'reheat' : /^Discarded/.test(m.label) ? 'discard' : undefined })),
      });
      if (!rows.length) {
        return { rows: [], empty: all.length ? 'No batch had a problem on ' + lbl + '. Every one of the ' + all.length + ' batches stayed in range.' : 'No batch went into the cabinet on ' + lbl + '.', ariaLabel: 'Timeline of hold-cabinet batches for ' + lbl + ': none to show.' };
      }
      // Row height in px; a long day gets shorter rows so it stays on one screen.
      const pitch = rows.length <= 12 ? 34 : 26;
      return {
        rows: rows.map(row), x: { type: 'time' }, toneNames: TONE_NAMES, legend,
        refLines: [{ x: t.openMs, label: 'Open', tone: 'muted' }, { x: t.closeMs, label: 'Close', tone: 'muted' }].filter((r) => isNum(r.x)),
        height: Math.round(rows.length * pitch + 32 + 18),
        ariaLabel: 'Timeline of ' + all.length + ' hold-cabinet batches on ' + lbl + ': ' + (problems ? problems + ' had a problem' : 'none had a problem') + (st.show === 'problems' ? '; showing only those' : '') + '. Green is in range, amber needs a temperature check, orange needs a reheat or chill, red was thrown out.',
      };
    }
    const timeline = page.card({
      type: 'gantt', span: 12, title: 'Batch timeline', sub: scope(),
      caption: 'Green bars are batches whose readings were in range. Amber means a temperature check was due, orange a reheat or chill, red a batch that was thrown out. Diamonds are readings.',
      empty: { title: 'No batches in this range', body: 'Batches appear here once you log food cooked into the hold cabinet. Log your first batch on the kitchen board, or pick a longer range.', icon: 'thermometer' },
      spec: timelineSpec,
    });
    B.addAction(timeline, showSeg);
    B.addAction(timeline, daySel.el);

    // Shows the given day in the timeline and brings the card into view. Used by the verdict button.
    function jumpTo(date) {
      st.day = date; st.picked = true; st.showTouched = false;
      timeline.update(ctx.prepared(), ctx);
      // Smooth scrolling is skipped for people who asked for less motion.
      try { timeline.el.scrollIntoView({ block: 'start', behavior: (U.prefersReducedMotion && U.prefersReducedMotion()) ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
      try { daySel.select.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    // ---------- discards ----------
    page.section('What was thrown out', 'Cooked food that could not be served, and why.');
    const discardCard = page.card({
      type: 'bar', span: 7, title: 'Thrown out by reason', sub: scope(),
      caption: 'Which reasons waste the most. Red-flag reasons are temperature, time and cooling; food thrown out by hand or for quality is a kitchen habit, not a missed time or temperature limit.',
      empty: { title: 'Nothing was thrown out', body: 'Batches thrown out appear here by day and reason.', icon: 'check-circle' },
      // Stacked bars of discards per day, split by reason, in weight or cost.
      spec: (p) => {
        const w = facts(p).waste.filter((d) => d.count > 0 || d.g > 0);
        const reasons = REASON_ORDER.filter((r) => w.some((d) => d.byReason.some((x) => x.reason === r && x.g > 0)));
        w.forEach((d) => d.byReason.forEach((x) => { if (reasons.indexOf(x.reason) < 0 && x.g > 0) reasons.push(x.reason); }));
        if (!reasons.length) return null;
        const by = st.discardBy;
        const allDays = facts(p).waste;
        // One bar segment: grams or cost of a reason on a day; null when the cost is unknown, 0 when none.
        const cell = (d, r) => { const x = d.byReason.find((y) => y.reason === r); if (!x || !(x.g > 0)) return 0; return by === 'g' ? x.g : (x.cost > 0 ? x.cost : null); };
        return {
          orient: 'v', stacked: true, categories: allDays.map((d) => d.label), sort: 'none', format: by === 'g' ? 'g' : 'money',
          series: reasons.map((r) => ({ id: r, name: B.reasonWord(r), slot: REASON_SLOT[r] || 6, values: allDays.map((d) => cell(d, r)) })),
          height: 300,
          ariaLabel: 'Stacked bar chart of discarded food ' + (by === 'g' ? 'by weight' : 'by cost') + ' for each day, split by reason: ' + reasons.map((r) => B.reasonWord(r)).join(', ') + '.',
        };
      },
    });
    // Weight or Cost switch; only this card redraws.
    B.addAction(discardCard, B.seg({ label: 'Show discards as', value: st.discardBy, options: [{ id: 'g', label: 'Weight' }, { id: 'cost', label: 'Cost' }], onChange: (id) => { st.discardBy = id; discardCard.update(ctx.prepared(), ctx); } }));

    const wasteCard = page.card({
      type: 'line', span: 5, title: 'Waste by day', sub: scope(),
      caption: 'Share of the food you cooked that was thrown out. Days above the watch line mean too much is cooked, held too long, or let out of range.',
      empty: { title: 'No waste figures yet', body: 'The share needs food to be cooked into the cabinet. Days with intake fill this line, and a clean day shows as zero.', icon: 'chart-line' },
      // Line of the share of cooked food thrown away each day, with the 8% watch line.
      spec: (p) => {
        const w = facts(p).waste.filter((d) => isNum(d.wastePct));
        if (!w.length) return null;
        const pts = w.map((d) => [dayLabel(d.date), d.wastePct]);
        const worst = w.reduce((a, d) => (d.wastePct > a.wastePct ? d : a), w[0]);
        return {
          series: [{ id: 'waste', name: 'Waste', points: pts, slot: 2 }], x: { type: 'cat', label: 'Day' }, y: { format: 'pct' },
          refLines: [{ y: 0.08, label: 'Watch line, 8%', tone: 'warn' }], markers: pts.length <= 20 ? 'all' : 'auto', height: 300,
          ariaLabel: 'Line chart of the share of cooked food thrown out each day. The worst day was ' + dayLabel(worst.date) + ' at ' + fmt.pct(worst.wastePct, 0) + '. A watch line marks 8 percent.',
        };
      },
    });

    // ---------- lockouts ----------
    page.section('When food safety stopped a sale', 'A lockout means a batch was outside its time or temperature limits and could not be served, so the menu items made from it were taken off. Only time inside opening hours counts, because that is when a sale can be lost.');
    const lockouts = page.table({
      span: 12, title: 'Items taken off the menu for food safety', sub: scope(),
      caption: 'How often, and for how long, a safety rule cost you a sale. A long lockout at a busy hour is the expensive kind.',
      empty: { title: 'No item was taken off the menu for food safety in opening hours', body: 'Items appear here when a batch had to be thrown out and nothing in range was left to sell. None in this range.', icon: 'shield-check' },
      columns: [
        { key: 'label', label: 'Day', sort: true, sortKey: 'date', nowrap: true },
        { key: 'what', label: 'What went off', sort: true, firstDir: 'asc' },
        // Start time of the lockout, shown as a clock time.
        { key: 'startT', label: 'Started', align: 'right', sort: true, wideOnly: true, format: (v) => fmt.clock(v) },
        // Time inside opening hours; under a minute is said in words instead of showing 0m.
        { key: 'openMs', label: 'Off during opening hours', align: 'right', sort: true, format: (v) => (v < 60000 ? 'Under a minute' : fmt.ms(v)) },
      ],
      defaultSort: 'openMs', defaultDir: 'desc', pageSize: 8,
      // Rows are the lockouts that cost sales: those with some time inside opening hours.
      rows: (p) => facts(p).lock.filter((c) => c.openMs > 0).map((c) => ({
        date: c.date, label: dayLabel(c.date), startT: c.startT, openMs: c.openMs,
        what: c.ing ? B.ingName(facts(p).ds, c.ing) + (c.items.length > 1 ? ' (' + c.items.length + ' menu items)' : '') : c.names[0],
      })),
    });
    lockouts.el.classList.add('ob-tbl');
    const lockNote = h('p', { class: 'ob-note' });
    lockouts.el.querySelector('.of-card-body').appendChild(lockNote);

    // ---------- the rules, live from settings ----------
    page.section('The limits behind all this', 'These are the limits the kitchen screens enforce right now. They come from your settings.');
    const rules = page.panel({
      span: 12, title: 'What the rules are', sub: 'Read live from Menu, prices and shop',
      caption: 'The exact limits behind every green, amber and red above. If the limits do not match your local health code, change them in settings.',
      // Builds the list of limits once; update rewrites the text from the live settings.
      render: (body, p0) => {
        const ul = h('ul', { class: 'ob-rules' });
        const keys = ['hot', 'cold', 'reheat', 'hold', 'grace', 'checks', 'sanitize'];
        const nodes = {};
        keys.forEach((k) => { const t = h('span', { class: 'ob-rule-t' }), d = h('span', { class: 'ob-rule-d' }); ul.appendChild(h('li', { class: 'ob-rule', dataset: { k } }, t, d)); nodes[k] = { t, d }; });
        const note = h('p', { class: 'ob-note ob-note--accent', dataset: { k: 'difference' } });
        // Takes the owner to Menu, prices and shop, where these limits are changed.
        const go = kit.button({ label: 'Change these in Menu, prices and shop', icon: 'sliders', onClick: () => ctx.navigate('data') });
        const line = h('p', { class: 'ob-safetyline', dataset: { k: 'safetyline' } }, (SB.config && SB.config.safetyLine) || '');
        body.append(ul, note, h('div', { class: 'ob-actions' }, go), line);
        // Formats a temperature limit for display.
        const T = (f) => (U.tempText || U.fmtTemp)(f);
        // Rewrites every rule from the live settings, so a changed limit shows at the next refresh.
        const paint = () => {
          const S = B.settings(ctx.dataset()).safety;
          // Writes the title and the detail text for one rule.
          const set = (k, t, d) => { B.setText(nodes[k].t, t); B.setText(nodes[k].d, d); };
          set('hot', 'Hot food stays at ' + T(S.hotHoldF) + ' or above', 'A pan reading below ' + T(S.hotHoldF) + ' must be reheated or thrown out. FDA Food Code 3-501.16; your local code applies.');
          set('cold', 'Cold food stays at ' + T(S.coldHoldF) + ' or below', 'A pan reading above ' + T(S.coldHoldF) + ' must be chilled again or thrown out.');
          set('reheat', 'Reheat to ' + T(S.reheatF) + ', once only', 'The model Food Code (3-403.11) sets ' + T(165) + ' as the target' + (S.reheatF !== 165 ? '; yours is set to ' + T(S.reheatF) : '') + '. Reheating a batch only once is our own rule: if it drops below the limit again it is thrown out.');
          set('hold', 'Each product has its own hold limit, never more than ' + (S.hardCapH) + ' hours', 'The throw-out time throws the batch out when it is reached. A quality limit is a house rule for food held at temperature: at the limit the batch is taken off the menu but stays on the board until someone tastes it, and it can be kept serving for 30 minutes or 1 hour at a time while a reading of ' + T(S.hotHoldF) + ' or higher (cold food ' + T(S.coldHoldF) + ' or lower) is logged within the check interval. Every extension is logged with who and when. The hard cap of ' + (S.hardCapH) + ' hours throws out any batch (products whose limit is at or above it have no quality stage). Slaw, potato salad and banana pudding start with a quality limit for the owner to confirm: if you hold them outside temperature control, make theirs a safety limit. Your local health department\'s rules apply to quality extensions. Brisket and pulled pork starter limits are placeholders for the owner to confirm.');
          set('grace', 'Grace of ' + S.belowHotGraceH + ' hours below ' + T(S.hotHoldF) + ' (cold food: ' + S.aboveColdGraceH + ' hours above ' + T(S.coldHoldF) + ')', 'The clock starts at the first reading outside the limit. After the grace time the batch is thrown out.');
          set('checks', 'A temperature reading every ' + U.minutesText(S.tempCheckEveryMin), 'A late reading is flagged and counted here. It does not stop service by itself.');
          set('sanitize', 'Sanitize food-contact surfaces every ' + S.sanitizeEveryH + ' hours', 'A late round is a warning on the line and counts against the checks-kept score. Four hours is our starting value; set the limit your health department gives you.');
          // Kept on purpose: the grace clock starts later here than in the research report (finding F-E1).
          B.setText(note, 'Smokebox starts the ' + S.belowHotGraceH + '-hour clock at the first reading below ' + T(S.hotHoldF) + '. Some health departments start it when the food left the heat, which is stricter. Check which one yours uses.');
        };
        paint();
        return { update: paint };
      },
    });

    const cards = [ringCard, tempCard, sanCard, timeline, discardCard, wasteCard, lockouts];
    return {
      // Runs on every refresh: keeps subtitles current and notes lockouts that began after closing.
      update() {
        const s = scope();
        [verdict, timeline, discardCard, wasteCard, lockouts].forEach((c) => B.setSub(c, s));
        const f = facts(ctx.prepared());
        const after = f.lock.filter((c) => !(c.openMs > 0)).length;
        B.setText(lockNote, after ? after + ' more ' + B.plural(after, 'lockout began', 'lockouts began') + ' after closing and cost no sales, so ' + B.plural(after, 'it is', 'they are') + ' not listed.' : '');
        lockNote.hidden = !after;
        B.setSub(tempCard, 'A reading is on time when it is logged within ' + U.minutesText(intervalTemp()) + ' of the last one');
        B.setSub(sanCard, 'A round is on time when it is logged within ' + intervalSan() + ' hours of the last one');
      },
      // Runs when the page is left; drops the card list.
      destroy() { cards.length = 0; },
    };
  }

  O.registerPage('safety', { title: 'Safety', icon: 'shield-check', order: 5, render });
})(typeof globalThis !== 'undefined' ? globalThis : window);
