import json
import sys
from pathlib import Path

import numpy as np
from scipy.interpolate import splev, splprep
from scipy.ndimage import gaussian_filter1d, median_filter, minimum_filter1d
from scipy.spatial import cKDTree
from shapely.geometry import LinearRing, LineString, Point, Polygon
from shapely.ops import unary_union

from geo import Osm, Terrain

CIRCUIT = 6537729
STEP = 2.0
NOMINAL_WIDTH = 14.0
MIN_INNER_RADIUS_RATIO = 0.15
MAX_CAMBER = 0.07
KERB_WIDTH = 1.2
RUNOFF_WIDTH = 3.0
KERB_RADIUS = 220.0
EXIT_KERB_RADIUS = 120.0
WALL_REACH = 120.0
WALL_FALLBACK = 30.0
WALL_CLEARANCE = 3.0
GRID_SLOTS = 22
VERGE_FLAT_FRACTIONS = [0.0, 0.05, 0.25, 0.5, 0.75, 1.0]
VERGE_BLEND_SAMPLES = [3.0, 7.0, 11.0, 15.0]
VERGE_MIN = 1.0
VERGE_GAP = 0.0
TERRAIN_SPACING = 6.0
TERRAIN_MARGIN = 650.0
TERRAIN_SINK = 0.8
TERRAIN_FEATHER = 6.0
TERRAIN_COVER = 0.3
PIT_CLEARANCE = 9.0
RAIL_FILTER = 9
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


def walls(osm, points, tangents, width, rings, k):
    rails = unary_union([LineString(osm.way(w["id"])) for w in osm.tagged("barrier", "guard_rail") if len(w["nodes"]) > 1])
    n = normals(tangents)
    out, gaps, real = [], [], []
    for direction in (1, -1):
        d, gap, found = [], [], []
        for p, v in zip(points, n):
            hits = crossings(rings, p, direction * v, WALL_REACH)
            limit = (hits[0] + hits[1]) / 2 if len(hits) > 1 else WALL_REACH
            rail = ray(rails, p, direction * v, limit)
            d.append(rail if rail < limit else min(limit, WALL_FALLBACK))
            gap.append(limit)
            found.append(rail < limit)
        gaps.append(minimum_filter1d(np.array(gap), 15, mode="wrap"))
        real.append(median_filter(np.array(found), RAIL_FILTER, mode="wrap"))
        d = np.array(d)
        d = np.where(np.isfinite(d), d, WALL_FALLBACK)
        d = median_filter(d, 9, mode="wrap")
        d = gaussian_filter1d(d, 2, mode="wrap")
        inside = np.where(direction * k > 0, (1 - MIN_INNER_RADIUS_RATIO) / np.maximum(np.abs(k), 1e-9), np.inf)
        out.append(np.maximum(np.minimum(np.maximum(d, width / 2 + WALL_CLEARANCE), inside), width / 2 + 0.5))
    return out, gaps, real


