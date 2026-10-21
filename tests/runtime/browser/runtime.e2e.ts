import { expect, test, type Page } from "@playwright/test";
import type {
  Input,
  Snapshot,
  WorldSetup,
} from "../../../apps/client/src/contracts/index.ts";
import {
  buildArtifacts,
  removeArtifacts,
  type Artifacts,
} from "../../support/artifacts.ts";
import {
  hillLoop,
  idle,
  oneCar,
  replayNatively,
  setupOf,
  trackLength,
} from "../../support/sim.ts";
import { recordProblems } from "../../support/bundle.ts";

interface RuntimeState {
  tick: number;
  hash: string;
  snapshot: Snapshot;
  sentInputs: number;
}

interface Runtime {
  start: (options: {
    setup: WorldSetup;
    transport: "none" | "loopback";
  }) => Promise<void>;
  setInput: (input: Input) => void;
  state: () => RuntimeState;
  inputLog: () => Promise<Input[]>;
  stop: () => Promise<void>;
}

declare global {
  interface Window {
    f1: Runtime;
    hideTab: () => void;
  }
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

const track = hillLoop(150, 350);
const solo = oneCar(track);
const trio = setupOf(track, [
  { id: 4, startDistance: 0 },
  { id: 9, startDistance: trackLength(track) / 3 },
  { id: 27, startDistance: trackLength(track) / 2 },
]);

function installHiddenTabEmulation(): void {
  let hidden = false;
  const realTimeout = window.setTimeout.bind(window);
  const realInterval = window.setInterval.bind(window);
  const realFrame = window.requestAnimationFrame.bind(window);
  const throttled = (callback: () => void) => {
    let last = 0;
    return () => {
      const now = performance.now();
      if (hidden && now - last < 1000) {
        return false;
      }
      last = now;
      callback();
      return true;
    };
  };
  window.setTimeout = ((
    handler: TimerHandler,
    delay?: number,
    ...rest: unknown[]
  ) => {
    if (typeof handler !== "function") {
      return realTimeout(handler, delay);
    }
    const run = throttled(() => {
      (handler as (...values: unknown[]) => void)(...rest);
    });
    const attempt = () => {
      if (!run()) {
        realTimeout(attempt, 1000);
      }
    };
    return realTimeout(attempt, delay);
  }) as typeof window.setTimeout;
  window.setInterval = ((
    handler: TimerHandler,
    delay?: number,
    ...rest: unknown[]
  ) => {
    if (typeof handler !== "function") {
      return realInterval(handler, delay);
    }
    const run = throttled(() => {
      (handler as (...values: unknown[]) => void)(...rest);
    });
    return realInterval(() => {
      run();
    }, delay);
  }) as typeof window.setInterval;
  window.requestAnimationFrame = (callback) =>
    realFrame((time) => {
      if (!hidden) {
        callback(time);
      }
    });
  window.hideTab = () => {
    hidden = true;
    Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
    Object.defineProperty(document, "hidden", { get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  };
}

async function openPlay(page: Page): Promise<void> {
  await page.addInitScript(installHiddenTabEmulation);
  await page.goto("/play.html");
  await expect.poll(() => page.evaluate(() => typeof window.f1)).toBe("object");
}

async function start(
  page: Page,
  setup: WorldSetup,
  transport: "none" | "loopback" = "none",
): Promise<void> {
  await page.evaluate((options) => window.f1.start(options), {
    setup,
    transport,
  });
}

const state = (page: Page) => page.evaluate(() => window.f1.state());
const inputLog = (page: Page) => page.evaluate(() => window.f1.inputLog());

function stepsFor(setup: WorldSetup, log: Input[]): Input[][] {
  return log.map((input) =>
    setup.cars.map((_, index) => (index === 0 ? input : idle)),
  );
}

async function expectMatchesNative(
  page: Page,
  setup: WorldSetup,
  reads: { tick: number; hash: string }[],
): Promise<void> {
  const log = await inputLog(page);
  const highest = Math.max(...reads.map((read) => read.tick));
  expect(log.length).toBeGreaterThanOrEqual(highest);
  const native = replayNatively(
    artifacts.directory,
    setup,
    stepsFor(setup, log.slice(0, highest)),
  );
  const wrong = reads.filter((read) => native.hashes[read.tick] !== read.hash);
  expect(
    wrong.slice(0, 5),
    "state hashes read on the main thread must match the native build",
  ).toEqual([]);
}

test("every page is cross-origin isolated so SharedArrayBuffer is available", async ({
  page,
  request,
}) => {
  for (const route of ["/play.html", "/"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expect(response.headers()["cross-origin-opener-policy"], route).toBe(
      "same-origin",
    );
    expect(response.headers()["cross-origin-embedder-policy"], route).toBe(
      "require-corp",
    );
  }
  const problems = recordProblems(page);
  await openPlay(page);
  expect(
    await page.evaluate(() => [crossOriginIsolated, typeof SharedArrayBuffer]),
  ).toEqual([true, "function"]);
  expect(problems).toEqual([]);
});

test("the world steps in a worker in real time and matches the native build", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await openPlay(page);
  const early = await page.evaluate(() => {
    try {
      window.f1.state();
      return "read";
    } catch (error) {
      return error instanceof Error ? "Error" : String(error);
    }
  });
  expect(early, "there is no state before start").toBe("Error");
  await start(page, solo);
  expect(page.workers().length).toBeGreaterThanOrEqual(1);
  const first = await state(page);
  const started = Date.now();
  await page.waitForTimeout(2000);
  const second = await state(page);
  const rate = ((second.tick - first.tick) * 1000) / (Date.now() - started);
  expect(rate).toBeGreaterThanOrEqual(475);
  expect(rate).toBeLessThanOrEqual(525);
  expect(second.snapshot.tick).toBe(second.tick);
  await expectMatchesNative(page, solo, [first, second]);
  const mainThreadWasm = await page.evaluate(
    () =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.endsWith(".wasm")).length,
  );
  expect(
    mainThreadWasm,
    "the WebAssembly world must be loaded by the worker, not the page",
  ).toBe(0);
  expect(problems).toEqual([]);
});

test("blocking the main thread for 200 ms changes neither the tick rate nor the hashes", async ({
  page,
}) => {
  await openPlay(page);
  await start(page, solo);
  await page.waitForTimeout(300);
  const reads = await page.evaluate(() => {
    const seen: { tick: number; hash: string; at: number }[] = [];
    const begin = performance.now();
    window.f1.setInput({
      steer: 0,
      throttle: 1,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
    let switched = false;
    while (performance.now() - begin < 200) {
      const now = performance.now() - begin;
      if (!switched && now >= 100) {
        window.f1.setInput({
          steer: 0.25,
          throttle: 0,
          brake: 0.6,
          shiftUp: false,
          shiftDown: false,
        });
        switched = true;
      }
      const current = window.f1.state();
      if (seen.at(-1)?.tick !== current.tick) {
        seen.push({ tick: current.tick, hash: current.hash, at: now });
      }
    }
    return seen;
  });
  const first = reads[0];
  const last = reads.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("no state was read during the block");
  }
  for (const [index, read] of reads.slice(1).entries()) {
    expect(read.tick).toBeGreaterThan(reads[index]?.tick ?? 0);
  }
  const rate = ((last.tick - first.tick) * 1000) / (last.at - first.at);
  expect(
    rate,
    "ticks per second while the page was blocked",
  ).toBeGreaterThanOrEqual(450);
  expect(rate).toBeLessThanOrEqual(550);
  const log = await inputLog(page);
  const during = log.slice(first.tick, last.tick);
  expect(
    during.some((input) => input.throttle === 1),
    "input written during the block reached the worker",
  ).toBe(true);
  expect(
    during.some((input) => input.brake === 0.6 && input.steer === 0.25),
  ).toBe(true);
  await expectMatchesNative(page, solo, reads);
});

test("state reads are never torn between the world's buffers", async ({
  page,
}) => {
  await openPlay(page);
  await start(page, trio);
  const reads = await page.evaluate(async () => {
    const seen: {
      tick: number;
      hash: string;
      snapshotTick: number;
      cars: number;
    }[] = [];
    for (let round = 0; round < 40; round += 1) {
      window.f1.setInput({
        steer: 0,
        throttle: round % 2,
        brake: 0,
        shiftUp: false,
        shiftDown: false,
      });
      for (let read = 0; read < 50; read += 1) {
        const current = window.f1.state();
        seen.push({
          tick: current.tick,
          hash: current.hash,
          snapshotTick: current.snapshot.tick,
          cars: current.snapshot.cars.length,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return seen;
  });
  for (const [index, read] of reads.entries()) {
    expect(read.snapshotTick).toBe(read.tick);
    expect(read.cars).toBe(3);
    if (index > 0) {
      expect(read.tick).toBeGreaterThanOrEqual(reads[index - 1]?.tick ?? 0);
    }
  }
  await expectMatchesNative(page, trio, reads);
});

test("a hidden tab keeps stepping and sending inputs", async ({ page }) => {
  await openPlay(page);
  await start(page, solo, "loopback");
  await page.evaluate(() => {
    window.f1.setInput({
      steer: 0,
      throttle: 1,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
    window.hideTab();
  });
  expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");
  const first = await state(page);
  const started = Date.now();
  let previous = first;
  for (let window = 0; window < 20; window += 1) {
    await page.waitForTimeout(100);
    const current = await state(page);
    expect(
      current.tick - previous.tick,
      "the worker must step steadily, not in bursts",
    ).toBeGreaterThanOrEqual(25);
    expect(
      current.sentInputs - previous.sentInputs,
      "inputs must go out steadily",
    ).toBeGreaterThanOrEqual(25);
    previous = current;
  }
  const second = await state(page);
  const seconds = (Date.now() - started) / 1000;
  const ticks = second.tick - first.tick;
  expect(ticks / seconds).toBeGreaterThanOrEqual(450);
  expect(ticks / seconds).toBeLessThanOrEqual(550);
  expect(
    Math.abs(second.sentInputs - first.sentInputs - ticks),
    "one input is sent per tick",
  ).toBeLessThanOrEqual(2);
  expect(second.sentInputs).toBeGreaterThan(0);
  await expectMatchesNative(page, solo, [first, second]);
});

test("without a transport nothing is sent", async ({ page }) => {
  await openPlay(page);
  await start(page, solo);
  await page.waitForTimeout(500);
  expect((await state(page)).sentInputs).toBe(0);
});

test("a shift tap shorter than a tick is applied exactly once", async ({
  page,
}) => {
  await openPlay(page);
  await start(page, solo);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const up = {
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: true,
      shiftDown: false,
    };
    const released = { ...up, shiftUp: false };
    window.f1.setInput(up);
    window.f1.setInput(released);
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const down = {
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: false,
      shiftDown: true,
    };
    window.f1.setInput(down);
    window.f1.setInput({ ...down, shiftDown: false });
  });
  await page.waitForTimeout(100);
  const log = await inputLog(page);
  expect(log.filter((input) => input.shiftUp)).toHaveLength(1);
  expect(log.filter((input) => input.shiftDown)).toHaveLength(1);
});

test("the keyboard on the main thread drives the car in the worker", async ({
  page,
}) => {
  await openPlay(page);
  await start(page, solo);
  const pressedAt = (await state(page)).tick;
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(600);
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(600);
  const releasedAt = (await state(page)).tick;
  const log = await inputLog(page);
  expect(log.slice(0, pressedAt).every((input) => input.throttle === 0)).toBe(
    true,
  );
  expect(
    Math.max(
      ...log.slice(pressedAt, releasedAt).map((input) => input.throttle),
    ),
  ).toBe(1);
  expect(
    log
      .slice(releasedAt - 50, releasedAt)
      .every((input) => input.throttle === 0),
  ).toBe(true);
});

test("invalid inputs are refused on the main thread and leave the slot unchanged", async ({
  page,
}) => {
  await openPlay(page);
  await start(page, solo);
  const errors = await page.evaluate(() => {
    window.f1.setInput({
      steer: 0,
      throttle: 0.5,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
    return [
      { steer: 0, throttle: 2, brake: 0, shiftUp: false, shiftDown: false },
      {
        steer: Number.NaN,
        throttle: 0,
        brake: 0,
        shiftUp: false,
        shiftDown: false,
      },
      { steer: 0, throttle: 0, brake: -1, shiftUp: false, shiftDown: false },
    ].map((input) => {
      try {
        window.f1.setInput(input);
        return "accepted";
      } catch (error) {
        return error instanceof RangeError ? "RangeError" : String(error);
      }
    });
  });
  expect(errors).toEqual(["RangeError", "RangeError", "RangeError"]);
  await page.waitForTimeout(100);
  expect((await inputLog(page)).at(-1)?.throttle).toBe(0.5);
});

test("the runtime stops, restarts from tick zero and refuses double starts and bad setups", async ({
  page,
}) => {
  await openPlay(page);
  await start(page, solo);
  const doubleStart = await page.evaluate(
    (setup) =>
      window.f1.start({ setup, transport: "none" }).then(
        () => "accepted",
        (error: unknown) => (error instanceof Error ? "Error" : String(error)),
      ),
    solo,
  );
  expect(doubleStart).toBe("Error");
  await page.evaluate(() => window.f1.stop());
  await expect.poll(() => page.workers().length).toBe(0);
  const afterStop = await page.evaluate(() => {
    try {
      window.f1.state();
      return "read";
    } catch (error) {
      return error instanceof Error ? "Error" : String(error);
    }
  });
  expect(afterStop).toBe("Error");
  const bad = await page.evaluate(
    (setup) =>
      window.f1.start({ setup, transport: "none" }).then(
        () => "accepted",
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      ),
    setupOf(track, []),
  );
  expect(bad).not.toBe("accepted");
  expect(bad.trim()).not.toBe("");
  await expect.poll(() => page.workers().length).toBe(0);
  await start(page, solo);
  expect((await state(page)).tick).toBeLessThan(100);
  await page.waitForTimeout(300);
  await expectMatchesNative(page, solo, [await state(page)]);
});
