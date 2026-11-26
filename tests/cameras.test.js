'use strict';
const CAM = require('../js/cameras.js');
let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const ctx = (over) => Object.assign({ ball: { x: 24, y: 5 }, s: [24, 5, 0.11, -25, -3, 5, 0, 0, 0], mode: 'live', goal: false,
  followDir: [-1, 0], orbit: { yaw: 0.5, pitch: 0.35, dist: 34 }, inspect: { yaw: 0.6, pitch: 0.3, dist: 4 },
  opts: { followBack: 5.5, followUp: 1.3 }, keeperY: -0.7 }, over || {});
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
console.log('Cameras');
test('there are 10 distinct cameras', () => ok(new Set(CAM.NAMES).size === 10, 'names'));
for (const n of CAM.NAMES.concat('inspect')) {
  test(`"${n}" gives a valid view (finite, eye≠target, up not parallel to view)`, () => {
    for (const mode of ['aim', 'live']) {
      const t = CAM.desired(n, ctx({ mode }));
      for (const v of [t.eye, t.target, t.up]) ok(v.every(Number.isFinite), 'non-finite');
      ok(Number.isFinite(t.fov) && t.fov > 0.2 && t.fov < 1.4 && t.k > 0, 'fov/k');
      const view = sub(t.target, t.eye);
      ok(len(view) > 1, 'eye too close to target');
      ok(len(cross(view, t.up)) / (len(view) * len(t.up)) > 0.05, 'up parallel to view direction');
      ok(t.eye[2] > 0, 'eye underground');
    }
  });
}
test('keeper camera sits at the goal line at standing eye height and faces the ball', () => {
  const t = CAM.desired('keeper', ctx());
  ok(t.eye[0] < 1 && t.eye[2] > 1.5 && t.eye[2] < 2, 'eye position');
  ok(t.target[0] > 20, 'does not face the ball');
});
test('side camera looks along the goal line, across the path', () => {
  const t = CAM.desired('side', ctx()), v = sub(t.target, t.eye);
  ok(Math.abs(v[1]) > 30 && Math.abs(v[0]) < 1e-9, 'not a pure side view');
});
test('follow offset sliders move the camera by exactly the requested amount', () => {
  const a = CAM.desired('follow', ctx({ opts: { followBack: 4, followUp: 1 } }));
  const b = CAM.desired('follow', ctx({ opts: { followBack: 8, followUp: 3 } }));
  const dh = Math.hypot(a.eye[0] - b.eye[0], a.eye[1] - b.eye[1]);
  ok(Math.abs(dh - 4) < 1e-9, 'back offset ' + dh); ok(Math.abs(b.eye[2] - a.eye[2] - 2) < 1e-9, 'up offset');
});
test('follow looks ahead of the ball, further when faster', () => {
  const slow = CAM.desired('follow', ctx({ s: [24, 5, 1, -10, 0, 0, 0, 0, 0] }));
  const fast = CAM.desired('follow', ctx({ s: [24, 5, 1, -30, 0, 0, 0, 0, 0] }));
  ok(slow.target[0] < 24 && fast.target[0] < slow.target[0], 'look-ahead');
});
test('follow keeps its heading once the ball is slow or scored (no disorienting spin)', () => {
  const c = ctx({ s: [1, 1, 0.11, 0.5, 0.2, 0, 0, 0, 0], followDir: [-0.6, 0.8] });
  CAM.desired('follow', c); ok(c.followDir[0] === -0.6 && c.followDir[1] === 0.8, 'heading changed');
});
test('follow tracks heading of a curving ball', () => {
  const c = ctx({ s: [10, 0, 1, 0, 20, 0, 0, 0, 0] }); CAM.desired('follow', c); ok(c.followDir[1] === 1, 'did not turn');
});
test('inspect camera orbits the ball at the requested distance', () => {
  const t = CAM.desired('inspect', ctx()), s = [24, 5, 0.11];
  ok(Math.abs(len(sub(t.eye, s)) - 4) < 1e-9, 'distance');
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
