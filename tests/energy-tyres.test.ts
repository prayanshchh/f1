import { describe, expect, test } from "vitest";
import {
  fuelBurnPerLap,
  fuelLapsDelta,
  nextErsMode,
  nominalFuelPerLap,
  OvertakeDetector,
  toggleBoost,
} from "../apps/client/src/game/energy.ts";
import {
  brakeState,
  damageState,
  nextPage,
  wearColour,
} from "../apps/client/src/game/mfd.ts";
import {
  puffPeakSize,
  puffsPerSecond,
  smokeIntensity,
  temperatureState,
  wearScale,
  wearState,
} from "../apps/client/src/game/tyres.ts";

describe("MFD status colours", () => {
  test("part damage escalates from green to red", () => {
    expect(damageState(0)).toBe("ok");
    expect(damageState(0.3)).toBe("warm");
    expect(damageState(0.6)).toBe("orange");
    expect(damageState(0.9)).toBe("hot");
  });

  test("tyre wear colours follow the F1 25 stint footage", () => {
    expect(wearColour(0.03)).toBe("ok");
    expect(wearColour(0.19)).toBe("warm");
    expect(wearColour(0.29)).toBe("warm");
    expect(wearColour(0.41)).toBe("orange");
    expect(wearColour(0.9)).toBe("hot");
  });

  test("brake readings colour by temperature", () => {
    expect(brakeState(100)).toBe("cool");
    expect(brakeState(420)).toBe("ok");
    expect(brakeState(1000)).toBe("hot");
  });

  test("pages cycle through the panel and wrap", () => {
    expect(nextPage("quick")).toBe("temps");
    expect(nextPage("temps")).toBe("wear");
    expect(nextPage("wear")).toBe("pressure");
    expect(nextPage("pressure")).toBe("quick");
  });
});

describe("overtake detection", () => {
  const length = 5000;
  const line = 4700;

  test("arms only when within a second behind at the detection point", () => {
    const detector = new OvertakeDetector(length);
    expect(detector.crossing(line - 100, 0.5)).toBe(false);
    expect(detector.crossing(line + 10, 0.5)).toBe(true);
    expect(detector.crossing(line + 20, 0.5)).toBe(false);
  });

  test.each([[1.4], [0], [-0.3]])("a gap of %f does not arm", (gap) => {
    const detector = new OvertakeDetector(length);
    detector.crossing(line - 1, gap);
    expect(detector.crossing(line + 1, gap)).toBe(false);
  });

  test("no reference lap means no overtake", () => {
    const detector = new OvertakeDetector(length);
    detector.crossing(line - 1, null);
    expect(detector.crossing(line + 1, null)).toBe(false);
  });
});

describe("ERS controls", () => {
  test("cycling the mode from Boost returns to the cruise modes", () => {
    expect(nextErsMode(0, 0)).toBe(1);
    expect(nextErsMode(2, 2)).toBe(0);
    expect(nextErsMode(3, 1)).toBe(2);
  });

  test("Boost toggles back to the mode it interrupted", () => {
    expect(toggleBoost(1, 1)).toBe(3);
    expect(toggleBoost(3, 2)).toBe(2);
  });
});

describe("fuel estimate", () => {
  test("uses the measured lap once there is one", () => {
    expect(fuelBurnPerLap(0)).toBe(nominalFuelPerLap);
    expect(fuelBurnPerLap(1.5)).toBe(1.5);
  });

  test("reports surplus and shortfall in laps", () => {
    expect(fuelLapsDelta(10, 2, 3)).toBe(2);
    expect(fuelLapsDelta(4, 2, 3)).toBe(-1);
  });
});

describe("tyre wear scale", () => {
  test("race length scales short races up to a limit", () => {
    expect(wearScale("scaled", "race", 56)).toBe(1);
    expect(wearScale("scaled", "race", 28)).toBe(2);
    expect(wearScale("scaled", "race", 3)).toBe(5);
    expect(wearScale("real", "race", 3)).toBe(1);
    expect(wearScale("off", "race", 3)).toBe(0);
  });
});

describe("tyre status", () => {
  test("temperature states follow the compound window", () => {
    expect(temperatureState(60, 85, 105)).toBe("cold");
    expect(temperatureState(80, 85, 105)).toBe("cool");
    expect(temperatureState(95, 85, 105)).toBe("ok");
    expect(temperatureState(120, 85, 105)).toBe("warm");
    expect(temperatureState(130, 85, 105)).toBe("hot");
  });

  test("wear states escalate to a puncture", () => {
    expect(wearState(0.2)).toBe("ok");
    expect(wearState(0.75)).toBe("worn");
    expect(wearState(0.95)).toBe("critical");
    expect(wearState(1)).toBe("punctured");
  });
});

describe("lock-up smoke", () => {
  test("no smoke without a lock-up or when almost stopped", () => {
    expect(puffsPerSecond(0, 0, 50)).toBe(0);
    expect(puffsPerSecond(1, 0, 2)).toBe(0);
  });

  test("a bigger lock-up makes more and bigger smoke", () => {
    expect(puffsPerSecond(0.8, 0, 50)).toBeGreaterThan(
      puffsPerSecond(0.2, 0, 50) * 3,
    );
    expect(puffPeakSize(smokeIntensity(0.9, 0))).toBeGreaterThan(
      puffPeakSize(smokeIntensity(0.2, 0)) * 2,
    );
  });
});
