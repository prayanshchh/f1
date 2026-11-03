import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { offence, stage } from "../../apps/client/src/game/stewards.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import {
  sessionKind,
  startField,
  type Weekend,
} from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";
import {
  frameOf,
  type Stewarded,
  stewardMessages,
} from "../support/stewards.ts";

interface Rammer extends Weekend, Stewarded {
  _sdCars: (out: number) => void;
  _sdInputSteerDirect: (on: number) => void;
}

const carStride = 49;
const steerGain = 2;

function chase(m: Rammer, until: number): number {
  const cars = m._malloc(2 * carStride * 8);
  let closest = Infinity;
  while ((frameOf(m)[0] ?? 0) < until) {
    m._sdCars(cars);
    const rival = new Float64Array(m.HEAPF64.buffer, cars, 2 * carStride);
    const frame = frameOf(m);
    const dx = (rival[carStride + 12] ?? 0) - (frame[13] ?? 0);
    const dy = (rival[carStride + 13] ?? 0) - (frame[14] ?? 0);
    closest = Math.min(closest, Math.hypot(dx, dy));
    const turn = Math.atan2(dy, dx) - Math.atan2(frame[2] ?? 0, frame[1] ?? 1);
    const steer = Math.atan2(Math.sin(turn), Math.cos(turn)) * steerGain;
    m._sdInputAnalog(1, Math.max(-1, Math.min(1, steer)), 1, 0);
    m._sdStep(1);
  }
  m._free(cars);
  return closest;
}

describe.runIf(existsSync(wasm))("collisions", () => {
  test("driving into the back of the car ahead is penalised, and the car that was hit is not", async () => {
    const [player, rival] = planWeekend("corvus", 0, null).entrants;
    if (!player || !rival) throw new Error("season data has no field");
    const m = (await startField({
      kind: sessionKind.race,
      laps: 3,
      seed: 6,
      plan: { entrants: [player, rival], slots: [1, 0] },
      autopilot: false,
    })) as Rammer;
    m._sdInputSteerDirect(1);
    while ((frameOf(m)[0] ?? 0) < 0) {
      m._sdInputAnalog(1, 0, 0, 1);
      m._sdStep(5);
    }
    expect(chase(m, 30)).toBeLessThan(5.5);
    const decisions = stewardMessages(m).filter(
      (message) =>
        message.stage === stage.decision &&
        message.offence === offence.collision,
    );
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      expect(decision.car).toBe(0);
      expect(decision.other).toBe(1);
    }
  }, 120_000);
});
