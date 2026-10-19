import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Document, Node } from "@gltf-transform/core";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, test } from "vitest";
import {
  paintLivery,
  parseLivery,
  type Livery,
} from "../../apps/client/src/livery/index.ts";
import { assetBudgets, tiers } from "../support/asset-budgets.ts";
import { caughtError } from "../f1/support/sim.ts";
import {
  nodeBounds,
  readGlb,
  readModel,
  sceneBounds,
  sceneNodes,
  triangleCount,
} from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

interface CarManifest {
  id: string;
  name: string;
  lods: string[];
  liveryMask: string;
  liveries: string[];
}

const carsDirectory = path.join(repoRoot, "content/cars");

function carDirectories(): string[] {
  return readdirSync(carsDirectory)
    .filter((entry) => statSync(path.join(carsDirectory, entry)).isDirectory())
    .sort();
}

function manifestOf(id: string): CarManifest {
  return JSON.parse(
    readFileSync(path.join(carsDirectory, id, "car.json"), "utf8"),
  ) as CarManifest;
}

const trademarks = [
  "ferrari",
  "mercedes",
  "red bull",
  "redbull",
  "mclaren",
  "aston martin",
  "alpine",
  "williams",
  "haas",
  "sauber",
  "audi",
  "cadillac",
  "racing bulls",
  "visa",
  "petronas",
  "oracle",
  "aramco",
  "shell",
  "santander",
  "pirelli",
  "rolex",
  "heineken",
  "dhl",
  "formula 1",
  "formula one",
  "fia",
];

function expectNoTrademarks(text: string, label: string): void {
  const lower = text.toLowerCase();
  for (const mark of trademarks) {
    expect(
      new RegExp(`\\b${mark}\\b`).test(lower),
      `${label} must not mention ${mark}`,
    ).toBe(false);
  }
}

interface LoadedCar {
  id: string;
  manifest: CarManifest;
  lods: Document[];
}

const cars: LoadedCar[] = [];

beforeAll(async () => {
  for (const id of carDirectories()) {
    const manifest = manifestOf(id);
    const lods: Document[] = [];
    for (const file of manifest.lods) {
      lods.push(await readModel(path.join(carsDirectory, id, file)));
    }
    cars.push({ id, manifest, lods });
  }
});

function named(document: Document, name: string): Node {
  const matches = sceneNodes(document).filter(
    (node) => node.getName() === name,
  );
  expect(
    matches.map((node) => node.getName()),
    `exactly one node named ${name}`,
  ).toEqual([name]);
  const [node] = matches;
  if (node === undefined) {
    throw new Error(`no node named ${name}`);
  }
  return node;
}

function centre(bounds: {
  min: ArrayLike<number>;
  max: ArrayLike<number>;
}): number[] {
  return [0, 1, 2].map(
    (axis) => ((bounds.min[axis] ?? 0) + (bounds.max[axis] ?? 0)) / 2,
  );
}

function extent(
  bounds: { min: ArrayLike<number>; max: ArrayLike<number> },
  axis: number,
): number {
  return (bounds.max[axis] ?? 0) - (bounds.min[axis] ?? 0);
}

function inside(
  inner: { min: ArrayLike<number>; max: ArrayLike<number> },
  outer: { min: ArrayLike<number>; max: ArrayLike<number> },
  slack = 0.005,
): boolean {
  return [0, 1, 2].every(
    (axis) =>
      (inner.min[axis] ?? 0) >= (outer.min[axis] ?? 0) - slack &&
      (inner.max[axis] ?? 0) <= (outer.max[axis] ?? 0) + slack,
  );
}

test("there is at least one original car with a strict manifest", () => {
  const ids = carDirectories();
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const manifest = manifestOf(id);
    expect(Object.keys(manifest).sort()).toEqual([
      "id",
      "liveries",
      "liveryMask",
      "lods",
      "name",
    ]);
    expect(manifest.id).toBe(id);
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.name.trim()).not.toBe("");
    expectNoTrademarks(manifest.name, `${id} name`);
    expect(manifest.lods).toHaveLength(assetBudgets.lodCount.car);
    for (const file of [
      ...manifest.lods,
      manifest.liveryMask,
      ...manifest.liveries,
    ]) {
      expect(
        existsSync(path.join(carsDirectory, id, file)),
        `${id}/${file}`,
      ).toBe(true);
    }
  }
});

