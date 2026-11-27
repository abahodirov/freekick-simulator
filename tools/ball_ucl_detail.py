"""The Champions League ball in the style of the 2024-25 match ball: white panels and dark charcoal stars, each star
ONE panel, with grooves and print as on the real ball.
usage: python tools/ball_ucl_detail.py assets/balls/ucl.js
  (after tools/ball_panels.py ... --ground and tools/ball_panels_ucl_ground.py: reads "panelMap", where ids from
   "panelInner" on are the printed ground between the white stars)

1. Panels: the dark ground is one net of stars joined at their tips; it is eroded until the joins break, each core is
   labelled, and the cores grow back over the ground, so every dark star is one panel (ids from panelInner on).
2. Colour: the dark stars are charcoal with a faint mottle, shaded along their grooves, traced with a green line just
   inside the edge and a fainter inner star outline; the white panels keep their print (logos) and get a pale
   embossed outline inside the edge and three short red marks in a Y round their centre.
3. Relief ("sphereNormal"): a groove along every panel edge, a gentle dome on every panel, shallow grooves along the
   inner outlines, and a fine pebbled micro-texture on the white skin, turned into normals as in ball_relief.py.
"""
import sys, json, io, base64, numpy as np
from PIL import Image, ImageDraw
path = sys.argv[1]
s = open(path, encoding='utf8').read(); head, body = s.split('] = ', 1); d = json.loads(body.rstrip().rstrip(';'))
inner = d.get('panelInner', 20)

def shift(m, dy, dx):
    m = np.roll(m, dx, 1)
    if dy > 0: m = np.vstack([np.repeat(m[:1], dy, 0), m[:-dy]])
    elif dy < 0: m = np.vstack([m[-dy:], np.repeat(m[-1:], -dy, 0)])
    return m
def grow(m):
    return m | shift(m, 1, 0) | shift(m, -1, 0) | shift(m, 0, 1) | shift(m, 0, -1)
def label(mask):
    H, W = mask.shape; lab = np.full((H, W), -1, np.int32); n = 0; todo = mask.copy()
    while todo.any():
        ys, xs = np.nonzero(todo); y, x = int(ys[0]), int(xs[0])
        t = Image.fromarray(np.tile(todo, (1, 3)).astype(np.uint8) * 255).copy()
        ImageDraw.floodfill(t, (x + W, y), 128)
        a = np.asarray(t) == 128
        f = (a[:, :W] | a[:, W:2 * W] | a[:, 2 * W:]) & todo; f[y, x] = True
        lab[f] = n; todo &= ~f; n += 1
    return lab, n

# ── 1. one panel per dark star (on the 1024 x 512 panel map) ──
ids = np.asarray(Image.open(io.BytesIO(base64.b64decode(d['panelMap'].split(',', 1)[1]))), np.int32).copy()
h0, w0 = ids.shape
A0 = np.sin((np.arange(h0) + .5) / h0 * np.pi)[:, None] * np.ones((1, w0))
ground = ids >= inner
best = None
for k in range(2, 16):
    core = ground.copy()
    for _ in range(k): core = core & ~grow(~core)
    lab, n = label(core)
    sizes = [float(A0[lab == j].sum() / A0.sum()) for j in range(n)]
    big = [j for j in range(n) if sizes[j] > 0.002]
    print('erode', k, 'cores', len(big))
    if best is None or len(big) > best[0]: best = (len(big), k, lab, big)
    if len(big) >= 12 and k > 3: break
_, k, lab, big = best
stars = np.full(ids.shape, -1, np.int32)
for j, b in enumerate(big): stars[lab == b] = j
for _ in range(60):                                  # grow the cores back over the ground (only over the ground)
    miss = (stars < 0) & ground
    if not miss.any(): break
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nb = shift(stars, dy, dx); take = (stars < 0) & ground & (nb >= 0); stars[take] = nb[take]
ids = np.where(ground, inner + np.maximum(stars, 0), ids)
print('white panels', inner, 'dark stars', len(big))
buf = io.BytesIO(); Image.fromarray(ids.astype(np.uint8), 'L').save(buf, 'PNG', optimize=True)
d['panelMap'] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

# ── 2. colour (on the 2048 x 1024 sphere map) ──
tex = Image.open(io.BytesIO(base64.b64decode(d['texture'].split(',', 1)[1]))).convert('RGB')
W, H = tex.size
img = np.asarray(tex, np.float32) / 255
idsF = np.asarray(Image.fromarray(ids.astype(np.uint8)).resize((W, H), Image.NEAREST), np.int32)
dark = idsF >= inner
uu = (np.arange(W) + .5) / W; vv = (np.arange(H) + .5) / H
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
D = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1)
# distance (pixels) from the white/dark edge, on each side
def dist_from(edge_side, other):
    dd = np.full((H, W), 99.0, np.float32); cur = other.copy()
    for k in range(1, 48):
        cur2 = grow(cur); dd[cur2 & ~cur & edge_side] = k; cur = cur2
    return dd
