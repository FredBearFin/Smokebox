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
  // The record of sounds the warning ladder asked for (tests replay it); made once here so it always exists.
  F._alerts = [];

  // Keys the board answers to; the help sheet lists them. Keep in step with onKey.
  F.shortcuts = [
    { key: 'N', keys: ['N'], label: 'New ticket' },
    { key: 'O', keys: ['O'], label: 'Orders: open orders, add a round, take payment' },
    { key: 'R', keys: ['R'], label: 'Recall a bumped ticket' },
    { key: 'H', keys: ['H'], label: 'Hold cabinet' },
    { key: '8', keys: ['8'], label: '86 board' },
    { key: 'D', keys: ['D'], label: 'Demo' },
    { key: '1 to 6', keys: ['1', '2', '3', '4', '5', '6'], label: 'Station: All, PIT, HOT, FRY, CLD, EXP' },
    { key: 'Z', keys: ['Z'], label: 'Undo the last action' }, // the help sheet adds this kitchen's undo seconds
    // Ticket keys for a USB bump bar (it types like a keyboard): pick a ticket, then act on it.
    { key: 'J or Right', keys: ['J', 'Right'], label: 'Bump bar: select the next ticket (the first press selects the first)' },
    { key: 'K or Left', keys: ['K', 'Left'], label: 'Bump bar: select the previous ticket' },
    { key: 'S', keys: ['S'], label: 'Bump bar: start the next dish on the selected ticket' },
    { key: 'F', keys: ['F'], label: 'Bump bar: finish (done) the next cooking dish on the selected ticket' },
    { key: 'B or Enter', keys: ['B', 'Enter'], label: 'Bump bar: bump the selected ticket (asks first if dishes are not done)' },
    { key: 'L', keys: ['L'], label: 'Bump bar: bring back the ticket bumped last' },
    { key: '?', keys: ['?'], label: 'Help' },
    { key: 'Esc', keys: ['Esc'], label: 'Close a screen, or clear the all-day highlight' },
  ];
  // Keys each device role may use. A kitchen device has no order entry, orders or demo; a front device has no hold
  // cabinet; all-in-one and manager devices keep every key exactly as before.
  const ROLE_KEYS = { kitchen: 'rh8z?123456jksfbl', front: 'nor8dz?123456jksfbl' };
  // Named keys a USB bump bar can send (Enter bumps, arrows select). Every role may use them, like Escape.
  const BAR_KEYS = ['Escape', 'Enter', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
  // True when a device with this role may use this shortcut key (lower-case letter, digit or ?; Escape, Enter and
  // the arrows always may, so a bump bar that sends them works on a kitchen device).
  F.roleAllows = function (role, key) {
    if (BAR_KEYS.indexOf(key) >= 0) return true;
    const set = ROLE_KEYS[role];
    return set ? set.indexOf(String(key).toLowerCase()) >= 0 && String(key).length === 1 : true;
  };
  // Which dish a bump-bar key acts on for one ticket. items are the ticket's dishes; what is "start" (a two-step dish that is
  // ready to start) or "done" (a dish being cooked, or a one-step dish ready to finish). A dish whose time is up comes
  // first, then the one that has waited longest. Returns the item or null when there is nothing to do.
  F.pickItem = function (items, what, now) {
    const list = (items || []).filter((it) => it && (what === 'start' ? it.status === 'displayed' && it.track === 'two' : (it.status === 'cooking' || (it.status === 'displayed' && it.track !== 'two'))));
    // How far past its usual time a cooking dish is; 0 for any other dish.
    const over = (it) => (it.status === 'cooking' && it.prepSec > 0 && it.startedAt != null ? (now - it.startedAt) / 1000 - it.prepSec : 0);
    list.sort((a, b) => (over(b) - over(a)) || ((a.firedAt || 0) - (b.firedAt || 0)));
    return list[0] || null;
  };
  // With no page (loaded under plain Node) every call does nothing, so loading never throws.
  if (!doc) { F.mount = F.unmount = F.setZone = F.highlight = F.setSound = F.setCallouts = F.setWall = F.setVoiceLevel = () => {}; F.sound = F.callouts = F.wall = () => false; return; }

  const h = U.h;
  const C = SB.config;
  // The rules engine (SB.engine), looked up on each call and never kept.
  const E = () => SB.engine;
  // True when the kitchen runs as counter service (settings.service.counter): orders are taken and paid at the counter, with no
  // cooking steps to track. Absent or false means the normal kitchen board.
  function counterOn() {
    const sv = store().getState().settings && store().getState().settings.service;
    if (SB.engine && typeof SB.engine.counterOn === 'function') return !!SB.engine.counterOn(store().getState().settings);
    return !!(sv && sv.counter === true);
  }
  // True when the cook-ahead parts (batches, Cabinet tab, Hold button, temperature checks, sanitize timer) should show:
  // the module is on (absent means on), or some batch still holds food, which is never hidden.
  function cookOn() {
    const s = store().getState();
    if (E() && typeof E().cookAheadActive === 'function') return E().cookAheadActive(s);
    if (!E() || typeof E().moduleOn !== 'function' || E().moduleOn(s, 'cookAhead')) return true;
    return (s.batches || []).some((b) => b && b.status !== 'discard' && b.remainingG > 0);
  }
  // Browser-storage keys: the sound switch, and whether the all-day strip is folded.
  const KEY_SOUND = 'smokebox.v1.sound';
  // Whether warnings are also spoken aloud (the tablet's own voice), on by default.
  const KEY_SPEECH = 'smokebox.v1.speech', KEY_VOLUME = 'smokebox.v1.volume', KEY_FAR = 'smokebox.v1.far', KEY_CALLOUTS = 'smokebox.v1.callouts', KEY_WALL = 'smokebox.v1.wall', KEY_VLEVEL = 'smokebox.v1.voicelevel';
  // Loudness of this tablet's warnings: 0.2 to 1. It never reaches 0 (the sound toggle is the way to silence); the last warning and the expiry tone never go below half.
  const VOL_MIN = 0.2;
  const KEY_DOCK = 'smokebox.v1.dock';
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
  // Far display is off by default and belongs to this tablet (it describes how far away the screen is read).
  let far = U.storage.get(KEY_FAR, false) === true;
  // How much the voice talks: light (start and ring-out calls), normal (adds new tickets and one reminder) or full (reminders until you act).
  let voiceLevel = (() => { const v = U.storage.get(KEY_VLEVEL, 'normal'); return v === 'light' || v === 'full' ? v : 'normal'; })();
  // Voice call-outs (new ticket, start this dish now) are part of the program and on unless a tablet turns them off; they follow the station tab showing.
  let callouts = U.storage.get(KEY_CALLOUTS, true) !== false;
  // Wall mode (three panes on a wide screen) is off until a tablet or screen opts in; it only shows at 1700 px and wider.
  let wall = U.storage.get(KEY_WALL, false) === true;
  const WALL_MIN_PX = 1700;
  // The ticket picked with the bump-bar keys (by id); null until a key picks one.
  let selId = null, selIdx = 0;
  let audio = null, audioHooked = false, lastChime = 0, lastCheck = 0, checkLater = 0;
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

  // This device's job (all, kitchen, front or manager) from the router; all when the router is not there.
  const roleNow = () => { try { return SB.router && SB.router.role ? SB.router.role() : 'all'; } catch (e) { return 'all'; } };
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
  // Plays the two-note chime for a new ticket when sound is on. warn is true for a warning-ladder call.
  // WATCH OUT: new-ticket calls within 600 ms of the last are dropped, so a burst of tickets makes one ding. A warning
  // call always plays (playCalls already makes one sound per moment), so a new ticket never swallows a heads-up.
  function chime(warn) {
    if (!audible()) return;
    const nowMs = performance.now();
    if (!warn && nowMs - lastChime < 600) return; // a burst of tickets is one ding, not twelve
    lastChime = nowMs;
    const a = resumeAudio();
    if (!a) return;
    try { const t0 = a.currentTime + 0.01; tone(a, 784, t0, 0.2, 0.16); tone(a, 1175, t0 + 0.15, 0.42, 0.16); } catch (e) { /* audio is optional */ }
  }
  // Plays three short high beeps when a dish's time is up (when sound is on). Several dishes at once make one set.
  // WATCH OUT: a call within 1.5 s of the last set is not dropped: one more set plays when the 1.5 s are up, so a
  // second dish that reaches "Check it" just after the first still gets its beeps.
  function checkChime() {
    if (!audible()) return;
    const nowMs = performance.now(), wait = 1500 - (nowMs - lastCheck);
    if (wait > 0) { if (!checkLater) checkLater = setTimeout(() => { checkLater = 0; if (m) checkChime(); }, wait); return; }
    lastCheck = nowMs;
    const a = resumeAudio();
    if (!a) return;
    try { const t0 = a.currentTime + 0.01; for (let i = 0; i < 3; i++) tone(a, 1320, t0 + i * 0.22, 0.14, 0.16); } catch (e) { /* audio is optional */ }
  }
  // Whether the chime is switched on.
  F.sound = () => sound;
  // Switches the chime on or off and remembers it; switching on plays one chime as a test.
  F.setSound = function (on) {
    sound = !!on;
    U.storage.set(KEY_SOUND, sound);
    if (!sound) hush();
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
  // Tells whether this tablet is in far display mode (bigger type, quiet board, two strip rows).
  F.farDisplay = () => far;
  // Switches far display on or off, remembers it, and repaints the open board at once.
  F.setFarDisplay = function (on) {
    far = !!on;
    U.storage.set(KEY_FAR, far);
    if (m.root) m.root.dataset.far = far ? 'on' : 'off';
    return far;
  };
  // Tells whether voice call-outs are on for this tablet.
  F.callouts = () => callouts;
  // Switches voice call-outs on or off for this tablet and remembers it. Turning on says one test line (when sound
  // and speech are on) and ignores tickets that are already on the board.
  F.setCallouts = function (on) {
    callouts = !!on;
    U.storage.set(KEY_CALLOUTS, callouts);
    if (m) { m.coPrimed = false; }
    if (callouts && sound && speech) playHere(() => speak('Call-outs are on.'));
    return callouts;
  };
  // Tells whether wall mode is switched on for this screen (it still needs a window 1700 px wide).
  F.wall = () => wall;
  // Switches wall mode on or off, remembers it, and repaints the open board at once.
  F.setWall = function (on) {
    wall = !!on;
    U.storage.set(KEY_WALL, wall);
    if (m) paintWall();
    return wall;
  };
  // True while the three panes are showing (the setting is on and the window is wide enough).
  F.wallActive = () => !!m && m.root.dataset.wall === 'on';
  // How much the voice talks: light, normal or full.
  F.voiceLevel = () => voiceLevel;
  // Saves how much the voice talks and says a sample call; calls already true stay quiet (they are marked heard).
  F.setVoiceLevel = function (level) {
    voiceLevel = level === 'light' || level === 'full' ? level : 'normal';
    U.storage.set(KEY_VLEVEL, voiceLevel);
    if (m) m.coPrimed = false;
    if (sound && speech) playHere(() => speak(SB.deadlines.phrase('start', { name: '2 brisket sandwich', num: 12 })));
    return voiceLevel;
  };
  // Tells whether warnings are spoken aloud right now.
  F.speech = () => speech;
  // Switches spoken warnings on or off and remembers it. Speech only plays while sound is on.
  F.setSpeech = function (on) {
    speech = !!on;
    U.storage.set(KEY_SPEECH, speech);
    if (!speech) hush();
    if (speech && sound) playHere(() => speak('Spoken warnings are on.'));
    return speech;
  };
  // Stops any phrase being spoken now (sound or speech switched off, or another tab took over the sound).
  function hush() {
    try { if (g.speechSynthesis) g.speechSynthesis.cancel(); } catch (e) { /* speech is optional */ }
    lastUtter = null; voiceFreeAt = 0;
  }
  // When the tablet's voice is expected to be free again (browser clock, ms). A call-out waits for it, so it never talks
  // over a warning or over the call before it.
  let voiceFreeAt = 0, lastUtter = null;
  // Says one short phrase with the tablet's voice when sound and speech are both on. A warning replaces whatever is
  // being said; a call-out (queued) waits its turn instead and never cuts anything off.
  function speak(text, queued, kind) {
    if (!audible() || !speech) return false;
    try {
      const ss = g.speechSynthesis, U2 = g.SpeechSynthesisUtterance;
      if (!ss || !U2) return false;
      if (!queued) ss.cancel();
      const u = new U2(text);
      // Kept here until the next phrase: some tablets drop a phrase whose object nothing holds on to.
      lastUtter = u;
      // The chef voice: fast and sharp, on the best-sounding English voice this device has.
      const cv = SB.deadlines && SB.deadlines.CHEF_VOICE ? SB.deadlines.CHEF_VOICE : { rate: 1.1, pitch: 1 };
      // Calm for a heads-up, brisk for a new ticket, fast and loud for "fire now": the style of the line sets rate, pitch and volume.
      const dl = SB.deadlines && SB.deadlines.delivery ? SB.deadlines.delivery(kind) : null;
      u.rate = dl ? dl.rate : cv.rate; u.pitch = dl ? dl.pitch : cv.pitch; u.volume = dl ? dl.volume : 1;
      const pv = SB.deadlines && SB.deadlines.pickVoice && ss.getVoices ? SB.deadlines.pickVoice(ss.getVoices(), U.storage.get('smokebox.v1.voicename', '')) : null;
      if (pv) { u.voice = pv; if (pv.lang) u.lang = pv.lang; }
      ss.speak(u);
      // About 70 ms a letter plus a short gap; speech end events are not reliable on every tablet.
      voiceFreeAt = performance.now() + 700 + String(text).split(' ').length * 340 / (u.rate || 1);
      return true;
    } catch (e) { return false; /* speech is optional */ }
  }
  // Speaks the next waiting call-out when the voice is free. Called every second from the header update.
  // WATCH OUT: with call-outs, sound or speech off, or when this tab is not the sound leader, nothing is queued, so
  // nothing old is read out when they come back on.
  function driveCallouts(now) {
    if (!m) return;
    const D = SB.deadlines;
    if (!D || !D.makeCallouts) return;
    if (!m.co) m.co = D.makeCallouts();
    if (!callouts) { m.coPrimed = false; return; }
    const wants = D.calloutWants(store().getState(), now, m.zone, voiceLevel);
    if (!m.coPrimed || !audible() || !speech) { m.co.prime(wants); m.coPrimed = audible() && speech; return; }
    m.co.sync(wants, now);
    if (performance.now() < voiceFreeAt) return;
    const c = m.co.next(now);
    if (c) speak(c.text, true, c.style);
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
  // True when this browser has no Web Audio at all: no tap can ever turn tones on, but spoken warnings may still work.
  const noWebAudio = () => !(g.AudioContext || g.webkitAudioContext);

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
  // A tab can lead when the board is showing, sound is on and the browser lets it play. A browser with no Web Audio
  // can still lead, so its spoken warnings are not held back forever waiting for tones it can never play.
  const canLead = () => !!m && sound && (audioReady() || noWebAudio());
  // Says to the other tabs whether this tab is visible, can lead, and leads.
  function sayHello() {
    if (SB.store && SB.store.broadcast) SB.store.broadcast({ type: 'alert-hello', visible: doc.visibilityState !== 'hidden', eligible: canLead(), lead: lead.isLeader });
  }
  // Records a change of leader (promotion means any sound held back is checked and played).
  function setLeader(on) {
    if (on === lead.isLeader) return;
    lead.isLeader = on;
    if (!on) hush(); // the new leader speaks from now on; this tab stops mid-phrase so two voices do not overlap
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
      g.navigator.wakeLock.request('screen').then((sn) => {
        // The board was closed while the request was out: let the lock go at once instead of holding it with no owner.
        if (!m) { try { sn.release(); } catch (e) { /* ignore */ } return; }
        if (wakeSentinel && wakeSentinel !== sn) { try { wakeSentinel.release(); } catch (e) { /* ignore */ } }
        wakeSentinel = sn; wakeState = 'on';
        // The system may take the lock back (low battery, another app); when the board is still showing it asks again.
        // Only the lock in use clears the slot, so an older lock released late does not forget a newer one.
        sn.addEventListener('release', () => { if (wakeSentinel !== sn) return; wakeState = 'released'; wakeSentinel = null; if (m && doc.visibilityState === 'visible') setTimeout(requestWake, 800); });
      }, () => { wakeState = 'refused'; });
    } catch (e) { wakeState = 'refused'; }
  }
  // Reports the screen wake lock state: unknown, on, released, refused or unsupported.
  F.wakeLock = () => wakeState;
  // A calm sentence when the screen may go to sleep (the browser has no wake lock or refused it); empty when all is well.
  function awakeNote() {
    if (wakeState !== 'unsupported' && wakeState !== 'refused') return '';
    return 'This screen may go to sleep, and warnings stop while it sleeps. Keep the tablet plugged in with its screen set to stay on.';
  }
  // Keeps the "went to the background" snapshot for this browser tab, so a page the browser threw away and reloaded can still say what changed.
  function rememberSleep(at, snap) {
    try {
      if (!at || !snap) { g.sessionStorage.removeItem('smokebox.v1.sleepSnap'); return; }
      g.sessionStorage.setItem('smokebox.v1.sleepSnap', JSON.stringify({ at, overdue: snap.overdue, past: Array.from(snap.past).slice(0, 200) }));
    } catch (e) { /* private window or no storage: the live page still keeps it in memory */ }
  }
  // On a fresh start, reads the snapshot left by a page that went to the background and never came back (the browser discarded it) and
  // sets the same "While this screen was asleep" line as a normal wake.
  function restoreSleep() {
    try {
      const raw = g.sessionStorage.getItem('smokebox.v1.sleepSnap');
      if (!raw) return;
      const d = JSON.parse(raw), used = Number(d.used) || Date.now(), min = Math.round((used - d.at) / 60e3);
      // Used once: the board may be set up again within ten minutes (it keeps the line), and after that the snapshot goes.
      if (!(min >= 1) || min > 24 * 60 || !Array.isArray(d.past) || Date.now() - used > 10 * 60e3) { g.sessionStorage.removeItem('smokebox.v1.sleepSnap'); return; }
      if (!d.used) g.sessionStorage.setItem('smokebox.v1.sleepSnap', JSON.stringify(Object.assign({}, d, { used })));
      m.away = { at: used, min, summary: sleepSummary({ overdue: Number(d.overdue) || 0, past: new Set(d.past) }) };
    } catch (e) { /* a damaged snapshot is ignored */ }
  }
  // What was already late or past its limit when the page went to the background, so waking can say only what is new.
  function sleepSnapshot() {
    try {
      const st = store().getState(), now = store().now();
      const past = new Set(SB.deadlines.build(st, now).filter((d) => d.kind === 'past' || d.kind === 'expired').map((d) => d.batchId || d.id));
      return { overdue: SB.engine.views.counts(st, now).overdue, past };
    } catch (e) { return null; }
  }
  // One calm sentence about what changed while the page slept ("2 batches passed their time and 3 tickets went late"), or '' when nothing did.
  function sleepSummary(snap) {
    if (!snap) return '';
    try {
      const st = store().getState(), now = store().now();
      const nb = SB.deadlines.build(st, now).filter((d) => (d.kind === 'past' || d.kind === 'expired') && !snap.past.has(d.batchId || d.id)).length;
      const nt = Math.max(0, SB.engine.views.counts(st, now).overdue - snap.overdue);
      const bits = [];
      if (nb) bits.push(nb + ' ' + U.plural(nb, 'batch', 'batches') + ' passed ' + U.plural(nb, 'its', 'their') + ' time');
      if (nt) bits.push(nt + ' ' + U.plural(nt, 'ticket') + ' went late');
      return bits.length ? 'While this screen was asleep: ' + bits.join(' and ') + '.' : '';
    } catch (e) { return ''; }
  }
  // The one-time words about the saved history filling up or being trimmed (from the store, when it has them), or ''. Asked about every few
  // seconds; once it has been shown it is marked seen so it does not come back, and it stays up until the person clears it.
  function historyWords() {
    if (!m || !SB.store || typeof SB.store.historyNotice !== 'function') return '';
    const t = Date.now();
    if (!m.histNote && t - (m.histAsk || 0) > 5000) {
      m.histAsk = t;
      try { const n = SB.store.historyNotice(); if (n && n.words) { m.histNote = { kind: n.kind, words: String(n.words).slice(0, 300) }; m.histSeen = false; } } catch (e) { /* ignore */ }
    }
    return m.histNote ? m.histNote.words : '';
  }
  // A sentence shown for a while after the board comes back from the background, since warnings were silent in between.
  function awayNote() {
    const a = m && m.away;
    if (!a || Date.now() - a.at > 10 * 60e3) return '';
    if (a.summary) return a.summary;
    return 'The board was in the background for ' + (a.min < 1 ? 'a moment' : a.min + (a.min === 1 ? ' minute' : ' minutes')) + '. Warnings are silent while it is hidden.';
  }
  // Plays a test chime and a spoken line so a cook can hear that this tablet makes sound, and says what happened.
  F.testSound = function () {
    if (!sound) F.setSound(true);
    hookAudioUnlock();
    const a = resumeAudio();
    playHere(() => { chime(); speak('Sound is on. This is a test.'); });
    return F.audioState();
  };
  // Which voice would speak a call on this tablet: { supported, name, lang, local } (name empty when only the default voice is there).
  F.voiceInfo = function () {
    const ss = g.speechSynthesis;
    if (!ss || !g.SpeechSynthesisUtterance) return { supported: false };
    let info = null;
    try { info = SB.deadlines && SB.deadlines.voiceInfo ? SB.deadlines.voiceInfo(ss.getVoices(), U.storage.get('smokebox.v1.voicename', '')) : null; } catch (e) { info = null; }
    return info ? Object.assign({ supported: true }, info) : { supported: true, name: '', lang: '', local: true };
  };
  // Speaks a sample ticket call in the chef voice and says which voice did it, so a cook can hear and see what this tablet will use.
  F.testVoice = function () {
    if (!sound) F.setSound(true);
    if (!speech) F.setSpeech(true);
    hookAudioUnlock();
    resumeAudio();
    playHere(() => speak(SB.deadlines.phrase('new_all', { num: 12, count: 3 }), false, 'new_all'));
    return F.voiceInfo();
  };
  // Whether this tablet can make sound right now: running, suspended (needs a tap), unsupported or off.
  F.audioState = () => (!sound ? 'off' : !(g.AudioContext || g.webkitAudioContext) ? 'unsupported' : audio && audio.state === 'running' ? 'running' : 'needs-tap');

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
    // The first tap or key press asks again if the browser had refused (some only allow it after a gesture).
    const onGesture = () => { if (wakeState === 'refused' || wakeState === 'released' || wakeState === 'unknown') requestWake(); };
    doc.addEventListener('pointerdown', onGesture, true);
    // When the page returns to the front it asks for the wake lock again and remembers how long it was away; hiding notes the time.
    const onVis = () => {
      if (doc.visibilityState === 'visible') {
        requestWake();
        if (m && m.hiddenAt) {
          const min = Math.round((Date.now() - m.hiddenAt) / 60e3);
          // The first look after waking: one tick right now (not a loop of missed seconds), then one summary of what changed while asleep.
          if (min >= 1) { try { store().tick(); } catch (e) { /* the next timer tick does it */ } m.away = { at: Date.now(), min, summary: sleepSummary(m.sleepSnap) }; }
          m.hiddenAt = null; m.sleepSnap = null; rememberSleep(0, null);
        }
      } else if (m && !m.hiddenAt) { m.hiddenAt = Date.now(); m.sleepSnap = sleepSnapshot(); rememberSleep(m.hiddenAt, m.sleepSnap); }
    };
    doc.addEventListener('visibilitychange', onVis);
    m.offs.push(() => { doc.removeEventListener('pointerdown', onGesture, true); doc.removeEventListener('visibilitychange', onVis); try { if (wakeSentinel) wakeSentinel.release(); } catch (e) { /* ignore */ } wakeSentinel = null; });
    if (sound) hookAudioUnlock();
    m.offs.push(joinLeadership());
    restoreSleep();
    // Keep saved data safe from the browser's clean-up, and remind the owner to save the discard log.
    if (SB.discards) { SB.discards.persist(); setTimeout(() => { try { SB.discards.remind(); } catch (e) { /* optional */ } }, 4000); }
    if (SB.sim && SB.sim.live && typeof SB.sim.live.onChange === 'function') {
      try { const off = SB.sim.live.onChange(() => { if (m) updateHeader(store().now()); }); if (typeof off === 'function') m.offs.push(off); } catch (e) { /* the simulator is optional */ }
    }
    if (SB.theme && SB.theme.onChange) { try { m.offs.push(SB.theme.onChange((what) => { if (m) { measureDock(); if (what === 'density' || what === 'text') paintDensity(); if (what === 'text') fitHead(); if (what === 'hints') paintHints(); } })); } catch (e) { /* ignore */ } }
    if (sound) hookAudioUnlock();
    render();
    updateHeader(store().now());
    measureDock();
  };

  // Stops every listener, timer and observer and empties the element. Safe to call twice.
  // Applies the saved station, category and channel names to the live app without a reload: reloads the name lists and draws
  // the board again on the same element, on the same station tab. Safe to call when the board is not mounted.
  F.refreshNames = function () {
    try { C.applyCustom(C.customSpec()); } catch (e) { console.error('[smokebox] names failed', e); return false; }
    if (m && m.el) { const el = m.el, zone = m.zone; F.unmount(); pendingZone = TABS.indexOf(zone) >= 0 ? zone : null; F.mount(el); }
    return true;
  };
  // Stops the board's timers and listeners and takes it off the screen.
  F.unmount = function () {
    if (!m) return;
    const i = m;
    m = null;
    i.offs.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    clearTimeout(i.sayT);
    if (i.cab) { try { i.cab.destroy(); } catch (e) { /* ignore */ } }
    if (i.io) i.io.disconnect();
    if (i.ro) i.ro.disconnect();
    cancelAnimationFrame(i.raf);
    try { doc.documentElement.style.removeProperty('--fl-head-bottom'); doc.documentElement.style.removeProperty('--fl-lift'); } catch (e) { /* ignore */ }
    U.clear(i.el);
  };

  // How many slips a station switch builds before painting; the rest follow right after.
  const FIRST_SCREEN = 18, REST_CHUNK = 30;
  // Builds the slips a station switch left for later, a few frames' worth at a time (not all at once), until every ticket of that station is there.
  function buildRest(z) {
    setTimeout(() => {
      if (!m || m.zone !== z) return;
      m.first = true; m.buildLimit = REST_CHUNK; render(); m.buildLimit = 0; m.first = false;
      if (m.deferred) { m.deferred = false; buildRest(z); }
    }, 25);
  }
  // Switches to another station tab and announces the result. Called by the shell when the address changes.
  F.setZone = function (zone) {
    const z = TABS.indexOf(zone) >= 0 ? zone : 'all';
    if (!m) { pendingZone = z; return z; }
    if (m.cabOn) showCabinet(false);
    if (z === m.zone) return z;
    m.zone = z;
    clearBoard();
    syncZoneUi();
    // Count this redraw as the first, so slips do not print in or chime as if they were new.
    m.first = true; m.coPrimed = false;
    m.hl = null; paintHighlight();
    // A big board paints its first screenful at once and the rest a moment later, so the tap is answered quickly.
    m.buildLimit = FIRST_SCREEN;
    render();
    m.buildLimit = 0;
    m.first = false;
    if (m.deferred) { m.deferred = false; buildRest(z); }
    const n = store().select.ticketsForZone(z).length, zn = z === 'all' ? 'All stations' : zoneById(z).name;
    say(zn + ': ' + (n ? n + ' ' + U.plural(n, 'ticket') : 'no tickets') + '.');
    return z;
  };

  // The page: header, slip area and all-day strip.

  // What the Expo tab shows, in plain words, for its tooltip and for screen readers.
  const EXPO_WHAT = 'Expo: whole tickets, ready to send out';
  // Builds the whole page once. WATCH OUT: nothing built here is replaced later; updates change
  // text and attributes only.
  function buildDom() {
    const root = h('div', { class: 'fl', dataset: { zone: m.zone, mode: modeOf(m.zone), far: far ? 'on' : 'off' } });
    m.root = root;
    // ----- header
    const brand = SB.shell && SB.shell.brand ? SB.shell.brand() : h('span', null, 'Smokebox');
    const tabOptions = TABS.map((id) => {
      if (id === 'all') return { id, label: 'All', icon: 'grid', iconSize: 20, count: 0, alert: false, alertLabel: 'has overdue tickets' };
      const z = zoneById(id);
      return { id, label: z.name, icon: z.icon, iconSize: 20, count: 0, alert: false, alertLabel: 'has overdue tickets' };
    });
    // The Cabinet tab is not a station: it swaps the tickets for the hold cabinet, on the same screen.
    tabOptions.push({ id: 'cabinet', label: 'Cabinet', icon: 'thermometer', iconSize: 20, count: 0, alert: false, alertLabel: 'needs attention' });
    const seg = SB.ui.segmented({ kind: 'tabs', label: 'Station', options: tabOptions, value: m.zone, onChange: goZone, class: 'fl-seg' });
    // Screen readers get the full station name and what the count means. The eye sees the station's name, or its
    // short code (PIT, FRY) where the tab is too narrow for the name (see fitTabs).
    TABS.forEach((id) => {
      const b = seg.querySelector('[data-id="' + id + '"]');
      if (!b) return;
      if (id !== 'all') b.dataset.zone = id;
      const lab = b.querySelector('.seg-label');
      if (lab && id !== 'all') { const z = zoneById(id); U.clear(lab); lab.append(h('span', { class: 'fl-tab-full' }, z.name), h('span', { class: 'fl-tab-code', 'aria-hidden': 'true' }, z.code)); }
      // Expo is the one tab a new cook cannot guess, so it says what it is when pointed at or read aloud.
      if (id === 'expo') b.title = EXPO_WHAT;
      b.insertBefore(h('span', { class: 'visually-hidden' }, (id === 'all' ? 'All stations' : id === 'expo' ? EXPO_WHAT : zoneById(id).long) + ', '), b.firstChild);
      b.appendChild(h('span', { class: 'visually-hidden fl-tab-what', dataset: { here: id === 'all' || id === 'expo' ? 'no' : 'yes' } }, tabWhat(0, id)));
    });
    const tabs = h('div', { class: 'fl-tabs' }, seg);

    // The sanitize chip opens a menu to log a check.
    // The word and the time sit in one label with a plain space between them, so it never reads "Sanitize  not logged".
    const sanChip = h('button', { type: 'button', class: 'chip fl-chip fl-san', dataset: { tone: 'info' }, onClick: (e) => sanitiseMenu(e.currentTarget) }, ico('shield-check', 18),
      h('span', { class: 'fl-san-l' }, h('span', { class: 'fl-chip-w' }, 'Sanitize'), ' ', h('span', { class: 'fl-chip-t' }, '')));
    // The demo chip opens the demo sheet.
    const demoChip = h('button', { type: 'button', class: 'chip fl-chip fl-demo-chip', dataset: { tone: 'info' }, hidden: true, onClick: () => openSheet('demo') }, ico('fast-forward', 18), h('span', { class: 'fl-chip-t' }, 'Demo'));
    const status = h('div', { class: 'fl-status' }, sanChip, demoChip);

    // Builds one header button: icon, short label and count badge. Returns its parts for later updates.
    const tool = (id, icon, label, short, key, sheet) => {
      const n = h('span', { class: 'fl-tool-n num', hidden: true });
      const lab = h('span', { class: 'fl-tool-label' }, short);
      // A tool button opens its sheet; the key in brackets in the tooltip is the shortcut.
      const b = h('button', { type: 'button', class: 'btn fl-tool', dataset: { tool: id }, 'aria-keyshortcuts': key || null, onClick: () => (typeof sheet === 'function' ? sheet() : openSheet(sheet)) }, ico(icon, 24), lab, n);
      try { SB.ui.tooltip(b, label + (key ? ' (' + key + ')' : '')); } catch (e) { /* ignore */ }
      return { b, n, lab, label };
    };
    const tRecall = tool('recall', 'history', 'Recall', 'Recall', 'R', 'recall');
    const tHold = tool('hold', 'thermometer', 'Hold cabinet', 'Hold', 'H', toggleCabinet);
    // "86" is kitchen slang a new cook may not know, so the button says Sold out with a small 86 beside the icon.
    const t86 = tool('board86', 'ban', 'Sold out (86 board)', 'Sold out', '8', 'board86');
    t86.b.insertBefore(h('span', { class: 'fl-tool-hint', 'aria-hidden': 'true' }, '86'), t86.lab);
    const tDemo = tool('demo', 'play', 'Demo', 'Demo', 'D', 'demo');
    // The Hold button is not in the header any more: the Cabinet tab next to the stations is that button, with its count.
    // Front counter opens the full-screen order page for a visit; it does not turn this tablet into an order-only one.
    const tFront = tool('front', 'receipt', 'Front counter: the full-screen order page', 'Front counter', null, () => F.openCounter());
    const tools = h('div', { class: 'fl-tools' }, tRecall.b, t86.b, tFront.b, tDemo.b);
    // Orders is a main button, not a tool: it stays in the header at every width, next to New ticket, because the counter
    // lives in it (open orders, add a round, take payment). The badge counts the orders still open.
    const tOrders = tool('orders', 'receipt', 'Open orders', 'Orders', 'O', 'orders');
    tOrders.b.classList.add('fl-orders'); tOrders.lab.classList.add('fl-orders-label');

    // New ticket opens the order sheet. Menu opens the full menu, or a short list on a narrow screen.
    const newBtn = h('button', { type: 'button', class: 'btn btn-primary fl-new', 'aria-keyshortcuts': 'N', onClick: () => openSheet('order') }, ico('plus', 26, { stroke: 2.5 }), h('span', null, 'New ticket'));
    const menuBtn = h('button', { type: 'button', class: 'btn fl-menu', 'aria-label': 'Settings', onClick: (e) => { if (mq('(max-width: 999px)') || headSqueezed()) quickMenu(e.currentTarget); else openSheet('menu'); } }, ico('menu', 22), h('span', { class: 'fl-menu-label' }, 'Settings'), h('span', { class: 'fl-menu-dot', hidden: true, 'aria-hidden': 'true' }));
    // Back office is a plain labeled button for managers: sales, speed, stock and the menu. It asks for the PIN when one is set.
    const officeBtn = h('button', { type: 'button', class: 'btn fl-tool fl-office', 'aria-label': 'Back office', 'aria-keyshortcuts': 'Control+Shift+O', onClick: (e) => openOffice(e.currentTarget) }, ico('gauge', 24), h('span', { class: 'fl-tool-label fl-office-label' }, 'Back office'));
    try { SB.ui.tooltip(officeBtn, 'Back office: sales, speed, stock and your menu'); } catch (e) { /* ignore */ }
    const brandBox = h('div', { class: 'fl-brand' }, brand);
    const spacer = h('div', { class: 'fl-spacer', 'aria-hidden': 'true' });
    const head = h('header', { class: 'fl-head' }, brandBox, tabs, spacer, status, tools, newBtn, tOrders.b, officeBtn, menuBtn);
    // The same parts in two orders; layoutHead picks one so keyboard order matches what the eye sees.
    m.headParts = { wide: [brandBox, tabs, spacer, status, tools, newBtn, tOrders.b, officeBtn, menuBtn], narrow: [brandBox, spacer, status, tools, newBtn, tOrders.b, officeBtn, menuBtn, tabs] };
    // WATCH OUT: on a portrait tablet the Sanitize chip, Recall and 86 sit on the top row with New ticket, so a cook reaches them without the Menu.
    // On a phone (700 px or less) the stylesheet moves them into the Menu list.

    // ----- board
    const grid = h('div', { class: 'fl-grid' });
    const empty = h('div', { class: 'fl-empty', hidden: true });
    const welcome = buildWelcome();
    const cabEl = h('section', { class: 'fl-cabinet', hidden: true, 'aria-label': 'Hold cabinet' }, h('h2', { class: 'visually-hidden' }, 'Hold cabinet'));
    // While one station is showing, a bar says so in words, with a one-tap way back: a ticket on a station tab lists only that
    // station's dishes, and without the bar a cook can take a five-dish order for a one-dish one.
    const stationText = h('span', { class: 'fl-station-t' });
    // Show all goes back to every station's tickets.
    const showAll = h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'show-all' }, onClick: () => goZone('all') }, ico('grid', 18), h('span', null, 'Show all'));
    const stationBar = h('div', { class: 'fl-station-bar', hidden: true, role: 'status' }, ico('filter', 20), stationText, showAll);
    m.stationBar = stationBar; m.stationText = stationText;
    const main = h('main', { class: 'fl-main', id: 'fl-board', tabindex: -1, 'aria-label': 'Tickets' }, h('h1', { class: 'visually-hidden' }, 'Smokebox kitchen board'), welcome, stationBar, grid, empty, cabEl);

    // ----- dock
    const dockToggle = h('button', { type: 'button', class: 'fl-dock-toggle', 'aria-expanded': 'true', 'aria-controls': 'fl-dock-list', onClick: toggleDock },
      ico('chevron-down', 20), h('span', { class: 'fl-dock-title' }, 'All day'), h('span', { class: 'fl-dock-sum num' }));
    // Clear highlight removes the all-day highlight.
    const dockClear = h('button', { type: 'button', class: 'btn fl-dock-clear', hidden: true, onClick: () => F.highlight(null) }, ico('x', 18), h('span', null, 'Clear highlight'));
    const dockList = h('div', { class: 'fl-dock-list', id: 'fl-dock-list', role: 'group', 'aria-label': 'Items still to make, tap one to highlight it on the board' });
    const dockEmpty = h('span', { class: 'fl-dock-empty' }, 'Nothing to cook.');
    // "+3 more" says how many dish chips did not fit on the strip's one line; tapping it shows them all (and again folds them).
    const dockMore = h('button', { type: 'button', class: 'btn fl-dock-more', hidden: true, 'aria-controls': 'fl-dock-list', 'aria-expanded': 'false', onClick: () => { m.dockOpen = !m.dockOpen; fitDock(); measureDock(); } }, h('span', null, ''));
    // A quiet stamp of the last time the board updated itself, so a frozen or sleeping screen shows an old time.
    const checked = h('span', { class: 'fl-checked num', title: 'The board updates itself every second. If this time stops moving, reload the page.' });
    // Full screen hides the browser's address bar and buttons on a tablet. It shows only where the browser can do it.
    const fullBtn = h('button', { type: 'button', class: 'btn fl-full', hidden: true, onClick: goFull }, ico('maximize', 20), h('span', null, 'Full screen'));
    const dock = h('footer', { class: 'fl-dock' }, dockToggle, dockClear, dockList, dockMore, dockEmpty, checked, fullBtn);
    m.checked = checked; m.dockMore = dockMore; m.fullBtn = fullBtn;
    // Leaving or entering full screen (also with the browser's own gesture) shows or hides the button.
    const onFull = () => paintFull();
    doc.addEventListener('fullscreenchange', onFull); doc.addEventListener('webkitfullscreenchange', onFull);
    m.offs.push(() => { doc.removeEventListener('fullscreenchange', onFull); doc.removeEventListener('webkitfullscreenchange', onFull); });
    // While a pointer is over the strip its chips stay put, see renderDock.
    dock.addEventListener('pointerenter', () => { m.dockHover = true; });
    dock.addEventListener('pointerleave', () => { m.dockHover = false; });

    // The attention strip sits under the header and lists the most urgent deadlines; it is hidden when nothing is due.
    const strip = buildStrip();
    // Wall mode panes: orders and payments on the left, the manager glance on the right. Built once here and only
    // patched later; the stylesheet shows them when data-wall is on.
    const wl = buildWallOrders(), wr = buildWallGlance();
    // A small pill that says how many tickets are out of sight below the screen; one tap scrolls down a screen.
    const belowT = h('span', null, '');
    const below = h('button', { type: 'button', class: 'btn fl-below', hidden: true, onClick: () => { main.scrollBy({ top: Math.round(main.clientHeight * 0.85), behavior: reduced() ? 'auto' : 'smooth' }); } }, ico('chevron-down', 20), belowT);
    // The coach bar: the one thing to do next on this tab, in plain words. A tap jumps to that button and rings it.
    const coachT = h('span', { class: 'fl-coach-t' }, '');
    const coach = h('button', { type: 'button', class: 'fl-coach', hidden: true, 'aria-live': 'polite', onClick: () => spotCoach() }, h('span', { class: 'fl-coach-i', 'aria-hidden': 'true' }), coachT);
    m.coach = coach; m.coachT = coachT;
    root.append(head, strip.el, coach, wl.el, main, dock, wr.el, below);
    m.below = below; m.belowT = belowT;
    // Scrolling the board refreshes the pill once per animation frame at most.
    let belowRaf = 0;
    main.addEventListener('scroll', () => { if (!belowRaf) belowRaf = requestAnimationFrame(() => { belowRaf = 0; updateBelow(); }); }, { passive: true });
    const hlStyle = h('style', { class: 'fl-hl-style' });
    root.appendChild(hlStyle);
    m.el.appendChild(root);

    m.tabParts = {};
    TABS.forEach((id) => { const b = seg.querySelector('[data-id="' + id + '"]'); if (b) m.tabParts[id] = { count: b.querySelector('.seg-count'), n: -1 }; });
    m.seg = seg; F.applyHiddenTabs();
    m.sanText = sanChip.querySelector('.fl-chip-t');
    Object.assign(m, { wl, wr, head, seg, tabs, sanChip, demoChip, status, tools, tool: { recall: tRecall, hold: tHold, board86: t86, demo: tDemo, orders: tOrders, front: tFront }, newBtn, officeBtn, menuBtn, strip, main, cabEl, grid, empty, dock, dockToggle, dockClear, dockList, dockEmpty, hlStyle });

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
    if (typeof ResizeObserver === 'function') { m.ro = new ResizeObserver(() => { measureDock(); paintDensity(); fitHead(); fitDock(); }); m.ro.observe(dock); m.ro.observe(main); }
    paintDockToggle();
    paintFull();
    paintWall();
    // The window width decides whether wall mode can show; check it again when the window is resized.
    const onWin = () => paintWall();
    g.addEventListener('resize', onWin);
    m.offs.push(() => g.removeEventListener('resize', onWin));
    layoutHead(true);
    fitHead();
    try {
      const q = g.matchMedia('(max-width: 999.98px)');
      // Re-orders the header when the screen crosses the tablet breakpoint (tabs on their own row below 1000 px), then squeezes it to fit.
      const fn = () => { layoutHead(false); fitHead(); };
      if (q.addEventListener) { q.addEventListener('change', fn); m.offs.push(() => q.removeEventListener('change', fn)); }
    } catch (e) { /* ignore */ }
  }

  // Shows the wall panes when the setting is on and the window is wide enough; otherwise the board is as before.
  function paintWall() {
    if (!m || !m.root) return;
    const on = wall && g.innerWidth >= WALL_MIN_PX;
    const v = on ? 'on' : 'off';
    if (m.root.dataset.wall !== v) { m.root.dataset.wall = v; m.fitKey = null; setTimeout(() => { if (m) { paintDensity(); fitHead(); } }, 0); }
    // The glance panel is made when the wall shows and taken down when it hides (or with the board), so its 5-second
    // refresh never runs behind a board that is not showing it.
    if (on && !m.glance && SB.office && typeof SB.office.glance === 'function') {
      try { const gh = SB.office.glance(m.wr.body, { size: 'wall' }); m.glance = gh; m.offs.push(() => { if (m && m.glance === gh) m.glance = null; gh.destroy(); }); } catch (e) { console.error('[smokebox] glance failed', e); }
    } else if (!on && m.glance) { const gh = m.glance; m.glance = null; try { gh.destroy(); } catch (e) { /* already gone */ } }
    if (on) updateWall(store().now());
  }
  // Builds a pane: a title and a body, with the parts the updates change handed back.
  function wallPane(cls, title, label) {
    const body = h('div', { class: 'fl-wall-body' });
    const el = h('aside', { class: 'fl-wall ' + cls, 'aria-label': label }, h('h2', { class: 'fl-wall-h' }, title), body);
    return { el, body };
  }
  // The left pane: open orders (oldest first) and what was paid today. Rows are added once per order and then patched.
  function buildWallOrders() {
    const p = wallPane('fl-wall-orders', 'Open orders and payments', 'Open orders and payments');
    p.openH = h('h3', { class: 'fl-wall-sub' }, 'Open'); p.openL = h('ul', { class: 'fl-wall-list' }); p.openMore = h('p', { class: 'fl-wall-more', hidden: true });
    p.paidH = h('h3', { class: 'fl-wall-sub' }, 'Paid today'); p.paidL = h('ul', { class: 'fl-wall-list' }); p.paidMore = h('p', { class: 'fl-wall-more', hidden: true });
    p.rows = new Map();
    p.body.append(p.openH, p.openL, p.openMore, p.paidH, p.paidL, p.paidMore);
    return p;
  }
  // The right pane is the manager glance from the back office (SB.office.glance, wall size). It is drawn once, the
  // first time the wall shows, and refreshes itself every 5 seconds; this only builds its empty pane.
  function buildWallGlance() { return wallPane('fl-wall-glance', 'Manager glance', 'Manager glance'); }
  // Rewrites the orders pane from the store: text and attributes only, rows keyed by order id.
  function updateWall(now) {
    if (!m || !m.wl || m.root.dataset.wall !== 'on') return;
    const state = store().getState();
    const gl = SB.deadlines.wallOrders(state, now), M2 = U.fmtMoney;
    // Orders: keep rows for the first 10 open and 6 paid, patch their text, drop the rest.
    const P = m.wl, want = [];
    gl.open.slice(0, 10).forEach((o) => want.push({ key: 'o' + o.id, list: P.openL, text: o.name, meta: o.rounds + ' ' + U.plural(o.rounds, 'round') + ', ' + M2(o.total) }));
    gl.paid.slice(0, 6).forEach((o) => want.push({ key: 'p' + o.id, list: P.paidL, text: o.name, meta: M2(o.total) + ', ' + (C.payMethodById && C.payMethodById[o.method] ? C.payMethodById[o.method].name.toLowerCase() : o.method) + ', ' + U.fmtTime(o.at) }));
    const keep = new Set();
    for (const w of want) {
      keep.add(w.key);
      let r = P.rows.get(w.key);
      if (!r) { r = { li: h('li', { class: 'fl-wall-row' }, h('span', { class: 'fl-wall-name', dir: 'auto' }), h('span', { class: 'fl-wall-meta num' })), a: null, b: null }; r.a = r.li.firstChild; r.b = r.li.lastChild; P.rows.set(w.key, r); w.list.appendChild(r.li); }
      setTxt(r.a, w.text); setTxt(r.b, w.meta);
    }
    for (const [k, r] of Array.from(P.rows)) if (!keep.has(k)) { r.li.remove(); P.rows.delete(k); }
    setTxt(P.openH, 'Open (' + gl.open.length + ')'); setTxt(P.paidH, 'Paid today (' + gl.paidCount + ')');
    setHidden(P.openMore, gl.open.length <= 10); if (gl.open.length > 10) setTxt(P.openMore, 'and ' + (gl.open.length - 10) + ' more');
    setHidden(P.paidMore, gl.paid.length <= 6); if (gl.paid.length > 6) setTxt(P.paidMore, 'and ' + (gl.paid.length - 6) + ' more paid');
  }

  // Shows the Full screen button only on a touch screen whose browser can go full screen and is not full screen already.
  function paintFull() {
    if (!m || !m.fullBtn) return;
    const de = doc.documentElement;
    const can = !!(de && (de.requestFullscreen || de.webkitRequestFullscreen)) && doc.fullscreenEnabled !== false;
    const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    setHidden(m.fullBtn, !(can && !isFull && mq('(pointer: coarse)')));
  }
  // Asks the browser for full screen (it allows this only right after a tap), then checks the button again.
  function goFull() {
    const de = doc.documentElement;
    try { const r = (de.requestFullscreen || de.webkitRequestFullscreen).call(de); Promise.resolve(r).then(paintFull, paintFull); } catch (e) { paintFull(); }
  }
  // Opens the full-screen order page as a visit: the order page's back link returns to the board, and the tablet keeps its job.
  F.openCounter = function () { if (SB.router && SB.router.go) SB.router.go({ kind: 'new' }, { visit: true }); };

  // Tests a CSS media query; false where matchMedia is missing.
  const mq = (q) => { try { return g.matchMedia(q).matches; } catch (e) { return false; } };
  // Orders the header parts for the current width (on a phone the tabs wrap under the buttons).
  // WATCH OUT: the DOM order is changed to match, so keyboard order follows the eye. Focus is restored.
  function layoutHead(force) {
    if (!m || !m.headParts) return;
    const narrow = mq('(max-width: 999.98px)');
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
  const headKey = () => [m.head.clientWidth, m.sanText.textContent.length, m.demoChip.hidden ? 0 : m.demoChip.textContent.length, m.seg.querySelectorAll('.seg-opt:not([hidden])').length, m.root.dataset.tools || ''].join(':');
  // Squeezes the header step by step until it fits on one row: first the station names become short codes, then the tab
  // icons go, then the status chips, then the tool buttons. Everything that goes is still in the Menu list.
  // WATCH OUT: it always starts again from the full header, so a wider window gets everything back.
  function fitHead() {
    if (!m || !m.head) return;
    const hd = m.head;
    delete hd.dataset.fit;
    if (!m.narrow) {
      for (const stage of ['codes', 'icons', 'status', 'labels', 'toollabels', 'tools']) {
        if (!headWrapped()) break;
        hd.dataset.fit = stage;
      }
    }
    fitTabs();
    m.fitKey = headKey();
  }
  // On the row of tabs under the buttons (tablets and phones), a tab whose station name does not fit shows its short
  // code (PIT, FRY) instead; the others keep their names. All and Cabinet have no code, so a tight one drops its icon. Reads every width first, then writes, so it lays out once.
  function fitTabs() {
    const tabs = Array.from(m.seg.querySelectorAll('.seg-opt'));
    tabs.forEach((b) => { if (b.dataset.short) delete b.dataset.short; });
    if (!m.narrow) return;
    // A tab is tight when its icon and name together are wider than the room inside its padding.
    const tight = tabs.map((b) => {
      if (!b.offsetWidth) return false;
      const cs = g.getComputedStyle(b), lab = b.querySelector('.seg-label'), icon = b.querySelector('svg');
      const room = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const iw = icon && cs.flexDirection !== 'column' && icon.getBoundingClientRect().width ? icon.getBoundingClientRect().width + (parseFloat(cs.columnGap) || 0) : 0;
      return !!lab && lab.scrollWidth + iw > room + 0.5;
    });
    tabs.forEach((b, i) => { if (tight[i]) b.dataset.short = 'true'; });
  }
  // The hidden words after a tab's count: "ticket" for one, "tickets" for the rest, and "with work here" on a station tab.
  function tabWhat(n, id) { return ' ' + U.plural(n, 'ticket') + (id === 'all' || id === 'expo' ? '' : ' with work here'); }
  // Runs every second: refits the header only when its width or chip text changed, so most ticks cost nothing.
  function refit() {
    if (m && m.head && headKey() !== m.fitKey) fitHead();
    queueToastTop();
  }
  // True when the header has moved the status chips or tool buttons into the Menu list.
  const headSqueezed = () => !!m.head && (m.head.dataset.fit === 'status' || m.head.dataset.fit === 'labels' || m.head.dataset.fit === 'toollabels' || m.head.dataset.fit === 'tools');
  // Asks for the toast position to be measured once at the start of the next frame, so the reading happens after this tick's writes
  // and shares one layout with the frame instead of forcing its own every second.
  function queueToastTop() {
    if (!m || m.ttQ) return;
    if (typeof g.requestAnimationFrame !== 'function') { measureToastTop(); return; }
    m.ttQ = g.requestAnimationFrame(() => { if (m) { m.ttQ = 0; measureToastTop(); } });
  }
  // In the cabinet view toasts move to the top right, under the header and the attention strip, so they never cover a card's buttons.
  // This tells the stylesheet where the page below the strip starts (--fl-toast-top).
  function measureToastTop() {
    if (!m || !m.main) return;
    // Everyday toasts sit just under the header, over the notice strip, where they hide no ticket button.
    // While the clock notice shows, toasts start below it so they never cover its two buttons.
    const cb = m.strip && m.strip.clockBar && !m.strip.clockBar.hidden ? m.strip.clockBar.getBoundingClientRect().bottom : 0;
    if (m.head) doc.documentElement.style.setProperty('--fl-head-bottom', Math.round(Math.max(m.head.getBoundingClientRect().bottom, cb) + 6) + 'px');
    if (m.cabOn) doc.documentElement.style.setProperty('--fl-toast-top', Math.round(m.main.getBoundingClientRect().top + 8) + 'px');
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
    if (on && roleNow() === 'front') return; // a front-of-house device has no cabinet
    if (on && !cookOn()) return; // the cook-ahead module is off and no batch holds food
    if (!m || !SB.hold) { if (on) openSheet('hold'); return; }
    if (on) {
      if (!m.cab) m.cab = SB.hold.mount(m.cabEl, opts && opts.tab ? { tab: opts.tab } : {});
      else if (opts && opts.batchId) m.cab.highlight(opts.batchId);
      if (opts && opts.batchId && m.cab && !m.cabOn) m.cab.highlight(opts.batchId);
    } else if (m.cab) { m.cab.destroy(); m.cab = null; }
    m.cabOn = !!on;
    m.root.dataset.cabinet = on ? 'on' : 'off';
    doc.documentElement.dataset.cabinet = on ? 'on' : 'off';
    queueToastTop();
    for (const el of [m.grid, m.empty, m.welcome, m.dock]) if (el) el.style.display = on ? 'none' : '';
    setHidden(m.cabEl, !on);
    m.seg.setValue(on ? 'cabinet' : m.zone);
    m.main.setAttribute('aria-label', on ? 'Hold cabinet' : m.zone === 'all' ? 'Tickets for all stations' : 'Tickets for ' + zoneById(m.zone).name);
    if (!on) { m.dock.hidden = false; measureDock(); }
    if (on) { const lift = doc.documentElement.style; lift.setProperty('--fl-lift', '0px'); }
  }
  // Switches between the tickets and the cabinet (the Hold button and the H key).
  function toggleCabinet() { showCabinet(!(m && m.cabOn)); }
  // Called when a tab is chosen: asks the router to change the address (so Back works), then switches.
  function goZone(id) {
    if (id === 'cabinet') { showCabinet(true); return; }
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
    rankOverdue();
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
      if (!rec) {
        // After a tab switch only the first slips are built now; the rest come in the next pass.
        if (m.buildLimit && added.length >= m.buildLimit) { m.deferred = true; continue; }
        rec = buildSlip(t, mode, now); m.slips.set(t.id, rec); added.push(rec);
      } else syncSlip(rec, t, now);
      want.push(rec);
    }
    for (const rec of Array.from(m.slips.values())) if (!seen.has(rec.id)) removeSlip(rec);
    m.want = want;
    reorder(m.grid, lateFirst(want).map((r) => r.el));
    // Slips present at the first draw just appear; later arrivals print in.
    if (!m.first && added.length) added.forEach((rec, i) => printIn(rec, i));
    else added.forEach((rec) => { if (m.io) m.io.observe(rec.el); });
    m.first = false;

    // the one-station bar
    const oneStation = mode === 'station' && zone !== 'cabinet';
    setHidden(m.stationBar, !oneStation);
    if (oneStation) setTxt(m.stationText, 'Showing ' + zoneById(zone).name + ' only. Tickets list just this station\'s dishes.');

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
    paintSelection();
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

  // Counts the tickets that start below the visible board and shows or hides the "N more tickets below" pill.
  // WATCH OUT: reads the position of every ticket, so it runs on scroll and about once a second, not on every change.
  function updateBelow() {
    if (!m || !m.below) return;
    const main = m.main;
    let n = 0;
    if (!m.cabOn && main.clientHeight > 0 && main.scrollHeight > main.clientHeight + 4) {
      const bottom = main.getBoundingClientRect().bottom;
      // The slips run row by row down the page, so the first one below the screen is found by halving (a few reads, not one per ticket).
      const kids = m.grid.children;
      let lo = 0, hi = kids.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (kids[mid].getBoundingClientRect().top >= bottom - 8) hi = mid; else lo = mid + 1; }
      for (let i = lo; i < kids.length; i++) if (!kids[i].classList.contains('fl-leaving')) n++;
    }
    setHidden(m.below, n === 0);
    if (n) put(m.belowT, n + (n === 1 ? ' more ticket below' : ' more tickets below'));
  }

  // Gives an element one soft highlight so a changed ticket or dish catches the eye, then removes the hook.
  // WATCH OUT: no forced layout here, because 200 tickets can change state in the same second.
  function flash(el) {
    if (!el || reduced() || el.classList.contains('fl-flash')) return;
    el.classList.add('fl-flash');
    setTimeout(() => el.classList.remove('fl-flash'), 900);
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
    const who = h('span', { class: 'slip-who', dir: 'auto', id: uid + '-w' }, t.customer);
    const ch = C.channelById[t.channel] || { name: String(t.channel), icon: 'plate' };
    const count = h('span', { class: 'fl-count' });
    const meta = h('div', { class: 'slip-meta' }, h('span', { class: 'fl-chan' }, ico(ch.icon, 18), h('span', null, ch.name)), count,
      // Inside the demo every ticket is a demo ticket and the demo bar already says so, so the tag only shows beside real tickets.
      t.src === 'demo' && !(store().isDemo && store().isDemo()) ? h('span', { class: 'fl-demo-tag', title: 'Demo ticket: made by the demo, not a real order' }, 'Demo', h('span', { class: 'dt-more' }, ' ticket')) : null);
    const timer = h('span', { class: 'slip-timer num', dataset: { level: 'ok' } }, '00:00');
    const badge = buildBadge();
    const progI = h('i');
    const prog = h('div', { class: 'slip-progress', role: 'progressbar', 'aria-label': 'Progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, progI);
    const head = h('div', { class: 'slip-head' }, h('div', { class: 'slip-id' }, h('div', { class: 'fl-numrow' }, num, stampSlot), who, meta), h('div', { class: 'slip-time' }, timer, badge.el), prog);
    // A note that mentions an allergy gets the shield and one plain safety step under it.
    const allergic = !!t.note && modKind(t.note) === 'allergy';
    const note = t.note ? h('div', { class: 'slip-note', role: 'note', dataset: { kind: allergic ? 'allergy' : 'note' } }, ico(allergic ? 'shield' : 'alert', 22),
      h('span', null, h('span', { class: 'visually-hidden' }, allergic ? 'Allergy note: ' : 'Note: '), t.note, allergic ? h('span', { class: 'slip-note-do' }, 'Change gloves and wipe the board before you make this.') : null)) : null;
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
    if (check.length) { text = 'Check ' + list(check) + '. Tap Done when ready.'; tone = 'check'; }
    else if (start.length) { text = 'Tap START on ' + list(start) + '.'; tone = 'act'; }
    else if (make.length) { text = 'Make ' + list(make) + ', then tap Done.'; tone = 'act'; }
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

  // Special requests are typed freely, so a few words decide the picture a cook sees before reading: an allergy (shield), leave
  // something off (no sign), extra (plus) or a swap (arrow). Anything else stays a plain chip. Returns the kind or null.
  function modKind(text) {
    const t = String(text || '').toLowerCase().trim();
    if (/allerg|gluten|celiac|coeliac|peanut|tree nut|\bnuts?\b|dairy|lactose|shellfish|sesame|\begg\b/.test(t)) return 'allergy';
    if (/^(no|without|hold|plain|skip)\b/.test(t)) return 'no';
    if (/^(add|extra|double|plus)\b|^\+/.test(t)) return 'extra';
    if (/^(sub|swap|substitute)\b|\binstead\b|\bon (the )?side\b|->|→/.test(t)) return 'swap';
    return null;
  }
  // The icon for each kind of special request.
  const MOD_ICON = { allergy: 'shield', no: 'ban', extra: 'plus', swap: 'arrow-right' };
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
    const name = h('span', { class: 'slip-name', dir: 'auto' }, short ? h('span', { class: 'nm-full' }, it.name) : it.name, short ? h('span', { class: 'nm-short', 'aria-hidden': 'true' }, short) : null, sr);
    const sub = h('span', { class: 'fl-sub' });
    row.sr = sr;
    if (kind === 'deck') {
      row.deckT = h('span', { class: 'fl-deck-t' });
      sub.appendChild(h('span', { class: 'fl-deck' }, ico('clock', 16), row.deckT));
    }
    if (rec.mode !== 'station') sub.appendChild(zoneChip(it.zone));
    (it.mods || []).forEach((mod) => { const k = modKind(mod); const c = SB.ui.chip({ mod: true, label: mod, icon: k ? MOD_ICON[k] : null }); if (k) c.dataset.kind = k; sub.appendChild(c); });
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
      // The hidden words after the name already say the state, so the visible word is not read a second time ("done. Done").
      const stateEl = h('span', { class: 'fl-state', dataset: { state: it.status }, 'aria-hidden': 'true' }, row.stateIcon, row.stateWord);
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
  // The cook step a dish is on now (the latest one whose share of the cook time has passed), as its words, or '' when it has none.
  function stepNow(it, now) {
    if (it.startedAt == null || !(it.prepSec > 0)) return '';
    const md = store().getState().menu.find((x) => x.id === it.menuId);
    if (!md || !Array.isArray(md.steps)) return '';
    const pct = ((now - it.startedAt) / (it.prepSec * 1000)) * 100;
    let say = '';
    for (const st of md.steps) if (pct >= st.at) say = st.say;
    return say;
  }
  // Writes a tappable cooking row: the countdown under the name and the flash flag. A change to "Check it" is
  // spoken once and, when sound is on, chimes (only when live, so a reload stays quiet).
  function paintCook(row, it, now, live) {
    const ck = cookOf(it, now);
    const stp = stepNow(it, now);
    const txt = (stp && !ck.check ? stp + ' · ' : '') + (ck.check ? 'Check it ' + ck.time : ck.left == null ? 'Cooking ' + ck.time : ck.time + ' left');
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
    if (changed && row.status != null) flash(row.li); // a dish that changes state gets one soft highlight
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
    // How long past its overdue time the slip is; 0 while it is not overdue. The ranking below uses it.
    rec.overMs = lvl === 'breach' ? el - th.breachMs : 0;
    // One time per ticket: the timer. The badge says only "Overdue" (a second number beside the timer made people do sums),
    // and past an hour the timer reads "1h 05m" instead of "65:00".
    if (lvl === 'breach') put(rec.refs.bw, WORDS.breach);
    const txt = el < 3600e3 ? U.fmtClock(el) : Math.floor(el / 3600e3) + 'h ' + U.pad2(Math.floor(el / 60e3) % 60) + 'm';
    if (txt !== rec.timerText) { rec.timerText = txt; put(rec.refs.timer, txt); }
    if (lvl !== rec.level) {
      const prev = rec.level;
      rec.level = lvl;
      rec.el.dataset.level = lvl;
      rec.refs.timer.dataset.level = lvl;
      rec.refs.badge.dataset.level = lvl;
      if (lvl !== 'breach') put(rec.refs.bw, WORDS[lvl]);
      if (prev) flash(rec.el.querySelector('.slip-head')); // the head glows once when the ticket moves to a new time state
      if (announceBreach && lvl === 'breach' && prev && prev !== 'breach') say('Ticket #' + rec.num + ' is overdue.');
    }
  }

  // The slips with the overdue ones first (most overdue first) and the rest in the store's order. The page order is
  // this order, so keyboard and screen reader users meet the worst ticket first, just as the eye does.
  function lateFirst(recs) {
    const late = recs.filter((r) => r.overMs > 0).sort((a, b) => (b.overMs - a.overMs) || (a.num - b.num));
    return late.concat(recs.filter((r) => !(r.overMs > 0)));
  }
  // Ranks the overdue slips, most overdue first, and tells the stylesheet: data-tier 1 for the worst slip, 2 for the
  // next two, 3 for the rest. When the ranking changes the slips are also moved in the page, so the reading order
  // matches what is drawn; a focused control keeps its focus.
  // WATCH OUT: it only edits attributes and the slip order, and only when something changed.
  function rankOverdue() {
    const late = [];
    for (const rec of m.slips.values()) if (rec.overMs > 0) late.push(rec);
    late.sort((a, b) => (b.overMs - a.overMs) || (a.num - b.num));
    const ranked = new Set();
    late.forEach((rec, i) => {
      ranked.add(rec);
      const tier = i === 0 ? '1' : i < 3 ? '2' : '3';
      if (rec.tier !== tier) { rec.tier = tier; rec.el.dataset.tier = tier; }
    });
    for (const rec of m.slips.values()) {
      if (ranked.has(rec) || !rec.tier) continue;
      rec.tier = ''; delete rec.el.dataset.tier;
    }
    const key = late.map((r) => r.id).join(',');
    if (key !== m.lateKey && m.want) {
      m.lateKey = key;
      const keep = document.activeElement, had = keep && m.grid.contains(keep);
      reorder(m.grid, lateFirst(m.want.filter((r) => m.slips.get(r.id) === r)).map((r) => r.el));
      if (had && document.activeElement !== keep) { try { keep.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    // Late slips on screen right now, for the header and for tests.
    m.lateCount = late.length;
  }

  // Applies the device role to the header in place: the stylesheet hides what the role does not use (kitchen: New
  // ticket, Orders, Demo and Back office; front: the Cabinet tab). Runs every tick but only acts when the role changes.
  function paintRole() {
    const r = roleNow();
    if (m.role === r) return;
    m.role = r;
    m.root.dataset.role = r;
    if (r === 'front' && m.cabOn) showCabinet(false);
    m.fitKey = null; fitHead();
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
    const soundBar = h('button', { type: 'button', class: 'fl-strip-sound', onClick: () => { lastChime = 0; hookAudioUnlock(); resumeAudio(); playHere(() => { chime(); speak('Sound is on.'); }); } },
      ico('bell', 24), h('span', null, 'Tap to turn on sound'));
    // A clear (X) button for a notification: hides it until the thing it says changes. Notifications are not permanent.
    const clearBtn = (label, key) => h('button', { type: 'button', class: 'fl-strip-x', 'aria-label': label, title: label, onClick: (e) => { e.stopPropagation(); if (m) { m.dis.add(typeof key === 'function' ? key() : key); updateStrip(store().now()); } } }, ico('x', 24));
    // The clock notice: the tablet's clock jumped far ahead, the board keeps the old time and asks. Calm, two plain choices, and the board keeps working.
    const clockT = h('span', { class: 'fl-clock-t' });
    const clockKeep = h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'clock-keep' }, onClick: () => { if (m) { m.clockDis = Date.now() + 10 * 60e3; updateStrip(store().now()); } } }, 'Keep the old time');
    const clockUse = h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'clock-use' }, onClick: askClockUse }, 'Use the new time');
    const clockWrap = h('div', { class: 'fl-strip-bar fl-bar-clock', role: 'alert', hidden: true }, ico('clock', 22), clockT, clockKeep, clockUse);
    el.appendChild(clockWrap);
    const soundWrap = h('div', { class: 'fl-strip-bar fl-bar-sound', hidden: true }, soundBar, SB.guide && SB.guide.link ? SB.guide.link('troubleshooting', 'no sound') : null, clearBtn('Clear all notices', () => { if (m && m.noteKey) m.dis.add(m.noteKey); return 'snd'; }));
    el.appendChild(soundWrap);
    // The pause note: shown while sound is on but warnings are held back because the kitchen is closed. Tap for settings.
    const pauseBar = h('button', { type: 'button', class: 'fl-strip-sound fl-strip-pause', onClick: () => { if (!sound) F.setSound(true); else openSheet('menu'); } }, ico('volume-off', 24), h('span', { class: 'fl-strip-pause-t' }));
    const pauseWrap = h('div', { class: 'fl-strip-bar fl-bar-pause', hidden: true }, pauseBar, clearBtn('Clear this notice', () => 'pause:' + (pauseBar.textContent || '')));
    el.appendChild(pauseWrap);
    for (let i = 0; i < 3; i++) {
      const when = h('span', { class: 'fl-strip-when num' }), what = h('span', { class: 'fl-strip-what' }), why = h('span', { class: 'fl-strip-why' });
      // Acknowledges this row, then opens the hold cabinet on its batch, or just the cabinet when it is not about one batch.
      const openRow = () => { const r = rows[i]; if (!r || !r.key) return; acknowledge(r.key); if (r.batchId) openHoldFor(r.batchId); else showCabinet(true); };
      const row = h('button', { type: 'button', class: 'fl-strip-row', hidden: true, dataset: { i: String(i) }, onClick: openRow },
        when, h('span', { class: 'fl-strip-text' }, what, why));
      // Clearing a row counts as seeing it (the loud tone stops) and hides it until its next step on the ladder.
      const rowKey = () => { const r = rows[i]; return r && r.key ? 'row:' + r.key + ':' + (r.el.dataset.step || '') : ''; };
      const xr = h('button', { type: 'button', class: 'fl-strip-x', 'aria-label': 'Got it: clear this warning until the next one', title: 'Clear until the next warning', onClick: (e) => { e.stopPropagation(); const r = rows[i]; if (!r || !r.key) return; acknowledge(r.key); if (m) { m.dis.add(rowKey()); updateStrip(store().now()); } } }, ico('check', 22), h('span', { class: 'fl-strip-x-t' }, 'Got it'));
      const wrap = h('div', { class: 'fl-strip-rowwrap', hidden: true, dataset: { i: String(i) } }, row, xr);
      rows.push({ el: row, wrap, when, what, why, key: '', batchId: null, rowKey });
      el.appendChild(wrap);
    }
    // A visually hidden live region that changes only when a warning is announced (the leader tab), so a screen reader hears each warning once, never the ticking countdown.
    const announce = h('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    el.appendChild(announce);
    return { el, rows, clockBar: clockWrap, clockText: clockT, soundBar: soundWrap, pauseBar: pauseWrap, pauseBtn: pauseBar, announce };
  }
  // Shows the hold cabinet with one batch scrolled into view and flashed.
  function openHoldFor(batchId) { try { showCabinet(true, { batchId }); } catch (e) { console.error('[smokebox] cabinet failed', e); } }
  // The warning ladder: what was announced for each deadline, and what to sound now (see 25-deadlines.js).
  const ladder = SB.deadlines.makeLadder();
  // Keeps a short record of one sound the ladder asked for, so a test can replay a whole service and check every
  // alert. level: 1 chime, 2 voice, 3 loud tone, 4 expiry or past.
  function logCall(c) {
    const d = c.d;
    const lg = F._alerts;
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
    if (top.level === 4) expiryTone(); else if (top.level === 3) alarmTone(); else chime(true);
    if (top.level < 2 || top.repeat) return;
    const same = calls.filter((c) => c.level === top.level);
    const first = same.slice().sort((x, y) => x.d.msLeft - y.d.msLeft)[0].d;
    const who = first.label + (same.length > 1 ? ' and ' + (same.length - 1) + ' more' : '');
    // Says the phrase aloud and puts it in the hidden live region for screen readers.
    const tell = (t, kind) => { speak(t, false, kind); if (m && m.strip && m.strip.announce) m.strip.announce.textContent = t; };
    const PH = SB.deadlines.phrase, many = same.length > 1;
    if (top.level === 4 && first.kind === 'past') { tell(PH('past', { who, many }), 'past'); return; }
    if (top.level === 4) { tell(PH('expired', { who, many }), 'expired'); return; }
    const mins = Math.max(1, Math.round(first.msLeft / 60e3));
    tell(PH('expire', { who, many, mins, goes86: first.goes86, approx: top.level === 2 }), top.level >= 3 ? 'start' : 'expire');
  }
  // Asks, in a small box, whether to use the tablet's new time. It needs a second deliberate tap, and "Keep the old time" is the way out.
  function askClockUse() {
    const cs = store().status().clockSuspect;
    if (!cs || !SB.ui || !SB.ui.confirm) return;
    const days = Math.round(cs.aheadMs / 86400000);
    SB.ui.confirm({ title: 'Use the new time?', body: 'Timers and ages on every open ticket will jump forward by about ' + (days >= 2 ? days + ' days' : Math.round(cs.aheadMs / 3600000) + ' hours') + '. Only do this if the date and time on this tablet are right.', confirmLabel: 'Use the new time', cancelLabel: 'Keep the old time', tone: 'danger' })
      .then((yes) => { if (yes) { store().acceptClockJump(); if (m) updateStrip(store().now()); } else if (m) m.clockDis = Date.now() + 10 * 60e3; });
  }
  // Says a cold item's low-time row once when it first shows (or gets worse), in plain words that name the owner's limit.
  // The first pass after the board opens only remembers what is already there, so a reload does not read old news aloud.
  function sayColdRows(all) {
    if (!m.coldSaid) m.coldSaid = new Set();
    const live = new Set(), fresh = [];
    for (const d of all) {
      if (d.kind !== 'coldOut' && d.kind !== 'coldDate') continue;
      const key = d.id + ':' + d.sev;
      live.add(key);
      if (!m.coldSaid.has(key)) { m.coldSaid.add(key); fresh.push(d); }
    }
    for (const k of Array.from(m.coldSaid)) if (!live.has(k)) m.coldSaid.delete(k);
    if (!m.coldPrimed) { m.coldPrimed = true; return; }
    if (!fresh.length || !isLeader()) return;
    const d = fresh.sort((x, y) => x.msLeft - y.msLeft)[0];
    const mins = Math.max(0, Math.round(d.msLeft / 60e3));
    const text = d.kind === 'coldOut'
      ? d.label + (d.msLeft > 0 ? ': ' + mins + (mins === 1 ? ' minute' : ' minutes') + ' left of your out-of-fridge limit.' : ' is past your out-of-fridge limit.')
      : d.label + ': the last day of your fridge limit ends at midnight.';
    chime(true); speak(SB.deadlines.spoken ? SB.deadlines.spoken(text) : text, false, 'expire');
    if (m.strip && m.strip.announce) m.strip.announce.textContent = text;
  }
  // A tap on a strip row counts as seeing it: the loud tone stops until the next rung.
  function acknowledge(key) { saveAlertRecord({ t: store().now(), id: key, ack: true }); ladder.acknowledge(key); pending.forget(key); if (lead.coordinated && SB.store.broadcast) SB.store.broadcast({ type: 'alert-ack', id: key }); }
  // Rewrites the strip from the deadline feed: the top three rows, or hidden when the feed is empty.
  function updateStrip(now) {
    if (!m || !m.strip || !SB.deadlines) return;
    if (m.checked) { const t = U.fmtTime(Date.now()); if (m.checkedT !== t) { m.checkedT = t; m.checked.textContent = 'Updated ' + t; } }
    const all = SB.deadlines.build(store().getState(), now);
    m.feed = all;
    // Nothing sounds while the kitchen is closed; the rungs wait and sound once when it opens.
    syncLeadership();
    if (SB.deadlines.soundsAllowed(store().getState(), now)) {
      const calls = ladder.decide(all, now, store().getState());
      calls.forEach(logCall);
      // A tab that has just become the leader first catches up on sounds it held back that are still true.
      let late = [];
      if (lead.needDrain && isLeader()) { lead.needDrain = false; late = pending.drain(all, (id) => ladder.isAcked(id)); }
      playCalls(late.concat(calls));
      sayColdRows(all);
    }
    // Info rows only show for batches and run-outs; an expired notice goes away once someone taps it.
    // The strip is for what needs a cook soon: a row waits until the deadline is within the hour (or is already bad, past or out), so a quiet kitchen has no strip.
    const soon = (d) => d.sev === 'bad' || d.kind === 'past' || d.kind === 'expired' || !(d.msLeft > 60 * 60e3);
    if (!m.dis) m.dis = new Set();
    // With the cook-ahead part off (and no food in a batch) rows about batches, temperatures and sanitizing stay out of the strip.
    const ck = cookOn();
    // Counter service has no cooking steps and no late tickets, so the strip leaves those rows out.
    const co = counterOn();
    const ticketRow = (d) => co && (d.kind === 'late' || d.kind === 'start' || d.kind === 'ready' || d.kind === 'new');
    // Rows about batches, temperatures and sanitizing count as cook-ahead rows.
    const batchy = (d) => !ck && (d.batchId || d.kind === 'sanitize' || d.kind === 'check' || d.kind === 'shortfall' || d.kind === 'leftover' || d.kind === 'keepcheck' || d.kind === 'expiry' || d.kind === 'expired' || d.kind === 'past');
    const feed = all.filter((d) => !d.trivial && !batchy(d) && !ticketRow(d) && (d.sev !== 'info' || d.kind === 'expiry' || d.kind === 'leftover' || d.kind === 'keepcheck') && !(d.kind === 'expired' && ladder.isAcked(d.id)) && soon(d) && !m.dis.has('row:' + d.id + ':' + (d.step || '')));
    // A tablet screen is short: one warning row there (the next shows when this one is cleared or done), two on a tall or far screen.
    // A far display below 1300 px tall keeps one big row, so the tickets keep most of the screen; a taller one has room for two.
    const maxRows = !F.wallActive() && (far ? (g.innerHeight || 0) >= 1300 : (g.innerHeight || 0) >= 900) ? 2 : 1;
    const top = feed.slice(0, maxRows);
    const moreRows = feed.length - top.length;
    // Another tab on this device already leads and plays the sounds: this tab needs no tap, so it shows no bar.
    const otherLeads = lead.coordinated && !lead.isLeader && Array.from(lead.peers.values()).some((p) => p.lead && Date.now() - p.t < 3 * HELLO_MS);
    const needSound = sound && !audioReady() && !otherLeads;
    // Clearing the sound bar lasts only while the sound stays blocked: once it plays again, the next block shows the bar again.
    if (!needSound) m.dis.delete('snd');
    setHidden(m.strip.soundBar, !needSound || m.dis.has('snd'));
    // While sounds are held back the strip says so, so a quiet board is not mistaken for a broken one.
    // A board with sound switched off says so, so a silent board is not taken for a healthy quiet one.
    const health = awayNote() || historyWords() || awakeNote();
    const note = sound ? SB.deadlines.pauseNote(store().getState(), now) || health : 'Warnings are silent: sound is off on this tablet. Tap to turn on.';
    // A closed kitchen is not news while nothing is due: the note only shows when sound is off or a row is up.
    // The sound bar and the pause note say nearly the same thing, so only one of them shows at a time (the sound bar wins).
    // Only one notice shows at a time (the "tap for sound" bar first, then the note, once sound is on); the bar never hints at a hidden notice, and
    // its X clears them all. Warning rows above are separate and always show.
    // A device clock that jumped ahead comes first: it changes every timer on the board. It never hides the tickets.
    const cs = store().status().clockSuspect;
    const clockShown = !!cs && Date.now() >= (m.clockDis || 0);
    if (clockShown) {
      const dd = Math.round(cs.aheadMs / 86400000);
      const t = 'This tablet\'s clock jumped ahead by about ' + (dd >= 2 ? dd + ' days' : Math.round(cs.aheadMs / 3600000) + ' hours') + '. Smokebox is still using the old time, so tickets and timers keep running.';
      if (m.strip.clockText.textContent !== t) m.strip.clockText.textContent = t;
    }
    setHidden(m.strip.clockBar, !clockShown);
    queueToastTop();
    const soundShown = needSound && !m.dis.has('snd') && !clockShown;
    setHidden(m.strip.soundBar, !soundShown); // the clock notice goes first, so the sound bar waits behind it
    const noteWanted = !!note && (!sound || top.length > 0 || note === health) && !m.dis.has('pause:' + note);
    const showNote = noteWanted && !soundShown && !clockShown;
    m.noteKey = noteWanted ? 'pause:' + note : '';
    const moreEl = m.strip.soundBar.querySelector('.fl-strip-sound span');
    if (moreEl) { const t = noWebAudio() ? 'This browser cannot play warning sounds' : 'Tap to turn on sound'; if (moreEl.textContent !== t) moreEl.textContent = t; }
    setHidden(m.strip.pauseBar, !showNote);
    if (showNote) setTxt(m.strip.pauseBtn.querySelector('.fl-strip-pause-t'), note);
    if (showNote && m.histNote && note === m.histNote.words && !m.histSeen) { m.histSeen = true; try { SB.store.historyNoticeSeen(m.histNote.kind); } catch (e) { /* the store has no such call */ } }
    setHidden(m.strip.el, top.length === 0 && (!needSound || m.dis.has('snd')) && !showNote && !clockShown);
    m.strip.rows.forEach((r, i) => {
      const d = top[i];
      setHidden(r.wrap, !d);
      setHidden(r.el, !d);
      if (!d) { r.key = ''; return; }
      r.key = d.id; r.batchId = d.batchId || null;
      setTone(r.el, d.snoozedUntil ? 'info' : d.sev);
      setTone(r.wrap, d.snoozedUntil ? 'info' : d.sev);
      // Where the row is on its ladder (first, middle, last) and whether its reminder is put off; the stylesheet draws both.
      const stp = d.step || '', sn = d.snoozedUntil ? 'true' : 'false';
      if (r.el.dataset.step !== stp) r.el.dataset.step = stp;
      if (r.el.dataset.snoozed !== sn) r.el.dataset.snoozed = sn;
      setTxt(r.when, d.kind === 'expired' ? 'OUT' : d.kind === 'past' ? 'PAST' : countdownText(d.msLeft));
      // How many more warnings wait behind this one goes on the short name line, where a long explanation cannot cut it off.
      setTxt(r.what, d.label + (i === top.length - 1 && moreRows > 0 ? '   +' + moreRows + ' more' : ''));
      // What to do comes first ("Use it first."), then why, so the words a cook needs are the ones read first.
      setTxt(r.why, (d.snoozedUntil ? 'Reminder at ' + U.fmtTime(d.snoozedUntil) + '. ' : '') + d.action + ' ' + d.consequence);
    });
  }

  // Shows or hides everything that belongs to the cook-ahead part: the Cabinet tab, the Hold button and the sanitize chip.
  // A cabinet that is open when the part switches off goes back to the tickets.
  function applyCook(on) {
    if (m.ck === on) return;
    m.ck = on;
    const tab = m.seg.querySelector('[data-id="cabinet"]');
    if (tab) tab.hidden = !on;
    if (m.tool.hold && m.tool.hold.b) m.tool.hold.b.hidden = !on;
    if (m.sanChip) m.sanChip.hidden = !on;
    m.fitKey = null; // the header has different contents now, so fit it again
    if (!on && m.cabOn) showCabinet(false);
  }

  // Refreshes what depends on data or time: tab counts and overdue dots, button counts, sanitize and
  // demo chips. Runs after every draw and tick. WATCH OUT: edits text and attributes only, no new nodes.
  function updateHeader(now) {
    if (!m) return;
    const S = store();
    const c = S.select.counts();
    m.counts = c;
    applyCook(cookOn());
    { const co = counterOn() ? 'on' : 'off'; if (m.root.dataset.counter !== co) { m.root.dataset.counter = co; m.fitKey = null; }
      // At the counter there is one list of orders, so a station tab left open is switched back to All.
      if (co === 'on' && m.zone !== 'all') F.setZone('all'); }
    if (!m.belowAt || now - m.belowAt > 1000 || now < m.belowAt) { m.belowAt = now; updateBelow(); }
    paintRole();
    updateStrip(now);
    driveCallouts(now);
    paintCoach(now);
    if (m.root.dataset.wall === 'on') updateWall(now);
    // station tabs
    // Sets one tab's count and overdue dot; the corner badge dims at zero.
    const tabCount = (id, n, alert) => {
      m.seg.setCount(id, n, { alert });
      const what = m.seg.querySelector('[data-id="' + id + '"] .fl-tab-what');
      if (what) { const t = tabWhat(n, id); if (what.textContent !== t) what.textContent = t; }
      // Read aloud as one clean phrase ("Expo 3: whole tickets, ready to send out, 3 tickets, some overdue"), not the pieces one after another.
      const tb = m.seg.querySelector('[data-id="' + id + '"]');
      // It starts with the words on the tab ("All 4"), so a person using voice control can say what they see.
      if (tb) { const z = id === 'all' ? null : zoneById(id), al = (z ? z.name : 'All') + ' ' + n + ': ' + (id === 'all' ? 'All stations' : id === 'expo' ? 'whole tickets, ready to send out' : z.long) + ', ' + n + tabWhat(n, id) + (alert ? ', some overdue' : ''); if (tb.getAttribute('aria-label') !== al) tb.setAttribute('aria-label', al); }
      const p = m.tabParts[id];
      if (p && p.n !== n) { p.n = n; p.count.dataset.zero = n === 0 ? 'true' : 'false'; }
    };
    tabCount('all', c.all, c.overdue > 0);
    C.zones.forEach((z) => {
      if (z.id === 'expo') tabCount('expo', c.expo, c.overdue > 0);
      else tabCount(z.id, c.zones[z.id] || 0, (c.overdueByZone[z.id] || 0) > 0);
    });
    F.applyHiddenTabs();
    // An empty kitchen (no dishes, no tickets) has nothing to recall, sell out or take orders for, so those buttons wait.
    { const v = hasWork() ? 'on' : 'off'; if (m.root.dataset.tools !== v) { m.root.dataset.tools = v; m.fitKey = null; } }
    // tools with counts
    const recentN = recentCount(S, now);
    toolCount(m.tool.recall, recentN, '', recentN ? recentN + ' recently bumped' : '');
    toolCount(m.tool.hold, c.hold, 'warn', holdReason(c));
    m.seg.setCount('cabinet', c.hold, { alert: c.hold > 0 });
    { const cc = m.seg.querySelector('[data-id="cabinet"] .seg-count'); if (cc) cc.dataset.zero = c.hold === 0 ? 'true' : 'false'; }
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
    // Only a running simulator counts: its rate field always holds a value (normal by default), so it says nothing.
    const running = !!(live && (live.running || live.on || live.orders));
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
    const menuName = needs ? 'Settings, something needs a look' : 'Settings';
    if (m.menuBtn.getAttribute('aria-label') !== menuName) m.menuBtn.setAttribute('aria-label', menuName);
    toolCount(m.tool.demo, demoOn ? 1 : 0, 'warn', demoOn ? (speed > 1 ? 'clock running at x' + (Math.round(speed * 10) / 10) : 'demo orders running') : '', demoOn ? (speed > 1 ? 'x' + (Math.round(speed * 10) / 10) : 'on') : '');
    refit();
  }
  // True once the kitchen has a dish on its menu or any ticket, open or recently bumped.
  function hasWork() {
    const st = store().getState();
    return st.menu.some((d) => !d.archived) || (st.tickets && st.tickets.length > 0) || recentCount(store(), store().now()) > 0;
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
      { label: 'Mark surfaces sanitized', icon: 'check-circle', onClick: () => { const go = (who) => run('sanitizeDone', who ? { who } : {}); if (SB.who && SB.who.ask) SB.who.ask(anchor, 'Mark sanitized', go); else go(''); } },
      // Readings opens the sheet for fridge, thermometer and sanitizer strip numbers.
      { label: 'Readings: fridge, thermometer, strip', icon: 'thermometer', onClick: () => openSheet('readings') },
      { label: 'Open the hold cabinet', icon: 'thermometer', onClick: () => showCabinet(true) },
    ].filter((it) => !(roleNow() === 'front' && /cabinet/.test(it.label))), { label: 'Sanitize timer' });
  }
  // On a narrow screen the Menu button opens this list: the buttons that no longer fit, plus settings.
  function quickMenu(anchor) {
    const c = m.counts || {}, role = roleNow();
    // Kitchen devices skip order entry, orders, demo and the back office; front devices skip the cabinet.
    const kit = role === 'kitchen', front = role === 'front';
    const items = [
      // The back office is the first row so a manager never has to hunt for it.
      { hide: kit, label: 'Back office', icon: 'gauge', onClick: () => openOffice(anchor) },
      // Menu, prices and shop is one tap away too: add a dish, change a price or a prep time.
      { hide: kit, label: 'Edit the menu', icon: 'sliders', onClick: () => openOffice(anchor, 'data') },
      { separator: true },
      // Orders opens the open-orders screen, with how many are open.
      { hide: kit || !hasWork(), label: 'Orders' + (m.openOrders ? ' (' + m.openOrders + ' open)' : ''), icon: 'receipt', onClick: () => openSheet('orders') },
      // Front counter opens the full-screen order page; its back link returns here.
      { hide: kit || !hasWork(), label: 'Front counter (full-screen orders)', icon: 'receipt', onClick: () => F.openCounter() },
      // Recall and Hold open the same sheets as their header buttons, with the same counts.
      { hide: !hasWork(), label: 'Recall' + (recentCount(store(), store().now()) ? ' (' + recentCount(store(), store().now()) + ')' : ''), icon: 'history', onClick: () => openSheet('recall') },
      { hide: front || !cookOn(), label: 'Hold cabinet' + (c.hold ? ', ' + c.hold + ' need attention' : ''), icon: 'thermometer', onClick: () => showCabinet(true) },
      // 86 and Demo open their sheets too.
      { hide: !hasWork(), label: 'Sold out (86 board)' + (c.out86 ? ', ' + c.out86 + ' off' : ''), icon: 'ban', onClick: () => openSheet('board86') },
      { hide: kit, label: 'Demo', icon: 'play', onClick: () => openSheet('demo') },
      // The sanitize entry opens its own small menu on the same anchor.
      { hide: !cookOn(), label: 'Readings', icon: 'thermometer', onClick: () => openSheet('readings') },
      { hide: !cookOn(), label: 'Sanitize timer' + (m.sanText.textContent ? ': ' + m.sanText.textContent : ''), icon: 'shield-check', onClick: () => sanitiseMenu(anchor) },
      { separator: true },
      // Settings, help and the office sit behind the Menu sheet.
      { hide: !(typeof SB.guide === 'object' && SB.guide && typeof SB.guide.open === 'function'), label: 'Guide', icon: 'info', onClick: () => SB.guide.open() },
      { label: 'Settings and help', icon: 'settings', onClick: () => openSheet('menu') },
    ].filter((it) => !it.hide);
    // Hiding rows can leave a separator at the top, the bottom or twice in a row; those go.
    const clean = items.filter((it, i) => !(it.separator && (i === 0 || i === items.length - 1 || items[i - 1].separator)));
    SB.ui.menu(anchor, clean, { label: 'Settings' });
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
    // Opens the "Set up your kitchen" wizard; the card stays until the wizard is finished or it is closed.
    m.wBlank = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'setup' }, onClick: () => openSheet('dishes') }, ico('plus', 22), h('span', null, 'Add more dishes'));
    // Starting the walkthrough also puts this card away for good.
    const tour = h('button', { type: 'button', class: 'btn btn-lg', dataset: { act: 'tour' }, onClick: () => { F.setWelcome(false); startTour(); } }, ico('play', 22), h('span', null, 'Show me how it works'));
    // The x puts the card away for good.
    const close = h('button', { type: 'button', class: 'btn btn-icon fl-welcome-x', 'aria-label': 'Hide this welcome', onClick: () => F.setWelcome(false) }, ico('x', 22));
    m.welcome = h('section', { class: 'fl-welcome', hidden: true, 'aria-labelledby': 'fl-welcome-h' },
      h('span', { class: 'fl-welcome-mark', 'aria-hidden': 'true' }, ico('flame', 34, { stroke: 1.8 })),
      h('div', { class: 'fl-welcome-body' }, h('h2', { id: 'fl-welcome-h' }, 'Your menu is ready'), m.wText,
        h('div', { class: 'fl-welcome-actions' }, m.wBlank, tour)),
      close);
    return m.welcome;
  }
  // Shows or hides the next-step card. It shows on the All tab once there is at least one dish, until the first
  // ticket exists or someone closes it. With no dishes the empty board's own button does the job instead.
  function paintWelcome() {
    if (!m || !m.welcome) return;
    const s = store().getState();
    const n = SB.setup ? SB.setup.dishCount() : 0;
    // Once any ticket or order exists the first-steps card is finished for good, even if the board is cleared later.
    if ((s.tickets.length || (s.orders && s.orders.length)) && !welcomeDone()) U.storage.set(KEY_WELCOME, 'done');
    const show = !welcomeDone() && m.zone === 'all' && n > 0;
    const wasShown = !m.welcome.hidden;
    setHidden(m.welcome, !show);
    // The empty board leaves out its own walkthrough button while the card (which has one) is up, so there is only one.
    if (wasShown !== show && m.empty && m.empty.dataset.sig) paintEmpty(store().select.counts());
    if (!show) return;
    put(m.wText, 'Your menu has ' + n + ' ' + U.plural(n, 'dish', 'dishes') + '. Tap New ticket to take a first order. Tax, hours and PIN are under Settings, Tax, hours and PIN.');
  }
  // Hides the card for good, or shows it again (a restarted demo starts with it).
  F.setWelcome = function (on) {
    if (on) U.storage.remove(KEY_WELCOME); else U.storage.set(KEY_WELCOME, 'done');
    if (m) paintWelcome();
    return !!on;
  };
  // True while the welcome card has not been dismissed.
  F.welcome = () => !welcomeDone();
  // Hides the tab of every station the owner marked "Not used" in Dishes and prices. A station with open tickets or
  // the one being looked at always keeps its tab, so no ticket is ever out of sight.
  F.applyHiddenTabs = function () {
    const sg = m && (m.seg || null);
    if (!sg) return;
    const hid = SB.setup && SB.setup.hiddenStations ? SB.setup.hiddenStations() : [];
    const c = store().select.counts();
    const menuNow = store().getState().menu.filter((d) => !d.archived);
    TABS.forEach((id) => {
      const b = sg.querySelector('[data-id="' + id + '"]');
      if (!b || id === 'all' || id === 'expo') return;
      // A station no dish is made at has nothing to show, so its tab waits until a dish is added there (once the menu has dishes).
      const unused = !menuNow.some((d) => d.zone === id);
      const keep = (hid.indexOf(id) < 0 && !unused) || id === m.zone || (c.zones[id] || 0) > 0;
      b.style.display = keep ? '' : 'none';
    });
    // A one-station kitchen (a taco truck) has nothing to switch between: All, its one station and Expo would show the same tickets,
    // so those tabs go. The Cabinet tab stays when cooking ahead is on; with nothing left to pick the whole tab row hides.
    const shown = TABS.filter((id) => id !== 'all' && id !== 'expo' && sg.querySelector('[data-id="' + id + '"]') && sg.querySelector('[data-id="' + id + '"]').style.display !== 'none');
    // A kitchen with no dishes yet has no stations to switch between either, so the whole tab row waits for the first dish.
    const single = m.zone === 'all' && ((shown.length <= 1 && hid.length > 0) || (menuNow.length === 0 && !(c.all > 0)));
    const cab = sg.querySelector('[data-id="cabinet"]');
    const cabOn = !!cab && !cab.hidden;
    ['expo'].concat(shown).forEach((id) => { const b = sg.querySelector('[data-id="' + id + '"]'); if (b) b.style.display = single ? 'none' : (id === 'expo' ? '' : b.style.display); });
    const all = sg.querySelector('[data-id="all"]');
    if (all) all.style.display = single && !cabOn ? 'none' : '';
    const row = sg.closest('.fl-tabs');
    if (row) row.hidden = single && !cabOn;
  };
  // Starts the guided walkthrough when it is part of this build; otherwise opens the Help sheet instead.
  function startTour() {
    if (SB.tour && typeof SB.tour.start === 'function') SB.tour.start();
    else openSheet('help');
  }
  F.startTour = startTour;
  // Empty state: shown when no slips match the current tab.

  // Fills the empty panel: New ticket and Start demo, or on a quiet station a way back to All.
  // Rebuilt only when its wording changes.
  function paintEmpty(c) {
    const e = m.empty;
    const zone = m.zone, stationBusy = modeOf(zone) === 'station' && c && c.all > 0;
    const firstRun = !stationBusy && SB.setup && SB.setup.noDishes();
    const title = firstRun ? 'Welcome. Let\'s build your menu.' : stationBusy ? 'Nothing waiting at ' + zoneById(zone).name + '.' : 'No tickets right now.';
    const text = firstRun ? 'Type your own dishes and prices (about two minutes), or first watch a busy night in a sample barbecue kitchen.' : stationBusy
      ? c.all + ' ' + U.plural(c.all, 'ticket') + ' open on other stations. Tickets appear here when they have an item for this station.'
      : 'New orders land here the moment they are sent. Add one yourself, take the one-minute walkthrough, or try the demo. Demo orders are not real.';
    const cardUp = !!(m.welcome && !m.welcome.hidden);
    const sig = title + '|' + text + '|' + cardUp;
    if (e.dataset.sig === sig) return;
    e.dataset.sig = sig;
    U.clear(e);
    const actions = h('div', { class: 'fl-empty-actions' });
    // First run: two big, plain choices and nothing else. The walkthrough needs a dish, so it waits until there is one.
    if (firstRun) {
      actions.append(h('button', { type: 'button', class: 'btn btn-primary btn-lg fl-first-dish', dataset: { act: 'first-dish' }, onClick: () => openSheet('dishes') }, ico('plus', 26, { stroke: 2.5 }), h('span', null, 'Add my menu')),
        h('button', { type: 'button', class: 'btn btn-lg fl-start-demo', onClick: startDemo }, ico('play', 22), h('span', null, 'Watch the demo')));
      e.append(h('div', { class: 'fl-empty-mark', 'aria-hidden': 'true' }, ico('flame', 72, { stroke: 1.6 })), h('h2', null, title), h('p', null, text), actions);
      return;
    }
    // A quiet station while others are busy offers a way back; New ticket is always there.
    if (stationBusy) actions.appendChild(h('button', { type: 'button', class: 'btn btn-lg', onClick: () => goZone('all') }, ico('grid', 22), h('span', null, 'Show all stations')));
    actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openSheet('order') }, ico('plus', 26, { stroke: 2.5 }), h('span', null, 'New ticket')));
    if (!stationBusy) actions.append(...[
      cardUp ? null : h('button', { type: 'button', class: 'btn btn-lg fl-start-tour', onClick: startTour }, ico('help', 22), h('span', null, 'Show me how it works')),
      h('button', { type: 'button', class: 'btn btn-lg fl-start-demo', onClick: startDemo }, ico('fast-forward', 22), h('span', null, store().isDemo && store().isDemo() ? 'Busy-night crew' : 'Try the demo'))].filter(Boolean));
    e.append(h('div', { class: 'fl-empty-mark', 'aria-hidden': 'true' }, ico('flame', 72, { stroke: 1.6 })), h('h2', null, title), h('p', null, text), actions);
  }

  // Starts the demo orders and crew when the simulator is loaded; otherwise opens the demo sheet.
  function startDemo() {
    // In a real kitchen the button opens the demo kitchen in its own space; only inside the demo does it start the crew.
    if (SB.setup && SB.setup.tryDemo && store().isDemo && !store().isDemo()) { SB.setup.tryDemo(); return; }
    // A real kitchen never turns into the demo: the demo is a separate mode (own saved data), entered with a reload.
    if (store().isolated && store().isolated() && !store().isDemo()) { store().enterDemo(); return; }
    // The pit starts empty now, so the demo first loads its own stocked kitchen (settings stay).
    if (SB.sim && SB.sim.restartDemo && !store().getState().batches.length) SB.sim.restartDemo();
    const live = SB.sim && SB.sim.live;
    if (live && typeof live.start === 'function') {
      try {
        live.start({ rate: 'normal' });
        if (typeof live.crew === 'function') live.crew(true);
        toast('Demo started. The orders and the crew are not real. Open Demo to stop it.', { tone: 'info' });
        return;
      } catch (e) { console.error('[smokebox] demo failed to start', e); }
    }
    openSheet('demo');
  }

  // The coach bar. One instruction for the whole tab, so a cook never has to scan every ticket for the next button.
  // Order: a finished ticket to bump (All and Expo), then the dish whose start time came first, then a cooking dish whose time
  // is up or nearly up (15 s), then the next dish waiting to start. Returns { tone, text, ticketId, itemId, target } or null.
  // tone is go (bump), fire (start or make now), check (cooking, time up or nearly), or wait.
  function coachNext(state, now, zone) {
    if (!state || zone === 'cabinet') return null;
    const act = state.tickets.filter((t) => t.status === 'active' && t.items.length);
    if (!act.length) return null;
    // True when a dish belongs on this tab (every dish on All and Expo).
    const mine = (it) => zone === 'all' || zone === 'expo' || it.zone === zone;
    // The dish as said aloud: "2 Brisket", or just "Brisket" for one.
    const nm = (it) => (it.qty > 1 ? it.qty + ' ' : '') + (it.short || it.name);
    if (zone === 'all' || zone === 'expo') {
      const ready = act.filter((t) => t.items.every((it) => it.status === 'done')).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (ready) return { tone: 'go', text: 'Ticket ' + ready.num + ' is ready. Tap Bump.', ticketId: ready.id, target: 'bump' };
      if (zone === 'expo') return null;
    }
    const due = [], cooking = [], waiting = [];
    for (const t of act) for (const it of t.items) {
      if (!mine(it)) continue;
      if (it.status === 'displayed') due.push({ t, it });
      else if (it.status === 'cooking') cooking.push({ t, it, left: cookOf(it, now).left });
      else if (it.status === 'queued') waiting.push({ t, it });
    }
    // When a dish was (or will be) due to start; a dish with no plan counts from its ticket.
    const at = (x) => (U.isNum(x.it.fireAt) ? x.it.fireAt : x.t.createdAt);
    due.sort((a, b) => at(a) - at(b));
    if (due.length) {
      const { t, it } = due[0];
      // The same dish due on other tickets now or within 45 seconds is started as one batch: one tap, one basket.
      if (it.track === 'two') {
        const same = due.filter((x) => x.it.menuId === it.menuId && x.it.track === 'two').concat(waiting.filter((x) => x.it.menuId === it.menuId && x.it.track === 'two' && at(x) - now <= 45000));
        if (same.length > 1) {
          const qty = same.reduce((n, x) => n + (x.it.qty || 1), 0), nums = Array.from(new Set(same.map((x) => x.t.num))).sort((a, b) => a - b);
          return { tone: 'fire', text: 'Start ' + qty + ' ' + (it.short || it.name) + ' together: tickets ' + nums.join(', ') + '. Tap here.', ticketId: t.id, itemId: it.id, target: 'batch',
            batch: same.map((x) => ({ ticketId: x.t.id, itemId: x.it.id, queued: x.it.status === 'queued' })) };
        }
      }
      const text = it.track === 'two' ? 'Start ' + nm(it) + ' on ticket ' + t.num + '.' : 'Make ' + nm(it) + ' for ticket ' + t.num + ', then tap Done.';
      return { tone: 'fire', text: text + (due.length > 1 ? ' (' + (due.length - 1) + ' more after)' : ''), ticketId: t.id, itemId: it.id, target: 'item' };
    }
    const soon = cooking.filter((x) => x.left != null && x.left <= 15000).sort((a, b) => a.left - b.left)[0];
    if (soon) {
      const { t, it, left } = soon;
      return { tone: 'check', text: left <= 0 ? 'Check ' + nm(it) + ' on ticket ' + t.num + '. Tap Done when it is ready.' : nm(it) + ' on ticket ' + t.num + ' is done in ' + Math.ceil(left / 1000) + ' s.', ticketId: t.id, itemId: it.id, target: 'item' };
    }
    waiting.sort((a, b) => at(a) - at(b));
    if (waiting.length) {
      const { t, it } = waiting[0];
      return { tone: 'wait', text: 'Next: ' + nm(it) + ' for ticket ' + t.num + ' starts in ' + mss(Math.max(0, at(waiting[0]) - now)) + '.', ticketId: t.id, itemId: it.id, target: 'item' };
    }
    return cooking.length ? { tone: 'wait', text: 'Everything is cooking. Watch the timers.', ticketId: null } : null;
  }
  // Writes the coach bar, only when its words or tone changed.
  function paintCoach(now) {
    if (!m || !m.coach) return;
    const c = m.root.dataset.wall === 'on' ? null : coachNext(store().getState(), now, m.zone);
    m.coachNow = c;
    const text = c ? c.text : '', tone = c ? c.tone : '';
    if (text !== m.coachText) { m.coachText = text; put(m.coachT, text); setHidden(m.coach, !text); }
    if (tone !== m.coachTone) {
      m.coachTone = tone; m.coach.dataset.tone = tone;
      const icon = { go: 'check-circle', fire: 'zap', check: 'timer', wait: 'clock' }[tone] || 'arrow-right';
      m.coach.querySelector('.fl-coach-i').replaceChildren(ico(icon, 24));
    }
  }
  // Scrolls the coach bar's button into view and rings it for a moment, so the eye lands on the exact button to tap.
  function spotCoach() {
    const c = m && m.coachNow;
    if (!c || !c.ticketId) return;
    if (c.batch) { startBatch(c); return; }
    const slip = m.grid.querySelector('.fl-slip[data-ticket="' + cssEsc(c.ticketId) + '"]');
    if (!slip) return;
    const el = c.target === 'bump' ? slip.querySelector('.fl-bump') : slip.querySelector('.fl-row[data-item="' + cssEsc(c.itemId) + '"] .slip-item') || slip;
    try { el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
    el.classList.remove('fl-spot'); void el.offsetWidth; el.classList.add('fl-spot');
    setTimeout(() => el.classList.remove('fl-spot'), 2600);
  }

  // Starts every dish of a coach batch in one go (dishes still waiting are fired early) and says how many started.
  function startBatch(c) {
    const S = store();
    let n = 0;
    for (const b of c.batch) {
      const r = S.dispatchEx(b.queued ? 'fireNow' : 'advanceItem', b.queued ? { ticketId: b.ticketId, itemId: b.itemId, start: true } : { ticketId: b.ticketId, itemId: b.itemId }, { source: 'ui' });
      if (r.report === 'ok') n++;
    }
    if (m) m.rowUndoFor = null;
    toast(n ? 'Started ' + n + ' ' + U.plural(n, 'dish', 'dishes') + ' together.' : 'Nothing could be started. The tickets changed.', { tone: n ? 'ok' : 'warn' });
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
      if (act === 'item') {
        // Done tapped on a dish with more than a fifth of its cook time left is most likely the wrong row: offer an undo on it.
        const t0 = E().findTicket(store().getState(), rec.id), it0 = t0 && t0.items.find((x) => x.id === id);
        const early = !!it0 && it0.status === 'cooking' && it0.prepSec > 0 && it0.startedAt != null && store().now() - it0.startedAt < it0.prepSec * 800;
        const r = run('advanceItem', { ticketId: rec.id, itemId: id });
        if (early && r && r.report === 'ok') offerRowUndo(rec.id, id, r);
      } else run('fireNow', { ticketId: rec.id, itemId: id, start: true });
    } else if (act === 'zone') run('completeZone', { ticketId: rec.id, zone: rec.zone });
    else if (act === 'bump') bump(rec);
    else if (act === 'more') moreMenu(rec, btn);
  }

  // Bump-bar keys: pick a ticket, then start, finish or bump it without touching the screen.

  // The slips on screen in board order, without any that are sliding out.
  const liveSlips = () => Array.from(m.grid.children).filter((c) => c.classList.contains('fl-slip') && !c.classList.contains('fl-leaving'));
  // Marks the picked slip (data-sel) and scrolls it into view; clears the mark from any other. Attribute edits only.
  function paintSelection() {
    if (!m) return;
    const slips = liveSlips();
    // The picked ticket left (bumped or voided): the pick moves to the ticket now in its place, so the next press acts on that one.
    const at = slips.findIndex((el) => el.dataset.ticket === selId);
    if (selId && at < 0) selId = slips.length ? slips[Math.min(selIdx, slips.length - 1)].dataset.ticket : null;
    else if (at >= 0) selIdx = at;
    for (const el of slips) { const on = el.dataset.ticket === selId; if ((el.dataset.sel === 'true') !== on) { if (on) el.dataset.sel = 'true'; else delete el.dataset.sel; } }
  }
  // Moves the pick by one ticket (dir 1 next, -1 previous) and says which ticket it is. The first press picks the first.
  function selectTicket(dir) {
    const slips = liveSlips();
    if (!slips.length) { selId = null; return; }
    const at = slips.findIndex((el) => el.dataset.ticket === selId);
    const to = at < 0 ? (dir > 0 ? 0 : slips.length - 1) : (at + dir + slips.length) % slips.length;
    selId = slips[to].dataset.ticket;
    paintSelection();
    const rec = m.slips.get(selId);
    try { slips[to].scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
    if (rec) say('Ticket #' + rec.num + ' selected.');
  }
  // Does one bump-bar action on the picked ticket: start, done or bump. With nothing picked the first ticket is picked
  // first. WATCH OUT: the same 450 ms guard as a tap applies, so a bar that bounces cannot start and finish a dish
  // (bump has its own guard inside bump()).
  function barAct(what) {
    if (!liveSlips().length) return;
    if (!selId || !m.slips.has(selId)) selectTicket(1);
    const rec = m.slips.get(selId);
    if (!rec) return;
    if (what === 'bump') { bump(rec); return; }
    const t = E().findTicket(store().getState(), rec.id);
    const it = t ? F.pickItem(rec.mode === 'station' ? t.items.filter((x) => x.zone === rec.zone) : t.items, what, store().now()) : null;
    if (!it) { toast(what === 'start' ? 'Nothing ready to start on ticket #' + rec.num + '.' : 'Nothing cooking or ready to finish on ticket #' + rec.num + '.', { tone: 'info' }); return; }
    const key = 'item:' + it.id, nowMs = performance.now();
    if (nowMs - (m.lastTap.get(key) || 0) < 450) return;
    m.lastTap.set(key, nowMs);
    run('advanceItem', { ticketId: rec.id, itemId: it.id });
  }
  // Brings back the ticket bumped most recently (the bump-bar recall key). Says so when there is none.
  function recallLast() {
    const last = store().select.recent(1)[0];
    if (!last) { toast('No bumped ticket to bring back.', { tone: 'info' }); return; }
    run('recallTicket', { ticketId: last.id }, { okText: 'Ticket #' + last.num + ' is back on the board.' });
  }

  // Sends one action to the store. A success that can be undone raises an Undo toast with the engine's
  // own label; anything else gets one plain sentence. Returns the store's result.
  function run(type, payload, o) {
    o = o || {};
    const S = store();
    const r = S.dispatchEx(type, payload, { source: 'ui' });
    if (m) m.rowUndoFor = null; // a row's Undo is only for the very last tap
    if (r.report === 'ok') {
      const label = r.info && r.info.undo;
      if (label && E().UNDOABLE.indexOf(type) >= 0) toast(label, { tone: 'ok', undo: undoLast });
      else if (o.okText) toast(o.okText, { tone: 'ok' });
      return r;
    }
    toast(E().describe(r.report, r.info, settingsNow()), { tone: QUIET[r.report] ? 'info' : 'warn' });
    return r;
  }
  // Puts a big Undo button on one dish row for 4 seconds, right where the finger was. It undoes only if that tap is still the
  // last thing done; if anything else happened since, it says so instead of undoing the wrong thing.
  function offerRowUndo(ticketId, itemId, res) {
    m.rowUndoFor = res;
    setTimeout(() => {
      if (!m || m.rowUndoFor !== res) return;
      const li = m.grid.querySelector('.fl-slip[data-ticket="' + cssEsc(ticketId) + '"] .fl-row[data-item="' + cssEsc(itemId) + '"]');
      if (!li) return;
      m.grid.querySelectorAll('.fl-undo').forEach((x) => x.remove());
      // Undoes the dish's Done, unless something else was done after it.
      const onUndo = (e) => {
        e.stopPropagation(); b.remove();
        if (m.rowUndoFor !== res) { toast('Something else happened since, so this cannot be undone here. Use Undo on the message below.', { tone: 'warn' }); return; }
        m.rowUndoFor = null; undoLast();
      };
      const b = h('button', { type: 'button', class: 'btn fl-undo', onClick: onUndo }, ico('undo', 20), h('span', null, 'Marked done. Undo'));
      li.appendChild(b);
      setTimeout(() => { b.remove(); if (m && m.rowUndoFor === res) m.rowUndoFor = null; }, 4000);
    }, 0);
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
  // WATCH OUT: a second bump within 450 ms (a double tap, or a bar that bounces) is ignored. The first bump moves the
  // pick to the next ticket, so without this guard the bounce would bump that one too.
  function bump(rec) {
    const nowMs = performance.now();
    if (nowMs - (m.lastBump || 0) < 450) return;
    m.lastBump = nowMs;
    const t = E().findTicket(store().getState(), rec.id);
    if (!t) { toast(E().REPORTS.unknownTicket, { tone: 'warn' }); return; }
    const left = notDoneItems(t);
    // At the counter nobody ticks off dishes one by one, so Bump never asks about unfinished items.
    // The dishes are marked done first so the office numbers do not count a forced bump.
    if (counterOn() && left.length) left.forEach((it) => { try { store().dispatchEx('completeItem', { ticketId: rec.id, itemId: it.id }, { source: 'ui' }); } catch (e) { /* the bump below then reports it */ } });
    if (!left.length || counterOn()) { run('bumpTicket', { ticketId: rec.id }); return; }
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
      { label: 'Recall a bumped ticket', icon: 'history', onClick: () => openSheet('recall') },
      { separator: true },
      // Void asks for a reason first, see openVoid.
      { label: 'Void ticket', icon: 'trash', danger: true, onClick: () => openVoid(rec.id, anchor) },
    ], { label: 'Ticket #' + t.num });
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
    // Nothing left to cook is not "nothing waiting" while finished tickets still wait to go out: say both.
    if (!entries.length) {
      const ready = (state.tickets || []).filter((t) => t.status === 'active' && t.items.length && t.items.every((it) => it.status === 'done')).length;
      setTxt(m.dockEmpty, ready ? 'Nothing to cook. ' + ready + ' ' + U.plural(ready, 'ticket') + ' ready to bump.' : 'Nothing to cook.');
    }
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
    fitDock();
  }
  // The strip shows one line of whole dish chips: a chip that does not fit drops out of sight (never cut mid-word) and
  // "+N more" says how many are hidden. Opened, the strip shows every chip on as many lines as it needs.
  function fitDock() {
    if (!m || !m.dockMore) return;
    const chips = Array.from(m.dockList.children);
    m.dock.dataset.open = m.dockOpen ? 'true' : 'false';
    // Measure with the button showing, so the chips that fit leave room for it.
    m.dockMore.hidden = false;
    const top0 = chips.length ? chips[0].offsetTop : 0, room = m.dockList.offsetLeft + m.dockList.clientWidth;
    let off = 0;
    // A chip is out of sight when it wrapped to a second line, or (one long name on a narrow strip) runs past the edge.
    for (const c of chips) { const out = !m.dockOpen && (c.offsetTop > top0 + 4 || c.offsetLeft + c.offsetWidth > room + 1); if (out) off++; c.tabIndex = out ? -1 : 0; c.classList.toggle('is-out', out); }
    setHidden(m.dockMore, !off && !m.dockOpen);
    if (!off && !m.dockOpen) return;
    setTxt(m.dockMore.firstChild, m.dockOpen ? 'Show less' : '+' + off + ' more');
    m.dockMore.setAttribute('aria-expanded', m.dockOpen ? 'true' : 'false');
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
    if (!F.roleAllows(roleNow(), k)) return;
    let used = true;
    if (k === 'n') openSheet('order');
    else if (k === 'o') openSheet('orders');
    else if (k === 'r') openSheet('recall');
    else if (k === 'h') { if (cookOn()) toggleCabinet(); }
    else if (k === '8') openSheet('board86');
    else if (k === 'd') openSheet('demo');
    else if (k === '?') openSheet('help');
    else if (k === 'z') undoLast();
    else if (k === 'j' || k === 'ArrowRight' || k === 'ArrowDown') selectTicket(1);
    else if (k === 'k' || k === 'ArrowLeft' || k === 'ArrowUp') selectTicket(-1);
    else if (k === 's') barAct('start');
    else if (k === 'f') barAct('done');
    else if (k === 'b' || (k === 'Enter' && !(tgt && tgt.closest && tgt.closest('button,a,[role="button"]')))) barAct('bump');
    else if (k === 'l') recallLast();
    else if (/^[1-6]$/.test(k)) goZone(TABS[Number(k) - 1]);
    else if (k === 'Escape' && m.hl) F.highlight(null);
    else used = false;
    if (used) e.preventDefault();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
