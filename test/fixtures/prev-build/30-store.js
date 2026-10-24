/*
 * WHAT THIS FILE IS: The app's memory and clock (SB.store). It holds the current state (everything the app
 *    knows right now), runs the 1-second clock with its demo speed-up, passes actions to the engine, saves to
 *    the browser, keeps two open tabs in step, and makes backups and spreadsheet exports. Screens read the
 *    state here and change it only through dispatch.
 * PARTS: clock, notify, persistence, init and destroy, dispatch, backups and CSV, resets, selectors,
 *    dataset for the office.
 * USES: 00-util.js and 20-engine.js (and 45-sim.js if present). USED BY: 99-boot.js and every screen file.
 *    Loads in Node: nothing browser-only is touched at load time.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  // The browser-notebook entry that holds the whole saved state.
  const KEY = 'smokebox.v1.state';
  // A saved copy that fails the check is parked here instead of being deleted, so nothing is lost.
  const CORRUPT_KEY = 'smokebox.v1.corrupt';
  // When the damaged copy was set aside (a time), so it can be cleared after 30 days.
  const CORRUPT_AT_KEY = 'smokebox.v1.corruptat';
  const DROPPED_KEY = 'smokebox.v1.dropped';          // the saved text exactly as it was before a repair at load threw records away
  const DROPPED_AT_KEY = 'smokebox.v1.droppedat';
  // One small rolling copy of the last good state (menu, ingredients, settings, PIN, safety records, recent history).
  const LASTGOOD_KEY = 'smokebox.v1.lastgood';
  // The owner's answer to the one-time offer to clear old demo tickets: true once they chose to keep them.
  const KEPT_KEY = 'smokebox.v1.demoLeftoversKept';
  // The word that must be typed to start over with an empty menu, and the setup-progress keys that start over clears.
  const START_OVER_WORD = 'ERASE';
  // Neutral starter names for a new empty kitchen. The ids (pit, meat ...) never change, only what people read.
  const STARTER_NAMES = { rename: { zones: { pit: 'Kitchen', sides: 'Prep', fry: 'Fryer' }, categories: { meat: 'Mains', sandwich: 'Sides', side: 'Snacks', fried: 'Desserts', cold: 'Drinks' } }, add: {} };
  // The half-built order on the New ticket screen: kept so a reload or closed tab loses nothing. At most 20,000 characters, and a
  // draft older than 12 hours is forgotten (yesterday's half-order should not come back).
  const DRAFT_KEY = 'smokebox.v1.orderdraft', DRAFT_MAX_CHARS = 20000, DRAFT_MAX_AGE_MS = 12 * 3600e3;
  // PIN recovery: attempts are counted in this key (kitchen data) so a reload does not reset the count. 5 wrong codes lock it for 15 minutes.
  const RECOVERY_KEY = 'smokebox.v1.pinrecovery', RECOVERY_TRIES = 5, RECOVERY_LOCK_MS = 15 * 60e3;
  // Letters and digits for a recovery code, leaving out I, O, 0 and 1 so a handwritten card is not misread. 32 characters, 10 in a code: 50 bits.
  const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const START_OVER_KEYS = ['smokebox.v1.orderdraft', 'smokebox.v1.setup.draft', 'smokebox.v1.setup.examples', 'smokebox.v1.setup.hiddenStations', 'smokebox.v1.setup.lastZone', 'smokebox.v1.setup.hiddenCategories', 'smokebox.v1.setup.lastCategory',
    'smokebox.v1.setup.cookAheadSkipped', 'smokebox.v1.setup.serveSkipped', 'smokebox.v1.setup.serveAnswer', 'smokebox.v1.readings', 'smokebox.v1.lastproduct', 'smokebox.v1.welcome', 'smokebox.v1.dlog', 'smokebox.v1.lastbatch', 'smokebox.v1.alertlog'];
  // 30 days in ms: how long a set-aside damaged copy is kept. 6 hours in ms: how often the rolling copy is refreshed.
  const CORRUPT_KEEP_MS = 30 * 24 * 3600e3, SNAP_EVERY_MS = 6 * 3600e3;
  // The rolling copy keeps this much history: enough to see today, small enough to be a sliver of the live save.
  const SNAP_KEEP = { maxTickets: 300, maxEvents: 2000 };
  // The smaller rolling copy used when the browser's space is getting full.
  const SNAP_KEEP_TIGHT = { maxTickets: 40, maxEvents: 300 };
  // The 'before restore' copy stays in the last-good slot for 7 days, or until a close-day copy replaces it, so a wrong restore can be undone.
  const BEFORE_RESTORE = 'before restore', BEFORE_MONTH_CLOSE = 'before month close', BEFORE_RESTORE_KEEP_MS = 7 * 24 * 3600e3;
  const SID_KEY = 'smokebox.v1.sid';
  // Two tabs of one browser must not overwrite each other's save. Where the browser has Web Locks, a timed save waits for the lock named
  // LOCK_NAME, so only one tab at a time reads the save id, builds the text and writes it. Where it does not, a tab writes its own tag to
  // WRITER_KEY first and checks both the tag and the save id again before writing (the tab-sync fallback).
  const LOCK_NAME = 'smokebox-save-lock', WRITER_KEY = 'smokebox.v1.writer', LOCK_WAIT = 'waiting-for-lock';
  // The actions this device has done that no server has confirmed yet (only used when a transport can push).
  const OUTBOX_KEY = 'smokebox.v1.outbox';
  const OUTBOX_MAX = 5000; // oldest unconfirmed actions are dropped past this, and st.outboxDropped says so
  // 20 million characters: bigger backups are refused on both export and import (Pitcall finding PO4c).
  const MAX_TEXT = 20e6; // characters; backups above this are refused (Pitcall PO4c)
  // 400 ms: wait this long after the last change before saving, so a burst of taps is one save.
  const SAVE_MS = 400;
  // 5000 ms: the longest the save delay may grow to when saves are slow.
  const SAVE_MAX_MS = 5000;
  // True for a plain object (not null, not a list).
  const isObjLike = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  // True only for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // Looks up the engine each time it is needed, not once at load, so the engine can be swapped in tests.
  const E = () => SB.engine;

  // Module memory. state is the current kitchen data. storage is where it is saved. clk is the virtual clock
  // (a base time, the real time at that base, and the speed). lastNow is the newest time ever handed out, so
  // time never goes backwards. subs and tickSubs are the screens waiting to be told. The flags remember that
  // a redraw, a save or a broadcast to other tabs is pending.
  let state = null;
  let storage = null;
  // The real clock. Tests replace it with a fake one through init({ now }).
  let realNow = () => Date.now();
  let clk = { base: 0, realBase: 0, speed: 1 };
  let lastNow = -Infinity;
  let subs = new Set(), tickSubs = new Set();
  let notifyPending = false;
  let interval = null, saveTimer = null, tr = null;
  let pendingBroadcast = false;
  // Two tabs saving at the same moment must not drop each other's work (F-L9). baseSid names the save this tab last
  // loaded or wrote; pending lists this tab's actions since then, so they can be replayed on top of a newer save.
  let baseSid = null, pending = [], skipRebase = false, sidN = 0;
  // Asks the browser to keep this site's data when it is short of room (an iPad may otherwise clear it after a week unused). The answer lands in status.persisted.
  function askPersist(target) {
    try {
      const sg = g.navigator && g.navigator.storage;
      if (!sg || typeof sg.persisted !== 'function') return;
      sg.persisted().then((p) => {
        if (p || typeof sg.persist !== 'function') { target.persisted = !!p; return null; }
        return sg.persist().then((ok) => { target.persisted = !!ok; });
      }).then(() => scheduleNotify()).catch(() => {});
    } catch (e) { /* the browser cannot say */ }
  }
  // History fill: the browser keeps about 5 million characters for the whole app. quotaChars is that limit (a test or a bigger store can say another);
  // hist remembers the oldest saved service day and how many days were dropped to make room (not by Close the month); hn remembers which notices
  // the owner has already seen. NEAR_FULL_PCT and WARN_PCT are the percent of the tightest limit where the calm card and the one-time notice appear.
  const HIST_KEY = 'smokebox.v1.histtrim', HIST_NOTICE_KEY = 'smokebox.v1.histnotice', NEAR_FULL_PCT = 70, WARN_PCT = 85;
  let quotaChars = 5e6, hist = { oldest: null, days: 0, at: 0, droppedBefore: null }, hn = { warnAt: 0, trimAck: 0 };
  // Reading what another tab wrote can be late (a browser's storage is a per-process copy), so the save id alone cannot prove nothing was missed.
  // Each saved copy also lists the ids of the actions it contains (journal, last JOURNAL_MAX). recent holds this tab's own actions of the last
  // five minutes (at most 200). Whenever another tab's copy is adopted, every recent action of this tab that its journal lacks is applied on top
  // again, so a late read costs a second save and never a lost ticket. Ordering is by arrival, never by any clock.
  let recent = [], journal = [], era = '', reconcileTimer = null, noTimersOpt = false;
  // A new era starts whenever the whole kitchen is replaced on purpose (restore, reset, start over, close the month): a copy from another era replaces ours.
  const newEra = () => tabId + ':' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const JOURNAL_MAX = 1500, RECENT_MS = 300000, RECENT_MAX = 200, RECONCILE_MS = 300;
  let dirty = false; // unsaved changes exist (page-lifecycle flushes only write when dirty)
  let listeners = [];
  // Server-ready bookkeeping. opN numbers this tab's actions. outbox is the saved list of unconfirmed
  // actions. seenOps remembers opIds already applied so a repeat delivery does nothing. pushing and
  // retryAt keep one push in flight with a back-off after a failure.
  let opN = 0, outbox = [], seenOps = new Set(), pushing = false, retryAt = 0, retryMs = 2000;
  // simRef is the simulator (if attached). last is the result of the most recent action. st is the save
  // status. tabId names this tab in tab-sync messages.
  let simRef = null;
  // Which kitchen this store holds: 'real' or 'demo'. strict is true when the start-up named the mode (the app does;
  // plain tests do not): then the real kitchen refuses a fast clock and the sample history, and backups carry the mode.
  let mode = 'real', strict = false, baseStorage = null, reloadFn = null;
  // snapAt is when the rolling copy was last taken (real time); snapWanted is set by close day so the next save takes one.
  let snapAt = 0, snapWanted = null;
  let writeBlocked = false, heldText = null;     // set when a damaged save could not be copied aside: nothing is written over it
  let susp = null;           // a big forward jump of the device clock that has not been accepted: { r0 first reading, base trusted time }
  const CLOCK_JUMP_MAX_MS = 36 * 3600e3;     // a forward step bigger than this (a tablet asleep for a day and a half) needs the owner's yes
  let last = null;
  let st = { persistent: false, lastSaveOk: null, lastSaveAt: undefined, corrupt: null, firstRun: false, trimmed: false, repaired: [], outboxDropped: 0, saveCostMs: 0, saveDelayMs: 400 };
  const tabId = 'tab_' + Math.floor(Math.random() * 1e9).toString(36);

  /* ---------- clock: now() = base + (real - realBase) * speed, clamped so it never goes backwards ---------- */
  // Current virtual time in ms: the real clock moved on by the demo speed. Never returns an earlier time
  // than it returned before (rule I9).
  function now() {
    const r = realNow();
    let v = Math.floor(clk.base + (r - clk.realBase) * clk.speed);
    // Never go backwards (rule I9): if the real clock steps back or gives garbage, the last time is
    // repeated.
    if (!isNum(v)) v = lastNow;
    // A real kitchen does not follow a big forward jump of the device clock by itself (a dead clock battery, a wrong date): it keeps counting from
    // the last trusted time, says so in the status, and waits for the owner to accept the new time. A jump that goes away again changes nothing.
    if (strict && mode === 'real' && clk.speed === 1) {
      if (v - lastNow > CLOCK_JUMP_MAX_MS) {
        if (!susp) susp = { r0: r, base: lastNow };
        st.clockSuspect = { aheadMs: v - lastNow, since: susp.r0 };
        v = susp.base + Math.max(0, r - susp.r0);
      } else if (susp) { susp = null; st.clockSuspect = null; }
    }
    if (v < lastNow) v = lastNow;
    lastNow = v;
    return v;
  }
  // Accepts the device clock's new time after a big jump (the owner says it is right). Does nothing when there is no jump waiting.
  function acceptClockJump() {
    if (!susp) return false;
    const r = realNow();
    clk = { base: Math.floor(r), realBase: r, speed: 1 }; lastNow = Math.floor(r); susp = null; st.clockSuspect = null;
    schedulePersist(false); scheduleNotify();
    return true;
  }
  // Sets the demo speed (0.1 to 1000, where 1 is real time). Re-bases the clock first so the time does not
  // jump. Returns false for a bad speed.
  function setSpeed(x) {
    if (!isNum(x) || x < 0.1 || x > 1000) return false;
    if (strict && mode === 'real' && x !== 1) return false; // only the demo may run the clock fast: a real board must keep real time
    const v = now();
    clk = { base: v, realBase: realNow(), speed: x };
    schedulePersist(false);
    scheduleNotify();
    return true;
  }
  // Moves the clock forward to t if it is behind, so loaded or imported data never holds times from the
  // future.
  function atLeast(t) { // move the clock forward so it is not behind stamps in a loaded state
    if (!isNum(t)) return;
    const v = now();
    // Stamps far ahead of the clock do not move it in a real kitchen: the clock is wrong, not the data.
    if (strict && mode === 'real' && t - v > CLOCK_JUMP_MAX_MS) { st.clockWrong = { aheadMs: t - v }; return; }
    if (t > v) { clk = { base: t, realBase: realNow(), speed: clk.speed }; lastNow = t; }
  }
  // Newest time found in a state: the last event or one of the last 50 tickets (tickets run oldest to
  // newest). Used with atLeast.
  function lastStamp(s) {
    const ev = E().allEvents(s);
    let t = ev.length ? ev[ev.length - 1].t : -Infinity;
    for (let i = s.tickets.length - 1, k = 0; i >= 0 && k < 50; i--, k++) { const x = s.tickets[i]; if (x.createdAt > t) t = x.createdAt; }
    return t;
  }

  /* ---------- notify ---------- */
  // Runs fn on the next screen refresh.
  // Where there is no screen (Node tests) it waits 16 ms instead.
  function raf(fn) {
    if (typeof g.requestAnimationFrame === 'function') return g.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }
  // Asks for the screens to be told the state changed, at most once per screen refresh however many changes
  // happen.
  function scheduleNotify() {
    if (notifyPending) return;
    notifyPending = true;
    raf(flushNotify);
  }
  // Tells every subscriber the state changed. A subscriber that fails is logged and cannot stop the others.
  // Tests call this to skip the wait.
  function flushNotify() {
    if (!notifyPending) return;
    notifyPending = false;
    const s = state;
    subs.forEach((fn) => { try { fn(s); } catch (e) { if (g.console) console.error('[smokebox] subscriber failed', e); } });
  }
  // Registers fn to be called after state changes (at most once per screen refresh). Returns a function that
  // removes it again.
  function subscribe(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); }
  // Registers fn to be called every second with the current time. Meant for timer text only, so keep it
  // cheap. Returns a remover.
  function subscribeTick(fn) { if (typeof fn !== 'function') return () => {}; tickSubs.add(fn); return () => tickSubs.delete(fn); }

  /* ---------- persistence ---------- */

  // A millisecond clock for timing the save itself (not the kitchen clock, which tests replace).
  const perfNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  // Marks the state as unsaved and arranges a save SAVE_MS later. broadcast true means tell other tabs after
  // saving.
  function schedulePersist(broadcast) {
    dirty = true;
    if (broadcast) pendingBroadcast = true;
    if (saveTimer || !storage) return;
    // Once a shared save exists and other tabs may be open, each tab waits a little differently, so two tabs rarely write in the
    // same instant. The very first save of a new board is not delayed, so a second tab opened right after sees it.
    // A slow save (a big history) makes the next one wait longer: eight times what the last save took, between the normal
    // 400 ms and 5 seconds, so a busy rush never spends most of its time writing.
    const wait = Math.min(SAVE_MAX_MS, Math.max(SAVE_MS, Math.round(st.saveCostMs * 8)));
    st.saveDelayMs = wait;
    saveTimer = setTimeout(timedSave, tr && baseSid ? wait + Math.floor(Math.random() * 300) : wait);
  }
  // Whole calendar days from one service day text to a later one.
  const daysBetween = (a, b) => Math.round((U.dateKeyToMs(b) - U.dateKeyToMs(a)) / 864e5);
  // Forgets the oldest saved day, so the next save starts counting again (after a restore, a reset or Close the month, which remove history on purpose).
  function histRebase() { hist.oldest = null; }
  // Called after each good save with the copy that was written: if its oldest ticket day moved forward, history was dropped to make room (the size
  // limit of the app or of the browser), and the days are added up so the owner can be told once.
  function histTrack(saved, r) {
    const oldest = saved.tickets.length ? saved.tickets[0].serviceDate : null;
    if (typeof oldest !== 'string') return;
    if (typeof hist.oldest === 'string' && oldest > hist.oldest) {
      hist.days += Math.max(1, daysBetween(hist.oldest, oldest)); hist.at = r; hist.droppedBefore = oldest;
      hist.oldest = oldest;
      try { storage.set(HIST_KEY, hist); } catch (e) { /* the count is kept in memory */ }
    }
    hist.oldest = oldest;
  }
  // How many characters the saved kitchen takes (the main save plus the last-good copy), read as text without parsing it. 0 when the storage cannot tell.
  function savedChars() {
    if (!storage || typeof storage.raw !== 'function') return 0;
    let n = 0;
    try { for (const k of [KEY, LASTGOOD_KEY]) { const t = storage.raw(k); if (typeof t === 'string') n += t.length; } } catch (e) { return 0; }
    return n;
  }
  // How full the saved history is, as a percent of the tightest of three limits (tickets, events, browser space), and what the owner can be told.
  // { tickets, ticketsCap, events, eventsCap, bytes, quotaBytes, pct, nearFull (70 percent), warn (85 percent), persisted (true, false, or null when
  // unknown), daysLeft (days at the recent pace until a limit is reached, or null), keepDays (what Close the month would keep now), trimmedSince }.
  // trimmedSince is null, or { days, at, droppedBefore }: days dropped to make room since the owner last saw the notice, when, and the first day still kept.
  function historyFill() {
    if (!state) return null;
    const L = SB.config.limits, events = E().allEvents(state).length, tickets = state.tickets.length, bytes = savedChars();
    const pct = Math.round(100 * Math.max(tickets / L.maxTickets, events / L.maxEvents, quotaChars > 0 ? bytes / quotaChars : 0));
    let daysLeft = null;
    if (tickets) {
      const today = U.serviceDate(now(), state.settings.service.dayStartHour), oldest = state.tickets[0].serviceDate;
      const span = Math.max(1, daysBetween(oldest, today) + 1);
      if (span >= 3) daysLeft = Math.max(0, Math.floor(Math.min((L.maxTickets - tickets) / (tickets / span), (L.maxEvents - events) / (events / span), bytes > 0 && quotaChars > bytes ? (quotaChars - bytes) / (bytes / span) : Infinity)));
    }
    const unseen = hist.days - (hn.trimAck || 0);
    return {
      tickets, ticketsCap: L.maxTickets, events, eventsCap: L.maxEvents, bytes, quotaBytes: quotaChars, pct, nearFull: pct >= NEAR_FULL_PCT, warn: pct >= WARN_PCT,
      persisted: st.persisted === undefined ? null : !!st.persisted, daysLeft: daysLeft !== null && isFinite(daysLeft) ? daysLeft : null,
      keepDays: E().adaptiveKeepDays(state, now(), monthOpts({}).fill),
      trimmedSince: unseen > 0 ? { days: unseen, at: hist.at, droppedBefore: hist.droppedBefore } : null,
    };
  }
  // The one-time notice for the board, or null: kind 'full' once when the history passes 85 percent, kind 'trimmed' after older history was dropped.
  // Call historyNoticeSeen(kind) when it was shown. The 'full' notice comes back only after the history has fallen under 60 percent.
  function historyNotice() {
    const f = historyFill();
    if (!f) return null;
    if (f.pct < 60 && hn.warnAt) { hn.warnAt = 0; try { storage.set(HIST_NOTICE_KEY, hn); } catch (e) { /* ignore */ } }
    if (f.trimmedSince) return { kind: 'trimmed', days: f.trimmedSince.days, words: 'Older history was dropped to make room: ' + f.trimmedSince.days + (f.trimmedSince.days === 1 ? ' day' : ' days') + '. Close the month regularly to keep it in files.' };
    if (f.warn && !hn.warnAt) return { kind: 'full', pct: f.pct, words: 'Your saved history is ' + f.pct + '% full. Close the month to keep older days in files before they are dropped.' };
    return null;
  }
  // Marks a notice as shown, so it is not shown again until something new happens.
  function historyNoticeSeen(kind) {
    if (kind === 'full') hn.warnAt = realNow(); else if (kind === 'trimmed') hn.trimAck = hist.days; else return false;
    try { storage.set(HIST_NOTICE_KEY, hn); } catch (e) { /* ignore */ }
    return true;
  }
  // The browser's lock manager when it has one, else null.
  const lockManager = () => { try { const n = g.navigator; return n && n.locks && typeof n.locks.request === 'function' ? n.locks : null; } catch (e) { return null; } };
  // True while a save runs inside the lock (then no tag check is needed: no other tab can be saving).
  let inLock = false;
  // Runs when the save timer fires. With several tabs and Web Locks it takes the lock first, then saves; otherwise it saves at once.
  function timedSave() {
    const L = tr ? lockManager() : null;
    if (!L) { saveTimer = null; persistNow(); return; }
    saveTimer = LOCK_WAIT;
    // Saves inside the lock if this save is still the wanted one (a direct flush may have saved already).
    const run = () => { if (saveTimer !== LOCK_WAIT) return; saveTimer = null; inLock = true; try { persistNow(); } finally { inLock = false; } };
    try { L.request(LOCK_NAME, run).catch(() => { run(); }); } catch (e) { run(); }
  }
  // Without Web Locks: writes this tab's tag, then reads the tag and the save id back. True when nobody else saved or claimed meanwhile.
  function claimWrite() {
    const tag = tabId + ':' + (++claimN);
    try {
      storage.set(WRITER_KEY, tag);
      const sid = storage.get(SID_KEY, null), mine = storage.get(WRITER_KEY, null);
      return mine === tag && (sid == null ? baseSid == null : sid === baseSid);
    } catch (e) { return true; }
  }
  let claimN = 0;
  // Saves the state to the browser right now and returns true if it worked. If the browser says it is full,
  // it retries with less history (oldest finished tickets and events first), halving up to 12 times. After a
  // good save it announces the new revision to other tabs.
  function persistNow() {
    if (!storage || !state) return false;
    if (saveTimer) { if (saveTimer !== LOCK_WAIT) clearTimeout(saveTimer); saveTimer = null; }
    // The saved text is a damaged copy nobody could keep elsewhere: it stays exactly as it is until the owner has saved it.
    if (writeBlocked) { st.lastSaveOk = false; return false; }
    // If another tab saved since this tab last loaded or saved, build on its copy first so nothing is lost.
    const forced = skipRebase;
    if (skipRebase) skipRebase = false; else rebaseIfStale();
    // With several tabs and no lock, claim the write and rebuild on the newest copy if another tab got in first (up to 3 times, then write anyway).
    if (tr && !inLock && !lockManager()) for (let i = 0; i < 3 && !claimWrite(); i++) { if (forced) break; rebaseIfStale(); }
    const r = realNow();
    const v = now();
    let ok = false;
    const t0 = perfNow();
    const prevSaveOk = st.lastSaveOk;
    let snapDropped = false;
    // full copy first; if the quota refuses it, keep halving the history (oldest completed tickets and events go first)
    let lim = null, kept2 = null;
    // First trimmed attempt keeps at most 1500 tickets and 10 000 events. A failed save never loses the copy
    // in memory (finding F-E5).
    let nt = Math.min(state.tickets.length, 1500), ne = Math.min(E().allEvents(state).length, 10000);
    for (let tries = 0; tries < 12; tries++) {
      const s2 = lim ? E().prune(state, lim) : state;
      try { ok = storage.set(KEY, { v: 1, savedAt: r, rev: s2.rev, clock: { virtual: v, real: r, speed: clk.speed }, ops: journal, era, state: s2 }) !== false; } catch (e) { ok = false; }
      if (ok) { st.trimmed = !!lim; kept2 = s2; break; }
      // Under pressure the rolling copy goes first: it is only a convenience, the live save is the data.
      if (!snapDropped && strict) { snapDropped = true; snapAt = 0; try { storage.remove(LASTGOOD_KEY); } catch (e) { /* ignore */ } tries--; continue; }
      // History is already tiny: trimming further will not help, so give up and report the failed save.
      if (nt < 20 && ne < 200) break;
      lim = { maxTickets: nt, maxEvents: ne };
      nt = Math.floor(nt / 2); ne = Math.floor(ne / 2);
    }
    const flipped = st.lastSaveOk !== ok;
    st.lastSaveOk = ok;
    st.lastSaveAt = r;
    if (flipped && (ok === false || prevSaveOk === false)) scheduleNotify(); // a failed save (or its recovery) shows on screen at once
    st.saveCostMs = Math.round((perfNow() - t0) * 10) / 10; // how long this save took, which sets the next delay
    if (ok) dirty = false;
    let sid = null;
    if (ok) {
      sid = tabId + ':' + (++sidN);
      try { storage.set(SID_KEY, sid); baseSid = sid; } catch (e) { sid = null; }
      pending = [];
      if (tr && !noTimersOpt && !reconcileTimer && typeof setTimeout === 'function') reconcileTimer = setTimeout(() => { reconcileTimer = null; reconcile(); }, RECONCILE_MS);
    }
    if (ok && kept2) histTrack(kept2, r);
    if (ok && !st.trimmed) maybeSnapshot(r);
    if (ok && pendingBroadcast && tr) { try { tr.post({ type: 'saved', rev: state.rev, tab: tabId, sid }); } catch (e) { /* ignore */ } }
    pendingBroadcast = false;
    return ok;
  }
  // Takes the rolling last-good copy when one is due (after close day, or every 6 hours) and the live save went in whole.
  // Real kitchens only; the demo is disposable. The copy is a trimmed state, and if it does not fit it is dropped quietly.
  function maybeSnapshot(r) {
    if (!strict || mode !== 'real' || !storage || !state) return false;
    if (!snapWanted && r - snapAt < SNAP_EVERY_MS) return false;
    // A 'before restore' copy is the owner's way back from a wrong restore: the 6-hour refresh leaves it alone for 7 days.
    if (!snapWanted) { const g = beforeRestoreCopy(r); if (g) return false; }
    try {
      // When the saved kitchen already fills half the browser's space, the rolling copy shrinks to a few tickets (menu, settings, PIN and safety records
      // stay): a fat copy is what pushes the live save over the limit and gets the copy dropped anyway.
      const small = E().prune(state, savedChars() > quotaChars * 0.5 ? SNAP_KEEP_TIGHT : SNAP_KEEP);
      const env = { v: 1, takenAt: r, reason: snapWanted || 'interval', rev: state.rev, clock: { virtual: now(), real: r, speed: 1 }, state: small };
      const text = JSON.stringify(env);
      if (!E().validateBackup(text).ok) return false; // never keep a copy that would not load
      if (storage.set(LASTGOOD_KEY, env) === false) { storage.remove(LASTGOOD_KEY); return false; }
      snapAt = r; snapWanted = null;
      st.lastGoodAt = r;
      return true;
    } catch (e) { return false; }
  }
  // The stored 'before restore' envelope when it is still within its 7 days at time r, else null.
  function beforeRestoreCopy(r) {
    try {
      const g = storage.get(LASTGOOD_KEY, null);
      return g && typeof g === 'object' && (g.reason === BEFORE_RESTORE || g.reason === BEFORE_MONTH_CLOSE) && isNum(g.takenAt) && r - g.takenAt < BEFORE_RESTORE_KEEP_MS && r >= g.takenAt ? g : null;
    } catch (e) { return null; }
  }
  // Before a restore replaces the kitchen: keeps a whole copy of the current one in the last-good slot (full history if the
  // browser has room, else the small rolling size). Returns the time it was taken, or null when there was nothing worth
  // keeping (an empty kitchen, the demo, no storage) or the browser had no room. Never throws.
  function snapshotBeforeRestore(why) {
    if (!strict || mode !== 'real' || !storage || !state || isBlank()) return null;
    const r = realNow();
    // Full history first, then the small rolling size, then only what a kitchen cannot do without (menu, settings, PIN, safety records).
    for (const keep of [null, SNAP_KEEP, { maxTickets: 0, maxEvents: 0 }]) {
      try {
        const small = keep ? E().prune(state, keep) : state;
        const env = { v: 1, takenAt: r, reason: why || BEFORE_RESTORE, rev: small.rev, clock: { virtual: now(), real: r, speed: 1 }, state: small };
        if (!E().validateBackup(JSON.stringify(env)).ok) continue;
        if (storage.set(LASTGOOD_KEY, env) === false) continue;
        snapAt = r; snapWanted = null; st.lastGoodAt = r; st.beforeRestoreAt = r;
        return r;
      } catch (e) { /* try the smaller copy */ }
    }
    return null;
  }
  // Tells the screens about the 'before restore' copy: { takenAt, expiresAt } or null when there is none now.
  function beforeRestoreInfo() {
    if (!storage) return null;
    const g = beforeRestoreCopy(realNow());
    return g ? { takenAt: g.takenAt, expiresAt: g.takenAt + BEFORE_RESTORE_KEEP_MS, reason: g.reason } : null;
  }
  // Puts the 'before restore' copy back as the kitchen (the way back from a wrong restore). Returns 'ok', or 'noCopy'.
  // The copy it replaces is kept the same way, so this can be undone once too.
  function undoRestore() {
    const g = storage ? beforeRestoreCopy(realNow()) : null;
    if (!g) { last = { type: 'undoRestore', report: 'noCopy', info: {}, events: [] }; return 'noCopy'; }
    return importAll(JSON.stringify(g));
  }
  // Reads the rolling copy and returns { state, takenAt } if it is whole, else null.
  function readSnapshot() {
    try {
      const env = storage.get(LASTGOOD_KEY, null);
      if (!env || typeof env !== 'object') return null;
      const v = E().validateBackup(env);
      return v.ok ? { state: v.state, takenAt: isNum(env.takenAt) ? env.takenAt : 0, repaired: v.repaired } : null;
    } catch (e) { return null; }
  }
  // Public name for saving right now.
  function flush() { return persistNow(); }
  /** pagehide / hidden: write only unsaved changes, so a pristine page never resurrects storage that was just cleared */
  function flushIfDirty() { return dirty ? persistNow() : true; }
  // Builds on another tab's copy. Same era and the copy lists nothing this tab does not already have: it is older than what we hold (a late read),
  // so ours is kept (keep: true) and only our own missing actions are reported. Otherwise this tab's own recent actions that the copy's journal
  // does not list are applied on top of it, in their original order (an action that no longer fits is refused by the engine and dropped, and is
  // not retried). A copy from another era replaces ours. With no journal (an older build) only the unsaved actions are replayed.
  // Returns { state, replayed, keep }; the journal is taken over.
  function mergeForeign(theirs, ops, theirEra) {
    if ((theirEra || '') !== era) { era = theirEra || ''; recent = []; journal = ops ? ops.slice(-JOURNAL_MAX) : []; return { state: theirs, replayed: 0, keep: false }; }
    let redo;
    if (ops) {
      const have = new Set(ops);
      redo = recent.filter((p) => !have.has(p.opId));
      const mine = new Set(journal);
      if (ops.every((id) => mine.has(id))) return { state, replayed: redo.length, keep: true };
    } else redo = pending.slice();
    let s = theirs;
    for (const p of redo) {
      const r = E().apply(s, p.type, p.payload, Math.max(p.now, lastStamp(s)));
      if (r.report === 'ok') s = r.state;
    }
    if (ops) journal = ops.concat(redo.map((p) => p.opId)).slice(-JOURNAL_MAX);
    return { state: s, replayed: redo.length, keep: false };
  }
  // Loads the newest saved copy from storage and returns it checked, or null.
  function loadStored() {
    let payload = null;
    try { payload = storage.get(KEY, null); } catch (e) { payload = null; }
    if (payload == null) return null;
    const v = E().validateBackup(payload);
    return v.ok ? v.state : null;
  }
  // Same, but also gives the journal of action ids the saved copy carries (null for a copy from an older build): { state, ops } or null.
  function loadStoredFull() {
    let payload = null;
    try { payload = storage.get(KEY, null); } catch (e) { payload = null; }
    if (payload == null) return null;
    const v = E().validateBackup(payload);
    if (!v.ok) return null;
    const ops = payload && Array.isArray(payload.ops) ? payload.ops.filter((x) => typeof x === 'string') : null;
    return { state: v.state, ops, era: payload && typeof payload.era === 'string' ? payload.era : '' };
  }
  // Checks the saved copy for this tab's own recent actions. If another tab overwrote the copy without them (it read an older copy), they are
  // applied again on top of what is there and saved. True when something was put back.
  function reconcile() {
    if (!storage || !state || writeBlocked || !tr) return false;
    const full = loadStoredFull();
    if (!full || !full.ops) return false;
    const have = new Set(full.ops);
    if (!recent.some((p) => !have.has(p.opId))) return false;
    atLeast(lastStamp(full.state));
    const m = mergeForeign(full.state, full.ops, full.era);
    if (!m.keep) { state = E().tick(m.state, now()).state; syncUnits(); }
    schedulePersist(true); scheduleNotify();
    return true;
  }
  // Before saving: if the save in storage is not the one this tab last loaded or wrote, another tab saved in
  // between. Build on its copy and replay this tab's own actions on top, so both tabs' work is kept.
  function rebaseIfStale() {
    let sid = null;
    try { sid = storage.get(SID_KEY, null); } catch (e) { sid = null; }
    if (sid == null || sid === baseSid) return;
    const full = loadStoredFull();
    baseSid = sid;
    if (!full) return;
    atLeast(lastStamp(full.state));
    const m = mergeForeign(full.state, full.ops, full.era);
    if (m.keep) return;
    state = E().tick(m.state, now()).state;
    syncUnits();
    scheduleNotify();
  }
  // Listeners for alert messages from other tabs.
  const bcListeners = new Set();
  // Sends a message to the other tabs of this browser. Returns false when there is no channel (then each tab acts alone).
  function broadcast(msg) { if (!tr) return false; try { return tr.post(Object.assign({}, msg, { tab: tabId })) !== false; } catch (e) { return false; } }
  // Registers fn for messages from other tabs; returns a function that stops it.
  function onBroadcast(fn) { bcListeners.add(fn); return () => bcListeners.delete(fn); }
  // Another tab announced a save. With nothing unsaved here, adopt its copy and redraw. With unsaved actions
  // here, replay them on top of its copy and save the merged result. Ignores our own messages.
  function onMessage(d) {
    // A server (or another device) can hand over a confirmation or an action done elsewhere.
    if (d && d.tab !== tabId && d.type === 'ack') { ackOps(d.opIds); return; }
    if (d && d.tab !== tabId && d.type === 'action') { applyRemote(d); return; }
    if (d && d.tab !== tabId && d.type === 'state') { adoptState(d); return; }
    // Messages about alerts (sound leader, played, acknowledged) go to whoever listens; they are not saves.
    if (d && d.tab !== tabId && typeof d.type === 'string' && d.type.indexOf('alert-') === 0) { bcListeners.forEach((fn) => { try { fn(d); } catch (e) { /* a listener must not stop the others */ } }); return; }
    if (!d || d.tab === tabId || d.type !== 'saved' || !storage) return;
    if (d.sid && d.sid === baseSid) return;
    if (!d.sid && isNum(d.rev) && state && d.rev <= state.rev) return; // an older build of the app: keep the newer-revision rule
    const full = loadStoredFull();
    if (!full) return;
    const theirs = full.state;
    if (!d.sid && !(theirs.rev > state.rev)) return;
    // Keep our clock from being behind the newer data, then catch up anything that became due.
    atLeast(lastStamp(theirs));
    if (d.sid) baseSid = d.sid;
    const m = mergeForeign(theirs, full.ops, full.era);
    if (m.replayed) schedulePersist(true);
    if (m.keep) return;
    state = E().tick(m.state, now()).state; syncUnits();
    scheduleNotify();
  }

  /* ---------- transport: how this store talks to other tabs, other devices and a server ---------- */
  /*
   * TRANSPORT INTERFACE (for the hub prototype and any future server link)
   *
   * A transport is a plain object. Pass one to SB.store.init({ transport }) either as the object itself or as a
   * function that returns it. With no transport given, the store uses channelTransport() (same-browser tabs).
   *
   *   name                string, for debugging.
   *   open(deliver)       Start. Call deliver(msg) for every message that arrives from outside. Return false
   *                       when the transport cannot work here (the store then runs alone, like noSync).
   *   post(msg)           Best-effort broadcast of a small message to the peers. Return false if it was not
   *                       handed off. Never throw. The store adds msg.tab (this tab's id).
   *   push(entries)       OPTIONAL. Makes the store keep a saved outbox (key smokebox.v1.outbox). entries is a
   *                       copy of the unconfirmed list, oldest first: [{ opId, type, payload, now }]. Return
   *                       (or resolve to) an array of opIds the server accepted, or { acked: [opIds] }. A
   *                       rejection, a throw or no answer means "try later": the store retries about every 2 s,
   *                       backing off to 60 s. The server must treat a repeated opId as already done.
   *   close()             Stop and release resources. Must be safe to call twice.
   *
   * Messages coming in through deliver(msg), all objects with a string type:
   *   { type: 'ack', opIds: [...] }                 the server confirms these actions; they leave the outbox.
   *   { type: 'action', opId, actionType, payload, now }   an action done on another device. It is applied
   *                       once (repeats of an opId are ignored), is not queued again, and a refusal is dropped.
   *   { type: 'state', state, opIds }               the authoritative state (an object or backup text). The
   *                       store adopts it, treats opIds as confirmed (they leave the outbox), then replays any
   *                       actions still in the outbox on top, so a device's own unconfirmed work is kept while
   *                       its numbering follows the hub. An invalid state is ignored.
   *   { type: 'saved', ... } and { type: 'alert-*', ... }  same-browser tab messages (see the tab channel).
   * Messages carrying tab equal to this tab's id are ignored, so a transport may echo.
   *
   * Every dispatched action gets an opId (tabId + ':' + a counter, unique per page load) returned by
   * dispatchEx and kept in lastResult(). Only successful actions from a person are queued (not simulator ones).
   * The engine itself never sees an opId: it stays pure.
   *
   * Helpers: store.outbox() copies the queue, store.syncNow() pushes now, store.ackOps(ids) confirms by hand.
   */
  // Builds the default transport: a BroadcastChannel to the other tabs of this browser (name defaults to smokebox).
  function channelTransport(name) {
    let ch = null;
    return {
      name: 'broadcast-channel',
      // Opens the channel; false when this browser has none.
      open(deliver) {
        if (typeof g.BroadcastChannel !== 'function') return false;
        // Messages arrive wrapped in an event; hand the store just the data.
        const unwrap = (ev) => deliver(ev && ev.data);
        try { ch = new g.BroadcastChannel(name || 'smokebox'); ch.onmessage = unwrap; return true; } catch (e) { ch = null; return false; }
      },
      // Sends one message to the other tabs.
      post(msg) { if (!ch) return false; try { ch.postMessage(msg); return true; } catch (e) { return false; } },
      // Closes the channel and lets go of it.
      close() { if (ch) { try { ch.close(); } catch (e) { /* ignore */ } ch = null; } },
    };
  }
  // Starts the chosen transport (a given one, or the tab channel) and keeps it in tr when it opened.
  function openTransport(given) {
    let t = given;
    try { if (typeof t === 'function') t = t(); } catch (e) { t = null; }
    if (strict && mode === 'demo') t = null; // a server or hub transport never carries the demo
    if (!t) t = channelTransport(mode === 'demo' ? 'smokebox-demo' : undefined); // the demo talks on its own channel
    if (typeof t.open !== 'function' || typeof t.post !== 'function') return;
    let ok = false;
    try { ok = t.open((msg) => { if (tr === t && msg && typeof msg === 'object') onMessage(msg); }) !== false; } catch (e) { ok = false; }
    if (!ok) { try { if (typeof t.close === 'function') t.close(); } catch (e) { /* ignore */ } return; }
    tr = t;
    if (typeof t.push === 'function') loadOutbox();
  }
  // Reads the saved outbox into memory (only entries that look right).
  function loadOutbox() {
    let raw = null;
    try { raw = storage.get(OUTBOX_KEY, null); } catch (e) { raw = null; }
    outbox = Array.isArray(raw) ? raw.filter((x) => x && typeof x.opId === 'string' && typeof x.type === 'string' && isNum(x.now)) : [];
  }
  // Saves the outbox so a reload or a dead connection does not lose unconfirmed actions. Merges with what other
  // tabs wrote (by opId), so two tabs do not overwrite each other.
  function saveOutbox() {
    if (!storage) return;
    try {
      const other = storage.get(OUTBOX_KEY, null);
      const have = new Set(outbox.map((x) => x.opId));
      if (Array.isArray(other)) for (const x of other) if (x && typeof x.opId === 'string' && !have.has(x.opId) && !acked.has(x.opId)) { outbox.push(x); have.add(x.opId); }
      outbox.sort((a, b) => a.now - b.now);
      while (outbox.length > OUTBOX_MAX) { outbox.shift(); st.outboxDropped++; }
      storage.set(OUTBOX_KEY, outbox);
    } catch (e) { /* a full or blocked store keeps the in-memory queue */ }
  }
  // opIds confirmed during this page load, so a merge never brings a confirmed action back.
  const acked = new Set();
  // Adds one successful action to the outbox when the transport can push. Does nothing otherwise.
  function enqueueOp(entry) {
    if (!tr || typeof tr.push !== 'function') return;
    outbox.push(entry);
    saveOutbox();
    retryAt = 0;
    if (typeof setTimeout === 'function') setTimeout(pushOutbox, 0);
  }
  // Removes confirmed actions from the outbox and saves it. Unknown ids are ignored.
  function ackOps(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const set = new Set(ids.filter((x) => typeof x === 'string'));
    for (const id of set) acked.add(id);
    outbox = outbox.filter((x) => !set.has(x.opId));
    saveOutbox();
    retryMs = 2000;
  }
  // Offers the whole outbox to the transport, one push at a time. A failure waits retryMs (2 s, doubling to 60 s).
  function pushOutbox() {
    if (!tr || typeof tr.push !== 'function' || pushing || !outbox.length) return;
    if (realNow() < retryAt) return;
    pushing = true;
    const t = tr;
    // A failed push: wait longer (2 s, doubling up to 60 s) before the next try.
    const fail = () => { pushing = false; retryAt = realNow() + retryMs; retryMs = Math.min(60000, retryMs * 2); };
    // The transport answered: confirmed ids leave the outbox, anything else counts as a failure.
    const done = (res) => {
      if (tr !== t) { pushing = false; return; }
      pushing = false;
      const ids = Array.isArray(res) ? res : res && Array.isArray(res.acked) ? res.acked : null;
      if (ids) ackOps(ids); else fail();
    };
    try {
      const out = t.push(outbox.map((x) => Object.assign({}, x)));
      if (out && typeof out.then === 'function') out.then(done, fail); else done(out);
    } catch (e) { fail(); }
  }
  // Takes the authoritative state sent by a hub: confirmed actions leave the outbox, the state replaces ours,
  // and actions still unconfirmed are replayed on top (a refused one is dropped). Ticket numbers then follow
  // the hub's order, not the order this device did things in.
  function adoptState(d) {
    if (!state || !storage) return;
    const v = E().validateBackup(d.state);
    if (!v.ok) return;
    const ids = Array.isArray(d.opIds) ? d.opIds.filter((x) => typeof x === 'string') : [];
    for (const id of ids) seenOps.add(id);
    ackOps(ids);
    let ns = v.state;
    atLeast(lastStamp(ns));
    for (const p of outbox) {
      const r = E().apply(ns, p.type, p.payload, Math.max(p.now, lastStamp(ns)));
      if (r.report === 'ok') ns = r.state;
    }
    ns = E().tick(ns, now()).state;
    ns.rev = Math.max(ns.rev, (state.rev || 0) + 1);
    state = ns;
    pending = []; recent = []; skipRebase = true; pendingBroadcast = true;
    persistNow();
    scheduleNotify();
  }
  // Applies an action that another device did. Each opId is applied once; the action is not queued again.
  function applyRemote(d) {
    if (!state || typeof d.opId !== 'string' || seenOps.has(d.opId) || typeof d.actionType !== 'string') return;
    seenOps.add(d.opId);
    if (seenOps.size > 5000) seenOps.delete(seenOps.values().next().value);
    const n = Math.max(now(), isNum(d.now) ? d.now : 0);
    atLeast(n);
    const r = E().apply(state, d.actionType, d.payload, n);
    if (r.report === 'ok') commit(r.state, true);
  }

  /* ---------- lifecycle ---------- */
  // Adds an event listener (a bell on the door) and remembers it so destroy can remove it. Errors are
  // ignored.
  function on(target, type, fn) { try { target.addEventListener(type, fn); listeners.push([target, type, fn]); } catch (e) { /* ignore */ } }
  // Stops the timers, closes the tab channel, removes the listeners and forgets all subscribers. init calls
  // it first; tests call it to clean up.
  function destroy() {
    if (interval) clearInterval(interval);
    if (saveTimer) clearTimeout(saveTimer);
    interval = null; saveTimer = null;
    if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
    if (tr) { try { tr.close(); } catch (e) { /* ignore */ } tr = null; }
    pushing = false; retryAt = 0; retryMs = 2000;
    for (const [t, ty, fn] of listeners) { try { t.removeEventListener(ty, fn); } catch (e) { /* ignore */ } }
    listeners = [];
    subs = new Set(); tickSubs = new Set();
    notifyPending = false; pendingBroadcast = false; dirty = false;
  }
  // Starts the store: loads the saved state (or makes a fresh one), restores the clock, starts the 1-second
  // ticker, opens tab sync and installs the save-when-leaving listeners. Safe to call again: it restarts
  // everything. Returns the status. Options for tests: now (fake clock), storage (fake storage), noTimers,
  // noSync.
  function init(opts) {
    opts = opts || {};
    destroy();
    realNow = typeof opts.now === 'function' ? opts.now : () => Date.now();
    // The mode: named by the caller, else the page's own. A named mode also puts the store in strict mode (see above).
    strict = opts.mode === 'demo' || opts.mode === 'real';
    mode = strict ? opts.mode : (U.mode && U.mode() === 'demo' ? 'demo' : 'real');
    reloadFn = typeof opts.reload === 'function' ? opts.reload : null;
    const given = opts.storage && typeof opts.storage.get === 'function' && typeof opts.storage.set === 'function' ? opts.storage : null;
    // Kitchen data goes to the demo's own keys in the demo, so the demo never reads or writes the real kitchen's data.
    baseStorage = given || U.rawStorage;
    storage = given ? (strict && mode === 'demo' ? U.storageFor(given, 'demo') : given) : (strict ? U.storageFor(U.rawStorage, mode) : U.storage);
    st = { persistent: storage.persistent !== false, lastSaveOk: null, lastSaveAt: undefined, corrupt: null, firstRun: false, trimmed: false, repaired: [], outboxDropped: 0, saveCostMs: 0, saveDelayMs: SAVE_MS };
    last = null; writeBlocked = false; heldText = null; susp = null;
    baseSid = null; pending = []; recent = []; journal = []; skipRebase = false; noTimersOpt = !!opts.noTimers; if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
    outbox = []; seenOps = new Set(); acked.clear();      // opN is never reset: an action id must not repeat in one page, or a hub or another tab that remembers it takes the new action for a repeat
    const r = realNow();
    let payload = null;
    try { payload = storage.get(KEY, null); } catch (e) { payload = null; }
    try { baseSid = storage.get(SID_KEY, null); } catch (e) { baseSid = null; }
    journal = payload && Array.isArray(payload.ops) ? payload.ops.filter((x) => typeof x === 'string').slice(-JOURNAL_MAX) : [];
    era = payload && typeof payload.era === 'string' ? payload.era : '';
    // get() reports unreadable text as "nothing saved". Ask for the raw text so a damaged save is kept and reported,
    // not silently replaced.
    let unreadable = null;
    if (payload == null && typeof storage.raw === 'function') {
      try { const raw = storage.raw(KEY); if (raw != null && raw.trim() !== '' && raw.trim() !== 'null') unreadable = raw; } catch (e) { unreadable = null; }
    }
    let loaded = null;
    if (unreadable !== null) {
      st.corrupt = 'The saved data is not readable text.';
      if (!parkText(CORRUPT_KEY, CORRUPT_AT_KEY, unreadable, r)) { writeBlocked = true; heldText = unreadable; st.heldInMemory = true; }
    } else if (payload != null) {
      const v = E().validateBackup(payload);
      // A saved copy that fails the check is parked under CORRUPT_KEY and the app starts fresh. It never
      // crashes on bad storage.
      if (v.ok) {
        loaded = v.state; st.repaired = v.repaired;
        // Records the check threw away are not gone for good: the text as it was is kept, and the status counts what was dropped.
        const dc = droppedCounts(v.repaired);
        if (dc) {
          st.droppedCount = dc;
          const raw = rawOf(payload);
          if (!parkText(DROPPED_KEY, DROPPED_AT_KEY, payload, r)) { writeBlocked = true; heldText = raw; st.heldInMemory = true; }
        }
      } else {
        st.corrupt = v.error;
        if (!parkText(CORRUPT_KEY, CORRUPT_AT_KEY, payload, r)) { writeBlocked = true; heldText = rawOf(payload); st.heldInMemory = true; }
      }
    } else st.firstRun = true;
    // A damaged save: the rolling last-good copy takes its place (real kitchens), and the damaged one stays set aside.
    if (!loaded && st.corrupt && strict && mode === 'real') {
      const snap = readSnapshot();
      if (snap) { loaded = snap.state; st.repaired = snap.repaired; st.restoredFromCopy = snap.takenAt; }
    }
    // A set-aside damaged copy is cleared after 30 days, once a working state is running.
    if (!st.corrupt) {
      try {
        const at = storage.get(CORRUPT_AT_KEY, null);
        if (isNum(at) && r - at > CORRUPT_KEEP_MS) { storage.remove(CORRUPT_KEY); storage.remove(CORRUPT_AT_KEY); st.corruptCleared = true; }
        const da = storage.get(DROPPED_AT_KEY, null);
        if (isNum(da) && r - da > CORRUPT_KEEP_MS && !st.droppedCount) { storage.remove(DROPPED_KEY); storage.remove(DROPPED_AT_KEY); }
      } catch (e) { /* ignore */ }
    }
    try { const g0 = storage.get(LASTGOOD_KEY, null); snapAt = g0 && isNum(g0.takenAt) ? g0.takenAt : 0; } catch (e) { snapAt = 0; }
    snapWanted = null;
    // History fill bookkeeping, and a request that the browser keeps this site's data (real kitchens only; where the browser cannot, nothing happens).
    quotaChars = isNum(opts.quotaBytes) && opts.quotaBytes > 0 ? opts.quotaBytes : 5e6;
    hist = { oldest: null, days: 0, at: 0, droppedBefore: null }; hn = { warnAt: 0, trimAck: 0 };
    try { const h0 = storage.get(HIST_KEY, null); if (h0 && typeof h0 === 'object') hist = Object.assign(hist, { oldest: typeof h0.oldest === 'string' ? h0.oldest : null, days: isNum(h0.days) ? h0.days : 0, at: isNum(h0.at) ? h0.at : 0, droppedBefore: typeof h0.droppedBefore === 'string' ? h0.droppedBefore : null }); } catch (e) { /* none */ }
    try { const n0 = storage.get(HIST_NOTICE_KEY, null); if (n0 && typeof n0 === 'object') hn = { warnAt: isNum(n0.warnAt) ? n0.warnAt : 0, trimAck: isNum(n0.trimAck) ? n0.trimAck : 0 }; } catch (e) { /* none */ }
    if (strict && mode === 'real') askPersist(st);
    // After a reload the virtual time continues from where it was saved, plus the real time spent away, and
    // never earlier than the real time. Speed goes back to 1.
    let vNow = r;
    const c = payload && payload.clock;
    if (loaded && c && isNum(c.virtual) && !(strict && mode === 'real')) vNow = Math.max(r, c.virtual + Math.max(0, r - (isNum(c.real) ? c.real : r)));   // a real kitchen always starts from the device clock
    vNow = Math.floor(vNow);
    clk = { base: vNow, realBase: r, speed: 1 }; // speed resets to 1 on reload; time continues from the last virtual time
    lastNow = vNow;
    if (loaded) atLeast(lastStamp(loaded));
    // A real kitchen starts with an empty pit; init({ starter: true }) gives the demo stock. init({ blank: true }) (what the
    // app's start-up passes) makes a brand-new install start with no dishes, ingredients or prices at all. A saved state
    // always wins: nobody who already has data is changed.
    const demoStart = strict && mode === 'demo';
    state = loaded || E().newState(opts.blank === true && opts.starter !== true && !demoStart ? { now: now(), blank: true } : { now: now(), starter: opts.starter === true || demoStart, stagger: opts.starter === true || demoStart });
    // Catch up anything that became due while the page was closed.
    const t = E().tick(state, now());
    state = t.state;
    syncUnits();
    if (st.corrupt && !writeBlocked) schedulePersist(false); // replace the corrupt payload; a pristine first run is not written until something happens
    if (!opts.noTimers && typeof setInterval === 'function') interval = setInterval(tickNow, 1000);
    if (!opts.noSync) openTransport(opts.transport);
    if (!opts.noTimers) {
      if (typeof g.addEventListener === 'function') on(g, 'pagehide', () => flushIfDirty());
      if (g.document && typeof g.document.addEventListener === 'function') on(g.document, 'visibilitychange', () => { if (g.document.visibilityState === 'hidden') flushIfDirty(); });
    }
    return status();
  }
  // Keeps a copy of damaged or about-to-be-repaired data under its own key. True only when the copy was really written; a full browser store says no.
  function parkText(key, atKey, value, at) {
    try { if (storage.set(key, value) === false) return false; storage.set(atKey, at); return true; } catch (e) { return false; }
  }
  // The exact saved text for a payload, so a person can download what could not be kept safe.
  function rawOf(payload) {
    try { const raw = typeof storage.raw === 'function' ? storage.raw(KEY) : null; if (raw != null) return raw; } catch (e) { /* fall back to the parsed copy */ }
    try { return JSON.stringify(payload); } catch (e) { return ''; }
  }
  // Counts what a repair dropped, in words a person knows; null when it dropped nothing.
  function droppedCounts(repaired) {
    const c = { tickets: 0, orders: 0, batches: 0, other: 0 };
    let any = false;
    for (const x of Array.isArray(repaired) ? repaired : []) {
      if (!/^dropped\b/.test(x)) continue;
      any = true;
      if (/ticket/.test(x)) c.tickets++; else if (/order/.test(x)) c.orders++; else if (/batch/.test(x)) c.batches++; else c.other++;
    }
    return any ? c : null;
  }
  // A copy of the save status plus the current speed: persistent, lastSaveOk, lastSaveAt, corrupt, firstRun,
  // trimmed, repaired, speed.
  function status() { return Object.assign({}, st, { speed: clk.speed }); }

  // Tells the formatting helpers which units the saved settings ask for (degrees F or C, kg or lb).
  function syncUnits() { try { if (state && state.settings) { U.setUnits(state.settings.ui); U.setCurrency(state.settings.ui && state.settings.ui.currency); } } catch (e) { /* formatting keeps its old choice */ } }
  // Makes ns the current state if it differs, then schedules a save and a redraw. broadcast tells other
  // tabs.
  function commit(ns, broadcast) {
    if (ns === state) return;
    const sameSettings = state && ns.settings === state.settings;
    state = ns;
    if (!sameSettings) syncUnits();
    schedulePersist(broadcast);
    scheduleNotify();
  }
  // Runs every second. Lets the engine move time-driven things on (items due to fire, batches expiring,
  // simulated channel syncs), commits only if something changed, then calls the tick subscribers.
  function tickNow() {
    if (!state) return;
    const n = now();
    const r = E().tick(state, n);
    if (r.state !== state) commit(r.state, false);
    if (outbox.length) pushOutbox();
    tickSubs.forEach((fn) => { try { fn(n); } catch (e) { if (g.console) console.error('[smokebox] tick subscriber failed', e); } });
  }
  // Gives one action to the engine and returns { report, info, events }. The report is the word "ok" or the
  // reason for a refusal; only "ok" changes the state. A refused action from a person is also logged as a
  // ui_report event (the friction charts); simulator traffic and "nothingToDo" are not, and neither is a
  // refused uiReport (that would loop). If init was never called, it starts the store itself.
  function dispatchEx(type, payload, opts) {
    if (!state) init({ noTimers: true, noSync: true });
    const source = opts && opts.source === 'sim' ? 'sim' : 'user';
    const n = now();
    const opId = tabId + ':' + (++opN);
    const r = E().apply(state, type, payload, n);
    last = { type: typeof type === 'string' ? type : String(type), report: r.report, info: r.info, events: r.events, opId };
    if (r.report === 'ok') {
      if (r.state !== state) {
        pending.push({ type, payload, now: n, opId }); if (pending.length > 300) pending.shift();
        const ra = realNow();
        recent.push({ type, payload, now: n, opId, at: ra });
        while (recent.length > RECENT_MAX || (recent.length && ra - recent[0].at > RECENT_MS)) recent.shift();
        journal.push(opId); if (journal.length > JOURNAL_MAX) journal.shift();
        if (source === 'user') enqueueOp({ opId, type, payload, now: n });
      }
      if (type === 'closeDay') snapWanted = 'closeDay';
      if (type === 'createTicket' && source === 'user') clearDraft();
      commit(r.state, true);
    }
    else if (source === 'user' && r.report !== 'nothingToDo' && type !== 'uiReport') {
      // instrumentation (UI guide): a user action that was refused is recorded as a ui_report event
      const r2 = E().apply(state, 'uiReport', { action: String(type).slice(0, 40) || '?', report: r.report }, n);
      if (r2.report === 'ok') commit(r2.state, false);
    }
    return { report: r.report, info: r.info, events: r.events, opId };
  }
  // Same as dispatchEx but returns only the report word.
  const dispatch = (type, payload, opts) => dispatchEx(type, payload, opts).report;

  /* ---------- backups ---------- */
  // Wraps the current state with version, save time, revision and clock: the one shape used for saving and
  // for backups.
  function envelope() {
    const r = realNow();
    const env = { v: 1, savedAt: r, rev: state.rev, clock: { virtual: now(), real: r, speed: clk.speed }, state };
    if (strict) env.mode = mode;
    // Owner choices from the setup screens that live outside the board state travel with the backup too.
    const setup = {};
    for (const k of SETUP_LISTS) { let v = null; try { v = storage ? storage.get(SETUP_KEYS[k], null) : null; } catch (e) { v = null; } if (Array.isArray(v)) setup[k] = v.filter((x) => typeof x === 'string').slice(0, 200); }
    if (Object.keys(setup).length) env.setup = setup;
    const nm = ownerNames();
    if (nm) env.names = nm;
    return env;
  }
  // The setup-screen lists a backup carries: stations the owner hid from the tiles, and dishes that came from the examples.
  const SETUP_KEYS = { hiddenStations: 'smokebox.v1.setup.hiddenStations', examples: 'smokebox.v1.setup.examples' };
  const SETUP_LISTS = Object.keys(SETUP_KEYS);
  // The owner's station, category and channel names (SB.config.customSpec), or null when there are none or the
  // config has no such feature. Backups carry them so tickets on an added station survive a restore.
  function ownerNames() {
    const C = SB.config;
    if (!C || typeof C.customSpec !== 'function') return null;
    try {
      const sp = C.customSpec();
      // True when a part of the spec holds at least one rename or added entry.
      const has = (o) => o && typeof o === 'object' && Object.keys(o).some((k) => (Array.isArray(o[k]) ? o[k].length : o[k] && typeof o[k] === 'object' && Object.keys(o[k]).length));
      return sp && (has(sp.rename) || has(sp.add)) ? JSON.parse(JSON.stringify(sp)) : null;
    } catch (e) { return null; }
  }
  // Backup as one JSON text (text that holds a whole list of records). Returns null and sets lastResult to
  // the reason when it refuses: too big, or it would not pass its own import check.
  function exportAll() {
    let text;
    try { text = JSON.stringify(envelope()); } catch (e) { last = { type: 'export', report: 'invalidBackup', info: { error: 'unserialisable' }, events: [] }; return null; }
    if (text.length > MAX_TEXT) { last = { type: 'export', report: 'exportTooLarge', info: { chars: text.length, max: MAX_TEXT }, events: [] }; return null; }
    // Check our own output with the same test import uses: better to refuse than hand out a backup import
    // would reject.
    const v = E().validateBackup(text);
    if (!v.ok) { last = { type: 'export', report: 'invalidBackup', info: { error: v.error }, events: [] }; return null; }
    last = { type: 'export', report: 'ok', info: { chars: text.length }, events: [] };
    return text;
  }
  // Replaces the whole state from backup text. Returns "ok", "invalidBackup" or "exportTooLarge". A refused
  // import changes nothing. Repairs it made are listed in lastResult().info.repaired.
  function importAll(text) {
    if (typeof text !== 'string') { last = { type: 'import', report: 'invalidBackup', info: { error: 'not text' }, events: [] }; return 'invalidBackup'; }
    if (text.length > MAX_TEXT) { last = { type: 'import', report: 'exportTooLarge', info: { chars: text.length, max: MAX_TEXT }, events: [] }; return 'exportTooLarge'; }
    // A backup made in the demo cannot be loaded into the real kitchen, nor the reverse. A backup with no mode (made before
    // the demo had its own storage) is a real kitchen's.
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    if (strict && parsed && typeof parsed === 'object') {
      const from = parsed.mode === 'demo' ? 'demo' : 'real';
      if (from !== mode) { last = { type: 'import', report: 'wrongBackupMode', info: { backup: from, mode }, events: [] }; return 'wrongBackupMode'; }
    }
    // A backup that carries owner names puts them in place BEFORE the check, so tickets on an added station are
    // not dropped. A backup without names (an older one) leaves the current names alone. A refused import
    // puts the old names back.
    const C = SB.config;
    let namesBefore = null, namesGiven = null;
    if (C && typeof C.applyCustom === 'function' && typeof C.customSpec === 'function') {
      try {
        const o = JSON.parse(text);
        if (o && typeof o === 'object' && o.names && typeof o.names === 'object') { namesGiven = o.names; namesBefore = C.customSpec(); C.applyCustom(namesGiven); }
      } catch (e) { namesGiven = null; }
    }
    const v = E().validateBackup(text);
    if (!v.ok) {
      if (namesGiven) { try { C.applyCustom(namesBefore); } catch (e) { /* keep going */ } }
      last = { type: 'import', report: 'invalidBackup', info: { error: v.error, repaired: v.repaired }, events: [] };
      return 'invalidBackup';
    }
    if (namesGiven && typeof C.saveCustom === 'function') { try { C.saveCustom(namesGiven); } catch (e) { /* the names stay applied for this session */ } }
    if (parsed && isObjLike(parsed.setup)) for (const k of SETUP_LISTS) if (Array.isArray(parsed.setup[k])) { try { storage.set(SETUP_KEYS[k], parsed.setup[k].filter((x) => typeof x === 'string').slice(0, 200)); } catch (e) { /* the list is a convenience */ } }
    // Keep the kitchen being replaced, so a wrong restore can be undone: a visible copy in the last-good slot.
    const beforeAt = snapshotBeforeRestore();
    const ns = v.state;
    // The revision must go up so other tabs treat the imported copy as newer; the clock must not be behind
    // its times.
    ns.rev = Math.max(ns.rev, (state ? state.rev : 0) + 1);
    atLeast(lastStamp(ns));
    state = E().tick(ns, now()).state; syncUnits();
    pendingBroadcast = true;
    skipRebase = true; pending = []; recent = []; journal = []; era = newEra(); histRebase();   // an import or reset is meant to win over what another tab saved
    persistNow();
    scheduleNotify();
    last = { type: 'import', report: 'ok', info: { repaired: v.repaired, beforeRestore: beforeAt != null, beforeRestoreAt: beforeAt, beforeRestoreKeepDays: beforeAt != null ? BEFORE_RESTORE_KEEP_MS / 864e5 : 0 }, events: [] };
    return 'ok';
  }

  /* ---------- close the month: preview, export, prune ---------- */
  // What the last Close the month export held, so the prune can check the owner saved exactly that: { before, planKey, backup: { chars, sha256 } }.
  let monthExport = null;
  // A short key for a plan: the boundary plus the sha256 of its sorted ticket, order and event ids. Two plans with the same key remove the same records.
  function planKey(pl) {
    return pl.before + ':' + U.sha256Hex([Array.from(pl.ticketIds).sort().join(','), Array.from(pl.orderIds).sort().join(','), Array.from(pl.eventIds).sort().join(',')].join('|'));
  }
  // The public part of a plan (no id sets), for the screens.
  function planView(pl) {
    const v = {};
    for (const k of Object.keys(pl)) if (!(pl[k] instanceof Set)) v[k] = pl[k];
    return v;
  }
  // Records a Close-the-month answer and returns it.
  function monthAnswer(type, ok, report, info, extra) { last = { type, report, info: info || {}, events: [] }; return Object.assign({ ok, report, info: info || {} }, extra || {}); }
  // Says exactly what Close the month would remove for opts { before: 'YYYY-MM-DD', keepDays? } (days before 'before' that are closed and older
  // than keepDays, default 35), and what stays. Changes nothing. { ok, report, preview } where preview has tickets, orders, events, days, from,
  // before (the real boundary), safetyEventsKept, dayRecordsKept, openTicketsKept, openOrdersKept, uncoveredDays, paidTotal.
  function closeMonthPreview(opts) {
    if (!state) return monthAnswer('closeMonthPreview', false, 'invalidBackup');
    const r = E().monthPlan(state, monthOpts(opts), now());
    if (!r.ok) return monthAnswer('closeMonthPreview', false, r.report, r.info);
    return monthAnswer('closeMonthPreview', true, 'ok', {}, { preview: planView(r.plan) });
  }
  // The options for the engine's plan: what the caller asked for, plus how full the saved history is, so the default keep window can follow the
  // kitchen's pace (a busy kitchen keeps fewer days, because the limits would drop them anyway).
  function monthOpts(opts) {
    const today = state ? U.serviceDate(now(), state.settings.service.dayStartHour) : null;
    // The saved copy may hold fewer days than memory (older ones were dropped to fit), so its pace is counted over the days it really holds.
    const spanDays = today && typeof hist.oldest === 'string' ? Math.max(1, daysBetween(hist.oldest, today) + 1) : null;
    return Object.assign({}, opts, { fill: { bytes: savedChars(), quotaBytes: quotaChars, spanDays } });
  }
  // File name part for a date like 2026-09-01 without dashes.
  const flatDay = (d) => String(d).replace(/-/g, '');
  // Builds the files for Close the month, changing nothing: the full backup of the kitchen as it is now (first, so nothing is lost even if the
  // prune goes wrong), CSV files for the records that would be removed (orders, tickets, day totals), and a manifest with counts and the sha256
  // and size of each. { ok, report, files: [{ name, kind, mime, text, chars, sha256 }], manifest }. Remembers the backup so closeMonthPrune
  // can check the owner saved that exact file.
  function closeMonthExport(opts) {
    if (!state) return monthAnswer('closeMonthExport', false, 'invalidBackup');
    if (mode === 'demo') return monthAnswer('closeMonthExport', false, 'notInDemo');
    const r = E().monthPlan(state, monthOpts(opts), now());
    if (!r.ok) return monthAnswer('closeMonthExport', false, r.report, r.info);
    const pl = r.plan;
    if (!pl.tickets && !pl.orders && !pl.events) return monthAnswer('closeMonthExport', false, 'nothingToDo', { before: pl.before });
    const backupText = exportAll();
    if (backupText == null) { const lr = last || {}; return monthAnswer('closeMonthExport', false, lr.report || 'invalidBackup', lr.info); }
    // Turns rows of values into CSV file text (A3's shared writer when loaded).
    const toText = (rows) => (SB.csv && typeof SB.csv.text === 'function' ? SB.csv.text(rows) : rows.map(row).join('\r\n') + '\r\n');
    const range = pl.from + '-to-' + pl.days[pl.days.length - 1];
    const files = [];
    // Adds one file to the list with its size and sha256.
    const add = (name, kind, mime, text) => files.push({ name, kind, mime, text, chars: text.length, sha256: U.sha256Hex(text) });
    add('smokebox-before-month-close-' + flatDay(U.dateKey(realNow())) + '.json', 'backup', 'application/json', backupText);
    add('smokebox-orders-' + range + '.csv', 'orders', 'text/csv', toText(csvRows('orders', state, pl)));
    add('smokebox-tickets-' + range + '.csv', 'tickets', 'text/csv', toText(csvRows('tickets', state, pl)));
    // Day totals: the last day_closed record of each removed day.
    const dayRows = [['day', 'orders', 'voidedOrders', 'tickets', 'voidedTickets', 'subtotal', 'discount', 'tax', 'total', 'tip', 'discarded', 'discardedG']];
    const lastOf = new Map();
    for (const e of E().allEvents(state)) if (e.type === 'day_closed' && pl.days.indexOf(e.day) >= 0) lastOf.set(e.day, e);
    for (const d of Array.from(lastOf.keys()).sort()) { const e = lastOf.get(d); dayRows.push([e.day, e.orders, e.voidedOrders, e.tickets, e.voidedTickets, e.subtotal, e.discount, e.tax, e.total, e.tip, e.discarded, e.discardedG]); }
    add('smokebox-days-' + range + '.csv', 'days', 'text/csv', toText(dayRows));
    const manifest = {
      app: 'Smokebox', kind: 'close-the-month', madeAt: realNow(), before: pl.before, requestedBefore: pl.requestedBefore, keepDays: pl.keepDays, from: pl.from, days: pl.days.length,
      counts: { tickets: pl.tickets, orders: pl.orders, events: pl.events, safetyEventsKept: pl.safetyEventsKept, dayRecordsKept: pl.dayRecordsKept }, paidTotal: pl.paidTotal,
      files: files.map((f) => ({ name: f.name, kind: f.kind, chars: f.chars, sha256: f.sha256 })),
    };
    add('smokebox-month-manifest-' + range + '.json', 'manifest', 'application/json', JSON.stringify(manifest, null, 2) + '\n');
    monthExport = { before: pl.before, requestedBefore: pl.requestedBefore, keepDays: pl.keepDays, planKey: planKey(pl), backup: { chars: files[0].chars, sha256: files[0].sha256 } };
    last = { type: 'closeMonthExport', report: 'ok', info: { files: files.length }, events: [] };
    return { ok: true, report: 'ok', info: { files: files.length }, files, manifest };
  }
  // Removes the history closeMonthPreview described, after the owner confirmed the backup file was saved. opts: { before, keepDays?,
  // confirmBackupSaved: { filename, chars, sha256 } } where chars and sha256 are those closeMonthExport gave for the backup file. Refuses
  // with backupRequired (no or wrong proof), notInDemo, hubKitchen (a tablet that works through a hub), nothingToDo or exportStale (the records
  // changed since the export: export again). First keeps a 'before month close' copy of the kitchen for 7 days (the same slot as before restore),
  // then removes and saves; if the save does not go in, the kitchen is put back exactly as it was and the answer is storageBlocked.
  // Not undoable; importAll of the backup file brings everything back.
  function closeMonthPrune(opts) {
    opts = opts || {};
    // Records and returns a refusal; nothing has been changed when this is used.
    const fail = (report, info) => monthAnswer('closeMonthPrune', false, report, info);
    if (!state) return fail('invalidBackup');
    if (mode === 'demo') return fail('notInDemo');
    if (tr && typeof tr.push === 'function') return fail('hubKitchen');
    const cb = opts.confirmBackupSaved;
    if (!cb || typeof cb !== 'object' || typeof cb.filename !== 'string' || !cb.filename.trim() || !(Number.isFinite(cb.chars) && cb.chars > 0) || typeof cb.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(cb.sha256)) return fail('backupRequired');
    // The window the export used stays the window for the prune, even if the history has grown a little since.
    const o2 = monthOpts(opts.keepDays === undefined && monthExport && monthExport.requestedBefore === opts.before ? Object.assign({}, opts, { keepDays: monthExport.keepDays }) : opts);
    const r = E().monthPlan(state, o2, now());
    if (!r.ok) return fail(r.report, r.info);
    const pl = r.plan;
    if (!pl.tickets && !pl.orders && !pl.events) return fail('nothingToDo', { before: pl.before });
    if (!monthExport || monthExport.backup.sha256 !== cb.sha256 || monthExport.backup.chars !== cb.chars) return fail('backupRequired', { why: 'notTheExport' });
    if (monthExport.planKey !== planKey(pl)) return fail('exportStale');
    // Make sure what is in storage is this very kitchen before anything is removed.
    persistNow();
    const before = state, savedAt = realNow();
    const out = E().closeMonth(state, { before: opts.before, keepDays: o2.keepDays, backup: cb }, now());
    if (out.report !== 'ok') return fail(out.report, out.info);
    const copyAt = snapshotBeforeRestore(BEFORE_MONTH_CLOSE);
    const ns = out.state;
    ns.rev = Math.max(ns.rev, (before.rev || 0) + 1);
    atLeast(lastStamp(ns));
    state = ns; syncUnits();
    pendingBroadcast = true; skipRebase = true; pending = []; recent = []; journal = []; era = newEra(); histRebase();
    const ok = persistNow();
    if (!ok) {
      // The save did not go in: the kitchen in memory goes back to what it was, and what is stored is still the full copy.
      state = before; skipRebase = true; pendingBroadcast = false; syncUnits(); scheduleNotify();
      if (copyAt != null) { try { storage.remove(LASTGOOD_KEY); } catch (e) { /* ignore */ } }
      persistNow();
      return fail('storageBlocked');
    }
    monthExport = null;
    scheduleNotify();
    last = { type: 'closeMonthPrune', report: 'ok', info: Object.assign({ copyKept: copyAt != null, copyKeepDays: copyAt != null ? BEFORE_RESTORE_KEEP_MS / 864e5 : 0 }, out.info), events: [] };
    return { ok: true, report: 'ok', info: last.info, savedAt };
  }
  // Time in ms as readable date text for spreadsheets, or empty text when missing.
  const ISO = (t) => (isNum(t) ? new Date(t).toISOString() : '');
  // Prepares one value for a spreadsheet (CSV) cell: empty for missing, quotes where needed. WATCH OUT: text
  // starting with = + - @ or a tab gets a leading apostrophe so a spreadsheet cannot run it as a formula.
  function cell(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'number') return isNum(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard (text cells only)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // Joins a list of values into one CSV line.
  const row = (a) => a.map(cell).join(',');
  // Spreadsheet text for "tickets", "items", "orders", "events" or "batches", one header line then one line per
  // record. Returns empty text for an unknown kind.
  function exportCsv(kind) {
    const rows = state ? csvRows(kind, state, null) : null;
    return rows ? rows.map(row).join('\n') + '\n' : '';
  }
  // The rows (lists of values, header first) of one CSV kind for state st, or null for an unknown kind. only, when given, limits it to the
  // tickets, orders and events in its three id sets (what Close the month removes).
  function csvRows(kind, st0, only) {
    const state = st0;
    if (!state) return null;
    // True when the record is inside the chosen sets (or when no sets were given).
    const inT = (t) => !only || only.ticketIds.has(t.id);
    // True when the order is inside the chosen sets, or no sets were given.
    const inO = (o) => !only || only.orderIds.has(o.id);
    // True when the event is inside the chosen sets, or no sets were given.
    const inE = (e) => !only || only.eventIds.has(e.id);
    const out = [];
    if (kind === 'tickets') {
      out.push((['id', 'num', 'serviceDate', 'customer', 'channel', 'src', 'status', 'rush', 'pacing', 'dmaxSec', 'createdAt', 'expeditedAt', 'voidedAt', 'totalSec', 'lines', 'qty', 'value', 'forced', 'recalls', 'voidReason', 'note']));
      for (const t of state.tickets.filter(inT)) {
        // Totals for the ticket are worked out from its items, so the sheet needs no extra columns.
        let qty = 0, value = 0;
        for (const it of t.items) { qty += it.qty; value += it.qty * it.price; }
        out.push(([t.id, t.num, t.serviceDate, t.customer, t.channel, t.src, t.status, t.rush, t.pacing, t.dmaxSec, ISO(t.createdAt), ISO(t.expeditedAt), ISO(t.voidedAt),
          isNum(t.expeditedAt) ? Math.round((t.expeditedAt - t.createdAt) / 1000) : undefined, t.items.length, qty, U.round(value, 2), !!t.forced, t.recalls, t.voidReason, t.note]));
      }
    } else if (kind === 'items') {
      out.push((['ticketId', 'itemId', 'menuId', 'name', 'zone', 'qty', 'mods', 'track', 'status', 'price', 'prepSec', 'offsetSec', 'fireAt', 'firedAt', 'startedAt', 'doneAt', 'override', 'rushed', 'cost', 'shortG']));
      for (const t of state.tickets.filter(inT)) for (const it of t.items) {
        // shortG is grams the kitchen cooked that stock could not cover.
        let short = 0;
        for (const r of it.depleted || []) if (r.short > 0) short += r.short;
        out.push(([t.id, it.id, it.menuId, it.name, it.zone, it.qty, (it.mods || []).join('; '), it.track, it.status, it.price, it.prepSec, it.offsetSec, ISO(it.fireAt),
          ISO(it.firedAt), ISO(it.startedAt), ISO(it.doneAt), !!it.override, !!it.rushed, it.cost, short || undefined]));
      }
    } else if (kind === 'orders') {
      out.push((['id', 'serviceDate', 'customer', 'channel', 'src', 'status', 'rounds', 'createdAt', 'paidAt', 'method', 'subtotal', 'discount', 'tax', 'tip', 'total', 'voidReason']));
      for (const o of (state.orders || []).filter(inO)) {
        // Paid orders carry the totals frozen when they were paid; open ones are worked out now.
        const tot = o.status === 'voided' ? null : E().orderTotals(state, o) || {};
        out.push(([o.id, o.serviceDate, o.customer, o.channel, o.src, o.status, o.rounds, ISO(o.createdAt), ISO(o.paidAt), o.method,
          tot ? tot.subtotal : undefined, tot ? tot.discount : undefined, tot ? tot.tax : undefined, o.status === 'paid' ? o.tip : undefined, tot ? tot.total : undefined, o.voidReason]));
      }
    } else if (kind === 'events') {
      out.push((['id', 't', 'time', 'type', 'reverted', 'fields']));
      for (const e of E().allEvents(state).filter(inE)) {
        // Event details beyond the four basic columns are packed as JSON in the last column.
        const f = {};
        for (const k of Object.keys(e)) if (k !== 'id' && k !== 't' && k !== 'type' && k !== 'reverted') f[k] = e[k];
        out.push(([e.id, e.t, ISO(e.t), e.type, !!e.reverted, JSON.stringify(f)]));
      }
    } else if (kind === 'batches') {
      out.push((['id', 'ing', 'label', 'kind', 'src', 'enteredAt', 'rawG', 'cookedG', 'remainingG', 'yieldPct', 'costPerCookedKg', 'status', 'action', 'canServe', 'lastTempF', 'lastTempAt', 'reheats', 'discardedAt', 'discardReason', 'wasteG']));
      for (const b of state.batches) out.push(([b.id, b.ing, b.label, b.kind, b.src, ISO(b.enteredAt), b.rawG, b.cookedG, b.remainingG, b.yieldPct, b.costPerCookedKg, b.status, b.action, b.canServe, b.lastTempF, ISO(b.lastTempAt), b.reheats, ISO(b.discardedAt), b.discardReason, b.wasteG]));
    } else return null;
    return out;
  }

  /* ---------- resets ---------- */
  // Puts the virtual clock back to real time. Safe only right after a reset, because the new state holds no
  // times the clock could fall behind.
  function rebaseClock() { // only allowed together with a reset: the new state holds no stamps the clock could fall behind
    const r = realNow();
    clk = { base: r, realBase: r, speed: clk.speed };
    lastNow = r;
  }
  // Throws everything away and starts a fresh state. Ticket and event counters carry on so ids are never
  // reused. Saves at once. Returns "ok".
  function reset() {
    rebaseClock();
    const old = state;
    const ns = E().newState({ now: now(), starter: false, seq: old ? old.seq : undefined, blank: !!(old && old.catalog === 'own') });
    ns.rev = (old ? old.rev : 0) + 1;
    commit(ns, true);
    skipRebase = true; pending = []; recent = []; journal = []; era = newEra(); histRebase();
    persistNow();
    return 'ok';
  }
  // Clears live tickets, events and batches (the engine keeps settings and menu unless keepSettings is
  // false). Returns the engine's report.
  function resetLive(opts) {
    if (!state) init({ noTimers: true, noSync: true });
    // If the demo clock ran ahead, return to real time first: the cleared state has no times to conflict
    // with.
    if (now() > realNow()) rebaseClock();
    const rep = dispatch('resetLive', opts || {}, { source: 'user' });
    if (rep === 'ok') persistNow();
    return rep;
  }

  /* ---------- selectors (memoised per state reference) ---------- */
  // Remembered answers, kept per state object: a changed state is a new object, so stale answers drop away
  // by themselves.
  const memo = new WeakMap();
  // Returns the remembered answer for this name and state, computing it only the first time. Before init
  // there is no state to remember against, so the answer is computed fresh and not kept.
  function cached(key, fn) {
    if (!state || typeof state !== 'object') return fn();
    let m = memo.get(state);
    if (!m) { m = new Map(); memo.set(state, m); }
    if (!m.has(key)) m.set(key, fn());
    return m.get(key);
  }
  // Shortcut to the engine's ready-made views.
  const V = () => E().views;
  const select = {
    // Tickets still open (not bumped, not voided).
    activeTickets: () => cached('active', () => V().activeTickets(state)),
    // Tickets with work left at one station, reduced to that station's items.
    ticketsForZone: (zone) => cached('zone:' + zone, () => V().ticketsForZone(state, zone)),
    // Whole tickets, for the expo view.
    expoTickets: () => cached('expo', () => V().expoTickets(state)),
    // The n most recently bumped tickets, newest first.
    recent: (n) => cached('recent:' + n, () => V().recent(state, n)),
    // The n most recently voided tickets.
    voided: (n) => cached('voided:' + n, () => V().voided(state, n)),
    // All-day totals: how many of each dish are still needed, for one station or all.
    allDay: (zone) => cached('allday:' + zone, () => E().allDay(state, zone)),
    // Whether a dish can be sold now and why not (manual 86, safety hold or stock). Uses the stored answer
    // when there is one.
    availability: (menuId) => (state && state.avail && Object.prototype.hasOwnProperty.call(state.avail, menuId) ? state.avail[menuId] : E().availability(state, menuId)),
    // Every dish that is currently 86'd.
    unavailable: () => cached('unavail', () => V().unavailable(state)),
    // Hold-cabinet batches, each with its safety status.
    batches: (opts) => V().batches(state, now(), opts),
    // Numbers for the header badges: tickets per station, overdue, hold cabinet and 86 counts.
    counts: () => V().counts(state, now()),
    // Elapsed time and the ok, warn or overdue level of one ticket.
    timing: (ticket) => E().ticketTiming(ticket, now(), state && state.settings),
    // The full event log, including older archived chunks.
    events: () => E().allEvents(state),
    // The editable menu (empty before the store starts).
    menu: () => (state ? state.menu : []),
    // The editable ingredient list (empty before the store starts).
    ingredients: () => (state ? state.ingredients : []),
    // Current settings, or the defaults before the store starts.
    settings: () => (state ? state.settings : E().defaultSettings()),
    // Same as store.dataset: the bundle the back office reads.
    dataset: (opts) => dataset(opts),
  };

  /* ---------- dataset for the back office (live state + optional sample history from SB.sim) ---------- */
  // The simulator hands itself over here so sample history can be fetched later.
  function attachSim(sim) { simRef = sim || null; }
  // Gets the 14-day sample history from the simulator, or null if there is none or it fails. A failure is
  // logged so the office still opens.
  function sampleData() {
    const sim = simRef || SB.sim;
    if (!sim || typeof sim.sample !== 'function') return null;
    try { const s = sim.sample(); return s && Array.isArray(s.tickets) ? s : null; } catch (e) { if (g.console) console.error('[smokebox] sample failed', e); return null; }
  }
  // Remembered datasets, per state object.
  const dsMemo = new WeakMap();
  // Everything the office reads in one bundle: tickets, events, batches, learned prep times, menu,
  // ingredients, settings, the time range and counts. With opts.sample true, the sample history is placed in
  // front of the live data. Remembered per state object.
  function dataset(opts) {
    if (!state) return { tickets: [], orders: [], events: [], batches: [], learned: {}, menu: [], ingredients: [], settings: E().defaultSettings(), range: { from: 0, to: 0 }, counts: { live: 0, sample: 0 }, hasSample: false };
    const wantSample = !!(opts && opts.sample) && !(strict && mode === 'real'); // sample history belongs to the demo only
    const smp = wantSample ? sampleData() : null;
    let m = dsMemo.get(state);
    if (!m) { m = {}; dsMemo.set(state, m); }
    const key = wantSample ? 's' : 'l';
    if (m[key] && m[key].smp === smp) return m[key].ds;
    const liveEvents = E().allEvents(state);
    const tickets = smp ? smp.tickets.concat(state.tickets) : state.tickets;
    const events = smp && Array.isArray(smp.events) ? smp.events.concat(liveEvents) : liveEvents;
    const batches = smp && Array.isArray(smp.batches) ? smp.batches.concat(state.batches) : state.batches;
    const liveOrders = state.orders || [];
    const orders = smp && Array.isArray(smp.orders) ? smp.orders.concat(liveOrders) : liveOrders;
    let from = Infinity;
    // Tickets run oldest first, so the first one gives the start of the range.
    for (const t of tickets) if (t.createdAt < from) { from = t.createdAt; break; } // oldest first
    const to = now();
    const ds = {
      tickets, orders, events, batches, learned: state.learned, menu: state.menu, ingredients: state.ingredients, settings: state.settings,
      range: { from: isNum(from) ? from : to, to }, counts: { live: state.tickets.length, sample: smp ? smp.tickets.length : 0 }, hasSample: !!smp,
    };
    // Days before this date were archived by Close the month: their day totals stay (day_closed events), their tickets and orders are in the owner's files.
    if (typeof state.archivedBefore === 'string') ds.archivedBefore = state.archivedBefore;
    // Days before this one were dropped to make room (the size limits), as opposed to saved to files by Close the month (archivedBefore).
    if (hist.days > 0 && typeof hist.droppedBefore === 'string') ds.droppedBefore = hist.droppedBefore;
    m[key] = { smp, ds };
    return ds;
  }

  // The kitchen this page shows: 'real' or 'demo'.
  function modeNow() { return mode; }
  // True while this tab is in the demo kitchen, false in the real one.
  function isDemo() { return mode === 'demo'; }
  // True when the start-up named the mode, so the demo and the real kitchen are kept apart (plain tests start without it).
  function isolated() { return strict; }
  // Reloads the page (or calls the reload hook given to init). Returns true when a reload was asked for.
  function reloadPage() {
    try { if (reloadFn) { reloadFn(); return true; } if (g.location && typeof g.location.reload === 'function') { g.location.reload(); return true; } } catch (e) { /* ignore */ }
    return false;
  }
  // Switches this tab to the demo: saves the real kitchen first, remembers the choice for this tab only, and reloads.
  // The real data is not touched again while the tab is in the demo. Returns false when already in the demo or the
  // browser cannot remember the choice.
  function enterDemo() {
    if (mode === 'demo' || !state) return false;
    flush();
    try { g.sessionStorage.setItem(U.MODE_KEY, 'demo'); } catch (e) { return false; }
    reloadPage();
    return true;
  }
  // Leaves the demo: throws away everything the demo saved, forgets the choice, stops this tab saving, and reloads into
  // the real kitchen. Returns false when not in the demo.
  function leaveDemo() {
    if (mode !== 'demo') return false;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = false; storage = null; // nothing more may be saved from this tab
    try { for (const k of baseStorage.keys ? baseStorage.keys('smokebox.demo.') : []) baseStorage.remove(k); } catch (e) { /* ignore */ }
    try { g.sessionStorage.removeItem(U.MODE_KEY); } catch (e) { /* ignore */ }
    try { if (g.location && /[?&]demo(=|&|$)/.test(g.location.search || '') && g.history && g.history.replaceState) g.history.replaceState(null, '', g.location.pathname + g.location.hash); } catch (e) { /* ignore */ }
    reloadPage();
    return true;
  }
  // Gives a brand-new empty kitchen neutral station and menu-section names instead of the barbecue ones (Pit, Meats ...),
  // through the owner-names mechanism, so they are saved with the kitchen and carried in backups. Does nothing in the demo,
  // in a kitchen that has dishes or began from the sample, or when the owner already chose names. Returns true when applied.
  function applyStarterNames() {
    const C = SB.config;
    if (!state || mode === 'demo' || state.catalog !== 'own' || !C || typeof C.applyCustom !== 'function' || typeof C.customSpec !== 'function') return false;
    if (state.menu.some((m) => !m.archived)) return false;
    try {
      const cur = C.customSpec();
      // True when a part of the saved names holds at least one rename or added entry.
      const used = (o) => o && typeof o === 'object' && Object.keys(o).some((k) => (Array.isArray(o[k]) ? o[k].length : o[k] && typeof o[k] === 'object' && Object.keys(o[k]).length));
      if (used(cur.rename) || used(cur.add)) return false;
      const res = C.applyCustom(STARTER_NAMES);
      if (res.rejected.length) { C.applyCustom(cur); return false; }
      return C.saveCustom(STARTER_NAMES) !== false;
    } catch (e) { return false; }
  }
  // Saves the half-built order from the New ticket screen (any plain JSON object the screen can rebuild from). Returns true when
  // saved; false when it is not a plain object, too big (20,000 characters) or the browser refuses. Not part of backups.
  // In the demo it is saved under the demo's own key. A successful createTicket by a person clears it.
  function saveDraft(draft) {
    if (!storage || !draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
    try {
      const rec = { v: 1, at: realNow(), draft };
      if (JSON.stringify(rec).length > DRAFT_MAX_CHARS) return false;
      return storage.set(DRAFT_KEY, rec) !== false;
    } catch (e) { return false; }
  }
  // The saved half-built order, or null when there is none, it is older than 12 hours, or the saved text is damaged (a damaged
  // or stale draft is removed). Returns a copy the screen may change.
  function loadDraft() {
    if (!storage) return null;
    try {
      let rec = null;
      try { rec = storage.get(DRAFT_KEY, null); } catch (e) { rec = null; }
      if (rec == null) { if (storage.raw && storage.raw(DRAFT_KEY) != null) storage.remove(DRAFT_KEY); return null; }
      const ok = rec && typeof rec === 'object' && rec.v === 1 && isNum(rec.at) && rec.draft && typeof rec.draft === 'object' && !Array.isArray(rec.draft)
        && realNow() - rec.at <= DRAFT_MAX_AGE_MS && rec.at <= realNow() + DRAFT_MAX_AGE_MS && JSON.stringify(rec).length <= DRAFT_MAX_CHARS;
      if (!ok) { storage.remove(DRAFT_KEY); return null; }
      return JSON.parse(JSON.stringify(rec.draft));
    } catch (e) { return null; }
  }
  // Throws the saved half-built order away (the order was sent or cancelled).
  function clearDraft() { try { if (storage) storage.remove(DRAFT_KEY); } catch (e) { /* ignore */ } }
  // The SHA-256 of text as 64 hex characters, or null when this browser has no secure hashing. Asynchronous.
  async function sha256Hex(text) {
    const c = g.crypto && g.crypto.subtle;
    if (!c || typeof c.digest !== 'function' || typeof TextEncoder === 'undefined') return null;
    const buf = await c.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
  }
  // A recovery code as typed (any case, spaces and dashes allowed) made into its plain form, or '' when it cannot be a code.
  function normalizeCode(text) {
    const t = String(text == null ? '' : text).toUpperCase().replace(/[\s-]+/g, '');
    return t.length === 10 && t.split('').every((ch) => RECOVERY_ALPHABET.indexOf(ch) >= 0) ? t : '';
  }
  // The stored form of a recovery code: a salted SHA-256 (only this is ever saved, never the code).
  async function hashCode(plain) {
    const salted = await U.secretHash('smokebox-recovery-v1:', plain);
    if (salted !== null) return salted;
    const hex = await sha256Hex('smokebox-recovery-v1:' + plain);     // a browser without PBKDF2 keeps the old plain form
    return hex === null ? null : 'sha256:' + hex;
  }
  // True when a back office PIN is set.
  const hasPin = () => !!(state && state.settings && state.settings.office && state.settings.office.pinHash);
  // True when a recovery code has been made for the current PIN.
  function hasRecoveryCode() { return !!(state && state.settings && state.settings.office && state.settings.office.recoveryHash); }
  // Makes a new recovery code for the current PIN, saves only its hash in the settings, and returns the code once as { ok, code }
  // ("ABCDE-FGHJK") for the screen to show and the owner to write down. Any earlier code stops working. Needs a PIN
  // (pinRequired); works for a PIN that was set before recovery codes existed. The code is never stored or logged.
  async function createRecoveryCode() {
    if (!state) return { ok: false, report: 'invalidBackup', info: {} };
    if (!hasPin()) return { ok: false, report: 'pinRequired', info: {} };
    const bytes = new Uint8Array(10);
    if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') return { ok: false, report: 'noCrypto', info: {} };
    g.crypto.getRandomValues(bytes);
    const plain = Array.from(bytes).map((b) => RECOVERY_ALPHABET[b % 32]).join('');
    const hash = await hashCode(plain);
    if (hash === null) return { ok: false, report: 'noCrypto', info: {} };
    const rep = dispatch('updateSettings', { patch: { office: { recoveryHash: hash } } }, { source: 'user' });
    if (rep !== 'ok') return { ok: false, report: rep, info: {} };
    persistNow();
    return { ok: true, report: 'ok', code: plain.slice(0, 5) + '-' + plain.slice(5), info: {} };
  }
  // Uses a recovery code to reset the back office PIN. newPinHash is the new PIN's hash (the same form the PIN screen saves) or null
  // to remove the PIN. A wrong code is counted: after 5 wrong codes it is locked for 15 minutes, even for the right code, and the
  // count survives a reload. The right code is spent (a new one can be made once the new PIN is set). Returns { ok, report, info }.
  async function recoverPin(code, newPinHash) {
    if (!state) return { ok: false, report: 'invalidBackup', info: {} };
    if (newPinHash !== null && !(typeof newPinHash === 'string' && newPinHash.length > 0 && newPinHash.length <= 128)) return { ok: false, report: 'badPatch', info: { key: 'newPinHash' } };
    if (!hasRecoveryCode()) return { ok: false, report: 'noRecoveryCode', info: {} };
    const t = realNow();
    let rec = { fails: 0, until: 0 };
    try { const r = storage ? storage.get(RECOVERY_KEY, null) : null; if (r && typeof r === 'object' && isNum(r.fails) && isNum(r.until)) rec = { fails: Math.max(0, Math.floor(r.fails)), until: r.until }; } catch (e) { rec = { fails: 0, until: 0 }; }
    if (rec.until > t) return { ok: false, report: 'recoveryLocked', info: { waitMs: rec.until - t } };
    if (rec.until && rec.until <= t) rec = { fails: 0, until: 0 };
    const plain = normalizeCode(code);
    const stored = state.settings.office.recoveryHash;
    const chk = plain ? await U.secretCheck('smokebox-recovery-v1:', plain, stored) : { ok: false };
    if (plain && !chk.ok && !(g.crypto && g.crypto.subtle)) return { ok: false, report: 'noCrypto', info: {} };
    if (!plain || !chk.ok) {
      rec.fails++;
      const locked = rec.fails >= RECOVERY_TRIES;
      if (locked) rec = { fails: 0, until: t + RECOVERY_LOCK_MS };
      try { if (storage) storage.set(RECOVERY_KEY, rec); } catch (e) { /* the count is kept in memory only */ }
      return locked ? { ok: false, report: 'recoveryLocked', info: { waitMs: RECOVERY_LOCK_MS } } : { ok: false, report: 'wrongRecoveryCode', info: { triesLeft: RECOVERY_TRIES - rec.fails } };
    }
    const rep = dispatch('updateSettings', { patch: { office: { pinHash: newPinHash, recoveryHash: null } } }, { source: 'user' });
    if (rep !== 'ok' && rep !== 'nothingToDo') return { ok: false, report: rep, info: {} };
    try { if (storage) storage.remove(RECOVERY_KEY); } catch (e) { /* ignore */ }
    persistNow();
    return { ok: true, report: 'ok', info: { pinRemoved: newPinHash === null } };
  }
  // Starts the real kitchen over with an empty menu. Needs opts.confirm to be the typed word (SB.store.START_OVER_WORD, any case),
  // refuses in the demo, and takes a full backup first: if the backup cannot be made nothing is cleared. Then it clears dishes,
  // ingredients, stock, batches, tickets, orders and history (resetLive, catalog 'blank') and the setup-progress choices, so the
  // kitchen is exactly like a brand-new install. opts.keepSettings (default true) keeps tax, hours, PIN, units and station names;
  // false resets those too. Returns { ok, report, info, backup? } with backup { text, filename, mime, savedAt, chars } for the
  // screen to download; the old last good copy and any set-aside damaged copy are dropped after the erase and the last good copy is retaken from the empty kitchen, so a damaged save can never bring the erased kitchen back.
  // WATCH OUT: the demo's keys are never read or written here.
  function startOver(opts) {
    opts = opts || {};
    // Records and returns a refusal; nothing has been changed when this is used.
    const fail = (report, info) => { last = { type: 'startOver', report, info: info || {}, events: [] }; return { ok: false, report, info: info || {} }; };
    if (!state) return fail('invalidBackup');
    if (mode === 'demo') return fail('notInDemo');
    if (typeof opts.confirm !== 'string' || opts.confirm.trim().toUpperCase() !== START_OVER_WORD) return fail('confirmWord', { word: START_OVER_WORD });
    if (opts.keepSettings != null && typeof opts.keepSettings !== 'boolean') return fail('badPatch', { key: 'keepSettings' });
    // The screen must say a backup file was really saved (its name and size) before anything is erased.
    const bs = opts.backupSaved;
    if (!bs || typeof bs !== 'object' || typeof bs.filename !== 'string' || !bs.filename.trim() || !(Number.isFinite(bs.chars) && bs.chars > 0)) return fail('backupRequired');
    const keep = opts.keepSettings !== false;
    const text = exportAll();
    if (text == null) { const lr = last || {}; return fail(lr.report || 'invalidBackup', lr.info); }
    const savedAt = realNow();
    const rep = resetLive({ keepSettings: keep, catalog: 'blank', replaceOwn: true, starter: false });
    if (rep !== 'ok') return fail(rep);
    for (const k of START_OVER_KEYS) { try { storage.remove(k); } catch (e) { /* ignore */ } }
    // Only now that the erase went in: the rolling last-good copy and any set-aside damaged copy still hold the old kitchen's
    // customers and orders, so both are dropped and the last-good copy is retaken from the new empty kitchen.
    try { storage.remove(LASTGOOD_KEY); storage.remove(CORRUPT_KEY); storage.remove(CORRUPT_AT_KEY); } catch (e) { /* ignore */ }
    st.corrupt = null;
    // Actions queued for a hub that it never confirmed belong to the erased kitchen: they are dropped (and marked, so another
    // tab's saved copy cannot bring them back), and only the erase itself stays in the queue so the hub is told. Nothing queued
    // is touched when the erase failed, because we returned above.
    const ri = outbox.map((x) => x.type).lastIndexOf('resetLive');
    for (const x of outbox.slice(0, ri < 0 ? outbox.length : ri)) acked.add(x.opId);
    outbox = ri < 0 ? [] : outbox.slice(ri);
    if (ri < 0) { try { storage.remove(OUTBOX_KEY); } catch (e) { /* ignore */ } } else saveOutbox();
    snapWanted = 'startOver'; persistNow(); maybeSnapshot(savedAt);
    if (!keep && SB.config && typeof SB.config.applyCustom === 'function') {
      try { SB.config.applyCustom({}); SB.config.saveCustom({ rename: {}, add: {} }); } catch (e) { /* the names stay as they were */ }
    }
    if (!keep) applyStarterNames();
    last = { type: 'startOver', report: 'ok', info: { keepSettings: keep }, events: [] };
    const d = new Date(savedAt);
    // Two-digit number for the file name.
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return { ok: true, report: 'ok', info: { keepSettings: keep }, backup: { text, filename: 'smokebox-before-start-over-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json', mime: 'application/json', savedAt, chars: text.length } };
  }
  // Counts the old demo and sample tickets in this kitchen's real reports (see the engine's demoLeftovers), and whether the
  // owner already chose to keep them. In the demo it counts nothing (demo tickets belong there). { tickets, orders, paidOrders,
  // openOrders, mixedOrders, events, kept, offer } where offer is true when there is something to clear and no "keep" answer yet.
  function demoLeftovers() {
    const c = state && mode !== 'demo' ? E().demoLeftovers(state) : { tickets: 0, orders: 0, paidOrders: 0, openOrders: 0, mixedOrders: 0, events: 0 };
    let kept = false;
    try { kept = !!(storage && storage.get(KEPT_KEY, false) === true); } catch (e) { kept = false; }
    return Object.assign(c, { kept, offer: (c.tickets > 0 || c.orders > 0) && !kept });
  }
  // Remembers that the owner chose to keep the old demo tickets, so the offer is not made again. Returns true when saved.
  function keepDemoLeftovers() {
    try { return !!storage && mode !== 'demo' && storage.set(KEPT_KEY, true) !== false; } catch (e) { return false; }
  }
  // Removes the old demo and sample tickets (the engine action clearDemoTickets) and saves. Refuses in the demo. Returns
  // { ok, report, info } where info has the counts removed.
  function clearDemoLeftovers() {
    if (!state) return { ok: false, report: 'invalidBackup', info: {} };
    if (mode === 'demo') return { ok: false, report: 'notInDemo', info: {} };
    const r = dispatchEx('clearDemoTickets', {}, { source: 'user' });
    if (r.report === 'ok') persistNow();
    return { ok: r.report === 'ok', report: r.report, info: r.info || {} };
  }
  // True while this kitchen began empty and still has no dish on the menu (archived dishes do not count): the setup
  // screens use it to know a first-time owner is looking at an empty kitchen. False for old saves and the demo.
  function isBlank() {
    return !!(state && state.catalog === 'own' && !state.menu.some((m) => !m.archived));
  }
  // True when this kitchen began empty (the sample dishes were never loaded into it), even after dishes were added.
  function isOwn() { return !!(state && state.catalog === 'own'); }

  // Public API: init, destroy, status, getState, now, tick, dispatch, dispatchEx, lastResult, subscribe,
  // subscribeTick, flushNotify, setSpeed, speed, clock, flush, reconcile, historyFill, historyNotice, historyNoticeSeen, exportAll, importAll, closeMonthPreview, closeMonthExport, closeMonthPrune, beforeRestoreInfo, undoRestore, exportCsv, reset,
  // resetLive, attachSim, dataset, select, KEY, CORRUPT_KEY.
  SB.store = {
    init, destroy, status, getState: () => state, now, tick: tickNow, dispatch, dispatchEx, lastResult: () => last,
    // Clock readers: speed gives the demo speed, clock gives the whole clock card.
    subscribe, subscribeTick, flushNotify, setSpeed, speed: () => clk.speed, clock: () => ({ now: now(), speed: clk.speed, base: clk.base, realBase: clk.realBase }),
    acceptClockJump, damagedText: () => heldText, releaseHold: () => { writeBlocked = false; heldText = null; st.heldInMemory = false; schedulePersist(false); }, flush, reconcile, historyFill, historyNotice, historyNoticeSeen, exportAll, importAll, closeMonthPreview, closeMonthExport, closeMonthPrune, beforeRestoreInfo, undoRestore, exportCsv, reset, resetLive, attachSim, dataset, select, isBlank, isOwn, createRecoveryCode, recoverPin, hasRecoveryCode, saveDraft, loadDraft, clearDraft, applyStarterNames, STARTER_NAMES, startOver, START_OVER_WORD, demoLeftovers, keepDemoLeftovers, clearDemoLeftovers, mode: modeNow, isDemo, isolated, enterDemo, leaveDemo, KEY, CORRUPT_KEY,
    // Messages between the tabs of this browser (alert leader, played and acknowledged sounds).
    broadcast, onBroadcast, canBroadcast: () => !!tr, tabId,
    // Server-ready pieces: the transport interface is described above (search "TRANSPORT INTERFACE").
    channelTransport, outbox: () => outbox.map((x) => Object.assign({}, x)), syncNow: () => { retryAt = 0; pushOutbox(); }, ackOps,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
