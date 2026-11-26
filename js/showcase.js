/*
 * Free Kick Simulator — the ball showcase. The Trionda spins as the logo (top left); clicking it opens a card where
 * the ball grows out of the logo into a large 3-D view (drag to turn it), with tabs for other World Cup balls,
 * a few facts about each, and a button to play with it.
 */
(function () {
  'use strict';
  const A = window.FKApp;
  if (!A || !window.FKBallView) return;
  const $ = (id) => document.getElementById(id);

  // facts from Adidas/FIFA launch material and the wind-tunnel study the Ball lab cites (Hong & Asai, 2014)
  const SHOW = [
    { id: 'trionda', name: 'Trionda', meta: 'FIFA World Cup 2026 · Canada, Mexico, USA', facts: [
      'Only four panels: the fewest of any World Cup ball, bonded with heat instead of stitched.',
      'The name joins "tri" and "onda" (three and wave): one wave for each host nation.',
      'Red, green and blue for the hosts, with a maple leaf for Canada, an eagle for Mexico and a star for the USA.',
      'A 500 Hz motion sensor in a side panel reports every touch to the video referee. Counterweights in the other panels keep it balanced.',
      'Raised and pressed-in surface details give grip and a steadier flight.'] },
    { id: 'jabulani', name: 'Jabulani', meta: 'FIFA World Cup 2010 · South Africa', facts: [
      '"Jabulani" means "to celebrate" in isiZulu.',
      'Eight panels moulded into curves, with fine grooves meant to steady its flight.',
      'Eleven colours: one per player in a team, and for South Africa\'s 11 official languages.',
      'Goalkeepers hated it: its drag crisis falls right at typical shot speeds, so long shots wobbled and dipped.',
      'In the wind tunnel it was also the most sensitive to which way its panels faced the air.',
      'Here too: hit it with almost no spin (Knuckleball) and it wobbles about twice as far as the other balls, and swerves late as it slows.'] },
    { id: 'engine', name: 'Classic', meta: '32 panels · the Telstar pattern, 1970', facts: [
      '12 black pentagons and 20 white hexagons: a truncated icosahedron.',
      'Black and white so it showed up on black-and-white television at the 1970 World Cup.',
      'Stitched seams trip the air into turbulence early, which keeps its flight steady.'] },
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

  const box = $('ballShow'), card = box.querySelector('.bs-card'), cv = $('bsCanvas');
  let big = null, cur = 'trionda';
  const tabs = $('bsTabs');
  for (const b of SHOW) {
    const t = document.createElement('button'); t.textContent = b.name; t.dataset.ball = b.id; t.setAttribute('role', 'tab');
    t.addEventListener('click', () => select(b.id));
    tabs.append(t);
  }
  function inPlay() { return A.cfg.ballId || 'engine'; }
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
    $('bsMeta').textContent = b.meta; $('bsName').textContent = b.name;
    const ul = $('bsFacts'); ul.innerHTML = '';
    b.facts.forEach((f, i) => { const li = document.createElement('li'); li.textContent = f; li.style.animationDelay = (0.06 * i + 0.05) + 's'; ul.append(li); });
    const using = inPlay() === id;
    $('bsUse').hidden = using; $('bsUsing').hidden = !using;
  }
  function open() {
    if (!box.hidden) return;
    box.hidden = false;
    if (!big) {
      big = new FKBallView.BallView(cv, { spin: 0.35, zoom: 2.5, interactive: true,
        onSpin: (d, s) => window.FKSound && FKSound.spin(d, s) });     // satisfying clicks as you turn it
    }
    select(SHOW.some((b) => b.id === inPlay()) ? inPlay() : 'trionda');
    big.yaw = logo.yaw; big.pitch = logo.pitch; big.start();
    // the ball grows out of the logo: start the big canvas over the logo, then let it settle into place
    const from = $('logoCanvas').getBoundingClientRect(), to = cv.getBoundingClientRect();
    const sx = from.width / to.width, sy = from.height / to.height;
    cv.style.transition = 'none';
    cv.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
    cv.style.transformOrigin = '0 0';
    box.classList.remove('shown');
    void cv.offsetWidth;
    requestAnimationFrame(() => { cv.style.transition = ''; cv.style.transform = ''; box.classList.add('shown'); });
  }
  function close() {
    if (box.hidden) return;
    const from = $('logoCanvas').getBoundingClientRect(), to = cv.getBoundingClientRect();
    cv.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    box.classList.remove('shown');
    setTimeout(() => { box.hidden = true; cv.style.transform = ''; if (big) big.stop(); }, 420);
  }
  $('logoBall').addEventListener('click', (e) => { open(); e.currentTarget.blur(); });
  $('bsClose').addEventListener('click', close);
  box.querySelector('.bs-backdrop').addEventListener('click', close);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) { close(); e.stopPropagation(); } });
  $('bsUse').addEventListener('click', () => {
    const aero = FKBalls.aeroFor(cur, 'A', FK.AERO_DEFAULT);
    if (aero) A.cfg.aero = aero; else delete A.cfg.aero;
    if (cur === 'engine') delete A.cfg.ballId; else A.cfg.ballId = cur;
    A.configChanged(); select(cur);
    A.toast(`Now playing with the ${SHOW.find((x) => x.id === cur).name}`);
  });
  window.FKShowcase = { open, close, select, get view() { return big; } };
})();
