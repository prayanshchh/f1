import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  MAX_CARS,
  PHYSICS_HZ,
  SNAPSHOT_INTERVAL_TICKS,
  type CarSetup,
  type CarState,
  type ClientMessage,
  type Input,
  type Quat,
  type ServerMessage,
  type Snapshot,
  type TrackData,
  type Vec3,
  type WorldSetup,
} from "../../apps/client/src/contracts/index.ts";
import {
  cargoPackages,
  createProbeCopy,
  readManifest,
  repoRoot,
  run,
  type ProbeCopy,
} from "../support/repo.ts";

const contractsDirectory = "apps/client/src/contracts";

test("the timing constants are 500 physics ticks per second, a snapshot every 8 ticks and at most 22 cars", () => {
  expect(PHYSICS_HZ).toBe(500);
  expect(SNAPSHOT_INTERVAL_TICKS).toBe(8);
  expect(MAX_CARS).toBe(22);
  expect(PHYSICS_HZ / SNAPSHOT_INTERVAL_TICKS).toBe(62.5);
});

test("the TypeScript contracts have exactly the agreed shapes", () => {
  expectTypeOf<Vec3>().toEqualTypeOf<{ x: number; y: number; z: number }>();
  expectTypeOf<Quat>().toEqualTypeOf<{
    x: number;
    y: number;
    z: number;
    w: number;
  }>();
  expectTypeOf<Input>().toEqualTypeOf<{
    steer: number;
    throttle: number;
    brake: number;
    shiftUp: boolean;
    shiftDown: boolean;
  }>();
  expectTypeOf<CarState>().toEqualTypeOf<{
    id: number;
    position: Vec3;
    orientation: Quat;
    velocity: Vec3;
    angularVelocity: Vec3;
    lap: number;
    lapDistance: number;
  }>();
  expectTypeOf<Snapshot>().toEqualTypeOf<{ tick: number; cars: CarState[] }>();
  expectTypeOf<TrackData>().toEqualTypeOf<{
    name: string;
    width: number;
    centerline: Vec3[];
  }>();
  expectTypeOf<CarSetup>().toEqualTypeOf<{
    id: number;
    startDistance: number;
  }>();
  expectTypeOf<WorldSetup>().toEqualTypeOf<{
    track: TrackData;
    cars: CarSetup[];
  }>();
});

test("the network message contracts have exactly the agreed shapes", () => {
  expectTypeOf<ClientMessage>().toEqualTypeOf<
    | { type: "join"; name: string }
    | { type: "input"; tick: number; input: Input }
    | { type: "ping"; clientTime: number }
  >();
  expectTypeOf<ServerMessage>().toEqualTypeOf<
    | { type: "welcome"; carId: number; setup: WorldSetup; tick: number }
    | { type: "snapshot"; snapshot: Snapshot; lastInputTick: number }
    | { type: "pong"; clientTime: number; serverTick: number }
    | { type: "rejected"; reason: string }
  >();
});

test("the Rust crates are contracts, physics, physics-wasm and replay, and only physics-wasm touches JavaScript", () => {
  const packages = cargoPackages();
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  for (const name of ["contracts", "physics", "physics-wasm", "replay"]) {
    expect(
      path.relative(repoRoot, byName.get(name)?.manifest_path ?? ""),
      `package ${name}`,
    ).toBe(path.join("crates", name, "Cargo.toml"));
  }
  const kinds = (name: string) =>
    (byName.get(name)?.targets ?? []).flatMap((target) => target.kind);
  expect(kinds("physics-wasm")).toContain("cdylib");
  expect(kinds("replay")).toContain("bin");
  const dependsOn = (name: string) =>
    (byName.get(name)?.dependencies ?? [])
      .filter((dependency) => dependency.kind === null)
      .map((dependency) => dependency.name);
  expect(dependsOn("physics")).toContain("contracts");
  for (const name of ["physics-wasm", "replay"]) {
    expect(dependsOn(name), name).toEqual(
      expect.arrayContaining(["contracts", "physics"]),
    );
  }
  const javaScriptBridges = [
    "wasm-bindgen",
    "js-sys",
    "web-sys",
    "serde-wasm-bindgen",
    "tsify",
    "tsify-next",
    "gloo",
  ];
  for (const name of ["contracts", "physics", "replay"]) {
    expect(
      dependsOn(name).filter((dependency) =>
        javaScriptBridges.includes(dependency),
      ),
      `${name} must stay plain Rust so the server can use it`,
    ).toEqual([]);
  }
});

