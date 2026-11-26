/*
 * Golden-value regression tests (characterisation tests).
 *
 * Purpose: the rendering / UI / storytelling layers consume physics output. If a refactor changes the
 * engine's numbers, these tests fail loudly, so the change must be deliberate and reviewed.
 *
 * IMPORTANT: golden values pin the CURRENT behaviour. They are not proof that the behaviour is correct.
 * Correctness is covered by physics.test.js (conservation laws, closed forms) and docs/AUDIT.md.
 * When a physics change is intended, regenerate the values and explain why in the commit message.
 */
'use strict';
const FK = require('../js/physics.js');
const GOLD = {"curler":{"y":3.15120006679361,"z":1.9982966477131545,"t":1.140040071339628,"v":18.823773408519063,"maxH":2.9964343897325163},"dipper":{"y":0.5646680770063045,"z":0.5316076875686546,"t":1.0632061471062004,"v":15.645035033524282,"maxH":1.3808702542534654},"driven":{"y":-1.326865235462502,"z":1.1148505141414307,"t":0.848766744508762,"v":26.40817179963952,"maxH":1.4036834223043813},"windy":{"y":3.3755029764342437,"z":1.7924671891086046,"t":1.0482621114217185,"v":21.7625890134965,"maxH":2.460045831637822},"vacuum":{"y":7.817444608315682e-14,"z":2.4218918828714946,"t":0.9808943907082074,"v":25.113928001959177,"maxH":2.728615120906676},"spinDecay1s":0.9383610156005777,"scenario":{"code":"goal","t":3.2909999999997486},"mc":{"goal":1,"saved":46,"wall":70,"woodwork":0,"over":3,"wide":0,"short":0}};
// mc regenerated deliberately (stage 5): the goalkeeper became a ballistic diving body. Ball-flight goldens unchanged.
// mc regenerated deliberately (stage 25): the keeper reads only part of the bend and is screened by the wall.
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)))) throw new Error(`${what}: got ${a}, golden ${b}`);
}
const base = () => { const c = FK.defaultConfig(); c.wall.count = 0; c.keeper.level = 'off'; c.seed = 11; return c; };
function fly(mut, opts) { const c = base(); mut(c); return FK.simulateFlight(c, opts || { knuckle: false }); }
const CASES = {
  curler: [(c) => Object.assign(c.kick, { speed: 26, sideSpin: 8, topSpin: 1.5, elevation: 19.27, azimuth: -2 })],
  dipper: [(c) => Object.assign(c.kick, { speed: 29, sideSpin: 2, topSpin: 6.5, elevation: 14, azimuth: -1 })],
  driven: [(c) => Object.assign(c.kick, { speed: 33, sideSpin: 0, topSpin: -1, elevation: 8, azimuth: -3 })],
  windy:  [(c) => { Object.assign(c.kick, { speed: 26, sideSpin: 8, elevation: 16, azimuth: -2 }); Object.assign(c.env, { windSpeed: 8, windDir: 90, altitude: 2200 }); }],
  vacuum: [(c) => Object.assign(c.kick, { speed: 26, elevation: 16, azimuth: 0 }), { vacuum: true }],
};
console.log('Regression: engine output is pinned');
for (const [name, [mut, opts]] of Object.entries(CASES)) {
  test('flight "' + name + '" crossing point, time and speed are unchanged', () => {
    const f = fly(mut, opts), g = GOLD[name];
    near(f.crossing.y, g.y, 1e-6, 'y'); near(f.crossing.z, g.z, 1e-6, 'z');
    near(f.crossing.t, g.t, 1e-6, 't'); near(f.crossing.speed, g.v, 1e-6, 'speed'); near(f.maxHeight, g.maxH, 1e-6, 'maxHeight');
  });
}
test('spin after 1 s of free flight is unchanged', () => {
  const c = base(); Object.assign(c.kick, { speed: 25, sideSpin: 8, elevation: 35 });
  const s = new FK.Simulation(c, { obstacles: false }); while (s.t < 1) s.step();
  near(Math.hypot(s.s[6], s.s[7], s.s[8]) / (2 * Math.PI * 8), GOLD.spinDecay1s, 1e-9, 'spin ratio');
});
test('seeded full scenario gives the same outcome', () => {
  const c = FK.defaultConfig(); c.seed = 5; Object.assign(c.kick, { speed: 27, sideSpin: 8, elevation: 17, azimuth: -1 });
  const r = new FK.Simulation(c).run();
  if (r.code !== GOLD.scenario.code) throw new Error(`outcome ${r.code} != ${GOLD.scenario.code}`);
  near(r.time, GOLD.scenario.t, 1e-9, 'time');
});
test('seeded Monte Carlo tallies are unchanged', () => {
  const mc = FK.monteCarlo(FK.defaultConfig(), 120, FK.NOISE_LEVELS.pro, 99);
  for (const k of Object.keys(GOLD.mc)) if (mc.counts[k] !== GOLD.mc[k]) throw new Error(`${k}: ${mc.counts[k]} != ${GOLD.mc[k]}`);
});
test('physics modules stay DOM-free (engine loads in plain Node)', () => {
  if (typeof document !== 'undefined' || typeof window !== 'undefined') throw new Error('DOM globals present');
  if (typeof FK.Simulation !== 'function') throw new Error('engine did not load');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
