import { expect, test } from "@playwright/test";

const password = "correct horse battery";

function uniqueName(): string {
  return `e2e_${Date.now().toString(36)}_${String(Math.floor(Math.random() * 1e4))}`;
}

test.describe("driver onboarding", () => {
  test.setTimeout(180_000);

  test("a new driver signs up, picks a team, and stays signed in after reload", async ({
    page,
  }) => {
    await page.goto("/drive.html");
    const username = page.locator("[data-front=username]");
    await expect(username).toBeVisible({ timeout: 60_000 });

    await username.fill("x");
    await page.locator("[data-front=password]").fill("short");
    await page.locator("[data-front=submit]").click();
    await expect(page.locator("[data-front=error]")).not.toBeEmpty();

    await username.fill(uniqueName());
    await page.locator("[data-front=password]").fill(password);
    await page.locator("[data-front=submit]").click();

    const name = page.locator("[data-front=name]");
    await expect(name).toBeVisible();
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

    await page.reload();
    await expect(page.locator(".front-hub-driver")).toContainText("RAO", {
      ignoreCase: true,
      timeout: 60_000,
    });
    await expect(page.locator("[data-front=username]")).toBeHidden();
  });

  test("lap records show what the database holds for this driver", async ({
    page,
    context,
  }) => {
    const username = uniqueName();
    await context.request.post("/api/auth/register", {
      data: { username, password },
    });
    await context.request.put("/api/me", {
      data: {
        firstName: "Asha",
        lastName: "Rao",
        nationality: "IN",
        number: 44,
        team: "corvus",
      },
    });
    const session = crypto.randomUUID();
    await context.request.put(`/api/sessions/${session}`, {
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
      data: {
        timeMs: 95000,
        sectorsMs: [30000, 35000, 30000],
        compound: "soft",
      },
    });
    await context.request.put(`/api/sessions/${session}/laps/2`, {
      data: {
        timeMs: 94000,
        sectorsMs: [29000, 35500, 29500],
        compound: "soft",
      },
    });

    await page.goto("/drive.html");
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

  test("signing out returns to the sign-in screen and the session stops working", async ({
    page,
    context,
  }) => {
    await context.request.post("/api/auth/register", {
      data: { username: uniqueName(), password },
    });
    await context.request.put("/api/me", {
      data: {
        firstName: "Asha",
        lastName: "Rao",
        nationality: "IN",
        number: 44,
        team: "corvus",
      },
    });
    await page.goto("/drive.html");
    await page.mouse.move(1, 1);
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Sign Out/ }).click();
    await expect(page.locator("[data-front=username]")).toBeVisible();
    const me = await context.request.get("/api/me");
    expect(me.status()).toBe(401);
  });
});
