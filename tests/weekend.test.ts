import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import season from "../content/season/austin-2026.json";
import {
  canStartLap,
  lastSlot,
  planWeekend,
  playerRun,
  raceLapOptions,
  raceLaps,
  teams,
} from "../apps/client/src/game/weekend.ts";
import { PitStop, type PitLayout } from "../apps/client/src/game/pitstop.ts";
import {
  loadSettings,
  saveSettings,
  stageOf,
  type Settings,
} from "../apps/client/src/game/settings.ts";
import { fieldGrid, teamOf } from "../apps/client/src/game/teams.ts";

const session = (
  value: Settings["session"],
  qualifying: Settings["qualifying"] = "run",
) => ({ session: value, qualifying }) as unknown as Settings;

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

  test("the build-up grid shows each qualifier in their slot with their own team", () => {
    const first = planWeekend("corvus", 5, null);
    const order = first.entrants.map((e) => e.code).reverse();
    const { entrants, slots } = planWeekend("corvus", 5, order);
    const seat = {
      team: "corvus",
      first: "Ada",
      last: "Racer",
      number: 9,
      nationality: "GB",
    };
    const grid = fieldGrid(seat, entrants, slots);
    expect(grid.map((entry) => entry.position)).toEqual(
      entrants.map((_, i) => i + 1),
    );
    grid.forEach((entry, place) => {
      const entrant = entrants[slots.indexOf(place)];
      if (!entrant) throw new Error(`no entrant in slot ${String(place)}`);
      expect(entry.team.id).toBe(entrant.car);
      expect(entry.player).toBe(entrant.player);
      expect(entry.last).toBe(
        entrant.player
          ? "Racer"
          : teamOf(entrant.car).drivers[entrant.seat]?.last,
      );
    });
  });

  test("a stale grid falls back to the starting order", () => {
    const { slots } = planWeekend("corvus", 5, ["YOU", "NOT"]);
    expect(slots[0]).toBe(5);
    expect(new Set(slots).size).toBe(22);
  });

  test("without qualifying the field lines up as the real 2026 Austin grid", () => {
    const realOrder = [...season.grid]
      .sort((a, b) => a.realGrid - b.realGrid)
      .map((driver) => driver.code);
    for (const team of teams)
      for (const start of [0, 7, lastSlot]) {
        const { entrants, slots } = planWeekend(team.car, start, null);
        const grid: string[] = [];
        entrants.forEach((entrant, i) => {
          grid[slots[i] ?? -1] = entrant.code;
        });
        expect(grid[start]).toBe("YOU");
        const rivals = grid.filter((code) => code !== "YOU");
        expect(rivals).toEqual(
          realOrder.filter((code) => rivals.includes(code)),
        );
        expect(rivals).toHaveLength(21);
      }
  });
});

describe("race distance", () => {
  test("a five lap sprint, then tens up to the real distance", () => {
    const options = raceLapOptions();
    expect(options[0]).toBe(5);
    expect(options[1]).toBe(10);
    expect(options.at(-1)).toBe(raceLaps);
    options.slice(2, -1).forEach((laps, i) => {
      expect(laps - (options[i + 1] ?? 0)).toBe(10);
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

  test("skipping qualifying goes straight to the race", () => {
    expect(stageOf(session("weekend", "skip"), null)).toBe("race");
    expect(stageOf(session("qualifying", "skip"), null)).toBe("qualifying");
  });
});

describe("starting a session", () => {
  const storage = new Map<string, string>();
  const load = () => loadSettings(new URLSearchParams());

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a new player goes straight to the race and qualifying is a choice", () => {
    const settings = load();
    expect(stageOf(settings, null)).toBe("race");
    saveSettings({ ...settings, qualifying: "run" });
    expect(stageOf(load(), null)).toBe("qualifying");
  });

  test("settings saved while qualifying was the default move to the race once, keeping the rest", () => {
    storage.set(
      "f1.settings",
      JSON.stringify({ session: "weekend", qualifying: "run", laps: 10 }),
    );
    const moved = load();
    expect(stageOf(moved, null)).toBe("race");
    expect(moved.laps).toBe(10);
    saveSettings({ ...moved, qualifying: "run" });
    expect(stageOf(load(), null)).toBe("qualifying");
  });
});

describe("starting a qualifying lap", () => {
  const out = { eliminated: true };
  const alive = { eliminated: false };

  test("only a driver still in the session with no lap yet can go out", () => {
    expect(canStartLap(alive, true, playerRun.waiting)).toBe(true);
    expect(canStartLap(out, true, playerRun.waiting)).toBe(false);
    expect(canStartLap(alive, true, playerRun.queued)).toBe(false);
    expect(canStartLap(alive, true, playerRun.outLap)).toBe(false);
    expect(canStartLap(alive, true, playerRun.done)).toBe(false);
    expect(canStartLap(alive, false, playerRun.waiting)).toBe(false);
    expect(canStartLap(undefined, true, playerRun.waiting)).toBe(false);
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
    expect(clear.choosingTyres).toBe(false);
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
    expect(handed.choosingTyres).toBe(false);
  });

  test("the tyre choice shows on the way in to a stop, not after it", () => {
    const pit = new PitStop(layout, true);
    const lane = { toMiddle: 12.5, speed: 20 };
    expect(
      pit.update({ ...lane, distance: 5400 }, 0, false).choosingTyres,
    ).toBe(true);
    expect(pit.update({ ...lane, distance: 70 }, 1, false).choosingTyres).toBe(
      true,
    );
    pit.update(inBox, 2, false);
    expect(pit.update(inBox, 5, false).choosingTyres).toBe(false);
    expect(pit.update({ ...lane, distance: 170 }, 7, false).choosingTyres).toBe(
      false,
    );
  });
});
