import { expect, test, type Page } from "@playwright/test";
import {
  bundleModule,
  recordProblems,
  serveBundle,
  type Bundle,
} from "../../support/bundle.ts";
import { bandEnergy, centroid, fundamental, rms } from "../support/spectrum.ts";

const RATE = 48_000;

interface AudioFrame {
  rpm: number;
  load: number;
  tyreSlip: number;
  speed: number;
}

interface Scheduled {
  time: number;
  frame: AudioFrame;
}

interface AudioModule {
  firingFrequency: (rpm: number) => number;
  createCarAudio: (
    context: BaseAudioContext,
    destination: AudioNode,
  ) => {
    update: (frame: AudioFrame, time: number) => void;
    dispose: () => void;
  };
}

declare global {
  interface Window {
    audioModule: AudioModule;
  }
}

let bundle: Bundle;

test.beforeAll(async () => {
  bundle = await bundleModule("apps/client/src/audio/index.ts");
});

test.afterAll(() => {
  bundle.remove();
});

async function load(page: Page): Promise<void> {
  await serveBundle(page, bundle);
  await page.evaluate(async () => {
    const url = "/__bundle/module.js";
    window.audioModule = (await import(url)) as AudioModule;
  });
}

async function render(
  page: Page,
  seconds: number,
  schedule: Scheduled[],
  disposeAt: number | null = null,
): Promise<Float32Array> {
  const samples = await page.evaluate(
    async ({ seconds, schedule, disposeAt, rate }) => {
      const context = new OfflineAudioContext(
        1,
        Math.round(seconds * rate),
        rate,
      );
      const audio = window.audioModule.createCarAudio(
        context,
        context.destination,
      );
      for (const { time, frame } of schedule) {
        audio.update(frame, time);
      }
      const disposed =
        disposeAt === null
          ? Promise.resolve()
          : context.suspend(disposeAt).then(() => {
              audio.dispose();
              return context.resume();
            });
      const buffer = await context.startRendering();
      await disposed;
      return Array.from(buffer.getChannelData(0));
    },
    { seconds, schedule, disposeAt, rate: RATE },
  );
  return Float32Array.from(samples);
}

function frame(change: Partial<AudioFrame>): AudioFrame {
  return { rpm: 9000, load: 0.6, tyreSlip: 0, speed: 50, ...change };
}

function expectClean(samples: Float32Array): void {
  let broken = 0;
  let worst = 0;
  for (const value of samples) {
    broken += Number.isFinite(value) ? 0 : 1;
    worst = Math.max(worst, Math.abs(value));
  }
  expect(broken, "samples that are not numbers").toBe(0);
  expect(worst, "the mix must never clip").toBeLessThanOrEqual(1);
}

test("the firing frequency is three pulses per revolution of the V6", async ({
  page,
}) => {
  await load(page);
  const result = await page.evaluate(() => {
    const { firingFrequency } = window.audioModule;
    const errors = [-1, Number.NaN, Number.POSITIVE_INFINITY].map((rpm) => {
      try {
        firingFrequency(rpm);
        return "accepted";
      } catch (error) {
        return error instanceof RangeError ? "RangeError" : String(error);
      }
    });
    return { values: [0, 6000, 12_000, 15_000].map(firingFrequency), errors };
  });
  expect(result.values).toEqual([0, 300, 600, 750]);
  expect(result.errors).toEqual(["RangeError", "RangeError", "RangeError"]);
});

test("engine pitch follows held RPM steps", async ({ page }) => {
  const problems = recordProblems(page);
  await load(page);
  const steps = [5000, 8000, 11_000];
  const samples = await render(
    page,
    3,
    steps.map((rpm, index) => ({
      time: index,
      frame: frame({ rpm, load: 0.8 }),
    })),
  );
  expectClean(samples);
  for (const [index, rpm] of steps.entries()) {
    const expected = (rpm / 60) * 3;
    const heard = fundamental(samples, RATE, index + 0.4, index + 0.9);
    expect(
      Math.abs(heard - expected) / expected,
      `${String(rpm)} rpm should sound at ${String(expected)} Hz, heard ${String(heard)} Hz`,
    ).toBeLessThanOrEqual(0.04);
  }
  expect(problems).toEqual([]);
});

test("engine pitch sweeps smoothly with a rising RPM", async ({ page }) => {
  await load(page);
  const schedule = Array.from({ length: 61 }, (_, index) => ({
    time: index * 0.05,
    frame: frame({ rpm: 4000 + (8000 * index) / 60, load: 1 }),
  }));
  const samples = await render(page, 3.2, schedule);
  let previous = 0;
  for (let window = 0; window < 6; window += 1) {
    const from = 0.25 + window * 0.45;
    const middle = from + 0.1;
    const expected = ((4000 + (8000 * middle) / 3) / 60) * 3;
    const heard = fundamental(samples, RATE, from, from + 0.2);
    expect(
      Math.abs(heard - expected) / expected,
      `window at ${String(middle)} s`,
    ).toBeLessThanOrEqual(0.06);
    expect(heard).toBeGreaterThan(previous);
    previous = heard;
  }
});

