# Between two pictures, calculate exactly the movement that belongs to that time

## 1. Start with what you want while driving

You hold the accelerator and drive forward. A laptop that shows fewer pictures should give you a less smooth view of the same movement. It should not accidentally make the car cover four times the distance.

This test checks the time instructions given to the movement calculation. Before those instructions make sense, we need to connect distance, time, pictures and calculation steps.

## 2. First understand one second of movement

For this teaching example, suppose the car travels at a constant **12 metres per second**. That means it covers 12 metres during one whole second.

If we consider only part of that second, it covers the same fraction of those 12 metres:

| Time we are calculating | Calculation | Distance |
|---|---|---|
| One second | 12 × 1 | 12 m |
| Half a second | 12 × 1/2 | 6 m |
| One thirtieth of a second | 12 × 1/30 = 12/30 | 0.4 m |
| One hundred-and-twentieth of a second | 12 × 1/120 = 12/120 | 0.1 m |

The rule is **distance = speed × time**. The 12 comes from our chosen example speed; the fractions describe how much time we want to calculate. These distances are hypothetical examples, not values the actual test computes.

## 3. Now connect that time to the screen

A frame is one picture. At 30 frames per second, the game ideally shows 30 evenly spaced pictures during one second. Each gap therefore lasts **1/30 second**.

During one such gap, our example car should travel 0.4 m. It does not wait motionless until a picture appears; the simulation calculates movement and the display shows the result.

Picture rate describes what the user sees. We separately choose how finely to calculate movement.

## 4. Divide that gap into four smaller calculations

Our proposed simulation schedule uses **120 movement calculations per second**. Each calculation covers 1/120 second. One such calculation is called a **tick**.

Why are there four ticks in the gap? Divide a whole second into 120 equal pieces. A 1/30-second gap occupies four of those pieces because 120 ÷ 30 = 4.

Equivalently, adding four small durations gives the complete gap:

```text
1/120 + 1/120 + 1/120 + 1/120
= 4/120
= 1/30 second
```

Steps 1, 2, 3 and 4 are those four movement calculations. They are not four pictures, gears or separate cars.

| Calculation | Seconds covered by this calculation | Movement at 12 m/s | Position afterwards |
|---|---|---|---|
| Tick 1 | 1/120 | 12 × 1/120 = 0.1 m | 0.1 m |
| Tick 2 | 1/120 | 0.1 m | 0.2 m |
| Tick 3 | 1/120 | 0.1 m | 0.3 m |
| Tick 4 | 1/120 | 0.1 m | 0.4 m |

After all four, we have calculated exactly the movement belonging to 1/30 second. We are dividing time into smaller pieces, not creating more time.

## 5. Understand the two function roles before reading their names

One function decides **how many calculations are due and how much time each covers**. Another function performs **one movement calculation** using those instructions.

The clock owns the first job. Calling `clock.advance(1/30)` tells it: “Account for 1/30 second of elapsed time.” That does not mean “move the car by 1/30 metre”. The argument is a duration in seconds.

`onStep` is the name of the function we give the clock for the second job. The clock calls it once for each due calculation. A function passed to another function to be called later is called a **callback**.

The intended calls here are:

```text
onStep(1, 1/120)
onStep(2, 1/120)
onStep(3, 1/120)
onStep(4, 1/120)
```

Each call supplies two arguments. The first identifies the calculation; the second says how many seconds it should cover. In the code, that second argument is called **dt**. Here dt simply means the duration of one calculation.

## 6. What mistake would create 1.6 metres?

Suppose the clock correctly calls the movement function four times, but mistakenly tells **each** call to cover the entire 1/30-second gap.

Each call would calculate 12 × 1/30 = 0.4 m. Repeating that four times gives:

```text
0.4 + 0.4 + 0.4 + 0.4 = 1.6 metres
```

It has accounted for 4 × 1/30 = 4/30 second, although only 1/30 second passed. That is where 1.6 comes from. Correct timing gives four smaller moves of 0.1 m, totalling 0.4 m.

## 7. What this test substitutes for the movement function

The actual test never sets a speed of 12 m/s and never moves a car. Instead, its `onStep` callback records each instruction in an array called `calls`. An array is a list of items kept in order.

We can inspect those instructions without involving tyres, steering or drawing. This isolates the clock's responsibility.

## The exact test, after the example

```javascript
test('clock: every update receives the fixed duration and a consecutive tick', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const calls = [];
  const clock = createFixedStepClock({ ...options, onStep: (tick, dt) => calls.push({ tick, dt }) });
  clock.advance(1 / 30);
  assert.deepEqual(calls.map((call) => call.tick), [1, 2, 3, 4]);
  for (const call of calls) assert.equal(call.dt, 1 / 120);
});
```

## 8. Follow the actual test in order

1. `loadContract('clock')` is intended to load the module providing `createFixedStepClock`. The shared options request 120 updates per second. That choice determines dt=1/120.
2. `calls = []` starts an empty record of instructions.
3. `createFixedStepClock` receives the options and the recording callback. Giving it the callback does not yet run that callback.
4. `clock.advance(1/30)` supplies one elapsed interval. The intended clock recognises that four fixed intervals fit.
5. For the first callback, tick=1 and dt=1/120. `calls.push({ tick, dt })` appends that pair to the list. The next three callbacks append pairs for ticks 2, 3 and 4 with the same dt. `push` also returns the new list length, but the test only relies on the appended record.
6. `calls.map((call) => call.tick)` reads just the tick number from each record, producing `[1,2,3,4]`. `assert.deepEqual` checks the entire list against that exact expected list. Missing, extra or repeated numbers fail.
7. The final loop visits every record. `assert.equal(call.dt, 1/120)` checks each duration. The wrong instructions from the 1.6 m example would fail here because 1/30 differs from 1/120.

The first assertion checks **which updates occurred**. The second checks **how much time each update represents**. Together they check the instructions for one gap; they do not prove realistic car physics or actual screen smoothness.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/clock.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/clock.test.mjs:30).
