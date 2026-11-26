"""Bake a converted ball model's UV texture into an equirectangular sphere map for the game ball.

The game draws the match ball as a sphere and samples its texture by direction (render.js); a real model maps its
texture through its own UVs. For every triangle of the model, this rasterises it in longitude/latitude, finds each
pixel's barycentric coordinates by intersecting the pixel's ray with the triangle, interpolates the UVs and samples
the model's texture. The result is written into the asset as "sphereTexture".
usage: python tools/ball_bake.py assets/balls/<id>.js [width = 2048]
Convention (as in render.js and ball_textures.py): u = longitude / 2pi = atan2(z, x) / 2pi, v = colatitude / pi.
"""
import sys, json, io, base64
import numpy as np
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith('--')]; flags = {a for a in sys.argv[1:] if a.startswith('--')}
# --seams       draw the panel seams (where the model's UV islands meet) as thin grooves
# --sphere-only replace the mesh by a perfect sphere carrying the baked map (for models whose panels bulge)
path = args[0]; W = int(args[1]) if len(args) > 1 else 2048; H = W // 2
src = open(path, encoding='utf8').read()
head, body = src.split('] = ', 1)
data = json.loads(body.rstrip().rstrip(';'))
tex = np.asarray(Image.open(io.BytesIO(base64.b64decode(data['texture'].split(',', 1)[1]))).convert('RGB'), np.float32) / 255.0
th, tw = tex.shape[:2]
P = np.array(data['positions'], np.float32).reshape(-1, 3)
T = np.array(data['uvs'], np.float32).reshape(-1, 2)
I = np.array(data['indices'], np.int64).reshape(-1, 3)
# seams come from the UV set whose islands are the real panel cuts, when the converter kept one (--seam-uv)
S = np.array(data['seamUvs'], np.float32).reshape(-1, 2) if data.get('seamUvs') else T
D = P / np.linalg.norm(P, axis=1, keepdims=True)

uu = (np.arange(W) + 0.5) / W; vv = (np.arange(H) + 0.5) / H
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
DIR = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1)
out = np.zeros((H, W, 3), np.float32); cov = np.zeros((H, W), bool); UVM = np.full((H, W, 2), -9.0, np.float32)

def sample(uv):
    x = np.clip((uv[:, 0] % 1.0) * tw, 0, tw - 1.001); y = np.clip((uv[:, 1] % 1.0) * th, 0, th - 1.001)
    x0, y0 = x.astype(int), y.astype(int); fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    return (tex[y0, x0] * (1 - fx) * (1 - fy) + tex[y0, x0 + 1] * fx * (1 - fy) + tex[y0 + 1, x0] * (1 - fx) * fy + tex[y0 + 1, x0 + 1] * fx * fy)

for tri in I:
    a, b, c = D[tri]
    M = np.stack([a, b, c], 1)
    if abs(np.linalg.det(M)) < 1e-12: continue
    Minv = np.linalg.inv(M)
    lon = np.arctan2(np.array([a[2], b[2], c[2]]), np.array([a[0], b[0], c[0]])) % (2 * np.pi)
    col = np.arccos(np.clip(np.array([a[1], b[1], c[1]]), -1, 1))
    if lon.max() - lon.min() > np.pi: lon = np.where(lon < np.pi, lon + 2 * np.pi, lon)
    y0, y1 = max(0, int(col.min() / np.pi * H) - 1), min(H, int(col.max() / np.pi * H) + 2)
    polar = col.min() < 0.06 or col.max() > np.pi - 0.06 or lon.max() - lon.min() > np.pi * 0.9
    if polar:                                        # a triangle at a pole spans every longitude
        xs = np.arange(W); y0 = 0 if col.min() < 0.5 else y0; y1 = H if col.max() > np.pi - 0.5 else y1
    else:
        xs = np.arange(int(lon.min() / (2 * np.pi) * W) - 1, int(lon.max() / (2 * np.pi) * W) + 2) % W
    ys = np.arange(y0, y1)
    if len(ys) == 0 or len(xs) == 0: continue
    yy, xx = np.meshgrid(ys, xs, indexing='ij')
    p = DIR[yy, xx]                                  # (h, w, 3)
    wts = p @ Minv.T                                 # barycentric numerators along each ray
    inside = (wts >= -1e-4).all(-1) & (wts.sum(-1) > 1e-6)
    if not inside.any(): continue
    w = wts[inside]; w = w / w.sum(1, keepdims=True)
    uv = w @ T[tri]
    out[yy[inside], xx[inside]] = sample(uv); cov[yy[inside], xx[inside]] = True; UVM[yy[inside], xx[inside]] = w @ S[tri]

# close any pin-holes along triangle edges with neighbouring colour
for _ in range(4):
    if cov.all(): break
    acc = np.zeros_like(out); n = np.zeros(cov.shape, np.float32)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        m = np.roll(np.roll(cov, dy, 0), dx, 1); acc += np.roll(np.roll(out, dy, 0), dx, 1) * m[..., None]; n += m
    fill = (~cov) & (n > 0)
    out[fill] = acc[fill] / n[fill][:, None]; cov |= fill
print('coverage', round(float(cov.mean()) * 100, 2), '%')
if '--seams' in flags:
    # a seam is where neighbouring pixels come from different places in the texture (different UV islands)
    jump = np.zeros((H, W), bool)
    for ax in (0, 1):
        d = np.abs(np.roll(UVM, -1, ax) - UVM).max(-1)
        if ax == 0: d[-1] = 0                                               # no wrap across the poles
        jump |= (d > 0.015) & (UVM[..., 0] > -5) & (np.roll(UVM, -1, ax)[..., 0] > -5)
    near = jump | np.roll(jump, 1, 0) | np.roll(jump, 1, 1)
    halo = near.copy()
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)): halo |= np.roll(np.roll(near, dy, 0), dx, 1)
    out[halo & ~near] *= 0.82                                               # soft shoulder of the groove
    out[near] = out[near] * 0.35 + 0.08                                     # the groove itself
    print('seam pixels', int(near.sum()))
buf = io.BytesIO(); Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(buf, 'JPEG', quality=88)
data['sphereTexture'] = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
if '--sphere-only' in flags:
    data = {'sphere': True, 'texture': data['sphereTexture']}          # (a sphere's texture is its sphere map)
open(path, 'w', encoding='utf8').write(head + '] = ' + json.dumps(data) + ';\n')
print(path, 'sphere map', W, 'x', H, round(len(data['sphereTexture']) / 1e6, 2), 'MB')
