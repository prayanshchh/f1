# Keep the brief pause you feel while driving visible in the report

## 1. Start with the corner you are approaching

The game usually looks smooth, but while approaching a corner the picture briefly stops changing. You feel that pause even if most pictures arrive quickly. We need a report that preserves the pause rather than describing the whole experience using only an average.

This test checks how a report summarises supplied readings. It does not measure an actual pause or fix one.

## 2. Turn the visible pause into a quantity

A frame is one displayed picture. A frame interval is the time gap between pictures. The longer that gap, the longer you wait for the next picture.

We express these gaps in milliseconds, abbreviated ms. One second contains 1,000 ms. Thus 10 ms is 10/1,000=0.01 second, while 100 ms is 100/1,000=0.1 second.

The fixture deliberately supplies five gaps: 10, 10, 10, 10 and 100 ms. They are invented numbers chosen to include one unusually long gap.

## 3. Calculate the average without losing sight of the pause

Add the five readings, then divide by their count:

```text
10+10+10+10+100 = 140 milliseconds
140 ÷ 5 = 28 milliseconds per interval on average
```

That 28 ms is a correct average, but it is smaller than the 100 ms pause you would have waited through. We therefore also report the slow end of the readings.

## 4. Explain the slow-end summaries before their names

A percentile picks a boundary in an ordered list. For example, a 95th-percentile boundary should cover at least 95% of the samples at or below it under this report's chosen rule.

We use the documented nearest-rank rule: sort the readings, multiply their count by the requested fraction, and round that position up to the next whole position. Positions start at one.

| Ordered position | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Reading in ms | 10 | 10 | 10 | 10 | 100 |

For 95%, the fraction is 95/100=0.95. Multiply 5×0.95=4.75. A list cannot have a 4.75th item, so round up to position 5. Its value is 100 ms. The report calls this p95.

For 99%, use 0.99: 5×0.99=4.95, again rounded up to position 5, giving 100 ms. That is p99. With only five readings, both select the same value; this is not a large real-world statistical study.

## 5. Count long intervals separately

The test chooses 50 ms as its stall threshold, equivalent to 50/1,000=0.05 second. It counts intervals strictly greater than that threshold. Each 10 ms reading is below it; the 100 ms reading exceeds it. The count is therefore one. A reading exactly equal to 50 ms would not count under this rule, though that boundary case is not included here.

## 6. Where the readings and results come from

The existing `samples()` helper makes five sample objects. Each frameMs comes from the five-number list. Its other fields are also synthetic. Omitting the helper's argument makes gpuMs null. The test tells the builder GPU timing is unavailable and memory was not measured.

`buildBenchmarkReport` is expected to consume that supplied list and return summary fields. It does not need to collect real readings for this test.

## The exact test, after the example

```javascript
test('measurements: an isolated stall remains visible in the report', async () => {
  const { buildBenchmarkReport } = await loadContract('measurements');
  const report = buildBenchmarkReport({
    samples: samples(), gpuTimingAvailable: false, memoryBytes: null,
  });
  assert.equal(report.frameTimeMs.mean, 28);
  assert.equal(report.frameTimeMs.p95, 100);
  assert.equal(report.frameTimeMs.p99, 100);
  assert.equal(report.stallsOver50Ms, 1);
});
```

## 7. Follow the checks

The test first loads the proposed builder, calls it with the fixture, and stores its return as report. The four assertions require mean=28, p95=100, p99=100 and stallsOver50Ms=1.

Each checks a separate conclusion derived above. A report returning 28 as a slow-end statistic would fail, even if the average was right. A report losing the 100 ms reading from its stall count would also fail.

This establishes calculations for one supplied list. Actual browser collection, the cause of a pause and its repair require different checks.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/measurements.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/measurements.test.mjs:11).
