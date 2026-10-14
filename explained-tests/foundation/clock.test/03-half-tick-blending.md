# Give the display useful progress information before another movement update is complete

## 1. Begin with the picture you see

You drive forward. The game calculates a new car position at regular times. Your screen can request another picture between two of those calculation times. We want the display to have useful timing information rather than advance physics merely because another picture is due.

This test checks one piece of information the display would use. It does not draw anything.

## 2. Explain the calculation period first

We choose 120 movement updates per second. Dividing one second into 120 equal periods gives each period a duration of 1/120 second, about 0.00833 second. One completed movement update is called a tick.

If only half that period has elapsed, we should not perform a complete movement update yet. Half of 1/120 is 1/240 second, about 0.00417 second.

## 3. Express how much of the period has elapsed

We need a fraction that says how far through the next period we are. Divide the elapsed remainder by the full period:

```text
Elapsed remainder:    1/240 second
Full update period:   1/120 second
Fraction: (1/240) ÷ (1/120)
        = 120/240
        = 1/2
        = 0.5
```

Both quantities measure seconds, so their ratio is a fraction, not another duration. Zero means none of the period has elapsed; 0.5 means half; reaching one whole period means another update becomes due.

The code calls this fraction **alpha**. Naming it alpha does not make it a new physical force; it is just timing progress.

## 4. Why a renderer might use that fraction

Suppose two already calculated positions are 0 m and 0.1 m. Drawing halfway between them would give 0+0.5×(0.1−0)=0.05 m. This is a visual example of blending known states, called interpolation.

In a common arrangement the renderer blends previous and current completed states, so the displayed position can lag the newest simulated state slightly. It does not obtain an uncalculated future position for free. The first half-period in this test has no such real position pair; the test only checks the fraction.

## 5. What receives the time and what returns the fraction

`createFixedStepClock` creates the scheduler. `advance` receives elapsed seconds and returns how many full updates ran plus the remaining progress fraction. `onStep` would perform each full movement update, but this test supplies an empty callback because it only needs the returned timing values.

## The exact test, after the example

```javascript
test('clock: display blending has a fraction between zero and one', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const clock = createFixedStepClock({ ...options, onStep: () => {} });
  const state = clock.advance(1 / 240);
  assert.equal(state.steps, 0);
  assert.ok(Math.abs(state.alpha - 0.5) < 1e-12);
});
```

## 6. Walk through this case

The clock begins with no elapsed time. `clock.advance(1/240)` supplies half a full update period. Under the expected policy, no whole tick fits, so state.steps=0. The time is retained as a remainder, giving state.alpha=0.5.

`assert.equal(state.steps,0)` rejects running a full update too early. `Math.abs(state.alpha-0.5)` finds the absolute error in the returned fraction. Requiring it below `1e-12` permits only a difference smaller than 0.000000000001.

## 7. What we have actually checked

This checks one returned fraction and a zero-update count. Despite the broad test title, it does not check every possible alpha, create a renderer or prove that the finished display moves smoothly.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/clock.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/clock.test.mjs:39).
