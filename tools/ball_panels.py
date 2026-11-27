"""Find a ball's panels and store a panel map for the exploded view (the ball showcase's "Anatomy").

Two ways to find them:
  --model <converted mesh .js>  (best) every panel of a real ball model is its own island in the texture layout: the
        model's triangles are drawn into texture space, the islands labelled, and each direction on the sphere takes
        the island of the triangle its ray meets (as tools/ball_bake.py does for colour). Uses the model's seam UV set
        if it kept one (ball_model.js --seam-uv), else its UVs.
  (default) the grooves in the baked sphere normal map: where the surface normal tilts away from the radius. The
        regions between them are panels; small regions (rings, print, grooves inside a panel) join the panel around them.
The result goes into the asset as "panelMap": a greyscale PNG in the sphere-map layout (u = longitude / 2pi,
v = colatitude / pi, 1024 x 512), value = panel index 0, 1, ..., 255 = a part that stays put when the ball comes
apart (the printed ground of a starball, between its star panels).
usage: python tools/ball_panels.py assets/balls/<id>.js [--model mesh.js] [--min 0.004]
       [--seam 0.06] [--grow 1] [--ground]
  --ground  the largest region is the ground the panels sit on (255), not a panel
"""
import sys, json, io, base64
import numpy as np
from PIL import Image, ImageDraw

argv = sys.argv[1:]; path = argv[0]; opt = {'seam': 0.06, 'min': 0.004, 'grow': 1, 'model': None}; flags = set()
i = 1
while i < len(argv):
    k = argv[i][2:]
    if k == 'ground': flags.add(k); i += 1; continue
    opt[k] = argv[i + 1] if k == 'model' else float(argv[i + 1]); i += 2

def load(p):
    s = open(p, encoding='utf8').read(); h, b = s.split('] = ', 1)
    return h, json.loads(b.rstrip().rstrip(';'))
head, data = load(path)
W, H = 1024, 512
uu = (np.arange(W) + 0.5) / W; vv = (np.arange(H) + 0.5) / H
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
DIR = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1)
AREA = np.sin(COL)                                  # pixel area on the sphere

def grow_into(out):
    """Give every unlabelled pixel (-1) the label of its nearest labelled neighbour, a ring at a time."""
    for _ in range(600):
        if not (out < 0).any(): break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nb = np.roll(np.roll(out, dy, 0), dx, 1)
            take = (out < 0) & (nb >= 0); out[take] = nb[take]
    return out

def label(mask, wrap):
    """4-connected regions of a boolean mask (wrapping in x if asked), by repeated flood fills."""
    h, w = mask.shape; lab = np.full((h, w), -1, np.int32); n = 0; todo = mask.copy()
    reps = 3 if wrap else 1
    while todo.any():
        ys, xs = np.nonzero(todo); y, x = int(ys[0]), int(xs[0])
        t = Image.fromarray(np.tile(todo, (1, reps)).astype(np.uint8) * 255).copy()
        ImageDraw.floodfill(t, (x + (w if wrap else 0), y), 128)
        a = np.asarray(t) == 128
        f = a[:, :w].copy()
        for r in range(1, reps): f |= a[:, r * w:(r + 1) * w]
        f &= todo; f[y, x] = True
        lab[f] = n; todo &= ~f; n += 1
    return lab, n

def keep_big(lab, n, area):
    sizes = np.array([area[lab == j].sum() for j in range(n)]) / area.sum()
    big = [j for j in range(n) if sizes[j] >= opt['min']]
    out = np.full(lab.shape, -1, np.int32)
    for j, b in enumerate(big): out[lab == b] = j
    print('regions', n, 'panels', len(big), 'sizes', sorted([round(float(s), 4) for s in sizes[big]], reverse=True))
    return out, len(big)

