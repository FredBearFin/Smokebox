/*
 * WHAT THIS FILE IS: The Call screen, the kitchen's main view. It shows one big order at a time ("Drop in the
 *    fryer: Hush puppies"), the other open tickets as smaller cards, and one large button per ticket: Start,
 *    then Release. It also speaks and chimes when something needs doing.
 * PARTS: building a card, updating it each second, ordering the cards, announcing, mount and unmount.
 * USES / USED BY: reads SB.coach (26-coach.js), SB.store and SB.engine. Mounted by the floor board
 *    (70-floor-board.js), which passes in its sound and tap helpers as hooks.
 * RULE: like the board, cards are changed in place; a button is only replaced when its ticket changes phase.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util, C = SB.config;
  const doc = g.document || null;
  // With no page (plain Node) there is nothing to draw; loading must still not throw.
  if (!doc) { SB.caller = { mount: () => null }; return; }
  const h = U.h;

  // Words for each step of an item, so state is never shown by colour alone.
  const STEP_WORD = { wait: 'Later', fire: 'NOW', cook: 'Cooking', pull: 'Ready', done: 'Done' };
  // Words and icons for the three ticket tones.
  const TONE_WORD = { ok: '', warn: 'Hurry', late: 'LATE' };
  // Icon name for the ticket-level phase badge.
  const PHASE_ICON = { start: 'play', fire: 'flame', run: 'timer', plate: 'check-circle' };

  // Returns an icon element, or an empty span when the icon set is missing.
  function ico(name, size) {
    try { return SB.icons.svg(name, { size: size || 24 }); } catch (e) { return doc.createElement('span'); }
  }
  // Minutes and seconds, for example 125000 gives 2:05.
  const mss = (ms) => SB.coach.mmss(ms);
  // Station tag element: its code (PIT, HOT...) in the station colour, with its icon.
  function zoneTag(zoneId) {
    const z = C.zoneById[zoneId];
    return h('span', { class: 'cl-zone', dataset: { zone: zoneId } }, ico(z ? z.icon : 'grid', 18), h('span', null, z ? z.code : zoneId));
  }

  // Mounts the Call screen into el. hooks: chime() for a new ticket, ding() for an item to do, speak(text),
  // run(type, payload) to send an action, more(ticketId, anchor) for the three-dot menu.
  // Returns { destroy, update, announceOff } so the board can remove it again.
  function mount(el, hooks) {
    const S = () => SB.store;
    const cards = new Map();      // ticket id -> { el, sig, refs, phase }
    const seen = new Set();       // announcement keys already spoken
    let first = true, lastOrder = '', gone = false;
    const root = h('div', { class: 'cl', dataset: { empty: 'true' } });
    const heroSlot = h('div', { class: 'cl-hero', 'aria-live': 'off' });
    const grid = h('div', { class: 'cl-grid' });
    const calm = h('div', { class: 'cl-calm', role: 'status' }, ico('check-circle', 64), h('p', { class: 'cl-calm-big' }, 'All quiet'), h('p', { class: 'cl-calm-small' }, 'No tickets right now. New ones show here with a Start button.'));
    const sumEl = h('div', { class: 'cl-sum', 'aria-live': 'polite' });
    root.append(sumEl, calm, heroSlot, grid);
    el.appendChild(root);

    // Builds the inside of a card for its current shape. A card is rebuilt only when its shape changes.
    function fill(rec, c) {
      const card = rec.el;
      U.clear(card);
      card.dataset.phase = c.phase;
      const badge = h('span', { class: 'cl-badge' }, ico(PHASE_ICON[c.phase] || 'timer', 22), h('span', null, c.phase === 'start' ? 'New' : c.phase === 'plate' ? 'Ready' : c.phase === 'fire' ? 'Do now' : 'Cooking'));
      const rush = c.rush ? h('span', { class: 'cl-rush' }, ico('zap', 18), h('span', null, 'RUSH')) : null;
      const age = h('span', { class: 'cl-age num' }, '0:00');
      const tone = h('span', { class: 'cl-tone' });
      // Opens the three-dot menu (rush, release now, void) for this ticket.
      const onMore = (e) => { if (hooks.more) hooks.more(c.id, e.currentTarget); };
      const moreBtn = h('button', { type: 'button', class: 'btn cl-more', 'aria-label': 'More for ticket ' + c.num, onClick: onMore }, ico('more', 22));
      const top = h('div', { class: 'cl-top' },
        h('span', { class: 'cl-num num' }, '#' + c.num), h('span', { class: 'cl-who' }, c.customer), badge, rush, h('span', { class: 'cl-grow' }), tone, age, moreBtn);
      const say = h('p', { class: 'cl-say' });
      const hint = h('p', { class: 'cl-hint' });
      const list = h('ul', { class: 'cl-items' });
      const rows = new Map();
      for (const it of c.items) {
        const word = h('span', { class: 'cl-step-word' });
        const time = h('span', { class: 'cl-step-time num' });
        const row = h('li', { class: 'cl-item', dataset: { step: it.step, id: it.id } }, zoneTag(it.zone), h('span', { class: 'cl-item-name' }, (it.qty > 1 ? it.qty + ' x ' : '') + it.name), word, time);
        rows.set(it.id, { row, word, time });
        list.appendChild(row);
      }
      let btn = null;
      if (c.action) {
        const label = c.action.type === 'start' ? 'START' : 'RELEASE';
        // The big button sends Start or Release for this ticket.
        const onGo = () => tap(c.id, c.action.type);
        btn = h('button', { type: 'button', class: 'btn cl-go', dataset: { act: c.action.type }, onClick: onGo }, ico(c.action.type === 'start' ? 'play' : 'check', 36), h('span', null, label));
      }
      const note = c.note ? h('p', { class: 'cl-note' }, ico('alert-circle', 20), h('span', null, c.note)) : null;
      card.append(top, say, hint, list);
      if (note) card.appendChild(note);
      if (btn) card.appendChild(btn);
      card.dataset.go = btn ? 'true' : 'false';
      rec.refs = { age, tone, say, hint, rows, btn };
    }

    // One tap on Start or Release: sends the action; the screen then redraws from the store.
    function tap(ticketId, type) {
      if (!hooks.run) return;
      hooks.run(type === 'start' ? 'startTicket' : 'releaseTicket', { ticketId });
    }

    // Patches the times and words of a card without touching its structure.
    function paint(rec, c) {
      const r = rec.refs;
      if (rec.el.dataset.tone !== c.tone) rec.el.dataset.tone = c.tone;
      put(r.age, mss(c.ageMs));
      put(r.tone, TONE_WORD[c.tone]);
      put(r.say, c.headline);
      put(r.hint, c.phase === 'plate' && c.overMs > 45e3 ? 'Waiting ' + mss(c.overMs) + ' already. Plate it and tap RELEASE.' : c.hint);
      for (const it of c.items) {
        const x = r.rows.get(it.id);
        if (!x) continue;
        if (x.row.dataset.step !== it.step) x.row.dataset.step = it.step;
        put(x.word, c.phase === 'start' ? '' : STEP_WORD[it.step]);
        put(x.time, it.step === 'wait' && c.phase !== 'start' ? 'in ' + mss(it.inMs) : it.step === 'cook' || it.step === 'fire' ? mss(it.leftMs) + ' left' : '');
      }
    }
    // Writes text only when it changed, so screen readers and layout stay calm.
    function put(node, txt) { if (node.textContent !== txt) node.textContent = txt; }

    // A card's shape: its phase, tone-independent. When it changes the card is rebuilt.
    const sigOf = (c) => c.phase + '|' + c.rush + '|' + c.note + '|' + c.items.map((i) => i.id + ':' + (i.step === 'done' ? 'd' : 'o')).join(',') + '|' + (c.action ? c.action.type : '-');

    // Redraws from the store: adds new cards, rebuilds changed ones, drops finished ones and orders the rest.
    function update(now) {
      if (gone) return;
      const state = S().getState();
      if (!state) return;
      const view = SB.coach.read(state, now);
      const alive = new Set();
      const order = [];
      for (const c of view.cards) {
        alive.add(c.id);
        let rec = cards.get(c.id);
        const sig = sigOf(c);
        if (!rec) { rec = { el: h('article', { class: 'cl-card', dataset: { id: c.id } }), sig: '', refs: null }; cards.set(c.id, rec); }
        if (rec.sig !== sig) { rec.sig = sig; fill(rec, c); }
        paint(rec, c);
        order.push(rec);
      }
      for (const [id, rec] of Array.from(cards)) if (!alive.has(id)) { rec.el.remove(); cards.delete(id); }
      // Put the cards in urgency order only when the order actually changed; the first one is the big one.
      const key = order.map((r) => r.el.dataset.id).join(',');
      if (key !== lastOrder) {
        lastOrder = key;
        order.forEach((rec, i) => {
          rec.el.classList.toggle('is-hero', i === 0);
          (i === 0 ? heroSlot : grid).appendChild(rec.el);
        });
      }
      root.dataset.empty = order.length ? 'false' : 'true';
      put(sumEl, summary(view.counts));
      announce(view);
    }

    // One short line for screen readers and the top of the screen: how many of each kind of job.
    function summary(n) {
      const bits = [];
      if (n.plate) bits.push(n.plate + ' to release');
      if (n.start) bits.push(n.start + ' to start');
      if (n.fire) bits.push(n.fire + ' to put on now');
      if (n.run) bits.push(n.run + ' cooking');
      return bits.join('  |  ');
    }

    // Plays a chime and speaks once for each new job: a new ticket, an item to put on, a plate to release.
    function announce(view) {
      const lines = [];
      let ding = false, chime = false;
      for (const c of view.cards) {
        const keys = [];
        if (c.phase === 'start') keys.push(['new:' + c.id, c.voice, 'chime']);
        if (c.phase === 'plate') keys.push(['plate:' + c.id, c.voice, 'ding']);
        for (const it of c.items) if (it.step === 'fire') keys.push(['fire:' + it.id, 'Ticket ' + c.num + '. ' + it.text, 'ding']);
        for (const [k, text, kind] of keys) {
          if (seen.has(k)) continue;
          seen.add(k);
          if (first) continue; // jobs already open when the screen appears are not announced again
          lines.push(text);
          if (kind === 'chime') chime = true; else ding = true;
        }
      }
      first = false;
      if (!lines.length) return;
      if (chime && hooks.chime) hooks.chime();
      if (ding && hooks.ding) hooks.ding();
      if (hooks.speak) hooks.speak(lines.slice(0, 2).join(' '));
    }

    const offs = [S().subscribe(() => update(S().now())), S().subscribeTick((now) => update(now))];
    update(S().now());
    return {
      // Redraws now, for the board when something outside the store changed.
      update: () => update(S().now()),
      // Stops listening to the store and removes the screen.
      destroy() { gone = true; offs.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); root.remove(); },
      root,
    };
  }

  SB.caller = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : window);
