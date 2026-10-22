import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import {
  bundleModule,
  recordProblems,
  serveBundle,
  serveDirectory,
  type Bundle,
} from "../../support/bundle.ts";
import { repoRoot } from "../../support/repo.ts";
import type { CarLab } from "./lab.ts";

type Pixel = { r: number; g: number; b: number; x: number; y: number };
let bundle: Bundle;

test.beforeAll(async () => {
  bundle = await bundleModule("tests/car-render/browser/lab.ts");
});
test.afterAll(() => {
  bundle.remove();
});

async function lab(page: Page): Promise<string[]> {
  const problems = recordProblems(page);
  await serveDirectory(
    page,
    "__car",
    path.join(repoRoot, "content/cars/vanta-26"),
  );
  await serveBundle(page, bundle);
  await page.evaluate(async () => {
    const url = "/__bundle/module.js";
    await import(url);
    const api: CarLab = window.carLab;
    await api.start();
  });
  return problems;
}

async function shot(page: Page, testId = "lab-canvas"): Promise<PNG> {
  const bytes = await page.getByTestId(testId).screenshot();
  return PNG.sync.read(bytes);
}

function region(png: PNG, x0 = 0, y0 = 0, x1 = 1, y1 = 1): Pixel[] {
  const result: Pixel[] = [];
  for (let y = Math.ceil(y0 * png.height); y < y1 * png.height; y += 1) {
    for (let x = Math.ceil(x0 * png.width); x < x1 * png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      result.push({
        r: png.data[offset] ?? 0,
        g: png.data[offset + 1] ?? 0,
        b: png.data[offset + 2] ?? 0,
        x: x / png.width,
        y: y / png.height,
      });
    }
  }
  return result;
}

