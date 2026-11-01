import math

import bmesh
import bpy
import numpy as np

from design import param
from shapes import (
    both,
    box,
    closed_curve,
    interpolate,
    loft,
    open_curve,
    PARTS,
    plate,
    superellipse,
    sweep,
    tube,
)

FRONT_AXLE = 1.70
REAR_AXLE = -1.70
RINGS = 150
AROUND = 96

SECTIONS = [
    (2.72, [(0.0, 0.205), (0.055, 0.203), (0.078, 0.188), (0.084, 0.160), (0.076, 0.132), (0.045, 0.120), (0.0, 0.118)]),
    (2.45, [(0.0, 0.285), (0.070, 0.282), (0.100, 0.262), (0.110, 0.225), (0.098, 0.175), (0.060, 0.145), (0.0, 0.138)]),
    (2.10, [(0.0, 0.395), (0.085, 0.391), (0.118, 0.365), (0.128, 0.305), (0.115, 0.225), (0.070, 0.168), (0.0, 0.158)]),
    (1.75, [(0.0, 0.495), (0.100, 0.489), (0.140, 0.455), (0.153, 0.375), (0.135, 0.265), (0.080, 0.185), (0.0, 0.165)]),
    (1.35, [(0.0, 0.600), (0.120, 0.592), (0.185, 0.550), (0.205, 0.440), (0.185, 0.270), (0.110, 0.140), (0.0, 0.120)]),
    (0.95, [(0.0, 0.655), (0.125, 0.645), (0.225, 0.600), (0.275, 0.470), (0.270, 0.250), (0.190, 0.090), (0.0, 0.070)]),
    (0.65, [(0.0, 0.660), (0.140, 0.655), (0.280, 0.615), (0.350, 0.480), (0.350, 0.230), (0.250, 0.070), (0.0, 0.060)]),
    (0.25, [(0.0, 0.672), (0.150, 0.668), (0.310, 0.640), (0.385, 0.500), (0.385, 0.210), (0.280, 0.065), (0.0, 0.058)]),
    (-0.08, [(0.0, 0.800), (0.105, 0.780), (0.250, 0.670), (0.365, 0.520), (0.380, 0.210), (0.285, 0.065), (0.0, 0.058)]),
    (-0.30, [(0.0, 0.905), (0.100, 0.865), (0.175, 0.720), (0.300, 0.530), (0.350, 0.210), (0.270, 0.065), (0.0, 0.058)]),
    (-0.55, [(0.0, 0.835), (0.085, 0.800), (0.135, 0.680), (0.235, 0.500), (0.295, 0.210), (0.240, 0.065), (0.0, 0.058)]),
    (-0.95, [(0.0, 0.690), (0.070, 0.660), (0.105, 0.570), (0.180, 0.420), (0.225, 0.200), (0.190, 0.065), (0.0, 0.058)]),
    (-1.35, [(0.0, 0.540), (0.055, 0.515), (0.085, 0.450), (0.130, 0.340), (0.160, 0.190), (0.135, 0.075), (0.0, 0.065)]),
    (-1.72, [(0.0, 0.420), (0.040, 0.405), (0.065, 0.365), (0.090, 0.290), (0.105, 0.195), (0.085, 0.105), (0.0, 0.090)]),
    (-2.10, [(0.0, 0.350), (0.026, 0.345), (0.043, 0.325), (0.050, 0.295), (0.050, 0.255), (0.040, 0.225), (0.0, 0.215)]),
]

