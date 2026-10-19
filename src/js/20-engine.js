/*
 * WHAT THIS FILE IS: The kitchen brain (SB.engine). It takes the whole board (the "state") and one action, such
 *   as a new ticket, an item done, a temperature reading or undo, and gives back the new board and a report.
 * PARTS: 1 reports and constants, 2 helpers, 3 settings, 4 pacing, 5 yield, 6 safety gates, 7 stock and 86,
 *   8 events, 9 transaction, 10 depletion and learning, 11 actions and undo, 12 pruning, 13 tick and apply,
 *   14 newState, 15 views, 16 invariants, 17 backups, 18 messages, 19 exports.
 * USES / USED BY: uses 00-util.js and 10-config.js. Used by 30-store.js, 40-metrics.js, 45-sim.js, the screens.
 */

/* Smokebox KDS - 20-engine.js
 * Pure kitchen logic: SB.engine. No DOM, no clock (`now` is always passed in), no randomness (simulated sync delays come
 * from a deterministic string hash). Every operation is TOTAL: junk input returns a report from the closed set (SPEC 9)
 * and the SAME state reference. Successful operations return a new state that shares every untouched object (copy-on-write).
 *
 * Public API (other modules code against these names; see docs/smokebox.z.md for the formal statement):
 *   apply(state, type, payload, now)      -> { state, report, events, info }      (ACTIONS lists every type + payload)
 *   tick(state, now)                      -> { state, events }   same ref when nothing is due
 *   newState({ now, empty?, stagger?, settings?, menu?, ingredients?, learned?, seq? }) -> state
 *   availability(state, menuId)           -> { ok, reason: null|'manual'|'safety'|'stock', ing }
 *   computeAvail(state)                   -> { [menuId]: { ok, reason, ing } }
 *   servable(state, ingId)                -> grams (or 'ea') that can be served now
 *   allDay(state, zone?)                  -> [{ menuId, name, short, zone, required, total, queued, displayed, cooking, done, zoneBreakdown }]
 *   gate(batch, now, safety)              -> { canServe, action, reason, severity, status, nextDeadlineAt?, text }
 *   thermalYield({ endpointC, holdH, rawG, costPerKgRaw }) -> { endpointC, holdH, hotPct, chilledPct, cookedG, chilledG, trueCostPerCookedKg, trueCostPerChilledKg }
 *   staticYieldComparison({ rawG, costPerKgRaw, endpointC, holdH, staticPct=50 }) -> { staticPct, modelPct, ..., costErrorPct, weightErrorPct }
 *   pacingPlan(lines, createdAt, settings, learned, menu?, rush?) -> { paced, dmaxSec, readySec, readyAt, lines:[{ menuId, name, zone, qty, prepSec, offsetSec, fireAt }] }
 *   planFor(state, lines, now, rush?)     -> same as pacingPlan, using the state's settings/learned/menu
 *   ticketTiming(ticket, now, settings)   -> { elapsedMs, level: 'ok'|'warn'|'breach', warnMs, breachMs, pct }
 *   ticketProgress(ticket)                -> { total, done, queued, displayed, cooking, qtyTotal, qtyDone, pct, ready, byZone }
 *   checkInvariants(state, now?)          -> string[] (empty = healthy; I1-I15 of SPEC 10, structural parts)
 *   validateBackup(objOrText)             -> { ok, state?, error?, repaired: string[] }
 *   serialize(state) -> string             deserialize(text) -> validateBackup result
 *   allEvents(state)                      -> Event[] (archive chunks + recent window, oldest first; memoised)
 *   prune(state, { maxTickets?, maxEvents? }) -> state (drops oldest completed tickets / oldest events, keeps the ledger whole)
 *   findTicket(state, id) -> ticket|undefined      channelThresholds(settings, channelId) -> { warnSec, breachSec }
 *   views.*: activeTickets, ticketsForZone, expoTickets, recent, voided, counts, unavailable, batches (pure, used by SB.store.select)
 *   REPORTS (id -> plain-English message with the fix), REPORT_IDS, describe(report, info, settings) -> message with live numbers
 *   ACTIONS (type -> payload doc), UNDOABLE, DISCARD_REASONS, defaultSettings(), helpers: { stampAfter, hashStr, qtyScale, estimate,
 *   syncDelayMs, nominalUnitCost }
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const C = SB.config;
  const E = (SB.engine = {});

  /* ======================================================================================================
   * 1. Constants: reports, actions
   * ==================================================================================================== */
  // Every answer an action can give. The list is closed: apply() turns anything else into badPatch.
  const REPORT_IDS = ['ok', 'unknownAction', 'unknownTicket', 'unknownItem', 'unknownMenu', 'unknownBatch', 'unknownIng',
    'emptyOrder', 'badQty', 'tooManyItems', 'badCustomer', 'badChannel', 'noteTooLong', 'itemUnavailable', 'ticketNotActive',
    'ticketNotExpedited', 'notAllDone', 'alreadyDone', 'alreadyFired', 'notQueued', 'nothingToDo', 'reasonRequired', 'badTemp',
    'tempTooLow', 'notReheatable', 'notEnoughData', 'batchNotServable', 'badWeight', 'badPatch', 'outOfBounds', 'undoExpired',
    'undoNothing', 'undoConflict', 'invalidBackup', 'exportTooLarge', 'storageBlocked', 'unknownOrder', 'orderNotOpen', 'orderNotPaid', 'orderEmpty',
    'orderNotEmpty', 'badPayment', 'qualityNotDue', 'tempReadingNeeded', 'whoRequired', 'badUntil', 'badPlanTime', 'unknownPlan', 'badSnooze', 'notStarted', 'alreadyStarted'];

  // Added to every safety message: the reminder that the local health code overrides this app.
  const SAFETY = ' ' + C.safetyLine;
  // Plain-English message for each report id, each saying how to fix it. One row per id in REPORT_IDS.
  // audit:data-start
  const REPORTS = {
    ok: 'Done.',
    unknownAction: 'That action is not recognized. Reload the page and try again.',
    unknownTicket: 'That ticket is no longer on the board. It may have been cleared; check Recall.',
    unknownItem: 'That item is not on this ticket any more. Refresh the board and try again.',
    unknownMenu: 'That item is not on the menu. Pick another item.',
    unknownBatch: 'That batch is not in the hold cabinet any more. Refresh the hold cabinet.',
    unknownIng: 'That ingredient is not tracked here. Pick one from the list.',
    emptyOrder: 'Pick at least one item before sending.',
    badQty: 'Quantity must be a whole number from 1 to ' + C.limits.maxQty + '.',
    tooManyItems: 'A ticket holds up to ' + C.limits.maxItemsPerTicket + ' lines. Split the order into two tickets.',
    badCustomer: 'Customer name must be 1 to ' + C.limits.maxCustomerLen + ' characters. Shorten it or pick a quick name.',
    badChannel: 'Pick an order channel: dine-in, takeout, drive-thru or delivery app.',
    noteTooLong: 'That text is too long. Notes hold ' + C.limits.maxNoteLen + ' characters; names, labels and reasons hold 40. Put the allergy first.',
    itemUnavailable: 'That item is 86 right now. Take it off the order or pick something else.',
    ticketNotActive: 'That ticket is already bumped or voided. Recall it first if it needs more work.',
    ticketNotExpedited: 'Only bumped tickets can be recalled.',
    notAllDone: 'Some items are not done yet. Finish them, or use Bump anyway to send the ticket out.',
    alreadyDone: 'That item is already done. Use Undo if it was a mistake.',
    alreadyFired: 'That item is already on the station screen.',
    notQueued: 'That item is not waiting, so there is nothing to start early.',
    nothingToDo: 'Nothing to change. A waiting item needs Start now before it can be started.',
    reasonRequired: 'Pick a reason first (for example: wrong order, customer left, dropped).',
    badTemp: 'Enter a temperature between 32 and 300 °F.',
    tempTooLow: 'A reheat needs a reading of at least ' + C.safety.reheatF + ' °F. Keep heating and log it again.' + SAFETY,
    notReheatable: 'This batch cannot be reheated: only one reheat is allowed, and only within ' + C.safety.belowHotGraceH + ' hours of going below ' + C.safety.hotHoldF + ' °F. Discard it.' + SAFETY,
    notEnoughData: 'Not enough data yet. Run a few more tickets first.',
    batchNotServable: 'That batch is locked or already discarded, so it cannot be used.' + SAFETY,
    badWeight: 'Enter a weight above 0 g (up to 1,000 kg).',
    badPatch: 'Some of those values are not valid. Check the field and try again.',
    outOfBounds: 'That value is outside the allowed range. Check the limits shown next to the field.',
    undoExpired: 'Too late to undo: the undo window has passed. Fix it by hand instead.',
    undoNothing: 'Nothing to undo.',
    undoConflict: 'Cannot undo: that ticket or batch has changed since. Fix it by hand instead.',
    invalidBackup: 'That file is not a valid Smokebox backup. Nothing was changed.',
    exportTooLarge: 'The backup is too large to save as one file. Reset old live data, then export again.',
    storageBlocked: 'This browser is blocking storage, so changes will not survive a reload. Allow site data or use a normal window.',
    unknownOrder: 'That order is no longer here. It may have been cleared; check the open orders list.',
    orderNotOpen: 'That order is already paid or voided. Reopen it first if it needs changing.',
    orderNotPaid: 'Only a paid order can be reopened.',
    orderEmpty: 'There is nothing on this order to pay. Add items first, or void the order.',
    orderNotEmpty: 'That order still has food on it. Void its tickets first, or take payment.',
    badPayment: 'Pick how it was paid (cash, card or other), and enter the tip and discount as dollar amounts.',
    qualityNotDue: 'That batch is not past a quality limit, so there is nothing to keep serving.',
    tempReadingNeeded: 'Log a temperature first: a reading in range (hot food at ' + C.safety.hotHoldF + ' °F or higher), taken within the temperature-check interval, is needed before keeping it on the menu.',
    whoRequired: 'Enter your initials so the extension can be logged with who tasted it.',
    badUntil: 'Pick a time later than now, or choose 30 minutes or 1 hour.',
    badPlanTime: 'Pick a time when the batch comes off the smoker: within the next day and a half, and not already past its serving time.',
    unknownPlan: 'That planned batch is gone. It may have been used, cancelled or expired.',
    notStarted: 'Start this ticket first, then release it when the food is ready.',
    alreadyStarted: 'This ticket was already started.',
    badSnooze: 'A reminder can be put off for 1 to 30 minutes, only for a batch still on the menu, and never past 5 minutes before its last warning. The last warning, a past-quality batch and a thrown-out batch cannot be put off.',
  };

  // audit:data-end
  // Every action type with the facts (payload) it needs. A trailing ? means optional. Used by the tests and
  // the docs.
  // audit:data-start
  const ACTIONS = {
    createTicket: '{ customer?, channel?, orderId?, pay?:{ method, tip?, discount? }, items:[{ menuId, qty?=1, mods?:string[] }], note?, rush?, src?:"live"|"demo"|"sample", createdAt?, allowPast?, awaitStart?:true }',
    payOrder: '{ orderId, method:"cash"|"card"|"other", tip?, discount? }',
    reopenOrder: '{ orderId }',
    voidOrder: '{ orderId, reason }',
    advanceItem: '{ ticketId, itemId }',
    completeItem: '{ ticketId, itemId }',
    fireNow: '{ ticketId, itemId, start?:true }',
    completeZone: '{ ticketId, zone }',
    startTicket: '{ ticketId }',
    releaseTicket: '{ ticketId }',
    bumpTicket: '{ ticketId, force?:true }',
    recallTicket: '{ ticketId }',
    voidTicket: '{ ticketId, reason }',
    setRush: '{ ticketId, on:boolean }',
    toggle86: '{ menuId, on:boolean }',
    restock: '{ ing, g }',
    addBatch: '{ ing, tempF, rawG?, cookedG?, endpointC?, holdH?, label?, src?:"cook"|"sample"|"starter" }',
    logTemp: '{ batchId, tempF }',
    reheatBatch: '{ batchId, tempF }',
    startCooling: '{ batchId, g? }',
    pullBatch: '{ ing, g }',
    keepServing: '{ batchIds:string[], forMin?, until?, who }',
    endKeepServing: '{ batchId, who, note? }',
    planBatch: '{ ing, grams, offAt }',
    cancelPlan: '{ planId }',
    snoozeAlert: '{ batchId, forMin }',
    clearSnooze: '{ batchId }',
    discardBatch: '{ batchId, reason:"expired"|"temp"|"cooling"|"manual"|"quality"|"other" }',
    sanitizeDone: '{}',
    updateSettings: '{ patch }',
    updateMenuItem: '{ id, patch }',
    addMenuItem: '{ name, short?, zone, cat, price, prepSec, track:"one"|"two" }',
    updateIngredient: '{ id, patch }',
    resetLive: '{ keepSettings?=true }',
    undo: '{}',
    uiReport: '{ action, report }',
  };
  // audit:data-end
  // The actions that can be undone inside the undo window.
  const UNDOABLE = ['startTicket', 'releaseTicket', 'advanceItem', 'completeItem', 'completeZone', 'bumpTicket', 'voidTicket', 'toggle86', 'fireNow', 'pullBatch', 'discardBatch', 'sanitizeDone', 'planBatch', 'cancelPlan', 'snoozeAlert', 'clearSnooze'];

  // Time units in milliseconds: H is one hour, MIN is one minute.
  const H = 3600e3, MIN = 60e3;
  const EVENT_CHUNK = 1024;           // recent window holds 1024..2047 events; older events move to immutable archive chunks
  // MAX_UNDO: undo steps kept. MAX_TEMPS: readings kept per batch. MAX_BACKUP_CHARS: biggest backup text we
  // read (24 million characters). PAST_LIMIT_MS: how far back a ticket may be dated, 48 hours (simulator
  // and imports only).
  const MAX_UNDO = 20;
  const MAX_TEMPS = 200;
  const MAX_BACKUP_CHARS = 24e6;
  const PAST_LIMIT_MS = 48 * H;
  // The reasons a batch can be thrown out. SAFETY_DISCARDS are the three that mean a food-safety problem;
  // those put dishes on "safety hold". Manual, quality and other do not.
  const DISCARD_REASONS = ['expired', 'temp', 'cooling', 'manual', 'quality', 'other'];
  const SAFETY_DISCARDS = { expired: 1, temp: 1, cooling: 1 };
  // Lists of allowed words. The 1 only means "is allowed" (tested with hasOwn). STATUS_OF turns a gate
  // action word into the status word stored on a batch.
  const TICKET_STATUS = { active: 1, expedited: 1, voided: 1 };
  // The three states of an order (the check): open while food is still being added, paid, or voided.
  const ORDER_STATUS = { open: 1, paid: 1, voided: 1 };
  const ITEM_STATUS = { queued: 1, displayed: 1, cooking: 1, done: 1 };
  const BATCH_STATUS = { ok: 1, check: 1, reheat: 1, chill: 1, past: 1, discard: 1 };
  const BATCH_KIND = { hot: 1, cold: 1, cooling: 1 };
  const STATUS_OF = { NONE: 'ok', CHECK_TEMP: 'check', REHEAT_IMMEDIATE: 'reheat', CHILL_NOW: 'chill', PAST_QUALITY: 'past', DISCARD_LOCKOUT: 'discard' };
  const SRC_TICKET = { live: 1, demo: 1, sample: 1 };
  const SRC_BATCH = { cook: 1, sample: 1, starter: 1 };

  /* ======================================================================================================
   * 2. Small helpers
   * ==================================================================================================== */
  const OP = Object.prototype;
  // True only when o itself carries the label k, not one it inherits (like toString). Safe when o is null.
  const hasOwn = (o, k) => o != null && OP.hasOwnProperty.call(o, k);
  // True for a real, finite number (not text, not NaN, not infinity).
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // True for a plain labelled record (an object): not null and not a list.
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  // True when the value is a whole number (no decimals).
  const isInt = (n) => Number.isInteger(n);
  // Pulls n back inside the range lo to hi.
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // Rounds n to d decimal places.
  const round = (n, d) => { const f = Math.pow(10, d); return Math.round(n * f) / f; };
  // A gram amount below this (a billionth of a gram) counts as zero, because decimal sums are never exact.
  const EPS = 1e-9;
  /** keys that would be dangerous as plain-object property names ("__proto__", "toString", ...) */
  const safeKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 64 && !(k in OP) && k !== '__proto__' && k !== 'prototype';
  /** Pitcall F6: a later stamp is never earlier than an earlier one. */
  const stampAfter = (prev, now) => (isNum(prev) && prev > now ? prev : now);
  /** FNV-1a 32-bit. Deterministic; used for simulated sync delays. */
  function hashStr(s) {
    s = String(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  /** Simulated propagation delay for one channel target: 2..40 s, fixed per (syncId, target). */
  const syncDelayMs = (syncId, targetId) => 2000 + (hashStr(syncId + '|' + targetId) % 38001);
  // Squeezes runs of spaces, tabs and line breaks into single spaces and trims both ends.
  const cleanText = (s) => s.replace(/\s+/g, ' ').trim();
  // True when the sorted list a contains x. Halves the search each step, so it stays fast on long lists.
  const sortedHas = (a, x) => { let lo = 0, hi = a.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] === x) return true; if (a[m] < x) lo = m + 1; else hi = m - 1; } return false; };

  /* ---------- lookups (memoised per array; arrays are immutable once published) ---------- */
  const MENU_MAP = new WeakMap(), ING_MAP = new WeakMap();
  // Builds a lookup table from id to item for a list, once per list, then remembers it.
  function mapOf(cache, arr) {
    let m = cache.get(arr);
    if (!m) { m = new Map(); for (let i = 0; i < arr.length; i++) { const x = arr[i]; if (x && typeof x.id === 'string') m.set(x.id, x); } cache.set(arr, m); }
    return m;
  }
  // Lookup table from id to menu item for a menu list.
  const menuMap = (menu) => mapOf(MENU_MAP, menu);
  // Lookup table from id to ingredient for an ingredient list.
  const ingMap = (ings) => mapOf(ING_MAP, ings);
  // Finds one menu item by id. Takes the normal list, or an object keyed by id. Gives undefined if missing
  // or if id is not text.
  function getMenu(menu, id) {
    if (typeof id !== 'string') return undefined;
    if (Array.isArray(menu)) return menuMap(menu).get(id);
    return isObj(menu) && hasOwn(menu, id) ? menu[id] : undefined;
  }

  // Reads the number out of a ticket id ('t_17' gives 17). Gives NaN (not a number) for anything of another
  // shape.
  function tSeq(id) {
    if (typeof id !== 'string' || id.length < 3 || id.charCodeAt(0) !== 116 || id.charCodeAt(1) !== 95) return NaN;
    const n = Number(id.slice(2));
    return isInt(n) ? n : NaN;
  }
  // Position of a ticket in the list, or -1. Ids are 't_<number>' and the list is sorted by that number, so
  // this halves the search; odd ids fall back to a scan from the newest end.
  function findTicketIdx(tickets, id) {
    if (typeof id !== 'string' || !Array.isArray(tickets)) return -1;
    const n = tSeq(id);
    if (n === n) {
      let lo = 0, hi = tickets.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1; const m = tSeq(tickets[mid].id);
        if (m !== m) break;
        if (m === n) { if (tickets[mid].id === id) return mid; break; }
        if (m < n) lo = mid + 1; else hi = mid - 1;
      }
    }
    for (let i = tickets.length - 1; i >= 0; i--) if (tickets[i].id === id) return i;
    return -1;
  }
  // Reads the number out of an order id ('o_4' gives 4). Gives NaN for anything of another shape.
  function oSeq(id) {
    if (typeof id !== 'string' || id.length < 3 || id.charCodeAt(0) !== 111 || id.charCodeAt(1) !== 95) return NaN;
    const n = Number(id.slice(2));
    return isInt(n) ? n : NaN;
  }
  // Position of an order in the list, or -1. Scans from the newest end, because open orders are the recent ones.
  function findOrderIdx(orders, id) {
    if (typeof id !== 'string' || !Array.isArray(orders)) return -1;
    for (let i = orders.length - 1; i >= 0; i--) if (orders[i].id === id) return i;
    return -1;
  }
  // Position of an item inside a ticket, or -1 when itemId is not text or not found.
  function findItemIdx(ticket, itemId) {
    if (typeof itemId !== 'string') return -1;
    const items = ticket.items;
    for (let i = 0; i < items.length; i++) if (items[i].id === itemId) return i;
    return -1;
  }
  // Position of a batch in the hold cabinet list, or -1. Scans from the newest end.
  function findBatchIdx(batches, id) {
    if (typeof id !== 'string') return -1;
    for (let i = batches.length - 1; i >= 0; i--) if (batches[i].id === id) return i;
    return -1;
  }

  /** Indices of active tickets (sorted asc), memoised per tickets array and carried forward by commits. */
  const ACTIVE = new WeakMap();
  function activeIdx(tickets) {
    let a = ACTIVE.get(tickets);
    if (!a) { a = []; for (let i = 0; i < tickets.length; i++) if (tickets[i].status === 'active') a.push(i); ACTIVE.set(tickets, a); }
    return a;
  }

  /* ======================================================================================================
   * 3. Settings
   * ==================================================================================================== */
  // A fresh copy of the owner-editable settings built from the config defaults. Copies, so editing never
  // changes the config.
  function defaultSettings() {
    return {
      pacing: Object.assign({}, C.pacing),
      service: Object.assign({}, C.service),
      safety: Object.assign({}, C.safety, { cooling: Object.assign({}, C.safety.cooling) }),
      channels: C.channels.map((c) => ({ id: c.id, warnSec: c.warnSec, breachSec: c.breachSec })),
      undoMs: C.undoMs,
      syncTargetSec: C.syncTargetSec,
      ui: { theme: 'day', textSize: 'normal', sound: false },
      office: { theme: 'ember', pinHash: null },
      alerts: { ladderThresholds: C.alerts ? C.alerts.ladderThresholds : null },
    };
  }
  // Warn and breach seconds for an order channel: the owner's setting if there is one, else the config
  // default, else 480 / 720.
  function channelThresholds(settings, channelId) {
    const base = hasOwn(C.channelById, channelId) ? C.channelById[channelId] : null;
    let o = null;
    if (settings && Array.isArray(settings.channels)) for (const c of settings.channels) if (c && c.id === channelId) { o = c; break; }
    const warnSec = o && isNum(o.warnSec) ? o.warnSec : base ? base.warnSec : 480;
    const breachSec = o && isNum(o.breachSec) ? o.breachSec : base ? base.breachSec : 720;
    return { warnSec, breachSec };
  }
  // The safety part of the settings, or the config defaults when settings are missing.
  const safetyOf = (settings) => (settings && isObj(settings.safety) ? settings.safety : C.safety);
  // When the next sanitize round is due, counting only open hours (F-B22). The kitchen is shut overnight, so a round
  // that fell due while closed does not make the first round of the next day late: the 4-hour clock restarts at opening.
  function sanitizeDueEff(settings, sz, now) {
    if (!sz || !isNum(sz.dueAt)) return undefined;
    const sv = settings && isObj(settings.service) ? settings.service : C.service;
    const p = U.serviceDate(isNum(now) ? now : sz.dueAt, sv.dayStartHour).split('-').map(Number);
    const openedAt = new Date(p[0], p[1] - 1, p[2], sv.openHour, 0, 0, 0).getTime();
    return sz.dueAt >= openedAt ? sz.dueAt : openedAt + safetyOf(settings).sanitizeEveryH * H;
  }

  /* ======================================================================================================
   * 4. Pacing (research: D_max = max d(i); O(i) = D_max - d(i); shown when now >= t_fire + O(i))
   * ==================================================================================================== */
  // Multiplier for ordering several of one dish: 1 plus qtyFactor for each extra portion, capped at qtyCap.
  // With the starter numbers (0.2 and 2.0): 1 portion x1.0, 3 portions x1.4, 6 or more x2.0. A bad quantity
  // counts as 1.
  function qtyScale(qty, pacing) {
    const P = pacing || C.pacing;
    const q = isNum(qty) && qty >= 1 ? qty : 1;
    return Math.min(P.qtyCap, 1 + P.qtyFactor * (q - 1));
  }
  /** estimate(menu, learned, menuId) = learned[menuId].est ?? menu.prepSec (seconds, one portion). */
  function estimate(menu, learned, menuId) {
    const mi = getMenu(menu, menuId);
    if (!mi) return undefined;
    const l = learned && hasOwn(learned, menuId) ? learned[menuId] : null;
    return l && isNum(l.est) && l.est > 0 ? l.est : mi.prepSec;
  }
  // Planned seconds for one ticket line: estimate times the quantity multiplier, never below floorSec, in
  // whole seconds.
  // Example: brisket half (120 s) ordered twice = 144 s.
  const linePrep = (est, qty, P) => Math.round(Math.max(P.floorSec, est * qtyScale(qty, P)));

  // Meal pacing: works out when each line fires so the whole order finishes together. The slowest line
  // (dmax) fires at once; every other line waits dmax minus its own time. Example: brisket half 120 s plus
  // slaw 30 s: brisket fires at 0, slaw at 90 s, both ready at 120 s.
  function pacingPlan(lines, createdAt, settings, learned, menu, rush) {
    const S = isObj(settings) ? settings : defaultSettings();
    const P = S.pacing || C.pacing;
    const m = menu || C.menu;
    const t0 = isNum(createdAt) ? createdAt : 0;
    const out = [];
    for (const ln of Array.isArray(lines) ? lines : []) {
      const mi = ln && getMenu(m, ln.menuId);
      if (!mi) continue;
      const qty = isInt(ln.qty) && ln.qty >= 1 ? ln.qty : 1;
      out.push({ menuId: mi.id, name: mi.name, short: mi.short, zone: mi.zone, qty, prepSec: linePrep(estimate(m, learned, mi.id), qty, P) });
    }
    // paced is false for a rush ticket or when the owner switched pacing off; then every offset is 0.
    const paced = !!P.enabled && !rush;
    let dmax = 0;
    for (const l of out) if (l.prepSec > dmax) dmax = l.prepSec;
    let ready = 0;
    for (const l of out) {
      l.offsetSec = paced ? dmax - l.prepSec : 0;
      l.fireAt = t0 + l.offsetSec * 1000;
      if (l.offsetSec + l.prepSec > ready) ready = l.offsetSec + l.prepSec;
    }
    return { paced, dmaxSec: paced ? dmax : 0, readySec: ready, readyAt: t0 + ready * 1000, lines: out };
  }
  // pacingPlan using the settings, learned times and menu kept in the state.
  const planFor = (state, lines, now, rush) => pacingPlan(lines, now, state && state.settings, state && state.learned, state && state.menu, rush);

  /* ======================================================================================================
   * 5. Thermal yield (research: Texas A&M regression)
   * ==================================================================================================== */
  // Brisket yield model (Texas A&M regression, numbers in config yieldModel). Hot yield percent = 72.9
  // minus 0.85 for each degree C above 75 minus 2.1 for each hour held; chilled is 2.1 points lower, never
  // under 45. Inputs are clamped to the model range (75 to 90 C, 0 to 3 h) and bad values use the defaults
  // (85 C, 2 h).
  // Example: 85 C and 2 h gives 60.2 percent, so 6000 g raw is 3612 g cooked. Cooked weights and true cost
  // per kg appear only when rawG and costPerKgRaw are given.
  function thermalYield(o) {
    o = isObj(o) ? o : {};
    const M = C.yieldModel;
    const T = clamp(isNum(o.endpointC) ? o.endpointC : M.defaultTempC, M.tempC[0], M.tempC[1]);
    const hold = clamp(isNum(o.holdH) ? o.holdH : M.defaultHoldH, M.holdH[0], M.holdH[1]);
    const hotPct = round(M.base - M.perDegC * (T - M.tempC[0]) - M.perHoldH * hold, 4);
    const chilledPct = round(Math.max(M.chilledFloor, hotPct - M.chilledDelta), 4);
    const rawG = isNum(o.rawG) && o.rawG > 0 ? o.rawG : undefined;
    const cost = isNum(o.costPerKgRaw) && o.costPerKgRaw >= 0 ? o.costPerKgRaw : undefined;
    return {
      endpointC: T, holdH: hold, hotPct, chilledPct,
      cookedG: rawG !== undefined ? Math.round((rawG * hotPct) / 100) : undefined,
      chilledG: rawG !== undefined ? Math.round((rawG * chilledPct) / 100) : undefined,
      trueCostPerCookedKg: cost !== undefined ? round(cost / (hotPct / 100), 2) : undefined,
      trueCostPerChilledKg: cost !== undefined ? round(cost / (chilledPct / 100), 2) : undefined,
    };
  }
  /** "The static 50% assumption would misprice this batch by X%". Positive costErrorPct = static overstates cost per cooked kg. */
  function staticYieldComparison(o) {
    o = isObj(o) ? o : {};
    const staticPct = isNum(o.staticPct) && o.staticPct > 0 ? o.staticPct : 50;
    const ty = thermalYield(o);
    const cost = isNum(o.costPerKgRaw) ? o.costPerKgRaw : undefined;
    const rawG = isNum(o.rawG) && o.rawG > 0 ? o.rawG : undefined;
    const staticCostPerKg = cost !== undefined ? round(cost / (staticPct / 100), 2) : undefined;
    return {
      staticPct, modelPct: ty.hotPct,
      staticCookedG: rawG !== undefined ? Math.round((rawG * staticPct) / 100) : undefined, modelCookedG: ty.cookedG,
      staticCostPerKg, modelCostPerKg: ty.trueCostPerCookedKg,
      costErrorPct: round((ty.hotPct / staticPct - 1) * 100, 2),
      weightErrorPct: round((staticPct / ty.hotPct - 1) * 100, 2),
    };
  }

  /* ======================================================================================================
   * 6. Safety gates (research: evaluateComplianceGate; FDA Food Code 3-501.14/.16, 3-403.11)
   *    Deliberate difference from the report: time below 135 F is measured from the first out-of-range READING (outSince),
   *    not from when the batch left the heat (see docs/findings.md).
   * ==================================================================================================== */
  // How long a batch may stay in the cabinet, in ms: the smaller of its own limit and the default
  // hold-limit setting.
  const holdLimitMs = (b, S) => Math.min(isNum(b.maxHoldH) ? b.maxHoldH : S.defaultMaxHoldH, hardCapH(S)) * H;
  // The hard cap in hours: its own setting, or the old default hold limit for settings made before it existed.
  const hardCapH = (S) => (isNum(S.hardCapH) ? S.hardCapH : S.defaultMaxHoldH);
  // The hard cap, in ms: no batch of any kind stays in the cabinet longer than the default hold-limit setting.
  const hardLimitMs = (S) => hardCapH(S) * H;
  // True for a batch whose own limit is a quality limit with room before the hard cap: past that limit it is
  // held off the menu until someone tastes it, instead of being thrown out. Batches saved before limit kinds
  // existed have no kind and act as safety limits.
  const hasQualityStage = (b, S) => b.holdBasis === 'quality' && (isNum(b.maxHoldH) ? b.maxHoldH : S.defaultMaxHoldH) < hardCapH(S);
  // Formats a temperature as whole degrees for messages.
  const f0 = (x) => Math.round(x) + ' °F';
  // Builds the answer card that gate() returns. The status word comes from the action word; nextDeadlineAt
  // is included only when it is a real time.
  function gateOut(action, canServe, reason, severity, text, nextDeadlineAt) {
    const r = { canServe, action, reason, severity, status: STATUS_OF[action], text };
    if (nextDeadlineAt !== undefined && isFinite(nextDeadlineAt)) r.nextDeadlineAt = nextDeadlineAt;
    return r;
  }
  // Gate for a batch that is cooling down (FDA 3-501.14): from 135 F to 70 F within stage1H, then to 41 F
  // by totalH in all. A cooling batch is never servable. Missing the first deadline allows one reheat and a
  // restart; missing it twice, or the total time, means discard.
  function coolingGate(b, now, S) {
    const c = S.cooling || C.safety.cooling;
    // The cooling clock starts at coolStartAt (a reheat resets it), or at entry when that is missing.
    const st = isNum(b.coolStartAt) ? b.coolStartAt : b.enteredAt;
    const s1 = st + c.stage1H * H, fin = st + c.totalH * H;
    if (b.finalAt != null) return gateOut('NONE', false, 'cooled', 'ok', 'Cooled to ' + f0(c.finalF) + '. Store cold; reheat to ' + f0(S.reheatF) + ' before serving.' + SAFETY);
    if (now > fin) return gateOut('DISCARD_LOCKOUT', false, 'cooling', 'bad', 'Not cooled to ' + f0(c.finalF) + ' within ' + c.totalH + ' hours. Discard.' + SAFETY);
    if (b.stage1At == null) {
      if (now > s1) {
        if (b.reheats >= 1) return gateOut('DISCARD_LOCKOUT', false, 'cooling', 'bad', 'Missed ' + f0(c.stage1ToF) + ' within ' + c.stage1H + ' hours twice. Discard.' + SAFETY);
        return gateOut('REHEAT_IMMEDIATE', false, 'stage1Missed', 'bad', 'Not at ' + f0(c.stage1ToF) + ' within ' + c.stage1H + ' hours. Reheat to ' + f0(S.reheatF) + ' and restart cooling, or discard.' + SAFETY, fin);
      }
      return gateOut('CHILL_NOW', false, 'cooling1', 'info', 'Cooling: get it to ' + f0(c.stage1ToF) + ' or below.' + SAFETY, s1);
    }
    return gateOut('CHILL_NOW', false, 'cooling2', 'info', 'Cooling: get it to ' + f0(c.finalF) + ' or below.' + SAFETY, fin);
  }
  // The names of the cooked products that have no quality stage at the current hard cap: their own hold limit is at or
  // above it, so they are thrown out at the cap. Takes the state.
  function noQualityStage(state) {
    const S = safetyOf(state.settings), out = [];
    for (const ing of state.ingredients) if (ing.tcs && (isNum(ing.maxHoldH) ? ing.maxHoldH : S.defaultMaxHoldH) >= hardCapH(S)) out.push(ing.name);
    return out;
  }
  /** gate(batch, now, safety) -> { canServe, action, reason, severity, status, nextDeadlineAt?, text } */
  // WATCH OUT: for food that is out of range, the clock runs from the first bad reading (outSince), not
  // from when the food left the heat. This differs from the research report on purpose (F-E1).
  function gate(batch, now, safety) {
    const S = isObj(safety) ? safety : C.safety;
    if (!isObj(batch)) return gateOut('DISCARD_LOCKOUT', false, 'missing', 'bad', 'Unknown batch.');
    if (batch.status === 'discard' || batch.discardedAt != null) return gateOut('DISCARD_LOCKOUT', false, batch.discardReason || 'manual', 'bad', 'Discarded.');
    // A missing time falls back to the entry time, so a bad call cannot crash or discard by mistake.
    if (!isNum(now)) now = batch.enteredAt;
    if (batch.kind === 'cooling') return coolingGate(batch, now, S);
    const lim = holdLimitMs(batch, S), qStage = hasQualityStage(batch, S);
    const hard = batch.enteredAt + hardLimitMs(S);
    let exp = batch.enteredAt + lim;
    // A safety limit, or the hard cap, throws the batch out. A quality limit does not: see the end of this function.
    if (now > hard || (now > exp && !qStage)) return gateOut('DISCARD_LOCKOUT', false, 'expired', 'bad', 'Past the ' + U.round((now > hard ? hardLimitMs(S) : lim) / H, 1) + '-hour hold limit. Discard.' + SAFETY);
    const kept = qStage && isNum(batch.keepUntil) && batch.keepUntil > now;
    const pastQ = qStage && now > exp && !kept;
    // Past its quality limit the next change is the hard cap; while kept it is the end of the extension.
    if (qStage && now > exp) exp = kept ? Math.min(batch.keepUntil, hard) : hard;
    // Out of range: hot food gets one reheat inside the grace window, cold food must be chilled; past the
    // grace time it is discarded.
    const hot = batch.kind !== 'cold';
    if (batch.outSince != null) {
      if (hot) {
        if (batch.reheats >= 1) return gateOut('DISCARD_LOCKOUT', false, 'temp', 'bad', 'Below ' + f0(S.hotHoldF) + ' again after its one reheat. Discard.' + SAFETY);
        const lim = batch.outSince + S.belowHotGraceH * H;
        if (now > lim) return gateOut('DISCARD_LOCKOUT', false, 'temp', 'bad', 'Below ' + f0(S.hotHoldF) + ' for more than ' + S.belowHotGraceH + ' hours. Discard.' + SAFETY);
        return gateOut('REHEAT_IMMEDIATE', false, 'belowHot', 'bad', 'Below ' + f0(S.hotHoldF) + '. Reheat to ' + f0(S.reheatF) + ' now (one reheat only) or discard.' + SAFETY, Math.min(lim, exp));
      }
      const lim = batch.outSince + S.aboveColdGraceH * H;
      if (now > lim) return gateOut('DISCARD_LOCKOUT', false, 'temp', 'bad', 'Above ' + f0(S.coldHoldF) + ' for more than ' + S.aboveColdGraceH + ' hours. Discard.' + SAFETY);
      return gateOut('CHILL_NOW', false, 'aboveCold', 'bad', 'Above ' + f0(S.coldHoldF) + '. Chill it now and log a reading at ' + f0(S.coldHoldF) + ' or below.' + SAFETY, Math.min(lim, exp));
    }
    // In range, only the periodic temperature check matters. A late check stays servable: warn first, bad
    // after twice the interval.
    const iv = S.tempCheckEveryMin * MIN;
    // In range but past its quality limit: off the menu, still on the board, waiting for a taste test or a discard.
    if (pastQ) return gateOut('PAST_QUALITY', false, 'pastQuality', 'bad', 'Past its quality limit. Taste it, then keep serving or discard it.', exp);
    if (batch.lastTempAt == null) return gateOut('CHECK_TEMP', true, 'noReading', now - batch.enteredAt > iv ? 'bad' : 'warn', 'No temperature logged yet. Check it now.' + SAFETY, exp);
    const due = batch.lastTempAt + iv;
    if (now > due) return gateOut('CHECK_TEMP', true, 'checkDue', now > batch.lastTempAt + 2 * iv ? 'bad' : 'warn', 'Temperature check is due. Log a reading.' + SAFETY, exp);
    return gateOut('NONE', true, 'ok', 'ok', 'Holding fine.', Math.min(due, exp));
  }
  /** Earliest time the STORED status can change without an action (strict: changes when now > deadline). */
  // WATCH OUT: gives -Infinity when the stored status already disagrees with what the gate would say, so
  // the next tick re-checks at once.
  function statusDeadline(b, S) {
    if (b.status === 'discard') return Infinity;
    if (b.kind === 'cooling') {
      if (b.finalAt != null) return b.status === 'ok' ? Infinity : -Infinity;
      const c = S.cooling || C.safety.cooling; const st = isNum(b.coolStartAt) ? b.coolStartAt : b.enteredAt;
      if (b.stage1At == null && b.status === 'chill') return st + c.stage1H * H;
      return st + c.totalH * H;
    }
    const q = hasQualityStage(b, S);
    const hard = b.enteredAt + hardLimitMs(S);
    const lim = b.enteredAt + holdLimitMs(b, S);
    // The next moment the stored status can change on its own. A quality batch changes at its limit (to past),
    // at the end of a kept extension, and at the hard cap; it must never be left without a deadline (Infinity),
    // or the hard cap would never fire.
    const kept = q && isNum(b.keepUntil) && b.keepUntil > lim;
    const exp = !q ? lim : b.status === 'past' ? hard : kept ? Math.min(b.keepUntil, hard) : lim;
    if (b.outSince != null) {
      const want = b.kind === 'cold' ? 'chill' : 'reheat';
      if (b.status !== want || (b.kind !== 'cold' && b.reheats >= 1)) return -Infinity;
      return Math.min(q ? hard : exp, b.outSince + (b.kind === 'cold' ? S.aboveColdGraceH : S.belowHotGraceH) * H);
    }
    // A past batch stays past (a late temperature check does not change it) until the hard cap.
    if (b.status === 'past') return q ? hard : -Infinity;
    if (b.status === 'check') return exp;
    if (b.status !== 'ok' || b.lastTempAt == null) return -Infinity;
    return Math.min(exp, b.lastTempAt + S.tempCheckEveryMin * MIN);
  }

  /* ======================================================================================================
   * 7. Stock and availability (research: dS = sum w/Y; 86 at threshold)
   * ==================================================================================================== */
  /** I8: only canServe batches that are not discarded and not cooling are servable or drawn from. */
  const servableBatch = (b) => b.canServe === true && b.status !== 'discard' && b.kind !== 'cooling' && b.remainingG > 0; /*@I8*/
  const SUMS = new WeakMap();
  // Adds up grams per ingredient across the cabinet (remembered per batches list): serv = grams that can be
  // served now, locked = grams held back by a safety state, newest = the latest batch of each ingredient.
  // Cooling batches are skipped and discarded ones only count as "newest" (the safety-hold rule needs
  // them).
  function ingSums(batches) {
    let s = SUMS.get(batches);
    if (s) return s;
    const serv = Object.create(null), locked = Object.create(null), pastq = Object.create(null), newest = Object.create(null);
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      if (!b || b.kind === 'cooling') continue;
      const k = b.ing;
      if (!newest[k] || b.enteredAt >= newest[k].enteredAt) newest[k] = b;
      if (b.status === 'discard') continue;
      const r = b.remainingG > 0 ? b.remainingG : 0;
      // Grams past a quality limit are held apart from the food-safety locks: they only wait for a taste test.
      if (servableBatch(b)) serv[k] = (serv[k] || 0) + r; else if (b.status === 'past') pastq[k] = (pastq[k] || 0) + r; else locked[k] = (locked[k] || 0) + r;
    }
    s = { serv, locked, pastq, newest };
    SUMS.set(batches, s);
    return s;
  }
  // Grams that can be served now for one ingredient. TCS food (needs time and temperature control) counts
  // only servable batches; everything else counts plain stock.
  function servableOf(st, ing) {
    if (!ing) return 0;
    if (ing.tcs) return ingSums(st.batches).serv[ing.id] || 0;
    const v = hasOwn(st.stock, ing.id) ? st.stock[ing.id] : 0;
    return isNum(v) && v > 0 ? v : 0;
  }
  // Public version of servableOf: grams (or a count, for 'ea' items) that can be served for an ingredient
  // id. 0 if unknown.
  function servable(state, ingId) {
    if (!state || !Array.isArray(state.ingredients)) return 0;
    return servableOf(state, typeof ingId === 'string' ? ingMap(state.ingredients).get(ingId) : undefined);
  }
  // True when an ingredient is held back for food safety: some of its grams are locked, or its newest batch
  // was discarded for a safety reason (expired, temp or cooling).
  function safetyHeld(sums, ingId) {
    if ((sums.locked[ingId] || 0) > 0) return true;
    const nb = sums.newest[ingId];
    return !!(nb && nb.status === 'discard' && hasOwn(SAFETY_DISCARDS, nb.discardReason));
  }
  /** availability(state, menuId): precedence manual > safety > stock. */
  // WATCH OUT: the stock test is for ONE portion: a dish is out when one portion would leave zero, or stock
  // is at or below the ingredient's threshold. An unknown dish gives ok false with unknown true.
  function availability(state, menuId) {
    const st = state || {};
    const mi = Array.isArray(st.menu) ? getMenu(st.menu, menuId) : undefined;
    if (!mi) return { ok: false, reason: null, ing: null, unknown: true };
    if (hasOwn(st.manual86, menuId)) return { ok: false, reason: 'manual', ing: null };
    const im = ingMap(st.ingredients);
    const bom = Array.isArray(mi.bom) ? mi.bom : [];
    const sums = ingSums(st.batches);
    for (const ln of bom) {
      const ing = im.get(ln.ing);
      if (ing && ing.tcs && (sums.serv[ing.id] || 0) <= 0 && safetyHeld(sums, ing.id)) return { ok: false, reason: 'safety', ing: ing.id };
    }
    // Nothing servable and the food is only waiting for a taste test (no safety lock among it): its own reason.
    for (const ln of bom) {
      const ing = im.get(ln.ing);
      if (ing && ing.tcs && (sums.serv[ing.id] || 0) <= 0 && (sums.pastq[ing.id] || 0) > 0) return { ok: false, reason: 'quality', ing: ing.id };
    }
    for (const ln of bom) {
      const ing = im.get(ln.ing);
      if (!ing) continue;
      const have = servableOf(st, ing);
      if (have - ln.qty <= 0 || have <= (ing.thresholdG || 0)) return { ok: false, reason: 'stock', ing: ing.id };
    }
    return { ok: true, reason: null, ing: null };
  }
  // Availability for every menu item at once, as a table keyed by menu id.
  function computeAvail(state) {
    const out = {};
    for (const mi of state.menu) { const a = availability(state, mi.id); out[mi.id] = { ok: a.ok, reason: a.reason, ing: a.ing }; }
    return out;
  }
  /** Cost of one unit (gram or 'ea') of cooked/served ingredient at the nominal (starter) yield. */
  // Example: pulled pork at 7.70 per kg raw and 55 percent yield costs 0.014 per cooked gram.
  function nominalUnitCost(ing) {
    if (!ing) return 0;
    if (ing.unit === 'ea') return isNum(ing.costEach) ? ing.costEach : 0;
    const perKg = isNum(ing.costPerKg) ? ing.costPerKg : 0;
    if (!ing.tcs) return perKg / 1000;
    const y = ing.thermal ? thermalYield({}).hotPct / 100 : isNum(ing.yield) && ing.yield > 0 ? ing.yield : 1;
    return perKg / y / 1000;
  }

  /* ======================================================================================================
   * 8. Events (recent window + immutable archive chunks)
   * ==================================================================================================== */
  // Time stamp of the newest event: the recent window first, then the last archive chunk. Undefined when
  // there are none.
  function lastEventT(state) {
    const ev = state.events;
    if (ev && ev.length) return ev[ev.length - 1].t;
    const ar = state.eventArchive;
    if (ar && ar.length) { const c = ar[ar.length - 1]; if (c.length) return c[c.length - 1].t; }
    return undefined;
  }
  // Adds new events to the log and keeps it small. When the recent window reaches 2048 events, the oldest
  // 1024 move into a frozen archive chunk (F-E2). The whole log is capped at the maxEvents limit by
  // dropping the oldest. owned says the window array is already our private copy. Returns the new window
  // and archive.
  function appendEvents(events, archive, add, owned) {
    let ev = owned ? events : events.slice();
    for (let i = 0; i < add.length; i++) ev.push(add[i]);
    let ar = archive;
    if (ev.length >= 2 * EVENT_CHUNK) {
      ar = ar.slice();
      while (ev.length >= 2 * EVENT_CHUNK) { ar.push(ev.slice(0, EVENT_CHUNK)); ev = ev.slice(EVENT_CHUNK); }
    }
    const max = C.limits.maxEvents;
    let total = ev.length; for (const c of ar) total += c.length;
    if (total > max) {
      ar = ar === archive ? ar.slice() : ar;
      while (total > max && ar.length) { total -= ar[0].length; ar.shift(); }
      if (total > max) ev = ev.slice(total - max);
    }
    return { events: ev, archive: ar };
  }
  const FLAT = new WeakMap();
  // Every event, oldest first: archive chunks, then the recent window. The joined list is remembered, so
  // repeat calls are cheap. Read history through this, never from state.events alone.
  function allEvents(state) {
    if (!state || !Array.isArray(state.events)) return [];
    const ar = Array.isArray(state.eventArchive) ? state.eventArchive : [];
    if (!ar.length) return state.events;
    const hit = FLAT.get(state.events);
    if (hit && hit.ar === ar) return hit.flat;
    let flat = [];
    for (const c of ar) flat = flat.concat(c);
    flat = flat.concat(state.events);
    FLAT.set(state.events, { ar, flat });
    return flat;
  }

  /* ======================================================================================================
   * 9. Transaction: copy-on-write view of a state
   * ==================================================================================================== */
  // A transaction: a scratch copy of the board for one action. Handlers edit through it, and nothing in the
  // real state changes until commit() builds the new state, so a refused action leaves the old state
  // untouched. "own" remembers which pieces we copied and may edit freely (copy-on-write).
  function Tx(state, now) {
    this.s0 = state; this.now = now;
    // ch = pieces replaced so far; evs = new events; touched and appended = ticket positions changed or
    // added, used to keep the active-ticket index up to date at commit.
    this.ch = {}; this.own = new Set();
    this.evs = []; this.lastT = lastEventT(state);
    this.touched = new Set(); this.appended = []; this.pruned = false;
    this.info = {}; this.undoEntry = null; this.restoreAvail = null; this.batchTouched = false;
  }
  // Current version of a piece of the board: our edited copy if there is one, otherwise the original.
  Tx.prototype.get = function (k) { return hasOwn(this.ch, k) ? this.ch[k] : this.s0[k]; };
  // Makes a shallow copy of a list or record and marks it as ours to edit.
  Tx.prototype.copy = function (v) {
    const c = Array.isArray(v) ? v.slice() : Object.assign({}, v);
    this.own.add(c);
    return c;
  };
  // Editable version of a top-level piece (tickets, batches, stock...); copies it the first time.
  Tx.prototype.mut = function (k) {
    let v = this.get(k);
    if (!this.own.has(v)) { v = this.copy(v); this.ch[k] = v; }
    return v;
  };
  // Same for a piece inside another (an item inside a ticket). Creates an empty record when it is missing.
  Tx.prototype.mutIn = function (obj, k) {
    let v = obj[k];
    if (v === undefined || !this.own.has(v)) { v = this.copy(v === undefined ? {} : v); obj[k] = v; }
    return v;
  };
  // Replaces a whole piece. Replacing the tickets list forces the active-ticket index to be rebuilt.
  Tx.prototype.set = function (k, v) { this.ch[k] = v; if (k === 'tickets') this.pruned = true; /* wholesale replace: do not carry the active-index cache */ };
  // Editable ticket at position ti; also remembers it was touched.
  Tx.prototype.ticket = function (ti) { const arr = this.mut('tickets'); this.touched.add(ti); return this.mutIn(arr, ti); };
  // Editable item ii of ticket ti (copies the ticket and its items list on first use).
  Tx.prototype.item = function (ti, ii) { const t = this.ticket(ti); return this.mutIn(this.mutIn(t, 'items'), ii); };
  // Editable batch at position bi (also remembers that batches changed).
  Tx.prototype.batch = function (bi) { this.batchTouched = true; return this.mutIn(this.mut('batches'), bi); };
  // Next number of a counter (ticket, batch, event...). Ids built from it are never reused.
  Tx.prototype.next = function (k) { const s = this.mut('seq'); s[k] = (isNum(s[k]) ? s[k] : 0) + 1; return s[k]; };
  // Records an event. Its time is never earlier than the previous event, so the log stays in order (I9).
  Tx.prototype.event = function (type, fields) {
    const t = (this.lastT = stampAfter(this.lastT, this.now));
    const e = Object.assign({ id: 'ev_' + this.next('event'), t, type }, fields);
    this.evs.push(e);
    return e;
  };
  // Editable books entry for one ingredient (see ledgerCheck).
  Tx.prototype.ledger = function (ing) { return this.mutIn(this.mut('ledger'), ing); };
  // True when the transaction changed anything or logged an event.
  Tx.prototype.dirty = function () { for (const k in this.ch) return true; return this.evs.length > 0; };
  Tx.prototype.state = function () {
    // a read-only view of the current draft for pure functions (availability, gate ...)
    const s = Object.assign({}, this.s0);
    for (const k in this.ch) s[k] = this.ch[k];
    return s;
  };
  // Builds the new state: the old one plus our changes and new events. Also carries the active-ticket index
  // forward so it is not rebuilt (skipped when the tickets list was replaced wholesale).
  Tx.prototype.commit = function () {
    const s = Object.assign({}, this.s0);
    for (const k in this.ch) s[k] = this.ch[k];
    if (this.evs.length) {
      const ev = this.get('events');
      const r = appendEvents(ev, this.get('eventArchive') || [], this.evs, this.own.has(ev));
      s.events = r.events; s.eventArchive = r.archive;
    }
    if (s.tickets !== this.s0.tickets && !this.pruned) {
      const old = ACTIVE.get(this.s0.tickets);
      if (old) {
        let list = old;
        // Fix the index for one changed ticket: add or remove its position when its active status changed.
        const fix = (idx) => {
          const on = s.tickets[idx].status === 'active', was = sortedHas(list, idx);
          if (on === was) return;
          list = on ? list.concat([idx]).sort((a, b) => a - b) : list.filter((x) => x !== idx);
        };
        this.touched.forEach(fix);
        for (const idx of this.appended) if (!this.touched.has(idx)) fix(idx);
        ACTIVE.set(s.tickets, list);
      }
    }
    return s;
  };

  /* ---------- availability refresh + simulated channel sync ---------- */
  // Starts a simulated "tell every sales channel" job after a dish goes 86 or comes back: one due time per
  // channel, 2 to 40 seconds from now. Finished jobs are dropped once the list passes 120, down to about
  // 100.
  function createSync(tx, menuId, kind, holdMs) {
    const id = 'sy_' + tx.next('sync');
    const targets = {};
    // A held sync starts after the hold: its channels are told holdMs later, and latency counts from then.
    const startAt = tx.now + (holdMs > 0 ? holdMs : 0);
    for (const t of C.syncTargets) targets[t.id] = { dueAt: startAt + syncDelayMs(id, t.id) };
    const syncs = tx.mut('syncs');
    const rec = { id, menuId, kind, t: tx.now, targets };
    if (holdMs > 0) rec.holdUntil = startAt;
    syncs.push(rec);
    if (syncs.length > 120) {
      // drop completed syncs from the front until <= 100 remain
      const keep = [];
      let drop = syncs.length - 100;
      for (const sy of syncs) {
        if (drop > 0 && syncComplete(sy)) { drop--; continue; }
        keep.push(sy);
      }
      tx.ch.syncs = keep; tx.own.add(keep);
    }
  }
  // The simulated channel updates still waiting out their hold for one dish (a quality hold that may yet be kept).
  const heldSyncIdx = (syncs, menuId, now) => { const out = []; for (let i = 0; i < syncs.length; i++) { const sy = syncs[i]; if (sy.menuId === menuId && sy.kind === '86' && isNum(sy.holdUntil) && sy.holdUntil > now) out.push(i); } return out; };
  // Drops the held updates for a dish: it came back before they started, so no channel ever heard it was off.
  function dropHeldSyncs(tx, menuId) {
    const cur = tx.get('syncs');
    const idx = heldSyncIdx(cur, menuId, tx.now);
    if (!idx.length) return false;
    const keep = cur.filter((_, i) => idx.indexOf(i) < 0);
    tx.ch.syncs = keep; tx.own.add(keep);
    return true;
  }
  // Starts the held updates for a dish now: the hold is over because something worse than a quality hold applies.
  function releaseHeldSyncs(tx, menuId) {
    const cur = tx.get('syncs');
    const idx = heldSyncIdx(cur, menuId, tx.now);
    if (!idx.length) return;
    const next = cur.slice();
    for (const i of idx) {
      const sy = cur[i], targets = {};
      for (const t of C.syncTargets) targets[t.id] = { dueAt: tx.now + syncDelayMs(sy.id, t.id) };
      const rec = Object.assign({}, sy, { holdUntil: tx.now, targets });
      next[i] = rec;
    }
    tx.ch.syncs = next; tx.own.add(next);
  }
  // True when every channel has confirmed this update.
  function syncComplete(sy) {
    for (const k in sy.targets) if (hasOwn(sy.targets, k) && sy.targets[k].doneAt == null) return false;
    return true;
  }
  // True when this transaction touched anything availability depends on, so availability must be
  // recomputed.
  function availInputsChanged(tx) {
    return hasOwn(tx.ch, 'batches') || hasOwn(tx.ch, 'stock') || hasOwn(tx.ch, 'manual86') || hasOwn(tx.ch, 'menu') || hasOwn(tx.ch, 'ingredients') || hasOwn(tx.ch, 'avail');
  }
  // The quality sync hold in ms, from the service settings (0 to 30 minutes).
  const qualityHoldMs = (settings) => { const sv = settings && settings.service ? settings.service : C.service; const m = isNum(sv.qualitySyncHoldMin) ? sv.qualitySyncHoldMin : C.service.qualitySyncHoldMin; return Math.max(0, Math.min(30, m)) * MIN; };
  // Recomputes availability for every dish and stores it when it changed. Each change logs avail_changed,
  // and a dish that flips between available and not starts a channel sync. After an undo the old "since"
  // time is put back when the situation matches. Returns the old table and the ids that changed.
  function refreshAvail(tx) {
    const st = tx.state();
    const prev = st.avail || {};
    const restore = tx.restoreAvail;
    const next = {};
    const changedIds = [];
    let changed = false;
    for (const mi of st.menu) {
      const a = availability(st, mi.id);
      const p = hasOwn(prev, mi.id) ? prev[mi.id] : null;
      if (p && p.ok === a.ok && p.reason === a.reason && p.ing === a.ing) { next[mi.id] = p; continue; }
      changed = true;
      const r = restore && hasOwn(restore, mi.id) ? restore[mi.id] : null;
      next[mi.id] = r && r.ok === a.ok && r.reason === a.reason && r.ing === a.ing ? r : { ok: a.ok, reason: a.reason, ing: a.ing, since: tx.now };
      if (p) {
        changedIds.push(mi.id);
        tx.event('avail_changed', { menuId: mi.id, ok: a.ok, reason: a.reason, ing: a.ing });
        if (p.ok !== a.ok) {
          // Back on before a held quality update started: the channels never heard it was off, so nothing to undo.
          if (a.ok && dropHeldSyncs(tx, mi.id)) continue;
          // Off for a quality hold: wait out the hold (it may be kept); anything else syncs at once.
          const hold = !a.ok && a.reason === 'quality' ? qualityHoldMs(tx.get('settings')) : 0;
          createSync(tx, mi.id, a.ok ? 'back' : '86', hold);
        } else if (!a.ok && p.reason === 'quality' && a.reason !== 'quality') releaseHeldSyncs(tx, mi.id);
      }
    }
    if (!changed) for (const k in prev) if (hasOwn(prev, k) && !hasOwn(next, k)) { changed = true; break; }
    if (changed) { tx.ch.avail = next; tx.own.add(next); }
    return { prev, changedIds };
  }
  /** Re-evaluate one batch's gate; on DISCARD_LOCKOUT discard it automatically. */
  function refreshBatch(tx, bi) {
    const b = tx.get('batches')[bi];
    if (b.status === 'discard') return;
    if (!(b.remainingG > 0) && b.kind !== 'cooling') return; // an empty pan is frozen: nothing to serve, nothing to discard (F-E4)
    const S = safetyOf(tx.get('settings'));
    const gt = gate(b, tx.now, S);
    if (gt.status === b.status && gt.canServe === b.canServe && gt.action === b.action) return;
    if (gt.action === 'DISCARD_LOCKOUT') { discardInto(tx, bi, gt.reason); return; }
    const w = tx.batch(bi);
    w.status = gt.status; w.action = gt.action; w.canServe = gt.canServe;
    tx.event('batch_status', { batchId: b.id, from: b.status, to: gt.status, action: gt.action });
  }
  // Throws a batch out: its grams become waste, it can never be served again, and the lost cost is logged.
  function discardInto(tx, bi, reason) {
    const b = tx.get('batches')[bi];
    const w = tx.batch(bi);
    const g0 = b.remainingG > 0 ? b.remainingG : 0;
    w.wasteG = g0; w.remainingG = 0; w.discardedAt = stampAfter(b.enteredAt, tx.now); w.discardReason = reason;
    w.status = 'discard'; w.action = 'DISCARD_LOCKOUT'; w.canServe = false;
    const ing = ingMap(tx.get('ingredients')).get(b.ing);
    const unit = isNum(b.costPerCookedKg) ? b.costPerCookedKg / 1000 : nominalUnitCost(ing);
    tx.event('batch_status', { batchId: b.id, from: b.status, to: 'discard', action: 'DISCARD_LOCKOUT' });
    tx.event('batch_discard', { batchId: b.id, ing: b.ing, g: g0, reason, cost: round(g0 * unit, 4) });
  }
  // Re-runs the gate on every batch that is not already discarded (used when the safety settings change).
  function refreshAllBatches(tx) {
    const bs = tx.get('batches');
    for (let i = 0; i < bs.length; i++) if (bs[i].status !== 'discard') refreshBatch(tx, i);
  }

  // Takes up to `need` grams of a TCS ingredient from the oldest ready batch first (FIFO), and from batches still
  // resting only when nothing ready is left. Locked and cooling batches are never used (I8). Returns the records of what was taken, its cost, and what is still
  // missing.
  function takeFifoInto(tx, ing, need) {
    const recs = [];
    let cost = 0;
    const bs = tx.get('batches');
    const cand = [];
    for (let i = 0; i < bs.length; i++) { const b = bs[i]; if (b.ing === ing.id && servableBatch(b)) cand.push(i); }
    // Oldest batch first; equal times go to the earlier position in the list.
    // Batches still resting come after every ready batch, whatever their age; each group is oldest first.
    const resting = (b) => (isNum(b.restUntil) && b.restUntil > tx.now ? 1 : 0);
    cand.sort((a, b2) => (resting(bs[a]) - resting(bs[b2])) || (bs[a].enteredAt - bs[b2].enteredAt) || (a - b2));
    for (const bi of cand) {
      if (need <= EPS) break;
      const b = tx.get('batches')[bi];
      const take = Math.min(need, b.remainingG);
      if (!(take > 0)) continue;
      const w = tx.batch(bi);
      w.remainingG = b.remainingG - take <= EPS ? 0 : b.remainingG - take;
      need = need - take <= EPS ? 0 : need - take;
      recs.push({ ing: ing.id, g: take, batchId: b.id });
      cost += take * (isNum(b.costPerCookedKg) ? b.costPerCookedKg / 1000 : nominalUnitCost(ing));
    }
    return { recs, cost, left: need };
  }

  /* ======================================================================================================
   * 10. Depletion (FIFO from servable batches, never negative) and learning
   * ==================================================================================================== */
  // Takes the ingredients for one finished item out of stock (recipe quantity times item quantity). Returns
  // what was taken (needed for undo), the ingredient cost and any shortage in grams.
  // WATCH OUT: stock never goes negative (I1). If there is not enough, we take what exists, record the rest
  // as "short" and log stock_short, because the kitchen made the food anyway.
  function depleteInto(tx, item, mi, ticketId) {
    const im = ingMap(tx.get('ingredients'));
    const recs = [];
    let cost = 0, shortG = 0;
    const bom = Array.isArray(mi.bom) ? mi.bom : [];
    for (const ln of bom) {
      const ing = im.get(ln.ing);
      if (!ing) continue;
      let need = ln.qty * item.qty;
      if (!(need > 0)) continue;
      // TCS food comes from the oldest servable batches first (FIFO). Locked and cooling batches are never
      // used (I8).
      if (ing.tcs) {
        const took = takeFifoInto(tx, ing, need);
        for (const r of took.recs) recs.push(r);
        cost += took.cost;
        need = took.left;
      } else {
        // Everything else comes from the plain stock count.
        const stock = tx.get('stock');
        const have = hasOwn(stock, ing.id) && stock[ing.id] > 0 ? stock[ing.id] : 0;
        const take = Math.min(need, have);
        if (take > 0) {
          const ws = tx.mut('stock');
          ws[ing.id] = have - take <= EPS ? 0 : have - take;
          need = need - take <= EPS ? 0 : need - take;
          recs.push({ ing: ing.id, g: take });
          cost += take * nominalUnitCost(ing);
        }
      }
      // What could not be taken is a shortage: logged, and still priced at the standard cost.
      if (need > EPS) {
        recs.push({ ing: ing.id, g: 0, short: need });
        shortG += need;
        cost += need * nominalUnitCost(ing);
        tx.event('stock_short', { ing: ing.id, g: need, ticketId, itemId: item.id });
      }
    }
    return { recs, cost: round(cost, 4), shortG };
  }
  /** Undo of a done: put back exactly what `depleted` says, to the same batches. Missing/discarded batch -> grams dropped (ledger.dropped). */
  function restoreInto(tx, recs) {
    let partial = false;
    for (const r of recs || []) {
      if (!(r.g > 0)) continue;
      if (r.batchId) {
        const bi = findBatchIdx(tx.get('batches'), r.batchId);
        const b = bi >= 0 ? tx.get('batches')[bi] : null;
        if (!b || b.status === 'discard') {
          const L = tx.ledger(r.ing); L.dropped = (L.dropped || 0) + r.g; /*@I2*/
          partial = true;
          continue;
        }
        const w = tx.batch(bi); w.remainingG = b.remainingG + r.g;
        refreshBatch(tx, bi); // a pan that was frozen while empty may have expired meanwhile: its gate runs again now
      } else {
        const ws = tx.mut('stock');
        ws[r.ing] = (hasOwn(ws, r.ing) && isNum(ws[r.ing]) ? ws[r.ing] : 0) + r.g;
      }
    }
    return partial;
  }
  // Learns how long a dish really takes: time from start (or fire) to done, divided by the quantity
  // multiplier and capped at outlierFactor times the starter estimate, then blended into a running average
  // (80 percent old, 20 percent new).
  // WATCH OUT: skipped when the item was fired early by hand, or a two-step item was finished without a
  // start tap, because those times are not honest. "before" collects the old values for undo.
  function learnInto(tx, item, mi, before) {
    if (item.override) return;
    if (item.track === 'two' && item.startedAt == null) return;
    const t0 = item.startedAt != null ? item.startedAt : item.firedAt;
    if (!isNum(t0) || !isNum(item.doneAt)) return;
    const P = tx.get('settings').pacing;
    const starter = mi.prepSec;
    let sample = (item.doneAt - t0) / 1000 / qtyScale(item.qty, P);
    if (!(sample >= 0) || !(starter > 0)) return;
    sample = Math.min(sample, P.outlierFactor * starter);
    const learned = tx.get('learned');
    const prev = hasOwn(learned, mi.id) ? learned[mi.id] : null;
    if (!before.has(mi.id)) before.set(mi.id, prev);
    const n = (prev && isInt(prev.n) ? prev.n : 0) + 1;
    const ema = n === 1 || !prev ? sample : 0.8 * prev.ema + 0.2 * sample;
    const w = tx.mut('learned');
    w[mi.id] = { n, ema, est: learnEst(n, ema, starter, P) };
  }
  // The estimate used for planning: the learned average pulled toward the starter estimate (less pull as
  // samples n grow, learnK sets the weight), then kept between minFactor and maxFactor times the starter
  // (I14).
  // Example: one sample of 180 s, starter 120 s, learnK 3: (180 + 3 x 120) / 4 = 135 s.
  const learnEst = (n, ema, starter, P) => clamp((n * ema + P.learnK * starter) / (n + P.learnK), P.minFactor * starter, P.maxFactor * starter);

  /* ======================================================================================================
   * 11. Action handlers. Each returns a report id; on anything but 'ok' the transaction is thrown away.
   * ==================================================================================================== */
  // A holds the action handlers, one per action type. A handler receives tx (the transaction) and p (the
  // facts sent with the action), edits the transaction, and returns 'ok' or a report id.
  const A = Object.create(null);
  // UNDO holds the undo handlers, one per kind of undo record.
  const UNDO = Object.create(null);

  // Finds the ticket and item named in the payload. Returns a report id (text) if either is missing,
  // otherwise their positions and records.
  function locate(tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    const t = tickets[ti];
    const ii = findItemIdx(t, p.itemId);
    if (ii < 0) return 'unknownItem';
    return { ti, ii, t, it: t.items[ii] };
  }
  // The status and time stamps of an item, saved so undo can check that nothing changed since.
  const timesOf = (it) => ({ status: it.status, firedAt: it.firedAt, startedAt: it.startedAt, doneAt: it.doneAt });
  // True when the item still has exactly the status and time stamps that were saved.
  const sameTimes = (it, k) => it.status === k.status && it.firedAt === k.firedAt && it.startedAt === k.startedAt && it.doneAt === k.doneAt;
  // Short label for an item, used in undo messages.
  const shortName = (it) => it.short || it.name || it.menuId;
  // Remembers how to undo the action just done. finalize() adds the id, the times and the event list later.
  function pushUndo(tx, kind, label, data) { tx.undoEntry = { kind, label, data }; }

  /** Finish one item inside the tx: done stamp, depletion, learning, event. Returns the record needed for undo. */
  function completeInto(tx, ti, ii, learnedBefore, opts) {
    const t = tx.get('tickets')[ti];
    const it = t.items[ii];
    const before = it;
    const w = tx.item(ti, ii);
    if (it.status === 'queued') {
      // only completeZone completes on-deck items: they skipped pacing, so they count as fired early by hand
      w.status = 'displayed'; w.firedAt = stampAfter(t.createdAt, tx.now); w.override = true;
      tx.event('item_fired', { ticketId: t.id, itemId: it.id, zone: it.zone, menuId: it.menuId, override: true, at: w.firedAt });
    }
    w.status = 'done';
    w.doneAt = stampAfter(w.startedAt != null ? w.startedAt : w.firedAt, tx.now);
    const mi = getMenu(tx.get('menu'), it.menuId);
    let shortG = 0;
    if (mi) {
      const d = depleteInto(tx, w, mi, t.id);
      w.depleted = d.recs; w.cost = d.cost; shortG = d.shortG;
      if (!(opts && opts.noLearn)) learnInto(tx, w, mi, learnedBefore);
    } else { w.depleted = []; w.cost = 0; }
    const ev = { ticketId: t.id, itemId: it.id, zone: it.zone, menuId: it.menuId, workMs: w.doneAt - (w.startedAt != null ? w.startedAt : w.firedAt), qty: it.qty, cost: w.cost };
    if (shortG > 0) ev.shortG = shortG;
    tx.event('item_done', ev);
    return { itemId: it.id, before, after: timesOf(w) };
  }
  // Pairs each learned prep time with its value before and after, so undo can put the old one back.
  function learnedUndoData(tx, before) {
    const out = [];
    const L = tx.get('learned');
    before.forEach((b, menuId) => out.push({ menuId, before: b, after: hasOwn(L, menuId) ? L[menuId] : null }));
    return out;
  }

  // New order. Checks the order's own fields, then each line (dish exists and is not archived, quantity 1
  // to 20, modifiers, and the dish is not 86: I7). One bad line refuses the whole order and info.line says
  // which. Then it plans the pacing, numbers the ticket (101 first each service day) and fires the lines
  // that are due now.
  // WATCH OUT: text sizes are checked on the raw text first, so a giant paste is refused cheaply.
  A.createTicket = function (tx, p) {
    const L = C.limits;
    const lines = p.items;
    if (lines == null || (Array.isArray(lines) && lines.length === 0)) return 'emptyOrder';
    if (!Array.isArray(lines)) { tx.info.key = 'items'; return 'badPatch'; }
    if (lines.length > L.maxItemsPerTicket) { tx.info.max = L.maxItemsPerTicket; return 'tooManyItems'; }
    // An order id adds this ticket to that open order as its next round; the name and channel then come from the
    // order. With no order id, a new order is opened for this ticket.
    let oi = -1;
    if (p.orderId !== undefined && p.orderId !== null) {
      oi = findOrderIdx(tx.get('orders'), p.orderId);
      if (oi < 0) return 'unknownOrder';
      if (tx.get('orders')[oi].status !== 'open') return 'orderNotOpen';
    }
    const order0 = oi >= 0 ? tx.get('orders')[oi] : null;
    let pay = null;
    if (p.pay !== undefined && p.pay !== null) { pay = readPayment(tx, p.pay); if (typeof pay === 'string') return pay; }
    // Defaults: customer Walk-up, channel dine_in, no note, not rush, source live.
    let customer = order0 ? order0.customer : p.customer == null ? '' : p.customer;
    if (typeof customer !== 'string' || customer.length > 400) return 'badCustomer';
    customer = cleanText(customer);
    if (customer.length > L.maxCustomerLen) return 'badCustomer';
    if (!customer) customer = 'Walk-up';
    const channel = order0 ? order0.channel : p.channel == null ? 'dine_in' : p.channel;
    if (typeof channel !== 'string' || !hasOwn(C.channelById, channel)) return 'badChannel';
    let note = p.note == null ? '' : p.note;
    if (typeof note !== 'string') { tx.info.key = 'note'; return 'badPatch'; }
    if (note.length > 4 * L.maxNoteLen) return 'noteTooLong';
    note = note.trim();
    if (note.length > L.maxNoteLen) return 'noteTooLong';
    const rush = p.rush == null ? false : p.rush;
    if (typeof rush !== 'boolean') { tx.info.key = 'rush'; return 'badPatch'; }
    const src = p.src == null ? 'live' : p.src;
    if (typeof src !== 'string' || !hasOwn(SRC_TICKET, src)) { tx.info.key = 'src'; return 'badPatch'; }
    // createdAt is for the simulator and imports only: never in the future, and not older than 48 hours
    // unless allowPast is set.
    const now = tx.now;
    let createdAt = now;
    if (p.createdAt !== undefined) {
      if (!isNum(p.createdAt)) { tx.info.key = 'createdAt'; return 'badPatch'; }
      if (p.createdAt > now || (p.createdAt < now - PAST_LIMIT_MS && p.allowPast !== true)) { tx.info.key = 'createdAt'; return 'outOfBounds'; }
      createdAt = p.createdAt;
    }
    // Check every line against the menu and the current availability.
    const menu = tx.get('menu');
    const mm = menuMap(menu);
    const avail = tx.get('avail') || {};
    const parsed = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      tx.info.line = i;
      if (!isObj(ln)) { tx.info.key = 'items'; return 'badPatch'; }
      const mi = typeof ln.menuId === 'string' ? mm.get(ln.menuId) : undefined;
      if (!mi || mi.archived) { tx.info.menuId = typeof ln.menuId === 'string' ? ln.menuId.slice(0, 64) : null; return 'unknownMenu'; }
      const qty = ln.qty === undefined ? 1 : ln.qty;
      if (!isInt(qty) || qty < 1 || qty > L.maxQty) return 'badQty';
      // At most 10 modifiers per line, each up to 60 characters once cleaned.
      let mods = [];
      if (ln.mods != null) {
        if (!Array.isArray(ln.mods) || ln.mods.length > 10) { tx.info.key = 'mods'; return 'badPatch'; }
        for (const m of ln.mods) {
          if (typeof m !== 'string' || m.length > 240) { tx.info.key = 'mods'; return 'badPatch'; }
          const c = cleanText(m);
          if (!c || c.length > 60) { tx.info.key = 'mods'; return 'badPatch'; }
          mods.push(c);
        }
      }
      /*@I7*/ const a = hasOwn(avail, mi.id) ? avail[mi.id] : availability(tx.state(), mi.id);
      if (!a || a.ok !== true) { tx.info.menuId = mi.id; tx.info.reason = a ? a.reason : null; tx.info.ing = a ? a.ing : null; return 'itemUnavailable'; }
      parsed.push({ mi, qty, mods });
    }
    delete tx.info.line;
    // Pacing: the slowest line fires now and the others wait (see pacingPlan). Rush or pacing off means all
    // offsets are 0.
    const S = tx.get('settings');
    const P = S.pacing;
    const learned = tx.get('learned');
    const paced = !!P.enabled && !rush;
    const preps = parsed.map((x) => linePrep(estimate(menu, learned, x.mi.id), x.qty, P));
    let dmax = 0;
    if (paced) for (const v of preps) if (v > dmax) dmax = v;
    // The id counts up forever; the display number restarts at 101 each service day (a day starts at
    // dayStartHour, not midnight).
    const n = tx.next('ticket');
    const id = 't_' + n;
    const sd = U.serviceDate(createdAt, S.service.dayStartHour);
    const byDate = tx.mutIn(tx.mut('seq'), 'byDate');
    const num = (hasOwn(byDate, sd) && isNum(byDate[sd]) ? byDate[sd] : 100) + 1;
    byDate[sd] = num;
    // Name, station, price and plan are copied from the menu now, so later menu edits do not change this
    // ticket.
    const items = parsed.map((x, i) => {
      const prepSec = preps[i];
      const offsetSec = paced ? dmax - prepSec : 0; /*@I5a*/
      const it = { id: id + '.' + (i + 1), menuId: x.mi.id, name: x.mi.name, short: x.mi.short || x.mi.name, zone: x.mi.zone, qty: x.qty, mods: x.mods,
        track: x.mi.track === 'two' ? 'two' : 'one', price: isNum(x.mi.price) ? x.mi.price : 0, prepSec, offsetSec, fireAt: createdAt + offsetSec * 1000, status: 'queued' };
      tx.own.add(it);
      return it;
    });
    tx.own.add(items);
    // Open the order this ticket belongs to (or count one more round on the existing order).
    const orders = tx.mut('orders');
    let order;
    if (oi >= 0) { order = tx.mutIn(orders, oi); }
    else {
      order = { id: 'o_' + tx.next('order'), serviceDate: sd, customer, channel, createdAt, status: 'open', src, rounds: 0 };
      tx.own.add(order);
      orders.push(order);
      oi = orders.length - 1;
      tx.event('order_opened', { orderId: order.id, channel, src });
    }
    order.rounds = (isInt(order.rounds) ? order.rounds : 0) + 1;
    const ticket = { id, num, serviceDate: sd, customer, channel, createdAt, rush, note, src, pacing: !!P.enabled, dmaxSec: dmax, status: 'active', recalls: 0, orderId: order.id, round: order.rounds, items };
    // Two-tap kitchens: the ticket waits for the cook's Start tap, and the plan clock begins then (see startTicket).
    if (p.awaitStart === true) ticket.awaitStart = true;
    tx.own.add(ticket);
    const tickets = tx.mut('tickets');
    tickets.push(ticket);
    tx.appended.push(tickets.length - 1);
    // Log the order, then fire every line whose planned time is already here.
    let qtyTotal = 0, value = 0;
    for (const it of items) { qtyTotal += it.qty; value += it.qty * it.price; }
    tx.event('ticket_created', { ticketId: id, num, channel, items: items.length, qty: qtyTotal, rush, src, value: round(value, 2), orderId: order.id, round: order.rounds });
    for (const it of items) {
      if (it.fireAt <= now && !ticket.awaitStart) {
        it.status = 'displayed'; it.firedAt = it.fireAt;
        tx.event('item_fired', { ticketId: id, itemId: it.id, zone: it.zone, menuId: it.menuId, at: it.firedAt });
      }
    }
    // Keep the ticket list under its size cap by dropping the oldest finished tickets.
    pruneTicketsInto(tx, C.limits.maxTickets);
    pruneOrdersInto(tx, C.limits.maxOrders);
    const zones = [];
    for (const it of items) if (zones.indexOf(it.zone) < 0) zones.push(it.zone);
    tx.info = { ticketId: id, num, zones, lines: items.length, dmaxSec: dmax, orderId: order.id, round: order.rounds };
    // Paid at the counter: take payment on the same tap that sends the food.
    if (pay) { const r = payInto(tx, oi, pay); if (r !== 'ok') return r; tx.info.paid = true; tx.info.total = tx.get('orders')[oi].totals.total; }
    return 'ok';
  };

  /* ======================================================================================================
   * Orders (the check): one per table, tab or customer. Food is sent in rounds, and each round is one ticket
   * on the kitchen screen. The order keeps the money; the tickets keep the timing.
   * ==================================================================================================== */
  // Dollars rounded to whole cents.
  const cents = (v) => Math.round(v * 100) / 100;
  // Builds the money lines of an order from its food total (in whole cents), a discount and a tax rate.
  function totalsFrom(subCents, qty, rounds, discount, taxRatePct) {
    const subtotal = subCents / 100;
    const disc = Math.min(cents(Math.max(0, isNum(discount) ? discount : 0)), subtotal);
    const taxable = cents(subtotal - disc);
    const rate = isNum(taxRatePct) && taxRatePct > 0 ? taxRatePct : 0;
    const tax = cents(taxable * rate / 100);
    return { subtotal, discount: disc, taxRate: rate, tax, total: cents(taxable + tax), qty, rounds };
  }
  // The sales tax rate in force now, in percent (0 when none is set).
  const taxRateOf = (settings) => (settings && settings.service && isNum(settings.service.taxRatePct) ? settings.service.taxRatePct : 0);
  // What an order adds up to: the food on its tickets that are not voided, less the discount, plus tax. A paid
  // order gives back the numbers frozen when it was paid. opts.discount previews a discount before payment.
  function orderTotals(state, order, opts) {
    if (!order || !isState(state)) return null;
    if (order.status === 'paid' && isObj(order.totals) && !opts) return Object.assign({}, order.totals);
    let sub = 0, qty = 0, rounds = 0;
    for (const t of state.tickets) {
      if (t.orderId !== order.id || t.status === 'voided') continue;
      rounds++;
      for (const it of t.items) { sub += Math.round((isNum(it.price) ? it.price : 0) * 100) * it.qty; qty += it.qty; }
    }
    return totalsFrom(sub, qty, rounds, opts && opts.discount, taxRateOf(state.settings));
  }
  // Totals for every open order in one pass over the tickets: a Map from order id to totals.
  function openOrderTotals(state) {
    const out = new Map();
    if (!isState(state) || !Array.isArray(state.orders)) return out;
    const acc = new Map();
    for (const o of state.orders) if (o.status === 'open') acc.set(o.id, { sub: 0, qty: 0, rounds: 0 });
    if (acc.size) {
      for (const t of state.tickets) {
        const a = t.orderId !== undefined && t.status !== 'voided' ? acc.get(t.orderId) : undefined;
        if (!a) continue;
        a.rounds++;
        for (const it of t.items) { a.sub += Math.round((isNum(it.price) ? it.price : 0) * 100) * it.qty; a.qty += it.qty; }
      }
    }
    const rate = taxRateOf(state.settings);
    for (const [id, a] of acc) out.set(id, totalsFrom(a.sub, a.qty, a.rounds, 0, rate));
    return out;
  }
  // Reads how an order was paid: the method (needed), and a tip and discount in dollars (default 0). Gives back
  // { method, tip, discount } or a report id, with tx.info.key naming the bad field.
  function readPayment(tx, p) {
    if (!isObj(p) || typeof p.method !== 'string' || !hasOwn(C.payMethodById, p.method)) { tx.info.key = 'method'; return 'badPayment'; }
    const out = { method: p.method, tip: 0, discount: 0 };
    for (const k of ['tip', 'discount']) {
      if (p[k] === undefined || p[k] === null) continue;
      if (!isNum(p[k]) || p[k] < 0) { tx.info.key = k; return 'badPayment'; }
      if (p[k] > C.limits.maxMoney) { tx.info = { key: k, min: 0, max: C.limits.maxMoney }; return 'outOfBounds'; }
      out[k] = cents(p[k]);
    }
    return out;
  }
  // Takes payment on the open order at position oi: freezes its totals, records how it was paid and logs it.
  // Gives back 'ok' or a report id. A discount can never be more than the food total.
  function payInto(tx, oi, pay) {
    const o = tx.get('orders')[oi];
    const t0 = orderTotals(tx.state(), o, { discount: pay.discount });
    if (!(t0.subtotal > 0)) return 'orderEmpty';
    if (pay.discount > t0.subtotal + 1e-9) { tx.info = { key: 'discount', min: 0, max: t0.subtotal }; return 'outOfBounds'; }
    const w = tx.mutIn(tx.mut('orders'), oi);
    w.status = 'paid'; w.paidAt = stampAfter(o.createdAt, tx.now); w.method = pay.method; w.tip = pay.tip; w.discount = t0.discount; w.totals = t0;
    tx.event('order_paid', { orderId: o.id, method: pay.method, subtotal: t0.subtotal, discount: t0.discount, tax: t0.tax, total: t0.total, tip: pay.tip, rounds: t0.rounds });
    tx.info = Object.assign({}, tx.info, { orderId: o.id, total: t0.total, tip: pay.tip, method: pay.method });
    return 'ok';
  }
  // Takes payment on an open order: method (cash, card or other), an optional tip and an optional discount, all in
  // dollars. The totals are frozen at that moment, so later menu or price changes never alter a paid order.
  A.payOrder = function (tx, p) {
    const oi = findOrderIdx(tx.get('orders'), p.orderId);
    if (oi < 0) return 'unknownOrder';
    if (tx.get('orders')[oi].status !== 'open') return 'orderNotOpen';
    const pay = readPayment(tx, p);
    if (typeof pay === 'string') return pay;
    return payInto(tx, oi, pay);
  };
  // Opens a paid order again, for a wrong payment method or a forgotten item. Its totals are worked out afresh
  // when it is paid next.
  A.reopenOrder = function (tx, p) {
    const oi = findOrderIdx(tx.get('orders'), p.orderId);
    if (oi < 0) return 'unknownOrder';
    const o = tx.get('orders')[oi];
    if (o.status !== 'paid') return 'orderNotPaid';
    const w = tx.mutIn(tx.mut('orders'), oi);
    w.status = 'open'; delete w.paidAt; delete w.method; delete w.tip; delete w.discount; delete w.totals;
    tx.event('order_reopened', { orderId: o.id });
    tx.info = { orderId: o.id };
    return 'ok';
  };
  // Voids an open order that has no food left on it (every ticket voided, or none). A reason is required, up to 40
  // characters.
  A.voidOrder = function (tx, p) {
    const oi = findOrderIdx(tx.get('orders'), p.orderId);
    if (oi < 0) return 'unknownOrder';
    if (typeof p.reason !== 'string' || p.reason.length > 400) return 'reasonRequired';
    const reason = cleanText(p.reason);
    if (!reason) return 'reasonRequired';
    if (reason.length > 40) return 'noteTooLong';
    const o = tx.get('orders')[oi];
    if (o.status !== 'open') return 'orderNotOpen';
    for (const t of tx.get('tickets')) if (t.orderId === o.id && t.status !== 'voided') return 'orderNotEmpty';
    const w = tx.mutIn(tx.mut('orders'), oi);
    w.status = 'voided'; w.voidedAt = stampAfter(o.createdAt, tx.now); w.voidReason = reason;
    tx.event('order_voided', { orderId: o.id, reason });
    tx.info = { orderId: o.id };
    return 'ok';
  };
  // When there are more orders than max, drops the oldest paid or voided ones (never an open one, and never one
  // that still has a ticket on the board) to about 2 percent under max.
  function pruneOrdersInto(tx, max) {
    const arr = tx.get('orders');
    if (!Array.isArray(arr) || !(arr.length > max)) return;
    const target = Math.max(0, max - Math.max(1, Math.floor(max * 0.02)));
    let drop = arr.length - target;
    let live = null;
    const keep = [];
    for (const o of arr) {
      if (drop > 0 && o.status !== 'open') {
        if (!live) { live = new Set(); const ts = tx.get('tickets'); for (const ti of activeIdx(ts)) if (ts[ti].orderId) live.add(ts[ti].orderId); }
        if (!live.has(o.id)) { drop--; continue; }
      }
      keep.push(o);
    }
    if (keep.length !== arr.length) { tx.own.add(keep); tx.ch.orders = keep; }
  }

  // One tap on an item. A shown two-step item starts cooking; anything else shown or cooking is marked done
  // (stock is used, prep time learned). On-deck items need fireNow first (nothingToDo).
  A.advanceItem = function (tx, p) {
    const r = locate(tx, p);
    if (typeof r === 'string') return r;
    if (r.t.status !== 'active') return 'ticketNotActive';
    const it = r.it;
    if (it.status === 'done') return 'alreadyDone';
    if (it.status === 'queued') { tx.info.why = 'onDeck'; return 'nothingToDo'; }
    if (it.status === 'displayed' && it.track === 'two') {
      const w = tx.item(r.ti, r.ii);
      w.status = 'cooking'; w.startedAt = stampAfter(it.firedAt, tx.now);
      tx.event('item_started', { ticketId: r.t.id, itemId: it.id, zone: it.zone, menuId: it.menuId });
      pushUndo(tx, 'items', shortName(it) + ' started', { ticketId: r.t.id, items: [{ itemId: it.id, before: it, after: timesOf(w) }], learned: [] });
      tx.info = { ticketId: r.t.id, itemId: it.id, status: 'cooking' };
      return 'ok';
    }
    const lb = new Map();
    const rec = completeInto(tx, r.ti, r.ii, lb);
    pushUndo(tx, 'items', shortName(it) + ' done', { ticketId: r.t.id, items: [rec], learned: learnedUndoData(tx, lb) });
    tx.info = { ticketId: r.t.id, itemId: it.id, status: 'done' };
    return 'ok';
  };

  // Shortcut straight to done from shown or cooking, skipping the start tap. Same refusals as advanceItem.
  A.completeItem = function (tx, p) {
    const r = locate(tx, p);
    if (typeof r === 'string') return r;
    if (r.t.status !== 'active') return 'ticketNotActive';
    if (r.it.status === 'done') return 'alreadyDone';
    if (r.it.status === 'queued') { tx.info.why = 'onDeck'; return 'nothingToDo'; }
    const lb = new Map();
    const rec = completeInto(tx, r.ti, r.ii, lb);
    pushUndo(tx, 'items', shortName(r.it) + ' done', { ticketId: r.t.id, items: [rec], learned: learnedUndoData(tx, lb) });
    tx.info = { ticketId: r.t.id, itemId: r.it.id, status: 'done' };
    return 'ok';
  };

  // Starts a waiting item now instead of waiting for its planned time. Marked override, so it is not used
  // for learning. With start:true a two-step item goes straight to cooking (one tap on the board); without
  // it the item just moves to the screen.
  A.fireNow = function (tx, p) {
    const r = locate(tx, p);
    if (typeof r === 'string') return r;
    if (r.t.status !== 'active') return 'ticketNotActive';
    if (r.it.status !== 'queued') return 'alreadyFired';
    const w = tx.item(r.ti, r.ii);
    w.status = 'displayed'; w.firedAt = stampAfter(r.t.createdAt, tx.now); w.override = true;
    tx.event('item_fired', { ticketId: r.t.id, itemId: r.it.id, zone: r.it.zone, menuId: r.it.menuId, override: true, at: w.firedAt });
    const cook = p.start === true && r.it.track === 'two';
    if (cook) {
      w.status = 'cooking'; w.startedAt = w.firedAt;
      tx.event('item_started', { ticketId: r.t.id, itemId: r.it.id, zone: r.it.zone, menuId: r.it.menuId });
    }
    pushUndo(tx, 'items', 'Start now: ' + shortName(r.it), { ticketId: r.t.id, items: [{ itemId: r.it.id, before: r.it, after: timesOf(w) }], learned: [] });
    tx.info = { ticketId: r.t.id, itemId: r.it.id, status: w.status };
    return 'ok';
  };

  // Station "all done": completes every not-done item of that station on one ticket. On-deck ones are fired
  // early first. Refuses with nothingToDo when the station has none, and badPatch for an unknown station.
  A.completeZone = function (tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    if (typeof p.zone !== 'string' || C.workZones.indexOf(p.zone) < 0) { tx.info.key = 'zone'; return 'badPatch'; }
    const t = tickets[ti];
    if (t.status !== 'active') return 'ticketNotActive';
    const lb = new Map();
    const recs = [];
    for (let ii = 0; ii < t.items.length; ii++) {
      const it = t.items[ii];
      if (it.zone !== p.zone || it.status === 'done') continue;
      recs.push(completeInto(tx, ti, ii, lb));
    }
    if (!recs.length) return 'nothingToDo';
    const zn = hasOwn(C.zoneById, p.zone) ? C.zoneById[p.zone].name : p.zone;
    pushUndo(tx, 'items', zn + ': ' + recs.length + ' ' + U.plural(recs.length, 'item') + ' done', { ticketId: t.id, items: recs, learned: learnedUndoData(tx, lb) });
    tx.info = { ticketId: t.id, zone: p.zone, count: recs.length };
    return 'ok';
  };

  // The cook's first tap on a ticket. The pacing clock starts now: every item is re-timed so the slowest one
  // fires at this moment and the rest follow their usual offsets, so the whole ticket still finishes together.
  // Refuses a ticket that is not waiting for its start (alreadyStarted).
  A.startTicket = function (tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    const t = tickets[ti];
    if (t.status !== 'active') return 'ticketNotActive';
    if (!t.awaitStart) return 'alreadyStarted';
    const start = stampAfter(t.createdAt, tx.now);
    const before = t.items.map((it) => Object.assign({}, it));
    const w = tx.ticket(ti);
    delete w.awaitStart; w.startedAt = start;
    let fired = 0;
    for (let ii = 0; ii < t.items.length; ii++) {
      const it = t.items[ii];
      if (it.status !== 'queued') continue; // already worked by hand (fire now): its times stay as they are
      const wi = tx.item(ti, ii);
      wi.rebased = true; wi.fireAt = start + it.offsetSec * 1000;
      if (wi.fireAt <= start) {
        wi.status = 'displayed'; wi.firedAt = wi.fireAt; fired++;
        tx.event('item_fired', { ticketId: t.id, itemId: it.id, zone: it.zone, menuId: it.menuId, at: wi.firedAt });
      }
    }
    tx.event('ticket_started', { ticketId: t.id, lagMs: start - t.createdAt, fired });
    pushUndo(tx, 'start', 'Ticket #' + t.num + ' started', { ticketId: t.id, startedAt: start, items: before });
    tx.info = { ticketId: t.id, num: t.num, fired, lagMs: start - t.createdAt };
    return 'ok';
  };

  // The cook's last tap: the plate is ready and leaves the pass. Every item not yet done is finished and the
  // ticket is bumped in one step. Items finished this way do not teach the app prep times (their stamp is the
  // release tap, not a real finish). Refuses a ticket still waiting for its start (notStarted).
  A.releaseTicket = function (tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    const t = tickets[ti];
    if (t.status !== 'active') return 'ticketNotActive';
    if (t.awaitStart) return 'notStarted';
    const lb = new Map();
    const recs = [];
    for (let ii = 0; ii < t.items.length; ii++) {
      if (t.items[ii].status === 'done') continue;
      recs.push(completeInto(tx, ti, ii, lb, { noLearn: true }));
      tx.item(ti, ii).released = true;
    }
    const cur = tx.get('tickets')[ti];
    let exp = stampAfter(cur.createdAt, tx.now);
    for (const it of cur.items) {
      for (const k of ['doneAt', 'startedAt', 'firedAt']) if (isNum(it[k]) && it[k] > exp) exp = it[k];
    }
    const w = tx.ticket(ti);
    w.status = 'expedited'; w.expeditedAt = exp; w.released = true; delete w.forced;
    const readyAt = isNum(t.startedAt) ? t.startedAt + (t.dmaxSec || 0) * 1000 : null;
    tx.event('ticket_expedited', { ticketId: t.id, totalMs: exp - t.createdAt, forced: false, released: true });
    tx.event('ticket_released', { ticketId: t.id, totalMs: exp - t.createdAt, startLagMs: isNum(t.startedAt) ? t.startedAt - t.createdAt : null, cookMs: isNum(t.startedAt) ? exp - t.startedAt : null, afterReadyMs: readyAt === null ? null : exp - readyAt });
    pushUndo(tx, 'release', 'Ticket #' + t.num + ' released', { ticketId: t.id, expeditedAt: exp, items: recs, hadReleased: t.released === true });
    tx.info = { ticketId: t.id, num: t.num, finished: recs.length };
    return 'ok';
  };

  // Sends the ticket out. All items must be done unless force is true, which marks the ticket forced.
  // expeditedAt is never earlier than any item time (I4).
  A.bumpTicket = function (tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    const t = tickets[ti];
    if (t.status !== 'active') return 'ticketNotActive';
    let notDone = 0;
    let exp = stampAfter(t.createdAt, tx.now);
    for (const it of t.items) {
      if (it.status !== 'done') notDone++;
      if (isNum(it.doneAt) && it.doneAt > exp) exp = it.doneAt;
      if (isNum(it.startedAt) && it.startedAt > exp) exp = it.startedAt;
      if (isNum(it.firedAt) && it.firedAt > exp) exp = it.firedAt;
    }
    if (notDone && p.force !== true) { tx.info.remaining = notDone; return 'notAllDone'; }
    const w = tx.ticket(ti);
    w.status = 'expedited'; w.expeditedAt = exp;
    if (notDone) w.forced = true; else delete w.forced;
    tx.event('ticket_expedited', { ticketId: t.id, totalMs: exp - t.createdAt, forced: notDone > 0 });
    pushUndo(tx, 'bump', 'Ticket #' + t.num + ' bumped', { ticketId: t.id, expeditedAt: exp });
    tx.info = { ticketId: t.id, num: t.num, forced: notDone > 0, remaining: notDone };
    return 'ok';
  };

  // Brings a bumped ticket back to the board and counts the recall. Item times are kept and stock is not
  // given back. Due on-deck items fire at once (F-E3, see fireDueInto).
  A.recallTicket = function (tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    const t = tickets[ti];
    if (t.status !== 'expedited') return 'ticketNotExpedited';
    const w = tx.ticket(ti);
    w.status = 'active'; w.recalls = (isInt(t.recalls) && t.recalls > 0 ? t.recalls : 0) + 1;
    delete w.expeditedAt; delete w.forced;
    tx.event('ticket_recalled', { ticketId: t.id });
    tx.info = { ticketId: t.id, num: t.num };
    return 'ok';
  };

  // Cancels an active ticket. A reason is required, up to 40 characters.
  A.voidTicket = function (tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    if (typeof p.reason !== 'string' || p.reason.length > 400) return 'reasonRequired';
    const reason = cleanText(p.reason);
    if (!reason) return 'reasonRequired';
    if (reason.length > 40) return 'noteTooLong';
    const t = tickets[ti];
    if (t.status !== 'active') return 'ticketNotActive';
    // Food on a paid order cannot be voided: reopen the order first, so the money and the food agree.
    if (t.orderId) { const oj = findOrderIdx(tx.get('orders'), t.orderId); if (oj >= 0 && tx.get('orders')[oj].status === 'paid') return 'orderNotOpen'; }
    const w = tx.ticket(ti);
    w.status = 'voided'; w.voidedAt = stampAfter(t.createdAt, tx.now); w.voidReason = reason;
    tx.event('ticket_voided', { ticketId: t.id, reason });
    pushUndo(tx, 'void', 'Ticket #' + t.num + ' voided', { ticketId: t.id, voidedAt: w.voidedAt });
    tx.info = { ticketId: t.id, num: t.num };
    return 'ok';
  };

  // Turns rush on or off. Rush on fires every on-deck item now with offset 0, so the plan stays consistent
  // (I5). Rush off only removes the flag.
  A.setRush = function (tx, p) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, p.ticketId);
    if (ti < 0) return 'unknownTicket';
    if (typeof p.on !== 'boolean') { tx.info.key = 'on'; return 'badPatch'; }
    const t = tickets[ti];
    if (t.status !== 'active') return 'ticketNotActive';
    if (!!t.rush === p.on) return 'nothingToDo';
    const w = tx.ticket(ti);
    w.rush = p.on;
    let fired = 0;
    if (p.on) {
      for (let ii = 0; ii < t.items.length; ii++) {
        const it = t.items[ii];
        if (it.status !== 'queued') continue;
        const wi = tx.item(ti, ii);
        wi.offsetSec = 0; wi.fireAt = t.createdAt; wi.rushed = true; /*@I5b*/
        if (it.rebased && isNum(t.startedAt)) wi.fireAt = t.startedAt; // a started ticket counts its plan from the Start tap
        wi.status = 'displayed'; wi.firedAt = stampAfter(t.createdAt, tx.now);
        fired++;
        tx.event('item_fired', { ticketId: t.id, itemId: it.id, zone: it.zone, menuId: it.menuId, rush: true, at: wi.firedAt });
      }
    }
    tx.event('ticket_rush', { ticketId: t.id, on: p.on });
    tx.info = { ticketId: t.id, fired };
    return 'ok';
  };

  // Manual 86 on or off for a dish. Remembers when it started so undo can tell whether it changed since.
  A.toggle86 = function (tx, p) {
    const mi = getMenu(tx.get('menu'), p.menuId);
    if (!mi) return 'unknownMenu';
    if (typeof p.on !== 'boolean') { tx.info.key = 'on'; return 'badPatch'; }
    const m86 = tx.get('manual86');
    const cur = hasOwn(m86, mi.id) ? m86[mi.id] : null;
    if (p.on === !!cur) return 'nothingToDo';
    const w = tx.mut('manual86');
    if (p.on) w[mi.id] = { since: tx.now }; else delete w[mi.id];
    pushUndo(tx, '86', (mi.short || mi.name) + (p.on ? ' 86' : ' back on'), { menuId: mi.id, on: p.on, before: cur, since: p.on ? tx.now : null });
    tx.info = { menuId: mi.id, on: p.on };
    return 'ok';
  };

  // Default name for a new batch, like "Brisket batch 3": counts today's batches of that ingredient
  // (service day).
  function newBatchLabel(tx, ing) {
    const bs = tx.get('batches');
    const sd = U.serviceDate(tx.now, tx.get('settings').service.dayStartHour);
    let n = 1;
    for (const b of bs) if (b.ing === ing.id && b.kind !== 'cooling' && U.serviceDate(b.enteredAt, tx.get('settings').service.dayStartHour) === sd) n++;
    return ing.name + ' batch ' + n;
  }
  // Over 200 batches: drops the oldest finished ones (discarded or empty, older than 24 hours) down to
  // about 150. Their waste and leftover grams move into the ledger so the books still balance (I2).
  function pruneBatchesInto(tx) {
    const bs = tx.get('batches');
    if (bs.length <= 200) return;
    const cutoff = tx.now - 24 * H;
    const keep = [];
    let drop = bs.length - 150;
    for (const b of bs) {
      if (drop > 0 && (b.status === 'discard' || !(b.remainingG > 0)) && b.enteredAt < cutoff) {
        drop--;
        const L = tx.ledger(b.ing);
        L.prunedWaste = (L.prunedWaste || 0) + (b.wasteG > 0 ? b.wasteG : 0);
        L.prunedRemain = (L.prunedRemain || 0) + (b.remainingG > 0 ? b.remainingG : 0);
        continue;
      }
      keep.push(b);
    }
    if (keep.length !== bs.length) { tx.own.add(keep); tx.ch.batches = keep; tx.batchTouched = true; }
  }
  /** Shared intake: builds the batch, records the ledger intake and batch_in. Returns the new batch. */
  // Creates a batch in the hold cabinet: ledger intake, batch_in event, one gate run so its status is
  // right, and a trim of old batches. A first reading out of range sets outSince at once. Returns the new
  // batch.
  function intakeInto(tx, ing, o) {
    const S = safetyOf(tx.get('settings'));
    const id = 'b_' + tx.next('batch');
    const b = {
      id, ing: ing.id, label: o.label || newBatchLabel(tx, ing), kind: ing.hold === 'cold' ? 'cold' : 'hot',
      enteredAt: tx.now, cookedG: o.cookedG, remainingG: o.cookedG, src: o.src, temps: [], reheats: 0,
      maxHoldH: isNum(ing.maxHoldH) ? ing.maxHoldH : S.defaultMaxHoldH, status: 'ok', action: 'NONE', canServe: true,
    };
    b.holdBasis = ing.holdBasis === 'safety' ? 'safety' : 'quality';
    if (isNum(ing.restH) && ing.restH > 0) b.restUntil = tx.now + ing.restH * H;
    if (isNum(o.rawG)) b.rawG = o.rawG;
    if (isNum(o.yieldPct)) b.yieldPct = o.yieldPct;
    if (isNum(o.costPerCookedKg)) b.costPerCookedKg = o.costPerCookedKg;
    if (isNum(o.endpointC)) b.endpointC = o.endpointC; // thermal inputs as entered (clamped to the model range); absent when not entered
    if (isNum(o.holdH)) b.holdH = o.holdH;
    if (isNum(o.tempF)) {
      b.temps = [{ t: tx.now, f: o.tempF }]; b.lastTempF = o.tempF; b.lastTempAt = tx.now;
      if (b.kind === 'hot' ? o.tempF < S.hotHoldF : o.tempF > S.coldHoldF) b.outSince = tx.now;
    }
    const gt = gate(b, tx.now, S);
    b.status = gt.status; b.action = gt.action; b.canServe = gt.canServe;
    tx.own.add(b);
    const bs = tx.mut('batches');
    bs.push(b);
    tx.batchTouched = true;
    const L = tx.ledger(ing.id);
    L.in = (L.in || 0) + o.cookedG;
    tx.event('batch_in', { batchId: id, ing: ing.id, cookedG: o.cookedG, yieldPct: b.yieldPct, src: o.src });
    if (o.src === 'cook') consumePlanInto(tx, ing.id, id);
    pruneBatchesInto(tx);
    return b;
  }

  // Adds stock. Plain ingredients just add to stock. TCS food enters as a new batch with NO temperature
  // reading (unknown is not zero), so it shows "check temp" at once.
  A.restock = function (tx, p) {
    const ing = typeof p.ing === 'string' ? ingMap(tx.get('ingredients')).get(p.ing) : undefined;
    if (!ing) return 'unknownIng';
    if (!isNum(p.g) || p.g <= 0 || p.g > 1e6) return 'badWeight';
    if (ing.tcs) {
      // TCS food enters the hold cabinet as a batch with NO temperature reading (unknown is not zero): it shows "check temp" at once.
      const b = intakeInto(tx, ing, { cookedG: p.g, src: 'cook', costPerCookedKg: round(nominalUnitCost(ing) * 1000, 4) });
      tx.info = { ing: ing.id, batchId: b.id };
    } else {
      const ws = tx.mut('stock');
      ws[ing.id] = (hasOwn(ws, ing.id) && isNum(ws[ing.id]) ? ws[ing.id] : 0) + p.g;
      const L = tx.ledger(ing.id);
      L.in = (L.in || 0) + p.g;
      tx.info = { ing: ing.id, g: p.g };
    }
    tx.event('restock', { ing: ing.id, g: p.g });
    return 'ok';
  };

  // Takes a set amount of a cooked ingredient out of the hold cabinet by hand, oldest batch first. Beside a
  // POS this is how sales reach the books. If the cabinet holds less than asked, it takes what is there and
  // says how much was short.
  A.pullBatch = function (tx, p) {
    const ing = typeof p.ing === 'string' ? ingMap(tx.get('ingredients')).get(p.ing) : undefined;
    if (!ing || !ing.tcs) return 'unknownIng';
    if (!isNum(p.g) || p.g <= 0 || p.g > 1e6) return 'badWeight';
    const took = takeFifoInto(tx, ing, p.g);
    if (!took.recs.length) return 'batchNotServable';
    const g = took.recs.reduce((a, r) => a + r.g, 0);
    const L = tx.ledger(ing.id);
    L.pulled = (L.pulled || 0) + g;
    tx.event('cabinet_pull', { ing: ing.id, g, batchIds: took.recs.map((r) => r.batchId), short: took.left > EPS ? took.left : 0 });
    pushUndo(tx, 'pull', 'Pulled ' + Math.round(g) + ' g of ' + ing.name, { ing: ing.id, recs: took.recs });
    tx.info = { ing: ing.id, g, short: took.left > EPS ? took.left : 0, batchIds: took.recs.map((r) => r.batchId) };
    return 'ok';
  };

  // Logs a cooked batch. Needs a TCS ingredient, a first temperature (32 to 300 F) and a weight (rawG or
  // cookedG). Cooked grams come from what was entered, else the brisket yield model, else the ingredient's
  // starter yield.
  A.addBatch = function (tx, p) {
    const ing = typeof p.ing === 'string' ? ingMap(tx.get('ingredients')).get(p.ing) : undefined;
    if (!ing || !ing.tcs) return 'unknownIng';
    if (!isNum(p.tempF) || p.tempF < 32 || p.tempF > 300) return 'badTemp';
    for (const k of ['rawG', 'cookedG', 'endpointC', 'holdH']) if (p[k] != null && typeof p[k] !== 'number') { tx.info.key = k; return k === 'rawG' || k === 'cookedG' ? 'badWeight' : 'badPatch'; }
    if (p.endpointC != null && !isNum(p.endpointC)) { tx.info.key = 'endpointC'; return 'badPatch'; }
    if (p.holdH != null && !isNum(p.holdH)) { tx.info.key = 'holdH'; return 'badPatch'; }
    const rawG = p.rawG == null ? undefined : p.rawG;
    const cookedIn = p.cookedG == null ? undefined : p.cookedG;
    if (rawG !== undefined && (!isNum(rawG) || rawG <= 0 || rawG > 1e6)) return 'badWeight';
    if (cookedIn !== undefined && (!isNum(cookedIn) || cookedIn <= 0 || cookedIn > 1e6)) return 'badWeight';
    if (rawG === undefined && cookedIn === undefined) return 'badWeight';
    let label;
    if (p.label != null) {
      if (typeof p.label !== 'string') { tx.info.key = 'label'; return 'badPatch'; }
      label = cleanText(p.label.slice(0, 400));
      if (label.length > 40) return 'noteTooLong';
    }
    const src = p.src == null ? 'cook' : p.src;
    if (typeof src !== 'string' || !hasOwn(SRC_BATCH, src)) { tx.info.key = 'src'; return 'badPatch'; }
    // Cooked grams, yield percent and cost per cooked kg: an entered cooked weight wins, then the thermal
    // model, then the static yield.
    const rawCost = isNum(ing.costPerKg) ? ing.costPerKg : 0;
    let cookedG, yieldPct, costPerCookedKg;
    const ty = ing.thermal ? thermalYield({ endpointC: p.endpointC, holdH: p.holdH, rawG, costPerKgRaw: rawCost }) : null;
    if (cookedIn !== undefined) {
      cookedG = cookedIn;
      if (rawG !== undefined) yieldPct = round((cookedG / rawG) * 100, 2);
    } else if (ty) {
      cookedG = ty.cookedG; yieldPct = ty.hotPct;
    } else {
      const y = isNum(ing.yield) && ing.yield > 0 ? ing.yield : 1;
      cookedG = Math.round(rawG * y); yieldPct = round(y * 100, 2);
    }
    if (!(cookedG > 0)) return 'badWeight';
    if (rawG !== undefined) costPerCookedKg = round((rawG / 1000) * rawCost / (cookedG / 1000), 4);
    else costPerCookedKg = round(nominalUnitCost(ing) * 1000, 4);
    const b = intakeInto(tx, ing, { cookedG, rawG, yieldPct, costPerCookedKg, src, tempF: p.tempF, label,
      endpointC: ty && p.endpointC != null ? ty.endpointC : undefined, holdH: ty && p.holdH != null ? ty.holdH : undefined });
    tx.info = { batchId: b.id, cookedG, yieldPct, costPerCookedKg, status: b.status, canServe: b.canServe };
    return 'ok';
  };

  // Records a temperature reading, then re-runs the gate. A hot reading below the hot-hold limit, or a cold
  // one above its limit, starts the out-of-range clock (outSince); an in-range cold reading clears it. A
  // cooling batch records stage 1 and final. Also logs whether the check was on time.
  A.logTemp = function (tx, p) {
    const bs = tx.get('batches');
    const bi = findBatchIdx(bs, p.batchId);
    if (bi < 0) return 'unknownBatch';
    if (!isNum(p.tempF) || p.tempF < 32 || p.tempF > 300) return 'badTemp';
    const b = bs[bi];
    if (b.status === 'discard') return 'batchNotServable';
    const S = safetyOf(tx.get('settings'));
    const f = p.tempF;
    const iv = S.tempCheckEveryMin * MIN;
    const dueAt = (isNum(b.lastTempAt) ? b.lastTempAt : b.enteredAt) + iv;
    const lateMs = Math.max(0, tx.now - dueAt);
    const w = tx.batch(bi);
    const t = stampAfter(b.lastTempAt, stampAfter(b.enteredAt, tx.now));
    const temps = (b.temps || []).concat([{ t, f }]);
    w.temps = temps.length > MAX_TEMPS ? temps.slice(temps.length - MAX_TEMPS) : temps;
    w.lastTempF = f; w.lastTempAt = t;
    // What a reading means depends on the kind of batch: cooling, cold or hot.
    let reheated = false;
    if (b.kind === 'cooling') {
      const c = S.cooling || C.safety.cooling;
      if (b.stage1At == null && f <= c.stage1ToF) w.stage1At = t;
      if (w.stage1At != null && b.finalAt == null && f <= c.finalF) w.finalAt = t;
    } else if (b.kind === 'cold') {
      if (f > S.coldHoldF) { if (b.outSince == null) w.outSince = t; } else if (b.outSince != null) delete w.outSince;
    } else if (f < S.hotHoldF) {
      if (b.outSince == null) w.outSince = t;
    } else if (b.outSince != null && f >= S.reheatF && !(b.reheats >= 1) && t - b.outSince <= S.belowHotGraceH * H) {
      // a logged reading at reheat temperature inside the grace window IS the reheat (honest input is never refused)
      delete w.outSince; w.reheats = (b.reheats || 0) + 1; reheated = true;
    }
    tx.event('temp_logged', { batchId: b.id, f, onTime: lateMs === 0, lateMs });
    if (reheated) tx.event('batch_reheat', { batchId: b.id, f });
    refreshBatch(tx, bi);
    const nb = tx.get('batches')[bi];
    tx.info = { batchId: b.id, status: nb.status, canServe: nb.canServe, onTime: lateMs === 0, lateMs, reheated };
    return 'ok';
  };

  // The one allowed reheat, to at least reheatF. A hot batch must be below hot-hold and still inside the
  // grace window. A cooling batch that missed stage 1 restarts its cooling clock. Refuses with tempTooLow,
  // notReheatable or nothingToDo.
  A.reheatBatch = function (tx, p) {
    const bs = tx.get('batches');
    const bi = findBatchIdx(bs, p.batchId);
    if (bi < 0) return 'unknownBatch';
    if (!isNum(p.tempF) || p.tempF < 32 || p.tempF > 300) return 'badTemp';
    const b = bs[bi];
    if (b.status === 'discard') return 'batchNotServable';
    const S = safetyOf(tx.get('settings'));
    if (b.kind === 'cold') return 'notReheatable';
    if (p.tempF < S.reheatF) { tx.info.needF = S.reheatF; return 'tempTooLow'; }
    if (b.reheats >= 1) return 'notReheatable';
    const w = tx.batch(bi);
    const t = stampAfter(b.lastTempAt, stampAfter(b.enteredAt, tx.now));
    if (b.kind === 'cooling') {
      if (b.status !== 'reheat') { tx.info.why = 'notDue'; return 'nothingToDo'; }
      w.coolStartAt = t; delete w.stage1At;
    } else {
      if (b.outSince == null) { tx.info.why = 'notBelow'; return 'nothingToDo'; }
      if (tx.now - b.outSince > S.belowHotGraceH * H) return 'notReheatable';
      delete w.outSince;
    }
    w.reheats = (b.reheats || 0) + 1;
    const temps = (b.temps || []).concat([{ t, f: p.tempF }]);
    w.temps = temps.length > MAX_TEMPS ? temps.slice(temps.length - MAX_TEMPS) : temps;
    w.lastTempF = p.tempF; w.lastTempAt = t;
    tx.event('batch_reheat', { batchId: b.id, f: p.tempF });
    refreshBatch(tx, bi);
    const nb = tx.get('batches')[bi];
    tx.info = { batchId: b.id, status: nb.status, canServe: nb.canServe };
    return 'ok';
  };

  // Moves grams of a hot batch into a new cooling batch (never servable). g defaults to everything left; up
  // to 0.5 g over is accepted so a figure read off the screen is never refused (Pitcall F19).
  A.startCooling = function (tx, p) {
    const bs = tx.get('batches');
    const bi = findBatchIdx(bs, p.batchId);
    if (bi < 0) return 'unknownBatch';
    const b = bs[bi];
    if (b.status === 'discard') return 'batchNotServable';
    if (b.kind !== 'hot') { tx.info.key = 'kind'; return 'badPatch'; }
    if (!(b.remainingG > 0)) return 'nothingToDo';
    let gm = p.g == null ? b.remainingG : p.g;
    if (!isNum(gm) || gm <= 0 || gm > b.remainingG + 0.5) return 'badWeight';
    gm = Math.min(gm, b.remainingG);
    const w = tx.batch(bi);
    w.remainingG = b.remainingG - gm <= EPS ? 0 : b.remainingG - gm;
    // F-E8: time already spent below the hot-holding line counts toward the 2-hour cooling limit, so the clock
    // starts at the first low reading (outSince) when there was one, not at the moment of the tap.
    const coolFrom = isNum(b.outSince) && b.outSince < tx.now ? b.outSince : tx.now;
    const id = 'b_' + tx.next('batch');
    const nb = {
      id, ing: b.ing, label: (b.label || 'Batch') + ' (cooling)', kind: 'cooling', enteredAt: tx.now, coolStartAt: coolFrom, from: b.id,
      cookedG: gm, remainingG: gm, src: b.src === 'sample' ? 'sample' : 'cook', temps: [], reheats: 0, status: 'chill', action: 'CHILL_NOW', canServe: false,
    };
    if (isNum(b.costPerCookedKg)) nb.costPerCookedKg = b.costPerCookedKg;
    tx.own.add(nb);
    tx.mut('batches').push(nb);
    tx.batchTouched = true;
    tx.event('cooling_started', { batchId: id, from: b.id, ing: b.ing, g: gm });
    refreshBatch(tx, tx.get('batches').length - 1);
    tx.info = { batchId: id, g: gm };
    return 'ok';
  };

  // Keeps batches that are past their quality limit on the menu for a while, after a person tasted them. Each
  // listed batch needs a reading in range, taken within the temperature-check interval; the ones that do not
  // qualify are skipped and listed. The extension never runs past the hard cap. Logged with who and when.
  A.keepServing = function (tx, p) {
    const S = safetyOf(tx.get('settings'));
    const who = typeof p.who === 'string' ? p.who.trim() : '';
    if (!who || who.length > 12) return 'whoRequired';
    const ids = Array.isArray(p.batchIds) ? p.batchIds.filter((x) => typeof x === 'string').slice(0, 40) : [];
    if (!ids.length) return 'unknownBatch';
    let until = tx.now + 30 * MIN;
    if (isNum(p.until)) { if (!(p.until > tx.now)) return 'badUntil'; until = p.until; }
    else if (isNum(p.forMin)) { if (!(p.forMin >= 1 && p.forMin <= 720)) return 'badUntil'; until = tx.now + p.forMin * MIN; }
    else if (p.forMin !== undefined || p.until !== undefined) return 'badUntil';
    const kept = [], skipped = [];
    let firstReason = null;
    for (const id of ids) {
      const bi = findBatchIdx(tx.get('batches'), id);
      const b = bi >= 0 ? tx.get('batches')[bi] : null;
      let why = null;
      if (!b) why = 'unknownBatch';
      else if (!hasQualityStage(b, S) || b.status === 'discard' || !(tx.now > b.enteredAt + holdLimitMs(b, S))) why = 'qualityNotDue';
      else if (b.outSince != null || !isNum(b.lastTempAt) || tx.now - b.lastTempAt > S.tempCheckEveryMin * MIN || !isNum(b.lastTempF) || (b.kind === 'cold' ? b.lastTempF > S.coldHoldF : b.lastTempF < S.hotHoldF)) why = 'tempReadingNeeded';
      if (why) { skipped.push({ batchId: id, report: why }); if (!firstReason) firstReason = why; continue; }
      const keepUntil = Math.min(until, b.enteredAt + hardLimitMs(S));
      const w = tx.batch(bi);
      w.keepUntil = keepUntil; w.keptBy = who;
      tx.event('quality_extend', { batchId: b.id, ing: b.ing, who, until: keepUntil, lastTempF: b.lastTempF, lastTempAt: b.lastTempAt });
      refreshBatch(tx, bi);
      kept.push(b.id);
    }
    if (!kept.length) { tx.info = { skipped }; return firstReason || 'unknownBatch'; }
    tx.info = { kept, skipped, until: Math.min(until, Infinity) };
    return 'ok';
  };
  // A logged correction for a mistaken keep-serving: the batch goes back to past its quality limit. The original
  // log entry stays; the correction points at it.
  A.endKeepServing = function (tx, p) {
    const bi = typeof p.batchId === 'string' ? findBatchIdx(tx.get('batches'), p.batchId) : -1;
    if (bi < 0) return 'unknownBatch';
    const b = tx.get('batches')[bi];
    const who = typeof p.who === 'string' ? p.who.trim() : '';
    if (!who || who.length > 12) return 'whoRequired';
    if (!(isNum(b.keepUntil) && b.keepUntil > tx.now)) return 'qualityNotDue';
    const evs = allEvents(tx.state());
    let of = null;
    for (let i = evs.length - 1; i >= 0; i--) if (evs[i].type === 'quality_extend' && evs[i].batchId === b.id) { of = evs[i].id; break; }
    const w = tx.batch(bi);
    // Back to the state before the keep (no extension), so the warning ladder sees the same batch it already announced.
    w.keepUntil = 0;
    tx.event('quality_extend_corrected', { batchId: b.id, who, note: typeof p.note === 'string' ? p.note.slice(0, C.limits.maxNoteLen) : '', of });
    refreshBatch(tx, bi);
    tx.info = { batchId: b.id };
    return 'ok';
  };

  // Planned batches: "this comes off the smoker at HH:MM". Supply for the close projection from the moment it has
  // rested, never stock: it creates no 86 and counts in no ledger. The real batch of the same product used
  // replaces the earliest plan; a plan nobody used goes 2 hours after its serving time.
  const MAX_PLANNED = 20, PLAN_GRACE_MS = 2 * H;
  const planExpiresAt = (e) => e.readyAt + PLAN_GRACE_MS;
  // Records that a batch will come off the smoker at offAt. Its serving time adds the product's rest time. Undoable.
  A.planBatch = function (tx, p) {
    const ing = typeof p.ing === 'string' ? ingMap(tx.get('ingredients')).get(p.ing) : undefined;
    if (!ing || !ing.tcs) return 'unknownIng';
    if (!isNum(p.grams) || p.grams <= 0 || p.grams > 1e6) return 'badWeight';
    if (!isNum(p.offAt) || p.offAt < tx.now - 12 * H || p.offAt > tx.now + 36 * H) return 'badPlanTime';
    const cur = tx.get('planned') || [];
    if (cur.length >= MAX_PLANNED) { tx.info.key = 'planned'; return 'badPatch'; }
    const readyAt = p.offAt + (isNum(ing.restH) && ing.restH > 0 ? ing.restH : 0) * H;
    if (readyAt + PLAN_GRACE_MS <= tx.now) return 'badPlanTime';
    const entry = { id: 'pl_' + tx.next('plan'), ing: ing.id, grams: p.grams, offAt: p.offAt, readyAt };
    tx.own.add(entry);
    const next = cur.concat([entry]);
    tx.own.add(next); tx.set('planned', next);
    tx.event('plan_added', { planId: entry.id, ing: ing.id, grams: p.grams, offAt: p.offAt, readyAt });
    pushUndo(tx, 'plan', 'Planned batch', { planId: entry.id });
    tx.info = { planId: entry.id, readyAt };
    return 'ok';
  };
  // Cancels a planned batch that is no longer coming. Undoable.
  A.cancelPlan = function (tx, p) {
    const cur = tx.get('planned') || [];
    const i = typeof p.planId === 'string' ? cur.findIndex((e) => e.id === p.planId) : -1;
    if (i < 0) return 'unknownPlan';
    const entry = cur[i];
    const next = cur.filter((_, j) => j !== i);
    tx.own.add(next); tx.set('planned', next);
    tx.event('plan_cancelled', { planId: entry.id, ing: entry.ing });
    pushUndo(tx, 'unplan', 'Plan cancelled', { entry, index: i });
    tx.info = { planId: entry.id };
    return 'ok';
  };
  // Puts off the early warnings (chime and voice) for one batch: "remind me later". Never the last warning, a past-quality
  // batch or a thrown-out one, at most 30 minutes, and never past 5 minutes before the last warning could be due (the
  // ladder also ignores a snooze once the last rung is reached). Undoable.
  A.snoozeAlert = function (tx, p) {
    const bs = tx.get('batches');
    const bi = typeof p.batchId === 'string' ? findBatchIdx(bs, p.batchId) : -1;
    if (bi < 0) return 'unknownBatch';
    const b = bs[bi];
    if (!isInt(p.forMin) || p.forMin < 1 || p.forMin > 30) return 'badSnooze';
    if (b.status === 'discard' || b.status === 'past' || !(b.remainingG > 0) || b.canServe === false) return 'badSnooze';
    const S = safetyOf(tx.get('settings'));
    const end = hasQualityStage(b, S) && isNum(b.keepUntil) && b.keepUntil > tx.now ? Math.min(b.keepUntil, b.enteredAt + hardLimitMs(S)) : b.enteredAt + holdLimitMs(b, S);
    const until = Math.min(tx.now + p.forMin * MIN, end - 5 * MIN);
    if (!(until > tx.now)) return 'badSnooze';
    const cur = tx.get('alertSnoozes') || {};
    const next = Object.assign({}, cur); next[b.id] = until;
    tx.own.add(next); tx.set('alertSnoozes', next);
    tx.event('alert_snoozed', { batchId: b.id, ing: b.ing, until, forMin: p.forMin });
    pushUndo(tx, 'snooze', 'Reminder put off', { batchId: b.id, before: isNum(cur[b.id]) ? cur[b.id] : null });
    tx.info = { batchId: b.id, until };
    return 'ok';
  };
  // Ends a put-off reminder early. Undoable.
  A.clearSnooze = function (tx, p) {
    const cur = tx.get('alertSnoozes') || {};
    if (typeof p.batchId !== 'string' || !isNum(cur[p.batchId])) return 'unknownBatch';
    const next = Object.assign({}, cur); const was = next[p.batchId]; delete next[p.batchId];
    tx.own.add(next); tx.set('alertSnoozes', next);
    tx.event('alert_snooze_cleared', { batchId: p.batchId });
    pushUndo(tx, 'unsnooze', 'Reminder back on', { batchId: p.batchId, until: was });
    tx.info = { batchId: p.batchId };
    return 'ok';
  };
  // The real batch of a product replaces the earliest planned one for it.
  function consumePlanInto(tx, ingId, batchId) {
    const cur = tx.get('planned') || [];
    let bi = -1;
    for (let i = 0; i < cur.length; i++) if (cur[i].ing === ingId && (bi < 0 || cur[i].readyAt < cur[bi].readyAt)) bi = i;
    if (bi < 0) return;
    const e = cur[bi], next = cur.filter((_, j) => j !== bi);
    tx.own.add(next); tx.set('planned', next);
    tx.event('plan_consumed', { planId: e.id, ing: ingId, batchId });
  }

  // Manual discard with a reason from the list. The grams become waste. Undoable.
  A.discardBatch = function (tx, p) {
    const bs = tx.get('batches');
    const bi = findBatchIdx(bs, p.batchId);
    if (bi < 0) return 'unknownBatch';
    if (typeof p.reason !== 'string' || DISCARD_REASONS.indexOf(p.reason) < 0) return 'reasonRequired';
    const b = bs[bi];
    if (b.status === 'discard') return 'batchNotServable';
    discardInto(tx, bi, p.reason);
    const nb = tx.get('batches')[bi];
    pushUndo(tx, 'discard', (b.label || 'Batch') + ' discarded', { batchId: b.id, before: b, discardedAt: nb.discardedAt });
    tx.info = { batchId: b.id, g: nb.wasteG };
    return 'ok';
  };

  // Logs that food-contact surfaces were sanitised and sets the next due time. Records whether it was on
  // time. Overdue is a warning only, never a block.
  A.sanitizeDone = function (tx) {
    const S = safetyOf(tx.get('settings'));
    const cur = tx.get('sanitize') || {};
    const due = sanitizeDueEff(tx.get('settings'), cur, tx.now);
    const lateMs = isNum(due) ? Math.max(0, tx.now - due) : 0;
    const lastAt = stampAfter(cur.lastAt, tx.now);
    tx.set('sanitize', { lastAt, dueAt: lastAt + S.sanitizeEveryH * H });
    tx.event('sanitize_done', { onTime: lateMs === 0, lateMs });
    pushUndo(tx, 'sanitize', 'Sanitize logged', { before: cur, afterLastAt: lastAt });
    tx.info = { onTime: lateMs === 0, lateMs };
    return 'ok';
  };

  /* ---------- settings / menu / ingredient patches ---------- */

  // Rule for a number: allowed range lo to hi, and int true when it must be whole.
  const R = (lo, hi, int) => ({ t: 'num', lo, hi, int: !!int });
  // Rule for a safety number, with its range taken from the config bounds. Hot hold can never go below 135
  // degrees F.
  const B = (k) => R(C.safetyBounds[k][0], C.safetyBounds[k][1]);
  // Every setting the owner may change, with its rule. Anything not listed is refused (badPatch).
  const SET_SCHEMA = {
    pacing: { enabled: { t: 'bool' }, learnK: R(0, 50), floorSec: R(1, 600), minFactor: R(0.1, 1), maxFactor: R(1, 10), outlierFactor: R(1, 20), qtyFactor: R(0, 2), qtyCap: R(1, 10) },
    service: { dayStartHour: R(0, 8, true), openHour: R(0, 23), closeHour: R(1, 30), taxRatePct: R(0, 20), soundStartHour: R(0, 23, true), soundOutsideHours: { t: 'bool' }, qualitySyncHoldMin: R(0, 30, true) },
    safety: { hotHoldF: B('hotHoldF'), coldHoldF: B('coldHoldF'), reheatF: B('reheatF'), belowHotGraceH: B('belowHotGraceH'), aboveColdGraceH: B('aboveColdGraceH'),
      defaultMaxHoldH: B('defaultMaxHoldH'), hardCapH: B('hardCapH'), tempCheckEveryMin: B('tempCheckEveryMin'), sanitizeEveryH: B('sanitizeEveryH'),
      cooling: { stage1ToF: R(41, 70), stage1H: R(0.5, 2), totalH: R(1, 6), finalF: R(33, 41) }, tempIntervalV2: { t: 'bool' }, holdWindowV2: { t: 'bool' } },
    channels: { t: 'channels' },
    undoMs: R(3000, 60000, true),
    syncTargetSec: R(10, 600),
    ui: { theme: { t: 'enum', v: ['day', 'night'] }, textSize: { t: 'enum', v: ['normal', 'large'] }, sound: { t: 'bool' } },
    office: { theme: { t: 'enum', v: ['ember', 'paper'] }, pinHash: { t: 'pin' } },
    alerts: { ladderThresholds: { t: 'ladder' } },
  };
  // Checks one list of warning minutes: 1 to 5 whole numbers, strictly falling, each from 5 to 240 (the last warning
  // needs time to act on).
  function checkLadderList(list, key) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 5) return { report: 'badPatch', key };
    for (let i = 0; i < list.length; i++) {
      if (!isInt(list[i])) return { report: 'badPatch', key };
      if (list[i] < 5 || list[i] > 240) return { report: 'outOfBounds', key, min: 5, max: 240 };
      if (i > 0 && !(list[i] < list[i - 1])) return { report: 'badPatch', key };
    }
    return null;
  }
  // Checks the ladder override: null (use the built-in lists) or { default?, byIng? } of minute lists.
  function checkLadder(v, key) {
    if (v === null) return null;
    if (!isObj(v)) return { report: 'badPatch', key };
    for (const k of Object.keys(v)) if (k !== 'default' && k !== 'byIng') return { report: 'badPatch', key: key + '.' + k };
    if (v.default !== undefined) { const e = checkLadderList(v.default, key + '.default'); if (e) return e; }
    if (v.byIng !== undefined) {
      if (!isObj(v.byIng)) return { report: 'badPatch', key: key + '.byIng' };
      const ids = Object.keys(v.byIng);
      if (ids.length > 40) return { report: 'badPatch', key: key + '.byIng' };
      for (const id of ids) { if (!safeKey(id)) return { report: 'badPatch', key: key + '.byIng' }; const e = checkLadderList(v.byIng[id], key + '.byIng.' + id); if (e) return e; }
    }
    return null;
  }
  // Validates one leaf of the settings; returns null when fine, else { report, key, min?, max? }.
  function checkLeaf(spec, v, key) {
    if (spec.t === 'bool') return typeof v === 'boolean' ? null : { report: 'badPatch', key };
    if (spec.t === 'enum') return typeof v === 'string' && spec.v.indexOf(v) >= 0 ? null : { report: 'badPatch', key };
    if (spec.t === 'pin') return v === null || (typeof v === 'string' && v.length <= 128) ? null : { report: 'badPatch', key };
    if (spec.t === 'ladder') return checkLadder(v, key);
    if (spec.t === 'num') {
      if (!isNum(v)) return { report: 'badPatch', key };
      if (v < spec.lo || v > spec.hi || (spec.int && !isInt(v))) return { report: 'outOfBounds', key, min: spec.lo, max: spec.hi };
      return null;
    }
    return { report: 'badPatch', key };
  }
  // Merges channel time limits (warn and breach seconds) from a list or an object keyed by channel id. A
  // channel's warn must stay below its breach. Returns the new list or an error; keys collects the names
  // that changed.
  function mergeChannels(cur, patch, keys) {
    const out = cur.map((c) => Object.assign({}, c));
    let entries;
    if (Array.isArray(patch)) entries = patch.map((x) => [isObj(x) ? x.id : undefined, x]);
    else if (isObj(patch)) entries = Object.keys(patch).map((k) => [k, patch[k]]);
    else return { report: 'badPatch', key: 'channels' };
    if (entries.length > 20) return { report: 'badPatch', key: 'channels' };
    for (const [id, x] of entries) {
      if (typeof id !== 'string' || !hasOwn(C.channelById, id) || !isObj(x)) return { report: 'badPatch', key: 'channels' };
      let c = out.find((o) => o.id === id);
      if (!c) { c = { id, warnSec: C.channelById[id].warnSec, breachSec: C.channelById[id].breachSec }; out.push(c); }
      for (const k of Object.keys(x)) {
        if (k === 'id') continue;
        if (k !== 'warnSec' && k !== 'breachSec') return { report: 'badPatch', key: 'channels.' + id + '.' + k };
        const e = checkLeaf(k === 'warnSec' ? R(30, 7200) : R(60, 10800), x[k], 'channels.' + id + '.' + k);
        if (e) return e;
        if (c[k] !== x[k]) { c[k] = x[k]; keys.push('channels.' + id + '.' + k); }
      }
      if (!(c.warnSec < c.breachSec)) return { report: 'outOfBounds', key: 'channels.' + id + '.breachSec', min: c.warnSec + 1, max: 10800 };
    }
    return { value: out };
  }
  // Applies a settings patch to a copy of the current settings, checking each key against the schema. Never
  // edits the original. Returns the new settings or the first error.
  function mergeSchema(cur, patch, schema, path, keys) {
    if (!isObj(patch)) return { report: 'badPatch', key: path || 'patch' };
    const out = Object.assign({}, cur);
    const ks = Object.keys(patch);
    if (ks.length > 64) return { report: 'badPatch', key: path || 'patch' };
    for (const k of ks) {
      const key = path ? path + '.' + k : k;
      if (!safeKey(k) || !hasOwn(schema, k)) return { report: 'badPatch', key };
      const spec = schema[k];
      if (spec.t === 'channels') {
        const r = mergeChannels(Array.isArray(cur[k]) ? cur[k] : [], patch[k], keys);
        if (r.report) return r;
        out[k] = r.value;
      } else if (spec.t) {
        const e = checkLeaf(spec, patch[k], key);
        if (e) return e;
        if (out[k] !== patch[k]) { out[k] = patch[k]; keys.push(key); }
      } else {
        const r = mergeSchema(isObj(cur[k]) ? cur[k] : {}, patch[k], spec, key, keys);
        if (r.report) return r;
        out[k] = r.value;
      }
    }
    return { value: out };
  }
  // Re-fits every learned prep estimate after the pacing limits or a starter prep time changed, so each
  // stays in bounds (I14).
  function recomputeLearned(tx) {
    const L = tx.get('learned');
    const P = tx.get('settings').pacing;
    const mm = menuMap(tx.get('menu'));
    let w = null;
    for (const id of Object.keys(L)) {
      const mi = mm.get(id), l = L[id];
      if (!mi || !isObj(l) || !isInt(l.n) || !isNum(l.ema)) continue;
      const est = learnEst(l.n, l.ema, mi.prepSec, P);
      if (est !== l.est) { w = w || tx.mut('learned'); w[id] = { n: l.n, ema: l.ema, est }; }
    }
  }
  // Changes settings from a patch. Also requires open hour before close hour, and stage-1 cooling time
  // under total. If the safety settings changed, the sanitize due time and every batch's gate are
  // recomputed.
  A.updateSettings = function (tx, p) {
    const keys = [];
    const cur = tx.get('settings');
    const r = mergeSchema(cur, p.patch, SET_SCHEMA, '', keys);
    if (r.report) { tx.info = { key: r.key, min: r.min, max: r.max }; return r.report; }
    const S = r.value;
    if (S.alerts && S.alerts.ladderThresholds && S.alerts.ladderThresholds.byIng) {
      const im = ingMap(tx.get('ingredients'));
      for (const id of Object.keys(S.alerts.ladderThresholds.byIng)) if (!im.has(id) || !im.get(id).tcs) { tx.info = { key: 'alerts.ladderThresholds.byIng.' + id }; return 'badPatch'; }
    }
    if (!(S.service.openHour < S.service.closeHour)) { tx.info = { key: 'service.closeHour', min: S.service.openHour + 1, max: 30 }; return 'outOfBounds'; }
    if (!(S.safety.cooling.stage1H < S.safety.cooling.totalH)) { tx.info = { key: 'safety.cooling.totalH', min: S.safety.cooling.stage1H, max: 6 }; return 'outOfBounds'; }
    if (!keys.length) return 'nothingToDo';
    tx.set('settings', S);
    if (S.safety !== cur.safety) {
      const sz = tx.get('sanitize') || {};
      if (isNum(sz.lastAt)) tx.set('sanitize', { lastAt: sz.lastAt, dueAt: sz.lastAt + S.safety.sanitizeEveryH * H });
      refreshAllBatches(tx);
    }
    if (S.pacing !== cur.pacing) recomputeLearned(tx);
    tx.event('settings_changed', { keys });
    tx.info = { keys };
    return 'ok';
  };

  // Fields the owner may change on a menu item or an ingredient, with their rules. 'text' has a maximum
  // length and 'bom' is the recipe list.
  const MENU_PATCH = {
    name: { t: 'text', max: 60 }, short: { t: 'text', max: 24 }, price: R(0, 1000), prepSec: R(5, 3600), prepConfirmed: { t: 'bool' },
    bom: { t: 'bom' }, zone: { t: 'enum', v: C.workZones }, archived: { t: 'bool' },
    cat: { t: 'enum', v: C.categories.map((c) => c.id) }, track: { t: 'enum', v: ['one', 'two'] },
  };
  // The most dishes a menu may hold, so a typing slip cannot fill the saved data.
  const MENU_MAX = 150;
  const ING_PATCH = {
    name: { t: 'text', max: 60 }, thresholdG: R(0, 1e6), parG: R(0, 1e7), yield: R(0.05, 3), yieldConfirmed: { t: 'bool' },
    costPerKg: R(0, 10000), costEach: R(0, 10000), pullG: R(50, 50000),
    maxHoldH: R(0.5, 12), restH: R(0, 12), cookH: R(0, 48), holdBasis: { t: 'enum', v: ['quality', 'safety'] },
  };
  // Shared editor for menu items and ingredients. Checks each field, ignores unchanged ones (nothingToDo if
  // nothing changed), writes one new copy and logs settings_changed. Changing a starter prep time re-fits
  // the learned times.
  function patchEntity(tx, p, listKey, schema, prefix) {
    const list = tx.get(listKey);
    const idx = typeof p.id === 'string' ? list.findIndex((x) => x.id === p.id) : -1;
    if (idx < 0) return listKey === 'menu' ? 'unknownMenu' : 'unknownIng';
    if (!isObj(p.patch)) { tx.info.key = 'patch'; return 'badPatch'; }
    const ks = Object.keys(p.patch);
    if (!ks.length || ks.length > 20) { tx.info.key = 'patch'; return 'badPatch'; }
    const cur = list[idx];
    const out = Object.assign({}, cur);
    const keys = [];
    const im = ingMap(tx.get('ingredients'));
    for (const k of ks) {
      const v = p.patch[k];
      const key = prefix + '.' + cur.id + '.' + k;
      if (!safeKey(k) || !hasOwn(schema, k)) { tx.info.key = key; return 'badPatch'; }
      // Each kind of field is checked its own way: text is cleaned and length-limited, the recipe list must
      // use known ingredients with no repeats, and other fields use the range rules.
      const spec = schema[k];
      let nv = v;
      if (spec.t === 'text') {
        if (typeof v !== 'string' || v.length > 400) { tx.info.key = key; return 'badPatch'; }
        nv = cleanText(v);
        if (!nv || nv.length > spec.max) { tx.info = { key, min: 1, max: spec.max }; return 'outOfBounds'; }
      } else if (spec.t === 'bom') {
        if (!Array.isArray(v) || v.length > 12) { tx.info.key = key; return 'badPatch'; }
        const seen = new Set();
        nv = [];
        for (const ln of v) {
          if (!isObj(ln) || typeof ln.ing !== 'string' || !im.has(ln.ing) || seen.has(ln.ing)) { tx.info.key = key; return 'badPatch'; }
          if (!isNum(ln.qty) || ln.qty <= 0 || ln.qty > 100000) { tx.info = { key, min: 0, max: 100000 }; return 'outOfBounds'; }
          seen.add(ln.ing);
          nv.push({ ing: ln.ing, qty: ln.qty });
        }
      } else {
        const e = checkLeaf(spec, v, key);
        if (e) { tx.info = { key: e.key, min: e.min, max: e.max }; return e.report; }
        if (k === 'prepSec') nv = Math.round(v);
      }
      if (JSON.stringify(cur[k]) !== JSON.stringify(nv)) { out[k] = nv; keys.push(key); }
    }
    if (!keys.length) return 'nothingToDo';
    const w = tx.mut(listKey);
    w[idx] = out;
    if (listKey === 'menu' && out.prepSec !== cur.prepSec) recomputeLearned(tx);
    tx.event('settings_changed', { keys });
    tx.info = { id: cur.id, keys };
    return 'ok';
  };
  // Edits a menu item (price, prep time, recipe, station, archived...) through patchEntity.
  A.updateMenuItem = (tx, p) => patchEntity(tx, p, 'menu', MENU_PATCH, 'menu');
  // Edits an ingredient (par, threshold, yield, cost...) through patchEntity.
  A.updateIngredient = (tx, p) => patchEntity(tx, p, 'ingredients', ING_PATCH, 'ingredients');
  // Adds a new dish. It needs a name, station, category, price, prep time and whether one tap or
  // start-then-finish makes it. The id is made from the name and never reuses an old one. The new dish has no
  // recipe yet, so stock is not tracked for it, and its prep time counts as confirmed because the owner typed it.
  A.addMenuItem = function (tx, p) {
    const list = tx.get('menu');
    if (list.length >= MENU_MAX) { tx.info = { key: 'menu', min: 0, max: MENU_MAX }; return 'outOfBounds'; }
    if (typeof p.name !== 'string' || p.name.length > 400) { tx.info.key = 'menu.new.name'; return 'badPatch'; }
    const name = cleanText(p.name);
    if (!name || name.length > MENU_PATCH.name.max) { tx.info = { key: 'menu.new.name', min: 1, max: MENU_PATCH.name.max }; return 'outOfBounds'; }
    if (list.some((x) => String(x.name).toLowerCase() === name.toLowerCase())) { tx.info.key = 'menu.new.name'; return 'badPatch'; }
    let short = name.slice(0, MENU_PATCH.short.max).trim();
    if (p.short !== undefined && p.short !== null && p.short !== '') {
      if (typeof p.short !== 'string' || p.short.length > 400) { tx.info.key = 'menu.new.short'; return 'badPatch'; }
      short = cleanText(p.short);
      if (!short || short.length > MENU_PATCH.short.max) { tx.info = { key: 'menu.new.short', min: 1, max: MENU_PATCH.short.max }; return 'outOfBounds'; }
    }
    for (const k of ['zone', 'cat', 'track', 'price', 'prepSec']) {
      const e = checkLeaf(MENU_PATCH[k], p[k], 'menu.new.' + k);
      if (e) { tx.info = { key: e.key, min: e.min, max: e.max }; return e.report; }
    }
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'dish';
    const taken = new Set(list.map((x) => x.id));
    let id = base, n = 2;
    while (taken.has(id) || hasOwn(C.menuById, id) || !safeKey(id)) id = base + '_' + n++;
    const w = tx.mut('menu');
    w.push({ id, name, short, zone: p.zone, cat: p.cat, price: p.price, prepSec: Math.round(p.prepSec), track: p.track, bom: [], prepConfirmed: true, archived: false });
    tx.event('settings_changed', { keys: ['menu.' + id + '.added'] });
    tx.info = { id, keys: ['menu.' + id + '.added'] };
    return 'ok';
  };

  // Clears tickets, batches, events and undo and restores starter stock. Keeps settings, menu, ingredients
  // and learned times unless keepSettings is false. The id counters are kept, so ids are never reused.
  A.resetLive = function (tx, p) {
    const keep = p.keepSettings == null ? true : p.keepSettings;
    if (typeof keep !== 'boolean') { tx.info.key = 'keepSettings'; return 'badPatch'; }
    const s = tx.s0;
    const ns = newState({
      now: tx.now, seq: s.seq,
      settings: keep ? s.settings : undefined, menu: keep ? s.menu : undefined, ingredients: keep ? s.ingredients : undefined, learned: keep ? s.learned : undefined,
    });
    for (const k of Object.keys(ns)) tx.set(k, ns[k]);
    tx.info = { keepSettings: keep };
    return 'ok';
  };

  // Logs a refused user action (for the line-friction page). Only known report ids are accepted.
  A.uiReport = function (tx, p) {
    if (typeof p.action !== 'string' || !p.action || p.action.length > 40 || typeof p.report !== 'string' || REPORT_IDS.indexOf(p.report) < 0) { tx.info.key = 'report'; return 'badPatch'; }
    tx.event('ui_report', { action: p.action, report: p.report });
    return 'ok';
  };

  /* ---------- undo (inverse data, not snapshots) ---------- */
  // Undoes the newest undo record if it is still inside the undo window (10 seconds). The undone action's
  // events stay in the log, marked reverted. Refuses with undoNothing, undoExpired, or undoConflict when
  // something changed since.
  A.undo = function (tx) {
    const stack = tx.get('undo') || [];
    if (!stack.length) return 'undoNothing';
    const e = stack[stack.length - 1];
    if (!isObj(e) || !hasOwn(UNDO, e.kind)) return 'undoNothing';
    if (!(tx.now <= e.expiresAt)) return 'undoExpired';
    const r = UNDO[e.kind](tx, e.data || {});
    if (r !== 'ok') { tx.info.label = e.label; return r; }
    const ns = stack.slice(0, -1);
    tx.set('undo', ns);
    markReverted(tx, e.eventIds || []);
    tx.restoreAvail = e.data && e.data.availBefore ? e.data.availBefore : null;
    tx.event('undo', { label: e.label });
    tx.info = Object.assign({ label: e.label }, tx.info);
    return 'ok';
  };
  // Marks the given events as reverted, in the recent window and in the archive, by writing flagged copies
  // (old ones are never edited).
  function markReverted(tx, ids) {
    if (!ids.length) return;
    const want = new Set(ids);
    const ev = tx.get('events');
    let w = null;
    for (let i = ev.length - 1; i >= 0 && want.size; i--) {
      if (want.has(ev[i].id)) { w = w || tx.mut('events'); w[i] = Object.assign({}, ev[i], { reverted: true }); want.delete(ev[i].id); }
    }
    if (!want.size) return;
    const ar = tx.get('eventArchive') || [];
    let wa = null;
    for (let c = ar.length - 1; c >= 0 && want.size; c--) {
      let chunk = null;
      for (let i = ar[c].length - 1; i >= 0 && want.size; i--) {
        const x = ar[c][i];
        if (want.has(x.id)) { chunk = chunk || ar[c].slice(); chunk[i] = Object.assign({}, x, { reverted: true }); want.delete(x.id); }
      }
      if (chunk) { wa = wa || tx.mut('eventArchive'); wa[c] = chunk; }
    }
  }
  // Undo for item changes. Every item must still have the status and time stamps it had after the action.
  // Puts back the old item, the stock it used and, if still unchanged, the learned prep time. Grams that
  // cannot go back (batch discarded or pruned) are booked as dropped and the result is marked partial.
  UNDO.items = function (tx, d) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, d.ticketId);
    if (ti < 0) return 'undoConflict';
    const t = tickets[ti];
    if (t.status !== 'active') return 'undoConflict';
    const recs = Array.isArray(d.items) ? d.items : [];
    const idx = [];
    for (const rec of recs) {
      const ii = findItemIdx(t, rec.itemId);
      if (ii < 0 || !isObj(rec.after) || !sameTimes(t.items[ii], rec.after)) return 'undoConflict';
      idx.push(ii);
    }
    let partial = false;
    for (let k = recs.length - 1; k >= 0; k--) {
      const cur = tx.get('tickets')[ti].items[idx[k]];
      if (cur.depleted && restoreInto(tx, cur.depleted)) partial = true;
      const items = tx.mutIn(tx.ticket(ti), 'items');
      items[idx[k]] = Object.assign({}, recs[k].before); /*@I13*/
      tx.own.add(items[idx[k]]);
    }
    const L = tx.get('learned');
    for (const lr of Array.isArray(d.learned) ? d.learned : []) {
      const cur = hasOwn(L, lr.menuId) ? L[lr.menuId] : null;
      const a = lr.after;
      if (cur && a && cur.n === a.n && cur.ema === a.ema) {
        const w = tx.mut('learned');
        if (lr.before) w[lr.menuId] = lr.before; else delete w[lr.menuId]; /*@I13L*/
      }
    }
    if (partial) tx.info.partial = true;
    return 'ok';
  };
  // Undo of a Start tap: puts the ticket back to waiting, with its items as they were, if nothing has been done on it since.
  UNDO.start = function (tx, d) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, d.ticketId);
    if (ti < 0) return 'undoConflict';
    const t = tickets[ti];
    if (t.status !== 'active' || t.startedAt !== d.startedAt) return 'undoConflict';
    // Only items the Start tap re-timed must still be untouched; items worked by hand before the Start keep their state.
    for (let ii = 0; ii < t.items.length; ii++) {
      const was = d.items[ii], cur = t.items[ii];
      if (!was || !cur) return 'undoConflict';
      if (was.status === 'queued' ? (cur.status !== 'queued' && cur.status !== 'displayed') : !sameTimes(cur, was)) return 'undoConflict';
    }
    const w = tx.ticket(ti);
    delete w.startedAt; w.awaitStart = true;
    const items = tx.mutIn(w, 'items');
    for (let ii = 0; ii < items.length; ii++) { items[ii] = Object.assign({}, d.items[ii]); tx.own.add(items[ii]); }
    return 'ok';
  };
  // Undo of a release: brings the ticket back and puts every item it finished back as it was (stock returns too).
  UNDO.release = function (tx, d) {
    const r = UNDO.bump(tx, d);
    if (r !== 'ok') return r;
    const w = tx.ticket(findTicketIdx(tx.get('tickets'), d.ticketId));
    if (!d.hadReleased) delete w.released;
    return UNDO.items(tx, { ticketId: d.ticketId, items: d.items, learned: [] });
  };
  // Undo of a bump: only if the ticket is still bumped at that same time.
  UNDO.bump = function (tx, d) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, d.ticketId);
    if (ti < 0 || tickets[ti].status !== 'expedited' || tickets[ti].expeditedAt !== d.expeditedAt) return 'undoConflict';
    const w = tx.ticket(ti);
    w.status = 'active'; delete w.expeditedAt; delete w.forced;
    return 'ok';
  };
  // Undo of a void: only if the ticket is still voided at that same time.
  UNDO.void = function (tx, d) {
    const tickets = tx.get('tickets');
    const ti = findTicketIdx(tickets, d.ticketId);
    if (ti < 0 || tickets[ti].status !== 'voided' || tickets[ti].voidedAt !== d.voidedAt) return 'undoConflict';
    // The order must still be open, or the food would come back onto a bill that was already settled or voided.
    if (tickets[ti].orderId) { const oj = findOrderIdx(tx.get('orders'), tickets[ti].orderId); if (oj >= 0 && tx.get('orders')[oj].status !== 'open') return 'undoConflict'; }
    const w = tx.ticket(ti);
    w.status = 'active'; delete w.voidedAt; delete w.voidReason;
    return 'ok';
  };
  // Undo of a manual 86 change: only if nobody changed that dish's 86 since.
  UNDO['86'] = function (tx, d) {
    const m = tx.get('manual86');
    const cur = hasOwn(m, d.menuId) ? m[d.menuId] : null;
    if (d.on ? !(cur && cur.since === d.since) : !!cur) return 'undoConflict';
    const w = tx.mut('manual86');
    if (d.before) w[d.menuId] = d.before; else delete w[d.menuId];
    return 'ok';
  };
  // Undo of a discard: puts the batch back as it was, then runs its gate again, because it may have expired
  // meanwhile (F-E4).
  UNDO.discard = function (tx, d) {
    const bs = tx.get('batches');
    const bi = findBatchIdx(bs, d.batchId);
    if (bi < 0 || bs[bi].status !== 'discard' || bs[bi].discardedAt !== d.discardedAt || !isObj(d.before)) return 'undoConflict';
    tx.mut('batches')[bi] = Object.assign({}, d.before);
    tx.own.add(tx.get('batches')[bi]);
    tx.batchTouched = true;
    refreshBatch(tx, bi);
    return 'ok';
  };
  // Undo of a hand pull: puts the grams back into the same batches. Grams whose batch is gone are booked as dropped.
  UNDO.pull = function (tx, d) {
    const recs = Array.isArray(d.recs) ? d.recs : [];
    restoreInto(tx, recs);
    const L = tx.ledger(d.ing);
    L.pulled = Math.max(0, (L.pulled || 0) - recs.reduce((a, r) => a + (r.g > 0 ? r.g : 0), 0));
    return 'ok';
  };
  // Undo of a put-off reminder: back to what it was.
  UNDO.snooze = function (tx, d) {
    const cur = tx.get('alertSnoozes') || {};
    const next = Object.assign({}, cur);
    if (isNum(d.before)) next[d.batchId] = d.before; else delete next[d.batchId];
    tx.own.add(next); tx.set('alertSnoozes', next);
    return 'ok';
  };
  // Undo of an ended put-off reminder: puts it back if it has not run out meanwhile.
  UNDO.unsnooze = function (tx, d) {
    if (!isNum(d.until) || d.until <= tx.now || findBatchIdx(tx.get('batches'), d.batchId) < 0) return 'undoConflict';
    const next = Object.assign({}, tx.get('alertSnoozes') || {}); next[d.batchId] = d.until;
    tx.own.add(next); tx.set('alertSnoozes', next);
    return 'ok';
  };
  // Undo of a planned batch: takes it out again, if it is still there.
  UNDO.plan = function (tx, d) {
    const cur = tx.get('planned') || [];
    if (!cur.some((e) => e.id === d.planId)) return 'undoConflict';
    const next = cur.filter((e) => e.id !== d.planId);
    tx.own.add(next); tx.set('planned', next);
    return 'ok';
  };
  // Undo of a cancelled plan: puts the entry back, if its id is free and it has not expired.
  UNDO.unplan = function (tx, d) {
    const cur = tx.get('planned') || [];
    const e = d.entry;
    if (!isObj(e) || cur.some((x) => x.id === e.id) || tx.now >= planExpiresAt(e)) return 'undoConflict';
    const entry = Object.assign({}, e);
    tx.own.add(entry);
    const next = cur.slice();
    next.splice(Math.max(0, Math.min(next.length, isInt(d.index) ? d.index : next.length)), 0, entry);
    tx.own.add(next); tx.set('planned', next);
    return 'ok';
  };
  // Undo of a sanitise log: only if it is still the latest one.
  UNDO.sanitize = function (tx, d) {
    const cur = tx.get('sanitize') || {};
    if (cur.lastAt !== d.afterLastAt) return 'undoConflict';
    tx.set('sanitize', Object.assign({}, d.before || {}));
    return 'ok';
  };

  /* ======================================================================================================
   * 12. Pruning
   * ==================================================================================================== */
  // When there are more tickets than max, drops the oldest finished ones (never active) to about 2 percent
  // under max. Their used grams move into the ledger so the books still balance (I2).
  function pruneTicketsInto(tx, max) {
    const arr = tx.get('tickets');
    if (!(arr.length > max)) return;
    const target = Math.max(0, max - Math.max(1, Math.floor(max * 0.02)));
    let drop = arr.length - target;
    const keep = [];
    for (const t of arr) {
      if (drop > 0 && t.status !== 'active') {
        drop--;
        for (const it of t.items) for (const r of it.depleted || []) if (r.g > 0) { const L = tx.ledger(r.ing); L.prunedUsed = (L.prunedUsed || 0) + r.g; }
        continue;
      }
      keep.push(t);
    }
    if (keep.length !== arr.length) { tx.own.add(keep); tx.ch.tickets = keep; tx.pruned = true; }
  }
  /** prune(state, { maxTickets?, maxEvents? }) -> state. Used by the store to fit storage quotas. Keeps I2 (ledger) whole. */
  function prune(state, lim) {
    if (!isState(state)) return state;
    lim = isObj(lim) ? lim : {};
    const tx = new Tx(state, 0);
    if (isInt(lim.maxTickets) && lim.maxTickets >= 0) { pruneTicketsInto(tx, lim.maxTickets); pruneOrdersInto(tx, lim.maxTickets); }
    if (isInt(lim.maxEvents) && lim.maxEvents >= 0) {
      let flat = allEvents(state);
      if (flat.length > lim.maxEvents) {
        flat = flat.slice(flat.length - lim.maxEvents);
        const ar = [];
        while (flat.length >= 2 * EVENT_CHUNK) { ar.push(flat.slice(0, EVENT_CHUNK)); flat = flat.slice(EVENT_CHUNK); }
        tx.set('eventArchive', ar); tx.set('events', flat);
      }
    }
    return tx.dirty() ? tx.commit() : state;
  }

  /* ======================================================================================================
   * 13. tick and apply
   * ==================================================================================================== */
  const DUE = new WeakMap();
  // Finds the next moment anything needs doing: the earliest on-deck fire time or channel confirmation
  // (fs), and the earliest batch status deadline (bd). Remembered per state, so tick is quick when nothing
  // is due.
  function nextDue(state) {
    let d = DUE.get(state);
    if (d) return d;
    let fs = Infinity, bd = Infinity;
    const tickets = state.tickets;
    for (const ti of activeIdx(tickets)) {
      if (tickets[ti].awaitStart) continue;
      const items = tickets[ti].items;
      for (let i = 0; i < items.length; i++) if (items[i].status === 'queued' && items[i].fireAt < fs) fs = items[i].fireAt;
    }
    for (const sy of state.syncs) for (const t of C.syncTargets) { const x = sy.targets[t.id]; if (x && x.doneAt == null && x.dueAt < fs) fs = x.dueAt; }
    for (const e of state.planned || []) { const x = planExpiresAt(e); if (x < fs) fs = x; }
    for (const k of Object.keys(state.alertSnoozes || {})) if (state.alertSnoozes[k] < fs) fs = state.alertSnoozes[k];
    const S = safetyOf(state.settings);
    for (const b of state.batches) if (b.status !== 'discard' && (b.remainingG > 0 || b.kind === 'cooling')) { const x = statusDeadline(b, S); if (x < bd) bd = x; }
    d = { fs, bd };
    DUE.set(state, d);
    return d;
  }
  // Does what time has made due: fires on-deck items at their exact planned time, completes due channel
  // confirmations, and re-checks batches whose deadline has passed.
  function tickInto(tx) {
    const now = tx.now;
    const s = tx.s0;
    const tickets = s.tickets;
    for (const ti of activeIdx(tickets)) {
      const t = tickets[ti];
      if (t.awaitStart) continue; // waiting for the Start tap: nothing fires yet
      for (let ii = 0; ii < t.items.length; ii++) {
        const it = t.items[ii];
        if (it.status === 'queued' && it.fireAt <= now) {
          const w = tx.item(ti, ii);
          w.status = 'displayed'; w.firedAt = it.fireAt; // exactly the planned time, at any clock speed
          tx.event('item_fired', { ticketId: t.id, itemId: it.id, zone: it.zone, menuId: it.menuId, at: it.fireAt });
        }
      }
    }
    const syncs = s.syncs;
    for (let i = 0; i < syncs.length; i++) {
      const sy = syncs[i];
      let w = null;
      for (const tg of C.syncTargets) {
        const x = sy.targets[tg.id];
        if (!x || x.doneAt != null || !(x.dueAt <= now)) continue;
        if (!w) { w = tx.mutIn(tx.mut('syncs'), i); w.targets = Object.assign({}, sy.targets); }
        w.targets[tg.id] = { dueAt: x.dueAt, doneAt: x.dueAt };
        tx.event('sync_done', { syncId: sy.id, menuId: sy.menuId, target: tg.id, latencyMs: x.dueAt - (isNum(sy.holdUntil) ? sy.holdUntil : sy.t) });
      }
    }
    const pl = s.planned || [];
    if (pl.some((e) => now >= planExpiresAt(e))) {
      const keep = pl.filter((e) => now < planExpiresAt(e));
      for (const e of pl) if (now >= planExpiresAt(e)) tx.event('plan_expired', { planId: e.id, ing: e.ing });
      tx.own.add(keep); tx.set('planned', keep);
    }
    const sn = s.alertSnoozes || {};
    const snIds = Object.keys(sn);
    if (snIds.length) {
      const live = new Set(s.batches.filter((b) => b.status !== 'discard' && b.remainingG > 0).map((b) => b.id));
      const keepS = {}; let dropped = false;
      for (const id of snIds) if (sn[id] > now && live.has(id)) keepS[id] = sn[id]; else dropped = true;
      if (dropped) { tx.own.add(keepS); tx.set('alertSnoozes', keepS); }
    }
    const S = safetyOf(s.settings);
    const bs = s.batches;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.status === 'discard' || !(b.remainingG > 0 || b.kind === 'cooling')) continue;
      if (now > statusDeadline(b, S)) refreshBatch(tx, i);
    }
  }
  /** A ticket that becomes active again (recall, undo of bump/void) may hold queued items whose plan time passed while it was
   *  off the board: they fire now, the moment the station can see them (found by the fuzz test, see docs/findings.md F-E3). */
  function fireDueInto(tx) {
    const tickets = tx.get('tickets');
    const idx = tx.pruned ? activeIdx(tickets) : Array.from(tx.touched);
    for (const ti of idx) {
      const t = tickets[ti];
      if (!t || t.status !== 'active' || t.awaitStart) continue;
      for (let ii = 0; ii < t.items.length; ii++) {
        const it = t.items[ii];
        if (it.status !== 'queued' || !(it.fireAt <= tx.now)) continue;
        const w = tx.item(ti, ii);
        w.status = 'displayed'; w.firedAt = stampAfter(it.fireAt, tx.now);
        tx.event('item_fired', { ticketId: t.id, itemId: it.id, zone: it.zone, menuId: it.menuId, late: true, at: w.firedAt });
      }
    }
  }
  // Last steps of every transaction: fire due items on tickets that came back, recompute availability if
  // its inputs changed, and for actions raise rev and store the undo record. The undo record keeps the
  // availability it replaced, so undo can restore it. At most 20 undo records are kept and expired ones are
  // dropped.
  function finalize(tx, isAction) {
    let changedIds = [], prev = null;
    if (isAction && (tx.touched.size || tx.pruned)) fireDueInto(tx);
    if (availInputsChanged(tx) || tx.restoreAvail) { const r = refreshAvail(tx); changedIds = r.changedIds; prev = r.prev; }
    if (isAction) {
      tx.set('rev', (isInt(tx.s0.rev) ? tx.s0.rev : 0) + 1);
      if (tx.undoEntry) {
        const S = tx.get('settings');
        const e = tx.undoEntry;
        if (changedIds.length) { e.data.availBefore = {}; for (const id of changedIds) e.data.availBefore[id] = prev[id]; }
        const old = tx.get('undo') || [];
        const keep = old.filter((u) => isObj(u) && u.expiresAt >= tx.now);
        while (keep.length >= MAX_UNDO) keep.shift();
        keep.push({ id: 'u_' + tx.next('undo'), label: e.label, at: tx.now, expiresAt: tx.now + (isNum(S.undoMs) ? S.undoMs : C.undoMs), kind: e.kind, data: e.data, eventIds: tx.evs.map((x) => x.id) });
        tx.set('undo', keep);
        tx.info.undo = e.label;
      }
    }
  }
  // Quick shape check that a value looks like a Smokebox state (the main lists and records exist).
  function isState(s) {
    return isObj(s) && Array.isArray(s.tickets) && Array.isArray(s.batches) && Array.isArray(s.events) && Array.isArray(s.menu) &&
      Array.isArray(s.ingredients) && Array.isArray(s.syncs) && isObj(s.settings) && isObj(s.stock) && isObj(s.avail);
  }
  /** tick(state, now) -> { state, events }. Same reference when nothing is due (O(1) via a memoised deadline). */
  function tick(state, now) {
    if (!isState(state) || !isNum(now)) return { state, events: [] };
    const due = nextDue(state);
    if (now < due.fs && !(now > due.bd)) return { state, events: [] };
    const tx = new Tx(state, now);
    tickInto(tx);
    if (!tx.dirty()) return { state, events: [] };
    finalize(tx, false);
    return { state: tx.commit(), events: tx.evs };
  }
  /** apply(state, type, payload, now) -> { state, report, events, info }. Total: never throws; non-ok returns the SAME state. */
  // WATCH OUT: a refused action returns the original state, not the ticked one (F-E6).
  function apply(state, type, payload, now) {
    try {
      if (!isState(state)) return { state, report: 'invalidBackup', events: [], info: {} };
      if (typeof type !== 'string' || !hasOwn(A, type)) return { state, report: 'unknownAction', events: [], info: {} };
      if (!isNum(now)) return { state, report: 'badPatch', events: [], info: { key: 'now' } };
      const p = isObj(payload) ? payload : {};
      // A state saved before orders existed has no orders list; the new state gets an empty one.
      const base = Array.isArray(state.orders) ? state : Object.assign({}, state, { orders: [] });
      const t1 = tick(base, now); // catch up first so the action sees the kitchen as it is at `now`
      const tx = new Tx(t1.state, now);
      const report = A[type](tx, p);
      if (report !== 'ok') {
        if (REPORT_IDS.indexOf(report) < 0) return { state, report: 'badPatch', events: [], info: { internalError: 'bad report ' + report } };
        return { state, report, events: [], info: tx.info };
      }
      finalize(tx, true);
      const out = tx.commit();
      return { state: out, report: 'ok', events: t1.events.length ? t1.events.concat(tx.evs) : tx.evs, info: tx.info };
    } catch (err) {
      return { state, report: 'badPatch', events: [], info: { internalError: String((err && err.stack) || err) } };
    }
  }

  /* ======================================================================================================
   * 14. newState
   * ==================================================================================================== */
  // Builds a fresh state: starter stock and one starter batch per TCS ingredient (155 F hot, 38 F cold)
  // unless empty is true. The ledger opens at that stock. Sanitising is due at once, because nobody knows
  // when it was last done. The options let a reset keep settings, menu, ingredients, learned times and id
  // counters.
  function newState(opts) {
    opts = isObj(opts) ? opts : {};
    const now = isNum(opts.now) ? opts.now : 0;
    const settings = isObj(opts.settings) ? opts.settings : defaultSettings();
    const menu = Array.isArray(opts.menu) ? opts.menu : C.menu.map((m) => Object.assign({}, m, { bom: m.bom.map((l) => ({ ing: l.ing, qty: l.qty })), prepConfirmed: false, archived: false }));
    const ingredients = Array.isArray(opts.ingredients) ? opts.ingredients : C.ingredients.map((i) => Object.assign({}, i));
    const so = isObj(opts.seq) ? opts.seq : {};
    const seq = { ticket: isInt(so.ticket) ? so.ticket : 0, order: isInt(so.order) ? so.order : 0, batch: isInt(so.batch) ? so.batch : 0, event: isInt(so.event) ? so.event : 0, sync: isInt(so.sync) ? so.sync : 0, undo: isInt(so.undo) ? so.undo : 0, byDate: {} };
    const stock = {}, ledger = {}, batches = [];
    const S = safetyOf(settings);
    // One ledger entry per ingredient. Plain ingredients start at par stock; TCS ones start as a batch
    // (below).
    for (const ing of ingredients) {
      ledger[ing.id] = { open: 0, in: 0, pulled: 0, prunedUsed: 0, prunedWaste: 0, prunedRemain: 0, dropped: 0 };
      if (!ing.tcs) { stock[ing.id] = opts.empty ? 0 : isNum(ing.parG) && ing.parG > 0 ? ing.parG : 0; ledger[ing.id].open = stock[ing.id]; continue; }
      if (opts.empty || !(ing.parG > 0)) continue;
      // starter batches: labelled src 'starter' (demo opening stock) with a starter reading so the line can open
      const hot = ing.hold !== 'cold';
      const f = hot ? 155 : 38;
      const ty = ing.thermal ? thermalYield({ costPerKgRaw: ing.costPerKg }) : null;
      // With stagger on, each starter batch is already some time old (config) and its last reading was at most 40 minutes ago.
      const age = opts.stagger === true && isNum(C.starterAgeMin[ing.id]) ? C.starterAgeMin[ing.id] * MIN : 0;
      const readAt = now - Math.min(age, 40 * MIN);
      const b = {
        id: 'b_' + ++seq.batch, ing: ing.id, label: ing.name + ' batch 1', kind: hot ? 'hot' : 'cold', enteredAt: now - age, cookedG: ing.parG, remainingG: ing.parG,
        costPerCookedKg: round(nominalUnitCost(ing) * 1000, 4), src: 'starter', temps: [{ t: readAt, f }], lastTempF: f, lastTempAt: readAt, reheats: 0,
        maxHoldH: isNum(ing.maxHoldH) ? ing.maxHoldH : S.defaultMaxHoldH, holdBasis: ing.holdBasis === 'safety' ? 'safety' : 'quality', status: 'ok', action: 'NONE', canServe: true,
      };
      if (ty) b.yieldPct = ty.hotPct; else if (isNum(ing.yield)) b.yieldPct = round(ing.yield * 100, 2);
      batches.push(b);
      ledger[ing.id].open = ing.parG;
    }
    // The whole state. The clock is not stored here; the store keeps it.
    const st = {
      v: 1, rev: 0, settings, menu, ingredients, tickets: [], orders: [], batches, stock, manual86: {}, avail: {}, syncs: [], planned: [], alertSnoozes: {},
      learned: isObj(opts.learned) ? opts.learned : {}, sanitize: { dueAt: now }, seq, events: [], eventArchive: [], undo: [], ledger,
    };
    const av = computeAvail(st);
    for (const k of Object.keys(av)) av[k].since = now;
    st.avail = av;
    return st;
  }

  /* ======================================================================================================
   * 15. Derived views (pure; SB.store.select memoises them per state)
   * ==================================================================================================== */
  // All-day count: for each dish on active tickets, how many are still required and how many are on deck,
  // shown, cooking or done. Optional station filter. Sorted by most required, then name.
  function allDay(state, zone) {
    if (!isState(state)) return [];
    const z = typeof zone === 'string' && zone !== 'all' && zone !== 'expo' ? zone : null;
    const map = new Map();
    const tickets = state.tickets;
    for (const ti of activeIdx(tickets)) {
      for (const it of tickets[ti].items) {
        if (z && it.zone !== z) continue;
        let e = map.get(it.menuId);
        if (!e) {
          const mi = getMenu(state.menu, it.menuId);
          e = { menuId: it.menuId, name: mi ? mi.name : it.name, short: mi ? mi.short : it.short || it.name, zone: it.zone, required: 0, total: 0, queued: 0, displayed: 0, cooking: 0, done: 0, zoneBreakdown: {} };
          map.set(it.menuId, e);
        }
        e.total += it.qty;
        e[it.status] = (e[it.status] || 0) + it.qty;
        if (it.status !== 'done') { e.required += it.qty; e.zoneBreakdown[it.zone] = (e.zoneBreakdown[it.zone] || 0) + it.qty; }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.required - a.required || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  // How long a ticket has taken (or is taking) and whether that is ok, warn or breach for its channel. A
  // bumped or voided ticket stops at that time. pct is elapsed over breach, from 0 to 1.
  function ticketTiming(ticket, now, settings) {
    const th = channelThresholds(settings, ticket && ticket.channel);
    const warnMs = th.warnSec * 1000, breachMs = th.breachSec * 1000;
    if (!ticket || !isNum(ticket.createdAt)) return { elapsedMs: 0, level: 'ok', warnMs, breachMs, pct: 0 };
    const end = isNum(ticket.expeditedAt) ? ticket.expeditedAt : isNum(ticket.voidedAt) ? ticket.voidedAt : now;
    const elapsedMs = isNum(end) ? Math.max(0, end - ticket.createdAt) : 0;
    const level = elapsedMs >= breachMs ? 'breach' : elapsedMs >= warnMs ? 'warn' : 'ok';
    return { elapsedMs, level, warnMs, breachMs, pct: clamp(elapsedMs / breachMs, 0, 1) };
  }
  // Counts a ticket's items by status, plus quantities done, percent done and per-station totals. ready is
  // true when every item is done.
  function ticketProgress(ticket) {
    const r = { total: 0, done: 0, queued: 0, displayed: 0, cooking: 0, qtyTotal: 0, qtyDone: 0, pct: 0, ready: false, byZone: {} };
    if (!ticket || !Array.isArray(ticket.items)) return r;
    for (const it of ticket.items) {
      r.total++; r.qtyTotal += it.qty || 0;
      if (hasOwn(ITEM_STATUS, it.status)) r[it.status]++;
      if (it.status === 'done') r.qtyDone += it.qty || 0;
      const z = r.byZone[it.zone] || (r.byZone[it.zone] = { total: 0, done: 0 });
      z.total++; if (it.status === 'done') z.done++;
    }
    r.pct = r.total ? r.done / r.total : 0;
    r.ready = r.total > 0 && r.done === r.total;
    return r;
  }
  // Board order for tickets: rush first, then oldest, then by ticket number.
  const sortSlips = (a, b) => (b.rush ? 1 : 0) - (a.rush ? 1 : 0) || a.createdAt - b.createdAt || tSeq(a.id) - tSeq(b.id);
  const views = {
    // Active tickets in board order (rush first, then oldest).
    activeTickets(state) { return isState(state) ? activeIdx(state.tickets).map((i) => state.tickets[i]).sort(sortSlips) : []; },
    // Expo sees the same whole tickets as the active list.
    expoTickets(state) { return views.activeTickets(state); },
    /** Tickets with >= 1 not-done item in `zone`, each reduced to that zone: items (displayed+cooking), onDeckItems (queued), onDeck count. */
    ticketsForZone(state, zone) {
      if (!isState(state)) return [];
      if (zone == null || zone === 'all' || zone === 'expo') return views.activeTickets(state);
      const out = [];
      for (const t of views.activeTickets(state)) {
        const vis = [], deck = [];
        let doneHere = 0;
        for (const it of t.items) {
          if (it.zone !== zone) continue;
          if (it.status === 'done') doneHere++; else if (it.status === 'queued') deck.push(it); else vis.push(it);
        }
        if (!vis.length && !deck.length) continue;
        out.push(Object.assign({}, t, { items: vis, onDeckItems: deck, onDeck: deck.length, doneHere, allItems: t.items, zone }));
      }
      return out;
    },
    // Bumped tickets, newest first; n limits how many.
    recent(state, n) {
      if (!isState(state)) return [];
      const out = [];
      for (let i = state.tickets.length - 1; i >= 0; i--) if (state.tickets[i].status === 'expedited') out.push(state.tickets[i]);
      out.sort((a, b) => b.expeditedAt - a.expeditedAt);
      return isInt(n) && n >= 0 ? out.slice(0, n) : out;
    },
    // Voided tickets, newest first; n limits how many.
    voided(state, n) {
      if (!isState(state)) return [];
      const out = state.tickets.filter((t) => t.status === 'voided').sort((a, b) => b.voidedAt - a.voidedAt);
      return isInt(n) && n >= 0 ? out.slice(0, n) : out;
    },
    // Dishes that are 86 right now (not archived), with the reason and since when.
    unavailable(state) {
      if (!isState(state)) return [];
      const out = [];
      for (const mi of state.menu) { const a = state.avail[mi.id]; if (a && !a.ok && !mi.archived) out.push({ menuId: mi.id, name: mi.name, short: mi.short, reason: a.reason, ing: a.ing, since: a.since }); }
      return out;
    },
    // Cabinet batches, each with its live gate result. Discarded ones are left out unless opts.all is true.
    batches(state, now, opts) {
      if (!isState(state)) return [];
      const all = !!(opts && opts.all);
      const S = safetyOf(state.settings);
      const out = [];
      for (const b of state.batches) if (all || b.status !== 'discard') out.push(Object.assign({}, b, { gate: gate(b, now, S) }));
      return out;
    },
    // Numbers for the header badges: tickets, ready, overdue and warn counts, per-station counts, batches
    // needing attention, dishes 86, and whether sanitising is overdue.
    counts(state, now) {
      const c = { all: 0, expo: 0, ready: 0, overdue: 0, warn: 0, zones: {}, overdueByZone: {}, hold: 0, holdWhy: { check: 0, reheat: 0, chill: 0, past: 0, discard: 0 }, out86: 0, sanitizeDueAt: undefined, sanitizeOverdue: false };
      for (const z of C.workZones) { c.zones[z] = 0; c.overdueByZone[z] = 0; }
      if (!isState(state)) return c;
      for (const t of views.activeTickets(state)) {
        c.all++; c.expo++;
        const tm = ticketTiming(t, now, state.settings);
        if (tm.level === 'breach') c.overdue++; else if (tm.level === 'warn') c.warn++;
        const seen = {};
        let allDone = true;
        for (const it of t.items) {
          if (it.status === 'done') continue;
          allDone = false;
          if (!seen[it.zone] && hasOwn(c.zones, it.zone)) { seen[it.zone] = 1; c.zones[it.zone]++; if (tm.level === 'breach') c.overdueByZone[it.zone]++; }
        }
        if (allDone) c.ready++;
      }
      const S = safetyOf(state.settings);
      for (const b of state.batches) {
        if (b.status === 'discard' || !(b.remainingG > 0)) continue;
        const gt = gate(b, now, S);
        if (gt.action !== 'NONE') {
          c.hold++;
          const why = gt.action === 'CHECK_TEMP' ? 'check' : gt.action === 'REHEAT_IMMEDIATE' ? 'reheat' : gt.action === 'CHILL_NOW' ? 'chill' : gt.action === 'PAST_QUALITY' ? 'past' : 'discard';
          c.holdWhy[why]++;
        }
      }
      for (const mi of state.menu) { const a = state.avail[mi.id]; if (a && !a.ok && !mi.archived) c.out86++; }
      const sz = state.sanitize || {};
      const dueEff = sanitizeDueEff(state.settings, sz, now);
      c.sanitizeDueAt = dueEff;
      c.sanitizeOverdue = isNum(dueEff) && isNum(now) && now > dueEff;
      return c;
    },
  };

  /* ======================================================================================================
   * 16. Invariants (SPEC 10). Returns human-readable violations; [] = healthy.
   * ==================================================================================================== */
  // The books check (I2): for each ingredient, opening plus intakes minus used, waste, pruned and dropped
  // grams must equal what is physically in stock or the cabinet (within 0.5 g). Returns the ingredients
  // that do not balance.
  function ledgerCheck(state) {
    const used = Object.create(null), waste = Object.create(null), phys = Object.create(null);
    for (const t of state.tickets) for (const it of t.items) for (const r of it.depleted || []) if (r.g > 0) used[r.ing] = (used[r.ing] || 0) + r.g;
    for (const b of state.batches) {
      phys[b.ing] = (phys[b.ing] || 0) + (b.remainingG > 0 ? b.remainingG : 0);
      if (b.wasteG > 0) waste[b.ing] = (waste[b.ing] || 0) + b.wasteG;
    }
    const out = [];
    for (const ing of state.ingredients) {
      const L = state.ledger && hasOwn(state.ledger, ing.id) ? state.ledger[ing.id] : {};
      // Reads one ledger counter; a missing or bad number counts as 0.
      const n = (k) => (isNum(L[k]) ? L[k] : 0);
      const have = ing.tcs ? phys[ing.id] || 0 : hasOwn(state.stock, ing.id) && isNum(state.stock[ing.id]) ? state.stock[ing.id] : 0;
      const expect = n('open') + n('in') - (used[ing.id] || 0) - n('pulled') - n('prunedUsed') - (waste[ing.id] || 0) - n('prunedWaste') - n('prunedRemain') - n('dropped');
      if (Math.abs(expect - have) > 0.5) out.push({ ing: ing.id, expect, have });
    }
    return out;
  }
  /** Per-ticket invariants I3, I4, I5, I6, I11 (also used by validateBackup to drop unrepairable rows). */
  function ticketViolations(t, now, add) {
    if (!hasOwn(TICKET_STATUS, t.status)) add('ticket ' + t.id + ' bad status ' + t.status);
    if (!Array.isArray(t.items) || !t.items.length) { add('ticket ' + t.id + ' has no items'); return; }
    let maxDone = -Infinity, allDone = true;
    for (const it of t.items) {
      if (!hasOwn(ITEM_STATUS, it.status)) add('item ' + it.id + ' bad status ' + it.status);
      const q = it.status === 'queued';
      if (q === (it.firedAt !== undefined)) add('I3 ' + it.id + ' firedAt defined iff not queued (status ' + it.status + ')');
      if ((it.status === 'done') !== (it.doneAt !== undefined)) add('I3 ' + it.id + ' doneAt defined iff done');
      if (it.startedAt !== undefined && (it.track !== 'two' || (it.status !== 'cooking' && it.status !== 'done'))) add('I3 ' + it.id + ' startedAt on a ' + it.track + '/' + it.status + ' item');
      if (it.status === 'cooking' && it.startedAt === undefined) add('I3 ' + it.id + ' cooking without startedAt');
      let last = t.createdAt;
      for (const k of ['firedAt', 'startedAt', 'doneAt']) {
        if (it[k] === undefined) continue;
        if (!isNum(it[k]) || it[k] < last) add('I3 ' + it.id + ' ' + k + ' out of order');
        else last = it[k];
      }
      if (it.status !== 'done') allDone = false; else if (it.doneAt > maxDone) maxDone = it.doneAt;
      // I5
      const want = it.rushed || !(t.dmaxSec > 0) ? 0 : t.dmaxSec - it.prepSec;
      if (it.offsetSec !== want) add('I5 ' + it.id + ' offsetSec ' + it.offsetSec + ' != ' + want);
      if (!(it.offsetSec >= 0 && it.offsetSec <= (t.dmaxSec || 0))) add('I5 ' + it.id + ' offset outside [0, dmax]');
      // Items re-timed by the Start tap count their plan from the start moment, not from creation.
      const base = it.rebased && isNum(t.startedAt) ? t.startedAt : t.createdAt;
      if (it.fireAt !== base + it.offsetSec * 1000) add('I5 ' + it.id + ' fireAt != plan start + offset');
      if (isNum(now) && t.status === 'active' && !t.awaitStart && it.status === 'queued' && it.fireAt <= now) add('I5 ' + it.id + ' due but still queued');
      // I6
      if (C.workZones.indexOf(it.zone) < 0) add('I6 ' + it.id + ' routed to ' + it.zone);
    }
    // I4
    if (t.status === 'expedited') {
      if (!isNum(t.expeditedAt)) add('I4 ' + t.id + ' expedited without expeditedAt');
      else if (maxDone > t.expeditedAt) add('I4 ' + t.id + ' expeditedAt before last doneAt');
      if (!t.forced && !allDone) add('I4 ' + t.id + ' expedited (not forced) with undone items');
    } else if (t.expeditedAt !== undefined) add('I4 ' + t.id + ' ' + t.status + ' with expeditedAt');
    // I11
    if (t.status === 'voided' && !(typeof t.voidReason === 'string' && t.voidReason.trim())) add('I11 ' + t.id + ' voided without reason');
    if (!isInt(t.recalls) || t.recalls < 0) add('I11 ' + t.id + ' recalls = ' + t.recalls);
  }
  // Runs every rule I1 to I16 and returns plain-English complaints (empty list = healthy), at most 60. The
  // time-based checks (due items, batch status) run only when now is given.
  function checkInvariants(state, now) {
    const v = [];
    // Records one complaint, keeping at most 60 so the list stays readable.
    const add = (s) => { if (v.length < 60) v.push(s); };
    if (!isState(state)) return ['state: not a Smokebox state'];
    const P = state.settings.pacing || C.pacing;
    // I1
    for (const k of Object.keys(state.stock)) if (!isNum(state.stock[k]) || state.stock[k] < 0) add('I1 stock ' + k + ' = ' + state.stock[k]);
    for (const b of state.batches) if (!isNum(b.remainingG) || b.remainingG < 0) add('I1 batch ' + b.id + ' remainingG = ' + b.remainingG);
    // I2
    for (const x of ledgerCheck(state)) add('I2 ledger ' + x.ing + ': expected ' + round(x.expect, 3) + ' g, have ' + round(x.have, 3) + ' g');
    // I3-I6, I10, I11
    const ids = new Set(), itemIds = new Set(), nums = new Set();
    for (const t of state.tickets) {
      if (ids.has(t.id)) add('I10 duplicate ticket id ' + t.id); ids.add(t.id);
      const nk = t.serviceDate + '#' + t.num;
      if (nums.has(nk)) add('I10 duplicate num ' + nk); nums.add(nk);
      if (Array.isArray(t.items)) for (const it of t.items) { if (itemIds.has(it.id)) add('I10 duplicate item id ' + it.id); itemIds.add(it.id); }
      ticketViolations(t, now, add);
      const n = tSeq(t.id);
      if (n === n && !(state.seq.ticket >= n)) add('seq.ticket behind ' + t.id);
    }
    // I16: orders. Ids are unique, a paid order has a method and totals that add up, only paid orders carry payment
    // fields, and every ticket's round is unique inside its order. A live ticket must have its order, and a voided
    // order holds no live food.
    const orderById = new Map();
    for (const o of Array.isArray(state.orders) ? state.orders : []) {
      if (orderById.has(o.id)) add('I16 duplicate order id ' + o.id);
      orderById.set(o.id, o);
      const on = oSeq(o.id);
      if (on === on && !(state.seq.order >= on)) add('I16 seq.order behind ' + o.id);
      if (!hasOwn(ORDER_STATUS, o.status)) { add('I16 ' + o.id + ' bad status ' + o.status); continue; }
      if (o.status === 'paid') {
        const T = o.totals;
        if (!hasOwn(C.payMethodById, o.method)) add('I16 ' + o.id + ' paid without a valid method');
        else if (!isObj(T) || !['subtotal', 'discount', 'tax', 'total'].every((k) => isNum(T[k]) && T[k] >= 0)) add('I16 ' + o.id + ' paid without totals');
        else if (T.discount > T.subtotal + 1e-9 || Math.abs(T.total - cents(cents(T.subtotal - T.discount) + T.tax)) > 0.006) add('I16 ' + o.id + ' totals do not add up');
        if (!isNum(o.paidAt) || o.paidAt < o.createdAt) add('I16 ' + o.id + ' paidAt before createdAt');
        if (!isNum(o.tip) || o.tip < 0) add('I16 ' + o.id + ' tip ' + o.tip);
      } else if (o.paidAt !== undefined || o.totals !== undefined || o.method !== undefined) add('I16 ' + o.id + ' ' + o.status + ' with payment fields');
      if (o.status === 'voided' && !(typeof o.voidReason === 'string' && o.voidReason.trim())) add('I16 ' + o.id + ' voided without reason');
    }
    const roundSeen = new Set();
    for (const t of state.tickets) {
      if (t.orderId === undefined) continue;
      const o = orderById.get(t.orderId);
      if (!o) { if (t.status === 'active') add('I16 live ' + t.id + ' on missing order ' + t.orderId); continue; }
      if (!isInt(t.round) || t.round < 1 || t.round > o.rounds) add('I16 ' + t.id + ' round ' + t.round + ' outside order ' + o.id);
      const rk = t.orderId + '#' + t.round;
      if (roundSeen.has(rk)) add('I16 duplicate round ' + rk); roundSeen.add(rk);
      if (o.status === 'voided' && t.status !== 'voided') add('I16 voided order ' + o.id + ' holds live ' + t.id);
    }
    // I8
    const S = safetyOf(state.settings);
    for (const b of state.batches) {
      if (b.status === 'discard' && (b.canServe !== false || b.remainingG !== 0)) add('I8 ' + b.id + ' discarded but servable or not empty');
      if (!hasOwn(BATCH_STATUS, b.status) || !hasOwn(BATCH_KIND, b.kind)) add('batch ' + b.id + ' bad status/kind');
      if (b.kind === 'cooling' && b.canServe) add('I8 ' + b.id + ' cooling batch servable');
      if (isNum(now) && b.status !== 'discard' && (b.remainingG > 0 || b.kind === 'cooling')) {
        const gt = gate(b, now, S);
        if (gt.status !== b.status || gt.canServe !== b.canServe) add('I8 ' + b.id + ' stored ' + b.status + '/' + b.canServe + ' but gate says ' + gt.status + '/' + gt.canServe);
      }
    }
    // I9
    let lt = -Infinity;
    for (const e of allEvents(state)) { if (!(e.t >= lt)) { add('I9 event ' + e.id + ' t goes backwards'); break; } lt = e.t; }
    // I14
    const mm = menuMap(state.menu);
    for (const id of Object.keys(state.learned || {})) {
      const l = state.learned[id], mi = mm.get(id);
      if (!mi) { add('I14 learned for unknown ' + id); continue; }
      if (!(l.est >= P.minFactor * mi.prepSec - 1e-9 && l.est <= P.maxFactor * mi.prepSec + 1e-9)) add('I14 ' + id + ' est ' + l.est + ' outside bounds');
    }
    // I15
    const fresh = computeAvail(state);
    for (const id of Object.keys(fresh)) {
      const a = state.avail[id], f = fresh[id];
      if (!a || a.ok !== f.ok || a.reason !== f.reason || a.ing !== f.ing) add('I15 avail ' + id + ' stored ' + JSON.stringify(a && { ok: a.ok, reason: a.reason, ing: a.ing }) + ' recomputed ' + JSON.stringify(f));
    }
    for (const id of Object.keys(state.avail)) if (!hasOwn(fresh, id)) add('I15 avail has stale key ' + id);
    return v;
  }

  /* ======================================================================================================
   * 17. Backups: validateBackup (repairs what it can, refuses the rest), serialize/deserialize
   * ==================================================================================================== */
  // Reads a backup (text or object) and returns { ok, state, repaired } or { ok: false, error }. It repairs
  // what it safely can, field by field (out-of-range settings go back to defaults, bad rows are dropped,
  // negative stock becomes 0, unsafe ids are removed, a ledger that does not balance is re-opened at
  // today's stock) and refuses what it cannot fix. Never throws and never changes its input.
  // WATCH OUT: the repaired result must pass checkInvariants, otherwise the whole backup is refused.
  function validateBackup(input) {
    const repaired = [];
    // Builds the refusal answer, carrying the repairs listed so far.
    const fail = (error) => ({ ok: false, error, repaired });
    try {
      let obj = input;
      if (typeof obj === 'string') {
        if (obj.length > MAX_BACKUP_CHARS) return fail('too large');
        try { obj = JSON.parse(obj); } catch (e) { return fail('not JSON'); }
      }
      if (!isObj(obj)) return fail('not an object');
      const st = isObj(obj.state) ? obj.state : obj;
      if (st.v !== 1) return fail('unsupported version ' + st.v);
      for (const k of ['tickets', 'batches', 'menu', 'ingredients']) if (!Array.isArray(st[k])) return fail('missing ' + k);
      const def = newState({ now: 0, empty: true });
      // settings
      const settings = defaultSettings();
      const savedSet = isObj(st.settings) ? st.settings : {};
      // Saves from before the 2-hour check default still say 30 minutes. Move those to the new default once;
      // any other value was chosen by the owner and stays.
      if (isObj(savedSet.safety) && !hasOwn(savedSet.safety, 'tempIntervalV2') && savedSet.safety.tempCheckEveryMin === 30) {
        savedSet.safety = Object.assign({}, savedSet.safety); delete savedSet.safety.tempCheckEveryMin; repaired.push('settings.safety.tempCheckEveryMin moved to the new default');
      }
      // Saves from before per-product hold limits cap every batch at a flat 4 hours. Lift that cap once, and give
      // brisket and pulled pork their longer limit if they still have the old 4; values the owner chose stay.
      const holdMigrate = !(isObj(savedSet.safety) && hasOwn(savedSet.safety, 'holdWindowV2'));
      if (holdMigrate && isObj(savedSet.safety) && savedSet.safety.defaultMaxHoldH === 4) {
        savedSet.safety = Object.assign({}, savedSet.safety); delete savedSet.safety.defaultMaxHoldH; repaired.push('settings.safety.defaultMaxHoldH moved to the new default');
      }
      // Saves from before the hard cap had its own setting: it takes the old longest-hold value if the owner changed it.
      if (isObj(savedSet.safety) && !hasOwn(savedSet.safety, 'hardCapH')) {
        const old = savedSet.safety.defaultMaxHoldH;
        savedSet.safety = Object.assign({}, savedSet.safety, { hardCapH: isNum(old) && old !== C.safety.defaultMaxHoldH ? old : C.safety.hardCapH });
        repaired.push('settings.safety.hardCapH set from the old longest hold time');
      }
      repairInto(settings, savedSet, SET_SCHEMA, 'settings', repaired);
      if (!(settings.service.openHour < settings.service.closeHour)) { settings.service = Object.assign({}, C.service); repaired.push('settings.service reset'); }
      if (!(settings.safety.cooling.stage1H < settings.safety.cooling.totalH)) { settings.safety.cooling = Object.assign({}, C.safety.cooling); repaired.push('settings.safety.cooling reset'); }
      // ingredients
      const ingredients = [];
      const seenIng = new Set();
      for (const x of st.ingredients) {
        if (!isObj(x) || !safeKey(x.id) || seenIng.has(x.id)) { repaired.push('dropped a bad ingredient'); continue; }
        const base = hasOwn(C.ingredientById, x.id) ? C.ingredientById[x.id] : null;
        const out = Object.assign({}, base || {}, x);
        // For known ingredients the safety class, unit and hold type always come from the config, so an
        // edited file cannot turn a TCS food into an unchecked one.
        if (base) { out.tcs = base.tcs; out.unit = base.unit; out.hold = base.hold; out.thermal = base.thermal; }
        if (out.tcs && out.holdBasis !== 'safety') out.holdBasis = 'quality';
        if (holdMigrate && base && x.maxHoldH === 4 && isNum(base.maxHoldH) && base.maxHoldH > 4) out.maxHoldH = base.maxHoldH;
        if (typeof out.tcs !== 'boolean' || (out.unit !== 'g' && out.unit !== 'ea') || typeof out.name !== 'string') { repaired.push('dropped ingredient ' + x.id); continue; }
        for (const k of Object.keys(ING_PATCH)) if (ING_PATCH[k].t === 'num' && out[k] !== undefined && checkLeaf(ING_PATCH[k], out[k], k)) { out[k] = base && base[k] !== undefined ? base[k] : undefined; if (out[k] === undefined) delete out[k]; repaired.push('ingredient ' + x.id + '.' + k + ' reset'); }
        if (out.tcs && out.hold !== 'hot' && out.hold !== 'cold') out.hold = 'hot';
        seenIng.add(x.id);
        ingredients.push(out);
      }
      for (const base of C.ingredients) if (!seenIng.has(base.id)) { ingredients.push(Object.assign({}, base)); seenIng.add(base.id); repaired.push('restored ingredient ' + base.id); }
      const im = ingMap(ingredients);
      // menu
      const menu = [];
      const seenMenu = new Set();
      for (const x of st.menu) {
        if (!isObj(x) || !safeKey(x.id) || seenMenu.has(x.id)) { repaired.push('dropped a bad menu item'); continue; }
        const base = hasOwn(C.menuById, x.id) ? C.menuById[x.id] : null;
        const out = Object.assign({ prepConfirmed: false, archived: false }, base || {}, x);
        if (typeof out.name !== 'string' || !out.name) { if (!base) { repaired.push('dropped menu item ' + x.id); continue; } out.name = base.name; }
        if (C.workZones.indexOf(out.zone) < 0) { if (!base) { repaired.push('dropped menu item ' + x.id); continue; } out.zone = base.zone; repaired.push('menu ' + x.id + '.zone reset'); }
        if (!isNum(out.prepSec) || out.prepSec < 5 || out.prepSec > 3600) { out.prepSec = base ? base.prepSec : 120; repaired.push('menu ' + x.id + '.prepSec reset'); }
        if (!isNum(out.price) || out.price < 0) { out.price = base ? base.price : 0; repaired.push('menu ' + x.id + '.price reset'); }
        if (out.track !== 'one' && out.track !== 'two') out.track = 'one';
        if (!Array.isArray(out.bom) || out.bom.some((l) => !isObj(l) || !im.has(l.ing) || !isNum(l.qty) || l.qty <= 0)) {
          out.bom = base ? base.bom.map((l) => ({ ing: l.ing, qty: l.qty })) : (Array.isArray(out.bom) ? out.bom.filter((l) => isObj(l) && im.has(l.ing) && isNum(l.qty) && l.qty > 0) : []);
          repaired.push('menu ' + x.id + '.bom repaired');
        }
        out.prepConfirmed = out.prepConfirmed === true; out.archived = out.archived === true;
        seenMenu.add(x.id);
        menu.push(out);
      }
      for (const base of C.menu) if (!seenMenu.has(base.id)) { menu.push(Object.assign({}, base, { bom: base.bom.map((l) => ({ ing: l.ing, qty: l.qty })), prepConfirmed: false, archived: false })); repaired.push('restored menu item ' + base.id); }
      const mm = menuMap(menu);
      // tickets
      let tickets = [];
      const tIds = new Set();
      for (const t of st.tickets) {
        const r = repairTicket(t, repaired);
        if (!r) { repaired.push('dropped ticket ' + (isObj(t) ? String(t.id).slice(0, 20) : '?')); continue; }
        if (tIds.has(r.id)) { repaired.push('dropped duplicate ticket ' + r.id); continue; }
        tIds.add(r.id);
        tickets.push(r);
      }
      // Keep tickets sorted by number when every id has one (the lookup by halving relies on that order).
      if (tickets.every((t) => tSeq(t.id) === tSeq(t.id))) tickets.sort((a, b) => tSeq(a.id) - tSeq(b.id));
      // duplicate nums per date -> drop the later ones
      const numSeen = new Set();
      tickets = tickets.filter((t) => { const k = t.serviceDate + '#' + t.num; if (numSeen.has(k)) { repaired.push('dropped ticket ' + t.id + ' (duplicate number)'); return false; } numSeen.add(k); return true; });
      // orders
      const orders = [];
      const oIds = new Set();
      if (Array.isArray(st.orders)) for (const x of st.orders) {
        const r = repairOrder(x, repaired);
        if (!r) { repaired.push('dropped order ' + (isObj(x) ? String(x.id).slice(0, 20) : '?')); continue; }
        if (oIds.has(r.id)) { repaired.push('dropped duplicate order ' + r.id); continue; }
        oIds.add(r.id);
        orders.push(r);
      }
      // A live ticket whose order is gone becomes a plain ticket again. The rounds of each order are checked, and
      // renumbered when they repeat or are missing; the order's own round count never falls below its highest.
      tickets = tickets.map((t) => { if (t.orderId !== undefined && !oIds.has(t.orderId) && t.status === 'active') { const c = Object.assign({}, t); delete c.orderId; delete c.round; return c; } return t; });
      const groups = new Map();
      for (const t of tickets) if (t.orderId !== undefined && oIds.has(t.orderId)) { let g = groups.get(t.orderId); if (!g) groups.set(t.orderId, g = []); g.push(t); }
      const orderOf = new Map(orders.map((o) => [o.id, o]));
      const newRound = new Map();
      for (const [oid, g] of groups) {
        const rs = g.map((t) => t.round);
        const okR = rs.every((r) => isInt(r) && r >= 1) && new Set(rs).size === rs.length;
        if (!okR) { g.forEach((t, i) => newRound.set(t.id, i + 1)); repaired.push('order ' + oid + ' rounds renumbered'); }
        const o = orderOf.get(oid);
        const top = okR ? Math.max.apply(null, rs) : g.length;
        if (!(o.rounds >= top)) o.rounds = top;
        if (o.status === 'voided' && g.some((t) => t.status !== 'voided')) { o.status = 'open'; delete o.voidedAt; delete o.voidReason; repaired.push('order ' + oid + ' reopened (it still had food)'); }
      }
      if (newRound.size) tickets = tickets.map((t) => (newRound.has(t.id) ? Object.assign({}, t, { round: newRound.get(t.id) }) : t));
      // batches
      const batches = [];
      const bIds = new Set();
      for (const b of st.batches) {
        if (!isObj(b) || !safeKey(b.id) || bIds.has(b.id) || !im.has(b.ing) || !im.get(b.ing).tcs || !hasOwn(BATCH_KIND, b.kind) || !isNum(b.enteredAt) || !isNum(b.cookedG)) { repaired.push('dropped a bad batch'); continue; }
        const out = Object.assign({}, b);
        if (!isNum(out.remainingG) || out.remainingG < 0) { out.remainingG = 0; repaired.push('batch ' + b.id + '.remainingG clamped'); }
        if (!hasOwn(BATCH_STATUS, out.status)) out.status = 'check';
        if (out.status === 'discard') { out.canServe = false; out.remainingG = 0; out.action = 'DISCARD_LOCKOUT'; if (DISCARD_REASONS.indexOf(out.discardReason) < 0) out.discardReason = 'other'; if (!isNum(out.discardedAt)) out.discardedAt = out.enteredAt; }
        if (typeof out.canServe !== 'boolean' || out.kind === 'cooling') out.canServe = out.kind === 'cooling' ? false : !!out.canServe;
        if (!isInt(out.reheats) || out.reheats < 0) out.reheats = 0;
        if (!Array.isArray(out.temps)) out.temps = [];
        out.temps = out.temps.filter((x) => isObj(x) && isNum(x.t) && isNum(x.f)).slice(-MAX_TEMPS);
        for (const k of ['lastTempAt', 'lastTempF', 'outSince', 'coolStartAt', 'stage1At', 'finalAt', 'wasteG', 'rawG', 'yieldPct', 'costPerCookedKg', 'maxHoldH', 'endpointC', 'holdH', 'discardedAt', 'keepUntil', 'restUntil']) if (out[k] !== undefined && !isNum(out[k])) { delete out[k]; repaired.push('batch ' + b.id + '.' + k + ' cleared'); }
        if (!hasOwn(SRC_BATCH, out.src)) out.src = 'cook';
        bIds.add(b.id);
        batches.push(out);
      }
      batches.sort((a, b) => a.enteredAt - b.enteredAt);
      // planned batches: only known cooked products, sane numbers, at most the cap
      const planned = [];
      if (Array.isArray(st.planned)) for (const e of st.planned) {
        const ig = isObj(e) ? im.get(e.ing) : undefined;
        if (planned.length < MAX_PLANNED && ig && ig.tcs && typeof e.id === 'string' && isNum(e.grams) && e.grams > 0 && e.grams <= 1e6 && isNum(e.offAt) && isNum(e.readyAt) && e.readyAt >= e.offAt) planned.push({ id: e.id, ing: e.ing, grams: e.grams, offAt: e.offAt, readyAt: e.readyAt });
        else repaired.push('dropped planned batch');
      }
      // put-off reminders: only for batches that are in the file, with a time
      const alertSnoozes = {};
      if (isObj(st.alertSnoozes)) for (const id of Object.keys(st.alertSnoozes)) { if (safeKey(id) && batches.some((b) => b.id === id) && isNum(st.alertSnoozes[id])) alertSnoozes[id] = st.alertSnoozes[id]; else repaired.push('dropped reminder'); }
      // stock
      const stock = {};
      for (const ing of ingredients) {
        if (ing.tcs) continue;
        const v = isObj(st.stock) && hasOwn(st.stock, ing.id) ? st.stock[ing.id] : 0;
        stock[ing.id] = isNum(v) && v >= 0 ? v : 0;
        if (stock[ing.id] !== v) repaired.push('stock ' + ing.id + ' reset to 0');
      }
      // manual 86, learned
      const manual86 = {};
      if (isObj(st.manual86)) for (const k of Object.keys(st.manual86)) if (mm.has(k) && isObj(st.manual86[k]) && isNum(st.manual86[k].since)) manual86[k] = { since: st.manual86[k].since }; else repaired.push('dropped 86 entry');
      const learned = {};
      if (isObj(st.learned)) for (const k of Object.keys(st.learned)) {
        const l = st.learned[k], mi = mm.get(k);
        if (!mi || !isObj(l) || !isInt(l.n) || l.n < 1 || !isNum(l.ema) || l.ema < 0) { repaired.push('dropped learned ' + String(k).slice(0, 30)); continue; }
        const est = learnEst(l.n, l.ema, mi.prepSec, settings.pacing);
        if (est !== l.est) repaired.push('learned ' + k + '.est recomputed');
        learned[k] = { n: l.n, ema: l.ema, est };
      }
      // events
      let archive = [];
      let events = [];
      // True when an event record has a time, a type and an id; any other is dropped.
      const evOk = (e) => isObj(e) && isNum(e.t) && typeof e.type === 'string' && typeof e.id === 'string';
      const flat = [];
      if (Array.isArray(st.eventArchive)) for (const c of st.eventArchive) if (Array.isArray(c)) for (const e of c) flat.push(e);
      if (Array.isArray(st.events)) for (const e of st.events) flat.push(e);
      let bad = 0, unsorted = false;
      const goodEv = [];
      for (const e of flat) { if (!evOk(e)) { bad++; continue; } if (goodEv.length && e.t < goodEv[goodEv.length - 1].t) unsorted = true; goodEv.push(e); }
      if (bad) repaired.push('dropped ' + bad + ' bad events');
      if (unsorted) { goodEv.sort((a, b) => a.t - b.t); repaired.push('events re-sorted by time'); }
      let rest = goodEv.length > C.limits.maxEvents ? goodEv.slice(goodEv.length - C.limits.maxEvents) : goodEv;
      while (rest.length >= 2 * EVENT_CHUNK) { archive.push(rest.slice(0, EVENT_CHUNK)); rest = rest.slice(EVENT_CHUNK); }
      events = rest;
      // syncs
      const syncs = [];
      if (Array.isArray(st.syncs)) for (const sy of st.syncs) {
        if (!isObj(sy) || typeof sy.id !== 'string' || !mm.has(sy.menuId) || !isNum(sy.t) || !isObj(sy.targets)) continue;
        const targets = {};
        for (const tg of C.syncTargets) { const x = sy.targets[tg.id]; if (isObj(x) && isNum(x.dueAt)) { targets[tg.id] = { dueAt: x.dueAt }; if (isNum(x.doneAt)) targets[tg.id].doneAt = x.doneAt; } }
        const rec = { id: sy.id, menuId: sy.menuId, kind: sy.kind === 'back' ? 'back' : '86', t: sy.t, targets };
        if (isNum(sy.holdUntil)) rec.holdUntil = sy.holdUntil;
        syncs.push(rec);
      }
      // seq
      // Counters never fall below the highest id already used, so a new id can never repeat an old one.
      const so = isObj(st.seq) ? st.seq : {};
      const maxId = (arr, pre) => { let m = 0; for (const x of arr) { const id = x && x.id; if (typeof id === 'string' && id.indexOf(pre) === 0) { const n = Number(id.slice(pre.length)); if (isInt(n) && n > m) m = n; } } return m; };
      const allEv = archive.reduce((a, c) => a.concat(c), []).concat(events);
      const seq = {
        ticket: Math.max(isInt(so.ticket) ? so.ticket : 0, maxId(tickets, 't_')),
        order: Math.max(isInt(so.order) ? so.order : 0, maxId(orders, 'o_')),
        batch: Math.max(isInt(so.batch) ? so.batch : 0, maxId(batches, 'b_')),
        event: Math.max(isInt(so.event) ? so.event : 0, maxId(allEv, 'ev_')),
        sync: Math.max(isInt(so.sync) ? so.sync : 0, maxId(syncs, 'sy_')),
        undo: isInt(so.undo) ? so.undo : 0,
        byDate: {},
      };
      // The plan counter exists once a plan was made, like the other counters' first use.
      const planN = Math.max(isInt(so.plan) ? so.plan : 0, maxId(planned, 'pl_'));
      if (planN > 0) seq.plan = planN;
      if (isObj(so.byDate)) for (const k of Object.keys(so.byDate)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && isInt(so.byDate[k])) seq.byDate[k] = so.byDate[k];
      for (const t of tickets) if (!(seq.byDate[t.serviceDate] >= t.num)) seq.byDate[t.serviceDate] = t.num;
      // sanitize
      const sz = isObj(st.sanitize) ? st.sanitize : {};
      const sanitize = {};
      if (isNum(sz.lastAt)) sanitize.lastAt = sz.lastAt;
      sanitize.dueAt = isNum(sz.dueAt) ? sz.dueAt : isNum(sanitize.lastAt) ? sanitize.lastAt + settings.safety.sanitizeEveryH * H : 0;
      const out = {
        v: 1, rev: isInt(st.rev) && st.rev >= 0 ? st.rev : 0, settings, menu, ingredients, tickets, orders, batches, stock, manual86, avail: {}, syncs, planned, alertSnoozes, learned, sanitize, seq,
        events, eventArchive: archive, undo: [], ledger: {},
      };
      // ledger: keep stored counters; if they do not balance, re-open the books at the current physical stock
      const ledger = {};
      for (const ing of ingredients) {
        const L0 = isObj(st.ledger) && hasOwn(st.ledger, ing.id) && isObj(st.ledger[ing.id]) ? st.ledger[ing.id] : {};
        const L = {};
        for (const k of Object.keys(def.ledger[ing.id] || { open: 0 })) L[k] = isNum(L0[k]) && L0[k] >= 0 ? L0[k] : 0;
        for (const k of ['open', 'in', 'pulled', 'prunedUsed', 'prunedWaste', 'prunedRemain', 'dropped']) if (!isNum(L[k])) L[k] = 0;
        ledger[ing.id] = L;
      }
      out.ledger = ledger;
      for (const x of ledgerCheck(out)) { out.ledger[x.ing].open += x.have - x.expect; repaired.push('ledger ' + x.ing + ' re-opened at current stock'); }
      // availability (derived)
      const prevAvail = isObj(st.avail) ? st.avail : {};
      const av = computeAvail(out);
      for (const k of Object.keys(av)) {
        const p = hasOwn(prevAvail, k) && isObj(prevAvail[k]) ? prevAvail[k] : null;
        av[k].since = p && p.ok === av[k].ok && p.reason === av[k].reason && p.ing === av[k].ing && isNum(p.since) ? p.since : 0;
      }
      out.avail = av;
      const bad2 = checkInvariants(out);
      if (bad2.length) return fail('inconsistent: ' + bad2[0]);
      return { ok: true, state: out, repaired };
    } catch (err) {
      return fail('unreadable: ' + String((err && err.message) || err));
    }
  }
  // Copies values from a backup's settings into a fresh settings copy, only where the value passes its
  // rule. Invalid ones are listed in repaired and keep the default.
  function repairInto(target, src, schema, path, repaired) {
    for (const k of Object.keys(schema)) {
      if (!hasOwn(src, k)) continue;
      const spec = schema[k], v = src[k], key = path + '.' + k;
      if (spec.t === 'channels') {
        const r = mergeChannels(target[k], Array.isArray(v) ? v.map((c) => (isObj(c) ? { id: c.id, warnSec: c.warnSec, breachSec: c.breachSec } : c)) : v, []);
        if (r.report) repaired.push(key + ' reset'); else target[k] = r.value;
      } else if (spec.t) {
        if (checkLeaf(spec, v, key)) repaired.push(key + ' reset'); else target[k] = v;
      } else if (isObj(v)) repairInto(target[k], v, spec, key, repaired);
      else repaired.push(key + ' reset');
    }
  }
  // Cleans one ticket from a backup: fills safe defaults for missing minor fields, and returns null (drop
  // the ticket) if anything essential is wrong or the ticket breaks its own rules (I3 to I6, I11).
  function repairTicket(t, repaired) {
    if (!isObj(t) || typeof t.id !== 'string' || !safeKey(t.id) || !isNum(t.createdAt) || !Array.isArray(t.items) || !t.items.length || !hasOwn(TICKET_STATUS, t.status)) return null;
    if (!isInt(t.num) || t.num < 1) return null;
    const out = Object.assign({}, t);
    if (typeof out.serviceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(out.serviceDate)) { out.serviceDate = U.serviceDate(out.createdAt); repaired.push('ticket ' + t.id + '.serviceDate recomputed'); }
    if (typeof out.customer !== 'string') out.customer = 'Walk-up';
    if (!hasOwn(C.channelById, out.channel)) { out.channel = 'dine_in'; repaired.push('ticket ' + t.id + '.channel reset'); }
    if (!isInt(out.recalls) || out.recalls < 0) out.recalls = 0;
    if (!hasOwn(SRC_TICKET, out.src)) out.src = 'live';
    out.rush = out.rush === true;
    out.pacing = out.pacing !== false;
    if (out.orderId !== undefined && !(typeof out.orderId === 'string' && safeKey(out.orderId) && oSeq(out.orderId) === oSeq(out.orderId))) { delete out.orderId; delete out.round; repaired.push('ticket ' + t.id + '.orderId cleared'); }
    if (typeof out.note !== 'string') out.note = '';
    if (!isNum(out.dmaxSec) || out.dmaxSec < 0) return null;
    if (out.status === 'voided' && !(typeof out.voidReason === 'string' && out.voidReason.trim())) { out.voidReason = 'other'; repaired.push('ticket ' + t.id + '.voidReason set'); }
    if (out.status !== 'expedited') { delete out.expeditedAt; delete out.forced; }
    const items = [];
    for (const it of t.items) {
      if (!isObj(it) || typeof it.id !== 'string' || typeof it.menuId !== 'string' || C.workZones.indexOf(it.zone) < 0 || !isInt(it.qty) || it.qty < 1 || !hasOwn(ITEM_STATUS, it.status)) return null;
      if (!isNum(it.prepSec) || !isNum(it.offsetSec) || !isNum(it.fireAt)) return null;
      const x = Object.assign({}, it);
      if (x.track !== 'one' && x.track !== 'two') x.track = 'one';
      if (!Array.isArray(x.mods)) x.mods = [];
      if (!isNum(x.price)) x.price = 0;
      for (const k of ['firedAt', 'startedAt', 'doneAt', 'cost']) if (x[k] !== undefined && !isNum(x[k])) return null;
      if (x.depleted !== undefined && (!Array.isArray(x.depleted) || x.depleted.some((r) => !isObj(r) || typeof r.ing !== 'string' || !isNum(r.g) || r.g < 0))) return null;
      items.push(x);
    }
    out.items = items;
    const bad = [];
    ticketViolations(out, undefined, (m) => bad.push(m));
    if (bad.length) { repaired.push('ticket ' + t.id + ': ' + bad[0]); return null; }
    return out;
  }
  // Cleans one order from a backup. Returns null (drop it) when something essential is wrong: no id, no time, a
  // status that does not exist, or a paid order without a valid method, time or money lines.
  function repairOrder(o, repaired) {
    if (!isObj(o) || typeof o.id !== 'string' || !safeKey(o.id) || oSeq(o.id) !== oSeq(o.id) || !isNum(o.createdAt) || !hasOwn(ORDER_STATUS, o.status)) return null;
    const out = {
      id: o.id, serviceDate: typeof o.serviceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.serviceDate) ? o.serviceDate : U.serviceDate(o.createdAt),
      customer: typeof o.customer === 'string' && o.customer ? o.customer.slice(0, C.limits.maxCustomerLen) : 'Walk-up',
      channel: hasOwn(C.channelById, o.channel) ? o.channel : 'dine_in', createdAt: o.createdAt, status: o.status,
      src: hasOwn(SRC_TICKET, o.src) ? o.src : 'live', rounds: isInt(o.rounds) && o.rounds >= 0 ? o.rounds : 0,
    };
    if (o.status === 'paid') {
      const T = o.totals;
      const money = isObj(T) && ['subtotal', 'discount', 'tax', 'total'].every((k) => isNum(T[k]) && T[k] >= 0);
      if (!money || !hasOwn(C.payMethodById, o.method) || !isNum(o.paidAt) || !isNum(o.tip) || o.tip < 0) return null;
      out.paidAt = o.paidAt; out.method = o.method; out.tip = o.tip; out.discount = T.discount;
      out.totals = { subtotal: T.subtotal, discount: T.discount, taxRate: isNum(T.taxRate) && T.taxRate >= 0 ? T.taxRate : 0, tax: T.tax, total: T.total, qty: isInt(T.qty) && T.qty >= 0 ? T.qty : 0, rounds: isInt(T.rounds) && T.rounds >= 0 ? T.rounds : 0 };
      if (out.paidAt < out.createdAt) out.paidAt = out.createdAt;
    } else if (o.status === 'voided') {
      out.voidedAt = isNum(o.voidedAt) ? o.voidedAt : o.createdAt;
      out.voidReason = typeof o.voidReason === 'string' && o.voidReason.trim() ? o.voidReason.trim().slice(0, 40) : 'other';
    }
    return out;
  }
  // Turns the state into backup text (JSON).
  const serialize = (state) => JSON.stringify(state);
  // Reads backup text back into a state; same as validateBackup.
  const deserialize = (text) => validateBackup(text);

  /* ======================================================================================================
   * 18. Messages with live numbers
   * ==================================================================================================== */
  // Message for a report with live numbers filled in (current reheat temperature, how many items
  // remain...). Falls back to the fixed text in REPORTS.
  function describe(report, info, settings) {
    const S = safetyOf(settings);
    const i = isObj(info) ? info : {};
    switch (report) {
      case 'tempTooLow': return 'A reheat needs a reading of at least ' + S.reheatF + ' °F. Keep heating and log it again. ' + C.safetyLine;
      case 'notReheatable': return 'This batch cannot be reheated: only one reheat is allowed, and only within ' + S.belowHotGraceH + ' hours of going below ' + S.hotHoldF + ' °F. Discard it. ' + C.safetyLine;
      case 'notAllDone': return isInt(i.remaining) ? i.remaining + ' ' + U.plural(i.remaining, 'item') + ' not done yet. Finish them, or use Bump anyway to send the ticket out.' : REPORTS.notAllDone;
      case 'itemUnavailable': {
        const why = i.reason === 'manual' ? 'marked 86 by hand' : i.reason === 'safety' ? 'on a safety hold' : i.reason === 'quality' ? 'past its quality limit' : i.reason === 'stock' ? 'sold out' : '86';
        const mi = typeof i.menuId === 'string' && hasOwn(C.menuById, i.menuId) ? C.menuById[i.menuId].name : 'That item';
        return mi + ' is ' + why + '. Take it off the order or pick something else.';
      }
      case 'outOfBounds': return isNum(i.min) && isNum(i.max) ? 'That value is outside the allowed range (' + i.min + ' to ' + i.max + '). Enter a value inside it.' : REPORTS.outOfBounds;
      case 'nothingToDo': return i.why === 'onDeck' ? 'That item is still waiting for its start time. Tap Start now to begin it early.' : i.why === 'notBelow' ? 'This batch is not below the hold temperature, so it does not need a reheat.' : 'Nothing to change.';
      default: return hasOwn(REPORTS, report) ? REPORTS[report] : REPORTS.badPatch;
    }
  }

  /* ======================================================================================================
   * 19. Exports
   * ==================================================================================================== */
  // The public door: everything other files may use. _internal is for tests and tools.
  Object.assign(E, {
    apply, tick, newState, availability, computeAvail, servable, allDay, gate, thermalYield, staticYieldComparison,
    pacingPlan, planFor, ticketTiming, ticketProgress, checkInvariants, validateBackup, serialize, deserialize, allEvents, prune,
    channelThresholds, noQualityStage, defaultSettings, describe, views, orderTotals, openOrderTotals,
    // Looks up one ticket by id; undefined when it is not found.
    findTicket: (state, id) => (isState(state) ? state.tickets[findTicketIdx(state.tickets, id)] : undefined),
    // Looks up one order by id; undefined when it is not found.
    findOrder: (state, id) => (isState(state) && Array.isArray(state.orders) ? state.orders[findOrderIdx(state.orders, id)] : undefined),
    REPORTS, REPORT_IDS, ACTIONS, UNDOABLE, DISCARD_REASONS,
    helpers: { stampAfter, hashStr, qtyScale, estimate, syncDelayMs, nominalUnitCost },
    _internal: { statusDeadline, nextDue, activeIdx, ledgerCheck, holdLimitMs, EVENT_CHUNK },
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
