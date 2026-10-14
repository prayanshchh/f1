import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contracts.mjs';

test('transport: only the newest snapshot becomes the display state', async () => {
  const { createSnapshotInbox } = await loadContract('transport');
  const inbox = createSnapshotInbox();
  const newest = { tick: 12, timeSeconds: 0.1, buffer: new ArrayBuffer(16) };
  assert.equal(inbox.accept(newest), true);
  assert.equal(inbox.accept({ tick: 11, timeSeconds: 11 / 120, buffer: new ArrayBuffer(16) }), false);
  assert.equal(inbox.accept(newest), false);
  assert.equal(inbox.latest.tick, 12);
});

test('transport: a slow consumer cannot cause unbounded snapshot allocation', async () => {
  const { createSnapshotPool } = await loadContract('transport');
  const pool = createSnapshotPool({ capacity: 2, floatCount: 4 });
  const first = pool.acquire();
  const second = pool.acquire();
  assert.ok(first.buffer instanceof ArrayBuffer);
  assert.ok(second.buffer instanceof ArrayBuffer);
  assert.notEqual(first.id, second.id);
  for (let request = 0; request < 1000; request++) assert.equal(pool.acquire(), null);
  assert.equal(pool.stats.allocated, 2);
});

test('transport: a returned snapshot buffer can be reused without another allocation', async () => {
  const { createSnapshotPool } = await loadContract('transport');
  const pool = createSnapshotPool({ capacity: 1, floatCount: 4 });
  const token = pool.acquire();
  const received = structuredClone(token, { transfer: [token.buffer] });
  assert.equal(token.buffer.byteLength, 0);
  pool.release(received);
  const next = pool.acquire();
  assert.equal(next.id, token.id);
  assert.equal(next.buffer.byteLength, 16);
  assert.equal(pool.stats.allocated, 1);
});

test('transport: the same buffer cannot be returned to the pool twice', async () => {
  const { createSnapshotPool } = await loadContract('transport');
  const pool = createSnapshotPool({ capacity: 1, floatCount: 4 });
  const token = pool.acquire();
  pool.release(token);
  assert.throws(() => pool.release(token), /return|release|flight|duplicate/i);
});

test('transport: input must carry a valid future tick and bounded control values', async () => {
  const { validateInput } = await loadContract('transport');
  const context = { currentTick: 10, maxLeadTicks: 8 };
  const valid = { tick: 12, throttle: 0.5, brake: 0, steering: -0.25 };
  assert.equal(validateInput(valid, context).ok, true);
  for (const invalid of [
    { ...valid, tick: 9 }, { ...valid, tick: 100 }, { ...valid, tick: 12.5 },
    { ...valid, throttle: 2 }, { ...valid, brake: -1 }, { ...valid, steering: NaN },
  ]) {
    const result = validateInput(invalid, context);
    assert.equal(result.ok, false);
    assert.match(result.reason, /\S/);
  }
});
