/*
 * WHAT THIS FILE IS: Browser check for "Device checks": opens from the Settings sheet, shows five checks,
 * the sound test asks "Did you hear it?", answering Yes ticks sound, and volume is its own question.
 * USES: tools/pw.mjs, dist/smokebox.html. RUN: node test/tablet-ready.e2e.mjs
 */
import { withPage } from '../tools/pw.mjs';
let fails = 0;
// Records one check result and prints it.
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
await withPage({ w: 1024, h: 768 }, async (page, logs) => {
  await page.evaluate(() => window.SB.sheets.open('ready'));
  await page.waitForSelector('[data-check="awake"]');
  ok((await page.locator('.rd-card').count()) === 5, 'five check cards');
  ok(await page.locator('[data-check="sound"][data-ok="unknown"]').count() === 1, 'sound starts unchecked');
  await page.click('[data-act="sound-test"]');
  ok(await page.locator('[data-act="sound-yes"]').count() === 1, 'asks if the beep was heard');
  await page.click('[data-act="sound-yes"]');
  ok(await page.locator('[data-check="sound"][data-ok="true"]').count() === 1, 'yes ticks sound');
  ok(await page.locator('[data-check="volume"][data-ok="true"]').count() === 0, 'hearing the beep alone does not tick volume');
  await page.click('[data-act="vol-yes"]');
  ok(await page.locator('[data-check="volume"][data-ok="true"]').count() === 1, 'yes to the volume question ticks volume');
  ok(await page.locator('[data-check="installed"][data-ok="false"]').count() === 1, 'browser tab is not "installed"');
  ok(/of 5 ready/.test(await page.locator('.rd-summary').innerText()), 'summary counts ticks');
  await page.evaluate(() => { document.querySelector('.sheet-close, [data-close], .sheet button[aria-label*="lose"]')?.click(); });
  await page.evaluate(() => window.SB.sheets.open('pilot'));
  await page.waitForSelector('.pv-step');
  ok((await page.locator('.pv-step').count()) === 7, 'seven pilot steps');
  const mins = (await page.locator('.pv-total').innerText()).match(/About (\d+) minutes/);
  ok(mins && +mins[1] <= 15, 'pilot visit totals 15 minutes or less (' + (mins && mins[1]) + ')');
  ok(await page.locator('[data-act="pilot-print"]').count() === 1, 'print button present');
  await page.evaluate(() => window.SB.sheets.open('setup'));
  await page.waitForSelector('[data-act="open-ready"]');
  ok(await page.locator('[data-act="open-pilot"]').count() === 0, 'the setup sheet links Device checks only: the installer checklist is not shown to the owner');
  ok(await page.locator('.setup-help', { hasText: 'Help with setup' }).count() === 1 && await page.locator('.setup-help', { hasText: 'No sound?' }).count() === 1, 'the help links say what they open in words');
  ok(!/tablet/i.test(await page.locator('.sheet-title').last().innerText()), 'the setup title says device, not tablet');
  ok(logs.pageErrors.length === 0, 'no page errors ' + logs.pageErrors.join('|').slice(0, 200));
});
process.exit(fails ? 1 : 0);
