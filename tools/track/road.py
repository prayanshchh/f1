import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import billboards
from materials import flat_material, material
from palette import BRAND_ROWS
import pitlane
import props
import trackside
import venue

STEP = 1.0
MAIN_COLUMNS = 9
OUTER_COLUMNS = 6
LINE_WIDTH = 0.25
PAINT_LIFT = 0.004
START_LINE_WIDTH = 0.4
GRID_HALF_WIDTH = 1.3
GRID_LEG = 1.0
GRID_BAR = 0.15
KERB_PROFILE = [(0.0, 0.0), (0.1, 0.007), (0.4, 0.016), (1.05, 0.02), (1.2, 0.02)]
KERB_TAPER = 16.0
KERB_LIFT = 0.008
KERB_TILE = 5.0
MARK_SEED = 17
MARK_LIFT = 0.006
MARK_TILE = 8.0
MARK_EDGE = 0.1
MARK_KERB_REACH = 1.1
MARK_TRACK = 1.48
MARK_PAIRED = 0.6
MARK_CORNER = 1 / 200
MARK_RANDOM = 70
MARK_ROW_NAMES = ("light", "medium", "dark")
RACING_LINE_MARGIN = 1.8
RACING_LINE_LOOKAHEAD = 50.0
ASPHALT_TILE = 2.0
GRASS_TILE = 3.0
TERRAIN_TILE = 4.0
TERRAIN_RATIO = 0.22
TERRAIN_DETAIL_REACH = 120.0
TERRAIN_TRACK_STRIDE = 8
TERRAIN_CHUNK = 40000
HORIZON_RATIO = 0.3
PEOPLE_RATIO = 0.3
VERGE_BEYOND_WALL = 3
PIT_COLUMNS = 6
PIT_WALL_THIN = 0.4
PIT_DECK_RAMP = 20.0
PIT_LIFT = 0.012
PIT_FLARE = 0.3
PIT_LINE_LIFT = 0.018
PIT_FAST_LANE = 17.0
PIT_STRIP_WIDTH = 3.0
PIT_STRIP_TILE = 24.0
PIT_STRIP_BRANDS = (4, 10, 6, 7)
PIT_RED_LINE = 0.4
PIT_BOX_EDGE = 1.2
PIT_CROSS_LINE = 0.6
PIT_DASH = 3.0
PIT_GORE = 34.0
PIT_CHEVRON_STEP = 4.0
PIT_CHEVRON_WIDTH = 0.5
PIT_DECAL_LENGTH = 6.0
PIT_DECAL_WIDTH = 4.0
PIT_BOX_START = 5.0
PIT_BOX_LENGTH = 7.0
PIT_BOX_SPACING = 28.0
PIT_BOXES = 10


def arguments():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    root = Path(argv[0] if len(argv) > 0 else "content/tracks/hill-country")
    build = Path(argv[1] if len(argv) > 1 else "build/hill-country")
    return root, build


def gaussian(values, sigma):
    if sigma <= 0:
        return values
    radius = int(sigma * 4)
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.concatenate([values[-radius:], values, values[:radius]], axis=0)
    if values.ndim == 1:
        return np.convolve(padded, kernel, mode="valid")
    return np.stack([np.convolve(padded[:, i], kernel, mode="valid") for i in range(values.shape[1])], 1)


def catmull_rom(points, factor):
    n = len(points)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = points[i - 1], points[i], points[(i + 1) % n], points[(i + 2) % n]
        for t in np.arange(factor) / factor:
            out.append(
                0.5
                * (
                    2 * p1
                    + (-p0 + p2) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
                )
            )
    return np.array(out)


def linear(values, factor):
    nxt = np.roll(values, -1, axis=0)
    t = (np.arange(factor) / factor).reshape((1, factor) + (1,) * (values.ndim - 1))
    return (values[:, None] * (1 - t) + nxt[:, None] * t).reshape((-1,) + values.shape[1:])


