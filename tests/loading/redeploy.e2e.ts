import { expect, type Page, test } from "@playwright/test";
import { asha, seedPlayer } from "../support/player.ts";

function countPageLoads(page: Page): () => number {
  let loads = 0;
  page.on("request", (request) => {
    if (
      request.resourceType() === "document" &&
      new URL(request.url()).pathname === "/"
    )
      loads++;
  });
  return () => loads;
}

async function raceLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId("drive-status")).toBeHidden({
    timeout: 120_000,
  });
}

test.describe("a page left open across a deploy", () => {
  test.setTimeout(180_000);

  test("reloads once into the new site before loading the race", async ({
    context,
    page,
  }) => {
    await seedPlayer(context);
    const loads = countPageLoads(page);
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        if (route.request().resourceType() === "document")
          return route.continue();
        const response = await route.fetch();
        const html = (await response.text()).replace(
          /(<script type="module"[^>]*\ssrc=")[^"]+/,
          "$1/assets/index-redeployed.js",
        );
        return route.fulfill({ response, body: html });
      },
    );

    await page.goto(`/?autostart&team=${asha.team}`);
    await raceLoaded(page);

    expect(loads()).toBe(2);
  });

  test("does not reload when the site has not changed", async ({
    context,
    page,
  }) => {
    await seedPlayer(context);
    const loads = countPageLoads(page);

    await page.goto(`/?autostart&team=${asha.team}`);
    await raceLoaded(page);

    expect(loads()).toBe(1);
  });
});
