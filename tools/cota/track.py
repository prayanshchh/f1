import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.interpolate import splev, splprep
from scipy.ndimage import gaussian_filter1d, median_filter
from scipy.spatial import cKDTree
from shapely.geometry import LinearRing, LineString, Point, Polygon
from shapely.ops import unary_union

import aerial
import standshape
from geo import Osm, Terrain

CIRCUIT = 6537729
STEP = 2.0
AERIAL_ROW = 1.0
NOMINAL_WIDTH = 14.0
MIN_CENTRE_RADIUS = 15.0
MIN_EDGE_RADIUS = 8.0
MAX_WIDENING = 0.3
HAIRPIN_REACH = 6
HAIRPIN_ITERATIONS = 4000
SURFACE_TOLERANCE = 2.0
MAX_CAMBER = 0.035
WALL_SLOPE = 0.35
WALL_MIN_FORWARD = 0.15
RAIL_REACH = 110.0
SYNTHETIC_OFFSET = 14.0
PIT_WALL = 9.0
PIT_MIN_REACH = 18.0
PIT_GARAGE_SEARCH = 40.0
PIT_GARAGE_GAP = 0.2
PIT_WALL_DECK = 2.6
PIT_LANE_SIGN = 16.0
PIT_BARRIER = 23.5
PLAYER_BAY = 7
BAY_SPACING = 14.0
BOX_LATERAL = 22.0
FAST_LANE_CENTRE = 14.5
GARAGE_CARVE = 14.0
GARAGE_FLOOR_SINK = 0.3
PIT_ENTRY_MOUTH = 65.0
PIT_EXIT_MOUTH = 70.0
PIT_KERB_GAP = 4.0
WALL_SMOOTHING = 3
WALL_INNER_RATIO = 0.2
KERB_WIDTH = 1.2
RUNOFF_WIDTH = 3.0
KERB_RADIUS = 220.0
EXIT_KERB_RADIUS = 120.0
WALL_REACH = 120.0
WALL_FALLBACK = 30.0
WALL_CLEARANCE = 3.0
GRID_SLOTS = 22
VERGE_FRACTIONS = [0.0, 0.05, 0.25, 0.5, 0.75, 1.0]
GROUND_BLEND = 60.0
GROUND_SMOOTHING = 9.0
GROUND_SOFTENING = 0.25
VERGE_EXTENSION = [2.0, 4.0, 6.0]
GROUND_NEIGHBOURS = 24
VERGE_MIN = 1.0
TERRAIN_SPACING = 4.0
TERRAIN_MARGIN = 650.0
TERRAIN_SINK = 0.1
TERRAIN_ROAD_SINK = 0.5
PIT_CLEARANCE = 9.0
PIT_BUILDING_HEIGHT = 14.0
BUILDING_DEFAULT_HEIGHT = 5.0
TOWER_MIN_HEIGHT = 40.0
AMPHITHEATRE_REACH = 160.0
UTM = Transformer.from_crs(4326, 32614, always_xy=True)
REGION_SIZE = 44000.0
REGION_CENTRE = (631483.0, 3334446.0)
HORIZON_STRIDE = 3
HORIZON_OVERLAP = 180.0
HORIZON_SKIRT = 500.0
HORIZON_SINK = 6.0
CROWD_SEED = 29
CROWD_OCCUPANCY = 0.9
CROWD_ROW_STEP = 2.0
CROWD_BANKS = ((540.0, 760.0), (1180.0, 1460.0), (1640.0, 1860.0), (2360.0, 2640.0), (3660.0, 4360.0), (4680.0, 4900.0), (5120.0, 5330.0))
CROWD_BANK_NEAR = 0.6
CROWD_BANK_FAR = 5.4
CROWD_BANK_ROW = 0.9
CROWD_BANK_BACK = 6.0
CROWD_WALL_CLEARANCE = 0.5
CROWD_BANK_JITTER = 0.4
CROWD_BANK_DENSITY = 0.42
CROWD_GROVE_SCALE = 1 / 45.0
CROWD_GROVE = 0.42
CROWD_SHIRTS = ((0.62, 0.06, 0.05), (0.72, 0.1, 0.06), (0.06, 0.14, 0.5), (0.08, 0.2, 0.62), (0.75, 0.74, 0.72), (0.82, 0.82, 0.8), (0.05, 0.05, 0.06), (0.1, 0.11, 0.13), (0.75, 0.42, 0.06), (0.06, 0.34, 0.16), (0.42, 0.14, 0.42), (0.7, 0.6, 0.12))
GRID_BEHIND_LINE = 16.0
GRID_SPACING = 8.0
GRID_OFFSET = 3.5
SECTOR_LINES = [(30.136219, -97.632485), (30.137265, -97.636632)]


