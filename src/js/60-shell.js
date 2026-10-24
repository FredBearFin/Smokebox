/*
 * WHAT THIS FILE IS: The frame around the app: Day/Night themes, the address-bar router, pop-up sheets,
 *   toasts with the 10-second undo, menus, small controls, the secret five-taps-on-the-flame door to the
 *   back office (ember animation), and the manager PIN keypad.
 * PARTS: router parsing, SHA-256, themes, router history, helpers, sheets, toasts, menu, tooltip,
 *   controls, global keys, shell (PIN, taps, ignition, mount).
 * USES / USED BY: uses 00-util.js and 05-icons.js; called by 70-84 (floor, office) and 99-boot.js.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const doc = g.document || null;

  /* ====================================================================================================================
   * Router: pure parsing (works in Node)
   * ================================================================================================================== */
  // Five stations and seven office pages; any other name in an address falls back to the floor or Pace.
  const ZONES = ['pit', 'sides', 'fry', 'cold', 'expo'];
  const SECTIONS = ['pace', 'tickets', 'stations', 'money', 'safety', 'stock', 'data'];

  // Device roles: all = today's all-in-one screen; kitchen, front (order entry) and manager are focused ones.
  const ROLES = ['all', 'kitchen', 'front', 'manager'];

  // A Guide page name from an address: lower-case letters, digits and dashes only, or '' for the first page.
  const guidePage = (x) => (typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x) ? x : '');

  // Turns the part of the web address after the # (the hash, like #/office/money) into a view:
  // {kind:'floor', zone}, {kind:'kitchen', zone}, {kind:'new'}, {kind:'guide', page} or {kind:'office', section}. Never fails:
  // garbage lands on the whole floor.
  function viewFor(hash) {
    // Cap the length, then undo %20-style codes; a broken code keeps the raw text.
    let s = typeof hash === 'string' ? hash.slice(0, 300) : '';
    try { s = decodeURIComponent(s); } catch (e) { /* keep raw */ }
    s = s.replace(/^\s*#!?/, '').split(/[?#]/)[0];
    const parts = s.toLowerCase().split('/').map((x) => x.trim()).filter(Boolean);
    if (parts[0] === 'office') return { kind: 'office', section: SECTIONS.indexOf(parts[1]) >= 0 ? parts[1] : 'pace' };
    if (parts[0] === 'kitchen') return { kind: 'kitchen', zone: ZONES.indexOf(parts[1]) >= 0 ? parts[1] : 'all' };
    if (parts[0] === 'new') return { kind: 'new' };
    if (parts[0] === 'guide') return { kind: 'guide', page: guidePage(parts[1]) };
    if (parts[0] === 's' && ZONES.indexOf(parts[1]) >= 0) return { kind: 'floor', zone: parts[1] };
    return { kind: 'floor', zone: 'all' };
  }
  // Cleans a view (object or hash text) down to known stations and pages; junk gives the whole floor.
  function normView(view) {
    if (typeof view === 'string') return viewFor(view);
    if (!view || typeof view !== 'object') return { kind: 'floor', zone: 'all' };
    if (view.kind === 'office') return { kind: 'office', section: SECTIONS.indexOf(view.section) >= 0 ? view.section : 'pace' };
    if (view.kind === 'new') return { kind: 'new' };
    if (view.kind === 'guide') return { kind: 'guide', page: guidePage(view.page) };
    if (view.kind === 'kitchen') return { kind: 'kitchen', zone: ZONES.indexOf(view.zone) >= 0 ? view.zone : 'all' };
    return { kind: 'floor', zone: ZONES.indexOf(view.zone) >= 0 ? view.zone : 'all' };
  }
  // Opposite of viewFor: a view becomes its address ('#/office/money', '#/kitchen', '#/new', '#/s/pit', '#/');
  // it round-trips.
  function hashFor(view) {
    const v = normView(view);
    if (v.kind === 'office') return v.section === 'pace' ? '#/office' : '#/office/' + v.section;
    if (v.kind === 'new') return '#/new';
    if (v.kind === 'guide') return v.page ? '#/guide/' + v.page : '#/guide';
    if (v.kind === 'kitchen') return v.zone === 'all' ? '#/kitchen' : '#/kitchen/' + v.zone;
    return v.zone === 'all' ? '#/' : '#/s/' + v.zone;
  }
  // Reads ?role=kitchen|front|manager|all from the address's query text; returns the role or null.
  function roleFor(search) {
    const m = /[?&]role=([a-z]+)/i.exec(typeof search === 'string' ? search.slice(0, 300) : '');
    const r = m ? m[1].toLowerCase() : '';
    return ROLES.indexOf(r) >= 0 ? r : null;
  }
  // The screen a device with this role opens on when the address names no screen; null means the usual floor.
  function startViewFor(role) {
    if (role === 'kitchen') return { kind: 'kitchen', zone: 'all' };
    if (role === 'front') return { kind: 'new' };
    if (role === 'manager') return { kind: 'office', section: 'pace' };
    return null;
  }
  // The role a view belongs to when someone opens it by address: kitchen and new pin the device; others do not.
  function roleOfView(v) { return v.kind === 'kitchen' ? 'kitchen' : v.kind === 'new' ? 'front' : null; }

  /* ====================================================================================================================
   * SHA-256 (pure JS). crypto.subtle is preferred; this is the fallback and produces identical digests.
   * ================================================================================================================== */
  // Starting numbers the SHA-256 recipe needs (64 and 8 of them), filled in on first use by initSha.
  let K256 = null, H256 = null;
  // Works out those numbers as the standard defines them: decimal parts of roots of the first primes.
  function initSha() {
    const primes = [];
    for (let n = 2; primes.length < 64; n++) {
      let ok = true;
      for (let i = 0; i < primes.length && primes[i] * primes[i] <= n; i++) if (n % primes[i] === 0) { ok = false; break; }
      if (ok) primes.push(n);
    }
    // Keeps only the digits after the decimal point and scales them up to a 32-bit whole number.
    const frac = (x) => Math.floor((x - Math.floor(x)) * 4294967296);
    K256 = primes.map((p) => frac(Math.cbrt(p)));
    H256 = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
  }
  // Scrambles text into 64 hex characters that cannot be reversed (sha256hex('abc') starts ba7816bf). Same
  // answer as the browser's crypto, which hashPin tries first; this copy is the fallback and what Node
  // tests use.
  function sha256hex(str) {
    if (!K256) initSha();
    // Text to bytes (UTF-8).
    const bytes = typeof TextEncoder !== 'undefined' ? Array.from(new TextEncoder().encode(String(str))) : Array.from(unescape(encodeURIComponent(String(str)))).map((c) => c.charCodeAt(0));
    const l = bytes.length;
    // Pack bytes 4 to a 32-bit number, add the end bit, pad to 64-byte blocks, put the bit length last.
    const words = [];
    for (let i = 0; i < l; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
    words[l >> 2] = (words[l >> 2] || 0) | (0x80 << (24 - (l % 4) * 8));
    const total = (((l + 8) >> 6) + 1) * 16;
    words[total - 1] = l * 8;
    const H = H256.slice();
    const w = new Array(64);
    // Spins a 32-bit number's bits right by n places; bits that fall off come round to the front.
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    // Per 64-byte block: stretch 16 numbers to 64, run 64 mixing rounds, fold into the running hash H.
    for (let j = 0; j < total; j += 16) {
      for (let t = 0; t < 64; t++) {
        if (t < 16) w[t] = words[j + t] | 0;
        else {
          const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
          const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
          w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
        }
      }
      let [a, b, c, d, e, f, gg, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & gg);
        const t1 = (h + S1 + ch + K256[t] + w[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = gg; gg = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + gg) | 0; H[7] = (H[7] + h) | 0;
    }
    // Write the 8 numbers as 8 hex digits each.
    return H.map((x) => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
  }

  /* ====================================================================================================================
   * Backup nudge: pure decision (works in Node)
   * ================================================================================================================== */
  // Decides whether to nudge for the daily backup. a = {service, lastBackupAt, snoozeUntil, now, hasData,
  // openWork, closedAt}. It is due from closing time (or from Close the day, closedAt, if that came first)
  // until 10 hours after, when no backup was made in the 2 hours before or since, nothing is snoozed and
  // service is really over: no ticket on the board and no order still open (openWork 0). An empty kitchen
  // (no tickets or batches) has nothing to lose.
  // WATCH OUT: closeHour above 24 means after midnight, so last night's close is still checked at 12:30 am.
  function backupDue(a) {
    const H = 3600000, sv = a && a.service;
    if (!a || !sv || typeof sv.closeHour !== 'number' || !a.hasData) return false;
    if (typeof a.openWork === 'number' && a.openWork > 0) return false;
    if (typeof a.snoozeUntil === 'number' && a.snoozeUntil > a.now) return false;
    let closeAt = null;
    for (const day of [0, -1]) {
      const d = new Date(a.now); d.setDate(d.getDate() + day); d.setHours(0, 0, 0, 0);
      const at = d.getTime() + sv.closeHour * H;
      if (at <= a.now && (closeAt == null || at > closeAt)) closeAt = at;
    }
    if (typeof a.closedAt === 'number' && a.closedAt <= a.now && (closeAt == null || a.closedAt > closeAt)) closeAt = a.closedAt;
    if (closeAt == null || a.now - closeAt > 10 * H) return false;
    return !(typeof a.lastBackupAt === 'number' && a.lastBackupAt >= closeAt - 2 * H);
  }

  /* ====================================================================================================================
   * Theme
   * ================================================================================================================== */
  const T = (SB.theme = {});
  // Notebook (local storage) entry names for this file's saved choices.
  const KEY = { theme: 'smokebox.v1.theme', otheme: 'smokebox.v1.otheme', text: 'smokebox.v1.textsize', density: 'smokebox.v1.density', hints: 'smokebox.v1.hints', zone: 'smokebox.v1.zone', role: 'smokebox.v1.role', pinlock: 'smokebox.v1.pinlock', lastBackup: 'smokebox.v1.lastbackup' };
  // Colour of the browser's top bar for each look; each matches that look's background colour.
  const THEME_COLOR = { day: '#F5F2EB', night: '#15181A', ember: '#181513', paper: '#F0ECE3' };
  // Current choices: look (Day or Night, shared by the board and the back office), text size. themeSubs = listeners.
  const cur = { theme: 'day', text: 'normal', density: 'compact', hints: true }; // compact tickets by default: full-size ones were too big for a busy board
  const themeSubs = [];
  // Reads the saved look and text size from the notebook; only known values are accepted.
  function loadTheme() {
    if (!U || !U.storage) return;
    const t = U.storage.get(KEY.theme, null), x = U.storage.get(KEY.text, null);
    if (t === 'day' || t === 'night') cur.theme = t;
    if (x === 'normal' || x === 'large') cur.text = x;
    const d = U.storage.get(KEY.density, null);
    if (d === 'auto' || d === 'large' || d === 'compact') cur.density = d;
    const hs = U.storage.get(KEY.hints, null);
    if (hs === true || hs === false) cur.hints = hs;
  }
  // Tells T.onChange listeners what changed ('theme', 'office' or 'text'); one that throws is only logged.
  function emitTheme(what) { themeSubs.slice().forEach((fn) => { try { fn(what, Object.assign({}, cur)); } catch (e) { console.error('[smokebox] theme listener failed', e); } }); }
  // Sets the browser top-bar colour: office colour while the office is open, floor colour otherwise.
  function updateThemeColor() {
    if (!doc) return;
    let meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = doc.createElement('meta'); meta.setAttribute('name', 'theme-color'); doc.head.appendChild(meta); }
    const inOff = !!(S && S.inOffice && S.inOffice());
    meta.setAttribute('content', inOff ? THEME_COLOR[T.office()] : THEME_COLOR[cur.theme]);
  }
  // Puts the choices on the page: Day/Night on the top element, large-text class, office look, top bar.
  function applyTheme() {
    if (!doc) return;
    const r = doc.documentElement;
    r.setAttribute('data-theme', cur.theme);
    r.classList.toggle('text-large', cur.text === 'large');
    doc.querySelectorAll('.office[data-otheme]').forEach((el) => el.setAttribute('data-otheme', T.office()));
    updateThemeColor();
  }
  // Loads the saved choices and applies them. Returns a copy of the choices.
  T.init = function () { loadTheme(); applyTheme(); return Object.assign({}, cur); };
  // The current floor look, 'day' or 'night'.
  T.get = () => cur.theme;
  // Switches the floor to 'day' or 'night': saves, applies, tells listeners. Other values are ignored.
  T.set = function (t) {
    if (t !== 'day' && t !== 'night') return cur.theme;
    cur.theme = t; if (U) U.storage.set(KEY.theme, t); applyTheme();
    try { if (SB.charts && typeof SB.charts.refreshTheme === 'function') SB.charts.refreshTheme(); } catch (e) { console.error('[smokebox] charts.refreshTheme failed', e); }
    emitTheme('theme'); emitTheme('office'); return t;
  };
  // Flips Day to Night, or Night to Day.
  T.toggle = () => T.set(cur.theme === 'day' ? 'night' : 'day');
  // The back office follows the same Day/Night choice: its light look ('paper') for Day, dark ('ember') for Night.
  T.office = () => (cur.theme === 'night' ? 'ember' : 'paper');
  // Sets the shared look from an office look name ('paper' is Day, 'ember' is Night); charts are redrawn by T.set.
  T.setOffice = function (o) {
    if (o !== 'ember' && o !== 'paper') return T.office();
    T.set(o === 'ember' ? 'night' : 'day'); return T.office();
  };
  // The current text size, 'normal' or 'large'.
  T.textSize = () => cur.text;
  // Sets the text size ('normal' or 'large'), saves it and applies it. Anything else is ignored.
  T.setTextSize = function (x) {
    if (x !== 'normal' && x !== 'large') return cur.text;
    cur.text = x; if (U) U.storage.set(KEY.text, x); applyTheme(); emitTheme('text'); return x;
  };
  // How big tickets are drawn: 'auto' (compact once they would not fit in one row), 'large' or 'compact'.
  T.density = () => cur.density;
  // Sets the ticket size ('auto', 'large' or 'compact'), saves it and tells listeners. Anything else is ignored.
  T.setDensity = function (d) {
    if (d !== 'auto' && d !== 'large' && d !== 'compact') return cur.density;
    cur.density = d; if (U) U.storage.set(KEY.density, d); emitTheme('density'); return d;
  };
  // Whether each ticket shows its "do this next" line. On unless someone turns it off.
  T.hints = () => cur.hints;
  // Turns the "do this next" line on or off, saves it and tells listeners.
  T.setHints = function (on) { cur.hints = !!on; if (U) U.storage.set(KEY.hints, cur.hints); emitTheme('hints'); return cur.hints; };
  // Sign up for changes: fn(what, choices), what = 'theme', 'office', 'text', 'density' or 'hints'. Returns a cancel function.
  T.onChange = function (fn) { themeSubs.push(fn); return () => { const i = themeSubs.indexOf(fn); if (i >= 0) themeSubs.splice(i, 1); }; };

  /* ====================================================================================================================
   * Router: history-aware part
   * ================================================================================================================== */
  const R = (SB.router = {});
  R.viewFor = viewFor; R.hashFor = hashFor; R.zones = ZONES.slice(); R.sections = SECTIONS.slice();
  R.roleFor = roleFor; R.startViewFor = startViewFor; R.roles = ROLES.slice();
  // Router state. idx counts our history entries (stamped into each as sbIdx); pendingBacks = Back jumps
  // the browser has not reported yet; officePushed / officeEntry = the office's own history entry;
  // overlayStack = open sheets, one entry each; queued = history writes waiting; lastZone = the way back
  // out of the office.
  let current = { kind: 'floor', zone: 'all' };
  let lastZone = 'all';
  let role = 'all'; // this device's job: all, kitchen, front or manager (kept in the notebook)
  let idx = 0, routerReady = false, pendingBacks = 0, flushTimer = 0, officePushed = false, officeEntry = null;
  const listeners = [], overlayStack = [], queued = [];

  // True once the order page was opened from the board's Front counter button in this session: going back and forth
  // to #/new after that is a visit, and never pins the tablet to order entry.
  // The flag also lives in this browser tab's session storage, so reloading the order page during a visit does not pin.
  const VISIT_KEY = 'smokebox.v1.countervisit';
  let counterVisit = (() => { try { return g.sessionStorage.getItem(VISIT_KEY) === '1'; } catch (e) { return false; } })();
  // Remembers the last station viewed (memory and notebook) so a pinned tablet reopens on it.
  // Also pins the device role when a role screen (#/kitchen, #/new) is opened, unless it is a Front counter visit.
  const rememberZone = (v) => {
    if (v.kind === 'floor') { lastZone = v.zone; if (U) U.storage.set(KEY.zone, v.zone); }
    const r = roleOfView(v);
    if (r === 'front' && counterVisit) return;
    if (r && r !== role) { role = r; if (U) U.storage.set(KEY.role, r); }
  };
  // Our history number from the current history entry, or null if it has none. Never throws.
  const readIdx = () => { try { const s = g.history && g.history.state; return s && typeof s.sbIdx === 'number' ? s.sbIdx : null; } catch (e) { return null; } };
  // Tells router listeners the new view (a copy) and info.source: 'go' (our move) or 'pop' (Back, typed).
  function emit(v, info) { listeners.slice().forEach((fn) => { try { fn(Object.assign({}, v), info || {}); } catch (e) { console.error('[smokebox] router listener failed', e); } }); }
  // Writes wait while a Back jump is in flight, so a new entry cannot land on the wrong spot.
  function schedule(fn) { if (pendingBacks > 0) queued.push(fn); else fn(); }
  // Safety net: if the browser does not report the Back jump in 600 ms, run the queued writes anyway.
  function armFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(() => { pendingBacks = 0; flush(); }, 600); }
  // Runs the waiting history writes in order, unless a Back jump is still in flight.
  function flush() {
    if (pendingBacks > 0) return;
    clearTimeout(flushTimer);
    queued.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* history API refused: the view state is still right */ } });
  }
  // Reads the address bar; if it names another screen, switches to it and tells listeners (source 'pop').
  function applyHash() {
    const v = viewFor(g.location ? g.location.hash : '');
    if (hashFor(v) !== hashFor(current)) { current = v; rememberZone(v); emit(v, { source: 'pop' }); }
  }
  // The browser rings this on Back/Forward or a typed address. Keeps our history count right, closes sheets
  // whose entry was left, then follows the address.
  // WATCH OUT: a view change already queued behind this jump (the PIN keypad closes, then the office opens)
  //   wins over what the address still says.
  function onPop(e) {
    if (pendingBacks > 0) pendingBacks--;
    const st = e && e.state;
    const n = st && typeof st.sbIdx === 'number' ? st.sbIdx : null;
    if (n === null) { // a hash typed by hand or followed from a link: the browser added a fresh entry
      idx += 1;
      try { g.history.replaceState({ sbIdx: idx }, '', g.location.href); } catch (err) { /* ignore */ }
      if (viewFor(g.location.hash).kind === 'office' && current.kind !== 'office') { officePushed = true; officeEntry = idx; }
      applyHash(); flush(); return;
    }
    idx = n;
    // Close every sheet whose history entry is newer than the one we landed on.
    while (overlayStack.length && overlayStack[overlayStack.length - 1].idx != null && overlayStack[overlayStack.length - 1].idx > n) {
      const t = overlayStack.pop();
      try { if (t.onPop) t.onPop(); } catch (err) { console.error('[smokebox] overlay close failed', err); }
    }
    // a view change that was queued behind this traversal (the PIN keypad closes, then the office opens) wins over what the URL still says
    if (!queued.length) applyHash();
    flush();
  }
  // Starts the router once: numbers the first entry, restores the last station, listens for Back/Forward.
  R.init = function () {
    if (routerReady || !g.location) return R.view();
    routerReady = true;
    const found = readIdx();
    idx = found == null ? 0 : found;
    if (found == null) { try { g.history.replaceState({ sbIdx: 0 }, '', g.location.href); } catch (e) { /* ignore */ } }
    const stored = U ? U.storage.get(KEY.zone, 'all') : 'all';
    lastZone = ZONES.indexOf(stored) >= 0 ? stored : 'all';
    const storedRole = U ? U.storage.get(KEY.role, 'all') : 'all';
    role = ROLES.indexOf(storedRole) >= 0 ? storedRole : 'all';
    const asked = roleFor(g.location.search); // ?role=kitchen on the address picks this device's job
    if (asked) { role = asked; if (U) U.storage.set(KEY.role, asked); }
    let v = viewFor(g.location.hash);
    const start = startViewFor(role);
    // A role device opens on its own screen. An address that names the office (?role=kitchen#/office) still opens the
    // office (behind its PIN) instead of silently showing the role screen.
    if (start && (!g.location.hash || (asked && v.kind !== 'office'))) {
      v = start;
      try { g.history.replaceState({ sbIdx: idx }, '', hashFor(v)); } catch (e) { /* ignore */ }
    } else if (!g.location.hash && lastZone !== 'all') { // a tablet pinned to a station opens on it
      v = { kind: 'floor', zone: lastZone };
      try { g.history.replaceState({ sbIdx: idx }, '', hashFor(v)); } catch (e) { /* ignore */ }
    }
    current = v; rememberZone(v);
    g.addEventListener('popstate', onPop);
    return R.view();
  };
  // Stops listening and forgets all router state.
  R.destroy = function () { if (g.removeEventListener) g.removeEventListener('popstate', onPop); routerReady = false; listeners.length = 0; overlayStack.length = 0; queued.length = 0; pendingBacks = 0; clearTimeout(flushTimer); };
  // A copy of the current view.
  R.view = () => Object.assign({}, current);
  // The last station viewed ('all' if none).
  R.lastZone = () => lastZone;
  // This device's role: 'all' (everything on one screen), 'kitchen', 'front' or 'manager'.
  R.role = () => role;
  // Sets and remembers the device role ('all' clears it); unknown names are ignored. Returns the role.
  R.setRole = function (r) {
    if (ROLES.indexOf(r) < 0) return role;
    role = r; if (U) U.storage.set(KEY.role, r);
    return role;
  };
  // The screen this device returns to after the office: its role screen, or the last station.
  R.home = function () {
    const s = role === 'manager' ? null : startViewFor(role);
    return s || { kind: 'floor', zone: lastZone };
  };
  // Sign up to hear about every view change: fn(view, info). Returns a function that cancels the sign-up.
  R.onChange = function (fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  R.hashFor = hashFor; R.viewFor = viewFor;
  // Moves to a view (object or hash text). The same view again does nothing, so history never grows by
  // repeating yourself. {replace:true} rewrites the current entry instead of adding one. {visit:true} opens the
  // order page without pinning the device role to it (the board's Front counter button).
  // WATCH OUT: listeners hear at once, but the history write may wait behind a Back jump.
  R.go = function (view, o) {
    if (!routerReady) R.init();
    if (o && o.visit) { counterVisit = true; try { g.sessionStorage.setItem(VISIT_KEY, '1'); } catch (e) { /* this tab only */ } }
    const v = normView(view), hsh = hashFor(v), replace = !!(o && o.replace);
    if (hsh === hashFor(current)) return R.view();
    const prev = current;
    current = v; rememberZone(v);
    // Remember if the office gets its own history entry, so leaving can step back instead of piling up.
    const enteringOffice = v.kind === 'office' && prev.kind !== 'office';
    if (enteringOffice) officePushed = !replace;
    // The history write: replace this entry or add one numbered idx + 1; set the address text if refused.
    schedule(() => {
      try {
        if (replace) g.history.replaceState({ sbIdx: idx }, '', hsh);
        else { idx += 1; g.history.pushState({ sbIdx: idx }, '', hsh); if (enteringOffice) officeEntry = idx; }
      } catch (e) { try { g.location.hash = hsh; } catch (err) { /* ignore */ } }
    });
    emit(v, { source: 'go' });
    return R.view();
  };
  // Leaves the office the way the user came in: jump back past the entry we added (and any sheets on top)
  // or, for a pasted link, rewrite the entry to the floor. False if not in the office.
  R.leaveOffice = function () {
    if (current.kind !== 'office') return false;
    const target = R.home();
    if (officePushed && officeEntry != null && officeEntry > 0) {
      // Steps back to the entry just before the office.
      const delta = idx - (officeEntry - 1);
      current = target; officePushed = false;
      if (delta > 0) {
        idx -= delta; pendingBacks += 1; armFlush();
        try { g.history.go(-delta); } catch (e) { pendingBacks = Math.max(0, pendingBacks - 1); }
      }
      return true;
    }
    R.go(target, { replace: true });
    return true;
  };
  // Open sheets each own one history entry: Back closes the top one, its own button steps back (F21).
  R.overlay = {
    // Registers an open sheet; onPop runs when Back leaves its entry. Returns a token for release.
    push(onPop) {
      if (!routerReady) R.init();
      const token = { onPop, idx: null };
      overlayStack.push(token);
      schedule(() => {
        if (overlayStack.indexOf(token) < 0) return;
        idx += 1; token.idx = idx;
        try { g.history.pushState({ sbIdx: idx, ov: 1 }, '', g.location.href); } catch (e) { /* ignore */ }
      });
      return token;
    },
    // Gives back a sheet's history entry if it is still the newest; otherwise leaves it alone.
    release(token) {
      const i = overlayStack.indexOf(token);
      if (i < 0) return;
      overlayStack.splice(i, 1);
      if (token.idx == null) return;
      if (token.idx === idx) {
        idx -= 1; pendingBacks += 1; armFlush();
        try { g.history.back(); } catch (e) { pendingBacks = Math.max(0, pendingBacks - 1); }
      }
    },
    // How many sheets currently hold a history entry.
    depth: () => overlayStack.length,
  };
  // Our current history number (used by status and tests).
  R.index = () => idx;

  // In Node (tests with no page) stop here: only the router parsing and SHA-256 above are usable there.
  if (!doc) { // Node: pure parts only
    SB.shell = { sha256: sha256hex, backupDue };
    return;
  }

  /* ====================================================================================================================
   * DOM helpers
   * ================================================================================================================== */
  // h builds a page element; S = SB.shell, ui = SB.ui; layers = floor/office; hosts = sheet/toast/message
  // boxes.
  const h = U.h;
  const S = (SB.shell = {});
  const ui = (SB.ui = {});
  const layers = { floor: null, office: null, order: null, guide: null };
  const hosts = { shell: null, sheets: null, toasts: null, live: null, standalone: null };
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  // True when the device asks for less motion; animations are then skipped or shortened.
  const reduced = () => (U.prefersReducedMotion ? U.prefersReducedMotion() : false);

  // Makes an icon by name (default 20 px); an empty placeholder if the icon library is missing.
  function ico(name, size, o) {
    try { if (SB.icons && SB.icons.svg) return SB.icons.svg(name, Object.assign({ size: size || 20 }, o || {})); } catch (e) { /* fall through */ }
    return doc.createElement('span');
  }
  // True if the element takes up room on screen.
  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  // Things inside root that Tab can land on now: visible, not inert, not hidden from screen readers.
  function focusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => visible(el) && !el.closest('[inert]') && el.getAttribute('aria-hidden') !== 'true');
  }
  // Turns part of the page off or on for clicks, Tab and screen readers (blocks what sits behind a pop-up).
  function setInert(el, on) {
    if (!el) return;
    if (on) { el.setAttribute('inert', ''); try { el.inert = true; } catch (e) { /* ignore */ } } else { el.removeAttribute('inert'); try { el.inert = false; } catch (e) { /* ignore */ } }
  }
  // Makes sure the sheet, toast and message containers exist (temporary ones before mount or in tests).
  function ensureHosts() {
    if (hosts.sheets && hosts.sheets.isConnected) return;
    // used before mount (boot error card) or when a test skips mount: a standalone set of hosts on <body>
    const wrap = h('div', { class: 'sb-hosts' });
    hosts.sheets = h('div', { class: 'sheet-host' });
    hosts.toasts = h('div', { class: 'toast-host', role: 'region', 'aria-label': 'Notifications' });
    hosts.live = h('div', { class: 'live-region', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    wrap.append(hosts.sheets, hosts.toasts, hosts.live);
    doc.body.appendChild(wrap);
    hosts.standalone = wrap;
  }
  // True while the back office is open.
  const inOfficeNow = () => !!(S.inOffice && S.inOffice());
  // Last thing pressed, so a closing sheet can hand focus (the keyboard's place) back to it.
  let lastTrigger = null;
  doc.addEventListener('pointerdown', (e) => { lastTrigger = e.target; }, true);
  doc.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') lastTrigger = e.target; }, true);
  // What gets focus back on close: the given element, else the focused one, else the last pressed; or null.
  const pickOpener = (given) => {
    if (given && given.isConnected) return given;
    const a = doc.activeElement;
    if (a && a !== doc.body && a !== doc.documentElement) return a;
    if (lastTrigger && lastTrigger.isConnected) return lastTrigger.closest('button,a,[tabindex],input,select,textarea,summary') || lastTrigger;
    return null;
  };

  /* ====================================================================================================================
   * announce
   * ================================================================================================================== */

  // Speaks a message to screen readers unseen (cleared, then set 30 ms later: they only speak on a change).
  ui.announce = function (text) {
    ensureHosts();
    const live = hosts.live;
    live.textContent = '';
    setTimeout(() => { live.textContent = String(text == null ? '' : text); }, 30);
  };

  // Copies text to the clipboard; the promise answers true if it worked. Modern clipboard first.
  ui.copyText = function (text) {
    // Old-style copy: a hidden off-screen box, select it, run the browser's copy command.
    const fallback = () => {
      try {
        const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0;opacity:0' });
        ta.value = text; doc.body.appendChild(ta); ta.select();
        const ok = doc.execCommand && doc.execCommand('copy'); ta.remove(); return Promise.resolve(!!ok);
      } catch (e) { return Promise.resolve(false); }
    };
    try {
      if (g.navigator && g.navigator.clipboard && g.navigator.clipboard.writeText) return g.navigator.clipboard.writeText(text).then(() => true, fallback);
    } catch (e) { /* fall through */ }
    return fallback();
  };

  /* ====================================================================================================================
   * Sheets
   * ================================================================================================================== */
  // Open sheets, oldest first (last = top). openingName passes the name from sheets.open to the new sheet.
  const sheetStack = [];
  let openingName = null;
  // Blocks what must not be clickable: floor/office layers by what is showing, and all sheets but the top.
  function syncInert() {
    const anySheet = sheetStack.length > 0;
    setInert(layers.floor, anySheet || inOfficeNow());
    setInert(layers.office, anySheet || !inOfficeNow());
    setInert(layers.guide, anySheet);
    sheetStack.forEach((r, i) => setInert(r.root, i < sheetStack.length - 1));
  }
  S._syncInert = syncInert;

  // Opens a pop-up panel and returns its handle {el, body, header, footer, close(reason), isOpen(),
  // setTitle(t), focus(x)}. opts: title, side ('right', 'center', 'full'), width, name, initialFocus,
  // onClose(reason); closeOnBackdrop, closeOnEsc and restoreFocus set to false turn those off.
  // WATCH OUT: Tab is trapped inside, the panel owns one history entry, and the layers behind it go inert.
  ui.sheet = function (opts) {
    opts = opts || {};
    ensureHosts();
    // Build the pieces: backdrop, panel (heading, close button, body, footer), in office colours there.
    const side = ['right', 'center', 'full'].indexOf(opts.side) >= 0 ? opts.side : 'right';
    const uid = U.uid('sheet');
    const titleId = opts.labelledBy || uid + '-title';
    const officeCtx = inOfficeNow();
    const root = h('div', { class: 'sheet-root' + (officeCtx ? ' office' : ''), dataset: { side } });
    if (officeCtx) root.setAttribute('data-otheme', T.office());
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const panel = h('section', { class: 'sheet', role: opts.role === 'alertdialog' ? 'alertdialog' : 'dialog', 'aria-modal': 'true', tabindex: -1, id: uid });
    if (opts.width) panel.style.setProperty('--sheet-w', typeof opts.width === 'number' ? opts.width + 'px' : String(opts.width));
    const header = h('header', { class: 'sheet-head' });
    let titleEl = null;
    if (opts.labelledBy) panel.setAttribute('aria-labelledby', opts.labelledBy);
    else { titleEl = h('h2', { class: 'sheet-title', id: titleId }, opts.title || ''); header.appendChild(titleEl); panel.setAttribute('aria-labelledby', titleId); }
    const closeBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon sheet-close', 'aria-label': opts.closeLabel || 'Close' }, ico('x', 22));
    header.appendChild(closeBtn);
    const body = h('div', { class: 'sheet-body' });
    const footer = h('footer', { class: 'sheet-foot' });
    panel.append(header, body, footer);
    root.append(backdrop, panel);
    hosts.sheets.appendChild(root);

    // Record kept for this sheet in sheetStack.
    const rec = { id: uid, root, el: panel, name: opts.name || openingName || null, opener: pickOpener(opts.opener), closed: false, token: null, api: null, opts };
    // Focus trap: keeps Tab and Shift+Tab inside the panel; lost focus returns to the first control.
    const onTrap = (e) => {
      if (e.key !== 'Tab') return;
      const f = focusables(panel);
      if (!f.length) { e.preventDefault(); panel.focus(); return; }
      const first = f[0], last = f[f.length - 1], a = doc.activeElement;
      if (!panel.contains(a)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (a === first || a === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    // Clicking the dark area closes the sheet unless closeOnBackdrop is false.
    const onBackdrop = () => { if (opts.closeOnBackdrop !== false) close('backdrop'); };
    // The X button closes the sheet.
    const onCloseBtn = () => close('button');
    panel.addEventListener('keydown', onTrap);
    backdrop.addEventListener('click', onBackdrop);
    closeBtn.addEventListener('click', onCloseBtn);

    // Closes this sheet once: off the stack, history entry handed back (unless history closed it), exit
    // animation, focus back to the opener, then onClose(reason).
    // WHY: removed after 170 ms, just past the 140 ms exit animation in the CSS; at once for reduced
    // motion.
    function close(reason, fromPop) {
      if (rec.closed) return;
      rec.closed = true;
      const i = sheetStack.indexOf(rec); if (i >= 0) sheetStack.splice(i, 1);
      panel.removeEventListener('keydown', onTrap);
      backdrop.removeEventListener('click', onBackdrop);
      closeBtn.removeEventListener('click', onCloseBtn);
      if (rec.token && !fromPop) R.overlay.release(rec.token);
      setInert(root, true);
      root.classList.add('is-closing');
      if (reduced()) root.remove(); else setTimeout(() => root.remove(), 170);
      syncInert();
      const op = rec.opener;
      if (opts.restoreFocus !== false && op && op.isConnected && typeof op.focus === 'function' && !op.closest('[inert]')) { try { op.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      try { if (typeof opts.onClose === 'function') opts.onClose(reason || 'api'); } catch (e) { console.error('[smokebox] sheet onClose failed', e); }
    }
    // Take a history slot so Back closes this sheet, put it on the stack and block the layers behind.
    rec.close = close;
    rec.token = R.overlay.push(() => close('history', true));
    sheetStack.push(rec);
    syncInert();
    // The handle given to the caller.
    const api = {
      el: panel, root, body, header, footer, titleEl, name: rec.name,
      // Close from outside; the reason defaults to 'api'.
      close: (reason) => close(reason || 'api'),
      // True until the sheet has been closed.
      isOpen: () => !rec.closed,
      // Changes the heading text (only when the sheet built its own heading).
      setTitle: (t) => { if (titleEl) titleEl.textContent = t; },
      // Moves focus to an element, or to the first match of a selector inside the panel.
      focus: (target) => { const t = typeof target === 'string' ? panel.querySelector(target) : target; if (t && t.focus) t.focus({ preventScroll: true }); },
    };
    rec.api = api;
    // Once shown, focus goes inside: the caller's choice, else an autofocus control, else the panel.
    queueMicrotask(() => {
      if (rec.closed) return;
      if (panel.contains(doc.activeElement) && doc.activeElement !== panel) return;
      let t = opts.initialFocus;
      if (typeof t === 'function') t = t();
      if (typeof t === 'string') t = panel.querySelector(t);
      t = t || panel.querySelector('[autofocus],[data-autofocus]') || panel;
      try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    });
    return api;
  };

  // Asks a yes/no question in a small sheet. Returns a promise: true if confirmed, false for Cancel or any
  // other way of closing. o: title, body, confirmLabel, cancelLabel, tone.
  // WATCH OUT: with tone 'danger' focus starts on Cancel, so a stray Enter never confirms a delete.
  ui.confirm = function (o) {
    o = o || {};
    return new Promise((resolve) => {
      let done = false;
      // Answers once and closes the sheet; a second call does nothing.
      const finish = (v) => { if (done) return; done = true; sh.close(v ? 'confirm' : 'cancel'); resolve(v); };
      const danger = o.tone === 'danger';
      // Closing the sheet any other way (Esc, backdrop, Back) counts as no.
      const sh = ui.sheet({ title: o.title || 'Are you sure?', side: 'center', width: 440, role: 'alertdialog', name: 'confirm', onClose: () => { if (!done) { done = true; resolve(false); } } });
      const descId = sh.el.id + '-desc';
      const copy = h('div', { class: 'sheet-copy', id: descId });
      // The body can be one item or a list; plain text becomes a paragraph.
      const parts = Array.isArray(o.body) ? o.body : [o.body];
      parts.forEach((p) => { if (p == null) return; copy.appendChild(p.nodeType ? p : h('p', null, String(p))); });
      sh.body.appendChild(copy);
      sh.el.setAttribute('aria-describedby', descId);
      // The Cancel button answers no to the question.
      const cancel = h('button', { type: 'button', class: 'btn', onClick: () => finish(false) }, o.cancelLabel || 'Cancel');
      // The confirm button answers yes; the dangerous version shows a trash icon in red.
      const ok = h('button', { type: 'button', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onClick: () => finish(true) }, ico(danger ? 'trash' : 'check', 20), h('span', null, o.confirmLabel || 'Confirm'));
      sh.footer.append(cancel, ok);
      sh.focus(danger ? cancel : ok); // destructive actions start on the safe choice
    });
  };

  /* ---------- sheet registry ---------- */
  // Registry of named sheets: files register an opener by name; anyone can open it by name.
  const reg = {};
  const sheets = (SB.sheets = {});
  // Adds or replaces the opener function for a sheet name. Bad input is ignored.
  sheets.register = (name, fn) => { if (typeof name === 'string' && typeof fn === 'function') reg[name] = fn; };
  // True if a sheet with this name has been registered.
  sheets.has = (name) => typeof reg[name] === 'function';
  // List of all registered sheet names.
  sheets.names = () => Object.keys(reg);
  // True if a sheet with this name is open right now.
  sheets.isOpen = (name) => sheetStack.some((r) => r.name === name && !r.closed);
  // Handle of the topmost open sheet, or null if none.
  sheets.top = () => (sheetStack.length ? sheetStack[sheetStack.length - 1].api : null);
  // How many sheets are open right now.
  sheets.count = () => sheetStack.length;
  // Opens a registered sheet by name and returns its handle. Unknown name: a toast and null. Already open:
  // focused, not opened twice. An opener that throws is logged and toasted.
  sheets.open = function (name, opts) {
    const fn = reg[name];
    // When a file failed to load at start-up that is the likely cause, so the message says so and offers the fix.
    const failedLoad = Array.isArray(g.__sbLoadErrors) && g.__sbLoadErrors.length > 0;
    if (typeof fn !== 'function') { ui.toast(failedLoad ? 'That screen did not load. Reload the page to try again.' : 'That screen is not part of this build yet.', { tone: 'warn' }); return null; }
    const existing = sheetStack.find((r) => r.name === name && !r.closed);
    if (existing) { try { existing.el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } return existing.api; }
    openingName = name;
    try { return fn(opts || {}); }
    catch (e) { console.error('[smokebox] sheet "' + name + '" failed to open', e); ui.toast('Could not open that screen. Reload and try again.', { tone: 'bad' }); return null; }
    finally { openingName = null; }
  };
  // Closes any open menu and every open sheet, top first.
  sheets.closeAll = function () {
    closeMenu();
    sheetStack.slice().reverse().forEach((r) => r.close('closeAll'));
  };

  /* ====================================================================================================================
   * Toast with undo (draining bar), one undo toast at a time
   * ================================================================================================================== */
  // Toasts on screen, oldest first; toastRaf is the pending refresh request (0 = none), shared by all bars.
  const toasts = [];
  let toastRaf = 0;
  // Runs every screen refresh while a toast exists: shrinks each bar and dismisses at zero. Time spent
  // paused (pointer or keyboard on the toast) is not counted.
  function toastLoop(t) {
    toasts.slice().forEach((r) => {
      if (r.paused) { r.last = t; return; }
      r.elapsed += t - r.last; r.last = t;
      if (r.bar) r.bar.style.transform = 'scaleX(' + Math.max(0, 1 - r.elapsed / r.ms).toFixed(4) + ')';
      if (r.elapsed >= r.ms) r.dismiss();
    });
    toastRaf = toasts.length ? requestAnimationFrame(toastLoop) : 0;
  }
  // Adds a small "?" to a sheet's header that opens one Guide page (the sheet closes first). Adds nothing when the Guide is missing.
  ui.sheetHelp = function (sheet, page, label) {
    const a = SB.guide && typeof SB.guide.link === 'function' ? SB.guide.link(page, label) : null;
    if (!a || !sheet || !sheet.header) return;
    a.addEventListener('click', () => sheet.close('help'));
    sheet.header.insertBefore(a, sheet.header.lastChild);
  };
  // Shows a small message strip; returns {el, close()}. o.tone: ok, warn, bad, info. o.undo (a function)
  // adds an Undo button and keeps it for undoMs (10 000 ms = the 10 seconds you get to undo). Others stay 5
  // s, 6 s for warn, and an error (bad) stays until cleared (starter estimates, owner to confirm); o.ms overrides.
  // WATCH OUT: one undo toast at a time (the engine undoes only its newest action), and at most 3 toasts.
  ui.toast = function (message, o) {
    o = o || {};
    ensureHosts();
    // Settings: tone, optional undo function, and how long the toast stays.
    const tone = ['ok', 'warn', 'bad', 'info'].indexOf(o.tone) >= 0 ? o.tone : 'info';
    const undo = typeof o.undo === 'function' ? o.undo : null;
    const undoMs = (SB.config && Number(SB.config.undoMs)) || 10000;
    const ms = Number.isFinite(+o.ms) && +o.ms > 0 ? +o.ms : undo ? undoMs : tone === 'bad' ? 1e12 : tone === 'warn' ? 6000 : 5000; // errors stay until cleared
    if (undo) toasts.slice().forEach((t) => { if (t.undo) t.dismiss(true); }); // the engine only undoes its newest action
    while (toasts.length >= 3) toasts[0].dismiss(true);
    // Build the strip: icon, message, buttons and (for undo) the draining bar.
    const el = h('div', { class: 'toast' + (inOfficeNow() ? ' office' : ''), role: tone === 'bad' || tone === 'warn' ? 'alert' : 'status', dataset: { tone } });
    if (inOfficeNow()) el.setAttribute('data-otheme', T.office());
    const icon = h('span', { class: 'toast-icon' }, ico({ ok: 'check-circle', warn: 'alert', bad: 'alert-circle', info: 'info' }[tone], 22));
    const msg = h('div', { class: 'toast-msg' }, message == null ? '' : message);
    const actions = h('div', { class: 'toast-actions' });
    const rec = { el, undo: !!undo, ms, elapsed: 0, last: performance.now(), paused: false, bar: null, dismissed: false };
    const cleanups = [];
    // Removes the toast (150 ms leave animation unless reduced motion) and its listeners. Safe to call
    // twice.
    rec.dismiss = function (immediate) {
      if (rec.dismissed) return; rec.dismissed = true;
      const i = toasts.indexOf(rec); if (i >= 0) toasts.splice(i, 1);
      cleanups.splice(0).forEach((fn) => fn());
      if (immediate || reduced()) el.remove(); else { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 150); }
    };
    if (undo) {
      const b = h('button', { type: 'button', class: 'btn toast-undo' }, ico('undo', 18), h('span', null, 'Undo'));
      // Undo button: remove the toast first, then run the undo; a failure inside it is logged, not shown.
      const onUndo = () => { rec.dismiss(); try { undo(); } catch (e) { console.error('[smokebox] undo failed', e); } };
      b.addEventListener('click', onUndo); cleanups.push(() => b.removeEventListener('click', onUndo));
      actions.appendChild(b);
      rec.bar = h('div', { class: 'toast-bar', 'aria-hidden': 'true' });
    }
    const x = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Dismiss message' }, ico('x', 20));
    // The X button dismisses the toast.
    const onX = () => rec.dismiss(); x.addEventListener('click', onX); cleanups.push(() => x.removeEventListener('click', onX));
    actions.appendChild(x);
    el.append(icon, msg, actions);
    if (rec.bar) el.appendChild(rec.bar);
    // Pointer or keyboard on the toast pauses its countdown; leaving resumes it from where it was.
    const pause = () => { rec.paused = true; }, resume = () => { rec.paused = false; rec.last = performance.now(); };
    el.addEventListener('pointerenter', pause); el.addEventListener('pointerleave', resume);
    el.addEventListener('focusin', pause); el.addEventListener('focusout', resume);
    cleanups.push(() => { el.removeEventListener('pointerenter', pause); el.removeEventListener('pointerleave', resume); el.removeEventListener('focusin', pause); el.removeEventListener('focusout', resume); });
    hosts.toasts.appendChild(el);
    toasts.push(rec);
    if (!toastRaf) toastRaf = requestAnimationFrame(toastLoop);
    // Handle for the caller: the element and a way to close it.
    return { el, close: () => rec.dismiss() };
  };

  /* ====================================================================================================================
   * Menu
   * ================================================================================================================== */
  // The one open menu, or null: { anchor (the button that opened it), layer, cleanup }.
  let menuState = null;
  // Closes the open menu, if any. Focus returns to the button that opened it unless restore is false.
  function closeMenu(restore) {
    if (!menuState) return;
    const m = menuState; menuState = null;
    m.cleanup();
    m.layer.remove();
    try { m.anchor.setAttribute('aria-expanded', 'false'); } catch (e) { /* ignore */ }
    if (restore !== false && m.anchor.isConnected && typeof m.anchor.focus === 'function' && !m.anchor.closest('[inert]')) { try { m.anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  // Opens a dropdown under a button (above if there is no room); returns {el, close()}, or null when this
  // was the second tap that closes it. items: {label, icon, onClick, checked, danger, disabled},
  // {separator:true} or {heading}. opts: label, align 'left', toggle false.
  // WATCH OUT: on a phone (480 px or less) the CSS positions it, so no position is worked out.
  ui.menu = function (anchor, items, opts) {
    opts = opts || {};
    ensureHosts();
    const wasAnchor = menuState && menuState.anchor;
    closeMenu(false);
    if (wasAnchor === anchor && opts.toggle !== false) return null; // second tap on the same button closes it
    const mobile = g.innerWidth <= 480;
    const layer = h('div', { class: 'menu-layer' });
    if (mobile) layer.setAttribute('data-mobile', '');
    if (inOfficeNow()) { layer.classList.add('office'); layer.setAttribute('data-otheme', T.office()); }
    const backdrop = h('div', { class: 'menu-backdrop' });
    const el = h('div', { class: 'menu', role: 'menu', 'aria-label': opts.label || 'Menu' });
    if (mobile) el.setAttribute('data-mobile', '');
    // One button per item. An item with a checked value becomes a tick-box row.
    const entries = [];
    (items || []).forEach((it) => {
      if (!it) return;
      if (it.separator) { el.appendChild(h('div', { class: 'menu-sep', role: 'separator' })); return; }
      if (it.heading) { el.appendChild(h('div', { class: 'menu-heading', role: 'presentation' }, it.heading)); return; }
      const checkable = it.checked !== undefined;
      const b = h('button', { type: 'button', class: 'menu-item', role: checkable ? 'menuitemcheckbox' : 'menuitem', tabindex: -1 });
      if (checkable) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      if (it.danger) b.setAttribute('data-danger', '');
      if (it.disabled) b.setAttribute('aria-disabled', 'true');
      if (it.icon) b.appendChild(ico(it.icon, 20));
      b.appendChild(h('span', { class: 'menu-label' }, it.label || ''));
      if (checkable) b.appendChild(h('span', { class: 'menu-check' }, it.checked ? ico('check', 18) : null));
      b.addEventListener('click', () => {
        if (it.disabled) return;
        closeMenu(true);
        try { if (typeof it.onClick === 'function') it.onClick(); } catch (e) { console.error('[smokebox] menu item failed', e); }
      });
      el.appendChild(b); entries.push(b);
    });
    layer.append(backdrop, el);
    hosts.sheets.appendChild(layer);
    try { anchor.setAttribute('aria-haspopup', 'menu'); anchor.setAttribute('aria-expanded', 'true'); } catch (e) { /* ignore */ }
    // Place it: aligned to the button, 8 px inside the window, below it or flipped above if no room.
    if (!mobile) {
      const r = anchor.getBoundingClientRect(), vw = g.innerWidth, vh = g.innerHeight;
      el.style.maxHeight = (vh - 16) + 'px';
      const mw = el.offsetWidth, mh = el.offsetHeight;
      let left = opts.align === 'left' ? r.left : r.right - mw;
      left = Math.max(8, Math.min(left, vw - mw - 8));
      let top = r.bottom + 6;
      if (top + mh > vh - 8) { const above = r.top - 6 - mh; top = above >= 8 ? above : Math.max(8, vh - mh - 8); }
      el.style.left = left + 'px'; el.style.top = top + 'px';
    }
    // The items that are not disabled.
    const enabled = () => entries.filter((b) => b.getAttribute('aria-disabled') !== 'true');
    // Moves focus to the next or previous enabled item, wrapping round at either end.
    const move = (dir) => { const list = enabled(); if (!list.length) return; const i = list.indexOf(doc.activeElement); list[(i + dir + list.length) % list.length].focus(); };
    // Keys for the open menu: arrows, Home and End move; Tab closes it and lets focus carry on.
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Home') { e.preventDefault(); const l = enabled(); if (l[0]) l[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); const l = enabled(); if (l.length) l[l.length - 1].focus(); }
      else if (e.key === 'Tab') closeMenu(true);
    };
    // Tapping outside closes the menu without moving focus.
    const onOutside = () => closeMenu(false);
    // Resizing the window closes the menu, because its position would be wrong.
    const onResize = () => closeMenu(false);
    el.addEventListener('keydown', onKey);
    backdrop.addEventListener('pointerdown', onOutside);
    g.addEventListener('resize', onResize);
    // cleanup takes the three listeners off when the menu closes.
    menuState = { anchor, layer, cleanup: () => { el.removeEventListener('keydown', onKey); backdrop.removeEventListener('pointerdown', onOutside); g.removeEventListener('resize', onResize); } };
    const first = enabled().find((b) => b.getAttribute('aria-checked') === 'true') || enabled()[0];
    if (first) first.focus();
    // Handle for the caller: the element and a way to close the menu.
    return { el, close: () => closeMenu(true) };
  };
  // Closes the open menu without moving focus (used when something else takes over).
  ui.closeMenu = () => closeMenu(false);

  /* ====================================================================================================================
   * Tooltip (one shared element)
   * ================================================================================================================== */
  // The shared tooltip bubble: tipEl = bubble, tipTimer = pending delay, tipOwner = element described.
  let tipEl = null, tipTimer = 0, tipOwner = null;
  // Hides the bubble and unlinks it from the element it described.
  function tipHide() {
    clearTimeout(tipTimer);
    if (tipEl) { tipEl.remove(); tipEl = null; }
    if (tipOwner) { try { tipOwner.removeAttribute('aria-describedby'); } catch (e) { /* ignore */ } tipOwner = null; }
  }
  // Shows the bubble above the element (below if no room), 8 px inside the window; linked for screen
  // readers.
  function tipShow(target, text) {
    tipHide();
    ensureHosts();
    tipEl = h('div', { class: 'tooltip', role: 'tooltip', id: U.uid('tip') }, text);
    if (inOfficeNow()) { tipEl.classList.add('office'); tipEl.setAttribute('data-otheme', T.office()); }
    hosts.shell ? hosts.shell.appendChild(tipEl) : doc.body.appendChild(tipEl);
    tipOwner = target; target.setAttribute('aria-describedby', tipEl.id);
    const r = target.getBoundingClientRect(), w = tipEl.offsetWidth, hgt = tipEl.offsetHeight;
    let left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, g.innerWidth - w - 8));
    let top = r.top - hgt - 8; if (top < 8) top = r.bottom + 8;
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }
  // Gives an element a hover and keyboard tooltip. Returns {setText(t), destroy()}. It shows after the
  // pointer rests 380 ms (never on touch) or when keyboard focus lands on the element; Esc hides it.
  ui.tooltip = function (el, text) {
    let label = String(text == null ? '' : text);
    // Pointer arrives: wait 380 ms so sweeping the mouse across shows nothing. Touch is ignored.
    const onEnter = (e) => { if (e.pointerType === 'touch') return; clearTimeout(tipTimer); tipTimer = setTimeout(() => tipShow(el, label), 380); };
    // Pointer or focus leaves (or is pressed): hide the bubble if it is ours.
    const onLeave = () => { if (tipOwner === el || !tipOwner) tipHide(); };
    // Show on keyboard focus only (focus-visible), not after a mouse click.
    const onFocus = () => { let fv = true; try { fv = el.matches(':focus-visible'); } catch (e) { /* ignore */ } if (fv) tipShow(el, label); };
    // Pressing Esc hides the tooltip at once.
    const onKey = (e) => { if (e.key === 'Escape' && tipOwner === el) tipHide(); };
    el.addEventListener('pointerenter', onEnter); el.addEventListener('pointerleave', onLeave);
    el.addEventListener('focus', onFocus); el.addEventListener('blur', onLeave); el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onLeave);
    return {
      // Changes the tooltip text, live if it is showing now.
      setText: (t) => { label = String(t == null ? '' : t); if (tipOwner === el && tipEl) tipEl.textContent = label; },
      // Hides the tooltip and takes all its listeners off.
      destroy: () => {
        onLeave();
        el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointerleave', onLeave);
        el.removeEventListener('focus', onFocus); el.removeEventListener('blur', onLeave); el.removeEventListener('keydown', onKey);
        el.removeEventListener('pointerdown', onLeave);
      },
    };
  };

  /* ====================================================================================================================
   * Stepper, segmented, chip, badge, toggle, meter, field, error card
   * ================================================================================================================== */
  // How many digits come after the decimal point, at most 8 (0.25 gives 2, 5 gives 0, 1e-7 gives 7).
  const decimalsOf = (n) => { const s = String(n); if (s.indexOf('e-') >= 0) return Math.min(8, parseInt(s.split('e-')[1], 10)); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(8, s.length - i - 1); };

  // Number control with minus/plus buttons and a typed field; returns the element. o: value, min (0), max
  // (999999), step (1), bigStep, unit, label, onChange(value). Methods: getValue, setValue(v, {silent}),
  // setRange, destroy.
  // WATCH OUT: results are rounded and held between min and max, and 1e30, NaN or Infinity are refused, so
  //   a bad number never reaches the caller.
  ui.stepper = function (o) {
    o = o || {};
    // Clean up the settings: step above 0, big step above step, max never below min.
    const step = Number.isFinite(+o.step) && +o.step > 0 ? +o.step : 1;
    const big = Number.isFinite(+o.bigStep) && +o.bigStep > step ? +o.bigStep : 0;
    let min = Number.isFinite(+o.min) ? +o.min : 0;
    let max = Number.isFinite(+o.max) ? +o.max : 999999;
    if (max < min) max = min;
    // Digits after the point to keep, so steps of 0.25 never drift into 0.30000000000000004.
    const dec = Math.max(decimalsOf(step), big ? decimalsOf(big) : 0, decimalsOf(min));
    // Rounds to those digits and holds the value between min and max.
    const fix = (v) => { const n = Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec); return Math.min(max, Math.max(min, n)); };
    const label = o.label || 'Value';
    let value = fix(Number.isFinite(+o.value) ? +o.value : min);
    const onChange = typeof o.onChange === 'function' ? o.onChange : null;
    // Build the pieces: group, text field, buttons (big minus, minus, field, plus, big plus).
    const root = h('div', { class: 'stepper', role: 'group', 'aria-label': label });
    const input = h('input', { class: 'stepper-input', type: 'text', inputmode: dec ? 'decimal' : 'numeric', role: 'spinbutton', 'aria-label': label, autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    // Makes one button: sign (-1/+1), amount, isBig for a "-10" style label instead of an icon.
    const mk = (sign, amount, isBig) => {
      const b = h('button', { type: 'button', class: 'stepper-btn' + (isBig ? ' is-big' : ''), 'aria-label': (sign < 0 ? 'Decrease ' : 'Increase ') + label.toLowerCase() + (isBig ? ' by ' + amount : '') }, isBig ? (sign < 0 ? '−' : '+') + amount : ico(sign < 0 ? 'minus' : 'plus', 20));
      b._sign = sign; b._amount = amount; b.classList.add(sign < 0 ? 'is-minus' : 'is-plus'); return b;
    };
    const btns = [];
    if (big) btns.push(mk(-1, big, true));
    btns.push(mk(-1, step, false));
    const plusBtns = [mk(1, step, false)]; if (big) plusBtns.push(mk(1, big, true));
    const field = h('div', { class: 'stepper-field' }, input);
    const unit = o.unit ? h('span', { class: 'stepper-unit' }, o.unit) : null;
    if (unit) field.appendChild(unit);
    root.append(...btns, field, ...plusBtns);
    const all = btns.concat(plusBtns);
    // Redraws the field and screen-reader values; switches off minus at min and plus at max.
    const render = () => {
      input.value = value.toFixed(dec);
      input.setAttribute('aria-valuenow', String(value)); input.setAttribute('aria-valuemin', String(min)); input.setAttribute('aria-valuemax', String(max));
      input.setAttribute('aria-valuetext', value.toFixed(dec) + (o.unit ? ' ' + o.unit : ''));
      all.forEach((b) => { b.disabled = b._sign < 0 ? value <= min : value >= max; });
      root.classList.remove('is-invalid');
    };
    // Tries a new value (rounded, limited); calls onChange only if it changed. Returns true if it did.
    const commit = (v) => {
      if (!Number.isFinite(v)) { render(); return false; }
      const n = fix(v);
      if (n !== value) { value = n; render(); if (onChange) { try { onChange(value); } catch (e) { console.error('[smokebox] stepper onChange failed', e); } } return true; }
      render(); return false;
    };
    // Typed text to a number (comma allowed). NaN for empty text, exponents, infinity or odd shapes.
    const parse = (s) => {
      s = String(s).trim().replace(',', '.');
      if (!s || /[eE]|infinity|nan/i.test(s) || !/^-?\d*\.?\d*$/.test(s)) return NaN;
      return parseFloat(s);
    };
    // Hold-to-repeat: after 420 ms a held button repeats every 80 ms until release or sliding off.
    let holdT = 0, holdI = 0, holdOff = null;
    // Stops the repeat timers and removes the release listeners.
    const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = 0; if (holdOff) { holdOff(); holdOff = null; } };
    // Button pressed (left mouse button or touch): step once now, then start the hold-to-repeat.
    const onDown = (e) => {
      const b = e.currentTarget; if (b.disabled || (e.button != null && e.button > 0)) return;
      commit(value + b._sign * b._amount);
      stopHold();
      holdT = setTimeout(() => { holdI = setInterval(() => { if (b.disabled) stopHold(); else commit(value + b._sign * b._amount); }, 80); }, 420);
      // Any release or cancel stops the repeat.
      const up = () => stopHold();
      g.addEventListener('pointerup', up, true); g.addEventListener('pointercancel', up, true); b.addEventListener('pointerleave', up);
      // Remembers how to take the release listeners off again.
      holdOff = () => { g.removeEventListener('pointerup', up, true); g.removeEventListener('pointercancel', up, true); b.removeEventListener('pointerleave', up); };
    };
    // Keyboard presses arrive as clicks with detail 0; the mouse is already handled by onDown.
    const onClick = (e) => { if (e.detail === 0) { const b = e.currentTarget; if (!b.disabled) commit(value + b._sign * b._amount); } }; // keyboard activation
    all.forEach((b) => { b.addEventListener('pointerdown', onDown); b.addEventListener('click', onClick); });
    // Typed text accepted: use it, or flash red for 0.7 s and restore the old value.
    const onChangeEv = () => { const v = parse(input.value); if (Number.isNaN(v)) { root.classList.add('is-invalid'); setTimeout(render, 700); } else commit(v); };
    // Field keys: Up/Down step; Page Up/Down big step (or ten steps); Enter accepts; Esc undoes typing.
    const onKey = (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); commit(value + step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); commit(value - step); }
      else if (e.key === 'PageUp') { e.preventDefault(); commit(value + (big || step * 10)); }
      else if (e.key === 'PageDown') { e.preventDefault(); commit(value - (big || step * 10)); }
      else if (e.key === 'Enter') { e.preventDefault(); onChangeEv(); }
      else if (e.key === 'Escape' && input.value !== value.toFixed(dec)) { e.preventDefault(); e.stopPropagation(); render(); }
    };
    input.addEventListener('change', onChangeEv); input.addEventListener('keydown', onKey);
    input.addEventListener('focus', () => { try { input.select(); } catch (e) { /* ignore */ } });
    // The current value as a number.
    root.getValue = () => value;
    // Sets the value from outside (rounded and limited). Tells onChange unless opt.silent is true.
    root.setValue = (v, opt) => { const n = fix(Number.isFinite(+v) ? +v : value); const changed = n !== value; value = n; render(); if (changed && onChange && !(opt && opt.silent)) onChange(value); };
    // Changes min and max, then pulls the value back inside them.
    root.setRange = (a, b) => { if (Number.isFinite(+a)) min = +a; if (Number.isFinite(+b)) max = +b; if (max < min) max = min; value = fix(value); render(); };
    // Stops any repeat and removes the listeners.
    root.destroy = () => { stopHold(); all.forEach((b) => { b.removeEventListener('pointerdown', onDown); b.removeEventListener('click', onClick); }); input.removeEventListener('change', onChangeEv); input.removeEventListener('keydown', onKey); };
    root.input = input;
    render();
    return root;
  };

  // A row of choice buttons (station tabs or pick-one). o: options [{id, label, icon, count, alert}],
  // value, onChange(id), label, kind ('tabs' or radio). Methods: getValue, setValue, setOptions, setCount.
  // WATCH OUT: only the selected button is a Tab stop; arrow keys move and select.
  ui.segmented = function (o) {
    o = o || {};
    // Settings; with no value given, the first option is selected.
    const kind = o.kind === 'tabs' ? 'tabs' : 'radio';
    const root = h('div', { class: 'seg' + (o.class ? ' ' + o.class : ''), role: kind === 'tabs' ? 'tablist' : 'radiogroup' });
    if (o.label) root.setAttribute('aria-label', o.label);
    let options = Array.isArray(o.options) ? o.options.slice() : [];
    let value = o.value != null ? o.value : options[0] && options[0].id;
    const onChange = typeof o.onChange === 'function' ? o.onChange : null;
    const parts = {};
    // Draws all option buttons (label, count, attention dot), then marks the selected one.
    function build() {
      U.clear(root);
      Object.keys(parts).forEach((k) => delete parts[k]);
      options.forEach((op, i) => {
        const b = h('button', { type: 'button', class: 'seg-opt', role: kind === 'tabs' ? 'tab' : 'radio', dataset: { id: op.id } });
        if (op.ariaLabel) b.setAttribute('aria-label', op.ariaLabel);
        if (op.icon) b.appendChild(ico(op.icon, op.iconSize || 20));
        const lab = h('span', { class: 'seg-label' }, op.label == null ? '' : op.label);
        const count = h('span', { class: 'seg-count num', hidden: op.count == null }, op.count == null ? '' : String(op.count));
        const dot = h('span', { class: 'seg-dot', hidden: !op.alert }, h('span', { class: 'visually-hidden' }, op.alertLabel || 'needs attention'));
        b.append(lab, count, dot);
        parts[op.id] = { b, count, dot };
        root.appendChild(b);
      });
      paint();
    }
    // Marks the selected option and makes it the one Tab stop (the first if nothing matches).
    function paint() {
      const has = options.some((op) => op.id === value);
      options.forEach((op, i) => {
        const b = parts[op.id].b, on = has ? op.id === value : i === 0;
        b.setAttribute(kind === 'tabs' ? 'aria-selected' : 'aria-checked', on && has ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
    }
    // Selects an option; onChange is called only when the user did it, not when the program does.
    function select(id, user) {
      if (id === value || !parts[id]) return;
      value = id; paint();
      if (user && onChange) { try { onChange(id); } catch (e) { console.error('[smokebox] segmented onChange failed', e); } }
    }
    // Click on a button: find which option it belongs to and select it.
    root.addEventListener('click', (e) => { const b = e.target.closest('.seg-opt'); if (b && root.contains(b)) select(b.dataset.id, true); });
    root.addEventListener('keydown', (e) => {
      const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
      if (keys.indexOf(e.key) < 0 || !options.length) return;
      e.preventDefault();
      let i = options.findIndex((op) => parts[op.id].b === doc.activeElement); if (i < 0) i = Math.max(0, options.findIndex((op) => op.id === value));
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (i + 1) % options.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (i - 1 + options.length) % options.length;
      else if (e.key === 'Home') i = 0; else i = options.length - 1;
      parts[options[i].id].b.focus(); select(options[i].id, true);
    });
    // The id of the selected option.
    root.getValue = () => value;
    // Selects an option from outside without calling onChange.
    root.setValue = (id) => select(id, false);
    // Replaces the whole list of options.
    root.setOptions = (next) => { options = Array.isArray(next) ? next.slice() : []; build(); };
    // Updates one option's number and attention dot, touching the page only when they really changed.
    root.setCount = (id, n, extra) => {
      const p = parts[id]; if (!p) return;
      const has = n != null; p.count.hidden = !has; if (has && p.count.textContent !== String(n)) p.count.textContent = String(n);
      const alert = !!(extra && extra.alert); if (p.dot.hidden === alert) p.dot.hidden = !alert;
    };
    build();
    return root;
  };

  // A small tag; a button if o.onClick is given (o.pressed sets its state), else text. o.tone, o.zone,
  // o.icon.
  ui.chip = function (o) {
    o = o || {};
    const el = h(typeof o.onClick === 'function' ? 'button' : 'span', { class: 'chip' + (o.mod ? ' chip-mod' : '') + (o.zone ? ' chip-zone' : '') });
    if (el.tagName === 'BUTTON') { el.type = 'button'; el.addEventListener('click', o.onClick); if (o.pressed != null) el.setAttribute('aria-pressed', o.pressed ? 'true' : 'false'); }
    if (o.tone) el.setAttribute('data-tone', o.tone);
    if (o.zone) el.setAttribute('data-zone', o.zone);
    if (o.icon) el.appendChild(ico(o.icon, 16));
    el.appendChild(h('span', null, o.label == null ? '' : o.label));
    return el;
  };
  // Status badges: level -> [icon, word]; the word is always shown, never colour alone.
  const BADGE = { ok: ['check-circle', 'On time'], warn: ['clock', 'Running late'], breach: ['alert', 'Overdue'] };
  // Makes a status badge. Accepts 'ok', 'warn', 'breach' and the aliases 'bad', 'overdue' and 'warning'.
  // WATCH OUT: an unknown level shows as 'ok' (On time).
  ui.badge = function (level) {
    const lv = level === 'bad' || level === 'overdue' ? 'breach' : level === 'warning' ? 'warn' : BADGE[level] ? level : 'ok';
    const [icon, word] = BADGE[lv];
    return h('span', { class: 'badge', dataset: { level: lv } }, ico(icon, 16), h('span', null, word));
  };
  // The three badge words (On time, Running late, Overdue), for text that must match the badges.
  ui.badgeWords = () => ({ ok: BADGE.ok[1], warn: BADGE.warn[1], breach: BADGE.breach[1] });

  // An on/off switch. o: checked, label, disabled, onChange(on). Has getValue() and setValue(v) (silent).
  ui.toggle = function (o) {
    o = o || {};
    let on = !!o.checked;
    const el = h('button', { type: 'button', class: 'toggle', role: 'switch', 'aria-checked': on ? 'true' : 'false' },
      h('span', { class: 'toggle-track', 'aria-hidden': 'true' }, h('span', { class: 'toggle-thumb' }, ico('check', 14, { stroke: 3 }))),
      h('span', { class: 'toggle-label' }, o.label == null ? '' : o.label));
    if (o.disabled) el.disabled = true;
    el.addEventListener('click', () => { on = !on; el.setAttribute('aria-checked', on ? 'true' : 'false'); if (typeof o.onChange === 'function') { try { o.onChange(on); } catch (e) { console.error('[smokebox] toggle onChange failed', e); } } });
    // True when the switch is on.
    el.getValue = () => on;
    // Sets the switch from outside without calling onChange.
    el.setValue = (v) => { on = !!v; el.setAttribute('aria-checked', on ? 'true' : 'false'); };
    return el;
  };

  // A bar showing value out of max (default 100) with an optional tick at thr; held to 0..max.
  ui.meter = function (o) {
    o = o || {};
    const max = Number.isFinite(+o.max) && +o.max > 0 ? +o.max : 100;
    const v = Math.max(0, Math.min(max, Number.isFinite(+o.value) ? +o.value : 0));
    const el = h('div', { class: 'meter' + (o.large ? ' meter-lg' : ''), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': v });
    if (o.label) el.setAttribute('aria-label', o.label);
    el.style.setProperty('--v', String((v / max) * 100));
    if (o.tone) el.setAttribute('data-tone', o.tone);
    el.appendChild(h('i'));
    if (Number.isFinite(+o.thr)) { el.style.setProperty('--thr', String((Math.min(max, +o.thr) / max) * 100)); el.appendChild(h('span', { class: 'meter-tick', 'aria-hidden': 'true' })); }
    return el;
  };

  // Wraps an input with label, hint and error line, linked for screen readers. o: label, control, hint,
  // error.
  ui.field = function (o) {
    o = o || {};
    const control = o.control; const id = (control && control.id) || U.uid('f');
    if (control && !control.id) control.id = id;
    const label = h('label', { class: 'field-label', for: id }, o.label || '');
    const hint = o.hint ? h('div', { class: 'field-hint', id: id + '-hint' }, o.hint) : null;
    const err = h('div', { class: 'field-error', id: id + '-err', role: 'alert', hidden: true });
    const el = h('div', { class: 'field' }, label, control, hint, err);
    // Shows or clears the error line and keeps the control's invalid mark and description links in step.
    el.setError = (msg) => {
      U.clear(err);
      if (msg) { err.append(ico('alert-circle', 18), h('span', null, msg)); err.hidden = false; control.setAttribute('aria-invalid', 'true'); }
      else { err.hidden = true; control.removeAttribute('aria-invalid'); }
      const d = []; if (hint) d.push(hint.id); if (msg) d.push(err.id);
      if (d.length) control.setAttribute('aria-describedby', d.join(' ')); else control.removeAttribute('aria-describedby');
    };
    el.setError(o.error || null);
    return el;
  };

  // Card shown instead of a failed section: module, message, Copy details (with stack, time), Try again.
  ui.errorCard = function (err, o) {
    o = o || {};
    const msg = (err && err.message) || String(err || 'Unknown error');
    const mod = o.module || (err && err.module) || 'unknown module';
    const details = ['Module: ' + mod, 'Message: ' + msg, err && err.stack ? 'Stack:\n' + err.stack : '', 'Time: ' + new Date().toISOString()].filter(Boolean).join('\n');
    const copyBtn = h('button', { type: 'button', class: 'btn btn-sm' }, ico('copy', 18), h('span', null, 'Copy details'));
    copyBtn.addEventListener('click', () => ui.copyText(details).then((ok) => ui.toast(ok ? 'Details copied.' : 'Could not copy. Select the text and copy it by hand.', { tone: ok ? 'ok' : 'warn' })));
    const row = h('div', { class: 'row' });
    if (typeof o.onRetry === 'function') row.appendChild(h('button', { type: 'button', class: 'btn btn-sm', onClick: o.onRetry }, ico('refresh', 18), h('span', null, 'Try again')));
    row.appendChild(copyBtn);
    return h('div', { class: 'error-card', role: 'alert' },
      h('h2', null, ico('alert-circle', 26), h('span', null, o.title || 'This section could not load')),
      h('p', null, msg),
      h('p', { class: 't-muted' }, 'Module: ' + mod),
      h('div', { class: 'error-detail', tabindex: 0, 'aria-label': 'Technical details' }, details),
      row);
  };

  /* ====================================================================================================================
   * Global keys
   * ================================================================================================================== */
  // Page keys: Esc closes menu, tooltip, top sheet, then the office; Ctrl/Cmd+Shift+O toggles the office.
  doc.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && !e.isComposing) {
      if (menuState) { e.preventDefault(); closeMenu(true); return; }
      if (tipEl) tipHide();
      const top = sheetStack[sheetStack.length - 1];
      if (top) { if (top.opts.closeOnEsc !== false) { e.preventDefault(); top.close('esc'); } return; }
      if (S.inOffice()) { e.preventDefault(); S.extinguish(); }
      return;
    }
    // WATCH OUT: the office key does nothing while a sheet, the PIN keypad or a menu is open. Otherwise it stacked a second
    // keypad, opened the office under a floor sheet, or closed the office while one of its own sheets was still open.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'O' || e.key === 'o') && st.mounted) {
      e.preventDefault();
      if (sheetStack.length || menuState) return;
      if (S.inOffice()) S.extinguish(); else S.ignite();
    }
  });
  // Clicks: skip links move focus; [data-back-to-line] leaves the office; [data-brand] counts toward 5
  // taps.
  doc.addEventListener('click', (e) => {
    const skip = e.target.closest && e.target.closest('[data-skip]');
    if (skip) { e.preventDefault(); const t = doc.getElementById(skip.getAttribute('data-skip')); if (t) t.focus({ preventScroll: true }); return; }
    const back = e.target.closest && e.target.closest('[data-back-to-line]');
    if (back && st.mounted) { e.preventDefault(); S.extinguish(); return; }
    const brand = e.target.closest && e.target.closest('[data-brand]');
    if (brand && st.mounted && !S.inOffice()) brandTap(brand);
  });

  /* ====================================================================================================================
   * Shell
   * ================================================================================================================== */
  // Shell state: office open / built, animations running, officeDone (settles when an open or close ends),
  // unlockedUntil (no PIN asked until then), taps (recent flame taps), rafs (safety timers).
  const st = {
    mounted: false, root: null, shell: null, veil: null, fx: null,
    officeOpen: false, officeAnims: [], officeSection: 'pace', officeContent: false, officeOpener: null, officeDone: Promise.resolve(true),
    unlockedUntil: 0, ph: null, taps: [], flickerT: 0, lastBrand: null, rafs: [],
  };
  // GRACE_MS 120 000 ms = 2 minutes with no PIN prompt after a PIN or leaving the office (starter estimate,
  // owner to confirm). TAP_WINDOW 2 500 ms: five taps inside 2.5 s. IGNITE_MS 720 ms: the ember reveal.
  const GRACE_MS = 120000, TAP_WINDOW = 2500, IGNITE_MS = 720;
  // Promise that finishes after n screen refreshes, so the browser draws the start state first.
  const nextFrames = (n) => new Promise((res) => { const step = (k) => (k <= 0 ? res() : requestAnimationFrame(() => step(k - 1))); step(n); });

  // True while the back office is open.
  S.inOffice = () => st.officeOpen;
  // True while pretend data is in play: demo tickets on the board, demo orders running, or a clock faster
  // than real time. The developer-only tools (clock speeds, contrast checker) show only then.
  S.demoLoaded = function () {
    try {
      const sp = SB.store && SB.store.speed ? SB.store.speed() : 1;
      const live = SB.sim && SB.sim.live && SB.sim.live.status ? SB.sim.live.status() || {} : {};
      const s = SB.store && SB.store.getState ? SB.store.getState() : null;
      return sp > 1 || !!live.running || !!(s && s.tickets.some((t) => t.src === 'demo'));
    } catch (e) { return false; }
  };
  // True once mount has built the frame.
  S.isMounted = () => st.mounted;
  S.sha256 = sha256hex;
  S.GRACE_MS = GRACE_MS;

  // The flame button every floor header must use ([data-brand]); five quick taps open the office.
  S.brand = function (o) {
    o = o || {};
    const mark = SB.icons && SB.icons.brand ? SB.icons.brand(o.size || 30) : doc.createElement('span');
    const b = h('button', { type: 'button', class: 'brand', dataset: { brand: '' } }, mark);
    if (o.text !== false) b.appendChild(h('span', null, (SB.config && SB.config.brand && SB.config.brand.name) || 'Smokebox'));
    else b.setAttribute('aria-label', 'Smokebox');
    return b;
  };

  /* ---------- PIN ---------- */

  // The saved PIN scramble from the store's office settings, or null when no PIN is set. Never throws.
  const pinHash = () => { try { const s = SB.store && SB.store.getState && SB.store.getState(); return (s && s.settings && s.settings.office && s.settings.office.pinHash) || null; } catch (e) { return null; } };
  // True when a manager PIN is set.
  S.hasPin = () => !!pinHash();
  // The old unsalted form of a PIN scramble: 'sha256:' + 64 hex characters of the digest of 'smokebox.v1:' + pin. Browser crypto first, the pure copy as
  // fallback; same result. Kept so a PIN saved by an older build still works.
  async function legacyPinHash(pin) {
    const text = 'smokebox.v1:' + String(pin);
    try {
      if (g.crypto && g.crypto.subtle && typeof TextEncoder !== 'undefined') {
        const buf = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return 'sha256:' + Array.from(new Uint8Array(buf)).map((b) => ('0' + b.toString(16)).slice(-2)).join('');
      }
    } catch (e) { /* fall back to the pure implementation, which gives the same digest */ }
    return 'sha256:' + sha256hex(text);
  }
  // Scrambles a PIN for saving: salted PBKDF2 ('pbkdf2:rounds:salt:hash') where the browser can, the old unsalted form where it cannot. The real
  // number is never stored. A 4-digit PIN is a door latch for the back office, not a lock: anyone with the device or a backup file can still try
  // all 10 000 PINs, the salt and rounds only make each try cost real work.
  S.hashPin = async function (pin) {
    const salted = await U.secretHash('smokebox.v1:', pin);
    return salted !== null ? salted : legacyPinHash(pin);
  };
  // True if the PIN matches the saved scramble (either form). True for anything when no PIN is set. A right PIN saved in the old form is saved again
  // in the new form on the spot.
  S.checkPin = async function (pin) {
    const want = pinHash();
    if (!want) return true;
    const r = await U.secretCheck('smokebox.v1:', pin, want);
    let ok = r.ok;
    if (!ok && !(g.crypto && g.crypto.subtle) && want.indexOf('sha256:') === 0) ok = (await legacyPinHash(pin)) === want;      // no browser crypto: the pure copy
    if (ok && r.legacy) {
      try { const fresh = await U.secretHash('smokebox.v1:', pin); if (fresh) SB.store.dispatch('updateSettings', { patch: { office: { pinHash: fresh } } }, { source: 'user' }); } catch (e) { /* the old form keeps working */ }
    }
    return ok;
  };
  // Sets (4 digits) or removes (null or '') the manager PIN. Only the scramble is saved, through the store
  // (settings.office.pinHash); any unlock is forgotten. Resolves {ok, report}; bad input gives 'badPin'.
  // Asks for the current PIN right now (the keypad), even inside the 2-minute grace. True at once when no PIN is set; false when cancelled.
  S.requirePin = () => (S.hasPin() ? promptPin() : Promise.resolve(true));
  S.setPin = async function (pin, opts) {
    // With a PIN already set, changing or removing it needs proof that the current PIN was just entered (opts.verified from requirePin).
    if (S.hasPin() && !(opts && opts.verified === true)) return { ok: false, report: 'pinRequired', message: 'The current PIN is needed to change or remove it.' };
    if (pin != null && pin !== '' && !/^\d{4}$/.test(String(pin))) return { ok: false, report: 'badPin', message: 'Use exactly 4 digits.' };
    const hash = pin == null || pin === '' ? null : await S.hashPin(pin);
    if (!SB.store || typeof SB.store.dispatch !== 'function') return { ok: false, report: 'noStore', message: 'The store is not available.' };
    let report; try { report = SB.store.dispatch('updateSettings', { patch: { office: { pinHash: hash } } }, { source: 'user' }); } catch (e) { report = 'error'; }
    S.lock();
    return { ok: report === 'ok', report };
  };
  // Ends the grace period, so the next entry to the office asks for the PIN.
  S.lock = () => { st.unlockedUntil = 0; };
  // True when a PIN is set, the office is closed and the 2-minute grace period is over.
  const needsPin = () => S.hasPin() && !st.officeOpen && Date.now() > st.unlockedUntil;

  // Shows the PIN keypad in a sheet; returns a promise: true for the right PIN, false if cancelled.
  // Failures are counted in the notebook (pinlock): 5 wrong tries lock it for 30 seconds, and the lock
  // survives closing and reopening.
  // WATCH OUT: this only keeps line cooks out; the PIN is stored on the device, so anyone who can use the
  //   device can get round it.
  function promptPin() {
    return new Promise((resolve) => {
      let entry = '', busy = false, done = false, timer = 0, locked = false;
      // Reads the saved failure count and lock-until time (zero if none).
      const lockState = () => U.storage.get(KEY.pinlock, { fails: 0, until: 0 });
      // Ends the keypad once: stops the lock timer, closes the sheet and answers.
      const finish = (ok) => { if (done) return; done = true; clearInterval(timer); sh.close(ok ? 'pin-ok' : 'pin-cancel'); resolve(ok); };
      // Closing the keypad any other way (Esc, Back, backdrop) answers false.
      const sh = ui.sheet({ title: 'Manager PIN', side: 'center', width: 360, name: 'pin', onClose: () => { clearInterval(timer); if (!done) { done = true; resolve(false); } } });
      // Build the keypad: four dots, a message line, 12 keys and the "not real security" note.
      const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => h('span', { class: 'pin-dot' })));
      const status = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, '0 of 4 digits entered');
      const msg = h('div', { class: 'pin-msg', role: 'alert' }, 'Enter the 4-digit PIN.');
      const pad = h('div', { class: 'keypad' });
      const keys = [];
      // Makes one keypad button and lists it in keys; aux is the quieter style for Clear and Delete.
      const mkKey = (label, aria, fn, aux) => { const b = h('button', { type: 'button', class: 'btn key' + (aux ? ' is-aux' : ''), 'aria-label': aria || label, onClick: fn }, label); keys.push(b); return b; };
      for (let n = 1; n <= 9; n++) pad.appendChild(mkKey(String(n), 'Digit ' + n, () => push(String(n))));
      pad.append(mkKey('Clear', 'Clear all digits', () => { entry = ''; paint(); }, true), mkKey('0', 'Digit 0', () => push('0')), mkKey(ico('backspace', 26), 'Delete last digit', () => { entry = entry.slice(0, -1); paint(); }, true));
      // The recovery code form inside Forgot the PIN?: the code, a new PIN (or none to remove it), and one button. Refusals show plain words.
      function recoveryBox() {
        if (!SB.store || typeof SB.store.recoverPin !== 'function' || !SB.store.hasRecoveryCode || !SB.store.hasRecoveryCode()) return h('p', { class: 'fs-sub' }, 'No recovery code was saved on this device.');
        const code = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCDE-FGHJK', 'aria-label': 'Recovery code' });
        const np = h('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'off', 'aria-label': 'New 4-digit PIN, or leave empty to remove the PIN' });
        const out = h('p', { class: 'pin-msg', role: 'status' });
        // Checks the code and sets the new PIN (or removes it), then lets the owner in.
        const go = h('button', { type: 'button', class: 'btn', dataset: { act: 'pin-recover' }, onClick: async () => {
          const v = np.value.trim();
          if (v && !/^\d{4}$/.test(v)) { out.textContent = 'The new PIN must be exactly 4 digits, or leave it empty to remove the PIN.'; out.setAttribute('data-tone', 'bad'); return; }
          const hash = v ? await S.hashPin(v) : null;
          const r = await SB.store.recoverPin(code.value, hash);
          if (r.ok) { say(r.info && r.info.pinRemoved ? 'PIN removed. Set a new one under Settings, Tax, hours and PIN.' : 'New PIN saved.', null); finish(true); return; }
          let w = r.report; try { w = SB.engine.describe(r.report, r.info, SB.store.getState().settings) || w; } catch (e) { /* keep the code */ }
          out.textContent = w; out.setAttribute('data-tone', 'bad');
        } }, 'Reset the PIN with my code');
        return h('div', { class: 'pin-recover' }, h('label', null, 'Recovery code', code), h('label', null, 'New PIN (4 digits, or empty to remove)', np), go, out);
      }
      const note = h('p', { class: 'pin-note' }, 'This PIN keeps line cooks out of the back office. It is not real security: it is stored on this device, and anyone who can use the device can get around it.');
      // What to do when the PIN is forgotten: said plainly, because there is no reset button and nothing here may pretend otherwise.
      const forgot = h('details', { class: 'pin-forgot' },
        h('summary', null, 'Forgot the PIN?'),
        h('p', null, 'The PIN only locks the back office: sales, menu and settings. The kitchen board and New ticket stay open.'),
        h('p', null, 'If you saved a recovery code when you set the PIN, use it below. Otherwise ask whoever set the PIN: it is saved only on this device.'),
        recoveryBox(),
        h('p', null, 'If nobody knows it, the only way back in is to clear this site\'s saved data in your browser settings. That erases everything on this device: tickets, dishes and settings. Then open Smokebox and restore your latest backup (Back office, Data, Import). A backup brings back the PIN it was saved with, so use one made before the PIN was set or changed.'),
        SB.guide && SB.guide.link ? SB.guide.link('empty-lost-or-locked', 'forgot the PIN') : null);
      sh.body.append(dots, msg, status, pad, note, forgot);
      // The Cancel button closes the keypad and answers false.
      sh.footer.appendChild(h('button', { type: 'button', class: 'btn', onClick: () => finish(false) }, 'Cancel'));
      // Lights as many dots as digits typed and updates the spoken count.
      function paint() { Array.from(dots.children).forEach((d, i) => d.classList.toggle('is-on', i < entry.length)); status.textContent = entry.length + ' of 4 digits entered'; }
      // Shows a message under the dots; tone 'bad' marks it as an error.
      function say(t, tone) { msg.textContent = t; if (tone) msg.setAttribute('data-tone', tone); else msg.removeAttribute('data-tone'); }
      // Disables or enables all keys; focus is kept inside the sheet because a disabled key drops it.
      function setLocked(on) { locked = on; keys.forEach((k) => { k.disabled = on; }); sh.focus(on ? sh.el : keys[0]); } // a disabled key drops focus, so keep it inside the sheet
      // Reads the saved lock: while it runs keys stay off and seconds count down; at the end they return.
      function tickLock() {
        const s = lockState(); const left = Math.ceil((s.until - Date.now()) / 1000);
        if (left > 0) { setLocked(true); say('Too many wrong tries. Try again in ' + left + ' s. Forgot the PIN? See below.', 'bad'); return; }
        clearInterval(timer); if (locked) { setLocked(false); U.storage.set(KEY.pinlock, { fails: 0, until: 0 }); say('Enter the 4-digit PIN.'); }
      }
      // Starts checking the lock twice a second (every 500 ms).
      function startLockTimer() { clearInterval(timer); tickLock(); timer = setInterval(tickLock, 500); }
      // Adds a digit. The fourth digit checks the PIN: right grants the 2-minute grace and closes with
      // true; wrong clears, shakes, counts the failure and locks after the fifth.
      async function push(d) {
        if (busy || locked || entry.length >= 4) return;
        entry += d; paint();
        if (entry.length < 4) return;
        busy = true;
        const ok = await S.checkPin(entry);
        busy = false;
        if (done) return;
        if (ok) { U.storage.set(KEY.pinlock, { fails: 0, until: 0 }); st.unlockedUntil = Date.now() + GRACE_MS; finish(true); return; }
        const s = lockState(); s.fails = (s.fails || 0) + 1;
        entry = ''; paint();
        // Remove the class, read the size, add it again: the read forces the shake to replay.
        pad.classList.remove('pin-shake'); void pad.offsetWidth; pad.classList.add('pin-shake');
        dots.classList.remove('pin-shake'); void dots.offsetWidth; dots.classList.add('pin-shake');
        // Fifth wrong try: lock for 30 000 ms (30 seconds), as specified in SPEC 15.1.
        if (s.fails >= 5) { s.until = Date.now() + 30000; U.storage.set(KEY.pinlock, s); startLockTimer(); ui.announce('Wrong PIN. Locked for 30 seconds.'); }
        else { U.storage.set(KEY.pinlock, s); const left = 5 - s.fails; say('Wrong PIN. ' + left + ' ' + U.plural(left, 'try', 'tries') + ' left.', 'bad'); }
      }
      // A real keyboard works too: digits type, Backspace deletes (ignored while checking or locked).
      sh.el.addEventListener('keydown', (e) => {
        if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); push(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); if (!busy && !locked) { entry = entry.slice(0, -1); paint(); } }
      });
      // If an earlier lock is still running, resume its countdown. Focus starts on the first key.
      if (lockState().until > Date.now()) startLockTimer();
      sh.focus(pad.querySelector('button'));
    });
  }
  S.promptPin = promptPin;
  // A promise that is true at once if no PIN is needed, else the keypad's answer.
  function guard() { return needsPin() ? promptPin() : Promise.resolve(true); }

  /* ---------- secret gesture: 5 taps on the brand mark within 2.5 s; taps 3 and 4 flicker the flame ---------- */
  // One tap on the flame. Taps older than 2.5 s drop off; taps 3 and 4 flicker it; the 5th opens the
  // office.
  function brandTap(el) {
    const now = performance.now();
    st.lastBrand = el;
    while (st.taps.length && now - st.taps[0] > TAP_WINDOW) st.taps.shift();
    st.taps.push(now);
    const n = st.taps.length;
    if (n === 3 || n === 4) flicker(el);
    if (n >= 5) { st.taps.length = 0; S.ignite({ from: el }); }
  }
  // Flame flicker on the logo mark: class removed, size read, class added to replay; off after 440 ms.
  function flicker(el) {
    const mark = el.matches('.brand-mark') ? el : el.querySelector('.brand-mark');
    if (!mark) return;
    mark.classList.remove('is-flicker'); void mark.getBoundingClientRect(); mark.classList.add('is-flicker');
    clearTimeout(st.flickerT); st.flickerT = setTimeout(() => mark.classList.remove('is-flicker'), 440);
  }

  /* ---------- ignition ---------- */

  // Where the ember starts: centre of the tapped flame in pixels, or (44, 40). Returns {x, y, el}.
  function originPoint() {
    const el = (st.lastBrand && st.lastBrand.isConnected ? st.lastBrand : null) || (layers.floor && layers.floor.querySelector('[data-brand]'));
    if (el) {
      const mark = el.querySelector('.brand-mark') || el; const r = mark.getBoundingClientRect();
      if (r.width > 0) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), el };
    }
    return { x: 44, y: 40, el: null };
  }
  // Distance to the farthest window corner: the circle radius that covers the whole screen.
  const farthest = (x, y) => Math.ceil(Math.hypot(Math.max(x, g.innerWidth - x), Math.max(y, g.innerHeight - y)));
  // Clears ignition leftovers: animations, timers, ring and smoke, circle clip and classes. Safe any time.
  function resetFx() {
    st.officeAnims.splice(0).forEach((a) => { try { a.cancel(); } catch (e) { /* ignore */ } });
    st.rafs.splice(0).forEach((t) => clearTimeout(t));
    if (st.fx) U.clear(st.fx);
    if (layers.office) { layers.office.style.clipPath = ''; layers.office.style.opacity = ''; layers.office.classList.remove('is-igniting', 'is-snuffing'); }
    if (st.shell) st.shell.classList.remove('is-igniting', 'is-snuffing');
  }
  // Smoke puffs at random spots low in the window, each starting when the ring reaches it.
  function addWisps(o, R0, count, durScale) {
    const frag = doc.createDocumentFragment();
    const W = g.innerWidth, H = g.innerHeight;
    for (let i = 0; i < count; i++) {
      const x = Math.round(W * (0.06 + Math.random() * 0.88)), y = Math.round(H * (0.35 + Math.random() * 0.6));
      const prog = Math.min(1, Math.hypot(x - o.x, y - o.y) / R0);
      const w = 60 + Math.round(Math.random() * 70), hh = 120 + Math.round(Math.random() * 120);
      const wisp = h('span', { class: 'wisp' });
      wisp.style.cssText = `--x:${x}px;--y:${y}px;--w:${w}px;--h:${hh}px;--rise:${90 + Math.round(Math.random() * 110)}px;--dx:${Math.round(Math.random() * 60 - 30)}px;--o:${(0.32 + Math.random() * 0.3).toFixed(2)};--d:${Math.round((780 + Math.random() * 380) * durScale)}ms;--delay:${Math.round(110 + prog * IGNITE_MS * 0.8)}ms`;
      frag.appendChild(wisp);
    }
    st.fx.appendChild(frag);
  }
  // Builds office pages once per opening (placeholder if missing). On failure: error card, never blank.
  function mountOfficeContent(section) {
    if (st.officeContent) { navigateOffice(section); return; }
    st.officeContent = true;
    const el = layers.office; U.clear(el);
    try {
      if (SB.office && typeof SB.office.mount === 'function') SB.office.mount(el, section);
      else renderOfficePlaceholder(el, section);
    } catch (e) {
      console.error('[smokebox] office failed to mount', e);
      // Try again clears the flag and builds the office pages from scratch.
      U.clear(el); el.appendChild(ui.errorCard(e, { title: 'The back office could not open', module: 'office (80-*.js to 84-*.js)', onRetry: () => { st.officeContent = false; mountOfficeContent(st.officeSection); } }));
      el.appendChild(h('div', { class: 'row', style: 'padding:0 16px 16px;justify-content:center' }, h('button', { type: 'button', class: 'btn', dataset: { backToLine: '' } }, ico('door', 20), h('span', null, 'Back to the board'))));
    }
  }
  // Tears the office pages down after closing and empties the layer.
  function unmountOfficeContent() {
    if (!st.officeContent) return;
    st.officeContent = false;
    try { if (SB.office && typeof SB.office.unmount === 'function') SB.office.unmount(); } catch (e) { console.error('[smokebox] office unmount failed', e); }
    U.clear(layers.office);
  }
  // Switches the open office to another page, through the office file or the placeholder.
  function navigateOffice(section) {
    st.officeSection = section;
    try { if (SB.office && typeof SB.office.navigate === 'function') SB.office.navigate(section); else if (st.ph && st.ph.office) st.ph.office.setSection(section); } catch (e) { console.error('[smokebox] office navigate failed', e); }
  }
  // Opens the back office; returns a promise that gives true when fully open (false if closed again
  // meanwhile). A circle (CSS clip-path) grows from the flame with an ember ring and 10 wisps; reduced
  // motion or no animation support uses a 150 ms fade.
  // WATCH OUT: while the circle animates, the office layer needs the is-igniting class (CSS will-change:
  //   clip-path). Without it Chromium with software drawing leaves undimmed and black patches outside the
  //   circle. Do not remove it.
  function openOffice(section) {
    if (st.officeOpen) { navigateOffice(section); return st.officeDone; }
    // Step 1: mark the office open, remember what should get focus when it closes, and close any menu.
    resetFx();
    st.officeOpen = true; st.officeSection = section;
    st.officeOpener = (st.lastBrand && st.lastBrand.isConnected ? st.lastBrand : null) || pickOpener(null);
    closeMenu(false);
    // Step 2: un-hide the office layer (clipped to nothing at first) and block the floor behind it.
    st.shell.setAttribute('data-view', 'office');
    const off = layers.office;
    off.setAttribute('data-otheme', T.office());
    off.hidden = false;
    syncInert(); updateThemeColor();
    // Once open: clear leftovers, focus the office, announce it to screen readers.
    const done = () => {
      resetFx();
      try { off.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      ui.announce('Back office open');
    };
    // Step 3a: reduced motion. Build the pages now and fade in over 150 ms.
    if (reduced() || typeof off.animate !== 'function') {
      mountOfficeContent(section);
      const a = off.animate ? off.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'linear' }) : null;
      st.officeDone = a ? a.finished.then(() => { if (st.officeOpen) done(); return true; }, () => true) : Promise.resolve(done()).then(() => true);
      if (a) st.officeAnims.push(a);
      return st.officeDone;
    }
    // Step 3b: full ignition. R0 reaches the farthest corner plus 40 px so the edge ends off screen.
    const o = originPoint(), R0 = farthest(o.x, o.y) + 40;
    st.shell.classList.add('is-igniting');
    off.classList.add('is-igniting');
    off.style.clipPath = `circle(0px at ${o.x}px ${o.y}px)`;
    // Wait two screen refreshes so the closed state is drawn, then start circle, ring and wisps together.
    st.officeDone = nextFrames(2).then(() => {
      if (!st.officeOpen) return false;
      mountOfficeContent(section);
      const timing = { duration: IGNITE_MS, delay: 100, easing: 'cubic-bezier(0.5, 0.05, 0.3, 1)', fill: 'both' };
      const clip = off.animate([{ clipPath: `circle(0px at ${o.x}px ${o.y}px)` }, { clipPath: `circle(${R0}px at ${o.x}px ${o.y}px)` }], timing);
      const ring = h('div', { class: 'ember-ring' }); ring.style.setProperty('--ox', o.x + 'px'); ring.style.setProperty('--oy', o.y + 'px');
      st.fx.appendChild(ring);
      const ra = ring.animate([{ '--er': '0px', opacity: 1 }, { '--er': Math.round(R0 * 0.8) + 'px', opacity: 1, offset: 0.8 }, { '--er': R0 + 'px', opacity: 0 }], timing);
      addWisps(o, R0, 10, 1);
      st.officeAnims.push(clip, ra);
      return Promise.all([clip.finished, ra.finished]).then(() => { if (st.officeOpen) done(); return true; }, () => false);
    });
    st.rafs.push(setTimeout(() => { if (st.officeOpen && off.classList.contains('is-igniting')) done(); }, 1600)); // safety net if a browser never finishes the animation
    return st.officeDone;
  }
  // Closes the back office; returns a promise that gives true when fully closed. The circle shrinks back to
  // the flame over 520 ms (150 ms fade for reduced motion). History is left to extinguish.
  // WATCH OUT: it marks the office closed first, closes sheets opened inside it, and starts the 2-minute
  //   PIN grace so coming straight back asks no PIN.
  function closeOffice() {
    if (!st.officeOpen) return st.officeDone;
    st.officeOpen = false;
    sheets.closeAll();
    st.shell.setAttribute('data-view', 'floor');
    st.unlockedUntil = Date.now() + GRACE_MS;
    const off = layers.office;
    resetFx();
    syncInert(); updateThemeColor();
    const opener = st.officeOpener;
    // Once closed: hide and empty the office, focus the flame that opened it, announce it.
    const finish = () => {
      resetFx(); off.hidden = true; unmountOfficeContent();
      syncInert();
      const t = (opener && opener.isConnected && opener) || (layers.floor.querySelector('[data-brand]')) || layers.floor;
      try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      ui.announce('Back on the line');
    };
    if (reduced() || typeof off.animate !== 'function') {
      const a = off.animate ? off.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear', fill: 'forwards' }) : null;
      st.officeDone = a ? a.finished.then(() => { if (!st.officeOpen) finish(); return true; }, () => true) : Promise.resolve(finish()).then(() => true);
      if (a) st.officeAnims.push(a);
      return st.officeDone;
    }
    // Full snuff-out: circle from full size back to nothing at the flame, with the ring and 5 wisps.
    const o = originPoint(), R0 = farthest(o.x, o.y) + 40;
    st.shell.classList.add('is-snuffing');
    off.classList.add('is-snuffing');
    const timing = { duration: 520, easing: 'cubic-bezier(0.55, 0, 0.45, 1)', fill: 'both' };
    const clip = off.animate([{ clipPath: `circle(${R0}px at ${o.x}px ${o.y}px)` }, { clipPath: `circle(0px at ${o.x}px ${o.y}px)` }], timing);
    const ring = h('div', { class: 'ember-ring' }); ring.style.setProperty('--ox', o.x + 'px'); ring.style.setProperty('--oy', o.y + 'px');
    st.fx.appendChild(ring);
    const ra = ring.animate([{ '--er': R0 + 'px', opacity: 0 }, { '--er': Math.round(R0 * 0.85) + 'px', opacity: 0.9, offset: 0.12 }, { '--er': '0px', opacity: 0.9 }], timing);
    addWisps(o, R0, 5, 0.7);
    st.officeAnims.push(clip, ra);
    st.officeDone = Promise.all([clip.finished, ra.finished]).then(() => { if (!st.officeOpen) finish(); return true; }, () => false);
    // Safety net: finish after 1.2 seconds even if the browser never ends the animation.
    st.rafs.push(setTimeout(() => { if (!st.officeOpen && !off.hidden) finish(); }, 1200));
    return st.officeDone;
  }

  // Opens the back office: PIN first if one is set, then a history entry and the ember ignition. o: {from:
  // flame button, section}. Returns a promise: true when open, false if cancelled or not mounted.
  S.ignite = function (o) {
    if (!st.mounted) return Promise.resolve(false);
    if (o && o.from && o.from.nodeType) st.lastBrand = o.from;
    if (st.officeOpen) return st.officeDone;
    const section = (o && SECTIONS.indexOf(o.section) >= 0 && o.section) || (R.view().kind === 'office' ? R.view().section : st.officeSection) || 'pace';
    return guard().then((ok) => {
      if (!ok) { if (R.view().kind === 'office') R.go(R.home(), { replace: true }); return false; }
      R.go({ kind: 'office', section });
      return openOffice(section);
    });
  };
  // Back to the board: reverse wipe, then history steps back (or the entry is replaced). False if not open.
  S.extinguish = function () {
    if (!st.mounted || !st.officeOpen) return Promise.resolve(false);
    const p = closeOffice();
    R.leaveOffice();
    return p;
  };

  // Router listener (also called once at mount). Office view: switch page if open, else PIN if needed, then
  // open. Floor view: show the station and close the office if open. Ignored before mount.
  // WATCH OUT: a cancelled PIN on a pasted office link replaces the address with the floor, so Back cannot
  //   return to a locked office.
  function onRoute(view) {
    if (!st.mounted) return;
    if (view.kind === 'guide') { openGuidePage(view.page); return; }
    closeGuidePage();
    if (view.kind === 'office') {
      if (st.officeOpen) { navigateOffice(view.section); return; }
      // After the PIN the route is read again: if it moved back to the floor while the keypad was up, the office stays shut.
      guard().then((ok) => { const now = R.view(); if (ok) { if (now.kind === 'office' && !st.officeOpen) openOffice(now.section); } else if (now.kind === 'office') R.go(R.home(), { replace: true }); });
    } else {
      const zone = view.kind === 'new' ? 'all' : view.zone;
      try { if (SB.floor && typeof SB.floor.setZone === 'function') SB.floor.setZone(zone); else if (st.ph && st.ph.floor) st.ph.floor.setZone(zone); } catch (e) { console.error('[smokebox] floor.setZone failed', e); }
      if (st.officeOpen) closeOffice();
      if (view.kind === 'new') openOrderPage(); else closeOrderPage();
    }
  }
  // Shows the Guide screen (SB.guide, 78-guide.js) in its own layer, or switches it to another page when it is
  // already open. The board and order layers are only hidden, so they come back exactly as they were.
  function openGuidePage(page) {
    if (st.guideOpen) { try { if (SB.guide) SB.guide.show(page); } catch (e) { console.error('[smokebox] guide page failed', e); } return; }
    if (!SB.guide || typeof SB.guide.mount !== 'function' || !layers.guide) {
      // The Guide file is missing: say so and go back, instead of showing an empty screen.
      try { ui.toast('The Guide did not load. Reload the page.', { tone: 'warn' }); } catch (e) { /* ignore */ }
      R.go(R.home(), { replace: true });
      return;
    }
    st.guideOpen = true;
    if (st.officeOpen) closeOffice();
    layers.floor.hidden = true; layers.order.hidden = true; layers.guide.hidden = false;
    try { SB.guide.mount(layers.guide, { page }); } catch (e) {
      console.error('[smokebox] guide failed to open', e);
      // A failed Guide gets an error card and a way back, never an empty screen with the board hidden behind it.
      try {
        U.clear(layers.guide);
        // Back to the board leaves the Guide address, which takes the failed Guide down.
        const back = h('button', { type: 'button', class: 'btn btn-primary', onClick: () => R.go(R.home(), { replace: true }) }, ico('chevron-left', 20), h('span', null, 'Back to the board'));
        layers.guide.append(ui.errorCard(e, { title: 'The Guide could not open', module: '78-guide.js' }), back);
        back.focus({ preventScroll: true });
      } catch (e2) { R.go(R.home(), { replace: true }); }
    }
  }
  // Takes the Guide down and shows the board (or the order page) again; does nothing if it was not open.
  function closeGuidePage() {
    if (!st.guideOpen) return;
    st.guideOpen = false;
    try { if (SB.guide && SB.guide.unmount) SB.guide.unmount(); } catch (e) { console.error('[smokebox] guide failed to close', e); }
    if (layers.guide) { U.clear(layers.guide); layers.guide.hidden = true; }
    if (st.orderOpen && layers.order) layers.order.hidden = false; else if (layers.floor) layers.floor.hidden = false;
    // Put keyboard focus back on the board so Tab continues from a sensible place.
    try { (st.orderOpen ? layers.order : layers.floor).focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ }
  }
  // Shows order entry for the front role. Uses the order page (SB.order.mount) once that exists; until then
  // it opens the New ticket sheet over the board.
  // WATCH OUT: SB.order.mount(el) must return nothing or a cleanup function; SB.order.unmount(el) is optional.
  function openOrderPage() {
    if (st.orderOpen) return;
    st.orderOpen = true;
    try {
      if (SB.order && typeof SB.order.mount === 'function' && layers.order) {
        layers.order.hidden = false; layers.floor.hidden = true;
        st.orderCleanup = SB.order.mount(layers.order) || null;
      } else if (sheets.open) sheets.open('order');
    } catch (e) {
      console.error('[smokebox] order page failed to open', e);
      // A failed order page falls back to the New ticket sheet over the board, so orders can still be taken.
      try {
        if (layers.order) { U.clear(layers.order); layers.order.hidden = true; }
        if (layers.floor) layers.floor.hidden = false;
        ui.toast('The order page did not load, so New ticket opens over the board instead. Reload the page to try again.', { tone: 'warn' });
        if (sheets.open) sheets.open('order');
      } catch (e2) { /* the toast above or the board is all that is left */ }
    }
  }
  // Takes the order page down and shows the board again; does nothing if it was not open.
  function closeOrderPage() {
    if (!st.orderOpen) return;
    st.orderOpen = false;
    try {
      if (typeof st.orderCleanup === 'function') st.orderCleanup();
      else if (SB.order && typeof SB.order.unmount === 'function' && layers.order) SB.order.unmount(layers.order);
    } catch (e) { console.error('[smokebox] order page failed to close', e); }
    st.orderCleanup = null;
    if (layers.order) { U.clear(layers.order); layers.order.hidden = true; }
    if (layers.floor) layers.floor.hidden = false;
  }

  /* ---------- banner: save failure and daily backup nudge ---------- */
  // Banner state: the strip element, the timer, and when the nudge was last put off with "Later".
  const bn = { el: null, timer: 0, snoozeUntil: 0, clockSnooze: 0, kind: '', text: '', sub: null };
  // Records that a backup was just made (called by the Data page), so tonight's nudge stays quiet.
  S.noteBackup = function (at) {
    const t = typeof at === 'number' ? at : Date.now();
    if (U) U.storage.set(KEY.lastBackup, t);
    paintBanner();
  };
  // When the last backup was made on this device (ms), or null if never.
  S.lastBackupAt = () => { const t = U ? U.storage.get(KEY.lastBackup, null) : null; return typeof t === 'number' ? t : null; };
  // Accepts the device's new time after the person says it is right, then refreshes the strip.
  function useNewTime() { SB.store.acceptClockJump(); paintBanner(); }
  // Keeps the old time and stays quiet about the jump for ten minutes.
  function keepOldTime() { bn.clockSnooze = Date.now() + 10 * 60000; paintBanner(); }
  // Works out which banner to show: a failed save first, else the daily backup nudge, else none.
  function bannerWanted() {
    const store = SB.store;
    if (!store || !store.status || !store.getState) return null;
    const ss = store.status(), s = store.getState();
    // In the demo this strip always shows, above every other message, and always has the Back button.
    if (store.isDemo && store.isDemo()) return { kind: 'demo', tone: 'warn', text: 'Demo: it runs by itself. Watch, or tap a dish to join in.', act: 'Back to my kitchen', onAct: () => store.leaveDemo() };
    // Signed in to the hosted server and the link has been down for a while: say so calmly; the board keeps working and catches up.
    const cs = SB.cloud && SB.cloud.on ? SB.cloud.status() : null;
    if (cs && !cs.connected && cs.downMs > 8000) return { kind: 'cloud', tone: 'warn', text: 'Not connected. Keep working: ' + (cs.waiting ? cs.waiting + ' change' + (cs.waiting === 1 ? '' : 's') + ' will' : 'changes will') + ' send when the internet is back.', act: 'Reload', onAct: () => g.location.reload() };
    if (ss.persistent === false) return { kind: 'save', tone: 'bad', text: 'This browser is not saving your work. If you close this page, today\'s tickets and batches are lost. Allow site data for this page, then back up now.', act: 'Back up now' };
    if (ss.lastSaveOk === false) return { kind: 'save', tone: 'bad', text: 'The last save failed, so recent changes may be lost. Free some space or allow site data for this page, then back up now.', act: 'Back up now' };
    // Off the board (a back-office page), a device clock that jumped far ahead is asked about here: a slim strip, not a box over the page.
    if (ss.clockSuspect && Date.now() >= (bn.clockSnooze || 0) && (R.view().kind === 'office' || !(SB.floor && SB.floor.isMounted && SB.floor.isMounted()))) {
      const dd = Math.round(ss.clockSuspect.aheadMs / 86400000);
      return { kind: 'clock', tone: 'warn', text: 'The clock jumped ahead by about ' + (dd >= 2 ? dd + ' days' : Math.round(ss.clockSuspect.aheadMs / 3600000) + ' hours') + '. Still on the old time.', act: 'Use the new time', onAct: useNewTime, later: true, laterLabel: 'Keep the old time', onLater: keepOldTime };
    }
    if (!s) return null;
    // With the hosted server the kitchen is kept there, so the daily "save a backup file" nudge is not needed.
    if (cs) return null;
    // Service is over only when nothing is left on the board and no order is still open.
    const openWork = s.tickets.filter((t) => t && t.status === 'active').length + (s.orders || []).filter((o) => o && o.status === 'open').length;
    const due = backupDue({ service: s.settings && s.settings.service, lastBackupAt: S.lastBackupAt(), snoozeUntil: bn.snoozeUntil, now: Date.now(), hasData: s.tickets.length + s.batches.length > 0, openWork, closedAt: s.lastClose && s.lastClose.at });
    return due ? { kind: 'nudge', tone: 'warn', text: 'Day is done: save today\'s backup.', act: 'Back up now', later: true } : null;
  }
  // Shows, updates or removes the strip at the top of the screen so a problem is seen from the kitchen board.
  function paintBanner() {
    if (!st.mounted || !st.shell) return;
    let w = null;
    try { w = bannerWanted(); } catch (e) { w = null; }
    if (!w) { if (bn.el) { bn.el.remove(); bn.el = null; bn.kind = ''; st.shell.removeAttribute('data-banner'); } return; }
    // The same kind with new words (the two save messages differ) is drawn again, so the text always matches its cause.
    if (bn.el && bn.kind === w.kind && bn.text === w.text) return;
    if (bn.el) bn.el.remove();
    bn.kind = w.kind; bn.text = w.text;
    // Opens the Data page of the back office, where the backup button is (it asks for the PIN if one is set).
    const act = h('button', { type: 'button', class: 'btn btn-sm', onClick: () => (w.onAct ? w.onAct() : S.ignite({ section: 'data' })) }, w.act);
    // Puts the nudge off for 45 minutes.
    const later = w.later ? h('button', { type: 'button', class: 'btn btn-sm btn-icon sb-banner-x', title: w.laterLabel || 'Hide for 45 minutes', onClick: () => { if (w.onLater) w.onLater(); else { bn.snoozeUntil = Date.now() + 45 * 60000; paintBanner(); } } }, ico('x', 18), h('span', { class: 'visually-hidden' }, w.laterLabel || 'Later')) : null;
    bn.el = h('div', { class: 'sb-banner', role: w.tone === 'bad' ? 'alert' : 'status', dataset: { tone: w.tone, kind: w.kind } }, ico(w.tone === 'bad' ? 'alert-circle' : w.kind === 'demo' ? 'play' : 'download', 20), h('span', { class: 'sb-banner-t', title: w.text }, w.text), act, later);
    st.shell.appendChild(bn.el);
    st.shell.setAttribute('data-banner', w.kind);
    st.shell.style.setProperty('--sb-banner-h', bn.el.offsetHeight + 'px'); // the layers start just below the strip
  }

  /* ---------- placeholders so the shell is testable alone ---------- */
  // Stand-in floor used when 70-floor-board.js is missing: tabs, menu, demo buttons. Lets the shell be
  // tested.
  function renderFloorPlaceholder(el) {
    U.clear(el);
    const label = h('span', { class: 'chip', dataset: { tone: 'info' } }, 'Station: All');
    const zones = [{ id: 'all', label: 'All' }].concat((SB.config && SB.config.zones || ZONES.map((z) => ({ id: z, name: z }))).map((z) => ({ id: z.id, label: z.code || z.id })));
    // Station tabs change the address through the router.
    const seg = ui.segmented({ options: zones, value: R.view().zone || 'all', label: 'Station', kind: 'tabs', onChange: (id) => R.go({ kind: 'floor', zone: id }) });
    // The button that flips between Day and Night.
    const themeBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Toggle Day and Night', onClick: () => T.toggle() }, ico('moon', 22));
    // Menu button with a small demo menu (checked items, a separator, one disabled danger item).
    const menuBtn = h('button', { type: 'button', class: 'btn', onClick: (e) => ui.menu(e.currentTarget, [
      { heading: 'Display' },
      // Night theme row flips Day/Night.
      { label: 'Night theme', icon: 'moon', checked: T.get() === 'night', onClick: () => T.toggle() },
      // Large text row flips the text size.
      { label: 'Large text', icon: 'sliders', checked: T.textSize() === 'large', onClick: () => T.setTextSize(T.textSize() === 'large' ? 'normal' : 'large') },
      { separator: true },
      // Reset station goes back to the whole floor.
      { label: 'Reset station', icon: 'refresh', onClick: () => R.go({ kind: 'floor', zone: 'all' }) },
      { label: 'Delete everything', icon: 'trash', danger: true, disabled: true },
    ], { label: 'Placeholder menu' }) }, ico('menu', 20), h('span', null, 'Menu'));
    const bar = h('div', { class: 'ph-bar' }, S.brand(), seg, label, h('span', { style: 'flex:1' }), themeBtn, menuBtn);
    // One button per sheet name; each tries to open that sheet.
    const sheetButtons = ['order', 'hold', 'board86', 'recall', 'demo', 'help', 'specs', 'menu'].map((n) => h('button', { type: 'button', class: 'btn btn-sm', onClick: () => sheets.open(n) }, n));
    const body = h('div', { class: 'ph' },
      h('div', { class: 'ph-note' },
        h('h2', null, 'Floor placeholder'),
        h('p', { class: 't-muted' }, 'The kitchen board did not load, so this stand-in panel is showing. Reload the page. Themes, sheets, the PIN and the back office still work from here.')),
      h('div', { class: 'row' },
        // Demo button: shows a plain toast message.
        h('button', { type: 'button', class: 'btn', onClick: () => ui.toast('Ticket #106 sent to 3 stations.', { tone: 'ok' }) }, 'Show a toast'),
        // Demo: a toast with an Undo button that shows a second toast.
        h('button', { type: 'button', class: 'btn', onClick: () => ui.toast('Ticket #104 bumped.', { tone: 'ok', undo: () => ui.toast('Undone.', { tone: 'info' }) }) }, 'Show an undo toast'),
        // Demo: a danger confirm; the answer is shown in a toast.
        h('button', { type: 'button', class: 'btn btn-danger', onClick: () => ui.confirm({ title: 'Void ticket #104?', body: 'The ticket leaves the board and is counted as voided. You can undo for 10 seconds.', confirmLabel: 'Void ticket', tone: 'danger' }).then((ok) => ui.toast(ok ? 'Confirmed.' : 'Cancelled.', { tone: 'info' })) }, 'Ask to confirm')),
      h('div', { class: 'row' }, h('span', { class: 't-muted' }, 'Open a sheet:'), sheetButtons));
    el.append(bar, body);
    st.ph = st.ph || {};
    // Lets the router tell the placeholder which station to show.
    st.ph.floor = { setZone: (z) => { label.textContent = 'Station: ' + (z === 'all' ? 'All' : z); seg.setValue(z); } };
    st.ph.floor.setZone(R.view().zone || 'all');
  }
  // Stand-in office used when the office files are missing: page buttons, Day/Night switch, way back.
  function renderOfficePlaceholder(el, section) {
    U.clear(el);
    const title = h('h2', null, 'Back office placeholder');
    const sec = h('p', { class: 't-muted' });
    // One button per office page; each goes to that page through the router.
    const nav = h('div', { class: 'row' }, SECTIONS.map((s) => h('button', { type: 'button', class: 'btn btn-sm', onClick: () => R.go({ kind: 'office', section: s }) }, s)));
    // Switches between Day and Night (the board and the back office share the look).
    const themeBtn = h('button', { type: 'button', class: 'btn btn-sm', onClick: () => T.toggle() }, ico('sun', 18), h('span', null, 'Switch Day and Night'));
    const back = h('button', { type: 'button', class: 'btn btn-primary', dataset: { backToLine: '' } }, ico('door', 22), h('span', null, 'Back to the board'));
    el.appendChild(h('div', { class: 'ph' }, h('div', { class: 'ph-note' }, title, h('p', { class: 't-muted' }, 'The back office pages did not load. Use Back to the board to leave, then reload the page.'), sec), nav, h('div', { class: 'row' }, themeBtn, back)));
    // Shows the name of the current office page.
    const setSection = (s) => { sec.textContent = 'Section: ' + s; };
    setSection(section);
    st.ph = st.ph || {}; st.ph.office = { setSection };
  }

  /* ---------- mount ---------- */
  // Builds the frame inside root (default #app): floor layer, dimming veil, hidden office layer, effects
  // layer, and containers for screen-reader messages, toasts and sheets. Mounts the floor board (or a
  // placeholder) and applies the current address, so a pasted office link opens the office. Mounting twice
  // unmounts first.
  S.mount = function (root) {
    if (st.mounted) S.unmount();
    root = root || doc.getElementById('app') || doc.body;
    T.init();
    R.init();
    st.root = root;
    // Build the layers in drawing order; region labels name the floor and office for screen readers.
    const shell = h('div', { class: 'sb-shell', dataset: { view: 'floor' } });
    const floor = h('div', { class: 'layer layer-floor', id: 'sb-floor', role: 'region', 'aria-label': 'Kitchen board', tabindex: -1 });
    const order = h('div', { class: 'layer layer-order', id: 'sb-order', role: 'region', 'aria-label': 'Order entry', tabindex: -1, hidden: true });
    const guide = h('div', { class: 'layer layer-guide', id: 'sb-guide', role: 'region', 'aria-label': 'Guide', tabindex: -1, hidden: true });
    const veil = h('div', { class: 'ignite-veil', 'aria-hidden': 'true' });
    const office = h('div', { class: 'layer layer-office office', id: 'sb-office', role: 'region', 'aria-label': 'Back office', tabindex: -1, hidden: true, dataset: { otheme: T.office() } });
    const fx = h('div', { class: 'ignite-fx', 'aria-hidden': 'true' });
    const live = h('div', { class: 'live-region', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const toastHost = h('div', { class: 'toast-host', role: 'region', 'aria-label': 'Notifications' });
    const sheetHost = h('div', { class: 'sheet-host' });
    shell.append(floor, order, guide, veil, office, fx, live, toastHost, sheetHost);
    root.appendChild(shell);
    // Swap the temporary containers (if any) for the real ones and record the new state.
    if (hosts.standalone) { hosts.standalone.remove(); hosts.standalone = null; }
    Object.assign(hosts, { shell, sheets: sheetHost, toasts: toastHost, live });
    layers.floor = floor; layers.office = office; layers.order = order; layers.guide = guide;
    Object.assign(st, { shell, veil, fx, mounted: true, orderOpen: false, guideOpen: false, orderCleanup: null, officeOpen: false, officeContent: false, ph: {}, taps: [] });
    st.offRoute = R.onChange(onRoute);
    // Floor board: if it throws, show an error card with Reload instead of a blank screen.
    try {
      if (SB.floor && typeof SB.floor.mount === 'function') SB.floor.mount(floor);
      else renderFloorPlaceholder(floor);
    } catch (e) {
      console.error('[smokebox] floor failed to mount', e);
      // Reload is the only way to retry the floor board.
      U.clear(floor); floor.appendChild(ui.errorCard(e, { title: 'The board could not load', module: '70-floor-board.js', onRetry: () => g.location.reload() }));
    }
    updateThemeColor();
    bn.el = null; bn.kind = '';
    paintBanner();
    clearInterval(bn.timer); bn.timer = setInterval(paintBanner, 5000); // the daily backup nudge comes due with the clock
    // A failed save (or its recovery) is announced by the store, so the red strip shows at once instead of on the next 5 s round.
    if (!bn.sub && SB.store && typeof SB.store.subscribe === 'function') bn.sub = SB.store.subscribe(paintBanner);
    const v = R.view();
    onRoute(v);
    return S;
  };
  // Takes the frame down: closes sheets, stops route listening, removes layers, dismisses toasts.
  S.unmount = function () {
    if (!st.mounted) return;
    closeGuidePage();
    closeOrderPage();
    clearInterval(bn.timer); bn.el = null; bn.kind = '';
    sheets.closeAll();
    if (st.offRoute) st.offRoute();
    resetFx();
    try { if (SB.floor && SB.floor.unmount) SB.floor.unmount(); } catch (e) { /* ignore */ }
    unmountOfficeContent();
    st.shell.remove();
    toasts.splice(0).forEach((r) => r.dismiss(true));
    Object.assign(hosts, { shell: null, sheets: null, toasts: null, live: null });
    layers.floor = layers.office = layers.order = layers.guide = null;
    st.mounted = false; st.officeOpen = false;
  };
  // Snapshot of shell and history state, for tests and debugging.
  S._state = () => ({ officeOpen: st.officeOpen, section: st.officeSection, mounted: st.mounted, unlockedUntil: st.unlockedUntil, historyIndex: R.index(), overlays: R.overlay.depth(), sheets: sheetStack.length });
})(typeof globalThis !== 'undefined' ? globalThis : window);
