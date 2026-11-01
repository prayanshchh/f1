import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { type SpeedDreams, startCota, wasm } from "../support/speed-dreams.ts";

const speedIndex = 45;
const lateralIndex = 4;
const settleTicks = 200;
const sampleTicks = 100;
const gravity = 9.81;

async function lateralG(speed: number, input: number): Promise<number> {
  const m: SpeedDreams = await startCota();
  const memory = m._malloc(320);
  const frame = () => new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  m._sdStep(1000);
  while ((frame()[speedIndex] ?? 0) < speed) {
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(1);
  }
  m._sdInputAnalog(1, input, 0.3, 0);
  m._sdStep(settleTicks);
  let total = 0;
  for (let i = 0; i < sampleTicks; i++) {
    m._sdStep(1);
    m._sdTelemetry(memory);
    const telemetry = new Float64Array(m.HEAPF64.buffer, memory, 40);
    total += Math.abs(telemetry[lateralIndex] ?? 0) / gravity;
  }
  return total / sampleTicks;
}

describe.runIf(existsSync(wasm))("phone steering response", () => {
  test.each([
    [60 / 3.6, 1.6],
    [120 / 3.6, 2.4],
    [200 / 3.6, 3.4],
  ])(
    "at %d m/s a small tilt stays small and a large tilt reaches the grip limit",
    async (speed, limit) => {
      const small = await lateralG(speed, 0.18);
      const large = await lateralG(speed, 1);
      expect(small).toBeLessThan(limit * 0.25);
      expect(large).toBeGreaterThan(limit);
    },
    60_000,
  );
});
