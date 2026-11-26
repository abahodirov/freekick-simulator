"""Build realistic player bodies from MakeHuman CC0 data (base mesh hm08, shape targets, game-engine rig + weights),
plus Quaternius CC0 hair/beard meshes refitted onto each new head. Writes assets/players.js (FK_PLAYER_ASSETS v2).
Usage: python -E mh_build.py <mh_dir> <ubc_dir> <out_js> [preview_dir]"""
import sys, os, json, gzip, base64, io, math, re
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

MH, UBC, OUT = sys.argv[1:4]
PREV = sys.argv[4] if len(sys.argv) > 4 else None
rng = np.random.default_rng(7)

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ base mesh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
V, VT, faces = [], [], []
grp = None
for ln in open(os.path.join(MH, '3dobjs', 'base.obj')):
    if ln.startswith('v '): V.append([float(x) for x in ln.split()[1:4]])
    elif ln.startswith('vt '): VT.append([float(x) for x in ln.split()[1:3]])
    elif ln.startswith('g '): grp = ln.split()[1]
    elif ln.startswith('f '):
        faces.append((grp, [tuple(int(x) - 1 for x in p.split('/')[:2]) for p in ln.split()[1:]]))
V0 = np.array(V); VT = np.array(VT); NV = len(V0)
groups = {}
for g, f in faces: groups.setdefault(g, set()).update(v for v, t in f)
body_faces = [f for g, f in faces if g == 'body']
body_set = np.zeros(NV, bool); body_set[list(groups['body'])] = True

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ targets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_tc = {}
def target(rel):
    if rel not in _tc:
        idx, d = [], []
        for ln in gzip.open(os.path.join(MH, 'targets', rel + '.target.gz'), 'rt'):
            if ln.startswith('#') or not ln.strip(): continue
            a = ln.split(); idx.append(int(a[0])); d.append([float(x) for x in a[1:4]])
        _tc[rel] = (np.array(idx, int), np.array(d).reshape(-1, 3))
    return _tc[rel]

def macro(muscle, weight, height, prop, race):
    muscle = max(0.5, muscle); weight = min(0.5, weight)
    fm = {'average': 1 - (muscle - 0.5) * 2, 'max': (muscle - 0.5) * 2}
    fw = {'average': 1 - (0.5 - weight) * 2, 'min': (0.5 - weight) * 2}
    w = {}
    for mk, mv in fm.items():
        for wk, wv in fw.items():
            if mv * wv <= 0: continue
            w['macrodetails/universal-male-young-%smuscle-%sweight' % (mk, wk)] = mv * wv
            hh = (height - 0.5) * 2
            if hh > 0: w['macrodetails/height/male-young-%smuscle-%sweight-maxheight' % (mk, wk)] = mv * wv * hh
            if hh < 0: w['macrodetails/height/male-young-%smuscle-%sweight-minheight' % (mk, wk)] = -mv * wv * hh
            if prop > 0.5: w['macrodetails/proportions/male-young-%smuscle-%sweight-idealproportions' % (mk, wk)] = mv * wv * (prop - 0.5) * 2
    for r, v in race.items(): w['macrodetails/%s-male-young' % r] = v
    return w

def face(**kw):
    """face(chin_prominent=0.5, ...) â†’ target weights; *_lr names apply to both sides; negative â†’ the decr/opposite."""
    pairs = {
        'head_square': ('head/head-square', None), 'head_oval': ('head/head-oval', None), 'head_round': ('head/head-round', None),
        'head_rect': ('head/head-rectangular', None), 'head_tri': ('head/head-triangular', None), 'head_invtri': ('head/head-invertedtriangular', None),
        'head_diamond': ('head/head-diamond', None), 'head_wide': ('head/head-scale-horiz-incr', 'head/head-scale-horiz-decr'),
        'head_long': ('head/head-scale-vert-incr', None), 'head_lean': ('head/head-fat-decr', None),
        'chin_prominent': ('chin/chin-prominent-incr', 'chin/chin-prominent-decr'), 'chin_width': ('chin/chin-width-incr', 'chin/chin-width-decr'),
        'chin_bones': ('chin/chin-bones-incr', 'chin/chin-bones-decr'), 'chin_height': ('chin/chin-height-incr', 'chin/chin-height-decr'),
        'chin_cleft': ('chin/chin-cleft-incr', 'chin/chin-cleft-decr'),
        'nose_long': ('nose/nose-scale-vert-incr', 'nose/nose-scale-vert-decr'), 'nose_wide': ('nose/nose-scale-horiz-incr', 'nose/nose-scale-horiz-decr'),
        'nose_deep': ('nose/nose-scale-depth-incr', 'nose/nose-scale-depth-decr'), 'nose_hump': ('nose/nose-hump-incr', 'nose/nose-hump-decr'),
        'nose_flare': ('nose/nose-flaring-incr', 'nose/nose-flaring-decr'), 'nose_point_wide': ('nose/nose-point-width-incr', 'nose/nose-point-width-decr'),
        'nose_volume': ('nose/nose-volume-incr', 'nose/nose-volume-decr'), 'nose_tip_up': ('nose/nose-point-up', 'nose/nose-point-down'),
        'nose_greek': ('nose/nose-greek-incr', 'nose/nose-greek-decr'), 'nostrils_wide': ('nose/nose-nostrils-width-incr', 'nose/nose-nostrils-width-decr'),
        'mouth_wide': ('mouth/mouth-scale-horiz-incr', 'mouth/mouth-scale-horiz-decr'),
        'upperlip': ('mouth/mouth-upperlip-volume-incr', 'mouth/mouth-upperlip-volume-decr'), 'lowerlip': ('mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-lowerlip-volume-decr'),
        'brows_down': ('eyebrows/eyebrows-trans-down', None), 'neck_thick': ('neck/measure-neck-circ-incr', None),
    }
    lr = {'cheekbones': ('cheek/%s-cheek-bones-incr', 'cheek/%s-cheek-bones-decr'), 'cheek_volume': ('cheek/%s-cheek-volume-incr', 'cheek/%s-cheek-volume-decr'),
          'eyes_small': ('eyes/%s-eye-size-small', None), 'eyes_down': ('eyes/%s-eye-trans-down', None), 'eyes_narrow': ('eyes/%s-eye-height2-decr', None)}
    w = {}
    for k, v in kw.items():
        if k in pairs:
            pos, neg = pairs[k]
            if v > 0: w[pos] = v
            elif neg: w[neg] = -v
        else:
            pos, neg = lr[k]
            for s in 'lr':
                if v > 0: w[pos % s] = v
                elif neg: w[neg % s] = -v
    return w

def morph(spec):
    P = V0.copy()
    for rel, wt in spec.items():
        if abs(wt) < 1e-6: continue
        if not os.path.exists(os.path.join(MH, 'targets', rel + '.target.gz')):
            print('  missing target', rel); continue
        i, d = target(rel); P[i] += wt * d
    return P

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ rig and weights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
RJ = json.load(open(os.path.join(MH, 'rigs', 'standard', 'rig.game_engine.json')))
names0 = list(RJ.keys())
order, seen = [], set()
def visit(n):
    if n in seen: return
    p = RJ[n].get('parent') or ''
    if p: visit(p)
    seen.add(n); order.append(n)
for n in names0: visit(n)
names = order
bidx = {n: i for i, n in enumerate(names)}
parent = [bidx[RJ[n]['parent']] if RJ[n].get('parent') else -1 for n in names]
out_names = ['Head' if n == 'head' else n for n in names]

def head_pos(P, n):
    h = RJ[n]['head']; s = h.get('strategy')
    if s == 'CUBE': return P[sorted(groups[h['cube_name']])].mean(0)
    if s == 'MEAN': return P[h['vertex_indices']].mean(0)
    if s == 'VERTEX': return P[h['vertex_index']]
    raise Exception('strategy ' + str(s) + ' for ' + n)

WJ = json.load(open(os.path.join(MH, 'rigs', 'standard', 'weights.game_engine.json')))['weights']
lists = [[] for _ in range(NV)]
for b, lst in WJ.items():
    for v, w in lst: lists[v].append((w, bidx[b]))
JNT = np.zeros((NV, 4), int); WGT = np.zeros((NV, 4))
for v in range(NV):
    l = sorted(lists[v], reverse=True)[:4]
    s = sum(w for w, _ in l) or 1
    for k, (w, b) in enumerate(l): JNT[v, k] = b; WGT[v, k] = w / s
    if not l: JNT[v, 0] = bidx['head']; WGT[v, 0] = 1

def classOf(nm):
    if re.match(r'^(head|neck)', nm): return 0
    if re.match(r'^(spine|clavicle)', nm): return 1
    if re.match(r'^(pelvis|Root)', nm): return 2
    if nm.startswith('upperarm'): return 3
    if nm.startswith('lowerarm'): return 4
    if re.match(r'^(hand|thumb|index|middle|ring|pinky)', nm): return 5
    if nm.startswith('thigh'): return 6
    if nm.startswith('calf'): return 7
    if re.match(r'^(foot|ball)', nm): return 8
    return 1
