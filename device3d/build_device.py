"""Build the BIOCANARY device in Blender.

    Blender -b --factory-startup -P build_device.py -- out.blend [--voxel 3]

Every part is positioned from where it appears in the reference image, by
projecting its pixel position back onto the plane it sits on (see camera.py).
"""
import math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
import housing as H
import kit
from kit import (add, bevel, collection, cyl, elbow, lathe, place, rbox, rrect, sleeve, smooth_path,
                 svg_art, text_art, torus, tube)
from camera import _ray, CAM, F, HORIZON, P, W, YAW, unproject, unproject_plane
import materials as M

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.join(HERE, 'biocanary_device.blend')
VOXEL = float(ARGS[ARGS.index('--voxel') + 1]) if '--voxel' in ARGS else 3.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'MILLIMETERS'
root = collection('BIOCANARY device')
for c in ('Enclosure', 'Status panel', 'Branding', 'Reference chamber', 'Test chamber', 'Level columns', 'Tubing'):
    collection(c, root)
collection('Studio')

# ------------------------------------------------------------------ materials
white = M.solid('Enclosure white', 'd0d3de', .36, coat=.2)
dark = M.solid('Smoked panel', '0f161f', .24, spec=.22)
plinth = M.solid('Plinth graphite', '12161e', .36, spec=.22)
shell_mat = M.two_tone('Enclosure white and bezel', ('d0d3de', .36, 0, .2), ('6b757e', .3, .35, 0), 'bezel')
rubber = M.solid('Rubber', '050609', .7, spec=.2)
black = M.solid('Moulded black', '030409', .27, spec=.16)
navy = M.solid('Brand navy', '254F91', .5, spec=.15)
acrylic = M.glass('Clear acrylic', 'fbfdff', 1.32)
tubing = M.film('Clear tubing', 'fcfdff', 1.5, gloss=1.6, rough=.04, shade='3c4a74', shade_pow=2.8)
fitting = M.film('Clear fitting', 'fcfdff', 1.45, gloss=.9, shade='8090b8', shade_pow=6)
strip = M.emission('Light strip blue', '219cff', 1.3)

PAL = {
    'ref': dict(
        lid=M.film('Acrylic lit blue', 'fcfdff', 1.45, gloss=.3),
        box=M.film('Chamber wall blue', 'fdfeff', 1.4, gloss=.28),
        cup=M.film('Vessel glass blue', 'f9fdff', 1.4, edge='4fc0ff', edge_str=3.6, edge_pow=8, body=.0, gloss=.4),
        latch=M.solid('Latch pin blue', '0b2c78', .3), post=M.glass('Acrylic edge blue', 'e2ebff', 1.45),
        line=M.film('Edge light blue', 'dfe8ff', 1.6, edge='c3d6ff', edge_str=.25, body=.3),
        probe=M.solid('Probe black (blue lit)', '030a24', .3, spec=.1),
        base=M.emission('Vessel base blue', 'aeeaff', 2.3),
        rim=M.emission('Vessel rim blue', '7fdcff', 1.5),
        waterline=M.emission('Meniscus blue', '58c2ff', 1.25),
        liquid=('Culture medium blue', 'c0dcf7', '74b0ea', 'c4f0ff'),
        bubble=M.bubble('Bubbles blue', 'd2f4ff', 4.2),
        led=M.emission('LED blue', '9fdcff', 7.0),
        puck=M.solid('Light base blue', '08358f', .25, emit='0a55ff', estr=.55),
        puck_glow=M.emission('Light base ring blue', '2f8bff', 2.0),
        label=M.solid('Label blue', '123a78', .5, spec=.12, emit='123b80', estr=.06),
        label_edge=M.emission('Label edge blue', '55b4ff', 1.0), light=(0.25, .55, 1.0)),
    'test': dict(
        lid=M.film('Acrylic lit green', 'fcfffd', 1.45, gloss=.3),
        box=M.film('Chamber wall green', 'fdfffe', 1.4, gloss=.28),
        cup=M.film('Vessel glass green', 'f8fffa', 1.4, edge='48ec8c', edge_str=3.2, edge_pow=8, body=.0, gloss=.4),
        latch=M.solid('Latch pin green', '0c4230', .3), post=M.glass('Acrylic edge green', 'e2f5ea', 1.45),
        line=M.film('Edge light green', 'e2f7ea', 1.6, edge='c4f2d6', edge_str=.25, body=.28),
        probe=M.solid('Probe black (green lit)', '030907', .3, spec=.1),
        base=M.emission('Vessel base green', 'aeffcb', 2.2),
        rim=M.emission('Vessel rim green', '7dffb0', 1.4),
        waterline=M.emission('Meniscus green', '55ee92', 1.2),
        liquid=('Culture medium green', 'c8f0dc', '6bcf9d', 'bcffd4'),
        bubble=M.bubble('Bubbles green', 'd6ffe4', 4.0),
        led=M.emission('LED green', '9fffc2', 7.0),
        puck=M.solid('Light base green', '0c5a33', .25, emit='17b45a', estr=.4),
        puck_glow=M.emission('Light base ring green', '3ee07d', 1.6),
        label=M.solid('Label green', '0c3a31', .5, spec=.12, emit='0d4036', estr=.06),
        label_edge=M.emission('Label edge green', '55e092', .9), light=(.25, 1.0, .5)),
}
label_white = M.emission('Label lettering', 'f4f8ff', 1.0)

# ------------------------------------------------------------------ enclosure
for name, f, lo, hi, vx, mat in (
        ('Enclosure shell', H.shell, (-670, -110, 20), (560, 418, 650), VOXEL, shell_mat),
        ('Smoked fascia and deck', H.panel, (-670, -110, 195), (560, 418, 640), VOXEL, dark),
        ('Plinth', H.plinth, (-670, -110, 0), (560, 418, 80), VOXEL * .8, plinth)):
    v, q, n = H.polygonise(f, lo, hi, vx)
    if f is H.shell:
        ob = add(name, v, q, mat, 'Enclosure')
        bm = bmesh.new(); bm.from_mesh(ob.data)          # crisp, straight seam
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7, plane_co=[c_ * P for c_ in H.SEAM_POINT],
                               plane_no=(0, H.SEAM_SLOPE, -1), clear_outer=True)
        bm.to_mesh(ob.data); bm.free()
        vv = np.array([q_.co[:] for q_ in ob.data.vertices]) / P
        ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
        ob.data.normals_split_custom_set_from_vertices([tuple(k) for k in H.normal(H.shell, vv)])
        at = ob.data.attributes.new('bezel', 'FLOAT', 'POINT')
        at.data.foreach_set('value', H.bezel_mask(vv[:, 0], vv[:, 1], vv[:, 2]).astype(np.float32))
    else:
        add(name, v, q, mat, 'Enclosure', normals=n)

for i, p in enumerate(((unproject(325, 914, -20)), unproject(1026, 925, -18), np.array([425, 295, 0]), np.array([-370, 320, 0]))):
    cyl(f'Foot {i + 1}', 40 if i < 2 else 34, 0, 12, p[0], p[1], rubber, 'Enclosure', b=3)

FP, FN = np.array([0, H.FRONT_Y, H.DECK_Z]), np.array([0, -1, H.DRAFT]) / math.hypot(1, H.DRAFT)


def on_front(lift):
    return lambda px, py: unproject_plane(px, py, FP + FN * lift, FN)


