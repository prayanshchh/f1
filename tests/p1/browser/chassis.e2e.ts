import { expect, test } from "@playwright/test";
import {
  buildArtifacts,
  removeArtifacts,
  type Artifacts,
} from "../../f1/support/artifacts.ts";
import { recordProblems, serveBundle } from "../../support/bundle.ts";
import {
  buildChassisReplay,
  replayChassis,
  tumblingDrop,
  type ChassisState,
  type DropStart,
} from "../support/chassis.ts";

interface BrowserChassis {
  step: () => void;
  state: () => ChassisState;
  stateHash: () => string;
  save: () => Uint8Array;
}

interface BrowserPhysics {
  default: () => Promise<unknown>;
  Chassis: new (start: DropStart) => BrowserChassis;
}

interface BrowserRun {
  hashes: string[];
  state: ChassisState;
  save: number[];
}

let artifacts: Artifacts;
let replay: string;

test.beforeAll(() => {
  test.setTimeout(600_000);
  artifacts = buildArtifacts();
  if (artifacts.problem !== null) {
    throw new Error(artifacts.problem);
  }
  replay = buildChassisReplay();
});

test.afterAll(() => {
  removeArtifacts(artifacts);
});

test("Chrome drops the car tick for tick identically to the native server build", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await serveBundle(page, { directory: artifacts.directory, remove() {} });
  const browser = await page.evaluate(async (start): Promise<BrowserRun> => {
    const url = "/__bundle/physics.js";
    const physics = (await import(url)) as BrowserPhysics;
    await physics.default();
    const chassis = new physics.Chassis(start);
    const hashes = [chassis.stateHash()];
    for (let tick = 0; tick < 10_000; tick += 1) {
      chassis.step();
      hashes.push(chassis.stateHash());
    }
    return {
      hashes,
      state: chassis.state(),
      save: Array.from(chassis.save()),
    };
  }, tumblingDrop);
  const native = replayChassis(replay, tumblingDrop, 10_000);
  expect(browser.hashes).toHaveLength(10_001);
  const firstDifference = browser.hashes.findIndex(
    (hash, tick) => hash !== native.hashes[tick],
  );
  expect(
    firstDifference,
    "first tick where Chrome and the server disagree",
  ).toBe(-1);
  expect(browser.state).toEqual(native.state);
  expect(browser.save).toEqual([...Buffer.from(native.save, "base64")]);
  expect(problems).toEqual([]);
});
