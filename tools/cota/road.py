import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trackside
import vegetation

STEP = 1.0
MAIN_COLUMNS = 9
OUTER_COLUMNS = 6
LINE_WIDTH = 0.25
PAINT_LIFT = 0.004
START_LINE_WIDTH = 0.4
GRID_HALF_WIDTH = 1.3
GRID_LEG = 1.0
GRID_BAR = 0.15
KERB_PROFILE = [(0.0, 0.0), (0.1, 0.015), (0.4, 0.035), (1.05, 0.045), (1.2, 0.045)]
KERB_TAPER = 2.0
KERB_LIFT = 0.008
KERB_TILE = 4.0
RUNOFF_LIFT = 0.005
RACING_LINE_MARGIN = 1.8
RACING_LINE_LOOKAHEAD = 50.0
ASPHALT_TILE = 2.0
GRASS_TILE = 3.0
TERRAIN_TILE = 4.0
PIT_HALF_WIDTH = 5.5
AD_LENGTH = 14.0
AD_SPACING = 150.0
AD_MARGIN = 0.25
AD_LIFT = 0.008
AD_STRAIGHT = 1 / 800
AD_BRANDS = 4
PIT_LIFT = 0.03
PIT_SMOOTHING = 6


def arguments():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    root = Path(argv[0] if len(argv) > 0 else "content/tracks/cota")
    build = Path(argv[1] if len(argv) > 1 else "build/cota")
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
        verge = np.load(build / "verge.npz")
        self.verge_offsets = linear(verge["offsets"], factor)
        self.verge_heights = linear(verge["heights"], factor)
        self.rails = np.repeat(verge["rails"], factor, axis=0)
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
        for side in range(2):
            sign = 1 if side == 0 else -1
            edge = self.road_height(np.arange(self.count), sign * self.half)
            self.verge_heights[:, side] += (edge - self.verge_heights[:, side, 0])[:, None]

    def road_height(self, rows, lateral):
        lateral = np.asarray(lateral, float)
        clamped = np.clip(lateral, -self.main_half, self.main_half)
        return self.position[rows, 2] + self.camber[rows] * clamped

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


