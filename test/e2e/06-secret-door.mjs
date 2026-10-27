// Journey 6: the secret door. Five taps on the flame, Ctrl+Shift+O, deep links, every way out, the PIN, reduced motion.
import { tapFlame, officeOpen, waitOffice, wait, settle, head, closeSheets, OFFICE_PAGES } from './_lib.mjs';

const flicker = (page) => page.evaluate(() => {
  const mark = document.querySelector('.fl-head [data-brand] .brand-mark') || document.querySelector('.fl-head .brand-mark');
  window.__flick = 0;
  if (!mark) return false;
  new MutationObserver((ms) => { for (const m of ms) if (m.attributeName === 'class' && mark.classList.contains('is-flicker')) window.__flick++; }).observe(mark, { attributes: true, attributeFilter: ['class'] });
  return true;
});
const hashOf = (page) => page.evaluate(() => location.hash);
const keypad = (page) => page.getByRole('dialog', { name: 'Manager PIN' });
async function typePin(page, pin) { const kp = keypad(page); for (const c of pin) await kp.getByRole('button', { name: 'Digit ' + c, exact: true }).click(); await wait(350); await page.waitForFunction(() => { const k = document.querySelector('.sheet-root .keypad'); return !k || !/checking/i.test(k.innerText) && !k.hasAttribute('data-busy'); }, null, { timeout: 5000 }).catch(() => {}); await wait(700); }
const pinMsg = (page) => keypad(page).locator('.pin-msg').innerText();

/** Open the Data page and set a 4-digit PIN through the form, as a manager would. */
async function setPinViaData(page, pin) {
  await page.evaluate(() => { location.hash = '#/office/data'; });
  await waitOffice(page);
  const panel = page.locator('#od-pin');
  await panel.scrollIntoViewIfNeeded().catch(() => {});
  await panel.getByRole('button', { name: 'Set a PIN' }).click();
  const form = panel.getByRole('form', { name: 'Set a PIN' });
  await form.getByLabel('New PIN', { exact: true }).fill(pin);
  await form.getByLabel('Type the new PIN again').fill(pin);
  await form.getByRole('button', { name: 'Set PIN' }).click();
  await settle(page, 600);
}

