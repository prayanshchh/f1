import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import map_coordinates

BOUNDS = (-97.650, 30.120, -97.620, 30.145)
DEM_ORIGIN = (630053, 3335851)
DEM_SIZE = (2860, 2810)
EARTH_RADIUS = 6378137.0
TIMING_LINE = 13826373967

_utm = Transformer.from_crs(4326, 32614, always_xy=True)


class Osm:
    def __init__(self, path):
        data = json.loads(Path(path).read_text())
        self.nodes = {e["id"]: (e["lat"], e["lon"]) for e in data["elements"] if e["type"] == "node"}
        self.ways = {e["id"]: e for e in data["elements"] if e["type"] == "way"}
        self.relations = {e["id"]: e for e in data["elements"] if e["type"] == "relation"}
        self.origin = self.nodes[TIMING_LINE]

    def local(self, latlon):
        lat0, lon0 = self.origin
        lat, lon = np.asarray(latlon, float).reshape(-1, 2).T
        east = np.radians(lon - lon0) * math.cos(math.radians(lat0)) * EARTH_RADIUS
        north = np.radians(lat - lat0) * EARTH_RADIUS
        return np.stack([east, north], 1)

    def latlon(self, points):
        lat0, lon0 = self.origin
        points = np.asarray(points, float).reshape(-1, 2)
        lon = lon0 + np.degrees(points[:, 0] / (math.cos(math.radians(lat0)) * EARTH_RADIUS))
        lat = lat0 + np.degrees(points[:, 1] / EARTH_RADIUS)
        return lat, lon

    def way(self, way_id):
        return self.local([self.nodes[n] for n in self.ways[way_id]["nodes"]])

    def tagged(self, key, value=None):
        return [
            w for w in self.ways.values() if key in w.get("tags", {}) and (value is None or w["tags"][key] == value)
        ]


class Terrain:
    def __init__(self, path, osm):
        self.heights = np.asarray(Image.open(path), np.float64) / 100.0 + 100.0
        self.osm = osm

    def __call__(self, points):
        lat, lon = self.osm.latlon(points)
        x, y = _utm.transform(lon, lat)
        rows = DEM_ORIGIN[1] - np.asarray(y) - 0.5
        cols = np.asarray(x) - DEM_ORIGIN[0] - 0.5
        return map_coordinates(self.heights, [rows, cols], order=1, mode="nearest")