def flat_material(name, rgb, metallic, roughness):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def material(name, color, roughness=None, normal=None, metallic=0.0, alpha=False):
    mat = bpy.data.materials.new(name)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metallic
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(str(color))
    links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        links.new(image.outputs["Alpha"], bsdf.inputs["Alpha"])
    if roughness is not None:
        rough = nodes.new("ShaderNodeTexImage")
        rough.image = bpy.data.images.load(str(roughness))
        rough.image.colorspace_settings.name = "Non-Color"
        split = nodes.new("ShaderNodeSeparateColor")
        links.new(rough.outputs["Color"], split.inputs["Color"])
        links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.9
    if normal is not None:
        nor = nodes.new("ShaderNodeTexImage")
        nor.image = bpy.data.images.load(str(normal))
        nor.image.colorspace_settings.name = "Non-Color"
        map_node = nodes.new("ShaderNodeNormalMap")
        links.new(nor.outputs["Color"], map_node.inputs["Color"])
        links.new(map_node.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


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
    return mesh("road", vertices, grid_faces(track.count, lateral.shape[1], True), {"UVMap": uv0, "line": uv1}, mat)


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
    for sign in (1, -1):
        parts.append(strip(track, rows, sign * (track.half - LINE_WIDTH), sign * track.half, PAINT_LIFT, True))
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
    span = track.half[0] - LINE_WIDTH
    parts.append(rectangle(track, -START_LINE_WIDTH / 2, START_LINE_WIDTH / 2, -span, span, PAINT_LIFT))
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


def kerb_mask(track):
    mask = np.zeros((track.count, 2), bool)
    for span in track.data["surfaces"]:
        if span["kind"] == "kerb":
            mask[track.rows_between(span["from"], span["to"]), 0 if span["side"] == "left" else 1] = True
    return mask


def runoff(track, mat):
    mask = kerb_mask(track)
    width = track.data["surfaces"][0]["width"]
    rows = np.arange(track.count)
    parts = []
    for side, sign in ((0, 1), (1, -1)):
        inner = track.half + np.where(mask[:, side], width, 0.0)
        outer = np.minimum(inner + track.data["runoff"], track.verge_offsets[:, side, -1])
        outer = np.maximum(outer, inner + 0.05)
        parts.append(strip(track, rows, sign * inner, sign * outer, RUNOFF_LIFT, True))
    return combine("runoff", parts, mat)


def verges(track, mat):
    parts = []
    rows = np.arange(track.count)
    for side, sign in ((0, 1), (1, -1)):
        offsets = track.verge_offsets[:, side]
        lateral = sign * offsets
        xy = track.position[:, None, :2] + track.normal[:, None, :] * lateral[..., None]
        z = track.verge_heights[:, side]
        vertices = np.concatenate([xy, z[..., None]], -1)
        if sign < 0:
            vertices = vertices[:, ::-1]
            lateral = lateral[:, ::-1]
        along = np.broadcast_to(track.s[:, None], lateral.shape)
        uv = np.stack([lateral / GRASS_TILE, along / GRASS_TILE], -1)
        parts.append((vertices, grid_faces(len(rows), offsets.shape[1], True), uv))
    obj = combine("verges", parts, mat)
    obj.data.polygons.foreach_set("use_smooth", np.full(len(obj.data.polygons), True))
    return obj


def pit_lane(track, asphalt, paint):
    raw = np.array([[p["x"], -p["z"], p["y"]] for p in track.data["pitLane"]["centerline"]])
    distance = np.linalg.norm(raw[:, None, :2] - track.position[None, :, :2], axis=2)
    rows = np.argmin(distance, axis=1)
    lateral = np.einsum("ij,ij->i", raw[:, :2] - track.position[rows, :2], track.normal[rows])
    side = np.where(lateral >= 0, 0, 1)
    reach = track.verge_offsets[rows, side, -1]
    covered = np.abs(lateral) <= reach
    surface = np.max(
        [track.surface_height(rows, lateral + offset) for offset in (-PIT_HALF_WIDTH, 0.0, PIT_HALF_WIDTH)],
        axis=0,
    )
    target = np.where(covered, surface + PIT_LIFT, raw[:, 2])
    radius = PIT_SMOOTHING * 3
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / PIT_SMOOTHING) ** 2)
    kernel /= kernel.sum()
    height = target.copy()
    for _ in range(6):
        padded = np.concatenate([np.full(radius, height[0]), height, np.full(radius, height[-1])])
        height = np.convolve(padded, kernel, mode="valid")
        height = np.where(covered, np.maximum(height, target), height)
    raw[:, 2] = height
    delta = np.gradient(raw[:, :2], axis=0)
    tangent = delta / np.linalg.norm(delta, axis=1)[:, None]
    normal = np.stack([-tangent[:, 1], tangent[:, 0]], 1)
    along = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(raw[:, :2], axis=0), axis=1))])
    lateral = np.linspace(-PIT_HALF_WIDTH, PIT_HALF_WIDTH, 5)

    def ribbon(columns, lift):
        xy = raw[:, None, :2] + normal[:, None, :] * columns[None, :, None]
        z = np.broadcast_to(raw[:, None, 2:3] + lift, xy.shape[:2] + (1,))
        return np.concatenate([xy, z], -1)

    vertices = ribbon(lateral, 0.0)
    grid = np.broadcast_to(lateral[None, :], vertices.shape[:2])
    uv0 = np.stack([grid / ASPHALT_TILE, np.broadcast_to(along[:, None], grid.shape) / ASPHALT_TILE], -1)
    uv1 = np.stack([np.full(grid.shape, 100.0), np.zeros(grid.shape)], -1)
    mesh("pit lane", vertices, grid_faces(len(raw), len(lateral), False), {"UVMap": uv0, "line": uv1}, asphalt)
    parts = []
    for edge in (-PIT_HALF_WIDTH, PIT_HALF_WIDTH - LINE_WIDTH):
        columns = np.array([edge, edge + LINE_WIDTH])
        v = ribbon(columns, PAINT_LIFT)
        uv = np.stack([np.broadcast_to(columns[None, :], v.shape[:2]), np.broadcast_to(along[:, None], v.shape[:2])], -1)
        parts.append((v, grid_faces(len(raw), 2, False), uv))
    return combine("pit lines", parts, paint)


def painted_ads(track, mat):
    mask = kerb_mask(track)
    step = track.length / track.count
    k = np.abs(gaussian(track.curvature, 10.0 / step))
    span = int(round(AD_LENGTH / step))
    batch = trackside.Batch()
    next_ad, placed = 0.0, 0
    for start in range(track.count - span):
        if track.s[start] < next_ad:
            continue
        rows = np.arange(start, start + span + 1)
        if k[rows].max() > AD_STRAIGHT or mask[rows].any():
            continue
        brand = placed % AD_BRANDS
        v_low, v_high = 1 - (brand + 1) / AD_BRANDS, 1 - brand / AD_BRANDS
        for side, sign in ((0, 1), (1, -1)):
            inner = track.half[rows] + AD_MARGIN
            outer = np.minimum(track.half[rows] + track.data["runoff"], track.verge_offsets[rows, side, -1]) - AD_MARGIN
            edge = track.place(np.stack([rows, rows], 1), np.stack([sign * inner, sign * outer], 1), RUNOFF_LIFT + AD_LIFT)
            t = (track.s[rows] - track.s[start]) / AD_LENGTH
            u = t if side == 0 else 1 - t
            for a in range(span):
                b = a + 1
                batch.add(
                    [edge[a, 0], edge[b, 0], edge[b, 1], edge[a, 1]],
                    [(u[a], v_low), (u[b], v_low), (u[b], v_high), (u[a], v_high)],
                )
        placed += 1
        next_ad = track.s[start] + AD_SPACING
    vertices, faces, uv = batch.arrays()
    return mesh("painted ads", vertices, faces, {"UVMap": uv}, mat, smooth=False)


