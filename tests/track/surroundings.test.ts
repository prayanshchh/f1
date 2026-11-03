import { readFileSync } from "node:fs";
import path from "node:path";
import type { Accessor } from "@gltf-transform/core";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

interface Point {
  x: number;
  y: number;
  z: number;
  width: number;
  wallLeft: number;
  wallRight: number;
}

const directory = path.join(repoRoot, "content/tracks/hill-country");
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
) as {
  length: number;
  centerline: Point[];
  surfaces: { kind: string; from: number; to: number; width: number }[];
  pitLane: { entry: number; exit: number };
};
const skies = [
  "circuit",
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "dusk",
  "night",
];
const pointerPrefix = "version https://git-lfs";
const isPointer = (file: string) =>
  readFileSync(file).subarray(0, pointerPrefix.length).toString("latin1") ===
  pointerPrefix;
const crowdFile = path.join(directory, "crowd.bin");
const lfsPointer = isPointer(path.join(directory, "road.glb"));
const stride = 8;
const sharpRowsPerMetre = 2.5;
const gpuTextureLimit = 16384;
const maskColumns = 401;
const clearanceHeight = 4;

function floats(file: string): Float32Array {
  const bytes = readFileSync(file);
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

function nearestRow(x: number, north: number): number {
  let best = 0;
  let bestDistance = Infinity;
  track.centerline.forEach((point, row) => {
    const distance = (point.x - x) ** 2 + (-point.z - north) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  });
  return best;
}

function roadHeight(x: number, north: number): number {
  return track.centerline[nearestRow(x, north)]?.y ?? 0;
}

function insideBarriers(x: number, north: number): boolean {
  const row = nearestRow(x, north);
  const point = track.centerline[row];
  const next = track.centerline[(row + 1) % track.centerline.length];
  if (!point || !next) return false;
  const tx = next.x - point.x;
  const tn = -next.z + point.z;
  const size = Math.hypot(tx, tn);
  const lateral = ((x - point.x) * -tn + (north + point.z) * tx) / size;
  return lateral > 0 ? lateral < point.wallLeft : -lateral < point.wallRight;
}

function standsInside(position: Accessor | null): boolean {
  if (!position) return false;
  const v = [0, 0, 0];
  for (let i = 0; i < position.getCount(); i += 97) {
    position.getElement(i, v);
    const [x = 0, up = 0, z = 0] = v;
    if (up < roadHeight(x, -z) + clearanceHeight && insideBarriers(x, -z))
      return true;
  }
  return false;
}

describe.skipIf(lfsPointer)("Hill Country surroundings", () => {
  test("spectators stay behind the barriers and use real sprite cells", () => {
    const values = floats(crowdFile);
    expect(values.length % stride).toBe(0);
    const offenders: number[] = [];
    for (let i = 0; i < values.length; i += stride * 11) {
      if (insideBarriers(values[i] ?? 0, values[i + 1] ?? 0))
        offenders.push(i / stride);
      const cell = values[i + 4] ?? -1;
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(32);
    }
    expect(offenders).toEqual([]);
  });

  test("no tent, crane, mast or screen stands inside the barriers", async () => {
    const document = await readModel(path.join(directory, "road.glb"));
    const props = document
      .getRoot()
      .listMeshes()
      .filter((mesh) => mesh.getName().startsWith("prop"));
    expect(props.length).toBeGreaterThan(3);
    const offenders = props
      .filter((mesh) =>
        mesh
          .listPrimitives()
          .some((primitive) =>
            standsInside(primitive.getAttribute("POSITION")),
          ),
      )
      .map((mesh) => mesh.getName());
    expect(offenders).toEqual([]);
  });

  test("road-space masks resolve run-off paint finely along the lap and still fit on the GPU", () => {
    for (const name of ["apron_a.png", "apron_b.png"]) {
      const image = PNG.sync.read(
        readFileSync(path.join(directory, "textures/baked", name)),
      );
      expect(image.width).toBe(maskColumns);
      expect(image.height / track.length).toBeGreaterThan(sharpRowsPerMetre);
      expect(image.height).toBeLessThanOrEqual(gpuTextureLimit);
    }
  });

  test("kerbs stay out of the pit lane mouth and on the track", () => {
    const kerbs = track.surfaces.filter((span) => span.kind === "kerb");
    expect(kerbs.length).toBeGreaterThan(10);
    const inPit = (s: number) =>
      s > track.pitLane.entry || s < track.pitLane.exit;
    for (const kerb of kerbs) {
      expect(kerb.from).toBeGreaterThanOrEqual(0);
      expect(kerb.to).toBeLessThanOrEqual(track.length);
      expect(kerb.width).toBeGreaterThan(0.5);
      expect(inPit((kerb.from + kerb.to) / 2)).toBe(false);
    }
  });

  test.each(skies)(
    "%s sky has a readable crop, environment and sun",
    (name) => {
      const meta = JSON.parse(
        readFileSync(path.join(directory, "sky", `${name}.json`), "utf8"),
      ) as {
        elevation: number;
        keepTop: number;
        skyRadiance: number[];
        sunColor: number[];
      };
      expect(meta.elevation).toBeGreaterThan(0);
      expect(meta.keepTop).toBeGreaterThan(0.5);
      expect(meta.keepTop).toBeLessThan(0.6);
      expect(meta.skyRadiance).toHaveLength(3);
      expect(Math.max(...meta.sunColor)).toBeCloseTo(1, 5);
      for (const file of [`${name}.hdr`, `${name}-env.hdr`]) {
        const header = readFileSync(path.join(directory, "sky", file))
          .subarray(0, 64)
          .toString("latin1");
        expect(header).toMatch(
          /^#\?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y \d+ \+X \d+\n/,
        );
      }
    },
  );
});
