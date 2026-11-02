import { describe, expect, test } from "vitest";
import { latticeSpan } from "../../apps/client/src/game/flat-noise.ts";

const frequencies = [1 / 45, 2 / 45, 4 / 45, 0.045, 0.09, 0.18, 0.35, 0.7];

function covers(low: number, high: number): void {
  const [start, size] = latticeSpan(low, high);
  for (const frequency of frequencies)
    for (const position of [low, high]) {
      const cell = Math.floor(position * frequency);
      expect(cell).toBeGreaterThanOrEqual(start);
      expect(cell + 1).toBeLessThan(start + size);
    }
}

describe("noise lattice table", () => {
  test("covers every octave for a world that straddles the origin", () => {
    covers(-2100, 1900);
  });

  test("covers low octaves for a world entirely away from the origin", () => {
    covers(1000, 3000);
    covers(-3000, -1000);
  });
});
