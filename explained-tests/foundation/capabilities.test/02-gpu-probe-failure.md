# One failed capability check should not stop the remaining checks.

Source: [tests/foundation/capabilities.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/capabilities.test.mjs:21).

**Function being tested:** `detectCapabilities` should handle a failed check, explain it and continue collecting the other results.

**Dry run — expected behaviour:**

| Step | What happens |
|---|---|
| Mock setup | WebGL 2, WASM and worker checks return true. |
| Trigger failure | The WebGPU check rejects with “adapter unavailable”. |
| Expected decision | Record WebGPU as unavailable, keep the other results and allow startup through WebGL 2. |

**What the assertions check:**

| Check | Expected | Meaning |
|---|---|---|
| `canStart` | true | WebGL 2 still permits startup. |
| `features.webgpu.available` | false | The rejected check is unavailable. |
| `features.webgpu.reason` | Contains non-whitespace text | The failure has an explanation. |
| `features.wasm.available` and `features.worker.available` | true | The other checks still finish. |

A different result at any of these checks fails the test.

The failure is deliberately supplied by the test. No graphics driver is contacted.

Current status: the implementation is missing, so [loadContract](../contracts.md) fails before these assertions run.
