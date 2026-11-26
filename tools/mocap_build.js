// Pack the parsed CMU clips into assets/mocap.js: a jog cycle, standing idle, and kicks, each in a canonical frame.
// usage: node mc_build.js <mc dir> <out mocap.js>
const fs = require('fs'), path = require('path');
const [dir, out] = process.argv.slice(2);
const J = ['pel', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR', 'toeL', 'toeR', 'low', 'neck', 'uneck', 'head', 'shL', 'shR', 'elbL', 'elbR', 'wrL', 'wrR'];
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8')).frames;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const d3 = (a, b) => Math.hypot(...sub(a, b));
const hz = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l, 0]; };

// foot contacts: [start, end) frame ranges where the ankle is low and still
function contacts(F, s) {
  const g = Math.min(...F.map((p) => Math.min(p.ankL[2], p.ankR[2])));
  const r = []; let on = false, st = 0;
  for (let i = 1; i < F.length; i++) {
    const p = F[i], q = F[i - 1];
    // (the toe base is the part that stays still in a running stance: the heel rises off it)
    const low = Math.min(p['ank' + s][2], p['toe' + s][2] + 0.04) - g < 0.07;
    const c = low && Math.min(d3(p['ank' + s], q['ank' + s]), d3(p['toe' + s], q['toe' + s])) * 60 < 1.0;
    if (c && !on) { on = true; st = i; }
    if ((!c || i === F.length - 1) && on) { on = false; if (i - st > 2) r.push([st, i]); }
  }
  return r;
}
// subject rest values: ankle height and ankle→toe pitch while standing (or in stance), leg length
function rest(F, frames, sides = ['L', 'R']) {
  const az = [], pit = [];
  for (const i of frames) for (const s of sides) {
    const p = F[i]; az.push(p['ank' + s][2]);
    const d = sub(p['toe' + s], p['ank' + s]); pit.push(Math.atan2(d[2], Math.hypot(d[0], d[1])));
  }
  az.sort((a, b) => a - b); pit.sort((a, b) => a - b);
  const p0 = F[frames[0]];
  return { ankZ: az[az.length >> 1], pitch: pit[pit.length >> 1], leg: d3(p0.hipL, p0.kneeL) + d3(p0.kneeL, p0.ankL) };
}
// canonical: x along X, y to the left, z up from the rest ankle height (rest ankle at z = 0)
function canon(p, O, X, z0, drift) {
  const Y = [-X[1], X[0], 0], o = [];
  for (const j of J) {
    const v = sub(p[j], O), dj = drift ? drift[j] : [0, 0, 0];
    o.push(+(v[0] * X[0] + v[1] * X[1] - dj[0]).toFixed(3), +(v[0] * Y[0] + v[1] * Y[1] - dj[1]).toFixed(3), +(p[j][2] - z0 - dj[2]).toFixed(3));
  }
  return o;
}

const M = { joints: J, fps: 60 };

// ── jog cycle (16_35): one stride from a left touchdown to the next, uniform progression removed, loop closed ──
{
  const F = load('16_35');
  const cL = contacts(F, 'L'), cR = contacts(F, 'R');
  // one stride from a right touchdown to the next (frames before it are used to close the loop smoothly)
  const a = cR[0][0], b = cR[1][0];
  // rest ankle height: the first few frames of a stance (before the heel rises)
  const R = rest(F, [0, 1, 2, 3, 4].map((i) => i + cL[0][0]), ['L']);
  const V = sub(F[b].pel, F[a].pel); const n = b - a, Tc = n / 60;
  const X = hz(V), speed = Math.hypot(V[0], V[1]) / Tc;
  const O0 = F[a].pel;
  const loc = (i) => canon(F[i], [O0[0] + X[0] * speed * (i - a) / 60, O0[1] + X[1] * speed * (i - a) / 60, 0], X, R.ankZ);
  // close the loop: over the last W frames cross-fade into the stride before (same phase one cycle earlier), so the
  // end flows into the start with matching velocity
  const W = Math.min(20, a);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const cur = loc(a + i);
    const w0 = (i - (n - W)) / W, w = w0 <= 0 ? 0 : w0 * w0 * (3 - 2 * w0);
    if (w <= 0) { frames.push(cur); continue; }
    const prev = loc(a + i - n);          // one stride earlier (local coordinates already follow the progression)
    frames.push(cur.map((v, c) => +(v + (prev[c] - v) * w).toFixed(3)));
  }
  M.run = { speed: +speed.toFixed(3), period: +Tc.toFixed(4), rLand: 0, rest: R, frames };
  console.log('run', { speed, Tc, a, b, leg: R.leg, ankZ: R.ankZ, pitch: R.pitch });
}