POD_SECTIONS = [
    (0.600, [(0.27, 0.560), (0.42, 0.575), (0.525, 0.565), (0.565, 0.530), (0.550, 0.495), (0.420, 0.470), (0.27, 0.460), (0.23, 0.510)]),
    (0.520, [(0.27, 0.570), (0.46, 0.585), (0.600, 0.565), (0.645, 0.500), (0.625, 0.430), (0.500, 0.390), (0.27, 0.370), (0.23, 0.470)]),
    (0.300, [(0.27, 0.565), (0.46, 0.575), (0.645, 0.545), (0.700, 0.470), (0.675, 0.380), (0.520, 0.300), (0.27, 0.270), (0.23, 0.440)]),
    (0.050, [(0.25, 0.555), (0.46, 0.552), (0.660, 0.525), (0.710, 0.445), (0.650, 0.335), (0.460, 0.195), (0.25, 0.150), (0.22, 0.410)]),
    (-0.300, [(0.20, 0.555), (0.41, 0.520), (0.620, 0.470), (0.690, 0.395), (0.620, 0.285), (0.420, 0.115), (0.20, 0.080), (0.17, 0.370)]),
    (-0.650, [(0.15, 0.500), (0.33, 0.445), (0.550, 0.390), (0.620, 0.320), (0.550, 0.225), (0.340, 0.090), (0.14, 0.072), (0.12, 0.310)]),
    (-0.900, [(0.12, 0.500), (0.27, 0.460), (0.460, 0.360), (0.520, 0.285), (0.450, 0.190), (0.270, 0.080), (0.12, 0.072), (0.10, 0.270)]),
    (-1.100, [(0.10, 0.490), (0.20, 0.460), (0.310, 0.390), (0.350, 0.300), (0.300, 0.180), (0.200, 0.085), (0.10, 0.072), (0.08, 0.240)]),
    (-1.300, [(0.08, 0.480), (0.16, 0.465), (0.250, 0.420), (0.280, 0.330), (0.240, 0.190), (0.160, 0.090), (0.08, 0.078), (0.06, 0.210)]),
    (-1.660, [(0.05, 0.440), (0.14, 0.435), (0.235, 0.400), (0.270, 0.330), (0.235, 0.220), (0.120, 0.100), (0.05, 0.092), (0.04, 0.175)]),
]

FLOOR_PLAN = [
    (0.70, 0.22),
    (0.64, 0.52),
    (0.55, 0.72),
    (0.20, 0.74),
    (-0.40, 0.76),
    (-0.90, 0.74),
    (-1.20, 0.68),
    (-1.36, 0.585),
    (-1.46, 0.545),
    (-2.12, 0.525),
]
FLOOR_BOTTOM = 0.042
FLOOR_TOP = 0.062


def half_to_ring(half, count):
    half = np.asarray(half)
    full = np.concatenate([half, half[-2:0:-1] * np.array([-1, 1])], axis=0)
    return closed_curve(full, count)


def shape_nose(x, points):
    k = float(np.clip((x - 1.35) / 0.7, 0, 1))
    width = 1 + (param("noseWidth", 1.0) - 1) * k
    drop = param("noseDrop", 0.0) * k
    return [(y * width, z - drop) for y, z in points]


def body_rings(sections, rings, around):
    xs = np.array([s[0] for s in sections])
    profiles = np.array([half_to_ring(shape_nose(s[0], s[1]), around) for s in sections])
    samples = np.linspace(xs[0], xs[-1], rings)
    grid = interpolate(xs, profiles, samples)
    out = np.zeros((rings, around, 3))
    out[..., 0] = samples[:, None]
    out[..., 1] = grid[..., 0]
    out[..., 2] = grid[..., 1]
    return out


def nose_tip():
    tip = body_rings(SECTIONS, RINGS, AROUND)[0]
    centre = tip.mean(axis=0)
    rings = []
    for scale, advance in ((1.0, 0.0), (0.98, 0.03), (0.90, 0.055), (0.72, 0.08), (0.40, 0.098), (0.05, 0.102)):
        ring = centre + (tip - centre) * scale
        ring[:, 0] += advance
        rings.append(ring)
    loft("nose-tip", rings, caps=(False, True))


def monocoque():
    rings = body_rings(SECTIONS, RINGS, AROUND)
    return loft("monocoque", rings, caps=(False, True), density=1.35)