# light bar in its shallow cowl
cowl = [(455, 886), (489, 863), (500, 859.5), (846, 864), (858, 868), (884, 890)]
fr = on_front(1.2); bk = on_front(-6)
v = [fr(*c) for c in cowl] + [bk(*c) for c in cowl]
n = len(cowl)
ob = add('Light bar cowl', v, [list(range(n))[::-1]] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], white, 'Enclosure')
bevel(ob, 1.1, 2)


def capsule(name, x0, y0, x1, y1, r, lift, mat, depth=5):
    """Pill between two pixel points on the front wall."""
    a0 = math.atan2(y1 - y0, x1 - x0)
    pts = [(x1 + r * math.cos(a0 + t), y1 + r * math.sin(a0 + t)) for t in np.linspace(-math.pi / 2, math.pi / 2, 9)] + \
          [(x0 + r * math.cos(a0 + t), y0 + r * math.sin(a0 + t)) for t in np.linspace(math.pi / 2, 3 * math.pi / 2, 9)]
    f, b = on_front(lift), on_front(lift - depth)
    v = [f(*p) for p in pts] + [b(*p) for p in pts]
    m = len(pts)
    o = add(name, v, [list(range(m))] + [[i, m + i, m + (i + 1) % m, (i + 1) % m] for i in range(m)], mat, 'Enclosure')
    return bevel(o, .8, 2)


capsule('Light bar blue', 486, 865.2, 560, 866.2, 3.0, 2.2, M.emission('Bar blue', '5cbcff', 1.05))
capsule('Light bar green', 760, 868.4, 853, 869.6, 3.0, 2.2, M.emission('Bar green', '55d9a0', .95))
capsule('Light bar core', 554, 866.1, 768, 868.5, 3.4, 2.8, M.emission('Bar cyan', '86e2ff', 1.75))

capsule('Light bar highlight', 580, 866.6, 742, 868.1, 1.3, 3.2, M.emission('Bar white', 'd8f7ff', 1.5))

# soft spill of the bar on the front wall
def spill(name, x0, x1, y0, y1, fn, lift, surf, nx=90, ny=26, coll='Enclosure'):
    xs, ys = np.linspace(x0, x1, nx), np.linspace(y0, y1, ny)
    v = [surf(lift)(a, b) for b in ys for a in xs]
    f = [[j * nx + i, (j + 1) * nx + i, (j + 1) * nx + i + 1, j * nx + i + 1] for j in range(ny - 1) for i in range(nx - 1)]
    N = M.Nodes(name); at = N.n('Attribute'); at.attribute_name = 'spill'
    e = N.n('Emission'); N.l(at.outputs['Color'], e.inputs['Color'])
    N.done(N.addsh(N.transp(), e.outputs[0]))
    ob = add(name, v, f, N.m, coll)
    ca = ob.data.color_attributes.new('spill', 'FLOAT_COLOR', 'POINT')
    for k, (b, a) in enumerate((b, a) for b in ys for a in xs):
        ca.data[k].color = (*fn(a, b), 1)
    ob.visible_shadow = False; ob.visible_diffuse = False
    return ob


def bar_spill(a, b):
    c0 = np.array([.10, .22, 1.0]); c1 = np.array([.12, .75, .45])
    k = min(max((a - 745) / 90, 0), 1)
    d = abs(b - (866 + (a - 660) * .011))
    ends = min(max((a - 462) / 60, 0), 1) * min(max((888 - a) / 60, 0), 1)
    mid = .55 + .45 * math.exp(-((a - 655) / 130) ** 2)
    up = 1.0 if b < 866 else .8
    edge = min(max((b - 826) / 20, 0), 1) * min(max((893 - b) / 8, 0), 1)
    return tuple((c0 * (1 - k) + c1 * k * .6) * ends * mid * up * edge * (.55 * math.exp(-d / 9) + .14 * math.exp(-d / 26)))


spill('Light bar spill', 455, 890, 826, 893, bar_spill, 1.8, on_front)

# side light line, traced on the enclosure surface
LINE = [(1084, 889), (1091, 875), (1096, 858), (1097.5, 838), (1096, 812), (1093, 785), (1091, 757), (1092, 738),
        (1097, 722), (1107, 704), (1122, 686), (1143, 663), (1160, 646), (1172, 630), (1179, 610), (1182.5, 585),
        (1183, 550), (1183, 500), (1183, 440), (1183, 380), (1181, 362), (1175, 346), (1165, 334), (1152, 325.5), (1136, 320)]
pix = kit.catmull([(a, b, 0) for a, b in LINE], 8)
pts = []
for a, b, _ in pix:
    p = None
    for dx in (0, -1, -2, -3, -4, -6):
        p = H.march(H.shell, a + dx, b)
        if p is not None and p[1] < 360: break
    if p is not None:
        pts.append(p + H.normal(H.shell, p)[0] * .1)
pts = np.array(pts)
for _ in range(3): pts[1:-1] = .25 * pts[:-2] + .5 * pts[1:-1] + .25 * pts[2:]
tube('Side light line', pts, 1.9, strip, 'Enclosure', segs=12)

# rear service panel (not visible in the reference image)
BY = H.BACK_Y
rp = rbox('Rear service panel', 40, 420, BY - 3, BY + 1.5, 120, 300, 1.5, black, 'Enclosure', b=1)
rpv = [(x_, BY + 1.6, z_) for x_, z_ in rrect(40, 420, 120, 300, 14)]


def rear_disc(name, x_, z_, r_, depth, mat):
    pts_ = [(x_, BY + .5, z_), (x_, BY + .5 + depth, z_)]
    return tube(name, pts_, r_, mat, 'Enclosure', segs=48)


metal = M.solid('Port metal', 'a9adb5', .28, metallic=.9)
for nm, xx in (('Reference drain outlet', 90), ('Test drain outlet', 160), ('Wastewater sample inlet', 230)):
    rear_disc(f'{nm} nut', xx, 215, 24, 9, metal)
    rear_disc(nm, xx, 215, 12, 30, black)
rear_disc('DC power ring', 300, 215, 17, 5, metal); rear_disc('DC power pin', 300, 215, 6, 7, rubber)
rbox('Ethernet port', 345, 393, BY, BY + 5, 192, 238, 2, metal, 'Enclosure', b=1)
rbox('Ethernet cavity', 351, 387, BY + 3, BY + 5.6, 198, 230, 1, rubber, 'Enclosure', b=.5)
for k_ in range(9):
    rbox(f'Vent {k_ + 1}', -300, 10, BY - 2, BY + .6, 430 + k_ * 14, 436 + k_ * 14, 1, rubber, 'Enclosure', b=.5)

# ------------------------------------------------------------------- branding
svg = os.path.join(HERE, '..', 'docs', 'brand', 'biocanary-logo.svg')
med = bpy.data.fonts.load(os.path.join(HERE, 'fonts', 'Figtree-Medium.ttf'))
reg = bpy.data.fonts.load(os.path.join(HERE, 'fonts', 'Figtree-Regular.ttf'))
# the brand file, whole and at its own proportions, in the space the reference gives the logo
place('Logo', svg_art(svg), navy, 'Branding', (538, 748, 814, 803), on_front(.5), fit='x')
place('Tagline', text_art('Listen today. A cleaner tomorrow.', reg), navy, 'Branding', (560, 810, 803, 827.5), on_front(.5))

# --------------------------------------------------------------- status panel


