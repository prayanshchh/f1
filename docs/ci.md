# CI test selection

A PR that changes only `crates/tyre/src/lib.rs` runs **Tyre unit tests**,
**Integration tests**, and **Quality checks**. The aero,
powertrain, and chassis test jobs appear as **Skipped**. Each crate has a separate
workflow in
`.github/workflows/unit-<crate>.yml`, so its results have their own entry in GitHub.

## What runs on every PR

`ci.yml` runs two independent jobs: native/WebAssembly integration tests and
Playwright browser tests, excluding the deferred N1/N2 networking suites. Neither waits for quality checks or a crate unit job.
Both also run on every push to `main`, including documentation changes.
G1 input, G3 audio, and R1 rendering remain enabled. Their unfinished behavior
remains visible as failures; there are no implementation-existence conditions
or ignored failures.

The native integration suite covers generated contracts, the WASM World API,
native/WASM replay comparisons, chassis replay, telemetry, the asset pipeline,
car and track data. Browser tests include F0/F1,
chassis, HUD, telemetry, workers, and the future browser features.

`quality.yml` separately runs the existing formatting, lint, type, dependency,
and duplication gates. A failure there cannot prevent integration tests running.

## What selects a unit test job

Each workflow starts with a small changed-file check. An unaffected test job is
skipped before GitHub allocates its runner: no dependency installation, Rust
compilation, or tests. The file check itself needs a short-lived runner. GitHub
shows the test **job/check** as Skipped; the enclosing workflow can still show
success because its file check succeeded. Workflow-level path filters would
omit the check entirely, so they are deliberately not used.

Each Rust workflow watches its crate, its transitive local Rust dependencies,
its own test files, and the shared configuration used by its runner. For example:

| Change                                                | Rust unit tests selected                         |
| ----------------------------------------------------- | ------------------------------------------------ |
| Tyre source or tyre specifications                    | Tyre                                             |
| Aero source                                           | Aero                                             |
| Chassis source                                        | Chassis, chassis-replay, physics-wasm            |
| Contracts source                                      | Contracts and every crate depending on contracts |
| `Cargo.toml`, `Cargo.lock`, or the Rust toolchain pin | All crates                                       |
| Documentation only                                    | None                                             |

A shared lockfile can change dependencies used by several crates, so it deliberately
runs all crate tests. Relevant Node pins, test helpers, and Vitest configuration
also trigger the component suites that use them. PRs compare the branch against
its merge base, so all commits in the PR count.
Pushes compare the before/after commits. Renames and deleted files count as
changes too. There is no API changed-file limit. `workflow_dispatch` explicitly
runs the selected workflow regardless of changed files.

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

N1 lobby and N2 server tests remain in the repository and in the full local
test commands. CI explicitly excludes `tests/n1/**` and `tests/n2/**` from
native integration, and uses `playwright.ci.config.ts` to exclude their browser
suites. Re-enabling networking later requires removing both exclusions.

The unit workflows call `_unit.yml`, which tests one Cargo package at a time.
Both unit and integration jobs use `.github/actions/setup` for pinned dependencies
and cached Rust builds/tools. Pure Rust test jobs do not install Node, Chrome, or
wasm-bindgen. Browser jobs install Chrome; only jobs needing bindings install
wasm-bindgen. Outdated runs on the same PR are cancelled.

## Local commands and maintenance

- `pnpm run test:unit tests/p2` runs the tyre component specifications.
- `cargo test --locked --package tyre --all-targets -- --include-ignored` runs
  native tyre tests, including any future inline Rust unit tests.
- `pnpm run test:integration` runs the complete native integration suite, including N1/N2.
- `pnpm run test:integration --exclude 'tests/n1/**' --exclude 'tests/n2/**'` matches native CI.
- `pnpm run test:e2e` runs every browser integration test, including N1/N2.
- `pnpm run test:e2e --config playwright.ci.config.ts` matches browser CI.
- `pnpm run verify` remains the full local verification command.

Pass test filters directly after the script name; do not insert a separate `--`
with this pinned pnpm version. The scripts already invoke their test runners.

When adding a crate, add its unit workflow with paths for that crate and its local
dependencies. The F0 CI tests check that every Cargo package has a workflow and
that every native test file belongs to exactly one unit or integration suite.

Unrelated unit checks remain visible as Skipped and do not block merging.
The always-on integration and quality jobs still report their real result,
including failures for features whose tests exist before their implementation.

See [GitHub job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)
for how skipped checks appear and affect merge requirements.
