/*
 * WHAT THIS FILE IS: The start-up sequence, loaded last, in the order of SPEC section 19: page ready,
 *    store.init (load saved data; a first run is an empty kitchen), then mount the shell (draw the
 *    screen). If any step fails it shows a plain "Smokebox could not start" card with Reload and Copy details
 *    buttons, never a white screen.
 * PARTS: loadErrors, detailsText, showBootError, storageNotices, boot.
 * USES: 30-store.js, 45-sim.js, 60-shell.js. USED BY: nothing calls it; it runs by itself when the page is
 *    ready.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const doc = g.document;
  if (!doc) return;

  // Source files that failed to load, as recorded by the build's per-file safety wrapper in
  // window.__sbLoadErrors. Returns a copy, empty when all loaded.
  function loadErrors() { return Array.isArray(g.__sbLoadErrors) ? g.__sbLoadErrors.slice() : []; }

  // Builds the plain text for the error card and the Copy details button: the step that failed, the message,
  // any files that failed to load, the stack, the time, the page address and the browser.
  function detailsText(err, stage) {
    const lines = ['Smokebox boot failure', 'Stage: ' + (stage || 'unknown'), 'Message: ' + ((err && err.message) || String(err || 'unknown error'))];
    const errs = loadErrors();
    if (errs.length) lines.push('Modules that failed to load:', ...errs.map((e) => '  ' + e.file + ': ' + e.message));
    if (err && err.stack) lines.push('Stack:', String(err.stack));
    lines.push('Time: ' + new Date().toISOString(), 'Page: ' + (g.location ? g.location.href.replace(/#.*/, '') : ''), 'Browser: ' + ((g.navigator && g.navigator.userAgent) || ''));
    return lines.join('\n');
  }

  // Replaces the screen with the error card: the message, which files failed, a Reload button and a Copy
  // details button. Safe to call twice (it removes the old card first).
  function showBootError(err, stage) {
    try { console.error('[smokebox] boot failed at ' + (stage || '?'), err); } catch (e) { /* ignore */ }
    const old = doc.getElementById('boot-error');
    if (old) old.remove();
    const text = detailsText(err, stage);
    const mods = loadErrors();
    const wrap = doc.createElement('div');
    wrap.id = 'boot-error'; wrap.className = 'boot-error'; wrap.setAttribute('role', 'alert');
    // Styled inline on purpose: the style sheet may be the very thing that failed to load.
    wrap.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:16px;background:#F5F2EB;color:#1E2224;font-family:system-ui,sans-serif';
    const card = doc.createElement('div'); card.className = 'error-card';
    const h2 = doc.createElement('h2'); h2.textContent = 'Smokebox could not start';
    const p = doc.createElement('p'); p.textContent = (err && err.message) || String(err || 'Unknown error');
    const how = doc.createElement('p'); how.className = 't-muted';
    how.textContent = mods.length ? 'These parts failed to load: ' + mods.map((m) => m.file).join(', ') + '. Reload the page. If it keeps failing, copy the details and send them to whoever set this up.' : 'Reload the page. If it keeps failing, copy the details and send them to whoever set this up.';
    const pre = doc.createElement('div'); pre.className = 'error-detail'; pre.tabIndex = 0; pre.setAttribute('aria-label', 'Technical details'); pre.textContent = text;
    const row = doc.createElement('div'); row.className = 'row';
    const reload = doc.createElement('button'); reload.type = 'button'; reload.className = 'btn btn-primary'; reload.textContent = 'Reload';
    reload.addEventListener('click', () => g.location.reload());
    const copy = doc.createElement('button'); copy.type = 'button'; copy.className = 'btn'; copy.textContent = 'Copy details';
    copy.addEventListener('click', () => {
      // Shows whether copying worked, or tells the person to copy the text by hand.
      const done = (ok) => { copy.textContent = ok ? 'Copied' : 'Select and copy the text above'; };
      // Prefer the app's own copy helper, then the browser clipboard; if neither exists, ask for a hand
      // copy.
      if (SB.ui && SB.ui.copyText) SB.ui.copyText(text).then(done);
      else if (g.navigator && g.navigator.clipboard) g.navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
      else done(false);
    });
    row.append(reload, copy);
    card.append(h2, p, how, pre, row);
    wrap.appendChild(card);
    doc.body.appendChild(wrap);
    try { reload.focus(); } catch (e) { /* ignore */ }
  }

  // Blocks the screen with a plain message when saved data could not be read AND could not be copied aside (the browser store is full). The
  // damaged text is offered as a file; nothing is written over it until the person says they have saved it.
  function showHeldData(text) {
    const wrap = doc.createElement('div');
    wrap.id = 'held-data'; wrap.setAttribute('role', 'alertdialog'); wrap.setAttribute('aria-labelledby', 'held-data-h');
    // Follows the tablet's look: Night colors and Large text apply here too, so the screen reads the same as the board behind it.
    let night = false, large = false;
    try { night = !!(SB.theme && SB.theme.get && SB.theme.get() === 'night'); large = !!(SB.theme && SB.theme.textSize && SB.theme.textSize() === 'large'); } catch (e) { /* default look */ }
    wrap.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:16px;font-family:system-ui,sans-serif;z-index:99999;font-size:' + (large ? '120%' : '100%') + ';background:' + (night ? '#1E2224' : '#F5F2EB') + ';color:' + (night ? '#F5F2EB' : '#1E2224');
    const card = doc.createElement('div'); card.className = 'error-card';
    if (night) card.style.cssText = 'background:#2B3033;color:#F5F2EB;border-color:#6B7478';
    const h2 = doc.createElement('h2'); h2.id = 'held-data-h'; h2.textContent = 'Your saved data could not be read, and could not be kept safe';
    const p = doc.createElement('p'); p.textContent = 'This browser is too full to set the old data aside, so Smokebox has not touched it. Nothing new will be saved on this device until you choose below. Download the old data now and keep the file. Then free some space, or continue and let Smokebox replace the old data.';
    const row = doc.createElement('div'); row.className = 'row'; row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:12px';
    const bstyle = 'min-height:48px;flex:1 1 220px';
    const dl = doc.createElement('button'); dl.type = 'button'; dl.className = 'btn btn-primary'; dl.style.cssText = bstyle; dl.textContent = 'Download the old data';
    const show = doc.createElement('button'); show.type = 'button'; show.className = 'btn'; show.style.cssText = bstyle; show.textContent = 'Show the data so I can copy it';
    const go = doc.createElement('button'); go.type = 'button'; go.className = 'btn'; go.style.cssText = bstyle; go.textContent = 'I have the file: continue and replace it';
    const hint = doc.createElement('p'); hint.setAttribute('role', 'status'); hint.style.cssText = 'margin-top:8px;font-size:90%'; hint.textContent = 'The last button turns on after you download the data or show it to copy.';
    const box = doc.createElement('textarea'); box.readOnly = true; box.hidden = true; box.value = text; box.rows = 8; box.style.cssText = 'width:100%;margin-top:12px';
    box.setAttribute('aria-label', 'The old data, to copy by hand');
    // The way forward is only offered once the person has the old data in hand (downloaded or shown), so it cannot be replaced by a stray tap.
    go.disabled = true; go.setAttribute('aria-disabled', 'true');
    const unlock = () => { go.disabled = false; go.setAttribute('aria-disabled', 'false'); hint.textContent = 'Keep the file somewhere safe, then continue.'; };
    dl.addEventListener('click', () => {
      try {
        const url = g.URL.createObjectURL(new g.Blob([text], { type: 'application/json' }));
        const a = doc.createElement('a'); a.href = url; a.download = 'smokebox-damaged-data.json'; doc.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { g.URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 5000);
        unlock();
      } catch (e) { box.hidden = false; box.focus(); hint.textContent = 'The download did not work here. Copy the data from the box below, then continue.'; unlock(); }
    });
    show.addEventListener('click', () => { box.hidden = false; box.focus(); box.select(); unlock(); });
    // Everything behind this screen is made inert (no taps, no Tab), so no order can be entered while nothing is being saved.
    const behind = Array.from(doc.body.children).filter((el) => el.tagName !== 'SCRIPT');
    go.addEventListener('click', () => { if (go.disabled) return; try { SB.store.releaseHold(); } catch (e) { /* ignore */ } behind.forEach((el) => el.removeAttribute('inert')); wrap.remove(); });
    row.append(dl, show, go);
    card.append(h2, p, row, hint, box);
    wrap.appendChild(card);
    behind.forEach((el) => el.setAttribute('inert', ''));
    doc.body.appendChild(wrap);
    try { dl.focus(); } catch (e) { /* ignore */ }
  }

  // Watches for a device clock that jumped far ahead (or saved times far ahead of it) and asks the owner, once per episode, whether the new time is right.
  function watchClock() {
    let toldWrong = false;
    setInterval(() => {
      try {
        const s = SB.store.status();
        if (s.clockWrong && !toldWrong && SB.ui && SB.ui.toast) { toldWrong = true; SB.ui.toast("This device's clock looks wrong: some saved times are far ahead of it. Smokebox kept the device clock. Check the date and time in the device's settings.", { tone: 'warn', ms: 20000 }); }
        // The board's strip notice and the slim banner on back-office pages (60-shell.js) ask about a clock jump; no box covers the screen.
      } catch (e) { /* the watcher must never break the board */ }
    }, 5000);
  }

  // Tells the person, once at start-up, when the saved board was unreadable, was repaired, or cannot be saved in this
  // browser (private windows block storage). Silent when everything is fine.
  function storageNotices() {
    const s = SB.store && typeof SB.store.status === 'function' ? SB.store.status() : null;
    if (!s || !SB.ui || typeof SB.ui.toast !== 'function') return;
    if (s.heldInMemory && SB.store.damagedText && SB.store.damagedText()) { showHeldData(SB.store.damagedText()); return; }
    if (s.corrupt && s.restoredFromCopy) SB.ui.toast('Your saved board could not be read, so Smokebox restored the last good copy from ' + new Date(s.restoredFromCopy).toLocaleString() + '. Orders and history after that time are missing. A copy of the damaged data was kept in this browser.', { tone: 'warn', ms: 20000 });
    else if (s.corrupt) SB.ui.toast('Your saved board could not be read, so Smokebox started with an empty board. A copy of the old data was kept on this device.', { tone: 'warn', ms: 15000 });
    else if (s.droppedCount) {
      const d = s.droppedCount, bits = [];
      if (d.orders) bits.push(d.orders + (d.orders === 1 ? ' order' : ' orders'));
      if (d.tickets) bits.push(d.tickets + (d.tickets === 1 ? ' ticket' : ' tickets'));
      if (d.batches) bits.push(d.batches + (d.batches === 1 ? ' batch' : ' batches'));
      if (d.other) bits.push(d.other + (d.other === 1 ? ' other saved item' : ' other saved items'));
      SB.ui.toast('Smokebox could not read some saved records and left out ' + bits.join(', ') + ' while opening. The data as it was has been kept on this device. Ask whoever set up Smokebox to look at it before you close the page for good.', { tone: 'warn', ms: 20000 });
    }
    else if (s.repaired && s.repaired.length) SB.ui.toast('Smokebox updated a few saved settings while opening. Nothing else changed.', { tone: 'info', ms: 10000 });
    if (s.persistent === false) SB.ui.toast('This browser is not letting Smokebox save. Your board lasts only until you close the page. Open Back office, Menu, prices and shop, then Data, to save a backup file.', { tone: 'warn', ms: 15000 });
  }

  // A real kitchen that still holds tickets made by an old in-place demo gets them removed at once: they are fake by
  // definition, and a board full of day-old demo tickets is the first thing a returning owner would otherwise see.
  // An owner who already chose "keep" is left alone. Real tickets and the orders that hold them are never touched.
  function clearOldDemo() {
    const S = SB.store;
    if (!S || !S.isolated || !S.isolated() || S.isDemo() || typeof S.demoLeftovers !== 'function') return;
    const c = S.demoLeftovers();
    if (!c.offer) return;
    const r = S.clearDemoLeftovers();
    if (r.ok && SB.ui && SB.ui.toast) SB.ui.toast('Removed ' + r.info.tickets + ' old demo ' + (r.info.tickets === 1 ? 'ticket' : 'tickets') + ' left from an earlier version. Your own data was not touched.', { tone: 'ok', ms: 8000 });
  }

  // The demo is a show, not homework: it opens on a fresh busy board and runs by itself (orders arrive, the crew
  // starts and finishes dishes, food in the cabinet ages toward its warnings). A demo left from an earlier visit, with
  // tickets hours old, starts over fresh instead of opening on a wall of overdue tickets.
  function playDemo() {
    const S = SB.store, sim = SB.sim;
    if (!S || !S.isDemo || !S.isDemo() || !sim || !sim.live) return;
    const now = S.now(), active = S.getState().tickets.filter((t) => t.status === 'active');
    const stale = active.some((t) => now - t.createdAt > 2 * 3600e3);
    if (stale && typeof sim.restartDemo === 'function') sim.restartDemo();
    sim.live.crew(true);
    sim.live.start({ rate: 'normal' });
  }

  // Runs the start-up steps in order and remembers which step it is on, so a failure can say where it
  // stopped. A missing shell is an error. Files that failed to load only raise a warning toast, because the
  // rest of the app still works.
  function boot() {
    let stage = 'start';
    try {
      stage = 'store';
      // Signed in to the hosted server: the kitchen lives there, and this device follows it through the cloud transport (never in the demo).
      const cloud = SB.cloud && SB.cloud.on && SB.util.mode() !== 'demo';
      if (cloud) SB.cloud.guardKitchen();
      if (SB.store && typeof SB.store.init === 'function') SB.store.init(Object.assign({ blank: true, mode: SB.util.mode() }, cloud ? { transport: SB.cloud.transport } : {})); // a brand-new install starts empty; saved data is never changed
      // The demo (its own saved data) opens with its sample tickets the first time.
      // A brand-new empty kitchen gets neutral station and menu-section names (saved with it); old kitchens and the demo keep theirs.
      if (SB.store && SB.store.isBlank && SB.store.isBlank() && SB.store.applyStarterNames) SB.store.applyStarterNames();
      // Kitchens set up before Oct 24 2026 were made with the timing coach off (there was no switch for it), so every dish was called
      // at once. Once per kitchen: switch it on, and stop extra portions adding time. The demo keeps its own settings.
      try {
        const S = SB.store, P = S.getState().settings.pacing;
        if (!S.isDemo() && !SB.util.storage.get('smokebox.v1.pacingFix1', false)) {
          if (P && (P.enabled !== true || P.qtyFactor !== 0)) S.dispatchEx('updateSettings', { patch: { pacing: { enabled: true, qtyFactor: 0 } } }, { source: 'system' });
          SB.util.storage.set('smokebox.v1.pacingFix1', true);
        }
      } catch (e) { console.error('[smokebox] timing switch-on failed', e); }
      if (SB.store && SB.store.isDemo && SB.store.isDemo() && SB.store.status().firstRun && SB.sim && SB.sim.seedFirstRun) SB.sim.seedFirstRun();
      // A first run is a real, empty kitchen: the demo tickets and batches only load when the user asks for the demo.
      stage = 'shell';
      if (!SB.shell || typeof SB.shell.mount !== 'function') throw new Error('The shell module (60-shell.js) is not available.');
      SB.shell.mount(doc.getElementById('app') || doc.body);
      // A small hook so tests and developers can read the state from the console.
      if (SB.store && typeof SB.store.getState === 'function') SB.dev = { state: () => SB.store.getState() };
      SB.booted = true;
    } catch (e) { showBootError(e, stage); return; }
    // The app is running from here on: a failure in these extras is logged, never shown as "could not start" over a working board.
    try { storageNotices(); } catch (e) { console.error('[smokebox] start-up notices failed', e); }
    try { watchClock(); } catch (e) { console.error('[smokebox] clock watcher failed', e); }
    try { clearOldDemo(); } catch (e) { console.error('[smokebox] old demo clean-up failed', e); }
    try { playDemo(); } catch (e) { console.error('[smokebox] demo start failed', e); }
    try {
      const errs = loadErrors();
      if (errs.length && SB.ui && SB.ui.toast) SB.ui.toast('Some parts did not load (' + errs.map((e) => e.file).join(', ') + '). The rest still works. Reload the page to try again.', { tone: 'warn', ms: 12000 });
    } catch (e) { console.error('[smokebox] load warning failed', e); }
  }

  // Exposed so tests can run the start-up again or show the error card on purpose.
  SB.boot = { run: boot, showError: showBootError, details: detailsText };
  // Start when the page has finished loading; if it already has, start at once.
  // The Rust kitchen planner starts first (a browser compiles it in the background, in well under a second), so the kitchen
  // never opens planning without it. If it cannot start, the app still opens and plans the old way.
  // Starts the planner, then the app, once the page has loaded.
  const go = () => { const p = SB.planner && SB.planner.start ? SB.planner.start() : Promise.resolve(false); p.then(boot, boot); };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
})(typeof globalThis !== 'undefined' ? globalThis : window);
