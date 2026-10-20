# CI test selection

A PR that changes only `crates/tyre/src/lib.rs` runs **Tyre unit tests**,
**Integration tests**, and **Quality checks**. It does not start the aero,
powertrain, or chassis unit workflows. Each crate has a separate workflow in
`.github/workflows/unit-<crate>.yml`, so its results have their own entry in GitHub.

## What runs on every PR

`ci.yml` runs two independent jobs: native/WebAssembly integration tests and all
Playwright browser tests. Neither waits for quality checks or a crate unit job.
Both also run on every push to `master`, including documentation changes.
Unimplemented networking, audio, and rendering features remain visible as test
failures; there are no implementation-existence conditions or ignored failures.

The native integration suite covers generated contracts, the WASM World API,
native/WASM replay comparisons, chassis replay, telemetry, the asset pipeline,
car and track data, lobby, and server behavior. Browser tests include F0/F1,
chassis, HUD, telemetry, workers, and the future browser features.

`quality.yml` separately runs the existing formatting, lint, type, dependency,
and duplication gates. A failure there cannot prevent integration tests running.

## What starts a unit workflow

Each Rust workflow watches its crate, its transitive local Rust dependencies,
its own test files, and the shared configuration used by its runner. For example:

| Change                                                | Rust unit workflows                              |
| ----------------------------------------------------- | ------------------------------------------------ |
| Tyre source or tyre specifications                    | Tyre                                             |
| Aero source                                           | Aero                                             |
| Chassis source                                        | Chassis, chassis-replay, physics-wasm            |
| Contracts source                                      | Contracts and every crate depending on contracts |
| `Cargo.toml`, `Cargo.lock`, or the Rust toolchain pin | All crates                                       |
| Documentation only                                    | None                                             |

A shared lockfile can change dependencies used by several crates, so it deliberately
runs all crate tests. Relevant Node pins, test helpers, and Vitest configuration
also trigger the component suites that use them. The same filters apply on PRs
and pushes to `master`. `workflow_dispatch` allows an explicit manual run.

Additional unit workflows cover HUD, input, livery, foundation checks, and the
quality tooling's mutation probes. The existing full-workspace/build assertion
lives in `tests/f0/workspace.test.ts`; it runs for shared workspace configuration
changes, rather than being repeated by every integration run.

## Test files and shared setup

The chassis Rust/portability checks moved to `tests/p1/unit.test.ts`. Its cross-build
checks remain in `tests/p1/chassis.test.ts`. The pure livery-function checks moved
to `tests/c1/livery.test.ts`, while asset checks remain in `tests/c1/car.test.ts`.
These moves preserve the original assertion blocks. Only CI-structure assertions
were rewritten to describe the new workflows and verify their path selection.

`vitest.unit.config.ts` omits the World/WASM global setup. Pure tyre, aero,
powertrain, HUD, and livery checks therefore do not build the entire simulation.
`vitest.integration.config.ts` keeps that setup for cross-component checks.
The original Vitest and Playwright configurations remain unchanged.

The unit workflows call `_unit.yml`, which tests one Cargo package at a time.
Both unit and integration jobs use `.github/actions/setup` for pinned dependencies
and cached Rust builds/tools. Pure Rust jobs do not install Node, Chrome, or
wasm-bindgen. Browser jobs install Chrome; only jobs needing bindings install
wasm-bindgen. Outdated runs on the same PR are cancelled.

## Local commands and maintenance

- `pnpm run test:unit tests/p2` runs the tyre component specifications.
- `cargo test --locked --package tyre --all-targets -- --include-ignored` runs
  native tyre tests, including any future inline Rust unit tests.
- `pnpm run test:integration` runs the complete native integration suite.
- `pnpm run test:e2e` runs every browser integration test.
- `pnpm run verify` remains the full local verification command.

Pass test filters directly after the script name; do not insert a separate `--`
with this pinned pnpm version. The scripts already invoke their test runners.

When adding a crate, add its unit workflow with paths for that crate and its local
dependencies. The F0 CI tests check that every Cargo package has a workflow and
that every native test file belongs to exactly one unit or integration suite.

Path-filtered workflows are conditional checks. If branch protection is introduced,
use the always-on integration and quality checks as required checks; requiring an
absent path-filtered workflow can leave a PR pending. See the
[GitHub workflow-filter documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore).
