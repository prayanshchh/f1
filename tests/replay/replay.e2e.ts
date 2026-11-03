import { expect, test } from "@playwright/test";
import { countGpuObjects } from "../support/gpu-counters.ts";

function heavyRainRace(): void {
  localStorage.setItem(
    "revracers.settings",
    JSON.stringify({ session: "race", laps: 3, rain: "heavy", buildUp: false }),
  );
}

if (process.platform !== "linux") {
  test("rain, replay cameras and a flashback put nothing new on the GPU", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.addInitScript(countGpuObjects);
    await page.addInitScript(heavyRainRace);
    await page.goto("/drive.html?autostart=1", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    const atStart = await page.evaluate(() => ({ ...window.gpuCounters }));
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(7000);
    await page.keyboard.up("ArrowUp");
    const overlay = page.locator("[data-replay-root]");
    await page.keyboard.press("r");
    await expect(overlay).toBeVisible();
    for (let camera = 0; camera < 5; camera++) {
      await page.waitForTimeout(700);
      await page.keyboard.press("c");
    }
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(800);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.press("f");
    await expect(overlay).toBeHidden();
    await expect(page.locator("[data-hud=toast-title]")).toHaveText(
      "Flashback",
    );
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(2000);
    await page.keyboard.up("ArrowUp");
    const after = await page.evaluate(() => ({ ...window.gpuCounters }));
    expect(after).toEqual(atStart);
  });
}
