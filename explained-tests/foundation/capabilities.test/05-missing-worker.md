# This prototype must explain why it cannot start without workers.

Source: [tests/foundation/capabilities.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/capabilities.test.mjs:49).

**Function being tested:** `detectCapabilities` checks the proposed worker requirement before allowing startup.

**Dry run — expected behaviour:**

| Step | What happens |
|---|---|
| Mock input | Worker=false; graphics and WASM checks return true. |
| Call | Build the compatibility report. |
| Expected output | Block startup and identify the missing worker facility. |

**What the assertions check:**

| Check | Expected | Meaning |
|---|---|---|
| `canStart` | false | The chosen foundation requires a worker. |
| `blockers` | Contains a worker blocker with nonempty trimmed text | The player can see which requirement failed. |

A different result at any of these checks fails the test.

No real worker starts here. This tests the chosen policy, not all possible game architectures.

Current status: the implementation is missing, so [loadContract](../contracts.md) fails before these assertions run.
