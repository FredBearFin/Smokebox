/*
 * WHAT THIS FILE IS: The owner's first minutes. The "Dishes and prices" sheet (add a dish with a name, a price and where it is
 *    made, save and add another, edit or remove dishes later, an optional example menu), the small "Tax, hours and PIN"
 *    sheet, and the tablet checklist (sound, screen on, protected data, installed, placement). Setup is simply "at least
 *    one dish exists", so there is no finish flag that can get stuck.
 * PARTS: tablet checklist, helpers, dish form, dishes sheet, shop sheet, order guard, registration.
 * USES: 00-util.js, 05-icons.js, 60-shell.js (sheets), 70-floor-board.js (sound, speech, wake lock),
 *    76-floor-discards.js (storage). USED BY: the board's first-run screen and welcome card, and the Menu sheet.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util;
  const doc = g.document;
  if (!doc || !SB.sheets) return;
  const h = U.h;
  // Builds an icon element, or an empty span when icons are missing.
  const ico = (name, size) => { try { return SB.icons.svg(name, { size: size || 22 }); } catch (e) { return doc.createElement('span'); } };

  // Opens the setup checklist sheet, one step after another with plain words.
  function openSetup() {
    const sheet = SB.ui.sheet({ title: 'Set up this device', side: 'right', width: 'min(720px, 96vw)', name: 'setup' });
    const list = h('div', { class: 'setup-list' });
    // The quick way in: the five checks with ticks, so the long list below is only for reading.
    list.appendChild(h('div', { class: 'fs-row' }, h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'open-ready' }, onClick: () => { sheet.close('link'); setTimeout(() => SB.sheets.open('ready'), 60); } }, ico('check-circle', 22), h('span', null, 'Device checks: screen, sound, home screen'))));
    // Two help links in words, to the guide pages about setting up and about sound trouble, when the guide is in this build.
    const helpLink = (page, words) => { const a = SB.guide.link(page, words); a.className = 'btn btn-link setup-help'; a.removeAttribute('title'); a.removeAttribute('aria-label'); a.replaceChildren(ico('help', 18), h('span', null, words)); return a; };
    if (SB.guide && typeof SB.guide.link === 'function') list.appendChild(h('div', { class: 'fs-row setup-helps' }, helpLink('getting-started', 'Help with setup'), helpLink('troubleshooting', 'No sound?')));
    // Adds one checklist step: a title, plain words, an optional button and a status line.
    function step(title, words, action) {
      const status = h('p', { class: 'fs-sub', role: 'status' });
      const el = h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, title), h('p', { class: 'fs-sub' }, words), action ? action(status) : null, status);
      list.appendChild(el);
      return status;
    }
    // Runs a step's test and shows what it answers in the step's status line.
    const runStep = (status, fn) => { tell(status, fn() || ''); };
    // Builds a button that runs fn and shows its answer in the step's status line.
    const btn = (label, icon, fn) => (status) => h('button', { type: 'button', class: 'btn', onClick: () => runStep(status, fn) }, ico(icon, 20), h('span', null, label));

    step('1. Sound', 'Warnings use tones and a spoken voice. Browsers only allow sound after a tap, so test it here. Turn the volume up, or plug in a cheap Bluetooth speaker: a small built-in speaker is easy to miss in a loud kitchen.',
      btn('Play a test warning', 'volume', () => { if (SB.floor && SB.floor.setSound) { SB.floor.setSound(true); if (SB.floor.setSpeech) SB.floor.setSpeech(true); return 'Warning sounds and the spoken voice are now on for this device. You should have heard a chime and a voice. If not, turn the volume up and tap again.'; } return 'The kitchen board is not loaded.'; }));
    const wake = SB.floor && SB.floor.wakeLock ? SB.floor.wakeLock() : 'unknown';
    step('2. Keep the screen on', (wake === 'on' ? 'The board is keeping the screen awake now.' : 'The screen may go to sleep.') + ' Also set the device itself: Settings, Display, Auto-Lock (iPad) or Screen timeout (Android), to Never. Keep it plugged into power.');
    const prot = step('3. Protect your data', 'Everything is saved in this browser only. Ask the browser to keep it safe, and save a backup every day (Back office, Menu, prices and shop, then Data). If you cook ahead, save the thrown-out log too.',
      btn('Protect saved data', 'shield-check', () => { try { if (g.navigator.storage && g.navigator.storage.persist) { g.navigator.storage.persist().then((ok) => { prot.textContent = ok ? 'Your browser agreed to keep this data. Still save a backup every day.' : 'The browser did not agree. Installing the app (step 4) usually helps.'; }, () => { prot.textContent = 'The browser could not answer. Installing the app (step 4) usually helps. Save a backup every day.'; }); return 'Asking the browser...'; } } catch (e) { /* fall through */ } return 'This browser cannot do that. Save a backup every day.'; }));
    step('4. Install as an app', 'On an iPad: Share, then Add to Home Screen. In Chrome on Android or a computer: the menu, then Install app or Add to Home screen. An installed app opens full screen and the browser is less likely to clear its data.');
    step('5. Where the device sits', 'Put the tablet or screen where the person at the cutting board can tap it without walking. If it is out of reach, batch times will not get logged and the waste numbers will be wrong.');
    // Closes this sheet and opens the Menu, prices and shop page of the back office.
    const openData = () => { sheet.close('link'); setTimeout(() => { if (SB.shell && SB.shell.ignite) SB.shell.ignite({ section: 'data' }); }, 60); };
    step('6. Your dishes', 'Add your dishes under Dishes and prices, in Settings. Then open Menu, prices and shop to enter your real cost per kg, the amount at which a dish is sold out, the amount one take-out removes, the hold limit and the rest time for each product. Until you confirm them, all of these are starter values, the hold limits too.',
      () => h('button', { type: 'button', class: 'btn btn-primary', onClick: openData }, ico('sliders', 20), h('span', null, 'Open Menu, prices and shop')));
    step('7. Hold limits', 'Each product has a hold limit, marked as a quality limit or a throw-out time. Ask your health department which applies to each food you hold, then set it in Settings.');
    sheet.body.appendChild(list); keepInView(sheet.body);
    return sheet;
  }

  // When a box in this sheet gets the cursor, scroll it to the middle so a tablet keyboard never covers what is being typed.
  function keepInView(el) {
    el.addEventListener('focusin', (ev) => {
      const f = ev.target;
      if (!f || !/^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)) return;
      setTimeout(() => { try { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* older browsers */ } }, 250);
    });
  }

  /* ---------- helpers for the dish form ---------- */

  // The one way every message in these screens is shown: the words, then a tone (ok or bad) that sets its colour. With no
  // tone given, a message that says something went wrong is shown as bad. An empty message clears it.
  const BAD_WORDS = /^(type |use |enter |closing |keep |that |the pin could not|batch size|minutes|there is|nothing|could not)|could not|cannot|too big|blocked|not saved|is full|would not/i;
  function tell(el, text, tone) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.add('dp-msg');
    const t = !text ? '' : (tone || (BAD_WORDS.test(text) ? 'bad' : 'ok'));
    if (t) el.dataset.tone = t; else delete el.dataset.tone;
    if (t === 'bad') el.setAttribute('role', 'alert'); else el.setAttribute('role', 'status');
  }

  const KEY_DRAFT = 'smokebox.v1.setup.draft'; // the half-typed dish {name, price, zone}, kept so a closed tab loses nothing
  const KEY_LAST = 'smokebox.v1.setup.lastZone'; // the station chosen for the last saved dish
  const KEY_CASKIP = 'smokebox.v1.setup.cookAheadSkipped'; // true once the owner said no to the cooked-ahead question
  const KEY_SERVESKIP = 'smokebox.v1.setup.serveSkipped'; // true once the owner skipped the How do you serve? question
  const KEY_SERVEANS = 'smokebox.v1.setup.serveAnswer'; // 'table', 'counter' or 'truck' once the How do you serve? question is answered
  const KEY_HIDDENCAT = 'smokebox.v1.setup.hiddenCategories'; // category ids the owner marked Not used
  const KEY_LASTCAT = 'smokebox.v1.setup.lastCategory'; // the category the owner last chose by hand (not a guess)
  const KEY_HIDDEN = 'smokebox.v1.setup.hiddenStations'; // station ids the owner hid from the Where is it made? tiles
  const KEY_EXAMPLES = 'smokebox.v1.setup.examples'; // ids of dishes that came from the example menu

  // What a new dish gets from the station tile alone: its order-screen category, a guessed prep time in seconds
  // (starter estimate, owner to confirm) and whether the cook taps Start then Done or just Done.
  const ZONE_DEFAULT = {
    pit: { cat: 'meat', sec: 300, track: 'two' }, sides: { cat: 'side', sec: 180, track: 'two' },
    fry: { cat: 'fried', sec: 240, track: 'two' }, cold: { cat: 'cold', sec: 60, track: 'one' },
  };
  // Section names that fit each station best, in the old and the new starter names (lower case).
  const SECTION_WORDS = { pit: ['meats', 'mains'], sides: ['hot sides', 'sides'], fry: ['fried', 'snacks'], cold: ['cold food and drinks', 'cold and drinks', 'drinks'] };
  // A short plain line under each station name on its tile.
  const ZONE_HINT = { pit: 'Grill, oven or main line', sides: 'Prep and sides', fry: 'Fried foods', cold: 'No cooking: drinks, cold items' };
  // The example menu. Columns: name, price in dollars, station id, category id. Made-up prices, owner to replace.
  // audit:data-start
  const EXAMPLES = [
    ['Chicken plate', 12.5, 'pit', 'meat'], ['Club sandwich', 11, 'pit', 'sandwich'],
    ['Mac and cheese', 4.5, 'sides', 'side'], ['Green beans', 3.5, 'sides', 'side'],
    ['French fries', 4.5, 'fry', 'fried'], ['Onion rings', 5.5, 'fry', 'fried'],
    ['Coleslaw', 3, 'cold', 'cold'], ['Iced tea', 3, 'cold', 'cold'],
  ];
  // audit:data-end

  // Sends one action through the store and gives back {ok, info, words} with the reason in plain language.
  function send(type, payload) {
    const res = SB.store.dispatchEx(type, payload, { source: 'ui' });
    if (res.report === 'ok') return { ok: true, info: res.info || {}, words: '' };
    let words = res.report;
    try { words = SB.engine.describe(res.report, res.info, SB.store.getState().settings) || words; } catch (e) { /* keep the code */ }
    // The few refusals an owner meets while setting up get one plain sentence each: what happened, then what to do.
    const key = String((res.info && res.info.key) || '');
    if (/price$/.test(key)) words = 'The price has to be between $0 and $1,000. Type it like 12.50.';
    else if (/name$/.test(key) && (res.report === 'nameTaken' || res.report === 'badPatch')) words = 'That name is already taken. Pick another name.';
    else if (/name$/.test(key)) words = 'The name has to be 1 to 60 letters. Shorten it and try again.';
    else if (key === 'menu' || res.report === 'tooManyItems') words = 'Your menu is full (150 dishes). Remove one you no longer sell, then add this one.';
    else if (res.report === 'tooManyIngredients') words = 'You have as many cooked-ahead items as Smokebox can hold. Remove one first.';
    else if (res.report === 'moduleOff') words = 'Cooking ahead is switched off. Turn it on in Tax, hours and PIN, then try again.';
    return { ok: false, info: res.info || {}, words, report: res.report };
  }
  // Reads a number from a text box; blank or junk gives null so nothing is ever invented.
  function readNum(input) {
    const t = String(input.value || '').trim().replace(',', '.');
    if (!t || !isFinite(Number(t))) return null;
    return Number(t);
  }
  // The dishes the owner can order right now (not archived).
  function activeDishes() {
    const s = SB.store.getState();
    return s.menu.filter((m) => !m.archived);
  }
  // The dishes the owner removed (archived), newest last, so they can be brought back.
  function removedDishes() { return SB.store.getState().menu.filter((m) => m.archived); }
  // True when nothing can be ordered yet: the first-run state that shows the Add my menu button.
  function noDishes() { return activeDishes().length === 0; }
  // The stations a dish can be made at, in order: only the ones that receive items (not expo).
  function stations() { return SB.config.workZones.map((z) => SB.config.zoneById[z]).filter(Boolean); }
  // The stations still shown as tiles: all of them except the ones the owner hid. At least one always stays.
  function visibleStations() {
    const hid = U.storage.get(KEY_HIDDEN, []);
    const all = stations(), shown = all.filter((z) => hid.indexOf(z.id) < 0);
    return shown.length ? shown : all.slice(0, 1);
  }
  // The categories still in use: all of them except the ones the owner marked Not used. At least one always stays.
  function visibleCategories() {
    const hid = U.storage.get(KEY_HIDDENCAT, []);
    const all = SB.config.categories, shown = all.filter((c) => hid.indexOf(c.id) < 0);
    return shown.length ? shown : all.slice(0, 1);
  }
  // The guessed category, prep seconds and tap style for a station, with safe values for a custom station.
  function defaultsFor(zoneId) {
    const d = ZONE_DEFAULT[zoneId];
    if (!d || !SB.config.categoryById[d.cat]) return { cat: (SB.config.categories[0] || {}).id, sec: 180, track: 'two' };
    // The section is found by its NAME first (the starter names changed from Meats, Hot sides, Fried to Mains, Sides, Snacks), then by id.
    const byName = SECTION_WORDS[zoneId] ? SB.config.categories.find((c) => SECTION_WORDS[zoneId].indexOf(c.name.toLowerCase()) >= 0) : null;
    return byName ? Object.assign({}, d, { cat: byName.id }) : d;
  }
  // Reads a typed price the way a person writes it: "12.50", "12,50", "$14", "14.", "USD 12", "1 200". Gives {value, rounded}
  // in dollars, or null when it is not one price. Uses the menu importer's reader when it is in this build.
  function priceInfo(text) {
    const M = SB.menuImport;
    if (M && typeof M.readPrice === 'function') { const r = M.readPrice(text); return r && typeof r.value === 'number' ? { value: r.value, rounded: !!r.rounded } : null; }
    const raw = String(text || '').replace(/[$\s]/g, '').replace(',', '.');
    return /^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(raw) ? { value: parseFloat(raw), rounded: false } : null;
  }
  // The price in dollars, or null when the text is not a price.
  function parsePrice(text) { const i = priceInfo(text); return i ? i.value : null; }
  // Adds one dish with every hidden default filled in. opts may carry prepSec, cat and short from "More options".
  // The prep time is marked as a guess unless the owner typed one. Returns the send() result.
  function addDish(name, price, zone, opts) {
    const o = opts || {}, d = defaultsFor(zone);
    const r = send('addMenuItem', { name, short: o.short || '', zone, cat: o.cat || d.cat, price, prepSec: o.prepSec || d.sec, track: d.track });
    if (r.ok && !o.prepSec && r.info && r.info.id) send('updateMenuItem', { id: r.info.id, patch: { prepConfirmed: false } });
    return r;
  }

  // The hidden "Portions of <dish>" ingredient that counts one dish, or undefined. Never shown as an ingredient.
  function portionIng(m) {
    const s = SB.store.getState();
    return s.ingredients.find((i) => i.forMenu === m.id && !i.archived && (m.bom || []).some((l) => l.ing === i.id));
  }
  // How many portions are left for a dish that is counted, or -1 when the dish is not counted.
  function portionLeft(m) {
    const ing = portionIng(m);
    if (!ing) return -1;
    const v = SB.store.getState().stock[ing.id];
    return typeof v === 'number' ? v : 0;
  }
  // Set by the open Dishes sheet so a row's Stop counting can offer Undo in the sheet's undo bar.
  let undoHook = null;
  // The small "I count what I made" part of a dish row: a start link, or "N left" with +10, a custom add and Stop.
  function portionsRow(m) {
    const left = portionLeft(m), msg = h('span', { class: 'fs-sub', role: 'status' });
    const box = h('div', { class: 'dp-por' });
    // Says what went wrong in plain words, such as a dish that already lists ingredients.
    const say = (r) => { tell(msg, r.ok ? '' : (r.report === 'portionsConflict' ? 'This dish already uses ingredients, so it cannot be counted by portions too.' : r.words)); };
    if (left < 0) {
      const cnt = h('input', { class: 'input dp-num', type: 'text', inputmode: 'numeric', placeholder: 'How many?', 'aria-label': 'How many ' + m.name + ' you made' });
      // Starts counting portions for this dish at the typed number.
      const go = h('button', { type: 'button', class: 'btn btn-sm', onClick: () => {
        const n = cnt.value.trim() === '' ? 0 : Number(cnt.value);
        if (!Number.isInteger(n) || n < 0) { tell(msg, 'Type a whole number, like 20.'); return; }
        say(send('setPortions', { menuId: m.id, on: true, count: n }));
      } }, 'Start counting');
      const fold = h('details', { class: 'dp-fold dp-countfold' }, h('summary', null, h('span', null, 'I count what I made')), h('div', { class: 'fs-row' }, cnt, go, h('span', { class: 'fs-sub' }, 'Sells out when the count reaches zero.')));
      box.append(fold, msg);
      return box;
    }
    const more = h('input', { class: 'input dp-num', type: 'text', inputmode: 'numeric', placeholder: 'Add', 'aria-label': 'Portions of ' + m.name + ' to add' });
    box.append(h('strong', { class: 'dp-left' }, left + ' left' + (left < 1 ? ' (sold out)' : '')),
      // Adds ten portions to the count in one tap.
      h('button', { type: 'button', class: 'btn btn-sm', onClick: () => say(send('restock', { ing: portionIng(m).id, g: 10 })) }, '+10'),
      // Adds the typed number of portions to the count.
      more, h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { const n = Number(more.value); if (!Number.isInteger(n) || n <= 0) { tell(msg, 'Type how many you made, like 12.'); return; } say(send('restock', { ing: portionIng(m).id, g: n })); more.value = ''; } }, 'Add'),
      // Stops counting portions for this dish; the books stay whole.
      h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { const r = send('setPortions', { menuId: m.id, on: false }); say(r); if (r.ok && undoHook) undoHook('Stopped counting ' + m.name + '.', () => { send('setPortions', { menuId: m.id, on: true, count: 0 }); }); } }, 'Stop counting'), msg);
    return box;
  }
  // True when the cook-ahead module is on (an old saved kitchen with no setting counts as on).
  function cookOn() { return SB.engine && SB.engine.moduleOn ? SB.engine.moduleOn(SB.store.getState(), 'cookAhead') : true; }
  // A short plain line about one cooked-ahead item for the list: hot with its hours, or cold with the limits the owner entered.
  function coldText(i) {
    if (i.hold !== 'cold') return 'Hot, up to ' + i.maxHoldH + ' h';
    const bits = [];
    if (i.fridgeDays != null) bits.push(i.fridgeDays + ' ' + U.plural(i.fridgeDays, 'day', 'days') + ' in the fridge');
    if (i.outHours != null) bits.push(i.outHours + ' h out');
    return 'Cold, ' + (bits.length ? bits.join(', ') : 'no limit set');
  }
  // The cooked-ahead items the owner has made: cook-ahead food that is not archived.
  function cookItems() { return SB.store.getState().ingredients.filter((i) => i.tcs && !i.archived); }

  /* ---------- Watch the demo ---------- */

  // Asks once, in plain words, then opens the demo: a practice kitchen in this tab. The owner's own kitchen is saved first
  // and comes back with the Back to my kitchen button.
  async function tryDemo(skipAsk) {
    const store = SB.store;
    if (!store.enterDemo || store.isDemo()) return false;
    const ok = skipAsk || !SB.ui.confirm ? true : await SB.ui.confirm({ title: 'Watch the demo?', confirmLabel: 'Watch the demo', cancelLabel: 'Not now',
      body: ['The demo has a sample menu and sample tickets. Nothing in it is your kitchen.', 'Your own dishes and orders are not touched. A bar at the top of every screen has a Back to my kitchen button.'] });
    if (!ok) return false;
    if (!store.enterDemo() && SB.ui.toast) SB.ui.toast('This browser would not open the demo. Try again, or add ?demo to the address.', { tone: 'warn' });
    return true;
  }
  // The body of the Demo sheet in a real kitchen: what the demo is, and one button that opens it.
  function demoIntro() {
    return h('div', { class: 'dm' }, h('section', { class: 'fs-section' },
      h('p', { class: 'fs-sub' }, 'A demo kitchen with a sample menu, sample tickets and a crew that sends orders, so you can see Smokebox busy. Nothing in it is your kitchen, and nothing you do there reaches your real dishes, orders or numbers.'),
      h('p', { class: 'fs-sub' }, 'A bar at the top of every demo screen says so and has a Back to my kitchen button. Leaving erases the demo.'),
      // Opens the demo after the plain-words question.
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'try-demo' }, onClick: () => tryDemo(true) }, ico('play', 22), h('span', null, 'Watch the demo'))));
  }

  /* ---------- the Dishes and prices sheet ---------- */

  // Opens "Dishes and prices": the dishes so far (or the add form first on an empty menu), and a fold of extra ways to start.
  function openDishes() {
    const sheet = SB.ui.sheet({ title: 'Dishes and prices', side: 'right', width: 'min(880px, 96vw)', name: 'dishes', onClose: () => offs.splice(0).forEach((f) => f()) });
    const offs = [];
    const root = h('div', { class: 'dp' });
    const lead = h('p', { class: 'fs-sub dp-lead' });

    // The form: name, price, where it is made. Station tiles are big buttons that behave like radio buttons.
    const nameIn = h('input', { class: 'input dp-name', type: 'text', maxlength: 60, autocomplete: 'off', placeholder: 'House salad', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'next' });
    const nameField = SB.ui.field({ label: 'What is it called?', control: nameIn });
    const priceIn = h('input', { class: 'input dp-price', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '12.50' });
    const priceField = SB.ui.field({ label: 'Price the customer pays', control: priceIn });
    const priceEcho = h('p', { class: 'fs-sub dp-echo', 'aria-live': 'polite' });
    priceField.appendChild(priceEcho);
    // Shows what Smokebox understood from the typed price before anything is saved, so "12,50" is never a surprise.
    priceIn.addEventListener('input', () => { const i = priceInfo(priceIn.value); tell(priceEcho, i ? 'Reads as ' + U.fmtMoney(i.value) + (i.rounded ? ' (rounded to the cent)' : '') : '', 'ok'); });
    let zone = '';
    // The minutes box, once built: picking a station shows that station's guess in it.
    let minBox = null;
    // The guess shown in the empty minutes box for a station.
    const guessWords = (id) => 'about ' + (id ? Math.max(1, Math.round(defaultsFor(id).sec / 60)) : 5);
    // Menu section: where the dish sits on the order screen. It starts from the station's guess until the owner picks one by hand;
    // after that their last hand pick is used for the next dish (a pizza shop picks "Pizzas" once).
    const catSel = h('select', { class: 'select dp-menusec', 'aria-label': 'Menu section' });
    let catTouched = false;
    // Fills the Menu section list from the categories still in use and chooses the starting value.
    function paintCats() {
      const cur = catSel.value, vis = visibleCategories();
      U.clear(catSel);
      vis.forEach((c) => catSel.appendChild(h('option', { value: c.id }, c.name)));
      const mine = U.storage.get(KEY_LASTCAT, '');
      const guess = zone ? defaultsFor(zone).cat : '';
      const want = catTouched ? cur : (mine && vis.some((c) => c.id === mine) ? mine : (vis.some((c) => c.id === guess) ? guess : vis[0].id));
      catSel.value = vis.some((c) => c.id === want) ? want : vis[0].id;
    }
    // Picking a section by hand is remembered for the next dish.
    catSel.addEventListener('change', () => { catTouched = true; U.storage.set(KEY_LASTCAT, catSel.value); saveDraft(); });
    const tiles = h('div', { class: 'dp-tiles', role: 'radiogroup', 'aria-label': 'Where it is made' });
    const zoneErr = h('div', { class: 'field-error', role: 'alert', hidden: true });
    const whereLabel = h('div', { class: 'field-label' }, 'Which station makes it?');
    // Builds one tile per visible station. With only one station there is nothing to ask, so the tiles are hidden
    // and that station is used for every dish.
    function paintTiles() {
      U.clear(tiles);
      const shown = visibleStations();
      shown.forEach((z) => {
        const tile = h('button', { type: 'button', class: 'dp-tile', role: 'radio', 'aria-checked': 'false', dataset: { zone: z.id } },
          ico(z.icon || 'pot', 28), h('strong', null, z.name), h('span', null, ZONE_HINT[z.id] || ''));
        // Picks this station and remembers it for the next dish.
        tile.addEventListener('click', () => { pickZone(z.id); U.storage.set(KEY_LAST, z.id); saveDraft(); });
        tiles.appendChild(tile);
      });
      const one = shown.length === 1;
      tiles.hidden = one; whereLabel.hidden = one;
      if (one) zone = shown[0].id;
      else if (!shown.some((z) => z.id === zone)) zone = '';
      pickZone(zone);
    }
    // Shows which station tile is chosen and clears the "tap where it is made" message.
    function pickZone(id) {
      zone = id; zoneErr.hidden = true; if (!catTouched) paintCats();
      if (minBox) minBox.placeholder = guessWords(id);
      tiles.querySelectorAll('.dp-tile').forEach((b) => b.setAttribute('aria-checked', b.dataset.zone === id ? 'true' : 'false'));
    }
    // Change stations: rename, hide or add one, using the same saved names the board and tickets read.
    const stSt = h('p', { class: 'fs-sub', role: 'status' });
    const stList = h('div', { class: 'dp-stlist' });
    // Reloads the page so the board and tickets pick up the new station names.
    const stReload = h('button', { type: 'button', class: 'btn btn-sm', hidden: true, onClick: () => g.location.reload() }, ico('refresh', 18), h('span', null, 'Reload to show on the board'));
    // Saves a change to the owner's station names through SB.config (checked first, so a bad name changes nothing).
    function commitNames(mutate) {
      const C = SB.config;
      const spec = JSON.parse(JSON.stringify(C.customSpec()));
      spec.rename = spec.rename || {}; spec.add = spec.add || {};
      mutate(spec);
      const before = C.customSpec(), res = C.applyCustom(spec);
      if (res.rejected.length) { C.applyCustom(before); tell(stSt, 'That name cannot be used: it is empty, longer than ' + C.customLimits.name + ' letters, or already taken.'); return false; }
      if (!C.saveCustom(spec)) { tell(stSt, 'This browser would not save the change.'); return false; }
      tell(stSt, 'Saved. Tickets and the board show the new name after you reload.'); stReload.hidden = false;
      paintStations(); paintTiles();
      return true;
    }
    // How many dishes this station can cook at once (fryer baskets, burners, grill spots), saved in the kitchen's settings.
    // Empty means no limit. The kitchen planner then never calls a dish while the station is full, and holds the ticket's
    // other dishes so they still finish together.
    function capField(z) {
      const cur = (SB.store.getState().settings.capacity || {})[z.id];
      const box = h('input', { class: 'input dp-cap', type: 'text', inputmode: 'numeric', maxlength: 2, value: cur > 0 ? String(cur) : '', placeholder: 'no limit',
        'aria-label': 'How many can cook at once at ' + z.name, title: 'How many can cook at once here (baskets, burners, spots). Empty: no limit.' });
      // Saves the new limit for this station, or says what is wrong and puts the old one back.
      const saveCap = () => {
        const t = box.value.trim(), n = t === '' ? 0 : Number(t);
        if (!Number.isInteger(n) || n < 0 || n > 50) { tell(stSt, 'Type a whole number from 1 to 50, or leave it empty for no limit.'); box.value = cur > 0 ? String(cur) : ''; return; }
        const cap = Object.assign({}, SB.store.getState().settings.capacity || {});
        if (n > 0) cap[z.id] = n; else delete cap[z.id];
        const r = send('updateSettings', { patch: { capacity: cap } });
        tell(stSt, r.ok || r.report === 'nothingToDo' ? (n > 0 ? z.name + ': ' + n + ' at once. The coach plans around it.' : z.name + ': no limit.') : r.words);
      };
      box.addEventListener('change', saveCap);
      return h('label', { class: 'dp-capwrap' }, h('span', { class: 'fs-sub' }, 'At once'), box);
    }
    // Rebuilds the station rows: a name box, Hide or Show, and an add box at the end.
    function paintStations() {
      U.clear(stList);
      const hid = U.storage.get(KEY_HIDDEN, []);
      stations().forEach((z) => {
        const inp = h('input', { class: 'input', type: 'text', maxlength: SB.config.customLimits.name, value: z.name, 'aria-label': 'Name of station ' + z.name });
        inp.addEventListener('change', () => { if (inp.value.trim() !== z.name) commitNames((sp) => { sp.rename.zones = Object.assign({}, sp.rename.zones, { [z.id]: inp.value }); }); });
        const isHid = hid.indexOf(z.id) >= 0;
        // Hides this station from the tiles, or shows it again, keeping at least one.
        const hideBtn = h('button', { type: 'button', class: 'btn btn-sm', onClick: () => {
          const now = U.storage.get(KEY_HIDDEN, []).filter((x) => x !== z.id);
          if (!isHid) now.push(z.id);
          if (stations().every((s) => now.indexOf(s.id) >= 0)) { tell(stSt, 'Keep at least one station in use.'); return; }
          U.storage.set(KEY_HIDDEN, now); tell(stSt, isHid ? z.name + ' is in use again.' : z.name + ' is marked not used: it leaves the tiles here and its tab on the board while it has no tickets. Dishes already made there keep it.');
          paintStations(); paintTiles();
          if (SB.floor && SB.floor.applyHiddenTabs) SB.floor.applyHiddenTabs();
        } }, isHid ? 'Use again' : 'Not used');
        stList.appendChild(h('div', { class: 'dp-strow' }, inp, capField(z), hideBtn));
      });
      const addIn = h('input', { class: 'input', type: 'text', maxlength: SB.config.customLimits.name, placeholder: 'New station, like Bar', 'aria-label': 'New station name' });
      // Adds a new station with the typed name, after the same checks as a rename.
      stList.appendChild(h('div', { class: 'dp-strow' }, addIn, h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { if (addIn.value.trim()) commitNames((sp) => { sp.add.zones = (sp.add.zones || []).concat([{ name: addIn.value }]); }); } }, ico('plus', 18), h('span', null, 'Add station'))));
    }
    const stFold = h('details', { class: 'dp-fold dp-stfold' }, h('summary', null, ico('chevron-down', 18), h('span', null, 'Change stations')),
      h('div', { class: 'dp-more' }, h('p', { class: 'fs-sub' }, 'Name the places in your kitchen the way your cooks say them. Tap Not used on any you do not have. If you only have one, you will not be asked. At once: how many dishes the station can cook at the same time (fryer baskets, burners, grill spots); leave it empty for no limit.'), stList, stSt, stReload));
    paintStations(); paintTiles();
    // Change menu sections: rename, mark Not used or add one, using the same saved names the order screen reads.
    const caSt = h('p', { class: 'fs-sub', role: 'status' });
    const caList = h('div', { class: 'dp-stlist' });
    // Saves a change to the owner's category names through SB.config (checked first); the order screen reads them at once.
    function commitCats(mutate) {
      const C = SB.config;
      const spec = JSON.parse(JSON.stringify(C.customSpec()));
      spec.rename = spec.rename || {}; spec.add = spec.add || {};
      mutate(spec);
      const before = C.customSpec(), res = C.applyCustom(spec);
      if (res.rejected.length) { C.applyCustom(before); tell(caSt, 'That name cannot be used: it is empty, longer than ' + C.customLimits.name + ' letters, or already taken.', 'bad'); return false; }
      if (!C.saveCustom(spec)) { tell(caSt, 'This browser would not save the change.', 'bad'); return false; }
      tell(caSt, 'Saved. The order screen shows the new name.', 'ok');
      paintCatRows(); paintCats();
      return true;
    }
    // Rebuilds the section rows: a name box, Not used or Use again, and an add box at the end.
    function paintCatRows() {
      U.clear(caList);
      const hid = U.storage.get(KEY_HIDDENCAT, []);
      SB.config.categories.forEach((c) => {
        const inp = h('input', { class: 'input', type: 'text', maxlength: SB.config.customLimits.name, value: c.name, 'aria-label': 'Name of section ' + c.name });
        // Saves the new name when the box is left.
        inp.addEventListener('change', () => { if (inp.value.trim() !== c.name) commitCats((sp) => { sp.rename.categories = Object.assign({}, sp.rename.categories, { [c.id]: inp.value }); }); });
        const isHid = hid.indexOf(c.id) >= 0;
        // Marks this section Not used (it leaves the pick list), or brings it back, keeping at least one in use.
        const hideBtn = h('button', { type: 'button', class: 'btn btn-sm', onClick: () => {
          const now = U.storage.get(KEY_HIDDENCAT, []).filter((x) => x !== c.id);
          if (!isHid) now.push(c.id);
          if (SB.config.categories.every((s) => now.indexOf(s.id) >= 0)) { tell(caSt, 'Keep at least one section in use.', 'bad'); return; }
          U.storage.set(KEY_HIDDENCAT, now);
          tell(caSt, isHid ? c.name + ' is in use again.' : c.name + ' is marked not used: it leaves the pick list. Dishes already in it keep it.', 'ok');
          paintCatRows(); paintCats();
        } }, isHid ? 'Use again' : 'Not used');
        caList.appendChild(h('div', { class: 'dp-strow' }, inp, hideBtn));
      });
      const addIn = h('input', { class: 'input', type: 'text', maxlength: SB.config.customLimits.name, placeholder: 'New section, like Pizzas', 'aria-label': 'New menu section name' });
      // Adds a new menu section with the typed name.
      caList.appendChild(h('div', { class: 'dp-strow' }, addIn, h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { if (addIn.value.trim()) commitCats((sp) => { sp.add.categories = (sp.add.categories || []).concat([{ name: addIn.value }]); }); } }, ico('plus', 18), h('span', null, 'Add section'))));
    }
    const catFold = h('details', { class: 'dp-fold dp-catfold' }, h('summary', null, ico('chevron-down', 18), h('span', null, 'Change menu sections')),
      h('div', { class: 'dp-more' }, h('p', { class: 'fs-sub' }, 'The sections on your order screen. Rename them to match your menu (Pizzas, Pastries, Tacos). Tap Not used on any you do not need.'), caList, caSt));
    paintCatRows(); paintCats();
    const whereBlock = h('div', { class: 'field' }, whereLabel, tiles, zoneErr, stFold);

    // Minutes to make one sits in the main form: the timing engine starts each dish from it, so it is asked, not hidden. Empty
    // uses the station's guess (shown in the box) and is marked as a guess that learns from real tickets.
    const minIn = h('input', { class: 'input dp-num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'about 5', 'aria-label': 'Minutes to make one' });
    minBox = minIn; minIn.placeholder = guessWords(zone);
    const minField = SB.ui.field({ label: 'Minutes to make one', control: minIn, hint: 'From start to ready. Not sure? Leave it empty: Smokebox uses the guess shown and learns from your tickets.' });
    const shortIn = h('input', { class: 'input', type: 'text', maxlength: 24, autocomplete: 'off', placeholder: 'Same as the name' });
    const more = h('details', { class: 'dp-fold' }, h('summary', null, ico('chevron-down', 18), h('span', null, 'More options')),
      h('div', { class: 'dp-more' }, SB.ui.field({ label: 'Short name on tickets', control: shortIn })));

    const status = h('p', { class: 'fs-sub dp-status', role: 'status' });
    const again = h('button', { type: 'submit', class: 'btn btn-primary btn-lg dp-again', dataset: { act: 'save-again' } }, ico('plus', 22), h('span', null, 'Save and add another'));
    const done = h('button', { type: 'button', class: 'btn btn-lg dp-done', dataset: { act: 'save-done' } }, ico('check', 22), h('span', null, 'Save and finish'));
    const form = h('form', { class: 'dp-form', novalidate: '', 'aria-label': 'Add a dish' }, nameField, priceField, whereBlock, minField, SB.ui.field({ label: 'Menu section', control: catSel, hint: 'Where it sits on the order screen. Change the section names under Change menu sections.' }), catFold, more, h('div', { class: 'fs-row dp-actions' }, again, done), status);

    // Keeps what has been typed so far, so a closed tab or a stray tap loses nothing.
    function saveDraft() { U.storage.set(KEY_DRAFT, { name: nameIn.value, price: priceIn.value, zone }); }
    nameIn.addEventListener('input', saveDraft); priceIn.addEventListener('input', saveDraft);
    // Enter (or Next on a tablet keyboard) in the name box moves to the price box instead of doing nothing.
    nameIn.setAttribute('enterkeyhint', 'next'); priceIn.setAttribute('enterkeyhint', 'done');
    nameIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); priceIn.focus(); } });

    // A line under the name box that appears when the typed name belongs to a removed dish: one tap brings it back.
    const backRow = h('div', { class: 'fs-note dp-back', hidden: true, role: 'alert' });
    nameField.appendChild(backRow);
    // Shows "X was removed earlier" with a Bring it back button that un-archives it at the typed price.
    function showBringBack(m, price) {
      U.clear(backRow);
      // Brings the removed dish back, at the price typed in the form.
      backRow.append(h('span', null, m.name + ' was removed earlier. '), h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'bring-back' }, onClick: () => {
        const r = send('updateMenuItem', { id: m.id, patch: price != null && price !== m.price ? { archived: false, price } : { archived: false } });
        backRow.hidden = true;
        if (r.ok) { nameIn.value = ''; priceIn.value = ''; saveDraft(); tell(status, m.name + ' is back on your menu.'); } else tell(status, r.words);
      } }, 'Bring it back'));
      backRow.hidden = false;
    }
    // Checks the form and saves one dish. Returns true when it saved. Each problem shows beside its own box.
    function saveOne() {
      tell(status, ''); nameField.setError(null); priceField.setError(null); minField.setError(null); backRow.hidden = true;
      const name = nameIn.value.replace(/\s+/g, ' ').trim();
      const price = parsePrice(priceIn.value);
      if (!name) { nameField.setError('Type the dish name.'); nameIn.focus(); return false; }
      if (price == null) { priceField.setError('Type the price in dollars, like 12.50.'); priceIn.focus(); return false; }
      if (!zone) { zoneErr.replaceChildren(ico('alert-circle', 18), h('span', null, 'Tap where it is made.')); zoneErr.hidden = false; return false; }
      let prepSec = 0;
      if (minIn.value.trim()) {
        const mins = readNum(minIn);
        if (mins == null || mins < 0.1 || mins > 60) { minField.setError('Type a number of minutes from 1 to 60, or leave it empty.'); minIn.focus(); return false; }
        prepSec = Math.round(mins * 60);
      }
      const r = addDish(name, price, zone, { prepSec, cat: catSel.value || undefined, short: shortIn.value.trim() });
      if (!r.ok) {
        const gone = removedDishes().find((m) => m.name.toLowerCase() === name.toLowerCase());
        if (gone) showBringBack(gone, price);
        else if (/name/.test((r.info && r.info.key) || '')) nameField.setError('There is already a dish called ' + name + '. Pick another name.');
        else tell(status, r.words);
        return false;
      }
      tell(status, 'Saved ' + name + ' at ' + U.fmtMoney(price) + '.');
      nameIn.value = ''; priceIn.value = ''; tell(priceEcho, ''); minIn.value = ''; shortIn.value = ''; if (!catTouched) paintCats();
      saveDraft();
      return true;
    }
    form.addEventListener('submit', (ev) => { ev.preventDefault(); if (saveOne()) nameIn.focus(); });
    // Save and finish: saves what is typed (or just closes when the form is empty).
    done.addEventListener('click', () => {
      const empty = !nameIn.value.trim() && !priceIn.value.trim();
      if (empty || saveOne()) sheet.close('done');
    });

    // The Undo line after a Remove, and a fold that lists removed dishes so any can be brought back later.
    const undoBar = h('div', { class: 'fs-note dp-undo', hidden: true, role: 'status' });
    // Shows a plain message with an Undo button that runs the given undo step. Used after Remove, a move and Stop counting.
    function showUndo(message, undo) {
      U.clear(undoBar);
      // Runs the undo step and puts the bar away.
      undoBar.append(h('span', null, message + ' '), h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'undo-remove' }, onClick: () => { undo(); undoBar.hidden = true; } }, 'Undo'));
      undoBar.hidden = false;
    }
    // Moves a dish one place up or down among the dishes on the menu (the order screen follows this order within a category).
    function moveDish(m, dir) {
      const menu = SB.store.getState().menu, act = menu.filter((x) => !x.archived);
      const other = act[act.findIndex((x) => x.id === m.id) + dir];
      if (!other) return;
      const from = menu.findIndex((x) => x.id === m.id), to = menu.findIndex((x) => x.id === other.id);
      if (send('moveMenuItem', { id: m.id, toIndex: to }).ok) showUndo('Moved ' + m.name + (dir < 0 ? ' up.' : ' down.'), () => { send('moveMenuItem', { id: m.id, toIndex: from }); });
    }
    undoHook = showUndo; offs.push(() => { undoHook = null; });
    const dishesHead = h('h3', { class: 'fs-h dp-h' }, 'Your dishes');
    const goneList = h('div', { class: 'dp-list' });
    const goneFold = h('details', { class: 'dp-fold dp-gone' }, h('summary', null, ico('chevron-down', 18), h('span', null, 'Removed dishes')), h('div', { class: 'dp-more' }, goneList));
    // Lists removed dishes with a Bring it back button each; the fold hides when there are none.
    function paintGone() {
      const list = removedDishes().slice(-30);
      goneFold.hidden = list.length === 0;
      U.clear(goneList);
      list.forEach((m) => goneList.appendChild(h('div', { class: 'dp-row' }, h('span', { class: 'grow' }, m.name + ' (' + U.fmtMoney(m.price) + ')'), h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { send('updateMenuItem', { id: m.id, patch: { archived: false } }); } }, 'Bring it back'))));
    }
    // The dishes so far: each row is a name box, a price box and Remove. Changes save when the box is left.
    const listBox = h('div', { class: 'dp-list' });
    let listSig = null; // null so the first paint always runs, even for an empty menu
    // The optional cook steps of one dish: up to 3 lines of "when" and "what to say". While the dish cooks, the voice says each
    // line at its moment and the dish row shows it. Saved with one button; all lines empty removes the steps.
    function stepsBox(m) {
      const WHEN = [[0, 'At the start'], [25, 'A quarter in'], [50, 'Halfway'], [75, 'Three quarters in'], [90, 'Near the end']];
      const have = Array.isArray(m.steps) ? m.steps : [];
      const lines = [0, 1, 2].map((i) => {
        const cur = have[i];
        const sel = h('select', { class: 'select dp-st-when', 'aria-label': 'When, step ' + (i + 1) + ' of ' + m.name }, WHEN.map(([v, l]) => h('option', { value: String(v), selected: cur ? cur.at === v : v === [0, 50, 90][i] }, l)));
        const say = h('input', { class: 'input dp-st-say', type: 'text', maxlength: 40, value: cur ? cur.say : '', placeholder: ['Drop the basket', 'Shake the basket', 'Plate it'][i], 'aria-label': 'What to say, step ' + (i + 1) + ' of ' + m.name });
        return { sel, say, el: h('div', { class: 'dp-st-line' }, sel, say) };
      });
      const msg = h('span', { class: 'fs-sub', role: 'status' });
      // Saves the filled-in lines as this dish's steps (none filled in removes them) and says what happened.
      const saveSteps = () => {
        const steps = lines.filter((l) => l.say.value.trim()).map((l) => ({ at: Number(l.sel.value), say: l.say.value.trim() }));
        const r = send('updateMenuItem', { id: m.id, patch: { steps: steps.length ? steps : null } });
        tell(msg, r.ok ? (steps.length ? 'Saved. The voice says these while ' + m.name + ' cooks.' : 'Steps removed.') : 'Each step needs 1 to 40 letters.');
      };
      const btn = h('button', { type: 'button', class: 'btn btn-sm', onClick: saveSteps }, ico('check', 18), h('span', null, 'Save steps'));
      // Portions that cook together in one basket or spot: the planner counts them as one slot at the station.
      const per = h('input', { class: 'input dp-cap', type: 'text', inputmode: 'numeric', maxlength: 2, value: m.perSlot > 1 ? String(m.perSlot) : '', placeholder: '1', 'aria-label': 'Portions of ' + m.name + ' in one basket or spot' });
      // Saves how many portions share one basket or spot (empty or 1: one each).
      const savePer = () => {
        const t = per.value.trim(), n = t === '' ? 1 : Number(t);
        if (!Number.isInteger(n) || n < 1 || n > 50) { tell(msg, 'Type a whole number from 1 to 50.'); per.value = m.perSlot > 1 ? String(m.perSlot) : ''; return; }
        const r = send('updateMenuItem', { id: m.id, patch: { perSlot: n > 1 ? n : null } });
        tell(msg, r.ok || r.report === 'nothingToDo' ? (n > 1 ? n + ' portions share one basket or spot.' : 'One portion per basket or spot.') : r.words);
      };
      per.addEventListener('change', savePer);
      return h('details', { class: 'dp-steps', open: have.length > 0 }, h('summary', null, 'Cook steps and basket size (optional)' + (have.length ? ': ' + have.length + ' ' + U.plural(have.length, 'step') : '')),
        h('p', { class: 'fs-sub' }, 'Short things to do while it cooks. The voice says each one at its moment, and the ticket shows it.'), ...lines.map((l) => l.el), h('div', { class: 'fs-row' }, btn, msg),
        h('label', { class: 'dp-capwrap' }, h('span', { class: 'fs-sub' }, 'Portions in one basket or spot'), per));
    }
    // Rebuilds the list of dishes when it has changed and no box in it is being typed in.
    function paintList() {
      const mine = activeDishes();
      const sig = mine.map((m) => m.id + '|' + m.name + '|' + m.price + '|' + m.zone + '|' + m.cat + '|' + portionLeft(m) + '|' + JSON.stringify(m.steps || []) + '|' + (m.perSlot || 1)).join(';');
      const typing = listBox.contains(doc.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(doc.activeElement.tagName);
      if (sig === listSig || typing) return;
      listSig = sig;
      dishesHead.hidden = mine.length === 0;
      const ex = U.storage.get(KEY_EXAMPLES, []);
      U.clear(listBox);
      lead.textContent = mine.length ? (mine.length + ' ' + U.plural(mine.length, 'dish', 'dishes') + ' on your menu. Change a name or price in the list and it saves when you tap away.') : 'Add the dishes you sell. Name, price and where it is made is all you need. Nothing here is pre-filled.';
      mine.forEach((m) => {
        const n = h('input', { class: 'input dp-rn', type: 'text', maxlength: 60, value: m.name, 'aria-label': 'Name of ' + m.name });
        const pr = h('input', { class: 'input dp-rp', type: 'text', inputmode: 'decimal', value: m.price.toFixed(2), 'aria-label': 'Price of ' + m.name });
        const msg = h('span', { class: 'fs-sub dp-rmsg', role: 'status' });
        // Saves a changed name or price for this dish, or says what is wrong and puts the old value back.
        const save = () => {
          const patch = {}, nv = n.value.replace(/\s+/g, ' ').trim(), pv = parsePrice(pr.value);
          if (nv && nv !== m.name) patch.name = nv;
          if (pv != null && pv !== m.price) patch.price = pv;
          if (pv == null) { tell(msg, 'Type the price like 12.50.'); pr.value = m.price.toFixed(2); return; }
          if (!Object.keys(patch).length) return;
          const r = send('updateMenuItem', { id: m.id, patch });
          tell(msg, r.ok ? 'Saved.' : r.words);
          if (!r.ok) { n.value = m.name; pr.value = m.price.toFixed(2); }
        };
        n.addEventListener('change', save); pr.addEventListener('change', save);
        const rm = h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'Remove ' + m.name, onClick: () => {
          // Removing archives the dish: it can no longer be ordered, and old tickets keep it. Undo is offered at once.
          if (send('updateMenuItem', { id: m.id, patch: { archived: true } }).ok) showUndo('Removed ' + m.name + '.', () => { send('updateMenuItem', { id: m.id, patch: { archived: false } }); });
        } }, ico('x', 18), h('span', null, 'Remove'));
        const idx = mine.indexOf(m);
        // Up and down buttons: plain moves, each one place; the ends are switched off.
        const moveBox = h('span', { class: 'dp-move' },
          h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Move ' + m.name + ' up', disabled: idx === 0, onClick: () => moveDish(m, -1) }, ico('arrow-up', 20)),
          // Moves this dish one place up in the menu order.
          h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Move ' + m.name + ' down', disabled: idx === mine.length - 1, onClick: () => moveDish(m, 1) }, ico('arrow-down', 20)));
        // Move to: the category this dish sits in on the order screen, changed with one pick.
        const catSelRow = h('select', { class: 'select dp-cat', 'aria-label': 'Section of ' + m.name }, SB.config.categories.map((c) => h('option', { value: c.id, selected: c.id === m.cat }, c.name)));
        // Saves the new category for this dish and says so.
        catSelRow.addEventListener('change', () => { const r = send('updateMenuItem', { id: m.id, patch: { cat: catSelRow.value } }); tell(msg, r.ok ? 'Moved to ' + (SB.config.categoryById[catSelRow.value] || {}).name + '.' : r.words); });
        const z = SB.config.zoneById[m.zone];
        listBox.appendChild(h('div', { class: 'dp-row' }, moveBox, n, pr, catSelRow, h('span', { class: 'chip dp-zone' }, z ? z.name : m.zone), ex.indexOf(m.id) >= 0 ? h('span', { class: 'chip dp-ex', 'data-tone': 'warn' }, 'Example') : null, rm, msg, portionsRow(m), m.track === 'two' ? stepsBox(m) : null));
      });
    }
    paintList(); paintGone();
    offs.push(SB.store.subscribe(() => { paintList(); paintGone(); }));

    // Cooked-ahead food: shown only when that module is on and there is a dish. Optional; never needed to order.
    const caBox = h('section', { class: 'fs-card dp-ca', hidden: true });
    // Paints the question (before any item), or the list of cooked-ahead items with Add another.
    let caNote = '';
    function paintCook() {
      const items = cookItems();
      const on = cookOn();
      const show = caNote || (activeDishes().length > 0 && (on ? (items.length > 0 || !U.storage.get(KEY_CASKIP, false)) : (!U.storage.get(KEY_CASKIP, false) && items.length === 0)));
      caBox.hidden = !show;
      if (!show) return;
      U.clear(caBox);
      // After a No or Not sure: one line on what turning it on adds and where, shown until this sheet is closed.
      if (caNote && !items.length) { caBox.append(h('p', { class: 'fs-sub dp-msg', 'data-tone': 'ok', role: 'status' }, caNote)); return; }
      // Opens the sheet that adds one cooked-ahead item.
      const add = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'add-cooked' }, onClick: () => {
        // Saying yes while the cook-ahead part is off turns it on first, then opens the sheet for the first item.
        if (!cookOn()) send('updateSettings', { patch: { modules: { cookAhead: true } } });
        SB.sheets.open('cookahead');
      } }, ico('plus', 20), h('span', null, items.length ? 'Add another cooked-ahead item' : cookOn() ? 'Yes, I cook ahead' : 'Yes, I cook ahead'));
      if (!items.length) {
        caBox.append(h('h3', { class: 'fs-h' }, 'Do you cook food ahead?'),
          h('p', { class: 'fs-sub' }, 'Soup in a warmer, salads in a cooler. If you do, Smokebox can track each batch and warn you before it runs out of time. Please pick one: it only takes a tap, and you can change it later.'),
          h('div', { class: 'fs-row' }, add,
            // No and Not sure both leave cooking ahead off; Not sure says so, and says how to turn it on later.
            ['No', 'Not sure'].map((lbl) => h('button', { type: 'button', class: 'btn', dataset: { act: lbl === 'No' ? 'no-cooked' : 'notsure-cooked' }, onClick: () => {
              U.storage.set(KEY_CASKIP, true);
              caNote = (lbl === 'No' ? 'Cooking ahead stays off. ' : 'Not sure counts as No for now. ') + 'Turning it on adds the Hold cabinet, batch timers and their warnings. Turn it on any time under Settings, Tax, hours and PIN.';
              paintCook();
            } }, lbl))));
      } else {
        caBox.append(h('h3', { class: 'fs-h' }, 'Cooked-ahead food'),
          h('div', { class: 'dp-list' }, items.map((i) => h('div', { class: 'dp-row' }, h('strong', null, i.name), h('span', { class: 'chip' }, coldText(i)),
          // Opens the same form, filled in, to change the name or the limits.
          h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'edit-cooked' }, 'aria-label': 'Edit ' + i.name, onClick: () => SB.sheets.open('cookahead', { id: i.id }) }, 'Edit')))), h('div', { class: 'fs-row' }, add));
      }
    }
    paintCook();
    offs.push(SB.store.subscribe(() => paintCook()));

    // How do you serve? A skippable question under the dishes. Each answer only sets the settings found under Settings, How you serve.
    const svBox = h('section', { class: 'fs-card dp-sv dp-serve', hidden: true });
    // The three answers: what each sets, in the order shown. Table service is the starting state, so it only records the answer.
    const SERVE_CHOICES = [
      { id: 'table', label: 'Table and kitchen tickets', sets: { counter: false, chips: null } },
      { id: 'counter', label: 'Counter service', sets: { counter: true, chips: ['Walk-up', 'Pickup', 'Phone', 'Delivery'] } },
      { id: 'truck', label: 'Food truck / one person', sets: { counter: false, chips: ['Walk-up', 'Pickup'] } },
    ];
    // Paints the question until it is answered or skipped; after an answer it says what was set and where to change it.
    function paintServe(answer) {
      const answered = answer || U.storage.get(KEY_SERVEANS, '');
      // An owner who already set How you serve (own order buttons, or counter service on) is not asked again. The empty list a new
      // kitchen starts with is not an answer, so the question still comes.
      const svc = SB.store.getState().settings.service || {};
      const setUp = (Array.isArray(svc.chips) && svc.chips.length > 0) || svc.counter === true;
      const show = activeDishes().length > 0 && !U.storage.get(KEY_SERVESKIP, false) && (!!answered || !setUp);
      svBox.hidden = !show;
      if (!show) return;
      U.clear(svBox);
      if (answered) { svBox.append(h('p', { class: 'fs-sub dp-msg', 'data-tone': 'ok', role: 'status' }, 'Saved: ' + (SERVE_CHOICES.find((c) => c.id === answered) || {}).label + '. You can change this any time under Settings, How you serve.')); return; }
      svBox.append(h('h3', { class: 'fs-h' }, 'How do you serve?'),
        h('p', { class: 'fs-sub' }, 'Optional. It only sets the order buttons and counter service for you, and you can change both later.'),
        h('div', { class: 'fs-row' }, SERVE_CHOICES.map((c) =>
          // Saves this answer's settings in one step.
          h('button', { type: 'button', class: c.id === 'table' ? 'btn btn-primary' : 'btn', dataset: { act: 'serve-' + c.id }, onClick: () => answerServe(c) }, c.label)),
          // Remembers the owner skipped, so the question goes away.
          h('button', { type: 'button', class: 'btn btn-link', dataset: { act: 'serve-skip' }, onClick: () => { U.storage.set(KEY_SERVESKIP, true); paintServe(); } }, 'Skip')));
    }
    // Saves one answer: counter service on or off, and the order buttons. WATCH OUT: the table answer has no buttons of
    // its own, so it leaves any saved order buttons alone instead of wiping them back to the starting list.
    function answerServe(c) {
      const r1 = send('updateSettings', { patch: { service: { counter: c.sets.counter } } });
      const r = (r1.ok || r1.report === 'nothingToDo') && c.sets.chips ? send('setChips', { chips: c.sets.chips }) : r1;
      if (!r.ok && r.report !== 'nothingToDo') { svBox.appendChild(h('p', { class: 'fs-sub dp-msg', 'data-tone': 'bad', role: 'alert' }, r.words)); return; }
      U.storage.set(KEY_SERVEANS, c.id); paintServe(c.id);
    }
    paintServe();
    offs.push(SB.store.subscribe(() => { if (!svBox.contains(doc.activeElement)) paintServe(); }));

    // More ways to add dishes: for now only an example menu, clearly marked as an example.
    const exStatus = h('p', { class: 'fs-sub', role: 'status' });
    const exBtn = h('button', { type: 'button', class: 'btn', dataset: { act: 'example-menu' } }, ico('book', 20), h('span', null, 'Start from an example menu'));
    // Adds the example dishes (skipping any name already on the menu) and marks them as examples.
    exBtn.addEventListener('click', () => {
      const ids = U.storage.get(KEY_EXAMPLES, []).slice();
      let n = 0;
      EXAMPLES.forEach(([name, price, z, cat]) => {
        if (!SB.config.zoneById[z]) return;
        const r = addDish(name, price, z, { cat: SB.config.categoryById[cat] ? cat : '' });
        if (r.ok) { n++; ids.push(r.info.id); }
      });
      U.storage.set(KEY_EXAMPLES, ids);
      tell(exStatus, n ? 'Added ' + n + ' example dishes with sample prices. Each one is marked Example: change its name and price, or tap Remove.' : 'Those example dishes are already on your menu.');
    });
    const exRemove = h('button', { type: 'button', class: 'btn', dataset: { act: 'example-remove' } }, ico('x', 20), h('span', null, 'Remove all example dishes'));
    // Archives every dish that came from the example menu, in one tap.
    exRemove.addEventListener('click', () => {
      const ids = U.storage.get(KEY_EXAMPLES, []);
      ids.forEach((id) => send('updateMenuItem', { id, patch: { archived: true } }));
      U.storage.set(KEY_EXAMPLES, []);
      tell(exStatus, 'Example dishes removed.');
    });
    const ways = h('details', { class: 'dp-fold dp-ways' }, h('summary', null, ico('chevron-down', 18), h('span', null, 'More ways to add dishes')),
      h('div', { class: 'dp-more' }, h('p', { class: 'fs-sub' }, 'An example menu with sample prices, so you can see how Smokebox looks with food on it. You can edit or remove every dish.'), h('div', { class: 'fs-row' }, exBtn, exRemove), exStatus,
        // A quiet link to the optional menu import screen.
        h('p', { class: 'fs-sub' }, h('button', { type: 'button', class: 'btn btn-link', dataset: { act: 'open-import' }, onClick: () => SB.sheets.open('menuimport') }, 'Have a menu file? Import it'))));

    // Links to the other small settings and to the full menu editor in the back office.
    const shopBtn = h('button', { type: 'button', class: 'btn', onClick: () => { sheet.close('link'); setTimeout(() => SB.sheets.open('shop'), 60); } }, ico('sliders', 20), h('span', null, 'Tax, hours and PIN'));
    const fullBtn = h('button', { type: 'button', class: 'btn', onClick: () => { sheet.close('link'); setTimeout(() => { if (SB.shell && SB.shell.ignite) SB.shell.ignite({ section: 'data' }); }, 60); } }, ico('gauge', 20), h('span', null, 'Full menu editor'));
    // A menu that already has dishes shows them first, with a button that jumps to the add form under them;
    // an empty menu starts on the add form.
    const addHead = h('h3', { class: 'fs-h dp-h dp-addh' }, 'Add a dish');
    const hasDishes = activeDishes().length > 0;
    // Add a dish scrolls down to the form and puts the cursor in the name box.
    const jump = h('button', { type: 'button', class: 'btn dp-jump', dataset: { act: 'jump-add' }, hidden: !hasDishes, onClick: () => { addHead.scrollIntoView({ block: 'start', behavior: 'smooth' }); nameIn.focus({ preventScroll: true }); } }, ico('plus', 20), h('span', null, 'Add a dish'));
    const top = h('div', { class: 'fs-row dp-top' }, lead, jump);
    if (hasDishes) root.append(top, dishesHead, undoBar, listBox, goneFold, addHead, form, caBox, svBox, ways, h('div', { class: 'fs-row dp-links' }, shopBtn, fullBtn));
    else root.append(top, form, dishesHead, undoBar, listBox, goneFold, caBox, svBox, ways, h('div', { class: 'fs-row dp-links' }, shopBtn, fullBtn));
    sheet.body.appendChild(root); keepInView(root);

    // Restore a draft left by a closed tab, then the last station used.
    const d = U.storage.get(KEY_DRAFT, null);
    if (d && typeof d === 'object') { nameIn.value = String(d.name || ''); priceIn.value = String(d.price || ''); priceIn.dispatchEvent(new g.Event('input')); }
    const last = (d && d.zone) || U.storage.get(KEY_LAST, '');
    if (last && visibleStations().some((z) => z.id === last) && visibleStations().length > 1) pickZone(last);
    // The name box takes the cursor only when the form is on top (an empty menu, or a half-typed dish to finish).
    if (!hasDishes || nameIn.value) setTimeout(() => nameIn.focus({ preventScroll: hasDishes }), 50);
    return sheet;
  }

  /* ---------- the Cooked-ahead food sheet ---------- */

  // Opens "Cooked-ahead food": name, hot or cold, how long it may stay, a usual batch size and which dishes use it.
  // Saves the item with addIngredient, then gives each chosen dish a recipe line. Nothing here is needed to take orders.
  function openCookAhead(opts) {
    const editing = opts && opts.id ? SB.store.getState().ingredients.find((i) => i.id === opts.id && i.tcs) : null;
    const sheet = SB.ui.sheet({ title: editing ? 'Edit cooked-ahead food' : 'Cooked-ahead food', side: 'right', width: 'min(720px, 96vw)', name: 'cookahead' });
    const nameIn = h('input', { class: 'input dp-name', type: 'text', maxlength: 60, autocomplete: 'off', placeholder: 'Soup' });
    const nameField = SB.ui.field({ label: 'What do you cook ahead?', control: nameIn });
    const kind = SB.ui.segmented({ label: 'Is it kept hot or cold?', value: 'hot', options: [{ id: 'hot', label: 'Hot' }, { id: 'cold', label: 'Cold' }],
      // Shows the boxes that fit hot or cold food.
      onChange: () => paintKind() });
    const hoursIn = h('input', { class: 'input dp-num', type: 'text', inputmode: 'decimal', value: '4', 'aria-label': 'How long may it stay, in hours?' });
    const hoursField = SB.ui.field({ label: 'How long may it stay, in hours?', control: hoursIn, hint: '4 hours is a careful starting point. Your local health code decides what is allowed: ask your health department and change this to match.' });
    // Cold food: two optional limits the owner gets from their health department. Blank means no limit is set and Smokebox only shows the time.
    const daysIn = h('input', { class: 'input dp-num', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'optional', 'aria-label': 'How many days may it stay in the fridge?' });
    const daysField = SB.ui.field({ label: 'How many days may it stay in the fridge?', control: daysIn });
    const outIn = h('input', { class: 'input dp-num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'optional', 'aria-label': 'How many hours may it be out of the fridge?' });
    const outField = SB.ui.field({ label: 'How many hours may it be out of the fridge?', control: outIn });
    const coldBox = h('div', { class: 'dp-cold', hidden: true }, daysField, outField,
      h('p', { class: 'fs-sub' }, 'Use the limits your local health department gives you. Leave a box empty for no limit set: Smokebox will then only show the time.'));
    // Shows the hours box for hot food and the two fridge boxes for cold food.
    function paintKind() { const cold = kind.getValue() === 'cold'; coldBox.hidden = !cold; hoursField.hidden = cold; }
    const kgIn = h('input', { class: 'input dp-num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'optional', 'aria-label': 'Usual batch size, in kg' });
    const kgField = SB.ui.field({ label: 'Usual batch size, in kg', control: kgIn, hint: 'A normal pan or batch, like 4. Leave it empty if you are not sure.' });
    // One checkbox row per dish: tick the dishes that use this food and say about how many grams each takes.
    const dishRows = activeDishes().map((m) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': m.name + ' uses it', disabled: portionLeft(m) >= 0 });
      // The grams box stays empty and off until its dish is ticked, so no dish looks filled in before the owner says so.
      const gIn = h('input', { class: 'input dp-num', type: 'text', inputmode: 'numeric', placeholder: 'grams', disabled: true, 'aria-label': 'Grams of it in one ' + m.name });
      cb.addEventListener('change', () => { gIn.disabled = !cb.checked; if (cb.checked) gIn.focus(); });
      return { m, cb, gIn, el: h('div', { class: 'dp-row' }, h('label', { class: 'grow' }, cb, ' ' + m.name + (portionLeft(m) >= 0 ? ' (counted by portions)' : '')), h('span', { class: 'fs-sub' }, 'grams in one:'), gIn) };
    });
    const dishBox = h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Which dishes use it?'), h('p', { class: 'fs-sub' }, 'Select each dish that uses it, then type the grams of it in one serving. Smokebox takes that much off the batch when the dish is made.'), h('div', { class: 'dp-list' }, dishRows.map((r) => r.el)));
    const status = h('p', { class: 'fs-sub', role: 'status' });
    const after = h('div', { class: 'fs-row', hidden: true });
    let warnedNoDish = false;
    // Selecting a dish clears the one-time warning, so a later empty save warns again.
    dishRows.forEach((x) => x.cb.addEventListener('change', () => { warnedNoDish = false; }));
    // Saves the item and links the ticked dishes; says plainly what happened and what to do next.
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'save-cooked' }, onClick: () => {
      nameField.setError(null); hoursField.setError(null); tell(status, '');
      const name = nameIn.value.replace(/\s+/g, ' ').trim(), hrs = readNum(hoursIn), kg = kgIn.value.trim() ? readNum(kgIn) : null;
      if (!name) { nameField.setError('Type what you cook ahead.'); return; }
      const isCold = kind.getValue() === 'cold';
      daysField.setError(null); outField.setError(null);
      if (!isCold && (hrs == null || hrs < 0.5 || hrs > 12)) { hoursField.setError('Type hours from 0.5 to 12.'); return; }
      let days = null, outH = null;
      if (isCold && daysIn.value.trim()) { days = readNum(daysIn); if (days == null || days < 1 || days > 30 || !Number.isInteger(days)) { daysField.setError('Type a whole number of days from 1 to 30, or leave it empty.'); return; } }
      if (isCold && outIn.value.trim()) { outH = readNum(outIn); if (outH == null || outH < 0.25 || outH > 24) { outField.setError('Type hours from 0.25 to 24, or leave it empty.'); return; } }
      if (kgIn.value.trim() && (kg == null || kg <= 0 || kg > 1000)) { tell(status, 'Batch size: type kilograms like 4, or leave it empty.'); return; }
      // With dishes on the menu but none selected, nothing would use this item: say so once, and save only on a second tap.
      if (dishRows.length && !dishRows.some((x) => x.cb.checked) && !warnedNoDish) {
        warnedNoDish = true;
        tell(status, 'No dish is selected, so nothing will use this item and it will not count down. Select a dish above, or tap Save again to keep it without one.', 'bad');
        return;
      }
      // Every ticked dish needs its grams before anything is saved.
      const noGrams = dishRows.find((x) => x.cb.checked && !(Number(x.gIn.value) > 0));
      if (noGrams) { tell(status, 'Type the grams in one ' + noGrams.m.name + ', or untick it.', 'bad'); noGrams.gIn.focus(); return; }
      const payload = { name, unit: 'g', tcs: true, hold: kind.getValue(), maxHoldH: hrs == null ? 4 : hrs, holdBasis: 'safety' };
      if (isCold) payload.fridge = true; // a cold item is kept in a fridge, so it can be taken out and put back and its two limits can be set
      if (days != null) payload.fridgeDays = days;
      if (outH != null) payload.outHours = outH;
      if (kg) payload.parG = Math.round(kg * 1000);
      const r = send('addIngredient', payload);
      if (!r.ok) { if (r.report === 'nameTaken') nameField.setError('You already have an item called ' + name + '.'); else tell(status, r.words); return; }
      let linked = 0;
      dishRows.filter((x) => x.cb.checked).forEach((x) => {
        const grams = Number(x.gIn.value);
        if (!Number.isFinite(grams) || grams <= 0) return;
        const cur = SB.store.getState().menu.find((mm) => mm.id === x.m.id);
        const bom = (cur.bom || []).concat([{ ing: r.info.id, qty: grams }]);
        if (send('updateMenuItem', { id: x.m.id, patch: { bom } }).ok) linked++;
      });
      tell(status, 'Added ' + name + (linked ? ' and linked it to ' + linked + ' ' + U.plural(linked, 'dish', 'dishes') : '') + '. Log your first batch in the Hold cabinet when you cook one.');
      save.hidden = true; after.hidden = false;
      U.clear(after);
      // Opens the Hold cabinet on a new batch of the item just added.
      after.append(h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'log-first-batch' }, onClick: () => { sheet.close('link'); setTimeout(() => SB.sheets.open('hold', { tab: 'new', ing: r.info.id }), 60); } }, 'Log a first batch'),
        // Closes the sheet without logging a batch.
        h('button', { type: 'button', class: 'btn btn-lg', onClick: () => sheet.close('done') }, 'Done for now'));
    } }, ico('check', 22), h('span', null, 'Save cooked-ahead item'));
    const kindField = h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Hot or cold'), kind);
    // Edit mode: the same boxes, filled in; hot or cold and the dish links stay as they were, and Save changes the limits and the name.
    const saveEdit = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'save-cooked-edit' }, onClick: () => {
      nameField.setError(null); daysField.setError(null); outField.setError(null); hoursField.setError(null); tell(status, '');
      const name = nameIn.value.replace(/\s+/g, ' ').trim();
      if (!name) { nameField.setError('Type what you cook ahead.'); return; }
      const patch = { name };
      if (editing.hold === 'cold') {
        const dv = daysIn.value.trim() ? readNum(daysIn) : null, ov = outIn.value.trim() ? readNum(outIn) : null;
        if (dv != null && (dv < 1 || dv > 30 || !Number.isInteger(dv))) { daysField.setError('Type a whole number of days from 1 to 30, or leave it empty.'); return; }
        if (ov != null && (ov < 0.25 || ov > 24)) { outField.setError('Type hours from 0.25 to 24, or leave it empty.'); return; }
        patch.fridgeDays = dv; patch.outHours = ov;
        if (editing.fridge !== true && (dv != null || ov != null)) patch.fridge = true;
      } else {
        const hv = readNum(hoursIn);
        if (hv == null || hv < 0.5 || hv > 12) { hoursField.setError('Type hours from 0.5 to 12.'); return; }
        patch.maxHoldH = hv;
      }
      for (const k of Object.keys(patch)) if (patch[k] === editing[k]) delete patch[k];
      if (!Object.keys(patch).length) { tell(status, 'Nothing changed.', 'ok'); return; }
      const r = send('updateIngredient', { id: editing.id, patch });
      if (!r.ok) { tell(status, r.words, 'bad'); return; }
      tell(status, 'Saved.', 'ok');
      setTimeout(() => sheet.close('done'), 600);
    } }, ico('check', 22), h('span', null, 'Save changes'));
    if (editing) {
      nameIn.value = editing.name; kind.setValue(editing.hold === 'cold' ? 'cold' : 'hot');
      hoursIn.value = String(editing.maxHoldH == null ? 4 : editing.maxHoldH);
      if (editing.fridgeDays != null) daysIn.value = String(editing.fridgeDays);
      if (editing.outHours != null) outIn.value = String(editing.outHours);
      kindField.hidden = true; kgField.hidden = true; dishBox.hidden = true; save.hidden = true;
    } else saveEdit.hidden = true;
    paintKind();
    sheet.body.appendChild(h('div', { class: 'dp' }, h('p', { class: 'fs-sub' }, editing ? 'Change the limits or the name. Hot or cold stays as it was.' : 'Optional. Skip this and you can still take every order. Later you can add more from the Hold cabinet.'),
      h('div', { class: 'dp-form' }, nameField, kindField, hoursField, coldBox, kgField, dishBox, h('div', { class: 'fs-row' }, save, saveEdit), status, after)));
    keepInView(sheet.body);
    setTimeout(() => nameIn.focus(), 50);
    return sheet;
  }

  /* ---------- the Import or export your menu sheet ---------- */

  // Opens "Import or export your menu": choose a file or paste text, preview it, fix the rows, then import the ticked ones.
  // Also has "Export my menu". Optional; the form is still the easy way to add dishes.
  function openImport() {
    const M = SB.menuImport;
    const sheet = SB.ui.sheet({ title: 'Import or export your menu', side: 'right', width: 'min(900px, 96vw)', name: 'menuimport' });
    const root = h('div', { class: 'dp' });
    if (!M) { sheet.body.appendChild(h('p', { class: 'fs-sub' }, 'Menu import is not part of this copy of Smokebox.')); return sheet; }
    const area = h('textarea', { class: 'textarea', rows: 5, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Paste your menu here', placeholder: 'Paste your menu here, one dish per line like "Pulled pork plate 12.50", or the text of a spreadsheet.' });
    // The browser's own file picker is hidden inside a label that looks like the app's other buttons; the chosen name shows beside it.
    const fileIn = h('input', { type: 'file', class: 'visually-hidden', accept: '.csv,.tsv,.txt,text/csv,text/plain', 'aria-label': 'Choose a menu file' });
    const fileName = h('span', { class: 'fs-sub imp-name' }, 'No file chosen yet');
    const fileBtn = h('label', { class: 'btn imp-file' }, fileIn, ico('upload', 20), h('span', null, 'Choose a menu file'));
    const status = h('p', { class: 'fs-sub', role: 'status' });
    const preview = h('div', { class: 'dp-preview' });
    let parsed = null, rows = [];
    // The station used for a row that names none: the first station still in use.
    const defaultZone = () => visibleStations()[0].id;
    // Runs the importer on the text and draws the preview, or says plainly what is wrong with the text.
    let unitChoice = ''; // '' lets the importer decide; 'cents' or 'dollars' when the owner chose
    function check(text, from, unit) {
      U.clear(preview); tell(status, '');
      if (unit !== undefined) unitChoice = unit;
      const res = M.parse(text, unitChoice ? { existing: SB.store.getState().menu, priceUnit: unitChoice } : { existing: SB.store.getState().menu });
      if (res.error) { tell(status, res.error); parsed = null; return; }
      parsed = res; rows = res.rows.map((r) => Object.assign({ keep: r.ok && !r.hidden }, r));
      // A category that is only digits usually means a price like 4,50 was split at its comma: warn, and leave the row unticked.
      rows.forEach((r) => {
        // The importer's own warnings about extra columns or a digits-only category also leave the row unticked.
        if ((r.problems || []).some((p) => p.code === 'extraColumns' || p.code === 'numericCategory')) { r.keep = false; return; }
        if (/^\d+$/.test(String(r.categoryText || '').trim())) { r.problems = (r.problems || []).concat([{ code: 'priceSplit', level: 'warn', message: 'The section here is "' + r.categoryText + '", which looks like the end of a price split at a comma (4,50).', fix: 'Check the price, select the row when it is right. In your file, put prices with commas inside quotes.' }]); r.keep = false; }
      });
      if (res.summary && res.summary.unmatched) res.summary.unmatched.categories = res.summary.unmatched.categories.filter((c) => !/^\d+$/.test(String(c).trim()));
      paintPreview(from);
    }
    // Says why a typed name cannot be used: 'removed' (a removed dish has it), 'menu' (a dish on the menu), 'list' (another row here), or ''.
    function takenBy(r) {
      const nm = String(r.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const hit = SB.store.getState().menu.find((m) => m.name.toLowerCase() === nm);
      if (hit) return hit.archived ? 'removed' : 'menu';
      return rows.some((o) => o !== r && o.keep && String(o.name || '').trim().toLowerCase() === nm) ? 'list' : '';
    }
    // True when an edited row can be imported: a name, a price from 0 to 1000 and a name that is not taken.
    function rowOk(r) {
      const nm = String(r.name || '').replace(/\s+/g, ' ').trim();
      return !!nm && nm.length <= 60 && typeof r.price === 'number' && r.price >= 0 && r.price <= 1000 && !takenBy(r);
    }
    // Draws the format line, any file notes, the table of rows (tick, name, price, station, problems) and the Import button.
    function paintPreview(from) {
      U.clear(preview);
      const sm = parsed.summary;
      preview.append(h('p', { class: 'fs-sub dp-fmt' }, 'Read ' + (from || 'the text') + ' as: ' + parsed.label + '. ' + sm.message));
      (sm.notes || []).forEach((n) => preview.appendChild(h('p', { class: 'fs-note', 'data-tone': 'warn' }, n)));
      // Columns the importer did not use (like Notes), named once so nothing is dropped without a word.
      const ign = Array.isArray(sm.ignoredColumns) ? sm.ignoredColumns : [];
      // Prices that look like cents (whole numbers, some over $1,000): offer to read them as cents; and when read as cents, offer the way back.
      if (sm.maybeCents) preview.appendChild(h('div', { class: 'fs-note', 'data-tone': 'warn' }, h('div', null, h('p', null, 'Every price in this file is a whole number and some are very large. Are the prices in cents (1400 meaning $14.00)?'),
        // Reads the same text again with prices in cents.
        h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'prices-cents' }, onClick: () => check(area.value, from, 'cents') }, 'These prices are in cents'))));
      if (sm.priceUnit === 'cents') preview.appendChild(h('div', { class: 'fs-note', 'data-tone': 'warn' }, h('div', null, h('p', null, 'Prices are being read as cents (1400 is $14.00).'),
        // Goes back to reading prices as dollars.
        h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'prices-dollars' }, onClick: () => check(area.value, from, 'dollars') }, 'These prices are in dollars'))));
      // Notes or descriptions are read but not stored with a dish, so say that too.
      if (rows.some((r) => r.description)) preview.appendChild(h('p', { class: 'fs-sub dp-ignored', dataset: { act: 'notes-ignored' } }, 'Notes and descriptions in your file are not kept: Smokebox stores only the name, price, station and section.'));
      if (ign.length) preview.appendChild(h('p', { class: 'fs-sub dp-ignored', dataset: { act: 'ignored-columns' } }, (ign.length === 1 ? 'Ignored column: ' : 'Ignored columns: ') + ign.join(', ') + '. Smokebox does not keep ' + (ign.length === 1 ? 'it' : 'them') + '.'));
      // Words in the file that match none of the owner's categories or stations: say it once, and offer to add the categories.
      const um = sm.unmatched || { stations: [], categories: [] };
      if (um.categories.length) {
        // Adds the file's category words as the owner's own categories, then reads the file again so each dish lands in its own.
        const addCats = h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'import-add-cats' }, onClick: () => {
          const C = SB.config, spec = JSON.parse(JSON.stringify(C.customSpec()));
          spec.add = spec.add || {}; spec.add.categories = (spec.add.categories || []).concat(um.categories.map((nm) => ({ name: nm })));
          const before = C.customSpec(), res = C.applyCustom(spec);
          if (res.rejected.length) { C.applyCustom(before); tell(status, 'Some of those section names could not be added (too long, a repeat, or the list is full). Change the category words in the file, or add them one by one in the Back office.', 'bad'); return; }
          C.saveCustom(spec); check(area.value, 'the file');
          tell(status, 'Added ' + um.categories.length + ' ' + U.plural(um.categories.length, 'section', 'sections') + '. Each dish now sits in its own.', 'ok');
        } }, 'Add these sections');
        preview.appendChild(h('div', { class: 'fs-note', 'data-tone': 'warn' }, h('div', null, h('p', null, 'Your file has sections that are not set up here: ' + um.categories.join(', ') + '. Until you add them, those dishes go in "' + ((SB.config.categories[0] || {}).name || 'the first category') + '".'), addCats)));
      }
      if (um.stations.length) preview.appendChild(h('p', { class: 'fs-note', 'data-tone': 'warn' }, 'Your file names stations that are not set up here: ' + um.stations.join(', ') + '. Pick each dish\'s station below.'));
      // One station for every dish that came with none, so a cafe does not pick it 22 times.
      const bulk = h('select', { class: 'select', 'aria-label': 'Put every dish at this station' }, h('option', { value: '' }, 'Choose a station'), stations().map((z) => h('option', { value: z.id }, z.name)));
      preview.appendChild(h('div', { class: 'fs-row dp-bulk' }, h('label', null, 'Put all these dishes at: '), bulk));
      // One menu section for every dish that came with none (a bakery file has no category column).
      const bulkCat = h('select', { class: 'select', 'aria-label': 'Put every dish in this menu section' }, h('option', { value: '' }, 'Choose a section'), visibleCategories().map((c) => h('option', { value: c.id }, c.name)));
      if (rows.some((r) => !r.category)) preview.appendChild(h('div', { class: 'fs-row dp-bulk' }, h('label', null, 'Put all these dishes in: '), bulkCat));
      // Choosing a section sets it on every row that has none of its own.
      bulkCat.addEventListener('change', () => { if (bulkCat.value) rows.forEach((r) => { if (!r.categoryText) r.category = bulkCat.value; }); });
      const body = h('div', { class: 'dp-ptable', role: 'list', 'aria-label': 'Dishes found' });
      const go = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'import-go' } }, 'Import');
      // Updates the Import button's count and enabled state from the ticked, valid rows.
      const paintGo = () => { const n = rows.filter((r) => r.keep && r.ok).length; go.disabled = n === 0; go.textContent = n ? 'Import ' + n + ' ' + U.plural(n, 'dish', 'dishes') : 'Nothing to import'; };
      rows.forEach((r) => {
        const keepBox = h('input', { type: 'checkbox', checked: r.keep, 'aria-label': 'Import ' + r.name });
        const keep = keepBox;
        const keepWrap = h('label', { class: 'dp-check' }, keepBox);
        const nm = h('input', { class: 'input', type: 'text', maxlength: 60, value: r.name || '', 'aria-label': 'Name, line ' + r.line });
        const pr = h('input', { class: 'input dp-num', type: 'text', inputmode: 'decimal', value: typeof r.price === 'number' ? r.price.toFixed(2) : '', 'aria-label': 'Price, line ' + r.line });
        const readAs = h('span', { class: 'fs-sub dp-readas', dataset: { act: 'read-as' } }, r.readAs ? 'Read as ' + r.readAs : '');
        const prCell = h('div', { class: 'dp-prcell' }, pr, readAs);
        const zs = h('select', { class: 'select', 'aria-label': 'Station, line ' + r.line }, stations().map((z) => h('option', { value: z.id, selected: (r.station || defaultZone()) === z.id }, z.name)));
        const prob = h('div', { class: 'fs-sub dp-prob' });
        const rowEl = h('div', { class: 'dp-prow', role: 'listitem', 'aria-label': 'Line ' + r.line, dataset: { ok: r.ok ? 'true' : 'false' } }, keepWrap, nm, prCell, zs, prob);
        // Redraws this row's plain problems and its tick after any edit.
        const redo = () => {
          r.ok = rowOk(r); if (!r.ok) r.keep = false;
          keep.checked = r.keep; rowEl.dataset.ok = r.ok ? 'true' : 'false';
          if (r.ok) prob.textContent = '';
          else prob.textContent = (!String(r.name || '').trim() ? 'Type a name. ' : '') + (typeof r.price !== 'number' ? 'Type a price like 12.50. ' : '') + ({ removed: 'A removed dish has this name. Bring it back in Dishes and prices, or use another name.', menu: 'That name is already on the menu.', list: 'That name is in this list twice.' }[takenBy(r)] || '');
          paintGo();
        };
        // Selecting a row in or out changes only whether it is imported.
        keep.addEventListener('change', () => { r.keep = keep.checked && (r.ok = rowOk(r)); keep.checked = r.keep; paintGo(); });
        // Typing a new name or price re-checks the row and ticks it in when it has become valid.
        const edit = () => { r.name = nm.value.replace(/\s+/g, ' ').trim(); const p = SB.menuImport.readPrice(pr.value); r.price = p && typeof p.value === 'number' ? p.value : null; readAs.textContent = r.price == null ? '' : 'Read as ' + U.fmtMoney(r.price); r.station = zs.value; r.ok = rowOk(r); r.keep = r.ok; redo(); };
        nm.addEventListener('change', edit); pr.addEventListener('change', edit); zs.addEventListener('change', () => { r.station = zs.value; });
        prob.textContent = (r.problems || []).filter((p) => p.code !== 'unknownCategory' && p.code !== 'unknownStation').map((p) => p.message + (p.fix ? ' ' + p.fix : '')).join(' ');
        body.appendChild(rowEl);
      });
      // Choosing a station in the bulk list sets it on every row.
      bulk.addEventListener('change', () => { if (!bulk.value) return; rows.forEach((r) => { r.station = bulk.value; }); body.querySelectorAll('select').forEach((s) => { s.value = bulk.value; }); });
      // Imports the ticked rows through the importer's actions, then offers one-tap undo of that batch.
      go.addEventListener('click', () => {
        const picked = rows.filter((r) => r.keep && r.ok).map((r) => Object.assign({}, r, { station: r.station || defaultZone() }));
        const out = M.toActions(picked, SB.store.getState().menu, { zone: defaultZone() });
        const ids = [];
        out.actions.forEach((a) => { const res = send(a.type, a.payload); if (res.ok && res.info && res.info.id) ids.push(res.info.id); });
        const bad = out.actions.length - ids.length + out.skipped.length;
        tell(status, 'Imported ' + ids.length + ' ' + U.plural(ids.length, 'dish', 'dishes') + (bad ? '. ' + bad + ' could not be imported' + (out.skipped.length ? ': ' + out.skipped.map((s) => s.name + ' (' + s.reason + ')').join('; ') : '.') : '.'));
        U.clear(preview);
        if (ids.length) {
          // Takes the imported dishes off the menu again in one step (they are removed, not deleted).
          preview.appendChild(h('button', { type: 'button', class: 'btn', dataset: { act: 'import-undo' }, onClick: () => { ids.forEach((id) => send('updateMenuItem', { id, patch: { archived: true } })); tell(status, 'Removed the ' + ids.length + ' imported ' + U.plural(ids.length, 'dish', 'dishes') + '.'); U.clear(preview); } }, 'Remove these ' + ids.length));
        }
      });
      preview.append(body, h('div', { class: 'fs-row' }, go));
      paintGo();
    }
    // Reads the chosen file as text and checks it like pasted text.
    fileIn.addEventListener('change', () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      fileName.textContent = f.name;
      if (f.size > M.limits.textMax) { tell(status, 'That file is too big to read. Use a file under 1 MB.'); return; }
      const rd = new g.FileReader();
      // When the file is read, check its text; a failed read says so.
      rd.onload = () => { area.value = String(rd.result || ''); check(area.value, 'the file', ''); };
      rd.onerror = () => { tell(status, 'That file could not be read.'); };
      rd.readAsText(f);
    });
    const checkBtn = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'import-check' } }, ico('check', 20), h('span', null, 'Preview'));
    // Shows the pasted text as a preview of the dishes, before anything is added.
    checkBtn.addEventListener('click', () => check(area.value, 'the pasted text', ''));
    // Export: the menu as a spreadsheet file, so it can be edited elsewhere or kept as a copy.
    const exp = h('button', { type: 'button', class: 'btn', dataset: { act: 'export-menu' } }, ico('download', 20), h('span', null, 'Export my menu'));
    // Builds the menu CSV and starts a download; says so if the browser blocks it.
    exp.addEventListener('click', () => {
      const text = M.exportMenu(SB.store.getState().menu);
      try {
        const url = g.URL.createObjectURL(new g.Blob([text], { type: 'text/csv' }));
        const a = doc.createElement('a'); a.href = url; a.download = 'smokebox-menu.csv'; a.style.display = 'none'; doc.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); g.URL.revokeObjectURL(url); }, 1000);
        tell(status, 'Saved smokebox-menu.csv. Open it in a spreadsheet, or import it again later.');
      } catch (e) { area.value = text; tell(status, 'Your browser blocked the download. The menu is in the box above: copy it into a file named smokebox-menu.csv.'); }
    });
    root.append(h('p', { class: 'fs-sub' }, 'Optional. Choose a spreadsheet (CSV) or an item export from Square, Toast, Clover or Lightspeed, or paste a list. You will see every dish and can fix or clear any before anything is added. Adding dishes by hand in Dishes and prices is just as good. Export my menu saves your dishes as a spreadsheet file.'),
      h('div', { class: 'fs-row' }, fileBtn, fileName), area, h('div', { class: 'fs-row' }, checkBtn, exp), status, preview);
    sheet.body.appendChild(root); keepInView(sheet.body);
    return sheet;
  }

  /* ---------- old demo tickets in real reports ---------- */

  // A small card for the Menu sheet and the Data page: shown only when the real reports still hold old demo or sample tickets.
  // It says how many in plain words and offers Clear them or Keep them; the store remembers a Keep. Returns an element, or null.
  function leftoversCard() {
    const st = SB.store;
    if (!st || typeof st.demoLeftovers !== 'function') return null;
    const d = st.demoLeftovers();
    if (!d || !d.offer) return null;
    const msg = h('p', { class: 'fs-sub', role: 'status' });
    const n = d.tickets, o = d.orders;
    const words = 'Your reports still hold ' + n + ' ' + U.plural(n, 'ticket') + (o ? ' and ' + o + ' ' + U.plural(o, 'order') : '') + ' from the demo or sample data. They are not your sales, and they are mixed into your numbers.' + (d.mixedOrders ? ' ' + d.mixedOrders + ' ' + U.plural(d.mixedOrders, 'order that also holds a real ticket is', 'orders that also hold a real ticket are') + ' left alone.' : '');
    const card = h('section', { class: 'fs-card so-left', dataset: { act: 'demo-leftovers' } }, h('h3', { class: 'fs-h' }, 'Old demo tickets in your reports'), h('p', { class: 'fs-sub' }, words),
      // Clears only the demo and sample tickets, their orders and events; real tickets are never touched.
      h('div', { class: 'fs-row' }, h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'leftovers-clear' }, onClick: () => {
        const r = st.clearDemoLeftovers();
        if (r.ok) { U.clear(card); card.append(h('p', { class: 'fs-sub dp-msg', 'data-tone': 'ok', role: 'status' }, 'Cleared ' + r.info.tickets + ' ' + U.plural(r.info.tickets, 'ticket') + '. Your reports now show only your own sales.')); return; }
        let w = r.report; try { w = SB.engine.describe(r.report, r.info, st.getState().settings) || w; } catch (e) { /* keep the code */ }
        tell(msg, (r.report === 'nothingToDo' ? 'There is nothing left to clear.' : w + ' Nothing was cleared.'), 'bad');
      } }, 'Clear them'),
      // Keeps them and remembers the choice, so the card does not come back.
      h('button', { type: 'button', class: 'btn', dataset: { act: 'leftovers-keep' }, onClick: () => { st.keepDemoLeftovers(); card.remove(); } }, 'Keep them')), msg);
    return card;
  }

  /* ---------- Start over with an empty menu ---------- */

  // The word the owner types to confirm: the store's own word (ERASE), so the screen and the store always agree.
  const START_OVER_WORD = (SB.store && SB.store.START_OVER_WORD) || 'ERASE';
  // Opens "Start over with an empty menu": three plain steps (what goes and what stays, save a backup, type the word). This cannot
  // be undone, so the screen says so first and offers a backup before anything is erased. A kitchen with nothing real to lose
  // (no tickets, orders or history, only dishes or nothing) gets one plain confirm instead (the store's quick start over).
  function openStartOver() {
    // With a PIN set, the keypad comes first; the sheet opens only for the right PIN.
    if (SB.shell && SB.shell.hasPin && SB.shell.hasPin() && SB.shell.requirePin) { SB.shell.requirePin().then((ok) => { if (ok) buildStartOver(); }); return null; }
    return buildStartOver();
  }
  // Builds the Start over sheet (after the PIN, when one is set).
  function buildStartOver() {
    const sheet = SB.ui.sheet({ title: 'Start over with an empty menu', side: 'right', width: 'min(640px, 96vw)', name: 'startover' });
    const root = h('div', { class: 'dp so' });
    const simple = !!(SB.store.nothingToLose && SB.store.nothingToLose());
    const keep = h('input', { type: 'checkbox', checked: true, id: 'so-keep' });
    const keepLabel = h('label', { class: 'dp-check-row', for: 'so-keep' }, keep, h('span', null, 'Keep my tax, hours, PIN and station names'));
    const step1 = h('section', { class: 'fs-section so-step' },
      h('h3', { class: 'fs-h' }, '1. What happens'),
      h('p', { class: 'fs-sub' }, 'This empties your kitchen so you can begin again with a blank menu.'),
      h('p', null, h('strong', null, 'This goes: '), 'every dish and price, cooked-ahead items and their batches, portion counts, all tickets and orders, and all sales and history kept on this device. The food safety record stays.'),
      h('p', null, h('strong', null, 'This stays if the box is selected: '), 'your sales tax, opening hours, manager PIN, and the names you gave your stations and sections. Clear the box and those go back to how Smokebox starts.'),
      keepLabel,
      simple ? h('p', { class: 'fs-note' }, 'You have no tickets, orders or sales yet, so only your dishes and their setup go. No backup is needed.')
        : h('p', { class: 'fs-note', 'data-tone': 'warn' }, 'This cannot be undone. Save a backup first: it is the only way to bring the old menu and history back.'));
    const next1 = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'so-next1' } }, 'Next: about your backup');
    // The one-step confirm for a kitchen with nothing real to lose.
    const quickGo = h('button', { type: 'button', class: 'btn btn-danger btn-lg', dataset: { act: 'so-quick' } }, ico('trash', 22), h('span', null, 'Start over now'));
    const quickSt = h('p', { class: 'fs-sub', role: 'status' });
    if (simple) step1.append(quickGo, quickSt); else step1.appendChild(next1);

    const next2 = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'so-next2' }, disabled: true }, 'Next: confirm');
    let backupInfo = null; // what the backup file was called and how big, once it was handed to the browser
    const bkSt = h('p', { class: 'fs-sub dp-msg', role: 'status', dataset: { role: 'so-backup-msg' } });
    // Saves the backup file now, before anything is erased, and asks the person to confirm they can find it.
    const saveNow = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'so-save-backup' }, onClick: () => {
      let text = null; try { text = SB.store.exportAll(); } catch (e) { text = null; }
      if (!text) { tell(bkSt, 'The backup could not be made, so nothing can be erased. Nothing was changed.', 'bad'); return; }
      // Pads a number to two digits so the backup file name sorts by time.
      const d = new Date(), pad2 = (n) => String(n).padStart(2, '0');
      const filename = 'smokebox-backup-before-start-over-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
      try { const url = g.URL.createObjectURL(new g.Blob([text], { type: 'application/json' })); const a = doc.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none'; doc.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); g.URL.revokeObjectURL(url); }, 4000); }
      catch (e) { tell(bkSt, 'This browser would not save the file. Nothing was erased. Try again, or back up from Back office, Data first.', 'bad'); return; }
      backupInfo = { filename, chars: text.length };
      tell(bkSt, 'Asked your browser to save ' + filename + ' (' + Math.max(1, Math.round(text.length / 1024)) + ' KB). Look in your downloads folder to be sure it is there.', 'ok');
      sawIt.disabled = false; saveNow.textContent = 'Save it again';
    } }, 'Save my backup file now');
    const sawIt = h('input', { type: 'checkbox', id: 'so-saw', disabled: true, dataset: { act: 'so-saw' } });
    // The next step opens only after the person says the file is saved and they can find it.
    sawIt.addEventListener('change', () => { next2.disabled = !(sawIt.checked && backupInfo); });
    const step2 = h('section', { class: 'fs-section so-step', hidden: true },
      h('h3', { class: 'fs-h' }, '2. Your backup'),
      h('p', { class: 'fs-sub' }, 'First save a backup file with everything in your kitchen as it is now. It goes to your downloads: keep a copy off this device. Nothing is erased until you say you saved it.'),
      saveNow, bkSt,
      h('label', { class: 'dp-check-row', for: 'so-saw' }, sawIt, h('span', null, 'I saved the backup file and I can find it')),
      h('p', { class: 'fs-sub' }, 'To bring everything back later: Back office, Data, Restore.'), next2);

    const word = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Type ' + START_OVER_WORD + ' to confirm', placeholder: START_OVER_WORD });
    const goStep3 = h('p', { class: 'fs-sub', role: 'status' });
    const go = h('button', { type: 'button', class: 'btn btn-danger btn-lg', dataset: { act: 'so-go' }, disabled: true }, ico('trash', 22), h('span', null, 'Erase everything and start over'));
    // The red button only wakes up when the exact word has been typed.
    word.addEventListener('input', () => { go.disabled = word.value.trim().toUpperCase() !== START_OVER_WORD; });
    const step3 = h('section', { class: 'fs-section so-step', hidden: true },
      h('h3', { class: 'fs-h' }, '3. Type ' + START_OVER_WORD),
      h('p', { class: 'fs-sub' }, 'To be sure this is what you want, type ' + START_OVER_WORD + ' in the box. Then the red button works.'),
      SB.ui.field({ label: 'Type ' + START_OVER_WORD, control: word }), go, goStep3);
    const done = h('section', { class: 'fs-section so-step', hidden: true });

    // Shows one step and hides the others.
    const show = (which) => { [step1, step2, step3, done].forEach((s, i) => { s.hidden = i !== which; }); };
    next1.addEventListener('click', () => show(1));
    next2.addEventListener('click', () => show(2));
    go.addEventListener('click', () => erase(false));
    quickGo.addEventListener('click', () => erase(true));
    // Erases the kitchen: empty menu, optionally the settings too, then shows the done screen. Any refusal is shown in the same one-line style.
    // quick is the one-step start over: no word and no backup file, and the store itself refuses it if anything real would go.
    function erase(quick) {
      const keepIt = keep.checked;
      const goSt = quick ? quickSt : goStep3;
      // The store makes its own backup first, clears the kitchen, my saved setup bits and (when asked) the settings and station names.
      const res = SB.store.startOver(quick ? { quick: true, keepSettings: keepIt } : { confirm: word.value, keepSettings: keepIt, backupSaved: backupInfo });
      if (!res.ok) {
        let w = res.report;
        try { w = SB.engine.describe(res.report, res.info, SB.store.getState().settings) || w; } catch (e) { /* keep the code */ }
        if (res.report === 'backupRequired') w = quick ? 'Orders or tickets were added since this opened, so a backup comes first. Close this and open Start over again. Nothing was erased.' : 'Save the backup file first (step 2). Nothing was erased.';
        else if (res.report === 'confirmWord') w = 'Type ' + START_OVER_WORD + ' exactly, then try again. Nothing was erased.';
        else if (res.report === 'notInDemo') w = 'You are in the demo, so there is nothing of yours to erase here. Tap Back to my kitchen first.';
        tell(goSt, w + (res.report === 'confirmWord' || res.report === 'notInDemo' || res.report === 'backupRequired' ? '' : ' Nothing was erased.'), 'bad');
        return;
      }
      const needsReload = !keepIt;
      const auto = res.backup;
      // The backup comes from the same call that erased: download it now, and keep a button for another copy.
      const saveAuto = () => { try { const url = g.URL.createObjectURL(new g.Blob([auto.text], { type: auto.mime })); const a = doc.createElement('a'); a.href = url; a.download = auto.filename; a.style.display = 'none'; doc.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); g.URL.revokeObjectURL(url); }, 1000); return true; } catch (e) { return false; } };
      const savedOk = auto && !quick ? saveAuto() : false; // the one-step start over offers the copy but never forces a download
      if (SB.floor && SB.floor.setWelcome) SB.floor.setWelcome(true);
      U.clear(done);
      done.append(h('h3', { class: 'fs-h' }, 'Done. Your kitchen is empty.'),
        h('p', { class: 'fs-sub' }, (quick ? 'The menu is gone' : 'The menu, tickets and history are gone') + (keepIt ? '. Your tax, hours, PIN and station names stayed.' : ', and tax, hours, PIN and station names are back to how Smokebox starts.')),
        // The backup made by the same call that erased: says whether it was saved, and offers another copy.
        auto && !quick ? h('p', { class: 'fs-sub dp-msg', 'data-tone': savedOk ? 'ok' : 'bad', role: 'status' }, (savedOk ? 'Saved ' + auto.filename + ' (' + Math.max(1, Math.round(auto.chars / 1024)) + ' KB) to your downloads, from just before the erase. ' : 'Your browser blocked the backup download. ')) : null,
        auto ? h('button', { type: 'button', class: 'btn', dataset: { act: 'so-auto-backup' }, onClick: () => saveAuto() }, quick ? 'Save a copy of the old menu' : 'Save the backup again') : null,
        // Goes to the first screen: closes the sheets (and reloads when station names were reset so every screen shows them).
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'so-finish' }, onClick: () => { if (needsReload) g.location.reload(); else SB.sheets.closeAll(); } }, 'Go to the first screen'));
      show(3);
    }
    root.append(step1, step2, step3, done);
    sheet.body.appendChild(root); keepInView(root);
    return sheet;
  }

  /* ---------- Close the month ---------- */

  // The word the owner types to confirm closing the month.
  const CLOSE_MONTH_WORD = 'CLOSE';
  // Plain words for each way Close the month can be refused. Nothing is removed in any of these cases.
  const MONTH_WORDS = {
    backupRequired: 'The files must be saved first. Go back to step 2 and save them again. Nothing was removed.',
    exportStale: 'Something changed since you saved the files (a new day started or a record changed). Save the files again in step 2, then close. Nothing was removed.',
    notInDemo: 'You are in the demo, so there is no real history to close here. Tap Back to my kitchen first. Nothing was removed.',
    hubKitchen: 'This device works through the main computer, so the month cannot be closed here. Do this on the main computer\'s own screen or the main tablet. Nothing was removed.',
    nothingToDo: 'There is nothing to close yet. Only finished days older than the recent days that always stay can be moved out, and none are left before that date. Nothing was removed.',
    storageBlocked: 'This browser would not save the change, so nothing was removed. Your kitchen is exactly as it was. Allow site data or use a normal window, then try again.',
    badPatch: 'That date is not one Smokebox can use. Pick a date and try again. Nothing was removed.',
  };
  // The calm line a sheet with nothing to close shows before the owner does anything.
  const NOTHING_YET = 'There is nothing to close yet. Finished days can be moved out once they are older than the recent days that always stay.';
  // Turns a store answer that was refused into one plain sentence.
  function monthWords(r) { return MONTH_WORDS[r && r.report] || ((r && r.report) ? 'Smokebox could not do that (' + r.report + '). Nothing was removed.' : 'Smokebox could not do that. Nothing was removed.'); }
  // Writes a YYYY-MM-DD day as a short date like Mar 3, 2026.
  function monthDay(ymd) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return String(ymd || ''); return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  // The first day of the current month as YYYY-MM-DD, the usual "close everything before" date.
  function firstOfMonth() { const d = new Date(SB.store.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; }
  // Opens "Close the month": with a PIN set, the keypad comes first. opts.before picks the date (YYYY-MM-DD); the default is the first of this month.
  function openCloseMonth(opts) {
    if (SB.shell && SB.shell.hasPin && SB.shell.hasPin() && SB.shell.requirePin) { SB.shell.requirePin().then((ok) => { if (ok) buildCloseMonth(opts || {}); }); return null; }
    return buildCloseMonth(opts || {});
  }
  // Builds the Close the month sheet: what happens, save the files, type the word, then the done screen with Undo.
  function buildCloseMonth(opts) {
    const sheet = SB.ui.sheet({ title: 'Close the month', side: 'right', width: 'min(640px, 96vw)', name: 'closemonth' });
    const root = h('div', { class: 'dp so cm' });
    const store = SB.store;
    let before = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.before || '')) ? opts.before : firstOfMonth();
    let exported = null; // the files of the last export: { files, backup: { filename, chars, sha256 } }

    // Step 1: what happens, with the real counts. The warning only shows when there is something to close.
    const warnNote = h('p', { class: 'fs-note', 'data-tone': 'warn' }, 'After step 3 the history leaves this device. For 7 days you can still undo it here; after that, the files you save in step 2 are the only copy.');
    const dateIn = h('input', { class: 'input', type: 'date', value: before, id: 'cm-before', dataset: { field: 'before' } });
    const counts = h('div', { class: 'cm-counts', role: 'status', dataset: { role: 'cm-counts' } });
    const next1 = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'cm-next1' }, disabled: true }, 'Next: save the files');
    // Redraws the counts for the chosen date. The store says what would move out and what stays; nothing changes here.
    // Before the owner does anything, a sheet with nothing to close says so in one calm line, and the steps and the
    // warning about them stay out of sight (Next is hidden, not just grey).
    function paintPreview() {
      before = /^\d{4}-\d{2}-\d{2}$/.test(dateIn.value) ? dateIn.value : before; exported = null;
      U.clear(counts); next1.disabled = true; next1.hidden = true; warnNote.hidden = true;
      // One calm line in place of the counts.
      const calm = (words) => counts.append(h('p', { class: 'fs-note' }, words));
      if (store.isHubClient && store.isHubClient()) { calm(monthWords({ report: 'hubKitchen' }).replace(' Nothing was removed.', '')); return; }
      if (store.isDemo && store.isDemo()) { calm(monthWords({ report: 'notInDemo' }).replace(' Nothing was removed.', '')); return; }
      const r = store.closeMonthPreview({ before });
      if (!r.ok && r.report === 'nothingToDo') { calm(NOTHING_YET); return; }
      if (!r.ok) { counts.append(h('p', { class: 'fs-note', 'data-tone': 'warn' }, monthWords(r))); return; }
      const p = r.preview;
      if (!p.tickets && !p.orders && !p.events) { calm(NOTHING_YET); return; }
      // Writes a count with the right singular or plural word.
      const n = (x, one, many) => Number(x).toLocaleString() + ' ' + U.plural(x, one, many);
      // How many recent days stay: 35, or fewer on a busy kitchen whose saved history is near its limits (engine adaptiveKeepDays).
      let keep = 35;
      try { const hf = store.historyFill ? store.historyFill() : null; if (hf && Number.isInteger(hf.keepDays)) keep = hf.keepDays; } catch (e) { /* 35 */ }
      counts.append(...[
        h('p', null, h('strong', null, 'This moves out of your kitchen: '), n(Array.isArray(p.days) ? p.days.length : p.days, 'day') + ' of history (' + monthDay(p.from) + ' up to, not including, ' + monthDay(p.before) + '), with ' + n(p.orders, 'order') + ', ' + n(p.tickets, 'ticket') + ' and ' + n(p.events, 'activity record', 'activity records') + '.'),
        p.before !== before ? h('p', { class: 'fs-sub' }, 'You picked ' + monthDay(before) + ', but the last ' + n(keep, 'day') + ' always stay, so it stops at ' + monthDay(p.before) + '.') : null,
        h('p', null, h('strong', null, 'This stays: '), 'the last ' + n(keep, 'day') + ', today, every open order and open ticket' + (p.openOrdersKept || p.openTicketsKept ? ' (' + n(p.openOrdersKept || 0, 'open order') + ', ' + n(p.openTicketsKept || 0, 'open ticket') + ' right now)' : '') + ', your menu and settings, the end-of-day totals, and all food-safety records (' + n(p.safetyEventsKept || 0, 'record') + ').'),
        p.uncoveredDays && p.uncoveredDays.length ? h('p', { class: 'fs-sub' }, n(p.uncoveredDays.length, 'older day') + ' with records but no end-of-day close stay where they are.') : null].filter(Boolean));
      next1.disabled = false; next1.hidden = false; warnNote.hidden = false;
    }
    dateIn.addEventListener('change', paintPreview);
    const step1 = h('section', { class: 'fs-section so-step' },
      h('h3', { class: 'fs-h' }, '1. What this does'),
      h('p', { class: 'fs-sub' }, 'Close the month moves old, finished history out of this device so it stays quick. First you save everything to files. Nothing is removed until step 3.'),
      SB.ui.field({ label: 'Close everything before', control: dateIn }),
      counts,
      warnNote,
      next1);

    // Step 2: save the files.
    const fileList = h('ul', { class: 'cm-files', dataset: { role: 'cm-files' } });
    const saveSt = h('p', { class: 'fs-sub dp-msg', role: 'status', dataset: { role: 'cm-save-msg' } });
    const next2 = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'cm-next2' }, disabled: true }, 'Next: confirm');
    const saw = h('input', { type: 'checkbox', id: 'cm-saw', disabled: true, dataset: { act: 'cm-saw' } });
    saw.addEventListener('change', () => { next2.disabled = !(saw.checked && exported); });
    // Hands one file to the browser as a download.
    function download(f) {
      const url = g.URL.createObjectURL(new g.Blob([f.text], { type: f.mime || 'text/plain' }));
      const a = doc.createElement('a'); a.href = url; a.download = f.name; a.style.display = 'none'; doc.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); g.URL.revokeObjectURL(url); }, 4000);
    }
    // Makes the files and downloads them one after another (a browser may refuse several at once). The backup file comes first.
    const saveNow = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'cm-save-files' },
      // Makes the export, lists the files and starts the downloads, or says in words why it could not.
      onClick: () => {
      const r = store.closeMonthExport({ before });
      if (!r.ok) { tell(saveSt, monthWords(r), 'bad'); return; }
      exported = { files: r.files, backup: { filename: r.files[0].name, chars: r.files[0].chars, sha256: r.files[0].sha256 } };
      U.clear(fileList);
      const kindWord = { backup: 'Backup of the whole kitchen (to bring everything back)', orders: 'Orders being closed (opens in a spreadsheet)', tickets: 'Tickets being closed (opens in a spreadsheet)', days: 'Days being closed (opens in a spreadsheet)', manifest: 'List of what is in these files' };
      r.files.forEach((f) => fileList.append(h('li', null, h('strong', null, f.name), ' ' + (kindWord[f.kind] || '') + ', ' + Math.max(1, Math.round(f.chars / 1024)) + ' KB')));
      try { r.files.forEach((f, i) => setTimeout(() => { try { download(f); } catch (e) { /* the message below covers it */ } }, i * 400)); }
      catch (e) { tell(saveSt, 'This browser would not save the files. Nothing was removed. Try again.', 'bad'); return; }
      tell(saveSt, 'Asked your browser to save ' + r.files.length + ' files. Look in your downloads folder and check every file listed above is there. If the browser asks to allow several downloads, say yes.', 'ok');
      saw.disabled = false; saw.checked = false; next2.disabled = true; saveNow.textContent = 'Save the files again';
    } }, 'Save the month files now');
    const step2 = h('section', { class: 'fs-section so-step', hidden: true },
      h('h3', { class: 'fs-h' }, '2. Save the month files now'),
      h('p', { class: 'fs-sub' }, 'These files hold your whole kitchen and the history being closed. Keep a copy off this device too (a memory stick or your email).'),
      saveNow, fileList, saveSt,
      h('label', { class: 'dp-check-row', for: 'cm-saw' }, saw, h('span', null, 'I saved the files and I can find them')),
      h('p', { class: 'fs-sub' }, 'To bring everything back later: Back office, Data, Restore, and pick the backup file.'), next2);

    // Step 3: the typed word and the red button.
    const word = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Type ' + CLOSE_MONTH_WORD + ' to confirm', placeholder: CLOSE_MONTH_WORD });
    const goSt = h('p', { class: 'fs-sub', role: 'status', dataset: { role: 'cm-go-msg' } });
    const go = h('button', { type: 'button', class: 'btn btn-danger btn-lg', dataset: { act: 'cm-go' }, disabled: true }, ico('trash', 22), h('span', null, 'Close the month'));
    word.addEventListener('input', () => { go.disabled = word.value.trim().toUpperCase() !== CLOSE_MONTH_WORD; });
    const step3 = h('section', { class: 'fs-section so-step', hidden: true },
      h('h3', { class: 'fs-h' }, '3. Type ' + CLOSE_MONTH_WORD),
      h('p', { class: 'fs-sub' }, 'To be sure this is what you want, type ' + CLOSE_MONTH_WORD + ' in the box. Then the red button works.'),
      SB.ui.field({ label: 'Type ' + CLOSE_MONTH_WORD, control: word }), go, goSt);
    const done = h('section', { class: 'fs-section so-step', hidden: true, dataset: { role: 'cm-done' } });

    // Shows one step and hides the others.
    const show = (which) => { [step1, step2, step3, done].forEach((s, i) => { s.hidden = i !== which; }); };
    next1.addEventListener('click', () => show(1));
    next2.addEventListener('click', () => show(2));
    go.addEventListener('click', () => {
      if (!exported) { tell(goSt, MONTH_WORDS.backupRequired, 'bad'); return; }
      const res = store.closeMonthPrune({ before, confirmBackupSaved: exported.backup });
      if (!res.ok) {
        tell(goSt, monthWords(res), 'bad');
        if (res.report === 'exportStale' || res.report === 'backupRequired') { exported = null; saw.checked = false; saw.disabled = true; next2.disabled = true; saveNow.textContent = 'Save the month files now'; U.clear(fileList); show(1); tell(saveSt, 'Save the files again, then continue.', 'bad'); }
        return;
      }
      const i = res.info;
      // Writes a count with the right singular or plural word.
      const n = (x, one, many) => Number(x).toLocaleString() + ' ' + U.plural(x, one, many);
      const undoMsg = h('p', { class: 'fs-sub', role: 'status', dataset: { role: 'cm-undo-msg' } });
      U.clear(done);
      done.append(h('h3', { class: 'fs-h' }, 'Done. The month is closed.'),
        h('p', { class: 'fs-sub' }, 'Moved out: ' + n(i.days, 'day') + ' (' + monthDay(i.from) + ' up to, not including, ' + monthDay(i.before) + '), ' + n(i.orders, 'order') + ', ' + n(i.tickets, 'ticket') + ' and ' + n(i.events, 'activity record', 'activity records') + '. Food-safety records all stayed (' + i.safetyEventsKept + ').'),
        i.copyKept ? h('p', { class: 'fs-note', 'data-tone': 'ok' }, 'Your kitchen before this is kept for ' + i.copyKeepDays + ' days: ',
          // Puts the kitchen back exactly as it was before the month was closed.
          h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'cm-undo' }, onClick: () => {
            const rep = store.undoRestore();
            if (rep === 'ok' || (rep && rep.ok)) { tell(undoMsg, 'Undone. Your kitchen is back as it was, with all the history.', 'ok'); } else tell(undoMsg, 'The saved copy could not be put back (' + (rep && rep.report ? rep.report : rep) + '). Use the backup file you saved: Back office, Data, Restore.', 'bad');
          } }, 'Undo')) : h('p', { class: 'fs-note', 'data-tone': 'warn' }, (i.restoreCopyKept ? 'Your kitchen from before your recent restore is still kept, so no second copy was made here. ' : 'No copy could be kept on this device, so ') + 'the files you saved are the only way back from this close: Back office, Data, Restore.'),
        undoMsg,
        // Closes the sheet when the person is finished reading the result.
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'cm-finish' }, onClick: () => SB.sheets.closeAll() }, 'Done'));
      show(3);
    });
    root.append(step1, step2, step3, done);
    sheet.body.appendChild(root); keepInView(root);
    paintPreview();
    return sheet;
  }

  /* ---------- How you serve ---------- */

  // The starting order buttons, as the engine knows them (the built-in list used when none is saved).
  const chipDefaults = () => (SB.engine && SB.engine.chipsOf ? SB.engine.chipsOf({}) : ['Walk-up', 'Pickup', 'Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6']);
  const CHIP_MAX = (SB.engine && SB.engine.CHIP_MAX) || 12; // the most order buttons the order screen holds
  const CHIP_LEN = (SB.engine && SB.engine.CHIP_LEN) || 24; // letters in one order button name
  // The order buttons now in use, as plain names: the owner's list, or the starting list when none is saved.
  function currentChips() { return SB.engine && SB.engine.chipsOf ? SB.engine.chipsOf(SB.store.getState().settings) : chipDefaults(); }
  // The currency symbol now shown with prices, as plain text ($ when none is saved).
  function currentSymbol() {
    const ui = (SB.store.getState().settings || {}).ui || {};
    return typeof ui.currency === 'string' && ui.currency ? ui.currency : '$';
  }
  // Opens "How you serve": counter service on or off, the order buttons, and the currency symbol. Every change saves at once and
  // offers Undo; nothing here is required.
  function openServe() {
    const sheet = SB.ui.sheet({ title: 'How you serve', side: 'right', width: 'min(640px, 96vw)', name: 'serve', onClose: () => offs.splice(0).forEach((f) => f()) });
    const offs = [];
    const root = h('div', { class: 'dp so-serve' });
    const undoBar = h('div', { class: 'fs-note dp-undo', hidden: true, role: 'status' });
    // Shows a message with an Undo button that runs the given undo step.
    function offerUndo(message, undo) {
      U.clear(undoBar);
      // Runs the undo step and puts the bar away.
      undoBar.append(h('span', null, message + ' '), h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'serve-undo' }, onClick: () => { undo(); undoBar.hidden = true; } }, 'Undo'));
      undoBar.hidden = false;
    }

    // 1. Counter service.
    const cSt = h('p', { class: 'fs-sub', role: 'status' });
    // Says whether counter service is on now.
    const counterOn = () => !!(((SB.store.getState().settings || {}).service || {}).counter);
    const counterTog = SB.ui.toggle({ label: 'Counter service', checked: counterOn(),
      // Saves the choice, says what it means, and offers Undo.
      onChange: (on) => {
        const before = !on;
        const r = send('updateSettings', { patch: { service: { counter: on } } });
        if (!r.ok && r.report !== 'nothingToDo') { counterTog.setValue(before); tell(cSt, r.words, 'bad'); return; }
        tell(cSt, on ? 'On. You hand food over at the counter, so orders do not wait on kitchen tickets.' : 'Off. Orders go to the kitchen as tickets.', 'ok');
        paintCounter(on);
        offerUndo('Counter service is ' + (on ? 'on' : 'off') + '.', () => { send('updateSettings', { patch: { service: { counter: before } } }); counterTog.setValue(before); paintCounter(before); });
      } });
    // Writes On or Off beside the switch, so its state never depends on reading the switch's colors.
    const counterWord = h('strong', { class: 'so-onoff' }, '');
    counterTog.querySelector('.toggle-label').append(': ', counterWord);
    // Sets that word to match the switch.
    function paintCounter(on) { counterWord.textContent = on ? 'On' : 'Off'; }
    paintCounter(counterOn());
    const sec1 = h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Counter service'),
      h('p', { class: 'fs-sub' }, 'You hand food over at the counter and do not need kitchen tickets. Leave it off if cooks work from tickets.'), counterTog, cSt);

    // 2. Order buttons.
    const bSt = h('p', { class: 'fs-sub', role: 'status' });
    const list = h('div', { class: 'dp-stlist' });
    // Saves a whole new list of order buttons, with Undo back to the old list.
    function saveChips(next, message) {
      const before = currentChips();
      if (next.length > CHIP_MAX) { tell(bSt, 'You can have up to ' + CHIP_MAX + ' order buttons. Remove one first.', 'bad'); return false; }
      const r = send('setChips', { chips: next });
      if (!r.ok && r.report !== 'nothingToDo') { tell(bSt, r.words, 'bad'); return false; }
      tell(bSt, message, 'ok');
      offerUndo(message, () => { send('setChips', { chips: before }); paintChips(); });
      paintChips();
      return true;
    }
    // Rebuilds the list: each button now on the order screen as a chip with an x to remove it, then an add box.
    // No buttons at all says so in words, so an empty list never looks like a missing one.
    function paintChips() {
      U.clear(list);
      const cur = currentChips();
      const chips = h('div', { class: 'ord-chips so-chips', role: 'group', 'aria-label': 'Order buttons now' });
      cur.forEach((label, i) => {
        // Removes this button (it can be added again, or brought back with Undo).
        chips.appendChild(h('button', { type: 'button', class: 'chip so-chip', 'aria-label': 'Remove ' + label, onClick: () => saveChips(cur.filter((x, j) => j !== i), 'Removed ' + label + '.') }, h('span', null, label), ico('x', 16)));
      });
      list.appendChild(cur.length ? chips : h('p', { class: 'fs-sub so-none' }, 'No order buttons now: the order screen shows only the name box. Add one below, or tap Use the starting list (' + chipDefaults().join(', ') + ').'));
      const addIn = h('input', { class: 'input', type: 'text', maxlength: CHIP_LEN, placeholder: 'New button, like Phone', 'aria-label': 'New order button name' });
      // Adds a button with the typed name at the end of the list.
      const add = () => {
        const v = addIn.value.replace(/\s+/g, ' ').trim();
        if (!v) return;
        if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) { tell(bSt, 'There is already a button called ' + v + '. Pick another name.', 'bad'); return; }
        if (saveChips(cur.concat([v]), 'Added ' + v + '.')) addIn.value = '';
      };
      addIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
      list.appendChild(h('div', { class: 'dp-strow' }, addIn, h('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'chip-add' }, onClick: add }, ico('plus', 18), h('span', null, 'Add button'))));
    }
    paintChips();
    const reset = h('button', { type: 'button', class: 'btn', dataset: { act: 'chips-reset' },
      // Goes back to the starting list of order buttons (with Undo).
      onClick: () => saveChips(chipDefaults(), 'Order buttons are back to the starting list.') }, 'Use the starting list');
    const sec2 = h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Order buttons'),
      h('p', { class: 'fs-sub' }, 'The quick buttons on the order screen for who the order is for, like Walk-up, Pickup, a table, Phone or Delivery. Tap one below to remove it. Up to ' + CHIP_MAX + '.'), list, reset, bSt);

    // 3. Currency symbol.
    const curSt = h('p', { class: 'fs-sub', role: 'status' });
    const custom = h('input', { class: 'input dp-num', type: 'text', maxlength: 3, autocomplete: 'off', 'aria-label': 'Your own currency symbol', placeholder: 'kr' });
    const symbols = ['$', '\u20ac', '\u00a3'];
    const now = currentSymbol();
    const seg = SB.ui.segmented({ label: 'Currency symbol', value: symbols.indexOf(now) >= 0 ? now : 'other',
      options: symbols.map((s) => ({ id: s, label: s })).concat([{ id: 'other', label: 'Your own' }]),
      // Picks a standard symbol (saved at once) or shows the box for your own.
      onChange: (id) => { custom.hidden = id !== 'other'; if (id !== 'other') saveSymbol(id); } });
    custom.hidden = symbols.indexOf(now) >= 0;
    if (symbols.indexOf(now) < 0) custom.value = now;
    // Saves a symbol and offers Undo back to the old one.
    function saveSymbol(sym) {
      const before = currentSymbol();
      if (sym === before) return;
      const r = send('updateSettings', { patch: { ui: { currency: sym } } });
      if (!r.ok && r.report !== 'nothingToDo') { tell(curSt, r.words, 'bad'); return; }
      tell(curSt, 'Prices now show ' + sym + '. Screens already open update when you close this sheet.', 'ok');
      offerUndo('Currency symbol is ' + sym + '.', () => { send('updateSettings', { patch: { ui: { currency: before } } }); });
    }
    // Saves your own symbol when the box is left; one to three characters.
    custom.addEventListener('change', () => { const v = custom.value.trim(); if (!v || !(SB.util.validCurrency ? SB.util.validCurrency(v) : v.length <= 3)) { tell(curSt, 'Type one to three letters or signs, like kr or Rs. No digits.', 'bad'); return; } saveSymbol(v); });
    const sec3 = h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, 'Currency symbol'),
      h('p', { class: 'fs-sub' }, 'Shown with every price. It does not convert anything.'), seg, custom, curSt);

    offs.push(SB.store.subscribe(() => { if (!list.contains(doc.activeElement)) paintChips(); }));
    root.append(undoBar, sec1, sec2, sec3);
    sheet.body.appendChild(root); keepInView(root);
    return sheet;
  }

  /* ---------- PIN recovery code ---------- */

  // Makes a new recovery code and shows it once on a "write this down" screen with Copy and Print. The Done button stays off until the
  // owner selects "I saved it". Needs a PIN; says plainly why when it cannot make one. Used after a PIN is set, and from the PIN section.
  async function showRecoveryCode(opts) {
    const st = SB.store;
    if (!st || typeof st.createRecoveryCode !== 'function') return false;
    // A new code replaces the old one, so with a PIN set the current PIN must be entered first (unless it was just entered).
    if (!(opts && opts.verified) && SB.shell && SB.shell.hasPin && SB.shell.hasPin() && SB.shell.requirePin && !(await SB.shell.requirePin())) { if (SB.ui.toast) SB.ui.toast('The PIN was not entered, so no recovery code was made.', { tone: 'warn' }); return false; }
    const r = await st.createRecoveryCode();
    if (!r.ok) { let w = r.report; try { w = SB.engine.describe(r.report, r.info, st.getState().settings) || w; } catch (e) { /* keep the code */ } if (SB.ui.toast) SB.ui.toast('The recovery code could not be made. ' + w, { tone: 'warn' }); return false; }
    const sheet = SB.ui.sheet({ title: 'Write down your recovery code', side: 'center', width: 'min(560px, 96vw)', name: 'recoverycode' });
    const codeEl = h('div', { class: 'rc-code', 'aria-label': 'Your recovery code', role: 'textbox' }, r.code);
    const msg = h('p', { class: 'fs-sub', role: 'status' });
    // Copies the code to the clipboard and says whether that worked.
    const copy = h('button', { type: 'button', class: 'btn', dataset: { act: 'rc-copy' }, onClick: () => { Promise.resolve(SB.ui.copyText ? SB.ui.copyText(r.code) : false).then((ok) => tell(msg, ok ? 'Copied. Paste it somewhere safe, away from this tablet.' : 'Could not copy. Write the code down by hand.', ok ? 'ok' : 'bad')); } }, ico('copy', 20), h('span', null, 'Copy'));
    // Prints a page with only the code and a short note, through a hidden frame.
    const print = h('button', { type: 'button', class: 'btn', dataset: { act: 'rc-print' }, onClick: () => {
      try {
        const f = doc.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; doc.body.appendChild(f);
        f.contentDocument.open(); f.contentDocument.write('<!doctype html><title>Smokebox recovery code</title><body style="font-family:sans-serif;padding:24px"><h1>Smokebox recovery code</h1><p style="font:700 32px monospace;letter-spacing:4px">' + r.code + '</p><p>Keep this page somewhere safe, away from the tablet. It is the only way back in if the manager PIN is forgotten.</p></body>'); f.contentDocument.close();
        f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000);
      } catch (e) { tell(msg, 'This browser could not print. Write the code down by hand.', 'bad'); }
    } }, ico('receipt', 20), h('span', null, 'Print'));
    const saved = h('input', { type: 'checkbox', id: 'rc-saved' });
    // Copies the recovery code to the clipboard and says whether it worked.
    const done = h('button', { type: 'button', class: 'btn btn-primary btn-lg', dataset: { act: 'rc-done' }, disabled: true, onClick: () => sheet.close('done') }, 'Done');
    // The Done button wakes up only when the owner says the code is saved.
    saved.addEventListener('change', () => { done.disabled = !saved.checked; });
    sheet.body.append(h('div', { class: 'dp' },
      h('p', null, h('strong', null, 'Write this down now. '), 'If you forget the manager PIN, this code is the only way to set a new one. It will not be shown again, and Smokebox does not keep a readable copy.'),
      codeEl, h('div', { class: 'fs-row' }, copy, print), msg,
      h('label', { class: 'dp-check-row', for: 'rc-saved' }, saved, h('span', null, 'I saved it')), done));
    return true;
  }

  /* ---------- Device checks ---------- */

  // Plays one short, clear beep through the browser's own audio, at this tablet's saved loudness. Returns true when a beep was started.
  // A tap is needed first on most tablets: it is only called from a button.
  function playBeep() {
    try {
      const AC = g.AudioContext || g.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const vol = SB.floor && typeof SB.floor.volume === 'function' ? SB.floor.volume() : 0.8;
      osc.type = 'sine'; osc.frequency.value = 880; gain.gain.value = Math.max(0.2, Math.min(1, vol));
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.45);
      setTimeout(() => { try { ctx.close(); } catch (e) { /* already closed */ } }, 800);
      return true;
    } catch (e) { return false; }
  }
  // True when this page runs as an installed app (opened from the home screen), on iPad or Android.
  function isInstalled() {
    try { return !!(g.navigator && g.navigator.standalone) || !!(g.matchMedia && (g.matchMedia('(display-mode: standalone)').matches || g.matchMedia('(display-mode: fullscreen)').matches)); } catch (e) { return false; }
  }
  // Opens "Device checks": five checks in plain words, each with a green tick or a plain "do this" line. It only reports what the
  // browser can really tell (screen awake, installed, full screen); sound and volume are confirmed by the person who hears the beep.
  function openReady() {
    const sheet = SB.ui.sheet({ title: 'Device checks', side: 'right', width: 'min(720px, 96vw)', name: 'ready', onClose: () => { releaseWake(); } });
    const root = h('div', { class: 'dp rd' });
    let sentinel = null, wakeNow = 'unknown', heard = null, played = false, loud = null;
    // Lets go of the screen hold this sheet took, when it closes.
    function releaseWake() { try { if (sentinel && sentinel.release) sentinel.release(); } catch (e) { /* already released */ } sentinel = null; }
    // One check card: an icon (tick or do this), a title, a plain line, and room for buttons.
    const card = (id, title) => { const el = h('section', { class: 'fs-card rd-card', dataset: { check: id } }); return { el, title, set(ok, line, ...extra) { U.clear(el); el.dataset.ok = ok === true ? 'true' : ok === false ? 'false' : 'unknown'; el.append(h('div', { class: 'rd-head' }, ico(ok === true ? 'check-circle' : 'alert-circle', 26), h('h3', { class: 'fs-h' }, title), h('span', { class: 'rd-state' }, ok === true ? 'Ready' : ok === false ? 'Do this' : 'Not checked yet')), h('p', { class: 'fs-sub' }, line), ...extra.filter(Boolean)); } }; };
    const cAwake = card('awake', 'Screen stays awake'), cSound = card('sound', 'Sound is on'), cVol = card('volume', 'Volume is loud enough'), cInst = card('installed', 'Added to the home screen'), cFull = card('full', 'Full screen');
    const summary = h('p', { class: 'fs-sub rd-summary', role: 'status' });
    // Counts the ticks and says how many checks are done.
    function paintSummary() { const n = [cAwake, cSound, cVol, cInst, cFull].filter((c) => c.el.dataset.ok === 'true').length; tell(summary, n + ' of 5 ready. A check mark means the device or you confirmed it; it is not a promise it stays that way all day.', n === 5 ? 'ok' : undefined); }

    // 1. Screen awake: ask the browser to hold the screen on now (a tap lets it), or say how to set the tablet itself.
    // Asks for the screen hold and shows the result; the tablet's own timeout is still the first thing to set.
    function checkAwake() {
      const boardState = SB.floor && SB.floor.wakeLock ? SB.floor.wakeLock() : 'unknown';
      // Tapping asks the browser again, then redraws this card.
      const again = h('button', { type: 'button', class: 'btn', dataset: { act: 'awake-check' }, onClick: () => tryWake(true) }, 'Check again');
      const how = h('p', { class: 'fs-sub' }, 'Also set the device itself so it never sleeps in service. iPad: Settings, Display & Brightness, Auto-Lock, Never. Android: Settings, Display, Screen timeout, the longest or Never. Plug it into power.');
      // Only the board's own hold keeps the screen on in service; this card's test hold ends when the sheet closes.
      if (boardState === 'on') cAwake.set(true, 'The board is holding the screen awake while it is open. Still set Auto-Lock to Never and keep the device plugged in.', again);
      else if (wakeNow === 'on') cAwake.set(true, 'This browser lets Smokebox hold the screen awake. The board asks for it each time it opens. Still set Auto-Lock to Never and keep the device plugged in.', again);
      else cAwake.set(false, wakeNow === 'unsupported' || boardState === 'unsupported' ? 'This browser cannot hold the screen awake by itself, so the screen may go to sleep.' : 'The screen may go to sleep.', how, again);
      paintSummary();
    }
    // Requests the screen hold, remembers the answer, and redraws the card.
    function tryWake(redraw) {
      try {
        if (!g.navigator || !g.navigator.wakeLock) { wakeNow = 'unsupported'; checkAwake(); return; }
        g.navigator.wakeLock.request('screen').then((s) => { sentinel = s; wakeNow = 'on'; if (redraw) checkAwake(); else checkAwake(); }, () => { wakeNow = 'refused'; checkAwake(); });
      } catch (e) { wakeNow = 'refused'; checkAwake(); }
    }

    // 2. Sound: a real beep, then the person says whether they heard it.
    // Plays the beep and asks if it was heard; the answer sets the tick.
    function checkSound() {
      const test = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'sound-test' }, onClick: () => { played = playBeep(); if (SB.floor && SB.floor.setSound && played) { /* the board's own sound stays as the owner set it */ } heard = null; checkSound(); } }, ico('volume', 20), h('span', null, played ? 'Play it again' : 'Test the sound'));
      if (heard === true) { cSound.set(true, 'You heard the beep. Warnings on the board use the same speaker.', test); }
      else if (heard === false) { cSound.set(false, 'You did not hear it. Turn the volume up, check the silent or mute switch (iPad: the side switch or Control Center), and try a cheap Bluetooth speaker. Then tap Play it again.', test); }
      else if (played) {
        cSound.set(null, 'Did you hear a short beep?', test,
          // Both answers: yes ticks the check, no says what to try.
          h('div', { class: 'fs-row' }, h('button', { type: 'button', class: 'btn', dataset: { act: 'sound-yes' }, onClick: () => { heard = true; if (SB.floor && SB.floor.sound && !SB.floor.sound() && SB.floor.setSound) SB.floor.setSound(true); checkSound(); checkVol(); } }, 'Yes, I heard it'), h('button', { type: 'button', class: 'btn', dataset: { act: 'sound-no' }, onClick: () => { heard = false; checkSound(); checkVol(); } }, 'No')));
      } else cSound.set(null, 'Browsers only allow sound after a tap, so test it here. Turn the volume up first.', test);
      paintSummary();
    }
    // 3. Volume: it cannot be read, so the person is asked a second, separate question once the beep was heard.
    // Shows the volume question: ticked only when the person says the beep carries to the pit or the line over the fans.
    function checkVol() {
      const line = 'Aim for a beep you can hear from the pit or the line over the fans. A small built-in speaker is easy to miss in a loud kitchen: a cheap Bluetooth speaker near the cutting board helps.';
      if (heard !== true) { loud = null; cVol.set(heard === false ? false : null, (heard === false ? '' : 'Test the sound above first. ') + line); paintSummary(); return; }
      if (loud === true) cVol.set(true, 'You said it carries over the kitchen noise. ' + line);
      else if (loud === false) cVol.set(false, 'Turn the volume up or add a speaker, then play the beep again. ' + line);
      else {
        cVol.set(null, 'Play the beep again from where the cooks stand, with the fans on. Could you hear it there?',
          // Two answers: yes ticks the volume check, no says what to try.
          h('div', { class: 'fs-row' }, h('button', { type: 'button', class: 'btn', dataset: { act: 'vol-yes' }, onClick: () => { loud = true; checkVol(); } }, 'Yes, loud enough'),
            h('button', { type: 'button', class: 'btn', dataset: { act: 'vol-no' }, onClick: () => { loud = false; checkVol(); } }, 'No, too quiet')));
      }
      paintSummary();
    }
    // 4. Home screen: the page can tell whether it was opened as an installed app.
    // Ticked when opened from the home screen; otherwise how to add it on iPad and Android. No promises about what it does for storage.
    function checkInstalled() {
      if (isInstalled()) cInst.set(true, 'Smokebox is running as an installed app.');
      else cInst.set(false, 'You are in the browser. iPad (Safari): tap Share, then Add to Home Screen. Android (Chrome): open the menu, then Install app or Add to Home screen. Then open Smokebox from that icon. An installed app opens without the browser bars; Smokebox cannot promise it keeps your data safe, so keep taking backups.');
      paintSummary();
    }
    // 5. Full screen: ticked when installed or already full screen; otherwise a button where the browser allows it.
    // Shows whether the page fills the screen, with a button to ask for it where the browser allows.
    function checkFull() {
      const fs = !!(doc.fullscreenElement || doc.webkitFullscreenElement) || isInstalled();
      const can = !!(doc.documentElement && (doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen));
      // Tapping asks the browser to fill the screen, then redraws the card.
      const go = can ? h('button', { type: 'button', class: 'btn', dataset: { act: 'go-fullscreen' }, onClick: () => { try { const r = (doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen).call(doc.documentElement); Promise.resolve(r).then(() => setTimeout(checkFull, 300), () => setTimeout(checkFull, 300)); } catch (e) { checkFull(); } } }, 'Go full screen') : null;
      if (fs) cFull.set(true, 'The board fills the screen.');
      else cFull.set(false, can ? 'The browser bars are showing. Tap Go full screen, or install the app (above) so it opens without them.' : 'This browser cannot go full screen from here. On iPad add Smokebox to the Home Screen (above); it then opens full screen.', go);
      paintSummary();
    }
    root.append(h('p', { class: 'fs-sub' }, 'Five quick checks so the board keeps working on this device during service. Each one is checked when you tap it.'),
      cAwake.el, cSound.el, cVol.el, cInst.el, cFull.el, summary);
    checkAwake(); checkSound(); checkVol(); checkInstalled(); checkFull();
    tryWake(false);
    sheet.body.appendChild(root); keepInView(root);
    return sheet;
  }

  /* ---------- Pilot visit checklist ---------- */

  // The visit steps, in order: what to do, where in the app, and minutes allowed. Kept as plain data so the printed card and the doc match.
  const PILOT_STEPS = [
    { min: 3, what: 'Device checks', how: 'Settings, Device checks. Screen never sleeps, plugged in, sound test heard, added to the home screen, full screen.' },
    { min: 3, what: 'Put the menu in', how: 'Import their spreadsheet (Settings, Dishes and prices, More ways to add dishes) or add the first dishes by hand. Check the preview before saving.' },
    { min: 2, what: 'Tax, hours and PIN', how: 'Settings, Tax, hours and PIN. Set the manager PIN and write down the recovery code with the owner.' },
    { min: 2, what: 'Name stations and menu sections', how: 'Use their words. Hide stations they do not have (Change stations).' },
    { min: 1, what: 'Cook-ahead question', how: 'Ask whether they cook some dishes ahead. Answer Yes, No or Not sure; it can be changed later.' },
    { min: 2, what: 'One test ticket', how: 'New ticket, add two dishes, send it, then bump it. Watch that the right station sees it.' },
    { min: 1, what: 'Backup and who to call', how: 'Show where to save a backup (Back office, Menu, prices and shop, Data). Leave a phone number.' }
  ];
  // Adds up the minutes of all the visit steps.
  function pilotMinutes() { return PILOT_STEPS.reduce((n, s) => n + s.min, 0); }
  // Builds the printable visit card as plain HTML text, used for both the on-screen sheet and the print frame.
  function pilotHtml() {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return '<h1>Smokebox pilot visit</h1><p>About ' + pilotMinutes() + ' minutes.</p><ol>' +
      PILOT_STEPS.map((s) => '<li><strong>' + esc(s.what) + '</strong> (' + s.min + ' min)<br>' + esc(s.how) + '<br>Done: ____</li>').join('') + '</ol>';
  }
  // Opens the visit checklist as a card to read on screen, with a Print button.
  function openPilot() {
    const sheet = SB.ui.sheet({ title: 'Pilot visit checklist', side: 'right', width: 'min(720px, 96vw)', name: 'pilot' });
    const msg = h('p', { class: 'fs-sub', role: 'status' });
    const body = h('div', { class: 'dp pv' }, h('p', { class: 'fs-sub pv-total' }, 'About ' + pilotMinutes() + ' minutes in all. Check each step as you go.'),
      h('ol', { class: 'pv-list' }, ...PILOT_STEPS.map((s) => h('li', { class: 'fs-card pv-step' }, h('label', { class: 'dp-check-row' }, h('input', { type: 'checkbox' }), h('span', null, h('strong', null, s.what), ' (' + s.min + ' min)')), h('p', { class: 'fs-sub' }, s.how)))));
    // Prints the card through a hidden frame so the board is not printed with it.
    const print = h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'pilot-print' }, onClick: () => {
      try {
        const f = doc.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; doc.body.appendChild(f);
        f.contentDocument.open(); f.contentDocument.write('<!doctype html><title>Smokebox pilot visit</title><body style="font-family:sans-serif;padding:24px;line-height:1.4">' + pilotHtml() + '</body>'); f.contentDocument.close();
        f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000);
      } catch (e) { tell(msg, 'This browser could not print. Use the screen as the card.', 'bad'); }
    } }, ico('receipt', 20), h('span', null, 'Print this card'));
    sheet.body.append(body, h('div', { class: 'fs-row' }, print), msg);
    return sheet;
  }

  /* ---------- the Tax, hours and PIN sheet ---------- */

  // Opens "Tax, hours and PIN": the shop settings that used to be steps of a wizard. Each saves on its own button.
  function openShop() {
    const sheet = SB.ui.sheet({ title: 'Tax, hours and PIN', side: 'right', width: 'min(640px, 96vw)', name: 'shop' });
    const set = SB.store.getState().settings;
    const list = h('div', { class: 'setup-list' });
    // Adds one section with a title, plain words, controls and a status line; returns the status line.
    function section(title, words, ...controls) {
      const status = h('p', { class: 'fs-sub', role: 'status' });
      list.appendChild(h('section', { class: 'fs-section' }, h('h3', { class: 'fs-h' }, title), h('p', { class: 'fs-sub' }, words), ...controls, status));
      return status;
    }
    const tax = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: String(set.service.taxRatePct || 0), 'aria-label': 'Sales tax percent' });
    const taxSt = section('Sales tax', 'The prices you type for dishes are before tax. Smokebox adds this percent to the bill when it is paid. Type 0 if you do not charge tax.', h('label', { class: 'fs-row' }, h('span', null, 'Percent'), tax),
      // Checks the tax box and saves the rate, or says what is wrong with it.
      h('button', { type: 'button', class: 'btn', onClick: () => {
        const v = readNum(tax);
        if (v == null || v < 0 || v > 20) { tell(taxSt, 'Type a number from 0 to 20.'); return; }
        const r = send('updateSettings', { patch: { service: { taxRatePct: v } } });
        tell(taxSt, r.ok ? 'Saved. Orders add ' + v + '% sales tax.' : r.report === 'nothingToDo' ? 'Already set.' : r.words);
      } }, 'Save tax'));
    // A list of whole hours with plain labels such as "11 am" and "1 am (next day)".
    const hourOpts = (from, to, sel) => { const out = []; for (let x = from; x <= to; x++) out.push(h('option', { value: String(x), selected: x === sel }, U.fmtHour(x) + (x >= 24 ? ' (next day)' : ''))); return out; };
    const openSel = h('select', { class: 'select', 'aria-label': 'Opens at' }, hourOpts(0, 23, set.service.openHour));
    const closeSel = h('select', { class: 'select', 'aria-label': 'Closes at' }, hourOpts(1, 30, set.service.closeHour));
    const hoursSt = section('Opening hours', 'Warnings, and the back office charts of when dishes sold out, use these. The starting hours are only a guess: set your own.', h('label', { class: 'fs-row' }, h('span', null, 'Opens at'), openSel), h('label', { class: 'fs-row' }, h('span', null, 'Closes at'), closeSel),
      // Saves both hours, or says closing has to come after opening.
      h('button', { type: 'button', class: 'btn', onClick: () => {
        const o = Number(openSel.value), c = Number(closeSel.value);
        if (o >= c) { tell(hoursSt, 'Closing has to be after opening.'); return; }
        const r = send('updateSettings', { patch: { service: { openHour: o, closeHour: c } } });
        tell(hoursSt, r.ok ? 'Saved. Open ' + U.fmtHour(o) + ' to ' + U.fmtHour(c) + '.' : r.report === 'nothingToDo' ? 'Already set.' : r.words);
      } }, 'Save hours'));
    const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'off', 'aria-label': 'Manager PIN, 4 digits' });
    const pinSt = section('Manager PIN (optional)', 'A PIN keeps the back office for managers only. It stops casual taps, not a determined person. Skip it if you do not want one.', h('label', { class: 'fs-row' }, h('span', null, '4 digits'), pin),
      // Saves the four-digit PIN, or asks for exactly four digits.
      h('button', { type: 'button', class: 'btn', onClick: async () => {
        const v = pin.value.trim();
        if (!/^\d{4}$/.test(v)) { tell(pinSt, 'Use exactly 4 digits.'); return; }
        // With a PIN already set, the current PIN must be entered first, so a cook cannot take over the back office.
        const hadPin = !!(SB.shell && SB.shell.hasPin && SB.shell.hasPin());
        if (hadPin && !(await SB.shell.requirePin())) { tell(pinSt, 'The PIN was not changed. The current PIN is needed to change it.', 'bad'); return; }
        const r = SB.shell && SB.shell.setPin ? await SB.shell.setPin(v, { verified: true }) : { ok: false };
        tell(pinSt, r.ok ? 'PIN set. The back office will ask for it.' : 'The PIN could not be saved.');
        if (r.ok) { pin.value = ''; await showRecoveryCode({ verified: true }); }
      } }, 'Set PIN'),
      // For a PIN set before recovery codes existed: makes the code now.
      SB.shell && SB.shell.hasPin && SB.shell.hasPin() && SB.store.hasRecoveryCode && !SB.store.hasRecoveryCode() ? h('button', { type: 'button', class: 'btn', dataset: { act: 'make-recovery' }, onClick: () => showRecoveryCode() }, 'Make a recovery code') : null);
    // Cook-ahead: one yes or no, kept in the real setting (settings.modules.cookAhead). A saved kitchen from before this
    // setting existed counts as Yes, so nothing disappears from it.
    const on0 = SB.engine && SB.engine.moduleOn ? SB.engine.moduleOn(SB.store.getState(), 'cookAhead') : false;
    const cook = SB.ui.segmented({ label: 'Do you cook food ahead and hold it warm or cold?', value: on0 ? 'yes' : 'no', options: [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }],
      // Saves the answer and says what appears or goes away; puts the old answer back if the save fails.
      onChange: (v) => {
        const r = send('updateSettings', { patch: { modules: { cookAhead: v === 'yes' } } });
        if (!r.ok && r.report !== 'nothingToDo') { cook.setValue(v === 'yes' ? 'no' : 'yes'); tell(cookSt, r.words); return; }
        tell(cookSt, v === 'yes' ? 'On. The Hold cabinet, cooked-batch times and their warnings are available. Change this any time here.' : 'Off. Batch tracking stays out of the way. Change this any time here.');
      } });
    const cookSt = section('Cooking ahead', 'Some places cook a big batch in the morning and serve from it all day, or keep cold sides in a cooler. If you do, Smokebox can track those batches and warn you before they run out of time. Most new places start with No.', cook);
    sheet.body.appendChild(list); keepInView(list);
    return sheet;
  }

  // Wraps SB.sheets.open so New ticket with no dishes on the menu opens "Dishes and prices" instead of an empty screen.
  function guardOrder() {
    const real = SB.sheets.open;
    // The same open as before, except New ticket with no dishes sends the owner to add one first.
    SB.sheets.open = function (name, opts) {
      if (name === 'order' && noDishes() && SB.store && SB.store.getState) return real.call(SB.sheets, 'dishes');
      return real.call(SB.sheets, name, opts);
    };
  }
  guardOrder();

  SB.sheets.register('setup', openSetup);
  SB.sheets.register('dishes', openDishes);
  SB.sheets.register('shop', openShop);
  SB.sheets.register('ready', openReady);
  SB.sheets.register('pilot', openPilot);
  // The visit checklist is for an installer, not the owner: no menu shows it. It opens by name (SB.sheets.open('pilot'))
  // or by address, with ?pilot after the file name (smokebox.html?pilot), once the board is up.
  function openPilotFromAddress() {
    try { if (!/[?&]pilot(=|&|$)/.test(g.location.search || '')) return; } catch (e) { return; }
    let tries = 0;
    // Waits for the board to finish starting (up to about 10 seconds), then opens the checklist.
    const wait = () => { if (SB.booted) SB.sheets.open('pilot'); else if (++tries < 50) setTimeout(wait, 200); };
    setTimeout(wait, 200);
  }
  openPilotFromAddress();
  SB.sheets.register('serve', openServe);
  SB.sheets.register('startover', openStartOver);
  SB.sheets.register('closemonth', openCloseMonth);
  SB.sheets.register('menuimport', openImport);
  SB.sheets.register('cookahead', openCookAhead);
  SB.sheets.register('wizard', openDishes); // the old name, kept so older links still open the right sheet
  // dishCount: how many dishes can be ordered. done: setup counts as finished once there is one. noDishes: first run.
  SB.setup = { openCloseMonth, showRecoveryCode, leftoversCard, tryDemo, demoIntro, hiddenStations: () => U.storage.get(KEY_HIDDEN, []), dishCount: () => activeDishes().length, done: () => activeDishes().length > 0, noDishes, wizardDone: () => activeDishes().length > 0 };
})(typeof globalThis !== 'undefined' ? globalThis : window);
