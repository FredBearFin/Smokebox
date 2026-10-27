// Quick browser check (about 15 s) of the demo UI: a normal tab has no demo bar and offers Watch the demo; entering the demo shows
// a permanent bar with a Back button on every screen; leaving brings back the real kitchen untouched and erases the demo.
import { withPage } from '../tools/pw.mjs';
let bad = 0;
const check = (n, ok, x) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(x))); if (!ok) bad++; };
const SHOT = process.env.SHOTDIR || '/tmp';
await withPage({ w: 1280, h: 800, touch: true }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  check('a normal tab is the real kitchen with no demo bar', await page.evaluate(() => SB.store.mode() === 'real' && !document.querySelector('.sb-banner[data-kind=demo]')));
  check('first run offers Watch the demo', await page.locator('.fl-start-demo:has-text("Watch the demo")').isVisible());
  await page.evaluate(() => SB.store.dispatchEx('addMenuItem', { name: 'My own dish', zone: 'pit', cat: 'meat', price: 9, prepSec: 120, track: 'two' }, { source: 'ui' }));
  await page.waitForTimeout(600);
  await page.evaluate(() => SB.store.flush());
  // Menu sheet and Demo sheet in a real kitchen.
  await page.evaluate(() => SB.sheets.open('demo')); await page.waitForTimeout(300);
  check('the Demo sheet in a real kitchen only explains and offers Watch the demo', await page.locator('[data-act=try-demo]').isVisible() && !(await page.locator('.dm-restart').count()));
  await page.screenshot({ path: SHOT + '/demo-intro.png' });
  await page.click('[data-act=try-demo]');
  await page.waitForFunction(() => window.SB && SB.booted === true && SB.store.isDemo(), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  check('in the demo a permanent bar with a Back button shows', await page.locator('.sb-banner[data-kind=demo] button:has-text("Back to my kitchen")').isVisible());
  check('the demo kitchen is the sample menu, not the owner dish', await page.evaluate(() => SB.store.getState().menu.length > 5 && !SB.store.getState().menu.some((m) => m.name === 'My own dish')));
  await page.screenshot({ path: SHOT + '/demo-bar.png' });
  await page.evaluate(() => SB.shell.ignite({})); await page.waitForTimeout(900);
  check('the bar is still there in the back office', await page.locator('.sb-banner[data-kind=demo] button:has-text("Back to my kitchen")').isVisible());
  await page.evaluate(() => SB.shell.extinguish && SB.shell.extinguish()); await page.waitForTimeout(500);
  await page.locator('.sb-banner[data-kind=demo] button').click();
  await page.waitForFunction(() => window.SB && SB.booted === true && !SB.store.isDemo(), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  check('leaving returns to the real kitchen with the owner dish intact', await page.evaluate(() => SB.store.mode() === 'real' && SB.store.getState().menu.some((m) => m.name === 'My own dish') && !document.querySelector('.sb-banner[data-kind=demo]')));
  check('the demo left nothing behind in storage', await page.evaluate(() => !Object.keys(localStorage).some((k) => k.indexOf('smokebox.demo.') === 0)));
  check('no page errors', logs.pageErrors.length === 0, logs.pageErrors);
});
await withPage({ w: 1280, h: 800, hash: '?demo' }, async (page) => {
  await page.waitForFunction(() => window.SB && SB.booted === true);
  check('a ?demo tab shows the bar', await page.locator('.sb-banner[data-kind=demo]').isVisible());
});
process.exit(bad ? 1 : 0);
