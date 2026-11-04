import { expect, type Page, test } from "@playwright/test";
import { seedPlayer } from "../support/player.ts";

interface Debugged {
  f1Debug: { engine: { frame: () => Float64Array } };
}

const softwareGpu = process.platform === "linux";

function step(page: Page) {
  return page.locator("[data-tutorial=root]");
}

function engineClock(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as Debugged).f1Debug.engine.frame()[0] ?? 0,
  );
}

async function reach(page: Page, id: string, timeout = 30_000): Promise<void> {
  await expect(step(page)).toHaveAttribute("data-step", id, { timeout });
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test.describe("driving school", () => {
  test.setTimeout(120_000);

  test("a new player is offered Driving School before naming themselves, and a skip is remembered", async ({
    page,
  }) => {
    await page.goto("/");
    const offer = page.locator(".front-offer");
    await expect(offer).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-front=name]")).toHaveCount(0);
    await expect(offer.locator(".front-hub-item.active")).toContainText(
      "Driving School",
    );

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-front=name]")).toBeVisible();

    await page.reload();
    await expect(page.locator("[data-front=name]")).toBeVisible({
      timeout: 60_000,
    });
    await expect(offer).toHaveCount(0);
  });

  test("onboarded drivers find Driving School in the hub and are not offered it again", async ({
    page,
    context,
  }) => {
    await seedPlayer(context);
    await page.goto("/");
    await page.mouse.move(1, 1);
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".front-offer")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Driving School/ }),
    ).toBeVisible();
  });
});

if (!softwareGpu) {
  test("leaving Driving School takes a named driver to the hub, not back into the tutorial", async ({
    page,
    context,
  }) => {
    test.setTimeout(480_000);
    await seedPlayer(context);
    await page.goto("/?tutorial");
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    await reach(page, "welcome");
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    await page.mouse.move(1, 1);
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 120_000 });
    expect(new URL(page.url()).searchParams.has("tutorial")).toBe(false);
    await expect(page.locator("[data-tutorial=root]")).toBeHidden();
  });

  test("Driving School holds the clock on the grid, stops time at the first braking point and can be skipped from the pause menu", async ({
    page,
  }) => {
    test.setTimeout(480_000);
    await page.goto("/?debug");
    await expect(page.locator(".front-offer")).toBeVisible({
      timeout: 60_000,
    });
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    await expect(page.locator("[data-ready=root]")).toBeHidden();
    await reach(page, "welcome");
    const gridClock = await engineClock(page);
    await page.waitForTimeout(1500);
    expect(await engineClock(page)).toBe(gridClock);
    expect(gridClock).toBeLessThan(0);

    await page.keyboard.press("Enter");
    await reach(page, "controls");
    await page.keyboard.press("k");
    await reach(page, "steer-left");
    await hold(page, "ArrowRight", 800);
    await expect(step(page)).toHaveAttribute("data-step", "steer-left");
    await hold(page, "ArrowLeft", 800);
    await reach(page, "steer-right");
    await hold(page, "ArrowRight", 800);
    await reach(page, "brake-pedal");
    await hold(page, "ArrowDown", 500);
    await reach(page, "gas-pedal");
    await hold(page, "ArrowUp", 500);
    await reach(page, "lights");
    expect(await engineClock(page)).toBe(gridClock);
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
    await reach(page, "lights-wait");
    await expect.poll(() => engineClock(page)).toBeGreaterThan(gridClock);

    await reach(page, "go", 20_000);
    await page.keyboard.down("ArrowUp");
    await reach(page, "line", 30_000);
    await expect(step(page)).toHaveAttribute("data-mode", "pause");
    await page.waitForTimeout(800);
    const paused = await engineClock(page);
    await page.waitForTimeout(1200);
    expect(await engineClock(page)).toBe(paused);
    await page.keyboard.press("Enter");
    await reach(page, "t1-brake", 30_000);
    await expect(step(page)).toHaveAttribute("data-mode", "freeze");
    await page.waitForTimeout(1000);
    const frozen = await engineClock(page);
    await page.waitForTimeout(1500);
    expect(await engineClock(page)).toBe(frozen);
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(800);
    expect(await engineClock(page)).toBe(frozen);
    await page.keyboard.up("ArrowUp");
    await expect.poll(() => engineClock(page)).toBeGreaterThan(frozen);
    await expect(step(page)).not.toHaveAttribute("data-step", "t1-brake");
    await page.keyboard.up("ArrowDown");

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-menu=root]")).toBeVisible();
    await expect(page.locator("[data-menu=start-label]")).toHaveText(
      "Skip Tutorial",
    );
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-front=name]")).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator(".front-offer")).toHaveCount(0);
  });
}
