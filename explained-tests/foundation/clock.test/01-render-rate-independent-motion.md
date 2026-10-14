# The same driving instructions should cover the same distance at different picture rates

## 1. The driver's expectation

Suppose we replay identical driving instructions on two laptops. One displays fewer pictures per second. Its view can look less smooth, but that alone should not change the distance calculated from those instructions.

The test compares a simple movement experiment under three supplied picture schedules. It does not compare two human drivers, whose choices could differ.

## 2. Separate pictures from movement calculations

A **frame** is a displayed picture. **FPS** is how many such pictures appear per second. At an ideal 30 FPS, the time between pictures is 1/30 second because 30 equal gaps fill one second. A time gap between pictures is what this test calls a display interval.

We independently choose 120 movement calculations per second. Each calculation represents 1/120 second. We call one calculation a **tick** and number them 1, 2, 3 and onward.

Ten seconds of that movement schedule needs:

```text
120 calculations in each second × 10 seconds = 1,200 calculations
```

Ten seconds contains ten groups of 120, regardless of how often pictures are drawn.

## 3. Give the movement experiment concrete instructions

Start at position x=0 metres. Move at 10 metres per second for five seconds, then at 5 metres per second for another five seconds. x means distance along our simple straight line; velocity means metres travelled per second.

Distance equals speed multiplied by duration:

```text
First part:  10 metres/second × 5 seconds = 50 metres
Second part:  5 metres/second × 5 seconds = 25 metres
Total:                                     75 metres
```

Five seconds contains 120 × 5 = 600 updates. The initial speed therefore applies on ticks 1 through 600. Tick 601 is the first update of the next five seconds, where the speed changes to 5 m/s. That explains both numbers in `[[1,10],[601,5]]`.

## 4. Calculate one update before repeating it

At 10 m/s, one update moves x forward by 10 × 1/120 = 10/120 = 1/12 metre, about 0.08333 m.

After 600 updates at that speed, the combined movement is 600 × 10/120 = 50 m.

At 5 m/s, each later update contributes 5/120 = 1/24 metre, about 0.04167 m. Another 600 updates contribute 600 × 5/120 = 25 m. Position therefore reaches 50+25=75 m.

## 5. Where 300, 600 and 1,440 come from

These count the supplied gaps between pictures, not movement calculations:

| Pretend display schedule | Number of gaps over ten seconds | Duration supplied for each gap |
|---|---|---|
| 30 pictures/second | 30 × 10 = 300 | 1/30 second |
| 60 pictures/second | 60 × 10 = 600 | 1/60 second |
| 144 pictures/second | 144 × 10 = 1,440 | 1/144 second |

At 30 FPS, each gap fits four movement updates: 120 ÷ 30 = 4. Thus 300 × 4 = 1,200 updates.

At 60 FPS, each gap fits two: 120 ÷ 60 = 2. Thus 600 × 2 = 1,200 updates.

At 144 FPS, one gap is shorter than a movement interval: 1/144 is about 0.00694 second, while 1/120 is about 0.00833. The first gap alone does not finish an update. The clock must keep that time. Two gaps together cover 2/144, about 0.01389 second: one update fits, and the remainder is kept for the next call. No elapsed time should be lost merely because it came in smaller pieces.

Across all 1,440 gaps the total elapsed time is 1,440/144=10 seconds, so the intended result is still 1,200 updates.

## 6. What the clock and callback each do

`createFixedStepClock` creates the scheduler. `clock.advance(duration)` supplies elapsed seconds. The scheduler calls the supplied `onStep(tick, dt)` once per due movement update.

The callback performs the toy movement. It changes velocity at the two specified ticks, adds velocity×dt to x, and records the latest tick. The clock supplies tick and dt; the test supplies the speed commands. This separation is why a different number of display calls should not change the answer.

## The exact test, after the example

```javascript
test('clock: ten seconds of ticked input has the same result at 30, 60 and 144 FPS', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const results = [30, 60, 144].map((fps) => {
    let x = 0;
    let velocity = 0;
    let lastTick = 0;
    const commands = new Map([[1, 10], [601, 5]]);
    const clock = createFixedStepClock({ ...options, onStep: (tick, dt) => {
      if (commands.has(tick)) velocity = commands.get(tick);
      x += velocity * dt;
      lastTick = tick;
    } });
    for (let frame = 0; frame < fps * 10; frame++) clock.advance(1 / fps);
    return { x, lastTick };
  });
  for (const result of results) {
    assert.equal(result.lastTick, 1200);
    assert.ok(Math.abs(result.x - 75) < 1e-9, `Expected 75 m, got ${result.x}`);
  }
});
```

## 7. Follow the test's values

`[30,60,144].map(...)` runs three separate experiments. Each has fresh x=0, velocity=0 and lastTick=0. `commands` is a lookup table associating tick 1 with 10 m/s and tick 601 with 5 m/s.

When onStep receives tick 1, `commands.has(tick)` is true, so `commands.get(tick)` supplies 10 and velocity becomes 10. `x += velocity * dt` means add this update's movement to the existing position. `lastTick = tick` remembers that update was performed.

On tick 2 there is no new command, so velocity stays 10. On tick 601 the next command sets it to 5. The same movement formula runs after each command decision.

The frame loop calls advance 300, 600 or 1,440 times, with the corresponding gap duration. Its `fps*10` limit comes from picture rate multiplied by ten seconds. Each experiment returns its final x and lastTick; `results` holds those three returned objects.

The final loop checks every result. `assert.equal(result.lastTick,1200)` requires the complete ten seconds of updates. `Math.abs(result.x-75)` measures how far the final position differs from 75, ignoring the sign. It must be less than `1e-9`, which is 0.000000001 metre, allowing tiny arithmetic rounding. The failure message includes the unexpected position.

## 8. The conclusion this test can support

A passing result would show that these regular supplied display schedules give the same tick count and toy trajectory. It would not prove real device performance, handling under all irregular pauses, network latency behaviour or a future tyre model's correctness.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/clock.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/clock.test.mjs:9).
