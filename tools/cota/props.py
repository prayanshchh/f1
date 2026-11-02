import numpy as np

from pitlane import Frame
from trackside import UNIT, Batch, beam

WALL_CLEARANCE = 0.3
TENT_RUNS = ((3930.0, 4150.0, 1), (4250.0, 4340.0, -1), (1060.0, 1200.0, -1))
TENT_SPACING = 7.2
TENT_SIZE = 3.1
TENT_EAVE = 2.8
TENT_PEAK = 4.9
TENT_DECK = 3.4
TENT_BACK = 4.5
CRANE_SPOTS = ((640.0, -1), (1500.0, -1), (2300.0, 1), (2950.0, -1), (3820.0, 1), (4480.0, -1), (5180.0, 1), (130.0, 1))
CRANE_BOOM = 18.0
CRANE_RISE = 12.0
MAST_SPACING = 310.0
MAST_HEIGHT = 11.0
SCREEN_SPOTS = ((1720.0, 1), (2760.0, -1), (3600.0, 1), (4700.0, -1), (5300.0, 1))
SCREEN_SIZE = (9.0, 5.0)
SCREEN_LOW = 4.5
HUT_SPACING = 410.0
FLAG_SPACING = 75.0
MARQUEES = ((680.0, 42.0, 34.0, 15.0), (760.0, 58.0, 24.0, 13.0), (940.0, -46.0, 42.0, 16.0), (1410.0, 58.0, 36.0, 14.0), (2200.0, -56.0, 30.0, 14.0), (3920.0, 62.0, 40.0, 18.0), (4590.0, 58.0, 26.0, 13.0))
MARQUEE_EAVE = 4.2
MARQUEE_RIDGE = 7.0
WHEEL_SPOT = (1490.0, 118.0)
WHEEL_RADIUS = 28.0
WHEEL_CARS = 24
WHEEL_SPOKES = 12
SKYLINE_CENTRE = (-9800.0, 14900.0)
SKYLINE_TOWERS = 46
SKYLINE_SEED = 3


def basis(frame, s):
    tangent, normal = frame.basis(s)
    return np.array([tangent[0], tangent[1], 0.0]), np.array([normal[0], normal[1], 0.0])


def clear_of_track(track, point, reach=0.0):
    offset = track.position[:, :2] - np.asarray(point, float)[:2]
    distance = np.linalg.norm(offset, axis=1)
    nearest = int(np.argmin(distance))
    across = -offset[nearest] @ track.normal[nearest]
    wall = track.walls[nearest, 0 if across > 0 else 1]
    if track.pit_zone[nearest] and across > 0:
        wall = max(wall, track.pit["pitBarrier"])
    return distance[nearest] > wall + WALL_CLEARANCE + reach


def ground_lookup(build):
    data = np.load(build / "terrain.npz")
    xs, ys, heights = data["x"], data["y"], data["heights"]

    def at(x, y):
        i = int(np.clip(np.searchsorted(ys, y), 0, len(ys) - 1))
        j = int(np.clip(np.searchsorted(xs, x), 0, len(xs) - 1))
        return float(heights[i, j])

    return at


def outside(track, s, side):
    row = int((s % track.length) / track.length * track.count) % track.count
    wall = track.walls[row, 0 if side > 0 else 1]
    if side > 0 and track.pit_zone[row]:
        wall = max(wall, track.pit["pitBarrier"])
    return row, wall


def box(batch, centre, half, up):
    c = np.asarray(centre, float)
    hx, hy = np.asarray(half[0], float), np.asarray(half[1], float)
    corners = [c - hx - hy, c + hx - hy, c + hx + hy, c - hx + hy]
    lift = np.array([0, 0, up])
    for a, b in zip(corners, corners[1:] + corners[:1]):
        batch.add([a, b, b + lift, a + lift], UNIT)
    batch.add([p + lift for p in corners], UNIT)


def tent(cloth, steel, centre, tangent, normal):
    c = np.asarray(centre, float)
    t, n = tangent * TENT_SIZE, normal * TENT_SIZE
    corners = [c - t - n, c + t - n, c + t + n, c - t + n]
    for p in corners:
        beam(steel, p, p + np.array([0, 0, TENT_EAVE]), 0.08)
    eave = [p + np.array([0, 0, TENT_EAVE]) for p in corners]
    peak = c + np.array([0, 0, TENT_PEAK])
    for a, b in zip(eave, eave[1:] + eave[:1]):
        cloth.add([a, b, peak], [(0, 0), (1, 0), (0.5, 1)])
        cloth.add([a, b, b - np.array([0, 0, 0.4]), a - np.array([0, 0, 0.4])], UNIT)


