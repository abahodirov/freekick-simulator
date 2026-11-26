/*
 * Free Kick Simulator — camera rig (pure maths, no DOM, testable in Node).
 * desired(name, ctx) returns the target camera { eye, target, up, fov, k } (k = smoothing rate, 1/s).
 * World frame as in physics.js: +x away from goal, +y kicker's right, +z up.
 *
 * ctx: { ball:{x,y}, s:state[0..5], mode:'aim'|'live'|'done', goal:bool, followDir:[x,y] (mutated),
 *        orbit:{yaw,pitch,dist}, inspect:{yaw,pitch,dist}, opts:{followBack,followUp}, keeperY }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FKCam = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // order = keys 1..9. Each camera has one teaching purpose.
  const NAMES = ['kicker', 'follow', 'broadcast', 'top', 'goal', 'orbit', 'keeper', 'side', 'physics', 'taker'];
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function desired(name, c) {
    const b0 = c.ball, s = c.s, d = Math.hypot(b0.x, b0.y) || 1;
    const fx = -b0.x / d, fy = -b0.y / d;
    const near = b0.y >= 0 ? 1 : -1;
    const mid = [b0.x / 2, b0.y / 2, 1];
    const o = c.opts || { followBack: 5.5, followUp: 1.3 };
    const dir = () => {                       // direction of travel, held when the ball is slow or has scored
      const vh = Math.hypot(s[3], s[4]);
      if (c.mode === 'aim') { c.followDir[0] = fx; c.followDir[1] = fy; }
      else if (vh > 2.5 && !c.goal) { c.followDir[0] = s[3] / vh; c.followDir[1] = s[4] / vh; }
      return c.followDir;
    };
    switch (name) {
      case 'follow': {                        // chase cam: adjustable offset, looks ahead of the ball by speed
        const [dx, dy] = dir(), sp = Math.hypot(s[3], s[4], s[5]);
        const lead = clamp(sp * 0.16, 2.5, 6.5);
        return { eye: [s[0] - dx * o.followBack, s[1] - dy * o.followBack, Math.max(0.7, s[2] + o.followUp)],
          target: [s[0] + dx * lead, s[1] + dy * lead, s[2] + 0.2], up: [0, 0, 1], fov: 0.9, k: 9 };
      }
      case 'physics': {                       // 3/4 side view of the ball: spin axis, Magnus and drag are readable
        const [dx, dy] = dir(), rx = dy, ry = -dx;          // right of travel
        return { eye: [s[0] - dx * 3.2 + rx * 3.4 * near, s[1] - dy * 3.2 + ry * 3.4 * near, Math.max(0.8, s[2] + 1.1)],
          target: [s[0], s[1], s[2]], up: [0, 0, 1], fov: 0.7, k: 12 };
      }
      case 'keeper': {                        // through the goalkeeper's eyes: crouch, shuffle and dive with him
        const h = c.keeperHead;
        if (!h) return { eye: [0.6, c.keeperY || 0, 1.75], target: [s[0], s[1], Math.max(0.6, s[2])], up: [0, 0, 1], fov: 0.8, k: 10 };
        // the eyes sit a little in front of the head's centre (the near plane hides the head itself)
        const eye = [h.pos[0] + h.F[0] * 0.1 + h.U[0] * 0.03, h.pos[1] + h.F[1] * 0.1 + h.U[1] * 0.03, Math.max(0.12, h.pos[2] + h.F[2] * 0.1 + h.U[2] * 0.03)];
        // he never takes his eyes off the ball; once it is past him (in the net) he looks back out at the pitch
        const past = s[0] < eye[0] + 0.4;
        const target = past ? [eye[0] + 12, eye[1] * 0.5 + s[1] * 0.5, 1.0] : [s[0], s[1], Math.max(0.1, s[2])];
        // the head's roll carries into the view during a dive, softened so it reads as a tilt, not a spin
        const up = [h.U[0] * 0.4, h.U[1] * 0.4, 0.6 + h.U[2] * 0.4];
        return { eye, target, up, fov: 1.05, k: 22 };
      }
      case 'side':                            // pure elevation view: height, dip and the wall clearance
        return { eye: [mid[0], -40, 2.2], target: [mid[0], mid[1], 2.2], up: [0, 0, 1], fov: 0.5, k: 6 };
      case 'inspect': {                       // paused: orbit the ball itself
        const i = c.inspect, cp = Math.cos(i.pitch);
        return { eye: [s[0] + i.dist * cp * Math.cos(i.yaw), s[1] + i.dist * cp * Math.sin(i.yaw), s[2] + i.dist * Math.sin(i.pitch)],
          target: [s[0], s[1], s[2]], up: [0, 0, 1], fov: 0.7, k: 16 };
      }
      case 'broadcast': {                     // the TV main camera: high in the main stand behind the ball, long lens,
        // goal top left, wall in the middle, taker bottom right; once the ball is struck it pans gently after it
        const t0 = [b0.x * 0.64, b0.y * 0.64, 0.6], live = c.mode !== 'aim' ? 0.35 : 0;
        return { eye: [b0.x + 26, -34, 13], target: [t0[0] + (s[0] - t0[0]) * live, t0[1] + (s[1] - t0[1]) * live, t0[2] + (s[2] - t0[2]) * live * 0.5],
          up: [0, 0, 1], fov: 0.34, k: 4 };
      }
      case 'top':
        return { eye: [mid[0] + 0.01, mid[1] * 0.6, 12 + d * 1.25], target: [mid[0], mid[1] * 0.6, 0], up: [-1, 0, 0], fov: 0.8, k: 6 };
      case 'goal':
        return { eye: [-7.6, -near * 1.2, 3.3], target: [s[0] * 0.6, s[1] * 0.6, 0.8 + s[2] * 0.4], up: [0, 0, 1], fov: 0.75, k: 7 };
      case 'ballcam': {                       // Ball lab: a slow orbit 0.9 m from the ball, to see its panels
        const a = (c.time || 0) * 0.35;
        return { eye: [s[0] + 0.9 * Math.cos(a), s[1] + 0.9 * Math.sin(a), s[2] + 0.3], target: [s[0], s[1], s[2]], up: [0, 0, 1], fov: 0.5, k: 8 };
      }
      case 'taker': {                         // through the taker's eyes: the ball at his feet, the wall and the goal ahead
        const h = c.takerHead;
        if (h && c.mode !== 'done') {
          const eye = [h.pos[0] + h.F[0] * 0.1 + h.U[0] * 0.03, h.pos[1] + h.F[1] * 0.1 + h.U[1] * 0.03, Math.max(0.3, h.pos[2] + 0.03)];
          // before the strike he looks over the ball at the goal; once it is struck his eyes follow it
          const struck = c.mode === 'live' && Math.hypot(s[0] - b0.x, s[1] - b0.y) > 0.4;
          const target = struck ? [s[0], s[1], Math.max(0.3, s[2])] : [b0.x * 0.55, b0.y * 0.55, 0.55];
          return { eye, target, up: [h.U[0] * 0.25, h.U[1] * 0.25, 0.75 + h.U[2] * 0.25], fov: 1.0, k: 16 };
        }
        return desired('takerside', c);
      }
      case 'takerside': {                     // the free-kick taker: run-up, plant foot and strike, from the front-side (#cam=takerside)
        const t = c.taker || { x: b0.x, y: b0.y, z: 1 };
        const sx = near > 0 ? 1 : -1;
        const ex = t.x + fx * 3.6 - fy * 2.6 * sx, ey = t.y + fy * 3.6 + fx * 2.6 * sx;
        return { eye: [ex, ey, 1.25], target: [t.x * 0.75 + b0.x * 0.25, t.y * 0.75 + b0.y * 0.25, 0.85], up: [0, 0, 1], fov: 0.62, k: 5 };
      }
      case 'celebrate': {                     // the scorer celebrating: in front of him as he runs to the crowd
        const t = c.taker || { x: b0.x, y: b0.y, z: 1 }, d = c.celeb || { dx: -fx, dy: -fy };
        // a 3/4 view well off his line, so a sliding player never passes under the camera; lower for a slide
        const ex = t.x + d.dx * 5.2 - d.dy * 3.6, ey = t.y + d.dy * 5.2 + d.dx * 3.6;
        return { eye: [ex, ey, 0.9 + 0.6 * Math.min(1, t.z)], target: [t.x + d.dx * 0.6, t.y + d.dy * 0.6, Math.max(0.35, t.z * 0.9)], up: [0, 0, 1], fov: 0.62, k: 5 };
      }
      case 'portrait': {                      // head-and-shoulders close-up of the taker, from in front (#cam=portrait)
        const t = c.taker || { x: b0.x, y: b0.y, z: 1 };
        // waiting at the mark he faces the ball: look at him from that side, a little to one side (3/4 view)
        let dx = b0.x - t.x, dy = b0.y - t.y; const dl = Math.hypot(dx, dy);
        if (dl < 0.5) { dx = fx; dy = fy; } else { dx /= dl; dy /= dl; }
        const ex = t.x + dx * 1.5 - dy * 0.45, ey = t.y + dy * 1.5 + dx * 0.45;
        return { eye: [ex, ey, t.z * 1.6 + 0.05], target: [t.x, t.y, t.z * 1.6 - 0.07], up: [0, 0, 1], fov: 0.42, k: 8 };
      }
      case 'gkfront':                         // the goalkeeper from the pitch, in front of the goal (#cam=gkfront)
        return { eye: [9, (c.keeperY || 0) * 0.5, 1.5], target: [0, (c.keeperY || 0) * 0.6, 1.1], up: [0, 0, 1], fov: 0.62, k: 6 };
      case 'track': {                         // side-on to the taker's run toward the ball (#cam=track), for studying the gait
        const t = c.taker || { x: b0.x, y: b0.y, z: 1 };
        let dx = b0.x - t.x, dy = b0.y - t.y; const dl = Math.hypot(dx, dy);
        if (dl < 0.8) { dx = fx; dy = fy; } else { dx /= dl; dy /= dl; }
        return { eye: [t.x - dy * 5.5, t.y + dx * 5.5, 1.0], target: [t.x, t.y, 0.85], up: [0, 0, 1], fov: 0.5, k: 30 };
      }
      case 'figure': case 'profile': {        // whole taker from in front (#cam=figure) or from the side (#cam=profile)
        const t = c.taker || { x: b0.x, y: b0.y, z: 1 };
        const side = name === 'profile';
        const ex = t.x + (side ? -fy : fx) * 4.2, ey = t.y + (side ? fx : fy) * 4.2;
        return { eye: [ex, ey, 1.05], target: [t.x, t.y, 0.92], up: [0, 0, 1], fov: 0.52, k: 8 };
      }
      case 'orbit': {
        const cp = Math.cos(c.orbit.pitch), r = c.orbit;
        return { eye: [mid[0] + r.dist * cp * Math.cos(r.yaw), mid[1] + r.dist * cp * Math.sin(r.yaw), 1 + r.dist * Math.sin(r.pitch)], target: mid, up: [0, 0, 1], fov: 0.75, k: 14 };
      }
      default: {                              // 'kicker'
        let ex = b0.x - fx * 7.5, ey = b0.y - fy * 7.5;
        // a long run-up starts right under this camera: step aside so the taker's head does not fill the frame
        const t = c.taker;
        if (t) {
          const px = -fy, py = fx, side = (t.x - ex) * px + (t.y - ey) * py, along = (t.x - ex) * fx + (t.y - ey) * fy;
          if (along > -0.5 && along < 2.5 && Math.abs(side) < 1.4) { const s = (side >= 0 ? -1 : 1) * (1.4 - Math.abs(side)); ex += px * s; ey += py * s; }
        }
        return { eye: [ex, ey, 2.35], target: [b0.x + fx * d * 0.8, b0.y + fy * d * 0.8, 1.25], up: [0, 0, 1], fov: 0.72, k: 6 };
      }
    }
  }
  return { NAMES, desired };
});
