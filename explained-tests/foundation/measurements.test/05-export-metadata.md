# Keep the run's identity when a performance report is saved and read back

## 1. Start with comparing two driving experiences

You report that the game feels slower on one run than another. To interpret that difference, we need to know whether the runs used the same track, resolution and renderer. Losing those labels during saving makes a report difficult to compare.

This test checks that supplied run labels survive a text conversion. It does not perform either driving run.

## 2. Explain the labels the test supplies

Metadata means information describing the readings, rather than the readings themselves. The test constructs it directly:

| Field | Supplied value | Meaning in this test |
|---|---|---|
| buildId | foundation-test | Label for the application version |
| routeId | flat-route-v1 | Label for the benchmark route |
| seed | 42 | Reproducibility label; no random generator is run here |
| durationSeconds | 10 | Supplied duration label, not a measured ten-second run |
| renderer | webgl2 | Label for the graphics path |
| resolution | [1280,720] | Supplied picture width and height in pixels |
| browser | explicit-test-fixture | Explicitly identifies this as fixture data |
| evidence | synthetic-contract-test | Makes clear that readings are synthetic |

All these values originate in the test. The labels are not discovered from a user's machine. The sample list still has only five example readings, so the duration label must not be mistaken for measurement coverage.

## 3. Understand saving without introducing files yet

The report is initially a JavaScript object held in memory. To save or send it, it can be represented as JSON text, a portable format containing named fields and values.

`JSON.stringify(report)` produces that text. `JSON.parse(...)` reads the text and reconstructs values. The reconstructed object is called exported in the test. It need not be the original object in memory; its contents should match.

For example, a field with routeId='flat-route-v1' should still contain that same string after the round trip. A resolution array should still contain both 1280 and 720 in that order.

## 4. What the report builder is expected to do

`buildBenchmarkReport` receives the synthetic sample list, unknown memory, unavailable GPU timing and the metadata object. It should return a report containing that metadata and gpuTimeMs=null.

The caller then performs the JSON round trip on the returned report, not merely on the original metadata. This checks that the builder included the metadata and that conversion preserves it.

## The exact test, after the example

```javascript
test('measurements: JSON export preserves the route and measurement scope', async () => {
  const { buildBenchmarkReport } = await loadContract('measurements');
  const metadata = {
    buildId: 'foundation-test', routeId: 'flat-route-v1', seed: 42,
    durationSeconds: 10, renderer: 'webgl2', resolution: [1280, 720],
    browser: 'explicit-test-fixture', evidence: 'synthetic-contract-test',
  };
  const report = buildBenchmarkReport({
    samples: samples(), gpuTimingAvailable: false, memoryBytes: null, metadata,
  });
  const exported = JSON.parse(JSON.stringify(report));
  assert.deepEqual(exported.metadata, metadata);
  assert.equal(exported.gpuTimeMs, null);
});
```

## 5. Trace the checks

The test constructs metadata, passes it into the builder and stores report. The inner stringify call creates JSON text; the outer parse call reads it back into exported.

`assert.deepEqual(exported.metadata,metadata)` compares all nested contents, including both resolution numbers and their ordering. Missing or changed fields fail. It does not require the two objects to be the same object reference.

`assert.equal(exported.gpuTimeMs,null)` ensures unknown GPU timing remains unknown after conversion. Substituting zero or losing the field fails.

## 6. The evidence boundary

The test covers report construction and JSON preservation for these values. It does not download a file in the browser, measure a real device or verify whether supplied metadata is truthful. A genuine collector must record honest labels separately.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/measurements.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/measurements.test.mjs:50).
