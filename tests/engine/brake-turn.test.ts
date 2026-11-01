import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { startCota, wasm } from "../support/speed-dreams.ts";

const speedIndex = 45;
const wheelIndex = 17;
const spinOffset = 6;
const frontRadius = 0.36;
const testSpeed = 120 / 3.6;
const settleTicks = 200;
const sampleTicks = 300;

async function brakeAt(steer: number) {
  const m = await startCota();
  const memory = m._malloc(320);
  const frame = () => new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  const lateral = () => {
    m._sdTelemetry(memory);
    return Math.abs(new Float64Array(m.HEAPF64.buffer, memory, 40)[4] ?? 0);
  };
  m._sdStep(1000);
  while ((frame()[speedIndex] ?? 0) < testSpeed) {
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(1);
  }
  m._sdInputAnalog(1, steer, 0, 1);
  m._sdStep(settleTicks);
  let force = 0;
  let locked = 0;
  for (let i = 0; i < sampleTicks; i++) {
    m._sdStep(1);
    force += lateral() / 9.81 / sampleTicks;
    const f = frame();
    const speed = f[speedIndex] ?? 0;
    const spin = Math.abs(f[wheelIndex + spinOffset] ?? 0) * frontRadius;
    if (spin < speed * 0.3) locked += 1 / sampleTicks;
  }
  return { force, locked };
}

describe.skipIf(!existsSync(wasm))("braking at 120 km/h", () => {
  test("still turns the car when the driver brakes fully and steers", async () => {
    const { force, locked } = await brakeAt(0.8);
    expect(force).toBeGreaterThan(1);
    expect(locked).toBeLessThan(0.2);
  }, 60_000);

  test("can lock the front wheels when braking fully in a straight line", async () => {
    const { locked } = await brakeAt(0);
    expect(locked).toBeGreaterThan(0.5);
  }, 60_000);
});