def on_fascia(lift):
    return lambda px, py: unproject(px, py, H.TOWER_Y + 8.0 - lift)


def stroke(name, pix, r, mat, lift=.6, closed=False):
    f = on_fascia(lift)
    p = np.array([f(*q) for q in pix])
    if closed: p = np.vstack([p, p[:2]])
    return tube(name, p, r, mat, 'Status panel', segs=10)


cyan = M.emission('Indicator cyan', '35c8fa', 1.15)
green = M.emission('Indicator green', '35e884', 1.1)
out = rrect(1077, 1153.5, 378, 565, 12, 8)
stroke('Status panel outline', out, .7, M.solid('Panel outline', '36424e', .3, spec=.6), .2, True)


def arc(cx, cy, r, a0, a1, n=22):
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in np.linspace(a0, a1, n)]


for i, r in enumerate((7.8, 14.0, 20.4)):
    stroke(f'Wi-Fi arc {i + 1}', arc(1113.5, 423.5, r, -137, -43), 1.45, cyan)
dot = on_fascia(.6)(1113.5, 424.6)
lathe('Wi-Fi dot', [(0, dot[2] - 2.8), (2, dot[2] - 2), (2.8, dot[2]), (2, dot[2] + 2), (0, dot[2] + 2.8)], dot[0], dot[1], cyan, 'Status panel', 24)
cloud = arc(1104.4, 476.8, 7.6, 90, 252, 14) + arc(1112.2, 468.3, 9.6, 188, 338, 16) + arc(1122.2, 477.1, 7.4, -66, 90, 14)
stroke('Cloud indicator', cloud, 1.45, cyan, closed=True)
stroke('Status ring', arc(1113.3, 525, 15, 0, 360, 48), 1.55, green)
stroke('Status tick', [(1106.3, 525.4), (1111.4, 530.3), (1121.3, 519.4)], 1.5, green)

# cool reflection at the fascia edge
def edge_spill(a, b):
    g = math.exp(-((b - 418) / 46) ** 2) * math.exp(-(1156 - a) / 7.5) if a < 1156 else 0
    return (.01 * g, .10 * g, .62 * g)


spill('Fascia edge reflection', 1122, 1156, 330, 520, edge_spill, .4, on_fascia, 24, 40, 'Status panel')

# ------------------------------------------------------------------- chambers
YC = 147.0      # chamber axis
BOXD = 292.0    # chamber depth


def X(px, y=YC): return unproject(px, HORIZON, y)[0]
def Z(py, y=YC, px=CAM[0]): return unproject(px, py, y)[2]


def span(a, b, y=YC):
    """Pixel interval to (centre, half width) at a depth."""
    return (X(a, y) + X(b, y)) / 2, (X(b, y) - X(a, y)) / 2


def zz(px, py, y=YC): return unproject(px, py, y)[2]


PROBES = {}


def stack(prefix, rows, mat, coll, ax, y=YC, lower=None):
    """Coaxial cylinders: (name, half-width px interval, top px, bottom px)."""
    for nm, a, b, t, btm in rows:
        _, r = span(a, b, y)
        cyl(f'{prefix} {nm}', r, zz((a + b) / 2, btm, y - r), zz((a + b) / 2, t, y - r), ax, y, mat if nm in ('head', 'coupling', 'neck') or not lower else lower, coll, b=1.8)
        if nm not in ('head', 'coupling'): PROBES.setdefault(coll, []).append(bpy.data.objects[f'{prefix} {nm}'])


