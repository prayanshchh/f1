import { expect, type Page, test } from "@playwright/test";
import { seedPlayer } from "../support/player.ts";
import { slowNetwork } from "../support/slow-network.ts";

function trailer(page: Page) {
  return page.evaluate(() => {
    const video =
      document.querySelector<HTMLVideoElement>("[data-intro] video");
    return {
      time: video?.currentTime ?? -1,
      muted: video?.muted ?? null,
      music: document.body.dataset["music"] ?? "",
      status: document.body.dataset["driveStatus"] ?? "",
    };
  });
}

async function playing(page: Page): Promise<void> {
  await expect(page.getByTestId("intro")).toBeVisible();
  await expect
    .poll(async () => (await trailer(page)).time, { timeout: 30_000 })
    .toBeGreaterThan(1);
}

async function seekToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const video =
      document.querySelector<HTMLVideoElement>("[data-intro] video");
    if (video) video.currentTime = video.duration - 0.3;
  });
  await expect(page.getByTestId("intro")).toHaveCount(0, { timeout: 10_000 });
}

test.describe("loading trailer", () => {
  test.setTimeout(240_000);

  if (process.platform !== "linux") {
    test("a new player watches the trailer while Driving School loads, and the lesson waits for it", async ({
      page,
    }) => {
      await page.goto("/");
      await playing(page);
      await page.keyboard.press("Enter");
      expect((await trailer(page)).muted).toBe(false);

      await expect(page.getByTestId("drive-status")).toBeHidden({
        timeout: 180_000,
      });
      await page.waitForTimeout(1500);
      expect((await trailer(page)).status).toBe("loading");

      await seekToEnd(page);
      await expect
        .poll(async () => (await trailer(page)).status)
        .toBe("running");
      await expect(page.locator("[data-tutorial=root]")).toHaveAttribute(
        "data-step",
        "welcome",
        { timeout: 30_000 },
      );
    });

    test("a returning driver's hub and menu music wait for the trailer, keys never reach the hub, and it plays once", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await page.goto("/");
      await playing(page);
      const hub = page.locator(".front-hub");
      await expect(hub).toBeAttached({ timeout: 60_000 });
      await expect(
        page.getByTestId("intro").getByRole("button", { name: "Skip" }),
      ).toBeVisible();

      await page.keyboard.press("Enter");
      expect(await trailer(page)).toMatchObject({ muted: false, music: "" });

      await seekToEnd(page);
      await expect(hub).toBeVisible();
      await expect(page.locator('[data-menu="root"]')).toBeHidden();
      await expect.poll(async () => (await trailer(page)).music).toBe("menu");

      await page.reload();
      await expect(hub).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("intro")).toHaveCount(0);
    });

    test("skipping the trailer on a slow connection shows the loading bar", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await slowNetwork(page, 20);
      await page.goto("/");
      await page
        .getByTestId("intro")
        .getByRole("button", { name: "Skip" })
        .click({ timeout: 60_000 });
      await expect(page.getByTestId("intro")).toHaveCount(0);
      await expect(page.getByTestId("drive-status")).toBeVisible();
      await expect(page.locator(".front-hub")).toBeVisible({
        timeout: 180_000,
      });
    });
  }

  test("a trailer that cannot play gets out of the way of the game", async ({
    page,
    context,
  }) => {
    await seedPlayer(context);
    await page.route("**/intro/trailer.mp4", (route) =>
      route.fulfill({ status: 404 }),
    );
    await page.goto("/");
    await expect(page.locator(".front-hub")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("intro")).toHaveCount(0);
  });
});
