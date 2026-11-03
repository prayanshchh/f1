import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  flagCause,
  offence,
  stage,
  type StewardMessage,
} from "../../apps/client/src/game/stewards.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { Pilot } from "../support/pilot.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import {
  sessionKind,
  startField,
  subset,
  timingOf,
  type Weekend,
} from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";
import {
  frameOf,
  type Stewarded,
  stewardMessages,
} from "../support/stewards.ts";

type Raced = Weekend & Stewarded & RaceSystems;

const fieldCars = 8;
const carStride = 49;
const speedIndex = 45;
const lapIndex = 49;
const distanceIndex = 53;
const stopAt = 3000;
const stopFor = 4;

function time(m: Weekend): number {
  return frameOf(m)[0] ?? 0;
}

function holdOnGrid(m: Weekend): void {
  while (time(m) < 0) {
    m._sdInputAnalog(1, 0, 0, 1);
    m._sdStep(5);
  }
}

function flags(m: Raced): StewardMessage[] {
  return stewardMessages(m).filter((message) => message.stage === stage.flag);
}

function aboutPlayer(m: Raced, at: number): StewardMessage[] {
  return stewardMessages(m).filter(
    (message) =>
      message.stage === at &&
      message.other === 0 &&
      message.offence === offence.yellowOvertake,
  );
}

async function stopMidRace() {
  const m = (await startField({
    kind: sessionKind.race,
    laps: 3,
    seed: 2,
    plan: subset(planWeekend("corvus", 3, null), fieldCars),
    autopilot: false,
  })) as unknown as Raced;
  holdOnGrid(m);
  const pilot = new Pilot(m, 0.85);
  pilot.driveUntil(
    () =>
      (frameOf(m)[lapIndex] ?? 0) === 1 &&
      (frameOf(m)[distanceIndex] ?? 0) > stopAt,
  );
  let stoppedAt = -1;
  while (stoppedAt < 0 || time(m) < stoppedAt + stopFor) {
    const speed = Math.abs(frameOf(m)[speedIndex] ?? 0);
    m._sdInputAnalog(1, 0, 0, speed > 0.5 ? 1 : 0);
    m._sdStep(1);
    if (speed < 0.5 && stoppedAt < 0) stoppedAt = time(m);
  }
  return { m, pilot, stoppedAt };
}

function rival(m: Raced): Float64Array {
  const cars = m._malloc(2 * carStride * 8);
  m._sdCars(cars);
  const values = new Float64Array(
    m.HEAPF64.buffer,
    cars,
    2 * carStride,
  ).slice();
  m._free(cars);
  return values;
}

function ramUntil(m: Raced, until: number): void {
  while (time(m) < until) {
    const frame = frameOf(m);
    const other = rival(m);
    const dx = (other[carStride + 12] ?? 0) - (frame[13] ?? 0);
    const dy = (other[carStride + 13] ?? 0) - (frame[14] ?? 0);
    const turn = Math.atan2(dy, dx) - Math.atan2(frame[2] ?? 0, frame[1] ?? 1);
    const steer = Math.atan2(Math.sin(turn), Math.cos(turn)) * 2;
    m._sdInputAnalog(1, Math.max(-1, Math.min(1, steer)), 1, 0);
    m._sdStep(1);
  }
}

describe.runIf(existsSync(wasm))("yellow flags", () => {
  test("a car knocked into a spin by the player gets a yellow naming the spin and the contact with the player", async () => {
    const [player, other] = planWeekend("corvus", 0, null).entrants;
    if (!player || !other) throw new Error("season data has no field");
    const m = (await startField({
      kind: sessionKind.race,
      laps: 3,
      seed: 6,
      plan: { entrants: [player, other], slots: [1, 0] },
      autopilot: false,
    })) as unknown as Raced;
    m._sdInputSteerDirect(1);
    holdOnGrid(m);
    ramUntil(m, 30);
    expect(flags(m).find((message) => message.car === 1)).toMatchObject({
      other: 0,
      points: flagCause.spun,
    });
  }, 120_000);

  test("stopping on track raises a double yellow that says the player stopped and how long ago it began", async () => {
    const { m, stoppedAt } = await stopMidRace();
    const [yellow] = flags(m);
    expect(yellow).toMatchObject({
      car: 0,
      count: 2,
      points: flagCause.stopped,
    });
    expect(yellow?.time ?? 0).toBeGreaterThan(stoppedAt);
    expect((yellow?.time ?? 0) - (yellow?.value ?? 0)).toBeLessThanOrEqual(
      stoppedAt + 0.1,
    );
  }, 600_000);

  test("cars that pass the player under the yellow give the place back and wait until the player is past again", async () => {
    const { m, pilot } = await stopMidRace();
    pilot.scale = 0.95;
    const end = time(m) + 100;
    pilot.driveUntil(() => time(m) > end);
    const told = aboutPlayer(m, stage.instruction).map(
      (message) => message.car,
    );
    const returned = aboutPlayer(m, stage.returned).map(
      (message) => message.car,
    );
    expect(told.length).toBeGreaterThanOrEqual(3);
    expect(returned.sort()).toEqual([...told].sort());
    const position = timingOf(m, fieldCars).map((row) => row.position);
    for (const car of told)
      expect(position[car]).toBeGreaterThan(position[0] ?? 0);
    expect(
      stewardMessages(m).filter(
        (message) =>
          message.stage === stage.decision &&
          message.offence === offence.yellowOvertake,
      ),
    ).toEqual([]);
  }, 600_000);
});
