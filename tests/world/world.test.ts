import { beforeAll, describe, expect, inject, test } from "vitest";
import type {
  Input,
  Snapshot,
  WorldSetup,
} from "../../apps/client/src/contracts/index.ts";
import {
  caughtError,
  carAt,
  distanceBetween,
  hillLoop,
  idle,
  magnitude,
  loadWorldClass,
  oneCar,
  pedals,
  pointAt,
  randomInputs,
  randomSource,
  rotate,
  runSteps,
  setupOf,
  speedOf,
  square,
  TICK_SECONDS,
  trackLength,
  unit,
  type WorldClass,
  type WorldHandle,
} from "../support/sim.ts";

let World: WorldClass;

beforeAll(async () => {
  const artifacts = inject("f1Artifacts");
  if (artifacts.problem !== null) {
    throw new Error(artifacts.problem);
  }
  World = await loadWorldClass(artifacts.directory);
});

const throttle = pedals({ throttle: 1 });
const brake = pedals({ brake: 1 });

function drive(world: WorldHandle, input: Input, ticks: number): Snapshot[] {
  return Array.from({ length: ticks }, () => {
    world.step([input]);
    return world.snapshot();
  });
}

function expectRejection(action: () => unknown, label: string): void {
  const error = caughtError(action);
  expect(error, `${label}: must throw`).toBeInstanceOf(Error);
  expect(
    error,
    `${label}: must be a handled error, not a WebAssembly crash`,
  ).not.toBeInstanceOf(WebAssembly.RuntimeError);
  expect((error as Error).message.trim(), `${label}: message`).not.toBe("");
}

function expectClose(actual: number, expected: number, label: string): void {
  expect(Math.abs(actual - expected), label).toBeLessThan(1e-6);
}

describe("a new world", () => {
  test("puts every car on the centerline at its start distance, at rest, at tick 0", () => {
    const track = hillLoop(48, 180);
    const length = trackLength(track);
    const starts = [0, 0.5, length / 3, length - 1e-6];
    const world = new World(
      setupOf(
        track,
        starts.map((startDistance, index) => ({
          id: index * 3 + 1,
          startDistance,
        })),
      ),
    );
    const snapshot = world.snapshot();
    expect(snapshot.tick).toBe(0);
    expect(snapshot.cars.map((car) => car.id)).toEqual([1, 4, 7, 10]);
    for (const [index, car] of snapshot.cars.entries()) {
      const start = starts[index] ?? 0;
      const expected = pointAt(track, start).position;
      expect(car.lap).toBe(0);
      expect(car.lapDistance).toBe(start);
      expect(distanceBetween(car.position, expected)).toBeLessThan(1e-6);
      expect(magnitude(car.velocity)).toBe(0);
      expect(magnitude(car.angularVelocity)).toBe(0);
    }
  });

  test("passes numbers through exactly: a car starting at 0 sits exactly on the first centerline point", () => {
    const track = hillLoop(32, 140);
    const world = new World(oneCar(track));
    expect(carAt(world.snapshot()).position).toEqual(track.centerline[0]);
  });

  test("reads every one of 6,600 random 17-digit start distances back bit for bit", () => {
    const track = hillLoop(32, 140);
    const lap = trackLength(track);
    const next = randomSource(404);
    for (let round = 0; round < 300; round += 1) {
      const starts = Array.from({ length: 22 }, () => next() * lap);
      const world = new World(
        setupOf(
          track,
          starts.map((startDistance, id) => ({ id, startDistance })),
        ),
      );
      expect(world.snapshot().cars.map((car) => car.lapDistance)).toEqual(
        starts,
      );
    }
  });

  test("returns snapshots as plain JSON objects with exactly the contract fields", () => {
    const world = new World(oneCar(square(40)));
    drive(world, throttle, 10);
    const snapshot = world.snapshot();
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(Object.keys(snapshot).sort()).toEqual(["cars", "tick"]);
    const car = carAt(snapshot);
    expect(Object.keys(car).sort()).toEqual(
      [
        "angularVelocity",
        "id",
        "lap",
        "lapDistance",
        "orientation",
        "position",
        "velocity",
      ].sort(),
    );
    for (const vector of [car.position, car.velocity, car.angularVelocity]) {
      expect(Object.keys(vector).sort()).toEqual(["x", "y", "z"]);
    }
    expect(Object.keys(car.orientation).sort()).toEqual(["w", "x", "y", "z"]);
  });

  test("accepts exactly 1 and exactly 22 cars", () => {
    const track = square(200);
    const grid = Array.from({ length: 22 }, (_, index) => ({
      id: 255 - index,
      startDistance: index * 8,
    }));
    expect(new World(setupOf(track, grid)).snapshot().cars).toHaveLength(22);
    expect(
      new World(setupOf(track, [{ id: 0, startDistance: 0 }])).snapshot().cars,
    ).toHaveLength(1);
  });
});

