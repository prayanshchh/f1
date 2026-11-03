import * as THREE from "three";
import { describe, expect, test } from "vitest";
import {
  damageZone,
  newLook,
  partCount,
  tagDamageZones,
  updateLook,
} from "../../apps/client/src/game/car-damage.ts";

function wingStrip(): THREE.BufferGeometry {
  const columns = 40;
  const positions: number[] = [];
  for (let row = 0; row < 2; row++)
    for (let c = 0; c <= columns; c++)
      positions.push(-1 + (2 * c) / columns, 0.1, 2.3 + row * 0.4);
  const index: number[] = [];
  for (let c = 0; c < columns; c++) {
    const a = c;
    const b = c + 1;
    const d = columns + 1 + c;
    const e = d + 1;
    index.push(a, b, e, a, e, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      new Array((positions.length / 3) * 2).fill(0.5),
      2,
    ),
  );
  geometry.setIndex(index);
  return geometry;
}

function damageOf(parts: Record<number, number>): Float64Array {
  const damage = new Float64Array(partCount);
  for (const [part, value] of Object.entries(parts))
    damage[Number(part)] = value;
  return damage;
}

describe("visible car damage", () => {
  test("every triangle of a wing breaks away whole, with no shared corners", () => {
    const geometry = wingStrip();
    const before = geometry.getAttribute("position").count;
    expect(tagDamageZones(geometry)).toBe(true);
    const zones = geometry.getAttribute("damageZone");
    const index = geometry.getIndex();
    if (!index) throw new Error("tagging dropped the index");
    const seen = new Set<number>();
    for (let t = 0; t < index.count; t += 3) {
      const corner = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      const zone = zones.getX(corner[0] ?? 0);
      for (const v of corner) expect(zones.getX(v)).toBe(zone);
      seen.add(zone);
    }
    expect(seen).toEqual(
      new Set([damageZone.none, damageZone.wingLeft, damageZone.wingRight]),
    );
    const grown = geometry.getAttribute("position").count - before;
    expect(grown).toBeGreaterThan(0);
    expect(grown).toBeLessThanOrEqual(8);
    expect(geometry.getAttribute("uv").count).toBe(
      geometry.getAttribute("position").count,
    );
  });

  test("parts away from the wings are left alone", () => {
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 2);
    expect(tagDamageZones(geometry)).toBe(false);
  });

  test("a wing bends with damage, then breaks once and comes back after repair", () => {
    const look = newLook();
    const wingLeft = 0;
    const rearWing = 6;
    expect(updateLook(look, damageOf({ [wingLeft]: 0.1 }), 0)).toEqual([]);
    expect(updateLook(look, damageOf({ [wingLeft]: 0.4 }), 0)).toEqual([
      { part: "wingLeft", broke: false },
    ]);
    expect(look[0]).toBeGreaterThan(0);
    expect(look[3]).toBe(0);
    const broken = updateLook(
      look,
      damageOf({ [wingLeft]: 0.75, [rearWing]: 0.9 }),
      0,
    );
    expect(broken).toEqual([
      { part: "wingLeft", broke: true },
      { part: "rearWing", broke: true },
    ]);
    expect(
      updateLook(look, damageOf({ [wingLeft]: 0.8, [rearWing]: 0.9 }), 0),
    ).toEqual([]);
    updateLook(look, damageOf({}), 0);
    expect(Array.from(look.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
