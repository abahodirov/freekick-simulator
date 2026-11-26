/*
 * Goalkeeper tests: the keeper is a rigid body that takes off, flies as a projectile and lands.
 * These check the two failures seen in the old model: hands hanging in the air at a top corner,
 * and hands simply extending (no dive) for a low drive.
 */
'use strict';
const FK = require('../js/physics.js');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, msg) { if (!c) throw new Error(msg); }

function shot(ty, tz, speed, level) {
  const c = FK.defaultConfig(); c.wall.count = 0; c.keeper.level = level || 'pro'; c.seed = 4;
  c.ball = { x: 22, y: 0 }; Object.assign(c.kick, { speed, sideSpin: 0, topSpin: 0 });
  const a = FK.solveAim(c, ty, tz); c.kick.azimuth = a.azimuth; c.kick.elevation = a.elevation;
  return new FK.Simulation(c);
}
/** Step the whole shot, recording the keeper each step. */
function trace(sim, tMax) {
  const out = [];
  while (!sim.done && sim.t < (tMax || 3)) {
    sim.step();
    const k = sim.keeper;
    out.push({ t: sim.t, state: k.state, cy: k.cy, cz: k.cz, cvz: k.cvz, theta: k.theta, hz: k.hz, fz: k.fz, caught: sim.caught, bz: sim.s[2] });
  }
  return out;
}

console.log('Goalkeeper');
test('in the air the centre of mass falls with exactly g (no hovering)', () => {
  const tr = trace(shot(3.3, 2.1, 27));
  const air = tr.filter((p) => p.state === 'air');
  ok(air.length > 50, 'keeper should spend time airborne on a top-corner shot');
  for (let i = 1; i < air.length; i++) {
    const a = (air[i].cvz - air[i - 1].cvz) / (air[i].t - air[i - 1].t);
    if (Math.abs(a + FK.C.G) > 1e-6) throw new Error(`vertical acceleration ${a.toFixed(3)} at t=${air[i].t.toFixed(3)}`);
  }
});
test('after a dive the keeper is back on the ground within about one second', () => {
  const sim = shot(3.3, 2.1, 27); const tr = trace(sim);
  const takeoff = tr.find((p) => p.state === 'air');
  ok(takeoff && sim.keeper.tLand > 0, 'keeper should land');
  ok(sim.keeper.tLand - takeoff.t < 1.0, `flight lasted ${(sim.keeper.tLand - takeoff.t).toFixed(2)} s`);
});
test('a low drive makes the keeper dive: body near horizontal and gloves near the grass', () => {
  const tr = trace(shot(-3.1, 0.25, 27));
  const lowest = Math.min(...tr.map((p) => p.hz));
  const maxLean = Math.max(...tr.map((p) => Math.abs(p.theta)));
  ok(maxLean > 1.3, `body only leaned ${maxLean.toFixed(2)} rad`);
  ok(lowest < 0.3, `gloves only got down to ${lowest.toFixed(2)} m`);
  ok(tr.some((p) => p.state === 'down'), 'keeper should end up on the ground');
});
test('nothing goes through the ground (feet, gloves, centre of mass)', () => {
  for (const [y, z] of [[3.3, 2.1], [-3.1, 0.25], [2.2, 1.0], [-1.5, 0.4]]) {
    for (const p of trace(shot(y, z, 25))) {
      ok(p.fz > -1e-6 && p.hz > 0.05 && p.cz >= 0.2, `below ground at t=${p.t.toFixed(2)} for target (${y},${z})`);
    }
  }
});
test('a caught ball comes down with the keeper instead of hanging in the air', () => {
  const sim = shot(2.2, 1.0, 22); const tr = trace(sim);
  ok(sim.caught, 'this mid-height shot should be caught');
  const atCatch = tr.find((p) => p.caught), end = tr[tr.length - 1];
  ok(end.bz < atCatch.bz - 0.15, `ball stayed at ${end.bz.toFixed(2)} m (caught at ${atCatch.bz.toFixed(2)} m)`);
});
test('with time to spare the keeper waits in his set position and takes off later', () => {
  const tr = trace(shot(2.2, 1.0, 22));
  ok(tr.some((p) => p.state === 'set'), 'expected a set phase before the dive');
});
test('take-off speed never exceeds the level limits', () => {
  for (const lvl of ['amateur', 'pro', 'world']) {
    const sim = shot(3.4, 2.2, 30, lvl); trace(sim);
    const k = sim.keeper, L = FK.KEEPER_LEVELS[lvl];
    ok(Math.abs(k.launchY) <= L.vDive + 1e-9 && k.launchZ <= L.vUp + 1e-9, `${lvl}: launch (${k.launchY}, ${k.launchZ})`);
  }
});
test('a world-class keeper saves more of the same kicks than an amateur', () => {
  const cnt = (lvl) => { let s = 0; for (let i = 0; i < 12; i++) { const y = -3.2 + i * 0.58; const sim = shot(y, 0.4 + (i % 4) * 0.5, 24, lvl); if (sim.run().code === 'saved') s++; } return s; };
  const w = cnt('world'), a = cnt('amateur');
  ok(w > a, `world ${w} vs amateur ${a}`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
