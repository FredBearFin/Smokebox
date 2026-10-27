// Keep-awake, sound and readings (browser, about 40 s). Run: node test/board-round16.e2e.mjs
// Covers: the screen wake lock (asked for at start, again when the page returns, again after the system takes it back, let go
// when the board closes), the calm lines for a screen that cannot stay awake, sound that is off or not yet allowed, and a board that
// was in the background, the "Updated" stamp, and the Test the sound button. The wake lock is a stub; sound uses the real browser.
// Needs dist/smokebox.html.
import { toolRequire } from '../tools/_deps.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = toolRequire('playwright');
const DIST = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist/smokebox.html');
let fail = 0;
// Records one check and prints it.
function check(name, ok, detail) { if (!ok) fail++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + JSON.stringify(detail))); }
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const STUB = `
  window.__wl = { calls: 0, released: 0, sentinels: [] };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
    __wl.calls++;
    const sn = { listeners: [], addEventListener(t, f) { this.listeners.push(f); }, release() { __wl.released++; return Promise.resolve(); } };
    __wl.sentinels.push(sn); return sn; } } });`;
// Opens the app with an optional init script and waits for it to boot.
async function boot(ctx, init, query) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  if (init) await p.addInitScript(init);
  await p.goto(pathToFileURL(DIST).href + (query || ''));
  await p.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 8000 });
  await p.waitForTimeout(500);
  return p;
}
const strip = (p) => p.evaluate(() => { const e = document.querySelector('.fl-strip'); return e ? e.innerText : ''; });

// Wake lock supported
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const p = await boot(ctx, STUB);
  await p.evaluate(() => SB.floor.setWelcome(false));
  await p.waitForTimeout(600);
  check('the wake lock is asked for when the board shows', (await p.evaluate(() => __wl.calls)) >= 1 && (await p.evaluate(() => SB.floor.wakeLock())) === 'on');
  const before = await p.evaluate(() => __wl.calls);
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.evaluate(() => { const real = Date.now; Date.now = () => real() + 3 * 60e3; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(1500);
  check('it is asked for again when the page comes back', (await p.evaluate(() => __wl.calls)) > before, await p.evaluate(() => __wl.calls));
  if (await p.locator('.fl-strip-sound:visible').count()) { await p.locator('.fl-strip-sound:visible').first().click(); await p.waitForTimeout(1200); }
  const s1 = await strip(p);
  check('after minutes in the background a calm line says warnings were silent', /background for 3 minutes/.test(s1), s1);
  const b2 = await p.evaluate(() => __wl.calls);
  await p.evaluate(() => { const sn = __wl.sentinels[__wl.sentinels.length - 1]; sn.listeners.forEach((f) => f()); });
  await p.waitForTimeout(1500);
  check('it is asked for again after the system takes it back', (await p.evaluate(() => __wl.calls)) > b2, await p.evaluate(() => __wl.calls));
  // The stamp shows on laptops and wall screens (1200 px and wider); at 1024 it is in the page but not drawn.
  check('the board keeps an Updated stamp', /Updated \d/.test(await p.evaluate(() => document.querySelector('.fl-checked') ? document.querySelector('.fl-checked').textContent : '')), await p.evaluate(() => document.querySelector('.fl-checked') && document.querySelector('.fl-checked').textContent));
  const rel = await p.evaluate(() => { SB.floor.unmount(); return __wl.released; });
  check('the wake lock is let go when the board closes', rel >= 1, rel);
  await ctx.close();
}

// Wake lock missing: a calm line, and work is not blocked
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const p = await boot(ctx, "Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });");
  await p.evaluate(() => SB.floor.setWelcome(false));
  await p.waitForTimeout(1500);
  const s = await strip(p);
  check('with the sound bar up, the sleep line waits behind it and the bar says so (one notice at a time)', /Tap to turn on sound/.test(s) && /\(1 more notice\)/.test(s) && !/may go to sleep/.test(s), s);
  await p.click('.fl-strip-sound >> nth=0'); await p.waitForTimeout(1200);
  const s2 = await strip(p);
  check('once sound is allowed the sleep line shows: a screen that cannot stay awake gets a calm line', /may go to sleep/.test(s2), s2);
  await p.click('.fl-new'); await p.waitForTimeout(500);
  check('the line does not block the work (New ticket opens)', (await p.locator('.ord-tile').count()) > 0 || (await p.locator('[role="dialog"]').count()) > 0);
  await ctx.close();
}

// Sound off, audio not yet allowed, Test the sound
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const p = await boot(ctx, STUB);
  await p.evaluate(() => SB.floor.setWelcome(false));
  await p.waitForTimeout(800);
  const s0 = await strip(p);
  check('sound on but not yet allowed: a bar asks for one tap', /Tap to turn on sound/.test(s0), s0);
  await p.evaluate(() => SB.floor.setSound(false));
  await p.waitForTimeout(1500);
  const s1 = await strip(p);
  check('sound off: "Warnings are silent: sound is off on this tablet. Tap to turn on."', /Warnings are silent: sound is off on this tablet\. Tap to turn on\./.test(s1), s1);
  await p.click('.fl-strip-pause'); await p.waitForTimeout(800);
  check('tapping that line turns the sound on', await p.evaluate(() => SB.floor.sound()) === true);
  await p.evaluate(() => SB.sheets.open('menu')); await p.waitForTimeout(800);
  await p.click('[data-act="test-sound"]'); await p.waitForTimeout(600);
  const say = await p.evaluate(() => document.querySelector('.mn-test-say').textContent);
  check('Test the sound answers in words', /heard a chime|not let the board play sound|cannot play sound/.test(say), say);
  check('Test the sound unlocks the audio', await p.evaluate(() => SB.floor.audioState()) === 'running', await p.evaluate(() => SB.floor.audioState()));
  await ctx.close();
}

