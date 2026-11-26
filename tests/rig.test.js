/* Real rigged model: glTF parsing, retargeting onto our bodies, skinning. */
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../js/rig.js');
const P = require('../js/people.js');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
function ok(c, m) { if (!c) throw new Error(m); }

// load the packed assets (assets/players.js assigns window.FK_PLAYER_ASSETS)
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'players.js'), 'utf8');
const window = {}; new Function('window', src)(window);
const A = window.FK_PLAYER_ASSETS;
// v2 assets: one shared MakeHuman topology plus a shape per player
const D = R.decodeV2(A);
const parsed = R.fromShape(D.base, D.shape('beckham'));
const rig = R.makeRig(parsed);
const body = parsed.prims.find((p) => p.node === 'Body');

function skin(mats, prim) {
  const nv = prim.pos.length / 3, out = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const x = prim.pos[v * 3], y = prim.pos[v * 3 + 1], z = prim.pos[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = prim.weights[v * 4 + k]; if (!w) continue;
      const m = mats.subarray(prim.joints[v * 4 + k] * 16);
      ox += w * (m[0] * x + m[4] * y + m[8] * z + m[12]); oy += w * (m[1] * x + m[5] * y + m[9] * z + m[13]); oz += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
    }
    out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
  }
  return out;
}
const bbox = (a) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[i + k]); mx[k] = Math.max(mx[k], a[i + k]); } return { mn, mx }; };

