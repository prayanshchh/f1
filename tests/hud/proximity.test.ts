import { describe, expect, test } from "vitest";
import {
  carField,
  carStride,
} from "../../apps/client/src/game/frame-layout.ts";
import { proximity } from "../../apps/client/src/game/proximity.ts";

function grid(rivals: { x: number; y: number; visible?: boolean }[]) {
  const cars = new Float64Array((rivals.length + 1) * carStride);
  cars.set([0, 1], 0);
  cars.set([-1, 0], 4);
  cars.set([100, 50], 12);
  cars[carField.visible] = 1;
  rivals.forEach((rival, i) => {
    const row = (i + 1) * carStride;
    cars.set([0, 1], row);
    cars.set([-1, 0], row + 4);
    cars.set([100 + rival.x, 50 + rival.y], row + 12);
    cars[row + carField.visible] = rival.visible === false ? 0 : 1;
  });
  return cars;
}

describe("proximity arrows", () => {
  test("a car alongside shows on its own side of the player's heading", () => {
    const left = proximity(grid([{ x: -3, y: -1 }]));
    expect(left.left?.strength).toBeGreaterThan(0.4);
    expect(left.right).toBeNull();
    const right = proximity(grid([{ x: 3, y: -1 }]));
    expect(right.right?.strength).toBeGreaterThan(0.4);
    expect(right.left).toBeNull();
  });

  test("a car close behind tilts the arrow further than one alongside", () => {
    const behind = proximity(grid([{ x: 2, y: -8 }])).right;
    const beside = proximity(grid([{ x: 2, y: 0 }])).right;
    expect(behind?.angle).toBeGreaterThan((beside?.angle ?? 0) + 20);
  });

  test("cars ahead, far away or parked off the track show nothing", () => {
    const found = proximity(
      grid([
        { x: -2, y: 8 },
        { x: 2, y: -20 },
        { x: -2, y: -1, visible: false },
      ]),
    );
    expect(found).toEqual({ left: null, right: null });
  });

  test("the nearest car on a side sets the arrow", () => {
    const near = { x: 2.5, y: -1 };
    const far = { x: 4, y: -6 };
    const alone = proximity(grid([near])).right;
    expect(proximity(grid([far])).right).not.toEqual(alone);
    expect(proximity(grid([near, far])).right).toEqual(alone);
    expect(proximity(grid([far, near])).right).toEqual(alone);
  });
});