def chamber(key, coll, d, seed):
    m = PAL[key]
    tag = 'Reference' if key == 'ref' else 'Test'
    rnd = random.Random(seed)
    # --- acrylic lid and body
    lx0, lx1 = X(d['lid'][0], 0), X(d['lid'][1], 0)
    bx0, bx1 = X(d['body'][0], 0), X(d['body'][1], 0)
    z_lid1, z_lid0 = zz(d['lid'][0] + 150, 249, 0), zz(d['lid'][0] + 150, 282, 0)
    z_body0 = H.DECK_Z - 4
    z_body1 = zz(d['body'][0] + 140, 285, 0)
    rbox(f'{tag} lid', lx0, lx1, 2, BOXD - 30, z_lid0, z_lid1, 16, m['lid'], coll, b=7, wall=4.5, ceil=4.5)
    rbox(f'{tag} chamber body', bx0, bx1, 0, BOXD, z_body0, z_body1, 13, m['box'], coll, b=5, wall=6, floor=4)
    # lit edges: acrylic pipes light out along its rims; the front outline is a rounded frame
    for nm, (a0, a1, yf, yb), (zt_, zb_), rr in (('lid', (lx0, lx1, 2, BOXD - 30), (z_lid1, z_lid0), 8.5), ('body', (bx0, bx1, 0, BOXD), (z_body1, z_body0 + 3), 12)):
        prof = rrect(a0 + 3, a1 - 3, zb_ + 2.5, zt_ - 2.5, rr, 8)
        for k, (yy, rad) in enumerate(((yf + 3, 2.7), (yb - 3, 1.2))):
            ring = [(x, yy, z) for x, z in prof]
            tube(f'{tag} {nm} frame {k + 1}', ring + ring[:2], rad, m['post'], coll, segs=12)
        for off in (-2.4, 2.4):
            ring = [(x, yf + .8, z) for x, z in rrect(a0 + 3 + off, a1 - 3 - off, zb_ + 2.5 + off, zt_ - 2.5 - off, rr - off, 8)]
            tube(f'{tag} {nm} glint {off:+.0f}', ring + ring[:2], .5, m['line'], coll, segs=8)
        for nz, zz_ in (('top', zt_ - 3), ('bottom', zb_ + 3)):
            for sx_, xx in (('left', a0 + 5), ('right', a1 - 5)):
                tube(f'{tag} {nm} {nz} {sx_} rail', [(xx, yf + 8, zz_), (xx, yb - 8, zz_)], 1.3, m['post'], coll, segs=8)
    # --- vessel
    cx, R = span(*d['cup'])
    z0, z1 = zz(d['axis'], 664, YC - R), zz(d['axis'], 343.5, YC)
    q = 17
    prof = [(0, z0), (R - q, z0)] + [(R - q + q * math.sin(t), z0 + q - q * math.cos(t)) for t in np.linspace(.15, math.pi / 2, 8)] + [(R, z1)]
    lathe(f'{tag} vessel', prof, cx, YC, m['cup'], coll, 160)
    torus(f'{tag} vessel rim', R, 1.25, z1, cx, YC, m['rim'], coll)
    torus(f'{tag} vessel inner rim', R - 5, .7, z1 - 1, cx, YC, m['waterline'], coll)
    torus(f'{tag} vessel base edge', R - 9, 2.0, z0 + 2.2, cx, YC, m['base'], coll)
    # --- culture medium
    zw = zz(d['axis'], 388, YC)
    ri = R - 4
    qi = q - 3
    wp = [(0, z0 + 4), (ri - qi, z0 + 4)] + [(ri - qi + qi * math.sin(t), z0 + 4 + qi - qi * math.cos(t)) for t in np.linspace(.15, math.pi / 2, 8)] + [(ri, zw), (0, zw)]
    nm, tint, deep, bright = m['liquid']
    liq = M.liquid(nm, tint, deep, bright, z0 * P, zw * P, body=.03, edge=.55, floor=.85, strength=1.0)
    lathe(f'{tag} culture medium', wp, cx, YC, liq, coll, 160)
    torus(f'{tag} meniscus', R - 2, .95, zw, cx, YC, m['waterline'], coll)
    # sleeve and plug disc that centre the vessel in the body
    sx, SR = span(*d['plug'])
    SR = min(SR, BOXD / 2 - 9)
    zp = zz(d['axis'], 298, YC)
    cyl(f'{tag} plug disc', SR, zp - 5, zp, sx, YC, m['box'], coll, b=1.5, segs=128)
    sleeve(f'{tag} sleeve', SR - 1, 2.5, z0 - 2, zp - 6, sx, YC, M_sleeve[key], coll, segs=128)
    zs = zz(d['axis'], 336, YC)
    torus(f'{tag} support ring', SR - 2, 1.0, zs, sx, YC, m['line'], coll)
    torus(f'{tag} plug disc edge', SR - .5, .8, zp - 1, sx, YC, m['line'], coll)
    torus(f'{tag} plug disc lower edge', SR - .5, .6, zp - 5, sx, YC, m['line'], coll)
    # --- illuminated base
    pr = span(*d['puck'])[1]
    zb0, zb1 = H.DECK_Z, z0 - 3
    cyl(f'{tag} light base', pr, zb0, zb1 - 2, cx, YC, m['puck'], coll, b=2, segs=128)
    torus(f'{tag} light base ring', pr + 1, 1.3, (zb0 + zb1) / 2 - 3, cx, YC, m['puck_glow'], coll)
    torus(f'{tag} light base top ring', pr - 4, 1.6, zb1, cx, YC, m['puck_glow'], coll)
    rbox(f'{tag} base tray', bx0 + 10, bx1 - 10, 12, BOXD - 12, zb0, zb0 + 9, 10, M_tray[key], coll, b=1.5)
    # --- DO probe assembly
    ax = X(d['axis'])
    stack(f'{tag} DO probe', d['probe'], black, coll, ax, lower=m['probe'])
    capa, capb = d['cap']
    _, cr = span(capa, capb)
    cyl(f'{tag} DO probe cable gland', cr, zz(d['axis'], 134, YC - cr), zz(d['axis'], d['cap_top'], YC - cr), ax, YC, d['cap_mat'], coll, b=2)
    for i, (a, b, t, btm) in enumerate(d['tabs']):
        tx, tr = span(a, b)
        rbox(f'{tag} probe clamp {i + 1}', tx - tr, tx + tr, YC - 13, YC + 13, zz(a, btm), zz(a, t), 4, black, coll, b=1.6)
    # --- temperature probe: slim sheath
    tx = X(d['temp'], YC + 45)
    cyl(f'{tag} temperature probe', 3.2, zz(d['temp'], 612, YC + 45), zp, tx, YC + 45, M_sheath[key], coll, b=3, segs=32)
    # --- label
    a, b, t, btm = d['label']
    yl = -3.2
    r = rrect(0, 1, 0, 1, .07)
    x0, x1 = X(a, yl), X(b, yl)
    zt, zl = zz((a + b) / 2, t, yl), zz((a + b) / 2, btm, yl)
    ring = rrect(x0, x1, zl, zt, 12, 8)
    nn = len(ring)
    v = [(x, yl, z) for x, z in ring] + [(x, -.4, z) for x, z in ring]
    o = add(f'{tag} label', v, [list(range(nn))[::-1] and list(range(nn))] + [[i, nn + i, nn + (i + 1) % nn, (i + 1) % nn] for i in range(nn)], m['label'], coll)
    bevel(o, .8, 2)
    tube(f'{tag} label edge', [(x, yl + .6, z) for x, z in ring + ring[:2]], .75, m['label_edge'], coll, segs=8)
    for (txt, box) in d['text']:
        place(f'{tag} label text {txt}', text_art(txt, reg), label_white, coll, box, lambda px, py: unproject(px, py, yl - .5))
    # --- bubbles
    def ball(x, y, z, r):
        prof = [(r * math.sin(t), z - r * math.cos(t)) for t in np.linspace(0, math.pi, 9)]
        prof[0] = (0, z - r); prof[-1] = (0, z + r)
        n, seg = len(prof), 14
        for i in range(seg):
            A = 2 * math.pi * i / seg
            for (rr, zc) in prof: BV.append((x + rr * math.cos(A), y + rr * math.sin(A), zc))
        o = len(BV) - n * seg
        for i in range(seg):
            j = (i + 1) % seg
            for k in range(n - 1):
                BF.append([o + i * n + k, o + j * n + k, o + j * n + k + 1, o + i * n + k + 1])
    BV, BF = [], []
    hgt = zw - z0
    for _ in range(210):
        low = rnd.random() < .36
        rad = (ri - 12) * math.sqrt(rnd.random())
        an = rnd.random() * 2 * math.pi
        h = (4 + abs(rnd.gauss(0, 13))) if low else 8 + (hgt - 50) * rnd.random() ** 1.45
        s = rnd.choice([1.0, 1.3, 1.6, 2.1, 2.8, 3.6, 4.6]) * (1.0 if h < 150 else .75)
        ball(cx + rad * math.cos(an), YC + rad * math.sin(an), z0 + 4 + s + h, s)
    for zpx, s in ((615, 6.0), (626, 7.4), (638, 6.6), (649, 8.5)):
        ball(ax, YC, zz(d['axis'], zpx), s)
    for _ in range(130):                     # fine fizz
        rad = (ri - 10) * math.sqrt(rnd.random()); an = rnd.random() * 2 * math.pi
        ball(cx + rad * math.cos(an), YC + rad * math.sin(an), z0 + 6 + (hgt - 40) * rnd.random() ** 2.2, .6 + .6 * rnd.random())
    for _ in range(95):                      # froth resting on the vessel floor
        rad = (ri - 14) * math.sqrt(rnd.random()); an = rnd.random() * 2 * math.pi; sz = 1.4 + 2.6 * rnd.random()
        ball(cx + rad * math.cos(an), YC + rad * math.sin(an), z0 + 5 + sz, sz)
    for _ in range(26):
        an = rnd.random() * 2 * math.pi; rr = 8 + 20 * rnd.random(); s = 1.6 + 2.6 * rnd.random()
        ball(ax + rr * math.cos(an), YC + rr * math.sin(an), z0 + 6 + s + 8 * rnd.random(), s)
    ob = add(f'{tag} bubbles', BV, BF, m['bubble'], coll)
    kit.weld(ob)
    # --- interior light
    for nmz, e, zl in (('glow', .03, (z0 + zw) / 2), ('head glow', .02, z1 + 25)):
        L = bpy.data.lights.new(f'{tag} {nmz}', 'POINT'); L.energy = e; L.color = m['light']; L.shadow_soft_size = .02
        lo = bpy.data.objects.new(L.name, L); lo.location = (cx * P, (YC + 60) * P, zl * P)
        lo.visible_glossy = False; lo.visible_transmission = False
        collection('Studio').objects.link(lo)
    grp = bpy.data.collections.new(f'{tag} probe light receivers')
    for o in PROBES[coll]: grp.objects.link(o)
    for nmz, off, zl, e in (('left', -95, z1 + 20, .5), ('right', 95, z1 + 20, .35), ('low', -60, z0 + 60, .35)):
        L = bpy.data.lights.new(f'{tag} probe light {nmz}', 'POINT'); L.energy = e * .8; L.color = m['light']; L.shadow_soft_size = .01
        lo = bpy.data.objects.new(L.name, L); lo.location = ((ax + off) * P, (YC - 60) * P, zl * P)
        lo.visible_glossy = False; lo.visible_transmission = False
        lo.light_linking.receiver_collection = grp
        collection('Studio').objects.link(lo)
    # corner latches
    for i, (a_, b_) in enumerate(d['latch']):
        q0, q1 = X(a_, 14), X(b_, 14)
        zt_, zb_ = zz(a_, 612, 14), zz(a_, 655, 14)
        rbox(f'{tag} latch {i + 1}', q0, q1, 8, 34, zb_, zt_, 5, fitting, coll, b=3, wall=2)
        cyl(f'{tag} latch pin {i + 1}', (q1 - q0) * .3, zb_ + 6, zt_ - 10, (q0 + q1) / 2, 21, m['latch'], coll, b=1.5, segs=32)
    return dict(m=m, tag=tag, z_lid1=z_lid1, z_lid0=z_lid0, ax=ax)


