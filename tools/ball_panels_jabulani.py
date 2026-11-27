"""Jabulani panel map (usage: python tools/ball_panels_jabulani.py assets/balls/jabulani.js).

The Jabulani's 8 thermally bonded panels, as adidas's own cutaway shows them: 4 "3-D triangle" panels, each carrying
one of the coloured triangle graphics (the band and the white middle it surrounds), and 4 white "3-D tripod" panels
whose arms wrap between them. The tripods' seams are printed in the model's colour map as thin grey lines on the white
skin; they are found with a black top-hat (thin dark lines on a bright ground) and the white skin is cut along them.
Writes "panelMap" (ids 0-3 triangle panels, 4-7 tripods; any other piece joins its neighbour).
"""
import sys, json, io, base64, numpy as np
from PIL import Image, ImageDraw, ImageFilter
path = sys.argv[1]
s = open(path, encoding='utf8').read(); head, body = s.split('] = ', 1); d = json.loads(body.rstrip().rstrip(';'))
im = Image.open(io.BytesIO(base64.b64decode((d.get('sphereTexture') or d['texture']).split(',', 1)[1]))).convert('L')
im = im.resize((1024, 512), Image.LANCZOS)
W, H = im.size
g = np.asarray(im, np.float32) / 255
close = np.asarray(im.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)), np.float32) / 255
white = close > 0.78
seam = ((close - g) > 0.05) & white
uu = (np.arange(W) + .5) / W; vv = (np.arange(H) + .5) / H
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
D = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1); AREA = np.sin(COL)

def label(mask):
    """4-connected regions, wrapping in longitude (flood fills on three copies side by side)."""
    lab = np.full((H, W), -1, np.int32); n = 0; todo = mask.copy()
    while todo.any():
        ys, xs = np.nonzero(todo); y, x = int(ys[0]), int(xs[0])
        t = Image.fromarray(np.tile(todo, (1, 3)).astype(np.uint8) * 255).copy()
        ImageDraw.floodfill(t, (x + W, y), 128)
        a = np.asarray(t) == 128
        f = (a[:, :W] | a[:, W:2 * W] | a[:, 2 * W:]) & todo; f[y, x] = True
        lab[f] = n; todo &= ~f; n += 1
    return lab, n
def size(m): return float(AREA[m].sum() / AREA.sum())
def grow(m, r):
    for _ in range(r):
        m = m | np.roll(m, 1, 1) | np.roll(m, -1, 1) | np.vstack([m[:1], m[:-1]]) | np.vstack([m[1:], m[-1:]])
    return m

# 1. the four coloured graphics: the big non-white regions (logos and text are small and stay on their panel)
glab, gn = label(~white)
graphics = sorted([j for j in range(gn) if size(glab == j) > 0.02], key=lambda j: -size(glab == j))[:4]
print('graphics', [round(size(glab == j) * 100, 1) for j in graphics])
# 2. each graphic with the white middle it surrounds: the white regions not reaching the rest of the skin
wlab, wn = label(white & ~seam)
tri = np.full((H, W), -1, np.int32)
for k, j in enumerate(graphics):
    band = glab == j
    tri[band] = k
    ring = grow(band, 2)
    for w in range(wn):
        m = wlab == w
        if size(m) > 0.12: continue                           # (the open skin, not a hole)
        border = grow(m, 2) & ~m
        if border.any() and (ring[border].mean() > 0.9): tri[m & (tri < 0)] = k
    tri[grow(tri == k, 2) & (tri < 0) & ~seam & (close < 0.95)] = k   # (the band's thin outline)
# 3. the tripods: the white skin left over, cut along the printed seams
rest = (tri < 0) & ~seam
rlab, rn = label(rest)
parts = sorted([j for j in range(rn) if size(rlab == j) > 0.01], key=lambda j: -size(rlab == j))
print('skin pieces', [round(size(rlab == j) * 100, 1) for j in parts])
ids = tri.copy()
for k, j in enumerate(parts[:4]): ids[rlab == j] = 4 + k
# everything else (seam lines, specks, any fifth piece) joins its nearest labelled neighbour
for _ in range(200):
    miss = ids < 0
    if not miss.any(): break
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb = np.roll(np.roll(ids, dy, 0), dx, 1); take = (ids < 0) & (nb >= 0); ids[take] = nb[take]
print('areas %:', [round(size(ids == k) * 100, 1) for k in range(8)])
buf = io.BytesIO(); Image.fromarray(ids.astype(np.uint8), 'L').save(buf, 'PNG', optimize=True)
d['panelMap'] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
open(path, 'w', encoding='utf8').write(head + '] = ' + json.dumps(d) + ';\n')
print('panels', len(np.unique(ids)))
