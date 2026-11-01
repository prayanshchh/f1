import json
import sys
from pathlib import Path

import numpy as np
from scipy.interpolate import splev, splprep
from scipy.ndimage import gaussian_filter1d, median_filter
from scipy.spatial import cKDTree
from shapely import contains_xy
from shapely.geometry import LinearRing, LineString, Point, Polygon
from shapely.ops import unary_union

from geo import Osm, Terrain

CIRCUIT = 6537729
STEP = 2.0
NOMINAL_WIDTH = 14.0
MIN_INNER_RADIUS_RATIO = 0.15
MAX_CAMBER = 0.035
WALL_SLOPE = 0.35
WALL_MIN_FORWARD = 0.15
RAIL_REACH = 40.0
SYNTHETIC_OFFSET = 14.0
PIT_ALONG = 6.0
PIT_REACH = 60.0
PIT_LANE_HALF_WIDTH = 3.5
PIT_WALL_GAP = 1.5
APEX_OPEN_RATIO = 0.8
BARRIER_FILTER = 7
WALL_INNER_RATIO = 0.1
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
TREE_SPACING = 15.0
TREE_JITTER = 5.0
TREE_SEED = 11
TREE_GROVE_SCALE = 1 / 260.0
TREE_EDGE_BAND = 140.0
TREE_TRACK_CLEARANCE = 8.0
TREE_ROAD_BUFFER = {"service": 6.0, "footway": 3.0, "residential": 8.0, "secondary": 12.0, "tertiary": 10.0, "unclassified": 8.0, "raceway": 12.0}
TREE_AREA_BUFFER = 6.0
TREE_VARIANTS = 3
PIT_BUILDING_HEIGHT = 14.0
BUILDING_DEFAULT_HEIGHT = 5.0
TOWER_POSITION = [316.0, 188.0]
TREE_BASE_DENSITY = 0.12
TREE_PARKING_DENSITY = 0.06
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
    return [
        {"kind": "kerb", "side": s["side"], "from": round(s["from"] % length, 3), "to": round(s["to"] % length, 3), "width": KERB_WIDTH}
        for s in out
    ]


def crossings(ring, origin, direction, reach):
    hit = LineString([origin, origin + direction * reach]).intersection(ring)
    points = [hit] if hit.geom_type == "Point" else [g for g in getattr(hit, "geoms", []) if g.geom_type == "Point"]
    return sorted(np.hypot(*(np.array(p.coords[0]) - origin)) for p in points)