M_sleeve = {'ref': M.film('Sleeve blue', 'fdfeff', 1.2, edge='8fb8ff', edge_str=.16, edge_pow=7, body=.010, gloss=.5, shade='9ab4ea', shade_pow=5),
            'test': M.film('Sleeve green', 'fdfffe', 1.2, edge='8fe6b2', edge_str=.16, edge_pow=7, body=.008, gloss=.5, shade='a2dcbb', shade_pow=5)}
M_tray = {'ref': M.solid('Tray blue', '0a1f55', .2), 'test': M.solid('Tray green', '0d3524', .2)}
M_sheath = {'ref': M.film('Sheath blue', 'eef4ff', 1.4, edge='b9d8ff', edge_str=.12, gloss=.5),
            'test': M.film('Sheath green', 'eefaf2', 1.4, edge='b6f0cc', edge_str=.12, gloss=.5)}
cap_blue = M.glow_core('Gland translucent blue', '05070f', '1f5fe0', .55)

REF = dict(lid=(349, 674), body=(365, 646), cup=(395, 641), plug=(370, 648), puck=(405, 621), axis=514.5,
           cap=(501, 530), cap_top=91, cap_mat=cap_blue, temp=552,
           probe=[('head', 483.5, 548.5, 131, 179), ('coupling', 479, 546.5, 180.5, 231), ('neck', 484.5, 545, 230, 287),
                  ('collar', 475, 551, 285, 322), ('stem', 488, 537, 320, 365), ('sleeve', 495, 530, 364, 380), ('rod', 498, 527, 378, 607)],
           tabs=[(541, 554, 181, 232)], label=(415, 583, 391.5, 479.5),
           latch=[(368, 386), (627, 645)], text=[('Reference', (442, 412.5, 552.5, 432)), ('(Control)', (451, 441, 543.5, 463))])
TEST = dict(lid=(699, 1011), body=(714, 993), cup=(738, 974), plug=(716, 994), puck=(752, 958), axis=836,
            cap=(821, 851), cap_top=86, cap_mat=black, temp=876,
            probe=[('head', 802.5, 870.5, 128, 176.5), ('coupling', 805, 868, 178, 230), ('neck', 807, 869, 229, 285),
                   ('collar', 800, 880, 284, 320), ('stem', 814, 865, 318, 365), ('sleeve', 821, 858, 364, 378), ('rod', 825, 856, 377, 607)],
            tabs=[(792.5, 806, 180, 229), (866, 883, 178, 229)], label=(760.5, 925.5, 391, 479.5),
            latch=[(717, 735), (975, 992)], text=[('Test', (823, 413, 863.5, 431.5)), ('(Wastewater)', (785.5, 443, 901.5, 463))])
A = chamber('ref', 'Reference chamber', REF, 11)
B = chamber('test', 'Test chamber', TEST, 23)


LID = {'Reference chamber': (A['z_lid0'], A['z_lid1']), 'Test chamber': (B['z_lid0'], B['z_lid1'])}


# ------------------------------------------------------------ ports and tubing
def port(name, coll, a, b, t, btm, y, knurl=True):
    x, r = span(a, b, y)
    z0, z1 = zz((a + b) / 2, btm, y - r), zz((a + b) / 2, t, y - r)
    cyl(f'{name} cap', r, z0 + 5, z1, x, y, black, coll, b=2.2, segs=168, knurl=(24, r * .6, 1.3) if knurl else None)
    cyl(f'{name} flange', r + .6, z0, z0 + 6, x, y, black, coll, b=1)
    lt = LID[coll]
    cyl(f'{name} shank', r * .74, min(zz((a + b) / 2, 271, y - r), lt[1] - 3), z0 + 1, x, y, black, coll, b=1)
    return x, r, z0, z1


def clear(name, coll, a, b, t, btm, y, wall=2.2):
    x, r = span(a, b, y)
    zb = LID[coll][1] if 'clip' not in name and 'sleeve' not in name else zz((a + b) / 2, btm, y - r)
    sleeve(name, r, wall, zb, zz((a + b) / 2, t, y - r), x, y, fitting, coll)
    return x, r


M_lens = {'ref': M.film('LED lens blue', 'd9f0ff', 1.4, edge='5cc4ff', edge_str=.5, body=.28),
          'test': M.film('LED lens green', 'dcffe8', 1.4, edge='5cf09a', edge_str=.5, body=.26)}


def led(name, coll, a, b, t, btm, y, mat, hue):
    key = 'ref' if name.startswith('Ref') else 'test'
    x, r = span(a, b, y)
    z0, z1 = zz((a + b) / 2, btm, y - r), zz((a + b) / 2, t, y - r)
    o_led = cyl(name, r, z0, z1, x, y, mat, coll, b=3); o_led.visible_glossy = False
    cyl(name + ' lens', r + 3.5, z0 - 7, z0 - 1, x, y, M_lens[key], coll, b=2)
    sleeve(name + ' collar', r + 2, 1.5, z0 - 1, z1 + 6, x, y, M_lens[key], coll)
    L = bpy.data.lights.new(name + ' light', 'POINT'); L.energy = .03; L.color = hue; L.shadow_soft_size = .008
    o = bpy.data.objects.new(L.name, L); o.location = (x * P, (y - 4) * P, (z0 - 12) * P); o.visible_glossy = False; o.visible_transmission = False; collection('Studio').objects.link(o)


