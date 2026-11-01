import numpy as np

WALL_HEIGHT = 1.0
WALL_THICKNESS = 0.3
WALL_BURY = 2.5
BOARD_LENGTH = 4.0
BRAND_RUN = 24.0
BRAND_COUNT = 4
TECPRO_LENGTH = 3.0
TECPRO_RADIUS = 150.0
TECPRO_SPREAD = 50.0
FENCE_INSET = 0.15
FENCE_KNEE = 3.3
FENCE_TOP = 4.2
FENCE_LEAN = 0.6
FENCE_TILE = 0.15
POST_SPACING = 4.0
POST_SIZE = 0.1
CABLE_HEIGHTS = (1.6, 2.4, 3.2)
CABLE_SIZE = 0.025
RAIL_SIZE = 0.06


def wall_line(track, side):
    sign = 1 if side == 0 else -1
    rows = np.arange(track.count)
    offset = track.walls[:, side]
    xy = track.position[:, :2] + track.normal * (sign * offset)[:, None]
    base = track.surface_height(rows, sign * offset)
    step = np.linalg.norm(np.roll(xy, -1, 0) - xy, axis=1)
    along = np.concatenate([[0], np.cumsum(step)[:-1]])
    return sign, xy, base, along


def tecpro_mask(track, side, smooth):
    sign = 1 if side == 0 else -1
    k = smooth(track.curvature, 15.0 / (track.length / track.count))
    outside = (sign * k < 0) & (np.abs(k) > 1 / TECPRO_RADIUS)
    spread = int(round(TECPRO_SPREAD / (track.length / track.count)))
    window = np.ones(2 * spread + 1)
    padded = np.concatenate([outside[-spread:], outside, outside[:spread]]).astype(float)
    return np.convolve(padded, window, mode="valid") > 0


def quad(a, b, low, high):
    return [
        (a[0], a[1], low[0]),
        (b[0], b[1], low[1]),
        (b[0], b[1], high[1]),
        (a[0], a[1], high[0]),
    ]


class Batch:
    def __init__(self):
        self.vertices = []
        self.uvs = []
        self.faces = []

    def add(self, corners, uv):
        start = len(self.vertices)
        self.vertices += [tuple(float(c) for c in corner) for corner in corners]
        self.uvs += uv
        self.faces.append(tuple(range(start, start + len(corners))))

    def arrays(self):
        return np.array(self.vertices, float), self.faces, np.array(self.uvs, float)


UNIT = [(0, 0), (1, 0), (1, 1), (0, 1)]


def fence_lines(track, side, xy):
    sign = 1 if side == 0 else -1
    middle = xy + track.normal * (sign * FENCE_INSET)
    lean = middle - track.normal * (sign * FENCE_LEAN)
    return middle, lean


