import { expect, test, type Page } from "@playwright/test";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const phones = [
  { name: "iPhone 14", width: 844, height: 390 },
  { name: "iPhone 14 with Safari bars", width: 844, height: 340 },
  { name: "iPhone SE", width: 667, height: 375 },
  { name: "iPhone SE with Safari bars", width: 667, height: 320 },
  { name: "iPhone mini with Safari bars", width: 812, height: 300 },
  { name: "Pro Max", width: 932, height: 430 },
  { name: "Android", width: 780, height: 360 },
];

const room = "layoutCheckRoom0123456";

const buttons = [
  "less",
  "more",
  "ers",
  "page",
  "wing",
  "tyre",
  "boost",
  "center",
];

test.use({ hasTouch: true, isMobile: true });

async function startPad(page: Page): Promise<void> {
  await page.goto(`/phonepad#${room}`);
  await page.locator("[data-pad=go]").click();
  await expect(page.locator("[data-pad=start]")).toBeHidden();
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not rendered`);
  return box;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function fillOf(page: Page, pedal: "gas" | "brake"): Promise<number> {
  return page
    .locator(`[data-pad=${pedal}]`)
    .evaluate((element) => element.getBoundingClientRect().height);
}

async function holdTouch(page: Page, box: Box, ms: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await page.waitForTimeout(ms);
}

for (const phone of phones) {
  test(`every pad control, including set center, fits a ${phone.name} screen clear of the pedals`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await startPad(page);
    const screen = { x: 0, y: 0, width: phone.width, height: phone.height };
    const pedals = [
      await boxOf(page, ".pedal.brake .track"),
      await boxOf(page, ".pedal.gas .track"),
    ];
    for (const pedal of pedals) {
      expect(pedal.x).toBeGreaterThanOrEqual(0);
      expect(pedal.x + pedal.width).toBeLessThanOrEqual(screen.width);
    }
    for (const name of buttons) {
      const box = await boxOf(page, `[data-pad=${name}]`);
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.y, name).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, name).toBeLessThanOrEqual(screen.width);
      expect(box.y + box.height, name).toBeLessThanOrEqual(screen.height);
      for (const pedal of pedals)
        expect(overlaps(box, pedal), name).toBe(false);
      const label = page.locator(`[data-pad=${name}]`);
      const clipped = await label.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1,
      );
      expect(clipped, `${name} label is cut off`).toBe(false);
    }
  });
}

test("set center starts a new steering calibration", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 340 });
  await startPad(page);
  const calibrate = page.locator("[data-pad=calibrate]");
  await expect(calibrate).toBeVisible();
  await expect(calibrate).toBeHidden({ timeout: 6000 });
  await page.locator("[data-pad=center]").tap();
  await expect(calibrate).toBeVisible();
  await expect(page.locator("[data-pad=count]")).toHaveText("3");
});

test("holding a button next to a pedal never presses that pedal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await startPad(page);
  await holdTouch(page, await boxOf(page, "[data-pad=ers]"), 600);
  expect(await fillOf(page, "brake")).toBe(0);
  expect(await fillOf(page, "gas")).toBe(0);
});

test("holding a pedal presses it", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await startPad(page);
  await holdTouch(page, await boxOf(page, ".pedal.brake .track"), 600);
  expect(await fillOf(page, "brake")).toBeGreaterThan(0);
  expect(await fillOf(page, "gas")).toBe(0);
});
