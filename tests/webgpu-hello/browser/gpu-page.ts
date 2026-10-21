import { expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { findTriangleProblems, type Picture } from "../support/triangle.ts";

interface Monitor {
  devices: GPUDevice[];
  gpuErrors: string[];
  pageErrors: string[];
}

declare global {
  interface Window {
    monitor: Monitor;
  }
}

export interface PageRecord {
  console: string[];
  pageErrors: string[];
}

function installMonitor(): void {
  const record: Monitor = { devices: [], gpuErrors: [], pageErrors: [] };
  Object.defineProperty(window, "monitor", { value: record });
  window.addEventListener("error", (event) => {
    record.pageErrors.push(event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    record.pageErrors.push(String(event.reason));
  });
  if (!("GPUAdapter" in window)) {
    return;
  }
  const original = Object.getOwnPropertyDescriptor(
    GPUAdapter.prototype,
    "requestDevice",
  )?.value as GPUAdapter["requestDevice"];
  Object.defineProperty(GPUAdapter.prototype, "requestDevice", {
    async value(this: GPUAdapter, descriptor?: GPUDeviceDescriptor) {
      const device = await original.call(this, descriptor);
      device.addEventListener("uncapturederror", (event) => {
        record.gpuErrors.push(event.error.message);
      });
      record.devices.push(device);
      return device;
    },
  });
}

export async function openApp(
  page: Page,
  scenario?: () => void,
): Promise<PageRecord> {
  const record: PageRecord = { console: [], pageErrors: [] };
  page.on("console", (message) => {
    record.console.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    record.pageErrors.push(error.message);
  });
  await page.addInitScript(installMonitor);
  if (scenario !== undefined) {
    await page.addInitScript(scenario);
  }
  await page.goto("/");
  return record;
}

async function expectStatus(page: Page, status: string): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute(
    "data-gpu-status",
    status,
    { timeout: 20_000 },
  );
}

export async function expectReady(page: Page): Promise<void> {
  await expectStatus(page, "ready");
  await expect(page.getByTestId("gpu-error")).toHaveCount(0);
  await expect(page.getByTestId("gpu-canvas")).toBeVisible();
}

export async function expectExplainedFailure(
  page: Page,
  reason: string,
  message: RegExp,
): Promise<void> {
  await expectStatus(page, "error");
  const alert = page.getByTestId("gpu-error");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("data-reason", reason);
  await expect(alert).toHaveText(message);
  await expect(page.getByTestId("gpu-canvas")).toBeHidden();
}

export async function expectQuiet(
  page: Page,
  record: PageRecord,
): Promise<void> {
  const inPage = await page.evaluate(() => ({
    gpuErrors: window.monitor.gpuErrors,
    pageErrors: window.monitor.pageErrors,
  }));
  expect(record.console).toEqual([]);
  expect(record.pageErrors).toEqual([]);
  expect(inPage.gpuErrors).toEqual([]);
  expect(inPage.pageErrors).toEqual([]);
}

export function deviceCount(page: Page): Promise<number> {
  return page.evaluate(() => window.monitor.devices.length);
}

export function destroyDevice(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.monitor.devices[0]?.destroy();
  });
}

interface CanvasGeometry {
  left: number;
  top: number;
  cssWidth: number;
  cssHeight: number;
  width: number;
  height: number;
  ratio: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

function canvasGeometry(page: Page): Promise<CanvasGeometry> {
  return page.getByTestId("gpu-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      cssWidth: box.width,
      cssHeight: box.height,
      width: canvas.width,
      height: canvas.height,
      ratio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
}

function backingStoreMismatch(geometry: CanvasGeometry): number {
  return Math.max(
    Math.abs(geometry.width - geometry.cssWidth * geometry.ratio),
    Math.abs(geometry.height - geometry.cssHeight * geometry.ratio),
  );
}

export async function expectSharpFullWindowCanvas(page: Page): Promise<void> {
  await expect
    .poll(async () => backingStoreMismatch(await canvasGeometry(page)))
    .toBeLessThanOrEqual(1);
  const geometry = await canvasGeometry(page);
  expect([geometry.left, geometry.top]).toEqual([0, 0]);
  expect(
    Math.abs(geometry.cssWidth - geometry.viewportWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(geometry.cssHeight - geometry.viewportHeight),
  ).toBeLessThanOrEqual(1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.viewportHeight);
}

async function readCanvasPicture(page: Page): Promise<Picture> {
  const png = PNG.sync.read(
    await page.getByTestId("gpu-canvas").screenshot({ scale: "device" }),
  );
  return { width: png.width, height: png.height, data: png.data };
}

export async function expectTriangleImmediately(page: Page): Promise<void> {
  expect(findTriangleProblems(await readCanvasPicture(page))).toEqual([]);
}

export async function expectTriangle(page: Page): Promise<void> {
  await expect
    .poll(async () => findTriangleProblems(await readCanvasPicture(page)), {
      timeout: 5_000,
    })
    .toEqual([]);
}