def distance_meshes(track, derived):
    panels, backs, posts = trackside.distance_boards(track, gaussian)
    dark = flat_material("cota board back", (0.05, 0.06, 0.08), 0.0, 0.7)
    return [
        ("distance boards", panels, material("cota distance boards", derived / "distance_base_color.png")),
        ("distance backs", backs, dark),
        ("distance posts", posts, dark),
    ]


def trackside_meshes(track, source, derived):
    boards, tecpro, concrete, fence = trackside.walls(track, gaussian)
    concrete_mat = material("cota wall concrete", source / "rough_concrete_base_color.jpg", normal=source / "rough_concrete_normal.jpg")
    for name, batch, mat in (
        ("wall boards", boards, material("cota wall boards", derived / "boards_base_color.png")),
        ("wall tecpro", tecpro, material("cota wall tecpro", derived / "tecpro_base_color.png")),
        ("wall concrete", concrete, concrete_mat),
        ("debris fence", fence, material("cota debris fence", derived / "chainlink_base_color.png", alpha=True, metallic=0.6)),
        ("fence steel", trackside.metalwork(track), flat_material("cota fence steel", (0.1, 0.1, 0.11), 0.6, 0.5)),
        *distance_meshes(track, derived),
    ):
        vertices, faces, uv = batch.arrays()
        if faces:
            mesh(name, vertices, faces, {"UVMap": uv}, mat, smooth=False)


def terrain(build, mat):
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
    return mesh("terrain", vertices, faces, {"UVMap": uv}, mat)


def main():
    root, build = arguments()
    source = root / "textures" / "source"
    derived = build / "textures"
    bpy.ops.wm.read_factory_settings(use_empty=True)
    track = Track(root, build)
    asphalt = material(
        "cota road asphalt",
        source / "asphalt_track_base_color.jpg",
        source / "asphalt_track_roughness.png",
        source / "asphalt_track_normal.jpg",
    )
    paint = material(
        "cota road paint",
        source / "circuit_paint_white.jpg",
        source / "circuit_paint_roughness.png",
        source / "circuit_paint_normal.jpg",
    )
    kerb = material(
        "cota road kerb",
        derived / "kerb_base_color.png",
        source / "circuit_paint_roughness.png",
        source / "circuit_paint_normal.jpg",
    )
    runoff_paint = material(
        "cota road runoff",
        derived / "runoff_base_color.jpg",
        source / "circuit_paint_roughness.png",
        source / "circuit_paint_normal.jpg",
    )
    grass = material(
        "cota road grass",
        derived / "grass_base_color.jpg",
        source / "withered_grass_roughness.png",
        source / "withered_grass_normal.jpg",
    )
    road(track, asphalt)
    edge_lines(track, paint)
    markings(track, paint)
    kerbs(track, kerb)
    runoff(track, runoff_paint)
    pit_lane(
        track,
        material(
            "cota pit asphalt",
            source / "asphalt_track_base_color.jpg",
            source / "asphalt_track_roughness.png",
            source / "asphalt_track_normal.jpg",
        ),
        paint,
    )
    verges(track, grass)
    trackside_meshes(track, source, derived)
    painted_ads(track, material("cota painted ads", derived / "decals_base_color.png", alpha=True))
    vegetation.forest(
        np.load(build / "trees.npy"),
        3,
        flat_material("cota tree bark", (0.16, 0.13, 0.1), 0.0, 0.9),
        flat_material("cota tree canopy", (0.1, 0.17, 0.06), 0.0, 0.85),
        11,
    )
    terrain(
        build,
        material(
            "cota terrain",
            derived / "grass_base_color.jpg",
            source / "withered_grass_roughness.png",
            source / "withered_grass_normal.jpg",
        ),
    )
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
        export_gpu_instances=True,
    )
    print(f"road: {track.count} rows, {sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")} faces -> {out}")


main()
