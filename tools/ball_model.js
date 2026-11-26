// Convert a downloaded ball model (.glb, single-file .gltf, or .obj + .mtl + texture) into assets/balls/<id>.js,
// which registers window.FKBallModels[id] for the ball viewer (js/ballview.js) and the game ball.
// usage: node tools/ball_model.js <id: trionda|brazuca|jabulani|...> <model file> [out dir = assets/balls]
//
// The mesh is centred and scaled to a unit sphere (radius 1); all primitives are merged; the base-colour texture of
// the first textured material is embedded as a data URL. Check the model's licence before shipping it.
'use strict';
const fs = require('fs'), path = require('path');
// options: --texture <image> uses that file as the base colour (e.g. a downsized JPEG), overriding the model's own
const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; argv.splice(i, 2); i--; }
const [id, file, outDir = path.join(__dirname, '..', 'assets', 'balls')] = argv;
if (!id || !file) { console.error('usage: node tools/ball_model.js <id> <model.glb|model.gltf|model.obj|model.fbx> [out dir] [--texture image] [--normal image] [--uv N] [--seam-uv M]'); process.exit(1); }

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const out = { positions: [], normals: [], uvs: [], indices: [], texture: null };

function addPrim(P, N, T, I, M) {
  const base = out.positions.length / 3, n = P.length / 3;
  for (let i = 0; i < n; i++) {
    let p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    let q = N ? [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]] : null;
    if (M) { p = xf(M, p, 1); if (q) q = xf(M, q, 0); }
    out.positions.push(...p); out.normals.push(...(q || [0, 0, 0])); out.uvs.push(T ? T[i * 2] : 0, T ? T[i * 2 + 1] : 0);
  }
  if (I) for (const k of I) out.indices.push(base + k); else for (let i = 0; i < n; i++) out.indices.push(base + i);
}
const xf = (M, p, w) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r] * w);
const mat4mul = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
function nodeMatrix(nd) {
  if (nd.matrix) return nd.matrix;
  const [x, y, z, w] = nd.rotation || [0, 0, 0, 1], [sx, sy, sz] = nd.scale || [1, 1, 1], t = nd.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
}

function loadGltf(json, bin, dir) {
  const bufs = (json.buffers || []).map((b, i) => (b.uri ? (b.uri.startsWith('data:') ? Buffer.from(b.uri.split(',')[1], 'base64') : fs.readFileSync(path.join(dir, b.uri))) : bin));
  const view = (bvI) => { const bv = json.bufferViews[bvI]; return bufs[bv.buffer].subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); };
  const acc = (i) => {
    const a = json.accessors[i], comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const v = view(a.bufferView), bv = json.bufferViews[a.bufferView], stride = bv.byteStride || comps * T.BYTES_PER_ELEMENT;
    const o = [];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) {
      const off = (a.byteOffset || 0) + k * stride + c * T.BYTES_PER_ELEMENT;
      o.push(T === Float32Array ? v.readFloatLE(off) : T === Uint32Array ? v.readUInt32LE(off) : T === Uint16Array ? v.readUInt16LE(off) : v.readUInt8(off));
    }
    return o;
  };
  const image = (texI) => {
    const im = json.images[json.textures[texI].source];
    if (im.bufferView !== undefined) return `data:${im.mimeType};base64,` + view(im.bufferView).toString('base64');
    if (im.uri.startsWith('data:')) return im.uri;
    const f = path.join(dir, decodeURIComponent(im.uri)); return `data:${MIME[path.extname(f).toLowerCase()] || 'image/png'};base64,` + fs.readFileSync(f).toString('base64');
  };
  const visit = (ni, parent) => {
    const nd = json.nodes[ni], M = mat4mul(parent, nodeMatrix(nd));
    if (nd.mesh !== undefined) for (const pr of json.meshes[nd.mesh].primitives) {
      const at = pr.attributes;
      // --uv N picks the UV set the colour uses (models ripped from games often paint through TEXCOORD_1);
      // --seam-uv M keeps another set, whose islands are the real panel cuts, for drawing seams (ball_bake.py)
      const uvKey = 'TEXCOORD_' + (opt.uv || 0), seamKey = opt['seam-uv'] !== undefined ? 'TEXCOORD_' + opt['seam-uv'] : null;
      const base = out.positions.length / 3;
      addPrim(acc(at.POSITION), at.NORMAL !== undefined ? acc(at.NORMAL) : null, at[uvKey] !== undefined ? acc(at[uvKey]) : null,
        pr.indices !== undefined ? acc(pr.indices) : null, M);
      if (seamKey && at[seamKey] !== undefined) {
        out.seamUvs = out.seamUvs || [];
        while (out.seamUvs.length < base * 2) out.seamUvs.push(0);
        out.seamUvs.push(...acc(at[seamKey]).map((x) => +x.toFixed(5)));
      }
      const mat = pr.material !== undefined && json.materials[pr.material];
      const bt = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
      if (!out.texture && bt) out.texture = image(bt.index);
      // the normal map carries the grooves and surface texture; ball_bake.py turns it into a sphere normal map
      if (!out.normalTexture && mat && mat.normalTexture) out.normalTexture = image(mat.normalTexture.index);
    }
    for (const c of nd.children || []) visit(c, M);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes ? json.scenes[json.scene || 0] : { nodes: json.nodes.map((_, i) => i) };
  for (const n of scene.nodes) visit(n, I);
}

