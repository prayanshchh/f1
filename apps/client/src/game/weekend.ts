import season from "../../../../content/season/austin-2026.json";

interface SeasonDriver {
  number: number;
  code: string;
  name: string;
  team: string;
  teamIndex: number;
  seat: number;
  colour: string;
  qualifyingGap: number;
  raceGap: number;
  realGrid: number;
  runs: number[][];
  stints: { compound: number; from: number }[];
}

export interface Team {
  index: number;
  name: string;
  colour: string;
}

export interface Entrant {
  code: string;
  name: string;
  team: string;
  teamIndex: number;
  seat: number;
  colour: string;
  player: boolean;
  speed: number;
  raceSpeed: number;
  power: number;
  runs: number[][];
  stints: { compound: number; from: number }[];
}

export type Stage = "qualifying" | "race";

export interface WeekendPlan {
  entrants: Entrant[];
  slots: number[];
}

const drivers = season.grid as SeasonDriver[];
const speedPerGap = 1.2;
const powerPerGap = 2.4;
const percent = 100;
const difficultyMax = 110;
const difficultyStep = 0.003;
const fallbackRuns = [
  [120, 880],
  [120, 690],
  [70, 600],
];
const stageKey = "f1.weekend";

export const raceLaps = season.raceLaps;
export const teams: Team[] = drivers.reduce<Team[]>((list, driver) => {
  if (!list.some((team) => team.index === driver.teamIndex))
    list.push({
      index: driver.teamIndex,
      name: driver.team,
      colour: driver.colour,
    });
  return list;
}, []);

export const segmentNames = season.qualifying.segments.map((s) => s.name);

export function raceLapOptions(): number[] {
  const options: number[] = [];
  for (let laps = 10; laps < raceLaps; laps += 10) options.push(laps);
  options.push(raceLaps);
  return options;
}

export function difficultyScale(difficulty: number): number {
  return 1 - (difficultyMax - difficulty) * difficultyStep;
}

function seatPlayer(teamIndex: number): SeasonDriver[] {
  const replaced = drivers.find(
    (driver) => driver.teamIndex === teamIndex && driver.seat === 1,
  );
  return drivers.filter((driver) => driver !== replaced);
}

function toEntrant(driver: SeasonDriver): Entrant {
  const gap = (driver.qualifyingGap + driver.raceGap) / 2;
  return {
    code: driver.code,
    name: driver.name,
    team: driver.team,
    teamIndex: driver.teamIndex,
    seat: driver.seat,
    colour: driver.colour,
    player: false,
    speed: 1 - (speedPerGap * driver.qualifyingGap) / percent,
    raceSpeed: 1 - (speedPerGap * driver.raceGap) / percent,
    power: 1 - (powerPerGap * gap) / percent,
    runs: driver.runs.map((runs, i) =>
      runs.length > 0 ? runs : (fallbackRuns[i] ?? []),
    ),
    stints: driver.stints,
  };
}

function playerEntrant(teamIndex: number): Entrant {
  const team = teams.find((t) => t.index === teamIndex) ?? teams[0];
  return {
    code: "YOU",
    name: "You",
    team: team?.name ?? "",
    teamIndex,
    seat: 1,
    colour: team?.colour ?? "#ffffff",
    player: true,
    speed: 1,
    raceSpeed: 1,
    power: 1,
    runs: [[], [], []],
    stints: [],
  };
}

function gridSlots(
  entrants: Entrant[],
  gridCodes: string[] | null,
  playerSlot: number,
): number[] {
  if (gridCodes) {
    const slots = entrants.map((entrant) => gridCodes.indexOf(entrant.code));
    if (slots.every((slot) => slot >= 0)) return slots;
  }
  const ranked = entrants
    .map((entrant, index) => ({ entrant, index }))
    .filter(({ entrant }) => !entrant.player)
    .sort((a, b) => b.entrant.speed - a.entrant.speed);
  const slots = new Array<number>(entrants.length).fill(0);
  const player = Math.max(0, Math.min(entrants.length - 1, playerSlot));
  let next = 0;
  for (const { index } of ranked) {
    if (next === player) next++;
    slots[index] = next++;
  }
  slots[0] = player;
  return slots;
}

export function planWeekend(
  teamIndex: number,
  playerSlot: number,
  gridCodes: string[] | null,
): WeekendPlan {
  const entrants = [
    playerEntrant(teamIndex),
    ...seatPlayer(teamIndex).map(toEntrant),
  ];
  return { entrants, slots: gridSlots(entrants, gridCodes, playerSlot) };
}

export interface WeekendState {
  stage: Stage;
  grid: string[] | null;
}

export function loadWeekend(): WeekendState | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(stageKey) ?? "null",
    ) as WeekendState | null;
  } catch {
    return null;
  }
}

export function saveWeekend(state: WeekendState | null): void {
  if (state) sessionStorage.setItem(stageKey, JSON.stringify(state));
  else sessionStorage.removeItem(stageKey);
}

export function clockText(seconds: number): string {
  const whole = Math.ceil(Math.max(0, seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes)}:${String(whole % 60).padStart(2, "0")}`;
}
