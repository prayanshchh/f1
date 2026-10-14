# “We could not measure it” must not become “it used nothing”

## 1. Start with the performance investigation

Your game feels slow, but the browser cannot give us a GPU timing or memory reading. If the report fills those fields with zero, we might wrongly conclude drawing uses no time or the game uses no memory.

We want missing information to remain visibly missing so it does not mislead a diagnosis.

## 2. Distinguish two different statements

A measured value of zero says the measurement was made and its result was zero. An unknown value says there is no reading to interpret. Those meanings cannot be substituted for one another.

The code uses **null** to represent unknown. It is a deliberate empty value, not the number 0 and not an empty report object.

## 3. Follow the supplied input

The helper is called as `samples()` with no GPU argument. Its default gpuMs is null, so every sample object has an unknown GPU reading.

The builder also receives gpuTimingAvailable=false. That Boolean explicitly says GPU timing is unavailable. memoryBytes=null supplies no memory reading either.

These are synthetic conditions set by the test; it does not ask a real browser for measurements.

## 4. Follow the function's expected decision

`buildBenchmarkReport` summarises available input. Here it should not construct a fictional GPU summary with mean=0. It should return gpuTimeMs=null. It should also keep memoryBytes=null.

No division or averaging can establish a missing measurement from these inputs. The important operation is preserving its meaning.

## The exact test, after the example

```javascript
test('measurements: unavailable GPU and memory readings are null, not zero', async () => {
  const { buildBenchmarkReport } = await loadContract('measurements');
  const report = buildBenchmarkReport({
    samples: samples(), gpuTimingAvailable: false, memoryBytes: null,
  });
  assert.equal(report.gpuTimeMs, null);
  assert.equal(report.memoryBytes, null);
});
```

## 5. What each assertion checks

After obtaining the proposed builder, the test calls it with those sample objects and stores report.

`assert.equal(report.gpuTimeMs,null)` requires unknown GPU timing. Returning 0, an object full of zeroes or undefined would fail this exact comparison.

`assert.equal(report.memoryBytes,null)` requires unknown memory. Returning 0 would incorrectly describe zero bytes of measured usage and fail.

## 6. What the test can tell us

It specifies missing-value handling in one report-building situation. It does not discover whether any browser offers these measurements, validate memory scope or decide how the UI displays unavailable fields.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/measurements.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/measurements.test.mjs:34).