def circuit_chain(osm):
    nodes = []
    for member in osm.relations[CIRCUIT]["members"]:
        if member["type"] != "way" or member["role"]:
            continue
        way = osm.ways[member["ref"]]["nodes"]
        if nodes and nodes[-1] != way[0]:
            way = way[::-1]
        if nodes and nodes[-1] != way[0]:
            raise RuntimeError(f"circuit way {member['ref']} does not join the previous one")
        nodes += way if not nodes else way[1:]
    if nodes[0] != nodes[-1]:
        raise RuntimeError("circuit relation is not a closed loop")
    return osm.local([osm.nodes[n] for n in nodes[:-1]])


def track_surface(osm, chain):
    line = LineString(np.vstack([chain, chain[:1]]))
    pieces = [Polygon(osm.way(w["id"])).buffer(0) for w in osm.tagged("area:highway", "raceway")]
    pieces = [p for p in pieces if p.intersection(line).length > 300]
    surface = unary_union(pieces).buffer(0.01).buffer(-0.01)
    if surface.geom_type != "Polygon" or len(surface.interiors) == 0:
        raise RuntimeError("track surface is not a single ring")
    inner = max(surface.interiors, key=lambda r: r.length)
    return surface, LinearRing(surface.exterior.coords), LinearRing(inner.coords)


def periodic_fit(points, smoothing, weights=None):
    closed = np.vstack([points, points[:1]])
    w = None if weights is None else np.append(weights, weights[0])
    return splprep([closed[:, 0], closed[:, 1]], w=w, s=len(points) * smoothing, per=1)[0]


class Spline:
    def __init__(self, tck):
        self.tck = tck
        u = np.linspace(0, 1, 60000, endpoint=False)
        x, y = splev(u, tck)
        d = np.hypot(np.diff(x, append=x[0]), np.diff(y, append=y[0]))
        self.u = u
        self.s = np.concatenate([[0], np.cumsum(d)])[:-1]
        self.length = d.sum()

    def at(self, s):
        u = np.interp(np.mod(s, self.length), self.s, self.u)
        x, y = splev(u, self.tck)
        dx, dy = splev(u, self.tck, der=1)
        t = np.stack([dx, dy], 1)
        return np.stack([x, y], 1), t / np.linalg.norm(t, axis=1)[:, None]

    def sample(self, step, start=0.0):
        n = int(round(self.length / step))
        return self.at(start + np.arange(n) * self.length / n)

    def project(self, point):
        x, y = splev(self.u, self.tck)
        return self.s[np.argmin(np.hypot(x - point[0], y - point[1]))]


def normals(t):
    return np.stack([-t[:, 1], t[:, 0]], 1)


def ray(ring, origin, direction, reach):
    hit = LineString([origin, origin + direction * reach]).intersection(ring)
    points = [hit] if hit.geom_type == "Point" else [g for g in getattr(hit, "geoms", []) if g.geom_type == "Point"]
    return min((np.hypot(*(np.array(p.coords[0]) - origin)) for p in points), default=np.nan)


def fill(values):
    values = np.array(values, float)
    bad = ~np.isfinite(values)
    if bad.all():
        raise RuntimeError("no measurements to interpolate")
    i = np.arange(len(values))
    values[bad] = np.interp(i[bad], i[~bad], values[~bad], period=len(values))
    return values


def edges(points, tangents, left_ring, right_ring, reach=60.0):
    n = normals(tangents)
    left = [ray(left_ring, p, d, reach) for p, d in zip(points, n)]
    right = [ray(right_ring, p, -d, reach) for p, d in zip(points, n)]
    return fill(left), fill(right)


def curvature(points, tangents):
    heading = np.arctan2(tangents[:, 1], tangents[:, 0])
    ds = np.linalg.norm(np.roll(points, -1, 0) - points, axis=1)
    return ((np.roll(heading, -1) - heading + np.pi) % (2 * np.pi) - np.pi) / ds


