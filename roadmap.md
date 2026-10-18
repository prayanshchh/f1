# Roadmap

Status values: **Done**, **Not started**. A task is done only when its tests in `tests/<task>/` pass in CI.

Everything above the "Later (V2)" section belongs to the V1 architecture: one game server, one PostgreSQL database, no Redis, no object storage.

## Foundation

| ID  | Task                                                                                                                                                                                 | Needs | Done when                                                                                                          | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| F0  | Repo skeleton, Rust workspace, Vite+TS client, CI, Chrome WebGPU "hello"                                                                                                             | —     | CI is green and Chrome draws a triangle                                                                            | Done   |
| F1  | Contracts and conventions: SI units, glTF axes, 500 Hz physics tick, 62.5 Hz snapshots (every 8 ticks), max 22 cars, message list, World API (step, snapshot, save/load, state hash) | F0    | Stub world moves cars along the centerline; Chrome WASM and native state hashes match. Drawing the box moved to R1 | Done   |

## Physics

| ID  | Task                                                                                                           | Needs     | Done when                                                                                                         | Status      |
| --- | -------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | ----------- |
| P1  | Chassis, 4 suspension corners, fixed step, save/load, determinism check                                        | F1        | The car settles after a drop; browser and server-build state hashes match for 10,000 ticks                        | Not started |
| P2  | Tyre forces: Pacejka formula, combined slip, load sensitivity (pure functions)                                 | F1        | Curve unit tests pass; plots look right                                                                           | Not started |
| P3  | Engine, 8-speed gearbox, differential, brakes and brake bias, 2026 hybrid energy system                        | F1        | Wheel-torque and energy-balance tests pass                                                                        | Not started |
| P4  | Aero: drag, front/rear downforce, ride-height effect, active-aero modes                                        | F1        | Tests against target curves pass                                                                                  | Not started |
| P5  | Combine into one car and calibrate it                                                                          | P1–P4, T1 | 0–100 ≈ 2.6 s, top ≈ 340–350 km/h, ~5 g cornering and braking                                                     | Not started |
| P6  | Track contact: asphalt, kerbs, grass, gravel, bumps, walls (Rapier with `enhanced-determinism`), no tunnelling | P5, C2    | Surface scenarios pass; a 300 km/h wall hit never passes through; hashes still match browser vs native            | Not started |
| P7  | Tyre temperature, wear, Soft/Medium/Hard, fuel mass                                                            | P5        | Soft is fastest over 3 laps but slower over 25; wear depends on driving style                                     | Not started |
| P8  | Car-to-car collisions                                                                                          | P6        | Side, rear and pile-up scenarios stay stable                                                                      | Not started |
| P9  | Slipstream and dirty air                                                                                       | P5        | Following car gains on straights and loses grip in corners                                                        | Not started |
| P10 | Actuators and assists inside the car model: steering-rack rate limit, pedal travel, TC, ABS                    | P3        | A step input reaches the wheels at the rack's rate; an assisted car and a perfectly scripted car lap within noise | Not started |

## Tooling

| ID  | Task                                                                  | Needs | Done when                              | Status      |
| --- | --------------------------------------------------------------------- | ----- | -------------------------------------- | ----------- |
| T1  | Headless scenario runner + telemetry viewer                           | F1    | Straight-line scenario → plotted graph | Not started |
| T2  | Asset pipeline: KTX2 textures, meshopt, detail levels, per-tier packs | F1    | Over-budget assets fail the build      | Not started |
| T3  | Performance benchmarks + device test matrix                           | R2    | One report per tested Mac or PC        | Not started |

## Client runtime

| ID  | Task                                                                                                                                                                                   | Needs | Done when                                                                                                                 | Status      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| W1  | Thread layout: sim+net worker (WASM World, WebTransport, codec), main thread (DOM, keyboard, Gamepad, WebHID), SharedArrayBuffer input slot and state triple buffer, COOP/COEP headers | F1    | Blocking the main thread for 200 ms changes neither tick count nor hashes; a hidden tab keeps stepping and sending inputs | Not started |

## Render

| ID  | Task                                                                                                                       | Needs  | Done when                                                                                           | Status      |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- | ----------- |
| R1  | Render core: render worker (OffscreenCanvas), cameras, glTF, PBR, GPU-timing overlay; reads state from W1 and interpolates | F1, W1 | Placeholder scene at 60 FPS with GPU timings shown; the F1 stub car is drawn moving along the track | Not started |
| R2  | Quality tiers, startup benchmark, dynamic resolution, temporal upscaler, shader warm-up, WebGL2 Basic tier                 | R1     | Air vs Pro pick different tiers; no first-sight hitches; no WebGPU → Basic tier instead of an error | Not started |
| R3  | Car rendering: paint and carbon materials, cockpit, halo, mirrors                                                          | R1, C1 | Side-by-side with the reference screenshots                                                         | Not started |
| R4  | Track environment: terrain, baked lighting, grandstands, crowds, sky                                                       | R1, C3 | Target FPS per tier holds                                                                           | Not started |
| R5  | Effects: smoke, skid marks, sparks, heat haze, motion blur                                                                 | R1     | Each effect's cost measured per tier                                                                | Not started |
| R6  | Night racing lighting                                                                                                      | R4     | Night track holds High-tier FPS                                                                     | Not started |
| R7  | Streaming, OPFS cache, loading screen                                                                                      | T2, R1 | Measured cold- and warm-cache load times                                                            | Not started |

