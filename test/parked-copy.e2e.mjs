/*
 * WHAT THIS FILE IS: Browser check for the set-aside copy card on the Data page (Back office, Menu, prices and shop, Data): a copy that was set aside as
 * unreadable but can be read is described (tickets, orders, when), bringing it back needs a saved backup of what is here, the typed word RESTORE and the
 * PIN when one is set, the kitchen it replaces is kept (Undo this restore puts it back), and it can be thrown away. Nothing shows without a readable copy.
 * USES: tools/pw.mjs, test/_load.mjs (builds kitchens with the engine), dist/smokebox.html. RUN: node test/parked-copy.e2e.mjs
 */
import { withPage } from '../tools/pw.mjs';
import { loadSB } from './_load.mjs';
let fails = 0;
// Records one check result and prints it.
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

// Builds a saved kitchen with `days` closed days of `perDay` paid orders ending an hour ago, as the text the page loads.
async function kitchen(days, perDay) {
  const SB = await loadSB(['00-util', '10-config', '20-engine']);
  const E = SB.engine;
  const end = Date.now() - 3600e3;
  let now = new Date(end - (days - 1) * 86400e3).setHours(9, 0, 0, 0);
  let s = E.newState({ now, blank: true });
  const go = (type, p, at) => { if (at > now) now = at; const r = E.apply(s, type, p, now); if (r.report !== 'ok') throw new Error(type + ' ' + r.report); s = r.state; return r; };
  const dish = go('addMenuItem', { name: 'Plain dish', zone: 'pit', cat: 'meat', price: 6.5, prepSec: 120, track: 'one', prepGuess: false }, now + 1000).info.id;
  const first = now;
  for (let d = 0; d < days; d++) {
    const base = new Date(first); base.setDate(base.getDate() + d); base.setHours(11, 0, 0, 0);
    for (let k = 0; k < perDay; k++) {
      const at = base.getTime() + k * 600e3;
      const r = go('createTicket', { customer: 'C' + k, channel: 'dine_in', items: [{ menuId: dish, qty: 1 }], allowPast: true }, at);
      const tk = s.tickets[s.tickets.length - 1];
      for (const it of tk.items) for (let i = 0; i < 2; i++) { const cur = s.tickets.find((x) => x.id === tk.id).items.find((x) => x.id === it.id); if (cur.status !== 'done') go('advanceItem', { ticketId: tk.id, itemId: it.id }, at + 20000 * (i + 1)); }
      go('bumpTicket', { ticketId: tk.id }, at + 70000); go('payOrder', { orderId: r.info.orderId, method: 'cash', tip: 0 }, at + 80000);
    }
    go('closeDay', {}, base.getTime() + 10 * 3600e3);
  }
  const t = Math.max(now, end); s = E.tick(s, t).state;
  return { text: JSON.stringify({ v: 1, savedAt: t, rev: s.rev, clock: { virtual: t, real: t, speed: 1 }, state: s }), tickets: s.tickets.length, orders: s.orders.length, at: t };
}
const current = await kitchen(2, 2);   // what is on the device now: 4 tickets
const parked = await kitchen(6, 3);    // the set-aside copy: 18 tickets
// The start-up script that puts both in storage once (a string, because the page cannot see this file's variables).
const seed = (cur, par) => 'try { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("smokebox.v1.state", ' + JSON.stringify(cur.text) + '); localStorage.setItem("smokebox.v1.corrupt", ' + JSON.stringify(par.text) + '); localStorage.setItem("smokebox.v1.corruptat", ' + JSON.stringify(String(par.at)) + '); } } catch (e) { /* storage blocked */ }';
const tickets = (page) => page.evaluate(() => SB.store.getState().tickets.length);
// Types the PIN on the keypad when it shows.
const pinIfAsked = async (page) => { if (await page.locator('.keypad').count()) { for (const d of '1234') await page.locator('.keypad button', { hasText: new RegExp('^' + d + '$') }).first().click(); await page.waitForTimeout(500); } };
const openData = async (page) => { await page.evaluate(() => { location.hash = '#/office/data'; }); await page.waitForTimeout(500); await pinIfAsked(page); await page.waitForSelector('.od-hist, [data-region="parked-copy"]', { timeout: 8000 }); await page.waitForTimeout(500); };

await withPage({ w: 1280, h: 900, init: seed(current, parked), clearStorage: false }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  await page.evaluate(async () => { await SB.shell.setPin('1234'); });
  ok((await tickets(page)) === current.tickets, 'the page opened the current kitchen: ' + await tickets(page) + ' tickets');
  await openData(page);
  const box = page.locator('[data-region="parked-copy"]');
  ok(await box.isVisible(), 'the Data page shows the set-aside copy card');
  const t = await box.innerText();
  ok(new RegExp(parked.tickets + ' tickets').test(t) && new RegExp(parked.orders + ' orders').test(t) && /set this copy aside on/.test(t), 'it says what the copy holds and when: ' + t.replace(/\n/g, ' ').slice(0, 170));
  ok(await page.locator('[data-action="parked-restore"]').isDisabled(), 'the red button is off at first');
  await page.fill('input[aria-label="Type RESTORE to confirm"]', 'restore');
  ok(await page.locator('[data-action="parked-restore"]').isDisabled(), 'the typed word alone is not enough: the backup of what is here comes first');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="parked-backup"]')]);
  ok(/before-set-aside-restore/.test(dl.suggestedFilename()), 'the backup of what is here was handed to the browser: ' + dl.suggestedFilename());
  ok(await page.locator('[data-action="parked-restore"]').isEnabled(), 'backup saved and word typed: the red button is on');
  await page.click('[data-action="parked-restore"]');
  await page.waitForSelector('.keypad'); ok(true, 'with a PIN set the keypad comes first');
  for (const d of '1234') await page.locator('.keypad button', { hasText: new RegExp('^' + d + '$') }).first().click();
  await page.waitForTimeout(900);
  ok((await tickets(page)) === parked.tickets, 'the set-aside copy is the kitchen now: ' + await tickets(page) + ' tickets');
  ok(await page.locator('[data-action="undo-restore"]').count() === 1, 'Undo this restore is offered');
  await page.click('[data-action="undo-restore"]');
  await page.getByRole('button', { name: 'Put my old kitchen back' }).click();
  for (const d of '1234') await page.locator('.keypad button', { hasText: new RegExp('^' + d + '$') }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  ok((await tickets(page)) === current.tickets, 'Undo puts back what was here: ' + await tickets(page) + ' tickets');
  ok(logs.pageErrors.length === 0, 'no page errors ' + logs.pageErrors.join('|').slice(0, 200));
});

// Throwing it away leaves the kitchen alone and the card gone; with no copy there is no card.
await withPage({ w: 1280, h: 900, init: seed(current, parked), clearStorage: false }, async (page) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  await openData(page);
  await page.click('[data-action="parked-drop"]');
  await page.getByRole('button', { name: 'Throw it away' }).click(); await page.waitForTimeout(700);
  ok(await page.locator('[data-region="parked-copy"]').isHidden() && (await tickets(page)) === current.tickets && await page.evaluate(() => !SB.store.parkedCopy()), 'thrown away: the card is gone, the kitchen is untouched, the store has no copy');
});
await withPage({ w: 1280, h: 900 }, async (page) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  await openData(page);
  ok(await page.locator('[data-region="parked-copy"]').isHidden(), 'no set-aside copy: nothing is shown');
});
process.exit(fails ? 1 : 0);
