import numpy as np

from shapes import both, loft, open_curve, plate, superellipse, sweep, tube, wing


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
    dip = lambda y: 0.024 * (1 - (y / 0.55) ** 2)
    both(
        "rw-gurney",
        sweep(
            open_curve(np.array([(-2.362, y, 0.966 - 0.4 * dip(y)) for y in (0.0, 0.18, 0.36, 0.54)]), 20),
            0.0030,
            0.0060,
            3.0,
            8,
            up=(1, 0, 0),
        ),
        density=0.6,
    )


def floor_boards():
    for k, (y, top) in enumerate(((0.792, 0.300), (0.748, 0.262), (0.705, 0.224))):
        outline = [(1.052, 0.072), (1.050, top), (0.985, top + 0.010), (0.80, top - 0.035), (0.66, 0.140), (0.62, 0.072)]
        plate(f"floor-board-{k}", outline, y, 0.004, samples=40, density=0.8, lean=lambda x, z: -0.12 * (1.05 - x))


def halo_wing():
    wing("halo-wing", [(0.0, 0.640, 0.872, 0.060, 7), (0.07, 0.636, 0.871, 0.058, 7), (0.125, 0.628, 0.868, 0.050, 6)], samples=16, thickness=0.09, camber=0.06, points=24, density=1.4)
    for side in (1, -1):
        tube(f"halo-wing-strut.{side}", [(0.598, side * 0.075, 0.846), (0.606, side * 0.075, 0.872)], 0.010, 0.0022, samples=4, points=10, up=(0, 1, 0), density=1.0)


def harness():
    for side in (1, -1):
        tube(f"belt-shoulder.{side}", [(-0.05, side * 0.07, 0.585), (0.05, side * 0.065, 0.575), (0.20, side * 0.055, 0.50)], 0.022, 0.003, samples=12, points=10, material_name="headrest", atlas=False, up=(0, 0, 1))
        tube(f"belt-buckle.{side}", [(0.205, side * 0.052, 0.498), (0.235, side * 0.048, 0.486)], 0.016, 0.006, samples=3, points=10, material_name="titanium", atlas=False, up=(0, 0, 1))


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
    floor_boards()
    halo_wing()
    harness()
