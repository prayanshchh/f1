import { describe, expect, test } from "vitest";
import { markStrength } from "../../apps/client/src/game/mark-strength.ts";
import { rumbleTarget } from "../../apps/client/src/game/rumble.ts";

const load = 4000;

describe("tyre marks", () => {
  test("leaves no mark for tyres working normally through a corner", () => {
    const peakCorneringSlip = Math.tan((8 * Math.PI) / 180);
    expect(markStrength(60 * peakCorneringSlip, 60, load, false)).toBe(0);
    expect(markStrength(20 * peakCorneringSlip, 20, load, false)).toBe(0);
  });

  test("marks the road when a wheel locks, even at high speed", () => {
    expect(markStrength(70, 70, load, false)).toBe(1);
  });

  test("marks a drift but not a tyre that is off the ground", () => {
    expect(markStrength(15, 30, load, false)).toBeGreaterThan(0.5);
    expect(markStrength(70, 70, 0, false)).toBe(0);
  });

  test("marks kerbs darker than the road for the same slide", () => {
    expect(markStrength(12, 30, load, true)).toBeGreaterThan(
      markStrength(12, 30, load, false),
    );
  });
});

describe("kerb rumble", () => {
  const on = (surface: number, count: number) =>
    [0, 1, 2, 3].map((i) => ({ surface: i < count ? surface : 0 }));

  test("is silent on tarmac and when parked on a kerb", () => {
    expect(rumbleTarget(on(0, 4), 40)).toBe(0);
    expect(rumbleTarget(on(1, 2), 0)).toBe(0);
  });

  test("shakes on a kerb, and harder with more wheels on it", () => {
    expect(rumbleTarget(on(1, 1), 30)).toBeGreaterThan(0.5);
    expect(rumbleTarget(on(1, 2), 30)).toBeGreaterThan(
      rumbleTarget(on(1, 1), 30),
    );
  });

  test("shakes less on grass than on a kerb", () => {
    expect(rumbleTarget(on(2, 2), 30)).toBeLessThan(rumbleTarget(on(1, 2), 30));
    expect(rumbleTarget(on(2, 2), 30)).toBeGreaterThan(0);
  });
});
