/*
 * Free Kick Simulator — real rigged character models (pure maths, DOM-free, testable in Node).
 *
 *  parseGltf(json, bin)  → nodes, skin joints + inverse bind matrices, and mesh primitives as typed arrays
 *  makeRig(parsed)       → the bind pose in the simulator's world frame (z up), bone hierarchy, name lookup
 *  poseRig(rig, body, s) → per-joint skinning matrices that place the model on one of our bodies
 *
 * Retargeting. Our people (js/people.js) are joint positions produced by physics and locomotion (pelvis, neck,
 * head, hips, knees, ankles, toes, shoulders, elbows, wrists). For every driven bone we find the world rotation
 * Δ that turns the bone's bind-pose direction (to its child) into the direction between the matching joints of
 * our body, with a second reference axis (the body's front, or up for the feet) fixing the twist. Mapped joints
 * are placed exactly at our joint positions (so planted feet stay planted); the rest follow by forward
 * kinematics with the model's own bone offsets. Undriven bones (fingers, toes, clavicles, upper spine, head)
 * keep their bind pose relative to their parent.
 *
 * Coordinate frames: glTF is +Y up; the simulator is +Z up. C maps glTF (x, y, z) → simulator (x, −z, y).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FKRig = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────── glTF parsing ─────────────
  const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const NORM_DIV = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 };

  function readAccessor(g, bin, idx) {
    const a = g.accessors[idx], bv = g.bufferViews[a.bufferView];
    const T = COMP[a.componentType], n = NCOMP[a.type], count = a.count;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const elem = T.BYTES_PER_ELEMENT, stride = bv.byteStride || n * elem;
    const out = new Float32Array(count * n);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const get = {
      5126: (o) => dv.getFloat32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o),
      5125: (o) => dv.getUint32(o, true), 5122: (o) => dv.getInt16(o, true), 5120: (o) => dv.getInt8(o),
    }[a.componentType];
    const div = a.normalized ? NORM_DIV[a.componentType] : 1;
    for (let i = 0; i < count; i++) for (let c = 0; c < n; c++) out[i * n + c] = get(base + i * stride + c * elem) / div;
    return out;
  }

  /** Parse a glTF 2.0 document (JSON object + one binary buffer as Uint8Array). Single skin, triangle meshes. */
  function parseGltf(g, bin) {
    const nodes = g.nodes.map((n, i) => ({ i, name: n.name || ('node' + i), children: n.children || [], parent: -1,
      t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1], mesh: n.mesh, skin: n.skin }));
    nodes.forEach((n) => n.children.forEach((c) => { nodes[c].parent = n.i; }));
    const skin = g.skins[0];
    const ibm = readAccessor(g, bin, skin.inverseBindMatrices);
    const prims = [];
    for (const n of nodes) {
      if (n.mesh === undefined) continue;
      for (const p of g.meshes[n.mesh].primitives) {
        const at = p.attributes;
        prims.push({
          node: n.name, material: p.material !== undefined ? (g.materials[p.material].name || '') : '',
          pos: readAccessor(g, bin, at.POSITION), nrm: readAccessor(g, bin, at.NORMAL),
          uv: at.TEXCOORD_0 !== undefined ? readAccessor(g, bin, at.TEXCOORD_0) : null,
          joints: readAccessor(g, bin, at.JOINTS_0), weights: readAccessor(g, bin, at.WEIGHTS_0),
          idx: p.indices !== undefined ? Uint32Array.from(readAccessor(g, bin, p.indices)) : null,
        });
      }
    }
    return { nodes, joints: skin.joints.slice(), jointNames: skin.joints.map((j) => nodes[j].name), ibm, prims };
  }

  /**
   * A rigged body from a packed shape (assets v2: MakeHuman topology shared by every player, plus each player's
   * vertex positions, joint positions and eyeballs). Returns the same structure as parseGltf, so makeRig/poseRig
   * work unchanged. Bind rotations are identity, so each inverse bind matrix is a translation.
   *  base:  { names, parent, uv, joints, weights, idx, orig, eye: { pos, uv, idx } }  (typed arrays)
   *  shape: { pos (per shape vertex ×3), joints (per joint ×3), eyes [cx, cy, cz, r] ×2 }
   */
  function fromShape(base, shape) {
    const n = base.names.length;
    const nodes = base.names.map((name, i) => ({ i, name, children: [], parent: base.parent[i], t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }));
    const ibm = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      ibm[i * 16] = ibm[i * 16 + 5] = ibm[i * 16 + 10] = ibm[i * 16 + 15] = 1;
      ibm[i * 16 + 12] = -shape.joints[i * 3]; ibm[i * 16 + 13] = -shape.joints[i * 3 + 1]; ibm[i * 16 + 14] = -shape.joints[i * 3 + 2];
    }
    // smooth normals on the welded shape, then expanded to the render vertices (UV seams stay invisible)
    const ns = shape.pos.length / 3, N = new Float32Array(ns * 3), o = base.orig, idx = base.idx;
    for (let k = 0; k < idx.length; k += 3) {
      const a = o[idx[k]] * 3, b = o[idx[k + 1]] * 3, c = o[idx[k + 2]] * 3, P = shape.pos;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    const nv = o.length, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const s = o[v] * 3, l = Math.hypot(N[s], N[s + 1], N[s + 2]) || 1;
      for (let c = 0; c < 3; c++) { pos[v * 3 + c] = shape.pos[s + c]; nrm[v * 3 + c] = N[s + c] / l; }
    }
    const prims = [{ node: 'Body', material: 'skin', pos, nrm, uv: base.uv, joints: base.joints, weights: base.weights, idx: base.idx }];
    // eyeballs: a unit sphere placed at each eye, skinned to the head
    const head = base.names.indexOf('Head'), ep = base.eye.pos, ne = ep.length / 3;
    for (let e = 0; e < 2; e++) {
      const c = shape.eyes.slice(e * 4, e * 4 + 3), r = shape.eyes[e * 4 + 3];
      const p = new Float32Array(ne * 3), J = new Float32Array(ne * 4), W = new Float32Array(ne * 4);
      for (let v = 0; v < ne; v++) {
        for (let k = 0; k < 3; k++) p[v * 3 + k] = c[k] + ep[v * 3 + k] * r;
        J[v * 4] = head; W[v * 4] = 1;
      }
      prims.push({ node: 'Eyes', material: 'eye', pos: p, nrm: Float32Array.from(ep), uv: base.eye.uv, joints: J, weights: W, idx: base.eye.idx });
    }
    return { nodes, joints: nodes.map((nd) => nd.i), jointNames: base.names.slice(), ibm, prims };
  }

  /** A hair or beard shell (grown from the scalp / jaw) as a primitive, with smooth normals from its triangles. */
  function shellPrim(sb, pos) {
    const N = new Float32Array(pos.length), idx = sb.idx;
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    for (let v = 0; v < N.length; v += 3) { const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1; N[v] /= l; N[v + 1] /= l; N[v + 2] /= l; }
    return { node: 'Shell', material: 'hair', pos, nrm: N, uv: sb.uv, joints: sb.joints, weights: sb.weights, idx, prof: sb.prof };
  }

  // ───────────── small matrix helpers (column-major 4×4, like glTF) ─────────────
  function invert4(m) {
    const o = new Float64Array(16);
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06, d = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
    return o;
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const toSim = (v) => [v[0], -v[2], v[1]];                          // glTF y-up → simulator z-up
  // 3×3 as arrays of columns
  const m3mul = (A, B) => [0, 1, 2].map((c) => [0, 1, 2].map((r) => A[0][r] * B[c][0] + A[1][r] * B[c][1] + A[2][r] * B[c][2]));
  const m3T = (A) => [0, 1, 2].map((c) => [A[0][c], A[1][c], A[2][c]]);
  const m3v = (A, v) => [A[0][0] * v[0] + A[1][0] * v[1] + A[2][0] * v[2], A[0][1] * v[0] + A[1][1] * v[1] + A[2][1] * v[2], A[0][2] * v[0] + A[1][2] * v[1] + A[2][2] * v[2]];
  const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  /** Orthonormal frame (columns) from a main direction and a reference that fixes the twist. */
  function frame(d, ref) {
    const x = norm(d);
    let z = sub(ref, mul(x, dot(ref, x)));
    if (Math.hypot(z[0], z[1], z[2]) < 1e-5) z = Math.abs(x[2]) < 0.9 ? sub([0, 0, 1], mul(x, x[2])) : sub([1, 0, 0], mul(x, x[0]));
    z = norm(z);
    return [x, cross(z, x), z];
  }
  /** World rotation taking (dRest, refRest) onto (dNew, refNew). */
  const align = (dRest, refRest, dNew, refNew) => m3mul(frame(dNew, refNew), m3T(frame(dRest, refRest)));

  // ───────────── the rig ─────────────
  /** UE-style bone names (Quaternius Universal Base Characters, Unreal mannequin, many others). */
  const BONES = {
    pelvis: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head',
    L: { thigh: 'thigh_l', calf: 'calf_l', foot: 'foot_l', ball: 'ball_l', clav: 'clavicle_l', upper: 'upperarm_l', lower: 'lowerarm_l', hand: 'hand_l' },
    R: { thigh: 'thigh_r', calf: 'calf_r', foot: 'foot_r', ball: 'ball_r', clav: 'clavicle_r', upper: 'upperarm_r', lower: 'lowerarm_r', hand: 'hand_r' },
  };

  function makeRig(parsed) {
    const names = parsed.jointNames, n = names.length;
    const index = Object.fromEntries(names.map((nm, i) => [nm, i]));
    const parentNode = parsed.joints.map((j) => parsed.nodes[j].parent);
    const parent = parentNode.map((pn) => parsed.joints.indexOf(pn));   // −1 if the parent is not a joint
    const ibm = parsed.ibm;
    const bindPos = [], bindRot = [];
    for (let i = 0; i < n; i++) {
      const B = invert4(ibm.subarray(i * 16, i * 16 + 16));             // bind world (glTF frame)
      bindPos.push(toSim([B[12], B[13], B[14]]));
      bindRot.push([toSim([B[0], B[1], B[2]]), toSim([B[4], B[5], B[6]]), toSim([B[8], B[9], B[10]])]);
    }
    // order joints so parents come first (for forward kinematics)
    const order = [], seen = new Set();
    const visit = (i) => { if (seen.has(i)) return; if (parent[i] >= 0) visit(parent[i]); seen.add(i); order.push(i); };
    for (let i = 0; i < n; i++) visit(i);
    const P = (nm) => bindPos[index[nm]];
    // the model's own body frame in the bind pose
    const U = norm(sub(P(BONES.neck), P(BONES.pelvis)));
    const Rt = norm(sub(sub(P(BONES.R.thigh), P(BONES.L.thigh)), mul(U, dot(sub(P(BONES.R.thigh), P(BONES.L.thigh)), U))));
    const F = cross(U, Rt);
    const height = Math.max(...bindPos.map((p) => p[2])) - Math.min(...bindPos.map((p) => p[2]));
    const legLen = Math.hypot(...sub(P(BONES.L.thigh), P(BONES.L.calf))) + Math.hypot(...sub(P(BONES.L.calf), P(BONES.L.foot)));
    // standing height of the mesh itself (the skeleton stops at the head joint, below the crown)
    let meshHeight = height;
    for (const p of parsed.prims) {
      let lo = 1e9, hi = -1e9;
      for (let i = 1; i < p.pos.length; i += 3) { lo = Math.min(lo, p.pos[i]); hi = Math.max(hi, p.pos[i]); }
      if (hi - lo > meshHeight) meshHeight = hi - lo;
    }
    return { names, index, parent, order, ibm, bindPos, bindRot, F, U, Rt, height, meshHeight, legLen, n };
  }

  /**
   * Skinning matrices (Float32Array, 16 per joint) placing the rig on `body` (from js/people.js).
   * s: uniform scale of the model.
   */
  /** Rotation (3×3, columns) taking unit vector a onto unit vector b by the shortest arc. */
  function arc(a, b) {
    const c = dot(a, b);
    if (c > 0.999999) return I3;
    if (c < -0.999999) {                         // opposite: half-turn about any perpendicular axis
      const ax = norm(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
      return [0, 1, 2].map((col) => [0, 1, 2].map((row) => 2 * ax[row] * ax[col] - (row === col ? 1 : 0)));
    }
    const v = cross(a, b), k = 1 / (1 + c);
    // R = I + [v]× + [v]×² / (1 + c)
    const X = [[0, v[2], -v[1]], [-v[2], 0, v[0]], [v[1], -v[0], 0]];   // columns of [v]×
    const X2 = m3mul(X, X);
    return [0, 1, 2].map((col) => [0, 1, 2].map((row) => (row === col ? 1 : 0) + X[col][row] + X2[col][row] * k));
  }

  /** Rotation (3×3, columns) by angle th about unit axis k. */
  function rotAA(k, th) {
    const c = Math.cos(th), sn = Math.sin(th), t = 1 - c;
    return [0, 1, 2].map((col) => { const e = [0, 0, 0]; e[col] = 1;
      const kx = cross(k, e), kd = dot(k, e);
      return [0, 1, 2].map((r) => e[r] * c + kx[r] * sn + k[r] * kd * t); });
  }

  /** Rotation that goes from A a fraction w of the way toward B (both 3×3, columns), about their relative axis. */
  function partialRot(A, B, w) {
    if (w <= 0) return A;
    const Rr = m3mul(B, m3T(A)), m = (r, c) => Rr[c][r];
    const ang = Math.acos(Math.max(-1, Math.min(1, (m(0, 0) + m(1, 1) + m(2, 2) - 1) / 2)));
    if (ang < 1e-6) return A;
    const ax = [m(2, 1) - m(1, 2), m(0, 2) - m(2, 0), m(1, 0) - m(0, 1)], l = Math.hypot(...ax);
    if (l < 1e-9) return w < 0.5 ? A : B;
    return m3mul(rotAA(mul(ax, 1 / l), ang * Math.min(1, w)), A);
  }

  function poseRig(rig, body, s, out, relax = true) {
    const n = rig.n, idx = rig.index, bp = rig.bindPos;
    const D = new Array(n).fill(null);          // world rotation applied to each bone (relative to bind)
    const pos = new Array(n).fill(null);        // world position of each joint
    const B = (nm) => bp[idx[nm]];
    // Driven bones: the bind-pose direction that must point along a direction of our body. Each bone first
    // inherits its parent's rotation, then turns by the SHORTEST ARC onto its target. Twist is therefore always
    // carried smoothly from the parent — unlike building a frame from a reference axis, which flips 180° when the
    // limb passes the reference (that was the arms' "twitch").
    const drive = {}, place = {}, limb = {};
    drive[BONES.spine] = [sub(B(BONES.neck), B(BONES.pelvis)), sub(body.neck, body.pelvis)];
    // neck: the model's own forward slant of the neck, in the body's frame, turned by however far the body's head
    // leaves its spine line. (Aiming the neck straight along the spine tipped every head back, chin up, by ~19°.)
    const bn = sub(B(BONES.head), B(BONES.neck));
    const nl = [dot(bn, rig.F), dot(bn, rig.U), dot(bn, rig.Rt)];
    const nb = add(add(mul(body.F, nl[0]), mul(body.U, nl[1])), mul(body.Rt, nl[2]));
    drive[BONES.neck] = [bn, m3v(arc(norm(body.U), norm(sub(body.head, body.neck))), nb)];
    place[BONES.pelvis] = body.pelvis;
    // Arms start where the model's own skeleton puts its shoulders (the simulator's shoulder points sit ~6 cm
    // higher and narrower: shrugged shoulders, a squashed chest), and are solved with the model's own bone lengths
    // to reach the body's hand, bending the way the body's elbow bends. Legs follow the body's joints directly
    // (solving them too made the kicking leg's fast backswing jerkier).
    for (const side of ['L', 'R']) {
      const b = BONES[side], leg = body.legs[side], arm = body.arms[side];
      drive[b.thigh] = [sub(B(b.calf), B(b.thigh)), sub(leg.knee, leg.hip)];
      drive[b.calf] = [sub(B(b.foot), B(b.calf)), sub(leg.ankle, leg.knee)];
      // foot: the model's ankle→ball bone slopes ~25° down when the sole is flat, while the body's ankle→toe line
      // is level when flat; keep that slope (aiming the bone level tipped every foot toes-up, soles showing)
      const fb = sub(B(b.ball), B(b.foot)), fd = norm(sub(leg.toe, leg.ankle));
      const phi = Math.asin(Math.max(-1, Math.min(1, dot(norm(fb), rig.U))));
      // tipped about the body's side axis (stable even when the foot points straight down at the strike)
      let ka = sub(body.Rt, mul(fd, dot(body.Rt, fd)));
      ka = Math.hypot(...ka) > 1e-4 ? norm(ka) : body.Rt;
      drive[b.foot] = [fb, m3v(rotAA(ka, phi), fd)];
      place[b.thigh] = leg.hip; place[b.calf] = leg.knee; place[b.foot] = leg.ankle;
      if (body.gloves) {
        // goalkeeper: the gloves must be where the physics puts them, so the arm reaches for the hand point
        limb[b.upper] = { lower: b.lower, end: b.hand, tgt: arm.hand, hint: sub(arm.elbow, arm.sh) };
      } else {
        // everyone else keeps the body's arm angles (upper-arm direction, elbow bend) from the model's own
        // shoulder; reaching for the body's hand point from there straightened a running arm out in front
        drive[b.upper] = [sub(B(b.lower), B(b.upper)), sub(arm.elbow, arm.sh)];
        drive[b.lower] = [sub(B(b.hand), B(b.lower)), sub(arm.hand, arm.elbow)];
      }
      limb[b.thigh] = { leg, shift: true };
    }
    // relaxed hands (relax = false reproduces the bind hands exactly): the forearm turns so the palm faces the
    // thigh (thumb forward) — the bind palms face down, and hanging arms showed them to the front — and the
    // fingers curl gently instead of standing spread like claws
    const twist = {}, curl = {};
    if (relax) for (const side of ['L', 'R']) {
      const b = BONES[side], l = side.toLowerCase(), J = (nm) => idx[nm + '_' + l];
      if ([J('middle_01'), J('index_01'), J('pinky_01'), J('thumb_03')].some((j) => j === undefined)) continue;
      const h = B(b.hand), f = norm(sub(bp[J('middle_01')], h)), ac = norm(sub(bp[J('index_01')], bp[J('pinky_01')]));
      let pn = norm(cross(f, ac));
      if (dot(pn, sub(bp[J('thumb_03')], h)) < 0) pn = mul(pn, -1);              // the palm is on the thumb's side
      // relaxed: palm toward the thigh and turned a little backward. A goalkeeper's palms face the ball instead
      // (body.palm, or out toward the pitch), with the fingers open and spread behind it — not curled like a runner's
      const keeper = !!body.gloves;
      const medial = keeper ? norm(body.palm || body.F) : norm(sub(mul(body.Rt, side === 'L' ? 1 : -1), mul(body.F, 0.45)));
      twist[b.lower] = { pn, fore: sub(B(b.hand), B(b.lower)), medial, full: keeper };
      // turning about this axis takes the fingers palm-ward; a bent arm (running, striking) closes the hand into a
      // loose fist, a hanging arm leaves it relaxed
      const am = body.arms[side], ea = Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(am.elbow, am.sh)), norm(sub(am.hand, am.elbow))))));
      const fw = keeper ? 0.12 : Math.max(0, Math.min(1, (ea - 0.3) / 1.0));
      curl[l] = { ax: norm(cross(f, pn)), w: keeper ? fw : fw * fw * (3 - 2 * fw) };
    }
    // pelvis: its own frame when the body has one (it counter-rotates against the shoulders), else the trunk frame;
    // the spine bones then turn from the pelvis toward the trunk in stages, so lean and twist bend through the back
    const bindF = m3T([rig.F, rig.U, rig.Rt]);
    const trunkD = m3mul([body.F, body.U, body.Rt], bindF);
    const pelvisD = body.P ? m3mul([body.P.F, body.P.U, body.P.Rt], bindF) : trunkD;
    const SPINE = body.P ? { spine_01: 0.4, spine_02: 0.72, spine_03: 1.0 } : {};
    if (body.P) delete drive[BONES.spine];
    const hU = body.H && (body.H.U || [0, 0, 1]);
    const headD = body.H ? m3mul([body.H.F, hU, norm(cross(body.H.F, hU))], bindF) : null;
    for (const i of rig.order) {
      const p = rig.parent[i], nm = rig.names[i];
      const Dp = p >= 0 ? D[p] : I3;
      const L = limb[nm];
      if (L && L.shift) {   // leg: the hip at the model's own hip width, the knee most of the way (knees not pulled
        // together), the ankle where the body plants it
        const fk = add(pos[p], mul(m3v(Dp, sub(bp[i], bp[p])), s));
        const pRt = (body.P || body).Rt, dv = mul(pRt, dot(sub(fk, L.leg.hip), pRt));
        const lo = rig.names[i].replace('thigh', 'calf');
        const hp = add(L.leg.hip, dv), kn = add(L.leg.knee, mul(dv, 0.6));
        place[nm] = hp; place[lo] = kn;
        drive[nm] = [drive[nm][0], sub(kn, hp)]; drive[lo] = [drive[lo][0], sub(L.leg.ankle, kn)];
      } else if (L) {                             // two-bone limb from its own root (forward kinematics) to the target
        const root = add(pos[p], mul(m3v(Dp, sub(bp[i], bp[p])), s));
        const lo = idx[L.lower], en = idx[L.end];
        let l1 = Math.hypot(...sub(bp[lo], bp[i])) * s, l2 = Math.hypot(...sub(bp[en], bp[lo])) * s;
        const d = sub(L.tgt, root);
        let dl = Math.hypot(...d);
        // soft IK: near full extension the bend eases out exponentially and the bones stretch a little (≤ ~3 %) to
        // still reach, so a straightening knee never snaps (plain IK's knee angle changes infinitely fast there)
        const Dm = l1 + l2, ds = Dm * 0.94, sf = Dm - ds;
        const de = dl > ds ? ds + sf * (1 - Math.exp(-(dl - ds) / sf)) : dl;
        l1 *= dl / de; l2 *= dl / de;
        dl = Math.max(dl, Math.abs(l1 - l2) + 1e-4);
        const u = norm(d), a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        let q = sub(L.hint, mul(u, dot(L.hint, u)));
        if (Math.hypot(...q) < 1e-6) q = body.F;
        q = norm(sub(q, mul(u, dot(q, u))));
        const mid = add(root, add(mul(u, a), mul(q, h)));
        drive[nm] = [sub(bp[lo], bp[i]), sub(mid, root)];
        drive[L.lower] = [sub(bp[en], bp[lo]), sub(L.tgt, mid)];
        place[L.lower] = mid; place[L.end] = L.tgt;
      }
      if (nm === BONES.pelvis) D[i] = pelvisD;
      else if (SPINE[nm] !== undefined) D[i] = partialRot(pelvisD, trunkD, SPINE[nm]);
      else if (nm === BONES.head && headD) D[i] = partialRot(Dp, headD, body.H.w);   // head held level, looking ahead
      else if (drive[nm]) {
        const cur = norm(m3v(Dp, drive[nm][0])), tgt = norm(drive[nm][1]);
        D[i] = m3mul(arc(cur, tgt), Dp);
        const tw = twist[nm];
        if (tw) {                                 // palm toward the body, about the forearm's own axis
          const ax = norm(m3v(D[i], tw.fore));
          const c0 = m3v(D[i], tw.pn), cu = sub(c0, mul(ax, dot(c0, ax))), wa = sub(tw.medial, mul(ax, dot(tw.medial, ax)));
          const wl = Math.hypot(...wa), cl = Math.hypot(...cu);
          if (cl > 1e-6 && wl > 1e-6) {
            // fades out when the forearm points across the body (a keeper's palm always turns to the ball)
            const w = tw.full ? Math.min(1, wl / 0.15) : Math.max(0, Math.min(1, (wl - 0.25) / 0.35));
            const th = Math.atan2(dot(cross(cu, wa), ax), dot(cu, wa)) * w * w * (3 - 2 * w);
            D[i] = m3mul(rotAA(ax, th), D[i]);
          }
        }
      } else {
        const fm = /^(index|middle|ring|pinky|thumb)_0([123])_([lr])$/.exec(nm);
        const cu = fm && curl[fm[3]], j = fm ? +fm[2] - 1 : 0;
        const ang = cu ? (fm[1] === 'thumb' ? 0.1 + 0.25 * cu.w : [0.2, 0.32, 0.25][j] + ([0.6, 0.75, 0.5][j] - [0.2, 0.32, 0.25][j] + 0.1) * cu.w) : 0;
        D[i] = cu ? m3mul(Dp, rotAA(cu.ax, ang)) : Dp;
      }
      pos[i] = place[nm] || (p >= 0 ? add(pos[p], mul(m3v(Dp, sub(bp[i], bp[p])), s)) : body.pelvis);
    }
    // skinning matrix = [s·Δ·C·R_bind | pos] · IBM   (vertices are in glTF model space)
    out = out || new Float32Array(n * 16);
    const M = new Float64Array(16);
    for (let i = 0; i < n; i++) {
      const R = m3mul(D[i], rig.bindRot[i]);
      M[0] = R[0][0] * s; M[1] = R[0][1] * s; M[2] = R[0][2] * s; M[3] = 0;
      M[4] = R[1][0] * s; M[5] = R[1][1] * s; M[6] = R[1][2] * s; M[7] = 0;
      M[8] = R[2][0] * s; M[9] = R[2][1] * s; M[10] = R[2][2] * s; M[11] = 0;
      M[12] = pos[i][0]; M[13] = pos[i][1]; M[14] = pos[i][2]; M[15] = 1;
      const I = rig.ibm.subarray(i * 16, i * 16 + 16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        out[i * 16 + c * 4 + r] = M[r] * I[c * 4] + M[4 + r] * I[c * 4 + 1] + M[8 + r] * I[c * 4 + 2] + M[12 + r] * I[c * 4 + 3];
      }
    }
    return out;
  }

  /**
   * Per-vertex body region for painting kits: class of the most-weighted bone and the position t (0..1) along
   * that bone toward its child (so sleeves, shorts and socks can end part-way down a limb).
   * Classes: 0 head/neck, 1 torso, 2 pelvis (hips/seat), 3 upper arm, 4 forearm, 5 hand, 6 thigh, 7 shin, 8 foot.
   */
  function regions(rig, prim) {
    const nv = prim.pos.length / 3, cls = new Float32Array(nv), tt = new Float32Array(nv);
    const childOf = { thigh: 'calf', calf: 'foot', upperarm: 'lowerarm', lowerarm: 'hand' };
    const classOf = (nm) => {
      if (/^(Head|neck)/.test(nm)) return 0;
      if (/^(spine|clavicle)/.test(nm)) return 1;
      if (/^pelvis|^root/.test(nm)) return 2;
      if (/^upperarm/.test(nm)) return 3;
      if (/^lowerarm/.test(nm)) return 4;
      if (/^(hand|thumb|index|middle|ring|pinky)/.test(nm)) return 5;
      if (/^thigh/.test(nm)) return 6;
      if (/^calf/.test(nm)) return 7;
      if (/^(foot|ball)/.test(nm)) return 8;
      return 1;
    };
    const pelvisZ = rig.bindPos[rig.index.pelvis][2];
    // per-vertex nearest point on its bone's axis (glTF coordinates), so a "build" factor can slim or broaden
    // the body around its skeleton before skinning (the head is left alone)
    const axis = new Float32Array(nv * 3);
    const nextOf = { pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', clavicle_l: 'upperarm_l', clavicle_r: 'upperarm_r',
      thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r',
      upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r' };
    const fromSim = (p) => [p[0], p[2], -p[1]];
    for (let v = 0; v < nv; v++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) if (prim.weights[v * 4 + k] > bw) { bw = prim.weights[v * 4 + k]; best = prim.joints[v * 4 + k]; }
      const nm = rig.names[best], c = classOf(nm);
      const p = toSim([prim.pos[v * 3], prim.pos[v * 3 + 1], prim.pos[v * 3 + 2]]);
      cls[v] = c === 2 && p[2] > pelvisZ + 0.07 ? 1 : c;          // the waist above the belt line is shirt
      // twist bones (upperarm_twist_01_l …) measure along their main bone, or a forearm vertex reads as t = 0 (sleeve)
      const side = nm.slice(-2), base = nm.replace(/_[lr]$/, '').replace(/_twist_\d+$/, '');
      if (childOf[base] && rig.index[base + side] !== undefined) {
        const a = rig.bindPos[rig.index[base + side]], b = rig.bindPos[rig.index[childOf[base] + side]];
        const ab = sub(b, a);
        tt[v] = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
        // forearm and shin continue past 1 (1…2): a triangle at the elbow or knee that is painted by its upper-arm
        // or thigh corner then interpolates past the sleeve / shorts hem instead of back to 0
        if (base === 'lowerarm' || base === 'calf') tt[v] += 1;
      }
      // axis point: projection onto the bone segment (bone → next joint), or the joint itself
      let ap = rig.bindPos[best];
      const nx = nextOf[nm];
      if (nx && rig.index[nx] !== undefined) {
        const a = rig.bindPos[best], b = rig.bindPos[rig.index[nx]], ab = sub(b, a);
        const u = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
        ap = add(a, mul(ab, u));
      }
      if (c === 0) ap = p;                                         // head and neck keep their shape
      const g = fromSim(ap);
      axis[v * 3] = g[0]; axis[v * 3 + 1] = g[1]; axis[v * 3 + 2] = g[2];
    }
    return { cls, t: tt, axis };
  }

  // ───────────── packed assets v2 → typed arrays ─────────────
  function bytes(s) {
    if (typeof atob === 'function') { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
    return Uint8Array.from(Buffer.from(s, 'base64'));
  }
  const view = (s, T) => { const u = bytes(s); return new T(u.buffer, u.byteOffset, u.byteLength / T.BYTES_PER_ELEMENT); };
  const f32 = (a, k) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * k; return o; };
  /** Decode FK_PLAYER_ASSETS v2: the shared base, and a function returning one player's shape (or null). */
  function decodeV2(A) {
    const m = A.mh;
    const base = {
      names: m.names, parent: m.parent, uv: f32(view(m.uv, Uint16Array), 1 / 65535),
      joints: f32(view(m.joints, Uint8Array), 1), weights: f32(view(m.weights, Uint8Array), 1 / 255),
      idx: Uint32Array.from(view(m.idx, Uint16Array)), orig: Uint32Array.from(view(m.orig, Uint16Array)),
      eye: { pos: view(m.eye.pos, Float32Array), uv: view(m.eye.uv, Float32Array), idx: Uint32Array.from(view(m.eye.idx, Uint16Array)) },
    };
    // weights were quantised to bytes: renormalise each vertex
    for (let v = 0; v < base.weights.length; v += 4) {
      const s = base.weights[v] + base.weights[v + 1] + base.weights[v + 2] + base.weights[v + 3] || 1;
      for (let k = 0; k < 4; k++) base.weights[v + k] /= s;
    }
    base.shells = {};
    for (const k of Object.keys(m.shells || {})) {
      const s = m.shells[k];
      base.shells[k] = { idx: Uint32Array.from(view(s.idx, Uint16Array)), uv: view(s.uv, Float32Array), prof: f32(view(s.prof, Uint8Array), 1 / 255),
        joints: f32(view(s.joints, Uint8Array), 1), weights: f32(view(s.weights, Uint8Array), 1 / 255) };
      const w = base.shells[k].weights;
      for (let v = 0; v < w.length; v += 4) { const t = w[v] + w[v + 1] + w[v + 2] + w[v + 3] || 1; for (let q = 0; q < 4; q++) w[v + q] /= t; }
    }
    // MakeHuman proxies (hair, eyebrows, eyelashes, eyes): shared topology, positions per player
    base.proxies = {};
    for (const k of Object.keys(m.proxies || {})) {
      const s = m.proxies[k];
      base.proxies[k] = { idx: Uint32Array.from(view(s.idx, Uint16Array)), uv: view(s.uv, Float32Array), part: s.part, tex: s.tex,
        joints: f32(view(s.joints, Uint8Array), 1), weights: f32(view(s.weights, Uint8Array), 1 / 255) };
      const w = base.proxies[k].weights;
      for (let v = 0; v < w.length; v += 4) { const t = w[v] + w[v + 1] + w[v + 2] + w[v + 3] || 1; for (let q = 0; q < 4; q++) w[v + q] /= t; }
    }
    const shape = (id) => {
      const s = A.shapes[id];
      if (!s) return null;
      const hair = {};
      for (const k of Object.keys(s.hair || {})) hair[k] = f32(view(s.hair[k], Int16Array), 1e-4);
      return { pos: f32(view(s.pos, Int16Array), 1e-4), joints: Float32Array.from(s.joints), eyes: s.eyes, hair,
        main: s.main || null, brows: s.brows || null, skin: s.skin || null, browW: s.browW || 0.5 };
    };
    return { base, shape };
  }

  return { parseGltf, makeRig, poseRig, regions, fromShape, shellPrim, decodeV2, BONES, toSim, invert4 };
});
