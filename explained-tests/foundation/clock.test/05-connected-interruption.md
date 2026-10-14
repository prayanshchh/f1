# A multiplayer interruption must request recovery instead of hiding lost time

## 1. Start with the driver and the other cars

You leave a connected race tab for several seconds while other players keep racing. When your browser resumes, its old view can be behind the accepted race state. Continuing as if those seconds never happened could show inconsistent positions or race progress.

The game needs to notice the interruption and let its session logic decide how to recover. This test checks the notice, not a completed recovery.

## 2. Why solo and connected play need different policies

In solo play, we can deliberately pause or leave out excess wall time because one local session owns its timeline. In connected play, other participants may have continued. Your browser cannot decide that their elapsed race time should vanish.

At 120 movement updates per second, five seconds corresponds to 120×5=600 updates. We do not automatically run all 600 here, nor invent a network repair algorithm. We require an explicit indication that ordinary progression needs recovery.

## 3. Introduce the returned signals

`requiresResync` means “the caller must arrange to get back to accepted session state”. Resync is short for resynchronisation. A true flag is a request, not a restored car.

`discardedSeconds` describes time deliberately left out by the clock. This connected test expects zero in that field. Zero does not prove that all five seconds were successfully calculated; it says the clock must not use the solo discard claim.

## 4. Which function is responsible

`createFixedStepClock` creates a clock with settings. We override its usual mode from solo to connected. `clock.advance(5)` gives that clock five elapsed seconds and returns state containing the signals.

The supplied `onStep` callback is empty. No car position is changed by this test, and it does not assert how many movement updates run.

## The exact test, after the example

```javascript
test('clock: a connected simulation flags interruption instead of silently discarding time', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const clock = createFixedStepClock({ ...options, mode: 'connected', onStep: () => {} });
  const state = clock.advance(5);
  assert.equal(state.requiresResync, true);
  assert.equal(state.discardedSeconds, 0);
});
```

## 5. Trace the assertions

The setup gives the factory the shared options with mode='connected'. The later mode value replaces the default solo value. The test then stores the result of advance(5) under `state`.

The first assertion expects state.requiresResync=true. A false value fails because the caller would not be told to arrange recovery.

The second expects state.discardedSeconds=0. A positive discarded-time value fails because the connected clock would be applying the prohibited solo-style report.

## 6. The narrow conclusion

The expected report signals connected recovery without declaring discarded time. It does not contact another player, fetch accepted state, reset the world or prove that a resumed multiplayer race is correct. Those are later tests and implementations.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/clock.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/clock.test.mjs:59).