// ── standing idle (10_02, before the subject sets off), 30 fps, loop closed ──
{
  const F = load('10_02');
  const N = 108, R = rest(F, [...Array(N).keys()]);
  const p0 = F[0], Rt = hz(sub(p0.hipR, p0.hipL)), X = [-Rt[1], Rt[0], 0];   // F = U × Rt
  let O = [0, 0, 0]; for (let i = 0; i < N; i++) O = O.map((v, c) => v + F[i].pel[c] / N); O[2] = 0;
  const raw = []; for (let i = 0; i <= N; i += 2) raw.push(canon(F[i], O, X, R.ankZ));
  const n = raw.length - 1, last = raw[n], first = raw[0];
  M.idle = { fps: 30, rest: R, frames: raw.slice(0, n).map((f, i) => f.map((v, c) => +(v - (last[c] - first[c]) * i / n).toFixed(3))) };
  console.log('idle', n, 'frames', R);
}

// ── kicks: from 0.8 s before contact (fastest kicking toe) to the end; x = kick direction, origin = the ball ──
M.kicks = {};
for (const name of ['10_01', '10_02', '10_03', '10_05', '10_06']) {
  const F = load(name);
  let kc = 1, best = 0;
  for (let i = 1; i < F.length; i++) { const v = d3(F[i].toeR, F[i - 1].toeR); if (v > best) { best = v; kc = i; } }
  const R = M.idle.rest;                          // same subject (10): his standing measurements
  const X = hz(sub(F[kc + 1].toeR, F[kc - 3].toeR));
  const O = [F[kc].toeR[0] + X[0] * 0.12, F[kc].toeR[1] + X[1] * 0.12, 0];
  const a = Math.max(0, kc - 48);
  const frames = []; for (let i = a; i < F.length; i++) frames.push(canon(F[i], O, X, R.ankZ));
  const cR = contacts(F, 'R'), cL = contacts(F, 'L');
  const lastR = cR.filter((c) => c[0] < kc).pop(), plant = cL.filter((c) => c[0] < kc).pop(), after = cR.find((c) => c[0] > kc);
  M.kicks[name] = { t0: +((a - kc) / 60).toFixed(4), tR: +((lastR[0] - kc) / 60).toFixed(4), tRoff: +((lastR[1] - kc) / 60).toFixed(4),
    tL: +((plant[0] - kc) / 60).toFixed(4), tLand: after ? +((after[0] - kc) / 60).toFixed(4) : null, rest: R, frames };
  console.log('kick', name, { t0: (a - kc) / 60, tR: (lastR[0] - kc) / 60, tRoff: (lastR[1] - kc) / 60, tL: (plant[0] - kc) / 60, end: (F.length - 1 - kc) / 60, toeSpeed: best * 60 });
}

const src = `/* Motion capture used for the free-kick taker: CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu),
 * subject 10 (soccer kicks 10_01-10_06), subject 16 (run/jog 16_35). The database was created with funding from
 * NSF EIA-0196217. Converted from ASF/AMC to joint positions (metres, z up, 60 fps) in canonical frames: the jog cycle
 * along +x with its average progression removed, the kicks with +x along the kick and the ball at the origin.
 * Generated by tools/mocap_build.js — do not edit by hand. */
(function (root) {
  const D = ${JSON.stringify(M)};
  if (typeof module === 'object' && module.exports) module.exports = D; else root.FKMocap = D;
})(typeof self !== 'undefined' ? self : this);
`;
fs.writeFileSync(out, src);
console.log(out, (src.length / 1024).toFixed(0), 'KB');
