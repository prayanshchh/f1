import math

import bpy
import numpy as np

from body import rim_height
from design import HEAD, HEAD_RADIUS
from shapes import PARTS, both, box, closed_curve, lathe, loft, open_curve, plate, superellipse, sweep, to_blender, tube, wing

WHEEL_X = 0.535
WHEEL_Z = 0.600
WHEEL_SCALE = 0.88
WHEEL_TILT = math.radians(14)
FACE_WIDTH = 0.17
FACE_HEIGHT = 0.115
VOXEL = 0.002
HAND_LIFT = 0.03
MIRROR_X = 0.622
MIRROR_Z = 0.682
MIRROR_INNER = 0.215
MIRROR_OUTER = 0.670
MIRROR_Y = 0.525
MIRROR_GLASS = 0.125
MIRROR_TALL = 0.030
MIRROR_TILT = 0.55
MIRROR_SLANT = 0.09
HALO_APEX = 0.585
HALO_APEX_Z = 0.838
HALO_SLOPE = 0.22
HALO_WIDTH = 0.30
HALO_ARC = 0.405
HALO_REAR = -0.05
PILLAR_THIN = 0.60
PILLAR_WIDTH = 0.0115
PILLAR_FLARE = 0.150
BUTTONS = [
    (0.086, 0.058, 0.0085),
    (0.100, 0.026, 0.0085),
    (0.090, -0.006, 0.0085),
    (0.092, -0.040, 0.0085),
    (0.074, -0.074, 0.0085),
    (-0.086, 0.058, 0.0085),
    (-0.100, 0.026, 0.0085),
    (-0.090, -0.006, 0.0085),
    (-0.092, -0.040, 0.0085),
    (-0.074, -0.074, 0.0085),
]
ROTARIES = [(0.050, -0.066, 0.0165), (-0.050, -0.066, 0.0165)]
DIAL = (0.0, -0.075, 0.0235)
LED_PITCH = 0.009


def wheel_point(x, y, z):
    c = math.cos(WHEEL_TILT)
    s = math.sin(WHEEL_TILT)
    x, y, z = x * WHEEL_SCALE, y * WHEEL_SCALE, z * WHEEL_SCALE
    return (WHEEL_X + x * c + z * s, y, WHEEL_Z - x * s + z * c)


def wheel_plane(co):
    c = math.cos(WHEEL_TILT)
    s = math.sin(WHEEL_TILT)
    y, px, pz = co.x, -co.y, co.z
    return y / WHEEL_SCALE, ((px - WHEEL_X) * s + (pz - WHEEL_Z) * c) / WHEEL_SCALE


def plan_uv(obj):
    mesh = obj.data
    layer = mesh.uv_layers.active.data
    for polygon in mesh.polygons:
        for loop in polygon.loop_indices:
            y, z = wheel_plane(mesh.vertices[mesh.loops[loop].vertex_index].co)
            layer[loop].uv = ((FACE_WIDTH - y) / (2 * FACE_WIDTH), (FACE_HEIGHT + z) / (2 * FACE_HEIGHT))


def wheel_loft(name, rings, material_name, **options):
    return loft(name, rings, group="steering-wheel", material_name=material_name, atlas=False, **options)


def disc_rings(y, z, radius, profile, points=28):
    ring = superellipse(1.0, 1.0, 2.0, points)
    return [np.array([wheel_point(-lift, y + p[0] * radius * scale, z + p[1] * radius * scale) for p in ring]) for lift, scale in profile]


def hoop_height(x):
    return HALO_APEX_Z - HALO_SLOPE * (HALO_APEX - x)


def hoop_offset(y):
    across = min(abs(y) / HALO_WIDTH, 0.985)
    x = HALO_APEX - HALO_ARC * (1 - math.sqrt(1 - across * across))
    return x - HALO_APEX, hoop_height(x) - HALO_APEX_Z


