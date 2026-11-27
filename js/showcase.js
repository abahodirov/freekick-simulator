/*
 * Free Kick Simulator — the ball showcase. The ball in play spins as the logo (top left); clicking it opens a card
 * where the ball grows out of the logo into the middle of a map: its facts sit around it on leader lines, and
 * clicking one opens a photograph of that ball with the story behind it
 * (the pictures are real photographs from Wikimedia Commons, credited under each one).
 * Hovering or clicking the ball shows "Anatomy": the ball comes apart into its real panels around its core, the facts
 * become what each part does, and "Back to the ball" puts it together again. Tabs switch balls; a button plays with one.
 *
 * Facts: adidas/FIFA/UEFA launch material; the wind tunnel: Hong & Asai (2014) Sci. Rep. 4:5068, the 2026 Trionda
 * study in Scientific Reports (Trionda, Al Rihla, Telstar 18, Brazuca), and Goff, Hong, Liu & Asai (2026) Applied
 * Sciences 16:2808 (Trionda seams).
 */
(function () {
  'use strict';
  const A = window.FKApp;
  if (!A || !window.FKBallView) return;
  const $ = (id) => document.getElementById(id);

  // t: the fact's title, x: one line on the map, more: the story with the picture
  const SHOW = [
    { id: 'trionda', name: 'Trionda', meta: 'FIFA World Cup 2026 · Canada, Mexico, USA', photos: [
        { file: 'FIFA World Cup 2026 Draw Reception (54972841852).jpg', by: 'UK in USA', lic: 'CC BY-SA 4.0', cap: 'The Trionda at the World Cup draw in Washington, December 2025' },
        { file: 'France v Senegal 16 June 2026-443.jpg', by: 'Bryan Berlin', lic: 'CC BY-SA 4.0', cap: 'The Trionda on the pitch at France v Senegal, 16 June 2026' },
        { file: 'Lionel Messi Argentina v Egypt 7 July 2026-250.jpg', by: 'Bryan Berlin', lic: 'CC BY-SA 4.0', cap: 'Lionel Messi strikes the Trionda, Argentina v Egypt, 7 July 2026' },
        { file: 'Jonathan David Canada v Qatar 18 June 2026-180.jpg', by: 'Bryan Berlin', lic: 'CC BY-SA 4.0', cap: 'Jonathan David shoots, Canada v Qatar, 18 June 2026' },
        { local: 'assets/showcase/trionda-sensor.webp', by: 'adidas', lic: 'supplied by the project owner', cap: 'The Trionda\'s sensor module, lifted out of its panel' }],
      facts: [
        { ph: 0, t: 'Four panels', x: 'The fewest of any World Cup ball, bonded with heat.', more: 'Only four panels: the fewest of any World Cup ball, bonded with heat and adhesive instead of being stitched.' },
        { ph: 1, t: 'Three waves', x: '"Tri" + "onda": a wave for each host.', more: 'The name joins "tri" and "onda" (three and wave): red, green and blue for the three hosts, with a maple leaf for Canada, an eagle for Mexico and a star for the USA.' },
        { ph: 2, t: 'Earliest drag crisis', x: 'Its drag drops at about 43 km/h.', more: 'In the wind tunnel its drag crisis comes at about 43 km/h (critical Reynolds number ≈ 1.78 × 10⁵), the lowest of the recent World Cup balls: Al Rihla, Telstar 18 and Brazuca reach theirs at 50–65 km/h.' },
        { ph: 3, t: 'Dies sooner', x: 'Most drag at speed: long kicks drop short.', more: 'Above its drag crisis it has the most drag of the balls tested (Cd ≈ 0.22), so a hard, long kick slows sooner and comes up a few metres short. You can feel it here: the same kick arrives lower than with the Classic.' },
        { ph: 4, t: 'A sensor in a panel', x: '500 Hz, with counterweights opposite.', more: 'A 500 Hz motion sensor sits in a layer inside one panel, with counterweights in the other three, and reports every touch to the video referee and the semi-automated offside system.' },
      ],
      anatomy: [
        { t: '4 panels', x: 'Thermally bonded: no stitches.' },
        { t: 'Deep seams', x: '2.50 m of seams, 5.1 mm wide, 1.3 mm deep.' },
        { t: 'Grooves', x: 'Three pressed into every panel.' },
      ] },
    { id: 'euro24', name: 'Fussballliebe', meta: 'UEFA Euro 2024 · Germany', photos: [
        { file: 'UEFA Euro 2024 Match Ball Fussballliebe.jpg', by: 'Bildersindtoll', lic: 'CC0', cap: 'A replica of the Fussballliebe' },
        { local: 'assets/showcase/euro-bellingham.webp', by: 'unknown', lic: 'supplied by the project owner', cap: 'Jude Bellingham with the Fussballliebe', pos: '50% 40%', ar: '5 / 6' },
        { local: 'assets/showcase/euro-yamal-2024.webp', by: 'unknown', lic: 'supplied by the project owner', cap: 'Lamine Yamal shoots for Spain against France, Euro 2024 semi-final, Munich', pos: '50% 18%' },
        { local: 'assets/showcase/euro-musiala.webp', by: 'unknown', lic: 'supplied by the project owner', cap: 'Jamal Musiala with the Fussballliebe, Germany v Ukraine, June 2024', pos: '72% 50%' }],
      facts: [
        { ph: 1, t: 'Love of football', x: 'That is what "Fussballliebe" means.', more: '"Fussballliebe" is German for "love of football". Toni Kroos played his last tournament with it, at home in Germany.' },
        { ph: 0, t: 'Ten host cities', x: 'Each city\'s stadium is drawn on a panel.', more: 'Berlin, Cologne, Dortmund, Düsseldorf, Frankfurt, Gelsenkirchen, Hamburg, Leipzig, Munich and Stuttgart: their names and stadium outlines are printed on the panels.' },
        { ph: 2, t: 'Connected ball', x: 'A sensor told the referees about every touch.', more: 'A motion sensor inside reported every touch to the video referees, for offsides and handballs.' },
        { ph: 3, t: 'Steadiest flight', x: 'A no-spin strike hardly wobbles.', more: 'Its own wind-tunnel figures have not been published, so here it flies with those of the Al Rihla (2022), the closest published design: the smallest knuckling forces of the balls tested. Hit it with no spin and it barely wobbles.' },
      ],
      anatomy: [
        { t: '20 panels', x: 'Twelve large shapes and eight triangles.' },
        { t: 'Pressed-in rings', x: 'They steer the air for a steadier flight.' },
        { t: 'Sensor', x: 'Reports every touch to the referees.' },
      ] },
    { id: 'ucl', name: 'UCL starball', meta: 'UEFA Champions League', photos: [
        { file: 'FC Salzburg gegen Paris Saint-Germain UEFA Champions League 10.jpg', by: 'Werner100359', lic: 'CC BY-SA 4.0', cap: 'The 2024–25 match ball before Salzburg v Paris Saint-Germain, 10 December 2024' },
        { local: 'assets/showcase/ucl-zidane-2002.webp', by: 'unknown', lic: 'supplied by the project owner', cap: "Zinedine Zidane's volley in the 2002 final, Glasgow", pos: '50% 18%' },
        { local: 'assets/showcase/ucl-messi-2009.webp', by: 'unknown', lic: 'supplied by the project owner', cap: 'Lionel Messi heads in the 2009 final, Rome', pos: '50% 4%' },
        { local: 'assets/showcase/ucl-bale-2018.webp', by: 'unknown', lic: 'supplied by the project owner', cap: "Gareth Bale's overhead kick in the 2018 final, Kyiv", pos: '50% 10%' }],
      facts: [
        { ph: 3, t: 'The starball', x: 'The Champions League symbol since 1992.', more: 'Eight stars making up a ball: the starball has been the Champions League\'s symbol since the competition began in 1992.' },
        { ph: 1, t: 'Adidas since 2001', x: 'Every season\'s ball carries the stars.', more: 'Adidas has made the competition\'s match ball since 2001, each season with the stars on it in a new design.' },
        { ph: 0, t: 'Seamless', x: 'Recent balls are bonded with heat.', more: 'Recent Champions League balls are thermally bonded, with no stitched seams, around a butyl bladder.' },
        { ph: 2, t: 'No wind-tunnel data', x: 'So here it flies like the Classic.', more: 'No wind-tunnel figures have been published for any Champions League ball, so in this game it flies like the Classic rather than with invented numbers.' },
      ],
      anatomy: [
        { t: 'White panels', x: 'Twenty, with embossed outlines and red marks.' },
        { t: 'Dark stars', x: 'Twelve: each star is one panel, traced in green.' },
      ] },
    { id: 'jabulani', name: 'Jabulani', meta: 'FIFA World Cup 2010 · South Africa', photos: [
        { file: 'Various Adidas 2010 World Cup balls.JPG', by: 'BrokenSphere', lic: 'CC BY-SA 3.0', cap: 'Jabulanis on the shelf in 2010' },
        { file: 'Adidas 2010 FIFA World Cup Germany gear.JPG', by: 'BrokenSphere', lic: 'CC BY-SA 3.0', cap: "The Jabulani with Germany's 2010 kit", pos: '50% 88%' },
        { file: 'Brazil national football team training at Dobsonville Stadium 2010-06-03 6.jpg', by: 'Marcello Casal Jr / Agência Brasil', lic: 'CC BY 3.0 BR', cap: 'Brazil training with the Jabulani in Soweto, 3 June 2010' },
        { file: "Jo'bulani.jpg", by: 'warrenski', lic: 'CC BY-SA 2.0', cap: "The Jo'bulani, the gold Jabulani made for the final" }],
      facts: [
        { ph: 0, t: 'To celebrate', x: 'What "Jabulani" means in isiZulu.', more: '"Jabulani" means "to celebrate" in isiZulu.' },
        { ph: 1, t: 'Eleven colours', x: 'One per player, and for 11 official languages.', more: 'Eleven colours: one for each player in a team, and for South Africa\'s eleven official languages.' },
        { ph: 2, t: 'The keeper\'s nightmare', x: 'Its drag crisis sits at shot speeds.', more: 'Its drag crisis falls right at typical shot speeds, so long shots wobbled and dipped late. In the wind tunnel it was also the most sensitive to which way its panels faced the air.' },
        { ph: 3, t: 'Feel it here', x: 'No-spin strikes wobble about twice as far.', more: 'Hit it with almost no spin (the Knuckleball preset) and it wobbles about twice as far as the other balls, and swerves late as it slows.' },
      ],
      anatomy: [
        { t: '8 panels', x: 'Moulded into curves, bonded with heat.' },
        { t: 'Grip\'n\'Groove', x: 'Fine ridges meant to steady it.' },
        { t: 'Smooth', x: 'Few, shallow seams: a late drag crisis.' },
      ] },
    { id: 'engine', name: 'Classic', meta: '32 panels · the Telstar pattern, 1970', photos: [
        { file: 'Adidas Telstar Mexico 1970 Official ball.jpg', by: 'Zac Allan', lic: 'Public domain', cap: 'The Telstar, ball of the 1970 World Cup' },
        { file: 'Berlin-Adidas World of Football 2.JPG', by: 'Times', lic: 'CC BY-SA 3.0', cap: 'Giant Telstar balls in Berlin, 2006' },
        { file: 'Eröffnung des Rapideums - 10 - Ball vom Weltcup 1974.jpg', by: 'Haeferl', lic: 'CC BY-SA 3.0', cap: 'The Telstar Durlast, ball of the 1974 World Cup' }],
      facts: [
        { ph: 0, t: 'A truncated icosahedron', x: '12 pentagons and 20 hexagons.', more: '12 black pentagons and 20 white hexagons: the shape mathematicians call a truncated icosahedron.' },
        { ph: 1, t: 'Made for TV', x: 'Black and white for black-and-white sets.', more: 'Black and white so it showed up on black-and-white television at the 1970 World Cup.' },
        { ph: 2, t: 'Steady', x: 'Stitched seams trip the air early.', more: 'Stitched seams trip the air into turbulence early, which keeps its flight steady.' },
        { ph: -1, t: 'The reference', x: 'Every other ball is compared with it.', more: 'In this game its drag is the engine\'s measured fit (Goff & Carré, 2009): the other balls are measured against it.' },
      ],
      anatomy: [
        { t: '32 panels', x: '12 pentagons and 20 hexagons, stitched.' },
        { t: 'Stitched seams', x: 'Deep grooves: an early drag crisis.' },
        { t: 'Bladder', x: 'Latex or butyl, inside the carcass.' },
      ] },
  ];

  // the Trionda is the ball in play unless something else was chosen
  if (!A.cfg.ballId) { A.cfg.ballId = 'trionda'; A.configChanged(); }
  // a ball chosen another way (#ball=…) still flies with its own aerodynamics
  else if (!A.cfg.aero && window.FKBalls) { const a = FKBalls.aeroFor(A.cfg.ballId, 'A', FK.AERO_DEFAULT); if (a) { A.cfg.aero = a; A.configChanged(); } }

  // (if the logo's own 3-D view cannot start, the showcase still works around a stand-in)
  let logo;
  try { logo = new FKBallView.BallView($('logoCanvas'), { spin: 0.9, zoom: 3.1 }); }
  catch (e) { logo = { ball: null, yaw: 0.6, pitch: 0.35, models: {}, setBall(id) { this.ball = id; }, start() {}, stop() {} }; }
  logo.setBall(SHOW.some((b) => b.id === (A.cfg.ballId || 'engine')) ? (A.cfg.ballId || 'engine') : 'trionda'); logo.start();
  // real 3-D models (converted with tools/ball_model.js and listed in assets/balls/manifest.js) replace the patterns
  for (const id of window.FKBallManifest || []) {
    const s = document.createElement('script'); s.src = `assets/balls/${id}.js`;
    s.onload = () => { for (const v of [logo, big]) if (v) delete v.models[id]; };
    document.head.append(s);
  }

  const box = $('ballShow'), card = box.querySelector('.bs-card'), cv = $('bsCanvas'), map = $('bsMap'), stage = $('bsStage');
  const callouts = $('bsCallouts'), lines = $('bsLines'), detail = $('bsDetail');
  let big = null, cur = 'trionda', anatomy = false;
  const tabs = $('bsTabs');
  for (const b of SHOW) {
    const t = document.createElement('button'); t.textContent = b.name; t.dataset.ball = b.id; t.setAttribute('role', 'tab');
    t.addEventListener('click', () => select(b.id));
    tabs.append(t);
  }
  function inPlay() { return A.cfg.ballId || 'engine'; }

  // ── the map: callouts around the ball, on leader lines to points on its edge ──
  // each ball's aurora: four colours that drift behind the map (CSS custom properties, eased from ball to ball)
  const AURORA = {
    trionda: ['#e0313b', '#1fa65a', '#2f6fe0', '#f2c14e'], euro24: ['#e8b021', '#d8342c', '#3a4cc0', '#25a35a'],
    ucl: ['#5fd35a', '#2c3330', '#e8e8e8', '#e2412f'], jabulani: ['#f4c21c', '#2aa56d', '#2a6fd6', '#d9412e'],
    engine: ['#c9ccd4', '#5b6a8a', '#8a93a6', '#2f4f8f'],
  };
  // the living background behind the card (React Bits' Aurora and Plasma, js/backdrop.js), in the ball's colours
  const BG = {
    trionda: { kind: 'aurora', stops: ['#e0313b', '#1fa65a', '#2f6fe0'] }, euro24: { kind: 'aurora', stops: ['#e8b021', '#d8342c', '#3a4cc0'] },
    jabulani: { kind: 'aurora', stops: ['#f4c21c', '#2aa56d', '#2a6fd6'] }, ucl: { kind: 'plasma', color: '#5fd35a' },
    engine: { kind: 'aurora', stops: ['#e9e9ef', '#7d88a6', '#2f3a5e'] },
  };
  let backdrop = null;
  try { backdrop = window.FKBackdrop ? FKBackdrop.create(card.querySelector('.bs-aurora')) : null; } catch (e) { backdrop = null; }
  function setAurora(id) {
    (AURORA[id] || AURORA.engine).forEach((c, i) => card.style.setProperty('--a' + (i + 1), c));
    if (backdrop) backdrop.set(BG[id] || BG.engine);
  }

  // ── the map: glass pills around the ball, each on a leader line to the ball's edge ──
  // The pills are placed once per ball and mode; the lines are redrawn every frame from the ball's size on screen,
  // so they travel with the panels as the ball comes apart instead of being left behind.
  let pills = [], shownAt = 0, swapTimer = 0;
  function renderCallouts() {
    const old = [...callouts.children];
    clearTimeout(swapTimer);
    if (old.length) {                                   // the old pills drift out first, then the new ones float in
      old.forEach((el, i) => { el.classList.add('leaving'); el.style.animationDelay = (0.025 * i) + 's'; });
      lines.classList.add('leaving');
      swapTimer = setTimeout(build, 230);
    } else build();
  }
  function build() {
    const b = SHOW.find((x) => x.id === cur), list = anatomy ? b.anatomy : b.facts;
    callouts.innerHTML = ''; lines.innerHTML = ''; lines.classList.remove('leaving');
    callouts.classList.toggle('anat', anatomy);
    pills = list.map((f, i) => {
      const el = document.createElement(anatomy ? 'div' : 'button');
      el.className = 'bs-call'; el.style.animationDelay = (0.07 * i + 0.05) + 's';
      if (!anatomy) { el.type = 'button'; el.addEventListener('click', () => showDetail(b, f)); }
      const t = document.createElement('b'); t.textContent = f.t;
      const x = document.createElement('span'); x.textContent = f.x;
      el.append(t, x);
      callouts.append(el);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); d.setAttribute('r', 3.2);
      lines.append(p, d);
      return { el, p, d, i, x: 0, y: 0, w: 0, h: 0, left: true };
    });
    shownAt = performance.now();
    requestAnimationFrame(layout);
  }
  /** The ball's box in the map where it rests (offsets ignore the grow-from-the-logo transform, which made pills
   *  placed during the opening land beside the logo instead of beside the ball). */
  function restBox() {
    const w = cv.offsetWidth, h = cv.offsetHeight;
    return { width: w, height: h, cx: stage.offsetLeft + cv.offsetLeft + w / 2, cy: stage.offsetTop + cv.offsetTop + h / 2 };
  }
  /** Place the pills in two columns beside the ball (the lines follow every frame, in tick()). */
  function layout() {
    const mr = map.getBoundingClientRect(), cr = restBox();
    if (!mr.width || !cr.width) return;
    const narrow = mr.width < 760;
    map.classList.toggle('narrow', narrow);
    if (narrow) { pills.forEach((q) => { q.el.style.left = q.el.style.top = q.el.style.width = ''; }); return; }
    lines.setAttribute('viewBox', `0 0 ${mr.width} ${mr.height}`);
    const cx = cr.cx, R0 = cr.width / 2 * 2.5 / 3.2;
    const nL = Math.ceil(pills.length / 2), nR = pills.length - nL, colW = Math.max(180, Math.min(270, (mr.width - cr.width) / 2 - 40));
    pills.forEach((q, i) => {
      const left = i < nL, k = left ? i : i - nL, n = left ? nL : nR;
      const fy = n === 1 ? 0.5 : 0.17 + 0.66 * k / (n - 1);
      q.el.style.width = colW + 'px';
      const h = q.el.offsetHeight, y = Math.max(4, Math.min(mr.height - h - 4, fy * mr.height - h / 2));
      // the columns bow round the ball: the middle pills sit a little further out than the top and bottom ones
      const bow = (1 - Math.pow(2 * fy - 1, 2)) * 26;
      const x = left ? Math.max(8, cx - R0 - 90 - colW - bow) : Math.min(mr.width - colW - 8, cx + R0 + 90 + bow);
      q.el.style.left = x + 'px'; q.el.style.top = y + 'px';
      Object.assign(q, { x, y, w: colW, h, left });
    });
  }
  // the lines, every frame: from the pill's inner end, a short level run, then a smooth curve to the ball's edge
  // (the edge grows and shrinks with the ball as it comes apart); each line draws itself in after its pill appears
  const ease = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
  function tick(now) {
    if (box.hidden) return;
    requestAnimationFrame(tick);
    if (!pills.length || !big) return;
    // (the card and the ball are still growing in the first moments: keep placing the pills until they settle)
    if (now - shownAt < 1200 || !pills[0].w || !pills[0].el.style.left) layout();
    if (map.classList.contains('narrow')) return;
    const cr = restBox();
    if (!cr.width) return;
    const cx = cr.cx, cy = cr.cy;
    const ex = Math.max(0, big.explode), z = big.zoom / (1 + 0.5 * ex);
    const R = cr.width / 2 * z / 3.2 * (1 + 0.3 * ex);           // the edge of the ball, or of its cloud of panels
    for (const q of pills) {
      const ey = q.y + q.h / 2, sx = q.left ? q.x + q.w - 6 : q.x + 6;
      const ang = Math.asin(Math.max(-0.8, Math.min(0.8, (ey - cy) / R)));
      const px = cx + (q.left ? -1 : 1) * R * Math.cos(ang) * 0.97, py = cy + R * Math.sin(ang) * 0.97;
      const mx = q.left ? Math.min(px - 24, sx + 70) : Math.max(px + 24, sx - 70);
      // a straight level run from the pill, then one straight leg to the point (a technical callout, as in a cutaway)
      q.p.setAttribute('d', `M${sx.toFixed(1)},${ey.toFixed(1)} L${mx.toFixed(1)},${ey.toFixed(1)} L${px.toFixed(1)},${py.toFixed(1)}`);
      // the line draws from the pill to the ball (a slower, even ease); its point appears only when the line arrives,
      // with a small pop, so the eye follows the line onto the ball
      const t0 = now - shownAt - 260 - 110 * q.i, L = q.p.getTotalLength ? q.p.getTotalLength() : 300;
      const raw = Math.min(1, Math.max(0, t0 / 760)), u = raw * raw * (3 - 2 * raw);
      q.p.style.strokeDasharray = L; q.p.style.strokeDashoffset = L * (1 - u);
      // (the point waits until its line has fully arrived, then a short beat, before it pops in)
      const v = Math.min(1, Math.max(0, (t0 - 1050) / 320)), pop = v < 1 ? 1 + 0.6 * Math.sin(Math.PI * v) : 1;
      q.d.setAttribute('cx', px.toFixed(1)); q.d.setAttribute('cy', py.toFixed(1)); q.d.style.opacity = v;
      q.d.setAttribute('r', (3.2 * v * pop).toFixed(2));
    }
  }
  window.addEventListener('resize', () => { if (!box.hidden) layout(); });

  // ── a fact up close: the picture and the story ──
  // real photographs from Wikimedia Commons (free licences), loaded from Commons and credited under the picture
  const photoUrl = (file) => 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file.replace(/ /g, '_')) + '?width=1600';
  const pageUrl = (file) => 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_'));
  function showDetail(b, f) {
    const ph = f.ph >= 0 ? b.photos[f.ph] : null, img = $('bsImg'), capEl = $('bsCap');
    detail.classList.toggle('nophoto', !ph);
    $('bsDKick').textContent = b.name; $('bsDTitle').textContent = f.t; $('bsDText').textContent = f.more || f.x;
    if (!ph) { img.removeAttribute('src'); capEl.textContent = ''; detail.hidden = false; requestAnimationFrame(() => detail.classList.add('shown')); if (window.FKSound) FKSound.ui('open'); return; }
    img.classList.remove('loaded'); img.onload = () => img.classList.add('loaded'); img.onerror = () => img.classList.add('failed');
    img.src = ph.local || photoUrl(ph.file); img.alt = ph.cap;
    img.style.objectPosition = ph.pos || '50% 40%';            // (the crop keeps the faces and the ball in the frame)
    // the frame's shape (4:3, or taller where face and ball are far apart); CSS fits it inside the panel at any size
    detail.style.setProperty('--ar', ph.ar || '4 / 3');
    { const [w, h] = (ph.ar || '4 / 3').split('/').map(Number); detail.style.setProperty('--ar-n', (w / h).toFixed(4)); }
    capEl.textContent = ph.cap;                                  // (what the photo shows; the sources are in assets/CREDITS.md)
    $('bsDKick').textContent = b.name; $('bsDTitle').textContent = f.t; $('bsDText').textContent = f.more || f.x;
    detail.hidden = false; requestAnimationFrame(() => detail.classList.add('shown'));
    if (window.FKSound) FKSound.ui('open');
  }
  function hideDetail() {
    if (detail.hidden) return;
    detail.classList.remove('shown'); setTimeout(() => { detail.hidden = true; }, 220);
  }
  $('bsDClose').addEventListener('click', hideDetail);

  // ── anatomy: the ball comes apart ──
  function setAnatomy(on) {
    if (on === anatomy) return;
    anatomy = on;
    card.classList.toggle('anatomy', on);
    if (big) big.setExplode(on ? 1 : 0);
    $('bsBack').hidden = !on;
    $('bsHint').textContent = on ? 'The ball, taken apart into its panels · drag to turn it' : 'Drag to turn · click the ball for its anatomy · click a fact for a picture';
    const b = SHOW.find((x) => x.id === cur);
    $('bsMeta').textContent = on ? 'Anatomy' : b.meta;
    renderCallouts();
    if (window.FKSound) FKSound.ui(on ? 'open' : 'close');
  }
  $('bsAnat').addEventListener('click', (e) => { setAnatomy(true); stage.classList.remove('armed'); e.currentTarget.blur(); });
  $('bsBack').addEventListener('click', (e) => { setAnatomy(false); e.currentTarget.blur(); });
  // a click on the ball (not a drag) shows the Anatomy button, as hovering does
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && !anatomy) stage.classList.toggle('armed');
    down = null;
  });

  function select(id) {
    cur = id;
    const b = SHOW.find((x) => x.id === id);
    tabs.querySelectorAll('button').forEach((t) => t.classList.toggle('on', t.dataset.ball === id));
    if (big) big.setBall(id);
    // the spinning logo becomes the ball you are looking at, with a little pop
    if (logo.ball !== id) {
      logo.setBall(id);
      const lb = $('logoBall'); lb.classList.remove('swap'); void lb.offsetWidth; lb.classList.add('swap');
    }
    $('bsMeta').textContent = anatomy ? 'Anatomy' : b.meta; $('bsName').textContent = b.name;
    setAurora(id);
    hideDetail();
    renderCallouts();
    const using = inPlay() === id;
    $('bsUse').hidden = using; $('bsUsing').hidden = !using;
  }
  function open() {
    if (!box.hidden) return;
    box.hidden = false;
    if (!big) {
      big = new FKBallView.BallView(cv, { spin: 0.35, zoom: 2.5, interactive: true,
        onSpin: (d, s) => window.FKSound && FKSound.spin(d, s) });     // a soft sound as you turn it
    }
    callouts.innerHTML = ''; pills = [];
    for (const b of SHOW) big._model(b.id);           // (every ball's maps load now, so each can come apart at once)
    anatomy = true; setAnatomy(false); big.explode = 0; big.explodeV = 0;
    select(SHOW.some((b) => b.id === inPlay()) ? inPlay() : 'trionda');
    big.yaw = logo.yaw; big.pitch = logo.pitch; big.start();
    // the logo ball becomes the big one: while the showcase is open the corner is empty (one ball on screen, never two)
    $('logoCanvas').style.visibility = 'hidden';
    if (backdrop) backdrop.start();
    requestAnimationFrame(tick);
    // the ball grows out of the logo: start the big canvas over the logo, then let it settle into place
    const from = $('logoCanvas').getBoundingClientRect(), to = cv.getBoundingClientRect();
    const sx = from.width / to.width, sy = from.height / to.height;
    cv.style.transition = 'none';
    cv.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
    cv.style.transformOrigin = '0 0';
    box.classList.remove('shown');
    void cv.offsetWidth;
    requestAnimationFrame(() => { cv.style.transition = ''; cv.style.transform = ''; box.classList.add('shown'); setTimeout(layout, 450); });
  }
  let closing = false;
  function close() {
    if (box.hidden || closing) return;
    closing = true; hideDetail();
    if (anatomy && big) big.setExplode(0);
    [...callouts.children].forEach((el, i) => { el.classList.add('leaving'); el.style.animationDelay = (0.03 * i) + 's'; });
    lines.classList.add('leaving');
    box.classList.add('closing');
    if (big) big.vy = 7;                                  // (a happy spin on the way home)
    if (window.FKSound) FKSound.ui('close');
    setTimeout(() => {
      const from = $('logoCanvas').getBoundingClientRect(), to = cv.getBoundingClientRect();
      cv.style.transition = 'transform .78s cubic-bezier(.6, -0.28, .3, 1.18)';
      cv.style.transformOrigin = '0 0';
      cv.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    }, 140);
    setTimeout(() => {
      // the flying ball lands and simply becomes the logo again: same ball, same turn, no second ball appearing
      logo.yaw = big.yaw; logo.pitch = big.pitch; if ('vy' in logo) logo.vy = big.vy;
      $('logoCanvas').style.visibility = '';
      box.hidden = true; box.classList.remove('shown', 'closing');
      cv.style.transition = 'none'; cv.style.transform = '';
      if (big) big.stop(); if (backdrop) backdrop.stop();
      closing = false;
    }, 940);
  }
  $('logoBall').addEventListener('click', (e) => { open(); e.currentTarget.blur(); });
  $('bsClose').addEventListener('click', close);
  box.querySelector('.bs-backdrop').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || box.hidden) return;
    if (!detail.hidden) hideDetail(); else if (anatomy) setAnatomy(false); else close();
    e.stopPropagation();
  });
  $('bsUse').addEventListener('click', () => {
    const aero = FKBalls.aeroFor(cur, 'A', FK.AERO_DEFAULT);
    if (aero) A.cfg.aero = aero; else delete A.cfg.aero;
    if (cur === 'engine') delete A.cfg.ballId; else A.cfg.ballId = cur;
    A.configChanged(); select(cur);
    A.toast(`Now playing with the ${SHOW.find((x) => x.id === cur).name}`);
  });
  window.FKShowcase = { open, close, select, anatomy: setAnatomy, get view() { return big; } };
})();
