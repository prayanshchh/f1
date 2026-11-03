import season from "../../../../content/season/austin-2026.json";
import liveries from "../../../../content/cars/teams.json";

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
  stints: { compound: number; from: number }[];
}

export interface Team {
  index: number;
  car: string;
  name: string;
  colour: string;
}

export interface Entrant {
  code: string;
  name: string;
  car: string;
  team: string;
  teamIndex: number;
  seat: number;
  colour: string;
  player: boolean;
  speed: number;
  raceSpeed: number;
  power: number;
  realGrid: number;
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
const difficultyStep = 0.001;
const stageKey = "f1.weekend";
const liveryOrder = [
  "meridian",
  "vanta",
  "halden",
  "corvus",
  "sylvan",
  "azura",
  "strato",
  "novara",
  "orion",
  "krona",
  "ardent",
];
const towerLightness = 0.5;

function towerColour(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => ((value >> shift) & 255) / 255);
  const high = Math.max(...channels);
  const low = Math.min(...channels);
  const lightness = (high + low) / 2;
  if (lightness >= towerLightness || high === 0) return hex;
  const lift = towerLightness / lightness;
  const lifted = channels.map((c) =>
    Math.round(Math.min(1, c * lift) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${lifted.join("")}`;
}

function teamOf(index: number): Team {
  const livery =
    liveries.find((team) => team.id === liveryOrder[index]) ?? liveries[0];
  if (!livery) throw new Error("no teams defined");
  return {
    index,
    car: livery.id,
    name: livery.name,
    colour: towerColour(livery.colours.primary),
  };
}

export const raceLaps = season.raceLaps;
export const teams: Team[] = [
  ...new Set(drivers.map((driver) => driver.teamIndex)),
].map(teamOf);

export const segmentNames = season.qualifying.segments.map((s) => s.name);

export const lastSlot = drivers.length - 1;
const sprintLaps = 5;

export function raceLapOptions(): number[] {
  const options: number[] = [sprintLaps];
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
  const team = teamOf(driver.teamIndex);
  return {
    code: driver.code,
    name: driver.name,
    car: team.car,
    team: team.name,
    teamIndex: driver.teamIndex,
    seat: driver.seat,
    colour: team.colour,
    player: false,
    speed: 1 - (speedPerGap * driver.qualifyingGap) / percent,
    raceSpeed: 1 - (speedPerGap * driver.raceGap) / percent,
    power: 1 - (powerPerGap * gap) / percent,
    realGrid: driver.realGrid,
    stints: driver.stints,
  };
}

function playerEntrant(team: Team): Entrant {
  return {
    code: "YOU",
    name: "You",
    car: team.car,
    team: team.name,
    teamIndex: team.index,
    seat: 1,
    colour: team.colour,
    player: true,
    speed: 1,
    raceSpeed: 1,
    power: 1,
    realGrid: 0,
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
    .sort((a, b) => a.entrant.realGrid - b.entrant.realGrid);
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
  car: string,
  playerSlot: number,
  gridCodes: string[] | null,
): WeekendPlan {
  const team = teams.find((t) => t.car === car) ?? teams[0];
  if (!team) throw new Error("no teams defined");
  const entrants = [
    playerEntrant(team),
    ...seatPlayer(team.index).map(toEntrant),
  ];
  return { entrants, slots: gridSlots(entrants, gridCodes, playerSlot) };
}

export const playerRun = {
  queued: -1,
  waiting: 0,
  outLap: 1,
  flying: 2,
  done: 3,
} as const;

export function canStartLap(
  mine: { eliminated: boolean } | undefined,
  sessionRunning: boolean,
  run: number,
): boolean {
  return (
    mine !== undefined &&
    !mine.eliminated &&
    sessionRunning &&
    run === playerRun.waiting
  );
}

export interface WeekendState {
  stage: Stage;
  grid: string[] | null;
  buildUpPlayed?: boolean;
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