def hoop_path():
    front = np.radians(np.linspace(90, 0, 36))
    arc = [
        (HALO_APEX - HALO_ARC + HALO_ARC * math.cos(t), HALO_WIDTH * math.sin(t), hoop_height(HALO_APEX - HALO_ARC + HALO_ARC * math.cos(t)))
        for t in front
    ]
    side = HALO_WIDTH + 0.006
    rear = [
        (-0.115, side - 0.012, 0.665),
        (-0.09, side - 0.006, hoop_height(-0.09) - 0.016),
        (HALO_REAR, side, hoop_height(HALO_REAR)),
        (0.12, HALO_WIDTH + 0.003, hoop_height(0.12)),
    ]
    half = np.array(rear + arc)
    other = half[-2::-1] * np.array([1, -1, 1])
    return open_curve(np.concatenate([half, other], axis=0), 150)


def halo():
    path = hoop_path()
    t = np.abs(path[:, 1]) / HALO_WIDTH
    behind = np.clip((0.25 - path[:, 0]) / 0.35, 0, 1)
    loft("halo-hoop", sweep(path, 0.042 + 0.004 * behind, 0.0170 + 0.009 * behind, 2.8, 32), density=3.0)
    spine = open_curve(np.array([(0.905, 0.0, 0.622), (0.82, 0.0, 0.690), (0.735, 0.0, 0.760), (0.680, 0.0, 0.815), (0.620, 0.0, 0.838)]), 80)
    tangents = np.gradient(spine, axis=0)
    tangents /= np.linalg.norm(tangents, axis=-1, keepdims=True)
    normals = np.stack([-tangents[:, 2], np.zeros(80), tangents[:, 0]], axis=-1)
    profile = superellipse(1.0, 1.0, 2.6, 36)
    rings = []
    for i, s in enumerate(np.linspace(0, 1, 80)):
        flare = max(0.0, (s - PILLAR_THIN) / (1 - PILLAR_THIN))
        foot = max(0.0, 1 - s / 0.14)
        half = PILLAR_WIDTH + 0.012 * foot**2 + PILLAR_FLARE * flare**2.6
        thick = 0.0105 + 0.004 * foot + 0.009 * flare
        blend = flare**2 * (3 - 2 * flare)
        ring = []
        for a, b in profile:
            y = half * a
            dx, dz = hoop_offset(y)
            point = spine[i] + normals[i] * thick * b
            ring.append((point[0] + dx * blend, y, point[2] + dz * blend))
        rings.append(ring)
    loft("halo-pillar", np.asarray(rings), density=2.4)
    collar = []
    for x, z, w, h in ((0.950, 0.612, 0.040, 0.018), (0.925, 0.630, 0.034, 0.018), (0.900, 0.650, 0.026, 0.016), (0.880, 0.668, 0.018, 0.012)):
        ring = superellipse(w, h, 3.0, 28, (0.0, z))
        collar.append(np.stack([np.full(28, x), ring[:, 0], ring[:, 1]], axis=-1))
    loft("halo-collar", collar, density=1.2)
    box_rings = []
    for x, scale in ((1.015, 0.82), (1.005, 1.0), (0.965, 1.0), (0.950, 0.92)):
        ring = superellipse(0.0165 * scale, 0.021 * scale, 4.5, 28, (0.0, 0.640))
        box_rings.append(np.stack([np.full(28, x), ring[:, 0], ring[:, 1]], axis=-1))
    loft("camera-pod", box_rings, material_name="headrest", atlas=False)
    lens = superellipse(0.0085, 0.0085, 2.0, 18, (0.0, 0.642))
    loft("camera-lens", [np.stack([np.full(18, x), lens[:, 0], lens[:, 1]], axis=-1) for x in (0.949, 0.945)], material_name="lens", atlas=False)
    pod = []
    for x, scale in ((0.675, 0.45), (0.660, 0.92), (0.625, 1.0), (0.606, 0.92), (0.595, 0.68), (0.590, 0.28)):
        ring = superellipse(0.019 * scale, 0.021 * scale, 3.4, 28, (0.0, 0.786))
        pod.append(np.stack([np.full(28, x), ring[:, 0], ring[:, 1]], axis=-1))
    loft("halo-pod", pod, material_name="headrest", atlas=False)
    tube("antenna", [(1.20, 0.0, 0.575), (1.19, 0.0, 0.70)], 0.0016, samples=6, points=8, material_name="titanium", atlas=False, up=(1, 0, 0))


