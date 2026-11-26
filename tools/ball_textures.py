"""Paint equirectangular textures for the World Cup balls and write them as ball models for the game.

Each texture is computed per pixel from the direction on the ball, following each ball's real panel layout and
graphics as seen in product photos (no maker's or FIFA logos):
  trionda  (2026) four panels on a tetrahedron with sweeping seams; each panel a big curved triangle of colour (red with
           maple-leaf motifs, green with feather chevrons, blue with stars) framed by wide white ribbons and gold edging;
           the fourth panel is white
  brazuca  (2014) six identical propeller panels (cube faces with S-shaped edges); along each seam a tapered swoosh of
           navy and orange / green / sky blue, on one side only, which gives the pinwheel look
  jabulani (2010) eight panels with faint seams; four curved triangles with concave sides, dark inside with chevrons in
           the ball's eleven colours, ringed in golden yellow and black
usage: python tools/ball_textures.py <out dir = assets/balls>
Writes <id>.js registering window.FKBallModels[id] = {sphere: true, texture: <jpeg data URL>} and updates manifest.js.
Texture convention: u = longitude / 2pi, v = colatitude / pi; direction = (sin v cos u, cos v, sin v sin u).
"""
import sys, os, io, json, base64
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'assets', 'balls')
W, H, SS = 2048, 1024, 1.5                   # final size and supersampling factor
w, h = int(W * SS), int(H * SS)
u = (np.arange(w, dtype=np.float32) + 0.5) / w
v = (np.arange(h, dtype=np.float32) + 0.5) / h
TH, PH = np.meshgrid(u * 2 * np.pi, v * np.pi)
P = np.stack([np.sin(PH) * np.cos(TH), np.cos(PH), np.sin(PH) * np.sin(TH)], -1).astype(np.float32)

def norm(a): return a / np.linalg.norm(a, axis=-1, keepdims=True)
def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
def mix(a, b, t):
    b = np.asarray(b, np.float32)
    return a * (1 - t[..., None]) + (b if b.ndim > 1 else b[None, None, :]) * t[..., None]
def frame_of(c):
    c = np.asarray(c, np.float32); a = np.array([0, 1, 0], np.float32) if abs(c[1]) < 0.9 else np.array([1, 0, 0], np.float32)
    U = np.cross(c, a); U /= np.linalg.norm(U); return U, np.cross(c, U)
def hash2(x, y): return np.modf(np.sin(x * 127.1 + y * 311.7) * 43758.5453)[0] % 1.0
TETRA = norm(np.array([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], np.float32))
grain = lambda: (0.97 + 0.04 * hash2(np.floor(TH * 300), np.floor(PH * 300)))[..., None]

def two_largest(d):
    o = np.argsort(-d, axis=-1)
    i1 = o[..., 0]; s1 = np.take_along_axis(d, o[..., :1], -1)[..., 0]; s2 = np.take_along_axis(d, o[..., 1:2], -1)[..., 0]
    return i1, s1, s2

