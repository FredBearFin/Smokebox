// Integration contract, end to end. Owner: the integration watcher. Not picked up by tools/test.mjs (it needs Chromium and the whole build).
//   node --test test/contract.e2e.mjs
//
// Part 1 reuses tools/contract-check.mjs (static scan + live page + contract list) and turns every kind of problem into one test, so a failure names
// the kind of breakage and lists file:line and owner. Part 2 is behaviour that only shows when the files run together: no horizontal scroll from 280 to
// 2560 px on the floor, in every sheet and on every office page; Esc closes a sheet and gives focus back; [ and ] step through the office pages;
// "Back to the board" really returns to the floor; every office page opens with a plain headline and has charts.
import test, { before, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanStatic, analyze, runBrowser, ROOT, DIST_FILE } from '../tools/contract-check.mjs';
import { spawnSync } from 'node:child_process';

const { withPage } = await import(pathToFileURL(path.join(ROOT, 'tools/pw.mjs')).href);
const PAGES = ['pace', 'tickets', 'stations', 'money', 'safety', 'stock', 'data'];
const SHEETS = ['order', 'hold', 'board86', 'recall', 'demo', 'help', 'specs', 'menu'];

let S, R, A;
const list = (ps) => ps.map((p) => '  ' + p.file + (p.line ? ':' + p.line : '') + ' (' + p.owner + ') ' + p.what).join('\n');
const noProblems = (kinds) => {
  const bad = A.problems.filter((p) => kinds.includes(p.kind));
  assert.equal(bad.length, 0, '\n' + list(bad));
};

