/* Free Kick Simulator — application: controls, cameras, HUD, charts, game loop */
(function () {
  'use strict';
  const C = FK.C, R = C.BALL_RADIUS, DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);
  const clamp = FK.clamp;

  // chart ink (dark surface) — see css/style.css
  const INK = { text: '#f0efec', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19',
    series: '#3987e5', good: '#0ca30c' };
  /** Chart colours follow the interface theme (paper or dark), read from the CSS custom properties. */
  function refreshInk() {
    const cs = getComputedStyle(document.body), v = (n) => cs.getPropertyValue(n).trim();
    Object.assign(INK, { text: v('--text'), text2: v('--text-2'), muted: v('--muted'), grid: v('--grid'), axis: v('--axis'),
      surface: v('--surface-solid'), good: v('--good') });
  }
  /** The illustrated 3-D style pairs with the paper interface; the realistic stadium with the dark one. */
  function applyTheme() {
    document.body.classList.toggle('paper', ui.style === 'ink');
    document.querySelectorAll('#looks button').forEach((b) => b.classList.toggle('on', b.dataset.look === ui.style));
    refreshInk();
    if (typeof drawChart === 'function') { drawChart(); drawFace(); drawPad(); }
  }

  // ───────────── state ─────────────
  const cfg = FK.defaultConfig();
  cfg.seed = (Math.random() * 1e9) | 0;
  const ui = { guide: 'full', noise: 'off', vacuum: false, trails: true, cam: 'kicker', speed: 1, paused: false, taker: 'ronaldo', light: 'dusk', style: 'real', celebrate: true };   // the stadium by default
  try { if (localStorage.getItem('fk.celebrate') === '0') ui.celebrate = false; } catch (e) { /* storage blocked: keep the default */ }
  let runT = -10;            // kicker's clock relative to the strike (s); the ball is struck at runT = 0
  const noiseRng = FK.mulberry32((Math.random() * 1e9) | 0);

  let sim = null;            // staging simulation while aiming, live simulation during a kick
  let mode = 'aim';          // 'aim' | 'live' | 'done'
  let isReplay = false, announced = false, acc = 0;
  let lastShot = null, lastIntended = null, lastRec = null;
  let preview = null, vacuumPath = null, previewDirty = true;
  let freezeAt = Infinity;
  const history = [];        // {n, res, cfg (intended), speed, spin, dist}
  const trails = [];         // Float32Array paths of earlier kicks
  const facePoints = [];     // {y, z, code, mc}
  const score = { goals: 0, shots: 0 };

  let renderer = null;
  try { renderer = new FKRender.Renderer($('view')); }
  catch (e) { toast(e.message + ' The 3D view needs a browser with WebGL2.', 1e9); }

  // ───────────── helpers ─────────────
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    if (window.FKSound) FKSound.ui('toast');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  window.addEventListener('error', (e) => {
    document.documentElement.dataset.error = e.message;
    toast('Something went wrong: ' + e.message, 8000);
  });

  const sideOf = (v, pos, neg, zero) => (Math.abs(v) < 0.05 ? zero : v > 0 ? pos : neg);
  const fmt = {
    speed: (v) => `${(v * 3.6).toFixed(0)} km/h`,
    az: (v) => sideOf(v, `${v.toFixed(1)}° right`, `${(-v).toFixed(1)}° left`, 'at goal centre'),
    el: (v) => `${v.toFixed(1)}°`,
    side: (v) => sideOf(v, `${v.toFixed(1)} rev/s right`, `${(-v).toFixed(1)} rev/s left`, 'none'),
    top: (v) => sideOf(v, `${v.toFixed(1)} rev/s top`, `${(-v).toFixed(1)} rev/s back`, 'none'),
  };
  const WIND_NAMES = ['the goal', 'goal and right', 'the right', 'right and back', 'the halfway line', 'left and back', 'the left', 'goal and left'];

  function ballDistance() { return Math.hypot(cfg.ball.x, cfg.ball.y); }
  function nearSign() { return cfg.ball.y >= 0 ? 1 : -1; }

  // ───────────── simulation lifecycle ─────────────
  let goalAt = null, doneClock = 0, celebShown = false;      // goalAt: simulation time of the goal (celebration)
  function setupAim() {
    if (mode !== 'aim') cfg.seed = (Math.random() * 1e9) | 0;   // fresh wall / keeper / knuckle draw for the next kick
    mode = 'aim'; isReplay = false; announced = false; acc = 0; goalAt = null; celebShown = false;
    sim = new FK.Simulation(cfg);
    previewDirty = true;
    $('banner').hidden = true; $('badge').hidden = true;
    setKickLabel('Kick');
    refreshStatic();
  }

  function configChanged() {
    if (mode !== 'aim') { setupAim(); return; }
    sim = new FK.Simulation(cfg);
    previewDirty = true;
    refreshStatic();
  }

  function updatePreview() {
    if (!previewDirty) return;
    previewDirty = false;
    preview = FK.simulateFlight(cfg, { knuckle: false, sample: 0.02 });
    vacuumPath = ui.vacuum ? FK.simulateFlight(cfg, { vacuum: true, sample: 0.02 }) : null;
    drawMap(); drawFace();
  }

  function startShot(shotCfg, replay) {
    sim = new FK.Simulation(shotCfg);
    mode = 'live'; isReplay = replay; announced = false; acc = 0; goalAt = null; celebShown = false;
    ui.paused = false; syncPause();
    $('banner').hidden = true;
    $('badge').hidden = !replay; $('badge').textContent = 'REPLAY · SLOW MOTION';
    setKickLabel('Next kick');
    FKSound.play('kick', shotCfg.kick.speed);
  }

  let pendingShot = null;
  /** The taker runs up first; the simulation starts at the instant the boot meets the ball. */
  function beginRunup(shot, replay, from) {
    sim = new FK.Simulation(shot);         // staged: same seed, so the wall and keeper match the live kick
    pendingShot = shot;
    mode = 'runup'; isReplay = replay; announced = false; acc = 0; goalAt = null; celebShown = false;
    runT = from; runFrom = from;
    ui.paused = false; syncPause();
    $('banner').hidden = true;
    $('badge').hidden = !replay; $('badge').textContent = 'REPLAY · SLOW MOTION';
    setKickLabel('Next kick');
  }
  // ── dock buttons: the kick button's label, and play/pause ──
  let runFrom = -1;
  function setKickLabel(text) { const l = $('btnKick').querySelector('.lbl'); if (l) l.textContent = text; }
  function syncPause() {
    const b = $('btnPause'); b.classList.toggle('paused', ui.paused);
    b.dataset.tip = ui.paused ? 'Resume' : 'Pause'; b.setAttribute('aria-label', ui.paused ? 'Resume' : 'Pause');
  }

  function kick(skipRunup) {
    if (mode === 'runup') return;
    if (mode !== 'aim') { setupAim(); return; }
    quiet = false;
    const shot = FK.cloneConfig(cfg);
    FK.applyNoise(shot.kick, FK.NOISE_LEVELS[ui.noise], noiseRng);
    lastShot = shot; lastIntended = FK.cloneConfig(cfg);
    $('btnReplay').disabled = false;
    if (skipRunup || !renderer) startShot(shot, false);
    else { beginRunup(shot, false, -FKPeople.runTime(taker()) - 0.4); FKSound.play('whistle'); }   // the referee blows; 0.4 s to settle out of the idle sway
  }

  function replay() {
    if (!lastShot) return;
    beginRunup(lastShot, true, -0.7);
  }

  function announce() {
    announced = true;
    const res = sim.result();
    const b = $('banner');
    const k = sim.cfg.kick;
    const bits = [`${(k.speed * 3.6).toFixed(0)} km/h off the boot`];
    if (res.crossing) bits.push(`${(res.crossing.speed * 3.6).toFixed(0)} km/h at the line after ${res.crossing.t.toFixed(2)} s`);
    b.innerHTML = '';
    const strong = document.createElement('b'); strong.textContent = res.text;
    const small = document.createElement('small'); small.textContent = bits.join(' · ');
    b.append(strong, small);
    b.className = res.code === 'goal' ? 'goal' : '';
    b.hidden = false;
    if (isReplay || quiet) return;        // replays and story/lab kicks are not scored
    FKSound.play(res.code === 'goal' ? 'goal' : 'miss');
    score.shots++; if (res.code === 'goal') score.goals++;
    $('scGoals').textContent = score.goals; $('scShots').textContent = score.shots;
    $('scRate').textContent = Math.round(100 * score.goals / score.shots) + '%';
    if (res.crossing) facePoints.push({ y: res.crossing.y, z: res.crossing.z, code: res.code, mc: false });
    history.unshift({ n: score.shots, res, cfg: lastIntended, speed: k.speed, spin: Math.hypot(k.sideSpin, k.topSpin), dist: ballDistance() });
    if (history.length > 40) history.pop();
    renderLog(); drawFace(); renderSummary(res);
  }

  function finishShot() {
    if (!announced) announce();
    mode = 'done'; doneClock = animClock;
    lastRec = sim.rec;
    if (!isReplay) {
      const r = sim.rec, n = r.x.length, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = r.x[i]; a[i * 3 + 1] = r.y[i]; a[i * 3 + 2] = r.z[i]; }
      trails.unshift(a); if (trails.length > 5) trails.pop();
      syncClear();
    }
    drawMap();
  }

  // ───────────── controls ─────────────
  function bindRange(id, outId, get, set, format) {
    const el = $(id), out = $(outId);
    const show = () => { el.value = get(); out.textContent = format(get()); };
    el.addEventListener('input', () => { set(parseFloat(el.value)); out.textContent = format(get()); configChanged(); });
    el.addEventListener('pointerup', () => el.blur());
    show();
    return show;
  }
  const syncers = [
    bindRange('iSpeed', 'oSpeed', () => cfg.kick.speed, (v) => { cfg.kick.speed = v; }, fmt.speed),
    bindRange('iAz', 'oAz', () => cfg.kick.azimuth, (v) => { cfg.kick.azimuth = v; }, fmt.az),
    bindRange('iEl', 'oEl', () => cfg.kick.elevation, (v) => { cfg.kick.elevation = v; }, fmt.el),
    bindRange('iSide', 'oSide', () => cfg.kick.sideSpin, (v) => { cfg.kick.sideSpin = v; }, fmt.side),
    bindRange('iTop', 'oTop', () => cfg.kick.topSpin, (v) => { cfg.kick.topSpin = v; }, fmt.top),
    bindRange('iWall', 'oWall', () => cfg.wall.count, (v) => { cfg.wall.count = v; }, (v) => (v ? String(v) : 'no wall')),
    bindRange('iWind', 'oWind', () => cfg.env.windSpeed, (v) => { cfg.env.windSpeed = v; }, (v) => `${v.toFixed(1)} m/s (${(v * 3.6).toFixed(0)} km/h)`),
    bindRange('iWindDir', 'oWindDir', () => cfg.env.windDir, (v) => { cfg.env.windDir = v; }, (v) => WIND_NAMES[Math.round(v / 45) % 8]),
    bindRange('iTemp', 'oTemp', () => cfg.env.temperature, (v) => { cfg.env.temperature = v; }, (v) => `${v} °C`),
    bindRange('iAlt', 'oAlt', () => cfg.env.altitude, (v) => { cfg.env.altitude = v; }, (v) => `${v} m`),
    bindRange('iHum', 'oHum', () => cfg.env.humidity, (v) => { cfg.env.humidity = v; }, (v) => `${v}%`),
  ];
  function bindSelect(id, get, set) {
    const el = $(id);
    el.addEventListener('change', () => { set(el.value); el.blur(); configChanged(); });
    const show = () => { el.value = get(); };
    show(); return show;
  }
  function bindCheck(id, get, set) {
    const el = $(id);
    el.addEventListener('change', () => { set(el.checked); el.blur(); configChanged(); });
    const show = () => { el.checked = get(); };
    show(); return show;
  }
  syncers.push(
    bindSelect('iGuide', () => ui.guide, (v) => { ui.guide = v; }),
    bindSelect('iNoise', () => ui.noise, (v) => { ui.noise = v; }),
    bindSelect('iKeeper', () => cfg.keeper.level, (v) => { cfg.keeper.level = v; }),
    bindSelect('iSurface', () => cfg.env.surface, (v) => { cfg.env.surface = v; }),
    bindSelect('iLight', () => ui.light, (v) => { ui.light = v; }),
    bindSelect('iStyle', () => ui.style, (v) => { ui.style = v; applyTheme(); }),
    bindCheck('iJump', () => cfg.wall.jump, (v) => { cfg.wall.jump = v; }),
    bindCheck('iDrag', () => cfg.physics.drag, (v) => { cfg.physics.drag = v; }),
    bindCheck('iMagnus', () => cfg.physics.magnus, (v) => { cfg.physics.magnus = v; }),
    bindCheck('iKnuckle', () => cfg.physics.knuckle, (v) => { cfg.physics.knuckle = v; }),
    bindCheck('iVacuum', () => ui.vacuum, (v) => { ui.vacuum = v; }),
    bindCheck('iTrails', () => ui.trails, (v) => { ui.trails = v; if (!v) clearTrails(true); }),
    bindCheck('iCeleb', () => ui.celebrate, (v) => setCelebrate(v))
  );
  /** Goal celebrations on/off (remembered). Switching off also ends one that is under way. */
  function setCelebrate(v) {
    ui.celebrate = v;
    try { localStorage.setItem('fk.celebrate', v ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (!v) goalAt = null;
    const el = $('iCeleb'); if (el) el.checked = v;
  }
  function syncControls() { syncers.forEach((f) => f()); }

  /** Things that only change when the setup changes (not every frame). */
  function refreshStatic() {
    const b = cfg.ball, ang = Math.atan2(b.y, b.x) / DEG;
    $('posReadout').textContent = `${ballDistance().toFixed(1)} m from the goal · ${sideOf(ang, `${ang.toFixed(0)}° right of centre`, `${(-ang).toFixed(0)}° left of centre`, 'dead centre')}`;
    const atm = sim.atm;
    $('airReadout').textContent = `Air density ${atm.rho.toFixed(3)} kg/m³ (${Math.round(100 * atm.rho / 1.225)}% of standard sea-level air)`;
    drawPad();
  }

  // presets: speed and spin, then let the solver find the aim for a sensible target
  const PRESETS = {
    curler:  { speed: 26, side: 8, top: 1.5, ty: 3.15, tz: 2.0, note: 'Curled over the wall toward the near top corner' },
    dipper:  { speed: 29, side: 2, top: 6.5, ty: 2.7, tz: 1.9, note: 'Topspin: up over the wall, then it dips' },
    knuckle: { speed: 31, side: 0, top: 0.2, ty: -2.0, tz: 1.7, note: 'Almost no spin: the flight wobbles unpredictably' },
    outside: { speed: 30, side: -9, top: 0, ty: -3.1, tz: 1.7, note: 'Swerving away toward the far post' },
    driven:  { speed: 33, side: 0, top: -1, ty: -3.2, tz: 0.6, note: 'Hard and low to the far corner' },
  };
  function applyPreset(name) {
    const p = PRESETS[name], s = nearSign();
    Object.assign(cfg.kick, { speed: p.speed, sideSpin: s * p.side, topSpin: p.top, elevation: 14 });
    const aim = FK.solveAim(cfg, s * p.ty, p.tz);
    cfg.kick.azimuth = clamp(aim.azimuth, -35, 35); cfg.kick.elevation = clamp(aim.elevation, 0, 40);
    syncControls(); configChanged();
    toast(p.note);
  }
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    applyPreset(b.dataset.preset); b.blur();
  });

  // ───────────── free-kick takers ─────────────
  const taker = () => FKPeople.CHAR_BY_ID[ui.taker];
  function renderTakers() {
    const box = $('takers'); box.innerHTML = '';
    for (const ch of FKPeople.CHARACTERS) {
      if (ch.support) continue;                 // (team-mates in a recreation, not takers)
      const b = document.createElement('button');
      b.dataset.taker = ch.id; b.className = ch.id === ui.taker ? 'on' : '';
      const sw = document.createElement('i'); sw.className = 'kit';
      sw.style.background = ch.kit.pattern === 1
        ? `repeating-linear-gradient(90deg, ${rgb(ch.kit.shirt)} 0 4px, ${rgb(ch.kit.shirt2)} 4px 8px)` : rgb(ch.kit.shirt);
      b.append(sw, document.createTextNode(ch.short));
      b.title = `${ch.name}: ${ch.foot}-footed, ${ch.kick.label.toLowerCase()}`;
      box.append(b);
    }
    const ch = taker();
    $('takerNote').textContent = `${ch.foot === 'left' ? 'Left' : 'Right'} foot · signature: ${ch.kick.label}. ${ch.kick.note}. Speed and spin are typical values for this technique, not measurements of a particular goal.`;
  }
  const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
  function selectTaker(id, applySignature) {
    ui.taker = id; renderTakers();
    if (!applySignature) return;
    const ch = taker(), p = ch.kick;
    Object.assign(cfg.kick, { speed: p.speed, sideSpin: p.side, topSpin: p.top, elevation: 14 });
    const aim = FK.solveAim(cfg, p.ty, p.tz);
    cfg.kick.azimuth = clamp(aim.azimuth, -35, 35); cfg.kick.elevation = clamp(aim.elevation, 0, 40);
    syncControls(); configChanged();
    toast(`${ch.name}: ${p.label.toLowerCase()}`);
  }
  $('takers').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (mode !== 'aim') setupAim();
    API.clearMatch();
    selectTaker(b.dataset.taker, true); b.blur();
  });

  // strike pad
  const pad = $('pad');
  function drawPad() {
    const g = pad.getContext('2d'), w = pad.width, cx = w / 2, rr = 46, lim = 40;
    g.clearRect(0, 0, w, w);
    const grad = g.createRadialGradient(cx - 14, cx - 16, 4, cx, cx, rr);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#b9bcc0');
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cx, rr, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - rr, cx); g.lineTo(cx + rr, cx); g.moveTo(cx, cx - rr); g.lineTo(cx, cx + rr); g.stroke();
    g.beginPath(); g.arc(cx, cx, lim, 0, 7); g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]);
    const px = cx - (cfg.kick.sideSpin / 12) * lim, py = cx - (cfg.kick.topSpin / 10) * lim;
    g.fillStyle = '#d03b3b'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 7, 0, 7); g.fill(); g.stroke();
  }
  function padDrag(e) {
    const r = pad.getBoundingClientRect(), lim = 40 * (r.width / pad.width);
    let dx = (e.clientX - r.left - r.width / 2) / lim, dy = (e.clientY - r.top - r.height / 2) / lim;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    if (boot.on) { boot.dx = dx; boot.dy = dy; applyBoot(); return; }
    cfg.kick.sideSpin = Math.round(-dx * 12 * 10) / 10;
    cfg.kick.topSpin = Math.round(-dy * 10 * 10) / 10;
    syncControls(); configChanged();
  }

  // "strike from the boot": the pad marks the contact point (up to 3 cm off centre); FK.strikeFromBoot turns boot
  // speed and contact offset into launch speed and spin by an impulse calculation
  const boot = { on: false, speed: 22, dx: 0, dy: 0 };
  function applyBoot() {
    const s = FK.strikeFromBoot(boot.speed, boot.dx * 0.03, -boot.dy * 0.03);
    cfg.kick.speed = clamp(Math.round(s.speed * 4) / 4, 12, 38);
    cfg.kick.sideSpin = clamp(Math.round(s.sideSpin * 10) / 10, -12, 12);
    cfg.kick.topSpin = clamp(Math.round(s.topSpin * 10) / 10, -10, 10);
    $('bootOut').textContent = `Ball ${(s.speed * 3.6).toFixed(0)} km/h (${s.ratio.toFixed(2)}× the boot) · contact ${(s.offset * 100).toFixed(1)} cm off centre → ${Math.hypot(s.sideSpin, s.topSpin).toFixed(1)} rev/s`;
    syncControls(); configChanged();
  }
  $('iBoot').addEventListener('change', (e) => { boot.on = e.target.checked; $('bootRow').hidden = !boot.on; e.target.blur(); if (boot.on) applyBoot(); });
  $('iBootSpeed').addEventListener('input', (e) => { boot.speed = parseFloat(e.target.value); $('oBootSpeed').textContent = `${(boot.speed * 3.6).toFixed(0)} km/h`; applyBoot(); });
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); padDrag(e); });
  pad.addEventListener('pointermove', (e) => { if (e.buttons) padDrag(e); });
  pad.addEventListener('dblclick', () => { cfg.kick.sideSpin = 0; cfg.kick.topSpin = 0; syncControls(); configChanged(); });

  // ───────────── 2-D canvases ─────────────
  function prep(canvas) {
    if (!canvas._base) canvas._base = [canvas.width, canvas.height];
    const w = canvas.clientWidth || canvas._base[0], h = Math.round(w * canvas._base[1] / canvas._base[0]);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  // position map (goal at the top, as the kicker sees it)
  const map = $('map');
  const MAP = { yHalf: 36, x0: -3, x1: 47 };
  function mapXf(w, h) {
    const k = Math.min(w / (2 * MAP.yHalf), h / (MAP.x1 - MAP.x0));
    return { k, px: (x, y) => [w / 2 + y * k, (x - MAP.x0) * k] };
  }
  function drawMap() {
    const { g, w, h } = prep(map), { k, px } = mapXf(w, h);
    g.fillStyle = '#255c23'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1;
    const rect = (x0, y0, x1, y1) => { const a = px(x0, y0), b = px(x1, y1); g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); };
    rect(0, -34, 60, 34); rect(0, -C.PEN_AREA_HALF_WIDTH, C.PEN_AREA_DEPTH, C.PEN_AREA_HALF_WIDTH); rect(0, -9.16, 5.5, 9.16);
    const sp = px(11, 0);
    g.beginPath(); g.arc(sp[0], sp[1], 9.15 * k, Math.acos(5.5 / 9.15), Math.PI - Math.acos(5.5 / 9.15)); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sp[0], sp[1], 1.3, 0, 7); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#fff'; rect(-C.NET_DEPTH, -C.GOAL_HALF_WIDTH, 0, C.GOAL_HALF_WIDTH);

    const path = (pts, n, color, dash) => {
      if (!pts || n < 2) return;
      g.beginPath();
      for (let i = 0; i < n; i++) { const p = px(pts[i * 3], pts[i * 3 + 1]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
      g.strokeStyle = color; g.lineWidth = 1.5; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
    };
    if (mode === 'aim' && preview && ui.guide !== 'off') {
      const n = preview.points.length / 3;
      path(preview.points, ui.guide === 'short' ? Math.ceil(n / 3) : n, 'rgba(255,255,255,0.9)', [4, 3]);
    }
    if (mode !== 'aim' && sim.rec.x.length > 1) {
      const r = sim.rec; g.beginPath();
      for (let i = 0; i < r.x.length; i++) { const p = px(r.x[i], r.y[i]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
      g.strokeStyle = '#f2e94e'; g.lineWidth = 1.5; g.stroke();
    }
    for (const p of sim.wall) { const q = px(p.x, p.y); g.fillStyle = '#d6393b'; g.beginPath(); g.arc(q[0], q[1], 2.6, 0, 7); g.fill(); }
    if (sim.keeper) { const q = px(sim.keeper.x, sim.keeper.hy); g.fillStyle = '#f0c81e'; g.beginPath(); g.arc(q[0], q[1], 3, 0, 7); g.fill(); }
    const b = px(cfg.ball.x, cfg.ball.y);
    g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(b[0], b[1], 4.5, 0, 7); g.fill(); g.stroke();

    if (cfg.env.windSpeed > 0) {   // wind arrow, bottom-left
      const a = cfg.env.windDir * DEG, ox = 22, oy = h - 22;
      const dx = Math.sin(a), dy = -Math.cos(a);       // screen: +y world → right, −x world (toward goal) → up
      g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ox - dx * 11, oy - dy * 11); g.lineTo(ox + dx * 11, oy + dy * 11); g.stroke();
      g.beginPath(); g.moveTo(ox + dx * 14, oy + dy * 14); g.lineTo(ox + dx * 6 - dy * 5, oy + dy * 6 + dx * 5); g.lineTo(ox + dx * 6 + dy * 5, oy + dy * 6 - dx * 5); g.fill();
      g.font = '11px system-ui, sans-serif'; g.fillText(`wind ${cfg.env.windSpeed.toFixed(0)} m/s`, 40, h - 18);
    }
  }
  function mapDrag(e) {
    const r = map.getBoundingClientRect(), { k } = mapXf(r.width, r.height);
    const p = FK.clampBallPosition((e.clientY - r.top) / k + MAP.x0, (e.clientX - r.left - r.width / 2) / k);
    cfg.ball.x = Math.round(p.x * 10) / 10; cfg.ball.y = Math.round(p.y * 10) / 10;
    configChanged();
  }
  map.addEventListener('pointerdown', (e) => { map.setPointerCapture(e.pointerId); mapDrag(e); });
  map.addEventListener('pointermove', (e) => { if (e.buttons) mapDrag(e); });
  $('btnRandom').addEventListener('click', (e) => {
    const d = 18 + Math.random() * 14, a = (Math.random() * 2 - 1) * 42 * DEG;
    const p = FK.clampBallPosition(d * Math.cos(a), d * Math.sin(a));
    cfg.ball.x = Math.round(p.x * 10) / 10; cfg.ball.y = Math.round(p.y * 10) / 10;
    cfg.kick.azimuth = 0; syncControls(); configChanged(); e.target.blur();
  });
  $('btnCentral').addEventListener('click', (e) => { cfg.ball.x = 22; cfg.ball.y = 0; cfg.kick.azimuth = 0; syncControls(); configChanged(); e.target.blur(); });

  // flight profile chart
  const chart = $('chart');
  let chartData = null, chartHover = -1, chartGeom = null;
  function profileData() {
    const d = [], hgt = [], spd = [], tm = [];
    const x0 = cfg.ball.x, y0 = cfg.ball.y;
    if (mode === 'aim') {
      if (!preview) return null;
      const p = preview.points;
      for (let i = 0; i < p.length; i += 3) { d.push(Math.hypot(p[i] - x0, p[i + 1] - y0)); hgt.push(p[i + 2] - R); }
      return { d, h: hgt, predicted: true };
    }
    const r = sim.rec;
    for (let i = 0; i < r.x.length; i++) {
      if (r.x[i] < -C.NET_DEPTH - 1) break;
      d.push(Math.hypot(r.x[i] - sim.x0, r.y[i] - sim.y0)); hgt.push(r.z[i] - R); spd.push(r.v[i]); tm.push(r.t[i]);
    }
    return { d, h: hgt, v: spd, t: tm, predicted: false };
  }
  function drawChart() {
    const { g, w, h } = prep(chart);
    const data = chartData = profileData();
    const m = { l: 22, r: 8, t: 8, b: 18 };
    const goalD = ballDistance();
    const xMax = Math.max(goalD + 2.5, 12);
    let yTop = 3.2;
    if (data) for (const v of data.h) if (v * 1.12 > yTop) yTop = v * 1.12;
    const X = (v) => m.l + (v / xMax) * (w - m.l - m.r), Y = (v) => h - m.b - (v / yTop) * (h - m.t - m.b);
    chartGeom = { X, Y, xMax, m, w, h };
    g.font = '10px system-ui, sans-serif'; g.textBaseline = 'middle';
    const yStep = yTop > 12 ? 5 : yTop > 6 ? 2 : 1;
    for (let v = 0; v <= yTop; v += yStep) {
      g.strokeStyle = v === 0 ? INK.axis : INK.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(m.l, Math.round(Y(v)) + 0.5); g.lineTo(w - m.r, Math.round(Y(v)) + 0.5); g.stroke();
      g.fillStyle = INK.muted; g.textAlign = 'right'; g.fillText(String(v), m.l - 5, Y(v));
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const xStep = xMax > 32 ? 10 : 5;
    for (let v = 0; v <= xMax; v += xStep) g.fillText(v + (v === 0 ? ' m' : ''), X(v) + (v === 0 ? 4 : 0), h - m.b + 5);
    // reference marks: the wall and the goal
    g.strokeStyle = INK.muted; g.lineWidth = 2; g.fillStyle = INK.text2; g.textBaseline = 'bottom';
    if (sim.wall.length) {
      const wd = Math.hypot(sim.wall[0].x - cfg.ball.x, sim.wall[0].y - cfg.ball.y);
      g.beginPath(); g.moveTo(X(wd), Y(0)); g.lineTo(X(wd), Y(1.84)); g.stroke();
      g.fillText('wall', X(wd), Y(1.84) - 2);
    }
    g.beginPath(); g.moveTo(X(goalD), Y(0)); g.lineTo(X(goalD), Y(C.GOAL_HEIGHT)); g.stroke();
    g.fillText('bar', X(goalD), Y(C.GOAL_HEIGHT) - 2);
    if (!data || data.d.length < 2) return;
    g.strokeStyle = INK.series; g.lineWidth = 2; g.lineJoin = 'round';
    if (data.predicted) g.setLineDash([5, 4]);
    g.beginPath();
    for (let i = 0; i < data.d.length; i++) { if (i) g.lineTo(X(data.d[i]), Y(data.h[i])); else g.moveTo(X(data.d[i]), Y(data.h[i])); }
    g.stroke(); g.setLineDash([]);
    if (data.predicted) { g.fillStyle = INK.muted; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText('predicted', w - m.r, m.t - 4); }
    if (chartHover >= 0 && chartHover < data.d.length) {
      const hx = X(data.d[chartHover]), hy = Y(data.h[chartHover]);
      g.strokeStyle = INK.axis; g.lineWidth = 1; g.beginPath(); g.moveTo(hx + 0.5, m.t); g.lineTo(hx + 0.5, h - m.b); g.stroke();
      g.fillStyle = INK.series; g.strokeStyle = INK.surface; g.lineWidth = 2;
      g.beginPath(); g.arc(hx, hy, 4.5, 0, 7); g.fill(); g.stroke();
    }
  }
  function placeTip(tip, wrap, x, y) {
    tip.hidden = false;
    const tw = tip.offsetWidth, ww = wrap.clientWidth;
    tip.style.left = clamp(x + 10, 2, ww - tw - 2) + 'px';
    tip.style.top = Math.max(2, y - 34) + 'px';
  }
  chart.addEventListener('pointermove', (e) => {
    if (!chartData || !chartGeom) return;
    const r = chart.getBoundingClientRect(), mx = e.clientX - r.left;
    let best = -1, bd = 1e9;
    for (let i = 0; i < chartData.d.length; i++) { const dd = Math.abs(chartGeom.X(chartData.d[i]) - mx); if (dd < bd) { bd = dd; best = i; } }
    chartHover = best; drawChart();
    if (best < 0) return;
    const tip = $('chartTip');
    let html = `<b>${chartData.h[best].toFixed(2)} m</b> <span>high at ${chartData.d[best].toFixed(1)} m</span>`;
    if (chartData.v) html += `<br><span>${(chartData.v[best] * 3.6).toFixed(0)} km/h · ${chartData.t[best].toFixed(2)} s</span>`;
    tip.innerHTML = html;
    placeTip(tip, chart.parentElement, chart.offsetLeft + chartGeom.X(chartData.d[best]), chart.offsetTop + chartGeom.Y(chartData.h[best]));
  });
  chart.addEventListener('pointerleave', () => { chartHover = -1; $('chartTip').hidden = true; drawChart(); });

  // goal-face chart
  const face = $('face');
  const FACE = { yHalf: 5.2, z0: -0.25, z1: 3.75 };
  let faceHover = -1;
  function faceXf(w, h) {
    const k = Math.min(w / (2 * FACE.yHalf), h / (FACE.z1 - FACE.z0));
    return { k, X: (y) => w / 2 + y * k, Y: (z) => h - (z - FACE.z0) * k };
  }
  function drawFace() {
    const { g, w, h } = prep(face), { X, Y } = faceXf(w, h);
    g.strokeStyle = INK.axis; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Math.round(Y(0)) + 0.5); g.lineTo(w, Math.round(Y(0)) + 0.5); g.stroke();
    g.strokeStyle = INK.text2; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(X(-FK.POST_Y), Y(0)); g.lineTo(X(-FK.POST_Y), Y(FK.BAR_Z)); g.lineTo(X(FK.POST_Y), Y(FK.BAR_Z)); g.lineTo(X(FK.POST_Y), Y(0)); g.stroke();
    const inView = (p) => Math.abs(p.y) < FACE.yHalf && p.z < FACE.z1;
    const mark = (p, big) => {
      const x = X(p.y), y = Y(p.z), s = big ? 4.5 : 2.5;
      if (p.code === 'goal') {
        g.fillStyle = INK.good; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
        if (big) { g.strokeStyle = INK.surface; g.lineWidth = 2; g.stroke(); }
      } else if (p.code === 'saved') {
        g.strokeStyle = INK.series; g.lineWidth = big ? 2 : 1.3; g.beginPath(); g.arc(x, y, s - 0.5, 0, 7); g.stroke();
      } else {
        g.strokeStyle = INK.muted; g.lineWidth = big ? 2 : 1.2;
        g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y + s); g.moveTo(x + s, y - s); g.lineTo(x - s, y + s); g.stroke();
      }
    };
    for (const p of facePoints) if (p.mc && inView(p)) mark(p, false);
    for (const p of facePoints) if (!p.mc && inView(p)) mark(p, true);
    if (preview && preview.crossing && inView(preview.crossing)) {   // where the current aim is predicted to cross
      const x = X(preview.crossing.y), y = Y(preview.crossing.z);
      g.strokeStyle = INK.text; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x - 2, y); g.moveTo(x + 2, y); g.lineTo(x + 7, y);
      g.moveTo(x, y - 7); g.lineTo(x, y - 2); g.moveTo(x, y + 2); g.lineTo(x, y + 7); g.stroke();
    }
    if (faceHover >= 0 && facePoints[faceHover]) {
      const p = facePoints[faceHover];
      g.strokeStyle = INK.text; g.lineWidth = 1; g.beginPath(); g.arc(X(p.y), Y(p.z), 8, 0, 7); g.stroke();
    }
  }
  const CODE_LABEL = { goal: 'Goal', saved: 'Saved', wall: 'Hit the wall', woodwork: 'Hit the woodwork', over: 'Over', wide: 'Wide', short: 'Short' };
  face.addEventListener('pointermove', (e) => {
    const r = face.getBoundingClientRect(), { X, Y } = faceXf(r.width, r.height);
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 10;
    facePoints.forEach((p, i) => { const d = Math.hypot(X(p.y) - mx, Y(p.z) - my); if (d < bd) { bd = d; best = i; } });
    if (best !== faceHover) { faceHover = best; drawFace(); }
    const tip = $('faceTip');
    if (best < 0) { tip.hidden = true; return; }
    const p = facePoints[best];
    tip.innerHTML = `<b>${CODE_LABEL[p.code]}</b> <span>${Math.abs(p.y).toFixed(2)} m ${p.y >= 0 ? 'right' : 'left'} of centre, ${p.z.toFixed(2)} m high${p.mc ? ' · simulated' : ''}</span>`;
    placeTip(tip, face.parentElement, face.offsetLeft + X(p.y), face.offsetTop + Y(p.z));
  });
  face.addEventListener('pointerleave', () => { faceHover = -1; $('faceTip').hidden = true; drawFace(); });
  face.addEventListener('click', (e) => {
    const r = face.getBoundingClientRect(), { k } = faceXf(r.width, r.height);
    const ty = (e.clientX - r.left - r.width / 2) / k, tz = Math.max(R, (r.height - (e.clientY - r.top)) / k + FACE.z0);
    const aim = FK.solveAim(cfg, ty, tz);
    if (!aim.converged || Math.abs(aim.azimuth) > 35 || aim.elevation > 40) { toast('That spot is out of reach with this speed and spin.'); return; }
    cfg.kick.azimuth = aim.azimuth; cfg.kick.elevation = aim.elevation;
    syncControls(); configChanged();
    toast(`Aim solved: ${fmt.az(aim.azimuth)}, ${fmt.el(aim.elevation)} elevation`);
  });
  $('btnClearFace').addEventListener('click', (e) => { facePoints.length = 0; $('mcOut').textContent = ''; drawFace(); e.target.blur(); });
  $('btnMC').addEventListener('click', (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = 'Simulating…';
    setTimeout(() => {
      const level = ui.noise === 'off' ? 'pro' : ui.noise;
      const mc = FK.monteCarlo(cfg, 300, FK.NOISE_LEVELS[level], (Math.random() * 1e9) | 0);
      for (let i = facePoints.length - 1; i >= 0; i--) if (facePoints[i].mc) facePoints.splice(i, 1);
      for (const p of mc.points) facePoints.push({ y: p.y, z: p.z, code: p.code, mc: true });
      const c = mc.counts, off = c.over + c.wide + c.short;
      $('mcOut').textContent = `This kick scores ${Math.round(100 * c.goal / mc.n)}% of the time (${FK.NOISE_LEVELS[level].label.toLowerCase()} accuracy, ${mc.n} kicks): `
        + `${c.goal} goals, ${c.saved} saved, ${c.wall} into the wall, ${c.woodwork} off the woodwork, ${off} off target.`;
      drawFace();
      btn.disabled = false; btn.textContent = 'Simulate 300 kicks'; btn.blur();
    }, 30);
  });

  // kick log & summary
  function renderLog() {
    const log = $('log'); log.innerHTML = '';
    if (!history.length) { log.innerHTML = '<p class="hint">No kicks yet.</p>'; return; }
    for (const hst of history) {
      const b = document.createElement('button');
      b.title = 'Load this set-up again';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = hst.n;
      const r = document.createElement('span'); r.className = 'r';
      const d = document.createElement('i'); d.className = 'dot ' + hst.res.code;
      r.append(d, hst.res.text);
      const m = document.createElement('span'); m.className = 'm';
      m.textContent = `${(hst.speed * 3.6).toFixed(0)} km/h · ${hst.spin.toFixed(1)} rev/s · ${hst.dist.toFixed(0)} m`;
      b.append(n, r, m);
      b.addEventListener('click', () => {
        const c = FK.cloneConfig(hst.cfg);
        for (const key of ['ball', 'kick', 'env', 'wall', 'keeper', 'physics']) cfg[key] = c[key];
        syncControls(); configChanged(); toast('Set-up loaded from kick ' + hst.n);
      });
      log.append(b);
    }
  }
  function renderSummary(res) {
    const k = sim.cfg.kick, rows = [];
    rows.push(['Off the boot', `${(k.speed * 3.6).toFixed(0)} km/h, ${k.elevation.toFixed(1)}° up`]);
    if (res.crossing) {
      rows.push(['At the goal line', `${(res.crossing.speed * 3.6).toFixed(0)} km/h after ${res.crossing.t.toFixed(2)} s`]);
      rows.push(['Crossed the line', `${Math.abs(res.crossing.y).toFixed(2)} m ${res.crossing.y >= 0 ? 'right' : 'left'}, ${res.crossing.z.toFixed(2)} m high`]);
    }
    rows.push(['Peak height', `${(sim.maxHeight - R).toFixed(2)} m`]);
    rows.push(['Sideways bend', sideOf(sim.curve, `${sim.curve.toFixed(2)} m right`, `${(-sim.curve).toFixed(2)} m left`, 'none')]);
    const t = document.createElement('table');
    for (const [a, b] of rows) { const tr = t.insertRow(); tr.insertCell().textContent = a; tr.insertCell().textContent = b; }
    $('summary').replaceChildren(t);
  }
  $('btnClearLog').addEventListener('click', (e) => {
    history.length = 0; score.goals = score.shots = 0;
    $('scGoals').textContent = '0'; $('scShots').textContent = '0'; $('scRate').textContent = '–';
    renderLog(); e.target.blur();
  });
  $('btnCsv').addEventListener('click', (e) => {
    e.target.blur();
    const r = lastRec || (mode !== 'aim' ? sim.rec : null);
    if (!r) { toast('Take a kick first.'); return; }
    const lines = ['time_s,x_m,y_m,z_m,speed_m_s,spin_rev_s'];
    for (let i = 0; i < r.t.length; i++) lines.push([r.t[i].toFixed(3), r.x[i].toFixed(4), r.y[i].toFixed(4), r.z[i].toFixed(4), r.v[i].toFixed(3), r.spin[i].toFixed(3)].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'free-kick-trajectory.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ───────────── top / bottom bars, keyboard ─────────────
  function setCam(name) {
    ui.cam = name; inspect.on = false;
    document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === name));
  }
  $('cams').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { setCam(b.dataset.cam); b.blur(); } });
  $('speeds').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ui.speed = parseFloat(b.dataset.speed);
    document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', x === b)); b.blur();
  });
  function togglePause() { ui.paused = !ui.paused; if (!ui.paused) inspect.on = false; syncPause(); }
  function toggleSound() {
    FKSound.setEnabled(!FKSound.enabled);
    const b = $('btnSound'); b.classList.toggle('muted', !FKSound.enabled); b.title = FKSound.enabled ? 'Sound on (M)' : 'Sound off (M)';
  }
  function togglePanels() {
    const hid = document.body.classList.toggle('hide-panels'), b = $('btnPanels');
    b.classList.toggle('on', !hid); b.setAttribute('aria-pressed', String(!hid)); b.dataset.tip = hid ? 'Show panels' : 'Hide panels';
    b.querySelector('.lbl').textContent = hid ? 'Show panels' : 'Hide panels';
    dismissPanelsTip();
  }
  // first visit: point at the panels button once, so people know where hiding and showing lives
  function dismissPanelsTip() {
    const t = $('panelsTip'); if (t.hidden) return;
    t.classList.remove('shown'); setTimeout(() => { t.hidden = true; }, 300);
    try { localStorage.setItem('fk.tipPanels', '1'); } catch (e) { /* storage blocked */ }
  }
  $('panelsTip').querySelector('button').addEventListener('click', dismissPanelsTip);
  setTimeout(() => {
    let seen = false; try { seen = localStorage.getItem('fk.tipPanels') === '1'; } catch (e) { /* storage blocked */ }
    if (seen || location.hash.includes('panels')) return;
    const t = $('panelsTip'); t.hidden = false; requestAnimationFrame(() => t.classList.add('shown'));
    setTimeout(dismissPanelsTip, 9000);
  }, 1500);
  /** The lines of earlier kicks (and any lab paths) disappear; the kick on screen stays. */
  function clearTrails(silent) {
    const n = trails.length - (mode === 'aim' ? 0 : 1);
    if (mode === 'aim') trails.length = 0; else trails.length = Math.min(trails.length, 1);
    API.extraRibbons.length = 0;
    syncClear();
    if (!silent) toast(n > 0 ? `Cleared ${n} earlier kick${n > 1 ? 's' : ''}` : 'Nothing to clear');
  }
  function syncClear() {
    const b = $('btnClear'), extra = window.FKApp ? window.FKApp.extraRibbons.length : 0;
    const off = trails.length - (mode === 'aim' ? 0 : 1) <= 0 && !extra;
    if (b && b.disabled !== off) b.disabled = off;
  }
  $('btnClear').addEventListener('click', (e) => { clearTrails(); e.currentTarget.blur(); });
  $('btnKick').addEventListener('click', (e) => { kick(); e.currentTarget.blur(); });
  $('btnReplay').addEventListener('click', (e) => { replay(); e.currentTarget.blur(); });
  $('btnPause').addEventListener('click', (e) => { togglePause(); e.currentTarget.blur(); });
  $('btnSound').addEventListener('click', (e) => { toggleSound(); e.currentTarget.blur(); });
  $('btnPanels').addEventListener('click', (e) => { togglePanels(); e.currentTarget.blur(); });
  $('btnHelp').addEventListener('click', (e) => { $('help').showModal(); e.currentTarget.blur(); });

  function nudge(key, delta, lo, hi) {
    cfg.kick[key] = clamp(Math.round((cfg.kick[key] + delta) * 100) / 100, lo, hi);
    syncControls(); configChanged();
  }
  window.addEventListener('keydown', (e) => {
    if ($('help').open || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') return;
    const fine = e.shiftKey ? 0.2 : 1;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    switch (k) {
      case ' ': kick(); break;
      case 'ArrowLeft': nudge('azimuth', -0.5 * fine, -35, 35); break;
      case 'ArrowRight': nudge('azimuth', 0.5 * fine, -35, 35); break;
      case 'ArrowUp': nudge('elevation', 0.5 * fine, 0, 40); break;
      case 'ArrowDown': nudge('elevation', -0.5 * fine, 0, 40); break;
      case 'w': nudge('speed', 0.5, 12, 38); break;
      case 's': nudge('speed', -0.5, 12, 38); break;
      case 'a': nudge('sideSpin', -0.5, -12, 12); break;
      case 'd': nudge('sideSpin', 0.5, -12, 12); break;
      case 'q': nudge('topSpin', -0.5, -10, 10); break;
      case 'e': nudge('topSpin', 0.5, -10, 10); break;
      case 'r': replay(); break;
      case 'p': togglePause(); break;
      case 'm': toggleSound(); break;
      case 'h': togglePanels(); break;
      case 'c': setCelebrate(!ui.celebrate); toast(ui.celebrate ? 'Goal celebrations on' : 'Goal celebrations off'); break;
      case 'x': clearTrails(); break;
      case '?': $('help').showModal(); break;
      default: {
        if (k >= '1' && k <= '5') setCam(['kicker', 'broadcast', 'follow', 'goal', 'keeper'][+k - 1]);
        else return;
      }
    }
    e.preventDefault();
  });

  // ───────────── cameras ─────────────
  const orbit = { yaw: 0.5, pitch: 0.35, dist: 34 };
  const cam = { eye: [30, 5, 3], target: [0, 0, 1], up: [0, 0, 1], fov: 0.75 };
  let followDir = [-1, 0], camSnap = true;

  // camera maths lives in js/cameras.js (pure, unit-tested); the app only supplies state
  const inspect = { yaw: 0.6, pitch: 0.3, dist: 4, on: false };
  const camOpts = { followBack: 5.5, followUp: 1.3 };
  for (const [id, out, key] of [['iFB', 'oFB', 'followBack'], ['iFU', 'oFU', 'followUp']]) {
    const el = $(id), show = () => { $(out).textContent = camOpts[key].toFixed(1) + ' m'; };
    el.value = camOpts[key]; show();
    el.addEventListener('input', () => { camOpts[key] = parseFloat(el.value); show(); });
    el.addEventListener('pointerup', () => el.blur());
  }
  const keeperGaze = {};
  function desiredCamera(dt) {
    // while the scorer celebrates, the camera goes to him (orbit and the paused inspect view stay the user's)
    // (the keeper's own eyes stay his: you watch the scorer run off from the goal line)
    const name = inspect.on && ui.paused && mode !== 'aim' ? 'inspect' : takerCeleb && ui.cam !== 'orbit' && ui.cam !== 'keeper' ? 'celebrate' : ui.cam;
    return FKCam.desired(name, { ball: cfg.ball, s: sim.s, mode, goal: sim.goal, followDir, orbit, inspect, opts: camOpts, keeperY: sim.keeper ? sim.keeper.y0 : 0,
      keeperHead: sim.keeper ? keeperHead : null, takerHead, gaze: keeperGaze, dt,
      taker: takerPos ? { x: takerPos[0], y: takerPos[1], z: takerPos[2] } : null, celeb: takerCeleb, time: performance.now() / 1000 });
  }
  function updateCamera(dt) {
    if (ui.cam !== 'keeper' || camSnap) keeperGaze.d = null;     // (fresh eyes whenever you switch to him)
    const t = desiredCamera(dt);
    const a = camSnap ? 1 : 1 - Math.exp(-dt * t.k);
    camSnap = false;
    for (let i = 0; i < 3; i++) {
      cam.eye[i] += (t.eye[i] - cam.eye[i]) * a;
      cam.target[i] += (t.target[i] - cam.target[i]) * a;
      cam.up[i] += (t.up[i] - cam.up[i]) * a;
    }
    cam.fov += (t.fov - cam.fov) * a;
  }

  // drag on the 3-D view: aim, or orbit
  const view = $('view');
  let dragging = false;
  view.addEventListener('pointerdown', (e) => { dragging = true; view.setPointerCapture(e.pointerId); });
  view.addEventListener('pointerup', () => { dragging = false; });
  view.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // turning or aiming by hand: a soft rush of air (FKSound.spin)
    if (ui.cam === 'orbit' || mode === 'aim' || ui.paused) FKSound.spin(Math.hypot(e.movementX, e.movementY) * 0.006, Math.hypot(e.movementX, e.movementY) * 0.25);
    if (ui.cam === 'orbit') {
      orbit.yaw -= e.movementX * 0.006;
      orbit.pitch = clamp(orbit.pitch + e.movementY * 0.005, 0.04, 1.5);
    } else if (ui.paused && mode !== 'aim') {   // paused mid-flight: orbit the ball itself
      inspect.on = true;
      inspect.yaw -= e.movementX * 0.008;
      inspect.pitch = clamp(inspect.pitch + e.movementY * 0.006, -0.2, 1.5);
    } else if (mode === 'aim') {
      cfg.kick.azimuth = clamp(cfg.kick.azimuth + e.movementX * 0.05, -35, 35);
      cfg.kick.elevation = clamp(cfg.kick.elevation - e.movementY * 0.05, 0, 40);
      syncControls(); configChanged();
    }
  });
  view.addEventListener('wheel', (e) => {
    if (ui.cam !== 'orbit') return;
    orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 6, 90); e.preventDefault();
  }, { passive: false });

  // ───────────── frame ─────────────
  let trailBuf = new Float32Array(3 * 2048);
  // force vectors straight from sim.forces(): length = FORCE_SCALE metres per newton
  const FORCE_SCALE = 0.32, forceBuf = [0, 1, 2, 3].map(() => new Float32Array(6));
  const FORCE_STYLE = [['gravity', [1, 1, 1, 0.95]], ['drag', [1, 0.35, 0.3, 0.95]], ['magnus', [0.35, 0.8, 1, 0.95]], ['knuckle', [1, 0.7, 0.2, 0.95]]];
  $('iForces').addEventListener('change', (e) => { ui.forces = e.target.checked; e.target.blur(); });
  function forceRibbons(out) {
    const f = sim.forces(), s = sim.s;
    FORCE_STYLE.forEach(([key, col], i) => {
      const v = f[key], L = Math.hypot(v[0], v[1], v[2]);
      if (L < 0.02) return;
      const a = forceBuf[i];
      a[0] = s[0]; a[1] = s[1]; a[2] = s[2]; a[3] = s[0] + v[0] * FORCE_SCALE; a[4] = s[1] + v[1] * FORCE_SCALE; a[5] = s[2] + v[2] * FORCE_SCALE;
      out.push({ pts: a, n: 2, width: 0.04, color: col });
    });
  }
  function buildRibbons() {
    const out = [];
    if (ui.cam === 'ballcam') return out;            // nothing in front of the ball close-up
    if (ui.trails) for (let i = (mode === 'aim' ? 0 : 1); i < trails.length; i++) out.push({ pts: trails[i], n: trails[i].length / 3, width: 0.045, color: [1, 1, 1, 0.3] });
    if (mode === 'aim') {
      if (vacuumPath) out.push({ pts: vacuumPath.points, n: vacuumPath.points.length / 3, width: 0.04, color: [0.55, 0.78, 1, 0.75], dash: { period: 2, on: 1 } });
      if (preview && ui.guide !== 'off') {
        const n = preview.points.length / 3;
        out.push({ pts: preview.points, n: ui.guide === 'short' ? Math.ceil(n / 3) : n, width: 0.05, color: [1, 1, 1, 0.9], dash: { period: 3, on: 2 } });
      }
    } else {
      const r = sim.rec, n = r.x.length;
      if ((n + 1) * 3 > trailBuf.length) trailBuf = new Float32Array((n + 512) * 3);
      for (let i = 0; i < n; i++) { trailBuf[i * 3] = r.x[i]; trailBuf[i * 3 + 1] = r.y[i]; trailBuf[i * 3 + 2] = r.z[i]; }
      trailBuf[n * 3] = sim.s[0]; trailBuf[n * 3 + 1] = sim.s[1]; trailBuf[n * 3 + 2] = sim.s[2];
      out.push({ pts: trailBuf, n: n + 1, width: 0.07, color: [1, 0.93, 0.25, 0.95], fade: true });
    }
    if (ui.forces) forceRibbons(out);
    if (ui.style === 'ink') swooshRibbons(out);
    for (const r of API.extraRibbons) out.push(r);
    return out;
  }

  // ink swooshes: the path of the kicking boot over the last fifth of a second, drawn as pen strokes
  const swooshBuf = new Float32Array(3 * 16);
  function swooshRibbons(out) {
    const t = mode === 'runup' ? runT : mode === 'aim' ? -99 : sim.t;
    if (t < -0.3 || t > 0.45) return;
    const ch = taker(), L = FK.launchState(sim.cfg), side = ch.foot === 'left' ? 'L' : 'R';
    let n = 0;
    for (let i = 0; i < 16; i++) {
      const tt = t - 0.2 + (i / 15) * 0.2;
      const toe = FKPeople.kickerBody(ch, tt, sim.cfg.ball, [L.fx, L.fy]).legs[side].toe;
      swooshBuf[n * 3] = toe[0]; swooshBuf[n * 3 + 1] = toe[1]; swooshBuf[n * 3 + 2] = toe[2] + 0.04; n++;
    }
    out.push({ pts: swooshBuf, n, width: 0.012, color: [0.1, 0.1, 0.12, 0.85], fade: true });
  }

  const tile = (id, main, sub) => { $(id).innerHTML = main + (sub ? `<small>${sub}</small>` : ''); };
  function updateTiles() {
    const a = sim.aero(), s = sim.s;
    tile('tSpeed', (a.speed * 3.6).toFixed(0), 'km/h');
    tile('tHeight', (s[2] - R).toFixed(2), 'm');
    tile('tSpin', a.spin.toFixed(1), `rev/s · ${(a.spin * 60).toFixed(0)} rpm`);
    tile('tTime', sim.t.toFixed(2), 's');
    tile('tDrag', a.drag.toFixed(1), 'N');
    tile('tMagnus', a.magnus.toFixed(1), 'N');
    tile('tCd', a.Cd.toFixed(2));
    tile('tRe', (a.Re / 1e5).toFixed(1), '×10⁵');
  }

  // ───────────── people (joint positions from js/people.js; the renderer only draws them) ─────────────
  const WALL_SKIN = [[0.86, 0.66, 0.52], [0.55, 0.38, 0.27], [0.78, 0.58, 0.44], [0.36, 0.24, 0.17], [0.9, 0.72, 0.6], [0.66, 0.47, 0.34]];
  const WALL_HAIR = [[0.1, 0.08, 0.07], [0.05, 0.05, 0.05], [0.42, 0.28, 0.16], [0.06, 0.05, 0.05], [0.7, 0.55, 0.32], [0.15, 0.1, 0.08]];
  const WALL_STYLE = ['short', 'buzz', 'short', 'bald', 'long', 'buzz'];
  const WALL_NUM = [4, 5, 14, 6, 23, 8];
  const wallLook = (i) => ({
    model: 'wall' + (i % 6), skin: WALL_SKIN[i % 6], hair: WALL_HAIR[i % 6], hairStyle: WALL_STYLE[i % 6], beard: i % 3 === 1,
    kit: { shirt: [0.10, 0.12, 0.17], shirt2: [0.85, 0.85, 0.85], pattern: 0, shorts: [0.10, 0.12, 0.17], socks: [0.10, 0.12, 0.17], number: WALL_NUM[i % 6] },
    boots: [0.9, 0.9, 0.9], build: [0.95, 0.9, 1.0, 0.93, 0.97, 0.91][i % 6],
  });
  const KEEPER_LOOK = {
    model: 'keeper', skin: [0.80, 0.60, 0.47], hair: [0.12, 0.09, 0.07], hairStyle: 'short', beard: true,
    kit: { shirt: [0.16, 0.62, 0.34], shirt2: [0.08, 0.3, 0.16], pattern: 0, shorts: [0.08, 0.10, 0.10], socks: [0.16, 0.62, 0.34], number: 1 },
    boots: [0.08, 0.08, 0.09], gloves: [0.95, 0.95, 0.9], longSleeves: true, longShorts: true, build: 0.96,
  };
  // illustrated style: the defenders recede into pencil grey so the taker (and keeper) carry the colour
  const greyC = (c) => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return [0.42 + l * 0.45, 0.43 + l * 0.45, 0.46 + l * 0.45]; };
  const greyLook = (lk) => ({ ...lk, skin: greyC(lk.skin), hair: lk.hair && greyC(lk.hair).map((v) => v * 0.6), boots: greyC(lk.boots),
    kit: { ...lk.kit, shirt: greyC(lk.kit.shirt).map((v) => v * 0.85), shirt2: greyC(lk.kit.shirt2), shorts: greyC(lk.kit.shorts).map((v) => v * 0.8), socks: greyC(lk.kit.socks).map((v) => v * 0.85) } });
  function bodies() {
    const out = [];
    const ink = ui.style === 'ink', sides = API.sides;
    const withKit = (lk, kit) => (kit ? { ...lk, kit: { ...lk.kit, shirt2: kit.shirt, pattern: 0, ...kit } } : lk);
    sim.wall.forEach((p, i) => { const lk = withKit(wallLook(i), sides && sides.defence); out.push({ body: FKPeople.wallBody(p, animClock + i * 1.7), look: ink ? greyLook(lk) : lk }); });
    if (sim.keeper) {
      const kb = FKPeople.keeperBody(sim.keeper, animClock, sim.s && [sim.s[0], sim.s[1], sim.s[2]], { toStrike: mode === 'runup' ? -runT : undefined });
      // where his eyes are, for the keeper's-eye camera
      keeperHead = { pos: kb.head, F: (kb.H && kb.H.F) || kb.F, U: (kb.H && kb.H.U) || kb.U };
      out.push({ body: kb, look: withKit(KEEPER_LOOK, sides && sides.keeper && { ...sides.keeper, number: 1 }) });
    }
    const ch0 = taker();
    const ch = sides && sides.attack ? { ...ch0, kit: { ...ch0.kit, ...sides.attack } } : ch0;
    const L = FK.launchState(mode === 'aim' ? cfg : sim.cfg);
    const t = takerT();
    // a team-mate at the ball (Kroos v Sweden: Reus stops the lay-off under his sole, then steps away)
    supportIdx = -1;
    if (layoffNow) {
      supportIdx = out.length;
      const mate = FKPeople.CHAR_BY_ID[API.layoff.mate];
      out.push({ body: FKPeople.supportBody(mate, animClock + 0.9, layoffNow.O, layoffNow.X, layoffNow.sole),
        look: sides && sides.attack ? { ...mate, kit: { ...mate.kit, ...sides.attack, number: mate.kit.number } } : mate });
    }
    const kb = FKPeople.kickerBody(ch, t, sim.cfg.ball, [L.fx, L.fy], animClock, goalAt !== null ? { tGoal: goalAt } : null);
    takerPos = kb.pelvis;
    takerHead = { pos: kb.head, F: (kb.H && kb.H.F) || kb.F, U: (kb.H && kb.H.U) || kb.U };
    takerCeleb = kb.celebDir ? { dx: kb.celebDir[0], dy: kb.celebDir[1], type: kb.celeb } : null;
    if (kb.celeb && !celebShown) { celebShown = true; toast(`${ch.short}: ${FKPeople.CELEB_NAMES[kb.celeb]}`); }
    out.push({ body: kb, look: ch });
    lastBodies = out;
    return out;
  }
  let lastBodies = [], supportIdx = -1, layoffNow = null;
  /** The taker's clock: s after the strike (negative in the run-up). Once the shot is over it keeps running (he
   * finishes his follow-through, and after a goal he celebrates) instead of freezing with the simulation. */
  function takerT() { return mode === 'aim' ? -99 : mode === 'runup' ? runT : mode === 'done' ? sim.t + (animClock - doneClock) : sim.t; }
  /**
   * A lay-off before the shot (API.layoff = {mate, dist}): the ball starts dist metres to the taker's left of the
   * spot, is rolled across as he gets ready, and the team-mate standing beside the spot stops it under his sole and
   * steps away just before the strike. Returns the ball's position and the team-mate's stance for the taker's time t.
   */
  function layoffAt(t) {
    const c = mode === 'aim' ? cfg : sim.cfg, b = c.ball, L = FK.launchState(c), lo = API.layoff;
    const F = [L.fx, L.fy], R = [F[1], -F[0]], d = lo.dist || 1.1, r = FK.C.BALL_RADIUS;
    const sm = (a, z, x) => { const u = clamp((x - a) / (z - a), 0, 1); return u * u * (3 - 2 * u); };
    const tA = -FKPeople.runTime(taker()) - 0.4, tP0 = tA + 0.1, tP1 = tA + 0.85;
    const u = clamp((t - tP0) / (tP1 - tP0), 0, 1), e = 1 - (1 - u) * (1 - u);       // a roll that slows down
    const ball = [b.x - R[0] * d * (1 - e), b.y - R[1] * d * (1 - e), r];
    const away = sm(-0.5, 0.15, t);
    const O = [b.x + R[0] * (0.36 + 0.8 * away) - F[0] * (0.11 + 0.45 * away), b.y + R[1] * (0.36 + 0.8 * away) - F[1] * (0.11 + 0.45 * away), 0];
    const w = sm(tP1 - 0.22, tP1 + 0.02, t) * (1 - sm(-0.6, -0.36, t));
    return { ball, O, X: [-R[0], -R[1], 0], sole: { p: ball, w }, rolling: u > 0 && u < 1 };
  }

  // name tags over people (exhibition recreations): {who: 'taker'|'keeper'|'wall0'.., text}
  const tagLayer = $('tags');
  function updateTags() {
    const tags = API.tags;
    if (!renderer || !tags.length || ui.style === undefined) { if (tagLayer.childElementCount) tagLayer.innerHTML = ''; return; }
    while (tagLayer.childElementCount < tags.length) tagLayer.append(document.createElement('div'));
    while (tagLayer.childElementCount > tags.length) tagLayer.lastChild.remove();
    const nWall = sim.wall.length;
    tags.forEach((tg, i) => {
      const elT = tagLayer.children[i];
      let b = null;
      if (tg.who === 'taker') b = lastBodies[lastBodies.length - 1];
      else if (tg.who === 'keeper' && sim.keeper) b = lastBodies[nWall];
      else if (tg.who === 'support' && supportIdx >= 0) b = lastBodies[supportIdx];
      else if (tg.who.startsWith('wall')) b = lastBodies[+tg.who.slice(4)];
      const p = b && renderer.project(b.body.head[0], b.body.head[1], b.body.head[2] + 0.32);
      if (!p) { elT.hidden = true; return; }
      elT.hidden = false; elT.textContent = tg.text; elT.className = 'tag3d ' + (tg.who === 'taker' ? 'att' : 'def');
      elT.style.transform = `translate(${p[0].toFixed(0)}px, ${p[1].toFixed(0)}px) translate(-50%, -100%)`;
    });
  }
  let takerPos = null, takerCeleb = null, keeperHead = null, takerHead = null;

  // ── the dock reacts to the shot: the kick button fills as the taker runs up; body[data-mode] drives styling ──
  const dock = { kick: $('btnKick'), p: -1, mode: '', focus: false };
  function updateDock() {
    const p = mode === 'runup' ? clamp(1 - runT / Math.min(-0.01, runFrom), 0, 1) : mode === 'live' ? 1 : 0;
    if (Math.abs(p - dock.p) > 0.004) { dock.kick.style.setProperty('--p', p.toFixed(3)); dock.p = p; }
    if (mode !== dock.mode) { document.body.dataset.mode = mode; dock.mode = mode; }
    // from 2.5 s before the strike until the ball has settled, the side rails and drawers slide away to their own
    // sides, leaving the pitch clear; they glide back about 1.5 s after the flight ends
    const focus = (mode === 'runup' && runT > -2.5) || mode === 'live' || (mode === 'done' && animClock - doneClock < 1.5);
    if (focus !== dock.focus) { document.body.classList.toggle('kick-focus', focus); dock.focus = focus; }
  }
  /** Segmented controls get a sliding highlight that follows whichever button is on. */
  function initSliders() {
    for (const g of document.querySelectorAll('.slider')) {
      const pill = document.createElement('i'); pill.className = 'pill'; pill.setAttribute('aria-hidden', 'true'); g.prepend(pill);
      const place = () => {
        const on = g.querySelector('button.on');
        if (!on || !on.offsetWidth) { pill.style.opacity = '0'; return; }
        pill.style.opacity = '1'; pill.style.width = on.offsetWidth + 'px'; pill.style.transform = `translateX(${on.offsetLeft}px)`;
      };
      new MutationObserver(place).observe(g, { subtree: true, attributes: true, attributeFilter: ['class'] });
      window.addEventListener('resize', place); requestAnimationFrame(place);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    }
  }

  let last = performance.now(), frameNo = 0, animClock = 0;   // animClock: idle motion time (stops when paused)
  function frame(now) {
    const raw = (now - last) / 1000; last = now; frameNo++;
    // camera smoothing uses a capped step; the shot itself runs on real elapsed time (up to 0.25 s per frame), so a
    // slow frame rate no longer turns a 110 km/h shot into slow motion (the old 0.05 s cap did, below 20 fps)
    const dt = Math.min(0.05, raw), simDt = Math.min(0.25, raw);
    if (!ui.paused) animClock += simDt * ui.speed;
    if (mode === 'aim') updatePreview();
    if (mode === 'runup' && !ui.paused) {
      runT += simDt * (isReplay ? Math.min(ui.speed, 0.25) : ui.speed);
      if (runT >= 0) startShot(pendingShot, isReplay);
    }
    if (mode === 'live' && !ui.paused) {
      const scale = isReplay ? Math.min(ui.speed, 0.25) : ui.speed;
      acc += simDt * scale;
      let n = 0;
      while (acc >= sim.dt && !sim.done && sim.t < freezeAt && n++ < 1000) { sim.step(); acc -= sim.dt; }
      if (acc > sim.dt) acc = 0;
      for (const ev of sim.events) FKSound.play(ev.type === 'goal' ? null : ev.type, ev.speed);
      sim.events.length = 0;
      if (sim.goal && goalAt === null && !isReplay && ui.celebrate) goalAt = sim.t;   // the taker celebrates (not in replays)
      if (!announced && (sim.goal || sim.caught || sim.offTarget || (sim.firstTouchT >= 0 && sim.t > sim.firstTouchT + 1.1))) announce();
      if (sim.done) finishShot();
    }
    for (const h of frameHooks) h(dt);
    syncClear();
    updateCamera(dt);
    layoffNow = API.layoff ? layoffAt(takerT()) : null;
    const preShot = layoffNow && (mode === 'aim' || mode === 'runup');
    if (renderer) {
      renderer.draw({
        cam, dt,
        ball: preShot ? { x: layoffNow.ball[0], y: layoffNow.ball[1], z: layoffNow.ball[2], q: sim.q } : { x: sim.s[0], y: sim.s[1], z: sim.s[2], q: sim.q },
        bodies: bodies(), light: ui.light, style: ui.style, net: sim.net, ballDesign: sim.cfg.ballId,
        ribbons: buildRibbons(),
      });
    }
    updateTags();
    updateDock();
    if (mode === 'live' || frameNo % 6 === 0) updateTiles();
    if ((mode === 'live' && frameNo % 3 === 0) || frameNo % 20 === 0) { if (chartHover < 0) drawChart(); }
    if (mode === 'live' && frameNo % 6 === 0) drawMap();
    requestAnimationFrame(frame);
  }

  // ───────────── API for the labs, the story and the exhibition (js/labs.js, js/story.js) ─────────────
  const frameHooks = [];
  const API = {
    cfg, ui,
    get sim() { return sim; }, get mode() { return mode; }, get runT() { return runT; }, get lastShot() { return lastShot; },
    /** Seconds since the flight ended (follow-through, celebration); 0 before that. */
    get afterT() { return mode === 'done' ? Math.max(0, animClock - doneClock) : 0; },
    extraRibbons: [],
    sides: null,        // match kits for an exhibition recreation: {attack, defence, keeper}
    tags: [],           // name tags shown over people
    /** Leave a recreation: back to the user's own kits, no name tags. */
    clearMatch() { API.sides = null; API.tags = []; API.layoff = null; },
    layoff: null,       // a lay-off before the shot: {mate: character id, dist: m}
    onFrame(fn) { frameHooks.push(fn); },
    setupAim, configChanged, syncControls, setCam, selectTaker, toast, kick, replay,
    inspect,            // the paused orbit around the ball {on, yaw, pitch, dist} (used for the showcase pictures)
    taker,
    /** Solve the aim for a goal-line target with the current speed and spin, and apply it. */
    aimAt(ty, tz) {
      const a = FK.solveAim(cfg, ty, tz);
      cfg.kick.azimuth = clamp(a.azimuth, -35, 35); cfg.kick.elevation = clamp(a.elevation, 0, 40);
      syncControls(); configChanged(); return a;
    },
    setSpeed(v) { ui.speed = v; document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', parseFloat(x.dataset.speed) === v)); },
    setPaused(p) { if (ui.paused !== p) togglePause(); },
    /** Show (true) or hide (false) the panels, as the dock's Panels button does. */
    setPanels(on) { if (document.body.classList.contains('hide-panels') === !!on) togglePanels(); },
    setForces(on) { ui.forces = on; $('iForces').checked = on; },
    /** Take the current set-up as a kick (with the run-up) without counting it in the score. */
    play(from) {
      if (mode !== 'aim') setupAim();
      const shot = FK.cloneConfig(cfg);
      lastShot = shot; lastIntended = FK.cloneConfig(cfg); $('btnReplay').disabled = false;
      beginRunup(shot, false, from !== undefined ? from : -FKPeople.runTime(taker()) - 0.4);
      quiet = true;
    },
    /** Jump the last kick to time t (s after the strike; negative = during the run-up) and pause there. */
    seek(t) {
      if (!lastShot) return;
      if (t < 0) { beginRunup(lastShot, false, t); quiet = true; }
      else {
        startShot(lastShot, false); quiet = true;
        while (!sim.done && sim.t < t) { sim.step(); if (sim.goal && goalAt === null) goalAt = sim.t; }
        sim.events.length = 0;
        // past the end of the flight: the taker's clock runs on (follow-through, celebration)
        if (sim.done && t > sim.t) { mode = 'done'; doneClock = animClock - (t - sim.t); announced = true; }
      }
      if (!ui.paused) togglePause();
    },
    shotDuration() {
      if (!lastShot) return 0;
      const s = new FK.Simulation(lastShot, { record: false }); s.run(); return s.t;
    },
  };
  let quiet = false;
  window.FKApp = API;

  // ───────────── boot ─────────────
  setupAim();
  if (location.hash.indexOf('taker=') < 0) selectTaker(ui.taker, true);
  $('toast').hidden = true;
  syncControls(); renderLog(); drawMap(); drawFace(); drawChart();
  window.addEventListener('resize', () => { drawMap(); drawFace(); drawChart(); });

  // optional URL hash switches, handy for demos and screenshots: #cam=goal&kick&freeze=0.6
  // (freeze = stop the kick at that many seconds; add &ff to jump straight there)
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('cam')) setCam(hash.get('cam'));
  if (hash.get('taker')) selectTaker(hash.get('taker'), true);
  if (hash.get('light')) { ui.light = hash.get('light'); syncControls(); }
  if (hash.get('style')) { ui.style = hash.get('style'); syncControls(); }
  // top-bar switch between the illustrated background and the stadium
  $('looks').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ui.style = b.dataset.look; syncControls(); applyTheme(); b.blur();
  });
  applyTheme();
  initSliders();
  if (hash.get('ball')) {
    cfg.ballId = hash.get('ball');
    const aero = window.FKBalls && FKBalls.aeroFor(cfg.ballId, 'A', FK.AERO_DEFAULT);
    if (aero) cfg.aero = aero; else delete cfg.aero;
    configChanged();
  }
  if (hash.get('preset')) applyPreset(hash.get('preset'));
  if (hash.has('panels')) togglePanels();
  if (hash.has('freeze')) freezeAt = parseFloat(hash.get('freeze'));
  // #run=-0.3 freezes the run-up at that time before the strike (for screenshots of the kicker)
  if (hash.has('run')) setTimeout(() => { kick(); runT = parseFloat(hash.get('run')); ui.paused = true; }, 200);
  if (hash.has('go')) setTimeout(() => kick(), 200);     // a normal kick, run-up included
  if (hash.has('kick')) setTimeout(() => {
    kick(true);
    if (hash.has('ff')) while (!sim.done && sim.t < freezeAt) sim.step();
  }, 200);

  requestAnimationFrame(frame);
})();