def trionda():
    # sweeping S-shaped seams: the sphere is swirled about each panel centre before the panels are assigned
    q = P.copy()
    # (the seams meet in threes at the points opposite each panel centre: swirling around those curls every seam)
    for c in -TETRA:
        cd = np.clip(q @ c, 0, 1)
        ax = np.cross(c[None, None, :], q)                                # tangential direction around that point
        q = norm(q + 0.55 * ax * (np.sin(np.pi * cd) ** 2)[..., None])
    d = q @ TETRA.T
    pid, s1, s2 = two_largest(d)
    gap = s1 - s2
    col = np.full(P.shape, 0.965, np.float32)
    host = [np.array(c, np.float32) for c in ([0.80, 0.09, 0.14], [0.08, 0.58, 0.27], [0.10, 0.34, 0.80])]
    # wide white ribbons along the seams (about a third of each panel), the colour as a curved triangle inside
    RIB, GOLD = 0.36, 0.385
    for i in range(3):
        m = (pid == i)
        U, V = frame_of(TETRA[i])
        x, y = q @ U, q @ V
        ang = np.arctan2(y, x)
        # the colour's edge waves a little (the "onda"), so it is not a plain offset of the seams
        g2 = gap + 0.035 * np.sin(ang * 3 + i)
        inside = sstep(GOLD, GOLD + 0.008, g2) * m
        # the colour field: deeper at the edge, brighter in the middle, with flowing contour lines (the debossed
        # micro pattern) in a lighter tone of the same colour
        shade = 0.78 + 0.3 * sstep(0.4, 0.95, g2)
        c = host[i][None, None, :] * shade[..., None]
        lines = (np.abs(np.sin(g2 * 70 + 2.5 * np.sin(ang * 3 + g2 * 4))) < 0.16).astype(np.float32)
        c = mix(c, np.minimum(host[i] * 1.45 + 0.08, 1), lines * 0.5)
        # sparse tone-on-tone motifs: stars (USA), maple-like leaves (Canada), feather chevrons (Mexico)
        k = 6.0; X, Y = x * k, y * k; fx, fy = X - np.floor(X) - 0.5, Y - np.floor(Y) - 0.5
        on = hash2(np.floor(X), np.floor(Y)) > 0.62
        rr, aa = np.hypot(fx, fy), np.arctan2(fy, fx)
        if i == 2:   shape = rr < 0.2 * (0.5 + 0.5 * np.cos(5 * aa)) + 0.07                # five-pointed star
        elif i == 0: shape = rr < 0.16 * (0.55 + 0.45 * np.abs(np.cos(3.5 * aa))) + 0.08    # pointed leaf
        else:        shape = np.abs(np.abs(fx) * 1.3 - (fy + 0.22)) < 0.06                  # chevron
        c = mix(c, np.minimum(host[i] * 1.6 + 0.2, 1), (shape & on).astype(np.float32) * 0.75 * sstep(GOLD + 0.05, GOLD + 0.1, g2))
        col = mix(col, c, inside)
        gap_i = g2
        # gold edging between the colour and the white ribbon
        gold = sstep(RIB, RIB + 0.004, gap_i) * (1 - sstep(GOLD - 0.004, GOLD, gap_i)) * m
        col = mix(col, np.array([0.86, 0.68, 0.28], np.float32), gold)
    # the white fourth panel: faint gold waves
    m3 = (pid == 3)
    U, V = frame_of(TETRA[3]); ang = np.arctan2(q @ V, q @ U)
    wave = (np.abs(np.sin(gap * 40 + np.sin(ang * 3) * 2)) < 0.05) * sstep(0.2, 0.25, gap) * m3
    col = mix(col, np.array([0.88, 0.8, 0.6], np.float32), wave.astype(np.float32) * 0.6)
    # seam groove down the middle of the ribbons
    col = mix(col, np.array([0.45, 0.45, 0.47], np.float32), 1 - sstep(0.002, 0.006, gap))
    return col * grain()

