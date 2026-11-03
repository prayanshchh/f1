import { expect, test } from "@playwright/test";
import { asha, seedPlayer } from "../support/player.ts";

test.describe("credits and licences", () => {
  test.setTimeout(180_000);

  test("the hub credits Speed Dreams and shows the GPL notice with a source link", async ({
    page,
    context,
  }) => {
    await seedPlayer(context, { ...asha, number: 9 });

    await page.goto("/");
    await page.mouse.move(1, 1);
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Credits/ }).click();

    const hero = page.locator("[data-credits=speed-dreams]");
    await expect(hero).toContainText("Speed Dreams");
    await expect(hero).toContainText("GNU GPL version 2 or later");
    await expect(
      hero.getByRole("link", { name: "Speed Dreams" }),
    ).toHaveAttribute("href", "https://www.speed-dreams.net/");

    const notice = page.locator("[data-credits=licence]");
    await expect(notice).toContainText("GNU General Public License");
    await expect(notice).toContainText("either version 3 of the License");
    await expect(notice).toContainText("WITHOUT ANY WARRANTY");
    await expect(
      notice.getByRole("link", { name: /github\.com/ }),
    ).toHaveAttribute("href", /^https:\/\/github\.com\/.+/);

    await expect(page.locator(".credits-row")).toContainText([
      /Peter Collings.*Free Art License/s,
      /OpenStreetMap contributors.*ODbL/s,
    ]);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-records=root]")).toBeHidden();
    await expect(page.locator(".front-hub")).toBeVisible();
  });

  test("the built game ships the licence text of its bundled libraries", async ({
    request,
  }) => {
    const response = await request.get("/third-party-licenses.md");
    expect(response.ok()).toBe(true);
    const text = await response.text();
    expect(text).toMatch(/## three\b[\s\S]*MIT/);
    expect(text).toContain("Permission is hereby granted, free of charge");
  });
});
