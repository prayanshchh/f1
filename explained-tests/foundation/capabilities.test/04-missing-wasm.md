# This prototype must explain why it cannot start without WASM.

Source: [tests/foundation/capabilities.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/capabilities.test.mjs:42).

**Function being tested:** `detectCapabilities` applies the prototype’s required-feature rules, including its WASM requirement.

**Dry run — expected behaviour:**

| Step | What happens |
|---|---|
| Mock input | WASM=false; the other checks return true. |
| Call | Build the compatibility report. |
| Expected output | Block startup and identify WASM as the missing requirement. |

**What the assertions check:**

| Check | Expected | Meaning |
|---|---|---|
| `canStart` | false | The required runtime is absent. |
| `blockers` | Contains a wasm blocker with nonempty trimmed text | The report names the reason. |

A different result at any of these checks fails the test.

This tests our startup policy using fake results. It does not execute a real WASM module.

Current status: the implementation is missing, so [loadContract](../contracts.md) fails before these assertions run.
