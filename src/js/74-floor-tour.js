/*
 * WHAT THIS FILE IS: The "Show me how it works" walkthrough (SB.tour). It adds one demo ticket and guides a
 *    first-time user through it with a caption card and a pulsing ring, moving on only when the real ticket changes.
 *    The dishes come from the menu the owner has now (no fixed dish names), so it also works with their own menu.
 * PARTS: constants, ticket lookups, step logic, captions, ring and card placement, the check that runs four
 *    times a second, start and stop.
 * USES: 30-store.js (state, createTicket, clock speed), 60-shell.js (toast, office view), the board markup
 *    from 70-floor-board.js. USED BY: buttons on the empty board and in Help, wired in those files.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const doc = g.document;
  if (!doc) return; // Node: the walkthrough is DOM only

  const U = SB.util, h = U.h;
  // The shared config (station names come from it); an empty object when it is missing.
  const C = () => SB.config || {};

  const POLL_MS = 250;      // four checks a second: quick enough to feel live, light enough to ignore
  const LAST = 8;           // the number of steps
  const TOUR_SPEED = 30;    // 30x clock: a 5-minute fry takes 10 real seconds
  const SETTLE_MS = 2000;   // after a step starts the board may still shift (the hint line re-wraps), so the card keeps adjusting
  const MARGIN = 12;        // pixels kept free around the card
  const MIN_SIDE = 340;     // the narrowest the card may be when it sits beside the ticket
  const MAX_W = 560;        // the widest the card gets
    // Dishes the starter menu offers for the walkthrough, tried first when they are on the menu and not 86:
  // lead (the slowest, cooked in two steps), second (held back by pacing) and quick (finished with one tap).
  const PREFER = { lead: 'hushpuppies', second: 'brisket_sand', quick: 'tea' };
  // Steps that wait for the Next button because there is nothing for the person to tap.
  const MANUAL = { 1: true, 2: true, 4: true, 5: true };

  let T = null; // the running walkthrough, or null when none is running

  // The three dishes this walkthrough uses: { lead, second, quick }, each a menu item or null. Filled by start().
  let PICK = { lead: null, second: null, quick: null };
  // The dish name as the walkthrough says it: no portion note after a comma or in brackets.
  const nameOf = (m) => (m ? String(m.name).replace(/\s*\(.*$/, '').replace(/,.*$/, '').trim() : '');
  // Picks the lead, second and quick dishes from the current menu. Needs at least one dish that is not archived and
  // not 86. The lead is a two-step dish (Start, then Done) when there is one; with only one-tap dishes the lead is
  // missing and the walkthrough skips the Start steps. Returns null when no dish can be ordered.
  function pickDishes() {
    const menu = (SB.store.getState().menu || []).filter((m) => !m.archived && ((SB.store.select.availability(m.id) || {}).ok));
    // The usable menu item with this id, or null.
    const find = (id) => menu.find((m) => m.id === id) || null;
    const twos = menu.filter((m) => m.track === 'two').sort((a, b) => b.prepSec - a.prepSec);
    if (!menu.length) return null;
    const lead = find(PREFER.lead) && find(PREFER.lead).track === 'two' ? find(PREFER.lead) : twos[0] || null;
    const shorter = lead ? twos.filter((m) => m.id !== lead.id && m.prepSec < lead.prepSec) : [];
    const second = lead && find(PREFER.second) && find(PREFER.second).track === 'two' && find(PREFER.second).prepSec < lead.prepSec ? find(PREFER.second) : shorter[0] || null;
    const ones = menu.filter((m) => m.track === 'one').sort((a, b) => a.prepSec - b.prepSec);
    const quick = find(PREFER.quick) && find(PREFER.quick).track === 'one' ? find(PREFER.quick) : ones[0] || null;
    return { lead, second, quick };
  }

  // The tour ticket in the current state, or undefined once it has been reset away.
  const ticket = () => SB.store.getState().tickets.find((t) => t.id === T.id);
  // One dish of the tour ticket by its menu id.
  const dish = (t, menuId) => t.items.find((i) => i.menuId === menuId);
  // True once a person has started or finished the dish.
  const begun = (it) => !!it && (it.status === 'cooking' || it.status === 'done');
  // True when the dish is finished.
  const isDone = (it) => !!it && it.status === 'done';
  // Writes text only when it changed, so a screen reader is not told the same caption again.
  const put = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  // Shows a message on the board's toast strip; never throws.
  const toast = (msg, o) => { try { return SB.ui.toast(msg, o); } catch (e) { return null; } };
  // True while a sheet or the back office covers the board, when the caption must step aside.
  const covered = () => !!doc.querySelector('.sheet-root') || !!(SB.shell && SB.shell.inOffice && SB.shell.inOffice());

  // The tour ticket's slip on the board. Looked up fresh every time because the board redraws its rows.
  function slip() {
    const id = g.CSS && g.CSS.escape ? g.CSS.escape(T.id) : T.id;
    return doc.querySelector('.fl-slip[data-ticket="' + id + '"]');
  }

  // Runs the kitchen clock fast for the rest of the walkthrough and remembers the old speed. It starts at
  // step 5 because the other dishes are timed from when the ticket arrived, so a fast clock earlier would
  // hide the explanation behind a countdown that is already over.
  function ensureSpeed() {
    if (T.fast) return;
    T.fast = true; T.prev = SB.store.speed();
    if (T.prev !== TOUR_SPEED) SB.store.setSpeed(TOUR_SPEED);
  }
  // Puts the clock back, but only if nobody changed the speed in the meantime.
  function restoreSpeed(tour) {
    if (!tour.fast || tour.restored) return;
    tour.restored = true;
    if (SB.store.speed() === TOUR_SPEED && tour.prev !== TOUR_SPEED) SB.store.setSpeed(tour.prev);
  }

  // Moves to a step. The clock goes fast from step 5 and is put back as soon as the loop is complete.
  function goTo(n) {
    T.step = n; T.at = Date.now(); T.shown = null;
    if (n >= 5) ensureSpeed();
    if (n === LAST) restoreSpeed(T);
  }

  // Moves the step forward when the real ticket has moved on. Steps only go forward, and a step the person
  // already did by themselves is skipped, so doing things in a different order never leaves the caption behind.
  function advance(t) {
    const hp = PICK.lead ? dish(t, PICK.lead.id) : null, bs = PICK.second ? dish(t, PICK.second.id) : null;
    const all = t.items.every((i) => i.status === 'done');
    let s = T.step;
    for (let guard = 0; guard < 10; guard++) {
      const before = s;
      if (t.status === 'expedited') s = LAST;
      else if (all && s < 7) s = 7;
      else if (begun(bs) && s >= 4 && s < 6) s = 6;
      else if (begun(hp) && s < 4) s = 4;
      else if (!hp && s >= 3 && s < 6) s = 6;            // no two-step dish: there is no Start to show
      else if (!bs && s === 5) s = 6;                    // no second two-step dish: nothing is held back, skip the gray-dish step
      if (s === before) break;
    }
    if (s !== T.step) goTo(s);
  }

  // The "do this next" line under the ticket header, or null when it is turned off in Settings.
  function hint() {
    const sl = slip(), n = sl && sl.querySelector('.slip-next');
    return n && n.getClientRects().length ? n : null;
  }

  // The words for the current step. They are chosen from the real ticket so they never ask for a button
  // that is not there yet.
  function words(t) {
    const hp = PICK.lead ? dish(t, PICK.lead.id) : null, bs = PICK.second ? dish(t, PICK.second.id) : null, tea = PICK.quick ? dish(t, PICK.quick.id) : null;
    const lead = nameOf(PICK.lead), second = nameOf(PICK.second), quick = nameOf(PICK.quick);
    const zone = PICK.lead && C().zoneById ? C().zoneById[PICK.lead.zone] || null : null;
    switch (T.step) {
      case 1: return "This is a ticket: one customer's order." + (hint() ? ' The line under the name says what to do next.' : '');
      case 2: return 'The clock counts up from when the order came in. It turns amber, then red, when the order is taking too long.';
      case 3: return 'Each dish belongs to a station' + (zone ? ' (' + zone.name + ' for ' + lead + ')' : '') + '. ' + lead + (second || quick ? ' is the slowest dish on this ticket, so it can start now.' : ' can start now.') + ' Tap Start when you begin cooking it.';
      case 4: return 'The countdown under the dish is the cooking time left, as estimated. At zero the row flashes Check it. Smokebox cannot see your food, so it never marks a dish done by itself.';
      case 5: return bs && bs.status === 'queued'
        ? 'The other dishes are gray on purpose. Smokebox holds them back so everything finishes together. When the countdown reaches zero, Start appears on ' + second + '. You can also tap Start now to begin it early.'
        : 'Its time has come. Tap Start on ' + second + '.';
      case 6: {
        const open = [];
        if (hp && !isDone(hp)) open.push(lead);
        if (bs && !isDone(bs)) open.push(second);
        const teaReady = tea && tea.status === 'displayed';
        let s = open.length || !teaReady ? 'When a dish is really finished, tap Done on it. You are the one who says it is done.' : '';
        if (open.length) s += ' Finish ' + open.join(' and ') + '.';
        if (tea && !isDone(tea)) s += teaReady ? (open.length ? ' Then tap Done on ' + quick + '.' : 'Tap Done on ' + quick + '.') : ' ' + quick + ' is still waiting its turn; it joins in a moment.';
        return s;
      }
      case 7: return slip() && slip().querySelector('.fl-bump')
        ? 'Everything is done, so Bump is green. Tap Bump to send the ticket away. The clock stops.'
        : 'Everything is done. Tap the All tab, then tap Bump to send the ticket away. The clock stops.';
      default: return 'That is the whole loop: a ticket arrives, you start what is ready, tap Done, then Bump. The back office turns these taps into charts: tap Back office at the top of the screen. To add dishes and set prices and prep times, open Menu, prices and shop there.';
    }
  }

  // The elements the ring should point at for this step, leaving out any that have no box on screen (a hidden badge).
  function targets(t) {
    return rawTargets(t).filter((e) => e.getClientRects().length > 0);
  }

  // Every element that could carry the ring for this step, visible or not.
  function rawTargets(t) {
    const sl = slip();
    if (!sl) return [];
    // Every element inside the slip that matches a selector.
    const q = (sel) => Array.from(sl.querySelectorAll(sel));
    // The row for one dish, found by its menu id.
    const row = (id) => q('.fl-row[data-menu="' + id + '"]');
    switch (T.step) {
      case 1: return q('.slip-head').concat(hint() ? [hint()] : []);
      case 2: return q('.slip-timer, .fl-bw'); // the wrapper .slip-time has no box of its own, so ring the digits and the badge
      case 3: case 4: return PICK.lead ? row(PICK.lead.id) : [];
      case 5: return PICK.second ? row(PICK.second.id) : [];
      case 6: {
        const out = [];
        t.items.forEach((i) => { if (i.status === 'cooking' || (i.track === 'one' && i.status === 'displayed')) out.push(...row(i.menuId)); });
        return out.length ? out : (PICK.quick ? row(PICK.quick.id) : []);
      }
      case 7: { const b = q('.fl-bump'); return b.length ? b : Array.from(doc.querySelectorAll('.fl-seg [data-id="all"]')); }
      default: return [];
    }
  }

  // Puts the pulsing ring on exactly these elements and takes it off everything else.
  function ring(els) {
    doc.querySelectorAll('.tour-ring').forEach((e) => { if (els.indexOf(e) < 0) e.classList.remove('tour-ring'); });
    els.forEach((e) => { if (!e.classList.contains('tour-ring')) e.classList.add('tour-ring'); });
  }

  // The part of the window where the board can be seen: under the header, above the all-day strip.
  function view() {
    const head = doc.querySelector('.fl-head');
    const lift = parseFloat(doc.documentElement.style.getPropertyValue('--fl-lift')) || 0;
    return { top: head ? head.getBoundingClientRect().bottom : 0, bottom: (g.innerHeight || 800) - lift };
  }
  // True when two boxes on the screen overlap each other.
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  // True when the card sits on top of any of these elements.
  const covers = (els) => { const c = T.ui.card.getBoundingClientRect(); return els.some((e) => hit(c, e.getBoundingClientRect())); };

  // Scrolls the target to the middle of the board when it is hidden behind the header or the all-day strip.
  function bring(el) {
    const v = view(), r = el.getBoundingClientRect();
    if (r.top < v.top + MARGIN || r.bottom > v.bottom - MARGIN) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  // Wide screens: parks the card in the free space beside the ticket, level with the first ring, so the
  // whole ticket stays uncovered. Returns false when there is no room.
  function beside(sl, first, v) {
    const card = T.ui.card, r = sl.getBoundingClientRect(), W = g.innerWidth || 1280;
    const right = W - r.right - 2 * MARGIN, left = r.left - 2 * MARGIN;
    if (Math.max(right, left) < MIN_SIDE) return false;
    const w = Math.min(MAX_W, Math.max(right, left)), x = right >= MIN_SIDE ? r.right + MARGIN : r.left - MARGIN - w;
    card.style.setProperty('--tour-w', w + 'px');
    card.style.setProperty('--tour-x', x + 'px');
    card.dataset.dock = 'side';
    const ch = card.offsetHeight, f = first.getBoundingClientRect();
    const y = Math.min(Math.max(f.top + f.height / 2 - ch / 2, v.top + MARGIN), v.bottom - ch - MARGIN);
    card.style.setProperty('--tour-y', Math.round(y) + 'px');
    return true;
  }

  // Keeps the caption card off what it points at. Beside the ticket when the screen is wide; otherwise at the
  // bottom or the top of the screen. While a step is new (settling) the board also scrolls, if it has to, so the
  // rings sit in the free part; later it never scrolls on its own, so the person can look around.
  function place(els, settling) {
    const card = T.ui.card, v = view(), sl = slip();
    card.style.setProperty('--tour-top', v.top + 'px');
    ['--tour-w', '--tour-x', '--tour-y'].forEach((k) => card.style.removeProperty(k));
    if (!els.length || !sl) { card.dataset.dock = 'bottom'; return; }
    if (beside(sl, els[0], v)) return;
    const keep = card.dataset.dock === 'top' ? ['top', 'bottom'] : ['bottom', 'top'];
    for (const d of keep) { card.dataset.dock = d; if (!covers(els)) return; }
    card.dataset.dock = 'bottom';
    if (settling) clearBy(els); // neither end is clear: nudge the board
  }

  // Scrolls the board just far enough that the rings clear the card, trying the bottom end of the screen first
  // and then the top. It stops where the board cannot scroll any further.
  function clearBy(els) {
    const card = T.ui.card, main = doc.getElementById('fl-board');
    if (!main) return;
    for (const d of ['bottom', 'top']) {
      card.dataset.dock = d;
      const c = card.getBoundingClientRect(), rs = els.map((e) => e.getBoundingClientRect());
      const top = Math.min(...rs.map((r) => r.top)), bottom = Math.max(...rs.map((r) => r.bottom));
      main.scrollTop += d === 'bottom' ? bottom - (c.top - MARGIN) : top - (c.bottom + MARGIN);
      if (!covers(els)) return;
    }
    card.dataset.dock = 'bottom';
  }

  // Draws the caption and ring for the current step, or hides them while a sheet or the office is open.
  function render(t) {
    const u = T.ui;
    if (covered()) { if (!u.card.hidden) u.card.hidden = true; ring([]); T.shown = null; return; }
    if (u.card.hidden) u.card.hidden = false;
    const s = T.step;
    put(u.step, 'Step ' + s + ' of ' + LAST);
    put(u.text, words(t));
    u.skip.hidden = s === LAST;
    u.next.hidden = !MANUAL[s] || (s === 5 && !!PICK.second && (() => { const d = dish(t, PICK.second.id); return !!d && d.status !== 'queued'; })());
    u.mine.hidden = u.demo.hidden = u.done.hidden = s !== LAST;
    // Only elements that are on screen get the ring (the On time badge is hidden unless a ticket is late).
    const els = targets(t).filter((e) => e.getClientRects().length > 0);
    ring(els);
    const fresh = T.shown !== s && els.length > 0;
    if (fresh) { bring(els[0]); T.shown = s; }
    place(els, Date.now() - T.at < SETTLE_MS);
  }

  // One check: end if the ticket is gone or voided, then move the step and redraw. A failure stops the
  // walkthrough instead of leaving a half-working card on the board.
  function poll() {
    if (!T) return;
    try {
      const t = ticket();
      if (!t || t.status === 'voided') { stop(); return; }
      advance(t);
      render(t);
    } catch (e) {
      try { console.error('[smokebox] walkthrough stopped', e); } catch (e2) { /* ignore */ }
      stop();
    }
  }

  // Next button: only the explaining steps have it, so it simply goes one step on.
  function onNext() { if (T && MANUAL[T.step]) { goTo(T.step + 1); poll(); } }

  // Escape ends the walkthrough, but not while a sheet is open, because then Escape belongs to the sheet.
  function onKey(e) { if (e.key === 'Escape' && !doc.querySelector('.sheet-root')) stop(); }

  // The header's Demo button, found by its label, for the last step.
  function demoButton() {
    return Array.from(doc.querySelectorAll('.fl-head button')).find((b) => !b.classList.contains('fl-demo-chip') && /^\s*Demo\b/.test(b.textContent)) || null;
  }

  // Ends the walkthrough, then presses a real board button, so the new screen gets the focus.
  function leaveTo(finder) { stop(); const b = finder(); if (b) b.click(); }
  // Last-step buttons: add a ticket of your own, start the demo, or just finish.
  const onMine = () => leaveTo(() => doc.querySelector('.fl-new'));
  // Starts the demo from the empty board, or opens the Demo screen when the board has tickets.
  const onDemo = () => leaveTo(() => doc.querySelector('.fl-start-demo') || demoButton());
  // Ends the walkthrough from Skip or Done.
  const onEnd = () => stop();

  // Builds the caption card with all its buttons; render() shows the ones each step needs.
  function buildCard() {
    const step = h('p', { class: 'tour-step' });
    const text = h('p', { class: 'tour-text' });
    const say = h('div', { class: 'tour-say', role: 'status', 'aria-live': 'polite' }, step, text);
    const skip = h('button', { type: 'button', class: 'btn tour-skip', onClick: onEnd }, 'Skip');
    const next = h('button', { type: 'button', class: 'btn btn-primary tour-next', onClick: onNext }, 'Next');
    const mine = h('button', { type: 'button', class: 'btn tour-mine', hidden: true, onClick: onMine }, 'Add my own ticket');
    const demo = h('button', { type: 'button', class: 'btn tour-demo', hidden: true, onClick: onDemo }, 'Start the demo');
    const done = h('button', { type: 'button', class: 'btn btn-primary tour-done', hidden: true, onClick: onEnd }, 'Done');
    const card = h('div', { class: 'tour-card', hidden: true, dataset: { dock: 'bottom' } }, say, h('div', { class: 'tour-actions' }, skip, next, mine, demo, done));
    return { card, step, text, skip, next, mine, demo, done };
  }

  // Shows the All tab, because Bump lives on the whole ticket and a station tab hides it.
  function goAll() {
    const b = doc.querySelector('.fl-seg [data-id="all"]');
    if (b && b.getAttribute('aria-selected') !== 'true') b.click();
  }

  // Says why the walkthrough cannot start when there is no dish to use: with an empty menu it offers a button that opens
  // Dishes and prices; when every dish is sold out or archived it says so.
  function noDishNote() {
    const menu = (SB.store.getState().menu || []).filter((m) => !m.archived);
    if (menu.length) { toast('Every dish is sold out right now, so the walkthrough has nothing to order. Open the 86 board to see why, then try again.', { tone: 'warn' }); return; }
    // Opens the Dishes and prices sheet, where the first dish is added.
    const open = h('button', { type: 'button', class: 'btn', onClick: () => { try { SB.sheets.open('dishes'); } catch (e) { /* the sheet is optional */ } } }, 'Add my menu');
    toast(h('span', null, 'The walkthrough needs a dish to show. Add one first (a name and a price is enough), then try again. ', open), { tone: 'warn', ms: 12000 });
  }

  // Adds the walkthrough ticket and starts the guide. Starting again while one is running begins again at
  // step 1 with a fresh ticket. Returns true when it started.
  function start(opts) {
    const S = SB.store;
    if (!S || typeof S.dispatchEx !== 'function') return false;
    if (T) stop(true);
    // Choose the dishes from the owner's menu. With no usable dish the walkthrough says why instead of failing quietly.
    const pick = pickDishes();
    if (!pick) { noDishNote(); return false; }
    PICK = pick;
    const items = [pick.lead, pick.second, pick.quick].filter(Boolean).map((m) => ({ menuId: m.id, qty: 1 }));
    const r = S.dispatchEx('createTicket', { customer: 'Walk-up', channel: 'dine_in', items, note: '', rush: false, src: 'demo' }, { source: 'sim' });
    const id = r && r.report === 'ok' && r.info ? r.info.ticketId : null;
    if (!id) {
      toast('The walkthrough ticket could not be added. Check that its dishes (' + items.map((x) => nameOf(SB.store.getState().menu.find((m) => m.id === x.menuId))).join(', ') + ') are not sold out.', { tone: 'warn' });
      return false;
    }
    goAll();
    T = { id, step: 1, at: Date.now(), shown: null, fast: false, restored: false, prev: 1, ui: buildCard(), timer: 0, opts: opts || {} };
    doc.body.appendChild(T.ui.card);
    doc.addEventListener('keydown', onKey);
    T.timer = setInterval(poll, POLL_MS);
    poll();
    return true;
  }

  // Ends the walkthrough: removes the card and every ring, puts the clock back and returns focus to the
  // board. In a real kitchen the walkthrough ticket is removed, so it never sits in the owner's reports; the demo keeps it.
  // A quiet stop (used when restarting) skips the focus move.
  function stop(quiet) {
    if (!T) return false;
    const was = T; T = null;
    clearInterval(was.timer);
    const S = SB.store;
    if (S && !(S.isDemo && S.isDemo()) && typeof S.dispatchEx === 'function') { try { S.dispatchEx('clearDemoTickets', { ticketId: was.id }, { source: 'sim' }); } catch (e) { /* the leftovers offer still catches it */ } }
    doc.removeEventListener('keydown', onKey);
    restoreSpeed(was);
    doc.querySelectorAll('.tour-ring').forEach((e) => e.classList.remove('tour-ring'));
    was.ui.card.remove();
    if (!quiet && !doc.querySelector('.sheet-root')) {
      const main = doc.getElementById('fl-board');
      if (main) { try { main.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    return true;
  }

  // True while a walkthrough is running.
  const active = () => !!T;

  SB.tour = { start, stop, active, running: active };
})(typeof globalThis !== 'undefined' ? globalThis : window);
