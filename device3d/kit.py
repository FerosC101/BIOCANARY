"""Small modelling kit: every function takes reference-pixel units."""
import math
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
from camera import P, unproject

COLL = {}


def collection(name, parent=None):
    if name not in COLL:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
        COLL[name] = c
    return COLL[name]


def add(name, verts, faces, mat, coll, smooth=True, normals=None, angle=35):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(float(c) * P for c in v) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    me.update()
    if normals is not None:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
    elif smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.set_sharp_from_angle(angle=math.radians(angle))
    ob = bpy.data.objects.new(name, me)
    if mat:
        me.materials.append(mat)
    collection(coll).objects.link(ob)
    return ob


def bevel(ob, width, segs=3, angle=35):
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = width * P; m.segments = segs
    m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
    m.harden_normals = True
    return ob


def lathe(name, prof, cx, cy, mat, coll, segs=72, closed=False, knurl=None):
    """Revolve (r, z) points about a vertical axis at (cx, cy)."""
    verts, faces = [], []
    n = len(prof)
    for i in range(segs):
        a = 2 * math.pi * i / segs
        for (r, z) in prof:
            rr = r
            if knurl and r > knurl[1]:
                rr = r - knurl[2] * (0.5 + 0.5 * math.cos(knurl[0] * a)) ** 3
            verts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z))
    m = n if closed else n - 1
    for i in range(segs):
        j = (i + 1) % segs
        for k in range(m):
            l = (k + 1) % n
            q = [i * n + k, j * n + k, j * n + l, i * n + l]
            faces.append(q)
    ob = add(name, verts, faces, mat, coll)
    weld(ob)
    return ob


