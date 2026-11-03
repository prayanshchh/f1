import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import {
  CulledForest,
  CulledMesh,
  type SphereTest,
} from "../../apps/client/src/game/world-culler.ts";

const cellSize = 200;
const columns = 10;

function strip(): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < columns; i++) {
    const x = i * cellSize + 50;
    const base = positions.length / 3;
    positions.push(x, 0, 10, x + 40, 0, 10, x, 0, 50, x + 40, 0, 50);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  return new THREE.Mesh(geometry);
}

const seenBelow = (limit: number): SphereTest => ({
  intersectsSphere: (sphere) => sphere.center.x < limit,
});

const indexOf = (mesh: THREE.Mesh) =>
  Array.from((mesh.geometry.index as THREE.BufferAttribute).array);

describe("world culler in-place mode", () => {
  test("collapses hidden triangles and keeps visible ones at their original offsets", () => {
    const mesh = strip();
    const original = indexOf(mesh);
    const culled = new CulledMesh(mesh, cellSize, true);
    culled.update(seenBelow(1000));
    const now = indexOf(mesh);
    expect(now).toHaveLength(original.length);
    now.forEach((vertex, i) => {
      const column = Math.floor(i / 6);
      expect(vertex).toBe(column * cellSize + 50 < 1000 ? original[i] : 0);
    });
  });

  test("restores the exact original index when a cell returns to view", () => {
    const mesh = strip();
    const original = indexOf(mesh);
    const culled = new CulledMesh(mesh, cellSize, true);
    culled.update(seenBelow(600));
    culled.update(seenBelow(Infinity));
    expect(indexOf(mesh)).toEqual(original);
    expect(mesh.geometry.drawRange.count).toBe(original.length);
  });

  test("trims only collapsed triangles after the last visible one", () => {
    const mesh = strip();
    const culled = new CulledMesh(mesh, cellSize, true);
    culled.update(seenBelow(500));
    expect(mesh.geometry.drawRange.start).toBe(0);
    expect(mesh.geometry.drawRange.count).toBe(3 * 6);
  });

  test("hides the mesh when nothing is in view", () => {
    const mesh = strip();
    const culled = new CulledMesh(mesh, cellSize, true);
    culled.update(seenBelow(-1));
    expect(mesh.visible).toBe(false);
    culled.update(seenBelow(Infinity));
    expect(mesh.visible).toBe(true);
  });

  test("keeps a triangle in view through any of its corners, not just its centre", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 10, 0, 0, 0, 0, 10, 5000, 0, 0, 5010, 0, 0, 900, 0, 10],
        3,
      ),
    );
    geometry.setIndex(new THREE.Uint32BufferAttribute([0, 1, 2, 3, 4, 5], 1));
    const mesh = new THREE.Mesh(geometry);
    const culled = new CulledMesh(mesh, cellSize, true);
    const corner = new THREE.Vector3(900, 0, 10);
    culled.update({
      intersectsSphere: (sphere) => sphere.containsPoint(corner),
    });
    expect(indexOf(mesh).slice(3)).toEqual([3, 4, 5]);
  });
});

describe("world culler compact mode", () => {
  test("keeps only visible triangles in their original order", () => {
    const mesh = strip();
    const original = indexOf(mesh);
    const culled = new CulledMesh(mesh, cellSize, false);
    culled.update(seenBelow(500));
    const count = mesh.geometry.drawRange.count;
    expect(count).toBe(3 * 6);
    expect(indexOf(mesh).slice(0, count)).toEqual(original.slice(0, count));
  });
});

describe("world culler uploads", () => {
  test("only uploads ranges WebGPU accepts for 16-bit indices", () => {
    const mesh = strip();
    const wide = indexOf(mesh);
    mesh.geometry.setIndex(new THREE.Uint16BufferAttribute(wide, 1));
    const culled = new CulledMesh(mesh, cellSize, true);
    culled.update(seenBelow(450));
    const index = mesh.geometry.index as THREE.BufferAttribute;
    expect(index.updateRanges.length).toBeGreaterThan(0);
    for (const range of index.updateRanges) {
      expect((range.start * 2) % 4).toBe(0);
      expect((range.count * 2) % 4).toBe(0);
    }
  });
});

describe("world culler forest", () => {
  function forest(): THREE.InstancedMesh {
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.computeBoundingSphere();
    const mesh = new THREE.InstancedMesh(geometry, undefined, columns);
    for (let i = 0; i < columns; i++)
      mesh.setMatrixAt(
        i,
        new THREE.Matrix4().makeTranslation(i * cellSize + 100, 0, 100),
      );
    return mesh;
  }

  test("zeroes hidden trees in place so later trees keep their slots", () => {
    const mesh = forest();
    const original = Array.from(mesh.instanceMatrix.array);
    const culled = new CulledForest(mesh);
    culled.update({
      intersectsSphere: (sphere) =>
        sphere.center.x < 400 || sphere.center.x > 1500,
    });
    const now = Array.from(mesh.instanceMatrix.array);
    expect(now.slice(0, 32)).toEqual(original.slice(0, 32));
    expect(now.slice(32, 48).every((value) => value === 0)).toBe(true);
    expect(now.slice(16 * 9, 16 * 10)).toEqual(original.slice(16 * 9, 16 * 10));
    expect(mesh.count).toBe(columns);
  });

  test("restores every tree and trims trailing hidden ones", () => {
    const mesh = forest();
    const original = Array.from(mesh.instanceMatrix.array);
    const culled = new CulledForest(mesh);
    culled.update({ intersectsSphere: (sphere) => sphere.center.x < 500 });
    expect(mesh.count).toBe(2);
    culled.update({ intersectsSphere: () => true });
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(original);
    expect(mesh.count).toBe(columns);
  });
});
