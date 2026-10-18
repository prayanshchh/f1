import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type {
  Input,
  Snapshot,
  WorldSetup,
} from "../../../apps/client/src/contracts/index.ts";
import {
  buildArtifacts,
  removeArtifacts,
  type Artifacts,
} from "../support/artifacts.ts";
import {
  hillLoop,
  randomInputs,
  replayNatively,
  setupOf,
  trackLength,
} from "../support/sim.ts";

interface BrowserWorld {
  step: (inputs: Input[]) => void;
  snapshot: () => Snapshot;
  stateHash: () => string;
  save: () => Uint8Array;
}

interface BrowserPhysics {
  default: () => Promise<unknown>;
  World: new (setup: WorldSetup) => BrowserWorld;
}

interface BrowserRun {
  hashes: string[];
  snapshot: Snapshot;
  save: number[];
}

let artifacts: Artifacts;

test.beforeAll(() => {
  test.setTimeout(600_000);
  artifacts = buildArtifacts();
  if (artifacts.problem !== null) {
    throw new Error(artifacts.problem);
  }
});

test.afterAll(() => {
  removeArtifacts(artifacts);
});

const contentTypes: Record<string, string> = {
  "physics.js": "text/javascript",
  "physics_bg.wasm": "application/wasm",
};

test("Chrome runs the WebAssembly physics tick for tick identically to the native server build", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(error.message);
  });
  await page.route("**/__f1/*", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    const type = contentTypes[name];
    if (type === undefined) {
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>physics</title>",
      });
      return;
    }
    await route.fulfill({
      contentType: type,
      body: readFileSync(path.join(artifacts.directory, name)),
    });
  });
  const track = hillLoop(160, 380);
  const setup = setupOf(track, [
    { id: 5, startDistance: 0 },
    { id: 63, startDistance: trackLength(track) / 3 },
    { id: 200, startDistance: trackLength(track) - Math.LN2 },
  ]);
  const inputs = randomInputs(77, 10_000, 3);
  await page.goto("/__f1/index.html");
  const browser = await page.evaluate(
    async ({ setup, inputs }): Promise<BrowserRun> => {
      const url = "/__f1/physics.js";
      const physics = (await import(url)) as BrowserPhysics;
      await physics.default();
      const world = new physics.World(setup);
      const hashes = [world.stateHash()];
      for (const tick of inputs) {
        world.step(tick);
        hashes.push(world.stateHash());
      }
      return {
        hashes,
        snapshot: world.snapshot(),
        save: Array.from(world.save()),
      };
    },
    { setup, inputs },
  );
  const native = replayNatively(artifacts.directory, setup, inputs);
  expect(browser.hashes).toHaveLength(10_001);
  const firstDifference = browser.hashes.findIndex(
    (hash, tick) => hash !== native.hashes[tick],
  );
  expect(
    firstDifference,
    "first tick where Chrome and the server disagree",
  ).toBe(-1);
  expect(browser.snapshot).toEqual(native.snapshot);
  expect(browser.save).toEqual([...Buffer.from(native.save, "base64")]);
  expect(problems).toEqual([]);
});
