import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ordinal } from "../../apps/client/src/game/buildup-ordinal.ts";
import {
  poseAt,
  shots,
  type TrackPoint,
  walkShot,
} from "../../apps/client/src/game/buildup-shots.ts";
import {
  buildUpStages,
  gridPairSeconds,
  skipTarget,
  stageAt,
  walkShots,
} from "../../apps/client/src/game/buildup-timeline.ts";
import { repoRoot } from "../support/repo.ts";

interface CircuitMapData {
  track: { length: number; points: number[] };
  turns: { number: number; distance: number; side: string }[];
  sectors: number[];
  straights: [number, number][];
  speedTrap: number;
  roads: number[][];
  lanes: number[][];
  aisles: number[][];
  buildings: { height: number; footprint: number[] }[];
}

const map = JSON.parse(
  readFileSync(
    path.join(repoRoot, "content/tracks/hill-country/circuit-map.json"),
    "utf8",
  ),
) as CircuitMapData;
const track = JSON.parse(
  readFileSync(
    path.join(repoRoot, "content/tracks/hill-country/track.json"),
    "utf8",
  ),
) as { length: number; sectors: number[] };

describe("build-up timeline", () => {
  const gridPairs = 11;

  test("the stages cover the whole sequence with no gaps", () => {
    const stages = buildUpStages("race", gridPairs);
    stages.slice(1).forEach((stage, index) => {
      expect(stage.start).toBeCloseTo(stages[index]?.end ?? -1, 6);
    });
    for (let t = 0; t < (stages.at(-1)?.end ?? 0); t += 0.25)
      expect(stageAt(stages, t), `no stage at ${String(t)}s`).not.toBeNull();
  });

  test("a race follows the reference build-up order", () => {
    const order = buildUpStages("race", gridPairs).map((stage) => stage.id);
    expect([...new Set(order)]).toEqual([
      "black",
      "title",
      "weather",
      "map-sectors",
      "map-zones",
      "map-turns",
      "hill",
      "flag",
      "grid",
      "walk",
      "wipe",
    ]);
  });

  test("every grid pair gets a card and every card is numbered in order", () => {
    const stages = buildUpStages("race", gridPairs);
    const cards = stages.filter((stage) => stage.id === "grid");
    expect(cards.map((stage) => stage.index)).toEqual(
      Array.from({ length: gridPairs }, (_, i) => i),
    );
    expect((cards[0]?.end ?? 0) - (cards[0]?.start ?? 0)).toBeCloseTo(
      gridPairSeconds,
      6,
    );
    expect(stages.filter((stage) => stage.id === "walk")).toHaveLength(
      walkShots,
    );
  });

  test("practice has no starting grid because nobody lines up", () => {
    const ids = buildUpStages("practice", gridPairs).map((stage) => stage.id);
    expect(ids).not.toContain("grid");
    expect(ids).not.toContain("flag");
    expect(ids).not.toContain("walk");
    expect(ids).toContain("map-turns");
    expect(ids.at(-1)).toBe("wipe");
  });

  test("the sequence ends after the wipe so the race can start", () => {
    const stages = buildUpStages("race", gridPairs);
    const end = stages.at(-1)?.end ?? 0;
    expect(stageAt(stages, end)).toBeNull();
    expect(stageAt(stages, end + 100)).toBeNull();
  });

  test("skipping jumps to the wipe and never rewinds", () => {
    const stages = buildUpStages("race", gridPairs);
    const wipe = stages.at(-1);
    expect(skipTarget(stages, 5)).toBe(wipe?.start);
    const late = (wipe?.start ?? 0) + 0.5;
    expect(skipTarget(stages, late)).toBe(late);
    expect(stageAt(stages, skipTarget(stages, 5))?.stage.id).toBe("wipe");
  });

  test("position suffixes read correctly", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      "ST",
      "ND",
      "RD",
      "TH",
      "TH",
      "TH",
      "TH",
      "ST",
      "ND",
    ]);
  });
});

