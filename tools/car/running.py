import math

import numpy as np

from body import FRONT_AXLE, REAR_AXLE
from shapes import lathe, loft, open_curve, superellipse, sweep, tube

FRONT = {"x": FRONT_AXLE, "y": 0.780, "radius": 0.3525, "width": 0.340, "name": "f"}
REAR = {"x": REAR_AXLE, "y": 0.750, "radius": 0.355, "width": 0.400, "name": "r"}
RIM_RADIUS = 0.2286
SPOKES = 7


def tyre_profile(radius, width):
    half = width / 2
    return [
        (half * 0.74, RIM_RADIUS + 0.002),
        (half * 0.93, RIM_RADIUS + 0.012),
        (half * 0.985, RIM_RADIUS + 0.040),
        (half * 1.0, (RIM_RADIUS + radius) / 2),
        (half * 0.995, radius - 0.042),
        (half * 0.97, radius - 0.016),
        (half * 0.91, radius - 0.004),
        (half * 0.80, radius - 0.001),
        (0.0, radius),
        (-half * 0.80, radius - 0.001),
        (-half * 0.91, radius - 0.004),
        (-half * 0.97, radius - 0.016),
        (-half * 0.995, radius - 0.042),
        (-half * 1.0, (RIM_RADIUS + radius) / 2),
        (-half * 0.985, RIM_RADIUS + 0.040),
        (-half * 0.93, RIM_RADIUS + 0.012),
        (-half * 0.74, RIM_RADIUS + 0.002),
    ]


def smooth_profile(points, count):
    return open_curve(np.asarray(points), count)


def normalise_uv(obj, side):
    layer = obj.data.uv_layers.active.data
    uv = np.empty(len(layer) * 2, np.float32)
    layer.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    uv = (uv - uv.min(axis=0)) / (uv.max(axis=0) - uv.min(axis=0))
    if side < 0:
        uv[:, 0] = 1 - uv[:, 0]
    layer.foreach_set("uv", uv.ravel())


def wheel(spec, side, corner):
    name = f"wheel-{spec['name']}{corner}"
    group = f"{name}-spin"
    centre = (spec["x"], side * spec["y"], spec["radius"])
    width = spec["width"]
    tyre = lathe(
        f"{name}-tyre",
        smooth_profile(tyre_profile(spec["radius"], width), 64),
        centre,
        segments=128,
        sign=side,
        material_name="tyre",
        group=group,
        atlas=False,
        caps=(False, False),
    )
    normalise_uv(tyre, side)
    half = width / 2
    rim_profile = [
        (-half * 0.72, RIM_RADIUS + 0.006),
        (-half * 0.74, RIM_RADIUS - 0.012),
        (-half * 0.60, RIM_RADIUS - 0.022),
        (0.0, RIM_RADIUS - 0.030),
        (half * 0.60, RIM_RADIUS - 0.022),
        (half * 0.74, RIM_RADIUS - 0.012),
        (half * 0.72, RIM_RADIUS + 0.006),
    ]
    lathe(
        f"{name}-rim",
        open_curve(np.asarray(rim_profile), 22),
        centre,
        segments=96,
        material_name="rim",
        group=group,
        atlas=False,
        caps=(False, False),
    )
    outward = side
    face = centre[1] + outward * half * 0.42
    hub_profile = [
        (0.000, 0.052),
        (0.012, 0.050),
        (0.018, 0.040),
        (0.020, 0.028),
        (0.040, 0.026),
        (0.042, 0.016),
        (0.042, 0.0),
    ]
    lathe(
        f"{name}-hub",
        hub_profile,
        (centre[0], face, centre[2]),
        segments=36,
        sign=outward,
        material_name="rim-dark",
        group=group,
        atlas=False,
        caps=(True, False),
    )
    lathe(
        f"{name}-nut",
        [(0.044, 0.0), (0.044, 0.018), (0.070, 0.018), (0.070, 0.0)],
        (centre[0], face, centre[2]),
        segments=6,
        sign=outward,
        material_name="wheel-nut",
        group=group,
        atlas=False,
        sharp_angle=math.radians(20),
    )
    for k in range(SPOKES):
        angle = 2 * math.pi * k / SPOKES
        rings = []
        for t in np.linspace(0, 1, 18):
            radius = 0.048 + (RIM_RADIUS - 0.022 - 0.048) * t
            spin = angle + 0.20 * t * t
            width = 0.0205 - 0.008 * math.sin(math.pi * t) + 0.012 * t**4
            depth = outward * (0.004 + 0.046 * t**1.4)
            thick = 0.0125 - 0.005 * t
            cx, cz = math.cos(spin), math.sin(spin)
            tx, tz = -cz, cx
            profile = superellipse(1.0, 1.0, 3.0, 16)
            rings.append(
                [
                    (
                        centre[0] + cx * radius + tx * width * p[0],
                        face + depth + thick * p[1],
                        centre[2] + cz * radius + tz * width * p[0],
                    )
                    for p in profile
                ]
            )
        loft(f"{name}-spoke-{k}", np.asarray(rings), material_name="rim", group=group, atlas=False)
    lathe(
        f"{name}-lip",
        [(0.046, RIM_RADIUS + 0.004), (0.054, RIM_RADIUS + 0.008), (0.056, RIM_RADIUS - 0.006), (0.044, RIM_RADIUS - 0.012)],
        (centre[0], face, centre[2]),
        segments=96,
        sign=outward,
        material_name="rim-dark",
        group=group,
        atlas=False,
        caps=(False, False),
    )
    lathe(
        f"{name}-backing",
        [(0.0, 0.03), (0.0, RIM_RADIUS - 0.018)],
        (centre[0], centre[1] - outward * half * 0.10, centre[2]),
        segments=64,
        sign=outward,
        material_name="rim-dark",
        group=group,
        atlas=False,
        caps=(False, False),
    )
    inner_face = centre[1] - outward * half * 0.20
    pivot = name
    lathe(
        f"{name}-disc",
        [(0.0, 0.086), (0.0, 0.158), (0.008, 0.160), (0.012, 0.150), (0.016, 0.160), (0.024, 0.150), (0.028, 0.160), (0.032, 0.158), (0.032, 0.086)],
        (centre[0], inner_face, centre[2]),
        segments=96,
        sign=-outward,
        material_name="brake",
        group=group,
        atlas=False,
    )
    lathe(
        f"{name}-bell",
        [(-0.005, 0.040), (-0.004, 0.086), (0.040, 0.092), (0.046, 0.075), (0.046, 0.040)],
        (centre[0], inner_face, centre[2]),
        segments=48,
        sign=-outward,
        material_name="titanium",
        group=group,
        atlas=False,
    )
    for k, offset in enumerate((-0.52, 0.52)):
        cx = math.cos(math.pi - 0.72 + offset * 0.5) * 0.15
        cz = math.sin(math.pi - 0.72 + offset * 0.5) * 0.15
        tube(
            f"{name}-caliper-{k}",
            [
                (centre[0] + cx, inner_face - outward * 0.006, centre[2] + cz),
                (centre[0] + cx, inner_face - outward * 0.040, centre[2] + cz),
            ],
            0.032,
            0.024,
            power=3.0,
            samples=4,
            points=14,
            up=(0, 0, 1),
            material_name="caliper",
            group=pivot,
            atlas=False,
        )
    lathe(
        f"{name}-duct",
        [(0.05, 0.05), (0.052, 0.172), (0.06, 0.196), (0.085, 0.202), (0.092, 0.194), (0.098, 0.206), (0.112, 0.206), (0.13, 0.17), (0.13, 0.04)],
        (centre[0], inner_face - outward * 0.04, centre[2]),
        segments=48,
        sign=-outward,
        material_name="carbon-part",
        group=pivot,
        atlas=False,
    )
    tube(
        f"{name}-duct-scoop",
        [
            (centre[0] + 0.24, inner_face - outward * 0.10, centre[2] + 0.04),
            (centre[0] + 0.10, inner_face - outward * 0.09, centre[2] + 0.06),
        ],
        0.038,
        0.055,
        power=2.6,
        samples=8,
        points=16,
        up=(0, 0, 1),
        material_name="carbon-part",
        group=pivot,
        atlas=False,
    )


