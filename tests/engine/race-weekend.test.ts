import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import {
  carStatus,
  gridOf,
  qualifyingTimes,
  runUntilComplete,
  sessionKind,
  startField,
  statsOf,
  subset,
  timingOf,
  type Weekend,
} from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";
import { offence, stage } from "../../apps/client/src/game/stewards.ts";
import { type Stewarded, stewardMessages } from "../support/stewards.ts";

const fieldSize = 22;
const firstSegmentCars = 16;
const lastSegmentCars = 10;
const lapSeconds = 125;

function headToHead(leaderSpeed: number): WeekendPlan {
  const { entrants } = planWeekend("corvus", 0, null);
  const [player, rival] = entrants;
  if (!player || !rival) throw new Error("season data has no field");
  return {
    entrants: [
      {
        ...player,
        speed: leaderSpeed,
        raceSpeed: leaderSpeed,
        power: leaderSpeed,
      },
      { ...rival, speed: 1, raceSpeed: 1, power: 1 },
    ],
    slots: [0, 1],
  };
}

describe.runIf(existsSync(wasm))("race weekend on the real engine", () => {
  test("a full grid races to the flag, passing without crashing", async () => {
    const laps = 5;
    const m = await startField({ kind: sessionKind.race, laps, seed: 1 });
    runUntilComplete(m, (laps + 1) * lapSeconds);
    const cars = timingOf(m, fieldSize);
    expect(cars.filter((c) => c.finished)).toHaveLength(fieldSize);
    const classified = [...cars].sort((a, b) => a.position - b.position);
    classified.slice(1).forEach((car, i) => {
      const ahead = classified[i];
      if (!ahead) throw new Error("classification has a gap");
      expect(ahead.laps).toBeGreaterThanOrEqual(car.laps);
      if (ahead.laps === car.laps)
        expect(ahead.finishTime).toBeLessThanOrEqual(car.finishTime);
    });
    const stats = statsOf(m);
    expect(stats.overtakes).toBeGreaterThanOrEqual(4);
    expect(stats.contacts).toBeLessThanOrEqual(12);
    expect(stats.walls).toBeLessThanOrEqual(4);
    expect(Math.min(...cars.map((c) => c.best))).toBeLessThan(105);
    const penalties = stewardMessages(m as Weekend & Stewarded).filter(
      (message) =>
        message.stage === stage.decision &&
        message.offence !== offence.penaltyNotServed,
    );
    expect(penalties.length).toBeLessThanOrEqual(fieldSize / 5);
  });

  test("a quicker car passes a slower one ahead without touching it", async () => {
    const m = await startField({
      kind: sessionKind.race,
      laps: 8,
      seed: 2,
      plan: headToHead(0.93),
    });
    runUntilComplete(m, 9 * lapSeconds);
    const [slower, quicker] = timingOf(m, 2);
    expect(quicker?.position).toBeLessThan(slower?.position ?? 0);
    expect(statsOf(m).overtakes).toBeGreaterThanOrEqual(1);
    expect(statsOf(m).contacts).toBe(0);
    expect(statsOf(m).walls).toBe(0);
  });

  test("twenty laps on real strategies: stops, fresh rubber, fuel to the flag", async () => {
    const laps = 20;
    const plan = subset(planWeekend("corvus", 7, null), 8);
    const m = await startField({
      kind: sessionKind.race,
      laps,
      seed: 6,
      wear: 2,
      plan,
    });
    runUntilComplete(m, (laps + 1) * lapSeconds);
    for (const car of timingOf(m, plan.entrants.length)) {
      const entrant = plan.entrants[car.index];
      expect(car.retired).toBe(false);
      expect(car.finished).toBe(true);
      if (!entrant || entrant.player) continue;
      expect(car.pits).toBeGreaterThanOrEqual(1);
      expect(car.pits).toBeLessThanOrEqual(entrant.stints.length + 1);
    }
  });

  test("Q1 runs out, push and in laps, then knockouts set the grid", async () => {
    const m = await startField({
      kind: sessionKind.qualifying,
      laps: 0,
      seed: 3,
      autopilot: false,
    });
    m._sdSessionPlayerGarage(1);
    const seen = new Set<number>();
    runUntilComplete(m, 20 * 60, () => {
      for (const car of timingOf(m, fieldSize).slice(1)) seen.add(car.status);
    });
    expect(seen).toContain(carStatus.outLap);
    expect(seen).toContain(carStatus.pushLap);
    expect(seen).toContain(carStatus.inLap);
    expect(seen).toContain(carStatus.garage);
    const q1 = timingOf(m, fieldSize);
    const timed = q1.slice(1).filter((car) => car.best > 0);
    expect(timed.length).toBeGreaterThanOrEqual(fieldSize - 3);
    expect(Math.min(...timed.map((car) => car.best))).toBeLessThan(100);

    const alive = () =>
      timingOf(m, fieldSize).filter((car) => !car.eliminated).length;
    expect(m._sdSessionAdvance()).toBe(1);
    expect(alive()).toBe(firstSegmentCars);
    expect(timingOf(m, fieldSize)[0]?.eliminated).toBe(true);
    m._sdSessionSimulate();
    expect(m._sdSessionAdvance()).toBe(1);
    expect(alive()).toBe(lastSegmentCars);
    m._sdSessionSimulate();
    expect(m._sdSessionAdvance()).toBe(2);

    const grid = gridOf(m, fieldSize);
    expect(new Set(grid).size).toBe(fieldSize);
    const fastestFirst = (from: number, to: number, segment: number) => {
      const times = grid
        .slice(from, to)
        .map((car) => qualifyingTimes(m, car)[segment] ?? 0);
      expect(times.every((time) => time > 0)).toBe(true);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    };
    fastestFirst(0, lastSegmentCars, 2);
    fastestFirst(lastSegmentCars, firstSegmentCars, 1);
    fastestFirst(firstSegmentCars, fieldSize - 1, 0);
    expect(grid[fieldSize - 1]).toBe(0);
  });
});
