import { describe, expect, test } from "vitest";
import {
  closedPolyline,
  pointAlong,
} from "../../apps/client/src/game/polyline.ts";

describe("track map car position", () => {
  const square = closedPolyline([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);

  test("measures the closing segment back to the start", () => {
    expect(square.total).toBe(40);
  });

  test.each([
    [0, [0, 0]],
    [5, [5, 0]],
    [10, [10, 0]],
    [15, [10, 5]],
    [35, [0, 5]],
    [40, [0, 0]],
  ])("distance %d lands on the outline", (distance, expected) => {
    expect(pointAlong(square, distance)).toEqual(expected);
  });

  test("walks uneven segments by length, not by index", () => {
    const line = closedPolyline([
      [0, 0],
      [100, 0],
      [100, 1],
    ]);
    const [x, y] = pointAlong(line, 100.5);
    expect(x).toBe(100);
    expect(y).toBeCloseTo(0.5);
  });
});