dW = dist_from(~dark, dark)                 # inside a white panel: how far from the dark stars
dD = dist_from(dark, ~dark)                 # inside a dark star: how far from the white panels
# also the edges between neighbouring dark stars (they touch at their tips) and between white panels
edgeIds = (idsF != shift(idsF, 1, 0)) | (idsF != shift(idsF, 0, 1))
dE = np.full((H, W), 99.0, np.float32); cur = edgeIds.copy(); dE[cur] = 0
for k in range(1, 12):
    cur2 = grow(cur); dE[cur2 & ~cur] = k; cur = cur2
de = np.minimum(np.minimum(dW, dD), dE)
rng = np.random.default_rng(5)
mott = np.asarray(Image.fromarray((rng.random((H // 6, W // 6)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255
charcoal = np.array([0.16, 0.175, 0.172], np.float32)
green = np.array([0.42, 0.82, 0.28], np.float32); red = np.array([0.90, 0.24, 0.16], np.float32)
g = lambda x, c, w: np.exp(-((x - c) / w) ** 2)
darkCol = charcoal * (0.9 + 0.2 * mott[..., None])
darkCol = darkCol * (1 - 0.5 * g(dD, 1.5, 1.8)[..., None])
lineA = (0.95 * g(dD, 8.0, 1.2))[..., None]; lineB = (0.55 * g(dD, 24.0, 1.0))[..., None]
darkCol = darkCol * (1 - lineA) + green * lineA
darkCol = darkCol * (1 - lineB) + green * 0.8 * lineB
# white panels: their print is kept (logos); a pale embossed outline inside the edge, red marks in a Y round the centre
plain = img.min(-1) > 0.82
whiteCol = img.copy()
emb = (0.22 * g(dW, 17.0, 1.2))[..., None] * plain[..., None]
whiteCol = whiteCol * (1 - emb) + np.array([0.55, 0.56, 0.58]) * emb
marks = np.zeros((H, W), np.float32)
for j in range(inner):
    m = idsF == j
    if not m.any() or (~plain[m]).mean() > 0.03: continue          # (no marks on the panels carrying logos)
    c = (D[m] * np.sin(COL)[m, None]).sum(0); c /= np.linalg.norm(c)
    e1 = np.cross(c, [0.13, 1, 0.31]); e1 /= np.linalg.norm(e1); e2 = np.cross(c, e1)
    x = D[..., 0] * e1[0] + D[..., 1] * e1[1] + D[..., 2] * e1[2]
    y = D[..., 0] * e2[0] + D[..., 1] * e2[1] + D[..., 2] * e2[2]
    r = np.hypot(x, y); ang = np.arctan2(y, x)
    for a0 in (np.pi / 2, np.pi / 2 + 2 * np.pi / 3, np.pi / 2 + 4 * np.pi / 3):
        along = x * np.cos(a0) + y * np.sin(a0); perp = np.abs(-x * np.sin(a0) + y * np.cos(a0))
        stroke = m & (along > 0.045) & (along < 0.095) & (perp < 0.0035)
        marks[stroke] = 1
marks = np.minimum(1, marks) * plain
whiteCol = whiteCol * (1 - 0.9 * marks[..., None]) + red * 0.9 * marks[..., None]
out = np.where(dark[..., None], darkCol, whiteCol)
out *= (1 - 0.35 * g(de, 0.0, 1.6))[..., None]                       # every groove in shade
buf = io.BytesIO(); Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(buf, 'JPEG', quality=90)
d['texture'] = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()

# ── 3. relief ──
hgt = -0.006 * g(de, 0.0, 2.4)                                         # the seams
hgt += 0.0035 * np.minimum(de, 40) / 40                                 # a gentle dome on every panel
hgt += -0.0016 * g(dW, 17.0, 1.3) * plain - 0.0014 * g(dD, 24.0, 1.2)   # the inner outlines
peb = np.sin(LON * 900) * np.sin(COL * 900) * 0.5 + np.sin(LON * 1300 + COL * 700) * 0.5
hgt += 0.00025 * peb * (~dark) * np.sin(COL) ** 2                       # the fine pebble on the white skin
eLon = np.stack([-np.sin(LON), np.zeros_like(LON), np.cos(LON)], -1)
eCol = np.stack([np.cos(COL) * np.cos(LON), -np.sin(COL), np.cos(COL) * np.sin(LON)], -1)
dLon = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) / (2 * 2 * np.pi / W)
dCol = (np.vstack([hgt[1:], hgt[-1:]]) - np.vstack([hgt[:1], hgt[:-1]])) / (2 * np.pi / H)
N = D - (dLon / np.maximum(np.sin(COL), 0.05))[..., None] * eLon - dCol[..., None] * eCol
N /= np.linalg.norm(N, axis=-1, keepdims=True)
nb = io.BytesIO(); Image.fromarray((np.clip(N * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)).save(nb, 'JPEG', quality=92)
d['sphereNormal'] = 'data:image/jpeg;base64,' + base64.b64encode(nb.getvalue()).decode()
open(path, 'w', encoding='utf8').write(head + '] = ' + json.dumps(d) + ';\n')
print('written', path)
