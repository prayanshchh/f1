import { readFileSync } from "node:fs";
import path from "node:path";
import { getBounds, type Document } from "@gltf-transform/core";
import { describe, expect, test } from "vitest";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

const carFile = path.join(repoRoot, "content/cars/vanta-26/car.glb");
const lfsPointer = readFileSync(carFile)
  .subarray(0, 40)
  .toString("latin1")
  .startsWith("version https://git-lfs");
const corners = ["fl", "fr", "rl", "rr"];
const maxWheelbase = 3.4;
const maxWidth = 1.9;
const widthTolerance = 0.005;

function node(document: Document, name: string) {
  const found = document
    .getRoot()
    .listNodes()
    .find((candidate) => candidate.getName() === name);
  if (!found) throw new Error(`car.glb has no node ${name}`);
  return found;
}

describe.skipIf(lfsPointer)("2026 car model", () => {
  test("has every node the game animates", async () => {
    const document = await readModel(carFile);
    for (const corner of corners) {
      expect(node(document, `wheel-${corner}`).getMesh()).toBeNull();
      expect(node(document, `wheel-${corner}-spin`).getMesh()).not.toBeNull();
      expect(node(document, `wheel-${corner}-upright`).getParentNode()).toBe(
        node(document, `wheel-${corner}`),
      );
    }
    expect(node(document, "steering-wheel").getMesh()).not.toBeNull();
    expect(node(document, "driver-head").getMesh()).not.toBeNull();
  });

  test("keeps the materials the game shades by name", async () => {
    const document = await readModel(carFile);
    const names = document
      .getRoot()
      .listMaterials()
      .map((material) => material.getName());
    expect(names).toEqual(
      expect.arrayContaining([
        "body",
        "cockpit",
        "helmet",
        "tyre",
        "wheel-screen",
        "mirror-l",
        "mirror-r",
        "wheel-face",
        "glove",
        "void",
      ]),
    );
  });

  test("fits the 2026 wheelbase and width limits", async () => {
    const document = await readModel(carFile);
    const forward = (corner: string) =>
      node(document, `wheel-${corner}`).getTranslation()[2];
    expect(forward("fl")).toBeCloseTo(forward("fr"), 5);
    expect(forward("rl")).toBeCloseTo(forward("rr"), 5);
    expect(forward("fl") - forward("rl")).toBeCloseTo(maxWheelbase, 3);
    const scene = document.getRoot().getDefaultScene();
    if (!scene) throw new Error("car.glb has no default scene");
    const { min, max } = getBounds(scene);
    expect(max[0] - min[0]).toBeLessThanOrEqual(maxWidth + widthTolerance);
    expect(min[1]).toBeGreaterThan(-0.01);
    expect(min[1]).toBeLessThan(0.05);
  });
});