def cockpit_pads():
    half = [(0.34, 0.268), (0.12, 0.270), (-0.02, 0.258), (-0.125, 0.168), (-0.160, 0.0), (-0.05, 0.0), (-0.03, 0.118), (0.05, 0.166), (0.34, 0.170)]
    path = closed_curve(half, 60)
    tops = np.array([rim_height(p[0], p[1]) + 0.004 for p in path])
    rings = [np.stack([path[:, 0], path[:, 1], tops + lift], axis=-1) for lift in (-0.03, 0.0)]

    both("cockpit-pad", rings, density=1.0)


def tub():
    outline = np.array([(0.72, 0.0), (0.66, 0.135), (0.46, 0.245), (0.20, 0.265), (-0.02, 0.255), (-0.125, 0.16), (-0.155, 0.0)])
    full = np.concatenate([outline, outline[-2:0:-1] * np.array([1, -1])], axis=0)
    path = closed_curve(full, 72)
    rings = []
    centre = path.mean(axis=0)
    rim = np.array([rim_height(p[0], p[1]) for p in path])
    for lift, scale in ((0.0, 1.0), (-0.05, 1.0), (-0.28, 0.98), (-0.48, 0.90)):
        ring = centre + (path - centre) * scale
        rings.append(np.stack([ring[:, 0], ring[:, 1], rim + lift], axis=-1))
    loft("tub", rings, caps=(False, True), material_name="cockpit", density=0.5)


def headrest():
    outline = np.array([(0.090, 0.0), (0.075, 0.13), (-0.03, 0.262), (-0.135, 0.19), (-0.165, 0.0)])
    full = np.concatenate([outline, outline[-2:0:-1] * np.array([1, -1])], axis=0)
    ring = closed_curve(full, 64)
    rings = []
    for z, scale in ((0.54, 1.0), (0.68, 1.0), (0.715, 0.97), (0.725, 0.90)):
        pts = ring * scale
        rings.append(np.stack([pts[:, 0], pts[:, 1], np.full(64, z)], axis=-1))
    rings = np.asarray(rings)
    mask = rings[..., 0] > -0.04
    inner = np.linalg.norm(rings[..., 1:2], axis=-1) < 0.14
    rings[..., 2] = np.where(mask & inner, rings[..., 2] - 0.20, rings[..., 2])
    loft("headrest", rings, caps=(False, True), material_name="headrest", atlas=False)


def mirror_ring(y, side):
    t = (y - MIRROR_INNER) / (MIRROR_OUTER - MIRROR_INNER)
    housing = np.clip((t - 0.22) / 0.12, 0, 1)
    tip = max(1 - max(0.0, (t - 0.975) / 0.025) ** 2, 0.02) ** 0.5
    tall = (0.0080 + (MIRROR_TALL + 0.0065 - 0.0080) * housing * housing * (3 - 2 * housing)) * tip
    chord = (0.034 + 0.030 * housing) * tip
    rear = MIRROR_X + MIRROR_SLANT * (MIRROR_Y - y) + 0.016 * (1 - housing)
    ring = superellipse(1.0, 1.0, 2.5 + 2.5 * housing, 36)
    px = rear + chord + chord * ring[:, 0]
    front = np.clip(ring[:, 0], 0, 1)
    px = px - 0.022 * t * front
    z = MIRROR_Z - 0.010 * (1 - t) + 0.010 * t * t
    pz = z + tall * ring[:, 1]
    return np.stack([px + MIRROR_TILT * housing * (pz - z), np.full(36, side * y), pz], axis=-1)


