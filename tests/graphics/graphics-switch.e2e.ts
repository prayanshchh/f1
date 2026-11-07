import { expect, test } from "@playwright/test";

function race(): void {
  localStorage.setItem(
    "revracers.settings",
    JSON.stringify({ session: "race", laps: 3, buildUp: false }),
  );
}

function storedGraphics(): string {
  const stored = localStorage.getItem("revracers.settings") ?? "{}";
  return (JSON.parse(stored) as { graphics?: string }).graphics ?? "";
}

if (process.platform !== "linux") {
  test("G swaps between Ultra and Low during a race and remembers the choice", async ({
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
    const ultra = page.getByTestId("drive-canvas");
    const low = page.getByTestId("corridor-canvas");
    await expect(ultra).toBeVisible();

    await page.keyboard.press("g");
    await expect(page.locator("[data-hud=toast-title]")).toHaveText(
      "Low graphics",
    );
    await expect(low).toBeVisible({ timeout: 60_000 });
    await expect(ultra).toBeHidden();
    expect(await page.evaluate(storedGraphics)).toBe("low");

    await page.keyboard.press("g");
    await expect(ultra).toBeVisible({ timeout: 10_000 });
    await expect(low).toBeHidden();
    expect(await page.evaluate(storedGraphics)).toBe("ultra");
  });
}
