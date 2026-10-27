// Journey 13: the "Show me how it works" walkthrough (SB.tour). A first-time user taps through one real ticket; the caption follows what
// they actually do. Checks the eight steps with real clicks, Skip and Escape cleanup, doing things out of order, pausing for sheets and the
// office, and the card never covering what it points at (laptop, phone, Large text).
import { clearBoard as clearBoardBlank, seedStandard, wait, settle, openKey, closeSheets, tapFlame, waitOffice, officeOpen } from './_lib.mjs';

const LAST = 8;
const slipOf = (page, id) => page.locator('.fl-slip[data-ticket="' + id + '"]');
const rowBtn = (page, menu) => page.locator('.fl-row[data-menu="' + menu + '"] button').first();
const card = (page) => page.locator('.tour-card');

// Empties the board but loads the sample kitchen (dishes and food in the cabinet), because the app now starts with no dishes and
// the walkthrough needs dishes to show.
async function clearBoard(page) {
  await page.evaluate(() => { SB.store.resetLive({ keepSettings: true, catalog: 'sample' }); SB.store.tick(); });
  await wait(250);
}
// The newest ticket on the board: the one the walkthrough just added.
const newestId = (page) => page.evaluate(() => { const l = SB.store.getState().tickets.slice().sort((a, b) => b.createdAt - a.createdAt); return l.length ? l[0].id : null; });
// The caption's step label, or '' when the card is not showing.
const stepLabel = (page) => page.evaluate(() => { const c = document.querySelector('.tour-card'); const s = document.querySelector('.tour-step'); return c && !c.hidden && s ? s.textContent : ''; });
// The caption sentence.
const sentence = (page) => page.evaluate(() => { const e = document.querySelector('.tour-text'); return e ? e.textContent : ''; });
// Waits for the label "Step n of 8"; true when it showed up in time.
async function reach(page, n, ms = 20000) {
  return page.waitForFunction((n) => { const c = document.querySelector('.tour-card'); const s = document.querySelector('.tour-step'); return !!c && !c.hidden && !!s && s.textContent === 'Step ' + n + ' of 8'; }, n, { timeout: ms }).then(() => true, () => false);
}
// The clock speed, the ring count, whether the card is on the page and what has focus.
const snap = (page) => page.evaluate(() => ({
  speed: SB.store.speed(), rings: document.querySelectorAll('.tour-ring').length, cards: document.querySelectorAll('.tour-card').length,
  active: SB.tour.active(), focus: document.activeElement ? document.activeElement.id : '',
}));
// Where the card sits against the viewport and against everything the ring points at.
const geometry = (page, id) => page.evaluate((id) => {
  const c = document.querySelector('.tour-card');
  if (!c || c.hidden) return null;
  const cr = c.getBoundingClientRect();
  const headEl = document.querySelector('.fl-head');
  const headBottom = headEl ? headEl.getBoundingClientRect().bottom : 0;
  const lift = parseFloat(document.documentElement.style.getPropertyValue('--fl-lift')) || 0;
  const targets = Array.from(document.querySelectorAll('.tour-ring')).map((e) => {
    const r = e.getBoundingClientRect();
    return {
      what: (e.dataset.menu || e.className.split(' ')[0]), top: Math.round(r.top), bottom: Math.round(r.bottom),
      covered: cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top,
      seen: r.top >= headBottom - 1 && r.bottom <= innerHeight - lift + 1 && r.height > 0,
    };
  });
  const bumpCovered = Array.from(document.querySelectorAll(id ? '.fl-slip[data-ticket="' + id + '"] .fl-bump' : '.fl-bump')).some((e) => { const r = e.getBoundingClientRect(); return cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top; });
  return { bumpCovered, dock: c.dataset.dock, band: [Math.round(headBottom), Math.round(innerHeight - lift)], inside: cr.left >= 0 && cr.right <= innerWidth && cr.top >= 0 && cr.bottom <= innerHeight, top: Math.round(cr.top), bottom: Math.round(cr.bottom), w: Math.round(cr.width), targets };
}, id);
// A step passes the layout check when the card is inside the screen and no ring is under it.
const layoutOk = (g) => !!g && g.inside && g.targets.every((x) => !x.covered);
// Moves a real ticket along without the clock: fire it, then start it (two-step) or finish it (one-step).
const drive = (page, id, menu, times) => page.evaluate(([id, menu, times]) => {
  const S = SB.store;
  const find = () => S.getState().tickets.find((t) => t.id === id).items.find((i) => i.menuId === menu);
  let it = find();
  if (it.status === 'queued') S.dispatchEx('fireNow', { ticketId: id, itemId: it.id }, { source: 'ui' });
  for (let i = 0; i < times; i++) { it = find(); if (it.status !== 'done') S.dispatchEx('advanceItem', { ticketId: id, itemId: it.id }, { source: 'ui' }); }
  S.flushNotify();
  return find().status;
}, [id, menu, times]);

