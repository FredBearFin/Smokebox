/*
 * WHAT THIS FILE IS: The "New ticket" screen where a cook builds an order (items, name, channel, note) and
 * sends it to the kitchen. An unsent order is kept if the screen is closed by mistake.
 * PARTS: menu lookups, the draft order, the plan sentence, the sheet (menu pane, order pane, send), the
 * leave question.
 * USES / USED BY: 10-config.js, 20-engine.js, 30-store.js, 60-shell.js (sheet, toast); opened by
 * 70-floor-board.js.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const doc = g.document;
  if (!doc) return; // Node: the sheet is DOM only

  const U = SB.util, C = SB.config, h = U.h;
  const L = C.limits;
  // Builds an icon picture by name; a missing icon gives an empty span so the screen still draws.
  const ico = (name, size, o) => { try { return SB.icons.svg(name, Object.assign({ size: size || 20 }, o || {})); } catch (e) { return doc.createElement('span'); } };
  // Turns seconds into minutes and seconds, so 95 becomes 1:35.
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + U.pad2(sec % 60); };
  // The current state (everything the app knows right now).
  const st = () => SB.store.getState();
  // Writes text only when it changed, so nothing is redrawn for no reason.
  const text = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  // Shows or hides a piece of the screen only when its state really changed.
  const setHidden = (el, on) => { if (el.hidden !== on) el.hidden = on; };

  // Menu lookups (the editable copy in state wins over config).
  let menuRef = null, menuMap = null;
  function menuById(id) {
    const m = st().menu;
    if (m !== menuRef) { menuRef = m; menuMap = new Map(); m.forEach((x) => menuMap.set(x.id, x)); }
    return menuMap.get(id) || null;
  }
  // Name of an ingredient for messages; an unknown id is shown as it is.
  const ingName = (id) => { const ings = st().ingredients; for (let i = 0; i < ings.length; i++) if (ings[i].id === id) return ings[i].name; return id || 'That ingredient'; };
  // The store's answer for whether a menu item can be sold now, with a safe answer for unknown items.
  const availOf = (id) => SB.store.select.availability(id) || { ok: false, reason: null, ing: null, unknown: true };
  // Menu category name for an id, used so a search for 'sides' finds side dishes.
  const catName = (id) => { const c = C.categories.find((x) => x.id === id); return c ? c.name : ''; };
  // The short word on an 86 tile: 86 manual, 86 safety hold or 86 sold out.
  const eightySixWord = (a) => '86 ' + (a.reason === 'manual' ? 'manual' : a.reason === 'safety' ? 'safety hold' : a.reason === 'quality' ? 'past quality limit' : 'sold out');
  // One plain line saying why an item is 86.
  const eightySixWhy = (a) => {
    if (a.reason === 'manual') return 'Marked 86 by hand';
    if (a.reason === 'safety') return ingName(a.ing) + ' is held for safety';
    if (a.reason === 'quality') return ingName(a.ing) + ' is held until someone tastes it';
    return ingName(a.ing) + ' is low';
  };

  // The draft order lives at module level, so closing the sheet by accident never loses it.
  // It is cleared on send, Clear order or Discard.
  // orderId is the open order this round is added to (null starts a new one); pay is how it is paid when sent
  // ('' leaves it open); tip is the tip text as typed.
  const D = { lines: [], customer: '', channel: 'dine_in', note: '', rush: false, orderId: null, pay: '', tip: '' };
  let seq = 0;
  let lastSent = null; // { num, channel, items } of the last order sent from this sheet
  let live = null;     // the open view, or null
  // True when nothing is on the order yet.
  const draftEmpty = () => D.lines.length === 0;
  // Total number of portions on the order, not the number of lines.
  const qtyTotal = () => D.lines.reduce((n, l) => n + l.qty, 0);
  // Order price from the current menu prices.
  const subtotal = () => D.lines.reduce((s, l) => { const mi = menuById(l.menuId); return s + (mi ? mi.price * l.qty : 0); }, 0);
  // A separate copy of the order, kept so Undo can put it back.
  const copyDraft = () => JSON.parse(JSON.stringify(D));
  function restoreDraft(snap) { D.lines = snap.lines; D.customer = snap.customer; D.channel = snap.channel; D.note = snap.note; D.rush = snap.rush; D.orderId = snap.orderId; D.pay = snap.pay; D.tip = snap.tip; }
  function resetDraft() { D.lines = []; D.customer = ''; D.channel = 'dine_in'; D.note = ''; D.rush = false; D.orderId = null; D.pay = ''; D.tip = ''; }
  // The orders still open, oldest first, for the Add to open order list.
  function openOrdersList() { return (st().orders || []).filter((o) => o.status === 'open').sort((a, b) => a.createdAt - b.createdAt); }
  // A short name for an order in a list: who it is for and where, like "Table 4 (Dine-in)".
  const orderName = (o) => (o.customer || 'Walk-up') + ' (' + ((C.channelById[o.channel] || {}).name || o.channel) + ')';
  // Turns typed dollars into a number: blank is 0, junk is NaN.
  const dollars = (txt) => U.parseDollars(txt);
  // What the bill comes to if this round is sent now: the food already on the open order plus this draft, with tax.
  function pendingTotal() {
    const s0 = st(), o = D.orderId ? SB.engine.findOrder(s0, D.orderId) : null;
    let c = Math.round(subtotal() * 100);
    if (o) c += Math.round(SB.engine.orderTotals(s0, o).subtotal * 100);
    const sub = c / 100, rate = s0.settings && s0.settings.service && s0.settings.service.taxRatePct > 0 ? s0.settings.service.taxRatePct : 0;
    const tax = Math.round(sub * rate) / 100;
    return { sub, tax, total: Math.round((sub + tax) * 100) / 100 };
  }

  /** Add one menu item (or qty) to the draft. Same item with no modifiers merges into the existing line. */
  function addMenu(menuId, qty, mods) {
    const mi = menuById(menuId);
    if (!mi || mi.archived) return { ok: false, why: 'unknown' };
    const a = availOf(menuId);
    if (!a.ok) return { ok: false, why: '86', mi, a };
    qty = qty || 1;
    let line = mods && mods.length ? null : D.lines.find((l) => l.menuId === menuId && l.mods.length === 0);
    if (line) {
      if (line.qty + qty > L.maxQty) return { ok: false, why: 'maxQty', mi };
      line.qty += qty;
    } else {
      if (D.lines.length >= L.maxItemsPerTicket) return { ok: false, why: 'maxLines', mi };
      line = { key: 'l' + (++seq), menuId, qty: Math.min(qty, L.maxQty), mods: mods ? mods.slice() : [] };
      D.lines.push(line);
    }
    return { ok: true, line, mi };
  }

  // What "Repeat last order" copies: the last order sent from here, else the newest real ticket on the board.
  function lastOrder() {
    if (lastSent) return lastSent;
    const ts = st().tickets;
    for (let i = ts.length - 1; i >= 0; i--) {
      const t = ts[i];
      if (t.status === 'voided' || t.src === 'sample') continue;
      return { num: t.num, channel: t.channel, items: t.items.map((it) => ({ menuId: it.menuId, qty: it.qty, mods: (it.mods || []).slice() })) };
    }
    return null;
  }

  // The plan preview sentence. Plain words, calm, honest about pacing being off.
  function nameList(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names[0] + ', ' + names[1] + ' and ' + (names.length - 2) + ' more';
  }
  // Turns the engine's timing plan into one calm sentence: what starts now, what waits, when all is ready.
  // It says so plainly when pacing is off or Rush skips it.
  function planSentence(plan, rush) {
    if (!plan.lines.length) return 'Add items to see when each one starts.';
    let slow = plan.lines[0];
    plan.lines.forEach((l) => { if (l.prepSec > slow.prepSec) slow = l; });
    if (!plan.paced) {
      return (rush ? 'Rush: pacing is skipped, so every item starts now.' : 'Pacing is off, so every item starts now and finishes on its own time.') +
        ' The slowest, ' + slow.short + ', takes about ' + mmss(slow.prepSec) + '.';
    }
    const groups = [];
    plan.lines.slice().sort((a, b) => a.offsetSec - b.offsetSec || b.prepSec - a.prepSec).forEach((l) => {
      let gr = groups.find((x) => x.offset === l.offsetSec);
      if (!gr) { gr = { offset: l.offsetSec, names: [] }; groups.push(gr); }
      gr.names.push(l.short + (l.qty > 1 ? ' x' + l.qty : ''));
    });
    if (groups.length === 1) {
      return plan.lines.length === 1
        ? groups[0].names[0] + ' starts now. Ready in about ' + mmss(plan.readySec) + '.'
        : 'Everything starts now (' + nameList(groups[0].names) + '). All ready together in about ' + mmss(plan.readySec) + '.';
    }
    const parts = groups.map((gr) => nameList(gr.names) + (gr.names.length > 1 ? ' start ' : ' starts ') + (gr.offset <= 0 ? 'now' : 'in ' + mmss(gr.offset)));
    return parts.join(', ') + '. All ready together in about ' + mmss(plan.readySec) + '.';
  }

  // Builds and opens the New ticket sheet and returns it. The draft
  // lives outside, so closing never loses an order.
  function openOrder(opts) {
    // Opened from the Orders screen to add another round: pick that order when it is still open.
    if (opts && opts.orderId) { const o0 = SB.engine.findOrder(st(), opts.orderId); if (o0 && o0.status === 'open') D.orderId = o0.id; }
    const fine = (() => { try { return g.matchMedia('(pointer: fine)').matches; } catch (e) { return false; } })();
    let searchInput = null;
    // Esc is handled here, not by the shell, because an order with items must ask before it closes.
    const sheet = SB.ui.sheet({
      title: 'New ticket', side: 'right', width: 'min(1180px, 96vw)', name: 'order', closeOnEsc: false,
      // Only focus the search box with a mouse or keyboard, so a
      // touch tablet keeps its on-screen keyboard down.
      initialFocus: () => (fine && searchInput ? searchInput : null),
      // Whatever closes the sheet, drop the listeners and timers this screen added.
      onClose: () => teardown(),
    });
    sheet.body.classList.add('ord-host');

    const view = { cat: 'all', search: '', pane: 'menu', editing: null, tiles: [], heads: [], lineViews: new Map(), chipBtns: new Map(), offs: [] };
    const root = h('div', { class: 'ord', dataset: { pane: 'menu' } });
    sheet.body.appendChild(root);

    // On a phone the menu and the order are two panes, with a
    // switch on top (hidden on wide screens by the CSS).
    const paneSeg = SB.ui.segmented({
      kind: 'tabs', label: 'Order screen', class: 'ord-switch',
      options: [{ id: 'menu', label: 'Menu' }, { id: 'order', label: 'Order', count: 0 }], value: 'menu',
      // Tapping the switch shows that pane.
      onChange: (id) => setPane(id),
    });
    // Shows one pane (menu or order) and keeps the switch and the footer buttons in step.
    function setPane(id) { view.pane = id; root.dataset.pane = id; sheet.footer.dataset.pane = id; paneSeg.setValue(id); }

    // LEFT: menu pane.
    const menuPane = h('section', { class: 'ord-menu', 'aria-label': 'Menu' });
    searchInput = h('input', { class: 'ord-search-input', type: 'text', inputmode: 'search', enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search the menu', placeholder: 'Search the menu' });
    const clearSearch = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm ord-search-clear', 'aria-label': 'Clear search', hidden: true }, ico('x', 18));
    const searchBox = h('div', { class: 'ord-search' }, ico('search', 20), searchInput, clearSearch);
    const searchHint = h('div', { class: 'ord-hint', role: 'status', 'aria-live': 'polite', hidden: true });
    const catOptions = [{ id: 'all', label: 'All' }].concat(C.categories.map((c) => ({ id: c.id, label: c.name })));
    // Category tabs; typing in the search box ignores the tab so a search always looks at the whole menu.
    const catSeg = SB.ui.segmented({ kind: 'tabs', label: 'Menu category', class: 'ord-cats', options: catOptions, value: 'all', onChange: (id) => { view.cat = id; applyFilter(); } });
    const sticky = h('div', { class: 'ord-sticky' }, searchBox, searchHint, catSeg);
    const combosEl = h('div', { class: 'ord-combos', role: 'group', 'aria-label': 'Quick combos' });
    const tilesEl = h('div', { class: 'ord-tiles', role: 'group', 'aria-label': 'Menu items' });
    // What the menu pane shows when the search matches nothing, with a button that clears the search.
    const noMatch = h('div', { class: 'empty ord-nomatch', hidden: true },
      ico('search', 32), h('h3', null, 'No menu item matches'), h('p', { class: 'ord-nomatch-copy' }, ''),
      // Clearing puts the cursor back in the box so the cook can type again straight away.
      h('button', { type: 'button', class: 'btn', onClick: () => { setSearch(''); searchInput.focus(); } }, 'Clear search'));
    menuPane.append(sticky, combosEl, tilesEl, noMatch);

    /* combos */
    C.combos.forEach((cb) => {
      // Combo price from today's menu prices, so an edited price shows at once.
      const total = () => cb.lines.reduce((s, ln) => { const mi = menuById(ln.menu); return s + (mi ? mi.price * ln.qty : 0); }, 0);
      const n = cb.lines.reduce((s, ln) => s + ln.qty, 0);
      const b = h('button', { type: 'button', class: 'ord-combo', dataset: { id: cb.id } },
        h('span', { class: 'ord-combo-name' }, cb.name),
        h('span', { class: 'ord-combo-sub num' }, n + ' items, ' + U.fmtMoney(total())),
        h('span', { class: 'ord-combo-86', hidden: true }));
      b.addEventListener('click', () => addCombo(cb));
      view.offs.push(() => { // keep the price honest if the owner edits the menu
        const sub = b.querySelector('.ord-combo-sub'); text(sub, n + ' items, ' + U.fmtMoney(total()));
        const out = cb.lines.filter((ln) => !availOf(ln.menu).ok).length;
        const flag = b.querySelector('.ord-combo-86'); setHidden(flag, out === 0); text(flag, out ? out + ' sold out' : '');
      });
      combosEl.appendChild(b);
    });

    /* tiles, grouped by category (headings only show in the All view) */
    const menuNow = st().menu.filter((m) => !m.archived);
    const catsInUse = C.categories.filter((c) => menuNow.some((m) => m.cat === c.id));
    catsInUse.concat(menuNow.some((m) => !C.categories.some((c) => c.id === m.cat)) ? [{ id: '_other', name: 'Other' }] : []).forEach((c) => {
      const items = menuNow.filter((m) => (c.id === '_other' ? !C.categories.some((x) => x.id === m.cat) : m.cat === c.id));
      if (!items.length) return;
      const hd = h('h3', { class: 'ord-cat-head' }, c.name);
      tilesEl.appendChild(hd); view.heads.push(hd);
      items.forEach((mi) => {
        const nameEl = h('span', { class: 'ord-tile-name' }, mi.name);
        const priceEl = h('span', { class: 'ord-tile-price num' }, U.fmtMoney(mi.price));
        const countEl = h('span', { class: 'ord-tile-count', hidden: true }, h('span', { class: 'num' }, '0'), h('span', { class: 'visually-hidden' }, ' in order'));
        const wordEl = h('span', { class: 'ord-tile-86' }, ico('ban', 18), h('span', { class: 'ord-tile-86-word' }, ''));
        const whyEl = h('span', { class: 'ord-tile-why' }, '');
        const el = h('button', { type: 'button', class: 'ord-tile', dataset: { id: mi.id } }, nameEl, priceEl, countEl, wordEl, whyEl);
        const t = { el, mi, nameEl, priceEl, countEl, wordEl, whyEl, hay: '', sig: '' };
        el.addEventListener('click', () => onTile(t));
        tilesEl.appendChild(el); view.tiles.push(t); t.head = hd;
      });
    });

    // RIGHT: order pane.
    const orderPane = h('section', { class: 'ord-order', 'aria-label': 'Order' });
    const countEl = h('span', { class: 'ord-count num' }, '');
    const rushStamp = h('span', { class: 'stamp', hidden: true }, 'Rush');
    const repeatBtn = h('button', { type: 'button', class: 'btn btn-sm ord-repeat' }, ico('history', 18), h('span', null, 'Repeat last order'));
    const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm ord-clear' }, ico('trash', 18), h('span', null, 'Clear order'));
    const head = h('div', { class: 'ord-head' },
      h('h3', { class: 'ord-title' }, 'Order'), countEl, rushStamp,
      h('div', { class: 'ord-head-actions' }, repeatBtn, clearBtn));
    const notice = h('div', { class: 'ord-notice', role: 'status', hidden: true });
    const noticeText = h('span', null, '');
    const noticeX = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Dismiss message' }, ico('x', 18));
    notice.append(ico('info', 20), noticeText, noticeX);

    /* customer */
    const custInput = h('input', { class: 'input ord-cust-input', type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done', placeholder: 'Or type a name' });
    const custCount = h('span', { class: 'ord-counter num', hidden: true });
    const custField = SB.ui.field({ label: 'Customer', control: custInput, hint: 'Leave it blank for Walk-up.' });
    const chipsEl = h('div', { class: 'ord-chips', role: 'group', 'aria-label': 'Quick names' });
    C.quickNames.forEach((nm) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false' }, h('span', null, nm));
      b.addEventListener('click', () => { D.customer = D.customer === nm ? '' : nm; custInput.value = D.customer; paintCustomer(); touched(); });
      chipsEl.appendChild(b); view.chipBtns.set(nm, b);
    });
    custField.querySelector('.field-label').after(chipsEl);
    custField.classList.add('ord-cust');
    custField.appendChild(custCount);

    /* channel */
    // Where the order is going (dine-in, takeout and so on); the channel sets the time limits on the board.
    const channelSeg = SB.ui.segmented({
      label: 'Order channel', class: 'ord-channel', value: D.channel,
      options: C.channels.map((c) => ({ id: c.id, label: c.name, icon: c.icon })),
      // A new channel changes the time limits, so the draft is marked as edited.
      onChange: (id) => { D.channel = id; touched(); },
    });
    const channelBox = h('div', { class: 'ord-block' }, h('div', { class: 'ord-label', id: 'ord-channel-label' }, 'Channel'), channelSeg);

    /* which order: a new one, or one more round on an order that is still open */
    // Chooses between a new order and adding this round to one that is still open.
    const orderSeg = SB.ui.segmented({
      label: 'Which order', class: 'ord-which', value: D.orderId ? 'add' : 'new',
      options: [{ id: 'new', label: 'New order' }, { id: 'add', label: 'Add to open order', count: 0 }],
      // Choosing Add picks the oldest open order, or says there is none; choosing New forgets the pick.
      onChange: (id) => {
        const list = openOrdersList();
        if (id === 'add' && !list.length) showNotice('No order is open. Send this as a new order.');
        D.orderId = id === 'add' && list.length ? (D.orderId || list[0].id) : null;
        touched();
      },
    });
    const orderSel = h('select', { class: 'select ord-order-sel', 'aria-label': 'Open order to add this round to', hidden: true });
    // Picking an order in the list makes this round part of it.
    orderSel.addEventListener('change', () => { D.orderId = orderSel.value || null; touched(); });
    const orderInfo = h('p', { class: 'ord-order-info t-muted', hidden: true });
    const orderBox = h('div', { class: 'ord-block ord-orderbox' }, h('div', { class: 'ord-label' }, 'Order'), orderSeg, orderSel, orderInfo);

    /* payment: take it now at the counter, or leave the order open */
    // Chooses how the guest pays right now, or leaves the order open to pay later.
    const paySeg = SB.ui.segmented({
      label: 'Payment', class: 'ord-pay', value: D.pay || 'later',
      options: [{ id: 'later', label: 'Pay later' }].concat(C.payMethods.map((pm) => ({ id: pm.id, label: pm.name }))),
      // A way of paying marks the order to be paid when it is sent; Pay later leaves it open.
      onChange: (id) => { D.pay = id === 'later' ? '' : id; touched(); },
    });
    const tipInput = h('input', { class: 'input ord-tip-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Tip in dollars' });
    // Typing a tip keeps the text in the draft, so closing the screen never loses it.
    tipInput.addEventListener('input', () => { D.tip = tipInput.value; hideError(); paintCheck(); });
    const tipField = SB.ui.field({ label: 'Tip in dollars (optional)', control: tipInput });
    tipField.classList.add('ord-tip');
    const payNote = h('p', { class: 'ord-pay-note t-muted', role: 'status' });
    const payBox = h('div', { class: 'ord-block ord-paybox' }, h('div', { class: 'ord-label' }, 'Payment'), paySeg, tipField, payNote);

    /* lines */
    const linesEl = h('ul', { class: 'ord-lines', 'aria-label': 'Order lines' });
    const emptyEl = h('div', { class: 'ord-empty' },
      ico('receipt', 30),
      h('p', { class: 'ord-empty-title' }, 'No items yet'),
      h('p', { class: 't-muted' }, 'Tap an item on the menu to add it.'),
      h('button', { type: 'button', class: 'btn btn-sm ord-empty-repeat' }, ico('history', 18), h('span', null, 'Repeat last order')));
    const toMenu = h('button', { type: 'button', class: 'btn btn-sm ord-to-menu' }, ico('plus', 18), h('span', null, 'Add items'));
    emptyEl.appendChild(toMenu);
    const linesBox = h('div', { class: 'ord-block ord-linesbox' }, linesEl, emptyEl);

    /* plan preview */
    const planSum = h('p', { class: 'ord-plan-sum' }, '');
    const planRows = h('ul', { class: 'ord-plan-rows' });
    const planNote = h('p', { class: 'ord-plan-note', hidden: true }, 'Start times are starter estimates until the line has timed a few of each item.');
    const plan = h('section', { class: 'ord-plan', 'aria-label': 'Kitchen plan' }, h('h4', { class: 'ord-plan-title' }, 'Kitchen plan'), planSum, planRows, planNote);

    /* note and rush */
    const noteInput = h('textarea', { class: 'textarea ord-note-input', rows: 2, autocomplete: 'off', spellcheck: 'true', placeholder: 'Allergy first, then anything else' });
    const noteCount = h('span', { class: 'ord-counter num' }, '0 of ' + L.maxNoteLen);
    const noteField = SB.ui.field({ label: 'Note for the line', control: noteInput, hint: 'Put allergies first. Cooks read the first line.' });
    noteField.classList.add('ord-note');
    noteField.appendChild(noteCount);
    const allergyHint = h('div', { class: 'ord-allergy', hidden: true, role: 'status' }, ico('alert', 18), h('span', null, 'A line says allergy, see note. Write the allergy in the note.'));
    noteField.appendChild(allergyHint);
    // Rush skips pacing: every item starts now and the ticket goes to the front.
    const rushToggle = SB.ui.toggle({ label: 'Rush', checked: D.rush, onChange: (on) => { D.rush = on; touched(); } });
    const rushBox = h('div', { class: 'ord-rush' }, rushToggle, h('p', { class: 'ord-rush-copy t-muted' }, 'Rush skips pacing: every item starts now and the ticket goes to the front.'));

    const details = h('div', { class: 'ord-details', dataset: { add: 'false' } }, orderBox, custField, channelBox, payBox);
    orderPane.append(head, notice, linesBox, details, plan, noteField, rushBox);
    root.append(paneSeg, menuPane, orderPane);

    // Footer: total, inline error, Send.
    const errIcon = ico('alert-circle', 22);
    const errText = h('span', { class: 'ord-error-text' }, '');
    const errEl = h('div', { class: 'ord-error', role: 'alert', hidden: true }, errIcon, errText);
    const totalN = h('span', { class: 'ord-total-n' }, '');
    const totalSum = h('span', { class: 'ord-total-sum num' }, '');
    const total = h('div', { class: 'ord-total' }, totalN, totalSum);
    const reviewBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg ord-review' }, ico('receipt', 22), h('span', null, 'View order'));
    const sendBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg ord-send' }, ico('ticket', 22), h('span', null, 'Send to kitchen'));
    sheet.footer.classList.add('ord-foot'); sheet.footer.dataset.pane = 'menu';
    sheet.footer.append(errEl, total, reviewBtn, sendBtn);

    // painting: every function updates nodes in place
    // Updates every menu tile in place: price, 86 state, and how many are on the order.
    function paintTiles() {
      const counts = new Map();
      D.lines.forEach((l) => counts.set(l.menuId, (counts.get(l.menuId) || 0) + l.qty));
      view.tiles.forEach((t) => {
        const mi = menuById(t.mi.id) || t.mi; t.mi = mi;
        text(t.nameEl, mi.name); text(t.priceEl, U.fmtMoney(mi.price));
        const a = availOf(mi.id);
        const n = counts.get(mi.id) || 0;
        const sig = (a.ok ? 'ok' : a.reason + ':' + a.ing) + '|' + n;
        t.hay = (mi.name + ' ' + (mi.short || '') + ' ' + catName(mi.cat) + ' ' + mi.id.replace(/_/g, ' ')).toLowerCase();
        if (sig === t.sig) return;
        t.sig = sig;
        t.el.setAttribute('aria-disabled', a.ok ? 'false' : 'true');
        t.el.classList.toggle('is-86', !a.ok);
        t.el.classList.toggle('is-in', n > 0);
        setHidden(t.wordEl, a.ok); setHidden(t.whyEl, a.ok);
        if (!a.ok) { text(t.wordEl.lastChild, eightySixWord(a)); text(t.whyEl, eightySixWhy(a)); }
        setHidden(t.countEl, n === 0);
        text(t.countEl.firstChild, String(n));
        t.el.setAttribute('aria-label', mi.name + ', ' + U.fmtMoney(mi.price) + (a.ok ? '' : ', ' + eightySixWord(a)) + (n ? ', ' + n + ' in order' : ''));
      });
      view.offs.forEach((fn) => fn());
    }

    // Shows only the tiles that match the search words (or the chosen
    // tab) and remembers the first match for Enter.
    function applyFilter() {
      const toks = view.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0, first = null;
      view.tiles.forEach((t) => {
        let on = true;
        if (toks.length) on = toks.every((tk) => t.hay.indexOf(tk) >= 0);
        else if (view.cat !== 'all') on = t.mi.cat === view.cat;
        setHidden(t.el, !on);
        if (on) { shown++; if (!first && availOf(t.mi.id).ok) first = t; }
      });
      view.heads.forEach((hd) => {
        const any = view.tiles.some((t) => t.head === hd && !t.el.hidden);
        setHidden(hd, !(view.cat === 'all' && !toks.length && any));
      });
      setHidden(noMatch, shown !== 0);
      if (!shown) text(noMatch.querySelector('.ord-nomatch-copy'), 'Nothing on the menu matches "' + view.search.trim() + '". Check the spelling or clear the search.');
      setHidden(clearSearch, !view.search);
      if (toks.length) {
        setHidden(searchHint, false);
        text(searchHint, first ? 'Press Enter to add ' + first.mi.name + '.' : shown ? 'Everything that matches is 86 right now.' : 'No match.');
      } else setHidden(searchHint, true);
      view.firstMatch = first;
    }
    // Sets the search text (from the keyboard or from code) and refilters the tiles.
    function setSearch(v) { view.search = v; if (searchInput.value !== v) searchInput.value = v; applyFilter(); }

    // Updates the quick-name buttons and the length counter, and shows an error when the name is too long.
    function paintCustomer() {
      view.chipBtns.forEach((b, nm) => b.setAttribute('aria-pressed', D.customer === nm ? 'true' : 'false'));
      const len = D.customer.trim().length;
      const over = len > L.maxCustomerLen;
      setHidden(custCount, len < 28 && !over);
      text(custCount, len + ' of ' + L.maxCustomerLen);
      custCount.classList.toggle('is-over', over);
      custField.setError(over ? 'The name is ' + len + ' characters. The limit is ' + L.maxCustomerLen + '. Shorten it or pick a quick name.' : null);
    }
    // Updates the note counter, and reminds the cook to write the
    // allergy when a line says allergy but the note is empty.
    function paintNote() {
      const len = D.note.trim().length;
      const over = len > L.maxNoteLen;
      text(noteCount, len + ' of ' + L.maxNoteLen);
      noteCount.classList.toggle('is-over', over);
      noteField.setError(over ? 'The note is ' + len + ' characters. The limit is ' + L.maxNoteLen + '. Keep the allergy and cut the rest.' : null);
      const needs = D.lines.some((l) => l.mods.some((m) => /allergy/i.test(m))) && len === 0;
      setHidden(allergyHint, !needs);
    }
    // Refreshes everything that depends on the size of the order:
    // counts, total, button words and the empty state.
    function paintCounts() {
      const n = qtyTotal();
      const word = n + ' ' + U.plural(n, 'item');
      text(countEl, n ? word : '');
      text(totalN, n ? word : 'No items');
      text(totalSum, n ? U.fmtMoney(subtotal()) : '');
      text(reviewBtn.lastChild, n ? 'View order, ' + word : 'View order');
      paneSeg.setCount('order', n);
      setHidden(clearBtn, draftEmpty());
      const last = lastOrder();
      setHidden(repeatBtn, !last || draftEmpty()); // an empty order shows its own Repeat button in the empty state
      const lbl = last ? 'Repeat last order (#' + last.num + ')' : 'Repeat last order';
      text(repeatBtn.lastChild, lbl);
      const er = emptyEl.querySelector('.ord-empty-repeat');
      setHidden(er, !last); text(er.lastChild, lbl);
      setHidden(emptyEl, !draftEmpty());
      setHidden(linesEl, draftEmpty());
      rushStamp.hidden = !D.rush;
    }

    /* the plan: rebuilt as a whole on purpose (it has nothing to press), cheap even at 30 lines */
    function paintPlan() {
      const stt = st();
      const pl = SB.engine.planFor(stt, D.lines.map((l) => ({ menuId: l.menuId, qty: l.qty })), SB.store.now(), D.rush);
      text(planSum, planSentence(pl, D.rush));
      const rows = pl.lines.slice().sort((a, b) => a.offsetSec - b.offsetSec || b.prepSec - a.prepSec);
      const span = Math.max(1, pl.readySec);
      const frag = doc.createDocumentFragment();
      rows.forEach((r) => {
        const zone = C.zoneById[r.zone];
        const left = (r.offsetSec / span) * 100, width = Math.max(4, (r.prepSec / span) * 100);
        const bar = h('i', { 'aria-hidden': 'true' });
        bar.style.left = Math.min(left, 96) + '%'; bar.style.width = Math.min(width, 100 - Math.min(left, 96)) + '%';
        frag.appendChild(h('li', { class: 'ord-plan-row', dataset: { zone: r.zone } },
          h('span', { class: 'ord-plan-who' },
            h('span', { class: 'chip chip-zone ord-plan-zone', dataset: { zone: r.zone } }, zone ? ico(zone.icon, 14) : null, h('span', null, zone ? zone.code : r.zone)),
            h('span', { class: 'ord-plan-name' }, r.short + (r.qty > 1 ? ' x' + r.qty : ''))),
          h('span', { class: 'ord-plan-track', 'aria-hidden': 'true' }, bar),
          h('span', { class: 'ord-plan-when num' }, !pl.paced || r.offsetSec <= 0 ? 'starts now' : 'in ' + mmss(r.offsetSec), h('span', { class: 'visually-hidden' }, ', takes ' + mmss(r.prepSec)))));
      });
      U.clear(planRows); planRows.appendChild(frag);
      const learned = stt.learned || {};
      const starter = rows.some((r) => { const mi = menuById(r.menuId); return mi && mi.prepConfirmed === false && !(learned[r.menuId] && learned[r.menuId].n > 0); });
      setHidden(planNote, !(starter && rows.length));
      plan.dataset.paced = pl.paced ? 'yes' : 'no';
      setHidden(plan, false);
    }

    // Builds one order line (name, price, quantity, Mods, remove)
    // once; the returned update() refreshes it in place.
    function makeLine(line) {
      const key = line.key;
      // Finds this line in the draft again, because Undo can swap the line object for a copy.
      const cur = () => D.lines.find((l) => l.key === key);
      const mi0 = menuById(line.menuId);
      const nameEl = h('span', { class: 'ord-line-name' }, mi0 ? mi0.name : line.menuId);
      const priceEl = h('span', { class: 'ord-line-price num' }, '');
      const modsEl = h('div', { class: 'ord-line-mods' });
      // Quantity for this line; going over the limit is stopped by the stepper itself.
      const stepper = SB.ui.stepper({ value: line.qty, min: 1, max: L.maxQty, step: 1, label: 'Quantity, ' + (mi0 ? mi0.short || mi0.name : ''), onChange: (v) => { const l = cur(); if (l) { l.qty = v; touched(); } } });
      const modsBtn = h('button', { type: 'button', class: 'btn btn-sm ord-mods-btn', 'aria-expanded': 'false' }, ico('plus', 18), h('span', null, 'Mods'));
      const rmBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon ord-rm', 'aria-label': 'Remove ' + (mi0 ? mi0.name : 'item') }, ico('trash', 20));
      const warn = h('div', { class: 'ord-line-warn', role: 'status', hidden: true }, ico('ban', 18), h('span', null, ''));
      const ctl = h('div', { class: 'ord-line-ctl' }, stepper, modsBtn, rmBtn);
      const editor = h('div', { class: 'ord-editor', hidden: true });
      const el = h('li', { class: 'ord-line', dataset: { key } }, h('div', { class: 'ord-line-top' }, nameEl, priceEl), modsEl, ctl, warn, editor);

      rmBtn.addEventListener('click', () => {
        D.lines = D.lines.filter((l) => l.key !== key);
        if (view.editing === key) view.editing = null;
        touched();
        // keep focus inside the pane: the next remove button, or the Add items button when the order is empty
        const next = linesEl.querySelector('.ord-rm') || toMenu;
        next.focus({ preventScroll: true });
        SB.ui.announce((mi0 ? mi0.name : 'Item') + ' removed from the order');
      });
      modsBtn.addEventListener('click', () => { view.editing = view.editing === key ? null : key; syncLines(); if (view.editing === key) { const f = editor.querySelector('input'); if (f && fine) f.focus({ preventScroll: true }); } });

      /* modifier editor: config chips + free text */
      const chipHost = h('div', { class: 'ord-editor-chips', role: 'group', 'aria-label': 'Modifiers' });
      const modInput = h('input', { class: 'input ord-mod-input', type: 'text', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: 'Other, for example no onions', 'aria-label': 'Other modifier' });
      const modAdd = h('button', { type: 'button', class: 'btn btn-sm' }, 'Add');
      const modErr = h('div', { class: 'field-error', role: 'alert', hidden: true });
      const modDone = h('button', { type: 'button', class: 'btn btn-sm btn-ghost ord-editor-done' }, ico('check', 18), h('span', null, 'Done'));
      editor.append(chipHost, h('div', { class: 'ord-editor-free' }, modInput, modAdd), modErr, modDone);
      // Adds or removes one modifier chip (for example no onions) on the line.
      const toggleMod = (m) => {
        const l = cur(); if (!l) return;
        const i = l.mods.indexOf(m);
        if (i >= 0) l.mods.splice(i, 1);
        else { if (l.mods.length >= 10) { showModErr('A line holds up to 10 modifiers.'); return; } l.mods.push(m); }
        showModErr(null); touched();
      };
      // Shows or clears the error text under the modifier box.
      const showModErr = (msg) => { modErr.textContent = ''; if (msg) modErr.append(ico('alert-circle', 18), h('span', null, msg)); setHidden(modErr, !msg); };
      // Adds a modifier the cook typed, after checking its length and the limit per line.
      const addFree = () => {
        const v = modInput.value.replace(/\s+/g, ' ').trim();
        if (!v) { showModErr('Type the modifier first, or tap one of the chips.'); return; }
        if (v.length > 60) { showModErr('Keep a modifier under 60 characters. This one is ' + v.length + '.'); return; }
        const l = cur(); if (!l) return;
        if (l.mods.indexOf(v) < 0) { if (l.mods.length >= 10) { showModErr('A line holds up to 10 modifiers.'); return; } l.mods.push(v); }
        modInput.value = ''; showModErr(null); touched();
      };
      modAdd.addEventListener('click', addFree);
      modInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFree(); } });
      modDone.addEventListener('click', () => { view.editing = null; syncLines(); modsBtn.focus({ preventScroll: true }); });
      const chipEls = new Map();
      function paintEditor(l) {
        const all = C.modifiers.concat(l.mods.filter((m) => C.modifiers.indexOf(m) < 0));
        // chips are created once per label and then only flipped, so a tap is never lost to a rebuild
        all.forEach((m) => {
          let b = chipEls.get(m);
          if (!b) { b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false' }, h('span', null, m)); b.addEventListener('click', () => toggleMod(m)); chipEls.set(m, b); chipHost.appendChild(b); }
          b.setAttribute('aria-pressed', l.mods.indexOf(m) >= 0 ? 'true' : 'false');
        });
        chipEls.forEach((b, m) => { if (all.indexOf(m) < 0) { b.remove(); chipEls.delete(m); } });
      }

      // Refreshes this line's texts, chips and warning from the draft, touching only what changed.
      function update(l) {
        const mi = menuById(l.menuId);
        if (mi) { text(nameEl, mi.name); text(priceEl, U.fmtMoney(mi.price * l.qty)); }
        if (stepper.getValue() !== l.qty) stepper.setValue(l.qty, { silent: true });
        // applied modifiers as bold chips under the name
        const have = Array.from(modsEl.children).map((c) => c.textContent);
        if (have.join('\u0001') !== l.mods.join('\u0001')) {
          U.clear(modsEl);
          l.mods.forEach((m) => modsEl.appendChild(h('span', { class: 'chip chip-mod' }, m)));
        }
        setHidden(modsEl, l.mods.length === 0);
        text(modsBtn.lastChild, l.mods.length ? 'Mods (' + l.mods.length + ')' : 'Mods');
        const open = view.editing === l.key;
        setHidden(editor, !open);
        modsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) paintEditor(l);
        const a = availOf(l.menuId);
        setHidden(warn, a.ok);
        el.classList.toggle('is-86', !a.ok);
        if (!a.ok) text(warn.lastChild, SB.engine.describe('itemUnavailable', { menuId: l.menuId, reason: a.reason, ing: a.ing }, st().settings));
      }
      return { el, update, stepper };
    }

    // Makes the list of order lines match the draft: adds new ones,
    // removes old ones, and keeps the rest where they are.
    function syncLines() {
      const keys = D.lines.map((l) => l.key);
      view.lineViews.forEach((v, k) => { if (keys.indexOf(k) < 0) { v.el.remove(); view.lineViews.delete(k); } });
      D.lines.forEach((l, i) => {
        let v = view.lineViews.get(l.key);
        if (!v) { v = makeLine(l); view.lineViews.set(l.key, v); }
        v.update(l);
        const want = linesEl.children[i];
        if (want !== v.el) linesEl.insertBefore(v.el, want || null);
      });
    }

    // Shows which order this round goes on, the open orders to pick from, and how it will be paid.
    function paintCheck() {
      const list = openOrdersList();
      // The picked order may have been paid or voided since: fall back to a new order.
      if (D.orderId && !list.some((o) => o.id === D.orderId)) { D.orderId = null; showNotice('That order was closed, so this will start a new one.'); }
      const adding = !!D.orderId;
      orderSeg.setValue(adding ? 'add' : 'new');
      orderSeg.setCount('add', list.length);
      details.dataset.add = adding ? 'true' : 'false';
      const sig = list.map((o) => o.id + ':' + orderName(o) + ':' + o.rounds).join('|');
      if (orderSel.dataset.sig !== sig) {
        orderSel.dataset.sig = sig; U.clear(orderSel);
        list.forEach((o) => orderSel.appendChild(h('option', { value: o.id }, orderName(o) + ', round ' + (o.rounds + 1) + ' next')));
      }
      if (adding && orderSel.value !== D.orderId) orderSel.value = D.orderId;
      setHidden(orderSel, !adding);
      setHidden(orderInfo, !adding);
      if (adding) text(orderInfo, 'This round goes on the same bill. Name and channel stay as they are on that order.');
      paySeg.setValue(D.pay || 'later');
      setHidden(tipField, !D.pay);
      if (tipInput.value !== D.tip) tipInput.value = D.tip;
      const tip = dollars(D.tip);
      tipField.setError(D.pay && Number.isNaN(tip) ? 'Type dollars and cents, like 2.50.' : null);
      if (!D.pay) { text(payNote, 'The order stays open. Take payment later from Orders.'); return; }
      const pt = pendingTotal(), pm = C.payMethodById[D.pay];
      text(payNote, 'Marked paid by ' + (pm ? pm.name.toLowerCase() : D.pay) + ' when sent: ' + U.fmtMoney(pt.total) + (pt.tax > 0 ? ' with ' + U.fmtMoney(pt.tax) + ' tax' : '') + (tip > 0 ? ', plus a ' + U.fmtMoney(tip) + ' tip' : '') + '. Smokebox only records this; it does not charge cards.');
    }

    function paintAll() {
      paintTiles(); applyFilter(); syncLines(); paintCounts(); paintCustomer(); paintNote(); paintPlan(); paintCheck();
    }
    /** Something about the draft changed (a tap, a stepper, a field): refresh what depends on it. */
    function touched() {
      hideError(); hideNotice();
      paintTiles(); syncLines(); paintCounts(); paintCustomer(); paintNote(); paintPlan(); paintCheck();
      applyFilter();
    }
    view.refresh = paintAll;
    view.touched = touched;

    // Shows a short message strip at the top of the order pane.
    function showNotice(msg) { text(noticeText, msg); setHidden(notice, false); }
    // Hides the message strip at the top of the order pane.
    function hideNotice() { setHidden(notice, true); }
    noticeX.addEventListener('click', hideNotice);
    // Shows a red message above the Send button, in words the cook can act on.
    function showError(msg) { text(errText, msg); setHidden(errEl, false); }
    // Hides the red message above the Send button.
    function hideError() { setHidden(errEl, true); }

    // Reads a message aloud for screen reader users.
    function say(msg) { try { SB.ui.announce(msg); } catch (e) { /* ignore */ } }
    // A tap on a menu tile: adds one portion, or says why that is not possible (86 or a limit).
    function onTile(t) {
      // An 86 item stays tappable on purpose: the cook gets a spoken
      // and written reason instead of a dead button.
      const r = addMenu(t.mi.id, 1);
      if (!r.ok) {
        if (r.why === '86') {
          const a = r.a;
          const why = a.reason === 'manual' ? 'marked 86 by hand' : a.reason === 'safety' ? 'on a safety hold' : a.reason === 'quality' ? 'past its quality limit' : 'sold out';
          SB.ui.toast(t.mi.name + ' is ' + why + '. Pick something else.', { tone: 'warn' });
          paintTiles();
        } else if (r.why === 'maxQty') SB.ui.toast('Up to ' + L.maxQty + ' of one item per line. Send this ticket and start another.', { tone: 'warn' });
        else if (r.why === 'maxLines') SB.ui.toast(SB.engine.REPORTS.tooManyItems, { tone: 'warn' });
        return;
      }
      touched();
      const l = r.line;
      say(r.mi.name + ' added, ' + l.qty + ' in order');
      if (view.pane === 'order') { const v = view.lineViews.get(l.key); if (v) v.el.scrollIntoView({ block: 'nearest' }); }
    }
    // Adds every line of a quick combo; items that are 86 or at the limit are skipped and named in a message.
    function addCombo(cb) {
      const skipped = [], added = [];
      cb.lines.forEach((ln) => {
        const r = addMenu(ln.menu, ln.qty);
        const mi = menuById(ln.menu);
        if (r.ok) added.push(mi ? mi.short || mi.name : ln.menu); else skipped.push(mi ? mi.short || mi.name : ln.menu);
      });
      touched();
      if (skipped.length) SB.ui.toast(cb.name + ': left out ' + skipped.join(', ') + ' because ' + (skipped.length === 1 ? 'it is' : 'they are') + ' 86 or at the limit.', { tone: 'warn' });
      else say(cb.name + ' added, ' + added.length + ' lines');
    }
    // Repeat last order: copies the previous order into this one, asking first if this one already has items.
    function doRepeat() {
      const last = lastOrder();
      if (!last) return;
      // Copies the last order into the draft and returns a snapshot so the swap can be undone.
      const apply = () => {
        const snap = copyDraft();
        D.lines = [];
        const skipped = [];
        last.items.forEach((it) => {
          const r = addMenu(it.menuId, it.qty, it.mods && it.mods.length ? it.mods : null);
          if (!r.ok) { const mi = menuById(it.menuId); skipped.push(mi ? mi.short || mi.name : it.menuId); }
        });
        D.channel = last.channel || 'dine_in'; channelSeg.setValue(D.channel);
        D.customer = ''; custInput.value = ''; D.note = ''; noteInput.value = ''; D.rush = false; rushToggle.setValue(false);
        touched();
        if (skipped.length) showNotice('Order #' + last.num + ' copied. Left out because they are 86 right now: ' + skipped.join(', ') + '.');
        else showNotice('Order #' + last.num + ' copied. Add the customer and send.');
        return snap;
      };
      if (draftEmpty()) apply();
      else SB.ui.confirm({ title: 'Replace the current order?', body: 'The items on this order are swapped for the ones from #' + last.num + '. You can bring them back with Undo.', confirmLabel: 'Replace order' }).then((ok) => {
        if (!ok || !live) return;
        const snap = apply();
        // The toast's Undo puts the earlier order back.
        SB.ui.toast('Order replaced with #' + last.num + '.', { tone: 'info', undo: () => { restoreDraft(snap); if (live) { channelSeg.setValue(D.channel); custInput.value = D.customer; noteInput.value = D.note; rushToggle.setValue(D.rush); live.touched(); } } });
      });
    }
    // Empties the order but keeps a snapshot, so a mistaken tap can be undone for a few seconds.
    function clearOrder() {
      if (draftEmpty()) return;
      const snap = copyDraft();
      const keepOrder = D.orderId;
      resetDraft(); D.orderId = keepOrder; custInput.value = ''; noteInput.value = ''; channelSeg.setValue('dine_in'); rushToggle.setValue(false); view.editing = null;
      touched();
      // Undo restores the lines, name, channel, note and Rush together.
      SB.ui.toast('Order cleared.', { tone: 'info', undo: () => { restoreDraft(snap); if (live) { channelSeg.setValue(D.channel); custInput.value = D.customer; noteInput.value = D.note; rushToggle.setValue(D.rush); live.touched(); } } });
      if (fine) searchInput.focus({ preventScroll: true });
    }

    // Sends the order to the kitchen through the engine. A refusal
    // is shown in plain words and nothing is lost.
    function send() {
      hideError(); hideNotice();
      // text limits are checked here so the words match the field the cook is looking at
      const name = D.customer.trim(), note = D.note.replace(/\s+/g, ' ').trim();
      if (name.length > L.maxCustomerLen) { paintCustomer(); showError('Customer name is too long. Shorten it to ' + L.maxCustomerLen + ' characters or pick a quick name.'); setPane('order'); custInput.focus(); return; }
      if (note.length > L.maxNoteLen) { paintNote(); showError('The note is too long. It holds ' + L.maxNoteLen + ' characters. Keep the allergy and cut the rest.'); setPane('order'); noteInput.focus(); return; }
      const items = D.lines.map((l) => { const it = { menuId: l.menuId, qty: l.qty }; if (l.mods.length) it.mods = l.mods.slice(); return it; });
      const payload = { customer: name, channel: D.channel, items, note, rush: D.rush };
      // In Call mode the ticket waits for the cook's Start tap.
      if (SB.floor && SB.floor.callMode && SB.floor.callMode()) payload.awaitStart = true;
      if (D.orderId) payload.orderId = D.orderId;
      if (D.pay) {
        const tip = dollars(D.tip);
        if (Number.isNaN(tip)) { paintCheck(); showError('The tip must be dollars and cents, like 2.50. Clear it for no tip.'); setPane('order'); tipInput.focus(); return; }
        payload.pay = { method: D.pay, tip };
      }
      const addedTo = D.orderId ? SB.engine.findOrder(st(), D.orderId) : null;
      const payWord = D.pay && C.payMethodById[D.pay] ? C.payMethodById[D.pay].name.toLowerCase() : '';
      const res = SB.store.dispatchEx('createTicket', payload, { source: 'ui' });
      if (res.report === 'ok') {
        const info = res.info || {};
        const zones = Array.isArray(info.zones) ? info.zones.length : 0;
        lastSent = { num: info.num, channel: D.channel, items: items.map((it) => ({ menuId: it.menuId, qty: it.qty, mods: (it.mods || []).slice() })) };
        resetDraft();
        sheet.close('sent');
        const where = addedTo ? ' added to ' + orderName(addedTo) + ' as round ' + info.round + ', sent to ' : ' sent to ';
        SB.ui.toast('Ticket #' + info.num + where + zones + ' ' + U.plural(zones, 'station') + '.' + (info.paid ? ' Paid ' + U.fmtMoney(info.total) + ' by ' + payWord + '.' : ''), { tone: 'ok' });
        return;
      }
      const words = SB.engine.describe(res.report, res.info, st().settings);
      showError(words);
      setPane('order');
      if (res.report === 'itemUnavailable') {
        paintTiles(); syncLines();
        const bad = D.lines.find((l) => l.menuId === (res.info && res.info.menuId));
        const v = bad && view.lineViews.get(bad.key);
        if (v) { v.el.scrollIntoView({ block: 'nearest' }); v.el.classList.remove('is-flash'); void v.el.offsetWidth; v.el.classList.add('is-flash'); }
      } else if (res.report === 'unknownOrder' || res.report === 'orderNotOpen') {
        D.orderId = null; paintCheck();
      } else if (res.report === 'emptyOrder') {
        toMenu.focus({ preventScroll: true });
      } else if (res.report === 'badCustomer') { paintCustomer(); custInput.focus(); }
      else if (res.report === 'noteTooLong') { paintNote(); noteInput.focus(); }
    }

    // Button and field wiring. Enter in the search box adds the first match; Esc clears the search first.
    sendBtn.addEventListener('click', send);
    reviewBtn.addEventListener('click', () => { setPane('order'); });
    toMenu.addEventListener('click', () => { setPane('menu'); (fine ? searchInput : tilesEl.querySelector('.ord-tile:not([hidden])')).focus({ preventScroll: true }); });
    repeatBtn.addEventListener('click', doRepeat);
    emptyEl.querySelector('.ord-empty-repeat').addEventListener('click', doRepeat);
    clearBtn.addEventListener('click', clearOrder);
    searchInput.addEventListener('input', () => setSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (view.firstMatch) { const t = view.firstMatch; onTile(t); setSearch(''); searchInput.focus({ preventScroll: true }); }
      } else if (e.key === 'Escape' && view.search) { e.preventDefault(); e.stopPropagation(); setSearch(''); }
    });
    clearSearch.addEventListener('click', () => { setSearch(''); searchInput.focus({ preventScroll: true }); });
    custInput.addEventListener('input', () => { D.customer = custInput.value; hideError(); paintCustomer(); });
    noteInput.addEventListener('input', () => { D.note = noteInput.value; hideError(); paintNote(); });
    noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) e.preventDefault(); }); // a note is one wrapped line
    // Esc closes an empty order, or asks first when there is something on it.
    function onEscape(e) {
      e.preventDefault();
      if (view.editing) { const k = view.editing; view.editing = null; syncLines(); const v = view.lineViews.get(k); if (v) v.el.querySelector('.ord-mods-btn').focus({ preventScroll: true }); return; }
      if (draftEmpty()) sheet.close('esc'); else askLeave(sheet, () => { if (fine) searchInput.focus({ preventScroll: true }); });
    }
    // When the button that had focus disappears (Repeat last order, a removed
    // line), focus falls to the page and Esc would do nothing
    // because the sheet is built with closeOnEsc off. This catches that
    // case, but only while this sheet is the top one.
    function onDocKey(e) {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || sheet.el.contains(document.activeElement)) return;
      const roots = document.querySelectorAll('.sheet-root:not(.is-closing)');
      if (roots.length && roots[roots.length - 1].contains(sheet.el)) onEscape(e);
    }
    document.addEventListener('keydown', onDocKey);
    sheet.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); send(); return; }
      if (e.key === 'Escape' && !e.isComposing) { onEscape(e); return; }
      // typing in this sheet must never trigger the board's single-key shortcuts
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
    });

    /* the kitchen changes under the cook: 86s, new learned times, menu edits */
    let lastAvailKey = '';
    const availKey = () => { const a = st().avail; return JSON.stringify(Object.keys(a).map((k) => a[k].ok ? 1 : a[k].reason)); };
    lastAvailKey = availKey();
    let lastMenu = st().menu, lastLearned = st().learned;
    const off = SB.store.subscribe((s) => {
      const k = availKey();
      if (k !== lastAvailKey || s.menu !== lastMenu) { lastAvailKey = k; lastMenu = s.menu; paintTiles(); syncLines(); applyFilter(); paintCounts(); paintPlan(); }
      else if (s.learned !== lastLearned) { lastLearned = s.learned; paintPlan(); }
      else paintCounts();
      paintCheck();
    });
    // Stops listening to the store and the keyboard once the sheet is closed.
    function teardown() { off(); document.removeEventListener('keydown', onDocKey); if (live === view) live = null; }

    /* first paint */
    D.lines = D.lines.filter((l) => { const mi = menuById(l.menuId); return mi && !mi.archived; });
    custInput.value = D.customer; noteInput.value = D.note; channelSeg.setValue(D.channel); rushToggle.setValue(D.rush); tipInput.value = D.tip;
    live = view;
    paintAll();
    if (!draftEmpty()) { showNotice('Your unsent order is back. Clear it to start fresh.'); setPane('order'); }
    return sheet;
  }

  /** Esc on an order that has items: close and keep the draft, keep editing, or discard it. */
  function askLeave(sheet, back) {
    const n = qtyTotal();
    const dlg = SB.ui.sheet({ title: 'Leave this order?', side: 'center', width: 480, role: 'alertdialog', name: 'order-leave' });
    dlg.body.appendChild(h('div', { class: 'sheet-copy' },
      h('p', null, 'The order has ' + n + ' ' + U.plural(n, 'item') + '. If you close it, the draft stays here until you send it or reload the page.'),
      h('p', { class: 't-muted' }, 'Discard it only if the customer is gone.')));
    // Keep editing: closes this question and goes back to the order.
    const keep = h('button', { type: 'button', class: 'btn', onClick: () => { dlg.close('keep-editing'); if (back) back(); } }, 'Keep editing');
    // Discard order: forgets the draft and closes both sheets.
    const discard = h('button', { type: 'button', class: 'btn btn-danger', onClick: () => { resetDraft(); dlg.close('discard'); sheet.close('discard'); SB.ui.toast('Order discarded.', { tone: 'info' }); } }, ico('trash', 20), h('span', null, 'Discard order'));
    // Close, keep draft: closes the order sheet but remembers the items for next time.
    const close = h('button', { type: 'button', class: 'btn btn-primary', 'data-autofocus': '', onClick: () => { dlg.close('close'); sheet.close('esc'); } }, ico('check', 20), h('span', null, 'Close, keep draft'));
    dlg.footer.append(keep, discard, close);
    dlg.focus(close);
    return dlg;
  }

  SB.sheets.register('order', openOrder);
})(typeof globalThis !== 'undefined' ? globalThis : window);