describe("axes and units", () => {
  test("uses metres, +Y up, and car-local +Z forward, +Y up, +X left", () => {
    const world = new World(oneCar(square(30), 5));
    const car = carAt(world.snapshot());
    expect(car.position).toEqual({ x: 0, y: 0, z: 5 });
    const forward = rotate(car.orientation, { x: 0, y: 0, z: 1 });
    const up = rotate(car.orientation, { x: 0, y: 1, z: 0 });
    const left = rotate(car.orientation, { x: 1, y: 0, z: 0 });
    expectClose(forward.z, 1, "forward is +Z on the first side");
    expectClose(up.y, 1, "up is +Y");
    expectClose(left.x, 1, "left is +X when driving towards +Z");
    const turned = new World(oneCar(square(30), 45));
    const facing = rotate(carAt(turned.snapshot()).orientation, {
      x: 0,
      y: 0,
      z: 1,
    });
    expectClose(facing.x, 1, "after the first corner the car faces +X");
  });

  test("points the car along the slope on hills without rolling it", () => {
    const track = hillLoop(40, 160);
    const length = trackLength(track);
    for (let step = 0; step < 40; step += 1) {
      const distance = (length * (step + 0.37)) / 40;
      const car = carAt(new World(oneCar(track, distance)).snapshot());
      const { forward } = pointAt(track, distance);
      const { x, y, z, w } = car.orientation;
      expectClose(
        Math.hypot(x, y, z, w),
        1,
        "orientation is a unit quaternion",
      );
      const carForward = rotate(car.orientation, { x: 0, y: 0, z: 1 });
      const carLeft = rotate(car.orientation, { x: 1, y: 0, z: 0 });
      expect(distanceBetween(carForward, forward)).toBeLessThan(1e-6);
      expectClose(carLeft.y, 0, "the left axis stays level");
      expect(
        rotate(car.orientation, { x: 0, y: 1, z: 0 }).y,
        "up still points upward",
      ).toBeGreaterThan(0);
    }
  });

  test("advances 500 ticks per second: each tick moves the car by its speed times 1/500 s", () => {
    const track = square(500);
    const world = new World(oneCar(track));
    let previous = world.snapshot();
    for (const snapshot of drive(world, throttle, 1500)) {
      const moved = carAt(snapshot).lapDistance - carAt(previous).lapDistance;
      const low = Math.min(speedOf(previous), speedOf(snapshot)) * TICK_SECONDS;
      const high =
        Math.max(speedOf(previous), speedOf(snapshot)) * TICK_SECONDS;
      expect(moved).toBeGreaterThanOrEqual(low - 1e-9);
      expect(moved).toBeLessThanOrEqual(high + 1e-9);
      expect(snapshot.tick).toBe(previous.tick + 1);
      previous = snapshot;
    }
  });

  test("accelerates like a racing car in metres per second: 0 to 100 km/h in 1.5 to 4 seconds, top speed 70 to 100 m/s", () => {
    const world = new World(oneCar(square(2000)));
    const speeds = drive(world, throttle, 30_000).map((snapshot) =>
      speedOf(snapshot),
    );
    const reached = speeds.findIndex((speed) => speed >= 100 / 3.6);
    expect(reached).toBeGreaterThanOrEqual(0);
    expect((reached + 1) * TICK_SECONDS).toBeGreaterThanOrEqual(1.5);
    expect((reached + 1) * TICK_SECONDS).toBeLessThanOrEqual(4);
    const top = Math.max(...speeds);
    expect(top).toBeGreaterThanOrEqual(70);
    expect(top).toBeLessThanOrEqual(100);
    for (const [index, speed] of speeds.entries()) {
      expect(speed, `tick ${String(index)}`).toBeGreaterThanOrEqual(
        speeds[index - 1] ?? 0,
      );
    }
  });
});

