# The game can still start without WebGPU if WebGL 2 works.

Source: [tests/foundation/capabilities.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/capabilities.test.mjs:13).

**Function being tested:** `detectCapabilities` uses the supplied check results to report available features and decide whether this prototype can start.

**Dry run — expected behaviour:**

| Step | What happens |
|---|---|
| Mock setup | `supported()` returns an object of fake checks. All return true; they do not inspect the laptop. |
| Change one result | Replace the WebGPU check with one returning false. The other checks still return true. |
| Call the function | Pass those checks into `detectCapabilities`. It should recognise WebGL 2 as an available graphics path. |

**What the assertions check:**

| Check | Expected | Meaning |
|---|---|---|
| `report.canStart` | true | The prototype is allowed to start. |
| `report.features.webgl2.available` | true | WebGL 2 is reported as available. |
| `report.features.webgpu.available` | false | WebGPU is reported as unavailable. |

A different result at any of these checks fails the test.

This checks the decision made from mocked results. It does not check real GPU compatibility or actually start a renderer.

Current status: the implementation is missing, so [loadContract](../contracts.md) fails before these assertions run.
