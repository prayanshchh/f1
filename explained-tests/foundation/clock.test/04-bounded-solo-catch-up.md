# Limit the burst of work after a solo interruption

## 1. What the driver might experience

Your solo game stops receiving regular time updates for five seconds. When activity resumes, immediately calculating everything missed could make the page freeze again. We want a deliberate recovery rule rather than an unlimited burst of calculations.

This is about a solo clock receiving a large elapsed interval. It is not the test of pressing Pause, and it is not a multiplayer rule.

## 2. Count the work represented by those five seconds

The proposed schedule performs 120 movement updates per second. Each update is one calculation, called a tick, covering 1/120 second.

Five seconds therefore represents:

```text
120 updates/second × 5 seconds = 600 updates
```

This is a count of potentially due calculations, not a claim that each calculation takes 1/120 second of processor work. Simulated time and computation cost are different.

## 3. Define the solo policy before its settings

We choose to allow at most eight updates in a single catch-up call. We deliberately leave out excessive wall-clock time and report it. That keeps recovery bounded; it means solo simulated time can fall behind wall-clock time after an interruption.

The shared option `maxStepsPerAdvance:8` expresses that maximum. Eight is a provisional safety setting, not a number derived from racing physics. The options also contain `maxFrameDeltaSeconds:0.25`, a proposed elapsed-input cap: 0.25 second would cover 120×0.25=30 updates before the separate eight-update limit. The exact interaction of these limits is not implemented yet.

If eight updates run, they represent 8×1/120=8/120, about 0.06667 simulated second. The test does not require exactly eight or assert an exact discarded duration. We must not present an imagined discard formula as existing code.

## 4. Keep only a usable remainder

The remaining fraction of one update period is called alpha. An alpha of 0.5 means half a period remains accumulated; valid alpha lies from zero inclusive to one exclusive after full due updates are dealt with.

Leaving hundreds of whole updates in an unseen backlog would defeat the catch-up limit: the next normal call would trigger another huge burst. We therefore check the next call too.

## 5. How the test observes work

`clock.advance` receives elapsed seconds. For each movement update it performs, it calls `onStep`. We replace real movement with a callback that increments `calls` by one. Starting at calls=0 lets us count scheduled work without a car model.

## The exact test, after the example

```javascript
test('clock: a five-second solo interruption cannot cause unbounded catch-up', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  let calls = 0;
  const clock = createFixedStepClock({ ...options, onStep: () => calls++ });
  const state = clock.advance(5);
  assert.ok(calls <= 8);
  assert.ok(state.discardedSeconds > 0);
  assert.ok(state.alpha >= 0 && state.alpha < 1);
  clock.advance(1 / 120);
  assert.ok(calls <= 9, 'The interruption must not leave a large hidden backlog');
});
```

## 6. Follow the experiment

First create a clock with the shared solo options and the counting callback. `clock.advance(5)` supplies the five-second interruption. Its returned state is expected to report what was discarded and the remaining fraction.

The first assertion requires calls≤8. The second requires discardedSeconds>0, so excessive wall time is explicitly acknowledged. The third requires alpha≥0 and alpha<1, preventing an invalid or whole-period remainder.

Now `clock.advance(1/120)` supplies one normal movement period. If the first call made eight updates, the next can bring the total to nine. If it made fewer, the total can be lower. The last assertion checks total calls≤9, catching a large burst released afterward.

## 7. What passing would mean

The tested input produces bounded callback work, an explicit discard report and a bounded next call. The assertions even permit zero callbacks in the first call; they do not establish an exact recovery trajectory. They also do not create browser visibility events, measure responsiveness or permit discarding time in a connected race.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/clock.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/clock.test.mjs:47).
