import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { pedals, setupOf, square } from "../../support/sim.ts";
import { recordProblems, serveDirectory } from "../../support/bundle.ts";
import { repoRoot, run } from "../../support/repo.ts";
import {
  buildScenarioRunner,
  runScenario,
  runScenarioFile,
  type Telemetry,
} from "../support/scenario.ts";

const dist = path.join(repoRoot, "apps/telemetry/dist");
let straight: Telemetry;
let straightText: string;
let twoCars: Telemetry;

test.beforeAll(() => {
  test.setTimeout(600_000);
  const build = run("pnpm", ["--filter", "./apps/telemetry", "run", "build"]);
  if (build.code !== 0) {
    throw new Error(`the telemetry viewer did not build:\n${build.output}`);
  }
  const runner = buildScenarioRunner();
  const result = runScenarioFile(runner, [
    "run",
    path.join(repoRoot, "content/scenarios/straight-line.json"),
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr);
  }
  straightText = result.stdout;
  straight = JSON.parse(straightText) as Telemetry;
  twoCars = runScenario(runner, {
    name: "Two cars",
    setup: setupOf(square(300), [
      { id: 8, startDistance: 0 },
      { id: 31, startDistance: 600 },
    ]),
    ticks: 3000,
    inputs: [
      {
        fromTick: 0,
        cars: [pedals({ throttle: 1 }), pedals({ throttle: 0.3 })],
      },
      { fromTick: 2000, cars: [pedals({ brake: 1 }), pedals({ throttle: 1 })] },
    ],
  });
});

async function openViewer(
  page: Page,
  query: string,
  files: Record<string, string>,
) {
  await serveDirectory(page, "__telemetry", dist, files);
  await page.goto(`/__telemetry/index.html${query}`);
}

interface Point {
  x: number;
  y: number;
}

async function plotted(page: Page, channel: string): Promise<Point[]> {
  const line = page.locator(
    `svg[data-testid="chart-${channel}"] polyline[data-channel="${channel}"]`,
  );
  await expect(line).toHaveCount(1);
  const points = (await line.getAttribute("points")) ?? "";
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x ?? Number.NaN, y: y ?? Number.NaN };
    });
}

function expectOrderedFinitePoints(points: Point[], samples: number): void {
  expect(points.length).toBeGreaterThanOrEqual(Math.min(200, samples));
  for (const point of points) {
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
  }
  for (const [index, point] of points.slice(1).entries()) {
    expect(point.x).toBeGreaterThanOrEqual(points[index]?.x ?? 0);
  }
}

function span(numbers: number[]): { low: number; high: number } {
  return { low: Math.min(...numbers), high: Math.max(...numbers) };
}

function expectPlotOf(points: Point[], values: number[], hz: number): void {
  expectOrderedFinitePoints(points, values.length);
  const first = points[0]?.x ?? 0;
  const last = points.at(-1)?.x ?? 0;
  expect(last).toBeGreaterThan(first);
  const duration = (values.length - 1) / hz;
  const { low, high } = span(values);
  const { low: top, high: bottom } = span(points.map((point) => point.y));
  expect(high, "plot channels that change").toBeGreaterThan(low);
  expect(bottom, "higher values must be drawn higher up").toBeGreaterThan(top);
  const window = Math.max(1, Math.ceil(values.length * 0.005));
  const slack = (high - low) * 0.01;
  for (const point of points) {
    const time = ((point.x - first) / (last - first)) * duration;
    const sample = Math.round(time * hz);
    const nearby = span(
      values.slice(
        Math.max(0, sample - window),
        Math.min(values.length, sample + window + 1),
      ),
    );
    const value = low + ((bottom - point.y) / (bottom - top)) * (high - low);
    expect(value).toBeGreaterThanOrEqual(nearby.low - slack);
    expect(value).toBeLessThanOrEqual(nearby.high + slack);
  }
}

