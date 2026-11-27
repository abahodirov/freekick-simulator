/*
 * Free Kick Simulator — the control capsule (the dock), fixed at the bottom centre.
 *   - Fold it down to the Kick button and the fold button (B, or the chevron); the choice is remembered.
 *   - Every control names itself (and its key) in a tooltip (CSS, from data-tip / data-key).
 * Element ids are the app's, so js/app.js drives the buttons.
 */
(function () {
  'use strict';
  const dock = document.getElementById('bottom'), fold = document.getElementById('dockFold');
  if (!dock || !fold || !dock.classList.contains('dock')) return;
  const KEY = 'fk.dockFolded';
  let folded = false;
  try { folded = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked */ }
  function setFolded(f) {
    folded = !!f;
    dock.classList.toggle('folded', folded);
    fold.setAttribute('aria-expanded', String(!folded));
    fold.dataset.tip = folded ? 'Unfold the bar' : 'Fold the bar';
    try { localStorage.setItem(KEY, folded ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  fold.addEventListener('click', (e) => { setFolded(!folded); e.currentTarget.blur(); });
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const tag = e.target.tagName, help = document.getElementById('help');
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SUMMARY' || (help && help.open)) return;
    if (e.key === 'b' || e.key === 'B') { setFolded(!folded); e.preventDefault(); }
  });
  setFolded(folded);
  requestAnimationFrame(() => dock.classList.add('ready'));
  window.FKDock = { setFolded, get folded() { return folded; } };
})();
