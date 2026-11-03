import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  lastSlot,
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import {
  carPoses,
  carStatus,
  gridOf,
  passesOf,
  qualifyingTimes,
  runUntilComplete,
  sessionKind,
  sessionOf,
  sessionPhase,
  startField,
  statsOf,
  subset,
  timingOf,
  trackPoint,
  type Weekend,
} from "../support/race-weekend.ts";
import { repoRoot } from "../support/repo.ts";
import { wasm } from "../support/speed-dreams.ts";
import { offence, stage } from "../../apps/client/src/game/stewards.ts";
import { type Stewarded, stewardMessages } from "../support/stewards.ts";

const fieldSize = 22;
const firstSegmentCars = 16;
const lastSegmentCars = 10;
const lapSeconds = 125;
const untimedRun = 440;
const boxDepth = 1;

interface CircuitTrack {
  length: number;
  centerline: { x: number; z: number }[];
  grid: { distance: number; offset: number }[];
}

interface Frame {
  track: CircuitTrack;
  origin: { x: number; y: number };
  heading: number;
}

function circuitFrame(): Frame {
  const read = (file: string): unknown =>
    JSON.parse(
      readFileSync(`${repoRoot}/content/tracks/hill-country/${file}`, "utf8"),
    );
  const track = read("track.json") as CircuitTrack;
  const frame = read("sd-frame.json") as { origin: number[]; heading: number };
  return {
    track,
    origin: { x: frame.origin[0] ?? 0, y: -(frame.origin[2] ?? 0) },
    heading: frame.heading,
  };
}