## Content

| ID  | Task                                                                        | Needs       | Done when                    | Status      |
| --- | --------------------------------------------------------------------------- | ----------- | ---------------------------- | ----------- |
| C1  | Original 2026-style car: exterior, cockpit, levels of detail, livery system | F1          | Passes T2 budgets            | Not started |
| C2  | Track 1 data: layout, elevation, surfaces, walls, pit lane, sectors         | F1          | Drivable in the stub world   | Not started |
| C3  | Track 1 environment art                                                     | C2          | Passes T2 budgets            | Not started |
| C4  | Fictional teams, drivers, liveries                                          | —           | 10 teams × 2 drivers defined | Not started |
| C5+ | Each additional track (one agent per track)                                 | C2 pipeline | Same checks as C2 + C3       | Not started |

## Game

| ID  | Task                                                                  | Needs  | Done when                                | Status      |
| --- | --------------------------------------------------------------------- | ------ | ---------------------------------------- | ----------- |
| G1  | Input: keyboard smoothing, gamepad, WebHID wheel with force feedback  | F1, W1 | Clean keyboard driving; wheel works      | Not started |
| G2  | HUD and menus: speed, gear, energy, tyre temperatures and wear, delta | F1     | Shows only real sim values               | Not started |
| G3  | Engine and tyre audio (AudioWorklet fed from shared state)            | F1, W1 | Pitch follows RPM and load               | Not started |
| G4  | Lap timing, sectors, track limits                                     | C2, P5 | Shortcuts or reversing can't create laps | Not started |
| G5  | Pit lane, speed limiter, pit stops                                    | G4, P7 | 1-stop vs 2-stop is a real trade-off     | Not started |
| G6  | Race session: lights, grid, penalties, results                        | G4     | Full race runs start to finish           | Not started |

## AI

AI is a deterministic Rust crate (`crates/ai`) that produces an `Input` per AI car from world state. It runs inside the client WASM for solo races and on the game server for multiplayer races. AI never sets positions: physics moves every car, including in collisions with humans, and the AI reads the resulting state every tick and reacts. The AI's own memory (current plan, mode, timers) is part of the world state, so `save`/`load`, the state hash and rewind-and-replay include it.

| ID  | Task                                                                                                                                              | Needs      | Done when                                                                                                                                                          | Status      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| A1  | Racing line + speed plan                                                                                                                          | C2, P5     | Line and speed profile generated for Track 1                                                                                                                       | Not started |
| A2  | AI driving controller in `crates/ai` (same car, no extra grip, deterministic, internal state saved with the world)                                | A1         | Clean laps within a few % of a good human; the same race gives identical hashes in Chrome and native; save → load → continue matches an uninterrupted run          | Not started |
| A3  | AI racecraft: overtaking, defending, avoidance                                                                                                    | A2, P8     | 20-car race without pile-ups                                                                                                                                       | Not started |
| A5  | AI incident handling: reacts to contact, spins, damage and being pushed off track; recovers and rejoins safely; avoids cars stopped after a crash | A3, P8, P6 | After a human hits an AI car at any angle, the AI either recovers and rejoins without hitting anyone, or retires if too damaged; same outcome in Chrome and native |
| A4  | AI tyre and pit strategy                                                                                                                          | A2, P7, G5 | AI cars choose different strategies                                                                                                                                | Not started |

## Network (V1: one game server)

