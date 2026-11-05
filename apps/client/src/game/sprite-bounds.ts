import * as THREE from "three";

export const atlasColumns = 8;
export const atlasRows = 4;
export const alphaCutoff = 0.5;
const spriteCells = atlasColumns * atlasRows;

function halved(level: Float32Array, width: number, height: number) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const next = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const sx = Math.min(width - 1, x * 2 + dx);
        const sy = Math.min(height - 1, y * 2 + dy);
        sum += level[sy * width + sx] ?? 0;
      }
      next[y * w + x] = sum / 4;
    }
  return { next, w, h };
}

function grow(
  box: number[],
  left: number,
  right: number,
  top: number,
  bottom: number,
) {
  box[0] = Math.min(box[0] ?? 1, THREE.MathUtils.clamp(left, 0, 1));
  box[1] = Math.max(box[1] ?? 0, THREE.MathUtils.clamp(right, 0, 1));
  box[2] = Math.min(box[2] ?? 1, THREE.MathUtils.clamp(top, 0, 1));
  box[3] = Math.max(box[3] ?? 0, THREE.MathUtils.clamp(bottom, 0, 1));
}

function markTexel(
  boxes: number[][],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const left = ((x - 1) / w) * atlasColumns;
  const right = ((x + 2) / w) * atlasColumns;
  const top = ((y - 1) / h) * atlasRows;
  const bottom = ((y + 2) / h) * atlasRows;
  const lastColumn = Math.min(atlasColumns, Math.ceil(right)) - 1;
  const lastRow = Math.min(atlasRows, Math.ceil(bottom)) - 1;
  for (let row = Math.max(0, Math.floor(top)); row <= lastRow; row++)
    for (
      let column = Math.max(0, Math.floor(left));
      column <= lastColumn;
      column++
    ) {
      const box = boxes[row * atlasColumns + column];
      if (box)
        grow(box, left - column, right - column, top - row, bottom - row);
    }
}

export function spriteBounds(
  alpha: Float32Array,
  width: number,
  height: number,
): THREE.Vector4[] {
  const boxes = Array.from({ length: spriteCells }, () => [1, 0, 1, 0]);
  let level = alpha;
  let w = width;
  let h = height;
  for (;;) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if ((level[y * w + x] ?? 0) >= alphaCutoff)
          markTexel(boxes, x, y, w, h);
    if (w === 1 && h === 1) break;
    ({ next: level, w, h } = halved(level, w, h));
  }
  return boxes.map(([left = 0, right = 0, top = 0, bottom = 0]) =>
    right > left && bottom > top
      ? new THREE.Vector4(left, right, top, bottom)
      : new THREE.Vector4(),
  );
}
