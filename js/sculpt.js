/*
 * Free Kick Simulator — sculpted body parts (pure geometry, DOM-free, testable in Node).
 *
 * Static parts (built once): head, hair styles, beard, hands, boots — as displaced spheres in a local frame
 *   x = right, y = forward, z = up (metres, for a 1.80 m adult; the renderer scales by height).
 * Dynamic parts (built every frame): limbs as continuous anatomical tubes along the joint chain
 *   (hip→knee→ankle, shoulder→elbow→wrist), with muscle bulges and the kit painted per vertex.
 * Vertex layout of every mesh: position(3) + normal(3), triangles, no index buffer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FKSculpt = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const g2 = (dx, dz, sx, sz) => Math.exp(-((dx / sx) ** 2 + (dz / sz) ** 2));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  /**
   * Mesh from a parametric surface pos(u, v), u ∈ [0,1) around (wraps), v ∈ [0,1] from one end to the other.
   * Normals from finite differences, oriented outward from `centre`.
   */
  function gridMesh(nu, nv, pos, centre) {
    const P = [];
    for (let j = 0; j <= nv; j++) { const row = []; for (let i = 0; i <= nu; i++) row.push(pos((i % nu) / nu, j / nv)); P.push(row); }
    const N = [];
    for (let j = 0; j <= nv; j++) {
      const row = [];
      for (let i = 0; i <= nu; i++) {
        const a = P[j][i < nu ? i + 1 : 1], b = P[j][i > 0 ? i - 1 : nu - 1];
        const c = P[Math.min(j + 1, nv)][i], d = P[Math.max(j - 1, 0)][i];
        const p = P[j][i], o = centre || [0, 0, 0];
        const cr = cross(sub(a, b), sub(c, d));
        let n = Math.hypot(cr[0], cr[1], cr[2]) > 1e-12 ? norm(cr) : norm(sub(p, o));   // poles: radial
        if ((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2] < 0) n = [-n[0], -n[1], -n[2]];
        row.push(n);
      }
      N.push(row);
    }
    const v = [];
    const put = (j, i) => { const p = P[j][i], n = N[j][i]; v.push(p[0], p[1], p[2], n[0], n[1], n[2]); };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      put(j, i); put(j, i + 1); put(j + 1, i + 1);
      put(j, i); put(j + 1, i + 1); put(j + 1, i);
    }
    return new Float32Array(v);
  }
  /** Unit direction from (azimuth u around z, elevation v from +90° to −90°); azimuth 0 = forward (+y). */
  const dirOf = (u, e) => { const a = u * Math.PI * 2; return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]; };

  // ───────────── head ─────────────
  const HEAD = { rx: 0.081, ry: 0.097, rz: 0.113 };
  /** Sculpted head surface point for a unit direction d. */
  function headPoint(d) {
    let x = d[0] * HEAD.rx, y = d[1] * HEAD.ry, z = d[2] * HEAD.rz;
    if (z < 0) {                                         // jaw: narrows and comes forward toward the chin
      const t = -d[2];
      x *= 1 - 0.3 * t * t;
      y = y * (1 - 0.12 * t) + (d[1] > 0 ? 0.006 * t : -0.02 * t * t);
    }
    if (d[1] < 0 && d[2] > -0.2) y *= 1.07;              // occiput
    const front = smooth(0.2, 0.6, d[1]);
    if (front > 0) {
      y += front * (0.024 * g2(x, z + 0.004, 0.011, 0.024)          // nose
        + 0.003 * g2(x, z + 0.03, 0.006, 0.004)                      // nose tip / nostrils
        + 0.007 * (g2(x - 0.03, z - 0.034, 0.024, 0.008) + g2(x + 0.03, z - 0.034, 0.024, 0.008))   // brow ridge
        - 0.008 * (g2(x - 0.031, z - 0.015, 0.012, 0.009) + g2(x + 0.031, z - 0.015, 0.012, 0.009)) // eye sockets
        + 0.005 * g2(x, z + 0.077, 0.02, 0.012)                      // chin
        + 0.0035 * g2(x, z + 0.046, 0.018, 0.005)                    // upper lip
        + 0.003 * g2(x, z + 0.056, 0.016, 0.005));                   // lower lip
      x += Math.sign(x) * front * 0.005 * g2(Math.abs(x) - 0.048, z + 0.012, 0.02, 0.018);   // cheekbones
    }
    const side = smooth(0.75, 0.92, Math.abs(d[0]));       // ears
    if (side > 0) x += Math.sign(x) * side * 0.017 * g2(y + 0.006, z + 0.004, 0.017, 0.03);
    return [x, y, z];
  }
  function headMesh() { return gridMesh(40, 30, (u, v) => headPoint(dirOf(u, Math.PI / 2 - v * Math.PI)), [0, 0, -0.01]); }
  const EYES = { x: 0.031, y: 0.081, z: 0.015 };          // where the eyes sit in the head frame

  // ───────────── hair and beard ─────────────
  /** Hairline elevation (radians) at azimuth u: high at the forehead, lower at the sides and the back. */
  function hairline(u, style) {
    const a = u * Math.PI * 2, fwd = Math.cos(a);           // 1 = front, −1 = back
    const front = 0.55, sideE = 0.05;
    const back = style === 'long' ? -1.0 : style === 'buzz' ? -0.45 : -0.55;
    return fwd > 0 ? sideE + (front - sideE) * fwd * fwd : sideE + (back - sideE) * fwd * fwd;
  }
  function hairMesh(style) {
    const thick = style === 'buzz' ? 0.0035 : style === 'long' ? 0.014 : 0.01;
    return gridMesh(40, 18, (u, v) => {
      const e = Math.PI / 2 - v * (Math.PI / 2 - hairline(u, style));
      const d = dirOf(u, e), p = headPoint(d);
      let t = thick * (0.6 + 0.4 * Math.sin(e));            // thinner toward the hairline
      if (style === 'long' && d[1] < 0.2) t += 0.008 * (1 - v);       // volume at the back
      const top = style === 'short' || style === 'bun' ? 0.006 * Math.max(0, d[1]) * Math.sin(e) : 0;   // a little lift at the front
      return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * (t + top)];
    }, [0, 0, 0]);
  }
  function beardMesh() {
    // front lower face: azimuth ±80° around forward, from cheek height down under the chin
    return gridMesh(28, 10, (u, v) => {
      const a = (u - 0.5) * 2.8, e = -0.18 - v * 1.0;
      const d = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)], p = headPoint(d);
      const mouth = g2(d[0] * 0.08, p[2] + 0.05, 0.022, 0.008);        // keep the lips clear
      const t = 0.0045 * (1 - mouth) * smooth(0.0, 0.25, Math.cos(a));
      return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
    }, [0, 0, 0]);
  }

  // ───────────── hands, gloves, boots ─────────────
  /** A relaxed hand: palm and fingers as one rounded block, thumb on the `side` (+1 = +x). z = along the fingers. */
  function handMesh(side) {
    return gridMesh(20, 16, (u, v) => {
      const d = dirOf(u, Math.PI / 2 - v * Math.PI);
      let x = d[0] * 0.038, y = d[1] * 0.014, z = d[2] * 0.066 + 0.045;
      x *= 1 - 0.18 * smooth(0.2, 1, d[2]);                    // fingers narrower than the palm
      y += 0.006 * smooth(-0.2, 0.6, d[2]) * (d[1] > 0 ? 1 : 0);   // curled fingers
      const th = g2(d[0] * side - 0.8, d[2] + 0.1, 0.35, 0.35);  // thumb
      x += side * 0.016 * th; z -= 0.01 * th;
      return [x, y, z];
    }, [0, 0, 0.04]);
  }
  function gloveMesh() {
    return gridMesh(20, 16, (u, v) => {
      const d = dirOf(u, Math.PI / 2 - v * Math.PI);
      let x = d[0] * 0.058, y = d[1] * 0.028, z = d[2] * 0.085 + 0.055;
      x *= 1 - 0.1 * smooth(0.3, 1, d[2]);
      const th = g2(d[0] - 0.8, d[2] + 0.1, 0.35, 0.35); x += 0.02 * th;
      return [x, y, z];
    }, [0, 0, 0.055]);
  }
  /**
   * Football boot, lofted heel → toe from rounded-rectangle sections. Local origin at the ankle joint,
   * y = toward the toe, z = up. Heel counter and ankle collar wrap the ankle (so the leg grows out of the boot,
   * not out of a flat sole), the instep slopes down, the toe box is low and rounded, the sole is flat.
   */
  function bootMesh() {
    const L0 = -0.068, L1 = 0.212, sole = -0.074;
    const widthAt = (v) => 0.031 + 0.017 * smooth(0.05, 0.55, v) - 0.012 * smooth(0.7, 1.0, v);
    const topAt = (v) => 0.038 - 0.05 * smooth(0.25, 0.55, v) - 0.026 * smooth(0.6, 0.95, v);
    return gridMesh(26, 30, (u, v) => {
      const y = L0 + v * (L1 - L0);
      const e = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * v - 1), 7)));     // rounded heel and toe caps
      const top = topAt(v), zc = (top + sole) / 2, hh = (top - sole) / 2;
      const a = u * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), p = 2 / 3.2;   // rounded-rectangle section
      const x = Math.sign(c) * Math.pow(Math.abs(c), p) * widthAt(v) * e;
      let z = zc + Math.sign(s) * Math.pow(Math.abs(s), p) * hh * (0.35 + 0.65 * e);
      if (z < sole) z = sole;
      return [x, y, z];
    }, [0, 0.07, -0.03]);
  }

  // ───────────── dynamic limbs ─────────────
  /**
   * Append a limb tube to `w` ({v: Float32Array, n}) — vertex layout pos(3) normal(3) colour(3) mode(1).
   * chain: [A, B, C] joint positions; fwd: hint for the limb's front (kneecap / biceps side).
   * radius(s, c): radius at parameter s ∈ [0,1] (by length) for direction cosine c (1 = front, −1 = back).
   * paint(s): [r, g, b, mode].  Returns the number of rings written (for indexing).
   */
  function tube(w, chain, fwd, rings, seg, radius, paint, edges) {
    const L1 = Math.hypot(...sub(chain[1], chain[0])), L2 = Math.hypot(...sub(chain[2], chain[1]));
    const Lt = L1 + L2 || 1, sJ = L1 / Lt;
    const T1 = norm(sub(chain[1], chain[0])), T2 = norm(sub(chain[2], chain[1]));
    const start = w.n;
    // ring positions: evenly spaced, plus a pair of rings hugging every colour edge (hem of the shorts, top of
    // the socks, end of a sleeve) so the kit stops crisply instead of blending into the skin
    const S = [];
    for (let r = 0; r < rings; r++) S.push(r / (rings - 1));
    for (const e of edges || []) if (e > 0.01 && e < 0.99) S.push(e - 0.004, e + 0.004);
    S.sort((a, b) => a - b);
    rings = S.length;
    for (let r = 0; r < rings; r++) {
      const s = S[r];
      const c = s <= sJ ? lerp3(chain[0], chain[1], s / sJ) : lerp3(chain[1], chain[2], (s - sJ) / (1 - sJ));
      const bl = smooth(sJ - 0.08, sJ + 0.08, s);
      const T = norm([T1[0] * (1 - bl) + T2[0] * bl, T1[1] * (1 - bl) + T2[1] * bl, T1[2] * (1 - bl) + T2[2] * bl]);
      const fd = fwd[0] * T[0] + fwd[1] * T[1] + fwd[2] * T[2];
      let N1 = [fwd[0] - fd * T[0], fwd[1] - fd * T[1], fwd[2] - fd * T[2]];
      if (Math.hypot(N1[0], N1[1], N1[2]) < 0.2) {             // hint nearly along the limb: use any perpendicular
        const alt = Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        const ad = alt[0] * T[0] + alt[1] * T[1] + alt[2] * T[2];
        N1 = [alt[0] - ad * T[0], alt[1] - ad * T[1], alt[2] - ad * T[2]];
      }
      N1 = norm(N1);
      const N2 = cross(T, N1);
      const col = paint(s);
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const rr = radius(s, ca);
        const dx = N1[0] * ca + N2[0] * sa, dy = N1[1] * ca + N2[1] * sa, dz = N1[2] * ca + N2[2] * sa;
        const o = w.n * 10, V = w.v;
        V[o] = c[0] + dx * rr; V[o + 1] = c[1] + dy * rr; V[o + 2] = c[2] + dz * rr;
        V[o + 3] = dx; V[o + 4] = dy; V[o + 5] = dz;
        V[o + 6] = col[0]; V[o + 7] = col[1]; V[o + 8] = col[2]; V[o + 9] = col[3];
        w.n++;
      }
    }
    // indices (quads between consecutive rings)
    for (let r = 0; r < rings - 1; r++) for (let i = 0; i < seg; i++) {
      const a = start + r * seg + i, b = start + r * seg + (i + 1) % seg, c = a + seg, d = b + seg;
      w.idx[w.ni++] = a; w.idx[w.ni++] = b; w.idx[w.ni++] = d;
      w.idx[w.ni++] = a; w.idx[w.ni++] = d; w.idx[w.ni++] = c;
    }
    return { sJ };
  }
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

  /** Leg radius profile (m, ×k): thigh with quadriceps, a slim knee, a calf bulge behind the shin, a thin ankle. */
  function legRadius(sJ, k) {
    return (s, c) => {
      if (s <= sJ) {
        const u = s / sJ;
        const base = 0.075 - 0.027 * u;
        return k * (base + 0.011 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * Math.max(0, c) ** 1.5    // quadriceps (front)
          + 0.006 * Math.sin(Math.PI * u) * Math.max(0, -c) - 0.004 * bump(u, 1, 0.12));             // hamstring; knee narrows
      }
      const v = (s - sJ) / (1 - sJ);
      const base = 0.047 - 0.022 * v;
      return k * (base + 0.017 * bump(v, 0.28, 0.17) * Math.max(0, -c) ** 1.2                     // calf (back)
        + 0.004 * bump(v, 0.05, 0.08) * Math.max(0, c));                                           // below the kneecap
    };
  }
  /** Arm radius profile: deltoid at the top, biceps in front, forearm bulge below the elbow, slim wrist. */
  function armRadius(sJ, k) {
    return (s, c) => {
      if (s <= sJ) {
        const u = s / sJ;
        return k * (0.047 - 0.011 * u + 0.014 * bump(u, 0.04, 0.16)
          + 0.007 * bump(u, 0.5, 0.22) * Math.max(0, c) ** 1.5 + 0.003 * bump(u, 0.45, 0.25) * Math.max(0, -c));
      }
      const v = (s - sJ) / (1 - sJ);
      return k * (0.037 - 0.013 * v + 0.006 * bump(v, 0.22, 0.2));
    };
  }

  return { gridMesh, headMesh, headPoint, hairMesh, beardMesh, handMesh, gloveMesh, bootMesh, tube, legRadius, armRadius, EYES, HEAD };
});