| ID  | Task                                                                                                                                                                                                                                                                           | Needs          | Done when                                                                                                                                          | Status      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| N1  | Rooms inside the game server: HTTP endpoints to create a room and join by code or link; in-memory room table                                                                                                                                                                   | F1             | Two browsers join through one link                                                                                                                 | Not started |
| N8  | Wire codec in Rust (shared by server and WASM): postcard for reliable control messages; bit-packed, quantized snapshot datagrams with a full-precision block for the receiver's own car and the last input of every car; input batches with redundancy and run-length encoding | F1             | A 22-car snapshot is ≤ 1,200 bytes; encode/decode round-trips; fuzzed bytes never panic; opponents' hidden data (fuel, wear, energy) is never sent | Not started |
| N2  | Authoritative server: rooms, WebTransport (datagrams + one control stream), 500 Hz tick loop (stub world first), AI cars driven on the server, track referenced by content id + hash, physics-version handshake                                                                | F1, N8         | Two clients receive snapshots; a client with a different physics version is rejected                                                               | Not started |
| N10 | Server input validation: range and NaN checks, one input per car per tick, accepted tick window, missing input repeats last, per-connection rate limits, signed join ticket                                                                                                    | N2             | A hostile client cannot crash a room, move another car, or step outside the window; floods are dropped                                             | Not started |
| N9  | Clock sync and input timing: ping/pong RTT, tick offset, server input buffer sizing                                                                                                                                                                                            | N2             | At 100 ms ± 20 ms jitter, server input-buffer underruns stay below 1%                                                                              | Not started |
| N3  | Client prediction of the whole field (own car with real inputs, other cars with their last known input), rewind-and-replay correction, visual smoothing + fake-delay tool                                                                                                      | N2, N9, W1, P5 | Smooth driving at 100 ms delay with packet loss; other cars' corrections stay under a visible threshold on straights                               | Not started |
| N4  | Real physics on the server + multiplayer collisions                                                                                                                                                                                                                            | N3, P8         | All browsers agree after contact                                                                                                                   | Not started |
| N5  | Disconnects, reconnects, spectators; a disconnected human's car is handed to the AI or retired                                                                                                                                                                                 | N4             | No car keeps driving on stale input                                                                                                                | Not started |
| M1  | Race modes: solo (1 human + 21 AI, fully local, no server), mixed (humans + AI on the server), all-human (server)                                                                                                                                                              | W1, A2, N2     | A solo race opens no network connection; in a 2-human + 20-AI room both browsers show the same AI cars                                             | Not started |
| N13 | V1 deployment: one public VM, domain + TLS certificate, UDP and TCP 443 open, game server + PostgreSQL, static client on a CDN                                                                                                                                                 | N2             | Two browsers on different networks race through the public server; restarting the VM brings everything back                                        | Not started |

## Data (V1: PostgreSQL only)

| ID  | Task                                                                                                                                                                                                                                        | Needs      | Done when                                                                                      | Status      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- | ----------- |
| D1  | Replays in PostgreSQL: setup, physics version, per-car input streams (run-length + zstd) and per-lap `save()` checkpoints in a `bytea` column; written by the server for multiplayer, uploaded by the client for solo and marked unverified | F1, N2     | Re-simulating a stored replay reproduces every per-lap state hash                              | Not started |
| D2  | Results schema in PostgreSQL: players, races, participants, laps, sector times, leaderboards; the server writes through an async writer task                                                                                                | G4, D1     | The tick loop never waits for the database; solo laps never appear on the verified leaderboard | Not started |
| D3  | Lap telemetry in PostgreSQL: one row per car per lap with compressed channel arrays (speed, throttle, brake, steer, gear, RPM)                                                                                                              | D1, D2, T1 | Querying any stored lap returns its channels; a full 22-car race stays under its size budget   | Not started |

## Security and operations (V1)

| ID  | Task                                                                                                                            | Needs | Done when                                                            | Status      |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------- | ----------- |
| O1  | Minimal observability: structured logs, per-room tick time and overruns, RTT and loss per player, exposed on a metrics endpoint | N2    | A room that overruns its tick budget logs a warning with the room id | Not started |

## Later (V2: when one server is not enough)

| ID  | Task                                                                                                                                                                      | Needs      | Done when                                                                                 | Status      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- | ----------- |
| N11 | Fleet: matchmaker / room allocator, Redis for room code → server, server heartbeats, draining, autoscaling per region                                                     | N13        | Killing a server never ends a running race on another; draining servers take no new rooms | Not started |
| N7  | Multi-region deployment + load test                                                                                                                                       | N11        | Measured rooms per CPU core and bandwidth per room                                        | Not started |
| N12 | TCP fallback transport (WebSocket) when UDP/QUIC is blocked                                                                                                               | N2         | With UDP blocked, a client still races with higher latency                                | Not started |
| N6  | Solo-lap verification: re-simulate submitted solo replays before they reach the leaderboard                                                                               | D1, G4, P7 | Tampered solo lap times are rejected                                                      | Not started |
| D4  | Physics version archive: every released physics build (native + WASM) kept runnable by hash                                                                               | D1         | A replay recorded on an older physics version still reproduces its hashes                 | Not started |
| D5  | Move replays and telemetry from PostgreSQL to object storage: Parquet files, on-demand telemetry by re-simulation, DuckDB queries, Redis Streams for race-finished events | D3, N11    | Postgres holds only results; any stored lap's telemetry is still queryable                | Not started |
| S1  | Statistical cheat detection from replays: reaction times, inhuman consistency, bot-like input patterns                                                                    | D1, A2     | AI-driven replays submitted as human are flagged; human replays are not                   | Not started |
| O2  | Full observability: Prometheus, Grafana, alerting across the fleet                                                                                                        | O1, N11    | A room that overruns its tick budget on any server raises an alert                        | Not started |
