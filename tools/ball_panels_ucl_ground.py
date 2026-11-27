"""Starball: split the printed ground between the star panels into 20 pieces, one under each star (the nearest star
centre), so the whole skin comes apart around the core. Run after tools/ball_panels.py --ground. Sets "panelInner".
usage: python tools/ball_panels_ucl_ground.py assets/balls/ucl.js"""
import sys, json, io, base64, numpy as np
from PIL import Image
p = sys.argv[1]; s = open(p, encoding='utf8').read(); head, body = s.split('] = ', 1); d = json.loads(body.rstrip().rstrip(';'))
ids = np.asarray(Image.open(io.BytesIO(base64.b64decode(d['panelMap'].split(',', 1)[1]))), np.int32).copy()
H, W = ids.shape
uu = (np.arange(W) + .5) / W; vv = (np.arange(H) + .5) / H
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
D = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1); A = np.sin(COL)
stars = sorted(set(np.unique(ids)) - {255})
C = np.array([(D[ids == k] * A[ids == k, None]).sum(0) for k in stars]); C /= np.linalg.norm(C, axis=1, keepdims=True)
g = ids == 255
near = np.argmax(D[g] @ C.T, -1)
ids[g] = len(stars) + near
d['panelMap'] = 'data:image/png;base64,' + base64.b64encode((lambda b: (Image.fromarray(ids.astype(np.uint8), 'L').save(b, 'PNG', optimize=True), b.getvalue())[1])(io.BytesIO())).decode()
d['panelInner'] = len(stars)          # ids from here on are the printed ground: they lift off less, under their stars
open(p, 'w', encoding='utf8').write(head + '] = ' + json.dumps(d) + ';\n')
print('stars', len(stars), 'ground pieces', len(stars), 'max id', ids.max())