describe('integration contract (static scan + live page)', () => {
  before(async () => {
    const b = spawnSync(process.execPath, ['tools/build.mjs', '--out', DIST_FILE, '--quiet'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(b.status, 0, 'build failed: ' + b.stderr + b.stdout);
    S = scanStatic();
    R = S.parseErrors.length ? null : await runBrowser(S);
    A = analyze(S, R, null, null);
  });

  test('every source file parses', () => assert.deepEqual(S.parseErrors, []));
  test('the page boots: no load errors, no boot error screen', () => {
    assert.ok(R, 'not booted: a source file has a syntax error');
    assert.equal(R.boot.booted, true, 'SB.booted is false; boot error: ' + R.boot.bootError);
    assert.deepEqual(R.boot.loadErrors, []);
    noProblems(['syntax', 'load', 'boot', 'build']);
  });
  test('no console errors or page errors while booting, opening every sheet and every office page', () => noProblems(['console', 'pageerror']));
  test('no unguarded reference to an SB member that does not exist, and nothing used before its file loads', () => noProblems(['missing-api', 'load-order']));
  test('documented APIs exist with the documented shape (SPEC 11, 19, 20, office-contract, metrics.md)', () => noProblems(['contract']));
  test('sheet names, engine action names, icon names, chart types and page ids used in code all exist', () => noProblems(['sheet-name', 'action-name', 'icon-name', 'chart-type', 'nav-id', 'ctx-member', 'page-member']));
  test('office pages are registered once, with the title, icon and order of the contract; sheets are registered once', () => noProblems(['page-id', 'dup-page', 'page-contract', 'dup-sheet']));
  test('all eight sheets open into a dialog', () => noProblems(['sheet-open']));
  test('all seven office pages render without an error card', () => noProblems(['office-page', 'office-mount']));
  test('the office releases its timers, subscriptions, listeners and charts when a page is left and when the office closes', () => noProblems(['leak']));
  test('the demo traffic and the floor controls run', () => noProblems(['smoke']));
  test('kit.page() results carry the documented methods and ctx the documented members', () => {
    assert.ok(R && R.probe && R.probe.pages.length >= 1, 'no kit.page() call was seen while the office pages rendered');
    for (const m of 'headline tiles section card panel table insights refresh destroy'.split(' ')) assert.ok(R.probe.pages.every((p) => p.methods.includes(m)), 'kit.page() result lacks ' + m);
    for (const k of 'filters dataset opts prepared now metrics onFilterChange navigate openSheet theme kit'.split(' ')) assert.ok(R.probe.ctxKeys.includes(k), 'ctx lacks ' + k);
  });
  test('every chart card asks for a chart type that SB.charts has, with a span the kit supports (3 4 6 8 12 as documented, plus 5 7 9 which kit.card also accepts)', () => {
    const types = new Set(R.boot.chartTypes);
    const bad = (R.probe.cards || []).filter((c) => !types.has(c.type) || (c.span != null && ![3, 4, 5, 6, 7, 8, 9, 12].includes(c.span)));
    assert.deepEqual(bad, []);
    assert.ok((R.probe.cards || []).length >= 10, 'expected the office pages to ask for at least 10 chart cards, saw ' + (R.probe.cards || []).length);
  });
});

describe('behaviour across files', () => {
  test('no horizontal page scroll from 280 to 2560 px (floor, every sheet, every office page)', async () => {
    const widths = [280, 390, 768, 1280, 2560];
    const found = [];
    await withPage({ file: path.join(ROOT, DIST_FILE), w: 1280, h: 800, query: '?demo', hash: '#/', reducedMotion: 'reduce' }, async (page, logs) => {
      await page.waitForFunction(() => window.SB && window.SB.booted, null, { timeout: 25000 });
      const over = () => page.evaluate(() => {
        const de = document.documentElement; const out = { doc: de.scrollWidth - window.innerWidth, wide: [] };
        const top = [document.querySelector('.sheet-root .sheet'), document.querySelector('#sb-office:not([hidden])'), document.querySelector('#sb-floor')].filter(Boolean);
        top.forEach((e) => { if (e.scrollWidth - e.clientWidth > 1) out.wide.push((e.id || e.className.split(' ')[0]) + ' +' + (e.scrollWidth - e.clientWidth)); });
        return out;
      });
      const record = (where, w, r) => { if (r.doc > 1 || r.wide.length) found.push(w + ' px, ' + where + ': document +' + Math.max(0, r.doc) + (r.wide.length ? ', ' + r.wide.join(', ') : '')); };
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: w < 500 ? 800 : 900 });
        await page.evaluate(() => { location.hash = '#/'; });
        await page.waitForTimeout(250);
        record('floor', w, await over());
        for (const s of SHEETS) {
          await page.evaluate((n) => SB.sheets.open(n), s);
          await page.waitForTimeout(220);
          record('sheet ' + s, w, await over());
          await page.evaluate(() => SB.sheets.closeAll());
          await page.waitForTimeout(120);
        }
        await page.evaluate(() => { location.hash = '#/office/pace'; });
        await page.waitForFunction(() => SB.office.isMounted(), null, { timeout: 8000 });
        for (const p of PAGES) {
          await page.evaluate((id) => SB.office.navigate(id), p);
          await page.waitForTimeout(450);
          record('office ' + p, w, await over());
        }
        await page.evaluate(() => { const b = document.querySelector('[data-back-to-line]'); if (b) b.click(); });
        await page.waitForFunction(() => !SB.office.isMounted(), null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(200);
      }
      assert.deepEqual(logs.pageErrors, [], 'page errors during the width sweep');
    });
    assert.deepEqual(found, [], '\n' + found.join('\n'));
  });

  test('Esc closes a sheet and focus goes back to where it was', async () => {
    await withPage({ file: path.join(ROOT, DIST_FILE), w: 1280, h: 800, query: '?demo', hash: '#/', reducedMotion: 'reduce' }, async (page) => {
      await page.waitForFunction(() => window.SB && window.SB.booted, null, { timeout: 25000 });
      for (const n of SHEETS) {
        await page.evaluate(() => { const b = document.querySelector('#sb-floor button, #sb-floor [tabindex]'); if (b) b.focus(); });
        await page.evaluate((s) => SB.sheets.open(s), n);
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate((s) => SB.sheets.isOpen(s), n), true, n + ' did not open');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate((s) => SB.sheets.isOpen(s), n), false, n + ' did not close on Esc');
        assert.equal(await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body), true, n + ': focus was lost after closing');
      }
    });
  });

  test('the office: [ and ] step through the pages, every page opens with a headline and charts, Back to the board returns to the floor', async () => {
    await withPage({ file: path.join(ROOT, DIST_FILE), w: 1280, h: 800, query: '?demo', hash: '#/office/pace', reducedMotion: 'reduce' }, async (page, logs) => {
      await page.waitForFunction(() => window.SB && SB.office && SB.office.isMounted && SB.office.isMounted(), null, { timeout: 20000 });
      await page.waitForTimeout(900);
      const seen = [await page.evaluate(() => SB.office.current())];
      for (let i = 0; i < PAGES.length - 1; i++) {
        await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await page.keyboard.press(']');
        await page.waitForTimeout(500);
        seen.push(await page.evaluate(() => SB.office.current()));
      }
      assert.deepEqual(seen, PAGES, 'the ] key should visit the pages in the documented order');
      await page.keyboard.press('[');
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => SB.office.current()), 'stock', '[ should step back one page');
      for (const id of PAGES) {
        await page.evaluate((p) => SB.office.navigate(p), id);
        await page.waitForTimeout(800);
        const info = await page.evaluate(() => {
          const main = document.querySelector('#of-main') || document.querySelector('main');
          const first = main ? (main.innerText || '').trim().split('\n').map((s) => s.trim()).filter(Boolean) : [];
          return { text: first.join(' ').length, svgs: main ? main.querySelectorAll('svg').length : 0, h1: (document.querySelector('#of-title') || {}).textContent || '', headline: main ? ([...main.querySelectorAll('p,div')].find((e) => /\d/.test(e.textContent) && e.textContent.length > 40 && e.children.length < 3) || {}).textContent || '' : '' };
        });
        assert.ok(info.h1, id + ': the page title is empty');
        assert.ok(info.text > 150, id + ': the page shows almost no text (' + info.text + ' characters)');
        if (id !== 'data') assert.ok(info.svgs >= 3, id + ': expected charts or sparklines (svg), saw ' + info.svgs);
      }
      await page.evaluate(() => document.querySelector('[data-back-to-line]').click());
      await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 8000 });
      // The office is emptied when its closing fade ends (about 150 to 550 ms), so wait for that instead of a fixed time.
      await page.waitForFunction(() => !SB.office.isMounted(), null, { timeout: 4000 }).catch(() => {});
      assert.equal(await page.evaluate(() => SB.office.isMounted()), false, 'the office is still mounted after Back to the board');
      assert.equal(await page.evaluate(() => !!document.querySelector('#sb-floor') && !document.querySelector('#sb-floor').inert), true, 'the floor is still inert after leaving the office');
      assert.deepEqual(logs.pageErrors, []);
      assert.deepEqual(logs.errors, []);
    });
  });

  test('honesty labels from the agent brief: safety line on food-safety screens, simulated sync, sample data, starter estimates', async () => {
    await withPage({ file: path.join(ROOT, DIST_FILE), w: 1280, h: 800, query: '?demo', hash: '#/', reducedMotion: 'reduce' }, async (page) => {
      await page.waitForFunction(() => window.SB && window.SB.booted, null, { timeout: 25000 });
      const line = await page.evaluate(() => SB.config.safetyLine);
      assert.ok(line && line.length > 20, 'SB.config.safetyLine is missing');
      const sheetText = async (n) => {
        await page.evaluate((s) => SB.sheets.open(s), n);
        await page.waitForTimeout(350);
        const t = await page.evaluate(() => { const d = document.querySelectorAll('.sheet[role=dialog],.sheet[role=alertdialog]'); return d.length ? d[d.length - 1].textContent : ''; });
        await page.evaluate(() => SB.sheets.closeAll());
        await page.waitForTimeout(200);
        return t;
      };
      assert.ok((await sheetText('hold')).includes(line), 'the hold cabinet must show SB.config.safetyLine');
      // The pretend channel sync strip was removed from the 86 board in round 12; if a sync claim ever comes back it must be labelled practice/demo.
      const b86 = await sheetText('board86');
      if (/channel sync|live POS/i.test(b86)) assert.match(b86, /simulated|practice|demo/i, 'a channel sync claim on the 86 board must say it is practice only');
      await page.evaluate(() => { location.hash = '#/office/pace'; });
      await page.waitForFunction(() => SB.office.isMounted(), null, { timeout: 8000 });
      await page.waitForTimeout(900);
      const pageText = async (id) => { await page.evaluate((p) => SB.office.navigate(p), id); await page.waitForTimeout(900); return page.evaluate(() => (document.querySelector('#of-main') || document.body).textContent); };
      const sampleOn = await page.evaluate(() => SB.sim.sampleEnabled());
      const banner = await page.evaluate(() => (document.querySelector('.of-banner') || {}).textContent || '');
      if (sampleOn) assert.match(banner, /sample|practice|demo/i, 'the data banner must say sample data is in the range: "' + banner + '"');
      assert.ok((await pageText('safety')).includes(line), 'the Safety page must show SB.config.safetyLine');
      assert.match(await pageText('money'), /starter estimate/i, 'the Sales and money page must label starter numbers as starter estimates');
      const stockText = await pageText('stock');
      if (/channel sync|live POS|syncs? to/i.test(stockText)) assert.match(stockText, /simulated|practice|demo/i, 'a channel sync claim on the Stock and 86 page must say it is practice only');
      assert.ok((await pageText('data')).includes(line), 'the Data page must show SB.config.safetyLine');
    });
  });

  test('no rebuild on a timer: ticket slips and office cards keep the same DOM nodes across ticks and refreshes', async () => {
    await withPage({ file: path.join(ROOT, DIST_FILE), w: 1280, h: 800, query: '?demo', hash: '#/', reducedMotion: 'reduce' }, async (page) => {
      await page.waitForFunction(() => window.SB && window.SB.booted, null, { timeout: 25000 });
      // The demo kitchen (opened with ?demo) starts with its three sample tickets; stop the simulator so nothing arrives during the check.
      await page.evaluate(() => { SB.sim.live.stop(); SB.sim.live.crew(false); });
      await page.waitForTimeout(500);
      const tag = (sel, key) => page.evaluate(([q, k]) => { const els = [...document.querySelectorAll(q)]; els.forEach((e, i) => { e[k] = i + 1; }); return els.length; }, [sel, key]);
      const check = (sel, key) => page.evaluate(([q, k]) => { const els = [...document.querySelectorAll(q)]; return { now: els.length, kept: els.filter((e) => e[k]).length }; }, [sel, key]);
      const n = await tag('#sb-floor [data-ticket]', '__keepSlip');
      assert.ok(n >= 3, 'expected the three demo tickets on the board, saw ' + n);
      await page.waitForTimeout(3300); // three 1 Hz ticks and one store refresh
      const r = await check('#sb-floor [data-ticket]', '__keepSlip');
      assert.equal(r.kept, n, 'ticket slips were replaced by a timer (' + r.kept + ' of ' + n + ' nodes survived)');
      await page.evaluate(() => { location.hash = '#/office/tickets'; });
      await page.waitForFunction(() => SB.office.isMounted(), null, { timeout: 8000 });
      await page.waitForTimeout(1200);
      const c = await tag('#sb-office .of-card', '__keepCard');
      assert.ok(c >= 4, 'expected office cards, saw ' + c);
      await page.evaluate(() => SB.office._debug && SB.office._debug.refreshNow && SB.office._debug.refreshNow());
      await page.waitForTimeout(3500); // past the 3 s refresh throttle
      const r2 = await check('#sb-office .of-card', '__keepCard');
      assert.equal(r2.kept, c, 'office cards were rebuilt by a refresh (' + r2.kept + ' of ' + c + ' nodes survived)');
    });
  });
});
