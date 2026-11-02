import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  StartLights,
  startLightCount,
} from "../../apps/client/src/game/start-lights.ts";
import { startingGrid, teams } from "../../apps/client/src/game/teams.ts";
import { type SpeedDreams, startCota, wasm } from "../support/speed-dreams.ts";

const speedIndex = 45;
const timeIndex = 0;

describe("start light sequence", () => {
  test("race lights come on one a second and go out at zero", () => {
    const lights = StartLights.race(0.5);
    const start = -lights.countdown;
    expect(lights.lit(start)).toBe(1);
    expect(lights.lit(start + 0.99)).toBe(1);
    expect(lights.lit(start + 1)).toBe(2);
    expect(lights.lit(start + 4)).toBe(5);
    expect(lights.lit(-0.001)).toBe(startLightCount);
    expect(lights.lit(0)).toBe(0);
    expect(lights.lit(30)).toBe(0);
  });

  test("the hold after five lights is random between 0.2 and 3 seconds", () => {
    expect(StartLights.race(0).countdown).toBeCloseTo(5.2, 5);
    expect(StartLights.race(1).countdown).toBeCloseTo(8, 5);
  });

  test("a restart uses the short sequence and still ends lit at zero", () => {
    const lights = StartLights.quick();
    expect(lights.countdown).toBe(2);
    expect(lights.lit(-0.001)).toBe(startLightCount);
    expect(lights.lit(0)).toBe(0);
  });
});

describe.runIf(existsSync(wasm))("engine race start", () => {
  interface Module extends SpeedDreams {
    _sdRaceCountdown: (seconds: number) => void;
  }

  const frame = (m: Module) =>
    new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);

  test("the car cannot leave before lights out and can afterwards", async () => {
    const m = await startCota<Module>((module) => {
      module._sdRaceCountdown(6);
    });
    m._sdStep(1);
    expect(frame(m)[timeIndex]).toBeLessThan(-5.9);
    m._sdInputAnalog(1, 0, 1, 0);
    let peakBeforeStart = 0;
    while ((frame(m)[timeIndex] ?? 0) < 0) {
      m._sdStep(10);
      if ((frame(m)[timeIndex] ?? 0) < 0)
        peakBeforeStart = Math.max(
          peakBeforeStart,
          Math.abs(frame(m)[speedIndex] ?? 0),
        );
    }
    expect(peakBeforeStart).toBeLessThan(1);
    m._sdStep(1000);
    expect(frame(m)[speedIndex]).toBeGreaterThan(10);
  });
});

describe("starting grid", () => {
  const player = {
    team: "corvus",
    first: "Asha",
    last: "Rao",
    number: 44,
    nationality: "IN",
  };
  const grid = startingGrid(player);

  test("has every car in position order with the player first", () => {
    expect(grid).toHaveLength(teams.length * 2);
    expect(grid.map((entry) => entry.position)).toEqual(
      grid.map((_, index) => index + 1),
    );
    expect(grid[0]).toMatchObject({
      player: true,
      last: "Rao",
      number: 44,
    });
    expect(grid.filter((entry) => entry.player)).toHaveLength(1);
  });

  test("the player's team mate lines up behind and each team has two cars", () => {
    expect(grid[1]?.team.id).toBe("corvus");
    for (const team of teams)
      expect(grid.filter((entry) => entry.team.id === team.id)).toHaveLength(2);
  });

  test("the player can start from a lower slot and the others shift round them", () => {
    const fromSecond = startingGrid(player, 1);
    expect(fromSecond[0]).toMatchObject({ position: 1, last: "Bellamy" });
    expect(fromSecond[1]).toMatchObject({ position: 2, player: true });
    expect(fromSecond[2]?.position).toBe(3);
    expect(fromSecond).toHaveLength(grid.length);
  });

  test("no AI driver appears twice", () => {
    const names = grid.map((entry) => `${entry.first} ${entry.last}`);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every team is fully described and no two AI drivers share a number", () => {
    const numbers = teams.flatMap((team) =>
      team.drivers.map((driver) => driver.number),
    );
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const team of teams) {
      expect(team.drivers).toHaveLength(2);
      expect(team.brand).toMatch(/^#[0-9a-f]{6}$/);
      expect(team.fullName.length).toBeGreaterThan(team.name.length);
    }
  });
});
