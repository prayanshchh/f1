import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  LineReader,
  type RacingLineData,
} from "../../apps/client/src/game/racing-line.ts";
import {
  type CourseTurn,
  freezeDistance,
} from "../../apps/client/src/game/tutorial.ts";
import { readRepoFile } from "../support/repo.ts";
import {
  type SpeedDreams,
  startCircuit,
  wasm,
} from "../support/speed-dreams.ts";

interface Practice extends SpeedDreams {
  _sdPracticeGridSlot: (slot: number) => void;
  _sdRaceCountdown: (seconds: number) => void;
  _sdInputAssist: (on: number) => void;
  _sdInputAntiLock: (on: number) => void;
  _sdTrackLength: () => number;
}

const line = JSON.parse(
  readRepoFile("content/tracks/hill-country/racing-line.json"),
) as RacingLineData;
const { turns } = JSON.parse(
  readRepoFile("content/tracks/hill-country/circuit-map.json"),
) as { turns: CourseTurn[] };
const apex = turns.find((turn) => turn.number === 1)?.distance ?? 0;
const slowDownTicks = 125;
const index = { time: 0, speed: 45, laps: 49, distance: 53, toMiddle: 54 };

interface Stop {
  frozeAt: number;
  frozeSpeed: number;
  turnInSpeed: number;
}

interface Car {
  speed: number;
  travel: number;
  distance: number;
  steer: number;
}

function carOf(m: Practice, length: number): Car {
  const f = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  const at = (i: number) => f[i] ?? 0;
  return {
    speed: Math.abs(at(index.speed)),
    travel: (at(index.laps) - 1) * length + at(index.distance),
    distance: at(index.distance),
    steer: Math.max(-1, Math.min(1, -at(index.toMiddle) * 0.05)),
  };
}

async function practiceGrid(): Promise<Practice> {
  const m = await startCircuit<Practice>((module) => {
    module._sdPracticeGridSlot(1);
    module._sdRaceCountdown(2);
    module._sdInputAssist(1);
    module._sdInputAntiLock(1);
  });
  const time = () =>
    new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 1)[0] ?? 0;
  while (time() < 0) {
    m._sdInputAnalog(1, 0, 0, 1);
    m._sdStep(5);
  }
  return m;
}

function reachesRed(reader: LineReader, car: Car): boolean {
  const { brakeIn } = reader.read(car.distance, car.speed);
  return brakeIn !== null && brakeIn <= freezeDistance(car.speed);
}

async function stopForTurnOne(lateBy: number): Promise<Stop> {
  const m = await practiceGrid();
  const length = m._sdTrackLength();
  const reader = new LineReader(
    line.profile,
    line.length,
    line.length / length,
  );
  const froze = { at: Infinity, speed: 0 };
  for (let step = 0; step < 60_000; step++) {
    const car = carOf(m, length);
    const braking = car.travel >= froze.at + lateBy;
    if (car.travel >= apex - 20 || (braking && car.speed < 1))
      return {
        frozeAt: froze.at,
        frozeSpeed: froze.speed,
        turnInSpeed: car.speed,
      };
    const freeze = froze.at === Infinity && reachesRed(reader, car);
    if (freeze) Object.assign(froze, { at: car.travel, speed: car.speed });
    m._sdInputAnalog(1, car.steer, braking ? 0 : 1, braking ? 1 : 0);
    m._sdStep(freeze ? slowDownTicks : 1);
  }
  throw new Error("the car never reached Turn 1");
}

const cornerSpeed =
  line.profile.speed[
    Math.round((apex / line.length) * line.profile.speed.length)
  ] ?? 0;

describe.runIf(existsSync(wasm))("tutorial braking point at Turn 1", () => {
  test("flat out from the practice grid, time stops in the braking zone and braking from there makes the corner", async () => {
    const stop = await stopForTurnOne(0);
    expect(stop.frozeAt).toBeGreaterThan(apex - 220);
    expect(stop.frozeAt).toBeLessThan(apex - 60);
    expect(stop.frozeSpeed * 3.6).toBeGreaterThan(180);
    expect(stop.turnInSpeed).toBeLessThan(cornerSpeed);
  });

  test("braking 70 m after that point no longer makes the corner", async () => {
    const stop = await stopForTurnOne(70);
    expect(stop.turnInSpeed).toBeGreaterThan(cornerSpeed);
  });
});