class Track:
    def __init__(self, root, build):
        data = json.loads((root / "track.json").read_text())
        self.data = data
        points = data["centerline"]
        factor = int(round(data["length"] / len(points) / STEP))
        raw = np.array([[p["x"], -p["z"], p["y"]] for p in points])
        self.position = catmull_rom(raw, factor)
        self.width = linear(np.array([p["width"] for p in points]), factor)
        self.camber = linear(np.array([p["camber"] for p in points]), factor)
        self.walls = linear(np.array([[p["wallLeft"], p["wallRight"]] for p in points]), factor)
        self.aerial = json.loads((build / "aerial.json").read_text())
        self.space_reach = self.aerial["reach"]
        verge = np.load(build / "verge.npz")
        self.verge_offsets = linear(verge["offsets"], factor)
        self.verge_heights = linear(verge["heights"], factor)
        self.length = data["length"]
        self.count = len(self.position)
        self.s = np.arange(self.count) * self.length / self.count
        delta = np.roll(self.position, -1, 0) - np.roll(self.position, 1, 0)
        tangent = delta[:, :2] / np.linalg.norm(delta[:, :2], axis=1)[:, None]
        self.tangent = tangent
        self.normal = np.stack([-tangent[:, 1], tangent[:, 0]], 1)
        heading = np.unwrap(np.arctan2(tangent[:, 1], tangent[:, 0]))
        self.curvature = np.gradient(heading) / (self.length / self.count)
        self.main_half = data["width"] / 2
        self.half = self.width / 2
        pit = data["pitLane"]
        self.pit = pit
        self.pit_wall = pit["pitWall"]
        self.pit_zone = self.arc_mask(pit["entry"], pit["exit"])
        self.pit_wall_rows = self.arc_mask(pit["wallStart"], pit["wallEnd"])
        self.garage_front = self.arc_mask(pit["garageStart"], pit["garageEnd"])
        inside = np.minimum((self.s - pit["garageStart"]) % self.length, (pit["garageEnd"] - self.s) % self.length)
        ramp = np.clip(inside / PIT_DECK_RAMP, 0, 1)
        deck = pit["pitWallDeck"]
        self.pit_wall_width = np.where(self.garage_front, PIT_WALL_THIN + (deck - PIT_WALL_THIN) * ramp * ramp * (3 - 2 * ramp), PIT_WALL_THIN)
        for side in range(2):
            sign = 1 if side == 0 else -1
            edge = self.road_height(np.arange(self.count), sign * self.half)
            self.verge_heights[:, side] += (edge - self.verge_heights[:, side, 0])[:, None]

    def space_uv(self, rows, lateral):
        lateral = np.asarray(lateral, float)
        u = (lateral + self.space_reach) / (2 * self.space_reach)
        v = np.broadcast_to((1.0 - self.s[rows] / self.length)[:, None], lateral.shape)
        return np.stack([u, v], -1)

    def aerial_uv(self, xy):
        u = self.aerial["u"][0] * xy[..., 0] + self.aerial["u"][1] * xy[..., 1] + self.aerial["u"][2]
        v = self.aerial["v"][0] * xy[..., 0] + self.aerial["v"][1] * xy[..., 1] + self.aerial["v"][2]
        return np.stack([u, v], -1)

    def arc_mask(self, start, end):
        mask = np.zeros(self.count, bool)
        mask[self.rows_between(start, end)] = True
        return mask

    def road_height(self, rows, lateral):
        lateral = np.asarray(lateral, float)
        return self.position[rows, 2] + self.camber[rows] * lateral

    def verge_height(self, rows, distance, side):
        offsets = self.verge_offsets[rows, side]
        heights = self.verge_heights[rows, side]
        return np.array([np.interp(d, o, h) for d, o, h in zip(np.broadcast_to(distance, rows.shape), offsets, heights)])

    def surface_height(self, rows, lateral):
        lateral = np.asarray(lateral, float)
        half = self.half[rows]
        on_road = np.abs(lateral) <= half + 1e-6
        out = np.empty_like(lateral)
        out[on_road] = self.road_height(rows[on_road], lateral[on_road])
        left = (~on_road) & (lateral > 0)
        right = (~on_road) & (lateral < 0)
        if left.any():
            out[left] = self.verge_height(rows[left], lateral[left], 0)
        if right.any():
            out[right] = self.verge_height(rows[right], -lateral[right], 1)
        return out

    def place(self, rows, lateral, lift=0.0):
        lateral = np.asarray(lateral, float)
        xy = self.position[rows, :2] + self.normal[rows] * lateral[..., None]
        z = self.surface_height(rows.reshape(-1), lateral.reshape(-1)).reshape(lateral.shape) + lift
        return np.concatenate([xy, z[..., None]], axis=-1)

    def place_at(self, distance, lateral, lift=0.0):
        f = (distance % self.length) / self.length * self.count
        i = int(np.floor(f)) % self.count
        t = f - np.floor(f)
        lateral = np.asarray(lateral, float)
        a = self.place(np.full(lateral.shape, i), lateral, lift)
        b = self.place(np.full(lateral.shape, (i + 1) % self.count), lateral, lift)
        return a * (1 - t) + b * t

    def rows_between(self, start, end):
        if end < start:
            end += self.length
        first = int(np.ceil(start / self.length * self.count))
        last = int(np.floor(end / self.length * self.count))
        return np.arange(first, last + 1) % self.count

    def racing_line(self):
        k = gaussian(self.curvature, 12.0 / (self.length / self.count))
        shift = int(round(RACING_LINE_LOOKAHEAD / (self.length / self.count)))
        a = np.tanh(80.0 * k)
        around = (np.roll(a, -shift) + np.roll(a, shift)) / 2
        line = gaussian(np.clip(a - 0.7 * around, -1, 1), 10.0 / (self.length / self.count))
        offset = line * np.maximum(self.half - RACING_LINE_MARGIN, 0)
        rubber = 0.45 + 0.55 * np.clip(np.abs(k) * 60.0, 0, 1)
        return offset, rubber


def grid_faces(rows, columns, closed):
    faces = []
    last = rows if closed else rows - 1
    for i in range(last):
        a = i * columns
        b = ((i + 1) % rows) * columns
        for j in range(columns - 1):
            faces.append((a + j, b + j, b + j + 1, a + j + 1))
    return faces


def mesh(name, vertices, faces, uvs, mat, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices.reshape(-1, 3).tolist(), [], faces)
    loops = np.empty(len(data.loops), np.int32)
    data.loops.foreach_get("vertex_index", loops)
    for uv_name, values in uvs.items():
        layer = data.uv_layers.new(name=uv_name)
        layer.data.foreach_set("uv", values.reshape(-1, 2)[loops].astype(np.float32).ravel())
    data.polygons.foreach_set("use_smooth", np.full(len(data.polygons), smooth))
    data.materials.append(mat)
    data.validate()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def road(track, mat):
    rows = np.arange(track.count)
    columns = []
    for half in track.half:
        main = min(track.main_half, half)
        inner = np.linspace(-main, main, MAIN_COLUMNS)
        outer = np.linspace(main, half, OUTER_COLUMNS + 1)[1:]
        columns.append(np.concatenate([-outer[::-1], inner, outer]))
    lateral = np.array(columns)
    vertices = track.place(rows[:, None].repeat(lateral.shape[1], 1), lateral)
    along = np.broadcast_to(track.s[:, None], lateral.shape)
    line, rubber = track.racing_line()
    uv0 = np.stack([lateral / ASPHALT_TILE, along / ASPHALT_TILE], -1)
    uv1 = np.stack([lateral - line[:, None], np.broadcast_to(rubber[:, None], lateral.shape)], -1)
    uv2 = track.space_uv(np.arange(track.count), lateral)
    seam = lambda values: np.concatenate([values, values[:1]], 0)
    uv0_closed = seam(uv0)
    uv0_closed[-1, :, 1] = track.length / ASPHALT_TILE
    uv2_closed = seam(uv2)
    uv2_closed[-1, :, 1] = 0.0
    return mesh(
        "road",
        seam(vertices),
        grid_faces(track.count + 1, lateral.shape[1], False),
        {"UVMap": uv0_closed, "line": seam(uv1), "space": uv2_closed},
        mat,
    )


