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

  // Goalkeeper. react: decision delay after the kick (s). push: ground-contact time of the take-off (s).
  // vDive / vUp: largest horizontal / vertical take-off speed of the centre of mass (m/s); elite keepers reach
  // roughly 4–5 m/s laterally in a power dive. spin: how fast the body can rotate toward the dive (rad/s).
  // err: 1σ misread of the crossing point (m). catchSpeed: fastest ball (relative to the gloves) that is held.
  const KEEPER_LEVELS = {
    amateur: { label: 'Amateur',      react: 0.34, push: 0.21, vDive: 3.7, vUp: 2.5, spin: 5.5, arm: 11, err: 0.55, catchSpeed: 14, read: 0.2 },
    pro:     { label: 'Professional', react: 0.27, push: 0.18, vDive: 4.3, vUp: 2.9, spin: 6.5, arm: 13, err: 0.30, catchSpeed: 19, read: 0.4 },
    world:   { label: 'World class',  react: 0.22, push: 0.16, vDive: 4.9, vUp: 3.3, spin: 7.5, arm: 15, err: 0.12, catchSpeed: 23, read: 0.55 },
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

  /** Default drag-crisis parameters (engine fit). A ball model (js/balls.js) may override them via cfg.aero. */
  // knuckle model per ball: knCl peak side-force coefficient, knSpin spin parameter where it dies out, knFreq how fast
  // the side force changes along the path, knTrans extra force while the flow is in the drag-crisis transition
  // (asymmetric, unstable boundary-layer separation — the Jabulani's notorious late swerve)
  const AERO_DEFAULT = Object.freeze({ cdSub: CD_SUB, cdSuper: CD_SUPER, reCrit: RE_CRIT, reWidth: RE_WIDTH,
    knCl: KNUCKLE_CL, knSpin: KNUCKLE_SPIN_LIMIT, knFreq: 1, knTrans: 0 });

  function dragCoefficient(Re, S, a) {
    a = a || AERO_DEFAULT;
    if (S > 1) S = 1;   // the spin correction is only meaningful for ordinary spin parameters
    return a.cdSuper + (a.cdSub - a.cdSuper) / (1 + Math.exp((Re - a.reCrit) / a.reWidth)) + CD_SPIN * S;
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

  /*
   * Goalkeeper model (2-D, in the plane x = k.x a little off the goal line).
   *
   * The keeper is a rigid body with a centre of mass C = (cy, cz), a body axis at angle `theta` from vertical
   * (+ = leaning toward +y) and arms at angle `phi`. During the take-off (`push`) the planted feet supply the
   * force that brings C up to the chosen launch velocity. After that the keeper is a projectile: C follows
   * gravity exactly and cannot change course in mid-air. Only the body rotation and the arms keep adjusting.
   * The flight ends when the body meets the ground. This replaces the earlier "hands slide to the target"
   * model, which let the hands hang at the target before a scripted fall.
   */
  const KP = {
    LEG_READY: 0.88,   // centre of mass to ankles in the ready crouch (m)
    LEG: 0.97,         // ... legs extended
    TORSO: 0.48,       // centre of mass to shoulders
    HEAD: 0.72,        // centre of mass to top of head
    ARM: 0.70,         // shoulder to centre of the gloves, fully extended
    ARM_REST: 0.42,    // ready position: elbows bent, gloves at waist height
    ANKLE: 0.07,       // ankle height above the ground when standing
    LYING: 0.21,       // centre-of-mass height when lying on the side
    FRICTION: 7.0,     // sliding deceleration on the grass after landing (m/s²)
    SHUFFLE: 2.2,      // lateral speed of a short shuffle without diving (m/s)
  };
  const KEEPER_REST_Z = KP.LEG_READY + KP.ANKLE;

  function makeKeeper(cfg, rng, hasWall) {
    const lv = KEEPER_LEVELS[cfg.keeper.level];
    if (!lv) return null;
    const sgn = cfg.ball.y >= 0 ? 1 : -1;
    let y0 = hasWall ? -sgn * 0.7 : 0;              // the wall covers the near post; keeper shades far side
    let x0 = 0.45;                                  // stands just off the goal line
    const pos = cfg.keeper.pos;                     // optional start position (recreations: e.g. a keeper off his line)
    if (pos) { if (pos.x !== undefined) x0 = pos.x; if (pos.y !== undefined) y0 = pos.y; }
    const k = {
      level: lv, x: x0, y0,
      cy: y0, cz: KEEPER_REST_Z, cvy: 0, cvz: 0,     // centre of mass and its velocity
      theta: 0, phi: Math.PI, armExt: KP.ARM_REST, leg: KP.LEG_READY,
      launchY: 0, launchZ: 0, tPushEnd: 0, tTakeoff: 0,
      hy: y0, hz: 0, vy: 0, vz: 0,                   // glove centre and its velocity (used for contact)
      fy: y0, fz: 0, sy: y0, sz: 0,                  // ankles and shoulders, derived each step
      state: 'ready',
      tReact: lv.react + (hasWall ? 0.05 : 0) + rng() * 0.04,
      errY: gaussian(rng) * lv.err, errZ: gaussian(rng) * lv.err * 0.6,
      truthY: 0, truthZ: 0, readY: 0, readZ: 0, tArrive: 0, tDecide: 0, tLand: -1,
    };
    // a wall hides the strike: the keeper picks the ball up only as it clears the wall, then needs his reaction time
    // (the RNG draw order above is unchanged, so seeds still reproduce)
    if (hasWall) {
      const d = Math.hypot(cfg.ball.x, cfg.ball.y), vh = cfg.kick.speed * Math.cos(cfg.kick.elevation * DEG);
      const tWall = Math.min(C.WALL_DISTANCE, d - 0.5) / Math.max(5, vh);
      k.tReact = Math.max(k.tReact, tWall + 0.1);
    }
    keeperPose(k);
    k.vy = 0; k.vz = 0;
    return k;
  }

  /** Lowest allowed centre-of-mass height for a body angle: neither the feet nor the head may go into the ground. */
  function keeperMinZ(k) {
    const c = Math.cos(k.theta);
    return Math.max(KP.LYING, k.leg * c + KP.ANKLE, -KP.HEAD * c + 0.1);
  }

  /** Derive ankles, shoulders and gloves from the body state. */
  function keeperPose(k) {
    const by = Math.sin(k.theta), bz = Math.cos(k.theta);
    k.fy = k.cy - k.leg * by; k.fz = k.cz - k.leg * bz;
    k.sy = k.cy + KP.TORSO * by; k.sz = k.cz + KP.TORSO * bz;
    k.hy = k.sy + k.armExt * Math.sin(k.phi); k.hz = k.sz + k.armExt * Math.cos(k.phi);
    if (k.hz < 0.09) {                              // gloves rest on the grass instead of going through it
      const dzs = k.sz - 0.09, ext = k.armExt;
      const hyOff = Math.sqrt(Math.max(0, ext * ext - dzs * dzs)) * (Math.sign(Math.sin(k.phi)) || 1);
      k.hy = k.sy + hyOff; k.hz = 0.09;
    }
  }

  /** Turn angle a toward b by at most step, the short way round. */
  function turnToward(a, b, step) {
    let d = b - a;
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    return a + clamp(d, -step, step);
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
      this.magnusScale = 1;                       // < 1 only in the keeper's own (imperfect) prediction of the flight
      this.useKnuckle = cfg.physics.knuckle;
      this.aeroP = Object.assign({}, AERO_DEFAULT, cfg.aero || {});   // ball model (drag crisis)

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
      this._F = new Float64Array(9);   // last-evaluated accelerations (m/s²): drag[0..2], Magnus[3..5], knuckle[6..8]
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
      const F = this._F; F.fill(0);

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
          const cd = dragCoefficient(Re, S, this.aeroP);
          ax -= q * cd * rx; ay -= q * cd * ry; az -= q * cd * rz;
          F[0] = -q * cd * rx; F[1] = -q * cd * ry; F[2] = -q * cd * rz;
          // skin friction slowly spins the ball down
          dw = -(this.rho * AREA * R * R * SPIN_DECAY * sp) / INERTIA;
        }
        if (this.useMagnus && cmag > 1e-9) {
          const k = q * liftCoefficient(S) * sp / cmag * this.magnusScale;    // ½ρA·Cl·v² along (ω × v)
          ax += k * cx; ay += k * cy; az += k * cz;
          F[3] = k * cx; F[4] = k * cy; F[5] = k * cz;
        }
        if (this.useKnuckle) {
          const wmag = Math.sqrt(wx * wx + wy * wy + wz * wz);
          const ap = this.aeroP;
          let kf = 1 - (R * wmag / sp) / ap.knSpin;
          const h = Math.sqrt(rx * rx + ry * ry);
          if (kf > 0 && h > 1e-6) {
            kf *= kf;
            const supercritical = 1 / (1 + Math.exp(-(Re - ap.reCrit) / ap.reWidth));
            const zt = (Re - ap.reCrit) / 5e4, trans = ap.knTrans * Math.exp(-zt * zt);
            const ck = ap.knCl * kf * Math.min(1, supercritical + trans * 0.5) * (1 + trans);
            // lateral basis ⟂ to the airflow: e1 = horizontal right, e2 = up-ish
            const e1x = ry / h, e1y = -rx / h;
            const e2x = e1y * rz / sp, e2y = -e1x * rz / sp, e2z = h / sp;
            const ph = this.knTheta * 4, pl = this.pathLen * ap.knFreq;
            const c1 = Math.sin(this.kp1 + ph + pl * this.kk1);
            const c2 = 0.6 * Math.sin(this.kp2 + 0.7 * ph + pl * this.kk2);
            const k = q * ck * sp;
            ax += k * (c1 * e1x + c2 * e2x);
            ay += k * (c1 * e1y + c2 * e2y);
            az += k * (c2 * e2z);
            F[6] = k * (c1 * e1x + c2 * e2x); F[7] = k * (c1 * e1y + c2 * e2y); F[8] = k * (c2 * e2z);
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
        const sp = Math.hypot(s[3], s[4] - k.vy, s[5] - k.vz);   // ball speed relative to the gloves
        const vg =this._collidePoint(k.x, k.hy, k.hz, 0.16, KEEPER_E, KEEPER_MU, 0, k.vy, k.vz);
        let v = vg;
        const ty = k.sy - k.fy, tz = k.sz - k.fz, tl = Math.hypot(ty, tz) || 1;
        v = Math.max(v, this._collideSegment(k.x, k.sy, k.sz, k.x, k.hy, k.hz, 0.09, KEEPER_E, KEEPER_MU, 0, k.vy, k.vz));
        v = Math.max(v, this._collidePoint(k.x, k.sy + (ty / tl) * 0.2, k.sz + (tz / tl) * 0.2, 0.12, KEEPER_E, KEEPER_MU, 0, k.vy, k.vz));
        v = Math.max(v, this._collideSegment(k.x, k.fy, k.fz + 0.19, k.x, k.sy, k.sz, 0.19, KEEPER_E, KEEPER_MU, 0, k.vy * 0.5, k.vz * 0.5));
        if (v >= 0) {
          this._touch('keeper');
          if (vg >= 0 && !this.goal && sp < k.level.catchSpeed) {
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
        // two reads of the flight: the truth, and what the keeper can actually anticipate at this moment — the line
        // and pace of the ball but only part of its bend and dip (level.read). He sees the rest of the curve only as
        // the ball bends, so a well-struck curler fools him, and he judges on target or not from his own read.
        const pred = this._predictPlane(k.x + 0.25);
        const seen = pred && this._predictPlane(k.x + 0.25, k.level.read);
        if (this.cfg.keeper.rooted) {
          k.state = 'watching';            // recreations of keepers documented as rooted to the spot: he only watches
        } else if (pred && seen && Math.abs(seen.y) < C.GOAL_HALF_WIDTH + 0.9 && seen.z < C.GOAL_HEIGHT + 0.7) {
          k.truthY = pred.y; k.truthZ = pred.z; k.tArrive = pred.t; k.tDecide = t;
          k.readY = seen.y; k.readZ = seen.z;
          k.state = 'moving';
        } else {
          k.state = 'watching';            // read as off target — leaves it
        }
      }
      if (k.state === 'moving') this._keeperDecide(t);
      this._keeperStep(t, dt);
    }

    /** Where the centre of mass must be so that the body, stretched toward (ty, tz), puts the gloves there. */
    _keeperGoal(ty, tz) {
      const k = this.keeper, reach = KP.TORSO + KP.ARM;
      const ux = ty - k.cy, uz = tz - k.cz, ul = Math.hypot(ux, uz) || 1;
      return { y: ty - reach * ux / ul, z: Math.max(KP.LYING, tz - reach * uz / ul) };
    }

    /**
     * At the moment of decision: a stand-and-reach save, or a dive. For a dive the keeper picks the flight time:
     * long enough to cover the distance at his top lateral speed, and, for high balls, close to the time that
     * minimises the take-off speed needed to rise Δz (T = √(2Δz/g)), so he is near the top of his jump when the
     * ball arrives instead of already falling. If that leaves spare time he holds his set position and takes off later.
     */
    _keeperDecide(t) {
      const k = this.keeper, lv = k.level, g = this.g;
      // at the moment of decision he has seen none of the bend yet: his own read plus his error
      const ty = clamp(k.readY + k.errY, -3.85, 3.85);
      const tz = clamp(k.readZ + k.errZ, 0.15, 2.7);
      if (Math.abs(ty - k.cy) < 0.75 && tz < 2.05) { k.state = 'reach'; return; }
      const goal = this._keeperGoal(ty, tz);
      const T = Math.max(0.1, k.tArrive - t - lv.push);           // longest possible flight
      const tLat = Math.abs(goal.y - k.cy) / lv.vDive;              // shortest flight that covers the distance
      const dz = goal.z - k.cz;
      const tUp = dz > 0 ? Math.sqrt(2 * dz / g) : 0;
      // to a high ball he times the jump so he is near the top of it when the ball arrives (a long flat flight to cover
      // the distance left him landing before the ball got there): the lateral flight is capped near his rise time
      const high = tz > 1.4, tRise = lv.vUp / g;
      const Tf = clamp(Math.max(high ? Math.min(tLat * 1.1, tRise * 1.3) : tLat * 1.1, tUp, 0.18), 0.1, T);
      k.tTakeoff = k.tArrive - lv.push - Tf;
      k.state = t >= k.tTakeoff ? this._keeperLaunch(t, ty, tz) : 'set';
    }

    /** Fix the launch velocity from the current read of the shot. Returns the new state. */
    _keeperLaunch(t, ty, tz) {
      const k = this.keeper, lv = k.level, g = this.g;
      const goal = this._keeperGoal(ty, tz);
      const T = Math.max(0.08, k.tArrive - t - lv.push);
      const Te = T + lv.push * 0.5;                                 // the push also moves the body (about half speed)
      k.launchY = clamp((goal.y - k.cy) / Te, -lv.vDive, lv.vDive);
      // a dive needs a hop, except to a low ball: then the keeper collapses sideways onto it, the centre of mass
      // dropping from the start (forcing a hop floated him flat above a ball going in underneath)
      k.launchZ = clamp((goal.z - k.cz + 0.5 * g * T * T) / Te, tz < 0.9 ? -1.0 : 0.4, lv.vUp);
      k.tPushEnd = t + lv.push;
      k.diveLean = this._keeperLean(ty, tz);                        // the body angle he commits to at take-off
      return 'push';
    }

    /** Advance the keeper's body by dt. */
    _keeperStep(t, dt) {
      const k = this.keeper, lv = k.level, g = this.g;
      const hy0 = k.hy, hz0 = k.hz;
      k.clock = t;                                    // read by the body animation (people.js)
      // the read of the shot sharpens as the ball gets closer; only the arms and body angle can use it in flight
      let ty = k.cy, tz = 1.0;
      if (k.state !== 'ready' && k.state !== 'watching') {
        const frac = clamp((k.tArrive - t) / Math.max(1e-3, k.tArrive - k.tDecide), 0, 1);
        // the bend he could not anticipate shows itself late (most of a curve happens in the last part of the flight)
        const shown = Math.pow(1 - frac, 1.6);
        ty = clamp(k.readY + (k.truthY - k.readY) * shown + k.errY * frac, -3.85, 3.85);
        tz = clamp(k.readZ + (k.truthZ - k.readZ) * shown + k.errZ * frac, 0.15, 2.7);
      }
      const holding = this.caught;
      const busy = k.state !== 'ready' && k.state !== 'watching';

      if (k.state === 'set') {
        // set position: a short shuffle toward the ball's side while waiting to take off
        k.cvy = clamp((ty - k.cy) * 2, -1.0, 1.0);
        k.cy += k.cvy * dt;
        k.theta = turnToward(k.theta, 0, lv.spin * dt);
        if (t + dt >= k.tTakeoff) k.state = this._keeperLaunch(t, ty, tz);
      } else if (k.state === 'reach') {
        // feet stay down: shuffle sideways, crouch for low balls, lean a little toward the ball
        const wantY = ty - clamp(ty - k.cy, -0.25, 0.25);
        k.cvy = clamp((wantY - k.cy) / 0.08, -KP.SHUFFLE, KP.SHUFFLE);
        k.cy += k.cvy * dt;
        const wantZ = clamp(tz + 0.15, 0.6, KEEPER_REST_Z + 0.05);
        const dz = clamp(wantZ - k.cz, -2.5 * dt, 2.5 * dt);
        k.cz += dz; k.cvz = dz / dt;
        k.leg = k.cz - KP.ANKLE;
        k.theta = turnToward(k.theta, clamp(Math.atan2(ty - k.cy, 1.6), -0.35, 0.35), lv.spin * dt);
      } else if (k.state === 'push') {
        // feet planted: the ground supplies whatever force brings C to the launch velocity
        const left = Math.max(dt, k.tPushEnd - t);
        k.cvy += (k.launchY - k.cvy) * dt / left;
        k.cvz += (k.launchZ - k.cvz) * dt / left;
        k.cy += k.cvy * dt; k.cz += k.cvz * dt;
        k.leg = Math.min(KP.LEG, k.leg + 0.6 * dt);
        k.theta = turnToward(k.theta, this._keeperLean(ty, tz) * 0.5, lv.spin * dt);
        if (t + dt >= k.tPushEnd) k.state = 'air';
      } else if (k.state === 'air') {
        // projectile: gravity is the only force on the centre of mass
        k.cvz -= g * dt;
        k.cy += k.cvy * dt; k.cz += k.cvz * dt;
        k.leg = Math.min(KP.LEG, k.leg + 0.6 * dt);
        // the body angle is committed at take-off: in the air it can only adjust a little toward a late read (a body
        // cannot turn itself round in flight — before, a late read of the curl swung him upright mid-air); the
        // arms do the rest
        if (t < k.tArrive + 0.15) {
          const d0 = k.diveLean !== undefined ? k.diveLean : k.theta;
          k.theta = turnToward(k.theta, clamp(this._keeperLean(ty, tz), d0 - 0.3, d0 + 0.3), lv.spin * dt);
        }
        // once the ball has crossed, the body keeps its dive and tips toward its side as it falls (tracking the
        // crossing point, now above him, swung him upright in mid-air and dropped him feet-first)
        else if (Math.abs(k.theta) > 0.3) k.theta = turnToward(k.theta, Math.sign(k.theta) * Math.max(Math.abs(k.theta), 1.3), 1.5 * dt);
      } else if (k.state === 'down') {
        // lying on the grass: slide to a stop, settle flat
        const sp = Math.abs(k.cvy), dec = KP.FRICTION * dt;
        k.cvy = sp <= dec ? 0 : k.cvy - Math.sign(k.cvy) * dec;
        k.cy += k.cvy * dt; k.cvz = 0;
        const side = Math.sign(k.theta) || 1;
        k.theta = turnToward(k.theta, side * Math.PI / 2, 2.5 * dt);
        // a keeper does not lie there: once he has stopped sliding and the ball is gone (or safe in his hands),
        // he gets back to his feet
        // (with the ball caught he stays down, clutching it)
        if (t - k.tLand > 0.6 && k.cvy === 0 && t > k.tArrive + 0.4 && !this.caught) { k.state = 'getup'; k.tGetup = t; }
      } else if (k.state === 'getup') {
        // roll up onto the knees and stand: the body turns upright and the legs come back under him
        // (the ground constraint below lifts the centre of mass as the body rotates)
        k.cvy = 0; k.cvz = 0;
        k.leg += (KP.LEG_READY - k.leg) * Math.min(1, 3 * dt);
        k.theta = turnToward(k.theta, 0, 2.2 * dt);
        if (Math.abs(k.theta) < 0.02) k.state = 'stand';
      } else if (k.state === 'stand') {
        const dec = 6 * dt;
        k.cvy = Math.abs(k.cvy) <= dec ? 0 : k.cvy - Math.sign(k.cvy) * dec;
        k.cy += k.cvy * dt; k.cvz = 0;
        k.theta = turnToward(k.theta, 0, 3 * dt);
      }

      // the ground: neither the feet nor the head may go below it
      const zMin = keeperMinZ(k);
      if (k.cz < zMin) {
        k.cz = zMin;
        if (k.state === 'air' && k.cvz < 0) {
          k.cvz = 0; k.tLand = t;
          k.state = Math.abs(k.theta) > 0.5 || Math.abs(k.cvy) > 1.5 ? 'down' : 'stand';
        }
      }

      // arms: point at the expected crossing (or hold the ball once it is caught). In the set position the arms
      // stay low and wide — a keeper does not reach before he has taken off.
      const after = (k.state === 'getup' || k.state === 'stand' || k.state === 'down') && t > k.tArrive + 0.2;
      if (after && !holding) {
        // the moment has passed: lying, the arms settle along the grass beyond his head; getting up or standing they
        // come down to his sides (instead of reaching for a ball that has gone)
        k.phi = turnToward(k.phi, k.state === 'down' ? k.theta : Math.PI, 4 * dt);
        k.armExt += clamp((k.state === 'down' ? KP.ARM * 0.85 : KP.ARM_REST) - k.armExt, -1.5 * dt, 1.5 * dt);
      } else if (busy && !holding && k.state !== 'set') {
        const sy = k.cy + KP.TORSO * Math.sin(k.theta), sz = k.cz + KP.TORSO * Math.cos(k.theta);
        const wantPhi = Math.atan2(ty - sy, tz - sz);
        k.phi = turnToward(k.phi, wantPhi, lv.arm * dt);
        const wantExt = k.state === 'reach' ? clamp(Math.hypot(ty - sy, tz - sz), 0.3, KP.ARM) : KP.ARM;
        k.armExt += clamp(wantExt - k.armExt, -3 * dt, 3 * dt);
      }
      keeperPose(k);
      k.vy = (k.hy - hy0) / dt; k.vz = (k.hz - hz0) / dt;
    }

    /** Body angle that points the head and arms at the target. */
    _keeperLean(ty, tz) {
      const k = this.keeper;
      return clamp(Math.atan2(ty - k.cy, tz - k.cz), -1.75, 1.75);
    }

    /** Where (and when) the ball will cross the plane x = xp, ignoring obstacles and knuckling. */
    _predictPlane(xp, magnusScale = 1) {
      const sim = new Simulation(this.cfg, { dt: 0.004, obstacles: false, record: false, state: this.s });
      sim.useKnuckle = false;
      sim.magnusScale = magnusScale;
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

    /**
     * Forces on the ball right now, in newtons, from the SAME derivative the integrator uses (no second model).
     * total = gravity + drag + magnus + knuckle + contact, where `contact` is the net-membrane force (0 in free flight).
     * Ground/post/body impacts are impulses, not forces, so they are not included.
     */
    forces() {
      const o = this._k1, F = this._F, m = M;
      this._deriv(this.s, o);
      const v = (i) => [m * F[i], m * F[i + 1], m * F[i + 2]];
      const g = [0, 0, -m * this.g], d = v(0), mg = v(3), kn = v(6);
      const total = [m * o[3], m * o[4], m * o[5]];
      const contact = [0, 1, 2].map((i) => total[i] - g[i] - d[i] - mg[i] - kn[i]);
      return { gravity: g, drag: d, magnus: mg, knuckle: kn, contact, total };
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
      if (this.useDrag) { out.Cd = dragCoefficient(out.Re, out.S, this.aeroP); out.drag = qA * out.Cd; }
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

  /**
   * Boot–ball impact (optional "strike from the boot" mode). A rigid-body collision with restitution e between the
   * foot (effective mass Mf moving at footSpeed) and the ball, hit at a perpendicular offset d from its centre
   * (dx: + = right of centre as the kicker sees it → curls left; dy: + = above centre → topspin).
   *   effective ball mass at the contact point: m* = m / (1 + m d² / I)
   *   impulse J = (1 + e) v_foot / (1/Mf + 1/m*);  ball speed v = J/m;  spin ω = J d / I
   * An off-centre hit trades speed for spin, which is the trade-off players feel. This is a point-impulse model:
   * it ignores the ~10 ms of deformation and the foot's rotation, so treat the spin as an upper estimate.
   */
  function strikeFromBoot(footSpeed, dx, dy, opts) {
    opts = opts || {};
    const Mf = opts.footMass || 1.6, e = opts.restitution !== undefined ? opts.restitution : 0.5;
    const d = Math.hypot(dx, dy);
    const mStar = M / (1 + (M * d * d) / INERTIA);
    const J = ((1 + e) * footSpeed) / (1 / Mf + 1 / mStar);
    const v = J / M, w = (J * d) / INERTIA;
    const ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;
    return { speed: v, sideSpin: -(w * ux) / TWO_PI, topSpin: (w * uy) / TWO_PI, ratio: v / footSpeed, offset: d };
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
    C, SURFACES, KEEPER_LEVELS, NOISE_LEVELS, AERO_DEFAULT,
    BALL_INERTIA: INERTIA, BALL_AREA: AREA, POST_Y, BAR_Z,
    Simulation, atmosphere, dragCoefficient, liftCoefficient,
    defaultConfig, cloneConfig, clampBallPosition, launchState,
    simulateFlight, solveAim, monteCarlo, applyNoise, strikeFromBoot,
    mulberry32, gaussian, clamp,
  };
});
