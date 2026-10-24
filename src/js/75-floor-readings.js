/*
 * WHAT THIS FILE IS: The Readings sheet. A cook writes down what a thermometer or test strip says: the temperature of a
 *    fridge, freezer or display case, a check of the food thermometer in ice or boiling water, and a sanitizer strip reading.
 *    Few fields, plain words, the last names used are remembered, and a wrong entry is fixed with a note (nothing is erased).
 * PARTS: remembered names, one form per kind of reading, the list of recent entries, the fix box.
 * USES: 00-util.js, 05-icons.js, 20-engine.js (logEquipmentTemp, logThermometerCheck, sanitizeDone, correctSafety), 60-shell.js
 *    (sheets, toasts), 72-floor-sheets.js (sheet registry, SB.who). USED BY: the board's sanitize menu, quick menu and Settings sheet.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const doc = g.document;
  if (!doc || !SB.sheets) return;
  const h = U.h;
  // Builds an icon element, or an empty span when icons are missing.
  const ico = (name, size) => { try { return SB.icons.svg(name, { size: size || 20 }); } catch (e) { return doc.createElement('span'); } };
  const KEY = 'smokebox.v1.readings';
  // Sends one action to the engine as a person's tap.
  const run = (type, payload) => SB.store.dispatchEx(type, payload, { source: 'ui' });
  // What was used last time: the names of fridges, sanitizer products and places, the last unit and the last strip number.
  function load() {
    const r = U.storage.get(KEY, null);
    const o = r && typeof r === 'object' ? r : {};
    // Keeps only real names, at most five of them.
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, 5) : []);
    return { labels: list(o.labels), products: list(o.products), places: list(o.places), unit: typeof o.unit === 'string' ? o.unit : 'cooler', ppm: U.isNum(o.ppm) ? o.ppm : 200 };
  }
  // Saves the remembered names back to the browser.
  function save(rec) { U.storage.set(KEY, rec); }
  // Puts a name first in its list (no repeats, at most five).
  function remember(rec, key, name) {
    const n = (name || '').trim();
    if (!n) return;
    rec[key] = [n].concat(rec[key].filter((x) => x.toLowerCase() !== n.toLowerCase())).slice(0, 5);
  }
  const UNITS = [{ id: 'cooler', label: 'Cooler', f: 38 }, { id: 'freezer', label: 'Freezer', f: 0 }, { id: 'display', label: 'Display case', f: 38 }, { id: 'other', label: 'Other', f: 38 }];
  const METHODS = [{ id: 'ice', label: 'Ice water', f: 32 }, { id: 'boiling', label: 'Boiling water', f: 212 }, { id: 'other', label: 'Other', f: 100 }];
  const KIND_WORD = { equip_temp: 'Fridge or freezer', thermometer_checked: 'Thermometer check', sanitize_done: 'Sanitizer' };

  // Opens the Readings sheet.
  // Opens the Readings sheet and builds its three forms.
  function openReadings() {
    const rec = load();
    const sheet = SB.ui.sheet({ title: 'Readings', side: 'right', width: 'min(640px, 96vw)', name: 'readings' });
    const status = h('p', { class: 'fs-sub', role: 'status' });
    const recent = h('div', { class: 'rd-recent' });
    // Runs then(who) with the remembered initials (asked once per tablet), then says the result.
    const withWho = (verb, then) => { if (SB.who && SB.who.ask) SB.who.ask(null, verb, then); else then(''); };
    // Tells the cook what happened, in words, and refreshes the recent list.
    // A reading the engine flagged as out of range is saved, but the line says so in the warning color.
    const done = (res, okText, warnText) => {
      if (res.report !== 'ok') { status.textContent = SB.engine && SB.engine.describe ? (SB.engine.describe(res.report, res.info, SB.store.getState().settings) || 'That was not saved.') : 'That was not saved.'; status.dataset.tone = 'bad'; return; }
      const warn = res.info && res.info.outOfRange && warnText;
      status.textContent = warn ? okText + ' ' + warnText : okText; status.dataset.tone = warn ? 'warn' : 'ok'; paintRecent();
    };
    // A text box with the last names as one-tap chips under it.
    function nameField(label, key, placeholder) {
      const input = h('input', { class: 'input', type: 'text', maxlength: '30', autocomplete: 'off', placeholder, 'aria-label': label });
      const chips = h('div', { class: 'ord-chips', role: 'group', 'aria-label': label + ', recent' });
      // Draws the remembered names as one-tap chips.
      const paint = () => {
        U.clear(chips);
        // Fills the box with the name that was tapped.
        rec[key].forEach((n) => chips.appendChild(h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { input.value = n; } }, n)));
        chips.hidden = rec[key].length === 0;
      };
      paint();
      return { el: h('div', { class: 'hc-fld' }, h('div', { class: 'field-label' }, label), input, chips), input, paint };
    }
    // A temperature box in the units this tablet shows.
    const tempStep = (value, min, max, label) => SB.ui.stepper({ value: U.tempShown(value), min: U.tempShown(min), max: U.tempShown(max), step: 1, bigStep: 5, unit: U.unitLabel('temp'), label });

    // A reading is only logged after the cook has typed or tapped a number: the box starts empty and its Log button waits, so a starting
    // number can never be saved as if it had been measured. Returns reset() to empty the box again (when the kind changes).
    function needsNumber(step, btn) {
      let entered = false;
      // Empties the box and switches the Log button off until a number is typed or tapped.
      const reset = () => { entered = false; step.input.value = ''; step.input.placeholder = 'Type it'; btn.disabled = true; };
      // Switches the Log button on once the box holds a number.
      const seen = () => { const ok = step.input.value.trim() !== '' && Number.isFinite(Number(step.input.value)); if (ok !== entered) { entered = ok; btn.disabled = !ok; } };
      step.addEventListener('input', seen); step.addEventListener('change', seen); step.addEventListener('click', () => setTimeout(seen, 0));
      reset();
      return { reset, seen };
    }
    // 1. Fridge, freezer or display case
    let unit = UNITS.some((u) => u.id === rec.unit) ? rec.unit : 'cooler';
    const eqTemp = tempStep((UNITS.find((u) => u.id === unit) || UNITS[0]).f, -40, 200, 'Temperature of the fridge, freezer or case');
    const eqName = nameField('Name (optional)', 'labels', 'Walk-in, line cooler');
    const unitSeg = SB.ui.segmented({ label: 'Which one', class: 'rd-unit', value: unit, options: UNITS.map((u) => ({ id: u.id, label: u.label })),
      // Picking another kind empties the box again: the number must be what the thermometer shows now.
      onChange: (id) => { unit = id; if (eqGate) eqGate.reset(); } });
    const eqBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'log-equip' }, onClick: () => withWho('Log reading', (who) => {
      const label = eqName.input.value.trim();
      const res = run('logEquipmentTemp', Object.assign({ unit, f: U.tempStored(eqTemp.getValue()) }, label ? { label } : {}, who ? { who } : {}));
      if (res.report === 'ok') { rec.unit = unit; remember(rec, 'labels', label); save(rec); eqName.paint(); }
      if (res.report === 'ok') eqGate.reset();
      done(res, 'Logged ' + (label || (UNITS.find((u) => u.id === unit) || {}).label) + ' at ' + U.tempText(U.tempStored(eqTemp.getValue())) + '.',
        res.info && U.isNum(res.info.maxF) ? 'That is above ' + U.tempText(res.info.maxF) + '. Move the food somewhere colder, fix the unit, and check it again.' : '');
    }) }, ico('thermometer', 22), h('span', null, 'Log reading'));
    const eqGate = needsNumber(eqTemp, eqBtn);
    const secEq = h('section', { class: 'fs-section rd-sec', 'aria-label': 'Fridge, freezer or display case' }, h('h3', { class: 'fs-h' }, 'Fridge, freezer or display case'), unitSeg, eqName.el, h('div', { class: 'hc-fld' }, eqTemp), eqBtn);

    // 2. Food thermometer check
    let method = 'ice';
    const thTemp = tempStep(32, 0, 300, 'What the food thermometer says');
    const methodSeg = SB.ui.segmented({ label: 'How you checked it', class: 'rd-method', value: method, options: METHODS.map((m) => ({ id: m.id, label: m.label })),
      // The box starts empty: a check only counts with the number the thermometer really showed.
      onChange: (id) => { method = id; if (thGate) thGate.reset(); } });
    const thBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'log-thermo' }, onClick: () => withWho('Log check', (who) => {
      const f = U.tempStored(thTemp.getValue());
      const res = run('logThermometerCheck', Object.assign({ f, method }, who ? { who } : {}));
      if (res.report === 'ok') thGate.reset();
      done(res, 'Thermometer check logged: it read ' + U.tempText(f) + ' in ' + (method === 'ice' ? 'ice water' : method === 'boiling' ? 'boiling water' : 'the test') + '.',
        res.info && U.isNum(res.info.expectF) ? 'It should read about ' + U.tempText(res.info.expectF) + '. Adjust the thermometer or replace it before you use it.' + (method === 'boiling' ? ' High up, water boils cooler, so a lower reading there can be fine.' : '') : '');
    }) }, ico('check-circle', 22), h('span', null, 'Log check'));
    const thGate = needsNumber(thTemp, thBtn);
    const secTh = h('section', { class: 'fs-section rd-sec', 'aria-label': 'Food thermometer check' }, h('h3', { class: 'fs-h' }, 'Food thermometer check'), methodSeg, h('div', { class: 'hc-fld' }, thTemp), thBtn);

    // 3. Sanitizer strip
    const ppmStep = SB.ui.stepper({ value: rec.ppm, min: 0, max: 5000, step: 25, bigStep: 100, unit: 'ppm', label: 'Sanitizer strip reading in parts per million' });
    const prodF = nameField('Sanitizer (optional)', 'products', 'Quat, chlorine');
    const whereF = nameField('Where (optional)', 'places', 'Prep sink, bucket');
    // Logs the strip reading and marks surfaces as sanitized.
    const sanBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'log-strip' }, onClick: () => withWho('Log strip reading', (who) => {
      const product = prodF.input.value.trim(), where = whereF.input.value.trim(), ppm = ppmStep.getValue();
      const res = run('sanitizeDone', Object.assign({ ppm }, product ? { product } : {}, where ? { where } : {}, who ? { who } : {}));
      if (res.report === 'ok') { rec.ppm = ppm; remember(rec, 'products', product); remember(rec, 'places', where); save(rec); prodF.paint(); whereF.paint(); }
      if (res.report === 'ok') ppmGate.reset();
      done(res, 'Strip reading logged: ' + ppm + ' ppm. Surfaces are marked sanitized.');
    }) }, ico('shield-check', 22), h('span', null, 'Log strip reading'));
    const ppmGate = needsNumber(ppmStep, sanBtn);
    const secSan = h('section', { class: 'fs-section rd-sec', 'aria-label': 'Sanitizer strip' }, h('h3', { class: 'fs-h' }, 'Sanitizer strip'),
      h('p', { class: 'fs-sub' }, 'Type the number on the strip. Saving this also marks surfaces as sanitized.'), h('div', { class: 'hc-fld' }, ppmStep), prodF.el, whereF.el, sanBtn);

    // The last few readings with who wrote them. Fix adds a note next to the entry; nothing is erased.
    function paintRecent() {
      U.clear(recent);
      const rows = (SB.engine.safetyLog ? SB.engine.safetyLog(SB.store.getState()) : []).filter((r) => KIND_WORD[r.event.type]).slice(-6).reverse();
      if (!rows.length) { recent.appendChild(h('p', { class: 'fs-sub' }, 'No readings yet.')); return; }
      rows.forEach((r) => {
        const e = r.event;
        const what = e.type === 'equip_temp' ? (e.label || (UNITS.find((u) => u.id === e.unit) || {}).label || 'Fridge') + ': ' + U.tempText(e.f)
          : e.type === 'thermometer_checked' ? 'Thermometer check: ' + U.tempText(e.f) : 'Sanitizer strip' + (U.isNum(e.ppm) ? ': ' + e.ppm + ' ppm' : '') + (e.product ? ', ' + e.product : '') + (e.where ? ', ' + e.where : '');
        const fixed = r.corrections.length ? ' (fixed: ' + r.corrections[r.corrections.length - 1].note + ')' : '';
        const fixBox = h('div', { class: 'rd-fix', hidden: true });
        const note = h('input', { class: 'input', type: 'text', maxlength: '120', 'aria-label': 'What was wrong', placeholder: 'What was wrong' });
        // Shows or hides the box where a fix is typed.
        const fixBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => { fixBox.hidden = !fixBox.hidden; if (!fixBox.hidden) note.focus(); } }, 'Fix');
        // Saves the fix as a note next to the entry.
        const saveFix = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => withWho('Save fix', (who) => {
          const res = run('correctSafety', { eventId: e.id, note: note.value, who: who || (SB.who && SB.who.get()) || 'NA' });
          done(res, 'Fix saved next to the entry.');
        }) }, 'Save fix');
        fixBox.append(note, saveFix);
        recent.appendChild(h('div', { class: 'rd-row' }, h('div', { class: 'rd-line' }, h('span', { class: 'num' }, U.fmtTime(e.t)), h('span', { class: 'rd-what' }, what + (e.who ? ', ' + e.who : '') + fixed), fixBtn), fixBox));
      });
    }
    paintRecent();
    sheet.body.append(h('div', { class: 'rd' }, h('p', { class: 'fs-sub' }, 'Write down what the thermometer or strip says. Each entry goes in the safety record with your initials.'), status, secEq, secTh, secSan, h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Recent readings'), recent)));
    return sheet;
  }
  SB.sheets.register('readings', openReadings);
})(typeof globalThis !== 'undefined' ? globalThis : window);
