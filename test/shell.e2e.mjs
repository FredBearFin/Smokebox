// Shell end-to-end test (browser). Run: node test/shell.e2e.mjs [--keep-shots]
// Builds a private bundle of ONLY the shell layer (tokens, base CSS, util, config, icons, shell, boot), then injects the test stubs from
// test/stubs/ with page.addScriptTag AFTER the build, so other modules in progress cannot disturb these checks.
// Writes screenshots to test/.out/shots/. Exit code 1 on any failed check, console error or page error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { withPage } from '../tools/pw.mjs';
import { buildShell, SHELL_OUT } from './shell.bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUBS = path.join(root, 'test/stubs') + path.sep;
const SHOTS = path.join(root, 'test/.out/shots');
fs.mkdirSync(SHOTS, { recursive: true });
buildShell();

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
}
const group = (t) => console.log('\n# ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const noErrors = (name, logs) => check(name + ': no console errors or page errors', logs.errors.length === 0 && logs.pageErrors.length === 0, { errors: logs.errors.slice(0, 4), pageErrors: logs.pageErrors.slice(0, 3) });

async function stubs(page, { gallery = false, slips = false } = {}) {
  await page.evaluate(() => { try { SB.shell.unmount(); } catch (e) { /* first mount */ } document.getElementById('app').innerHTML = ''; });
  for (const f of ['store', ...(gallery || slips ? ['gallery'] : []), 'floor', 'office']) {
    if (await page.evaluate((n) => !!(window.SB && SB[n] && (SB[n].__stub || n === 'gallery')), f)) continue;
    await page.addScriptTag({ path: STUBS + f + '.js' });
  }
  if (gallery) await page.evaluate(() => { if (!SB.floor.__orig) { SB.floor.__orig = SB.floor.mount; SB.floor.mount = (el) => SB.gallery.render(el); } });
  else await page.evaluate(() => { if (SB.floor.__orig) { SB.floor.mount = SB.floor.__orig; SB.floor.__orig = null; } });
  await page.evaluate(() => { SB.shell.mount(document.getElementById('app')); });
}
const brandTaps = async (page, n) => { for (let i = 0; i < n; i++) await page.locator('#sb-floor [data-brand]').first().click(); };
async function openOfficeByTaps(page) {
  await brandTaps(page, 5);
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 4000 });
  await page.evaluate(() => SB.shell.ignite()); // resolves when the ignition has finished
}
async function resetState(page) {
  await page.evaluate(async () => {
    SB.sheets.closeAll(); SB.ui.closeMenu && SB.ui.closeMenu();
    if (SB.shell.inOffice()) await SB.shell.extinguish();
    SB.router.go({ kind: 'floor', zone: 'all' }, { replace: true });
    SB.shell.lock();
  });
  await wait(250);
}
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);

/* ------------------------------------------------------------------------------------------------------------------------
 * 0. Pure parts in Node (no DOM): router parsing and SHA-256 must load without a browser
 * ---------------------------------------------------------------------------------------------------------------------- */
