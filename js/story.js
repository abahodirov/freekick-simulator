/*
 * Free Kick Simulator — "The Anatomy of a Free Kick": a cinematic, narrated walk through one kick.
 * The director only chooses cameras, playback speed and captions; every number in a caption is read from the
 * running simulation (sim.aero(), sim.forces(), sim.keeper, sim.result()) at that moment.
 *
 * Scenes: 1 setup · 2 the player · 3 the impact (slow motion + freeze) · 4 the flight (forces) ·
 *         5 the goalkeeper · 6 the conclusion.
 */
(function () {
  'use strict';
  const A = window.FKApp;
  if (!A) return;
  const $ = (id) => document.getElementById(id);
  const cap = $('caption');
  const SCENES = ['The setup', 'The player', 'The impact', 'The flight', 'The goalkeeper', 'The conclusion'];
  const st = { on: false, scene: -1, hold: 0, wait: 0, voice: false, text: true, overlays: true, lastCap: '', capT: 0 };

  function say(head, line) {
    const key = head + '|' + line;
    if (key === st.lastCap) return;
    st.lastCap = key;
    if (st.text) { cap.innerHTML = ''; const h = document.createElement('b'); h.textContent = head; const p = document.createElement('span'); p.textContent = line; cap.append(h, p); cap.hidden = false; }
    if (st.voice && 'speechSynthesis' in window) {
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(line); u.rate = 1.02; speechSynthesis.speak(u); } catch (e) { /* voice unavailable */ }
    }
  }
  const fmt = (v, d) => v.toFixed(d === undefined ? 1 : d);

  function setScene(i) {
    st.scene = i; st.hold = 0;
    document.querySelectorAll('#sceneBtns button').forEach((b, k) => b.classList.toggle('on', k === i));
  }

  function start(fromScene) {
    st.on = true; st.lastCap = '';
    document.body.classList.add('storying');            // the kick sliders step aside while the story plays
    const s = fromScene || 0;
    A.setForces(false);
    if (s <= 1) {
      A.setupAim(); A.setPaused(false);
      setScene(0); st.wait = s === 1 ? 0 : 4.5; A.setCam('broadcast'); A.setSpeed(1);
    } else {
      if (!A.lastShot) A.play();
      const t = s === 2 ? -0.35 : s === 3 ? 0.05 : s === 4 ? Math.max(0.1, flightTime() - 0.45) : flightTime();
      A.seek(t); A.setPaused(false);
      setScene(s);
      if (s === 2) { A.setCam('taker'); A.setSpeed(0.25); }
      if (s === 3) { A.setCam('follow'); A.setSpeed(0.35); if (st.overlays) A.setForces(true); }
      if (s === 4) { A.setCam('keeper'); A.setSpeed(0.25); }
      if (s === 5) finish();
    }
  }
  function stop() {
    if (!st.on) return;
    st.on = false; cap.hidden = true; A.setSpeed(1); A.setForces(false);
    document.body.classList.remove('storying');
    if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
  let ftCache = null;
  function flightTime() {
    if (!A.lastShot) return 1;
    const f = FK.simulateFlight(A.lastShot, { knuckle: false });
    ftCache = f.crossing ? f.crossing.t : 1.2;
    return ftCache;
  }

  function finish() {
    setScene(5);
    A.setSpeed(1); A.setCam('top'); A.setForces(false);
    const sim = A.sim, r = sim.result(), k = sim.cfg.kick;
    const c = r.crossing;
    const path = c
      ? `${fmt(c.speed * 3.6, 0)} km/h at the line, ${fmt(c.t, 2)} s later, bent ${fmt(Math.abs(r.curve), 1)} m`
      : sim.firstTouchT >= 0 ? `stopped after ${fmt(sim.firstTouchT, 2)} s` : `short of the line`;
    say(SCENES[5], `${r.text}. ${fmt(k.speed * 3.6, 0)} km/h off the boot, ${path}.`);
  }

  A.onFrame((dt) => {
    if (!st.on) return;
    const sim = A.sim, mode = A.mode;
    if (st.scene === 0) {
      const b = sim.cfg.ball, d = Math.hypot(b.x, b.y), atm = sim.atm;
      // (only the main facts: distance, wall, keeper, wind if any — air density and the like stay in the panels)
      void atm;
      say(SCENES[0], `${fmt(d, 0)} m from goal. A wall of ${sim.wall.length} covers the near post; the keeper shades the far side${sim.cfg.env.windSpeed ? `, with a ${fmt(sim.cfg.env.windSpeed * 3.6, 0)} km/h wind` : ''}.`);
      st.wait -= dt;
      if (st.wait <= 0) { A.play(); setScene(1); A.setCam('taker'); A.setSpeed(0.6); }
    } else if (st.scene === 1) {
      const ch = A.taker();
      say(SCENES[1], `${ch.name}: ${ch.foot}-footed, a ${ch.run.steps}-step run-up at about ${ch.run.angle}° to the line. The standing foot plants beside the ball; the kicking leg whips through.`);
      if (mode === 'runup' && A.runT > -0.18) { setScene(2); A.setSpeed(0.08); }
    } else if (st.scene === 2) {
      if (mode === 'live' && sim.t > 0.01 && st.hold === 0) {
        st.hold = 3.6; A.setPaused(true);
        const a = sim.aero(), k = sim.cfg.kick, L = sim.launch;
        const spin = Math.hypot(k.sideSpin, k.topSpin);
        say(SCENES[2], `Boot on ball for a hundredth of a second. It leaves at ${fmt(a.speed * 3.6, 0)} km/h, ${fmt(k.elevation, 0)}° up, spinning ${fmt(spin * 60, 0)} times a minute.`);
        void L;
      } else if (st.hold > 0) {
        st.hold -= dt;
        if (st.hold <= 0) { A.setPaused(false); setScene(3); A.setCam('follow'); A.setSpeed(0.35); if (st.overlays) A.setForces(true); }
      }
    } else if (st.scene === 3) {
      st.capT -= dt;
      if (st.capT <= 0) {
        st.capT = 0.6;
        // plain language: how fast it still is, and how far the spin has bent it (forces in newtons stay off screen)
        const sp = Math.hypot(sim.s[3], sim.s[4], sim.s[5]) * 3.6, bent = Math.abs(sim.curve || 0);
        const kn = Math.hypot(...sim.forces().knuckle);
        say(SCENES[3], kn > 0.05
          ? `Almost no spin, so the air shoves it about: a knuckleball. ${fmt(sp, 0)} km/h now.`
          : `Air slows it to ${fmt(sp, 0)} km/h while the spin bends it${bent > 0.05 ? ` ${fmt(bent, 1)} m off its line` : ''}.`);
      }
      if (sim.s[0] < 8 || sim.done) { setScene(4); A.setCam('keeper'); A.setSpeed(0.25); A.setForces(false); }
    } else if (st.scene === 4) {
      const k = sim.keeper, ft = ftCache || flightTime();
      if (k) say(SCENES[4], `The keeper only picks it up after ${fmt(k.tReact, 2)} s. That leaves him ${fmt(Math.max(0, ft - k.tReact), 2)} s to get there.`);
      else say(SCENES[4], `No goalkeeper. The ball reaches the line in ${fmt(ft, 2)} s.`);
      if (sim.done || sim.goal || sim.caught || (sim.t > ft + 0.6)) finish();
    }
  });

  /** The control panel shown in the lab drawer. */
  function panel(body, title) {
    title.textContent = 'Anatomy of a free kick';
    const p = (t, c) => { const e = document.createElement('p'); e.className = c || ''; e.textContent = t; return e; };
    body.append(p('A narrated, slowed-down look at one kick, in six scenes, using your current set-up. Load a free kick from the exhibition first to dissect a famous one. Every number is read from the running simulation.', 'lead'));
    const row = document.createElement('div'); row.className = 'btnrow';
    const mk = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', () => { fn(); b.blur(); }); return b; };
    row.append(mk('▶ Play the story', () => start(0), 'primary'), mk('Pause / resume', () => A.setPaused(!A.ui.paused)), mk('Stop', stop));
    body.append(row);
    const sb = document.createElement('div'); sb.className = 'chips scenes'; sb.id = 'sceneBtns';
    SCENES.forEach((s, i) => sb.append(mk(`${i + 1} · ${s}`, () => start(i))));
    body.append(sb);
    // timeline scrub over the last kick (deterministic re-simulation)
    const lab = document.createElement('label'); lab.className = 'row';
    lab.innerHTML = '<span>Timeline</span><output id="oScrub">–</output><input type="range" id="iScrub" min="-0.6" max="3" step="0.01" value="0">';
    body.append(lab);
    const sc = lab.querySelector('input');
    sc.addEventListener('input', () => {
      if (!A.lastShot) { A.toast('Play the story or take a kick first.'); return; }
      st.on = false; cap.hidden = true;
      const t = parseFloat(sc.value); A.seek(t);
      $('oScrub').textContent = t < 0 ? `${(-t).toFixed(2)} s before contact` : `${t.toFixed(2)} s`;
    });
    const opts = document.createElement('div'); opts.className = 'two';
    const chk = (label, get, set) => { const l = document.createElement('label'); l.className = 'check'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = get(); i.addEventListener('change', () => set(i.checked)); l.append(i, ' ' + label); return l; };
    opts.append(chk('Captions', () => st.text, (v) => { st.text = v; if (!v) cap.hidden = true; }),
      chk('Voice narration', () => st.voice, (v) => { st.voice = v; }),
      chk('Force arrows', () => st.overlays, (v) => { st.overlays = v; A.setForces(v && st.scene === 3); }));
    body.append(opts);
    body.append(p('Tip: scenes 3–6 replay the last kick; drag the timeline to inspect any instant frame by frame, then drag on the view to orbit the ball.', 'hint'));
  }

  window.FKStory = { start, stop, panel, SCENES };
})();
