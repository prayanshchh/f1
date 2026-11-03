import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  sessionKind,
  startField,
  statsOf,
  timingOf,
  weatherOf,
  type Weekend,
} from "../support/race-weekend.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { startCircuit, wasm } from "../support/speed-dreams.ts";

const fieldSize = 22;
const wet = 4;
const inter = 3;
const stepsPerSecond = 500;

function family(compound: number): "slick" | "inter" | "wet" {
  if (compound === wet) return "wet";
  return compound === inter ? "inter" : "slick";
}

function seconds(m: Weekend, count: number, each?: (second: number) => void) {
  for (let second = 1; second <= count; second++) {
    m._sdStep(stepsPerSecond);
    each?.(second);
  }
}

describe.runIf(existsSync(wasm))("rain and a drying track", () => {
  test("a wet start puts the field on wets, then inters, then slicks as the line dries", async () => {
    const laps = 10;
    const m = await startField({
      kind: sessionKind.race,
      laps,
      seed: 7,
      rain: "medium",
    });
    const rivals = () => timingOf(m, fieldSize).slice(1);
    expect(rivals().every((car) => car.compound === wet)).toBe(true);
    seconds(m, 300);
    const soaked = weatherOf(m);
    expect(soaked.line).toBeGreaterThan(0.55);
    m._sdWeatherSet(0, soaked.line, soaked.off);
    const majority = new Set<string>();
    let lineAhead = 0;
    seconds(m, 1500, (second) => {
      const cars = rivals().filter((car) => !car.finished);
      if (cars.length === 0) return;
      const counts = { slick: 0, inter: 0, wet: 0 };
      for (const car of cars) counts[family(car.compound)]++;
      for (const [name, count] of Object.entries(counts))
        if (count > cars.length / 2) majority.add(name);
      if (second % 10 !== 0) return;
      const w = weatherOf(m);
      if (w.off - w.line > 0.05) lineAhead++;
    });
    expect([...majority]).toEqual(["wet", "inter", "slick"]);
    expect(lineAhead).toBeGreaterThan(60);
    const end = rivals();
    expect(end.filter((car) => car.retired)).toEqual([]);
    expect(end.every((car) => car.finished)).toBe(true);
    expect(end.every((car) => family(car.compound) === "slick")).toBe(true);
    expect(statsOf(m).walls).toBeLessThan(laps * 3);
  });

  test("cars keep to the drying line, where the water is shallower", async () => {
    const { entrants, slots } = planWeekend("corvus", 0, null);
    const m = await startField({
      kind: sessionKind.race,
      laps: 5,
      seed: 3,
      rain: "heavy",
      plan: { entrants: entrants.slice(0, 1), slots: slots.slice(0, 1) },
    });
    seconds(m, 60);
    const w = weatherOf(m);
    m._sdWeatherSet(0, w.line * 0.4, w.off);
    let met = 0;
    let middle = 0;
    seconds(m, 90, () => {
      const now = weatherOf(m);
      expect(now.player).toBeGreaterThanOrEqual(now.line - 1e-9);
      expect(now.player).toBeLessThanOrEqual(now.off + 1e-9);
      met += now.player;
      middle += (now.line + now.off) / 2;
    });
    expect(met).toBeLessThan(middle);
  });

  test("dynamic weather keeps its forecast and repeats for the same seed", async () => {
    const start = (weatherSeed: number) =>
      startCircuit<Weekend>((m) => {
        m._sdWeatherConfigure(1, weatherSeed);
      });
    const seeds = [11, 12, 13, 14, 15, 16];
    const forecasts = await Promise.all(
      seeds.map(async (seed) => weatherOf(await start(seed)).forecast),
    );
    expect(new Set(forecasts.map((f) => f.join())).size).toBeGreaterThan(1);
    const m = await start(seeds[0] ?? 0);
    const promised = weatherOf(m).forecast;
    expect(weatherOf(await start(seeds[0] ?? 0)).forecast).toEqual(promised);
    for (const expected of promised.slice(0, 3)) {
      seconds(m, 300);
      expect(weatherOf(m).rain).toBeCloseTo(expected, 3);
    }
  });
});
