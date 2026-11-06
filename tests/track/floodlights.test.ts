import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import {
  floodMap,
  inWorld,
  layoutPoles,
  sampleFlood,
  type TrackPoint,
} from "../../apps/client/src/game/floodlights.ts";

const gltfToSdWorld = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, -1, 0),
);
const radius = 400;
const wall = 14;

function oval(): TrackPoint[] {
  const count = Math.round((2 * Math.PI * radius) / 2);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI;
    return {
      x: radius * Math.cos(angle) * 1.6,
      y: 3 * Math.sin(angle * 3),
      z: radius * Math.sin(angle),
      wallLeft: wall,
      wallRight: wall + (i % 400 < 200 ? 30 : 0),
    };
  });
}

function world(points: TrackPoint[]): THREE.Vector3[] {
  return points.map((p) =>
    new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(gltfToSdWorld),
  );
}

describe("floodlights", () => {
  test("every metre of the racing surface is lit evenly", () => {
    const points = oval();
    const poles = layoutPoles(points, null);
    const map = floodMap(world(points), inWorld(poles, gltfToSdWorld));
    const levels = world(points).map((p) => sampleFlood(map, p.x, p.y));
    expect(Math.min(...levels)).toBeGreaterThan(0.6);
    expect(Math.max(...levels)).toBeLessThan(1.7);
  });

  test("poles stand behind each side's wall, never in the run-off", () => {
    const points = oval();
    for (const pole of layoutPoles(points, null)) {
      const gaps = points.map((p) =>
        Math.hypot(p.x - pole.base.x, p.z - pole.base.z),
      );
      const gap = Math.min(...gaps);
      const point = points[gaps.indexOf(gap)];
      if (!point) throw new Error("no nearest point");
      const outside =
        Math.hypot(pole.base.x, pole.base.z) > Math.hypot(point.x, point.z);
      expect(gap).toBeGreaterThan(outside ? point.wallLeft : point.wallRight);
    }
  });

  test("pit straight poles move off the pit side to the far side", () => {
    const points = oval();
    const all = layoutPoles(points, null);
    const pitted = layoutPoles(points, { entry: 2400, exit: 300 });
    const start = points[0];
    if (!start) throw new Error("empty track");
    const near = (pole: { base: THREE.Vector3 }) =>
      Math.hypot(pole.base.x - start.x, pole.base.z - start.z) < 120;
    const outside = (pole: { base: THREE.Vector3 }) =>
      Math.hypot(pole.base.x, pole.base.z) > Math.hypot(start.x, start.z);
    const count = (poles: { base: THREE.Vector3 }[], left: boolean) =>
      poles.filter((pole) => near(pole) && outside(pole) === left).length;
    expect(count(all, true)).toBeGreaterThan(0);
    expect(count(pitted, true)).toBe(0);
    expect(count(pitted, false)).toBe(count(all, false) + count(all, true));
  });
});
