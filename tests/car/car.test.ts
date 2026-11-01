import { readFileSync } from "node:fs";
import path from "node:path";
import { getBounds, type Document } from "@gltf-transform/core";
import { describe, expect, test } from "vitest";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

interface Team {
  id: string;
  name: string;
  number: string;
  colours: { primary: string; secondary: string };
  sponsors: string[];
}

const carsDirectory = path.join(repoRoot, "content/cars");
const teams = JSON.parse(
  readFileSync(path.join(carsDirectory, "teams.json"), "utf8"),
) as Team[];
const track = JSON.parse(
  readFileSync(path.join(repoRoot, "content/tracks/cota/track.json"), "utf8"),
) as { grid: unknown[] };
const carsPerTeam = 2;
const corners = ["fl", "fr", "rl", "rr"];
const maxWheelbase = 3.4;
const maxWidth = 1.9;
const widthTolerance = 0.005;
const maxLodTriangles = 60_000;

function modelFile(team: string, file: string): string {
  return path.join(carsDirectory, team, file);
}

function isPointer(file: string): boolean {
  return readFileSync(file)
    .subarray(0, 40)
    .toString("latin1")
    .startsWith("version https://git-lfs");
}

function node(document: Document, name: string) {
  const found = document
    .getRoot()
    .listNodes()
    .find((candidate) => candidate.getName() === name);
  if (!found) throw new Error(`car model has no node ${name}`);
  return found;
}

describe("teams", () => {
  test("fill every painted grid slot with two cars per team", () => {
    expect(teams.length * carsPerTeam).toBe(track.grid.length);
  });

  test("have their own identity", () => {
    for (const field of [
      (team: Team) => team.id,
      (team: Team) => team.name,
      (team: Team) => team.number,
      (team: Team) => team.colours.primary,
    ])
      expect(new Set(teams.map(field)).size).toBe(teams.length);
    const sponsors = teams.flatMap((team) => team.sponsors);
    expect(new Set(sponsors).size).toBe(sponsors.length);
  });
});

describe.each(teams)("$name car", ({ id }) => {
  const car = modelFile(id, "car.glb");
  const lod = modelFile(id, "lod.glb");

  test.skipIf(isPointer(car))("has every node the game animates", async () => {
    const document = await readModel(car);
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

  test.skipIf(isPointer(car))(
    "keeps the materials the game shades by name",
    async () => {
      const document = await readModel(car);
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
    },
  );

  test.skipIf(isPointer(car))(
    "fits the 2026 wheelbase and width limits",
    async () => {
      const document = await readModel(car);
      const forward = (corner: string) =>
        node(document, `wheel-${corner}`).getTranslation()[2];
      expect(forward("fl")).toBeCloseTo(forward("fr"), 5);
      expect(forward("rl")).toBeCloseTo(forward("rr"), 5);
      expect(forward("fl") - forward("rl")).toBeCloseTo(maxWheelbase, 3);
      const scene = document.getRoot().getDefaultScene();
      if (!scene) throw new Error("car model has no default scene");
      const { min, max } = getBounds(scene);
      expect(max[0] - min[0]).toBeLessThanOrEqual(maxWidth + widthTolerance);
      expect(min[1]).toBeGreaterThan(-0.01);
      expect(min[1]).toBeLessThan(0.05);
    },
  );

  test.skipIf(isPointer(lod))("has a light grid model", async () => {
    const document = await readModel(lod);
    const triangles = document
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce(
        (sum, primitive) =>
          sum +
          (primitive.getIndices()?.getCount() ??
            primitive.getAttribute("POSITION")?.getCount() ??
            0) /
            3,
        0,
      );
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThan(maxLodTriangles);
  });
});
