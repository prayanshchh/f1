# Reject unusable elapsed time before normal movement progression

## 1. The driver's concern

You drive forward and expect the game to advance through sensible amounts of time. If an internal timing value accidentally means negative time or an unlimited duration, feeding it into movement can produce nonsensical work.

This test checks that three unusable durations are rejected. It does not test real car damage or inspect whether state changed before an error.

## 2. Explain what the clock's input means

`clock.advance(delta)` receives elapsed seconds. Here delta is simply the input duration. For example, a positive 0.1 would mean one tenth of a second passed.

The schedule would normally divide accepted duration into movement updates. This test stops earlier: the duration itself must be usable.

## 3. Understand each bad value

| Supplied duration | Why it is unsuitable |
|---|---|
| -1 | It asks to account for negative elapsed time. Normal forward progression cannot use it. |
| NaN | It stands for Not-a-Number, a JavaScript result for some invalid numeric operations, such as 0/0. It provides no usable duration. |
| Infinity | It represents no finite bound, such as JavaScript's result for 1/0. It cannot describe a finite elapsed interval. |

The test supplies these values deliberately; they are not measured laptop timings. It does not test every other possible malformed input.

## 4. How the test checks rejection

`assert.throws` must be given an operation it can invoke and watch. The supplied callback `() => clock.advance(delta)` delays the advance call until the assertion runs it.

If advance returns normally, the assertion fails. If it throws an exception, the assertion also checks that its message mentions either time or delta, ignoring upper/lowercase. The expression `/time|delta/i` expresses those two acceptable words. This distinguishes the expected validation error from an unrelated error.

## The exact test, after the example

```javascript
test('clock: invalid time cannot corrupt simulation state', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const clock = createFixedStepClock({ ...options, onStep: () => {} });
  for (const delta of [-1, NaN, Infinity]) assert.throws(() => clock.advance(delta), /time|delta/i);
});
```

## 5. Trace all three attempts

The test creates a clock with an empty onStep callback: no toy position is calculated. The loop sets delta=-1 and checks the error, then repeats with NaN, then Infinity. Every iteration must reject with a matching message. Each iteration is an independent check of a bad argument, using the same clock object.

## 6. Be precise about the conclusion

The title says “cannot corrupt simulation state”, but the current assertions only check that an error is raised. An implementation could mutate state and then throw, and these assertions would not detect that mutation.

To prove unchanged state we would need to capture relevant state before the invalid call and compare it afterward. We have not added that assertion while rewriting the lesson. The lesson distinguishes that missing check from the behaviour actually specified.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/clock.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/clock.test.mjs:80).