def brazuca():
    q = norm(P + 0.36 * np.sin(2.6 * P[..., [1, 2, 0]] + np.array([0.4, 1.3, 2.2], np.float32)))
    a = np.abs(q)
    k1 = np.argmax(a, -1)
    srt = np.sort(a, -1); m1, m2 = srt[..., 2], srt[..., 1]
    k2 = np.argmax(np.where(np.arange(3)[None, None, :] == k1[..., None], -1, a), -1)
    k3 = 3 - k1 - k2
    face = k1 * 2 + (np.take_along_axis(q, k1[..., None], -1)[..., 0] < 0)
    gap = (m1 - m2) * 0.6
    t = np.take_along_axis(q, k3[..., None], -1)[..., 0] / m1                       # position along the edge, -1..1
    # the swoosh: widest mid-seam, tapering to points at both ends, offset toward one end like a brushstroke
    width = 0.2 * np.clip(1 - ((t - 0.15) / 0.95) ** 2, 0, 1) ** 0.9
    side = ((k1 - k2) % 3 == 1)                                                       # one side of each seam only
    col = np.full(P.shape, 0.965, np.float32)
    acc = np.array([[0.96, 0.45, 0.06], [0.12, 0.64, 0.26], [0.10, 0.58, 0.88]], np.float32)[face % 3]
    acc2 = np.array([[0.10, 0.58, 0.88], [0.96, 0.45, 0.06], [0.12, 0.64, 0.26]], np.float32)[face % 3]
    navy_c = np.array([0.05, 0.09, 0.26], np.float32)
    # from the seam outward: navy core (with a thin light line through it), the main colour, a thin second colour
    core = sstep(0.004, 0.008, gap) * (1 - sstep(width * 0.5, width * 0.5 + 0.005, gap)) * side
    line = sstep(width * 0.22, width * 0.22 + 0.003, gap) * (1 - sstep(width * 0.27, width * 0.27 + 0.003, gap)) * side * (width > 0.05)
    band = sstep(width * 0.5 + 0.005, width * 0.5 + 0.01, gap) * (1 - sstep(width * 0.88, width * 0.88 + 0.005, gap)) * side
    edge = sstep(width * 0.88 + 0.01, width * 0.88 + 0.014, gap) * (1 - sstep(width + 0.004, width + 0.008, gap)) * side * (width > 0.04)
    col = mix(col, navy_c, core)
    col = col * (1 - line[..., None] * 0.6) + acc2 * (line[..., None] * 0.6)
    col = col * (1 - band[..., None]) + acc * band[..., None]
    col = col * (1 - edge[..., None]) + acc2 * edge[..., None]
    # the other side of the seam: a slim navy line and a thin coloured pinstripe
    w2 = width * 0.25
    pin = sstep(0.006, 0.01, gap) * (1 - sstep(w2, w2 + 0.004, gap)) * (~side)
    col = mix(col, navy_c, pin * 0.95)
    col = mix(col, np.array([0.35, 0.36, 0.4], np.float32), 1 - sstep(0.002, 0.006, gap))
    return col * grain()

def jabulani():
    q = norm(P + 0.13 * np.sin(5.0 * P[..., [2, 0, 1]] + 0.7))
    gap = np.min(np.abs(q), -1)
    col = np.full(P.shape, 0.965, np.float32)
    pal = np.array([[0.78, 0.1, 0.12], [0.1, 0.5, 0.22], [0.96, 0.76, 0.1], [0.92, 0.45, 0.08], [0.05, 0.45, 0.5],
                    [0.55, 0.12, 0.35], [0.98, 0.9, 0.5]], np.float32)
    rot = norm(np.array([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], np.float32) @ np.array([[0.94, 0, 0.34], [0, 1, 0], [-0.34, 0, 0.94]], np.float32))
    for i, c in enumerate(rot):
        U, V = frame_of(c)
        cd = P @ c
        x, y = P @ U, P @ V
        r = np.arccos(np.clip(cd, -1, 1)); ang = np.arctan2(y, x) + i * 0.5
        # a curved triangle with sharp points and concave sides (points at 0, 120, 240 degrees)
        rb = 0.8 - (0.8 - 0.4) * np.abs(np.sin(1.5 * ang)) ** 0.65
        cc = r / rb
        m = (cd > 0)
        inner = (1 - sstep(0.985, 1.0, cc)) * m
        # inside: dark, crossed by thin diagonal stripes in the ball's colours (denser toward the points)
        s = (x * np.cos(0.6 + i) + y * np.sin(0.6 + i)) * 26
        idx = np.floor(s).astype(int) % len(pal)
        thin = (np.abs((s % 1.0) - 0.5) < 0.16) & (cc > 0.3) & (cc < 0.93)
        dark = np.array([0.07, 0.09, 0.07], np.float32)
        fill = np.where(thin[..., None], pal[idx] * 0.9, dark[None, None, :])
        col = col * (1 - inner[..., None]) + fill * inner[..., None]
        ring = sstep(0.985, 1.0, cc) * (1 - sstep(1.09, 1.105, cc)) * m
        col = mix(col, np.array([0.95, 0.74, 0.1], np.float32), ring)
        edge = sstep(1.09, 1.105, cc) * (1 - sstep(1.13, 1.145, cc)) * m
        col = mix(col, np.array([0.05, 0.05, 0.05], np.float32), edge)
    col = mix(col, np.array([0.72, 0.72, 0.74], np.float32), 1 - sstep(0.003, 0.008, gap))
    return col * grain()

