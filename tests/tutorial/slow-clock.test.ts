import { describe, expect, test } from "vitest";
import { SlowClock } from "../../apps/client/src/game/slow-clock.ts";

const frame = 1 / 60;

function frames(
  clock: SlowClock,
  from: number,
  seconds: number,
): { now: number; time: number; resync: boolean }[] {
  const out = [];
  for (let k = 1; k <= Math.round(seconds / frame); k++) {
    const now = from + k * frame;
    const time = clock.time(now);
    out.push({ now, time, resync: clock.takeResync() });
  }
  return out;
}

describe("tutorial slow-motion clock", () => {
  test("in real time it follows the wall clock and never asks the engine to resync", () => {
    const clock = new SlowClock();
    let now = 1000.123;
    for (let k = 0; k < 20_000; k++) {
      now += 0.004 + ((k * 7919) % 13) * 0.003;
      expect(clock.time(now)).toBe(now);
      expect(clock.takeResync()).toBe(false);
    }
    expect(clock.realTime).toBe(true);
  });

  test("slowing down eases the engine clock to a stop, holds it there, and speeding up resyncs exactly once", () => {
    const clock = new SlowClock();
    clock.time(10);
    clock.slow();
    const easing = frames(clock, 10, 0.6);
    const steps = easing.map((f, k) => f.time - (easing[k - 1]?.time ?? 10));
    for (let k = 1; k < steps.length; k++)
      expect(steps[k]).toBeLessThanOrEqual((steps[k - 1] ?? 0) + 1e-12);
    expect(steps[0]).toBeGreaterThan(frame * 0.9);
    expect(steps.at(-1)).toBe(0);
    expect(clock.stopped).toBe(true);

    const stoppedAt = easing.at(-1)?.time ?? 0;
    const held = frames(clock, 10.6, 3);
    expect(new Set(held.map((f) => f.time))).toEqual(new Set([stoppedAt]));
    expect(held.some((f) => f.resync)).toBe(false);

    clock.run();
    const waking = frames(clock, 13.6, 1);
    expect(waking.filter((f) => f.resync)).toHaveLength(1);
    const resync = waking.findIndex((f) => f.resync);
    expect(resync).toBeGreaterThan(0);
    for (const f of waking.slice(0, resync)) expect(f.time).toBeLessThan(f.now);
    for (const f of waking.slice(resync)) expect(f.time).toBe(f.now);
    expect(clock.realTime).toBe(true);
  });

  test("hold stops the clock at once and an instant run restarts it at full speed", () => {
    const clock = new SlowClock();
    clock.hold();
    const held = frames(clock, 50, 2);
    expect(new Set(held.map((f) => f.time)).size).toBe(1);
    clock.run(true);
    const after = frames(clock, 52, 0.5);
    expect(after[0]?.resync).toBe(true);
    for (const f of after) expect(f.time).toBe(f.now);
  });
});
