// Journey 1: first run. A new tablet opens the file for the first time.
import { boardSummary, wait, has, head, settle, startKitchen } from './_lib.mjs';

export default function (h) {
  h.test('01-first-run', 'First run boots clean and the board is ready to use', { owner: 'board', timeout: 40000 }, async (t) => {
    const page = await t.open({ w: 1280, h: 800 });
    await settle(page, 600);
    await t.clean(page, 'first run');

    const seeded = await has(page, 'SB.sim.seedFirstRun');
    const s = await boardSummary(page);
    const hdr = await page.evaluate(() => {
      const q = (sel) => document.querySelector(sel);
      return {
        brand: !!q('.fl-head [data-brand]'),
        brandName: (q('.fl-head [data-brand]') || {}).getAttribute && q('.fl-head [data-brand]').getAttribute('aria-label'),
        tabs: Array.from(document.querySelectorAll('.fl-seg [role=tab]')).map((b) => b.querySelector('.seg-label') ? b.querySelector('.seg-label').textContent : b.textContent),
        tools: Array.from(document.querySelectorAll('.fl-head [data-tool]')).map((b) => b.dataset.tool),
        sanitise: !!q('.fl-san'),
        newBtn: !!Array.from(document.querySelectorAll('.fl-head button')).find((b) => /New ticket/.test(b.textContent)),
        dock: !!q('.fl-dock'), dockTitle: (q('.fl-dock-toggle') || {}).textContent,
        theme: document.documentElement.getAttribute('data-theme'), lang: document.documentElement.lang, title: document.title,
        main: !!document.querySelector('main, [role=main], .fl-main'), h1: Array.from(document.querySelectorAll('h1')).length,
      };
    });
    t.check('header: flame brand button is present', hdr.brand, hdr);
    t.check('header: All, five three-letter station tabs (the starter names changed from PIT/HOT to KIT/PRE), then the Cabinet tab', hdr.tabs.length === 7 && hdr.tabs[0] === 'All' && hdr.tabs[6] === 'Cabinet' && hdr.tabs.slice(1, 6).every((x) => /^[A-Z]{3}$/.test(x)), hdr.tabs);
    t.check('header: Recall, 86 and Demo buttons are present (the hold cabinet is the Cabinet tab now)', ['recall', 'board86', 'demo'].every((x) => hdr.tools.includes(x)), hdr.tools);
    t.check('header: sanitise countdown chip is present', hdr.sanitise);
    t.check('header: New ticket button is present', hdr.newBtn);
    t.check('all-day dock is present and titled "All day"', hdr.dock && /All day/i.test(hdr.dockTitle || ''), hdr.dockTitle);
    t.check('page has a title, a language and starts in the Day look', /Smokebox/.test(hdr.title) && hdr.lang === 'en' && hdr.theme === 'day', { title: hdr.title, lang: hdr.lang, theme: hdr.theme });
    t.check('tab counts are numbers for every tab', s.tabs.length === 7 && s.tabs.every((x) => Number.isFinite(x.count)), s.tabs);

    // A brand-new kitchen is empty on purpose: no demo tickets, no starter batches, no sample history.
    t.check('first run starts with no tickets on the board', s.slips.length === 0, s.slips.length);
    const emptyText = await page.evaluate(() => (document.querySelector('.fl-empty') && !document.querySelector('.fl-empty').hidden) ? document.querySelector('.fl-empty').innerText : '');
    t.check('the empty board says "Let\'s build your menu" and offers just Add my menu and Watch the demo, with no station tabs yet', /build your menu/i.test(emptyText) && await page.locator('.fl-empty').getByRole('button', { name: 'Add my menu' }).isVisible() && await page.locator('.fl-empty').getByRole('button', { name: /Watch the demo/ }).isVisible() && !(await page.locator('.fl-empty').getByRole('button', { name: /Show me how it works/ }).isVisible()) && !(await page.locator('.fl-tabs').isVisible()), emptyText);
    t.check('the next-step card stays hidden until there is a dish on the menu (the empty board has its own buttons)', await page.locator('.fl-welcome').isHidden());
    t.check('nothing is shown as late on an empty board', !/Overdue|Running late/.test(s.text), s.text.slice(0, 200));
    t.check('every tab count is zero on an empty board', s.tabs.every((x) => x.count === 0), s.tabs);
    t.check('no seeded demo tickets: boot does not call SB.sim.seedFirstRun', seeded ? (await page.evaluate(() => SB.store.getState().tickets.length)) === 0 : true);
    await t.shot(page, 'first-run-1280');

    // sample history exists and is labelled
    const sample = await page.evaluate(() => SB.sim && SB.sim.sampleInfo ? SB.sim.sampleInfo() : null);
    t.check('the sample history can be loaded on request (SB.sim.sampleInfo exists)', !!sample || await page.evaluate(() => !!(SB.sim && SB.sim.sampleEnabled)), sample);
    t.check('sample history is switched off on a first run', await page.evaluate(() => !(SB.sim && SB.sim.sampleEnabled && SB.sim.sampleEnabled())));

    // the seeded board must keep ticking without console errors
    await wait(2500);
    await t.clean(page, 'after 2.5 s of ticking');

    // The blank install offers to build the menu; once a menu exists (here: the demo kitchen) the next-step card points at the first order.
    await startKitchen(page);
    await page.evaluate(() => SB.floor.setWelcome(true)); await settle(page, 400);
    const card = await page.evaluate(() => { const e = document.querySelector('.fl-welcome'); return e && !e.hidden ? e.innerText.replace(/\s+/g, ' ') : ''; });
    t.check('with a menu and no ticket yet the next-step card says how many dishes there are and to tap New ticket', /Your menu has \d+ dishes/.test(card) && /New ticket/.test(card), card.slice(0, 200));
    await page.evaluate(() => SB.store.dispatchEx('createTicket', { customer: 'First', channel: 'dine_in', items: [{ menuId: 'mac' }], src: 'live' }, { source: 'ui' })); await settle(page, 400);
    t.check('the card is finished for good once a ticket exists', await page.evaluate(() => document.querySelector('.fl-welcome').hidden));
  });
}
