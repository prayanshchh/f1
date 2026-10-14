# Keep different kinds of work separate when investigating a slow race

## 1. What we need after the driver reports stuttering

Your picture updates slowly during a race. We need evidence about the work involved before deciding what to change. Reducing visual detail can help expensive drawing, but it does not automatically reduce the cost of calculating car movement.

This test checks that a report does not mix the categories of supplied measurements.

## 2. Name the jobs after explaining them

The browser performs page work, such as interface updates and preparing drawing instructions. Much of that happens on its main execution thread. The simulation calculates how the car moves. The graphics processor, or GPU, performs drawing work.

A drawing command asks the graphics system to draw something. The count of these commands is called drawCalls. Twelve drawing commands does not mean twelve cars, twelve pictures or twelve milliseconds.

The gap between two pictures is another measurement. It describes waiting time between displays and may include scheduling or other activity. It must not be relabelled as the duration of one particular job.

## 3. Build deliberately different example readings

The helper `samples(5)` constructs five synthetic sample objects. The argument 5 becomes each object's gpuMs field. Every object also receives mainThreadMs=2, simulationMs=1 and drawCalls=12. The five frameMs fields are 10,10,10,10,100.

All durations are in milliseconds, meaning thousandths of a second. The drawing-call count has no time unit.

## 4. Derive each expected average

| Category | Five supplied values | Add, then divide by five | Expected mean |
|---|---|---|---|
| Main-thread work | 2,2,2,2,2 ms | 10/5 | 2 ms |
| Simulation work | 1,1,1,1,1 ms | 5/5 | 1 ms |
| GPU work | 5,5,5,5,5 ms | 25/5 | 5 ms |
| Drawing commands | 12,12,12,12,12 | 60/5 | 12 |
| Gaps between pictures | 10,10,10,10,100 ms | 140/5 | 28 ms |

We calculate each category from its own values. We do not add 2+1+5 and call that the complete picture gap. Work scopes can overlap and are measured differently; these synthetic values do not specify a complete pipeline schedule.

## 5. The function's responsibility

`buildBenchmarkReport` receives the sample objects and returns a separate summary for each category. gpuTimingAvailable=true tells it these supplied GPU readings can be summarised. memoryBytes=null says memory is unknown.

## The exact test, after the example

```javascript
test('measurements: CPU costs stay distinct from frame intervals and GPU costs', async () => {
  const { buildBenchmarkReport } = await loadContract('measurements');
  const report = buildBenchmarkReport({
    samples: samples(5), gpuTimingAvailable: true, memoryBytes: null,
  });
  assert.equal(report.mainThreadTimeMs.mean, 2);
  assert.equal(report.simulationTimeMs.mean, 1);
  assert.equal(report.gpuTimeMs.mean, 5);
  assert.equal(report.drawCalls.mean, 12);
  assert.notEqual(report.mainThreadTimeMs.mean, report.frameTimeMs.mean);
});
```

## 6. Walk from the return value to the assertions

The test stores the returned object as report. It checks mainThreadTimeMs.mean=2, simulationTimeMs.mean=1, gpuTimeMs.mean=5 and drawCalls.mean=12. Each number is derived in the table, not detected from a laptop.

The final `assert.notEqual` checks that the main-thread mean differs from the frame-interval mean. With the fixture these are 2 and 28. It catches an accidental substitution of the overall picture gap for page CPU work.

This test does not separately assert frameTimeMs.mean=28; the other measurement case checks that arithmetic. Here the exact four means and their separation are the checks.

## 7. What remains unverified

The fixture is fake. No processor or GPU is timed. A correct summary cannot establish that a real collector measured the right job; that collector needs its own browser checks.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/measurements.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/measurements.test.mjs:22).