YF, YB = 96.0, 205.0
c, t = 'Reference chamber', 'Tubing'
hb, hg = PAL['ref']['light'], PAL['test']['light']
# reference: aeration elbow (black), sample line (clear), drain arch
x, r, z0, z1 = port('Reference aeration port', c, 425, 469, 209, 247, YF)
zt = zz(460, 151.5, YF)
tube('Reference aeration elbow', elbow([(x, YF, z1 - 4), (x, YF, zt), (A['ax'] - 20, YC - 20, zz(480, 151.5, YC - 20))], 23, 14), 9.3, black, t, segs=32)
led('Reference LED left', c, 430, 455, 269, 292, YF, PAL['ref']['led'], hb)
x2, r2 = clear('Reference sample fitting', c, 606, 633, 217, 250, YF + 25)
clear('Reference sample fitting clip', c, 604, 635, 222, 246, YF + 25)
zt2 = zz(560, 149.5, YC - 12)
sx2 = X(549)
tube('Reference sample line', elbow([(sx2 + 4, YC - 12, zt2), (x2, YF + 25, zt2), (x2, YF + 25, zz(620, 252, YF + 25))], 48, 18), 11.2, tubing, t, bore=7.6, segs=40)
cylx = tube('Reference sample spigot', [(A['ax'] + 20, YC - 13, zt2), (sx2 + 16, YC - 12.5, zt2)], 7.2, black, c)
tube('Reference sample ferrule', [(sx2 + 2, YC - 12.5, zt2), (sx2 + 15, YC - 12.5, zt2)], 12.8, fitting, c, bore=10.5, segs=40)
led('Reference LED right', c, 607, 627, 274, 288, YF + 25, PAL['ref']['led'], hb)
x3, r3, z03, z13 = port('Reference drain port', c, 645, 690.5, 213.5, 247, YB)
cyl('Reference drain spigot', span(656, 679, YB)[1], z13, zz(667, 198, YB), x3, YB, black, c)
clear('Reference drain sleeve', c, 649, 686.5, 170, 212.5, YB)


def arch(name, pix, y0, y1, r, bore, z_end):
    n = len(pix)
    pts = []
    for i, (a, b) in enumerate(pix):
        k = i / (n - 1)
        pts.append(unproject(a, b, y0 + (y1 - y0) * (k * k * (3 - 2 * k))))
    return tube(name, smooth_path(pts, 140, 60), r, tubing, t, bore=bore, segs=40)


arch('Reference drain line', [(515.5, 104), (517, 92), (524, 79), (538, 66), (558, 58), (583, 55.5), (610, 60), (634, 74), (651, 95), (661, 122), (666, 150), (667.5, 175), (667.8, 206)], YC, YB, 13.2, 8.6, 0)
cyl('Reference drain inner lead', 1.7, zz(667, 206, YB), zz(667, 158, YB), x3 - 1, YB, black, c, b=.8, segs=24)

c = 'Test chamber'
x, r = clear('Test sample fitting', c, 758, 791, 173, 246, YF)
cyl('Test sample core', span(769, 779, YF)[1], zz(774, 216, YF), zz(774, 201, YF), x, YF, black, c)
cyl('Test sample gland', span(764, 785, YF)[1], LID[c][1], zz(774, 215, YF), x, YF, black, c)
led('Test LED left', c, 762, 785, 269, 289, YF, PAL['test']['led'], hg)
port('Test rear port', c, 751, 795, 215, 246, YB + 10)
xe, re_ = span(916, 939, YF + 10)
zt = zz(900, 147.5, YF + 10)
tube('Test aeration elbow', elbow([(B['ax'] + 20, YC - 18, zz(870, 147.5, YC - 18)), (xe, YF + 10, zt), (xe, YF + 10, zz(930, 216, YF + 10))], 30, 14), 9.4, black, t, segs=32)
cyl('Test aeration core', span(915.5, 938, YF + 10)[1], LID[c][1] + 1, zz(927, 214.5, YF + 10), xe, YF + 10, black, c)
clear('Test aeration cover', c, 913, 945, 213, 250, YF + 10)
led('Test LED right', c, 917, 940, 268, 290, YF + 10, PAL['test']['led'], hg)
x4, r4, z04, z14 = port('Test drain port', c, 979, 1026, 209.5, 243, YB)
cyl('Test drain spigot', span(991, 1014, YB)[1], z14, zz(1002, 194, YB), x4, YB, black, c)
clear('Test drain sleeve', c, 983.5, 1021, 165, 208.5, YB)
arch('Test drain line', [(836, 100), (837, 88), (842, 74), (854, 59), (872, 46), (893, 39), (915, 37.5), (940, 42.5), (964, 57), (983, 80), (995, 110), (1000.5, 142), (1001.8, 172), (1002, 202)], YC, YB, 13.4, 8.8, 0)
arch('Test sample line', [(774, 206), (775, 176), (778, 146), (787, 112), (802, 84), (823, 61), (846, 49), (872, 45), (902, 48), (932, 58), (957, 76), (975, 102), (985, 132), (990, 165), (992, 202)], YF, YB + 24, 11.6, 7.8, 0)

# acrylic ledges that carry the rear drain ports just outboard of each lid
for nm, coll, d_, x_, r_ in (('Reference', 'Reference chamber', REF, x3, r3), ('Test', 'Test chamber', TEST, x4, r4)):
    l0, l1 = LID[coll]
    xe_ = X(d_['lid'][1], 0)
    if x_ + r_ + 5 > xe_ - 4:
        rbox(f'{nm} drain ledge', xe_ - 16, x_ + r_ + 7, YB - 34, YB + 34, l1 - 9, l1 - .5, 8, fitting, coll, b=2)

# lid fasteners
for nm, px, t0, t1, y, coll in (('Reference lid screw', 563, 258, 285, YC - 20, 'Reference chamber'), ('Test lid screw', 886, 249, 279, YC - 20, 'Test chamber'),
                                ('Reference lid stud', 467, 259, 279, YC + 30, 'Reference chamber'), ('Test lid stud', 796, 257, 280, YC + 30, 'Test chamber')):
    x = X(px, y)
    l0, l1 = LID[coll]
    cyl(nm, 3.6, l0 - 5, l1, x, y, black, coll, b=1, segs=24)
    cyl(nm + ' head', 6.5, l1, l1 + 6, x, y, black, coll, b=1, segs=24)

# -------------------------------------------------------------- level columns
shell_film = M.film('Column shell', 'fdfeff', 1.5, gloss=.5, shade='33487f', shade_pow=3.5)
shell_edge = M.film('Column shell edge', 'f0f4ff', 1.6, edge='cfdcff', edge_str=.2, body=.1)