def remove_cut_walls(chassis):
    mesh = chassis.data
    void = mesh.materials.find("void")
    if void < 0:
        return
    bm = bmesh.new()
    bm.from_mesh(mesh)
    walls = [face for face in bm.faces if face.material_index == void]
    bmesh.ops.delete(bm, geom=walls, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.pop(index=void)


def cockpit_cut(chassis):
    outline = [
        (0.73, 0.0),
        (0.68, 0.14),
        (0.48, 0.255),
        (0.20, 0.275),
        (-0.02, 0.265),
        (-0.135, 0.17),
        (-0.165, 0.0),
    ]
    half = np.array(outline)
    full = np.concatenate([half, (half[-2:0:-1] * np.array([1, -1]))], axis=0)
    path = closed_curve(full, 96)
    rings = []
    for z in (0.10, 1.2):
        rings.append(np.stack([path[:, 0], path[:, 1], np.full(len(path), z)], axis=-1))
    cutter = loft("cockpit-cutter", rings, material_name="void", atlas=False, group="cut")
    modifier = chassis.modifiers.new("cockpit", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.object = cutter
    modifier.solver = "EXACT"
    modifier.material_mode = "TRANSFER"
    bpy.context.view_layer.objects.active = chassis
    with bpy.context.temp_override(object=chassis, active_object=chassis, selected_objects=[chassis]):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    PARTS.pop()
    bpy.data.objects.remove(cutter)
    remove_cut_walls(chassis)
    rim_z = []
    for point in path:
        rim_z.append(rim_height(point[0], point[1]))
    rim = np.stack([path[:, 0], path[:, 1], np.array(rim_z)], axis=-1)
    return rim


def rim_height(x, y):
    return float(interpolate([0.80, 0.60, 0.30, 0.0, -0.20], [0.650, 0.628, 0.625, 0.675, 0.790], [x])[0])


def cockpit_rim(rim):
    centre = rim.mean(axis=0)
    rings = []
    for scale, lift in ((1.05, -0.012), (1.03, 0.012), (0.985, 0.020), (0.95, 0.006), (0.94, -0.040)):
        ring = centre + (rim - centre) * np.array([scale, scale, 1.0])
        ring[:, 2] += lift
        rings.append(ring)
    loft("cockpit-rim", rings, material_name="body", caps=(False, False))


def shape_pod(x, points):
    width = param("podWidth", 1.0)
    top = param("podTop", 0.0)
    rear = float(np.clip((0.3 - x) / 1.4, 0, 1))
    downwash = param("downwash", 0.0) * rear
    middle = float(np.clip((0.3 - x) / 0.5, 0, 1)) * float(np.clip((x + 1.35) / 0.5, 0, 1))
    undercut = param("undercut", 0.0) * middle
    shaped = []
    for y, z in points:
        upper = float(np.clip((z - 0.33) / 0.12, 0, 1))
        low = 1 - float(np.clip((z - 0.10) / 0.22, 0, 1))
        outer = float(np.clip((y - 0.22) / 0.2, 0, 1))
        shaped.append((y + (y - 0.22) * (width - 1) * outer, z + upper * (top - downwash) + low * outer * undercut))
    return shaped


def sidepods():
    xs = np.array([s[0] for s in POD_SECTIONS])
    profiles = np.array([closed_curve(shape_pod(s[0], s[1]), 64) for s in POD_SECTIONS])
    samples = np.linspace(xs[0], xs[-1], 110)
    grid = interpolate(xs, profiles, samples)
    rings = np.zeros((len(samples), 64, 3))
    rings[..., 0] = samples[:, None]
    rings[..., 1] = grid[..., 0]
    rings[..., 2] = grid[..., 1]
    both("sidepod", rings, caps=(False, True))
    mouth = rings[0]
    centre = mouth.mean(axis=0)
    inner = []
    for scale, depth in ((1.0, 0.0), (0.93, -0.015), (0.82, -0.05), (0.76, -0.30)):
        ring = centre + (mouth - centre) * np.array([1.0, scale, scale])
        ring[:, 0] += depth
        inner.append(ring)
    both("inlet", inner, material_name="void", atlas=False, caps=(False, True))
    lip = []
    for scale, depth in ((1.0, 0.0), (0.985, 0.008), (0.95, 0.012), (0.92, 0.0)):
        ring = centre + (mouth - centre) * np.array([1.0, scale, scale])
        ring[:, 0] += depth
        lip.append(ring)
    both("inlet-lip", lip, caps=(False, False))


def airbox():
    path = superellipse(0.098 * param("airbox", 1.0), 0.082, 2.6, 48, (0.0, 0.835))
    rings = []
    for x, scale in ((-0.205, 1.0), (-0.215, 0.93), (-0.45, 0.72)):
        ring = np.zeros((48, 3))
        ring[:, 0] = x
        ring[:, 1] = path[:, 0] * scale
        ring[:, 2] = 0.835 + (path[:, 1] - 0.835) * scale
        rings.append(ring)
    loft("airbox-throat", rings, material_name="void", atlas=False, caps=(False, True))
    lip = []
    for x, scale in ((-0.27, 1.13), (-0.215, 1.11), (-0.195, 1.04), (-0.205, 0.96)):
        ring = np.zeros((48, 3))
        ring[:, 0] = x
        ring[:, 1] = path[:, 0] * scale
        ring[:, 2] = 0.835 + (path[:, 1] - 0.835) * scale
        lip.append(ring)
    loft("airbox-lip", lip, caps=(False, False))
    outline = [(-0.20, 0.915), (-0.27, 0.955), (-0.42, 0.965), (-0.56, 0.86), (-0.42, 0.86), (-0.28, 0.90)]
    plate("roll-hoop-blade", outline, 0.0, 0.03, side=1, samples=48)
    cap = []
    for x, width, height in ((-0.155, 0.070, 0.012), (-0.18, 0.128, 0.026), (-0.33, 0.132, 0.030), (-0.41, 0.100, 0.018)):
        ring = superellipse(width * param("airbox", 1.0), height, 4.0, 28, (0.0, 0.900 + (x + 0.155) * -0.12))
        cap.append(np.stack([np.full(28, x), ring[:, 0], ring[:, 1]], axis=-1))
    loft("airbox-cap", cap, material_name="headrest", atlas=False)
    tube("t-bar-stalk", [(-0.335, 0.0, 0.930), (-0.335, 0.0, 1.022)], 0.016, 0.011, power=3.0, samples=6, points=14, material_name="headrest", atlas=False, up=(1, 0, 0))
    tube("t-bar", [(-0.335, -0.195, 1.030), (-0.335, 0.195, 1.030)], 0.019, 0.017, power=3.0, samples=10, points=18, material_name="headrest", atlas=False, up=(0, 0, 1))
    for side in (1, -1):
        lens = superellipse(0.011, 0.011, 2.0, 16, (side * 0.160, 1.030))
        loft(f"t-bar-lens.{side}", [np.stack([np.full(16, x), lens[:, 0], lens[:, 1]], axis=-1) for x in (-0.316, -0.312)], material_name="lens", atlas=False)
    fin = param("finHeight", 1.0)
    outline = [(-0.60, 0.72 + 0.08 * fin), (-1.25, 0.50 + 0.09 * fin), (-1.68, 0.42 + 0.05 * fin), (-1.68, 0.42), (-1.25, 0.50), (-0.60, 0.72)]
    plate("engine-fin", outline, 0.0, 0.008, side=1, samples=64)


def floor():
    plan = np.array(FLOOR_PLAN)
    samples = np.linspace(plan[0, 0], plan[-1, 0], 110)
    widths = interpolate(plan[:, 0], plan[:, 1], samples)
    rings = []
    for x, w in zip(samples, widths):
        section = np.array(
            [
                [0, FLOOR_TOP],
                [w * 0.6, FLOOR_TOP],
                [w * 0.97, FLOOR_TOP],
                [w, FLOOR_TOP - 0.006],
                [w, FLOOR_BOTTOM + 0.006],
                [w * 0.97, FLOOR_BOTTOM],
                [w * 0.6, FLOOR_BOTTOM],
                [0, FLOOR_BOTTOM],
                [-w * 0.6, FLOOR_BOTTOM],
                [-w * 0.97, FLOOR_BOTTOM],
                [-w, FLOOR_BOTTOM + 0.006],
                [-w, FLOOR_TOP - 0.006],
                [-w * 0.97, FLOOR_TOP],
                [-w * 0.6, FLOOR_TOP],
            ]
        )
        rings.append(np.stack([np.full(len(section), x), section[:, 0], section[:, 1]], axis=-1))
    loft("floor", rings, sharp_angle=math.radians(30), density=0.3)
    box("plank", (-0.60, -0.15, 0.030), (0.95, 0.15, FLOOR_BOTTOM), density=0.2)
    edge = []
    for x in np.linspace(0.45, -1.12, 60):
        w = float(interpolate(plan[:, 0], plan[:, 1], [x])[0])
        t = (0.45 - x) / 1.57
        height = 0.018 + 0.055 * np.sin(math.pi * min(t * 1.2, 1.0)) ** 0.8
        edge.append((x, w - 0.012, FLOOR_TOP + height * 0.5, height * 0.5))
    edge = np.array(edge)
    path = edge[:, :3]
    both("floor-edge", sweep(path, 0.006, edge[:, 3], 3.0, 12))
    for i, (start, end, y, z, height) in enumerate(
        [
            (0.34, -0.55, 0.66, 0.10, 0.018),
            (-0.15, -1.00, 0.60, 0.13, 0.016),
        ]
    ):
        path = np.array([[start, y + 0.05, z], [(start + end) / 2, y, z + 0.012], [end, y - 0.12, z - 0.012]])
        both(f"floor-vane-{i}", sweep(open_curve(path, 30), 0.005, height, 3.0, 12))
    for x, y, height in ((0.95, 0.30, 0.13), (0.87, 0.43, 0.11)):
        outline = [(x + 0.05, FLOOR_TOP), (x + 0.03, FLOOR_TOP + height), (x - 0.20, FLOOR_TOP + height * 0.7), (x - 0.30, FLOOR_TOP)]
        plate(f"floor-fence-{y}", outline, y, 0.006, samples=32)
    inwash_boards()
    diffuser()


def inwash_boards():
    for i, (z, inset) in enumerate(((0.095, 0.0), (0.175, 0.055), (0.250, 0.110))):
        path = np.array(
            [
                [1.05, 0.815 - inset, z],
                [0.90, 0.795 - inset, z + 0.006],
                [0.62, 0.750 - inset, z + 0.012],
                [0.38, 0.705 - inset, z + 0.016],
            ]
        )
        both(f"inwash-{i}", sweep(open_curve(path, 40), 0.044, 0.0035, 3.0, 14, up=(0, 0, 1)), density=0.9)
    outline = [(1.075, 0.060), (1.075, 0.318), (1.03, 0.330), (0.90, 0.300), (0.70, 0.150), (0.40, 0.062)]
    plate("inwash-wall", outline, 0.862, 0.006, samples=36, density=0.9, lean=lambda x, z: -0.46 * (1.05 - x))
    both("inwash-bar", sweep(np.linspace((1.055, 0.18, 0.320), (1.055, 0.86, 0.322), 24), 0.012, 0.0045, 3.0, 12, up=(0, 0, 1)), density=0.8)


def diffuser():
    samples = np.linspace(-1.45, -2.14, 44)
    rings = []
    for x in samples:
        t = (-1.45 - x) / 0.69
        z = 0.045 + 0.205 * t**1.6
        w = 0.52 - 0.02 * t
        arch = np.linspace(-1, 1, 25)
        section = np.stack(
            [
                np.full(25, x),
                arch * w,
                z + 0.03 * t * (1 - arch**2),
            ],
            axis=-1,
        )
        upper = section[::-1].copy()
        upper[:, 2] += 0.008
        rings.append(np.concatenate([section, upper], axis=0))
    loft("diffuser", rings, sharp_angle=math.radians(35), density=0.4)
    outline = [(-1.46, 0.030), (-2.16, 0.030), (-2.17, 0.215), (-2.11, 0.265), (-1.85, 0.170), (-1.46, 0.062)]
    plate("diffuser-wall", outline, 0.525, 0.010, samples=48)
    for y, height in ((0.0, 0.25), (0.27, 0.215)):
        outline = [(-1.50, 0.040), (-2.14, 0.040), (-2.14, height), (-1.90, 0.16)]
        if y == 0:
            plate("diffuser-strake", outline, 0.0, 0.008, side=1, samples=32)
        else:
            plate(f"diffuser-strake-{y}", outline, y, 0.006, samples=32)


def crash_structure():
    box("rain-light-mount", (-2.205, -0.050, 0.262), (-2.10, 0.050, 0.345))
    rings = []
    for x, width, height in ((-2.10, 0.052, 0.054), (-2.46, 0.042, 0.044), (-2.50, 0.040, 0.040)):
        ring = superellipse(width, height, 3.0, 28, (0.0, 0.30))
        rings.append(np.stack([np.full(28, x), ring[:, 0], ring[:, 1]], axis=-1))
    loft("crash-tail", rings)
    rings = []
    for x, radius in ((-1.88, 0.044), (-2.10, 0.040), (-2.128, 0.042), (-2.130, 0.034), (-2.08, 0.031)):
        ring = superellipse(radius, radius, 2.0, 32, (0.0, 0.405))
        rings.append(np.stack([np.full(32, x), ring[:, 0], ring[:, 1]], axis=-1))
    loft("exhaust", rings, material_name="exhaust", atlas=False, caps=(False, True))


def nose_details():
    tube("pitot", [(2.80, 0.0, 0.150), (2.86, 0.0, 0.158), (2.95, 0.0, 0.158)], 0.0040, samples=10, points=8, material_name="titanium", atlas=False, up=(0, 1, 0))
    for side in (1, -1):
        outline = np.array([(0.72, 0.60), (0.92, 0.615), (0.98, 0.640), (0.80, 0.65)])
        path = closed_curve(outline, 24)
        rings = np.stack(
            [
                np.stack([path[:, 0], np.full(24, side * (0.300 + 0.005 * k)), path[:, 1] + 0.012 * k], axis=-1)
                for k in range(2)
            ]
        )
        loft(f"cockpit-winglet.{side}", rings)


def build_body():
    chassis = monocoque()
    rim = cockpit_cut(chassis)
    cockpit_rim(rim)
    nose_tip()
    sidepods()
    airbox()
    floor()
    crash_structure()
    nose_details()
    return rim