function loadObj(text, dir) {
  const v = [], vt = [], vn = []; let mtl = null; const P = [], N = [], T = [];
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'v') v.push(w.slice(1, 4).map(Number));
    else if (w[0] === 'vt') vt.push(w.slice(1, 3).map(Number));
    else if (w[0] === 'vn') vn.push(w.slice(1, 4).map(Number));
    else if (w[0] === 'mtllib') mtl = w.slice(1).join(' ');
    else if (w[0] === 'f') {
      const c = w.slice(1).map((s) => s.split('/').map((x) => (x ? parseInt(x, 10) : 0)));
      for (let k = 1; k + 1 < c.length; k++) for (const q of [c[0], c[k], c[k + 1]]) {
        const ix = (i, arr) => (i < 0 ? arr.length + i : i - 1);
        // (OBJ's v runs up the image; glTF's, like WebGL's image rows, runs down)
        const t = q[1] ? vt[ix(q[1], vt)] : [0, 1];
        P.push(...v[ix(q[0], v)]); T.push(t[0], 1 - t[1]); N.push(...(q[2] ? vn[ix(q[2], vn)] : [0, 0, 0]));
      }
    }
  }
  addPrim(P, N, T, null, null);
  if (mtl && fs.existsSync(path.join(dir, mtl))) {
    const m = fs.readFileSync(path.join(dir, mtl), 'utf8').match(/^\s*map_Kd\s+(.+)$/m);
    if (m) { const f = path.join(dir, m[1].trim()); if (fs.existsSync(f)) out.texture = `data:${MIME[path.extname(f).toLowerCase()] || 'image/png'};base64,` + fs.readFileSync(f).toString('base64'); }
  }
}

/** Binary FBX (7.x): the node tree, then every Mesh geometry (vertices, polygons, normals, UVs) merged. */
function loadFbx(buf) {
  const zlib = require('zlib');
  if (buf.toString('ascii', 0, 18) !== 'Kaydara FBX Binary') throw new Error('only binary FBX is supported (export ASCII FBX to binary or glTF first)');
  const wide = buf.readUInt32LE(23) >= 7500;
  let pos = 27;
  const rd = (p) => (wide ? Number(buf.readBigUInt64LE(p)) : buf.readUInt32LE(p));
  function node() {
    const end = rd(pos), np = rd(pos + (wide ? 8 : 4)), nlen = buf.readUInt8(pos + (wide ? 24 : 12));
    let p = pos + (wide ? 25 : 13);
    if (end === 0) { pos = p; return null; }
    const name = buf.toString('ascii', p, p + nlen); p += nlen;
    const props = [];
    for (let i = 0; i < np; i++) {
      const t = String.fromCharCode(buf[p]); p++;
      if (t === 'Y') { props.push(buf.readInt16LE(p)); p += 2; }
      else if (t === 'C') { props.push(!!buf[p]); p += 1; }
      else if (t === 'I') { props.push(buf.readInt32LE(p)); p += 4; }
      else if (t === 'F') { props.push(buf.readFloatLE(p)); p += 4; }
      else if (t === 'D') { props.push(buf.readDoubleLE(p)); p += 8; }
      else if (t === 'L') { props.push(Number(buf.readBigInt64LE(p))); p += 8; }
      else if (t === 'S' || t === 'R') { const l = buf.readUInt32LE(p); p += 4; props.push(t === 'S' ? buf.toString('utf8', p, p + l) : null); p += l; }
      else {
        const n = buf.readUInt32LE(p), enc = buf.readUInt32LE(p + 4), cl = buf.readUInt32LE(p + 8); p += 12;
        let d = buf.subarray(p, p + cl); p += cl;
        if (enc === 1) d = zlib.inflateSync(d);
        const sz = { f: 4, d: 8, l: 8, i: 4, b: 1 }[t], a = new Array(n);
        for (let k = 0; k < n; k++) { const o = k * sz; a[k] = t === 'f' ? d.readFloatLE(o) : t === 'd' ? d.readDoubleLE(o) : t === 'l' ? Number(d.readBigInt64LE(o)) : t === 'i' ? d.readInt32LE(o) : d[o]; }
        props.push(a);
      }
    }
    const children = [];
    pos = p;
    while (pos < end) { const c = node(); if (!c) break; children.push(c); }
    pos = end;
    return { name, props, children };
  }
  const top = [];
  while (pos < buf.length - 32) { const n = node(); if (!n) break; top.push(n); }
  const kid = (n, nm) => n.children.find((c) => c.name === nm);
  const objects = top.find((n) => n.name === 'Objects');
  for (const g of objects.children.filter((c) => c.name === 'Geometry' && c.props[2] === 'Mesh')) {
    const V = kid(g, 'Vertices').props[0], PI = kid(g, 'PolygonVertexIndex').props[0];
    const layer = (nm, dataNm, idxNm) => {
      const l = kid(g, nm); if (!l) return null;
      return { data: kid(l, dataNm).props[0], idx: idxNm && kid(l, idxNm) ? kid(l, idxNm).props[0] : null,
        map: kid(l, 'MappingInformationType').props[0], ref: kid(l, 'ReferenceInformationType').props[0] };
    };
    const Nl = layer('LayerElementNormal', 'Normals', 'NormalsIndex'), Ul = layer('LayerElementUV', 'UV', 'UVIndex');
    // value of a layer at polygon-corner c of control point v
    const at = (L, c, v, n) => {
      if (!L) return null;
      let i = /ByPolygonVertex/.test(L.map) ? c : v;
      if (/IndexToDirect/.test(L.ref) && L.idx) i = L.idx[i];
      return L.data.slice(i * n, i * n + n);
    };
    const P = [], N = [], T = [];
    let poly = [];
    for (let c = 0; c < PI.length; c++) {
      const last = PI[c] < 0, v = last ? ~PI[c] : PI[c];
      poly.push([c, v]);
      if (!last) continue;
      for (let k = 1; k + 1 < poly.length; k++) for (const [cc, vv] of [poly[0], poly[k], poly[k + 1]]) {
        P.push(V[vv * 3], V[vv * 3 + 1], V[vv * 3 + 2]);
        const nn = at(Nl, cc, vv, 3) || [0, 0, 0]; N.push(...nn);
        const uv = at(Ul, cc, vv, 2) || [0, 1]; T.push(uv[0], 1 - uv[1]);       // FBX v runs up, like OBJ
      }
      poly = [];
    }
    addPrim(P, N, T, null, null);
  }
}

