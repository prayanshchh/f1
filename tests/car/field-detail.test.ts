import { describe, expect, test } from "vitest";
import { detailFor } from "../../apps/client/src/game/field-cars.ts";

describe("rival car detail", () => {
  test("drops detail as a car gets smaller on screen and never skips back to full detail far away", () => {
    let detail = 0;
    let previous = 0;
    for (let metres = 0.001; metres < 2; metres *= 1.05) {
      detail = detailFor(detail, metres);
      expect(detail).toBeGreaterThanOrEqual(previous);
      previous = detail;
    }
    expect(detail).toBeGreaterThan(0);
    expect(detailFor(0, 0.001)).toBe(0);
  });

  test("does not flicker when a car hovers around a switch distance", () => {
    let detail = 0;
    let metres = 0.001;
    while (detailFor(detail, metres) === detail) metres *= 1.01;
    const switchAt = metres;
    detail = detailFor(detail, switchAt);
    const changes = new Set<number>();
    for (let frame = 0; frame < 200; frame++) {
      const wobble = switchAt * (1 + 0.04 * Math.sin(frame));
      detail = detailFor(detail, wobble);
      changes.add(detail);
    }
    expect(changes.size).toBe(1);
  });
});