def centreline(chain, outer, inner):
    tck = periodic_fit(chain, 1.0)
    for _ in range(3):
        points, _ = Spline(tck).sample(3.0)
        mids = []
        for p in points:
            q = Point(p)
            a, b = outer.interpolate(outer.project(q)), inner.interpolate(inner.project(q))
            mids.append(((a.x + b.x) / 2, (a.y + b.y) / 2))
        tck = periodic_fit(np.array(mids), 0.08)
    points, tangents = Spline(tck).sample(3.0)
    left = normals(tangents)
    inner_left = np.nanmean([np.isfinite(ray(inner, p, d, 60)) for p, d in zip(points[::40], left[::40])])
    left_ring, right_ring = (inner, outer) if inner_left > 0.5 else (outer, inner)
    for _ in range(8):
        points, tangents = Spline(tck).sample(3.0)
        left, right = edges(points, tangents, left_ring, right_ring)
        offset = gaussian_filter1d((left - right) / 2, 1.5, mode="wrap")
        width = gaussian_filter1d(left + right, 2, mode="wrap")
        k = gaussian_filter1d(curvature(points, tangents), 2, mode="wrap")
        weights = np.where(1 - np.abs(k) * width / 2 < 0.35, 0.3, 1.0)
        tck = periodic_fit(points + normals(tangents) * offset[:, None], 0.08, weights)
    return Spline(tck), left_ring, right_ring


def relax_hairpins(spline):
    points, tangents = spline.sample(STEP)
    for _ in range(HAIRPIN_ITERATIONS):
        tangents = np.roll(points, -1, 0) - np.roll(points, 1, 0)
        tangents /= np.linalg.norm(tangents, axis=1)[:, None]
        tight = np.abs(curvature(points, tangents)) > 1 / MIN_CENTRE_RADIUS
        if not tight.any():
            break
        reach = np.convolve(np.concatenate([tight[-HAIRPIN_REACH:], tight, tight[:HAIRPIN_REACH]]), np.ones(2 * HAIRPIN_REACH + 1), mode="valid") > 0
        middle = (np.roll(points, -1, 0) + np.roll(points, 1, 0)) / 2
        points = points + (middle - points) * reach[:, None] * 0.25
    return Spline(periodic_fit(points, 0.005))


def spans(mask):
    n = len(mask)
    if mask.all():
        return [(0, n)]
    start = int(np.argmin(mask))
    rolled = np.roll(mask, -start)
    out, i = [], 0
    while i < n:
        if rolled[i]:
            j = i
            while j < n and rolled[j]:
                j += 1
            out.append(((i + start) % n, j - i))
            i = j
        else:
            i += 1
    return out


def kerbs(k, step):
    n = len(k)
    smooth = gaussian_filter1d(k, 3, mode="wrap")
    out = []
    for start, count in spans(np.abs(smooth) > 1 / KERB_RADIUS):
        if count * step < 12:
            continue
        idx = (start + np.arange(count)) % n
        sign = np.sign(smooth[idx].sum())
        inside = "left" if sign > 0 else "right"
        outside = "right" if sign > 0 else "left"
        offset = int(np.argmax(np.abs(smooth[idx])))
        apex = (start + offset) * step
        reach = float(np.clip(0.35 * count * step, 12.0, 45.0))
        out.append({"side": inside, "from": apex - reach, "to": apex + reach})
        if np.abs(smooth[idx]).max() > 1 / EXIT_KERB_RADIUS:
            end = (start + count) * step + 20.0
            exit_from = apex + 0.3 * (end - apex)
            out.append({"side": outside, "from": exit_from, "to": min(end, exit_from + 70.0)})
    length = n * step
    merged = []
    for s in sorted(out, key=lambda s: s["from"]):
        previous = next((m for m in reversed(merged) if m["side"] == s["side"]), None)
        if previous is not None and s["from"] <= previous["to"]:
            previous["to"] = max(previous["to"], s["to"])
        else:
            merged.append(dict(s))
    return [
        {"kind": "kerb", "side": s["side"], "from": round(s["from"] % length, 3), "to": round(s["to"] % length, 3), "width": KERB_WIDTH}
        for s in merged
    ]


def crossings(ring, origin, direction, reach):
    hit = LineString([origin, origin + direction * reach]).intersection(ring)
    points = [hit] if hit.geom_type == "Point" else [g for g in getattr(hit, "geoms", []) if g.geom_type == "Point"]
    return sorted(np.hypot(*(np.array(p.coords[0]) - origin)) for p in points)


def arc_rows(count, step, start, end):
    first = int(np.ceil(start / step))
    last = int(np.floor((end if end >= start else end + count * step) / step))
    return np.arange(first, last + 1) % count


def pit_layout(surfaces, length):
    left = [s for s in surfaces if s["side"] == "left"]
    entry = max(s["to"] for s in left if s["to"] > length - 400) + PIT_KERB_GAP
    exit_line = min(s["from"] for s in left if 400 < s["from"] < 800) - PIT_KERB_GAP
    return {"entry": entry, "wallStart": entry + PIT_ENTRY_MOUTH, "wallEnd": exit_line - PIT_EXIT_MOUTH, "exit": exit_line}


