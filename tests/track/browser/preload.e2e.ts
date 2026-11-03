import { expect, test } from "@playwright/test";
import { countGpuObjects } from "../../support/gpu-counters.ts";

const softwareGpu = process.platform === "linux";

if (!softwareGpu) {
  test("the whole circuit is on the GPU before the race starts", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.addInitScript(countGpuObjects);
    await page.goto("/?autostart=1", { waitUntil: "commit" });
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
