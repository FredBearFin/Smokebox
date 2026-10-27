/*
 * WHAT THIS FILE IS: The first three back office pages, Pace, Tickets and Stations. Each page only
 * describes
 * its tiles, charts and tables; the kit in 80-office-core.js builds, refreshes and cleans them up.
 * PARTS: shared helpers, Pace page, Tickets page (with the ticket panel), Stations page.
 * USES: 80-office-core.js (SB.office.kit), 40-metrics.js (one prepared handle p per refresh), 50-charts.js.
 * USED BY: the frame in 80-office-core.js, which shows these pages through registerPage.
 */
(function (g) {
  'use strict';
  const SB = g.SB;
  if (!SB || !SB.office || !SB.office.kit || !SB.metrics || !SB.charts) return;
  const O = SB.office, K = O.kit, M = SB.metrics, U = SB.util, fmt = K.fmt, h = U.h;
  // True for a real, finite number (not NaN, not infinity).
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // DAY is one day in ms. MIN_N: an hour or a day with fewer finished tickets than this is left out of
  // medians and shown as unknown, never as zero.
  const DAY = 864e5, MIN_N = 3;
  // Picks the singular or plural word for a count: plural(2, 'hour') gives 'hours'.
  const plural = (n, a, b) => (n === 1 ? a : b || a + 's');

  // Remembers a worked-out value per prepared handle, so one card's spec, sub and caption share one
  // calculation.
  const memos = new WeakMap();
  function memo(p, key, fn) {
    let m = memos.get(p); if (!m) memos.set(p, (m = {}));
    return key in m ? m[key] : (m[key] = fn());
  }
  // shiftDay gives the time stamp n days later or earlier. rangeDays says how many service days a range
  // covers.
  const shiftDay = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };
  const rangeDays = (r) => Math.max(1, Math.round((r.to - r.from) / DAY));
  // Lower-cases text so it reads well inside a sentence. Missing text gives an empty string.
  const lc = (s) => String(s || '').toLowerCase();
  // warn / overdue limits for the current channel filter; with all channels, the mix-weighted average
  // (the same idea paceIndex uses)
  function limits(p) {
    return memo(p, 'limits', () => {
      const rows = M.byChannel(p).filter((r) => r.created > 0 && isNum(r.warnMs));
      if (!rows.length) return null;
      const tot = rows.reduce((a, r) => a + r.created, 0);
      return { warnMs: rows.reduce((a, r) => a + r.warnMs * r.created, 0) / tot, breachMs: rows.reduce((a, r) => a + r.breachMs * r.created, 0) / tot, mixed: rows.length > 1 };
    });
  }
  // x domain (service hours) shared by the two charts that stack under each other, so their time axes
  // line up
  function hourDomain(p) {
    return memo(p, 'domain', () => {
      const rows = M.byHour(p).filter((r) => r.created > 0);
      return rows.length ? { min: rows[0].hour, max: rows[rows.length - 1].hour + 1 } : null;
    });
  }
  // Plain words for a ticket's status.
  const levelWord = { ok: 'On time', warn: 'Running late', breach: 'Overdue' };
  // The four waits a ticket splits into: key, label shown, and the field name in the metrics row.
  const PARTS = [['hold', 'Held back', 'holdMs'], ['response', 'Waiting for a cook', 'responseMs'], ['work', 'Hands-on work', 'workMs'], ['dwell', 'Waiting to go out', 'dwellMs']];
  // Names the Gantt chart uses for the same waits.
  const PART_TONES = { hold: 'Held back', wait: 'Waiting for a cook', response: 'Waiting for a cook', work: 'Hands-on work', dwell: 'Waiting to go out' };

  // Works out what the hero chart shows: hours with enough tickets and, for short ranges, the usual
  // pattern from the 14 days before. Cached per handle because the spec, sub and caption all read it.
  function heroModel(p, ctx) {
    return memo(p, 'hero', () => {
      const all = M.byHour(p).filter((r) => r.created > 0);
      const rows = all.filter((r) => r.count >= MIN_N && isNum(r.medianMs));
      let base = null;
      if (rangeDays(ctx.filters.range) < 5) {
        try {
          const bp = M.prepare(ctx.dataset(), { from: shiftDay(ctx.filters.range.from, -14), to: ctx.filters.range.from, channel: ctx.filters.channel, now: ctx.now() });
          const br = M.byHour(bp).filter((r) => r.count >= MIN_N && isNum(r.p10Ms) && isNum(r.p90Ms));
          if (br.length >= 2) base = br;
        } catch (e) { /* no baseline: the chart still draws */ }
      }
      return { rows, base, dropped: all.length - rows.length };
    });
  }

  // The four KPI tiles of the Pace page, all from the metrics comparison.
  function paceTiles() {
    return [
      { id: 'median', kpi: 'medianMs', label: 'Median ticket time' },
      { id: 'p90', kpi: 'p90Ms', label: 'Slowest 1 in 10' },
      { id: 'ontime', kpi: 'onTimePct', label: 'Tickets on time' },
      { id: 'rate', kpi: 'perHour', label: 'Tickets per hour' },
    ];
  }

  O.registerPage('pace', {
    title: 'Speed', icon: 'gauge', order: 1,
    // The Pace page: headline, KPI tiles, the hero chart, the pace ring, tickets per 15 minutes, the
    // pacing check and the findings.
    render(container, ctx) {
      const page = K.page(container, ctx, { id: 'pace' });
      // The live at-a-glance panel sits above the page (it ignores the date range on purpose).
      const glanceHost = U.h('div', { class: 'of-glance-host' });
      container.insertBefore(glanceHost, page.el);
      const glance = typeof O.glance === 'function' ? O.glance(glanceHost) : null;
      page.headline();
      page.how('These numbers come from tickets that were sent out in the range above. Ticket time runs from when the ticket was entered until it was sent out, and the middle ticket is the typical one: half the tickets were faster. Slowest 1 in 10 is the time that nine in ten tickets beat. On time means a ticket finished before its warning time, which depends on the order type (Menu, prices and shop, Time limits). Tickets per hour is tickets placed divided by the hours in which at least one ticket was placed.');
      page.tiles(paceTiles());

      page.card({
        type: 'line', span: 12, height: 300, title: 'Ticket time by hour of service',
        // The hero card's subtitle and its 'what to look for' line change with the range and with whether
        // a baseline exists.
        sub: (p, c) => { const m = heroModel(p, c); return (m.base ? c.filters.range.label + ' against the middle 80% of the 14 days before it' : 'Median ticket time in each hour, ' + lc(c.filters.range.label)) + (m.dropped ? '. ' + m.dropped + ' ' + plural(m.dropped, 'hour') + ' with fewer than ' + MIN_N + ' tickets left out' : ''); },
        caption: (p, c) => (heroModel(p, c).base
          ? 'When the solid line climbs above the shaded band, that hour ran slower than usual for the last two weeks.'
          : 'The line is the median ticket time in each hour and the shaded band holds the middle 80% of tickets. A wide band means some tickets are far slower than others.'),
        empty: { title: 'Not enough finished tickets by hour', body: 'This chart needs at least two hours with ' + MIN_N + ' or more finished tickets. A longer range, such as Last 7 days, fills it in.' },
        // The hero line: median ticket time by hour, a shaded middle-80% band and the warning limit as a
        // line.
        spec(p, c) {
          const m = heroModel(p, c); if (m.rows.length < 2) return null;
          // x puts each point in the middle of its hour. series collects the lines to draw.
          const x = (r) => r.hour + 0.5, series = [];
          if (m.base) {
            series.push({ id: 'band', name: 'Usual middle 80%', kind: 'band', tone: 'muted', points: m.base.map((r) => [x(r), r.p10Ms, r.p90Ms]) });
            series.push({ id: 'typical', name: 'Usual median', tone: 'muted', dash: true, points: m.base.map((r) => [x(r), r.medianMs]) });
          } else {
            series.push({ id: 'band', name: 'Middle 80% of tickets', kind: 'band', tone: 'muted', points: m.rows.filter((r) => isNum(r.p10Ms) && isNum(r.p90Ms)).map((r) => [x(r), r.p10Ms, r.p90Ms]) });
          }
          series.push({ id: 'cur', name: m.base ? c.filters.range.label : 'Median ticket time', slot: 1, points: m.rows.map((r) => [x(r), r.medianMs]) });
          const lim = limits(p), dom = hourDomain(p);
          return {
            series, x: Object.assign({ type: 'hour' }, dom || {}), y: { format: 'dur', label: 'Ticket time', zero: true },
            refLines: lim ? [{ y: lim.warnMs, label: (lim.mixed ? 'Warn, channel mix ' : 'Warn ') + fmt.ms(lim.warnMs), tone: 'warn' }] : [],
            ariaLabel: 'Median ticket time by hour of service for ' + lc(c.filters.range.label) + (m.base ? ' against the previous 14 days' : ''),
          };
        },
      });

      page.more('Show more charts and findings');
      page.card({
        type: 'ring', span: 4, title: 'Speed right now', sub: 'The last 10 tickets from the past 45 minutes. This one ignores the date range above.',
        caption: 'Under 80% of target is comfortable. At 100% the median ticket is as slow as its warning time, so the line is falling behind.',
        empty: { title: 'No tickets finished in the last 45 minutes', body: 'The ring wakes up when the line is moving. It reads only the last live minutes. Take an order and bump it to light it up.', icon: 'gauge' },
        // The ring: how close the last 10 tickets are to their warning time. It ignores the date range on
        // purpose.
        spec(p, c) {
          const pi = M.paceIndex(p, { now: c.now() });
          if (!pi || pi.index === null || !isNum(pi.index) || !pi.n) return null;
          return {
            // The ring reads as percent of target, with words for comfortable, busy and behind.
            value: pi.index, max: 1.5, target: 1, warn: 0.8, breach: 1.0001, label: 'Busyness', format: (v) => Math.round(v * 100) + '%',
            words: { ok: 'Comfortable', warn: 'Busy', bad: 'Behind' },
            sub: 'Median ' + fmt.ms(pi.medianMs) + ' against a target of ' + fmt.ms(pi.targetMs) + (pi.thin ? '. Only ' + pi.n + ' ' + plural(pi.n, 'ticket') + ' so far, so treat it as a rough guide' : ''),
            ariaLabel: 'Busyness ' + Math.round(pi.index * 100) + ' percent of target, ' + lc(pi.label),
          };
        },
        height: 270, table: false,
      });

      page.card({
        type: 'line', span: 8, height: 230, title: 'Tickets per 15 minutes',
        // The subtitle averages over the days in the range.
        sub: (p) => { const t = M.throughput(p, { fold: true, bucketMin: 15 }); return t.days > 1 ? 'Average per day over ' + t.days + ' days, orders coming in against tickets going out' : 'Orders coming in against tickets going out'; },
        caption: 'Where the orders line sits above the tickets-out area, the kitchen is falling behind. Where they meet, it is keeping up.',
        empty: { title: 'Not enough tickets yet', body: 'The strip fills in once a few tickets have been finished in this range.' },
        // Two lines through the service day: tickets finished (filled) and orders coming in.
        spec(p) {
          const t = M.throughput(p, { fold: true, bucketMin: 15 });
          if (!t.points.length || t.total < 5) return null;
          const dom = hourDomain(p);
          return {
            series: [
              { id: 'completed', name: 'Tickets out', slot: 1, area: true, points: t.points.map((q) => [q.x, q.completed]) },
              { id: 'created', name: 'Orders in', slot: 2, points: t.points.map((q) => [q.x, q.created]) },
            ],
            x: Object.assign({ type: 'hour' }, dom || {}), y: { format: 'num', label: t.days > 1 ? 'Per day, on average' : 'Tickets', zero: true },
            ariaLabel: 'Tickets in and out per 15 minutes through the service day',
          };
        },
      });

      page.card({
        type: 'bar', span: 4, height: 230, title: 'Do plates finish together?',
        // The subtitle says how much pacing cut the wait for the last item, once Finish together on and off can be
        // compared.
        sub: (p) => { const c = M.pacingCompare(p); return c.comparable && isNum(c.lampCutPct) ? 'With Finish together on, finished food waited ' + Math.round(Math.abs(c.lampCutPct) * 100) + '% ' + (c.lampCutPct >= 0 ? 'less' : 'more') + ' (different tickets, not a controlled test)' : 'Average wait for the last item, Finish together off against on'; },
        caption: 'Shorter is better. This is how long finished food sits waiting for the rest of the plate. Finish together holds early items so the plate finishes together; it is not meant to make tickets faster, and the median ticket time can go up.',
        empty: { title: 'Finish together cannot be compared yet', body: 'This needs finished multi-item tickets with Finish together on and with Finish together off in the same range. Run a day with Finish together off to see its effect.', icon: 'timer' },
        // Two bars: the average wait for the last item with Finish together off and with Finish together on.
        spec(p) {
          const c = M.pacingCompare(p);
          if (!c.comparable || !isNum(c.on.avgLampMs) || !isNum(c.off.avgLampMs)) return null;
          return { orient: 'v', categories: ['Finish together off', 'Finish together on'], series: [{ id: 'lamp', name: 'Average wait for the last item', values: [c.off.avgLampMs, c.on.avgLampMs] }], format: 'dur', emphasis: 1, labels: 'all', ariaLabel: 'Average wait for the last item: Finish together off ' + fmt.ms(c.off.avgLampMs) + ', Finish together on ' + fmt.ms(c.on.avgLampMs) };
        },
      });

      page.insights({ limit: 6, only: ['pace-overview', 'pacing-effect', 'slow-hour', 'channel-gap', 'expo-dwell', 'forced-bumps'], empty: 'Findings about speed appear once there are about 20 finished tickets in the range.' });
      // The kit removes every card, chart and listener when the page closes.
      return { destroy() { if (glance) glance.destroy(); glanceHost.remove(); page.destroy(); } };
    },
  });

  // The histogram of ticket times in one-minute steps, with an outline per channel and the warn and
  // overdue lines. The chart wants raw values, so each bar is rebuilt from the bin counts.
  function histSpec(p, ctx) {
    const hs = M.ticketHistogram(p, { binSec: 60 });
    if (!hs.n || hs.bins.length < 2) return null;
    const values = [], per = {};
    hs.bins.forEach((b) => {
      const mid = (b.x0 + b.x1) / 2;
      for (let i = 0; i < b.count; i++) values.push(mid);
      Object.keys(b.byChannel || {}).forEach((ch) => { const a = per[ch] || (per[ch] = []); for (let i = 0; i < b.byChannel[ch]; i++) a.push(mid); });
    });
    const withData = hs.channels.filter((c) => c.count > 0);
    const lim = limits(p);
    return {
      values, binSize: hs.binMs, min: 0, max: hs.bins[hs.bins.length - 1].x1, format: 'dur', x: { label: 'Ticket time' }, y: { label: 'Tickets' },
      series: ctx.filters.channel === 'all' && withData.length > 1 ? withData.map((c) => ({ id: c.channel, name: c.name, values: per[c.channel] || [] })) : undefined,
      refLines: lim ? [{ x: lim.warnMs, label: 'Warn ' + fmt.ms(lim.warnMs), tone: 'warn' }, { x: lim.breachMs, label: 'Overdue ' + fmt.ms(lim.breachMs), tone: 'bad' }] : [],
      ariaLabel: 'Distribution of ticket times, ' + hs.n + ' tickets, median ' + fmt.ms(hs.medianMs),
    };
  }

  // A stacked bar spec that splits ticket time into pacing hold, waiting for a cook, hands-on work and
  // waiting at expo.
  function stackSpec(rows, nameOf, extra) {
    return Object.assign({
      categories: rows.map(nameOf),
      parts: PARTS.map((q) => ({ id: q[0], name: q[1], values: rows.map((r) => (isNum(r[q[2]]) ? r[q[2]] : null)) })),
      format: 'dur',
    }, extra || {});
  }

  /** the rows for the slowest-tickets table: top 50 by time, with the longest wait named */
  function slowRows(p, ctx) {
    return memo(p, 'slow', () => {
      const by = {}; (ctx.dataset().menu || []).forEach((m) => { by[m.id] = m.name; });
      const chan = {}; (SB.config.channels || []).forEach((c) => { chan[c.id] = c.name; });
      return M.ticketAnatomy(p).slice().sort((a, b) => b.totalMs - a.totalMs).slice(0, 50).map((r) => {
        let best = PARTS[0], bestMs = -1;
        PARTS.forEach((q) => { if (r[q[2]] > bestMs) { bestMs = r[q[2]]; best = q; } });
        return {
          ticketId: r.ticketId, num: r.num, createdAt: r.createdAt, channel: r.channel, channelName: chan[r.channel] || r.channel, totalMs: r.totalMs,
          longest: bestMs > 0 ? best[1] + ', ' + fmt.ms(bestMs) : '-', longestMs: bestMs, item: r.criticalName || '-', level: r.level, levelRank: r.level === 'breach' ? 2 : r.level === 'warn' ? 1 : 0,
        };
      });
    });
  }

  // Opens the right-hand panel for one slow ticket: a Gantt of its items against the ticket clock.
  function openTicket(row, ctx) {
    K.drawer({
      title: 'Ticket #' + row.num, sub: row.channelName + ', ' + fmt.date(row.createdAt) + ' at ' + fmt.clock(row.createdAt) + '. Took ' + fmt.ms(row.totalMs) + ' (' + lc(levelWord[row.level] || '') + ').', width: 760, name: 'ticket-anatomy',
      // Draws the panel. If the ticket has left the data it says so instead.
      render(body) {
        const ds = ctx.dataset(), gt = M.ticketGantt(ds, row.ticketId);
        if (!gt || !gt.rows.length) { body.appendChild(K.empty({ title: 'This ticket is no longer in the data', body: 'It may have been cleared since the table was drawn. Close this panel and pick another ticket.' }).el); return null; }
        body.appendChild(h('p', { class: 'of-look' }, h('span', { class: 'of-look-l' }, 'What to look for: '), 'Each row is one item against the ticket clock. The gray bar is the paced hold, then waiting for a cook, then hands-on work. The last row is finished food waiting at expo.'));
        const host = h('div', { class: 'of-chart' }); body.appendChild(host);
        let th = null; try { th = M.thresholds(ds, row.channel); } catch (e) { /* no limit line */ }
        const chart = SB.charts.gantt(host, {
          rows: gt.rows, x: { type: 'sec', label: 'Time since the order came in' }, toneNames: PART_TONES,
          refLines: th && isNum(th.warnSec) ? [{ x: th.warnSec, label: 'Warn ' + fmt.sec(th.warnSec), tone: 'warn' }] : [],
          ariaLabel: 'Ticket ' + row.num + ' anatomy: each item against the ticket clock',
        });
        // Closing the panel destroys its chart.
        return { destroy() { chart.destroy(); } };
      },
    });
  }

  O.registerPage('tickets', {
    title: 'Tickets', icon: 'receipt', order: 2,
    // The Tickets page: headline, tiles, time histogram, on-time bars, where the time goes, patterns,
    // slowest tickets and findings.
    render(container, ctx) {
      const page = K.page(container, ctx, { id: 'tickets' });
      page.headline();
      page.how('Finished tickets are tickets that were sent out and not voided, counted on the day they were placed. Ticket time runs from when the ticket was entered until it was sent out; the middle ticket is the typical one. Overdue means a ticket reached or passed the overdue limit for its order type. Voided tickets were cancelled before they were sent out. The arrows compare with the same number of days just before this range.');
      page.tiles([
        { id: 'count', kpi: 'count', label: 'Finished tickets' },
        { id: 'median', kpi: 'medianMs', label: 'Median ticket time' },
        { id: 'overdue', kpi: 'overdue', label: 'Overdue tickets' },
        { id: 'voids', kpi: 'voids', label: 'Voided tickets' },
      ]);

      page.card({
        type: 'hist', span: 8, height: 300, title: 'How long tickets take',
        // The histogram subtitle explains the shared warn and overdue lines when several channels are
        // drawn.
        sub: (p, c) => (limits(p) && limits(p).mixed ? 'Each outline is one channel. Warn and overdue lines use the average limits across your channel mix.' : 'Every finished ticket, in one-minute steps'),
        caption: 'One tall hump means the line is consistent. A long tail to the right is the handful of tickets that went badly; the bars past the red line are overdue.',
        empty: { title: 'No finished tickets in this range', body: 'The histogram appears as soon as tickets are bumped. Pick a longer range to see the shape.' },
        spec: histSpec,
      });

      page.card({
        type: 'stack', span: 4, height: 300, title: 'On time by channel',
        sub: 'Share of finished tickets that were on time, running late or overdue',
        caption: 'The green part should fill most of the bar. A channel with more amber or red is the one to look at first.',
        empty: { title: 'No finished tickets yet', body: 'Each channel gets a bar once it has finished tickets in this range.' },
        // One bar per channel with the shares on time, running late and overdue.
        spec(p) {
          const s = M.sla(p); const rows = s.byChannel.filter((r) => r.count > 0);
          if (!rows.length) return null;
          return {
            categories: rows.map((r) => r.name), percent: true, format: 'int',
            parts: [{ id: 'ok', name: 'On time', tone: 'ok', values: rows.map((r) => r.ok) }, { id: 'warn', name: 'Running late', tone: 'warn', values: rows.map((r) => r.warn) }, { id: 'breach', name: 'Overdue', tone: 'bad', values: rows.map((r) => r.breach) }],
            ariaLabel: 'Share of tickets on time, running late and overdue, by channel',
          };
        },
      });

      page.more('Show more charts and findings');
      page.section('Where the time goes', 'Every ticket splits into four waits that add up to its total.');
      page.card({
        type: 'stack', span: 6, title: 'By channel', sub: 'Average per ticket',
        caption: 'Look for the widest part of each bar. A wide “Waiting to go out” part means finished food is sitting, not cooking. Items cooked in one step have no start tap, so their “Waiting for a cook” counts as zero and their work time runs from firing (estimated).',
        empty: { title: 'No finished tickets yet', body: 'Each channel gets a bar once it has finished tickets in this range.' },
        // Average ticket time per channel, split into its four waits.
        spec(p) {
          const a = M.anatomySummary(p); const rows = a.byChannel.filter((r) => r.count >= 1);
          if (!rows.length) return null;
          return stackSpec(rows, (r) => r.label, { ariaLabel: 'Average ticket time split into four waits, by channel' });
        },
      });
      page.card({
        type: 'stack', span: 6, title: 'By hour', sub: 'Average per ticket, hours with at least ' + MIN_N + ' tickets',
        caption: 'If the work part grows at lunch and dinner the cooks are the limit. If the hold or response part grows, the queue is.',
        empty: { title: 'Not enough tickets by hour', body: 'Hours need at least ' + MIN_N + ' finished tickets to show up here.' },
        // The same split per hour of service. Hours with fewer than three tickets are left out.
        spec(p) {
          const a = M.anatomySummary(p); const rows = a.byHour.filter((r) => r.count >= MIN_N);
          if (!rows.length) return null;
          return stackSpec(rows, (r) => r.label, { ariaLabel: 'Average ticket time split into four waits, by hour of service' });
        },
      });

      page.section('Patterns');
      page.card({
        type: 'heat', span: 7, title: 'Median ticket time by weekday and hour', sub: 'Cells with fewer than ' + MIN_N + ' tickets are left empty',
        caption: 'The darkest cells are your slowest slots. Find the weekday and hour that repeats and plan an extra pair of hands there.',
        empty: { title: 'Not enough tickets yet', body: 'The map needs a few finished tickets in the same weekday and hour. Last 14 days shows it best.' },
        // Weekday by hour map of median ticket time. Cells with too few tickets stay empty.
        spec(p) {
          const w = M.byWeekdayHour(p);
          if (!w.cols.length) return null;
          const values = w.values.map((row, i) => row.map((v, j) => (isNum(v) && w.counts[i][j] >= MIN_N ? v : null)));
          if (!values.some((row) => row.some((v) => v !== null))) return null;
          // The chart's colour legend is a fixed 190 px wide, so on a very narrow phone only bare minutes
          // leave room. The chart's colour legend is a fixed 190 px wide; on a very narrow phone only
          // bare minutes leave room for it.
          const narrow = !!(window.matchMedia && window.matchMedia('(max-width: 339px)').matches);
          return { rows: w.rows, cols: w.cols, values, scale: 'seq', format: narrow ? (v) => String(Math.round(v / 60000)) : 'dur', legendLabel: narrow ? 'Median ticket time, minutes' : 'Median ticket time', ariaLabel: 'Median ticket time by weekday and hour' };
        },
      });
      page.card({
        type: 'line', span: 5, title: 'On-time share by day', sub: 'Tickets finished before their warning time',
        caption: 'A line drifting down over several days is a slow change you would not notice shift by shift. Days with fewer than ' + MIN_N + ' tickets are left out.',
        empty: { title: 'A trend needs at least two days', body: 'Pick Last 7 days or Last 14 days to see how the on-time share moves from day to day.', icon: 'chart-line' },
        // On-time share per day as a line with the 90% target. Needs at least two days with enough
        // tickets.
        spec(p) {
          const days = M.byDay(p).filter((d) => d.count >= MIN_N && isNum(d.onTimePct));
          if (days.length < 2) return null;
          const lo = Math.max(0, Math.floor((Math.min.apply(null, days.map((d) => d.onTimePct)) - 0.05) * 10) / 10);
          return {
            series: [{ id: 'ontime', name: 'On time', slot: 1, area: true, points: days.map((d) => [d.label, d.onTimePct]) }],
            x: { type: 'cat' }, y: { format: 'pct', min: lo, max: 1 }, refLines: [{ y: 0.9, label: 'Target 90%', tone: 'ok' }],
            ariaLabel: 'Share of tickets on time, by day',
          };
        },
      });

      page.table({
        span: 12, title: 'Slowest tickets', sub: 'The 50 slowest finished tickets in this range. Open one to see its items against the ticket clock.',
        caption: 'Open the slowest few and look at the long bar: if it is always the same item or the same wait, that is the thing to fix.',
        // Row labels for screen readers, then the columns. Wide-only columns are hidden on phones.
        pageSize: 8, defaultSort: 'totalMs', defaultDir: 'desc', rowLabel: (r) => 'Open ticket ' + r.num + ' anatomy',
        empty: { title: 'No finished tickets in this range', body: 'The slowest tickets appear here once tickets have been bumped.', icon: 'receipt' },
        columns: [
          // The ticket column carries the date under the number on phones, where the When column is
          // hidden.
          { key: 'num', label: 'Ticket', sort: true, nowrap: true, width: 90, format: (v, r) => h('span', null, '#' + v, h('br', { class: 'of-when-br' }), h('span', { class: 'of-when-sub' }, fmt.date(r.createdAt) + ', ' + fmt.clock(r.createdAt))) },
          { key: 'createdAt', label: 'When', sort: true, nowrap: true, wideOnly: true, format: (v) => fmt.date(v) + ', ' + fmt.clock(v) },
          { key: 'channelName', label: 'Channel', sort: true, nowrap: true, wideOnly: true },
          // Time shows the whole ticket in minutes and seconds.
          { key: 'totalMs', label: 'Time', sort: true, align: 'right', format: (v) => fmt.ms(v) },
          { key: 'longest', label: 'Longest wait', sort: true, nowrap: true, sortKey: 'longestMs', wideOnly: true },
          { key: 'item', label: 'Last item finished', sort: true, wideOnly: true },
          // Status is a badge with an icon and a word, so it never relies on colour alone.
          { key: 'level', label: 'Status', sort: true, nowrap: true, sortKey: 'levelRank', format: (v) => SB.ui.badge(v === 'breach' ? 'breach' : v === 'warn' ? 'warn' : 'ok') },
        ],
        rows: slowRows,
        // A click on a row, or on its ticket number, opens that ticket's panel.
        onRow: (r) => openTicket(r, ctx),
      });

      page.insights({ limit: 6, only: ['pace-overview', 'slow-hour', 'channel-gap', 'expo-dwell', 'forced-bumps', 'voids', 'recalls', 'pacing-effect'] });
      // The kit removes every card, chart and listener when the page closes.
      return { destroy() { page.destroy(); } };
    },
  });

  // Words for a prep time that runs slower or quicker than the starter estimate.
  const driftWord = { slow: 'Slower', fast: 'Quicker' };
  /** engine action ids as a cook would say them */
  const ACTION_WORDS = { createTicket: 'placing an order', addItems: 'adding to an order', startItem: 'starting an item', completeItem: 'finishing an item', bumpTicket: 'bumping a ticket', voidTicket: 'voiding a ticket', recallTicket: 'recalling a ticket', fireNow: 'firing an item early', setAvailability: 'changing an 86', addBatch: 'adding a batch', logTemp: 'logging a temperature', discardBatch: 'discarding a batch' };
  const actionWords = (a) => ACTION_WORDS[a] || String(a).replace(/([A-Z])/g, ' $1').toLowerCase();

  O.registerPage('stations', {
    title: 'Stations', icon: 'layers', order: 3,
    // The Stations page: headline, tiles, queue load, response and work times, overdue by station, prep
    // times, friction and findings.
    render(container, ctx) {
      const page = K.page(container, ctx, { id: 'stations' });
      page.headline();
      page.how('Each item on a ticket belongs to one station. A ticket counts at the station whose item finished last. Waiting means the time between an item being sent to the station and a cook starting it; work is the time the cook spent on it. Prep times are compared with the starter estimates in Menu, prices and shop, and only items with at least 5 finished lines are judged.');
      page.tiles([
        { id: 'overdue', kpi: 'overdue', label: 'Overdue tickets' },
        { id: 'spread', kpi: 'avgSpreadMs', label: 'First to last item' },
        { id: 'lamp', kpi: 'avgLampMs', label: 'Finished food waiting' },
        // Items finished per hour has no ready-made KPI, so it reads the summary for this and the earlier
        // period.
        { id: 'items', label: 'Items finished per hour', kind: 'count', good: 'neutral', format: 'num', value: (p) => { const s = M.summary(p); return s.count ? s.itemsPerHour : null; }, previous: (p, c) => { const s = M.summary(c.previous()); return s.count ? s.itemsPerHour : null; } },
      ]);

      page.card({
        type: 'line', span: 12, height: 280, title: 'Items waiting at each station through the service day',
        // The subtitle says how many days the half-hour slots are averaged over.
        sub: (p) => { const q = M.queueLoad(p, { fold: true, bucketMin: 30 }); return 'Items fired and not yet finished, averaged in half-hour slots' + (q.days > 1 ? ' over ' + q.days + ' days' : ''); },
        caption: 'Each band is a station, stacked. A tall band at lunch or dinner is the station that is queueing; a flat one has room to spare.',
        empty: { title: 'Not enough station activity yet', body: 'Station load is rebuilt from when items were fired and finished. It fills in once items have been finished in this range.' },
        // Stacked lines: items fired and not yet finished at each station through the day. Needs at least
        // three time slots.
        spec(p) {
          const q = M.queueLoad(p, { fold: true, bucketMin: 30 });
          if (!q.series.length || q.points.length < 3) return null;
          const dom = hourDomain(p);
          return {
            series: q.series.map((s) => ({ id: s.zone, name: s.name, points: s.points })), stacked: true,
            x: Object.assign({ type: 'hour' }, dom || {}), y: { format: 'num', label: 'Open items', zero: true }, ariaLabel: 'Open items per station through the service day',
          };
        },
      });

      page.more('Show more charts and findings');
      page.card({
        type: 'bar', span: 6, title: 'Response and work time by station', sub: 'Median, from the moment an item fires',
        caption: 'Response is how long an item waits before a cook touches it; work is the hands-on time. Items with no start tap show zero response and count work from firing, so those times are estimated. A long response means the station is short of hands, a long work time means the dish itself is slow.',
        empty: { title: 'No finished items yet', body: 'Each station gets bars once it has finished items in this range.' },
        // Two bars per station: the median wait before a cook touches an item, and the median hands-on
        // time.
        spec(p) {
          const z = M.byZone(p).filter((r) => r.workN > 0);
          if (!z.length) return null;
          return {
            orient: 'v', categories: z.map((r) => r.name), format: 'dur', labels: 'auto',
            series: [{ id: 'response', name: 'Response (fired to first touch)', values: z.map((r) => (r.responseN > 0 ? r.medianResponseMs : null)) }, { id: 'work', name: 'Work (hands-on)', values: z.map((r) => r.medianWorkMs) }],
            ariaLabel: 'Median response and work time by station',
          };
        },
      });

      page.card({
        type: 'bar', span: 6, title: 'Overdue tickets by station', sub: 'A ticket counts at the station whose item finished last',
        caption: 'Bars show tickets that went past their overdue time. The station that finishes last is not always the slow one, so read this next to the chart on the left.',
        empty: { title: 'No finished tickets yet', body: 'Stations appear here once tickets have been finished in this range.' },
        // Overdue tickets per station, coloured by what share of that station's tickets were overdue.
        spec(p) {
          const z = M.byZone(p).filter((r) => r.criticalCount > 0);
          if (!z.length) return null;
          return {
            orient: 'h', categories: z.map((r) => r.name), format: 'int', labels: 'all',
            series: [{ id: 'od', name: 'Overdue tickets', values: z.map((r) => r.overdueCritical) }],
            tones: z.map((r) => { const sh = r.overdueCritical / r.criticalCount; return r.overdueCritical === 0 ? 'ok' : sh >= 0.1 ? 'bad' : 'warn'; }),
            toneWords: { ok: 'None overdue', warn: 'Some overdue', bad: 'Many overdue' },
            ariaLabel: 'Overdue tickets by the station that finished last',
          };
        },
      });

      page.card({
        // The dumbbell card: starter, learned and observed prep time for each item. The subtitle counts
        // items with enough samples.
        type: 'dumbbell', span: 12, title: 'Prep times: starter, learned and observed', sub: (p) => { const n = M.calibration(p).filter((r) => !r.thin).length; return 'The dot you set against the dot the line really did. ' + (n ? 'Showing the ' + Math.min(12, n) + ' items that differ most' + (n > 12 ? ' of ' + n : '') + '. ' : '') + 'Items with fewer than 5 samples are left out.'; },
        caption: 'A row marked slower or quicker is off the starter estimate by more than a quarter. Confirm the new time in Menu, prices and shop and pacing will plan for it.',
        empty: { title: 'Not enough finished items to judge prep times', body: 'Each item needs at least 5 finished lines in this range. A longer range gives it more to work with.', icon: 'timer' },
        // The 12 items whose observed time differs most from the starter estimate. A flag marks those off
        // by a quarter or more.
        spec(p) {
          const rows = M.calibration(p).filter((r) => !r.thin && isNum(r.starterSec) && isNum(r.observedSec));
          if (!rows.length) return null;
          const top = rows.slice().sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio))).slice(0, 12);
          return {
            rows: top.map((r) => ({ label: r.name, a: r.starterSec, b: isNum(r.learnedSec) ? r.learnedSec : null, c: r.observedSec, aLabel: fmt.sec(r.starterSec), bLabel: isNum(r.learnedSec) ? fmt.sec(r.learnedSec) : undefined, cLabel: fmt.sec(r.observedSec), flag: r.flag ? (driftWord[r.drift] || true) : false })),
            format: 'durS', aName: 'Starter estimate', bName: 'Learned', cName: 'Observed median', sort: 'none', ariaLabel: 'Starter, learned and observed prep time per item',
          };
        },
      });

      page.card({
        type: 'bar', span: 7, title: 'Slip-ups on the board', sub: 'Events per 100 tickets',
        caption: 'We judge the screen by how often cooks hit a snag. If refused taps or undos climb, the screen is getting in their way, and that is a design problem, not a cook problem.',
        empty: { title: 'No tickets in this range', body: 'Friction is counted per 100 tickets, so it needs some tickets to measure against.' },
        // Events per 100 tickets for each kind of snag: undone taps, refused taps, forced bumps, early
        // fires, recalls and voids.
        spec(p) {
          const f = M.frictionSummary(p);
          if (!f.tickets) return null;
          // Rounds to one decimal. Unknown stays unknown (no bar, '-' in the tooltip), never a fake zero.
          const per = (x) => (isNum(x) ? Math.round(x * 10) / 10 : null);
          // A share (0 to 1) as events per 100, or null when it is unknown.
          const pc = (x) => (isNum(x) ? x * 100 : null);
          return {
            orient: 'h', format: 'num', labels: 'all',
            categories: ['Undone actions', 'Taps the app could not accept', 'Sent out before all dishes were done', 'Fired early by hand', 'Recalled tickets', 'Voided tickets'],
            series: [{ id: 'per100', name: 'Per 100 tickets', values: [per(f.undo.per100Tickets), per(f.reports.per100Tickets), per(pc(f.forced.pct)), per(pc(f.overrides.pct)), per(pc(f.recalls.pct)), per(pc(f.voids.pct))] }],
            ariaLabel: 'Slip-ups per 100 tickets: undone actions, refused taps, forced bumps, early fires, recalls and voids',
          };
        },
      });

      page.panel({
        span: 5, title: 'What the screen refused most', sub: 'Messages cooks saw when a tap could not be done',
        caption: 'The top message is the first thing to design away: an item that is 86’d should not be orderable, for example.',
        // The 'what the screen refused most' list: the top five messages with their counts and the action
        // that caused them.
        render(body, p0) {
          const list = h('ol', { class: 'of-reasons' });
          const wrap = h('div'); body.appendChild(wrap);
          let last = '';
          // Redraws the list only when the counts changed, or shows a friendly 'nothing was refused' box.
          function paint(p) {
            const f = M.frictionSummary(p), top = f.reports.top || [];
            const key = JSON.stringify(top.map((t) => [t.report, t.count]));
            if (key === last) return; last = key;
            U.clear(wrap);
            if (!top.length) { wrap.appendChild(K.empty({ title: 'Nothing was refused in this range', body: 'When a tap cannot be done (an item that is 86’d, a ticket already bumped) the message is counted here.', icon: 'check-circle' }).el); return; }
            U.clear(list);
            top.slice(0, 5).forEach((t) => {
              const act = t.topAction ? ' Most often while ' + actionWords(t.topAction) + '.' : '';
              list.appendChild(h('li', { class: 'of-reason' }, h('span', { class: 'of-reason-n num' }, String(t.count)), h('div', null, h('p', { class: 'of-reason-m' }, t.message), h('p', { class: 'of-reason-s' }, Math.round(t.share * 100) + '% of refusals.' + act))));
            });
            wrap.appendChild(list);
          }
          paint(p0);
          // The page calls update with fresh numbers and destroy when it closes.
          return { update: paint, destroy() { U.clear(wrap); } };
        },
      });

      page.insights({ limit: 6, only: ['bottleneck-station', 'calibration-drift', 'expo-dwell', 'undo-rate', 'top-error', 'forced-bumps', 'recalls', 'voids'] });
      // The kit removes every card, chart and listener when the page closes.
      return { destroy() { page.destroy(); } };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
