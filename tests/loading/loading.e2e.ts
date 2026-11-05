import { expect, type Page, test } from "@playwright/test";
import { asha, seedPlayer } from "../support/player.ts";

interface Sample {
  label: string;
  value: number;
  colour: string;
}

declare global {
  interface Window {
    loadSamples: Sample[];
  }
}

const corvusTeal = "rgb(20, 201, 184)";

function sampleLoadBars(): void {
  window.loadSamples = [];
  setInterval(() => {
    const box =
      document.querySelector(".status:not([hidden])") ??
      document.querySelector(".front-car-loading");
    const bar = box?.querySelector("[role=progressbar]");
    if (!box || !bar) return;
    const fill = bar.querySelector("i");
    window.loadSamples.push({
      label:
        box.querySelector("[data-status-text], span")?.textContent.trim() ?? "",
      value: Number(bar.getAttribute("aria-valuenow")),
      colour: fill
        ? (/rgb\([^)]*\)/.exec(getComputedStyle(fill).backgroundImage)?.[0] ??
          "")
        : "",
    });
  }, 40);
}

async function slowNetwork(page: Page, megabits: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 10,
    downloadThroughput: (megabits * 1e6) / 8,
    uploadThroughput: 1e6,
  });
}

function phases(samples: Sample[]): Sample[][] {
  const runs: Sample[][] = [];
  for (const sample of samples) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run && previous && sample.value >= previous.value) run.push(sample);
    else runs.push([sample]);
  }
  return runs;
}

function longestPlateau(values: number[]): number {
  let longest = 0;
  let length = 0;
  values.forEach((value, index) => {
    length = value === values[index - 1] ? length + 1 : 1;
    longest = Math.max(longest, length);
  });
  return longest;
}

function colours(samples: Sample[]): Set<string> {
  return new Set(
    samples.filter((sample) => sample.value > 0).map((sample) => sample.colour),
  );
}

function partway(run: Sample[]): Set<number> {
  return new Set(
    run.map((sample) => sample.value).filter((value) => value % 100 !== 0),
  );
}

test.describe("loading progress", () => {
  test.setTimeout(240_000);

  test("the start and the hub cars show a bar that fills with the download in the team colour", async ({
    page,
    context,
  }) => {
    await seedPlayer(context);
    await page.addInitScript(() => {
      localStorage.setItem("revracers.tutorial", "skipped");
    });
    await page.goto("/");
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".front-car-loading")).toHaveCount(0, {
      timeout: 60_000,
    });

    await page.addInitScript(sampleLoadBars);
    await slowNetwork(page, 40);
    await page.goto("/");
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(".front-car-loading")).toHaveCount(0, {
      timeout: 120_000,
    });
    const samples = await page.evaluate(() => window.loadSamples);

    expect(samples.map((sample) => sample.label)).not.toContainEqual(
      expect.stringMatching(/speed dreams|cars|webgpu/i),
    );
    expect(colours(samples)).toEqual(new Set([corvusTeal]));
    const runs = phases(samples);
    expect(runs.length).toBeLessThanOrEqual(2);
    expect(partway(runs[0] ?? []).size).toBeGreaterThanOrEqual(10);
    for (const run of runs) expect(run.at(-1)?.value).toBe(100);
  });

  if (process.platform !== "linux") {
    test("loading the circuit fills the bar steadily instead of jumping at the end", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await page.addInitScript(sampleLoadBars);
      await slowNetwork(page, 160);
      await page.goto(`/?autostart&team=${asha.team}`);
      await expect(page.getByTestId("drive-status")).toBeHidden({
        timeout: 180_000,
      });
      const samples = await page.evaluate(() => window.loadSamples);

      const circuit = samples.filter((sample) =>
        sample.label.startsWith("Loading Hill Country"),
      );
      const values = circuit.map((sample) => sample.value);
      expect(values).toEqual(values.toSorted((a, b) => a - b));
      expect(Math.max(...values)).toBeGreaterThanOrEqual(80);
      const steps = new Set(values.filter((value) => value > 0));
      expect(steps.size).toBeGreaterThanOrEqual(20);
      expect(longestPlateau(values)).toBeLessThan(values.length * 0.35);
      expect(colours(circuit)).toEqual(new Set([corvusTeal]));
    });
  }
});