describe("the stub car", () => {
  test("moves along the track direction and stays on the centerline whatever the steering", () => {
    const track = hillLoop(64, 120);
    const world = new World(oneCar(track));
    const inputs = randomInputs(11, 6000, 1);
    for (const [index, tick] of inputs.entries()) {
      world.step(tick);
      const car = carAt(world.snapshot());
      const expected = pointAt(track, car.lapDistance);
      expect(
        distanceBetween(car.position, expected.position),
        `tick ${String(index + 1)}`,
      ).toBeLessThan(1e-6);
      if (speedOf(world.snapshot()) > 0) {
        expect(
          distanceBetween(unit(car.velocity), expected.forward),
        ).toBeLessThan(1e-6);
      }
    }
  });

  test("brakes to exactly zero within 0.5 to 5 seconds from 50 m/s and never rolls backwards", () => {
    const world = new World(oneCar(square(3000)));
    let ticks = 0;
    while (speedOf(world.snapshot()) < 50 && ticks < 20_000) {
      world.step([throttle]);
      ticks += 1;
    }
    expect(speedOf(world.snapshot())).toBeGreaterThanOrEqual(50);
    const braking = drive(world, brake, 3000);
    const stopped = braking.findIndex((snapshot) => speedOf(snapshot) === 0);
    expect((stopped + 1) * TICK_SECONDS).toBeGreaterThanOrEqual(0.5);
    expect((stopped + 1) * TICK_SECONDS).toBeLessThanOrEqual(5);
    let previous = Infinity;
    for (const snapshot of braking.slice(0, stopped + 1)) {
      expect(speedOf(snapshot)).toBeLessThan(previous);
      previous = speedOf(snapshot);
    }
    const restingDistance = carAt(
      braking[stopped] ?? world.snapshot(),
    ).lapDistance;
    for (const snapshot of braking.slice(stopped)) {
      expect(speedOf(snapshot)).toBe(0);
      expect(carAt(snapshot).lapDistance).toBe(restingDistance);
    }
  });

  test("never speeds up while coasting", () => {
    const world = new World(oneCar(square(3000)));
    drive(world, throttle, 2000);
    let previous = speedOf(world.snapshot());
    for (const snapshot of drive(world, idle, 2000)) {
      expect(speedOf(snapshot)).toBeLessThanOrEqual(previous);
      previous = speedOf(snapshot);
    }
  });

  test("counts laps: lap goes up by exactly one each time lapDistance wraps, and lapDistance stays within the track", () => {
    const track = square(20);
    const length = trackLength(track);
    const world = new World(oneCar(track, 70));
    let previous = carAt(world.snapshot());
    for (const snapshot of drive(world, throttle, 6000)) {
      const car = carAt(snapshot);
      expect(car.lapDistance).toBeGreaterThanOrEqual(0);
      expect(car.lapDistance).toBeLessThan(length);
      expect(car.lap - previous.lap).toBe(
        car.lapDistance < previous.lapDistance ? 1 : 0,
      );
      previous = car;
    }
    expect(previous.lap).toBeGreaterThanOrEqual(5);
  });

  test("ignores steering: the same pedals give the same state whatever the steering", () => {
    const track = hillLoop(64, 120);
    const straight = new World(oneCar(track));
    const steered = new World(oneCar(track));
    for (const [tick] of randomInputs(31, 4000, 1)) {
      const input = tick ?? idle;
      straight.step([{ ...input, steer: 0 }]);
      steered.step([input]);
      expect(steered.snapshot()).toEqual(straight.snapshot());
    }
    expect(steered.stateHash()).toBe(straight.stateHash());
  });

  test("moves each car only by its own input", () => {
    const track = square(400);
    const setup = setupOf(track, [
      { id: 1, startDistance: 0 },
      { id: 2, startDistance: 100 },
    ]);
    const together = new World(setup);
    const alone = new World(oneCar(track));
    for (let tick = 0; tick < 1000; tick += 1) {
      together.step([throttle, tick % 2 === 0 ? brake : idle]);
      alone.step([throttle]);
    }
    const [first, second] = together.snapshot().cars;
    const solo = carAt(alone.snapshot());
    expect({ ...first, id: solo.id }).toEqual(solo);
    expect(second?.lapDistance).toBe(100);
    expect(magnitude(second?.velocity ?? { x: 1, y: 0, z: 0 })).toBe(0);
  });
});

