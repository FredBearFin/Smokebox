/*
 * WHAT THIS FILE IS: The Orders screen at the front counter, and the Take payment box. An order is the whole bill for
 * one table, tab or guest; every round of food on it is a ticket on the kitchen screen. Here the counter sees the
 * open orders, adds another round, takes payment, reopens a payment made by mistake and voids an empty order.
 * PARTS: helpers, the list that keeps rows in step, the Orders sheet (Open and Paid today), the Take payment box.
 * USES / USED BY: 10-config.js, 20-engine.js, 30-store.js, 60-shell.js; opened by name ("orders") from the header
 * button, the quick menu and the O key in 70-floor-board.js. "Add items" opens the New ticket screen (71-floor-order.js).
 * Smokebox only RECORDS how an order was paid. It never charges a card.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const doc = g.document;

  // Rounds a dollar amount to whole cents.
  const cents = (v) => Math.round(v * 100) / 100;
  // Tip choices worked out from a base amount (the food after any discount): 15, 18, 20 and 25 percent in dollars.
  function tipPresets(base) {
    return [15, 18, 20, 25].map((pct) => ({ pct, label: pct + '%', amount: SB.orderMath ? SB.orderMath.pctOfDollars(base, pct) : cents((Math.max(0, base) * pct) / 100) }));
  }
  // The tip that brings the amount to collect up to a whole dollar (a total of 23.40 gives 0.60); 0 if already whole.
  function roundUpTip(total) { return cents(Math.ceil(cents(total) - 1e-9) - cents(total)); }
  // Cash amounts a guest is likely to hand over for a bill: the exact amount, then the next 5, 10, 20, 50 and 100 above it.
  // Each is listed once and never below the bill. Returns [{ label, amount }].
  function cashChoices(due) {
    const out = [{ label: 'Exact', amount: cents(due) }], seen = new Set([cents(due)]);
    [5, 10, 20, 50, 100].forEach((step) => {
      const amt = Math.ceil(cents(due) / step - 1e-9) * step;
      if (amt > 0 && !seen.has(amt) && out.length < 5) { seen.add(amt); out.push({ label: (g.SB.util && g.SB.util.currencySymbol ? g.SB.util.currencySymbol() : '$') + amt, amount: amt }); }
    });
    return out;
  }
  // Change owed back: what was handed over less what is due, or a negative number when it is short.
  const changeFor = (given, due) => cents(given - due);
  g.SB.payLogic = { tipPresets, roundUpTip, cashChoices, changeFor };

  if (!doc) return; // Node: these screens are DOM only

  const U = SB.util, C = SB.config, h = U.h;
  // Engine looked up late, so this file still loads if the engine module comes after it.
  const E = () => SB.engine;
  // Builds an icon picture by name; a missing icon gives an empty span so the screen still draws.
  const ico = (name, size, o) => { try { return SB.icons.svg(name, Object.assign({ size: size || 20 }, o || {})); } catch (e) { return doc.createElement('span'); } };
  // The current state (everything the app knows right now).
  const st = () => SB.store.getState();
  // The kitchen clock in milliseconds. In a demo it can run faster than real time.
  const nowMs = () => SB.store.now();
  // Writes text only when it changed, so nothing is redrawn for no reason.
  const text = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
  // Shows or hides a piece of the screen only when its state really changed.
  const setHidden = (el, on) => { if (el && el.hidden !== !!on) el.hidden = !!on; };
  // Dollars written out, like $12.40.
  const money = (n) => U.fmtMoney(n);
  // Sends an action to the store as the person using the screen and returns the full answer.
  const run = (type, payload) => SB.store.dispatchEx(type, payload, { source: 'ui' });
  // Turns an engine answer into the plain-words message for the screen.
  const say = (res) => E().describe(res.report, res.info, st().settings);
  // Shows a short message at the bottom; tone is ok, warn, bad or info.
  const toast = (msg, tone, extra) => SB.ui.toast(msg, Object.assign({ tone: tone || 'info' }, extra || {}));
  // The channel record for an id, with a safe fallback so an old order never breaks the list.
  const channelOf = (id) => C.channelById[id] || { name: id || 'Order', icon: 'plate' };
  // The way of paying used last, offered first next time (a counter usually takes the same kind all day).
  const KEY_METHOD = 'smokebox.v1.paymethod'; // the remembered way of paying on this device
  let lastMethod = (() => { const v = U.storage.get(KEY_METHOD, null); return v && C.payMethodById[v] ? v : C.payMethods[0].id; })();
  // Sets and remembers the way of paying that the one-tap Pay button uses.
  function setMethod(id) { if (!C.payMethodById[id]) return; lastMethod = id; U.storage.set(KEY_METHOD, id); }

  // The short lowercase word for a way of paying, like cash or card.
  const methodWord = (id) => (C.payMethodById[id] ? C.payMethodById[id].name.toLowerCase() : id);
  // One-tap payment: marks the order paid with the way of paying used last, no tip, no discount. An Undo in the
  // message reopens the order (that clears the payment), so a wrong tap costs one more tap.
  function quickPay(orderId) {
    const method = lastMethod;
    const res = run('payOrder', { orderId, method, tip: 0, discount: 0 });
    if (res.report !== 'ok') { toast(say(res), 'warn'); return; }
    const info = res.info || {};
    toast('Paid ' + money(info.total) + ' by ' + methodWord(method) + '.', 'ok', {
      // Undo puts the order back in Open with its payment cleared.
      undo: () => { const r = run('reopenOrder', { orderId }); if (r.report !== 'ok') toast(say(r), 'warn'); },
    });
  }

  // How long ago, in plain words (just now, 5 min ago, 2 h 10 min ago).
  function ago(ms) {
    if (ms < 45e3) return 'just now';
    const m = Math.max(1, Math.round(ms / 60e3));
    return m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ' + U.pad2(m % 60) + ' min ago';
  }
  // The name shown for an order: who it is for, or Walk-up when no name was given.
  const whoOf = (o) => o.customer || 'Walk-up';
  // The food on an order's tickets that are not voided, merged by dish: [{ name, qty, amount }].
  function foodLines(state, orderId) {
    const by = new Map();
    for (const t of state.tickets) {
      if (t.orderId !== orderId || t.status === 'voided') continue;
      for (const it of t.items) {
        const r = by.get(it.menuId) || { name: (C.menuById[it.menuId] && C.menuById[it.menuId].short) || it.short || it.name, qty: 0, amount: 0 };
        r.qty += it.qty; r.amount += it.qty * (U.isNum(it.price) ? it.price : 0);
        by.set(it.menuId, r);
      }
    }
    return Array.from(by.values());
  }
  // A short line of what is on the order: up to four dishes, then "and N more".
  function itemsLine(lines) {
    const parts = lines.map((l) => l.name + (l.qty > 1 ? ' x' + l.qty : ''));
    return parts.length <= 4 ? parts.join(', ') : parts.slice(0, 4).join(', ') + ' and ' + (parts.length - 4) + ' more';
  }
  // Keeps a list of rows in step with a list of items: makes rows for new ids, updates them all, drops rows whose item is
  // gone and puts the rest in order. Rows are reused, never rebuilt, so a button being pressed is never replaced.
  // Builds at most `cap` new rows per call (the rest next time) so a long list does not freeze a slow tablet; returns true when rows are still missing.
  function reconcile(listEl, rows, items, makeFn, updateFn, cap) {
    const keep = new Set(items.map((it) => it.id));
    rows.forEach((rec, id) => { if (!keep.has(id)) { rec.el.remove(); rows.delete(id); } });
    let made = 0, pos = 0, more = false;
    items.forEach((it) => {
      let rec = rows.get(it.id);
      if (!rec) {
        if (cap && made >= cap) { more = true; return; }
        rec = makeFn(it); rows.set(it.id, rec); made++;
      }
      updateFn(rec, it);
      const want = listEl.children[pos++];
      if (want !== rec.el) listEl.insertBefore(rec.el, want || null);
    });
    return more;
  }

  /* ---------------------------------------------------------------------------------------------
   * The Orders sheet
   * ------------------------------------------------------------------------------------------- */

  // Builds and opens the Orders sheet: Open orders (add, pay, void) and Paid today (reopen).
  // The sheet only supplies the frame; buildOrders fills it, so the same list can also be a full page.
  function openOrders(opts) {
    let built = null;
    // Nothing here takes focus by itself, so a touch tablet keeps its keyboard down.
    const sheet = SB.ui.sheet({ title: 'Orders', side: 'right', width: 'min(760px, 96vw)', name: 'orders', onClose: () => { if (built) built.teardown(); } });
    SB.ui.sheetHelp(sheet, 'getting-started', 'taking payment');
    built = buildOrders({ body: sheet.body, close: sheet.close, isPage: false }, opts);
    // The end-of-day screen lives in the back office code; the button only shows when it is part of this copy.
    if (SB.office && typeof SB.office.openCloseDay === 'function') {
      sheet.footer.classList.add('ox-foot');
      sheet.footer.append(h('p', { class: 'ox-foot-note' }, 'Service over? Close the day counts the money and offers a backup.'),
        // Closes Orders, then opens the end-of-day screen from the back office code.
        h('button', { type: 'button', class: 'btn', dataset: { act: 'closeday' }, onClick: () => { sheet.close('closeday'); setTimeout(() => SB.office.openCloseDay(), 60); } }, ico('check-circle', 20), h('span', null, 'Close the day')));
      sheet.footer.hidden = false;
    }
    return sheet;
  }

  // Shows the Orders list as a full page inside `host` and returns { el, close, destroy }.
  // opts.onExit(reason) runs when the page closes; with no onExit the page just goes away.
  function mountPage(host, opts) {
    opts = opts || {};
    let built = null, closed = false;
    const page = h('div', { class: 'ord-page ox-page', dataset: { name: 'orders' } });
    const body = h('div', { class: 'sheet-body' });
    page.append(h('header', { class: 'ord-page-bar' }, h('h1', { class: 'ord-page-title' }, 'Orders')), body);
    host.appendChild(page);
    // Closes the page once: stops the live updates, removes the page, then tells the caller why.
    const close = (why) => {
      if (closed) return;
      closed = true;
      if (built) built.teardown();
      page.remove();
      if (typeof opts.onExit === 'function') opts.onExit(why || 'api');
    };
    built = buildOrders({ body, close, isPage: true }, opts);
    // Closes the page without asking, for the router when it moves to another screen.
    const destroy = () => close('destroy');
    return { el: page, close, destroy };
  }

  // Fills a frame (a sheet or a page) with the Orders list. host = { body, close(why), isPage }.
  // Returns { teardown } so the frame can stop the live updates when it goes away.
  function buildOrders(host, opts) {
    opts = opts || {};
    const offs = [];
    const openRows = new Map(), paidRows = new Map();

    const openList = h('ul', { class: 'ox-list', 'aria-label': 'Open orders' }), paidList = h('ul', { class: 'ox-list', 'aria-label': 'Orders paid today' });
    const openEmpty = h('div', { class: 'empty ox-empty', hidden: true }, ico('receipt', 40), h('h3', null, 'No open orders'),
      h('p', null, 'An order opens when a ticket is sent. Leave it on Pay later in the New ticket screen to keep it open until the guest is ready to pay.'));
    const paidEmpty = h('div', { class: 'empty ox-empty', hidden: true }, ico('dollar', 40), h('h3', null, 'Nothing paid yet today'),
      h('p', null, 'Paid orders show up here, newest first, so a wrong payment can be reopened.'));
    const newBtn = h('button', { type: 'button', class: 'btn btn-primary ox-new' }, ico('plus', 22), h('span', null, 'New ticket'));
    // New ticket closes this screen and opens the New ticket screen for a fresh order.
    newBtn.addEventListener('click', () => {
      if (host.isPage) { SB.sheets.open('order'); return; } // a page stays under the New ticket sheet
      host.close('new'); setTimeout(() => SB.sheets.open('order'), 60);
    });
    const paidSum = h('p', { class: 'ox-sum', role: 'status' }), paidDrawer = h('p', { class: 'ox-sum ox-drawer' });
    const openPanel = h('div', { class: 'ox-panel' }, openList, openEmpty);
    const paidPanel = h('div', { class: 'ox-panel', hidden: true }, paidSum, paidDrawer, paidList, paidEmpty);
    const tabs = SB.ui.segmented({
      kind: 'tabs', label: 'Orders', class: 'fs-tabs',
      options: [{ id: 'open', label: 'Open', icon: 'receipt', count: 0 }, { id: 'paid', label: 'Paid today', icon: 'dollar', count: 0 }],
      value: opts.tab === 'paid' ? 'paid' : 'open',
      // Tapping a tab shows its list and hides the other.
      onChange: (id) => showTab(id),
    });
    openPanel.id = U.uid('ox-open'); paidPanel.id = U.uid('ox-paid');
    tabs.querySelector('[data-id="open"]').setAttribute('aria-controls', openPanel.id);
    tabs.querySelector('[data-id="paid"]').setAttribute('aria-controls', paidPanel.id);
    host.body.append(h('div', { class: 'ox' }, h('div', { class: 'ox-bar' }, tabs, newBtn), openPanel, paidPanel));
    // Shows one list and hides the other.
    function showTab(id) { setHidden(openPanel, id !== 'open'); setHidden(paidPanel, id !== 'paid'); }

    // Builds one open-order row once; updateOpenRow fills it in place.
    function makeOpenRow(o) {
      const who = h('span', { class: 'ox-who', dir: 'auto' }), ch = h('span', { class: 'chip ox-ch' });
      const round = h('span', { class: 'chip ox-round', hidden: true }), demo = h('span', { class: 'chip', dataset: { tone: 'info' }, hidden: true }, 'Demo');
      const items = h('div', { class: 'ox-items' }), meta = h('div', { class: 'ox-meta' });
      const total = h('span', { class: 'ox-total num' }), sub = h('span', { class: 'ox-sub num' });
      const add = h('button', { type: 'button', class: 'btn ox-add', dataset: { act: 'add' } }, ico('plus', 20), h('span', null, 'Add items'));
      const quick = h('button', { type: 'button', class: 'btn btn-primary ox-quick', dataset: { act: 'quickpay' } }, ico('dollar', 20), h('span', null, 'Pay'));
      // Shows how Pay will record the money (Pay with Cash, Card or Other); one tap here changes it, so a card is never booked as cash by accident.
      const how = h('button', { type: 'button', class: 'btn ox-how', dataset: { act: 'method' } }, h('span', { class: 'ox-how-k' }, 'Pay with'), h('span', { class: 'ox-how-v' }, ''), ico('chevron-down', 18));
      const pay = h('button', { type: 'button', class: 'btn ox-take', dataset: { act: 'pay' } }, ico('receipt', 20), h('span', null, 'Tip or discount'));
      const del = h('button', { type: 'button', class: 'btn btn-ghost ox-void', dataset: { act: 'void' }, hidden: true }, ico('trash', 20), h('span', null, 'Void empty order'));
      const el = h('li', { class: 'ox-row', dataset: { order: o.id } },
        h('div', { class: 'ox-main' }, h('div', { class: 'ox-top' }, who, ch, round, demo), items, meta),
        h('div', { class: 'ox-money' }, total, sub),
        h('div', { class: 'ox-acts' }, add, pay, how, quick, del));
      const rec = { el, o, who, ch, round, demo, items, meta, total, sub, add, pay, quick, how, del, chKey: '' };
      // Add items closes this screen and opens New ticket already pointed at this order.
      add.addEventListener('click', () => {
        const id = rec.o.id;
        if (host.isPage) { SB.sheets.open('order', { orderId: id }); return; }
        host.close('add'); setTimeout(() => SB.sheets.open('order', { orderId: id }), 60);
      });
      // Tip or discount opens the payment box; Pay marks it paid at once the usual way, with Undo.
      pay.addEventListener('click', () => openPay(rec.o.id));
      quick.addEventListener('click', () => quickPay(rec.o.id));
      how.addEventListener('click', () => SB.ui.menu(how, C.payMethods.map((pm) => ({ label: pm.name, checked: pm.id === lastMethod, onClick: () => { setMethod(pm.id); update(); } })), { label: 'Pay with' }));
      // Void order closes an order that has no food left on it, and says so.
      del.addEventListener('click', () => {
        const r = run('voidOrder', { orderId: rec.o.id, reason: 'nothing ordered' });
        if (r.report === 'ok') toast('Empty order voided.', 'info'); else toast(say(r), 'warn');
      });
      return rec;
    }
    // Refreshes one open-order row: who, what is on it, how long it has been open and what it comes to.
    function updateOpenRow(rec, o, state, totals, now) {
      rec.o = o;
      const lines = foodLines(state, o.id), tot = totals.get(o.id) || { subtotal: 0, tax: 0, total: 0, rounds: 0 };
      text(rec.who, whoOf(o));
      const ch = channelOf(o.channel);
      if (rec.chKey !== o.channel) { rec.chKey = o.channel; U.clear(rec.ch); rec.ch.append(ico(ch.icon, 16), h('span', null, ch.name)); }
      setHidden(rec.round, tot.rounds < 2); text(rec.round, tot.rounds + ' rounds');
      setHidden(rec.demo, o.src !== 'demo' || !!(SB.store.isDemo && SB.store.isDemo()));
      text(rec.items, lines.length ? itemsLine(lines) : 'Nothing on this order any more.');
      const live = state.tickets.filter((t) => t.orderId === o.id && t.status !== 'voided');
      const out = live.filter((t) => t.status === 'expedited').length;
      const kitchen = !live.length ? '' : live.length === 1 ? (out ? ' Out of the kitchen.' : ' Still in the kitchen.') : ' ' + out + ' of ' + live.length + ' rounds out of the kitchen.';
      text(rec.meta, 'Opened ' + U.fmtTime(o.createdAt) + ', ' + ago(now - o.createdAt) + '.' + kitchen);
      text(rec.total, money(tot.total));
      text(rec.sub, tot.tax > 0 ? money(tot.subtotal) + ' food + ' + money(tot.tax) + ' tax' : lines.length ? 'before tip' : '');
      rec.pay.disabled = !(tot.subtotal > 0);
      rec.quick.disabled = !(tot.subtotal > 0);
      text(rec.quick.lastChild, 'Pay ' + money(tot.total) + ' ' + methodWord(lastMethod));
      text(rec.how.querySelector('.ox-how-v'), C.payMethodById[lastMethod].name);
      rec.how.setAttribute('aria-label', 'Pay with ' + C.payMethodById[lastMethod].name + '. Press to change how this is paid.');
      setHidden(rec.how, live.length === 0);
      setHidden(rec.quick, live.length === 0);
      setHidden(rec.del, live.length > 0);
      setHidden(rec.pay, live.length === 0);
    }
    // Builds one paid-order row once; updatePaidRow fills it in place.
    function makePaidRow(o) {
      const who = h('span', { class: 'ox-who', dir: 'auto' }), ch = h('span', { class: 'chip ox-ch' });
      const items = h('div', { class: 'ox-items' }), meta = h('div', { class: 'ox-meta' });
      const total = h('span', { class: 'ox-total num' }), sub = h('span', { class: 'ox-sub num' });
      const reopen = h('button', { type: 'button', class: 'btn ox-reopen', dataset: { act: 'reopen' } }, ico('history', 20), h('span', null, 'Reopen'));
      const el = h('li', { class: 'ox-row ox-row-paid', dataset: { order: o.id } },
        h('div', { class: 'ox-main' }, h('div', { class: 'ox-top' }, who, ch), items, meta),
        h('div', { class: 'ox-money' }, total, sub), h('div', { class: 'ox-acts' }, reopen));
      const rec = { el, o, who, ch, items, meta, total, sub, reopen, chKey: '' };
      // Reopen puts a paid order back in Open, for a wrong way of paying or a forgotten item.
      reopen.addEventListener('click', () => {
        const r = run('reopenOrder', { orderId: rec.o.id });
        if (r.report === 'ok') toast('Order reopened. It is back in Open; the payment was cleared.', 'info'); else toast(say(r), 'warn');
      });
      return rec;
    }
    // Refreshes one paid-order row: who, what was ordered, how it was paid and the amounts.
    function updatePaidRow(rec, o, state) {
      rec.o = o;
      text(rec.who, whoOf(o));
      const ch = channelOf(o.channel);
      if (rec.chKey !== o.channel) { rec.chKey = o.channel; U.clear(rec.ch); rec.ch.append(ico(ch.icon, 16), h('span', null, ch.name)); }
      const lines = foodLines(state, o.id), t = o.totals || {}, pm = C.payMethodById[o.method];
      text(rec.items, lines.length ? itemsLine(lines) : 'Items are no longer on the board.');
      text(rec.meta, 'Paid ' + U.fmtTime(o.paidAt) + ' by ' + (pm ? pm.name.toLowerCase() : o.method) + '.' + (o.tip > 0 ? ' Tip ' + money(o.tip) + '.' : '') + (t.discount > 0 ? ' Discount ' + money(t.discount) + '.' : '') + (t.rounds > 1 ? ' ' + t.rounds + ' rounds.' : ''));
      // A sale from a day that was already closed cannot be opened again, so say so on the button before the tap.
      const lc = state.lastClose, shut = !!(lc && isFinite(o.paidAt) && U.serviceDate(o.paidAt, state.settings.service.dayStartHour) <= lc.day);
      if (rec.shut !== shut) {
        rec.shut = shut;
        U.clear(rec.reopen);
        rec.reopen.append(ico('history', 20), h('span', null, shut ? 'Closed day: cannot reopen' : 'Reopen'));
        rec.reopen.classList.toggle('is-shut', shut);
        if (shut) rec.reopen.setAttribute('aria-disabled', 'true'); else rec.reopen.removeAttribute('aria-disabled');
        rec.reopen.title = shut ? 'Tap to see why.' : '';
      }
      text(rec.total, money(t.total));
      text(rec.sub, t.tax > 0 ? 'incl. ' + money(t.tax) + ' tax' : '');
    }
    // What was taken today: orders, net sales, tax, tips, and the money in each place it went.
    function paintPaidSummary(paid) {
      let net = 0, tax = 0, tips = 0;
      const by = {};
      paid.forEach((o) => {
        const t = o.totals || {};
        net += (t.subtotal || 0) - (t.discount || 0); tax += t.tax || 0; tips += o.tip || 0;
        by[o.method] = (by[o.method] || 0) + (t.total || 0) + (o.tip || 0);
      });
      text(paidSum, paid.length ? paid.length + ' ' + U.plural(paid.length, 'order') + ' paid today. Sales ' + money(net) + ', tax ' + money(tax) + ', tips ' + money(tips) + '.' : '');
      text(paidDrawer, paid.length ? C.payMethods.map((pm) => pm.name + ' ' + money(by[pm.id] || 0)).join(', ') + '. Cash is what should be in the drawer, besides the starting float.' : '');
      setHidden(paidSum, !paid.length); setHidden(paidDrawer, !paid.length);
    }
    // The timer that builds the rest of a long list of open orders.
    let moreT = 0;
    // Keeps both lists in step with the store.
    function update() {
      const state = st(), now = nowMs();
      const sd = U.serviceDate(now, state.settings.service.dayStartHour);
      const open = (state.orders || []).filter((o) => o.status === 'open').sort((a, b) => a.createdAt - b.createdAt);
      // Paid today goes by the time of payment, as the day close counts it: a tab opened yesterday and paid today is today's.
      const paid = (state.orders || []).filter((o) => o.status === 'paid' && U.isNum(o.paidAt) && U.serviceDate(o.paidAt, state.settings.service.dayStartHour) === sd).sort((a, b) => b.paidAt - a.paidAt);
      const totals = E().openOrderTotals(state);
      // A long list of open orders fills in over a few frames: the first screenful at once, then 30 more rows per frame.
      const more = reconcile(openList, openRows, open, makeOpenRow, (rec, o) => updateOpenRow(rec, o, state, totals, now), openRows.size ? 30 : 16);
      if (more && !moreT) moreT = setTimeout(() => { moreT = 0; if (offs.length) update(); }, 16);
      reconcile(paidList, paidRows, paid.slice(0, 80), makePaidRow, (rec, o) => updatePaidRow(rec, o, state));
      paintPaidSummary(paid);
      tabs.setCount('open', open.length); tabs.setCount('paid', paid.length);
      setHidden(openEmpty, open.length > 0); setHidden(paidEmpty, paid.length > 0);
    }
    offs.push(SB.store.subscribe(() => update()));
    offs.push(SB.store.subscribeTick(() => update()));
    update();
    showTab(tabs.getValue());
    // Stops the store and clock listeners once the frame is closed.
    const teardown = () => { offs.splice(0).forEach((f) => f()); if (moreT) { clearTimeout(moreT); moreT = 0; } };
    return { teardown };
  }

  /* ---------------------------------------------------------------------------------------------
   * The Take payment box
   * ------------------------------------------------------------------------------------------- */

  // Opens the payment box for an open order: discount, tip, how it was paid, and change due for cash.
  // Pressing Mark paid freezes the amounts on the order.
  function openPay(orderId) {
    const s0 = st(), o0 = E().findOrder(s0, orderId);
    if (!o0 || o0.status !== 'open') { toast('That order is not open any more.', 'warn'); return null; }
    const P = { method: lastMethod, disc: '', tip: '', cash: '' };
    // Rounds a dollar amount to whole cents.
    const r2 = (v) => Math.round(v * 100) / 100;
    const offs = [];
    // Set below; the sheet may ask for its first focus before the choice exists.
    let methodSeg = null;
    const sheet = SB.ui.sheet({
      title: 'Take payment', side: 'center', width: 560, name: 'order-pay',
      // The way-of-paying choice gets focus, so one tap on the right kind is all that is left to do.
      initialFocus: () => (methodSeg ? methodSeg.querySelector('[aria-checked="true"]') : null),
      onClose: () => offs.splice(0).forEach((f) => f()),
    });
    SB.ui.sheetHelp(sheet, 'getting-started', 'taking payment');

    const ch = channelOf(o0.channel);
    const head = h('p', { class: 'ox-pay-who' }, h('strong', null, whoOf(o0)), h('span', { class: 'chip ox-ch' }, ico(ch.icon, 16), h('span', null, ch.name)));
    const itemsP = h('p', { class: 'ox-pay-items' });
    // The order's money lines, rewritten whenever the discount changes.
    const calc = h('dl', { class: 'ox-calc' });
    const discInput = h('input', { class: 'input ox-pay-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Discount amount' });
    const discField = SB.ui.field({ label: 'Discount (optional)', control: discInput });
    const tipInput = h('input', { class: 'input ox-pay-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Tip amount' });
    const tipField = SB.ui.field({ label: 'Tip (optional)', control: tipInput });
    const cashInput = h('input', { class: 'input ox-pay-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': 'Cash the guest handed over' });
    const cashField = SB.ui.field({ label: 'Cash handed over (to work out the change)', control: cashInput });
    const change = h('p', { class: 'ox-change', role: 'status' });
    const err = h('p', { class: 'ox-pay-err', role: 'alert', hidden: true });

    // Quick amounts that fill a box. Each chip is a fixed dollar amount or a share of a base figure.
    const quick = [];
    // Makes a row of quick chips for a box; tapping one writes that amount into the box.
    function chipRow(label, defs, key, base) {
      const row = h('div', { class: 'ox-chips', role: 'group', 'aria-label': label });
      defs.forEach((d) => {
        // The dollars this chip stands for right now (a share of the base figure, or a fixed amount). A share uses the
        // same half-cent rule as the New ticket screen (orderMath.pctOfDollars), so 15% shows the same cents on both.
        const amount = () => (d.roundUp ? roundUpTip(orderTotal()) : d.pct ? SB.orderMath.pctOfDollars(base(), Math.round(d.pct * 100)) : d.fixed || 0);
        const b = SB.ui.chip({
          label: d.label, pressed: false,
          // Writes this chip's amount into the box (or clears it) and repaints the totals.
          onClick: () => { P[key] = amount() > 0 ? amount().toFixed(2) : ''; (key === 'disc' ? discInput : tipInput).value = P[key]; paint(); },
        });
        quick.push({ el: b, key, amount, def: d });
        row.appendChild(b);
      });
      return row;
    }
    // The food total before any discount, read fresh so a paid-in-the-meantime order is noticed.
    const food = () => { const o = E().findOrder(st(), orderId); return o && o.status === 'open' ? E().orderTotals(st(), o).subtotal : 0; };
    // The food total less the typed discount, which tips are worked out from.
    const net = () => Math.max(0, food() - (Number.isNaN(U.parseDollars(P.disc)) ? 0 : U.parseDollars(P.disc)));
    const discChips = chipRow('Quick discounts', [{ label: 'None' }, { label: '10%', pct: 0.1 }, { label: '20%', pct: 0.2 }], 'disc', food);
    // The order total (food less discount, plus tax) before any tip; the Round up tip is worked from it.
    const orderTotal = () => { const o = E().findOrder(st(), orderId), d = U.parseDollars(P.disc); return o && o.status === 'open' ? E().orderTotals(st(), o, { discount: Number.isNaN(d) ? 0 : d }).total : 0; };
    const tipChips = chipRow('Quick tips', [
      { label: 'No tip' }, { label: '15%', pct: 0.15, show: true }, { label: '18%', pct: 0.18, show: true }, { label: '20%', pct: 0.2, show: true },
      { label: '25%', pct: 0.25, show: true }, { label: 'Round up', roundUp: true, show: true },
    ], 'tip', net);
    // Cash the guest may hand over: a row of buttons that fill the cash box, rebuilt as the amount due changes.
    const cashChips = h('div', { class: 'ox-chips ox-cash-chips', role: 'group', 'aria-label': 'Cash handed over' });
    let cashSig = '';
    // Shows the likely bills for the amount due; tapping one writes it into the cash box.
    function paintCashChips(owe) {
      const opts = cashChoices(owe), sig = opts.map((c) => c.amount).join('|');
      if (sig !== cashSig) {
        cashSig = sig; U.clear(cashChips);
        opts.forEach((c) => {
          // Writes this amount into the cash box and works out the change.
          const pick = () => { P.cash = c.amount.toFixed(2); cashInput.value = P.cash; paint(); };
          cashChips.appendChild(SB.ui.chip({ label: c.label + (c.label === 'Exact' ? ' ' + money(c.amount) : ''), onClick: pick }));
        });
      }
      Array.from(cashChips.children).forEach((b, i) => b.setAttribute('aria-pressed', !Number.isNaN(U.parseDollars(P.cash)) && Math.abs(U.parseDollars(P.cash) - opts[i].amount) < 0.005 ? 'true' : 'false'));
    }
    methodSeg = SB.ui.segmented({
      label: 'How it was paid', class: 'ox-method', value: P.method,
      options: C.payMethods.map((pm) => ({ id: pm.id, label: pm.name })),
      // Picking cash shows the change helper; any pick is remembered for next time.
      onChange: (id) => { P.method = id; paint(); },
    });
    // Cancel closes the box and leaves the order open, untouched.
    const cancelBtn = h('button', { type: 'button', class: 'btn', onClick: () => sheet.close('cancel') }, 'Cancel');
    const payBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg ox-pay-go' }, ico('check', 22), h('span', null, 'Mark paid'));
    sheet.body.append(h('div', { class: 'ox-pay' },
      head, itemsP, calc,
      h('div', { class: 'ox-pay-block' }, h('div', { class: 'ord-label' }, 'How it was paid'), methodSeg),
      cashField, cashChips, change,
      h('div', { class: 'ox-pay-block' }, tipField, tipChips),
      h('div', { class: 'ox-pay-block' }, discField, discChips),
      err));
    sheet.footer.append(cancelBtn, payBtn);

    // Reads the boxes: the discount, tip and cash as numbers, or the first problem in plain words.
    function read() {
      const d = U.parseDollars(P.disc), t = U.parseDollars(P.tip), c = U.parseDollars(P.cash);
      if (Number.isNaN(d)) return { err: 'Type the discount as an amount, like 2.50.', box: discInput };
      if (d > food() + 1e-9) return { err: 'The discount cannot be more than the food, ' + money(food()) + '.', box: discInput };
      if (Number.isNaN(t)) return { err: 'Type the tip as an amount, like 2.50.', box: tipInput };
      if (Number.isNaN(c)) return { err: 'Type the cash as an amount, like 40.00.', box: cashInput };
      return { d, t, c };
    }
    // Redraws the lines, the money rows, chip states, the change line and the Mark paid button.
    function paint() {
      const state = st(), o = E().findOrder(state, orderId);
      if (!o || o.status !== 'open') { sheet.close('gone'); return; }
      text(itemsP, itemsLine(foodLines(state, orderId)));
      const r = read();
      const d = r.err ? 0 : r.d;
      const tot = E().orderTotals(state, o, { discount: d });
      const rows = [['Food', money(tot.subtotal)]];
      if (tot.discount > 0) rows.push(['Discount', '-' + money(tot.discount)]);
      if (tot.taxRate > 0) rows.push(['Tax (' + tot.taxRate + '%)', money(tot.tax)]);
      rows.push(['Order total', money(tot.total)]);
      const tip = r.err || Number.isNaN(r.t) ? 0 : r.t;
      if (tip > 0) rows.push(['Tip', money(tip)], ['To collect', money(Math.round(tot.total * 100 + tip * 100 + 1e-7) / 100)]);
      U.clear(calc);
      rows.forEach((row, i) => calc.append(h('dt', { class: i === rows.length - 1 ? 'is-last' : '' }, row[0]), h('dd', { class: 'num' + (i === rows.length - 1 ? ' is-last' : '') }, row[1])));
      quick.forEach((q) => {
        // Tip buttons show their dollar amount; Round up hides when the total is already a whole dollar.
        if (q.def.show) { const amt = q.amount(); text(q.el.lastChild, q.def.roundUp ? 'Round up ' + money(amt) : q.def.label + ' ' + money(amt)); setHidden(q.el, q.def.roundUp && amt <= 0); }
        const typed = U.parseDollars(P[q.key]); q.el.setAttribute('aria-pressed', !Number.isNaN(typed) && Math.abs(typed - q.amount()) < 0.005 ? 'true' : 'false'); });
      setHidden(cashField, P.method !== 'cash');
      const owe = r2(tot.total + tip), given = r.err ? 0 : r.c;
      setHidden(cashChips, P.method !== 'cash');
      if (P.method === 'cash') paintCashChips(owe);
      setHidden(change, P.method !== 'cash');
      text(change, !(given > 0) ? 'Tap what the guest handed over to see the change.' : given >= owe ? 'Change due: ' + money(changeFor(given, owe)) : 'Short by ' + money(changeFor(owe, given)) + '.');
      change.dataset.short = given >= owe ? 'false' : 'true';
      text(payBtn.lastChild, 'Mark paid, ' + money(owe));
      payBtn.disabled = tot.subtotal <= 0;
      setHidden(err, !r.err); text(err, r.err || '');
    }
    discInput.addEventListener('input', () => { P.disc = discInput.value; paint(); });
    tipInput.addEventListener('input', () => { P.tip = tipInput.value; paint(); });
    cashInput.addEventListener('input', () => { P.cash = cashInput.value; paint(); });
    // Mark paid sends the payment to the engine; a refusal is shown in words and nothing is lost.
    // WATCH OUT: once paid, a second tap (a double tap while the box closes) does nothing, so it shows no "not open" error.
    let paidDone = false;
    payBtn.addEventListener('click', () => {
      if (paidDone) return;
      const r = read();
      if (r.err) { setHidden(err, false); text(err, r.err); r.box.focus(); return; }
      const res = run('payOrder', { orderId, method: P.method, tip: r.t, discount: r.d });
      if (res.report === 'ok') {
        paidDone = true;
        setMethod(P.method);
        sheet.close('paid');
        const info = res.info || {}, pm = C.payMethodById[P.method];
        toast('Paid ' + money(info.total) + ' by ' + (pm ? pm.name.toLowerCase() : P.method) + (r.t > 0 ? ', plus a ' + money(r.t) + ' tip' : '') + '.', 'ok');
        return;
      }
      setHidden(err, false); text(err, say(res));
    });
    // The order can change while the box is open (a round is added elsewhere); keep the amounts true.
    offs.push(SB.store.subscribe(() => paint()));
    paint();
    return sheet;
  }

  SB.sheets.register('orders', openOrders);
  // The router layer calls SB.orders.mount(el) and keeps the cleanup function it gets back.
  const mountForRouter = (el, opts) => mountPage(el, opts).destroy;
  SB.orders = { mount: mountForRouter, mountPage, open: openOrders };
})(typeof globalThis !== 'undefined' ? globalThis : window);
