import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contracts.mjs';

const supported = () => ({
  secureContext: true,
  webgl2: async () => true,
  webgpu: async () => true,
  wasm: async () => true,
  worker: async () => true,
});

test('compatibility: WebGL 2 remains usable without WebGPU', async () => {
  const { detectCapabilities } = await loadContract('capabilities');
  const report = await detectCapabilities({ ...supported(), webgpu: async () => false });
  assert.equal(report.canStart, true);
  assert.equal(report.features.webgl2.available, true);
  assert.equal(report.features.webgpu.available, false);
});

test('compatibility: a rejected GPU probe does not abort other checks', async () => {
  const { detectCapabilities } = await loadContract('capabilities');
  const report = await detectCapabilities({
    ...supported(), webgpu: async () => { throw new Error('adapter unavailable'); },
  });
  assert.equal(report.canStart, true);
  assert.equal(report.features.webgpu.available, false);
  assert.match(report.features.webgpu.reason, /\S/);
  assert.equal(report.features.wasm.available, true);
  assert.equal(report.features.worker.available, true);
});

test('compatibility: no graphics interface gives an explanation', async () => {
  const { detectCapabilities } = await loadContract('capabilities');
  const report = await detectCapabilities({
    ...supported(), webgl2: async () => false, webgpu: async () => false,
  });
  assert.equal(report.canStart, false);
  assert.ok(report.blockers.some((blocker) => blocker.feature === 'graphics' && blocker.message.trim()));
});

test('compatibility: missing WASM blocks this prototype explicitly', async () => {
  const { detectCapabilities } = await loadContract('capabilities');
  const report = await detectCapabilities({ ...supported(), wasm: async () => false });
  assert.equal(report.canStart, false);
  assert.ok(report.blockers.some((blocker) => blocker.feature === 'wasm' && blocker.message.trim()));
});

test('compatibility: unavailable worker produces a specific blocker', async () => {
  const { detectCapabilities } = await loadContract('capabilities');
  const report = await detectCapabilities({ ...supported(), worker: async () => false });
  assert.equal(report.canStart, false);
  assert.ok(report.blockers.some((blocker) => blocker.feature === 'worker' && blocker.message.trim()));
});

test('compatibility: reports do not invent private hardware details', async () => {
  const { detectCapabilities } = await loadContract('capabilities');
  const report = await detectCapabilities(supported());
  assert.equal(report.device.model, null);
  assert.equal(report.device.ramGiB, null);
  assert.equal(report.device.powerState, null);
});