test("more engine load is louder and brighter at the same RPM", async ({
  page,
}) => {
  await load(page);
  const light = await render(page, 1, [
    { time: 0, frame: frame({ load: 0.2 }) },
  ]);
  const heavy = await render(page, 1, [{ time: 0, frame: frame({ load: 1 }) }]);
  expect(rms(heavy, RATE, 0.3, 0.9)).toBeGreaterThanOrEqual(
    1.5 * rms(light, RATE, 0.3, 0.9),
  );
  expect(centroid(heavy, RATE, 0.3, 0.9)).toBeGreaterThanOrEqual(
    1.1 * centroid(light, RATE, 0.3, 0.9),
  );
  const lightPitch = fundamental(light, RATE, 0.3, 0.9);
  const heavyPitch = fundamental(heavy, RATE, 0.3, 0.9);
  expect(
    Math.abs(lightPitch - heavyPitch) / heavyPitch,
    "load must not change the pitch",
  ).toBeLessThanOrEqual(0.03);
});

test("sliding tyres add a squeal above the engine", async ({ page }) => {
  await load(page);
  const grip = await render(page, 1, [
    { time: 0, frame: frame({ rpm: 7000, load: 0.5, tyreSlip: 0 }) },
  ]);
  const slide = await render(page, 1, [
    { time: 0, frame: frame({ rpm: 7000, load: 0.5, tyreSlip: 1 }) },
  ]);
  expect(bandEnergy(slide, RATE, 0.3, 0.9, 1000, 4000)).toBeGreaterThanOrEqual(
    2 * bandEnergy(grip, RATE, 0.3, 0.9, 1000, 4000),
  );
  const standing = await render(page, 1, [
    { time: 0, frame: frame({ rpm: 7000, load: 0.5, tyreSlip: 1, speed: 0 }) },
  ]);
  expect(
    bandEnergy(standing, RATE, 0.3, 0.9, 1000, 4000),
    "a car that is not moving cannot squeal its tyres",
  ).toBeLessThanOrEqual(1.2 * bandEnergy(grip, RATE, 0.3, 0.9, 1000, 4000));
});

test("a switched-off car standing still is silent", async ({ page }) => {
  await load(page);
  const samples = await render(page, 1, [
    { time: 0, frame: frame({ rpm: 0, load: 0, tyreSlip: 0, speed: 0 }) },
  ]);
  expect(rms(samples, RATE, 0.2, 1)).toBeLessThan(1e-3);
});

test("extreme but valid frames never clip or produce NaN", async ({ page }) => {
  await load(page);
  const samples = await render(page, 1.5, [
    { time: 0, frame: frame({ rpm: 15_000, load: 1, tyreSlip: 1, speed: 95 }) },
    { time: 0.5, frame: frame({ rpm: 0, load: 1, tyreSlip: 1, speed: 95 }) },
    { time: 1, frame: frame({ rpm: 15_000, load: 0, tyreSlip: 0, speed: 0 }) },
  ]);
  expectClean(samples);
});

test("disposing fades the car out and stops all sound", async ({ page }) => {
  await load(page);
  const samples = await render(
    page,
    2,
    [{ time: 0, frame: frame({ load: 1, tyreSlip: 1 }) }],
    1,
  );
  expect(rms(samples, RATE, 0.5, 0.95)).toBeGreaterThan(0.01);
  expect(rms(samples, RATE, 1.1, 2)).toBeLessThan(1e-4);
});

test("invalid frames are refused", async ({ page }) => {
  await load(page);
  const results = await page.evaluate(
    (bad) => {
      const context = new OfflineAudioContext(1, 4800, 48_000);
      const audio = window.audioModule.createCarAudio(
        context,
        context.destination,
      );
      return bad.map((entry) => {
        try {
          audio.update(entry, 0);
          return "accepted";
        } catch (error) {
          return error instanceof RangeError ? "RangeError" : String(error);
        }
      });
    },
    [
      frame({ rpm: Number.NaN }),
      frame({ rpm: -10 }),
      frame({ load: 1.2 }),
      frame({ load: -0.1 }),
      frame({ tyreSlip: -0.5 }),
      frame({ tyreSlip: 1.5 }),
      frame({ speed: -1 }),
      frame({ speed: Number.POSITIVE_INFINITY }),
    ],
  );
  expect(results).toEqual(Array.from({ length: 8 }, () => "RangeError"));
});
