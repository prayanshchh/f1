# What the browser foundation must prove

Status: tests first, 13 October 2026. The four foundation tasks have no implementation yet. Node contract tests deliberately fail until the corresponding modules exist. No laptop has been benchmarked and no browser test below has passed.

## What we are building

The foundation is the program that runs around the future vehicle model: checks the browser, accepts input, advances simulated time, sends positions to the renderer and measures the work. It does not establish realistic tyres, graphics parity or multiplayer correctness by itself.

The roadmap lists four tasks. This file adds their tests; it does not invent a fifth product task.

Run the executable contract tests with `npm test`. They use Node's built-in test runner, need Node 20 or newer, and require no dependency installation. There are 23 proposed behavioural tests. Run `node --test tests/platform.test.mjs` separately to check the local test environment's buffer-transfer behaviour. That check is not evidence about a real browser worker.

The contract tests import four future modules from `src/foundation/*.mjs`. These names define initial test boundaries, not a requirement to write the entire product in JavaScript. TypeScript or a WASM implementation can later sit behind these boundaries; update the test adapters deliberately when the build system exists.

## Task 1: know whether the browser can start

**Why:** a browser may lack a required interface or fail to obtain a graphics device. A blank page gives us no diagnosis and gives the player no next step.

**Done looks like:** a capability page distinguishes available, unavailable and failed probes; absence of WebGPU still allows our WebGL 2 path; missing requirements have readable explanations. A real test record names its actual machine/browser configuration. Unavailable model, RAM and power information stays unknown unless the tester supplies it.

**Automated checks (six):** WebGL fallback, independent probe failure, missing graphics, missing WASM, missing worker and no invented device details.

**Contract:** `detectCapabilities(probes)` returns `{ canStart, features, blockers, device }`. Each feature has `{ available, reason }`. Blockers have `{ feature, message }`. The prototypes require WASM and workers, and at least one successfully supported graphics path. `device.model`, `ramGiB` and `powerState` default to null. Tests inject probe results; they do not prove that real adapters or WASM binaries work.

**Browser checks:** actually obtain a WebGL 2 context and, where available, a WebGPU adapter/device; execute a tiny WASM calculation; start a worker and receive an acknowledgement. A browser that exposes an API name but cannot use it must not show that feature as usable. Verify WebGPU startup failure can fall back where the compatibility renderer works.

**Future consumers:** renderer selection, startup/error screen, device-support records and later graphics calibration. Feature availability alone cannot choose a quality preset.

## Task 2: draw something moving and measure it honestly

**Why:** if a future game stutters, we need to tell whether the cost is in drawing, simulation or preparation. The scene gives us a reproducible baseline.

**Done looks like:** a ground plane, placeholder car and camera follow a named repeatable route. The overlay distinguishes display intervals, main-thread work, simulation work, draw calls and actual GPU measurements where supported. Exported JSON records the route, duration, resolution, renderer and build. Unavailable readings are null, never fictional zeroes.

**Automated checks (five):** preserve slow-frame evidence, separate measurement scopes, represent unavailable metrics honestly, reject an empty run and preserve benchmark metadata on export.

**Contract:** `buildBenchmarkReport({ samples, gpuTimingAvailable, memoryBytes, metadata })`. Samples contain `frameMs`, `mainThreadMs`, `simulationMs`, `gpuMs` and `drawCalls`. The result summarises each scope separately and uses nearest-rank p95/p99 percentiles. `stallsOver50Ms` counts display intervals strictly greater than 50 ms. CPU values do not add up to GPU time; scopes can overlap. Worker simulation time must be labelled as worker work, not time spent by the main thread.

**Browser checks:** run the exact route twice, export and inspect the report, repeat with different resolution and confirm metadata changes. An injected known pause must appear in slow-frame statistics. GPU timing unavailable/disjoint results must remain unavailable. Inspect the visual output; a report alone does not prove the car and track rendered correctly.

**Future consumers:** graphics presets, physics cost comparisons, loading optimisation and device testing. The scene does not yet need a realistic moving car; it is a diagnostic workload.

## Task 3: give simulation its own clock

**Why:** a machine that displays fewer pictures must not simulate less racing time. If physics advances once per picture, rendering quality can affect handling and race outcomes.

**Done looks like:** physics advances in fixed 1/120-second increments initially, input uses numbered ticks, and rendering blends adjacent states. Different display schedules yield equivalent simulation results. Solo interruption pauses or explicitly discards excessive wall-clock backlog; a connected interruption requires recovery rather than silently discarding race time.

**Automated checks (seven):** identical ticked input at 30/60/144 FPS, fixed duration/consecutive ticks, bounded interpolation, bounded solo catch-up, explicit connected recovery, pause/resume and invalid elapsed time.

