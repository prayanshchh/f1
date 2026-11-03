import { expect, type Locator, test } from "@playwright/test";
import { PNG } from "pngjs";

function race(): void {
  localStorage.setItem(
    "f1.settings",
    JSON.stringify({ session: "race", laps: 3, buildUp: false, version: 2 }),
  );
}

async function brightnessSpread(view: Locator): Promise<number> {
  const png = PNG.sync.read(await view.screenshot({ scale: "device" }));
  const values: number[] = [];
  for (let i = 0; i < png.data.length; i += 4)
    values.push(
      0.2126 * (png.data[i] ?? 0) +
        0.7152 * (png.data[i + 1] ?? 0) +
        0.0722 * (png.data[i + 2] ?? 0),
    );
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
  );
}

if (process.platform !== "linux") {
  test("a yellow flag says why it is out and replays the incident beside the race", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.addInitScript(race);
    await page.goto("/?autostart=1", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    await expect(page.locator("[data-hud=steward-title]")).toHaveText(
      "Double yellow flag",
      { timeout: 60_000 },
    );
    await expect(page.locator("[data-hud=steward-detail]")).toContainText(
      "You stopped on track",
    );
    const inset = page.locator("[data-hud=incident]");
    await expect(inset).toBeVisible();
    await expect(inset.locator("[data-incident=detail]")).toContainText(
      "You stopped on track",
    );
    await page.waitForTimeout(1500);
    expect(await brightnessSpread(inset.locator("canvas"))).toBeGreaterThan(12);
    await expect(inset).toBeHidden({ timeout: 20_000 });
  });
}