export default function (h) {
  h.test('06a-gesture-and-exits', 'Secret door: 5 fast taps open, 4 or 5 slow taps do not, Ctrl+Shift+O, deep link, three ways out', { owner: 'lead', timeout: 80000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800 });
    await flicker(page);
    await tapFlame(page, 4, 60);
    await wait(3000);
    t.check('4 quick taps do not open the office', !(await officeOpen(page)), await hashOf(page));
    t.check('taps 3 and 4 flicker the flame (the only hint)', (await page.evaluate(() => window.__flick)) >= 1, await page.evaluate(() => window.__flick));
    await wait(1500); // let the tap window drain
    // 5 taps spread over 2.8 s: the first one has expired when the fifth lands
    await tapFlame(page, 5, 700);
    await wait(800);
    t.check('5 slow taps (2.8 s apart in total) do not open the office', !(await officeOpen(page)), await hashOf(page));
    await wait(3000);
    await tapFlame(page, 5, 70);
    await waitOffice(page);
    t.check('5 quick taps within 2.5 s open the office', await officeOpen(page), await hashOf(page));
    t.check('the address says #/office (Pace is the office home, #/office/pace also works) and the page is Speed', /^#\/office(\/pace)?$/.test(await hashOf(page)) && /^Speed$/.test(await page.locator('#sb-office .of-title').first().innerText().catch(() => '')), await hashOf(page));
    const frame = await page.evaluate(() => ({ nav: !!document.querySelector('#sb-office nav[aria-label]'), main: !!document.querySelector('#sb-office main'), back: !!document.querySelector('#sb-office [data-back-to-line]'), floorInert: document.getElementById('sb-floor') && (document.getElementById('sb-floor').inert || document.getElementById('sb-floor').hasAttribute('inert') || document.getElementById('sb-floor').closest('[inert]') != null) }));
    t.check('the office has a nav landmark, a main landmark and a Back to the board button', frame.nav && frame.main && frame.back, frame);
    t.check('the floor underneath is inert (keys and taps cannot reach it)', !!frame.floorInert, frame);
    await t.shot(page, 'door-open');

    // exit 1: Back to the board
    await page.locator('#sb-office [data-back-to-line]').first().click();
    await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 5000 }).catch(() => {});
    await wait(900);
    t.check('Back to the board leaves the office and returns the board address', !(await officeOpen(page)) && !/office/.test(await hashOf(page)), await hashOf(page));
    t.check('the board is visible and usable again (New ticket reachable)', await head(page).getByRole('button', { name: 'New ticket' }).isVisible());
    const focusOn = await page.evaluate(() => document.activeElement && (document.activeElement.matches('[data-brand]') || !!document.activeElement.closest('[data-brand]')));
    t.check('focus goes back to the flame after leaving', focusOn, await page.evaluate(() => document.activeElement && document.activeElement.className));

    // way in 2: Ctrl+Shift+O; way out 2: Esc
    await page.keyboard.press('Control+Shift+O');
    await waitOffice(page);
    t.check('Ctrl+Shift+O opens the office', await officeOpen(page), await hashOf(page));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 5000 }).catch(() => {});
    await wait(900);
    t.check('Esc leaves the office', !(await officeOpen(page)), await hashOf(page));
    // way in 3 and out 3: Cmd+Shift+O and the browser Back button
    await page.keyboard.press('Meta+Shift+O');
    await waitOffice(page);
    t.check('Cmd+Shift+O (Meta) also opens the office', await officeOpen(page), await hashOf(page));
    await page.goBack();
    await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 5000 }).catch(() => {});
    await wait(900);
    t.check('the browser Back button leaves the office', !(await officeOpen(page)), await hashOf(page));
    // Esc inside a sheet that is open inside the office must close the sheet only
    // the floor keys must not fire while the office is open
    await page.keyboard.press('Control+Shift+O');
    await waitOffice(page);
    await page.keyboard.press('n');
    await wait(400);
    t.check('the floor key N does nothing while the office is open', !(await page.evaluate(() => SB.sheets.isOpen('order'))));
    await page.keyboard.press('Escape');
    await wait(900);
    await t.clean(page, 'gesture and exits');

    // deep links
    const p2 = await t.open({ w: 1280, h: 800, hash: '#/office/pace' });
    await waitOffice(p2);
    t.check('a pasted #/office/pace link opens the office on Pace', await officeOpen(p2) && (await hashOf(p2)) === '#/office/pace', await hashOf(p2));
    await t.clean(p2, 'deep link');
    const p3 = await t.open({ w: 1280, h: 800, hash: '#/office/stations' });
    await waitOffice(p3);
    t.check('a pasted #/office/stations link opens that page', await officeOpen(p3) && /Stations/.test(await p3.locator('#sb-office .of-title').first().innerText().catch(() => '')), await hashOf(p3));
    // a bad section falls back instead of breaking
    await p3.evaluate(() => { location.hash = '#/office/nonsense'; });
    await wait(1200);
    const okFallback = await p3.evaluate(() => ({ office: SB.shell.inOffice(), hash: location.hash, title: (document.querySelector('#sb-office .of-title') || {}).textContent }));
    t.check('an unknown office section falls back to a real page or the floor (never a blank screen)', (okFallback.office && !!okFallback.title) || !okFallback.office, okFallback);
    await p3.evaluate(() => { location.hash = '#/s/nonsense'; });
    await wait(900);
    const floorBad = await p3.evaluate(() => ({ office: SB.shell.inOffice(), tabs: document.querySelectorAll('.fl-seg [role=tab]').length }));
    t.check('an unknown station link shows the board', !floorBad.office && floorBad.tabs === 7, floorBad);
  });

  h.test('06b-reduced-motion', 'Secret door with reduced motion: short cross-fade, no ember ring or smoke', { owner: 'lead', timeout: 40000 }, async (t) => {
    // document exists at init time, documentElement may not: observe the document itself. Records when ring and wisps appear and disappear.
    const watch = () => { window.__fx = { ring: 0, wisp: 0, clip: 0, ringAt: null, ringGone: null }; new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; const r = n.matches('.ember-ring') ? 1 : n.querySelectorAll('.ember-ring').length; const w = (n.matches('.wisp') ? 1 : 0) + n.querySelectorAll('.wisp').length; if (r) { window.__fx.ring += r; window.__fx.ringAt = window.__fx.ringAt || performance.now(); } window.__fx.wisp += w; } for (const n of m.removedNodes) { if (n.nodeType === 1 && (n.matches('.ember-ring') || n.querySelector('.ember-ring')) && window.__fx.ringAt && !window.__fx.ringGone) window.__fx.ringGone = performance.now(); } } }).observe(document, { childList: true, subtree: true }); };
    const reduced = await t.open({ w: 1280, h: 800, reducedMotion: 'reduce', init: watch });
    await tapFlame(reduced, 5, 70);
    const t0 = Date.now();
    await reduced.waitForFunction(() => SB.shell.inOffice() && document.querySelector('#sb-office .of-main'), null, { timeout: 5000 }).catch(() => {});
    await reduced.waitForFunction(() => { const o = document.getElementById('sb-office'); return o && !o.classList.contains('is-igniting') && !o.closest('.is-igniting'); }, null, { timeout: 5000 }).catch(() => {});
    const ms = Date.now() - t0;
    const fx = await reduced.evaluate(() => window.__fx);
    t.check('reduced motion: the office opens', await officeOpen(reduced));
    t.check('reduced motion: no ember ring and no smoke wisps are drawn', fx.ring === 0 && fx.wisp === 0, fx);
    t.note('reduced-motion open time', ms, 'ms');
    t.check('reduced motion: the office is ready in well under the 900 ms ignition (cross-fade about 150 ms)', ms < 700, ms + ' ms');
    await t.shot(reduced, 'door-reduced');
    await reduced.keyboard.press('Escape');
    await wait(700);
    t.check('reduced motion: Esc leaves', !(await officeOpen(reduced)));
    const normal = await t.open({ w: 1280, h: 800, init: watch });
    await tapFlame(normal, 5, 70);
    await waitOffice(normal);
    const fx2 = await normal.evaluate(() => window.__fx);
    t.check('normal motion: the ember ring is drawn', fx2.ring >= 1, fx2);
    t.check('normal motion: smoke wisps are drawn', fx2.wisp >= 1, fx2);
    t.note('normal motion: the ember ring stays in the page for', fx2.ringAt && fx2.ringGone ? Math.round(fx2.ringGone - fx2.ringAt) : 'not seen', 'ms (the ignition is meant to run about 720 ms)');
  });

  h.test('06c-pin', 'PIN: set in Data, gates the next entrance, wrong PIN refused, 5 wrong lock 30 s', { owner: 'officeC', timeout: 100000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800 });
    await page.keyboard.press('Control+Shift+O');
    await waitOffice(page);
    t.check('with no PIN the first entry has no keypad', await officeOpen(page) && !(await keypad(page).count()));
    await page.evaluate(() => { location.hash = '#/office/data'; });
    await waitOffice(page);
    const panel = page.locator('#od-pin');
    await panel.scrollIntoViewIfNeeded().catch(() => {});
    t.check('the PIN panel says no PIN is set and that anyone sees everything', /No PIN is set/.test(await panel.innerText()), (await panel.innerText()).slice(0, 200));
    t.check('the PIN panel says it keeps line cooks out and is not real security', /not real security/i.test(await panel.innerText()), (await panel.innerText()).slice(0, 200));
    await panel.getByRole('button', { name: 'Set a PIN' }).click();
    const form = panel.getByRole('form', { name: 'Set a PIN' });
    await form.getByLabel('New PIN', { exact: true }).fill('12');
    await form.getByLabel('Type the new PIN again').fill('12');
    await form.getByRole('button', { name: 'Set PIN' }).click();
    t.check('a 2-digit PIN is refused with "Use exactly 4 digits."', /Use exactly 4 digits/.test(await form.innerText()), await form.innerText());
    await form.getByLabel('New PIN', { exact: true }).fill('1234');
    await form.getByLabel('Type the new PIN again').fill('1235');
    await form.getByRole('button', { name: 'Set PIN' }).click();
    t.check('two different entries are refused', /do not match/.test(await form.innerText()), await form.innerText());
    await form.getByLabel('New PIN', { exact: true }).fill('abcd');
    t.check('letters cannot be typed into the PIN box', (await form.getByLabel('New PIN', { exact: true }).inputValue()) === '', await form.getByLabel('New PIN', { exact: true }).inputValue());
    await form.getByLabel('New PIN', { exact: true }).fill('1234');
    await form.getByLabel('Type the new PIN again').fill('1234');
    await form.getByRole('button', { name: 'Set PIN' }).click();
    await settle(page, 700);
    t.check('the PIN panel now says a PIN is set', /A PIN is set/.test(await panel.innerText()), (await panel.innerText()).slice(0, 200));
    const hashStored = await page.evaluate(() => SB.store.getState().settings.office.pinHash);
    t.check('only a hash is stored, never the digits', typeof hashStored === 'string' && !/1234/.test(hashStored) && hashStored.length > 20, hashStored);
    t.check('a toast confirms: the back office will ask next time', (await page.locator('.toast').allInnerTexts()).some((x) => /PIN set/.test(x)), await page.locator('.toast').allInnerTexts());
    // quick return inside the 2-minute grace is documented and not gated
    await page.locator('#sb-office [data-back-to-line]').first().click();
    await wait(1000);
    await page.keyboard.press('Control+Shift+O');
    await waitOffice(page);
    t.note('PIN grace: re-entry straight after leaving asks for the PIN?', (await keypad(page).count()) ? 'yes' : 'no (2-minute grace, as the Data page says)');
    await page.keyboard.press('Escape');
    await wait(900);

    // a fresh load has no grace: now the keypad gates every way in
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 10000 });
    await settle(page, 500);
    await tapFlame(page, 5, 70);
    await keypad(page).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    t.check('after a reload the 5 taps show the Manager PIN keypad', await keypad(page).isVisible().catch(() => false));
    t.check('the office is NOT open behind the keypad', !(await page.evaluate(() => document.querySelector('#sb-office .of-main') && !document.getElementById('sb-office').hidden)), await hashOf(page));
    const kpText = await keypad(page).innerText();
    t.check('the keypad says it keeps line cooks out and is not real security', /not real security/.test(kpText), kpText.slice(-200));
    await t.shot(page, 'pin-keypad');
    await typePin(page, '0000');
    t.check('a wrong PIN says "Wrong PIN. 4 tries left."', /Wrong PIN\. 4 tries left/.test(await pinMsg(page)), await pinMsg(page));
    t.check('the office is still closed after a wrong PIN', !(await officeOpen(page)));
    // cancel keeps the board; Esc as well
    await keypad(page).getByRole('button', { name: 'Cancel' }).click();
    await wait(600);
    t.check('Cancel leaves the board in place (no office, address not #/office)', !(await officeOpen(page)) && !/office/.test(await hashOf(page)), await hashOf(page));
    await page.keyboard.press('Control+Shift+O');
    await keypad(page).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    t.check('Ctrl+Shift+O is gated by the PIN as well', await keypad(page).isVisible().catch(() => false));
    await typePin(page, '1234');
    await waitOffice(page);
    t.check('the right PIN opens the office', await officeOpen(page));
    await page.locator('#sb-office [data-back-to-line]').first().click();
    await wait(900);

    // five wrong tries lock the keypad for 30 seconds, and the lock survives a reload
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 10000 });
    await settle(page, 400);
    await tapFlame(page, 5, 70);
    await keypad(page).waitFor({ state: 'visible', timeout: 8000 });
    for (let i = 0; i < 5; i++) { await typePin(page, '9999'); }
    const lockMsg = await pinMsg(page);
    t.check('after 5 wrong PINs the keypad says "Too many wrong tries. Try again in N s."', /Too many wrong tries\. Try again in \d+ s/.test(lockMsg), lockMsg);
    const lock = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('smokebox.v1.pinlock')); } catch (e) { return null; } });
    const secs = lock && lock.until ? (lock.until - Date.now()) / 1000 : null;
    t.check('the lock lasts about 30 s (stored until is 27 to 31 s ahead)', secs != null && secs > 27 && secs <= 31, { lock, secs });
    const disabled = await keypad(page).getByRole('button', { name: 'Digit 1', exact: true }).isDisabled();
    t.check('while locked the digit keys are disabled', disabled);
    await keypad(page).getByRole('button', { name: 'Cancel' }).click({ force: true }).catch(() => {});
    await wait(600);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 10000 });
    await settle(page, 400);
    await tapFlame(page, 5, 70);
    await keypad(page).waitFor({ state: 'visible', timeout: 8000 });
    await wait(800);
    t.check('the lock survives a reload (keypad still says too many tries)', /Too many wrong tries/.test(await pinMsg(page)), await pinMsg(page));
    // shorten the lock to 1.2 s (bench shortcut: the 30 s length was checked above) and prove it ends by itself
    await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('smokebox.v1.pinlock')); l.until = Date.now() + 1200; localStorage.setItem('smokebox.v1.pinlock', JSON.stringify(l)); });
    await wait(2600);
    t.check('when the lock time is over the keypad works again ("Enter the 4-digit PIN.")', /Enter the 4-digit PIN/.test(await pinMsg(page)) && !(await keypad(page).getByRole('button', { name: 'Digit 1', exact: true }).isDisabled()), await pinMsg(page));
    await typePin(page, '1234');
    await waitOffice(page);
    t.check('the right PIN after the lock opens the office', await officeOpen(page));
    await page.locator('#sb-office [data-back-to-line]').first().click();
    await wait(900);

    // a pasted office link is gated too, and cancelling replaces the address so Back cannot reopen a locked office
    await page.evaluate(() => { location.hash = '#/'; });
    await wait(400);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 10000 });
    await page.evaluate(() => { location.hash = '#/office/money'; });
    await keypad(page).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    t.check('a pasted #/office/money link asks for the PIN', await keypad(page).isVisible().catch(() => false));
    await keypad(page).getByRole('button', { name: 'Cancel' }).click().catch(() => {});
    await wait(700);
    t.check('cancelling the PIN on a pasted link replaces the address with the board', !/office/.test(await hashOf(page)) && !(await officeOpen(page)), await hashOf(page));
    await t.clean(page, 'pin');
  });

  h.test('06d-office-button', 'Back office button: named and visible at every width, opens the office, asks the PIN, header stays on one row', { owner: 'officeC', timeout: 120000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800 });
    await page.evaluate(() => SB.floor.setWelcome(false));
    await settle(page, 400);
    const btn = page.locator('.fl-head .fl-office');
    t.check('1280: the header has a button named Back office', (await btn.isVisible()) && /Back office/.test(await btn.innerText()), await btn.innerText().catch(() => ''));
    await btn.click();
    await waitOffice(page);
    t.check('tapping Back office opens the office, no secret needed', await officeOpen(page), await hashOf(page));
    await page.locator('#sb-office [data-back-to-line]').first().click();
    await wait(900);
    t.check('after leaving, focus is back on the Back office button', await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('fl-office')), await page.evaluate(() => document.activeElement && document.activeElement.className));

    // the header must stay on one row and keep the button at every common tablet and laptop width
    const widths = [[1024, 768], [1180, 820], [1194, 834], [1280, 800], [1366, 1024], [1440, 900], [1600, 900], [1920, 1080]];
    for (const [w, hh] of widths) {
      await page.setViewportSize({ width: w, height: hh });
      await settle(page, 500);
      const r = await page.evaluate(() => {
        const b = document.querySelector('.fl-head .fl-office'), hd = document.querySelector('.fl-head');
        const box = b.getBoundingClientRect();
        return { shown: b.offsetWidth > 0 && b.offsetHeight > 0, inside: box.left >= 0 && box.right <= innerWidth, headH: hd.offsetHeight, fit: hd.dataset.fit || 'none', menuInside: document.querySelector('.fl-menu').getBoundingClientRect().right <= innerWidth };
      });
      t.check(w + ' px: the Back office button is shown inside the screen and the header is one row (' + r.fit + ')', r.shown && r.inside && r.menuInside && r.headH < 110, r);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 500);
    const ph = await page.evaluate(() => { const b = document.querySelector('.fl-head .fl-office'); return { shown: b.offsetWidth > 0, w: b.offsetWidth, h: b.offsetHeight, name: b.getAttribute('aria-label') }; });
    t.check('390 px phone: Back office is an icon button with its name for screen readers and a full-size tap target', ph.shown && ph.w >= 44 && ph.h >= 44 && ph.name === 'Back office', ph);

    // text size Large makes everything wider: the header squeezes again instead of wrapping
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => SB.theme.setTextSize('large'));
    await settle(page, 600);
    const big = await page.evaluate(() => ({ headH: document.querySelector('.fl-head').offsetHeight, fit: document.querySelector('.fl-head').dataset.fit || 'none', shown: document.querySelector('.fl-office').offsetWidth > 0 }));
    t.check('large text at 1280: the header is still one row and shows Back office (' + big.fit + ')', big.shown && big.headH < 130, big);
    await page.evaluate(() => SB.theme.setTextSize('normal'));

    // the Menu list on a tablet has Back office as its first row
    await page.setViewportSize({ width: 900, height: 768 });
    await settle(page, 500);
    await page.locator('.fl-menu').click();
    const first = await page.getByRole('menuitem').first().innerText().catch(() => '');
    t.check('900: the Menu list starts with Back office', /^Back office/.test(first), first);
    await page.getByRole('menuitem', { name: /^Back office/ }).click();
    await waitOffice(page);
    t.check('1024: choosing Back office in the Menu list opens the office', await officeOpen(page), await hashOf(page));
    await page.locator('#sb-office [data-back-to-line]').first().click();
    await wait(900);

    // the Settings sheet has a Back office row too
    await page.setViewportSize({ width: 1600, height: 900 });
    await settle(page, 500);
    await page.locator('.fl-menu').click();
    await page.waitForSelector('.sheet-root [data-act="office"]', { timeout: 5000 }).catch(() => {});
    t.check('Settings has a Back office row', (await page.locator('.sheet-root [data-act="office"]').count()) === 1);
    await page.locator('.sheet-root [data-act="office"]').click();
    await waitOffice(page);
    t.check('the Settings row opens the office', await officeOpen(page), await hashOf(page));
    await page.locator('#sb-office [data-back-to-line]').first().click();
    await wait(900);

    // with a PIN set the visible button asks for it too
    await setPinViaData(page, '1234');
    await page.evaluate(() => { location.hash = '#/'; });
    await wait(400);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 10000 });
    await settle(page, 500);
    await page.locator('.fl-head .fl-office').click();
    await keypad(page).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    t.check('with a PIN set, the Back office button shows the Manager PIN keypad first', await keypad(page).isVisible().catch(() => false));
    t.check('the office stays closed behind the keypad', !(await officeOpen(page)));
    await typePin(page, '1234');
    await waitOffice(page);
    t.check('the right PIN then opens the office', await officeOpen(page), await hashOf(page));
    await t.clean(page, 'office-button');
  });
}