**Contract:** `createFixedStepClock({ hz, maxStepsPerAdvance, maxFrameDeltaSeconds, mode, onStep })` exposes `advance(deltaSeconds)`, `pause()` and `resume()`. Ticks begin at 1; the callback receives `(tick, dt)`. `advance` returns `{ steps, tick, alpha, discardedSeconds, requiresResync }`. `alpha` is the fraction between previous/current states. Solo catch-up drops full excess steps explicitly while retaining only a fractional remainder. Connected overflow enters recovery and does not pretend the lost wall time was simulated. The later session layer decides pause, disconnect or restore from accepted state.

**Test scenario:** move a simple point at 10 metres/second for the first 600 ticks and 5 metres/second for the next 600. At all tested rendering schedules it finishes after 1,200 ticks at 75 metres, within 1e-9 metres. This proves scheduling for a toy model, not vehicle-physics accuracy or cross-machine floating-point determinism.

**Browser checks:** use actual 30/60/higher display caps and compare ticked replay results; hide the tab and return; verify fresh input cannot remain pressed forever after focus loss. Test late input according to the documented tick policy. A stalled worker must not leave connected play pretending it is up to date.

**Future consumers:** tyres, suspension, lap timing, pit-service durations, replays and multiplayer input/state timestamps. A physics library's own integrator remains separate from this scheduling check.

## Task 4: give simulation sole ownership in a worker

**Why:** long simulation work on the page's main thread can block input and display. Moving it away helps only if messages remain small and controlled.

**Done looks like:** one worker owns live simulation state. The renderer receives separate snapshots and cannot mutate that live state. Input specifies the intended tick. Only a bounded number of snapshot buffers can be in flight; the worker can continue while a slow renderer skips intermediate pictures. Logs expose message latency, input age, missed intended ticks and buffer allocation counts.

**Automated checks (five):** discard stale display snapshots, bounded buffer allocation under a slow consumer, reuse transferred buffers, reject double returns and validate ticked controls.

**Contracts:** `createSnapshotInbox()` exposes `accept(snapshot)` and `latest`. Snapshots have `{ tick, timeSeconds, buffer }`; only increasing ticks are accepted. `createSnapshotPool({ capacity, floatCount })` exposes `acquire()`, `release({ id, buffer })` and `stats.allocated`; a full pool returns null instead of allocating more. `validateInput(command, { currentTick, maxLeadTicks })` checks future integer ticks, finite throttle/brake in [0,1] and steering in [-1,1], returning `{ ok, reason }`. Validation is not proof of actual input application.

**Browser checks:** a real worker applies input on the stated tick and reports its actual applied tick. Transfer snapshots out and back; verify sender detachment. Modify the received display snapshot and confirm the worker's live state is unaffected. Delay acknowledgements deliberately: allocated buffers must stay within the configured pool and sending must not form an unbounded queue. Send a long sequence, measuring allocation and latency. Input messages also need a bounded/coalesced policy that preserves required press/release events. Worker crashes need an explicit error/restart state.

**Future consumers:** the WASM vehicle model, larger car grids, graphics independence, multiplayer snapshot transport and replays. Future renderer code works from snapshots; it never calls setters on live simulation bodies.

## Real browser and device evidence checklist

These checks are pending until we have a runnable page. Add browser automation when the application has real controls/outputs to target; do not write tests against a guessed DOM today.

| Check | Record | Current status |
|---|---|---|
| Startup and real feature probes | Browser/version, successful adapter/context/WASM/worker result | Not run |
| Flat moving scene | Visual inspection and exported benchmark | Not run |
| Render-rate independence | Replay, physics config, ticks and final state | Not run |
| Hidden-tab recovery | Solo/connected policy and observed resumption | Not run |
| Worker transfer/ownership | Tick acknowledgement, mutation check, buffer counts | Not run |
| Slow consumer/input | Delay profile, queue bound, input age and missed ticks | Not run |
| Apple silicon Air | Exact chip, RAM, OS, browser, power state and report | Untested |
| Apple silicon Pro | Exact chip, RAM, OS, browser, power state and report | Untested |
| Intel MacBook | Exact model/year, RAM, OS, browser and report | Untested |
| Integrated-GPU Windows laptop | Exact CPU/GPU, RAM, OS, browser and report | Untested |

Prefer availability over guessing: browser memory APIs may measure only part of the application's memory, browser APIs do not reliably expose an exact laptop model, and power state may require a tester entry. A simulated low capability result validates fallback logic; it is not a benchmark on low-end hardware.

## Release gate for Part A

All 23 behavioural contract tests must pass once implemented, then real browser checks must pass on the actual machines we claim to support. Missing hardware remains explicitly unverified. The gate establishes reliable startup, timing, measurements and ownership; it does not certify realistic car physics, final graphics performance or finished networking.

Build task 1 first, task 2 next, and establish task 3 before replacing it with the task 4 worker-owned version. Repeat the clock tests after moving execution into the worker. Do not build tyres, pit stops or a full circuit in this implementation slice.
