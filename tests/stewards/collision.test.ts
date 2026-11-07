import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { offence, stage } from "../../apps/client/src/game/stewards.ts";
import { chase, duel, type Rammer } from "../support/ram.ts";
import { wasm } from "../support/speed-dreams.ts";
import { frameOf, stewardMessages } from "../support/stewards.ts";

const contact = 5.5;

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