test("each detail level fits its tier's triangle budget and halves the previous one", () => {
  for (const car of cars) {
    const counts = car.lods.map((document) => triangleCount(document));
    expect(
      counts[0],
      `${car.id} lod0 must be a detailed hero model`,
    ).toBeGreaterThanOrEqual(50_000);
    for (const [level, count] of counts.entries()) {
      const tier = tiers[level];
      if (tier === undefined) {
        throw new Error("more levels than tiers");
      }
      expect(
        count,
        `${car.id} lod${String(level)} on ${tier}`,
      ).toBeLessThanOrEqual(assetBudgets.tiers[tier].triangles.car);
      if (level > 0) {
        const previous = counts[level - 1] ?? 0;
        expect(count).toBeLessThanOrEqual(previous * 0.5);
        expect(
          count,
          "a detail level must still be a car",
        ).toBeGreaterThanOrEqual(previous * 0.15);
      }
    }
    expect(counts.at(-1)).toBeLessThanOrEqual(
      assetBudgets.tiers.basic.triangles.car,
    );
  }
});

test("the source files fit the ultra byte budget and use power-of-two textures", () => {
  for (const car of cars) {
    const files = [...car.manifest.lods, car.manifest.liveryMask];
    const bytes = files.reduce(
      (total, file) =>
        total + statSync(path.join(carsDirectory, car.id, file)).size,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(assetBudgets.tiers.ultra.bytes.car);
    for (const document of car.lods) {
      for (const texture of document.getRoot().listTextures()) {
        const size = texture.getSize();
        expect(size, `${car.id} texture ${texture.getName()}`).not.toBeNull();
        for (const side of size ?? []) {
          expect(
            Math.log2(side) % 1,
            `${car.id} texture side ${String(side)}`,
          ).toBe(0);
          expect(side).toBeLessThanOrEqual(
            assetBudgets.tiers.ultra.maxTextureSize,
          );
        }
      }
    }
  }
});

test("the glTF data names no real teams, sponsors or series", () => {
  for (const car of cars) {
    for (const file of car.manifest.lods) {
      expectNoTrademarks(
        JSON.stringify(readGlb(path.join(carsDirectory, car.id, file)).json),
        `${car.id}/${file}`,
      );
    }
    for (const file of car.manifest.liveries) {
      expectNoTrademarks(
        readFileSync(path.join(carsDirectory, car.id, file), "utf8"),
        `${car.id}/${file}`,
      );
    }
  }
});

describe("the car follows the 2026 proportions with +Y up, +Z forward and +X left", () => {
  test("overall size sits on the ground and is centred left to right", () => {
    for (const car of cars) {
      const bounds = sceneBounds(car.lods[0] ?? fail());
      expect(extent(bounds, 2), `${car.id} length`).toBeGreaterThanOrEqual(5.0);
      expect(extent(bounds, 2)).toBeLessThanOrEqual(5.5);
      expect(extent(bounds, 0), `${car.id} width`).toBeGreaterThanOrEqual(1.85);
      expect(extent(bounds, 0)).toBeLessThanOrEqual(2.0);
      expect(extent(bounds, 1), `${car.id} height`).toBeGreaterThanOrEqual(
        0.85,
      );
      expect(extent(bounds, 1)).toBeLessThanOrEqual(1.0);
      expect(Math.abs(bounds.min[1])).toBeLessThanOrEqual(0.01);
      expect(Math.abs(centre(bounds)[0] ?? 1)).toBeLessThanOrEqual(0.01);
    }
  });

  test("every detail level has four separate wheels at the corners", () => {
    for (const car of cars) {
      for (const [level, document] of car.lods.entries()) {
        const label = `${car.id} lod${String(level)}`;
        const [fl, fr, rl, rr] = wheelPositions(document);
        expect(fl[0] > 0 && fl[2] > 0, `${label}: front left is +X +Z`).toBe(
          true,
        );
        expect(fr[0] < 0 && fr[2] > 0, `${label}: front right is -X +Z`).toBe(
          true,
        );
        expect(rl[0] > 0 && rl[2] < 0, `${label}: rear left is +X -Z`).toBe(
          true,
        );
        expect(rr[0] < 0 && rr[2] < 0, `${label}: rear right is -X -Z`).toBe(
          true,
        );
        const wheelbase = (fl[2] + fr[2] - rl[2] - rr[2]) / 2;
        expect(wheelbase, `${label} wheelbase`).toBeGreaterThanOrEqual(3.0);
        expect(wheelbase).toBeLessThanOrEqual(3.4);
        expect(fl[0], `${label} front track`).toBeGreaterThanOrEqual(0.7);
        expect(fl[0]).toBeLessThanOrEqual(0.85);
        expect(Math.abs(fl[0] + fr[0])).toBeLessThanOrEqual(0.001);
        expect(Math.abs(rl[0] + rr[0])).toBeLessThanOrEqual(0.001);
      }
    }
  });

  test("wheels are 18-inch rims with tyres, centred on their nodes and touching the ground", () => {
    for (const car of cars) {
      for (const [level, document] of car.lods.entries()) {
        for (const name of ["wheel-fl", "wheel-fr", "wheel-rl", "wheel-rr"]) {
          const label = `${car.id} lod${String(level)} ${name}`;
          const node = named(document, name);
          expect(
            node.listChildren().length > 0 || node.getMesh() !== null,
            `${label} has geometry`,
          ).toBe(true);
          const bounds = nodeBounds(node);
          const radius = extent(bounds, 1) / 2;
          expect(radius, `${label} radius`).toBeGreaterThanOrEqual(0.34);
          expect(radius).toBeLessThanOrEqual(0.37);
          const origin = node.getWorldTranslation();
          const middle = centre(bounds);
          for (const axis of [0, 1, 2]) {
            expect(
              Math.abs((middle[axis] ?? 0) - (origin[axis] ?? 0)),
              `${label} centred on axis ${String(axis)}`,
            ).toBeLessThanOrEqual(0.005);
          }
          expect(
            Math.abs(origin[1] - radius),
            `${label} touches the ground`,
          ).toBeLessThanOrEqual(0.005);
        }
      }
    }
  });

  test("the driver's eye sits in the cockpit between the axles", () => {
    for (const car of cars) {
      for (const [level, document] of car.lods.entries()) {
        const label = `${car.id} lod${String(level)}`;
        const eye = named(document, "eye");
        expect(
          eye.getMesh(),
          `${label} eye is a marker, not geometry`,
        ).toBeNull();
        const [x, y, z] = eye.getWorldTranslation();
        const front = named(document, "wheel-fl").getWorldTranslation()[2];
        const rear = named(document, "wheel-rl").getWorldTranslation()[2];
        expect(Math.abs(x), label).toBeLessThanOrEqual(0.02);
        expect(y, label).toBeGreaterThanOrEqual(0.6);
        expect(y, label).toBeLessThanOrEqual(1.0);
        expect(z > rear && z < front, `${label} eye between the axles`).toBe(
          true,
        );
      }
    }
  });

  test("the two most detailed levels model the cockpit and steering wheel inside the body", () => {
    for (const car of cars) {
      for (const document of car.lods.slice(0, 2)) {
        const body = nodeBounds(named(document, "body"));
        const cockpit = nodeBounds(named(document, "cockpit"));
        const wheel = nodeBounds(named(document, "steering-wheel"));
        const eye = named(document, "eye").getWorldTranslation();
        expect(triangleCount(document)).toBeGreaterThan(0);
        expect(inside(cockpit, body), `${car.id} cockpit inside the body`).toBe(
          true,
        );
        expect(
          inside(wheel, cockpit),
          `${car.id} steering wheel inside the cockpit`,
        ).toBe(true);
        expect(
          wheel.max[2],
          "the steering wheel is ahead of the eye",
        ).toBeGreaterThan(eye[2]);
        expect(
          extent(wheel, 0),
          "a steering wheel is about 25 to 32 cm wide",
        ).toBeGreaterThanOrEqual(0.25);
        expect(extent(wheel, 0)).toBeLessThanOrEqual(0.32);
      }
    }
  });

  test("the body uses a PBR material named livery that the livery system paints", () => {
    for (const car of cars) {
      for (const document of car.lods) {
        const materials = document.getRoot().listMaterials();
        expect(materials.length).toBeGreaterThan(0);
        const livery = materials.filter(
          (material) => material.getName() === "livery",
        );
        expect(livery).toHaveLength(1);
        const bodyMesh = named(document, "body").getMesh();
        expect(
          bodyMesh
            ?.listPrimitives()
            .some(
              (primitive) => primitive.getMaterial()?.getName() === "livery",
            ),
        ).toBe(true);
        for (const material of materials) {
          expect(material.getRoughnessFactor()).toBeGreaterThanOrEqual(0);
          expect(material.getMetallicFactor()).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

type Point3 = [number, number, number];

function wheelPositions(document: Document): [Point3, Point3, Point3, Point3] {
  const at = (name: string) => named(document, name).getWorldTranslation();
  return [at("wheel-fl"), at("wheel-fr"), at("wheel-rl"), at("wheel-rr")];
}

interface MaskCoverage {
  covered: number;
  unbalanced: number;
  zones: number[];
}

function maskCoverage(data: Uint8Array): MaskCoverage {
  const coverage: MaskCoverage = {
    covered: 0,
    unbalanced: 0,
    zones: [0, 0, 0],
  };
  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    if (data[offset + 3] === 0) {
      continue;
    }
    const channels = [
      data[offset] ?? 0,
      data[offset + 1] ?? 0,
      data[offset + 2] ?? 0,
    ];
    const sum = channels.reduce((total, value) => total + value, 0);
    coverage.covered += 1;
    coverage.unbalanced += sum < 250 || sum > 260 ? 1 : 0;
    channels.forEach((value, channel) => {
      coverage.zones[channel] =
        (coverage.zones[channel] ?? 0) + (value >= 200 ? 1 : 0);
    });
  }
  return coverage;
}

function fail(): never {
  throw new Error("the car has no detail levels");
}

describe("liveries", () => {
  function liveriesOf(car: LoadedCar): Livery[] {
    return car.manifest.liveries.map((file) =>
      parseLivery(
        JSON.parse(
          readFileSync(path.join(carsDirectory, car.id, file), "utf8"),
        ),
      ),
    );
  }

  test("each car ships at least three distinct valid liveries", () => {
    for (const car of cars) {
      const liveries = liveriesOf(car);
      expect(liveries.length).toBeGreaterThanOrEqual(3);
      expect(new Set(liveries.map((livery) => livery.id)).size).toBe(
        liveries.length,
      );
      expect(new Set(liveries.map((livery) => livery.primary)).size).toBe(
        liveries.length,
      );
      for (const livery of liveries) {
        expect(livery.primary).not.toBe(livery.secondary);
        expect(livery.secondary).not.toBe(livery.accent);
      }
    }
  });

  test("the livery mask marks primary, secondary and accent zones in red, green and blue", () => {
    for (const car of cars) {
      const mask = PNG.sync.read(
        readFileSync(path.join(carsDirectory, car.id, car.manifest.liveryMask)),
      );
      expect(Math.log2(mask.width) % 1).toBe(0);
      expect(Math.log2(mask.height) % 1).toBe(0);
      const coverage = maskCoverage(mask.data);
      expect(coverage.covered, "the mask must cover the body").toBeGreaterThan(
        0,
      );
      expect(coverage.unbalanced, "zone weights must add up to one").toBe(0);
      for (const count of coverage.zones) {
        expect(
          count / coverage.covered,
          "every zone must be used",
        ).toBeGreaterThanOrEqual(0.05);
      }
    }
  });
});

describe("the livery system", () => {
  const livery = parseLivery({
    id: "test",
    name: "Test",
    primary: "#ff8000",
    secondary: "#0040c0",
    accent: "#ffffff",
    number: 42,
  });

  test("parses a livery into exactly its fields", () => {
    expect(livery).toEqual({
      id: "test",
      name: "Test",
      primary: "#ff8000",
      secondary: "#0040c0",
      accent: "#ffffff",
      number: 42,
    });
  });

  test("paints each zone with its colour and blends anti-aliased edges", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128, 128, 127, 0, 255, 0, 0, 0,
      0,
    ]);
    const painted = paintLivery({ width: 5, height: 1, data }, livery);
    expect(painted).toBeInstanceOf(Uint8ClampedArray);
    expect([...painted]).toEqual([
      255, 128, 0, 255, 0, 64, 192, 255, 255, 255, 255, 128, 128, 96, 96, 255,
      0, 0, 0, 0,
    ]);
    expect([...data].slice(0, 4), "the mask itself is not modified").toEqual([
      255, 0, 0, 255,
    ]);
  });

  test("painting is fast enough for a 2048 by 2048 mask", () => {
    const size = 2048;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    const started = performance.now();
    const painted = paintLivery({ width: size, height: size, data }, livery);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(painted.length).toBe(data.length);
  });

  const bad: [string, unknown][] = [
    ["nothing", undefined],
    ["an array", []],
    [
      "a missing colour",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        number: 1,
      },
    ],
    [
      "an unknown field",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
        sponsor: "y",
      },
    ],
    [
      "a short colour",
      {
        id: "x",
        name: "X",
        primary: "#fff",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
      },
    ],
    [
      "an upper-case colour",
      {
        id: "x",
        name: "X",
        primary: "#FFFFFF",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
      },
    ],
    [
      "a named colour",
      {
        id: "x",
        name: "X",
        primary: "red",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
      },
    ],
    [
      "number zero",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 0,
      },
    ],
    [
      "number 100",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 100,
      },
    ],
    [
      "a fractional number",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 4.5,
      },
    ],
    [
      "an empty name",
      {
        id: "x",
        name: " ",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 4,
      },
    ],
    [
      "a bad id",
      {
        id: "Bad Id",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 4,
      },
    ],
  ];

  test.each(bad)("rejects %s with an Error", (_label, value) => {
    const error = caughtError(() => parseLivery(value));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toBe("");
  });

  test("rejects masks whose pixel data does not match their size", () => {
    const error = caughtError(() =>
      paintLivery(
        { width: 2, height: 2, data: new Uint8ClampedArray(12) },
        livery,
      ),
    );
    expect(error).toBeInstanceOf(Error);
  });
});
