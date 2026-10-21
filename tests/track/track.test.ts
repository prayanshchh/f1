import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, inject, test } from "vitest";
import type { Vec3 } from "../../apps/client/src/contracts/index.ts";
import {
  loadWorldClass,
  pedals,
  pointAt,
  setupOf,
  trackLength,
  type WorldClass,
} from "../support/sim.ts";
import { repoRoot } from "../support/repo.ts";

type Side = "left" | "right";

interface Band {
  kind: "kerb" | "grass" | "gravel" | "runoff";
  side: Side;
  from: number;
  to: number;
  inner: number;
  outer: number;
}

interface Wall {
  side: Side;
  from: number;
  to: number;
  offset: number;
}

interface Track {
  id: string;
  name: string;
  width: number;
  centerline: Vec3[];
  surfaces: Band[];
  walls: Wall[];
  pitLane: {
    side: Side;
    entry: number;
    exit: number;
    speedLimit: number;
    centerline: Vec3[];
    boxes: number[];
  };
  sectors: number[];
  grid: { distance: number; offset: number }[];
}

const tracksDirectory = path.join(repoRoot, "content/tracks");

function trackIds(): string[] {
  return readdirSync(tracksDirectory)
    .filter((entry) =>
      statSync(path.join(tracksDirectory, entry)).isDirectory(),
    )
    .sort();
}

function load(id: string): Track {
  return JSON.parse(
    readFileSync(path.join(tracksDirectory, id, "track.json"), "utf8"),
  ) as Track;
}

let World: WorldClass;
const tracks: Track[] = [];

beforeAll(async () => {
  const artifacts = inject("f1Artifacts");
  if (artifacts.problem !== null) {
    throw new Error(artifacts.problem);
  }
  World = await loadWorldClass(artifacts.directory);
  for (const id of trackIds()) {
    tracks.push(load(id));
  }
});

function lengthOf(track: Track): number {
  return trackLength({
    name: track.name,
    width: track.width,
    centerline: track.centerline,
  });
}

function asTrackData(track: Track) {
  return { name: track.name, width: track.width, centerline: track.centerline };
}

function within(
  distance: number,
  from: number,
  to: number,
  lap: number,
): boolean {
  const d = ((distance % lap) + lap) % lap;
  return from <= to ? d >= from && d < to : d >= from || d < to;
}

