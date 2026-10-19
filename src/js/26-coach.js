/*
 * WHAT THIS FILE IS: The coach (SB.coach). It reads the open tickets and the clock and turns them into plain
 *    orders for the cook: start this ticket, put this on now, plate this and release it. It changes nothing.
 * PARTS: wording (verbs, times), one item's step, one ticket's card, the sorted list for the Call screen.
 * USES: 00-util.js, 10-config.js, 20-engine.js. USED BY: the Call screen (75-floor-caller.js) and its tests.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util, C = SB.config;
  // The engine, looked up each time so tests can swap it.
  const E = () => SB.engine;
  // How long an item shows "do it now" (30 seconds) before it counts as cooking.
  const NOW_WINDOW_MS = 30e3;
  // Lower rank is more urgent: a plate waiting for release, an item to put on, a ticket to start, then the rest.
  const RANK = { plate: 0, fire: 1, start: 2, run: 3 };

  // What the cook does with a dish, as a sentence with the dish name filled in. By dish where it matters, by
  // station otherwise. Starter wording.
  // audit:data-start
  const SAY = {
    fry: 'Drop {n} in the fryer', heat: 'Heat up {n}', scoop: 'Scoop {n}', pour: 'Pour {n}', warm: 'Warm up {n}',
    slice: 'Slice {n}', rack: 'Slice the {n}', grill: 'Grill {n}', make: 'Make {n}',
  };
  const SAY_BY_MENU = {
    hushpuppies: 'fry', fried_pickles: 'fry', cornbread: 'warm', tea: 'pour', mac: 'heat', mac_lg: 'heat', beans: 'heat',
    slaw: 'scoop', potato: 'scoop', pudding: 'scoop', ribs_half: 'rack', ribs_full: 'rack', sausage: 'grill',
  };
  const SAY_BY_ZONE = { pit: 'slice', sides: 'heat', fry: 'fry', cold: 'scoop' };
  // audit:data-end

  // Minutes and seconds as 2:05, never negative.
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + U.pad2(s % 60); };

  // The imperative sentence for one item, like "Drop 2 x Hush puppies in the fryer".
  function sayItem(it) {
    const how = SAY[SAY_BY_MENU[it.menuId] || SAY_BY_ZONE[it.zone] || 'make'];
    return how.replace('{n}', (it.qty > 1 ? it.qty + ' x ' : '') + (it.short || it.name));
  }

  // Works out where one item is in the plan. step: wait (not yet), fire (do it now), cook (in progress),
  // pull (ready, waiting to be plated), done. Times are milliseconds.
  function stepOf(it, now) {
    const row = { id: it.id, menuId: it.menuId, zone: it.zone, qty: it.qty, name: it.short || it.name, text: sayItem(it), step: 'wait', inMs: 0, leftMs: 0, overMs: 0 };
    if (it.status === 'done') { row.step = 'done'; return row; }
    const endAt = it.fireAt + it.prepSec * 1000;
    if (now < it.fireAt) { row.step = 'wait'; row.inMs = it.fireAt - now; } else if (now < it.fireAt + NOW_WINDOW_MS) {
      row.step = 'fire'; row.leftMs = Math.max(0, endAt - now);
    } else if (now < endAt) { row.step = 'cook'; row.leftMs = endAt - now; } else { row.step = 'pull'; row.overMs = now - endAt; }
    return row;
  }

  // Builds the card for one open ticket: its items' steps, the one sentence to show big, and the one button.
  function cardFor(t, state, now) {
    const th = E().channelThresholds(state.settings, t.channel);
    const ageMs = now - t.createdAt;
    const tone = ageMs >= th.breachSec * 1000 ? 'late' : ageMs >= th.warnSec * 1000 ? 'warn' : 'ok';
    const base = { id: t.id, num: t.num, customer: t.customer, channel: t.channel, rush: !!t.rush, note: t.note || '', ageMs, tone, items: [] };
    // A ticket still waiting for the Start tap shows its items as a plain list, with no times.
    if (t.awaitStart) {
      base.items = t.items.map((it) => ({ id: it.id, menuId: it.menuId, zone: it.zone, qty: it.qty, name: it.short || it.name, text: sayItem(it), step: 'wait', inMs: 0, leftMs: 0, overMs: 0 }));
      return Object.assign(base, { phase: 'start', headline: 'Start ticket ' + t.num, hint: 'Tap START and the app calls every step.', action: { type: 'start', label: 'Start' }, voice: 'New ticket ' + t.num + '. Tap start.' });
    }
    base.items = t.items.map((it) => stepOf(it, now));
    const startAt = U.isNum(t.startedAt) ? t.startedAt : t.createdAt;
    const readyAt = startAt + (t.dmaxSec || 0) * 1000;
    const open = base.items.filter((r) => r.step !== 'done');
    const firing = open.filter((r) => r.step === 'fire');
    const allReady = open.every((r) => r.step === 'pull');
    const release = { type: 'release', label: 'Release' };
    // Everything is ready (or the plan time passed): plate it and tap Release.
    if (!open.length || allReady || now >= readyAt + 1000) {
      return Object.assign(base, { phase: 'plate', readyAt, overMs: Math.max(0, now - readyAt), headline: 'Plate ticket ' + t.num, hint: 'Check every item is on the plate, then tap RELEASE.', action: release, voice: 'Ticket ' + t.num + ' is ready. Plate it and release.' });
    }
    if (firing.length) {
      const first = firing[0];
      return Object.assign(base, { phase: 'fire', readyAt, headline: first.text, hint: firing.length > 1 ? 'Also now: ' + firing.slice(1).map((r) => r.name).join(', ') : 'Ticket ' + t.num + ' is on its way. Nothing to tap.', action: null, voice: 'Ticket ' + t.num + '. ' + first.text });
    }
    // Cooking: the next thing to do, or just the countdown to ready.
    const waiting = open.filter((r) => r.step === 'wait').sort((a, b) => a.inMs - b.inMs);
    const nextRow = waiting[0];
    const headline = nextRow ? 'In ' + mmss(nextRow.inMs) + ': ' + nextRow.text : 'Ready in ' + mmss(readyAt - now);
    return Object.assign(base, { phase: 'run', readyAt, headline, hint: 'Ready in ' + mmss(readyAt - now) + '. Nothing to tap yet.', action: null, nextInMs: nextRow ? nextRow.inMs : null });
  }

  // The whole Call screen's data: every open ticket as a card, most urgent first, with counts.
  // WATCH OUT: late tickets jump the queue whatever their phase, so a forgotten ticket cannot hide at the bottom.
  function read(state, now) {
    const cards = [];
    for (const t of state.tickets) if (t.status === 'active') cards.push(cardFor(t, state, now));
    // Sort key: late tickets first, then by kind of job (see RANK).
    const key = (c) => (c.tone === 'late' ? 0 : 10) + RANK[c.phase];
    cards.sort((a, b) => key(a) - key(b) || (b.rush ? 1 : 0) - (a.rush ? 1 : 0) || a.num - b.num);
    const counts = { start: 0, fire: 0, plate: 0, run: 0, late: 0 };
    for (const c of cards) { counts[c.phase]++; if (c.tone === 'late') counts.late++; }
    return { cards, counts, now };
  }

  SB.coach = { read, cardFor, stepOf, sayItem, mmss, NOW_WINDOW_MS };
})(typeof globalThis !== 'undefined' ? globalThis : window);
