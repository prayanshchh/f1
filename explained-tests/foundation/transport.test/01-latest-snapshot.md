# Do not replace the displayed car with an older movement result

## 1. Start with the driver's view

You drive forward. The display receives a newer car-state update, then receives an older one afterward. If it shows the older result, the car could appear to jump backwards even though the calculation side has already progressed.

We need a way to distinguish “arrived later” from “represents a later moment”. Those are different.

## 2. Explain what is being passed around

Movement calculation and drawing are separate jobs inside the browser. The calculation side can send a small description of a completed state to the drawing side. Such a description is called a snapshot.

The snapshot carries a numbered movement update, called a tick. A higher tick identifies a later calculation in this proposed sequence. It also carries simulated time and storage for state values.

This test uses empty storage rather than real car positions. It checks which snapshot is retained, not whether its positions are correct.

## 3. Derive the example times

At 120 updates per second, tick 12 corresponds to 12/120=0.1 simulated second. Tick 11 corresponds to 11/120, about 0.09167 second. Tick 11 describes an earlier point, even if its message arrives after tick 12.

For intuition only, a constant-speed car at 12 m/s would be at 12×0.1=1.2 m at the later point and 12×11/120=1.1 m at the earlier point. Showing that earlier result would move the picture back by 0.1 m. These positions are not included or calculated in this actual test.

## 4. Introduce the receiver's job

`createSnapshotInbox` creates an object retaining the newest accepted snapshot. `inbox.accept(snapshot)` decides whether to retain a supplied snapshot and returns true if accepted, false otherwise. `inbox.latest` exposes the retained one.

The test calls this object directly. It does not send worker or network messages.

## The exact test, after the example

```javascript
test('transport: only the newest snapshot becomes the display state', async () => {
  const { createSnapshotInbox } = await loadContract('transport');
  const inbox = createSnapshotInbox();
  const newest = { tick: 12, timeSeconds: 0.1, buffer: new ArrayBuffer(16) };
  assert.equal(inbox.accept(newest), true);
  assert.equal(inbox.accept({ tick: 11, timeSeconds: 11 / 120, buffer: new ArrayBuffer(16) }), false);
  assert.equal(inbox.accept(newest), false);
  assert.equal(inbox.latest.tick, 12);
});
```

## 5. Follow each arrival separately

First, `newest` is constructed with tick=12, timeSeconds=0.1 and a 16-byte ArrayBuffer. An ArrayBuffer is a block of byte storage; no car values have been written into it here. The first accept call should return true and latest should now identify tick 12.

Second, an object with tick=11 is supplied. Comparing the update numbers shows 11<12, so it should return false. The stored newest tick stays 12.

Third, the original newest object is supplied again. Its tick equals the retained tick, so it is a duplicate rather than new progress. The return should again be false.

## 6. Trace the assertions

Each of the first three assertions inspects accept's immediate Boolean return: true, false, false respectively. The final assertion reads the stored latest.tick and requires 12. That last check matters because a function might claim rejection but still mistakenly overwrite its stored state.

This specifies ordering for three direct calls. It does not verify packet delivery, interpolation, snapshot contents or real displayed motion.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/transport.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/transport.test.mjs:5).