def walls(track, smooth):
    boards, tecpro, concrete, fence = Batch(), Batch(), Batch(), Batch()
    for side in (0, 1):
        sign, xy, base, along = wall_line(track, side)
        reading = 1 if side == 0 else -1
        mask = tecpro_mask(track, side, smooth)
        back = xy + track.normal * (sign * WALL_THICKNESS)
        middle, lean = fence_lines(track, side, xy)
        slant = np.hypot(FENCE_LEAN, FENCE_TOP - FENCE_KNEE)
        for i in range(track.count):
            j = (i + 1) % track.count
            if not track.rails[i, side]:
                continue
            s0, s1 = along[i], along[i] + np.linalg.norm(xy[j] - xy[i])
            ground = (base[i], base[j])
            buried = (base[i] - WALL_BURY, base[j] - WALL_BURY)
            top = (base[i] + WALL_HEIGHT, base[j] + WALL_HEIGHT)
            face = quad(xy[i], xy[j], ground, top)
            if mask[i]:
                u0, u1 = reading * s0 / TECPRO_LENGTH, reading * s1 / TECPRO_LENGTH
                tecpro.add(face, [(u0, 0), (u1, 0), (u1, 1), (u0, 1)])
            else:
                brand = int(s0 // BRAND_RUN) % BRAND_COUNT
                v0, v1 = 1 - (brand + 1) / BRAND_COUNT, 1 - brand / BRAND_COUNT
                u0, u1 = reading * s0 / BOARD_LENGTH, reading * s1 / BOARD_LENGTH
                boards.add(face, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
            concrete.add(
                [(*xy[i], top[0]), (*xy[j], top[1]), (*back[j], top[1]), (*back[i], top[0])],
                [(s0, 0), (s1, 0), (s1, WALL_THICKNESS), (s0, WALL_THICKNESS)],
            )
            concrete.add(quad(back[i], back[j], buried, top), [(s0, 0), (s1, 0), (s1, 1), (s0, 1)])
            concrete.add(quad(xy[i], xy[j], buried, ground), [(s0, 0), (s1, 0), (s1, 1), (s0, 1)])
            for row, open_end in ((i, not track.rails[i - 1, side]), (j, not track.rails[j, side])):
                if open_end:
                    concrete.add(
                        quad(xy[row], back[row], (base[row] - WALL_BURY,) * 2, (base[row] + WALL_HEIGHT,) * 2),
                        UNIT,
                    )
            knee = (base[i] + FENCE_KNEE, base[j] + FENCE_KNEE)
            high = (base[i] + FENCE_TOP, base[j] + FENCE_TOP)
            a0, a1 = s0 / FENCE_TILE, s1 / FENCE_TILE
            h0, h1 = WALL_HEIGHT / FENCE_TILE, FENCE_KNEE / FENCE_TILE
            h2 = h1 + slant / FENCE_TILE
            fence.add(quad(middle[i], middle[j], top, knee), [(a0, h0), (a1, h0), (a1, h1), (a0, h1)])
            fence.add(
                [(*middle[i], knee[0]), (*middle[j], knee[1]), (*lean[j], high[1]), (*lean[i], high[0])],
                [(a0, h1), (a1, h1), (a1, h2), (a0, h2)],
            )
    return boards, tecpro, concrete, fence


def beam(batch, bottom, top, size):
    axis = top - bottom
    length = np.linalg.norm(axis)
    if length < 1e-6:
        return
    axis /= length
    helper = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    offsets = [(u + v) * size / 2, (u - v) * size / 2, (-u - v) * size / 2, (-u + v) * size / 2]
    for a, b in zip(offsets, offsets[1:] + offsets[:1]):
        batch.add([bottom + a, bottom + b, top + b, top + a], UNIT)


def metalwork(track):
    steel = Batch()
    for side in (0, 1):
        _, xy, base, along = wall_line(track, side)
        middle, lean = fence_lines(track, side, xy)
        next_post = 0.0
        previous = None
        for i in range(track.count):
            if not track.rails[i, side]:
                previous = None
                continue
            if along[i] < next_post:
                continue
            post = (middle[i], lean[i], base[i])
            foot = np.array([*middle[i], base[i] + WALL_HEIGHT])
            knee = np.array([*middle[i], base[i] + FENCE_KNEE])
            tip = np.array([*lean[i], base[i] + FENCE_TOP])
            beam(steel, foot, knee, POST_SIZE)
            beam(steel, knee, tip, POST_SIZE)
            if previous is not None:
                p_middle, p_lean, p_base = previous
                for height in CABLE_HEIGHTS:
                    beam(steel, np.array([*p_middle, p_base + height]), np.array([*middle[i], base[i] + height]), CABLE_SIZE)
                beam(steel, np.array([*p_lean, p_base + FENCE_TOP]), tip, RAIL_SIZE)
            previous = post
            next_post = along[i] + POST_SPACING
    return steel


DISTANCE_MARKS = (300.0, 200.0, 100.0)
DISTANCE_SIZE = 1.4
DISTANCE_LIFT = 0.6
DISTANCE_WALL_CLEARANCE = 0.3
DISTANCE_ASPHALT_CLEARANCE = 1.5
DISTANCE_CORNER = 1 / 220
DISTANCE_BRAKING = 1 / 120
DISTANCE_BACK = 0.04
DISTANCE_POST = 0.12


def corner_entries(track, smooth):
    k = smooth(track.curvature, 10.0 / (track.length / track.count))
    corner = np.abs(k) > DISTANCE_CORNER
    entries = []
    for i in range(track.count):
        if corner[i] and not corner[i - 1]:
            j = i
            while corner[j % track.count]:
                j += 1
            apex = np.arange(i, j) % track.count
            if np.abs(k[apex]).max() > DISTANCE_BRAKING:
                entries.append((i, -np.sign(k[apex].sum()), corner))
    return entries


def distance_boards(track, smooth):
    panels, backs, posts = Batch(), Batch(), Batch()
    step = track.length / track.count
    for entry, sign, corner in corner_entries(track, smooth):
        side = 0 if sign > 0 else 1
        for index, mark in enumerate(DISTANCE_MARKS):
            row = int(entry - round(mark / step)) % track.count
            if not track.rails[row, side]:
                continue
            between = np.arange(row, row + int(round(mark / step))) % track.count
            if corner[between].any():
                continue
            lateral = track.walls[row, side] - DISTANCE_WALL_CLEARANCE
            centre = track.position[row, :2] + track.normal[row] * sign * lateral
            clearance = np.linalg.norm(track.position[:, :2] - centre, axis=1) - track.half
            if clearance.min() < DISTANCE_ASPHALT_CLEARANCE:
                continue
            ground = float(track.surface_height(np.array([row]), np.array([sign * lateral]))[0])
            across = track.normal[row] * DISTANCE_SIZE / 2
            bottom, top = ground + DISTANCE_LIFT, ground + DISTANCE_LIFT + DISTANCE_SIZE
            near, far = centre + across, centre - across
            v0, v1 = 1 - (index + 1) / len(DISTANCE_MARKS), 1 - index / len(DISTANCE_MARKS)
            panels.add(
                [(*near, bottom), (*far, bottom), (*far, top), (*near, top)],
                [(0, v0), (1, v0), (1, v1), (0, v1)],
            )
            shift = track.tangent[row] * DISTANCE_BACK
            backs.add(
                [(*(near + shift), bottom), (*(far + shift), bottom), (*(far + shift), top), (*(near + shift), top)],
                UNIT,
            )
            base = np.array([*(centre + shift * 2), ground])
            beam(posts, base, base + np.array([0, 0, DISTANCE_LIFT]), DISTANCE_POST)
    return panels, backs, posts