// Visits steps 1 to 8 of a fresh walkthrough by moving the real ticket along (no clock needed) and checks, at every step, that the
// card is on screen, covers none of the rings, and that every ringed element can be seen. On a wide screen it also checks the card
// leaves the Bump button alone. busy: start from the four standard tickets instead of an empty board.
async function walk(t, page, label, busy) {
  if (busy) { await clearBoard(page); await seedStandard(page, { clearFirst: false }); } else await clearBoard(page);
  await page.evaluate(() => SB.tour.start());
  await reach(page, 1, 3000);
  const id = await newestId(page);
  const wide = (await page.evaluate(() => innerWidth)) >= 900;
  // Checks the layout of the step that is showing now.
  const look = async (n) => {
    const ok = await reach(page, n, 14000);
    await settle(page, 350);
    const g = await geometry(page, id);
    t.check(label + ': step ' + n + ' card is on screen and does not cover what it points at', ok && layoutOk(g), { n, ok, g });
    // The ring is a class on the element itself, so an element with no box (the "On time" badge is hidden on purpose) draws nothing: skip those.
    if (g) t.check(label + ': step ' + n + ' every ringed element can be seen', g.targets.filter((x) => x.bottom - x.top > 0).every((x) => x.seen) && (n === 8 ? true : g.targets.some((x) => x.bottom - x.top > 0)), g); // step 8 is the closing caption and rings nothing
    if (g && wide) t.check(label + ': step ' + n + ' the card leaves the Bump button free', !g.bumpCovered, g);
    return g;
  };
  await look(1);
  await card(page).getByRole('button', { name: 'Next' }).click(); await look(2);
  await card(page).getByRole('button', { name: 'Next' }).click(); await look(3);
  await drive(page, id, 'hushpuppies', 1); await look(4);
  await card(page).getByRole('button', { name: 'Next' }).click(); await look(5);
  await drive(page, id, 'brisket_sand', 0); // fired early so step 5 shows the START wording on a real button
  await look(5);
  await drive(page, id, 'brisket_sand', 1); await look(6);
  await drive(page, id, 'hushpuppies', 1); await drive(page, id, 'brisket_sand', 1); await drive(page, id, 'tea', 1);
  await look(7);
  const bump = await slipOf(page, id).locator('.fl-bump').boundingBox();
  t.check(label + ': at step 7 the Bump button is tall enough to tap', !!bump && bump.height >= 44, bump);
  await t.shot(page, 'tour-7-' + label.replace(/\W+/g, '-'));
  await slipOf(page, id).locator('.fl-bump').click();
  await look(LAST);
  const btns = await card(page).locator('button:visible').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  t.check(label + ': every card button is at least 44 px tall', btns.length >= 3 && btns.every((x) => x >= 44), btns);
  await t.shot(page, 'tour-8-' + label.replace(/\W+/g, '-'));
  await card(page).getByRole('button', { name: 'Done' }).click();
  await settle(page, 200);
}