if opt['model']:
    _, m = load(opt['model'])
    P = np.array(m['positions'], np.float32).reshape(-1, 3); I = np.array(m['indices'], np.int64).reshape(-1, 3)
    T = np.array(m.get('seamUvs') or m['uvs'], np.float32).reshape(-1, 2)
    # islands in texture space
    TS = 2048
    cov = Image.new('L', (TS, TS), 0); dr = ImageDraw.Draw(cov)
    for tri in I:
        uv = T[tri] % 1.0 if (T[tri].max() - T[tri].min()) < 0.9 else T[tri]
        dr.polygon([(float(u * TS), float(v * TS)) for u, v in uv], fill=255)
    tl, tn = label(np.asarray(cov) > 0, False)
    # each triangle's island: the label under its centroid
    cen = (T[I].mean(1) % 1.0) * TS
    tri_isl = tl[np.clip(cen[:, 1].astype(int), 0, TS - 1), np.clip(cen[:, 0].astype(int), 0, TS - 1)]
    print('texture islands', tn)
    D = P / np.linalg.norm(P, axis=1, keepdims=True)
    ids = np.full((H, W), -1, np.int32)
    for ti, tri in enumerate(I):
        a, b, c = D[tri]; M = np.stack([a, b, c], 1)
        if abs(np.linalg.det(M)) < 1e-12 or tri_isl[ti] < 0: continue
        Minv = np.linalg.inv(M)
        lon = np.arctan2(np.array([a[2], b[2], c[2]]), np.array([a[0], b[0], c[0]])) % (2 * np.pi)
        col = np.arccos(np.clip(np.array([a[1], b[1], c[1]]), -1, 1))
        if lon.max() - lon.min() > np.pi: lon = np.where(lon < np.pi, lon + 2 * np.pi, lon)
        y0, y1 = max(0, int(col.min() / np.pi * H) - 1), min(H, int(col.max() / np.pi * H) + 2)
        if col.min() < 0.06 or col.max() > np.pi - 0.06 or lon.max() - lon.min() > np.pi * 0.9:
            xs = np.arange(W); y0 = 0 if col.min() < 0.5 else y0; y1 = H if col.max() > np.pi - 0.5 else y1
        else:
            xs = np.arange(int(lon.min() / (2 * np.pi) * W) - 1, int(lon.max() / (2 * np.pi) * W) + 2) % W
        ys = np.arange(y0, y1)
        if not len(ys) or not len(xs): continue
        yy, xx = np.meshgrid(ys, xs, indexing='ij')
        wts = DIR[yy, xx] @ Minv.T
        inside = (wts >= -1e-4).all(-1) & (wts.sum(-1) > 1e-6)
        ids[yy[inside], xx[inside]] = tri_isl[ti]
    ids = grow_into(ids)
    # islands → panels: small islands (a logo cut out on its own) join their neighbour
    lab, n = label(ids >= 0, True)       # (all one region; relabel by island instead)
    uniq = np.unique(ids); remap = {int(u): j for j, u in enumerate(uniq)}
    ids = np.vectorize(remap.get)(ids).astype(np.int32)
    sizes = np.array([AREA[ids == j].sum() for j in range(len(uniq))]) / AREA.sum()
    small = sizes < opt['min']
    if small.any():
        for j in np.nonzero(small)[0]: ids[ids == j] = -1
        ids = grow_into(ids)
        uniq = np.unique(ids); remap = {int(u): j for j, u in enumerate(uniq)}; ids = np.vectorize(remap.get)(ids).astype(np.int32)
    sizes = np.array([AREA[ids == j].sum() for j in range(ids.max() + 1)]) / AREA.sum()
    print('panels', ids.max() + 1, 'sizes', sorted([round(float(s), 4) for s in sizes], reverse=True))
else:
    nm = Image.open(io.BytesIO(base64.b64decode(data['sphereNormal'].split(',', 1)[1]))).convert('RGB')
    w0 = nm.size[0]; h0 = w0 // 2
    N = np.asarray(nm, np.float32) / 255 * 2 - 1
    N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-6)
    u0 = (np.arange(w0) + 0.5) / w0; v0 = (np.arange(h0) + 0.5) / h0
    L0, C0 = np.meshgrid(u0 * 2 * np.pi, v0 * np.pi)
    D0 = np.stack([np.sin(C0) * np.cos(L0), np.cos(C0), np.sin(C0) * np.sin(L0)], -1)
    seam = (1 - (N * D0).sum(-1)) > opt['seam']
    nbr = np.zeros_like(seam)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)): nbr |= np.roll(np.roll(seam, dy, 0), dx, 1)
    seam &= nbr
    for _ in range(int(opt['grow'])):
        g = seam.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)): g |= np.roll(np.roll(seam, dy, 0), dx, 1)
        seam = g
    lab, n = label(~seam, True)
    ids, n = keep_big(lab, n, np.sin(C0))
    ids = grow_into(ids)
    if w0 != W: ids = np.asarray(Image.fromarray(ids.astype(np.uint8)).resize((W, H), Image.NEAREST)).astype(np.int32)
if 'ground' in flags:
    gs = [AREA[ids == j].sum() for j in range(ids.max() + 1)]
    g = int(np.argmax(gs)); out = np.where(ids == g, 255, ids - (ids > g)).astype(np.int32)
    print('ground: covers', round(float(gs[g] / AREA.sum()) * 100, 1), '% ->', int(out[out < 255].max()) + 1, 'panels on it')
    ids = out
buf = io.BytesIO(); Image.fromarray(ids.astype(np.uint8), 'L').save(buf, 'PNG', optimize=True)
data['panelMap'] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
open(path, 'w', encoding='utf8').write(head + '] = ' + json.dumps(data) + ';\n')
print(path, 'panel map', W, 'x', H, round(len(data['panelMap']) / 1e3, 1), 'kB')
