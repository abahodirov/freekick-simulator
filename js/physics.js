/*
 * Free Kick Simulator — physics engine
 *
 * Pure, dependency-free and DOM-free so the same code runs in the browser
 * (live shot, aim preview, Monte Carlo) and in Node (tests/physics.test.js).
 *
 * World frame (SI units throughout):
 *   origin  = centre of the goal line, on the ground
 *   +x      = up the pitch, away from the goal (the ball is kicked toward -x)
 *   +y      = to the kicker's right when facing the goal
 *   +z      = up
 *
 * Ball state vector s = [x y z | vx vy vz | wx wy wz]  (position, velocity, spin in rad/s)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FK = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────────── constants ─────────────────────────────
  const C = Object.freeze({
    BALL_MASS: 0.43,            // kg   (Law 2: 410–450 g)
    BALL_RADIUS: 0.11,          // m    (circumference 68–70 cm)
    G: 9.80665,                 // m/s²
    GOAL_HALF_WIDTH: 3.66,      // m    (7.32 m between posts)
    GOAL_HEIGHT: 2.44,          // m    (ground to underside of bar)
    POST_RADIUS: 0.06,          // m    (12 cm posts)
    NET_DEPTH: 2.0,             // m
    WALL_DISTANCE: 9.15,        // m    (10 yards)
    PITCH_LENGTH: 105,
    PITCH_WIDTH: 68,
    PEN_AREA_DEPTH: 16.5,
    PEN_AREA_HALF_WIDTH: 20.16,
  });

  const M = C.BALL_MASS;
  const R = C.BALL_RADIUS;
  const AREA = Math.PI * R * R;
  const INERTIA = (2 / 3) * M * R * R;      // thin spherical shell
  const MR2_OVER_I = (M * R * R) / INERTIA; // = 1.5
  const TWO_PI = Math.PI * 2;
  const DEG = Math.PI / 180;

  // Aerodynamics. Drag crisis fit after Goff & Carré (2009): Cd falls from ~0.35 to
  // ~0.16 around v ≈ 12 m/s at sea level. Expressed in Reynolds number so that air
  // temperature / altitude move the transition the way they do in reality.
  const CD_SUB = 0.346, CD_SUPER = 0.155;
  const RE_CRIT = 1.78e5, RE_WIDTH = 1.91e4;
  const CD_SPIN = 0.3;           // extra drag per unit spin parameter (spinning balls are draggier)
  const CL_A = 2.32, CL_B = 0.4; // lift: Cl = S / (A·S + B), saturating fit, Cl≈0.16–0.27 for S=0.1–0.3
  const SPIN_DECAY = 0.02;       // aerodynamic spin-down moment coefficient per unit spin parameter
  const KNUCKLE_CL = 0.13;       // peak unsteady side-force coefficient of a non-spinning ball
  const KNUCKLE_SPIN_LIMIT = 0.055; // spin parameter above which the knuckle effect vanishes

  // Contact
  const REST_SPEED = 0.35;       // m/s — rebounds slower than this become rolling contact
  const POST_E = 0.7, POST_MU = 0.3;
  const BODY_E = 0.42, BODY_MU = 0.45;
  const KEEPER_E = 0.3, KEEPER_MU = 0.5;
  const NET_K = 420, NET_C = 20, NET_CT = 7; // net as a spring-damper membrane (N/m, N·s/m)

  const POST_Y = C.GOAL_HALF_WIDTH + C.POST_RADIUS;   // post centre line
  const BAR_Z = C.GOAL_HEIGHT + C.POST_RADIUS;        // crossbar centre line

  const SURFACES = {
    dry:  { label: 'Dry grass',       restitution: 0.60, friction: 0.55, rolling: 0.090 },
    wet:  { label: 'Wet grass',       restitution: 0.55, friction: 0.32, rolling: 0.065 },
    turf: { label: 'Artificial turf', restitution: 0.67, friction: 0.60, rolling: 0.060 },
  };

  const KEEPER_LEVELS = {
    amateur: { label: 'Amateur',     react: 0.34, acc: 10, vmax: 5.2, err: 0.55, catchSpeed: 14 },
    pro:     { label: 'Professional', react: 0.27, acc: 13, vmax: 6.3, err: 0.30, catchSpeed: 19 },
    world:   { label: 'World class', react: 0.22, acc: 16, vmax: 7.4, err: 0.12, catchSpeed: 23 },
  };

  // Kick-to-kick execution scatter (1σ): relative speed, angles in degrees, spin in rev/s
  const NOISE_LEVELS = {
    off:     null,
    pro:     { label: 'Professional', speed: 0.015, angle: 0.45, spin: 0.4 },
    amateur: { label: 'Amateur',      speed: 0.04,  angle: 1.3,  spin: 1.0 },
  };

  // ───────────────────────────── utilities ─────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    let u = 0;
    while (u < 1e-12) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * rng());
  }

  // ───────────────────────────── atmosphere ─────────────────────────────
  /** Moist-air density and viscosity. tempC in °C, altitude in m, humidity 0..1. */
  function atmosphere(tempC, altitude, humidity) {
    const T = tempC + 273.15;
    const pressure = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);   // ISA barometric formula
    const pSat = 610.94 * Math.exp((17.625 * tempC) / (tempC + 243.04));      // Magnus formula
    const pVap = clamp(humidity, 0, 1) * pSat;
    const rho = (pressure - pVap) / (287.058 * T) + pVap / (461.495 * T);     // dry air + water vapour
    const mu = 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4); // Sutherland
    return { rho, mu, pressure };
  }

  function dragCoefficient(Re, S) {
    if (S > 1) S = 1;   // the spin correction is only meaningful for ordinary spin parameters
    return CD_SUPER + (CD_SUB - CD_SUPER) / (1 + Math.exp((Re - RE_CRIT) / RE_WIDTH)) + CD_SPIN * S;
  }

  function liftCoefficient(S) {
    return S <= 0 ? 0 : S / (CL_A * S + CL_B);
  }

  // ───────────────────────────── configuration ─────────────────────────────
  function defaultConfig() {
    return {
      ball: { x: 24, y: 5 },                       // free-kick spot (m)
      kick: { speed: 27, azimuth: 0, elevation: 16, sideSpin: 0, topSpin: 0 },
      //      m/s        deg (+ = right of the line to goal centre)   deg
      //      sideSpin rev/s (+ = ball curls to the kicker's right), topSpin rev/s (+ = topspin, − = backspin)
      env: { windSpeed: 0, windDir: 0, temperature: 20, altitude: 0, humidity: 50, surface: 'dry' },
      //     m/s           deg: direction the wind blows TOWARD; 0 = toward the goal line, 90 = toward +y
      wall: { count: 4, jump: true },
      keeper: { level: 'pro' },                    // 'off' | 'amateur' | 'pro' | 'world'
      physics: { drag: true, magnus: true, knuckle: true },
      seed: 1,
    };
  }

  function cloneConfig(cfg) { return JSON.parse(JSON.stringify(cfg)); }

  /** Keep the ball on the pitch, outside the penalty area, and a sane distance from goal. */
  function clampBallPosition(x, y) {
    y = clamp(y, -C.PITCH_WIDTH / 2 + 1, C.PITCH_WIDTH / 2 - 1);
    x = clamp(x, 3, 45);
    const m = 0.6;
    if (x < C.PEN_AREA_DEPTH + m && Math.abs(y) < C.PEN_AREA_HALF_WIDTH + m) {
      // push out through the nearest edge of the box
      const dFront = C.PEN_AREA_DEPTH + m - x;
      const dSide = C.PEN_AREA_HALF_WIDTH + m - Math.abs(y);
      if (dFront <= dSide) x = C.PEN_AREA_DEPTH + m;
      else y = (y >= 0 ? 1 : -1) * (C.PEN_AREA_HALF_WIDTH + m);
    }
    return { x, y };
  }

  /** Initial velocity and spin for a kick. Also returns the kicker's horizontal frame. */
  function launchState(cfg) {
    const b = cfg.ball, k = cfg.kick;
    const d = Math.hypot(b.x, b.y) || 1;
    const f0x = -b.x / d, f0y = -b.y / d;          // toward goal centre
    const r0x = f0y, r0y = -f0x;                   // kicker's right = f × ẑ
    const az = k.azimuth * DEG, el = k.elevation * DEG;
    const fx = f0x * Math.cos(az) + r0x * Math.sin(az);
    const fy = f0y * Math.cos(az) + r0y * Math.sin(az);
    const rx = fy, ry = -fx;                       // right of the actual launch direction
    const ce = Math.cos(el), se = Math.sin(el);
    const wSide = -TWO_PI * k.sideSpin;            // about ẑ; negative ωz → Magnus force to the right
    const wTop = -TWO_PI * k.topSpin;              // about the right axis; +right = backspin
    return {
      vx: k.speed * fx * ce, vy: k.speed * fy * ce, vz: k.speed * se,
      wx: wTop * rx, wy: wTop * ry, wz: wSide,
      fx, fy, rx, ry,
    };
  }

  // ───────────────────────────── scenario actors ─────────────────────────────
  function buildWall(cfg, rng) {
    const n = cfg.wall.count | 0;
    const players = [];
    if (n <= 0) return players;
    const b = cfg.ball;
    const sgn = b.y >= 0 ? 1 : -1;                  // near post is on the ball's side
    let dx = 0 - b.x, dy = sgn * C.GOAL_HALF_WIDTH - b.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    // direction along the wall, pointing from the near-post side toward the far post
    let px = -dy, py = dx;
    if (py * -sgn < 0) { px = -px; py = -py; }
    const dist = Math.min(C.WALL_DISTANCE, dl - 0.5);
    const bx = b.x + dx * dist, by = b.y + dy * dist;
    for (let i = 0; i < n; i++) {
      const off = (i - 0.7) * 0.52;                 // first player overlaps the ball→near-post line
      players.push({
        x: Math.max(0.35, bx + px * off),
        y: by + py * off,
        height: 1.76 + rng() * 0.16,
        jumpAt: cfg.wall.jump ? 0.10 + rng() * 0.12 : Infinity,
        jumpV: 2.4 + rng() * 0.5,
        z: 0, vz: 0,
        faceX: -dx, faceY: -dy,                     // unit vector toward the ball
      });
    }
    return players;
  }

  const KEEPER_REST_Z = 1.15, KEEPER_REACH = 2.25, KEEPER_TORSO = 1.5;

  function makeKeeper(cfg, rng, hasWall) {
    const lv = KEEPER_LEVELS[cfg.keeper.level];
    if (!lv) return null;
    const sgn = cfg.ball.y >= 0 ? 1 : -1;
    const y0 = hasWall ? -sgn * 0.7 : 0;            // the wall covers the near post; keeper shades far side
    const k = {
      level: lv, x: 0.45, y0,
      hy: y0, hz: KEEPER_REST_Z, vy: 0, vz: 0,      // hands (y,z) in the keeper plane and their velocity
      fy: y0, fz: 0, sy: y0, sz: KEEPER_TORSO,      // feet and shoulders, derived from the hands
      speed: 0, fallV: 0, state: 'ready',
      tReact: lv.react + (hasWall ? 0.05 : 0) + rng() * 0.04,
      errY: gaussian(rng) * lv.err, errZ: gaussian(rng) * lv.err * 0.6,
      truthY: 0, truthZ: 0, tArrive: 0, tDecide: 0,
    };
    keeperPose(k);
    return k;
  }

  /** Derive feet and shoulder points from the hand position (simple reach skeleton). */
  function keeperPose(k) {
    const py = k.y0 + 0.25 * (k.hy - k.y0);         // planted-foot pivot drifts toward the dive side
    const dy = k.hy - py, dz = k.hz;
    const len = Math.hypot(dy, dz) || 1e-6;
    const uy = dy / len, uz = dz / len;
    if (len >= KEEPER_REACH) {                      // fully stretched: body is a straight line
      k.fy = k.hy - KEEPER_REACH * uy; k.fz = k.hz - KEEPER_REACH * uz;
      k.sy = k.fy + KEEPER_TORSO * uy; k.sz = k.fz + KEEPER_TORSO * uz;
    } else {                                        // feet planted, torso leans toward the hands
      const s = clamp((len - 1.3) / (KEEPER_REACH - 1.3), 0, 1);
      let ty = uy * s, tz = 1 - s + uz * s;
      const tl = Math.hypot(ty, tz) || 1;
      ty /= tl; tz /= tl;
      k.fy = py; k.fz = 0;
      k.sy = py + KEEPER_TORSO * ty; k.sz = KEEPER_TORSO * tz;
    }
  }

  // ───────────────────────────── simulation ─────────────────────────────
  class Simulation {
    /**
     * @param cfg  see defaultConfig()
     * @param opts { dt, obstacles (goal/wall/keeper), record, fast (stop as soon as the outcome is known), state }
     */
    constructor(cfg, opts) {
      opts = opts || {};
      this.cfg = cfg;
      this.dt = opts.dt || 1 / 1000;
      this.obstacles = opts.obstacles !== false;
      this.fast = !!opts.fast;
      this.recording = opts.record !== false;

      const env = cfg.env;
      this.atm = atmosphere(env.temperature, env.altitude, env.humidity / 100);
      this.rho = this.atm.rho;
      this.mu = this.atm.mu;
      this.surf = SURFACES[env.surface] || SURFACES.dry;
      this.g = C.G;
      const wd = env.windDir * DEG;
      this.windX = -env.windSpeed * Math.cos(wd);
      this.windY = env.windSpeed * Math.sin(wd);
      this.useDrag = cfg.physics.drag;
      this.useMagnus = cfg.physics.magnus;
      this.useKnuckle = cfg.physics.knuckle;

      // RNG draw order is fixed so a seed always reproduces the same shot.
      const rng = mulberry32((cfg.seed | 0) * 2654435761 + 12345);
      this.kp1 = rng() * TWO_PI; this.kp2 = rng() * TWO_PI;
      this.kk1 = TWO_PI / (10 + rng() * 6); this.kk2 = TWO_PI / (13 + rng() * 8);
      this.knTheta = 0;     // accumulated rotation angle (rad)
      this.pathLen = 0;     // distance travelled (m)

      this.s = new Float64Array(9);
      this._k1 = new Float64Array(9); this._k2 = new Float64Array(9);
      this._k3 = new Float64Array(9); this._k4 = new Float64Array(9);
      this._tmp = new Float64Array(9);
      this.q = [1, 0, 0, 0];   // orientation quaternion (w,x,y,z), for rendering

      const L = launchState(cfg);
      this.launch = L;
      const s = this.s;
      s[0] = cfg.ball.x; s[1] = cfg.ball.y; s[2] = R;
      s[3] = L.vx; s[4] = L.vy; s[5] = L.vz;
      s[6] = L.wx; s[7] = L.wy; s[8] = L.wz;
      if (opts.state) s.set(opts.state);
      this.x0 = s[0]; this.y0 = s[1];

      this.wall = this.obstacles ? buildWall(cfg, rng) : [];
      this.keeper = this.obstacles ? makeKeeper(cfg, rng, this.wall.length > 0) : null;
      this.net = this.obstacles ? [
        // axis: coordinate normal to the panel; sign: outward normal direction along that axis
        { name: 'back',  axis: 0, pos: -C.NET_DEPTH, sign: -1, latch: 0, pen: 0, u: 0, v: 0 },
        { name: 'left',  axis: 1, pos: -POST_Y,      sign: -1, latch: 0, pen: 0, u: 0, v: 0 },
        { name: 'right', axis: 1, pos: POST_Y,       sign: 1,  latch: 0, pen: 0, u: 0, v: 0 },
        { name: 'top',   axis: 2, pos: BAR_Z,        sign: 1,  latch: 0, pen: 0, u: 0, v: 0 },
      ] : [];

      this.t = 0;
      this.steps = 0;
      this.rolling = false;
      this.atRest = false;
      this.done = false;
      this.caught = false;
      this.goal = false;
      this.enteredMouth = false;
      this.offTarget = null;        // 'over' | 'wide'
      this.crossing = null;         // where the ball centre crossed the goal-line plane
      this.touched = { wall: false, keeper: false, post: false, bar: false };
      this.firstTouchT = -1;
      this.tGoal = -1; this.tCaught = -1;
      this.bounces = 0;
      this.firstBounce = null;
      this.maxHeight = s[2];
      this.curve = 0;               // lateral deviation from the straight launch line (m, + = right)
      this._curveFrozen = false;
      this.events = [];             // drained by the UI for sound: {type, speed}

      this.rec = { t: [], x: [], y: [], z: [], v: [], spin: [] };
      this._recEvery = Math.max(1, Math.round(0.01 / this.dt));
      this._record();
    }

    // ── derivatives: gravity + aerodynamics + net membrane ──
    _deriv(s, o) {
      const vx = s[3], vy = s[4], vz = s[5], wx = s[6], wy = s[7], wz = s[8];
      let ax = 0, ay = 0, az = -this.g, dw = 0;

      const rx = vx - this.windX, ry = vy - this.windY, rz = vz;   // velocity relative to the air
      const sp2 = rx * rx + ry * ry + rz * rz;
      if (sp2 > 1e-10 && this.rho > 0) {
        const sp = Math.sqrt(sp2);
        const cx = wy * rz - wz * ry, cy = wz * rx - wx * rz, cz = wx * ry - wy * rx; // ω × v
        const cmag = Math.sqrt(cx * cx + cy * cy + cz * cz);
        const S = R * cmag / sp2;                          // spin parameter r·ω⊥ / v
        const Re = this.rho * sp * 2 * R / this.mu;
        const q = 0.5 * this.rho * AREA * sp / M;          // ½ρA|v|/m

        if (this.useDrag) {
          const cd = dragCoefficient(Re, S);
          ax -= q * cd * rx; ay -= q * cd * ry; az -= q * cd * rz;
          // skin friction slowly spins the ball down
          dw = -(this.rho * AREA * R * R * SPIN_DECAY * sp) / INERTIA;
        }
        if (this.useMagnus && cmag > 1e-9) {
          const k = q * liftCoefficient(S) * sp / cmag;    // ½ρA·Cl·v² along (ω × v)
          ax += k * cx; ay += k * cy; az += k * cz;
        }
        if (this.useKnuckle) {
          const wmag = Math.sqrt(wx * wx + wy * wy + wz * wz);
          let kf = 1 - (R * wmag / sp) / KNUCKLE_SPIN_LIMIT;
          const h = Math.sqrt(rx * rx + ry * ry);
          if (kf > 0 && h > 1e-6) {
            kf *= kf;
            const supercritical = 1 / (1 + Math.exp(-(Re - RE_CRIT) / RE_WIDTH));
            const ck = KNUCKLE_CL * kf * supercritical;
            // lateral basis ⟂ to the airflow: e1 = horizontal right, e2 = up-ish
            const e1x = ry / h, e1y = -rx / h;
            const e2x = e1y * rz / sp, e2y = -e1x * rz / sp, e2z = h / sp;
            const ph = this.knTheta * 4;
            const c1 = Math.sin(this.kp1 + ph + this.pathLen * this.kk1);
            const c2 = 0.6 * Math.sin(this.kp2 + 0.7 * ph + this.pathLen * this.kk2);
            const k = q * ck * sp;
            ax += k * (c1 * e1x + c2 * e2x);
            ay += k * (c1 * e1y + c2 * e2y);
            az += k * (c2 * e2z);
          }
        }
      }

      // net panels the ball is currently pressed into
      const net = this.net;
      for (let i = 0; i < net.length; i++) {
        const p = net[i];
        if (p.latch === 0) continue;
        const d = (s[p.axis] - p.pos) * p.sign;
        const pen = R - p.latch * d;
        if (pen <= 0) continue;
        const push = (p.latch * p.sign * NET_K * pen) / M;
        if (p.axis === 0)      { ax += push - (NET_C * vx) / M; ay -= (NET_CT * vy) / M; az -= (NET_CT * vz) / M; }
        else if (p.axis === 1) { ay += push - (NET_C * vy) / M; ax -= (NET_CT * vx) / M; az -= (NET_CT * vz) / M; }
        else                   { az += push - (NET_C * vz) / M; ax -= (NET_CT * vx) / M; ay -= (NET_CT * vy) / M; }
      }

      o[0] = vx; o[1] = vy; o[2] = vz;
      o[3] = ax; o[4] = ay; o[5] = az;
      o[6] = dw * wx; o[7] = dw * wy; o[8] = dw * wz;
    }

    _rk4(dt) {
      const s = this.s, k1 = this._k1, k2 = this._k2, k3 = this._k3, k4 = this._k4, tmp = this._tmp;
      const h = dt * 0.5;
      this._deriv(s, k1);
      for (let i = 0; i < 9; i++) tmp[i] = s[i] + h * k1[i];
      this._deriv(tmp, k2);
      for (let i = 0; i < 9; i++) tmp[i] = s[i] + h * k2[i];
      this._deriv(tmp, k3);
      for (let i = 0; i < 9; i++) tmp[i] = s[i] + dt * k3[i];
      this._deriv(tmp, k4);
      const c = dt / 6;
      for (let i = 0; i < 9; i++) s[i] += c * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }

    // ── rolling / sliding contact with the ground ──
    _rollStep(dt) {
      const s = this.s, k1 = this._k1;
      this._deriv(s, k1);                        // horizontal aero + net forces
      let ax = k1[3], ay = k1[4];
      const g = this.g;
      // velocity of the contact point: v + ω × (0,0,−R)
      const ux = s[3] - R * s[7], uy = s[4] + R * s[6];
      const us = Math.hypot(ux, uy);
      const f = this.surf.friction * g;
      let pureRoll = false;
      if (us > (1 + MR2_OVER_I) * f * dt) {
        // sliding: Coulomb friction opposes the contact-point velocity and torques the ball
        const fx = -f * ux / us, fy = -f * uy / us;
        ax += fx; ay += fy;
        s[6] += (R * fy * M / INERTIA) * dt;
        s[7] += (-R * fx * M / INERTIA) * dt;
      } else {
        // friction can cancel the remaining slip this step → rolling without slipping
        const jx = -ux / (1 + MR2_OVER_I), jy = -uy / (1 + MR2_OVER_I);
        s[3] += jx; s[4] += jy;
        pureRoll = true;
      }
      if (pureRoll) {
        // external force on a rolling shell accelerates it by F/(m + I/R²)
        const eff = 1 / (1 + 1 / MR2_OVER_I);
        s[3] += ax * eff * dt; s[4] += ay * eff * dt;
        const sp = Math.hypot(s[3], s[4]);
        const dec = this.surf.rolling * g * dt;
        if (sp <= dec) { s[3] = 0; s[4] = 0; }
        else { s[3] -= dec * s[3] / sp; s[4] -= dec * s[4] / sp; }
        s[6] = -s[4] / R; s[7] = s[3] / R;      // rolling constraint
      } else {
        s[3] += ax * dt; s[4] += ay * dt;
      }
      // pivoting friction kills spin about the vertical axis
      const dz = 14 * dt;
      s[8] = Math.abs(s[8]) <= dz ? 0 : s[8] - Math.sign(s[8]) * dz;
      s[0] += s[3] * dt; s[1] += s[4] * dt;
      s[2] = R; s[5] = 0;
      if (pureRoll && s[3] === 0 && s[4] === 0) this.atRest = true;
    }

    /**
     * Rigid-sphere impulse against a surface with unit normal n (pointing into the ball),
     * restitution e and Coulomb friction mu; the surface moves with velocity b.
     * Couples linear and angular momentum, so spin changes the rebound and vice versa.
     * Returns the closing speed along the normal (0 if already separating).
     */
    _impulse(nx, ny, nz, e, mu, bx, by, bz) {
      const s = this.s;
      const rvx = s[3] - bx, rvy = s[4] - by, rvz = s[5] - bz;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn >= 0) return 0;
      // contact point is at −R·n from the centre: its velocity is v − R(ω × n)
      const cvx = rvx - R * (s[7] * nz - s[8] * ny);
      const cvy = rvy - R * (s[8] * nx - s[6] * nz);
      const cvz = rvz - R * (s[6] * ny - s[7] * nx);
      const cn = cvx * nx + cvy * ny + cvz * nz;
      const tx = cvx - cn * nx, ty = cvy - cn * ny, tz = cvz - cn * nz;   // slip velocity
      const jn = -(1 + e) * vn;                    // normal impulse per unit mass
      // tangential impulse (per unit mass) that would stop the slip entirely
      let jx = -tx / (1 + MR2_OVER_I), jy = -ty / (1 + MR2_OVER_I), jz = -tz / (1 + MR2_OVER_I);
      const jt = Math.sqrt(jx * jx + jy * jy + jz * jz);
      const jmax = mu * jn;
      if (jt > jmax && jt > 0) { const k = jmax / jt; jx *= k; jy *= k; jz *= k; }  // sliding: Coulomb limit
      s[3] += jn * nx + jx; s[4] += jn * ny + jy; s[5] += jn * nz + jz;
      // Δω = (−R n) × (m j) / I
      const k = -R * M / INERTIA;
      s[6] += k * (ny * jz - nz * jy);
      s[7] += k * (nz * jx - nx * jz);
      s[8] += k * (nx * jy - ny * jx);
      return -vn;
    }

    /** Sphere vs. a round obstacle centred at c with radius ro. Returns closing speed or −1 if no contact. */
    _collidePoint(cx, cy, cz, ro, e, mu, bx, by, bz) {
      const s = this.s;
      let dx = s[0] - cx, dy = s[1] - cy, dz = s[2] - cz;
      const rr = R + ro, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr) return -1;
      let d = Math.sqrt(d2);
      if (d < 1e-9) { dx = 1; dy = 0; dz = 0; d = 1; }
      const nx = dx / d, ny = dy / d, nz = dz / d;
      s[0] = cx + nx * rr; s[1] = cy + ny * rr; s[2] = cz + nz * rr;
      return this._impulse(nx, ny, nz, e, mu, bx, by, bz);
    }

    /** Sphere vs. capsule (segment a→b, radius ro). */
    _collideSegment(ax, ay, az, bx, by, bz, ro, e, mu, vx, vy, vz) {
      const s = this.s;
      const ex = bx - ax, ey = by - ay, ez = bz - az;
      const l2 = ex * ex + ey * ey + ez * ez;
      let t = l2 > 0 ? ((s[0] - ax) * ex + (s[1] - ay) * ey + (s[2] - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return this._collidePoint(ax + ex * t, ay + ey * t, az + ez * t, ro, e, mu, vx, vy, vz);
    }

    _touch(what) {
      this.touched[what] = true;
      if (this.firstTouchT < 0) this.firstTouchT = this.t;
      this._curveFrozen = true;
    }

    _resolveCollisions() {
      const s = this.s;
      // ground
      if (s[2] < R) {
        s[2] = R;
        if (s[5] < 0) {
          const vin = this._impulse(0, 0, 1, this.surf.restitution, this.surf.friction, 0, 0, 0);
          if (!this.rolling) {
            this.bounces++;
            if (!this.firstBounce) this.firstBounce = { x: s[0], y: s[1], t: this.t };
            this._curveFrozen = true;
            if (vin > 0.8) this.events.push({ type: 'bounce', speed: vin });
            if (s[5] < REST_SPEED) { s[5] = 0; this.rolling = true; }
          } else {
            s[5] = 0;
          }
        }
      }
      if (!this.obstacles) return;

      // goal frame
      if (Math.abs(s[0]) < 0.4 && s[2] < BAR_Z + 0.4 && Math.abs(s[1]) < POST_Y + 0.4) {
        const pr = C.POST_RADIUS;
        let v = this._collideSegment(0, -POST_Y, 0, 0, -POST_Y, BAR_Z, pr, POST_E, POST_MU, 0, 0, 0);
        if (v < 0) v = this._collideSegment(0, POST_Y, 0, 0, POST_Y, BAR_Z, pr, POST_E, POST_MU, 0, 0, 0);
        if (v >= 0) { this._touch('post'); if (v > 0.5) this.events.push({ type: 'post', speed: v }); }
        const vb = this._collideSegment(0, -POST_Y, BAR_Z, 0, POST_Y, BAR_Z, pr, POST_E, POST_MU, 0, 0, 0);
        if (vb >= 0 && v < 0) { this._touch('bar'); if (vb > 0.5) this.events.push({ type: 'post', speed: vb }); }
      }

      // defensive wall: torso capsule + head sphere per player
      const wall = this.wall;
      for (let i = 0; i < wall.length; i++) {
        const p = wall[i];
        const dx = s[0] - p.x, dy = s[1] - p.y;
        if (dx * dx + dy * dy > 0.25 || s[2] > p.z + p.height + 0.2) continue;
        let v = this._collideSegment(p.x, p.y, p.z + 0.24, p.x, p.y, p.z + p.height - 0.42, 0.24, BODY_E, BODY_MU, 0, 0, p.vz);
        const vh = this._collidePoint(p.x, p.y, p.z + p.height - 0.13, 0.13, BODY_E, BODY_MU, 0, 0, p.vz);
        if (vh > v) v = vh;
        if (v >= 0) { this._touch('wall'); if (v > 0.5) this.events.push({ type: 'body', speed: v }); }
      }

      // goalkeeper: torso, head, arms, gloves
      const k = this.keeper;
      if (k && Math.abs(s[0] - k.x) < 0.6) {
        const sp = Math.hypot(s[3], s[4], s[5]);
        const vg = this._collidePoint(k.x, k.hy, k.hz, 0.16, KEEPER_E, KEEPER_MU, 0, k.vy, k.vz);
        let v = vg;
        const ty = k.sy - k.fy, tz = k.sz - k.fz, tl = Math.hypot(ty, tz) || 1;
        v = Math.max(v, this._collideSegment(k.x, k.sy, k.sz, k.x, k.hy, k.hz, 0.09, KEEPER_E, KEEPER_MU, 0, k.vy, k.vz));
        v = Math.max(v, this._collidePoint(k.x, k.sy + (ty / tl) * 0.2, k.sz + (tz / tl) * 0.2, 0.12, KEEPER_E, KEEPER_MU, 0, k.vy, k.vz));
        v = Math.max(v, this._collideSegment(k.x, k.fy, k.fz + 0.19, k.x, k.sy, k.sz, 0.19, KEEPER_E, KEEPER_MU, 0, k.vy * 0.5, k.vz * 0.5));
        if (v >= 0) {
          this._touch('keeper');
          const handSpeed = Math.hypot(k.vy, k.vz);
          if (vg >= 0 && !this.goal && sp < k.level.catchSpeed && handSpeed < 4.5) {
            this.caught = true; this.tCaught = this.t;
            this.events.push({ type: 'catch', speed: sp });
          } else if (v > 0.5) {
            this.events.push({ type: 'body', speed: v });
          }
        }
      }
    }

    _updateNetLatches() {
      const s = this.s, net = this.net;
      const D = C.NET_DEPTH;
      for (let i = 0; i < net.length; i++) {
        const p = net[i];
        let inside;
        if (p.axis === 0) { inside = Math.abs(s[1]) <= POST_Y && s[2] <= BAR_Z; p.u = s[1]; p.v = s[2]; }
        else if (p.axis === 1) { inside = s[0] >= -D && s[0] <= 0 && s[2] <= BAR_Z; p.u = s[0]; p.v = s[2]; }
        else { inside = s[0] >= -D && s[0] <= 0 && Math.abs(s[1]) <= POST_Y; p.u = s[0]; p.v = s[1]; }
        const d = (s[p.axis] - p.pos) * p.sign;
        if (!inside) { p.latch = 0; p.pen = 0; continue; }
        if (p.latch === 0 && Math.abs(d) < R) {
          p.latch = d >= 0 ? 1 : -1;       // remember which side the ball arrived from
          const vAxis = Math.abs(s[3 + p.axis]);
          if (vAxis > 2) this.events.push({ type: 'net', speed: vAxis });
        }
        if (p.latch !== 0) {
          const damp = Math.exp(-this.dt / 0.2);     // the mesh grips the ball and kills its spin
          s[6] *= damp; s[7] *= damp; s[8] *= damp;
          p.pen = R - p.latch * d;
          if (p.pen <= 0) { p.latch = 0; p.pen = 0; }
        }
      }
    }

    _updateActors(dt) {
      const t = this.t, g = this.g;
      const wall = this.wall;
      for (let i = 0; i < wall.length; i++) {
        const p = wall[i];
        const tau = t - p.jumpAt;
        if (tau > 0 && tau < (2 * p.jumpV) / g) { p.z = p.jumpV * tau - 0.5 * g * tau * tau; p.vz = p.jumpV - g * tau; }
        else { p.z = 0; p.vz = 0; }
      }

      const k = this.keeper;
      if (!k) return;
      if (k.state === 'ready' && t >= k.tReact) {
        const pred = this._predictPlane(k.x + 0.25);
        if (pred && Math.abs(pred.y) < C.GOAL_HALF_WIDTH + 0.9 && pred.z < C.GOAL_HEIGHT + 0.7) {
          k.truthY = pred.y; k.truthZ = pred.z; k.tArrive = pred.t; k.tDecide = t;
          k.state = 'moving';
        } else {
          k.state = 'watching';            // read as off target — leaves it
        }
      }
      k.vy = 0; k.vz = 0;
      if (k.state === 'moving') {
        // the read of the shot sharpens as the ball gets closer
        const frac = clamp((k.tArrive - t) / Math.max(1e-3, k.tArrive - k.tDecide), 0, 1);
        const ty = clamp(k.truthY + k.errY * frac, -3.85, 3.85);
        const tz = clamp(k.truthZ + k.errZ * frac, 0.2, 2.6);
        const dy = ty - k.hy, dz = tz - k.hz, dist = Math.hypot(dy, dz);
        k.speed = Math.min(k.level.vmax, k.speed + k.level.acc * dt);
        const stepLen = k.speed * dt;
        if (dist <= stepLen || dist < 1e-9) {
          k.vy = dy / dt; k.vz = dz / dt; k.hy = ty; k.hz = tz;
        } else {
          k.vy = (dy / dist) * k.speed; k.vz = (dz / dist) * k.speed;
          k.hy += k.vy * dt; k.hz += k.vz * dt;
        }
        if (t > k.tArrive + 0.2 || this.caught) k.state = 'landing';
      } else if (k.state === 'landing') {
        const dove = Math.abs(k.hy - k.y0) > 0.9;
        const floor = dove ? 0.28 : Math.min(k.hz, KEEPER_REST_Z);
        if (k.hz > floor) {
          k.fallV += g * dt;
          k.hz = Math.max(floor, k.hz - k.fallV * dt);
          k.vz = k.hz > floor ? -k.fallV : 0;
        }
      }
      keeperPose(k);
    }

    /** Where (and when) the ball will cross the plane x = xp, ignoring obstacles and knuckling. */
    _predictPlane(xp) {
      const sim = new Simulation(this.cfg, { dt: 0.004, obstacles: false, record: false, state: this.s });
      sim.useKnuckle = false;
      sim.t = this.t;
      const tEnd = this.t + 3;
      while (sim.t < tEnd && sim.s[0] > xp && !sim.atRest) sim.step();
      if (sim.s[0] > xp) return null;
      return { y: sim.s[1], z: sim.s[2], t: sim.t };
    }

    _record() {
      if (!this.recording) return;
      const s = this.s, r = this.rec;
      r.t.push(this.t); r.x.push(s[0]); r.y.push(s[1]); r.z.push(s[2]);
      r.v.push(Math.hypot(s[3], s[4], s[5]));
      r.spin.push(Math.hypot(s[6], s[7], s[8]) / TWO_PI);
    }

    step() {
      if (this.done) return;
      const dt = this.dt, s = this.s;
      const px = s[0], py = s[1], pz = s[2];

      if (this.obstacles) this._updateActors(dt);

      if (this.caught) {
        const k = this.keeper;
        s[0] = k.x + 0.2; s[1] = k.hy; s[2] = Math.max(R, k.hz);
        s[3] = 0; s[4] = k.vy; s[5] = k.vz; s[6] = 0; s[7] = 0; s[8] = 0;
      } else {
        if (this.rolling) this._rollStep(dt); else this._rk4(dt);
        this._resolveCollisions();
        if (this.rolling && s[5] > REST_SPEED) this.rolling = false;   // knocked back into the air
        if (this.obstacles) this._updateNetLatches();
      }

      // bookkeeping
      const ddx = s[0] - px, ddy = s[1] - py, ddz = s[2] - pz;
      this.pathLen += Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      const wx = s[6], wy = s[7], wz = s[8];
      const wmag = Math.sqrt(wx * wx + wy * wy + wz * wz);
      this.knTheta += wmag * dt;
      if (wmag > 1e-9) {              // integrate orientation: q ← Δq ⊗ q
        const ha = 0.5 * wmag * dt, sn = Math.sin(ha) / wmag, cw = Math.cos(ha);
        const ax = wx * sn, ay = wy * sn, az = wz * sn, q = this.q;
        const q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3];
        q[0] = cw * q0 - ax * q1 - ay * q2 - az * q3;
        q[1] = cw * q1 + ax * q0 + ay * q3 - az * q2;
        q[2] = cw * q2 - ax * q3 + ay * q0 + az * q1;
        q[3] = cw * q3 + ax * q2 - ay * q1 + az * q0;
        if ((this.steps & 255) === 0) {
          const n = Math.hypot(q[0], q[1], q[2], q[3]);
          q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
        }
      }
      if (s[2] > this.maxHeight) this.maxHeight = s[2];
      if (!this._curveFrozen) {
        const L = this.launch;
        this.curve = (s[0] - this.x0) * L.rx + (s[1] - this.y0) * L.ry;
      }

      // goal-line plane
      if (!this.crossing && px > 0 && s[0] <= 0) {
        const f = px / (px - s[0]);
        const cy = py + (s[1] - py) * f, cz = pz + (s[2] - pz) * f;
        this.crossing = { y: cy, z: cz, t: this.t + f * dt, speed: Math.hypot(s[3], s[4], s[5]) };
        this._curveFrozen = true;
        if (this.obstacles) {
          if (Math.abs(cy) < C.GOAL_HALF_WIDTH && cz < C.GOAL_HEIGHT) this.enteredMouth = true;
          else this.offTarget = Math.abs(cy) < C.GOAL_HALF_WIDTH ? 'over' : 'wide';
        }
      }
      // Law 10: the whole of the ball must cross the line
      if (this.enteredMouth && !this.goal && !this.caught && s[0] < -R) {
        this.goal = true; this.tGoal = this.t;
        this.events.push({ type: 'goal', speed: Math.hypot(s[3], s[4], s[5]) });
      }

      this.t += dt;
      this.steps++;
      if (this.steps % this._recEvery === 0) this._record();
      this._checkDone();
    }

    _checkDone() {
      const s = this.s, t = this.t;
      let done = this.atRest || t > 12 || s[0] < -25 || s[0] > 110 || Math.abs(s[1]) > 50;
      if (this.obstacles) {
        if (this.goal && t > this.tGoal + (this.fast ? 0 : 2.2)) done = true;
        if (this.caught && t > this.tCaught + (this.fast ? 0 : 1.2)) done = true;
        if (this.offTarget && t > this.crossing.t + (this.fast ? 0 : 1.8)) done = true;
        if (this.rolling && t > 0.5 && Math.hypot(s[3], s[4]) < (this.fast ? 2 : 0.3)) done = true;
        if (this.fast && this.firstTouchT >= 0 && t > this.firstTouchT + 2.5) done = true;
      }
      if (done) { this.done = true; this._record(); }
    }

    /** Run headless until the shot is over. */
    run(maxTime) {
      const tEnd = maxTime || 14;
      while (!this.done && this.t < tEnd) this.step();
      return this.result();
    }

    result() {
      let code, text;
      const tc = this.touched;
      if (this.goal) {
        code = 'goal';
        text = tc.keeper ? 'GOAL — keeper got a hand to it'
          : tc.wall ? 'GOAL — deflected off the wall'
          : tc.post || tc.bar ? 'GOAL — in off the woodwork' : 'GOAL';
      } else if (this.caught) { code = 'saved'; text = 'Caught by the keeper'; }
      else if (tc.keeper) { code = 'saved'; text = 'Saved'; }
      else if (tc.wall) { code = 'wall'; text = 'Blocked by the wall'; }
      else if (tc.bar) { code = 'woodwork'; text = 'Off the crossbar'; }
      else if (tc.post) { code = 'woodwork'; text = 'Off the post'; }
      else if (this.offTarget === 'over') { code = 'over'; text = 'Over the bar'; }
      else if (this.offTarget === 'wide') { code = 'wide'; text = 'Wide'; }
      else { code = 'short'; text = 'Did not reach the goal'; }
      return {
        code, text,
        crossing: this.crossing,
        maxHeight: this.maxHeight,
        curve: this.curve,
        bounces: this.bounces,
        time: this.t,
      };
    }

    /** Instantaneous aerodynamic quantities, for telemetry. */
    aero() {
      const s = this.s;
      const rx = s[3] - this.windX, ry = s[4] - this.windY, rz = s[5];
      const sp = Math.hypot(rx, ry, rz);
      const out = { speed: Math.hypot(s[3], s[4], s[5]), airspeed: sp, Re: 0, S: 0, Cd: 0, Cl: 0, drag: 0, magnus: 0,
        spin: Math.hypot(s[6], s[7], s[8]) / TWO_PI };
      if (sp < 1e-5) return out;
      const cx = s[7] * rz - s[8] * ry, cy = s[8] * rx - s[6] * rz, cz = s[6] * ry - s[7] * rx;
      out.S = R * Math.hypot(cx, cy, cz) / (sp * sp);
      out.Re = this.rho * sp * 2 * R / this.mu;
      const qA = 0.5 * this.rho * AREA * sp * sp;
      if (this.useDrag) { out.Cd = dragCoefficient(out.Re, out.S); out.drag = qA * out.Cd; }
      if (this.useMagnus) { out.Cl = liftCoefficient(out.S); out.magnus = qA * out.Cl; }
      return out;
    }
  }

  // ───────────────────────────── analysis tools ─────────────────────────────
  /**
   * Free-flight path with no goal, wall or keeper — the aim preview and the solver use this.
   * Returns sampled points up to the goal-line plane (or until the ball stops).
   */
  function simulateFlight(cfg, opts) {
    opts = opts || {};
    const sim = new Simulation(cfg, { dt: opts.dt || 0.002, obstacles: false, record: false });
    if (opts.knuckle === false) sim.useKnuckle = false;
    if (opts.vacuum) { sim.useDrag = false; sim.useMagnus = false; sim.useKnuckle = false; }
    const every = Math.max(1, Math.round((opts.sample || 0.02) / sim.dt));
    const pts = [sim.s[0], sim.s[1], sim.s[2]];
    const tMax = opts.maxTime || 4;
    while (!sim.done && sim.t < tMax && !sim.crossing) {
      sim.step();
      if (sim.steps % every === 0) pts.push(sim.s[0], sim.s[1], sim.s[2]);
    }
    if (sim.crossing) pts.push(0, sim.crossing.y, sim.crossing.z);
    return { points: pts, crossing: sim.crossing, maxHeight: sim.maxHeight, time: sim.t, bounces: sim.bounces };
  }

  /**
   * Solve for the direction and elevation that put the ball through the point (targetY, targetZ)
   * on the goal-line plane, keeping speed and spin fixed. 2-D Newton iteration with a
   * finite-difference Jacobian.
   */
  function solveAim(cfg, targetY, targetZ) {
    const c = cloneConfig(cfg);
    const b = c.ball;
    // start by pointing straight at the target
    const d0 = Math.atan2(-b.y, -b.x), d1 = Math.atan2(targetY - b.y, -b.x);
    let dd = d1 - d0;
    while (dd > Math.PI) dd -= TWO_PI;
    while (dd < -Math.PI) dd += TWO_PI;
    let az = clamp(-dd / DEG, -45, 45);
    let el = clamp(c.kick.elevation, 4, 35);
    // a crossing only counts if the ball got there on the full (unless a ground-level target is wanted)
    const allowBounce = targetZ < 0.35;
    const shoot = (a, e) => {
      c.kick.azimuth = a; c.kick.elevation = e;
      const f = simulateFlight(c, { knuckle: false, dt: 0.002 });
      return f.crossing && (allowBounce || f.bounces === 0) ? f.crossing : null;
    };
    let miss = Infinity, ok = false;
    for (let it = 0; it < 40; it++) {
      const p = shoot(az, el);
      if (!p) { el = Math.min(45, el + 2.5); continue; }
      const ey = p.y - targetY, ez = p.z - targetZ;
      miss = Math.hypot(ey, ez);
      if (miss < 0.01) { ok = true; break; }
      const h = 0.15;
      const pa = shoot(az + h, el), pe = shoot(az, el + h);
      if (!pa || !pe) { el = Math.min(45, el + 1); continue; }
      const a11 = (pa.y - p.y) / h, a12 = (pe.y - p.y) / h;
      const a21 = (pa.z - p.z) / h, a22 = (pe.z - p.z) / h;
      const det = a11 * a22 - a12 * a21;
      if (Math.abs(det) < 1e-9) break;
      const dAz = clamp(-(a22 * ey - a12 * ez) / det, -6, 6);
      const dEl = clamp(-(-a21 * ey + a11 * ez) / det, -6, 6);
      az = clamp(az + dAz, -60, 60);
      el = clamp(el + dEl, 0, 50);
    }
    return { azimuth: az, elevation: el, converged: ok, miss };
  }

  /** Perturb a kick with execution scatter (in place). */
  function applyNoise(kick, sigma, rng) {
    if (!sigma) return kick;
    kick.speed *= 1 + gaussian(rng) * sigma.speed;
    kick.azimuth += gaussian(rng) * sigma.angle;
    kick.elevation = Math.max(0, kick.elevation + gaussian(rng) * sigma.angle);
    kick.sideSpin += gaussian(rng) * sigma.spin;
    kick.topSpin += gaussian(rng) * sigma.spin;
    return kick;
  }

  /** Repeat the kick n times with execution scatter and tally the outcomes. */
  function monteCarlo(cfg, n, sigma, seed) {
    const rng = mulberry32(seed || 7);
    const counts = { goal: 0, saved: 0, wall: 0, woodwork: 0, over: 0, wide: 0, short: 0 };
    const points = [];
    for (let i = 0; i < n; i++) {
      const c = cloneConfig(cfg);
      applyNoise(c.kick, sigma, rng);
      c.seed = (rng() * 1e9) | 0;
      const sim = new Simulation(c, { dt: 0.002, record: false, fast: true });
      const res = sim.run(9);
      counts[res.code]++;
      if (res.crossing) points.push({ y: res.crossing.y, z: res.crossing.z, code: res.code });
    }
    return { n, counts, points };
  }

  return {
    C, SURFACES, KEEPER_LEVELS, NOISE_LEVELS,
    BALL_INERTIA: INERTIA, BALL_AREA: AREA, POST_Y, BAR_Z,
    Simulation, atmosphere, dragCoefficient, liftCoefficient,
    defaultConfig, cloneConfig, clampBallPosition, launchState,
    simulateFlight, solveAim, monteCarlo, applyNoise,
    mulberry32, gaussian, clamp,
  };
});
