import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { recordProblems } from "../../support/bundle.ts";

const tiers = ["ultra", "high", "medium", "low", "basic"];

interface AdapterFacts {
  timestamps: boolean;
  software: boolean;
}

async function adapterFacts(page: Page): Promise<AdapterFacts> {
  return page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) {
      return { timestamps: false, software: true };
    }
    const info = adapter.info;
    return {
      timestamps: adapter.features.has("timestamp-query"),
      software:
        info.isFallbackAdapter ||
        /swiftshader/i.test(
          `${info.vendor} ${info.architecture} ${info.description}`,
        ),
    };
  });
}

async function openScene(page: Page, query = ""): Promise<void> {
  await page.goto(`/scene.html${query}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-render-status",
    "ready",
    { timeout: 30_000 },
  );
}

const overlay = (page: Page) => page.getByTestId("gpu-timings");

async function overlayNumber(page: Page, name: string): Promise<number> {
  return Number(await overlay(page).getAttribute(`data-${name}`));
}

interface Picture {
  colors: number;
  brightness: number;
  png: PNG;
}

async function picture(page: Page): Promise<Picture> {
  const png = PNG.sync.read(
    await page.getByTestId("scene-canvas").screenshot(),
  );
  const colors = new Set<number>();
  let brightness = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const [r, g, b] = [
      png.data[offset] ?? 0,
      png.data[offset + 1] ?? 0,
      png.data[offset + 2] ?? 0,
    ];
    colors.add((r << 16) | (g << 8) | b);
    brightness += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return {
    colors: colors.size,
    brightness: brightness / (png.data.length / 4),
    png,
  };
}

function changedShare(a: PNG, b: PNG): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let changed = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    const delta = [0, 1, 2].reduce(
      (total, channel) =>
        total +
        Math.abs(
          (a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0),
        ),
      0,
    );
    changed += delta > 24 ? 1 : 0;
  }
  return changed / (a.data.length / 4);
}

test("the placeholder scene renders in a worker with no console problems", async ({
  page,
}) => {
  const problems = recordProblems(page);
  const models: string[] = [];
  page.on("response", (response) => {
    if (/\.(glb|gltf)(\?|$)/.test(response.url()) && response.ok()) {
      models.push(response.url());
    }
  });
  await openScene(page);
  const transferred = await page
    .getByTestId("scene-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      try {
        canvas.getContext("2d");
        return "still owned by the page";
      } catch (error) {
        return error instanceof DOMException ? error.name : String(error);
      }
    });
  expect(
    transferred,
    "the canvas must be transferred to an OffscreenCanvas",
  ).toBe("InvalidStateError");
  expect(page.workers().length).toBeGreaterThanOrEqual(1);
  expect(
    models.length,
    "the scene must load a glTF model",
  ).toBeGreaterThanOrEqual(1);
  expect(await overlayNumber(page, "meshes")).toBeGreaterThanOrEqual(1);
  expect(problems).toEqual([]);
});

test("the scene is lit with PBR shading rather than flat colours", async ({
  page,
}) => {
  await openScene(page);
  await page.waitForTimeout(500);
  const shot = await picture(page);
  expect(shot.colors).toBeGreaterThanOrEqual(500);
  expect(shot.brightness).toBeGreaterThan(0.05);
  expect(shot.brightness).toBeLessThan(0.95);
});

test("the overlay shows live frame and GPU timings", async ({ page }) => {
  await openScene(page);
  const facts = await adapterFacts(page);
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toContainText(/fps/i);
  await expect(overlay(page)).toContainText(/ms/);
  expect(await overlay(page).getAttribute("data-backend")).toBe("webgpu");
  expect(tiers).toContain(await overlay(page).getAttribute("data-tier"));
  const firstFrames = await overlayNumber(page, "frames");
  await page.waitForTimeout(1000);
  expect(await overlayNumber(page, "frames")).toBeGreaterThan(firstFrames);
  const frameMs = await overlayNumber(page, "frame-ms");
  expect(frameMs).toBeGreaterThan(0);
  expect(frameMs).toBeLessThan(1000);
  const gpu = await overlay(page).getAttribute("data-gpu-ms");
  if (facts.timestamps) {
    expect(Number(gpu)).toBeGreaterThan(0);
    expect(Number(gpu)).toBeLessThan(1000);
  } else {
    expect(gpu).toBe("unavailable");
  }
});

test("the scene holds 60 frames per second on a hardware GPU", async ({
  page,
}) => {
  await openScene(page);
  const facts = await adapterFacts(page);
  await page.waitForTimeout(1000);
  const startFrames = await overlayNumber(page, "frames");
  const started = Date.now();
  await page.waitForTimeout(3000);
  const frames = (await overlayNumber(page, "frames")) - startFrames;
  const fps = (frames * 1000) / (Date.now() - started);
  expect(fps).toBeGreaterThanOrEqual(facts.software ? 5 : 55);
  const reported = await overlayNumber(page, "fps");
  expect(Math.abs(reported - fps)).toBeLessThanOrEqual(Math.max(6, fps * 0.15));
});

test("the camera key cycles through chase, cockpit and TV cameras", async ({
  page,
}) => {
  await openScene(page);
  const body = page.locator("body");
  const seen: string[] = [];
  let previous = (await picture(page)).png;
  for (let press = 0; press < 3; press += 1) {
    seen.push((await body.getAttribute("data-camera")) ?? "");
    await page.keyboard.press("c");
    await expect(body).not.toHaveAttribute("data-camera", seen.at(-1) ?? "");
    await page.waitForTimeout(300);
    const current = (await picture(page)).png;
    expect(
      changedShare(previous, current),
      "switching cameras must change the view",
    ).toBeGreaterThan(0.05);
    previous = current;
  }
  expect([...seen].sort()).toEqual(["chase", "cockpit", "tv"]);
  await expect(body).toHaveAttribute("data-camera", seen[0] ?? "");
});

test("resizing the window resizes the drawing buffer in device pixels", async ({
  page,
}) => {
  await openScene(page);
  for (const size of [
    { width: 800, height: 500 },
    { width: 1100, height: 700 },
  ]) {
    await page.setViewportSize(size);
    const css = await page.getByTestId("scene-canvas").evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return `${String(Math.round(rect.width * devicePixelRatio))}x${String(Math.round(rect.height * devicePixelRatio))}`;
    });
    await expect(overlay(page)).toHaveAttribute("data-resolution", css);
  }
});

test("a lower quality tier can be forced and is reported", async ({ page }) => {
  await openScene(page, "?tier=low");
  await expect(overlay(page)).toHaveAttribute("data-tier", "low");
});

test("the WebGL2 fallback draws the same scene in the basic tier", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await openScene(page, "?backend=webgl2");
  await expect(overlay(page)).toHaveAttribute("data-backend", "webgl2");
  await expect(overlay(page)).toHaveAttribute("data-tier", "basic");
  await page.waitForTimeout(500);
  const shot = await picture(page);
  expect(shot.colors).toBeGreaterThanOrEqual(100);
  expect(shot.brightness).toBeGreaterThan(0.05);
  expect(problems).toEqual([]);
});

test("an unknown backend or tier is refused with a visible explanation", async ({
  page,
}) => {
  for (const query of ["?backend=vulkan", "?tier=extreme"]) {
    await page.goto(`/scene.html${query}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute(
      "data-render-status",
      "error",
    );
  }
});
