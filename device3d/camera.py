"""Reference camera, recovered from the product image.

All modelling is done in "reference pixels": 1 unit is one pixel of the
1536 x 1024 reference at the plane Y = 0 on the optical axis. `P` converts to
metres. X is right, Y is away from the viewer, Z is up, floor at Z = 0.
"""
import math
import numpy as np

W, H = 1536, 1024
P = 0.0005            # metres per reference pixel (device is about 0.5 m wide)
F = 2500.0            # focal length and camera distance, in pixels
YAW = math.radians(7.5)
CX, HORIZON = 768.0, 570.0

FWD = np.array([-math.sin(YAW), math.cos(YAW), 0.0])
RIGHT = np.array([math.cos(YAW), math.sin(YAW), 0.0])
UP = np.array([0.0, 0.0, 1.0])


def _ray(px, py):
    return F * FWD + (px - CX) * RIGHT + (HORIZON - py) * UP


_c = np.array([F * math.sin(YAW), -F * math.cos(YAW), 0.0])
# camera height: the front-right foot touches the floor at pixel (1025, 930)
_d = _ray(1025, 930)
_t = (-20 - _c[1]) / _d[1]
CAM = np.array([_c[0], _c[1], -_t * _d[2]])


def unproject(px, py, y=0.0):
    """World point seen at a pixel, on the plane Y = y."""
    d = _ray(px, py)
    return CAM + d * ((y - CAM[1]) / d[1])


def unproject_plane(px, py, point, normal):
    d = _ray(px, py)
    n = np.asarray(normal, float)
    return CAM + d * (np.dot(np.asarray(point, float) - CAM, n) / np.dot(d, n))


def project(p):
    q = np.asarray(p, float) - CAM
    w = q @ FWD
    return np.stack([CX + F * (q @ RIGHT) / w, HORIZON - F * (q @ UP) / w], -1)
