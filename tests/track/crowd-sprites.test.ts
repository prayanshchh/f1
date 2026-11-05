import { describe, expect, test } from "vitest";
import { spriteBounds } from "../../apps/client/src/game/sprite-bounds.ts";

const columns = 8;
const rows = 4;
const cutoff = 0.5;

function atlas(width: number, height: number, seed: number): Float32Array {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const alpha = new Float32Array(width * height);
  const cellW = width / columns;
  const cellH = height / rows;
  for (let cell = 0; cell < columns * rows; cell++) {
    const left = (cell % columns) * cellW;
    const top = Math.floor(cell / columns) * cellH;
    const cx = left + cellW * (0.2 + random() * 0.6);
    const cy = top + cellH * (0.2 + random() * 0.6);
    const rx = cellW * (0.1 + random() * 0.4);
    const ry = cellH * (0.1 + random() * 0.4);
    for (let y = top; y < top + cellH; y++)
      for (let x = left; x < left + cellW; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        alpha[y * width + x] = d < 1 ? 1 : random() < 0.02 ? 0.6 : 0;
      }
  }
  return alpha;
}

function mips(alpha: Float32Array, width: number, height: number) {
  const levels: { alpha: Float32Array; width: number; height: number }[] = [];
  for (let block = 1; block <= Math.max(width, height); block *= 2) {
    const w = Math.max(1, width / block);
    const h = Math.max(1, height / block);
    const level = new Float32Array(w * h);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = Math.floor(y / block) * w + Math.floor(x / block);
        level[at] =
          (level[at] ?? 0) + (alpha[y * width + x] ?? 0) / (block * block);
      }
    levels.push({ alpha: level, width: w, height: h });
  }
  return levels;
}

function bilinear(
  level: { alpha: Float32Array; width: number; height: number },
  u: number,
  v: number,
) {
  const x = u * level.width - 0.5;
  const y = v * level.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const at = (px: number, py: number) =>
    level.alpha[
      Math.min(level.height - 1, Math.max(0, py)) * level.width +
        Math.min(level.width - 1, Math.max(0, px))
    ] ?? 0;
  const fx = x - x0;
  const fy = y - y0;
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
}

describe("crowd sprite trimming", () => {
  test("never trims away a pixel that passes the alpha test at any mip level", () => {
    const width = 256;
    const height = 256;
    for (const seed of [3, 17, 91]) {
      const alpha = atlas(width, height, seed);
      const bounds = spriteBounds(alpha, width, height);
      const levels = mips(alpha, width, height);
      const steps = 96;
      for (let cell = 0; cell < columns * rows; cell++) {
        const box = bounds[cell];
        if (!box) throw new Error("missing bounds");
        for (const level of levels)
          for (let i = 0; i <= steps; i++)
            for (let j = 0; j <= steps; j++) {
              const across = i / steps;
              const down = j / steps;
              const u = ((cell % columns) + across) / columns;
              const v = (Math.floor(cell / columns) + down) / rows;
              if (bilinear(level, u, v) < cutoff) continue;
              expect(across).toBeGreaterThanOrEqual(box.x - 1e-6);
              expect(across).toBeLessThanOrEqual(box.y + 1e-6);
              expect(down).toBeGreaterThanOrEqual(box.z - 1e-6);
              expect(down).toBeLessThanOrEqual(box.w + 1e-6);
            }
      }
    }
  });

  test("leaves an empty sprite with nothing to draw", () => {
    const width = 64;
    const height = 64;
    const alpha = new Float32Array(width * height);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 8; x++) alpha[y * width + x] = 1;
    const bounds = spriteBounds(alpha, width, height);
    const last = bounds[columns * rows - 1];
    expect(last && last.y - last.x).toBe(0);
    const first = bounds[0];
    expect(first && first.y > first.x && first.w > first.z).toBe(true);
  });
});
