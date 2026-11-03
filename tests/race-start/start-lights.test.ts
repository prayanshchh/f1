import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  LightCue,
  StartLights,
  startLightCount,
} from "../../apps/client/src/game/start-lights.ts";
import { startingGrid, teams } from "../../apps/client/src/game/teams.ts";
import { wasm } from "../support/speed-dreams.ts";
import {
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import {
  offence,
  penalty,
  stage,
} from "../../apps/client/src/game/stewards.ts";
import {
  sessionKind,
  startField,
  type Weekend,
} from "../support/race-weekend.ts";
import {
  frameOf,
  type Stewarded,
  stewardMessages,
} from "../support/stewards.ts";

const speedIndex = 45;
const timeIndex = 0;

describe("start light sequence", () => {
  test("race lights stay dark for a second, come on one a second and go out at zero", () => {
    const lights = StartLights.race(0.5);
    const start = -lights.countdown;
    expect(lights.lit(start)).toBe(0);
    expect(lights.lit(start + 0.99)).toBe(0);
    expect(lights.lit(start + 1)).toBe(1);
    expect(lights.lit(start + 1.99)).toBe(1);
    expect(lights.lit(start + 2)).toBe(2);
    expect(lights.lit(start + 5)).toBe(5);
    expect(lights.lit(-0.001)).toBe(startLightCount);
    expect(lights.lit(0)).toBe(0);
    expect(lights.lit(30)).toBe(0);
  });

  test("the hold after five lights is random between 0.2 and 3 seconds", () => {
    expect(StartLights.race(0).countdown).toBeCloseTo(6.2, 5);
    expect(StartLights.race(1).countdown).toBeCloseTo(9, 5);
  });

  test("each light beeps once as it comes on, lights out is silent, and a restart beeps again", () => {
    const frame = 1 / 60;
    const cue = new LightCue();
    const beeps: number[] = [];
    const run = (lights: StartLights, from: number, to: number) => {
      for (let t = from; t < to; t += frame)
        if (cue.next(lights.lit(t))) beeps.push(t);
    };
    const race = StartLights.race(0.5);
    run(race, -race.countdown, 3);
    expect(beeps).toHaveLength(startLightCount);
    beeps.forEach((at, i) => {
      expect(at - -race.countdown).toBeCloseTo(1 + i, 1);
    });
    const restart = StartLights.restart(6.4);
    run(restart, -restart.countdown, 1);
    expect(beeps).toHaveLength(2 * startLightCount);
  });

  test("a restart uses the short sequence and still ends lit at zero", () => {
    const lights = StartLights.quick();
    expect(lights.countdown).toBe(2);
    expect(lights.lit(-0.001)).toBe(startLightCount);
    expect(lights.lit(0)).toBe(0);
  });
});

describe.runIf(existsSync(wasm))("engine race start", () => {
  const rpmIndex = 46;
  const distanceIndex = 53;
  const fullRevs = 10000 * (Math.PI / 30);
  const duel = (): WeekendPlan => {
    const [player, rival] = planWeekend("corvus", 0, null).entrants;
    if (!player || !rival) throw new Error("season data has no field");
    return { entrants: [player, rival], slots: [0, 1] };
  };
  const start = async () => {
    const m = (await startField({
      kind: sessionKind.race,
      laps: 6,
      seed: 4,
      plan: duel(),
      autopilot: false,
    })) as Weekend & Stewarded;
    m._sdStep(1);
    return m;
  };
  const time = (m: Weekend) => frameOf(m)[timeIndex] ?? 0;
  const runTo = (
    m: Weekend,
    until: number,
    input: (t: number) => [number, number],
  ) => {
    while (time(m) < until) {
      const [throttle, brake] = input(time(m));
      m._sdInputAnalog(1, 0, throttle, brake);
      m._sdStep(5);
    }
  };
  const startCalls = (m: Weekend & Stewarded, car: number) =>
    stewardMessages(m).filter(
      (message) =>
        message.car === car &&
        message.stage === stage.decision &&
        (message.offence === offence.jumpStart ||
          message.offence === offence.gridPosition),
    );

  test("throttle before lights out moves the car and the stewards penalise the jump start", async () => {
    const m = await start();
    expect(time(m)).toBeLessThan(-5);
    const grid = frameOf(m)[distanceIndex] ?? 0;
    runTo(m, -2, () => [0, 1]);
    runTo(m, 0, () => [1, 0]);
    expect((frameOf(m)[distanceIndex] ?? 0) - grid).toBeGreaterThan(1);
    expect(Math.abs(frameOf(m)[speedIndex] ?? 0)).toBeGreaterThan(1);
    runTo(m, 20, () => [0, 1]);
    const calls = startCalls(m, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.offence).toBe(offence.jumpStart);
    expect([penalty.time10, penalty.driveThrough]).toContain(calls[0]?.penalty);
    expect(startCalls(m, 1)).toHaveLength(0);
  }, 60_000);

  test("brake and throttle together hold the car at high revs, then it launches at lights out with no penalty", async () => {
    const m = await start();
    const grid = frameOf(m)[distanceIndex] ?? 0;
    let revs = 0;
    runTo(m, 0, (t) => {
      if (t > -1) revs = Math.max(revs, frameOf(m)[rpmIndex] ?? 0);
      return [1, 1];
    });
    expect(Math.abs((frameOf(m)[distanceIndex] ?? 0) - grid)).toBeLessThan(
      0.05,
    );
    expect(revs).toBeGreaterThan(fullRevs);
    runTo(m, 2, () => [1, 0]);
    expect(Math.abs(frameOf(m)[speedIndex] ?? 0)).toBeGreaterThan(10);
    runTo(m, 20, () => [0, 1]);
    expect(startCalls(m, 0)).toHaveLength(0);
    expect(startCalls(m, 1)).toHaveLength(0);
  }, 60_000);

  test("a car left alone does not creep off its grid slot", async () => {
    const m = await start();
    const grid = frameOf(m)[distanceIndex] ?? 0;
    runTo(m, -0.01, () => [0, 0]);
    expect(Math.abs((frameOf(m)[distanceIndex] ?? 0) - grid)).toBeLessThan(
      0.05,
    );
  }, 60_000);
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
