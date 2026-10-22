import { expect, test } from "vitest";
import type { TrackData, Vec3 } from "../../apps/client/src/contracts/index.ts";
import { ribbon } from "../../apps/client/src/scene/follow/ribbon.ts";
import { readRepoFile } from "../support/repo.ts";
import { caughtError, square } from "../support/sim.ts";

const track = JSON.parse(
  readRepoFile("content/tracks/ridgewater/track.json"),
) as TrackData;
function vertex(values: Float32Array, index: number): Vec3 {
  return {
    x: values[3 * index] ?? NaN,
    y: values[3 * index + 1] ?? NaN,
    z: values[3 * index + 2] ?? NaN,
  };
}
function at(index: number): Vec3 {
  const p =
    track.centerline[
      (index + track.centerline.length) % track.centerline.length
    ];
  if (p === undefined) throw new Error("Missing track point");
  return p;
}
function checkEdges(values: Float32Array, i: number): void {
  const left = vertex(values, 2 * i),
    right = vertex(values, 2 * i + 1);
  const p = at(i),
    before = at(i - 1),
    after = at(i + 1);
  for (const axis of ["x", "y", "z"] as const)
    expect(Math.abs((left[axis] + right[axis]) / 2 - p[axis])).toBeLessThan(
      1e-3,
    );
  const dx = left.x - right.x,
    dz = left.z - right.z;
  const tx = after.x - before.x,
    tz = after.z - before.z;
  expect(Math.abs(Math.hypot(dx, dz) - track.width)).toBeLessThan(1e-3);
  expect(Math.abs(left.y - p.y)).toBeLessThan(1e-3);
  expect(Math.abs(right.y - p.y)).toBeLessThan(1e-3);
  expect(
    Math.abs((dx * tx + dz * tz) / Math.hypot(dx, dz) / Math.hypot(tx, tz)),
  ).toBeLessThanOrEqual(1e-3);
  expect(dx * tz - dz * tx).toBeGreaterThan(0);
}
test("the road follows the Ridgewater centreline at the track's width", () => {
  const result = ribbon(track);
  expect(result.positions.length).toBe(6 * track.centerline.length);
  expect(result.colors.length).toBe(result.positions.length);
  expect([...result.positions, ...result.colors].every(Number.isFinite)).toBe(
    true,
  );
  track.centerline.forEach((_, i) => {
    checkEdges(result.positions, i);
  });
});
test("the road is a closed loop of upward-facing triangles", () => {
  const { indices, positions } = ribbon(track);
  const n = track.centerline.length;
  expect(indices.length).toBe(6 * n);
  expect([...indices].every((i) => i < 2 * n)).toBe(true);
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertex(positions, indices[i] ?? NaN),
      b = vertex(positions, indices[i + 1] ?? NaN),
      c = vertex(positions, indices[i + 2] ?? NaN);
    expect(
      (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    ).toBeGreaterThan(0);
  }
  expect([...new Set(indices.slice(-6))].sort((a, b) => a - b)).toEqual([
    0,
    1,
    2 * n - 2,
    2 * n - 1,
  ]);
  expect(new Set(indices).size).toBe(2 * n);
});
test("tracks that would give broken geometry are refused", () => {
  const valid = square(10);
  const p = valid.centerline[0];
  if (p === undefined) throw new Error("Missing point");
  const broken = [
    { ...valid, centerline: valid.centerline.slice(0, 2) },
    { ...valid, width: 0 },
    { ...valid, width: NaN },
    {
      ...valid,
      centerline: [{ ...p, x: Infinity }, ...valid.centerline.slice(1)],
    },
    { ...valid, centerline: [p, ...valid.centerline] },
    { ...valid, centerline: [...valid.centerline, p] },
  ];
  for (const candidate of broken)
    expect(caughtError(() => ribbon(candidate))).toBeInstanceOf(Error);
});
