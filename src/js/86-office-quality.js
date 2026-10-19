/*
 * WHAT THIS FILE IS: The "Quality" back-office page: a defect view of the kitchen in the Six Sigma style. A sigma
 *    score, a Pareto of what goes wrong, the likely causes of late tickets, two control charts, process
 *    capability and the worst tickets.
 * PARTS: SVG helpers, the report cache, the score panel, Pareto, causes, control charts, capability, tables.
 * USES: 41-quality.js (the maths), 80-office-core.js (the kit).   USED BY: the office frame.
 * RULE: with too few tickets the page says "not enough data yet" and draws no limits, never a line through noise.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  if (!g.document) return;
  const U = SB.util;
  const O = SB.office;
  if (!O || typeof O.registerPage !== 'function') return;
  const h = U.h;
  // True only for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const NS = 'http://www.w3.org/2000/svg';

  // Fewest days a control chart needs before its limits mean anything, and fewest tickets for a sigma score.
  const MIN_DAYS = 5, MIN_TICKETS = 20;

  // Makes one SVG element with attributes and children.
  function svg(tag, attrs, kids) {
    const el = g.document.createElementNS(NS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, String(attrs[k]));
    for (const c of kids || []) if (c) el.appendChild(c);
    return el;
  }
  // A text element at a position.
  const text = (x, y, s, attrs) => { const t = svg('text', Object.assign({ x, y }, attrs || {})); t.textContent = s; return t; };
  // Percent text from a fraction, with one decimal under 10 percent.
  const pct = (x) => (isNum(x) ? (x * 100 < 10 && x > 0 ? (x * 100).toFixed(1) : Math.round(x * 100)) + '%' : '-');
  // A plain count with thousands separators.
  const num = (n) => (isNum(n) ? Math.round(n).toLocaleString('en-US') : '-');
  // Sigma level to one decimal, "6+" when no defects were seen.
  const sig = (s, defects) => (!isNum(s) ? '-' : defects === 0 ? '6+' : s.toFixed(1));

  // Pareto chart: bars for each defect type, a line for the running share, both with words on the axis.
  function paretoSvg(rows) {
    const W = 760, H = 300, L = 46, R = 46, T = 20, B = 86;
    const pw = W - L - R, ph = H - T - B;
    const max = Math.max(1, rows[0].count);
    const bw = pw / rows.length;
    const kids = [];
    for (let i = 0; i <= 4; i++) { const y = T + ph - (ph * i) / 4; kids.push(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'qc-grid' })); kids.push(text(L - 8, y + 4, String(Math.round((max * i) / 4)), { class: 'qc-axis', 'text-anchor': 'end' })); kids.push(text(W - R + 8, y + 4, String(i * 25) + '%', { class: 'qc-axis' })); }
    const pts = [];
    rows.forEach((r, i) => {
      const x = L + i * bw, bh = (ph * r.count) / max;
      kids.push(svg('rect', { x: x + bw * 0.14, y: T + ph - bh, width: bw * 0.72, height: bh, class: 'qc-bar', 'data-process': r.process }));
      kids.push(text(x + bw / 2, T + ph - bh - 6, String(r.count), { class: 'qc-val', 'text-anchor': 'middle' }));
      const lab = text(x + bw / 2, T + ph + 16, r.label, { class: 'qc-axis', 'text-anchor': 'end', transform: 'rotate(-32 ' + (x + bw / 2) + ' ' + (T + ph + 16) + ')' });
      kids.push(lab);
      pts.push([x + bw / 2, T + ph - ph * r.cum]);
    });
    kids.push(svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'qc-cum' }));
    pts.forEach((p) => kids.push(svg('circle', { cx: p[0], cy: p[1], r: 4, class: 'qc-cum-dot' })));
    return svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'qc-svg', role: 'img', 'aria-label': 'Pareto chart of defects. ' + rows.map((r) => r.label + ' ' + r.count).join(', ') + '.' }, kids);
  }

  // Control chart: one dot per day, a centre line, upper and lower limits, and a ring plus a word on any day outside them.
  // pts: [{label, v, out}], lim: {centre, ucl, lcl}, fmtY formats axis numbers.
  function controlSvg(pts, lim, fmtY, aria) {
    const W = 760, H = 250, L = 56, R = 20, T = 16, B = 36;
    const pw = W - L - R, ph = H - T - B;
    const vals = pts.map((p) => p.v).concat([lim.ucl, lim.lcl, lim.centre]).filter(isNum);
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad; // shares and minutes are never below zero
    // Chart x position of the i-th day, spread evenly across the plot.
    const X = (i) => L + (pts.length === 1 ? pw / 2 : (pw * i) / (pts.length - 1));
    // Chart y position of a value, higher values nearer the top.
    const Y = (v) => T + ph - (ph * (v - lo)) / (hi - lo);
    const kids = [];
    for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3, y = Y(v); kids.push(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'qc-grid' })); kids.push(text(L - 8, y + 4, fmtY(v), { class: 'qc-axis', 'text-anchor': 'end' })); }
    // Draws one horizontal limit or average line with its label.
    const line = (v, cls, label) => { if (!isNum(v)) return; const y = Y(v); kids.push(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: cls })); kids.push(text(W - R - 4, y - 5, label + ' ' + fmtY(v), { class: 'qc-lim', 'text-anchor': 'end' })); };
    line(lim.ucl, 'qc-ucl', 'Upper limit'); line(lim.lcl, 'qc-lcl', 'Lower limit'); line(lim.centre, 'qc-centre', 'Average');
    kids.push(svg('polyline', { points: pts.map((p, i) => X(i) + ',' + Y(p.v)).join(' '), class: 'qc-path' }));
    pts.forEach((p, i) => {
      kids.push(svg('circle', { cx: X(i), cy: Y(p.v), r: p.out ? 6 : 4, class: p.out ? 'qc-dot qc-dot--out' : 'qc-dot' }));
      if (p.out) kids.push(text(X(i), Y(p.v) - 12, p.out === 'high' ? 'HIGH' : 'LOW', { class: 'qc-flag', 'text-anchor': 'middle' }));
      if (pts.length <= 16 || i % Math.ceil(pts.length / 12) === 0) kids.push(text(X(i), H - 12, p.label, { class: 'qc-axis', 'text-anchor': i === pts.length - 1 ? 'end' : 'middle' }));
    });
    return svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'qc-svg', role: 'img', 'aria-label': aria }, kids);
  }

  // Histogram of ticket minutes with the overdue limit drawn as a vertical line.
  function histSvg(bins, limitMin) {
    const W = 760, H = 220, L = 40, R = 20, T = 16, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const n = Math.max(bins.length, Math.ceil(limitMin) + 2);
    const max = Math.max(1, ...bins.map((b) => b.n));
    const bw = pw / n;
    const kids = [svg('line', { x1: L, x2: W - R, y1: T + ph, y2: T + ph, class: 'qc-grid' })];
    bins.forEach((b) => { const bh = (ph * b.n) / max; kids.push(svg('rect', { x: L + b.minute * bw + 1, y: T + ph - bh, width: bw - 2, height: bh, class: b.minute >= limitMin ? 'qc-bar qc-bar--late' : 'qc-bar', 'data-process': 'ticket' })); });
    for (let i = 0; i <= n; i += Math.max(1, Math.ceil(n / 10))) kids.push(text(L + i * bw, H - 12, i + 'm', { class: 'qc-axis', 'text-anchor': 'middle' }));
    const lx = L + limitMin * bw;
    kids.push(svg('line', { x1: lx, x2: lx, y1: T, y2: T + ph, class: 'qc-ucl' }), text(lx + 6, T + 12, 'Overdue at ' + Math.round(limitMin) + ' min', { class: 'qc-lim' }));
    return svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'qc-svg', role: 'img', 'aria-label': 'Histogram of ticket times in minutes, with the overdue limit at ' + Math.round(limitMin) + ' minutes.' }, kids);
  }

  // Builds the Quality page into the container and returns what the frame needs to refresh and clean up.
  function render(container, ctx) {
    const kit = ctx.kit || O.kit;
    if (!kit || typeof kit.page !== 'function') throw new Error('The back-office kit is not available (80-office-core.js).');
    const page = kit.page(container, ctx, { id: 'quality' });
    // The report is worked out once per data set, range and channel, then shared by every panel.
    let memo = { ds: null, key: '', rep: null };
    const report = () => {
      const ds = ctx.dataset(), F = ctx.filters;
      const key = F.range.from + ':' + F.range.to + ':' + F.channel;
      if (memo.ds !== ds || memo.key !== key) memo = { ds, key, rep: SB.quality.analyze(ds, { from: F.range.from, to: F.range.to, channel: F.channel }) };
      return memo.rep;
    };
    // Makes a panel whose body is rebuilt from the report on every refresh. draw(body, rep) fills it.
    const panel = (o, draw) => page.panel(Object.assign({}, o, { render(body) {
      // The frame calls render once (draw now), then update on every refresh (draw again from the fresh report).
      const paint = () => { U.clear(body); try { draw(body, report()); } catch (e) { body.appendChild(h('p', { class: 'qc-note' }, 'This panel could not be drawn: ' + (e && e.message))); } };
      paint();
      return { update: paint };
    } }));

    page.section('How good is the line right now?', 'Counted from every ticket and every batch in the range above. A defect is anything on the list in the table at the bottom.');
    panel({ title: 'Sigma score', sub: 'Defects per million chances', span: 12 }, (body, r) => {
      const t = r.tickets, c = r.cabinet;
      if (t.units < MIN_TICKETS) { body.appendChild(h('p', { class: 'qc-note' }, 'Not enough data yet: ' + t.units + ' finished tickets in this range. A score needs at least ' + MIN_TICKETS + '. Pick a longer range or keep cooking.')); }
      // One score tile: a label, a big value and a small line under it.
      const tile = (label, value, sub, tone) => h('div', { class: 'qc-tile', dataset: { tone: tone || 'info' } }, h('span', { class: 'qc-tile-l' }, label), h('span', { class: 'qc-tile-v num' }, value), h('span', { class: 'qc-tile-s' }, sub));
      const level = t.units >= MIN_TICKETS ? sig(t.sigma, t.defects) : '-';
      const tone = !isNum(t.sigma) || t.units < MIN_TICKETS ? 'info' : t.sigma >= 4 ? 'good' : t.sigma >= 3 ? 'warn' : 'bad';
      body.appendChild(h('div', { class: 'qc-tiles' },
        tile('Ticket sigma level', level, tone === 'good' ? 'Strong' : tone === 'warn' ? 'Room to improve' : tone === 'bad' ? 'Many tickets go wrong' : 'Needs more tickets', tone),
        tile('Defects per million', t.dpmo === null ? '-' : num(t.dpmo), num(t.defects) + ' defects in ' + num(t.opps) + ' chances'),
        tile('Tickets with no defect', pct(t.firstPass), num(t.units - t.defective) + ' of ' + num(t.units) + ' tickets'),
        tile('Cabinet sigma level', c.units >= 5 ? sig(c.sigma, c.defects) : '-', num(c.defects) + ' defects in ' + num(c.opps) + ' chances'),
        tile('Food thrown away', U.fmtMoney(r.cost, 2), 'cost of discarded batches in range')));
      body.appendChild(h('p', { class: 'qc-note' }, 'Sigma level uses the standard 1.5 sigma shift. A level of 6+ only means no defects were seen, not that none can happen.'));
    });

    page.section('What goes wrong most?', 'Fix the tallest bar first. A Pareto chart is sorted so the few causes that make most of the trouble stand out.');
    panel({ title: 'Defects by type (Pareto)', sub: 'Bars are counts; the line is the running share', span: 7, caption: 'The first one or two bars usually hold most of the defects. Start there.' }, (body, r) => {
      if (!r.pareto.length) { body.appendChild(h('p', { class: 'qc-note' }, 'No defects recorded in this range. That is the goal.')); return; }
      body.appendChild(paretoSvg(r.pareto));
      body.appendChild(h('p', { class: 'qc-note' }, 'Orange bars are ticket defects, blue bars are hold-cabinet defects.'));
    });
    panel({ title: 'Why tickets ran late', sub: 'Best guess from what the app recorded', span: 5, caption: 'This is a guess from timestamps, so check it before you change anything.' }, (body, r) => {
      if (!r.causes.length) { body.appendChild(h('p', { class: 'qc-note' }, 'No late tickets in this range.')); return; }
      const list = h('ul', { class: 'qc-causes' });
      for (const c of r.causes) list.appendChild(h('li', null, h('span', { class: 'qc-cause-l' }, c.label), h('span', { class: 'qc-cause-bar' }, h('span', { style: 'width:' + Math.round(c.share * 100) + '%' })), h('span', { class: 'qc-cause-n num' }, c.count + ' (' + pct(c.share) + ')')));
      body.appendChild(list);
    });

    page.section('Is it getting better or worse?', 'A control chart separates a bad day from a changed process. Dots inside the limits are normal ups and downs; a dot outside, or eight in a row on one side, means something real changed.');
    panel({ title: 'Share of tickets with a defect, by day', sub: 'p-chart', span: 12, caption: 'A flagged day is worth asking about. A day inside the limits is normal noise, so do not scold anyone for it.' }, (body, r) => {
      const d = r.chart.days.filter((x) => x.n > 0);
      if (d.length < MIN_DAYS) { body.appendChild(h('p', { class: 'qc-note' }, 'Not enough data yet: ' + d.length + ' service ' + (d.length === 1 ? 'day' : 'days') + '. Control limits need at least ' + MIN_DAYS + ' days, so none are drawn.')); return; }
      // Each day has its own limits (they widen on slow days), so the chart draws the average and the widest limits.
      const widest = d.reduce((a, x) => (x.ucl - x.lcl > a.ucl - a.lcl ? x : a), d[0]);
      body.appendChild(controlSvg(d.map((x) => ({ label: U.fmtDateShort(x.date), v: x.p, out: x.out })), { centre: r.chart.pbar, ucl: widest.ucl, lcl: widest.lcl }, (v) => Math.round(v * 100) + '%', 'Share of tickets with at least one defect for each day. Average ' + pct(r.chart.pbar) + '.'));
      const bad = d.filter((x) => x.out || x.run);
      body.appendChild(h('p', { class: 'qc-note' }, bad.length ? bad.length + ' ' + (bad.length === 1 ? 'day signals' : 'days signal') + ' a real change: ' + bad.map((x) => U.fmtDateShort(x.date) + (x.out === 'high' ? ' (worse)' : x.out === 'low' ? ' (better)' : ' (long run)')).join(', ') + '.' : 'No day is outside its limits. The process looks steady.'));
    });
    panel({ title: 'Average ticket time, by day', sub: 'Individuals chart', span: 12 }, (body, r) => {
      const d = r.chart.days.filter((x) => isNum(x.meanMin));
      if (d.length < MIN_DAYS || r.chart.imr.ucl === null) { body.appendChild(h('p', { class: 'qc-note' }, 'Not enough data yet: ' + d.length + ' service ' + (d.length === 1 ? 'day' : 'days') + '. Needs at least ' + MIN_DAYS + '.')); return; }
      const im = r.chart.imr;
      body.appendChild(controlSvg(d.map((x) => ({ label: U.fmtDateShort(x.date), v: x.meanMin, out: x.meanOut })), im, (v) => v.toFixed(1) + 'm', 'Average ticket minutes for each day. Average ' + im.centre.toFixed(1) + ' minutes.'));
    });

    page.section('Can the line hit its time?', 'Capability compares the spread of ticket times with the overdue limit. Cpk of 1.33 or more is comfortable; under 1 means many tickets will run late.');
    panel({ title: 'Ticket time against the overdue limit', sub: 'Capability', span: 12 }, (body, r) => {
      const cp = r.capability;
      body.appendChild(h('div', { class: 'qc-tiles' },
        h('div', { class: 'qc-tile', dataset: { tone: !cp.enough ? 'info' : cp.cpk >= 1.33 ? 'good' : cp.cpk >= 1 ? 'warn' : 'bad' } }, h('span', { class: 'qc-tile-l' }, 'Cpk'), h('span', { class: 'qc-tile-v num' }, cp.enough && isNum(cp.cpk) ? cp.cpk.toFixed(2) : '-'), h('span', { class: 'qc-tile-s' }, cp.enough ? (cp.cpk >= 1.33 ? 'Comfortable' : cp.cpk >= 1 ? 'Tight' : 'Not capable') : 'Needs 30 tickets, have ' + cp.n)),
        h('div', { class: 'qc-tile' }, h('span', { class: 'qc-tile-l' }, 'Average'), h('span', { class: 'qc-tile-v num' }, isNum(cp.mean) ? cp.mean.toFixed(1) + ' min' : '-'), h('span', { class: 'qc-tile-s' }, 'standard deviation ' + (isNum(cp.sd) ? cp.sd.toFixed(1) + ' min' : '-'))),
        h('div', { class: 'qc-tile' }, h('span', { class: 'qc-tile-l' }, 'Overdue limit'), h('span', { class: 'qc-tile-v num' }, cp.limit.toFixed(0) + ' min'), h('span', { class: 'qc-tile-s' }, 'from the channel settings'))));
      if (r.histogram.length) body.appendChild(histSvg(r.histogram, cp.limit));
    });

    // Table cell formatters and row builders for the two tables below.
    // Shows a per-million rate, or says it was not measured.
    const fmtPerMillion = (v) => (isNum(v) ? num(v) : 'not measured');
    // Shows a ticket number with a hash sign.
    const fmtTicket = (v) => '#' + v;
    // Shows a service day as a short date.
    const fmtDay = (v) => U.fmtDateShort(v);
    // Shows a number of minutes with one decimal place.
    const fmtMinutes = (v) => (isNum(v) ? v.toFixed(1) : '-');
    // Rows for the defect table: tickets then cabinet, with plain words for the process.
    const defectRows = () => { const r = report(); return r.tickets.types.concat(r.cabinet.types).map((x) => Object.assign({}, x, { process: x.process === 'ticket' ? 'Tickets' : 'Hold cabinet' })); };
    // Rows for the worst-tickets table.
    const worstRows = () => report().worst.map((x) => Object.assign({}, x, { defectText: x.defects.join(', '), cause: x.cause || '-' }));
    page.section('Where to look', 'The tickets and the checks behind the numbers.');
    page.table({
      title: 'Every defect type, and how it is counted', span: 12,
      columns: [
        { key: 'label', label: 'Defect', sort: true }, { key: 'process', label: 'Where', sort: true }, { key: 'defects', label: 'Defects', align: 'right', sort: true }, { key: 'opps', label: 'Chances', align: 'right', sort: true },
        { key: 'dpmo', label: 'Per million', align: 'right', sort: true, format: fmtPerMillion }, { key: 'how', label: 'How it is counted' },
      ],
      rows: defectRows,
      empty: { body: 'No tickets in this range yet.' },
    });
    page.table({
      title: 'The worst tickets', sub: 'Most defects first, then slowest', span: 12,
      columns: [
        { key: 'num', label: 'Ticket', align: 'right', sort: true, format: fmtTicket }, { key: 'date', label: 'Day', sort: true, format: fmtDay }, { key: 'customer', label: 'For' },
        { key: 'minutes', label: 'Minutes', align: 'right', sort: true, format: fmtMinutes }, { key: 'defectText', label: 'What went wrong' }, { key: 'cause', label: 'Likely cause' },
      ],
      rows: worstRows,
      empty: { body: 'No defective tickets in this range.' },
    });
    return {
      // The kit refreshes the page's panels itself, so there is nothing to do here.
      update() {},
      // Removes the page and everything it built.
      destroy() { page.destroy(); },
    };
  }

  O.registerPage('quality', { title: 'Quality', icon: 'target', order: 0, render });
})(typeof globalThis !== 'undefined' ? globalThis : window);
