/*
 * WHAT THIS FILE IS: A printable food-safety record for the owner: temperature readings, reheats, cooling, sanitize
 * rounds and thrown-out food, each with who logged it, and any corrections added later. It opens from the Safety page.
 * PARTS: 1 pure rows (runs in Node tests), 2 the sheet and printing, 3 the Safety page bar.
 * USES: SB.engine.safetyLog (read only), SB.store, SB.ui.sheet, SB.util.   USED BY: 80-office-core.js (Safety page bar).
 * HONEST: this is the owner's own record, not an inspection result or a certificate. Entries are never edited; a
 * correction is a new line under the entry it corrects.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const O = (SB.office = SB.office || {});
  // True only for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const KIND = {
    temp_logged: 'Temperature reading', batch_reheat: 'Reheated', batch_discard: 'Thrown out', cooling_started: 'Cooling started',
    safety_setting_changed: 'Changed a safety limit', month_closed: 'History saved and cleared', equip_temp: 'Equipment temperature', thermometer_checked: 'Thermometer check', batch_out: 'Taken out of the fridge', batch_back: 'Put back in the fridge', sanitize_done: 'Sanitized surfaces', quality_extend: 'Kept serving past its quality limit', quality_extend_corrected: 'Quality-limit note corrected',
  };
  const REASON = { expired: 'Expired', quality: 'Quality', temp: 'Temperature', cooling: 'Cooling', manual: 'Other', other: 'Other', fridgeDate: 'Past your fridge limit', outTime: 'Past your out-of-fridge limit', datemark: 'Past the date mark' };
  const UNIT = { cooler: 'Cooler', freezer: 'Freezer', display: 'Display case', other: 'Equipment' };
  const METHOD = { ice: 'ice water', boiling: 'boiling water', other: 'other method' };

  // ---- 1. Pure rows ----

  // The plain "late by 12 min" / "on time" words for a reading or round.
  function lateWords(e) {
    if (e.onTime === true || (isNum(e.lateMs) && e.lateMs <= 0)) return 'on time';
    return isNum(e.lateMs) && e.lateMs > 0 ? 'late by ' + Math.max(1, Math.round(e.lateMs / 60000)) + ' min' : '';
  }

  // The food a safety entry is about: the batch's label, else the ingredient name, else nothing.
  function foodOf(state, e) {
    const b = (state.batches || []).find((x) => x && x.id === e.batchId);
    const ingId = e.ing || (b && b.ing);
    const ing = (state.ingredients || []).find((i) => i && i.id === ingId);
    const name = ing ? ing.name : ingId || '';
    return b && b.label ? b.label + (name && b.label.indexOf(name) < 0 ? ' (' + name + ')' : '') : name;
  }

  // The plain names of the food-safety settings an owner can change, by the last part of the setting's name.
  const SETTING_NAME = {
    hotHoldF: 'the hot-hold limit', coldHoldF: 'the cold limit', reheatF: 'the reheat temperature', tempCheckEveryMin: 'how often temperatures are checked',
    belowHotGraceH: 'the time allowed below the hot limit', aboveColdGraceH: 'the time allowed above the cold limit', sanitizeEveryH: 'how often surfaces are sanitized',
    hardCapH: 'the longest hold time', defaultMaxHoldH: 'the default hold time', stage1ToF: 'the first cooling target', stage1H: 'the first cooling time',
    totalH: 'the total cooling time', finalF: 'the final cooling target',
  };
  // A setting's value in plain words, by what its name ends with: degrees, hours or minutes; anything else as it is.
  function settingValue(key, v) {
    if (!isNum(v)) return v == null ? 'nothing' : String(v);
    if (/F$/.test(key)) return U.tempText(v);
    if (/Min$/.test(key)) return v + ' min';
    if (/H$/.test(key)) return v + (v === 1 ? ' hour' : ' hours');
    return String(v);
  }
  // The one plain line for a changed setting: "Changed the cold limit from 41 °F to 45 °F". Reads key, from and to (also old/new).
  function changeLine(e) {
    const key = String(e.key || e.setting || ''), last = key.split('.').pop();
    const from = e.from !== undefined ? e.from : e.old, to = e.to !== undefined ? e.to : e.new;
    return 'Changed ' + (SETTING_NAME[last] || (key || 'a setting')) + ' from ' + settingValue(last, from) + ' to ' + settingValue(last, to);
  }

  // Temperature readings grouped by batch, in log order, worked out once per state (the engine never changes a state in place), so a long
  // record does not replay the whole log for every cold reading row.
  const tempCache = new WeakMap();
  function tempsByBatch(state) {
    let m = tempCache.get(state);
    if (m) return m;
    m = new Map();
    for (const x of SB.engine.allEvents(state)) {
      if (!x || x.type !== 'temp_logged') continue;
      if (!m.has(x.batchId)) m.set(x.batchId, []);
      m.get(x.batchId).push(x);
    }
    tempCache.set(state, m);
    return m;
  }

  // For a cold-food reading: whether it was above the cold limit and how much time above the limit the batch has used up so far.
  // The engine adds up the time across separate stretches (an in-range reading does not wipe it), so this replays the batch's
  // readings in order the same way. Returns '' when the batch is not cold food or the limit is unknown.
  function coldNote(state, e) {
    const b = (state.batches || []).find((x) => x && x.id === e.batchId);
    const lim = state.settings && state.settings.safety ? state.settings.safety.coldHoldF : null;
    if (!b || b.kind !== 'cold' || !isNum(lim) || !isNum(e.f) || !SB.engine || !SB.engine.allEvents) return '';
    let since = null, used = 0;
    for (const x of tempsByBatch(state).get(e.batchId) || []) {
      if (x.reverted || !isNum(x.f) || !isNum(x.t) || x.t > e.t) continue;
      if (x.f > lim) { if (since == null) since = x.t; } else if (since != null) { used += x.t - since; since = null; }
      if (x === e || x.id === e.id) break;
    }
    const mins = Math.round(used / 60000);
    const above = e.f > lim;
    if (above) return 'above the cold limit' + (mins > 0 ? '; ' + mins + ' min above it earlier, which still counts' : '');
    return mins > 0 ? 'back in range; ' + mins + ' min above the cold limit so far, which still counts' : '';
  }

  // The detail words for one entry: what was read, weighed or thrown out.
  function detailOf(e) {
    switch (e.type) {
      case 'temp_logged': return (isNum(e.f) ? U.tempText(e.f) : '') + (lateWords(e) ? ', ' + lateWords(e) : '');
      case 'batch_reheat': return isNum(e.f) ? 'Reached ' + U.tempText(e.f) : '';
      case 'batch_discard': return (isNum(e.g) ? (O.weightText || U.weightText)(e.g) : '') + (REASON[e.reason] ? ', ' + REASON[e.reason].toLowerCase() : '') + (isNum(e.cost) && e.cost > 0 ? ', about ' + U.fmtMoney(e.cost, 2) : '') + (e.note ? ', ' + e.note : '');
      case 'safety_setting_changed': return changeLine(e);
      case 'month_closed': return 'Saved ' + (isNum(e.days) ? e.days + ' ' + (e.days === 1 ? 'day' : 'days') : 'old days') + ' before ' + (e.before ? U.fmtDateShort(e.before) : 'a set date') + ' to a backup and cleared them from this tablet' + (isNum(e.tickets) ? ' (' + e.tickets + ' tickets, ' + (isNum(e.orders) ? e.orders : 0) + ' orders)' : '');
      case 'equip_temp': return (UNIT[e.unit] || 'Equipment') + (e.label ? ' (' + e.label + ')' : '') + (isNum(e.f) ? ', ' + U.tempText(e.f) : '') + (e.outOfRange && isNum(e.maxF) ? ', above ' + U.tempText(e.maxF) : '');
      case 'thermometer_checked': return (isNum(e.f) ? 'Read ' + U.tempText(e.f) : '') + (METHOD[e.method] ? ' in ' + METHOD[e.method] : '') + (e.outOfRange && isNum(e.expectF) ? ', should read ' + U.tempText(e.expectF) : '');
      case 'batch_out': case 'batch_back': return isNum(e.outMs) ? spanWords(e.outMs) + ' out of the fridge so far' : '';
      case 'cooling_started': return isNum(e.g) ? (O.weightText || U.weightText)(e.g) : '';
      case 'sanitize_done': return [lateWords(e), isNum(e.ppm) ? 'strip ' + e.ppm + ' ppm' : '', e.product || '', e.where ? 'at ' + e.where : ''].filter(Boolean).join(', ');
      case 'quality_extend': return isNum(e.until) ? 'Until ' + U.fmtTime(e.until) : '';
      default: return e.note || '';
    }
  }

  // How long a span is, in plain words: "45 min" under two hours, else "2.5 h".
  function spanWords(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    return min < 120 ? min + ' min' : Math.round(min / 6) / 10 + ' h';
  }

  // The plain facts about the batch an entry is about: when it was made, days since for cold food, and for cooling
  // the readings so far against the owner's own cooling limits. Words only, never a rule; empty when the batch is gone.
  function factsOf(state, e) {
    const b = (state.batches || []).find((x) => x && x.id === e.batchId);
    if (!b || !isNum(b.enteredAt)) return [];
    const out = [];
    const made = isNum(b.coolStartAt) ? b.coolStartAt : b.enteredAt;
    const S = (state.settings || {}).safety || {};
    if (b.kind === 'cooling') {
      out.push('Cooling began ' + U.fmtDateShort(U.dateKey(made)) + ' ' + U.fmtTime(made));
      if (e.type === 'temp_logged' && isNum(e.t) && isNum(b.stage1At) && e.t === b.stage1At) out.push('First cooling mark reached');
      if (e.type === 'temp_logged' && isNum(e.t) && isNum(b.finalAt) && e.t === b.finalAt) out.push('Final cooling mark reached');
      if (isNum(e.t) && e.type === 'temp_logged' && e.t >= made) out.push(spanWords(e.t - made) + ' into cooling');
      const c = S.cooling || {};
      if (isNum(c.stage1ToF) && isNum(c.stage1H) && isNum(c.finalF) && isNum(c.totalH)) out.push('Your limit: ' + U.tempText(c.stage1ToF) + ' within ' + c.stage1H + ' h, ' + U.tempText(c.finalF) + ' within ' + c.totalH + ' h');
      if (e.type === 'cooling_started') return out.concat(readingsOf(b, made));
      return out;
    }
    out.push(b.fridge && b.madeOn ? 'Made ' + madeWords(b.madeOn) : 'Made ' + U.fmtDateShort(U.dateKey(b.enteredAt)) + ' ' + U.fmtTime(b.enteredAt));
    if (b.fridge) {
      if (isNum(b.fridgeDays) && b.madeOn) out.push('Your fridge limit: ' + b.fridgeDays + ' ' + U.plural(b.fridgeDays, 'day', 'days') + ', last day ' + madeWords(U.addDays(b.madeOn, b.fridgeDays - 1)));
      const ci = isNum(e.t) && SB.engine && SB.engine.coldInfo ? SB.engine.coldInfo(b, e.t) : null;
      const outMs = isNum(e.outMs) ? e.outMs : ci ? ci.outMs : isNum(b.lineMs) ? b.lineMs : null;
      if (isNum(outMs)) out.push('Out of the fridge so far: ' + spanWords(outMs) + (isNum(b.outHours) ? ' (your limit ' + b.outHours + ' h)' : ''));
      return out;
    }
    if (b.kind === 'cold' && isNum(e.t) && e.t >= b.enteredAt) {
      const days = Math.floor((e.t - b.enteredAt) / 86400e3);
      out.push(days + ' ' + U.plural(days, 'day', 'days') + ' in the fridge');
    }
    if (isNum(b.maxHoldH) && (e.type === 'batch_discard' || e.type === 'quality_extend')) out.push('Your limit: ' + U.plural(b.maxHoldH, b.maxHoldH + ' hour', b.maxHoldH + ' hours'));
    return out;
  }

  // A made-on day key as short words, like "Sat 10/17".
  function madeWords(key) { return U.fmtDateShort(key); }

  // The cooling readings of a batch as short words, oldest first, at most six.
  function readingsOf(b, from) {
    const t = (b.temps || []).filter((r) => r && isNum(r.t) && isNum(r.f)).slice(0, 6);
    return t.length ? ['Readings: ' + t.map((r) => U.fmtTime(r.t) + ' ' + U.tempText(r.f) + ' (' + spanWords(r.t - from) + ')').join(', ')] : [];
  }

  // Safety log rows from `from` up to (not including) `to`, oldest first:
  // [{id, at, kind, food, detail, who, corrections:[{at, who, note}]}]. Read only; never changes the state.
  function inspectorRows(state, from, to) {
    if (!state || !SB.engine || !SB.engine.safetyLog) return [];
    const rows = SB.engine.safetyLog(state).filter((r) => r.event.type !== 'safety_correction' && isNum(r.event.t) && r.event.t >= from && r.event.t < to);
    return rows.map((r) => ({
      id: r.event.id, at: r.event.t, kind: KIND[r.event.type] || 'Safety entry', food: foodOf(state, r.event), detail: [detailOf(r.event), r.event.type === 'temp_logged' ? coldNote(state, r.event) : ''].filter(Boolean).join(', '), facts: factsOf(state, r.event), who: r.event.who || '',
      corrections: r.corrections.map((c) => ({ at: c.t, who: c.who || '', note: c.note || '' })),
    }));
  }

  // The preset date ranges for the printed record: [{id, label, days}].
  const RANGES = [{ id: 'today', label: 'Today', days: 1 }, { id: '7', label: 'Last 7 days', days: 7 }, { id: '30', label: 'Last 30 days', days: 30 }, { id: '90', label: 'Last 90 days', days: 90 }];
  // The service-day window for a preset, ending after today: {from, to, label}.
  function rangeFor(id, now, dayStartHour) {
    const r = RANGES.find((x) => x.id === id) || RANGES[1];
    const today = U.serviceDate(now, dayStartHour);
    const first = U.addDays(today, -(r.days - 1)), next = U.addDays(today, 1);
    // The moment a service day starts on the wall clock (the day-start hour that morning), even on a daylight-saving day.
    const at = (key) => { const p = key.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], dayStartHour, 0, 0, 0).getTime(); };
    return { from: at(first), to: at(next), label: r.days === 1 ? U.fmtDateShort(today) : U.fmtDateShort(first) + ' to ' + U.fmtDateShort(today) };
  }

  // One row for one safety entry (the same shape inspectorRows gives), for tests and for entries read without the engine's log.
  function rowFor(e, state) { return { id: e.id, at: e.t, kind: KIND[e.type] || 'Safety entry', food: foodOf(state, e), detail: [detailOf(e), e.type === 'temp_logged' ? coldNote(state, e) : ''].filter(Boolean).join(', '), facts: factsOf(state, e), who: e.who || '', corrections: [] }; }

  O.inspectorPure = { inspectorRows, rowFor, factsOf, rangeFor, RANGES };
  if (!g.document) return; // Node: the pure rows are all the tests need

  // ---- 2. The sheet and printing ----
  const h = U.h;

  // Reads the saved state, or null when the store is not ready.
  function stateNow() { try { return SB.store.getState(); } catch (e) { return null; } }

  // Builds the printable table for a window as an element (used for both the preview and the print block).
  function recordTable(rows) {
    const body = rows.map((r) => h('tr', null,
      h('td', null, U.fmtDateShort(U.dateKey(r.at)) + ' ' + U.fmtTime(r.at)), h('td', null, r.kind), h('td', null, r.food), h('td', null, r.detail, (r.facts || []).map((f) => h('div', { class: 'si-fact' }, f))), h('td', null, r.who || 'not recorded'),
      h('td', null, r.corrections.map((c) => h('div', { class: 'si-corr' }, 'Correction ' + U.fmtDateShort(U.dateKey(c.at)) + ' ' + U.fmtTime(c.at) + (c.who ? ' by ' + c.who : '') + ': ' + c.note)))));
    return h('table', { class: 'si-table' },
      h('caption', { class: 'visually-hidden' }, 'Food safety entries, oldest first'),
      h('thead', null, h('tr', null, ['When', 'What', 'Food', 'Detail', 'Logged by', 'Corrections added later'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, body.length ? body : h('tr', null, h('td', { colspan: 6 }, 'No safety entries in this range.'))));
  }

  // The honest line about what this record does not hold, so nobody reads it as the whole paperwork.
  // What this record leaves out and how long it keeps things; the keep time is the engine's own number (37-retention.js).
  const keepWords = () => (SB.retention ? ' ' + SB.retention.words() : '');
  const NOT_COVERED = 'Cooler, freezer, thermometer-check and sanitizer strip entries appear here only if someone logged them in Smokebox; keep anything else on your own sheet and ask your health department what to keep and for how long.';

  // Opens the sheet: pick a date range, see the record, print it.
  function openInspectorLog() {
    if (!SB.ui || !SB.ui.sheet || !stateNow()) return null;
    const sheet = SB.ui.sheet({ title: 'Print the food safety record', side: 'right', width: 'min(860px, 96vw)', name: 'inspectorlog' });
    const dsh = (stateNow().settings.service || {}).dayStartHour;
    let rangeId = '7';
    const preview = h('div', { class: 'si-preview' });
    const sel = h('select', { class: 'select', 'aria-label': 'Date range' }, RANGES.map((r) => h('option', { value: r.id, selected: r.id === rangeId }, r.label)));
    // Redraws the preview table for the chosen range.
    function paint() {
      const w = rangeFor(rangeId, SB.store.now(), dsh);
      const rows = inspectorRows(stateNow(), w.from, w.to);
      U.clear(preview);
      preview.append(h('p', { class: 'si-count' }, rows.length + ' ' + U.plural(rows.length, 'entry', 'entries') + ', ' + w.label + '.'), recordTable(rows));
    }
    // Picks a new range from the select and redraws.
    sel.addEventListener('change', () => { rangeId = sel.value; paint(); });
    // Prints the record for the chosen range.
    const doPrint = () => printRecord(rangeId);
    sheet.body.append(
      h('p', { class: 'si-lead' }, 'This is your own record of readings, reheats, cooling, sanitize rounds and thrown-out food. It is not an inspection result. Entries are never edited; if something was wrong, a correction is added under it.'),
      h('p', { class: 'si-lead si-notcovered' }, NOT_COVERED + keepWords()),
      h('div', { class: 'si-actions' }, h('label', null, 'Range ', sel), h('button', { type: 'button', class: 'btn btn-primary', onClick: doPrint }, 'Print')), preview);
    paint();
    return sheet;
  }

  // Builds the print-only record, prints it, and removes it again.
  function printRecord(id) {
    const s = stateNow(); if (!s) return;
    const dsh = (s.settings.service || {}).dayStartHour;
    const w = rangeFor(id, SB.store.now(), dsh);
    const rows = inspectorRows(s, w.from, w.to);
    const demo = (s.tickets || []).some((t) => t && t.src === 'demo');
    const root = h('div', { class: 'sb-printroot si-printroot' },
      h('h1', null, 'Food safety record, ' + w.label),
      h('p', { class: 'si-note' }, 'The owner\'s own record of what was logged in this kitchen. It is not an inspection result. Entries are never edited; corrections are added under the entry they correct.'),
      demo ? h('p', { class: 'si-note' }, 'This is a demo kitchen, so these entries are demo entries.') : null,
      recordTable(rows),
      h('p', { class: 'si-note' }, NOT_COVERED + keepWords()),
      h('p', { class: 'si-note' }, 'Printed ' + U.fmtDateShort(U.dateKey(Date.now())) + ' ' + U.fmtTime(Date.now()) + '. Reviewed by: ______________   Date: ________'));
    document.body.appendChild(root);
    // Removes the print-only block once the print dialog is done (or at once when printing is unavailable).
    const done = () => { try { root.remove(); } catch (e) { /* already gone */ } };
    g.addEventListener('afterprint', done, { once: true });
    try { g.print(); } catch (e) { done(); }
    setTimeout(done, 60000);
  }

  // ---- 3. The Safety page bar ----

  // A small bar for the top of the Safety page: the print button and the Guide "?" link.
  O.safetyLogBar = function () {
    const help = SB.guide && SB.guide.link ? SB.guide.link('hold-cabinet-and-warnings', 'the safety page') : null;
    return h('div', { class: 'si-bar' }, h('span', { class: 'si-bar-t' }, 'Your safety record'),
      h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'print-safety-log', onClick: openInspectorLog }, 'Print the safety record'), help);
  };
  O.openInspectorLog = openInspectorLog;
})(typeof globalThis !== 'undefined' ? globalThis : window);
