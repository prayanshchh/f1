# Hill Country Circuit

A circuit near Austin, Texas, generated from open data by the tools
in `tools/track`. Every visible object and the Speed Dreams physics track come
from the same sources, so they stay aligned.

## Sources

- Track surface, centreline, widths, guard rails, pit lane, timing line,
  grandstands, bleachers, buildings and land use: OpenStreetMap,
  © OpenStreetMap contributors, ODbL. Saved in `source/osm.json`; see
  `source/LICENSE.md`.
- Ground height: USGS 3D Elevation Program 1 m lidar DEM (public domain),
  saved as `source/dem.png`.
- Corner identification and sector lines: published circuit sector maps.
- Race lap length: published circuit guides.
- Aerial photography: USGS National Agriculture Imagery Program at 0.3 m
  (`source/aerial.jpg`, public domain) gives the kerb positions, paint and
  run-off bands, ground colour and tree positions. USGS National Map imagery
  and 3DEP elevation (`source/region-*`, public domain) give the horizon.
- Surface textures: Poly Haven, CC0 (`textures/source`, `TEXTURE-SOURCES.json`).
- Skies: Poly Haven, CC0 (`sky/`): Kloofendal 48d Partly Cloudy Pure Sky for the
  circuit's own time of day, and Qwantani Dawn, Mid Morning, Noon, Afternoon,
  Dusk 2 and Night Pure Sky for the other time-of-day settings.
- Advertising boards use twelve fictional brands (Northwind, Voltara, Aurenne,
  Kestrel, Marlowe Outfitters, Torqua, Cordave Rail, Verdale, Albaren Air,
  Nimbara Cloud, Maison Luce, Halden) set in Anton, Oswald, Playfair Display,
  Montserrat, Cinzel and Barlow Condensed (SIL Open Font License); no real
  sponsor artwork is used.

## Pipeline

1. `uv run --project tools/track python tools/track/fetch.py` downloads the OSM
   extract and DEM.
2. `uv run --project tools/track python tools/track/track.py` writes `track.json`
   (centreline, width, camber, walls, kerbs, pit lane, grid),
   `crowd.bin`, the road-space paint masks and ground colour in
   `textures/baked`, and the build files for the ground surface, horizon and
   venue layout.
3. `node tools/sd-track.mjs` writes the Speed Dreams track `hill-country.xml`.
4. `uv run --project tools/track python tools/track/textures.py` builds derived
   textures.
5. `blender -b --factory-startup -P tools/track/road.py -- content/tracks/hill-country build/hill-country`
   builds `road.glb`: road, paint, kerbs, ground, terrain, horizon, pit lane,
   walls, fences, boards, grandstands, pit building, buildings, observation
   tower, start gantry, tents, cranes, masts, screens and the Austin skyline.
6. `blender -b --factory-startup -P tools/track/people.py -- content/tracks/hill-country build/hill-country`
   bakes the crowd sprites; `tools/track/sky.py` crops a sky and bakes its environment.
7. `blender -b --factory-startup -P tools/track/scan.py -- content/tracks/hill-country build/hill-country`
   checks the whole lap for trackside and ground problems.

## Accuracy

Walls and physics barriers follow OpenStreetMap guard rails out to 110 m from
the road, with synthetic walls elsewhere. Kerbs come from the aerial photo,
where they show as a 5 m red and white cycle. Ground within the
drivable area follows the road's camber plane, which is what Speed Dreams
simulates; beyond it the lidar terrain is blended in smoothly. Building
heights come from OSM tags where present. The observation tower position
comes from OpenStreetMap; its form is an approximation. Grandstand seating,
roofs and the pit building facade are generated, not surveyed.

## Pit crew

- Character models, hair and animations in `source/crew/` are the Standard versions of [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) and [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) by Quaternius, CC0 1.0. The licence files are alongside them.
