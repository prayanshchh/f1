# A slow display must not cause unlimited snapshot allocation

## 1. What could happen during a long race

Your laptop displays pictures slowly, while movement calculation can still produce fresh state. If each unread state creates another storage block, memory usage could keep growing while you drive.

We want a controlled amount of snapshot storage rather than assuming drawing always keeps up.

## 2. Explain the storage before calling it a pool

A snapshot needs space for numbers such as car position or orientation. A buffer is a block of bytes used for storing such data. Instead of allocating another block for every update, we plan to reuse a limited set.

The manager of those reusable blocks is called a buffer pool. Borrowing a block marks it as in use. Returning it later makes it available again. If all blocks are borrowed, there should be no available result rather than unlimited additional allocation.

## 3. Derive the chosen sizes

This test sets capacity=2: permit at most two buffers. That is a controlled test setting, not a measured optimal game configuration.

floatCount=4 requests room for four 32-bit floating-point numbers. A byte contains eight bits, so one 32-bit number uses 32/8=4 bytes. Four such numbers need 4×4=16 bytes per buffer. Two buffers would have 2×16=32 bytes of payload storage. This test does not assert that payload total or account for object overhead.

## 4. Introduce the operations

`createSnapshotPool` creates the manager. `pool.acquire()` borrows a token containing an id and buffer, or returns null when none is available. The id labels the managed slot. `stats.allocated` reports the buffer allocation count.

null means “none available”, not a zero-byte buffer. The caller will need to decide whether to omit an intermediate display snapshot until storage is returned. This test does not implement that caller policy.

## The exact test, after the example

```javascript
test('transport: a slow consumer cannot cause unbounded snapshot allocation', async () => {
  const { createSnapshotPool } = await loadContract('transport');
  const pool = createSnapshotPool({ capacity: 2, floatCount: 4 });
  const first = pool.acquire();
  const second = pool.acquire();
  assert.ok(first.buffer instanceof ArrayBuffer);
  assert.ok(second.buffer instanceof ArrayBuffer);
  assert.notEqual(first.id, second.id);
  for (let request = 0; request < 1000; request++) assert.equal(pool.acquire(), null);
  assert.equal(pool.stats.allocated, 2);
});
```

## 5. Run the slow-consumer scenario

| Request | Storage still available before request | Expected result |
|---|---|---|
| First acquire | Two slots can be used | First token with a buffer |
| Second acquire | One remaining slot | Different token id with another buffer |
| Third acquire | Both borrowed, none returned | null |
| Every further acquire | Still both borrowed | null |

The code makes 1,000 requests after the first two. The counter runs from 0 through 999, giving exactly 1,000 attempts. None returns either borrowed token first, so no slot becomes available during this loop.

## 6. What each assertion checks

The two instanceof checks require actual ArrayBuffer objects in the first two tokens. The id inequality requires distinct managed slots rather than the same token label handed out twice.

Every assertion inside the 1,000-iteration loop requires null. Any newly allocated or reused borrowed token would fail. The last assertion requires allocated=2, rejecting additional managed buffer allocations even if requests returned null.

Passing would show a bounded pool for this direct scenario. It does not measure browser heap memory, bound a message queue or prove simulation remains responsive when no buffer is available.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/transport.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/transport.test.mjs:15).