function horizontal(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function resample(track: Track, step: number): Vec3[] {
  const lap = lengthOf(track);
  const data = asTrackData(track);
  return Array.from(
    { length: Math.floor(lap / step) },
    (_, index) => pointAt(data, index * step).position,
  );
}

function circumradius(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = horizontal(a, b);
  const bc = horizontal(b, c);
  const ca = horizontal(c, a);
  const area =
    Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  return area === 0 ? Number.POSITIVE_INFINITY : (ab * bc * ca) / (4 * area);
}

function segmentsCross(a: Vec3, b: Vec3, c: Vec3, d: Vec3): boolean {
  const orient = (p: Vec3, q: Vec3, r: Vec3) =>
    Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return (
    orient(a, b, c) * orient(a, b, d) < 0 &&
    orient(c, d, a) * orient(c, d, b) < 0
  );
}

function lateral(track: Track, point: Vec3): { distance: number; side: Side } {
  let best = { distance: Number.POSITIVE_INFINITY, side: "left" as Side };
  const points = track.centerline;
  for (const [index, from] of points.entries()) {
    const to = points[(index + 1) % points.length] ?? from;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const t = Math.min(
      1,
      Math.max(
        0,
        ((point.x - from.x) * dx + (point.z - from.z) * dz) /
          (dx * dx + dz * dz),
      ),
    );
    const nearest = { x: from.x + dx * t, y: 0, z: from.z + dz * t };
    const distance = horizontal(nearest, point);
    if (distance < best.distance) {
      const cross = dz * (point.x - from.x) - dx * (point.z - from.z);
      best = { distance, side: cross > 0 ? "left" : "right" };
    }
  }
  return best;
}

const realCircuits = [
  "monza",
  "spa",
  "francorchamps",
  "silverstone",
  "suzuka",
  "monaco",
  "monte carlo",
  "interlagos",
  "imola",
  "zandvoort",
  "hungaroring",
  "barcelona",
  "catalunya",
  "bahrain",
  "sakhir",
  "jeddah",
  "yas marina",
  "marina bay",
  "baku",
  "montreal",
  "villeneuve",
  "red bull ring",
  "spielberg",
  "shanghai",
  "americas",
  "austin",
  "miami",
  "las vegas",
  "losail",
  "lusail",
  "albert park",
  "melbourne",
  "rodriguez",
  "nurburgring",
  "hockenheim",
  "sepang",
  "portimao",
  "mugello",
  "istanbul",
  "sochi",
  "paul ricard",
  "estoril",
  "kyalami",
  "madring",
];

test("there is at least one track with exactly the agreed fields", () => {
  expect(tracks.length).toBeGreaterThan(0);
  for (const [index, track] of tracks.entries()) {
    expect(track.id).toBe(trackIds()[index]);
    expect(track.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(Object.keys(track).sort()).toEqual(
      [
        "centerline",
        "grid",
        "id",
        "name",
        "pitLane",
        "sectors",
        "surfaces",
        "walls",
        "width",
      ].sort(),
    );
    expect(Object.keys(track.pitLane).sort()).toEqual([
      "boxes",
      "centerline",
      "entry",
      "exit",
      "side",
      "speedLimit",
    ]);
    expect(track.name.trim()).not.toBe("");
    for (const circuit of realCircuits) {
      expect(
        `${track.id} ${track.name}`.toLowerCase(),
        "the track must be original",
      ).not.toContain(circuit);
    }
  }
});

describe("layout", () => {
  test("is a closed loop of a Grand Prix length with sensible point spacing", () => {
    for (const track of tracks) {
      const lap = lengthOf(track);
      expect(lap).toBeGreaterThanOrEqual(3500);
      expect(lap).toBeLessThanOrEqual(7000);
      const points = track.centerline;
      for (const [index, point] of points.entries()) {
        const next = points[(index + 1) % points.length] ?? point;
        const gap = Math.hypot(
          next.x - point.x,
          next.y - point.y,
          next.z - point.z,
        );
        expect(gap, `gap after point ${String(index)}`).toBeGreaterThanOrEqual(
          0.5,
        );
        expect(gap, `gap after point ${String(index)}`).toBeLessThanOrEqual(10);
      }
      expect(track.width).toBeGreaterThanOrEqual(12);
      expect(track.width).toBeLessThanOrEqual(20);
    }
  });

  test("never crosses itself", () => {
    for (const track of tracks) {
      expect(crossings(track.centerline)).toEqual([]);
    }
  });

  test("has corners no tighter than a 12 metre hairpin", () => {
    for (const track of tracks) {
      const points = resample(track, 5);
      for (const [index, point] of points.entries()) {
        const before =
          points[(index - 2 + points.length) % points.length] ?? point;
        const after = points[(index + 2) % points.length] ?? point;
        expect(
          circumradius(before, point, after),
          `radius at ${String(index * 5)} m`,
        ).toBeGreaterThanOrEqual(12);
      }
    }
  });

  test("has real but drivable elevation changes", () => {
    for (const track of tracks) {
      const heights = track.centerline.map((point) => point.y);
      const range = Math.max(...heights) - Math.min(...heights);
      expect(range).toBeGreaterThanOrEqual(5);
      expect(range).toBeLessThanOrEqual(60);
      const points = resample(track, 5);
      const grades = points.map((point, index) => {
        const next = points[(index + 1) % points.length] ?? point;
        return (next.y - point.y) / horizontal(point, next);
      });
      for (const [index, grade] of grades.entries()) {
        expect(
          Math.abs(grade),
          `grade at ${String(index * 5)} m`,
        ).toBeLessThanOrEqual(0.18);
        const previous =
          grades[(index - 1 + grades.length) % grades.length] ?? grade;
        expect(
          Math.abs(grade - previous),
          `crest or dip at ${String(index * 5)} m`,
        ).toBeLessThanOrEqual(0.02);
      }
    }
  });
});

function fail(): never {
  throw new Error("missing point");
}

function crossings(points: Vec3[]): string[] {
  const count = points.length;
  const found: string[] = [];
  for (let a = 0; a < count; a += 1) {
    for (let b = a + 2; b < count - (a === 0 ? 1 : 0); b += 1) {
      if (
        segmentsCross(
          points[a] ?? fail(),
          points[(a + 1) % count] ?? fail(),
          points[b] ?? fail(),
          points[(b + 1) % count] ?? fail(),
        )
      ) {
        found.push(`segments ${String(a)} and ${String(b)}`);
      }
    }
  }
  return found;
}

function opening(
  track: Track,
  side: Side,
  distance: number,
  lap: number,
): boolean {
  const pit = track.pitLane;
  return (
    side === pit.side &&
    (within(distance, pit.entry, pit.entry + 200, lap) ||
      within(distance, pit.exit - 200, pit.exit, lap))
  );
}

describe("surroundings", () => {
  test("walls enclose the whole lap on both sides except at the pit lane openings", () => {
    for (const track of tracks) {
      const lap = lengthOf(track);
      for (const side of ["left", "right"] as const) {
        for (let distance = 0; distance < lap; distance += 1) {
          const walls = track.walls.filter(
            (wall) =>
              wall.side === side && within(distance, wall.from, wall.to, lap),
          );
          if (!opening(track, side, distance, lap)) {
            expect(walls.length, `${side} wall at ${String(distance)} m`).toBe(
              1,
            );
            expect(walls[0]?.offset).toBeGreaterThanOrEqual(
              track.width / 2 + 3,
            );
          }
        }
      }
    }
  });

  test("kerbs and run-off cover the ground from the track edge to the wall without gaps or overlaps", () => {
    for (const track of tracks) {
      const lap = lengthOf(track);
      for (const side of ["left", "right"] as const) {
        for (let distance = 0.5; distance < lap; distance += 1) {
          if (opening(track, side, distance, lap)) {
            continue;
          }
          const wall = track.walls.find(
            (entry) =>
              entry.side === side &&
              within(distance, entry.from, entry.to, lap),
          );
          const bands = track.surfaces
            .filter(
              (band) =>
                band.side === side && within(distance, band.from, band.to, lap),
            )
            .sort((a, b) => a.inner - b.inner);
          let edge = track.width / 2;
          for (const band of bands) {
            expect(band.inner, `${side} at ${String(distance)} m`).toBe(edge);
            expect(band.outer).toBeGreaterThan(band.inner);
            edge = band.outer;
          }
          expect(
            edge,
            `${side} surfaces reach the wall at ${String(distance)} m`,
          ).toBe(wall?.offset);
        }
      }
    }
  });

  test("there are kerbs on at least eight corners", () => {
    for (const track of tracks) {
      const kerbs = track.surfaces.filter((band) => band.kind === "kerb");
      expect(kerbs.length).toBeGreaterThanOrEqual(8);
      const lap = lengthOf(track);
      for (const kerb of kerbs) {
        const span = (kerb.to - kerb.from + lap) % lap;
        expect(span).toBeGreaterThanOrEqual(10);
        expect(span).toBeLessThanOrEqual(250);
        expect(kerb.inner).toBe(track.width / 2);
        expect(kerb.outer - kerb.inner).toBeLessThanOrEqual(2.5);
      }
    }
  });
});

describe("pit lane", () => {
  test("leaves and rejoins the track on its side and stays beyond the pit wall in between", () => {
    for (const track of tracks) {
      const pit = track.pitLane;
      const data = asTrackData(track);
      const first = pit.centerline[0] ?? fail();
      const last = pit.centerline.at(-1) ?? fail();
      expect(
        horizontal(first, pointAt(data, pit.entry).position),
      ).toBeLessThanOrEqual(track.width / 2 + 30);
      expect(
        horizontal(last, pointAt(data, pit.exit).position),
      ).toBeLessThanOrEqual(track.width / 2 + 30);
      const length =
        trackLength({ name: "pit", width: 1, centerline: pit.centerline }) -
        horizontal(last, first);
      expect(length).toBeGreaterThanOrEqual(250);
      let travelled = 0;
      for (const [index, point] of pit.centerline.entries()) {
        if (index > 0) {
          travelled += horizontal(pit.centerline[index - 1] ?? point, point);
        }
        if (travelled > 150 && travelled < length - 150) {
          const where = lateral(track, point);
          expect(where.side, `pit lane point ${String(index)}`).toBe(pit.side);
          expect(
            where.distance,
            `pit lane point ${String(index)}`,
          ).toBeGreaterThanOrEqual(track.width / 2 + 3);
        }
      }
    }
  });

  test("has an 80 km/h limit and garage boxes for eleven teams", () => {
    for (const track of tracks) {
      const pit = track.pitLane;
      expect(Math.abs(pit.speedLimit - 80 / 3.6)).toBeLessThan(1e-6);
      expect(pit.boxes.length).toBeGreaterThanOrEqual(11);
      const length = trackLength({
        name: "pit",
        width: 1,
        centerline: pit.centerline,
      });
      for (const [index, box] of pit.boxes.entries()) {
        expect(box).toBeGreaterThanOrEqual(30);
        expect(box).toBeLessThanOrEqual(length - 30);
        if (index > 0) {
          expect(box - (pit.boxes[index - 1] ?? 0)).toBeGreaterThanOrEqual(6);
        }
      }
    }
  });
});

test("three sectors each cover at least a fifth of the lap", () => {
  for (const track of tracks) {
    const lap = lengthOf(track);
    expect(track.sectors).toHaveLength(2);
    const [first, second] = track.sectors as [number, number];
    for (const span of [first, second - first, lap - second]) {
      expect(span).toBeGreaterThanOrEqual(lap * 0.2);
    }
  }
});

test("the grid has 22 staggered slots 8 metres apart behind the start line", () => {
  for (const track of tracks) {
    const lap = lengthOf(track);
    expect(track.grid).toHaveLength(22);
    const behind = track.grid.map((slot) => lap - slot.distance);
    expect(behind[0]).toBeGreaterThan(0);
    expect(behind[0]).toBeLessThanOrEqual(30);
    for (const [index, slot] of track.grid.entries()) {
      expect(slot.distance).toBeGreaterThan(0);
      expect(slot.distance).toBeLessThan(lap);
      expect(Math.abs(slot.offset)).toBeGreaterThanOrEqual(1.5);
      expect(Math.abs(slot.offset)).toBeLessThanOrEqual(track.width / 2 - 1.5);
      if (index > 0) {
        const gap = (behind[index] ?? 0) - (behind[index - 1] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(7.5);
        expect(gap).toBeLessThanOrEqual(8.5);
        expect(Math.sign(slot.offset)).toBe(
          -Math.sign(track.grid[index - 1]?.offset ?? 0),
        );
      }
    }
  }
});

test("a full grid drives laps of the track in the stub world", () => {
  for (const track of tracks) {
    const setup = setupOf(
      asTrackData(track),
      track.grid.map((slot, id) => ({ id, startDistance: slot.distance })),
    );
    const world = new World(setup);
    const inputs = track.grid.map(() => pedals({ throttle: 1 }));
    for (let tick = 0; tick < 60_000; tick += 1) {
      world.step(inputs);
    }
    const snapshot = world.snapshot();
    expect(snapshot.cars).toHaveLength(22);
    for (const car of snapshot.cars) {
      expect(car.lap).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(car.position.y)).toBe(true);
    }
  }
});
