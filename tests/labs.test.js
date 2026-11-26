/* Ball Laboratory and exhibition data: sourced, labelled, and consistent with the engine. */
'use strict';
const FK = require('../js/physics.js');
const B = require('../js/balls.js');
const H = require('../js/history.js');
const P = require('../js/people.js');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, msg) { if (!c) throw new Error(msg); }

console.log('Ball laboratory');
test('the engine default ball changes nothing (bit-for-bit identical flight)', () => {
  const c = FK.defaultConfig(); c.wall.count = 0; c.keeper.level = 'off';
  const a = FK.simulateFlight(c), c2 = FK.cloneConfig(c);
  const aero = B.aeroFor('engine', 'A', FK.AERO_DEFAULT); if (aero) c2.aero = aero;
  const b = FK.simulateFlight(c2);
  ok(a.crossing.y === b.crossing.y && a.crossing.z === b.crossing.z && a.crossing.t === b.crossing.t, 'flight changed');
});
test('every measured ball cites a source and has both panel orientations', () => {
  for (const b of B.BALLS) {
    ok(b.source && /^https?:\/\//.test(b.source.url), `${b.id}: no source`);
    if (b.tag === 'measured') ok(b.orient.A && b.orient.B, `${b.id}: orientations`);
  }
});
test('a later drag crisis (Jabulani) means more drag at 20 m/s than an earlier one (Brazuca)', () => {
  const atm = FK.atmosphere(20, 0, 0.5), Re = atm.rho * 20 * 0.22 / atm.mu;
  const cdJ = FK.dragCoefficient(Re, 0, B.aeroFor('jabulani', 'A', FK.AERO_DEFAULT));
  const cdB = FK.dragCoefficient(Re, 0, B.aeroFor('brazuca', 'A', FK.AERO_DEFAULT));
  ok(cdJ > cdB, `Cd Jabulani ${cdJ.toFixed(3)} vs Brazuca ${cdB.toFixed(3)}`);
});
test('ball choice moves the crossing point of an identical kick (and the run is deterministic)', () => {
  const c = FK.defaultConfig(); c.wall.count = 0; c.keeper.level = 'off';
  const zs = B.BALLS.map((b) => { const x = FK.cloneConfig(c); const a = B.aeroFor(b.id, 'A', FK.AERO_DEFAULT); if (a) x.aero = a; return FK.simulateFlight(x, { knuckle: false }).crossing.z; });
  ok(Math.max(...zs) - Math.min(...zs) > 0.05, 'balls make no difference: ' + zs.join(','));
  const again = (() => { const x = FK.cloneConfig(c); x.aero = B.aeroFor('jabulani', 'A', FK.AERO_DEFAULT); return FK.simulateFlight(x, { knuckle: false }).crossing.z; })();
  ok(again === zs[2], 'not deterministic');
});

console.log('Historical exhibition');
test('every free kick has documented facts, at least one source, and a known taker', () => {
  for (const k of H.KICKS) {
    for (const f of ['player', 'opponent', 'competition', 'date', 'venue', 'distance']) ok(k.facts[f], `${k.id}: missing ${f}`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(k.facts.date), `${k.id}: date format`);
    ok(k.sources.length >= 1 && k.sources.every((s) => /^https?:\/\//.test(s.url)), `${k.id}: sources`);
    ok(P.CHAR_BY_ID[k.taker], `${k.id}: unknown taker ${k.taker}`);
    for (const s of ['moment', 'technique', 'physics', 'keeper', 'takeaway']) ok(k[s] && k[s].length > 20, `${k.id}: section ${s}`);
  }
});
test('no two exhibits use the same id', () => {
  ok(new Set(H.KICKS.map((k) => k.id)).size === H.KICKS.length, 'duplicate ids');
});
test('every reconstruction reaches the goal mouth when aimed by the solver', () => {
  for (const k of H.KICKS) {
    const c = FK.defaultConfig(), r = k.recon;
    c.ball = FK.clampBallPosition(r.ball.x, r.ball.y); c.wall.count = 0; c.keeper.level = 'off';
    Object.assign(c.kick, { speed: r.kick.speed, sideSpin: r.kick.side, topSpin: r.kick.top, elevation: 15 });
    const a = FK.solveAim(c, r.target.y, r.target.z); c.kick.azimuth = a.azimuth; c.kick.elevation = a.elevation;
    const f = FK.simulateFlight(c, { knuckle: false });
    ok(f.crossing && Math.abs(f.crossing.y) < FK.C.GOAL_HALF_WIDTH && f.crossing.z < FK.C.GOAL_HEIGHT, `${k.id}: crosses at ${f.crossing && f.crossing.y.toFixed(2)}, ${f.crossing && f.crossing.z.toFixed(2)}`);
    // and the reconstruction distance agrees with the documented distance where one is given in metres or yards
    const d = Math.hypot(c.ball.x, c.ball.y), m = /about (\d+) (m|yards)/.exec(k.facts.distance);
    if (m) { const doc = m[2] === 'm' ? +m[1] : +m[1] * 0.9144; ok(Math.abs(d - doc) < 3, `${k.id}: ${d.toFixed(1)} m vs documented ≈${doc.toFixed(1)} m`); }
  }
});
test('every recreation has a keeper read under which the documented goal happens (full simulation with wall and keeper)', () => {
  for (const k of H.KICKS) {
    const c = FK.defaultConfig(), r = k.recon;
    c.ball = FK.clampBallPosition(r.ball.x, r.ball.y); c.wall.count = r.wall; c.keeper.level = r.keeper;
    if (r.keeperPos) c.keeper.pos = r.keeperPos;
    Object.assign(c.kick, { speed: r.kick.speed, sideSpin: r.kick.side, topSpin: r.kick.top, elevation: 15 });
    const a = FK.solveAim(c, r.target.y, r.target.z); c.kick.azimuth = a.azimuth; c.kick.elevation = a.elevation;
    let found = null;
    for (let s = 0; s < 400 && found === null; s++) {
      const x = FK.cloneConfig(c); x.seed = 1009 + s * 7919;
      const sim = new FK.Simulation(x, { record: false, fast: true });
      if (sim.run(9).code === 'goal' && !sim.touched.keeper && !sim.touched.wall) found = s;
    }
    ok(found !== null, `${k.id}: no keeper read gives a clean goal — the reconstruction cannot score as it did`);
    for (const f of ['goalkeeper', 'wall', 'how']) ok(k.facts[f], `${k.id}: missing ${f}`);
  }
});
test('every recreation dresses the taker in his team of the day (full kit with trim and number)', () => {
  for (const k of H.KICKS) {
    const a = k.kits && k.kits.attack;
    ok(a, `${k.id}: no attacking kit`);
    for (const f of ['shirt', 'shorts', 'socks', 'trim']) ok(Array.isArray(a[f]) && a[f].length === 3, `${k.id}: ${f}`);
    ok(a.number > 0, `${k.id}: number`);
    ok(k.kits.defence && k.kits.keeper, `${k.id}: wall or keeper kit`);
  }
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
