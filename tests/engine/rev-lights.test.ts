import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { revLeds } from "../../apps/client/src/game/dash.ts";
import { frameIndex } from "../../apps/client/src/game/frame-layout.ts";
import { startRace } from "../support/race-systems.ts";
import { wasm } from "../support/speed-dreams.ts";

interface Shift {
  before: number;
  after: number;
}

describe.runIf(existsSync(wasm))("dash rev lights on the real gearbox", () => {
  test("all ten lights are lit before each automatic upshift and drop after it", async () => {
    const m = await startRace();
    const read = () => {
      const frame = new Float64Array(
        m.HEAPF64.buffer,
        m._sdFrame(),
        frameIndex.size,
      );
      const redLine = Math.max(1, frame[frameIndex.rpmRedLine] ?? 1);
      return {
        gear: frame[frameIndex.gear] ?? 0,
        fraction: (frame[frameIndex.rpm] ?? 0) / redLine,
      };
    };
    const clutchTicks = 75;
    const shifts: Shift[] = [];
    const recent: number[] = [];
    let pending: { before: number; at: number } | null = null;
    let gear = read().gear;
    for (let tick = 0; tick < 20000 && shifts.length < 5; tick++) {
      m._sdInputAnalog(1, 0, 1, 0);
      m._sdStep(1);
      const now = read();
      if (now.gear > gear && gear >= 1)
        pending = { before: Math.max(...recent), at: tick };
      if (pending && tick - pending.at === clutchTicks) {
        shifts.push({ before: pending.before, after: now.fraction });
        pending = null;
      }
      gear = now.gear;
      recent.push(now.fraction);
      if (recent.length > 40) recent.shift();
    }
    expect(shifts.length).toBeGreaterThanOrEqual(4);
    for (const shift of shifts) {
      expect(revLeds(shift.before)).toBe(10);
      expect(revLeds(shift.after)).toBeLessThan(5);
    }
  });
});