CLS = np.array([classOf(names[JNT[v, 0]]) for v in range(NV)])
childOf = {'thigh': 'calf', 'calf': 'foot', 'upperarm': 'lowerarm', 'lowerarm': 'hand'}

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ unwelded render mesh (UV seams) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
key, orig, uvs, tris = {}, [], [], []
for f in body_faces:
    ids = []
    for v, t in f:
        k = (v, t)
        if k not in key: key[k] = len(orig); orig.append(v); uvs.append((VT[t][0], 1 - VT[t][1]))
        ids.append(key[k])
    tris.append((ids[0], ids[1], ids[2])); tris.append((ids[0], ids[2], ids[3]))
orig = np.array(orig); uvs = np.array(uvs); tris = np.array(tris)
bodyV = np.array(sorted(groups['body']))          # shape vertex list
remap = np.full(NV, -1); remap[bodyV] = np.arange(len(bodyV))
print('render verts', len(orig), 'tris', len(tris), 'shape verts', len(bodyV))

# adjacency over body quads
E = set()
for f in body_faces:
    for a in range(len(f)):
        u, w = f[a][0], f[(a + 1) % len(f)][0]
        E.add((min(u, w), max(u, w)))
E = np.array(sorted(E))
deg = np.zeros(NV); np.add.at(deg, E[:, 0], 1); np.add.at(deg, E[:, 1], 1)
def nmean(P):
    S = np.zeros_like(P); np.add.at(S, E[:, 0], P[E[:, 1]]); np.add.at(S, E[:, 1], P[E[:, 0]])
    return S / np.maximum(deg, 1)[:, None]
def taubin(P, move, iters):
    m = move[:, None].astype(float)
    for _ in range(iters):
        P = P + 0.5 * (nmean(P) - P) * m
        P = P - 0.53 * (nmean(P) - P) * m
    return P
def vnormals(P):
    N = np.zeros_like(P)
    for f in body_faces:
        pass
    return N
