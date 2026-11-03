import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  offence,
  penalty,
  pitPenaltyFor,
  stage,
  type StewardMessage,
} from "../../apps/client/src/game/stewards.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { driveStop } from "../support/pit-drive.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import { startField, sessionKind } from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";
import {
  frameOf,
  type Stewarded,
  stewardCar,
  stewardMessages,
} from "../support/stewards.ts";

type Driven = RaceSystems & Stewarded;

const speedIndex = 45;

const escalation: Record<number, number> = {
  [penalty.time5]: penalty.time10,
  [penalty.time10]: penalty.driveThrough,
  [penalty.driveThrough]: penalty.stopGo,
};

function jumpInput(t: number, speed: number): [number, number] {
  if (t > -1.2 && t < 0) return [1, 0];
  return [0, t < 0 || Math.abs(speed) > 0.5 ? 1 : 0];
}

async function jumpTheStart(): Promise<{ m: Driven; given: StewardMessage }> {
  const [player] = planWeekend("corvus", 0, null).entrants;
  if (!player) throw new Error("season data has no player");
  const m = (await startField({
    kind: sessionKind.race,
    laps: 6,
    seed: 5,
    plan: { entrants: [player], slots: [0] },
    autopilot: false,
  })) as unknown as Driven;
  const time = () => frameOf(m)[0] ?? 0;
  const decisions = () =>
    stewardMessages(m).filter(
      (message) => message.car === 0 && message.stage === stage.decision,
    );
  while (time() < 25 && decisions().length === 0) {
    const [throttle, brake] = jumpInput(time(), frameOf(m)[speedIndex] ?? 0);
    m._sdInputAnalog(1, 0, throttle, brake);
    m._sdStep(5);
  }
  const [given] = decisions();
  if (!given) throw new Error("the jump start was not penalised");
  return { m, given };
}

function after(m: Driven, given: StewardMessage) {
  return stewardMessages(m).filter(
    (message) => message.car === 0 && message.id > given.id,
  );
}

describe.runIf(existsSync(wasm))("serving a penalty in the pit lane", () => {
  test("a penalty taken as the rules say is marked served and cleared", async () => {
    const { m, given } = await jumpTheStart();
    expect(given.offence).toBe(offence.jumpStart);
    driveStop(m, {
      settle: 0,
      driveOn: 15000,
      penalty: () => pitPenaltyFor(stewardCar(m, 0)),
    });
    const later = after(m, given);
    const served = later.filter((message) => message.stage === stage.served);
    expect(served).toHaveLength(1);
    expect(served[0]?.penalty).toBe(given.penalty);
    expect(
      later.some((message) => message.offence === offence.penaltyImproper),
    ).toBe(false);
    const car = stewardCar(m, 0);
    expect(car.owedTime).toBe(0);
    expect(car.pending).toBe("none");
  }, 300_000);

  test("letting the crew work before the penalty time is up earns the next penalty up", async () => {
    const { m, given } = await jumpTheStart();
    driveStop(m, { settle: 0, driveOn: 15000 });
    const later = after(m, given).filter(
      (message) =>
        message.stage === stage.decision &&
        message.offence === offence.penaltyImproper,
    );
    expect(later).toHaveLength(1);
    expect(later[0]?.offence).toBe(offence.penaltyImproper);
    expect(later[0]?.penalty).toBe(escalation[given.penalty]);
  }, 300_000);
});
