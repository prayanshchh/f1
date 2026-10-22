import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import type {
  Input,
  Snapshot,
  TrackData,
} from "../../../apps/client/src/contracts/index.ts";
import { recordProblems } from "../../support/bundle.ts";
import {
  distanceBetween,
  magnitude,
  trackLength,
  carAt,
} from "../../support/sim.ts";
import { readRepoFile } from "../../support/repo.ts";

interface GamepadStub {
  mapping: string;
  connected: boolean;
  axes: number[];
  buttons: { value: number; pressed: boolean }[];
}
declare global {
  interface Window {
    drive: {
      state: () => { tick: number; snapshot: Snapshot };
      inputLog: () => Promise<Input[]>;
    };
    testPad: GamepadStub;
  }
}
const track = JSON.parse(
  readRepoFile("content/tracks/ridgewater/track.json"),
) as TrackData;
const length = trackLength(track);
const canvas = (page: Page) => page.getByTestId("drive-canvas");
const world = (page: Page) => page.evaluate(() => window.drive.state());
async function openDrive(page: Page, query = ""): Promise<void> {
  await page.goto(`/drive.html${query}`);
  await expect(page.locator('body[data-render-status="ready"]')).toBeAttached({
    timeout: 30_000,
  });
  await expect(canvas(page)).toHaveAttribute("data-rendered-tick", /\d/, {
    timeout: 30_000,
  });
}
async function rendered(page: Page) {
  return canvas(page).evaluate((element) => ({
    tick: Number(element.getAttribute("data-rendered-tick")),
    position: {
      x: Number(element.getAttribute("data-car-x")),
      y: Number(element.getAttribute("data-car-y")),
      z: Number(element.getAttribute("data-car-z")),
    },
  }));
}
const shot = async (page: Page) =>
  PNG.sync.read(await canvas(page).screenshot());
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function contains(box: Box, x: number, y: number): boolean {
  return x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
}
function changed(a: PNG, b: PNG, box?: Box, inside = true): number {
  expect(b.width).toBe(a.width);
  expect(b.height).toBe(a.height);
  let count = 0,
    different = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if (
        box !== undefined &&
        contains(box, x / a.width, y / a.height) !== inside
      )
        continue;
      const offset = (y * a.width + x) * 4;
      count += 1;
      different += Number(pixelDifference(a, b, offset) > 24);
    }
  }
  return different / count;
}
function pixelDifference(a: PNG, b: PNG, offset: number): number {
  return [0, 1, 2].reduce(
    (sum, channel) =>
      sum +
      Math.abs(
        (a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0),
      ),
    0,
  );
}

function bodyworkPixels(png: PNG, box: Box): number[] {
  const offsets: number[] = [];
  for (
    let y = Math.ceil(box.y0 * png.height);
    y < box.y1 * png.height;
    y += 1
  ) {
    for (
      let x = Math.ceil(box.x0 * png.width);
      x < box.x1 * png.width;
      x += 1
    ) {
      const offset = (y * png.width + x) * 4;
      const r = png.data[offset] ?? 0;
      const g = png.data[offset + 1] ?? 0;
      const b = png.data[offset + 2] ?? 0;
      if (r >= 100 && r > 1.6 * g && r > 2 * b) offsets.push(offset);
    }
  }
  return offsets;
}

function seconds(text: string): number {
  const match = /^(\d+):(\d{2})\.(\d{3})$/.exec(text);
  if (match === null) throw new Error(`Invalid lap time: ${text}`);
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000;
}
async function accelerate(page: Page): Promise<void> {
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => carAt((await world(page)).snapshot).lapDistance, {
      timeout: 30_000,
      intervals: [20, 50, 100],
    })
    .toBeGreaterThanOrEqual(80);
}

async function holdThrottleAndLeft(
  page: Page,
  timeout = 10_000,
): Promise<void> {
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.drive.inputLog())).some(
          (i) => i.steer === 1 && i.throttle === 1,
        ),
      { timeout },
    )
    .toBe(true);
}

