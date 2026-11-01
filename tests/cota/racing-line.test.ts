import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  cornerMask,
  cues,
  layTiles,
  type Cue,
  type RacingLineData,
  type SpeedProfile,
} from "../../apps/client/src/game/racing-line.ts";
import { choices } from "../../apps/client/src/game/settings.ts";
import { repoRoot } from "../support/repo.ts";

interface Point {
  x: number;
  z: number;
  width: number;
}

const directory = path.join(repoRoot, "content/tracks/cota");
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
) as { length: number; centerline: Point[] };
const line = JSON.parse(
  readFileSync(path.join(directory, "racing-line.json"), "utf8"),
) as RacingLineData;
const n = line.x.length;
const step = line.length / n;
const kerbWidth = 1.2;

function profile(skill: string): SpeedProfile {
  const p = line.profiles[skill];
  if (!p) throw new Error(`no profile for ${skill}`);
  return p;
}

const rookie = profile("rookie");
const value = (values: number[], i: number) => values[((i % n) + n) % n] ?? 0;

function firstBrake(plan: Cue[], from: number): number {
  for (let k = 0; k < n; k++)
    if (plan[(from + k) % n]?.kind === "brake") return k * step;
  return Infinity;
}

const turnOne = (() => {
  let slowest = 0;
  for (let i = 0; i < Math.round(900 / step); i++)
    if (value(rookie.speed, i) < value(rookie.speed, slowest)) slowest = i;
  return slowest;
})();
const approach = Math.round(250 / step);

describe("COTA racing line data", () => {
  test("follows track.json and stays on the asphalt or kerb", () => {
    expect(n).toBe(track.centerline.length);
    expect(line.length).toBe(track.length);
    track.centerline.forEach((c, i) => {
      const off = Math.hypot(value(line.x, i) - c.x, value(line.z, i) - c.z);
      expect(off).toBeLessThan(c.width / 2 + kerbWidth - 0.9);
    });
  });

  test("is a smooth closed loop", () => {
    const heading = (i: number) =>
      Math.atan2(
        value(line.z, i + 1) - value(line.z, i),
        value(line.x, i + 1) - value(line.x, i),
      );
    for (let i = 0; i < n; i++) {
      const turn = heading(i) - heading(i - 1);
      expect(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))).toBeLessThan(
        0.2,
      );
      const gap = Math.hypot(
        value(line.x, i + 1) - value(line.x, i),
        value(line.z, i + 1) - value(line.z, i),
      );
      expect(gap).toBeGreaterThan(step * 0.4);
      expect(gap).toBeLessThan(step * 1.6);
    }
  });

  test("has a physically plausible profile for every driving proficiency", () => {
    for (const { id } of choices.skill) {
      const p = profile(id);
      expect(p.speed).toHaveLength(n);
      expect(p.braking).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        const v = value(p.speed, i);
        expect(v).toBeGreaterThan(10);
        expect(v).toBeLessThan(100);
        expect(v).toBeLessThanOrEqual(value(p.braking, i) + 1e-6);
        const decel =
          (value(p.braking, i) ** 2 - value(p.braking, i + 1) ** 2) /
          (2 * step);
        expect(decel).toBeLessThan(60);
      }
      const lap = p.speed.reduce((sum, v) => sum + step / v, 0);
      expect(Math.abs(lap - p.lapTime)).toBeLessThan(0.05);
    }
  });

  test("never expects more pace from a level with less downforce or grip", () => {
    const order = ["arcade", "rookie", "amateur", "pro"].map(
      (id) => profile(id).lapTime,
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(profile("semi-pro").lapTime).toBe(profile("pro").lapTime);
  });
});

describe("dynamic racing line cues", () => {
  const before = turnOne - approach;
  const ideal = value(rookie.speed, before);

  test("tells a car on the ideal pace to brake before turn one and to accelerate out of it", () => {
    const plan = cues(rookie, line.length, before * step, ideal);
    const brake = firstBrake(plan, before);
    expect(brake).toBeGreaterThan(20);
    expect(brake).toBeLessThan(approach * step);
    expect(plan[before]?.kind).toBe("accelerate");
    expect(plan[(turnOne + Math.round(60 / step)) % n]?.kind).toBe(
      "accelerate",
    );
  });

  test("moves the braking point earlier for a faster car and later for a slower one", () => {
    const at = (speed: number) =>
      firstBrake(cues(rookie, line.length, before * step, speed), before);
    expect(at(ideal + 8)).toBeLessThan(at(ideal) - 10);
    expect(at(ideal - 8)).toBeGreaterThan(at(ideal) + 10);
  });

  test("demands braking at once when the car is already too fast for the corner", () => {
    const close = turnOne - Math.round(30 / step);
    const plan = cues(rookie, line.length, close * step, 80);
    expect(plan[close]?.kind).toBe("brake");
  });

  test("warns with lift tiles before every braking zone", () => {
    const plan = cues(rookie, line.length, 0, value(rookie.speed, 0));
    let zones = 0;
    for (let i = 1; i < n; i++) {
      if (plan[i]?.kind !== "brake" || plan[i - 1]?.kind === "brake") continue;
      zones++;
      expect(plan[i - 1]?.kind).toBe("lift");
    }
    expect(zones).toBeGreaterThanOrEqual(8);
  });

  test("reads ahead across the start line", () => {
    const end = n - Math.round(40 / step);
    const plan = cues(
      rookie,
      line.length,
      end * step,
      value(rookie.speed, end),
    );
    const lapStart = cues(rookie, line.length, 0, value(rookie.speed, 0));
    expect(firstBrake(plan, end)).toBeCloseTo(
      firstBrake(lapStart, 0) + (n - end) * step,
      5,
    );
  });
});

describe("racing line tiles", () => {
  const corners = cornerMask(line, rookie);
  const tiles = layTiles(line, corners);

  test("span the whole lap without gaps", () => {
    expect(tiles[0]?.distance).toBe(0);
    for (let i = 1; i < tiles.length; i++) {
      const gap = (tiles[i]?.distance ?? 0) - (tiles[i - 1]?.distance ?? 0);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(6.5);
    }
    expect(line.length - (tiles.at(-1)?.distance ?? 0)).toBeLessThan(8);
  });

  test("cover every braking zone in corners-only mode but leave the straights bare", () => {
    const plan = cues(rookie, line.length, 0, value(rookie.speed, 0));
    plan.forEach((cue, i) => {
      if (cue.kind !== "accelerate") expect(corners[i]).toBe(true);
    });
    const covered = corners.filter(Boolean).length / n;
    expect(covered).toBeGreaterThan(0.3);
    expect(covered).toBeLessThan(0.8);
  });
});
