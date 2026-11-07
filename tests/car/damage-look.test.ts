import * as THREE from "three";
import { describe, expect, test } from "vitest";
import {
  type LookChange,
  newLook,
  partCount,
  partIndex,
  tagDamageZones,
  updateLook,
  zoneId,
} from "../../apps/client/src/game/car-damage.ts";
import { DamageLog } from "../../apps/client/src/game/damage-log.ts";

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
      new Set([
        zoneId["wingOuterLeft"],
        zoneId["wingInnerLeft"],
        zoneId["wingCentre"],
        zoneId["wingInnerRight"],
        zoneId["wingOuterRight"],
      ]),
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
    const wing = (changes: LookChange[], kind: LookChange["kind"]) =>
      changes
        .filter((change) => change.kind === kind)
        .map((change) => change.zone)
        .sort((a, b) => a - b);
    const outer = zoneId["wingOuterLeft"] ?? -1;
    const inner = zoneId["wingInnerLeft"] ?? -1;
    const flap = zoneId["rearFlap"] ?? -1;
    const main = zoneId["rearMain"] ?? -1;
    expect(
      updateLook(look, damageOf({ [partIndex.wingLeft]: 0.1 }), 0),
    ).toEqual([]);
    const bent = updateLook(look, damageOf({ [partIndex.wingLeft]: 0.4 }), 0);
    expect(wing(bent, "bend")).toEqual([outer, inner]);
    expect(wing(bent, "break")).toEqual([]);
    expect(look[outer - 1]).toBeGreaterThan(0);
    expect(look[(zoneId["wingOuterRight"] ?? 0) - 1]).toBe(0);
    const broken = updateLook(
      look,
      damageOf({ [partIndex.wingLeft]: 0.75, [partIndex.rearWing]: 0.9 }),
      0,
    );
    expect(wing(broken, "break")).toEqual(
      [outer, inner, flap, main].sort((a, b) => a - b),
    );
    const again = updateLook(
      look,
      damageOf({ [partIndex.wingLeft]: 0.8, [partIndex.rearWing]: 0.9 }),
      0,
    );
    expect(wing(again, "break")).toEqual([]);
    expect(updateLook(look, damageOf({}), 0)).toEqual([]);
    expect(Array.from(look)).toEqual(new Array(look.length).fill(0));
  });

  test("the replay shows each car's damage as it was at that moment, and a flashback forgets the crash", () => {
    const log = new DamageLog();
    const stride = 2;
    const at = (car: number, time: number) =>
      Array.from(log.partsAt(car, time) ?? new Float32Array(stride));
    log.record(1, [0, 0, 0, 0], stride);
    log.record(5, [0.8, 0, 0, 0.3], stride);
    log.record(6, [0.8, 0, 0, 0.3], stride);
    expect(at(0, 3)).toEqual([0, 0]);
    expect(at(0, 7)).toEqual([Math.fround(0.8), 0]);
    expect(at(1, 7)).toEqual([0, Math.fround(0.3)]);
    log.cut(4);
    expect(at(0, 7)).toEqual([0, 0]);
  });
});