def mirrors():
    for side, name in ((1, "l"), (-1, "r")):
        stations = np.linspace(MIRROR_INNER, MIRROR_OUTER, 64)
        loft(f"mirror-housing.{name}", [mirror_ring(y, side) for y in stations], density=2.2)
        centre = side * MIRROR_Y
        glass = superellipse(MIRROR_GLASS, MIRROR_TALL, 9.0, 72)
        frame = superellipse(MIRROR_GLASS + 0.004, MIRROR_TALL + 0.0035, 9.0, 72)
        back = MIRROR_X - 0.0065

        def face(points, depth):
            lift = points[:, 1]
            return np.stack([back + depth + MIRROR_TILT * lift - MIRROR_SLANT * side * points[:, 0], centre + points[:, 0], MIRROR_Z + 0.002 + lift], axis=-1)

        loft(f"mirror-frame.{name}", [face(frame, 0.012), face(frame * np.array([0.99, 0.98]), -0.0015), face(glass, -0.001)], caps=(False, False), density=1.0)
        loft(
            f"mirror-glass.{name}",
            [face(glass, 0.002), face(glass * 0.998, -0.0005)],
            material_name=f"mirror-{name}",
            atlas=False,
            caps=(False, True),
            sharp_angle=math.radians(25),
        )
        rings = []
        for t in np.linspace(0, 1, 36):
            top = MIRROR_Z - 0.006
            bottom = 0.612 + 0.010 * t
            x = MIRROR_X + 0.012 + 0.096 * t
            low_x = x + 0.045 * (1 - t)
            ring = []
            for q in np.linspace(0, 1, 16):
                cz = top + (bottom - top) * q
                cx = x + (low_x - x) * q
                curl = 0.014 * math.sin(math.pi * q) ** 2 * math.sin(math.pi * t)
                ring.append((cx, side * (MIRROR_INNER + 0.004 - 0.010 * q * q + curl), cz))
            for q in np.linspace(1, 0, 16):
                cz = top + (bottom - top) * q
                cx = x + (low_x - x) * q
                curl = 0.014 * math.sin(math.pi * q) ** 2 * math.sin(math.pi * t)
                ring.append((cx, side * (MIRROR_INNER + 0.004 - 0.010 * q * q + curl - 0.005), cz))
            rings.append(ring)
        loft(f"mirror-fin.{name}", np.asarray(rings), density=2.0, sharp_angle=math.radians(50))
        strut = open_curve(np.array([(MIRROR_X + 0.05, side * 0.30, 0.610), (MIRROR_X + 0.05, side * 0.36, 0.645), (MIRROR_X + 0.045, side * 0.42, MIRROR_Z - 0.028)]), 16)
        loft(f"mirror-strut.{name}", sweep(strut, 0.016, 0.0028, 3.2, 12), density=1.0)


def wheel_body():
    plan = np.array(
        [
            (0.0, 0.098),
            (0.060, 0.098),
            (0.098, 0.085),
            (0.118, 0.060),
            (0.128, 0.036),
            (0.137, 0.018),
            (0.139, -0.030),
            (0.128, -0.070),
            (0.100, -0.094),
            (0.060, -0.104),
            (0.0, -0.106),
        ]
    )
    full = np.concatenate([plan, plan[-2:0:-1] * np.array([-1, 1])], axis=0)
    outline = closed_curve(full, 140)
    rings = []
    for depth, scale in ((0.014, 0.97), (0.0125, 0.992), (0.010, 1.0), (-0.016, 1.0), (-0.030, 0.93)):
        rings.append(np.array([wheel_point(-depth, p[0] * scale, p[1] * scale) for p in outline]))
    body = wheel_loft("wheel-body", rings, "wheel-face", caps=(True, True))
    plan_uv(body)


SCREEN = (0.0, 0.010, 0.0645, 0.0405)


def screen_outline(scale=1.0):
    cy, hw, hh = SCREEN[1], SCREEN[2] * scale, SCREEN[3] * scale
    corners = np.array(
        [
            (-hw * 0.78, hh),
            (hw * 0.78, hh),
            (hw, hh * 0.45),
            (hw, -hh * 0.82),
            (hw * 0.86, -hh),
            (-hw * 0.86, -hh),
            (-hw, -hh * 0.82),
            (-hw, hh * 0.45),
        ]
    )
    points = []
    for i, corner in enumerate(corners):
        following = corners[(i + 1) % len(corners)]
        for k in np.linspace(0, 1, 8, endpoint=False):
            points.append(corner + (following - corner) * k)
    return np.asarray(points) + np.array([0, cy])


