import { expect, type Page, test } from "@playwright/test";
import { launchPhoneBrowser, Phone, phoneKinds } from "../support/phone-pad.ts";

const android = phoneKinds.filter((kind) => !kind.ios);

async function hold(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(700);
  await page.keyboard.up(key);
}

for (const kind of android) {
  test(`Driving School on ${kind.name} waits for the Center countdown to finish before asking for − or +, and both reach the game`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(480_000);
    const baseURL = testInfo.project.use.baseURL ?? "";
    const page = await browser.newPage({
      baseURL,
      viewport: { width: 1280, height: 720 },
    });
    await page.goto("/?tutorial&intro=off");
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    const step = page.locator("[data-tutorial=root]");
    await expect(step).toHaveAttribute("data-step", "controls", {
      timeout: 60_000,
    });
    await page.keyboard.press("p");
    const shown = await page.locator("[data-pad=pad-url]").innerText();
    const url = shown.replace(/^https?:\/\/[^/]+/, baseURL);
    const phones = await launchPhoneBrowser(kind);
    const phone = await Phone.open(phones, kind, url);
    await phone.startAndCalibrate();

    await expect(step).toHaveAttribute("data-step", "steer-left");
    await hold(page, "ArrowLeft");
    await expect(step).toHaveAttribute("data-step", "steer-right");
    await hold(page, "ArrowRight");
    await expect(step).toHaveAttribute("data-step", "brake-pedal");
    await hold(page, "ArrowDown");
    await expect(step).toHaveAttribute("data-step", "gas-pedal");
    await hold(page, "ArrowUp");
    await expect(step).toHaveAttribute("data-step", "pad-center");

    const countdown = phone.page.locator("[data-pad=calibrate]");
    await phone.tap("center");
    await expect(countdown).toBeVisible();
    while (await countdown.isVisible()) {
      await expect(step).toHaveAttribute("data-step", "pad-center");
      await phone.page.waitForTimeout(250);
    }
    await expect(step).toHaveAttribute("data-step", "pad-sensitivity", {
      timeout: 2_000,
    });

    await phone.page.locator("[data-pad=more]").click();
    await expect(phone.page.locator("[data-pad=sens]")).toHaveText("1.15×");
    await expect(step).toHaveAttribute("data-step", "lights-wait", {
      timeout: 2_000,
    });

    await phone.close();
    await phones.close();
  });
}
