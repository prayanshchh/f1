import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

from geo import BOUNDS, DEM_ORIGIN, DEM_SIZE

USER_AGENT = "f1-cota-track-builder"
DEM_SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
OSM_MAP = "https://api.openstreetmap.org/api/0.6/map.json"
KEEP = ("highway", "area:highway", "barrier", "building", "landuse", "natural", "leisure", "amenity", "man_made", "raceway")


def get(url, attempts=4):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))


def fetch_osm(out):
    west, south, east, north = BOUNDS
    data = json.loads(get(f"{OSM_MAP}?bbox={west},{south},{east},{north}"))
    elements = data["elements"]
    ways = [e for e in elements if e["type"] == "way" and any(k in e.get("tags", {}) for k in KEEP)]
    relations = [e for e in elements if e["type"] == "relation" and e.get("tags", {}).get("type") == "circuit"]
    used = {n for w in ways for n in w["nodes"]}
    used |= {m["ref"] for r in relations for m in r["members"] if m["type"] == "node"}
    nodes = [
        {k: e[k] for k in ("type", "id", "lat", "lon", "tags") if k in e}
        for e in elements
        if e["type"] == "node" and (e["id"] in used or "raceway" in e.get("tags", {}))
    ]
    ways = [{k: w[k] for k in ("type", "id", "nodes", "tags")} for w in ways]
    relations = [{k: r[k] for k in ("type", "id", "members", "tags")} for r in relations]
    out.write_text(
        json.dumps(
            {"copyright": data["copyright"], "license": data["license"], "elements": nodes + ways + relations},
            separators=(",", ":"),
        )
    )


def fetch_dem(out):
    x0, y0 = DEM_ORIGIN
    width, height = DEM_SIZE
    tile = 1000
    dem = np.zeros((height, width), np.float32)
    for top in range(0, height, tile):
        for left in range(0, width, tile):
            w, h = min(tile, width - left), min(tile, height - top)
            xmin, ymax = x0 + left, y0 - top
            url = (
                f"{DEM_SERVICE}?bbox={xmin},{ymax - h},{xmin + w},{ymax}&bboxSR=32614&imageSR=32614"
                f"&size={w},{h}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image"
            )
            for attempt in range(6):
                body = get(url)
                if body[:2] in (b"II", b"MM"):
                    break
                time.sleep(5 * (attempt + 1))
            else:
                raise RuntimeError(f"elevation service refused tile {left},{top}")
            dem[top : top + h, left : left + w] = tifffile.imread(io.BytesIO(body))
    centimetres = np.round((dem - 100.0) * 100.0)
    if centimetres.min() < 0 or centimetres.max() > 65535:
        raise RuntimeError("elevation outside the 100 m to 755 m PNG range")
    Image.fromarray(centimetres.astype(np.uint16)).save(out)


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/cota/source")
    source.mkdir(parents=True, exist_ok=True)
    fetch_osm(source / "osm.json")
    fetch_dem(source / "dem.png")


if __name__ == "__main__":
    main()