describe("the state hash", () => {
  test("is 16 lowercase hex digits, stable when read twice, and equal for equal worlds", () => {
    const setup = oneCar(hillLoop(24, 90), 3);
    const first = new World(setup);
    const second = new World(setup);
    expect(first.stateHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(first.stateHash()).toBe(first.stateHash());
    expect(first.stateHash()).toBe(second.stateHash());
  });

  test("changes on every tick, even when nothing moves", () => {
    const world = new World(oneCar(square(50)));
    const hashes = runSteps(
      world,
      Array.from({ length: 300 }, () => [brake]),
    );
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test("covers the whole state: track, car ids and the last bit of a start distance", () => {
    const base = oneCar(square(50), 1);
    const variants: WorldSetup[] = [
      oneCar(square(50, "Other name"), 1),
      oneCar(square(50.000000001), 1),
      { ...base, track: { ...base.track, width: 12.5 } },
      setupOf(square(50), [{ id: 8, startDistance: 1 }]),
      oneCar(square(50), 1 + Number.EPSILON),
    ];
    const hashes = [base, ...variants].map((setup) =>
      new World(setup).stateHash(),
    );
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("save and load", () => {
  function savedMidRace(): { world: WorldHandle; bytes: Uint8Array } {
    const world = new World(
      setupOf(hillLoop(30, 100), [
        { id: 3, startDistance: 0 },
        { id: 9, startDistance: 250.25 },
      ]),
    );
    runSteps(world, randomInputs(5, 777, 2));
    return { world, bytes: world.save() };
  }

  test("restores the exact state and the run continues identically", () => {
    const { world, bytes } = savedMidRace();
    const hashBefore = world.stateHash();
    expect(world.save()).toEqual(bytes);
    expect(world.stateHash()).toBe(hashBefore);
    const loaded = World.load(bytes);
    expect(loaded.snapshot()).toEqual(world.snapshot());
    expect(loaded.stateHash()).toBe(hashBefore);
    expect(loaded.save()).toEqual(bytes);
    const future = randomInputs(6, 1000, 2);
    expect(runSteps(loaded, future)).toEqual(runSteps(world, future));
  });

  test("does not depend on the copy of the bytes it was given", () => {
    const { world, bytes } = savedMidRace();
    const copy = bytes.slice();
    const loaded = World.load(copy);
    copy.fill(0);
    expect(loaded.stateHash()).toBe(world.stateHash());
  });

  test("rejects empty, short, random and padded data", () => {
    const { bytes } = savedMidRace();
    const next = randomSource(9);
    const random = Uint8Array.from(bytes, () => Math.floor(next() * 256));
    const cases: [string, Uint8Array][] = [
      ["empty", new Uint8Array()],
      ["one byte", Uint8Array.of(1)],
      ["random bytes", random],
      ["an extra byte at the end", Uint8Array.of(...bytes, 0)],
      ["the save twice", Uint8Array.of(...bytes, ...bytes)],
    ];
    for (const [label, data] of cases) {
      expectRejection(() => World.load(data), label);
    }
  });

  test("rejects every truncation of a save", () => {
    const { bytes } = savedMidRace();
    for (let size = 0; size < bytes.length; size += 1) {
      expectRejection(
        () => World.load(bytes.slice(0, size)),
        `first ${String(size)} bytes`,
      );
    }
  });

  test("rejects a save with any single bit flipped", () => {
    const { bytes } = savedMidRace();
    for (let index = 0; index < bytes.length; index += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        const corrupted = bytes.slice();
        corrupted[index] = (corrupted[index] ?? 0) ^ (1 << bit);
        expectRejection(
          () => World.load(corrupted),
          `byte ${String(index)} bit ${String(bit)}`,
        );
      }
    }
  });
});

const goodTrack = square(100);

function track(change: Record<string, unknown>): unknown {
  return {
    track: { ...goodTrack, ...change },
    cars: [{ id: 1, startDistance: 0 }],
  };
}

function cars(list: unknown): Record<string, unknown> {
  return { track: goodTrack, cars: list };
}

const point = (x: number, y: number, z: number) => ({ x, y, z });

const invalidSetups: [string, unknown][] = [
  ["no setup", undefined],
  ["null", null],
  ["a string", "setup"],
  ["no cars", cars([])],
  [
    "23 cars",
    cars(Array.from({ length: 23 }, (_, id) => ({ id, startDistance: id }))),
  ],
  [
    "a repeated car id",
    cars([
      { id: 4, startDistance: 0 },
      { id: 4, startDistance: 9 },
    ]),
  ],
  ["car id 256", cars([{ id: 256, startDistance: 0 }])],
  ["car id -1", cars([{ id: -1, startDistance: 0 }])],
  ["car id 1.5", cars([{ id: 1.5, startDistance: 0 }])],
  ["a negative start distance", cars([{ id: 1, startDistance: -0.001 }])],
  [
    "a start distance equal to the lap length",
    cars([{ id: 1, startDistance: 400 }]),
  ],
  ["a start distance beyond the lap", cars([{ id: 1, startDistance: 1e9 }])],
  ["a NaN start distance", cars([{ id: 1, startDistance: Number.NaN }])],
  ["an infinite start distance", cars([{ id: 1, startDistance: Infinity }])],
  ["a missing start distance", cars([{ id: 1 }])],
  ["an unknown car field", cars([{ id: 1, startDistance: 0, colour: "red" }])],
  ["a missing track", { cars: [{ id: 1, startDistance: 0 }] }],
  [
    "an unknown setup field",
    { ...cars([{ id: 1, startDistance: 0 }]), weather: "rain" },
  ],
  ["an unknown track field", track({ surface: "asphalt" })],
  ["an empty track name", track({ name: "" })],
  ["a blank track name", track({ name: "   " })],
  ["zero width", track({ width: 0 })],
  ["negative width", track({ width: -12 })],
  ["infinite width", track({ width: Infinity })],
  ["a width given as text", track({ width: "12" })],
  [
    "two centerline points",
    track({ centerline: [point(0, 0, 0), point(0, 0, 10)] }),
  ],
  ["no centerline points", track({ centerline: [] })],
  [
    "a repeated centerline point",
    track({
      centerline: [
        point(0, 0, 0),
        point(0, 0, 10),
        point(0, 0, 10),
        point(10, 0, 0),
      ],
    }),
  ],
  [
    "a closing point equal to the first",
    track({
      centerline: [
        point(0, 0, 0),
        point(0, 0, 10),
        point(10, 0, 10),
        point(0, 0, 0),
      ],
    }),
  ],
  [
    "a vertical centerline segment",
    track({
      centerline: [
        point(0, 0, 0),
        point(0, 5, 0),
        point(10, 5, 10),
        point(10, 0, 0),
      ],
    }),
  ],
  [
    "a NaN coordinate",
    track({
      centerline: [point(0, 0, 0), point(0, Number.NaN, 10), point(10, 0, 0)],
    }),
  ],
  [
    "an infinite coordinate",
    track({
      centerline: [point(0, 0, 0), point(0, 0, Infinity), point(10, 0, 0)],
    }),
  ],
  [
    "a point missing z",
    track({ centerline: [point(0, 0, 0), { x: 0, y: 0 }, point(10, 0, 0)] }),
  ],
];

test.each(invalidSetups)("refuses to build a world from %s", (label, setup) => {
  expectRejection(() => new World(setup), label);
});

const invalidSteps: [string, unknown][] = [
  ["no inputs", []],
  ["too many inputs", [throttle, throttle, throttle]],
  ["null", null],
  ["an input object instead of a list", throttle],
  ["steer above 1", [pedals({ steer: 1.000001 }), idle]],
  ["steer below -1", [pedals({ steer: -1.000001 }), idle]],
  ["negative throttle", [pedals({ throttle: -0.0001 }), idle]],
  ["throttle above 1", [pedals({ throttle: 1.0001 }), idle]],
  ["negative brake", [idle, pedals({ brake: -0.5 })]],
  ["brake above 1", [idle, pedals({ brake: 2 })]],
  ["NaN steer", [pedals({ steer: Number.NaN }), idle]],
  ["infinite throttle", [pedals({ throttle: Infinity }), idle]],
  ["steer as text", [{ ...idle, steer: "left" }, idle]],
  ["shiftUp as a number", [{ ...idle, shiftUp: 1 }, idle]],
  [
    "a missing brake",
    [{ steer: 0, throttle: 0, shiftUp: false, shiftDown: false }, idle],
  ],
  ["a misspelt field", [{ ...idle, throttel: 1 }, idle]],
  ["a null input", [null, idle]],
];

describe("a step with bad inputs", () => {
  test.each(invalidSteps)(
    "is refused for %s and leaves the world untouched",
    (label, inputs) => {
      const world = new World(
        setupOf(square(100), [
          { id: 1, startDistance: 0 },
          { id: 2, startDistance: 50 },
        ]),
      );
      world.step([throttle, throttle]);
      const before = world.snapshot();
      const hash = world.stateHash();
      expectRejection(() => {
        world.step(inputs);
      }, label);
      expect(world.snapshot()).toEqual(before);
      expect(world.stateHash()).toBe(hash);
    },
  );

  test("leaves the world working exactly as if the bad steps never happened", () => {
    const setup = setupOf(square(100), [
      { id: 1, startDistance: 0 },
      { id: 2, startDistance: 50 },
    ]);
    const clean = new World(setup);
    const abused = new World(setup);
    const inputs = randomInputs(21, 400, 2);
    for (const [index, tick] of inputs.entries()) {
      const bad = invalidSteps[index % invalidSteps.length]?.[1];
      expectRejection(
        () => {
          abused.step(bad);
        },
        `bad step ${String(index)}`,
      );
      abused.step(tick);
      clean.step(tick);
    }
    expect(abused.stateHash()).toBe(clean.stateHash());
    expect(abused.snapshot()).toEqual(clean.snapshot());
  });

  test("accepts the exact limits of every input", () => {
    const world = new World(
      setupOf(square(100), [
        { id: 1, startDistance: 0 },
        { id: 2, startDistance: 50 },
      ]),
    );
    const limits = [
      [
        pedals({ steer: -1, throttle: 0, brake: 1 }),
        pedals({ steer: 1, throttle: 1, brake: 0 }),
      ],
      [pedals({ steer: -0, shiftUp: true }), pedals({ shiftDown: true })],
      [pedals({ steer: 1, throttle: 1, brake: 1 }), idle],
    ];
    for (const inputs of limits) {
      world.step(inputs);
    }
    expect(world.snapshot().tick).toBe(3);
  });
});
