import { expect, test } from "@playwright/test";
import { countGpuObjects } from "../support/gpu-counters.ts";

function race(): void {
  localStorage.setItem(
    "revracers.settings",
    JSON.stringify({ session: "race", buildUp: false }),
  );
}

if (process.platform !== "linux") {
  test("a crash into the wall, its replay and a flashback put nothing new on the GPU", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const gpuErrors: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("GPUValidationError"))
        gpuErrors.push(message.text());
    });
    await page.addInitScript(countGpuObjects);
    await page.addInitScript(race);
    await page.goto("/?autostart=1", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    const atStart = await page.evaluate(() => ({ ...window.gpuCounters }));
    await page.waitForTimeout(6000);
    await page.keyboard.down("ArrowUp");
    const speed = page.locator('[data-hud="speed"]');
    await expect
      .poll(async () => Number(await speed.textContent()), {
        timeout: 60_000,
        intervals: [50],
      })
      .toBeGreaterThanOrEqual(175);
    await page.keyboard.down("ArrowLeft");
    await expect(page.locator("[data-hud=toast-title]")).toHaveText(
      /damage|puncture/i,
      { timeout: 10_000 },
    );
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(2000);
    const overlay = page.locator("[data-replay-root]");
    await page.keyboard.press("r");
    await expect(overlay).toBeVisible();
    await page.waitForTimeout(6000);
    await page.keyboard.press("c");
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(1500);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.press("f");
    await expect(overlay).toBeHidden();
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(2000);
    await page.keyboard.up("ArrowUp");
    const after = await page.evaluate(() => ({ ...window.gpuCounters }));
    expect(after).toEqual(atStart);
    expect(gpuErrors).toEqual([]);
  });
}
