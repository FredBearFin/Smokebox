/*
 * WHAT THIS FILE IS: The floor board, the screen the line works from: one paper slip per open ticket, the
 * station tabs, the header buttons and the all-day strip. Every tap goes to the store as an action.
 * PARTS: sound, mounting, page, store wiring, drawing, slips, rows, header, empty, actions, strip, keys.
 * USES / USED BY: uses SB.store, SB.engine, SB.ui, SB.icons, SB.config. Mounted by 60-shell.js; the help
 *   sheet reads F.shortcuts; the menu and Data pages call setSound and sound; sheets: 72-floor-sheets.js.
 * RULE: the page is built once, then changed in place by ticket id and item id (F-O1).
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const doc = g.document || null;
  const F = (SB.floor = {});

  // Keys the board answers to; the help sheet lists them. Keep in step with onKey.
  F.shortcuts = [
    { key: 'N', keys: ['N'], label: 'New ticket' },
    { key: 'O', keys: ['O'], label: 'Orders: open orders, add a round, take payment' },
    { key: 'R', keys: ['R'], label: 'Recall a bumped ticket' },
    { key: 'H', keys: ['H'], label: 'Hold cabinet' },
    { key: '8', keys: ['8'], label: '86 board' },
    { key: 'D', keys: ['D'], label: 'Demo' },
    { key: '1 to 6', keys: ['1', '2', '3', '4', '5', '6'], label: 'Station: All, PIT, HOT, FRY, CLD, EXP' },
    { key: 'Z', keys: ['Z'], label: 'Undo the last action (10 seconds)' },
    { key: '?', keys: ['?'], label: 'Help' },
    { key: 'Esc', keys: ['Esc'], label: 'Close a screen, or clear the all-day highlight' },
  ];
  // With no page (loaded under plain Node) every call does nothing, so loading never throws.
  if (!doc) { F.mount = F.unmount = F.setZone = F.highlight = F.setSound = () => {}; F.sound = () => false; return; }

  const h = U.h;
  const C = SB.config;
  // The rules engine (SB.engine), looked up on each call and never kept.
  const E = () => SB.engine;
  // Browser-storage keys: the sound switch, and whether the all-day strip is folded.
  const KEY_SOUND = 'smokebox.v1.sound';
  // Whether warnings are also spoken aloud (the tablet's own voice), on by default.
  const KEY_SPEECH = 'smokebox.v1.speech', KEY_VOLUME = 'smokebox.v1.volume';
  // Loudness of this tablet's warnings: 0.2 to 1. It never reaches 0 (the sound toggle is the way to silence); the last warning and the expiry tone never go below half.
  const VOL_MIN = 0.2;
  const KEY_DOCK = 'smokebox.v1.dock';
  // Whether the Call screen (two-tap tickets: Start, then Release) is the working view; on by default.
  const KEY_CALL = 'smokebox.v1.call';
  // Set to "done" once the welcome card has been dismissed.
  const KEY_WELCOME = 'smokebox.v1.welcome';
  // All, then every station, in the order of the number keys 1 to 6.
  const TABS = ['all'].concat(C.zones.map((z) => z.id));
  // Badge words, so the state is never shown by colour alone.
  const WORDS = { ok: 'On time', warn: 'Running late', breach: 'Overdue' };
  // Refusals that get a gentle note (already done and the like), not a warning.
  const QUIET = { alreadyDone: 1, alreadyFired: 1, nothingToDo: 1, undoNothing: 1 };
  // Reason chips on the void sheet; Other lets the cook type up to 40 characters.
  const VOID_REASONS = ['Wrong order', 'Customer left', 'Dropped', 'Other'];

  let m = null;          // the mounted instance
  let pendingZone = null;
  // Sound is on by default: a kitchen that misses a warning loses food. A browser still needs one tap to allow audio.
  let sound = U.storage.get(KEY_SOUND, true) !== false;
  let speech = U.storage.get(KEY_SPEECH, true) !== false;
  let callMode = U.storage.get(KEY_CALL, true) !== false;
  let audio = null, audioHooked = false, lastChime = 0, lastCheck = 0;
  let volume = (() => { const v = U.storage.get(KEY_VOLUME, 1); return U.isNum(v) ? Math.min(1, Math.max(VOL_MIN, v)) : 1; })();

  // Small helpers used by every part below.

  // Returns an icon element, or an empty span for an unknown name, so a bad name cannot break the board.
  function ico(name, size, o) {
    try { return SB.icons.svg(name, Object.assign({ size: size || 20 }, o || {})); } catch (e) { return doc.createElement('span'); }
  }
  // True when the person asked their device for less motion; animations are skipped then.
  const reduced = () => (U.prefersReducedMotion ? U.prefersReducedMotion() : false);
  // Milliseconds as minutes and seconds, for example 125000 gives 2:05. Never negative.
  const mss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + U.pad2(s % 60); };
  // Looks up a station (PIT, HOT and so on) by its id.
  const zoneById = (id) => C.zoneById[id];
  // Which layout a tab uses: all tickets, one station, or the expo (whole tickets with chips).
  const modeOf = (zone) => (zone === 'all' ? 'all' : zone === 'expo' ? 'expo' : 'station');
  // The store (everything the app knows right now), looked up on each call.
  const store = () => SB.store;
  // Shows a small message at the bottom; a failed toast never stops a tap.
  const toast = (msg, o) => { try { return SB.ui.toast(msg, o); } catch (e) { return null; } };
  // The current settings (alert times, undo window), or null before the store loads.
  const settingsNow = () => { const s = store().getState(); return s ? s.settings : null; };

  // Opens a named sheet (order, hold, 86...). A missing or broken sheet logs an error and nothing more.
  function openSheet(name) { try { if (SB.sheets) SB.sheets.open(name); } catch (e) { console.error('[smokebox] sheet failed', e); } }

  // Finds the biggest group of slips already in the right order (the longest increasing run) and
  // returns their positions. Those slips can stay put while the others move.
  function lisIndices(vals) {
    const n = vals.length, prev = new Array(n), tails = [];
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[tails[mid]] < vals[i]) lo = mid + 1; else hi = mid; }
      prev[i] = lo > 0 ? tails[lo - 1] : -1;
      tails[lo] = i;
    }
    const out = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.push(k);
    return out;
  }
  // Puts the nodes in the wanted order inside parent, moving as few as possible.
  // WATCH OUT: a moved node loses keyboard focus, so existing slips are never re-created.
  function reorder(parent, nodes) {
    const cur = new Map(); let i = 0;
    for (const c of parent.children) cur.set(c, i++);
    const idx = [], vals = [];
    nodes.forEach((n, k) => { if (cur.has(n)) { idx.push(k); vals.push(cur.get(n)); } });
    const stable = new Set(lisIndices(vals).map((j) => idx[j]));
    let next = null;
    for (let k = nodes.length - 1; k >= 0; k--) {
      const n = nodes[k];
      if (!stable.has(k)) parent.insertBefore(n, next);
      next = n;
    }
  }

  // Sound: an optional two-note chime for a new ticket, off until someone switches it on.

  // Creates the browser audio engine on first use. Returns null where audio does not exist.
  function ensureAudio() {
    if (audio) return audio;
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return null;
    try { audio = new AC(); } catch (e) { audio = null; }
    return audio;
  }
  // Wakes the audio engine if the browser put it to sleep (until the first tap). Returns it or null.
  function resumeAudio() { const a = ensureAudio(); if (a && a.state === 'suspended') { try { const p = a.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } } return a; }
  // Wakes the audio engine on the first tap or key press, so the first real chime can play.
  function hookAudioUnlock() {
    if (audioHooked) return;
    audioHooked = true;
    // Only wakes audio while sound is on, so a silent board never touches it.
    const unlock = () => { if (sound) resumeAudio(); };
    doc.addEventListener('pointerdown', unlock, true);
    doc.addEventListener('keydown', unlock, true);
  }
  // Plays one soft note: pitch in Hz, start and length in seconds, volume 0 to 1.
  function tone(a, freq, t, dur, vol0) {
    // The tablet's loudness setting scales every note; the loud warnings keep at least half of their own level.
    const vol = Math.max(0.0002, vol0 * (vol0 >= 0.3 ? Math.max(0.5, volume) : volume));
    const o = a.createOscillator(), gn = a.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  // Plays the two-note chime for a new ticket when sound is on.
  // WATCH OUT: calls within 600 ms of the last are dropped, so a burst of tickets makes one ding.
  function chime() {
    if (!audible()) return;
    const nowMs = performance.now();
    if (nowMs - lastChime < 600) return; // a burst of tickets is one ding, not twelve
    lastChime = nowMs;
    const a = resumeAudio();
    if (!a) return;
    try { const t0 = a.currentTime + 0.01; tone(a, 784, t0, 0.2, 0.16); tone(a, 1175, t0 + 0.15, 0.42, 0.16); } catch (e) { /* audio is optional */ }
  }
  // Plays three short high beeps when a dish's time is up (when sound is on). Several dishes at once make one set.
  function checkChime() {
    if (!audible()) return;
    const nowMs = performance.now();
    if (nowMs - lastCheck < 1500) return;
    lastCheck = nowMs;
    const a = resumeAudio();
    if (!a) return;
    try { const t0 = a.currentTime + 0.01; for (let i = 0; i < 3; i++) tone(a, 1320, t0 + i * 0.22, 0.14, 0.16); } catch (e) { /* audio is optional */ }
  }
  // Whether new tickets wait for the cook's Start tap and the Call screen is the working view.
  F.callMode = () => callMode;
  // Switches the Call screen on or off. Turning it off starts every ticket still waiting, so none is stranded
  // on the classic board, which has no Start button.
  F.setCallMode = function (on) {
    callMode = !!on;
    U.storage.set(KEY_CALL, callMode);
    if (!callMode) {
      for (const t of store().getState().tickets) if (t.status === 'active' && t.awaitStart) store().dispatchEx('startTicket', { ticketId: t.id }, { source: 'ui' });
      if (m && m.callOn) showCall(false);
    } else if (m && !m.cabOn) showCall(true);
    return callMode;
  };
  // Whether the chime is switched on.
  F.sound = () => sound;
  // Switches the chime on or off and remembers it; switching on plays one chime as a test.
  F.setSound = function (on) {
    sound = !!on;
    U.storage.set(KEY_SOUND, sound);
    if (sound) { hookAudioUnlock(); resumeAudio(); lastChime = 0; playHere(chime); }
    syncLeadership();
    return sound;
  };
  // This tablet's warning loudness, 0.2 to 1.
  F.volume = () => volume;
  // Sets and remembers the loudness (kept between 0.2 and 1) and plays a chime so it can be judged.
  F.setVolume = function (v) {
    volume = U.isNum(v) ? Math.min(1, Math.max(VOL_MIN, v)) : volume;
    U.storage.set(KEY_VOLUME, volume);
    if (sound) { hookAudioUnlock(); resumeAudio(); lastChime = 0; playHere(chime); }
    return volume;
  };
  // Tells whether warnings are spoken aloud right now.
  F.speech = () => speech;
  // Switches spoken warnings on or off and remembers it. Speech only plays while sound is on.
  F.setSpeech = function (on) {
    speech = !!on;
    U.storage.set(KEY_SPEECH, speech);
    if (speech && sound) playHere(() => speak('Spoken warnings are on.'));
    return speech;
  };
  // Says one short fixed phrase with the tablet's voice when sound and speech are both on. Never queues up: a new
  // phrase replaces an old one.
  function speak(text) {
    if (!audible() || !speech) return;
    try {
      const ss = g.speechSynthesis, U2 = g.SpeechSynthesisUtterance;
      if (!ss || !U2) return;
      ss.cancel();
      const u = new U2(text);
      u.rate = 0.95; u.volume = 1;
      ss.speak(u);
    } catch (e) { /* speech is optional */ }
  }
  // Plays the loud warning for the last minutes: three pairs of high and low notes, much louder than the chime.
  function alarmTone() {
    if (!audible()) return;
    const a = resumeAudio();
    if (!a) return;
    try { const t0 = a.currentTime + 0.01; for (let i = 0; i < 3; i++) { tone(a, 880, t0 + i * 0.5, 0.22, 0.4); tone(a, 1320, t0 + i * 0.5 + 0.24, 0.22, 0.4); } } catch (e) { /* audio is optional */ }
  }
  // Plays the falling three-note sound for a batch that has just expired and been thrown out.
  function expiryTone() {
    if (!audible()) return;
    const a = resumeAudio();
    if (!a) return;
    try { const t0 = a.currentTime + 0.01; tone(a, 660, t0, 0.35, 0.35); tone(a, 494, t0 + 0.3, 0.35, 0.35); tone(a, 330, t0 + 0.6, 0.7, 0.35); } catch (e) { /* audio is optional */ }
  }
  // True once the browser has let this page make sound (it needs one tap first).
  const audioReady = () => !!audio && audio.state === 'running';

  // Sound leader. With several tabs of this app open on one device, only one makes sound; the others still draw the
  // strip. The tab that holds a Web Lock named smokebox-sound is the leader (a tab that cannot make sound, because
  // its sound is off or the browser has not let it play yet, does not ask for the lock). Without Web Locks the tabs
  // send hellos and agree on a leader (visible tab first). Without a way to talk to other tabs every tab is its own
  // leader. A visible tab takes over from a hidden leader, since hidden tabs get slow timers.
  const LEAD_LOCK = 'smokebox-sound', HELLO_MS = 5000;
  const lead = { coordinated: false, isLeader: false, want: false, token: 0, release: null, abort: null, peers: new Map(), hello: 0, needDrain: false, forced: false, off: null };
  const pending = SB.deadlines.makePending();
  // What this tab knows about sound leadership (for tests and the office page): whether it leads and whether tabs coordinate.
  F.leader = () => ({ leader: isLeader(), coordinated: lead.coordinated, pending: pending.size() });
  // True when this tab should make sound now.
  const isLeader = () => lead.forced || !lead.coordinated || lead.isLeader;
  // The one question every sound function asks first: sound is on and this tab is the leader (or the sound is a local test).
  const audible = () => sound && isLeader();
  // Runs fn so that the sounds it makes play here whatever the leader is: a tap on "turn sound on" is a local test.
  function playHere(fn) { lead.forced = true; try { fn(); } finally { lead.forced = false; } }
  // A tab can lead when the board is showing, sound is on and the browser lets it play.
  const canLead = () => !!m && sound && audioReady();
  // Says to the other tabs whether this tab is visible, can lead, and leads.
  function sayHello() {
    if (SB.store && SB.store.broadcast) SB.store.broadcast({ type: 'alert-hello', visible: doc.visibilityState !== 'hidden', eligible: canLead(), lead: lead.isLeader });
  }
  // Records a change of leader (promotion means any sound held back is checked and played).
  function setLeader(on) {
    if (on === lead.isLeader) return;
    lead.isLeader = on;
    if (on) lead.needDrain = true;
    if (g.console && console.debug) console.debug('[smokebox] sound leader:', on ? 'this tab' : 'another tab');
    sayHello();
  }
  // Asks for the lock (steal: take it from a hidden leader). When it is lost or released the request is renewed while still wanted.
  function takeLock(steal) {
    lead.want = true;
    const token = ++lead.token;
    if (lead.abort) { try { lead.abort.abort(); } catch (e) { /* queued request only */ } }
    const ac = new g.AbortController(); lead.abort = ac;
    const opts = steal ? { steal: true } : { signal: ac.signal };
    g.navigator.locks.request(LEAD_LOCK, opts, () => new Promise((res) => { if (token !== lead.token) { res(); return; } lead.release = res; setLeader(true); }))
      .catch(() => {})
      .then(() => { if (token !== lead.token) return; lead.release = null; setLeader(false); if (lead.want && canLead()) takeLock(false); });
  }
  // Gives the lock up (sound turned off, or the board left).
  function dropLock() {
    lead.want = false; lead.token++;
    if (lead.release) { lead.release(); lead.release = null; }
    if (lead.abort) { try { lead.abort.abort(); } catch (e) { /* ignore */ } lead.abort = null; }
    setLeader(false);
  }
  // Keeps leadership in step with what this tab can do; cheap, called every tick.
  function syncLeadership() {
    if (!m || !SB.store || !SB.store.canBroadcast || !SB.store.canBroadcast()) { lead.coordinated = false; return; }
    lead.coordinated = true;
    const can = canLead();
    if (g.navigator && g.navigator.locks) {
      if (can && !lead.want) takeLock(false);
      else if (!can && lead.want) dropLock();
      else if (can && !lead.isLeader && doc.visibilityState !== 'hidden') {
        // A hidden leader is replaced by this visible tab.
        const hidden = Array.from(lead.peers.values()).some((p) => p.lead && !p.visible && Date.now() - p.t < 3 * HELLO_MS);
        if (hidden) takeLock(true);
      }
    } else if (can) {
      const hellos = [{ tab: SB.store.tabId, visible: doc.visibilityState !== 'hidden', eligible: true, t: Date.now() }];
      lead.peers.forEach((p, tab) => hellos.push({ tab, visible: p.visible, eligible: p.eligible, t: p.t }));
      setLeader(SB.deadlines.electLeader(hellos, Date.now(), SB.store.tabId));
    } else setLeader(false);
  }
  // Starts listening to the other tabs and sending hellos; returns a function that stops it all.
  function joinLeadership() {
    if (!SB.store || !SB.store.onBroadcast) return () => {};
    const off = SB.store.onBroadcast((d) => {
      if (d.type === 'alert-hello') { lead.peers.set(d.tab, { visible: !!d.visible, eligible: !!d.eligible, lead: !!d.lead, t: Date.now() }); syncLeadership(); }
      else if (d.type === 'alert-played') pending.played(d.keys);
      else if (d.type === 'alert-ack' && typeof d.id === 'string') { ladder.acknowledge(d.id); pending.forget(d.id); }
    });
    const timer = setInterval(() => { syncLeadership(); sayHello(); }, HELLO_MS);
    // When this tab is shown or hidden, work out leadership again and say so to the others.
    const onVis = () => { syncLeadership(); sayHello(); };
    doc.addEventListener('visibilitychange', onVis);
    syncLeadership(); sayHello();
    return () => { off(); clearInterval(timer); doc.removeEventListener('visibilitychange', onVis); dropLock(); lead.coordinated = false; lead.peers.clear(); };
  }

  // Screen wake lock: asks the browser to keep the screen on while the board is showing. Not every browser
  // allows it; F.wakeLock() says what happened.
  let wakeSentinel = null, wakeState = 'unknown';
  // Requests the wake lock now, and again whenever the page comes back to the front.
  function requestWake() {
    try {
      if (!g.navigator || !g.navigator.wakeLock) { wakeState = 'unsupported'; return; }
      g.navigator.wakeLock.request('screen').then((sn) => { wakeSentinel = sn; wakeState = 'on'; sn.addEventListener('release', () => { wakeState = 'released'; }); }, () => { wakeState = 'refused'; });
    } catch (e) { wakeState = 'refused'; }
  }
  // Reports the screen wake lock state: unknown, on, released, refused or unsupported.
  F.wakeLock = () => wakeState;

  // Mounting: the board is built once into the element the shell provides.

  // True while the board is on screen.
  F.isMounted = () => !!m;
  // The station tab now showing, or the one that will show once mounted.
  F.zone = () => (m ? m.zone : pendingZone || 'all');
  // The menu id of the all-day dish being highlighted, or null.
  F.highlighted = () => (m ? m.hl : null);
  // Counts and timings of the latest draw and tick; the tests read these.
  F.stats = () => (m ? Object.assign({ slips: m.slips.size }, m.stats) : null);

  // Builds the board inside el and starts listening to the store, the tick and the keyboard.
  // Replaces any earlier mount. The first tab comes from the router, or is All.
  F.mount = function (el) {
    if (m) F.unmount();
    if (!el) return;
    // A half-loaded build shows a plain message instead of a blank screen.
    if (!SB.store || !SB.ui || !SB.icons) {
      U.clear(el);
      el.appendChild(h('p', { class: 't-muted', style: 'padding:16px' }, 'The board needs the store, the icons and the UI kit. Reload the page.'));
      return;
    }
    const view = SB.router && SB.router.view ? SB.router.view() : { kind: 'floor', zone: 'all' };
    const zone0 = TABS.indexOf(pendingZone) >= 0 ? pendingZone : (view.kind === 'floor' && TABS.indexOf(view.zone) >= 0 ? view.zone : 'all');
    pendingZone = null;
    m = {
      el, zone: zone0, slips: new Map(), known: new Set(), first: true, hl: null, lastTap: new Map(),
      say: [], sayT: 0, thr: {}, thrSettings: null, counts: null, io: null, ro: null, offs: [], raf: 0,
      stats: { renders: 0, ticks: 0, lastRenderMs: 0, lastTickMs: 0, maxTickMs: 0, lastTickSlips: 0 },
      dockCollapsed: !!U.storage.get(KEY_DOCK, false), dockChips: new Map(), dockHover: false, quiet: true, narrow: false,
    };
    U.clear(el);
    buildDom();
    syncZoneUi();
    paintHints();
    m.offs.push(store().subscribe(onStore));
    m.offs.push(store().subscribeTick(onTick));
    doc.addEventListener('keydown', onKey);
    m.offs.push(() => doc.removeEventListener('keydown', onKey));
    // Keep the screen awake while the board shows, and ask again when the page returns to the front.
    requestWake();
    const onVis = () => { if (doc.visibilityState === 'visible') requestWake(); };
    doc.addEventListener('visibilitychange', onVis);
    m.offs.push(() => { doc.removeEventListener('visibilitychange', onVis); try { if (wakeSentinel) wakeSentinel.release(); } catch (e) { /* ignore */ } wakeSentinel = null; });
    if (sound) hookAudioUnlock();
    m.offs.push(joinLeadership());
    // Keep saved data safe from the browser's clean-up, and remind the owner to save the discard log.
    if (SB.discards) { SB.discards.persist(); setTimeout(() => { try { SB.discards.remind(); } catch (e) { /* optional */ } }, 4000); }
    if (SB.setup) setTimeout(() => { try { SB.setup.offer(); } catch (e) { /* optional */ } }, 8000);
    if (SB.sim && SB.sim.live && typeof SB.sim.live.onChange === 'function') {
      try { const off = SB.sim.live.onChange(() => { if (m) updateHeader(store().now()); }); if (typeof off === 'function') m.offs.push(off); } catch (e) { /* the simulator is optional */ }
    }
    if (SB.theme && SB.theme.onChange) { try { m.offs.push(SB.theme.onChange((what) => { if (m) { measureDock(); if (what === 'density' || what === 'text') paintDensity(); if (what === 'text') fitHead(); if (what === 'hints') paintHints(); } })); } catch (e) { /* ignore */ } }
    if (sound) hookAudioUnlock();
    render();
    updateHeader(store().now());
    measureDock();
    // The Call screen is the home view unless the address asked for a station.
    if (callMode && zone0 === 'all') showCall(true);
  };

  // Stops every listener, timer and observer and empties the element. Safe to call twice.
  F.unmount = function () {
    if (!m) return;
    const i = m;
    m = null;
    i.offs.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    clearTimeout(i.sayT);
    if (i.cab) { try { i.cab.destroy(); } catch (e) { /* ignore */ } }
    if (i.call) { try { i.call.destroy(); } catch (e) { /* ignore */ } }
    if (i.io) i.io.disconnect();
    if (i.ro) i.ro.disconnect();
    cancelAnimationFrame(i.raf);
    try { doc.documentElement.style.removeProperty('--fl-lift'); } catch (e) { /* ignore */ }
    U.clear(i.el);
  };

  // Switches to another station tab and announces the result. Called by the shell when the address changes.
  F.setZone = function (zone) {
    const z = TABS.indexOf(zone) >= 0 ? zone : 'all';
    if (!m) { pendingZone = z; return z; }
    if (m.cabOn) showCabinet(false);
    if (z === m.zone) return z;
    if (m.callOn) showCall(false);
    m.zone = z;
    clearBoard();
    syncZoneUi();
    // Count this redraw as the first, so slips do not print in or chime as if they were new.
    m.first = true;
    m.hl = null; paintHighlight();
    render();
    m.first = false;
    const n = m.slips.size, zn = z === 'all' ? 'All stations' : zoneById(z).name;
    say(zn + ': ' + (n ? n + ' ' + U.plural(n, 'ticket') : 'no tickets') + '.');
    return z;
  };

  // The page: header, slip area and all-day strip.

  // Builds the whole page once. WATCH OUT: nothing built here is replaced later; updates change
  // text and attributes only.
  function buildDom() {
    const root = h('div', { class: 'fl', dataset: { zone: m.zone, mode: modeOf(m.zone) } });
    m.root = root;
    // ----- header
    const brand = SB.shell && SB.shell.brand ? SB.shell.brand() : h('span', null, 'Smokebox');
    const tabOptions = TABS.map((id) => {
      if (id === 'all') return { id, label: 'All', icon: 'grid', iconSize: 20, count: 0, alert: false, alertLabel: 'has overdue tickets' };
      const z = zoneById(id);
      return { id, label: z.code, icon: z.icon, iconSize: 20, count: 0, alert: false, alertLabel: 'has overdue tickets' };
    });
    // The Cabinet tab is not a station: it swaps the tickets for the hold cabinet, on the same screen.
    tabOptions.push({ id: 'cabinet', label: 'Cabinet', icon: 'thermometer', iconSize: 20, count: 0, alert: false, alertLabel: 'needs attention' });
    // The Call tab is first: the instruction-first screen with Start and Release.
    tabOptions.unshift({ id: 'call', label: 'Call', icon: 'bell', iconSize: 20, count: 0, alert: false, alertLabel: 'has jobs to do' });
    const seg = SB.ui.segmented({ kind: 'tabs', label: 'Station', options: tabOptions, value: m.zone, onChange: goZone, class: 'fl-seg' });
    // Screen readers get the full station name and what the count means; the eye sees an icon and a code.
    TABS.forEach((id) => {
      const b = seg.querySelector('[data-id="' + id + '"]');
      if (!b) return;
      if (id !== 'all') b.dataset.zone = id;
      b.insertBefore(h('span', { class: 'visually-hidden' }, (id === 'all' ? 'All stations' : zoneById(id).long) + ', '), b.firstChild);
      b.appendChild(h('span', { class: 'visually-hidden' }, id === 'all' || id === 'expo' ? ' tickets' : ' tickets with work here'));
    });
    const tabs = h('div', { class: 'fl-tabs' }, seg);

    // The sanitize chip opens a menu to log a check; the demo chip opens the demo sheet.
    const sanChip = h('button', { type: 'button', class: 'chip fl-chip fl-san', dataset: { tone: 'info' }, onClick: (e) => sanitiseMenu(e.currentTarget) }, ico('shield-check', 18), h('span', { class: 'fl-chip-w' }, 'Sanitize'), h('span', { class: 'fl-chip-t' }, ''));
    const demoChip = h('button', { type: 'button', class: 'chip fl-chip fl-demo-chip', dataset: { tone: 'info' }, hidden: true, onClick: () => openSheet('demo') }, ico('fast-forward', 18), h('span', { class: 'fl-chip-t' }, 'Demo'));
    const status = h('div', { class: 'fl-status' }, sanChip, demoChip);

    // Builds one header button: icon, short label and count badge. Returns its parts for later updates.
    const tool = (id, icon, label, short, key, sheet) => {
      const n = h('span', { class: 'fl-tool-n num', hidden: true });
      const lab = h('span', { class: 'fl-tool-label' }, short);
      // A tool button opens its sheet; the key in brackets in the tooltip is the shortcut.
      const b = h('button', { type: 'button', class: 'btn fl-tool', dataset: { tool: id }, 'aria-keyshortcuts': key, onClick: () => (typeof sheet === 'function' ? sheet() : openSheet(sheet)) }, ico(icon, 24), lab, n);
      try { SB.ui.tooltip(b, label + ' (' + key + ')'); } catch (e) { /* ignore */ }
      return { b, n, lab, label };
    };
    const tRecall = tool('recall', 'history', 'Recall', 'Recall', 'R', 'recall');
    const tHold = tool('hold', 'thermometer', 'Hold cabinet', 'Hold', 'H', toggleCabinet);
    const t86 = tool('board86', 'ban', '86 board', '86', '8', 'board86');
    const tDemo = tool('demo', 'play', 'Demo', 'Demo', 'D', 'demo');
    // The Hold button is not in the header any more: the Cabinet tab next to the stations is that button, with its count.
    const tools = h('div', { class: 'fl-tools' }, tRecall.b, t86.b, tDemo.b);
    // Orders is a main button, not a tool: it stays in the header at every width, next to New ticket, because the counter
    // lives in it (open orders, add a round, take payment). The badge counts the orders still open.
    const tOrders = tool('orders', 'receipt', 'Open orders', 'Orders', 'O', 'orders');
    tOrders.b.classList.add('fl-orders'); tOrders.lab.classList.add('fl-orders-label');

    // New ticket opens the order sheet. Menu opens the full menu, or a short list on a narrow screen.
    const newBtn = h('button', { type: 'button', class: 'btn btn-primary fl-new', 'aria-keyshortcuts': 'N', onClick: () => openSheet('order') }, ico('plus', 26, { stroke: 2.5 }), h('span', null, 'New ticket'));
    const menuBtn = h('button', { type: 'button', class: 'btn fl-menu', 'aria-label': 'Menu', onClick: (e) => { if (mq('(max-width: 999px)') || headSqueezed()) quickMenu(e.currentTarget); else openSheet('menu'); } }, ico('menu', 22), h('span', { class: 'fl-menu-label' }, 'Menu'), h('span', { class: 'fl-menu-dot', hidden: true, 'aria-hidden': 'true' }));
    // Back office is a plain labeled button for managers: sales, speed, stock and the menu. It asks for the PIN when one is set.
    const officeBtn = h('button', { type: 'button', class: 'btn fl-tool fl-office', 'aria-label': 'Back office', 'aria-keyshortcuts': 'Control+Shift+O', onClick: (e) => openOffice(e.currentTarget) }, ico('gauge', 24), h('span', { class: 'fl-tool-label fl-office-label' }, 'Back office'));
    try { SB.ui.tooltip(officeBtn, 'Back office: sales, speed, stock and your menu'); } catch (e) { /* ignore */ }
    const brandBox = h('div', { class: 'fl-brand' }, brand);
    const spacer = h('div', { class: 'fl-spacer', 'aria-hidden': 'true' });
    const head = h('header', { class: 'fl-head' }, brandBox, tabs, spacer, status, tools, newBtn, tOrders.b, officeBtn, menuBtn);
    // The same parts in two orders; layoutHead picks one so keyboard order matches what the eye sees.
    m.headParts = { wide: [brandBox, tabs, spacer, status, tools, newBtn, tOrders.b, officeBtn, menuBtn], narrow: [brandBox, spacer, newBtn, tOrders.b, officeBtn, menuBtn, tabs, status, tools] };

    // ----- board
    const grid = h('div', { class: 'fl-grid' });
    const empty = h('div', { class: 'fl-empty', hidden: true });
    const welcome = buildWelcome();
    const cabEl = h('section', { class: 'fl-cabinet', hidden: true, 'aria-label': 'Hold cabinet' });
    const callEl = h('section', { class: 'fl-call', hidden: true, 'aria-label': 'Call screen: what to do now' });
    const main = h('main', { class: 'fl-main', id: 'fl-board', tabindex: -1, 'aria-label': 'Tickets' }, h('h1', { class: 'visually-hidden' }, 'Smokebox kitchen board'), welcome, grid, empty, cabEl, callEl);

    // ----- dock
    const dockToggle = h('button', { type: 'button', class: 'fl-dock-toggle', 'aria-expanded': 'true', 'aria-controls': 'fl-dock-list', onClick: toggleDock },
      ico('chevron-down', 20), h('span', { class: 'fl-dock-title' }, 'All day'), h('span', { class: 'fl-dock-sum num' }));
    // Clear highlight removes the all-day highlight.
    const dockClear = h('button', { type: 'button', class: 'btn fl-dock-clear', hidden: true, onClick: () => F.highlight(null) }, ico('x', 18), h('span', null, 'Clear highlight'));
    const dockList = h('div', { class: 'fl-dock-list', id: 'fl-dock-list', role: 'group', 'aria-label': 'Items still to make, tap one to highlight it on the board' });
    const dockEmpty = h('span', { class: 'fl-dock-empty' }, 'Nothing waiting.');
    const dock = h('footer', { class: 'fl-dock' }, dockToggle, dockClear, dockList, dockEmpty);
    // While a pointer is over the strip its chips stay put, see renderDock.
    dock.addEventListener('pointerenter', () => { m.dockHover = true; });
    dock.addEventListener('pointerleave', () => { m.dockHover = false; });

    // The attention strip sits under the header and lists the most urgent deadlines; it is hidden when nothing is due.
    const strip = buildStrip();
    root.append(head, strip.el, main, dock);
    const hlStyle = h('style', { class: 'fl-hl-style' });
    root.appendChild(hlStyle);
    m.el.appendChild(root);

    m.tabParts = {};
    TABS.forEach((id) => { const b = seg.querySelector('[data-id="' + id + '"]'); if (b) m.tabParts[id] = { count: b.querySelector('.seg-count'), n: -1 }; });
    m.sanText = sanChip.querySelector('.fl-chip-t');
    Object.assign(m, { head, seg, tabs, sanChip, demoChip, status, tools, tool: { recall: tRecall, hold: tHold, board86: t86, demo: tDemo, orders: tOrders }, newBtn, officeBtn, menuBtn, strip, main, cabEl, callEl, grid, empty, dock, dockToggle, dockClear, dockList, dockEmpty, hlStyle });

    grid.addEventListener('click', onGridClick);
    dockList.addEventListener('click', (e) => {
      const b = e.target.closest('.fl-dchip');
      if (!b || !dockList.contains(b)) return;
      F.highlight(m.hl === b.dataset.menu ? null : b.dataset.menu);
    });
    // slips off screen stop animating (a pulsing border on 30 overdue slips is a lot of repaint)
    if (typeof IntersectionObserver === 'function') {
      m.io = new IntersectionObserver((entries) => { entries.forEach((en) => en.target.classList.toggle('is-off', !en.isIntersecting)); }, { root: main, rootMargin: '120px' });
    }
    if (typeof ResizeObserver === 'function') { m.ro = new ResizeObserver(() => { measureDock(); paintDensity(); fitHead(); }); m.ro.observe(dock); m.ro.observe(main); }
    paintDockToggle();
    layoutHead(true);
    fitHead();
    try {
      const q = g.matchMedia('(max-width: 900px)');
      // Re-orders the header when the screen crosses the phone breakpoint, then squeezes it to fit.
      const fn = () => { layoutHead(false); fitHead(); };
      if (q.addEventListener) { q.addEventListener('change', fn); m.offs.push(() => q.removeEventListener('change', fn)); }
    } catch (e) { /* ignore */ }
  }

  // Tests a CSS media query; false where matchMedia is missing.
  const mq = (q) => { try { return g.matchMedia(q).matches; } catch (e) { return false; } };
  // Orders the header parts for the current width (on a phone the tabs wrap under the buttons).
  // WATCH OUT: the DOM order is changed to match, so keyboard order follows the eye. Focus is restored.
  function layoutHead(force) {
    if (!m || !m.headParts) return;
    const narrow = mq('(max-width: 900px)');
    if (!force && narrow === m.narrow) return;
    m.narrow = narrow;
    const a = doc.activeElement;
    const keepFocus = a && m.head.contains(a) ? a : null;
    (narrow ? m.headParts.narrow : m.headParts.wide).forEach((n) => m.head.appendChild(n));
    if (keepFocus && keepFocus.isConnected && doc.activeElement !== keepFocus) { try { keepFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  // True when the header has broken onto a second row: some visible part sits well below the first one.
  function headWrapped() {
    let lo = Infinity, hi = -Infinity;
    for (const n of m.head.children) {
      if (!n.offsetWidth || !n.offsetHeight) continue; // hidden parts and the empty spacer do not count
      lo = Math.min(lo, n.offsetTop); hi = Math.max(hi, n.offsetTop);
    }
    return hi - lo > 24;
  }
  // A short fingerprint of what decides the header's fit: its width and the length of the chip text.
  const headKey = () => [m.head.clientWidth, m.sanText.textContent.length, m.demoChip.hidden ? 0 : m.demoChip.textContent.length].join(':');
  // Squeezes the header step by step until it fits on one row: first the tab icons go, then the status chips, then the
  // tool buttons. Everything that goes is still in the Menu list.
  // WATCH OUT: it always starts again from the full header, so a wider window gets everything back.
  function fitHead() {
    if (!m || !m.head) return;
    const hd = m.head;
    delete hd.dataset.fit;
    if (!m.narrow) {
      for (const stage of ['icons', 'status', 'labels', 'toollabels', 'tools']) {
        if (!headWrapped()) break;
        hd.dataset.fit = stage;
      }
    }
    m.fitKey = headKey();
  }
  // Runs every second: refits the header only when its width or chip text changed, so most ticks cost nothing.
  function refit() {
    if (m && m.head && headKey() !== m.fitKey) fitHead();
    measureToastTop();
  }
  // True when the header has moved the status chips or tool buttons into the Menu list.
  const headSqueezed = () => !!m.head && (m.head.dataset.fit === 'status' || m.head.dataset.fit === 'labels' || m.head.dataset.fit === 'toollabels' || m.head.dataset.fit === 'tools');
  // In the cabinet view toasts move to the top right, under the header and the attention strip, so they never cover a card's buttons.
  // This tells the stylesheet where the page below the strip starts (--fl-toast-top).
  function measureToastTop() {
    if (!m || !m.main || !m.cabOn) return;
    doc.documentElement.style.setProperty('--fl-toast-top', Math.round(m.main.getBoundingClientRect().top + 8) + 'px');
  }
  // Tells the stylesheet how tall the all-day strip is (--fl-lift) so toasts sit above it.
  function measureDock() {
    if (!m) return;
    const hgt = m.dock.hidden ? 0 : Math.round(m.dock.getBoundingClientRect().height);
    doc.documentElement.style.setProperty('--fl-lift', hgt + 'px');
  }
  // Folds or unfolds the all-day strip and remembers the choice.
  function toggleDock() {
    m.dockCollapsed = !m.dockCollapsed;
    U.storage.set(KEY_DOCK, m.dockCollapsed);
    paintDockToggle();
    measureDock();
  }
  // Syncs the strip attributes and the toggle label with its folded state.
  function paintDockToggle() {
    m.dock.dataset.collapsed = m.dockCollapsed ? 'true' : 'false';
    m.dockToggle.setAttribute('aria-expanded', m.dockCollapsed ? 'false' : 'true');
    dockName();
  }
  // Names the dock button from the words on it (title and count), then what pressing it does.
  function dockName() {
    const t = m.dockToggle.querySelector('.fl-dock-title').textContent, s = m.dockToggle.querySelector('.fl-dock-sum').textContent;
    m.dockToggle.setAttribute('aria-label', (t + ' ' + s).trim() + ', ' + (m.dockCollapsed ? 'show' : 'hide') + ' the list');
  }
  // Updates what depends on the current tab: tab highlight, area label and strip title.
  function syncZoneUi() {
    m.root.dataset.zone = m.zone;
    m.root.dataset.mode = modeOf(m.zone);
    m.seg.setValue(m.zone);
    m.main.setAttribute('aria-label', m.zone === 'all' ? 'Tickets for all stations' : 'Tickets for ' + zoneById(m.zone).name);
    const title = m.dockToggle.querySelector('.fl-dock-title');
    title.textContent = m.zone === 'all' || m.zone === 'expo' ? 'All day' : 'All day, ' + zoneById(m.zone).name;
    dockName();
  }
  // Shows the hold cabinet in the page in place of the tickets (on), or goes back to the tickets (off). The strip and
  // header stay. opts.batchId scrolls to one batch. Opened from the Cabinet tab, the Hold button, H and the strip rows.
  function showCabinet(on, opts) {
    if (!m || !SB.hold) { if (on) openSheet('hold'); return; }
    if (on) {
      if (!m.cab) m.cab = SB.hold.mount(m.cabEl, opts && opts.tab ? { tab: opts.tab } : {});
      else if (opts && opts.batchId) m.cab.highlight(opts.batchId);
      if (opts && opts.batchId && m.cab && !m.cabOn) m.cab.highlight(opts.batchId);
    } else if (m.cab) { m.cab.destroy(); m.cab = null; }
    m.cabOn = !!on;
    m.root.dataset.cabinet = on ? 'on' : 'off';
    doc.documentElement.dataset.cabinet = on ? 'on' : 'off';
    measureToastTop();
    for (const el of [m.grid, m.empty, m.welcome, m.dock]) if (el) el.style.display = on ? 'none' : '';
    setHidden(m.cabEl, !on);
    m.seg.setValue(on ? 'cabinet' : m.zone);
    m.main.setAttribute('aria-label', on ? 'Hold cabinet' : m.zone === 'all' ? 'Tickets for all stations' : 'Tickets for ' + zoneById(m.zone).name);
    if (!on) { m.dock.hidden = false; measureDock(); if (callMode && !m.callOn) { showCall(true); return; } }
    if (on) { const lift = doc.documentElement.style; lift.setProperty('--fl-lift', '0px'); }
  }
  // Shows the Call screen in place of the classic ticket slips (on), or goes back to the slips (off). The strip
  // and header stay. WATCH OUT: it leaves the slips hidden while the cabinet is open.
  function showCall(on) {
    if (!m || !SB.caller) return;
    if (on && m.cabOn) showCabinet(false);
    if (on && !m.call) {
      // The Call screen borrows the board's sound, voice and tap helpers through these hooks.
      const hooks = {};
      // Plays the soft two-note chime for a new ticket.
      hooks.chime = () => chime();
      // Plays the three short beeps for an item to put on.
      hooks.ding = () => checkChime();
      // Says one short phrase with the tablet's voice.
      hooks.speak = (txt) => speak(txt);
      // Sends one action to the store, with the board's toast and undo handling.
      hooks.run = (type, payload) => run(type, payload);
      // Opens the three-dot menu for one ticket.
      hooks.more = (id, anchor) => moreMenu({ id }, anchor);
      m.call = SB.caller.mount(m.callEl, hooks);
    } else if (!on && m.call) { m.call.destroy(); m.call = null; }
    m.callOn = !!on;
    m.root.dataset.call = on ? 'on' : 'off';
    for (const el of [m.grid, m.empty, m.welcome, m.dock]) if (el) el.style.display = on || m.cabOn ? 'none' : '';
    setHidden(m.callEl, !on);
    m.seg.setValue(on ? 'call' : m.cabOn ? 'cabinet' : m.zone);
    m.main.setAttribute('aria-label', on ? 'Call screen' : m.zone === 'all' ? 'Tickets for all stations' : 'Tickets for ' + zoneById(m.zone).name);
    if (on) doc.documentElement.style.setProperty('--fl-lift', '0px'); else measureDock();
  }
  // Switches between the tickets and the cabinet (the Hold button and the H key).
  function toggleCabinet() { showCabinet(!(m && m.cabOn)); }
  // Called when a tab is chosen: asks the router to change the address (so Back works), then switches.
  function goZone(id) {
    if (id === 'call') { showCall(true); return; }
    if (id === 'cabinet') { if (m && m.callOn) showCall(false); showCabinet(true); return; }
    if (m && m.callOn) showCall(false);
    if (m && m.cabOn) showCabinet(false);
    if (SB.router && SB.router.go) { try { SB.router.go({ kind: 'floor', zone: id }); } catch (e) { /* fall through */ } }
    if (m && m.zone !== id) F.setZone(id);
  }

  // Store wiring: redraw on data changes, update clocks on the tick.

  // Called by the store after data changes (already merged to one call per frame).
  function onStore() { if (m) render(); }

  // Runs once a second. Rewrites only timer text, level colours, countdowns and header counters.
  // WATCH OUT: it must never add or remove a node (F-O1), or a tap could land on one that is vanishing.
  function onTick(now) {
    if (!m) return;
    const t0 = performance.now();
    const grace = !m.first;
    for (const rec of m.slips.values()) {
      paintTime(rec, now, grace);
      for (let i = 0; i < rec.timed.length; i++) tickRow(rec.timed[i], now);
      if (rec.timed.length) paintNext(rec, now);
    }
    updateHeader(now);
    const dt = performance.now() - t0;
    const s = m.stats;
    s.ticks++; s.lastTickMs = dt; s.lastTickSlips = m.slips.size;
    if (dt > s.maxTickMs) s.maxTickMs = dt;
  }

  // Queues a message for screen readers. Messages that arrive within 2.5 s are joined (the first four, then a count)
  // so one calm sentence is heard, never one per second.
  function say(msg) {
    if (!m) return;
    m.say.push(msg);
    if (m.sayT) return;
    m.sayT = setTimeout(() => {
      if (!m) return;
      m.sayT = 0;
      const all = m.say.splice(0);
      const text = all.slice(0, 4).join(' ') + (all.length > 4 ? ' And ' + (all.length - 4) + ' more updates.' : '');
      if (text) { try { SB.ui.announce(text); } catch (e) { /* ignore */ } }
    }, 2500);
  }

  // Drawing: compare the open tickets with the slips on screen and change only what differs.

  // Warn and overdue times in ms for one channel (dine-in and so on), cached until settings change.
  function thresholds(channel) {
    const st = settingsNow();
    if (m.thrSettings !== st) { m.thrSettings = st; m.thr = {}; }
    let t = m.thr[channel];
    if (!t) { const th = E().channelThresholds(st, channel); t = m.thr[channel] = { warnMs: th.warnSec * 1000, breachMs: th.breachSec * 1000 }; }
    return t;
  }

  // Remembers which slip, row and button has keyboard focus, to restore it after a redraw.
  function focusKey() {
    const a = doc.activeElement;
    if (!a || a === doc.body || !m.root.contains(a)) return null;
    const slip = a.closest('.fl-slip');
    if (!slip) return null;
    const row = a.closest('.fl-row');
    const rec = m.slips.get(slip.dataset.ticket);
    return {
      t: slip.dataset.ticket, i: row ? row.dataset.item : null, a: a.dataset.act || null,
      rowIdx: row && rec ? Array.prototype.indexOf.call(rec.refs.list.children, row) : -1,
      slipIdx: Array.prototype.indexOf.call(m.grid.children, slip),
    };
  }
  // The first usable action button inside an element, or null.
  function firstFocusable(root) { return root ? root.querySelector('button[data-act]:not([disabled]):not([hidden])') : null; }
  // Puts focus back after a redraw if it was lost: same row, then the next or previous actionable row,
  // then the slip buttons, then the neighbouring slip. WATCH OUT: a leaving slip is inert, never a target.
  function restoreFocus(k) {
    const a = doc.activeElement;
    if (a && a !== doc.body && m.root.contains(a) && a.isConnected && !a.closest('[inert],.fl-leaving')) return; // focus is somewhere valid: leave it
    const rec = m.slips.get(k.t);
    let target = null;
    if (rec && rec.el.isConnected) {
      const rows = Array.from(rec.refs.list.children);
      const row = k.i ? rec.rows.get(k.i) : null;
      if (row) target = row.li.querySelector('button[data-act="item"],button[data-act="fire"]');
      if (!target && k.i) { // the row is gone or became read-only: next actionable row, then the one before, then the slip's buttons
        for (let j = Math.max(0, k.rowIdx); j < rows.length && !target; j++) target = rows[j].querySelector('button[data-act="item"],button[data-act="fire"]');
        for (let j = Math.min(rows.length - 1, k.rowIdx - 1); j >= 0 && !target; j--) target = rows[j].querySelector('button[data-act="item"],button[data-act="fire"]');
      }
      if (!target && k.a && !k.i) target = rec.el.querySelector('button[data-act="' + k.a + '"]:not([hidden])');
      if (!target) target = firstFocusable(rec.el.querySelector('.slip-foot'));
    }
    if (!target) { // the whole slip left: its neighbour takes over
      const kids = Array.from(m.grid.children).filter((c) => !c.classList.contains('fl-leaving'));
      const near = kids[Math.min(Math.max(k.slipIdx, 0), kids.length - 1)];
      target = near ? firstFocusable(near) : null;
    }
    if (!target) target = m.main;
    try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  // Draws the board from the store: adds new slips, updates changed ones, removes finished ones, orders
  // them, then refreshes the empty state, strip and header. Cheap when nothing changed (same objects).
  function render() {
    if (!m) return;
    const t0 = performance.now();
    const S = store();
    const state = S.getState();
    if (!state) return;
    const now = S.now();
    const zone = m.zone, mode = modeOf(zone);
    const fk = focusKey();

    // new-ticket detection works on the whole board, whatever station is showing
    const active = S.select.activeTickets();
    const fresh = [];
    for (const t of active) if (!m.known.has(t.id)) fresh.push(t);
    if (fresh.length || m.known.size !== active.length) m.known = new Set(active.map((t) => t.id));

    // The store returns tickets already ordered: rush first, then oldest.
    const list = S.select.ticketsForZone(zone);
    paintDensity(list.length);
    const want = [], seen = new Set(), added = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      seen.add(t.id);
      let rec = m.slips.get(t.id);
      if (!rec) { rec = buildSlip(t, mode, now); m.slips.set(t.id, rec); added.push(rec); } else syncSlip(rec, t, now);
      want.push(rec);
    }
    for (const rec of Array.from(m.slips.values())) if (!seen.has(rec.id)) removeSlip(rec);
    reorder(m.grid, want.map((r) => r.el));
    // Slips present at the first draw just appear; later arrivals print in.
    if (!m.first && added.length) added.forEach((rec, i) => printIn(rec, i));
    else added.forEach((rec) => { if (m.io) m.io.observe(rec.el); });
    m.first = false;

    // empty state
    const empty = m.slips.size === 0;
    m.grid.hidden = empty;
    m.empty.hidden = !empty;
    if (empty) paintEmpty(S.select.counts());
    m.dock.hidden = empty;
    paintWelcome();

    renderDock(state);
    updateHeader(now);
    if (m.hl && !hlAlive()) F.highlight(null);
    if (fk) restoreFocus(fk);

    // Chime and speak only for tickets that just arrived, not for recalls or undo (old tickets coming
    // back).
    const brandNew = fresh.filter((t) => now - t.createdAt < 5000);
    if (!m.quiet && brandNew.length) {
      chime();
      say(brandNew.length === 1 ? 'Ticket #' + brandNew[0].num + ' added for ' + brandNew[0].customer + '.' : brandNew.length + ' new tickets.');
    }
    m.quiet = false; // the first render after mount is silent
    m.stats.renders++;
    m.stats.lastRenderMs = performance.now() - t0;
  }

  // How many full-size tickets fit side by side (a full-size ticket is at least 288 px wide).
  function fullCols() {
    const cs = g.getComputedStyle(m.root);
    const k = parseFloat(cs.getPropertyValue('--fl-k')) || 1, tl = parseFloat(cs.getPropertyValue('--fl-tl')) || 1;
    const gap = 20 * k, w = m.main.clientWidth - 2 * gap;
    return Math.max(1, Math.floor((w + gap) / (288 * k * tl + gap)));
  }

  // Draws tickets full size while they fit in one row, and compact once they would not, so a rush stays on
  // one screen. It goes back to full size only one ticket below the limit, so the layout does not flip.
  function paintDensity(n) {
    if (!m || !m.main) return;
    if (n != null) m.n = n;
    const pref = SB.theme && SB.theme.density ? SB.theme.density() : 'auto';
    let d = pref === 'compact' ? 'compact' : 'roomy';
    if (pref === 'auto') { const cols = fullCols(); d = m.n > cols || (m.dens === 'compact' && m.n > cols - 1) ? 'compact' : 'roomy'; }
    m.dens = d;
    if (m.main.dataset.density !== d) m.main.dataset.density = d;
  }

  // Removes every slip at once, for tab switches where a slide-out would be noise.
  function clearBoard() {
    for (const rec of m.slips.values()) { if (m.io) m.io.unobserve(rec.el); rec.el.remove(); }
    m.slips.clear();
    U.clear(m.grid);
  }

  // Plays the print-in animation for a slip that arrives while the board is open (staggered for the first
  // ten).
  function printIn(rec, i) {
    if (m.io) m.io.observe(rec.el);
    if (reduced() || !m.root.isConnected) return;
    const el = rec.el;
    el.style.setProperty('--fl-d', Math.min(i, 9) * 55 + 'ms');
    el.classList.add('is-printing');
    // Removes the animation hooks once it has finished.
    const done = () => { el.classList.remove('is-printing'); el.style.removeProperty('--fl-d'); };
    el.addEventListener('animationend', (e) => { if (e.target === el) done(); });
    // Backup in case animationend never fires, for example in a hidden tab.
    setTimeout(done, 900 + Math.min(i, 9) * 55);
  }

  // Takes a finished slip off the board: it slides out (inert, so no tap lands on it), or goes at once
  // with reduced motion.
  function removeSlip(rec) {
    m.slips.delete(rec.id);
    if (m.io) m.io.unobserve(rec.el);
    const el = rec.el;
    if (reduced() || !m.root.isConnected) { el.remove(); return; }
    el.classList.remove('is-printing');
    el.classList.add('fl-leaving');
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
    // Deletes the node when the slide-out ends.
    const done = () => el.remove();
    el.addEventListener('animationend', (e) => { if (e.target === el) done(); });
    // Same backup removal if animationend never comes.
    setTimeout(done, 420);
  }

  // Slips: one paper ticket per order, built once and then patched.

  // Builds the status badge (icon plus a word). Returns the element and its word node.
  function buildBadge() {
    const icons = h('span', { class: 'fl-bi', 'aria-hidden': 'true' }, ico('check-circle', 18, { class: 'bi-ok' }), ico('clock', 18, { class: 'bi-warn' }), ico('alert', 18, { class: 'bi-breach' }));
    const word = h('span', { class: 'fl-bw' }, WORDS.ok);
    return { el: h('span', { class: 'badge fl-badge', dataset: { level: 'ok' } }, icons, word), word };
  }

  // Builds the DOM for one ticket slip and the record the board keeps for it.
  function buildSlip(t, mode, now) {
    const uid = 'fl-' + String(t.id).replace(/[^\w-]/g, '_');
    const zone = mode === 'station' ? m.zone : null;
    const num = h('span', { class: 'slip-num num', id: uid + '-n' }, h('span', { class: 'visually-hidden' }, 'Ticket '), '#' + t.num);
    const stampSlot = h('span', { class: 'fl-stamp-slot' });
    const who = h('span', { class: 'slip-who', id: uid + '-w' }, t.customer);
    const ch = C.channelById[t.channel] || { name: String(t.channel), icon: 'plate' };
    const count = h('span', { class: 'fl-count' });
    const meta = h('div', { class: 'slip-meta' }, h('span', { class: 'fl-chan' }, ico(ch.icon, 18), h('span', null, ch.name)), count,
      t.src === 'demo' ? h('span', { class: 'fl-demo-tag', title: 'Demo ticket: made by the demo, not a real order' }, 'Demo', h('span', { class: 'dt-more' }, ' ticket')) : null);
    const timer = h('span', { class: 'slip-timer num', dataset: { level: 'ok' } }, '00:00');
    const badge = buildBadge();
    const progI = h('i');
    const prog = h('div', { class: 'slip-progress', role: 'progressbar', 'aria-label': 'Progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, progI);
    const head = h('div', { class: 'slip-head' }, h('div', { class: 'slip-id' }, h('div', { class: 'fl-numrow' }, num, stampSlot), who, meta), h('div', { class: 'slip-time' }, timer, badge.el), prog);
    const note = t.note ? h('div', { class: 'slip-note', role: 'note' }, ico('alert', 22), h('span', null, h('span', { class: 'visually-hidden' }, 'Note: '), t.note)) : null;
    const list = h('ul', { class: 'fl-items' });
    const nextT = h('span', { class: 'sn-t' });
    const next = h('div', { class: 'slip-next', hidden: true, dataset: { tone: 'wait' } }, ico('arrow-right', 18), nextT);
    const zoneBtn = h('button', { type: 'button', class: 'btn fl-zone', dataset: { act: 'zone' } }, ico('check-circle', 22), h('span', null, 'All done here'));
    const bumpBtn = h('button', { type: 'button', class: 'btn fl-bump', dataset: { act: 'bump' } }, ico('check', 22), h('span', null, 'Bump'));
    const moreBtn = h('button', { type: 'button', class: 'btn btn-icon fl-more', 'aria-label': 'More for ticket #' + t.num, dataset: { act: 'more' } }, ico('more', 22));
    const foot = h('div', { class: 'slip-foot' }, mode === 'station' ? zoneBtn : bumpBtn, moreBtn);
    const body = h('div', { class: 'slip-body' }, note, next, list, foot);
    // The slip is named for screen readers by its number and customer.
    const el = h('section', { class: 'slip fl-slip', dataset: { ticket: t.id, level: 'ok', rush: 'false', ready: 'false' }, 'aria-labelledby': uid + '-n ' + uid + '-w' },
      h('span', { class: 'slip-clip', 'aria-hidden': 'true' }), head, body, h('div', { class: 'slip-tear', 'aria-hidden': 'true' }));
    if (m.io) el.classList.add('is-off'); // starts without its shadow; the observer lifts this when the slip is on screen
    const rec = {
      id: t.id, num: t.num, el, mode, zone, createdAt: t.createdAt, channel: t.channel, customer: t.customer,
      itemsRef: null, rush: undefined, rows: new Map(), timed: [], level: null, timerText: '', countText: '', ready: null, nextText: '', nextTone: '',
      refs: { num, stampSlot, stamp: null, count, timer, badge: badge.el, bw: badge.word, prog, progI, list, foot, zoneBtn, bumpBtn, moreBtn, next, nextT },
    };
    syncSlip(rec, t, now);
    paintTime(rec, now, false);
    paintNext(rec, now);
    return rec;
  }

  // Shows or hides the red RUSH stamp and sets the flag the stylesheet uses for the rush bar.
  function setRushStamp(rec, on) {
    const r = rec.refs;
    if (on && !r.stamp) { r.stamp = h('span', { class: 'stamp' }, 'Rush'); r.stampSlot.appendChild(r.stamp); }
    else if (!on && r.stamp) { r.stamp.remove(); r.stamp = null; }
    rec.el.dataset.rush = on ? 'true' : 'false';
  }

  // Brings a slip in line with the engine's ticket: item rows, progress, Ready to bump and the footer.
  // WATCH OUT: returns at once when the items list and rush flag are unchanged. A station view gets a
  // reduced copy of the ticket each time, so it compares allItems.
  function syncSlip(rec, t, now) {
    const stationMode = rec.mode === 'station';
    const itemsRef = stationMode ? t.allItems : t.items;
    const rush = !!t.rush;
    if (rec.itemsRef === itemsRef && rec.rush === rush) return;
    rec.itemsRef = itemsRef;
    if (rec.rush !== rush) { rec.rush = rush; setRushStamp(rec, rush); }

    // A station hides its finished items but still counts them in "done here".
    const all = stationMode ? t.allItems : t.items;
    const shown = stationMode ? all.filter((it) => it.zone === rec.zone && it.status !== 'done') : all;
    const keep = new Set();
    const nodes = [];
    rec.timed = [];
    let doneHere = 0, totalHere = 0;
    for (let i = 0; i < all.length; i++) { const it = all[i]; if (!stationMode || it.zone === rec.zone) { totalHere++; if (it.status === 'done') doneHere++; } }
    for (let i = 0; i < shown.length; i++) {
      const it = shown[i], kind = kindFor(rec.mode, it);
      keep.add(it.id);
      let row = rec.rows.get(it.id);
      if (row && row.kind !== kind) { const nrow = buildRow(rec, it, kind); row.li.replaceWith(nrow.li); rec.rows.set(it.id, nrow); row = nrow; patchRow(rec, row, it, now); }
      else if (!row) { row = buildRow(rec, it, kind); rec.rows.set(it.id, row); patchRow(rec, row, it, now); }
      else if (row.item !== it) patchRow(rec, row, it, now);
      if (it.status === 'queued' || it.status === 'cooking') rec.timed.push(row);
      nodes.push(row.li);
    }
    for (const [id, row] of Array.from(rec.rows)) if (!keep.has(id)) { row.li.remove(); rec.rows.delete(id); }
    let ref = null; // rows keep ticket order: only new rows are inserted
    for (let i = nodes.length - 1; i >= 0; i--) { if (nodes[i].parentNode !== rec.refs.list || nodes[i].nextSibling !== ref) rec.refs.list.insertBefore(nodes[i], ref); ref = nodes[i]; }

    // progress, counts, ready, foot
    const r = rec.refs;
    const pctNum = totalHere ? doneHere / totalHere : 0;
    const ready = !stationMode && totalHere > 0 && doneHere === totalHere;
    r.progI.style.setProperty('--v', String(Math.round(pctNum * 1000) / 10));
    const label = stationMode ? doneHere + ' of ' + totalHere + ' done here' : doneHere + ' of ' + totalHere + ' done';
    const ctext = ready ? 'Ready to bump' : label;
    if (rec.countText !== ctext) { rec.countText = ctext; put(r.count, ctext); r.count.dataset.ready = ready ? 'true' : 'false'; r.prog.setAttribute('aria-valuenow', String(Math.round(pctNum * 100))); r.prog.setAttribute('aria-valuetext', label); }
    if (rec.ready !== ready) {
      rec.ready = ready;
      rec.el.dataset.ready = ready ? 'true' : 'false';
      r.bumpBtn.classList.toggle('btn-success', ready);
      r.bumpBtn.setAttribute('aria-label', ready ? 'Bump ticket #' + rec.num + ', everything is done' : 'Bump ticket #' + rec.num);
    }
    if (stationMode) {
      const left = shown.length;
      r.zoneBtn.hidden = left < 1;
      r.zoneBtn.setAttribute('aria-label', 'Mark all ' + left + ' ' + zoneById(rec.zone).name + ' ' + U.plural(left, 'item') + ' done on ticket #' + rec.num);
    }
    paintNext(rec, now);
  }

  // The "do this next" line of a ticket, in plain words, from what its items are doing right now. It names the
  // most useful thing first (a dish to check, a dish to start, one to finish), then the soonest dish still
  // waiting. Returns the words and a tone for the stylesheet: go, act, check or wait.
  function nextFor(rec, now) {
    const its = Array.from(rec.rows.values()).map((r) => r.item).filter(Boolean);
    if (!its.length) return { text: '', tone: 'wait' };
    // Two menu names end in an abbreviation dot; spell them out so a sentence does not read oddly.
    const nm = (it) => (it.short || it.name).replace(/ sand\.$/, ' sandwich');
    const list = (a) => (a.length === 1 ? a[0] : a.length === 2 ? a[0] + ' and ' + a[1] : a[0] + ', ' + a[1] + ' and ' + (a.length - 2) + ' more');
    // The names of the items that pass a test, ready for the sentence.
    const by = (f) => its.filter(f).map(nm);
    if (its.every((it) => it.status === 'done')) return { text: 'Everything is done. Tap Bump.', tone: 'go' };
    const cooking = its.filter((it) => it.status === 'cooking');
    const check = cooking.filter((it) => cookOf(it, now).check).map(nm);
    const run = cooking.filter((it) => !cookOf(it, now).check);
    const start = by((it) => it.status === 'displayed' && it.track === 'two');
    const make = by((it) => it.status === 'displayed' && it.track !== 'two');
    const wait = its.filter((it) => it.status === 'queued').sort((a, b) => a.fireAt - b.fireAt);
    let text, tone;
    if (check.length) { text = 'Check ' + list(check) + '. Tap DONE when ready.'; tone = 'check'; }
    else if (start.length) { text = 'Tap START on ' + list(start) + '.'; tone = 'act'; }
    else if (make.length) { text = 'Make ' + list(make) + ', then tap DONE.'; tone = 'act'; }
    else if (run.length) {
      const soon = run.slice().sort((a, b) => cookOf(a, now).left - cookOf(b, now).left)[0], l = cookOf(soon, now).left;
      text = l == null ? nm(soon) + ' is cooking.' : nm(soon) + ': ' + mss(l) + ' left.'; tone = 'wait';
    } else { text = ''; tone = 'wait'; }
    if (wait.length) {
      const w = wait[0], when = w.fireAt <= now ? 'starts now.' : 'starts in ' + mss(w.fireAt - now) + '.';
      text = (text ? text + ' ' : '') + nm(w) + ' ' + when;
    }
    return { text, tone };
  }
  // Writes a ticket's "do this next" line, only when its words or tone changed. Does nothing while the line is
  // switched off in Settings.
  function paintNext(rec, now) {
    if (!m || m.hints === false) return;
    const n = nextFor(rec, now), r = rec.refs;
    if (n.text !== rec.nextText) { rec.nextText = n.text; put(r.nextT, n.text); setHidden(r.next, !n.text); }
    if (n.tone !== rec.nextTone) { rec.nextTone = n.tone; r.next.dataset.tone = n.tone; }
  }
  // Shows or hides every ticket's "do this next" line to match the Settings switch, and refreshes them when
  // it comes back on.
  function paintHints() {
    if (!m || !m.main) return;
    const on = !(SB.theme && SB.theme.hints) || SB.theme.hints();
    m.hints = on;
    m.main.dataset.hints = on ? 'on' : 'off';
    if (on) { const now = store().now(); for (const rec of m.slips.values()) { rec.nextText = null; paintNext(rec, now); } }
  }

  // Which row an item gets: waiting (with Start now), read-only (done, or any expo row), or a button.
  function kindFor(mode, it) {
    if (it.status === 'queued') return 'deck';
    if (mode === 'expo') return 'ro';
    return it.status === 'done' ? 'ro' : 'btn';
  }

  // A small station chip (icon and code) for rows where the station is not obvious.
  function zoneChip(zoneId) {
    const z = zoneById(zoneId);
    return SB.ui.chip({ zone: zoneId, icon: z ? z.icon : 'flame', label: z ? z.code : zoneId });
  }

  // Builds one item row: quantity, name, modifier chips and the control for its kind.
  // WATCH OUT: a tappable row is one real button, so the whole row is the tap target.
  function buildRow(rec, it, kind) {
    const li = h('li', { class: 'fl-row', dataset: { item: it.id, menu: it.menuId, state: it.status, kind } });
    const row = { li, kind, item: it, status: null, id: it.id, act: null, num: rec.num, label: it.short || it.name, chk: null };
    const qty = h('span', { class: 'slip-qty num' }, String(it.qty));
    const sr = h('span', { class: 'visually-hidden' });
    // Compact tickets show the short menu name; the full name stays in the reading order for screen readers.
    const short = it.short && it.short !== it.name ? it.short : null;
    const name = h('span', { class: 'slip-name' }, short ? h('span', { class: 'nm-full' }, it.name) : it.name, short ? h('span', { class: 'nm-short', 'aria-hidden': 'true' }, short) : null, sr);
    const sub = h('span', { class: 'fl-sub' });
    row.sr = sr;
    if (kind === 'deck') {
      row.deckT = h('span', { class: 'fl-deck-t' });
      sub.appendChild(h('span', { class: 'fl-deck' }, ico('clock', 16), row.deckT));
    }
    if (rec.mode !== 'station') sub.appendChild(zoneChip(it.zone));
    (it.mods || []).forEach((mod) => sub.appendChild(SB.ui.chip({ mod: true, label: mod })));
    if (kind === 'btn') {
      // A two-step dish shows its countdown in the line under the name, like a waiting dish does.
      if (it.track === 'two') {
        row.cookTT = h('span', { class: 'fl-cook-t' });
        row.cookT = h('span', { class: 'fl-cook', hidden: true }, ico('timer', 16), row.cookTT);
        sub.insertBefore(row.cookT, sub.firstChild);
      }
      row.time = h('span', { class: 'fl-act-time num' });
      row.word = h('span', { class: 'fl-act-word' });
      const act = h('span', { class: 'fl-act', 'aria-hidden': 'true' }, h('span', { class: 'fl-act-top' }, ico('play', 24, { class: 'i-play' }), ico('check', 24, { class: 'i-check', stroke: 2.5 }), row.time), row.word);
      row.actEl = act;
      row.main = h('button', { type: 'button', class: 'slip-item fl-item', dataset: { act: 'item', state: it.status }, 'aria-pressed': 'false' }, qty, name, act, sub.childNodes.length ? sub : null);
      li.appendChild(row.main);
    } else if (kind === 'deck') {
      const fire = h('button', { type: 'button', class: 'btn fl-fire', dataset: { act: 'fire' }, 'aria-label': 'Start now: ' + it.name }, ico('zap', 20), h('span', null, 'Start now'));
      row.main = h('div', { class: 'slip-item fl-item', dataset: { state: 'queued' } }, qty, name, fire, sub);
      li.appendChild(row.main);
    } else {
      row.stateIcon = h('span', { class: 'fl-state-i', 'aria-hidden': 'true' });
      row.stateWord = h('span', { class: 'fl-state-w' });
      const stateEl = h('span', { class: 'fl-state', dataset: { state: it.status } }, row.stateIcon, row.stateWord);
      row.stateEl = stateEl;
      row.main = h('div', { class: 'slip-item fl-item', dataset: { state: it.status } }, qty, name, stateEl, sub.childNodes.length ? sub : null);
      li.appendChild(row.main);
    }
    return row;
  }

  // Icon for each state on read-only rows.
  const STATE_ICON = { displayed: 'zap', cooking: 'flame', done: 'check-circle' };
  // Words for an item still waiting, for example "Start in 2:34".
  const deckText = (it, now) => (it.fireAt <= now ? 'Starting now' : 'Start in ' + mss(it.fireAt - now));
  // The cook countdown: the time left of the dish's usual time, then how far past it. Only a cue: nothing here
  // ever completes the item, a person still taps it.
  function cookOf(it, now) {
    const el = now - (it.startedAt != null ? it.startedAt : now);
    if (!(it.prepSec > 0)) return { check: false, left: null, time: mss(el) };
    const left = it.prepSec * 1000 - el;
    return left > 0 ? { check: false, left, time: mss(left) } : { check: true, left, time: '+' + mss(-left) };
  }
  // Writes a tappable cooking row: the countdown under the name and the flash flag. A change to "Check it" is
  // spoken once and, when sound is on, chimes (only when live, so a reload stays quiet).
  function paintCook(row, it, now, live) {
    const ck = cookOf(it, now);
    const txt = ck.check ? 'Check it ' + ck.time : ck.left == null ? 'Cooking ' + ck.time : ck.time + ' left';
    if (row.cookTT && txt !== row.timeText) { row.timeText = txt; put(row.cookTT, txt); setHidden(row.cookT, false); }
    if (row.chk === ck.check) return;
    const was = row.chk;
    row.chk = ck.check;
    row.li.dataset.cook = ck.check ? 'check' : 'run';
    row.sr.textContent = ck.check ? ', time is up. Check it, then press when done.' : ', cooking. Press when done.';
    if (live && ck.check && was === false) { checkChime(); say('Check ' + row.label + ' on ticket #' + row.num + '. Time is up.'); }
  }
  // Updates a row for the item's new status: labels, spoken text and timer. A tappable row keeps its
  // button from Start to Done, so focus is not lost.
  function patchRow(rec, row, it, now) {
    row.item = it;
    const st = it.status;
    // Waiting and read-only rows change only with the status; tappable rows also refresh the timer.
    if (row.status === st && row.kind !== 'btn') { return; }
    const changed = row.status !== st;
    row.status = st;
    row.li.dataset.state = st;
    if (row.kind === 'btn') {
      const mode = st === 'cooking' ? 'cook' : it.track === 'two' ? 'start' : 'finish';
      if (row.act !== mode) {
        row.act = mode;
        row.actEl.dataset.act = mode;
        row.word.textContent = mode === 'start' ? 'Start' : 'Done';
        row.main.dataset.state = st;
        row.main.setAttribute('aria-pressed', mode === 'cook' ? 'mixed' : 'false');
        row.sr.textContent = mode === 'start' ? ', ready to start. Press to start.' : mode === 'cook' ? ', cooking. Press when done.' : ', ready. Press when done.';
        if (mode !== 'cook') { row.chk = null; row.timeText = ''; delete row.li.dataset.cook; if (row.cookT) setHidden(row.cookT, true); }
      }
      if (st === 'cooking') paintCook(row, it, now, false);
    } else if (row.kind === 'deck') {
      row.main.dataset.state = 'queued';
      row.sr.textContent = ', waiting to start.';
      put(row.deckT, deckText(it, now));
    } else if (changed) {
      row.main.dataset.state = st;
      row.stateEl.dataset.state = st;
      row.stateIcon.replaceChildren(ico(STATE_ICON[st] || 'zap', 20));
      put(row.stateWord, st === 'cooking' ? roText(it, now) : st === 'done' ? 'Done' : 'Not started');
      row.sr.textContent = st === 'done' ? ', done.' : st === 'cooking' ? ', cooking.' : ', not started.';
    }
  }
  // Words on a read-only cooking row: time left, or "Check it" once the time is up.
  function roText(it, now) { const ck = cookOf(it, now); return ck.check ? 'Check it' : ck.left == null ? 'Cooking ' + ck.time : 'Cooking, ' + ck.time + ' left'; }
  // Once-a-second update of a row's countdown or cooking time, written only when it changed.
  function tickRow(row, now) {
    const it = row.item;
    if (row.status === 'queued') {
      const tx = deckText(it, now);
      if (tx !== row.deckTText) { row.deckTText = tx; put(row.deckT, tx); }
    } else if (row.status === 'cooking') {
      if (row.kind === 'btn') paintCook(row, it, now, true);
      else { const w = roText(it, now); if (w !== row.timeText) { row.timeText = w; put(row.stateWord, w); } }
    }
  }

  // Updates a slip's timer and level (on time, running late, overdue) from its age and the channel's
  // alert times. Announces the moment a slip turns overdue, once.
  function paintTime(rec, now, announceBreach) {
    const el = now - rec.createdAt;
    const th = thresholds(rec.channel);
    const lvl = el >= th.breachMs ? 'breach' : el >= th.warnMs ? 'warn' : 'ok';
    const txt = U.fmtClock(el);
    if (txt !== rec.timerText) { rec.timerText = txt; put(rec.refs.timer, txt); }
    if (lvl !== rec.level) {
      const prev = rec.level;
      rec.level = lvl;
      rec.el.dataset.level = lvl;
      rec.refs.timer.dataset.level = lvl;
      rec.refs.badge.dataset.level = lvl;
      put(rec.refs.bw, WORDS[lvl]);
      if (announceBreach && lvl === 'breach' && prev && prev !== 'breach') say('Ticket #' + rec.num + ' is overdue.');
    }
  }

  // Header: counters, chips and buttons, updated in place.

  // Sets hidden only when it changes, so layout is not redone for nothing.
  function setHidden(el, hidden) { if (el.hidden !== hidden) el.hidden = hidden; }
  // Sets the colour tone of a chip or button only when it changes.
  function setTone(el, tone) { if (el.dataset.tone !== tone) el.dataset.tone = tone; }
  // Change an element's text by editing its existing text node, so a clock tick never replaces a node.
  function put(el, txt) {
    const n = el.firstChild;
    if (n && n.nodeType === 3 && n === el.lastChild) { if (n.nodeValue !== txt) n.nodeValue = txt; } else if (el.textContent !== txt) el.textContent = txt;
  }
  const setTxt = put;

  // Words for a countdown: "NOW", "9:30" under ten minutes, "25 min" under an hour, "1 h 05 min" above.
  function countdownText(ms) {
    if (ms <= 0) return 'NOW';
    const s = Math.ceil(ms / 1000);
    if (s < 600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    const min = Math.ceil(s / 60);
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
  }
  // Builds the attention strip: three rows made once and rewritten in place. Each row says when, what, what
  // happens if nothing is done, and what to do. Tapping a batch row opens that batch in the hold cabinet.
  function buildStrip() {
    const rows = [];
    const el = h('section', { class: 'fl-strip', role: 'region', 'aria-label': 'Needs attention', 'aria-live': 'polite', hidden: true });
    // The sound check: shown while sound is on but the browser has not yet allowed it. One tap allows it and plays a test.
    const soundBar = h('button', { type: 'button', class: 'fl-strip-sound', hidden: true, onClick: () => { lastChime = 0; hookAudioUnlock(); resumeAudio(); playHere(() => { chime(); speak('Sound is on.'); }); } },
      ico('bell', 24), h('span', null, 'Tap here to turn on warning sounds. This browser needs one tap first.'));
    el.appendChild(soundBar);
    // The pause note: shown while sound is on but warnings are held back because the kitchen is closed. Tap for settings.
    const pauseBar = h('button', { type: 'button', class: 'fl-strip-sound fl-strip-pause', hidden: true, onClick: () => { if (!sound) F.setSound(true); else openSheet('menu'); } }, ico('volume-off', 24), h('span', { class: 'fl-strip-pause-t' }));
    el.appendChild(pauseBar);
    for (let i = 0; i < 3; i++) {
      const when = h('span', { class: 'fl-strip-when num' }), what = h('span', { class: 'fl-strip-what' }), why = h('span', { class: 'fl-strip-why' });
      // Acknowledges this row, then opens the hold cabinet on its batch, or just the cabinet when it is not about one batch.
      const openRow = () => { const r = rows[i]; if (!r || !r.key) return; acknowledge(r.key); if (r.batchId) openHoldFor(r.batchId); else showCabinet(true); };
      const row = h('button', { type: 'button', class: 'fl-strip-row', hidden: true, dataset: { i: String(i) }, onClick: openRow },
        when, h('span', { class: 'fl-strip-text' }, what, why));
      rows.push({ el: row, when, what, why, key: '', batchId: null });
      el.appendChild(row);
    }
    // A visually hidden live region that changes only when a warning is announced (the leader tab), so a screen reader hears each warning once, never the ticking countdown.
    const announce = h('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    el.appendChild(announce);
    return { el, rows, soundBar, pauseBar, announce };
  }
  // Shows the hold cabinet with one batch scrolled into view and flashed.
  function openHoldFor(batchId) { try { showCabinet(true, { batchId }); } catch (e) { console.error('[smokebox] cabinet failed', e); } }
  // The warning ladder: what was announced for each deadline, and what to sound now (see 25-deadlines.js).
  const ladder = SB.deadlines.makeLadder();
  // Keeps a short record of one sound the ladder asked for, so a test can replay a whole service and check every
  // alert. level: 1 chime, 2 voice, 3 loud tone, 4 expiry or past.
  function logCall(c) {
    const d = c.d;
    const lg = F._alerts || (F._alerts = []);
    const b = d.batchId ? (store().getState().batches.find((x) => x.id === d.batchId) || null) : null;
    const rec = { t: store().now(), id: d.id, kind: d.kind, batchId: d.batchId || null, level: c.level, repeat: !!c.repeat, rung: d.rung, msLeft: Math.round(d.msLeft), goes86: !!d.goes86, wasteG: d.wasteG == null ? null : Math.round(d.wasteG),
      remainingG: b ? Math.round(b.remainingG) : null, cookedG: b ? Math.round(b.cookedG) : null, status: b ? b.status : null, allowed: SB.deadlines.soundsAllowed(store().getState(), store().now()), unknown: !!d.unknown, leader: isLeader() };
    lg.push(rec);
    if (lg.length > 500) lg.shift();
    saveAlertRecord(rec);
  }
  // Keeps the last 400 sound records in storage (the pilot report reads them after a reload). A full or blocked storage is ignored.
  function saveAlertRecord(rec) {
    try { const cur = U.storage.get(SB.pilot.KEY_ALERTLOG, []); const arr = Array.isArray(cur) ? cur : []; arr.push(rec); U.storage.set(SB.pilot.KEY_ALERTLOG, arr.slice(-SB.pilot.LOG_MAX)); } catch (e) { /* the log is optional */ }
  }
  // The saved sound records, oldest first.
  F.alertLog = () => { try { const v = U.storage.get(SB.pilot.KEY_ALERTLOG, []); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  // Plays the calls of one moment together: the strongest sound once, and one short spoken phrase naming the most
  // urgent item and how many others share the moment, so six batches expiring together are one warning, not six.
  function playCalls(calls) {
    if (!calls.length) return;
    // Not the leader: hold the sounds back until the leader says it played them (or this tab takes over).
    if (!isLeader()) { calls.forEach((c) => pending.add(c)); return; }
    if (lead.coordinated && SB.store.broadcast) SB.store.broadcast({ type: 'alert-played', keys: calls.map((c) => c.d.id + ':' + c.level + ':' + (c.d.epoch || 0)) });
    const top = calls.reduce((a, c) => (c.level > a.level ? c : a), calls[0]);
    if (top.level === 4) expiryTone(); else if (top.level === 3) alarmTone(); else chime();
    if (top.level < 2 || top.repeat) return;
    const same = calls.filter((c) => c.level === top.level);
    const first = same.slice().sort((x, y) => x.d.msLeft - y.d.msLeft)[0].d;
    const who = first.label + (same.length > 1 ? ' and ' + (same.length - 1) + ' more' : '');
    // Says the phrase aloud and puts it in the hidden live region for screen readers.
    const tell = (t) => { speak(t); if (m && m.strip && m.strip.announce) m.strip.announce.textContent = t; };
    if (top.level === 4 && first.kind === 'past') { tell(who + (same.length > 1 ? ' are past their quality limit.' : ' is past its quality limit.')); return; }
    if (top.level === 4) { tell(who + (same.length > 1 ? ' expired and were thrown out.' : ' expired and was thrown out.')); return; }
    const mins = Math.max(1, Math.round(first.msLeft / 60e3));
    tell(who + (first.goes86 && same.length === 1 ? ' goes 86' : same.length > 1 ? ' expire' : ' expires') + ' in ' + (top.level === 2 ? 'about ' : '') + mins + ' ' + U.plural(mins, 'minute') + '.');
  }
  // A tap on a strip row counts as seeing it: the loud tone stops until the next rung.
  function acknowledge(key) { saveAlertRecord({ t: store().now(), id: key, ack: true }); ladder.acknowledge(key); pending.forget(key); if (lead.coordinated && SB.store.broadcast) SB.store.broadcast({ type: 'alert-ack', id: key }); }
  // Rewrites the strip from the deadline feed: the top three rows, or hidden when the feed is empty.
  function updateStrip(now) {
    if (!m || !m.strip || !SB.deadlines) return;
    const all = SB.deadlines.build(store().getState(), now);
    // Nothing sounds while the kitchen is closed; the rungs wait and sound once when it opens.
    syncLeadership();
    if (SB.deadlines.soundsAllowed(store().getState(), now)) {
      const calls = ladder.decide(all, now, store().getState());
      calls.forEach(logCall);
      // A tab that has just become the leader first catches up on sounds it held back that are still true.
      let late = [];
      if (lead.needDrain && isLeader()) { lead.needDrain = false; late = pending.drain(all, (id) => ladder.isAcked(id)); }
      playCalls(late.concat(calls));
    }
    // Info rows only show for batches and run-outs; an expired notice goes away once someone taps it.
    const feed = all.filter((d) => !d.trivial && (d.sev !== 'info' || d.kind === 'expiry' || d.kind === 'leftover' || d.kind === 'keepcheck') && !(d.kind === 'expired' && ladder.isAcked(d.id)));
    const top = feed.slice(0, 3);
    const needSound = sound && !audioReady();
    setHidden(m.strip.soundBar, !needSound);
    // While sounds are held back the strip says so, so a quiet board is not mistaken for a broken one.
    // A board with sound switched off says so, so a silent board is not taken for a healthy quiet one.
    const note = sound ? SB.deadlines.pauseNote(store().getState(), now) : 'Sound is off on this tablet: warnings will not be heard. Tap to turn it on.';
    setHidden(m.strip.pauseBar, !note);
    if (note) setTxt(m.strip.pauseBar.querySelector('.fl-strip-pause-t'), note);
    setHidden(m.strip.el, top.length === 0 && !needSound && !note);
    m.strip.rows.forEach((r, i) => {
      const d = top[i];
      setHidden(r.el, !d);
      if (!d) { r.key = ''; return; }
      r.key = d.id; r.batchId = d.batchId || null;
      setTone(r.el, d.snoozedUntil ? 'info' : d.sev);
      // Where the row is on its ladder (first, middle, last) and whether its reminder is put off; the stylesheet draws both.
      const stp = d.step || '', sn = d.snoozedUntil ? 'true' : 'false';
      if (r.el.dataset.step !== stp) r.el.dataset.step = stp;
      if (r.el.dataset.snoozed !== sn) r.el.dataset.snoozed = sn;
      setTxt(r.when, d.kind === 'expired' ? 'OUT' : d.kind === 'past' ? 'PAST' : countdownText(d.msLeft));
      setTxt(r.what, d.label);
      setTxt(r.why, (d.snoozedUntil ? 'Reminder at ' + U.fmtTime(d.snoozedUntil) + '. ' : '') + d.consequence + ' ' + d.action);
    });
  }

  // Refreshes what depends on data or time: tab counts and overdue dots, button counts, sanitize and
  // demo chips. Runs after every draw and tick. WATCH OUT: edits text and attributes only, no new nodes.
  function updateHeader(now) {
    if (!m) return;
    const S = store();
    const c = S.select.counts();
    m.counts = c;
    updateStrip(now);
    // station tabs
    // Sets one tab's count and overdue dot; the corner badge dims at zero.
    const tabCount = (id, n, alert) => {
      m.seg.setCount(id, n, { alert });
      const p = m.tabParts[id];
      if (p && p.n !== n) { p.n = n; p.count.dataset.zero = n === 0 ? 'true' : 'false'; }
    };
    tabCount('all', c.all, c.overdue > 0);
    C.zones.forEach((z) => {
      if (z.id === 'expo') tabCount('expo', c.expo, c.overdue > 0);
      else tabCount(z.id, c.zones[z.id] || 0, (c.overdueByZone[z.id] || 0) > 0);
    });
    // tools with counts
    const recentN = recentCount(S, now);
    toolCount(m.tool.recall, recentN, '', recentN ? recentN + ' recently bumped' : '');
    toolCount(m.tool.hold, c.hold, 'warn', holdReason(c));
    m.seg.setCount('cabinet', c.hold, { alert: c.hold > 0 });
    // The Call tab counts jobs that need a tap now (tickets to start and plates to release).
    try { const cc = SB.coach.read(S.getState(), now).counts; m.seg.setCount('call', cc.start + cc.plate, { alert: cc.late > 0 || cc.fire > 0 }); } catch (e) { /* the coach is optional */ }
    toolCount(m.tool.board86, c.out86, 'bad', c.out86 ? c.out86 + ' ' + U.plural(c.out86, 'item') + ' off the menu' : '');
    // Orders still open, counted again only when the orders list itself changed.
    const ords = S.getState().orders || [];
    if (m.ordersRef !== ords) { m.ordersRef = ords; m.openOrders = ords.reduce((n, o) => n + (o.status === 'open' ? 1 : 0), 0); }
    toolCount(m.tool.orders, m.openOrders, '', m.openOrders ? m.openOrders + ' open ' + U.plural(m.openOrders, 'order') : '');
    // sanitise chip
    const san = m.sanChip, due = c.sanitizeDueAt;
    // The engine starts with the first check due now, so with none logged say "not logged", not "overdue".
    const neverLogged = !(S.getState().sanitize && typeof S.getState().sanitize.lastAt === 'number');
    let stxt = '', say_ = 'Sanitize timer', tone = 'info', icon = 'shield-check';
    if (typeof due === 'number') {
      const left = due - now;
      if (left <= 0) {
        icon = 'alert';
        if (neverLogged) { stxt = 'not logged'; tone = 'warn'; say_ = 'Sanitize, not logged. Press to log a check.'; }
        else { stxt = 'overdue'; tone = 'bad'; say_ = 'Sanitize, overdue. Press to log it.'; }
      } else {
        stxt = left >= 3600e3 ? Math.floor(left / 3600e3) + 'h ' + U.pad2(Math.floor((left % 3600e3) / 60e3)) + 'm' : mss(left);
        tone = left <= 30 * 60e3 ? 'warn' : 'info';
        say_ = 'Sanitize ' + stxt + ', due in ' + (left >= 3600e3 ? Math.floor(left / 3600e3) + ' hours ' + Math.floor((left % 3600e3) / 60e3) + ' minutes' : Math.floor(left / 60e3) + ' minutes') + '. Press for options.';
      }
    }
    if (san.dataset.icon !== icon) { san.dataset.icon = icon; san.replaceChild(ico(icon, 20), san.querySelector('svg')); }
    setTxt(m.sanText, stxt); setTone(san, tone);
    if (m.sanLabelFor !== say_) { m.sanLabelFor = say_; san.setAttribute('aria-label', say_); }
    san.dataset.urgent = tone === 'info' ? 'false' : 'true';
    // demo chip
    const speed = S.speed();
    const live = SB.sim && SB.sim.live && typeof SB.sim.live.status === 'function' ? safeStatus() : null;
    // The simulator's status fields are not fixed, so several names are accepted.
    const running = !!(live && (live.running || live.on || live.orders || (live.rate && live.rate !== 'off')));
    const demoOn = speed > 1 || running;
    setHidden(m.demoChip, !demoOn);
    if (demoOn) {
      const txt = speed > 1 ? 'Demo clock x' + (Math.round(speed * 10) / 10) : 'Demo orders';
      setTxt(m.demoChip.querySelector('.fl-chip-t'), txt);
      setTone(m.demoChip, 'warn');
    }
    // the menu button carries a dot when something on the quick list needs a look
    const needs = c.hold > 0 || c.sanitizeOverdue || demoOn;
    setHidden(m.menuBtn.querySelector('.fl-menu-dot'), !needs);
    const menuName = needs ? 'Menu, something needs a look' : 'Menu';
    if (m.menuBtn.getAttribute('aria-label') !== menuName) m.menuBtn.setAttribute('aria-label', menuName);
    toolCount(m.tool.demo, demoOn ? 1 : 0, 'warn', demoOn ? (speed > 1 ? 'clock running at x' + (Math.round(speed * 10) / 10) : 'demo orders running') : '', demoOn ? (speed > 1 ? 'x' + (Math.round(speed * 10) / 10) : 'on') : '');
    refit();
  }
  // Asks the demo simulator for its status; null when it is missing or fails.
  function safeStatus() { try { return SB.sim.live.status(); } catch (e) { return null; } }
  // How many tickets were bumped in the last 30 minutes, for the Recall badge.
  function recentCount(S, now) {
    const list = S.select.recent(30);
    let n = 0;
    for (let i = 0; i < list.length; i++) if (typeof list[i].expeditedAt === 'number' && now - list[i].expeditedAt < 30 * 60e3) n++;
    return n;
  }
  // Spells out why the Hold button is lit, for example "2 temperature checks due, 1 to throw out". Empty when nothing is due.
  function holdReason(c) {
    const w = c.holdWhy || {}, bits = [];
    if (w.check) bits.push(w.check + ' temperature ' + U.plural(w.check, 'check') + ' due');
    if (w.reheat) bits.push(w.reheat + ' to reheat');
    if (w.chill) bits.push(w.chill + ' to chill now');
    if (w.past) bits.push(w.past + ' past quality limit');
    if (w.discard) bits.push(w.discard + ' to throw out');
    return bits.join(', ');
  }
  // Updates one header button: count badge, tone and spoken label. A text argument replaces the number.
  function toolCount(t, n, tone, aria, text) {
    const txt = text != null ? text : n > 99 ? '99+' : String(n);
    setHidden(t.n, !n);
    if (n) setTxt(t.n, txt);
    setTone(t.b, n ? tone : '');
    // The name starts with the words and count on screen (WCAG label in name), then says more.
    const short = t.lab.textContent;
    const label = aria ? short + (n ? ' ' + txt : '') + ', ' + (t.label !== short ? t.label + ', ' : '') + aria : t.label;
    if (t.b.getAttribute('aria-label') !== label) t.b.setAttribute('aria-label', label);
  }

  // Opens the small menu behind the sanitize chip: log a check, or open the hold cabinet.
  function sanitiseMenu(anchor) {
    SB.ui.menu(anchor, [
      // Logging a check goes through run(), so it can be undone like any action.
      { label: 'Mark surfaces sanitized', icon: 'check-circle', onClick: () => run('sanitizeDone', {}) },
      { label: 'Open the hold cabinet', icon: 'thermometer', onClick: () => showCabinet(true) },
    ], { label: 'Sanitize timer' });
  }
  // On a narrow screen the Menu button opens this list: the buttons that no longer fit, plus settings.
  function quickMenu(anchor) {
    const c = m.counts || {};
    SB.ui.menu(anchor, [
      // The back office is the first row so a manager never has to hunt for it.
      { label: 'Back office', icon: 'gauge', onClick: () => openOffice(anchor) },
      // Menu and settings is one tap away too: add a dish, change a price or a prep time.
      { label: 'Edit the menu', icon: 'sliders', onClick: () => openOffice(anchor, 'data') },
      { separator: true },
      // Orders opens the open-orders screen, with how many are open.
      { label: 'Orders' + (m.openOrders ? ' (' + m.openOrders + ' open)' : ''), icon: 'receipt', onClick: () => openSheet('orders') },
      // Recall and Hold open the same sheets as their header buttons, with the same counts.
      { label: 'Recall' + (recentCount(store(), store().now()) ? ' (' + recentCount(store(), store().now()) + ')' : ''), icon: 'history', onClick: () => openSheet('recall') },
      { label: 'Hold cabinet' + (c.hold ? ', ' + c.hold + ' need attention' : ''), icon: 'thermometer', onClick: () => showCabinet(true) },
      // 86 and Demo open their sheets too.
      { label: '86 board' + (c.out86 ? ', ' + c.out86 + ' off' : ''), icon: 'ban', onClick: () => openSheet('board86') },
      { label: 'Demo', icon: 'play', onClick: () => openSheet('demo') },
      // The sanitize entry opens its own small menu on the same anchor.
      { label: 'Sanitize timer' + (m.sanText.textContent ? ': ' + m.sanText.textContent : ''), icon: 'shield-check', onClick: () => sanitiseMenu(anchor) },
      { separator: true },
      // Settings, help and the office sit behind the Menu sheet.
      { label: 'Settings and help', icon: 'settings', onClick: () => openSheet('menu') },
    ], { label: 'Menu' });
  }

  // Opens the back office from a visible button; the shell asks for the manager PIN first when one is set.
  function openOffice(from, section) {
    if (SB.shell && typeof SB.shell.ignite === 'function') SB.shell.ignite(section ? { from, section } : { from });
  }

  // Welcome card: shown above the tickets until someone dismisses it.

  // True once the welcome card has been dismissed.
  const welcomeDone = () => U.storage.get(KEY_WELCOME, null) === 'done';
  // Builds the first-time card: what this screen is, and two ways to learn it. Its text and the empty-board
  // button are kept current by paintWelcome.
  function buildWelcome() {
    m.wText = h('p', { class: 'fl-welcome-p' });
    m.wBlank = h('button', { type: 'button', class: 'btn btn-lg', onClick: startEmpty }, ico('trash', 22), h('span', null, 'Start with an empty board'));
    // Starting the walkthrough also puts this card away for good.
    const tour = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'tour' }, onClick: () => { F.setWelcome(false); startTour(); } }, ico('play', 22), h('span', null, 'Show me how it works'));
    // The x puts the card away for good.
    const close = h('button', { type: 'button', class: 'btn btn-icon fl-welcome-x', 'aria-label': 'Hide this welcome', onClick: () => F.setWelcome(false) }, ico('x', 22));
    m.welcome = h('section', { class: 'fl-welcome', hidden: true, 'aria-labelledby': 'fl-welcome-h' },
      h('span', { class: 'fl-welcome-mark', 'aria-hidden': 'true' }, ico('flame', 34, { stroke: 1.8 })),
      h('div', { class: 'fl-welcome-body' }, h('h2', { id: 'fl-welcome-h' }, 'Welcome to your kitchen screen'), m.wText,
        h('div', { class: 'fl-welcome-actions' }, tour, m.wBlank)),
      close);
    return m.welcome;
  }
  // Shows or hides the welcome card. It shows on the All tab while tickets are on the board and it has not
  // been dismissed. The empty-board button only appears when nothing but pretend tickets are on the board.
  function paintWelcome() {
    if (!m || !m.welcome) return;
    const tickets = store().getState().tickets.filter((t) => t.status === 'active');
    const demoOnly = tickets.length > 0 && tickets.every((t) => t.src === 'demo');
    const show = !welcomeDone() && m.zone === 'all' && m.slips.size > 0;
    setHidden(m.welcome, !show);
    if (!show) return;
    const txt = 'Each paper ticket is an order. Tap START when you begin a dish and DONE when it is ready. The timers tell you when each dish should start, so the whole order finishes together.' + (demoOnly ? ' These tickets are pretend.' : '');
    put(m.wText, txt);
    setHidden(m.wBlank, !demoOnly);
  }
  // Hides the card for good, or shows it again (a restarted demo starts with it).
  F.setWelcome = function (on) {
    if (on) U.storage.remove(KEY_WELCOME); else U.storage.set(KEY_WELCOME, 'done');
    if (m) paintWelcome();
    return !!on;
  };
  // True while the welcome card has not been dismissed.
  F.welcome = () => !welcomeDone();
  // Starts the guided walkthrough when it is part of this build; otherwise opens the Help sheet instead.
  function startTour() {
    if (SB.tour && typeof SB.tour.start === 'function') SB.tour.start();
    else openSheet('help');
  }
  F.startTour = startTour;
  // Clears the pretend tickets after a confirm, so a new user can begin with a clean board. Settings stay.
  async function startEmpty() {
    const ok = await SB.ui.confirm({
      title: 'Start with an empty board?', confirmLabel: 'Clear the board', cancelLabel: 'Keep the tickets',
      body: ['This removes the pretend tickets and anything else logged on this device. Settings stay.'],
    });
    if (!ok || !m) return;
    try { if (SB.sim && SB.sim.live) SB.sim.live.stop(); } catch (e) { /* the simulator may not be running */ }
    store().setSpeed(1);
    const r = store().resetLive({ keepSettings: true });
    if (r !== 'ok') { toast(E().describe(r, {}, store().getState().settings), { tone: 'warn' }); return; }
    F.setWelcome(false);
    toast('The board is empty. Tap New ticket to send an order.', { tone: 'info' });
  }

  // Empty state: shown when no slips match the current tab.

  // Fills the empty panel: New ticket and Start demo, or on a quiet station a way back to All.
  // Rebuilt only when its wording changes.
  function paintEmpty(c) {
    const e = m.empty;
    const zone = m.zone, stationBusy = modeOf(zone) === 'station' && c && c.all > 0;
    const title = stationBusy ? 'Nothing waiting at ' + zoneById(zone).name + '.' : 'No tickets right now.';
    const text = stationBusy
      ? c.all + ' ' + U.plural(c.all, 'ticket') + ' open on other stations. Tickets appear here when they have an item for this station.'
      : 'New orders land here the moment they are sent. Add one yourself, take the one-minute walkthrough, or run the busy-night demo. Demo orders are pretend.';
    const sig = title + '|' + text;
    if (e.dataset.sig === sig) return;
    e.dataset.sig = sig;
    U.clear(e);
    const actions = h('div', { class: 'fl-empty-actions' });
    // A quiet station while others are busy offers a way back; New ticket is always there.
    if (stationBusy) actions.appendChild(h('button', { type: 'button', class: 'btn btn-lg', onClick: () => goZone('all') }, ico('grid', 22), h('span', null, 'Show all stations')));
    actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openSheet('order') }, ico('plus', 26, { stroke: 2.5 }), h('span', null, 'New ticket')));
    if (!stationBusy) actions.append(
      h('button', { type: 'button', class: 'btn btn-lg fl-start-tour', onClick: startTour }, ico('help', 22), h('span', null, 'Show me how it works')),
      h('button', { type: 'button', class: 'btn btn-lg fl-start-demo', onClick: startDemo }, ico('fast-forward', 22), h('span', null, 'Busy-night demo')));
    e.append(h('div', { class: 'fl-empty-mark', 'aria-hidden': 'true' }, ico('flame', 72, { stroke: 1.6 })), h('h2', null, title), h('p', null, text), actions);
  }

  // Starts the demo orders and crew when the simulator is loaded; otherwise opens the demo sheet.
  function startDemo() {
    const live = SB.sim && SB.sim.live;
    if (live && typeof live.start === 'function') {
      try {
        live.start({ rate: 'normal' });
        if (typeof live.crew === 'function') live.crew(true);
        toast('Busy-night demo started. Orders and the crew are pretend. Open Demo to stop it.', { tone: 'info' });
        return;
      } catch (e) { console.error('[smokebox] demo failed to start', e); }
    }
    openSheet('demo');
  }

  // Actions: every tap becomes a store action.

  // One click handler for the whole grid (items, Start now, All done here, Bump, More).
  // WATCH OUT: a second tap on the same item within 450 ms is ignored, so a gloved double tap cannot start
  // and finish it.
  function onGridClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !m.grid.contains(btn)) return;
    const slip = btn.closest('.fl-slip');
    const rec = slip && m.slips.get(slip.dataset.ticket);
    if (!rec) return;
    const act = btn.dataset.act;
    if (act === 'item' || act === 'fire') {
      const row = btn.closest('.fl-row');
      if (!row) return;
      const id = row.dataset.item, nowMs = performance.now();
      const key = act + ':' + id, last = m.lastTap.get(key) || 0;
      if (nowMs - last < 450) return; // a gloved double tap must not start and finish an item
      m.lastTap.set(key, nowMs);
      if (m.lastTap.size > 200) m.lastTap.clear();
      if (act === 'item') run('advanceItem', { ticketId: rec.id, itemId: id });
      else run('fireNow', { ticketId: rec.id, itemId: id, start: true });
    } else if (act === 'zone') run('completeZone', { ticketId: rec.id, zone: rec.zone });
    else if (act === 'bump') bump(rec);
    else if (act === 'more') moreMenu(rec, btn);
  }

  // Sends one action to the store. A success that can be undone raises an Undo toast with the engine's
  // own label; anything else gets one plain sentence. Returns the store's result.
  function run(type, payload, o) {
    o = o || {};
    const S = store();
    const r = S.dispatchEx(type, payload, { source: 'ui' });
    if (r.report === 'ok') {
      const label = r.info && r.info.undo;
      if (label && E().UNDOABLE.indexOf(type) >= 0) toast(label, { tone: 'ok', undo: undoLast });
      else if (o.okText) toast(o.okText, { tone: 'ok' });
      return r;
    }
    toast(E().describe(r.report, r.info, settingsNow()), { tone: QUIET[r.report] ? 'info' : 'warn' });
    return r;
  }
  // Undoes the last undoable action (within the undo window) and says what was undone.
  function undoLast() {
    const r = store().dispatchEx('undo', {}, { source: 'ui' });
    if (r.report === 'ok') toast('Undone: ' + ((r.info && r.info.label) || 'last action') + '.', { tone: 'info' });
    else toast(E().describe(r.report, r.info, settingsNow()), { tone: 'warn' });
  }

  // The items on a ticket that are not done yet.
  function notDoneItems(ticket) { return ticket.items.filter((it) => it.status !== 'done'); }
  // Sends a ticket off the line. With items not done it asks first ("N items not done. Bump anyway?"),
  // then bumps with force, which the office numbers count as a forced bump.
  function bump(rec) {
    const t = E().findTicket(store().getState(), rec.id);
    if (!t) { toast(E().REPORTS.unknownTicket, { tone: 'warn' }); return; }
    const left = notDoneItems(t);
    if (!left.length) { run('bumpTicket', { ticketId: rec.id }); return; }
    const names = left.slice(0, 3).map((it) => it.short || it.name).join(', ') + (left.length > 3 ? ' and ' + (left.length - 3) + ' more' : '');
    SB.ui.confirm({
      title: left.length + ' ' + U.plural(left.length, 'item') + ' not done. Bump anyway?',
      body: [
        'Ticket #' + t.num + ' for ' + t.customer + ' still has ' + names + '.',
        'Bumping now sends the ticket out as it is and counts it as a forced bump in the office numbers. You can undo for ' + Math.round((settingsNow() && settingsNow().undoMs || C.undoMs) / 1000) + ' seconds.',
      ],
      confirmLabel: 'Bump anyway', cancelLabel: 'Keep cooking', tone: 'danger',
    }).then((ok) => { if (ok && m) run('bumpTicket', { ticketId: rec.id, force: true }); });
  }

  // The three-dot menu on a slip: rush on or off, recall, and void.
  function moreMenu(rec, anchor) {
    const t = E().findTicket(store().getState(), rec.id);
    if (!t) return;
    SB.ui.menu(anchor, [
      // Rush fires every item now; Recall opens the recall sheet.
      { label: t.rush ? 'Take off rush' : 'Make it a rush', icon: 'zap', onClick: () => run('setRush', { ticketId: rec.id, on: !t.rush }, { okText: t.rush ? 'Ticket #' + t.num + ' is no longer a rush.' : 'Ticket #' + t.num + ' is a rush. Every item is fired now.' }) },
      // Release now finishes the ticket without waiting for its plan (a started ticket only).
      t.awaitStart ? null : { label: 'Release now', icon: 'check', onClick: () => run('releaseTicket', { ticketId: rec.id }) },
      { label: 'Recall a bumped ticket', icon: 'history', onClick: () => openSheet('recall') },
      { separator: true },
      // Void asks for a reason first, see openVoid.
      { label: 'Void ticket', icon: 'trash', danger: true, onClick: () => openVoid(rec.id, anchor) },
    ].filter(Boolean), { label: 'Ticket #' + t.num });
  }

  // Opens the void sheet: pick a reason chip (or Other, up to 40 typed characters), then confirm.
  // WATCH OUT: Void stays off until a reason is chosen, so one stray tap cannot void a ticket.
  function openVoid(ticketId, opener) {
    const t = E().findTicket(store().getState(), ticketId);
    if (!t) { toast(E().REPORTS.unknownTicket, { tone: 'warn' }); return; }
    let chosen = null;
    const sh = SB.ui.sheet({ title: 'Void ticket #' + t.num + '?', side: 'center', width: 460, name: 'void', opener });
    const undoS = Math.round((settingsNow() && settingsNow().undoMs || C.undoMs) / 1000);
    const chips = VOID_REASONS.map((label) => {
      // Each reason is a chip that behaves like a toggle button.
      const b = SB.ui.chip({ label, onClick: () => pick(label), pressed: false });
      b.dataset.reason = label;
      return b;
    });
    const input = h('input', { class: 'input', type: 'text', maxlength: C.limits.maxCustomerLen, autocomplete: 'off', placeholder: 'For example: allergy, wrong table' });
    const field = SB.ui.field({ label: 'Say what happened', control: input, hint: 'Up to ' + 40 + ' characters.' });
    field.hidden = true;
    const voidBtn = h('button', { type: 'button', class: 'btn btn-danger', disabled: true, onClick: submit }, ico('trash', 20), h('span', null, 'Void ticket'));
    // Keep ticket closes the sheet and changes nothing.
    const cancel = h('button', { type: 'button', class: 'btn', onClick: () => sh.close() }, 'Keep ticket');
    sh.body.append(
      h('div', { class: 'sheet-copy' }, h('p', null, 'Ticket #' + t.num + ' for ' + t.customer + ' leaves the board and counts as voided. You can undo for ' + undoS + ' seconds.')),
      h('div', { class: 'fl-reasons', role: 'group', 'aria-label': 'Reason' }, chips),
      field);
    sh.footer.append(cancel, voidBtn);
    // The reason to record: the chosen chip, or the typed text for Other with spaces tidied.
    function reasonText() { return chosen === 'Other' ? input.value.replace(/\s+/g, ' ').trim() : chosen; }
    // Enables Void once there is a reason of at most 40 characters; flags text that is too long.
    function validate() {
      const r = reasonText();
      // 40 characters is the longest free-text reason the board accepts.
      const ok = !!r && r.length <= 40;
      voidBtn.disabled = !ok;
      if (chosen === 'Other') field.setError(input.value.length > 40 ? 'Shorten it to 40 characters.' : null);
    }
    // Selects a reason chip; Other shows the text box and moves focus into it.
    function pick(label) {
      chosen = label;
      chips.forEach((c) => c.setAttribute('aria-pressed', c.dataset.reason === label ? 'true' : 'false'));
      field.hidden = label !== 'Other';
      if (label === 'Other') input.focus({ preventScroll: true });
      validate();
    }
    input.addEventListener('input', validate);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !voidBtn.disabled) { e.preventDefault(); submit(); } });
    // Closes the sheet and voids the ticket with the chosen reason.
    function submit() {
      const r = reasonText();
      if (!r) return;
      sh.close();
      run('voidTicket', { ticketId, reason: r });
    }
    sh.focus(chips[0]);
  }

  // All-day strip: how many of each dish are still to make across the open tickets.

  // The dishes to show: still to make for the current tab, from the store's all-day count.
  function dockEntries(state) {
    const S = store();
    return S.select.allDay(m.zone).filter((e) => e.required > 0);
  }
  // Updates the strip chips (name, count, done bar) and the total, keyed by dish.
  // WATCH OUT: chip order changes only while no pointer is over the strip, so a chip never slides from a
  // finger.
  function renderDock(state) {
    const entries = dockEntries(state);
    let totalReq = 0;
    entries.forEach((e) => { totalReq += e.required; });
    const sum = m.dockToggle.querySelector('.fl-dock-sum');
    setTxt(sum, totalReq ? totalReq + ' to make' : '');
    dockName();
    setHidden(m.dockEmpty, entries.length > 0 || m.dockCollapsed);
    const keep = new Set();
    const nodes = [];
    for (const e of entries) {
      keep.add(e.menuId);
      let c = m.dockChips.get(e.menuId);
      if (!c) { c = buildDockChip(e); m.dockChips.set(e.menuId, c); }
      const on = m.hl === e.menuId;
      const sig = e.required + '/' + e.total + '/' + e.done + '/' + (on ? 1 : 0);
      if (c.sig !== sig) {
        c.sig = sig;
        setTxt(c.x, '\u00d7' + e.required);
        c.bar.style.setProperty('--v', String(e.total ? Math.round((e.done / e.total) * 1000) / 10 : 0));
        c.b.setAttribute('aria-pressed', on ? 'true' : 'false');
        // starts with the words on the chip (name and count) so the spoken name matches what is seen
        c.b.setAttribute('aria-label', e.short + ' \u00d7' + e.required + (e.name !== e.short ? ' (' + e.name + ')' : '') + ': ' + e.required + ' to make, ' + e.done + ' of ' + e.total + ' done. ' + (on ? 'Highlighted on the board. Press to clear.' : 'Press to highlight on the board.'));
      }
      nodes.push(c.b);
    }
    for (const [id, c] of Array.from(m.dockChips)) if (!keep.has(id)) { c.b.remove(); m.dockChips.delete(id); }
    // re-order only when nobody is pointing at the dock, so a chip never slides away from a finger
    const order = nodes.map((n) => n.dataset.menu).join('|');
    const domOrder = Array.from(m.dockList.children).map((n) => n.dataset.menu).join('|');
    if (order !== domOrder && (!m.dockHover || nodes.length !== m.dockList.childElementCount)) reorder(m.dockList, nodes);
    paintHighlight();
  }
  // Builds one dish chip for the strip. Returns the button and the parts that change.
  function buildDockChip(e) {
    const x = h('span', { class: 'fl-dchip-x num' });
    const bar = h('span', { class: 'fl-dchip-bar', 'aria-hidden': 'true' }, h('i'));
    const b = h('button', { type: 'button', class: 'fl-dchip', 'aria-pressed': 'false', dataset: { menu: e.menuId } }, h('span', { class: 'fl-dchip-name' }, e.short), x, bar);
    return { b, x, bar, sig: '' };
  }

  // Highlight: tapping a dish chip outlines every matching row on the board.

  // Makes a dish id safe to put inside a CSS selector.
  const cssEsc = (s) => (g.CSS && g.CSS.escape ? g.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  // True while the highlighted dish still has items to make; if not, the highlight is cleared.
  function hlAlive() {
    if (!m.hl) return true;
    const a = store().select.allDay('all');
    return a.some((e) => e.menuId === m.hl && e.required > 0);
  }
  // Applies the highlight as one generated style rule, so no slip or row is touched or re-created.
  function paintHighlight() {
    const id = m.hl;
    if (id) m.root.setAttribute('data-hl', id); else m.root.removeAttribute('data-hl');
    m.hlStyle.textContent = id ? '.fl-row[data-menu="' + cssEsc(id) + '"] > .slip-item { box-shadow: inset 0 0 0 4px var(--amber); background: var(--tint-warn); }' : '';
    setHidden(m.dockClear, !id);
  }
  // Highlights every row for one dish (menu id), or clears it with null. Scrolls to the first match
  // and announces how many lines match.
  F.highlight = function (menuId) {
    if (!m) return null;
    const id = typeof menuId === 'string' && menuId ? menuId : null;
    if (id === m.hl) return m.hl;
    m.hl = id;
    renderDock(store().getState());
    if (id) {
      const rows = m.grid.querySelectorAll('.fl-row[data-menu="' + cssEsc(id) + '"]');
      const n = rows.length;
      if (n && rows[0].scrollIntoView) { try { rows[0].scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }
      const nm = (C.menuById[id] && (C.menuById[id].short || C.menuById[id].name)) || id;
      say(n ? 'Highlighting ' + nm + ': ' + n + ' ' + U.plural(n, 'line') + ' on the board.' : nm + ' is not on this station.');
    } else say('Highlight cleared.');
    return m.hl;
  };

  // Keyboard shortcuts.

  // Handles the shortcut keys in F.shortcuts. WATCH OUT: ignored while typing, with a sheet or menu
  // open, in the office, or with Ctrl, Cmd or Alt held, so it never steals a key from a form.
  function onKey(e) {
    if (!m || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return;
    const tgt = e.target;
    if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
    if (SB.shell && SB.shell.inOffice && SB.shell.inOffice()) return;
    if (SB.sheets && SB.sheets.count && SB.sheets.count() > 0) return;
    if (doc.querySelector('.menu-layer')) return;
    const k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let used = true;
    if (k === 'n') openSheet('order');
    else if (k === 'o') openSheet('orders');
    else if (k === 'r') openSheet('recall');
    else if (k === 'h') toggleCabinet();
    else if (k === '8') openSheet('board86');
    else if (k === 'd') openSheet('demo');
    else if (k === '?') openSheet('help');
    else if (k === 'z') undoLast();
    else if (/^[1-6]$/.test(k)) goZone(TABS[Number(k) - 1]);
    else if (k === 'Escape' && m.hl) F.highlight(null);
    else used = false;
    if (used) e.preventDefault();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
