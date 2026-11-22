"""White enclosure, dark fascia/deck and dark plinth, as signed-distance solids.

The enclosure has large blended radii that meet along an S-curve, which is
awkward to bevel but simple to describe as a distance field. Each solid is
polygonised with OpenVDB, then every vertex is snapped back onto the exact
surface and given the exact analytic normal.
"""
import math
import numpy as np
from camera import CAM, unproject, _ray

# --- principal dimensions, reference pixels -------------------------------
SEAM_Z = 40.0
DECK_Z = 226.0
ROOF_Z = 626.0
FRONT_Y = -30.0             # at deck height
DRAFT = 0.165               # the front and left walls lean outwards
TOWER_Y = 166.0
BAY_X, BAY_Y = 262.0, 312.0 # chamber bay: everything left of / in front of this
BACK_Y = 402.0
SPLAY_R = math.radians(25)
SPLAY_L = math.radians(10)
REAR_LEFT_X = -372.0

_R0 = unproject(1092, 780, -40)


def rint(a, b, r):
    """Intersection with a rounded edge of radius r."""
    u, v = np.maximum(r + a, 0), np.maximum(r + b, 0)
    return np.minimum(-r, np.maximum(a, b)) + np.sqrt(u * u + v * v)


def rsub(a, b, r):
    return rint(a, -b, r)


def footprint(x, y, z, inset=0.0):
    k = 1 / math.sqrt(1 + DRAFT ** 2)
    front = -(y - FRONT_Y + DRAFT * (DECK_Z - np.minimum(z, DECK_Z))) * k + inset
    xl = -503 - 0.19 * (DECK_Z - np.minimum(z, DECK_Z))
    left = -((x - xl) * math.cos(SPLAY_L) + (y - FRONT_Y) * math.sin(SPLAY_L)) * k + inset
    right = ((x - _R0[0]) * math.cos(SPLAY_R) - (y - _R0[1]) * math.sin(SPLAY_R)) + inset
    back = y - BACK_Y + inset
    d = rint(front, left, max(52 - inset, 6))
    d = rint(d, right, max(100 - inset, 8))
    d = rint(d, back, max(28 - inset, 6))
    return d, right


def envelope(x, y, z, inset=0.0, bottom=SEAM_Z):
    d, right = footprint(x, y, z, inset)
    roof = z - ROOF_Z + inset
    # the roof-to-wall corner is generous; roof-to-back is tight
    corner = rint(roof, right, max(74 - inset, 8))
    d = np.maximum(rint(d, roof, 10), corner)   # max, not round: both contain the right wall
    if bottom is not None:
        d = np.maximum(d, (bottom - 12) - z)   # trimmed to the seam plane later
    return d


def s_cut(y, z):
    """Region in front of the S profile (negative inside), constant in X."""
    deck = DECK_Z - z
    tower = y - TOWER_Y
    a = math.radians(40)
    ramp = (y - 134) * math.sin(a) - (z - 284) * math.cos(a)
    return rint(rint(deck, ramp, 70), tower, 36)


def bay_cut(x, y, z):
    return rint(rint(DECK_Z - z, y - BAY_Y, 14), x - BAY_X, 14)


def left_cut(x, y, z):
    return rint(DECK_Z - z, x - REAR_LEFT_X, 14)


def shell(x, y, z):
    d = envelope(x, y, z)
    d = rsub(d, s_cut(y, z), 11)
    d = rsub(d, bay_cut(x, y, z), 7)
    d = rsub(d, left_cut(x, y, z), 9)
    d = rsub(d, pocket(x, y, z), 2.6)
    return d


def pocket(x, y, z, depth=11.0, margin=0.0):
    c = s_cut(y, z)
    lean = 1.6 * np.clip(c, 0, depth)          # chamfered bezel
    inner, right = footprint(x, y, z, 16 + margin)
    right_in = right + 3.5 + margin + lean
    inner = np.maximum(inner, right_in)
    corner = rint(z - ROOF_Z + 11 + margin + lean, right + 3.5 + margin + lean, 58)
    inner = np.maximum(inner, corner)
    fascia = np.maximum(c - depth, (BAY_X + 8 + margin) - x)
    deck = np.maximum(np.maximum(DECK_Z - depth - z, z - DECK_Z - 4), y - (BAY_Y - 6 - margin))
    return np.maximum(inner, np.minimum(fascia, deck))


def panel(x, y, z):
    """Dark glass sheet lining the pocket."""
    inner, right = footprint(x, y, z, 13)
    inner = np.maximum(inner, right + 10)
    corner = rint(z - ROOF_Z + 20, right + 10, 54)
    inner = np.maximum(inner, corner)
    c = s_cut(y, z)
    fascia = np.maximum(np.maximum(c - 16, 8.0 - c), (BAY_X + 4) - x)
    deck = np.maximum(np.maximum(z - (DECK_Z - 6.5), (DECK_Z - 16) - z), np.maximum(y - BAY_Y + 4, x - BAY_X - 6))
    return rint(inner, np.minimum(fascia, deck), 1.5)


def plinth(x, y, z):
    seam = SEAM_Z + 0.036 * (y + 60)
    d, _ = footprint(x, y, np.maximum(z, SEAM_Z), 2.2)
    # vertical for the first few units, then tucked under
    tuck = np.maximum(0, 26 - z) * 0.62
    d = (d + tuck) * 0.85
    d = rint(d, 5.0 - z, 6)
    return rint(d, z - (seam + 7), 1.2)


def march(f, px, py, start=1500.0, stop=4200.0):
    """First surface hit along the camera ray through a pixel."""
    d = _ray(px, py)
    d = d / np.linalg.norm(d)
    t = start
    for _ in range(400):
        p = CAM + d * t
        s = float(f(*[np.array(c) for c in p]))
        if s < 0.02:
            return p
        t += max(0.02, s * 0.6)
        if t > stop:
            return None
    return p


def normal(f, p, h=0.4):
    p = np.atleast_2d(p)
    g = []
    for i in range(3):
        e = np.zeros(3); e[i] = h
        q, r = p + e, p - e
        g.append(f(q[:, 0], q[:, 1], q[:, 2]) - f(r[:, 0], r[:, 1], r[:, 2]))
    g = np.stack(g, -1)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def polygonise(f, lo, hi, voxel):
    import openvdb as vdb
    ax = [np.arange(l, h, voxel, dtype=np.float32) for l, h in zip(lo, hi)]
    x, y, z = np.meshgrid(*ax, indexing='ij', sparse=False)
    band = 3 * voxel
    v = np.clip(f(x, y, z), -band, band).astype(np.float32)
    grid = vdb.FloatGrid(background=band)
    grid.copyFromArray(v)
    pts, quads = grid.convertToQuads(0.0)
    pts = np.asarray(pts, float) * voxel + np.array(lo)
    for _ in range(5):                       # snap to the exact surface
        s = f(pts[:, 0], pts[:, 1], pts[:, 2])
        pts = pts - normal(f, pts) * np.clip(s, -voxel, voxel)[:, None] * 0.9
    return pts, np.asarray(quads), normal(f, pts)


SEAM_SLOPE = 0.036
SEAM_POINT = (0.0, -60.0, SEAM_Z)


def bezel_mask(x, y, z):
    """Positive on the chamfer between the fascia and the white rim."""
    c = s_cut(y, z)
    return np.minimum(np.minimum(c - 1.1, 12.5 - c), np.minimum(x - (BAY_X + 8), 2.5 - pocket(x, y, z)))
