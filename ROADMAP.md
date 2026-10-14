# Browser Formula-style racing game: engineering roadmap

Status: proposed plan, 12 October 2026. No game implementation or device benchmarks exist yet. Every performance number below is a starting target, not a measured result.

## Product agreement

Build a link-accessible racing game that runs vehicle physics, opponents, race logic, audio and rendering on the player's laptop. Single-player must work without a gameplay server. Multiplayer infrastructure distributes messages and manages rooms; it does not calculate vehicle physics or render frames.

One simulation serves several graphics presets. A player with simpler graphics gets the same tyre forces, collision surfaces, car specifications and race rules as a player with detailed graphics. Rendering at 30 FPS must not make the simulation advance more slowly than rendering at 60 FPS.

Aim for broad laptop support, including Apple silicon MacBook Air and Pro, Intel MacBooks and Windows laptops with integrated graphics. Establish the oldest supported browser/OS/device combinations through testing. Brand names alone cannot establish a performance tier, and supporting every historical laptop is not a promise we can verify in advance.

An integrated GPU is still a GPU: the M1 MacBook Air, for example, includes one. Hardware with disabled or unavailable accelerated graphics is a separate case; software rendering cannot be assumed to sustain this game. See [Apple's M1 Air specifications](https://support.apple.com/en-us/111883).

The high preset aims for the supplied visual references. It does not promise exact commercial-game parity on every MacBook Pro. Physics accuracy means measured, repeatable behaviour against documented targets, not an unsupported claim to reproduce a proprietary vehicle model.

## Starting architecture

| Responsibility | Starting choice | Boundary |
|---|---|---|
| Browser application | TypeScript and Vite | Loads the application and connects the systems |
| Renderer | Babylon.js | Draws simulation state; does not own vehicle rules |
| Graphics interfaces | WebGL 2 compatibility path; WebGPU where supported and beneficial | Choose from capability checks and benchmarks |
| Collision and rigid-body dynamics | Rapier WASM | Resolves bodies, forces and contacts |
| Vehicle model | Custom TypeScript module initially | Calculates suspension, tyres, drivetrain and aero |
| Simulation execution | Dedicated browser worker | Owns fixed-step simulation and publishes snapshots |
| UI | Small web UI; add React only if useful | Sends player actions and displays state |
| Asset production | Blender, glTF/GLB, compressed textures | Produces visual assets separately from collision data |
| Multiplayer relay | Small WebSocket room service initially | Routes messages and manages membership; no vehicle simulation |
| Shared multiplayer physics | A designated host browser | Owns accepted world state for contact-enabled races |

Babylon documents WebGPU/WebGL support and game systems in its [specifications](https://www.babylonjs.com/specifications/). Rapier needs a custom integration with Babylon; it is not assumed to be Babylon's built-in physics plugin.

Keep these interfaces small: input commands, simulation configuration, complete simulation state, render snapshots and network messages. Version configuration, track collision data and physics code together. A room must reject incompatible versions.

```text
Keyboard / gamepad / UI
          |
          v
Browser simulation worker -----> render snapshots -----> Babylon renderer
          |
          +-----> measured telemetry / replay records
          |
          +-----> network adapter <----> message relay <----> other browsers
```

For solo play the local worker owns the world. For contact-enabled multiplayer the designated host browser owns the accepted world; other browsers predict their own motion and correct to host snapshots. The host sends snapshots through the relay. Rendering stays local on every laptop.

## How to execute the roadmap

Complete numbered milestones in order. Each milestone ends with a small playable build or inspectable result and a recorded check. Repair failures before building features that depend on them. Do not add the next feature merely because the current demo looks plausible.

Maintain a short evidence record per milestone: configuration/version, machine and browser, scenario, result, limitations and follow-up. Physics changes require replaying the affected handling scenarios. Graphics changes require measuring frame time, memory and visible quality.

### Part A: make a reliable browser foundation

We first need evidence that we can load, measure and advance a simulation consistently. Without this, later handling problems could come from timing bugs rather than the tyre model.

#### 1. Establish compatibility and a provisional device matrix

Create a capability-check page for WebGL 2, WebGPU, WASM and workers. Test available Mac and Windows machines, recording model/year/chip, RAM, browser, OS, screen size and power state. Use capability checks rather than a manufacturer-based preset.

**Done when:** supported machines open the page, unavailable features produce understandable messages, and the initial compatibility matrix names real tested configurations. Devices we have not tested remain marked unverified.

#### 2. Show a measured scene

Draw a flat ground plane, a placeholder car and one camera. Add a development overlay for frame times, simulation times, drawing workload and available memory measures. Keep menus minimal. Include a repeatable benchmark route rather than measuring an idle car alone.

**Done when:** the scene runs through the compatibility path and can export a small benchmark report. Distinguish main-thread CPU timing from GPU timing; use GPU measurements only where the browser exposes them.

#### 3. Separate simulation time from display time

Advance the simulation in fixed increments. Start by evaluating 120 Hz, with a controlled catch-up limit and smooth visual blending between completed states. Timestamp input by simulation tick. Handle hidden tabs, long pauses and resumed play explicitly.

**Done when:** the same recorded inputs give equivalent simulated results within an agreed numerical tolerance at 30, 60 and higher rendering rates. After a long pause, the app does not attempt an unbounded backlog or silently slow a connected race.

#### 4. Establish the worker boundary

Move simulation ownership to a browser worker and exchange small, timestamped state buffers. Start with transferable buffers rather than requiring shared memory. Test message overhead and input age. Consider shared memory later only if profiling warrants its deployment requirements.

**Done when:** input reaches the intended simulation ticks, rendering remains responsive, and messages do not create a growing queue or continuous large allocations. Worker ownership is explicit; the renderer cannot mutate simulation bodies.

### Part B: make one car respond to physical causes

Use plain geometry throughout this part. The first car model should consist of a moving chassis and four wheel-contact/suspension models; we do not need a decorative 3D model of every suspension component.

#### 5. Put the car on the ground

Create a dynamic chassis with specified mass, centre of mass and rotational inertia. Add four contact probes with basic spring/damper support, gravity and a debug view. Validate contact over more than a single sample point if kerbs expose weaknesses in the initial probing method.

**Done when:** the car settles, remains stable at rest and loses support correctly when a wheel leaves the ground. A drop test records believable suspension motion without energy growing on its own.

#### 6. Accelerate through the wheels

Add wheel rotation, driven wheels, engine torque, gearing, a simple differential model and rolling/air resistance. The first delivery may use one gear; add the gearbox only after straight-line force balance behaves correctly. Acceleration must come from wheel forces rather than directly overwriting position.

**Done when:** an automated straight-line run records speed, engine/wheel speed and acceleration, and behaves sensibly across starting speeds and throttle levels. Excess wheel torque can create wheelspin once the tyre-force limit exists.

#### 7. Brake and lock wheels

Add braking torque and front/rear brake balance. Distinguish a rolling tyre from a sliding tyre. Automatic anti-lock assistance, if offered, must be an explicit assist rather than an accidental property of the model.

**Done when:** braking tests from several speeds produce repeatable stopping distances, and excessive braking can cause locking with the expected loss of control. Near-zero-speed behaviour remains stable.

#### 8. Turn using tyre forces

Measure the difference between the wheel's pointing direction and its movement direction. This is slip angle. Use a tunable force curve so lateral grip rises, reaches a limit and then changes during sliding. Support controlled understeer and oversteer through physical parameters.

**Done when:** the car can complete a steady circle, increasing speed eventually exceeds available grip, and reducing speed lets it recover. The turning radius cannot remain physically unlimited at every speed.

#### 9. Combine braking, acceleration and turning

Give each tyre a shared grip budget. A tyre already producing strong braking force has less capacity for turning; a heavily loaded drive tyre can spin during corner exit. Add sensible load sensitivity instead of assuming every extra unit of load produces the same proportional grip increase.

**Done when:** matched corner-entry and exit tests distinguish coasting, braking and accelerating. The car cannot produce maximum braking and maximum lateral grip simultaneously.

#### 10. Refine suspension and load transfer

Add steering geometry where useful, suspension travel limits, damping and anti-roll behaviour. Let braking, acceleration and cornering change wheel loads through a consistent chassis/suspension model. Avoid counting load transfer twice through both the body solver and a separate force adjustment.

**Done when:** front/rear and left/right loads change in the expected direction, suspension travel is bounded, and a kerb test does not launch the car because of an unstable solver.

#### 11. Add aerodynamic forces

Add speed-dependent drag and front/rear downforce, then bounded ride-height sensitivity. Use documented curves and parameters, not an expensive airflow simulation. Aero balance should change handling rather than simply raising a global speed limit.

**Done when:** high-speed cornering and straight-line tests show the consequences of changing wing settings; forces remain stable at low speeds and when travelling backwards.

#### 12. Give the track physical properties

Introduce asphalt, kerb, grass and gravel, plus a small bump, slope and barrier. Surface data describes grip and resistance; collision geometry describes where the car can touch the world. Add high-speed movement checks to prevent passing through thin barriers.

**Done when:** driving onto another surface changes handling predictably, high-speed barrier tests do not miss contact, and detailed versus simple visual road meshes leave collision results unchanged.

### Part C: make tyres create strategy

The tyre display must report conditions that actually affect forces. This part produces the first meaningful stint, before we add a pit crew or a beautiful circuit.

#### 13. Add per-tyre temperature

Begin with a measured or explicitly approximate thermal model, then separate surface and bulk temperature only if needed. Calculate heating from slip/work and cooling to air/track. Change grip through a defined temperature curve.

**Done when:** a cold start, gentle stint and aggressive sliding stint produce different temperature histories and corresponding measured handling. Tests cover unreasonable values and numerical stability.

#### 14. Add wear from use

Track wear from a documented combination of slip/work, load and temperature. Make wear affect tyre response. Delay detailed puncture, graining and blistering models until evidence justifies them.

**Done when:** aggressive versus gentle driving under controlled conditions creates different wear, worn tyres change braking/cornering behaviour, and wear does not depend on rendering FPS.

#### 15. Introduce soft, medium and hard compounds

Define compound-specific grip, useful temperature range and degradation parameters. These are calibrated model choices, not universal real-world constants. Give users a simple compound selector and four-wheel condition display.

**Done when:** controlled stints show meaningful tradeoffs; no compound wins every tested situation by construction. Replacing tyres resets appropriate tyre state without repairing unrelated vehicle state.

#### 16. Calibrate the complete car

Create repeatable acceleration, braking, constant-radius, corner-entry, kerb and stint scenarios. Store input replays and telemetry. Document target values, their source, acceptable tolerance and any unverified assumptions. Compare available reference handling without claiming access to proprietary physics.

**Done when:** the suite checks more than lap time, explains remaining deviations and survives changes in graphics FPS. Test deterministic reproduction separately from approximate equivalence. Rapier's deterministic WASM core does not automatically make custom JavaScript calculations deterministic across machines; see [Rapier's conditions](https://rapier.rs/docs/user_guides/javascript/determinism/).

**Release checkpoint:** one simple track, one tunable car, working compounds, observable temperature/wear and replayable handling tests. This is the first substantial physics prototype.

### Part D: prove scale and browser-only multiplayer early

Do this before investing in a polished full circuit. Shared collisions and low-end CPU capacity can change the architecture.

#### 17. Measure multiple cars and representative graphics

Increase identical simulated cars gradually: 1, 2, 4, 8, then toward the intended full grid. Add a short representative visual section with cockpit detail, a mirror and shadows. Include contact-heavy starts, not only isolated cars. Establish which costs come from simulation, drawing, memory or communication.

**Done when:** actual reports identify a safe initial grid size and graphics budgets on tested machines. A weak CPU failure does not get misdiagnosed as a resolution problem. Start with small shared room limits; do not change a participant's car physics or hide competitors to compensate.

#### 18. Open a room through a link

Implement a small relay with room identifiers, membership, version checks and message routing. Add simulation tick numbers, sender identifiers and sequence numbers to messages. Keep input commands separate from state snapshots. Introduce a versioned full-state format for later correction, including tyres and wheel states.

**Done when:** two browsers join the same room, reject incompatible simulation/track versions and exchange timestamped messages. The relay performs no vehicle simulation.

#### 19. Drive together without shared contact

Each browser owns its local car and publishes state snapshots. Display remote cars using buffered updates and bounded estimates. Keep car-to-car collisions disabled in this milestone while preserving local track collisions.

**Done when:** two players drive together, remote motion remains understandable under controlled latency, and stale updates cannot overwrite newer state. Label this a multiplayer driving prototype, not a finished competitive race.

#### 20. Establish host-browser authority

Choose one browser to own the accepted world. It simulates all cars from ticked input commands and publishes accepted snapshots. Non-host clients render remote accepted state and may predict their local vehicle. Test host CPU capacity against the supported room size.

**Done when:** participants accept the same world version, clock and race configuration, and the relay continues to route rather than calculate physics. A client cannot independently decide its own accepted pit state or contact outcome.

#### 21. Correct predictions without abrupt movement

When host state arrives, restore full relevant simulation state and replay unacknowledged local inputs. Smooth visual corrections separately from the actual simulation. Include tyre temperature/wear, wheel rotation and other force-affecting state; position alone is not enough.

**Done when:** acceleration, braking and tyre condition converge to the accepted state under injected delays. Record input-to-display delay and correction magnitude. Do not require every browser to reproduce all floating-point calculations perfectly.

#### 22. Enable shared collisions

The host decides accepted contacts. Clients may predict contact for responsiveness but must reconcile to the host. Test side contact, rear contact, high-speed contact and a pile-up. Evaluate several delay and loss profiles, not just a same-machine test.

**Done when:** browsers converge on the same post-contact state and corrections stay within a documented playability threshold. If they do not, fix the contact/network model before enlarging rooms.

#### 23. Handle disconnects and interrupted browsers

Handle a normal player leaving, input timeouts, a suspended background tab and the host leaving. Initially end the race cleanly when host authority disappears; add host migration as a separate later feature with full snapshots.

**Done when:** no car continues indefinitely from stale throttle input, every player gets consistent session status, and losing the host cannot leave multiple browsers claiming authority.

**Architecture limitation:** this supports casual racing with all physics in browsers. The host can cheat or become overloaded, and network distance still affects responsiveness. A relay alone cannot verify physical truth. Ranked competition would require a new authority decision; do not promise strong cheat resistance under this design.

### Part E: turn driving into a race

We now add rules on top of working physics. Timing, pit stops and opponents must consume the same simulation state rather than invent a second version of vehicle behaviour.

#### 24. Count valid laps

Add ordered checkpoints, sectors, start/finish crossing, timing and minimal track-limit rules. In multiplayer, host authority owns accepted timing and progress.

**Done when:** skipping checkpoints, reversing across the finish line and respawning cannot create valid extra laps. Timing depends on simulation time, not displayed frames.

#### 25. Make a functional pit stop

Add pit entry/exit, speed limit, a service zone, compound request and timed tyre replacement. First deliver an automated service without crew animation. Keep UI requests separate from accepted service events.

**Done when:** a driver must enter and stop correctly, service takes defined time, new tyre state changes subsequent handling, and all multiplayer clients agree on the event. Use simulation ticks for service timing.

#### 26. Add one fair opponent

Create an opponent that follows a reference line and chooses throttle, brake and steering from upcoming curvature and grip. Give it the same physical car and tyre model. First prove safe solo driving; then add avoidance and one pit decision.

**Done when:** the opponent completes a race without teleporting, notices another car, and slows or changes behaviour when tyre grip falls. It cannot receive hidden extra grip to conceal planning defects.

#### 27. Complete a short race with strategy

Add a start procedure, finish order, results, restart and a small field of opponents or players. Set race length and pit losses so tyre choices can affect outcomes. If using accelerated wear for shorter races, make it an explicit shared mode.

**Done when:** players can start and finish a whole race, compare documented strategies and see why a stop did or did not pay off. Results come from accepted race state.

### Part F: make graphics scale and loading stay small

Keep the collision world and vehicle rules fixed. Scale the cost of drawing them and the visual assets we download.

#### 28. Establish the asset pipeline

Replace placeholders with one original car and a small original circuit. Export high and low model detail and texture sizes from common sources. Keep collision data independent of display geometry. Validate material count, texture memory and file size during asset import.

**Done when:** the same replay produces the same physical trajectory with both visual asset sets; low settings do not download all high-resolution textures first.

#### 29. Build convincing surfaces and lighting incrementally

Start with daylight, asphalt, paint, rubber and carbon-fibre materials. Add shadows, then reflections/mirrors, measuring each feature. Revisit the demanding night benchmark with prepared environmental lighting and controlled real-time lights. Retain tyre smoke, sound and visibility cues that help driving even at simple settings.

**Done when:** each effect has a measured cost and side-by-side visual evidence. The team can explain which changes get us closer to the reference images and which exceed the target device budget.

#### 30. Offer manual graphics presets

Implement Lightweight, Balanced, High and Ultra presets. Change internal rendering resolution, texture/model detail, scenery density, shadow quality, mirror resolution/update frequency and optional effects. Keep the interface readable independently of 3D resolution.

**Done when:** presets materially lower measured work and memory while preserving physical results and visibility of every opponent and gameplay obstacle. Settings work in both supported graphics paths.

#### 31. Choose and adjust quality automatically

Run a short representative startup benchmark, begin conservatively and select a preset from measured capability. During play, monitor a sustained time window and lower inexpensive-to-change visual settings when necessary. Upgrade slowly with headroom and a cooldown, so quality does not flicker. Allow a manual override and a battery-friendly frame cap.

**Done when:** a sustained slowdown triggers stable adjustment, a brief spike does not cause repeated preset switching, and physics remains unchanged. Change large texture/asset packs at safe boundaries rather than introducing a mid-corner download/upload stall.

#### 32. Optimise first play and repeat visits

Split the application and asset packs. Fetch the selected race's collision data and appropriate visual pack; decode asynchronously where supported, stagger GPU uploads and prepare required rendering effects before the start. Add versioned caching, visible progress and recoverable failure states. Publish small test builds to staging for real network measurements.

**Done when:** cold-cache and warm-cache reports measure click-to-drivable time under a declared network profile. The car cannot race into unloaded collision geometry. Cache upgrades cannot mix incompatible physics and track data.

### Part G: prove support, then expand

#### 33. Run the laptop and browser acceptance matrix

Test available Apple silicon Air, Apple silicon Pro, Intel MacBook and integrated-GPU Windows configurations. Cover supported Safari, Chrome/Edge and Firefox versions, power-saving conditions, high-resolution displays and long sessions. Record missing devices as untested rather than assumed supported.

**Done when:** each supported configuration has an evidence-backed preset and frame cap, and failures have fixes or a clearly defined support limitation. Repeat handling checks after performance optimisations.

#### 34. Polish the first public release

Finish keyboard and gamepad controls, camera adjustment, engine/tyre sound, clear tyre/pit information, loading failures and reconnect UI. Use visual assets and branding we own or have permission to use. Verify basic usability with people who have not followed development.

**Done when:** someone can open a link, learn the controls and complete a race without development instructions. Long sessions do not accumulate memory or networking queues. Publish only after release checks and the normal deployment authorisation.

#### 35. Add advanced systems one at a time

Choose the next feature based on evidence and playtesting. Candidates include fuel mass, the chosen era's energy/aero rules, weather and wet tyres, dirty air/slipstream, damage, richer pit strategy, qualifying and additional circuits. Each is its own follow-on milestone with independent handling and performance checks.

**Done when:** the selected addition changes observable racing behaviour, has defined assumptions and fits existing budgets. Do not bundle weather, damage and career mode into one implementation task.

## Provisional performance and quality policy

| Setting | Starting visual policy | Display goal |
|---|---|---|
| Lightweight | Simple scenery, smaller textures, cheap lighting, low-resolution mirrors | Try 60 FPS; offer a stable 30 FPS mode if needed |
| Balanced | Moderate model/texture detail, limited dynamic shadows, controlled mirrors | 60 FPS where verified |
| High | Detailed cockpit and nearby cars, stronger shadows/reflections | 60 FPS where verified |
| Ultra | Highest validated assets and effects | 60 FPS where verified; optional higher FPS only with headroom |

Do not assign these from laptop brand. Example benchmark resolutions are approximately 540p/720p at the low end and 900p/1080p higher up, adjusted for aspect ratio. These are candidates, not device performance claims. A Retina display does not force native-resolution 3D rendering.

Provisional measurement targets:

- 60 FPS mode: steady frame delivery near 16.7 ms; inspect p95/p99 frame times and counts of stalls over 50 ms, not average FPS alone. Aim for headroom rather than consuming the whole budget.
- 30 FPS compatibility mode: steady frame delivery near 33.3 ms while keeping the same physics update configuration.
- Simulation: evaluate 120 Hz initially. Its 8.33 ms interval is a deadline, not the desired compute cost; aim substantially below it. Increase/substep only where accuracy requires it. Do not lower the rate independently on one slow multiplayer client.
- If the lowest supported CPU cannot sustain the agreed simulation, optimise the model/solver and communication or reduce the shared session size. Resolution changes solve drawing cost, not every CPU bottleneck.
- Loading: target a small initial playable pack, initially investigate 10–20 MB, and measure under a declared network speed. Rich final circuit packs may need more; this is a budget hypothesis.
- Memory: record decoded asset memory and rendering targets as well as download bytes. Set per-tier budgets from real devices. Avoid a universal guessed browser memory limit.
- Soak tests: run at least 30-minute races, including repeated joins/restarts, to expose heat, battery and memory effects that a brief benchmark misses.

## What happens next

The next implementation scope is milestones 1 and 2 only: a capability check and a measured flat scene. It contains a placeholder car, one camera and a repeatable measurement route. Then build the clock and worker boundary before implementing vehicle behaviour.

All later milestones remain planned, not completed. Do not interpret this roadmap or the cited engine capabilities as proof that the intended visual quality runs on any specific laptop.
