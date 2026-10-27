/*
 * WHAT THIS FILE IS: The icon set, drawn as small SVG pictures (lines and shapes) on a 24 by 24 grid with
 *    round line ends, 2 px lines and the colour of the surrounding text. svg(name, opts) gives a page
 *    element, html(name, opts) gives markup text, brand(size, opts) draws the flame-in-a-box logo, has(name)
 *    and names() list what exists. An unknown name never throws: it draws a dashed empty square.
 * PARTS: gear and smoke helpers, the icon table D, small helpers, html, svg, brand.
 * USES: nothing. USED BY: 60-shell.js and every screen file.
 */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const I = (SB.icons = {});

  // Builds the outline of a gear as one path: centre (cx, cy), tooth tip radius rOut, tooth root radius rIn,
  // and a number of teeth. Done with maths, not typed by hand, so the teeth are even.
  function gearPath(cx, cy, rOut, rIn, teeth) {
    const pts = []; const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * step - Math.PI / 2;
      const w = step * 0.2, t = step * 0.34; // half widths of the tooth tip and root
      [[a - t, rIn], [a - w, rOut], [a + w, rOut], [a + t, rIn]].forEach(([ang, r]) => pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]));
    }
    return 'M' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
  }
  // Path text for a wavy smoke line starting at (x, y0) and rising by about h: a short S-curve, repeated
  // once.
  const wisp = (x, y0, h) => `M${x} ${y0}c-1.7-${h * 0.2} 1.7-${h * 0.35} 0-${h * 0.55}s1.7-${h * 0.35} 0-${h * 0.6}`;

  // The icon table. Each row is: icon name, then the shapes that draw it inside the 24 by 24 box (path,
  // circle
  // or rect elements as text). Example: "plus" is two lines crossing at the centre. Rows are grouped by use
  // below.
  // audit:data-start
  const D = {
    /* stations and channels */
    flame: '<path d="M12 2.8c.8 3.4 5.4 5.6 5.4 10.4a5.4 5.4 0 0 1-10.8 0c0-2 .9-3.4 1.9-4.4.3 1.5 1.1 2.3 2 2.6-.3-3.1.3-6.1 1.5-8.6z"/><path d="M12 20.4a2.2 2.2 0 0 1-2.2-2.2c0-1.3 1.1-1.9 2.2-3.1 1.1 1.2 2.2 1.8 2.2 3.1a2.2 2.2 0 0 1-2.2 2.2z"/>',
    pot: '<path d="M4 8.5h16"/><path d="M5.5 8.5v7.5a4 4 0 0 0 4 4h5a4 4 0 0 0 4-4V8.5"/><path d="M5.5 12H3M18.5 12H21"/><path d="M9 5.6c0-1.2 1-1.6 1-2.8M14 5.6c0-1.2 1-1.6 1-2.8"/>',
    fry: '<path d="M5.5 11.5h13l-1.5 9H7z"/><path d="M5.5 11.5q6.5 3 13 0"/><path d="M8.5 10.5L7.2 5.5M11.5 11L11 3.8M14.5 11l.8-6.8M17 10.5l1.4-4.5"/>',
    snow: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5L4.2 16.5"/><path d="M9.6 4.8L12 6.6l2.4-1.8M9.6 19.2L12 17.4l2.4 1.8"/>',
    bag: '<path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    plate: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.6"/>',
    car: '<path d="M4 16.5v-4l1.9-4.6A2 2 0 0 1 7.8 6.7h8.4a2 2 0 0 1 1.9 1.3l1.9 4.5v4"/><path d="M3 16.5h18"/><path d="M4 12.5h16"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.4"/><path d="M10.8 18.5h2.4"/>',

    /* actions */
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M7.8 12.4l3 3 5.4-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
    alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.3v.2"/>',
    'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.2"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 1.8"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    settings: '<path d="' + gearPath(12, 12, 9.8, 7.6, 8) + '"/><circle cx="12" cy="12" r="3"/>',
    sliders: '<path d="M4 6h5M15 6h5M4 12h1M11 12h9M4 18h9M19 18h1"/><circle cx="12" cy="6" r="2.2"/><circle cx="8" cy="12" r="2.2"/><circle cx="16" cy="18" r="2.2"/>',
    thermometer: '<path d="M10 14.2V5a2 2 0 0 1 4 0v9.2a4.2 4.2 0 1 1-4 0z"/><path d="M12 9.5v7.5"/>',
    shield: '<path d="M12 3l7.5 2.8v5.6c0 4.6-3.2 8-7.5 9.6-4.3-1.6-7.5-5-7.5-9.6V5.8z"/>',
    'shield-check': '<path d="M12 3l7.5 2.8v5.6c0 4.6-3.2 8-7.5 9.6-4.3-1.6-7.5-5-7.5-9.6V5.8z"/><path d="M8.8 12l2.4 2.4 4-4.6"/>',
    package: '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
    'chart-line': '<path d="M4 4v16h16"/><path d="M7.5 15.5l3.5-4.2 3 2.5L19.5 7.5"/>',
    'chart-bar': '<path d="M4 4v16h16"/><path d="M8.5 17v-4.5M12.5 17V8.5M16.5 17v-6.5"/>',
    gauge: '<path d="M4.5 16.5a7.8 7.8 0 1 1 15 0"/><path d="M12 15l3.6-4.8"/><circle cx="12" cy="15.5" r="1" />',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5.5M14 11v5.5"/>',
    edit: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14.5 6l3 3"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
    refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.2"/><path d="M18 3v4.2h-4.2"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.2"/><path d="M6 21v-4.2h4.2"/>',
    play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    'fast-forward': '<path d="M3.5 6l8 6-8 6zM12.5 6l8 6-8 6z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
    'volume-off': '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.8v2"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/><path d="M12 14.8v2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.6a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.1-2.5 3.8M12 17.4v.2"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14.3h9"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.8V20h12V9.8M10 20v-5.5h4V20"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M9.8 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-2.6 3.3M6.2 7.7C3.8 9.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M4 4l16 16"/>',
    'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
    'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'chevron-left': '<path d="M14.5 6l-6 6 6 6"/>',
    'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
    'chevron-up': '<path d="M6 14.5l6-6 6 6"/>',
    'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.2c3 0 4.8 1.8 4.8 4.6"/>',
    receipt: '<path d="M6 3h12v18l-2.2-1.6L13.6 21 12 19.6 10.4 21l-2.2-1.6L6 21z"/><path d="M9 8h6M9 12h6"/>',
    scale: '<path d="M12 4v16M6.5 20h11M5 7h14"/><path d="M5 7l-3 6.5a3.3 3.3 0 0 0 6 0zM19 7l-3 6.5a3.3 3.3 0 0 0 6 0z"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M9.5 3h5M12 3v3M18.5 6.5l1.2-1.2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4.5h11l-1.6 3.5 1.6 3.5H5"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    maximize: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    zap: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    filter: '<path d="M3.5 5h17l-6.5 8v6l-4-2v-4z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.2h.01M12 17.2h.01"/>',
    dollar: '<path d="M12 2.5v19"/><path d="M16.5 7.2c-.8-1.4-2.4-2-4.5-2-2.6 0-4.2 1.2-4.2 3.1 0 4.3 8.9 2.2 8.9 6.3 0 1.9-1.8 3.2-4.7 3.2-2.3 0-4-.8-4.8-2.4"/>',
    'trending-up': '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    'trending-down': '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    door: '<path d="M6 21V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V21"/><path d="M3.5 21h17"/><path d="M14.5 12.2v.01"/>',
    sparkle: '<path d="M11 3c.8 4.8 2.7 6.7 7.5 7.5-4.8.8-6.7 2.7-7.5 7.5-.8-4.8-2.7-6.7-7.5-7.5C8.3 9.7 10.2 7.8 11 3z"/><path d="M19 16.5v4M17 18.5h4"/>',
    smoke: '<path d="' + wisp(7, 20, 13) + '"/><path d="' + wisp(12, 20, 17) + '"/><path d="' + wisp(17, 20, 13) + '"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    stack: '<rect x="4" y="4" width="16" height="4.5" rx="1.2"/><rect x="4" y="9.8" width="16" height="4.5" rx="1.2"/><rect x="4" y="15.5" width="16" height="4.5" rx="1.2"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15.5H6.5A1.5 1.5 0 0 0 5 20z"/><path d="M5 20a1.5 1.5 0 0 0 1.5 1.5H19v-3"/>',

    /* extras the app uses beyond the contract list */
    ticket: '<path d="M3.5 7.5h17v3a1.8 1.8 0 0 0 0 3.6v3.4h-17v-3.4a1.8 1.8 0 0 0 0-3.6z"/><path d="M14.5 7.5v1.6M14.5 11.2v1.6M14.5 14.9v1.6"/>',
    pin: '<path d="M12 21.5s6.5-6 6.5-11.3a6.5 6.5 0 0 0-13 0C5.5 15.5 12 21.5 12 21.5z"/><circle cx="12" cy="10.2" r="2.4"/>',
    drop: '<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.6 12 3.2 12 3.2z"/>',
    backspace: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/>',
    save: '<path d="M5 3.5h11.5L20.5 7.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5v5h7v-5M7.5 20.5v-6h9v6"/>',
  };
  // audit:data-end
  /* The source above writes decimals with a trailing "00" to keep columns tidy; normalise so the DOM stays small. */
  const NAMES = Object.keys(D);
  for (const k of NAMES) D[k] = D[k].replace(/(\d)\.(\d*?)0+(?=\D)/g, (m, a, b) => (b ? a + '.' + b : a));

  const NS = 'http://www.w3.org/2000/svg';
  // Makes text safe inside an attribute value (the same job as SB.util.esc, repeated so this file needs
  // nothing else).
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The dashed empty square drawn when an icon name is not in the table.
  const MISSING = '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>';

  // Cleans the size (default 20) and line thickness (default 2) options. A missing, zero or negative
  // value falls back to the default. Returns { size, stroke }.
  function attrs(name, o) {
    o = o || {};
    const size = Number.isFinite(+o.size) && +o.size > 0 ? +o.size : 20;
    const stroke = Number.isFinite(+o.stroke) && +o.stroke > 0 ? +o.stroke : 2;
    return { size, stroke };
  }
  // True if an icon with exactly this name exists. Uses hasOwnProperty so a name like "constructor" is not
  // mistaken for one.
  I.has = (name) => Object.prototype.hasOwnProperty.call(D, name);
  // A copy of the list of every icon name.
  I.names = () => NAMES.slice();

  // Builds the icon as markup text: an svg element with the size, line thickness, optional class and, if a
  // title is given, a label for screen readers. An unknown name draws the dashed square and is marked
  // data-missing.
  I.html = function (name, opts) {
    const o = opts || {};
    const { size, stroke } = attrs(name, o);
    const known = I.has(name);
    const inner = known ? D[name] : MISSING;
    const cls = 'icon' + (o.class || o.className ? ' ' + esc(o.class || o.className) : '');
    const a11y = o.title ? `role="img" aria-label="${esc(o.title)}"` : 'aria-hidden="true" focusable="false"';
    return `<svg class="${cls}" xmlns="${NS}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${a11y} data-icon="${esc(name)}"${known ? '' : ` data-missing="${esc(name)}"`}>${o.title ? `<title>${esc(o.title)}</title>` : ''}${inner}</svg>`;
  };

  // The same icon as a real page element. Gives null when there is no page (Node tests).
  I.svg = function (name, opts) {
    const doc = g.document;
    if (!doc) return null;
    const holder = doc.createElementNS(NS, 'svg');
    holder.innerHTML = I.html(name, opts); // parse once through the HTML string so html() and svg() can never drift apart
    const el = holder.firstElementChild;
    return el;
  };

  // The logo: smoker box, flame and two smoke wisps. Gives a page element, or the markup text when there is
  // no page.
  // size defaults to 28; opts.accent sets the flame fill. Add the class is-flicker to make the flame
  // flicker.
  I.brand = function (size, opts) {
    const doc = g.document;
    const s = Number.isFinite(+size) && +size > 0 ? +size : 28;
    const accent = (opts && opts.accent) || 'var(--brand-accent, #B85C38)';
    const html = `<svg class="brand-mark" xmlns="${NS}" width="${s}" height="${s}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
<rect x="3.5" y="16" width="25" height="13" rx="2.6"/>
<path d="M8.5 21.200h.01M23.500 21.200h.01" stroke-width="3"/>
<path class="bm-wisp" d="M7.500 13c-1.600-1.600 1.400-2.600-.2-4.300" stroke-width="1.900" opacity=".75"/>
<path class="bm-wisp" d="M24.500 13c1.600-1.600-1.400-2.600.2-4.300" stroke-width="1.900" opacity=".75"/>
<g class="bm-flame"><path d="M16 3.800c.7 3 4.700 4.800 4.700 8.800a4.700 4.700 0 0 1-9.400 0c0-1.700.8-2.800 1.600-3.600.2 1.200.9 1.900 1.700 2.100-.1-2.500.2-5 1.400-7.300z" fill="${esc(accent)}" stroke="currentColor" stroke-width="1.8"/></g>
</svg>`.replace(/(\d)\.(\d*?)0+(?=\D)/g, (m, a, b) => (b ? a + '.' + b : a));
    if (!doc) return html;
    const holder = doc.createElementNS(NS, 'svg');
    holder.innerHTML = html;
    return holder.firstElementChild;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
