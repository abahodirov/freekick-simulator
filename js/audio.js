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
        case 'whistle': tone(2350, 0.32, 0.12, 'square'); tone(2420, 0.32, 0.1, 'square'); break;
      }
    },
  };
  window.FKSound = Sound;
})();
