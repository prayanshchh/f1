import { expect, test } from "@playwright/test";
import {
  destroyDevice,
  deviceCount,
  expectExplainedFailure,
  expectQuiet,
  expectReady,
  expectSharpFullWindowCanvas,
  expectTriangle,
  expectTriangleImmediately,
  openApp,
} from "./gpu-page.ts";

const screens = [
  { pixelDensity: 1, windowSize: "1280,800" },
  { pixelDensity: 2, windowSize: "800,600" },
  { pixelDensity: 1.5, windowSize: "1001,701" },
];

for (const { pixelDensity, windowSize } of screens) {
  test(`draws the red triangle on black filling a ${windowSize} window on a ${String(pixelDensity)}x density screen`, async ({
    playwright,
    launchOptions,
    channel,
    headless,
    baseURL,
  }) => {
    const browser = await playwright.chromium.launch({
      ...launchOptions,
      ...(channel === undefined ? {} : { channel }),
      headless,
      args: [
        ...(launchOptions.args ?? []),
        `--force-device-scale-factor=${String(pixelDensity)}`,
        `--window-size=${windowSize}`,
      ],
    });
    try {
      const page = await browser.newPage({
        viewport: null,
        ...(baseURL === undefined ? {} : { baseURL }),
      });
      const record = await openApp(page);
      await expectReady(page);
      await expectTriangleImmediately(page);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
        pixelDensity,
      );
      await expectSharpFullWindowCanvas(page);
      await expectTriangle(page);
      expect(await deviceCount(page)).toBe(1);
      await expectQuiet(page, record);
    } finally {
      await browser.close();
    }
  });
}

test("redraws a sharp full-window triangle every time the window changes size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const record = await openApp(page);
  await expectReady(page);
  for (const size of [
    { width: 800, height: 600 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await expectSharpFullWindowCanvas(page);
    await expectTriangle(page);
  }
  expect(await deviceCount(page)).toBe(1);
  await expectQuiet(page, record);
});

test("says ready only once the first picture is really drawn, even when the browser schedules drawing late", async ({
  page,
}) => {
  const record = await openApp(page, () => {
    const delay = 750;
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          setTimeout(() => {
            callback(entries, observer);
          }, delay);
        });
      }
    };
    const nativeRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      nativeRequestAnimationFrame((time) => {
        setTimeout(() => {
          callback(time);
        }, delay);
      });
  });
  await expectReady(page);
  await expectTriangleImmediately(page);
  await expectQuiet(page, record);
});

const startupFailures = [
  {
    problem: "the browser has no WebGPU at all",
    reason: "webgpu-unsupported",
    message: /Chrome/,
    scenario: () => {
      Reflect.deleteProperty(Navigator.prototype, "gpu");
    },
  },
  {
    problem: "no GPU adapter is available",
    reason: "adapter-unavailable",
    message: /\S/,
    scenario: () => {
      GPU.prototype.requestAdapter = () => Promise.resolve(null);
    },
  },
  {
    problem: "asking for a GPU adapter throws",
    reason: "adapter-unavailable",
    message: /\S/,
    scenario: () => {
      GPU.prototype.requestAdapter = () =>
        Promise.reject(new Error("adapter probe failed"));
    },
  },
  {
    problem: "the adapter refuses to create a device",
    reason: "device-request-failed",
    message: /\S/,
    scenario: () => {
      GPUAdapter.prototype.requestDevice = () =>
        Promise.reject(new DOMException("device refused", "OperationError"));
    },
  },
  {
    problem: "the canvas cannot provide a WebGPU context",
    reason: "context-unavailable",
    message: /\S/,
    scenario: () => {
      const original = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        "getContext",
      )?.value as (
        this: HTMLCanvasElement,
        type: string,
        options?: unknown,
      ) => RenderingContext | null;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        value(this: HTMLCanvasElement, type: string, options?: unknown) {
          return type === "webgpu" ? null : original.call(this, type, options);
        },
      });
    },
  },
];

for (const { problem, reason, message, scenario } of startupFailures) {
  test(`explains the problem instead of crashing when ${problem}`, async ({
    page,
  }) => {
    const record = await openApp(page, scenario);
    await expectExplainedFailure(page, reason, message);
    await expectQuiet(page, record);
  });
}

test("replaces the picture with an explanation when the GPU device is lost", async ({
  page,
}) => {
  const record = await openApp(page);
  await expectReady(page);
  await destroyDevice(page);
  await expectExplainedFailure(page, "device-lost", /\S/);
  expect(await deviceCount(page)).toBe(1);
  await expectQuiet(page, record);
});
