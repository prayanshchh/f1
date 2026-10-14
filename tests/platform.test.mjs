import test from 'node:test';
import assert from 'node:assert/strict';

test('test-environment check: transferring a buffer detaches the sender copy', () => {
  const sender = new Float32Array([1, 2, 3, 4]);
  const receiver = structuredClone(sender, { transfer: [sender.buffer] });
  assert.equal(sender.byteLength, 0);
  assert.deepEqual(Array.from(receiver), [1, 2, 3, 4]);
});
