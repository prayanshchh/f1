import { describe, expect, test } from "vitest";
import {
  boostMode,
  type EnergyInfo,
} from "../../apps/client/src/game/energy.ts";
import { ersState } from "../../apps/client/src/game/dash.ts";

const medium = 1;

function energy(patch: Partial<EnergyInfo>): EnergyInfo {
  return {
    battery: 2e6,
    capacity: 4e6,
    harvested: 0,
    harvestLimit: 8.5e6,
    deployed: 0,
    motorPower: 0,
    icePower: 0,
    mode: medium,
    fuelMix: 1,
    overtakeActive: false,
    overtakeArmed: false,
    lastLapFuel: 0,
    brakeBias: 0.56,
    straightMode: 0,
    differential: 60,
    straightArmed: false,
    ...patch,
  };
}

describe("dash ERS state", () => {
  test("follows the motor: deploying on power, harvesting under regen", () => {
    expect(ersState(energy({ motorPower: 250e3 }), "harvest")).toBe("deploy");
    expect(ersState(energy({ motorPower: -300e3 }), "deploy")).toBe("harvest");
  });

  test("holds the last flow direction while coasting instead of flickering", () => {
    expect(ersState(energy({ motorPower: 500 }), "deploy")).toBe("deploy");
    expect(ersState(energy({ motorPower: -500 }), "harvest")).toBe("harvest");
    expect(ersState(energy({ motorPower: 0 }), "boost")).toBe("harvest");
  });

  test("Boost wins over the motor flow, and Overtake wins over Boost", () => {
    const boosting = { mode: boostMode, motorPower: -300e3 };
    expect(ersState(energy(boosting), "harvest")).toBe("boost");
    expect(
      ersState(energy({ ...boosting, overtakeActive: true }), "boost"),
    ).toBe("overtake-boost");
    expect(ersState(energy({ overtakeActive: true }), "deploy")).toBe(
      "overtake",
    );
  });

  test("an empty battery cannot show an active boost", () => {
    const empty = { mode: boostMode, battery: 0, motorPower: -80e3 };
    expect(ersState(energy(empty), "boost")).toBe("harvest");
    expect(ersState(energy({ ...empty, overtakeActive: true }), "boost")).toBe(
      "overtake",
    );
  });
});
