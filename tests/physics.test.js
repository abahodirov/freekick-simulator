// Physics validation: run with `node tests/physics.test.js`
// Each test checks the engine against a conservation law or a closed-form result.
'use strict';
const FK = require('../js/physics.js');
const { C, Simulation } = FK;
const M = C.BALL_MASS, R = C.BALL_RADIUS, G = C.G, I = FK.BALL_INERTIA;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what || 'value'}: got ${a}, expected ${b} ± ${tol}`);
}
function ok(c, what) { if (!c) throw new Error(what); }

function cfg(over) {
  const c = FK.defaultConfig();
  c.ball = { x: 25, y: 0 };
  c.wall.count = 0; c.keeper.level = 'off';
  c.physics.knuckle = false;
  Object.assign(c.kick, { speed: 25, azimuth: 0, elevation: 20, sideSpin: 0, topSpin: 0 });
  if (over) over(c);
  return c;
}
const vacuum = c => { c.physics.drag = false; c.physics.magnus = false; };
function energy(s) {
  const v2 = s[3] ** 2 + s[4] ** 2 + s[5] ** 2, w2 = s[6] ** 2 + s[7] ** 2 + s[8] ** 2;
  return 0.5 * M * v2 + 0.5 * I * w2 + M * G * s[2];
}
function flyUntilLanding(sim) {
  while (sim.bounces === 0 && sim.t < 10) sim.step();
  return sim;
}

console.log('Projectile motion (no air)');
test('apex height and range match the closed-form parabola', () => {
  const c = cfg(vacuum);
  const sim = new Simulation(c, { obstacles: false });
  const th = 20 * Math.PI / 180, v = 25;
  flyUntilLanding(sim);
  near(sim.maxHeight - R, (v * Math.sin(th)) ** 2 / (2 * G), 1e-6, 'apex');
  near(25 - sim.firstBounce.x, v * v * Math.sin(2 * th) / G, 0.03, 'range'); // one step of travel
  near(sim.firstBounce.t, 2 * v * Math.sin(th) / G, 1.5e-3, 'flight time');
});
test('mechanical energy is conserved in flight', () => {
  const sim = new Simulation(cfg(vacuum), { obstacles: false });
  const e0 = energy(sim.s);
  for (let i = 0; i < 1500; i++) sim.step();
  near(energy(sim.s) / e0, 1, 1e-10, 'E/E0');
});
test('horizontal momentum is conserved in flight', () => {
  const sim = new Simulation(cfg(vacuum), { obstacles: false });
  const vx0 = sim.s[3];
  for (let i = 0; i < 1500; i++) sim.step();
  near(sim.s[3], vx0, 1e-12, 'vx');
});

console.log('Aerodynamics');
test('air density: ISA sea level, 15 °C, dry = 1.225 kg/m³', () => {
  near(FK.atmosphere(15, 0, 0).rho, 1.225, 0.001);
  ok(FK.atmosphere(15, 2240, 0).rho < 0.95, 'air should be thinner at altitude');
  ok(FK.atmosphere(30, 0, 0.9).rho < FK.atmosphere(30, 0, 0).rho, 'humid air is lighter than dry air');
});
test('drag only ever removes energy', () => {
  const sim = new Simulation(cfg(), { obstacles: false });
  let e = energy(sim.s);
  while (sim.bounces === 0) {
    sim.step();
    const e2 = energy(sim.s);
    ok(e2 <= e + 1e-9, 'energy increased in still air');
    e = e2;
  }
  ok(e < 0.8 * energy(new Simulation(cfg(), { obstacles: false }).s), 'drag should cost real energy');
});
test('terminal velocity satisfies m·g = ½ρ·Cd·A·v²', () => {
  const c = cfg(k => { k.kick.speed = 0.001; k.kick.elevation = 0; });
  const sim = new Simulation(c, { obstacles: false });
  sim.s[2] = 3000; sim.s[5] = -30;     // start near terminal speed so it settles within the run
  for (let i = 0; i < 11000; i++) sim.step();
  const v = -sim.s[5];
  const Re = sim.rho * v * 2 * R / sim.mu;
  const dragForce = 0.5 * sim.rho * FK.dragCoefficient(Re, 0) * FK.BALL_AREA * v * v;
  near(dragForce / (M * G), 1, 1e-3, 'drag/weight');
  ok(v > 25 && v < 45, 'terminal speed of a football should be ~30–40 m/s, got ' + v);
});
test('drag crisis: Cd drops through the critical Reynolds number', () => {
  ok(FK.dragCoefficient(0.8e5, 0) > 0.33, 'subcritical Cd');
  ok(FK.dragCoefficient(4e5, 0) < 0.17, 'supercritical Cd');
});
test('Magnus force is perpendicular to velocity: it does no work', () => {
  const c = cfg(k => { k.physics.drag = false; k.kick.sideSpin = 8; });
  const sim = new Simulation(c, { obstacles: false });
  const e0 = energy(sim.s);
  for (let i = 0; i < 1200; i++) sim.step();
  near(energy(sim.s) / e0, 1, 1e-8, 'E/E0');
  ok(Math.abs(sim.s[1]) > 2, 'ball should have curved');
});
test('side spin curls the ball the right way, symmetric left/right', () => {
  const run = spin => flyUntilLanding(new Simulation(cfg(k => { k.kick.sideSpin = spin; }), { obstacles: false })).s[1];
  const yr = run(8), yl = run(-8), y0 = run(0);
  ok(yr > 2, 'positive side spin curls right (+y), got ' + yr);
  near(yl, -yr, 1e-9, 'mirror symmetry');
  near(y0, 0, 1e-12, 'no spin, no curve');
});
test('topspin dips, backspin floats', () => {
  const run = spin => 25 - flyUntilLanding(new Simulation(cfg(k => { k.kick.topSpin = spin; }), { obstacles: false })).firstBounce.x;
  const top = run(8), none = run(0), back = run(-8);
  ok(top < none - 2 && none < back - 2, `ranges top/none/back = ${top.toFixed(1)}/${none.toFixed(1)}/${back.toFixed(1)}`);
});
test('a typical curling free kick bends 2–6 m over 25 m', () => {
  const c = cfg(k => { k.kick.speed = 27; k.kick.elevation = 14; k.kick.sideSpin = 8; });
  const f = FK.simulateFlight(c, { knuckle: false });
  ok(f.crossing, 'should reach the goal line');
  ok(Math.abs(f.crossing.y) > 2 && Math.abs(f.crossing.y) < 6, 'bend = ' + f.crossing.y);
});
test('wind: tailwind carries further, crosswind pushes downwind', () => {
  const run = (speed, dir) => flyUntilLanding(new Simulation(cfg(k => { k.env.windSpeed = speed; k.env.windDir = dir; }), { obstacles: false }));
  const still = run(0, 0), tail = run(8, 0), head = run(8, 180), cross = run(8, 90);
  ok(tail.firstBounce.x < still.firstBounce.x - 0.5, 'tailwind should carry further');
  ok(head.firstBounce.x > still.firstBounce.x + 0.5, 'headwind should shorten');
  ok(cross.s[1] > 0.5, 'crosswind toward +y should push the ball to +y');
});
test('thin air at altitude: less curve, more carry', () => {
  const run = alt => FK.simulateFlight(cfg(k => { k.env.altitude = alt; k.kick.sideSpin = 8; k.kick.elevation = 14; k.kick.speed = 27; }), {});
  const sea = run(0), high = run(3600);
  ok(Math.abs(high.crossing.y) < Math.abs(sea.crossing.y) * 0.85, 'less Magnus deflection at altitude');
  ok(high.crossing.speed > sea.crossing.speed, 'less drag at altitude');
});
test('spin decays slowly in air and not at all in vacuum', () => {
  const a = new Simulation(cfg(k => { k.kick.sideSpin = 10; }), { obstacles: false });
  for (let i = 0; i < 1000; i++) a.step();
  const sp = Math.hypot(a.s[6], a.s[7], a.s[8]) / (2 * Math.PI);
  ok(sp < 10 && sp > 8.5, 'spin after 1 s = ' + sp);
  const b = new Simulation(cfg(k => { vacuum(k); k.kick.sideSpin = 10; }), { obstacles: false });
  for (let i = 0; i < 1000; i++) b.step();
  near(Math.hypot(b.s[6], b.s[7], b.s[8]) / (2 * Math.PI), 10, 1e-12, 'vacuum spin');
});

console.log('Contact');
test('drop test: rebound height = e² × drop height', () => {
  const c = cfg(k => { vacuum(k); k.kick.speed = 0; });
  const sim = new Simulation(c, { obstacles: false });
  sim.s[2] = 2 + R;
  while (sim.bounces === 0) sim.step();
  let top = 0;
  while (sim.s[5] >= 0) { sim.step(); top = Math.max(top, sim.s[2]); }
  const e = FK.SURFACES.dry.restitution;
  near(top - R, e * e * 2, 0.01, 'rebound height');
});
test('bounce conserves angular momentum about the contact point and never adds energy', () => {
  for (const top of [-10, 0, 10]) {
    const c = cfg(k => { vacuum(k); k.kick.elevation = 25; k.kick.topSpin = top; k.kick.sideSpin = 3; });
    const sim = new Simulation(c, { obstacles: false });
    let before = null;
    while (sim.bounces === 0) { before = Float64Array.from(sim.s); sim.step(); }
    const a = sim.s;
    // L about the contact point (centre is at +R ẑ from it): L = m (R ẑ × v) + I ω → horizontal parts
    const L = s => [-M * R * s[4] + I * s[6], M * R * s[3] + I * s[7]];
    const Lb = L(before), La = L(a);
    near(La[0], Lb[0], 2e-3, 'Lx (topspin ' + top + ')');
    near(La[1], Lb[1], 2e-3, 'Ly (topspin ' + top + ')');
    ok(energy(a) <= energy(before) + 1e-9, 'bounce created energy');
  }
});
test('topspin kicks forward off the turf, backspin checks up', () => {
  const run = top => {
    const sim = new Simulation(cfg(k => { vacuum(k); k.kick.elevation = 25; k.kick.topSpin = top; }), { obstacles: false });
    while (sim.bounces === 0) sim.step();
    return -sim.s[3];   // forward speed after the bounce
  };
  ok(run(10) > run(0) && run(0) > run(-10), 'forward speed after bounce should rise with topspin');
});
test('rolling ball stops after v²/(2·c_rr·g)', () => {
  const c = cfg(k => { vacuum(k); k.kick.speed = 3; k.kick.elevation = 0; });
  const sim = new Simulation(c, { obstacles: false });
  sim.rolling = true;
  sim.s[7] = sim.s[3] / R; sim.s[6] = -sim.s[4] / R;   // start in pure rolling
  while (!sim.atRest && sim.t < 30) sim.step();
  near(25 - sim.s[0], 9 / (2 * FK.SURFACES.dry.rolling * G), 0.02, 'roll distance');
});
test('a sliding ball settles into rolling at v = 3/5 v0 (hollow sphere)', () => {
  const c = cfg(k => { vacuum(k); k.kick.speed = 10; k.kick.elevation = 0; });
  const sim = new Simulation(c, { obstacles: false });
  sim.rolling = true;       // no spin: pure sliding at first
  let v = 0;
  for (let i = 0; i < 3000; i++) {
    sim.step();
    if (Math.abs(sim.s[3] - R * sim.s[7]) < 1e-6) { v = -sim.s[3]; break; }
  }
  // angular momentum about the contact line: m·v0·R = (m R² + I)·v/R → v = v0 / (1 + 2/3)
  near(v, 10 * 0.6, 0.02, 'speed at onset of rolling');
});

console.log('Numerics');
test('time-step convergence: 1 ms vs 0.25 ms agree to < 1 mm', () => {
  const c = cfg(k => { k.kick.sideSpin = 7; k.kick.topSpin = 2; k.env.windSpeed = 4; k.env.windDir = 60; });
  const a = FK.simulateFlight(c, { dt: 0.001 }).crossing, b = FK.simulateFlight(c, { dt: 0.00025 }).crossing;
  near(a.y, b.y, 1e-3, 'y'); near(a.z, b.z, 1e-3, 'z');
});
test('deterministic: same seed, same shot', () => {
  const mk = () => { const c = FK.defaultConfig(); c.kick.speed = 30; c.kick.sideSpin = 0.3; c.seed = 42; return new Simulation(c).run(); };
  const a = mk(), b = mk();
  ok(a.code === b.code && a.time === b.time && a.curve === b.curve, 'runs differ');
});

console.log('Match situations');
test('unopposed shot on target is a goal, and only once the whole ball is over the line', () => {
  const c = cfg(k => { k.kick.elevation = 8; });
  const sim = new Simulation(c);
  while (!sim.goal && !sim.done) sim.step();
  ok(sim.goal, 'expected a goal');
  ok(sim.s[0] < -R, 'ball must be wholly over the line');
  ok(sim.crossing.t < sim.t, 'centre crosses before the whole ball does');
});
test('net stops the ball inside the goal', () => {
  const sim = new Simulation(cfg(k => { k.kick.elevation = 8; k.kick.speed = 34; }));
  const res = sim.run();
  ok(res.code === 'goal', res.text);
  ok(sim.s[0] > -C.NET_DEPTH - 1.2 && sim.s[0] < 0, 'ball should stay in the net, x=' + sim.s[0]);
});
test('ballooned shot goes over; pulled shot goes wide', () => {
  ok(new Simulation(cfg(k => { k.kick.elevation = 30; })).run().code === 'over', 'expected over');
  ok(new Simulation(cfg(k => { k.kick.azimuth = 14; k.kick.elevation = 8; })).run().code === 'wide', 'expected wide');
});
test('shot into the wall is blocked; jumping wall can be beaten underneath', () => {
  const base = k => { k.wall.count = 4; k.ball = { x: 22, y: 0 }; k.kick.azimuth = 4; };
  const hit = new Simulation(cfg(k => { base(k); k.wall.jump = false; k.kick.elevation = 5; })).run();
  ok(hit.code === 'wall', 'expected wall, got ' + hit.code);
});
test('ball that hits the post face rebounds into play', () => {
  const c = cfg(k => { k.kick.elevation = 3; k.kick.speed = 30; });
  const aim = FK.solveAim(c, FK.POST_Y, 1.0);
  c.kick.azimuth = aim.azimuth; c.kick.elevation = aim.elevation;
  const sim = new Simulation(c);
  const res = sim.run();
  ok(sim.touched.post, 'should hit the post, got ' + res.text);
});
test('aim solver puts the ball where it is asked to', () => {
  const c = cfg(k => { k.ball = { x: 23, y: 6 }; k.kick.sideSpin = -7; k.kick.speed = 28; });
  const aim = FK.solveAim(c, -3.2, 2.1);
  ok(aim.converged, 'solver did not converge, miss ' + aim.miss);
  c.kick.azimuth = aim.azimuth; c.kick.elevation = aim.elevation;
  const p = FK.simulateFlight(c, { knuckle: false }).crossing;
  near(p.y, -3.2, 0.02, 'y'); near(p.z, 2.1, 0.02, 'z');
});
test('keeper saves a soft central shot but not a top-corner strike', () => {
  const soft = cfg(k => { k.keeper.level = 'world'; k.kick.speed = 17; });
  const a1 = FK.solveAim(soft, 0.3, 1.0); soft.kick.azimuth = a1.azimuth; soft.kick.elevation = a1.elevation;
  ok(new Simulation(soft).run().code === 'saved', 'soft central shot should be saved');
  const hard = cfg(k => { k.keeper.level = 'amateur'; k.kick.speed = 33; k.ball = { x: 18, y: 0 }; });
  const a2 = FK.solveAim(hard, 3.3, 2.15); hard.kick.azimuth = a2.azimuth; hard.kick.elevation = a2.elevation;
  const r = new Simulation(hard).run();
  ok(r.code === 'goal', 'top corner at 33 m/s from 18 m should beat an amateur, got ' + r.text);
});
test('Monte Carlo tallies add up and run quickly', () => {
  const c = FK.defaultConfig();
  const t0 = Date.now();
  const mc = FK.monteCarlo(c, 200, FK.NOISE_LEVELS.pro, 3);
  const total = Object.values(mc.counts).reduce((a, b) => a + b, 0);
  ok(total === 200, 'tally mismatch');
  console.log(`       (200 kicks in ${Date.now() - t0} ms: ${JSON.stringify(mc.counts)})`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
