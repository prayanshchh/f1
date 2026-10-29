# COTA circuit

Circuit of the Americas, Austin, Texas, generated from open data by the tools
in `tools/cota`. Every visible object and the Speed Dreams physics track come
from the same sources, so they stay aligned.

## Sources

- Track surface, centreline, widths, guard rails, pit lane, timing line,
  grandstands, bleachers, buildings and land use: OpenStreetMap,
  © OpenStreetMap contributors, ODbL. Saved in `source/osm.json`; see
  `source/LICENSE.md`.
- Ground height: USGS 3D Elevation Program 1 m lidar DEM (public domain),
  saved as `source/dem.png`.
- Corner identification and sector lines: SRO / GT America circuit sector map.
- Published GP length: formula1.com circuit guide.
- Surface textures: Poly Haven, CC0 (`textures/source`, `TEXTURE-SOURCES.json`).
- Advertising boards and painted run-off ads use fictional brands (Northwind,
  Voltara, Aurelia, Kestrel) set in Saira (SIL Open Font License); no real
  sponsor artwork is used.

## Pipeline

1. `uv run --project tools/cota python tools/cota/fetch.py` downloads the OSM
   extract and DEM.
2. `uv run --project tools/cota python tools/cota/track.py` writes `track.json`
   (centreline, width, camber, walls, rails, kerbs, pit lane, grid) and the
   build files for the ground surface, trees and venue layout.
3. `node tools/sd-track.mjs` writes the Speed Dreams track `cota.xml`.
4. `uv run --project tools/cota python tools/cota/textures.py` builds derived
   textures.
5. `blender -b --factory-startup -P tools/cota/road.py -- content/tracks/cota build/cota`
   builds `road.glb`: road, paint, kerbs, run-off, grass, terrain, pit lane,
   walls, fences, boards, trees, grandstands, pit building, buildings,
   observation tower and start gantry.
6. `blender -b --factory-startup -P tools/cota/scan.py -- content/tracks/cota build/cota`
   checks the whole lap for trackside and ground problems.

## Accuracy

The centreline is 5508.5 m against the published 5.513 km. Walls and physics
barriers exist only where OpenStreetMap maps a guard rail. Ground within the
drivable area follows the road's camber plane, which is what Speed Dreams
simulates; beyond it the lidar terrain is blended in smoothly. Building
heights come from OSM tags where present. The observation tower position
follows the COTA site plan; its form is an approximation. Grandstand seating,
roofs and the pit building facade are generated, not surveyed.
