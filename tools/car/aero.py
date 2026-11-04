import numpy as np

from design import param
from shapes import both, box, closed_curve, loft, plate, spanwise, superellipse, sweep, tube, wing, wing_rings

FRONT_SPAN = 0.85
WING_TIP = 0.842
REAR_SPAN = 0.55
CLIPS = 7


def leading(y):
    return 2.914 - param("wingSweep", 0.30) * y / FRONT_SPAN


def trailing(y):
    return 2.36 - 0.322 * min(y, 0.60)


def inner_rise(y, amount):
    return amount * (0.5 + 0.5 * np.cos(np.pi * np.clip(y / 0.26, 0, 1)))


def outer_rise(y, amount):
    return param("wingRise", 1.0) * amount * np.clip((y - 0.42) / (WING_TIP - 0.42), 0, 1) ** 1.8


FRONT_ENDPLATES = (
    [(2.600, 0.052), (2.645, 0.120), (2.640, 0.170), (2.590, 0.225), (2.470, 0.300), (2.320, 0.362), (2.200, 0.374), (2.150, 0.335), (2.148, 0.120), (2.215, 0.058), (2.400, 0.044)],
    [(2.612, 0.052), (2.634, 0.200), (2.585, 0.335), (2.440, 0.380), (2.220, 0.384), (2.150, 0.352), (2.148, 0.120), (2.215, 0.058), (2.400, 0.044)],
    [(2.640, 0.052), (2.672, 0.110), (2.665, 0.175), (2.570, 0.232), (2.400, 0.290), (2.255, 0.360), (2.172, 0.372), (2.150, 0.300), (2.148, 0.120), (2.215, 0.058), (2.400, 0.044)],
)
REAR_ENDPLATES = (
    [(-1.900, 0.720), (-1.915, 0.800), (-1.970, 0.880), (-2.100, 0.940), (-2.280, 0.975), (-2.380, 0.980), (-2.420, 0.960), (-2.420, 0.800), (-2.360, 0.700), (-2.220, 0.640), (-2.040, 0.630), (-1.940, 0.660)],
    [(-1.895, 0.700), (-1.900, 0.880), (-1.940, 0.950), (-2.200, 0.976), (-2.400, 0.982), (-2.430, 0.960), (-2.430, 0.700), (-2.360, 0.620), (-2.100, 0.600), (-1.950, 0.620)],
    [(-1.920, 0.760), (-1.980, 0.870), (-2.130, 0.940), (-2.300, 0.976), (-2.430, 0.990), (-2.450, 0.930), (-2.400, 0.780), (-2.260, 0.660), (-2.060, 0.620), (-1.960, 0.650)],
)
FRONT_ELEMENTS = (
    ("fw-main", 0.00, 0.52, 0.068, 0.045, 0.062, 4.0, 0.0, 3.0, 0.026, 0.035, 36),
    ("fw-flap1", 0.44, 0.31, 0.094, 0.030, 0.090, 19.0, 8.0, 6.0, 0.030, 0.050, 32),
    ("fw-flap2", 0.70, 0.27, 0.132, 0.020, 0.118, 36.0, 12.0, 8.0, 0.034, 0.060, 32),
)


def front_station(y, start, share, base, inner, outer, pitch, slope, extra):
    chord = leading(y) - trailing(y)
    angle = pitch + slope * min(y, 0.6) + extra * max(y - 0.6, 0) / (WING_TIP - 0.6)
    return (y, leading(y) - start * chord, base + inner_rise(y, inner) + outer_rise(y, outer), share * chord, angle)


def element_rings(spec, samples=64):
    _, start, share, base, inner, outer, pitch, slope, extra, thickness, camber, points = spec
    ys = np.array([0.0, 0.07, 0.15, 0.25, 0.36, 0.48, 0.58, 0.68, 0.76, WING_TIP])
    stations = [front_station(y, start, share, base, inner, outer, pitch, slope, extra) for y in ys]
    return wing_rings(spanwise(stations, samples), thickness, camber, points), stations


