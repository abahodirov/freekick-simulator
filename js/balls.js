/*
 * Ball Laboratory data. Pure data, DOM-free (loaded by tests in Node).
 *
 * Each model's drag-crisis parameters are tagged with where they come from:
 *   measured  – read from a published wind-tunnel study (cited)
 *   engine    – the simulator's own fit, applied because no per-ball measurement is available
 * Values not listed in a source are NEVER invented: they fall back to the engine fit and are labelled so.
 *
 * Source for the measured World Cup balls: Hong, S. & Asai, T. (2014) "Effect of panel shape of soccer ball on its
 * flight characteristics", Scientific Reports 4, 5068. Critical Reynolds number (where the drag crisis completes)
 * and the drag coefficient there, for two panel orientations (A and B) in a wind tunnel, non-spinning ball.
 * The paper notes the Jabulani figures vary noticeably with orientation for Re ≈ 3.0–5.0×10⁵.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FKBalls = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const HONG_ASAI = { title: 'Hong & Asai (2014), Effect of panel shape of soccer ball on its flight characteristics, Scientific Reports 4:5068', url: 'https://www.nature.com/articles/srep05068' };
  const GOFF_CARRE = { title: 'Goff & Carré (2009), Trajectory analysis of a soccer ball, American Journal of Physics 77, 1020', url: 'https://doi.org/10.1119/1.3197221' };

  const BALLS = [
    { id: 'engine', name: 'Engine default ball', year: null, panels: 32, look: 'classic',
      note: 'The simulator\'s standard drag-crisis fit (after Goff & Carré 2009): a generic modern ball, not a specific model.',
      orient: { A: { reCrit: 1.78e5, cdSuper: 0.155 } }, tag: 'engine', source: GOFF_CARRE },
    { id: 'brazuca', name: 'Adidas Brazuca', year: 2014, panels: 6, look: 'brazuca',
      note: 'Six identical propeller-shaped panels with a textured surface. Its drag crisis comes at the lowest speed of the three tested balls.',
      orient: { A: { reCrit: 2.5e5, cdSuper: 0.15 }, B: { reCrit: 2.2e5, cdSuper: 0.16 } }, tag: 'measured', source: HONG_ASAI },
    { id: 'jabulani', name: 'Adidas Jabulani', year: 2010, panels: 8, look: 'jabulani',
      note: 'Eight thermally bonded panels and a smoother surface. Its drag crisis comes at the highest speed, close to typical free-kick speeds, and depends strongly on how the ball is oriented.',
      orient: { A: { reCrit: 3.3e5, cdSuper: 0.16 }, B: { reCrit: 3.6e5, cdSuper: 0.12 } }, tag: 'measured', source: HONG_ASAI,
      // smooth, nearly seamless skin: a low-spin strike wobbles harder and faster, and swerves late as the ball slows
      // through its drag crisis (Re ≈ 3.3×10⁵ ≈ 23 m/s, right at the end of a free kick). Model values, not measured.
      knuckle: { knCl: 0.27, knSpin: 0.085, knFreq: 1.25, knTrans: 1.6 } },
    { id: 'trionda', name: 'Adidas Trionda', year: 2026, panels: 4, look: 'trionda',
      note: 'The 2026 World Cup ball: four thermally bonded panels, the fewest of any World Cup ball. No wind-tunnel figures have been published, so it flies with the engine\'s drag model.',
      orient: { A: { reCrit: 1.78e5, cdSuper: 0.155 } }, tag: 'engine', source: GOFF_CARRE },
  ];

  /** Engine parameters for a ball and orientation; cdSub and reWidth are not in the source, so they stay at the engine fit. */
  function aeroFor(id, orientation, engineDefaults) {
    const b = BALLS.find((x) => x.id === id) || BALLS[0];
    const o = b.orient[orientation] || b.orient.A;
    if (b.id === 'engine') return null;                       // null = engine default, bit-for-bit
    return Object.assign({ cdSub: engineDefaults.cdSub, reWidth: engineDefaults.reWidth, reCrit: o.reCrit, cdSuper: o.cdSuper }, b.knuckle || {});
  }
  /** The air speed at which a Reynolds number is reached (m/s), for a 0.22 m ball. */
  const speedAtRe = (Re, rho, mu) => Re * mu / (rho * 0.22);

  return { BALLS, aeroFor, speedAtRe, SOURCES: { HONG_ASAI, GOFF_CARRE } };
});
