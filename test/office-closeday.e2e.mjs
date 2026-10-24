// Quick browser check: the Orders footer's Close the day button opens the Close the day sheet. Run: node test/office-closeday.e2e.mjs
import { withPage } from '../tools/pw.mjs';

let failed = 0;
// Prints ok or FAIL for one check and remembers a failure for the exit code.
function check(name, ok, detail) { console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : ' -> ' + JSON.stringify(detail))); if (!ok) failed++; }

await withPage({ w: 1280, h: 800, hash: '?demo' }, async (page, logs) => {
  await page.waitForTimeout(1500);
  await page.evaluate(() => { SB.floor.setWelcome(false); SB.sheets.open('orders'); });
  await page.waitForTimeout(1000);
  const btn = page.locator('[data-act="closeday"]').first();
  check('the Orders sheet has a Close the day button', (await btn.count()) === 1);
  await btn.click();
  await page.waitForTimeout(900);
  check('it opens the Close the day sheet', await page.evaluate(() => !!document.querySelector('.cd-page')));
  check('the sheet says what closing does', /does not lock anything/.test(await page.evaluate(() => document.querySelector('.cd-page').innerText)));
  // Choosing to throw the leftovers out changes the closing button, so food is never thrown out by surprise.
  const radio = page.locator('input[name="cd-left"][value="discard"]');
  if (await radio.count()) {
    await radio.check();
    const label = await page.evaluate(() => document.querySelector('.cd-actions .btn-primary').textContent);
    check('throwing leftovers out is named on the closing button', /throw out/.test(label), label);
    await page.locator('input[name="cd-left"][value="keep"]').check();
    check('keeping them puts the plain label back', await page.evaluate(() => document.querySelector('.cd-actions .btn-primary').textContent) === 'Close the day');
  } else check('the demo has leftover food to choose about', false, 'no leftover choice');
  check('no console or page errors', !logs.errors.length && !logs.pageErrors.length, { e: logs.errors, p: logs.pageErrors });
});
process.exit(failed ? 1 : 0);
