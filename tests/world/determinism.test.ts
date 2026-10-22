import { beforeAll, describe, expect, inject, test } from "vitest";
import {
  hillLoop,
  loadWorldClass,
  oneCar,
  pedals,
  randomInputs,
  randomSource,
  replayNatively,
  runNative,
  runSteps,
  setupOf,
  square,
  trackLength,
  type WorldClass,
} from "../support/sim.ts";

let World: WorldClass;
let directory: string;

beforeAll(async () => {
  const artifacts = inject("f1Artifacts");
  if (artifacts.problem !== null) {
    throw new Error(artifacts.problem);
  }
  directory = artifacts.directory;
  World = await loadWorldClass(directory);
});

const raceTrack = hillLoop(200, 420);
const raceSetup = setupOf(raceTrack, [
  { id: 44, startDistance: 0 },
  { id: 1, startDistance: trackLength(raceTrack) / 7 },
  { id: 16, startDistance: Math.PI * 100 },
  { id: 81, startDistance: trackLength(raceTrack) - Math.SQRT1_2 },
]);
const raceInputs = randomInputs(2026, 10_000, 4);

describe("the browser build and the server build", () => {
  test("produce the same state hash on every one of 10,000 ticks, the same final snapshot and the same save bytes", () => {
    const native = replayNatively(directory, raceSetup, raceInputs);
    const world = new World(raceSetup);
    const hashes = runSteps(world, raceInputs);
    expect(native.hashes).toHaveLength(10_001);
    const firstDifference = hashes.findIndex(
      (hash, tick) => hash !== native.hashes[tick],
    );
    expect(firstDifference, "first tick where the builds disagree").toBe(-1);
    expect(native.snapshot).toEqual(world.snapshot());
    expect(Buffer.from(native.save, "base64")).toEqual(
      Buffer.from(world.save()),
    );
  });

  test("load each other's saves", () => {
    const halfway = raceInputs.slice(0, 5000);
    const rest = raceInputs.slice(5000);
    const native = replayNatively(directory, raceSetup, halfway);
    const fromServer = World.load(
      new Uint8Array(Buffer.from(native.save, "base64")),
    );
    expect(fromServer.stateHash()).toBe(native.hashes.at(-1));
    const continued = runSteps(fromServer, rest);
    const full = replayNatively(directory, raceSetup, raceInputs);
    expect(continued).toEqual(full.hashes.slice(5000));
  });

  test("read numbers exactly: the server places a car starting at 0 exactly above the first centerline point", () => {
    const native = replayNatively(directory, oneCar(raceTrack), []);
    expect(native.hashes).toHaveLength(1);
    const position = native.snapshot.cars[0]?.position;
    const point = raceTrack.centerline[0];
    expect(position?.x).toBe(point?.x);
    expect(position?.z).toBe(point?.z);
    expect(position?.y).toBeCloseTo((point?.y ?? 0) + 0.3, 12);
    expect(native.snapshot).toEqual(new World(oneCar(raceTrack)).snapshot());
  });
});

test("the server reads every one of 2,200 random 17-digit start distances back bit for bit", () => {
  const lap = trackLength(raceTrack);
  const next = randomSource(505);
  for (let round = 0; round < 100; round += 1) {
    const starts = Array.from({ length: 22 }, () => next() * lap);
    const native = replayNatively(
      directory,
      setupOf(
        raceTrack,
        starts.map((startDistance, id) => ({ id, startDistance })),
      ),
      [],
    );
    expect(native.snapshot.cars.map((car) => car.lapDistance)).toEqual(starts);
  }
});

describe("one build", () => {
  test("gives identical results for worlds stepped side by side as for a world run alone", () => {
    const alone = runSteps(new World(raceSetup), raceInputs.slice(0, 3000));
    const first = new World(raceSetup);
    const second = new World(raceSetup);
    const firstHashes = [first.stateHash()];
    const secondHashes = [second.stateHash()];
    for (const tick of raceInputs.slice(0, 3000)) {
      first.step(tick);
      second.step(tick);
      firstHashes.push(first.stateHash());
      secondHashes.push(second.stateHash());
    }
    expect(firstHashes).toEqual(alone);
    expect(secondHashes).toEqual(alone);
  });

  test("gives different hashes for different inputs", () => {
    const changed = raceInputs.map((tick) =>
      tick.map((input) => ({ ...input })),
    );
    const target = changed[1234]?.[2];
    if (target === undefined) {
      throw new Error("missing input");
    }
    target.throttle = target.throttle === 1 ? 0.5 : 1;
    const original = runSteps(new World(raceSetup), raceInputs.slice(0, 2000));
    const altered = runSteps(new World(raceSetup), changed.slice(0, 2000));
    expect(altered.slice(0, 1235)).toEqual(original.slice(0, 1235));
    expect(altered[1235]).not.toBe(original[1235]);
  });
});

function expectFailedReplay(stdin: string, label: string): void {
  const result = runNative(directory, stdin);
  expect(result.code, `${label}: exit code`).not.toBe(0);
  expect(result.code, `${label}: must exit, not crash`).not.toBeNull();
  expect(result.stdout, `${label}: stdout`).toBe("");
  expect(result.stderr.trim(), `${label}: stderr`).not.toBe("");
  expect(result.stderr, `${label}: must not panic`).not.toMatch(/panicked/);
}

const valid = {
  setup: oneCar(square(100)),
  inputs: [[pedals({ throttle: 1 })]],
};

const badRequests: [string, string][] = [
  ["empty input", ""],
  ["text that is not JSON", "drive fast"],
  ["truncated JSON", JSON.stringify(valid).slice(0, -3)],
  ["a JSON array", "[]"],
  ["a missing setup", JSON.stringify({ inputs: [] })],
  ["missing inputs", JSON.stringify({ setup: valid.setup })],
  ["an unknown field", JSON.stringify({ ...valid, seed: 4 })],
  [
    "an invalid setup",
    JSON.stringify({ ...valid, setup: setupOf(square(100), []) }),
  ],
  [
    "a bad input on the third step",
    JSON.stringify({
      ...valid,
      inputs: [
        [pedals({ throttle: 1 })],
        [pedals({ throttle: 1 })],
        [pedals({ throttle: 7 })],
      ],
    }),
  ],
  [
    "the wrong number of inputs on a step",
    JSON.stringify({ ...valid, inputs: [[pedals({}), pedals({})]] }),
  ],
  [
    "a car id too big for any number type",
    JSON.stringify(valid).replace('"id":7', '"id":1e400'),
  ],
  [
    "a car id given as text",
    JSON.stringify(valid).replace('"id":7', '"id":"7"'),
  ],
];

describe("the native replay tool", () => {
  test("prints the hash before the first step and after every step", () => {
    const result = replayNatively(directory, valid.setup, [
      [pedals({ throttle: 1 })],
      [pedals({ brake: 1 })],
    ]);
    expect(Object.keys(result).sort()).toEqual(["hashes", "save", "snapshot"]);
    expect(result.hashes).toEqual(
      runSteps(new World(valid.setup), [
        [pedals({ throttle: 1 })],
        [pedals({ brake: 1 })],
      ]),
    );
    expect(result.snapshot.tick).toBe(2);
  });

  test.each(badRequests)("fails cleanly for %s", (label, stdin) => {
    expectFailedReplay(stdin, label);
  });
});