test("holding throttle moves the drawn car with the world", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await openDrive(page);
  const start = await rendered(page);
  expect(
    distanceBetween(
      start.position,
      carAt((await world(page)).snapshot).position,
    ),
  ).toBeLessThan(1e-3);
  await page.waitForTimeout(500);
  expect(
    distanceBetween((await rendered(page)).position, start.position),
  ).toBeLessThan(1e-3);
  await accelerate(page);
  const observe = () =>
    page.evaluate(() => {
      const element = document.querySelector('[data-testid="drive-canvas"]');
      return {
        state: window.drive.state(),
        tick: Number(element?.getAttribute("data-rendered-tick")),
        position: {
          x: Number(element?.getAttribute("data-car-x")),
          y: Number(element?.getAttribute("data-car-y")),
          z: Number(element?.getAttribute("data-car-z")),
        },
      };
    });
  let observed = await observe();
  await expect
    .poll(
      async () => {
        observed = await observe();
        return observed.state.tick - observed.tick;
      },
      { timeout: 30_000, intervals: [20, 50, 100] },
    )
    .toBeLessThanOrEqual(250);
  expect(
    distanceBetween(observed.position, start.position),
  ).toBeGreaterThanOrEqual(50);
  expect(observed.tick).toBeLessThanOrEqual(observed.state.tick);
  expect(observed.tick).toBeGreaterThanOrEqual(observed.state.tick - 250);
  const car = carAt(observed.state.snapshot);
  expect(distanceBetween(observed.position, car.position)).toBeLessThanOrEqual(
    magnitude(car.velocity) * 0.5 + 0.5,
  );
  let previous = observed.tick;
  for (let read = 0; read < 10; read += 1) {
    await page.waitForTimeout(100);
    const next = (await rendered(page)).tick;
    expect(next).toBeGreaterThanOrEqual(previous);
    previous = next;
  }
  await page.keyboard.up("ArrowUp");
  expect(problems).toEqual([]);
});
test("the chase camera keeps painted bodywork in place while the road moves past", async ({
  page,
}) => {
  await openDrive(page);
  const a = await shot(page);
  await page.waitForTimeout(500);
  expect(changed(a, await shot(page))).toBeLessThan(0.01);
  await accelerate(page);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowDown");
  await expect
    .poll(async () => magnitude(carAt((await world(page)).snapshot).velocity), {
      timeout: 15_000,
    })
    .toBe(0);
  await page.keyboard.up("ArrowDown");
  expect(carAt((await world(page)).snapshot).lapDistance).toBeLessThan(175);
  const stoppedTick = (await world(page)).tick;
  await expect
    .poll(async () => (await rendered(page)).tick, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(stoppedTick);
  for (let frame = 0; frame < 3; frame += 1) {
    const previous = (await rendered(page)).tick;
    await expect
      .poll(async () => (await rendered(page)).tick)
      .toBeGreaterThan(previous);
  }
  const b = await shot(page);
  const box = { x0: 0.45, y0: 0.58, x1: 0.55, y1: 0.72 };
  const bodywork = bodyworkPixels(a, box);
  const patchArea = (box.x1 - box.x0) * a.width * (box.y1 - box.y0) * a.height;
  expect(bodywork.length / patchArea).toBeGreaterThanOrEqual(0.1);
  const changedBodywork = bodywork.filter(
    (offset) => pixelDifference(a, b, offset) > 24,
  );
  expect(changedBodywork.length / bodywork.length).toBeLessThanOrEqual(0.15);
  expect(changed(a, b, box, false)).toBeGreaterThanOrEqual(0.05);
  await page.keyboard.up("ArrowUp");
});
test("a lap is counted by the world and timed in the HUD", async ({ page }) => {
  test.setTimeout(120_000);
  await openDrive(page, `?start=${String(length - 200)}`);
  await expect(page.getByTestId("hud-lap")).toHaveText("1/5");
  const lastLap = page.getByTestId("hud-last-lap");
  await expect(lastLap).toHaveText("—");
  await expect(lastLap).toHaveAttribute("data-available", "false");
  await page.keyboard.down("ArrowUp");
  await expect(page.getByTestId("hud-lap")).toHaveText("2/5", {
    timeout: 40_000,
  });
  const timing = await page.evaluate(() => ({
    last:
      document.querySelector('[data-testid="hud-last-lap"]')?.textContent ?? "",
    current:
      document.querySelector('[data-testid="hud-lap-time"]')?.textContent ?? "",
    tick: window.drive.state().tick,
  }));
  const last = seconds(timing.last),
    current = seconds(timing.current);
  expect(last).toBeGreaterThanOrEqual(4);
  expect(Math.abs(last + current - timing.tick / 500)).toBeLessThanOrEqual(
    0.25,
  );
  expect(current).toBeLessThanOrEqual(2);
  await page.waitForTimeout(1000);
  await expect(lastLap).toHaveText(timing.last);
  expect(
    seconds(await page.getByTestId("hud-lap-time").innerText()),
  ).toBeGreaterThan(current);
  await page.keyboard.up("ArrowUp");
});
test("keyboard and gamepad both reach the world, steering included", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.testPad = {
      mapping: "standard",
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(Navigator.prototype, "getGamepads", {
      value: () => [window.testPad],
    });
  });
  await openDrive(page);
  await holdThrottleAndLeft(page);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("ArrowUp");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.drive.inputLog()))
          .slice(-50)
          .every((i) => i.steer === 0 && i.throttle === 0 && i.brake === 0),
      { timeout: 10_000 },
    )
    .toBe(true);
  const keyboard = await page.evaluate(() => window.drive.inputLog());
  expect(
    keyboard.some((input) => input.steer === 1 && input.throttle === 1),
  ).toBe(true);
  expect(
    keyboard
      .slice(-50)
      .every((i) => i.steer === 0 && i.throttle === 0 && i.brake === 0),
  ).toBe(true);
  const before = carAt((await world(page)).snapshot).lapDistance;
  await page.evaluate(() => {
    window.testPad.axes[0] = -1;
    window.testPad.buttons[7] = { value: 1, pressed: true };
  });
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.drive.inputLog()))
        .slice(keyboard.length)
        .some((i) => i.steer === 1 && i.throttle === 1),
    )
    .toBe(true);
  await expect
    .poll(async () => carAt((await world(page)).snapshot).lapDistance)
    .toBeGreaterThan(before);
  await page.evaluate(() => {
    window.testPad.buttons[6] = { value: 0.5, pressed: true };
    window.testPad.buttons[7] = { value: 0, pressed: false };
  });
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.drive.inputLog()))
        .slice(keyboard.length)
        .some((i) => i.brake === 0.5),
    )
    .toBe(true);
});
test("a bad start distance is refused with a visible explanation", async ({
  page,
}) => {
  for (const start of [-5, length + 10]) {
    await page.goto(`/drive.html?start=${String(start)}`);
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/\S/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-render-status",
      "error",
    );
  }
});

test("controls and the lap clock keep updating between slow display frames", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => {
        callback(performance.now());
      }, 10_000);
  });
  await openDrive(page);
  await holdThrottleAndLeft(page, 5000);
  const current = seconds(await page.getByTestId("hud-lap-time").innerText());
  await expect
    .poll(async () =>
      seconds(await page.getByTestId("hud-lap-time").innerText()),
    )
    .toBeGreaterThan(current);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("ArrowUp");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.drive.inputLog()))
          .slice(-50)
          .every((i) => i.steer === 0 && i.throttle === 0),
      { timeout: 5000 },
    )
    .toBe(true);
});
