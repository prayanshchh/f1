import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Quat, Vec3 } from "../../../apps/client/src/contracts/index.ts";
import { releaseExecutable } from "../../support/cargo.ts";

export interface DropStart {
  position: Vec3;
  orientation: Quat;
  velocity: Vec3;
  angularVelocity: Vec3;
  groundHeight: number;
}

interface CornerState {
  compression: number;
  load: number;
}

export interface ChassisState {
  tick: number;
  position: Vec3;
  orientation: Quat;
  velocity: Vec3;
  angularVelocity: Vec3;
  corners: CornerState[];
}

export interface ChassisHandle {
  step: () => void;
  state: () => ChassisState;
  stateHash: () => string;
  save: () => Uint8Array;
  free: () => void;
}

export interface ChassisClass {
  new (start: unknown): ChassisHandle;
  load: (bytes: Uint8Array) => ChassisHandle;
}

interface PhysicsModule {
  Chassis?: ChassisClass;
  initSync: (options: { module: Uint8Array }) => unknown;
}

export async function loadChassisClass(
  directory: string,
): Promise<ChassisClass> {
  const module = (await import(
    pathToFileURL(path.join(directory, "physics.js")).href
  )) as PhysicsModule;
  module.initSync({
    module: readFileSync(path.join(directory, "physics_bg.wasm")),
  });
  if (module.Chassis === undefined) {
    throw new Error("the WebAssembly physics module must export Chassis");
  }
  return module.Chassis;
}

export function buildChassisReplay(): string {
  return releaseExecutable(["--bin", "chassis-replay"]);
}

export interface NativeRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runChassisReplay(executable: string, stdin: string): NativeRun {
  const result = spawnSync(executable, [], {
    input: stdin,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export interface ChassisReplay {
  hashes: string[];
  state: ChassisState;
  save: string;
}

export function replayChassis(
  executable: string,
  start: DropStart,
  ticks: number,
): ChassisReplay {
  const result = runChassisReplay(executable, JSON.stringify({ start, ticks }));
  if (result.code !== 0) {
    throw new Error(
      `chassis-replay exited with ${String(result.code)}: ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as ChassisReplay;
}

export function runChassis(chassis: ChassisHandle, ticks: number): string[] {
  const hashes = [chassis.stateHash()];
  for (let tick = 0; tick < ticks; tick += 1) {
    chassis.step();
    hashes.push(chassis.stateHash());
  }
  return hashes;
}

function axisAngle(axis: Vec3, degrees: number): Quat {
  const half = (degrees * Math.PI) / 360;
  const size = Math.hypot(axis.x, axis.y, axis.z);
  const s = Math.sin(half) / size;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

export const levelDrop: DropStart = {
  position: { x: 0, y: 1, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  groundHeight: 0,
};

export const tumblingDrop: DropStart = {
  position: { x: Math.SQRT2, y: 1.7 + Math.E / 10, z: -Math.PI },
  orientation: axisAngle({ x: 0.3, y: 1, z: -0.45 }, 41.3),
  velocity: { x: 1.25, y: -0.5, z: Math.LN2 },
  angularVelocity: { x: 0.35, y: -1.7, z: 0.6 },
  groundHeight: Math.E - 2,
};

export const hardDrop: DropStart = {
  position: { x: -12.5, y: 2.5, z: 40 },
  orientation: axisAngle({ x: 1, y: 0, z: 0.2 }, -4),
  velocity: { x: 0, y: -6, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  groundHeight: 0,
};