console.log('Rigged model');
test('the packed model decodes: 53-bone game-engine skin, a ~27k-triangle body, and the key bones are present', () => {
  ok(rig.n === 53, 'joints ' + rig.n);
  ok(body && body.idx.length / 3 > 20000, 'body triangles');
  for (const nm of ['pelvis', 'spine_01', 'neck_01', 'Head', 'thigh_l', 'calf_r', 'foot_l', 'ball_r', 'upperarm_l', 'lowerarm_r', 'hand_l']) ok(rig.index[nm] !== undefined, 'missing bone ' + nm);
  ok(rig.meshHeight > 1.4 && rig.meshHeight < 2.5, 'model height ' + rig.meshHeight);
  for (let v = 0; v < body.weights.length; v += 4) {
    const s = body.weights[v] + body.weights[v + 1] + body.weights[v + 2] + body.weights[v + 3];
    if (Math.abs(s - 1) > 1e-4) throw new Error('weights at vertex ' + v / 4 + ' sum to ' + s);
  }
});
test('every taker, wall player and keeper has a body; each taker\'s hair and beard are grown for him', () => {
  for (const ch of P.CHARACTERS) {
    const s = D.shape(ch.id);
    ok(s, 'no body for ' + ch.id);
    if (ch.hairStyle !== 'bald') ok(Object.keys(s.hair).length > 0, ch.id + ': no hair');
    if (ch.beard) ok(s.hair.beard, ch.id + ': no beard');
  }
  for (const id of ['wall0', 'wall1', 'wall2', 'wall3', 'wall4', 'wall5', 'keeper']) ok(D.shape(id), 'no body for ' + id);
});
test('eyes sit inside the head, in front, at eye height', () => {
  const s = D.shape('messi'), rm = R.makeRig(R.fromShape(D.base, s)), hd = rm.bindPos[rm.index.Head];
  for (let e = 0; e < 2; e++) {
    const c = R.toSim(s.eyes.slice(e * 4, e * 4 + 3)), r = s.eyes[e * 4 + 3];
    ok(r > 0.008 && r < 0.016, 'eye radius ' + r);
    ok(c[2] > hd[2] - 0.02 && c[2] < hd[2] + 0.15, 'eye height');
  }
});
test('posing on the bind pose itself reproduces the model exactly (retarget is consistent)', () => {
  const bp = (nm) => rig.bindPos[rig.index[nm]];
  const legs = {}, arms = {};
  for (const [s, l] of [['L', 'l'], ['R', 'r']]) {
    // the simulator's ankle→toe line is level for a flat foot (the model's own bone slopes down to the ball)
    const fb = bp('ball_' + l).map((x, i) => x - bp('foot_' + l)[i]), fu = fb[0] * rig.U[0] + fb[1] * rig.U[1] + fb[2] * rig.U[2];
    legs[s] = { hip: bp('thigh_' + l), knee: bp('calf_' + l), ankle: bp('foot_' + l), toe: bp('foot_' + l).map((x, i) => x + fb[i] - rig.U[i] * fu) };
    arms[s] = { sh: bp('upperarm_' + l), elbow: bp('lowerarm_' + l), hand: bp('hand_' + l) };
  }
  // in the simulator's convention the head joint sits straight along the spine line above the neck
  const head = bp('neck_01').map((x, i) => x + rig.U[i] * 0.1);
  const b = { pelvis: bp('pelvis'), neck: bp('neck_01'), head, F: rig.F, U: rig.U, Rt: rig.Rt, legs, arms };
  const mats = R.poseRig(rig, b, 1, null, false);                // relax = false: the bind hands as they are
  const sk = skin(mats, body);
  let worst = 0;
  for (let v = 0; v < body.pos.length / 3; v++) {
    const t = R.toSim([body.pos[v * 3], body.pos[v * 3 + 1], body.pos[v * 3 + 2]]);
    worst = Math.max(worst, Math.hypot(sk[v * 3] - t[0], sk[v * 3 + 1] - t[1], sk[v * 3 + 2] - t[2]));
  }
  ok(worst < 1e-4, 'vertices moved by up to ' + worst.toFixed(5) + ' m');
});
test('posed on a running taker, the model stands on the pitch at the right height and place', () => {
  const ch = P.CHAR_BY_ID.beckham;
  const b = P.kickerBody(ch, -0.6, { x: 24, y: 5 }, [-0.98, -0.2]);
  const s = ch.height / rig.meshHeight;
  const bb = bbox(skin(R.poseRig(rig, b, s), body));
  ok(bb.mn[2] > -0.06 && bb.mn[2] < 0.12, 'lowest point ' + bb.mn[2].toFixed(3) + ' m (should be about on the grass)');
  ok(bb.mx[2] > ch.height * 0.9 && bb.mx[2] < ch.height * 1.05, 'top of head ' + bb.mx[2].toFixed(2) + ' m for a ' + ch.height + ' m player');
  const cx = (bb.mn[0] + bb.mx[0]) / 2, cy = (bb.mn[1] + bb.mx[1]) / 2;
  ok(Math.hypot(cx - b.pelvis[0], cy - b.pelvis[1]) < 0.6, 'model centred away from the body');
});
test('the model\'s feet follow our planted feet (within a few centimetres)', () => {
  const ch = P.CHAR_BY_ID.messi, b = P.kickerBody(ch, -0.02, { x: 24, y: 5 }, [-0.98, -0.2]);
  const mats = R.poseRig(rig, b, ch.height / rig.meshHeight);
  for (const [s, l] of [['L', 'l'], ['R', 'r']]) {
    const i = rig.index['foot_' + l], m = mats.subarray(i * 16);
    // the foot joint maps from bind (via IBM) — apply the skin matrix to the bind joint position
    const B = R.invert4(rig.ibm.subarray(i * 16, i * 16 + 16));
    const x = B[12], y = B[13], z = B[14];
    const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    const a = b.legs[s].ankle;
    ok(Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) < 0.02, `${s} ankle off by ${Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]).toFixed(3)} m`);
  }
});
test('every vertex gets a body region for the kit (shirt, shorts, socks, boots, skin)', () => {
  const reg = R.regions(rig, body);
  const counts = new Array(9).fill(0); reg.cls.forEach((c) => counts[c]++);
  for (let c = 0; c < 9; c++) ok(counts[c] > 50, `region ${c} has only ${counts[c]} vertices`);
  // forearm and shin carry t in 1…2, so triangles at the elbow and knee never interpolate back into the sleeve or shorts
  let low = 0; reg.cls.forEach((c, v) => { if ((c === 4 || c === 7) && reg.t[v] < 1) low++; });
  ok(low === 0, `${low} forearm/shin vertices with t < 1`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
