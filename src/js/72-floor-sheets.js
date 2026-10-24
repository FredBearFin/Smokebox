/*
 * WHAT THIS FILE IS: The seven helper screens of the line: Hold cabinet, 86 board and stock, Recall, Demo and
 * clock, Help, Specs and Settings. Each is a sheet (a panel that slides over the board) opened by name.
 * PARTS: shared helpers, tab helper, Hold cabinet (with the New batch form), 86 board, Recall, Demo, Help,
 * Specs, Settings.
 * USES / USED BY: 10-config.js, 20-engine.js, 30-store.js, 60-shell.js; SB.sim and SB.floor are optional.
 * Opened by 70-floor-board.js and 71-floor-order.js through SB.sheets.open(name).
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const doc = g.document;
  if (!doc) return; // Node: these sheets are DOM only

  const U = SB.util, C = SB.config, h = U.h;
  // Engine looked up late, so this file still loads if the engine module comes after it.
  const E = () => SB.engine;
  // Builds an icon picture by name; a missing icon gives an empty span so the screen still draws.
  const ico = (name, size, o) => { try { return SB.icons.svg(name, Object.assign({ size: size || 20 }, o || {})); } catch (e) { return doc.createElement('span'); } };
  // The current state (everything the app knows right now).
  const st = () => SB.store.getState();
  // The kitchen clock in milliseconds. In a demo it can run faster than real time.
  const nowMs = () => SB.store.now();
  // Writes text only when it changed, so nothing is redrawn for no reason.
  const text = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
  // Sets an attribute only when its value changed.
  const attr = (el, k, v) => { if (el && el.getAttribute(k) !== String(v)) el.setAttribute(k, String(v)); };
  // Shows or hides a piece of the screen only when its state really changed.
  const setHidden = (el, on) => { if (el && el.hidden !== !!on) el.hidden = !!on; };
  // Adds or removes a style class only when needed.
  const cls = (el, name, on) => { if (el && el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on); };
  const pad2 = U.pad2;
  // Sends an action to the store as the person using the screen and returns the full answer.
  const run = (type, payload) => SB.store.dispatchEx(type, payload, { source: 'ui' });
  // Turns an engine answer into the plain-words message for the screen.
  const say = (res) => E().describe(res.report, res.info, st().settings);
  // The food-safety limits in force: the owner's settings if present, else the starter values.
  const safety = () => (st().settings && st().settings.safety) || C.safety;
  // True when the cook-ahead part should show: the module is on (absent means on) or a batch still holds food.
  const cookOn = () => (E().cookAheadActive ? E().cookAheadActive(st()) : !E().moduleOn || E().moduleOn(st(), 'cookAhead') || st().batches.some((b) => b.status !== 'discard' && b.remainingG > 0));
  // Shows a short message at the bottom; tone is ok, warn, bad or info.
  const toast = (msg, tone, extra) => SB.ui.toast(msg, Object.assign({ tone: tone || 'info' }, extra || {}));
  // Removes the standard safety line from a message, because the screen already shows it once.
  const stripSafety = (s) => String(s || '').split(' ' + C.safetyLine).join('').split(C.safetyLine).join('').trim();
  // True on a mouse or stylus screen. A touch screen must not pop up its keyboard by itself.
  const fineAny = () => { try { return g.matchMedia('(pointer: fine)').matches; } catch (e) { return false; } };
  // A fresh id used to link a tab to its panel.
  const uid = (p) => U.uid(p || 'fs');

  // A temperature in words, like 155 degrees F, or 'no reading'.
  // The weight word for the chosen unit, "kg" or "lb", used in cost-per-weight lines.
  const unitW = () => (U.units.weight === 'lb' ? 'lb' : 'kg');
  // A price stored per kilogram, as the price per shown unit (per pound when pounds are chosen).
  const perUnit = (perKg) => (U.units.weight === 'lb' && U.isNum(perKg) ? perKg * 0.45359237 : perKg);
  const fmtF = (f) => (U.isNum(f) ? U.tempText(f) : 'no reading');
  // 7500 s -> "2 h 05 min"; 90 s -> "2 min"; 20 s -> "20 s" (always rounded up to
  // the minute from a minute on, so a countdown never reads 0 early).
  function hmLong(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' s';
    const m = Math.ceil(s / 60), hh = Math.floor(m / 60);
    if (hh > 0) return hh + ' h ' + pad2(m % 60) + ' min';
    return m + ' min';
  }
  // Elapsed time, floored: "2h 10m" or "45m".
  function hmShort(ms) {
    const m = Math.max(0, Math.floor(ms / 60000)), hh = Math.floor(m / 60);
    return hh > 0 ? hh + 'h ' + pad2(m % 60) + 'm' : m + 'm';
  }
  // How long ago, in plain words (just now, 5 min ago).
  const agoText = (ms) => (ms < 45e3 ? 'just now' : hmLong(ms) + ' ago');
  // A percentage rounded to d decimals, without a trailing zero.
  const pctText = (x, d) => { const f = Math.pow(10, d || 0); return Math.round(x * f) / f + '%'; };
  const plural = U.plural;

  // Finds an ingredient by id in the current state, or null.
  const ingOf = (id) => { const a = st().ingredients; for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; };
  // Name of an ingredient for messages; an unknown id is shown as it is.
  const ingName = (id) => { const i = ingOf(id); return i ? i.name : id || 'That ingredient'; };
  // Finds a menu item by id in the current state, or null.
  const menuOf = (id) => { const a = st().menu; for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; };
  // An amount in words: pieces for counted items (cornbread), otherwise grams or kilograms.
  const qtyText = (ing, gm) => (ing && ing.unit === 'ea' ? Math.round(gm) + ' ' + plural(Math.round(gm), 'piece') : U.weightText(gm));
  // Order channel details for an id, with a safe fallback.
  const channelOf = (id) => C.channelById[id] || { name: id || 'Order', icon: 'plate' };

  // Briefly highlights an element so the eye finds what changed.
  function flash(el) {
    if (!el) return;
    el.classList.remove('fs-flash'); void el.offsetWidth; el.classList.add('fs-flash');
    // Removes the highlight when its animation ends.
    const done = () => { el.classList.remove('fs-flash'); el.removeEventListener('animationend', done); };
    el.addEventListener('animationend', done);
  }
  function stateEl(tone, icon, word) {
    return h('span', { class: 'fs-state', dataset: { tone } }, ico(icon, 20), h('span', null, word));
  }
  // Replace the contents of a status span only when the icon or word changed.
  function setState(el, tone, icon, word) {
    const key = tone + '|' + icon + '|' + word;
    if (el._key === key) return;
    el._key = key; el.setAttribute('data-tone', tone);
    U.clear(el); el.append(ico(icon, 20), h('span', null, word));
  }
  // The standard food-safety guidance box; extra text can go above the line.
  function safetyNote(extra) {
    return h('div', { class: 'fs-note fs-safety' }, ico('shield-check', 20), h('div', null, extra ? h('p', null, extra) : null, h('p', null, C.safetyLine)));
  }

  // Keep `parent`'s children in the order of `items`. New keys are created
  // with make(item); existing nodes are never replaced and only
  // move when the order changed; keys that are gone are removed. Returns
  // nothing: the Map holds the records ({el, destroy?}).
  function reconcile(parent, map, items, keyOf, make, update) {
    const seen = new Set();
    let ref = parent.firstElementChild;
    for (let i = 0; i < items.length; i++) {
      const it = items[i], k = keyOf(it);
      seen.add(k);
      let rec = map.get(k);
      if (!rec) { rec = make(it); map.set(k, rec); }
      if (update) update(rec, it);
      if (rec.el === ref) ref = ref.nextElementSibling;
      else parent.insertBefore(rec.el, ref);
    }
    map.forEach((rec, k) => { if (!seen.has(k)) { rec.el.remove(); if (rec.destroy) rec.destroy(); map.delete(k); } });
  }

  // Subscribe helper: offs collects every unsubscribe so a sheet cleans up in one place.
  function watch(offs, fn, tickFn) {
    offs.push(SB.store.subscribe(fn));
    if (tickFn) offs.push(SB.store.subscribeTick(tickFn));
  }

  // What would change on the menu if this action ran now? apply()
  // is pure, so the live state is never touched.
  function whatIf(type, payload) {
    try {
      const s0 = st(), r = E().apply(s0, type, payload, nowMs());
      if (r.report !== 'ok') return null;
      const off = [], on = [];
      s0.menu.forEach((m) => {
        if (m.archived) return;
        const a = s0.avail[m.id], b = r.state.avail[m.id];
        if (!a || !b) return;
        if (a.ok && !b.ok) off.push(m.short || m.name); else if (!a.ok && b.ok) on.push(m.short || m.name);
      });
      return { off, on };
    } catch (e) { return null; }
  }
  // A short list in words: up to three names, then 'and N more'.
  // Ends a sentence with one period, even when the last word is an abbreviation that already has one.
  const endDot = (s) => (/[.!?]$/.test(s) ? s : s + '.');
  const listWords = (a) => (a.length <= 3 ? a.join(', ') : a.slice(0, 3).join(', ') + ' and ' + (a.length - 3) + ' more');

  // The id of the engine's newest undo record, or null (the action an Undo button would revert right now).
  function topUndoId() {
    const s = st(), u = s && Array.isArray(s.undo) ? s.undo : [];
    return u.length && u[u.length - 1] ? u[u.length - 1].id || null : null;
  }
  // Toast with Undo that runs the engine's own undo.
  // WATCH OUT: the engine only undoes its newest action. The toast remembers which record that was when it was raised,
  // and refuses when another action (from another tablet, say) came after, so Undo never reverts what it does not name.
  function undoToast(msg, tone) {
    const mine = topUndoId();
    toast(msg, tone || 'ok', {
      // Undo asks the engine to undo its newest action (only the newest one can be undone).
      undo: () => {
        if (mine && topUndoId() !== mine) { toast('Cannot undo: something else was done after it. Fix it by hand instead.', 'warn'); return; }
        const r = run('undo', {});
        if (r.report !== 'ok') toast(say(r), 'warn'); else SB.ui.announce('Undone.');
      },
    });
  }

  // A small centered dialog with a body, a confirm button and Cancel. Returns the sheet api.
  function dialog(o) {
    const sh = SB.ui.sheet({ title: o.title, side: 'center', width: o.width || 480, name: o.name || 'dialog', role: o.role, opener: o.opener, onClose: o.onClose });
    const copy = h('div', { class: 'sheet-copy fs-dialog' });
    (Array.isArray(o.body) ? o.body : [o.body]).forEach((p) => { if (p != null) copy.appendChild(p.nodeType ? p : h('p', null, String(p))); });
    sh.body.appendChild(copy);
    // Cancel closes the dialog and changes nothing.
    const cancel = h('button', { type: 'button', class: 'btn', onClick: () => sh.close('cancel') }, o.cancelLabel || 'Cancel');
    // The confirm button; the caller decides what confirming does.
    const ok = h('button', { type: 'button', class: 'btn ' + (o.tone === 'danger' ? 'btn-danger' : 'btn-primary'), onClick: () => o.onConfirm(sh, ok) }, ico(o.icon || (o.tone === 'danger' ? 'trash' : 'check'), 20), h('span', null, o.confirmLabel || 'Confirm'));
    sh.footer.append(cancel, ok);
    return { sheet: sh, ok, cancel, copy };
  }

  // Browser-storage key for the initials of whoever is working the cabinet; remembered per tablet.
  const KEY_WHO = 'smokebox.v1.initials';
  // Initials stay on the tablet for 2 hours of the app clock after their last use, so a shared tablet does not carry one person's name into the next shift.
  const WHO_IDLE_MS = 2 * 3600e3;
  // The remembered initials, or empty when none are saved or they have sat idle for more than 2 hours.
  function savedWho() {
    const v = U.storage.get(KEY_WHO, null);
    if (!v || typeof v !== 'object' || typeof v.who !== 'string' || !U.isNum(v.at)) return '';
    const age = nowMs() - v.at;
    return age >= 0 && age <= WHO_IDLE_MS ? v.who : '';
  }
  // Remembers the initials just used, with the time of use (an empty string forgets them).
  function saveWho(who) { U.storage.set(KEY_WHO, { who, at: nowMs() }); }
  // Runs then(who) with the initials for a safety action. Asked once per tablet (and again after 2 idle hours); a
  // person can skip, and the action still goes ahead without initials. With the cook-ahead part off nothing is asked.
  function askWho(opener, verb, then) {
    if (!cookOn()) { then(''); return; }
    const pre = savedWho();
    if (pre) { saveWho(pre); then(pre); return; }
    const input = h('input', { class: 'input', type: 'text', maxlength: '12', autocomplete: 'off', placeholder: 'Your initials, like JM', 'aria-label': 'Your initials' });
    let dl = null, done = false;
    // Finishes once: closes the box and carries on with the given initials.
    const go = (w) => { if (done) return; done = true; if (w) saveWho(w); dl.sheet.close('confirm'); then(w); };
    dl = dialog({ title: 'Who is this?', name: 'who', opener, confirmLabel: verb, icon: 'check',
      body: [h('p', null, 'Your initials go next to this entry in the log. You are asked once on this tablet. Tap Switch person in the cabinet to change them.'), h('div', { class: 'hc-fld' }, h('div', { class: 'field-label' }, 'Your initials'), input)],
      // Confirming carries on with the initials as typed.
      onConfirm: () => go(input.value.trim()) });
    dl.ok.disabled = true;
    input.addEventListener('input', () => { dl.ok.disabled = !input.value.trim(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) go(input.value.trim()); });
    // Skip carries on without initials, so a missing name never blocks a temperature check or a discard.
    const skipWho = () => go('');
    dl.sheet.footer.insertBefore(h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'skip-who' }, onClick: skipWho }, 'Skip'), dl.ok);
    setTimeout(() => input.focus(), 50);
  }
  // The last temperature check of each batch, "JM 2:40 pm", worked out once per change of the event list (not every second).
  let checkMemo = { key: null, map: new Map() };
  // Names who last logged a temperature on a batch and when (initials first when known); empty if nothing is logged.
  function lastCheckBy(batchId) {
    const evs = st().events;
    const key = evs && evs.length + ':' + (evs.length ? evs[evs.length - 1].id : '');
    if (checkMemo.key !== key) {
      const map = new Map();
      for (const row of E().safetyLog ? E().safetyLog(st()) : []) {
        const e = row.event;
        if (e.batchId && (e.type === 'temp_logged' || e.type === 'batch_reheat')) map.set(e.batchId, (e.who ? e.who + ' ' : '') + U.fmtTime(e.t));
      }
      checkMemo = { key, map };
    }
    return checkMemo.map.get(batchId) || '';
  }
  SB.who = { get: savedWho, set: saveWho, ask: askWho };

  // Close a sheet, then do something one frame later (so the history entry
  // of the closing sheet is gone before a new one is pushed).
  function closeThen(sheet, fn) { sheet.close('link'); setTimeout(fn, 60); }

  // Run a tab-style segmented control with panels. Returns {seg, show(id)}.
  function tabsWithPanels(label, defs, start, onShow) {
    const seg = SB.ui.segmented({ kind: 'tabs', label, class: 'fs-tabs', options: defs.map((d) => ({ id: d.id, label: d.label, icon: d.icon, count: d.count, alert: d.alert, alertLabel: d.alertLabel })), value: start, onChange: (id) => show(id, true) });
    const panels = {};
    defs.forEach((d) => {
      const pid = uid('panel');
      d.panel.id = pid; d.panel.setAttribute('role', 'tabpanel'); d.panel.setAttribute('tabindex', '-1');
      const tab = seg.querySelector('[data-id="' + d.id + '"]');
      if (tab) { tab.setAttribute('aria-controls', pid); if (!tab.id) tab.id = pid + '-tab'; d.panel.setAttribute('aria-labelledby', tab.id); }
      panels[d.id] = d.panel;
    });
    // Shows one panel and hides the others; user is true when the person tapped the tab.
    function show(id, user) {
      Object.keys(panels).forEach((k) => setHidden(panels[k], k !== id));
      if (!user) seg.setValue(id);
      if (onShow) onShow(id, !!user);
    }
    show(start, false);
    return { seg, show, panels };
  }

  // Words for each waste reason the engine can record (reason id on the left).
  // audit:data-start
  const REASON_WORDS = {
    expired: 'Past its hold time', temp: 'Temperature out of range', cooling: 'Cooling missed',
    manual: 'Cleared by hand', quality: 'Quality', other: 'Other',
  };
  // audit:data-end

  // Hold cabinet.
  // Word and icon for each kind of batch in the cabinet.
  // audit:data-start
  const KIND_WORD = { hot: 'Hot hold', cold: 'Cold hold', cooling: 'Cooling' };
  const KIND_ICON = { hot: 'flame', cold: 'snow', cooling: 'snow' };
  // audit:data-end
  const H1 = 3600e3;

  // The safety settings with every default filled in, the same way the engine and the warnings read them.
  const fullSafety = () => Object.assign({}, C.safety, safety());
  // The hard cap in hours: no batch stays longer than this, whatever its own limit (engine hardCapH).
  const hardCapH = () => { const S = fullSafety(); return U.isNum(S.hardCapH) ? S.hardCapH : S.defaultMaxHoldH; };
  // How long a batch may stay in the cabinet: the engine's own number (its limit, or the default, capped by the hard
  // cap), so the card shows the time the engine will act on.
  const holdLimitMs = (b) => E()._internal.holdLimitMs(b, fullSafety());
  // True when going past the limit only takes the batch off the menu for a check (a quality limit below the hard cap);
  // otherwise the batch is thrown out at that time.
  const qualityStage = (b) => b.fridge !== true && b.holdBasis === 'quality' && (U.isNum(b.maxHoldH) ? b.maxHoldH : fullSafety().defaultMaxHoldH) < hardCapH();
  // A number with at most one decimal, like 1.5 or 2.
  const trimNum = (n) => String(Math.round(n * 10) / 10);

  // Picks the word, icon and colour for a batch from the engine's verdict.
  // WATCH OUT: colour is never the only signal, the word is always shown too.
  function statusView(b, gt) {
    if (b.kind === 'cooling') {
      if (gt.reason === 'cooled') return { tone: 'ok', icon: 'check-circle', word: 'Cooled' };
      if (gt.action === 'DISCARD_LOCKOUT') return { tone: 'bad', icon: 'alert', word: 'Discard' };
      if (gt.action === 'REHEAT_IMMEDIATE') return { tone: 'bad', icon: 'flame', word: 'Reheat or discard' };
      return { tone: 'warn', icon: 'snow', word: 'Cooling' };
    }
    switch (gt.action) {
      case 'NONE': return { tone: 'ok', icon: 'check-circle', word: 'In range' };
      case 'CHECK_TEMP': return { tone: gt.severity === 'bad' ? 'bad' : 'warn', icon: 'thermometer', word: 'Check temp' };
      case 'REHEAT_IMMEDIATE': return { tone: 'bad', icon: 'flame', word: 'Reheat now' };
      case 'CHILL_NOW': return { tone: 'bad', icon: 'snow', word: 'Chill now' };
      case 'PAST_QUALITY': return { tone: 'bad', icon: 'alert', word: 'Past quality limit' };
      default: return { tone: 'bad', icon: 'alert', word: 'Discard' };
    }
  }

  // The one-line verdict under the temperature stepper, so the cook
  // sees what a reading will mean before saving it.
  function tempHint(b, mode, f) {
    const S = safety();
    if (mode === 'reheat') {
      return f >= S.reheatF
        ? { tone: 'ok', text: U.tempText(f) + ' counts as a reheat. The batch can be served again.' }
        : { tone: 'warn', text: 'A reheat needs at least ' + U.tempText(S.reheatF) + '. Keep heating, then log it.' };
    }
    if (b.kind === 'cooling') {
      const c = S.cooling || C.safety.cooling;
      if (b.stage1At == null) return f <= c.stage1ToF ? { tone: 'ok', text: U.tempText(f) + ' reaches step 1 of 2 (' + U.tempText(c.stage1ToF) + ' or below).' } : { tone: 'warn', text: 'Stage 1 needs ' + U.tempText(c.stage1ToF) + ' or below. Keep chilling.' };
      return f <= c.finalF ? { tone: 'ok', text: U.tempText(f) + ' finishes step 2 of 2 (' + U.tempText(c.finalF) + ' or below).' } : { tone: 'warn', text: 'Stage 2 needs ' + U.tempText(c.finalF) + ' or below. Keep chilling.' };
    }
    if (b.kind === 'cold') {
      return f > S.coldHoldF ? { tone: 'bad', text: 'Above ' + U.tempText(S.coldHoldF) + '. The batch goes on Chill now and stops being served.' } : { tone: 'ok', text: 'In range (' + U.tempText(S.coldHoldF) + ' or below).' };
    }
    if (f < S.hotHoldF) return { tone: 'bad', text: 'Below ' + U.tempText(S.hotHoldF) + '. The batch goes on Reheat now and stops being served.' };
    if (b.outSince != null && f >= S.reheatF && !(b.reheats >= 1)) return { tone: 'ok', text: U.tempText(f) + ' counts as the reheat (one reheat only).' };
    return { tone: 'ok', text: 'In range (' + U.tempText(S.hotHoldF) + ' or above).' };
  }
  // The temperature the editor starts at: the last reading, or a typical value for that kind of batch.
  const defaultTemp = (b) => (U.isNum(b.lastTempF) ? b.lastTempF : b.kind === 'cold' ? 38 : b.kind === 'cooling' ? 70 : 150);

  // Builds the Hold cabinet: one card per batch plus the New batch form.
  // opts can pick the New batch tab, a product, or a batch to highlight.
  function buildHold(sheet, opts) {
    opts = opts || {};
    const offs = [];
    const cards = new Map();
    const recents = new Map();
    let tabs = null, form = null;

    // Batches panel.
    const summary = h('p', { class: 'hc-summary', role: 'status' });
    const grid = h('div', { class: 'hc-grid' });
    // An empty cabinet offers a button straight to the New batch tab.
    const emptyBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: () => tabs.show('new', false) }, ico('plus', 22), h('span', null, 'New batch'));
    const empty = h('div', { class: 'empty hc-empty', hidden: true }, ico('thermometer', 40), h('h3', null, 'The cabinet is empty'), h('p', null, 'Add a batch when food is cooked and goes into the cabinet. Every batch starts with a temperature reading.'), emptyBtn);
    const recentList = h('div', { class: 'fs-list hc-recents' });
    // The recent list links to the full thrown-out log, the table an inspector reads.
    const logBtn = h('button', { type: 'button', class: 'btn', dataset: { act: 'discard-log' }, onClick: () => closeThen(sheet, () => SB.sheets.open('discards')) }, ico('receipt', 20), h('span', null, 'Open the thrown-out log'));
    const recentHead = h('h3', { class: 'fs-h' }, 'Discarded recently');
    const recentBox = h('section', { class: 'fs-section', hidden: true }, recentHead, recentList, logBtn);
    // Batches still to come: a run-out with no batch planned asks when one will be ready; plans can be cancelled.
    const planList = h('div', { class: 'fs-list hc-plans' });
    const planBox = h('section', { class: 'fs-section hc-planbox', hidden: true }, h('h3', { class: 'fs-h' }, 'Batches still to come'), planList);
    let planSig = '';
    const batchesPanel = h('div', { class: 'hc-panel' }, summary, planBox, grid, empty, recentBox);

    // New batch panel.
    form = buildBatchForm((batchId) => {
      tabs.show('batches', false); update(nowMs());
      const rec = cards.get(batchId);
      if (rec) { rec.el.scrollIntoView({ block: 'nearest' }); flash(rec.el); }
    }, opts);
    const newPanel = form.el;

    tabs = tabsWithPanels('Hold cabinet', [
      { id: 'batches', label: 'In the cabinet', icon: 'thermometer', count: 0, panel: batchesPanel },
      { id: 'new', label: 'New batch', icon: 'plus', panel: newPanel },
    ], opts.tab === 'new' ? 'new' : 'batches', (id) => { setHidden(sheet.footer, id !== 'new' || !st().ingredients.some((i) => i.tcs && !i.archived)); if (id === 'new') form.shown(); });

    if (sheet.header && SB.ui.sheetHelp) SB.ui.sheetHelp(sheet, 'hold-cabinet-and-warnings', 'the hold cabinet');
    // Who is working the cabinet: the remembered initials with a one-tap Switch person (asked again at the next entry).
    const whoText = h('span', null, '');
    const whoBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', dataset: { act: 'switch-who' }, onClick: () => { saveWho(''); paintWho(); } }, 'Switch person');
    const whoLine = h('div', { class: 'hc-who', hidden: true }, ico('check-circle', 18), whoText, whoBtn);
    // Shows the line only while initials are remembered.
    function paintWho() { const w = savedWho(); setHidden(whoLine, !w); text(whoText, 'Entries are saved as ' + w + '.'); }
    paintWho();
    const hcNote = safetyNote();
    // The cabinet page (no sheet header) carries the "?" inside its note line instead.
    if (!sheet.header && SB.guide && SB.guide.link) hcNote.appendChild(SB.guide.link('hold-cabinet-and-warnings', 'the hold cabinet'));
    sheet.body.append(h('div', { class: 'hc' }, hcNote, whoLine, tabs.seg, batchesPanel, newPanel));
    sheet.footer.append(form.footer);
    setHidden(sheet.footer, tabs.seg.getValue() !== 'new' || !st().ingredients.some((i) => i.tcs && !i.archived));

    // Builds one batch card once (ring, meter, facts, message, cooling steps, buttons).
    // updateCard fills it in and keeps it current.
    function makeCard(b) {
      const rec = { id: b.id, mode: null, ed: null, el: null };
      const name = h('h3', { class: 'hc-name' });
      const kindEl = h('span', { class: 'hc-kind' });
      const srcChip = h('span', { class: 'chip', hidden: true });
      const status = h('span', { class: 'fs-state hc-status' });
      const ringT = h('span', { class: 'hc-ring-t num' }), ringS = h('span', { class: 'hc-ring-s' });
      const ring = h('div', { class: 'hc-ring', role: 'img' }, h('span', { class: 'hc-ring-in' }, ringT, ringS));
      const meter = SB.ui.meter({ value: 0, max: 1, label: 'Left in this batch' });
      const stockT = h('div', { class: 'hc-stock-t num' });
      // Two extra facts: when to serve it by (and what kind of limit that is), and when it finishes resting.
      const dtServe = h('dt', null, 'Serve by'), ddServe = h('dd', { class: 'num' }), dtRest = h('dt', null, 'Resting until'), ddRest = h('dd', { class: 'num' });
      dtRest.hidden = true; ddRest.hidden = true;
      const ddLast = h('dd', { class: 'num' }), dtNext = h('dt'), ddNext = h('dd', { class: 'num' }), ddSince = h('dd', { class: 'num' });
      const costLine = h('p', { class: 'hc-cost', hidden: true });
      const msgIcon = h('span', { class: 'hc-msg-i' }), msgT = h('span', { class: 'hc-msg-t' });
      const msg = h('div', { class: 'fs-note hc-msg', hidden: true }, msgIcon, h('div', null, msgT));
      const lock = h('div', { class: 'hc-lock', hidden: true }, ico('ban', 18), h('span', null, 'Not being served. Menu items made from it are 86 until it is fixed.'));
      const step1 = h('div', { class: 'hc-step' }), step2 = h('div', { class: 'hc-step' });
      const cool = h('div', { class: 'hc-cool', hidden: true }, h('div', { class: 'hc-cool-t' }, 'Two-stage cooling'), step1, step2);
      const bLog = h('button', { type: 'button', class: 'btn', dataset: { act: 'log' } }, ico('thermometer', 20), h('span', null, 'Log temp'));
      const bReheat = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'reheat' }, hidden: true }, ico('flame', 20), h('span', null, 'Reheat'));
      const bCool = h('button', { type: 'button', class: 'btn', dataset: { act: 'cool' }, hidden: true }, ico('snow', 20), h('span', null, 'Start cooling'));
      const bDiscard = h('button', { type: 'button', class: 'btn hc-discard', dataset: { act: 'discard' } }, ico('trash', 20), h('span', null, 'Discard'));
      // Past its quality limit: taste it, then keep serving. While kept, a small link corrects a mistaken tap.
      const bKeep = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'keep' }, hidden: true }, ico('check-circle', 20), h('span', null, 'Keep serving'));
      const bUnkeep = h('button', { type: 'button', class: 'btn', dataset: { act: 'unkeep' }, hidden: true }, ico('x', 20), h('span', null, 'Correct: not kept'));
      const dtKept = h('dt', null, 'Kept serving'), ddKept = h('dd', { class: 'num' });
      dtKept.hidden = true; ddKept.hidden = true;
      // A cold item kept in a fridge has a Take out / Put back main action and a line that says how long it has been out.
      const bOut = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'take-out' }, hidden: true }, ico('arrow-right', 20), h('span', null, 'Take out'));
      const bBack = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'put-back' }, hidden: true }, ico('snow', 20), h('span', null, 'Put back'));
      const coldLine = h('p', { class: 'hc-cold', hidden: true });
      const dtSince = h('dt', null, 'In the cabinet since');
      const pullT = h('span', null, 'Pull');
      const bPull = h('button', { type: 'button', class: 'btn', dataset: { act: 'pull' }, hidden: true }, ico('package', 20), pullT);
      // Early warnings can be put off ("remind me later") while a batch is still on the menu and its last warning is not yet due.
      const snoozeT = h('span', null, 'Remind me in 10 min');
      const bSnooze = h('button', { type: 'button', class: 'btn', dataset: { act: 'snooze' }, hidden: true }, ico('clock', 20), snoozeT);
      const unsnoozeT = h('span', null, 'Cancel reminder');
      const bUnsnooze = h('button', { type: 'button', class: 'btn', dataset: { act: 'unsnooze' }, hidden: true }, ico('x', 20), unsnoozeT);
      // One main action per card; every other action sits behind the "..." button so all cards look the same.
      const bMore = h('button', { type: 'button', class: 'btn btn-icon hc-more', dataset: { act: 'more' }, 'aria-label': 'More for this batch', title: 'More', hidden: true }, ico('more', 22));
      const actions = h('div', { class: 'hc-actions' }, bKeep, bOut, bBack, bUnkeep, bSnooze, bUnsnooze, bPull, bLog, bReheat, bCool, bDiscard, bMore);
      const editorSlot = h('div', { class: 'hc-editor-slot' });
      // Card layout: heading, ring and facts, message and lock note, cooling steps, then the buttons.
      const el = h('article', { class: 'hc-card', dataset: { batch: b.id, tone: 'ok' }, 'aria-label': 'Batch' },
        h('header', { class: 'hc-head' }, h('div', { class: 'hc-title' }, kindEl, name, srcChip), status),
        h('div', { class: 'hc-body' }, ring,
          h('div', { class: 'hc-facts' }, h('div', { class: 'hc-stock' }, meter, stockT),
            h('dl', { class: 'fs-dl hc-dl' }, h('dt', null, 'Last reading'), ddLast, dtNext, ddNext, dtSince, ddSince, dtServe, ddServe, dtRest, ddRest, dtKept, ddKept))),
        coldLine, costLine, msg, lock, cool, actions, editorSlot);
      rec.bMore = bMore; rec.bPull = bPull; rec.bOut = bOut; rec.bBack = bBack; rec.coldLine = coldLine; rec.dtSince = dtSince;
      rec.acts = [bKeep, bOut, bBack, bReheat, bLog, bUnkeep, bSnooze, bUnsnooze, bPull, bCool, bDiscard];
      Object.assign(rec, { el, name, kindEl, srcChip, status, ring, ringT, ringS, meter, stockT, ddLast, dtNext, ddNext, ddSince, dtServe, ddServe, dtRest, ddRest, dtKept, ddKept, bKeep, bUnkeep, bSnooze, bUnsnooze, unsnoozeT, costLine, msg, msgIcon, msgT, lock, cool, step1, step2, bPull, pullT, bLog, bReheat, bCool, bDiscard, editorSlot });
      // The "..." button lists the secondary actions that are available right now; choosing one presses that button.
      bMore.addEventListener('click', () => {
        const items = rec.acts.filter((a) => !a.hidden && a !== rec.primary).map((a) => ({ label: a.textContent.trim(), icon: a.dataset.act === 'discard' ? 'trash' : 'chevron-right', onClick: () => a.click() }));
        if (items.length) SB.ui.menu(bMore, items, { label: 'More for this batch' });
      });
      bLog.addEventListener('click', () => toggleEditor(rec, 'log'));
      bReheat.addEventListener('click', () => toggleEditor(rec, 'reheat'));
      bCool.addEventListener('click', () => { const bb = batchOf(rec.id); if (bb) openCooling(bb, bCool); });
      bDiscard.addEventListener('click', () => { const bb = batchOf(rec.id); if (bb) openDiscard(bb, bDiscard); });
      bPull.addEventListener('click', () => { const bb = batchOf(rec.id); if (bb) pullFrom(bb); });
      bOut.addEventListener('click', () => moveCold(rec.id, 'coldTakeOut', bOut));
      bBack.addEventListener('click', () => moveCold(rec.id, 'coldReturn', bBack));
      bKeep.addEventListener('click', () => openKeep(rec.id, bKeep));
      bUnkeep.addEventListener('click', () => openUnkeep(rec.id, bUnkeep));
      // Puts the early warnings off for 10 minutes, or cancels that, and says what happened.
      bSnooze.addEventListener('click', () => { const res = run('snoozeAlert', { batchId: rec.id, forMin: 10 }); if (res.report !== 'ok') toast(say(res), 'warn'); else toast('Reminder at ' + U.fmtTime(res.info.until) + '. The last warning still sounds on time.', 'ok'); update(nowMs()); });
      bUnsnooze.addEventListener('click', () => { const res = run('clearSnooze', { batchId: rec.id }); if (res.report !== 'ok') toast(say(res), 'warn'); update(nowMs()); });
      return rec;
    }
    // True when this is the oldest batch of its ingredient that can still be served: the one a pull comes from.
    function isPullSource(b) {
      if (!(b.remainingG > 0) || b.canServe !== true || b.status === 'discard' || b.kind === 'cooling') return false;
      const now = nowMs();
      // 1 while a batch is still resting, 0 once it is ready to serve.
      const rest = (x) => (U.isNum(x.restUntil) && x.restUntil > now ? 1 : 0);
      // The source is the first in line: ready batches before resting ones, then the oldest.
      return !st().batches.some((x) => x !== b && x.ing === b.ing && x.remainingG > 0 && x.canServe === true && x.status !== 'discard' && x.kind !== 'cooling' && (rest(x) < rest(b) || (rest(x) === rest(b) && x.enteredAt < b.enteredAt)));
    }
    // Takes a cold item out of the fridge or puts it back (asks for initials once), then says what happened with Undo.
    function moveCold(id, type, opener) {
      const b = batchOf(id);
      if (!b) return;
      askWho(opener, type === 'coldTakeOut' ? 'Take out' : 'Put back', (who) => {
        const res = run(type, who ? { batchId: id, who } : { batchId: id });
        if (res.report !== 'ok') { toast(say(res), 'warn'); return; }
        // When the move itself ended the batch (its limit had just run out), the cook is told so in the engine's own words.
        if (res.info && res.info.discarded) { toast((b.label || 'Batch') + ': ' + (res.info.words || 'Past your limit, so it was thrown out.'), 'warn'); return; }
        undoToast((b.label || 'Batch') + (type === 'coldTakeOut' ? ' taken out. The out-of-fridge clock is running.' : ' put back. The out-of-fridge clock is paused.'));
      });
    }
    // Takes one set unit (the product's pull size) out of the cabinet, oldest batch first, with Undo.
    function pullFrom(b) {
      const ing = ingOf(b.ing), g = ing && U.isNum(ing.pullG) ? ing.pullG : 1000;
      const res = run('pullBatch', { ing: b.ing, g });
      if (res.report === 'ok') { undoToast('Pulled ' + qtyText(ing, res.info.g) + ' of ' + (ing ? ing.name : b.ing) + '.' + (res.info.short > 0 ? ' The cabinet had ' + qtyText(ing, res.info.short) + ' less than a full unit.' : ''), 'ok'); update(nowMs()); }
      else toast(say(res), 'warn');
    }
    // Looks a batch up by id in the current state.
    const batchOf = (id) => st().batches.find((x) => x.id === id) || null;

    // Writes one cooling step: done (green), missed (red) or still open (amber).
    function stepLine(el, done, missed, doneText, openText, missedText) {
      if (done) setState(el, 'ok', 'check-circle', doneText);
      else if (missed) setState(el, 'bad', 'alert', missedText);
      else setState(el, 'warn', 'clock', openText);
    }

    // Refreshes one card from the batch and the engine's verdict. Only text and classes that changed are
    // touched, so a card is never rebuilt under a finger.
    // The expiry rows of the deadline feed by batch, rebuilt once per update.
    let feedByBatch = new Map();
    function updateCard(rec, b, now) {
      const S = safety();
      const gt = E().gate(b, now, S);
      const sv = statusView(b, gt);
      // Plain facts for a cold item kept in a fridge (null for every other batch, so hot cards stay as they were).
      const ci = typeof E().coldInfo === 'function' ? E().coldInfo(b, now) : null;
      text(rec.name, b.label || 'Batch');
      attr(rec.el, 'aria-label', (b.label || 'Batch') + ': ' + sv.word);
      if (rec.kindKey !== b.kind) { rec.kindKey = b.kind; U.clear(rec.kindEl); rec.kindEl.append(ico(KIND_ICON[b.kind] || 'flame', 18), h('span', null, KIND_WORD[b.kind] || 'Hold')); }
      const srcWord = b.src === 'sample' ? 'Demo batch' : ''; // starter stock is named once in the summary line, not on every card
      setHidden(rec.srcChip, !srcWord); if (srcWord) { text(rec.srcChip, srcWord); attr(rec.srcChip, 'data-tone', 'info'); }
      setState(rec.status, sv.tone, sv.icon, sv.word);
      attr(rec.el, 'data-tone', sv.tone); attr(rec.el, 'data-status', gt.status);

      // time in hold: a ring that fills towards the limit (the number inside says the same thing in words)
      let limitMs = holdLimitMs(b), since = b.enteredAt;
      if (b.kind === 'cooling') { const c = S.cooling || C.safety.cooling; limitMs = c.totalH * H1; since = U.isNum(b.coolStartAt) ? b.coolStartAt : b.enteredAt; }
      const elapsed = Math.max(0, now - since), frac = limitMs > 0 ? elapsed / limitMs : 0;
      const v = Math.min(100, frac * 100).toFixed(1);
      if (rec.ring._v !== v) { rec.ring._v = v; rec.ring.style.setProperty('--v', v); }
      attr(rec.ring, 'data-tone', frac >= 1 ? 'bad' : frac >= 0.75 ? 'warn' : 'ok');
      // The number a cook needs is the time LEFT; the ring still fills with the time used.
      const leftMs = limitMs - elapsed;
      text(rec.ringT, hmShort(Math.abs(leftMs))); text(rec.ringS, leftMs >= 0 ? 'left of ' + trimNum(limitMs / H1) + ' h' : 'past the ' + trimNum(limitMs / H1) + ' h');
      attr(rec.ring, 'aria-label', (b.kind === 'cooling' ? 'Time cooling: ' : 'Time in the cabinet: ') + hmLong(elapsed) + ' of ' + trimNum(limitMs / H1) + ' hours');
      // A cold item's ring counts the time out of the fridge against the owner's hours (no ring fill when no hours are set).
      if (ci) {
        const f2 = ci.outHours ? ci.outMs / (ci.outHours * H1) : 0, v2 = Math.min(100, f2 * 100).toFixed(1);
        if (rec.ring._v !== v2) { rec.ring._v = v2; rec.ring.style.setProperty('--v', v2); }
        attr(rec.ring, 'data-tone', ci.state === 'bad' ? 'bad' : ci.state === 'warn' ? 'warn' : 'ok');
        text(rec.ringT, hmShort(ci.outMs)); text(rec.ringS, ci.outHours ? 'of ' + trimNum(ci.outHours) + ' h out' : 'out, no limit');
        attr(rec.ring, 'aria-label', 'Time out of the fridge: ' + hmLong(ci.outMs) + (ci.outHours ? ' of ' + trimNum(ci.outHours) + ' hours' : ', no limit set'));
      }

      // what is left
      const left = b.cookedG > 0 ? Math.max(0, Math.min(1, b.remainingG / b.cookedG)) : 0;
      const lv = (left * 100).toFixed(1);
      if (rec.meter._v !== lv) { rec.meter._v = lv; rec.meter.style.setProperty('--v', lv); attr(rec.meter, 'aria-valuenow', left.toFixed(3)); attr(rec.meter, 'aria-valuemax', 1); }
      text(rec.stockT, U.weightText(b.remainingG) + ' left of ' + U.weightText(b.cookedG));

      // facts
      text(rec.ddLast, U.isNum(b.lastTempF) ? fmtF(b.lastTempF) + ', ' + agoText(now - b.lastTempAt) + (lastCheckBy(b.id) ? ', checked by ' + lastCheckBy(b.id) : '') : 'No reading yet');
      text(rec.ddSince, U.fmtTime(b.enteredAt));
      attr(rec.el, 'data-cold', ci ? 'on' : 'off');
      if (ci) {
        // "In the fridge since <date>, made <date>": the day it went back in (or the day it was made) and the made-on day.
        const sinceTs = U.isNum(b.movedAt) ? b.movedAt : b.enteredAt;
        const made = ci.madeOn ? ', made ' + U.fmtDateShort(ci.madeOn) : '';
        text(rec.dtSince, ci.place === 'line' ? 'Out of the fridge since' : 'In the fridge since');
        text(rec.ddSince, ci.place === 'line' && ci.outSince ? U.fmtTime(ci.outSince) + made : U.fmtDateShort(U.dateKey(sinceTs)) + made);
        const out = ci.outMs < 60e3 ? 'under 1 min' : hmLong(ci.outMs), outCap = out.charAt(0).toUpperCase() + out.slice(1);
        const line = ci.place === 'line'
          ? (ci.outHours ? outCap + ' out of your ' + trimNum(ci.outHours) + ' h limit' : 'Out for ' + out + ', no limit set')
          : (ci.outMs > 0 ? 'In the fridge. ' + (ci.outHours ? out + ' out so far of your ' + trimNum(ci.outHours) + ' h limit' : 'Out for ' + out + ' so far, no limit set') : 'In the fridge. Not taken out yet' + (ci.outHours ? ' (your limit out of the fridge is ' + trimNum(ci.outHours) + ' h)' : ', no out-of-fridge limit set'));
        const frac = ci.outHours ? ci.outMs / (ci.outHours * H1) : 0;
        setHidden(rec.coldLine, false); text(rec.coldLine, line); attr(rec.coldLine, 'data-tone', ci.state === 'bad' || frac >= 1 ? 'bad' : frac >= 0.75 ? 'warn' : 'ok');
      } else {
        if (rec.dtSince.textContent !== 'In the cabinet since') text(rec.dtSince, 'In the cabinet since');
        setHidden(rec.coldLine, true);
      }
      // Serve-by time with the kind of limit it is: quality (house limit, held at temperature) or safety (time as a health control).
      const coolingNow = b.kind === 'cooling';
      setHidden(rec.dtServe, coolingNow); setHidden(rec.ddServe, coolingNow);
      // One answer per row: the label says which kind of limit it is and the value is just the time.
      if (!coolingNow) { text(rec.dtServe, qualityStage(b) ? 'Quality limit' : 'Throw out at'); text(rec.ddServe, U.fmtTime(b.enteredAt + holdLimitMs(b))); }
      // A cold item shows its fridge date instead: the last day in the fridge, or that no days were set.
      if (ci) {
        text(rec.dtServe, 'Fridge date');
        text(rec.ddServe, ci.useBy ? 'Use by ' + U.fmtDateShort(ci.useBy) + ' (your ' + trimNum(ci.fridgeDays) + ' ' + plural(ci.fridgeDays, 'day') + ')' : 'No limit set');
        setHidden(rec.dtServe, false); setHidden(rec.ddServe, false);
      }
      const resting = U.isNum(b.restUntil) && b.restUntil > now && !coolingNow;
      setHidden(rec.dtRest, !resting); setHidden(rec.ddRest, !resting);
      if (resting) text(rec.ddRest, U.fmtTime(b.restUntil));
      // A kept batch shows until when and by whom; a past batch shows the keep-serving button.
      const keptNow = U.isNum(b.keepUntil) && b.keepUntil > now && !coolingNow;
      setHidden(rec.dtKept, !keptNow); setHidden(rec.ddKept, !keptNow);
      if (keptNow) text(rec.ddKept, 'until ' + U.fmtTime(b.keepUntil) + (b.keptBy ? ', by ' + b.keptBy : ''));
      setHidden(rec.bKeep, gt.action !== 'PAST_QUALITY');
      setHidden(rec.bUnkeep, !keptNow);
      // The reminder buttons follow this batch's row in the deadline feed.
      const row = feedByBatch.get(b.id);
      const snoozed = !!(row && row.snoozedUntil);
      setHidden(rec.bSnooze, !(row && row.rung >= 1 && row.rung < row.rungs && !snoozed && gt.action !== 'PAST_QUALITY'));
      setHidden(rec.bUnsnooze, !snoozed);
      if (snoozed) text(rec.unsnoozeT, 'Reminder at ' + U.fmtTime(row.snoozedUntil) + ': cancel');
      if (gt.action === 'REHEAT_IMMEDIATE' || gt.action === 'CHILL_NOW') {
        if (b.kind === 'cooling') { text(rec.dtNext, 'Next step'); text(rec.ddNext, U.isNum(gt.nextDeadlineAt) ? 'within ' + hmLong(gt.nextDeadlineAt - now) : 'now'); }
        else { text(rec.dtNext, 'Decide within'); text(rec.ddNext, U.isNum(gt.nextDeadlineAt) ? (gt.nextDeadlineAt - now > 0 ? hmLong(gt.nextDeadlineAt - now) : 'now') : 'now'); }
      } else if (gt.action === 'DISCARD_LOCKOUT') { text(rec.dtNext, 'Next reading'); text(rec.ddNext, 'Not needed, discard it'); }
      else if (b.kind === 'cooling') { text(rec.dtNext, 'Next reading'); text(rec.ddNext, gt.reason === 'cooled' ? 'Done' : 'Log one as it cools'); }
      else {
        const due = (U.isNum(b.lastTempAt) ? b.lastTempAt : b.enteredAt) + S.tempCheckEveryMin * 60000;
        text(rec.dtNext, 'Next reading');
        const outNow = !!(ci && ci.place === 'line');
        text(rec.ddNext, outNow ? 'Not needed while it is out' : due - now >= 0 ? 'due in ' + hmLong(due - now) : 'overdue by ' + hmLong(now - due));
        cls(rec.ddNext, 'is-late', !outNow && due - now < 0);
      }

      // cost line (honest: starter numbers say so)
      const ing = ingOf(b.ing);
      const bits = [];
      if (U.isNum(b.yieldPct)) bits.push('Yield ' + pctText(b.yieldPct, 1));
      if (U.isNum(b.costPerCookedKg)) bits.push('cost ' + U.fmtMoney(perUnit(b.costPerCookedKg)) + ' per cooked ' + unitW());
      const costWord = bits.length ? bits.join(', ') + '.' + (ing && ing.yieldConfirmed ? '' : ' Starter estimate.') : '';
      setHidden(rec.costLine, !costWord); text(rec.costLine, costWord);

      // gate message and lock note
      const m = gt.action === 'NONE' && gt.reason !== 'cooled' ? '' : stripSafety(gt.text);
      setHidden(rec.msg, !m);
      if (m) {
        text(rec.msgT, m);
        const tone = gt.severity === 'bad' ? 'bad' : gt.severity === 'warn' ? 'warn' : 'info';
        attr(rec.msg, 'data-tone', tone);
        const ic = tone === 'info' ? 'info' : 'alert';
        if (rec.msgIconKey !== ic) { rec.msgIconKey = ic; U.clear(rec.msgIcon); rec.msgIcon.appendChild(ico(ic, 20)); }
      }
      setHidden(rec.lock, gt.canServe || b.kind === 'cooling' || gt.action === 'DISCARD_LOCKOUT');

      // cooling steps
      setHidden(rec.cool, b.kind !== 'cooling');
      if (b.kind === 'cooling') {
        const c = S.cooling || C.safety.cooling;
        const s1 = since + c.stage1H * H1, fin = since + c.totalH * H1;
        stepLine(rec.step1, b.stage1At != null, b.stage1At == null && now > s1,
          'Stage 1 done: ' + U.tempText(c.stage1ToF) + ' reached at ' + U.fmtTime(b.stage1At || 0),
          'Stage 1: reach ' + U.tempText(c.stage1ToF) + ' within ' + trimNum(c.stage1H) + ' h (' + hmLong(s1 - now) + ' left)',
          'Stage 1 missed: ' + U.tempText(c.stage1ToF) + ' was not reached within ' + trimNum(c.stage1H) + ' h');
        stepLine(rec.step2, b.finalAt != null, b.finalAt == null && now > fin,
          'Stage 2 done: ' + U.tempText(c.finalF) + ' reached at ' + U.fmtTime(b.finalAt || 0),
          'Stage 2: reach ' + U.tempText(c.finalF) + ' by ' + trimNum(c.totalH) + ' h in all (' + hmLong(fin - now) + ' left)',
          'Stage 2 missed: ' + U.tempText(c.finalF) + ' was not reached within ' + trimNum(c.totalH) + ' h');
      }

      // buttons
      const showPull = isPullSource(b);
      setHidden(rec.bPull, !showPull);
      // Hot and cold items from the cabinet both keep Pull visible; it is only hidden behind "..." when the batch has nothing to pull.
      rec.bPull.dataset.keep = 'on';
      if (showPull) { const pg = ingOf(b.ing); text(rec.pullT, 'Pull ' + qtyText(pg, Math.min(b.remainingG, pg && U.isNum(pg.pullG) ? pg.pullG : 1000))); }
      cls(rec.bLog, 'btn-primary', gt.action === 'CHECK_TEMP');
      setHidden(rec.bReheat, gt.action !== 'REHEAT_IMMEDIATE');
      // Take out while it is in the fridge, Put back while it is out; neither once the batch is thrown out.
      setHidden(rec.bOut, !(ci && ci.place === 'fridge' && b.status !== 'discard'));
      setHidden(rec.bBack, !(ci && ci.place === 'line' && b.status !== 'discard'));
      setHidden(rec.bCool, !(b.kind === 'hot' && b.remainingG > 0 && gt.action !== 'DISCARD_LOCKOUT'));
      layoutActions(rec);
      if (rec.ed && rec.mode) refreshHint(rec, b);
      return gt;
    }

    // Picks the one main button of a card (taste and keep, then reheat, then log temp) and moves the others behind "...".
    function layoutActions(rec) {
      const main = [rec.bKeep, rec.bReheat, rec.bOut, rec.bBack, rec.bLog].find((a) => !a.hidden) || rec.bLog;
      rec.primary = main;
      let others = 0;
      // Pull is the action done most often, so it stays one tap away beside the main button when this batch is the pull source.
      const keepPull = !rec.bPull.hidden && main !== rec.bPull && rec.bPull.dataset.keep === 'on';
      rec.acts.forEach((a) => { const sec = a !== main && !(keepPull && a === rec.bPull); if (a.classList.contains('hc-sec') !== sec) a.classList.toggle('hc-sec', sec); if (sec && !a.hidden) others++; });
      cls(main, 'btn-primary', main !== rec.bLog || rec.bLog.classList.contains('btn-primary'));
      setHidden(rec.bMore, others === 0);
    }
    // Builds the inline temperature box once per card. Log temp and Reheat both use it.
    function buildEditor(rec) {
      const ed = { err: h('div', { class: 'fs-note', 'data-tone': 'bad', role: 'alert', hidden: true }), hint: h('p', { class: 'hc-hint', role: 'status' }) };
      ed.title = h('div', { class: 'hc-ed-t' });
      // Wide range on purpose: a reading of 40 or 250 degrees must be
      // typeable so it can be recorded and flagged.
      ed.stepper = SB.ui.stepper({ value: U.tempShown(150), min: U.tempShown(32), max: U.tempShown(300), step: 1, bigStep: 5, unit: U.unitLabel('temp'), label: U.units.temp === 'C' ? 'Temperature in degrees Celsius' : 'Temperature in degrees Fahrenheit', onChange: () => { const b = batchOf(rec.id); if (b) refreshHint(rec, b); setHidden(ed.err, true); } });
      // Saves the reading through the engine.
      ed.save = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: () => saveReading(rec) }, ico('check', 22), h('span', null, 'Save reading'));
      // Closes the box without saving anything.
      ed.cancel = h('button', { type: 'button', class: 'btn btn-lg', onClick: () => closeEditor(rec, true) }, 'Cancel');
      ed.el = h('div', { class: 'hc-editor', role: 'group', 'aria-label': 'Temperature reading' }, ed.title, ed.stepper, ed.hint, ed.err, h('div', { class: 'hc-ed-btns' }, ed.save, ed.cancel));
      // Keyboard: Enter saves and Esc cancels, so no mouse is needed.
      ed.el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeEditor(rec, true); }
        else if (e.key === 'Enter' && e.target === ed.stepper.input) { e.preventDefault(); ed.stepper.input.dispatchEvent(new Event('change')); saveReading(rec); }
      });
      return ed;
    }
    // Opens the temperature box on a card, or closes it if it is already open in the same mode.
    function toggleEditor(rec, mode) {
      if (rec.ed && rec.mode === mode && !rec.ed.el.hidden) { closeEditor(rec, true); return; }
      const b = batchOf(rec.id); if (!b) return;
      if (!rec.ed) { rec.ed = buildEditor(rec); rec.editorSlot.appendChild(rec.ed.el); }
      rec.mode = mode;
      const S = safety();
      text(rec.ed.title, mode === 'reheat' ? 'Reheated to' : b.kind === 'cooling' ? 'Cooling reading' : 'Temperature now');
      text(rec.ed.save.querySelector('span'), mode === 'reheat' ? 'Log reheat' : 'Save reading');
      rec.ed.stepper.setValue(U.tempShown(mode === 'reheat' ? S.reheatF : defaultTemp(b)), { silent: true });
      setHidden(rec.ed.err, true); setHidden(rec.ed.el, false);
      refreshHint(rec, b);
      rec.bLog.setAttribute('aria-expanded', mode === 'log' ? 'true' : 'false'); rec.bReheat.setAttribute('aria-expanded', mode === 'reheat' ? 'true' : 'false');
      rec.ed.el.scrollIntoView({ block: 'nearest' });
      (fineAny() ? rec.ed.stepper.input : rec.ed.save).focus({ preventScroll: true });
    }
    // Hides the box and returns focus to the button that opened it, so keyboard users keep their place.
    function closeEditor(rec, refocus) {
      if (!rec.ed) return;
      setHidden(rec.ed.el, true); const was = rec.mode; rec.mode = null;
      rec.bLog.setAttribute('aria-expanded', 'false'); rec.bReheat.setAttribute('aria-expanded', 'false');
      if (refocus) (was === 'reheat' && !rec.bReheat.hidden ? rec.bReheat : rec.bLog).focus({ preventScroll: true });
    }
    // Updates the one-line verdict under the stepper to match the number in it.
    function refreshHint(rec, b) {
      const hnt = tempHint(b, rec.mode, U.tempStored(rec.ed.stepper.getValue()));
      text(rec.ed.hint, hnt.text); attr(rec.ed.hint, 'data-tone', hnt.tone);
    }
    // Saves the reading (or the reheat) through the engine. A refusal is shown inside the box in plain words.
    function saveReading(rec) {
      const b = batchOf(rec.id); if (!b) { closeEditor(rec, false); return; }
      const f = U.tempStored(rec.ed.stepper.getValue()), mode = rec.mode;
      // Initials are asked once on this tablet; the reading is then saved with them.
      askWho(null, 'Save reading', (who) => saveReadingAs(rec, b, f, mode, who));
    }
    // Saves the reading with the given initials and shows the plain-words result.
    function saveReadingAs(rec, b, f, mode, who) {
      const res = run(mode === 'reheat' ? 'reheatBatch' : 'logTemp', who ? { batchId: b.id, tempF: f, who } : { batchId: b.id, tempF: f });
      if (res.report !== 'ok') {
        U.clear(rec.ed.err); rec.ed.err.append(ico('alert-circle', 20), h('span', null, say(res))); setHidden(rec.ed.err, false);
        return;
      }
      const label = b.label || 'Batch', info = res.info || {};
      if (mode === 'reheat' || info.reheated) toast(label + ' reheated to ' + U.tempText(f) + '. It is being served again.', 'ok');
      else if (info.status === 'reheat') toast(label + ' is below ' + U.tempText(safety().hotHoldF) + '. Reheat it to ' + U.tempText(safety().reheatF) + ' now, or throw it out.', 'warn');
      else if (info.status === 'chill') toast(label + ' is above ' + U.tempText(safety().coldHoldF) + '. Chill it now.', 'warn');
      else toast(label + ' logged at ' + U.tempText(f) + '.' + (info.onTime === false ? ' That check was ' + hmLong(info.lateMs) + ' late.' : ''), info.onTime === false ? 'warn' : 'ok');
      closeEditor(rec, true);
      update(nowMs());
      flash(rec.el);
    }

    // Asks why a batch is thrown out, shows which menu items would go 86 because of it, then discards.
    // The waste is counted under the chosen reason, and Undo stays available.
    function openDiscard(b, opener) {
      const ing = ingOf(b.ing), label = b.label || 'Batch';
      const gt = E().gate(b, nowMs(), safety());
      const order = b.kind === 'cooling' ? ['cooling', 'temp', 'expired', 'quality', 'other'] : ['expired', 'temp', 'quality', 'manual', 'other'];
      // When the engine already locked the batch, its reason is preselected so waste is labelled correctly.
      let reason = gt.action === 'DISCARD_LOCKOUT' && order.indexOf(gt.reason) >= 0 ? gt.reason : null;
      if (reason == null && gt.action === 'DISCARD_LOCKOUT') reason = gt.reason === 'expired' ? 'expired' : 'temp';
      // Past its quality limit the reason is already known, so discarding takes no extra tap.
      if (reason == null && gt.action === 'PAST_QUALITY') reason = 'quality';
      const fx = whatIf('discardBatch', { batchId: b.id, reason: 'quality' });
      // An empty value means nothing is picked yet (null would select the first reason).
      const seg = SB.ui.segmented({ label: 'Why is it being thrown out?', class: 'hc-reasons', value: reason == null ? '' : reason, options: order.map((id) => ({ id, label: REASON_WORDS[id] })), onChange: (id) => { reason = id; paint(); } });
      const effect = fx
        ? (fx.off.length ? 'These menu items go 86: ' + endDot(listWords(fx.off)) : 'No menu item goes 86: other stock still covers them.')
        : '';
      // Discard batch stays off until a reason is chosen.
      const d = dialog({
        title: 'Discard ' + label + '?', name: 'discard', opener, tone: 'danger', confirmLabel: 'Discard batch',
        body: [
          h('p', null, qtyText(ing, b.remainingG) + ' of ' + label + ' is thrown out and counted as waste.'),
          h('p', { class: 'fs-sub' }, 'Pick the reason. It goes into the waste figures.'), seg,
          effect ? h('div', { class: 'fs-note', 'data-tone': fx.off.length ? 'warn' : 'info' }, ico(fx.off.length ? 'alert' : 'info', 20), h('div', null, effect)) : null,
          h('p', { class: 'fs-sub' }, 'You can undo for ' + Math.round((st().settings.undoMs || C.undoMs) / 1000) + ' seconds.'),
        ],
        // Discards through the engine; the toast offers Undo and the waste is counted under the reason.
        onConfirm: (sh) => {
          sh.close('confirm');
          // Initials are asked once on this tablet; the discard is then logged with them.
          setTimeout(() => askWho(opener, 'Discard batch', (who) => {
            const res = run('discardBatch', who ? { batchId: b.id, reason, who } : { batchId: b.id, reason });
            if (res.report === 'ok') { undoToast(label + ' discarded. ' + U.weightText(res.info && res.info.g) + ' counted as waste.', 'ok'); update(nowMs()); }
            else toast(say(res), 'warn');
          }), 60);
        },
      });
      // Keeps the Discard batch button off until a reason is chosen.
      function paint() { d.ok.disabled = !reason; d.ok.setAttribute('aria-disabled', reason ? 'false' : 'true'); }
      paint();
    }
    // Explains the two-stage cooling rule and, on confirm, moves the whole batch into cooling.
    // The initials box for a confirm dialog: prefilled from the tablet's memory, with a "Not FW?" link that clears it.
    // The confirm button reads "<verb> as FW" and stays disabled while the box is empty.
    function whoField(dl, verb) {
      const pre = savedWho();
      const input = h('input', { class: 'input', type: 'text', maxlength: '12', autocomplete: 'off', value: pre, placeholder: 'Your initials', 'aria-label': 'Your initials' });
      const not = h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'not-me' } });
      const label = dl.ok.querySelector('span');
      // Keeps the button wording, its enabled state and the link in step with the box.
      const paint = () => {
        const w = input.value.trim();
        text(label, w ? verb + ' as ' + w : verb);
        dl.ok.disabled = !w;
        text(not, 'Not ' + pre + '?');
        setHidden(not, !pre || input.value !== pre);
      };
      input.addEventListener('input', paint);
      not.addEventListener('click', () => { input.value = ''; paint(); input.focus(); });
      paint();
      // The initials as typed, without spaces at the ends.
      const get = () => input.value.trim();
      return { input, el: h('div', { class: 'hc-fld' }, h('div', { class: 'field-label' }, 'Who tasted it'), input, not), get };
    }
    // True when a batch has a reading that allows keeping it on the menu: in range and inside the check interval.
    function keepReady(b) {
      const S = safety();
      return b.outSince == null && U.isNum(b.lastTempAt) && nowMs() - b.lastTempAt <= S.tempCheckEveryMin * 60000 && U.isNum(b.lastTempF) && (b.kind === 'cold' ? b.lastTempF <= S.coldHoldF : b.lastTempF >= S.hotHoldF);
    }
    // The taste-and-keep dialog: every batch that is past its quality limit, each with its last reading, for 30 minutes,
    // 1 hour or until a time of day. Batches without a fresh reading in range cannot be ticked.
    function openKeep(startId, opener) {
      const S = safety();
      const past = st().batches.filter((x) => x.status === 'past' && x.remainingG > 0);
      if (!past.length) return;
      const picks = new Map();
      const list = h('div', { class: 'fs-list' });
      past.forEach((x) => {
        const ok = keepReady(x);
        const cb = h('input', { type: 'checkbox', checked: ok && (x.id === startId || !startId), disabled: !ok, 'aria-label': 'Keep ' + (x.label || 'batch') + ' serving' });
        picks.set(x.id, cb);
        const reading = U.isNum(x.lastTempF) ? 'Last reading ' + fmtF(x.lastTempF) + ', ' + agoText(nowMs() - x.lastTempAt) : 'No reading yet';
        list.appendChild(h('label', { class: 'fs-card fs-card-soft', style: 'display:flex;gap:12px;align-items:center;padding:12px' }, cb,
          h('span', { class: 'grow' }, h('strong', null, x.label || 'Batch'), h('br'), h('span', { class: 'fs-sub' }, ok ? reading : reading + '. Log a temperature of ' + (x.kind === 'cold' ? U.tempText(S.coldHoldF) + ' or lower' : U.tempText(S.hotHoldF) + ' or higher') + ' first.'))));
      });
      const dur = SB.ui.segmented({ label: 'How long', value: '30', options: [{ id: '30', label: '30 minutes' }, { id: '60', label: '1 hour' }, { id: 'until', label: 'Until a time' }] });
      const untilIn = h('input', { class: 'input', type: 'time', 'aria-label': 'Keep serving until', hidden: true });
      const err = h('div', { class: 'fs-note', 'data-tone': 'bad', role: 'alert', hidden: true });
      let wf = null;
      dur.addEventListener('click', () => setTimeout(() => { untilIn.hidden = dur.getValue() !== 'until'; }, 0));
      const dl = dialog({
        title: 'Keep serving', name: 'keep', opener, confirmLabel: 'Keep serving', icon: 'check-circle',
        body: [
          h('p', null, 'Past its quality limit means the food is off the menu until someone tastes it. If it is still good, keep it on the menu for a set time. Your local health department\'s rules apply to quality extensions.'),
          list, h('div', { class: 'hc-fld' }, h('div', { class: 'field-label' }, 'How long'), dur, untilIn), err,
        ],
        // Sends the ticked batches to the engine with the chosen length and the initials, then reports what was kept.
        onConfirm: (sh) => {
          const ids = past.filter((x) => picks.get(x.id).checked).map((x) => x.id);
          if (!ids.length) { err.textContent = 'Select at least one batch. A batch needs a fresh temperature reading first.'; err.hidden = false; return; }
          const payload = { batchIds: ids, who: wf.get() };
          const mode = dur.getValue();
          if (mode === 'until') {
            const [hh, mm] = (untilIn.value || '').split(':').map(Number);
            if (!(hh >= 0)) { err.textContent = 'Pick a time of day.'; err.hidden = false; return; }
            const d = new Date(nowMs()); d.setHours(hh, mm || 0, 0, 0);
            if (d.getTime() <= nowMs()) d.setDate(d.getDate() + 1);
            payload.until = d.getTime();
          } else payload.forMin = Number(mode);
          const res = run('keepServing', payload);
          if (res.report !== 'ok') { err.textContent = say(res); err.hidden = false; return; }
          saveWho(payload.who);
          sh.close('confirm');
          const n = res.info.kept.length, sk = res.info.skipped.length;
          toast(n + ' ' + plural(n, 'batch') + ' kept serving until ' + U.fmtTime(res.info.until) + '.' + (sk ? ' ' + sk + ' skipped.' : ''), sk ? 'warn' : 'ok');
          update(nowMs());
        },
      });
      wf = whoField(dl, 'Keep serving');
      dl.copy.insertBefore(wf.el, err);
      return dl;
    }
    // Corrects a mistaken keep-serving: asks for initials and logs the correction; the original entry stays.
    function openUnkeep(id, opener) {
      const b = batchOf(id); if (!b) return;
      let wf = null;
      const dl = dialog({
        title: 'Correct: not kept serving', name: 'unkeep', opener, confirmLabel: 'Put back past limit', icon: 'x',
        body: ['This puts ' + (b.label || 'the batch') + ' back past its quality limit. The earlier entry stays in the log, with this correction beside it.'],
        // Logs the correction through the engine and closes the dialog.
        onConfirm: (sh) => {
          const res = run('endKeepServing', { batchId: id, who: wf.get(), note: 'Corrected from the cabinet card' });
          if (res.report !== 'ok') { toast(say(res), 'warn'); return; }
          saveWho(wf.get());
          sh.close('confirm'); update(nowMs());
        },
      });
      wf = whoField(dl, 'Put back past limit');
      dl.copy.appendChild(wf.el);
    }
    function openCooling(b, opener) {
      const S = safety(), c = S.cooling || C.safety.cooling, label = b.label || 'Batch', ing = ingOf(b.ing);
      const fx = whatIf('startCooling', { batchId: b.id });
      // Confirm dialog for cooling; it also lists any menu items that go 86 while the food is cooling.
      dialog({
        title: 'Start cooling ' + label + '?', name: 'cooling', opener, confirmLabel: 'Start cooling', icon: 'snow',
        body: [
          h('p', null, 'All ' + qtyText(ing, b.remainingG) + ' moves to cooling and stops being served.'),
          h('p', null, 'Get it from ' + U.tempText(S.hotHoldF) + ' to ' + U.tempText(c.stage1ToF) + ' within ' + trimNum(c.stage1H) + ' hours, then to ' + U.tempText(c.finalF) + ' within ' + trimNum(c.totalH - c.stage1H) + ' more hours (' + trimNum(c.totalH) + ' hours in all). Log a reading as it cools.'),
          fx && fx.off.length ? h('div', { class: 'fs-note', 'data-tone': 'warn' }, ico('alert', 20), h('div', null, 'These menu items go 86: ' + endDot(listWords(fx.off)))) : null,
          h('p', { class: 'fs-sub' }, C.safetyLine),
        ],
        // The engine moves the food into a new cooling batch, so the card to highlight is found by the new id.
        onConfirm: (sh) => {
          const res = run('startCooling', { batchId: b.id });
          sh.close('confirm');
          if (res.report === 'ok') { toast(label + ' is cooling. Log a reading at least every ' + U.minutesText(S.tempCheckEveryMin) + '.', 'ok'); update(nowMs()); const rec = cards.get(res.info && res.info.batchId); if (rec) { rec.el.scrollIntoView({ block: 'nearest' }); flash(rec.el); } }
          else toast(say(res), 'warn');
        },
      });
    }

    // Builds one line of the recently discarded list.
    function makeRecent(b) {
      const t = h('span', { class: 'grow' }), when = h('span', { class: 'fs-sub num' });
      const el = h('div', { class: 'fs-card fs-card-soft hc-recent' }, ico('trash', 18), t, when);
      return { el, t, when };
    }
    // Refreshes one recently discarded line: what, why, how much and when.
    function updateRecent(rec, b, now) {
      text(rec.t, (b.label || 'Batch') + ': ' + (REASON_WORDS[b.discardReason] || 'Discarded').toLowerCase() + ', ' + U.weightText(b.wasteG || 0) + ' wasted');
      text(rec.when, agoText(now - (b.discardedAt || now)));
    }

    // "HH:MM" for a time input.
    const timeValue = (ms) => { const d = new Date(ms); return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()); };
    // The moment a time-of-day input names: today, or tomorrow when it is already well past.
    function timeFromInput(v) {
      const [hh, mm] = (v || '').split(':').map(Number);
      if (!(hh >= 0)) return null;
      const now = nowMs(), d = new Date(now); d.setHours(hh, mm || 0, 0, 0);
      if (d.getTime() < now - 30 * 60000) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    // Asks when a batch will be ready and how much, then records it as planned supply. The rest time is added by the engine.
    function openPlan(d, opener) {
      const ing = ingOf(d.planFor.ing); if (!ing) return;
      const rest = U.isNum(ing.restH) && ing.restH > 0 ? ing.restH : 0;
      const kgIn = h('input', { class: 'input', type: 'number', min: '0.5', max: '1000', step: '0.5', inputmode: 'decimal', value: String(Math.max(0.5, Math.ceil(d.planFor.grams / 500) / 2)), 'aria-label': 'Kilograms in the batch' });
      const at0 = Math.max(nowMs() + 15 * 60000, d.planFor.by - rest * 3600000);
      const timeIn = h('input', { class: 'input', type: 'time', value: timeValue(at0), 'aria-label': 'Ready at' });
      const line = h('p', { class: 'fs-sub', role: 'status' });
      const err = h('div', { class: 'fs-note', 'data-tone': 'bad', role: 'alert', hidden: true });
      // Shows when the batch will be ready to serve once it has rested.
      const paint = () => { const t = timeFromInput(timeIn.value); text(line, t == null ? '' : 'Ready at ' + U.fmtTime(t) + (rest ? ', ready to serve about ' + U.fmtTime(t + rest * 3600000) + ' after resting' : ', ready to serve then') + '.'); };
      timeIn.addEventListener('input', paint); paint();
      dialog({
        title: 'Batch on its way', name: 'plan', opener, confirmLabel: 'Add a planned batch', icon: 'flame',
        body: [h('p', null, 'Tell the board a batch of ' + ing.name + ' is coming. It counts as supply from when it is ready to serve, not as stock, and the real batch replaces it when you add it.'),
          h('div', { class: 'hc-fld' }, h('div', { class: 'field-label' }, 'How much (kg, cooked)'), kgIn), h('div', { class: 'hc-fld' }, h('div', { class: 'field-label' }, 'Ready at'), timeIn), line, err],
        // Sends the plan to the engine and reports when it will be ready to serve.
        onConfirm: (sh) => {
          const t = timeFromInput(timeIn.value), kg = Number(kgIn.value);
          if (t == null || !(kg > 0)) { err.textContent = 'Enter the kilograms and a time of day.'; err.hidden = false; return; }
          const res = run('planBatch', { ing: ing.id, grams: Math.round(kg * 1000), offAt: t });
          if (res.report !== 'ok') { err.textContent = say(res); err.hidden = false; return; }
          sh.close('confirm');
          toast(ing.name + ' planned: ready at ' + U.fmtTime(t) + '.', 'ok');
          update(nowMs());
        },
      });
    }
    // Keeps the "Batches still to come" box current: rebuilt only when the plans or the open asks change, so a typed time is never lost.
    function updatePlans(now, feed) {
      const s = st();
      const asks = feed.filter((d) => d.planFor);
      const plans = s.planned || [];
      const sig = plans.map((e) => e.id).join() + '|' + asks.map((d) => d.planFor.ing + ':' + Math.round(d.planFor.by / 60000)).join();
      if (sig === planSig) return;
      planSig = sig;
      U.clear(planList);
      setHidden(planBox, !plans.length && !asks.length);
      for (const d of asks) {
        // Opens the plan dialog for this run-out.
        const ask = (ev) => openPlan(d, ev.currentTarget);
        planList.appendChild(h('div', { class: 'fs-card fs-card-soft hc-plan-ask', style: 'display:flex;gap:12px;align-items:center;padding:12px' }, ico('alert', 18),
          h('span', { class: 'grow' }, h('strong', null, d.label), h('br'), h('span', { class: 'fs-sub' }, d.consequence + ' ' + d.action)),
          h('button', { type: 'button', class: 'btn', dataset: { act: 'plan', ing: d.planFor.ing }, onClick: ask }, ico('flame', 20), h('span', null, 'Ready at…'))));
      }
      for (const e of plans) {
        const ing = ingOf(e.ing);
        planList.appendChild(h('div', { class: 'fs-card fs-card-soft hc-plan', dataset: { plan: e.id }, style: 'display:flex;gap:12px;align-items:center;padding:12px' }, ico('flame', 18),
          h('span', { class: 'grow' }, h('strong', null, (ing ? ing.name : e.ing) + ', ' + U.weightText(e.grams)), h('br'), h('span', { class: 'fs-sub' }, 'Ready at ' + U.fmtTime(e.offAt) + (e.readyAt > e.offAt ? ', ready to serve about ' + U.fmtTime(e.readyAt) : '') + '.')),
          h('button', { type: 'button', class: 'btn', dataset: { act: 'cancel-plan' }, onClick: () => { const res = run('cancelPlan', { planId: e.id }); if (res.report !== 'ok') toast(say(res), 'warn'); else { toast('Plan cancelled.', 'ok'); update(nowMs()); } } }, ico('x', 20), h('span', null, 'Cancel'))));
      }
    }
    // The one update path: membership on store change, text on the 1 Hz tick.
    function update(now) {
      const s = st();
      const feed = SB.deadlines.build(s, now);
      feedByBatch = new Map(feed.filter((d) => d.kind === 'expiry').map((d) => [d.batchId, d]));
      paintWho();
      const live = s.batches.filter((b) => b.status !== 'discard' && b.remainingG > 0).sort((a, b) => a.enteredAt - b.enteredAt || (a.id < b.id ? -1 : 1));
      reconcile(grid, cards, live, (b) => b.id, makeCard, null);
      let check = 0, act = 0;
      live.forEach((b) => {
        const rec = cards.get(b.id), gt = updateCard(rec, b, now);
        if (gt.action === 'CHECK_TEMP') check++; else if (gt.action !== 'NONE' && gt.reason !== 'cooled' && !(b.kind === 'cooling' && gt.action === 'CHILL_NOW')) act++;
      });
      setHidden(grid, !live.length); setHidden(empty, live.length > 0);
      setHidden(summary, !live.length);
      if (live.length) {
        const bits = [];
        if (act) bits.push(act + ' ' + plural(act, 'needs', 'need') + ' action now');
        if (check) bits.push(check + ' ' + plural(check, 'needs', 'need') + ' a temperature reading');
        text(summary, live.length + ' ' + plural(live.length, 'batch', 'batches') + ' in the cabinet. ' + (bits.length ? bits.join('. ') + '.' : 'All are in range.') + (live.some((x) => x.src === 'starter') ? ' ' + live.filter((x) => x.src === 'starter').length + ' are starter stock (starting amounts, not weighed).' : ''));
        cls(summary, 'is-alert', act > 0);
      }
      tabs.seg.setCount('batches', live.length, { alert: act + check > 0 });
      const dis = s.batches.filter((b) => b.status === 'discard' && U.isNum(b.discardedAt)).sort((a, b) => b.discardedAt - a.discardedAt).slice(0, 5);
      reconcile(recentList, recents, dis, (b) => b.id, makeRecent, (rec, b) => updateRecent(rec, b, now));
      setHidden(recentBox, !dis.length);
      updatePlans(now, feed);
    }
    update(nowMs());
    watch(offs, () => update(nowMs()), (now) => update(now));
    // Scrolls a batch card into view and flashes it.
    function highlight(batchId) { const rec = cards.get(batchId); if (rec) setTimeout(() => { rec.el.scrollIntoView({ block: 'nearest' }); flash(rec.el); }, 80); }
    if (opts.batchId) highlight(opts.batchId);
    // Stops listening to the store and the clock, and lets the New batch form drop its listeners.
    function destroy() { offs.splice(0).forEach((f) => f()); if (form) form.destroy(); }
    return { destroy, highlight };
  }
  // Opens the Hold cabinet as a sheet on the right.
  function openHold(opts) {
    let api = null;
    const sheet = SB.ui.sheet({
      title: 'Hold cabinet', side: 'right', width: 'min(1040px, 96vw)', name: 'hold',
      // The form is destroyed with the sheet so its number boxes stop listening.
      onClose: () => { if (api) api.destroy(); },
    });
    api = buildHold(sheet, opts);
    return sheet;
  }
  // Builds the Hold cabinet inside a page element instead of a sheet (the kitchen board's Cabinet view). Returns
  // { destroy, highlight(batchId) }.
  function mountHold(parent, opts) {
    const body = h('div', { class: 'hc-page-body' });
    const footer = h('div', { class: 'hc-page-foot', hidden: true });
    parent.append(body, footer);
    // A page has nothing to close, so links to other sheets just open them.
    const api = buildHold({ body, footer, close: () => {} }, opts);
    // Stops the cabinet page and takes it off the screen.
    const destroy = () => { api.destroy(); body.remove(); footer.remove(); };
    return { destroy, highlight: api.highlight };
  }
  SB.hold = { mount: mountHold };

  // New batch form: live yield and cost numbers while you type (SPEC 14.3.2).
  // Browser-storage key for the last batch made of each product, so the next one starts from the same numbers.
  const KEY_LASTBATCH = 'smokebox.v1.lastbatch';
  // The numbers used for the last batch of one product, or null when there is none yet.
  function lastBatchOf(ingId) { const m = U.storage.get(KEY_LASTBATCH, null); const x = m && typeof m === 'object' ? m[ingId] : null; return x && U.isNum(x.rawKg) && x.rawKg > 0 ? x : null; }
  // Remembers the numbers used for a product's batch so "same as last batch" can start from them.
  // The product of the last batch made, so the form opens on it: the same product again is the usual next batch.
  const KEY_LASTPROD = 'smokebox.v1.lastproduct';
  function rememberBatch(ingId, v) {
    U.storage.set(KEY_LASTPROD, ingId); const m = U.storage.get(KEY_LASTBATCH, null); const all = m && typeof m === 'object' ? m : {}; all[ingId] = v; U.storage.set(KEY_LASTBATCH, all); }
  function buildBatchForm(onAdded, opts) {
    const F = { ing: null, rawKg: 8, endC: 85, holdH: 2, weighed: false, cookedKg: 1, tempF: 150, wTouched: false, tTouched: false };
    // Products that can go in the cabinet: the ones that need temperature control.
    const list = () => st().ingredients.filter((i) => i.tcs && !i.archived);
    const first = list()[0];
    const lastProd = U.storage.get(KEY_LASTPROD, null);
    F.ing = opts && opts.ing && ingOf(opts.ing) && ingOf(opts.ing).tcs ? opts.ing : lastProd && list().some((i) => i.id === lastProd) ? lastProd : first ? first.id : null;
    // Gives a stepper and its number box the same spoken label.
    const relabel = (stepper, label) => { attr(stepper, 'aria-label', label); attr(stepper.input, 'aria-label', label); };
    // A labelled field; the visible label is hidden from screen
    // readers because the control has its own label.
    const vis = (label, node, hint) => h('div', { class: 'hc-fld' }, h('div', { class: 'field-label', 'aria-hidden': 'true' }, label), node, hint || null);

    // Choosing a product also changes the default weight, the hint and which steppers show.
    const prodSeg = SB.ui.segmented({
      label: 'Product', class: 'hc-prod', value: F.ing,
      options: list().map((i) => ({ id: i.id, label: i.name, icon: i.hold === 'cold' ? 'snow' : 'flame', iconSize: 18 })),
      // Picking a product resets the weight defaults and the hint.
      onChange: (id) => setIng(id),
    });

    const rawLab = h('div', { class: 'field-label', 'aria-hidden': 'true' });
    // Raw weight in kg for meat, or the amount made for sides.
    const rawStep = SB.ui.stepper({ value: F.rawKg, min: 0.1, max: 1000, step: 0.1, bigStep: 1, unit: 'kg', label: 'Raw weight in kilograms', onChange: (v) => { F.rawKg = v; F.wTouched = true; if (F.weighed && !F.cookedTouched) syncCooked(); calc(); } });
    const lastNote = h('p', { class: 'fs-sub hc-sub', hidden: true });
    const rawFld = h('div', { class: 'hc-fld' }, rawLab, rawStep, lastNote);

    // Cook endpoint: the inside temperature the meat reached. Hotter means more weight lost.
    const endStep = SB.ui.stepper({ value: F.endC, min: 75, max: 90, step: 1, unit: '°C', label: 'Cook endpoint in degrees Celsius', onChange: (v) => { F.endC = v; paintEndF(); if (F.weighed && !F.cookedTouched) syncCooked(); calc(); } });
    // Hours the meat rested before slicing; resting also changes the weight.
    const holdStep = SB.ui.stepper({ value: F.holdH, min: 0, max: 3, step: 0.5, unit: 'h', label: 'Hold before slicing in hours', onChange: (v) => { F.holdH = v; if (F.weighed && !F.cookedTouched) syncCooked(); calc(); } });
    // The cook endpoint is in Celsius (the research model uses it), so the same number is shown in Fahrenheit beside it.
    const endF = h('p', { class: 'fs-sub hc-sub' });
    // Writes the endpoint in Fahrenheit under its stepper.
    const paintEndF = () => text(endF, '= ' + U.tempTextC(F.endC));
    const thermalBox = h('div', { class: 'hc-two' }, vis('Cook endpoint', endStep, endF), vis('Rested before slicing', holdStep));

    // Cooked weight typed by the cook; it replaces the model when 'I weighed it' is on.
    const cookedStep = SB.ui.stepper({ value: F.cookedKg, min: 0.1, max: 1000, step: 0.1, bigStep: 1, unit: 'kg', label: 'Cooked weight in kilograms', onChange: (v) => { F.cookedKg = v; F.cookedTouched = true; calc(); } });
    const cookedFld = h('div', { class: 'hc-fld', hidden: true }, h('div', { class: 'field-label', 'aria-hidden': 'true' }, 'Cooked weight'), cookedStep);
    // When on, the cook's own scale numbers replace the model's estimate.
    const weighedTog = SB.ui.toggle({ label: 'I weighed it after cooking', onChange: (on) => { F.weighed = on; F.cookedTouched = false; setHidden(cookedFld, !on); if (on) syncCooked(); calc(); } });
    const weighedBox = h('div', { class: 'hc-weighed' }, weighedTog, cookedFld);

    // The first temperature reading; it starts the batch's clock.
    const tempStep = SB.ui.stepper({ value: U.tempShown(F.tempF), min: U.tempShown(32), max: U.tempShown(300), step: 1, bigStep: 5, unit: U.unitLabel('temp'), label: U.units.temp === 'C' ? 'First temperature reading in degrees Celsius' : 'First temperature reading in degrees Fahrenheit', onChange: (v) => { F.tempF = U.tempStored(v); F.tTouched = true; tempHintPaint(); } });
    const tempHintEl = h('p', { class: 'hc-hint', role: 'status' });
    const tempFld = h('div', { class: 'hc-fld' }, h('div', { class: 'field-label', 'aria-hidden': 'true' }, 'First temperature reading'), tempStep, tempHintEl);

    const labelInput = h('input', { class: 'input', type: 'text', maxlength: '40', autocomplete: 'off', placeholder: 'Leave empty for an automatic name' });
    const labelField = SB.ui.field({ label: 'Label (optional)', control: labelInput, hint: 'Up to 40 characters, for example "Brisket, second batch".' });

    // The live numbers box: yield, cooked weight, cost, and the comparison with the flat 50 percent rule.
    const dYield = h('dd', { class: 'num' }), dCooked = h('dd', { class: 'num' }), dCost = h('dd', { class: 'num' });
    const dtYield = h('dt'), dtCost = h('dt');
    const cmpLine = h('p', { class: 'hc-cmp', hidden: true });
    const honest = h('p', { class: 'fs-sub hc-honest' });
    const calcBox = h('section', { class: 'hc-calc', 'aria-label': 'Expected result' },
      h('h3', { class: 'fs-h' }, 'What you should get'),
      h('dl', { class: 'fs-dl hc-dl' }, dtYield, dYield, h('dt', null, 'Cooked weight'), dCooked, dtCost, dCost),
      cmpLine, honest);

    const err = h('div', { class: 'fs-note hc-form-err', 'data-tone': 'bad', role: 'alert', hidden: true });
    // Put in hold cabinet: adds the batch through the engine.
    const addBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg hc-add', onClick: () => add() }, ico('plus', 22), h('span', null, 'Put in hold cabinet'));
    const footer = h('div', { class: 'hc-foot' }, err, addBtn);

    // With no cooked-ahead item yet the Product list is empty, so say so and offer the way to add one.
    const noProd = h('div', { class: 'fs-note', hidden: list().length > 0 }, h('div', null, h('p', null, 'No cooked-ahead items yet. Add the food you cook ahead, like pulled pork or chili, and then log a batch of it here.'),
      // Opens the Cooked-ahead food sheet where the first item is added.
      h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'add-cooked' }, onClick: () => SB.sheets.open('cookahead') }, ico('plus', 20), h('span', null, 'Add a cooked-ahead item'))));
    // With nothing to log yet, only the explanation and the Add button show; the weight steppers wait for a product.
    const el = h('div', { class: 'hc-panel hc-form' + (list().length ? '' : ' hc-noprod') },
      h('h3', { class: 'fs-h' }, 'New batch'),
      h('p', { class: 'fs-sub' }, 'Log a pan when it goes into the cabinet. The first temperature starts its clock, so enter what your thermometer says.'),
      noProd, vis('Product', prodSeg), rawFld, thermalBox, weighedBox, tempFld, labelField, calcBox);

    // A starting weight equal to the usual batch size (the par the owner typed), so the box opens at what they said they cook.
    function defaultKg(ing) { return Math.max(0.5, Math.round((ing.parG || 4000) / 100) / 10); }

    // Switches product: relabels the weight box, resets defaults the cook has not touched,
    // and shows or hides the cook-model steppers.
    function setIng(id) {
      F.ing = id;
      const ing = ingOf(id); if (!ing) return;
      const meat = ing.thermal || (U.isNum(ing.yield) && ing.yield < 1);
      text(rawLab, meat ? 'Raw weight before cooking' : 'Weight made');
      relabel(rawStep, meat ? 'Raw weight before cooking, in kilograms' : 'Weight made, in kilograms');
      // The next batch starts from the numbers used for the last one of this product; the first ever uses a typical pan.
      const lb = lastBatchOf(id);
      F.rawKg = lb ? lb.rawKg : defaultKg(ing); F.wTouched = false; rawStep.setValue(F.rawKg, { silent: true });
      if (lb && ing.thermal && U.isNum(lb.endC) && U.isNum(lb.holdH)) { F.endC = lb.endC; F.holdH = lb.holdH; endStep.setValue(F.endC, { silent: true }); holdStep.setValue(F.holdH, { silent: true }); }
      paintEndF();
      text(lastNote, lb ? 'Filled in from your last ' + ing.name.toLowerCase() + ' batch. Change anything that is different today.' : '');
      setHidden(lastNote, !lb);
      setHidden(thermalBox, !ing.thermal);
      setHidden(weighedBox, !meat);
      if (!meat && F.weighed) { F.weighed = false; weighedTog.setValue(false); setHidden(cookedFld, true); }
      if (!F.tTouched) { F.tempF = ing.hold === 'cold' ? 38 : 150; tempStep.setValue(U.tempShown(F.tempF), { silent: true }); }
      if (F.weighed) { F.cookedTouched = false; syncCooked(); }
      tempHintPaint(); calc();
    }
    // Shows what the first reading will mean (in range, below the hot limit, above the cold limit).
    function tempHintPaint() {
      const ing = ingOf(F.ing); if (!ing) return;
      const hnt = tempHint({ kind: ing.hold === 'cold' ? 'cold' : 'hot' }, 'log', F.tempF);
      text(tempHintEl, hnt.text); attr(tempHintEl, 'data-tone', hnt.tone);
    }

    // Works out cooked weight, yield and cost per cooked kg from the form.
    // It uses the cook's own weights if given, else the cook-loss model for brisket, else the starter yield.
    function model() {
      const ing = ingOf(F.ing); if (!ing) return null;
      const rawG = Math.round(F.rawKg * 1000), rawCost = U.isNum(ing.costPerKg) ? ing.costPerKg : 0;
      let cookedG, yieldPct, kind, cmp = null;
      if (F.weighed && F.cookedKg > 0) { cookedG = Math.round(F.cookedKg * 1000); yieldPct = rawG > 0 ? (cookedG / rawG) * 100 : 0; kind = 'weighed'; }
      else if (ing.thermal) { const ty = E().thermalYield({ endpointC: F.endC, holdH: F.holdH, rawG, costPerKgRaw: rawCost }); cookedG = ty.cookedG; yieldPct = ty.hotPct; kind = 'model'; }
      else { const y = U.isNum(ing.yield) && ing.yield > 0 ? ing.yield : 1; cookedG = Math.round(rawG * y); yieldPct = y * 100; kind = 'static'; }
      if (ing.thermal && kind === 'model') cmp = E().staticYieldComparison({ endpointC: F.endC, holdH: F.holdH, rawG, costPerKgRaw: rawCost, staticPct: 50 });
      const costPerKg = cookedG > 0 ? ((rawG / 1000) * rawCost) / (cookedG / 1000) : 0;
      return { ing, rawG, rawCost, cookedG, yieldPct, kind, cmp, costPerKg };
    }
    // Pre-fills the cooked weight with the model's number until the cook types their own.
    function syncCooked() { const m = model(); if (!m) return; const base = E().thermalYield({ endpointC: F.endC, holdH: F.holdH, rawG: m.rawG }); const kg = m.ing.thermal ? base.cookedG / 1000 : (m.rawG * (m.ing.yield || 1)) / 1000; F.cookedKg = Math.max(0.1, Math.round(kg * 10) / 10); cookedStep.setValue(F.cookedKg, { silent: true }); }

    // Redraws the numbers box, including the plain comparison with the old flat 50 percent rule.
    function calc() {
      showErr(null);
      const m = model(); if (!m) return;
      const meat = m.ing.thermal || (U.isNum(m.ing.yield) && m.ing.yield < 1);
      text(dtYield, m.kind === 'weighed' ? 'Yield from your weights' : meat ? 'Expected yield' : 'Yield');
      text(dYield, pctText(m.yieldPct, 1) + (m.kind === 'model' ? ' (cook-loss model)' : m.kind === 'static' && meat ? ' (starter estimate)' : ''));
      text(dCooked, U.weightText(m.cookedG));
      text(dtCost, 'Cost per cooked ' + unitW());
      text(dCost, U.fmtMoney(m.costPerKg) + ' (starter cost)');
      if (m.cmp) {
        const c = m.cmp;
        const wTxt = Math.abs(Math.round(c.weightErrorPct)) + '% too ' + (c.weightErrorPct < 0 ? 'little' : 'much');
        const cTxt = Math.abs(Math.round(c.costErrorPct)) + '% too ' + (c.costErrorPct > 0 ? 'high' : 'low');
        text(cmpLine, 'The flat ' + c.staticPct + '% rule would plan ' + U.weightText(c.staticCookedG) + ' of cooked meat (' + wTxt + ') and price it at ' + U.fmtMoney(perUnit(c.staticCostPerKg)) + ' per ' + unitW() + ' (' + cTxt + '). This model says ' + U.weightText(c.modelCookedG) + ' at ' + U.fmtMoney(perUnit(c.modelCostPerKg)) + ' per ' + unitW() + '.');
        setHidden(cmpLine, false);
      } else if (m.ing.thermal && m.kind === 'weighed') {
        const staticCost = m.rawCost / 0.5;
        text(cmpLine, 'The flat 50% rule would have priced this at ' + U.fmtMoney(perUnit(staticCost)) + ' per ' + unitW() + ' and planned ' + U.weightText(m.rawG * 0.5) + '. Your weights say ' + U.weightText(m.cookedG) + ' at ' + U.fmtMoney(perUnit(m.costPerKg)) + ' per ' + unitW() + '.');
        setHidden(cmpLine, false);
      } else setHidden(cmpLine, true);
      text(honest, (m.ing.thermal ? 'Brisket yield comes from the Texas A&M cook-loss model. ' : 'Yield is a starter estimate until you weigh a batch. ') + 'Raw cost of ' + U.fmtMoney(perUnit(m.rawCost)) + ' per ' + unitW() + ' is a starter estimate.');
    }

    // Shows or clears the error above the Put in hold cabinet button.
    function showErr(msg) { U.clear(err); if (msg) { err.append(ico('alert-circle', 20), h('span', null, msg)); } setHidden(err, !msg); }
    // Sends the new batch to the engine. Success shows a toast and returns to the cabinet;
    // a refusal is shown in the engine's own words.
    function add() {
      const m = model(); if (!m) return;
      const payload = { ing: m.ing.id, tempF: F.tempF, rawG: m.rawG };
      if (m.ing.thermal) { payload.endpointC = F.endC; payload.holdH = F.holdH; }
      if (F.weighed && F.cookedKg > 0) payload.cookedG = Math.round(F.cookedKg * 1000);
      const lab = labelInput.value.trim(); if (lab) payload.label = lab;
      const res = run('addBatch', payload);
      if (res.report !== 'ok') { showErr(say(res)); return; }
      showErr(null);
      rememberBatch(m.ing.id, { rawKg: F.rawKg, endC: F.endC, holdH: F.holdH });
      const info = res.info || {}, b = st().batches.find((x) => x.id === info.batchId), label = b ? b.label : m.ing.name + ' batch';
      if (info.status === 'ok') toast(label + ' is in the cabinet: ' + U.weightText(info.cookedG) + ' cooked, first reading ' + U.tempText(F.tempF) + '.', 'ok');
      else toast(label + ' is in the cabinet but not being served: ' + (m.ing.hold === 'cold' ? 'above ' + U.tempText(safety().coldHoldF) + ', chill it now.' : 'below ' + U.tempText(safety().hotHoldF) + ', reheat it to ' + U.tempText(safety().reheatF) + '.'), 'warn');
      labelInput.value = ''; F.tTouched = false; setIng(F.ing);
      onAdded(info.batchId);
    }
    labelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    [rawStep, endStep, holdStep, cookedStep, tempStep].forEach((s) => s.addEventListener('input', () => showErr(null)));

    setIng(F.ing);
    // The form's public parts: its page, its footer button, and hooks for when it is shown or destroyed.
    return {
      el, footer,
      // Called when the tab is shown: refresh the numbers and focus the first box on a mouse screen.
      shown() { calc(); tempHintPaint(); if (fineAny()) { try { rawStep.input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } },
      // Removes the steppers' listeners; the sheet calls this when it closes.
      destroy() { [rawStep, endStep, holdStep, cookedStep, tempStep].forEach((s) => s.destroy()); },
    };
  }

  // 86 board and stock.
  // Icon for each simulated sales channel.
  // audit:data-start
  const SYNC_ICON = { pos: 'receipt', online: 'phone', drive: 'car', delivery: 'bag' };
  // audit:data-end

  // The word, icon and colour for a menu item's availability: on the
  // menu, 86 manual, 86 safety hold or 86 sold out.
  function stateOf86(a) {
    if (!a || a.ok) return { tone: 'ok', icon: 'check-circle', word: 'On the menu' };
    if (a.reason === 'manual') return { tone: 'bad', icon: 'ban', word: '86 manual' };
    if (a.reason === 'safety') return { tone: 'bad', icon: 'ban', word: '86 safety hold' };
    if (a.reason === 'quality') return { tone: 'bad', icon: 'ban', word: '86 past quality limit' };
    return { tone: 'bad', icon: 'ban', word: '86 sold out' };
  }
  // Where an ingredient stands against its 86 level: plenty, running low (within twice the level) or at it.
  function stockLevel(ing, have) {
    const thr = ing.thresholdG || 0;
    if (have <= thr) return { tone: 'bad', icon: 'ban', word: '86 level', meter: 'bad' };
    if (have <= thr * 2) return { tone: 'warn', icon: 'alert', word: 'Running low', meter: 'warn' };
    return { tone: 'ok', icon: 'check-circle', word: 'Plenty', meter: null };
  }

  // Builds the 86 board: the simulated channel strip, the menu rows (86 it, Back on) and the stock list.
  function openBoard86(opts) {
    opts = opts || {};
    const offs = [];
    const rows = new Map();          // menuId -> record
    const cats = new Map();          // category id -> { el, list, map, head }
    const ingRows = new Map();       // ingredient id -> record
    let filter = opts.filter === 'off' ? 'off' : 'all';
    // Wide, so the menu and the stock sit side by side on a big screen.
    const sheet = SB.ui.sheet({ title: '86 board and stock', side: 'right', width: 'min(1060px, 96vw)', name: 'board86', onClose: () => offs.splice(0).forEach((f) => f()) });

    // Filter: all items, or only the ones that are off the menu.
    const filterSeg = SB.ui.segmented({ label: 'Show', class: 'bd-filter', value: filter, options: [{ id: 'all', label: 'All items', count: 0 }, { id: 'off', label: 'Out now', count: 0 }], onChange: (id) => { filter = id; applyFilter(); } });
    const menuBox = h('section', { class: 'fs-section bd-menu', 'aria-label': 'Menu availability' }, h('div', { class: 'fs-row' }, h('h3', { class: 'fs-h grow' }, 'Menu'), filterSeg));
    const catHost = h('div', { class: 'bd-cats' });
    const noneOff = h('div', { class: 'empty bd-none', hidden: true }, ico('check-circle', 36), h('h3', null, 'Everything is on the menu'), h('p', null, 'Nothing is 86 right now. Tap 86 it on an item that has run out.'));
    // Shown while no cooked food is in the cabinet, so a board full of 86 items is not a mystery.
    const nothingCooked = h('p', { class: 'fs-sub bd-nocook', hidden: true, role: 'status' }, 'Nothing is cooked yet. Meat and sides show as 86 until you put a batch in the hold cabinet.');
    menuBox.append(nothingCooked, catHost, noneOff);

    // Builds one menu row (name, price, state, reason, buttons) once; updateRow keeps it current.
    function makeRow(mi) {
      const name = h('div', { class: 'bd-name' }), price = h('span', { class: 'bd-price num' });
      const state = h('span', { class: 'fs-state bd-state' });
      const why = h('div', { class: 'bd-why' });
      const b86 = h('button', { type: 'button', class: 'btn bd-toggle', dataset: { act: 'toggle' } });
      const bGo = h('button', { type: 'button', class: 'btn bd-go', dataset: { act: 'go' } });
      const el = h('div', { class: 'bd-row', dataset: { menu: mi.id, state: 'ok' } },
        h('div', { class: 'bd-main' }, h('div', { class: 'bd-top' }, name, price), state, why),
        h('div', { class: 'bd-act' }, b86, bGo));
      const rec = { el, name, price, state, why, b86, bGo, mi, key: '' };
      b86.addEventListener('click', () => {
        const a = SB.store.select.availability(rec.mi.id);
        if (a && a.reason === 'manual') toggle(rec.mi, false); else if (a && a.ok) toggle(rec.mi, true);
      });
      bGo.addEventListener('click', () => {
        const a = SB.store.select.availability(rec.mi.id);
        if (!a || a.ok) return;
        if (a.reason === 'safety' || a.reason === 'quality') goHold(); else if (a.reason === 'stock') fixStock(a.ing);
      });
      return rec;
    }
    // The plain reason an item is off the menu: who marked it 86 and when, a safety lock, or low stock.
    function whyLine(a, mi, now) {
      if (!a || a.ok) return '';
      if (a.reason === 'manual') {
        const m = st().manual86 && st().manual86[mi.id];
        return 'Marked 86 by hand' + (m && U.isNum(m.since) ? ', ' + agoText(now - m.since) : '') + '.';
      }
      const ing = ingOf(a.ing);
      if (a.reason === 'safety') return ingName(a.ing) + ' is held back. Reheat or throw out the batch in the Hold cabinet. It comes back when a batch that is in range is in.';
      if (a.reason === 'quality') {
        // A channel update still waiting out its hold can be cancelled by keeping the batch serving.
        const held = (st().syncs || []).filter((sy) => sy.menuId === mi.id && sy.kind === '86' && U.isNum(sy.holdUntil) && sy.holdUntil > now)[0];
        return ingName(a.ing) + ' is held until someone checks it. Open the hold cabinet to keep it serving, or throw it out.' + (held ? ' Channels update at ' + U.fmtTime(held.holdUntil) + ' unless kept.' : '');
      }
      const have = E().servable(st(), a.ing);
      return ingName(a.ing) + ' is low: ' + qtyText(ing, have) + ' left, 86 at ' + qtyText(ing, ing ? ing.thresholdG || 0 : 0) + '.';
    }
    // Refreshes one menu row and picks the button it needs: 86 it,
    // Back on, Add a batch, Restock or Open hold cabinet.
    function updateRow(rec, mi, now) {
      rec.mi = mi;
      const a = SB.store.select.availability(mi.id) || { ok: false, reason: null };
      const sv = stateOf86(a);
      text(rec.name, mi.name); text(rec.price, U.fmtMoney(mi.price));
      setState(rec.state, sv.tone, sv.icon, sv.word);
      attr(rec.el, 'data-state', a.ok ? 'ok' : a.reason || 'off');
      const w = whyLine(a, mi, now); text(rec.why, w); setHidden(rec.why, !w);
      // toggle: 86 it, or Back on for a manual 86; stock and safety holds fix themselves another way
      const showToggle = a.ok || a.reason === 'manual';
      setHidden(rec.b86, !showToggle);
      if (showToggle) {
        const k = a.ok ? '86' : 'back';
        if (rec.tk !== k) { rec.tk = k; U.clear(rec.b86); rec.b86.append(ico(a.ok ? 'ban' : 'check-circle', 20), h('span', null, a.ok ? '86 it' : 'Back on')); }
        cls(rec.b86, 'btn-primary', !a.ok);
        attr(rec.b86, 'aria-label', (a.ok ? '86 it: ' : 'Back on the menu: ') + mi.name);
      }
      // Stock and safety holds cannot be switched off here; the button leads to where each is fixed.
      const showGo = !a.ok && (a.reason === 'safety' || a.reason === 'quality' || a.reason === 'stock');
      setHidden(rec.bGo, !showGo);
      if (showGo) {
        const ing = ingOf(a.ing);
        const k = a.reason === 'safety' || a.reason === 'quality' ? 'hold' : ing && ing.tcs ? 'batch' : 'stock';
        if (rec.gk !== k) {
          rec.gk = k; U.clear(rec.bGo);
          rec.bGo.append(ico(k === 'hold' ? 'thermometer' : k === 'batch' ? 'plus' : 'package', 20), h('span', null, k === 'hold' ? 'Open hold cabinet' : k === 'batch' ? 'Add a batch' : 'Restock'));
        }
        attr(rec.bGo, 'aria-label', (k === 'hold' ? 'Open the hold cabinet for ' : k === 'batch' ? 'Add a batch of ' : 'Restock ') + (k === 'hold' ? mi.name : ingName(a.ing)));
      }
      rec.off = !a.ok;
    }
    // 86 it or Back on, through the engine, with an Undo toast.
    // If a manual 86 is removed but stock is still low, the message says the item stays 86.
    function toggle(mi, on) {
      const res = run('toggle86', { menuId: mi.id, on });
      if (res.report !== 'ok') { toast(say(res), 'warn'); return; }
      const a = SB.store.select.availability(mi.id), nm = mi.short || mi.name;
      if (on) undoToast(nm + ' is 86. The sync strip shows the demo channels catching up.', 'ok');
      else if (a && a.ok) undoToast(nm + ' is back on.', 'ok');
      else toast('Manual 86 removed, but ' + nm + ' is still ' + stateOf86(a).word.toLowerCase() + '. ' + whyLine(a, mi, nowMs()), 'warn');
      update(nowMs());
      const rec = rows.get(mi.id); if (rec) flash(rec.el);
    }
    // Closes this sheet and opens the hold cabinet (one sheet at a time keeps the Back button tidy).
    function goHold() { closeThen(sheet, () => SB.sheets.open('hold')); }
    // Takes the cook to where low stock is fixed: a new batch for
    // temperature-controlled food, the restock box for the rest.
    function fixStock(ingId) {
      const ing = ingOf(ingId); if (!ing) return;
      if (ing.tcs) closeThen(sheet, () => SB.sheets.open('hold', { tab: 'new', ing: ingId }));
      else openRestock(ingId);
    }
    // Applies the All items or Out now filter to the rows and hides empty categories.
    function applyFilter() {
      let shown = 0;
      rows.forEach((rec) => { const hide = filter === 'off' && !rec.off; setHidden(rec.el, hide); if (!hide) shown++; });
      cats.forEach((c) => { let any = false; c.map.forEach((r) => { if (!r.el.hidden) any = true; }); setHidden(c.el, !any); });
      setHidden(noneOff, !(filter === 'off' && shown === 0));
      setHidden(nothingCooked, !cookOn() || st().batches.some((b) => b.status !== 'discard' && b.remainingG > 0));
    }

    // Builds one ingredient stock row once.
    function makeIngRow(ing) {
      const name = h('div', { class: 'bd-ing-n' });
      const state = h('span', { class: 'fs-state bd-state' });
      const meter = SB.ui.meter({ value: 0, max: 1, thr: 0, label: 'Stock left' });
      const line = h('div', { class: 'bd-ing-t num' }), held = h('div', { class: 'bd-ing-held', hidden: true });
      const btn = h('button', { type: 'button', class: 'btn bd-ing-btn' });
      const panel = h('div', { class: 'bd-restock', hidden: true });
      const el = h('div', { class: 'bd-ing', dataset: { ing: ing.id } }, h('div', { class: 'bd-ing-top' }, name, state), meter, line, held, h('div', { class: 'bd-ing-act' }, btn), panel);
      const rec = { el, name, state, meter, line, held, btn, panel, ing, ed: null };
      btn.addEventListener('click', () => { const g1 = ingOf(rec.ing.id); if (!g1) return; if (g1.tcs) fixStock(g1.id); else toggleRestock(rec); });
      return rec;
    }
    // Refreshes an ingredient row: meter with a tick at the 86 level,
    // amounts, and food held back by a safety lock.
    function updateIng(rec, ing) {
      rec.ing = ing;
      const s = st(), have = E().servable(s, ing.id), thr = ing.thresholdG || 0, par = ing.parG || 0;
      const lv = stockLevel(ing, have);
      text(rec.name, ing.name);
      setState(rec.state, lv.tone, lv.icon, lv.word);
      const max = Math.max(par, have, 1);
      const v = ((Math.min(have, max) / max) * 100).toFixed(1), t = ((Math.min(thr, max) / max) * 100).toFixed(1);
      if (rec.meter._v !== v) { rec.meter._v = v; rec.meter.style.setProperty('--v', v); attr(rec.meter, 'aria-valuenow', Math.round(have)); attr(rec.meter, 'aria-valuemax', Math.round(max)); }
      if (rec.meter._t !== t) { rec.meter._t = t; rec.meter.style.setProperty('--thr', t); }
      if (lv.meter) attr(rec.meter, 'data-tone', lv.meter); else if (rec.meter.hasAttribute('data-tone')) rec.meter.removeAttribute('data-tone');
      text(rec.line, qtyText(ing, have) + ' left. Par ' + qtyText(ing, par) + ', 86 at ' + qtyText(ing, thr) + '.');
      if (ing.tcs) {
        let locked = 0;
        s.batches.forEach((b) => { if (b.ing === ing.id && b.status !== 'discard' && b.kind !== 'cooling' && !b.canServe && b.remainingG > 0) locked += b.remainingG; });
        text(rec.held, qtyText(ing, locked) + ' held in the cabinet and not servable.'); setHidden(rec.held, !(locked > 0));
      }
      const k = ing.tcs ? 'batch' : 'restock';
      if (rec.bk !== k) { rec.bk = k; U.clear(rec.btn); rec.btn.append(ico(ing.tcs ? 'plus' : 'package', 20), h('span', null, ing.tcs ? 'Add a batch' : 'Restock')); }
      attr(rec.btn, 'aria-label', (ing.tcs ? 'Add a batch of ' : 'Restock ') + ing.name);
    }
    // Opens or closes the small restock box under an ingredient.
    function toggleRestock(rec) {
      if (!rec.ed) rec.ed = buildRestock(rec);
      const open = rec.panel.hidden;
      setHidden(rec.panel, !open); attr(rec.btn, 'aria-expanded', open ? 'true' : 'false');
      if (open) { rec.el.scrollIntoView({ block: 'nearest' }); (fineAny() ? rec.ed.stepper.input : rec.ed.add).focus({ preventScroll: true }); }
    }
    // Opens the restock box for an ingredient and highlights its row.
    function openRestock(ingId) {
      const rec = ingRows.get(ingId); if (!rec) return;
      if (rec.panel.hidden) toggleRestock(rec); else (fineAny() ? rec.ed.stepper.input : rec.ed.add).focus({ preventScroll: true });
      rec.el.scrollIntoView({ block: 'nearest' }); flash(rec.el);
    }
    // Builds the restock box: an amount stepper (kg, or pieces for counted items), Add stock and Cancel.
    function buildRestock(rec) {
      const ing = rec.ing, each = ing.unit === 'ea';
      const par = ing.parG || 0;
      const start = each ? Math.max(6, Math.round(par / 4 / 6) * 6) : Math.max(0.5, Math.round(par / 4 / 100) / 10);
      const stepper = SB.ui.stepper({ value: start, min: each ? 1 : 0.1, max: each ? 100000 : 1000, step: each ? 1 : 0.1, bigStep: each ? 12 : 1, unit: each ? 'pieces' : 'kg', label: 'Amount to add to ' + ing.name });
      const err = h('div', { class: 'fs-note', 'data-tone': 'bad', role: 'alert', hidden: true });
      // Adds the typed amount to stock.
      const add = h('button', { type: 'button', class: 'btn btn-primary', onClick: () => doRestock(rec, stepper, err) }, ico('plus', 20), h('span', null, 'Add stock'));
      // Closes the box with no change.
      const cancel = h('button', { type: 'button', class: 'btn', onClick: () => toggleRestock(rec) }, 'Cancel');
      rec.panel.append(h('div', { class: 'bd-restock-t' }, 'Add to ' + ing.name), stepper, err, h('div', { class: 'bd-restock-b' }, add, cancel));
      rec.panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); toggleRestock(rec); rec.btn.focus({ preventScroll: true }); }
        else if (e.key === 'Enter' && e.target === stepper.input) { e.preventDefault(); stepper.input.dispatchEvent(new Event('change')); doRestock(rec, stepper, err); }
      });
      stepper.addEventListener('input', () => setHidden(err, true));
      return { stepper, add, err };
    }
    // Adds stock through the engine. WATCH OUT: restocking cannot be undone, so an amount over
    // three times the par level asks first.
    async function doRestock(rec, stepper, err) {
      const ing = ingOf(rec.ing.id); if (!ing) return;
      const v = stepper.getValue(), gm = ing.unit === 'ea' ? v : Math.round(v * 1000);
      if (ing.parG && gm > ing.parG * 3) {
        const ok = await SB.ui.confirm({ title: 'Add that much ' + ing.name.toLowerCase() + '?', body: qtyText(ing, gm) + ' is more than three times the par level of ' + qtyText(ing, ing.parG) + '. Restocking cannot be undone.', confirmLabel: 'Add it', cancelLabel: 'Change the amount' });
        if (!ok) return;
      }
      const fx = whatIf('restock', { ing: ing.id, g: gm });
      const res = run('restock', { ing: ing.id, g: gm });
      if (res.report !== 'ok') { U.clear(err); err.append(ico('alert-circle', 20), h('span', null, say(res))); setHidden(err, false); return; }
      toast('Added ' + qtyText(ing, gm) + ' of ' + ing.name.toLowerCase() + '.' + (fx && fx.on.length ? ' ' + listWords(fx.on) + ' can be ordered again.' : ''), 'ok');
      setHidden(rec.panel, true); attr(rec.btn, 'aria-expanded', 'false');
      update(nowMs()); flash(rec.el);
    }

    // Layout.
    const stockList = h('div', { class: 'bd-stock-list' });
    const stockBox = h('section', { class: 'fs-section bd-stock', 'aria-label': 'Stock' },
      h('h3', { class: 'fs-h' }, 'Stock'),
      h('p', { class: 'fs-sub' }, cookOn() ? 'Par and 86 levels are starter estimates. Cooked meat and cold sides live in the hold cabinet, so they are added as batches.' : 'Par and 86 levels are starter estimates.'),
      stockList, cookOn() ? safetyNote() : null);
    // With no dishes yet there is nothing to mark sold out: one friendly line and the one next step.
    const noDishBtn = h('button', { type: 'button', class: 'btn btn-primary', onClick: () => closeThen(sheet, () => SB.sheets.open('dishes')) }, ico('plus', 20), h('span', null, 'Add my menu'));
    const noDishBox = h('div', { class: 'empty bd-nodishes', hidden: true }, ico('ban', 40), h('h3', null, 'No dishes yet'), h('p', null, 'Add your menu. Then you can mark a dish sold out here, and Smokebox marks it for you when stock runs low.'), noDishBtn);
    const bdCols = h('div', { class: 'bd-cols' }, menuBox, stockBox);
    sheet.body.append(h('div', { class: 'bd' }, noDishBox, bdCols));

    // Repaints the dish rows and stock rows, and swaps in the no-dishes message when the menu is empty.
    function update(now) {
      const s = st();
      const menu = s.menu.filter((m) => !m.archived);
      setHidden(noDishBox, menu.length > 0); setHidden(bdCols, menu.length === 0);
      // categories keep a stable order; a category appears the first time one of its items does
      const order = C.categories.map((c) => c.id);
      menu.forEach((m) => { if (order.indexOf(m.cat) < 0) order.push(m.cat); });
      order.forEach((cid) => {
        const items = menu.filter((m) => m.cat === cid);
        if (!items.length) return;
        let c = cats.get(cid);
        if (!c) {
          const cat = C.categories.find((x) => x.id === cid);
          const list = h('div', { class: 'bd-list' });
          c = { el: h('div', { class: 'bd-cat' }, h('h4', { class: 'bd-cat-h' }, cat ? cat.name : 'Other'), list), list, map: new Map() };
          cats.set(cid, c); catHost.appendChild(c.el);
        }
        reconcile(c.list, c.map, items, (m) => m.id, makeRow, (rec, m) => updateRow(rec, m, now));
        c.map.forEach((rec, id) => rows.set(id, rec));
      });
      rows.forEach((rec, id) => { if (!menu.some((m) => m.id === id)) rows.delete(id); });
      reconcile(stockList, ingRows, s.ingredients.filter((i) => !i.archived), (i) => i.id, makeIngRow, updateIng);
      let off = 0; rows.forEach((r) => { if (r.off) off++; });
      filterSeg.setCount('all', rows.size); filterSeg.setCount('off', off, { alert: off > 0 });
      applyFilter();
    }
    update(nowMs());
    watch(offs, () => update(nowMs()), (now) => update(now));
    return sheet;
  }

  // Recall.
  // A short 'what is on this ticket' line: up to five items, then 'and N more'.
  function itemsSummary(t) {
    const parts = t.items.map((it) => ((C.menuById[it.menuId] && C.menuById[it.menuId].short) || it.name) + (it.qty > 1 ? ' x' + it.qty : ''));
    return parts.length <= 5 ? parts.join(', ') : parts.slice(0, 5).join(', ') + ' and ' + (parts.length - 5) + ' more';
  }
  // On time, warning or overdue for a ticket at a moment, from the engine's timing rules.
  const levelOf = (t, now) => E().ticketTiming(t, now, st().settings);

  // Builds the Recall sheet: search, Bumped and Voided tabs, and rows that are updated in place.
  function openRecall(opts) {
    opts = opts || {};
    const offs = [];
    const bumpedRows = new Map(), voidRows = new Map();
    let query = '', tabs = null; // tabs is set a few lines below; the tab builder calls applyFilter once before that

    // The search box gets focus only on a mouse or keyboard
    // screen, so a touch tablet keeps its keyboard down.
    const sheet = SB.ui.sheet({ title: 'Recall', side: 'right', width: 'min(760px, 96vw)', name: 'recall', initialFocus: () => (fineAny() ? search : null), onClose: () => offs.splice(0).forEach((f) => f()) });

    const search = h('input', { class: 'ord-search-input rc-search-input', type: 'search', inputmode: 'search', autocomplete: 'off', placeholder: 'Ticket number or name', 'aria-label': 'Find a ticket by number or name', enterkeyhint: 'search' });
    const searchBox = h('div', { class: 'ord-search rc-search' }, ico('search', 22), search);
    const count = h('p', { class: 'fs-sub rc-count', role: 'status' });
    const bumpedList = h('ul', { class: 'rc-list' }), voidedList = h('ul', { class: 'rc-list' });
    const bumpedEmpty = h('div', { class: 'empty rc-empty', hidden: true }, ico('history', 40), h('h3', null, 'Nothing bumped yet'), h('p', null, 'When a ticket is bumped it shows up here, newest first, so you can bring it back.'));
    const voidedEmpty = h('div', { class: 'empty rc-empty', hidden: true }, ico('trash', 40), h('h3', null, 'Nothing voided'), h('p', null, 'Voided tickets and the reason given show up here.'));
    const noMatch = h('div', { class: 'empty rc-empty', hidden: true }, ico('search', 40), h('h3', null, 'No ticket matches'), h('p'));
    const voidNote = h('p', { class: 'fs-sub' }, 'A voided ticket cannot be recalled. If it was a mistake, send a new ticket.');
    const bumpedPanel = h('div', { class: 'rc-panel' }, bumpedList, bumpedEmpty);
    const voidedPanel = h('div', { class: 'rc-panel' }, voidNote, voidedList, voidedEmpty);
    tabs = tabsWithPanels('Tickets', [
      { id: 'bumped', label: 'Bumped', icon: 'history', count: 0, panel: bumpedPanel },
      { id: 'voided', label: 'Voided', icon: 'trash', count: 0, panel: voidedPanel },
    ], opts.tab === 'voided' ? 'voided' : 'bumped', () => applyFilter());
    sheet.body.append(h('div', { class: 'rc' }, searchBox, tabs.seg, count, bumpedPanel, voidedPanel, noMatch));

    // Builds one ticket row once; a voided row has no Recall button.
    function makeRow(t, voided) {
      const num = h('div', { class: 'rc-num num' }), who = h('span', { class: 'rc-who', dir: 'auto' });
      const ch = h('span', { class: 'chip rc-ch' }), demo = h('span', { class: 'chip', hidden: true, dataset: { tone: 'info' } }, 'Demo');
      const items = h('div', { class: 'rc-items' }), meta = h('div', { class: 'rc-meta' });
      const badge = h('span', { class: 'rc-badge' });
      const recall = voided ? null : h('button', { type: 'button', class: 'btn rc-recall', dataset: { act: 'recall' } }, ico('history', 20), h('span', null, 'Recall'));
      const el = h('li', { class: 'rc-row', dataset: { ticket: t.id, num: String(t.num) } },
        num, h('div', { class: 'rc-main' }, h('div', { class: 'rc-top' }, who, ch, demo), items, h('div', { class: 'rc-meta-row' }, meta, badge)), recall);
      const rec = { el, num, who, ch, demo, items, meta, badge, recall, t, text: '' };
      if (recall) recall.addEventListener('click', () => doRecall(rec.t.id, recall));
      return rec;
    }
    // Refreshes one ticket row (name, items, how long ago, on-time badge) and applies the search.
    function updateRow(rec, t, now, voided) {
      rec.t = t;
      text(rec.num, '#' + t.num); text(rec.who, t.customer || 'No name');
      const ch = channelOf(t.channel);
      if (rec.chKey !== t.channel) { rec.chKey = t.channel; U.clear(rec.ch); rec.ch.append(ico(ch.icon, 16), h('span', null, ch.name)); }
      setHidden(rec.demo, t.src !== 'demo' || !!(SB.store.isDemo && SB.store.isDemo()));
      text(rec.items, itemsSummary(t));
      const tm = levelOf(t, now);
      if (voided) {
        text(rec.meta, 'Voided ' + agoText(now - (t.voidedAt || now)) + '. Reason: ' + (t.voidReason || 'none given') + '.');
        setHidden(rec.badge, true);
      } else {
        const extra = (t.forced ? ' Bumped with items not done.' : '') + (t.recalls > 0 ? ' Recalled ' + t.recalls + (t.recalls === 1 ? ' time.' : ' times.') : '');
        text(rec.meta, 'Bumped ' + agoText(now - (t.expeditedAt || now)) + '. Took ' + U.fmtDur(tm.elapsedMs) + '.' + extra);
        setHidden(rec.badge, false);
        if (rec.lv !== tm.level) { rec.lv = tm.level; U.clear(rec.badge); rec.badge.appendChild(SB.ui.badge(tm.level)); }
      }
      const q = query.trim().toLowerCase().replace(/^#/, '');
      rec.match = !q || String(t.num).indexOf(q) >= 0 || String(t.customer || '').toLowerCase().indexOf(q) >= 0;
      setHidden(rec.el, !rec.match);
    }

    // Brings a bumped ticket back to the board through the engine, closes this sheet and says so.
    // WATCH OUT: the engine has no undo for Recall, so the toast's Undo bumps the ticket again.
    async function doRecall(ticketId, opener) {
      const t = st().tickets.find((x) => x.id === ticketId);
      const forced = !!(t && t.forced);
      const res = run('recallTicket', { ticketId });
      if (res.report !== 'ok') { toast(say(res), 'warn'); update(nowMs()); return; }
      sheet.close('recall');
      const num = t ? t.num : '';
      // A ticket that was bumped with items not done is bumped with
      // force again, so Undo behaves the same way.
      toast('Ticket #' + num + ' is back on the board. It shows on Expo and All, and on a station while that station still has items to finish.', 'ok', {
        undo: () => {
          const r = run('bumpTicket', forced ? { ticketId, force: true } : { ticketId });
          if (r.report !== 'ok') toast(say(r), 'warn'); else SB.ui.announce('Ticket #' + num + ' bumped again.');
        },
      });
    }

    // Applies the search to the rows, shows the empty or no-match message and the count line.
    function applyFilter() {
      if (!tabs) return;
      const showing = tabs.seg.getValue();
      const map = showing === 'voided' ? voidRows : bumpedRows;
      let total = 0, shown = 0;
      map.forEach((rec) => { total++; if (rec.match !== false) shown++; });
      const q = query.trim();
      setHidden(bumpedEmpty, !(showing === 'bumped' && total === 0));
      setHidden(voidedEmpty, !(showing === 'voided' && total === 0));
      const miss = total > 0 && shown === 0;
      setHidden(noMatch, !miss);
      if (miss) text(noMatch.querySelector('p'), 'Nothing in ' + (showing === 'voided' ? 'voided' : 'bumped') + ' tickets matches "' + q + '". Check the number or clear the search.');
      text(count, !total ? '' : q ? shown + ' of ' + total + ' ' + plural(total, 'ticket') + ' match' + (shown === 1 ? 'es' : '') + '.' : total + ' ' + plural(total, 'ticket') + ', newest first.');
      setHidden(count, !total);
    }

    // Keeps both lists in step with the store, then re-applies the search. Rows are reused, never rebuilt.
    function update(now) {
      const bumped = SB.store.select.recent(30), voided = SB.store.select.voided(30);
      reconcile(bumpedList, bumpedRows, bumped, (t) => t.id, (t) => makeRow(t, false), (rec, t) => updateRow(rec, t, now, false));
      reconcile(voidedList, voidRows, voided, (t) => t.id, (t) => makeRow(t, true), (rec, t) => updateRow(rec, t, now, true));
      tabs.seg.setCount('bumped', bumped.length); tabs.seg.setCount('voided', voided.length);
      applyFilter();
    }
    search.addEventListener('input', () => { query = search.value; bumpedRows.forEach((r) => { r.match = undefined; }); update(nowMs()); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; query = ''; update(nowMs()); }
      else if (e.key === 'Enter') {
        // one match left: Enter recalls it
        const map = tabs.seg.getValue() === 'bumped' ? bumpedRows : null;
        if (!map) return;
        const hit = Array.from(map.values()).filter((r) => !r.el.hidden);
        if (hit.length === 1 && query.trim()) { e.preventDefault(); hit[0].recall.focus(); }
      }
    });
    update(nowMs());
    watch(offs, () => update(nowMs()), (now) => update(now));
    return sheet;
  }

  // Demo and clock.
  // Clock speed choices, demo order rates, and the word shown for a running rate.
  // audit:data-start
  const SPEEDS = [{ id: '1', label: 'x1', aria: 'Real time' }, { id: '5', label: 'x5', aria: 'Five times faster' }, { id: '15', label: 'x15', aria: 'Fifteen times faster' }, { id: '30', label: 'x30', aria: 'Thirty times faster' }];
  const RATES = [{ id: 'off', label: 'Off' }, { id: 'slow', label: 'Slow' }, { id: 'normal', label: 'Normal' }, { id: 'rush', label: 'Lunch rush' }];
  const RATE_WORD = { slow: 'Slow', normal: 'Normal', rush: 'Lunch rush' };
  // audit:data-end
  // The simulator's demo-traffic part, or null when the simulator is not in this build.
  const simLive = () => (SB.sim && SB.sim.live ? SB.sim.live : null);
  // What the simulator says it is doing (running, rate, crew), or an empty answer if it cannot say.
  const simStatus = () => { const l = simLive(); try { return l && typeof l.status === 'function' ? l.status() || {} : {}; } catch (e) { return {}; } };
  const simDo = (what, fn) => { try { return fn(); } catch (e) { console.error('[smokebox] demo ' + what + ' failed', e); toast('The demo had a problem (' + what + '). Try again. If it keeps happening, reload the page.', 'bad'); return undefined; } };
  // The kitchen clock speed (1 is real time).
  const speedNow = () => (SB.store.speed ? SB.store.speed() : 1);

  // Build the clock-speed control. Shared by the Demo sheet and the Settings sheet. Returns { el, paint }.
  function clockControl(label) {
    const seg = SB.ui.segmented({ label: label || 'Clock speed', class: 'dm-speed', value: String(speedNow()), options: SPEEDS.map((s) => ({ id: s.id, label: s.label, ariaLabel: s.aria })), onChange: (id) => {
      const ok = SB.store.setSpeed(Number(id));
      if (!ok) toast('That clock speed is not allowed.', 'warn'); else SB.ui.announce(id === '1' ? 'Clock back to real time.' : 'Clock running ' + id + ' times faster.');
      paint();
    } });
    const warn = h('div', { class: 'fs-note', 'data-tone': 'warn', hidden: true }, ico('alert', 20), h('div', null, h('strong', { class: 'dm-warn-t' }), h('p', { class: 'dm-warn-p' }, 'Every ticket timer and every food-safety deadline runs faster too, including the hold-cabinet clocks. Set it back to x1 before real service.')));
    const clock = h('p', { class: 'fs-sub dm-clock num' });
    const el = h('div', { class: 'dm-clockctl' }, seg, clock, warn);
    // Redraws the speed buttons, the clock line and the warning from the store.
    function paint() {
      const sp = speedNow();
      const id = String(sp);
      if (seg.getValue() !== id) seg.setValue(SPEEDS.some((s) => s.id === id) ? id : '');
      text(clock, 'Kitchen clock ' + U.fmtTime(nowMs()) + (sp === 1 ? ', real time.' : ', running ' + (Math.round(sp * 100) / 100) + ' times faster than real time.'));
      setHidden(warn, sp === 1);
      text(warn.querySelector('.dm-warn-t'), 'The clock is running x' + (Math.round(sp * 100) / 100) + '.');
    }
    // wrap (set by the caller) is hidden unless the demo is loaded: faster clocks are developer-only.
    const api = { el, paint: () => { paint(); if (api.wrap) setHidden(api.wrap, !demoOn()); }, seg, wrap: null };
    paint();
    return api;
  }
  // True while the demo is loaded, so developer-only tools should show (clock speeds, contrast checker).
  const demoOn = () => !!(SB.shell && SB.shell.demoLoaded && SB.shell.demoLoaded());

  // Builds the Demo and clock sheet. Without the simulator it says so plainly and keeps the clock and Reset.
  function openDemo() {
    const offs = [];
    // Listeners are removed when the sheet closes, so nothing keeps updating a screen that is gone.
    // In a real kitchen (not the demo tab) this sheet only explains the demo and opens it; the crew and clock live in the demo.
    const realKitchen = !!(SB.store.isolated && SB.store.isolated() && !SB.store.isDemo() && SB.setup && SB.setup.demoIntro);
    const sheet = SB.ui.sheet({ title: realKitchen ? 'Watch the demo' : 'Demo and clock', side: 'right', width: 'min(640px, 96vw)', name: 'demo', onClose: () => offs.splice(0).forEach((f) => f()) });
    if (realKitchen) { sheet.body.appendChild(SB.setup.demoIntro()); return sheet; }
    const live = simLive();

    // status line
    const statusIcon = h('span', { class: 'dm-status-i' }), statusT = h('div', { class: 'dm-status-t' });
    const statusBox = h('div', { class: 'fs-note dm-status', role: 'status' }, statusIcon, statusT);

    // simulator controls (only when the simulator is in the build)
    let ordersSeg = null, crewTog = null, burstBtn = null, sampleTog = null, sampleLine = null, sampleInfoBox = null;
    const simBox = h('div', { class: 'dm-sim' });
    if (live) {
      // Automatic orders: Off stops the simulator, the other choices start it at that rate.
      ordersSeg = SB.ui.segmented({ label: 'Automatic orders', class: 'dm-rates', value: 'off', options: RATES, onChange: (id) => {
        simDo('orders', () => { if (typeof live.stop === 'function') live.stop(); if (id !== 'off') live.start({ rate: id }); });
        paint();
        SB.ui.announce(id === 'off' ? 'Automatic orders off.' : 'Automatic orders: ' + RATE_WORD[id] + '.');
      } });
      // Auto crew: the simulated crew taps items done, bumps tickets and logs temperatures.
      crewTog = SB.ui.toggle({ label: 'Auto crew taps items done, bumps tickets and logs temperatures', checked: false, onChange: (on) => { simDo('crew', () => live.crew(on)); paint(); } });
      // Sends twelve demo tickets at once, like a lunch rush.
      burstBtn = h('button', { type: 'button', class: 'btn btn-lg dm-burst', onClick: () => {
        const n = simDo('rush', () => live.burst(12));
        toast((typeof n === 'number' ? n : 12) + ' demo tickets sent to the board.', 'ok'); paint();
      } }, ico('zap', 22), h('span', null, 'Add 12-ticket rush'));
      simBox.append(
        h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Automatic orders'), h('p', { class: 'fs-sub' }, 'Demo tickets arrive on the kitchen clock, so a faster clock means faster orders. They are labeled Demo.'), ordersSeg),
        h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Auto crew'), h('p', { class: 'fs-sub' }, 'A demo cook who works while automatic orders run. Turn it off to work the demo by hand.'), crewTog),
        h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Rush'), h('p', { class: 'fs-sub' }, 'Twelve tickets at once, like a lunch rush.'), burstBtn));
    } else {
      simBox.append(h('div', { class: 'fs-note', 'data-tone': 'warn', role: 'status' }, ico('alert', 20),
        h('div', null, h('strong', null, 'The demo is not loaded.'), h('p', null, 'Automatic orders, the auto crew, the 12-ticket rush and sample history come from a part of Smokebox that is not in this copy. The clock speed and Reset live data below still work.'))));
    }

    // clock
    const clockCtl = clockControl('Clock speed');
    const clockBox = h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Clock speed (demo only)'), h('p', { class: 'fs-sub' }, 'Speeds up the whole kitchen so you can watch a busy night in a minute. It shows only while the demo is loaded. Never use it in real service.'), clockCtl.el);
    clockCtl.wrap = clockBox; setHidden(clockBox, !demoOn());

    // sample history
    const sampleBox = h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Data counts'));
    const countsDl = h('dl', { class: 'fs-dl dm-counts' });
    const dLive = h('dd', { class: 'num' }), dDemo = h('dd', { class: 'num' }), dSample = h('dd', { class: 'num' });
    countsDl.append(h('dt', null, 'Live tickets on this device'), dLive, h('dt', null, 'Demo tickets on this device'), dDemo, h('dt', null, 'Sample history'), dSample);
    sampleBox.append(countsDl);
    const sim = SB.sim;
    if (sim && typeof sim.setSampleEnabled === 'function' && typeof sim.sampleEnabled === 'function') {
      // Whether the back office includes the made-up sample history.
      sampleTog = SB.ui.toggle({ label: 'Include sample history in the back office', checked: !!sim.sampleEnabled(), onChange: (on) => { simDo('sample history', () => sim.setSampleEnabled(on)); paintCounts(); } });
      sampleBox.append(sampleTog);
    }
    sampleInfoBox = h('p', { class: 'fs-sub dm-sample-note' }, 'Sample history is made by the app, not recorded in your kitchen. It is clearly labeled wherever it appears.');
    sampleBox.append(sampleInfoBox);

    // Reset live data asks first (see doReset).
    const resetBtn = h('button', { type: 'button', class: 'btn btn-danger btn-lg', onClick: () => doReset() }, ico('trash', 22), h('span', null, 'Reset live data'));
    const resetBox = h('section', { class: 'fs-section dm-reset' }, h('h3', { class: 'fs-h' }, 'Back to real service'), h('p', { class: 'fs-sub' }, 'Reset live data erases every ticket, batch and event on this device, including all demo orders, and puts the clock back to real time. The board and the cabinet start empty. Your settings, menu and food safety record stay. This cannot be undone.'), resetBtn);

    // Restart demo: start over with fresh tickets, the way the app looks on its first day.
    const restartBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg dm-restart', onClick: () => doRestart() }, ico('refresh', 22), h('span', null, 'Restart demo'));
    const tourBtn = h('button', { type: 'button', class: 'btn btn-lg', onClick: () => closeThen(sheet, runTour) }, ico('play', 22), h('span', null, 'Show me how it works'));
    const startBox = h('section', { class: 'fs-section dm-start' }, h('h3', { class: 'fs-h' }, 'Load the demo'),
      h('p', { class: 'fs-sub' }, 'Demo only. Loads demo food in the cabinet and three demo tickets, and erases what is on this device now. Nothing runs by itself: you tap Start and Done, and the timers show when each dish should begin.'),
      h('div', { class: 'fs-row' }, restartBtn, tourBtn));

    sheet.body.append(h('div', { class: 'dm' }, h('div', { class: 'fs-note', 'data-tone': 'warn' }, ico('alert', 20), h('div', null, h('strong', null, 'Everything here is for the demo and is not real.'), h('p', null, 'Demo orders, the auto crew and the 14-day sample history are made by the app. They are not your sales and not your food. Use Reset live data below to go back to real service.'))), statusBox, startBox, simBox, clockBox, sampleBox, resetBox));

    // Clears the board after a confirm and puts the fresh demo tickets back. Settings stay.
    async function doRestart() {
      const s = st(), demo = s.tickets.filter((t) => t.src === 'demo').length, real = s.tickets.length - demo;
      // A kitchen with its own dishes loses them too: the demo puts the sample barbecue menu in their place.
      const own = s.catalog === 'own' && (s.menu.length > 0 || s.orders.length > 0 || s.tickets.length > 0);
      const ok = await SB.ui.confirm({
        title: 'Restart the demo?', confirmLabel: own ? 'Erase my dishes and restart' : 'Restart demo', cancelLabel: 'Keep everything', tone: 'danger',
        body: [(own ? 'This erases your dishes, prices and orders and loads the sample barbecue menu in their place. ' : '') + 'This clears ' + s.tickets.length + ' ' + plural(s.tickets.length, 'ticket') + (real ? ' (' + real + ' not from the demo)' : '') + ', ' + s.batches.length + ' ' + plural(s.batches.length, 'batch', 'batches') + ' in the cabinet and the event log on this device, then puts three fresh demo tickets on the board. Settings stay.'],
      });
      if (!ok) return;
      if (SB.tour && SB.tour.running && SB.tour.running() && SB.tour.stop) SB.tour.stop();
      const n = SB.sim && SB.sim.restartDemo ? SB.sim.restartDemo({ replaceOwn: own }) : -1;
      if (n < 0) { toast('The demo could not be restarted.', 'warn'); return; }
      if (SB.floor && SB.floor.setWelcome) SB.floor.setWelcome(true);
      toast('Demo restarted. Three fresh tickets are on the board.', 'ok');
      closeThen(sheet, () => { if (SB.router && SB.router.go) SB.router.go({ kind: 'floor', zone: 'all' }); });
    }

    // Clears tickets, orders, batches and events on this device after a confirm. Settings, menu, the food safety record and
    // sample history stay (A.resetLive in 20-engine.js).
    async function doReset() {
      const s = st(), demo = s.tickets.filter((t) => t.src === 'demo').length;
      const ok = await SB.ui.confirm({
        title: 'Reset live data?', tone: 'danger', confirmLabel: 'Reset live data', cancelLabel: 'Keep everything',
        body: ['This clears ' + s.tickets.length + ' ' + plural(s.tickets.length, 'ticket') + (demo ? ' (' + demo + ' demo)' : '') + ', ' + s.orders.length + ' ' + plural(s.orders.length, 'order') + ' with their payments, ' + s.batches.length + ' ' + plural(s.batches.length, 'batch', 'batches') + ', the 86 list, stock counts and the event log, so the sales figures start again from zero. It also sets the clock back to real time.', 'Settings, the menu, the food safety record and sample history stay. This cannot be undone.'],
      });
      if (!ok) return;
      // With a PIN set, clearing live data asks for it.
      if (SB.shell && SB.shell.requirePin && !(await SB.shell.requirePin())) { toast('The PIN was not entered. Nothing was cleared.', 'warn'); return; }
      if (live && typeof live.stop === 'function') simDo('stop', () => live.stop());
      const rep = SB.store.resetLive({ keepSettings: true, starter: false });
      if (rep === 'ok') toast('Live data cleared. The board is empty.', 'ok'); else toast(E().describe(rep, {}, st().settings), 'warn');
      paint();
    }

    // Writes the status line: demo running or off, how many tickets sent and finished, and the clock speed.
    function paintStatus() {
      const sp = speedNow(), s = simStatus();
      let tone = 'info', icon = 'info', words;
      if (!live) { tone = 'warn'; icon = 'alert'; words = 'The demo is not loaded, so there are no automatic orders.'; }
      else if (s.running) { tone = 'ok'; icon = 'play'; words = 'Demo running: ' + (RATE_WORD[s.rate] || 'orders') + '. ' + (U.isNum(s.sent) ? s.sent + ' sent, ' + (s.completed || 0) + ' finished.' : '') + (s.crew ? ' Auto crew on.' : ' Auto crew off.'); }
      else { words = 'Demo is off. The board shows only real tickets' + (st().tickets.some((t) => t.src === 'demo') ? ' and the demo tickets already on it.' : '.'); }
      if (sp !== 1) words += ' Clock x' + (Math.round(sp * 100) / 100) + '.';
      setHidden(statusBox, !live); // without the simulator the warning box below already says so
      attr(statusBox, 'data-tone', tone);
      if (statusIcon._k !== icon) { statusIcon._k = icon; U.clear(statusIcon); statusIcon.appendChild(ico(icon, 20)); }
      text(statusT, words);
    }
    // Fills in the data counts. WATCH OUT: the sample count is worked out a moment after opening,
    // because building the sample takes noticeable time and must not freeze the sheet.
    function paintCounts() {
      const s = st(), demo = s.tickets.filter((t) => t.src === 'demo').length;
      text(dLive, String(s.tickets.length - demo)); text(dDemo, String(demo));
      if (!sim || typeof sim.sampleInfo !== 'function') { text(dSample, 'Not loaded'); return; }
      if (sim.sampleEnabled && !sim.sampleEnabled()) { text(dSample, 'Switched off'); return; }
      if (paintCounts.info) { text(dSample, U.fmtNum(paintCounts.info.tickets) + ' ' + plural(paintCounts.info.tickets, 'ticket') + ' over ' + paintCounts.info.days + ' ' + plural(paintCounts.info.days, 'day')); return; }
      text(dSample, 'Counting...');
      if (!paintCounts.asked) {
        paintCounts.asked = true;
        setTimeout(() => {
          try { paintCounts.info = sim.sampleInfo(); } catch (e) { paintCounts.info = null; text(dSample, 'Could not be counted'); return; }
          if (sheet.isOpen()) paintCounts();
        }, 60);
      }
    }
    // Refreshes every control from the simulator and the clock, so a change made elsewhere shows here too.
    function paint() {
      paintStatus(); clockCtl.paint(); paintCounts();
      if (live) {
        const s = simStatus();
        const rate = s.running && RATES.some((r) => r.id === s.rate) ? s.rate : 'off';
        if (ordersSeg.getValue() !== rate) ordersSeg.setValue(rate);
        // The crew only works while automatic orders run, so the switch reads off (and locked) until then.
        const crewOn = !!(s.running && s.crew);
        if (crewTog.getValue() !== crewOn) crewTog.setValue(crewOn);
        crewTog.disabled = !s.running;
      }
      if (sampleTog && sim.sampleEnabled && sampleTog.getValue() !== !!sim.sampleEnabled()) sampleTog.setValue(!!sim.sampleEnabled());
    }
    paint();
    watch(offs, () => paint(), () => paint());
    if (live && typeof live.onChange === 'function') { try { const off = live.onChange(() => paint()); if (typeof off === 'function') offs.push(off); } catch (e) { /* the simulator is optional */ } }
    return sheet;
  }

  // The version of this copy of Smokebox, so the owner can tell at a glance whether an update arrived.
  function versionLine() {
    const b = g.SB_BUILD;
    return h('p', { class: 'fs-sub mn-version', dataset: { role: 'version' } }, b && b.version ? 'Smokebox version ' + b.version + ' (build ' + b.id + ')' : 'Smokebox version: not marked (an old or hand-made build)');
  }

  // Help and about.
  // Shortcut list (key, what it does) used when the board does not supply its own.
  // audit:data-start
  const FALLBACK_KEYS = [
    { key: 'N', label: 'New ticket' }, { key: 'R', label: 'Recall a bumped ticket' }, { key: 'H', label: 'Hold cabinet' }, { key: '8', label: 'Sold out (86 board)' },
    { key: 'D', label: 'Demo' }, { key: '1 to 6', label: 'Station: All, PIT, HOT, FRY, CLD, EXP' }, { key: 'Z', label: 'Undo the last action' },
    { key: '?', label: 'Help' }, { key: 'Esc', label: 'Close a screen' },
  ];
  // audit:data-end

  // Starts the guided walkthrough when it is part of this build, otherwise says so.
  function runTour() {
    if (SB.tour && typeof SB.tour.start === 'function') SB.tour.start();
    else SB.ui.toast('The walkthrough is not available in this build.', { tone: 'info' });
  }

  // One help entry: an icon, a bold title and one sentence.
  function helpItem(icon, title, body) {
    return h('li', { class: 'hp-item' }, h('span', { class: 'hp-item-i', 'aria-hidden': 'true' }, ico(icon, 24)), h('div', { class: 'hp-item-t' }, h('strong', null, title), h('span', null, body)));
  }
  // A list of the help entries shown on one tab.
  function helpList(items) { return h('ul', { class: 'hp-list' }, ...items); }
  // One row of the words and colours list: the real badge on the left, its meaning on the right.
  function wordRow(node, body) { return h('li', { class: 'hp-word' }, h('span', { class: 'hp-word-k' }, node), h('span', { class: 'hp-word-v' }, body)); }
  // Seconds as minutes for the plain-words help text.
  const mins = (sec) => (sec % 60 === 0 ? sec / 60 + ' min' : Math.floor(sec / 60) + ' min ' + (sec % 60) + ' s');

  // The Basics tab: what each button on the board does.
  function helpBasics(sheet) {
    const undoS = Math.round(((st().settings && st().settings.undoMs) || C.undoMs) / 1000);
    return h('div', { class: 'hp-pane' },
      h('p', { class: 'fs-sub' }, 'Smokebox shows every order as a paper ticket. Each station sees only its own items, timed so the whole order finishes together.'),
      // Help closes first, so the walkthrough has the whole board to itself.
      h('div', { class: 'fs-row hp-links' }, h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'tour' }, onClick: () => closeThen(sheet, runTour) }, ico('play', 20), h('span', null, 'Show me how it works'))),
      helpList([
        helpItem('plus', 'Send a ticket', 'Tap New ticket, tap the items, tap Send to kitchen. Four lines take fewer than ten taps.'),
        helpItem('check', 'Start and Done', 'Each dish has a button on its row. A one-step dish shows Done: tap it when the dish is ready. A two-step dish shows Start: tap it when cooking starts, it counts down from its usual cooking time, then tap Done.'),
        helpItem('bell', 'Check it', 'When a dish reaches its usual cooking time, its row flashes Check it (and chimes if Sound is on). Smokebox never marks a dish done for you: look at the food, then tap Done.'),
        helpItem('arrow-right', 'The line under each ticket', 'Says what to do next, such as Tap Start on a dish. You can turn it off in Settings.'),
        helpItem('check-circle', 'All done here', 'Finishes every item your station still has on that ticket.'),
        helpItem('zap', 'Start now', 'Starts a waiting item before its planned time. Waiting items are dimmed and show Start in 2:08, so the slow dishes start first and the whole order finishes together.'),
        helpItem('receipt', 'Bump', 'Sends the ticket out when everything is done. If items are not done, Smokebox asks first.'),
        helpItem('undo', 'Undo', 'After a bump, done, void, 86 or discard, an Undo button stays for ' + undoS + ' seconds.' + (hasKeyboard() ? ' The Z key does the same.' : '')),
        helpItem('history', 'Recall', 'Brings a bumped ticket back. Open Recall, find the ticket and tap Recall.'),
        helpItem('list', 'The all-day bar', 'Counts what is still to make across every ticket. Tap an item to highlight it on the board.'),
        helpItem('thermometer', 'Hold cabinet', 'Log a temperature when food goes in and at every check. Smokebox warns before a batch runs out of time and locks one that has.'),
        helpItem('ban', 'Sold out (86 board)', 'The Sold out button marks an item sold out. It also goes 86 by itself when stock runs low or a batch is held back.'),
      ]));
  }

  // The Words and colours tab: the real badges, chips and stamps next to what they mean.
  function helpWords() {
    const s = st();
    const rows = C.channels.map((c) => {
      const th = E().channelThresholds(s.settings, c.id);
      return h('li', { class: 'hp-th' }, h('span', { class: 'chip' }, ico(c.icon, 16), h('span', null, c.name)), h('span', { class: 'hp-th-v' }, 'Running late after ' + mins(th.warnSec) + ', overdue after ' + mins(th.breachSec)));
    });
    return h('div', { class: 'hp-pane' },
      h('p', { class: 'fs-sub' }, 'Color is never the only signal. Every color comes with a word and an icon.'),
      h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'How late is a ticket'),
        h('ul', { class: 'hp-words' },
          wordRow(SB.ui.badge('ok'), 'Inside the time limit for its channel.'),
          wordRow(SB.ui.badge('warn'), 'Past the first limit. Look at it soon.'),
          wordRow(SB.ui.badge('breach'), 'Past the second limit. The border pulses unless motion is reduced.')),
        h('p', { class: 'fs-sub' }, 'The clock runs from when the ticket was sent. Each channel has its own limits:'), h('ul', { class: 'hp-ths' }, ...rows)),
      h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Stations'),
        h('ul', { class: 'hp-words' }, ...C.zones.map((z) => wordRow(h('span', { class: 'chip chip-zone', dataset: { zone: z.id } }, ico(z.icon, 16), h('span', null, z.code)), z.long + (z.id === 'expo' ? '. Sees whole tickets and packs them.' : '.'))))),
      h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Items and tickets'),
        h('ul', { class: 'hp-words' },
          wordRow(h('span', { class: 'stamp' }, 'RUSH'), 'Pacing is skipped: every item is ready to start now and the ticket goes to the front.'),
          wordRow(h('span', { class: 'chip' }, ico('clock', 16), h('span', null, 'Start in 2:10')), 'Waiting. Planned to start later so the order finishes together. Start now starts it early.'),
          wordRow(h('span', { class: 'chip chip-mod' }, 'No pickles'), 'A modifier. Read these before you cook.'),
          wordRow(h('span', { class: 'chip', dataset: { tone: 'warn' } }, ico('alert', 16), h('span', null, 'Allergy')), 'A ticket note. It sits above the items in an amber strip.'))),
      h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Availability'),
        h('ul', { class: 'hp-words' },
          wordRow(stateEl('bad', 'ban', '86 sold out'), 'An ingredient has run down to its 86 level.'),
          wordRow(stateEl('bad', 'ban', '86 safety hold'), 'The only batch is held back: too old, too cold or too warm.'),
          wordRow(stateEl('bad', 'ban', '86 past quality limit'), 'The only batch is past its quality limit and waits until someone tastes it. Keep it serving or throw it out in the hold cabinet.'),
          wordRow(stateEl('bad', 'ban', '86 manual'), 'Someone marked it 86 on the 86 board.'))),
      h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Hold cabinet'),
        h('ul', { class: 'hp-words' },
          wordRow(stateEl('ok', 'check-circle', 'In range'), 'In range and checked on time.'),
          wordRow(stateEl('warn', 'thermometer', 'Check temp'), 'A reading is due. Still being served.'),
          wordRow(stateEl('bad', 'flame', 'Reheat now'), 'Below the hot-hold limit. Not served until it is reheated once, or discarded.'),
          wordRow(stateEl('bad', 'snow', 'Chill now'), 'Above the cold-hold limit. Not served until it is back in range, or discarded.'),
          wordRow(stateEl('bad', 'alert', 'Discard'), 'Out of time or out of range for too long. Locked, and discarded automatically.'))));
  }

  // The Keys tab. The shortcuts come from the board, with a built-in list if the board is not loaded.
  function helpKeys() {
    const list = (SB.floor && Array.isArray(SB.floor.shortcuts) && SB.floor.shortcuts.length ? SB.floor.shortcuts : FALLBACK_KEYS);
    // The undo window is a setting, so the Z line names this kitchen's own number of seconds.
    const undoS = Math.round((st().settings.undoMs || C.undoMs) / 1000);
    const label = (k) => (k.key === 'Z' ? k.label + ' (' + undoS + ' seconds)' : k.label);
    return h('div', { class: 'hp-pane' },
      h('p', { class: 'fs-sub' }, 'On the board, these keys work when no screen is open and you are not typing in a field.'),
      h('ul', { class: 'hp-keys' }, ...list.map((k) => h('li', { class: 'hp-key' }, h('span', { class: 'kbd' }, k.key), h('span', null, label(k))))),
      h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Inside New ticket'),
        h('ul', { class: 'hp-keys' },
          h('li', { class: 'hp-key' }, h('span', { class: 'kbd' }, 'Enter'), h('span', null, 'In the search box: add the first match.')),
          h('li', { class: 'hp-key' }, h('span', { class: 'kbd' }, 'Ctrl + Enter'), h('span', null, 'Send to kitchen. On a Mac, use Cmd + Enter.')),
          h('li', { class: 'hp-key' }, h('span', { class: 'kbd' }, 'Esc'), h('span', null, 'Close. If the order is not empty, it asks first and the order is kept.')))));
  }

  // The Food safety tab: the limits in force right now, read from
  // the settings so it never disagrees with the app.
  // It also explains where the two-hour clock starts.
  function helpSafety() {
    const S = safety(), c = S.cooling || C.safety.cooling;
    // One rule line with its icon.
    const rule = (icon, title, body) => helpItem(icon, title, body);
    return h('div', { class: 'hp-pane' },
      safetyNote(),
      h('p', { class: 'fs-sub' }, 'These are the limits Smokebox is using right now. They start from the FDA Food Code (3-501.14, 3-501.16, 3-403.11 and 4-602.11) and are starter values until the owner confirms them.'),
      helpList([
        rule('flame', 'Keep hot food hot', 'Hot food stays at ' + U.tempText(S.hotHoldF) + ' or above.'),
        rule('snow', 'Keep cold food cold', 'Cold food stays at ' + U.tempText(S.coldHoldF) + ' or below.'),
        rule('thermometer', 'Log a temperature', 'At least every ' + U.minutesText(S.tempCheckEveryMin) + '. A late check shows Check temp and is counted.'),
        rule('refresh', 'Reheat once', 'Below ' + U.tempText(S.hotHoldF) + ', reheat to ' + U.tempText(S.reheatF) + ' within ' + S.belowHotGraceH + ' hours of the first low reading. One reheat per batch. After that, discard it.'),
        rule('clock', 'Where the two hours start', 'The ' + S.belowHotGraceH + '-hour clock starts at the first reading below ' + U.tempText(S.hotHoldF) + ', not when the food left the heat.'),
        rule('package', 'Hold limit', 'Each batch has its own hold limit, shown on its card as Serve by. A throw-out time means the batch must be thrown out when time is up. A quality limit takes it off the menu: check it, then keep it serving 30 minutes or 1 hour at a time with a fresh reading in range. Nothing stays longer than ' + (S.hardCapH || S.defaultMaxHoldH) + ' hours. Your local health department\'s rules apply to quality extensions.'),
        rule('snow', 'Cooling', 'From ' + U.tempText(S.hotHoldF) + ' to ' + U.tempText(c.stage1ToF) + ' within ' + c.stage1H + ' hours, then to ' + U.tempText(c.finalF) + ' within ' + (c.totalH - c.stage1H) + ' more hours (' + c.totalH + ' hours in all).'),
        rule('shield-check', 'Sanitize surfaces', 'Food-contact surfaces every ' + S.sanitizeEveryH + ' hours. An overdue timer is a warning, never a block.'),
        rule('lock', 'Locked batches', 'A batch that is out of range is locked. Nothing is taken from it, and menu items that need it show 86 safety hold.'),
      ]));
  }

  // The About tab: what Smokebox is, what is simulated, and the small manager hint.
  function helpAbout(sheet) {
    return h('div', { class: 'hp-pane' },
      helpList([
        helpItem('flame', 'What this is', 'Smokebox is a kitchen display for restaurants that cook food ahead: tickets, paced start times, a hold cabinet and a sold-out list.'),
        helpItem('download', 'Works offline', 'The whole app is one file. Your board is saved in this browser on this device.'),
        helpItem('users', 'Separate devices do not sync yet', 'Two tabs on the same device stay in step. A second tablet has its own board.'),
        helpItem('scale', 'Starter estimates', 'Prep times, yields, costs, par levels and 86 levels are starter numbers until the owner confirms them.'),
        helpItem('sparkle', 'Demo and sample data', 'Demo tickets and the sample history are made by the app. They are labeled wherever they appear.'),
      ]),
      h('div', { class: 'fs-row hp-links' },
        // All three buttons close Help first, so only one sheet is ever open.
        h('button', { type: 'button', class: 'btn', onClick: () => closeThen(sheet, runTour) }, ico('play', 20), h('span', null, 'Replay the walkthrough')),
        // The specs open after Help closes.
        demoOn() ? h('button', { type: 'button', class: 'btn', onClick: () => closeThen(sheet, () => SB.sheets.open('specs')) }, ico('book', 20), h('span', null, 'See the specs')) : null,
        // The demo sheet opens after Help closes.
        h('button', { type: 'button', class: 'btn', onClick: () => closeThen(sheet, () => SB.sheets.open('demo')) }, ico('play', 20), h('span', null, 'Demo and clock'))),
      h('p', { class: 'fs-sub hp-tiny' }, 'Smokebox version ' + C.version + '. Managers: tap Back office at the top of the board, or press Ctrl+Shift+O. To add a dish or change a price, open Settings, then Dishes and prices.'));
  }

  // True when this device has a mouse or trackpad (a laptop or desktop), so keyboard shortcuts are worth showing.
  // A touch-only tablet or phone answers false.
  function hasKeyboard() { try { return !!(g.matchMedia && g.matchMedia('(any-pointer: fine)').matches); } catch (e) { return true; } }
  // Builds the Help sheet with its tabs (Keys only on a device with a mouse or trackpad). opts.tab can pick the tab to open on.
  function openHelp(opts) {
    opts = opts || {};
    const sheet = SB.ui.sheet({ title: 'Help and about', side: 'right', width: 'min(720px, 96vw)', name: 'help' });
    const defs = [
      { id: 'basics', label: 'Basics', panel: h('div', null, helpBasics(sheet)) },
      { id: 'words', label: 'Words and colors', panel: h('div', null, helpWords()) },
      hasKeyboard() ? { id: 'keys', label: 'Keys', panel: h('div', null, helpKeys()) } : null,
      { id: 'safety', label: 'Food safety', panel: h('div', null, helpSafety()) },
      { id: 'about', label: 'About', panel: h('div', null, helpAbout(sheet)) },
    ].filter(Boolean);
    const start = defs.some((d) => d.id === opts.tab) ? opts.tab : 'basics';
    const tabs = tabsWithPanels('Help topics', defs, start);
    sheet.body.append(h('div', { class: 'hp' }, tabs.seg, ...defs.map((d) => d.panel)));
    return sheet;
  }

  // Specs: the palette with contrast computed from the live tokens.
  // Minimum contrast ratios (WCAG AA): 4.5 for text, 3 for borders and focus rings.
  const TEXT_MIN = 4.5, UI_MIN = 3;
  // Colour pairs to check: [foreground token, background token, minimum, what it is].
  // audit:data-start
  const SPEC_PAIRS = [
    ['ink', 'bg', TEXT_MIN, 'Body text on the board'], ['ink', 'paper', TEXT_MIN, 'Body text on a card'], ['ink', 'sub', TEXT_MIN, 'Body text on a panel'],
    ['ink2', 'bg', TEXT_MIN, 'Secondary text'], ['ink3', 'bg', TEXT_MIN, 'Quiet text on the board'], ['ink3', 'sub', TEXT_MIN, 'Quiet text on a panel'],
    ['amber-ink', 'bg', TEXT_MIN, 'Small amber text'], ['sage-ink', 'bg', TEXT_MIN, 'Small sage text'], ['crimson', 'bg', TEXT_MIN, 'Overdue text'],
    ['on-primary', 'primary', TEXT_MIN, 'Label on the amber button'], ['on-success', 'success', TEXT_MIN, 'Label on the sage button'], ['on-danger', 'danger', TEXT_MIN, 'Label on the red button'],
    ['z-pit', 'paper', TEXT_MIN, 'PIT code on a ticket'], ['z-sides', 'paper', TEXT_MIN, 'HOT code on a ticket'], ['z-fry', 'paper', TEXT_MIN, 'FRY code on a ticket'], ['z-cold', 'paper', TEXT_MIN, 'CLD code on a ticket'], ['z-expo', 'paper', TEXT_MIN, 'EXP code on a ticket'],
    ['stamp', 'paper', TEXT_MIN, 'RUSH stamp'],
    ['line', 'bg', UI_MIN, 'Borders and edges'], ['amber', 'bg', UI_MIN, 'Amber borders and fills'], ['focus', 'bg', UI_MIN, 'Keyboard focus ring'],
  ];
  // Palette swatches: [token, colour name, what it is used for].
  const SWATCHES = [
    ['bg', 'Parchment', 'the board'], ['ink', 'Charcoal', 'text and button edges'], ['line', 'Zinc', 'borders and structure'], ['amber', 'Brisket amber', 'fills and large shapes'],
    ['sage', 'Sage', 'done and success'], ['crimson', 'Overdue', 'overdue and danger'], ['paper', 'Card', 'tickets and fields'], ['sub', 'Sub', 'panels and wells'],
  ];
  // audit:data-end
  // Every token the contrast check needs, read once per theme.
  const SPEC_TOKENS = Array.from(new Set(SPEC_PAIRS.reduce((a, p) => a.concat([p[0], p[1]]), []).concat(SWATCHES.map((s) => s[0]))));

  // Read token values for a theme. The attribute swap happens inside
  // one synchronous block, so nothing paints in between.
  function readTokens(theme, names) {
    const root = doc.documentElement, prev = root.getAttribute('data-theme');
    const swap = theme !== (prev || 'day');
    if (swap) root.setAttribute('data-theme', theme);
    const out = {};
    try { const cs = g.getComputedStyle(root); names.forEach((n) => { out[n] = cs.getPropertyValue('--' + n).trim(); }); }
    finally { if (swap) { if (prev == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prev); } }
    return out;
  }
  // True for a six-digit colour code like #1E2224.
  const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s || '');
  // A contrast ratio as text, like 4.52:1.
  const ratioText = (r) => r.toFixed(2) + ':1';

  // Builds the Specs sheet. Every contrast ratio is computed here from the colours the app is using,
  // never typed in by hand.
  function openSpecs() {
    let off = null;
    // The listener on the theme is removed when the sheet closes.
    const sheet = SB.ui.sheet({ title: 'Specs', side: 'right', width: 'min(820px, 96vw)', name: 'specs', onClose: () => { if (off) off(); } });
    let theme = SB.theme.get();
    const summary = h('p', { class: 'sp-summary', role: 'status' });
    const list = h('ul', { class: 'sp-list' });
    const swatches = h('ul', { class: 'sp-swatches' });
    // Which theme to check. This changes the numbers only, not the look of the app.
    const themeSeg = SB.ui.segmented({ label: 'Theme to check', class: 'sp-theme', value: theme, options: [{ id: 'day', label: 'Day', icon: 'sun' }, { id: 'night', label: 'Night', icon: 'moon' }], onChange: (id) => { theme = id; paint(); } });

    // Reads the chosen theme's colours and rebuilds the contrast list, the summary line and the swatches.
    function paint() {
      const t = readTokens(theme, SPEC_TOKENS);
      U.clear(list); U.clear(swatches);
      let pass = 0, total = 0, low = null;
      SPEC_PAIRS.forEach(([fg, bg, min, what]) => {
        const a = t[fg], b = t[bg];
        const ok = isHex(a) && isHex(b);
        const ratio = ok ? U.contrast(a, b) : NaN;
        const good = ok && ratio + 1e-9 >= min;
        total++; if (good) pass++;
        if (ok && (!low || ratio < low.ratio)) low = { ratio, what };
        const sample = h('span', { class: 'sp-sample', style: ok ? 'color:' + a + ';background:' + b : '', 'aria-hidden': 'true' }, 'Aa');
        list.appendChild(h('li', { class: 'sp-row', dataset: { fg, bg, ratio: ok ? ratio.toFixed(2) : '', pass: good ? 'yes' : 'no' } },
          sample,
          h('span', { class: 'sp-what' }, h('strong', null, what), h('span', { class: 'sp-hex' }, fg + ' ' + (a || 'unknown') + ' on ' + bg + ' ' + (b || 'unknown'))),
          h('span', { class: 'sp-result' },
            h('span', { class: 'sp-ratio num' }, ok ? ratioText(ratio) : 'n/a'),
            h('span', { class: 'sp-need num' }, 'needs ' + min + ':1'),
            stateEl(good ? 'ok' : 'bad', good ? 'check-circle' : 'alert', good ? 'Pass' : 'Fails'))));
      });
      text(summary, pass + ' of ' + total + ' pairs pass in ' + (theme === 'night' ? 'Night' : 'Day') + '.' + (low ? ' Lowest: ' + ratioText(low.ratio) + ', ' + low.what.toLowerCase() + '.' : ''));
      attr(summary, 'data-tone', pass === total ? 'ok' : 'bad');
      SWATCHES.forEach(([tok, name, use]) => {
        const hex = t[tok];
        const ink = isHex(hex) ? (U.contrast(hex, '#FFFFFF') >= U.contrast(hex, '#000000') ? '#FFFFFF' : '#000000') : 'inherit';
        swatches.appendChild(h('li', { class: 'sp-sw', style: isHex(hex) ? 'background:' + hex + ';color:' + ink : '' }, h('strong', null, name), h('span', { class: 'sp-sw-hex num' }, hex || 'unknown'), h('span', { class: 'sp-sw-use' }, use)));
      });
    }

    const tokenVals = readTokens(SB.theme.get(), ['tap', 'tap-lg', 'tap-step', 'fs-1', 'fs-2', 'fs-3', 'fs-4', 'fs-5', 'fs-6', 'fs-7', 'fs-8']);
    const scale = ['fs-1', 'fs-2', 'fs-3', 'fs-4', 'fs-5', 'fs-6', 'fs-7', 'fs-8'].map((k) => parseFloat(tokenVals[k]) || 0).filter(Boolean);
    // One titled section of the page.
    const sec = (title, ...kids) => h('section', { class: 'fs-section sp-sec' }, h('h3', { class: 'fs-h' }, title), ...kids);

    sheet.body.append(h('div', { class: 'sp' },
      sec('Contrast, computed live', h('p', { class: 'fs-sub' }, 'Each ratio is worked out on this device from the color tokens the app is using, with the WCAG formula. Text needs 4.5:1. Borders, focus rings and large shapes need 3:1.'), themeSeg, summary, list),
      sec('Palette', h('p', { class: 'fs-sub' }, 'The palette is fixed by the brief. Small text uses the darker amber and sage inks so it passes on parchment.'), swatches),
      sec('Type and touch targets',
        h('p', { class: 'fs-sub' }, 'Barlow Condensed for numbers, timers and headings. Barlow for everything else. Without internet the app falls back to system condensed fonts, so letter widths differ from the screenshots.'),
        h('p', { class: 'sp-scale' }, ...scale.map((px) => h('span', { class: 'sp-scale-i', style: 'font-size:' + px + 'px' }, Math.round(px)))),
        h('dl', { class: 'fs-dl' }, h('dt', null, 'Buttons and rows'), h('dd', { class: 'num' }, parseFloat(tokenVals.tap) + ' px'), h('dt', null, 'Primary actions'), h('dd', { class: 'num' }, parseFloat(tokenVals['tap-lg']) + ' px'), h('dt', null, 'Stepper buttons'), h('dd', { class: 'num' }, parseFloat(tokenVals['tap-step']) + ' px'))),
      sec('What changed from the original file',
        helpList([
          helpItem('refresh', 'No whole-board redraw each second', 'The original rebuilt the board every second, so a tap could land on a node that was about to be replaced. Now only timer text changes each second.'),
          helpItem('eye', 'Contrast is measured, not typed in', 'The original printed a fixed 7.8:1. Its small amber text was 4.06:1, under the 4.5:1 minimum. Small amber text now uses a darker ink, and this screen does the maths.'),
          helpItem('clock', 'Paced start times', 'Each line starts so the whole order finishes together. Prep times are learned from real tickets and start as estimates.'),
          helpItem('thermometer', 'A hold cabinet that keeps checks on time', 'Temperature logs, reheat once, discard on time, and automatic 86 when a batch is locked. The two-hour clock starts at the first low reading (see Help, Food safety).'),
          helpItem('undo', 'Undo, keys and themes', 'Ten seconds of undo, keyboard shortcuts, Day and Night, and a large text option.'),
          helpItem('scale', 'Weights in grams and kilograms', 'Never cups.'),
        ])),
      sec('Honest notes',
        helpList([
          helpItem('sun', 'Not tested in real sunlight', 'Contrast is calculated from colors. It has not been measured on a screen in daylight, on a greasy glass, or through gloves.'),
          helpItem('info', 'Demo channels', 'There is no live POS or delivery connection. The 86 sync strip is for the demo only and says so.'),
          helpItem('scale', 'Starter estimates', 'Prep times, yields, costs, par levels and 86 levels are starter numbers until the owner confirms them.'),
          helpItem('sparkle', 'Demo and sample data', 'Demo tickets and the sample history are made by the app.'),
          helpItem('shield', 'Local rules win', C.safetyLine),
        ]))));

    paint();
    off = SB.theme.onChange((what) => { if (what === 'theme') { theme = SB.theme.get(); themeSeg.setValue(theme); paint(); } });
    return sheet;
  }

  // Settings (the floor menu, SPEC 14.4).

  // One labelled settings block: a heading, a short help line (left out when empty) and the control.
  function settingBlock(title, help, node, node2, node3, node4) {
    return h('section', { class: 'fs-section mn-block' }, h('h3', { class: 'fs-h' }, title), help ? h('p', { class: 'fs-sub' }, help) : null, node, node2 || null, node3 || null, node4 || null);
  }

  // Builds the Settings sheet (look, text size, sound, station, clock speed, links) and returns it.
  // WATCH OUT: without SB.floor the sound switch is shown off and
  // locked; business settings are never changed here.
  function openMenu() {
    // Each entry stops one listener when the sheet closes.
    const offs = [];
    const sheet = SB.ui.sheet({ title: 'Settings', side: 'right', width: 'min(480px, 96vw)', name: 'menu', onClose: () => offs.splice(0).forEach((f) => f()) });

    // Look: Day is the bright anti-glare board, Night is the charcoal one. Saved by the theme module.
    const themeSeg = SB.ui.segmented({ label: 'Look', class: 'mn-look', value: SB.theme.get(), options: [{ id: 'day', label: 'Day', icon: 'sun' }, { id: 'night', label: 'Night', icon: 'moon' }], onChange: (id) => SB.theme.set(id) });

    // Text size: Large makes every size 20 percent bigger.
    const textSeg = SB.ui.segmented({ label: 'Text size', class: 'mn-text', value: SB.theme.textSize(), options: [{ id: 'normal', label: 'Normal' }, { id: 'large', label: 'Large' }], onChange: (id) => SB.theme.setTextSize(id) });

    // Ticket size: Auto draws full-size tickets while they fit in one row, then compact ones.
    const sizeSeg = SB.ui.segmented({ label: 'Ticket size', class: 'mn-size', value: SB.theme.density(), options: [{ id: 'auto', label: 'Auto' }, { id: 'large', label: 'Full size' }, { id: 'compact', label: 'Compact' }], onChange: (id) => SB.theme.setDensity(id) });

    // The "do this next" line under each ticket.
    const hintsTog = SB.ui.toggle({ label: 'Show the next step on each ticket', checked: SB.theme.hints(), onChange: (on) => SB.theme.setHints(on) });

    // Sound: the chime on a new ticket and the beeps when a dish needs checking. It lives in the board module, so it is optional here.
    const floorOk = !!(SB.floor && typeof SB.floor.setSound === 'function');
    const soundTog = SB.ui.toggle({ label: cookOn() ? 'Chime for new tickets, dishes to check and batch warnings' : 'Chime for new tickets and dishes to check', checked: floorOk ? !!SB.floor.sound() : false, disabled: !floorOk, onChange: (on) => { if (floorOk) SB.floor.setSound(on); } });
    // Loudness of this tablet's warnings (20 to 100 percent); the sound switch above is the way to silence.
    const volIn = h('input', { type: 'range', min: '20', max: '100', step: '10', value: String(Math.round((floorOk && SB.floor.volume ? SB.floor.volume() : 1) * 100)), 'aria-label': 'Warning loudness on this tablet', class: 'mn-volume', disabled: !floorOk });
    volIn.addEventListener('change', () => { if (floorOk && SB.floor.setVolume) SB.floor.setVolume(Number(volIn.value) / 100); });
    // How much the voice talks: light, normal or full. The voice itself is always the loud chef.
    const levelOk = floorOk && typeof SB.floor.setVoiceLevel === 'function';
    const levelSeg = SB.ui.segmented({ label: 'How much the voice talks', class: 'mn-vlevel', value: levelOk ? SB.floor.voiceLevel() : 'normal', options: [{ id: 'light', label: 'Light' }, { id: 'normal', label: 'Normal' }, { id: 'full', label: 'Full' }], onChange: (id) => { if (levelOk) SB.floor.setVoiceLevel(id); } });
    const speechOk = floorOk && typeof SB.floor.setSpeech === 'function';
    const speechTog = SB.ui.toggle({ label: 'Speak batch warnings aloud', checked: speechOk ? !!SB.floor.speech() : false, disabled: !speechOk, onChange: (on) => { if (speechOk) SB.floor.setSpeech(on); } });
    // Test the sound: plays a chime and a spoken line, then says in words whether this tablet let it play.
    const testSay = h('p', { class: 'fs-sub mn-test-say', role: 'status' });
    const testBtn = h('button', { type: 'button', class: 'btn', dataset: { act: 'test-sound' }, disabled: !floorOk, onClick: () => {
      const r = SB.floor.testSound ? SB.floor.testSound() : 'unsupported';
      text(testSay, r === 'running' ? 'You should have heard a chime and a voice. If not, turn the tablet volume up.' : r === 'unsupported' ? 'This browser cannot play sound. Warnings will only show on screen.' : 'The browser has not let the board play sound yet. Tap the button once more.');
    } }, ico('volume', 20), h('span', null, 'Test the sound'));
    // Test the voice: speaks a sample call and names the voice picked and where it lives (on the tablet or over the internet).
    const voiceSay = h('p', { class: 'fs-sub mn-test-voice', role: 'status' });
    const voiceBtn = h('button', { type: 'button', class: 'btn', dataset: { act: 'test-voice' }, disabled: !floorOk, onClick: () => {
      const v = SB.floor.testVoice ? SB.floor.testVoice() : { supported: false };
      text(voiceSay, !v.supported ? 'This tablet cannot speak. Warnings will be tones only.' : v.name ? 'Voice: ' + v.name + (v.local ? ', stored on this tablet.' : ', needs the internet.') : 'Voice: the tablet\'s own default voice.');
    } }, ico('volume', 20), h('span', null, 'Test the voice'));
    // Voice chooser: every English voice this device has, so the owner can pick the one that sounds best. Saved on this device;
    // Automatic picks the best one by itself. A choice says a short sample at once.
    const voiceSel = h('select', { class: 'input mn-voice', dataset: { act: 'voice-pick' }, 'aria-label': 'Voice', disabled: !floorOk });
    // Fills the voice list; browsers load their voices a moment after the page, so this runs again when they arrive.
    function fillVoices() {
      const ss = g.speechSynthesis, all = ss && ss.getVoices ? ss.getVoices() : [];
      const en = all.filter((v) => /^en/i.test(String(v.lang || '').replace('_', '-')));
      const cur = U.storage.get('smokebox.v1.voicename', '');
      U.clear(voiceSel);
      voiceSel.append(h('option', { value: '' }, 'Automatic (best on this device)'), ...en.map((v) => h('option', { value: v.name }, v.name + (v.localService === false ? ' (needs internet)' : ''))));
      voiceSel.value = en.some((v) => v.name === cur) ? cur : '';
    }
    fillVoices();
    if (g.speechSynthesis && typeof g.speechSynthesis.addEventListener === 'function') { g.speechSynthesis.addEventListener('voiceschanged', fillVoices); offs.push(() => g.speechSynthesis.removeEventListener('voiceschanged', fillVoices)); }
    voiceSel.addEventListener('change', () => {
      U.storage.set('smokebox.v1.voicename', voiceSel.value);
      const v = SB.floor.testVoice ? SB.floor.testVoice() : { supported: false };
      text(voiceSay, v.name ? 'Voice: ' + v.name + '.' : 'Voice: the device\'s own default voice.');
    });
    const voiceRow = h('label', { class: 'mn-vol' }, h('span', null, 'Voice'), voiceSel);
    const testRow = h('div', { class: 'mn-test' }, testBtn, testSay, voiceBtn, voiceSay);
    const soundHelp = floorOk ? 'On by default, because a missed warning can cost a whole batch. Some browsers only play sound after you have tapped the screen once.' : 'The board is not loaded in this build, so there is no sound setting.';

    // Far display: for a screen read from across the kitchen. Per tablet; needs the board module.
    const farTog = SB.ui.toggle({ label: 'Far display (big type, quiet board)', checked: floorOk && SB.floor.farDisplay ? SB.floor.farDisplay() : false, disabled: !(floorOk && SB.floor.setFarDisplay), onChange: (on) => { if (floorOk && SB.floor.setFarDisplay) SB.floor.setFarDisplay(on); } });

    // Voice call-outs: on by default, with a switch per tablet; they follow the station tab showing and need sound and speech on.
    const coTog = SB.ui.toggle({ label: 'Voice call-outs for new tickets and "start now"', checked: floorOk && SB.floor.callouts ? SB.floor.callouts() : false, disabled: !(floorOk && SB.floor.setCallouts), onChange: (on) => { if (floorOk && SB.floor.setCallouts) SB.floor.setCallouts(on); } });
    // Wall mode: three panes on a screen 1700 px wide or more. Per screen; needs the board module.
    const wallTog = SB.ui.toggle({ label: 'Wall mode (three panes on a wide screen)', checked: floorOk && SB.floor.wall ? SB.floor.wall() : false, disabled: !(floorOk && SB.floor.setWall), onChange: (on) => { if (floorOk && SB.floor.setWall) SB.floor.setWall(on); } });

    // Station: the board opens on this station and reopens on it after a reload.
    const stations = [{ id: 'all', label: 'All', icon: 'grid' }].concat(C.zones.map((z) => ({ id: z.id, label: z.name, icon: z.icon })));
    const view0 = SB.router.view();
    const stationSeg = SB.ui.segmented({ label: 'Station on this tablet', class: 'mn-station', value: view0.kind === 'floor' ? view0.zone : SB.router.lastZone(), options: stations, onChange: (id) => {
      // Close first, then move, so no extra browser-history entry is left behind.
      closeThen(sheet, () => SB.router.go({ kind: 'floor', zone: id }));
    } });

    // Clock speed shortcut: the same control as the Demo sheet, so both always agree.
    const clockCtl = clockControl('Clock speed');
    const clockBlock = settingBlock('Clock speed', 'Only for demos and training. Real service runs at x1.', clockCtl.el);
    clockCtl.wrap = clockBlock; setHidden(clockBlock, !demoOn());

    // Links to the other support sheets. Each closes this one first.
    const link = (icon, label, name) => h('button', { type: 'button', class: 'btn btn-block mn-link', onClick: () => closeThen(sheet, () => SB.sheets.open(name)) }, ico(icon, 22), h('span', { class: 'grow' }, label), ico('chevron-right', 20));
    const tourLink = h('button', { type: 'button', class: 'btn btn-block mn-link', onClick: () => closeThen(sheet, runTour) }, ico('play', 22), h('span', { class: 'grow' }, 'Show me how it works'), ico('chevron-right', 20));
    // Back office closes this sheet first, then opens the manager pages (the shell asks for the PIN if one is set).
    const officeLink = h('button', { type: 'button', class: 'btn btn-block mn-link', dataset: { act: 'office' }, onClick: () => closeThen(sheet, () => { if (SB.shell && SB.shell.ignite) SB.shell.ignite({}); }) }, ico('gauge', 22), h('span', { class: 'grow' }, 'Back office'), ico('chevron-right', 20));
    // Opens Dishes and prices: add, rename, reprice or remove dishes without going to the back office.
    const menuLink = h('button', { type: 'button', class: 'btn btn-block mn-link', dataset: { act: 'menu-edit' }, onClick: () => closeThen(sheet, () => SB.sheets.open('dishes')) }, ico('sliders', 22), h('span', { class: 'grow' }, 'Dishes and prices'), ico('chevron-right', 20));
    // The Guide opens only when the guide page is part of this copy of Smokebox.
    const guideLink = typeof SB.guide === 'object' && SB.guide && typeof SB.guide.open === 'function'
      ? h('button', { type: 'button', class: 'btn btn-block mn-link', dataset: { act: 'guide' }, onClick: () => closeThen(sheet, () => SB.guide.open()) }, ico('info', 22), h('span', { class: 'grow' }, 'Guide')) : null;
    const links = h('div', { class: 'mn-links' }, officeLink, menuLink, tourLink, link('help', 'Help and about', 'help'), guideLink, cookOn() ? link('receipt', 'Thrown-out log', 'discards') : null, cookOn() ? link('thermometer', 'Readings', 'readings') : null, link('sliders', 'Tax, hours and PIN', 'shop'), link('check-circle', 'Device checks: screen, sound, home screen', 'ready'), link('sliders', 'How you serve', 'serve'), link('check-circle', 'Set up this device: first steps', 'setup'), demoOn() ? link('book', 'Specs', 'specs') : null, link('play', SB.store.isolated && SB.store.isolated() && !SB.store.isDemo() ? 'Watch the demo' : 'Demo and clock', 'demo'));

    // The saved-history line: how full this tablet's saved history is, and a way to Close the month once it is getting full.
    // Nothing shows in the demo or when the store cannot say.
    const historyBlock = (() => {
      let fill = null; try { fill = SB.store.historyFill && !(SB.store.isDemo && SB.store.isDemo()) ? SB.store.historyFill() : null; } catch (e) { fill = null; }
      if (!fill || typeof fill.pct !== 'number') return null;
      const parts = [];
      // Closes Settings, then opens the Close the month flow (which asks for the PIN first).
      const openFlow = () => closeThen(sheet, () => SB.setup && SB.setup.openCloseMonth && SB.setup.openCloseMonth());
      if (fill.nearFull) parts.push(h('button', { type: 'button', class: 'btn', dataset: { act: 'history-close-month' }, onClick: openFlow }, 'Close the month...'));
      const words = 'Saved history: ' + Math.round(fill.pct) + '% full.' + (fill.nearFull ? ' Close the month to save older days to files.' : '') + (fill.persisted === false ? ' Your browser may clear this data if the tablet is unused. Installing the app (Tablet checks, step 4) usually helps. Save a backup every day.' : '');
      return settingBlock('Saved history', words, ...parts);
    })();
    // Signed in to the hosted server: which kitchen and account this device is on, and a way to sign this one device out.
    // Sign this device out: the kitchen and the other devices stay as they are.
    const signOutBtn = h('button', { type: 'button', class: 'btn btn-block mn-link', dataset: { act: 'sign-out' }, onClick: () => SB.cloud.signOut() }, ico('arrow-right', 22), h('span', { class: 'grow' }, 'Sign this device out'));
    const cloudBlock = SB.cloud && SB.cloud.on
      ? settingBlock('Your kitchen', 'This device is signed in to ' + SB.cloud.kitchen.name + ' (' + SB.cloud.email + '). Every device signed in to it shows the same tickets.', signOutBtn)
      : null;
    sheet.body.append(h('div', { class: 'mn' },
      cloudBlock,
      // The one-time offer to clear old demo tickets from real reports; null (nothing shown) when there are none.
      SB.setup && SB.setup.leftoversCard ? SB.setup.leftoversCard() : null,
      settingBlock('Look', 'Day is the bright parchment board. Night is charcoal, easier on the eyes in a dim kitchen.', themeSeg),
      settingBlock('Text size', 'Large makes everything 20 percent bigger.', textSeg),
      settingBlock('Ticket size', 'Auto shows full-size tickets while they fit in one row, then switches to compact so a rush stays on one screen.', sizeSeg),
      settingBlock('Next step', 'A line under each ticket that says what to do next, such as Tap Start on a dish.', hintsTog),
      settingBlock('Sound', soundHelp, soundTog, speechTog, h('label', { class: 'mn-vol' }, h('span', null, 'Loudness on this tablet'), volIn), voiceRow, testRow),
      settingBlock('Far display', 'For a TV or a tablet read from across the kitchen: a much bigger warning strip and bigger tickets, no "On time" badges so only late tickets stand out, and overdue tickets get a heavy red outline. Try it from where the cook stands.', farTog),
      settingBlock('Voice call-outs', 'A chef calls the line out loud. Light: "Fire the pizza now! Ticket 12!" and "Ticket 12 is up! Ring it out!". Normal: adds "Order up!" for new tickets and one reminder if a dish is not started or a ticket not rung out. Full: keeps reminding until you start the dish or ring out the ticket. At a station tab it only calls that station\'s dishes. It needs sound and spoken warnings on, and old calls are dropped, not read late. Not tried on a real tablet yet.', coTog, levelSeg),
      settingBlock('Wall mode', 'For a wide screen or TV (1700 px and wider) in one window: the kitchen board in the middle, open orders and payments on the left, and a manager glance on the right (money so far, late tickets, the 86 list, when brisket runs out). Below that width nothing changes.', wallTog),
      settingBlock('Station on this tablet', 'The board opens on this station, and again after a reload.', stationSeg),
      clockBlock,
      historyBlock,
      settingBlock('More', '', links),
      // Start over sits alone at the very bottom, away from the everyday buttons. In the demo it is replaced by the way back.
      SB.store.isDemo && SB.store.isDemo()
        ? settingBlock('The demo', 'You are in the demo, not your kitchen.', h('button', { type: 'button', class: 'btn btn-block mn-link', onClick: () => SB.store.leaveDemo() }, ico('arrow-right', 22), h('span', { class: 'grow' }, 'Back to my kitchen')))
        : settingBlock('Start over', 'Empty the menu and begin again. A backup is saved for you first.', link('trash', 'Start over with an empty menu', 'startover')),
      versionLine()));

    // Keep every control in step when something else changes the look, the station or the clock.
    offs.push(SB.theme.onChange(() => { themeSeg.setValue(SB.theme.get()); textSeg.setValue(SB.theme.textSize()); sizeSeg.setValue(SB.theme.density()); hintsTog.setValue(SB.theme.hints()); }));
    offs.push(SB.router.onChange((v) => { if (v.kind === 'floor') stationSeg.setValue(v.zone); }));
    offs.push(SB.store.subscribeTick(() => clockCtl.paint()));
    return sheet;
  }

  // Registration: the board, the header and the keyboard open these by name with SB.sheets.open(name).
  SB.sheets.register('hold', openHold);
  SB.sheets.register('board86', openBoard86);
  SB.sheets.register('recall', openRecall);
  SB.sheets.register('demo', openDemo);
  SB.sheets.register('help', openHelp);
  SB.sheets.register('specs', openSpecs);
  SB.sheets.register('menu', openMenu);
})(typeof globalThis !== 'undefined' ? globalThis : window);
