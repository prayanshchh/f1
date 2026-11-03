import { expect, test, type Page } from "@playwright/test";

interface Debugged {
  f1Debug: {
    engine: {
      module: { HEAPF64: Float64Array; _sdFrame: () => number };
    };
  };
}

const softwareGpu = process.platform === "linux";

function sessionClock(page: Page): Promise<number> {
  return page.evaluate(() => {
    const { module } = (window as unknown as Debugged).f1Debug.engine;
    return (
      new Float64Array(module.HEAPF64.buffer, module._sdFrame(), 1)[0] ?? 0
    );
  });
}

function panelOnTop(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("[data-pad=panel]");
    if (!panel || panel.hidden) return false;
    const box = panel.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return top !== null && panel.contains(top);
  });
}

if (!softwareGpu) {
  test("P shows the phone code on top of everything and pauses the session under it", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.goto("/", { waitUntil: "commit" });
    await page.evaluate(() => {
      localStorage.setItem(
        "revracers.settings",
        JSON.stringify({
          session: "weekend",
          qualifying: "run",
          buildUp: false,
          version: 2,
        }),
      );
      sessionStorage.setItem("revracers.autostart", "1");
    });
    await page.goto("/?debug", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    const panel = page.locator("[data-pad=panel]");
    const menu = page.locator("[data-menu=root]");

    await expect(page.locator("[data-ready=root]")).toBeVisible();
    await page.keyboard.press("p");
    expect(await panelOnTop(page)).toBe(true);
    await expect(menu).toBeHidden();
    await page.keyboard.press("p");
    await expect(panel).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-garage=root]")).toBeVisible();

    await page.keyboard.press("p");
    await expect(panel).toBeVisible();
    await expect(menu).toBeVisible();
    expect(await panelOnTop(page)).toBe(true);
    const pausedAt = await sessionClock(page);
    await page.waitForTimeout(1500);
    expect(await sessionClock(page)).toBe(pausedAt);

    await page.keyboard.press("p");
    await expect(panel).toBeHidden();
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.waitForTimeout(1500);
    expect(await sessionClock(page)).toBeGreaterThan(pausedAt + 0.5);
  });
}
