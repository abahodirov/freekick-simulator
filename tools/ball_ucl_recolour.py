"""Recolour the Champions League ball in the style of the 2024-25 match ball: the printed ground between the white
star panels becomes dark charcoal with a faint texture, traced with a thin green line just outside every star (along
its groove). The panels, their grooves and the print inside them are kept.
usage: python tools/ball_ucl_recolour.py assets/balls/ucl.js   (after tools/ball_panels*.py: it reads "panelMap")
"""
import sys, json, io, base64, numpy as np
from PIL import Image, ImageFilter
path = sys.argv[1]
s = open(path, encoding='utf8').read(); head, body = s.split('] = ', 1); d = json.loads(body.rstrip().rstrip(';'))
tex = Image.open(io.BytesIO(base64.b64decode(d['texture'].split(',', 1)[1]))).convert('RGB')
W, H = tex.size
img = np.asarray(tex, np.float32) / 255
ids = np.asarray(Image.open(io.BytesIO(base64.b64decode(d['panelMap'].split(',', 1)[1]))).resize((W, H), Image.NEAREST), np.int32)
inner = d.get('panelInner', 20)
ground = ids >= inner
# distance from the stars, in pixels (a few steps of growth from the star edge into the ground)
star = ~ground
dist = np.full((H, W), 99.0)
cur = star.copy()
for k in range(1, 15):
    nb = cur | np.roll(cur, 1, 1) | np.roll(cur, -1, 1) | np.vstack([cur[:1], cur[:-1]]) | np.vstack([cur[1:], cur[-1:]])
    dist[nb & ~cur] = k; cur = nb
rng = np.random.default_rng(3)
noise = np.asarray(Image.fromarray((rng.random((H // 4, W // 4)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255
fine = (rng.random((H, W)) - 0.5) * 0.025
charcoal = np.array([0.155, 0.17, 0.168], np.float32)
base = charcoal[None, None, :] * (0.92 + 0.16 * noise[..., None]) + fine[..., None]
# a thin green trace just outside each star, and a darker shadow along the groove itself
green = np.array([0.42, 0.82, 0.28], np.float32)
line = np.exp(-((dist - 7.5) / 1.3) ** 2)[..., None] * (dist < 14)[..., None]
shade = np.exp(-((dist - 1.5) / 1.6) ** 2)[..., None]
col = base * (1 - 0.45 * shade) * (1 - line) + green * line * 0.9
out = np.where(ground[..., None], col, img)
buf = io.BytesIO(); Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(buf, 'JPEG', quality=88)
d['texture'] = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
open(path, 'w', encoding='utf8').write(head + '] = ' + json.dumps(d) + ';\n')
print('recoloured', round(float(ground.mean()) * 100, 1), '% of the map')
