/*
 * Free Kick Simulator — living backgrounds for the ball showcase: "Aurora" and "Plasma" from React Bits
 * (reactbits.dev/backgrounds/aurora, /plasma), ported from their React components to plain WebGL2 with the shaders
 * unchanged. Each ball picks one and its colours; switching crossfades the two canvases and glides the colours.
 *   FKBackdrop.create(container) → { set({ kind: 'aurora'|'plasma', stops: [css colours] | color: css colour }), start(), stop() }
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const QUAD = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

  // ── Aurora (React Bits): curtains of light from the top, colours ramped in OKLCH ──
  const MAX_STOPS = 5, MAX_LAYERS = 3;
  const AURORA = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uStops[${MAX_STOPS}];
uniform int uStopCount;
uniform float uAmplitude;
uniform float uBlend;
uniform float uHeight;
uniform float uScale;
uniform float uGlow;
uniform float uBrightness;
uniform int uLayers;
uniform float uFlip;
uniform vec3 uPointer;
uniform float uReveal;
uniform float uOpacity;
uniform float uLightMode;
out vec4 outColor;
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = int(min(floor(x), float(uStopCount - 2)));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lch = mix(uStops[i], uStops[i + 1], f);
  lch.x = mix(lch.x, min(lch.x, 0.7), uLightMode);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / uResolution.y;
  y = mix(y, 1.0 - y, uFlip);
  float u = frag.x / uResolution.x;
  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;
  float t = uTime;
  float reach = uPointer.z * exp(-pow((X - uPointer.x) / 0.38, 2.0));
  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < ${MAX_LAYERS}; k++) {
    if (k >= uLayers) break;
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = t * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = uHeight + layer * 0.07 + wave * 0.15 * uAmplitude;
    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.4);
    hem = mix(-0.25, hem, uReveal);
    float soft = (0.04 + uBlend * 0.16) * (1.0 + layer * 0.9);
    float rise = hem - y;
    float low = -soft - uGlow * 0.14;
    float high = 0.26 + soft * 0.6;
    float body = pow(smootherstep(low, high, rise), 1.5 + uGlow * 0.6);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float alpha = body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer);
    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);
    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }
  float fade = smootherstep(0.0, 0.7, uReveal) * uOpacity;
  float strength = clamp(uBrightness, 0.0, 2.0);
  glow *= fade * min(strength, 1.0);
  cover *= fade * min(strength, 1.0);
  glow = 1.0 - pow(1.0 - glow, vec3(max(strength, 1.0)));
  float dither = (hash(frag) - 0.5) / 255.0;
  outColor = vec4(glow + dither, clamp(cover + dither, 0.0, 1.0));
}`;

  // ── Plasma (React Bits): a ray-marched twisting volume, then a tinted composite ──
  const PLASMA_VOLUME = `#version 300 es
precision highp float;
uniform vec2 uView;
uniform vec2 uScale;
uniform float uZoom;
uniform float uTime;
uniform float uTwist;
uniform float uWave;
uniform float uSharpness;
uniform vec2 uOrbit;
uniform float uDither;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 c = (gl_FragCoord.xy * uScale - 0.5 * uView) / uZoom;
  vec3 rd = normalize(vec3(c, uView.y));
  vec3 ro = vec3(0.0, 0.0, -4.0);
  float cy = cos(uOrbit.x);
  float sy = sin(uOrbit.x);
  float cx = cos(uOrbit.y);
  float sx = sin(uOrbit.y);
  mat3 orbit = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  ro = orbit * ro;
  rd = orbit * rd;
  float z = 0.0;
  float density = 0.0;
  float band = 0.0;
  for (int i = 0; i < 60; i++) {
    vec3 p = ro + rd * z;
    vec3 s = p;
    float d = p.y - uTime;
    p.x += uWave * (1.0 + p.y) * sin(d + p.x * 0.1) * cos(0.34 * d + p.x * 0.05);
    vec2 q = p.xz *= mat2(cos(p.y * uTwist + vec4(0.0, 11.0, 33.0, 0.0) - uTime));
    float shell = abs(sqrt(length(q * q)) - 0.25 * (5.0 + s.y)) / 3.0;
    float stepLength = shell + 0.0008;
    z += stepLength;
    float phase = s.y + p.z * 0.5 + s.z - length(s - p);
    float weight = (1.0 + sin(phase + 8.0)) * exp(-shell * uSharpness) * stepLength;
    density += weight;
    band += weight * (0.5 + 0.5 * sin(phase * 0.5 + 1.0));
  }
  vec2 encoded = sqrt(vec2(density, band) / (1.0 + vec2(density, band)));
  encoded += (vec2(hash(gl_FragCoord.xy), hash(gl_FragCoord.yx + 17.0)) - 0.5) * uDither;
  outColor = vec4(encoded, 0.0, 1.0);
}`;
  const PLASMA_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uVolume;
uniform vec2 uResolution;
uniform vec3 uColor;
uniform vec3 uHighlight;
uniform float uGain;
uniform float uShine;
uniform float uPresence;
uniform float uGrain;
uniform float uFade;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uHeat;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float smootherstep(float edge, float x) {
  float t = clamp(x / max(edge, 0.0001), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 encoded = clamp(texture(uVolume, uv).rg, 0.0, 0.9995);
  encoded *= encoded;
  vec2 volume = encoded / (1.0 - encoded);
  vec2 offset = (gl_FragCoord.xy - uHeat.xy) / uResolution.y;
  float heat = uHeat.z * exp(-dot(offset, offset) / 0.05);
  float density = volume.r * uGain * uPresence * (1.0 + heat * 0.35);
  float band = clamp(volume.g / max(volume.r, 0.00001), 0.0, 1.0);
  vec3 tint = mix(uColor, uHighlight, band * 0.35);
  vec3 hdr = tint * density + uHighlight * density * density * uShine;
  float peak = max(hdr.r, max(hdr.g, hdr.b));
  float level = 1.0 - exp(-peak);
  float hot = smoothstep(1.0, 3.0, peak);
  float edge = uFade * 0.5;
  float mask = smootherstep(edge, uv.x) * smootherstep(edge, 1.0 - uv.x) * smootherstep(edge, uv.y) * smootherstep(edge, 1.0 - uv.y);
  mask *= uOpacity;
  float grain = (hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;
  vec3 hue = hdr / max(peak, 0.0001);
  vec3 color = mix(hue * level, vec3(level), hot * 0.6);
  color = pow(color, vec3(1.0 / 2.2));
  color = clamp(color + grain * level, 0.0, 1.0) * mask;
  outColor = vec4(color, max(color.r, max(color.g, color.b)));
}`;

  // the configurations chosen for the showcase (React Bits props)
  const AURORA_CFG = { amplitude: 1.55, blend: 0.5, height: 0.64, speed: 1, glow: 0.6, layers: 2, scale: 1, brightness: 1 };
  const PLASMA_CFG = { speed: 0.25, scale: 0.9, twist: 0.55, softness: 0.45, shine: 1, wave: 0.65, grain: 0.03, fade: 0.3, brightness: 1, quality: 0.5 };

  const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d', { willReadFrequently: true }) : null;
  const rgbOf = (value) => {
    if (!probe) return [1, 1, 1];
    probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#ffffff'; probe.fillStyle = value; probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data; return [d[0] / 255, d[1] / 255, d[2] / 255];
  };
  const toOklch = (rgb) => {
    const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lab = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
  };
  const unwrapHues = (stops) => {
    const known = stops.findIndex((st) => st[1] > 0.02);
    let previous = known === -1 ? 0 : stops[known][2];
    return stops.map((st) => {
      let hue = st[1] > 0.02 ? st[2] : previous;
      while (hue - previous > Math.PI) hue -= Math.PI * 2;
      while (hue - previous < -Math.PI) hue += Math.PI * 2;
      previous = hue; return [st[0], st[1], hue];
    });
  };
  function program(gl, fs) {
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, QUAD)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPosition'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  function quad(gl) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return vao;
  }

  function create(container) {
    const make = (cls) => { const c = document.createElement('canvas'); c.className = 'bd-canvas ' + cls; container.append(c); return c; };
    const cA = make('bd-aurora'), cP = make('bd-plasma');
    const glA = cA.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    const glP = cP.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!glA || !glP) return { set() {}, start() {}, stop() {} };
    const A = program(glA, AURORA), vaoA = quad(glA);
    const PV = program(glP, PLASMA_VOLUME), PC = program(glP, PLASMA_COMPOSITE), vaoP = quad(glP);
    const floatT = !!glP.getExtension('EXT_color_buffer_float');
    const tex = glP.createTexture(), fb = glP.createFramebuffer(), tgt = { w: 0, h: 0 };
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // state: what is shown (kind), and the colours, eased toward their targets
    const st = { kind: 'aurora', mix: 0, stops: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], stopsTo: null, col: [0.5, 0.5, 0.6], colTo: null,
      clockA: 0, clockP: 0, reveal: 0, presence: 0, px: 0, py: 0.5, reach: 0, yaw: 0, pitch: 0, vy: 0, vp: 0, heat: 0, hx: 0, hy: 0 };
    const pointer = { x: 0, y: 0, inside: false };
    let raf = 0, last = 0, running = false, W = 1, H = 1;
    function resize() {
      W = Math.max(1, container.clientWidth); H = Math.max(1, container.clientHeight);
      const r = Math.min(root.devicePixelRatio || 1, 1);       // (soft, flowing light: no need for more pixels than the CSS ones)
      for (const c of [cA, cP]) { c.width = Math.round(W * r); c.height = Math.round(H * r); }
    }
    function set(opts) {
      st.kind = opts.kind || 'aurora';
      if (opts.stops) { const s = opts.stops.slice(0, MAX_STOPS).map(rgbOf); st.stopsTo = s.length >= 2 ? s : [s[0], s[0]]; if (!st.started) st.stops = st.stopsTo.map((x) => x.slice()); }
      if (opts.color) { st.colTo = rgbOf(opts.color).map((v) => Math.pow(v, 2.2)); if (!st.started) st.col = st.colTo.slice(); }
      st.started = true;
    }
    function drawAurora() {
      const gl = glA, u = A.u;
      const stops = st.stops, pal = new Float32Array(MAX_STOPS * 3);
      unwrapHues(stops.map(toOklch)).forEach((x, i) => pal.set(x, i * 3));
      gl.viewport(0, 0, cA.width, cA.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(A.p); gl.bindVertexArray(vaoA);
      gl.uniform2f(u.uResolution, cA.width, cA.height); gl.uniform1f(u.uTime, st.clockA);
      gl.uniform3fv(u.uStops, pal); gl.uniform1i(u.uStopCount, stops.length);
      gl.uniform1f(u.uAmplitude, AURORA_CFG.amplitude); gl.uniform1f(u.uBlend, AURORA_CFG.blend); gl.uniform1f(u.uHeight, AURORA_CFG.height);
      gl.uniform1f(u.uScale, AURORA_CFG.scale); gl.uniform1f(u.uGlow, AURORA_CFG.glow); gl.uniform1f(u.uBrightness, AURORA_CFG.brightness);
      gl.uniform1i(u.uLayers, AURORA_CFG.layers); gl.uniform1f(u.uFlip, 0); gl.uniform3f(u.uPointer, st.px, st.py, st.reach);
      gl.uniform1f(u.uReveal, 1 - Math.pow(1 - st.reveal, 3)); gl.uniform1f(u.uOpacity, 1); gl.uniform1f(u.uLightMode, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function drawPlasma() {
      const gl = glP, c = PLASMA_CFG;
      let q = c.quality; if (W * H * q * q > 1600000) q = Math.sqrt(1600000 / (W * H));
      const vw = Math.max(1, Math.round(W * q)), vh = Math.max(1, Math.round(H * q));
      if (tgt.w !== vw || tgt.h !== vh) {
        tgt.w = vw; tgt.h = vh; gl.bindTexture(gl.TEXTURE_2D, tex);
        if (floatT) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, vw, vh, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vw, vh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      }
      const presence = st.presence * st.presence * (3 - 2 * st.presence);
      gl.bindVertexArray(vaoP);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, vw, vh); gl.useProgram(PV.p);
      let u = PV.u;
      gl.uniform2f(u.uView, W, H); gl.uniform2f(u.uScale, W / vw, H / vh); gl.uniform1f(u.uZoom, c.scale);
      gl.uniform1f(u.uTime, st.clockP * 0.4 + (1 - presence) * 1.4); gl.uniform1f(u.uTwist, c.twist); gl.uniform1f(u.uWave, 0.4 * c.wave);
      gl.uniform1f(u.uSharpness, 100 - c.softness * 90); gl.uniform2f(u.uOrbit, st.yaw, st.pitch); gl.uniform1f(u.uDither, floatT ? 0 : 1 / 255);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const base = st.col, hi = base.map((v) => v + (1 - v) * 0.85);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cP.width, cP.height); gl.useProgram(PC.p);
      u = PC.u;
      gl.uniform2f(u.uResolution, cP.width, cP.height); gl.uniform3fv(u.uColor, base); gl.uniform3fv(u.uHighlight, hi);
      gl.uniform1f(u.uGain, 4.8 * c.brightness); gl.uniform1f(u.uShine, 0.025 * c.shine); gl.uniform1f(u.uPresence, presence);
      gl.uniform1f(u.uGrain, c.grain); gl.uniform1f(u.uFade, c.fade); gl.uniform1f(u.uOpacity, 1); gl.uniform1f(u.uTime, st.clockP % 1000);
      gl.uniform3f(u.uHeat, st.hx * cP.width / W, (H - st.hy) * cP.height / H, st.heat);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uVolume, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function frame(now) {
      raf = 0;
      if (!running) return;
      const dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60; last = now;
      const motion = reduce ? 0 : 1;
      // colours glide to the new ball's (about a second), the two backgrounds crossfade
      const k = 1 - Math.exp(-dt * 3.2);
      if (st.stopsTo) {
        while (st.stops.length < st.stopsTo.length) st.stops.push(st.stops[st.stops.length - 1].slice());
        while (st.stops.length > st.stopsTo.length) st.stops.pop();
        st.stops = st.stops.map((s, i) => s.map((v, j) => v + (st.stopsTo[i][j] - v) * k));
      }
      if (st.colTo) st.col = st.col.map((v, j) => v + (st.colTo[j] - v) * k);
      st.mix += ((st.kind === 'plasma' ? 1 : 0) - st.mix) * (1 - Math.exp(-dt * 3));
      cA.style.opacity = (1 - st.mix).toFixed(3); cP.style.opacity = st.mix.toFixed(3);
      // Aurora: time, intro, the light leaning toward the pointer
      st.clockA += dt * AURORA_CFG.speed * motion;
      st.reveal = Math.min(1, st.reveal + dt / 2.4);
      const rect = container.getBoundingClientRect();
      const engaged = pointer.inside && !reduce, follow = 1 - Math.exp(-dt / 0.6);
      if (engaged) { st.px += ((pointer.x - W / 2) / H - st.px) * follow; st.py += (pointer.y / H - st.py) * follow; }
      st.reach += ((engaged ? 1 : 0) - st.reach) * (1 - Math.exp(-dt / (engaged ? 0.9 : 1.4)));
      // Plasma: time, intro, the volume turning a little toward the pointer, a warm spot under it
      st.clockP += dt * PLASMA_CFG.speed * motion;
      st.presence = Math.min(1, st.presence + dt / 1.6);
      const gy = engaged ? (pointer.x / W - 0.5) * 0.9 : 0, gp = engaged ? (pointer.y / H - 0.5) * 0.18 : 0;
      st.vy += (40 * (gy - st.yaw) - 11 * st.vy) * dt; st.vp += (40 * (gp - st.pitch) - 11 * st.vp) * dt;
      st.yaw += st.vy * dt; st.pitch += st.vp * dt;
      st.heat += ((engaged ? 1 : 0) - st.heat) * (1 - Math.exp(-dt * (engaged ? 4 : 2)));
      st.hx += (pointer.x - st.hx) * (1 - Math.exp(-dt * 8)); st.hy += (pointer.y - st.hy) * (1 - Math.exp(-dt * 8));
      if (st.mix < 0.995) drawAurora();
      if (st.mix > 0.005) drawPlasma();
      void rect;
      raf = requestAnimationFrame(frame);
    }
    const onMove = (e) => {
      const r = container.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
      pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    };
    const ro = new ResizeObserver(resize); ro.observe(container); resize();
    root.addEventListener('pointermove', onMove, { passive: true });
    return {
      set,
      start() { if (running) return; running = true; last = 0; if (!raf) raf = requestAnimationFrame(frame); },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    };
  }
  root.FKBackdrop = { create };
})(typeof self !== 'undefined' ? self : this);
