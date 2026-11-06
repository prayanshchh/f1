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

interface LoadScreen {
  showing: boolean;
  received: number;
  total: number;
  bar: number;
  slide: string;
  music: string;
}

async function loadScreen(page: Page): Promise<LoadScreen> {
  const showing = await page
    .getByTestId("drive-status")
    .evaluate(
      (status) =>
        !status.hasAttribute("hidden") && status.classList.contains("showing"),
    );
  const bytes =
    /([\d.]+) MB \/ ([\d.]+) MB/.exec(
      (await page.getByTestId("load-bytes").textContent()) ?? "",
    ) ?? [];
  const bar = await page.getByTestId("load-line").getAttribute("aria-valuenow");
  const slides = await page
    .locator(".show-slide.on")
    .evaluateAll((images) =>
      images
        .filter((image) => (image as HTMLImageElement).naturalWidth > 0)
        .map((image) => image.getAttribute("src") ?? ""),
    );
  return {
    showing,
    received: Number(bytes[1] ?? 0),
    total: Number(bytes[2] ?? 0),
    bar: Number(bar ?? 0),
    slide: slides[0] ?? "",
    music: (await trailer(page)).music,
  };
}

function rising(values: number[]): boolean {
  return values.every(
    (value, index) => index === 0 || value >= (values[index - 1] ?? 0),
  );
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

    test("after the trailer, a slow first download shows game screenshots, megabytes of a steady total and a thin bar that keeps filling, with music", async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await slowNetwork(page, 40);
      await page.goto("/");
      await playing(page);
      await page.waitForTimeout(12_000);
      await seekToEnd(page);
      await expect
        .poll(async () => (await loadScreen(page)).slide, { timeout: 30_000 })
        .toMatch(/^\/loading\/\d+\.jpg$/);

      const samples: LoadScreen[] = [];
      for (let second = 0; second < 240; second += 1) {
        const sample = await loadScreen(page);
        if (!sample.showing) break;
        if (sample.total > 0) samples.push(sample);
        await page.waitForTimeout(1000);
      }

      expect(samples.length).toBeGreaterThan(10);
      expect(
        new Set(samples.map((sample) => sample.slide)).size,
      ).toBeGreaterThan(1);
      expect(samples.every((sample) => sample.music === "menu")).toBe(true);
      expect(rising(samples.map((sample) => sample.received))).toBe(true);
      expect(rising(samples.map((sample) => sample.bar))).toBe(true);
      const totals = samples.map((sample) => sample.total);
      expect(Math.max(...totals)).toBeGreaterThan(100);
      expect(Math.max(...totals) / Math.min(...totals)).toBeLessThan(1.1);
      const last = samples.at(-1);
      expect(last?.bar).toBe(100);
      expect(last?.received).toBe(last?.total);

      await expect
        .poll(async () => (await trailer(page)).status)
        .toBe("running");
      await expect(page.locator("[data-tutorial=root]")).toHaveAttribute(
        "data-step",
        "welcome",
        { timeout: 30_000 },
      );
    });

    test("skipping the trailer at once shows the download from its start and only reaches 100% when the circuit is in", async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await slowNetwork(page, 40);
      await page.goto("/");
      await page
        .getByTestId("intro")
        .getByRole("button", { name: "Skip" })
        .click({ timeout: 60_000 });

      const samples: LoadScreen[] = [];
      for (let tick = 0; tick < 480; tick += 1) {
        const sample = await loadScreen(page);
        if (!sample.showing && samples.length > 0) break;
        if (sample.showing && sample.total > 0) samples.push(sample);
        await page.waitForTimeout(500);
      }

      expect(samples.length).toBeGreaterThan(10);
      expect(samples[0]?.bar).toBeLessThan(30);
      expect(rising(samples.map((sample) => sample.bar))).toBe(true);
      expect(samples.at(-1)?.bar).toBe(100);
      await expect
        .poll(async () => (await trailer(page)).status)
        .toBe("running");
    });

    test("skipping the trailer on a slow connection goes straight to the loading screen", async ({
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