def wheel_screen():
    screen = screen_outline()
    panel = wheel_loft(
        "wheel-screen",
        [
            np.array([wheel_point(-0.0160, p[0], p[1]) for p in screen]),
            np.array([wheel_point(-0.0164, p[0], p[1]) for p in screen]),
        ],
        "wheel-screen",
        caps=(False, True),
        sharp_angle=math.radians(20),
    )
    mesh = panel.data
    layer = mesh.uv_layers.active.data
    for polygon in mesh.polygons:
        for loop in polygon.loop_indices:
            y, z = wheel_plane(mesh.vertices[mesh.loops[loop].vertex_index].co)
            layer[loop].uv = ((SCREEN[2] - y) / (2 * SCREEN[2]), (z - SCREEN[1] + SCREEN[3]) / (2 * SCREEN[3]))
    outer = screen_outline(1.05)
    inner = screen_outline(1.0)
    wheel_loft(
        "wheel-bezel",
        [
            np.array([wheel_point(-0.0135, p[0], p[1]) for p in outer]),
            np.array([wheel_point(-0.0170, p[0], p[1]) for p in outer]),
            np.array([wheel_point(-0.0170, p[0], p[1]) for p in inner]),
        ],
        "wheel-bezel",
        caps=(False, False),
        sharp_angle=math.radians(35),
    )


def wheel_leds():
    strip = np.array([(y, 0.0785 - 18 * 0.0001 * 0 - (y * y) * 1.4) for y in np.linspace(-0.074, 0.074, 30)])
    upper = strip + np.array([0, 0.0052])
    lower = strip - np.array([0, 0.0052])
    outline = np.concatenate([upper, lower[::-1]], axis=0)
    wheel_loft(
        "wheel-led-strip",
        [
            np.array([wheel_point(-0.0135, p[0], p[1]) for p in outline]),
            np.array([wheel_point(-0.0162, p[0], p[1]) for p in outline]),
        ],
        "wheel-bezel",
        caps=(False, True),
    )
    for i in range(15):
        y = (7 - i) * LED_PITCH
        z = 0.0785 - y * y * 1.4
        colour = "led-green" if i < 5 else "led-wheel-red" if i < 10 else "led-purple"
        wheel_loft(f"wheel-led-{i}", disc_rings(y, z, 0.0032, ((0.0160, 1.0), (0.0172, 0.8), (0.0176, 0.4)), points=14), colour, caps=(False, True))


def wheel_controls():
    for i, (y, z, radius) in enumerate(BUTTONS):
        wheel_loft(f"wheel-btn-side-{i}", disc_rings(y, z, radius * 1.2, ((0.0135, 1.0), (0.0175, 1.0), (0.0185, 0.92)), points=28), "wheel-bezel", caps=(False, False))
        cap = wheel_loft(f"wheel-btn-cap-{i}", disc_rings(y, z, radius, ((0.0185, 1.0), (0.0205, 0.98), (0.0212, 0.84), (0.0213, 0.0)), points=28), "wheel-face", caps=(False, False))
        plan_uv(cap)
    for i, (y, z, radius) in enumerate(ROTARIES):
        knob = disc_rings(y, z, radius, ((0.0135, 1.0), (0.0250, 1.0), (0.0270, 0.88), (0.0270, 0.0)), points=36)
        wheel_loft(f"wheel-rotary-{i}", knob, "wheel-rotary", caps=(False, False))
        pointer = np.array([wheel_point(-0.0275, y + dy, z + dz) for dy, dz in ((-0.0016, 0.004), (0.0016, 0.004), (0.0016, radius * 0.86), (-0.0016, radius * 0.86))])
        wheel_loft(f"wheel-pointer-{i}", [pointer, pointer + np.array([0.0006, 0, 0])], "btn-white", caps=(False, True))
    y, z, radius = DIAL
    knob = disc_rings(y, z, radius * 0.62, ((0.0135, 1.0), (0.0270, 1.0), (0.0290, 0.86), (0.0290, 0.0)), points=36)
    wheel_loft("wheel-dial", knob, "wheel-rotary", caps=(False, False))


