/*
 * Free Kick Simulator — ball viewer: a small, self-contained WebGL2 renderer for one ball in studio light.
 * Used by the spinning logo (top left) and the ball showcase it opens. Drag to turn the ball.
 *
 * A ball is drawn either from a real 3-D model, if one is registered in window.FKBallModels[id]
 *   { positions: number[], normals: number[], uvs: number[], indices: number[], texture: 'data:image/...' }
 * (converted from a downloaded .glb/.obj), or else from its panel pattern, computed per pixel on a sphere:
 *   classic (32 panels), brazuca (6 pinwheel panels), jabulani (8 panels), cafusa, trionda (4 panels).
 */
(function (root) {
  'use strict';
  const PATTERN = { engine: 0, classic: 0, brazuca: 1, jabulani: 2, cafusa: 3, trionda: 4 };

  const VS = `#version 300 es
  in vec3 aP; in vec3 aN; in vec2 aUV;
  uniform mat3 uR; uniform float uAspect, uZoom;
  out vec3 vL; out vec3 vN; out vec2 vUV;
  void main() {
    vL = aP; vN = uR * aN; vUV = aUV;
    vec3 w = uR * aP;
    float z = 3.2 - w.z;                                 // camera on +z looking at the origin
    gl_Position = vec4(w.x * uZoom / uAspect, w.y * uZoom, (z - 2.0) / 3.0 * z, z);
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec3 vL; in vec3 vN; in vec2 vUV;
  uniform int uBall, uTex, uNrmOn; uniform sampler2D uImg, uNrmMap; uniform vec3 uPC[12]; uniform vec3 uHC[20];
  uniform mat3 uR;
  out vec4 o;
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float vnoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z); }
  // pebbled skin: a small random tilt in the tangent plane, faded out below pixel size (as in the game)
  vec3 grain(vec3 p, float amt) {
    vec3 q = p * 140.0, g = vec3(vnoise(q), vnoise(q + 17.3), vnoise(q + 41.7)) - 0.5;
    g -= p * dot(g, p);
    return g * amt * (1.0 - smoothstep(0.35, 1.1, length(fwidth(q))));
  }
  vec3 tilt;                                            // surface relief of the pattern: the normal is p + tilt
  vec3 pattern(vec3 p, out float seam) {
    seam = 0.0; tilt = vec3(0.0);
    if (uBall == 0) {
      // classic: 12 pentagons + 20 hexagons of stitched leather, real seam grooves, puffed panels, stitch dimples
      // beside each seam, pebbled and lightly scuffed skin (same model as the game ball, js/render.js)
      float s1 = -2.0, s2 = -2.0, pent = 0.0; vec3 c1 = p, c2 = p;
      for (int i = 0; i < 12; i++) { float s = dot(p, uPC[i]); if (s > s1) { s2 = s1; c2 = c1; s1 = s; c1 = uPC[i]; pent = 1.0; } else if (s > s2) { s2 = s; c2 = uPC[i]; } }
      for (int i = 0; i < 20; i++) { vec3 c = uHC[i] * 1.01174; float s = dot(p, c); if (s > s1) { s2 = s1; c2 = c1; s1 = s; c1 = c; pent = 0.0; } else if (s > s2) { s2 = s; c2 = c; } }
      float gap = s1 - s2, fw = fwidth(gap) + 1e-5;
      vec3 g = c1 - c2; g -= p * dot(g, p);
      const float W = 0.0075, D = 0.012, PF = 0.006, G0 = 0.0135, SG = 0.0028, DS = 0.0025;
      float e = exp(-(gap * gap) / (W * W));
      float dh = D * 2.0 * gap / (W * W) * e * clamp(W / (1.6 * fw), 0.0, 1.0);
      float along = fract(abs(dot(p, normalize(cross(c1, c2)))) * 52.0);
      float row = exp(-pow((gap - G0) / SG, 2.0)), dash = smoothstep(0.32, 0.12, abs(along - 0.5));
      float sw = clamp(SG / (1.6 * fw), 0.0, 1.0), hole = row * dash * sw;
      dh += DS * dash * sw * 2.0 * (gap - G0) / (SG * SG) * row;
      tilt = -dh * g - PF * 30.0 * (c1 - p * dot(c1, p)) + grain(p, pent > 0.5 ? 0.035 : 0.06);   // + a dome per panel
      seam = (1.0 - smoothstep(0.0025, 0.0025 + 2.0 * fw + 0.003, gap)) * 0.85;
      vec3 panel = pent > 0.5 ? vec3(0.035, 0.037, 0.045) : vec3(0.93, 0.925, 0.9);
      panel *= 1.0 - 0.3 * exp(-(gap * gap) / (6.0 * W * W));
      float sc = vnoise(p * 9.0) * 0.5 + vnoise(p * 60.0) * 0.5;
      panel = mix(panel, panel * vec3(0.9, 0.89, 0.86), smoothstep(0.6, 0.85, sc) * (1.0 - pent) * 0.45);
      return panel * (1.0 - 0.35 * hole);
    }
    if (uBall == 4) {                                   // trionda: 4 panels on a tetrahedron, wave graphics in host colours
      vec3 T[4] = vec3[4](normalize(vec3(1, 1, 1)), normalize(vec3(1, -1, -1)), normalize(vec3(-1, 1, -1)), normalize(vec3(-1, -1, 1)));
      vec3 q = normalize(p + 0.11 * sin(4.0 * p.yzx + vec3(0.3, 1.1, 2.0)));
      float s1 = -2.0, s2 = -2.0; int id = 0;
      for (int i = 0; i < 4; i++) { float s = dot(q, T[i]); if (s > s1) { s2 = s1; s1 = s; id = i; } else if (s > s2) s2 = s; }
      float gap = s1 - s2, fw = fwidth(gap) + 1e-5;
      seam = 1.0 - smoothstep(0.006, 0.008 + 2.0 * fw, gap);
      vec3 c = T[id], u = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0))), v = cross(c, u);
      float ang = atan(dot(q, v), dot(q, u));
      vec3 host[3] = vec3[3](vec3(0.86, 0.12, 0.16), vec3(0.12, 0.62, 0.3), vec3(0.13, 0.33, 0.82));
      // three waves of colour sweep in from the seams of every panel ("tri" + "onda"), edged in gold
      float wave = gap - 0.05 * sin(ang * 3.0 + float(id) * 1.7);
      float band = smoothstep(0.025, 0.04, wave) * (1.0 - smoothstep(0.17, 0.19, wave));
      int k = int(mod(floor((ang + 3.14159) / 2.0944) + float(id), 3.0));
      vec3 col = vec3(0.97, 0.97, 0.96);
      col = mix(col, host[k], band * 0.93);
      float gold = smoothstep(0.195, 0.2, wave) * (1.0 - smoothstep(0.208, 0.213, wave));
      col = mix(col, vec3(0.84, 0.68, 0.3), gold);
      col *= 0.97 + 0.05 * hash3(floor(p * 220.0));
      return col;
    }
    vec3 q; float gap; int id;                           // brazuca / jabulani / cafusa (as in the game)
    if (uBall == 2) {
      q = p + 0.13 * sin(5.0 * p.zxy + 0.7); vec3 a = abs(q);
      gap = min(a.x, min(a.y, a.z));
      id = (q.x > 0.0 ? 1 : 0) + (q.y > 0.0 ? 2 : 0) + (q.z > 0.0 ? 4 : 0);
    } else {
      q = p + 0.36 * sin(2.6 * p.yzx + vec3(0.4, 1.3, 2.2)); vec3 a = abs(q);
      float m1 = max(a.x, max(a.y, a.z)), m2 = a.x + a.y + a.z - m1 - min(a.x, min(a.y, a.z));
      gap = (m1 - m2) * 0.6;
      id = a.x == m1 ? (q.x > 0.0 ? 0 : 1) : a.y == m1 ? (q.y > 0.0 ? 2 : 3) : (q.z > 0.0 ? 4 : 5);
    }
    float fw = fwidth(gap) + 1e-5;
    seam = 1.0 - smoothstep(0.006, 0.01 + 2.0 * fw, gap);
    vec3 c1, c2;
    if (uBall == 1) { c1 = (id % 3 == 0) ? vec3(0.95, 0.45, 0.1) : (id % 3 == 1) ? vec3(0.1, 0.32, 0.75) : vec3(0.1, 0.55, 0.3); c2 = vec3(0.05, 0.06, 0.08); }
    else if (uBall == 2) { c1 = (id % 4 == 0) ? vec3(0.1, 0.1, 0.12) : (id % 4 == 1) ? vec3(0.9, 0.7, 0.1) : (id % 4 == 2) ? vec3(0.1, 0.5, 0.55) : vec3(0.75, 0.15, 0.15); c2 = vec3(0.9, 0.9, 0.88); }
    else { c1 = (id % 2 == 0) ? vec3(0.08, 0.08, 0.1) : vec3(0.95, 0.5, 0.1); c2 = vec3(0.1, 0.5, 0.3); }
    float band = smoothstep(0.03, 0.045, gap) * (1.0 - smoothstep(0.1, 0.12, gap));
    float accent = smoothstep(0.125, 0.13, gap) * (1.0 - smoothstep(0.14, 0.145, gap));
    vec3 col = vec3(0.96, 0.96, 0.95);
    if (uBall == 2) {
      vec3 a = abs(q) / length(q);
      float tri = smoothstep(0.012, 0.0, 0.47 - min(a.x, min(a.y, a.z)));
      col = mix(col, c1, tri * 0.92); col = mix(col, c1, band * 0.2);
    } else { col = mix(col, c1, band); col = mix(col, c2, accent); }
    return col * (0.96 + 0.06 * hash3(floor(p * 160.0)));
  }
  void main() {
    vec3 N = normalize(vN), V = vec3(0, 0, 1), p = normalize(vL);
    float seam; vec3 base;
    if (uTex == 1) {
      base = texture(uImg, vUV).rgb; seam = 0.0; tilt = grain(p, 0.05);
      if (uNrmOn == 1) {
        // the model's relief, baked by direction (tools/ball_bake.py): sampled with seam-free gradients
        float lu = atan(p.z, p.x) / 6.2831853, lv = acos(clamp(p.y, -1.0, 1.0)) / 3.1415927;
        vec2 uv = vec2(fract(lu), lv), uv2 = vec2(fract(lu + 0.5), lv);
        vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
        if (abs(dx2.x) < abs(dx.x)) dx.x = dx2.x;
        if (abs(dy2.x) < abs(dy.x)) dy.x = dy2.x;
        vec3 nO = textureGrad(uNrmMap, uv, dx, dy).rgb * 2.0 - 1.0;
        float up = dot(nO, p);
        tilt += 1.6 * (nO - p * up);
        base *= 1.0 - 0.45 * smoothstep(0.015, 0.25, 1.0 - up);
      }
    }
    else base = pattern(p, seam);
    N = normalize(uR * normalize(p + tilt));
    base = mix(base, vec3(0.12, 0.12, 0.13), seam);
    // studio light: a soft key from the upper left, a cool fill, sky/ground ambience, a satin (not glossy) sheen
    vec3 L1 = normalize(vec3(-0.55, 0.7, 0.55)), L2 = normalize(vec3(0.85, -0.1, 0.45));
    float hemi = 0.5 + 0.5 * N.y;
    vec3 amb = mix(vec3(0.16, 0.15, 0.15), vec3(0.3, 0.31, 0.34), hemi);
    vec3 light = vec3(1.0, 0.98, 0.95) * max(dot(N, L1), 0.0) * 0.82 + vec3(0.75, 0.82, 0.95) * max(dot(N, L2), 0.0) * 0.22 + amb;
    float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 90.0) * 0.22 + pow(max(dot(N, normalize(L1 + V)), 0.0), 12.0) * 0.05;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.12;
    vec3 col = base * light + spec * (1.0 - seam) + rim * vec3(0.95, 0.85, 0.75);
    o = vec4(pow(col, vec3(1.0 / 1.04)), 1.0);
  }`;

  /** Unit sphere, positions = normals, with equirectangular UVs. */
  function sphere(nu, nv) {
    const P = [], N = [], T = [], I = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, th = u * Math.PI * 2, ph = v * Math.PI;
      const x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
      P.push(x, y, z); N.push(x, y, z); T.push(u, v);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + nu + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return { positions: P, normals: N, uvs: T, indices: I };
  }
  /** Pentagon (icosahedron vertex) and hexagon (dodecahedron vertex) centres of a classic ball. */
  function classicCentres() {
    const t = (1 + Math.sqrt(5)) / 2, n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const ico = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(n);
    const it = 1 / t, dod = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) dod.push(n([a, b, c]));
    // (the dual of this icosahedron: the same layout as the game ball's HEX in js/render.js)
    for (const a of [-1, 1]) for (const b of [-1, 1]) { dod.push(n([0, b * t, a * it])); dod.push(n([b * t, a * it, 0])); dod.push(n([a * it, 0, b * t])); }
    return { pc: ico.flat(), hc: dod.flat() };
  }
  const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
  const rotX = (a) => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a)];
  const mm = (A, B) => { const o = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2]; return o; };

  class BallView {
    constructor(canvas, opts = {}) {
      this.canvas = canvas; this.spin = opts.spin !== undefined ? opts.spin : 0.6; this.zoom = opts.zoom || 2.6;
      this.onSpin = opts.onSpin || null;          // (angle turned by hand, angular speed) — for the turning sound
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
      if (!gl) throw new Error('WebGL2 unavailable');
      this.gl = gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      this.pr = pr; this.u = {};
      for (const n of ['uR', 'uAspect', 'uZoom', 'uBall', 'uTex', 'uImg', 'uPC', 'uHC', 'uNrmOn', 'uNrmMap']) this.u[n] = gl.getUniformLocation(pr, n);
      gl.useProgram(pr);
      const cc = classicCentres(); gl.uniform3fv(this.u.uPC, cc.pc); gl.uniform3fv(this.u.uHC, cc.hc);
      this.sphere = this._mesh(sphere(96, 64));
      this.models = {};
      this.yaw = 0.6; this.pitch = 0.35; this.vy = 0; this.ball = 'trionda';
      this.drag = null;
      canvas.addEventListener('pointerdown', (e) => { if (!opts.interactive) return; this.drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', (e) => {
        if (!this.drag) return;
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag = { x: e.clientX, y: e.clientY };
        this.yaw += dx * 0.012; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.012)); this.vy = dx * 0.012 * 30;
        if (this.onSpin) this.onSpin(Math.hypot(dx, dy) * 0.012, Math.hypot(dx, dy) * 0.012 * 30);
      });
      canvas.addEventListener('pointerup', () => { this.drag = null; });
      this._loop = this._loop.bind(this); this.running = false; this.last = 0;
    }
    _mesh(m) {
      const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const buf = (data, loc, n) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        const l = gl.getAttribLocation(this.pr, loc); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0); } };
      buf(m.positions, 'aP', 3); buf(m.normals, 'aN', 3); buf(m.uvs || new Array(m.positions.length / 3 * 2).fill(0), 'aUV', 2);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      const big = m.positions.length / 3 > 65535;
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(m.indices) : new Uint16Array(m.indices), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: m.indices.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    }
    /** Use a real 3-D model for this ball id (see the header for the format). */
    _model(id) {
      if (id in this.models) return this.models[id];
      const src = root.FKBallModels && root.FKBallModels[id];
      if (!src) return (this.models[id] = null);
      // a painted texture on the viewer's own sphere ({sphere: true}), or a full mesh with its own UVs
      const gl = this.gl, m = src.sphere ? Object.assign({}, this.sphere) : this._mesh(src);
      const load = (url, wrapS) => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([240, 240, 240, 255]));
        const img = new Image(); img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          if (wrapS) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
          if (wrapS) m.nrmReady = true; };
        img.src = url; return t;
      };
      m.tex = load(src.texture);
      if (src.sphereNormal) m.nrm = load(src.sphereNormal, true);       // the grooves and relief (by direction)
      return (this.models[id] = m);
    }
    setBall(id) { this.ball = id; }
    start() { if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(this._loop); } }
    stop() { this.running = false; }
    _loop(now) {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      if (!this.drag) {
        this.vy += (this.spin - this.vy) * Math.min(1, dt * 2); this.yaw += this.vy * dt;
        // a flung ball keeps clicking as it coasts down to its idle spin
        const extra = this.vy - this.spin;
        if (this.onSpin && Math.abs(extra) > 0.35) this.onSpin(Math.abs(extra) * dt, extra);
      }
      this.draw();
      requestAnimationFrame(this._loop);
    }
    draw() {
      const gl = this.gl, c = this.canvas, dpr = Math.min(2, root.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.useProgram(this.pr);
      gl.uniformMatrix3fv(this.u.uR, false, mm(rotX(this.pitch), rotY(this.yaw)));
      gl.uniform1f(this.u.uAspect, w / h); gl.uniform1f(this.u.uZoom, this.zoom);
      const model = this._model(this.ball);
      gl.uniform1i(this.u.uBall, PATTERN[this.ball] !== undefined ? PATTERN[this.ball] : 0);
      gl.uniform1i(this.u.uTex, model ? 1 : 0);
      if (model) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, model.tex); gl.uniform1i(this.u.uImg, 0); }
      const nrm = model && model.nrm && model.nrmReady;
      if (nrm) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, model.nrm); gl.uniform1i(this.u.uNrmMap, 1); gl.activeTexture(gl.TEXTURE0); }
      gl.uniform1i(this.u.uNrmOn, nrm ? 1 : 0);
      const m = model || this.sphere;
      gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.type, 0); gl.bindVertexArray(null);
    }
  }
  root.FKBallView = { BallView, PATTERN };
})(typeof self !== 'undefined' ? self : this);