def tents(batches, frame, track, ground):
    for start, end, side in TENT_RUNS:
        for s in np.arange(start, end, TENT_SPACING):
            row, wall = outside(track, s, side)
            lateral = side * (wall + TENT_BACK)
            tangent, normal = basis(frame, s)
            p = frame.at(s, lateral)
            near = frame.at(s, side * (wall + 0.6))
            far = frame.at(s, side * (wall + 10.0))
            half_t = tangent * TENT_SPACING / 2
            if not all(clear_of_track(track, q, 0.0) for q in (near - half_t, near + half_t, far - half_t, far + half_t)):
                continue
            if not clear_of_track(track, p, TENT_SIZE):
                continue
            base = ground(p[0], p[1])
            deck = base + TENT_DECK
            for a, b in ((near, far),):
                a2, b2 = a.copy(), b.copy()
                a2[2], b2[2] = base, base
                box(batches["dark"], (a2 + b2) / 2, (half_t, (b2 - a2) / 2), TENT_DECK)
            tent(batches["marquee"], batches["steel"], np.array([p[0], p[1], deck]), tangent, normal)


def crane(batches, frame, track, ground, s, side):
    row, wall = outside(track, s, side)
    p = frame.at(s, side * (wall + 3.5))
    if not clear_of_track(track, p, 1.6):
        return
    base = np.array([p[0], p[1], ground(p[0], p[1])])
    tangent, normal = basis(frame, s)
    colour = batches["crane"] if int(s) % 2 == 0 else batches["crane blue"]
    box(colour, base, (tangent * 1.6, normal * 1.1), 1.4)
    root = base + np.array([0, 0, 1.4])
    out = -normal * side * 0.82 + tangent * 0.35
    out = out / np.linalg.norm(out)
    tip = root + np.array([out[0], out[1], 0]) * CRANE_BOOM * 0.7 + np.array([0, 0, CRANE_RISE])
    beam(colour, root, tip, 0.42)
    beam(colour, root, root - np.array([out[0], out[1], 0]) * 3.5 - np.array([0, 0, 0.3]), 0.5)
    box(batches["dark"], tip - np.array([0, 0, 0.6]), (tangent * 0.4, normal * 0.35), 0.8)


def mast(batches, frame, track, ground, s, side):
    row, wall = outside(track, s, side)
    p = frame.at(s, side * (wall + 2.6))
    if not clear_of_track(track, p, 1.5):
        return
    base = np.array([p[0], p[1], ground(p[0], p[1])])
    tangent, normal = basis(frame, s)
    beam(batches["steel"], base, base + np.array([0, 0, MAST_HEIGHT]), 0.2)
    box(batches["dark"], base + np.array([0, 0, MAST_HEIGHT]) - normal * side * 0.2, (tangent * 0.5, normal * 0.25), 0.7)


def screen(batches, frame, track, ground, s, side):
    row, wall = outside(track, s, side)
    p = frame.at(s, side * (wall + 4.0))
    if not clear_of_track(track, p, SCREEN_SIZE[0] / 2):
        return
    base = np.array([p[0], p[1], ground(p[0], p[1])])
    tangent, _ = basis(frame, s)
    half = tangent * SCREEN_SIZE[0] / 2
    low = base + np.array([0, 0, SCREEN_LOW])
    high = low + np.array([0, 0, SCREEN_SIZE[1]])
    batches["screen"].add([low - half, low + half, high + half, high - half], UNIT)
    for sign in (-1, 1):
        foot = base + half * sign * 0.7
        beam(batches["steel"], foot, foot + np.array([0, 0, SCREEN_LOW + SCREEN_SIZE[1]]), 0.3)


def hut(batches, frame, track, ground, s, side):
    row, wall = outside(track, s, side)
    p = frame.at(s, side * (wall + 2.2))
    if not clear_of_track(track, p, 1.8):
        return
    base = np.array([p[0], p[1], ground(p[0], p[1])])
    tangent, normal = basis(frame, s)
    box(batches["hut"], base, (tangent * 1.0, normal * 0.8), 2.3)
    box(batches["dark"], base + np.array([0, 0, 2.3]), (tangent * 1.15, normal * 0.95), 0.12)
    box(batches["marshal"], base - normal * side * 0.9, (tangent * 0.3, normal * 0.2), 1.75)


