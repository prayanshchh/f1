import numpy as np

from design import param
from shapes import both, box, closed_curve, loft, open_curve, plate, superellipse, sweep, tube, wing

FLAP_SPAN = 0.66
FRONT_SPAN = 0.85
REAR_SPAN = 0.55


def leading(y):
    return 2.914 - param("wingSweep", 0.30) * y / FRONT_SPAN


def trailing(y):
    return 2.36 - 0.322 * min(y, 0.60)


def inner_rise(y, amount):
    return amount * (0.5 + 0.5 * np.cos(np.pi * np.clip(y / 0.26, 0, 1)))


def outer_rise(y, amount):
    return param("wingRise", 1.0) * amount * np.clip((y - 0.30) / 0.36, 0, 1) ** 1.3


FRONT_ENDPLATES = (
    [(2.625, 0.070), (2.645, 0.125), (2.565, 0.205), (2.41, 0.285), (2.23, 0.330), (2.10, 0.322), (2.09, 0.210), (2.14, 0.085), (2.36, 0.050)],
    [(2.60, 0.070), (2.615, 0.20), (2.56, 0.315), (2.40, 0.355), (2.22, 0.355), (2.11, 0.335), (2.10, 0.20), (2.15, 0.085), (2.36, 0.050)],
    [(2.65, 0.070), (2.665, 0.11), (2.54, 0.17), (2.38, 0.225), (2.22, 0.265), (2.09, 0.275), (2.08, 0.18), (2.14, 0.08), (2.36, 0.050)],
)
REAR_ENDPLATES = (
    [(-1.895, 0.745), (-1.925, 0.835), (-2.01, 0.900), (-2.20, 0.930), (-2.385, 0.925), (-2.490, 0.895), (-2.470, 0.770), (-2.300, 0.610), (-2.120, 0.500), (-1.985, 0.520), (-1.91, 0.640)],
    [(-1.895, 0.70), (-1.90, 0.86), (-1.95, 0.925), (-2.20, 0.935), (-2.42, 0.935), (-2.49, 0.92), (-2.49, 0.72), (-2.40, 0.58), (-2.16, 0.50), (-1.98, 0.50), (-1.91, 0.60)],
    [(-1.90, 0.76), (-1.97, 0.86), (-2.12, 0.915), (-2.30, 0.945), (-2.47, 0.965), (-2.50, 0.90), (-2.44, 0.74), (-2.26, 0.60), (-2.08, 0.51), (-1.97, 0.54), (-1.91, 0.66)],
)


def front_wing():
    ys = np.array([0.0, 0.07, 0.15, 0.25, 0.36, 0.48, 0.58, FLAP_SPAN])
    flap_ys = np.array([0.08, 0.15, 0.25, 0.36, 0.48, 0.58, FLAP_SPAN])

    def station(y, start, share, base, inner, outer, pitch):
        chord = leading(y) - trailing(y)
        return (y, leading(y) - start * chord, base + inner_rise(y, inner) + outer_rise(y, outer), share * chord, pitch)

    main = [station(y, 0.0, 0.54, 0.070, 0.045, 0.030, 5) for y in ys]
    flap_one = [station(y, 0.46, 0.32, 0.098, 0.030, 0.075, 20 + 8 * y) for y in flap_ys]
    flap_two = [station(y, 0.72, 0.28, 0.140, 0.020, 0.135, 40 + 14 * y) for y in flap_ys]
    wing("fw-main", main, samples=64, thickness=0.030, camber=0.035, points=36)
    wing("fw-flap1", flap_one, samples=64, thickness=0.032, camber=0.05, points=32)
    wing("fw-flap2", flap_two, samples=64, thickness=0.040, camber=0.06, points=32)
    wing(
        "fw-outer",
        [(FLAP_SPAN - 0.01, leading(FLAP_SPAN), 0.102, 0.60, 3), (0.75, leading(0.75), 0.082, 0.54, 3), (FRONT_SPAN - 0.005, leading(FRONT_SPAN), 0.066, 0.53, 3)],
        samples=14,
        thickness=0.020,
        camber=0.02,
        points=28,
    )
    wing(
        "fw-plane",
        [(FLAP_SPAN + 0.002, 2.47, 0.272, 0.36, 5), (0.75, 2.45, 0.285, 0.35, 5), (FRONT_SPAN - 0.004, 2.43, 0.292, 0.33, 5)],
        samples=14,
        thickness=0.022,
        camber=0.03,
        points=26,
    )
    outline = FRONT_ENDPLATES[param("endplate", 0)]
    plate("fw-endplate", outline, FRONT_SPAN, 0.010, samples=120, lean=lambda x, z: 0.08 * (z - 0.06))
    plate("fw-inner-plate", outline, FLAP_SPAN, 0.007, samples=80, lean=lambda x, z: -0.03 * (z - 0.06))
    outline = [(2.625, 0.040), (2.655, 0.052), (2.36, 0.056), (2.10, 0.058), (2.10, 0.042), (2.36, 0.036)]
    path = closed_curve(outline, 48)
    rings = np.stack(
        [np.stack([path[:, 0], np.full(48, y), path[:, 1]], axis=-1) for y in (0.858, 0.76)]
    )
    both("fw-footplate", rings)
    both(
        "fw-tunnel",
        sweep(open_curve([(2.60, 0.72, 0.052), (2.36, 0.74, 0.054), (2.12, 0.79, 0.056)], 24), 0.004, 0.022, 3.0, 10),
    )
    both(
        "nose-pad",
        sweep(np.linspace((2.03, 0.205, 0.120), (1.85, 0.205, 0.120), 8), 0.068, 0.010, 4.0, 14, up=(0, 0, 1)),
        density=0.7,
    )


