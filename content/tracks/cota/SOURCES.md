# COTA Grand Prix scene

Full-scale visual reconstruction of Circuit of the Americas in Austin, Texas.
The full mapped Grand Prix loop is modelled, with extra detail around the pits,
starting grid and Turn 1. The NOCTIL 27 car is a separate placed copy.

## Sources

- Circuit centreline: https://github.com/bacinger/f1-circuits/blob/master/circuits/us-2012.geojson
  Copyright Tomislav Bacinger, MIT license. Full license in references/f1-circuits-LICENSE.md.
- Terrain: USGS National Map 3D Elevation Program, bare-earth DEM.
  https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
  The saved Float32 GeoTIFF covers the site. Its georeferencing tags are used
  when sampling heights; the requested export box was adjusted by the server.
- Corner identification and timing-line GPS: SRO / GT America circuit sector map.
  https://www.gtamerica.us/documents/notice/1357/1458891346ab3b1c866bbefd3bd1fe.pdf
- Venue arrangement: COTA official 2024 USGP map, saved in references/.
  https://circuitoftheamericas.com/wp-content/uploads/2024-USGP-Map.pdf
- Observation tower location/height and general form:
  https://circuitoftheamericas.com/blog/2024/2/20/all-about-the-cota-tower/
- Published GP length and corner count:
  https://www.formula1.com/en/latest/article/circuit-guide-everything-you-need-to-know-about-the-circuit-of-the-americas.3OjhBbugiQRmN4FnlpBtBc

## Accuracy and scope

This is a reference-based Blender environment, not a surveyed simulator track.
The mapped centreline is about 5.529 km in plan and 5.532 km including height;
the published GP length is 5.513 km. No artificial scaling was applied to force
agreement. Coordinates are converted to local metres, with the timing line near
the origin. The lap is closed and contains all 20 identified corners.

The approximately 31 m road elevation range comes from smoothed USGS terrain.
Bare-earth elevation does not establish exact asphalt banking, kerb heights,
bumps or resurfacing. The landscape is locally graded below the road, runoff
and paddock to prevent terrain protruding through those surfaces.

Widths, pit entry/exit, runoff limits, kerb placement, fences, garages,
grandstands, tower detailing and vegetation are modelling approximations.
Buildings represent the venue's general arrangement rather than an exact
current-year architectural survey. Reference maps are retained as references,
not used as imagery in the rendered venue. No existing team/sponsor artwork is
added to the car or environment.

## Scene organisation

Collections separate road, runoff, terrain, pit complex, grandstands, barriers,
tower, vegetation, the placed car, cameras and reference helpers. Five cameras
provide an aerial, two grid/car views, uphill Turn 1, and a true-plan view. The hidden closed
centreline can be used for later camera animation or driving work.

## Blender realism pass

Source: `projects/cota-realism/COTA-02-Realism-Refined.blend` in the Mixar workspace.
The original circuit and car are retained as separate scenes/checkpoints.

This pass adds metre-scaled 2K CC0 Poly Haven asphalt, concrete and dry-grass
base-colour, roughness and normal textures; original worn paint and rubber marks;
edge repairs; foliage and chain-link alpha cutouts; 24 open fictional-team garages
with workshop props; a narrower continuous pit fast lane and barrier openings.
Garage static ambient occlusion uses its own second UV set. Actual textures,
UVs and split normals are preserved in glTF rather than flattened to colours.
See TEXTURE-SOURCES.json and TEXTURE-LICENSE.txt for texture provenance.

The runtime mesh has 834862 triangles, 22 texture images, and 180 m spatial
batches. Only bitwise-identical vertices and unused data were removed. There is
no geometry simplification or texture resizing in this export.

The existing GP road geometry, car assets, main driving centreline and physics
parameters are unchanged. Pit centreline metadata follows the revised visual
lane. Architecture, pit layout and vegetation remain artistic approximations;
this is not a surveyed, licensed F1-game environment.
