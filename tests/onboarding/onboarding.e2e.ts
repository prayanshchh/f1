import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { playerKeyName, seedPlayer } from "../support/player.ts";

async function storedKey(page: Page): Promise<string> {
  const key = await page.evaluate(
    (name) => localStorage.getItem(name),
    playerKeyName,
  );
  if (!key) throw new Error("the game stored no player key");
  return key;
}

async function skippedSchool(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem("revracers.tutorial", "skipped");
  });
}

async function freshBrowser(
  browser: Browser,
  baseURL: string | undefined,
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>,
) {
  if (!baseURL) throw new Error("the onboarding tests need a baseURL");
  const context = await browser.newContext({
    baseURL,
    ...(storageState ? { storageState } : {}),
  });
  return { context, page: await context.newPage() };
}

test.describe("driver onboarding", () => {
  test.setTimeout(180_000);

  test("a new player who skipped Driving School names themselves and is the same driver after the browser restarts", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await skippedSchool(context);
    await page.goto("/?intro=off");
    const name = page.locator("[data-front=name]");
    await expect(name).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Enter a name to continue.")).toBeVisible();
    await name.fill("Asha");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Enter last name" }),
    ).toBeVisible();
    await name.fill("Rao");
    await page.keyboard.press("Enter");

    await expect(page.locator(".front-countries")).toBeVisible();
    await page.locator(".front-search").fill("Ind");
    await page.locator('.front-country[data-code="IN"]').click();

    await expect(page.locator(".front-numbers")).toBeVisible();
    await page.getByRole("button", { name: "44", exact: true }).click();
    await page.keyboard.press("Enter");

    const tiles = page.locator(".front-team-tile");
    await expect(tiles).toHaveCount(11);
    await page.locator('.front-team-tile[data-team="corvus"]').click();
    await expect(page.locator(".front-team-name")).toHaveText(
      "Orvex Corvus Motorsport",
    );
    await page.keyboard.press("Enter");

    await expect(page.locator(".front-driver-card")).toContainText("Rao");
    await expect(page.locator(".front-driver-card")).toContainText("44");
    await page.keyboard.press("Enter");

    await expect(page.locator(".front-hub")).toBeVisible();
    await expect(page.locator(".front-hub-driver")).toContainText("Corvus");

    const key = await storedKey(page);
    expect(await page.locator("body").innerText()).not.toContain(key);
    const me = await page.request.get("/api/me", {
      headers: { authorization: `Bearer ${key}` },
    });
    const { driver } = (await me.json()) as { driver: { id: string } };

    const saved = await context.storageState();
    await context.close();
    const restarted = await freshBrowser(browser, baseURL, saved);
    const again = restarted.page;
    await again.goto("/?intro=off");
    await again.mouse.move(1, 1);
    await expect(again.locator(".front-hub-driver")).toContainText("RAO", {
      ignoreCase: true,
      timeout: 60_000,
    });
    expect(await storedKey(again)).toBe(key);
    const after = await again.request.get("/api/me", {
      headers: { authorization: `Bearer ${key}` },
    });
    const { driver: same } = (await after.json()) as {
      driver: { id: string };
    };
    expect(same.id).toBe(driver.id);
    await restarted.context.close();
  });

  test("lap records show what the database holds for this driver", async ({
    page,
    context,
  }) => {
    const headers = await seedPlayer(context);
    const session = crypto.randomUUID();
    await context.request.put(`/api/sessions/${session}`, {
      headers,
      data: {
        track: "hill-country",
        car: "revracer-26",
        team: "corvus",
        kind: "race",
        plannedLaps: 2,
        startedAt: new Date().toISOString(),
      },
    });
    await context.request.put(`/api/sessions/${session}/laps/1`, {
      headers,
      data: {
        timeMs: 95000,
        sectorsMs: [30000, 35000, 30000],
        compound: "soft",
      },
    });
    await context.request.put(`/api/sessions/${session}/laps/2`, {
      headers,
      data: {
        timeMs: 94000,
        sectorsMs: [29000, 35500, 29500],
        compound: "soft",
      },
    });

    await page.goto("/?intro=off");
    await page.mouse.move(1, 1);
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Lap Records/ }).click();

    const body = page.locator(".records-body");
    await expect(body).toContainText("1:34.000");
    await expect(body).toContainText("1:33.500");
    await page.locator(".records-session").first().click();
    await expect(page.locator(".records-table tbody tr")).toHaveCount(2);
    await expect(page.locator(".records-table")).toContainText("+1.000");

    await page.keyboard.press("Escape");
    await expect(page.locator(".records-session")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".front-hub")).toBeVisible();
  });

  test("another browser is a different player and never sees this driver", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await seedPlayer(context);
    await page.goto("/?intro=off");
    await page.mouse.move(1, 1);
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /Sign Out/ })).toHaveCount(0);

    const other = await freshBrowser(browser, baseURL);
    await skippedSchool(other.context);
    await other.page.goto("/?intro=off");
    await expect(other.page.locator("[data-front=name]")).toBeVisible({
      timeout: 60_000,
    });
    await expect(other.page.locator(".front-hub-driver")).toHaveCount(0);
    expect(await storedKey(other.page)).not.toBe(await storedKey(page));
    await other.context.close();
  });

  test("a first visit while the server is down offers a retry and then carries on", async ({
    page,
    context,
  }) => {
    await skippedSchool(context);
    await page.route("**/api/players", (route) => route.abort());
    await page.goto("/?intro=off");
    await expect(page.locator("[data-front=retry]")).toBeVisible({
      timeout: 60_000,
    });
    await page.locator("[data-front=retry]").click();
    await expect(page.locator("[data-front=error]")).not.toBeEmpty();
    await page.unroute("**/api/players");
    await page.locator("[data-front=retry]").click();
    await expect(page.locator("[data-front=name]")).toBeVisible();
  });
});