BQ = np.array([[p[0] for p in f] for f in body_faces])
def vnormals(P):
    a, b, c, d = (P[BQ[:, k]] for k in range(4))
    fn = np.cross(c - a, d - b)
    N = np.zeros_like(P)
    for k in range(4): np.add.at(N, BQ[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
def interior(mask):
    bad = np.zeros(NV, bool)
    x = mask[E[:, 0]] != mask[E[:, 1]]
    bad[E[x, 0]] = True; bad[E[x, 1]] = True
    return mask & ~bad

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Quaternius hair (CC0), read as data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
COMP = {5126: ('<f4', 4), 5123: ('<u2', 2), 5121: ('u1', 1), 5125: ('<u4', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def gl_load(name):
    g = json.load(open(os.path.join(UBC, name + '.gltf'), encoding='utf-8'))
    binb = open(os.path.join(UBC, name + '.bin'), 'rb').read()
    def acc(i):
        a = g['accessors'][i]; bv = g['bufferViews'][a['bufferView']]
        dt, sz = COMP[a['componentType']]; n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', sz * n)
        raw = np.frombuffer(binb, np.uint8, count=stride * (a['count'] - 1) + sz * n, offset=off)
        out = np.lib.stride_tricks.as_strided(raw, (a['count'], sz * n), (stride, 1)).copy().view(dt).reshape(a['count'], n).astype(float)
        if a.get('normalized'): out /= {5121: 255, 5123: 65535}[a['componentType']]
        return out
    jn = [g['nodes'][j]['name'] for j in g['skins'][0]['joints']]
    prims = []
    for ni, n in enumerate(g['nodes']):
        if n.get('mesh') is None: continue
        for p in g['meshes'][n['mesh']]['primitives']:
            at = p['attributes']
            prims.append({'node': n.get('name', ''), 'pos': acc(at['POSITION']), 'j': acc(at['JOINTS_0']).astype(int), 'w': acc(at['WEIGHTS_0'])})
    return g, binb, jn, prims
qg, _, qjn, qprims = gl_load('Superhero_Male_FullBody')
QH = np.concatenate([p['pos'][np.array([qjn[j] == 'Head' for j in p['j'][np.arange(len(p['j'])), p['w'].argmax(1)]])]
                     for p in qprims if not re.match(r'^(Eyes|Eyebrows)', p['node'], re.I)])
HAIRS = {'hair_buzzed': 'Hair_Buzzed', 'hair_parted': 'Hair_SimpleParted', 'hair_long': 'Hair_Long', 'hair_buns': 'Hair_Buns', 'beard': 'Hair_Beard'}
hairsrc = {k: gl_load(v) for k, v in HAIRS.items()}

def head_frame(P):
    c = P.min(0) * 0.5 + P.max(0) * 0.5
    c[0] = 0.0
    c[1] = P[:, 1].min() + (P[:, 1].max() - P[:, 1].min()) * 0.55
    return c
def radial(C, Pts, dirs):
    U = Pts - C; rho = np.linalg.norm(U, axis=1); u = U / rho[:, None]
    out = np.zeros(len(dirs))
    for s in range(0, len(dirs), 800):
        cs = dirs[s:s + 800] @ u.T
        w = np.exp((cs - 1) / 0.003) * (rho[None, :] / rho.max()) ** 12
        out[s:s + 800] = (w * rho[None, :]).sum(1) / np.maximum(w.sum(1), 1e-30)
    return out
cQ = head_frame(QH); RQ = np.linalg.norm(QH - cQ, axis=1).mean()

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ players â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Approximate shapes chosen from public photos: build (muscle, weight), height, and broad face traits. Not scans.
R = lambda c=0, a=0, s=0: {'caucasian': c, 'african': a, 'asian': s}
PLAYERS = {
    'ronaldo':    (macro(0.92, 0.34, 0.85, 0.9, R(0.75, 0.2, 0.05)), face(head_oval=0.4, chin_prominent=0.6, chin_width=0.2, cheekbones=0.6, nose_long=0.25, nose_hump=-0.3, nose_point_wide=-0.3, brows_down=0.2, neck_thick=0.5, cheek_volume=-0.4, upperlip=-0.2)),
    'messi':      (macro(0.68, 0.36, 0.25, 0.7, R(0.9, 0.0, 0.1)), face(head_round=0.3, chin_prominent=-0.1, nose_long=0.2, nose_wide=0.1, nose_hump=0.15, cheek_volume=-0.1, eyes_small=0.2, mouth_wide=-0.1)),
    'carlos':     (macro(0.98, 0.42, 0.18, 0.6, R(0.4, 0.6, 0.0)), face(head_round=0.6, head_wide=0.2, nose_wide=0.4, nose_flare=0.5, nostrils_wide=0.4, upperlip=0.4, lowerlip=0.4, cheekbones=0.3, neck_thick=0.9, chin_width=0.3)),
    'beckham':    (macro(0.78, 0.3, 0.65, 0.85, R(1.0, 0.0, 0.0)), face(head_oval=0.4, chin_prominent=0.4, chin_cleft=0.3, cheekbones=0.5, nose_long=0.2, nose_point_wide=-0.4, nose_tip_up=0.2, cheek_volume=-0.3, eyes_narrow=0.3)),
    'pirlo':      (macro(0.62, 0.32, 0.5, 0.7, R(1.0, 0.0, 0.0)), face(head_rect=0.4, head_long=0.3, nose_long=0.6, nose_hump=0.6, nose_deep=0.4, nose_volume=0.3, eyes_down=0.3, cheek_volume=-0.3, brows_down=0.2)),
    'juninho':    (macro(0.78, 0.4, 0.5, 0.7, R(0.6, 0.4, 0.0)), face(head_square=0.4, nose_wide=0.3, nose_flare=0.3, chin_width=0.3, upperlip=0.2, neck_thick=0.4)),
    'ronaldinho': (macro(0.7, 0.32, 0.62, 0.7, R(0.35, 0.65, 0.0)), face(head_oval=0.5, head_long=0.3, mouth_wide=0.7, upperlip=0.8, lowerlip=0.5, nose_flare=0.5, nose_wide=0.3, cheekbones=0.5, chin_prominent=0.2)),
    'koeman':     (macro(0.72, 0.46, 0.5, 0.6, R(1.0, 0.0, 0.0)), face(head_round=0.5, chin_width=0.4, cheek_volume=0.3, nose_point_wide=0.3, nose_tip_up=0.2, neck_thick=0.4)),
    'mihajlovic': (macro(0.85, 0.42, 0.75, 0.75, R(1.0, 0.0, 0.0)), face(head_square=0.6, chin_width=0.5, chin_prominent=0.4, chin_bones=0.4, nose_hump=0.4, nose_long=0.2, brows_down=0.3, neck_thick=0.6)),
    'nakamura':   (macro(0.62, 0.3, 0.45, 0.65, R(0.1, 0.0, 0.9)), face(head_oval=0.3, nose_long=-0.1, cheekbones=0.2, eyes_narrow=0.3, chin_prominent=-0.2)),
    'bale':       (macro(0.88, 0.3, 0.75, 0.9, R(1.0, 0.0, 0.0)), face(head_rect=0.35, chin_prominent=0.4, cheekbones=0.4, nose_long=0.3, nose_hump=0.2, eyes_down=0.2, neck_thick=0.4)),
    'wall0':      (macro(0.75, 0.42, 0.6, 0.7, R(0.9, 0.1, 0.0)), face(head_square=0.3, nose_hump=0.2)),
    'wall1':      (macro(0.85, 0.4, 0.7, 0.7, R(0.3, 0.7, 0.0)), face(head_oval=0.4, nose_wide=0.3, upperlip=0.3)),
    'wall2':      (macro(0.7, 0.38, 0.55, 0.7, R(0.8, 0.1, 0.1)), face(head_round=0.3, chin_width=0.3)),
    'wall3':      (macro(0.9, 0.44, 0.8, 0.7, R(0.1, 0.9, 0.0)), face(head_square=0.4, nose_flare=0.4, lowerlip=0.3, neck_thick=0.7)),
    'wall4':      (macro(0.72, 0.34, 0.65, 0.8, R(1.0, 0.0, 0.0)), face(head_rect=0.4, nose_long=0.3, chin_prominent=0.3)),
    'wall5':      (macro(0.8, 0.4, 0.5, 0.7, R(0.55, 0.45, 0.0)), face(head_oval=0.3, cheekbones=0.3)),
    'keeper':     (macro(0.8, 0.42, 0.9, 0.85, R(0.9, 0.05, 0.05)), face(head_rect=0.3, chin_prominent=0.3, chin_width=0.3, nose_long=0.2, neck_thick=0.4)),
}
# stage 26: the named players' MakeHuman face shapes at 1.4× (clipped to the target range), for a stronger likeness
for _pid in ('ronaldo', 'messi', 'carlos', 'beckham', 'pirlo', 'juninho', 'ronaldinho', 'koeman', 'mihajlovic', 'nakamura', 'bale'):
    _m, _f = PLAYERS[_pid]
    PLAYERS[_pid] = (_m, {k_: float(np.clip(v_ * 1.4, -1, 1)) for k_, v_ in _f.items()})
# hair: (style keys, scalp-hair thickness scale, beard thickness in metres)
ALLKEYS = ['hair_parted', 'hair_buzzed', 'hair_slick', 'hair_long', 'bun', 'beard']   # every player carries every shell (small)
STYLE = {'ronaldo': (ALLKEYS, 1.1, 0), 'messi': (ALLKEYS, 1, 0.0046), 'carlos': (ALLKEYS, 0, 0), 'beckham': (ALLKEYS, 1.15, 0), 'pirlo': (ALLKEYS, 1, 0.004),
         'juninho': (ALLKEYS, 1, 0), 'ronaldinho': (ALLKEYS, 1.1, 0), 'koeman': (ALLKEYS, 1, 0), 'mihajlovic': (ALLKEYS, 1, 0),
         'nakamura': (ALLKEYS, 1, 0), 'bale': (ALLKEYS, 1, 0.0042)}
ALLH = (ALLKEYS, 1.0, 0.0034)
HEAD_K = 0.07          # stylized proportions: heads 7 % bigger (blended by the head-bone weight, so the neck stays smooth)

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ hair and beard grown as shells from the scalp and jaw â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def load_mask(n):
    return np.asarray(Image.open(os.path.join(MH, 'textures', 'mpfb_%s.jpg' % n)).convert('L').resize((1024, 1024), Image.LANCZOS)) / 255.0
def sstep(a, b, x): t_ = np.clip((x - a) / (b - a), 0, 1); return t_ * t_ * (3 - 2 * t_)
Pn = morph(macro(0.7, 0.4, 0.5, 0.7, R(1 / 3, 1 / 3, 1 / 3))) / 10.0
Pn[:, 1] -= Pn[body_set, 1].min()
eL = Pn[sorted(groups['helper-l-eye'])].mean(0); eR = Pn[sorted(groups['helper-r-eye'])].mean(0)
headN = Pn[body_set & (CLS == 0) & (Pn[:, 1] > eL[1] - 0.14)]
cN = head_frame(headN)
EARS, LIPS = load_mask('ears'), load_mask('lips')
vuv = np.zeros((NV, 2)); vuv[orig] = uvs
def at_uv(mask, uvv):
    q = np.clip((uvv * 1023).round().astype(int), 0, 1023); return mask[q[:, 1], q[:, 0]]
def hair_d(X, Y, Z):
    """Signed height above the hairline (m): > 0 on the scalp."""
    fn = np.clip((Z - cN[2]) / 0.09, -1, 1); h = Y - eL[1]
    H = 0.022 + 0.040 * sstep(0.15, 0.75, fn) - 0.09 * sstep(-0.25, -0.95, fn)
    return h - H
def beard_d(X, Y, Z):
    """Signed depth inside the beard area (m): > 0 on the jaw, chin, upper lip and sideburns."""
    h = Y - eL[1]; f = Z - cN[2]
    Hb = -0.046 - 0.012 * np.exp(-(X / 0.02) ** 2)               # cheek line, dipping to the moustache under the nose
    side = np.minimum(f + 0.03, 0.03)                            # stays in front of the ears
    under = np.minimum(h + 0.118, 0.03) + np.clip(f + 0.01, -0.03, 0) * 0.0   # down to the jawline only
    neck = np.where(h < -0.105, f - 0.0, 0.03)                   # under the chin: front half only
    return np.minimum(np.minimum(np.minimum(Hb - h, under), side), neck)
def long_d(X, Y, Z):
    """Long hair: from the forehead hairline down over the ears to the jaw, and to the nape behind; never over the face."""
    fn = np.clip((Z - cN[2]) / 0.09, -1, 1); h = Y - eL[1]; f = Z - cN[2]
    H = -0.075 + 0.125 * sstep(0.15, 0.8, fn) - 0.04 * sstep(-0.2, -0.9, fn)
    return np.minimum(h - H, np.where(h < 0.035, 0.018 - f, 1.0))
headmask = body_set & (CLS == 0)
d_hair = np.where(headmask, hair_d(Pn[:, 0], Pn[:, 1], Pn[:, 2]), -1.0)
d_hair[at_uv(EARS, vuv) > 0.3] = -1.0
EARV = at_uv(np.asarray(Image.fromarray((EARS * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(10))) / 255.0, vuv)
d_long = np.where(headmask, long_d(Pn[:, 0], Pn[:, 1], Pn[:, 2]), -1.0)
d_beard = np.where(headmask, beard_d(Pn[:, 0], Pn[:, 1], Pn[:, 2]), -1.0)
d_beard[at_uv(LIPS, vuv) > 0.2] = -1.0
hN = Pn[:, 1] - eL[1]; fnN = np.clip((Pn[:, 2] - cN[2]) / 0.09, -1, 1)
PROFILE = {
    'hair_parted': (d_hair, 0.022, 0.006 + 0.011 * sstep(0.02, 0.10, hN) + 0.005 * sstep(0.3, 0.9, fnN) * sstep(0.05, 0.09, hN)),
    'hair_buzzed': (d_hair, 0.008, np.full(NV, 0.0028)),
    'hair_slick': (d_hair, 0.014, np.full(NV, 0.006)),
    'hair_long': (d_long, 0.02, 0.011 + 0.012 * sstep(0.03, -0.06, hN) + 0.012 * EARV),   # (less flare over the ears)
    'beard': (d_beard, 0.016, np.ones(NV)),                     # scaled by each player's beard thickness
}
HEADJ = bidx['head']
shell_topo = {}
def subdiv(tri, M):
    """Split every triangle into four; new vertices are edge midpoints (rows of M: weights over the base vertices)."""
    T = tri.reshape(-1, 3); emap = {}; pairs = []; n0 = len(M)
    def mid(a, b):
        k_ = (a, b) if a < b else (b, a)
        if k_ not in emap: emap[k_] = n0 + len(pairs); pairs.append(k_)
        return emap[k_]
    out = []
    for a, b, c in T:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        out += [a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca]
    pa = np.array(pairs)
    return np.array(out), np.vstack([M, 0.5 * (M[pa[:, 0]] + M[pa[:, 1]])])
SUBDIV = {'hair_parted': 2, 'hair_slick': 2, 'hair_buzzed': 1, 'hair_long': 1, 'beard': 1}   # the scalp mesh is coarse (~2 cm)
for k, (d, ramp, thick) in PROFILE.items():
    keep = d > -0.002
    fq = [f for f in body_faces if all(keep[v] for v, _ in f)]
    vs = sorted({v for f in fq for v, _ in f}); loc = {v: i for i, v in enumerate(vs)}
    tri = []
    for f in fq:
        a = [loc[v] for v, _ in f]; tri += [a[0], a[1], a[2], a[0], a[2], a[3]]
    vs = np.array(vs); tri = np.array(tri)
    M = np.eye(len(vs), dtype=np.float32)
    for _ in range(SUBDIV.get(k, 0)): tri, M = subdiv(tri, M)
    P0 = M @ Pn[vs]
    if k == 'beard': uv = np.stack([P0[:, 0] * 40, -P0[:, 1] * 40], 1)
    else: uv = np.stack([P0[:, 0] * 22, -(P0[:, 1] - 0.6 * (P0[:, 2] - cN[2])) * 22], 1)
    dom = np.argmax(M, 1)                                       # skin weights from the nearest base vertex
    J = JNT[vs][dom].copy(); W = WGT[vs][dom].copy()
    if k == 'hair_long': J[:] = 0; J[:, 0] = HEADJ; W[:] = 0; W[:, 0] = 1     # long hair moves with the head, not the neck
    E2 = np.unique(np.sort(np.concatenate([tri.reshape(-1, 3)[:, [0, 1]], tri.reshape(-1, 3)[:, [1, 2]], tri.reshape(-1, 3)[:, [2, 0]]]), 1), axis=0)
    # sculpted locks: thickness ridges radiating from the crown (a stylized, carved look rather than strands)
    clump = np.ones(len(P0))
    if k in ('hair_parted', 'hair_slick', 'hair_long'):
        crown = cN + np.array([0.0, 0.1, -0.035])
        dd = P0 - crown; az = np.arctan2(dd[:, 0], dd[:, 2])
        n_ = 9 if k == 'hair_parted' else 13
        ridge = 0.5 + 0.5 * np.cos(az * n_ + 0.6 * np.sin(az * 3))
        clump = (0.72 + 0.56 * ridge ** 1.5) if k == 'hair_parted' else (0.88 + 0.24 * ridge)   # long hair: gentle waves, not lumps
    shell_topo[k] = {'v': vs, 'M': M, 'P0': P0, 'idx': tri, 'uv': uv, 'prof': sstep(0.0, ramp, M @ d[vs]), 'thick': (M @ thick[vs]) * clump, 'J': J, 'W': W, 'E': E2}
    print('shell', k, len(P0), 'verts', len(tri) // 3, 'tris')
# the bun: a small sphere, skinned to the head
bp, bidx_, buv = [], [], []
for i in range(9):
    th = math.pi * i / 8
    for j in range(13):
        ph = 2 * math.pi * j / 12
        bp.append((math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph))); buv.append((j / 12 * 3, i / 8 * 3))
for i in range(8):
    for j in range(12):
        a = i * 13 + j; b = a + 13; bidx_ += [a, a + 1, b, a + 1, b + 1, b]
BUN = np.array(bp)
Jb = np.zeros((len(bp), 4), int); Jb[:, 0] = HEADJ; Wb = np.zeros((len(bp), 4)); Wb[:, 0] = 1
shell_topo['bun'] = {'v': None, 'idx': np.array(bidx_), 'uv': np.array(buv), 'prof': np.ones(len(bp)), 'thick': None, 'J': Jb, 'W': Wb}
def smooth_shell(Q, E2, fixed, iters):
    deg_ = np.zeros(len(Q)); np.add.at(deg_, E2[:, 0], 1); np.add.at(deg_, E2[:, 1], 1)
    mv = (~fixed)[:, None].astype(float)
    for _ in range(iters):
        for lam in (0.5, -0.53):
            S_ = np.zeros_like(Q); np.add.at(S_, E2[:, 0], Q[E2[:, 1]]); np.add.at(S_, E2[:, 1], Q[E2[:, 0]])
            Q = Q + lam * (S_ / np.maximum(deg_, 1)[:, None] - Q) * mv
    return Q

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ MakeHuman CC0 system assets: proxies (hair, eyebrows, eyelashes, eyes) fitted to each body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
SYSD = os.environ.get('MH_SYS', '')
def read_obj_any(path):
    vs, vts, fs = [], [], []
    for ln in open(path, encoding='utf-8', errors='ignore'):
        if ln.startswith('v '): vs.append([float(x) for x in ln.split()[1:4]])
        elif ln.startswith('vt '): vts.append([float(x) for x in ln.split()[1:3]])
        elif ln.startswith('f '):
            fs.append([tuple(int(x) - 1 if x else -1 for x in (p.split('/') + ['', ''])[:2]) for p in ln.split()[1:]])
    return np.array(vs), np.array(vts) if vts else np.zeros((1, 2)), fs
def read_mhclo(path):
    sc, refs, on = {}, [], False
    for ln in open(path, encoding='utf-8', errors='ignore'):
        s = ln.split()
        if not s or s[0].startswith('#'): continue
        if s[0] in ('x_scale', 'y_scale', 'z_scale'): sc['xyz'.index(s[0][0])] = (int(s[1]), int(s[2]), float(s[3])); continue
        if s[0] == 'verts': on = True; continue
        if on:
            if s[0] in ('delete_verts', 'weights', 'vertexboneweights_file'): on = False; continue
            if not re.match(r'^-?\d', s[0]): continue
            if len(s) >= 9: refs.append(([int(s[0]), int(s[1]), int(s[2])], [float(x) for x in s[3:6]], [float(x) for x in s[6:9]]))
            elif len(s) == 1: refs.append(([int(s[0]), int(s[0]), int(s[0])], [1.0, 0, 0], [0.0, 0, 0]))
    return sc, refs
PROXIES = {   # key: (folder, obj, mhclo, texture, part) â€” part 1 = eyes, 2 = hair-like (alpha)
    'eyes': ('eyes/high-poly', 'high-poly.obj', 'high-poly.mhclo', 'eyes/materials/brown_eye.png', 1),
    'brows': ('eyebrows/eyebrow001', 'eyebrow001.obj', 'eyebrow001.mhclo', 'eyebrows/eyebrow001/eyebrow001.png', 2),
    'brows_thick': ('eyebrows/eyebrow010', 'eyebrow010.obj', 'eyebrow010.mhclo', 'eyebrows/eyebrow010/eyebrow010.png', 2),
    'lashes': ('eyelashes/eyelashes01', 'eyelashes01.obj', 'eyelashes01.mhclo', 'eyelashes/eyelashes01/eyelashes01.png', 2),
}
for hk in ('short01', 'short02', 'short03', 'short04', 'long01', 'ponytail01', 'bob02', 'afro01'):
    tex = 'afro_diffuse.png' if hk == 'afro01' else hk + '_diffuse.png'
    PROXIES['h_' + hk] = ('hair/' + hk, hk + '.obj', hk + '.mhclo', 'hair/%s/%s' % (hk, tex), 2)
proxy_topo = {}
if SYSD:
    for key, (fold, objn, clon, texn, part) in PROXIES.items():
        pv, pvt, pf = read_obj_any(os.path.join(SYSD, fold, objn))
        sc, refs = read_mhclo(os.path.join(SYSD, fold, clon))
        assert len(refs) == len(pv), (key, len(refs), len(pv))
        RI = np.array([r[0] for r in refs]); RW = np.array([r[1] for r in refs]); RD = np.array([r[2] for r in refs])
        kmap, orig_p, uvp, tri = {}, [], [], []
        for f in pf:
            ids = []
            for v, t in f:
                kk = (v, t)
                if kk not in kmap: kmap[kk] = len(orig_p); orig_p.append(v); uvp.append((pvt[t][0], 1 - pvt[t][1]) if t >= 0 else (0, 0))
                ids.append(kmap[kk])
            for q in range(1, len(ids) - 1): tri += [ids[0], ids[q], ids[q + 1]]
        orig_p = np.array(orig_p)
        if part == 1:                                  # eyes: keep the eyeball, drop the transparent cornea layer
            ta = np.asarray(Image.open(os.path.join(SYSD, texn)).convert('RGBA'))[..., 3]
            uvq = np.array(uvp); T_ = np.array(tri).reshape(-1, 3); cuv = uvq[T_].mean(1)
            q = np.clip((cuv * (ta.shape[0] - 1)).round().astype(int), 0, ta.shape[0] - 1)
            tri = T_[ta[q[:, 1], q[:, 0]] > 128].ravel().tolist()
        # skin weights: the reference vertices' weights, blended by the barycentric weights
        acc = [dict() for _ in range(len(pv))]
        for i in range(len(pv)):
            for r in range(3):
                if RW[i, r] == 0: continue
                for q in range(4):
                    if WGT[RI[i, r], q] > 0: acc[i][JNT[RI[i, r], q]] = acc[i].get(JNT[RI[i, r], q], 0) + RW[i, r] * WGT[RI[i, r], q]
        J = np.zeros((len(pv), 4), int); W = np.zeros((len(pv), 4))
        for i, a in enumerate(acc):
            top = sorted(a.items(), key=lambda kv: -abs(kv[1]))[:4]; s_ = sum(max(0, w) for _, w in top) or 1
            for q, (b_, w) in enumerate(top): J[i, q] = b_; W[i, q] = max(0, w) / s_
            if not top: J[i, 0] = bidx['head']; W[i, 0] = 1
        proxy_topo[key] = {'RI': RI, 'RW': RW, 'RD': RD, 'sc': sc, 'orig': orig_p, 'idx': np.array(tri), 'uv': np.array(uvp),
                           'J': J[orig_p], 'W': W[orig_p], 'tex': os.path.join(SYSD, texn), 'part': part}
        print('proxy', key, len(pv), 'verts', len(tri) // 3, 'tris')
def fit_proxy(key, Pm):
    """Proxy vertex positions (m) on body positions Pm (m): barycentric blend of 3 body vertices + scaled offset."""
    pt = proxy_topo[key]
    pos = (Pm[pt['RI']] * pt['RW'][:, :, None]).sum(1)
    for ax in range(3):
        a, b, den = pt['sc'][ax]
        pos[:, ax] += pt['RD'][:, ax] / 10.0 * abs(Pm[a, ax] - Pm[b, ax]) * 10.0 / den
    return pos[pt['orig']]
# per player: main hairstyle proxy (None = bald / buzz shell), brows, skin texture
LOOK = {'ronaldo': ('h_short02', 'brows_thick', 'light2'), 'messi': ('h_short04', 'brows', 'light'), 'carlos': (None, 'brows_thick', 'dark'),
        'beckham': ('h_short01', 'brows', 'light'), 'pirlo': ('h_long01', 'brows_thick', 'light2'), 'juninho': (None, 'brows', 'dark'),
        'ronaldinho': ('h_long01', 'brows', 'dark'), 'koeman': ('h_short03', 'brows', 'light'), 'mihajlovic': (None, 'brows_thick', 'light2'),
        'nakamura': ('h_bob02', 'brows', 'asian'), 'bale': ('h_ponytail01', 'brows', 'light'),
        'wall0': ('h_short02', 'brows_thick', 'light2'), 'wall1': (None, 'brows', 'dark'), 'wall2': ('h_short01', 'brows', 'light2'),
        'wall3': (None, 'brows_thick', 'dark'), 'wall4': ('h_bob02', 'brows', 'light'), 'wall5': (None, 'brows', 'dark'),
        'keeper': ('h_short04', 'brows_thick', 'light2')}
# ───────────── likeness: per-player face sculpting beyond the MakeHuman targets (stylized, caricature-leaning) ─────────────
# ears, jaw width, face length, eye size, lip push, brow ridge, cheek width, nose size, chin push — soft regional
# deformations around landmarks found on each player's own head. Values are approximations from public photos.
FACE = {
    # stage 26: caricature strength roughly doubled (the user found the earlier, subtler faces unchanged-looking)
    'ronaldo':    dict(jaw=1.13, face_long=1.11, eyes=1.06, chin_fwd=0.009, cheeks=0.92, brow=0.003, nose=0.94),   # long face, chiselled jaw, hollow cheeks
    'messi':      dict(face_long=0.91, jaw=1.07, nose=1.16, eyes=0.92, ears=1.16, cheeks=1.04),                   # short round face, bigger nose, small eyes
    'carlos':     dict(jaw=1.12, cheeks=1.12, lips=0.011, nose=1.22, face_long=0.92, ears=1.28, brow=0.006, eyes=0.91),   # round, broad nose, full lips
    'beckham':    dict(face_long=1.13, eyes=0.94, chin_fwd=0.009, nose=0.93, cheeks=0.91, jaw=0.93),             # narrow, fine nose, strong chin
    'pirlo':      dict(face_long=1.17, nose=1.27, eyes=0.91, cheeks=0.91, brow=0.004),                           # long face, long nose, heavy-lidded
    'juninho':    dict(jaw=1.11, cheeks=1.1, nose=1.12, face_long=0.95),
    'ronaldinho': dict(lips=0.022, face_long=1.16, jaw=0.9, eyes=1.07, cheeks=1.06, chin_fwd=0.007, nose=1.14),   # the smile: big lips pushed forward
    'koeman':     dict(cheeks=1.16, jaw=1.14, face_long=0.9, eyes=0.91),                                         # round and full
    'mihajlovic': dict(jaw=1.2, brow=0.008, face_long=1.06, chin_fwd=0.007),                                    # square jaw, heavy brow
    'nakamura':   dict(face_long=1.08, jaw=0.9, eyes=0.9, nose=0.9),
    'bale':       dict(ears=1.5, face_long=1.12, nose=1.1, chin_fwd=0.005, jaw=1.04),                           # ears, long face
}
# per-player hair shaping on the scalp shells: quiff (m, front-top), fringe (m, over the forehead), sides (thickness
# kept on the lower sides: < 1 = faded), vol (overall thickness)
# spikes (gelled points on top), part (centre parting depth, m), locks (curly locks, relative ridge depth)
# (tuned against reference photos: Ronaldo 2008, Messi 2019, Ronaldinho 2002, Bale 2022, R. Carlos 2002, Beckham 1998)
HAIRMOD = {
    'ronaldo': dict(quiff=0.022, sides=0.25, spikes=1.0), 'messi': dict(quiff=0.014, sides=0.4),
    'beckham': dict(vol=1.45, sides=0.9, fringe=0.016, part=0.015),
    'koeman': dict(fringe=0.01, vol=1.15), 'pirlo': dict(vol=1.25), 'ronaldinho': dict(vol=1.35, locks=0.9),
    'nakamura': dict(fringe=0.016, vol=1.2),
}
# eyebrow weight (0.5 = medium): thin and groomed … heavy
BROWW = {'ronaldo': 0.36, 'messi': 0.5, 'carlos': 0.6, 'beckham': 0.5, 'pirlo': 0.6, 'juninho': 0.5, 'ronaldinho': 0.55,
         'koeman': 0.4, 'mihajlovic': 0.66, 'nakamura': 0.56, 'bale': 0.48}
def sculpt_face(P, ops):
    if not ops: return P
    P = P.copy()
    head = body_set & (CLS == 0)
    hv = np.nonzero(head)[0]; H = P[hv]
    eC = [P[sorted(groups[g])].mean(0) for g in ('helper-l-eye', 'helper-r-eye')]
    eyeY = (eC[0][1] + eC[1][1]) / 2
    lipw = at_uv(LIPS, vuv)[hv]; earw = EARV[hv]
    mouth = (H * lipw[:, None]).sum(0) / max(lipw.sum(), 1e-6)
    front = H[:, 2] > mouth[2] - 0.035
    chinY = H[front & (np.abs(H[:, 0]) < 0.015), 1].min()
    noseI = np.argmax(np.where((H[:, 1] < eyeY - 0.01) & (H[:, 1] > eyeY - 0.07) & (np.abs(H[:, 0]) < 0.012), H[:, 2], -9))
    noseC = H[noseI] + np.array([0, 0.012, -0.012])
    D = np.zeros_like(H)
    g = ops.get
    if g('ears'):
        for sgn in (-1, 1):
            w = earw * (np.sign(H[:, 0]) == sgn)
            if w.sum() < 1e-6: continue
            ec = (H * w[:, None]).sum(0) / w.sum()
            D += (H - ec) * (g('ears') - 1) * w[:, None] + np.array([sgn * 0.006, 0, 0]) * (g('ears') - 1) * w[:, None] / 0.3
    lowface = sstep(mouth[1] + 0.012, chinY + 0.005, H[:, 1]) * sstep(-0.02, 0.02, H[:, 2] - (mouth[2] - 0.06))
    if g('jaw'): D[:, 0] += H[:, 0] * (g('jaw') - 1) * lowface
    if g('face_long'):
        wf = sstep(eyeY + 0.005, eyeY - 0.03, H[:, 1]) * sstep(-0.03, 0.01, H[:, 2] - (mouth[2] - 0.08)) * sstep(chinY - 0.04, chinY - 0.01, H[:, 1])
        D[:, 1] += (H[:, 1] - eyeY) * (g('face_long') - 1) * wf
    if g('eyes'):
        for c_ in eC:
            r = np.linalg.norm(H - c_, axis=1); w = sstep(0.03, 0.012, r)
            D += (H - c_) * (g('eyes') - 1) * w[:, None]
    if g('lips'):
        wl = np.clip(at_uv(np.asarray(Image.fromarray((LIPS * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(6))) / 255.0, vuv)[hv] * 1.4, 0, 1)
        D[:, 2] += g('lips') * wl
    if g('brow'):
        wb = sstep(eyeY + 0.004, eyeY + 0.016, H[:, 1]) * sstep(eyeY + 0.045, eyeY + 0.03, H[:, 1]) * sstep(-0.01, 0.01, H[:, 2] - (eC[0][2] - 0.005)) * sstep(0.065, 0.045, np.abs(H[:, 0]))
        D[:, 2] += g('brow') * wb; D[:, 1] -= g('brow') * 0.5 * wb
    if g('cheeks'):
        wc = sstep(eyeY - 0.005, eyeY - 0.025, H[:, 1]) * sstep(mouth[1] - 0.02, mouth[1] + 0.005, H[:, 1]) * sstep(-0.03, 0.01, H[:, 2] - (mouth[2] - 0.07))
        D[:, 0] += H[:, 0] * (g('cheeks') - 1) * wc
    if g('nose'):
        r = np.linalg.norm(H - noseC, axis=1); w = sstep(0.03, 0.014, r) * (H[:, 2] > noseC[2] - 0.02)
        D += (H - noseC) * (g('nose') - 1) * w[:, None]
    if g('chin_fwd'):
        D[:, 2] += g('chin_fwd') * lowface * sstep(0.04, 0.0, np.abs(H[:, 0]))
    P[hv] = H + D
    # the eye helpers (eyeball spheres) follow the eye scaling
    if g('eyes'):
        for gname, c_ in zip(('helper-l-eye', 'helper-r-eye'), eC):
            ids = sorted(groups[gname]); P[ids] = c_ + (P[ids] - c_) * g('eyes')
    return P

def build(pid, spec, keeper=False):
    P = morph(spec) / 10.0                                     # decimetres â†’ metres
    P[:, 1] -= P[body_set, 1].min()                            # soles on the ground
    P_unsculpted = P.copy()
    JP = np.array([head_pos(P, n) for n in names])
    # region class + position along the bone, for the kit sculpt
    t = np.zeros(NV)
    for v in np.nonzero(body_set)[0]:
        nm = names[JNT[v, 0]]; base = re.sub(r'_[lr]$', '', nm)
        if base in childOf:
            a = JP[JNT[v, 0]]; b = JP[bidx[childOf[base] + nm[-2:]]]; ab = b - a
            t[v] = np.clip((P[v] - a) @ ab / (ab @ ab), 0, 1)
    beltY = JP[bidx['pelvis'], 1] + 0.07; kneeY = JP[bidx['calf_l'], 1]
    y = P[:, 1]; c = CLS
    sleeve = 0.8 if keeper else 0.55
    nk = JP[bidx['neck_01']]; rel = P[:, [0, 2]] - nk[[0, 2]]
    fr = np.clip(rel[:, 1] / np.maximum(np.linalg.norm(rel, axis=1), 1e-6), 0, 1)
    collar = nk[1] - 0.02 - 0.035 * fr - y                      # > 0 below the neckline (dips in front)
    shirt = body_set & ((((c == 1) | (c == 0)) & (collar > 0)) | ((c == 2) & (y > beltY)) | ((c == 3) & (t < sleeve)) | ((c == 3) & keeper) | ((c == 4) & keeper))
    shortsT = 0.8 if keeper else 0.45
    shorts = body_set & (((c == 2) & (y <= beltY)) | ((c == 6) & (t < shortsT)))
    sockTop = kneeY + (0.07 if keeper else -0.075)
    socks = body_set & ((c == 7) | (c == 6)) & (y < sockTop) & ~shorts
    boots = body_set & (c == 8)
    # fabric hides anatomy: smooth under the shirt and shorts, strongly inside the boots (no toes)
    P = taubin(P, interior(shirt), 28)                         # a jersey hangs over the chest: no pecs, no navel
    P = taubin(P, interior(shorts), 14)
    P = taubin(P, interior(boots | (socks & (y < JP[bidx['foot_l'], 1] + 0.04))), 25)
    N = vnormals(P)
    off = np.zeros(NV)
    lower = np.clip(1 - (y - beltY) / 0.3, 0, 1)
    off[shirt] = (0.011 + 0.012 * lower[shirt]) * sstep(0.0, 0.03, collar[shirt])
    arm = shirt & (c == 3)
    off[arm] = 0.006 + 0.010 * np.clip(t[arm] / sleeve, 0, 1)
    if keeper:
        fa = shirt & (c == 4); off[fa] = 0.012; gl_ = body_set & (c == 5); off[gl_] = 0.007   # padded gloves
    th = shorts & (c == 6)
    off[shorts] = 0.013
    off[th] = 0.013 + 0.016 * np.clip(t[th] / shortsT, 0, 1)
    off[socks] = 0.003
    off[boots] = 0.006
    P = P + N * off[:, None]
    sole = boots & (P[:, 1] < 0.012); P[sole, 1] *= 0.25
    # bigger head, scaled about the head joint by each vertex's head weight; joints in the head scale with it
    hj = bidx['head']; wh = (WGT * (JNT == hj)).sum(1)
    piv = JP[hj].copy()
    P = piv + (P - piv) * (1 + HEAD_K * wh)[:, None]
    for bi in range(len(names)):
        a_ = bi
        while a_ >= 0 and a_ != hj: a_ = parent[a_]
        if a_ == hj and bi != hj: JP[bi] = piv + (JP[bi] - piv) * (1 + HEAD_K)
    P = sculpt_face(P, FACE.get(pid))
    # smoother faces for the cel shading: Taubin passes (volume kept) over the head, away from eyes, lips and ears,
    # so the low-poly facets of cheeks, jaw and nose stop breaking into blocky light/shade patches
    ec = [P[sorted(groups[g])].mean(0) for g in ('helper-l-eye', 'helper-r-eye')]
    near_eye = np.min([np.linalg.norm(P - c_, axis=1) for c_ in ec], axis=0) < 0.024
    fm = body_set & (CLS == 0) & (P[:, 1] > JP[bidx['neck_01'], 1] + 0.04) & ~near_eye & (at_uv(LIPS, vuv) < 0.25) & (at_uv(EARS, vuv) < 0.25)
    P = taubin(P, interior(fm), 6)
    # eyes: spheres at the eye helpers
    eyes = []
    for g in ('helper-l-eye', 'helper-r-eye'):
        E_ = P[sorted(groups[g])]; ce = E_.mean(0); r = np.linalg.norm(E_ - ce, axis=1).mean()
        eyes += [*ce.tolist(), r]
    # hair refitted radially onto this head (thickness above the scalp kept, scaled to the head size)
    headM = P[body_set & (np.array([names[j] for j in JNT[:, 0]]) == 'head')]
    cM = head_frame(headM); RM = np.linalg.norm(headM - cM, axis=1).mean(); s = RM / RQ
    hair = {}
    keys, hscale, beard = ALLH if pid.startswith('wall') or pid == 'keeper' else STYLE.get(pid, ([], 0, 0))
    NH = vnormals(P)
    for k in keys:
        st = shell_topo[k]
        if k == 'bun':                                             # on the crown, towards the back
            top = headM[np.argmax(headM[:, 1] - 0.8 * headM[:, 2])]
            ctr = cM + (top - cM) * 1.0 + (top - cM) / np.linalg.norm(top - cM) * 0.034
            hair[k] = ctr + BUN * np.array([0.036, 0.03, 0.036]); continue
        amt = beard if k == 'beard' else hscale if k in ('hair_parted', 'hair_long') else 1.0
        off = 0.0006 + st['prof'] * st['thick'] * amt
        hm = HAIRMOD.get(pid)
        if hm and k in ('hair_parted', 'hair_long', 'hair_slick'):
            hv_ = st['P0']; hh = hv_[:, 1] - eL[1]; ff = np.clip((hv_[:, 2] - cN[2]) / 0.09, -1, 1); sd = np.abs(hv_[:, 0])
            mult = hm.get('vol', 1.0) * (1 - (1 - hm.get('sides', 1.0)) * sstep(0.045, 0.07, sd) * sstep(0.1, 0.04, hh))
            off = 0.0006 + (off - 0.0006) * mult
            off = off + st['prof'] * hm.get('quiff', 0) * sstep(0.2, 0.8, ff) * sstep(0.04, 0.09, hh)
            off = off + st['prof'] * hm.get('fringe', 0) * sstep(0.55, 0.9, ff) * sstep(0.08, 0.03, hh)
            dd_ = hv_ - (cN + np.array([0.0, 0.1, -0.035])); az_ = np.arctan2(dd_[:, 0], dd_[:, 2])
            if hm.get('spikes'):      # short gelled points across the top
                hf = 0.5 + 0.5 * np.cos(az_ * 15 + 5 * np.sin(hh * 45))
                off = 0.0006 + (off - 0.0006) * (1 + hm['spikes'] * (hf - 0.4) * sstep(0.04, 0.08, hh))
            if hm.get('part'):        # centre parting: a groove from the front hairline back over the top
                off = off - st['prof'] * hm['part'] * sstep(0.008, 0.002, np.abs(hv_[:, 0])) * sstep(0.0, 0.5, ff) * sstep(0.03, 0.07, hh)
                off = np.maximum(off, 0.0008)
            if hm.get('locks'):       # curly locks: deep ridges falling from the crown, broken up along their length
                lk_ = 0.5 + 0.5 * np.cos(az_ * 22) * (0.75 + 0.25 * np.cos(hh * 70 + az_ * 3))
                off = 0.0006 + (off - 0.0006) * (1 + hm['locks'] * (lk_ - 0.45))
        Nv = st['M'] @ NH[st['v']]; Nv /= np.maximum(np.linalg.norm(Nv, axis=1), 1e-9)[:, None]
        Q = st['M'] @ P[st['v']] + Nv * off[:, None]
        if k == 'hair_long': Q = smooth_shell(Q, st['E'], st['prof'] < 0.05, 12)
        elif k in ('hair_parted', 'hair_slick', 'beard'): Q = smooth_shell(Q, st['E'], st['prof'] < 0.05, 5)   # soft, sculpted surface
        hair[k] = Q
    lk = LOOK.get(pid)
    if lk and proxy_topo:
        for key in ('eyes', 'lashes', lk[1]) + ((lk[0],) if lk[0] else ()):
            hair[key] = fit_proxy(key, P_unsculpted)
    return P, JP, eyes, hair

def i16(a):
    q = np.clip(np.round(np.asarray(a) * 10000), -32767, 32767).astype('<i2')
    return base64.b64encode(q.tobytes()).decode('ascii')
def b64(a, dt): return base64.b64encode(np.ascontiguousarray(np.asarray(a).astype(dt)).tobytes()).decode('ascii')

shapes = {}
for pid, (mac, fac) in PLAYERS.items():
    spec = dict(mac); spec.update(fac)
    P, JP, eyes, hair = build(pid, spec, keeper=(pid == 'keeper'))
    shapes[pid] = {'pos': i16(P[bodyV]), 'joints': [round(float(x), 5) for x in JP.ravel()], 'eyes': [round(float(x), 5) for x in eyes],
                   'hair': {k: i16(v) for k, v in hair.items()}, 'height': round(float(P[body_set, 1].max()), 4),
                   'browW': BROWW.get(pid, 0.5),
                   'main': LOOK[pid][0] if proxy_topo else None, 'brows': LOOK[pid][1] if proxy_topo else None, 'skin': LOOK[pid][2] if SYSD else None}
    print(pid, 'height %.3f m' % P[body_set, 1].max(), 'hair', list(hair))
    if pid == 'ronaldo': P_ron, JP_ron = P, JP

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ eye sphere (front pole along +z; iris painted by planar UV) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
RINGS, SEGS = 14, 24
ep, euv, eidx = [], [], []
for i in range(RINGS + 1):
    th = math.pi * i / RINGS
    for j in range(SEGS + 1):
        ph = 2 * math.pi * j / SEGS
        x, y, z = math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)
        ep.append((x, y, z)); euv.append((0.5 + 0.5 * x, 0.5 - 0.5 * y))
for i in range(RINGS):
    for j in range(SEGS):
        a = i * (SEGS + 1) + j; b = a + SEGS + 1
        eidx += [a, b, a + 1, a + 1, b, b + 1]

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ textures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
S = 1024
def raster_posmap(P):
    """Per-texel 3D position (and coverage) of the body, by rasterising the UV layout."""
    pm = np.zeros((S, S, 3)); cov = np.zeros((S, S))
    UVp = uvs * S; X = P[orig]
    for tri in tris:
        a, b, c_ = UVp[tri]
        x0, x1 = int(max(0, min(a[0], b[0], c_[0]))), int(min(S - 1, max(a[0], b[0], c_[0])) + 1)
        y0, y1 = int(max(0, min(a[1], b[1], c_[1]))), int(min(S - 1, max(a[1], b[1], c_[1])) + 1)
        if x1 <= x0 or y1 <= y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        den = (b[1] - c_[1]) * (a[0] - c_[0]) + (c_[0] - b[0]) * (a[1] - c_[1])
        if abs(den) < 1e-12: continue
        l1 = ((b[1] - c_[1]) * (gx - c_[0]) + (c_[0] - b[0]) * (gy - c_[1])) / den
        l2 = ((c_[1] - a[1]) * (gx - c_[0]) + (a[0] - c_[0]) * (gy - c_[1])) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not m.any(): continue
        p = l1[..., None] * X[tri[0]] + l2[..., None] * X[tri[1]] + l3[..., None] * X[tri[2]]
        sub = pm[y0:y1, x0:x1]; sub[m] = p[m]; cov[y0:y1, x0:x1][m] = 1
    return pm, cov
Pn = morph(macro(0.7, 0.4, 0.5, 0.7, R(1 / 3, 1 / 3, 1 / 3))) / 10.0
Pn[:, 1] -= Pn[body_set, 1].min()
pm, cov = raster_posmap(Pn)
def load_mask(n):
    return np.asarray(Image.open(os.path.join(MH, 'textures', 'mpfb_%s.jpg' % n)).convert('L').resize((S, S), Image.LANCZOS)) / 255.0
lips, lids, ears = load_mask('lips'), load_mask('eyelids'), load_mask('ears')
nails = np.maximum(load_mask('fingernails'), load_mask('toenails'))
eL = np.array(Pn[sorted(groups['helper-l-eye'])].mean(0)); eR = np.array(Pn[sorted(groups['helper-r-eye'])].mean(0))
X, Y, Z = pm[..., 0], pm[..., 1], pm[..., 2]
def sstep(a, b, x): t_ = np.clip((x - a) / (b - a), 0, 1); return t_ * t_ * (3 - 2 * t_)
brow = np.zeros((S, S))
for e, sg in ((eL, 1), (eR, -1)):
    a = (X - e[0]) * sg                                        # outward from the nose
    b = Y - e[1]
    b0 = 0.016 + 0.004 * np.exp(-((a - 0.006) / 0.012) ** 2) - 0.10 * np.clip(a - 0.016, 0, None)
    half = 0.0042 - 0.06 * np.clip(a, 0, None) * 0.03 / 0.02
    half = np.clip(0.0066 - 0.12 * np.clip(a - 0.004, 0, None), 0.0026, None)      # bold, painted: thick inside, tapering out
    # a thickness field, not a mask: 1 on the centre line, 0.5 at a medium brow's edge, 0 at twice that — the shader
    # cuts it at each player's own level (thin groomed brows … heavy brows)
    inside = np.clip(1 - np.abs(b - b0) / (2 * half), 0, 1) * sstep(-0.017, -0.013, a) * sstep(0.032, 0.027, a)
    inside *= sstep(e[2] - 0.006, e[2] + 0.002, Z) * cov
    brow = np.maximum(brow, inside)
hairn = np.ones((S, S))                                        # stylized: solid fills, no hair noise
brow = np.clip(brow, 0, 1)
nose_tip = Pn[body_set][np.argmax(np.where(Pn[body_set, 1] > eL[1] - 0.08, Pn[body_set, 2], -9))]
def blob(c, r): return np.exp(-np.sum((pm - c) ** 2, axis=2) / (r * r)) * cov
red = 0.0
for e, sg in ((eL, 1), (eR, -1)):
    red = red + blob(e + np.array([0.012 * sg, -0.032, -0.004]), 0.022)
red = np.clip(red + 0.8 * blob(nose_tip, 0.014), 0, 1)
stub = np.clip((eL[1] - 0.045 - Y) / 0.02, 0, 1) * np.clip((Y - (eL[1] - 0.16)) / 0.02, 0, 1) * sstep(-0.06, -0.03, Z - eL[2]) * cov
def noise(scale, amp):
    n = rng.random((S // scale + 2, S // scale + 2))
    return (np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)) / 255.0 - 0.5) * amp
mott = np.zeros((S, S))                                        # stylized: flat painted skin, no mottling
liner = np.clip((lids - 0.15) / 0.5, 0, 1) * sstep(eL[1] - 0.004, eL[1] + 0.004, Y)   # upper lids: a soft dark liner
def skin_tex(base, lip, nail, redc, dark):
    col = np.ones((S, S, 3)) * np.array(base)
    col = col * (1 - 0.1 * red[..., None]) + np.array(redc) * 0.1 * red[..., None]
    col = col * (1 - 0.08 * ears[..., None]) + np.array(redc) * 0.08 * ears[..., None]
    col *= (1 - 0.08 * lids)[..., None]
    col *= (1 - 0.55 * liner)[..., None]
    col = col * (1 - lips[..., None]) + np.array(lip) * lips[..., None]
    col = col * (1 - nails[..., None]) + np.array(nail) * nails[..., None]
    im = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8))
    # bleed over the UV gaps so mip levels do not pull in black
    bg = im.filter(ImageFilter.GaussianBlur(6)); m = Image.fromarray((cov * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
    return Image.composite(im, Image.composite(bg, Image.new('RGB', (S, S), tuple(int(v * 255) for v in base)), m), m)
skin_light = skin_tex([0.86, 0.67, 0.55], [0.74, 0.52, 0.47], [0.93, 0.78, 0.72], [0.86, 0.48, 0.44], False)
skin_dark = skin_tex([0.42, 0.29, 0.22], [0.33, 0.19, 0.17], [0.62, 0.48, 0.42], [0.45, 0.24, 0.2], True)
scalp_m = sstep(-0.012, 0.012, hair_d(X, Y, Z)) * cov * (1 - sstep(0.2, 0.5, ears))
beard_m = sstep(-0.006, 0.010, beard_d(X, Y, Z)) * cov * (1 - sstep(0.1, 0.4, lips))
masks = np.stack([np.zeros_like(brow) if SYSD else np.clip(brow, 0, 1), scalp_m * (0.7 + 0.3 * hairn), beard_m * (0.6 + 0.4 * hairn)], 2)
brow_im = Image.fromarray((masks * 255).astype(np.uint8), 'RGB').resize((512, 512), Image.LANCZOS)
# hair strands: a tiling texture of fine streaks along v (the shells' UVs run with the hair)
T = 256
st_ = rng.random((T, T // 8))
st_ = np.asarray(Image.fromarray((st_ * 255).astype(np.uint8)).resize((T, T), Image.BICUBIC)).astype(float) / 255.0
st_ = st_.T                                                   # streaks along v
fine = rng.random((T, T)); fine = np.asarray(Image.fromarray((fine * 255).astype(np.uint8)).resize((T // 2, T * 2)).resize((T, T), Image.BILINEAR)).T / 255.0
strand = np.clip(0.55 + 0.45 * (0.6 * st_ + 0.4 * fine - 0.5) * 2, 0, 1)
Tf = 256; fz = np.zeros((Tf, Tf))
for _ in range(2600):                                   # short, slightly curved hairs
    x0, y0 = rng.random() * Tf, rng.random() * Tf; ln_ = 6 + rng.random() * 10; ang_ = math.pi / 2 + (rng.random() - 0.5) * 0.7; w_ = 0.5 + rng.random() * 0.5
    for s_ in np.linspace(0, 1, 24):
        xx = int(x0 + math.cos(ang_ + s_ * 0.4) * ln_ * s_) % Tf; yy = int(y0 + math.sin(ang_ + s_ * 0.4) * ln_ * s_) % Tf
        fz[yy, xx] = max(fz[yy, xx], w_ * (1 - 0.5 * s_))
fz = np.asarray(Image.fromarray((fz * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))).astype(float) / 255.0
fz = np.clip(fz * 2.2, 0, 1)
fur_im = Image.fromarray(np.stack([0.32 * (0.7 + 0.6 * fz) * 255] * 3 + [np.clip(fz * 1.4 + 0.05, 0, 1) * 255], 2).clip(0, 255).astype(np.uint8), 'RGBA')
strand_im = Image.fromarray((np.stack([strand] * 3 + [np.ones_like(strand)], 2) * 255).astype(np.uint8), 'RGBA')
# eye: sclera, limbal ring, brown iris with radial fibres, pupil; planar UV (centre = 0.5, 0.5)
E = 256; gy, gx = np.mgrid[0:E, 0:E] / E - 0.5
rr = np.hypot(gx, gy) / 0.5; ang = np.arctan2(gy, gx)
IR, PR = 0.6, 0.27                                             # stylized: a big, flat iris with a dark ring and a catchlight
iris = np.array([0.34, 0.21, 0.11])[None, None, :] * (0.75 + 0.45 * np.clip((gy + 0.3) / 0.6, 0, 1))[..., None]   # darker under the lid
scl = np.ones((E, E, 3)) * np.array([0.95, 0.94, 0.92])
col = np.where((rr < IR)[..., None], iris, scl)
col = np.where((np.abs(rr - IR) < 0.05)[..., None], np.array([0.1, 0.07, 0.05]), col)
col = np.where((rr < PR)[..., None], np.array([0.03, 0.03, 0.035]), col)
col = np.where((np.hypot(gx + 0.1, gy + 0.1) < 0.05)[..., None], np.array([1.0, 1.0, 1.0]), col)
eye_im = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))

def durl(im, fmt, q=88):
    buf = io.BytesIO()
    if fmt == 'JPEG': im.convert('RGB').save(buf, 'JPEG', quality=q)
    else: im.save(buf, 'PNG', optimize=True)
    return 'data:image/%s;base64,' % ('jpeg' if fmt == 'JPEG' else 'png') + base64.b64encode(buf.getvalue()).decode('ascii')
imgs = {'skin_light': durl(skin_light, 'JPEG'), 'skin_dark': durl(skin_dark, 'JPEG'), 'eye': durl(eye_im, 'JPEG'), 'brows': durl(brow_im, 'PNG'), 'strands': durl(strand_im, 'PNG'), 'fur': durl(fur_im, 'PNG')}
for k, s in proxy_topo.items():
    im = Image.open(s['tex']).convert('RGBA'); im.thumbnail((1024 if k.startswith('h_') else 512,) * 2, Image.LANCZOS)
    a = np.asarray(im).astype(float); al = a[..., 3:4] / 255.0
    if s['part'] == 2:                                   # replace the colour under transparent texels by the mean hair colour (no magenta fringes)
        mean = (a[..., :3] * al).sum((0, 1)) / max(al.sum(), 1); a[..., :3] = a[..., :3] * al + mean * (1 - al)
    im = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    buf = io.BytesIO()
    if s['part'] == 2: im.save(buf, 'WEBP', quality=88, method=6); imgs['px_' + k] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    else: imgs['px_' + k] = durl(im.convert('RGB').resize((512, 512), Image.LANCZOS), 'JPEG', 90)
SKINS = {'light': 'young_caucasian_male/young_lightskinned_male_diffuse.png', 'light2': 'young_caucasian_male2/young_lightskinned_male_diffuse2.png',
         'dark': 'young_african_male/young_darkskinned_male_diffuse.png', 'asian': 'young_asian_male/young_lightskinned_male_diffuse3.png'}
skinRef = {}
if SYSD:
    for k, fn in SKINS.items():
        im = Image.open(os.path.join(SYSD, 'skins', fn)).convert('RGB').resize((1024, 1024), Image.LANCZOS)
        a = np.asarray(im).astype(float) / 255.0
        fm = load_mask('face') > 0.5; skinRef[k] = [round(float(x), 4) for x in a[fm].mean(0)]
        imgs['skin_' + k] = durl(im, 'JPEG', 90)
for k, fn in ():
    im = Image.open(os.path.join(UBC, fn)).convert('RGBA'); im.thumbnail((512, 512), Image.LANCZOS); imgs[k] = durl(im, 'PNG')

res = {
    'version': 2,
    'mh': {'names': out_names, 'parent': parent, 'uv': b64(np.round(uvs * 65535), '<u2'),
           'joints': b64(JNT[orig], 'u1'), 'weights': b64(np.round(WGT[orig] * 255), 'u1'),
           'idx': b64(tris.ravel(), '<u2'), 'orig': b64(remap[orig], '<u2'),
           'shells': {k: {'idx': b64(s['idx'], '<u2'), 'uv': b64(s['uv'], '<f4'),
                          'prof': b64(np.round(s['prof'] * 255), 'u1'), 'joints': b64(s['J'], 'u1'), 'weights': b64(np.round(s['W'] * 255), 'u1')} for k, s in shell_topo.items()},
           'proxies': {k: {'idx': b64(s['idx'], '<u2'), 'uv': b64(s['uv'], '<f4'), 'joints': b64(s['J'], 'u1'), 'weights': b64(np.round(s['W'] * 255), 'u1'),
                           'part': s['part'], 'tex': 'px_' + k} for k, s in proxy_topo.items()},
           'eye': {'pos': b64(np.array(ep), '<f4'), 'uv': b64(np.array(euv), '<f4'), 'idx': b64(np.array(eidx), '<u2')}},
    'shapes': shapes, 'gltf': {}, 'bin': {}, 'hairTex': {}, 'img': imgs, 'skinRef': skinRef,
}
for k, (g, binb, jn, prims) in []:
    g = json.loads(json.dumps(g))
    uris = [i.get('uri', '') for i in g.get('images', [])]
    res['hairTex'][k] = 'hair2' if any('Hair_2' in u for u in uris) else 'hair1'
    for b in g.get('buffers', []): b.pop('uri', None)
    for i in g.get('images', []): i.pop('uri', None)
    res['gltf'][k] = g; res['bin'][k] = base64.b64encode(binb).decode('ascii')
header = ('/* Player models (generated by a build script; do not edit by hand).\n'
          ' * Bodies and faces: MakeHuman base mesh hm08, shape targets and game-engine rig + weights, CC0 1.0\n'
          ' *   (makehumancommunity.org; data from github.com/makehumancommunity/mpfb2). Each player is a blend of\n'
          ' *   MakeHuman targets chosen to approximate his build and face; these are not scans or likenesses.\n'
          ' * Stylized look: heads scaled up 7 %, hair and beards sculpted as solid shells grown from each head,\n'
          ' *   skin, eye and eyebrow textures painted flat in the MakeHuman UV layout (MPFB CC0 region masks). */\n')
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(header + 'window.FK_PLAYER_ASSETS = ' + json.dumps(res, separators=(',', ':')) + ';\n')
print('wrote', OUT, round(os.path.getsize(OUT) / 1e6, 2), 'MB')
if PREV:
    skin_light.save(os.path.join(PREV, 'mh_skin_light.png')); eye_im.save(os.path.join(PREV, 'mh_eye.png')); brow_im.save(os.path.join(PREV, 'mh_brows.png'))
