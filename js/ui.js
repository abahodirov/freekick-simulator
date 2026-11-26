/*
 * Free Kick Simulator — interface layout: two slim rails of icons (set-up on the left, analysis on the right). Each
 * rail button opens one focused drawer showing just that group of controls; pressing it again (or ✕, or Esc) closes
 * it, and only one drawer per side is open at a time. A small live readout (speed, spin, height, time) stays in view.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TITLES = { player: 'Free-kick taker', shot: 'The shot', spot: 'Where from', defence: 'Wall and keeper',
    weather: 'Weather and look', more: 'Camera and physics', stats: 'Live stats', charts: 'Flight and goal', history: 'Your kicks' };
  const state = { left: null, right: null };

  for (const side of ['left', 'right']) {
    const aside = $(side);
    const head = document.createElement('header'); head.className = 'drawer-head';
    head.innerHTML = '<h3></h3><button class="icon dclose" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    aside.prepend(head);
    head.querySelector('button').addEventListener('click', () => open(side, null));
    for (const d of aside.querySelectorAll(':scope > details')) { d.open = true; d.hidden = true; }
  }

  function open(side, group) {
    if (state[side] === group) group = null;
    state[side] = group;
    const aside = $(side);
    for (const d of aside.querySelectorAll(':scope > details')) d.hidden = d.dataset.group !== group;
    aside.querySelector('.drawer-head h3').textContent = group ? TITLES[group] : '';
    document.body.classList.toggle(side + '-open', !!group);
    document.querySelectorAll(`.rail button[data-panel="${side}"]`).forEach((b) => b.classList.toggle('on', b.dataset.group === group));
    aside.scrollTop = 0;
    // charts and sliding highlights measure themselves: let them redraw now that they are visible
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  document.querySelectorAll('.rail button').forEach((b) => b.addEventListener('click', () => { open(b.dataset.panel, b.dataset.group); b.blur(); }));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('#ballShow:not([hidden])')) return;
    if (state.left || state.right) { open('left', null); if (state.right) open('right', null); }
  });

  // the live readout copies the telemetry tiles the app already keeps up to date
  const pairs = [['hSpeed', 'tSpeed'], ['hSpin', 'tSpin'], ['hHeight', 'tHeight'], ['hTime', 'tTime']].map(([a, b]) => [$(a), $(b)]);
  let last = 0;
  (function tick(now) {
    if (now - last > 80) {
      last = now;
      for (const [h, t] of pairs) if (h && t && h.innerHTML !== t.innerHTML) h.innerHTML = t.innerHTML;
    }
    requestAnimationFrame(tick);
  })(0);

  window.FKUI = { open, get state() { return { ...state }; } };
})();