def pit_points(osm):
    way = next(w for w in osm.tagged("highway", "raceway") if w["tags"].get("name") == "Pit Lane")
    raw = osm.way(way["id"])
    seg = np.linalg.norm(np.diff(raw, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    tck = splprep([raw[:, 0], raw[:, 1]], u=s / s[-1], s=len(raw) * 0.2)[0]
    u = np.linspace(0, 1, int(s[-1] / STEP) + 1)
    return np.stack(splev(u, tck), 1)


def pit_gap(points, tangents, width, lane, direction):
    n = normals(tangents) * direction
    distance, index = cKDTree(lane).query(points)
    offset = lane[index] - points
    lateral = np.einsum("ij,ij->i", offset, n)
    along = np.abs(np.einsum("ij,ij->i", offset, tangents))
    beside = (lateral > 0) & (along < PIT_ALONG) & (distance < PIT_REACH)
    return np.where(beside, lateral - PIT_LANE_HALF_WIDTH - width / 2, np.inf)


def walls(osm, points, tangents, width, rings, k, step, lane):
    rails = unary_union([LineString(osm.way(w["id"])) for w in osm.tagged("barrier", "guard_rail") if len(w["nodes"]) > 1])
    n = normals(tangents)
    out, present = [], []
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
        gap = pit_gap(points, tangents, width, lane, direction)
        pit_wall = np.isfinite(gap) & (gap > PIT_WALL_GAP)
        pit_open = np.isfinite(gap) & ~pit_wall
        d = np.where(pit_wall, width / 2 + gap / 2, d)
        d = np.where(pit_open, np.minimum(limits, width / 2 + np.maximum(gap, 0) + 2 * PIT_LANE_HALF_WIDTH + 1), d)
        d = gaussian_filter1d(median_filter(d, 9, mode="wrap"), 2, mode="wrap")
        inside = np.where(direction * k > 0, (1 - WALL_INNER_RATIO) / np.maximum(np.abs(k), 1e-9), np.inf)
        apex = d > inside * APEX_OPEN_RATIO
        d = np.maximum(np.minimum(np.maximum(d, width / 2 + WALL_CLEARANCE), inside), width / 2 + 0.5)
        forward = np.maximum(1 - direction * k * d, WALL_MIN_FORWARD)
        d = np.maximum(envelope(d, WALL_SLOPE * step * forward), width / 2 + 0.5)
        barrier = ~(pit_open | apex)
        barrier = median_filter(barrier, BARRIER_FILTER, mode="wrap")
        present.append(barrier)
        out.append(d)
    return out, present


def envelope(values, rise):
    out = values.copy()
    n = len(out)
    for _ in range(3):
        for i in range(n):
            out[i] = min(out[i], out[i - 1] + rise[i])
        for i in range(n - 1, -1, -1):
            out[i] = min(out[i], out[(i + 1) % n] + rise[i])
    return out


def pit_lane(osm, ground_height, spline, origin_height):
    pts = pit_points(osm)
    heights = gaussian_filter1d(ground_height(pts), 4, mode="nearest") - origin_height
    main, tangents = spline.at(np.array([spline.project(pts[len(pts) // 2])]))
    side = "left" if np.dot(pts[len(pts) // 2] - main[0], normals(tangents)[0]) > 0 else "right"
    return {
        "side": side,
        "entry": float(spline.project(pts[0])),
        "exit": float(spline.project(pts[-1])),
        "speedLimit": 80,
        "centerline": [{"x": round(p[0], 4), "y": round(h, 4), "z": round(-p[1], 4)} for p, h in zip(pts, heights)],
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


def ground(ground_height, points, origin_height, pit):
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
    return xs, ys, heights.reshape(gy.shape)


def tree_exclusions(osm):
    shapes = []
    for way in osm.ways.values():
        tags = way.get("tags", {})
        coords = osm.way(way["id"])
        if len(coords) < 2:
            continue
        closed = way["nodes"][0] == way["nodes"][-1] and len(coords) >= 4
        highway = tags.get("highway")
        if highway in TREE_ROAD_BUFFER and not closed:
            shapes.append(LineString(coords).buffer(TREE_ROAD_BUFFER[highway]))
        elif closed and (
            "building" in tags
            or "area:highway" in tags
            or tags.get("natural") == "water"
            or tags.get("leisure") in ("bleachers", "swimming_pool", "sports_centre", "pitch")
            or tags.get("landuse") == "construction"
        ):
            shapes.append(Polygon(coords).buffer(TREE_AREA_BUFFER))
    return unary_union(shapes)


def parking(osm):
    return unary_union(
        [Polygon(osm.way(w["id"])).buffer(0) for w in osm.ways.values() if w.get("tags", {}).get("amenity") == "parking" and len(w["nodes"]) >= 4]
    )


def groves(osm):
    return unary_union(
        [Polygon(osm.way(w["id"])) for w in osm.ways.values() if w.get("tags", {}).get("natural") in ("wood", "scrub") and len(w["nodes"]) >= 4]
    )


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


def trees(osm, ground_height, points, offsets, xs, ys, origin_height):
    rng = np.random.default_rng(TREE_SEED)
    gx, gy = np.meshgrid(np.arange(xs[0], xs[-1], TREE_SPACING), np.arange(ys[0], ys[-1], TREE_SPACING))
    candidates = np.stack([gx.ravel(), gy.ravel()], 1) + rng.uniform(-TREE_JITTER, TREE_JITTER, (gx.size, 2))
    margin = np.minimum.reduce(
        [candidates[:, 0] - xs[0], xs[-1] - candidates[:, 0], candidates[:, 1] - ys[0], ys[-1] - candidates[:, 1]]
    )
    candidates, margin = candidates[margin > 10], margin[margin > 10]
    distance, index = cKDTree(points).query(candidates)
    reach = np.max(offsets[index, :, -1], axis=1) + TREE_TRACK_CLEARANCE
    keep = distance > reach
    candidates, margin = candidates[keep], margin[keep]
    blocked = tree_exclusions(osm)
    grove = groves(osm)
    free = ~contains_xy(blocked, candidates[:, 0], candidates[:, 1])
    candidates, margin = candidates[free], margin[free]
    density = TREE_BASE_DENSITY + 0.8 * np.clip((value_noise(candidates, TREE_GROVE_SCALE, TREE_SEED) - 0.35) * 2.5, 0, 1)
    density = np.where(contains_xy(parking(osm), candidates[:, 0], candidates[:, 1]), TREE_PARKING_DENSITY, density)
    density = np.where(contains_xy(grove, candidates[:, 0], candidates[:, 1]), 0.85, density)
    density = np.where(margin < TREE_EDGE_BAND, np.maximum(density, 0.8), density)
    chosen = candidates[rng.random(len(candidates)) < density]
    heights = ground_height(chosen) - origin_height
    return np.column_stack(
        [
            chosen,
            heights,
            rng.uniform(0.7, 1.3, len(chosen)),
            rng.uniform(0, 2 * np.pi, len(chosen)),
            rng.integers(0, TREE_VARIANTS, len(chosen)),
        ]
    )


def venue(osm, ground_height, points, origin_height):
    near = cKDTree(points)
    stands, buildings = [], []
    pit = None
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
            buildings.append({"outline": outline.round(3).tolist(), "base": base, "height": height})
    tower = np.array(TOWER_POSITION)
    return {
        "stands": stands,
        "pit": pit,
        "buildings": buildings,
        "tower": {"position": TOWER_POSITION, "base": float(ground_height(tower[None, :])[0] - origin_height)},
    }


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/cota")
    osm = Osm(root / "source" / "osm.json")
    terrain = Terrain(root / "source" / "dem.png", osm)
    chain = circuit_chain(osm)
    surface, outer, inner = track_surface(osm, chain)
    spline, left_ring, right_ring = centreline(chain, outer, inner)
    start = spline.project((0.0, 0.0))
    points, tangents = spline.sample(STEP, start)
    if not all(surface.contains(Point(p)) for p in points):
        raise RuntimeError("centreline leaves the track surface")
    length = spline.length
    step = length / len(points)
    left, right = edges(points, tangents, left_ring, right_ring)
    width = gaussian_filter1d(left + right, 2, mode="wrap")
    k = gaussian_filter1d(curvature(points, tangents), 2, mode="wrap")
    width = np.minimum(width, 2 * (1 - MIN_INNER_RADIUS_RATIO) / np.maximum(np.abs(k), 1e-9))
    n = normals(tangents)
    centre = gaussian_filter1d(terrain(points), 8, mode="wrap")
    hl = terrain(points + n * (width / 2 - 1)[:, None])
    hr = terrain(points - n * (width / 2 - 1)[:, None])
    camber = gaussian_filter1d(np.clip((hl - hr) / (width - 2), -MAX_CAMBER, MAX_CAMBER), 12, mode="wrap")
    origin_height = centre[0]
    (wall_left, wall_right), (rail_left, rail_right) = walls(osm, points, tangents, width, unary_union([left_ring, right_ring]), k, STEP, pit_points(osm))
    sectors = [float(round(spline.project(osm.local([line])[0]) - start, 3) % round(length, 3)) for line in SECTOR_LINES]
    extents = verge_extents(width, wall_left, wall_right)
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
                "railLeft": int(rl),
                "railRight": int(rr),
            }
            for p, h, w, c, wl, wr, rl, rr in zip(points, centre, width, camber, wall_left, wall_right, rail_left, rail_right)
        ],
        "surfaces": kerbs(k, step),
        "pitLane": pit_lane(osm, ground_height, spline, origin_height),
        "sectors": sorted(sectors),
        "grid": [
            {"distance": round(length - GRID_BEHIND_LINE - GRID_SPACING * i, 3), "offset": GRID_OFFSET * (-1 if i % 2 == 0 else 1)}
            for i in range(GRID_SLOTS)
        ],
    }
    pit = track["pitLane"]
    pit["entry"] = round((pit["entry"] - start) % length, 3)
    pit["exit"] = round((pit["exit"] - start) % length, 3)
    (root / "track.json").write_text(json.dumps(track, separators=(",", ":")) + "\n")
    build = Path(sys.argv[2] if len(sys.argv) > 2 else "build/cota")
    build.mkdir(parents=True, exist_ok=True)
    offsets, heights = verge(points, n, width, camber, centre, extents, ground_height)
    np.savez(build / "verge.npz", offsets=offsets, heights=heights - origin_height)
    xs, ys, field = ground(ground_height, points, origin_height, track["pitLane"])
    np.savez(build / "terrain.npz", x=xs, y=ys, heights=field)
    forest = trees(osm, ground_height, points, offsets, xs, ys, origin_height)
    np.save(build / "trees.npy", forest)
    (build / "venue.json").write_text(json.dumps(venue(osm, ground_height, points, origin_height)))
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
