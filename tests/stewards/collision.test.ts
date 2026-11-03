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
const contact = 5.5;

function aimAt(frame: Float64Array, rival: Float64Array) {
  const dx = (rival[carStride + 12] ?? 0) - (frame[13] ?? 0);
  const dy = (rival[carStride + 13] ?? 0) - (frame[14] ?? 0);
  const turn = Math.atan2(dy, dx) - Math.atan2(frame[2] ?? 0, frame[1] ?? 1);
  const steer = Math.atan2(Math.sin(turn), Math.cos(turn)) * steerGain;
  return { gap: Math.hypot(dx, dy), steer: Math.max(-1, Math.min(1, steer)) };
}

function chase(m: Rammer, until: number, stopWithin = 0): number {
  const cars = m._malloc(2 * carStride * 8);
  let closest = Infinity;
  while ((frameOf(m)[0] ?? 0) < until && closest >= stopWithin) {
    m._sdCars(cars);
    const rival = new Float64Array(m.HEAPF64.buffer, cars, 2 * carStride);
    const { gap, steer } = aimAt(frameOf(m), rival);
    closest = Math.min(closest, gap);
    m._sdInputAnalog(1, steer, 1, 0);
    m._sdStep(1);
  }
  m._free(cars);
  return closest;
}

async function duel(): Promise<Rammer> {
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
  return m;
}

function playerCollisions(m: Rammer, at: number) {
  return stewardMessages(m).filter(
    (message) =>
      message.car === 0 &&
      message.offence === offence.collision &&
      message.stage === at,
  );
}

describe.runIf(existsSync(wasm))("collisions", () => {
  test("light taps that leave the AI car driving are investigated but not penalised", async () => {
    const m = await duel();
    expect(chase(m, 30, contact)).toBeLessThan(contact);
    const backOff = (frameOf(m)[0] ?? 0) + 20;
    while ((frameOf(m)[0] ?? 0) < backOff) {
      m._sdInputAnalog(1, 0, 0, 1);
      m._sdStep(5);
    }
    const investigated = playerCollisions(m, stage.noted);
    expect(investigated.length).toBeGreaterThan(0);
    expect(playerCollisions(m, stage.noAction)).toHaveLength(
      investigated.length,
    );
    expect(playerCollisions(m, stage.decision)).toEqual([]);
  }, 120_000);

  test("driving into the back of the car ahead until it spins is penalised, and the car that was hit is not", async () => {
    const m = await duel();
    expect(chase(m, 30)).toBeLessThan(contact);
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