def tip_curl():
    lip = np.array([(0.000, 0.000), (0.024, -0.005), (0.048, 0.003), (0.064, 0.024), (0.073, 0.058), (0.071, 0.086), (0.064, 0.100)])
    rings = []
    for x in np.linspace(2.615, 2.205, 26):
        t = (2.615 - x) / 0.41
        scale = 0.30 + 0.70 * np.sin(np.pi * np.clip(t * 2.2, 0, 1) / 2) * (1 - 0.25 * t)
        path = lip * scale
        tangent = np.gradient(path, axis=0)
        normal = np.stack([-tangent[:, 1], tangent[:, 0]], axis=-1)
        normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-9)
        outline = np.concatenate([path + normal * 0.0022, (path - normal * 0.0022)[::-1]], axis=0)
        rings.append(np.stack([np.full(len(outline), x), FRONT_SPAN + outline[:, 0], 0.050 + 0.004 * t + outline[:, 1]], axis=-1))
    both("fw-tip", np.asarray(rings), sharp_angle=np.radians(50), density=0.8)


def flap_hardware(rings, stations):
    samples = np.linspace(stations[0][0], stations[-1][0], len(rings))
    half = rings.shape[1] // 2
    upper = rings[:, half - 6]
    lift = np.array([0.006, 0.0, 0.013])
    rod = []
    for y in np.linspace(0.14, 0.80, 28):
        i = int(np.argmin(np.abs(samples - y)))
        rod.append(upper[i] + lift)
    rod = np.asarray(rod)
    for side in (1, -1):
        flip = np.array([1, side, 1])
        tube(f"fw-rod.{side}", rod * flip, 0.0024, samples=40, points=10, material_name="carbon-part", atlas=False, up=(0, 0, 1))
        for k, y in enumerate(np.linspace(0.18, 0.78, CLIPS)):
            i = int(np.argmin(np.abs(samples - y)))
            top = upper[i] + lift
            foot = upper[i] - lift * 0.15
            tube(f"fw-clip-{k}.{side}", np.array([top, (top + foot) / 2 + np.array([0.003, 0, 0]), foot]) * flip, 0.0042, 0.0016, samples=6, points=10, material_name="titanium", atlas=False, up=(0, 1, 0))


def front_wing():
    made = {}
    for spec in FRONT_ELEMENTS:
        rings, stations = element_rings(spec)
        both(spec[0], rings)
        made[spec[0]] = (rings, stations)
    flap_hardware(*made["fw-flap2"])
    outline = FRONT_ENDPLATES[param("endplate", 0)]
    plate("fw-endplate", outline, FRONT_SPAN, 0.008, samples=140, lean=lambda x, z: -0.02 * (z - 0.06))
    tip_curl()
    for k, (x, z) in enumerate(((2.56, 0.16), (2.36, 0.30), (2.22, 0.20))):
        bolt = superellipse(0.0045, 0.0045, 2.0, 12, (0.0, z))
        lift = -0.02 * (z - 0.06)
        for side in (1, -1):
            y = side * (FRONT_SPAN + lift + 0.004)
            loft(f"fw-bolt-{k}.{side}", [np.stack([x + bolt[:, 0], np.full(12, y + side * d), bolt[:, 1]], axis=-1) for d in (0.0, 0.0025)], material_name="titanium", atlas=False)
    outline = [(2.600, 0.036), (2.630, 0.046), (2.380, 0.050), (2.160, 0.054), (2.160, 0.040), (2.380, 0.034)]
    path = closed_curve(outline, 48)
    rings = np.stack([np.stack([path[:, 0], np.full(48, y), path[:, 1]], axis=-1) for y in (0.856, 0.800)])
    both("fw-footplate", rings)
    for k, y in enumerate((0.40, 0.58, 0.74)):
        drop = 0.040 if k < 2 else 0.044
        outline = [(2.625 - 0.07 * k, 0.066), (2.62 - 0.07 * k, drop), (2.32, drop - 0.004), (2.25, 0.060)]
        plate(f"fw-strake-{k}", outline, y, 0.0035, samples=24, density=0.7)
    both(
        "nose-pad",
        sweep(np.linspace((2.03, 0.205, 0.120), (1.85, 0.205, 0.120), 8), 0.068, 0.010, 4.0, 14, up=(0, 0, 1)),
        density=0.7,
    )