def pit_lane(osm, terrain, spline, origin_height):
    way = next(w for w in osm.tagged("highway", "raceway") if w["tags"].get("name") == "Pit Lane")
    raw = osm.way(way["id"])
    seg = np.linalg.norm(np.diff(raw, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    tck = splprep([raw[:, 0], raw[:, 1]], u=s / s[-1], s=len(raw) * 0.2)[0]
    u = np.linspace(0, 1, int(s[-1] / STEP) + 1)
    pts = np.stack(splev(u, tck), 1)
    heights = gaussian_filter1d(terrain(pts), 4, mode="nearest") - origin_height
    main, tangents = spline.at(np.array([spline.project(pts[len(pts) // 2])]))
    side = "left" if np.dot(pts[len(pts) // 2] - main[0], normals(tangents)[0]) > 0 else "right"
    return {
        "side": side,
        "entry": float(spline.project(pts[0])),
        "exit": float(spline.project(pts[-1])),
        "speedLimit": 80,
        "centerline": [{"x": round(p[0], 4), "y": round(h, 4), "z": round(-p[1], 4)} for p, h in zip(pts, heights)],
    }


def verge(terrain, points, n, width, camber, k, wall_left, wall_right, gaps, centre):
    flat_fractions = np.array(VERGE_FLAT_FRACTIONS)
    blend = np.array(VERGE_BLEND_SAMPLES)
    count = len(flat_fractions) + len(blend)
    offsets = np.empty((len(points), 2, count))
    heights = np.empty_like(offsets)
    edge_lateral = np.minimum(width / 2, NOMINAL_WIDTH / 2)
    for side, (sign, wall) in enumerate(((1, wall_left), (-1, wall_right))):
        inside = np.where(sign * k > 0, (1 - MIN_INNER_RADIUS_RATIO) / np.maximum(np.abs(k), 1e-9), np.inf)
        inside = np.minimum(inside, gaps[side] - VERGE_GAP)
        room = gaussian_filter1d(np.maximum(inside - width / 2, VERGE_MIN), 2, mode="wrap")
        flat = np.minimum(np.maximum(wall - width / 2, VERGE_MIN), room)
        t = np.concatenate([flat[:, None] * flat_fractions[None, :], flat[:, None] + blend[None, :]], 1)
        t = np.minimum(t, room[:, None])
        t = np.maximum.accumulate(t + np.arange(count)[None, :] * 1e-3, axis=1)
        offsets[:, side] = width[:, None] / 2 + t
        world = points[:, None, :] + sign * n[:, None, :] * offsets[:, side, :, None]
        dem = terrain(world.reshape(-1, 2)).reshape(len(points), count)
        level = centre + sign * camber * edge_lateral
        a = np.clip((t - flat[:, None]) / blend[-1], 0, 1)
        a = a * a * (3 - 2 * a)
        heights[:, side] = level[:, None] * (1 - a) + gaussian_filter1d(dem, 2, axis=0, mode="wrap") * a
    return offsets, heights


def ground(terrain, points, n, offsets, verge_heights, origin_height, pit, centre):
    lo = points.min(axis=0) - TERRAIN_MARGIN
    hi = points.max(axis=0) + TERRAIN_MARGIN
    xs = np.arange(lo[0], hi[0] + TERRAIN_SPACING, TERRAIN_SPACING)
    ys = np.arange(lo[1], hi[1] + TERRAIN_SPACING, TERRAIN_SPACING)
    gx, gy = np.meshgrid(xs, ys)
    grid = np.stack([gx.ravel(), gy.ravel()], 1)
    heights = terrain(grid) - origin_height
    distance, index = cKDTree(points).query(grid)
    lateral = np.einsum("ij,ij->i", grid - points[index], n[index])
    side = np.where(lateral >= 0, 0, 1)
    reach = offsets[index, side, -1]
    t = np.clip((reach - np.abs(lateral)) / TERRAIN_FEATHER, 0, 1)
    heights = heights - TERRAIN_SINK * t * t * (3 - 2 * t)
    for i in np.flatnonzero(np.abs(lateral) < reach):
        j, k = index[i], side[i]
        cover = np.interp(abs(lateral[i]), offsets[j, k], verge_heights[j, k]) - origin_height
        heights[i] = min(heights[i], cover - TERRAIN_COVER)
    lane = np.array([[q["x"], -q["z"]] for q in pit["centerline"]])
    lane_height = np.array([q["y"] for q in pit["centerline"]])
    near, which = cKDTree(lane).query(grid, distance_upper_bound=PIT_CLEARANCE)
    road_level = centre[cKDTree(points).query(lane)[1]] - origin_height
    floor = np.minimum(lane_height, road_level) - TERRAIN_COVER
    for i in np.flatnonzero(np.isfinite(near)):
        heights[i] = min(heights[i], floor[which[i]])
    return xs, ys, heights.reshape(gy.shape)


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
    centre = gaussian_filter1d(terrain(points), 3, mode="wrap")
    hl = terrain(points + n * (width / 2 - 1)[:, None])
    hr = terrain(points - n * (width / 2 - 1)[:, None])
    camber = np.clip(gaussian_filter1d((hl - hr) / (width - 2), 6, mode="wrap"), -MAX_CAMBER, MAX_CAMBER)
    origin_height = centre[0]
    (wall_left, wall_right), gaps, rails = walls(osm, points, tangents, width, unary_union([left_ring, right_ring]), k)
    sectors = [float(round(spline.project(osm.local([line])[0]) - start, 3) % round(length, 3)) for line in SECTOR_LINES]
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
        "surfaces": kerbs(k, step),
        "pitLane": pit_lane(osm, terrain, spline, origin_height),
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
    offsets, heights = verge(terrain, points, n, width, camber, k, wall_left, wall_right, gaps, centre)
    np.savez(build / "verge.npz", offsets=offsets, heights=heights - origin_height, rails=np.stack(rails, 1))
    xs, ys, field = ground(terrain, points, n, offsets, heights, origin_height, track["pitLane"], centre)
    np.savez(build / "terrain.npz", x=xs, y=ys, heights=field)
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