def wheel_grips():
    for side, name in ((1, "l"), (-1, "r")):
        path = np.array([wheel_point(0.008, side * y, z) for y, z in ((0.132, 0.058), (0.150, 0.030), (0.160, -0.008), (0.157, -0.050), (0.138, -0.082))])
        tube(f"wheel-grip.{name}", path, 0.023, 0.026, power=2.4, samples=26, points=20, group="steering-wheel", material_name="grip", atlas=False, up=(1, 0, 0))
        barrel = np.array([wheel_point(-0.030, side * 0.128, 0.052), wheel_point(0.010, side * 0.138, 0.066)])
        tube(f"wheel-thumb-rotary.{name}", barrel, 0.0145, samples=8, points=20, group="steering-wheel", material_name="wheel-rotary", atlas=False, up=(0, 1, 0))
        mark = np.array([wheel_point(-0.032, side * 0.128, 0.052 + 0.006), wheel_point(-0.032, side * 0.128, 0.052 - 0.006)])
        tube(f"wheel-mark-a.{name}", mark, 0.0016, samples=4, points=8, group="steering-wheel", material_name="led-green-mark", atlas=False, up=(0, 1, 0))
        mark = np.array([wheel_point(-0.032, side * 0.122, 0.052), wheel_point(-0.032, side * 0.134, 0.052)])
        tube(f"wheel-mark-b.{name}", mark, 0.0016, samples=4, points=8, group="steering-wheel", material_name="led-green-mark", atlas=False, up=(0, 0, 1))
        outline = [(side * 0.040, 0.030), (side * 0.125, 0.048), (side * 0.128, -0.022), (side * 0.050, -0.036)]
        path = closed_curve(outline, 28)
        rings = [np.array([wheel_point(depth, p[0], p[1]) for p in path]) for depth in (0.034, 0.040)]
        wheel_loft(f"wheel-paddle.{name}", rings, "wheel-metal")


def sculpt(mesh, strokes):
    count = len(mesh.vertices)
    position = np.empty(count * 3, np.float64)
    normal = np.empty(count * 3, np.float64)
    mesh.vertices.foreach_get("co", position)
    mesh.vertex_normals.foreach_get("vector", normal)
    position = position.reshape(-1, 3)
    normal = normal.reshape(-1, 3)
    for points, radius, strength in strokes:
        path = to_blender(open_curve(np.asarray(points, np.float64), max(12, len(points) * 8)))
        reach = np.full(count, np.inf)
        for sample in path:
            reach = np.minimum(reach, np.linalg.norm(position - sample, axis=1))
        falloff = np.exp(-((reach / radius) ** 2))
        position += normal * (falloff * strength)[:, None]
    mesh.vertices.foreach_set("co", position.ravel())
    mesh.update()


def glove_strokes(side):
    strokes = []
    point = lambda x, y, z: np.array(wheel_point(x, side * y, z + HAND_LIFT))
    for z in (-0.037, -0.015, 0.007):
        strokes.append(([point(-0.100, 0.176, z - 0.066), point(-0.070, 0.178, z - 0.034), point(-0.040, 0.184, z)], 0.0052, -0.0034))
        strokes.append(([point(-0.040, 0.184, z), point(-0.018, 0.205, z), point(0.012, 0.208, z)], 0.0036, -0.0042))
    for z in (-0.048, -0.026, -0.004, 0.018):
        strokes.append(([point(-0.040, 0.190, z), point(-0.038, 0.192, z + 0.001)], 0.0105, 0.0042))
    strokes.append(([point(-0.150, 0.150, -0.150), point(-0.150, 0.178, -0.158), point(-0.150, 0.206, -0.150)], 0.0075, -0.0040))
    strokes.append(([point(-0.138, 0.150, -0.138), point(-0.138, 0.178, -0.146), point(-0.138, 0.206, -0.138)], 0.0060, 0.0030))
    strokes.append(([point(-0.094, 0.150, -0.098), point(-0.072, 0.142, -0.062), point(-0.054, 0.126, -0.018)], 0.0060, -0.0030))
    return strokes


