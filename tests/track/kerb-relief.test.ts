import { readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three/webgpu";
import { beforeAll, describe, expect, test } from "vitest";
import {
  builtPoint,
  kerbRows,
  readRows,
  reliefKerbs,
} from "../../apps/client/src/game/kerb-relief.ts";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

const roadFile = path.join(repoRoot, "content/tracks/hill-country/road.glb");
const lfsPointer = readFileSync(roadFile)
  .subarray(0, 40)
  .toString("latin1")
  .startsWith("version https://git-lfs");
const physicsKerbTop = 0.028;
const up = new THREE.Vector3(0, 1, 0);

async function shippedKerbs(): Promise<THREE.BufferGeometry> {
  const document = await readModel(roadFile);
  const primitive = document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .find((p) => p.getMaterial()?.getName() === "track road kerb");
  const position = primitive?.getAttribute("POSITION")?.getArray();
  const uv = primitive?.getAttribute("TEXCOORD_0")?.getArray();
  const index = primitive?.getIndices()?.getArray();
  if (!position || !uv || !index) throw new Error("road.glb has no kerbs");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(Float32Array.from(position), 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.BufferAttribute(Float32Array.from(uv), 2),
  );
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(index), 1));
  return geometry;
}

type Row = ReturnType<typeof kerbRows>["rows"][number];

function rowLookup(rows: Row[]) {
  const byAlong = new Map<number, Row[]>();
  for (const row of rows) {
    const key = Math.round(row.along * 100);
    byAlong.set(key, [...(byAlong.get(key) ?? []), row]);
  }
  const at = new THREE.Vector3();
  return (geometry: THREE.BufferGeometry, i: number): Row | null => {
    const uv = geometry.getAttribute("uv");
    at.fromBufferAttribute(geometry.getAttribute("position"), i);
    const near = byAlong.get(Math.round(uv.getY(i) * 100)) ?? [];
    let best: Row | null = null;
    for (const row of near)
      if (!best || row.inner.distanceTo(at) < best.inner.distanceTo(at))
        best = row;
    return best;
  };
}

function lateralOf(row: Row): THREE.Vector3 {
  return new THREE.Vector3()
    .subVectors(row.outer, row.inner)
    .projectOnPlane(up)
    .normalize();
}

describe.skipIf(lfsPointer)("Hill Country kerbs", () => {
  let built: THREE.BufferGeometry;
  let relief: THREE.BufferGeometry;

  beforeAll(async () => {
    built = await shippedKerbs();
    relief = reliefKerbs(built);
  });

  test("every shipped kerb vertex is understood, so no kerb goes missing", () => {
    const { rowOf } = readRows(built);
    expect(rowOf.every((row) => row >= 0)).toBe(true);
    const { rows, built: points, pairs } = kerbRows(built);
    expect(pairs.length).toBeGreaterThan(rows.length * 0.95);
    let worst = 0;
    rows.forEach((row, r) => {
      points[r]?.points.forEach((p, column) => {
        if (p) worst = Math.max(worst, builtPoint(row, column).distanceTo(p));
      });
    });
    expect(worst).toBeLessThan(0.001);
  });

  test("the raised kerb is never taller than the kerb the physics drives on", () => {
    const rowOf = rowLookup(kerbRows(built).rows);
    const position = relief.getAttribute("position");
    const uv = relief.getAttribute("uv");
    let tallest = 0;
    for (let i = 0; i < position.count; i++) {
      const row = rowOf(relief, i);
      if (!row) continue;
      const base = row.inner.y + (row.outer.y - row.inner.y) * uv.getX(i);
      tallest = Math.max(tallest, position.getY(i) - base);
    }
    expect(tallest).toBeLessThanOrEqual(physicsKerbTop + 0.001);
    expect(tallest).toBeGreaterThan(physicsKerbTop - 0.006);
  });

  test("lit faces point the right way: top up, lip at the track, edge outward", () => {
    const rowOf = rowLookup(kerbRows(built).rows);
    const normal = relief.getAttribute("normal");
    const uv = relief.getAttribute("uv");
    const n = new THREE.Vector3();
    const wrong = { top: 0, lip: 0, face: 0 };
    const part = (across: number) => {
      if (across > 1) return "face";
      if (across === 0) return "lip";
      return across > 0.1 && across < 0.9 ? "top" : null;
    };
    const facesRight = {
      face: (lateral: THREE.Vector3) => n.dot(lateral) >= 0.5,
      lip: (lateral: THREE.Vector3) => n.dot(lateral) <= 0 && n.y >= 0,
      top: () => n.y >= 0.9,
    };
    for (let i = 0; i < normal.count; i++) {
      const kind = part(uv.getX(i));
      const row = rowOf(relief, i);
      if (!kind || !row) continue;
      n.fromBufferAttribute(normal, i);
      if (!facesRight[kind](lateralOf(row))) wrong[kind]++;
    }
    expect(wrong).toEqual({ top: 0, lip: 0, face: 0 });
  });

  test("the outer edge reaches under the run-off so no gap shows beneath it", () => {
    const rowOf = rowLookup(kerbRows(built).rows);
    const position = relief.getAttribute("position");
    const uv = relief.getAttribute("uv");
    let highestFoot = -Infinity;
    for (let i = 0; i < position.count; i++) {
      if (uv.getX(i) <= 1.01) continue;
      const row = rowOf(relief, i);
      if (row)
        highestFoot = Math.max(highestFoot, position.getY(i) - row.outer.y);
    }
    expect(highestFoot).toBeLessThan(0);
  });
});
