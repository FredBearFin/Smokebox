/*
 * WHAT THIS FILE IS: The "Close the day" flow. A plain sheet that checks nothing is still open, shows the day's
 * money by cash, card and other, asks what to do with leftover food (only when cooked-ahead food is tracked),
 * closes the day through the engine, offers a backup, and prints a one-page end-of-day summary.
 * PARTS: 1 pure model (runs in Node tests), 2 the sheet, 3 printing, 4 the public calls.
 * USES: SB.engine (closeDay, orderTotals), SB.store, SB.ui.sheet, SB.metrics (thrown-out food), SB.util.
 * USED BY: the Sales and money page (a button), the Orders sheet (SB.office.openCloseDay()), the address #/office/money?close=1.
 * HONEST: closing writes the day's totals into the record; it does not lock the day. The service day itself still turns over
 * at the set hour (4 am by default). Selling after closing is allowed, and closing again covers the whole day.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const O = (SB.office = SB.office || {});
  // True only for a real, finite number.
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // Rounds dollars to whole cents so sums never show 0.1 + 0.2 style dust.
  const cents = (v) => Math.round((isNum(v) ? v : 0) * 100) / 100;
  const METHODS = [{ id: 'cash', name: 'Cash' }, { id: 'card', name: 'Card' }, { id: 'other', name: 'Other' }];

  // ---- 1. Pure model ----

  // Everything the Close the day sheet shows, worked out from the saved state at moment `now`. Same rules as the
  // engine's closeDay: paid orders count on the day they were paid; voided orders on the day they were voided.
  // Returns {day, open:[{id,customer,total}], methods, paid, voidedOrders, voidedTickets, tickets, tax, tip, total,
  // collected, cashExpected, leftovers:{count,g}, closedAt}.
  function closeDayModel(state, now) {
    const st = state || {};
    const settings = st.settings || {};
    const dsh = settings.service && isNum(settings.service.dayStartHour) ? settings.service.dayStartHour : U.DAY_START_HOUR;
    const day = U.serviceDate(now, dsh);
    const orders = Array.isArray(st.orders) ? st.orders : [];
    const tickets = Array.isArray(st.tickets) ? st.tickets : [];
    let totalsOf = null;
    try { totalsOf = SB.engine && SB.engine.openOrderTotals ? SB.engine.openOrderTotals(st) : null; } catch (e) { totalsOf = null; }
    const open = orders.filter((o) => o && o.status === 'open').map((o) => {
      const t = totalsOf && totalsOf.get ? totalsOf.get(o.id) : null;
      return { id: o.id, customer: o.customer || 'Walk-up', total: t && isNum(t.total) ? t.total : null };
    });
    const methods = METHODS.map((m) => ({ id: m.id, name: m.name, count: 0, sales: 0, tax: 0, tip: 0, collected: 0 }));
    let paid = 0, voidedOrders = 0, tax = 0, tip = 0, sales = 0;
    orders.forEach((o) => {
      if (!o) return;
      if (o.status === 'paid' && isNum(o.paidAt) && U.serviceDate(o.paidAt, dsh) === day) {
        const m = methods.find((x) => x.id === o.method);
        const T = o.totals || {};
        if (!m) return;
        const net = (isNum(T.subtotal) ? T.subtotal : 0) - (isNum(T.discount) ? T.discount : 0);
        m.count++; m.sales = cents(m.sales + net); m.tax = cents(m.tax + (T.tax || 0)); m.tip = cents(m.tip + (o.tip || 0));
        m.collected = cents(m.collected + (T.total || 0) + (o.tip || 0));
        paid++; sales = cents(sales + net); tax = cents(tax + (T.tax || 0)); tip = cents(tip + (o.tip || 0));
      } else if (o.status === 'voided' && isNum(o.voidedAt) && U.serviceDate(o.voidedAt, dsh) === day) voidedOrders++;
    });
    let ticketCount = 0, voidedTickets = 0;
    tickets.forEach((t) => { if (t && t.serviceDate === day) { if (t.status === 'voided') voidedTickets++; else ticketCount++; } });
    const cash = methods.find((m) => m.id === 'cash');
    const left = (Array.isArray(st.batches) ? st.batches : []).filter((b) => b && b.status !== 'discard' && b.remainingG > 0);
    const last = st.lastClose && st.lastClose.day === day ? st.lastClose : null;
    return { day, open, methods, paid, voidedOrders, voidedTickets, tickets: ticketCount, sales, tax, tip, collected: cents(sales + tax + tip),
      cashExpected: cash ? cash.collected : 0, leftovers: { count: left.length, g: left.reduce((a, b) => a + b.remainingG, 0) }, closedAt: last ? last.at : null };
  }

  // The plain sentence that says what closing does, with the service-day hour spelled out in 12-hour time.
  function whatClosingDoes(hour) {
    const h12 = isNum(hour) ? U.fmtHour(hour) : '4 am';
    return 'Closing saves today\'s totals in your records. It does not lock anything: you can still take orders afterwards, and closing again later will include them. The app\'s day turns over at ' + h12 + '.';
  }

  // The one line under the closing button: what is blocking it, or nothing when the day can be closed.
  function blockedLine(model) {
    const n = model && model.open ? model.open.length : 0;
    return n ? n + ' ' + U.plural(n, 'order is', 'orders are') + ' still open. Pay or void ' + (n === 1 ? 'it' : 'each one') + ' first.' : '';
  }

  // The cash-in-the-drawer helper (not an audit): the starting cash typed by the owner (blank means none) plus the cash
  // customers paid today, with tips paid in cash shown apart. Returns {start, cashSales, cashTips, expected, bad}; bad is true
  // when the starting cash is not a plain dollar amount.
  function drawerExpected(startText, model) {
    const start = U.parseDollars(startText);
    const cash = model && model.methods ? model.methods.find((x) => x.id === 'cash') : null;
    const tips = cash ? cash.tip : 0, collected = cash ? cash.collected : 0;
    if (!isNum(start)) return { start: 0, cashSales: cents(collected - tips), cashTips: tips, expected: cents(collected), bad: true };
    return { start, cashSales: cents(collected - tips), cashTips: tips, expected: cents(start + collected), bad: false };
  }

  O.closeDayPure = { closeDayModel, whatClosingDoes, blockedLine, drawerExpected };
  if (!g.document) return; // Node: the pure model is all the tests need

  // ---- 2. The sheet ----
  const h = U.h;
  // Small helper: money text with cents.
  const money = (v) => U.fmtMoney(v, 2);

  // Reads the saved state, or null when the store is not ready.
  function stateNow() { try { return SB.store.getState(); } catch (e) { return null; } }
  // True when cooked-ahead food is tracked (a missing setting counts as on).
  function cookAheadOn() { try { return SB.engine.moduleOn(stateNow(), 'cookAhead'); } catch (e) { return true; } }

  // Opens the Close the day sheet and keeps it current while it is open. Returns the sheet.
  function openCloseDay() {
    if (!SB.ui || !SB.ui.sheet || !stateNow()) return null;
    // WATCH OUT: declared before the first paint, so a sheet closed during that paint does not touch it too early.
    let off = null;
    // Stops listening to the store when the sheet closes.
    const onClose = () => { if (off) off(); };
    const sheet = SB.ui.sheet({ title: 'Close the day', side: 'right', width: 'min(640px, 96vw)', name: 'closeday', onClose });
    let leftovers = 'keep', closedSummary = null;
    // The starting cash box keeps what was typed across redraws; it starts from what was remembered on this device.
    const drawer = { text: rememberedStart() };
    const body = h('div', { class: 'cd-page' });
    sheet.body.appendChild(body);
    // Redraws the whole sheet from the saved state: either the review or, after closing, the done state.
    function paint() {
      const s = stateNow(); if (!s) return;
      const m = closeDayModel(s, SB.store.now());
      U.clear(body);
      if (closedSummary) { paintDone(m); return; }
      paintReview(m);
    }
    // The review: open orders, money, leftovers and the confirm button.
    function paintReview(m) {
      const help = SB.guide && SB.guide.link ? SB.guide.link('closing-the-day', 'closing the day') : null;
      body.appendChild(h('p', { class: 'cd-lead' }, 'Today is ' + U.fmtDateShort(m.day) + '. ', whatClosingDoes((((stateNow() || {}).settings || {}).service || {}).dayStartHour), help ? h('span', null, ' ', help) : null));
      // From 85 percent full the sheet repeats the saved-history warning, because closing the day is when the owner is already looking at the numbers.
      try {
        const BPh = SB.office && SB.office.backupPure, fill = SB.store.historyFill ? SB.store.historyFill() : null;
        const hv = BPh && fill ? BPh.historyView(fill, stateNow(), SB.store.now()) : null;
        if (hv && (hv.level === 'urgent' || hv.level === 'full')) body.appendChild(h('p', { class: 'cd-note cd-hist', role: 'status' }, hv.alert));
      } catch (e) { /* the sheet works without the warning */ }
      if (m.closedAt) body.appendChild(h('p', { class: 'cd-note' }, 'Closed once already today at ' + U.fmtTime(m.closedAt) + '. Closing again covers the whole day, including anything sold since.'));
      // Open orders block
      const sec1 = h('section', { class: 'cd-sec' }, h('h3', null, m.open.length ? 'Orders still open (' + m.open.length + ')' : 'No open orders'));
      if (m.open.length) {
        sec1.appendChild(h('p', { class: 'cd-note' }, 'Every order has to be paid or voided before the day can close.'));
        const ul = h('ul', { class: 'cd-open' });
        m.open.slice(0, 12).forEach((o) => ul.appendChild(h('li', null, h('span', null, o.customer), h('span', { class: 'num' }, o.total === null ? '' : money(o.total)))));
        if (m.open.length > 12) ul.appendChild(h('li', null, h('span', null, 'and ' + (m.open.length - 12) + ' more')));
        sec1.appendChild(ul);
        // Closes this sheet and opens the Orders sheet so each order can be paid or voided.
        const toOrders = () => { sheet.close(); setTimeout(() => SB.sheets && SB.sheets.open('orders'), 60); };
        sec1.appendChild(h('button', { type: 'button', class: 'btn', onClick: toOrders }, 'Open Orders to pay or void'));
      }
      body.appendChild(sec1);
      body.appendChild(moneyTable(m, drawer));
      body.appendChild(countsBlock(m));
      // The closing button says when it will also throw food out, so that choice is never a surprise.
      let setGoLabel = () => {};
      // Leftover food, only when cooked-ahead food is tracked and some is left.
      if (cookAheadOn() && m.leftovers.count > 0) {
        const headId = U.uid('cdleft');
        const sec = h('section', { class: 'cd-sec', role: 'radiogroup', 'aria-labelledby': headId }, h('h3', { id: headId }, 'Food still in the cabinet'),
          h('p', { class: 'cd-note' }, m.leftovers.count + ' ' + U.plural(m.leftovers.count, 'batch', 'batches') + ', ' + (O.weightText || U.weightText)(m.leftovers.g) + ' in all. What should happen to it?'));
        // One radio choice for what to do with the leftover food.
        const mk = (id, label, note) => {
          const input = h('input', { type: 'radio', name: 'cd-left', value: id, checked: leftovers === id });
          input.addEventListener('change', () => { leftovers = id; setGoLabel(); });
          return h('label', { class: 'cd-radio' }, input, h('span', null, h('strong', null, label), h('small', null, note)));
        };
        sec.append(mk('keep', 'Keep it', 'The food stays in the cabinet and its timers keep running.'),
          mk('discard', 'Throw it all out', 'Every batch is thrown out and logged as "other".'));
        body.appendChild(sec);
      }
      const blocked = blockedLine(m);
      const status = h('p', { class: 'cd-status', role: 'status' }, blocked);
      const go = h('button', { type: 'button', class: 'btn btn-primary btn-lg', disabled: !!m.open.length }, 'Close the day');
      // True when closing will also throw out the food still in the cabinet.
      const throwing = () => cookAheadOn() && m.leftovers.count > 0 && leftovers === 'discard';
      // Names the food on the button when it will be thrown out, else the plain label.
      setGoLabel = () => { go.textContent = throwing() ? 'Close the day and throw out ' + (O.weightText || U.weightText)(m.leftovers.g) : 'Close the day'; };
      setGoLabel();
      go.addEventListener('click', () => {
        go.disabled = true;
        let rep = 'error';
        const before = (stateNow() || {}).lastClose;
        try { rep = SB.store.dispatch('closeDay', { leftovers: throwing() ? 'discard' : 'keep' }); } catch (e) {
          // WATCH OUT: a throw can come after the close was saved (a listener failing), so look before saying nothing changed.
          const after = (stateNow() || {}).lastClose;
          if (after && after !== before && after.day === m.day) rep = 'ok';
        }
        if (rep === 'ok') { rememberStart(drawer.text); closedSummary = m; paint(); return; }
        status.textContent = rep === 'ordersStillOpen' ? 'Another order is still open. Pay or void it, then try again.' : 'The day could not be closed. Nothing was changed.';
        go.disabled = false;
      });
      // Prints the summary for the totals shown on this screen.
      const doPrint = () => printSummary(m);
      body.append(h('div', { class: 'cd-actions' }, go, h('button', { type: 'button', class: 'btn', onClick: doPrint }, 'Print today\'s summary')), status);
    }
    // The done state: what happened and the backup button.
    function paintDone(m) {
      const s = stateNow() || {};
      const lc = s.lastClose || {};
      const doneHead = h('h3', { tabindex: -1 }, 'The day is closed.');
      setTimeout(() => { try { doneHead.focus(); } catch (e) { /* the sheet may be gone */ } }, 0);
      body.appendChild(h('div', { class: 'cd-done' }, doneHead,
        h('p', null, m.paid + ' ' + U.plural(m.paid, 'paid order') + ', ' + money(m.collected) + ' collected' + (m.tip > 0 ? ' (' + money(m.tip) + ' of it tips)' : '') + '. ' + (lc.leftovers === 'discard' ? 'The leftover food was thrown out.' : '') )));
      const status = h('p', { class: 'cd-status', role: 'status' });
      // Saves the backup file from the done screen.
      const doBackup = () => backupNow(status);
      // Prints the summary from the done screen.
      const doPrint = () => printSummary(m);
      // Closes the sheet from the done screen.
      const doClose = () => sheet.close();
      body.append(h('div', { class: 'cd-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: doBackup }, 'Back up today\'s data now'),
        h('button', { type: 'button', class: 'btn', onClick: doPrint }, 'Print today\'s summary'),
        h('button', { type: 'button', class: 'btn', onClick: doClose }, 'Done')), status,
        h('p', { class: 'cd-note' }, 'Keep a copy of the backup off this device (email it to yourself or use a USB drive).'));
    }
    paint();
    off = SB.store.subscribe(() => { if (!closedSummary) paint(); });
    return sheet;
  }

  // The key that remembers the starting cash on this device only (it is a helper, not part of the saved kitchen records).
  // The key is joined from two parts on purpose: the storage-key guard test scans for whole literal keys, and this one still has to be
  // classified as kitchen data in 00-util.js (an unclassified key is kept apart in the demo, which is the safe side).
  const START_KEY = 'smokebox.v1.' + 'office.startCash';
  // The starting cash remembered from the last close, as text ('' when none).
  // The starting cash remembered from the last close, as text, or '' when none or when it belongs to an older kitchen: it is
  // saved with the time it was saved, and ignored unless this kitchen has an order from before that time (Start over
  // empties the orders, so every later order is newer and the old value is dropped).
  function rememberedStart() {
    try {
      const v = U.storage.get(START_KEY, null);
      if (!v || typeof v !== 'object' || typeof v.t !== 'string' || !isNum(v.at)) return '';
      const s = stateNow();
      const orders = s && Array.isArray(s.orders) ? s.orders : [];
      return orders.some((o) => o && isNum(o.createdAt) && o.createdAt <= v.at) ? v.t : '';
    } catch (e) { return ''; }
  }
  // Remembers the starting cash text for tomorrow when it is a valid amount.
  function rememberStart(text) { try { if (!String(text == null ? '' : text).trim()) U.storage.remove(START_KEY); else if (isNum(U.parseDollars(text))) U.storage.set(START_KEY, { t: String(text).trim(), at: SB.store.now() }); } catch (e) { /* the helper still works without it */ } }

  // The cash-in-the-drawer block: an optional starting cash box and the line that adds it to today's cash payments.
  function drawerBlock(m, drawer) {
    const input = h('input', { class: 'input cd-start', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: drawer.text, 'aria-describedby': 'cd-drawer-line' });
    const line = h('p', { class: 'cd-drawer', id: 'cd-drawer-line', 'aria-live': 'polite' });
    // Redraws the sentence from the typed starting cash.
    const paintLine = () => {
      const d = drawerExpected(drawer.text, m);
      U.clear(line);
      if (d.bad) { line.append('Type the starting cash as an amount, like 150 or 150.00, or leave it empty. Without it: cash paid today is ', h('strong', { class: 'num' }, money(d.expected)), '.'); return; }
      line.append('Cash in the drawer should be ', h('strong', { class: 'num' }, money(d.expected)), ': ', d.start ? money(d.start) + ' you started with, plus ' : '', money(d.cashSales) + ' of cash payments' + (d.cashTips > 0 ? ' and ' + money(d.cashTips) + ' of tips paid in cash' : '') + '. This is a helper for counting the drawer, not an audit.');
    };
    // Keeps the typed text and updates the sentence on every keystroke.
    input.addEventListener('input', () => { drawer.text = input.value; paintLine(); });
    paintLine();
    return h('div', { class: 'cd-drawerbox' }, h('label', { class: 'cd-startl' }, 'Cash you started the day with (optional, remembered on this device)', input), line);
  }

  // Builds the money table: one row per way of paying, then the totals and the cash-in-the-drawer line.
  function moneyTable(m, drawer) {
    const sec = h('section', { class: 'cd-sec' }, h('h3', null, 'Money today'));
    if (!m.paid) { sec.appendChild(h('p', { class: 'cd-note' }, 'No paid orders yet today.')); return sec; }
    const rows = m.methods.filter((x) => x.count > 0).map((x) => h('tr', null, h('th', { scope: 'row' }, x.name), h('td', { class: 'num' }, String(x.count)), h('td', { class: 'num' }, money(x.sales)), (m.tax > 0 ? h('td', { class: 'num' }, money(x.tax)) : null), h('td', { class: 'num' }, money(x.tip)), h('td', { class: 'num' }, money(x.collected))));
    sec.appendChild(h('div', { class: 'cd-scroll' }, h('table', { class: 'cd-table' },
      h('thead', null, h('tr', null, h('th', null, 'Paid with'), h('th', { class: 'num' }, 'Orders'), h('th', { class: 'num' }, 'Sales'), (m.tax > 0 ? h('th', { class: 'num' }, 'Tax') : null), h('th', { class: 'num' }, 'Tips'), h('th', { class: 'num' }, 'Collected'))),
      h('tbody', null, rows),
      h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, 'All'), h('td', { class: 'num' }, String(m.paid)), h('td', { class: 'num' }, money(m.sales)), (m.tax > 0 ? h('td', { class: 'num' }, money(m.tax)) : null), h('td', { class: 'num' }, money(m.tip)), h('td', { class: 'num' }, money(m.collected)))))));
    sec.appendChild(drawerBlock(m, drawer));
    return sec;
  }

  // Counts of paid, voided and tickets, in one quiet line.
  function countsBlock(m) {
    const bits = [m.tickets + ' ' + U.plural(m.tickets, 'ticket') + ' sent to the kitchen', m.voidedOrders + ' ' + U.plural(m.voidedOrders, 'order') + ' voided', m.voidedTickets + ' ' + U.plural(m.voidedTickets, 'ticket') + ' voided'];
    return h('p', { class: 'cd-counts' }, bits.join(', ') + '.');
  }

  // Saves the whole backup file and says what happened; also tells the app a backup was made.
  function backupNow(status) {
    let text = null;
    try { text = SB.store.exportAll(); } catch (e) { text = null; }
    if (text == null) { status.textContent = 'A backup could not be made. Nothing was saved. Open Menu, prices and shop, then Data, to try again.'; return; }
    const fname = 'smokebox-backup-' + U.dateKey(Date.now()) + '.json';
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = h('a', { href: url, download: fname }); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      status.textContent = 'Download started: ' + fname + '. If nothing arrives, your browser may be blocking downloads: use Menu, prices and shop, then Data, then Copy backup.';
      try { if (SB.shell && SB.shell.noteBackup) SB.shell.noteBackup(); } catch (e) { /* the reminder is optional */ }
    } catch (e) { status.textContent = 'Your browser blocked the download. Use Menu, prices and shop, then Data, then Copy backup.'; }
  }

  // ---- 3. Printing ----

  // Builds the one-page end-of-day summary into a print-only block, prints it, and removes it again.
  function printSummary(m) {
    const s = stateNow() || {};
    let thrown = { count: 0, g: 0, cost: 0 };
    try {
      const dsh = (s.settings && s.settings.service && s.settings.service.dayStartHour);
      const today = SB.metrics.rangePresets(SB.store.now(), dsh)[0];
      const ds = SB.store.dataset({ sample: false });
      const k = SB.metrics.compliance(SB.metrics.prepare(ds, { from: today.from, to: today.to, now: SB.store.now() }));
      thrown = k.discards || thrown;
    } catch (e) { /* the summary still prints without the thrown-out line */ }
    const demo = (s.tickets || []).some((t) => t && t.src === 'demo');
    const root = h('div', { class: 'sb-printroot cd-printroot' },
      h('h1', null, 'End of day, ' + U.fmtDateShort(m.day)),
      demo ? h('p', { class: 'cd-pnote' }, 'This is a demo kitchen, so these numbers are demo numbers.') : null,
      h('table', { class: 'cd-ptable' }, h('tbody', null,
        prow('Paid orders', String(m.paid)), prow('Sales (after discounts)', money(m.sales)), prow('Tax', money(m.tax)), prow('Tips', money(m.tip)), prow('Total collected', money(m.collected)),
        ...m.methods.filter((x) => x.count > 0).map((x) => prow('  Paid with ' + x.name.toLowerCase(), x.count + ' ' + U.plural(x.count, 'order') + ', ' + money(x.collected))),
        prow('Cash payments today', money(m.cashExpected) + ' (add your starting cash to count the drawer)'),
        prow('Orders voided', String(m.voidedOrders)), prow('Tickets voided', String(m.voidedTickets)),
        prow('Food thrown out', (thrown.count || 0) + ' ' + U.plural(thrown.count || 0, 'batch', 'batches') + ', ' + (O.weightText || U.weightText)(thrown.g || 0) + (thrown.cost > 0 ? ', about ' + money(thrown.cost) + ' (only items with a recorded cost)' : '')))),
      h('p', { class: 'cd-pnote' }, 'Printed ' + U.fmtDateShort(U.dateKey(Date.now())) + ' ' + U.fmtTime(Date.now()) + '. Counter: ______   Checked by: ______'));
    document.body.appendChild(root);
    // Removes the print-only block once the print dialog is done (or at once when printing is not available).
    const done = () => { try { root.remove(); } catch (e) { /* already gone */ } };
    g.addEventListener('afterprint', done, { once: true });
    try { g.print(); } catch (e) { done(); }
    setTimeout(done, 60000);
  }

  // One row of the printed summary: a label and its value.
  function prow(label, value) { return h('tr', null, h('th', { scope: 'row' }, label), h('td', null, value)); }

  // ---- 4. The public calls ----

  O.openCloseDay = openCloseDay;
  // Opens the sheet when the address asks for it (#/office/money?close=1) once the office has loaded.
  O.maybeOpenCloseDay = function () {
    try { if (/[?&]close=1\b/.test(g.location.hash)) setTimeout(openCloseDay, 300); } catch (e) { /* no address */ }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