def weld(ob, d=1e-6):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d)
    bmesh.ops.dissolve_degenerate(bm, dist=d, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    ob.data.set_sharp_from_angle(angle=math.radians(35))


def cyl(name, r, z0, z1, cx, cy, mat, coll, b=1.2, segs=72, knurl=None):
    """Solid cylinder with softened rims."""
    b = min(b, r * .45, abs(z1 - z0) * .45)
    s = 0.2929 * b
    p = [(0, z0), (r - b, z0), (r - s, z0 + s), (r, z0 + b), (r, z1 - b), (r - s, z1 - s), (r - b, z1), (0, z1)]
    return lathe(name, p, cx, cy, mat, coll, segs, knurl=knurl)


def sleeve(name, r, t, z0, z1, cx, cy, mat, coll, segs=72, b=1.0):
    """Hollow cylinder (open both ends)."""
    p = [(r - t, z0), (r - b, z0), (r, z0 + b), (r, z1 - b), (r - b, z1), (r - t, z1)]
    return lathe(name, p, cx, cy, mat, coll, segs, closed=True)


def torus(name, R, r, z, cx, cy, mat, coll, segs=128):
    p = [(R + r * math.cos(a), z + r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 10, endpoint=False)]
    return lathe(name, p, cx, cy, mat, coll, segs, closed=True)


def rrect(x0, x1, y0, y1, r, n=8):
    pts = []
    for cx, cy, a0 in ((x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def rbox(name, x0, x1, y0, y1, z0, z1, r, mat, coll, b=2.0, wall=None, floor=None, ceil=None, segs=3):
    """Rounded box; `wall` makes it a tube, `floor`/`ceil` close its ends."""
    bm = bmesh.new()

    def ring(ix, z):
        rr = max(r - ix, 1.0)
        return [bm.verts.new((x, y, z)) for x, y in rrect(x0 + ix, x1 - ix, y0 + ix, y1 - ix, rr)]

    def skin(a, c, flip=False):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            f = [a[i], a[j], c[j], c[i]]
            bm.faces.new(f[::-1] if flip else f)

    o0, o1 = ring(0, z0), ring(0, z1)
    skin(o0, o1)
    if wall is None:
        bm.faces.new(o0[::-1]); bm.faces.new(o1)
    else:
        i0 = ring(wall, z0 + (floor or 0)); i1 = ring(wall, z1 - (ceil or 0))
        skin(i0, i1, True)
        if floor: bm.faces.new(o0[::-1]); bm.faces.new(i0)
        else: skin(i0, o0)
        if ceil: bm.faces.new(o1); bm.faces.new(i1[::-1])
        else: skin(o1, i1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()
    ob = add(name, [v.co[:] for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces], mat, coll)
    bm.free()
    if b: bevel(ob, b, segs)
    return ob


def catmull(pts, per=14):
    pts = [np.array(p, float) for p in pts]
    e = [2 * pts[0] - pts[1]] + pts + [2 * pts[-1] - pts[-2]]
    out = []
    for i in range(1, len(e) - 2):
        a, b, c, d = e[i - 1:i + 3]
        # centripetal parametrisation avoids overshoot on uneven points
        t0 = 0; t1 = t0 + max(np.linalg.norm(b - a), 1e-6) ** .5
        t2 = t1 + max(np.linalg.norm(c - b), 1e-6) ** .5
        t3 = t2 + max(np.linalg.norm(d - c), 1e-6) ** .5
        for t in np.linspace(t1, t2, per, endpoint=False):
            A1 = (t1 - t) / (t1 - t0) * a + (t - t0) / (t1 - t0) * b
            A2 = (t2 - t) / (t2 - t1) * b + (t - t1) / (t2 - t1) * c
            A3 = (t3 - t) / (t3 - t2) * c + (t - t2) / (t3 - t2) * d
            B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2
            B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3
            out.append((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2)
    out.append(pts[-1])
    return np.array(out)


def smooth_path(pts, n=110, it=40):
    """Resample evenly, then relax with both end tangents held."""
    p = catmull(pts)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    u = np.linspace(0, s[-1], n)
    q = np.stack([np.interp(u, s, p[:, k]) for k in range(3)], -1)
    for _ in range(it):
        q[2:-2] = .25 * q[1:-3] + .5 * q[2:-2] + .25 * q[3:-1]
    return q


def elbow(pts, r, n=10):
    """Polyline with filleted corners."""
    pts = [np.array(p, float) for p in pts]
    out = [pts[0]]
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        u, v = (a - b) / np.linalg.norm(a - b), (c - b) / np.linalg.norm(c - b)
        p0, p1 = b + u * r, b + v * r
        for t in np.linspace(0, 1, n):
            # circular-ish quarter arc
            w = math.pi / 2 * t
            out.append(b + u * r * (1 - math.sin(w)) + v * r * (1 - math.cos(w)))
    out.append(pts[-1])
    return np.array(out)


def tube(name, path, r, mat, coll, bore=None, segs=28, flat=None):
    """Sweep a circle along a path; `bore` adds an inner wall."""
    path = np.asarray(path, float)
    tan = np.gradient(path, axis=0)
    tan /= np.maximum(np.linalg.norm(tan, axis=1, keepdims=True), 1e-9)
    up = np.array([0, 1.0, 0])
    if abs(tan[0] @ up) > .9: up = np.array([1.0, 0, 0])
    nrm = up - tan[0] * (up @ tan[0]); nrm /= np.linalg.norm(nrm)
    verts, faces = [], []
    radii = [r] + ([bore] if bore else [])
    for i, (p, t) in enumerate(zip(path, tan)):
        nrm = nrm - t * (nrm @ t); nrm /= np.linalg.norm(nrm)
        b = np.cross(t, nrm)
        for rr in radii:
            for k in range(segs):
                a = 2 * math.pi * k / segs
                verts.append(p + rr * (math.cos(a) * nrm + math.sin(a) * b))
    m = segs * len(radii)
    for i in range(len(path) - 1):
        for q in range(len(radii)):
            for k in range(segs):
                l = (k + 1) % segs
                f = [i * m + q * segs + k, i * m + q * segs + l, (i + 1) * m + q * segs + l, (i + 1) * m + q * segs + k]
                faces.append(f if q == 0 else f[::-1])
    for i, fl in ((0, 1), (len(path) - 1, 0)):
        if bore:
            for k in range(segs):
                l = (k + 1) % segs
                f = [i * m + k, i * m + segs + k, i * m + segs + l, i * m + l]
                faces.append(f if fl else f[::-1])
        else:
            f = [i * m + k for k in range(segs)]
            faces.append(f[::-1] if fl else f)
    ob = add(name, verts, faces, mat, coll)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    return ob


# --- flat artwork ----------------------------------------------------------
def _curve_mesh(curve_obs, depth=0.0):
    """Evaluate curve objects to one (verts, faces) pair in their own plane."""
    V, Fc = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in curve_obs:
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        o = len(V)
        V += [(ob.matrix_world @ v.co)[:] for v in me.vertices]
        Fc += [[o + i for i in p.vertices] for p in me.polygons]
        bpy.data.meshes.remove(me)
    return np.array(V), Fc


def svg_art(path):
    before = set(bpy.data.objects)
    cb = set(bpy.data.collections)
    bpy.ops.import_curve.svg(filepath=path)
    obs = [o for o in bpy.data.objects if o not in before]
    for o in obs:
        o.data.resolution_u = 6
    bpy.context.view_layer.update()
    v, f = _curve_mesh(obs)
    for o in obs: bpy.data.objects.remove(o)
    for c in set(bpy.data.collections) - cb: bpy.data.collections.remove(c)
    return v[:, :2], f


def text_art(body, font, spacing=1.0):
    cu = bpy.data.curves.new('t', 'FONT')
    cu.body = body; cu.font = font; cu.align_x = 'CENTER'; cu.resolution_u = 8
    cu.space_character = spacing
    ob = bpy.data.objects.new('t', cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    v, f = _curve_mesh([ob])
    bpy.data.objects.remove(ob)
    return v[:, :2], f


def place(name, art, mat, coll, box, to3d, fit='xy'):
    """Map flat art onto a surface. `box` = (x0, y0, x1, y1) in pixels;
    `to3d(px, py)` returns the surface point."""
    v, f = art
    lo, hi = v.min(0), v.max(0)
    x0, y0, x1, y1 = box
    u = (v[:, 0] - lo[0]) / (hi[0] - lo[0])
    w = (v[:, 1] - lo[1]) / (hi[1] - lo[1])
    if fit == 'x':                       # keep aspect, centre vertically
        h = (hi[1] - lo[1]) / (hi[0] - lo[0]) * (x1 - x0)
        c = (y0 + y1) / 2; y0, y1 = c - h / 2, c + h / 2
    pts = [to3d(x0 + a * (x1 - x0), y1 - b * (y1 - y0)) for a, b in zip(u, w)]
    return add(name, pts, f, mat, coll, smooth=False)