def rear_wing():
    ys = np.array([0.0, 0.14, 0.28, 0.42, REAR_SPAN])
    dip = lambda y: 0.024 * (1 - (y / REAR_SPAN) ** 2)
    main = [(y, -1.92, 0.755 - dip(y), 0.270, 8) for y in ys]
    flap = [(y, -2.165, 0.800 - dip(y) * 0.6, 0.160, 28) for y in ys]
    upper = [(y, -2.290, 0.882 - dip(y) * 0.4, 0.110, 48) for y in ys]
    wing("rw-main", main, samples=56, thickness=0.040, camber=0.06, points=32)
    wing("rw-flap", flap, samples=56, thickness=0.045, camber=0.07, points=32)
    wing("rw-flap2", upper, samples=56, thickness=0.050, camber=0.07, points=32)
    outline = REAR_ENDPLATES[param("rearEndplate", 0)]
    plate("rw-endplate", outline, REAR_SPAN, 0.012, samples=140, lean=lambda x, z: 0.03 * np.clip(0.75 - z, 0, 1))
    pod = [(-2.020, 0.772), (-2.090, 0.845), (-2.200, 0.912), (-2.290, 0.950), (-2.330, 0.935), (-2.260, 0.872), (-2.150, 0.808), (-2.060, 0.765)]
    plate("rw-pod", pod, 0.0, 0.016, side=1, samples=60, density=1.2)
    for k, y in enumerate((0.10, 0.26, 0.42)):
        for side in (1, -1):
            z = -dip(y) * 0.6
            tube(
                f"rw-hinge-{k}.{side}",
                [(-2.140, side * y, 0.788 + z), (-2.168, side * y, 0.822 + z), (-2.196, side * y, 0.826 + z)],
                0.0055,
                0.0022,
                samples=8,
                points=10,
                material_name="titanium",
                atlas=False,
                up=(0, 1, 0),
            )
    for side in (1, -1):
        y = side * (REAR_SPAN + 0.0085)
        x0, x1 = (-2.432, -2.418) if param("rearEndplate", 0) < 2 else (-2.452, -2.438)
        box(f"rw-led.{side}", (x0, y - 0.0025, 0.800), (x1, y + 0.0025, 0.950), material_name="led-red", atlas=False)
    panel = superellipse(0.040, 0.030, 5.0, 28, (0.0, 0.302))
    loft("rain-panel", [np.stack([np.full(28, x), panel[:, 0], panel[:, 1]], axis=-1) for x in (-2.50, -2.507)], material_name="void", atlas=False)
    for row in range(5):
        for column in range(7):
            y = (column - 3) * 0.0098
            z = 0.302 + (row - 2) * 0.0098
            dot = superellipse(0.0032, 0.0032, 2.0, 10, (y, z))
            loft(f"rain-led-{row}-{column}", [np.stack([np.full(10, x), dot[:, 0], dot[:, 1]], axis=-1) for x in (-2.507, -2.5095)], material_name="led-red", atlas=False)
    twin = param("neck", "twin") == "twin"
    for side in (1, -1) if twin else (0,):
        y = 0.035 if twin else 0.0
        start = (-1.600, side * y, 0.440) if twin else (-1.760, 0.0, 0.400)
        tube(
            f"rw-neck.{side}",
            [start, (-1.700, side * (y + 0.004), 0.660), (-1.820, side * (y + 0.008), 0.800), (-1.920, side * (y + 0.010), 0.818), (-2.000, side * (y + 0.010), 0.774)],
            0.024 if twin else 0.030,
            0.0050 if twin else 0.0075,
            samples=40,
            power=3.0,
            up=(0, 1, 0),
            points=16,
            density=1.2,
        )


def build_aero():
    front_wing()
    rear_wing()
