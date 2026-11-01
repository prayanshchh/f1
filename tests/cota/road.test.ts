import { readFileSync } from "node:fs";
import path from "node:path";
import type { Accessor } from "@gltf-transform/core";
import { describe, expect, test } from "vitest";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

interface Point {
  x: number;
  y: number;
  z: number;
  width: number;
  camber: number;
}

const directory = path.join(repoRoot, "content/tracks/cota");
const roadFile = path.join(directory, "road.glb");
const lfsPointer = readFileSync(roadFile)
  .subarray(0, 40)
  .toString("latin1")
  .startsWith("version https://git-lfs");
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
) as { centerline: Point[] };

async function roadPositions(): Promise<{ rows: number; at: Accessor }> {
  const document = await readModel(roadFile);
  const mesh = document
    .getRoot()
    .listMeshes()
    .find((m) => m.getName() === "road");
  const position = mesh?.listPrimitives()[0]?.getAttribute("POSITION");
  if (!position) throw new Error("road.glb has no road mesh");
  return { rows: track.centerline.length * 2, at: position };
}

describe.skipIf(lfsPointer)("COTA road.glb", () => {
  test("is built from the current track.json and matches the physics surface", async () => {
    const { rows, at } = await roadPositions();
    const columns = at.getCount() / rows;
    expect(Number.isInteger(columns)).toBe(true);
    const v = [0, 0, 0];
    const vertex = (row: number, column: number) => {
      at.getElement(row * columns + column, v);
      return { x: v[0] ?? 0, h: v[1] ?? 0, z: v[2] ?? 0 };
    };
    for (let i = 0; i < track.centerline.length; i += 7) {
      const p = track.centerline[i];
      if (!p) continue;
      const left = vertex(2 * i, columns - 1);
      const right = vertex(2 * i, 0);
      const half = p.width / 2;
      expect(Math.hypot(left.x - p.x, left.z - p.z)).toBeCloseTo(half, 1);
      expect(Math.hypot(right.x - p.x, right.z - p.z)).toBeCloseTo(half, 1);
      const edge = half * p.camber;
      expect(left.h).toBeCloseTo(p.y + edge, 2);
      expect(right.h).toBeCloseTo(p.y - edge, 2);
    }
  });
});
