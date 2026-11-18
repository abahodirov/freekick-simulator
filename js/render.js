/*
 * Free Kick Simulator — WebGL2 renderer (no dependencies)
 * Draws the pitch (procedural shader), stadium, goal + deformable net, players, ball, and path ribbons.
 */
(function () {
  'use strict';
  const C = FK.C;
  const POST_Y = FK.POST_Y, BAR_Z = FK.BAR_Z, NET_D = C.NET_DEPTH, R = C.BALL_RADIUS;

  // ───────────── small vector / matrix helpers ─────────────
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
  }
  function lookAt(o, eye, target, up) {
    const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -dot(x, eye); o[13] = -dot(y, eye); o[14] = -dot(z, eye); o[15] = 1;
    return { x, y, z };
  }
  function mul(o, a, b) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }

  // ───────────── shaders ─────────────
  const SKY_VS = `#version 300 es
  in vec2 aPos; out vec2 vN;
  void main(){ vN = aPos; gl_Position = vec4(aPos, 0.999, 1.0); }`;
  const SKY_FS = `#version 300 es
  precision highp float;
  in vec2 vN; out vec4 o;
  uniform vec3 uF, uR, uU, uSun;
  void main(){
    vec3 d = normalize(uF + vN.x * uR + vN.y * uU);
    float t = clamp(d.z, 0.0, 1.0);
    vec3 col = mix(vec3(0.74, 0.83, 0.92), vec3(0.20, 0.42, 0.74), pow(t, 0.55));
    col = mix(col, vec3(0.62, 0.70, 0.74), smoothstep(0.02, -0.08, d.z));
    float s = max(dot(d, uSun), 0.0);
    col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.18);
    o = vec4(col, 1.0);
  }`;

  const GROUND_VS = `#version 300 es
  in vec2 aPos; uniform mat4 uVP; out vec3 vW;
  void main(){ vW = vec3(aPos, 0.0); gl_Position = uVP * vec4(vW, 1.0); }`;
  const GROUND_FS = `#version 300 es
  precision highp float;
  in vec3 vW; out vec4 o;
  uniform vec3 uEye;
  uniform vec4 uSh[20]; uniform vec2 uShP[20]; uniform int uShN;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a;
    float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-6), 0.0, 1.0); return length(pa-ba*h); }
  float boxLine(vec2 p, vec2 c, vec2 h){ vec2 d = abs(p-c)-h; return abs(length(max(d,0.0)) + min(max(d.x,d.y),0.0)); }
  void main(){
    vec2 p = vW.xy;
    float aa = length(fwidth(p)) * 0.7 + 1e-4;
    vec2 m = vec2(min(p.x, 105.0 - p.x), p.y);           // both ends of the pitch are identical
    float d = boxLine(p, vec2(52.5, 0.0), vec2(52.5, 34.0));
    d = min(d, boxLine(m, vec2(8.25, 0.0), vec2(8.25, 20.16)));
    d = min(d, boxLine(m, vec2(2.75, 0.0), vec2(2.75, 9.16)));
    if (abs(p.y) < 34.0) d = min(d, abs(p.x - 52.5));
    d = min(d, abs(length(p - vec2(52.5, 0.0)) - 9.15));
    if (m.x > 16.5) d = min(d, abs(length(m - vec2(11.0, 0.0)) - 9.15));
    d = min(d, max(length(m - vec2(11.0, 0.0)) - 0.16, 0.0));
    d = min(d, max(length(p - vec2(52.5, 0.0)) - 0.16, 0.0));
    vec2 cn = vec2(m.x, 34.0 - abs(p.y));
    if (cn.x > 0.0 && cn.y > 0.0) d = min(d, abs(length(cn) - 1.0));
    float line = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, d);

    bool inPitch = p.x > 0.0 && p.x < 105.0 && abs(p.y) < 34.0;
    bool apron = p.x > -4.4 && p.x < 109.4 && abs(p.y) < 37.9;
    float stripe = step(0.5, fract(p.x / 11.0));
    vec3 g = mix(vec3(0.20, 0.47, 0.17), vec3(0.25, 0.54, 0.20), stripe);
    if (!inPitch) g = vec3(0.19, 0.43, 0.16);
    if (!apron) g = vec3(0.33, 0.33, 0.35);
    float fade = clamp(0.12 / aa, 0.0, 1.0);
    float n = noise(p * 2.7) * 0.6 + noise(p * 13.0) * 0.4;
    g *= 1.0 + (n - 0.5) * 0.22 * fade;
    vec3 col = mix(g, vec3(0.93, 0.95, 0.93), line * (apron ? 0.92 : 0.0));

    float sh = 0.0;
    for (int i = 0; i < 20; i++) {
      if (i >= uShN) break;
      float sd = sdSeg(p, uSh[i].xy, uSh[i].zw) - uShP[i].x;
      float soft = 0.04 + uShP[i].x * 0.6;
      sh = max(sh, (1.0 - smoothstep(-soft, soft, sd)) * uShP[i].y);
    }
    col *= 1.0 - sh;
    float dist = length(vW - uEye);
    col = mix(col, vec3(0.62, 0.70, 0.74), (1.0 - exp(-dist * 0.0045)) * 0.75);
    o = vec4(col, 1.0);
  }`;

  const MESH_VS = `#version 300 es
  in vec3 aPos; in vec3 aNrm;
  uniform mat4 uVP, uModel; uniform mat3 uNrm;
  out vec3 vW, vN, vL;
  void main(){ vL = aPos; vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vN = uNrm * aNrm; gl_Position = uVP * w; }`;
  const MESH_FS = `#version 300 es
  precision highp float;
  in vec3 vW, vN, vL; out vec4 o;
  uniform vec3 uColor, uSun, uEye; uniform int uMode;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec3 N = normalize(vN);
    vec3 base = uColor;
    float spec = 0.0;
    if (uMode == 1) {            // football: 12 dark pentagons at the icosahedron vertices
      vec3 a = abs(normalize(vL));
      float m = max(max(a.y + 1.618 * a.z, a.z + 1.618 * a.x), a.x + 1.618 * a.y) / 1.9021;
      float w = fwidth(m) + 1e-4;
      base = mix(vec3(0.97), vec3(0.07, 0.08, 0.10), smoothstep(0.938 - w, 0.938 + w, m));
      vec3 V = normalize(uEye - vW);
      spec = pow(max(dot(N, normalize(V + uSun)), 0.0), 40.0) * 0.35;
    } else if (uMode == 2) {     // crowd
      float along = abs(N.x) > abs(N.y) ? vW.y : vW.x;
      vec2 cell = vec2(along / 0.62, vW.z / 0.42);
      vec2 id = floor(cell);
      float h = hash(id), h2 = hash(id + 17.3);
      vec3 shirt = h2 < 0.3 ? vec3(0.75, 0.16, 0.18) : h2 < 0.55 ? vec3(0.88, 0.88, 0.86) : h2 < 0.75 ? vec3(0.16, 0.27, 0.55) : vec3(0.82, 0.68, 0.22);
      vec3 person = mix(shirt, vec3(0.78, 0.6, 0.5), step(0.62, fract(cell.y)) * 0.8);
      vec3 seat = vec3(0.17, 0.19, 0.24);
      vec2 f = abs(fract(cell) - 0.5);
      float inside = step(f.x, 0.36) * step(0.1, h);
      float fw = clamp(length(fwidth(cell)) * 1.2, 0.0, 1.0);
      base = mix(mix(seat, person, inside), mix(seat, vec3(0.5, 0.42, 0.4), 0.55), fw);
    } else if (uMode == 3) {     // advertising boards: colour blocks, no lettering
      float along = abs(N.x) > abs(N.y) ? vW.y : vW.x;
      float id = floor(along / 9.0);
      float h = hash(vec2(id, 4.0));
      base = h < 0.25 ? vec3(0.10, 0.22, 0.45) : h < 0.5 ? vec3(0.85, 0.86, 0.88) : h < 0.75 ? vec3(0.62, 0.12, 0.14) : vec3(0.10, 0.12, 0.15);
      float u = fract(along / 9.0);
      base = mix(base, base * 0.7 + 0.2, step(0.42, u) * step(u, 0.58) * step(0.3, vW.z) * step(vW.z, 0.65));
      if (N.z > 0.5) base = vec3(0.8);
    }
    float diff = max(dot(N, uSun), 0.0);
    float amb = mix(0.42, 0.66, N.z * 0.5 + 0.5);
    vec3 col = base * (amb + diff * 0.62) + spec;
    float dist = length(vW - uEye);
    col = mix(col, vec3(0.62, 0.70, 0.74), (1.0 - exp(-dist * 0.0045)) * 0.75);
    o = vec4(col, 1.0);
  }`;

  const COLOR_VS = `#version 300 es
  in vec3 aPos; in vec4 aCol; uniform mat4 uVP; uniform vec4 uTint; out vec4 vC;
  void main(){ vC = aCol * uTint; gl_Position = uVP * vec4(aPos, 1.0); }`;
  const COLOR_FS = `#version 300 es
  precision highp float; in vec4 vC; out vec4 o;
  void main(){ o = vC; }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, vs.indexOf('aNrm') >= 0 ? 'aNrm' : 'aCol');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace('[0]', '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  // ───────────── geometry ─────────────
  function sphereMesh(seg, rings) {
    const v = [];
    const pt = (i, j) => {
      const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.sin(th) * Math.sin(ph), z = Math.cos(th);
      v.push(x, y, z, x, y, z);
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      pt(i, j); pt(i, j + 1); pt(i + 1, j + 1);
      pt(i, j); pt(i + 1, j + 1); pt(i + 1, j);
    }
    return new Float32Array(v);
  }
  function cylinderMesh(seg) {   // radius 1, z from 0 to 1, capped
    const v = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      v.push(c0, s0, 0, c0, s0, 0, c1, s1, 0, c1, s1, 0, c1, s1, 1, c1, s1, 0);
      v.push(c0, s0, 0, c0, s0, 0, c1, s1, 1, c1, s1, 0, c0, s0, 1, c0, s0, 0);
      v.push(0, 0, 1, 0, 0, 1, c0, s0, 1, 0, 0, 1, c1, s1, 1, 0, 0, 1);
      v.push(0, 0, 0, 0, 0, -1, c1, s1, 0, 0, 0, -1, c0, s0, 0, 0, 0, -1);
    }
    return new Float32Array(v);
  }
  function quad(v, a, b, c, d) {   // counter-clockwise, flat normal
    const n = norm(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c, a, c, d]) v.push(p[0], p[1], p[2], n[0], n[1], n[2]);
  }
  function box(v, x0, y0, z0, x1, y1, z1) {
    quad(v, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    quad(v, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    quad(v, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
    quad(v, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
    quad(v, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  }

  const SUN = norm([-0.32, -0.46, 0.83]);
  const SHX = -SUN[0] / SUN[2], SHY = -SUN[1] / SUN[2];   // ground shadow offset per metre of height

  const COL = {
    white: [0.95, 0.95, 0.95], steel: [0.55, 0.58, 0.62],
    skin: [0.80, 0.60, 0.48], hair: [0.16, 0.12, 0.10],
    shirt: [0.76, 0.14, 0.16], shorts: [0.93, 0.93, 0.92], socks: [0.76, 0.14, 0.16],
    gkShirt: [0.93, 0.78, 0.12], gkShorts: [0.10, 0.11, 0.13], gkSocks: [0.93, 0.78, 0.12], glove: [0.96, 0.96, 0.96],
    boot: [0.08, 0.08, 0.09],
  };

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.canvas = canvas; this.gl = gl;
      this.sky = compile(gl, SKY_VS, SKY_FS);
      this.ground = compile(gl, GROUND_VS, GROUND_FS);
      this.mesh = compile(gl, MESH_VS, MESH_FS);
      this.color = compile(gl, COLOR_VS, COLOR_FS);

      this.proj = new Float32Array(16); this.view = new Float32Array(16); this.vp = new Float32Array(16);
      this._model = new Float32Array(16); this._nrm = new Float32Array(9);
      this._model[15] = 1;
      this.eye = [0, 0, 1];

      const staticBuf = (data, stride) => {
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        if (stride === 2) gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        else {
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        }
        return { vao, count: data.length / (stride === 2 ? 2 : 6) };
      };
      this.fsTri = staticBuf(new Float32Array([-1, -1, 3, -1, -1, 3]), 2);
      this.groundQuad = staticBuf(new Float32Array([-60, -90, 170, -90, 170, 90, -60, -90, 170, 90, -60, 90]), 2);
      this.sphere = staticBuf(sphereMesh(24, 14), 6);
      this.cyl = staticBuf(cylinderMesh(14), 6);

      // stadium
      const st = [], bd = [];
      const z0 = 1.0, z1 = 17, d0 = 44, d1 = 72;
      quad(st, [-40, -d0, z0], [145, -d0, z0], [145, -d1, z1], [-40, -d1, z1]);
      quad(st, [145, d0, z0], [-40, d0, z0], [-40, d1, z1], [145, d1, z1]);
      quad(st, [-10, 72, z0], [-10, -72, z0], [-38, -72, z1], [-38, 72, z1]);
      quad(st, [115, -72, z0], [115, 72, z0], [143, 72, z1], [143, -72, z1]);
      box(bd, -4.75, -38.2, 0, -4.5, 38.2, 0.95);
      box(bd, 109.5, -38.2, 0, 109.75, 38.2, 0.95);
      box(bd, -4.75, -38.25, 0, 109.75, -38.0, 0.95);
      box(bd, -4.75, 38.0, 0, 109.75, 38.25, 0.95);
      this.stands = staticBuf(new Float32Array(st), 6);
      this.boards = staticBuf(new Float32Array(bd), 6);

      this._buildNet();

      // dynamic coloured geometry (ribbons)
      this.dynVao = gl.createVertexArray(); gl.bindVertexArray(this.dynVao);
      this.dynBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      this.dyn = new Float32Array(7 * 6 * 4096);
      this.dynN = 0;
      gl.bindVertexArray(null);

      this.bulge = [0, 1, 2, 3].map(() => ({ u: 0, v: 0, amp: 0 }));
      this._netDirty = true;
      this.resize();
    }

    _buildNet() {
      const gl = this.gl;
      const nodes = [], idx = [], meta = [];   // meta: panel, u, v per node
      const step = 0.125;
      const grid = (panel, u0, u1, v0, v1, place) => {
        const nu = Math.round((u1 - u0) / step), nv = Math.round((v1 - v0) / step);
        const base = nodes.length / 3;
        for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
          const u = u0 + (u1 - u0) * i / nu, v = v0 + (v1 - v0) * j / nv;
          const p = place(u, v);
          nodes.push(p[0], p[1], p[2]); meta.push(panel, u, v);
        }
        for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
          const k = base + j * (nu + 1) + i;
          if (i < nu) idx.push(k, k + 1);
          if (j < nv) idx.push(k, k + nu + 1);
        }
      };
      grid(0, -POST_Y, POST_Y, 0, BAR_Z, (u, v) => [-NET_D, u, v]);
      grid(1, -NET_D, 0, 0, BAR_Z, (u, v) => [u, -POST_Y, v]);
      grid(2, -NET_D, 0, 0, BAR_Z, (u, v) => [u, POST_Y, v]);
      grid(3, -NET_D, 0, -POST_Y, POST_Y, (u, v) => [u, v, BAR_Z]);
      this.netRest = new Float32Array(nodes);
      this.netMeta = new Float32Array(meta);
      const n = nodes.length / 3;
      this.netData = new Float32Array(n * 7);
      for (let i = 0; i < n; i++) {
        this.netData.set([nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2], 1, 1, 1, 0.5], i * 7);
      }
      this.netVao = gl.createVertexArray(); gl.bindVertexArray(this.netVao);
      this.netBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.netBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.netData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      this.netCount = idx.length;
      gl.bindVertexArray(null);
    }

    /** Bulge the net around the ball; relax back when the ball lets go. */
    _updateNet(panels, dt) {
      const AX = [0, 1, 1, 2], SIGN = [-1, -1, 1, 1];
      let active = false;
      for (let i = 0; i < 4; i++) {
        const b = this.bulge[i], p = panels && panels[i];
        if (p && p.latch !== 0 && p.pen > 0) { b.u = p.u; b.v = p.v; b.amp = -p.latch * SIGN[i] * p.pen; }
        else b.amp *= Math.exp(-dt / 0.09);
        if (Math.abs(b.amp) > 0.002) active = true; else b.amp = 0;
      }
      if (!active && !this._netDirty) return;
      const rest = this.netRest, meta = this.netMeta, out = this.netData;
      const n = rest.length / 3;
      for (let i = 0; i < n; i++) {
        const pi = meta[i * 3], b = this.bulge[pi];
        let x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
        if (b.amp !== 0) {
          const du = meta[i * 3 + 1] - b.u, dv = meta[i * 3 + 2] - b.v;
          const sg = 0.3 + Math.abs(b.amp) * 0.7;
          const d = b.amp * Math.exp(-(du * du + dv * dv) / (2 * sg * sg));
          if (AX[pi] === 0) x += d; else if (AX[pi] === 1) y += d; else z += d;
        }
        out[i * 7] = x; out[i * 7 + 1] = y; out[i * 7 + 2] = z;
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.netBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
      this._netDirty = active;
    }

    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }

    /** World → CSS pixel coordinates (null if behind the camera). */
    project(x, y, z) {
      const m = this.vp;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.01) return null;
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      return [(cx * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - cy * 0.5) * this.canvas.clientHeight];
    }

    // ── primitive drawing ──
    _prim(mesh, o, X, Y, Z, sx, sy, sz, color, mode) {
      const gl = this.gl, m = this._model, n = this._nrm, u = this.mesh.u;
      m[0] = X[0] * sx; m[1] = X[1] * sx; m[2] = X[2] * sx;
      m[4] = Y[0] * sy; m[5] = Y[1] * sy; m[6] = Y[2] * sy;
      m[8] = Z[0] * sz; m[9] = Z[1] * sz; m[10] = Z[2] * sz;
      m[12] = o[0]; m[13] = o[1]; m[14] = o[2];
      n[0] = X[0] / sx; n[1] = X[1] / sx; n[2] = X[2] / sx;
      n[3] = Y[0] / sy; n[4] = Y[1] / sy; n[5] = Y[2] / sy;
      n[6] = Z[0] / sz; n[7] = Z[1] / sz; n[8] = Z[2] / sz;
      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.uniformMatrix3fv(u.uNrm, false, n);
      gl.uniform3fv(u.uColor, color);
      gl.uniform1i(u.uMode, mode || 0);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    _ball(c, r, color) { this._prim(this.sphere, c, [1, 0, 0], [0, 1, 0], [0, 0, 1], r, r, r, color, 0); }
    _limb(a, b, r, color, wAxis, rd) {
      const d = sub(b, a), len = Math.hypot(d[0], d[1], d[2]);
      if (len < 1e-5) return;
      const Z = [d[0] / len, d[1] / len, d[2] / len];
      let X = wAxis ? wAxis : (Math.abs(Z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
      const Y = norm(cross(Z, X));
      X = cross(Y, Z);
      this._prim(this.cyl, a, X, Y, Z, r, rd || r, len, color, 0);
    }
    _ellipsoid(c, X, Y, Z, sx, sy, sz, color) { this._prim(this.sphere, c, X, Y, Z, sx, sy, sz, color, 0); }

    /** A simple articulated figure. o = feet, U = body axis, W = left-right axis, F = facing. */
    _figure(o, U, W, F, h, kit, arms) {
      const k = h / 1.8;
      const P = (u, w, f) => [o[0] + U[0] * u + W[0] * w + F[0] * f, o[1] + U[1] * u + W[1] * w + F[1] * f, o[2] + U[2] * u + W[2] * w + F[2] * f];
      for (const s of [-1, 1]) {
        this._limb(P(0, s * 0.10 * k, 0), P(0.07 * k, s * 0.10 * k, 0), 0.062 * k, COL.boot);
        this._limb(P(0.06 * k, s * 0.10 * k, 0), P(0.5 * k, s * 0.10 * k, 0), 0.058 * k, kit.socks);
        this._limb(P(0.48 * k, s * 0.10 * k, 0), P(0.86 * k, s * 0.095 * k, 0), 0.075 * k, COL.skin);
      }
      this._limb(P(0.72 * k, 0, 0), P(0.98 * k, 0, 0), 0.185 * k, kit.shorts, W, 0.125 * k);
      this._limb(P(0.95 * k, 0, 0), P(1.47 * k, 0, 0), 0.2 * k, kit.shirt, W, 0.125 * k);
      this._ellipsoid(P(1.47 * k, 0, 0), W, F, U, 0.2 * k, 0.125 * k, 0.07 * k, kit.shirt);
      this._limb(P(1.47 * k, 0, 0), P(1.6 * k, 0, 0), 0.05 * k, COL.skin);
      this._ball(P(1.685 * k, 0, 0), 0.112 * k, COL.skin);
      this._ball(P(1.71 * k, 0, -0.025 * k), 0.113 * k, COL.hair);
      for (const s of [-1, 1]) {
        const sh = P(1.43 * k, s * 0.235 * k, 0);
        const hand = arms ? arms(s) : P(0.84 * k, s * 0.06 * k, 0.15 * k);
        const el = arms
          ? [(sh[0] + hand[0]) / 2 + F[0] * 0.06, (sh[1] + hand[1]) / 2 + F[1] * 0.06, (sh[2] + hand[2]) / 2 + F[2] * 0.06]
          : P(1.12 * k, s * 0.27 * k, 0.05 * k);
        this._limb(sh, el, 0.052 * k, kit.shirt);
        this._ball(el, 0.052 * k, kit.shirt);
        this._limb(el, hand, 0.045 * k, kit.sleeve || COL.skin);
        this._ball(hand, kit.glove ? 0.082 : 0.05 * k, kit.glove || COL.skin);
      }
    }

    // ── ribbons (camera-facing strips) ──
    _ribbon(pts, n, width, colorAt, dash) {
      const eye = this.eye;
      let o = this.dynN;
      if ((o + n * 6) * 7 > this.dyn.length) return;
      const d = this.dyn;
      const put = (x, y, z, c) => { const k = o * 7; d[k] = x; d[k + 1] = y; d[k + 2] = z; d[k + 3] = c[0]; d[k + 4] = c[1]; d[k + 5] = c[2]; d[k + 6] = c[3]; o++; };
      for (let i = 0; i < n - 1; i++) {
        if (dash && (i % dash.period) >= dash.on) continue;
        const ax = pts[i * 3], ay = pts[i * 3 + 1], az = pts[i * 3 + 2];
        const bx = pts[i * 3 + 3], by = pts[i * 3 + 4], bz = pts[i * 3 + 5];
        const dir = [bx - ax, by - ay, bz - az];
        let s = cross(dir, [eye[0] - ax, eye[1] - ay, eye[2] - az]);
        const sl = Math.hypot(s[0], s[1], s[2]);
        if (sl < 1e-9) continue;
        const dist = Math.hypot(eye[0] - ax, eye[1] - ay, eye[2] - az);
        const w = Math.max(width, dist * 0.0011) * 0.5 / sl;   // never thinner than ~1 px
        s = [s[0] * w, s[1] * w, s[2] * w];
        const c0 = colorAt(i), c1 = colorAt(i + 1);
        put(ax - s[0], ay - s[1], az - s[2], c0); put(ax + s[0], ay + s[1], az + s[2], c0); put(bx + s[0], by + s[1], bz + s[2], c1);
        put(ax - s[0], ay - s[1], az - s[2], c0); put(bx + s[0], by + s[1], bz + s[2], c1); put(bx - s[0], by - s[1], bz - s[2], c1);
      }
      this.dynN = o;
    }

    /**
     * frame = { cam:{eye,target,up,fov}, ball:{x,y,z,q}, wall:[], keeper, net:[], dt,
     *           ribbons:[{pts,n,width,color,fade,dash}] }
     */
    draw(frame) {
      const gl = this.gl;
      this.resize();
      const W = this.canvas.width, H = this.canvas.height;
      gl.viewport(0, 0, W, H);
      const cam = frame.cam;
      this.eye = cam.eye;
      perspective(this.proj, cam.fov, W / H, 0.2, 600);
      const basis = lookAt(this.view, cam.eye, cam.target, cam.up);
      mul(this.vp, this.proj, this.view);

      // sky
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
      gl.useProgram(this.sky.p);
      const th = Math.tan(cam.fov / 2), fw = [-basis.z[0], -basis.z[1], -basis.z[2]];
      gl.uniform3fv(this.sky.u.uF, fw);
      gl.uniform3f(this.sky.u.uR, basis.x[0] * th * W / H, basis.x[1] * th * W / H, basis.x[2] * th * W / H);
      gl.uniform3f(this.sky.u.uU, basis.y[0] * th, basis.y[1] * th, basis.y[2] * th);
      gl.uniform3fv(this.sky.u.uSun, SUN);
      gl.bindVertexArray(this.fsTri.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ground with analytic shadows
      const sh = [], shp = [];
      const addShadow = (ax, ay, az, bx, by, bz, r, a) => {
        if (sh.length >= 80) return;
        sh.push(ax + SHX * az, ay + SHY * az, bx + SHX * bz, by + SHY * bz); shp.push(r, a);
      };
      const b = frame.ball;
      addShadow(b.x, b.y, b.z - R, b.x, b.y, b.z - R, R * 0.95, 0.5 * Math.max(0.25, 1 - b.z / 14));
      for (const s of [-1, 1]) addShadow(0, s * POST_Y, 0, 0, s * POST_Y, BAR_Z, 0.07, 0.4);
      addShadow(0, -POST_Y, BAR_Z, 0, POST_Y, BAR_Z, 0.07, 0.4);
      for (const p of frame.wall) addShadow(p.x, p.y, p.z, p.x, p.y, p.z + p.height - 0.2, 0.2, 0.42);
      const k = frame.keeper;
      if (k) addShadow(k.x, k.fy, k.fz, k.x, k.hy, k.hz, 0.19, 0.42);
      gl.useProgram(this.ground.p);
      gl.uniformMatrix4fv(this.ground.u.uVP, false, this.vp);
      gl.uniform3fv(this.ground.u.uEye, cam.eye);
      gl.uniform4fv(this.ground.u.uSh, new Float32Array(sh));
      gl.uniform2fv(this.ground.u.uShP, new Float32Array(shp));
      gl.uniform1i(this.ground.u.uShN, shp.length / 2);
      gl.bindVertexArray(this.groundQuad.vao); gl.drawArrays(gl.TRIANGLES, 0, 6);

      // solid geometry
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      const mu = this.mesh.u;
      gl.useProgram(this.mesh.p);
      gl.uniformMatrix4fv(mu.uVP, false, this.vp);
      gl.uniform3fv(mu.uSun, SUN);
      gl.uniform3fv(mu.uEye, cam.eye);
      const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      gl.disable(gl.CULL_FACE);
      this._prim(this.stands, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, COL.steel, 2);
      this._prim(this.boards, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, COL.steel, 3);

      // goal frame
      const pr = C.POST_RADIUS;
      for (const s of [-1, 1]) {
        this._limb([0, s * POST_Y, 0], [0, s * POST_Y, BAR_Z], pr, COL.white);
        this._ball([0, s * POST_Y, BAR_Z], pr, COL.white);
        this._limb([-NET_D, s * POST_Y, 0], [-NET_D, s * POST_Y, BAR_Z], 0.025, COL.steel);
        this._limb([0, s * POST_Y, BAR_Z], [-NET_D, s * POST_Y, BAR_Z], 0.025, COL.steel);
      }
      this._limb([0, -POST_Y, BAR_Z], [0, POST_Y, BAR_Z], pr, COL.white);
      this._limb([-NET_D, -POST_Y, BAR_Z], [-NET_D, POST_Y, BAR_Z], 0.025, COL.steel);

      // wall
      const kitWall = { shirt: COL.shirt, shorts: COL.shorts, socks: COL.socks };
      for (const p of frame.wall) {
        const F = [p.faceX, p.faceY, 0], Wd = [-p.faceY, p.faceX, 0];
        this._figure([p.x, p.y, p.z], [0, 0, 1], Wd, F, p.height, kitWall, null);
      }
      // keeper
      if (k) {
        const ty = k.sy - k.fy, tz = k.sz - k.fz, tl = Math.hypot(ty, tz) || 1;
        const U = [0, ty / tl, tz / tl], Wd = [0, U[2], -U[1]], F = [1, 0, 0];
        const kit = { shirt: COL.gkShirt, shorts: COL.gkShorts, socks: COL.gkSocks, sleeve: COL.gkShirt, glove: COL.glove };
        this._figure([k.x, k.fy, k.fz], U, Wd, F, 1.86, kit, (s) => [k.x + 0.1, k.hy + Wd[1] * s * 0.09, k.hz + Wd[2] * s * 0.09]);
      }

      // ball
      const q = b.q, qw = q[0], qx = q[1], qy = q[2], qz = q[3];
      const X = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw)];
      const Y = [2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw)];
      const Z = [2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy)];
      this._prim(this.sphere, [b.x, b.y, b.z], X, Y, Z, R, R, R, COL.white, 1);

      // translucent: net, then ribbons
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this._updateNet(frame.net, frame.dt || 0.016);
      gl.useProgram(this.color.p);
      gl.uniformMatrix4fv(this.color.u.uVP, false, this.vp);
      gl.uniform4f(this.color.u.uTint, 1, 1, 1, 1);
      gl.bindVertexArray(this.netVao);
      gl.drawElements(gl.LINES, this.netCount, gl.UNSIGNED_SHORT, 0);

      this.dynN = 0;
      for (const r of frame.ribbons) {
        const c = r.color, n = r.n;
        const colorAt = r.fade
          ? (i) => [c[0], c[1], c[2], c[3] * (0.25 + 0.75 * i / Math.max(1, n - 1))]
          : () => c;
        this._ribbon(r.pts, n, r.width, colorAt, r.dash);
      }
      if (this.dynN > 0) {
        gl.bindVertexArray(this.dynVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
        gl.bufferData(gl.ARRAY_BUFFER, this.dyn.subarray(0, this.dynN * 7), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, this.dynN);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
  }

  window.FKRender = { Renderer };
})();
