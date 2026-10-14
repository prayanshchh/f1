# One returned buffer must not become two available buffers

## 1. Start with why the driver should care

Drawing and movement exchange state during a race. If their storage manager mistakes one block for two independent available blocks, later work could reuse the same space unsafely. That could produce corrupted state or pictures.

This test checks the small bookkeeping rule that prevents one cause of that problem: reject returning an already-returned token.

## 2. Explain borrowed versus available

The pool manages one slot. acquire borrows it. While borrowed, that slot is unavailable to another acquisition. release returns it so it becomes available again.

Calling release twice must not make the available-slot count increase twice. There is still only one storage block. The second return is an error, not a second buffer arriving.

## 3. Define the object that is passed

`createSnapshotPool({capacity:1,floatCount:4})` creates the proposed manager of one four-float slot. `pool.acquire()` returns a token identifying the slot and its storage. The test keeps this object under the name token.

`pool.release(token)` should recognise a valid outstanding borrow and mark it returned. Internal bookkeeping code is absent; this describes the expected contract rather than an existing implementation.

## The exact test, after the example

```javascript
test('transport: the same buffer cannot be returned to the pool twice', async () => {
  const { createSnapshotPool } = await loadContract('transport');
  const pool = createSnapshotPool({ capacity: 1, floatCount: 4 });
  const token = pool.acquire();
  pool.release(token);
  assert.throws(() => pool.release(token), /return|release|flight|duplicate/i);
});
```

## 4. Follow the three operations

First acquire the only token. Second release it normally; that call is outside the exception assertion, so an unexpected error there would fail the test. Third try the identical release again.

The third call is wrapped in a function supplied to assert.throws. The assertion invokes that function so it can inspect the error raised by release.

## 5. Explain exactly what error is acceptable

The pattern `/return|release|flight|duplicate/i` accepts an error message containing any of the four words, ignoring case. The word flight can describe storage still “in flight”, meaning borrowed or being passed between participants. The pattern does not require a particular error class or exact sentence.

If the second release returns normally, assert.throws fails. If it throws a message matching none of those words, the check also fails. A matching error passes this check.

## 6. The limit of the proof

No second acquire occurs between the two releases. Therefore this does not check an old token incorrectly returned after the slot has already been borrowed for a new use. It also does not demonstrate real data corruption or verify the entire pool's lifecycle.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/transport.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/transport.test.mjs:40).