def arched(name, x0, x1, y0, y1, z0, z1, coll, wall=3.4):
    """Clear capsule: round-topped in the front view, extruded in depth."""
    import bmesh
    r = min(20, (x1 - x0) * .47)
    bm = bmesh.new()
    def loop(ins, y):
        return [bm.verts.new((x, y, z)) for x, z in rrect(x0 + ins, x1 - ins, z0 + ins, z1 - ins, max(r - ins, 2), 10)]
    for ins, ya, yb in ((0, y0, y1), (wall, y0 + wall, y1 - wall)):
        a, b = loop(ins, ya), loop(ins, yb)
        for i in range(len(a)):
            j = (i + 1) % len(a)
            bm.faces.new([a[i], a[j], b[j], b[i]])
        bm.faces.new(a); bm.faces.new(b[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.verts.index_update()
    ob = add(name, [v.co[:] for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces], shell_film, coll)
    bm.free()
    bevel(ob, 2.6, 4)
    for k, yy in enumerate((y0 + .6, y1 - .6)):
        ring = [(x, yy, z) for x, z in rrect(x0 + .6, x1 - .6, z0 + .6, z1 - .6, r, 10)]
        tube(f'{name} edge {k + 1}', ring + ring[:2], .7, shell_edge, coll, segs=8)

def column(name, x0, x1, conn, rod, y, z_top=277, hue='ref', depth=46, dark_core=False):
    coll = 'Level columns'
    X0, X1 = X(x0, y), X(x1, y)
    xc, rc = span(*conn, y)
    pc = (conn[0] + conn[1]) / 2
    zf = lambda py: zz(pc, py, y)
    arched(f'{name} shell', X0, X1, y - depth / 2, y + depth / 2, H.DECK_Z + 5, zf(z_top), coll)
    for nm, t0, t1 in (('upper', 302, 337), ('lower', 616, 654)):
        cyl(f'{name} {nm} clamp', rc, zf(t1), zf(t0), xc, y, black, coll, b=1.8)
    for nm, k, t0, t1 in (('upper stub', .62, 290, 303), ('upper tip', .34, 284, 291), ('upper collar', .6, 336, 341),
                          ('lower collar', .6, 607, 617), ('lower stub', .66, 653, 662), ('lower tip', .4, 661, 673)):
        cyl(f'{name} {nm}', rc * k, zf(t1), zf(t0), xc, y, black, coll, b=1.2, segs=40)
    rr = span(*rod, y)[1]
    sleeve(f'{name} gauge tube', rr, 2.4, zf(610), zf(338), xc, y, M_gauge, coll)
    cyl(f'{name} gauge core', rr * .34, zf(610), zf(338), xc, y, black if dark_core else M_core, coll, b=.5, segs=24)
    cyl(f'{name} upper dome', rc * .8, zf(300), zf(281), xc, y, fitting, coll, b=11)
    cyl(f'{name} lower dome', rc * .8, zf(682), zf(657), xc, y, fitting, coll, b=10)
    cyl(f'{name} foot', rc * .66, H.DECK_Z - 5, zf(682), xc, y, black, coll, b=1.2)


M_gauge = M.film('Gauge tube', 'fcfdff', 1.5, gloss=1.2, shade='33467f', shade_pow=3)
M_core = M.film('Gauge fluid', 'f6f9ff', 1.33, shade='6f86c0', shade_pow=4)
column('Column left', 323.5, 369, (332, 362), (340.5, 359.5), 22)
column('Column centre', 675, 712, (677.5, 709), (686, 704), 18, z_top=275, dark_core=True)
column('Column right', 1016, 1061, (1018.5, 1056), (1030, 1054), 20, z_top=270, dark_core=True)
column('Column right rear', 1032, 1073, (1034, 1064), (1040, 1058), 78, z_top=272, depth=44)

# --------------------------------------------------------------------- studio
cd = bpy.data.cameras.new('Reference camera'); cam = bpy.data.objects.new('Reference camera', cd)
collection('Studio').objects.link(cam); scene.camera = cam
cam.location = [c_ * P for c_ in CAM]; cam.rotation_euler = (math.pi / 2, 0, YAW)
cd.sensor_width = 36; cd.lens = F / W * 36; cd.shift_y = (HORIZON - 512) / W; cd.clip_start = .01; cd.clip_end = 50


def area(name, loc, aim, size, energy, col=(1, 1, 1), sy=None):
    L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.color = col
    L.shape = 'RECTANGLE'; L.size = size * P; L.size_y = (sy or size) * P
    o = bpy.data.objects.new(name, L); collection('Studio').objects.link(o)
    from mathutils import Vector
    o.location = [k * P for k in loc]
    o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


area('Key left', (-1330, -520, 590), (-300, 30, 190), 540, 5.0, (1, .99, .98), 1300)
area('Top', (-100, 100, 1700), (0, 130, 300), 1500, 3.0, (.97, .98, 1))
area('Rim right', (1650, -420, 950), (330, 100, 330), 520, 3.7, (.86, .89, 1), 1200)
area('Front fill', (500, -2600, 900), (0, 0, 300), 1200, .22, (.95, .97, 1))
_bk = area('Back', (-300, 1500, 900), (-200, 200, 400), 1600, 2.2, (.97, .98, 1))

_bk.visible_glossy = False
ux = np.linspace(440, 930, 80); uz = np.linspace(6, 40, 12)
ob = add('Underglow', [(unproject(a_, 900, -78)[0], -78, z_) for z_ in uz for a_ in ux],
         [[j * 80 + i, j * 80 + i + 1, (j + 1) * 80 + i + 1, (j + 1) * 80 + i] for j in range(11) for i in range(79)], None, 'Studio')
ca = ob.data.color_attributes.new('glow', 'FLOAT_COLOR', 'POINT')
for k_, (z_, a_) in enumerate((z_, a_) for z_ in uz for a_ in ux):
    v_ = math.exp(-((z_ - 21) / 9) ** 2)
    mid = np.array([.10, .62, 1.0]) * 1.5 * math.exp(-((a_ - 680) / 75) ** 2)
    lo_ = np.array([.10, .30, 1.0]) * .55 * math.exp(-((a_ - 590) / 85) ** 2)
    hi_ = np.array([.16, .75, .42]) * .40 * math.exp(-((a_ - 815) / 45) ** 2)
    ca.data[k_].color = (*((mid + lo_ + hi_) * v_), 1)
N = M.Nodes('Underglow'); at = N.n('Attribute'); at.attribute_name = 'glow'; e_ = N.n('Emission'); N.l(at.outputs['Color'], e_.inputs['Color'])
ob.data.materials.append(N.done(N.addsh(N.transp(), e_.outputs[0])))
ob.visible_camera = False; ob.visible_transmission = False; ob.visible_diffuse = False; ob.visible_shadow = False
# the reference floor is washed blue in front of the light bar
gx, gy = np.linspace(330, 1130, 60), np.linspace(925, 1040, 30)
fv = [(lambda d: CAM + d * ((.4 - CAM[2]) / d[2]))(_ray(a_, b_)) for b_ in gy for a_ in gx]
ob = add('Floor wash', fv, [[j * 60 + i, (j + 1) * 60 + i, (j + 1) * 60 + i + 1, j * 60 + i + 1] for j in range(29) for i in range(59)], None, 'Studio')
ca = ob.data.color_attributes.new('wash', 'FLOAT_COLOR', 'POINT')
for k_, (b_, a_) in enumerate((b_, a_) for b_ in gy for a_ in gx):
    g_ = math.exp(-((a_ - 715) / 190) ** 2) * math.exp(-((b_ - 985) / 48) ** 2)
    g_ *= min(max((b_ - 926) / 14, 0), 1)
    c_ = np.array([1, 1, 1]) - g_ * np.array([.36, .09, 0]) * (1 - .45 * max(0, min(1, (a_ - 760) / 150)))
    ca.data[k_].color = (*c_, 1)
N = M.Nodes('Floor wash'); at = N.n('Attribute'); at.attribute_name = 'wash'; t = N.n('BsdfTransparent'); N.l(at.outputs['Color'], t.inputs['Color'])
ob.data.materials.append(N.done(t.outputs[0])); ob.visible_shadow = False

# contact shadow: the floor is self-lit, so occlusion under the device is baked from its footprint
gx, gy = np.linspace(-760, 700, 150), np.linspace(-260, 560, 90)
XX, YY = np.meshgrid(gx, gy)
fd, _ = H.footprint(XX, YY, np.full_like(XX, H.SEAM_Z), 14)
shade = 1 - .80 * np.exp(-np.maximum(fd, 0) / 13) - .16 * np.exp(-np.maximum(fd, 0) / 60)
ob = add('Contact shadow', np.stack([XX.ravel(), YY.ravel(), np.full(XX.size, .2)], 1),
         [[j * 150 + i, j * 150 + i + 1, (j + 1) * 150 + i + 1, (j + 1) * 150 + i] for j in range(89) for i in range(149)], None, 'Studio')
ca = ob.data.color_attributes.new('wash', 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set('color', np.stack([shade.ravel() * .99, shade.ravel(), np.minimum(shade.ravel() * 1.03, 1), np.ones(shade.size)], 1).astype(np.float32).ravel())
ob.data.materials.append(N.m); ob.visible_shadow = False

# floor fades into the backdrop
N = M.Nodes('Studio floor')
b = N.n('BsdfPrincipled'); b.inputs['Base Color'].default_value = M.lin('b6bac7'); b.inputs['Roughness'].default_value = .2; b.inputs['Specular IOR Level'].default_value = 1.0; b.inputs['Specular Tint'].default_value = (1, 1, 1, 1); b.inputs['Emission Color'].default_value = M.lin('e6e9f5'); b.inputs['Emission Strength'].default_value = .36
g = N.n('NewGeometry'); s = N.n('SeparateXYZ'); N.l(g.outputs['Position'], s.inputs[0])
mr = N.n('MapRange'); mr.interpolation_type = 'SMOOTHSTEP'; N.l(s.outputs['Y'], mr.inputs[0])
mr.inputs[1].default_value = 120 * P; mr.inputs[2].default_value = 560 * P; mr.inputs[3].default_value = 1; mr.inputs[4].default_value = 0
N.done(N.mix(mr.outputs[0], N.transp(), b.outputs[0]))
add('Studio floor', [(-3500, -3000, 0), (3500, -3000, 0), (3500, 1000, 0), (-3500, 1000, 0)], [[0, 1, 2, 3]], N.m, 'Studio', smooth=False)

def _plain_floor():
    N = M.Nodes('Studio floor plain')
    b = N.n('BsdfPrincipled'); b.inputs['Base Color'].default_value = M.lin('b4b8c5'); b.inputs['Roughness'].default_value = .25
    b.inputs['Emission Color'].default_value = M.lin('e6e9f5'); b.inputs['Emission Strength'].default_value = .42
    g = N.n('NewGeometry'); ln = N.n('VectorMath'); ln.operation = 'LENGTH'; N.l(g.outputs['Position'], ln.inputs[0])
    k = N.n('MapRange'); k.interpolation_type = 'SMOOTHSTEP'; N.l(ln.outputs['Value'], k.inputs[0])
    k.inputs[1].default_value = 600 * P; k.inputs[2].default_value = 1700 * P; k.inputs[3].default_value = 1; k.inputs[4].default_value = 0
    return N.done(N.mix(k.outputs[0], N.transp(), b.outputs[0]))


other = add('Studio floor (other views)', [(-9000, -9000, 0), (9000, -9000, 0), (9000, 9000, 0), (-9000, 9000, 0)], [[0, 1, 2, 3]],
            _plain_floor(), 'Studio', smooth=False)
other.hide_render = True; other.hide_viewport = True
w = bpy.data.worlds.new('Studio'); scene.world = w; w.use_nodes = True
t_ = w.node_tree; t_.nodes.clear()
nw = lambda k: t_.nodes.new('ShaderNode' + k)
o_ = nw('OutputWorld'); mixs = nw('MixShader'); lp = nw('LightPath')
bg1 = nw('Background'); bg2 = nw('Background')
bg1.inputs[0].default_value = M.lin('dfe3ef'); ml = nw('Math'); ml.operation = 'MULTIPLY_ADD'; t_.links.new(lp.outputs['Is Transmission Ray'], ml.inputs[0]); ml.inputs[1].default_value = .32; ml.inputs[2].default_value = .37; t_.links.new(ml.outputs[0], bg1.inputs[1])
tc = nw('TexCoord'); sp = nw('SeparateXYZ'); t_.links.new(tc.outputs['Window'], sp.inputs[0])


def ramp(stops, src):
    r = nw('ValToRGB'); t_.links.new(src, r.inputs[0])
    e = r.color_ramp.elements
    e[0].position, e[0].color = stops[0][0], M.lin(stops[0][1])
    e[1].position, e[1].color = stops[-1][0], M.lin(stops[-1][1])
    for p_, h_ in stops[1:-1]:
        k = e.new(p_); k.color = M.lin(h_)
    return r.outputs[0]


top = ramp([(0, 'e2e5f1'), (.35, 'd9dde9'), (.7, 'cdd2e0'), (1, 'bfc5d4')], sp.outputs['X'])
bot = ramp([(0, 'e9ecf7'), (.5, 'e6e9f4'), (1, 'dcdfec')], sp.outputs['X'])
mx = nw('MixRGB'); mp = nw('MapRange'); t_.links.new(sp.outputs['Y'], mp.inputs[0])
mp.inputs[1].default_value = .95; mp.inputs[2].default_value = .14
t_.links.new(mp.outputs[0], mx.inputs[0]); t_.links.new(top, mx.inputs[1]); t_.links.new(bot, mx.inputs[2])
t_.links.new(mx.outputs[0], bg2.inputs[0])
t_.links.new(lp.outputs['Is Camera Ray'], mixs.inputs[0]); t_.links.new(bg1.outputs[0], mixs.inputs[1]); t_.links.new(bg2.outputs[0], mixs.inputs[2])
t_.links.new(mixs.outputs[0], o_.inputs[0])

# --------------------------------------------------------------------- render
scene.render.engine = 'CYCLES'
scene.render.resolution_x, scene.render.resolution_y = 1536, 1024
cy = scene.cycles
cy.device = 'GPU'; cy.samples = 256; cy.use_denoising = True; cy.use_adaptive_sampling = True; cy.adaptive_threshold = .015
cy.max_bounces = 32; cy.transparent_max_bounces = 64; cy.transmission_bounces = 24; cy.glossy_bounces = 10; cy.diffuse_bounces = 4
cy.caustics_reflective = False; cy.caustics_refractive = False; cy.sample_clamp_indirect = 6
scene.view_settings.view_transform = 'Standard'

ng = bpy.data.node_groups.new('Finish', 'CompositorNodeTree'); scene.compositing_node_group = ng
ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
rl = ng.nodes.new('CompositorNodeRLayers'); gl = ng.nodes.new('CompositorNodeGlare'); go = ng.nodes.new('NodeGroupOutput')
gl.inputs['Type'].default_value = 'Bloom'; gl.inputs['Quality'].default_value = 'High'
gl.inputs['Threshold'].default_value = 1.0; gl.inputs['Strength'].default_value = .5; gl.inputs['Size'].default_value = .38
ng.links.new(rl.outputs['Image'], gl.inputs['Image']); ng.links.new(gl.outputs[0], go.inputs[0])

# extra views
from mathutils import Vector


def view(name, loc, aim, lens):
    d = bpy.data.cameras.new(name); o = bpy.data.objects.new(name, d); collection('Studio').objects.link(o)
    o.location = [k * P for k in loc]; o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    d.lens = lens; d.sensor_width = 36; d.clip_start = .01
    return o


view('Front camera', (0, -2500, 380), (0, 100, 420), 56)
view('Left camera', (-1750, -1750, 900), (10, 120, 400), 46)
view('Right camera', (2050, -1350, 620), (60, 130, 400), 46)
view('Rear camera', (900, 2500, 800), (0, 120, 400), 48)
view('Top camera', (350, -1500, 2100), (0, 120, 330), 50)
view('Chamber close-up camera', (-150, -1150, 520), (-110, 140, 430), 52)
view('Panel close-up camera', (900, -1000, 520), (330, 100, 400), 62)

bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('objects', len(bpy.data.objects), 'polys', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))
