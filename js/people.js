/*
 * Free Kick Simulator — people: skeletons, poses and the selectable free-kick takers.
 *
 * Pure and DOM-free (runs in Node for tests). Every function returns joint positions in world metres;
 * the renderer only draws them. Nothing here feeds back into the ball physics: the keeper's body comes from
 * the physics engine (js/physics.js) and is only dressed here, and the kicker's animation is timed so the
 * boot meets the ball at t = 0 of the simulation.
 *
 * Frame conventions (world): +z up. A body frame is F (facing), U (up), Rt = F × U (the person's right).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FKPeople = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────── vectors ─────────────
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  /** p + a·A + b·B + c·C */
  const comb = (p, a, A, b, B, c, C) => [p[0] + a * A[0] + b * B[0] + c * C[0], p[1] + a * A[1] + b * B[1] + c * C[1], p[2] + a * A[2] + b * B[2] + c * C[2]];

  // ───────────── body dimensions (for a 1.80 m adult; scaled by height / 1.8) ─────────────
  const DIM = {
    pelvis: 0.97, hipW: 0.095, thigh: 0.45, shin: 0.44, foot: 0.2, ankle: 0.075,
    spine: 0.52, shoulderW: 0.19, upperArm: 0.29, foreArm: 0.27, neck: 0.1, head: 0.13,
  };

  /** Two-bone inverse kinematics: middle joint for a chain root→target, bending toward `hint`. */
  function ik2(rootP, target, l1, l2, hint) {
    let d = sub(target, rootP);
    let dl = len(d);
    const maxL = (l1 + l2) * 0.999;
    if (dl > maxL) { target = add(rootP, mul(d, maxL / dl)); d = sub(target, rootP); dl = maxL; }
    dl = Math.max(dl, Math.abs(l1 - l2) + 1e-4);
    const u = norm(d);
    const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    let p = sub(hint, mul(u, dot(hint, u)));
    if (len(p) < 1e-6) p = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    p = norm(sub(p, mul(u, dot(p, u))));
    return { mid: comb(rootP, a, u, h, p, 0, u), end: target };
  }

  /**
   * Forward kinematics from joint angles. `pose` (radians):
   *   lean (forward), side (toward the right), twist (shoulders turn right), drop (pelvis lowered, m),
   *   L/R legs: { hip (+ forward swing), abd (+ outward), knee (+ flexion), pitch (foot, + toe up) }
   *   aL/aR arms: { flex (+ forward), abd (+ sideways raise), elbow (+ flexion) }
   */
  function forward(origin, F, height, pose) {
    const k = height / 1.8;
    const U = [0, 0, 1];
    const Rt = norm(cross(F, U));
    const pelvis = comb(origin, DIM.pelvis * k - (pose.drop || 0), U, 0, F, 0, Rt);
    // the pelvis has its own frame: it turns against the shoulders while running (ptw) and takes only a third of the
    // trunk's lean, so the spine bends through its length instead of the whole torso pivoting at the hips
    let pU0 = norm(comb([0, 0, 0], Math.cos(pose.lean || 0), U, Math.sin(pose.lean || 0), F, 0, Rt));
    pU0 = norm(comb([0, 0, 0], Math.cos(pose.side || 0), pU0, Math.sin(pose.side || 0), Rt, 0, F));
    const pU = norm(comb([0, 0, 0], 0.7, U, 0.3, pU0, 0, U));
    const ptw = pose.ptw || 0;
    let pF = norm(comb([0, 0, 0], Math.cos(ptw), F, Math.sin(ptw), Rt, 0, U));
    pF = norm(sub(pF, mul(pU, dot(pF, pU))));
    const pRt = cross(pF, pU);
    const legs = {};
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const g = pose[side];
      const hip = comb(pelvis, -0.06 * k + (g.hike || 0), pU, 0, pF, s * DIM.hipW * k, pRt);   // hike: pelvic tilt lifts this hip
      const dir = (a) => {
        const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(g.abd || 0), sb = Math.sin(g.abd || 0);
        return norm(comb([0, 0, 0], -ca * cb, U, sa * cb, F, s * sb, Rt));
      };
      const knee = add(hip, mul(dir(g.hip), DIM.thigh * k));
      const ankle = add(knee, mul(dir(g.hip - g.knee), DIM.shin * k));
      const fp = g.pitch !== undefined ? g.pitch : clamp((g.hip - g.knee) * 0.5, -0.5, 0.6);
      const footF = norm(sub(F, mul(Rt, dot(F, Rt))));
      const toe = comb(ankle, Math.sin(fp) * DIM.foot * k, U, Math.cos(fp) * DIM.foot * k, footF, s * 0.015, Rt);
      legs[side] = { hip, knee, ankle, toe };
    }
    // spine: lean forward, bend sideways, twist
    let Up = norm(comb([0, 0, 0], Math.cos(pose.lean || 0), U, Math.sin(pose.lean || 0), F, 0, Rt));
    Up = norm(comb([0, 0, 0], Math.cos(pose.side || 0), Up, Math.sin(pose.side || 0), Rt, 0, F));
    let Fp = norm(sub(F, mul(Up, dot(F, Up))));
    let Rp = cross(Fp, Up);
    const tw = pose.twist || 0;
    [Fp, Rp] = [norm(comb([0, 0, 0], Math.cos(tw), Fp, Math.sin(tw), Rp, 0, Up)), norm(comb([0, 0, 0], Math.cos(tw), Rp, -Math.sin(tw), Fp, 0, Up))];
    const neck = add(pelvis, mul(Up, DIM.spine * k));
    const head = add(neck, mul(Up, (DIM.neck + DIM.head * 0.75) * k));
    const arms = {};
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const a = pose['a' + side];
      const sh = comb(neck, -0.045 * k, Up, 0, Fp, s * DIM.shoulderW * k, Rp);
      const cf = Math.cos(a.flex), sf = Math.sin(a.flex), ca = Math.cos(a.abd), sa = Math.sin(a.abd);
      const d = norm(comb([0, 0, 0], -ca * cf, Up, ca * sf, Fp, s * sa, Rp));
      const elbow = add(sh, mul(d, DIM.upperArm * k));
      let p = sub(Fp, mul(d, dot(Fp, d)));
      if (len(p) < 1e-4) p = Up;
      p = norm(p);
      const fa = norm(comb([0, 0, 0], Math.cos(a.elbow), d, Math.sin(a.elbow), p, 0, d));
      const hand = add(elbow, mul(fa, DIM.foreArm * k));
      arms[side] = { sh, elbow, hand };
    }
    const body = { pelvis, neck, head, U: Up, F: Fp, Rt: Rp, legs, arms, height, k, P: { F: pF, U: pU, Rt: pRt } };
    // head: looks along hF (the facing turned by head.yaw), held level with weight head.w against the trunk's lean/twist
    if (pose.head) {
      const hy = pose.head.yaw || 0, hp = pose.head.pitch || 0;            // pitch > 0: looking down
      const hF = norm(comb([0, 0, 0], Math.cos(hy), F, Math.sin(hy), Rt, 0, U));
      body.H = { F: norm(comb([0, 0, 0], Math.cos(hp), hF, -Math.sin(hp), U, 0, U)), U: norm(comb([0, 0, 0], Math.cos(hp), U, Math.sin(hp), hF, 0, U)), w: pose.head.w };
    }
    // plant the lower foot on the ground (plus any lift, e.g. a jump) so legs never sink into the pitch
    if (pose.ground !== undefined) {
      const low = Math.min(legs.L.ankle[2], legs.R.ankle[2], legs.L.toe[2] + DIM.ankle * k * 0.6, legs.R.toe[2] + DIM.ankle * k * 0.6);
      shiftBody(body, DIM.ankle * k + pose.ground - low);
    }
    return body;
  }

  function shiftBody(b, dz) {
    const mv = (p) => { p[2] += dz; };
    mv(b.pelvis); mv(b.neck); mv(b.head);
    for (const s of ['L', 'R']) {
      const l = b.legs[s], a = b.arms[s];
      mv(l.hip); mv(l.knee); mv(l.ankle); mv(l.toe); mv(a.sh); mv(a.elbow); mv(a.hand);
    }
  }

  // ───────────── wall players ─────────────
  const WALL_POSE = {
    lean: 0.06, drop: 0.03,
    L: { hip: 0.12, abd: 0.05, knee: 0.22 }, R: { hip: 0.12, abd: 0.05, knee: 0.22 },
    aL: { flex: 0.2, abd: 0.1, elbow: 1.2 }, aR: { flex: 0.2, abd: 0.1, elbow: 1.2 },
  };
  /** A defender in the wall: knees soft, hands covering, tucking the legs while in the air. */
  function wallBody(p, clock = 0) {
    const F = norm([p.faceX, p.faceY, 0]);
    const air = clamp(p.z / 0.25, 0, 1);
    const pose = JSON.parse(JSON.stringify(WALL_POSE));
    // alive while waiting: breathing, a little sway and shoulder turn, eyes on the ball (each player on his own clock)
    const c = clock, calm = 1 - air;
    pose.lean += (0.02 * Math.sin(c * 1.7) + 0.015 * Math.sin(c * 0.6)) * calm;
    pose.side = 0.03 * Math.sin(c * 0.9 + 0.5) * calm;
    pose.twist = 0.05 * Math.sin(c * 0.45) * calm;
    pose.ptw = -0.02 * Math.sin(c * 0.45) * calm;
    pose.head = { yaw: 0.15 * Math.sin(c * 0.33) * Math.sin(c * 0.21 + 2), w: 0.55 };
    for (const s of ['L', 'R']) { pose[s].knee += air * 0.55; pose[s].hip += air * 0.25; pose[s].pitch = -0.2 - air * 0.6; }
    pose.ground = p.z;
    let b = forward([p.x, p.y, 0], F, p.height, pose);
    // standing in the wall: the recorded standing (real weight shifts and sway, each player on his own clock),
    // blended into the tucked jump as he leaves the ground
    if (MOCAP && air < 1) {
      const k = p.height / 1.8, sI = LEG * k / MOCAP.idle.rest.leg;
      const J = placePose(sampleClip(MOCAP.idle.frames, MOCAP.idle.fps, clock, true, false), [p.x, p.y, 0], F, sI, DIM.ankle * k + p.z);
      b = blendBody(bodyFromPose(J, { height: p.height }), b, smooth(0, 1, air));
    }
    // hands meet in front of the groin (two-bone IK so the elbows stay natural)
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const tgt = comb(b.pelvis, -0.07 * b.k, b.U, 0.2 * b.k, b.F, s * 0.05 * b.k, b.Rt);
      const r = ik2(b.arms[side].sh, tgt, DIM.upperArm * b.k, DIM.foreArm * b.k, add(mul(b.Rt, s), mul(b.F, 0.2)));
      b.arms[side].elbow = r.mid; b.arms[side].hand = r.end;
    }
    return b;
  }

  // ───────────── goalkeeper (dressed from the physics body) ─────────────
  /**
   * k: the physics keeper (centre of mass cy,cz; body angle theta; ankles fy,fz; gloves hy,hz) at x = k.x.
   * The body plane is the goal plane; the keeper faces +x (up the pitch).
   */
  function keeperBody(k, clock = 0, ball = null) {
    const st = Math.sin(k.theta), ct = Math.cos(k.theta);
    const U = [0, st, ct], F = [1, 0, 0], Rt = norm(cross(F, U));
    // on his toes while waiting: a small bounce and a side-to-side sway (visual only; the physics body is unchanged)
    const waiting = k.state === 'ready' || k.state === 'watching';
    const bob = waiting ? 0.012 * Math.sin(clock * 7.5) : 0, sway = waiting ? 0.035 * Math.sin(clock * 1.9) : 0;
    const C = [k.x, k.cy + sway, k.cz + bob];
    const height = 1.88, kk = height / 1.8;
    let pelvis = add(C, mul(U, -0.1));
    const ready =k.state === 'ready' || k.state === 'set' || k.state === 'reach' || k.state === 'watching';
    // how far into the dive shape (0 = feet on the grass, 1 = full flight shape): the push extends the legs, in the
    // air the dive-side leg trails straight (it pushed last) while the top leg's knee drives up and forward, as in
    // every photo of a full-stretch save; once down the legs relax and on getting up they come back under him
    const T = k.clock || 0, push = (k.level && k.level.push) || 0.15;
    const fly = k.state === 'push' ? 0.4 * smooth(k.tPushEnd - push, k.tPushEnd, T)
      : k.state === 'air' ? 0.4 + 0.6 * smooth(k.tPushEnd, k.tPushEnd + 0.2, T)
      : k.state === 'down' ? 1 - 0.45 * smooth(k.tLand, k.tLand + 0.6, T)
      : k.state === 'getup' ? 0.55 * (1 - smooth(k.tGetup || 0, (k.tGetup || 0) + 0.5, T)) : 0;
    const ds = Math.sign(k.launchY || k.theta || 1);              // +1: diving toward +y
    // the set position: chest forward over the knees (visual only — the physics body is unchanged)
    // (lean and how far the hands have left the set position ease between states instead of switching in one frame:
    // the snaps from set → push → air read as a puppet)
    const setPos = k.state === 'ready' || k.state === 'set' || k.state === 'watching';
    const leanT = setPos ? 0.3 : k.state === 'reach' ? 0.15 : k.state === 'push' ? 0.12 : 0;
    const gwT = setPos ? 0 : 1;
    let vis = k._vis;
    if (!vis || T < vis.t - 1e-9) vis = k._vis = { t: T, lean: leanT, gw: gwT };
    const av = 1 - Math.exp(-Math.min(0.1, T - vis.t) * 11);
    vis.lean += (leanT - vis.lean) * av; vis.gw += (gwT - vis.gw) * av; vis.t = T;
    const lean = vis.lean, gw = vis.gw;
    // the set position is a real crouch: hips ~10 cm lower, knees bent, weight forward (visual only), easing out as
    // he moves
    pelvis = add(pelvis, [0, 0, -0.33 * lean]);
    const Uu =norm(add(mul(U, Math.cos(lean)), mul(F, Math.sin(lean))));
    const neck = add(pelvis, mul(Uu, 0.57));
    const head = add(neck, mul(Uu, (DIM.neck + DIM.head * 0.75) * kk));
    const legs = {}, arms = {};
    // reaching sideways, a keeper rolls his shoulders so both arms can stretch toward the ball:
    // the shoulder line loses most of its component along the reach direction
    const shMid = add(neck, mul(U, -0.045 * kk));
    const reachDir = norm(sub([k.x + 0.06, k.hy, k.hz], shMid));
    const along = dot(Rt, reachDir);
    const SL = norm(add(sub(Rt, mul(reachDir, along * 0.9)), mul(F, 0.3 * Math.abs(along))));
    // shuffling (set, reach, standing up): the feet step instead of sliding — each foot is offset from the moving body
    // by a sine of the distance travelled, so it alternately stands still and catches up, lifting as it does
    const onFeet = 1 - Math.min(1, fly * 2);
    const shufPh = Math.PI * (k.cy - (k.y0 || 0)) / 0.22, shufA = Math.min(1, Math.abs(k.cvy || 0) / 0.4) * onFeet;
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const hip = comb(pelvis, -0.06 * kk, U, 0, F, s * DIM.hipW * kk, Rt);
      // ankles on the grass: wide athletic stance when ready, under the hips otherwise
      const spread = ready ? 0.2 : 0.13;
      const ph = shufPh + s * Math.PI / 2;
      const ground = comb([k.x + 0.03, k.fy, k.fz], s * spread, Rt, 0.06, F, 0, U);
      ground[1] += 0.07 * Math.sin(ph) * onFeet; ground[2] += 0.05 * Math.max(0, Math.cos(ph)) * shufA;
      // the power step: as he pushes off, the dive-side foot steps toward the ball first (keepers never take off
      // from both feet planted side by side)
      if (k.state === 'push' && s * ds < 0) {
        const st0 = k.tPushEnd - push, pw = smooth(st0, st0 + push * 0.6, T);
        ground[1] += ds * 0.22 * pw; ground[2] += 0.05 * Math.sin(Math.PI * pw);
      }
      // in the air: the lower (dive-side) leg trails nearly straight, the top leg is tucked with the knee driven
      // forward; the legs separate instead of moving as one block
      const lower = s * ds < 0;
      const air = lower ? comb(hip, -0.86 * kk, U, -0.05 * kk, F, s * 0.05 * kk, Rt)
        : comb(hip, -0.6 * kk, U, 0.12 * kk, F, s * 0.12 * kk, Rt);
      let ankle = lerp3(ground, air, fly);
      if (ankle[2] < DIM.ankle) ankle[2] = DIM.ankle;
      const kneeHint = add(F, mul(U, 0.1 * (1 - fly)));
      const r = ik2(hip, ankle, DIM.thigh * kk, DIM.shin * kk, kneeHint);
      // toes forward on the grass, pointed along the shin in flight
      const toeDir = norm(lerp3(norm(comb([0, 0, 0], 1, F, 0.15 * s, Rt, 0, U)), norm(sub(r.end, r.mid)), fly));
      const toe = add(r.end, mul(toeDir, DIM.foot * kk * (1 - 0.1 * fly)));
      if (toe[2] < 0.02) toe[2] = 0.02;
      legs[side] = { hip, knee: r.mid, ankle: r.end, toe };
      const sh = add(shMid, mul(SL, s * DIM.shoulderW * kk));
      const glove = [k.x + 0.06, k.hy, k.hz];
      // both gloves around the glove centre, spread along the body's side axis (a "W" behind the ball)
      // (each hand on its own shoulder's side of the ball: the side axis is flipped to match the shoulder line, else
      // the arms crossed — one over the head, the other across the face)
      let perp = [0, Math.cos(k.phi), -Math.sin(k.phi)];
      if (dot(perp, SL) < 0) perp = mul(perp, -1);
      let gl = comb(glove, s * 0.09, perp, 0, F, 0, U);
      // at full stretch the top hand leads and the lower hand trails a little behind it (not two hands welded together)
      if (fly > 0 && !ready) {
        const armDir = [0, Math.sin(k.phi), Math.cos(k.phi)];
        const isLow = dot(perp, [0, 0, 1]) * s < 0;
        if (isLow) gl = comb(gl, -0.05 * fly, armDir, 0, perp, 0, U);
      }
      // set position: gloves low, wide and in front, palms toward the ball (the physics glove point is unused here)
      // (blended by gw, so the hands leave the set position over ~0.1 s rather than jumping to the reach)
      // hands low and wide, about thigh height — on his own side (his right is -y, facing up the pitch: the old +y
      // put each hand across his body and the arms crossed in an X)
      gl = lerp3(comb([k.x + 0.32, C[1], C[2] - 0.32], s * 0.38, Rt, 0, F, 0, U), gl, gw);
      if (gl[2] < 0.06) gl[2] = 0.06;
      // elbows out and forward; when the keeper is on his side, also up, so the lower elbow never digs into the grass
      const hint = ready ? add(mul(Rt, s), mul(F, 0.4)) : add(add(mul(Rt, s * 0.6), mul(F, 0.3)), [0, 0, 0.9 * Math.abs(st)]);
      // the wrist sits 7 cm short of the glove centre (the glove is drawn beyond the wrist)
      const toG = norm(sub(gl, sh));
      const wrist = sub(gl, mul(toG, 0.07));
      // keepers are long-armed: 12% over the outfield proportions so the far arm can reach the physics glove point
      const a = ik2(sh, wrist, DIM.upperArm * kk * 1.12, DIM.foreArm * kk * 1.12, hint);
      arms[side] = { sh, elbow: a.mid, hand: a.end };
    }
    const body = { pelvis, neck, head, U, F, Rt, legs, arms, height, k: kk, gloves: true };   // gloves: hands placed exactly
    // palms face the ball (toward the pitch while waiting; never back into his own net)
    if (ball) {
      const gc = lerp3(arms.L.hand, arms.R.hand, 0.5), tb = norm(sub(ball, gc));
      body.palm = norm(lerp3(F, tb[0] > 0.2 ? tb : norm([0.2, tb[1], tb[2]]), 0.7));
    }
    // eyes on the ball (the head turns within what a neck allows: never round to look into his own net)
    if (ball) {
      let d = norm(sub(ball, head));
      // the neck tilts the head at most ~37° along the body's own axis (looking "up" past his hands in a dive): the
      // head's up vector then stays well defined (looking straight along the trunk made it roll over)
      const du = dot(d, Uu);
      if (Math.abs(du) > 0.6) { const p = norm(sub(d, mul(Uu, du))); d = norm(add(mul(p, 0.8), mul(Uu, 0.6 * Math.sign(du)))); }
      const fw = dot(d, F);
      if (fw < 0.25) d = norm(add(sub(d, mul(F, fw)), mul(F, 0.25)));
      const hU = norm(sub(Uu, mul(d, dot(Uu, d))));
      body.H = { F: d, U: hU, w: 0.75 };
    }
    return body;
  }

  // ───────────── the free-kick takers ─────────────
  /*
   * Looks are deliberately generic (colours, hair, build) and the kits are plain national-style colours
   * with no crests. The "signature" kicks are approximate technique archetypes: speed and spin values are
   * typical of the style, not measurements of any specific goal.
   */
  const CHARACTERS = [
    { id: 'ronaldo', name: 'Cristiano Ronaldo', short: 'Ronaldo', foot: 'right', height: 1.87, build: 0.95,
      skin: [0.80, 0.60, 0.46], hair: [0.10, 0.08, 0.07], hairStyle: 'short', beard: false,
      kit: { shirt: [0.72, 0.08, 0.12], shirt2: [0.72, 0.08, 0.12], pattern: 0, shorts: [0.05, 0.36, 0.20], socks: [0.72, 0.08, 0.12], number: 7 },
      boots: [0.95, 0.85, 0.25], run: { steps: 5, angle: 12, speed: 3.1 },
      kick: { speed: 31, side: 0, top: 0.2, ty: -2.6, tz: 1.85, label: 'Knuckleball', note: 'Hit through the middle of the ball with almost no spin, so the flight wobbles' } },
    { id: 'messi', name: 'Lionel Messi', short: 'Messi', foot: 'left', height: 1.70, build: 0.84,
      skin: [0.85, 0.66, 0.53], hair: [0.20, 0.13, 0.08], hairStyle: 'short', beard: true,
      kit: { shirt: [0.55, 0.78, 0.93], shirt2: [0.97, 0.97, 0.97], pattern: 1, shorts: [0.08, 0.08, 0.10], socks: [0.08, 0.08, 0.10], number: 10 },
      boots: [0.96, 0.55, 0.15], run: { steps: 4, angle: 30, speed: 2.6 },
      kick: { speed: 25, side: 8.5, top: 2.5, ty: 3.15, tz: 2.05, label: 'Curler', note: 'Left foot, inside of the boot: lifted over the wall and curled into the corner' } },
    { id: 'carlos', name: 'Roberto Carlos', short: 'R. Carlos', foot: 'left', height: 1.68, build: 0.97,
      skin: [0.58, 0.40, 0.29], hair: [0.07, 0.06, 0.05], hairStyle: 'shaved', beard: false,   // shaved close: a painted shadow, no hair volume
      kit: { shirt: [0.98, 0.84, 0.10], shirt2: [0.98, 0.84, 0.10], pattern: 0, shorts: [0.10, 0.30, 0.65], socks: [0.96, 0.96, 0.96], number: 6 },
      boots: [0.08, 0.08, 0.09], run: { steps: 7, angle: 8, speed: 3.7 },
      kick: { speed: 36, side: -10, top: 0.5, ty: -3.2, tz: 1.0, label: 'Outside-foot swerve', note: 'Long run-up, struck with the outside of the left foot: starts wide, then swerves in' } },
    { id: 'beckham', name: 'David Beckham', short: 'Beckham', foot: 'right', height: 1.83, build: 0.9,
      skin: [0.90, 0.72, 0.60], hair: [0.36, 0.27, 0.17], hairStyle: 'short', beard: false,   // light brown, centre-parted curtains (1998)
      kit: { shirt: [0.96, 0.96, 0.96], shirt2: [0.96, 0.96, 0.96], pattern: 0, shorts: [0.08, 0.12, 0.32], socks: [0.96, 0.96, 0.96], number: 7 },
      boots: [0.08, 0.08, 0.09], run: { steps: 5, angle: 40, speed: 2.8 },
      kick: { speed: 27, side: -9, top: 2, ty: -3.15, tz: 2.0, label: 'Bender', note: 'Wide approach, body leaning back: heavy curl from right to left' } },
    { id: 'pirlo', name: 'Andrea Pirlo', short: 'Pirlo', foot: 'right', height: 1.77, build: 0.86,
      skin: [0.86, 0.68, 0.55], hair: [0.12, 0.09, 0.07], hairStyle: 'long', beard: true,
      kit: { shirt: [0.10, 0.34, 0.75], shirt2: [0.10, 0.34, 0.75], pattern: 0, shorts: [0.96, 0.96, 0.96], socks: [0.10, 0.34, 0.75], number: 21 },
      boots: [0.08, 0.08, 0.09], run: { steps: 4, angle: 25, speed: 2.4 },
      kick: { speed: 27, side: -2.5, top: 7, ty: -2.4, tz: 2.0, label: 'Dipping "maledetta"', note: 'Toes under the ball for heavy topspin: rises over the wall, then drops sharply' } },
    { id: 'juninho', name: 'Juninho Pernambucano', short: 'Juninho', foot: 'right', height: 1.78, build: 0.9,
      skin: [0.62, 0.44, 0.32], hair: [0.08, 0.07, 0.06], hairStyle: 'buzz', beard: false,
      kit: { shirt: [0.96, 0.96, 0.96], shirt2: [0.12, 0.22, 0.55], pattern: 2, shorts: [0.12, 0.22, 0.55], socks: [0.96, 0.96, 0.96], number: 8 },
      boots: [0.08, 0.08, 0.09], run: { steps: 5, angle: 15, speed: 3.0 },
      kick: { speed: 32, side: 0, top: 0.1, ty: 2.2, tz: 1.7, label: 'Knuckleball', note: 'Three toes on the valve, no follow-through: very little spin, late wobble' } },
    { id: 'ronaldinho', name: 'Ronaldinho', short: 'Ronaldinho', foot: 'right', height: 1.81, build: 0.88,
      skin: [0.52, 0.34, 0.24], hair: [0.07, 0.06, 0.05], hairStyle: 'long', beard: false, headband: true,   // curly locks, thin white band (2002)
      kit: { shirt: [0.98, 0.84, 0.10], shirt2: [0.1, 0.45, 0.25], pattern: 0, shorts: [0.10, 0.30, 0.65], socks: [0.96, 0.96, 0.96], number: 11 },
      boots: [0.96, 0.96, 0.96], run: { steps: 4, angle: 30, speed: 2.6 },
      kick: { speed: 23, side: -3, top: 2, ty: -3.0, tz: 2.1, label: 'Floated', note: 'A high, slower ball that drops late behind a keeper who is off his line' } },
    { id: 'koeman', name: 'Ronald Koeman', short: 'Koeman', foot: 'right', height: 1.78, build: 0.95,
      skin: [0.9, 0.72, 0.6], hair: [0.7, 0.56, 0.32], hairStyle: 'short', beard: false,
      kit: { shirt: [0.95, 0.5, 0.12], shirt2: [0.95, 0.5, 0.12], pattern: 0, shorts: [0.95, 0.95, 0.95], socks: [0.95, 0.5, 0.12], number: 4 },
      boots: [0.08, 0.08, 0.09], run: { steps: 6, angle: 10, speed: 3.6 },
      kick: { speed: 33, side: -1.5, top: -0.5, ty: 2.6, tz: 0.6, label: 'Driven', note: 'Laces, power, little curl: speed takes time away from the keeper' } },
    { id: 'mihajlovic', name: 'Siniša Mihajlović', short: 'Mihajlović', foot: 'left', height: 1.85, build: 0.95,
      skin: [0.88, 0.7, 0.58], hair: [0.12, 0.1, 0.08], hairStyle: 'buzz', beard: false,
      kit: { shirt: [0.55, 0.78, 0.92], shirt2: [0.55, 0.78, 0.92], pattern: 0, shorts: [0.96, 0.96, 0.96], socks: [0.55, 0.78, 0.92], number: 11 },
      boots: [0.08, 0.08, 0.09], run: { steps: 5, angle: 20, speed: 3.4 },
      kick: { speed: 31, side: 7, top: 1.5, ty: 3.0, tz: 1.9, label: 'Power curler', note: 'Left foot, hit hard with curl: power and bend together' } },
    { id: 'nakamura', name: 'Shunsuke Nakamura', short: 'Nakamura', foot: 'left', height: 1.78, build: 0.84,
      skin: [0.9, 0.76, 0.62], hair: [0.1, 0.08, 0.07], hairStyle: 'long', beard: false,
      kit: { shirt: [0.1, 0.55, 0.28], shirt2: [0.96, 0.96, 0.96], pattern: 2, shorts: [0.96, 0.96, 0.96], socks: [0.96, 0.96, 0.96], number: 25 },
      boots: [0.08, 0.08, 0.09], run: { steps: 4, angle: 30, speed: 2.4 },
      kick: { speed: 25, side: 9, top: 2, ty: 3.05, tz: 2.05, label: 'Placed curler', note: 'Spin and placement rather than power' } },
    { id: 'bale', name: 'Gareth Bale', short: 'Bale', foot: 'left', height: 1.85, build: 0.93,
      skin: [0.9, 0.73, 0.6], hair: [0.3, 0.2, 0.12], hairStyle: 'bun', beard: true,
      kit: { shirt: [0.78, 0.08, 0.12], shirt2: [0.78, 0.08, 0.12], pattern: 0, shorts: [0.78, 0.08, 0.12], socks: [0.78, 0.08, 0.12], number: 11 },
      boots: [0.95, 0.35, 0.2], run: { steps: 5, angle: 8, speed: 3.5 },
      kick: { speed: 32, side: 0, top: 0.3, ty: 2.4, tz: 1.9, label: 'Knuckleball', note: 'Straight through the ball from long range: little spin, a wobbling flight' } },
    { id: 'payet', name: 'Dimitri Payet', short: 'Payet', foot: 'right', height: 1.75, build: 0.93,
      skin: [0.80, 0.59, 0.45], hair: [0.08, 0.06, 0.05], hairStyle: 'short', beard: true,   // short dark hair, full trimmed beard
      kit: { shirt: [0.48, 0.10, 0.20], shirt2: [0.48, 0.10, 0.20], sleeves: [0.47, 0.74, 0.92], pattern: 0, trim: [0.47, 0.74, 0.92], shorts: [0.96, 0.96, 0.96], socks: [0.48, 0.10, 0.20], number: 27 },
      boots: [0.95, 0.95, 0.95], run: { steps: 4, angle: 32, speed: 2.7 },
      kick: { speed: 26, side: -8, top: 3, ty: -3.0, tz: 2.15, label: 'Whipped curler', note: 'Right foot, inside of the boot: whipped up over the wall and dipping into the far top corner' } },
  ];
  const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

  // keyframes of the last stride and the strike, for a RIGHT-footed kicker (K = kicking leg, S = standing leg);
  // a left-footer is the mirror image. t in seconds relative to the moment the boot meets the ball.
  // leg = [hip swing, knee flexion, foot pitch (0 = automatic), hip hike (m)]; arm = [flex, abduction, elbow]
  const KICK_KEYS = [
    { t: -0.45, lean: 0.18, side: 0.0, twist: 0.0, drop: 0.03, K: [0.55, 0.35, 0, 0], S: [-0.45, 1.25, 0, 0], aK: [-0.6, 0.15, 1.3], aS: [0.6, 0.15, 1.3] },
    { t: -0.26, lean: 0.12, side: -0.05, twist: 0.1, drop: 0.06, K: [-0.25, 0.55, 0, 0], S: [0.5, 0.45, 0, 0], aK: [0.35, 0.25, 1.0], aS: [-0.4, 0.5, 0.9] },
    { t: -0.1, lean: 0.0, side: -0.22, twist: 0.25, drop: 0.1, K: [-0.8, 1.8, -0.4, 0.05], S: [0.2, 0.35, 0, 0], aK: [-0.3, 0.45, 0.6], aS: [0.2, 1.35, 0.3] },
    { t: 0.0, lean: -0.1, side: -0.25, twist: -0.1, drop: 0.1, K: [0.5, 0.75, -0.6, 0.12], S: [-0.02, 0.38, 0, 0], aK: [-0.5, 0.35, 0.7], aS: [0.1, 1.45, 0.25] },
    { t: 0.16, lean: -0.14, side: -0.15, twist: -0.35, drop: 0.06, K: [1.05, 0.3, -0.5, 0.1], S: [-0.15, 0.3, 0, 0], aK: [-0.2, 0.5, 0.8], aS: [0.0, 1.1, 0.4] },
    { t: 0.42, lean: 0.08, side: -0.05, twist: -0.2, drop: 0.04, K: [0.35, 0.7, -0.1, 0.03], S: [-0.3, 0.25, 0, 0], aK: [0.2, 0.25, 0.9], aS: [-0.2, 0.5, 0.8] },
    { t: 0.75, lean: 0.03, side: 0, twist: 0, drop: 0.02, K: [0.02, 0.12, 0, 0], S: [-0.02, 0.12, 0, 0], aK: [0.05, 0.12, 0.35], aS: [0.05, 0.12, 0.35] },
  ];
  const IDLE = { lean: 0.02, side: 0, twist: 0, drop: 0.01, K: [0.03, 0.08, 0, 0], S: [-0.03, 0.08, 0, 0], aK: [0.05, 0.12, 0.3], aS: [0.05, 0.12, 0.3] };

  function interpKeys(t) {
    const K = KICK_KEYS;
    if (t <= K[0].t) return K[0];
    if (t >= K[K.length - 1].t) return K[K.length - 1];
    let i = 0;
    while (K[i + 1].t < t) i++;
    const a = K[i], b = K[i + 1], u = smooth(0, 1, (t - a.t) / (b.t - a.t));
    return mixKey(a, b, u);
  }
  function mixKey(a, b, u) {
    const o = {};
    for (const key of Object.keys(a)) {
      if (key === 't') continue;
      o[key] = Array.isArray(a[key]) ? a[key].map((v, i) => lerp(v, b[key][i], u)) : lerp(a[key], b[key], u);
    }
    return o;
  }

  /** Running cycle (same key layout), phase chosen to flow into the first strike key at t = -0.45. */
  function runKey(t) {
    const w = Math.PI / 0.3;                      // one step every 0.3 s
    const ph = w * (t + 0.45) + Math.PI / 2;      // at t = -0.45, the kicking leg is fully forward
    const hipK = 0.55 * Math.sin(ph), hipS = -hipK;
    const kneeOf = (h, p) => 0.35 + 0.95 * Math.max(0, Math.sin(p - 1.9));
    return {
      lean: 0.18, side: 0, twist: 0.08 * Math.sin(ph), drop: 0.03 - 0.03 * Math.abs(Math.cos(ph)),
      K: [hipK, kneeOf(hipK, ph), 0, 0], S: [hipS, kneeOf(hipS, ph + Math.PI), 0, 0],
      aK: [-0.65 * Math.sin(ph), 0.15, 1.3], aS: [0.65 * Math.sin(ph), 0.15, 1.3],
    };
  }

  function keyToPose(key, foot) {
    const kick = foot === 'left' ? 'L' : 'R', stand = kick === 'L' ? 'R' : 'L';
    const m = kick === 'L' ? -1 : 1;              // mirror the sideways quantities for a left-footer
    const leg = (v) => {
      const o = { hip: v[0], knee: v[1], abd: 0.04, hike: v[3] || 0 };
      if (Math.abs(v[2]) > 1e-3) o.pitch = v[2];
      return o;
    };
    const arm = (v) => ({ flex: v[0], abd: v[1], elbow: v[2] });
    const pose = { lean: key.lean, side: key.side * m, twist: key.twist * m, drop: key.drop, ground: 0 };
    pose[kick] = leg(key.K); pose[stand] = leg(key.S);
    pose['a' + kick] = arm(key.aK); pose['a' + stand] = arm(key.aS);
    return pose;
  }

  // step period, foot-on-ground time per running step (a jog spends about a third of each stride on each foot; the
  // old 0.13 s was a sprinter's contact and made the run a series of hops), standing-foot plant
  const STEP = 0.3, STANCE = 0.2, T_PLANT = -0.07;
  const STANCE_LAST = 0.13;                             // the kicking foot's last contact before the strike is quick
  /** Total run-up time (s) before the strike. */
  function runTimeProc(ch) { return 0.35 + ch.run.steps * STEP - T_PLANT; }

  // ───────────── locomotion: planted feet, stride timing, IK legs ─────────────
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /** Cubic Hermite (Catmull-Rom tangents) through timed keys [{t, p}], clamped at the ends. */
  function spline(keys, t) {
    if (t <= keys[0].t) return keys[0].p.slice();
    const n = keys.length;
    if (t >= keys[n - 1].t) return keys[n - 1].p.slice();
    let i = 0; while (keys[i + 1].t < t) i++;
    const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
    const u = (t - k1.t) / (k2.t - k1.t), u2 = u * u, u3 = u2 * u;
    const m1 = k1 === k0 ? [0, 0, 0] : mul(sub(k2.p, k0.p), (k2.t - k1.t) / (k2.t - k0.t));   // lift off from rest
    // the final key is a landing: arrive with zero velocity instead of stopping dead
    const m2 = k3 === k2 ? [0, 0, 0] : mul(sub(k3.p, k1.p), (k2.t - k1.t) / (k3.t - k1.t));
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return [0, 1, 2].map((c) => h00 * k1.p[c] + h10 * m1[c] + h01 * k2.p[c] + h11 * m2[c]);
  }

  /**
   * The free-kick taker as real locomotion (t relative to the strike: < 0 run-up, 0 = boot meets ball).
   *  - Footfalls are scheduled backwards from the standing-foot plant beside the ball (T_PLANT), one every STEP s,
   *    along the approach line. A foot on the ground stays exactly where it landed (no sliding); between landings
   *    it swings on an arc with the heel lifting first, as in a run.
   *  - The pelvis travels at the run-up speed, slows over the plant, bobs (lowest in stance), and is lowered
   *    automatically whenever a planted foot would otherwise be out of the leg's reach.
   *  - The kicking foot after its last step follows a timed path: lift-off → backswing (heel up behind) → contact
   *    (instep on the back of the ball at t = 0) → follow-through (up and across) → landing ahead.
   *  - Legs are solved by two-bone IK to these foot targets, so thigh and shin lengths never change.
   *  - Arms swing against the legs while running; at the strike the standing-side arm goes out wide for balance
   *    and the trunk leans back and away from the kicking leg.
   */
  function kickerBodyProc(ch, t, ball, aim, clock = 0) {
    const m = ch.foot === 'left' ? -1 : 1;                     // +1 = right-footed
    const kickS = m > 0 ? 'R' : 'L', standS = m > 0 ? 'L' : 'R';
    const k = ch.height / 1.8, up = [0, 0, 1];
    const F0 = norm([aim[0], aim[1], 0]);
    const R0 = norm(cross(F0, up));
    const ang = ch.run.angle * Math.PI / 180;
    const A = norm(comb([0, 0, 0], Math.cos(ang), F0, m * Math.sin(ang), R0, 0, up));   // approach direction
    const RA = norm(cross(A, up));
    const v = ch.run.speed, N = ch.run.steps, Tr = runTimeProc(ch);
    // contact time shortens with speed, so the foot is never left on the grass far behind the hips (the fast runners
    // were dragged down by it); 0.2 s for a jog
    const stT = Math.min(STANCE, 0.5 * (ch.height / 1.8) / v);
    // technique: 'curl' (inside of the foot), 'knuckle' (instep, ankle locked, short follow-through), 'outside'
    // (outside of the foot), 'instep' (laces: driven and dipping shots)
    const lab = (ch.kick && ch.kick.label || '').toLowerCase();
    const tech = /outside/.test(lab) ? 'outside' : /knuckle/.test(lab) ? 'knuckle' : /curl|bend|float/.test(lab) ? 'curl' : 'instep';
    const ankleZ = DIM.ankle * k;
    const B = [ball.x, ball.y, 0];

    // the standing foot lands beside and slightly behind the ball, on the side away from the kicking foot
    const plantS = comb(B, -0.12 * k, F0, -m * 0.27 * k, R0, ankleZ, up);
    // footfall schedule: index 0 = the plant (standing foot), 1 = kicking foot's last step, 2 = standing foot, ...
    const falls = [];
    let back = 0;
    for (let i = 0; i <= N; i++) {
      const side = i % 2 === 0 ? standS : kickS;
      back += i === 0 ? 0 : (i === 1 ? 1.2 : 1) * v * STEP;   // the last stride is the longest
      const lat = side === kickS ? m * 0.2 * k : 0;
      falls.push({ i, side, t: T_PLANT - i * STEP, p: comb(plantS, -back, A, lat, RA, 0, up) });
    }
    const start = falls[N];                                     // first foot on the ground at the start of the run
    const startOther = comb(start.p, 0, A, (start.side === kickS ? -m : m) * 0.2 * k, RA, 0, up);

    // facing: along the run, opening toward the shot line through the strike
    const open = smooth(-0.35, 0.05, t);
    const Fidle = norm(sub(B, start.p));
    const Frun = norm(comb([0, 0, 0], 1 - 0.5 * open, A, 0.5 * open, F0, 0, up));
    // turn from facing the ball at the mark to the run direction over the first steps (no snap)
    const turn = smooth(-Tr, -Tr + 0.4, t);
    const F = norm(comb([0, 0, 0], 1 - turn, Fidle, turn, Frun, 0, up));
    const Rt = norm(cross(F, up));

    // ── feet ──
    const footAt = (side) => {
      const own = falls.filter((f) => f.side === side && f.i < N).sort((a, b) => a.t - b.t);
      const first = side === start.side ? start.p : startOther;
      const events = [{ t: -1e9, p: first }].concat(own);
      if (side === standS) events.push({ t: 0.58, p: comb(plantS, 0.66 * k, F0, -m * 0.08 * k, R0, 0, up) });  // steps up beside the kicking foot
      let e = 0; while (e + 1 < events.length && events[e + 1].t <= t) e++;
      const cur = events[e], nxt = events[e + 1];
      // from the standing start: the trailing foot moves first; the start foot pushes off once the run begins
      const leave = cur.t < -1e8 ? (side === start.side ? start.t + 0.6 * stT : -Tr + 0.05) : cur.t + stT;
      // toe-off: over the last part of a running stance the heel rises and the foot rolls onto its toes (not on the
      // plant beside the ball, nor the kicking foot's last step, which the strike takes over)
      const roll = !!nxt && cur.i !== undefined && cur.i !== 0 && !(side === kickS && cur === falls[1]);
      const TOE = 0.09 * k * Math.min(1, v / 3), toeA = Math.asin(Math.min(0.9, TOE / (DIM.foot * k)));
      if (!nxt || t < leave) {
        const h = roll ? smooth(leave - 0.09, leave, t) : 0;
        if (h <= 0) return { p: cur.p.slice(), flat: true };
        const p = cur.p.slice(); p[2] += TOE * h;
        return { p, flat: false, s: 0, toeOff: toeA * h };
      }
      const s = clamp((t - leave) / Math.max(0.05, nxt.t - leave), 0, 1);
      // a running swing: the foot first rises BEHIND the hips (heel kicks up, knee flexes) while it barely moves
      // forward, then the knee drives through and the foot comes forward low to land. (The old path moved the foot
      // forward and up together, so the leg reached out straight in front like a goose-step.)
      // (an extra-slow start, sm^1.5, left the foot hanging 0.65 m behind the hips; plain smoothstep brings it through
      // under the body at the top of its arc with the knee driving forward)
      const sm = s * s * (3 - 2 * s), hs = sm;
      const pos = lerp3(cur.p, nxt.p, hs);
      pos[2] = ankleZ + k * 0.34 * (Math.pow(s, 1.5) * (1 - s) * (1 - s) / 0.0917) * Math.min(1, v / 3);   // eases off and onto the grass
      const carry = roll ? 1 - smooth(0, 0.3, s) : 0;                // the toe-off lift and point carry into the swing
      pos[2] += TOE * carry;
      return { p: pos, flat: false, s, toeOff: toeA * carry };
    };
    const fS = footAt(standS);
    let fK;
    const lastK = falls[1];                                     // the kicking foot's last step before the strike
    const liftK = lastK.t + STANCE_LAST;
    if (t < liftK) fK = footAt(kickS);
    else {
      // where the foot meets the ball, and where the leg goes after it, depend on the technique (TECH above)
      const contact = tech === 'curl' ? comb(B, -0.16 * k, F0, m * 0.07 * k, R0, 0.13 * k, up)     // inside of the foot, ankle beside
        : tech === 'outside' ? comb(B, -0.17 * k, F0, -m * 0.06 * k, R0, 0.15 * k, up)              // outside of the foot
        : comb(B, -0.19 * k, F0, 0, R0, 0.19 * k, up);                                              // instep, toes down
      const pAt = comb(plantS, -0.1 * k, F0, m * 0.05 * k, R0, 0, up);        // roughly under the hips at the strike
      // follow-through: curlers wrap the leg up and across the body; instep strikes (knuckle, driven) stop short and
      // straight; the outside-foot strike swings out away from the body
      const ft = tech === 'curl' ? [0.6, -0.24, 0.8] : tech === 'outside' ? [0.62, 0.2, 0.62] : tech === 'knuckle' ? [0.42, 0.0, 0.42] : [0.58, -0.04, 0.62];
      const keys = [
        { t: liftK, p: lastK.p },
        { t: liftK + 0.6 * (-0.1 - liftK), p: comb(pAt, -0.42 * k, F0, m * 0.08 * k, R0, 0.42 * k, up) },
        { t: -0.1, p: comb(pAt, -0.36 * k, F0, m * 0.12 * k, R0, 0.58 * k, up) },          // heel high behind: the leg is cocked
        { t: 0, p: contact },
        { t: 0.16, p: comb(pAt, ft[0] * k, F0, m * ft[1] * k, R0, ft[2] * k, up) },
        { t: 0.28, p: comb(plantS, 0.5 * k, F0, m * 0.15 * k, R0, 0.14 * k, up) },
        { t: 0.4, p: comb(plantS, 0.55 * k, F0, m * 0.1 * k, R0, 0, up) },                 // lands ahead (plantS is already at ankle height)
      ];
      // (landing sooner lets the body carry on over the kicking foot; landing late left it squatting on the
      // standing leg while the hips moved on)
      fK = { p: spline(keys, t), flat: t >= 0.4, strike: true };
      if (fK.p[2] < ankleZ) fK.p[2] = ankleZ;
    }

    // ── pelvis ──
    // hips trail the landing foot: each foot touches down ~0.25 m in front of the hips and leaves behind them
    // while running the foot lands only a little ahead of the hips (a long reach in front is a braking overstride and
    // straightens the leg); over the last two strides the hips sit back behind the plant, as a taker slows to strike
    const off = 0.2 * v * STEP + 0.25 * k, offRun = 0.2 * v * STEP + 0.1 * k;
    const offAt = (tt) => offRun + (off - offRun) * smooth(T_PLANT - 0.55, T_PLANT, tt);
    const lineP = (tt) => {
      if (tt <= T_PLANT) return comb(plantS, v * (tt - T_PLANT) - offAt(tt), A, m * 0.1 * k, RA, 0, up);
      const d = v * 0.13 * (1 - Math.exp(-(tt - T_PLANT) / 0.13));
      const after = 0.68 * k * smooth(0.1, 0.9, tt);              // the body carries on through the ball, to end over its feet
      // through the strike the hips move over the standing foot (weight on it), then back toward the middle
      const over = smooth(T_PLANT - 0.1, 0, tt) * (1 - smooth(0.25, 0.7, tt));
      const alongRun = comb(plantS, d - off, A, m * (0.1 - 0.02 * over) * k, RA, after, F0);
      // ...and they redirect from the run-up line onto the shot line, so at contact they sit just behind the
      // standing foot rather than off to its side
      const alongShot = comb(plantS, d - off, F0, m * (0.1 - 0.02 * over) * k, R0, after, F0);
      return lerp3(alongRun, alongShot, smooth(T_PLANT, 0.02, tt));
    };
    const standPel = lerp3(start.p, startOther, 0.5);
    // accelerate from standing over the start foot into the run (no backward drift)
    // blending toward the moving run line (not a fixed point) keeps the velocity continuous as he sets off
    let pel = t < -Tr ? standPel : t < start.t + 0.2 ? lerp3(standPel, lineP(t), smooth(-Tr, start.t + 0.2, t)) : lineP(t);
    // how much of the running posture applies: ramps up from the standing start and hands over to the strike
    // (every posture element is weighted by it, so nothing switches on or off between two frames)
    const runRamp = smooth(-Tr, start.t + 0.15, t) * (1 - smooth(T_PLANT - 0.12, T_PLANT + 0.06, t));
    const phase = Math.PI * (t - T_PLANT) / STEP;              // 0 at the plant, π per step
    const crouch = 0.065 * k * Math.max(0, 1 - Math.abs(t) / 0.3) * smooth(-0.3, -0.2, t) * (1 - smooth(0.2, 0.3, t));
    // running height (knees soft) from the first steps; back up to full standing height once the kick is done
    // (it used to stay low, leaving him standing on bent knees until the next kick)
    // standing height puts the hips where nearly straight legs (≈10° of knee bend) reach the grass; the old 0.97 m
    // (per 1.8 m) left every "standing" taker on knees bent ~40°
    const standF = t < -Tr ? 1 : (1 - smooth(-Tr, -Tr + 0.3, t)) + smooth(0.45, 1.0, t);
    // running tall, then sinking into the last stride and the plant (the strike's height is unchanged)
    const standZ = ankleZ + 0.06 * k + (DIM.thigh + DIM.shin) * k * 0.995;
    const runZ = lerp(standZ - 0.045 * k, DIM.pelvis * k * 0.95, smooth(T_PLANT - 0.4, T_PLANT, t));
    // the bounce of a run: lowest at mid-stance (the knee flexes ~40° to absorb the landing), highest in the flight
    // between steps (it used to peak at touchdown, which read as stiff, stamping legs)
    const bobA = (0.016 + 0.008 * Math.min(1, v / 3)) * k;
    const bob = -bobA * Math.cos(2 * phase - Math.PI * stT / STEP);
    let pz = runZ + (standZ - runZ) * standF - crouch + runRamp * bob;
    // waiting at the mark (and before the run starts) he is alive: breathing, shifting his weight, glancing around
    // (clock = the app's animation time; fades out as the run begins, so nothing snaps)
    const idleW = 1 - smooth(-Tr - 0.4, -Tr + 0.15, t);
    const c = clock, wsh = Math.sin(c * 1.4) * 0.7 + Math.sin(c * 0.53) * 0.3, br = Math.sin(c * 1.75);
    pel = comb(pel, 0.018 * k * wsh * idleW, Rt, 0.006 * k * Math.sin(c * 0.8) * idleW, F, 0, up);
    pz += 0.004 * k * br * idleW;
    // weight onto the lower foot while running: the hips move a little over the stance leg
    {
      const runW0 = runRamp * (1 - smooth(-0.32, -0.12, t));
      const dzf = fK.p[2] - fS.p[2], lift = Math.min(1, Math.abs(dzf) / 0.08);
      const stanceSide = dzf > 0 ? standS : kickS;
      pel = comb(pel, (stanceSide === 'L' ? -1 : 1) * 0.022 * k * lift * runW0, Rt, 0, F, 0, up);
    }
    const Lmax = (DIM.thigh + DIM.shin) * k * 0.985;
    // the reach limit takes hold gradually as a foot comes down (and lets go as it lifts), so the hips never jolt
    const z0 = pz;
    for (const [f, fside] of [[fS, standS], [fK, kickS]]) {
      const wgt = f.strike ? smooth(0.22, 0.42, t) : f.flat ? 1 : f.s !== undefined ? smooth(0.7, 1.0, f.s) + (1 - smooth(0.0, 0.3, f.s)) : 0;   // the kicking foot's limit eases in as it comes down
      if (wgt <= 0) continue;
      for (const sgn of [fside === 'L' ? -1 : 1]) {               // each foot against its own hip (the far hip held the body low)
        const hip = comb(pel, sgn * DIM.hipW * k, Rt, 0, F, 0, up);
        const dxy = Math.hypot(hip[0] - f.p[0], hip[1] - f.p[1]);
        // a foot that has just left the grass may be drawn up by the leg rather than drag the hips down after it
        const free = f.s > 0 && f.s < 0.5 ? 0.25 * k * Math.min(1, f.s / 0.25) : 0;
        const maxZ = f.p[2] + free + Math.sqrt(Math.max(0, Lmax * Lmax - dxy * dxy)) + 0.06 * k;
        const lim = z0 + (Math.min(z0, maxZ) - z0) * Math.min(1, wgt);
        if (pz > lim) pz = lim;
      }
    }

    // ── trunk and arms ──
    const strikeW = smooth(-0.32, -0.12, t) * (1 - smooth(0.35, 0.8, t));
    const runW = runRamp * (1 - strikeW);
    const swing = Math.cos(phase);                             // + : kicking-side arm forward (its leg is back)
    // ── the strike, as in the biomechanics of the instep / curling kick ──
    // tension arc: as the kicking leg cocks back, the kicking hip rotates back (pelvis turned toward the kicking side)
    // while the shoulders turn the other way and the opposite arm swings out wide and back — the body is stretched
    // diagonally like a drawn bow. Release: the hips whip through toward the target and past it, the shoulders
    // unwind against them, the opposite arm sweeps forward and across. Values in radians, + = toward the kicking side.
    const KT = [-0.32, -0.14, -0.04, 0.04, 0.2, 0.5];
    const keyed = (vals) => { let i = 0; if (t <= KT[0]) return vals[0]; if (t >= KT[KT.length - 1]) return vals[vals.length - 1];
      while (KT[i + 1] < t) i++; return lerp(vals[i], vals[i + 1], smooth(0, 1, (t - KT[i]) / (KT[i + 1] - KT[i]))); };
    const hipS = keyed([0.1, 0.38, 0.22, -0.05, -0.32, -0.1]);               // pelvis: cocked back → driven through
    const shS = keyed([-0.05, -0.3, -0.24, -0.05, 0.2, 0.05]);                // shoulders: against the hips
    // trunk lean by technique: curlers lean back and away (to lift and bend it), instep strikes keep the chest over
    // the ball (knuckle and driven shots stay low); everyone leans away from the kicking leg to make room for it
    const leanS = tech === 'curl' ? -0.14 : tech === 'knuckle' ? 0.07 : tech === 'outside' ? -0.04 : 0.0;
    const sideS = tech === 'curl' ? 0.32 : tech === 'knuckle' ? 0.16 : 0.24;
    // eyes on the ball through the last strides and the contact, then up after the shot
    const look = smooth(-0.9, -0.45, t) * (1 - smooth(0.06, 0.4, t));
    const toBall = sub([B[0], B[1], 0], [pel[0], pel[1], 0]), dB = Math.max(0.3, Math.hypot(toBall[0], toBall[1]));
    const yawB = clamp(Math.atan2(dot(toBall, Rt), dot(toBall, F)), -0.7, 0.7);
    const pitchB = clamp(Math.atan2(1.5 * k, dB), 0, 0.75) * 0.85;
    // waiting at the mark (and before the run starts) he is alive: breathing, shifting his weight, glancing around
    // (clock = the app's animation time; fades out as the run begins, so nothing snaps)
    const pose = {
      lean: (0.21 * Math.min(1, v / 3) + 0.03 * Math.cos(2 * phase - Math.PI * stT / STEP)) * runW + leanS * strikeW + 0.03 * (1 - smooth(-Tr, -Tr + 0.3, t)) + 0.025 * br * idleW,
      // running: the trunk rocks a little over each stance foot
      side: strikeW * -m * sideS * smooth(-0.3, -0.05, t) - 0.03 * wsh * idleW - m * 0.035 * runW * Math.cos(phase - Math.PI * stT / (2 * STEP)),
      // running: shoulders turn WITH the forward arm and the hips the other way, with the forward leg
      twist: -runW * 0.16 * swing * m + strikeW * m * shS + 0.06 * Math.sin(c * 0.9) * idleW,
      ptw: runW * 0.14 * swing * m + strikeW * m * hipS,
      drop: 0,
      head: { yaw: 0.35 * Math.sin(c * 0.37) * Math.sin(c * 0.23 + 1) * idleW + yawB * look, pitch: pitchB * look,
        w: Math.max(0.6 * runW, 0.8 * look, 0.6 * idleW) },
      L: { hip: 0, knee: 0, abd: 0 }, R: { hip: 0, knee: 0, abd: 0 },
    };
    // the swinging leg's hip drops a little while running (the stance hip carries the weight)
    {
      const dzf = fK.p[2] - fS.p[2], sw2 = clamp(dzf / 0.1, -1, 1) * runW;   // > 0: kicking foot in the air
      pose[kickS].hike = -0.014 * k * Math.max(0, sw2); pose[standS].hike = -0.014 * k * Math.max(0, -sw2);
    }
    const armIdle = { flex: 0.05 + 0.05 * Math.sin(c * 1.3) * idleW, abd: 0.14, elbow: 0.3 + 0.1 * Math.sin(c * 1.1 + 1) * idleW };
    const mixArm = (a, b2, w) => ({ flex: a.flex + (b2.flex - a.flex) * w, abd: a.abd + (b2.abd - a.abd) * w, elbow: a.elbow + (b2.elbow - a.elbow) * w });
    for (const [side, isK] of [[kickS, true], [standS, false]]) {
      // running arms: the forward arm flexes more at the elbow, the back arm opens out; slight swing across the body
      const sw = (isK ? 1 : -1) * swing;
      // a runner's arms swing from the shoulder: forward the elbow closes and the hand comes up to the chest, back the
      // elbow opens and the hand passes behind the hip (they used to stay folded in front of the chest on both sides)
      const run = { flex: -0.075 + 0.575 * sw, abd: 0.15 - 0.05 * sw, elbow: 1.1 + 0.4 * sw };
      // strike arms: the opposite (standing-side) arm goes out wide and back with the backswing, then sweeps forward
      // and across through the contact; the kicking-side arm counters the leg (forward while it cocks, back as it fires)
      const strike = isK
        ? { flex: keyed([0.45, 0.5, 0.25, -0.25, -0.4, -0.1]), abd: keyed([0.25, 0.35, 0.45, 0.5, 0.4, 0.25]), elbow: keyed([1.1, 1.0, 0.85, 0.65, 0.7, 0.9]) }
        : { flex: keyed([-0.1, -0.5, -0.35, 0.05, 0.45, 0.3]), abd: keyed([0.8, 1.35, 1.45, 1.4, 0.95, 0.5]), elbow: keyed([0.6, 0.35, 0.3, 0.3, 0.55, 0.7]) };
      let a = mixArm(armIdle, run, runW);
      a = mixArm(a, strike, strikeW);
      if (t > 0.8) a = mixArm(a, armIdle, smooth(0.8, 1.4, t));
      pose['a' + side] = a;
    }
    const b = forward([pel[0], pel[1], pz - DIM.pelvis * k], F, ch.height, pose);

    // ── legs by IK to the foot targets ──
    for (const [side, f] of [[standS, fS], [kickS, fK]]) {
      const leg = b.legs[side];
      const hint = comb(F, f.strike ? 0.25 : 0.15, up, 0, F, 0, F);
      const r = ik2(leg.hip, f.p, DIM.thigh * k, DIM.shin * k, hint);
      leg.knee = r.mid; leg.ankle = r.end;
      let fd;
      if (f.flat) fd = norm([F[0], F[1], 0]);                                                              // flat on the grass
      else { const p = 0.7 * Math.sin(Math.PI * Math.min(1, (f.s || 0) * 1.2)) + (f.toeOff || 0); fd = norm(comb([0, 0, 0], Math.cos(p), F, -Math.sin(p), up, 0, F)); }
      if (f.strike) {
        // the striking surface turns onto the ball and back out again — blended, never switched:
        // instep/knuckle: toes pointed down, ankle locked; curl: toes turned OUT so the inside of the foot meets the
        // ball; outside: toes turned IN and down so the outside of the foot meets it
        const w = smooth(-0.24, -0.08, t) * (1 - smooth(0.08, 0.4, t));   // released slowly through the follow-through
        const inst = tech === 'curl' ? norm(comb([0, 0, 0], 0.72, F0, -0.3, up, m * 0.62, R0))
          : tech === 'outside' ? norm(comb([0, 0, 0], 0.68, F0, -0.55, up, -m * 0.48, R0))
          : norm(comb([0, 0, 0], 0.72, F0, -0.7, up, 0, F0));
        fd = norm(comb([0, 0, 0], w, inst, 1 - w, fd, 0, fd));
      }
      leg.toe = add(leg.ankle, mul(fd, DIM.foot * k));
      if (leg.toe[2] < 0.02) leg.toe[2] = 0.02;
    }
    return b;
  }

  /**
   * The kicker's body at time t relative to the strike (t < 0 run-up, 0 = contact, > 0 follow-through).
   * ball: {x,y} free-kick spot; aim: unit horizontal shot direction [x,y]. t < -runTime → standing at the mark.
   */
  /** The old keyframed kicker (superseded by the locomotion model above; kept for reference). */
  function kickerBodyKeyframed(ch, t, ball, aim) {
    const foot = ch.foot, m = foot === 'left' ? -1 : 1;
    const F0 = norm([aim[0], aim[1], 0]);
    const R0 = norm(cross(F0, [0, 0, 1]));
    // approach comes from the standing-foot side, angled toward the ball
    const ang = ch.run.angle * Math.PI / 180;
    const A = norm(comb([0, 0, 0], Math.cos(ang), F0, m * Math.sin(ang), R0, 0, [0, 0, 1]));
    const Tr = 0.45 + ch.run.steps * 0.3;
    // facing: along the run, opening up toward the shot line at the strike
    const open = smooth(-0.4, 0.0, t);
    const F = norm(comb([0, 0, 0], 1 - 0.55 * open, A, 0.55 * open, F0, 0, [0, 0, 1]));

    let key;
    if (t < -Tr) key = IDLE;
    else if (t < -0.45) key = mixKey(runKey(t), interpKeys(-0.45), smooth(-0.62, -0.45, t));
    else key = interpKeys(t);
    if (t < -Tr + 0.25 && t >= -Tr) key = mixKey(IDLE, key, smooth(-Tr, -Tr + 0.25, t));
    const pose = keyToPose(key, foot);

    // where the hips must be at contact so that the instep meets the back of the ball
    const contactPose = keyToPose(interpKeys(0), foot);
    const Fc = norm(comb([0, 0, 0], 0.45, A, 0.55, F0, 0, [0, 0, 1]));
    const probe = forward([0, 0, 0], Fc, ch.height, contactPose);
    const toe = probe.legs[foot === 'left' ? 'L' : 'R'].toe;
    const ballC = [ball.x, ball.y, 0.11];
    const strikePt = comb(ballC, -0.13, F0, 0, R0, -0.09, [0, 0, 1]);
    const originC = [strikePt[0] - toe[0], strikePt[1] - toe[1], 0];

    let origin;
    if (t <= 0) {
      const v = ch.run.speed;
      const tt = Math.min(-t, Tr);
      // decelerating approach: covers less ground in the last stride
      const dist = v * (tt - 0.45 * (1 - Math.exp(-tt / 0.45)) * 0.5);
      origin = comb(originC, -dist, A, 0, F0, 0, F0);
    } else {
      origin = comb(originC, 0.9 * smooth(0, 0.75, t) + 0.25 * smooth(0.75, 2.0, t), F0, 0, R0, 0, R0);
    }
    origin[2] = 0;
    // waiting at the mark, the taker stands a step to the side of his run-up line (out of the camera's line to the
    // ball, as takers do while the wall is set); he drifts back onto the line during the first strides
    const aside = 1.1 * (1 - smooth(-Tr, -Tr + 0.6, t));
    origin[0] -= m * aside * R0[0]; origin[1] -= m * aside * R0[1];
    return forward(origin, t < -Tr ? norm(sub([ball.x, ball.y, 0], [origin[0], origin[1], 0])) : F, ch.height, pose);
  }

  // ───────────── the taker from motion capture (assets/mocap.js) ─────────────
  /*
   * Real recorded movement (CMU motion-capture database): a jog cycle for the run-up, a recorded free-standing idle,
   * and recorded run-in soccer kicks. The recordings are placed in the world (the kick with the ball at its origin and
   * +x along the shot, mirrored for left-footers), blended where they meet, and then rebuilt on this body's own
   * proportions: legs and arms by two-bone IK toward the recorded ankles and wrists (pole = the recorded knee/elbow),
   * trunk, pelvis and head frames from the recorded spine, hips and neck. Limb lengths therefore never change.
   */
  const MOCAP = (() => {
    try {
      if (typeof module === 'object' && module.exports) return require('../assets/mocap.js');
      return typeof self !== 'undefined' ? self.FKMocap || null : null;
    } catch (e) { return null; }
  })();
  const MJ = MOCAP ? Object.fromEntries(MOCAP.joints.map((n, i) => [n, i])) : {};
  const LEG = DIM.thigh + DIM.shin;
  const REST_PITCH = -0.28;                 // recorded ankle→toe pitch when standing (the subjects' shoes)
  const KICK_CLIP = { curl: '10_03', knuckle: '10_05', outside: '10_06', instep: '10_06' };
  const techOf = (ch) => {
    const lab = (ch.kick && ch.kick.label || '').toLowerCase();
    return /outside/.test(lab) ? 'outside' : /knuckle/.test(lab) ? 'knuckle' : /curl|bend|float/.test(lab) ? 'curl' : 'instep';
  };
  const swapLR = (n) => (n.endsWith('L') ? n.slice(0, -1) + 'R' : n.endsWith('R') ? n.slice(0, -1) + 'L' : n);

  /** Sample a clip at time tau (s from its first frame), looping or clamped, mirrored (left↔right) if asked. */
  function sampleClip(frames, fps, tau, loop, mirror) {
    const n = frames.length;
    let x = tau * fps;
    x = loop ? ((x % n) + n) % n : clamp(x, 0, n - 1);
    const i = Math.floor(x), u = x - i, j = loop ? (i + 1) % n : Math.min(n - 1, i + 1);
    const A = frames[i], Bf = frames[j], o = {}, sy = mirror ? -1 : 1;
    for (const name of MOCAP.joints) {
      const c = MJ[mirror ? swapLR(name) : name] * 3;
      o[name] = [A[c] + (Bf[c] - A[c]) * u, (A[c + 1] + (Bf[c + 1] - A[c + 1]) * u) * sy, A[c + 2] + (Bf[c + 2] - A[c + 2]) * u];
    }
    return o;
  }
  /** Canonical pose → world: x along X, y to the left, scaled by s; z up from the rest ankle height z0. */
  function placePose(P, O, X, s, z0) {
    const Y = [-X[1], X[0], 0], o = {};
    for (const n in P) {
      const p = P[n];
      o[n] = [O[0] + (X[0] * p[0] + Y[0] * p[1]) * s, O[1] + (X[1] * p[0] + Y[1] * p[1]) * s, z0 + p[2] * s];
    }
    return o;
  }
  const mixPose = (a, b, w) => {
    if (w <= 0) return a;
    if (w >= 1) return b;
    const o = {}; for (const n in a) o[n] = lerp3(a[n], b[n], w); return o;
  };
  const slerpH = (a, b, w) => norm(comb([0, 0, 0], 1 - w, a, w, b, 0, a));
  const smoothInt = (u) => u * u * u - u * u * u * u / 2;      // ∫₀ᵘ smoothstep

  /** Everything about a taker's run and kick that does not depend on t (cached). */
  const planCache = new Map();
  function mocapPlan(ch, ball, aim) {
    const key = [ch.id, ch.foot, ch.height, ch.run.speed, ch.run.steps, ch.run.angle, ch.kick && ch.kick.label, ball.x, ball.y, aim[0], aim[1]].join('|');
    let pl = planCache.get(key);
    if (pl) return pl;
    const m = ch.foot === 'left' ? -1 : 1, mirror = m < 0, kickS = m > 0 ? 'R' : 'L';
    const k = ch.height / 1.8, up = [0, 0, 1], z0 = DIM.ankle * k;
    const tech = techOf(ch), K = MOCAP.kicks[KICK_CLIP[tech]], RUN = MOCAP.run, IDLE = MOCAP.idle;
    const sK = LEG * k / K.rest.leg, sR = LEG * k / RUN.rest.leg, sI = LEG * k / IDLE.rest.leg;
    const F0 = norm([aim[0], aim[1], 0]), R0 = norm(cross(F0, up));
    // (an outside-of-the-foot strike sets the foot a little inside the ball's line, so the outer face meets it)
    const B = tech === 'outside' ? comb([ball.x, ball.y, 0], m * 0.07 * k, R0, 0.05 * k, F0, 0, up) : [ball.x, ball.y, 0];
    const kickAt = (t) => placePose(sampleClip(K.frames, MOCAP.fps, t - K.t0, false, mirror), B, F0, sK, z0);
    const tR = K.tR;                                         // the kicking foot's last touchdown before the strike
    const pa = kickAt(K.t0).pel, pb = kickAt(tR).pel;
    const Akick = norm([pb[0] - pa[0], pb[1] - pa[1], 0]);   // the recorded run-in direction
    const ang = ch.run.angle * Math.PI / 180;
    const A = norm(comb([0, 0, 0], Math.cos(ang), F0, m * Math.sin(ang), R0, 0, up));   // this taker's approach
    // the jog cycle is played at rate r so that, at this taker's speed and size, planted feet stay still
    const v = ch.run.speed, r = v / (RUN.speed * sR), Tstep = RUN.period / 2 / r;
    const RAMP = 0.45, tS = tR - (Math.max(1, ch.run.steps) - 1) * Tstep - RAMP;
    const ramp = (t) => smooth(tS, tS + RAMP, t);
    // heading: the taker's own approach line, curving onto the recorded run-in over the last second
    const heading = (t) => slerpH(A, Akick, smooth(tR - 1.1, tR - 0.1, t));
    // root path, integrated back from the touchdown so that the run's kicking foot lands exactly where the recorded
    // kick's kicking foot lands
    const run0 = sampleClip(RUN.frames, MOCAP.fps, RUN.rLand, true, mirror);
    const aK = run0['ank' + kickS], Y = [-Akick[1], Akick[0], 0];
    const landK = kickAt(tR)['ank' + kickS];
    const PR = [landK[0] - (Akick[0] * aK[0] + Y[0] * aK[1]) * sR, landK[1] - (Akick[1] * aK[0] + Y[1] * aK[1]) * sR, 0];
    const dt = 1 / 120, n = Math.ceil((tR - tS) / dt) + 1;
    const T = new Float64Array(n), PX = new Float64Array(n), PY = new Float64Array(n), D = new Float64Array(n);
    T[n - 1] = tR; PX[n - 1] = PR[0]; PY[n - 1] = PR[1]; D[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) {
      T[i] = T[i + 1] - dt;
      const tm = T[i] + dt / 2, h = heading(tm), w = ramp(tm);
      PX[i] = PX[i + 1] - v * w * h[0] * dt; PY[i] = PY[i + 1] - v * w * h[1] * dt; D[i] = D[i + 1] - w * dt;
    }
    const pathAt = (t) => {
      if (t >= tR) { const e = t - tR; return { p: [PR[0] + v * Akick[0] * e, PR[1] + v * Akick[1] * e, 0], d: e }; }
      const x = clamp((t - T[0]) / dt, 0, n - 1), i = Math.min(n - 2, Math.floor(x)), u = x - i;
      return { p: [PX[i] + (PX[i + 1] - PX[i]) * u, PY[i] + (PY[i + 1] - PY[i]) * u, 0], d: D[i] + (D[i + 1] - D[i]) * u };
    };
    const runAt = (t) => {
      const q = pathAt(t);
      return placePose(sampleClip(RUN.frames, MOCAP.fps, RUN.rLand + r * q.d, true, mirror), q.p, heading(t), sR, z0);
    };
    const idleAt = (clock, O, X) => placePose(sampleClip(IDLE.frames, IDLE.fps, clock, true, mirror), O, X, sI, z0);
    // where he ends up: the last recorded frame, facing where his hips face
    const tE = K.t0 + (K.frames.length - 1) / MOCAP.fps;
    const last = kickAt(tE), hR = norm(sub(last.hipR, last.hipL));
    const endX = norm([-hR[1], hR[0], 0]);                       // F = U × Rt
    pl = { m, mirror, kickS, k, z0, tech, K, F0, R0, B, tR, tS, tE, kickAt, runAt, idleAt, pathAt, heading, end: [last.pel[0], last.pel[1], 0], endX };
    if (planCache.size > 64) planCache.clear();
    planCache.set(key, pl);
    return pl;
  }

  /** Point-wise blend of two bodies (frames taken from the nearer one). */
  function blendBody(a, b, w) {
    if (w <= 0) return a;
    if (w >= 1) return b;
    const L = (p, q) => lerp3(p, q, w), near = w < 0.5 ? a : b, o = { ...near, pelvis: L(a.pelvis, b.pelvis), neck: L(a.neck, b.neck), head: L(a.head, b.head), legs: {}, arms: {} };
    const k = a.k || b.k || 1;
    for (const s of ['L', 'R']) {
      // blended end points, then the limbs re-solved at their true lengths (a straight blend shortens them)
      const hip = L(a.legs[s].hip, b.legs[s].hip), ank = L(a.legs[s].ankle, b.legs[s].ankle), kn = L(a.legs[s].knee, b.legs[s].knee);
      const rl = ik2(hip, ank, DIM.thigh * k, DIM.shin * k, sub(kn, lerp3(hip, ank, 0.5)));
      const toeD = norm(L(sub(a.legs[s].toe, a.legs[s].ankle), sub(b.legs[s].toe, b.legs[s].ankle)));
      o.legs[s] = { hip, knee: rl.mid, ankle: rl.end, toe: add(rl.end, mul(toeD, DIM.foot * k)) };
      const sh = L(a.arms[s].sh, b.arms[s].sh), hd = L(a.arms[s].hand, b.arms[s].hand), el = L(a.arms[s].elbow, b.arms[s].elbow);
      // (keeper arms are 12% longer: keep whatever lengths the bodies have)
      const ua = len(sub(a.arms[s].elbow, a.arms[s].sh)), fa = len(sub(a.arms[s].hand, a.arms[s].elbow));
      const ra = ik2(sh, hd, ua, fa, sub(el, lerp3(sh, hd, 0.5)));
      o.arms[s] = { sh, elbow: ra.mid, hand: ra.end };
    }
    return o;
  }

  /** Rebuild a body on this taker's proportions from a world pose of recorded joints. */
  function bodyFromPose(J, ch) {
    const k = ch.height / 1.8, up = [0, 0, 1];
    const pel = J.pel.slice();
    const pRt = norm(sub(J.hipR, J.hipL));
    let pU = norm(sub(J.low, J.pel)); pU = norm(sub(pU, mul(pRt, dot(pU, pRt))));
    const pF = cross(pU, pRt);
    const U = norm(sub(J.neck, J.pel));
    let Rt = norm(sub(J.shR, J.shL)); Rt = norm(sub(Rt, mul(U, dot(Rt, U))));
    const F = cross(U, Rt);
    // hip joints where the recording has them (they sit ~10 cm below the pelvis root), at this body's hip width
    const hipOf = (s) => {
      const rel = sub(J[s < 0 ? 'hipL' : 'hipR'], J.pel), lat = dot(rel, pRt);
      return add(add(pel, sub(rel, mul(pRt, lat))), mul(pRt, s * DIM.hipW * k));
    };
    // a planted foot must be reachable by this body's legs: lower the whole body if needed
    const Lmax = LEG * k * 0.995, zA = DIM.ankle * k;
    let drop = 0;
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const a = J['ank' + side], h = hipOf(s);
      const plant = 1 - smooth(zA + 0.03, zA + 0.12, a[2]);
      if (plant <= 0) continue;
      const dxy = Math.hypot(h[0] - a[0], h[1] - a[1]);
      const need = (h[2] - Math.max(a[2], zA)) - Math.sqrt(Math.max(0, Lmax * Lmax - dxy * dxy));
      if (need > 0) drop = Math.max(drop, need * plant);
    }
    pel[2] -= drop;
    const legs = {};
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const hip = hipOf(s);
      const a = J['ank' + side].slice(); if (a[2] < zA * 0.9) a[2] = zA * 0.9;
      // (a small forward bias keeps the knee from flipping when the recorded leg is straight)
      const pole = add(sub(J['knee' + side], lerp3(hip, a, 0.5)), mul(pF, 0.04 * k));
      const rr = ik2(hip, a, DIM.thigh * k, DIM.shin * k, pole);
      // the foot keeps its recorded heading and pitch (relative to the subject's standing pitch)
      // (rotated about the hips' side axis, which stays well defined when the foot points straight down)
      const d = norm(sub(J['toe' + side], J['ank' + side])), th = -REST_PITCH, ax = pRt;
      const cxd = cross(ax, d), ad = dot(ax, d);
      const fd = norm(comb(d, 0, d, 0, d, 0, d).map((x, i) => d[i] * Math.cos(th) + cxd[i] * Math.sin(th) + ax[i] * ad * (1 - Math.cos(th))));
      const toe = add(rr.end, mul(fd, DIM.foot * k));
      if (toe[2] < 0.02) toe[2] = 0.02;
      legs[side] = { hip, knee: rr.mid, ankle: rr.end, toe };
    }
    const neck = add(pel, mul(U, DIM.spine * k));
    const head = add(neck, mul(U, (DIM.neck + DIM.head * 0.75) * k));
    const arms = {};
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const sh = comb(neck, -0.045 * k, U, 0, F, s * DIM.shoulderW * k, Rt);
      const tgt = add(sh, sub(J['wr' + side], J['sh' + side]));
      // (biased out and back, so a straight arm keeps a natural elbow instead of flipping)
      const pole = add(sub(add(J['elb' + side], sub(sh, J['sh' + side])), lerp3(sh, tgt, 0.5)), comb([0, 0, 0], -0.03 * k, F, s * 0.03 * k, Rt, -0.02 * k, U));
      const rr = ik2(sh, tgt, DIM.upperArm * k, DIM.foreArm * k, pole);
      arms[side] = { sh, elbow: rr.mid, hand: rr.end };
    }
    const Uh = norm(sub(J.head, J.uneck));
    const Fh = norm(sub(F, mul(Uh, dot(F, Uh))));
    return { pelvis: pel, neck, head, U, F, Rt, legs, arms, height: ch.height, k, P: { F: pF, U: pU, Rt: pRt }, H: { F: Fh, U: Uh, w: 1 } };
  }

  // ───────────── goal celebrations ─────────────
  /** Each taker's celebration after a goal. */
  const CELEB_OF = { ronaldo: 'siu', messi: 'pointUp', carlos: 'kneeSlide', beckham: 'cantHear', pirlo: 'kalma', juninho: 'pointUp',
    ronaldinho: 'shaka', koeman: 'kneeSlide', mihajlovic: 'cantHear', nakamura: 'penguin', bale: 'penguin', payet: 'kneeSlide' };
  const CELEB_NAMES = { siu: 'Siuuu', pointUp: 'Pointing to the sky', kneeSlide: 'Knee slide', cantHear: "Can't hear you",
    kalma: 'Calma', shaka: 'Shaka', penguin: 'Penguin slide' };

  /** Two-bone arm toward a hand target (wrist), elbow toward `pole`. */
  function armTo(b, side, tgt, pole) {
    const a = b.arms[side], r = ik2(a.sh, tgt, DIM.upperArm * b.k, DIM.foreArm * b.k, pole);
    a.elbow = r.mid; a.hand = r.end;
  }
  const lerpArr = (a, b, w) => a.map((v, i) => v + (b[i] - v) * w);

  /**
   * The celebration, u seconds after it starts: he sprints off toward the crowd behind the free kick (angled to the
   * nearer touchline, so he runs toward the camera), then does his own celebration. Run and standing come from the
   * recorded jog and standing; slides and the jump are posed on the same skeleton.
   */
  function celebrate(ch, pl, u, clock) {
    const type = CELEB_OF[ch.id] || 'pointUp';
    const slide = type === 'kneeSlide' || type === 'penguin', jump = type === 'siu';
    const RUN = MOCAP.run, k = pl.k, up = [0, 0, 1];
    const side = pl.B[1] >= 0 ? 1 : -1;
    const D = norm(comb([0, 0, 0], -0.75, pl.F0, 0.66 * side, [0, 1, 0], 0, up));
    const Lft = [-D[1], D[0], 0];
    const vmax = slide ? 6 : 5, TR = 1.25, sR = LEG * k / RUN.rest.leg, r = vmax / (RUN.speed * sR);
    const S = pl.end;
    // speed profile: sets off, runs, and (standing celebrations) pulls up; slides and the jump keep their pace
    const w = (s) => smooth(0, 0.45, s) * (slide || jump ? 1 : 1 - smooth(TR - 0.4, TR + 0.05, s));
    const uu = Math.min(u, TR + 0.1), n = Math.max(1, Math.ceil(uu * 60));
    let q = 0; for (let i = 0; i < n; i++) q += w((i + 0.5) * uu / n) * uu / n;
    const H = slerpH(pl.endX, D, smooth(0, 0.35, u));
    const root = add(S, mul(D, vmax * q));
    const runJ = placePose(sampleClip(RUN.frames, MOCAP.fps, r * q, true, pl.mirror), root, H, sR, pl.z0);
    let J = mixPose(pl.idleAt(clock, S, pl.endX), runJ, smooth(0, 0.3, u));
    const hd = { height: ch.height };
    let b;
    if (!slide && !jump) {
      // pull up and stand (recorded standing), facing the crowd, then the gesture
      J = mixPose(J, pl.idleAt(clock, root, D), smooth(TR - 0.4, TR + 0.1, u));
      b = bodyFromPose(J, hd);
      const gw = smooth(TR - 0.25, TR + 0.35, u), g = u - TR;
      if (gw > 0) {
        const F = b.F, Rt = b.Rt, U = b.U;
        for (const [sd, s] of [['L', -1], ['R', 1]]) {
          const a = b.arms[sd], sh = a.sh;
          let tgt, pole;
          if (type === 'pointUp') {           // both arms straight up, fingers to the sky
            tgt = comb(sh, 0.53 * k, U, 0.1 * k, F, s * 0.05 * k, Rt); pole = comb([0, 0, 0], s, Rt, -0.3, F, 0, U);
          } else if (type === 'kalma') {      // palms pressing down in front: calm down
            tgt = comb(sh, -0.36 * k + 0.07 * k * Math.sin(2 * Math.PI * 1.2 * g), U, 0.42 * k, F, s * 0.1 * k, Rt); pole = comb([0, 0, 0], s, Rt, -0.4, F, -0.3, U);
          } else if (type === 'shaka') {      // hands up in front of the face, shaking the shaka
            tgt = comb(sh, 0.12 * k + 0.03 * k * Math.sin(15 * g + s), U, 0.4 * k, F, (-s * 0.04 + 0.05 * Math.sin(17 * g)) * k, Rt); pole = comb([0, 0, 0], s, Rt, -0.8, U, 0, U);
          } else {                            // can't hear you: kicking-side hand cupped to the ear, the other arm out wide
            const ear = s === pl.m;
            if (ear) { tgt = comb(b.head, s * 0.12 * k, Rt, -0.03 * k, F, -0.03 * k, U); pole = comb([0, 0, 0], s, Rt, -0.5, U, 0, U); }
            else { tgt = comb(sh, s * 0.5 * k, Rt, 0.1 * k, F, -0.12 * k, U); pole = comb([0, 0, 0], -1, U, -0.3, F, 0, U); }
          }
          armTo(b, sd, lerpArr(a.hand, tgt, gw), pole);
        }
        if (type === 'pointUp') b.H = { F: norm(comb([0, 0, 0], 0.5, F, 0.86, U, 0, U)), U: norm(comb([0, 0, 0], 0.5, U, -0.86, F, 0, U)), w: gw };
        if (type === 'cantHear') b.H = { F: norm(comb([0, 0, 0], 1, F, 0.25 * -pl.m, Rt, 0.1, U)), U: norm(comb([0, 0, 0], 1, U, 0.3 * pl.m, Rt, 0, U)), w: gw };
      }
      return Object.assign(b, { celebDir: D, celeb: type });
    }
    const bRun = bodyFromPose(J, hd);
    const g = Math.max(0, u - TR);
    let body2;
    if (jump) {
      // Siuuu: take off, half-turn in the air, land wide with the arms thrust down and the chest out
      const s = clamp(g / 0.55, 0, 1), a = Math.PI * smooth(0.1, 0.9, s);
      const Fh = norm(comb([0, 0, 0], Math.cos(a), D, Math.sin(a) * -pl.m, Lft, 0, up));
      const o = add(root, mul(D, 1.0 * smooth(0, 1, s)));
      const lift = s < 1 ? 4 * 0.45 * s * (1 - s) : 0;
      const air = forward(o, Fh, ch.height, { lean: -0.05, ground: lift, head: { pitch: -0.2, w: 0.8 },
        L: { hip: 0.35, knee: 0.9, abd: 0.1 }, R: { hip: 0.15, knee: 0.6, abd: 0.1 }, aL: { flex: 2.4, abd: 0.6, elbow: 0.3 }, aR: { flex: 2.4, abd: 0.6, elbow: 0.3 } });
      const land = forward(o, Fh, ch.height, { lean: -0.14, drop: 0.1, ground: 0, head: { pitch: -0.3, w: 0.9 },
        L: { hip: 0.05, abd: 0.32, knee: 0.35 }, R: { hip: 0.05, abd: 0.32, knee: 0.35 }, aL: { flex: -0.1, abd: 0.6, elbow: 0.05 }, aR: { flex: -0.1, abd: 0.6, elbow: 0.05 } });
      body2 = blendBody(air, land, smooth(0.82, 1.0, s));
    } else {
      // slides: the run carries on into the slide, which loses its speed on the grass
      const Ts = type === 'penguin' ? 1.1 : 0.95;
      const x = g < Ts ? vmax * (g - g * g / (2 * Ts)) : vmax * Ts / 2;
      const o = add(root, mul(D, x)), still = smooth(Ts * 0.8, Ts + 0.3, g);
      if (type === 'kneeSlide') {
        // on the knees, leaning back, arms flung wide, roaring at the crowd
        body2 = forward(o, D, ch.height, { lean: -0.35 - 0.15 * still, drop: 0.463 * k - 0.08, head: { pitch: -0.35, w: 0.9 },
          L: { hip: 0.12, knee: 1.7, abd: 0.14, pitch: Math.PI + 0.15 }, R: { hip: 0.12, knee: 1.7, abd: 0.14, pitch: Math.PI + 0.15 },
          aL: { flex: 0.5 + 0.4 * still, abd: 1.25, elbow: 0.4 + 0.9 * still }, aR: { flex: 0.5 + 0.4 * still, abd: 1.25, elbow: 0.4 + 0.9 * still } });
      } else {
        // penguin: flat on the belly, arms tight along the sides, feet flicking up behind
        const kick = 0.3 * Math.max(0, Math.sin(6 * g)) * still;
        body2 = forward(o, D, ch.height, { lean: 1.5, drop: DIM.pelvis * k - 0.15, head: { pitch: -0.05, w: 0.9 },
          L: { hip: -1.45, knee: 0.15 + kick, abd: 0.06, pitch: Math.PI - 0.3 }, R: { hip: -1.45, knee: 0.15 + 0.3 * Math.max(0, Math.sin(6 * g + 1.5)) * still, abd: 0.06, pitch: Math.PI - 0.3 },
          aL: { flex: -0.25, abd: 0.1, elbow: 0.05 }, aR: { flex: -0.25, abd: 0.1, elbow: 0.05 } });
        body2.P = { F: body2.F, U: body2.U, Rt: body2.Rt };     // the pelvis lies flat with the trunk
      }
    }
    b = blendBody(bRun, body2, smooth(TR - 0.12, TR + 0.2, u));
    // nothing goes into the grass while he drops into the slide
    let low = Infinity;
    for (const s of ['L', 'R']) low = Math.min(low, b.legs[s].knee[2], b.legs[s].ankle[2], b.legs[s].toe[2], b.arms[s].hand[2]);
    if (low < 0.03) shiftBody(b, 0.03 - low);
    return Object.assign(b, { celebDir: D, celeb: type });
  }

  /**
   * The taker at time t (s from the strike), from motion capture; falls back to the procedural model without it.
   * celeb: { tGoal } after a goal (t of the goal) — he celebrates once his follow-through is done.
   */
  function kickerBody(ch, t, ball, aim, clock = 0, celeb = null) {
    if (!MOCAP) return kickerBodyProc(ch, t, ball, aim, clock);
    const pl = mocapPlan(ch, ball, aim);
    if (celeb && celeb.tGoal !== undefined) {
      const ts = Math.max(celeb.tGoal + 0.4, pl.tE - 0.2);
      if (t > ts) return celebrate(ch, pl, t - ts, clock);
    }
    let J;
    if (t < pl.tS + 0.45) {
      // waiting at the mark (recorded standing: breathing, small weight shifts), then setting off
      const q = pl.pathAt(pl.tS), idle = pl.idleAt(clock, q.p, pl.heading(pl.tS));
      J = mixPose(idle, t > pl.tS - 0.1 ? pl.runAt(t) : idle, smooth(pl.tS - 0.1, pl.tS + 0.4, t));
    } else if (t < pl.tR + 0.18) {
      J = mixPose(pl.runAt(t), t > pl.tR - 0.03 ? pl.kickAt(t) : null, smooth(pl.tR - 0.03, pl.tR + 0.16, t));
    } else {
      J = pl.kickAt(t);
      // after the recording ends he stands where it left him
      if (t > pl.tE - 0.6) J = mixPose(J, pl.idleAt(clock, pl.end, pl.endX), smooth(pl.tE - 0.6, pl.tE, t));
    }
    const b = bodyFromPose(J, ch);
    // the striking surface, by technique: curlers turn the toes out (inside of the foot), the outside-foot strike
    // turns them in; instep and knuckle strikes keep the recorded laces-on-ball foot
    if (pl.tech === 'curl' || pl.tech === 'outside') {
      const w = smooth(-0.24, -0.08, t) * (1 - smooth(0.08, 0.4, t));
      if (w > 0) {
        const leg = b.legs[pl.kickS], m = pl.m, up = [0, 0, 1];
        const inst = pl.tech === 'curl' ? norm(comb([0, 0, 0], 0.72, pl.F0, -0.3, up, m * 0.62, pl.R0))
          : norm(comb([0, 0, 0], 0.68, pl.F0, -0.55, up, -m * 0.48, pl.R0));
        const fd0 = norm(sub(leg.toe, leg.ankle));
        const fd = norm(comb([0, 0, 0], w, inst, 1 - w, fd0, 0, up));
        leg.toe = add(leg.ankle, mul(fd, DIM.foot * b.k));
        if (leg.toe[2] < 0.02) leg.toe[2] = 0.02;
      }
    }
    return b;
  }
  /** Total run-up time (s) before the strike. */
  function runTime(ch) {
    if (!MOCAP) return runTimeProc(ch);
    const pl = mocapPlan(ch, { x: 20, y: 0 }, [-1, 0]);
    return -pl.tS;
  }

  void kickerBodyKeyframed;
  return { CHARACTERS, CHAR_BY_ID, DIM, forward, ik2, wallBody, keeperBody, kickerBody, kickerBodyProc, runTime, norm, cross, MOCAP, CELEB_OF, CELEB_NAMES };
});
