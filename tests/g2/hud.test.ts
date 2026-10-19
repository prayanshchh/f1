import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { formatHud, type HudFrame } from "../../apps/client/src/hud/index.ts";
import { caughtError } from "../f1/support/sim.ts";
import { repoRoot } from "../support/repo.ts";
import {
  empty,
  emptyText,
  racing,
  racingText,
  type Frame,
} from "./support/frames.ts";

function hud(frame: Frame) {
  const typed: HudFrame = frame;
  return formatHud(typed);
}

test("a racing frame is formatted with the agreed units and rounding", () => {
  expect(hud(racing)).toEqual(racingText);
});

test("a frame without simulation data shows placeholders and no numbers at all", () => {
  const text = hud(empty);
  expect(text).toEqual(emptyText);
  expect(JSON.stringify(text)).not.toMatch(/[0-9]/);
});

test("each field falls back on its own when only it is missing", () => {
  for (const field of Object.keys(empty) as (keyof Frame)[]) {
    const text = hud({ ...racing, [field]: null });
    for (const [name, value] of Object.entries(text)) {
      if (name === field || (field === "delta" && name === "deltaTrend")) {
        continue;
      }
      expect(value, `${name} must not change when ${field} is missing`).toEqual(
        racingText[name as keyof typeof racingText],
      );
    }
  }
});

describe("gears", () => {
  test.each([
    [-1, "R"],
    [0, "N"],
    [1, "1"],
    [8, "8"],
  ])("gear %d reads %s", (gear, label) => {
    expect(hud({ ...racing, gear }).gear).toBe(label);
  });
});

describe("delta", () => {
  test.each([
    [0.1234, "+0.123", "slower"],
    [-0.1236, "-0.124", "faster"],
    [0, "+0.000", "even"],
    [-0, "+0.000", "even"],
    [-0.0004, "+0.000", "even"],
    [0.0004, "+0.000", "even"],
    [12.3456, "+12.346", "slower"],
    [-75.5, "-75.500", "faster"],
  ])("%d seconds reads %s and is %s", (delta, label, trend) => {
    const text = hud({ ...racing, delta });
    expect(text.delta).toBe(label);
    expect(text.deltaTrend).toBe(trend);
  });
});

test("speed is whole kilometres per hour", () => {
  expect(hud({ ...racing, speed: 0 }).speed).toBe("0");
  expect(hud({ ...racing, speed: 0.13 }).speed).toBe("0");
  expect(hud({ ...racing, speed: 0.14 }).speed).toBe("1");
  expect(hud({ ...racing, speed: 100 }).speed).toBe("360");
});

const invalid: [string, Frame][] = [
  ["a negative speed", { ...racing, speed: -1 }],
  ["a speed that is not a number", { ...racing, speed: Number.NaN }],
  ["an infinite rpm", { ...racing, rpm: Number.POSITIVE_INFINITY }],
  ["a ninth gear", { ...racing, gear: 9 }],
  ["a fractional gear", { ...racing, gear: 2.5 }],
  [
    "a charge above full",
    {
      ...racing,
      energy: { charge: 1.01, deploying: false, harvesting: false },
    },
  ],
  [
    "a negative charge",
    {
      ...racing,
      energy: { charge: -0.01, deploying: false, harvesting: true },
    },
  ],
  ["three tyres", { ...racing, tyres: racing.tyres?.slice(0, 3) ?? [] }],
  [
    "wear above one",
    {
      ...racing,
      tyres: (racing.tyres ?? []).map((tyre) => ({ ...tyre, wear: 1.2 })),
    },
  ],
  [
    "a tyre temperature that is not a number",
    {
      ...racing,
      tyres: (racing.tyres ?? []).map((tyre) => ({
        ...tyre,
        temperature: Number.NaN,
      })),
    },
  ],
  ["a delta that is not a number", { ...racing, delta: Number.NaN }],
  ["lap zero", { ...racing, lap: { current: 0, total: 57 } }],
  ["a lap past the total", { ...racing, lap: { current: 58, total: 57 } }],
];

test.each(invalid)("%s is rejected instead of displayed", (_label, frame) => {
  expect(caughtError(() => hud(frame))).toBeInstanceOf(RangeError);
});

test("formatting is pure: the same frame always gives the same text and is not modified", () => {
  const frame = structuredClone(racing);
  const first = hud(frame);
  const second = hud(frame);
  expect(second).toEqual(first);
  expect(frame).toEqual(racing);
});

test("the HUD code never invents values", () => {
  const directory = path.join(repoRoot, "apps/client/src/hud");
  const sources = readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(path.join(directory, file), "utf8"))
    .join("\n");
  expect(sources).not.toMatch(
    /Math\.random|Date\.now|performance\.now|crypto\.getRandomValues|new Date\b/,
  );
});
