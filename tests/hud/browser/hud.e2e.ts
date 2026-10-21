import { expect, test, type Page } from "@playwright/test";
import {
  bundleModule,
  recordProblems,
  serveBundle,
  type Bundle,
} from "../../support/bundle.ts";
import {
  empty,
  emptyText,
  racing,
  racingText,
  type Frame,
} from "../support/frames.ts";

let bundle: Bundle;

test.beforeAll(async () => {
  bundle = await bundleModule("apps/client/src/hud/index.ts");
});

test.afterAll(() => {
  bundle.remove();
});

interface HudModule {
  mountHud: (root: HTMLElement) => {
    update: (frame: Frame) => void;
    destroy: () => void;
  };
  mountMenu: (
    root: HTMLElement,
    actions: Record<
      "singlePlayer" | "multiplayer" | "resume" | "restart" | "quit",
      () => void
    >,
  ) => {
    show: (screen: "main" | "pause" | "none") => void;
    readonly screen: string;
  };
}

declare global {
  interface Window {
    hudModule: HudModule;
    hud: ReturnType<HudModule["mountHud"]>;
    menu: ReturnType<HudModule["mountMenu"]>;
    calls: string[];
  }
}

async function load(page: Page): Promise<void> {
  await serveBundle(page, bundle);
  await page.evaluate(async () => {
    const url = "/__bundle/module.js";
    window.hudModule = (await import(url)) as HudModule;
    window.calls = [];
  });
}

async function mountHud(page: Page): Promise<void> {
  await load(page);
  await page.evaluate(() => {
    const root = document.createElement("div");
    root.id = "hud";
    document.body.append(root);
    window.hud = window.hudModule.mountHud(root);
  });
}

const fields = ["speed", "gear", "rpm", "energy", "delta", "lap"] as const;
const corners = ["fl", "fr", "rl", "rr"] as const;

async function expectShows(
  page: Page,
  text: typeof racingText,
  available: boolean,
): Promise<void> {
  for (const field of fields) {
    const element = page.getByTestId(`hud-${field}`);
    await expect(element).toHaveText(text[field]);
    await expect(element).toHaveAttribute("data-available", String(available));
  }
  for (const [index, corner] of corners.entries()) {
    const tyre = page.getByTestId(`hud-tyre-${corner}`);
    const expected = text.tyres[index] ?? {
      temperature: "",
      wear: "",
      state: "",
    };
    await expect(tyre.locator("[data-field='temperature']")).toHaveText(
      expected.temperature,
    );
    await expect(tyre.locator("[data-field='wear']")).toHaveText(expected.wear);
    await expect(tyre).toHaveAttribute("data-state", expected.state);
  }
  await expect(page.getByTestId("hud-delta")).toHaveAttribute(
    "data-trend",
    text.deltaTrend,
  );
}

test("a freshly mounted HUD shows placeholders and no invented numbers", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await mountHud(page);
  await expectShows(page, emptyText, false);
  expect(await page.locator("#hud").innerText()).not.toMatch(/[0-9]/);
  expect(problems).toEqual([]);
});

test("the HUD shows exactly the simulation values it is given", async ({
  page,
}) => {
  await mountHud(page);
  await page.evaluate((frame) => {
    window.hud.update(frame);
  }, racing);
  await expectShows(page, racingText, true);
  await expect(page.getByTestId("hud-energy")).toHaveAttribute(
    "data-mode",
    "deploying",
  );
});

test("updating with missing data clears the old values instead of keeping them", async ({
  page,
}) => {
  await mountHud(page);
  await page.evaluate(
    ([full, none]) => {
      window.hud.update(full);
      window.hud.update(none);
    },
    [racing, empty] as const,
  );
  await expectShows(page, emptyText, false);
  expect(await page.locator("#hud").innerText()).not.toMatch(/[0-9]/);
});

test("harvesting and idle energy modes are shown", async ({ page }) => {
  await mountHud(page);
  const energy = page.getByTestId("hud-energy");
  for (const [deploying, harvesting, mode] of [
    [false, true, "harvesting"],
    [false, false, "idle"],
  ] as const) {
    await page.evaluate(
      (frame) => {
        window.hud.update(frame);
      },
      { ...racing, energy: { charge: 0.5, deploying, harvesting } },
    );
    await expect(energy).toHaveAttribute("data-mode", mode);
  }
});

