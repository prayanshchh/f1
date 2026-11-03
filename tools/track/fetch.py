import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

from brands import FONTS
from geo import BOUNDS, DEM_ORIGIN, DEM_SIZE

Image.MAX_IMAGE_PIXELS = None

USER_AGENT = "revracers-track-builder"
DEM_SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
AERIAL_SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage"
AERIAL_METRES_PER_PIXEL = 0.3
AERIAL_TILE = 4000
AERIAL_QUALITY = 92
FONT_REPOSITORY = "https://raw.githubusercontent.com/google/fonts/main"
REGION_SERVICE = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export"
REGION_SIZE = 44000
REGION_CENTRE = (631483, 3334446)
REGION_DEM_PIXELS = 1100
REGION_AERIAL_PIXELS = 4096
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


def aerial_tile(service, xmin, ymin, xmax, ymax, width, height):
    url = (
        f"{service}?bbox={xmin},{ymin},{xmax},{ymax}&bboxSR=32614&imageSR=32614"
        f"&size={width},{height}&format=png&pixelType=U8&bandIds=0,1,2&interpolation=RSP_BilinearInterpolation&f=image"
    )
    for attempt in range(6):
        body = get(url)
        if body[:4] == b"\x89PNG":
            return Image.open(io.BytesIO(body)).convert("RGB")
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"imagery service refused tile {xmin},{ymin}")


def fetch_aerial(out):
    x0, y0 = DEM_ORIGIN
    span_x, span_y = DEM_SIZE
    width = int(round(span_x / AERIAL_METRES_PER_PIXEL))
    height = int(round(span_y / AERIAL_METRES_PER_PIXEL))
    image = Image.new("RGB", (width, height))
    for top in range(0, height, AERIAL_TILE):
        for left in range(0, width, AERIAL_TILE):
            w, h = min(AERIAL_TILE, width - left), min(AERIAL_TILE, height - top)
            xmin = x0 + left * AERIAL_METRES_PER_PIXEL
            ymax = y0 - top * AERIAL_METRES_PER_PIXEL
            tile = aerial_tile(AERIAL_SERVICE, xmin, ymax - h * AERIAL_METRES_PER_PIXEL, xmin + w * AERIAL_METRES_PER_PIXEL, ymax, w, h)
            image.paste(tile, (left, top))
    image.save(out, quality=AERIAL_QUALITY, subsampling=0)


def fetch_region(dem_out, aerial_out):
    half = REGION_SIZE / 2
    cx, cy = REGION_CENTRE
    box = (cx - half, cy - half, cx + half, cy + half)
    url = (
        f"{REGION_SERVICE}?bbox={box[0]},{box[1]},{box[2]},{box[3]}&bboxSR=32614&imageSR=32614"
        f"&size={REGION_AERIAL_PIXELS},{REGION_AERIAL_PIXELS}&format=jpg&f=image"
    )
    Image.open(io.BytesIO(get(url))).convert("RGB").save(aerial_out, quality=AERIAL_QUALITY, subsampling=0)
    url = (
        f"{DEM_SERVICE}?bbox={box[0]},{box[1]},{box[2]},{box[3]}&bboxSR=32614&imageSR=32614"
        f"&size={REGION_DEM_PIXELS},{REGION_DEM_PIXELS}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image"
    )
    for attempt in range(6):
        body = get(url)
        if body[:2] in (b"II", b"MM"):
            break
        time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError("elevation service refused the region")
    dem = tifffile.imread(io.BytesIO(body))
    Image.fromarray(np.round((dem - 100.0) * 100.0).astype(np.uint16)).save(dem_out)


def fetch_fonts(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, path in FONTS.items():
        target = directory / f"{name}.ttf"
        if not target.exists():
            target.write_bytes(get(f"{FONT_REPOSITORY}/{path}"))


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/hill-country/source")
    fetch_fonts(Path("build/hill-country/fonts"))
    source.mkdir(parents=True, exist_ok=True)
    if not (source / "osm.json").exists():
        fetch_osm(source / "osm.json")
    if not (source / "dem.png").exists():
        fetch_dem(source / "dem.png")
    if not (source / "aerial.jpg").exists():
        fetch_aerial(source / "aerial.jpg")
    if not (source / "region-aerial.jpg").exists():
        fetch_region(source / "region-dem.png", source / "region-aerial.jpg")


if __name__ == "__main__":
    main()
