"""Cut panel grooves into a sphere-mapped ball that has no normal map, along the outlines of its white panels.

Some ball models are a plain UV sphere carrying the artwork (the Champions League ball: white star panels on a
coloured ground), so there is no relief to bake. This finds the white panels in the baked sphere map (logos and
print inside a panel count as panel), draws a groove along every panel edge and writes the matching object-space
normal map ("sphereNormal"), the same kind tools/ball_bake.py makes from a real normal map.
usage: python tools/ball_relief.py assets/balls/<id>.js [--white 0.78] [--width 2.2] [--depth 0.006]
       [--clear u0,v0,u1,v1 ...]   (paint print inside panels in that box of the map white: u, v in 0..1)
Convention (as in ball_bake.py and render.js): u = longitude / 2pi, v = colatitude / pi.
"""
import sys, json, io, base64
import numpy as np
from PIL import Image

argv = sys.argv[1:]; path = argv[0]; opt = {'white': 0.78, 'width': 2.2, 'depth': 0.006}; clears = []
i = 1
while i < len(argv):
    k = argv[i][2:]
    if k == 'clear': clears.append([float(x) for x in argv[i + 1].split(',')])
    else: opt[k] = float(argv[i + 1])
    i += 2
src = open(path, encoding='utf8').read()
head, body = src.split('] = ', 1)
data = json.loads(body.rstrip().rstrip(';'))
key = 'sphereTexture' if data.get('sphereTexture') else 'texture'
img = np.asarray(Image.open(io.BytesIO(base64.b64decode(data[key].split(',', 1)[1]))).convert('RGB'), np.float32) / 255.0
H, W = img.shape[:2]

def shift(m, dy, dx):   # wraps in longitude, clamps at the poles
    s = np.roll(m, dx, 1)
    if dy > 0: s = np.vstack([np.repeat(s[:1], dy, 0), s[:H - dy]])
    elif dy < 0: s = np.vstack([s[-dy:], np.repeat(s[-1:], -dy, 0)])
    return s

def nb(m, op):          # combine over the 3x3 neighbourhood
    out = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx: out = op(out, shift(m, dy, dx))
    return out

white = img.min(-1) > opt['white']
# the coloured ground is one connected region reaching the poles; coloured specks it doesn't reach are print
# inside a panel (logos, a barcode) and belong to the panel
col = ~white
from PIL import ImageDraw

def component(mask, y, x):
    # the connected region of mask holding (y, x), wrapping in longitude (flood-filled on three copies side by side)
    t = Image.fromarray(np.tile(mask, (1, 3)).astype(np.uint8) * 255).copy()   # (a copy: the array view is read-only)
    ImageDraw.floodfill(t, (x + W, y), 128)
    f = np.asarray(t) == 128
    return f[:, :W] | f[:, W:2 * W] | f[:, 2 * W:]

depth = col.copy(); deep = np.zeros((H, W), np.int32)
for k in range(12):                      # how far each coloured pixel is inside the colour (erosion steps)
    depth = nb(depth, np.logical_and); deep += depth
reach = np.zeros((H, W), bool); small = np.zeros((H, W), bool)
while True:
    cand = np.where(col & ~reach & ~small, deep, -1)
    y, x = np.unravel_index(np.argmax(cand), cand.shape)
    if cand[y, x] < 5: break
    c = component(col, int(y), int(x)); c[y, x] = True
    if c.mean() > 0.015: reach |= c      # the ground: big regions
    else: small |= c                     # print inside a panel
print('ground', round(float(reach.mean()) * 100, 1), '% of the ball')
hole = col & ~reach
uu = (np.arange(W) + 0.5) / W; vv = (np.arange(H) + 0.5) / H
for u0, v0, u1, v1 in clears:
    box = ((uu >= u0) & (uu <= u1))[None, :] & ((vv >= v0) & (vv <= v1))[:, None]
    img[box & (hole | white)] = 1.0                              # (white too: the print's anti-aliased fringe)
    print('cleared', int((box & hole).sum()), 'px of print')
panel = white | hole
# drop specks: open the panel mask (erode, dilate) twice
for _ in range(2): panel = nb(panel, np.logical_and)
for _ in range(2): panel = nb(panel, np.logical_or)
edge = panel & ~nb(panel, np.logical_and)      # the panel's rim
# distance from the rim in pixels (chamfer, a few steps either side)
dist = np.where(edge, 0.0, 99.0)
R = int(opt['width'] * 3) + 2
for k in range(1, R + 1):
    grown = nb(dist < k, np.logical_or)
    dist = np.where(grown & (dist > k), float(k), dist)
prof = np.exp(-(dist / opt['width']) ** 2)                      # 1 in the groove, 0 away from it
# a little smoothing so the groove walls are round
for _ in range(2):
    prof = (prof + np.roll(prof, 1, 1) + np.roll(prof, -1, 1) + np.vstack([prof[:1], prof[:-1]]) + np.vstack([prof[1:], prof[-1:]])) / 5
h = -opt['depth'] * prof                                         # height, in ball radii
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
DIR = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1)
eLon = np.stack([-np.sin(LON), np.zeros_like(LON), np.cos(LON)], -1)
eCol = np.stack([np.cos(COL) * np.cos(LON), -np.sin(COL), np.cos(COL) * np.sin(LON)], -1)
dLon = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * 2 * np.pi / W)
dCol = (np.vstack([h[1:], h[-1:]]) - np.vstack([h[:1], h[:-1]])) / (2 * np.pi / H)
N = DIR - (dLon / np.maximum(np.sin(COL), 0.05))[..., None] * eLon - dCol[..., None] * eCol
N /= np.linalg.norm(N, axis=-1, keepdims=True)
img *= (1 - 0.6 * prof)[..., None]                               # the groove is in shade
print('groove pixels', int((prof > 0.5).sum()), 'panels', round(float(panel.mean()) * 100, 1), '% of the ball')
buf = io.BytesIO(); Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(buf, 'JPEG', quality=88)
data[key] = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
nbuf = io.BytesIO(); Image.fromarray((np.clip(N * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)).save(nbuf, 'JPEG', quality=92)
data['sphereNormal'] = 'data:image/jpeg;base64,' + base64.b64encode(nbuf.getvalue()).decode()
open(path, 'w', encoding='utf8').write(head + '] = ' + json.dumps(data) + ';\n')
print(path, 'relief written')
