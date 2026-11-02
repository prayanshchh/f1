export type StageId =
  | "black"
  | "title"
  | "weather"
  | "map-sectors"
  | "map-zones"
  | "map-turns"
  | "hill"
  | "flag"
  | "grid"
  | "walk"
  | "wipe";

export interface Stage {
  id: StageId;
  index: number;
  start: number;
  end: number;
}

export interface StagePosition {
  stage: Stage;
  time: number;
  progress: number;
}

export const gridPairSeconds = 3.2;
const walkShotSeconds = 6.5;
export const walkShots = 3;
const wipeSeconds = 1;

const seconds = {
  black: 0.8,
  title: 11,
  weather: 9,
  mapSectors: 5.5,
  mapZones: 5,
  mapTurns: 6.5,
  hill: 6,
  flag: 3.5,
};

export function buildUpStages(
  kind: "practice" | "race",
  gridPairs: number,
): Stage[] {
  const plan: [StageId, number][] = [
    ["black", seconds.black],
    ["title", seconds.title],
    ["weather", seconds.weather],
    ["map-sectors", seconds.mapSectors],
    ["map-zones", seconds.mapZones],
    ["map-turns", seconds.mapTurns],
    ...(kind === "race"
      ? ([
          ["hill", seconds.hill],
          ["flag", seconds.flag],
          ...Array.from({ length: gridPairs }, (): [StageId, number] => [
            "grid",
            gridPairSeconds,
          ]),
          ...Array.from({ length: walkShots }, (): [StageId, number] => [
            "walk",
            walkShotSeconds,
          ]),
        ] as [StageId, number][])
      : []),
    ["wipe", wipeSeconds],
  ];
  const counts = new Map<StageId, number>();
  let clock = 0;
  return plan.map(([id, length]) => {
    const index = counts.get(id) ?? 0;
    counts.set(id, index + 1);
    const stage = { id, index, start: clock, end: clock + length };
    clock += length;
    return stage;
  });
}

export function stageAt(stages: Stage[], time: number): StagePosition | null {
  const stage = stages.find((s) => time >= s.start && time < s.end);
  if (!stage) return null;
  return {
    stage,
    time: time - stage.start,
    progress: (time - stage.start) / (stage.end - stage.start),
  };
}

export function skipTarget(stages: Stage[], time: number): number {
  const wipe = stages.at(-1);
  return wipe ? Math.max(time, wipe.start) : time;
}
