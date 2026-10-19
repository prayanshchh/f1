import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, inject, test } from "vitest";
import {
  hillLoop,
  loadWorldClass,
  pedals,
  setupOf,
  square,
  trackLength,
  type WorldClass,
} from "../f1/support/sim.ts";
import { repoRoot } from "../support/repo.ts";
import { cratePath, normalDependencies } from "../support/rust.ts";
import {
  buildScenarioRunner,
  channelNames,
  inputsAt,
  runScenario,
  runScenarioFile,
  withScenarioFile,
  type Scenario,
  type Telemetry,
} from "./support/scenario.ts";

let World: WorldClass;
let runner: string;

beforeAll(async () => {
  const artifacts = inject("f1Artifacts");
  if (artifacts.problem !== null) {
    throw new Error(artifacts.problem);
  }
  World = await loadWorldClass(artifacts.directory);
  runner = buildScenarioRunner();
});

const track = hillLoop(120, 300);
const mixed: Scenario = {
  name: "Mixed pedals",
  setup: setupOf(track, [
    { id: 3, startDistance: 0 },
    { id: 14, startDistance: trackLength(track) / 2 },
  ]),
  ticks: 4000,
  inputs: [
    { fromTick: 0, cars: [pedals({ throttle: 1 }), pedals({ throttle: 0.4 })] },
    {
      fromTick: 1500,
      cars: [pedals({ throttle: 0.2, steer: -0.5 }), pedals({ brake: 0.3 })],
    },
    { fromTick: 2600, cars: [pedals({ brake: 1 }), pedals({ throttle: 1 })] },
  ],
};

function expectMatchesWorld(scenario: Scenario, telemetry: Telemetry): void {
  const world = new World(scenario.setup);
  const samples = scenario.ticks + 1;
  expect(telemetry.cars.map((car) => car.id)).toEqual(
    scenario.setup.cars.map((car) => car.id),
  );
  for (const car of telemetry.cars) {
    expect(Object.keys(car.channels).sort()).toEqual([...channelNames].sort());
    for (const name of channelNames) {
      expect(car.channels[name], name).toHaveLength(samples);
    }
  }
  for (let tick = 0; tick < samples; tick += 1) {
    const snapshot = world.snapshot();
    const inputs = inputsAt(scenario, tick);
    for (const [index, state] of snapshot.cars.entries()) {
      const channels = telemetry.cars[index]?.channels;
      const input = inputs[index];
      if (channels === undefined || input === undefined) {
        throw new Error(`missing car ${String(index)}`);
      }
      const at = (name: (typeof channelNames)[number]) => channels[name][tick];
      expect(at("time")).toBe(tick / 500);
      expect(at("lapDistance")).toBe(state.lapDistance);
      expect(at("lap")).toBe(state.lap);
      expect(at("x")).toBe(state.position.x);
      expect(at("y")).toBe(state.position.y);
      expect(at("z")).toBe(state.position.z);
      const speed = Math.hypot(
        state.velocity.x,
        state.velocity.y,
        state.velocity.z,
      );
      expect(Math.abs((at("speed") ?? Number.NaN) - speed)).toBeLessThanOrEqual(
        1e-12 * Math.max(1, speed),
      );
      expect(at("throttle")).toBe(input.throttle);
      expect(at("brake")).toBe(input.brake);
      expect(at("steer")).toBe(input.steer);
    }
    if (tick < scenario.ticks) {
      world.step(inputs);
    }
  }
  expect(telemetry.finalHash).toBe(world.stateHash());
}

test("the scenario runner is a native tool built on the shared physics", () => {
  expect(cratePath("scenario")).toBe("crates/scenario");
  expect(normalDependencies("scenario")).toEqual(
    expect.arrayContaining(["contracts", "physics"]),
  );
});

test("telemetry records every channel of every car on every tick exactly as the physics computed it", () => {
  const telemetry = runScenario(runner, mixed);
  expect(telemetry.name).toBe("Mixed pedals");
  expect(telemetry.hz).toBe(500);
  expectMatchesWorld(mixed, telemetry);
});

test("the same scenario always produces byte-identical telemetry", () => {
  const first = withScenarioFile(JSON.stringify(mixed), (file) =>
    runScenarioFile(runner, ["run", file]),
  );
  const second = withScenarioFile(JSON.stringify(mixed), (file) =>
    runScenarioFile(runner, ["run", file]),
  );
  expect(first.code).toBe(0);
  expect(second.stdout).toBe(first.stdout);
});

