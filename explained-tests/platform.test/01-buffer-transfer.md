# Transferring a buffer removes sender access while preserving the receiver’s values.

Source: [tests/platform.test.mjs](/Users/prayanshchhablani/work/f1/tests/platform.test.mjs:4).

**Function being tested:** `structuredClone` creates the receiving value and transfers the listed backing buffer instead of copying that buffer.

**Dry run — expected behaviour:**

| Step | What happens |
|---|---|
| Setup | sender contains [1,2,3,4] as four float32 values, using 16 bytes. |
| Transfer | Move sender.buffer into receiver. |
| Expected result | Sender reports zero accessible bytes; receiver still contains [1,2,3,4]. |

**What the assertions check:**

| Check | Expected | Meaning |
|---|---|---|
| `sender.byteLength` | 0 | Sender storage is detached. |
| Receiver converted to an ordinary array | [1,2,3,4] | The values survived transfer. |

A different result at any of these checks fails the test.

This uses real Node transfer behaviour, not a mock. It does not test our browser worker.

Current status: this check passed in the local Node environment.
