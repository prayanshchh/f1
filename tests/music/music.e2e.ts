import { expect, type Page, test } from "@playwright/test";

const password = "correct horse battery";

declare global {
  interface Window {
    musicContexts: AudioContext[];
  }
}

function watchMusicContexts(): void {
  const contexts: AudioContext[] = [];
  const Base = window.AudioContext;
  window.AudioContext = class extends Base {
    constructor(options?: AudioContextOptions) {
      super(options);
      if (options?.latencyHint === "playback") contexts.push(this);
    }
  };
  window.musicContexts = contexts;
}

function raceWithBuildUp(): void {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem(
    "f1.settings",
    JSON.stringify({
      session: "race",
      laps: 5,
      buildUp: true,
      formationLap: false,
    }),
  );
}

function music(page: Page) {
  return page.evaluate(() => ({
    cue: document.body.dataset["music"] ?? "",
    contexts: window.musicContexts.map((context) => context.state),
  }));
}

if (process.platform !== "linux") {
  test("menus and the build-up have music, the race has none", async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000);
    await context.request.post("/api/auth/register", {
      data: {
        username: `music_${Date.now().toString(36)}`,
        password,
      },
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
    await page.addInitScript(watchMusicContexts);
    await page.addInitScript(raceWithBuildUp);
    await page.goto("/drive.html");
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await page.mouse.click(4, 4);
    await expect
      .poll(() => music(page))
      .toEqual({ cue: "intro", contexts: ["running"] });
    await page.getByRole("button", { name: /^Race/ }).click();
    await expect
      .poll(() => music(page))
      .toEqual({ cue: "menu", contexts: ["running"] });
    await page.locator('[data-menu="start"]').click();
    await expect(page.locator('[data-menu="root"]')).toBeHidden();
    await expect
      .poll(() => music(page), { timeout: 300_000 })
      .toEqual({ cue: "buildup", contexts: ["running"] });
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
    );
    await expect
      .poll(() => music(page))
      .toEqual({ cue: "", contexts: ["closed"] });
  });
}
