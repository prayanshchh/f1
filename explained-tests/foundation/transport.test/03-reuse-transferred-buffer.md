# Return usable transferred storage so the next update can reuse it

## 1. What we want over many pictures of a race

Movement sends state to drawing repeatedly. Once drawing is finished with a state's storage, we want that storage to come back and be reusable. Otherwise the game could keep allocating buffers for later updates.

This test combines a real transfer operation with the intended buffer-pool contract. It does not create an actual browser worker.

## 2. First explain the token and its storage

The pool lends a token with two parts: an id naming its slot and a buffer containing the byte storage. The id is a label, not a car position. The buffer is separate from that label.

There is only one pool slot. Four 32-bit float slots are requested. Each float uses 32/8=4 bytes, so buffer size is 4×4=16 bytes.

## 3. Distinguish copying from transferring

Copying would leave the sender with usable storage and create another independent copy for the receiver. Transferring instead moves usable access to the receiver and detaches the original sender's buffer.

Detached means the sender no longer has accessible buffer storage. Its buffer reports byteLength=0. It does not mean the entire token object or its id vanished: the sender can still read the label.

`structuredClone(token,{transfer:[token.buffer]})` creates a receiving token object and transfers the listed buffer into it. received has a usable buffer and the copied id. This is an actual built-in operation in Node, not a mocked transfer.

## 4. Why return the receiving token?

The original token's buffer is detached. Returning that empty sender-side buffer would not provide usable 16-byte storage.

We instead call `pool.release(received)`, giving the manager the label and the receiver's usable storage. The next acquire should lend that slot again. No second buffer is needed.

## The exact test, after the example

```javascript
test('transport: a returned snapshot buffer can be reused without another allocation', async () => {
  const { createSnapshotPool } = await loadContract('transport');
  const pool = createSnapshotPool({ capacity: 1, floatCount: 4 });
  const token = pool.acquire();
  const received = structuredClone(token, { transfer: [token.buffer] });
  assert.equal(token.buffer.byteLength, 0);
  pool.release(received);
  const next = pool.acquire();
  assert.equal(next.id, token.id);
  assert.equal(next.buffer.byteLength, 16);
  assert.equal(pool.stats.allocated, 1);
});
```

## 5. Trace all relevant values

| Moment | Original token buffer | Receiving token buffer | Managed allocations expected |
|---|---|---|---|
| After acquire | Usable 16 bytes | Not created yet | 1 |
| After transfer | Detached, length 0 | Usable 16 bytes | Still 1 |
| After release(received) | Still detached | Returned to pool | Still 1 |
| After next acquire | Still detached | Its usable storage is available through next | Still 1 |

The expected same id identifies reuse of the same pool slot. The test does not require the returned ArrayBuffer JavaScript object to have the same object reference as the sender's detached object.

## 6. What the assertions check

The first requires original token.buffer.byteLength=0, observing sender detachment. After release and acquire, next.id must equal token.id; the original id is still readable despite buffer detachment.

next.buffer.byteLength must be 16, proving the next token has usable storage of the requested size. stats.allocated must be 1, so reuse did not create another managed buffer allocation.

The test writes no car-state values into the buffers, measures no transfer cost and performs no worker messaging. It does not prove the renderer cannot alter live simulation state. Those are separate checks.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/transport.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/transport.test.mjs:27).