test("an invalid frame is refused and the previous values stay on screen", async ({
  page,
}) => {
  await mountHud(page);
  const error = await page.evaluate(
    ([full, broken]) => {
      window.hud.update(full);
      try {
        window.hud.update(broken);
        return "accepted";
      } catch (problem) {
        return problem instanceof RangeError ? "RangeError" : String(problem);
      }
    },
    [racing, { ...racing, speed: -5 }] as const,
  );
  expect(error).toBe("RangeError");
  await expectShows(page, racingText, true);
});

test("destroying the HUD removes everything it added", async ({ page }) => {
  await mountHud(page);
  await page.evaluate(() => {
    window.hud.destroy();
  });
  await expect(page.locator("#hud")).toBeEmpty();
});

async function mountMenu(page: Page): Promise<void> {
  await load(page);
  await page.evaluate(() => {
    const root = document.createElement("div");
    root.id = "menu";
    document.body.append(root);
    const record = (name: string) => () => {
      window.calls.push(name);
    };
    window.menu = window.hudModule.mountMenu(root, {
      singlePlayer: record("singlePlayer"),
      multiplayer: record("multiplayer"),
      resume: record("resume"),
      restart: record("restart"),
      quit: record("quit"),
    });
  });
}

const calls = (page: Page) => page.evaluate(() => window.calls);
const screen = (page: Page) => page.evaluate(() => window.menu.screen);

test("the main menu starts single player or multiplayer from buttons or the keyboard", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await mountMenu(page);
  await page.evaluate(() => {
    window.menu.show("main");
  });
  const dialog = page.getByRole("dialog", { name: "Main menu" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button")).toHaveText([
    "Single player",
    "Multiplayer",
  ]);
  await expect(
    dialog.getByRole("button", { name: "Single player" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await calls(page)).toEqual(["singlePlayer"]);
  expect(await screen(page)).toBe("none");
  await expect(dialog).toBeHidden();
  await page.evaluate(() => {
    window.menu.show("main");
  });
  await page.getByRole("button", { name: "Multiplayer" }).click();
  expect(await calls(page)).toEqual(["singlePlayer", "multiplayer"]);
  expect(problems).toEqual([]);
});

test("escape pauses a race and resumes it", async ({ page }) => {
  await mountMenu(page);
  await page.evaluate(() => {
    window.menu.show("none");
  });
  await page.keyboard.press("Escape");
  const pause = page.getByRole("dialog", { name: "Paused" });
  await expect(pause).toBeVisible();
  await expect(pause.getByRole("button")).toHaveText([
    "Resume",
    "Restart",
    "Quit to menu",
  ]);
  expect(await screen(page)).toBe("pause");
  await page.keyboard.press("Escape");
  await expect(pause).toBeHidden();
  expect(await calls(page)).toEqual(["resume"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Restart" }).click();
  expect(await calls(page)).toEqual(["resume", "restart"]);
  expect(await screen(page)).toBe("none");
});

test("quitting from the pause menu returns to the main menu", async ({
  page,
}) => {
  await mountMenu(page);
  await page.evaluate(() => {
    window.menu.show("pause");
  });
  await page.getByRole("button", { name: "Quit to menu" }).click();
  expect(await calls(page)).toEqual(["quit"]);
  expect(await screen(page)).toBe("main");
  await expect(page.getByRole("dialog", { name: "Main menu" })).toBeVisible();
});

test("escape does nothing on the main menu", async ({ page }) => {
  await mountMenu(page);
  await page.evaluate(() => {
    window.menu.show("main");
  });
  await page.keyboard.press("Escape");
  expect(await screen(page)).toBe("main");
  expect(await calls(page)).toEqual([]);
});

test("an unknown screen is refused", async ({ page }) => {
  await mountMenu(page);
  const result = await page.evaluate(() => {
    try {
      window.menu.show("garage" as "main");
      return "accepted";
    } catch (problem) {
      return problem instanceof RangeError ? "RangeError" : String(problem);
    }
  });
  expect(result).toBe("RangeError");
});