describe("camera shots", () => {
  const flatTrack: TrackPoint = (distance, lateral) => [distance, lateral, 5];

  test("poses stay put at the ends and clamp out-of-range progress", () => {
    expect(poseAt(shots.title, -1, flatTrack)).toEqual(
      poseAt(shots.title, 0, flatTrack),
    );
    expect(poseAt(shots.title, 2, flatTrack)).toEqual(
      poseAt(shots.title, 1, flatTrack),
    );
  });

  test("a shot starts and ends without a jolt", () => {
    const at = (t: number) => poseAt(shots.weather, t, flatTrack).eye[0];
    const start = Math.abs(at(0.01) - at(0));
    const middle = Math.abs(at(0.51) - at(0.5));
    expect(start).toBeLessThan(middle / 5);
  });

  test("height is above the track, not above sea level", () => {
    const pose = poseAt(shots.hill, 0, flatTrack);
    expect(pose.eye[2]).toBeCloseTo(5 + shots.hill.eyeFrom.height, 5);
  });

  test.each([
    [-3.5, 1],
    [3.5, 1],
    [-3.5, 0],
  ])(
    "grid shots keep clear of the player's car from lateral %s, slot %s",
    (lateral, slot) => {
      for (let index = 0; index < walkShots; index++) {
        const shot = walkShot(index, 5453, lateral, slot);
        for (const point of [shot.eyeFrom, shot.eyeTo]) {
          const ahead = Math.abs(point.distance - 5453);
          const across = Math.abs(point.lateral - lateral);
          const clear = ahead > 2.6 || across > 1.2 || point.height > 1.4;
          expect(clear, `shot ${String(index)}`).toBe(true);
        }
      }
    },
  );

  test("the neighbour shot looks at the car ahead when the player is not on pole", () => {
    const ahead = walkShot(1, 5453, -3.5, 1);
    expect(ahead.lookFrom.distance).toBeGreaterThan(5453);
    const behind = walkShot(1, 5453, -3.5, 0);
    expect(behind.lookFrom.distance).toBeLessThan(5453);
  });
});

describe("circuit map content", () => {
  test("has exactly the 20 Hill Country turns in lap order", () => {
    expect(map.turns.map((turn) => turn.number)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const distances = map.turns.map((turn) => turn.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[0]).toBeGreaterThan(0);
    expect(distances.at(-1)).toBeLessThan(track.length);
  });

  test("turns have the real corner directions", () => {
    const lefts = [1, 3, 5, 8, 10, 11, 12, 15, 19, 20];
    for (const turn of map.turns)
      expect(turn.side, `turn ${String(turn.number)}`).toBe(
        lefts.includes(turn.number) ? "left" : "right",
      );
  });

  test("the map is generated from the current track", () => {
    expect(map.track.length).toBe(track.length);
    expect(map.sectors).toEqual(track.sectors);
    expect(map.track.points.length % 3).toBe(0);
  });

  test("straights and the speed trap sit on the long straights", () => {
    const turn = (n: number) =>
      map.turns.find((t) => t.number === n)?.distance ?? 0;
    const [back, main] = map.straights;
    expect(back?.[0]).toBeGreaterThan(turn(11));
    expect(back?.[1]).toBeLessThan(turn(12));
    expect(main?.[0]).toBeGreaterThan(turn(20));
    expect(main?.[1]).toBeLessThan(turn(1));
    expect(map.speedTrap).toBeGreaterThan(back?.[0] ?? 0);
    expect(map.speedTrap).toBeLessThan(back?.[1] ?? 0);
  });

  test("streets and buildings are present and well formed", () => {
    expect(map.roads.length).toBeGreaterThan(5);
    expect(map.lanes.length).toBeGreaterThan(50);
    expect(map.aisles.length).toBeGreaterThan(50);
    expect(map.buildings.length).toBeGreaterThan(50);
    for (const line of [...map.roads, ...map.lanes, ...map.aisles]) {
      expect(line.length % 2).toBe(0);
      expect(line.length).toBeGreaterThanOrEqual(4);
    }
    for (const building of map.buildings) {
      expect(building.height).toBeGreaterThan(0);
      expect(building.footprint.length).toBeGreaterThanOrEqual(6);
    }
  });
});