function channelsOf(telemetry: Telemetry, index = 0) {
  const car = telemetry.cars[index];
  if (car === undefined) {
    throw new Error("no car");
  }
  return car.channels;
}

test("the viewer builds with relative asset paths so it works from any folder", () => {
  const html = readFileSync(path.join(dist, "index.html"), "utf8");
  expect(html).not.toMatch(/(src|href)="\/(?!\/)/);
});

test("the straight-line scenario is plotted as speed, throttle and brake graphs", async ({
  page,
}) => {
  const problems = recordProblems(page);
  await openViewer(page, "?src=data/straight.json", {
    "data/straight.json": straightText,
  });
  await expect(page.getByTestId("telemetry-name")).toHaveText(straight.name);
  for (const channel of ["speed", "throttle", "brake"] as const) {
    expectPlotOf(
      await plotted(page, channel),
      channelsOf(straight)[channel],
      straight.hz,
    );
  }
  const maxSpeed = Math.max(...channelsOf(straight).speed) * 3.6;
  await expect(page.getByTestId("stat-max-speed")).toHaveText(
    `${maxSpeed.toFixed(1)} km/h`,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a telemetry file can be opened from disk", async ({ page }) => {
  const problems = recordProblems(page);
  await openViewer(page, "", {});
  await page.getByTestId("telemetry-file").setInputFiles({
    name: "straight.json",
    mimeType: "application/json",
    buffer: Buffer.from(straightText),
  });
  await expect(page.getByTestId("telemetry-name")).toHaveText(straight.name);
  expectPlotOf(
    await plotted(page, "speed"),
    channelsOf(straight).speed,
    straight.hz,
  );
  expect(problems).toEqual([]);
});

test("each car of a multi-car run can be selected", async ({ page }) => {
  await openViewer(page, "?src=data/two.json", {
    "data/two.json": JSON.stringify(twoCars),
  });
  const select = page.getByTestId("car-select");
  await expect(select.locator("option")).toHaveText(["8", "31"]);
  expectPlotOf(
    await plotted(page, "speed"),
    channelsOf(twoCars, 0).speed,
    twoCars.hz,
  );
  await select.selectOption("31");
  expectPlotOf(
    await plotted(page, "speed"),
    channelsOf(twoCars, 1).speed,
    twoCars.hz,
  );
  expectPlotOf(
    await plotted(page, "throttle"),
    channelsOf(twoCars, 1).throttle,
    twoCars.hz,
  );
});

const broken: [string, string, Record<string, string>][] = [
  [
    "a file that is not JSON",
    "?src=data/bad.json",
    { "data/bad.json": "{nope" },
  ],
  ["a missing file", "?src=data/missing.json", {}],
  [
    "channels of different lengths",
    "?src=data/uneven.json",
    {
      "data/uneven.json": JSON.stringify({
        name: "Uneven",
        hz: 500,
        finalHash: "0000000000000000",
        cars: [
          {
            id: 1,
            channels: {
              time: [0, 0.002, 0.004],
              speed: [0, 1],
              throttle: [1, 1, 1],
              brake: [0, 0, 0],
              steer: [0, 0, 0],
              lap: [0, 0, 0],
              lapDistance: [0, 0, 0],
              x: [0, 0, 0],
              y: [0, 0, 0],
              z: [0, 0, 0],
            },
          },
        ],
      }),
    },
  ],
  [
    "telemetry without cars",
    "?src=data/empty.json",
    {
      "data/empty.json": JSON.stringify({
        name: "Empty",
        hz: 500,
        finalHash: "0",
        cars: [],
      }),
    },
  ],
];

for (const [label, query, files] of broken) {
  test(`the viewer explains ${label} instead of drawing`, async ({ page }) => {
    await openViewer(page, query, files);
    await expect(page.getByRole("alert")).toContainText(/telemetry/i);
    await expect(page.locator("svg[data-testid^='chart-']")).toHaveCount(0);
  });
}