def rear_wing():
    ys = np.array([0.0, 0.14, 0.28, 0.42, REAR_SPAN])
    dip = lambda y: 0.024 * (1 - (y / REAR_SPAN) ** 2)
    main = [(y, -1.90, 0.760 - dip(y), 0.292, 9) for y in ys]
    flap = [(y, -2.180, 0.812 - dip(y) * 0.6, 0.205, 38) for y in ys]
    wing("rw-main", main, samples=48, thickness=0.045, camber=0.06, points=32)
    wing("rw-flap", flap, samples=48, thickness=0.05, camber=0.07, points=32)
    outline = REAR_ENDPLATES[param("rearEndplate", 0)]
    plate("rw-endplate", outline, REAR_SPAN, 0.012, samples=140, lean=lambda x, z: 0.03 * np.clip(0.65 - z, 0, 1))
    outline = [(-1.91, 0.660), (-2.08, 0.470), (-2.03, 0.29), (-1.97, 0.27), (-1.88, 0.50)]
    plate("rw-endplate-lower", outline, REAR_SPAN - 0.02, 0.008, samples=60, lean=lambda x, z: 0.05 * np.clip(0.60 - z, 0, 1))
    tube(
        "rw-actuator",
        [(-2.14, 0.0, 0.70), (-2.20, 0.0, 0.79), (-2.22, 0.0, 0.83)],
        0.020,
        0.014,
        samples=12,
        points=12,
        up=(1, 0, 0),
    )
    for y in (-0.54, -0.21, 0.0, 0.21, 0.54):
        tag = superellipse(0.0065, 0.0105, 4.0, 14, (y, 0.0))
        loft(f"rw-tab-{y}", [np.stack([-2.185 + tag[:, 1] * 1.4, tag[:, 0], np.full(14, z)], axis=-1) for z in (0.782, 0.802)], material_name="titanium", atlas=False)
    for side in (1, -1):
        y = side * (REAR_SPAN + 0.0085)
        box(f"rw-led.{side}", (-2.47, y - 0.0025, 0.650), (-2.45, y + 0.0025, 0.890), material_name="led-red", atlas=False)
    panel = superellipse(0.040, 0.030, 5.0, 28, (0.0, 0.302))
    loft("rain-panel", [np.stack([np.full(28, x), panel[:, 0], panel[:, 1]], axis=-1) for x in (-2.50, -2.507)], material_name="void", atlas=False)
    for row in range(5):
        for column in range(7):
            y = (column - 3) * 0.0098
            z = 0.302 + (row - 2) * 0.0098
            dot = superellipse(0.0032, 0.0032, 2.0, 10, (y, z))
            loft(f"rain-led-{row}-{column}", [np.stack([np.full(10, x), dot[:, 0], dot[:, 1]], axis=-1) for x in (-2.507, -2.5095)], material_name="led-red", atlas=False)
    for side in (1, -1) if param("neck", "twin") == "twin" else (0,):
        tube(
            f"rw-neck.{side}",
            [(-1.93, side * 0.022, 0.390), (-1.97, side * 0.024, 0.520), (-2.01, side * 0.026, 0.660), (-2.05, side * 0.028, 0.745)],
            0.0065 if side else 0.011,
            0.030 if side else 0.038,
            samples=26,
            power=3.0,
            up=(1, 0, 0.3),
            points=16,
            density=1.2,
        )


def build_aero():
    front_wing()
    rear_wing()
