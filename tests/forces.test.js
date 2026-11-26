'use strict';
const FK = require('../js/physics.js');
let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
function at(kick, env, t) {
  const c = FK.defaultConfig(); c.wall.count = 0; c.keeper.level = 'off'; c.seed = 3;
  Object.assign(c.kick, kick); Object.assign(c.env, env || {});
  const s = new FK.Simulation(c, { obstacles: false }); while (s.t < t) s.step(); return s;
}
console.log('Force decomposition (engine output, same derivative as the integrator)');
const CASES = [
  ['curler', { speed: 26, sideSpin: 8, topSpin: 1.5, elevation: 19, azimuth: -2 }, {}],
  ['windy altitude', { speed: 26, sideSpin: -6, topSpin: 3, elevation: 15 }, { windSpeed: 9, windDir: 70, altitude: 2000 }],
  ['knuckle', { speed: 31, sideSpin: 0, topSpin: 0.2, elevation: 10 }, {}],
];
for (const [name, kick, env] of CASES) {
  test(`${name}: gravity + drag + Magnus + knuckle = m·a (integrator's acceleration)`, () => {
    const s = at(kick, env, 0.4), f = s.forces(), m = FK.C.BALL_MASS, o = s._k1;
    for (let i = 0; i < 3; i++) {
      const sum = f.gravity[i] + f.drag[i] + f.magnus[i] + f.knuckle[i];
      ok(Math.abs(sum - m * o[3 + i]) < 1e-9, `axis ${i}: ${sum} vs ${m * o[3 + i]}`);
      ok(Math.abs(f.contact[i]) < 1e-9, 'unexpected contact force in free flight');
    }
  });
  test(`${name}: drag opposes air-relative velocity and matches telemetry`, () => {
    const s = at(kick, env, 0.4), f = s.forces(), a = s.aero();
    const rel = [s.s[3] - s.windX, s.s[4] - s.windY, s.s[5]];
    ok(dot(f.drag, rel) < 0, 'drag not opposing');
    ok(len([f.drag[0] / len(f.drag) + rel[0] / len(rel), f.drag[1] / len(f.drag) + rel[1] / len(rel), f.drag[2] / len(f.drag) + rel[2] / len(rel)]) < 1e-9, 'not antiparallel');
    ok(Math.abs(len(f.drag) - a.drag) < 1e-9, `|drag| ${len(f.drag)} vs aero() ${a.drag}`);
    ok(Math.abs(len(f.magnus) - a.magnus) < 1e-9, '|magnus| vs aero()');
  });
}
test('Magnus force is along ω × v and ⟂ both (so it does no work)', () => {
  const s = at(CASES[0][1], {}, 0.4), f = s.forces(), w = [s.s[6], s.s[7], s.s[8]], v = [s.s[3], s.s[4], s.s[5]];
  const c = [w[1] * v[2] - w[2] * v[1], w[2] * v[0] - w[0] * v[2], w[0] * v[1] - w[1] * v[0]];
  ok(dot(f.magnus, c) / (len(f.magnus) * len(c)) > 1 - 1e-9, 'not along ω×v');
  ok(Math.abs(dot(f.magnus, v)) / (len(f.magnus) * len(v)) < 1e-9, 'not ⟂ v');
});
test('knuckle force exists for a non-spinning ball and vanishes for a spinning one', () => {
  ok(len(at(CASES[2][1], {}, 0.4).forces().knuckle) > 1e-4, 'no knuckle force');
  ok(len(at(CASES[0][1], {}, 0.4).forces().knuckle) === 0, 'knuckle with high spin');
});
test('forces() does not disturb the simulation (read-only)', () => {
  const a = at(CASES[0][1], {}, 0.3), b = at(CASES[0][1], {}, 0.3);
  a.forces(); a.forces(); while (a.t < 0.6) a.step(); while (b.t < 0.6) b.step();
  for (let i = 0; i < 9; i++) ok(a.s[i] === b.s[i], 'state differs');
});
console.log('Boot strike');
test('a central strike gives no spin and the most speed; an off-centre strike trades speed for spin', () => {
  const c = FK.strikeFromBoot(20, 0, 0), o = FK.strikeFromBoot(20, 0.02, 0);
  if (c.sideSpin !== 0 || c.topSpin !== 0) throw new Error('central strike spins');
  if (!(o.speed < c.speed)) throw new Error('off-centre is not slower');
  if (!(o.sideSpin < 0)) throw new Error('hit right of centre should curl left (negative side spin)');
  if (!(FK.strikeFromBoot(20, 0, 0.02).topSpin > 0)) throw new Error('hit above centre should give topspin');
});
test('ball leaves faster than the boot (ratio between 1 and 2)', () => {
  const r = FK.strikeFromBoot(20, 0, 0).ratio;
  if (!(r > 1 && r < 2)) throw new Error('ratio ' + r);
});
test('angular impulse matches linear impulse: ω = J·d / I', () => {
  const s = FK.strikeFromBoot(18, 0.015, 0.01, { footMass: 1.6, restitution: 0.5 });
  const J = s.speed * FK.C.BALL_MASS, w = Math.hypot(s.sideSpin, s.topSpin) * 2 * Math.PI;
  if (Math.abs(w - J * s.offset / FK.BALL_INERTIA) > 1e-9) throw new Error('angular impulse mismatch');
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