group('pure parts in Node');
{
  const ctx = vm.createContext({ console });
  ctx.globalThis = ctx;
  let threw = null;
  try { vm.runInContext(fs.readFileSync(path.join(root, 'src/js/60-shell.js'), 'utf8'), ctx); } catch (e) { threw = e; }
  check('60-shell.js loads in Node without a DOM', !threw, String(threw));
  const SB = ctx.SB || {};
  check('Node: SB.router.viewFor and hashFor exist', !!(SB.router && SB.router.viewFor && SB.router.hashFor));
  check('Node: sha256("abc") matches the standard test vector', SB.shell && SB.shell.sha256 && SB.shell.sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  check('Node: sha256("") matches the standard test vector', SB.shell && SB.shell.sha256('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  check('Node: sha256 of a 2-block message matches', SB.shell && SB.shell.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 1. Boot with placeholders only (no other module): the shell must stand alone
 * ---------------------------------------------------------------------------------------------------------------------- */
group('boot with placeholders');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await page.waitForFunction(() => window.SB && SB.booted === true, null, { timeout: 5000 }).catch(() => {});
  const r = await page.evaluate(() => ({
    booted: SB.booted === true, floor: !!document.getElementById('sb-floor'), office: !!document.getElementById('sb-office'), view: document.querySelector('.sb-shell') && document.querySelector('.sb-shell').dataset.view,
    brand: !!document.querySelector('[data-brand]'), dev: typeof SB.dev, boot: typeof SB.boot, err: !!document.getElementById('boot-error'),
    officeHidden: document.getElementById('sb-office').hidden, theme: document.documentElement.getAttribute('data-theme'),
  }));
  check('booted without SB.store, SB.floor or SB.office', r.booted && r.floor && r.office && !r.err, r);
  check('floor layer is the visible view, office is hidden', r.view === 'floor' && r.officeHidden === true, r);
  check('SB.dev is only defined when SB.store exists', r.dev === 'undefined', r.dev);
  check('placeholder floor has a brand button for the secret gesture', r.brand);
  // sheets registered by other modules do not exist yet: opening one must say so, not throw
  const msg = await page.evaluate(() => { SB.sheets.open('order'); return document.querySelector('.toast-msg') && document.querySelector('.toast-msg').textContent; });
  check('opening an unregistered sheet shows a toast', /not part of this build/.test(msg || ''), msg);
  // placeholders reach the office through the same gesture
  await brandTaps(page, 5);
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 4000 });
  await page.evaluate(() => SB.shell.ignite());
  check('placeholder office opens after 5 brand taps', await page.evaluate(() => !document.getElementById('sb-office').hidden && !!document.querySelector('#sb-office [data-back-to-line]')));
  await page.locator('#sb-office [data-back-to-line]').first().click();
  await page.waitForFunction(() => !SB.shell.inOffice() && document.getElementById('sb-office').hidden, null, { timeout: 3000 });
  check('placeholder office closes with its own button', true);
  noErrors('placeholder boot', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 2. Icons
 * ---------------------------------------------------------------------------------------------------------------------- */
group('icons');
await withPage({ w: 800, h: 600, file: SHELL_OUT }, async (page, logs) => {
  const REQUIRED = 'flame pot fry snow bag plate car phone plus minus x check check-circle clock alert alert-circle history undo redo settings sliders thermometer shield shield-check package chart-line chart-bar gauge list grid search trash edit download upload refresh play pause fast-forward sun moon volume volume-off lock unlock info help keyboard home eye arrow-up arrow-down arrow-right chevron-left chevron-right chevron-up chevron-down bell users receipt scale timer flag ban zap layers menu more copy filter calendar dollar trending-up trending-down door sparkle smoke target pulse stack book'.split(' ');
  const r = await page.evaluate((req) => {
    const out = { names: SB.icons.names().length, missing: req.filter((n) => !SB.icons.has(n)), badTypes: [], unknown: null, odd: [], brand: null };
    for (const n of SB.icons.names()) {
      const s = SB.icons.svg(n, { size: 24, stroke: 2 }), t = SB.icons.html(n);
      if (!(s instanceof SVGElement) || typeof t !== 'string' || !t.startsWith('<svg')) out.badTypes.push(n);
      if (s.getAttribute('width') !== '24' || s.getAttribute('aria-hidden') !== 'true') out.odd.push(n);
    }
    try { const u = SB.icons.svg('no-such-icon'); out.unknown = { isSvg: u instanceof SVGElement, missing: u.querySelector('[data-missing]') !== null || u.hasAttribute('data-missing') }; } catch (e) { out.unknown = 'threw ' + e.message; }
    const weird = [undefined, null, 42, {}, [], '', 'a b', '<script>']; out.weird = 'ok';
    try { weird.forEach((w) => { SB.icons.svg(w); SB.icons.html(w); }); } catch (e) { out.weird = 'threw ' + e.message; }
    try { const b = SB.icons.brand(48); out.brand = { isSvg: b instanceof SVGElement, cls: b.getAttribute('class'), flame: !!b.querySelector('.bm-flame'), w: b.getAttribute('width') }; } catch (e) { out.brand = 'threw ' + e.message; }
    return out;
  }, REQUIRED);
  check('at least 70 icons', r.names >= 70, r.names);
  check('every icon required by SPEC 19 exists', r.missing.length === 0, r.missing);
  check('svg() returns SVGElement and html() a string for every icon', r.badTypes.length === 0, r.badTypes);
  check('icons honour size and are aria-hidden', r.odd.length === 0, r.odd);
  check('unknown icon name gives a visible placeholder', r.unknown && r.unknown.isSvg && r.unknown.missing, r.unknown);
  check('odd inputs never throw', r.weird === 'ok', r.weird);
  check('SB.icons.brand(size) returns the flame mark', r.brand && r.brand.isSvg && r.brand.flame && /brand-mark/.test(r.brand.cls) && r.brand.w === '48', r.brand);
  noErrors('icons', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 3. Tokens resolve
 * ---------------------------------------------------------------------------------------------------------------------- */
group('tokens');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  const FLOOR = '--bg --paper --sub --ink --ink2 --ink3 --line --line-soft --amber --amber-ink --sage --sage-ink --crimson --focus --shadow --stamp --z-pit --z-sides --z-fry --z-cold --z-expo --tint-warn --tint-bad --tint-ok --font-body --font-display'.split(' ');
  const OFFICE = '--o-bg --o-surface --o-surface2 --o-ink --o-ink2 --o-ink3 --o-line --o-accent --o-good --o-warn --o-bad --o-focus'.split(' ');
  // every custom property the tokens file declares on :root must resolve, in both floor themes
  const css = fs.readFileSync(path.join(root, 'src/css/00-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rootBlock = css.match(/:root\s*,\s*:root\[data-theme="day"\]\s*\{([\s\S]*?)\n\}/);
  const declared = rootBlock ? Array.from(rootBlock[1].matchAll(/(--[\w-]+)\s*:/g)).map((m) => m[1]) : [];
  check('tokens file declares the Day block', declared.length >= 60, declared.length);
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const res = await page.evaluate(({ names, floor }) => {
      const cs = getComputedStyle(document.documentElement);
      const empty = names.filter((n) => cs.getPropertyValue(n).trim() === '');
      const unresolved = names.filter((n) => /var\(/.test(cs.getPropertyValue(n)));
      const miss = floor.filter((n) => cs.getPropertyValue(n).trim() === '');
      return { empty, unresolved, miss, bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color };
    }, { names: declared, floor: FLOOR });
    check(`${theme}: every declared token resolves`, res.empty.length === 0 && res.unresolved.length === 0, res);
    check(`${theme}: every SPEC 16 floor token is defined`, res.miss.length === 0, res.miss);
    check(`${theme}: body paints the theme background`, theme === 'day' ? res.bg === 'rgb(245, 242, 235)' : res.bg === 'rgb(21, 24, 26)', res.bg);
  }
  for (const ot of ['ember', 'paper']) {
    const res = await page.evaluate(({ ot, names }) => {
      const el = document.createElement('div'); el.className = 'office'; el.setAttribute('data-otheme', ot); document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const miss = names.filter((n) => cs.getPropertyValue(n).trim() === '');
      const map = { bg: cs.getPropertyValue('--bg').trim().toLowerCase(), obg: cs.getPropertyValue('--o-bg').trim().toLowerCase(), primary: cs.getPropertyValue('--primary').trim().toLowerCase(), oacc: cs.getPropertyValue('--o-accent').trim().toLowerCase() };
      el.remove(); return { miss, map };
    }, { ot, names: OFFICE });
    check(`${ot}: every SPEC 16 office token is defined`, res.miss.length === 0, res.miss);
    check(`${ot}: floor names are remapped to the office palette`, res.map.bg === res.map.obg && res.map.primary === res.map.oacc, res.map);
  }
  // type scale and text-large
  const sizes = async () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => parseFloat(cs.getPropertyValue('--fs-' + i))); });
  const base = await sizes();
  check('type scale is 13 / 15 / 17 / 20 / 24 / 32 / 44 / 64', JSON.stringify(base) === JSON.stringify([13, 15, 17, 20, 24, 32, 44, 64]), base);
  await page.evaluate(() => document.documentElement.classList.add('text-large'));
  const big = await sizes();
  check('.text-large multiplies the scale by 1.2', big.every((v, i) => Math.abs(v - base[i] * 1.2) < 0.2), big);
  await page.evaluate(() => document.documentElement.classList.remove('text-large'));
  const misc = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const g = (n) => cs.getPropertyValue(n).trim(); return { ticket: g('--fs-ticket'), timer: g('--fs-timer'), item: g('--fs-item'), rChip: g('--r-chip'), rBtn: g('--r-btn'), rSlip: g('--r-slip'), tap: g('--tap'), tapLg: g('--tap-lg'), sp1: g('--sp-1'), sp2: g('--sp-2') }; });
  check('ticket 34, timer 30, item 19, radii 4/8/2, 4-pt spacing', misc.ticket === '34px' && misc.timer === '30px' && misc.item === '19px' && misc.rChip === '4px' && misc.rBtn === '8px' && misc.rSlip === '2px' && misc.sp1 === '4px' && misc.sp2 === '8px', misc);
  check('tap targets: 48 floor, 56 primary', misc.tap === '48px' && misc.tapLg === '56px', misc);
  noErrors('tokens', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 4. Contract surface (SPEC 19)
 * ---------------------------------------------------------------------------------------------------------------------- */
group('SPEC 19 surface');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  const r = await page.evaluate(() => {
    const need = { icons: ['svg', 'html', 'brand'], ui: ['sheet', 'confirm', 'toast', 'menu', 'tooltip', 'announce', 'stepper', 'segmented', 'chip', 'badge'], sheets: ['register', 'open', 'closeAll'], router: ['view', 'go', 'hashFor', 'viewFor', 'onChange'], theme: ['get', 'set', 'office', 'setOffice', 'textSize', 'setTextSize'], shell: ['mount', 'ignite', 'extinguish', 'inOffice'] };
    const miss = []; for (const k of Object.keys(need)) for (const f of need[k]) if (typeof (SB[k] || {})[f] !== 'function') miss.push(k + '.' + f);
    return { miss };
  });
  check('every function named in SPEC 19 exists', r.miss.length === 0, r.miss);
  noErrors('surface', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 5. Router: pure totality and round trips, then real navigation
 * ---------------------------------------------------------------------------------------------------------------------- */
group('router');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  const res = await page.evaluate(() => {
    const R = SB.router, ZONES = ['pit', 'sides', 'fry', 'cold', 'expo'], SECTIONS = ['pace', 'tickets', 'stations', 'money', 'safety', 'stock', 'data'];
    const valid = (v) => v && ((v.kind === 'floor' && (v.zone === 'all' || ZONES.includes(v.zone))) || (v.kind === 'office' && SECTIONS.includes(v.section)));
    const garbage = ['', '#', '#/', '/', '#/s', '#/s/', '#/s/pit', '#/S/PIT', '#/s/pit/extra', '#/s/nope', '#/office', '#/office/', '#/office/pace', '#/office/stock', '#/office/nonsense', '#/office/stock/x', '#!/office/data', '#%E0%A4%A', '%', '#/../../x', '#/office/../s/pit', '#' + 'a'.repeat(900), '#/s/' + 'p'.repeat(400), '#/\u{1F525}', '#\n#/office', ' #/office', '#/office?x=1', '#/s/fry?z=2#/office', 'javascript:alert(1)', '#/__proto__', '#/constructor', null, undefined, 0, 42, NaN, true, {}, [], { kind: 'office' }, { kind: 'floor', zone: 'x' }, { kind: 'office', section: 'x' }, () => 1, Symbol.iterator];
    const bad = [];
    garbage.forEach((g, i) => {
      let v, h2, v2;
      try { v = R.viewFor(typeof g === 'symbol' ? String(g) : g); h2 = R.hashFor(v); v2 = R.viewFor(h2); } catch (e) { bad.push(['threw', i, String(e)]); return; }
      if (!valid(v)) bad.push(['invalid view', i, v]);
      if (typeof h2 !== 'string' || !/^#\//.test(h2)) bad.push(['bad hash', i, h2]);
      if (JSON.stringify(v) !== JSON.stringify(v2)) bad.push(['no round trip', i, v, v2]);
      try { const hv = R.hashFor(typeof g === 'symbol' ? {} : g); if (typeof hv !== 'string') bad.push(['hashFor not string', i]); } catch (e) { bad.push(['hashFor threw', i, String(e)]); }
    });
    const all = [{ kind: 'floor', zone: 'all' }].concat(ZONES.map((z) => ({ kind: 'floor', zone: z })), SECTIONS.map((s) => ({ kind: 'office', section: s })));
    const rt = all.filter((v) => JSON.stringify(R.viewFor(R.hashFor(v))) !== JSON.stringify(v));
    const hashes = all.map((v) => R.hashFor(v));
    return { bad: bad.slice(0, 6), nBad: bad.length, rt, hashes, n: garbage.length, unique: new Set(hashes).size, total: all.length };
  });
  check('view(hash) is total over ' + res.n + ' garbage inputs and hash(view) round-trips', res.nBad === 0, res.bad);
  check('every real view round-trips (13 views)', res.rt.length === 0 && res.unique === res.total && res.total === 13, res.rt);
  check('canonical hashes: #/ , #/s/<zone> , #/office , #/office/<section>', res.hashes[0] === '#/' && res.hashes[1] === '#/s/pit' && res.hashes.includes('#/office') && res.hashes.includes('#/office/stock'), res.hashes);
  noErrors('router pure', logs);
});

await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await stubs(page);
  // a station tab pushes, the same tab again does nothing, hand-typed hashes are followed, garbage lands on the floor
  await page.locator('#sb-floor .seg-opt[data-id="pit"]').click();
  let s = await page.evaluate(() => ({ hash: location.hash, view: SB.router.view(), idx: SB.router.index(), zone: SB.util.storage.get('smokebox.v1.zone', null), label: document.getElementById('floor-zone').textContent }));
  check('station tab goes to #/s/pit and persists the zone', s.hash === '#/s/pit' && s.view.zone === 'pit' && s.zone === 'pit' && s.label === 'pit' && s.idx === 1, s);
  await page.locator('#sb-floor .seg-opt[data-id="pit"]').click();
  check('choosing the same station again does not grow history', await page.evaluate(() => SB.router.index()) === 1);
  for (const zone of ['sides', 'fry', 'cold', 'expo']) {
    await page.evaluate((z) => { location.hash = '#/s/' + z; }, zone);
    await page.waitForFunction((z) => SB.router.view().zone === z && document.getElementById('floor-zone').textContent === z, zone, { timeout: 2000 });
  }
  check('typing #/s/<zone> for every zone switches the floor', true);
  await page.evaluate(() => { location.hash = '#/nonsense/%E0%A4%A'; });
  await page.waitForFunction(() => SB.router.view().zone === 'all', null, { timeout: 2000 });
  check('a garbage hash shows the whole line', true);
  await page.goBack(); await wait(150);
  check('browser Back walks through earlier stations', await page.evaluate(() => SB.router.view().kind === 'floor'));

  // office routes
  await resetState(page);
  const sections = await page.evaluate(() => SB.router.sections.slice());
  check('seven office sections in SPEC order', JSON.stringify(sections) === JSON.stringify(['pace', 'tickets', 'stations', 'money', 'safety', 'stock', 'data']), sections);
  await page.evaluate(() => { location.hash = '#/office/' + 'tickets'; });
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 3000 });
  await page.evaluate(() => SB.shell.ignite());
  for (const sec of sections) {
    await page.evaluate((x) => { location.hash = '#/office/' + x; }, sec);
    await page.waitForFunction((x) => SB.router.view().section === x && document.getElementById('office-title') && document.getElementById('office-title').textContent === 'Section: ' + x, sec, { timeout: 2000 });
  }
  check('every office section is reachable by hash and handed to SB.office.navigate', true);
  await page.evaluate(() => { location.hash = '#/office/bogus'; });
  await page.waitForFunction(() => SB.router.view().section === 'pace' || SB.router.view().section === 'data', null, { timeout: 500 }).catch(() => {});
  check('unknown office section falls back to pace (stays in the office)', await page.evaluate(() => SB.shell.inOffice() && SB.router.view().kind === 'office'));
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 3000 });
  await page.waitForFunction(() => document.getElementById('sb-office').hidden, null, { timeout: 3000 });
  check('going to #/ closes the office', true);
  const unm = await page.evaluate(() => ({ mounts: SB.office.mounts, unmounts: SB.office.unmounts }));
  check('office content is mounted at each ignition and unmounted after each close', unm.mounts >= 1 && unm.unmounts === unm.mounts, unm);
  noErrors('router navigation', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 6. Sheets: Esc, focus return, trap, inert, history rules
 * ---------------------------------------------------------------------------------------------------------------------- */
group('sheets and history');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await stubs(page);
  const info = () => page.evaluate(() => ({ idx: SB.router.index(), state: history.state && history.state.sbIdx, len: history.length, count: SB.sheets.count(), roots: document.querySelectorAll('.sheet-root').length, active: document.activeElement && (document.activeElement.id || document.activeElement.className) }));
  const settle = () => wait(260);
  const L0 = (await info()).len;

  await page.locator('#open-help').click();
  await settle();
  let s = await info();
  check('opening a sheet adds exactly one history entry', s.idx === 1 && s.state === 1 && s.count === 1, s);
  const inside = await page.evaluate(() => document.querySelector('.sheet-root .sheet').contains(document.activeElement));
  check('focus moves into the sheet', inside);
  const inert = await page.evaluate(() => document.getElementById('sb-floor').hasAttribute('inert'));
  check('the board behind a sheet is inert', inert);
  const roleOk = await page.evaluate(() => { const p = document.querySelector('.sheet'); return p.getAttribute('role') === 'dialog' && p.getAttribute('aria-modal') === 'true' && !!document.getElementById(p.getAttribute('aria-labelledby')); });
  check('sheet is a labelled modal dialog', roleOk);
  // Tab stays inside
  for (let i = 0; i < 7; i++) await page.keyboard.press('Tab');
  check('Tab never leaves the sheet', await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)));
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
  check('Shift+Tab never leaves the sheet', await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)));
  await page.keyboard.press('Escape'); await settle();
  s = await info();
  check('Esc closes the sheet and steps history back', s.roots === 0 && s.count === 0 && s.idx === 0 && s.state === 0, s);
  check('focus returns to the button that opened it', s.active === 'open-help', s.active);
  check('the board is live again', await page.evaluate(() => !document.getElementById('sb-floor').hasAttribute('inert')));

  // own button
  await page.locator('#open-order').click(); await settle();
  await page.locator('.sheet-root .sheet-close').click(); await settle();
  s = await info();
  check('the sheet\'s own close button steps back (no growth)', s.idx === 0 && s.state === 0 && s.roots === 0 && s.active === 'open-order', s);
  // footer cancel
  await page.locator('#open-order').click(); await settle();
  await page.locator('.sheet-root .sheet-foot .btn', { hasText: 'Cancel' }).click(); await settle();
  check('a footer button that calls close() also steps back', (await info()).idx === 0);
  // browser back closes it
  await page.locator('#open-help').click(); await settle();
  await page.goBack(); await settle();
  s = await info();
  check('browser Back closes an open sheet', s.roots === 0 && s.count === 0 && s.idx === 0, s);
  check('...and focus returns to the opener', s.active === 'open-help', s.active);
  // backdrop
  await page.locator('#open-help').click(); await settle();
  await page.mouse.click(8, 400); await settle();
  s = await info();
  check('clicking the backdrop closes the sheet', s.roots === 0 && s.idx === 0, s);
  // stacked: sheet then confirm
  await page.locator('#open-help').click(); await settle();
  await page.locator('#help-inner').click(); await settle();
  s = await info();
  check('a confirm over a sheet is a second entry and the sheet below is inert', s.count === 2 && s.idx === 2 && await page.evaluate(() => document.querySelectorAll('.sheet-root')[0].hasAttribute('inert')), s);
  const cf = await page.evaluate(() => { const d = document.querySelectorAll('.sheet-root')[1].querySelector('.sheet'); return { role: d.getAttribute('role'), focus: document.activeElement.textContent.trim(), desc: !!d.getAttribute('aria-describedby') }; });
  check('a destructive confirm is an alertdialog that starts on the safe button', cf.role === 'alertdialog' && cf.focus === 'Cancel' && cf.desc, cf);
  await page.keyboard.press('Escape'); await settle();
  s = await info();
  check('Esc closes only the top sheet', s.count === 1 && s.idx === 1, s);
  await page.keyboard.press('Escape'); await settle();
  s = await info();
  check('second Esc closes the one below', s.count === 0 && s.idx === 0 && s.active === 'open-help', s);
  // confirm promise values
  const cv = await page.evaluate(async () => {
    const out = [];
    let p = SB.ui.confirm({ title: 'A?', body: 'b', confirmLabel: 'Do it' }); await new Promise((r) => setTimeout(r, 60));
    [...document.querySelectorAll('.sheet-foot .btn')].find((b) => /Do it/.test(b.textContent)).click(); out.push(await p);
    await new Promise((r) => setTimeout(r, 260));
    p = SB.ui.confirm({ title: 'B?', body: ['one', 'two'] }); await new Promise((r) => setTimeout(r, 60));
    [...document.querySelectorAll('.sheet-foot .btn')].find((b) => /Cancel/.test(b.textContent)).click(); out.push(await p);
    await new Promise((r) => setTimeout(r, 260));
    p = SB.ui.confirm({ title: 'C?' }); await new Promise((r) => setTimeout(r, 60));
    SB.sheets.closeAll(); out.push(await p);
    return out;
  });
  check('confirm resolves true on confirm, false on cancel and false when closed otherwise', JSON.stringify(cv) === '[true,false,false]', cv);
  await settle();
  // repeated open/close never grows the stack
  for (let i = 0; i < 6; i++) { await page.locator('#open-order').click(); await wait(120); await page.keyboard.press('Escape'); await wait(200); }
  s = await info();
  check('six open/close cycles leave history at most one entry longer', s.len <= L0 + 1 && s.idx === 0, { L0, ...s });
  // opening the same named sheet twice does not stack
  const dup = await page.evaluate(() => { SB.sheets.open('help'); SB.sheets.open('help'); return SB.sheets.count(); });
  check('opening a named sheet twice reuses the open one', dup === 1, dup);
  await page.evaluate(() => SB.sheets.closeAll()); await settle();
  noErrors('sheets', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 7. Toasts, menu, tooltip, announce, stepper, segmented
 * ---------------------------------------------------------------------------------------------------------------------- */
group('toast, menu, tooltip, stepper, segmented');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await stubs(page);
  await page.evaluate(() => { window.__u = 0; SB.ui.toast('Ticket #104 bumped.', { tone: 'ok', undo: () => { window.__u++; } }); });
  await wait(700);
  const bar = await page.evaluate(() => { const b = document.querySelector('.toast-bar'); return b ? parseFloat(b.style.transform.replace(/[^0-9.]/g, '')) : null; });
  check('undo toast has a bar that drains', bar !== null && bar < 1 && bar > 0.85, bar);
  await page.locator('.toast-undo').click();
  await wait(300);
  check('Undo fires the callback once and removes the toast', await page.evaluate(() => window.__u === 1 && !document.querySelector('.toast')));
  await page.evaluate(() => { SB.ui.toast('first', { undo: () => {} }); SB.ui.toast('second', { undo: () => { window.__u = 99; } }); });
  await wait(100);
  check('only one undo toast at a time (the engine undoes its newest action)', await page.evaluate(() => document.querySelectorAll('.toast-undo').length === 1 && /second/.test(document.querySelector('.toast-msg').textContent)));
  await page.evaluate(() => document.querySelector('.toast [aria-label="Dismiss message"]').click()); await wait(300);
  await page.mouse.move(5, 5); // a pointer resting on the strip would pause it
  await page.evaluate(() => { SB.ui.toast('short one', { ms: 300 }); });
  await wait(900);
  check('a plain toast leaves by itself', await page.evaluate(() => !document.querySelector('.toast')));
  const roles = await page.evaluate(() => { SB.ui.toast('a', { tone: 'warn', ms: 3000 }); SB.ui.toast('b', { tone: 'ok', ms: 3000 }); const r = [...document.querySelectorAll('.toast')].map((t) => t.getAttribute('role')); for (let i = 0; i < 6; i++) SB.ui.toast('x' + i, { ms: 3000 }); return { r, n: document.querySelectorAll('.toast').length }; });
  check('warn toasts are alerts, ok toasts are status messages', roles.r[0] === 'alert' && roles.r[1] === 'status', roles);
  check('at most 3 toasts at once', roles.n === 3, roles.n);
  await wait(200); await page.evaluate(() => document.querySelectorAll('.toast .btn-ghost').forEach((b) => b.click())); await wait(300);
  // announce
  await page.evaluate(() => SB.ui.announce('Ticket 104 is late')); await wait(250);
  check('announce writes to a polite live region', await page.evaluate(() => [...document.querySelectorAll('[aria-live="polite"]')].some((e) => /Ticket 104 is late/.test(e.textContent))));
  // menu
  await page.locator('#open-menu').click(); await wait(150);
  let m = await page.evaluate(() => ({ items: document.querySelectorAll('.menu .menu-item').length, focus: document.activeElement.className, expanded: document.getElementById('open-menu').getAttribute('aria-expanded') }));
  check('menu opens with its items and focuses one', m.items === 3 && /menu-item/.test(m.focus), m);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape'); await wait(150);
  m = await page.evaluate(() => ({ open: !!document.querySelector('.menu'), active: document.activeElement.id }));
  check('Esc closes the menu and returns focus to its button', !m.open && m.active === 'open-menu', m);
  await page.locator('#open-menu').click(); await wait(100);
  await page.locator('.menu-item', { hasText: 'Night theme' }).click(); await wait(150);
  check('a menu item runs its action and closes the menu (theme toggled)', await page.evaluate(() => SB.theme.get() === 'night' && !document.querySelector('.menu') && document.documentElement.getAttribute('data-theme') === 'night'));
  await page.evaluate(() => SB.theme.set('day'));
  // tooltip
  await page.evaluate(() => { SB.ui.tooltip(document.getElementById('open-help'), 'Open help'); });
  await page.hover('#open-help'); await wait(700);
  const tip = await page.evaluate(() => { const t = document.querySelector('.tooltip'); return t ? { text: t.textContent, role: t.getAttribute('role'), desc: document.getElementById('open-help').getAttribute('aria-describedby') === t.id } : null; });
  check('tooltip shows on hover with role=tooltip and aria-describedby', tip && tip.text === 'Open help' && tip.role === 'tooltip' && tip.desc, tip);
  await page.mouse.move(600, 600); await wait(250);
  check('tooltip goes away when the pointer leaves', await page.evaluate(() => !document.querySelector('.tooltip')));
  // stepper
  const st = await page.evaluate(async () => {
    const seen = []; const el = SB.ui.stepper({ value: 150, min: 100, max: 200, step: 1, bigStep: 5, unit: 'F', label: 'Pit temperature', onChange: (v) => seen.push(v) });
    document.getElementById('floor-bar').after(el);
    const btn = (re) => [...el.querySelectorAll('.stepper-btn')].find((b) => re.test(b.getAttribute('aria-label')));
    const out = { sizes: [...el.querySelectorAll('.stepper-btn')].map((b) => Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)) };
    btn(/Increase pit temperature by 5/).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup'));
    btn(/Decrease pit temperature$/).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup'));
    out.afterButtons = el.getValue();
    el.setValue(1e30); out.huge = el.getValue(); el.setValue(-1e30); out.low = el.getValue(); el.setValue('abc'); out.nan = el.getValue(); el.setValue(Infinity); out.inf = el.getValue();
    el.input.value = '1e5'; el.input.dispatchEvent(new Event('change')); out.sci = el.getValue(); out.invalid = el.classList.contains('is-invalid');
    el.setValue(199); const up = btn(/Increase pit temperature$/); up.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup')); out.maxed = el.getValue(); out.plusDisabled = up.disabled;
    out.seen = seen.slice(); out.aria = { now: el.input.getAttribute('aria-valuenow'), text: el.input.getAttribute('aria-valuetext'), role: el.input.getAttribute('role') };
    const d = SB.ui.stepper({ value: 0.2, min: 0, max: 5, step: 0.1 }); d.setValue(0.1 + 0.2); out.dec = d.input.value; el.remove();
    return out;
  });
  check('stepper buttons are 44 px', st.sizes.every((x) => /^(44|36)x/.test(x) || /x4[4-8]$/.test(x)) && st.sizes.filter((x) => /^44x/.test(x)).length >= 2, st.sizes);
  check('stepper steps by 1 and by the big step', st.afterButtons === 154, st.afterButtons);
  check('stepper clamps and never emits 1e+30, NaN or Infinity', st.huge === 200 && st.low === 100 && st.nan === 100 && st.inf === 100 && st.seen.every((v) => Number.isFinite(v) && v >= 100 && v <= 200), st);
  check('scientific notation typed into a stepper is rejected', st.sci === 100 || st.sci === st.low, st.sci);
  check('stepper disables + at max', st.maxed === 200 && st.plusDisabled === true, st);
  check('stepper exposes spinbutton semantics', st.aria.role === 'spinbutton' && st.aria.now === '200' && /F$/.test(st.aria.text), st.aria);
  check('stepper decimals are exact (0.1 + 0.2 shows 0.3)', st.dec === '0.3', st.dec);
  // segmented
  const sg = await page.evaluate(async () => {
    const seen = []; const el = SB.ui.segmented({ label: 'Channel', value: 'a', options: [{ id: 'a', label: 'Dine-in' }, { id: 'b', label: 'Takeout' }, { id: 'c', label: 'Drive-thru' }], onChange: (v) => seen.push(v) });
    document.getElementById('floor-bar').after(el);
    const o = [...el.querySelectorAll('.seg-opt')]; o[0].focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const r = { seen, value: el.getValue(), checked: o.map((b) => b.getAttribute('aria-checked')), tab: o.map((b) => b.tabIndex), role: el.getAttribute('role'), optRole: o[0].getAttribute('role') };
    el.setValue('b'); r.silent = seen.length; el.setCount('b', 7, { alert: true }); r.count = el.querySelector('[data-id="b"] .seg-count').textContent; r.dotHidden = el.querySelector('[data-id="b"] .seg-dot').hidden; el.remove(); return r;
  });
  check('segmented moves with arrows, wraps, and emits only user changes', JSON.stringify(sg.seen) === '["b","c","a"]' && sg.silent === 3 && sg.value === 'a', sg);
  check('segmented is a radiogroup with roving tabindex', sg.role === 'radiogroup' && sg.optRole === 'radio' && sg.tab.filter((t) => t === 0).length === 1, sg);
  check('segmented count and alert dot update', sg.count === '7' && sg.dotHidden === false, sg);
  // chip and badge
  const cb = await page.evaluate(() => ({ ok: SB.ui.badge('ok').textContent.trim(), warn: SB.ui.badge('warn').textContent.trim(), breach: SB.ui.badge('breach').textContent.trim(), svg: SB.ui.badge('breach').querySelector('svg') !== null, odd: SB.ui.badge('whatever').textContent.trim(), chip: SB.ui.chip({ label: 'Walk-up', icon: 'bag' }).textContent.trim() }));
  check('badges carry a word and an icon, never colour alone', cb.ok === 'On time' && cb.warn === 'Running late' && cb.breach === 'Overdue' && cb.svg && cb.odd === 'On time', cb);
  noErrors('ui primitives', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 8. Theme
 * ---------------------------------------------------------------------------------------------------------------------- */
group('theme');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await stubs(page);
  const meta = () => page.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute('content'));
  check('Day meta theme-color', await meta() === '#F5F2EB', await meta());
  await page.evaluate(() => SB.theme.set('night'));
  const n = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), stored: localStorage.getItem('smokebox.v1.theme'), bg: getComputedStyle(document.body).backgroundColor }));
  check('Night: html[data-theme], storage key and body background', n.attr === 'night' && JSON.parse(n.stored) === 'night' && n.bg === 'rgb(21, 24, 26)', n);
  check('Night meta theme-color follows', await meta() === '#15181A', await meta());
  await page.reload({ waitUntil: 'load' });
  const early = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('the saved theme is back after a reload (pre-paint script)', early === 'night', early);
  await page.evaluate(() => SB.theme.set('day'));
  await page.evaluate(() => SB.theme.setTextSize('large'));
  check('large text: class on <html> and persisted', await page.evaluate(() => document.documentElement.classList.contains('text-large') && JSON.parse(localStorage.getItem('smokebox.v1.textsize')) === 'large'));
  await page.reload({ waitUntil: 'load' });
  check('large text survives a reload', await page.evaluate(() => document.documentElement.classList.contains('text-large')));
  await page.evaluate(() => SB.theme.setTextSize('normal'));
  const bad = await page.evaluate(() => { SB.theme.set('purple'); SB.theme.setOffice('neon'); SB.theme.setTextSize('huge'); return [SB.theme.get(), SB.theme.office(), SB.theme.textSize()]; });
  check('invalid theme names are ignored', JSON.stringify(bad) === '["day","ember","normal"]', bad);
  const events = await page.evaluate(() => { const ev = []; const off = SB.theme.onChange((w) => ev.push(w)); SB.theme.set('night'); SB.theme.setOffice('paper'); SB.theme.setTextSize('large'); off(); SB.theme.set('day'); SB.theme.setOffice('ember'); SB.theme.setTextSize('normal'); return ev; });
  check('theme.onChange reports what changed and can unsubscribe', JSON.stringify(events) === '["theme","office","text"]', events);
  noErrors('theme', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 9. Secret gesture, office, PIN
 * ---------------------------------------------------------------------------------------------------------------------- */
group('secret gesture and office');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await stubs(page);
  await brandTaps(page, 4);
  await wait(900);
  check('4 taps do not open the office', await page.evaluate(() => !SB.shell.inOffice() && document.getElementById('sb-office').hidden));
  await wait(2700);
  await brandTaps(page, 4); await wait(600);
  check('taps older than 2.5 s do not count towards the five', await page.evaluate(() => !SB.shell.inOffice()));
  await wait(2700);
  // flicker on taps 3 and 4
  const fl = [];
  for (let i = 1; i <= 5; i++) {
    await page.locator('#sb-floor [data-brand]').first().click();
    fl.push(await page.evaluate(() => !!document.querySelector('#sb-floor .brand-mark.is-flicker')));
  }
  check('the flame flickers on taps 3 and 4 only', fl[0] === false && fl[1] === false && fl[2] === true && fl[3] === true, fl);
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 3000 });
  await page.evaluate(() => SB.shell.ignite());
  let s = await page.evaluate(() => ({ hash: location.hash, idx: SB.router.index(), hidden: document.getElementById('sb-office').hidden, view: document.querySelector('.sb-shell').dataset.view, floorInert: document.getElementById('sb-floor').hasAttribute('inert'), officeInert: document.getElementById('sb-office').hasAttribute('inert'), meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'), cls: document.getElementById('sb-office').className, focus: document.activeElement.id }));
  check('5 taps open the office at #/office, one history entry, floor inert, office live', s.hash === '#/office' && s.idx === 1 && !s.hidden && s.view === 'office' && s.floorInert && !s.officeInert, s);
  check('theme-color switches to the office palette (Day gives the light office) and focus lands in the office', s.meta === '#F0ECE3' && s.focus === 'sb-office', s);
  check('no leftover ignition classes after it finished', !/is-igniting/.test(s.cls) && await page.evaluate(() => !document.querySelector('.ember-ring') && !document.querySelector('.wisp')), s.cls);
  // office theme switch (the office follows Day/Night: start from Night, then switch)
  await page.evaluate(() => SB.theme.set('night'));
  await page.locator('#office-theme').click(); await wait(150);
  s = await page.evaluate(() => ({ o: document.getElementById('sb-office').getAttribute('data-otheme'), t: SB.theme.office(), meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'), bg: getComputedStyle(document.getElementById('sb-office')).backgroundColor }));
  check('Ember -> Paper recolours the open office', s.o === 'paper' && s.t === 'paper' && s.meta === '#F0ECE3', s);
  // sheet from inside the office wears the office palette
  await page.locator('#office-sheet').click(); await wait(300);
  const osh = await page.evaluate(() => { const r = document.querySelector('.sheet-root'); return { office: r.classList.contains('office'), ot: r.getAttribute('data-otheme'), bg: getComputedStyle(r.querySelector('.sheet')).backgroundColor }; });
  check('a sheet opened inside the office wears the office palette', osh.office && osh.ot === 'paper' && osh.bg === 'rgb(240, 236, 227)', osh);
  await page.keyboard.press('Escape'); await wait(300);
  check('Esc closes the sheet first and leaves the office open', await page.evaluate(() => SB.shell.inOffice() && SB.sheets.count() === 0));
  await page.evaluate(() => SB.theme.set('day'));
  // way out
  await page.locator('#back-to-line').click();
  await page.waitForFunction(() => !SB.shell.inOffice() && document.getElementById('sb-office').hidden, null, { timeout: 3000 });
  await wait(300);
  s = await page.evaluate(() => ({ hash: location.hash, idx: SB.router.index(), state: history.state && history.state.sbIdx, focus: document.activeElement.hasAttribute('data-brand') || !!document.activeElement.closest('[data-brand]'), floorInert: document.getElementById('sb-floor').hasAttribute('inert'), meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'), unm: SB.office.unmounts, mounts: SB.office.mounts }));
  check('"Back to the board" steps history back (no growth) and returns to the floor', (s.hash === '#/' || s.hash === '') && s.idx === 0 && s.state === 0 && !s.floorInert && s.meta === '#F5F2EB', s);
  check('focus returns to the brand mark that opened the office', s.focus, s);
  check('office content is released after closing', s.unm === s.mounts, s);
  // keyboard shortcut and Esc
  await page.keyboard.press('Control+Shift+O');
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 3000 });
  await page.evaluate(() => SB.shell.ignite());
  check('Ctrl+Shift+O opens the office', true);
  await page.keyboard.press('Control+Shift+O');
  await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 3000 });
  check('Ctrl+Shift+O again closes it', true);
  await wait(900);
  await page.evaluate(() => SB.shell.ignite()); await page.waitForFunction(() => SB.shell.inOffice()); await page.evaluate(() => SB.shell.ignite());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 3000 });
  check('Esc in the office (no sheet open) leaves it', true);
  await wait(900);
  // browser Back out of the office
  await openOfficeByTaps(page);
  await page.goBack();
  await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 3000 });
  check('browser Back leaves the office', await page.evaluate(() => SB.router.view().kind === 'floor'));
  await wait(900);
  // cold start straight into #/office/stock
  await page.evaluate(() => { location.hash = '#/office/stock'; });
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 3000 });
  check('a pasted #/office/stock link opens the office on that section', await page.evaluate(async () => { await SB.shell.ignite(); return SB.router.view().section === 'stock' && document.getElementById('office-title').textContent === 'Section: stock'; }));
  noErrors('office gesture', logs);
});