test("the build compiles the physics to WebAssembly into the git-ignored apps/client/wasm folder", () => {
  const scripts = readManifest("package.json").scripts ?? {};
  expect(scripts["build:wasm"], "build:wasm script").toEqual(
    expect.any(String),
  );
  expect(scripts["build"]).toMatch(/\bpnpm run build:wasm\b/);
  for (const file of ["physics.js", "physics_bg.wasm", "physics.d.ts"]) {
    const ignored = run("git", [
      "check-ignore",
      "--quiet",
      "--no-index",
      `apps/client/wasm/${file}`,
    ]);
    expect(ignored.code, `apps/client/wasm/${file} must be ignored`).toBe(0);
  }
});

function contractFiles(root: string): Map<string, string> {
  const directory = path.join(root, contractsDirectory);
  return new Map(
    readdirSync(directory, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .sort()
      .map((file) => [file, readFileSync(path.join(directory, file), "utf8")]),
  );
}

function rustFiles(copy: ProbeCopy): string[] {
  return readdirSync(path.join(copy.root, "crates/contracts/src"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => file.endsWith(".rs"))
    .map((file) => path.join("crates/contracts/src", file));
}

function renameSteerInRust(copy: ProbeCopy): void {
  const field = /^(\s*)pub steer: f64,$/m;
  const file = rustFiles(copy).find((candidate) =>
    field.test(copy.read(candidate)),
  );
  if (file === undefined) {
    throw new Error(
      "crates/contracts/src must declare the Input field as `pub steer: f64,`",
    );
  }
  copy.write(
    file,
    copy
      .read(file)
      .replace(field, '$1#[serde(rename = "steerProbe")]\n$1pub steer: f64,'),
  );
}

describe("the TypeScript contracts are generated from crates/contracts", () => {
  test("regenerating an up-to-date repo changes nothing", async () => {
    const copy = createProbeCopy();
    try {
      const before = contractFiles(copy.root);
      expect(before.size).toBeGreaterThan(0);
      const generate = await copy.runScript("contracts:generate");
      expect(generate.code, generate.output).toBe(0);
      expect(contractFiles(copy.root)).toEqual(before);
    } finally {
      copy.remove();
    }
  });

  test("a Rust contract change without regenerating fails check, and regenerating picks it up", async () => {
    const copy = createProbeCopy();
    try {
      renameSteerInRust(copy);
      const check = await copy.runScript("check");
      expect(check.code, check.output).not.toBe(0);
      expect(check.output).toMatch(/apps\/client\/src\/contracts/);
      const generate = await copy.runScript("contracts:generate");
      expect(generate.code, generate.output).toBe(0);
      const generated = [...contractFiles(copy.root).values()].join("\n");
      expect(generated).toMatch(/\bsteerProbe\b/);
      expect(generated).not.toMatch(/\bsteer\b(?!Probe)/);
    } finally {
      copy.remove();
    }
  });

  test("a hand edit to the generated TypeScript fails check", async () => {
    const copy = createProbeCopy();
    try {
      const fieldPair = /(\bx: number;)(\s*)(y: number;)/;
      const [file] = [...contractFiles(copy.root)]
        .filter(([, text]) => fieldPair.test(text))
        .map(([name]) => path.join(contractsDirectory, name));
      if (file === undefined) {
        throw new Error(
          "no generated contract declares `x: number; y: number;`",
        );
      }
      copy.write(file, copy.read(file).replace(fieldPair, "$3$2$1"));
      const check = await copy.runScript("check");
      expect(check.code, check.output).not.toBe(0);
      expect(check.output).toMatch(/apps\/client\/src\/contracts/);
    } finally {
      copy.remove();
    }
  });
});
