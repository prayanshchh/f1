import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contracts.mjs';

const options = {
  hz: 120, maxStepsPerAdvance: 8, maxFrameDeltaSeconds: 0.25, mode: 'solo',
};

test('clock: ten seconds of ticked input has the same result at 30, 60 and 144 FPS', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const results = [30, 60, 144].map((fps) => {
    let x = 0;
    let velocity = 0;
    let lastTick = 0;
    const commands = new Map([[1, 10], [601, 5]]);
    const clock = createFixedStepClock({ ...options, onStep: (tick, dt) => {
      if (commands.has(tick)) velocity = commands.get(tick);
      x += velocity * dt;
      lastTick = tick;
    } });
    for (let frame = 0; frame < fps * 10; frame++) clock.advance(1 / fps);
    return { x, lastTick };
  });
  for (const result of results) {
    assert.equal(result.lastTick, 1200);
    assert.ok(Math.abs(result.x - 75) < 1e-9, `Expected 75 m, got ${result.x}`);
  }
});

test('clock: every update receives the fixed duration and a consecutive tick', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const calls = [];
  const clock = createFixedStepClock({ ...options, onStep: (tick, dt) => calls.push({ tick, dt }) });
  clock.advance(1 / 30);
  assert.deepEqual(calls.map((call) => call.tick), [1, 2, 3, 4]);
  for (const call of calls) assert.equal(call.dt, 1 / 120);
});

test('clock: display blending has a fraction between zero and one', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const clock = createFixedStepClock({ ...options, onStep: () => {} });
  const state = clock.advance(1 / 240);
  assert.equal(state.steps, 0);
  assert.ok(Math.abs(state.alpha - 0.5) < 1e-12);
});

test('clock: a five-second solo interruption cannot cause unbounded catch-up', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  let calls = 0;
  const clock = createFixedStepClock({ ...options, onStep: () => calls++ });
  const state = clock.advance(5);
  assert.ok(calls <= 8);
  assert.ok(state.discardedSeconds > 0);
  assert.ok(state.alpha >= 0 && state.alpha < 1);
  clock.advance(1 / 120);
  assert.ok(calls <= 9, 'The interruption must not leave a large hidden backlog');
});

test('clock: a connected simulation flags interruption instead of silently discarding time', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const clock = createFixedStepClock({ ...options, mode: 'connected', onStep: () => {} });
  const state = clock.advance(5);
  assert.equal(state.requiresResync, true);
  assert.equal(state.discardedSeconds, 0);
});

test('clock: paused solo simulation ignores elapsed hidden-tab time', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  let tick = 0;
  const clock = createFixedStepClock({ ...options, onStep: (nextTick) => { tick = nextTick; } });
  clock.advance(1 / 120);
  clock.pause();
  clock.advance(60);
  assert.equal(tick, 1);
  clock.resume();
  clock.advance(1 / 120);
  assert.equal(tick, 2);
});

test('clock: invalid time cannot corrupt simulation state', async () => {
  const { createFixedStepClock } = await loadContract('clock');
  const clock = createFixedStepClock({ ...options, onStep: () => {} });
  for (const delta of [-1, NaN, Infinity]) assert.throws(() => clock.advance(delta), /time|delta/i);
});