// Readings sheet
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const blank = await boot(ctx);
  await blank.evaluate(() => { SB.floor.setWelcome(false); SB.sheets.open('menu'); });
  await blank.waitForTimeout(700);
  check('a kitchen without cook-ahead has no Readings link', (await blank.locator('.mn-links >> text=Readings').count()) === 0);
  await blank.close();
  const p = await boot(ctx, null, '?demo');
  await p.evaluate(() => { SB.floor.setWelcome(false); SB.who.set('FW'); SB.sheets.open('menu'); });
  await p.waitForTimeout(700);
  check('with cook-ahead on, Settings has a Readings link', (await p.locator('.mn-links >> text=Readings').count()) === 1);
  await p.keyboard.press('Escape');
  await p.evaluate(() => SB.sheets.open('readings'));
  await p.waitForSelector('[data-act="log-equip"]');
  await p.click('.rd-unit [data-id="freezer"]');
  await p.fill('input[aria-label="Name (optional)"]', 'Walk-in');
  const dis = await p.evaluate(() => ['log-equip', 'log-thermo', 'log-strip'].map((a) => document.querySelector('[data-act="' + a + '"]').disabled));
  check('every Log button waits until a number is typed (no starting number can be logged)', dis.every(Boolean), dis);
  check('the temperature boxes start empty', await p.evaluate(() => ['Temperature of the fridge, freezer or case', 'What the food thermometer says', 'Sanitizer strip reading in parts per million'].every((l) => document.querySelector('input[aria-label="' + l + '"]').value === '')));
  await p.fill('input[aria-label="Temperature of the fridge, freezer or case"]', '0');
  await p.click('[data-act="log-equip"]'); await p.waitForTimeout(500);
  check('after a log the box is empty again and Log waits', await p.evaluate(() => document.querySelector('[data-act="log-equip"]').disabled && document.querySelector('input[aria-label="Temperature of the fridge, freezer or case"]').value === ''));
  await p.fill('input[aria-label="What the food thermometer says"]', '32');
  await p.click('[data-act="log-thermo"]'); await p.waitForTimeout(500);
  await p.fill('input[aria-label="Sanitizer (optional)"]', 'Quat');
  await p.fill('input[aria-label="Where (optional)"]', 'Prep sink');
  await p.fill('input[aria-label="Sanitizer strip reading in parts per million"]', '200');
  await p.click('[data-act="log-strip"]'); await p.waitForTimeout(500);
  const ev = await p.evaluate(() => SB.engine.safetyLog(SB.store.getState()).map((r) => r.event).filter((e) => /equip_temp|thermometer_checked|sanitize_done/.test(e.type)).map((e) => [e.type, e.unit, e.label, e.f, e.method, e.ppm, e.product, e.where, e.who].join('|')));
  check('a fridge reading is saved with its name, kind and initials', ev.some((x) => /^equip_temp\|freezer\|Walk-in\|/.test(x) && /FW$/.test(x)), ev);
  check('a thermometer check is saved (ice water, 32)', ev.some((x) => /^thermometer_checked\|\|\|32\|ice/.test(x)), ev);
  check('a strip reading is saved with ppm, product and place', ev.some((x) => /^sanitize_done\|\|\|\|\|200\|Quat\|Prep sink/.test(x)), ev);
  const rec = await p.evaluate(() => document.querySelector('.rd-recent').innerText);
  check('the recent list shows them in words', /Walk-in/.test(rec) && /Thermometer check/.test(rec) && /Sanitizer strip: 200 ppm/.test(rec), rec);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.evaluate(() => SB.sheets.open('readings')); await p.waitForSelector('[data-act="log-equip"]');
  const chips = await p.evaluate(() => [...document.querySelectorAll('.rd .ord-chips button')].map((b) => b.textContent).join('|'));
  check('the last names come back as one-tap chips', /Walk-in/.test(chips) && /Quat/.test(chips) && /Prep sink/.test(chips), chips);
  const fits = await p.evaluate(() => document.documentElement.scrollWidth <= 390);
  check('the sheet fits a 390 px phone', fits);
  await p.click('.rd-row >> nth=0 >> text=Fix'); await p.fill('.rd-row >> nth=0 >> input', 'wrong unit'); await p.click('.rd-row >> nth=0 >> text=Save fix'); await p.waitForTimeout(500);
  const fixed = await p.evaluate(() => document.querySelector('.rd-recent').innerText);
  check('a fix is saved next to the entry and the old entry stays', /fixed: wrong unit/.test(fixed), fixed);
  await p.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/readings.png' : '/tmp/readings.png' });
  await ctx.close();
}
check('no page errors', errs.length === 0, errs);
await browser.close();
console.log(fail ? fail + ' check(s) failed' : 'all checks passed');
process.exit(fail ? 1 : 0);
