import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  gradeTurnIn,
  stopDuration,
} from "../../apps/client/src/game/pitstop.ts";
import { driveStop, layout } from "../support/pit-drive.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import { startCircuit, wasm } from "../support/speed-dreams.ts";

describe("turn-in timing", () => {
  test("grades a press by how far it was from the optimal moment", () => {
    expect(gradeTurnIn(0.05)).toBe("optimal");
    expect(gradeTurnIn(-0.2)).toBe("good");
    expect(gradeTurnIn(0.8)).toBe("early");
    expect(gradeTurnIn(-0.8)).toBe("late");
  });

  test("makes a mistimed turn-in cost stop time", () => {
    expect(stopDuration("late")).toBeGreaterThan(stopDuration("optimal"));
    expect(stopDuration("optimal")).toBe(2.5);
  });

  test("a front wing change adds the time a real nose change takes", () => {
    expect(stopDuration("optimal", true)).toBeGreaterThan(9.5);
    expect(stopDuration("optimal", true)).toBeLessThan(12.5);
  });
});

describe.skipIf(!existsSync(wasm))("pit stop in the engine", () => {
  test("parks in the box, services the car and rejoins the fast lane", async () => {
    const lap = driveStop(await startCircuit<RaceSystems>());
    expect([...lap.phases]).toEqual(
      expect.arrayContaining(["lane", "boxing", "service", "release"]),
    );
    expect(lap.finished).toBe(true);
    expect(
      Math.min(lap.parkedAlong, layout.length - lap.parkedAlong),
    ).toBeLessThan(1.6);
    expect(Math.abs(lap.parkedLateral - layout.boxLateral)).toBeLessThan(1);
    expect(lap.fuelAfter).toBeGreaterThan(lap.fuelBefore);
    expect(lap.fuelAfter).toBeGreaterThan(lap.startFuel - 0.5);
    expect(lap.fastestInLane).toBeLessThan(84);
    expect(lap.wingAfter).toBe(lap.wingBefore);
  }, 120_000);

  test("asking for a new front wing makes the stop longer and fits it", async () => {
    const plain = driveStop(await startCircuit<RaceSystems>());
    const withWing = driveStop(await startCircuit<RaceSystems>(), {
      replaceWing: true,
    });
    expect(withWing.stopTime).toBeGreaterThan(plain.stopTime + 7);
    expect(withWing.wingAfter).toBe(0);
    expect(withWing.floorAfter).toBeGreaterThan(0.4);
  }, 240_000);
});