describe("the bundled straight-line scenario", () => {
  const file = path.join(repoRoot, "content/scenarios/straight-line.json");

  test("accelerates a single car flat out and then brakes it to a stop", () => {
    const scenario = JSON.parse(readFileSync(file, "utf8")) as Scenario;
    expect(scenario.setup.cars).toHaveLength(1);
    const result = runScenarioFile(runner, ["run", file]);
    expect(result.code, result.stderr).toBe(0);
    const telemetry = JSON.parse(result.stdout) as Telemetry;
    expectMatchesWorld(scenario, telemetry);
    const channels = telemetry.cars[0]?.channels;
    if (channels === undefined) {
      throw new Error("no car telemetry");
    }
    const peak = Math.max(...channels.speed);
    const peakAt = channels.speed.indexOf(peak);
    expect(peak).toBeGreaterThan(50);
    for (let tick = 1; tick <= peakAt; tick += 1) {
      expect(channels.speed[tick]).toBeGreaterThanOrEqual(
        (channels.speed[tick - 1] ?? 0) - 1e-9,
      );
    }
    for (let tick = peakAt + 1; tick < channels.speed.length; tick += 1) {
      expect(channels.speed[tick]).toBeLessThanOrEqual(
        (channels.speed[tick - 1] ?? 0) + 1e-9,
      );
    }
    expect(channels.speed.at(-1)).toBe(0);
    expect(channels.throttle[0]).toBe(1);
    expect(channels.brake.at(-1)).toBe(1);
  });
});

test("a full grid over a long run finishes quickly", () => {
  const big = square(800);
  const scenario: Scenario = {
    name: "Full grid",
    setup: setupOf(
      big,
      Array.from({ length: 22 }, (_, id) => ({ id, startDistance: id * 40 })),
    ),
    ticks: 5000,
    inputs: [
      {
        fromTick: 0,
        cars: Array.from({ length: 22 }, () => pedals({ throttle: 1 })),
      },
    ],
  };
  const started = performance.now();
  const telemetry = runScenario(runner, scenario);
  expect(performance.now() - started).toBeLessThan(10_000);
  expect(telemetry.cars).toHaveLength(22);
  expect(telemetry.cars[21]?.channels.speed).toHaveLength(5001);
});

const valid = {
  name: "Valid",
  setup: setupOf(square(200), [{ id: 1, startDistance: 0 }]),
  ticks: 10,
  inputs: [{ fromTick: 0, cars: [pedals({ throttle: 1 })] }],
};

const badScenarios: [string, string][] = [
  ["an empty file", ""],
  ["text that is not JSON", "go fast"],
  ["a JSON array", "[]"],
  ["a missing name", JSON.stringify({ ...valid, name: undefined })],
  ["an empty name", JSON.stringify({ ...valid, name: " " })],
  ["an unknown field", JSON.stringify({ ...valid, seed: 4 })],
  ["zero ticks", JSON.stringify({ ...valid, ticks: 0 })],
  ["fractional ticks", JSON.stringify({ ...valid, ticks: 2.5 })],
  ["too many ticks", JSON.stringify({ ...valid, ticks: 1_000_001 })],
  ["no input segments", JSON.stringify({ ...valid, inputs: [] })],
  [
    "a first segment that does not start at tick 0",
    JSON.stringify({ ...valid, inputs: [{ fromTick: 1, cars: [pedals({})] }] }),
  ],
  [
    "segments out of order",
    JSON.stringify({
      ...valid,
      inputs: [
        { fromTick: 0, cars: [pedals({})] },
        { fromTick: 5, cars: [pedals({})] },
        { fromTick: 5, cars: [pedals({})] },
      ],
    }),
  ],
  [
    "a segment after the last tick",
    JSON.stringify({
      ...valid,
      inputs: [
        { fromTick: 0, cars: [pedals({})] },
        { fromTick: 10, cars: [pedals({})] },
      ],
    }),
  ],
  [
    "the wrong number of cars in a segment",
    JSON.stringify({
      ...valid,
      inputs: [{ fromTick: 0, cars: [pedals({}), pedals({})] }],
    }),
  ],
  [
    "an out-of-range pedal",
    JSON.stringify({
      ...valid,
      inputs: [{ fromTick: 0, cars: [pedals({ brake: 2 })] }],
    }),
  ],
  [
    "an invalid setup",
    JSON.stringify({ ...valid, setup: setupOf(square(200), []) }),
  ],
];

describe("the scenario runner fails cleanly", () => {
  test.each(badScenarios)("for %s", (label, content) => {
    const result = withScenarioFile(content, (file) =>
      runScenarioFile(runner, ["run", file]),
    );
    expect(result.code, label).not.toBe(0);
    expect(result.code, `${label}: must exit, not crash`).not.toBeNull();
    expect(result.stdout, label).toBe("");
    expect(result.stderr.trim(), label).not.toBe("");
    expect(result.stderr, label).not.toMatch(/panicked/);
  });

  test.each([
    ["no arguments", []],
    ["an unknown command", ["fly", "x.json"]],
    ["a missing file", ["run", "/definitely/not/here.json"]],
    ["too many arguments", ["run", "a.json", "b.json"]],
  ])("for %s", (label, args) => {
    const result = runScenarioFile(runner, args);
    expect(result.code, label).not.toBe(0);
    expect(result.code, label).not.toBeNull();
    expect(result.stdout, label).toBe("");
    expect(result.stderr.trim(), label).not.toBe("");
    expect(result.stderr, label).not.toMatch(/panicked/);
  });
});
