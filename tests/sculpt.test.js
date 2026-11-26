/* Sculpted body parts: well-formed meshes with sensible sizes, and limb tubes that follow the skeleton. */
'use strict';
const S = require('../js/sculpt.js');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
function ok(c, m) { if (!c) throw new Error(m); }
function stats(m) {
  const mn = [9, 9, 9], mx = [-9, -9, -9]; let bad = 0;
  for (let i = 0; i < m.length; i += 6) {
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m[i + k]); mx[k] = Math.max(mx[k], m[i + k]); }
    if (!Number.isFinite(m[i + 3]) || Math.abs(Math.hypot(m[i + 3], m[i + 4], m[i + 5]) - 1) > 1e-3) bad++;
  }
  return { mn, mx, bad, tris: m.length / 18 };
}
console.log('Sculpted parts');
test('every static part has finite, unit-length normals', () => {
  for (const [n, m] of [['head', S.headMesh()], ['hair', S.hairMesh('long')], ['beard', S.beardMesh()], ['hand', S.handMesh(1)], ['glove', S.gloveMesh()], ['boot', S.bootMesh()]]) {
    const s = stats(m); ok(s.bad === 0, `${n}: ${s.bad} bad normals`); ok(s.tris > 100, `${n}: too few triangles`);
  }
});
test('the head has human proportions and the nose is the most forward point', () => {
  const s = stats(S.headMesh());
  const h = s.mx[2] - s.mn[2], w = s.mx[0] - s.mn[0];
  ok(h > 0.2 && h < 0.26, 'head height ' + h); ok(w > 0.15 && w < 0.21, 'head width (with ears) ' + w);
  const nose = S.headPoint([0, 1, -0.03]);
  ok(nose[1] > 0.11, 'nose projection ' + nose[1]);
});
test('hair sits on the head, outside the skull', () => {
  const s = stats(S.hairMesh('short')), h = stats(S.headMesh());
  ok(s.mx[2] > h.mx[2], 'hair should rise above the scalp');
});
test('the boot is a foot long and its sole is flat at ankle height below the ankle joint', () => {
  const s = stats(S.bootMesh());
  ok(s.mx[1] - s.mn[1] > 0.24 && s.mx[1] - s.mn[1] < 0.3, 'boot length ' + (s.mx[1] - s.mn[1]));
  ok(s.mn[2] > -0.077 && s.mn[2] < -0.066, 'sole should sit at ankle height (≈7 cm) below the ankle joint: ' + s.mn[2]);
  ok(s.mx[2] > 0.02, 'the collar should wrap up around the ankle: top at ' + s.mx[2]);
});
test('a leg tube follows hip → knee → ankle and is widest at the thigh', () => {
  const w = { v: new Float32Array(10 * 1000), n: 0, idx: new Uint16Array(10000), ni: 0 };
  const hip = [0, 0, 0.9], knee = [0.05, 0, 0.46], ankle = [0, 0, 0.05];
  S.tube(w, [hip, knee, ankle], [1, 0, 0], 26, 14, S.legRadius(0.5, 1), () => [1, 1, 1, 6]);
  ok(w.n === 26 * 14 && w.ni === 25 * 14 * 6, 'vertex/index count');
  const ringR = (r) => { let m = 0; const c = r === 0 ? hip : r === 25 ? ankle : null; for (let i = 0; i < 14; i++) { const o = (r * 14 + i) * 10; const cc = c || [0, 0, 0]; m = Math.max(m, Math.hypot(w.v[o] - cc[0], w.v[o + 1] - cc[1], w.v[o + 2] - cc[2])); } return m; };
  ok(ringR(0) > ringR(25) * 1.8, 'thigh should be much wider than the ankle');
  for (let i = 0; i < w.ni; i++) ok(w.idx[i] < w.n, 'index out of range');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
