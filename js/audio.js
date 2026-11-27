/* Free Kick Simulator — synthesised sound effects (Web Audio, no samples) */
(function () {
  'use strict';
  let ctx = null, master = null, enabled = true, noiseBuf = null;

  function ensure() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function tone(freq, dur, vol, type, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterType, freq, q, attack) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    s.buffer = noiseBuf; s.loop = true;
    f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }

  const level = (speed, ref) => Math.min(1, Math.max(0.15, speed / ref));

  // ── interface sounds: soft sine chimes with a gentle attack (no clicks), warmed by a low-pass filter and a touch
  // of small-room reverb, kept well below the match sounds ──
  let uiBus = null;
  function ui() {
    if (uiBus) return uiBus;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.4;
    const dry = ctx.createGain(); dry.gain.value = 0.8;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    const rev = ctx.createConvolver();
    const n = Math.floor(ctx.sampleRate * 0.45), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    rev.buffer = ir;
    lp.connect(dry); dry.connect(master); lp.connect(rev); rev.connect(wet); wet.connect(master);
    return (uiBus = lp);
  }
  function chime(freq, at, dur, vol, slideTo) {
    const t = ctx.currentTime + (at || 0), bus = ui();
    for (const [mult, v] of [[1, 1], [2, 0.18]]) {               // fundamental and a faint octave: round, not buzzy
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(freq * mult, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo * mult, t + dur * 0.8);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * v, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.03);
    }
  }
  function air(dur, vol, from, to) {                             // a soft breathy sweep (opening and closing)
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(ui()); s.start(t); s.stop(t + dur + 0.05);
  }
  /** A plucked, woody note (marimba-like): a sine with a fast-decaying overtone at ~4x. */
  function pluck(freq, at, vol, dur) {
    const t = ctx.currentTime + (at || 0), bus = ui();
    for (const [mult, v, d] of [[1, 1, dur], [3.98, 0.35, dur * 0.25], [10.1, 0.08, dur * 0.08]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(freq * mult, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + d + 0.03);
    }
  }
  /** A tiny mechanical detent: a filtered click, its pitch telling where on the scale you are. */
  function tick(freq, vol) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.025);
    f.type = 'bandpass'; f.frequency.value = freq * 1.4; f.Q.value = 2.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.connect(f); f.connect(g); g.connect(ui()); o.start(t); o.stop(t + 0.05);
  }
  const PENTA = [523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7, 1318.5, 1568, 1760, 2093];   // C major pentatonic
  let lastTick = 0;
  const UI = {
    tap()       { pluck(880, 0, 0.05, 0.12); },                                             // any other button
    select(i)   { const f = PENTA[(i || 0) % PENTA.length]; chime(f, 0, 0.12, 0.05); chime(f * 1.5, 0.04, 0.18, 0.04); },   // one of a set
    tab()       { air(0.18, 0.03, 900, 2600); pluck(392, 0.02, 0.05, 0.25); },              // a section of the site
    player(i)   { const f = PENTA[(i || 0) % PENTA.length] / 2; pluck(f, 0, 0.07, 0.4); pluck(f * 2, 0.05, 0.035, 0.3); },   // each taker has his note
    preset(i)   { pluck(PENTA[((i || 0) * 2 + 3) % PENTA.length], 0, 0.06, 0.3); },
    drawerOpen()  { air(0.3, 0.045, 400, 1900); chime(440, 0.04, 0.2, 0.035, 660); },     // a drawer slides out
    drawerClose() { air(0.24, 0.035, 1700, 380); chime(660, 0, 0.16, 0.03, 440); },
    on()        { chime(520, 0, 0.12, 0.05, 780); },                                       // a switch on
    off()       { chime(780, 0, 0.12, 0.045, 520); },                                      // ...and off
    check(on)   { tick(on ? 1500 : 1000, 0.07); },
    kick()      { tone(120, 0.12, 0.25, 'sine', 60); chime(523, 0.02, 0.14, 0.05); chime(784, 0.08, 0.24, 0.045); },
    replay()    { for (let i = 0; i < 5; i++) chime(1400 - i * 160, i * 0.035, 0.07, 0.03); air(0.25, 0.03, 2500, 600); },   // rewinding
    pause()     { chime(620, 0, 0.3, 0.05, 180); },                                        // tape slowing to a stop
    resume()    { chime(200, 0, 0.22, 0.05, 640); },                                       // ...and spinning up
    hide()      { air(0.35, 0.04, 2200, 300); },
    show()      { air(0.35, 0.04, 300, 2200); },
    open()      { air(0.4, 0.05, 500, 2800); [587, 740, 880, 1175].forEach((f, i) => chime(f, 0.05 + i * 0.06, 0.3, 0.035)); },   // the showcase
    close()     { air(0.3, 0.04, 2400, 450); chime(880, 0, 0.18, 0.035, 440); },
    ballTab(i)  { const f = [784, 988, 1175, 1319][(i || 0) % 4]; chime(f, 0, 0.35, 0.045); chime(f * 2, 0.02, 0.2, 0.012); },
    success()   { [523, 659, 784, 1047].forEach((f, i) => chime(f, i * 0.05, 0.4 - i * 0.04, 0.045)); },
    slide(x)    { const now = performance.now(); if (now - lastTick < 28) return; lastTick = now; tick(500 + 1300 * Math.max(0, Math.min(1, x)), 0.05); },
    hover()     { const now = performance.now(); if (now - lastTick < 40) return; lastTick = now; tick(2400, 0.015); },
    toast()     { pluck(1318, 0, 0.03, 0.18); },
  };

  const Sound = {
    setEnabled(on) { enabled = on; if (!on && ctx) ctx.suspend(); },
    get enabled() { return enabled; },
    play(type, speed) {
      if (!ensure()) return;
      const v = level(speed || 10, 30);
      switch (type) {
        case 'kick':   tone(150, 0.16, 0.9 * v, 'sine', 45); noise(0.07, 0.5 * v, 'lowpass', 1800); break;
        case 'bounce': tone(110, 0.12, 0.5 * level(speed, 12), 'sine', 55); break;
        case 'body':   tone(95, 0.14, 0.6 * v, 'sine', 50); noise(0.06, 0.3 * v, 'lowpass', 900); break;
        case 'catch':  noise(0.09, 0.5, 'lowpass', 1200); tone(80, 0.1, 0.4, 'sine', 50); break;
        case 'post':   [523, 1318, 2217, 3410].forEach((f, i) => tone(f, 0.5 - i * 0.08, 0.28 * v / (i + 1), 'sine')); break;
        case 'net':    noise(0.45, 0.35 * v, 'bandpass', 2600, 0.7, 0.03); break;
        case 'goal':   noise(2.4, 0.3, 'bandpass', 900, 0.5, 0.5); noise(2.2, 0.18, 'bandpass', 1900, 0.8, 0.7); break;
        case 'miss':   noise(1.3, 0.12, 'bandpass', 500, 0.6, 0.35); break;
        case 'whistle': {                                         // a referee's pea whistle: a bright tone with a fast trill
          const t = ctx.currentTime, o = ctx.createOscillator(), lfo = ctx.createOscillator(), dep = ctx.createGain(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = 2750; lfo.frequency.value = 27; dep.gain.value = 160;
          lfo.connect(dep); dep.connect(o.frequency);
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.09, t + 0.38); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          o.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t + 0.55); lfo.stop(t + 0.55);
          break;
        }
      }
    },
    /** An interface sound (see UI above); arg = an index or position for the ones that change pitch. */
    ui(kind, arg) { if (ensure() && UI[kind]) UI[kind](arg); },
    /**
     * Turning something by hand (the showcase ball, the aim): soft detent clicks every few degrees, quicker and
     * brighter the faster it turns, over a quiet airy whirr that follows the speed.
     */
    spin(dAngle, speed) {
      // turning the ball (or aiming) by hand: a soft rush of air with a quiet warm tone under it, both rising gently
      // with the speed and easing in and out (no clicks)
      if (!ensure()) return;
      if (!whirr) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.Q.value = 0.4; f.frequency.value = 400; g.gain.value = 0;
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = 196; og.gain.value = 0;
        s.connect(f); f.connect(g); g.connect(ui()); o.connect(og); og.connect(ui()); s.start(); o.start();
        whirr = { f, g, o, og };
      }
      const sp = Math.min(1, Math.abs(speed) / 12), t = ctx.currentTime;
      whirr.g.gain.setTargetAtTime(0.02 * Math.sqrt(sp), t, 0.12); whirr.f.frequency.setTargetAtTime(350 + 1100 * sp, t, 0.15);
      whirr.og.gain.setTargetAtTime(0.006 * sp, t, 0.15); whirr.o.frequency.setTargetAtTime(196 + 90 * sp, t, 0.2);
      clearTimeout(whirrOff);
      whirrOff = setTimeout(() => { if (!whirr) return; const n = ctx.currentTime; whirr.g.gain.setTargetAtTime(0, n, 0.35); whirr.og.gain.setTargetAtTime(0, n, 0.35); }, 110);
    },
    /** The crowd's murmur under everything (stadium look): level 0 … 1. */
    crowd(levelNow) {
      if (!enabled || !ctx) { if (levelNow > 0 && enabled) ensure(); else return; }
      if (!crowdNode) {
        const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
        const g = ctx.createGain(); g.gain.value = 0;
        for (const [fr, q, v] of [[420, 0.7, 1], [1150, 1.1, 0.45]]) {
          const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr; f.Q.value = q;
          const gv = ctx.createGain(); gv.gain.value = v; s.connect(f); f.connect(gv); gv.connect(g);
        }
        g.connect(master); s.start();
        crowdNode = g;
      }
      // a living murmur: the level drifts a little on its own
      const drift = 0.85 + 0.3 * Math.random();
      crowdNode.gain.setTargetAtTime(0.06 * levelNow * drift, ctx.currentTime, 0.6);
    },
  };
  let spinAcc = 0, whirr = null, whirrOff = 0, crowdNode = null;
  window.FKSound = Sound;

  // every control speaks, and each kind in its own voice
  const idx = (b) => Array.prototype.indexOf.call(b.parentElement.querySelectorAll(':scope > button'), b);
  const after = (fn) => setTimeout(fn, 0);                    // read the state once the button's own handler has run
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('bs-backdrop')) return Sound.ui('close');
    const b = e.target.closest && e.target.closest('button, summary');
    if (!b || b.disabled) return;
    const id = b.id;
    if (id === 'logoBall') return Sound.ui('open');
    if (id === 'bsClose') return;                               // (the showcase plays its own close)
    if (id === 'bsUse') return Sound.ui('success');
    if (id === 'btnKick') return Sound.ui('kick');
    if (id === 'btnReplay') return Sound.ui('replay');
    if (id === 'btnSound') { setTimeout(() => Sound.ui('on'), 30); return; }          // (only audible once it is on)
    if (id === 'btnPause') return after(() => Sound.ui(b.classList.contains('paused') ? 'pause' : 'resume'));
    if (id === 'btnPanels') return after(() => Sound.ui(b.classList.contains('on') ? 'show' : 'hide'));
    if (b.closest('.rail')) return after(() => Sound.ui(b.classList.contains('on') ? 'drawerOpen' : 'drawerClose'));
    if (b.classList.contains('dclose') || id === 'labClose') return Sound.ui('drawerClose');
    if (b.closest('#bsTabs')) return Sound.ui('ballTab', idx(b));
    if (b.closest('#modes')) return Sound.ui('tab');
    if (b.closest('#takers')) return Sound.ui('player', idx(b));
    if (b.closest('#presets')) return Sound.ui('preset', idx(b));
    if (b.closest('.seg')) return Sound.ui('select', idx(b));
    Sound.ui('tap');
  }, true);
  // sliders tick as they move (pitch = where the thumb is), switches click, menus pluck
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.type === 'range') Sound.ui('slide', (t.value - t.min) / ((t.max - t.min) || 1));
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'checkbox') Sound.ui('check', t.checked);
    else if (t.tagName === 'SELECT') Sound.ui('tap');
  }, true);
  // a whisper of a tick when the pointer passes over the rails and the dock
  document.addEventListener('pointerover', (e) => {
    const b = e.target.closest && e.target.closest('.rail button, #bottom button');
    if (b && !b.contains(e.relatedTarget)) Sound.ui('hover');
  }, true);
})();