export default function (h) {
  h.test('13a-tour-full-loop', 'Walkthrough: all eight steps with real clicks, from start to Done', { owner: 'board', timeout: 120000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800, kitchen: true });
    if (!(await page.evaluate(() => !!(window.SB && SB.tour)))) t.skip('SB.tour is not built yet');
    await clearBoard(page);
    t.check('before it starts there is no caption card', (await snap(page)).cards === 0);
    const started = await page.evaluate(() => SB.tour.start());
    await settle(page, 300);
    t.check('SB.tour.start() returns true and the tour is active', started === true && (await snap(page)).active, started);
    const id = await newestId(page);
    t.check('it added exactly one ticket to the board', (await page.locator('.fl-grid > .fl-slip').count()) === 1, await page.locator('.fl-grid > .fl-slip').count());
    t.check('the All tab is showing so the whole ticket is visible', (await page.locator('.fl-seg [data-id="all"]').getAttribute('aria-selected')) === 'true');
    t.check('step 1 shows "Step 1 of 8"', (await stepLabel(page)) === 'Step 1 of 8', await stepLabel(page));
    t.check('step 1 says this is a ticket, one customer\'s order', /one customer's order/.test(await sentence(page)), await sentence(page));
    t.check('step 1 rings the ticket header', (await slipOf(page, id).locator('.slip-head.tour-ring').count()) === 1);
    t.check('step 1 has Skip and Next', (await card(page).getByRole('button', { name: 'Skip' }).isVisible()) && (await card(page).getByRole('button', { name: 'Next' }).isVisible()));
    t.check('step 1: the card does not cover what it points at', layoutOk(await geometry(page)), await geometry(page));
    await t.shot(page, 'tour-1-1280');

    await card(page).getByRole('button', { name: 'Next' }).click();
    t.check('Next goes to step 2, the clock', (await reach(page, 2, 3000)) && /counts up/.test(await sentence(page)), await sentence(page));
    t.check('step 2 rings the ticket clock (the On time badge is hidden until a ticket is late, so it is not ringed)', (await slipOf(page, id).locator('.slip-timer.tour-ring').count()) === 1 && (await slipOf(page, id).locator('.fl-bw.tour-ring').count()) === 0);
    t.check('step 2: the card does not cover the clock', layoutOk(await geometry(page)), await geometry(page));

    await card(page).getByRole('button', { name: 'Next' }).click();
    t.check('Next goes to step 3, the stations', (await reach(page, 3, 3000)) && /belongs to a station/.test(await sentence(page)), await sentence(page));
    t.check('step 3 rings the hush puppies row and asks for START', (await slipOf(page, id).locator('.fl-row[data-menu="hushpuppies"].tour-ring').count()) === 1 && /Tap Start/.test(await sentence(page)));
    t.check('step 3 has no Next: the person has something to tap', !(await card(page).getByRole('button', { name: 'Next' }).isVisible()));
    t.check('step 3: the card does not cover the hush puppies row', layoutOk(await geometry(page)), await geometry(page));
    await t.shot(page, 'tour-3-1280');

    // a real tap on the hush puppies, exactly what a cook does
    await rowBtn(page, 'hushpuppies').click();
    t.check('tapping START on the hush puppies moves to step 4', await reach(page, 4, 4000), await stepLabel(page));
    t.check('step 4 explains the orange countdown, Check it, and that Smokebox never marks done by itself', /countdown under the dish/.test(await sentence(page)) && /Check it/.test(await sentence(page)) && /never marks a dish done by itself/.test(await sentence(page)), await sentence(page));
    t.check('step 4: the card does not cover the cooking row', layoutOk(await geometry(page)), await geometry(page));
    t.check('the kitchen clock is still normal speed before step 5', (await snap(page)).speed === 1, (await snap(page)).speed);

    await card(page).getByRole('button', { name: 'Next' }).click();
    t.check('Next goes to step 5, the gray dishes', (await reach(page, 5, 3000)) && /gray on purpose/.test(await sentence(page)), await sentence(page));
    t.check('from step 5 the clock runs fast (x30)', (await snap(page)).speed === 30, (await snap(page)).speed);
    t.check('step 5 rings the brisket sandwich row', (await slipOf(page, id).locator('.fl-row[data-menu="brisket_sand"].tour-ring').count()) === 1);
    t.check('step 5: the card does not cover the brisket row', layoutOk(await geometry(page)), await geometry(page));
    await t.shot(page, 'tour-5-1280');

    // wait for the countdown to run out; step 5 then changes its words by itself once the sandwich is no longer gray
    t.check('step 5 first explains the gray dish and offers Next', /Start now/.test(await sentence(page)) && (await card(page).getByRole('button', { name: 'Next' }).isVisible()), await sentence(page));
    t.check('step 5 changes to the START wording when the brisket sandwich is ready', await page.waitForFunction(() => /Tap Start on Brisket sandwich/.test((document.querySelector('.tour-say') || {}).textContent || ''), null, { timeout: 20000 }).then(() => true, () => false), await sentence(page));
    t.check('step 5 then has no Next button', !(await card(page).getByRole('button', { name: 'Next' }).isVisible()));
    t.check('step 5: the sandwich row is a real button now', (await slipOf(page, id).locator('.fl-row[data-menu="brisket_sand"][data-kind="btn"]').count()) === 1);
    t.check('step 5: the card does not cover the brisket row', layoutOk(await geometry(page)), await geometry(page));
    await rowBtn(page, 'brisket_sand').click();
    await settle(page, 300);
    t.check('tapping START on the sandwich moves to step 6', await reach(page, 6, 4000), await stepLabel(page));
    t.check('step 6 says the person is the one who says a dish is done', /You are the one who says it is done/.test(await sentence(page)), await sentence(page));
    t.check('step 6: the card does not cover the cooking rows', layoutOk(await geometry(page)), await geometry(page));
    await t.shot(page, 'tour-6-1280');

    // finish the hush puppies and the sandwich by tapping their orange timers, then the tea when it is ready
    await rowBtn(page, 'hushpuppies').click();
    await wait(600); // the board ignores a second tap on the same dish inside 450 ms (a gloved double tap)
    await rowBtn(page, 'brisket_sand').click();
    await settle(page, 400);
    t.check('both cooked dishes show Done', (await slipOf(page, id).locator('.fl-row[data-state="done"]').count()) === 2, await slipOf(page, id).locator('.fl-row[data-state="done"]').count());
    const teaReady = await page.waitForFunction((id) => { const r = document.querySelector('.fl-slip[data-ticket="' + id + '"] .fl-row[data-menu="tea"]'); return !!r && r.dataset.kind === 'btn'; }, id, { timeout: 20000 }).then(() => true, () => false);
    t.check('the sweet tea becomes ready to tap by itself', teaReady);
    t.check('step 6 still waits for the tea', (await stepLabel(page)) === 'Step 6 of 8' && /Sweet tea/.test(await sentence(page)), await sentence(page));
    await rowBtn(page, 'tea').click();
    t.check('finishing the last dish moves to step 7', await reach(page, 7, 4000), await stepLabel(page));
    t.check('step 7 rings the Bump button and says the clock stops', (await slipOf(page, id).locator('.fl-bump.tour-ring').count()) === 1 && /clock stops/.test(await sentence(page)), await sentence(page));
    t.check('step 7: the card does not cover the Bump button', layoutOk(await geometry(page)), await geometry(page));
    await t.shot(page, 'tour-7-1280');
    await slipOf(page, id).locator('.fl-bump').click();
    t.check('tapping Bump moves to step 8', await reach(page, LAST, 5000), await stepLabel(page));
    t.check('step 8 says that is the whole loop and points at the back office', /whole loop/.test(await sentence(page)) && /tap Back office/.test(await sentence(page)), await sentence(page));
    const last = await Promise.all(['Add my own ticket', 'Start the demo', 'Done'].map((n) => card(page).getByRole('button', { name: n }).isVisible()));
    t.check('step 8 offers Add my own ticket, Start the demo and Done', last.every(Boolean), last);
    t.check('step 8 has no Skip: Done ends it', !(await card(page).getByRole('button', { name: 'Skip' }).isVisible()));
    t.check('the clock is back to normal speed by step 8', (await snap(page)).speed === 1, (await snap(page)).speed);
    t.check('step 8 has no ring left on the board', (await snap(page)).rings === 0, (await snap(page)).rings);
    await t.shot(page, 'tour-8-1280');
    await card(page).getByRole('button', { name: 'Done' }).click();
    await settle(page, 300);
    const end = await snap(page);
    t.check('Done removes the card, the rings and the tour', end.cards === 0 && end.rings === 0 && !end.active, end);
    t.check('focus goes back to the board', end.focus === 'fl-board', end.focus);
    const left = await page.evaluate((tid) => ({ demo: SB.store.isDemo(), there: SB.store.getState().tickets.some((x) => x.id === tid) }), id);
    t.check('the demo keeps the walkthrough ticket (a real kitchen removes it, see 13g)', left.demo && left.there, left);
    await t.clean(page, 'full walkthrough');
  });

  h.test('13b-tour-skip-escape', 'Walkthrough: Skip and Escape stop it cleanly and put the clock back; restart begins again', { owner: 'board', timeout: 60000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800, kitchen: true });
    if (!(await page.evaluate(() => !!(window.SB && SB.tour)))) t.skip('SB.tour is not built yet');
    await clearBoard(page);
    await page.evaluate(() => SB.tour.start());
    await reach(page, 1, 3000);
    for (const n of [2, 3]) { await card(page).getByRole('button', { name: 'Next' }).click().catch(() => {}); await reach(page, n, 3000); }
    // step 3 has no Next; start the hush puppies for real to reach 4, then Next to 5 (the clock goes x30)
    await rowBtn(page, 'hushpuppies').click();
    await reach(page, 4, 4000);
    await card(page).getByRole('button', { name: 'Next' }).click();
    t.check('at step 5 the clock runs x30', (await reach(page, 5, 3000)) && (await snap(page)).speed === 30, await snap(page));
    await card(page).getByRole('button', { name: 'Skip' }).click();
    await settle(page, 300);
    let s = await snap(page);
    t.check('Skip removes the card and the rings and ends the tour', s.cards === 0 && s.rings === 0 && !s.active, s);
    t.check('Skip puts the clock back to x1', s.speed === 1, s.speed);
    t.check('Skip returns focus to the board', s.focus === 'fl-board', s.focus);
    t.check('the demo ticket stays on the board', (await page.locator('.fl-grid > .fl-slip').count()) === 1);

    // restart: the old ticket stays, a new one is added, and there is still only one card
    await page.evaluate(() => SB.tour.start());
    t.check('starting again begins at step 1 with one card', (await reach(page, 1, 3000)) && (await snap(page)).cards === 1, await snap(page));
    await settle(page, 400);
    t.check('starting again adds a second ticket and leaves the first one', (await page.locator('.fl-grid > .fl-slip').count()) === 2, await page.locator('.fl-grid > .fl-slip').count());
    await page.evaluate(() => SB.tour.start());
    await settle(page, 300);
    t.check('starting while one runs does not stack cards', (await snap(page)).cards === 1 && (await stepLabel(page)) === 'Step 1 of 8', await snap(page));

    // Escape on the board ends it; at step 5 so the clock must come back too
    await page.evaluate(() => { document.querySelector('#fl-board').focus(); });
    await page.keyboard.press('Escape');
    await settle(page, 300);
    s = await snap(page);
    t.check('Escape on the board ends the tour', s.cards === 0 && !s.active && s.speed === 1, s);

    // the person changes the clock during the tour: Skip must not undo their choice
    await page.evaluate(() => SB.tour.start());
    await reach(page, 1, 3000);
    await page.evaluate(() => { SB.store.setSpeed(30); }); // pretend step 5 set it
    await page.evaluate(() => SB.store.setSpeed(15));
    await card(page).getByRole('button', { name: 'Skip' }).click();
    await settle(page, 200);
    t.check('Skip leaves a clock speed the person chose themselves', (await snap(page)).speed === 15, (await snap(page)).speed);
    await page.evaluate(() => SB.store.setSpeed(1));
    await t.clean(page, 'skip and escape');
  });

  h.test('13c-tour-out-of-order', 'Walkthrough: doing things in another order never strands the caption', { owner: 'board', timeout: 60000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800, kitchen: true });
    if (!(await page.evaluate(() => !!(window.SB && SB.tour)))) t.skip('SB.tour is not built yet');
    await clearBoard(page);
    await page.evaluate(() => SB.tour.start());
    await reach(page, 1, 3000);
    const id = await newestId(page);

    // brisket first (Start now on the gray row goes straight to cooking), then the hush puppies: the caption lands on step 6
    await rowBtn(page, 'brisket_sand').click(); // Start now
    await settle(page, 400);
    const bsState = await slipOf(page, id).locator('.fl-row[data-menu="brisket_sand"]').getAttribute('data-state');
    t.check('Start now on the gray sandwich row starts it cooking', bsState === 'cooking', bsState);
    t.check('starting the sandwich before the hush puppies does not jump ahead', (await stepLabel(page)) === 'Step 1 of 8', await stepLabel(page));
    await rowBtn(page, 'hushpuppies').click();
    t.check('starting the hush puppies afterwards lands on step 6, the "tap done" step', await reach(page, 6, 4000), await stepLabel(page));
    t.check('step 6 asks for the hush puppies and the sandwich to be finished', /Hush puppies and Brisket sandwich/.test(await sentence(page)), await sentence(page));

    // finishing everything without the tour's help goes to step 7 even though the tea is still waiting
    await drive(page, id, 'hushpuppies', 1);
    await drive(page, id, 'brisket_sand', 1);
    await drive(page, id, 'tea', 1);
    t.check('finishing every dish by any route lands on step 7', await reach(page, 7, 5000), await stepLabel(page));

    // an early Bump on a fresh tour ticket: the confirm appears, "Bump anyway" jumps to step 8
    await page.evaluate(() => SB.tour.start());
    await reach(page, 1, 3000);
    const id2 = await newestId(page);
    t.check('the second tour ticket is a different ticket', id2 && id2 !== id, { id, id2 });
    await slipOf(page, id2).locator('.fl-bump').click();
    const ad = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Bump anyway/ }));
    await ad.first().waitFor({ state: 'visible', timeout: 6000 });
    await settle(page, 500); // the walkthrough looks four times a second
    t.check('while the confirm is open the caption steps aside', (await stepLabel(page)) === '' && (await snap(page)).rings === 0, await snap(page));
    await ad.first().getByRole('button', { name: 'Bump anyway' }).click();
    t.check('bumping early jumps to step 8', await reach(page, LAST, 5000), await stepLabel(page));
    await card(page).getByRole('button', { name: 'Done' }).click();
    await settle(page, 200);
    t.check('Done ends the tour', !(await snap(page)).active);
    await t.clean(page, 'out of order');
  });

  h.test('13d-tour-pauses', 'Walkthrough: the caption steps aside for a sheet or the office and comes back at the same step', { owner: 'board', timeout: 60000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800, kitchen: true });
    if (!(await page.evaluate(() => !!(window.SB && SB.tour)))) t.skip('SB.tour is not built yet');
    await clearBoard(page);
    await page.evaluate(() => SB.tour.start());
    await reach(page, 1, 3000);
    await card(page).getByRole('button', { name: 'Next' }).click();
    await reach(page, 2, 3000);

    await openKey(page, 'd', 'Demo and clock');
    await settle(page, 400);
    let s = await snap(page);
    t.check('with the Demo sheet open the caption is hidden and nothing is ringed', (await stepLabel(page)) === '' && s.rings === 0, s);
    t.check('the tour is still running underneath', s.active, s);
    await closeSheets(page);
    await settle(page, 500);
    t.check('Escape closed only the sheet: the tour is still running at step 2', (await snap(page)).active && (await reach(page, 2, 3000)), await stepLabel(page));
    t.check('the ring is back on the clock', (await page.locator('.slip-timer.tour-ring').count()) === 1);

    // the back office covers the board too
    await tapFlame(page, 5);
    await waitOffice(page);
    t.check('the office opened', await officeOpen(page));
    t.check('inside the office the caption is hidden', (await stepLabel(page)) === '', await stepLabel(page));
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 5000 }).catch(() => {});
    await settle(page, 800);
    t.check('back on the board the caption returns at step 2', (await snap(page)).active && (await reach(page, 2, 4000)), await stepLabel(page));

    // Escape on the board (no sheet open) ends the tour
    await page.evaluate(() => { const b = document.getElementById('fl-board'); if (b) b.focus(); });
    await page.keyboard.press('Escape');
    await settle(page, 300);
    t.check('Escape with no sheet open ends the tour', !(await snap(page)).active && (await snap(page)).cards === 0, await snap(page));
    await t.clean(page, 'pauses');
  });

  h.test('13e-tour-layouts', 'Walkthrough: the card stays on screen and off the ring on a phone and in Large text', { owner: 'board', timeout: 120000 }, async (t) => {
    const phone = await t.open({ w: 390, h: 844, touch: true, kitchen: true });
    if (!(await phone.evaluate(() => !!(window.SB && SB.tour)))) t.skip('SB.tour is not built yet');
    await walk(t, phone, 'phone 390', false);
    t.check('phone: the page never scrolls sideways', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await phone.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    await t.clean(phone, 'phone walkthrough');

    const big = await t.open({ w: 1280, h: 800, kitchen: true });
    await big.evaluate(() => SB.theme.setTextSize('large'));
    await settle(big, 400);
    await walk(t, big, 'large text 1280', false);
    const fs = await big.evaluate(() => { SB.tour.start(); const e = document.querySelector('.tour-text'); return parseFloat(getComputedStyle(e).fontSize); });
    t.check('Large text makes the caption sentence bigger (at least 20 px)', fs >= 20, fs);
    await big.evaluate(() => SB.tour.stop());
    await t.clean(big, 'large text walkthrough');
  });

  h.test('13g-tour-real-kitchen', 'Walkthrough in a real kitchen: stopping it removes its ticket, so it never reaches the reports', { owner: 'board', timeout: 60000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800 });
    if (!(await page.evaluate(() => !!(window.SB && SB.tour)))) t.skip('SB.tour is not built yet');
    await page.evaluate(() => SB.store.dispatch('addMenuItem', { name: 'Brisket plate', zone: 'pit', cat: 'meat', price: 12, prepSec: 60, track: 'one', prepGuess: false }));
    t.check('this is a real kitchen', !(await page.evaluate(() => SB.store.isDemo())));
    t.check('the walkthrough starts', await page.evaluate(() => SB.tour.start()));
    const id = await newestId(page);
    t.check('its ticket is on the board', !!id && (await slipOf(page, id).count()) === 1, id);
    await page.evaluate(() => SB.tour.stop());
    await settle(page, 200);
    const end = await page.evaluate((tid) => ({ there: SB.store.getState().tickets.some((x) => x.id === tid), orders: SB.store.getState().orders.length, leftovers: SB.store.demoLeftovers().tickets }), id);
    t.check('the ticket and its order are gone and nothing is left for the clean-up offer', !end.there && end.orders === 0 && end.leftovers === 0, end);
    await t.clean(page, 'real-kitchen walkthrough');
  });

  h.test('13f-tour-busy-board', 'Walkthrough: with other tickets on the board the new ticket is found and the card sits beside it', { owner: 'board', timeout: 120000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800, kitchen: true });
    if (!(await page.evaluate(() => !!(window.SB && SB.tour)))) t.skip('SB.tour is not built yet');
    await walk(t, page, 'busy board 1280', true);
    await page.evaluate(() => SB.tour.start());
    await reach(page, 1, 3000);
    const where = await page.evaluate(() => {
      const c = document.querySelector('.tour-card').getBoundingClientRect(), ring = document.querySelector('.tour-ring');
      const sl = ring && ring.closest('.fl-slip');
      const r = sl ? sl.getBoundingClientRect() : null;
      return { dock: document.querySelector('.tour-card').dataset.dock, slipHit: !!r && c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top, slips: document.querySelectorAll('.fl-grid > .fl-slip').length };
    });
    t.check('the board is busy: four standard tickets plus the walkthrough ticket', where.slips >= 4, where);
    t.check('the card does not cover any part of the ticket it is about', where.slipHit === false, where);
    await page.evaluate(() => SB.tour.stop());
    await t.clean(page, 'busy board walkthrough');
  });
}
