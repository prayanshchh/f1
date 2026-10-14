import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contracts.mjs';

function samples(gpuMs = null) {
  return [10, 10, 10, 10, 100].map((frameMs) => ({
    frameMs, mainThreadMs: 2, simulationMs: 1, gpuMs, drawCalls: 12,
  }));
}

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

test('measurements: unavailable GPU and memory readings are null, not zero', async () => {
  const { buildBenchmarkReport } = await loadContract('measurements');
  const report = buildBenchmarkReport({
    samples: samples(), gpuTimingAvailable: false, memoryBytes: null,
  });
  assert.equal(report.gpuTimeMs, null);
  assert.equal(report.memoryBytes, null);
});

test('measurements: empty samples cannot produce a successful benchmark', async () => {
  const { buildBenchmarkReport } = await loadContract('measurements');
  assert.throws(() => buildBenchmarkReport({
    samples: [], gpuTimingAvailable: false, memoryBytes: null,
  }), /sample/i);
});

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
