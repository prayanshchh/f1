import { describe, expect, test } from "vitest";
import {
  clockText,
  planWeekend,
  raceLapOptions,
  raceLaps,
  teams,
} from "../apps/client/src/game/weekend.ts";
import { PitStop, type PitLayout } from "../apps/client/src/game/pitstop.ts";
import { stageOf, type Settings } from "../apps/client/src/game/settings.ts";

const session = (value: Settings["session"]) =>
  ({ session: value }) as unknown as Settings;

describe("weekend plan", () => {
  test("every team and start slot gives each car its own grid box", () => {
    for (const team of teams)
      for (const start of [0, 10, 21, 99]) {
        const { entrants, slots } = planWeekend(team.car, start, null);
        expect(entrants).toHaveLength(22);
        expect([...slots].sort((a, b) => a - b)).toEqual(
          entrants.map((_, i) => i),
        );
        expect(slots[0]).toBe(Math.min(start, 21));
        expect(entrants.filter((e) => e.player)).toHaveLength(1);
      }
  });

  test("the player takes one seat, so their team keeps two cars", () => {
    for (const team of teams) {
      const { entrants } = planWeekend(team.car, 0, null);
      expect(entrants.filter((e) => e.teamIndex === team.index)).toHaveLength(
        2,
      );
    }
  });

  test("the qualifying order becomes the race grid", () => {
    const first = planWeekend("corvus", 5, null);
    const order = first.entrants.map((e) => e.code).reverse();
    const { entrants, slots } = planWeekend("corvus", 5, order);
    entrants.forEach((entrant, i) => {
      expect(order[slots[i] ?? -1]).toBe(entrant.code);
    });
  });

  test("a stale grid falls back to the pace order", () => {
    const { slots } = planWeekend("corvus", 5, ["YOU", "NOT"]);
    expect(slots[0]).toBe(5);
    expect(new Set(slots).size).toBe(22);
  });
});

describe("race distance", () => {
  test("lap choices climb in tens and stop at the real distance", () => {
    const options = raceLapOptions();
    expect(options.at(-1)).toBe(raceLaps);
    options.slice(1, -1).forEach((laps, i) => {
      expect(laps - (options[i] ?? 0)).toBe(10);
    });
    expect(new Set(options).size).toBe(options.length);
  });
});

describe("session flow", () => {
  test("a weekend starts in qualifying and resumes at the race", () => {
    expect(stageOf(session("weekend"), null)).toBe("qualifying");
    expect(stageOf(session("weekend"), "race")).toBe("race");
    expect(stageOf(session("race"), "qualifying")).toBe("race");
    expect(stageOf(session("practice"), "race")).toBeNull();
  });

  test("the session clock rounds up and never goes negative", () => {
    expect(clockText(18 * 60)).toBe("18:00");
    expect(clockText(59.2)).toBe("1:00");
    expect(clockText(-3)).toBe("0:00");
  });
});

describe("leaving the box", () => {
  const layout: PitLayout = {
    length: 5500,
    entry: 5300,
    wallStart: 5350,
    wallEnd: 500,
    exit: 600,
    pitWall: 9,
    shift: 2,
    ramp: 30,
    fastLane: 14.5,
    speedLimit: 80,
    boxDistance: 100,
    boxLateral: 22,
  };
  const inBox = { distance: 100, toMiddle: 20, speed: 0 };

  test("the garage waits for a gap in the fast lane", () => {
    const pit = new PitStop(layout, false);
    pit.startInGarage();
    pit.goToTrack();
    const blocked = pit.update({ ...inBox, laneClear: false }, 1, false);
    expect(blocked.hold).toBe(true);
    expect(pit.atGarage).toBe(true);
    const clear = pit.update({ ...inBox, laneClear: true }, 2, false);
    expect(clear.hold).toBe(false);
    expect(clear.phase).toBe("release");
    expect(pit.atGarage).toBe(false);
  });

  test("steering stays automatic until the car is straight in the lane", () => {
    const pit = new PitStop(layout, false);
    pit.startInGarage();
    pit.goToTrack();
    pit.update(inBox, 0, false);
    const inLane = { toMiddle: 12.5, speed: 20 };
    expect(
      pit.update({ ...inLane, distance: 130 }, 1, false).drive,
    ).not.toBeNull();
    const handed = pit.update({ ...inLane, distance: 170 }, 2, false);
    expect(handed.drive).toBeNull();
    expect(handed.phase).toBe("lane");
  });
});