def pit_reach(osm, points, tangents, zone):
    garages = next(w for w in osm.ways.values() if w.get("tags", {}).get("name") == "Pit Garages")
    front = LinearRing(osm.way(garages["id"]))
    n = normals(tangents)
    out = np.full(len(points), np.nan)
    hits = np.array([ray(front, points[i], n[i], PIT_GARAGE_SEARCH) for i in zone]) - PIT_GARAGE_GAP
    out[zone] = np.where(np.isfinite(hits), np.clip(hits, PIT_MIN_REACH, PIT_GARAGE_SEARCH), PIT_MIN_REACH)
    return out, zone[np.isfinite(hits)], float(np.median(hits[np.isfinite(hits)]))


def player_box(garage_rows, step, length):
    start = float(garage_rows[0]) * step
    span = (float(garage_rows[-1]) * step - start) % length
    spacing = span / int(span // BAY_SPACING)
    return (start + (PLAYER_BAY + 0.5) * spacing) % length


def walls(osm, points, tangents, width, rings, k, step, reach):
    rails = unary_union([LineString(osm.way(w["id"])) for w in osm.tagged("barrier", "guard_rail") if len(w["nodes"]) > 1])
    n = normals(tangents)
    out = []
    for direction in (1, -1):
        limits, found = [], []
        for p, v, w in zip(points, n, width):
            hits = crossings(rings, p, direction * v, WALL_REACH)
            limit = (hits[0] + hits[1]) / 2 if len(hits) > 1 else WALL_REACH
            limits.append(limit)
            found.append(ray(rails, p, direction * v, min(limit, w / 2 + RAIL_REACH)))
        limits = np.array(limits)
        found = np.array(found)
        synthetic = np.minimum(limits, width / 2 + SYNTHETIC_OFFSET)
        d = np.where(np.isfinite(found), found, synthetic)
        if direction == 1:
            d = np.where(np.isfinite(reach), reach, d)
        d = gaussian_filter1d(median_filter(d, 9, mode="wrap"), 2, mode="wrap")
        inside = np.where(direction * k > 0, (1 - WALL_INNER_RATIO) / np.maximum(np.abs(k), 1e-9), np.inf)
        d = np.maximum(np.minimum(np.maximum(d, width / 2 + WALL_CLEARANCE), inside), width / 2 + 0.5)
        forward = np.maximum(1 - direction * k * d, WALL_MIN_FORWARD)
        d = gaussian_filter1d(envelope(d, WALL_SLOPE * step * forward), WALL_SMOOTHING, mode="wrap")
        out.append(np.maximum(np.minimum(d, inside), width / 2 + 0.5))
    return out


def envelope(values, rise):
    out = values.copy()
    n = len(out)
    for _ in range(3):
        for i in range(n):
            out[i] = min(out[i], out[i - 1] + rise[i])
        for i in range(n - 1, -1, -1):
            out[i] = min(out[i], out[(i + 1) % n] + rise[i])
    return out


def pit_lane(layout, zone, points, n, centre, camber, reach, origin_height):
    lateral = (PIT_WALL + reach[zone]) / 2
    world = points[zone] + n[zone] * lateral[:, None]
    heights = centre[zone] + camber[zone] * lateral - origin_height
    return {
        "side": "left",
        **{key: round(value, 3) for key, value in layout.items()},
        "pitWall": PIT_WALL,
        "speedLimit": 80,
        "centerline": [{"x": round(p[0], 4), "y": round(h, 4), "z": round(-p[1], 4)} for p, h in zip(world, heights)],
    }


class Ground:
    def __init__(self, terrain, points, n, width, camber, centre, extents):
        self.terrain = terrain
        self.points = points
        self.n = n
        self.width = width
        self.camber = camber
        self.centre = centre
        self.extents = extents
        self.rows = cKDTree(points)
        boundary, delta = [], []
        for side, sign in ((0, 1), (1, -1)):
            lateral = sign * (width / 2 + extents[:, side])
            edge = points + n * lateral[:, None]
            boundary.append(edge)
            delta.append(centre + camber * lateral - terrain(edge))
        self.boundary = cKDTree(np.vstack(boundary))
        self.delta = np.concatenate(delta)

    def lateral(self, xy):
        _, index = self.rows.query(xy)
        lateral = np.einsum("ij,ij->i", xy - self.points[index], self.n[index])
        side = np.where(lateral >= 0, 0, 1)
        reach = self.width[index] / 2 + self.extents[index, side]
        return index, lateral, reach

    def plane(self, xy):
        index, lateral, reach = self.lateral(xy)
        return self.centre[index] + self.camber[index] * lateral, np.abs(lateral) <= reach, np.abs(lateral) - reach

    def __call__(self, xy):
        plane, covered, _ = self.plane(xy)
        distance, nearest = self.boundary.query(xy, k=GROUND_NEIGHBOURS, distance_upper_bound=GROUND_BLEND)
        valid = np.isfinite(distance)
        weights = np.where(valid, 1.0 / (np.where(valid, distance, 1.0) ** 2 + GROUND_SOFTENING), 0)
        correction = (weights * self.delta[np.where(valid, nearest, 0)]).sum(1) / np.maximum(weights.sum(1), 1e-9)
        t = np.clip(np.where(valid[:, 0], distance[:, 0], GROUND_BLEND) / GROUND_BLEND, 0, 1)
        fade = 1 - t * t * (3 - 2 * t)
        return np.where(covered, plane, self.terrain(xy) + fade * correction)


def verge_extents(width, wall_left, wall_right):
    return np.stack([np.maximum(wall - width / 2, VERGE_MIN) for wall in (wall_left, wall_right)], 1)


def verge(points, n, width, camber, centre, extents, ground_height):
    fractions = np.array(VERGE_FRACTIONS)
    extension = np.array(VERGE_EXTENSION)
    flat = width[:, None, None] / 2 + extents[:, :, None] * fractions[None, None, :]
    beyond = width[:, None, None] / 2 + extents[:, :, None] + extension[None, None, :]
    offsets = np.concatenate([flat, beyond], axis=2)
    signs = np.array([1.0, -1.0])[None, :, None]
    heights = centre[:, None, None] + signs * camber[:, None, None] * offsets
    for side, sign in ((0, 1), (1, -1)):
        world = points[:, None, :] + sign * n[:, None, :] * beyond[:, side, :, None]
        outer = ground_height(world.reshape(-1, 2)).reshape(len(points), len(extension))
        heights[:, side, len(fractions) :] = outer
    return offsets, heights


def ground(ground_height, points, origin_height, pit, garage_rows):
    lo = points.min(axis=0) - TERRAIN_MARGIN
    hi = points.max(axis=0) + TERRAIN_MARGIN
    xs = np.arange(lo[0], hi[0] + TERRAIN_SPACING, TERRAIN_SPACING)
    ys = np.arange(lo[1], hi[1] + TERRAIN_SPACING, TERRAIN_SPACING)
    gx, gy = np.meshgrid(xs, ys)
    grid = np.stack([gx.ravel(), gy.ravel()], 1)
    heights = ground_height(grid) - origin_height
    _, lateral, reach = ground_height.lateral(grid)
    index = ground_height.rows.query(grid)[1]
    on_road = np.abs(lateral) < ground_height.width[index] / 2 + RUNOFF_WIDTH + KERB_WIDTH
    under_verge = np.abs(lateral) < reach + VERGE_EXTENSION[-1] - TERRAIN_SPACING
    heights = heights - np.where(on_road, TERRAIN_ROAD_SINK, np.where(under_verge, TERRAIN_SINK, 0))
    lane = np.array([[q["x"], -q["z"]] for q in pit["centerline"]])
    lane_height = np.array([q["y"] for q in pit["centerline"]])
    near, which = cKDTree(lane).query(grid, distance_upper_bound=PIT_CLEARANCE)
    inside = np.isfinite(near)
    heights[inside] = np.minimum(heights[inside], lane_height[which[inside]] - TERRAIN_SINK)
    plane, _, _ = ground_height.plane(grid)
    footprint = np.isin(index, garage_rows) & (lateral > pit["garageFront"] - 1) & (lateral < pit["garageFront"] + GARAGE_CARVE)
    heights[footprint] = np.minimum(heights[footprint], plane[footprint] - origin_height - GARAGE_FLOOR_SINK)
    return xs, ys, heights.reshape(gy.shape)


def value_noise(points, scale, seed):
    rng = np.random.default_rng(seed)
    lattice = rng.random((64, 64))
    p = points * scale
    i = np.floor(p).astype(int)
    f = p - i
    f = f * f * (3 - 2 * f)
    at = lambda dx, dy: lattice[(i[:, 0] + dx) % 64, (i[:, 1] + dy) % 64]
    top = at(0, 0) * (1 - f[:, 0]) + at(1, 0) * f[:, 0]
    bottom = at(0, 1) * (1 - f[:, 0]) + at(1, 1) * f[:, 0]
    return top * (1 - f[:, 1]) + bottom * f[:, 1]


def crowd(stands, ground_height, points, normal, offsets, origin_height, path):
    rng = np.random.default_rng(CROWD_SEED)
    seated = [standshape.seats(stand) for stand in stands]
    seated = np.concatenate(seated)
    keep = rng.random(len(seated)) < CROWD_OCCUPANCY
    seated = seated[keep]
    rows = np.arange(0, len(points), max(1, int(round(CROWD_ROW_STEP / STEP))))
    banks = []
    for start, end in CROWD_BANKS:
        for row in rows[(rows * STEP >= start) & (rows * STEP < end)]:
            for sign, side in ((1, 0), (-1, 1)):
                for depth in np.arange(CROWD_BANK_NEAR, CROWD_BANK_FAR, CROWD_BANK_ROW):
                    xy = points[row] + normal[row] * sign * (offsets[row, side, -1] - CROWD_BANK_BACK + depth)
                    banks.append(xy + rng.normal(0, CROWD_BANK_JITTER, 2))
    banks = np.array(banks)
    grove = value_noise(banks, CROWD_GROVE_SCALE, CROWD_SEED)
    banks = banks[(grove > CROWD_GROVE) & (rng.random(len(banks)) < CROWD_BANK_DENSITY)]
    _, nearest = cKDTree(points).query(banks)
    across = np.einsum("ij,ij->i", banks - points[nearest], normal[nearest])
    side = (across < 0).astype(int)
    wall = offsets[nearest, side, -1] - CROWD_BANK_BACK
    banks = banks[np.abs(across) > wall + CROWD_WALL_CLEARANCE]
    standing = np.column_stack([banks, ground_height(banks) - origin_height])
    positions = np.concatenate([seated, standing])
    shirts = np.array(CROWD_SHIRTS, float)[rng.integers(0, len(CROWD_SHIRTS), len(positions))]
    shirts *= rng.uniform(0.7, 1.15, (len(positions), 1))
    data = np.column_stack([positions, rng.random(len(positions)), rng.integers(0, 32, len(positions)), shirts])
    path.write_bytes(data.astype(np.float32).tobytes())
    return len(seated), len(standing)


def venue(osm, ground_height, points, origin_height):
    near = cKDTree(points)
    stands, buildings = [], []
    pit = None
    tower = None
    for way in osm.ways.values():
        tags = way.get("tags", {})
        if len(way["nodes"]) < 4 or way["nodes"][0] != way["nodes"][-1]:
            continue
        outline = osm.way(way["id"])[:-1]
        polygon = Polygon(outline)
        if not polygon.is_valid or polygon.area < 20:
            continue
        centroid = np.array(polygon.centroid.coords[0])
        base = float(ground_height(outline).min() - origin_height)
        if tags.get("building") == "grandstand" or tags.get("leisure") == "bleachers":
            target = points[near.query(centroid)[1]]
            facing = (target - centroid) / np.linalg.norm(target - centroid)
            stands.append(
                {"outline": outline.round(3).tolist(), "base": base, "facing": facing.round(5).tolist(), "roof": tags.get("building") == "grandstand" and polygon.area > 2500}
            )
        elif tags.get("name") == "Pit Garages":
            pit = {"outline": outline.round(3).tolist(), "base": base, "height": PIT_BUILDING_HEIGHT}
        elif "building" in tags:
            height = float(tags.get("height", 0) or 0) or BUILDING_DEFAULT_HEIGHT
            if height > TOWER_MIN_HEIGHT:
                tower = centroid
                continue
            buildings.append({"outline": outline.round(3).tolist(), "base": base, "height": height})
    amphitheatre = np.mean([np.mean(s["outline"], axis=0) for s in stands if np.linalg.norm(np.mean(s["outline"], axis=0) - tower) < AMPHITHEATRE_REACH], axis=0)
    veil = (amphitheatre - tower) / np.linalg.norm(amphitheatre - tower)
    return {
        "stands": stands,
        "pit": pit,
        "buildings": buildings,
        "tower": {"position": tower.round(3).tolist(), "base": float(ground_height(tower[None, :])[0] - origin_height), "veil": veil.round(5).tolist()},
    }


def write_horizon(root, build, osm, origin_height, xs, ys):
    heights = np.asarray(Image.open(root / "source" / "region-dem.png"), np.float32) / 100.0 + 100.0
    size = heights.shape[0]
    stride = HORIZON_STRIDE
    rows, columns = np.meshgrid(np.arange(0, size, stride), np.arange(0, size, stride), indexing="ij")
    east = REGION_CENTRE[0] - REGION_SIZE / 2 + (columns + 0.5) * REGION_SIZE / size
    north = REGION_CENTRE[1] + REGION_SIZE / 2 - (rows + 0.5) * REGION_SIZE / size
    lon, lat = UTM.transform(east.ravel(), north.ravel(), direction="INVERSE")
    local = osm.local(np.stack([lat, lon], 1)).reshape(rows.shape + (2,))
    field = heights[rows, columns] - origin_height
    inside = (local[..., 0] > xs[0] + HORIZON_OVERLAP) & (local[..., 0] < xs[-1] - HORIZON_OVERLAP) & (local[..., 1] > ys[0] + HORIZON_OVERLAP) & (local[..., 1] < ys[-1] - HORIZON_OVERLAP)
    near = (local[..., 0] > xs[0] - HORIZON_SKIRT) & (local[..., 0] < xs[-1] + HORIZON_SKIRT) & (local[..., 1] > ys[0] - HORIZON_SKIRT) & (local[..., 1] < ys[-1] + HORIZON_SKIRT)
    field = np.where(near, field - HORIZON_SINK, field)
    u = (columns + 0.5) / size
    v = 1.0 - (rows + 0.5) / size
    np.savez(build / "horizon.npz", x=local[..., 0], y=local[..., 1], z=field, u=u, v=v, hole=inside)


def dense_centreline(points, n, width, step):
    factor = int(round(step / AERIAL_ROW))
    count = len(points)
    t = (np.arange(factor) / factor)[:, None]
    dense = []
    for i in range(count):
        p0, p1, p2, p3 = points[i - 1], points[i], points[(i + 1) % count], points[(i + 2) % count]
        dense.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    dense = np.concatenate(dense)
    delta = np.roll(dense, -1, 0) - np.roll(dense, 1, 0)
    tangent = delta / np.linalg.norm(delta, axis=1, keepdims=True)
    half = np.interp(np.arange(len(dense)) / factor, np.arange(count + 1), np.append(width, width[0]) / 2)
    return dense, np.stack([-tangent[:, 1], tangent[:, 0]], 1), half


def dense_kerbs(root, build, dense, normal, half, length, pit_rows, surfaces):
    factor = len(dense) // len(pit_rows)
    blocked = np.repeat(pit_rows, factor)
    step = length / len(dense)
    spans = aerial.bake(root / "source", dense, normal, half, step, blocked, root / "textures" / "baked", build)
    return spans or surfaces


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/cota")
    osm = Osm(root / "source" / "osm.json")
    terrain = Terrain(root / "source" / "dem.png", osm)
    chain = circuit_chain(osm)
    surface, outer, inner = track_surface(osm, chain)
    spline, left_ring, right_ring = centreline(chain, outer, inner)
    spline = relax_hairpins(spline)
    start = spline.project((0.0, 0.0))
    points, tangents = spline.sample(STEP, start)
    outside = max(surface.distance(Point(p)) for p in points)
    if outside > SURFACE_TOLERANCE:
        raise RuntimeError(f"centreline leaves the track surface by {outside:.1f} m")
    length = spline.length
    step = length / len(points)
    left, right = edges(points, tangents, left_ring, right_ring)
    width = gaussian_filter1d(left + right, 2, mode="wrap")
    k = gaussian_filter1d(curvature(points, tangents), 2, mode="wrap")
    limit = 2 * np.maximum(1 / np.maximum(np.abs(k), 1e-9) - MIN_EDGE_RADIUS, 0)
    surfaces = kerbs(k, step)
    layout = pit_layout(surfaces, length)
    zone = arc_rows(len(points), step, layout["entry"] % length, layout["exit"])
    width[arc_rows(len(points), step, layout["wallStart"] % length, layout["wallEnd"])] = NOMINAL_WIDTH
    limit[arc_rows(len(points), step, layout["wallStart"] % length, layout["wallEnd"])] = NOMINAL_WIDTH
    width = gaussian_filter1d(envelope(np.minimum(width, limit), np.full(len(width), MAX_WIDENING * step)), 3, mode="wrap")
    width = np.minimum(width, limit)
    n = normals(tangents)
    centre = gaussian_filter1d(terrain(points), 8, mode="wrap")
    hl = terrain(points + n * (width / 2 - 1)[:, None])
    hr = terrain(points - n * (width / 2 - 1)[:, None])
    camber = gaussian_filter1d(np.clip((hl - hr) / (width - 2), -MAX_CAMBER, MAX_CAMBER), 12, mode="wrap")
    origin_height = centre[0]
    reach, garage_rows, garage_front = pit_reach(osm, points, tangents, zone)
    wall_left, wall_right = walls(osm, points, tangents, width, unary_union([left_ring, right_ring]), k, STEP, reach)
    sectors = [float(round(spline.project(osm.local([line])[0]) - start, 3) % round(length, 3)) for line in SECTOR_LINES]
    extents = verge_extents(width, wall_left, wall_right)
    pit_rows = np.zeros(len(points), bool)
    pit_rows[zone] = True
    build = Path(sys.argv[2] if len(sys.argv) > 2 else "build/cota")
    dense, dense_n, dense_half = dense_centreline(points, n, width, step)
    surfaces = dense_kerbs(root, build, dense, dense_n, dense_half, length, pit_rows, surfaces)
    ground_height = Ground(Terrain(root / "source" / "dem.png", osm, GROUND_SMOOTHING), points, n, width, camber, centre, extents)
    track = {
        "id": "cota",
        "name": "Circuit of the Americas",
        "length": round(length, 3),
        "width": NOMINAL_WIDTH,
        "runoff": RUNOFF_WIDTH,
        "centerline": [
            {
                "x": round(p[0], 4),
                "y": round(h - origin_height, 4),
                "z": round(-p[1], 4),
                "width": round(w, 3),
                "camber": round(c, 4),
                "wallLeft": round(wl, 2),
                "wallRight": round(wr, 2),
            }
            for p, h, w, c, wl, wr in zip(points, centre, width, camber, wall_left, wall_right)
        ],
        "surfaces": surfaces,
        "pitLane": {
            **pit_lane(layout, zone, points, n, centre, camber, wall_left, origin_height),
            "garageStart": round(float(garage_rows[0]) * step, 3),
            "garageEnd": round(float(garage_rows[-1]) * step, 3),
            "garageFront": round(garage_front, 3),
            "pitWallDeck": PIT_WALL_DECK,
            "pitLaneSign": PIT_LANE_SIGN,
            "pitBarrier": PIT_BARRIER,
            "playerBay": PLAYER_BAY,
            "boxDistance": round(player_box(garage_rows, step, length), 3),
            "boxLateral": BOX_LATERAL,
            "fastLane": FAST_LANE_CENTRE,
        },
        "sectors": sorted(sectors),
        "grid": [
            {"distance": round(length - GRID_BEHIND_LINE - GRID_SPACING * i, 3), "offset": GRID_OFFSET * (-1 if i % 2 == 0 else 1)}
            for i in range(GRID_SLOTS)
        ],
    }
    pit = track["pitLane"]
    for key in layout:
        pit[key] = round(pit[key] % length, 3)
    (root / "track.json").write_text(json.dumps(track, separators=(",", ":")) + "\n")
    build.mkdir(parents=True, exist_ok=True)
    offsets, heights = verge(points, n, width, camber, centre, extents, ground_height)
    np.savez(build / "verge.npz", offsets=offsets, heights=heights - origin_height)
    xs, ys, field = ground(ground_height, points, origin_height, track["pitLane"], garage_rows)
    np.savez(build / "terrain.npz", x=xs, y=ys, heights=field)
    write_horizon(root, build, osm, origin_height, xs, ys)
    layout_data = venue(osm, ground_height, points, origin_height)
    (build / "venue.json").write_text(json.dumps(layout_data))
    print("crowd", crowd(layout_data["stands"], ground_height, points, n, offsets, origin_height, root / "crowd.bin"))
    print(f"trees {len(forest)}")
    heading = np.degrees(np.arctan2(tangents[:, 1], tangents[:, 0]))
    jump = np.abs(np.diff(gaussian_filter1d(curvature(points, tangents), 0.5, mode="wrap"))) / step
    print(
        f"length {length:.1f} m, {len(points)} points, width {width.min():.1f}..{width.max():.1f} m, "
        f"height {centre.min() - origin_height:.1f}..{centre.max() - origin_height:.1f} m, "
        f"camber {camber.min() * 100:.1f}..{camber.max() * 100:.1f} %, min radius {1 / np.abs(k).max():.1f} m, "
        f"curvature jump max {jump.max():.4f} /m^2, kerbs {len(track['surfaces'])}, "
        f"walls {wall_left.min():.1f}..{wall_left.max():.1f} / {wall_right.min():.1f}..{wall_right.max():.1f} m, "
        f"start heading {heading[0]:.2f} deg, sectors {track['sectors']}, pit {pit['side']} {pit['entry']}->{pit['exit']}"
    )


if __name__ == "__main__":
    main()