def write(ball_id, img):
    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(OUT, ball_id + '.js')
    if os.path.exists(dest) and 'tools/ball_model.js' in open(dest, encoding='utf8').read(200):
        print(ball_id, 'skipped: a real model is installed'); return           # never paint over a real model
    im = Image.fromarray((np.clip(img, 0, 1) ** (1 / 1.0) * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=88)
    url = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
    with open(os.path.join(OUT, ball_id + '.js'), 'w', encoding='utf8') as f:
        f.write(f'/* {ball_id}: painted texture on a sphere, generated by tools/ball_textures.py from the real panel layout. */\n')
        f.write(f'(self.FKBallModels = self.FKBallModels || {{}})[{json.dumps(ball_id)}] = {{"sphere":true,"texture":{json.dumps(url)}}};\n')
    pv = os.environ.get('BALL_PREVIEW')            # optional: two shaded views of the ball, for checking the design
    if pv:
        tex = np.asarray(im, np.float32) / 255.0; S = 360; views = []
        for yaw, pitch in ((0.4, 0.35), (2.5, -0.5)):
            yy, xx = np.mgrid[0:S, 0:S]; X = (xx + 0.5) / S * 2 - 1; Y = 1 - (yy + 0.5) / S * 2
            Z = np.sqrt(np.clip(1 - X * X - Y * Y, 0, 1)); on = X * X + Y * Y < 1
            cp, sp, cy, sy = np.cos(pitch), np.sin(pitch), np.cos(yaw), np.sin(yaw)
            y1, z1 = Y * cp - Z * sp, Y * sp + Z * cp                           # undo the view rotation
            x2, z2 = X * cy + z1 * sy, -X * sy + z1 * cy
            uu = (np.arctan2(z2, x2) / (2 * np.pi)) % 1.0; vv = np.arccos(np.clip(y1, -1, 1)) / np.pi
            c = tex[np.clip((vv * H).astype(int), 0, H - 1), np.clip((uu * W).astype(int), 0, W - 1)]
            lit = 0.35 + 0.65 * np.clip(X * -0.4 + Y * 0.5 + Z * 0.77, 0, 1)
            views.append(np.where(on[..., None], c * lit[..., None], 0.13))
        Image.fromarray((np.hstack(views) * 255).astype(np.uint8)).save(os.path.join(pv, ball_id + '_sphere.png'))
    print(ball_id, round(len(url) / 1e6, 2), 'MB')

for name, fn in (('trionda', trionda), ('brazuca', brazuca), ('jabulani', jabulani)):
    write(name, fn())
man = os.path.join(OUT, 'manifest.js')
ids = []
if os.path.exists(man):
    try: ids = json.loads(open(man, encoding='utf8').read().split('=', 1)[1].strip().rstrip(';'))
    except Exception: ids = []
for i in ('trionda', 'brazuca', 'jabulani'):
    if i not in ids: ids.append(i)
open(man, 'w', encoding='utf8').write('/* Balls with a real 3-D model in this folder (written by tools/ball_model.js / ball_textures.py). */\nself.FKBallManifest = ' + json.dumps(ids) + ';\n')
