# Missing both graphics paths should prevent startup with an explanation.

Source: [tests/foundation/capabilities.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/capabilities.test.mjs:33).

**Function being tested:** `detectCapabilities` decides whether at least one graphics path is available and returns reasons when startup is blocked.

**Dry run — expected behaviour:**

| Step | What happens |
|---|---|
| Mock input | WebGL 2=false and WebGPU=false; WASM and worker=true. |
| Call | Ask `detectCapabilities` to build the compatibility report. |
| Expected output | Startup is blocked because there is no graphics path. |

**What the assertions check:**

| Check | Expected | Meaning |
|---|---|---|
| `canStart` | false | Do not start the prototype. |
| `blockers` | Contains a graphics blocker with nonempty trimmed text | Explain the missing graphics path. |

A different result at any of these checks fails the test.

This checks the returned explanation, not whether the page visibly displays it.

Current status: the implementation is missing, so [loadContract](../contracts.md) fails before these assertions run.