def strip(track, rows, inner, outer, lift, closed):
    lateral = np.stack([inner, outer], 1)
    lateral = np.sort(lateral, axis=1)
    vertices = track.place(rows[:, None].repeat(2, 1), lateral, lift)
    along = np.broadcast_to(track.s[rows][:, None], lateral.shape)
    uv = np.stack([lateral, along], -1)
    return vertices, grid_faces(len(rows), 2, closed), uv


def edge_lines(track, mat):
    rows = np.arange(track.count)
    parts = []
    mouth = track.arc_mask(track.pit["entry"], track.pit["wallStart"])
    gap = mouth & ((track.s % (2 * PIT_DASH)) >= PIT_DASH)
    for sign in (1, -1):
        vertices, faces, uv = strip(track, rows, sign * (track.half - LINE_WIDTH), sign * track.half, PAINT_LIFT, True)
        if sign > 0:
            faces = [f for i, f in enumerate(faces) if not gap[i]]
        parts.append((vertices, faces, uv))
    return combine("edge lines", parts, mat)


def combine(name, parts, mat):
    vertices, faces, uvs, offset = [], [], [], 0
    for v, f, uv in parts:
        vertices.append(v.reshape(-1, 3))
        uvs.append(uv.reshape(-1, 2))
        faces += [tuple(i + offset for i in face) for face in f]
        offset += len(v.reshape(-1, 3))
    return mesh(name, np.concatenate(vertices), faces, {"UVMap": np.concatenate(uvs)}, mat, smooth=False)


def rectangle(track, s0, s1, l0, l1, lift):
    corners = np.array([l0, l1], float)
    vertices = np.stack([track.place_at(d, corners, lift) for d in (s0, s1)])
    uv = np.stack([np.array([corners, corners]), np.array([[s0, s0], [s1, s1]])], -1)
    return vertices, [(0, 2, 3, 1)], uv


def markings(track, mat):
    parts = []
    for line in (0.0, track.data["startLine"]):
        span = track.half[int(line / track.length * track.count) % track.count] - LINE_WIDTH
        parts.append(rectangle(track, line - START_LINE_WIDTH / 2, line + START_LINE_WIDTH / 2, -span, span, PAINT_LIFT))
    for slot in track.data["grid"]:
        d, o = slot["distance"], slot["offset"]
        parts.append(rectangle(track, d - GRID_BAR, d, o - GRID_HALF_WIDTH, o + GRID_HALF_WIDTH, PAINT_LIFT))
        for edge in (o - GRID_HALF_WIDTH, o + GRID_HALF_WIDTH - GRID_BAR):
            parts.append(rectangle(track, d - GRID_LEG, d - GRID_BAR, edge, edge + GRID_BAR, PAINT_LIFT))
    return combine("markings", parts, mat)


def kerbs(track, kerb_mat):
    kerb_parts = []
    for span in track.data["surfaces"]:
        if span["kind"] != "kerb":
            continue
        rows = track.rows_between(span["from"], span["to"])
        if len(rows) < 3:
            continue
        sign = 1 if span["side"] == "left" else -1
        width = span["width"]
        profile = np.array([p for p, _ in KERB_PROFILE]) * width / KERB_PROFILE[-1][0]
        lift = np.array([h for _, h in KERB_PROFILE])
        distance = np.arange(len(rows)) * track.length / track.count
        taper = np.clip(np.minimum(distance, distance[-1] - distance) / KERB_TAPER, 0, 1)
        half = track.half[rows][:, None]
        lateral = sign * (half + profile[None, :])
        base = track.place(rows[:, None].repeat(len(profile), 1), lateral)
        base[..., 2] += KERB_LIFT + lift[None, :] * taper[:, None]
        if sign < 0:
            base = base[:, ::-1]
            lateral = lateral[:, ::-1]
        along = np.broadcast_to((span["from"] + distance)[:, None], lateral.shape)
        across = np.abs(lateral) - half
        uv = np.stack([across / width, along / KERB_TILE], -1)
        kerb_parts.append((base, grid_faces(len(rows), len(profile), False), uv))
    return combine("kerbs", kerb_parts, kerb_mat)


def kerb_lift(track):
    taper = np.zeros((track.count, 2))
    for span in track.data["surfaces"]:
        if span["kind"] != "kerb":
            continue
        rows = track.rows_between(span["from"], span["to"])
        distance = np.arange(len(rows)) * track.length / track.count
        side = 0 if span["side"] == "left" else 1
        taper[rows, side] = np.clip(np.minimum(distance, distance[-1] - distance) / KERB_TAPER, 0, 1)
    return taper


