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

  // ───────────── football panel layout ─────────────
  // Pentagon centres = icosahedron vertices; hexagon centres = the dual dodecahedron's vertices.
  const PHI = (1 + Math.sqrt(5)) / 2;
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  const PENT = [], HEX = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) PENT.push(unit([0, a, b]), unit([a, b, 0]), unit([b, 0, a]));
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) HEX.push(unit([a, b, c]));
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) HEX.push(unit([0, b, a / PHI]), unit([b, a / PHI, 0]), unit([a / PHI, 0, b]));
  const glslArr = (n, name, arr) => `const vec3 ${name}[${n}] = vec3[${n}](${arr.map((v) => `vec3(${v.map((x) => x.toFixed(5)).join(',')})`).join(',')});`;
  const FOG = 'vec3(0.17, 0.21, 0.31)';   // dusk haze

  // ───────────── shaders ─────────────
  const SKY_VS = `#version 300 es
  in vec2 aPos; out vec2 vN;
  void main(){ vN = aPos; gl_Position = vec4(aPos, 1.0, 1.0); }`;   // on the far plane: drawn last, only where nothing else is
  const SKY_FS = `#version 300 es
  precision highp float;
  in vec2 vN; out vec4 o;
  uniform vec3 uF, uR, uU, uSun, uZen, uHor, uFog, uSunCol, uCloud;
  uniform float uStars, uSunDisc; uniform int uStyle;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(uF + vN.x * uR + vN.y * uU);
    float t = clamp(d.z, 0.0, 1.0);
    vec3 col = mix(uHor, uZen, pow(t, 0.45));
    float sd = max(dot(d, uSun), 0.0);
    col += uSunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 64.0) * 0.35);
    col += uSunCol * smoothstep(0.9993, 0.9997, sd) * uSunDisc;
    // clouds: a layer projected onto a plane high above the stadium
    if (d.z > 0.01) {
      vec2 cp = d.xy / (d.z + 0.08) * 1.4;
      float c = smoothstep(0.48, 0.78, fbm(cp + vec2(3.1, 7.7)));
      float shade = 0.75 + 0.25 * fbm(cp * 2.0 + 11.0);
      vec3 cc = uCloud * shade + uSunCol * pow(sd, 4.0) * 0.25;
      col = mix(col, cc, c * smoothstep(0.01, 0.12, d.z) * 0.85);
    }
    // stars at night
    if (uStars > 0.0 && d.z > 0.0) {
      vec2 sp = d.xy / (d.z + 0.3) * 120.0;
      float s = step(0.9965, h2(floor(sp))) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
      col += vec3(s) * uStars * smoothstep(0.05, 0.3, d.z);
    }
    col = mix(col, uFog, smoothstep(0.02, -0.08, d.z));
    if (uStyle == 1) col = mix(vec3(0.93, 0.935, 0.94), vec3(0.985), smoothstep(0.0, 0.5, d.z));   // blank paper sky
    o = vec4(col, 1.0);
  }`;

  const GROUND_VS = `#version 300 es
  in vec2 aPos; uniform mat4 uVP; out vec3 vW;
  void main(){ vW = vec3(aPos, 0.0); gl_Position = uVP * vec4(vW, 1.0); }`;
  const GROUND_FS = `#version 300 es
  precision highp float;
  in vec3 vW; out vec4 o;
  uniform vec3 uEye, uFog, uGrassLight; uniform float uFogK, uPool;
  uniform vec4 uSh[56]; uniform vec2 uShP[56]; uniform int uShN; uniform vec4 uShBox; uniform int uStyle;
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
    float cross_ = step(0.5, fract(p.y / 11.0));                         // faint cross-mowing
    vec3 g = mix(vec3(0.14, 0.40, 0.12), vec3(0.23, 0.54, 0.17), stripe);
    g *= 0.96 + 0.06 * cross_;
    if (!inPitch) g = vec3(0.19, 0.43, 0.16);
    bool outside = abs(p.y) > 44.0 || p.x < -10.0 || p.x > 115.0;        // beyond the stands: meadow
    if (!apron) g = outside ? vec3(0.22, 0.36, 0.14) : vec3(0.33, 0.33, 0.35);
    float fade = clamp(0.12 / aa, 0.0, 1.0);
    if (uStyle == 0) {                                                      // grass texture (not needed on paper)
      float n = noise(p * 2.7) * 0.6 + noise(p * 13.0) * 0.4;
      g *= 1.0 + (n - 0.5) * 0.22 * fade;
      float blades = noise(p * 90.0) * clamp(0.02 / aa, 0.0, 1.0);        // grass blades up close
      g *= 0.93 + 0.14 * blades;
      if (outside) g *= 0.8 + 0.4 * noise(p * 0.08);
    }
    g *= 1.0 - uPool * smoothstep(30.0, 66.0, length(vec2((p.x - 52.5) / 2.2, p.y)));   // floodlit pool
    g *= uGrassLight;
    vec3 col = mix(g, vec3(0.93, 0.95, 0.93) * uGrassLight, line * (apron ? 0.92 : 0.0));

    float sh = 0.0;
    bool inBox = p.x > uShBox.x && p.y > uShBox.y && p.x < uShBox.z && p.y < uShBox.w;
    for (int i = 0; i < 56; i++) {
      if (i >= uShN || !inBox) break;
      float sd = sdSeg(p, uSh[i].xy, uSh[i].zw) - uShP[i].x;
      float soft = 0.04 + uShP[i].x * 0.6;
      sh = max(sh, (1.0 - smoothstep(-soft, soft, sd)) * uShP[i].y);
    }
    col *= 1.0 - sh;
    if (uStyle == 0) {   // same filmic response as the people and the stadium
      vec3 l = pow(max(col, 0.0), vec3(2.2)) * 0.85;
      col = pow(clamp((l * (2.51 * l + 0.03)) / (l * (2.43 * l + 0.59) + 0.14), 0.0, 1.0), vec3(1.0 / 2.2));
    }
    float dist = length(vW - uEye);
    col = mix(col, uFog, (1.0 - exp(-dist * uFogK)) * 0.75);
    if (uStyle == 1) {
      // illustrated: pale grey paper with speckle, white pitch markings, cool grey shadows, fading to white
      float speck = noise(p * 9.0);
      vec3 paper = vec3(0.86, 0.87, 0.885) * (0.97 + 0.05 * speck * fade);
      vec3 c = mix(paper, vec3(0.985), line * 0.95);
      c = mix(c, vec3(0.6, 0.63, 0.72), sh * 0.85);
      col = mix(c, vec3(0.94, 0.945, 0.95), smoothstep(25.0, 140.0, dist));
    }
    o = vec4(col, 1.0);
  }`;

  // Ink outlines (illustrated style): an "inverted hull" — the surface is pushed out along its normal and then
  // pushed back along the view ray, so it only shows around silhouettes and depth steps, as a pen line.
  const OUTLINE_GLSL = `
  vec4 placeVertex(vec3 w, vec3 n){
    if (uOutline <= 0.0) return uVP * vec4(w, 1.0);
    vec4 v = uV * vec4(w, 1.0);
    float d = -v.z;
    w += normalize(n) * uOutline * (0.0035 + 0.0013 * d);
    v = uV * vec4(w, 1.0);
    v.xyz += normalize(v.xyz) * 0.05;
    return uP * v;
  }`;
  const MESH_VS = `#version 300 es
  in vec3 aPos; in vec3 aNrm;
  uniform mat4 uVP, uModel, uV, uP; uniform mat3 uNrm; uniform vec3 uColor; uniform int uMode; uniform float uOutline;
  out vec3 vW, vN, vL, vCol; flat out int vMd;
  ${OUTLINE_GLSL}
  void main(){ vL = aPos; vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vN = uNrm * aNrm; vCol = uColor;
    vMd = uOutline > 0.0 ? 11 : uMode; gl_Position = placeVertex(w.xyz, vN); }`;
  // instanced variant for people: one draw call per primitive shape instead of one per body part
  const INST_VS = `#version 300 es
  in vec3 aPos; in vec3 aNrm; in vec4 aM0; in vec4 aM1; in vec4 aM2; in vec4 aCM;
  uniform mat4 uVP, uV, uP; uniform float uOutline;
  out vec3 vW, vN, vL, vCol; flat out int vMd;
  ${OUTLINE_GLSL}
  void main(){
    vL = aPos; vec4 p = vec4(aPos, 1.0);
    vW = vec3(dot(aM0, p), dot(aM1, p), dot(aM2, p));
    // normal: the model is rotation × axis scale, so its inverse-transpose is Σ cᵢ·nᵢ/|cᵢ|² (cᵢ = columns) —
    // exact for these instances and far cheaper than inverse() per vertex
    vec3 c0 = vec3(aM0.x, aM1.x, aM2.x), c1 = vec3(aM0.y, aM1.y, aM2.y), c2 = vec3(aM0.z, aM1.z, aM2.z);
    vN = c0 * (aNrm.x / dot(c0, c0)) + c1 * (aNrm.y / dot(c1, c1)) + c2 * (aNrm.z / dot(c2, c2));
    vCol = aCM.rgb; vMd = uOutline > 0.0 ? 11 : int(aCM.a + 0.5);
    gl_Position = placeVertex(vW, vN);
  }`;
  // sculpted limbs: world-space vertices rebuilt every frame (js/sculpt.js), colour and shading mode per vertex
  const DYN_VS = `#version 300 es
  in vec3 aPos; in vec3 aNrm; in vec4 aCM;
  uniform mat4 uVP, uV, uP; uniform float uOutline;
  out vec3 vW, vN, vL, vCol; flat out int vMd;
  ${OUTLINE_GLSL}
  void main(){ vL = aPos; vW = aPos; vN = aNrm; vCol = aCM.rgb; vMd = uOutline > 0.0 ? 11 : int(aCM.a + 0.5);
    gl_Position = placeVertex(vW, vN); }`;
  const MESH_FS = `#version 300 es
  precision highp float;
  in vec3 vW, vN, vL; out vec4 o;
  in vec3 vCol; flat in int vMd;
  #define uColor vCol
  #define uMode vMd
  uniform vec3 uColor2, uColor3, uSun, uEye; uniform int uNum, uPattern, uStyle, uBall;
  uniform sampler2D uBallTex; uniform int uBallTexOn;   // a painted ball texture (assets/balls), equirectangular
  uniform sampler2D uBallNrm; uniform int uBallNrmOn;   // its object-space normal map (grooves, relief), same layout
  uniform mat3 uBallRot;                                // the ball's orientation (local → world), for its relief
  uniform vec3 uSunCol, uSkyCol, uGndCol, uFog; uniform float uFogK;
  ${glslArr(12, 'PC', PENT)}
  ${glslArr(20, 'HC', HEX)}
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  // smooth 3-D value noise (for cloth folds and skin micro-relief)
  float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z); }
  vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
  vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  // GGX-style specular lobe (normalised enough for a look, not an energy-exact BRDF)
  float ggx(vec3 N, vec3 V, vec3 L, float rough){ vec3 H = normalize(V + L); float a = rough * rough;
    float nh = max(dot(N, H), 0.0); float d = nh * nh * (a * a - 1.0) + 1.0; return (a * a) / (3.14159 * d * d) * max(dot(N, L), 0.0); }
  // the fine pebbled skin of a ball: a small random tilt in the local tangent plane, fading out once a pebble is
  // smaller than a pixel (so it never shimmers at a distance)
  vec3 ballGrain(vec3 p, float amt){
    vec3 q = p * 140.0;
    vec3 g = vec3(vnoise(q), vnoise(q + 17.3), vnoise(q + 41.7)) - 0.5;
    g -= p * dot(g, p);
    return g * amt * (1.0 - smoothstep(0.35, 1.1, length(fwidth(q))));
  }
  // seven-segment digit; p in [0,1]x[0,2]
  float digit(vec2 p, int d){
    int m = d==0?0x3F:d==1?0x06:d==2?0x5B:d==3?0x4F:d==4?0x66:d==5?0x6D:d==6?0x7D:d==7?0x07:d==8?0x7F:0x6F;
    float c = 0.0, t = 0.16;
    p.x = 1.0 - p.x;             // the shirt's local x runs right-to-left as seen from behind
    if ((m & 1) != 0)  c = max(c, step(abs(p.x-0.5), 0.42) * step(abs(p.y-2.0), t));
    if ((m & 64) != 0) c = max(c, step(abs(p.x-0.5), 0.42) * step(abs(p.y-1.0), t));
    if ((m & 8) != 0)  c = max(c, step(abs(p.x-0.5), 0.42) * step(abs(p.y), t));
    if ((m & 2) != 0)  c = max(c, step(abs(p.x-1.0), t) * step(abs(p.y-1.5), 0.5));
    if ((m & 4) != 0)  c = max(c, step(abs(p.x-1.0), t) * step(abs(p.y-0.5), 0.5));
    if ((m & 16) != 0) c = max(c, step(abs(p.x), t) * step(abs(p.y-0.5), 0.5));
    if ((m & 32) != 0) c = max(c, step(abs(p.x), t) * step(abs(p.y-1.5), 0.5));
    return c;
  }
  void main(){
    vec3 N = normalize(vN);
    vec3 base = uColor;
    float spec = 0.0;
    float ballSpec = 0.0, rim = 0.0, wrap = 0.0, sheen = 0.0;
    vec3 V = normalize(uEye - vW);
    if (uMode == 5) {            // shirt + shorts torso: kit pattern, number on the back, fabric weave
      vec3 shirt = uColor;
      if (uPattern == 1) shirt = mix(uColor, uColor2, step(0.5, fract(vL.x / 0.105 + 0.25)));
      if (uPattern == 2) shirt = mix(uColor, uColor2, step(0.5, fract(vL.z / 0.11)));
      base = vL.z < 0.005 ? uColor3 : shirt;
      if (vL.z > -0.01 && vL.z < 0.02) base *= 0.82;                     // waistband shadow
      if (vL.z > 0.525) base = mix(base, uColor2 * 0.9, 0.6);             // collar
      if (uNum > 0 && vL.y < -0.04 && vL.z > 0.17 && vL.z < 0.38) {
        int d1 = uNum / 10, d2 = uNum - d1 * 10;
        float sx = 0.064, sy = 0.1, x = -vL.x;
        float c = 0.0;
        if (d1 > 0) { c = max(c, digit(vec2((x - 0.03) / sx + 0.5, (vL.z - 0.17) / sy), d1)); c = max(c, digit(vec2((x + 0.085) / sx + 0.5, (vL.z - 0.17) / sy), d2)); }
        else c = digit(vec2(x / sx + 0.5, (vL.z - 0.17) / sy), d2);
        vec3 ink = dot(shirt, vec3(0.3, 0.59, 0.11)) > 0.55 ? vec3(0.08, 0.09, 0.12) : vec3(0.97);
        base = mix(base, ink, c);
      }
      base *= 0.93 + 0.07 * hash3(floor(vW * 260.0));                 // knit
      // shirt folds: soft creases running mostly vertically, deeper at the waist and the armpits
      vec3 q = vW * vec3(6.0, 6.0, 2.5);
      float foldW = 0.18 + 0.2 * smoothstep(0.1, -0.05, vL.z) + 0.15 * smoothstep(0.38, 0.48, vL.z) * step(0.15, abs(vL.x));
      N = normalize(N + foldW * (vec3(vnoise(q), vnoise(q + 3.1), vnoise(q + 7.7)) - 0.5));
      sheen = 0.09;
      spec = ggx(N, V, uSun, 0.75) * 0.03;
    } else if (uMode == 6) {     // skin: subsurface scattering approximated per channel below, micro relief, oily sheen
      wrap = 0.35;
      N = normalize(N + 0.045 * (vec3(vnoise(vW * 90.0), vnoise(vW * 90.0 + 5.0), vnoise(vW * 90.0 + 9.0)) - 0.5));
      base *= 0.93 + 0.1 * vnoise(vW * 14.0);                        // uneven tone
      spec = ggx(N, V, uSun, 0.55) * 0.02;                           // skin is only slightly oily, not plastic
    } else if (uMode == 7) {     // cloth / leather (sleeves, socks, shorts legs, gloves): weave, folds, fabric sheen
      base *= 0.92 + 0.08 * hash3(floor(vW * 260.0));
      vec3 q = vW * vec3(5.0, 5.0, 11.0);
      N = normalize(N + 0.28 * (vec3(vnoise(q), vnoise(q + 3.1), vnoise(q + 7.7)) - 0.5));
      sheen = 0.09;
      spec = ggx(N, V, uSun, 0.8) * 0.02;
    } else if (uMode == 12) {    // boot: coloured upper, light sole, a darker collar at the ankle, glossy synthetic
      base = vL.z < -0.064 ? vec3(0.9, 0.9, 0.88) : vL.z > 0.024 ? base * 0.55 : base;   // sole, upper, padded collar
      spec = ggx(N, V, uSun, 0.25) * 0.25;
    } else if (uMode == 8) {     // hair: strands (fine noise) and an anisotropic highlight along the strand direction
      float strand = vnoise(vW * vec3(900.0, 900.0, 60.0));
      base *= 0.7 + 0.5 * strand;
      vec3 Th = normalize(cross(N, vec3(0.0, 0.0, 1.0)) + 1e-4);
      vec3 Hh = normalize(V + uSun);
      float th = dot(Th, Hh);
      spec = pow(sqrt(max(0.0, 1.0 - th * th)), 60.0) * 0.18 * (0.5 + strand) * max(dot(N, uSun), 0.0);
    } else if (uMode == 13) {    // eye: wet and glossy — a sharp catchlight
      spec = ggx(N, V, uSun, 0.08) * 0.6 + pow(max(dot(reflect(-V, N), vec3(0.0, 0.0, 1.0)), 0.0), 40.0) * 0.4;
    } else if (uMode == 9) {     // trees: foliage with clumps, darker underneath
      float n = hash3(floor(vW * 1.6));
      base = mix(uColor * 0.65, uColor * 1.15, n) * (0.72 + 0.28 * N.z);
      wrap = 0.3;
    } else if (uMode == 10) {    // distant hills: banded, hazy
      float n = hash(floor(vW.xy * 0.05));
      base = mix(uColor, uColor2, smoothstep(5.0, 75.0, vL.z)) * (0.9 + 0.1 * n);
    }
    if (uMode == 1 && uBallTexOn == 1) {
      // painted World Cup ball: sample by direction (u = longitude, v = colatitude), gradients taken from whichever
      // of two longitude origins is continuous here, so there is no seam where u wraps
      vec3 p = normalize(vL);
      float lu = atan(p.z, p.x) / 6.2831853, lv = acos(clamp(p.y, -1.0, 1.0)) / 3.1415927;
      vec2 uv = vec2(fract(lu), lv), uv2 = vec2(fract(lu + 0.5), lv);
      vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
      if (abs(dx2.x) < abs(dx.x)) dx.x = dx2.x;
      if (abs(dy2.x) < abs(dy.x)) dy.x = dy2.x;
      base = textureGrad(uBallTex, uv, dx, dy).rgb;
      vec3 tilt = ballGrain(p, 0.05);
      if (uBallNrmOn == 1) {
        // the model's own relief: grooves between the panels, raised graphics, the textured skin
        vec3 nO = textureGrad(uBallNrm, uv, dx, dy).rgb * 2.0 - 1.0;
        float up = dot(nO, p);
        tilt += 1.6 * (nO - p * up);
        base *= 1.0 - 0.45 * smoothstep(0.015, 0.25, 1.0 - up);           // dirt and shadow settle in the grooves
      }
      N = normalize(uBallRot * normalize(p + tilt));
      ballSpec = pow(max(dot(N, normalize(V + uSun)), 0.0), 60.0) * 0.4;
      rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;
    } else if (uMode == 1 && uBall == 0) {
      // classic football: 12 pentagons + 20 hexagons of stitched leather. The seams are real grooves (the normal
      // tilts into them), each panel is puffed up by the air inside, a row of stitch dimples runs along both sides
      // of every seam, and the skin is pebbled and lightly scuffed.
      vec3 p = normalize(vL);
      float s1 = -2.0, s2 = -2.0, pent = 0.0; vec3 c1 = p, c2 = p;
      for (int i = 0; i < 12; i++) { float s = dot(p, PC[i]);
        if (s > s1) { s2 = s1; c2 = c1; s1 = s; c1 = PC[i]; pent = 1.0; } else if (s > s2) { s2 = s; c2 = PC[i]; } }
      for (int i = 0; i < 20; i++) { vec3 c = HC[i] * 1.01174; float s = dot(p, c);
        if (s > s1) { s2 = s1; c2 = c1; s1 = s; c1 = c; pent = 0.0; } else if (s > s2) { s2 = s; c2 = c; } }
      float gap = s1 - s2, fw = fwidth(gap) + 1e-5;
      vec3 g = c1 - c2; g -= p * dot(g, p);                     // which way the gap grows (away from the seam)
      // height across the seam h(gap) (in ball radii): a groove 1.3 mm deep, the panel puffing up out of it, and a
      // row of stitch dimples beside it; the normal tilts against the slope, n ∝ p − h'(gap)·∇gap
      const float W = 0.0075, D = 0.012, PF = 0.006, G0 = 0.0135, SG = 0.0028, DS = 0.0025;
      float e = exp(-(gap * gap) / (W * W));
      float dh = D * 2.0 * gap / (W * W) * e;
      dh *= clamp(W / (1.6 * fw), 0.0, 1.0);                   // too small to see: fade to a plain dark line
      vec3 axis = normalize(cross(c1, c2));
      float along = fract(abs(dot(p, axis)) * 52.0);
      float row = exp(-pow((gap - G0) / SG, 2.0)), dash = smoothstep(0.32, 0.12, abs(along - 0.5));
      float sw = clamp(SG / (1.6 * fw), 0.0, 1.0);              // stitches only when they are big enough to see
      float hole = row * dash * sw;
      dh += DS * dash * sw * 2.0 * (gap - G0) / (SG * SG) * row;
      // each panel is a smooth dome around its own centre (the air pressure pushes it out between the seams)
      vec3 dome = -PF * 30.0 * (c1 - p * dot(c1, p));          // (tilts away from the panel's centre)
      vec3 tilt = -dh * g + dome + ballGrain(p, pent > 0.5 ? 0.035 : 0.06);
      N = normalize(uBallRot * normalize(p + tilt));
      float seam = (1.0 - smoothstep(0.0025, 0.0025 + 2.0 * fw + 0.003, gap));
      vec3 panel = pent > 0.5 ? vec3(0.035, 0.037, 0.045) : vec3(0.93, 0.925, 0.9);
      // shadow pooling in and beside the groove, scuffs and grime on the white leather
      panel *= 1.0 - 0.3 * exp(-(gap * gap) / (6.0 * W * W));
      float sc = vnoise(p * 9.0) * 0.5 + vnoise(p * 60.0) * 0.5;
      panel = mix(panel, panel * vec3(0.9, 0.89, 0.86), smoothstep(0.6, 0.85, sc) * (1.0 - pent) * 0.45);
      panel *= 1.0 - 0.35 * hole;                               // the stitch holes
      base = mix(panel, vec3(0.08, 0.08, 0.09), seam * 0.85);
      ballSpec = pow(max(dot(N, normalize(V + uSun)), 0.0), 55.0) * mix(0.45, 0.22, pent) * (1.0 - seam * 0.8);
      rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;
    } else if (uMode == 1 && uBall == 4) {
      // Trionda (2026): four panels on a tetrahedron, three waves of host colours sweeping in from the seams, gold edges
      vec3 p = normalize(vL);
      vec3 T0 = normalize(vec3(1.0, 1.0, 1.0)), T1 = normalize(vec3(1.0, -1.0, -1.0)), T2 = normalize(vec3(-1.0, 1.0, -1.0)), T3 = normalize(vec3(-1.0, -1.0, 1.0));
      vec3 q = normalize(p + 0.11 * sin(4.0 * p.yzx + vec3(0.3, 1.1, 2.0)));
      float d0 = dot(q, T0), d1 = dot(q, T1), d2 = dot(q, T2), d3 = dot(q, T3);
      float s1 = max(max(d0, d1), max(d2, d3));
      int id = s1 == d0 ? 0 : s1 == d1 ? 1 : s1 == d2 ? 2 : 3;
      float s2 = id == 0 ? max(max(d1, d2), d3) : id == 1 ? max(max(d0, d2), d3) : id == 2 ? max(max(d0, d1), d3) : max(max(d0, d1), d2);
      vec3 c = id == 0 ? T0 : id == 1 ? T1 : id == 2 ? T2 : T3;
      float gap = s1 - s2, fw = fwidth(gap) + 1e-5;
      float seam = 1.0 - smoothstep(0.006, 0.008 + 2.0 * fw, gap);
      vec3 u = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), v = cross(c, u);
      float ang = atan(dot(q, v), dot(q, u));
      float wave = gap - 0.05 * sin(ang * 3.0 + float(id) * 1.7);
      float band = smoothstep(0.025, 0.04, wave) * (1.0 - smoothstep(0.17, 0.19, wave));
      int k = int(mod(floor((ang + 3.14159) / 2.0944) + float(id), 3.0));
      vec3 host = k == 0 ? vec3(0.86, 0.12, 0.16) : k == 1 ? vec3(0.12, 0.62, 0.3) : vec3(0.13, 0.33, 0.82);
      vec3 col = mix(vec3(0.97, 0.97, 0.96), host, band * 0.93);
      col = mix(col, vec3(0.84, 0.68, 0.3), smoothstep(0.195, 0.2, wave) * (1.0 - smoothstep(0.208, 0.213, wave)));
      col *= 0.96 + 0.06 * hash3(floor(p * 160.0));
      base = mix(col, vec3(0.12, 0.12, 0.13), seam);
      ballSpec = pow(max(dot(N, normalize(V + uSun)), 0.0), 60.0) * 0.4 * (1.0 - seam);
      rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;
    } else if (uMode == 1) {
      // modern thermally bonded balls: few large panels with curved seams, and bold graphics along the seams.
      // uBall 1 = six-panel pinwheel (Brazuca-like), 2 = eight-panel (Jabulani-like), 3 = six-panel, dark graphics (Cafusa-like)
      vec3 p = normalize(vL);
      float gap, edge; int id; vec3 q;
      if (uBall == 2) {
        q = p + 0.13 * sin(5.0 * p.zxy + 0.7);                   // wavy octant boundaries → 8 panels
        vec3 a = abs(q);
        gap = min(a.x, min(a.y, a.z));
        id = (q.x > 0.0 ? 1 : 0) + (q.y > 0.0 ? 2 : 0) + (q.z > 0.0 ? 4 : 0);
        vec3 cdir = normalize(sign(q));
        edge = dot(p, cdir);                                       // 1 at the panel centre
      } else {
        q = p + 0.36 * sin(2.6 * p.yzx + vec3(0.4, 1.3, 2.2));   // twisted cube faces → 6 pinwheel panels
        vec3 a = abs(q);
        float m1 = max(a.x, max(a.y, a.z));
        float m2 = a.x + a.y + a.z - m1 - min(a.x, min(a.y, a.z));
        gap = (m1 - m2) * 0.6;
        id = a.x == m1 ? (q.x > 0.0 ? 0 : 1) : a.y == m1 ? (q.y > 0.0 ? 2 : 3) : (q.z > 0.0 ? 4 : 5);
        edge = m1;
      }
      float fw = fwidth(gap) + 1e-5;
      float seam = 1.0 - smoothstep(0.006, 0.006 + 2.0 * fw + 0.004, gap);
      vec3 c1, c2;
      if (uBall == 1) { c1 = (id % 3 == 0) ? vec3(0.95, 0.45, 0.1) : (id % 3 == 1) ? vec3(0.1, 0.32, 0.75) : vec3(0.1, 0.55, 0.3); c2 = vec3(0.05, 0.06, 0.08); }
      else if (uBall == 2) { c1 = (id % 4 == 0) ? vec3(0.1, 0.1, 0.12) : (id % 4 == 1) ? vec3(0.9, 0.7, 0.1) : (id % 4 == 2) ? vec3(0.1, 0.5, 0.55) : vec3(0.75, 0.15, 0.15); c2 = vec3(0.9, 0.9, 0.88); }
      else { c1 = (id % 2 == 0) ? vec3(0.08, 0.08, 0.1) : vec3(0.95, 0.5, 0.1); c2 = vec3(0.1, 0.5, 0.3); }
      // a coloured band running alongside each seam, with a thin accent line inside it
      float band = smoothstep(0.03, 0.045, gap) * (1.0 - smoothstep(0.1, 0.12, gap));
      float accent = smoothstep(0.125, 0.13, gap) * (1.0 - smoothstep(0.14, 0.145, gap));
      vec3 col = vec3(0.96, 0.96, 0.95);
      if (uBall == 2) {
        // a curved triangle centred on each panel: the region where all three |q| components are large
        vec3 a = abs(q) / length(q);
        float tri = smoothstep(0.012, 0.0, 0.47 - min(a.x, min(a.y, a.z)));
        float triEdge = smoothstep(0.012, 0.0, 0.43 - min(a.x, min(a.y, a.z))) - tri;
        col = mix(col, c1, tri * 0.92); col = mix(col, vec3(0.12), triEdge * 0.8); col = mix(col, c1, band * 0.2);
      }
      else { col = mix(col, c1, band); col = mix(col, c2, accent); }
      col *= 0.96 + 0.06 * hash3(floor(p * 160.0));                // fine surface texture
      base = mix(col, vec3(0.12, 0.12, 0.13), seam);
      ballSpec = pow(max(dot(N, normalize(V + uSun)), 0.0), 60.0) * 0.4 * (1.0 - seam);
      rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;
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
    float ndl = dot(N, uSun);
    float diff = max((ndl + wrap) / (1.0 + wrap), 0.0);
    vec3 amb = mix(uGndCol, uSkyCol, N.z * 0.5 + 0.5);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float dist = length(vW - uEye);
    vec3 col;
    if (uStyle == 0) {
      // physically based path: linear light, per-channel subsurface for skin, ambient occlusion, filmic response
      bool person = uMode >= 5 && uMode <= 8 || uMode == 12 || uMode == 13;
      vec3 Lb = toLin(base), sunL = toLin(uSunCol) * 1.6, ambL = toLin(amb);
      vec3 d3 = vec3(diff);
      if (uMode == 6) { vec3 w = vec3(0.55, 0.3, 0.22); d3 = clamp((vec3(ndl) + w) / (1.0 + w), 0.0, 1.0); }   // light bleeds red through skin
      float ao = person ? 0.55 + 0.45 * smoothstep(-0.7, 0.8, N.z) : 1.0;            // undersides and creases darker
      ao *= mix(0.6, 1.0, smoothstep(0.0, 0.22, vW.z));                                // contact darkening near the grass
      col = Lb * (ambL * ao + d3 * sunL) + (spec + ballSpec) * sunL + toLin(vec3(rim)) + sheen * fres * ambL * 3.0 * ao;
      if (uMode == 4) col = toLin(uColor) * 4.0;                                       // floodlight lamps
      col = pow(aces(col * 1.25), vec3(1.0 / 2.2));
    } else {
      col = base * (amb + diff * uSunCol) + (spec + ballSpec) * uSunCol + rim + sheen * fres * uSkyCol * 2.0;
      if (uMode == 4) col = uColor * 1.9;
    }
    col = mix(col, uFog, (1.0 - exp(-dist * uFogK)) * 0.75);
    if (uStyle == 1) {
      // illustrated: flat colour in three tones, diagonal pen hatching in the darkest tone, paper-white haze
      float l = clamp(max(ndl, 0.0) * 0.85 + 0.3 + wrap * 0.2, 0.0, 1.0);
      float tone = l > 0.72 ? 1.0 : l > 0.42 ? 0.84 : 0.7;
      vec3 c = base * tone * 1.05 + (ballSpec > 0.2 ? 0.25 : 0.0);
      if (tone < 0.75) {
        float h = step(0.78, fract((gl_FragCoord.x + gl_FragCoord.y) / 5.0));
        c = mix(c, c * 0.55, h * 0.6);
      }
      if (uMode == 1) c = (base.r < 0.15 && base.g < 0.15 ? vec3(0.13) : base * 1.02) * mix(0.82, 1.0, tone);   // ball: ink panels, design colours kept
      if (uMode == 11) c = vec3(0.11, 0.11, 0.13);
      col = mix(c, vec3(0.94, 0.945, 0.95), (1.0 - exp(-dist * 0.011)) * (uMode == 11 ? 0.6 : 0.85));
    }
    o = vec4(col, 1.0);
  }`;

  // ───────────── real rigged players (js/rig.js): GPU skinning, kit painted by body region ─────────────
  const SKIN_VS = `#version 300 es
  in vec3 aPos; in vec3 aNrm; in vec2 aUV; in vec4 aJ; in vec4 aW; in vec2 aReg; in vec3 aAxis;
  uniform mat4 uVP, uV, uP; uniform float uOutline, uBuild; uniform mat4 uBones[65];
  out vec3 vW, vN, vL; out vec2 vUV; out float vT; flat out float vCls;
  ${OUTLINE_GLSL}
  void main(){
    mat4 S = aW.x * uBones[int(aJ.x)] + aW.y * uBones[int(aJ.y)] + aW.z * uBones[int(aJ.z)] + aW.w * uBones[int(aJ.w)];
    vec3 bp = aAxis + (aPos - aAxis) * uBuild;          // body build: slimmer or broader around the skeleton
    vec4 w = S * vec4(bp, 1.0);
    vW = w.xyz; vN = mat3(S) * aNrm; vUV = aUV; vCls = aReg.x; vT = aReg.y;   // region class is flat: interpolating it would invent classes at seams
    vL = vec3(aPos.x, -aPos.z, aPos.y);                  // bind-pose position (simulator axes) for kit patterns
    gl_Position = placeVertex(vW, vN);
  }`;
  /*
   * The skinned fragment shader reuses the whole material and lighting model of MESH_FS (skin, cloth, hair,
   * eyes; physically based path with filmic tone mapping; ink style) — only the colour and material id come
   * from a small "kit painter" instead of per-instance attributes.
   */
  const SKIN_FS = MESH_FS
    .replace(`in vec3 vCol; flat in int vMd;
  #define uColor vCol
  #define uMode vMd`, `in vec2 vUV; in float vT; flat in float vCls;
  uniform sampler2D uTex, uBrowTex; uniform int uPart, uLongSleeves, uGloves, uOutlineOn, uBrowOn, uCards, uToon; float gA = 1.0; uniform vec3 uBrowCol, uBand; uniform float uScalp, uStubble, uBrowW;
  uniform vec3 uShirt, uShirt2, uShorts, uSocks, uBoots, uGlove, uTint, uFront, uTrim, uSleeves;
  uniform float uSleeveT, uShortsT, uSockT, uCentreZ, uBeltZ, uKneeZ; uniform vec3 uNeck; uniform int uCollar;
  vec3 gCol; int gMd;
  #define uColor gCol
  #define uMode gMd`)
    .replace('void main(){', `
  // a thin headband (uBand = on, eye height and eye forward offset from the neck, bind pose): a ring around the head
  // from the forehead hairline sloping down to eye level at the back, on hair and skin alike
  float bandAt(){
    if (uBand.x < 0.5) return 0.0;
    vec3 r = vL - uNeck; float f = dot(r.xy, normalize(uFront.xy));
    float hb = uBand.y + 0.012 + 0.33 * (f - uBand.z + 0.13);
    return step(abs(r.z - hb), 0.0065) * step(uBand.y - 0.03, r.z);
  }
  // kit painter: body region (bone class + position along the bone) → material colour and shading mode
  void paintKit(){
    vec3 tex = texture(uTex, vUV).rgb;
    if (uPart == 1) { gCol = tex * vec3(0.86, 0.84, 0.83); gMd = 13; return; }                      // eyes
    if (uPart == 2 && uCards == 1) {                                         // MakeHuman hair, brows, lashes: textured cards with alpha
      vec4 tc = texture(uTex, vUV);
      gA = tc.a * (vT > 0.5 ? smoothstep(1.0, 1.7, vT) : 1.0);           // shells (beard, buzz) fade out at their edges
      if (gA < 0.12) discard;
      float lum = dot(tc.rgb, vec3(0.3, 0.59, 0.11));
      float avg = max(0.05, dot(textureLod(uTex, vec2(0.5), 12.0).rgb, vec3(0.3, 0.59, 0.11)));   // the texture's own mean
      gCol = clamp(lum / avg, 0.25, 2.2) * uTint * 0.85; gMd = 8; return;
    }
    if (uPart == 2 && uToon == 1) {                                           // stylized: sculpted, solid hair with a clean edge
      if (vT > 0.5 && vT < 1.12) discard;                                   // the thin rim is left to the painted hairline
      gCol = uTint * (0.9 + 0.2 * dot(tex, vec3(0.33))); gMd = 8;
      if (bandAt() > 0.5) { gCol = vec3(0.95); gMd = 7; }
      return;
    }
    if (uPart == 2) {                                                         // hair, beard, brows
      if (vT > 0.5 && vT - 1.0 < 0.95 * dot(tex, vec3(0.33))) discard;      // shells thin out strand by strand at their edges
      gCol = mix(tex, vec3(dot(tex, vec3(0.33))), 0.6) * uTint * 1.6; gMd = 8; return;
    }
    vec3 skin = tex * uTint;
    if (uBrowOn == 1) {     // painted eyebrows, hairline shadow and beard shadow, in the hair colour
      vec3 mk = texture(uBrowTex, vUV).rgb;
      // R holds a brow thickness field (1 on the brow's centre line, 0.5 at a medium brow's edge): cut per player
      float brow = smoothstep(1.0 - uBrowW - 0.04, 1.0 - uBrowW + 0.04, mk.r);
      skin = mix(skin, uBrowCol, max(brow * 0.92, max(mk.g * uScalp * 0.6, mk.b * uStubble * 0.5)));
    }
    float cls = floor(vCls + 0.5), t = vT;
    vec3 shirt = uShirt;
    if (uPattern == 1) shirt = mix(uShirt, uShirt2, step(0.5, fract(vL.x / 0.105 + 0.25)));
    if (uPattern == 2) shirt = mix(uShirt, uShirt2, step(0.5, fract(vL.z / 0.11)));
    gCol = skin; gMd = 6;
    if (cls < 0.5) { gCol = skin; gMd = 6; }
    else if (cls < 1.5) {                                                    // torso: shirt, with the number on the back
      gCol = shirt; gMd = 7;
      vec3 rel = vec3(vL.x, vL.y, vL.z - uCentreZ);
      float back = -dot(normalize(vec3(uFront.xy, 0.0)), vec3(rel.xy, 0.0));
      if (uNum > 0 && back > 0.06 && rel.z > 0.12 && rel.z < 0.36) {
        int d1 = uNum / 10, d2 = uNum - d1 * 10;
        vec3 side = normalize(cross(vec3(0.0, 0.0, 1.0), uFront));
        float x = dot(rel, side), sx = 0.07, sy = 0.11;
        float c = 0.0;
        if (d1 > 0) { c = max(c, digit(vec2((x - 0.035) / sx + 0.5, (rel.z - 0.12) / sy), d1)); c = max(c, digit(vec2((x + 0.095) / sx + 0.5, (rel.z - 0.12) / sy), d2)); }
        else c = digit(vec2(x / sx + 0.5, (rel.z - 0.12) / sy), d2);
        vec3 ink = dot(shirt, vec3(0.3, 0.59, 0.11)) > 0.55 ? vec3(0.08, 0.09, 0.12) : vec3(0.97);
        gCol = mix(gCol, ink, c);
      }
    }
    else if (cls < 2.5) { gCol = uShorts; gMd = 7; }                         // seat and hips (belt line handled below)
    else if (cls < 3.5) { if (t < uSleeveT || uLongSleeves == 1) { gCol = (uCollar == 1 && uLongSleeves == 0 && t > uSleeveT - 0.07) ? uTrim : uSleeves; gMd = 7; } }   // upper arm: sleeve (own colour on some kits), cuffed
    else if (cls < 4.5) { if (uLongSleeves == 1) { gCol = uSleeves; gMd = 7; } }                  // forearm
    else if (cls < 5.5) { if (uGloves == 1) { gCol = uGlove; gMd = 7; } }                      // hand
    else if (cls < 6.5) { if (t < uShortsT) { gCol = uShorts; gMd = 7; } }      // thigh: shorts down to the hem
    else if (cls < 7.5) { }
    else { gCol = vL.z < 0.022 ? vec3(0.88, 0.88, 0.86) : uBoots; gMd = 7; }  // feet: boots, with a light sole
    // straight edges by height on the body (per-triangle regions would make them jagged):
    // the belt line between shirt and shorts, and the top of the socks (below the knee; over it for keepers)
    if (cls > 0.5 && cls < 2.5) { if (vL.z > uBeltZ) { gCol = shirt; gMd = 7; } else { gCol = uShorts; gMd = 7; } }
    if (uCollar == 1 && cls < 1.5) {                                  // round neckline, dipping at the front
      vec2 r = vL.xy - uNeck.xy;
      float fr = max(0.0, dot(r, normalize(uFront.xy)) / max(length(r), 1e-4));
      float cz = uNeck.z - 0.02 - 0.035 * fr;
      if (vL.z >= cz) { gCol = skin; gMd = 6; }
      else if (cls < 0.5 || vL.z > cz - 0.012) { gCol = vL.z > cz - 0.012 ? uTrim : shirt; gMd = 7; }
    }
    float sockTop = uKneeZ + (uSockT < 1.0 ? 0.07 : -0.075);
    if ((cls > 5.5 && cls < 7.5) && vL.z < sockTop && !(cls < 6.5 && t < uShortsT)) { gCol = uSocks; gMd = 7; }
    if (cls < 0.5 && bandAt() > 0.5) { gCol = vec3(0.95); gMd = 7; }        // headband over the forehead
  }
  void main(){ paintKit(); if (uOutlineOn == 1) gMd = 11;`)
    .replace(`      base *= 0.92 + 0.08 * hash3(floor(vW * 260.0));
      vec3 q = vW * vec3(5.0, 5.0, 11.0);
      N = normalize(N + 0.28 * (vec3(vnoise(q), vnoise(q + 3.1), vnoise(q + 7.7)) - 0.5));`, `      base *= 0.94 + 0.06 * hash3(floor(vL * 300.0));                  // knit (fixed to the cloth, not the world)
      vec3 q = vL * vec3(7.0, 7.0, 2.6), q2 = vL * vec3(24.0, 24.0, 15.0);   // long drapes + small creases
      N = normalize(N + 0.5 * (vec3(vnoise(q), vnoise(q + 3.1), vnoise(q + 7.7)) - 0.5) + 0.18 * (vec3(vnoise(q2), vnoise(q2 + 3.1), vnoise(q2 + 7.7)) - 0.5));
      if (uToon == 0) base *= 0.88 + 0.22 * vnoise(q);`)
    // stylized players: no skin mottling, micro relief or strand noise (flat painted colour)
    .replace('base *= 0.93 + 0.1 * vnoise(vW * 14.0);', 'if (uToon == 0) base *= 0.93 + 0.1 * vnoise(vW * 14.0);')
    .replace('N = normalize(N + 0.045 *', 'if (uToon == 0) N = normalize(N + 0.045 *')
    .replace('base *= 0.7 + 0.5 * strand;', 'if (uToon == 0) base *= 0.7 + 0.5 * strand;')
    // stylized heads (skin, hair, beard, eyes) take their key light leaning toward the camera, as in animation:
    // the side you see stays lit even against the sun, and the shadow is kept for the far edges of the face
    // the kit leans a little less, so the sun's side still reads; its fold bumps barely touch the light/shade edge
    .replace('float ndl = dot(N, uSun);', `bool hdL = uMode == 6 || uMode == 8 || uMode == 13;
    vec3 Lk = uToon == 1 ? normalize(uSun + (hdL ? 1.4 : 1.1) * V + vec3(0.0, 0.0, 0.35)) : uSun;
    float ndl = dot(uToon == 1 ? normalize(mix(normalize(vN), N, 0.25)) : N, Lk);`)
    .replace('o = vec4(col, 1.0);', `
    if (uToon == 1 && uStyle == 0) {
      // cel shading: two clean light tones with cool (warm for skin) shadows, a rim light, crisp highlights
      vec3 Ng = normalize(vN);
      vec3 Nt = (uMode == 7 || uMode == 5) ? normalize(mix(Ng, N, 0.15)) : Ng;  // cloth folds break the shadow edge a little
      float nl = dot(Nt, Lk);
      bool sk = uMode == 6 || uMode == 8;                                                  // faces: mostly lit, a softer terminator (no harsh half-face split)
      float lit = sk ? smoothstep(-0.35, -0.05, nl) : smoothstep(-0.03, 0.07, nl), hi = smoothstep(0.6, 0.68, nl);
      vec3 sunT = uSunCol / max(max(uSunCol.r, uSunCol.g), max(uSunCol.b, 1e-3));
      vec3 shade = uMode == 6 ? vec3(0.88, 0.75, 0.73) : vec3(0.6, 0.63, 0.78);   // skin: a light, warm shade (faces read clearly)
      vec3 c = base * mix(shade * (0.8 + 0.2 * max(Nt.z, 0.0)), mix(vec3(1.0), sunT, 0.2) * (1.02 + 0.08 * hi), lit);
      float rimT = smoothstep(0.6, 0.68, 1.0 - max(dot(Ng, V), 0.0));
      c += (base * 0.25 + 0.04) * rimT * (0.4 + 0.6 * lit);
      if (uMode == 8) {                                                     // hair: one crisp highlight band
        vec3 Th = normalize(cross(Ng, vec3(0.0, 0.0, 1.0)) + 1e-4);
        float th = dot(Th, normalize(V + uSun));
        float band = smoothstep(0.9, 0.94, sqrt(max(0.0, 1.0 - th * th))) * lit;
        c += (base * 0.45 + 0.05) * band;
      }
      if (uMode == 13) c = base * (0.88 + 0.12 * lit) + vec3(0.9) * smoothstep(0.93, 0.96, dot(reflect(-V, Ng), uSun));
      if (uMode == 12) c += vec3(0.35) * smoothstep(0.9, 0.93, dot(reflect(-V, Ng), uSun));
      c *= mix(0.7, 1.0, smoothstep(0.0, 0.2, vW.z));                         // contact shadow on the grass
      if (uMode == 11) c = base * 0.22 + 0.02;                                // outline: a dark shade of the part's own colour
      col = mix(c, uFog, (1.0 - exp(-dist * uFogK)) * 0.75);
    }
    o = vec4(col, gA);`);            // hair cards: alpha to coverage

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
    if (vs.indexOf('aM0') >= 0) ['aM0', 'aM1', 'aM2', 'aCM'].forEach((n, i) => gl.bindAttribLocation(p, 2 + i, n));
    else if (vs.indexOf('aCM') >= 0) gl.bindAttribLocation(p, 2, 'aCM');
    if (vs.indexOf('aReg') >= 0) ['aUV', 'aJ', 'aW', 'aReg', 'aAxis'].forEach((n, i) => gl.bindAttribLocation(p, 2 + i, n));
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

  /** Truncated cone along +z (z 0..1), radius 1 at the bottom and `t` at the top, with smooth normals. */
  function taperMesh(seg, t) {
    const v = [], slope = 1 - t;
    const nrm = (c, s) => { const l = Math.hypot(1, slope); return [c / l, s / l, slope / l]; };
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = nrm(c0, s0), n1 = nrm(c1, s1);
      v.push(c0, s0, 0, ...n0, c1, s1, 0, ...n1, c1 * t, s1 * t, 1, ...n1);
      v.push(c0, s0, 0, ...n0, c1 * t, s1 * t, 1, ...n1, c0 * t, s0 * t, 1, ...n0);
    }
    return new Float32Array(v);
  }

  /**
   * Torso as a loft of super-elliptical rings (local x = right, y = forward, z = up; metres for a 1.8 m adult,
   * z = 0 at the pelvis joint). The shader colours z < 0 as shorts.
   */
  function torsoMesh() {
    const rings = [   // z, half-width, half-depth (front), half-depth (back), forward offset
      [-0.13, 0.150, 0.100, 0.115, 0.0], [-0.07, 0.168, 0.110, 0.125, 0.0], [0.02, 0.163, 0.104, 0.112, 0.0],
      [0.12, 0.148, 0.098, 0.100, 0.005], [0.22, 0.158, 0.108, 0.104, 0.01], [0.32, 0.182, 0.122, 0.108, 0.012],
      // chest → rounded shoulders sloping into the trapezius and neck (no flat "shelf" at the top)
      [0.40, 0.198, 0.122, 0.112, 0.008], [0.445, 0.203, 0.112, 0.108, 0.004], [0.483, 0.194, 0.095, 0.098, 0.0],
      [0.512, 0.168, 0.078, 0.086, -0.004], [0.534, 0.128, 0.066, 0.074, -0.006], [0.55, 0.09, 0.058, 0.062, -0.004],
      [0.562, 0.064, 0.052, 0.055, 0.0],
    ];
    const seg = 32, pe = 2.3;
    const P = (r, a) => {
      const [z, w, df, db, off] = rings[r];
      const c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / pe) * w;
      const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / pe) * (s > 0 ? df : db) + off;
      return [x, y, z];
    };
    const pts = [];
    for (let r = 0; r < rings.length; r++) { const row = []; for (let i = 0; i <= seg; i++) row.push(P(r, (i / seg) * Math.PI * 2)); pts.push(row); }
    const normalAt = (r, i) => {
      const a = pts[r][(i + 1) % seg], b = pts[r][(i + seg - 1) % seg];
      const c = pts[Math.min(r + 1, rings.length - 1)][i], d = pts[Math.max(r - 1, 0)][i];
      return norm(cross(sub(a, b), sub(c, d)));
    };
    const v = [];
    const put = (r, i) => { const p = pts[r][i % seg], n = normalAt(r, i % seg); v.push(p[0], p[1], p[2], n[0], n[1], n[2]); };
    for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < seg; i++) {
      put(r, i); put(r, i + 1); put(r + 1, i + 1);
      put(r, i); put(r + 1, i + 1); put(r + 1, i);
    }
    // caps (bottom closes inside the shorts, top under the neck)
    for (const [r, nz] of [[0, -1], [rings.length - 1, 1]]) {
      const z = rings[r][0];
      for (let i = 0; i < seg; i++) {
        const a = pts[r][i], b = pts[r][(i + 1) % seg];
        v.push(0, 0, z, 0, 0, nz, a[0], a[1], a[2], 0, 0, nz, b[0], b[1], b[2], 0, 0, nz);
      }
    }
    return new Float32Array(v);
  }

  /** A conifer-ish tree: trunk + three stacked foliage cones (unit height 1; local z = 0..1 for shading). */
  function treeMesh() {
    const v = [];
    const cone = (z0, z1, r, seg) => {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const p0 = [Math.cos(a0) * r, Math.sin(a0) * r, z0], p1 = [Math.cos(a1) * r, Math.sin(a1) * r, z0], tp = [0, 0, z1];
        const n0 = norm([Math.cos(a0), Math.sin(a0), r / (z1 - z0)]), n1 = norm([Math.cos(a1), Math.sin(a1), r / (z1 - z0)]);
        v.push(...p0, ...n0, ...p1, ...n1, ...tp, ...norm(add3(n0, n1)));
      }
    };
    cone(0.18, 0.62, 0.36, 9); cone(0.38, 0.84, 0.29, 9); cone(0.6, 1.0, 0.2, 9);
    return new Float32Array(v);
  }
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  /**
   * Direction in which the middle joint B sticks out of the line A→C (times `sign`), blended with the body's
   * front F so that a nearly straight limb still has a sensible "front".
   */
  function bendDir(A, B, C, F, sign) {
    const ac = sub(C, A), ab = sub(B, A), l2 = dot(ac, ac) || 1;
    const t = dot(ab, ac) / l2;
    const off = [ab[0] - ac[0] * t, ab[1] - ac[1] * t, ab[2] - ac[2] * t];
    const m = Math.hypot(off[0], off[1], off[2]);
    if (m < 0.01) return F;
    const w = Math.min(1, m / 0.04);
    return norm([F[0] * (1 - w) + sign * off[0] / m * w, F[1] * (1 - w) + sign * off[1] / m * w, F[2] * (1 - w) + sign * off[2] / m * w]);
  }

  /** A ring of rolling hills around the stadium (local z = 0..1 used for snow/rock shading). */
  function hillsMesh() {
    const v = [], seg = 160, rIn = 420, rOut = 560;
    const h = (a) => 38 + 30 * Math.sin(a * 3 + 1.3) + 18 * Math.sin(a * 7 + 0.4) + 9 * Math.sin(a * 17 + 2.0) + 5 * Math.sin(a * 31);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a, r, z) => [52 + Math.cos(a) * r, Math.sin(a) * r, z];
      const A = p(a0, rIn, -2), B = p(a1, rIn, -2), Ct = p(a1, rOut, h(a1)), D = p(a0, rOut, h(a0));
      const n = norm(cross(sub(B, A), sub(D, A)));
      const nn = n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
      for (const q of [A, B, Ct, A, Ct, D]) v.push(q[0], q[1], q[2], nn[0], nn[1], nn[2]);
    }
    return new Float32Array(v);
  }

  /**
   * Lighting presets. sun: direction toward the sun; skyZen/skyHor: sky gradient; fog: haze colour and density;
   * sunCol/skyCol/gndCol: key light and hemisphere ambient for meshes; grass: overall pitch brightness;
   * pool: how much the floodlights out-shine the edges of the pitch.
   */
  const LIGHTS = {
    day: { label: 'Day', sun: norm([-0.42, -0.35, 0.84]), zen: [0.16, 0.36, 0.72], hor: [0.62, 0.76, 0.90], fog: [0.66, 0.76, 0.86], fogK: 0.0022,
      sunCol: [0.80, 0.77, 0.70], skyCol: [0.55, 0.60, 0.66], gndCol: [0.33, 0.36, 0.30], cloud: [0.97, 0.97, 0.99], grass: [1.05, 1.05, 1.0], pool: 0.0,
      stars: 0, disc: 1.0, lamps: [0.75, 0.75, 0.72], shadow: 0.42 },
    dusk: { label: 'Sunset', sun: norm([0.55, -0.80, 0.22]), zen: [0.12, 0.17, 0.38], hor: [0.95, 0.55, 0.32], fog: [0.55, 0.42, 0.40], fogK: 0.0032,
      sunCol: [0.85, 0.58, 0.38], skyCol: [0.46, 0.44, 0.52], gndCol: [0.30, 0.26, 0.26], cloud: [0.78, 0.52, 0.50], grass: [0.92, 0.86, 0.80], pool: 0.2,
      stars: 0, disc: 1.4, lamps: [1.0, 0.95, 0.80], shadow: 0.5 },
    night: { label: 'Night', sun: norm([-0.32, -0.46, 0.83]), zen: [0.012, 0.02, 0.06], hor: [0.08, 0.10, 0.17], fog: [0.07, 0.08, 0.13], fogK: 0.004,
      sunCol: [0.62, 0.64, 0.68], skyCol: [0.40, 0.42, 0.50], gndCol: [0.22, 0.24, 0.24], cloud: [0.10, 0.11, 0.16], grass: [0.95, 0.97, 0.98], pool: 0.55,
      stars: 0.9, disc: 0.0, lamps: [1.0, 0.97, 0.88], shadow: 0.45 },
  };

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
        return { vao, buf: b, count: data.length / (stride === 2 ? 2 : 6) };
      };
      /** Attach an instance buffer (model rows + colour/mode, 16 floats per instance) to a mesh. */
      const instanced = (mesh, max) => {
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib);
        gl.bufferData(gl.ARRAY_BUFFER, max * 64, gl.DYNAMIC_DRAW);
        for (let i = 0; i < 4; i++) {
          gl.enableVertexAttribArray(2 + i); gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 64, i * 16); gl.vertexAttribDivisor(2 + i, 1);
        }
        gl.bindVertexArray(null);
        mesh.inst = { vao, ib, max, data: new Float32Array(max * 16), n: 0 };
        return mesh;
      };
      this.instMeshes = [];
      this._instanced = (m, max) => { this.instMeshes.push(instanced(m, max)); return m; };
      this.fsTri = staticBuf(new Float32Array([-1, -1, 3, -1, -1, 3]), 2);
      this.groundQuad = staticBuf(new Float32Array([-500, -600, 600, -600, 600, 600, -500, -600, 600, 600, -500, 600]), 2);
      this.sphere = staticBuf(sphereMesh(24, 14), 6);
      this.ballMesh = staticBuf(sphereMesh(72, 40), 6);   // smooth silhouette for the ball
      this.cyl = staticBuf(cylinderMesh(14), 6);
      // people
      this.instProg = compile(gl, INST_VS, MESH_FS);
      this.bodySphere = this._instanced(staticBuf(sphereMesh(16, 10), 6), 1024);
      this.tapers = [0.55, 0.65, 0.75, 0.85, 1.0].map((t) => ({ t, mesh: this._instanced(staticBuf(taperMesh(14, t), 6), 512) }));
      this.torso = staticBuf(torsoMesh(), 6);
      // sculpted static parts (instanced: one draw per part type for all people)
      const S = window.FKSculpt;
      this.parts = {
        head: this._instanced(staticBuf(S.headMesh(), 6), 32),
        hair: Object.fromEntries(['short', 'buzz', 'long'].map((st) => [st, this._instanced(staticBuf(S.hairMesh(st), 6), 32)])),
        beard: this._instanced(staticBuf(S.beardMesh(), 6), 32),
        handL: this._instanced(staticBuf(S.handMesh(-1), 6), 32),
        handR: this._instanced(staticBuf(S.handMesh(1), 6), 32),
        glove: this._instanced(staticBuf(S.gloveMesh(), 6), 8),
        boot: this._instanced(staticBuf(S.bootMesh(), 6), 64),
      };
      // dynamic limb buffer (pos, normal, colour, mode) + indices, rewritten each frame
      this.dynProg = compile(gl, DYN_VS, MESH_FS);
      this.limbs = { v: new Float32Array(10 * 40000), n: 0, idx: new Uint16Array(240000), ni: 0 };
      this.limbVao = gl.createVertexArray(); gl.bindVertexArray(this.limbVao);
      this.limbBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.limbBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.limbs.v.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
      this.limbIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.limbIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.limbs.idx.byteLength, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      this.light = LIGHTS.dusk;

      // surroundings: a forest and a ring of hills beyond the open end of the stadium
      {
        const rnd = (() => { let a = 12345; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
        const unitTree = treeMesh(), leaves = [], trunks = [];
        for (let i = 0; i < 520; i++) {
          const x = -160 + rnd() * 420, y = -260 + rnd() * 520;
          if (x > -72 && x < 176 && Math.abs(y) < 106) continue;          // not inside the stadium
          if (x > 176 && x < 200 && Math.abs(y) < 30) continue;            // keep an avenue clear behind the open end
          const h = 9 + rnd() * 11, w = h * (0.75 + rnd() * 0.3), rot = rnd() * 6.28;
          const c = Math.cos(rot), s = Math.sin(rot);
          for (let j = 0; j < unitTree.length; j += 6) {
            const lx = unitTree[j] * w, ly = unitTree[j + 1] * w, lz = unitTree[j + 2] * h;
            const nx = unitTree[j + 3], ny = unitTree[j + 4], nz = unitTree[j + 5];
            leaves.push(x + c * lx - s * ly, y + s * lx + c * ly, lz, c * nx - s * ny, s * nx + c * ny, nz);
          }
          box(trunks, x - 0.25, y - 0.25, 0, x + 0.25, y + 0.25, h * 0.22);
        }
        this.forest = staticBuf(new Float32Array(leaves), 6);
        this.trunks = staticBuf(new Float32Array(trunks), 6);
        this.hills = staticBuf(hillsMesh(), 6);
      }

      // stadium
      const st = [], bd = [];
      const z0 = 1.0, z1 = 17, d0 = 44, d1 = 72;
      quad(st, [-40, -d0, z0], [145, -d0, z0], [145, -d1, z1], [-40, -d1, z1]);
      quad(st, [145, d0, z0], [-40, d0, z0], [-40, d1, z1], [145, d1, z1]);
      quad(st, [-10, 72, z0], [-10, -72, z0], [-38, -72, z1], [-38, 72, z1]);
      quad(st, [115, -72, z0], [115, 72, z0], [143, 72, z1], [143, -72, z1]);
      // upper tier, concourse, back walls, roof and floodlights
      quad(st, [-65, -75, 19], [170, -75, 19], [170, -99, 33], [-65, -99, 33]);
      quad(st, [170, 75, 19], [-65, 75, 19], [-65, 99, 33], [170, 99, 33]);
      quad(st, [-41, 99, 19], [-41, -99, 19], [-65, -99, 33], [-65, 99, 33]);
      // the far end (behind the kicker) is a single low stand, so the landscape beyond it is visible
      const cn = [], rf = [], lp = [];
      quad(cn, [-40, -72, 17], [145, -72, 17], [145, -75, 19], [-40, -75, 19]);
      quad(cn, [145, 72, 17], [-40, 72, 17], [-40, 75, 19], [145, 75, 19]);
      quad(cn, [-38, 72, 17], [-38, -72, 17], [-41, -99, 19], [-41, 99, 19]);
      quad(cn, [143, -72, 17], [143, 72, 17], [143, 72, 18.5], [143, -72, 18.5]);       // rear parapet of the low stand
      quad(cn, [-65, -99, 33], [170, -99, 33], [170, -99, 38.5], [-65, -99, 38.5]);
      quad(cn, [170, 99, 33], [-65, 99, 33], [-65, 99, 38.5], [170, 99, 38.5]);
      quad(cn, [-65, 99, 33], [-65, -99, 33], [-65, -99, 38.5], [-65, 99, 38.5]);
      quad(cn, [170, -99, 19], [170, -75, 19], [170, -75, 38.5], [170, -99, 38.5]);    // end caps of the side tiers
      quad(cn, [170, 75, 19], [170, 99, 19], [170, 99, 38.5], [170, 75, 38.5]);
      quad(cn, [143, -72, 0], [143, 72, 0], [143, 72, 17], [143, -72, 17]);             // back wall of the low stand
      box(cn, 143.5, -14, 18.5, 145, 14, 27);                                            // big screen
      quad(rf, [-66, -70, 36.5], [171, -70, 36.5], [171, -100, 38.5], [-66, -100, 38.5]);
      quad(rf, [171, 70, 36.5], [-66, 70, 36.5], [-66, 100, 38.5], [171, 100, 38.5]);
      quad(rf, [-36, -100, 36.5], [-36, 100, 36.5], [-66, 100, 38.5], [-66, -100, 38.5]);
      for (let x = -30; x <= 135; x += 11) for (const s of [-1, 1]) box(lp, x, s * 69.4 - 0.5, 35.4, x + 5, s * 69.4 + 0.5, 36.4);
      for (let y = -60; y <= 60; y += 12) box(lp, -35.4, y, 35.4, -34.4, y + 5, 36.4);
      for (const mx of [-62, 168]) for (const my of [-97, 97]) {       // corner masts with lamp banks
        const s = my > 0 ? -1 : 1, sx = mx > 0 ? -1 : 1;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)
          box(lp, mx + sx * (c * 1.5), my + s * (r * 1.5 + 1.0), 59 + r * 0, mx + sx * (c * 1.5 + 1.2), my + s * (r * 1.5 + 2.2), 61.5);
      }
      this.upper = staticBuf(new Float32Array(cn), 6);
      this.roof = staticBuf(new Float32Array(rf), 6);
      this.lamps = staticBuf(new Float32Array(lp), 6);
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
      try { this._initModels(); } catch (e) { this.models = null; console.warn('Player models unavailable, using sculpted bodies:', e); }
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

    /** GL texture of a painted ball (window.FKBallModels[id].texture), loaded once; null until ready or if none. */
    _ballTexture(id, normal) {
      id = id || 'engine';                       // no ball chosen = the classic engine ball
      const src = typeof self !== 'undefined' && self.FKBallModels && self.FKBallModels[id];
      // a real model brings its texture baked onto a sphere map; a painted ball is a sphere map already;
      // normal = its baked object-space normal map instead (same layout)
      const url = src && (normal ? src.sphereNormal : (src.sphereTexture || (src.sphere ? src.texture : null)));
      if (!url) return null;
      this._btex = this._btex || {};
      const key = normal ? id + '#n' : id, e = this._btex[key];
      if (e) return e.ready ? e.tex : null;
      const gl = this.gl, tex = gl.createTexture(), rec = { tex, ready: false };
      this._btex[key] = rec;
      const img = new Image();
      img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const ani = gl.getExtension('EXT_texture_filter_anisotropic');
        if (ani) gl.texParameterf(gl.TEXTURE_2D, ani.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        rec.ready = true;
      };
      img.src = url;
      return null;
    }

    // ── primitive drawing ──
    _prim(mesh, o, X, Y, Z, sx, sy, sz, color, mode) {
      if (this._batching && mesh.inst && mesh.inst.n < mesh.inst.max) {   // queue for one instanced draw
        const I = mesh.inst, d = I.data, k = I.n++ * 16;
        d[k] = X[0] * sx; d[k + 1] = Y[0] * sy; d[k + 2] = Z[0] * sz; d[k + 3] = o[0];
        d[k + 4] = X[1] * sx; d[k + 5] = Y[1] * sy; d[k + 6] = Z[1] * sz; d[k + 7] = o[1];
        d[k + 8] = X[2] * sx; d[k + 9] = Y[2] * sy; d[k + 10] = Z[2] * sz; d[k + 11] = o[2];
        d[k + 12] = color[0]; d[k + 13] = color[1]; d[k + 14] = color[2]; d[k + 15] = mode || 0;
        return;
      }
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

    // ── people ──
    /** Tapered limb from a (radius r0) to b (radius r1). */
    _seg(a, b, r0, r1, color, mode) {
      if (r1 > r0) { [a, b] = [b, a]; [r0, r1] = [r1, r0]; }
      const d = sub(b, a), L = Math.hypot(d[0], d[1], d[2]);
      if (L < 1e-5) return;
      const Z = [d[0] / L, d[1] / L, d[2] / L];
      let X = Math.abs(Z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const Y = norm(cross(Z, X)); X = cross(Y, Z);
      const t = r1 / r0;
      let best = this.tapers[0];
      for (const tp of this.tapers) if (Math.abs(tp.t - t) < Math.abs(best.t - t)) best = tp;
      this._prim(best.mesh, a, X, Y, Z, r0, r0, L, color, mode);
    }
    _sph(c, r, color, mode) { this._prim(this.bodySphere, c, [1, 0, 0], [0, 1, 0], [0, 0, 1], r, r, r, color, mode); }
    _ell(c, X, Y, Z, sx, sy, sz, color, mode) { this._prim(this.bodySphere, c, X, Y, Z, sx, sy, sz, color, mode); }

    /**
     * Draw a person from joint positions (see js/people.js) dressed with `look`:
     * { skin, hair, hairStyle: short|buzz|long|bald, beard, kit:{shirt, shirt2, pattern, shorts, socks, number},
     *   boots, gloves (keeper), longSleeves }
     */
    _body(b, look) {
      const gl = this.gl, u = this.mesh.u, k = b.k;
      const kit = look.kit, skin = look.skin, P = (p, a, A, c, Cc, e, E) => [p[0] + a * A[0] + c * Cc[0] + e * E[0], p[1] + a * A[1] + c * Cc[1] + e * E[1], p[2] + a * A[2] + c * Cc[2] + e * E[2]];
      const U = b.U, F = b.F, Rt = b.Rt;
      const SK = 6, CL = 7;
      const S = window.FKSculpt, W = this.limbs;
      const sk = [skin[0], skin[1], skin[2], SK], col = (c, m) => [c[0], c[1], c[2], m];
      // legs: one sculpted tube hip → knee → ankle, with shorts and socks painted on
      for (const s of ['L', 'R']) {
        const l = b.legs[s];
        const L1 = Math.hypot(...sub(l.knee, l.hip)), L2 = Math.hypot(...sub(l.ankle, l.knee)), sJ = L1 / (L1 + L2);
        const shortsEnd = look.longShorts ? sJ * 0.82 : sJ * 0.42;
        // outfield socks stop just below the knee; keepers pull theirs up over the knee to meet the long shorts
        const sockStart = look.longShorts ? sJ * 0.84 : sJ + (1 - sJ) * 0.1;
        const prof = S.legRadius(sJ, k);
        const radius = (t, c) => prof(t, c) + (t < shortsEnd ? (0.017 + 0.006 * (1 - t / shortsEnd)) * k : t > sockStart ? 0.003 * k : 0);
        const paint = (t) => (t < shortsEnd ? col(kit.shorts, CL) : t > sockStart ? col(kit.socks, CL) : sk);
        // the leg's "front": where the knee sticks out from the hip→ankle line (else the body's front)
        const fwdHint = bendDir(l.hip, l.knee, l.ankle, F, 1);
        S.tube(W, [l.hip, l.knee, l.ankle], fwdHint, 20, 14, radius, paint, [shortsEnd, sockStart]);
        // boot (sculpted), aligned ankle → toe
        const fd = norm(sub(l.toe, l.ankle));
        let fs0 = cross(fd, U);
        if (Math.hypot(...fs0) < 0.2) fs0 = cross(fd, F);            // toe pointing straight down: use the body's front
        const fs = norm(fs0), fu = cross(fs, fd);
        this._prim(this.parts.boot, l.ankle, fs, fd, fu, k, k, k, look.boots, 12);
      }
      // torso (shirt + shorts), via the lofted mesh
      gl.uniform3fv(u.uColor2, kit.shirt2 || kit.shirt);
      gl.uniform3fv(u.uColor3, kit.shorts);
      gl.uniform1i(u.uNum, kit.number || 0);
      gl.uniform1i(u.uPattern, kit.pattern || 0);
      // torso frame from the spine and the shoulder line (so twists and shoulder rolls carry the chest with them)
      const tu = norm(sub(b.neck, b.pelvis));
      const sl = sub(b.arms.R.sh, b.arms.L.sh);
      const tr = norm(sub(sl, [tu[0] * dot(sl, tu), tu[1] * dot(sl, tu), tu[2] * dot(sl, tu)]));
      const tf = cross(tu, tr);
      const torsoArgs = [b.pelvis, tr, tf, tu, k, k, Math.hypot(...sub(b.neck, b.pelvis)) / 0.52, kit.shirt, 5];
      this._prim(this.torso, ...torsoArgs);
      if (this.ink) this._torsoQ.push(torsoArgs);
      // arms: sculpted tube shoulder → elbow → wrist; sleeves painted on (full length for the keeper)
      for (const s of ['L', 'R']) {
        const a = b.arms[s], sg = s === 'L' ? -1 : 1;
        const L1 = Math.hypot(...sub(a.elbow, a.sh)), L2 = Math.hypot(...sub(a.hand, a.elbow)), sJ = L1 / (L1 + L2);
        const sleeveEnd = look.longSleeves ? 1.01 : sJ * 0.5;
        const prof = S.armRadius(sJ, k);
        const radius = (t, c) => prof(t, c) + (t < sleeveEnd ? (look.longSleeves ? 0.006 : 0.011) * k : 0);
        const paint = (t) => (t < sleeveEnd ? col(kit.sleeves || kit.shirt, CL) : sk);
        // the arm's front: the inside of the elbow bend (opposite to where the elbow sticks out), else the body's front
        const armF = bendDir(a.sh, a.elbow, a.hand, F, -1);
        // start the tube a little inside the shoulder so it grows out of the torso
        const shIn = add3(a.sh, [tr[0] * -sg * 0.025 * k, tr[1] * -sg * 0.025 * k, tr[2] * -sg * 0.025 * k]);
        S.tube(W, [shIn, a.elbow, a.hand], armF, 16, 12, radius, paint, [sleeveEnd]);
        const hd = norm(sub(a.hand, a.elbow)), hs0 = cross(hd, F);
        const hs = Math.hypot(...hs0) > 1e-3 ? norm(hs0) : tr, hf = cross(hd, hs);
        if (look.gloves) this._prim(this.parts.glove, a.hand, hs, hf, hd, k, k, k, look.gloves, CL);
        else this._prim(s === 'L' ? this.parts.handL : this.parts.handR, a.hand, hs, hf, hd, k, k, k, skin, SK);
      }
      // neck
      const hc = b.head;
      const neckTop = P(hc, -0.075 * k, U, -0.012 * k, F, 0, F), neckBot = P(b.neck, -0.035 * k, U, 0, F, 0, F);
      S.tube(W, [neckBot, [(neckBot[0] + neckTop[0]) / 2, (neckBot[1] + neckTop[1]) / 2, (neckBot[2] + neckTop[2]) / 2], neckTop], F, 6, 12,
        (t) => (0.056 - 0.006 * t) * k, () => sk);
      // head: sculpted mesh (jaw, chin, nose, brow, eye sockets, cheekbones, ears), eyes, brows, lips, hair
      this._prim(this.parts.head, hc, Rt, F, U, k, k, k, skin, SK);
      const E = S.EYES, hairCol = look.hair || [0.22, 0.16, 0.12];
      for (const sg of [-1, 1]) {
        // eyes set into the sockets: a slightly off-white eyeball, a dark iris, and an upper lid over the top third
        const eye = P(hc, E.z * k, U, (E.y - 0.005) * k, F, sg * E.x * k, Rt);
        this._sph(eye, 0.0088 * k, [0.86, 0.83, 0.8], 13);                                         // eyeball
        this._sph(P(eye, 0.0052 * k, F, -0.0008 * k, U, 0, F), 0.0056 * k, [0.1, 0.07, 0.05], 13); // iris
        this._ell(P(eye, 0.0055 * k, U, 0.002 * k, F, 0, F), Rt, F, U, 0.0115 * k, 0.0085 * k, 0.0055 * k, skin, SK);   // upper lid
        this._ell(P(hc, 0.036 * k, U, 0.091 * k, F, sg * 0.031 * k, Rt), Rt, F, U, 0.019 * k, 0.006 * k, 0.0045 * k, hairCol, 8);   // brow
      }
      this._ell(P(hc, -0.05 * k, U, 0.096 * k, F, 0, F), Rt, F, U, 0.018 * k, 0.005 * k, 0.004 * k,
        [skin[0] * 0.78, skin[1] * 0.55, skin[2] * 0.52], SK);                                     // lips
      if (look.hair && look.hairStyle !== 'bald') {
        const st = look.hairStyle === 'bun' ? 'short' : look.hairStyle;
        this._prim(this.parts.hair[st] || this.parts.hair.short, hc, Rt, F, U, k, k, k, look.hair, 8);
        if (look.hairStyle === 'bun') this._sph(P(hc, 0.09 * k, U, -0.075 * k, F, 0, F), 0.032 * k, look.hair, 8);
      }
      if (look.beard && look.hair) this._prim(this.parts.beard, hc, Rt, F, U, k, k, k, look.hair, 8);
    }

    // ── real rigged players ──
    /** Parse the packed CC0 model (assets/players.js), build GPU buffers, textures and kit regions. */
    _initModels() {
      const A = window.FK_PLAYER_ASSETS, Rg = window.FKRig;
      this.models = null;
      if (!A || !Rg) return;
      const gl = this.gl;
      const bin = (k) => { const s = atob(A.bin[k]); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
      const upload = (rig, prim, jointRemap, part) => {
        const nv = prim.pos.length / 3;
        const reg = part === 0 ? Rg.regions(rig, prim) : null;
        const J = new Float32Array(prim.joints.length);
        for (let i = 0; i < J.length; i++) J[i] = jointRemap ? jointRemap[prim.joints[i]] : prim.joints[i];
        const R2 = new Float32Array(nv * 2);
        if (reg) for (let v = 0; v < nv; v++) { R2[v * 2] = reg.cls[v]; R2[v * 2 + 1] = reg.t[v]; }
        if (prim.prof) for (let v = 0; v < nv; v++) R2[v * 2 + 1] = 1 + prim.prof[v];   // shell edge fade (1 = edge, 2 = full)
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const attr = (loc, data, size) => {
          const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        };
        attr(0, prim.pos, 3); attr(1, prim.nrm, 3); attr(2, prim.uv || new Float32Array(nv * 2), 2);
        attr(3, J, 4); attr(4, prim.weights, 4); attr(5, R2, 2);
        attr(6, reg ? reg.axis : prim.pos, 3);                     // bone-axis points (hair/eyes: themselves, so unaffected)
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, prim.idx, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        return { vao, count: prim.idx.length, part };
      };
      const tex = (key) => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 160, 130, 255]));
        const img = new Image();
        img.onload = () => {
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        };
        img.src = A.img[key];
        return t;
      };
      if (A.version === 2) return this._initModelsV2(A, Rg, upload, tex, bin);
      const body = Rg.parseGltf(A.gltf.body, bin('body'));
      const rig = Rg.makeRig(body);
      const m = { rig, body: [], eyes: [], brows: [], hair: {}, tex: {}, prog: compile(gl, SKIN_VS, SKIN_FS), bones: new Float32Array(rig.n * 16) };
      for (const p of body.prims) {
        if (/^Eyes/i.test(p.node)) m.eyes.push(upload(rig, p, null, 1));
        else if (/^Eyebrows/i.test(p.node)) m.brows.push(upload(rig, p, null, 2));
        else m.body.push(upload(rig, p, null, 0));
      }
      // hair parts are skinned to the same skeleton; remap their joint indices onto the body's by bone name
      for (const key of ['hair_buzzed', 'hair_parted', 'hair_long', 'hair_buns', 'beard']) {
        const ph = Rg.parseGltf(A.gltf[key], bin(key));
        const remap = ph.jointNames.map((nm) => rig.index[nm] !== undefined ? rig.index[nm] : 0);
        m.hair[key] = { draws: ph.prims.map((p) => upload(rig, p, remap, 2)), tex: A.hairTex[key] };
      }
      for (const k of ['skin_dark', 'skin_light', 'eye', 'hair1', 'hair2']) m.tex[k] = tex(k);
      Object.assign(m, this._kitHeights(rig));
      m.get = () => m;
      this.models = m;
    }

    /** Heights in the bind pose used by the kit painter: chest centre (numbers), belt line, knee (sock tops). */
    _kitHeights(rig) {
      const z = (nm) => rig.bindPos[rig.index[nm]][2];
      return { centreZ: (z('spine_01') + z('neck_01')) / 2 - 0.12, beltZ: z('pelvis') + 0.07, kneeZ: z('calf_l'), neck: rig.bindPos[rig.index.neck_01] };
    }

    /**
     * Assets v2 (MakeHuman CC0 bodies): one shared topology, a shape per player. Each player's mesh, rig and
     * refitted hair are built the first time that player is drawn.
     */
    _initModelsV2(A, Rg, upload, tex, bin) {
      const gl = this.gl, D = Rg.decodeV2(A);
      const hairGl = {};
      for (const key of Object.keys(A.gltf)) hairGl[key] = Rg.parseGltf(A.gltf[key], bin(key));
      const m = { v2: true, tex: {}, prog: compile(gl, SKIN_VS, SKIN_FS), cache: {} };
      for (const k of Object.keys(A.img)) m.tex[k] = tex(k);
      m.skinRef = A.skinRef || {};
      const M2tex = (k) => (A.img[k] ? k : 'strands');
      m.get = (id) => {
        if (!A.shapes[id]) id = 'wall0';
        if (m.cache[id]) return m.cache[id];
        const sh = D.shape(id), parsed = Rg.fromShape(D.base, sh), rig = Rg.makeRig(parsed);
        const V = { rig, body: [], eyes: [], brows: [], hair: {}, bones: new Float32Array(rig.n * 16), ...this._kitHeights(rig),
          main: sh.main, browKey: sh.brows, skin: sh.skin, browW: sh.browW };
        { const e = Rg.toSim([sh.eyes[0], sh.eyes[1], sh.eyes[2]]), nk = V.neck, F = V.rig.F;   // eye height/forward from the neck (headband)
          V.eyeH = e[2] - nk[2]; V.eyeF = (e[0] - nk[0]) * F[0] + (e[1] - nk[1]) * F[1]; }
        for (const p of parsed.prims) (p.node === 'Eyes' ? V.eyes : V.body).push(upload(rig, p, null, p.node === 'Eyes' ? 1 : 0));
        for (const key of Object.keys(sh.hair)) {
          const px = D.base.proxies[key];
          if (px) {                                                   // MakeHuman hair, eyebrows, eyelashes, eyes: fitted to this body
            const d = upload(rig, Rg.shellPrim(px, sh.hair[key]), null, px.part);
            if (px.part === 1) V.eyes = [d]; else V.hair[key] = { draws: [d], tex: px.tex, proxy: true };
            continue;
          }
          if (D.base.shells[key]) {                                   // short hair, stubble shells and beards: grown from this head
            V.hair[key] = { draws: [upload(rig, Rg.shellPrim(D.base.shells[key], sh.hair[key]), null, 2)], tex: M2tex('strands'), proxy: false };   // solid, sculpted
            continue;
          }
          const ph = hairGl[key], remap = ph.jointNames.map((nm) => rig.index[nm] !== undefined ? rig.index[nm] : rig.index.Head);
          let off = 0;
          const draws = ph.prims.map((p) => {
            const q = { ...p, pos: sh.hair[key].subarray(off, off + p.pos.length) }; off += p.pos.length;
            return upload(rig, q, remap, 2);
          });
          V.hair[key] = { draws, tex: A.hairTex[key] };
        }
        return (m.cache[id] = V);
      };
      this.models = m;
    }

    /** Draw every person with the real model, retargeted onto their joints (twice in the ink style). */
    _drawModels(bodies, L, SUN, eye, ink) {
      const gl = this.gl, M = this.models, P = M.prog, u = P.u, Rg = window.FKRig;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(u.uVP, false, this.vp);
      gl.uniformMatrix4fv(u.uV, false, this.view); gl.uniformMatrix4fv(u.uP, false, this.proj);
      gl.uniform3fv(u.uSun, SUN); gl.uniform3fv(u.uEye, eye);
      gl.uniform3fv(u.uSunCol, L.sunCol); gl.uniform3fv(u.uSkyCol, L.skyCol); gl.uniform3fv(u.uGndCol, L.gndCol);
      gl.uniform3fv(u.uFog, L.fog); gl.uniform1f(u.uFogK, L.fogK);
      gl.uniform1i(u.uStyle, ink ? 1 : 0); gl.uniform1i(u.uBall, 0); gl.uniform1i(u.uToon, M.v2 ? 1 : 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, M.tex.brows || null); gl.uniform1i(u.uBrowTex, 1);
      gl.uniform1i(u.uBrowOn, M.tex.brows ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uTex, 0);
      const HAIR = { short: 'hair_parted', buzz: 'hair_buzzed', long: 'hair_long', bun: 'hair_buns' };
      for (const it of bodies) {
        const b = it.body, lk = it.look, kit = lk.kit;
        const V = M.get(lk.model || lk.id);
        gl.uniform3fv(u.uFront, V.rig.F); gl.uniform1f(u.uCentreZ, V.centreZ);
        gl.uniform1f(u.uBeltZ, V.beltZ); gl.uniform1f(u.uKneeZ, V.kneeZ); gl.uniform3fv(u.uNeck, V.neck); gl.uniform1i(u.uCollar, M.v2 ? 1 : 0);
        Rg.poseRig(V.rig, b, b.height / V.rig.meshHeight, V.bones);
        gl.uniform1f(u.uBuild, M.v2 ? 1.0 : lk.build || 0.94);           // v2 bodies carry their own build
        gl.uniformMatrix4fv(u.uBones, false, V.bones);
        gl.uniform3fv(u.uBrowCol, (lk.hair || [0.12, 0.09, 0.07]).map((c) => c * 0.8));
        gl.uniform1f(u.uBrowW, V.browW || 0.5);                            // brow thickness (0.5 = medium)
        gl.uniform3f(u.uBand, lk.headband && V.eyeH ? 1 : 0, V.eyeH || 0, V.eyeF || 0);
        // skin: pick the light or dark texture and tint it toward the person's skin colour
        const lum = 0.3 * lk.skin[0] + 0.59 * lk.skin[1] + 0.11 * lk.skin[2];
        const dark = lum < 0.5;
        const skinKey = V.skin && M.tex['skin_' + V.skin] ? 'skin_' + V.skin : dark ? 'skin_dark' : 'skin_light';
        const ref = (V.skin && M.skinRef[V.skin]) || (dark ? [0.42, 0.29, 0.22] : [0.86, 0.67, 0.55]);
        const skinTint = lk.skin.map((c, i) => Math.min(1.6, Math.max(0.5, c / ref[i])));
        gl.uniform3fv(u.uShirt, kit.shirt); gl.uniform3fv(u.uShirt2, kit.shirt2 || kit.shirt); gl.uniform3fv(u.uTrim, kit.trim || kit.shirt);
        gl.uniform3fv(u.uSleeves, kit.sleeves || kit.shirt);
        gl.uniform3fv(u.uShorts, kit.shorts); gl.uniform3fv(u.uSocks, kit.socks); gl.uniform3fv(u.uBoots, lk.boots);
        gl.uniform3fv(u.uGlove, lk.gloves || [1, 1, 1]);
        gl.uniform1i(u.uPattern, kit.pattern || 0); gl.uniform1i(u.uNum, kit.number || 0);
        gl.uniform1i(u.uLongSleeves, lk.longSleeves ? 1 : 0); gl.uniform1i(u.uGloves, lk.gloves ? 1 : 0);
        gl.uniform1f(u.uSleeveT, 0.55); gl.uniform1f(u.uShortsT, lk.longShorts ? 0.8 : 0.45); gl.uniform1f(u.uSockT, lk.longShorts ? 0.84 : 2.0);
        const hairKey = lk.hair && lk.hairStyle !== 'bald' && lk.hairStyle !== 'shaved' ? (V.main !== undefined && V.main !== null ? V.main : M.v2 && lk.hairStyle === 'bun' ? 'hair_slick' : HAIR[lk.hairStyle] || 'hair_parted') : null;
        const draws = [];
        for (const d of V.body) draws.push([d, M.tex[skinKey], skinTint]);
        for (const d of V.eyes) draws.push([d, M.tex.eye, [1, 1, 1]]);
        const hairTint = (lk.hair || [0.2, 0.15, 0.1]).map((c) => c * 1.2 + 0.02);
        for (const d of V.brows) draws.push([d, M.tex.hair1, hairTint]);
        if (hairKey && V.hair[hairKey]) for (const d of V.hair[hairKey].draws) draws.push([d, M.tex[V.hair[hairKey].tex], hairTint, V.hair[hairKey].proxy]);
        if (V.browKey && V.hair[V.browKey]) for (const d of V.hair[V.browKey].draws) draws.push([d, M.tex[V.hair[V.browKey].tex], hairTint.map((c) => c * 0.8), true]);
        if (V.hair.lashes) for (const d of V.hair.lashes.draws) draws.push([d, M.tex[V.hair.lashes.tex], [0.12, 0.1, 0.09], true]);
        if (hairKey && lk.hairStyle === 'bun' && V.hair.bun) for (const d of V.hair.bun.draws) draws.push([d, M.tex.strands, hairTint]);
        gl.uniform1f(u.uScalp, hairKey ? 1 : lk.hairStyle === 'shaved' ? 0.55 : 0);   // shaved: a soft painted shadow on the scalp gl.uniform1f(u.uStubble, lk.beard && lk.hair ? 1 : 0);
        if (lk.beard && lk.hair && V.hair.beard) for (const d of V.hair.beard.draws) draws.push([d, M.tex[V.hair.beard.tex], hairTint, V.hair.beard.proxy]);
        for (const pass of ink || M.v2 ? [0, 1] : [0]) {                // stylized players get a thin coloured outline in every look
          gl.uniform1f(u.uOutline, pass * (ink ? 1 : 0.5)); gl.uniform1i(u.uOutlineOn, pass);
          for (const [d, t, tint, alpha] of draws) {
            if (pass === 1 && (d.part === 1 || alpha)) continue;          // no pen outline around the eyes, hair cards, brows
            gl.uniform1i(u.uPart, d.part);
            gl.uniform1i(u.uCards, alpha ? 1 : 0);
            if (alpha) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); else gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
            gl.uniform3fv(u.uTint, tint);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.bindVertexArray(d.vao);
            gl.drawElements(gl.TRIANGLES, d.count, gl.UNSIGNED_INT, 0);
          }
        }
      }
      gl.uniform1f(u.uOutline, 0); gl.uniform1i(u.uOutlineOn, 0); gl.uniform1i(u.uCards, 0);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(null);
      gl.useProgram(this.mesh.p);
    }

    /** Upload and draw this frame's sculpted limbs (twice in the ink style: colour, then pen outline). */
    _flushLimbs(L, SUN, eye, ink) {
      const W = this.limbs;
      if (!W.ni) return;
      const gl = this.gl, P = this.dynProg, u = P.u;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(u.uVP, false, this.vp);
      gl.uniformMatrix4fv(u.uV, false, this.view); gl.uniformMatrix4fv(u.uP, false, this.proj);
      gl.uniform3fv(u.uSun, SUN); gl.uniform3fv(u.uEye, eye);
      gl.uniform3fv(u.uSunCol, L.sunCol); gl.uniform3fv(u.uSkyCol, L.skyCol); gl.uniform3fv(u.uGndCol, L.gndCol);
      gl.uniform3fv(u.uFog, L.fog); gl.uniform1f(u.uFogK, L.fogK);
      gl.uniform1i(u.uStyle, ink ? 1 : 0); gl.uniform1i(u.uNum, 0); gl.uniform1i(u.uPattern, 0);
      gl.bindVertexArray(this.limbVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.limbBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, W.v, 0, W.n * 10);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.limbIdx);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, W.idx, 0, W.ni);
      for (const pass of ink ? [0, 1] : [0]) {
        gl.uniform1f(u.uOutline, pass);
        gl.drawElements(gl.TRIANGLES, W.ni, gl.UNSIGNED_SHORT, 0);
      }
      gl.uniform1f(u.uOutline, 0);
      W.n = 0; W.ni = 0;
      gl.useProgram(this.mesh.p);
    }

    /** Draw every queued instance: one call per primitive shape (twice in the ink style). Leaves the mesh program active. */
    _flushInstances(L, SUN, eye, ink) {
      const gl = this.gl, P = this.instProg, u = P.u;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(u.uVP, false, this.vp);
      gl.uniformMatrix4fv(u.uV, false, this.view); gl.uniformMatrix4fv(u.uP, false, this.proj);
      gl.uniform3fv(u.uSun, SUN); gl.uniform3fv(u.uEye, eye);
      gl.uniform3fv(u.uSunCol, L.sunCol); gl.uniform3fv(u.uSkyCol, L.skyCol); gl.uniform3fv(u.uGndCol, L.gndCol);
      gl.uniform3fv(u.uFog, L.fog); gl.uniform1f(u.uFogK, L.fogK);
      gl.uniform3fv(u.uColor2, [1, 1, 1]); gl.uniform3fv(u.uColor3, [1, 1, 1]); gl.uniform1i(u.uNum, 0); gl.uniform1i(u.uPattern, 0);
      gl.uniform1i(u.uStyle, ink ? 1 : 0);
      for (const pass of ink ? [0, 1] : [0]) {
        gl.uniform1f(u.uOutline, pass);
        for (const m of this.instMeshes) {
          const I = m.inst;
          if (!I.n) continue;
          gl.bindVertexArray(I.vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, I.ib);
          if (pass === 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, I.data, 0, I.n * 16);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, I.n);
        }
      }
      gl.uniform1f(u.uOutline, 0);
      for (const m of this.instMeshes) m.inst.n = 0;
      gl.useProgram(this.mesh.p);
    }

    /** Stadium and surroundings (the realistic style only). */
    _drawStadium(L, I3) {
      const gl = this.gl, mu = this.mesh.u;
      this._prim(this.stands, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, COL.steel, 2);
      this._prim(this.boards, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, COL.steel, 3);
      this._prim(this.upper, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, [0.30, 0.32, 0.37], 0);
      this._prim(this.roof, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, [0.20, 0.22, 0.27], 0);
      this._prim(this.lamps, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, L.lamps, 4);
      this._prim(this.trunks, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, [0.30, 0.22, 0.15], 0);
      this._prim(this.forest, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, [0.13, 0.30, 0.13], 9);
      gl.uniform3fv(mu.uColor2, L === LIGHTS.night ? [0.12, 0.13, 0.16] : [0.45, 0.47, 0.45]);
      this._prim(this.hills, [0, 0, 0], I3[0], I3[1], I3[2], 1, 1, 1, [0.20, 0.33, 0.17], 10);
      gl.uniform3fv(mu.uColor2, [1, 1, 1]);
      for (const mx of [-62, 168]) for (const my of [-97, 97]) this._limb([mx, my, 33], [mx, my, 62], 0.6, [0.35, 0.37, 0.41]);
    }

    /** Ground-shadow segments for a body (torso and the two legs). */
    _bodyShadows(b, add) {
      add(b.pelvis[0], b.pelvis[1], b.pelvis[2], b.neck[0], b.neck[1], b.neck[2], 0.15 * b.k, 0.5);
      for (const s of ['L', 'R']) { const l = b.legs[s]; add(l.hip[0], l.hip[1], l.hip[2], l.ankle[0], l.ankle[1], l.ankle[2], 0.065 * b.k, 0.5); }
      const h = b.head; add(h[0], h[1], h[2], h[0], h[1], h[2], 0.1 * b.k, 0.5);
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

      const ink = frame.style === 'ink';          // illustrated style: paper world, ink outlines, flat tones
      this.ink = ink;
      const L = ink ? LIGHTS.day : (LIGHTS[frame.light] || this.light);
      this.light = L;
      const SUN = L.sun;
      const SHX = -SUN[0] / Math.max(0.25, SUN[2]), SHY = -SUN[1] / Math.max(0.25, SUN[2]);   // shadow offset per metre of height
      const b = frame.ball;
      const bodies = frame.bodies || [];

      // Draw order (for speed on ordinary laptops): opaque meshes first, then the ground and the sky with the depth
      // test on, so the pixels hidden behind the stands are never shaded by those two full-screen shaders.
      const drawSky = () => {
        gl.depthMask(false);
        gl.useProgram(this.sky.p);
        const th = Math.tan(cam.fov / 2), fw = [-basis.z[0], -basis.z[1], -basis.z[2]];
        const su = this.sky.u;
        gl.uniform3fv(su.uF, fw);
        gl.uniform3f(su.uR, basis.x[0] * th * W / H, basis.x[1] * th * W / H, basis.x[2] * th * W / H);
        gl.uniform3f(su.uU, basis.y[0] * th, basis.y[1] * th, basis.y[2] * th);
        gl.uniform3fv(su.uSun, SUN);
        gl.uniform3fv(su.uZen, L.zen); gl.uniform3fv(su.uHor, L.hor); gl.uniform3fv(su.uFog, L.fog);
        gl.uniform3fv(su.uSunCol, L.sunCol); gl.uniform3fv(su.uCloud, L.cloud);
        gl.uniform1f(su.uStars, L.stars); gl.uniform1f(su.uSunDisc, L.disc); gl.uniform1i(su.uStyle, ink ? 1 : 0);
        gl.bindVertexArray(this.fsTri.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.depthMask(true);
      };

      // ground with analytic shadows (the shader only loops over shadows inside their bounding box)
      const drawGround = () => {
        const sh = [], shp = [], box = [1e9, 1e9, -1e9, -1e9];
        const addShadow = (ax, ay, az, bx, by, bz, r, a) => {
          if (sh.length >= 56 * 4) return;
          const p = [ax + SHX * az, ay + SHY * az, bx + SHX * bz, by + SHY * bz], m = r * 1.6 + 0.1;
          sh.push(...p); shp.push(r, a * L.shadow / 0.42);
          box[0] = Math.min(box[0], p[0] - m, p[2] - m); box[1] = Math.min(box[1], p[1] - m, p[3] - m);
          box[2] = Math.max(box[2], p[0] + m, p[2] + m); box[3] = Math.max(box[3], p[1] + m, p[3] + m);
        };
        addShadow(b.x, b.y, b.z - R, b.x, b.y, b.z - R, R * 0.95, 0.5 * Math.max(0.25, 1 - b.z / 14));
        for (const s of [-1, 1]) addShadow(0, s * POST_Y, 0, 0, s * POST_Y, BAR_Z, 0.07, 0.4);
        addShadow(0, -POST_Y, BAR_Z, 0, POST_Y, BAR_Z, 0.07, 0.4);
        for (const it of bodies) this._bodyShadows(it.body, (ax, ay, az, bx, by, bz, r, a) => addShadow(ax, ay, az, bx, by, bz, r, a * 0.84));
        const gu = this.ground.u;
        gl.useProgram(this.ground.p);
        gl.uniformMatrix4fv(gu.uVP, false, this.vp);
        gl.uniform3fv(gu.uEye, cam.eye);
        gl.uniform3fv(gu.uFog, L.fog); gl.uniform1f(gu.uFogK, L.fogK);
        gl.uniform3fv(gu.uGrassLight, L.grass); gl.uniform1f(gu.uPool, L.pool);
        gl.uniform4fv(gu.uSh, new Float32Array(sh));
        gl.uniform2fv(gu.uShP, new Float32Array(shp));
        gl.uniform1i(gu.uShN, shp.length / 2);
        gl.uniform4fv(gu.uShBox, box); gl.uniform1i(gu.uStyle, ink ? 1 : 0);
        gl.bindVertexArray(this.groundQuad.vao); gl.drawArrays(gl.TRIANGLES, 0, 6);
      };

      // solid geometry
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      const mu = this.mesh.u;
      gl.useProgram(this.mesh.p);
      gl.uniformMatrix4fv(mu.uVP, false, this.vp);
      gl.uniform3fv(mu.uSun, SUN);
      gl.uniform3fv(mu.uEye, cam.eye);
      gl.uniform3fv(mu.uSunCol, L.sunCol); gl.uniform3fv(mu.uSkyCol, L.skyCol); gl.uniform3fv(mu.uGndCol, L.gndCol);
      gl.uniform3fv(mu.uFog, L.fog); gl.uniform1f(mu.uFogK, L.fogK);
      gl.uniform3fv(mu.uColor2, [1, 1, 1]); gl.uniform3fv(mu.uColor3, [1, 1, 1]); gl.uniform1i(mu.uNum, 0); gl.uniform1i(mu.uPattern, 0);
      gl.uniform1i(mu.uStyle, ink ? 1 : 0); gl.uniform1f(mu.uOutline, 0);
      gl.uniformMatrix4fv(mu.uV, false, this.view); gl.uniformMatrix4fv(mu.uP, false, this.proj);
      const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      gl.disable(gl.CULL_FACE);
      // near to far, so the depth test rejects most hidden pixels of the forest and hills
      if (!ink) this._drawStadium(L, I3);
      this._torsoQ = [];

      // goal frame
      const pr = C.POST_RADIUS;
      const drawGoal = (outline) => {
        for (const s of [-1, 1]) {
          this._limb([0, s * POST_Y, 0], [0, s * POST_Y, BAR_Z], pr, COL.white);
          this._ball([0, s * POST_Y, BAR_Z], pr, COL.white);
          if (!outline) {
            this._limb([-NET_D, s * POST_Y, 0], [-NET_D, s * POST_Y, BAR_Z], 0.025, COL.steel);
            this._limb([0, s * POST_Y, BAR_Z], [-NET_D, s * POST_Y, BAR_Z], 0.025, COL.steel);
          }
        }
        this._limb([0, -POST_Y, BAR_Z], [0, POST_Y, BAR_Z], pr, COL.white);
        if (!outline) this._limb([-NET_D, -POST_Y, BAR_Z], [-NET_D, POST_Y, BAR_Z], 0.025, COL.steel);
      };
      drawGoal(false);

      // people: wall, keeper, kicker (joint positions come from js/people.js)
      if (this.models && frame.realPlayers !== false) {
        this._drawModels(bodies, L, SUN, cam.eye, ink);          // real rigged models, retargeted onto our bodies
      } else {
        this._batching = true;
        for (const it of bodies) this._body(it.body, it.look);    // sculpted fallback
        this._batching = false;
        this._flushInstances(L, SUN, cam.eye, ink);
        this._flushLimbs(L, SUN, cam.eye, ink);
      }

      // ball
      const q = b.q, qw = q[0], qx = q[1], qy = q[2], qz = q[3];
      const X = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw)];
      const Y = [2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw)];
      const Z = [2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy)];
      gl.uniform1i(mu.uBall, { brazuca: 1, jabulani: 2, trionda: 4 }[frame.ballDesign] || 0);
      const btex = this._ballTexture(frame.ballDesign), bnrm = btex && this._ballTexture(frame.ballDesign, true);
      if (btex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, btex); gl.uniform1i(mu.uBallTex, 6); gl.uniform1i(mu.uBallTexOn, 1); gl.activeTexture(gl.TEXTURE0); }
      if (bnrm) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, bnrm); gl.uniform1i(mu.uBallNrm, 7); gl.uniform1i(mu.uBallNrmOn, 1); gl.activeTexture(gl.TEXTURE0); }
      gl.uniformMatrix3fv(mu.uBallRot, false, [X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2]]);
      this._prim(this.ballMesh, [b.x, b.y, b.z], X, Y, Z, R, R, R, COL.white, 1);
      gl.uniform1i(mu.uBall, 0); gl.uniform1i(mu.uBallTexOn, 0); gl.uniform1i(mu.uBallNrmOn, 0);

      // ink pass for the non-instanced shapes: torsos, ball, goal frame
      if (ink) {
        gl.uniform1f(mu.uOutline, 1);
        for (const t of this._torsoQ) this._prim(this.torso, ...t);
        gl.uniform1f(mu.uOutline, 0.6);
        this._prim(this.ballMesh, [b.x, b.y, b.z], X, Y, Z, R, R, R, COL.white, 1);
        drawGoal(true);
        gl.uniform1f(mu.uOutline, 0);
      }

      drawGround();
      drawSky();

      // translucent: net, then ribbons
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this._updateNet(frame.net, frame.dt || 0.016);
      gl.useProgram(this.color.p);
      gl.uniformMatrix4fv(this.color.u.uVP, false, this.vp);
      if (ink) gl.uniform4f(this.color.u.uTint, 0.32, 0.33, 0.37, 0.75);   // pencil-grey net on paper
      else gl.uniform4f(this.color.u.uTint, 1, 1, 1, 1);
      gl.bindVertexArray(this.netVao);
      gl.drawElements(gl.LINES, this.netCount, gl.UNSIGNED_SHORT, 0);
      gl.uniform4f(this.color.u.uTint, 1, 1, 1, 1);

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

  window.FKRender = { Renderer, LIGHTS };
})();
