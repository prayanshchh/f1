# The report must not invent hardware details it was never given.

Source: [tests/foundation/capabilities.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/capabilities.test.mjs:56).

**Function being tested:** `detectCapabilities` returns device information alongside capability results; unavailable information should stay unknown.

**Dry run — expected behaviour:**

| Step | What happens |
|---|---|
| Input | Only mocked feature checks are supplied. No model, RAM or power state is supplied. |
| Call | Build the report. |
| Expected output | Leave those three device fields unknown. |

**What the assertions check:**

| Check | Expected | Meaning |
|---|---|---|
| `device.model` | null | Laptop model is unknown. |
| `device.ramGiB` | null | RAM capacity is unknown. |
| `device.powerState` | null | Power state is unknown. |

A different result at any of these checks fails the test.

This does not discover hardware. It checks how absent information is represented.

Current status: the implementation is missing, so [loadContract](../contracts.md) fails before these assertions run.
