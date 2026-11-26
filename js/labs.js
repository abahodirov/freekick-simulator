/*
 * Free Kick Simulator — the labs: Ball Laboratory, Experiment Lab and the historical exhibition.
 * Every number shown here comes from the physics engine (FK.simulateFlight / FK.Simulation) run on the
 * user's current set-up; nothing is a separate approximation. Overlays are drawn through FKApp.extraRibbons.
 */
(function () {
  'use strict';
  const A = window.FKApp;
  if (!A) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v; else if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f);
      else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v);
    }
    for (const k of kids) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  // palette for compared runs (validated categorical set, readable on the dark panel and on the paper style)
  const RUN_COLORS = ['#3987e5', '#e5713a', '#2fa36b', '#c94fa8', '#d9b02b', '#6b6ee8'];
  const cv = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
  const hexToRgba = (h, a) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, a];

  // ───────────── drawer and navigation ─────────────
  const drawer = $('lab'), body = $('labBody'), title = $('labTitle');
  let current = 'play';
  function open(mode) {
    current = mode;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    document.body.classList.toggle('lab-open', mode !== 'play');
    A.extraRibbons.length = 0;
    body.innerHTML = '';
    if (mode !== 'story' && window.FKStory) window.FKStory.stop();
    if (mode === 'ball') ballLab();
    else if (mode === 'exp') experimentLab();
    else if (mode === 'history') exhibition();
    else if (mode === 'story') window.FKStory && window.FKStory.panel(body, title);
    drawer.hidden = mode === 'play';
  }
  $('modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { open(b.dataset.mode); b.blur(); } });
  $('labClose').addEventListener('click', () => open('play'));

  // ───────────── shared: run a set of flights and compare ─────────────
  /** cfgs: [{label, cfg, opts}] → results with sampled paths (no wall/keeper: pure flight). */
  function runFlights(items) {
    return items.map((it, i) => {
      const f = FK.simulateFlight(it.cfg, Object.assign({ knuckle: false, sample: 0.01, maxTime: 4 }, it.opts || {}));
      const p = f.points, n = p.length / 3;
      // lateral deviation from the straight launch line, and distance along the ground
      const L = FK.launchState(it.cfg), x0 = it.cfg.ball.x, y0 = it.cfg.ball.y;
      const along = [], lat = [], h = [];
      for (let k = 0; k < n; k++) {
        const dx = p[k * 3] - x0, dy = p[k * 3 + 1] - y0;
        along.push(dx * L.fx + dy * L.fy); lat.push(dx * L.rx + dy * L.ry); h.push(p[k * 3 + 2] - FK.C.BALL_RADIUS);
      }
      return { label: it.label, color: RUN_COLORS[i % RUN_COLORS.length], f, along, lat, h, cfg: it.cfg };
    });
  }
  function showRuns(runs) {
    A.extraRibbons.length = 0;
    for (const r of runs) A.extraRibbons.push({ pts: new Float32Array(r.f.points), n: r.f.points.length / 3, width: 0.05, color: hexToRgba(r.color, 0.95) });
  }
  /** Small two-panel chart: side view (height vs distance) and top view (sideways drift vs distance). */
  function chart(runs) {
    const wrap = el('div', { class: 'labchart' });
    for (const [key, name, unit] of [['h', 'Height', 'm'], ['lat', 'Sideways drift', 'm']]) {
      const c = el('canvas', { width: 300, height: 120 });
      const box = el('div', { class: 'chart-title' }, `${name} along the path (${unit})`);
      wrap.append(box, c);
      const g = c.getContext('2d'), W = c.width, H = c.height, pad = 26;
      let xMax = 1, yMin = 0, yMax = 0.5;
      for (const r of runs) for (let i = 0; i < r.along.length; i++) { xMax = Math.max(xMax, r.along[i]); yMin = Math.min(yMin, r[key][i]); yMax = Math.max(yMax, r[key][i]); }
      const X = (v) => pad + (v / xMax) * (W - pad - 6), Y = (v) => H - 16 - ((v - yMin) / (yMax - yMin || 1)) * (H - 26);
      g.strokeStyle = cv('--axis'); g.lineWidth = 1; g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(W - 4, Y(0)); g.stroke();
      g.fillStyle = cv('--muted'); g.font = '10px system-ui'; g.fillText(yMax.toFixed(1), 2, Y(yMax) + 8); g.fillText(yMin.toFixed(1), 2, Y(yMin)); g.fillText(`${xMax.toFixed(0)} m`, W - 34, H - 3);
      for (const r of runs) {
        g.strokeStyle = r.color; g.lineWidth = 2; g.beginPath();
        r.along.forEach((v, i) => (i ? g.lineTo(X(v), Y(r[key][i])) : g.moveTo(X(v), Y(r[key][i]))));
        g.stroke();
      }
    }
    return wrap;
  }
  function table(runs, extraCols) {
    const t = el('table', { class: 'labtable' });
    t.append(el('tr', {}, el('th', {}, ''), el('th', {}, 'Run'), el('th', {}, 'At the goal line (y, z)'), el('th', {}, 'Time'), el('th', {}, 'Max height'), el('th', {}, 'Curve')));
    for (const r of runs) {
      const c = r.f.crossing;
      t.append(el('tr', {},
        el('td', {}, el('i', { class: 'sw', style: `background:${r.color}` })),
        el('td', {}, r.label),
        el('td', {}, c ? `${c.y.toFixed(2)}, ${c.z.toFixed(2)} m` : 'did not reach'),
        el('td', {}, c ? `${c.t.toFixed(2)} s` : '–'),
        el('td', {}, `${(r.f.maxHeight - FK.C.BALL_RADIUS).toFixed(2)} m`),
        el('td', {}, `${Math.abs(r.lat[r.lat.length - 1]).toFixed(2)} m`)));
    }
    void extraCols;
    return t;
  }
  function csvButton(runs, name) {
    return el('button', { on: { click: () => {
      const lines = ['run,label,distance_m,height_m,drift_m'];
      runs.forEach((r, i) => r.along.forEach((v, k) => lines.push([i + 1, `"${r.label}"`, v.toFixed(3), r.h[k].toFixed(3), r.lat[k].toFixed(3)].join(','))));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } } }, 'Export CSV');
  }
  const sourceLink = (s) => el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title);

  // ───────────── Ball Laboratory ─────────────
  let ballSel = 'brazuca', orient = 'A';
  function ballLab() {
    title.textContent = 'Ball laboratory';
    body.append(el('p', { class: 'lead' }, 'Footballs differ mostly in one thing that matters for flight: the speed at which the air around them switches from a "draggy" to a "slippery" flow (the drag crisis). Panels and surface texture move that switch. Compare models with exactly the same kick.'));
    const list = el('div', { class: 'balllist' });
    for (const b of FKBalls.BALLS) {
      list.append(el('button', { class: b.id === ballSel ? 'on' : '', on: { click: () => { ballSel = b.id; open('ball'); } } },
        el('b', {}, b.name), el('small', {}, b.year ? String(b.year) : 'generic')));
    }
    body.append(list);
    const b = FKBalls.BALLS.find((x) => x.id === ballSel);
    const o = b.orient[orient] || b.orient.A;
    const atm = A.sim.atm;
    const vCrit = FKBalls.speedAtRe(o.reCrit, atm.rho, atm.mu);
    const tag = b.tag === 'measured' ? el('span', { class: 'tag ok' }, 'Measured') : el('span', { class: 'tag est' }, 'Engine fit');
    body.append(el('div', { class: 'card' },
      el('h4', {}, b.name, ' ', tag),
      el('p', {}, b.note),
      Object.keys(b.orient).length > 1 ? el('div', { class: 'seg mini' }, ...['A', 'B'].map((k) => el('button', { class: orient === k ? 'on' : '', on: { click: () => { orient = k; open('ball'); } } }, `Panel orientation ${k}`))) : null,
      el('dl', {},
        el('dt', {}, 'Drag crisis completes at'), el('dd', {}, `Re ≈ ${(o.reCrit / 1e5).toFixed(1)}×10⁵ → about ${vCrit.toFixed(1)} m/s (${(vCrit * 3.6).toFixed(0)} km/h) in today's air`),
        el('dt', {}, 'Drag coefficient after the crisis'), el('dd', {}, `C_d ≈ ${o.cdSuper.toFixed(2)}`),
        el('dt', {}, 'Below the crisis'), el('dd', {}, 'C_d ≈ 0.35 (engine fit; not given per ball in the source)')),
      el('p', { class: 'src' }, 'Source: ', sourceLink(b.source))));
    body.append(el('div', { class: 'btnrow' },
      el('button', { class: 'primary', on: { click: () => { useBall(ballSel); A.toast(`Now kicking the ${b.name}`); } } }, 'Use this ball'),
      el('button', { on: { click: () => { useBall(ballSel); A.setupAim(); A.setCam('ballcam'); } } }, 'Look at it'),
      el('button', { on: { click: () => compare() } }, 'Compare all balls')));
    // Cd vs speed curves
    const c = el('canvas', { width: 300, height: 150 });
    body.append(el('div', { class: 'chart-title' }, 'Drag coefficient vs air speed (non-spinning)'), c);
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const X = (v) => 28 + (v / 40) * (W - 36), Y = (cd) => H - 18 - (cd / 0.4) * (H - 28);
    g.fillStyle = cv('--muted'); g.font = '10px system-ui';
    for (const v of [0, 10, 20, 30, 40]) g.fillText(`${v}`, X(v) - 4, H - 4);
    for (const cd of [0.1, 0.2, 0.3]) { g.fillText(cd.toFixed(1), 2, Y(cd) + 3); g.strokeStyle = cv('--grid'); g.beginPath(); g.moveTo(28, Y(cd)); g.lineTo(W - 6, Y(cd)); g.stroke(); }
    FKBalls.BALLS.forEach((bb, i) => {
      const aero = FKBalls.aeroFor(bb.id, orient, FK.AERO_DEFAULT) || FK.AERO_DEFAULT;
      g.strokeStyle = RUN_COLORS[i]; g.lineWidth = bb.id === ballSel ? 2.5 : 1.2; g.beginPath();
      for (let v = 1; v <= 40; v += 0.5) { const Re = atm.rho * v * 0.22 / atm.mu; const cd = FK.dragCoefficient(Re, 0, aero); v === 1 ? g.moveTo(X(v), Y(cd)) : g.lineTo(X(v), Y(cd)); }
      g.stroke();
    });
    const vk = A.cfg.kick.speed;
    g.strokeStyle = cv('--text'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(vk), 6); g.lineTo(X(vk), H - 18); g.stroke(); g.setLineDash([]);
    g.fillStyle = cv('--text'); g.fillText('your kick', X(vk) + 3, 14);
    body.append(el('div', { class: 'legend' }, ...FKBalls.BALLS.map((bb, i) => el('span', {}, el('i', { class: 'sw', style: `background:${RUN_COLORS[i]}` }), bb.name.replace('Adidas ', '')))));
    body.append(el('p', { class: 'hint' }, 'Why it matters: a free kick slows from about 30 m/s to about 20 m/s on its way to goal. If the drag crisis sits inside that range, the drag can rise sharply in mid-flight, so the ball "dies" or dips later than the player expects.'));
    const out = el('div', { id: 'ballCompare' }); body.append(out);
  }
  /** Put a ball model into play: its measured aerodynamics and its look. */
  function useBall(id) {
    const aero = FKBalls.aeroFor(id, orient, FK.AERO_DEFAULT);
    if (aero) A.cfg.aero = aero; else delete A.cfg.aero;
    if (id === 'engine') delete A.cfg.ballId; else A.cfg.ballId = id;
    A.configChanged();
  }
  function compare() {
    const items = FKBalls.BALLS.map((b) => {
      const c = FK.cloneConfig(A.cfg);
      const aero = FKBalls.aeroFor(b.id, orient, FK.AERO_DEFAULT);
      if (aero) c.aero = aero; else delete c.aero;
      return { label: b.name.replace('Adidas ', '') + (b.id !== 'engine' ? ` (${orient})` : ''), cfg: c };
    });
    const runs = runFlights(items);
    showRuns(runs);
    const out = $('ballCompare'); out.innerHTML = '';
    out.append(el('h4', {}, 'Same kick, four balls'), table(runs), chart(runs), el('div', { class: 'btnrow' }, csvButton(runs, 'ball-comparison')));
    const spread = Math.max(...runs.map((r) => r.f.crossing ? r.f.crossing.z : 0)) - Math.min(...runs.map((r) => r.f.crossing ? r.f.crossing.z : 9));
    out.append(el('p', { class: 'hint' }, `The crossing heights differ by ${spread.toFixed(2)} m with identical launch conditions — the only difference is where each ball's drag crisis falls.`));
  }

  // ───────────── Experiment Lab ─────────────
  const EXPERIMENTS = [
    { id: 'spin', name: '1 · Spin vs curve', vary: 'sideSpin', values: [0, 3, 6, 9, 12], unit: 'rev/s', label: (v) => `side spin ${v} rev/s`,
      text: 'Same speed and direction; only the side spin changes. The Magnus force is roughly proportional to spin at a given speed, so the curve grows with spin, but not linearly: the lift coefficient saturates.' },
    { id: 'drag', name: '2 · Speed vs drag', vary: 'speed', values: [18, 23, 28, 33], unit: 'm/s', label: (v) => `${v} m/s (${(v * 3.6).toFixed(0)} km/h)`,
      text: 'Faster shots arrive sooner, but drag grows with the square of speed, so the fastest shot loses the most speed in absolute terms. Watch the flight time shrink less than the speed rises.' },
    { id: 'topback', name: '3 · Backspin vs topspin', vary: 'topSpin', values: [-6, -3, 0, 3, 6], unit: 'rev/s', label: (v) => v > 0 ? `topspin ${v}` : v < 0 ? `backspin ${-v}` : 'no spin',
      text: 'Topspin makes the Magnus force point down, so the ball dips. Backspin points it up, so the ball floats and lands later.' },
    { id: 'knuckle', name: '4 · The knuckleball', vary: 'seed', values: [1, 2, 3, 4, 5], unit: '', label: (v) => `identical kick, attempt ${v}`, knuckle: true, fixed: { sideSpin: 0, topSpin: 0.15, speed: 31 },
      text: 'Five identical, almost spinless kicks. Only the tiny differences in how the wake separates change between attempts (modelled as a slowly varying side force), and the paths fan out.' },
    { id: 'wind', name: '5 · Wind', vary: 'windDir', values: [-1, 0, 90, 180, 270], unit: '°', label: (v) => v < 0 ? 'no wind' : `8 m/s toward ${['the goal', 'the right', 'the kicker', 'the left'][v / 90]}`, env: true,
      text: 'The ball feels the wind through drag and Magnus, which depend on its speed relative to the air. A tail wind lowers the relative speed, so the ball carries; a head wind does the opposite.' },
    { id: 'ball', name: '6 · Ball design', ball: true,
      text: 'Identical kicks with each ball model from the Ball Laboratory (measured drag-crisis values where available).' },
    { id: 'perfect', name: '7 · The perfect free kick', perfect: true,
      text: 'A target appears in the goal. Use the Kick controls (speed, direction, elevation, spin) to put the predicted path through it, then press "Check". Stuck? Ask for a solution.' },
  ];
  let expSel = 'spin', lastRuns = null;
  const expHistory = [];
  let target = null;
  function experimentLab() {
    title.textContent = 'Experiment lab';
    body.append(el('p', { class: 'lead' }, 'Controlled experiments: one variable changes, everything else is your current set-up. All paths are computed by the same physics engine as the game.'));
    const list = el('div', { class: 'explist' });
    for (const e of EXPERIMENTS) list.append(el('button', { class: e.id === expSel ? 'on' : '', on: { click: () => { expSel = e.id; open('exp'); } } }, e.name));
    body.append(list);
    const e = EXPERIMENTS.find((x) => x.id === expSel);
    body.append(el('p', {}, e.text));
    const out = el('div');
    if (e.perfect) { perfectUI(out); body.append(out); return; }
    body.append(el('div', { class: 'btnrow' }, el('button', { class: 'primary', on: { click: () => runExp(e, out) } }, 'Run experiment')), out);
    if (expHistory.length) {
      body.append(el('h4', {}, 'Earlier runs'), el('ul', { class: 'hist' }, ...expHistory.slice(0, 6).map((h) => el('li', {}, h))));
    }
  }
  function runExp(e, out) {
    let items;
    if (e.ball) {
      items = FKBalls.BALLS.map((b) => { const c = FK.cloneConfig(A.cfg); const a = FKBalls.aeroFor(b.id, 'A', FK.AERO_DEFAULT); if (a) c.aero = a; else delete c.aero; return { label: b.name, cfg: c }; });
    } else {
      items = e.values.map((v) => {
        const c = FK.cloneConfig(A.cfg);
        if (e.fixed) Object.assign(c.kick, e.fixed);
        if (e.env) { if (v < 0) c.env.windSpeed = 0; else { c.env.windSpeed = 8; c.env.windDir = v; } }
        else if (e.vary === 'seed') c.seed = v * 7919;
        else c.kick[e.vary] = v;
        return { label: e.label(v), cfg: c, opts: e.knuckle ? { knuckle: true } : null };
      });
    }
    const runs = runFlights(items);
    lastRuns = runs; showRuns(runs);
    out.innerHTML = '';
    out.append(table(runs), chart(runs), el('div', { class: 'btnrow' }, csvButton(runs, 'experiment-' + e.id)));
    const cross = runs.filter((r) => r.f.crossing);
    if (cross.length > 1) {
      const dz = Math.max(...cross.map((r) => r.f.crossing.z)) - Math.min(...cross.map((r) => r.f.crossing.z));
      const dy = Math.max(...cross.map((r) => r.f.crossing.y)) - Math.min(...cross.map((r) => r.f.crossing.y));
      const s = `${e.name}: crossings spread ${dy.toFixed(2)} m sideways and ${dz.toFixed(2)} m in height`;
      out.append(el('p', { class: 'hint' }, s + '.'));
      expHistory.unshift(s);
    }
  }
  function perfectUI(out) {
    if (!target) target = { y: (Math.random() * 2 - 1) * 3.1, z: 0.4 + Math.random() * 1.7 };
    const ring = () => {           // draw the target as a ring on the goal line
      const pts = new Float32Array(3 * 25);
      for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts[i * 3] = 0.02; pts[i * 3 + 1] = target.y + Math.cos(a) * 0.3; pts[i * 3 + 2] = target.z + Math.sin(a) * 0.3; }
      A.extraRibbons.length = 0; A.extraRibbons.push({ pts, n: 25, width: 0.06, color: [1, 0.35, 0.3, 1] });
    };
    ring();
    const res = el('div', { class: 'card' });
    const check = () => {
      const f = FK.simulateFlight(A.cfg, { knuckle: false });
      res.innerHTML = '';
      if (!f.crossing) { res.append(el('p', {}, 'The predicted path does not reach the goal line yet.')); return; }
      const miss = Math.hypot(f.crossing.y - target.y, f.crossing.z - target.z);
      res.append(el('h4', {}, miss < 0.3 ? 'On target!' : `Off by ${(miss * 100).toFixed(0)} cm`),
        el('p', {}, `Crossing: ${f.crossing.y.toFixed(2)} m across, ${f.crossing.z.toFixed(2)} m high, after ${f.crossing.t.toFixed(2)} s (target ${target.y.toFixed(2)}, ${target.z.toFixed(2)}).`));
      if (miss < 0.3) res.append(el('p', {}, 'Why it works: elevation sets how long gravity has to pull the ball down, direction and side spin set where it ends up sideways, and topspin or backspin shift the height at the line.'));
    };
    out.append(el('p', {}, `Target: ${target.y.toFixed(2)} m ${target.y >= 0 ? 'right' : 'left'} of centre, ${target.z.toFixed(2)} m high (red ring).`),
      el('div', { class: 'btnrow' },
        el('button', { class: 'primary', on: { click: check } }, 'Check'),
        el('button', { on: { click: () => { const a = A.aimAt(target.y, target.z); check(); A.toast(a.converged ? 'Solved: direction and elevation adjusted for your speed and spin' : 'No exact solution with this speed and spin — try more speed'); } } }, 'Show a solution'),
        el('button', { on: { click: () => { target = null; open('exp'); } } }, 'New target')),
      res);
  }

  // ───────────── the historical exhibition ─────────────
  let kickSel = null;
  function exhibition() {
    title.textContent = 'Defining free kicks';
    body.append(el('p', { class: 'lead' }, `${FKHistory.KICKS.length} free kicks, each chosen to show a different piece of physics. Documented facts come from the listed sources. The 3-D reconstructions are estimates: plausible launch values for that kind of strike, not measurements of the actual goal.`));
    if (!kickSel) {
      const grid = el('div', { class: 'kicklist' });
      for (const k of FKHistory.KICKS) {
        grid.append(el('button', { on: { click: () => { kickSel = k.id; open('history'); } } },
          el('b', {}, `${k.facts.player}`), el('span', {}, `${k.facts.opponent}, ${k.facts.date.slice(0, 4)}`), el('small', {}, k.title)));
      }
      body.append(grid);
      body.append(el('p', { class: 'hint' }, 'This exhibition is not finished: more free kicks are to be added, each only once its details can be sourced.'));
      return;
    }
    const k = FKHistory.KICKS.find((x) => x.id === kickSel);
    const f = k.facts;
    body.append(el('button', { class: 'ghost back', on: { click: () => { kickSel = null; open('history'); } } }, '← All free kicks'));
    body.append(el('h3', {}, k.title));
    body.append(el('dl', { class: 'facts' },
      el('dt', {}, 'Player'), el('dd', {}, `${f.player} (${f.for})`),
      el('dt', {}, 'Match'), el('dd', {}, `v ${f.opponent}, ${f.result}${f.minute ? `, ${f.minute}'` : ''}`),
      el('dt', {}, 'Competition'), el('dd', {}, f.competition),
      el('dt', {}, 'Date'), el('dd', {}, f.date),
      el('dt', {}, 'Venue'), el('dd', {}, f.venue),
      el('dt', {}, 'Distance'), el('dd', {}, f.distance),
      el('dt', {}, 'Goalkeeper'), el('dd', {}, f.goalkeeper),
      el('dt', {}, 'The wall'), el('dd', {}, f.wall),
      el('dt', {}, 'How it went in'), el('dd', {}, f.how)));
    const sec = (h, t) => el('section', { class: 'cs' }, el('h4', {}, h), el('p', {}, t));
    body.append(sec('The moment', k.moment), sec('The technique', k.technique), sec('The physics', k.physics));
    const r = k.recon;
    body.append(el('section', { class: 'cs' }, el('h4', {}, 'The trajectory ', el('span', { class: 'tag est' }, 'Estimate')),
      el('p', {}, `Reconstruction: ball ${Math.hypot(r.ball.x, r.ball.y).toFixed(1)} m from goal, ${r.kick.speed} m/s (${(r.kick.speed * 3.6).toFixed(0)} km/h), side spin ${r.kick.side} rev/s, topspin ${r.kick.top} rev/s. Values are estimates chosen to match the documented distance and the visible character of the strike.`),
      el('p', {}, `When you watch it, the ball goes in, as it did. The simulated goalkeeper (labelled ${f.goalkeeper}) reads every shot with some error; the recreation uses a read under which the real outcome happens. The ball's flight is pure physics either way.`),
      el('div', { class: 'btnrow' },
        el('button', { class: 'primary', on: { click: () => { load(k); A.play(); } } }, 'Watch it'),
        el('button', { on: { click: () => { load(k); A.setCam('taker'); A.play(); } } }, 'From the taker'),
        el('button', { on: { click: () => { load(k); open('story'); window.FKStory.start(); } } }, 'Anatomy of this kick'))));
    body.append(sec('The goalkeeper', k.keeper));
    const ex = k.experiment, out = el('div');
    body.append(el('section', { class: 'cs' }, el('h4', {}, 'The experiment'),
      el('p', {}, `Change ${ex.label.toLowerCase()} and keep everything else as in the reconstruction:`),
      el('div', { class: 'btnrow' }, el('button', { on: { click: () => {
        load(k, true);
        const items = ex.values.map((v) => { const c = FK.cloneConfig(A.cfg); c.kick[ex.param === 'side' ? 'sideSpin' : ex.param === 'top' ? 'topSpin' : 'speed'] = v; return { label: `${ex.label} = ${v}`, cfg: c }; });
        const runs = runFlights(items); showRuns(runs); out.innerHTML = ''; out.append(table(runs), chart(runs));
      } } }, 'Run the comparison')), out));
    body.append(el('section', { class: 'cs takeaway' }, el('h4', {}, 'The takeaway'), el('p', {}, k.takeaway)));
    body.append(el('section', { class: 'cs' }, el('h4', {}, 'Sources'), el('ul', {}, ...k.sources.map((s) => el('li', {}, sourceLink(s))))));
  }
  /**
   * The keeper in this simulator reads each shot with a random error (drawn from the kick's seed). For a recreation we
   * pick the first seed under which the documented outcome — a goal — actually happens, so the keeper's read is one
   * that is consistent with history. The flight physics are not touched.
   */
  function seedForGoal(cfg) {
    let any = null;
    for (let s = 0; s < 400; s++) {
      const c = FK.cloneConfig(cfg); c.seed = 1009 + s * 7919;
      const sim = new FK.Simulation(c, { record: false, fast: true });
      const res = sim.run(9);
      if (res.code !== 'goal') continue;
      if (!sim.touched.keeper && !sim.touched.wall) return c.seed;     // clean, as in the real goal
      if (any === null) any = c.seed;
    }
    return any;
  }
  /** Load a reconstruction into the simulator (taker, spot, kick, wall, keeper, kits, names) and solve the aim. */
  function load(k, quietLoad) {
    const r = k.recon, c = A.cfg;
    A.setupAim();
    A.selectTaker(k.taker, false);
    c.ball = FK.clampBallPosition(r.ball.x, r.ball.y);
    Object.assign(c.kick, { speed: r.kick.speed, sideSpin: r.kick.side, topSpin: r.kick.top, elevation: 15 });
    c.wall.count = r.wall; c.keeper.level = r.keeper;
    delete c.ballId;
    if (r.keeperPos) c.keeper.pos = r.keeperPos; else delete c.keeper.pos;
    if (r.keeperRooted) c.keeper.rooted = true; else delete c.keeper.rooted;   // documented as not moving
    delete c.aero;
    A.aimAt(r.target.y, r.target.z);
    const seed = seedForGoal(c);
    if (seed !== null) { c.seed = seed; A.configChanged(); }
    A.sides = k.kits || null;
    A.tags = [{ who: 'taker', text: k.facts.player }, { who: 'keeper', text: k.facts.goalkeeper }];
    if (k.wallNames) k.wallNames.forEach((n, i) => A.tags.push({ who: 'wall' + i, text: n }));
    k._seedOk = seed !== null;
    if (!quietLoad) A.toast(`${k.facts.player} v ${k.facts.opponent} (${k.facts.date.slice(0, 4)}): recreation loaded`);
  }

  window.FKLabs = { open, load };
  // #lab=ball|exp|history|story (&kickid=messi-2019) opens a section directly — handy for links and screenshots
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('kickid')) kickSel = h.get('kickid');
  if (h.get('lab')) setTimeout(() => {
    open(h.get('lab'));
    if (h.has('compare') && h.get('lab') === 'ball') compare();
    if (h.get('exp')) { expSel = h.get('exp'); open('exp'); const b = [...document.querySelectorAll('#labBody .btnrow button.primary')][0]; if (b) b.click(); }
  }, 300);
})();
