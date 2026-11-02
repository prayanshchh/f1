import { expect, test } from "@playwright/test";

interface Counters {
  pipelines: number;
  buffers: number;
}

declare global {
  interface Window {
    gpuCounters: Counters;
  }
}

function countGpuObjects(): void {
  const counters: Counters = { pipelines: 0, buffers: 0 };
  Object.defineProperty(window, "gpuCounters", { value: counters });
  const count = (method: "createRenderPipeline" | "createBuffer") => {
    const original = Object.getOwnPropertyDescriptor(
      GPUDevice.prototype,
      method,
    )?.value as (...args: unknown[]) => unknown;
    Object.defineProperty(GPUDevice.prototype, method, {
      value(this: GPUDevice, ...args: unknown[]) {
        if (method === "createBuffer") counters.buffers += 1;
        else counters.pipelines += 1;
        return original.apply(this, args);
      },
    });
  };
  count("createRenderPipeline");
  count("createBuffer");
}

const softwareGpu = process.platform === "linux";

if (!softwareGpu) {
  test("the whole circuit is on the GPU before the race starts", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.addInitScript(countGpuObjects);
    await page.goto("/drive.html?autostart=1", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    const atStart = await page.evaluate(() => ({ ...window.gpuCounters }));
    expect(atStart.pipelines).toBeGreaterThan(10);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(9000);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("F2");
    await page.waitForTimeout(1500);
    const afterDriving = await page.evaluate(() => ({ ...window.gpuCounters }));
    expect(afterDriving).toEqual(atStart);
  });
}
