import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { repoRoot, run } from "../support/repo.ts";

interface Point {
  x: number;
  y: number;
  z: number;
  width: number;
  camber: number;
  wallLeft: number;
  wallRight: number;
}

interface Track {
  length: number;
  width: number;
  centerline: Point[];
  surfaces: { kind: string; side: string; from: number; to: number }[];
  pitLane: { entry: number; exit: number };
  sectors: number[];
  grid: { distance: number }[];
}

const directory = path.join(repoRoot, "content/tracks/cota");
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
) as Track;
const points = track.centerline;
const n = points.length;
const at = (i: number): Point => {
  const p = points[((i % n) + n) % n];
  if (p === undefined) throw new Error(`no point ${String(i)}`);
  return p;
};
const step = track.length / n;

function heading(i: number): number {
  const a = at(i);
  const b = at(i + 1);
  return Math.atan2(-(b.z - a.z), b.x - a.x);
}

function curvature(i: number): number {
  const d = heading(i) - heading(i - 1);
  return Math.atan2(Math.sin(d), Math.cos(d)) / step;
}

function smoothed(i: number, radius: number): number {
  let sum = 0;
  for (let k = -radius; k <= radius; k++) sum += curvature(i + k);
  return sum / (2 * radius + 1);
}

describe("COTA track.json", () => {
  test("is a closed loop with the published Grand Prix length", () => {
    const gap = Math.hypot(at(n - 1).x - at(0).x, at(n - 1).z - at(0).z);
    expect(gap).toBeGreaterThan(step * 0.9);
    expect(gap).toBeLessThan(step * 1.1);
    expect(Math.abs(track.length - 5513) / 5513).toBeLessThan(0.005);
  });

  test("has no corner kinks", () => {
    let worst = 0;
    for (let i = 0; i < n; i++)
      worst = Math.max(
        worst,
        Math.abs(smoothed(i + 1, 2) - smoothed(i, 2)) / step,
      );
    expect(worst).toBeLessThan(0.02);
  });

  test("never folds its inner edge or wall", () => {
    for (let i = 0; i < n; i++) {
      const k = Math.abs(smoothed(i, 2));
      const p = at(i);
      expect(k * (p.width / 2)).toBeLessThan(1);
      const inner = smoothed(i, 2) > 0 ? p.wallLeft : p.wallRight;
      expect(k * inner).toBeLessThan(1);
    }
  });

  test("keeps walls outside the asphalt and widths plausible", () => {
    for (const p of points) {
      expect(p.width).toBeGreaterThan(11);
      expect(p.width).toBeLessThan(35);
      expect(Math.abs(p.camber)).toBeLessThanOrEqual(0.07);
      expect(p.wallLeft).toBeGreaterThan(p.width / 2);
      expect(p.wallRight).toBeGreaterThan(p.width / 2);
    }
  });

  test("keeps every lap distance inside the lap", () => {
    const distances = [
      ...track.surfaces.flatMap((s) => [s.from, s.to]),
      ...track.sectors,
      track.pitLane.entry,
      track.pitLane.exit,
      ...track.grid.map((g) => g.distance),
    ];
    for (const d of distances) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(track.length);
    }
    expect([...track.sectors].sort((a, b) => a - b)).toEqual(track.sectors);
  });
});

describe("COTA Speed Dreams track", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "cota-"));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("cota.xml and sd-frame.json are generated from the current track.json", () => {
    copyFileSync(
      path.join(directory, "track.json"),
      path.join(scratch, "track.json"),
    );
    const result = run("node", ["tools/sd-track.mjs", scratch]);
    expect(result.code, result.output).toBe(0);
    for (const file of ["cota.xml", "sd-frame.json"])
      expect(readFileSync(path.join(scratch, file), "utf8")).toBe(
        readFileSync(path.join(directory, file), "utf8"),
      );
  });
});