def organic(name, build, material_name, group, uv_for, strokes=()):
    start = len(PARTS)
    build()
    pieces = [p["object"] for p in PARTS[start:]]
    del PARTS[start:]
    keep = pieces[0]
    with bpy.context.temp_override(active_object=keep, selected_editable_objects=pieces, object=keep):
        bpy.ops.object.join()
    remesh = keep.modifiers.new("remesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = VOXEL
    remesh.use_smooth_shade = True
    smooth = keep.modifiers.new("smooth", "SMOOTH")
    smooth.factor = 0.8
    smooth.iterations = 12
    bpy.context.view_layer.objects.active = keep
    for modifier in list(keep.modifiers):
        with bpy.context.temp_override(object=keep, active_object=keep, selected_objects=[keep]):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    if strokes:
        sculpt(keep.data, strokes)
    keep.name = name
    mesh = keep.data
    mesh.materials.clear()
    mesh.materials.append(bpy.data.materials[material_name])
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    layer = mesh.uv_layers.new(name="UVMap").data
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop in polygon.loop_indices:
            layer[loop].uv = uv_for(mesh.vertices[mesh.loops[loop].vertex_index].co)
    PARTS.append({"object": keep, "group": group, "atlas": False, "density": 1.0})
    return keep


def glove_uv(side):
    def uv_for(co):
        y, z = wheel_plane(co)
        return ((0.212 - y) / 0.112 if side > 0 else (-0.100 - y) / 0.112, (z - HAND_LIFT + 0.20) / 0.245)

    return uv_for


def hand_pieces(side):
    bones = []

    def bone(points, radius):
        bones.append(([np.array(wheel_point(p[0], side * p[1], p[2] + HAND_LIFT)) for p in points], radius))

    wrist = (-0.122, 0.168, -0.132)
    knuckle_z = (-0.048, -0.026, -0.004, 0.018)
    for k, z in enumerate(knuckle_z):
        knuckle = (-0.042, 0.168 + 0.003 * k, z)
        start = (wrist[0], wrist[1] + 0.004 * k, wrist[2] + 0.006 * k)
        mid = ((start[0] + knuckle[0]) / 2 - 0.006, (start[1] + knuckle[1]) / 2 + 0.002, (start[2] + knuckle[2]) / 2)
        bone([start, mid, knuckle], 0.0190)
        reach = (0.97, 1.03, 1.02, 0.93)[k]
        bone(
            [
                knuckle,
                (-0.026, 0.192 * reach, z),
                (0.004, 0.204 * reach, z - 0.002),
                (0.034, 0.188 * reach, z - 0.004),
                (0.040, 0.152, z - 0.004),
            ],
            0.0102,
        )
    bone([(wrist[0] + 0.008, wrist[1] - 0.014, wrist[2] + 0.012), (-0.074, 0.134, -0.058), (-0.052, 0.122, -0.010)], 0.0235)
    bone([(-0.052, 0.122, -0.010), (-0.046, 0.116, 0.022), (-0.038, 0.118, 0.042)], 0.0122)
    bone([wrist, (-0.178, 0.178, -0.182)], 0.0270)
    for points, radius in bones:
        tube(f"bone-{side}", points, radius, samples=max(8, len(points) * 4), points=16, group="steering-wheel", material_name="glove", atlas=False, density=1.0)


def hand(side):
    name = "l" if side > 0 else "r"
    organic(f"glove.{name}", lambda: hand_pieces(side), "glove", "steering-wheel", glove_uv(side), glove_strokes(side))
    wrist = np.array(wheel_point(-0.178, side * 0.178, -0.182 + HAND_LIFT))
    elbow = np.array((0.03, side * 0.238, 0.42))
    tube(f"forearm.{name}", [wrist, (wrist + elbow) / 2, elbow], 0.032, 0.030, samples=12, points=18, group="steering-wheel", material_name="suit", atlas=False)


def helmet_reach(v):
    sphere = math.sqrt(max(1 - v * v, 0.0))
    lower = min(v, -0.45)
    s = sphere if v >= -0.45 else 0.893 + (lower + 0.45) * 0.08
    chin = max(math.sin(math.pi * (v + 0.95) / 0.6), 0.0) if -0.95 <= v <= -0.35 else 0.0
    flare = max(-0.85 - v, 0.0) / 0.15
    front = HEAD_RADIUS * (1.06 * s + 0.1 * chin)
    back = HEAD_RADIUS * (1.12 * s + 0.06 * flare)
    width = HEAD_RADIUS * (1.0 * s + 0.02 * flare)
    power = 2.0 + 0.4 * max(-v, 0.0)
    return front, back, width, power


def helmet_point(v, angle, lift=0.0):
    front, back, width, power = helmet_reach(v)
    c, s = math.cos(angle), math.sin(angle)
    reach = front if c > 0 else back
    x = HEAD[0] + math.copysign(abs(c) ** (2 / power), c) * (reach + lift)
    y = math.copysign(abs(s) ** (2 / power), s) * (width + lift)
    return np.array([x, y, HEAD[2] + v * HEAD_RADIUS * 1.04])


def helmet_ring(v, angles, lift=0.0):
    return np.array([helmet_point(v, a, lift) for a in angles])


def driver():
    around = np.linspace(0, 2 * math.pi, 72, endpoint=False)
    shell = [helmet_ring(v, around) for v in np.sin(np.linspace(-math.pi / 2, math.pi / 2 - 0.06, 84))]
    loft("helmet", shell, group="driver-head", material_name="helmet", atlas=True, caps=(True, True), sharp_angle=math.radians(179), density=4.0)
    visor = []
    for v, chord in ((-0.36, 1.05), (-0.33, 1.18), (-0.2, 1.24), (0.0, 1.25), (0.1, 1.22), (0.15, 1.12)):
        visor.append(helmet_ring(v, np.linspace(-chord, chord, 40), 0.0045))
    loft("visor", visor, group="driver-head", material_name="visor", atlas=False, closed=False, caps=(False, False))
    seal = [helmet_point(0.165, a, 0.006) for a in np.linspace(-1.16, 1.16, 24)]
    tube("visor-seal", seal, 0.0045, 0.0035, samples=48, points=10, group="driver-head", material_name="carbon-part", atlas=False)
    for side in (1, -1):
        pivot = helmet_point(-0.06, side * (math.pi / 2 - 0.06), 0.002)
        lathe(
            f"visor-pivot.{'l' if side > 0 else 'r'}",
            [(0.0, 0.0), (0.0, 0.021), (0.004, 0.02), (0.007, 0.013), (0.007, 0.0)],
            tuple(pivot),
            segments=32,
            sign=side,
            material_name="carbon-part",
            group="driver-head",
            atlas=False,
            caps=(False, False),
        )
    stations = []
    for y in (-0.062, -0.04, 0.0, 0.04, 0.062):
        v = 0.56
        front, back, width, power = helmet_reach(v)
        across = min(abs(y) / width, 0.99)
        edge = HEAD[0] - back * (1 - across ** power) ** (1 / power) + 0.012
        taper = 1 - 0.45 * (abs(y) / 0.062) ** 2
        stations.append((y, edge, HEAD[2] + v * HEAD_RADIUS * 1.04 - 0.004, 0.05 * taper, -16))
    wing("helmet-spoiler", stations, samples=24, thickness=0.12, camber=0.04, points=24, sides=False, group="driver-head", material_name="helmet", atlas=True)
    tube("shoulders", [(-0.015, -0.21, 0.56), (-0.005, 0.0, 0.585), (-0.015, 0.21, 0.56)], 0.085, 0.06, samples=20, points=20, group="driver-head", material_name="suit", atlas=False, up=(1, 0, 0))
    tube("neck", [(0.055, 0.0, 0.56), (0.075, 0.0, 0.64)], 0.07, samples=6, points=18, group="driver-head", material_name="suit", atlas=False, up=(1, 0, 0))


def build_cockpit():
    halo()
    tub()
    cockpit_pads()
    headrest()
    mirrors()
    wheel_body()
    wheel_screen()
    wheel_leds()
    wheel_controls()
    wheel_grips()
    hand(1)
    hand(-1)
    driver()
