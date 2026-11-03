# Credits and licences

RevRacers stands on the work of many other people. This file lists every
third-party project, asset and data source the game uses, with its licence.
If you redistribute RevRacers, keep this file with it.

## Speed Dreams

**RevRacers would not exist without [Speed Dreams](https://www.speed-dreams.net/).**

Every car in RevRacers is driven by the Speed Dreams simulation: tyres,
suspension, aerodynamics, engine, gearbox, brakes, collisions, the track
model and the race engine. We compile it, unmodified, to WebAssembly and
draw it in the browser. The camera, lighting and model-loading code in our
renderer started as ports of Speed Dreams' `osggraph` module.

Speed Dreams is a free, open-source motorsport simulator made by a community
of volunteers over more than two decades. It grew out of
[TORCS](https://sourceforge.net/projects/torcs/), which in turn grew out of
RARS. Our thanks go to everyone who built it, including Eric Espié,
Jean-Philippe Meuret, Bernhard Wymann, Christophe Guionneau,
Wolf-Dieter Beelitz, Xavier Bertaux, Gaëtan André, Mart Kelder,
Xavier Del Campo Romero, and the many other authors named in the source
files and in the Speed Dreams history.

- Source: <https://forge.a-lec.org/speed-dreams/speed-dreams-code>
- Revision used: `4e29a83bb701f47ade617a9d73e20e736c492e82` (2026-10-19)
- Location here: `engine/speed-dreams` (kept byte-for-byte identical to
  upstream; unused tracks and cars were removed)
- Licence: GNU General Public License, version 2 or (at your option) any
  later version. See `engine/speed-dreams/LICENSE`.

RevRacers is an independent project. It is not part of Speed Dreams, and the
Speed Dreams team has not reviewed or endorsed it. Please do not send
RevRacers bug reports to them, and read their contribution rules (including
`NOAI.md`, which rejects AI-assisted contributions) before offering them any
change.

Code in `engine/src` (the race loop, camera and input glue) and the renderer
ports in `apps/client/src/game` are adapted from Speed Dreams. Those parts
remain the work of their original Speed Dreams authors as well as ours, and
are distributed under GPL-3.0-or-later, which the Speed Dreams licence allows.

### Libraries bundled with Speed Dreams

| Component                                                                    | Location                            | Licence                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| FreeSOLID collision library (© 1996-1998 Gino van den Bergen, © 2001 Dtecta) | `engine/speed-dreams/freesolid`     | GNU LGPL 2 or later; `libmoto` under the Dtecta notice below |
| SimGear math (Mathias Fröhlich, Curtis L. Olson)                             | `engine/speed-dreams/src/libs/math` | GNU LGPL 2 or later                                          |
| Expat-derived XML parser (Thai Open Source Software Center Ltd)              | `engine/speed-dreams/src/libs/txml` | MIT (Expat), see `copying-expat.txt`                         |
| OpenSceneGraph subset (Robert Osfield and contributors)                      | `engine/third_party/OpenSceneGraph` | OpenSceneGraph Public License 1.0 (LGPL 2.1 with exceptions) |

FreeSOLID's `libmoto` math library carries this notice:

> Copyright (c) 2001 Dtecta <gino@dtecta.com>
>
> Permission to use, copy, modify, distribute and sell this software and its
> documentation for any purpose is hereby granted without fee, provided that
> the above copyright notice appear in all copies and that both that
> copyright notice and this permission notice appear in supporting
> documentation. Dtecta makes no representations about the suitability of
> this software for any purpose. It is provided "as is" without express or
> implied warranty.

### Car physics data

The RevRacers car's physics (mass, aerodynamics, tyres, suspension, engine and
gearbox data) is the **2022 Monoposto 1** car for Speed Dreams by
**Peter Collings**, © 2022, used under the
[Free Art License 1.3](https://artlibre.org/licence/lal/en/). Source:
<https://forge.a-lec.org/speed-dreams/22mp1-sector-mcl36>; the exact revision
is recorded in the car's `UPSTREAM` file under
`engine/speed-dreams/speed-dreams-data`. The visible car bodies are our own.

## Track data

The circuit is generated from open data by the tools in `tools/`. Each track
folder under `content/tracks` has a `SOURCES.md` with the full pipeline.

- **Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors**, available under the Open Database License 1.0. Track
  layout, widths, barriers, pit lane and venue buildings come from it. The
  track geometry files we derive from it (`track.json`, the Speed Dreams
  track XML, circuit map and racing-line data) are made available under the
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The rendered
  scenery is a Produced Work and keeps the attribution above.
- Elevation: U.S. Geological Survey 3D Elevation Program, public domain.
- Aerial imagery: USGS National Agriculture Imagery Program and The National
  Map, public domain.
- Surface textures and skies: [Poly Haven](https://polyhaven.com/), CC0 1.0.
  Each file, author and checksum is listed in `TEXTURE-SOURCES.json`.
- Pit crew characters and animations: Universal Base Characters and
  Universal Animation Library by [Quaternius](https://quaternius.com/),
  CC0 1.0.
- Trackside boards use fictional brands set in Anton, Oswald,
  Playfair Display, Montserrat, Cinzel and Barlow Condensed, all under the
  SIL Open Font License 1.1.

## Music

| Cue      | Track                                                                                                              | Artist        | Licence                 |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------- |
| Intro    | [Sport Epic Cinematic Trailer](https://pixabay.com/music/adventure-sport-epic-cinematic-trailer-adventure-591906/) | 331music      | Pixabay Content License |
| Menus    | [Hyperflight Racing](https://opengameart.org/content/hyperflight-racing)                                           | cynicmusic    | CC0 1.0                 |
| Build-up | [Action Trailer](https://pixabay.com/music/action-action-trailer-624648/)                                          | Kulakovka     | Pixabay Content License |
| Victory  | [Champion](https://pixabay.com/music/rock-champion-short-version-162086/)                                          | BreakzStudios | Pixabay Content License |

Download URLs and checksums are in `content/music/MUSIC-SOURCES.json`.
The Pixabay tracks are **not** covered by the RevRacers licence. They may be
used only as part of the game; do not extract them and redistribute or sell
them on their own. See the
[Pixabay Content License](https://pixabay.com/service/license-summary/).

Engine and tyre sounds are synthesised in the browser; no recorded audio is
used.

## Libraries

| Package                                                         | Use                         | Licence                           |
| --------------------------------------------------------------- | --------------------------- | --------------------------------- |
| [three.js](https://threejs.org/)                                | WebGPU rendering            | MIT                               |
| [Saira](https://fonts.google.com/specimen/Saira) via Fontsource | UI and livery typeface      | SIL Open Font License 1.1         |
| [flag-icons](https://github.com/lipis/flag-icons)               | Nationality flags           | MIT                               |
| [uqr](https://github.com/unjs/uqr)                              | Phone pad QR code           | MIT                               |
| [Hono](https://hono.dev/)                                       | API server                  | MIT                               |
| [PGlite](https://pglite.dev/)                                   | Local database              | Apache 2.0 / PostgreSQL License   |
| [node-postgres](https://node-postgres.com/)                     | Database client             | MIT                               |
| [Emscripten](https://emscripten.org/)                           | C++ to WebAssembly compiler | MIT / University of Illinois NCSA |

A production build writes the full licence text of every bundled
JavaScript dependency to `third-party-licenses.md` next to the game.

## RevRacers itself

- **Code** (everything not listed above): © 2026 Prayansh Chhablani and
  RevRacers contributors, licensed under the
  [GNU General Public License v3.0 or later](LICENSE).
- **Original art and branding** (the RevRacers name and logo, car bodies,
  liveries, team identities, track scenery models and UI artwork): © 2026
  Prayansh Chhablani, all rights reserved, except where a file or a source
  list in its folder says otherwise. They are not covered by the GPL.

## No affiliation

RevRacers is a fan-made racing game. All teams, drivers, sponsors, brands and
venues in the game are fictional. RevRacers is not affiliated with, sponsored
by or endorsed by Formula One, the FIA, any racing team, circuit, car maker,
game publisher or the Speed Dreams project. All trademarks belong to their
owners.