const luminance = (p: Pixel): number =>
  (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255;
const mean = (values: number[]): number =>
  values.reduce((a, b) => a + b, 0) / values.length;

function hsv({ r, g, b }: Pixel) {
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const delta = high - low;
  let h = 0;
  if (delta !== 0) {
    if (high === r) h = (g - b) / delta;
    else if (high === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return {
    h: (h * 60 + 360) % 360,
    s: high === 0 ? 0 : delta / high,
    v: high / 255,
  };
}

function isEmber(p: Pixel): boolean {
  const { h, s, v } = hsv(p);
  return h >= 5 && h <= 35 && s >= 0.5 && v >= 0.25;
}

const isMagenta = ({ r, g, b }: Pixel): boolean =>
  r >= 120 && b >= 120 && g <= 80 && r >= 2.5 * g && b >= 2.5 * g;
const share = (pixels: Pixel[], predicate: (p: Pixel) => boolean): number =>
  pixels.filter(predicate).length / pixels.length;
const spherePixels = (png: PNG): Pixel[] =>
  region(png).filter(
    (p) => Math.hypot(p.x - 0.5, p.y - 0.5) < 0.44 && luminance(p) > 0.01,
  );
const brightest = (pixels: Pixel[]): Pixel[] =>
  pixels.toSorted((a, b) => luminance(b) - luminance(a)).slice(0, 20);

function hueDistance(pixels: Pixel[], target: number): number {
  const hues = pixels.map((p) => (hsv(p).h * Math.PI) / 180);
  const angle =
    (Math.atan2(mean(hues.map(Math.sin)), mean(hues.map(Math.cos))) * 180) /
    Math.PI;
  return Math.abs(((angle - target + 540) % 360) - 180);
}

test("clear-coat paint shows the livery colour with a white clear-coat highlight", async ({
  page,
}) => {
  const problems = await lab(page);
  for (const [primary, hue] of [
    ["#d8471c", 13.7],
    ["#1f5fa8", 212.3],
  ] as const) {
    await page.evaluate(
      (color) => window.carLab.sphere("paint", color),
      primary,
    );
    const pixels = spherePixels(await shot(page));
    const colored = pixels.filter((p) => hsv(p).s >= 0.3);
    expect(hueDistance(colored, hue)).toBeLessThanOrEqual(25);
    expect(colored.length / pixels.length).toBeGreaterThanOrEqual(0.4);
    expect(
      Math.min(...brightest(pixels).map((p) => Math.min(p.r, p.g, p.b))),
    ).toBeGreaterThanOrEqual(230);
  }
  expect(problems).toEqual([]);
});

test("rubber is dark and matte", async ({ page }) => {
  const problems = await lab(page);
  await page.evaluate(() => window.carLab.sphere("rubber", "#000000"));
  const pixels = spherePixels(await shot(page));
  expect(mean(pixels.map(luminance))).toBeLessThan(0.16);
  expect(mean(brightest(pixels).map(luminance))).toBeLessThan(0.5);
  expect(problems).toEqual([]);
});

function gradient(pixels: Pixel[]): number {
  return (
    mean(pixels.filter((p) => p.y < 1 / 3).map(luminance)) -
    mean(pixels.filter((p) => p.y > 2 / 3).map(luminance))
  );
}

test("metal reflects the sky above and the ground below", async ({ page }) => {
  const problems = await lab(page);
  await page.evaluate(() => window.carLab.sphere("metal", "#000000"));
  const metal = spherePixels(await shot(page));
  await page.evaluate(() => window.carLab.sphere("rubber", "#000000"));
  const rubber = spherePixels(await shot(page));
  expect(gradient(metal)).toBeGreaterThanOrEqual(0.08);
  expect(gradient(metal)).toBeGreaterThanOrEqual(3 * gradient(rubber));
  expect(mean(brightest(metal).map(luminance))).toBeGreaterThanOrEqual(0.6);
  expect(problems).toEqual([]);
});

function cells(png: PNG): number[] {
  const values: number[] = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      values.push(
        mean(
          region(
            png,
            (x + 0.25) / 16,
            (y + 0.25) / 16,
            (x + 0.75) / 16,
            (y + 0.75) / 16,
          ).map(luminance),
        ),
      );
    }
  }
  return values;
}

function correlation(a: number[], b: number[]): number {
  const ac = a.map((value) => value - mean(a));
  const bc = b.map((value) => value - mean(b));
  return (
    ac.reduce((sum, value, index) => sum + value * (bc[index] ?? 0), 0) /
    Math.sqrt(
      ac.reduce((s, v) => s + v * v, 0) * bc.reduce((s, v) => s + v * v, 0),
    )
  );
}

test("carbon is dark and shows a twill weave whose bright tows flip when the light turns 90 degrees", async ({
  page,
}) => {
  const problems = await lab(page);
  await page.evaluate(() => window.carLab.carbon(0));
  const a = cells(await shot(page));
  await page.evaluate(() => window.carLab.carbon(Math.PI / 2));
  const b = cells(await shot(page));
  const ordered = a.toSorted((x, y) => x - y);
  expect(mean(a)).toBeLessThan(0.3);
  expect(
    (mean(ordered.slice(128)) - mean(ordered.slice(0, 128))) / mean(a),
  ).toBeGreaterThanOrEqual(0.25);
  expect(correlation(a, b)).toBeLessThanOrEqual(-0.5);
  expect(problems).toEqual([]);
});

test("each mirror shows what is behind its own side of the car", async ({
  page,
}) => {
  const problems = await lab(page);
  const views = [
    ["left-mirror", "none", false],
    ["left-mirror", "left", true],
    ["right-mirror", "left", false],
    ["right-mirror", "right", true],
  ] as const;
  for (const [view, box, visible] of views) {
    await page.evaluate(([v, b]) => window.carLab.car(v, b), [
      view,
      box,
    ] as const);
    const magenta = share(region(await shot(page)), isMagenta);
    if (visible) expect(magenta).toBeGreaterThanOrEqual(0.004);
    else expect(magenta).toBeLessThanOrEqual(0.0005);
  }
  expect(problems).toEqual([]);
});

test("changing the livery repaints the car", async ({ page }) => {
  const problems = await lab(page);
  await page.evaluate(() => window.carLab.car("chase", "none"));
  const ember = share(region(await shot(page)), isEmber);
  expect(ember).toBeGreaterThanOrEqual(0.01);
  await page.evaluate(() => window.carLab.setLivery("glacier.json"));
  const glacier = region(await shot(page));
  expect(share(glacier, isEmber)).toBeLessThanOrEqual(0.2 * ember);
  expect(
    share(glacier, (p) => {
      const { h, s } = hsv(p);
      return h >= 195 && h <= 230 && s >= 0.4;
    }),
  ).toBeGreaterThanOrEqual(0.002);
  await page.evaluate(() => window.carLab.setLivery("ember.json"));
  expect(share(region(await shot(page)), isEmber)).toBeGreaterThanOrEqual(
    0.8 * ember,
  );
  expect(problems).toEqual([]);
});

async function sceneFrames(page: Page): Promise<void> {
  const timings = page.getByTestId("gpu-timings");
  const frames = Number(await timings.getAttribute("data-frames"));
  await expect
    .poll(async () => Number(await timings.getAttribute("data-frames")))
    .toBeGreaterThanOrEqual(frames + 3);
}

async function mainScene(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/scene.html");
  await expect(page.locator("body")).toHaveAttribute(
    "data-render-status",
    "ready",
    { timeout: 30_000 },
  );
  await sceneFrames(page);
}

test("the chase camera shows the painted car with no console problems", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await mainScene(page);
  expect(
    share(region(await shot(page, "scene-canvas")), isEmber),
  ).toBeGreaterThanOrEqual(0.005);
  expect(problems).toEqual([]);
});

test("the cockpit camera sits behind the halo and looks down the painted nose", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await mainScene(page);
  await page.keyboard.press("c");
  await expect(page.locator("body")).toHaveAttribute("data-camera", "cockpit");
  await sceneFrames(page);
  const png = await shot(page, "scene-canvas");
  expect(
    share(region(png, 0.495, 0.22, 0.505, 0.4), (p) => luminance(p) < 0.3),
  ).toBeGreaterThanOrEqual(0.5);
  expect(
    share(region(png, 0.25, 0.6, 0.75, 1), isEmber),
  ).toBeGreaterThanOrEqual(0.02);
  expect(problems).toEqual([]);
});