def track_marks(track, mat):
    rng = np.random.default_rng(MARK_SEED)
    step = track.length / track.count
    line, _ = track.racing_line()
    k = gaussian(track.curvature, 10.0 / step)
    mask = kerb_mask(track)
    taper = kerb_lift(track)
    profile_x = np.array([p for p, _ in KERB_PROFILE])
    profile_h = np.array([h for _, h in KERB_PROFILE])
    parts = []

    def stroke(start, metres, lateral, slope, bend, width, row):
        count = max(4, int(metres / step))
        rows = (int(start) + np.arange(count)) % track.count
        t = np.linspace(0, 1, count)
        centre = lateral + (slope * t + bend * t * t) * metres
        limit = np.where(centre > 0, mask[rows, 0], mask[rows, 1]) * (MARK_KERB_REACH + MARK_EDGE) - MARK_EDGE + track.half[rows]
        centre = np.clip(centre, -limit, limit)
        half = width / 2 * np.minimum(1, np.minimum(t / 0.1, (1 - t) / 0.15))
        columns = np.stack([centre - half, centre + half], 1)
        vertices = track.place(rows[:, None].repeat(2, 1), columns, MARK_LIFT)
        for column in range(2):
            lat = columns[:, column]
            outside = np.abs(lat) - track.half[rows]
            side = np.where(lat > 0, 0, 1)
            on_kerb = (outside > 0) & mask[rows, side]
            scaled = np.clip(outside, 0, None) / MARK_KERB_REACH * KERB_PROFILE[-1][0]
            extra = np.interp(scaled, profile_x, profile_h) * taper[rows, side] + KERB_LIFT
            vertices[:, column, 2] += np.where(on_kerb, extra, 0.0)
        along = np.arange(count) * step / MARK_TILE + rng.random()
        rows_v = np.array([[row + 0.04, row + 0.96]]) / len(MARK_ROW_NAMES)
        uv = np.stack([np.stack([along, along], 1), np.broadcast_to(1 - rows_v, (count, 2))], -1)
        parts.append((vertices, grid_faces(count, 2, False), uv))

    def pair(start, metres, lateral, slope, bend, width, row):
        stroke(start, metres, lateral, slope, bend, width, row)
        if rng.random() < MARK_PAIRED:
            stroke(start + rng.integers(-2, 3), metres * rng.uniform(0.75, 1.1), lateral + rng.choice([-1, 1]) * MARK_TRACK, slope, bend, width, row)

    corner = np.abs(k) > MARK_CORNER
    for i in range(track.count):
        if not (corner[i] and not corner[i - 1]):
            continue
        for _ in range(rng.integers(3, 7)):
            start = i - rng.uniform(10, 90) / step
            metres = rng.uniform(18, 70)
            row = int(start) % track.count
            pair(start, metres, line[row] + rng.normal(0, 1.0), rng.uniform(-0.025, 0.025), rng.uniform(-0.02, 0.02), rng.uniform(0.1, 0.17), rng.integers(0, 2))
        for _ in range(rng.integers(4, 9)):
            start = i + rng.uniform(-10, 50) / step
            metres = rng.uniform(14, 55)
            row = int(start) % track.count
            pair(start, metres, line[row] + rng.normal(0, 1.4), rng.uniform(-0.06, 0.06), rng.uniform(-0.05, 0.05), rng.uniform(0.1, 0.18), rng.integers(0, 2))
    for span in track.data["surfaces"]:
        if span["kind"] != "kerb":
            continue
        rows = track.rows_between(span["from"], span["to"])
        sign = 1 if span["side"] == "left" else -1
        for _ in range(rng.integers(3, 7)):
            start = rows[rng.integers(0, len(rows))]
            lateral = sign * (track.half[start] + rng.uniform(0.1, MARK_KERB_REACH - 0.1))
            stroke(start, rng.uniform(5, 22), lateral, rng.uniform(-0.012, 0.012), 0.0, rng.uniform(0.1, 0.16), 2)
    for _ in range(MARK_RANDOM):
        row = rng.integers(0, track.count)
        lateral = rng.uniform(-1, 1) * track.half[row]
        stroke(row, rng.uniform(7, 24), lateral, rng.uniform(-0.3, 0.3), rng.uniform(-0.12, 0.12), rng.uniform(0.09, 0.15), 0)
    for slot in track.data["grid"]:
        row = int(slot["distance"] / step)
        for side in (-1, 1):
            stroke(row, rng.uniform(16, 42), slot["offset"] + side * MARK_TRACK / 2, rng.uniform(-0.005, 0.005), 0.0, rng.uniform(0.13, 0.18), 1)
    return combine("track marks", parts, mat)


def kerb_mask(track):
    mask = np.zeros((track.count, 2), bool)
    for span in track.data["surfaces"]:
        if span["kind"] == "kerb":
            mask[track.rows_between(span["from"], span["to"]), 0 if span["side"] == "left" else 1] = True
    return mask


