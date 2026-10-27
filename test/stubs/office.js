/* Test stub (NOT part of the app): a tiny SB.office with a frame, section nav and the way out. */
(function (g) {
  'use strict';
  const SB = (g.SB = g.SB || {});
  const U = SB.util, h = U.h;
  let frame = null, title = null, body = null;
  SB.office = {
    __stub: true, mounts: 0, unmounts: 0, navs: [],
    mount(el, section) {
      SB.office.mounts++;
      U.clear(el);
      title = h('h1', { id: 'office-title' }, 'Pace');
      body = h('div', { id: 'office-body', style: 'padding:16px' });
      const nav = h('nav', { 'aria-label': 'Back office sections', style: 'display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line-soft)' },
        SB.router.sections.map((s) => h('button', { type: 'button', class: 'btn btn-sm', dataset: { section: s }, onClick: () => SB.router.go({ kind: 'office', section: s }) }, s)),
        h('span', { style: 'flex:1' }),
        h('button', { type: 'button', class: 'btn btn-sm', id: 'office-theme', onClick: () => SB.theme.setOffice(SB.theme.office() === 'ember' ? 'paper' : 'ember') }, 'Ember or Paper'),
        h('button', { type: 'button', class: 'btn btn-sm', id: 'office-sheet', onClick: () => SB.sheets.open('help') }, 'Open a sheet'),
        h('button', { type: 'button', class: 'btn btn-primary', id: 'back-to-line', onClick: () => SB.shell.extinguish() }, SB.icons.svg('door', { size: 20 }), h('span', null, 'Back to the board')));
      frame = h('div', { id: 'office-frame', style: 'display:flex;flex-direction:column;min-height:100%' }, nav, h('div', { style: 'padding:16px 16px 0' }, title), body);
      el.appendChild(frame);
      SB.gallery && SB.gallery.render(body);
      this.navigate(section);
    },
    navigate(section) { SB.office.navs.push(section); if (title) title.textContent = 'Section: ' + section; },
    unmount() { SB.office.unmounts++; frame = title = body = null; },
    registerPage() {},
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
