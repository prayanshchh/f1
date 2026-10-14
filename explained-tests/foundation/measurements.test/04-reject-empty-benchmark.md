# A race with no collected readings cannot produce a trustworthy benchmark

## 1. Think about the driver's report

You try the game and ask how well it ran. Suppose the measurement collection failed and recorded nothing. We must not turn that absence into a confident “the game ran well” result.

The first requirement for summarising performance is having something to summarise.

## 2. Explain the input before its code name

A sample is one recorded set of readings. Several samples are stored in a list. An empty list, written `[]`, contains zero samples.

An average normally adds measurements and divides by their count. With no readings, there is no observed total and no positive count to divide by. Producing zero as an average would invent a measurement, not summarise one.

## 3. State the expected function behaviour

`buildBenchmarkReport` receives the list. For an empty list we expect it to raise an error, explaining that samples are required, rather than return a normal report.

The test supplies GPU timing unavailable and unknown memory as well, but it is specifically the zero sample count that this case is intended to reject.

## 4. How can a test inspect an error?

We give `assert.throws` a function that performs the operation. The assertion calls that function and watches its result.

If the operation returns normally, no error was raised and the check fails. If an error is raised, the check inspects its message. The chosen pattern `/sample/i` requires the text sample, ignoring case. It accepts messages such as “samples required” but does not require that precise wording.

## The exact test, after the example

```javascript
test('measurements: empty samples cannot produce a successful benchmark', async () => {
  const { buildBenchmarkReport } = await loadContract('measurements');
  assert.throws(() => buildBenchmarkReport({
    samples: [], gpuTimingAvailable: false, memoryBytes: null,
  }), /sample/i);
});
```

## 5. Follow the execution order

First the callback loads the proposed report builder. Then it passes an arrow function to assert.throws. The arrow function is important here because the report call must happen inside the assertion's observation, rather than before it.

When invoked, that function passes samples=[], gpuTimingAvailable=false and memoryBytes=null into the builder. The expected builder error reaches assert.throws. The assertion accepts it only if its message matches the sample pattern.

## 6. What would fail and what is still outside this test?

Returning any report, even one marked incomplete, fails this particular contract because it expects an exception. Throwing an unrelated error message fails too.

This does not test whether a browser collector notices its own failure, how an error appears to the player or all other invalid samples. Those responsibilities need separate evidence.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/measurements.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/measurements.test.mjs:43).
