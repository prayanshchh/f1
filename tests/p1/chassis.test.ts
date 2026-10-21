import { beforeAll, describe, expect, inject, test } from "vitest";
import { caughtError, randomSource } from "../f1/support/sim.ts";
import {
  buildChassisReplay,
  hardDrop,
  levelDrop,
  loadChassisClass,
  replayChassis,
  runChassis,
  runChassisReplay,
  tumblingDrop,
  type ChassisClass,
  type DropStart,
} from "./support/chassis.ts";

let Chassis: ChassisClass;
let replay: string;

beforeAll(async () => {
  const artifacts = inject("f1Artifacts");
  if (artifacts.problem !== null) {
    throw new Error(artifacts.problem);
  }
  Chassis = await loadChassisClass(artifacts.directory);
  replay = buildChassisReplay();
});

const drops: [string, DropStart][] = [
  ["a level drop", levelDrop],
  ["a tumbling drop onto raised ground", tumblingDrop],
  ["a hard drop", hardDrop],
];

describe("the browser build and the server build", () => {
  test.each(drops)(
    "agree on every state hash for 10,000 ticks of %s",
    (_label, start) => {
      const native = replayChassis(replay, start, 10_000);
      const chassis = new Chassis(start);
      const hashes = runChassis(chassis, 10_000);
      expect(native.hashes).toHaveLength(10_001);
      const firstDifference = hashes.findIndex(
        (hash, tick) => hash !== native.hashes[tick],
      );
      expect(firstDifference, "first tick where the builds disagree").toBe(-1);
      expect(native.state).toEqual(chassis.state());
      expect(Buffer.from(native.save, "base64")).toEqual(
        Buffer.from(chassis.save()),
      );
      chassis.free();
    },
  );

  test("continue each other's saves identically", () => {
    const half = replayChassis(replay, tumblingDrop, 4000);
    const resumed = Chassis.load(
      new Uint8Array(Buffer.from(half.save, "base64")),
    );
    expect(resumed.stateHash()).toBe(half.hashes.at(-1));
    expect(resumed.state().tick).toBe(4000);
    const rest = runChassis(resumed, 6000);
    const whole = replayChassis(replay, tumblingDrop, 10_000);
    expect(rest).toEqual(whole.hashes.slice(4000));
  });

  test("read 100 random 17-digit starts back bit for bit", () => {
    const next = randomSource(1977);
    for (let round = 0; round < 100; round += 1) {
      const start: DropStart = {
        position: { x: next() * 200 - 100, y: 5 + next(), z: next() * -300 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: next() - 0.5, y: next() - 0.5, z: next() * 3 },
        angularVelocity: { x: 0, y: next() * 2 - 1, z: 0 },
        groundHeight: next() * 4 - 2,
      };
      const native = replayChassis(replay, start, 0);
      const local = new Chassis(start).state();
      expect(native.state).toEqual(local);
      expect(local.position).toEqual(start.position);
      expect(local.velocity).toEqual(start.velocity);
      expect(local.angularVelocity).toEqual(start.angularVelocity);
      expect(native.hashes).toHaveLength(1);
    }
  });
});

test("in the browser build the dropped car comes to rest on four loaded corners", () => {
  const chassis = new Chassis(levelDrop);
  runChassis(chassis, 10_000);
  const state = chassis.state();
  expect(state.tick).toBe(10_000);
  expect(
    Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z),
  ).toBeLessThan(1e-3);
  expect(state.corners).toHaveLength(4);
  for (const corner of state.corners) {
    expect(corner.load).toBeGreaterThan(0);
    expect(corner.compression).toBeGreaterThan(0);
  }
});

describe("the browser build rejects bad data with a JavaScript Error", () => {
  const bad: [string, unknown][] = [
    ["nothing", undefined],
    ["a string", "drop"],
    ["a missing field", { ...levelDrop, groundHeight: undefined }],
    ["an unknown field", { ...levelDrop, spin: 1 }],
    [
      "a non-number coordinate",
      { ...levelDrop, position: { x: "0", y: 1, z: 0 } },
    ],
    [
      "a quaternion that is not unit length",
      { ...levelDrop, orientation: { x: 0, y: 0, z: 0, w: 2 } },
    ],
    ["a car buried in the ground", { ...levelDrop, groundHeight: 0.99 }],
  ];

  test.each(bad)("%s", (_label, start) => {
    const error = caughtError(() => new Chassis(start));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toBe("");
  });

  test("damaged or foreign saves", () => {
    const chassis = new Chassis(levelDrop);
    runChassis(chassis, 50);
    const bytes = chassis.save();
    const middle = Math.floor(bytes.length / 2);
    const damaged = bytes.map((byte, index) =>
      index === middle ? byte ^ 1 : byte,
    );
    for (const save of [
      new Uint8Array(),
      bytes.slice(0, -1),
      damaged,
      new Uint8Array(64),
    ]) {
      const error = caughtError(() => Chassis.load(save));
      expect(error).toBeInstanceOf(Error);
    }
  });
});

describe("the native chassis replay tool", () => {
  const valid = { start: levelDrop, ticks: 3 };
  const badRequests: [string, string][] = [
    ["empty input", ""],
    ["text that is not JSON", "drop it"],
    ["a JSON array", "[]"],
    ["a missing start", JSON.stringify({ ticks: 3 })],
    ["missing ticks", JSON.stringify({ start: levelDrop })],
    ["negative ticks", JSON.stringify({ ...valid, ticks: -1 })],
    ["fractional ticks", JSON.stringify({ ...valid, ticks: 2.5 })],
    ["an unknown field", JSON.stringify({ ...valid, seed: 1 })],
    [
      "an impossible start",
      JSON.stringify({ ...valid, start: { ...levelDrop, groundHeight: 5 } }),
    ],
  ];

  test("prints one hash before the first tick and one after every tick", () => {
    const result = replayChassis(replay, levelDrop, 3);
    expect(Object.keys(result).sort()).toEqual(["hashes", "save", "state"]);
    expect(result.hashes).toEqual(runChassis(new Chassis(levelDrop), 3));
    expect(result.state.tick).toBe(3);
  });

  test.each(badRequests)("fails cleanly for %s", (label, stdin) => {
    const result = runChassisReplay(replay, stdin);
    expect(result.code, `${label}: exit code`).not.toBe(0);
    expect(result.code, `${label}: must exit, not crash`).not.toBeNull();
    expect(result.stdout, label).toBe("");
    expect(result.stderr.trim(), label).not.toBe("");
    expect(result.stderr, label).not.toMatch(/panicked/);
  });
});