def verges(track, mat):
    vertices, faces, uv0, uv1, uv2, offset = [], [], [], [], [], 0
    for side, sign in ((0, 1), (1, -1)):
        offsets = track.verge_offsets[:, side]
        lateral = sign * offsets
        xy = track.position[:, None, :2] + track.normal[:, None, :] * lateral[..., None]
        z = track.verge_heights[:, side]
        grid = np.concatenate([xy, z[..., None]], -1)
        if sign < 0:
            grid = grid[:, ::-1]
            lateral = lateral[:, ::-1]
        along = np.broadcast_to(track.s[:, None], lateral.shape)
        tile = np.stack([lateral / GRASS_TILE, along / GRASS_TILE], -1)
        space = track.space_uv(np.arange(track.count), lateral)
        seam = lambda values: np.concatenate([values, values[:1]], 0)
        closed_tile = seam(tile)
        closed_tile[-1, :, 1] = track.length / GRASS_TILE
        closed_space = seam(space)
        closed_space[-1, :, 1] = 0.0
        columns = offsets.shape[1]
        side_faces = grid_faces(track.count + 1, columns, False)
        if side == 0:
            side_faces = [f for k, f in enumerate(side_faces) if not (track.garage_front[(k // (columns - 1)) % track.count] and k % (columns - 1) >= columns - 1 - VERGE_BEYOND_WALL)]
        closed = seam(grid)
        faces += [tuple(i + offset for i in f) for f in side_faces]
        vertices.append(closed.reshape(-1, 3))
        uv0.append(closed_tile.reshape(-1, 2))
        uv1.append(closed_space.reshape(-1, 2))
        uv2.append(track.aerial_uv(closed[..., :2]).reshape(-1, 2))
        offset += closed.reshape(-1, 3).shape[0]
    return mesh("verges", np.concatenate(vertices), faces, {"UVMap": np.concatenate(uv0), "space": np.concatenate(uv1), "aerial": np.concatenate(uv2)}, mat)


def pit_edges(track, rows):
    distance = (track.s[rows] - track.pit["entry"]) % track.length
    remaining = (track.pit["exit"] - track.s[rows]) % track.length
    walled = track.pit_wall_rows[rows]
    near = np.where(walled, track.pit_wall + track.pit_wall_width[rows], track.half[rows])
    flare = np.minimum(distance, remaining) * PIT_FLARE
    far = np.minimum(track.half[rows] + flare, track.walls[rows, 0] - 0.05)
    return near, np.maximum(far, near + 0.05)


def pit_lane(track, asphalt):
    rows = np.flatnonzero(track.pit_zone)
    start = np.searchsorted(rows, track.rows_between(track.pit["entry"], track.pit["exit"])[0])
    rows = np.roll(rows, -start)
    near, far = pit_edges(track, rows)
    lateral = near[:, None] + (far - near)[:, None] * np.linspace(0, 1, PIT_COLUMNS)[None, :]
    vertices = track.place(rows[:, None].repeat(PIT_COLUMNS, 1), lateral, PIT_LIFT)
    along = np.broadcast_to(track.s[rows][:, None], lateral.shape)
    uv0 = np.stack([lateral / ASPHALT_TILE, along / ASPHALT_TILE], -1)
    uv1 = np.stack([np.full(lateral.shape, 100.0), np.zeros(lateral.shape)], -1)
    mesh("pit lane", vertices, grid_faces(len(rows), PIT_COLUMNS, False), {"UVMap": uv0, "line": uv1}, asphalt)


def along_line(track, start, end, lateral, width, lift):
    rows = track.rows_between(start, end)
    offset = np.full(len(rows), lateral) if np.isscalar(lateral) else lateral(rows)
    return strip(track, rows, offset - width / 2, offset + width / 2, lift, False)


def across_line(track, distance, l0, l1, length, lift):
    return rectangle(track, distance - length / 2, distance + length / 2, l0, l1, lift)


def skew(track, s0, l0, s1, l1, width, lift):
    corners = [(s0, l0), (s1, l1), (s1 + width, l1), (s0 + width, l0)]
    vertices = np.array([track.place_at(s, np.array([l]), lift)[0] for s, l in corners])
    uv = np.array([[l, s] for s, l in corners], float)
    return vertices, [(0, 1, 2, 3)], uv


def pit_markings(track, paint):
    pit = track.pit
    wall, lift = track.pit_wall, PIT_LINE_LIFT
    length = track.length
    begin, end = pit["wallStart"], pit["wallEnd"]
    rows = track.rows_between(begin, end)
    far = lambda r: track.walls[r, 0] - LINE_WIDTH
    fast = PIT_FAST_LANE
    garage_start, garage_end, front = pit["garageStart"], pit["garageEnd"], pit["garageFront"]
    parts = [
        along_line(track, begin + 10, end - 10, fast, LINE_WIDTH, lift),
        across_line(track, (begin + 2) % length, wall + 0.6, far(rows[1:2])[0], PIT_CROSS_LINE, lift),
        across_line(track, (end - 2) % length, wall + 0.6, far(rows[-2:-1])[0], PIT_CROSS_LINE, lift),
        across_line(track, pit["exit"], track.half[track.rows_between(pit["exit"], pit["exit"] + 1)[0]] - 7.0, track.half[track.rows_between(pit["exit"], pit["exit"] + 1)[0]], PIT_CROSS_LINE, lift),
        along_line(track, garage_start, garage_end, fast + PIT_STRIP_WIDTH + 0.15, LINE_WIDTH, lift),
        along_line(track, garage_start, garage_end, fast + PIT_STRIP_WIDTH + 0.7, LINE_WIDTH / 2, lift),
    ]
    start_gore = (begin - PIT_GORE) % length
    edge = float(track.half[track.rows_between(start_gore, start_gore + 1)[0]])
    parts.append(skew(track, start_gore, edge, begin, wall + LINE_WIDTH, LINE_WIDTH / 2 * 2, lift))
    for k in range(1, int(PIT_GORE / PIT_CHEVRON_STEP)):
        s0 = start_gore + k * PIT_CHEVRON_STEP
        top = edge + (wall - edge) * k * PIT_CHEVRON_STEP / PIT_GORE
        parts.append(skew(track, s0, edge, s0 + 2.0, top, PIT_CHEVRON_WIDTH, lift))
    work_near = fast + PIT_STRIP_WIDTH + 1.0
    for s0, spacing in pitlane.bays(track):
        parts.append(rectangle(track, s0, s0 + LINE_WIDTH / 2, work_near, front - 1.0, lift))
        middle = s0 + spacing / 2
        for axle in (-1.75, 1.75):
            parts.append(rectangle(track, middle + axle - PIT_BOX_EDGE / 2, middle + axle + PIT_BOX_EDGE / 2, pit["boxLateral"] - 1.0, pit["boxLateral"] - 0.85, lift))
            parts.append(rectangle(track, middle + axle - 0.08, middle + axle + 0.08, pit["boxLateral"] - 1.0, pit["boxLateral"] + 1.0, lift))
    combine("pit lines", parts, paint)


def pit_apron(track, asphalt, boards, red):
    pit = track.pit
    rows = track.rows_between(pit["garageStart"], pit["garageEnd"])
    front = pit["garageFront"]
    fast = PIT_FAST_LANE
    lateral = np.broadcast_to(np.array([fast + PIT_STRIP_WIDTH, front])[None, :], (len(rows), 2))
    vertices = track.place(rows[:, None].repeat(2, 1), lateral, PIT_LIFT + 0.001)
    along = np.broadcast_to(track.s[rows][:, None], lateral.shape)
    uv0 = np.stack([lateral / ASPHALT_TILE, along / ASPHALT_TILE], -1)
    uv1 = np.stack([np.full(lateral.shape, 100.0), np.zeros(lateral.shape)], -1)
    mesh("pit apron", vertices, grid_faces(len(rows), 2, False), {"UVMap": uv0, "line": uv1}, asphalt)
    strip_rows = track.rows_between(pit["garageStart"] + 2, pit["garageEnd"] - 2)
    lateral = np.broadcast_to(np.array([fast, fast + PIT_STRIP_WIDTH])[None, :], (len(strip_rows), 2))
    vertices = track.place(strip_rows[:, None].repeat(2, 1), lateral, PIT_LINE_LIFT)
    travelled = (track.s[strip_rows] - track.s[strip_rows[0]]) % track.length
    tile = np.floor(travelled / PIT_STRIP_TILE).astype(int)
    faces, uv = [], []
    batch = trackside.Batch()
    for i in range(len(strip_rows) - 1):
        brand = PIT_STRIP_BRANDS[tile[i] % len(PIT_STRIP_BRANDS)]
        v0, v1 = 1 - (brand + 1) / BRAND_ROWS, 1 - brand / BRAND_ROWS
        u0, u1 = travelled[i] / PIT_STRIP_TILE, travelled[i + 1] / PIT_STRIP_TILE
        batch.add(
            [vertices[i, 1], vertices[i + 1, 1], vertices[i + 1, 0], vertices[i, 0]],
            [(u0, v1), (u1, v1), (u1, v0), (u0, v0)],
        )
    vertices, faces, uv = batch.arrays()
    mesh("pit strip", vertices, faces, {"UVMap": uv}, boards, smooth=False)
    return combine("pit red line", [along_line(track, pit["garageStart"], pit["garageEnd"], front - PIT_RED_LINE, PIT_RED_LINE / 2, PIT_LINE_LIFT)], red)


def pit_decals(track, mat):
    batch = trackside.Batch()
    wall, lift = track.pit_wall + 1.0, PIT_LINE_LIFT
    panels = [
        (track.pit["wallStart"] + 6.0, 0),
        (track.pit["wallStart"] + 16.0, 1),
        (track.pit["wallEnd"] - 16.0, 1),
    ]
    for distance, index in panels:
        l0 = wall + 1.0
        l1 = l0 + PIT_DECAL_WIDTH
        s0, s1 = distance % track.length, (distance + PIT_DECAL_LENGTH) % track.length
        v0, v1 = 1 - (index + 1) / 2, 1 - index / 2
        corners = [(s0, l1), (s1, l1), (s1, l0), (s0, l0)]
        batch.add(
            [track.place_at(s, np.array([l]), lift)[0] for s, l in corners],
            [(0, v0), (0, v1), (1, v1), (1, v0)],
        )
    vertices, faces, uv = batch.arrays()
    return mesh("pit decals", vertices, faces, {"UVMap": uv}, mat, smooth=False)


def distance_meshes(track, derived):
    panels, backs, posts = trackside.distance_boards(track, gaussian)
    dark = flat_material("track board back", (0.05, 0.06, 0.08), 0.0, 0.7)
    return [
        ("distance boards", panels, material("track distance boards", derived / "distance_base_color.png")),
        ("distance backs", backs, dark),
        ("distance posts", posts, dark),
    ]


def trackside_meshes(track, source, derived):
    boards, tecpro, concrete, fence = trackside.walls(track, gaussian)
    concrete_mat = material("track wall concrete", source / "rough_concrete_base_color.jpg", normal=source / "rough_concrete_normal.jpg")
    for name, batch, mat in (
        ("wall boards", boards, material("track wall boards", derived / "boards_base_color.png")),
        ("wall tecpro", tecpro, material("track wall tecpro", derived / "tecpro_base_color.png")),
        ("wall concrete", concrete, concrete_mat),
        ("debris fence", fence, material("track debris fence", derived / "chainlink_base_color.png", alpha=True, metallic=0.6)),
        ("fence steel", trackside.metalwork(track), flat_material("track fence steel", (0.42, 0.43, 0.45), 0.5, 0.5)),
        *distance_meshes(track, derived),
    ):
        vertices, faces, uv = batch.arrays()
        if faces:
            mesh(name, vertices, faces, {"UVMap": uv}, mat, smooth=False)


def smoothed_mesh(name, batch, mat):
    vertices, faces, uv = batch.arrays()
    obj = mesh(name, vertices, faces, {"UVMap": uv}, mat, smooth=True)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.polygons.foreach_set("use_smooth", np.full(len(obj.data.polygons), True))
    return obj


def glow_material(name, rgb, strength):
    mat = flat_material(name, rgb, 0.0, 0.5)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def paddock_meshes(track, source, derived, build):
    parts = pitlane.build(track, build / "crew_static.npz")
    palette = material("track paddock team", derived / "palette_base_color.png")
    materials = {
        "panels": flat_material("track paddock panels", (0.03, 0.04, 0.055), 0.5, 0.18),
        "fascia": glow_textured("track paddock fascia", derived / "fascia_base_color.png", 0.35),
        "banner": material("track paddock banner", derived / "boards_base_color.png"),
        "canopy": flat_material("track paddock canopy", (0.78, 0.78, 0.76), 0.0, 0.6),
        "floor": flat_material("track paddock floor", (0.42, 0.42, 0.4), 0.0, 0.35),
        "inner": flat_material("track paddock inner", (0.55, 0.56, 0.58), 0.0, 0.7),
        "back": glow_textured("track paddock back", derived / "garage_back_base_color.png", 0.45),
        "lights": glow_material("track paddock lights", (1.0, 0.97, 0.9), 6.0),
        "steel": flat_material("track paddock steel", (0.38, 0.39, 0.41), 0.6, 0.45),
        "team": palette,
        "tyres": palette,
        "metal": palette,
        "screens": glow_material("track paddock screens", (0.12, 0.35, 0.55), 2.5),
        "white": palette,
        "signs": material("track paddock signs", derived / "pit_signs_base_color.png"),
        "concrete": material("track paddock concrete", source / "rough_concrete_base_color.jpg", normal=source / "rough_concrete_normal.jpg"),
        "tower": flat_material("track paddock tower", (0.09, 0.09, 0.1), 0.6, 0.5),
    }
    crew_source = source.parent.parent / "source" / "crew"
    people = {
        "people cloth": material("track paddock people", derived / "crew_static_base_color.png"),
        "people hair": flat_material("track paddock hair", (0.03, 0.02, 0.014), 0.0, 0.6),
        "people eyes": material("track paddock eyes", crew_source / "T_Eye_Brown.png"),
        "people skin Male 0": material("track skin male light", crew_source / "T_Superhero_Male_Ligh.png"),
        "people skin Male 1": material("track skin male dark", crew_source / "T_Superhero_Male_Dark.png"),
        "people skin Female 0": material("track skin female light", crew_source / "T_Superhero_Female_Light_BaseColor.png"),
        "people skin Female 1": material("track skin female dark", crew_source / "T_Superhero_Female_Dark_BaseColor.png"),
    }
    for name, batch in parts.items():
        if name in people:
            if batch.faces:
                decimate(smoothed_mesh(f"paddock {name}", batch, people[name]), PEOPLE_RATIO)
            continue
        if batch.faces:
            vertices, faces, uv = batch.arrays()
            mesh(f"paddock {name}", vertices, faces, {"UVMap": uv}, materials[name], smooth=name in ("team", "tyres", "metal"))


def glow_textured(name, path, strength):
    mat = material(name, path)
    nodes = mat.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    image = next(n for n in nodes if n.type == "TEX_IMAGE")
    mat.node_tree.links.new(image.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def billboard_meshes(track, derived):
    boards, tower, posts = billboards.build(track, gaussian)
    board_mat = material("track billboard boards", derived / "boards_base_color.png")
    for name, batch, mat in (
        ("billboard boards", boards, board_mat),
        ("billboard tower", tower, flat_material("track billboard tower", (0.09, 0.09, 0.1), 0.6, 0.5)),
        ("billboard posts", posts, flat_material("track billboard posts", (0.1, 0.1, 0.11), 0.6, 0.5)),
    ):
        vertices, faces, uv = batch.arrays()
        if faces:
            mesh(name, vertices, faces, {"UVMap": uv}, mat, smooth=False)


def venue_meshes(track, build, source, derived):
    layout = json.loads((build / "venue.json").read_text())
    concrete = material("track venue concrete", source / "rough_concrete_base_color.jpg", normal=source / "rough_concrete_normal.jpg")
    white = flat_material("track venue white", (0.82, 0.82, 0.8), 0.0, 0.55)
    batches = {name: trackside.Batch() for name in ("stand seats", "stand concrete", "roofs", "columns", "walls", "rooftops", "tower plates", "tower core", "veil", "gantry boards", "gantry steel", "light panel", "start lamps")}
    for data in layout["stands"]:
        venue.stand(batches["stand seats"], batches["stand concrete"], batches["roofs"], batches["columns"], data)
    for data in layout["buildings"]:
        venue.extrude(batches["walls"], batches["rooftops"], data)
    venue.tower(batches["tower plates"], batches["tower core"], batches["veil"], layout["tower"])
    venue.gantry(track, batches["gantry boards"], batches["gantry steel"], batches["light panel"], batches["start lamps"])
    materials = {
        "stand seats": flat_material("track stand seats", (0.2, 0.21, 0.23), 0.3, 0.55),
        "stand concrete": flat_material("track stand fascia", (0.06, 0.065, 0.075), 0.2, 0.6),
        "roofs": white,
        "columns": flat_material("track venue steel", (0.32, 0.33, 0.35), 0.6, 0.45),
        "walls": concrete,
        "rooftops": flat_material("track venue roof", (0.55, 0.55, 0.53), 0.0, 0.8),
        "tower plates": white,
        "tower core": flat_material("track venue glass", (0.07, 0.09, 0.12), 0.4, 0.2),
        "veil": flat_material("track venue veil", (0.62, 0.05, 0.07), 0.2, 0.45),
        "gantry boards": material("track gantry boards", derived / "boards_base_color.png"),
        "light panel": flat_material("track light panel", (0.004, 0.004, 0.005), 0.1, 0.85),
        "start lamps": flat_material("track start lamps", (0.05, 0.01, 0.01), 0.0, 0.3),
        "gantry steel": flat_material("track gantry steel", (0.12, 0.12, 0.13), 0.6, 0.5),
    }
    for name, batch in batches.items():
        vertices, faces, uv = batch.arrays()
        if faces:
            mesh(name, vertices, faces, {"UVMap": uv}, materials[name], smooth=False)


def decimate(obj, ratio, keep=None):
    modifier = obj.modifiers.new("reduce", "DECIMATE")
    modifier.ratio = ratio
    if keep is not None:
        group = obj.vertex_groups.new(name="reducible")
        group.add(np.flatnonzero(~keep).tolist(), 1.0, "REPLACE")
        modifier.vertex_group = "reducible"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="reduce")
    return obj


def track_distance(track, points):
    centre = track.position[:: TERRAIN_TRACK_STRIDE, :2]
    best = np.full(len(points), np.inf)
    for start in range(0, len(points), TERRAIN_CHUNK):
        chunk = points[start : start + TERRAIN_CHUNK]
        offset = chunk[:, None, :] - centre[None, :, :]
        best[start : start + TERRAIN_CHUNK] = np.linalg.norm(offset, axis=2).min(axis=1)
    return best


def terrain(track, build, mat):
    data = np.load(build / "terrain.npz")
    xs, ys, heights = data["x"], data["y"], data["heights"]
    gx, gy = np.meshgrid(xs, ys)
    vertices = np.stack([gx, gy, heights], -1)
    rows, columns = heights.shape
    faces = []
    for i in range(rows - 1):
        a = i * columns
        for j in range(columns - 1):
            faces.append((a + j, a + j + 1, a + columns + j + 1, a + columns + j))
    uv = np.stack([gx, gy], -1) / TERRAIN_TILE
    obj = mesh("terrain", vertices, faces, {"UVMap": uv, "aerial": track.aerial_uv(np.stack([gx, gy], -1))}, mat)
    distance = track_distance(track, np.stack([gx.ravel(), gy.ravel()], -1))
    return decimate(obj, TERRAIN_RATIO, keep=distance < TERRAIN_DETAIL_REACH)


def props_meshes(track, build):
    parts = props.build(track, build)
    materials = {
        "marquee": flat_material("track prop white", (0.86, 0.86, 0.84), 0.0, 0.7),
        "steel": flat_material("track prop steel", (0.16, 0.16, 0.17), 0.6, 0.5),
        "dark": flat_material("track prop dark", (0.025, 0.027, 0.03), 0.1, 0.6),
        "crane": flat_material("track prop crane", (0.78, 0.55, 0.05), 0.3, 0.45),
        "crane blue": flat_material("track prop crane blue", (0.05, 0.2, 0.55), 0.3, 0.45),
        "screen": flat_material("track prop screen", (0.02, 0.03, 0.05), 0.2, 0.25),
        "hut": flat_material("track prop hut", (0.78, 0.78, 0.76), 0.0, 0.6),
        "marshal": flat_material("track prop marshal", (0.85, 0.32, 0.05), 0.0, 0.6),
        "skyline": flat_material("track prop skyline", (0.32, 0.36, 0.42), 0.2, 0.5),
    }
    for name, batch in parts.items():
        vertices, faces, uv = batch.arrays()
        if faces:
            mesh(f"prop {name}", vertices, faces, {"UVMap": uv}, materials[name], smooth=False)


def horizon(build, mat):
    data = np.load(build / "horizon.npz")
    x, y, z = data["x"], data["y"], data["z"]
    rows, columns = x.shape
    hole = data["hole"]
    faces = []
    for i in range(rows - 1):
        a = i * columns
        for j in range(columns - 1):
            if hole[i, j] and hole[i + 1, j] and hole[i, j + 1] and hole[i + 1, j + 1]:
                continue
            faces.append((a + j, a + j + columns, a + columns + j + 1, a + j + 1))
    vertices = np.stack([x, y, z], -1)
    uv = np.stack([data["u"], data["v"]], -1)
    return decimate(mesh("horizon", vertices, faces, {"UVMap": uv}, mat), HORIZON_RATIO)


def main():
    root, build = arguments()
    source = root / "textures" / "source"
    derived = build / "textures"
    bpy.ops.wm.read_factory_settings(use_empty=True)
    track = Track(root, build)
    asphalt = material(
        "track road asphalt",
        source / "asphalt_track_base_color.jpg",
        source / "asphalt_track_roughness.png",
        source / "asphalt_track_normal.jpg",
    )
    paint = material(
        "track road paint",
        source / "circuit_paint_white.jpg",
        source / "circuit_paint_roughness.png",
        source / "circuit_paint_normal.jpg",
    )
    kerb = material(
        "track road kerb",
        derived / "kerb_base_color.png",
        source / "circuit_paint_roughness.png",
        source / "circuit_paint_normal.jpg",
    )
    grass = material(
        "track road grass",
        derived / "grass_base_color.jpg",
        source / "withered_grass_roughness.png",
        source / "withered_grass_normal.jpg",
    )
    road(track, asphalt)
    edge_lines(track, paint)
    markings(track, paint)
    kerbs(track, kerb)
    track_marks(track, material("track track marks", derived / "track_marks_base_color.png", alpha=True))
    pit_lane(
        track,
        material(
            "track pit asphalt",
            source / "asphalt_track_base_color.jpg",
            source / "asphalt_track_roughness.png",
            source / "asphalt_track_normal.jpg",
        ),
    )
    pit_markings(track, paint)
    pit_apron(
        track,
        material(
            "track apron asphalt",
            source / "asphalt_track_base_color.jpg",
            source / "asphalt_track_roughness.png",
            source / "asphalt_track_normal.jpg",
        ),
        material("track pit strip", derived / "boards_base_color.png"),
        flat_material("track pit red", (0.55, 0.03, 0.04), 0.0, 0.6),
    )
    paddock_meshes(track, source, derived, build)
    billboard_meshes(track, derived)
    verges(track, grass)
    trackside_meshes(track, source, derived)
    venue_meshes(track, build, source, derived)
    pit_decals(track, material("track pit decals", derived / "pit_decals_base_color.png", alpha=True))
    terrain(
        track,
        build,
        material(
            "track terrain",
            derived / "grass_base_color.jpg",
            source / "withered_grass_roughness.png",
            source / "withered_grass_normal.jpg",
        ),
    )
    horizon(build, material("track horizon", root / "source" / "region-aerial.jpg"))
    props_meshes(track, build)
    out = root / "road.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_extras=False,
    )
    print(f"road: {track.count} rows, {sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")} faces -> {out}")


if __name__ == "__main__":
    main()
