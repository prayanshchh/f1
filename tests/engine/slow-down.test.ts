import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Pilot } from "../support/pilot.ts";
import {
  type RaceSystems,
  speedOf,
  startRace,
  statusReader,
} from "../support/race-systems.ts";
import { wasm } from "../support/speed-dreams.ts";

type Slowable = RaceSystems & { _sdPlayerSlowTo: (speed: number) => void };

const tick = 0.002;
const steps = (seconds: number) => Math.round(seconds / tick);
const crawl = 25 / 3.6;
const parts = 11;

async function atRacingSpeed(speed: number) {
  const m = (await startRace({ wear: 0 })) as Slowable;
  m._sdStep(1000);
  const pilot = new Pilot(m, 1);
  pilot.driveUntil(() => speedOf(m) >= speed);
  return { m, pilot, status: statusReader(m) };
}

function damage(read: ReturnType<typeof statusReader>): number[] {
  const status = read();
  return Array.from({ length: parts }, (_, i) => status.part(i));
}

describe.runIf(existsSync(wasm))("slowing the player's car", () => {
  test("from racing speed it rolls on at the new speed with no lurch, no damage, and can drive away again", async () => {
    const { m, pilot, status } = await atRacingSpeed(50);
    const before = damage(status);

    m._sdPlayerSlowTo(crawl);
    m._sdStep(1);
    expect(speedOf(m)).toBeCloseTo(crawl, 0);

    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < steps(0.5); i++) {
      m._sdInputAnalog(1, 0, 0, 0);
      m._sdStep(1);
      lowest = Math.min(lowest, speedOf(m));
      highest = Math.max(highest, speedOf(m));
    }
    expect(lowest).toBeGreaterThan(crawl - 1.5);
    expect(highest).toBeLessThan(crawl + 0.5);
    expect(damage(status)).toEqual(before);

    const start = pilot.distance();
    for (let i = 0; i < steps(4); i++) pilot.tick();
    expect(speedOf(m)).toBeGreaterThan(20);
    expect(pilot.distance() - start).toBeGreaterThan(40);
    expect(damage(status)).toEqual(before);
  });

  test("a car already slower than the target is left alone", async () => {
    const { m } = await atRacingSpeed(3);
    m._sdInputAnalog(1, 0, 0, 0);
    m._sdStep(1);
    const speed = speedOf(m);
    m._sdPlayerSlowTo(crawl);
    m._sdStep(1);
    expect(Math.abs(speedOf(m) - speed)).toBeLessThan(0.05);
  });
});
