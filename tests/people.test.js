/* People: the kicker's boot meets the ball at t = 0, nobody sinks into the pitch, poses stay finite. */
'use strict';
const FK = require('../js/physics.js');
const P = require('../js/people.js');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, msg) { if (!c) throw new Error(msg); }
const allPoints = (b) => {
  const p = [b.pelvis, b.neck, b.head];
  for (const s of ['L', 'R']) { const l = b.legs[s], a = b.arms[s]; p.push(l.hip, l.knee, l.ankle, l.toe, a.sh, a.elbow, a.hand); }
  return p;
};

console.log('People');
test('every taker\'s kicking boot reaches the back of the ball at the moment of the strike', () => {
  for (const ch of P.CHARACTERS) {
    for (const ball of [{ x: 24, y: 5 }, { x: 30, y: -12 }, { x: 19, y: 0 }]) {
      const cfg = FK.defaultConfig(); cfg.ball = ball;
      Object.assign(cfg.kick, { speed: ch.kick.speed, sideSpin: ch.kick.side, topSpin: ch.kick.top, azimuth: -4, elevation: 15 });
      const L = FK.launchState(cfg);
      const b = P.kickerBody(ch, 0, ball, [L.fx, L.fy]);
      // nearest point of the foot (ankle → toe): curlers meet the ball with the inside of the foot, toes beside it
      const leg = b.legs[ch.foot === 'left' ? 'L' : 'R'], a = leg.ankle, e = leg.toe, c = [ball.x, ball.y, 0.11];
      const ae = e.map((x, i) => x - a[i]), u = Math.max(0, Math.min(1, ae.reduce((s, x, i) => s + x * (c[i] - a[i]), 0) / ae.reduce((s, x) => s + x * x, 0)));
      const q = a.map((x, i) => x + ae[i] * u);
      const d = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
      ok(d < 0.2, `${ch.short} at (${ball.x},${ball.y}): boot ${d.toFixed(3)} m from the ball centre`);
      // and the boot is behind the ball (on the kicker's side), not past it
      ok((q[0] - ball.x) * L.fx + (q[1] - ball.y) * L.fy < 0, `${ch.short}: boot is in front of the ball`);
    }
  }
});
test('no foot goes below the grass during the run-up, strike or follow-through', () => {
  for (const ch of P.CHARACTERS) for (let t = -P.runTime(ch) - 0.5; t < 2; t += 0.01) {
    const b = P.kickerBody(ch, t, { x: 24, y: 5 }, [-0.98, -0.2]);
    for (const s of ['L', 'R']) ok(b.legs[s].toe[2] > -0.005 && b.legs[s].ankle[2] > 0.0, `${ch.short} foot below ground at t=${t.toFixed(2)}`);
    for (const p of allPoints(b)) ok(p.every(Number.isFinite), `${ch.short}: non-finite joint at t=${t.toFixed(2)}`);
  }
});
test('limb lengths stay constant through the animation (no stretching)', () => {
  const ch = P.CHAR_BY_ID.beckham, k = ch.height / 1.8;
  for (let t = -2; t < 1.5; t += 0.05) {
    const b = P.kickerBody(ch, t, { x: 24, y: 5 }, [-1, 0]);
    for (const s of ['L', 'R']) {
      const l = b.legs[s];
      const th = Math.hypot(...l.knee.map((v, i) => v - l.hip[i])), sh = Math.hypot(...l.ankle.map((v, i) => v - l.knee[i]));
      ok(Math.abs(th - P.DIM.thigh * k) < 1e-9 && Math.abs(sh - P.DIM.shin * k) < 1e-9, `leg ${s} at t=${t.toFixed(2)}`);
    }
  }
});
test('the goalkeeper\'s body is dressed exactly on the physics body (gloves where the engine says)', () => {
  const c = FK.defaultConfig(); c.wall.count = 0; c.keeper.level = 'pro'; c.seed = 4; c.ball = { x: 22, y: 0 };
  Object.assign(c.kick, { speed: 27, sideSpin: 0, topSpin: 0 });
  const a = FK.solveAim(c, -3.1, 0.25); c.kick.azimuth = a.azimuth; c.kick.elevation = a.elevation;
  const sim = new FK.Simulation(c);
  while (!sim.done && sim.t < 1.5) {
    sim.step();
    const k = sim.keeper, b = P.keeperBody(k);
    // drawn glove centre = wrist + 6 cm along the forearm (as in render.js)
    const glove = (a) => { const d = a.hand.map((v, i) => v - a.elbow[i]), l = Math.hypot(...d); return a.hand.map((v, i) => v + d[i] / l * 0.06); };
    const gL = glove(b.arms.L), gR = glove(b.arms.R);
    const mid = gL.map((v, i) => (v + gR[i]) / 2);
    const err = Math.hypot(mid[1] - k.hy, mid[2] - k.hz);
    // in the set position the gloves are drawn low and wide (they are not reaching yet), and they leave it over ~0.1 s;
    // once they have, they must be on the physics glove point
    const left = !['ready', 'set', 'watching'].includes(k.state) && (!k._vis || k._vis.gw > 0.98);
    if (left) ok(err < 0.1, `gloves ${err.toFixed(3)} m off the physics glove point at t=${sim.t.toFixed(2)}`);
    for (const p of allPoints(b)) ok(p[2] > -0.01, `keeper below ground at t=${sim.t.toFixed(2)}`);
  }
});
test('wall players keep their feet on the ground until they jump', () => {
  const b0 = P.wallBody({ x: 15, y: 2, z: 0, height: 1.8, faceX: 1, faceY: 0 });
  const b1 = P.wallBody({ x: 15, y: 2, z: 0.3, height: 1.8, faceX: 1, faceY: 0 });
  const low = (b) => Math.min(b.legs.L.ankle[2], b.legs.R.ankle[2]);
  ok(Math.abs(low(b0) - P.DIM.ankle) < 0.01, 'standing ankles at ankle height');
  ok(low(b1) > 0.3, 'jumping player is off the ground');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
