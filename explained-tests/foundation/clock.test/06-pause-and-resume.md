# A paused solo race should resume from the next movement update

## 1. What you expect as a driver

You pause a solo race for one minute. You expect the car to stay where you left it. On resuming, you expect new movement from that paused moment, not a sudden minute of movement replayed all at once.

We first test that the movement scheduler obeys an explicit pause. Testing the browser button or tab event that requests that pause is a separate job.

## 2. How we observe whether movement was scheduled

The clock proposes 120 movement updates per second. Each update covers 1/120 second and receives a number: 1, then 2, then 3. Such an update is called a tick.

Instead of moving a car, our callback stores the number of the most recent tick. If that number changes while paused, we know another update was issued.

The local variable `tick` begins at zero. It is a test record, not the clock's internal counter. The `onStep` callback changes it when the clock supplies a new tick number.

## 3. Trace the intended timeline slowly

| Action | What the clock should do | Test's recorded tick |
|---|---|---|
| Start | No movement callback has run | 0 |
| advance(1/120) | Perform one normal update, calling onStep with 1 | 1 |
| pause() | Enter the paused state | 1 |
| advance(60) | Ignore the supplied minute while paused | Still 1 |
| resume() | Leave the paused state | 1 |
| advance(1/120) | Perform the next single update, calling onStep with 2 | 2 |

Sixty seconds is one minute. Unpaused, it would represent 60×120=7,200 movement updates. The intended paused policy does not accumulate those updates for later replay.

## 4. Connect the operations to the code

`createFixedStepClock` receives the shared options and the recording callback. `clock.advance` supplies elapsed seconds. `pause` and `resume` change whether that supplied time should produce updates. The callback's assignment `tick=nextTick` is how the test observes progress.

## The exact test, after the example

```javascript
test('clock: paused solo simulation ignores elapsed hidden-tab time', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  let tick = 0;
  const clock = createFixedStepClock({ ...options, onStep: (nextTick) => { tick = nextTick; } });
  clock.advance(1 / 120);
  clock.pause();
  clock.advance(60);
  assert.equal(tick, 1);
  clock.resume();
  clock.advance(1 / 120);
  assert.equal(tick, 2);
});
```

## 5. What each check means

After advancing once, pausing and supplying 60 seconds, `assert.equal(tick,1)` requires no further observed update. A different value fails.

After resuming and supplying one normal period, `assert.equal(tick,2)` requires progression to the next update without a burst from the hidden minute. A jump far beyond 2 or remaining at 1 fails.

## 6. What this does not prove

There is no displayed car here. The test directly calls pause and resume; it does not operate a pause button, listen for tab visibility or establish which interruptions should pause solo play. It says nothing about permitting pauses in a connected race.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/clock.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/clock.test.mjs:67).
