/*
 * WHAT THIS FILE IS: The back office page "Menu, prices and shop": edit the menu, ingredients, ticket time limits,
 *   pacing, food-safety limits, the PIN and display choices; back up, import or reset the data. Every edit goes
 *   through the engine, which can refuse it; the refusal shows beside the field and the old value stays.
 * PARTS: helpers, number field, nine panels (menu to about), then the page itself and its contents list.
 * USES: util, config, engine, store, shell, office core (00 to 80).   USED BY: the office frame.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const doc = g.document;
  if (!doc || !U || typeof U.h !== 'function') return; // Node (logic tests): nothing to build
  const h = U.h;
  const C = SB.config;

  const SAVE_DELAY = 600;           // ms after the last change before a field is written (longer than the stepper's 500 ms hold-repeat gap)
  const MAX_IMPORT_CHARS = 20e6;    // same ceiling as SB.store.importAll
  // Said with the undo copy when the browser was short on space and it keeps only recent tickets.
  const TRIMMED_WORDS = 'This browser was short on space, so the copy keeps only your most recent tickets. Your menu, settings, PIN and food safety records are all in it.';

  // Builds the always-visible "Saved history" card of the Data page: a plain meter of how full the saved history is, a calm amber note with a
  // button into Close the month from 70 percent, the sentence about history already dropped, and the browser-may-delete line. Reads the store's
  // historyFill(); a store without it draws nothing.
  function historyCard() {
    const BP = SB.office && SB.office.backupPure;
    const el = U.h('section', { class: 'od-fcard od-hist', 'aria-label': 'Saved history' });
    const bar = U.h('span', { class: 'od-hist-bar' }), track = U.h('div', { class: 'od-hist-track', 'aria-hidden': 'true' }, bar);
    const meter = U.h('p', { class: 'od-p od-hist-meter', role: 'status' }), alert = U.h('p', { class: 'od-p od-hist-alert', hidden: true });
    const dropped = U.h('p', { class: 'od-hint od-hist-dropped', hidden: true }), safari = U.h('p', { class: 'od-hint od-hist-safari', hidden: true });
    const go = U.h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'history-close-month', hidden: true }, 'Close the month...');
    go.addEventListener('click', () => { try { if (SB.setup && typeof SB.setup.openCloseMonth === 'function') SB.setup.openCloseMonth(); } catch (e) { /* the flow shows its own refusals */ } });
    el.append(U.h('h3', { class: 'od-fh' }, U.h('span', null, 'Saved history')), track, meter, alert, U.h('div', { class: 'od-actions' }, go), dropped, safari);
    // Redraws the card from the store.
    function paint() {
      const st = SB.store.getState(), fill = SB.store.historyFill ? SB.store.historyFill() : null;
      const v = BP.historyView(fill, st, SB.store.now());
      el.hidden = !fill;
      if (!fill) return;
      el.dataset.tone = v.level === 'ok' ? '' : 'warn'; el.dataset.level = v.level;
      bar.style.width = (v.pct === null ? 0 : v.pct) + '%';
      track.setAttribute('data-pct', String(v.pct === null ? '' : v.pct));
      meter.textContent = v.meter || 'Saved history size is not known on this device.';
      alert.textContent = v.alert; alert.hidden = !v.alert; go.hidden = !v.alert;
      const ts = fill.trimmedSince && typeof fill.trimmedSince === 'object' ? fill.trimmedSince.droppedBefore : '';
      let ds = null; try { ds = SB.store.dataset({ sample: false }); } catch (e) { ds = null; }
      const dday = (ds && ds.droppedBefore) || ts || '';
      const dw = BP.droppedWords(dday); dropped.textContent = dw; dropped.hidden = !dw;
      safari.textContent = v.safari; safari.hidden = !v.safari;
    }
    paint();
    // Keeps the card in step with the store, redrawing only when the tickets, events or day changed.
    let seen = '';
    function sync(st) { const k = st.tickets.length + '|' + (st.events || []).length + '|' + (st.archivedBefore || '') + '|' + (st.droppedBefore || '') + '|' + U.serviceDate(SB.store.now(), (st.settings.service || {}).dayStartHour); if (k !== seen) { seen = k; try { paint(); } catch (e) { /* the rest of the page still draws */ } } }
    return { el, sync };
  }

  // Builds the "Close the month" card for the Data page: one plain paragraph on what it does, the numbers from the store's own preview,
  // and a Start button that opens the guarded confirm flow (SB.setup.openCloseMonth). Nothing here changes any data.
  function closeMonthCard(flowCard) {
    const card = flowCard('4', 'Close the month', null, null);
    const keep = (SB.engine && SB.engine.MONTH_KEEP_DAYS) || 35;
    const sum = U.h('p', { class: 'od-p od-cm-sum', role: 'status' }), notes = U.h('p', { class: 'od-hint od-cm-keep' });
    const start = U.h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'close-month' }, 'Close the month...');
    const hint = U.h('p', { class: 'od-hint od-cm-hint', hidden: true });
    // The day the preview counts back from: the first of this month (the same default as the guarded flow); the store still keeps the last days.
    const opts = () => ({ before: U.serviceDate(SB.store.now(), (SB.store.getState().settings.service || {}).dayStartHour).slice(0, 8) + '01' });
    // Why some old days are not offered: sales after the day's last close (the store lists them in lateSaleDays) or no close at all.
    function skipped(p) {
      const late = (p.lateSaleDays || []).length, never = (p.uncoveredDays || []).length - late, out = [];
      if (late > 0) out.push(late + ' ' + (late === 1 ? 'day was' : 'days were') + ' not cleared: ' + (late === 1 ? 'it has' : 'they have') + ' sales after the last end-of-day close');
      if (never > 0) out.push(never + ' ' + (never === 1 ? 'day has' : 'days have') + ' no end-of-day close, so ' + (never === 1 ? 'it was' : 'they were') + ' kept');
      return out.join('. ') + (out.length ? '.' : '');
    }
    // Asks the store what Close the month would clear now and writes it in plain words (nothing changes).
    function paint() {
      try { paintNow(); } catch (e) { start.disabled = true; sum.textContent = 'The preview is not available right now. Nothing was changed.'; notes.textContent = ''; }
    }
    // Does the work of paint; paint wraps it so this card can never stop the rest of the Data page from drawing.
    function paintNow() {
      const r = SB.store.closeMonthPreview(opts());
      start.disabled = false; hint.hidden = true;
      if (!r.ok || !r.preview || !r.preview.days || !r.preview.days.length || !r.preview.from) {
        start.disabled = true;
        sum.textContent = r.report === 'nothingToDo' || r.ok ? 'Nothing is old enough to clear yet: the last ' + keep + ' days, today and any open order always stay on this tablet.' : 'The preview is not available right now. Nothing was changed.';
        notes.textContent = ''; return;
      }
      const p = r.preview;
      // A count with its unit word, such as "3 days" or "1 order".
      const n = (k, one, many) => U.fmtNum(k) + ' ' + U.plural(k, one, many || one + 's');
      sum.textContent = 'Ready to save and clear ' + n(p.days.length, 'day') + ' (' + U.fmtDateShort(p.from) + ' to ' + U.fmtDateShort(U.addDays(p.before, -1)) + '): ' + n(p.tickets, 'ticket') + ', ' + n(p.orders, 'order') + ' and ' + n(p.events, 'activity record') + '. Those orders took in ' + U.fmtMoney(p.paidTotal) + '.';
      notes.textContent = 'Stays on this tablet: ' + n(p.safetyEventsKept, 'safety record') + ', ' + n(p.dayRecordsKept, 'end-of-day total') + (p.openOrdersKept ? ', ' + n(p.openOrdersKept, 'open order') : '') + (skipped(p) ? '. ' + skipped(p) : '.');
    }
    start.addEventListener('click', async () => {
      if (!SB.setup || typeof SB.setup.openCloseMonth !== 'function') { hint.textContent = 'The step-by-step Close the month is not available in this build. Nothing was changed.'; hint.hidden = false; return; }
      try { await SB.setup.openCloseMonth(opts()); } catch (e) { hint.textContent = 'Close the month could not be started. Nothing was changed.'; hint.hidden = false; }
      paint();
    });
    card.body.append(
      U.h('p', { class: 'od-p' }, 'Close the month saves a complete backup and spreadsheet files of your old, closed days, then clears those days\' tickets, orders and plain activity from this tablet so it stays quick. End-of-day totals, the safety record and open orders stay. Nothing is cleared until you confirm the files are saved, and the whole kitchen can be put back from the backup.'),
      sum, notes, U.h('div', { class: 'od-actions' }, start), hint);
    paint();
    // Keeps the preview in step with the store, redrawing only when the orders, the cleared-days mark or the day changed (the plan is not cheap).
    let seen = '';
    function sync(st) { const k = st.orders.length + '|' + (st.archivedBefore || '') + '|' + U.serviceDate(SB.store.now(), (st.settings.service || {}).dayStartHour); if (k !== seen) { seen = k; paint(); } }
    return { el: card.el, sync };
  }
  const VERSION = 'Smokebox KDS ' + (C && C.version ? 'v' + C.version : '');

  // Small helpers
  // Real finite numbers only, and an icon builder that never throws.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const ico = (name, size) => { try { return SB.icons.svg(name, { size: size || 18 }); } catch (e) { return doc.createElement('span'); } };
  // The current state (null if the store is not ready), and a time in plain words (5 min, 2 min 5 s, 45 s).
  const cur = () => { try { return SB.store.getState(); } catch (e) { return null; } };
  const mmss = (sec) => { const s = Math.max(0, Math.round(sec)), m = Math.floor(s / 60), r = s % 60; return m && r ? m + ' min ' + r + ' s' : m ? m + ' min' : r + ' s'; };
  // A trimmed number for display, and how many decimals a step has.
  const num = (n, d) => (isNum(n) ? String(+n.toFixed(d == null ? 2 : d)) : '-');
  const decs = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
  // A readable size for stored text, and an hour written as clock text.
  const kbText = (chars) => (chars < 1024 ? chars + ' bytes' : chars < 1048576 ? Math.round(chars / 1024) + ' KB' : (chars / 1048576).toFixed(1) + ' MB');
  const hourWords = (hr) => U.fmtHour(hr) + (hr >= 24 ? ' (next day)' : '');
  // Lowercases the first letter, and today's real date for file names.
  const lower1 = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  // Tells the shell a backup was just saved, so the close-of-service nudge stays quiet tonight.
  const noteBackup = () => { try { if (SB.shell && SB.shell.noteBackup) SB.shell.noteBackup(); } catch (e) { /* the nudge is optional */ } };
  const todayKey = () => U.dateKey(Date.now()); // real calendar date for file names (the demo clock may run ahead)
  // Reads a dotted path from an object, and builds a nested patch from one.
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const patchFor = (path, v) => { const ks = path.split('.'); const root = {}; let c = root; ks.forEach((k, i) => { if (i === ks.length - 1) c[k] = v; else c = c[k] = {}; }); return root; };
  // The unit word for an ingredient, and an amount written with that unit.
  const unitWord = (ing) => (ing && ing.unit === 'ea' ? 'pieces' : 'g');
  const amountText = (ing, v) => (ing && ing.unit === 'ea' ? num(v, 1) + ' ' + U.plural(v, 'piece') : ((SB.office && SB.office.weightText) || U.weightText)(v));
  // Dollars with cents, as shown in field messages.
  const money = (v) => U.fmtMoney(v, 2);
  // The currency symbol the shared formatter prints ($ unless another one was chosen).
  const curSymbol = () => { try { return (U.currencySymbol && U.currencySymbol()) || '$'; } catch (e) { return '$'; } };
  // An ingredient note from the config may quote a price per pound; show kilograms instead (this app never
  // shows pounds).
  function kgNote(t) {
    const out = String(t).replace(/\$(\d+(?:\.\d+)?)\/lb\b/g, (m, v) => '$' + (v * 2.20462).toFixed(2) + '/kg');
    return out.replace(/, about (\$\d+(?:\.\d+)?\/kg)/, (m, f) => (out.indexOf(f) < out.indexOf(m) ? '' : m)); // do not say the same price twice
  }

  /** Send a user edit to the engine. Returns {report, info, events}; never throws. */
  function send(type, payload) {
    try { return SB.store.dispatchEx(type, payload, { source: 'ui' }); }
    catch (e) { return { report: 'badPatch', info: { internalError: String(e) }, events: [] }; }
  }
  // True when the engine accepted the action, or had nothing to change.
  const good = (r) => r.report === 'ok' || r.report === 'nothingToDo';

  // Field meta and refusal wording. A meta describes one editable value for the words around it:
  // {name, unit, toUi(raw) -> shown, words(info, r)?, legalNote?, text?}
  const META = {};
  function showVal(m, raw) {
    if (m && typeof m.fmt === 'function') return m.fmt(raw);
    const u = m && m.toUi ? m.toUi(raw) : raw;
    const one = u === 1 && (m.unit === 'hours' || m.unit === 'timings'); // 1 hour, not 1 hours
    const unit = m && m.unit ? (m.unit === '%' || m.unit === '\u00d7' ? m.unit : ' ' + (one ? m.unit.replace(/s$/, '') : m.unit)) : '';
    return num(u, 2) + unit;
  }
  // One sentence for a refused edit: what is wrong and what is allowed. `m` is the meta of the field touched.
  function refusal(r, m) {
    const info = r.info || {};
    const words = (cur() || {}).settings;
    if (r.report === 'outOfBounds') {
      if (m && typeof m.words === 'function') { const w = m.words(info, r); if (w) return w; } // the touched field knows its cross-field wording
      const mk = (info.key && META[info.key]) || m || null; // otherwise describe the field the engine named, with its own limits
      if (mk && isNum(info.min) && isNum(info.max)) {
        if (mk.text) return mk.name + ' has to be ' + info.min + ' to ' + info.max + ' characters.';
        return mk.name + ' has to be between ' + showVal(mk, info.min) + ' and ' + showVal(mk, info.max) + '.' + (mk.legalNote ? ' ' + mk.legalNote : '');
      }
    }
    if (r.report === 'badPatch' && m) return m.name + ' needs a valid value. ' + SB.engine.describe('badPatch', info, words);
    return SB.engine.describe(r.report, info, words);
  }

  // Row status line: "Saved. ..." for a few seconds, then a quiet "Saved". Errors stay until the next edit.
  function statusLine() {
    const el = h('div', { class: 'od-st', role: 'status' });
    let t = 0;
    // Paints the status line in one tone, with its icon and text.
    const set = (tone, text) => { el.dataset.tone = tone; el.replaceChildren(ico(tone === 'bad' ? 'alert-circle' : 'check-circle', 16), h('span', null, text)); };
    return {
      el,
      // Shows a saved message, then settles to a quiet Saved after six seconds.
      ok(text) { clearTimeout(t); set('ok', text || 'Saved.'); t = setTimeout(() => { if (el.dataset.tone === 'ok') set('ok', 'Saved'); }, 6000); },
      // Shows an error that stays until the next edit.
      bad(text) { clearTimeout(t); set('bad', text); },
      // Empties the status line and stops its timer.
      clear() { clearTimeout(t); delete el.dataset.tone; el.replaceChildren(); },
      // Stops the pending timer when the page closes.
      destroy() { clearTimeout(t); },
    };
  }

  // A labelled number field built on SB.ui.stepper. Changes are saved through o.save(v), which returns {ok,
  // text}. Options: label, value, min, max, step, big, unit, meta (words for refusals), save, onSaved, read,
  // hint, and toUi / fromUi when the field shows a different scale than the engine stores. Returns {el,
  // input, stepper, sync, flush, setError, destroy}.
  function numField(o) {
    const toUi = o.toUi || ((v) => v), fromUi = o.fromUi || ((u) => u);
    const step = o.step || 1;
    const big = o.big && o.big > step && o.max - o.min > o.big * 4 ? o.big : 0;
    const d = Math.max(decs(step), big ? decs(big) : 0, decs(o.min));
    let committed = o.value;
    let timer = 0, pending = null;
    const stepper = SB.ui.stepper({
      value: toUi(committed), min: o.min, max: o.max, step, bigStep: big || undefined, unit: o.unit, label: o.aria || o.label,
      // Remembers the new value and saves it after a short pause (SAVE_DELAY).
      onChange: (u) => { pending = u; paintRead(u); clearErr(); if (o.onInput) o.onInput(u); clearTimeout(timer); timer = setTimeout(flush, SAVE_DELAY); },
    });
    const input = stepper.input;
    input.id = U.uid('odn');
    const minCh = 3 + (d ? d + 1 : 0); // short numbers keep a steady box; long ones grow so no digit is clipped
    // A long value plus long big-step labels (such as +1000) leaves no room on a phone, so the big buttons
    // hide (CSS) while that holds.
    const bigLen = big ? String(big).length + 1 : 0;
    const fit = () => { input.style.width = (Math.max(minCh, input.value.length) + 0.8) + 'ch'; el.classList.toggle('od-nf-wide', big > 0 && input.value.length + bigLen >= 10); };
    input.addEventListener('input', fit);
    const lab = h('label', { class: 'od-lab' + (o.hideLabel ? ' visually-hidden' : ''), for: input.id }, o.label);
    const read = h('span', { class: 'od-read' });
    const err = h('div', { class: 'od-ferr', role: 'alert', hidden: true, id: input.id + '-err' });
    const hint = o.hint ? h('div', { class: 'od-hint', id: input.id + '-hint' }, o.hint) : null;
    const el = h('div', { class: 'od-nf' + (o.cls ? ' ' + o.cls : '') }, lab, h('div', { class: 'od-nf-row' }, stepper, read), hint, err);
    if (hint) input.setAttribute('aria-describedby', hint.id);

    // Updates the small reading beside the stepper, such as 1:30 for 90 seconds.
    function paintRead(u) { fit(); read.textContent = o.read ? o.read(u == null ? stepper.getValue() : u) : ''; }
    // Hides the error text and clears the error marks on the input.
    function clearErr() { err.hidden = true; err.replaceChildren(); input.removeAttribute('aria-invalid'); if (hint) input.setAttribute('aria-describedby', hint.id); else input.removeAttribute('aria-describedby'); }
    // Shows an error under the field and marks the input as invalid for screen readers.
    function setError(text) {
      err.replaceChildren(ico('alert-circle', 16), h('span', null, text));
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', (hint ? hint.id + ' ' : '') + err.id);
    }
    // The sentence ending that says which value was kept after a refusal.
    const keptWords = () => ' Kept ' + showVal(o.meta, committed) + '.';
    // Puts the last saved value back into the stepper after a refusal.
    function revert() { stepper.setValue(toUi(committed), { silent: true }); paintRead(); if (o.onInput) o.onInput(toUi(committed)); }
    // Tries to save a value. On a refusal the old value comes back and the reason shows. Returns true when
    // saved.
    function attempt(v) {
      const res = o.save(v);
      if (res.ok) { committed = v; clearErr(); if (o.onSaved) o.onSaved(res.text); }
      else { revert(); setError(res.text + keptWords()); }
      return res.ok;
    }
    // Saves any waiting change now instead of after the pause.
    function flush() {
      clearTimeout(timer); timer = 0;
      if (pending == null) return;
      const u = pending; pending = null;
      attempt(fromUi(u));
    }
    // A typed value outside the range would be silently clamped by the stepper. Route it to the engine
    // instead: the engine refuses it with the key, the refusal is counted as friction, and the field keeps
    // its old value. Garbage (not a number) is never sent.
    const parseTyped = () => { const s = input.value.trim().replace(',', '.'); return !s || /[eE]|infinity|nan/i.test(s) || !/^-?\d*\.?\d*$/.test(s) ? NaN : parseFloat(s); };
    const intercept = (ev) => {
      const v = parseTyped();
      if (Number.isNaN(v)) {
        ev.stopImmediatePropagation(); clearTimeout(timer); pending = null;
        stepper.setValue(toUi(committed), { silent: true }); paintRead();
        setError('That is not a number. Type digits only.' + keptWords());
        return;
      }
      if (v < o.min - 1e-9 || v > o.max + 1e-9) {
        ev.stopImmediatePropagation(); clearTimeout(timer); pending = null;
        const ok = attempt(fromUi(v));
        if (ok) stepper.setValue(toUi(committed), { silent: true });
        paintRead();
      }
    };
    input.addEventListener('change', intercept, true);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') intercept(ev); }, true);
    // A value that was typed (then confirmed with Enter or by leaving the box) is saved at once; only the +
    // and - buttons wait, so holding one writes once.
    input.addEventListener('change', () => flush());
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') flush(); });
    paintRead();
    return {
      // The handle the page uses to sync, save or remove this field.
      el, input, stepper, setError, flush, committed: () => committed,
      sync(v) {
        committed = v;
        if (pending != null || stepper.contains(doc.activeElement)) return; // never overwrite a half-typed or focused field
        const u = toUi(v);
        stepper.setValue(u, { silent: true });
        paintRead();
      },
      // Saves anything waiting, then removes the stepper.
      destroy() { flush(); stepper.destroy(); },
    };
  }

  /** Save helper for settings fields: updateSettings with a nested patch built from a dotted path. */
  function saveSetting(path, value, okText, meta) {
    const r = send('updateSettings', { patch: patchFor(path, value) });
    return good(r) ? { ok: true, text: okText } : { ok: false, text: refusal(r, meta || META[path]) };
  }

  // Panels. The sticky table of contents links to them; each panel is a section with a focusable heading.
  const SECTIONS = [
    { id: 'menu', label: 'Menu', title: 'Dishes and prices', group: 'Shop' },
    { id: 'ingredients', label: 'Ingredients', title: 'Ingredients', group: 'Kitchen' },
    { id: 'times', label: 'Time limits', title: 'Ticket time limits by channel', group: 'Kitchen' },
    { id: 'pacing', label: 'Finish together', title: 'Finish together', group: 'Advanced' },
    { id: 'safety', label: 'Food safety', title: 'Food safety limits', group: 'Safety' },
    { id: 'pin', label: 'PIN', title: 'Manager PIN', group: 'Shop' },
    { id: 'look', label: 'Appearance', title: 'Appearance and service hours', group: 'Shop' },
    { id: 'data', label: 'Data', title: 'Data, backup and reset', group: 'Devices' },
    { id: 'about', label: 'About', title: 'About this build', group: 'Devices' },
  ];
  // One panel: a section with a focusable heading and an empty body. Returns {el, body, title, def}.
  function panel(def, intro) {
    const hid = 'od-h-' + def.id;
    const title = h('h2', { class: 'od-title', id: hid, tabindex: -1 }, def.title);
    const body = h('div', { class: 'od-body' });
    const el = h('section', { class: 'od-panel', id: 'od-' + def.id, 'aria-labelledby': hid }, h('header', { class: 'od-head' }, title), body);
    if (intro) body.appendChild(h('p', { class: 'od-intro' }, intro));
    return { el, body, title, def };
  }
  // Small builders for a sub-heading and a paragraph.
  const sub = (text, id) => h('h3', { class: 'od-sub', id }, text);
  // The small round "?" that opens one Guide page, or nothing when the Guide did not load.
  const helpLink = (page, label) => { try { return SB.guide && SB.guide.link ? SB.guide.link(page, label) : null; } catch (e) { return null; } };
  const para = (text, cls) => h('p', { class: cls || 'od-p' }, text);
  // Builders for a quiet hint line and for a button with an optional icon.
  const hintLine = (text) => h('p', { class: 'od-hint' }, text);
  const btn = (label, o) => {
    o = o || {};
    const b = h('button', { type: 'button', class: 'btn' + (o.cls ? ' ' + o.cls : '') });
    if (o.icon) b.appendChild(ico(o.icon, o.size || 18));
    b.appendChild(h('span', null, label));
    if (o.onClick) b.addEventListener('click', o.onClick);
    if (o.aria) b.setAttribute('aria-label', o.aria);
    return b;
  };
  // A small status chip with an optional icon.
  const chip = (label, tone, icon) => SB.ui.chip({ label, tone, icon });

  // 1. Dishes and what goes in them
  const BOM_META = { name: 'The amount per portion', unit: 'g', words: () => 'The amount per portion has to be more than 0 and at most 100,000.' };

  // The editable ingredient lines of one menu item: add, change or remove, each saved at once. Returns {el,
  // sync, destroy}.
  function bomBlock(id, itemName, getMi, status) {
    const root = h('div', { class: 'od-bom' });
    const headId = U.uid('odbh');
    const head = h('div', { class: 'od-lab', id: headId }, 'Ingredients for one portion');
    const list = h('ul', { class: 'od-bom-list', 'aria-labelledby': headId });
    const addBtn = btn('Add ingredient', { icon: 'plus', cls: 'btn-sm' });
    const note = h('p', { class: 'od-hint' });
    root.append(head, list, h('div', { class: 'od-bom-actions' }, addBtn), note);
    let lines = [], rendered = null, stale = false, focusIng = null, focusAdd = false;
    // Reads the item's current bill of materials, and indexes ingredients by id.
    const bomNow = () => getMi().bom.map((l) => ({ ing: l.ing, qty: l.qty }));
    const ingMap = (s) => { const m = {}; for (const i of s.ingredients) m[i.id] = i; return m; };
    // True while someone is typing in this list, so a redraw has to wait.
    const typing = () => { const a = doc.activeElement; return !!(a && list.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')); };

    // Redraws every line of this bill from the state. Never runs while a line field is focused.
    function build(mi, s) {
      lines.forEach((l) => l.field.destroy());
      list.replaceChildren(); lines = [];
      const ings = ingMap(s);
      const used = new Set(mi.bom.map((l) => l.ing));
      mi.bom.forEach((l) => {
        const ing = ings[l.ing];
        const name = ing ? ing.name : l.ing;
        const li = h('li', { class: 'od-bom-line' });
        const sel = h('select', { class: 'select od-bom-sel', 'aria-label': 'Ingredient for ' + itemName });
        sel.appendChild(h('option', { value: l.ing }, name));
        s.ingredients.forEach((o) => { if (!o.hidden && !used.has(o.id)) sel.appendChild(h('option', { value: o.id }, o.name)); });
        sel.value = l.ing;
        const field = numField({
          label: unitWord(ing) === 'g' ? 'Grams' : 'Pieces', aria: name + ' in ' + itemName, hideLabel: true, value: l.qty, min: 1, max: 100000, step: 1, big: 10, unit: unitWord(ing), meta: BOM_META,
          // Writes the new amount for this line through the engine.
          save: (v) => {
            const next = bomNow().map((x) => (x.ing === l.ing ? { ing: x.ing, qty: v } : x));
            const r = send('updateMenuItem', { id, patch: { bom: next } });
            return good(r) ? { ok: true, text: 'Saved. Each portion now takes ' + amountText(ing, v) + ' of ' + lower1(name) + ' off the stock.' } : { ok: false, text: refusal(r, BOM_META) };
          },
          // Shows the engine's confirmation under the row.
          onSaved: (t) => status.ok(t),
        });
        sel.addEventListener('change', () => {
          const to = sel.value, toIng = ings[to];
          const next = bomNow().map((x) => (x.ing === l.ing ? { ing: to, qty: toIng && ing && toIng.unit !== ing.unit ? (toIng.unit === 'ea' ? 1 : 100) : x.qty } : x));
          const r = send('updateMenuItem', { id, patch: { bom: next } });
          if (good(r)) status.ok('Saved. This item now uses ' + (toIng ? lower1(toIng.name) : to) + ' instead of ' + lower1(name) + '. Check the amount.');
          else { sel.value = l.ing; status.bad(refusal(r, BOM_META)); }
        });
        const rm = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm od-rm', 'aria-label': 'Remove ' + name + ' from ' + itemName }, ico('x', 18));
        rm.addEventListener('click', () => {
          const next = bomNow().filter((x) => x.ing !== l.ing);
          const r = send('updateMenuItem', { id, patch: { bom: next } });
          if (good(r)) { focusAdd = true; status.ok('Removed ' + lower1(name) + '. Stock no longer takes it off for this item.'); }
          else status.bad(refusal(r, BOM_META));
        });
        li.append(sel, field.el, rm);
        list.appendChild(li);
        lines.push({ ing: l.ing, li, sel, field, rm });
      });
      rendered = keyOf(mi, s);
      stale = false;
      const full = mi.bom.length >= 12 || mi.bom.length >= s.ingredients.length;
      addBtn.disabled = full;
      note.textContent = !mi.bom.length ? 'No ingredients, so stock is not tracked for this item.' : mi.bom.length >= 12 ? 'An item holds up to 12 ingredient lines.' : '';
      note.hidden = !note.textContent;
      if (focusIng) { const t = lines.find((x) => x.ing === focusIng); focusIng = null; if (t) t.field.input.focus(); }
      else if (focusAdd) { focusAdd = false; if (!addBtn.disabled) addBtn.focus(); else if (lines[0]) lines[0].field.input.focus(); }
    }
    // A fingerprint of the lines and ingredient names, to tell when a redraw is needed.
    const keyOf = (mi, s) => mi.bom.map((l) => l.ing).join('|') + '#' + s.ingredients.map((i) => i.id + ':' + i.name + ':' + i.unit).join('|');

    addBtn.addEventListener('click', () => {
      const s = cur(); if (!s) return;
      const used = new Set(bomNow().map((l) => l.ing));
      const cand = s.ingredients.find((i) => !i.hidden && !used.has(i.id));
      if (!cand) return;
      const q = cand.unit === 'ea' ? 1 : 100;
      const r = send('updateMenuItem', { id, patch: { bom: bomNow().concat([{ ing: cand.id, qty: q }]) } });
      if (good(r)) { focusIng = cand.id; status.ok('Added ' + lower1(cand.name) + ' at ' + amountText(cand, q) + '. Set the amount for one portion.'); }
      else status.bad(refusal(r, BOM_META));
    });
    root.addEventListener('focusout', () => { if (stale) setTimeout(() => { if (stale && !typing()) api.sync(getMi(), cur()); }, 0); });

    const api = {
      el: root,
      // Redraws only when the list of lines changed; otherwise refreshes the amounts in place.
      sync(mi, s) {
        if (rendered !== keyOf(mi, s)) { if (typing()) { stale = true; return; } build(mi, s); return; }
        lines.forEach((l, i) => { if (mi.bom[i]) l.field.sync(mi.bom[i].qty); });
      },
      // Removes the line fields and their pending saves.
      destroy() { lines.forEach((l) => l.field.destroy()); lines = []; },
    };
    return api;
  }

  // The plain name of a menu category, or Other for one we do not know.
  const catName = (id) => { const c = C.categories.find((x) => x.id === id); return c ? c.name : 'Other'; };

  // One menu item as an editable row: name, station, category, how it is cooked, price, prep time, ingredients,
  // archive. Returns {root, sync, destroy}.
  function menuRow(P, mi0) {
    const id = mi0.id;
    // Reads this menu item fresh from the state each time.
    const getMi = () => { const s = cur(); return (s && s.menu.find((m) => m.id === id)) || mi0; };
    const status = statusLine();
    const nm = mi0.name;

    const nameIn = h('input', { class: 'input', type: 'text', maxlength: 60, autocomplete: 'off', value: mi0.name });
    const nameField = SB.ui.field({ label: 'Name', control: nameIn });
    nameIn.setAttribute('aria-label', 'Name of ' + nm);
    const nameMeta = { name: 'The name', text: true };
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.replace(/\s+/g, ' ').trim(), before = getMi().name;
      if (v === before) { nameIn.value = before; nameField.setError(null); return; }
      const r = send('updateMenuItem', { id, patch: { name: v } });
      if (good(r)) { nameField.setError(null); status.ok('Saved. New tickets use the new name.'); }
      else { nameIn.value = before; nameField.setError(refusal(r, nameMeta) + ' Kept "' + before + '".'); }
    });

    const zoneSel = h('select', { class: 'select' }, C.workZones.map((z) => h('option', { value: z }, C.zoneById[z].name)));
    zoneSel.value = mi0.zone;
    const zoneField = SB.ui.field({ label: 'Station', control: zoneSel });
    zoneSel.setAttribute('aria-label', 'Station for ' + nm);
    zoneSel.addEventListener('change', () => {
      const before = getMi().zone, to = zoneSel.value;
      const r = send('updateMenuItem', { id, patch: { zone: to } });
      if (good(r)) { zoneField.setError(null); status.ok('Saved. New tickets send this item to ' + C.zoneById[to].name + '.'); }
      else { zoneSel.value = before; zoneField.setError(refusal(r, { name: 'The station' })); }
    });

    // Category decides which tab the dish sits under on the order screen.
    const catSel = h('select', { class: 'select' }, C.categories.map((c) => h('option', { value: c.id }, c.name)));
    catSel.value = mi0.cat;
    const catField = SB.ui.field({ label: 'Menu section', control: catSel });
    catSel.setAttribute('aria-label', 'Category for ' + nm);
    catSel.addEventListener('change', () => {
      const before = getMi().cat, to = catSel.value;
      const r = send('updateMenuItem', { id, patch: { cat: to } });
      if (good(r)) { catField.setError(null); status.ok('Saved. The order screen now lists this under ' + catName(to) + '.'); }
      else { catSel.value = before; catField.setError(refusal(r, { name: 'The category' })); }
    });

    // How the dish is cooked: one tap finishes it, or the cook taps Start and later Done.
    const trackSeg = SB.ui.segmented({
      label: 'How ' + nm + ' is cooked', value: mi0.track === 'two' ? 'two' : 'one',
      options: [{ id: 'one', label: 'One tap' }, { id: 'two', label: 'Start, then done' }],
      // Saves the new way of cooking it; tickets already on the board keep theirs.
      onChange: (v) => {
        const r = send('updateMenuItem', { id, patch: { track: v } });
        if (good(r)) status.ok(v === 'two' ? 'Saved. New tickets show Start, then Done for this dish.' : 'Saved. New tickets show one Done tap for this dish.');
        else { trackSeg.setValue(getMi().track === 'two' ? 'two' : 'one'); status.bad(refusal(r, null)); }
      },
    });
    const archChip = h('span', { class: 'od-archived' }, ico('package', 16), h('span', null, 'Removed'));
    const archBtn = h('button', { type: 'button', class: 'btn btn-sm od-arch' });
    archBtn.addEventListener('click', () => {
      const to = !getMi().archived;
      const r = send('updateMenuItem', { id, patch: { archived: to } });
      if (good(r)) status.ok(to ? 'Removed. It can no longer be ordered, and past tickets keep it. Bring it back any time.' : 'Brought back. It can be ordered again.');
      else status.bad(refusal(r, null));
    });

    const priceMeta = { name: 'The price', fmt: money };
    const price = numField({
      label: 'Price (' + curSymbol() + ')', aria: 'Price of ' + nm, value: mi0.price, min: 0, max: 1000, step: 0.25, big: 1, meta: priceMeta,
      // Writes the new price; the confirmation says what it changes.
      save: (v) => {
        const r = send('updateMenuItem', { id, patch: { price: v } });
        return good(r) ? { ok: true, text: 'Saved. New tickets use ' + money(v) + '; tickets already on the board keep theirs.' } : { ok: false, text: refusal(r, priceMeta) };
      },
      // Shows the price confirmation under the row.
      onSaved: (t) => status.ok(t),
    });
    // How a prep time is written in refusal messages: minutes and seconds.
    const prepMeta = { name: 'The prep time', unit: 's', fmt: (v) => mmss(v) };
    const prep = numField({
      // The small reading beside the field shows the time as m:ss.
      label: 'Prep time (seconds)', aria: 'Prep time of ' + nm, value: mi0.prepSec, min: 5, max: 3600, step: 5, big: 30, unit: 's', meta: prepMeta, read: (u) => mmss(u),
      // Writes the prep time in seconds through the engine.
      save: (v) => {
        const r = send('updateMenuItem', { id, patch: { prepSec: v } });
        return good(r) ? { ok: true, text: 'Saved. New tickets plan with ' + mmss(v) + ' for this item; tickets already on the board keep theirs.' } : { ok: false, text: refusal(r, prepMeta) };
      },
      // Shows the prep time confirmation under the row.
      onSaved: (t) => status.ok(t),
    });
    const confSeg = SB.ui.segmented({
      label: 'Prep time status for ' + nm, value: mi0.prepConfirmed ? 'confirmed' : 'starter',
      options: [{ id: 'starter', label: 'Starter estimate' }, { id: 'confirmed', label: 'Confirmed' }],
      // Marks the prep time as a starter estimate or as confirmed.
      onChange: (v) => {
        const r = send('updateMenuItem', { id, patch: { prepConfirmed: v === 'confirmed' } });
        if (good(r)) status.ok(v === 'confirmed' ? 'Saved. Prep time marked as confirmed.' : 'Saved. Prep time marked as a starter estimate.');
        else { confSeg.setValue(getMi().prepConfirmed ? 'confirmed' : 'starter'); status.bad(refusal(r, null)); }
      },
    });
    const learnedEl = h('p', { class: 'od-hint od-learned', hidden: true });
    const bom = bomBlock(id, nm, getMi, status);

    // The compact summary row: name, station, price and prep time on one line; tapping it opens the full form below.
    const sumName = h('span', { class: 'od-sum-n' }), sumMeta = h('span', { class: 'od-sum-m' }), sumPrice = h('span', { class: 'od-sum-p num' }), sumPrep = h('span', { class: 'od-sum-t num' });
    const sumBtn = h('button', { type: 'button', class: 'od-sum', 'aria-expanded': 'false' }, sumName, sumMeta, sumPrice, sumPrep, h('span', { class: 'od-sum-i', 'aria-hidden': 'true' }, ico('chevron-down', 18)));
    const body = h('div', { class: 'od-item-body', hidden: true });
    // Opens or closes the full form for this dish.
    const setOpen = (on) => { body.hidden = !on; sumBtn.setAttribute('aria-expanded', on ? 'true' : 'false'); root.dataset.open = on ? 'true' : 'false'; };
    sumBtn.addEventListener('click', () => setOpen(body.hidden));
    const root = h('article', { class: 'od-item', dataset: { id, open: 'false' }, 'aria-label': nm }, sumBtn, body);
    body.append(
      h('div', { class: 'od-item-head' },
        nameField, zoneField, catField,
        h('div', { class: 'od-item-actions' }, archChip, archBtn)),
      h('div', { class: 'od-item-grid' },
        h('div', { class: 'od-block' }, price.el, h('div', { class: 'od-lab' }, 'How it is cooked'), trackSeg, h('p', { class: 'od-hint' }, 'One tap: done when it is plated, like a drink or a cold side. Start, then done: the cook taps Start, and Done when it is finished, like a roast or fries.')),
        h('div', { class: 'od-block' }, prep.el, confSeg, learnedEl),
        h('div', { class: 'od-block od-block-bom' }, bom.el)),
      status.el);

    return {
      root, id,
      // Opens the full form, used when the list is filtered to the starter estimates.
      open: () => setOpen(true),
      // Refreshes this row from the state without touching a field that has focus.
      sync(mi, s) {
        root.dataset.archived = mi.archived ? 'true' : 'false';
        root.dataset.confirmed = mi.prepConfirmed ? 'true' : 'false';
        if (doc.activeElement !== nameIn && nameIn.value !== mi.name) nameIn.value = mi.name;
        if (doc.activeElement !== zoneSel) zoneSel.value = mi.zone;
        if (doc.activeElement !== catSel) catSel.value = C.categories.some((c) => c.id === mi.cat) ? mi.cat : '';
        trackSeg.setValue(mi.track === 'two' ? 'two' : 'one');
        root.dataset.zone = mi.zone;
        sumName.textContent = mi.name;
        { const zn = C.zoneById[mi.zone] ? C.zoneById[mi.zone].name : '', cn = catName(mi.cat); sumMeta.textContent = (zn.toLowerCase() === cn.toLowerCase() ? zn : zn + ', ' + cn) + (mi.archived ? ', removed' : mi.prepConfirmed ? '' : ', starter prep time'); }
        sumPrice.textContent = money(mi.price); sumPrep.textContent = mmss(mi.prepSec);
        price.sync(mi.price); prep.sync(mi.prepSec);
        confSeg.setValue(mi.prepConfirmed ? 'confirmed' : 'starter');
        archChip.hidden = !mi.archived;
        archBtn.replaceChildren(ico(mi.archived ? 'check' : 'ban', 18), h('span', null, mi.archived ? 'Bring it back' : 'Remove'));
        archBtn.setAttribute('aria-label', (mi.archived ? 'Bring back ' : 'Remove ') + mi.name);
        const l = s.learned && s.learned[id];
        if (l && isNum(l.est) && l.n >= 1 && mi.prepSec > 0) {
          const diff = (l.est - mi.prepSec) / mi.prepSec;
          learnedEl.textContent = 'Learned estimate ' + mmss(l.est) + ' from ' + l.n + ' ' + U.plural(l.n, 'timing') + (Math.abs(diff) >= 0.1 ? ': ' + Math.round(Math.abs(diff) * 100) + '% ' + (diff > 0 ? 'slower' : 'faster') + ' than the starter ' + mmss(mi.prepSec) + '.' : ', close to the starter ' + mmss(mi.prepSec) + '.');
          learnedEl.hidden = false;
        } else learnedEl.hidden = true;
        bom.sync(mi, s);
      },
      // Saves anything waiting and clears this row's timers.
      destroy() { price.destroy(); prep.destroy(); bom.destroy(); status.destroy(); },
    };
  }

  // The Add a dish form: name, short name, station, category, price, prep time and how it is cooked. It sends
  // addMenuItem and says plainly what happened. onAdded(id) lets the list jump to the new dish. Returns {el, open, close}.
  function addDishForm(onAdded) {
    const status = statusLine();
    const nameIn = h('input', { class: 'input', type: 'text', maxlength: 60, autocomplete: 'off', placeholder: 'Brisket plate' });
    const nameField = SB.ui.field({ label: 'Dish name', control: nameIn });
    const shortIn = h('input', { class: 'input', type: 'text', maxlength: 24, autocomplete: 'off' });
    const shortField = SB.ui.field({ label: 'Short name on tickets (optional)', control: shortIn, hint: 'Leave it empty to use the first 24 letters of the name.' });
    const zoneSel = h('select', { class: 'select' }, C.workZones.map((z) => h('option', { value: z }, C.zoneById[z].name)));
    const zoneField = SB.ui.field({ label: 'Station that cooks it', control: zoneSel });
    const catSel = h('select', { class: 'select' }, C.categories.map((c) => h('option', { value: c.id }, c.name)));
    const catField = SB.ui.field({ label: 'Menu section', control: catSel });
    const priceIn = h('input', { class: 'input od-add-num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
    const priceField = SB.ui.field({ label: 'Price (' + curSymbol() + ')', control: priceIn });
    const minIn = h('input', { class: 'input od-add-num', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: '2', 'aria-label': 'Prep time, minutes' });
    const secIn = h('input', { class: 'input od-add-num', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: '0', 'aria-label': 'Prep time, seconds' });
    const prepErr = h('div', { class: 'field-error', role: 'alert', hidden: true });
    const prepField = h('div', { class: 'field od-add-prep' }, h('div', { class: 'field-label' }, 'Prep time'), h('div', { class: 'od-add-row' }, minIn, h('span', null, 'min'), secIn, h('span', null, 'sec')),
      h('div', { class: 'field-hint' }, 'How long the cook needs from start to plated. A guess is fine; the app learns the real time from your tickets.'), prepErr);
    const trackSeg = SB.ui.segmented({
      label: 'How it is cooked', value: 'two', options: [{ id: 'one', label: 'One tap' }, { id: 'two', label: 'Start, then done' }],
      // Explains the newly chosen way of cooking in plain words.
      onChange: () => paintTrack(),
    });
    const trackHint = h('p', { class: 'od-hint' });
    // Explains the chosen way of cooking in plain words.
    function paintTrack() { trackHint.textContent = trackSeg.getValue() === 'two' ? 'The cook taps Start when the dish begins and Done when it is finished. Use it for anything cooked on the line.' : 'The cook taps Done when it is plated. Use it for drinks, cold sides and anything with no cooking step.'; }
    paintTrack();
    const addBtn = btn('Add dish', { icon: 'plus', cls: 'btn-primary' });
    addBtn.type = 'submit'; // Enter in any box sends the form too
    const cancelBtn = btn('Close', { icon: 'x' });
    const form = h('form', { class: 'od-add', hidden: true, 'aria-label': 'Add a dish', novalidate: '' },
      h('h3', { class: 'od-sub' }, 'Add a dish'),
      h('div', { class: 'od-add-grid' }, nameField, shortField, zoneField, catField, priceField, prepField),
      h('div', { class: 'od-add-track' }, h('div', { class: 'od-lab' }, 'How it is cooked'), trackSeg, trackHint),
      h('div', { class: 'od-add-actions' }, addBtn, cancelBtn), status.el);
    // Clears every error line on the form.
    const clearErrors = () => { status.clear(); [nameField, shortField, zoneField, catField, priceField].forEach((f) => f.setError(null)); prepErr.hidden = true; prepErr.replaceChildren(); };
    // Reads the form, checks it, and sends it. Each problem shows beside its own field.
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      clearErrors();
      const name = nameIn.value.replace(/\s+/g, ' ').trim();
      if (!name) { nameField.setError('Type the dish name.'); nameIn.focus(); return; }
      const rawPrice = priceIn.value.replace(/[$\s]/g, '').replace(',', '.');
      if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(rawPrice)) { priceField.setError('Type the price in dollars, like 12.50.'); priceIn.focus(); return; }
      const price = parseFloat(rawPrice);
      if (!/^\d{0,3}$/.test(minIn.value.trim()) || !/^\d{0,3}$/.test(secIn.value.trim())) { prepErr.replaceChildren(h('span', null, 'Type the prep time with digits only.')); prepErr.hidden = false; minIn.focus(); return; }
      const prepSec = (parseInt(minIn.value || '0', 10) || 0) * 60 + (parseInt(secIn.value || '0', 10) || 0);
      if (prepSec < 5 || prepSec > 3600) { prepErr.replaceChildren(h('span', null, 'Prep time has to be between 0:05 and 60:00.')); prepErr.hidden = false; minIn.focus(); return; }
      const r = send('addMenuItem', { name, short: shortIn.value.trim(), zone: zoneSel.value, cat: catSel.value, price, prepSec, track: trackSeg.getValue() });
      if (good(r)) {
        status.ok('Added ' + name + '. It is on the order screen now. To track stock for it, add its ingredients in its row below.');
        nameIn.value = ''; shortIn.value = ''; priceIn.value = '';
        onAdded(r.info && r.info.id);
        nameIn.focus();
        return;
      }
      const key = (r.info && r.info.key) || '';
      if (/\.name$/.test(key) && r.report === 'badPatch') { nameField.setError('There is already a dish called ' + name + '. Pick another name.'); nameIn.focus(); }
      else if (/\.name$/.test(key)) nameField.setError('The name has to be 1 to 60 characters.');
      else if (/\.short$/.test(key)) shortField.setError('The short name has to be 1 to 24 characters.');
      else if (/\.price$/.test(key)) priceField.setError(refusal(r, { name: 'The price', fmt: money }));
      else status.bad(refusal(r, null));
    });
    cancelBtn.addEventListener('click', () => { form.hidden = true; });
    return {
      el: form,
      // Shows the form and puts the cursor in the name box.
      open() { form.hidden = false; nameIn.focus(); },
      // True while the form is showing.
      isOpen: () => !form.hidden,
      // Stops the status line timer when the page closes.
      destroy() { status.destroy(); },
    };
  }

  // Panel 1: filters, and one row per menu item, kept in step with the store.
  function buildMenu(P) {
    const pn = panel(SECTIONS[0]);
    const filter = P.menuFilter;
    pn.body.append(
      para('Changes save as you make them. New tickets use the new price, prep time and ingredients; tickets already on the board keep theirs. There is no Undo for settings, so check a value before you move on.', 'od-intro'),
      para('A prep time is a starter estimate until you have timed it on the line and marked it confirmed. Removed dishes cannot be ordered, and past tickets keep them.', 'od-intro'));

    // Add a dish, and a one-tap way to drop the made-up starter dishes. The form opens under the buttons.
    const addForm = addDishForm((id) => {
      filter.status = 'active'; filter.zone = 'all'; filter.starter = false; applyFilter();
      // The new row is made when the store tells the page; give it a moment, then show it.
      setTimeout(() => { const row = rows.get(id); if (row) { row.open(); row.root.scrollIntoView({ block: 'nearest', behavior: U.prefersReducedMotion() ? 'auto' : 'smooth' }); } }, 80);
    });
    const addOpenBtn = btn('Add a dish', { icon: 'plus', cls: 'btn-primary' });
    addOpenBtn.addEventListener('click', () => addForm.open());
    const starterBtn = btn('Use only my own dishes', { icon: 'ban' });
    const starterBox = h('div', { class: 'od-starter', hidden: true, role: 'group', 'aria-label': 'Remove the starter dishes' });
    const starterMsg = h('p', { class: 'od-p' });
    const starterYes = btn('Remove the starter dishes', { icon: 'ban', cls: 'btn-danger' });
    const starterNo = btn('Keep them', { icon: 'x' });
    starterBox.append(starterMsg, h('div', { class: 'od-add-actions' }, starterYes, starterNo));
    const starterStatus = statusLine();
    // The starter dishes that can still be ordered: the ones that came with the app, not archived yet.
    const liveStarters = () => { const s = cur(); return s ? s.menu.filter((m) => C.menuById[m.id] && !m.archived) : []; };
    starterBtn.addEventListener('click', () => {
      const n = liveStarters().length;
      starterMsg.textContent = 'This removes the ' + n + ' demo starter ' + U.plural(n, 'dish', 'dishes') + ' that came with the app, so only the dishes you add can be ordered. Past tickets keep them. You can bring any of them back later.';
      starterBox.hidden = false; starterYes.focus();
    });
    starterNo.addEventListener('click', () => { starterBox.hidden = true; starterBtn.focus(); });
    starterYes.addEventListener('click', () => {
      const list = liveStarters(); let failed = 0;
      list.forEach((m) => { if (!good(send('updateMenuItem', { id: m.id, patch: { archived: true } }))) failed++; });
      starterBox.hidden = true;
      if (failed) starterStatus.bad('Removed ' + (list.length - failed) + ' of ' + list.length + ' starter dishes. ' + failed + ' could not be removed.');
      else starterStatus.ok('Removed ' + list.length + ' starter ' + U.plural(list.length, 'dish', 'dishes') + '. Add your own with Add a dish.');
    });
    pn.body.append(h('div', { class: 'od-add-bar' }, addOpenBtn, starterBtn), starterBox, starterStatus.el, addForm.el);
    P.syncs.push(() => { const n = liveStarters().length; starterBtn.hidden = n === 0; if (!n) starterBox.hidden = true; });
    P.disposers.push(() => { addForm.destroy(); starterStatus.destroy(); });

    const segStatus = SB.ui.segmented({
      label: 'Show items', value: filter.status,
      options: [{ id: 'active', label: 'Active', count: 0 }, { id: 'archived', label: 'Removed', count: 0 }, { id: 'all', label: 'All', count: 0 }],
      // Changes which items are listed by status.
      onChange: (v) => { filter.status = v; applyFilter(); },
    });
    const zoneSel = h('select', { class: 'select od-filter-zone', 'aria-label': 'Show one station' }, h('option', { value: 'all' }, 'All stations'), C.workZones.map((z) => h('option', { value: z }, C.zoneById[z].name)));
    zoneSel.addEventListener('change', () => { filter.zone = zoneSel.value; applyFilter(); });
    // Switches the filter that lists only starter estimates.
    const starterChip = SB.ui.chip({ label: 'Starter estimates only', pressed: false, onClick: () => { filter.starter = !filter.starter; applyFilter(); } });
    starterChip.classList.add('od-fchip');
    const filters = h('div', { class: 'od-filters' }, segStatus, zoneSel, starterChip);
    const list = h('div', { class: 'od-list' });
    const emptyT = h('strong', null, 'No items match.'), emptyB = h('span', null, ' Change the filter above to see more.');
    // The add-your-first-dish button only shows when the menu has no dishes at all; it opens the dishes sheet.
    const emptyAdd = h('button', { type: 'button', class: 'btn btn-primary', hidden: true, dataset: { act: 'first-dish' } }, ico('plus', 20), h('span', null, 'Add your first dish'));
    emptyAdd.addEventListener('click', () => { if (SB.sheets && SB.sheets.open) SB.sheets.open('dishes'); });
    const emptyEl = h('div', { class: 'od-empty', hidden: true }, emptyT, emptyB, emptyAdd);
    list.appendChild(emptyEl);
    pn.body.append(filters, list);

    const rows = new Map();
    // Updates the counts and shows only the rows that match the three filters.
    function applyFilter() {
      const s = cur(); if (!s) return;
      let nA = 0, nR = 0, shown = 0;
      let nGuess = 0;
      for (const mi of s.menu) { if (mi.archived) nR++; else { nA++; if (!mi.prepConfirmed) nGuess++; } }
      // The starter-estimates filter only shows while there is a guessed prep time to find.
      starterChip.hidden = !nGuess && !filter.starter;
      segStatus.setCount('active', nA); segStatus.setCount('archived', nR); segStatus.setCount('all', nA + nR);
      segStatus.setValue(filter.status); zoneSel.value = filter.zone;
      starterChip.setAttribute('aria-pressed', filter.starter ? 'true' : 'false');
      for (const mi of s.menu) {
        const row = rows.get(mi.id); if (!row) continue;
        const ok = (filter.status === 'all' || (filter.status === 'archived') === !!mi.archived) && (filter.zone === 'all' || mi.zone === filter.zone) && (!filter.starter || !mi.prepConfirmed);
        row.root.hidden = !ok; if (ok) shown++;
      }
      emptyEl.hidden = shown > 0;
      const none = s.menu.length === 0;
      emptyT.textContent = none ? 'No dishes yet.' : 'No items match.';
      emptyB.textContent = none ? ' Add your first dish to start taking orders.' : ' Change the filter above to see more.';
      emptyAdd.hidden = !none;
    }
    P.syncs.push((s) => {
      const seen = new Set();
      for (const mi of s.menu) {
        seen.add(mi.id);
        let row = rows.get(mi.id);
        if (!row) { row = menuRow(P, mi); rows.set(mi.id, row); list.insertBefore(row.root, emptyEl); }
        row.sync(mi, s);
      }
      for (const [rid, row] of rows) if (!seen.has(rid)) { row.destroy(); row.root.remove(); rows.delete(rid); }
      applyFilter();
    });
    P.disposers.push(() => rows.forEach((r) => r.destroy()));
    // Used by the headline button to jump to the unconfirmed items.
    P.showStarter = () => { filter.status = 'active'; filter.zone = 'all'; filter.starter = true; applyFilter(); };
    return pn;
  }

  // 2. Ingredients
  // One ingredient as an editable row: par, 86 point, cost and, for cooked meats, the yield. Returns {root,
  // sync, destroy}.
  function ingRow(P, ing0) {
    const id = ing0.id;
    // Reads this ingredient fresh from the state each time.
    const getIng = () => { const s = cur(); return (s && s.ingredients.find((i) => i.id === id)) || ing0; };
    const status = statusLine();
    const pieces = ing0.unit === 'ea';
    const nm = ing0.name;
    const fields = [];
    // Saves one ingredient change through the engine and returns {ok, text} for the field.
    const mkPatch = (patch, okText, meta) => {
      const r = send('updateIngredient', { id, patch });
      return good(r) ? { ok: true, text: okText } : { ok: false, text: refusal(r, meta) };
    };
    const parMeta = { name: 'Opening amount', unit: pieces ? 'pieces' : 'g' };
    const thrMeta = { name: 'The sold-out amount', unit: pieces ? 'pieces' : 'g' };
    const par = numField({
      label: 'Opening amount (par)', aria: 'Opening amount of ' + nm, value: ing0.parG, min: 0, max: 1e7, step: pieces ? 1 : 100, big: pieces ? 10 : 1000, unit: pieces ? 'pieces' : 'g', meta: parMeta,
      read: pieces ? null : (u) => ((SB.office && SB.office.weightText) || U.weightText)(u),
      // Par saves through the engine; the line under the row confirms it.
      save: (v) => mkPatch({ parG: v }, 'Saved. Par is ' + amountText(ing0, v) + '. After you erase tickets and records and keep settings, opening stock starts at this amount.', parMeta), onSaved: (t) => status.ok(t),
    });
    const thr = numField({
      label: 'Sold out at', aria: 'Sold out at, ' + nm, value: ing0.thresholdG, min: 0, max: 1e7, step: pieces ? 1 : 50, big: pieces ? 10 : 500, unit: pieces ? 'pieces' : 'g', meta: thrMeta,
      read: pieces ? null : (u) => ((SB.office && SB.office.weightText) || U.weightText)(u), hint: 'Dishes that use this are marked sold out at or below this amount.',
      // The 86 point saves the same way.
      save: (v) => mkPatch({ thresholdG: v }, 'Saved. Items using ' + lower1(nm) + ' go 86 at ' + amountText(ing0, v) + ' or less.', thrMeta), onSaved: (t) => status.ok(t),
    });
    fields.push(par, thr);
    const costKey = pieces ? 'costEach' : 'costPerKg';
    const costMeta = { name: pieces ? 'The cost each' : 'The cost per kg', fmt: money };
    const cost = numField({
      label: pieces ? 'Cost each (' + curSymbol() + ')' : 'Raw cost per kg (' + curSymbol() + ')', aria: (pieces ? 'Cost each of ' : 'Cost per kg of ') + nm, value: ing0[costKey] || 0, min: 0, max: 10000, step: pieces ? 0.05 : 0.25, big: pieces ? 0 : 1, meta: costMeta,
      // The cost saves the same way, as dollars per kg or each.
      save: (v) => mkPatch({ [costKey]: v }, 'Saved. Costs and margins use ' + money(v) + (pieces ? ' each' : ' per kg') + ' from now on.', costMeta), onSaved: (t) => status.ok(t),
    });
    fields.push(cost);
    // Pull size: the set amount one Pull button takes out of the hold cabinet (one whole brisket, one rack, one pan).
    let pull = null, holdF = null, restF = null, cookF = null, basisSeg = null;
    if (ing0.tcs) {
      const pullMeta = { name: 'The pull size', unit: 'g' };
      pull = numField({
        label: 'Amount per take-out', aria: 'Amount per take-out of ' + nm, value: ing0.pullG || 1000, min: 50, max: 50000, step: 100, big: 500, unit: 'g', meta: pullMeta,
        // Shows the pull size in kilograms next to the field once it reaches a kilogram.
        read: (u) => ((SB.office && SB.office.weightText) || U.weightText)(u),
        hint: 'What one tap on Pull takes out of the cabinet: one whole brisket, one rack, one pan.',
        // The pull size saves through the engine like the other fields.
        save: (v) => mkPatch({ pullG: v }, 'Saved. One tap on Pull takes ' + amountText(ing0, v) + ' out of the cabinet.', pullMeta), onSaved: (t) => status.ok(t),
      });
      fields.push(pull);
      // Hold window: how long a batch may stay, how long it rests first, and what kind of limit it is.
      const holdMeta = { name: 'The hold limit', unit: 'h' }, restMeta = { name: 'The rest time', unit: 'h' };
      holdF = numField({
        label: 'Hold limit (hours in the cabinet)', aria: 'Hold limit of ' + nm, value: ing0.maxHoldH || 4, min: 0.5, max: 12, step: 0.5, big: 1, unit: 'h', meta: holdMeta,
        hint: 'A batch reaches its limit this long after it goes in (the throw-out time throws it out, a quality limit takes it off the menu). Starter limit: owner to confirm.',
        // The hold limit saves through the engine like the other fields.
        save: (v) => mkPatch({ maxHoldH: v }, 'Saved. New batches of ' + lower1(nm) + ' reach their hold limit ' + v + ' hours after they go in.', holdMeta), onSaved: (t) => status.ok(t),
      });
      restF = numField({
        label: 'Rest before serving (hours)', aria: 'Rest time of ' + nm, value: ing0.restH || 0, min: 0, max: 12, step: 0.5, big: 1, unit: 'h', meta: restMeta,
        hint: 'A fresh batch rests this long before it is ready. Pulls take ready batches first.',
        // The rest time saves the same way.
        save: (v) => mkPatch({ restH: v }, 'Saved. New batches of ' + lower1(nm) + ' rest ' + v + ' hours before they are ready.', restMeta), onSaved: (t) => status.ok(t),
      });
      const cookMeta = { name: 'The cook time', unit: 'h' };
      cookF = numField({
        label: 'Cook time (hours)', aria: 'Cook time of ' + nm, value: ing0.cookH || 0, min: 0, max: 48, step: 0.5, big: 1, unit: 'h', meta: cookMeta,
        hint: 'From starting a batch to ready (before its rest). Used to say whether a new batch started now is ready before close. Starter value: owner to confirm.',
        // The cook time saves through the engine like the other fields.
        save: (v) => mkPatch({ cookH: v }, 'Saved. A new batch of ' + lower1(nm) + ' takes ' + v + ' hours to cook.', cookMeta), onSaved: (t) => status.ok(t),
      });
      basisSeg = SB.ui.segmented({
        label: 'Kind of hold limit for ' + nm, value: ing0.holdBasis === 'safety' ? 'safety' : 'quality',
        options: [{ id: 'quality', label: 'Quality limit' }, { id: 'safety', label: 'Throw-out time' }],
        // Marks the limit as a house quality limit or as time as a public health control.
        onChange: (v) => {
          const r = send('updateIngredient', { id, patch: { holdBasis: v } });
          if (good(r)) status.ok('Saved. The limit is a ' + v + ' limit.');
          else { basisSeg.setValue(getIng().holdBasis === 'safety' ? 'safety' : 'quality'); status.bad(refusal(r, null)); }
        },
      });
      fields.push(holdF, restF, cookF);
    }

    let yieldBlock = null, yField = null, yConf = null;
    if (ing0.tcs && isNum(ing0.yield)) {
      // Shows a yield fraction as a percentage in messages.
      const yMeta = { name: 'The yield', unit: '%', toUi: (v) => v * 100 };
      yField = numField({
        label: 'Cooked yield (cooked weight as a percent of raw weight)', aria: 'Cooked yield of ' + nm, value: ing0.yield, min: 5, max: 300, step: 1, big: 5, unit: '%', meta: yMeta,
        // The field shows a percentage; the engine stores a fraction.
        toUi: (v) => Math.round(v * 10000) / 100, fromUi: (u) => Math.round(u * 100) / 10000,
        // A yield saves as a fraction; the confirmation names the percentage.
        save: (v) => mkPatch({ yield: v }, 'Saved. New batches use ' + num(v * 100, 1) + '% cooked yield.', yMeta), onSaved: (t) => status.ok(t),
      });
      yConf = SB.ui.segmented({
        label: 'Yield status for ' + nm, value: ing0.yieldConfirmed ? 'confirmed' : 'starter',
        options: [{ id: 'starter', label: 'Starter estimate' }, { id: 'confirmed', label: 'Confirmed' }],
        // Marks the yield as a starter estimate or as confirmed.
        onChange: (v) => {
          const r = send('updateIngredient', { id, patch: { yieldConfirmed: v === 'confirmed' } });
          if (good(r)) status.ok(v === 'confirmed' ? 'Saved. Yield marked as confirmed.' : 'Saved. Yield marked as a starter estimate.');
          else { yConf.setValue(getIng().yieldConfirmed ? 'confirmed' : 'starter'); status.bad(refusal(r, null)); }
        },
      });
      fields.push(yField);
      const thermal = ing0.thermal ? SB.engine.thermalYield({}) : null;
      yieldBlock = h('div', { class: 'od-block' }, yField.el, yConf,
        ing0.thermal ? hintLine(nm + ' is costed with the thermal model (about ' + num(thermal.hotPct, 1) + '% at ' + thermal.endpointC + ' C and ' + thermal.holdH + ' h hold). This static number is what the Sales and money page compares it against.') : null);
    }

    const holdBits = [];
    if (ing0.tcs) { holdBits.push(chip(ing0.hold === 'cold' ? 'Cold hold' : 'Hot hold', ing0.hold === 'cold' ? 'info' : 'warn', ing0.hold === 'cold' ? 'snow' : 'flame')); if (isNum(ing0.maxHoldH)) holdBits.push(chip('Max hold ' + ing0.maxHoldH + ' h', 'info', 'clock')); }
    else holdBits.push(chip(pieces ? 'Counted in pieces' : 'Not temperature controlled', 'info'));
    const noteEl = ing0.note ? hintLine(kgNote(ing0.note)) : null;

    const root = h('article', { class: 'od-item od-ing', dataset: { id }, 'aria-label': nm },
      h('div', { class: 'od-ing-head' }, h('h3', { class: 'od-ing-name' }, nm), h('div', { class: 'od-chips' }, holdBits)),
      h('div', { class: 'od-item-grid od-ing-grid' },
        h('div', { class: 'od-block' }, par.el),
        h('div', { class: 'od-block' }, thr.el),
        yieldBlock,
        h('div', { class: 'od-block' }, cost.el),
        pull ? h('div', { class: 'od-block' }, pull.el) : null,
        holdF ? h('div', { class: 'od-block' }, holdF.el, basisSeg, ing0.confirmBasis ? hintLine('Starter basis, owner to confirm: if ' + lower1(nm) + ' is held outside temperature control, choose Throw-out time.') : null) : null,
        restF ? h('div', { class: 'od-block' }, restF.el, cookF.el) : null),
      noteEl, status.el);
    return {
      root, id,
      // Refreshes the fields from the state without disturbing a focused one.
      sync(ing) {
        par.sync(ing.parG); thr.sync(ing.thresholdG); cost.sync(ing[costKey] || 0);
        if (pull) pull.sync(ing.pullG || 1000);
        if (holdF) { holdF.sync(ing.maxHoldH || 4); restF.sync(ing.restH || 0); cookF.sync(ing.cookH || 0); basisSeg.setValue(ing.holdBasis === 'safety' ? 'safety' : 'quality'); }
        if (yField) { yField.sync(ing.yield); yConf.setValue(ing.yieldConfirmed ? 'confirmed' : 'starter'); }
        root.dataset.confirmed = ing.yieldConfirmed ? 'true' : 'false';
      },
      // Saves anything waiting and clears this row's timers.
      destroy() { fields.forEach((f) => f.destroy()); status.destroy(); },
    };
  }

  // Panel 2: one row per ingredient, kept in step with the store.
  function buildIngredients(P) {
    const pn = panel(SECTIONS[1],
      'The opening amount (par) is the stock you start a day with. When stock falls to the sold-out amount or below, every dish that uses it is marked sold out. Weights are grams and kilograms; counted items such as buns and cornbread are pieces. Cooked yield is cooked weight divided by raw weight, and stays a starter estimate until you confirm it from weighed batches. Costs are starter numbers too: replace them with your supplier invoices. Changes save as you make them and apply from now on.');
    const list = h('div', { class: 'od-list' });
    pn.body.appendChild(list);
    const rows = new Map();
    P.syncs.push((s) => {
      const seen = new Set();
      for (const ing of s.ingredients) {
        // Hidden counted-stock ingredients ("Portions of ...") are kept out of the settings list.
        if (ing.hidden) continue;
        seen.add(ing.id);
        let row = rows.get(ing.id);
        if (!row) { row = ingRow(P, ing); rows.set(ing.id, row); list.appendChild(row.root); }
        row.sync(ing);
      }
      for (const [rid, row] of rows) if (!seen.has(rid)) { row.destroy(); row.root.remove(); rows.delete(rid); }
    });
    P.disposers.push(() => rows.forEach((r) => r.destroy()));
    return pn;
  }

  // 3. Ticket time limits by channel
  function buildTimes(P) {
    const pn = panel(SECTIONS[2],
      'A ticket turns amber once it has been open this long, and shows as overdue after the second time. Times are minutes and seconds; change them in seconds. The board measures every open ticket against the current limits, so a change shows on the board straight away.');
    // The channel's current amber and overdue times from the settings.
    const times = (chId) => SB.engine.channelThresholds((cur() || {}).settings, chId);
    const list = h('div', { class: 'od-list' });
    pn.body.appendChild(list);
    const rows = C.channels.map((ch) => {
      const wk = 'channels.' + ch.id + '.warnSec', bk = 'channels.' + ch.id + '.breachSec';
      const status = statusLine();
      const preview = h('p', { class: 'od-preview' });
      let warnF, breachF;
      // Rewrites the live preview sentence from the two fields as they are now.
      const paint = () => {
        const w = warnF.stepper.getValue(), b = breachF.stepper.getValue();
        preview.textContent = 'A ' + ch.name.toLowerCase() + ' ticket turns amber at ' + mmss(w) + ' and overdue at ' + mmss(b) + '.';
      };
      // Cross-field wording: amber has to come before overdue, so the person knows which to change first.
      const wMeta = { name: ch.name + ' amber time', fmt: mmss, words: (info) => (info.key !== wk ? 'Amber has to come before overdue (' + mmss(times(ch.id).breachSec) + '). Raise the overdue time first, then this one.' : null) };
      // The mirror wording for the overdue field: it has to come after amber.
      const bMeta = { name: ch.name + ' overdue time', fmt: mmss, words: (info) => (info.key === bk && info.min > 60 ? 'Overdue has to come after amber (' + mmss(times(ch.id).warnSec) + '). Use ' + mmss(info.min) + ' or later.' : null) };
      META[wk] = wMeta; META[bk] = bMeta;
      const t = times(ch.id);
      warnF = numField({
        // Both time fields show m:ss beside the seconds and repaint the preview while typing.
        label: 'Turns amber at', aria: ch.name + ' turns amber at (seconds)', value: t.warnSec, min: 30, max: 7200, step: 15, big: 60, unit: 's', meta: wMeta, read: (u) => mmss(u), onInput: paint,
        // They save as channel settings and refresh the preview once accepted.
        save: (v) => saveSetting(wk, v, 'Saved. ' + ch.name + ' tickets turn amber at ' + mmss(v) + '.', wMeta), onSaved: (x) => { status.ok(x); paint(); },
      });
      breachF = numField({
        // The overdue field behaves like the amber field above.
        label: 'Overdue at', aria: ch.name + ' overdue at (seconds)', value: t.breachSec, min: 60, max: 10800, step: 15, big: 60, unit: 's', meta: bMeta, read: (u) => mmss(u), onInput: paint,
        // It saves the overdue time the same way.
        save: (v) => saveSetting(bk, v, 'Saved. ' + ch.name + ' tickets show overdue at ' + mmss(v) + '.', bMeta), onSaved: (x) => { status.ok(x); paint(); },
      });
      paint();
      const root = h('article', { class: 'od-item od-chan', dataset: { channel: ch.id }, 'aria-label': ch.name },
        h('div', { class: 'od-ing-head' }, h('h3', { class: 'od-ing-name' }, ico(ch.icon, 20), h('span', null, ch.name))),
        h('div', { class: 'od-item-grid od-chan-grid' }, h('div', { class: 'od-block' }, warnF.el), h('div', { class: 'od-block' }, breachF.el)),
        preview, status.el);
      list.appendChild(root);
      return { ch, warnF, breachF, paint, status };
    });
    const resetStatus = statusLine();
    const resetBtn = btn('Reset times to starter values', { icon: 'refresh', cls: 'btn-sm' });
    resetBtn.addEventListener('click', () => {
      const patch = { channels: {} };
      C.channels.forEach((ch) => { patch.channels[ch.id] = { warnSec: ch.warnSec, breachSec: ch.breachSec }; });
      const r = send('updateSettings', { patch });
      if (r.report === 'ok') resetStatus.ok('Saved. Every channel is back to the starter times.');
      else if (r.report === 'nothingToDo') resetStatus.ok('Already at the starter times.');
      else resetStatus.bad(refusal(r, null));
    });
    pn.body.append(h('div', { class: 'od-actions' }, resetBtn), resetStatus.el);
    P.syncs.push((s) => rows.forEach((r) => { const t = SB.engine.channelThresholds(s.settings, r.ch.id); r.warnF.sync(t.warnSec); r.breachF.sync(t.breachSec); r.paint(); }));
    P.disposers.push(() => rows.forEach((r) => { r.warnF.destroy(); r.breachF.destroy(); r.status.destroy(); }), () => resetStatus.destroy());
    return pn;
  }

  // 4. Meal pacing.
  // Ranges mirror the engine's SET_SCHEMA.pacing; the e2e test checks both ends of each range against
  // SB.engine.apply so a drift fails loudly.
  const PACING = [
    { key: 'floorSec', name: 'Shortest prep time', min: 1, max: 600, step: 1, big: 15, unit: 's', mean: 'No item is planned for less time than this, even if its prep estimate is shorter.' },
    { key: 'qtyFactor', name: 'Extra time per extra portion', min: 0, max: 200, step: 5, big: 25, unit: '%', pct: true, mean: 'Each extra portion on the same line adds this much to its prep time.' },
    { key: 'qtyCap', name: 'Most a big line can grow', min: 1, max: 10, step: 0.5, unit: '×', mean: 'A line is never planned for more than this many times one portion\'s prep time.' },
    { key: 'learnK', name: 'How fast it learns your real times', min: 0, max: 50, step: 1, unit: 'timings', mean: 'How many real timings it takes to count as much as your starter estimate. Higher learns more slowly; 0 trusts the line from the first timing.' },
    { key: 'minFactor', name: 'Learned time never below', min: 0.1, max: 1, step: 0.05, unit: 'times the starter time', mean: 'The learned prep time cannot fall under this share of your starter estimate.' },
    { key: 'maxFactor', name: 'Learned time never above', min: 1, max: 10, step: 0.25, unit: 'times the starter time', mean: 'The learned prep time cannot rise over this many times your starter estimate.' },
    { key: 'outlierFactor', name: 'Ignore a timing longer than', min: 1, max: 20, step: 0.5, unit: 'times the starter time', mean: 'A timing longer than this is cut back to this length before it is learned from, so one forgotten tap cannot skew the estimate.' },
  ];

  // Panel 4: the on/off switch and seven numbers, each inside the engine's range.
  function buildPacing(P) {
    const pn = panel(SECTIONS[3], 'Finish together times all the items for a plate to finish together: the slowest item starts first, and quicker items are held back until it is time to start them. Rush tickets skip pacing and send every item to its station at once.');
    const status = statusLine();
    const on = !!((cur() || {}).settings.pacing || {}).enabled;
    const tog = SB.ui.toggle({
      label: 'Finish together', checked: on,
      // Turns pacing on or off; tickets already on the board keep the plan they were made with.
      onChange: (v) => {
        const r = send('updateSettings', { patch: { pacing: { enabled: v } } });
        if (good(r)) status.ok(v ? 'Finish together is on. New tickets are timed to finish together; tickets already on the board keep the plan they were made with.' : 'Finish together is off. New tickets send every item to its station at once.');
        else { tog.setValue(!v); status.bad(refusal(r, { name: 'Finish together' })); }
      },
    });
    tog.id = 'od-pacing-toggle';
    pn.body.append(h('div', { class: 'od-toggle-row' }, tog), status.el);

    const grid = h('div', { class: 'od-fgrid' });
    const fields = PACING.map((p) => {
      const path = 'pacing.' + p.key;
      const toUi = p.pct ? (v) => Math.round(v * 100) : undefined;
      const fromUi = p.pct ? (u) => Math.round(u) / 100 : undefined;
      const meta = { name: p.name, unit: p.unit, toUi };
      META[path] = meta;
      const f = numField({
        label: p.name, value: ((cur() || {}).settings.pacing || {})[p.key], min: p.min, max: p.max, step: p.step, big: p.big, unit: p.unit, meta, toUi, fromUi,
        hint: p.mean + ' Allowed: ' + num(p.min) + ' to ' + num(p.max) + (p.unit === '%' || p.unit === '\u00d7' ? p.unit : ' ' + p.unit) + '.',
        // Each pacing number saves as a settings patch and says it applies to new tickets.
        save: (v) => saveSetting(path, v, 'Saved. ' + p.name + ' is now ' + showVal(meta, v) + '. New tickets use it.', meta), onSaved: (t) => status.ok(t),
      });
      grid.appendChild(f.el);
      return { f, p };
    });
    const resetBtn = btn('Reset to starter values', { icon: 'refresh', cls: 'btn-sm' });
    resetBtn.addEventListener('click', () => {
      const patch = { pacing: {} };
      PACING.forEach((p) => { patch.pacing[p.key] = C.pacing[p.key]; });
      const r = send('updateSettings', { patch });
      if (r.report === 'ok') status.ok('Saved. The Finish together numbers are back to the starter values. The on/off switch is unchanged.');
      else if (r.report === 'nothingToDo') status.ok('Already at the starter values.');
      else status.bad(refusal(r, null));
    });
    pn.body.append(grid, h('div', { class: 'od-actions' }, resetBtn));
    P.syncs.push((s) => { tog.setValue(!!s.settings.pacing.enabled); fields.forEach(({ f, p }) => f.sync(s.settings.pacing[p.key])); });
    P.disposers.push(() => fields.forEach(({ f }) => f.destroy()), () => status.destroy());
    return pn;
  }

  // 5. Food safety limits (only inside SB.config.safetyBounds; the engine refuses the rest and names the key)
  // Safety fields: settings key, label, unit, step, big step (0 = none), whether the legal limit is a minimum or a
  // maximum, and what it means. The allowed range comes from SB.config.safetyBounds.
  const SAFETY_FIELDS = [
    { key: 'hotHoldF', name: 'Hot hold temperature', unit: '°F', step: 1, big: 5, legal: 'min', mean: 'Hot food has to stay at or above this.' },
    { key: 'coldHoldF', name: 'Cold hold temperature', unit: '°F', step: 1, big: 0, legal: 'max', mean: 'Cold food has to stay at or below this.' },
    { key: 'reheatF', name: 'Reheat to', unit: '°F', step: 1, big: 5, legal: 'min', mean: 'A reheated batch has to reach this reading.' },
    { key: 'belowHotGraceH', name: 'Time allowed below hot hold', unit: 'hours', step: 0.5, legal: 'max', mean: 'Food can sit below hot hold this long before it must be thrown out. A reheat is only allowed inside this window.' },
    { key: 'aboveColdGraceH', name: 'Time allowed above cold hold', unit: 'hours', step: 0.5, legal: 'max', mean: 'Cold food can sit above cold hold this long before it must be thrown out.' },
    { key: 'defaultMaxHoldH', name: 'Hold limit for a product with none of its own', unit: 'hours', step: 0.5, mean: 'Every starter product has its own limit; this is only used for one that has not.' },
    { key: 'hardCapH', name: 'Longest any batch may stay', unit: 'hours', step: 0.5, mean: 'At this age any batch is thrown out, whatever its limit kind. A product whose own limit is at or above it has no quality stage: it is thrown out at the cap.' },
    { key: 'tempCheckEveryMin', name: 'Temperature check every', unit: 'min', step: 5, mean: 'A temperature reading is due this often for every batch.' },
    { key: 'sanitizeEveryH', name: 'Sanitize food-contact surfaces every', unit: 'hours', step: 0.5, legal: 'max', mean: 'The sanitize timer on the line counts down from this.' },
  ];
  // Cooling fields have no entry in safetyBounds, so they carry their own range (test group 15 checks it against
  // the engine).
  const COOLING_FIELDS = [
    { key: 'cooling.stage1ToF', name: 'First cooling stage: cool to', unit: '°F', min: 41, max: 70, step: 1, mean: 'Hot food has to fall to this temperature in the first stage.' },
    { key: 'cooling.stage1H', name: 'First cooling stage: within', unit: 'hours', min: 0.5, max: 2, step: 0.5, mean: 'How long the first stage may take.' },
    { key: 'cooling.totalH', name: 'Total cooling time', unit: 'hours', min: 1, max: 6, step: 0.5, mean: 'Food has to be fully cooled within this time from the start, and longer than the first stage.' },
    { key: 'cooling.finalF', name: 'Cool all the way to', unit: '°F', min: 33, max: 41, step: 1, mean: 'The final cooling target.' },
  ];
  // The legal reason shown under a field and added to its refusal.
  const LEGAL_NOTE = {
    hotHoldF: 'The model Food Code sets 135\u00a0°F as the minimum for hot holding. Your local health code applies and may be stricter (some states use 140).',
    reheatF: 'The FDA Food Code sets 165 °F as the minimum reheat target. Your local health code applies.',
    coldHoldF: 'The FDA Food Code sets 41 °F as the maximum for cold holding. Your local health code applies.',
    belowHotGraceH: 'Our starting value is 2 hours; the model Food Code sets no fixed limit here. Set the limit your local health department gives you.', aboveColdGraceH: 'Our starting value is 4 hours; the model Food Code sets no fixed limit here. Set the limit your local health department gives you.', sanitizeEveryH: 'Our starting value is 4 hours. Set the limit your local health department gives you.',
  };

  // Panel 5: food-safety limits, always inside the legal bounds, with the legal note shown.
  function buildSafety(P) {
    const pn = panel(SECTIONS[4]);
    pn.body.append(
      h('p', { class: 'od-safetyline' }, ico('shield-check', 20), h('span', null, C.safetyLine)),
      para('Smokebox refuses a hot-hold limit below 135\u00a0°F (the model Food Code minimum; your local health code applies and may be stricter), and it refuses any limit outside the range shown under each field, naming the one that is wrong. These limits drive the hold cabinet, the temperature checks and the sanitize timer. A change applies from the next check on; batches already in the cabinet are re-checked against it.', 'od-intro'));
    const status = statusLine();
    // Builds one safety field from its spec and the bounds in the config. Returns {f, path}.
    const mk = (spec, path, legalKey) => {
      const bounds = C.safetyBounds[spec.key];
      const lo = spec.min != null ? spec.min : bounds[0], hi = spec.max != null ? spec.max : bounds[1];
      const unitText = spec.unit === '°F' ? ' °F' : ' ' + spec.unit;
      const legalNote = LEGAL_NOTE[legalKey];
      const meta = { name: spec.name, unit: spec.unit, legalNote };
      // Cross-field wording: the first cooling stage has to be shorter than the total.
      if (path === 'safety.cooling.stage1H') meta.words = (info) => (info.key !== path ? 'The first stage has to be shorter than the total cooling time (' + num(((cur() || {}).settings.safety.cooling || {}).totalH) + ' hours). Raise the total first.' : null);
      // Cross-field wording: the total cooling time has to be longer than the first stage.
      if (path === 'safety.cooling.totalH') meta.words = (info) => (info.min > lo ? 'The total cooling time has to be longer than the first stage (' + num(((cur() || {}).settings.safety.cooling || {}).stage1H) + ' hours): ' + num(info.min) + ' hours or more.' : null);
      META[path] = meta;
      const startOnly = /GraceH$|sanitizeEveryH$/.test(spec.key);
      const legalWord = startOnly ? ' Our starting value; set the limit your local health department gives you.' : spec.legal === 'min' ? ' Model Food Code minimum ' + lo + unitText + '.' : spec.legal === 'max' ? ' Model Food Code maximum ' + hi + unitText + '.' : '';
      const start = getPath((cur() || {}).settings, path);
      const f = numField({
        label: spec.name, value: start, min: lo, max: hi, step: spec.step, big: spec.big || 0, unit: spec.unit, meta, hint: spec.mean + ' Allowed: ' + num(lo) + ' to ' + num(hi) + unitText + '.' + legalWord,
        // Limits save as settings; the engine enforces the legal bounds and names the field it refused.
        save: (v) => saveSetting(path, v, 'Saved. ' + spec.name + ' is now ' + num(v) + unitText + '.', meta), onSaved: (t) => status.ok(t),
      });
      return { f, path };
    };
    const gridA = h('div', { class: 'od-fgrid' }), gridB = h('div', { class: 'od-fgrid' });
    const all = [];
    SAFETY_FIELDS.forEach((sp) => { const x = mk(sp, 'safety.' + sp.key, sp.key); gridA.appendChild(x.f.el); all.push(x); });
    COOLING_FIELDS.forEach((sp) => { const x = mk(sp, 'safety.' + sp.key, null); gridB.appendChild(x.f.el); all.push(x); });
    // Says which cooked products have no quality stage at the current hard cap, and flags the cold starters to check.
    const qLine = para('', 'od-hint');
    // Rewrites that line from the current settings and products.
    const paintQ = (s) => {
      const names = SB.engine.noQualityStage(s);
      const flagged = s.ingredients.filter((i) => i.tcs && i.confirmBasis).map((i) => i.name);
      qLine.textContent = (names.length ? 'Products with no quality stage at this cap (thrown out when they reach their limit): ' + names.join(', ') + '. ' : 'Every cooked product has a quality stage at this cap. ') +
        (flagged.length ? 'Owner to confirm: ' + flagged.join(', ') + ' start with a quality limit; if you hold them outside temperature control, set their limit kind to safety.' : '');
    };
    paintQ(cur());
    // Batch expiry warnings: when the board warns before a batch reaches its limit, per product. Empty means the built-in list.
    const ladderMeta = { name: 'Warning times', words: (info) => (info.min != null ? 'Each warning time is a whole number of minutes from ' + info.min + ' to ' + info.max + ', counting down, with at most 5 per product.' : 'Type minutes before the limit, biggest first, like 60, 30, 10. At most 5 times, each smaller than the one before.') };
    META['alerts.ladderThresholds'] = ladderMeta;
    const ladderRows = [];
    const ladderBox = h('div', { class: 'od-fgrid' });
    // Builds one warning-times row: the owner's list if any, else the built-in list as the hint.
    const mkLadder = (id, name) => {
      const input = h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Warning minutes for ' + name, dataset: { ing: id || 'default' } });
      const field = SB.ui.field({ label: name, control: input, hint: 'Built in: ' + SB.deadlines.rungsFor(id || '', null).join(', ') + ' minutes. Leave empty for the built-in list.' });
      // Reads the list typed, saves it through the settings (empty clears this row), and says what happened.
      const commit = () => {
        const txt = input.value.trim();
        const list = txt ? txt.split(/[\s,;]+/).filter(Boolean).map(Number) : null;
        const o = (cur().settings.alerts && cur().settings.alerts.ladderThresholds) || {};
        const next = { default: o.default, byIng: Object.assign({}, o.byIng) };
        if (id) { if (list) next.byIng[id] = list; else delete next.byIng[id]; } else next.default = list || undefined;
        if (!next.default) delete next.default;
        if (!Object.keys(next.byIng).length) delete next.byIng;
        const r = saveSetting('alerts.ladderThresholds', Object.keys(next).length ? next : null, 'Saved. ' + name + ' warns ' + (list ? list.join(', ') + ' minutes before the limit.' : 'at the built-in times.'), ladderMeta);
        if (r.ok) status.ok(r.text); else { status.bad(r.text); paintLadder(cur()); }
      };
      input.addEventListener('change', commit);
      ladderRows.push({ id, input });
      ladderBox.appendChild(field.el || field);
    };
    // Shows the saved lists in the boxes.
    const paintLadder = (s) => {
      const o = (s.settings.alerts && s.settings.alerts.ladderThresholds) || {};
      for (const r of ladderRows) { const v = r.id ? (o.byIng && o.byIng[r.id]) : o.default; if (document.activeElement !== r.input) r.input.value = v ? v.join(', ') : ''; }
    };
    mkLadder(null, 'All other products');
    cur().ingredients.filter((i) => i.tcs).forEach((i) => mkLadder(i.id, i.name));
    paintLadder(cur());
    P.syncs.push(paintLadder);
    pn.body.append(status.el, gridA, qLine, sub('Batch expiry warnings only'), para('How many minutes before a batch reaches its limit the board warns, loudest at the last time. This changes the warnings, never the limits or the food-safety rules: the last warning cannot be under 5 minutes.', 'od-hint'), ladderBox, sub('Cooling stages'), para('Cooked food that is not going into the cabinet has to be cooled in two stages.', 'od-hint'), gridB);
    P.syncs.push((s) => { all.forEach(({ f, path }) => f.sync(getPath(s.settings, path))); paintQ(s); });
    P.disposers.push(() => all.forEach(({ f }) => f.destroy()), () => status.destroy());
    return pn;
  }

  // Panel 6: set, change or remove the manager PIN, with an honest note that it is not real security.
  function buildPin(P) {
    const pn = panel(SECTIONS[5]);
    pn.body.append(
      para('This keeps line cooks out of the back office. It is not real security: anyone with the file or the device can read the data.', 'od-intro'),
      para('After you leave the back office it stays open for 2 minutes without asking, so a quick return does not need the PIN. A backup file contains the PIN lock too, so restoring a backup also restores its PIN.', 'od-hint'));
    const stateEl = h('p', { class: 'od-pinstate', role: 'status' });
    const actions = h('div', { class: 'od-actions' });
    const formHost = h('div', { class: 'od-pinhost' });
    pn.body.append(stateEl, actions, formHost);
    let mode = null;

    // True when a PIN is set; false if the shell cannot say.
    const hasPin = () => { try { return !!(SB.shell && SB.shell.hasPin && SB.shell.hasPin()); } catch (e) { return false; } };
    // Builds a four-digit PIN input that drops anything that is not a digit.
    const mkPin = (label) => {
      const input = h('input', { class: 'input od-pin-in', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'off', spellcheck: 'false' });
      input.addEventListener('input', () => { const v = input.value.replace(/\D/g, '').slice(0, 4); if (v !== input.value) input.value = v; });
      const field = SB.ui.field({ label, control: input, hint: '4 digits' });
      return { input, field };
    };
    // Closes the PIN form and shows the buttons again.
    function closeForm() { mode = null; U.clear(formHost); paint(); }
    // Opens the form for setting, changing or removing the PIN. The shell checks and stores the PIN.
    function openForm(m) {
      mode = m; U.clear(formHost);
      const cur0 = m !== 'set' ? mkPin('Current PIN') : null;
      const n1 = m !== 'clear' ? mkPin('New PIN') : null;
      const n2 = m !== 'clear' ? mkPin('Type the new PIN again') : null;
      const err = h('div', { class: 'od-ferr', role: 'alert', hidden: true });
      // Shows a message at the bottom of the PIN form.
      const showErr = (t) => { err.replaceChildren(ico('alert-circle', 16), h('span', null, t)); err.hidden = false; };
      const submit = btn(m === 'set' ? 'Set PIN' : m === 'change' ? 'Change PIN' : 'Remove PIN', { icon: 'lock', cls: m === 'clear' ? 'btn-danger' : 'btn-primary' });
      submit.type = 'submit';
      const cancel = btn('Cancel', { onClick: closeForm });
      const form = h('form', { class: 'od-pinform', novalidate: true, 'aria-label': m === 'set' ? 'Set a PIN' : m === 'change' ? 'Change the PIN' : 'Remove the PIN' },
        cur0 && cur0.field, n1 && n1.field, n2 && n2.field, err, h('div', { class: 'od-actions' }, submit, cancel));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        [cur0, n1, n2].forEach((x) => x && x.field.setError(null)); err.hidden = true;
        if (cur0) {
          if (!/^\d{4}$/.test(cur0.input.value)) { cur0.field.setError('Enter the current 4-digit PIN.'); cur0.input.focus(); return; }
          let ok = false;
          try { ok = await SB.shell.checkPin(cur0.input.value); } catch (e) { ok = false; }
          if (!ok) { cur0.field.setError('That is not the current PIN. Nothing was changed.'); cur0.input.value = ''; cur0.input.focus(); return; }
        }
        let pin = null;
        if (m !== 'clear') {
          if (!/^\d{4}$/.test(n1.input.value)) { n1.field.setError('Use exactly 4 digits.'); n1.input.focus(); return; }
          if (n1.input.value !== n2.input.value) { n2.field.setError('The two entries do not match. Type the same 4 digits twice.'); n2.input.focus(); return; }
          pin = n1.input.value;
        }
        let res;
        try { res = await SB.shell.setPin(pin, { verified: true }); } catch (e) { res = { ok: false, report: 'error' }; }
        if (res && res.ok) {
          closeForm();
          SB.ui.toast(pin ? (m === 'set' ? 'PIN set. The back office will ask for it next time.' : 'PIN changed. The back office will ask for the new one next time.') : 'PIN removed. The back office opens without asking.', { tone: 'ok' });
        } else if (res && res.report === 'nothingToDo') showErr('That is already the PIN. Nothing was changed.');
        else showErr((res && res.message) || (res && res.report && SB.engine.describe(res.report, {}, (cur() || {}).settings)) || 'The PIN could not be saved. Try again.');
      });
      formHost.appendChild(form);
      actions.hidden = true;
      (cur0 || n1).input.focus();
    }
    // Redraws the PIN state text and the buttons that fit it.
    function paint() {
      const has = hasPin();
      stateEl.textContent = has ? 'A PIN is set. The back office asks for it when it opens.' : 'No PIN is set. Anyone who opens the back office sees everything.';
      stateEl.dataset.tone = has ? 'ok' : 'warn';
      if (mode) { actions.hidden = true; return; }
      actions.hidden = false;
      actions.replaceChildren();
      // Change and Remove open the form; both ask for the current PIN first.
      if (has) actions.append(btn('Change PIN', { icon: 'lock', onClick: () => openForm('change') }), btn('Remove PIN', { icon: 'unlock', onClick: () => openForm('clear') }));
      else actions.append(btn('Set a PIN', { icon: 'lock', cls: 'btn-primary', onClick: () => openForm('set') }));
    }
    P.syncs.push(() => { if (mode && (mode === 'set') === hasPin()) { closeForm(); return; } paint(); }); // a PIN set or cleared in another tab invalidates an open form
    paint();
    return pn;
  }

  // Panel 7: themes, text size, sound and service hours.
  function buildLook(P) {
    const pn = panel(SECTIONS[6], 'Display choices are remembered on this device only.');
    // Builds the two options of a two-way switch, and one labelled switch with its hint.
    const themeOpts = (a, b) => [{ id: a[0], label: a[1] }, { id: b[0], label: b[1] }];
    const mkSeg = (label, hint, opts, get, set) => {
      // Applies the choice and tells screen readers what changed.
      const seg = SB.ui.segmented({ label, options: opts, value: get(), onChange: (v) => { set(v); SB.ui.announce(label + ': ' + v); } });
      const lid = U.uid('odl');
      const wrap = h('div', { class: 'od-setting' }, h('div', { class: 'od-lab', id: lid }, label), seg, hint ? h('p', { class: 'od-hint' }, hint) : null);
      seg.setAttribute('aria-labelledby', lid);
      return { wrap, seg, get };
    };
    // Saves a unit choice (temperature or weight) in the settings and redraws the back office numbers.
    const saveUnit = (key, v) => { const r = send('updateSettings', { patch: { ui: { [key]: v } } }); if (good(r)) { try { if (SB.office && SB.office.refresh) SB.office.refresh(); } catch (e) { /* the next refresh catches up */ } } };
    const segs = [
      mkSeg('Day or Night', 'Day is the light, anti-glare look for bright kitchens, Night is dark for a dim prep corner. The board, these pages and every chart follow it.', themeOpts(['day', 'Day'], ['night', 'Night']), () => SB.theme.get(), (v) => SB.theme.set(v)),
      mkSeg('Text size', 'Large makes all text about 20% bigger on the line and in the back office.', themeOpts(['normal', 'Normal'], ['large', 'Large']), () => SB.theme.textSize(), (v) => SB.theme.setTextSize(v)),
      mkSeg('Temperatures', 'Shows temperatures in Fahrenheit or Celsius. The limits on the Food safety page are always entered in °F.', themeOpts(['F', '°F'], ['C', '°C']), () => ((cur() || {}).settings.ui || {}).tempUnit || 'F', (v) => saveUnit('tempUnit', v)),
      mkSeg('Weights', 'Shows food weights in kilograms and grams, or in pounds and ounces. Amounts you type on the Ingredients page are still in grams.', themeOpts(['kg', 'kg and g'], ['lb', 'lb and oz']), () => ((cur() || {}).settings.ui || {}).weightUnit || 'kg', (v) => saveUnit('weightUnit', v)),
    ];
    const status = statusLine();
    const hasSound = !!(SB.floor && typeof SB.floor.setSound === 'function');
    // Reads the floor's sound flag; false if the floor cannot say.
    const soundNow = () => { try { return !!(SB.floor && typeof SB.floor.sound === 'function' && SB.floor.sound()); } catch (e) { return false; } };
    const sound = hasSound ? SB.ui.toggle({
      label: 'Sound on the line', checked: soundNow(),
      // Switches the sound; a failure puts the switch back and says so.
      onChange: (v) => {
        try { SB.floor.setSound(v); status.ok(v ? 'Sound is on. You should have heard a chime; alert sounds play for new and overdue tickets.' : 'Sound is off.'); }
        catch (e) { sound.setValue(!v); status.bad('Could not change the sound. Reload and try again.'); }
      },
    }) : null;
    const grid = h('div', { class: 'od-settings' }, segs.map((x) => x.wrap), sound ? h('div', { class: 'od-setting' }, sound, h('p', { class: 'od-hint' }, 'A chime for each new ticket. Needs speakers or headphones on this device. It is remembered on this device only.')) : null, status.el);
    pn.body.appendChild(grid);

    pn.body.appendChild(sub('Service hours'));
    pn.body.appendChild(para('The charts and the sell-out clock measure against these hours. Use whole hours on the 24-hour clock; a closing time past 24 means after midnight.', 'od-hint'));
    const sst = statusLine();
    const hours = [
      { key: 'dayStartHour', name: 'Service day starts at', min: 0, max: 8, mean: 'A sale rung up before this hour counts toward the day before. A 12:45 am sale still belongs to last night.' },
      { key: 'openHour', name: 'Opens at', min: 0, max: 23, mean: 'The first hour of service.' },
      { key: 'closeHour', name: 'Closes at', min: 1, max: 30, mean: 'The last hour of service. 25 means 1 am the next day.' },
      { key: 'soundStartHour', name: 'Warnings start at', min: 0, max: 23, mean: 'Warning sounds start at this hour, or at opening if that is earlier. Set it to when the pit master starts. Before it the strip says sound is paused.' },
    ];
    const hgrid = h('div', { class: 'od-fgrid' });
    const hf = hours.map((p) => {
      const path = 'service.' + p.key;
      // Shows an hour as clock text in refusal messages.
      const meta = { name: p.name, fmt: (v) => hourWords(v) };
      // Cross-field wording: opening has to be before closing, and closing after opening.
      if (p.key === 'openHour') meta.words = (info) => (info.key !== path ? 'Opening has to be before closing (' + hourWords((cur() || {}).settings.service.closeHour) + '). Move the closing time first.' : null);
      if (p.key === 'closeHour') meta.words = (info) => (info.min > p.min ? 'Closing has to be after opening (' + hourWords((cur() || {}).settings.service.openHour) + '): ' + hourWords(info.min) + ' or later.' : null);
      META[path] = meta;
      const f = numField({
        // Each hour field shows the clock time beside the number.
        label: p.name, value: (cur() || {}).settings.service[p.key], min: p.min, max: p.max, step: 1, unit: 'h', meta, read: (u) => hourWords(u), hint: p.mean,
        // Service hours save as settings and confirm in words.
        save: (v) => saveSetting(path, v, 'Saved. ' + p.name + ' ' + hourWords(v) + '.', meta), onSaved: (t) => sst.ok(t),
      });
      hgrid.appendChild(f.el);
      return { f, p };
    });
    // Lets warning sounds play at any hour, not only between the start hour and closing.
    const outTog = SB.ui.toggle({
      label: 'Warnings may sound outside open hours', checked: !!((cur() || {}).settings.service || {}).soundOutsideHours,
      // Saves the choice as a service setting and confirms it in words.
      onChange: (v) => {
        const r = send('updateSettings', { patch: { service: { soundOutsideHours: v } } });
        if (good(r)) sst.ok(v ? 'Warnings may now sound at any hour.' : 'Warnings sound only from the start hour to closing.');
        else { outTog.setValue(!v); sst.bad(refusal(r, { name: 'Sound outside open hours' })); }
      },
    });
    pn.body.append(hgrid, h('div', { class: 'od-toggle-row' }, outTog), sst.el);

    // Sales tax: one rate that is added to every order when it is paid.
    pn.body.appendChild(sub('Sales tax'));
    pn.body.appendChild(para('Added on top of the food when an order is paid, and shown in Money collected. Leave it at 0 if your menu prices already include tax, and ask your tax office for the right rate.', 'od-hint'));
    const tst = statusLine();
    // How a tax rate is written in a refusal message, like 6.5%.
    const taxFmt = (v) => v + '%';
    const taxMeta = { name: 'Sales tax', fmt: taxFmt };
    META['service.taxRatePct'] = taxMeta;
    const taxF = numField({
      label: 'Sales tax rate', value: ((cur() || {}).settings.service.taxRatePct) || 0, min: 0, max: 20, step: 0.25, unit: '%', meta: taxMeta,
      // The reading beside the box says whether any tax is added.
      read: (u) => (u > 0 ? 'added to every order' : 'no tax added'),
      // The rate saves as a setting and confirms in words.
      save: (v) => saveSetting('service.taxRatePct', v, v > 0 ? 'Saved. Orders now add ' + v + '% sales tax.' : 'Saved. Orders add no sales tax.', taxMeta), onSaved: (t) => tst.ok(t),
    });
    pn.body.append(h('div', { class: 'od-fgrid' }, taxF.el), tst.el);

    // Re-reads the theme choices when another tab or the shell changes them.
    const themeSync = () => segs.forEach((x) => x.seg.setValue(x.get()));
    const off = SB.theme && SB.theme.onChange ? SB.theme.onChange(themeSync) : null;
    P.syncs.push((s) => { themeSync(); if (sound) sound.setValue(soundNow()); hf.forEach(({ f, p }) => f.sync(s.settings.service[p.key])); taxF.sync(s.settings.service.taxRatePct || 0); });
    P.disposers.push(() => { if (off) off(); }, () => hf.forEach(({ f }) => f.destroy()), () => taxF.destroy(), () => status.destroy(), () => sst.destroy(), () => tst.destroy());
    pn.body.appendChild(buildNames());
    return pn;
  }

  // Builds the "Names" section: rename stations, menu categories and order channels, or add one of each.
  // Choices are saved in this browser by SB.config.saveCustom and show on every screen after a reload.
  function buildNames() {
    const wrap = h('div', { class: 'od-names' });
    wrap.appendChild(sub('Station, category and channel names'));
    wrap.appendChild(para('Rename a station, a menu category or an order channel, or add a new one. Ids and history never change, only what people read. Changes show on every screen after you reload. Backups carry these names, and restoring a backup puts them back.', 'od-hint'));
    const status = statusLine();
    // Reloads the page so every screen picks up the saved names.
    const reload = btn('Reload to apply', { icon: 'refresh', cls: 'btn-sm', onClick: () => g.location.reload() });
    reload.hidden = true;
    // Writes a changed spec to storage, checks it against the rules first, and says what happened.
    function commit(mutate) {
      const spec = JSON.parse(JSON.stringify(C.customSpec()));
      spec.rename = spec.rename || {}; spec.add = spec.add || {};
      mutate(spec);
      // Dry run on a copy of the lists: any rejected entry means nothing is saved.
      const before = C.customSpec();
      const res = C.applyCustom(spec);
      C.applyCustom(before);
      if (res.rejected.length) { status.bad('That name cannot be used: it is empty, longer than ' + C.customLimits.name + ' letters, already taken, or the list is full.'); return false; }
      if (!C.saveCustom(spec)) { status.bad('This browser would not save the change.'); return false; }
      // The board redraws with the new names at once; only a build without that call asks for a reload.
      if (SB.floor && typeof SB.floor.refreshNames === 'function' && SB.floor.refreshNames()) status.ok('Saved. The new names show everywhere now.');
      else { status.ok('Saved. Reload the page to see it everywhere.'); reload.hidden = false; }
      return true;
    }
    const groups = [
      // The stations that receive items (expo only sees whole tickets, so it keeps its name).
      { k: 'zones', title: 'Stations', noun: 'station', list: () => C.zones.filter((z) => z.id !== 'expo') },
      // Every menu category, which can be renamed or added to.
      { k: 'categories', title: 'Menu categories', noun: 'category', list: () => C.categories },
      // Every order channel, which can be renamed or added to.
      { k: 'channels', title: 'Order channels', noun: 'channel', list: () => C.channels },
    ];
    for (const grp of groups) {
      const rows = h('div', { class: 'od-fgrid' });
      for (const e of grp.list()) {
        const input = h('input', { class: 'input', type: 'text', maxlength: C.customLimits.name, value: e.name, 'aria-label': 'Name of ' + grp.noun + ' ' + e.name });
        // Saves the new name for this entry when the button is pressed.
        const save = btn('Rename', { cls: 'btn-sm', onClick: () => commit((sp) => { sp.rename[grp.k] = Object.assign({}, sp.rename[grp.k], { [e.id]: input.value }); }) });
        rows.appendChild(h('div', { class: 'od-field' }, input, save));
      }
      const addIn = h('input', { class: 'input', type: 'text', maxlength: C.customLimits.name, placeholder: 'New ' + grp.noun + ' name', 'aria-label': 'New ' + grp.noun + ' name' });
      // Adds one new entry of this kind, named as typed.
      const addBtn = btn('Add ' + grp.noun, { icon: 'plus', cls: 'btn-sm', onClick: () => { if (commit((sp) => { sp.add[grp.k] = (sp.add[grp.k] || []).concat([{ name: addIn.value }]); })) addIn.value = ''; } });
      wrap.append(h('h4', { class: 'od-sub' }, grp.title), rows, h('div', { class: 'od-field' }, addIn, addBtn));
    }
    wrap.append(status.el, reload);
    return wrap;
  }

  // Saves a file: the host's download capability first (Claude artifact viewer), then a plain browser
  // download. A decline is final and never retried; the caller can always offer copy or paste. Returns {how:
  // 'host' | 'declined' | 'browser' | 'blocked'}.
  async function saveFile(filename, text, mime) {
    let d = null;
    try { d = g.claude && typeof g.claude.use === 'function' ? await g.claude.use('downloads') : null; } catch (e) { d = null; }
    if (d) {
      try { const r = await d.save({ filename, data: text }); return { how: 'host', status: r && r.status }; }
      catch (e) { if (e && e.code === 'declined') return { how: 'declined' }; /* any other failure falls through to the browser path */ }
    }
    try {
      const blob = new Blob([text], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
      doc.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
      return { how: 'browser' };
    } catch (e) { return { how: 'blocked' }; }
  }

  // 8. Data: what is stored, sample history, export, import, reset
  const SAMPLE_NOTE = 'Sample history is 14 days generated by the app; it is not your restaurant\'s data. Days 1 to 5 run without Finish together and days 6 to 14 with it so you can see the difference.';

  // Turns a backup check error into a sentence a cook can understand.
  function backupReason(err) {
    const e = String(err || '');
    if (/^not JSON/.test(e)) return 'The text could not be read: it is probably not a Smokebox backup, or it was cut off.';
    if (/^not an object/.test(e)) return 'It is not a Smokebox backup (the top level is not a record).';
    if (/^unsupported version undefined/.test(e)) return 'It does not say which Smokebox version made it, so it is probably not a backup.';
    if (/^unsupported version/.test(e)) return 'It was made by a different Smokebox version (' + e.replace('unsupported version ', 'version ') + ').';
    if (/^missing /.test(e)) return 'It has no ' + e.replace('missing ', '') + ' list, so it is not a Smokebox backup.';
    if (/^too large/.test(e)) return 'It is bigger than Smokebox can load (20 MB).';
    if (/^inconsistent/.test(e)) return 'Its records contradict each other (' + e.replace('inconsistent: ', '') + '), so loading it could corrupt the board.';
    return 'It could not be read (' + e + ').';
  }
  // Reads a chosen file as text. Returns a promise.
  const readFileText = (file) => new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      // Resolve with the text, or reject when the file cannot be read.
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('read failed'));
      fr.readAsText(file);
    } catch (e) { reject(e); }
  });
  // Checks a backup text without touching the live state. Returns {ok: false, reason} or
  // {ok: true, text, state, repaired, savedAt, bySrc}.
  function inspectBackup(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'There is nothing in it. Choose a backup file or paste the backup text.' };
    if (text.length > MAX_IMPORT_CHARS) return { ok: false, reason: backupReason('too large') };
    let env;
    try { env = JSON.parse(text); } catch (e) { return { ok: false, reason: backupReason('not JSON') }; }
    // A compact save (fmt 2) is unpacked first, the same way the restore itself reads it, so the check and the restore agree.
    if (env && typeof env === 'object' && env.fmt !== undefined && SB.store.decodeSaved) {
      env = SB.store.decodeSaved(env);
      if (!env.state) return { ok: false, reason: 'It is a compact Smokebox save that cannot be read, so it cannot be restored.' };
    }
    const v = SB.engine.validateBackup(env);
    if (!v.ok) return { ok: false, reason: backupReason(v.error) };
    const bySrc = { live: 0, demo: 0, sample: 0 };
    for (const t of v.state.tickets) bySrc[t.src] = (bySrc[t.src] || 0) + 1;
    return { ok: true, text, state: v.state, repaired: v.repaired || [], savedAt: env && isNum(env.savedAt) ? env.savedAt : null, mode: env && env.mode === 'demo' ? 'demo' : 'real', bySrc };
  }

  // Builds the Danger zone of the Data page (the two erase buttons and the typed-word box that guards them) into the panel; it makes the pieces the page cleans up and returns the two status lines.
  function buildDangerZone(env) {
    const { pn, stateNow } = env;
    // Danger zone: two reset buttons, each opening a box that asks for a typed word before it will act.
    pn.body.appendChild(h('h3', { class: 'od-sub od-danger-h', id: undefined }, 'Danger zone: erase data'));
    const resetStatus = statusLine();
    const keep = SB.ui.toggle({ label: 'Keep my dishes, settings and PIN when I erase tickets and records', checked: true });
    const resetLiveBtn = btn('Erase tickets and records', { icon: 'trash', cls: 'btn-danger' });
    resetLiveBtn.dataset.action = 'reset-live';
    const resetAllBtn = btn('Erase everything', { icon: 'trash', cls: 'btn-danger' });
    resetAllBtn.dataset.action = 'reset-all';
    const dangerBox = h('div', { class: 'od-danger-box', hidden: true, role: 'group', 'aria-label': 'Confirm erasing data' });
    // Shows the confirm box: what will be erased, a field to type the word into, and a button that stays off until it matches.
    function askTyped(o) {
      const BPr = SB.office && SB.office.backupPure;
      const input = h('input', { class: 'input od-danger-in', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Type ' + o.word + ' to confirm' });
      const go = btn(o.label, { icon: 'trash', cls: 'btn-danger' });
      go.disabled = true;
      // Turns the confirm button on only when the word was typed.
      const sync = () => { go.disabled = !(BPr ? BPr.resetWordOk(input.value, o.word) : input.value.trim().toLowerCase() === o.word.toLowerCase()); };
      input.addEventListener('input', sync);
      // Closes the box without doing anything.
      const cancel = () => { dangerBox.hidden = true; dangerBox.replaceChildren(); if (o.opener && o.opener.focus) o.opener.focus(); };
      // Runs the erase once, then closes the box.
      const run = () => { if (go.disabled) return; cancel(); o.run(); };
      go.addEventListener('click', run);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      // Escape anywhere in the box closes only the box (the page-wide Escape would otherwise leave the back office) and gives focus back to the erase button.
      dangerBox.onkeydown = (e) => { if (e.key === 'Escape' && !dangerBox.hidden) { e.preventDefault(); e.stopPropagation(); cancel(); } };
      const descId = U.uid('oddesc');
      input.setAttribute('aria-describedby', descId);
      dangerBox.replaceChildren(h('p', { class: 'od-danger-t' }, ico('alert', 20), h('strong', null, o.title)), h('div', { id: descId }, ...o.lines.map((t) => h('p', { class: 'od-p' }, t))),
        h('label', { class: 'od-danger-l' }, 'Type ', h('strong', null, o.word), ' to confirm', input),
        h('div', { class: 'od-actions' }, go, btn('Keep my data', { onClick: cancel })));
      dangerBox.hidden = false;
      input.focus();
    }
    // Opens the typed confirm box for clearing live data.
    resetLiveBtn.addEventListener('click', () => {
      const s = stateNow(), k = keep.getValue();
      askTyped({
        opener: resetLiveBtn, title: 'Erase tickets and records?', word: 'ERASE', label: 'Erase tickets and records',
        lines: ['This clears ' + U.fmtNum(s.tickets.length) + ' ' + U.plural(s.tickets.length, 'ticket') + ', ' + U.fmtNum(SB.engine.allEvents(s).length) + ' saved records and ' + U.fmtNum(s.batches.length) + ' ' + U.plural(s.batches.length, 'batch', 'batches') + ' on this device, including any demo orders, and sets the clock back to real time.',
          (k ? 'Your dishes, ingredient edits, limits, Finish together and PIN stay as they are.' : 'It also puts every setting, dish edit and the PIN back to the starter values.') + ' The food safety record stays.',
          'There is no undo. Back up first if you might want this data.'],
        // Clears the live data after the word was typed.
        run: async () => {
          // With a PIN set, erasing asks for it again, even inside the back office grace period.
          if (SB.shell.requirePin && !(await SB.shell.requirePin())) { resetStatus.bad('The PIN was not entered. Nothing was erased.'); return; }
          const rep = SB.store.resetLive({ keepSettings: k, starter: false });
          if (rep === 'ok') { resetStatus.ok('Live data erased. The board is empty' + (k ? '; your settings were kept.' : '; settings are back to the starter values.')); SB.ui.toast('Live data erased.', { tone: 'ok' }); }
          else resetStatus.bad(SB.engine.describe(rep, (SB.store.lastResult() || {}).info, (stateNow() || {}).settings));
        },
      });
    });
    // Opens the typed confirm box for erasing everything.
    resetAllBtn.addEventListener('click', () => {
      const s = stateNow();
      askTyped({
        opener: resetAllBtn, title: 'Erase everything on this device?', word: 'ERASE', label: 'Erase everything',
        lines: ['This erases everything Smokebox stored on this device: ' + U.fmtNum(s.tickets.length) + ' ' + U.plural(s.tickets.length, 'ticket') + ', ' + U.fmtNum(s.batches.length) + ' ' + U.plural(s.batches.length, 'batch', 'batches') + ', your dishes and ingredient edits, every setting and the PIN. The board starts empty.',
          'Your display choices (themes and text size) are kept.', 'There is no undo. Back up first if you might want any of it back.'],
        // Erases everything after the word was typed.
        run: async () => {
          // With a PIN set, erasing asks for it again, even inside the back office grace period.
          if (SB.shell.requirePin && !(await SB.shell.requirePin())) { resetStatus.bad('The PIN was not entered. Nothing was erased.'); return; }
          const rep = SB.store.reset();
          if (rep === 'ok') { resetStatus.ok('Everything was reset to the starter values.'); SB.ui.toast('Everything was reset.', { tone: 'ok' }); }
          else resetStatus.bad(SB.engine.describe(rep, (SB.store.lastResult() || {}).info, (stateNow() || {}).settings));
        },
      });
    });
    pn.body.append(
      para('Erasing tickets and records removes tickets, records and batches. Erasing everything also puts the dishes, ingredients and every setting back to the starter values. Neither can be undone, so back up first (card 1 above).', 'od-p'),
      h('div', { class: 'od-toggle-row' }, keep),
      h('div', { class: 'od-actions' }, resetLiveBtn, resetAllBtn), dangerBox, resetStatus.el);
    return { resetStatus };
  }

  // Builds the restore card's working parts on the Data page (choose a file or paste text, check it, show what is inside, replace everything after a confirm and the PIN, and the way back from a restore) and returns what the page needs afterwards.
  function buildImportCard(env) {
    const { stateNow, card2, card3, downloadBackup, P } = env;
    // Import: a chosen file or pasted text is checked and summarized before anything changes.
    const impResult = h('div', { class: 'od-impresult', 'aria-live': 'polite' });
    const fileIn = h('input', { type: 'file', accept: '.json,application/json,text/plain', class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true', id: U.uid('odfile') });
    // Opens the system file picker for a backup.
    const chooseBtn = btn('Choose a backup file', { icon: 'upload', onClick: () => fileIn.click() });
    chooseBtn.dataset.action = 'import-choose';
    const undoBox = h('div', { class: 'od-undo-restore', 'data-region': 'undo-restore' });
    // Shows the way back from a restore: how long the old kitchen is kept and a button to put it back (PIN-guarded like the restore).
    function paintUndo() {
      const info = SB.store.beforeRestoreInfo ? SB.store.beforeRestoreInfo() : null;
      if (!info) { undoBox.replaceChildren(); undoBox.hidden = true; return; }
      undoBox.hidden = false;
      const days = Math.max(1, Math.round((info.expiresAt - info.takenAt) / 86400e3));
      // The button asks first, then puts the old kitchen back.
      const b = btn('Undo this restore', { icon: 'history', cls: 'btn-sm', onClick: () => undoRestoreNow() });
      b.dataset.action = 'undo-restore';
      undoBox.replaceChildren(
        h('p', { class: 'od-p od-undo-line' }, 'Your kitchen before this restore is kept for ' + days + ' ' + U.plural(days, 'day') + ' (until ' + U.fmtDateShort(U.dateKey(info.expiresAt)) + ' ' + U.fmtTime(info.expiresAt) + '). It was saved ' + U.fmtDateShort(U.dateKey(info.takenAt)) + ' ' + U.fmtTime(info.takenAt) + '.'),
        info.trimmed ? h('p', { class: 'od-hint' }, TRIMMED_WORDS) : null,
        h('div', { class: 'od-actions' }, b));
    }
    // After a confirm dialog and the PIN, puts the kitchen from before the restore back. Nothing changes if the PIN is not entered.
    async function undoRestoreNow() {
      const info = SB.store.beforeRestoreInfo ? SB.store.beforeRestoreInfo() : null;
      if (!info) { paintUndo(); return; }
      const ok = await SB.ui.confirm({ title: 'Undo this restore?', tone: 'danger', confirmLabel: 'Put my old kitchen back', cancelLabel: 'Keep what I have',
        body: ['This puts back the kitchen you had before the restore (saved ' + U.fmtDateShort(U.dateKey(info.takenAt)) + ' ' + U.fmtTime(info.takenAt) + ') and replaces what is here now. What is here now is kept for the same time, so this can be undone once too.'].concat(info.trimmed ? [TRIMMED_WORDS] : []) });
      if (!ok) return;
      if (SB.shell.requirePin && !(await SB.shell.requirePin())) { SB.ui.toast('The PIN was not entered. Nothing was changed.', { tone: 'warn' }); return; }
      const rep = SB.store.undoRestore();
      if (rep === 'ok') SB.ui.toast('Your kitchen from before the restore is back.', { tone: 'ok' });
      else SB.ui.toast(rep === 'noCopy' ? 'The copy from before the restore is gone, so nothing was changed.' : SB.engine.describe(rep, (SB.store.lastResult() || {}).info, (stateNow() || {}).settings), { tone: 'warn' });
      paintUndo();
    }
    // A copy that was set aside as unreadable (or by a newer build) can still be read: say what it holds and offer to bring it back or throw it away.
    const parkedBox = h('div', { class: 'od-parked', 'data-region': 'parked-copy' });
    const PARK_WORD = 'RESTORE';
    // Draws the set-aside copy card again, or nothing when no readable copy is set aside.
    function paintParked() {
      const pc = SB.store.parkedCopy ? SB.store.parkedCopy() : null;
      if (!pc || (SB.store.isHubClient && SB.store.isHubClient()) || (SB.store.isFollower && SB.store.isFollower())) { parkedBox.replaceChildren(); parkedBox.hidden = true; return; }
      parkedBox.hidden = false;
      let savedFirst = false;
      const status = h('p', { class: 'od-p', role: 'status' });
      const word = h('input', { class: 'input od-danger-in', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Type ' + PARK_WORD + ' to confirm' });
      const go = btn('Bring the set-aside copy back', { icon: 'upload', cls: 'btn-danger' }); go.dataset.action = 'parked-restore'; go.disabled = true;
      // The red button wakes only when the backup of what is here now was saved and the word was typed.
      const sync = () => { go.disabled = !(savedFirst && word.value.trim().toUpperCase() === PARK_WORD); };
      word.addEventListener('input', sync);
      // Saves a backup file of what is on this device now, so bringing the other copy back can never lose it.
      const saveFirst = btn('Save a backup of what is here now first', { icon: 'download', cls: 'btn-sm', onClick: () => {
        let text = null; try { text = SB.store.exportAll(); } catch (e) { text = null; }
        if (!text) { status.textContent = 'The backup could not be made, so nothing can be replaced. Nothing was changed.'; return; }
        // Pads a number to two digits so the file name sorts by time.
        const z = (n) => String(n).padStart(2, '0');
        try { const d = new Date(); const fname = 'smokebox-backup-before-set-aside-restore-' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + '.json'; const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = fname; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000); savedFirst = true; status.textContent = 'Asked your browser to save ' + fname + '. Look in your downloads folder to be sure it is there, then type ' + PARK_WORD + '.'; sync(); }
        catch (e) { status.textContent = 'This browser would not save the file. Nothing was changed.'; }
      } }); saveFirst.dataset.action = 'parked-backup';
      // After the PIN, brings the set-aside copy back; the kitchen it replaces is kept for 7 days (Undo this restore below).
      go.addEventListener('click', async () => {
        if (go.disabled) return;
        if (SB.shell.requirePin && !(await SB.shell.requirePin())) { SB.ui.toast('The PIN was not entered. Nothing was changed.', { tone: 'warn' }); return; }
        const rep = SB.store.restoreParked();
        if (rep === 'ok') SB.ui.toast('The set-aside copy is back. What was here before is kept for 7 days: Undo this restore.', { tone: 'ok' });
        else SB.ui.toast(rep === 'noCopy' ? 'The set-aside copy is gone, so nothing was changed.' : SB.engine.describe(rep, (SB.store.lastResult() || {}).info, (stateNow() || {}).settings) + ' Nothing was changed.', { tone: 'warn' });
        paintParked(); paintUndo();
      });
      // Throws the set-aside copy away after asking; the current kitchen is not touched.
      const drop = btn('Throw the set-aside copy away', { icon: 'trash', cls: 'btn-sm', onClick: async () => {
        const ok = await SB.ui.confirm({ title: 'Throw the set-aside copy away?', tone: 'danger', confirmLabel: 'Throw it away', cancelLabel: 'Keep it', body: ['This removes the copy that was set aside. Your kitchen as it is now is not touched. It cannot be brought back.'] });
        if (!ok) return;
        if (SB.shell.requirePin && !(await SB.shell.requirePin())) { SB.ui.toast('The PIN was not entered. Nothing was changed.', { tone: 'warn' }); return; }
        try { const k = SB.store.CORRUPT_KEY; SB.util.storage.remove(k); SB.util.storage.remove(k + 'at'); } catch (e) { /* the check below tells the truth */ }
        SB.ui.toast(SB.store.parkedCopy && SB.store.parkedCopy() ? 'The copy could not be removed.' : 'The set-aside copy was thrown away.', { tone: 'ok' });
        paintParked();
      } }); drop.dataset.action = 'parked-drop';
      const when = pc.at ? U.fmtDateShort(U.dateKey(pc.at)) + ' ' + U.fmtTime(pc.at) : 'earlier';
      parkedBox.replaceChildren(
        h('h3', { class: 'od-sub' }, 'A copy of your kitchen was set aside'),
        h('p', { class: 'od-p' }, 'Smokebox set this copy aside on ' + when + ' because it could not read it then, or it came from a newer version. It can be read now and holds ' + U.fmtNum(pc.tickets) + ' ' + U.plural(pc.tickets, 'ticket') + ' and ' + U.fmtNum(pc.orders) + ' ' + U.plural(pc.orders, 'order') + '.'),
        h('p', { class: 'od-p' }, 'Bringing it back replaces everything on this device. What is here now is kept for 7 days, and you can undo it. First save a backup file of what is here now, then type ' + PARK_WORD + '.'),
        h('div', { class: 'od-actions' }, saveFirst), SB.ui.field({ label: 'Type ' + PARK_WORD, control: word }), h('div', { class: 'od-actions' }, go, drop), status);
    }
    const pasteLabelId = U.uid('odpl');
    const pasteArea = h('textarea', { class: 'textarea od-paste', rows: 5, spellcheck: 'false', autocomplete: 'off', 'aria-labelledby': pasteLabelId, placeholder: 'Paste the whole backup text here' });
    // Checks pasted text the same way as a chosen file.
    const pasteBtn = btn('Check pasted backup', { icon: 'check', cls: 'btn-sm', onClick: () => check(pasteArea.value, 'pasted text') });
    pasteBtn.dataset.action = 'import-check-paste';
    const pasteDet = h('details', { class: 'od-paste-det' }, h('summary', { id: pasteLabelId }, ico('chevron-down', 18), h('span', null, 'Paste a backup instead')), pasteArea, h('div', { class: 'od-actions' }, pasteBtn));
    card2.body.append(
      para('Choose a backup file. Smokebox shows what is inside it before anything changes, and refuses a file that is not a Smokebox backup or that belongs to another kind of kitchen (demo or real).', 'od-p'),
      h('div', { class: 'od-actions' }, chooseBtn, fileIn), pasteDet, impResult, undoBox, parkedBox);
    paintParked();
    // A month close, or the copy's 7 days running out, while this page is open shows here on the next refresh.
    P.syncs.push(() => paintUndo());
    card3.body.append(
      h('ol', { class: 'od-steps' },
        h('li', null, 'On the old device, if it still works: tap Download backup (JSON) in card 1 and copy the file somewhere else (email it to yourself or use a USB drive).'),
        h('li', null, 'On the new device: copy the same smokebox.html file onto it and open it. Install it as an app (Share, then Add to Home Screen, or Install app).'),
        h('li', null, 'Run Menu, then Set up this tablet. Sound, screen-on and loudness are per device and are redone here.'),
        h('li', null, 'Open Back office, then Menu, prices and shop, then Data. In card 2 choose the backup file, read what is inside and tap Replace everything with this backup.'),
        h('li', null, 'Check the board and your dishes. Take a fresh backup from the new device, then retire the old one.')),
      h('p', { class: 'od-hint' }, 'If the old device is broken and you have no backup file, its data cannot be recovered. This is why a daily backup matters.'));

    paintUndo();
    let pending = null;
    // Throws away the checked backup and clears the result card.
    function clearImport() { pending = null; impResult.replaceChildren(); }
    // Shows why a backup was refused; nothing is changed.
    function showBad(reason, source) {
      pending = null;
      impResult.replaceChildren(h('div', { class: 'od-card', 'data-tone': 'bad', role: 'alert' },
        h('p', { class: 'od-card-h' }, ico('alert-circle', 20), h('span', null, 'That ' + source + ' cannot be used.')),
        h('p', { class: 'od-p' }, reason + ' Nothing was changed.')));
    }
    // Validates backup text and shows a summary card. The live data is not touched.
    function check(text, source) {
      const res = inspectBackup(text);
      if (!res.ok) { showBad(res.reason, source); return; }
      pending = res;
      const s = res.state, n = s.tickets.length;
      const live = stateNow();
      const archived = s.menu.filter((m) => m.archived).length;
      const BPd = SB.office && SB.office.backupPure;
      const desc = BPd ? BPd.describeBackup(res, SB.store.mode ? SB.store.mode() : null) : { rows: [['Tickets', U.fmtNum(n)]], wrongKitchen: false, refusal: '' };
      const rows = desc.rows;
      if (desc.wrongKitchen) { showBad(desc.refusal, source); pending = null; return; }
      const repairs = res.repaired.length;
      const card = h('div', { class: 'od-card', 'data-tone': 'ok' },
        h('p', { class: 'od-card-h' }, ico('check-circle', 20), h('span', null, 'This ' + source + ' is a valid Smokebox backup.')),
        h('dl', { class: 'od-stats od-stats-tight' }, rows.map(([k, v]) => h('div', { class: 'od-stat' }, h('dt', null, k), h('dd', { class: 'od-stat-v' }, v)))),
        repairs ? h('p', { class: 'od-hint' }, 'Smokebox repaired ' + repairs + ' small ' + U.plural(repairs, 'problem') + ' while reading it: ' + res.repaired.slice(0, 3).join('; ') + (repairs > 3 ? '; and ' + (repairs - 3) + ' more.' : '.')) : null,
        h('p', { class: 'od-warn' }, ico('alert', 18), h('span', null, 'This replaces everything on this device: ' + U.fmtNum(live.tickets.length) + ' ' + U.plural(live.tickets.length, 'ticket') + ', ' + U.fmtNum(live.batches.length) + ' ' + U.plural(live.batches.length, 'batch', 'batches') + ', your menu edits, your settings, and your station, category and channel names and hidden stations. Back up first if you might want what is here.')),
        h('div', { class: 'od-actions' },
          btn('Back up what is here first', { icon: 'download', cls: 'btn-sm', onClick: downloadBackup }),
          // The replace button asks again in a dialog before anything is written.
          (() => { const b = btn('Replace everything with this backup', { icon: 'upload', cls: 'btn-danger', onClick: () => replaceAll() }); b.dataset.action = 'import-replace'; return b; })(),
          btn('Cancel', { onClick: clearImport })));
      impResult.replaceChildren(card);
    }
    // After a confirm dialog, replaces everything with the checked backup.
    async function replaceAll() {
      if (!pending) return;
      const p = pending, live = stateNow();
      const ok = await SB.ui.confirm({
        title: 'Replace everything on this device?', tone: 'danger', confirmLabel: 'Replace everything', cancelLabel: 'Keep what I have',
        body: ['This replaces ' + U.fmtNum(live.tickets.length) + ' ' + U.plural(live.tickets.length, 'ticket') + ', ' + U.fmtNum(live.batches.length) + ' ' + U.plural(live.batches.length, 'batch', 'batches') + ', every setting, your menu edits, the PIN, and your station, category and channel names and hidden stations with the backup\'s ' + U.fmtNum(p.state.tickets.length) + ' ' + U.plural(p.state.tickets.length, 'ticket') + ' and ' + U.fmtNum(p.state.batches.length) + ' ' + U.plural(p.state.batches.length, 'batch', 'batches') + '.',
          'Smokebox keeps a copy of what is here now for 7 days so this can be undone, but only if this browser has room for it. To be safe, cancel and download a backup first.'],
      });
      if (!ok) return;
      // With a PIN set, restoring a backup asks for it again, even inside the back office grace period.
      if (SB.shell.requirePin && !(await SB.shell.requirePin())) { SB.ui.toast('The PIN was not entered. Nothing was restored.', { tone: 'warn' }); return; }
      const rep = SB.store.importAll(p.text);
      if (rep === 'ok') {
        clearImport(); pasteArea.value = ''; fileIn.value = '';
        const kept = ((SB.store.lastResult() || {}).info || {}).beforeRestore === true;
        const hadData = live.tickets.length + live.batches.length > 0;
        impResult.replaceChildren(h('div', { class: 'od-card', 'data-tone': 'ok', role: 'status' }, h('p', { class: 'od-card-h' }, ico('check-circle', 20), h('span', null, 'Backup restored: ' + U.fmtNum(p.state.tickets.length) + ' ' + U.plural(p.state.tickets.length, 'ticket') + ' and ' + U.fmtNum(p.state.batches.length) + ' ' + U.plural(p.state.batches.length, 'batch', 'batches') + '.')),
          // WATCH OUT: when the browser had no room for the copy there is no undo, and the owner must hear that now.
          !kept && hadData ? h('p', { class: 'od-warn' }, ico('alert', 18), h('span', null, 'This browser had no room to keep a copy of the kitchen that was here, so this restore cannot be undone. A backup file you downloaded earlier is the only way back.')) : null));
        SB.ui.toast('Backup restored.', { tone: 'ok' });
        paintUndo();
      } else {
        const lr = SB.store.lastResult() || {};
        showBad(rep === 'invalidBackup' && lr.info && lr.info.error ? backupReason(lr.info.error) : SB.engine.describe(rep, lr.info, (stateNow() || {}).settings), 'backup');
      }
    }
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (f.size > MAX_IMPORT_CHARS * 1.2) { showBad(backupReason('too large'), 'file'); fileIn.value = ''; return; }
      let text;
      try { text = await readFileText(f); } catch (e) { showBad('The file could not be read from this device.', 'file'); fileIn.value = ''; return; }
      check(text, 'file');
      fileIn.value = ''; // so choosing the same file again re-checks it
    });
    return { check };
  }

  // Builds the backup card's working parts on the Data page (pilot report, spreadsheet files, how fresh the last backup is, and the Back up now card with its download, copy and print buttons).
  function buildExportCard(env) {
    const { stateNow, exStatus, reportSave, downloadCsv, downloadBackup, copyBackup, card1, fb, pn, P } = env;
    // Pilot report: the numbers for a real watched service, from the event log and the saved sound log.
    const cutsIn = h('input', { class: 'input', type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': 'Cuts the observer counted', style: 'width:7em' });
    const batchesIn = h('input', { class: 'input', type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': 'Batches the observer counted', style: 'width:7em' });
    const whenSel = h('select', { class: 'input', 'aria-label': 'Report window' }, h('option', { value: 'open' }, 'Since opening'), h('option', { value: '4' }, 'Last 4 hours'), h('option', { value: '24' }, 'Last 24 hours'));
    const repBox = h('pre', { class: 'od-report', hidden: true, role: 'region', 'aria-label': 'Pilot report', tabindex: '0', 'aria-live': 'polite', style: 'white-space:pre-wrap;margin:8px 0;padding:12px;border:1px solid var(--line);border-radius:8px;font-size:14px' });
    // Builds the report for the chosen window and shows it; with download true it also saves the CSV.
    async function makeReport(download) {
      const s = stateNow(), now = SB.store.now();
      const from = whenSel.value === 'open' ? SB.pilot.defaultFrom(s, now) : now - Number(whenSel.value) * 3600e3;
      const rep = SB.pilot.build(s, { from, to: now, now, alerts: SB.floor && SB.floor.alertLog ? SB.floor.alertLog() : [], cutsCounted: cutsIn.value === '' ? null : Number(cutsIn.value), demoClock: SB.store.speed() > 1, demo: SB.store.isDemo && SB.store.isDemo(), batchesCounted: batchesIn.value === '' ? null : Number(batchesIn.value) });
      repBox.textContent = SB.pilot.toText(rep) + (SB.office && SB.office.archivedWords ? (function (w) { return w ? '\n\n' + w : ''; })(SB.office.archivedWords(s.archivedBefore, from, ((s.settings || {}).service || {}).dayStartHour)) : ''); repBox.hidden = false;
      if (!download) { exStatus.ok('Report made for ' + rep.window.hours + ' hours.'); return; }
      const fname = (rep.demo ? 'smokebox-demo-pilot-report-' : 'smokebox-pilot-report-') + todayKey() + '.csv';
      const csv = SB.pilot.toCsv(rep);
      reportSave(await saveFile(fname, csv, 'text/csv'), fname, csv, 'report');
    }
    // The two report buttons: show it on screen, or save the CSV.
    const showReport = () => makeReport(false), saveReport = () => makeReport(true);
    // Prints the report text as one page: builds a print-only block, prints it, and removes it again.
    async function printReport() {
      await makeReport(false);
      const root = h('div', { class: 'sb-printroot pr-printroot' }, h('h1', null, 'Pilot report'), h('pre', { style: 'white-space:pre-wrap;font-size:13px' }, repBox.textContent));
      document.body.appendChild(root);
      // Removes the print-only block again.
      const done = () => { try { root.remove(); } catch (e) { /* already gone */ } };
      window.addEventListener('afterprint', done, { once: true });
      try { window.print(); } catch (e) { done(); }
      setTimeout(done, 60000);
    }
    const repRow = h('div', { class: 'od-actions od-csv' }, h('span', { class: 'od-lab od-inline' }, 'Pilot report'), whenSel, h('label', { class: 'od-inline' }, 'Cuts counted ', cutsIn), h('label', { class: 'od-inline' }, 'Batches counted ', batchesIn),
      btn('Show report', { icon: 'receipt', cls: 'btn-sm', onClick: showReport }), btn('Download CSV', { icon: 'download', cls: 'btn-sm', onClick: saveReport }), btn('Print', { cls: 'btn-sm', onClick: printReport }));
    repRow.dataset.pilot = 'report';
    // Saves the sales-by-day file for an accountant: one row per day with sales, tax, tips and how it was paid.
    async function downloadSalesCsv() {
      const BPs = SB.office && SB.office.backupPure;
      if (!BPs) { exStatus.bad('Could not make the sales file. Reload and try again.'); return; }
      const s = stateNow();
      const text = BPs.salesCsv(s, s.settings.service && s.settings.service.dayStartHour);
      const fname = 'smokebox-sales-by-day' + (SB.store.mode && SB.store.mode() === 'demo' ? '-demo' : '') + '-' + todayKey() + '.csv';
      const days = Math.max(0, text.split('\r\n').length - 3);
      // With no paid orders there is nothing to hand over: say so instead of saving a file that only has column names.
      if (!days) { exStatus.bad('No order has been paid yet, so there is no sales file to save. Pay an order first.'); return; }
      const res = await saveFile(fname, text, 'text/csv');
      if (res.how === 'host' || res.how === 'browser') exStatus.ok((res.how === 'host' ? 'Saved ' : 'Download started: ') + fname + (days ? ' (' + days + ' ' + U.plural(days, 'day') + ' of sales).' : ': it has only the column names because no order has been paid yet.'));
      else reportSave(res, fname, text, 'sales file');
    }
    const csvBtns = [['tickets', 'Tickets'], ['items', 'Items'], ['orders', 'Orders'], ['events', 'Events'], ['batches', 'Batches']].map(([k, l]) => {
      // Each spreadsheet button downloads its own table.
      const b = btn(l, { icon: 'download', cls: 'btn-sm', onClick: () => downloadCsv(k, l.toLowerCase()) });
      b.setAttribute('aria-label', 'Download ' + l.toLowerCase() + ' as CSV');
      b.dataset.csv = k;
      return b;
    });
    const salesBtn = btn('Sales by day (for your accountant)', { icon: 'download', cls: 'btn-sm', onClick: downloadSalesCsv });
    salesBtn.dataset.csv = 'sales';
    csvBtns.unshift(salesBtn);
    // Says when the last backup was made on this device, so a stale one is easy to spot.
    const BP = SB.office && SB.office.backupPure;
    const lastLine = para('', 'od-p od-lastbackup');
    // Writes how fresh the last backup is, with a colour tone for never or old.
    const paintLast = () => {
      const t = SB.shell && SB.shell.lastBackupAt ? SB.shell.lastBackupAt() : null;
      const f = BP ? BP.backupFreshness(t, Date.now()) : { tone: t ? 'ok' : 'bad', text: t ? 'Last backup: ' + U.fmtDateShort(U.dateKey(t)) + ', ' + U.fmtTime(t) + '.' : 'No backup has been made from this device yet.' };
      lastLine.textContent = f.text; lastLine.dataset.tone = f.tone;
    };
    paintLast(); P.syncs.push(paintLast);
    const dlBtn = btn('Download backup (JSON)', { icon: 'download', cls: 'btn-primary', onClick: downloadBackup });
    dlBtn.dataset.action = 'backup-download';
    const cpBtn = btn('Copy backup', { icon: 'copy', onClick: copyBackup });
    cpBtn.dataset.action = 'backup-copy';
    card1.body.append(
      lastLine,
      para('A backup is one file with your dishes, orders, settings and records. Back up at the end of every day, and keep a copy off this device (email it to yourself or use a USB drive): if the browser data is cleared or the device is replaced, a copy on the same device is gone too.', 'od-p'),
      para('Some choices are kept on this device only and are not in a backup: the starting cash you type on Close the day, the look (day or night), text size, and sound and screen-on. Set them again on a new device.', 'od-hint'),
      h('div', { class: 'od-actions' }, dlBtn, cpBtn), exStatus.el, fb);
    // The spreadsheet files and the pilot report are less common, so they sit in a closed group below the flow.
    pn.body.appendChild(h('details', { class: 'od-paste-det od-more' }, h('summary', null, ico('chevron-down', 18), h('span', null, 'Spreadsheet files and the pilot report')),
      para('Spreadsheet files (CSV) list one kind of record each and cannot be restored from.', 'od-hint'),
      h('div', { class: 'od-actions od-csv' }, h('span', { class: 'od-lab od-inline' }, 'Spreadsheet files'), csvBtns), repRow, repBox));
  }

  // Panel 8: what is stored, sample history, export, import and reset.
  function buildData(P) {
    const pn = panel(SECTIONS[7], 'Everything Smokebox knows lives in this browser, on this device. Back it up before you reset, import or clear browser data.');
    // The one-time offer to clear old demo tickets from real reports; nothing is shown when there are none.
    { const lc = SB.setup && SB.setup.leftoversCard ? SB.setup.leftoversCard() : null; if (lc) pn.body.appendChild(lc); }

    // What is stored: counts read from the live state, refreshed on every sync.
    // One label and value pair for the counts list.
    const stat = (label) => { const dd = h('dd', { class: 'od-stat-v' }); return { dt: h('dt', null, label), dd }; };
    const sTickets = stat('Tickets'), sEvents = stat('Logged events'), sBatches = stat('Hold-cabinet batches'), sSize = stat('Stored on this device');
    const sSample = stat('Sample tickets');
    pn.body.append(sub('What is stored'), h('dl', { class: 'od-stats' }, [sTickets, sEvents, sBatches, sSize, sSample].map((x) => h('div', { class: 'od-stat' }, x.dt, x.dd))));
    let lastRev = -1, lastSizeAt = 0;
    // Size of what is stored on this device, in characters; falls back to the live state.
    const storedChars = () => {
      try { const raw = SB.util.storage.raw(SB.store.KEY); if (raw) return raw.length; } catch (e) { /* fall through */ }
      try { return JSON.stringify(cur()).length; } catch (e) { return null; }
    };
    // The simulator when it can switch sample history, otherwise null (the page then says it is not
    // loaded).
    const simOn = () => (SB.sim && typeof SB.sim.sampleEnabled === 'function' && typeof SB.sim.setSampleEnabled === 'function' ? SB.sim : null);
    function paintCounts(s) {
      // The first run seeds demo tickets; say so rather than calling them live.
      const nDemo = s.tickets.filter((t) => t.src === 'demo').length, nLive = s.tickets.length - nDemo;
      sTickets.dd.textContent = !nDemo ? U.fmtNum(nLive) : !nLive ? U.fmtNum(nDemo) + ' demo' : U.fmtNum(nLive) + ' live, ' + U.fmtNum(nDemo) + ' demo';
      const ev = SB.engine.allEvents(s).length;
      sEvents.dd.textContent = U.fmtNum(ev);
      sBatches.dd.textContent = U.fmtNum(s.batches.length);
      const now = Date.now();
      if (s.rev !== lastRev && now - lastSizeAt > 2500) {
        lastRev = s.rev; lastSizeAt = now;
        const n = storedChars();
        sSize.dd.textContent = n == null ? 'unknown' : kbText(n);
      }
      let smp = null;
      // Building the sample history takes seconds, so it is only counted when the sample is switched on.
      if (simOn() && simOn().sampleEnabled()) { try { const ds = SB.store.dataset({ sample: true }); smp = ds.hasSample ? ds.counts.sample : 0; } catch (e) { smp = null; } }
      sSample.dd.textContent = !simOn() ? 'Not loaded' : simOn().sampleEnabled() ? (smp != null ? U.fmtNum(smp) : 'On') : 'Off';
    }

    // Sample history: the switch exists only when the simulator can turn it on and off.
    pn.body.appendChild(sub('Sample history'));
    const sampleBox = h('div', { class: 'od-sample' });
    pn.body.appendChild(sampleBox);
    const sampleToggle = simOn() ? SB.ui.toggle({
      label: 'Show sample history in the back office', checked: !!simOn().sampleEnabled(),
      onChange: (v) => {
        try { simOn().setSampleEnabled(v); SB.ui.toast(v ? 'Sample history is on. The back office charts include it.' : 'Sample history is off. The back office charts use live tickets only.', { tone: 'ok' }); }
        catch (e) { sampleToggle.setValue(!v); SB.ui.toast('Could not change sample history. Reload and try again.', { tone: 'bad' }); }
        try { noteP.textContent = noteText(); paintCounts(cur()); } catch (e) { /* counts repaint on the next sync */ }
      },
    }) : null;
    // The sample-history note from the simulator, or the built-in one.
    // The sample note with real dates needs the sample built, which takes seconds: with the sample off the page shows the general note.
    const noteText = () => { try { const i = SB.sim && SB.sim.sampleEnabled && SB.sim.sampleEnabled() && SB.sim.sampleInfo && SB.sim.sampleInfo(); if (i && typeof i.note === 'string' && i.note) return i.note; } catch (e) { /* default below */ } return SAMPLE_NOTE; };
    const noteP = para(noteText(), 'od-p');
    if (sampleToggle) sampleBox.append(sampleToggle, noteP);
    else sampleBox.append(h('p', { class: 'od-p od-warnline' }, ico('alert', 18), h('span', null, 'Sample history is not available in this build, so the back office shows only your own tickets.')), para(SAMPLE_NOTE, 'od-hint'));

    // Export: JSON backup and CSV tables go through saveFile, with copy as the fallback.
    // The three-card flow at the top of the page: back up, restore, replace a device.
    const flow = h('div', { class: 'od-flow' });
    // Builds one numbered card of the flow: a heading (with an optional Guide "?") and a body to fill.
    const flowCard = (num, title, guidePage, guideLabel) => {
      const body = h('div', { class: 'od-fbody' });
      const head = h('h3', { class: 'od-fh' }, h('span', { class: 'od-fnum', 'aria-hidden': 'true' }, num), h('span', null, title));
      const hl = guidePage ? helpLink(guidePage, guideLabel) : null;
      if (hl) { head.appendChild(doc.createTextNode(' ')); head.appendChild(hl); }
      return { el: h('section', { class: 'od-fcard', 'aria-label': title }, head, body), body };
    };
    const card1 = flowCard('1', 'Back up now', 'backup-and-restore', 'backing up');
    const card2 = flowCard('2', 'Restore from a backup', 'backup-and-restore', 'restoring a backup');
    const card3 = flowCard('3', 'Replacing this device', 'replacing-a-device', 'replacing a device');
    flow.append(card1.el, card2.el, card3.el);
    // Close the month: not in the demo and not on a tablet that works through a hub (the store refuses it there too).
    const hubTablet = (() => { try { return !!(SB.store.hubKitchen && SB.store.hubKitchen()); } catch (e) { return false; } })();
    if (!(SB.store.isDemo && SB.store.isDemo()) && !hubTablet && SB.store.closeMonthPreview) { const cm = closeMonthCard(flowCard); flow.append(cm.el); P.syncs.push(cm.sync); }
    pn.body.prepend(flow);
    if (SB.store.historyFill && !(SB.store.isDemo && SB.store.isDemo())) { const hc = historyCard(); pn.body.prepend(hc.el); P.syncs.push(hc.sync); }
    const exStatus = statusLine();
    const fbLabelId = U.uid('odfb');
    const fbText = h('textarea', { class: 'textarea od-fbtext', readonly: true, rows: 6, 'aria-labelledby': fbLabelId, spellcheck: 'false' });
    // Selects the whole backup text so it can be copied by hand.
    const fbSelect = btn('Select all', { cls: 'btn-sm', onClick: () => { fbText.focus(); fbText.select(); } });
    const fb = h('div', { class: 'od-fallback', hidden: true }, h('div', { class: 'od-lab', id: fbLabelId }, 'Backup text: copy all of it'), fbText, h('div', { class: 'od-actions' }, fbSelect));
    // Shows the backup text selected in a box, for when the browser blocks copy or download.
    function showFallback(text) { fb.hidden = false; fbText.value = text; fbText.focus(); fbText.select(); }
    // The current state, read fresh each time.
    const stateNow = () => cur();
    // The full backup text, or null after saying why it could not be made.
    function backupText() {
      const t = SB.store.exportAll();
      if (t == null) { const lr = SB.store.lastResult() || {}; exStatus.bad(SB.engine.describe(lr.report || 'invalidBackup', lr.info, (stateNow() || {}).settings) + ' Nothing was saved.'); return null; }
      return t;
    }
    // Saves the backup file and reports what happened.
    async function downloadBackup() {
      const text = backupText(); if (!text) return;
      const fname = 'smokebox-backup-' + todayKey() + '.json';
      const res = await saveFile(fname, text, 'application/json');
      reportSave(res, fname, text, 'backup');
      if (res.how === 'host' || res.how === 'browser') noteBackup();
    }
    // Says in words whether a file was saved, started, declined or blocked.
    function reportSave(res, fname, text, what) {
      const size = kbText(text.length);
      if (res.how === 'host') exStatus.ok('Saved ' + fname + ' (' + size + ').');
      else if (res.how === 'declined') exStatus.bad('You chose not to save the file, so nothing was written.');
      else if (res.how === 'browser') exStatus.ok('Download started: ' + fname + ' (' + size + '). If nothing arrives, your browser may be blocking downloads: use Copy backup instead.');
      else { showFallback(text); exStatus.bad('Your browser blocked the download. The ' + what + ' is selected below: copy it and paste it into a file named ' + fname + '.'); }
    }
    // Copies the backup to the clipboard; if the browser blocks that, shows it selected below.
    function copyBackup() {
      const text = backupText(); if (!text) return;
      // Fallback when copying is blocked: show the text selected.
      const fail = () => { showFallback(text); exStatus.bad('Your browser blocked copying. The backup is selected below: press Ctrl+C (Cmd+C on a Mac) to copy it.'); };
      try {
        const p = g.navigator.clipboard.writeText(text);
        p.then(() => { exStatus.ok('Copied ' + kbText(text.length) + ' to the clipboard.'); noteBackup(); }, fail);
      } catch (e) { fail(); }
    }
    // Saves one spreadsheet table and says how many rows it holds.
    async function downloadCsv(kind, label) {
      const text = SB.store.exportCsv(kind);
      if (!text) { exStatus.bad('Could not make the ' + label + ' file. Reload and try again.'); return; }
      const s = stateNow();
      const n = kind === 'tickets' ? s.tickets.length : kind === 'items' ? s.tickets.reduce((a, t) => a + t.items.length, 0) : kind === 'events' ? SB.engine.allEvents(s).length : s.batches.length;
      const fname = 'smokebox-' + kind + '-' + todayKey() + '.csv';
      const res = await saveFile(fname, text, 'text/csv');
      if (res.how === 'host' || res.how === 'browser') {
        const tail = n ? ' (' + U.fmtNum(n) + ' ' + U.plural(n, 'row') + ').' : ': it has only the column names because there is nothing to list yet.';
        if (res.how === 'host') exStatus.ok('Saved ' + fname + tail); else exStatus.ok('Download started: ' + fname + tail);
      } else reportSave(res, fname, text, 'table');
    }
    buildExportCard({ stateNow, exStatus, reportSave, downloadCsv, downloadBackup, copyBackup, card1, fb, pn, P });

    const { check } = buildImportCard({ stateNow, card2, card3, downloadBackup, P });

    const { resetStatus } = buildDangerZone({ pn, stateNow });

    P.syncs.push((s) => { paintCounts(s); if (sampleToggle && simOn()) sampleToggle.setValue(!!simOn().sampleEnabled()); });
    P.disposers.push(() => exStatus.destroy(), () => resetStatus.destroy());
    P.dataTools = { downloadBackup, check };
    return pn;
  }

  // Panel 9: what this build is, and what is simulated or untested.
  function buildAbout() {
    const pn = panel(SECTIONS[8]);
    const items = [
      ['This build', VERSION + '. One file that works offline. Your data stays in this browser, on this device.'],
      ['What is demo or sample', 'The demo kitchen and the sample history are generated by the app so you can see how the screens work. Smokebox is not connected to any POS, online ordering or delivery app, and nothing is sent anywhere.'],
      ['What is a starter estimate', 'Prep times, cooked yields and ingredient costs began as starter numbers. Prep times and yields keep the label "starter estimate" until you confirm them. Costs stay starter numbers until you replace them with your invoices.'],
      ['What has not been tested', 'It was tested in Chromium at phone, tablet and desktop sizes. Not tested: real sunlight on a real screen, and other devices and browsers. Try the line on the actual tablet before service.'],
      ['Several devices', 'Separate devices do not share data. Tablets open in the same browser on the same device do, and stay in step.'],
    ];
    pn.body.appendChild(h('dl', { class: 'od-about' }, items.map(([k, v]) => h('div', { class: 'od-about-row' }, h('dt', null, k), h('dd', null, v)))));
    return pn;
  }

  // The page
  // Counts prep times and cooked yields that are still starter estimates.
  function starterCount(s) {
    const prep = s.menu.filter((m) => !m.archived && !m.prepConfirmed).length;
    const yld = s.ingredients.filter((i) => i.tcs && isNum(i.yield) && !i.yieldConfirmed).length;
    return { prep, yld, total: prep + yld };
  }

  // Builds the whole page into the container. Returns {update, destroy} for the frame.
  function render(container, ctx) {
    // showStarter is a placeholder until the menu panel installs the real one.
    const P = { syncs: [], disposers: [], menuFilter: { status: 'active', zone: 'all', starter: false }, ctx, showStarter: () => {} };
    const root = h('div', { class: 'od', id: 'od-root' });
    container.appendChild(root);

    // headline
    const headline = h('p', { class: 'od-headline', role: 'status' });
    const headSub = h('p', { class: 'od-headsub' });
    // Shows the unconfirmed items in the menu panel.
    const showBtn = btn('Show the starter estimates', { cls: 'btn-sm', onClick: () => { P.showStarter(); goTo('menu'); } });
    const headBox = h('div', { class: 'od-headbox' }, headline, h('div', { class: 'od-headrow' }, headSub, showBtn));
    // Writes the headline and its second line from the saved state.
    function paintHeadline(s) {
      const st = SB.store.status ? SB.store.status() : { persistent: true };
      const keeping = st.persistent !== false && st.lastSaveOk !== false;
      const n = starterCount(s);
      headline.textContent = (keeping ? 'Your settings are saved on this device.' : 'This browser is not keeping your changes, so they will be lost when you close the page. Allow site data for this page.') + ' ' +
        (n.total ? n.total + ' ' + U.plural(n.total, 'starter estimate is still a guess', 'starter estimates are still guesses') + ', not confirmed yet.' : s.menu.some((m) => !m.archived) ? 'Every prep time and yield is confirmed.' : '');
      headline.dataset.tone = keeping ? 'ok' : 'bad';
      headSub.textContent = n.total ? n.prep + ' prep ' + U.plural(n.prep, 'time') + ' and ' + n.yld + ' cooked ' + U.plural(n.yld, 'yield') + '. Starter estimates are fine to run on; confirm each one when you have timed or weighed it.' : '';
      showBtn.hidden = !n.prep;
    }

    // table of contents
    const links = [];
    const toc = h('nav', { class: 'od-toc', 'aria-label': 'On this page' });
    const tocList = h('ul', { class: 'od-toc-list' });
    toc.appendChild(tocList);
    // Scrolls to a panel and moves focus to its heading.
    function goTo(id) {
      const el = doc.getElementById('od-' + id);
      if (!el) return;
      const adv = el.closest('details'); if (adv) adv.open = true; // an Advanced panel opens before it is scrolled to
      el.scrollIntoView({ block: 'start', behavior: U.prefersReducedMotion() ? 'auto' : 'smooth' });
      const t = el.querySelector('.od-title'); if (t) t.focus({ preventScroll: true });
    }
    // The Settings are grouped by task. Panels keep their old numbers; only the order on the page changes.
    // Group order: Shop, Kitchen, Safety, Devices, then Advanced (collapsed by default).
    const ORDER = ['menu', 'look', 'pin', 'ingredients', 'times', 'safety', 'data', 'about', 'pacing'].map((id) => SECTIONS.findIndex((s) => s.id === id)).filter((i) => i >= 0);
    let lastGroup = '';
    ORDER.forEach((i) => {
      const sec = SECTIONS[i];
      if (sec.group !== lastGroup) { lastGroup = sec.group; tocList.appendChild(h('li', { class: 'od-toc-group' }, sec.group)); }
      const a = h('a', { class: 'od-toc-link', href: '#od-' + sec.id, dataset: { target: sec.id } }, sec.label);
      a.addEventListener('click', (ev) => { ev.preventDefault(); goTo(sec.id); }); // a real hash would be read by the router as "leave the office"
      links.push(a);
      tocList.appendChild(h('li', null, a));
    });

    // panels (one failing panel must not blank the page)
    const builders = [buildMenu, buildIngredients, buildTimes, buildPacing, buildSafety, buildPin, buildLook, buildData, buildAbout];
    const panels = builders.map((b, i) => {
      try { return b(P); }
      catch (e) {
        console.error('[smokebox] Data page: ' + SECTIONS[i].title + ' failed', e);
        const pn = panel(SECTIONS[i]);
        pn.body.appendChild(SB.ui.errorCard(e, { title: 'This panel could not load', module: '84-office-data.js' }));
        return pn;
      }
    });
    // Panels go in group order; the Advanced ones sit inside a fold that starts closed.
    const content = h('div', { class: 'od-content' });
    ORDER.forEach((i) => {
      if (SECTIONS[i].group !== 'Advanced') { content.appendChild(panels[i].el); return; }
      content.appendChild(h('details', { class: 'od-adv' }, h('summary', null, 'Advanced: ' + SECTIONS[i].label), panels[i].el));
    });
    root.append(headBox, h('div', { class: 'od-layout' }, toc, content));

    // the frame keeps its own sticky bar (the data banner) at the top of the scroll area: sit the contents
    // list just below it
    let ro = null;
    const frameBar = () => { const col = root.closest('.of-col'); return col ? col.querySelector('.of-filters') : null; };
    const fb = frameBar();
    if (fb) {
      // Keeps the contents list just under the frame's sticky bar.
      const setTop = () => { root.style.setProperty('--od-sticky-top', Math.ceil(fb.getBoundingClientRect().height) + 'px'); };
      setTop();
      if (typeof g.ResizeObserver === 'function') { ro = new g.ResizeObserver(setTop); ro.observe(fb); }
    }

    const scroller = root.closest('.of-col') || g;
    let markT = 0;
    // Marks the contents link of the panel being read: the last panel whose top has passed a line just under
    // the sticky bars.
    function markCurrent() {
      markT = 0;
      const bar = frameBar();
      const line = (bar ? bar.getBoundingClientRect().bottom : 0) + 90;
      let best = SECTIONS[0].id;
      ORDER.forEach((i) => { const r = panels[i].el.getBoundingClientRect(); if (r.height > 0 && r.top <= line) best = SECTIONS[i].id; });
      const atEnd = scroller === g ? false : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4; // the last panels are short and never reach the line
      if (atEnd) best = SECTIONS[ORDER[ORDER.length - 1]].id;
      links.forEach((a) => { if (a.dataset.target === best) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    }
    // Runs markCurrent at most once per frame.
    const onScroll = () => { if (!markT) markT = g.requestAnimationFrame ? g.requestAnimationFrame(markCurrent) : setTimeout(markCurrent, 50); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    g.addEventListener('resize', onScroll);
    onScroll();

    // keep in step with the store, never touching a field that has focus or a pending edit
    let lastState = null;
    const doSync = (s) => {
      if (!s) return;
      lastState = s;
      P.syncs.forEach((fn) => { try { fn(s); } catch (e) { console.error('[smokebox] Data page sync failed', e); } });
      paintHeadline(s);
    };
    const unsub = SB.store.subscribe(doSync);
    doSync(cur());
    return {
      // Called by the frame on refresh; redraws only if the state changed.
      update() { const s = cur(); if (s && s !== lastState) doSync(s); },
      // Removes listeners, observers and timers, then the page.
      destroy() {
        unsub();
        scroller.removeEventListener('scroll', onScroll);
        g.removeEventListener('resize', onScroll);
        if (ro) ro.disconnect();
        P.disposers.forEach((fn) => { try { fn(); } catch (e) { console.error('[smokebox] Data page cleanup failed', e); } });
        root.remove();
      },
    };
  }

  SB.dataPage = { saveFile, inspectBackup, backupReason, starterCount, version: 1 };
  if (SB.office && typeof SB.office.registerPage === 'function') SB.office.registerPage('data', { title: 'Menu, prices and shop', icon: 'sliders', order: 7, render });
})(typeof globalThis !== 'undefined' ? globalThis : window);
