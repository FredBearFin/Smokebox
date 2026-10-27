// Quick browser check (about 10 s) of production mode: clock speeds and the contrast checker are hidden
// until the demo is loaded (a ?demo tab), and the Demo sheet says plainly that demo data is for practice.
import { withPage } from '../tools/pw.mjs';
let bad = 0;
const check = (n, ok, x) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(x))); if (!ok) bad++; };
await withPage({ w: 1280, h: 800 }, async (page, logs) => {
  await page.waitForTimeout(600);
  check('demoLoaded is false on a fresh kitchen', (await page.evaluate(() => SB.shell.demoLoaded())) === false);
  await page.evaluate(() => SB.sheets.open('menu')); await page.waitForTimeout(300);
  const vis = (sel) => page.locator(sel).first().isVisible().catch(() => false);
  check('settings: no Specs link, no clock speed', !(await page.locator('.mn-link:has-text("Specs")').count()) && !(await page.locator('.dm-speed:visible').count()));
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  // In a real kitchen the Demo sheet only explains the demo and offers 'Watch the demo'; no clock speed, nothing to reset.
  await page.evaluate(() => SB.sheets.open('demo')); await page.waitForTimeout(300);
  check('demo sheet (real kitchen): no clock speed, offers Watch the demo', !(await page.locator('.dm-speed:visible').count()) && (await page.locator('button:has-text("Watch the demo")').count()) >= 1);
  await page.evaluate(() => SB.sheets.closeAll()); await page.waitForTimeout(300);
  // The demo is its own mode (a ?demo tab): there the clock speeds show and the sheet says it is for practice.
  const demo = await page.context().newPage();
  const demoErrors = []; demo.on('pageerror', (e) => demoErrors.push(String(e)));
  await demo.goto(page.url().split('?')[0].split('#')[0] + '?demo'); await demo.waitForTimeout(1200);
  check('demoLoaded in a demo tab', await demo.evaluate(() => SB.shell.demoLoaded()));
  await demo.evaluate(() => SB.sheets.open('demo')); await demo.waitForTimeout(300);
  check('demo sheet (demo tab): clock speed shows', (await demo.locator('.dm-speed:visible').count()) === 1);
  check('demo sheet (demo tab): says it is for practice', (await demo.locator('.dm').filter({ hasText: /for practice|for the demo/ }).count()) >= 1);
  check('no page errors in the demo tab', demoErrors.length === 0, demoErrors);
  await demo.close();
  check('no page errors', logs.pageErrors.length === 0, logs.pageErrors);
});
process.exit(bad ? 1 : 0);