def marquee(batches, frame, track, ground, s, lateral, length, width):
    tangent, normal = basis(frame, s)
    p = frame.at(s, lateral)
    if not clear_of_track(track, p, np.hypot(length, width) / 2):
        return
    base = np.array([p[0], p[1], ground(p[0], p[1])])
    t, n = tangent * length / 2, normal * width / 2
    corners = [base - t - n, base + t - n, base + t + n, base - t + n]
    eave = np.array([0, 0, MARQUEE_EAVE])
    for a, b in zip(corners, corners[1:] + corners[:1]):
        batches["marquee"].add([a, b, b + eave, a + eave], UNIT)
    ridge0, ridge1 = base - t + np.array([0, 0, MARQUEE_RIDGE]), base + t + np.array([0, 0, MARQUEE_RIDGE])
    batches["marquee"].add([corners[0] + eave, corners[1] + eave, ridge1, ridge0], UNIT)
    batches["marquee"].add([corners[2] + eave, corners[3] + eave, ridge0, ridge1], UNIT)
    batches["marquee"].add([corners[1] + eave, corners[2] + eave, ridge1], [(0, 0), (1, 0), (0.5, 1)])
    batches["marquee"].add([corners[3] + eave, corners[0] + eave, ridge0], [(0, 0), (1, 0), (0.5, 1)])


def wheel(batches, frame, track, ground, s, lateral):
    tangent, normal = basis(frame, s)
    p = frame.at(s, lateral)
    if not clear_of_track(track, p, WHEEL_RADIUS):
        return
    base = np.array([p[0], p[1], ground(p[0], p[1])])
    hub = base + np.array([0, 0, WHEEL_RADIUS + 3.0])
    axis = normal * 1.6
    rim = []
    for index in range(WHEEL_CARS * 2):
        angle = index / (WHEEL_CARS * 2) * 2 * np.pi
        rim.append(hub + tangent * np.cos(angle) * WHEEL_RADIUS + np.array([0, 0, np.sin(angle) * WHEEL_RADIUS]))
    for offset in (-axis, axis):
        for a, b in zip(rim, rim[1:] + rim[:1]):
            beam(batches["hut"], a + offset, b + offset, 0.28)
        for index in range(0, len(rim), len(rim) // WHEEL_SPOKES):
            beam(batches["hut"], hub + offset, rim[index] + offset, 0.14)
    for index in range(0, len(rim), 2):
        car = rim[index] - np.array([0, 0, 1.7])
        box(batches["marquee"], car, (tangent * 1.0, normal * 1.0), 2.0)
    for sign in (-1, 1):
        for offset in (-axis * 2, axis * 2):
            beam(batches["hut"], base + tangent * sign * 11 + offset, hub + offset * 0.5, 0.55)


def skyline(batches, ground_level):
    rng = np.random.default_rng(SKYLINE_SEED)
    cx, cy = SKYLINE_CENTRE
    for _ in range(SKYLINE_TOWERS):
        x = cx + rng.normal(0, 480)
        y = cy + rng.normal(0, 420)
        half = rng.uniform(14, 28)
        height = rng.uniform(40, 120) + rng.exponential(55)
        box(batches["skyline"], np.array([x, y, ground_level]), (np.array([half, 0.0, 0.0]), np.array([0.0, half, 0.0])), height)


def build(track, build_dir):
    frame = Frame(track)
    ground = ground_lookup(build_dir)
    batches = {name: Batch() for name in ("marquee", "steel", "dark", "crane", "crane blue", "screen", "hut", "marshal", "skyline")}
    tents(batches, frame, track, ground)
    for s, side in CRANE_SPOTS:
        crane(batches, frame, track, ground, s, side)
    side = 1
    for s in np.arange(60.0, track.length, MAST_SPACING):
        row, _ = outside(track, s, side)
        if not (side > 0 and track.pit_zone[row]):
            mast(batches, frame, track, ground, s, side)
        side = -side
    for s, side_screen in SCREEN_SPOTS:
        screen(batches, frame, track, ground, s, side_screen)
    side = -1
    for s in np.arange(200.0, track.length, HUT_SPACING):
        row, _ = outside(track, s, side)
        if not (side > 0 and track.pit_zone[row]):
            hut(batches, frame, track, ground, s, side)
        side = -side
    for s, lateral, length, width in MARQUEES:
        marquee(batches, frame, track, ground, s, lateral, length, width)
    wheel(batches, frame, track, ground, *WHEEL_SPOT)
    skyline(batches, 40.0)
    return batches
