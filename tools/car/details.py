import numpy as np

from shapes import both, loft, open_curve, plate, superellipse, sweep, tube


def blade(name, control, chord, thick=0.0035, up=(0, 0, 1), samples=18, density=0.9):
    path = open_curve(np.asarray(control, np.float64), samples)
    both(name, sweep(path, chord, thick, 3.2, 12, up=up), density=density)


def nose_pods():
    for side, name in ((1, "l"), (-1, "r")):
        rings = []
        for x, scale in ((1.40, 0.3), (1.37, 0.85), (1.32, 1.0), (1.24, 0.95), (1.18, 0.4)):
            ring = superellipse(0.016 * scale, 0.012 * scale, 2.4, 18, (side * 0.205, 0.492))
            rings.append(np.stack([np.full(18, x), ring[:, 0], ring[:, 1]], axis=-1))
        loft(f"nose-pod.{name}", rings, density=1.0)
        lens = superellipse(0.0055, 0.0055, 2.0, 12, (side * 0.205, 0.492))
        loft(
            f"nose-lens.{name}",
            [np.stack([np.full(12, x), lens[:, 0], lens[:, 1]], axis=-1) for x in (1.376, 1.379)],
            material_name="lens",
            atlas=False,
        )


def turning_vanes():
    for y, height, inset in ((0.115, 0.075, 0.0), (0.145, 0.060, 0.03)):
        outline = [
            (1.42 - inset, 0.165),
            (1.42 - inset, 0.165 - height),
            (1.16 - inset, 0.125 - height),
            (1.14 - inset, 0.135),
        ]
        plate(f"bib-vane-{y}", outline, y, 0.005, samples=24, density=0.8)


def floor_strakes():
    for i, (x, y) in enumerate(((-0.86, 0.72), (-0.98, 0.68), (-1.10, 0.63), (-1.22, 0.58))):
        blade(
            f"floor-strake-{i}",
            [(x + 0.07, y + 0.012, 0.074), (x, y, 0.078), (x - 0.07, y - 0.024, 0.074)],
            0.0035,
            0.020,
            up=(0, 0, 1),
            samples=10,
            density=0.7,
        )
    blade("floor-wing", [(0.32, 0.77, 0.095), (0.10, 0.78, 0.103), (-0.20, 0.78, 0.106), (-0.52, 0.75, 0.098)], 0.024, 0.003, density=0.8)


def shoulder_vanes():
    blade("shoulder-vane-a", [(0.02, 0.40, 0.590), (-0.12, 0.42, 0.578), (-0.28, 0.43, 0.552)], 0.0035, 0.018, samples=12)
    blade("shoulder-vane-b", [(0.02, 0.52, 0.565), (-0.10, 0.535, 0.552), (-0.24, 0.535, 0.525)], 0.0035, 0.016, samples=12)


def airbox_ears():
    for side, name in ((1, "l"), (-1, "r")):
        rings = []
        for x, scale in ((-0.24, 1.0), (-0.30, 1.0), (-0.42, 0.45)):
            ring = superellipse(0.030 * scale, 0.022 * scale, 2.6, 20, (side * 0.115, 0.800))
            rings.append(np.stack([np.full(20, x), ring[:, 0], ring[:, 1]], axis=-1))
        loft(f"airbox-ear.{name}", rings, density=0.9)
        mouth = superellipse(0.023, 0.015, 2.6, 20, (side * 0.115, 0.800))
        loft(
            f"airbox-ear-mouth.{name}",
            [np.stack([np.full(20, x), mouth[:, 0], mouth[:, 1]], axis=-1) for x in (-0.238, -0.25)],
            material_name="void",
            atlas=False,
        )


def rear_wing_details():
    for i, z in enumerate((0.84, 0.81, 0.78)):
        blade(
            f"rw-strake-{i}",
            [(-2.34, 0.565, z), (-2.23, 0.567, z + 0.004), (-2.11, 0.565, z + 0.002)],
            0.0025,
            0.008,
            samples=8,
            density=0.7,
        )
    both(
        "rw-gurney",
        sweep(
            open_curve(np.array([(-2.335, 0.0, 0.905), (-2.335, 0.28, 0.912), (-2.335, 0.54, 0.930)]), 16),
            0.0035,
            0.007,
            3.0,
            8,
            up=(1, 0, 0),
        ),
        density=0.6,
    )
    tube("rw-rod", [(-1.99, 0.0, 0.62), (-2.19, 0.0, 0.73)], 0.007, samples=6, points=10, material_name="titanium", atlas=False)


def rear_brake_winglets():
    for i, (z, chord) in enumerate(((0.66, 0.05), (0.695, 0.045), (0.73, 0.04))):
        blade(
            f"rear-duct-wing-{i}",
            [(-1.60, 0.41, z), (-1.65, 0.46, z + 0.006), (-1.70, 0.525, z + 0.002)],
            chord,
            0.003,
            samples=12,
        )
    outline = [(-1.56, 0.42), (-1.56, 0.75), (-1.78, 0.75), (-1.78, 0.42)]
    plate("rear-duct-plate", outline, 0.532, 0.005, samples=20, density=0.7)


def diffuser_details():
    blade("diffuser-lip", [(-2.135, 0.0, 0.283), (-2.14, 0.26, 0.268), (-2.14, 0.51, 0.236)], 0.012, 0.003, samples=16, density=0.7)
    outline = [(-1.86, 0.215), (-1.86, 0.145), (-1.62, 0.105), (-1.56, 0.135)]
    plate("diffuser-mouse", outline, 0.532, 0.004, samples=20, density=0.7)
    for i, (x, z) in enumerate(((-1.58, 0.11), (-1.72, 0.14))):
        blade(f"floor-tail-{i}", [(x, 0.49, z), (x - 0.04, 0.52, z + 0.012), (x - 0.08, 0.545, z + 0.016)], 0.022, 0.003, samples=10, density=0.7)


def rear_brake_winglets():
    for i, (z, chord) in enumerate(((0.66, 0.05), (0.695, 0.045), (0.73, 0.04))):
        blade(
            f"rear-duct-wing-{i}",
            [(-1.64, 0.43, z), (-1.70, 0.50, z + 0.006), (-1.75, 0.565, z + 0.002)],
            chord,
            0.003,
            samples=12,
        )
    outline = [(-1.58, 0.42), (-1.58, 0.75), (-1.80, 0.75), (-1.80, 0.42)]
    plate("rear-duct-plate", outline, 0.575, 0.005, samples=20, density=0.7)


def build_details():
    nose_pods()
    turning_vanes()
    floor_strakes()
    shoulder_vanes()
    airbox_ears()
    rear_wing_details()
    rear_brake_winglets()
    diffuser_details()