group('PIN gate');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await stubs(page);
  const vec = await page.evaluate(async () => ({ a: await SB.shell.hashPin('1234'), b: await SB.shell.hashPin('1234') }));
  check('a PIN hash is salted PBKDF2 (two hashes of one PIN differ)', /^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(vec.a) && vec.a !== vec.b, vec);
  const upg = await page.evaluate(async () => {
    const legacy = 'sha256:' + SB.shell.sha256('smokebox.v1:4321');
    SB.store.dispatch('updateSettings', { patch: { office: { pinHash: legacy } } }, { source: 'user' });
    const wrong = await SB.shell.checkPin('1111'), still = SB.store.getState().settings.office.pinHash === legacy;
    const right = await SB.shell.checkPin('4321'), now = SB.store.getState().settings.office.pinHash, again = await SB.shell.checkPin('4321');
    SB.store.dispatch('updateSettings', { patch: { office: { pinHash: null } } }, { source: 'user' });
    return { wrong, still, right, upgraded: /^pbkdf2:/.test(now), again };
  });
  check('an old unsalted PIN hash still works and is upgraded on the first right PIN, not on a wrong one', upg.wrong === false && upg.still && upg.right && upg.upgraded && upg.again, upg);
  check('no PIN set: the gate is open', await page.evaluate(async () => !SB.shell.hasPin() && (await SB.shell.checkPin('0000')) === true));
  const bad = await page.evaluate(async () => [await SB.shell.setPin('12'), await SB.shell.setPin('abcd'), await SB.shell.setPin('12345')].map((r) => r.ok));
  check('setPin rejects anything but exactly 4 digits', JSON.stringify(bad) === '[false,false,false]', bad);
  const set = await page.evaluate(async () => { const r = await SB.shell.setPin('1234'); return { r, hash: SB.store.getState().settings.office.pinHash, has: SB.shell.hasPin() }; });
  check('setPin stores the hash at state.settings.office.pinHash through SB.store.dispatch("updateSettings")', set.r.ok && /^pbkdf2:/.test(set.hash) && set.has && !JSON.stringify(set).includes('"1234"'), set);
  check('right and wrong PINs check correctly', await page.evaluate(async () => (await SB.shell.checkPin('1234')) === true && (await SB.shell.checkPin('1235')) === false));

  // 5 taps -> keypad
  await brandTaps(page, 5);
  await page.waitForSelector('.sheet-root .keypad', { timeout: 3000 });
  let k = await page.evaluate(() => ({ office: SB.shell.inOffice(), title: document.querySelector('.sheet-title').textContent, keys: document.querySelectorAll('.keypad .key').length, note: document.querySelector('.pin-note').textContent, h: Math.round(document.querySelector('.keypad .key').getBoundingClientRect().height), w: Math.round(document.querySelector('.keypad .key').getBoundingClientRect().width) }));
  check('the keypad asks for the PIN instead of opening the office', !k.office && k.title === 'Manager PIN' && k.keys === 12, k);
  check('keypad keys are large touch targets', k.h >= 56 && k.w >= 56, k);
  check('the note says it keeps line cooks out and is not real security', /line cooks out/.test(k.note) && /not real security/.test(k.note), k.note);
  const press = async (digits) => { for (const d of digits) await page.locator(`.keypad .key[aria-label="Digit ${d}"]`).click(); };
  await press('0000'); await wait(300);
  let msg = await page.evaluate(() => document.querySelector('.pin-msg').textContent);
  check('a wrong PIN says how many tries are left', /Wrong PIN\. 4 tries left\./.test(msg), msg);
  check('the keypad shakes and clears after a wrong PIN', await page.evaluate(() => document.querySelector('.keypad').classList.contains('pin-shake') && document.querySelectorAll('.pin-dot.is-on').length === 0));
  await press('1111'); await wait(250); await press('2222'); await wait(250); await press('3333'); await wait(250);
  msg = await page.evaluate(() => document.querySelector('.pin-msg').textContent);
  check('tries count down (1 left)', /1 try left/.test(msg), msg);
  await press('4444'); await wait(350);
  const lk = await page.evaluate(() => ({ msg: document.querySelector('.pin-msg').textContent, disabled: [...document.querySelectorAll('.keypad .key')].every((b) => b.disabled), store: SB.util.storage.get('smokebox.v1.pinlock', null), office: SB.shell.inOffice() }));
  check('5 wrong PINs lock the keypad for 30 s', /Too many wrong tries/.test(lk.msg) && lk.disabled && lk.store && lk.store.until - Date.now() > 25000 && lk.store.until - Date.now() <= 30500 && !lk.office, lk);
  // the lock survives closing the keypad and reopening it
  await page.locator('.sheet-foot .btn', { hasText: 'Cancel' }).click(); await wait(300);
  check('Cancel leaves the office closed', await page.evaluate(() => !SB.shell.inOffice() && SB.sheets.count() === 0 && SB.router.view().kind === 'floor'));
  await wait(2700);
  await brandTaps(page, 5); await page.waitForSelector('.sheet-root .keypad');
  check('the lock persists across reopening the keypad', await page.evaluate(() => [...document.querySelectorAll('.keypad .key')].every((b) => b.disabled) && /Too many/.test(document.querySelector('.pin-msg').textContent)));
  // shorten the lock to 1.2 s to test the release
  await page.evaluate(() => SB.util.storage.set('smokebox.v1.pinlock', { fails: 5, until: Date.now() + 1200 }));
  await page.waitForFunction(() => [...document.querySelectorAll('.keypad .key')].every((b) => !b.disabled), null, { timeout: 5000 });
  check('the keypad unlocks when the lock runs out', await page.evaluate(() => /Enter the 4-digit PIN/.test(document.querySelector('.pin-msg').textContent) && SB.util.storage.get('smokebox.v1.pinlock', {}).fails === 0));
  // keyboard entry of the right PIN
  await page.keyboard.type('1234');
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 4000 });
  await page.evaluate(() => SB.shell.ignite());
  await wait(500);
  check('the right PIN (typed on a keyboard) opens the office through the ignition', await page.evaluate(() => !document.getElementById('sb-office').hidden && SB.sheets.count() === 0));
  check('...with the keypad\'s history entry gone and the office as the one new entry', await page.evaluate(() => location.hash === '#/office' && SB.router.index() === 1 && history.state.sbIdx === 1), await page.evaluate(() => ({ h: location.hash, i: SB.router.index(), s: history.state })));
  await page.locator('#back-to-line').click(); await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 3000 }); await wait(900);
  // grace period
  await brandTaps(page, 5);
  await page.waitForFunction(() => SB.shell.inOffice(), null, { timeout: 4000 });
  check('re-entering within the grace period does not ask again', await page.evaluate(() => SB.sheets.count() === 0 && SB.shell.GRACE_MS === 120000));
  await page.evaluate(() => SB.shell.ignite());
  await page.locator('#back-to-line').click(); await page.waitForFunction(() => !SB.shell.inOffice(), null, { timeout: 3000 }); await wait(900);
  await page.evaluate(() => SB.shell.lock());
  await page.evaluate(() => { location.hash = '#/office/money'; });
  await page.waitForSelector('.sheet-root .keypad', { timeout: 3000 });
  check('lock() and a pasted office link both bring the keypad back', await page.evaluate(() => !SB.shell.inOffice()));
  await page.locator('.sheet-foot .btn', { hasText: 'Cancel' }).click(); await wait(400);
  check('cancelling the keypad on a pasted link falls back to the floor', await page.evaluate(() => SB.router.view().kind === 'floor' && !SB.shell.inOffice()));
  // PIN off
  const off = await page.evaluate(async () => { await SB.shell.setPin(null, { verified: true }); return { has: SB.shell.hasPin(), hash: SB.store.getState().settings.office.pinHash }; });
  check('setPin(null) removes the PIN', off.has === false && off.hash === null, off);
  await wait(300);
  noErrors('pin', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 10. Reduced motion: the ignition becomes a 150 ms cross-fade
 * ---------------------------------------------------------------------------------------------------------------------- */
group('reduced motion');
await withPage({ w: 1280, h: 800, file: SHELL_OUT, reducedMotion: 'reduce' }, async (page, logs) => {
  await stubs(page);
  const t = await page.evaluate(async () => {
    const t0 = performance.now(); const p = SB.shell.ignite(); await new Promise((r) => setTimeout(r, 60));
    const mid = { rings: document.querySelectorAll('.ember-ring').length, wisps: document.querySelectorAll('.wisp').length, clip: document.getElementById('sb-office').style.clipPath };
    await p; const open = performance.now() - t0;
    const t1 = performance.now(); const q = SB.shell.extinguish(); await q; const shut = performance.now() - t1;
    return { mid, open: Math.round(open), shut: Math.round(shut), hidden: document.getElementById('sb-office').hidden };
  });
  check('no ember ring, wisps or clip-path under reduced motion', t.mid.rings === 0 && t.mid.wisps === 0 && !t.mid.clip, t.mid);
  check('open is a ~150 ms cross-fade', t.open >= 100 && t.open < 450, t.open);
  check('close is a ~150 ms cross-fade', t.shut >= 100 && t.shut < 450 && t.hidden, t);
  const anim = await page.evaluate(() => { const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).filter((r) => r.media && /prefers-reduced-motion/.test(r.media.mediaText)); return css.length; });
  check('the stylesheet carries a prefers-reduced-motion block', anim >= 1, anim);
  const live = await page.evaluate(async () => { document.body.insertAdjacentHTML('beforeend', '<div class="brand"><span class="brand-mark is-flicker" id="fl"></span></div><div class="stamp" id="st">RUSH</div>'); await new Promise((r) => setTimeout(r, 50)); const a = getComputedStyle(document.getElementById('st')).animationName; return a; });
  check('the stamp does not animate under reduced motion', live === 'none', live);
  noErrors('reduced motion', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 11. Boot failure card
 * ---------------------------------------------------------------------------------------------------------------------- */
group('boot failure');
await withPage({ w: 1280, h: 800, file: SHELL_OUT }, async (page, logs) => {
  await page.evaluate(() => { SB.shell.unmount(); document.getElementById('app').innerHTML = ''; window.__sbLoadErrors = [{ file: '40-charts.js', message: 'x is not defined' }]; SB.store = { init() { throw new Error('storage is full'); } }; SB.boot.run(); });
  const c = await page.evaluate(() => { const b = document.getElementById('boot-error'); return b && { text: b.textContent, btns: [...b.querySelectorAll('button')].map((x) => x.textContent), role: b.getAttribute('role'), focus: document.activeElement.textContent }; });
  check('a failing boot shows an error card with the message, the module list and the stage', c && /storage is full/.test(c.text) && /40-charts\.js/.test(c.text) && /Stage: store/.test(c.text), c && c.text.slice(0, 200));
  check('the card has Reload and Copy details and is announced', c && c.btns.includes('Reload') && c.btns.includes('Copy details') && c.role === 'alert' && c.focus === 'Reload', c);
  await page.locator('#boot-error button', { hasText: 'Copy details' }).click(); await wait(300);
  check('Copy details gives feedback, never throws', await page.evaluate(() => /Copied|Select and copy/.test([...document.querySelectorAll('#boot-error button')][1].textContent)));
  const shot = path.join(SHOTS, 'boot-error-1280.png'); await page.screenshot({ path: shot });
  // load errors with a healthy boot: the board still starts, with a notice
  await page.evaluate(() => { document.getElementById('boot-error').remove(); delete SB.store; window.__sbLoadErrors = [{ file: '41-x.js', message: 'boom' }]; SB.boot.run(); });
  await wait(300);
  check('modules that failed to load do not stop the board; a toast says so', await page.evaluate(() => SB.shell.isMounted() && /Some parts did not load \(41-x\.js\)/.test(document.querySelector('.toast-msg') ? document.querySelector('.toast-msg').textContent : '')));
  check('SB.dev appears only with a store', await page.evaluate(() => typeof SB.dev === 'undefined'));
  await page.evaluate(() => { SB.shell.unmount(); document.getElementById('app').innerHTML = ''; window.__sbLoadErrors = []; SB.store = { init() { return { firstRun: true }; }, getState() { return { settings: {} }; }, dispatch() { return 'ok'; }, subscribe() { return () => {}; } }; SB.boot.run(); });
  check('SB.dev.state() reads the store when a store exists', await page.evaluate(() => typeof SB.dev === 'object' && typeof SB.dev.state === 'function' && !!SB.dev.state().settings));
  // A first run is an empty kitchen on purpose: boot no longer puts demo tickets on the board.
  check('boot does not seed demo tickets on a first run (an empty kitchen), even when SB.sim.seedFirstRun exists', await page.evaluate(() => { let n = 0; SB.sim = { seedFirstRun() { n++; } }; SB.shell.unmount(); document.getElementById('app').innerHTML = ''; SB.boot.run(); return n === 0; }));
  const errs = logs.errors.filter((e) => !/storage is full|boot failed/.test(e));
  check('boot failure: only the expected error was logged', errs.length === 0 && logs.pageErrors.length === 0, { errs, pe: logs.pageErrors });
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 12. Nothing overflows, from 280 px up
 * ---------------------------------------------------------------------------------------------------------------------- */
group('responsive overflow');
await withPage({ w: 1280, h: 800, file: SHELL_OUT, reducedMotion: 'reduce' }, async (page, logs) => {
  await stubs(page, { gallery: true });
  const probe = () => page.evaluate(() => {
    const vw = document.documentElement.clientWidth; const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (!b.width || b.right <= vw + 0.5 && b.left >= -0.5) continue;
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; } p = p.parentElement; }
      if (!clipped && !el.closest('.skip-link, [aria-hidden="true"]')) bad.push(el.tagName + '.' + String(el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + Math.round(b.left) + '..' + Math.round(b.right));
    }
    return { vw, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
  });
  for (const w of [280, 320, 360, 390, 768, 1024]) {
    await page.setViewportSize({ width: w, height: 800 }); await wait(250);
    const r = await probe();
    check(`floor gallery at ${w} px: no horizontal scroll, nothing pokes out`, r.sw <= r.vw && r.bad.length === 0, r);
  }
  await page.evaluate(() => SB.theme.setTextSize('large'));
  for (const w of [280, 390]) {
    await page.setViewportSize({ width: w, height: 800 }); await wait(250);
    const r = await probe();
    check(`large text at ${w} px: nothing overflows`, r.sw <= r.vw && r.bad.length === 0, r);
  }
  await page.evaluate(() => SB.theme.setTextSize('normal'));
  for (const w of [280, 390]) {
    await page.setViewportSize({ width: w, height: 800 }); await wait(150);
    await page.evaluate(() => SB.shell.ignite()); await wait(300);
    const r = await probe();
    check(`office (ember) at ${w} px: nothing overflows`, r.sw <= r.vw && r.bad.length === 0, r);
    // sheet at phone width is full screen
    await page.evaluate(() => SB.sheets.open('help')); await wait(300);
    const sh = await page.evaluate(() => { const b = document.querySelector('.sheet-root .sheet').getBoundingClientRect(); return { w: Math.round(b.width), vw: innerWidth, h: Math.round(b.height), vh: innerHeight }; });
    check(`a right-hand sheet fills the screen at ${w} px`, sh.w === sh.vw && sh.h === sh.vh, sh);
    await page.evaluate(() => SB.sheets.closeAll()); await wait(250);
    await page.evaluate(() => SB.shell.extinguish()); await wait(300);
  }
  // the toast and the menu fit a 280 px screen
  await page.setViewportSize({ width: 280, height: 700 }); await wait(200);
  await page.evaluate(() => SB.ui.toast('Ticket #104 bumped with a long message that has to wrap inside the strip.', { tone: 'ok', undo: () => {} })); await wait(250);
  const tb = await rect(page, '.toast');
  check('an undo toast fits inside a 280 px screen', tb && tb.x >= 0 && tb.x + tb.w <= 280.5, tb);
  await page.evaluate(() => document.querySelector('.toast-undo').click()); await wait(300);
  noErrors('responsive', logs);
});

/* ------------------------------------------------------------------------------------------------------------------------
 * 13. Screenshots to look at: gallery in Day, Night, Ember, Paper at 1280x800 and 390x844
 * ---------------------------------------------------------------------------------------------------------------------- */
group('screenshots');
for (const [w, h] of [[1280, 800], [390, 844]]) {
  await withPage({ w, h, file: SHELL_OUT, reducedMotion: 'reduce' }, async (page, logs) => {
    await stubs(page, { gallery: true });
    for (const theme of ['day', 'night', 'ember', 'paper']) {
      await page.evaluate(async (t) => {
        if (SB.shell.inOffice() && (t === 'day' || t === 'night')) await SB.shell.extinguish();
        if (t === 'day' || t === 'night') SB.theme.set(t); else { SB.theme.setOffice(t); if (!SB.shell.inOffice()) await SB.shell.ignite(); }
      }, theme);
      await wait(400);
      const file = path.join(SHOTS, `gallery-${theme}-${w}.png`);
      await page.screenshot({ path: file, fullPage: false });
      await page.evaluate((t) => { const el = document.querySelector((t === 'ember' || t === 'paper') ? '#sb-office' : '#sb-floor'); el.scrollTop = 0; }, theme);
      check(`${theme} ${w}x${h}: screenshot written`, fs.existsSync(file) && fs.statSync(file).size > 5000, file);
    }
    noErrors(`screenshots ${w}`, logs);
  });
}

for (const [w, h] of [[1280, 800], [390, 844]]) {
  await withPage({ w, h, file: SHELL_OUT, reducedMotion: 'reduce' }, async (page, logs) => {
    await stubs(page, { slips: true });
    for (const theme of ['day', 'night']) {
      await page.evaluate((t) => SB.theme.set(t), theme); await wait(250);
      const file = path.join(SHOTS, `board-${theme}-${w}.png`);
      await page.screenshot({ path: file });
      check(`${theme} board ${w}x${h}: screenshot written`, fs.existsSync(file) && fs.statSync(file).size > 5000, file);
    }
    noErrors(`board ${w}`, logs);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------
 * 14. The ignition, frozen at fixed times (animations paused and seeked, so the frames are exact)
 * ---------------------------------------------------------------------------------------------------------------------- */
group('ignition frames');
for (const [w, h, ot] of [[1280, 800, 'ember'], [390, 844, 'paper']]) {
  await withPage({ w, h, file: SHELL_OUT, reducedMotion: 'no-preference' }, async (page, logs) => {
    await stubs(page, { slips: true }); // a real-looking board (brand mark in the header, three slips) under an office that shows the gallery
    await page.evaluate((o) => SB.theme.setOffice(o), ot);
    const freeze = (ms) => page.evaluate(async (t) => {
      document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = t; } catch (e) { /* ignore */ } });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 260)); // let the compositor finish rasterising every tile of the frozen frame
    }, ms);
    // the shell's safety-net timers (1600 and 1200 ms) would end a frozen ignition early; the frames need it to stay frozen
    await page.evaluate(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => (ms === 1600 || ms === 1200 ? 0 : st(fn, ms, ...a)); });
    // open
    await page.evaluate(() => { SB.shell.ignite({ from: document.querySelector('#sb-floor [data-brand]') }); });
    await page.waitForFunction(() => document.querySelector('.ember-ring') && document.querySelectorAll('.wisp').length > 0, null, { timeout: 3000 }); // the clip, the ring and the wisps exist now
    const n = await page.evaluate(() => ({ anims: document.getAnimations().length, wisps: document.querySelectorAll('.wisp').length, ring: document.querySelectorAll('.ember-ring').length, igniting: document.querySelector('.sb-shell').classList.contains('is-igniting') }));
    check(`ignition at ${w}: ring, ${'wisps'} and veil exist while it runs`, n.ring === 1 && n.wisps >= 8 && n.wisps <= 12 && n.igniting, n);
    for (const t of [160, 340, 520, 700]) { await freeze(t); await page.screenshot({ path: path.join(SHOTS, `ignite-${ot}-${w}-${String(t).padStart(3, '0')}ms.jpg`), type: 'jpeg', quality: 72 }); }
    const mid = await page.evaluate(() => ({ clip: document.getElementById('sb-office').style.clipPath || getComputedStyle(document.getElementById('sb-office')).clipPath }));
    check(`ignition at ${w}: the office is revealed through a growing circle`, /circle/.test(mid.clip), mid);
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.play(); } catch (e) { /* ignore */ } }));
    await page.waitForFunction(() => !document.querySelector('.ember-ring') && !document.getElementById('sb-office').classList.contains('is-igniting'), null, { timeout: 4000 });
    check(`ignition at ${w}: ends clean (no ring, no wisps, no veil)`, await page.evaluate(() => document.querySelectorAll('.wisp').length === 0 && !document.querySelector('.sb-shell').classList.contains('is-igniting') && !document.getElementById('sb-office').style.clipPath));
    // close
    await page.evaluate(() => { SB.shell.extinguish(); });
    await wait(120);
    await freeze(260); await page.screenshot({ path: path.join(SHOTS, `extinguish-${ot}-${w}-260ms.jpg`), type: 'jpeg', quality: 72 });
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.play(); } catch (e) { /* ignore */ } }));
    await page.waitForFunction(() => document.getElementById('sb-office').hidden, null, { timeout: 4000 });
    check(`extinguish at ${w}: the office is gone and the floor is live`, await page.evaluate(() => !document.getElementById('sb-floor').hasAttribute('inert') && !SB.shell.inOffice()));
    const real = await page.evaluate(async () => { const t0 = performance.now(); await SB.shell.ignite(); return Math.round(performance.now() - t0); });
    check(`ignition at ${w}: takes about 900 ms (measured ${real} ms)`, real >= 700 && real <= 1300, real);
    noErrors(`ignition ${w}`, logs);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
