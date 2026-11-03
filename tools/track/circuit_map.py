import json
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import LineString

from geo import Osm

MAJOR_ROADS = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "residential", "motorway_link", "trunk_link", "primary_link", "secondary_link",
    "tertiary_link", "living_street",
}
MINOR_ROADS = {"service", "track", "unclassified"}
SIMPLIFY = 1.5
TRACK_STRIDE = 2
CURVATURE_WINDOW = 15
TURN_SNAP = 40.0
BUILDING_HEIGHT = 7.0
STAND_HEIGHT = 16.0
ROUND = 1
TURNS = [
    (1, 656), (2, 908), (3, 1164), (4, 1252), (5, 1342), (6, 1432), (7, 1584),
    (8, 1714), (9, 1862), (10, 1976), (11, 2578), (12, 3764), (13, 3982),
    (14, 4080), (15, 4270), (16, 4490), (17, 4622), (18, 4794), (19, 5018),
    (20, 5318),
]
STRAIGHTS = [(2640, 3700), (5370, 300)]
SPEED_TRAP = 3640.0


def track_frame(osm, nodes):
    local = osm.local([osm.nodes[n] for n in nodes if n in osm.nodes])
    return local * np.array([1.0, -1.0])


def flat(points):
    return [round(float(v), ROUND) for point in points for v in point]


def line(points):
    simple = LineString(points).simplify(SIMPLIFY, preserve_topology=False)
    return flat(simple.coords)


def tag_height(tags, fallback):
    for key, scale in (("height", 1.0), ("building:levels", 3.2)):
        try:
            return max(3.0, float(str(tags.get(key, "")).split()[0]) * scale)
        except (ValueError, IndexError):
            continue
    return fallback


def classify(osm):
    layers = {"roads": [], "lanes": [], "aisles": [], "parking": [], "water": [], "buildings": []}
    for way in osm.ways.values():
        tags = way.get("tags", {})
        nodes = way.get("nodes", [])
        if len(nodes) < 2:
            continue
        points = track_frame(osm, nodes)
        if len(points) < 2:
            continue
        add_way(layers, tags, nodes, points)
    return layers


def add_way(layers, tags, nodes, points):
    highway = tags.get("highway")
    if highway in MAJOR_ROADS:
        layers["roads"].append(line(points))
    elif tags.get("service") == "parking_aisle":
        layers["aisles"].append(line(points))
    elif highway in MINOR_ROADS:
        layers["lanes"].append(line(points))
    elif nodes[0] == nodes[-1] and len(points) >= 4:
        add_area(layers, tags, points[:-1])


def add_area(layers, tags, ring):
    if "building" in tags or tags.get("leisure") == "bleachers":
        stand = tags.get("building") == "grandstand" or tags.get("leisure") == "bleachers"
        height = tag_height(tags, STAND_HEIGHT if stand else BUILDING_HEIGHT)
        layers["buildings"].append({"height": round(height, 1), "footprint": flat(ring)})
    elif tags.get("amenity") == "parking":
        layers["parking"].append(flat(ring))
    elif tags.get("natural") == "water":
        layers["water"].append(flat(ring))


def curvature(centerline):
    xz = np.array([[p["x"], p["z"]] for p in centerline])
    step = np.roll(xz, -1, 0) - xz
    heading = np.unwrap(np.arctan2(step[:, 1], step[:, 0]))
    kappa = np.gradient(heading) / np.linalg.norm(step, axis=1)
    kernel = np.ones(CURVATURE_WINDOW) / CURVATURE_WINDOW
    padded = np.r_[kappa[-CURVATURE_WINDOW:], kappa, kappa[:CURVATURE_WINDOW]]
    return np.convolve(padded, kernel, "same")[CURVATURE_WINDOW:-CURVATURE_WINDOW]


def snap_turns(track):
    points = track["centerline"]
    spacing = track["length"] / len(points)
    kappa = curvature(points)
    turns = []
    for number, approximate in TURNS:
        centre = int(round(approximate / spacing))
        reach = int(TURN_SNAP / spacing)
        window = range(centre - reach, centre + reach + 1)
        best = max(window, key=lambda i: abs(kappa[i % len(points)]))
        turns.append({
            "number": number,
            "distance": round(best * spacing, 1),
            "side": "left" if kappa[best % len(points)] < 0 else "right",
        })
    return turns


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/hill-country")
    osm = Osm(root / "source" / "osm.json")
    track = json.loads((root / "track.json").read_text())
    points = track["centerline"][:: TRACK_STRIDE]
    output = {
        **classify(osm),
        "track": {
            "length": track["length"],
            "points": [
                v
                for p in points
                for v in (round(p["x"], ROUND), round(p["y"], ROUND), round(p["z"], ROUND))
            ],
        },
        "turns": snap_turns(track),
        "sectors": track["sectors"],
        "straights": [list(pair) for pair in STRAIGHTS],
        "speedTrap": SPEED_TRAP,
    }
    (root / "circuit-map.json").write_text(json.dumps(output, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
