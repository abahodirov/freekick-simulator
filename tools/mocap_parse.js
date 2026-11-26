// CMU ASF/AMC → world joint positions (metres, z up), resampled to `fps`.
// usage: node cmu_parse.js file.asf file.amc out.json [fps=60]
const fs = require('fs');
const [asfF, amcF, out, fpsArg] = process.argv.slice(2);
const FPS_IN = 120, fps = +(fpsArg || 60);
const SCALE = (1 / 0.45) * 0.0254;               // CMU length units → metres

const d2r = Math.PI / 180;
const mm = (A, B) => A.map((r, i) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const T = (A) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[j][i]));
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const euler = (x, y, z) => mm(Rz(z * d2r), mm(Ry(y * d2r), Rx(x * d2r)));   // static XYZ

// ── ASF ──
const asf = fs.readFileSync(asfF, 'utf8').split(/\r?\n/);
const bones = { root: { name: 'root', dof: ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'], C: euler(0, 0, 0), dir: [0, 0, 0], len: 0 } };
let cur = null, sec = '';
for (const raw of asf) {
  const l = raw.trim(); if (!l || l[0] === '#') continue;
  if (l[0] === ':') { sec = l.split(/\s+/)[0]; continue; }
  const w = l.split(/\s+/);
  if (sec === ':bonedata') {
    if (w[0] === 'begin') cur = { dof: [] };
    else if (w[0] === 'end') { bones[cur.name] = cur; cur = null; }
    else if (w[0] === 'name') cur.name = w[1];
    else if (w[0] === 'direction') cur.dir = w.slice(1, 4).map(Number);
    else if (w[0] === 'length') cur.len = +w[1] * SCALE;
    else if (w[0] === 'axis') cur.C = euler(+w[1], +w[2], +w[3]);
    else if (w[0] === 'dof') cur.dof = w.slice(1);
  } else if (sec === ':hierarchy') {
    if (w[0] === 'begin' || w[0] === 'end') continue;
    for (const c of w.slice(1)) bones[c].parent = w[0];
  }
}
const order = []; const seen = new Set(['root']); order.push('root');
while (order.length < Object.keys(bones).length) for (const n of Object.keys(bones)) if (!seen.has(n) && seen.has(bones[n].parent)) { seen.add(n); order.push(n); }

// ── AMC ──
const frames = []; let f = null;
for (const raw of fs.readFileSync(amcF, 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l[0] === '#' || l[0] === ':') continue;
  if (/^\d+$/.test(l)) { f = {}; frames.push(f); continue; }
  const w = l.split(/\s+/); f[w[0]] = w.slice(1).map(Number);
}

// CMU y-up → ours z-up: (x, y, z) → (x, -z, y)
const toZ = (p) => [p[0], -p[2], p[1]];
const WANT = { hipL: 'lhipjoint', kneeL: 'lfemur', ankL: 'ltibia', ballL: 'lfoot', toeL: 'ltoes', hipR: 'rhipjoint', kneeR: 'rfemur', ankR: 'rtibia', ballR: 'rfoot', toeR: 'rtoes',
  low: 'lowerback', up: 'upperback', thorax: 'thorax', neck: 'lowerneck', uneck: 'upperneck', head: 'head',
  shL: 'lclavicle', elbL: 'lhumerus', wrL: 'lradius', handL: 'lwrist', shR: 'rclavicle', elbR: 'rhumerus', wrR: 'rradius', handR: 'rwrist' };
function pose(fr) {
  const M = {}, P = {};
  for (const n of order) {
    const b = bones[n], v = fr[n] || [];
    if (n === 'root') {
      P.root = [v[0] * SCALE, v[1] * SCALE, v[2] * SCALE];
      M.root = euler(v[3], v[4], v[5]);
      continue;
    }
    const r = [0, 0, 0]; b.dof.forEach((d, i) => { r[{ rx: 0, ry: 1, rz: 2 }[d]] = v[i] || 0; });
    M[n] = mm(mm(mm(M[b.parent], b.C), euler(r[0], r[1], r[2])), T(b.C));
    P[n] = P[b.parent].map((x, i) => x + b.len * mv(M[n], b.dir)[i]);
  }
  const o = { pel: toZ(P.root) };
  for (const [k, n] of Object.entries(WANT)) o[k] = toZ(P[n]);
  return o;
}
const outF = [];
const n = frames.length, step = FPS_IN / fps;
for (let i = 0; i < n - 1; i += step) {
  const a = Math.floor(i), u = i - a;
  const pa = pose(frames[a]), pb = u > 1e-6 ? pose(frames[Math.min(n - 1, a + 1)]) : pa;
  const o = {}; for (const k of Object.keys(pa)) o[k] = pa[k].map((x, j) => +(x + (pb[k][j] - x) * u).toFixed(4));
  outF.push(o);
}
fs.writeFileSync(out, JSON.stringify({ fps, frames: outF }));
console.log(out, outF.length, 'frames', (outF.length / fps).toFixed(2), 's');
