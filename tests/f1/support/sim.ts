import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CarSetup,
  Input,
  Quat,
  Snapshot,
  TrackData,
  Vec3,
  WorldSetup,
} from "../../../apps/client/src/contracts/index.ts";

export interface WorldHandle {
  step: (inputs: unknown) => void;
  snapshot: () => Snapshot;
  stateHash: () => string;
  save: () => Uint8Array;
  free: () => void;
}

export interface WorldClass {
  new (setup: unknown): WorldHandle;
  load: (bytes: Uint8Array) => WorldHandle;
}

interface PhysicsModule {
  World: WorldClass;
  initSync: (options: { module: Uint8Array }) => unknown;
}

export async function loadWorldClass(directory: string): Promise<WorldClass> {
  const module = (await import(
    pathToFileURL(path.join(directory, "physics.js")).href
  )) as PhysicsModule;
  module.initSync({
    module: readFileSync(path.join(directory, "physics_bg.wasm")),
  });
  return module.World;
}

export const TICK_SECONDS = 1 / 500;

export const idle: Input = {
  steer: 0,
  throttle: 0,
  brake: 0,
  shiftUp: false,
  shiftDown: false,
};

export function pedals(change: Partial<Input>): Input {
  return { ...idle, ...change };
}

export function square(side: number, name = "Square"): TrackData {
  return {
    name,
    width: 12,
    centerline: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: side },
      { x: side, y: 0, z: side },
      { x: side, y: 0, z: 0 },
    ],
  };
}

export function hillLoop(points: number, radius: number): TrackData {
  const centerline = Array.from({ length: points }, (_, index) => {
    const angle = (2 * Math.PI * index) / points;
    return {
      x: Math.SQRT2 + radius * Math.cos(angle) + 7 * Math.sin(3 * angle),
      y: Math.E + 9 * Math.sin(2 * angle) + 2 * Math.cos(5 * angle),
      z: Math.PI + radius * Math.sin(angle) * 0.7 + 5 * Math.cos(4 * angle),
    };
  });
  return { name: "Hill loop", width: 13.7, centerline };
}

export function setupOf(track: TrackData, cars: CarSetup[]): WorldSetup {
  return { track, cars };
}

export function oneCar(track: TrackData, startDistance = 0): WorldSetup {
  return setupOf(track, [{ id: 7, startDistance }]);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function magnitude(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function unit(vector: Vec3): Vec3 {
  const size = magnitude(vector);
  return { x: vector.x / size, y: vector.y / size, z: vector.z / size };
}

function segments(track: TrackData): { from: Vec3; to: Vec3 }[] {
  const points = track.centerline;
  return points.map((from, index) => ({
    from,
    to: points[(index + 1) % points.length] ?? from,
  }));
}

export function trackLength(track: TrackData): number {
  return segments(track).reduce(
    (total, { from, to }) => total + magnitude(subtract(to, from)),
    0,
  );
}

export interface TrackPoint {
  position: Vec3;
  forward: Vec3;
}

export function pointAt(track: TrackData, distance: number): TrackPoint {
  let start = 0;
  const all = segments(track);
  for (const [index, { from, to }] of all.entries()) {
    const segment = subtract(to, from);
    const size = magnitude(segment);
    if (distance < start + size || index === all.length - 1) {
      const fraction = (distance - start) / size;
      return {
        position: {
          x: from.x + segment.x * fraction,
          y: from.y + segment.y * fraction,
          z: from.z + segment.z * fraction,
        },
        forward: unit(segment),
      };
    }
    start += size;
  }
  throw new Error("the track has no segments");
}

export function rotate(rotation: Quat, vector: Vec3): Vec3 {
  const { x, y, z, w } = rotation;
  const tx = 2 * (y * vector.z - z * vector.y);
  const ty = 2 * (z * vector.x - x * vector.z);
  const tz = 2 * (x * vector.y - y * vector.x);
  return {
    x: vector.x + w * tx + (y * tz - z * ty),
    y: vector.y + w * ty + (z * tx - x * tz),
    z: vector.z + w * tz + (x * ty - y * tx),
  };
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return magnitude(subtract(a, b));
}

export function speedOf(snapshot: Snapshot, index = 0): number {
  const car = snapshot.cars[index];
  if (car === undefined) {
    throw new Error(`the snapshot has no car at index ${String(index)}`);
  }
  return magnitude(car.velocity);
}

export function carAt(snapshot: Snapshot, index = 0) {
  const car = snapshot.cars[index];
  if (car === undefined) {
    throw new Error(`the snapshot has no car at index ${String(index)}`);
  }
  return car;
}

export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  const next32 = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  return () => (next32() * 2 ** 21 + (next32() >>> 11)) / 2 ** 53;
}

export function randomInputs(
  seed: number,
  ticks: number,
  cars: number,
): Input[][] {
  const random = randomSource(seed);
  return Array.from({ length: ticks }, () =>
    Array.from({ length: cars }, () => ({
      steer: random() * 2 - 1,
      throttle: random() < 0.15 ? 0 : random(),
      brake: random() < 0.7 ? 0 : random(),
      shiftUp: random() < 0.01,
      shiftDown: random() < 0.01,
    })),
  );
}

export function runSteps(world: WorldHandle, inputs: Input[][]): string[] {
  const hashes = [world.stateHash()];
  for (const tick of inputs) {
    world.step(tick);
    hashes.push(world.stateHash());
  }
  return hashes;
}

export interface NativeReplay {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runNative(directory: string, stdin: string): NativeReplay {
  const result = spawnSync(path.join(directory, "replay"), [], {
    input: stdin,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export interface ReplayResult {
  hashes: string[];
  snapshot: Snapshot;
  save: string;
}

export function replayNatively(
  directory: string,
  setup: WorldSetup,
  inputs: Input[][],
): ReplayResult {
  const result = runNative(directory, JSON.stringify({ setup, inputs }));
  if (result.code !== 0) {
    throw new Error(
      `replay exited with ${String(result.code)}: ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as ReplayResult;
}

export function caughtError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}