const ext = path.extname(file).toLowerCase(), dir = path.dirname(file), raw = fs.readFileSync(file);
if (ext === '.glb') {
  const jl = raw.readUInt32LE(12), json = JSON.parse(raw.subarray(20, 20 + jl).toString('utf8'));
  const bo = 20 + jl, bin = raw.length > bo + 8 ? raw.subarray(bo + 8, bo + 8 + raw.readUInt32LE(bo)) : null;
  loadGltf(json, bin, dir);
} else if (ext === '.gltf') loadGltf(JSON.parse(raw.toString('utf8')), null, dir);
else if (ext === '.obj') loadObj(raw.toString('utf8'), dir);
else if (ext === '.fbx') loadFbx(raw);
else { console.error('unsupported format ' + ext + ' (use .glb, .gltf, .obj or binary .fbx)'); process.exit(1); }
if (opt.texture) out.texture = `data:${MIME[path.extname(opt.texture).toLowerCase()] || 'image/jpeg'};base64,` + fs.readFileSync(opt.texture).toString('base64');
// --normal <image>: the model's tangent-space normal map, when the format does not embed it (FBX, OBJ)
if (opt.normal) out.normalTexture = `data:${MIME[path.extname(opt.normal).toLowerCase()] || 'image/png'};base64,` + fs.readFileSync(opt.normal).toString('base64');

// centre and scale to a unit sphere; normals recomputed if missing
const n = out.positions.length / 3, c = [0, 0, 0];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += out.positions[i * 3 + k] / n;
let r = 0; for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(out.positions[i * 3] - c[0], out.positions[i * 3 + 1] - c[1], out.positions[i * 3 + 2] - c[2]));
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out.positions[i * 3 + k] = +((out.positions[i * 3 + k] - c[k]) / r).toFixed(5);
for (let i = 0; i < n; i++) {
  let q = out.normals.slice(i * 3, i * 3 + 3), l = Math.hypot(...q);
  if (l < 1e-6) { q = out.positions.slice(i * 3, i * 3 + 3); l = Math.hypot(...q) || 1; }
  for (let k = 0; k < 3; k++) out.normals[i * 3 + k] = +(q[k] / l).toFixed(4);
}
out.uvs = out.uvs.map((x) => +x.toFixed(5));
fs.mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, id + '.js');
fs.writeFileSync(dest, `/* ${id}: 3-D ball model converted by tools/ball_model.js from ${path.basename(file)}. */\n` +
  `(self.FKBallModels = self.FKBallModels || {})[${JSON.stringify(id)}] = ${JSON.stringify(out)};\n`);
// the manifest lists which balls have a real model, so the page loads only those
const manP = path.join(outDir, 'manifest.js');
let ids = [];
try { ids = JSON.parse((fs.readFileSync(manP, 'utf8').match(/=\s*(\[.*\])/) || [0, '[]'])[1]); } catch (e) { ids = []; }
if (!ids.includes(id)) ids.push(id);
fs.writeFileSync(manP, `/* Balls with a real 3-D model in this folder (written by tools/ball_model.js). */\nself.FKBallManifest = ${JSON.stringify(ids)};\n`);
console.log(dest, n, 'vertices', out.indices.length / 3, 'triangles', out.texture ? 'textured' : 'NO TEXTURE', (fs.statSync(dest).size / 1e6).toFixed(1) + ' MB');
