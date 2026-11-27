/*
 * Free Kick Simulator — the labs: Ball Laboratory and the historical exhibition.
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
    // a section lives in a panel: opening one brings the panels back if they were hidden
    if (mode !== 'play' && A.setPanels) A.setPanels(true);
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    document.body.classList.toggle('lab-open', mode !== 'play');
    A.extraRibbons.length = 0;
    body.innerHTML = '';
    if (mode !== 'story' && window.FKStory) window.FKStory.stop();
    if (mode === 'ball') ballLab();
    else if (mode === 'history') exhibition();
    else if (mode === 'story') window.FKStory && window.FKStory.panel(body, title);
    drawer.hidden = mode === 'play';
  }
  // any tab (Play too) brings hidden panels back, so a click on a section always shows something
  $('modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { if (A.setPanels) A.setPanels(true); open(b.dataset.mode); b.blur(); } });
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

  // ───────────── Ball lab ─────────────
  // The balls you can play with, explained in plain words; the wind-tunnel detail sits under "The science".
  const LAB_BALLS = [
    { id: 'engine', name: 'Classic', year: '32 panels', colour: '#3987e5',
      line: 'Stitched seams roughen the air around it early, so it flies the most predictably: what you aim is what you get.' },
    { id: 'jabulani', name: 'Jabulani', year: '2010', colour: '#e5713a',
      line: 'Smooth and nearly seamless. It stays "draggy" until very high speed, and hit without spin it wobbles and swerves late: the keeper\'s nightmare.' },
    { id: 'trionda', name: 'Trionda', year: '2026', colour: '#2fa36b',
      line: 'Deep seams and grooves make it the "roughest" modern ball in the wind tunnel: very steady, but with the most drag at speed, so a hard-hit ball dies sooner and drops short.' },
    { id: 'euro24', name: 'Fussballliebe', year: 'Euro 2024', colour: '#d8a21c',
      line: 'Flies with the Al Rihla\'s measurements (the closest tested design): the steadiest of all, so a no-spin strike hardly wobbles.' },
    { id: 'ucl', name: 'UCL starball', year: 'Champions League', colour: '#c7472a',
      line: 'No wind-tunnel data has been published for any Champions League ball, so it flies like the Classic.' },
  ];
  let ballSel = 'jabulani';
  const orient = 'A';
  const aeroOf = (id) => Object.assign({}, FK.AERO_DEFAULT, FKBalls.aeroFor(id, orient, FK.AERO_DEFAULT) || {});
  const inPlay = (id) => (A.cfg.ballId || 'engine') === id;
  function ballLab() {
    title.textContent = 'Ball lab';
    body.append(el('p', { class: 'lead' }, 'Same kick, different ball, different flight. Pick a ball to see how it behaves, then race them all with your current kick.'));
    const list = el('div', { class: 'balllist three' });
    for (const lb of LAB_BALLS) {
      list.append(el('button', { class: lb.id === ballSel ? 'on' : '', on: { click: () => { ballSel = lb.id; open('ball'); } } },
        el('b', {}, el('i', { class: 'sw', style: `background:${lb.colour}` }), lb.name), el('small', {}, inPlay(lb.id) ? 'in play' : lb.year)));
    }
    body.append(list);
    const lb = LAB_BALLS.find((x) => x.id === ballSel), ap = aeroOf(lb.id), atm = A.sim.atm;
    // three plain meters, each scaled against the most extreme of the balls
    const vSlip = FKBalls.speedAtRe(ap.reCrit, atm.rho, atm.mu) * 3.6;
    const Re30 = atm.rho * 30 * 0.22 / atm.mu, cd30 = FK.dragCoefficient(Re30, 0, ap);
    const meter = (label, frac, value, hint) => el('div', { class: 'meter' },
      el('div', { class: 'meter-top' }, el('span', {}, label), el('b', {}, value)),
      el('div', { class: 'meter-bar' }, el('i', { style: `width:${Math.round(Math.max(0.06, Math.min(1, frac)) * 100)}%;background:${lb.colour}` })),
      el('small', {}, hint));
    body.append(el('div', { class: 'card ballcard' },
      el('h3', {}, lb.name),
      el('p', {}, lb.line),
      meter('Wobble on a no-spin kick', ap.knCl / 0.27, ap.knCl > 0.2 ? 'Wild' : 'Normal', 'How far a knuckleball dances about on its way to goal.'),
      meter('Air resistance at shot speed', cd30 / 0.3, cd30 > 0.2 ? 'High' : 'Low', 'At 108 km/h: higher means the ball slows and drops sooner.'),
      meter('Turns "slippery" above', vSlip / 140, `${vSlip.toFixed(0)} km/h`, 'Above this speed the air grips the ball less (the drag crisis).')));
    body.append(el('div', { class: 'btnrow' },
      el('button', { class: 'primary', on: { click: () => { useBall(lb.id); A.toast(`Now playing with the ${lb.name}`); open('ball'); } } }, inPlay(lb.id) ? 'In play ✓' : 'Play with this ball'),
      el('button', { on: { click: () => race() } }, 'Race them all'),
      window.FKShowcase ? el('button', { on: { click: () => { FKShowcase.open(); FKShowcase.select(lb.id); } } }, 'See it up close') : null));
    const out = el('div', { id: 'ballCompare' }); body.append(out);

    // the technical detail, for anyone who wants it
    const sci = el('details', { class: 'science' }, el('summary', {}, 'The science (wind-tunnel data)'));
    sci.append(el('p', {}, 'A ball\'s drag drops sharply above a certain speed, when the air hugging its surface turns turbulent and lets go of the ball later (the "drag crisis"). Panels and surface texture move that speed. The Jabulani\'s comes right in the middle of a free kick\'s speed range, so it slows unevenly.'));
    const c = el('canvas', { width: 300, height: 150 });
    sci.append(el('div', { class: 'chart-title' }, 'Drag coefficient against air speed (no spin)'), c);
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const X = (v) => 28 + (v / 40) * (W - 36), Y = (cd) => H - 18 - (cd / 0.4) * (H - 28);
    g.fillStyle = cv('--muted'); g.font = '10px system-ui';
    for (const v of [0, 10, 20, 30, 40]) g.fillText(`${v}`, X(v) - 4, H - 4);
    for (const cd of [0.1, 0.2, 0.3]) { g.fillText(cd.toFixed(1), 2, Y(cd) + 3); g.strokeStyle = cv('--grid'); g.beginPath(); g.moveTo(28, Y(cd)); g.lineTo(W - 6, Y(cd)); g.stroke(); }
    for (const bb of LAB_BALLS) {
      const aero = aeroOf(bb.id);
      g.strokeStyle = bb.colour; g.lineWidth = bb.id === ballSel ? 2.5 : 1.2; g.beginPath();
      for (let v = 1; v <= 40; v += 0.5) { const Re = atm.rho * v * 0.22 / atm.mu; const cd = FK.dragCoefficient(Re, 0, aero); v === 1 ? g.moveTo(X(v), Y(cd)) : g.lineTo(X(v), Y(cd)); }
      g.stroke();
    }
    g.fillStyle = cv('--text'); g.fillText('m/s', W - 24, H - 4);
    sci.append(el('div', { class: 'legend' }, ...LAB_BALLS.map((bb) => el('span', {}, el('i', { class: 'sw', style: `background:${bb.colour}` }), bb.name))));
    const jb = FKBalls.BALLS.find((x) => x.id === 'jabulani'), en = FKBalls.BALLS.find((x) => x.id === 'engine');
    sci.append(el('p', { class: 'src' }, 'Jabulani: measured, ', sourceLink(jb.source), '. Classic and Trionda: the engine\'s fit after ', sourceLink(en.source), '. The extra Jabulani wobble is a model value, not a measurement.'));
    body.append(sci);
  }
  /** Put a ball into play: its aerodynamics and its look. */
  function useBall(id) {
    const aero = FKBalls.aeroFor(id, orient, FK.AERO_DEFAULT);
    if (aero) A.cfg.aero = aero; else delete A.cfg.aero;
    if (id === 'engine') delete A.cfg.ballId; else A.cfg.ballId = id;
    A.configChanged();
  }
  /** The same kick (same seed, so the same air for every ball) with each of the balls, drawn on the pitch. */
  function race() {
    const knuckle = Math.hypot(A.cfg.kick.sideSpin, A.cfg.kick.topSpin) < 1;
    const items = LAB_BALLS.map((lb) => {
      const c = FK.cloneConfig(A.cfg);
      const aero = FKBalls.aeroFor(lb.id, orient, FK.AERO_DEFAULT);
      if (aero) c.aero = aero; else delete c.aero;
      return { label: lb.name, cfg: c, opts: knuckle ? { knuckle: true } : null };
    });
    const runs = runFlights(items);
    runs.forEach((r, i) => { r.color = LAB_BALLS[i].colour; });
    showRuns(runs);
    const out = $('ballCompare'); out.innerHTML = '';
    out.append(el('h4', {}, 'The race: your kick with each ball'));
    const rows = el('div', { class: 'race' });
    for (const r of runs) {
      const x = r.f.crossing;
      rows.append(el('div', {}, el('i', { class: 'sw', style: `background:${r.color}` }), el('b', {}, r.label),
        el('span', {}, x ? `${x.t.toFixed(2)} s to the line · ${x.z.toFixed(2)} m high · ${Math.abs(x.y).toFixed(2)} m ${x.y >= 0 ? 'right' : 'left'} of centre` : 'does not reach the goal')));
    }
    out.append(rows);
    const xs = runs.map((r) => r.f.crossing).filter(Boolean);
    if (xs.length > 1) {
      const dz = Math.max(...xs.map((x) => x.z)) - Math.min(...xs.map((x) => x.z));
      const dy = Math.max(...xs.map((x) => x.y)) - Math.min(...xs.map((x) => x.y));
      out.append(el('p', { class: 'hint' }, `Same boot, same strike: the balls arrive up to ${(dz * 100).toFixed(0)} cm apart in height and ${(dy * 100).toFixed(0)} cm apart sideways.` +
        (knuckle ? ' Your kick has almost no spin, so the Jabulani\'s wobble shows.' : ' Try the Knuckleball preset to see the Jabulani wobble.')));
    }
    out.append(el('p', { class: 'hint' }, 'The paths are drawn on the pitch in the balls\' colours. The UCL starball has no published wind-tunnel data and flies like the Classic, so its path lies on top of the Classic\'s.'));
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
        el('button', { on: { click: () => { load(k); A.setCam('broadcast'); A.play(); } } }, 'TV view'),
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
    if (r.aim) { c.kick.azimuth = r.aim.azimuth; c.kick.elevation = r.aim.elevation; A.syncControls(); A.configChanged(); }   // set by eye
    else A.aimAt(r.target.y, r.target.z);
    const seed = seedForGoal(c);
    if (seed !== null) { c.seed = seed; A.configChanged(); }
    A.sides = k.kits || null;
    A.tags = [{ who: 'taker', text: k.facts.player }, { who: 'keeper', text: k.facts.goalkeeper }];
    if (k.wallNames) k.wallNames.forEach((n, i) => A.tags.push({ who: 'wall' + i, text: n }));
    A.layoff = r.layoff || null;
    if (r.layoff) A.tags.push({ who: 'support', text: r.layoff.name });
    k._seedOk = seed !== null;
    if (!quietLoad) A.toast(`${k.facts.player} v ${k.facts.opponent} (${k.facts.date.slice(0, 4)}): recreation loaded`);
  }

  window.FKLabs = { open, load };
  // #lab=ball|history|story (&kickid=messi-2019) opens a section directly — handy for links and screenshots
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('kickid')) kickSel = h.get('kickid');
  if (h.get('lab')) setTimeout(() => {
    open(h.get('lab'));
    if (h.has('compare') && h.get('lab') === 'ball') race();
  }, 300);
})();