def arm(name, start, end, chord=0.026, thick=0.0065, density=0.6):
    tube(name, [start, end], chord, thick, power=3.5, samples=8, points=16, density=density)


def suspension(spec, side):
    label = f"{spec['name']}{'l' if side > 0 else 'r'}"
    x = spec["x"]
    flip = np.array([1, side, 1])
    point = lambda p: tuple(np.array(p) * flip)
    if spec["name"] == "f":
        top = point((x, 0.590, 0.525))
        low = point((x, 0.600, 0.215))
        arm(f"susp-upper-a-{label}", point((1.78, 0.150, 0.445)), top, 0.044, 0.0065, 1.4)
        arm(f"susp-upper-b-{label}", point((1.30, 0.190, 0.500)), top, 0.016, 0.0075)
        arm(f"susp-lower-a-{label}", point((1.70, 0.150, 0.215)), low, 0.040, 0.0065, 1.2)
        arm(f"susp-lower-b-{label}", point((1.30, 0.180, 0.195)), low, 0.016, 0.0075)
        arm(f"susp-push-{label}", point((x - 0.03, 0.575, 0.235)), point((1.55, 0.165, 0.445)), 0.016, 0.0075)
        arm(f"susp-toe-{label}", point((x + 0.13, 0.585, 0.300)), point((1.86, 0.120, 0.285)), 0.014, 0.0065)
    else:
        top = point((x, 0.545, 0.525))
        low = point((x, 0.550, 0.195))
        arm(f"susp-upper-a-{label}", point((-1.28, 0.120, 0.395)), top)
        arm(f"susp-upper-b-{label}", point((-1.93, 0.040, 0.340)), top)
        arm(f"susp-lower-a-{label}", point((-1.25, 0.130, 0.160)), low)
        arm(f"susp-lower-b-{label}", point((-1.93, 0.045, 0.245)), low)
        arm(f"susp-push-{label}", point((x + 0.03, 0.530, 0.230)), point((-1.56, 0.075, 0.420)), 0.016, 0.0075)
        arm(f"susp-toe-{label}", point((x - 0.13, 0.535, 0.260)), point((-1.90, 0.055, 0.290)), 0.014, 0.0065)


def duct_vanes(spec, side, corner):
    name = f"wheel-{spec['name']}{corner}"
    x = spec["x"]
    z = spec["radius"]
    plane = spec["y"] - spec["width"] / 2 - 0.052
    for i, height in enumerate((0.060, 0.022, -0.016)):
        y0 = plane - 0.008
        y1 = plane - 0.092
        path = np.array(
            [
                (x + 0.205, side * y0, z + height),
                (x + 0.150, side * ((y0 + y1) / 2), z + height + 0.010),
                (x + 0.115, side * y1, z + height + 0.006),
            ]
        )
        tube(f"duct-vane-{i}.{corner}", path, 0.028, 0.0028, power=3.0, samples=12, points=12, group=name, density=0.9)


def build_running():
    for spec in (FRONT, REAR):
        for side, corner in ((1, "l"), (-1, "r")):
            wheel(spec, side, corner)
            suspension(spec, side)
            if spec["name"] == "f":
                duct_vanes(spec, side, corner)
