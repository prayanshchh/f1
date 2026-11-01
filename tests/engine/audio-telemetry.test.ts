import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { type SpeedDreams, startCota, wasm } from "../support/speed-dreams.ts";

const speedIndex = 45;
const fields = 5;
const grass = 2;

async function start(): Promise<SpeedDreams> {
  const m = await startCota();
  m._sdStep(1000);
  return m;
}

function reader(m: SpeedDreams) {
  const memory = m._malloc(22 * 8);
  return () => {
    m._sdAudio(memory);
    return new Float64Array(m.HEAPF64.buffer, memory, 22).slice();
  };
}

describe.runIf(existsSync(wasm))("audio telemetry from the engine", () => {
  test("rolling wheels spin at road speed and sit on tarmac", async () => {
    const m = await start();
    const read = reader(m);
    const frame = () => new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
    while ((frame()[speedIndex] ?? 0) < 40) {
      m._sdInputAnalog(1, 0, 1, 0);
      m._sdStep(1);
    }
    m._sdInputAnalog(1, 0, 0.3, 0);
    m._sdStep(40);
    const audio = read();
    const speed = audio[20] ?? 0;
    expect(speed).toBeGreaterThan(30);
    for (let i = 0; i < 4; i++) {
      const spin = audio[i * fields + 1] ?? 0;
      const radius = audio[i * fields + 2] ?? 0;
      expect(radius).toBeGreaterThan(0.2);
      expect((spin * radius) / speed).toBeGreaterThan(0.8);
      expect(audio[i * fields + 3]).toBe(0);
      expect(audio[i * fields + 4]).toBeGreaterThan(100);
    }
  });

  test("leaving the road reports grass under the wheels", async () => {
    const m = await start();
    const read = reader(m);
    let found = false;
    for (let tick = 0; tick < 12000 && !found; tick++) {
      m._sdInputAnalog(1, tick > 1500 ? 0.25 : 0, 0.5, 0);
      m._sdStep(1);
      const audio = read();
      found = [0, 1, 2, 3].some((i) => audio[i * fields + 3] === grass);
    }
    expect(found).toBe(true);
  });
});