function paintedBox(
  frame: Frame,
  start: { x: number; y: number },
  slot: number,
) {
  const { track } = frame;
  const box = track.grid[slot];
  if (!box) throw new Error(`no grid box ${String(slot)}`);
  const count = track.centerline.length;
  const f = (box.distance / track.length) * count;
  const i = Math.floor(f);
  const point = (k: number) => {
    const p = track.centerline[((k % count) + count) % count];
    if (!p) throw new Error("centreline gap");
    return { x: p.x, y: -p.z };
  };
  const a = point(i);
  const b = point(i + 1);
  const size = Math.hypot(b.x - a.x, b.y - a.y);
  const t = f - i;
  const x = a.x + (b.x - a.x) * t - ((b.y - a.y) / size) * box.offset;
  const y = a.y + (b.y - a.y) * t + ((b.x - a.x) / size) * box.offset;
  const c = Math.cos(-frame.heading);
  const n = Math.sin(-frame.heading);
  const dx = x - frame.origin.x;
  const dy = y - frame.origin.y;
  const ux = (b.x - a.x) / size;
  const uy = (b.y - a.y) / size;
  return {
    x: start.x + c * dx - n * dy,
    y: start.y + n * dx + c * dy,
    forwardX: c * ux - n * uy,
    forwardY: n * ux + c * uy,
  };
}

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
      seed: 1,
      plan: headToHead(0.93),
    });
    runUntilComplete(m, 9 * lapSeconds);
    const [slower, quicker] = timingOf(m, 2);
    expect(quicker?.position).toBeLessThan(slower?.position ?? 0);
    expect(statsOf(m).overtakes).toBeGreaterThanOrEqual(1);
    const passes = passesOf(m);
    expect(passes).toHaveLength(statsOf(m).overtakes);
    expect(passes).toContainEqual(
      expect.objectContaining({ passer: 1, passed: 0, position: 1 }),
    );
    expect(statsOf(m).contacts).toBe(0);
    expect(statsOf(m).walls).toBe(0);
  });

  test("twenty laps on real strategies: stops, fresh rubber, fuel to the flag", async () => {
    const laps = 20;
    const plan = subset(planWeekend("corvus", 7, null), 8);
    const m = await startField({
      kind: sessionKind.race,
      laps,
      seed: 4,
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

  test("every car starts with its front wheels in its own painted grid box", async () => {
    const plan = planWeekend("corvus", lastSlot, null);
    const m = await startField({
      kind: sessionKind.race,
      laps: 5,
      seed: 4,
      plan,
    });
    m._sdStep(1);
    const frame = circuitFrame();
    const start = trackPoint(m, 0, 0);
    carPoses(m, fieldSize).forEach((car, index) => {
      const box = paintedBox(frame, start, plan.slots[index] ?? -1);
      const dx = car.x + car.headingX * car.frontAxle - box.x;
      const dy = car.y + car.headingY * car.frontAxle - box.y;
      const along = dx * box.forwardX + dy * box.forwardY;
      const across = dy * box.forwardX - dx * box.forwardY;
      expect(Math.abs(across)).toBeLessThan(0.3);
      expect(along).toBeLessThan(0);
      expect(along).toBeGreaterThan(-boxDepth);
    });
  });

  test("qualifying sends one car out at a time for an out lap and one timed lap", async () => {
    const plan = subset(planWeekend("corvus", 0, null), 6);
    const m = await startField({
      kind: sessionKind.qualifying,
      laps: 0,
      seed: 5,
      plan,
      autopilot: false,
    });
    runUntilComplete(m, 2);
    const first = sessionOf(m).onTrack;
    expect(first).toBeGreaterThan(0);
    m._sdFieldAutopilot(1);
    expect(m._sdSessionPlayerRun()).toBe(1);
    expect(m._sdSessionPlayerRun()).toBe(0);
    expect(
      timingOf(m, plan.entrants.length)[first]?.segmentBest,
    ).toBeGreaterThan(0);
    m._sdStep(20);
    expect(sessionOf(m).onTrack).toBe(0);
    const timedOrder: number[] = [first];
    const seen = new Set<number>();
    runUntilComplete(m, plan.entrants.length * 2 * lapSeconds, () => {
      const cars = timingOf(m, plan.entrants.length);
      const running = cars.filter(
        (car) =>
          car.status === carStatus.outLap || car.status === carStatus.flyingLap,
      );
      expect(running.length).toBeLessThanOrEqual(1);
      for (const car of running) seen.add(car.status);
      for (const car of cars)
        if (car.segmentBest > 0 && !timedOrder.includes(car.index))
          timedOrder.push(car.index);
    });
    expect(sessionOf(m).phase).toBe(sessionPhase.complete);
    expect(timedOrder[1]).toBe(0);
    expect([...seen].sort()).toEqual([carStatus.outLap, carStatus.flyingLap]);
    const cars = timingOf(m, plan.entrants.length);
    expect(timedOrder).toHaveLength(plan.entrants.length);
    for (const car of cars) {
      expect(car.status).toBe(carStatus.garage);
      expect(car.segmentBest).toBeGreaterThan(94);
      expect(car.segmentBest).toBeLessThan(101);
    }
    expect(cars[0]?.laps).toBe(2);
  });

  test("the slowest six drop out after Q1 and Q2 and cannot run again", async () => {
    const m = await startField({
      kind: sessionKind.qualifying,
      laps: 0,
      seed: 3,
      autopilot: false,
    });
    m._sdSessionSimulate();
    expect(sessionOf(m).phase).toBe(sessionPhase.running);
    expect(sessionOf(m).toRun).toBe(1);
    expect(m._sdSessionAdvance()).toBe(0);
    expect(m._sdSessionPlayerRun()).toBe(1);
    runUntilComplete(m, untimedRun);
    expect(sessionOf(m).phase).toBe(sessionPhase.complete);
    const q1 = timingOf(m, fieldSize);
    expect(q1[0]?.segmentBest).toBe(0);
    expect(q1[0]?.position).toBe(fieldSize);

    const alive = () =>
      timingOf(m, fieldSize).filter((car) => !car.eliminated).length;
    expect(m._sdSessionAdvance()).toBe(1);
    expect(alive()).toBe(firstSegmentCars);
    expect(timingOf(m, fieldSize)[0]?.status).toBe(carStatus.knockedOut);
    expect(m._sdSessionPlayerRun()).toBe(0);
    m._sdSessionSimulate();
    expect(sessionOf(m).phase).toBe(sessionPhase.complete);
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
