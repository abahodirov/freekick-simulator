"""Jabulani panel map (usage: python tools/ball_panels_jabulani.py assets/balls/jabulani.js): 8 panels on the corners
of a cube; the coloured ring graphics sit on 4 alternate corners. Take those 4 ring centres where they sit in the
sphere map (two on the equator, two near longitude 0), complete the cube with their opposites, and give every
direction to its nearest corner (approximate: the seams are too faint in the model to trace)."""
import sys, json, io, base64, numpy as np
from PIL import Image
path = sys.argv[1]
s = open(path, encoding='utf8').read(); head, body = s.split('] = ', 1); d = json.loads(body.rstrip().rstrip(';'))
tex = Image.open(io.BytesIO(base64.b64decode((d.get('sphereTexture') or d['texture']).split(',', 1)[1]))).convert('RGB').resize((512, 256))
A = np.asarray(tex, np.float32) / 255
W, H = 512, 256
uu = (np.arange(W) + .5) / W; vv = (np.arange(H) + .5) / H
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
D = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1)
sat = A.max(-1) - A.min(-1)
msk = sat > 0.3
pts = D[msk]; w = np.sin(COL)[msk]
print('coloured pixels', len(pts))
# k-means on the sphere, k = 4, started from a tetrahedron
def dirf(lon, col):
    lon, col = np.radians(lon), np.radians(col)
    return np.array([np.sin(col) * np.cos(lon), np.cos(col), np.sin(col) * np.sin(lon)])
# seeded from where the four rings sit in the sphere map (two on the equator, two near longitude 0 above and below)
best = None
for trial in range(1):
    C = np.array([dirf(116, 90), dirf(225, 90), dirf(0, 35), dirf(0, 145)])
    for it in range(0):
        lab = np.argmax(pts @ C.T, 1)
        C = np.array([((pts[lab == k] * w[lab == k, None]).sum(0)) for k in range(4)])
        C /= np.linalg.norm(C, axis=1, keepdims=True)
    score = (np.max(pts @ C.T, 1) * w).sum()
    if best is None or score > best[0]: best = (score, C)
C = best[1]
print('ring centres, pairwise angles (deg):', [round(float(np.degrees(np.arccos(np.clip(C[i] @ C[j], -1, 1)))), 1) for i in range(4) for j in range(i + 1, 4)])
corners = np.concatenate([C, -C])                                  # 0-3 coloured panels, 4-7 white panels
W2, H2 = 1024, 512
uu = (np.arange(W2) + .5) / W2; vv = (np.arange(H2) + .5) / H2
LON, COL = np.meshgrid(uu * 2 * np.pi, vv * np.pi)
D2 = np.stack([np.sin(COL) * np.cos(LON), np.cos(COL), np.sin(COL) * np.sin(LON)], -1)
ids = np.argmax(D2 @ corners.T, -1).astype(np.uint8)
buf = io.BytesIO(); Image.fromarray(ids, 'L').save(buf, 'PNG', optimize=True)
d['panelMap'] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
open(path, 'w', encoding='utf8').write(head + '] = ' + json.dumps(d) + ';\n')
print('panels', len(np.unique(ids)))
