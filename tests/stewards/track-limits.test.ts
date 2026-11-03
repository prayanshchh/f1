import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  offence,
  penalty,
  stage,
} from "../../apps/client/src/game/stewards.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { Pilot } from "../support/pilot.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import { startField, sessionKind } from "../support/race-weekend.ts";
import { startCircuit, wasm } from "../support/speed-dreams.ts";
import {
  frameOf,
  type Stewarded,
  stewardCar,
  stewardMessages,
} from "../support/stewards.ts";

const timeIndex = 0;
const lapIndex = 49;
const lastLapIndex = 51;
const bestLapIndex = 52;
const distanceIndex = 53;
const pace = 0.85;
const wide = -12;
const excursions = [
  [2800, 2900],
  [3250, 3350],
] as const;

type Driven = RaceSystems & Stewarded;

function holdOnGrid(m: Driven): void {
  while ((frameOf(m)[timeIndex] ?? 0) < 0) {
    m._sdInputAnalog(1, 0, 0, 1);
    m._sdStep(5);
  }
}

function drive(
  m: Driven,
  goWide: (lap: number) => boolean,
  done: () => boolean,
): void {
  const pilot = new Pilot(m, pace);
  holdOnGrid(m);
  for (let tick = 0; tick < 400_000 && !done(); tick++) {
    const frame = frameOf(m);
    const lap = frame[lapIndex] ?? 0;
    const distance = frame[distanceIndex] ?? 0;
    const onStraight = excursions.some(
      ([from, to]) => distance > from && distance < to,
    );
    pilot.offset = onStraight && goWide(lap) ? wide : 0;
    pilot.tick();
  }
}

async function practiceLap(offTrack: boolean, enforced = true) {
  const m = await startCircuit<Driven>();
  if (enforced) m._sdStewardsTrackLimits(1);
  drive(
    m,
    (lap) => offTrack && lap === 1,
    () => (frameOf(m)[lapIndex] ?? 0) >= 2,
  );
  const frame = frameOf(m);
  return {
    last: frame[lastLapIndex] ?? 0,
    best: frame[bestLapIndex] ?? 0,
    invalid: stewardCar(m, 0).lastLapInvalid,
    offTracks: stewardCar(m, 0).offTracks,
    limits: stewardMessages(m).filter(
      (message) => message.offence === offence.trackLimits,
    ),
  };
}

describe.runIf(existsSync(wasm))("track limits", () => {
  test("are off by default: going wide keeps the lap and draws no track limits message", async () => {
    const cut = await practiceLap(true, false);
    expect(cut.offTracks).toBeGreaterThan(0);
    expect(cut.invalid).toBe(false);
    expect(cut.best).toBeCloseTo(cut.last, 3);
    expect(cut.limits).toEqual([]);
  }, 180_000);

  test("a lap with all four wheels past the white line is deleted and never becomes the best lap", async () => {
    const clean = await practiceLap(false);
    expect(clean.invalid).toBe(false);
    expect(clean.best).toBeCloseTo(clean.last, 3);

    const cut = await practiceLap(true);
    expect(cut.last).toBeGreaterThan(0);
    expect(cut.invalid).toBe(true);
    expect(cut.best).toBe(0);
  }, 180_000);

  test("race strikes go warning, warning, black and white flag, then a five second penalty", async () => {
    const [player] = planWeekend("corvus", 0, null).entrants;
    if (!player) throw new Error("season data has no player");
    const m = (await startField({
      kind: sessionKind.race,
      laps: 6,
      seed: 3,
      plan: { entrants: [player], slots: [0] },
      autopilot: false,
    })) as unknown as Driven;
    m._sdStewardsTrackLimits(1);
    const ladder = () =>
      stewardMessages(m).filter(
        (message) =>
          message.car === 0 &&
          message.offence === offence.trackLimits &&
          (message.stage === stage.decision ||
            (message.stage === stage.warning &&
              message.penalty !== penalty.lapDeleted)),
      );
    drive(
      m,
      (lap) => lap >= 1,
      () => ladder().some((message) => message.stage === stage.decision),
    );
    const steps = ladder().map((message) => [message.penalty, message.count]);
    expect(steps).toEqual([
      [penalty.warning, 1],
      [penalty.warning, 2],
      [penalty.blackWhite, 3],
      [penalty.time5, 0],
    ]);
    expect(stewardCar(m, 0).owedTime).toBe(5);
  }, 300_000);
});
