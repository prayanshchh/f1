import type { PitPenalty } from "./pitstop.ts";

export const federation = {
  name: "International Motor Racing Federation",
  short: "IMRF",
} as const;

export const offence = {
  jumpStart: 0,
  gridPosition: 1,
  trackLimits: 2,
  leftTrackPosition: 3,
  leftTrackTime: 4,
  unsafeRejoin: 5,
  collision: 6,
  forcingOff: 7,
  blueFlags: 8,
  yellowSingle: 9,
  yellowDouble: 10,
  yellowOvertake: 11,
  impeding: 12,
  pitSpeeding: 13,
  directionChanges: 14,
  movingUnderBraking: 15,
  penaltyNotServed: 16,
  penaltyImproper: 17,
  vscDelta: 18,
  safetyCarDelta: 19,
  neutralisedOvertake: 20,
  safetyCarPass: 21,
  safetyCarGap: 22,
  restartOvertake: 23,
  redFlag: 24,
  unsafeRelease: 25,
} as const;

export const raceControlState = {
  green: 0,
  lights: 1,
  vsc: 2,
  vscEnding: 3,
  safetyCar: 4,
  safetyCarIn: 5,
  restart: 6,
  red: 7,
  suspended: 8,
} as const;

const controlEvent = {
  vsc: 0,
  vscEnding: 1,
  safetyCar: 2,
  safetyCarIn: 3,
  green: 4,
  red: 5,
  suspended: 6,
  resume: 7,
  rolling: 8,
  lineup: 9,
} as const;

export const stage = {
  noted: 0,
  decision: 1,
  noAction: 2,
  warning: 3,
  instruction: 4,
  served: 5,
  returned: 6,
  flag: 7,
  clear: 8,
  control: 9,
} as const;

export const penalty = {
  none: 0,
  warning: 1,
  blackWhite: 2,
  reprimand: 3,
  time5: 4,
  time10: 5,
  driveThrough: 6,
  stopGo: 7,
  timeAdded: 8,
  grid: 9,
  disqualified: 10,
  lapDeleted: 11,
} as const;

export interface StewardMessage {
  id: number;
  time: number;
  lap: number;
  car: number;
  other: number;
  offence: number;
  stage: number;
  penalty: number;
  value: number;
  distance: number;
  count: number;
  points: number;
}

type PendingPenalty = "none" | "drive-through" | "stop-go";

export interface StewardCar {
  strikes: number;
  owedTime: number;
  pending: PendingPenalty;
  crossingsLeft: number;
  points: number;
  reprimands: number;
  disqualified: boolean;
  lapInvalid: boolean;
  lastLapInvalid: boolean;
  timeAdded: number;
  blue: boolean;
  flag: number;
  gridDrop: number;
  drivingReprimands: number;
  offTracks: number;
  giveBackTo: number | null;
}

export interface Turn {
  number: number;
  distance: number;
}

type NoticeKind =
  "investigation" | "penalty" | "warning" | "flag" | "info" | "cleared";

export interface Notice {
  kind: NoticeKind;
  title: string;
  detail: string;
  seconds: number;
}

export const messageFields = 12;
export const carFields = 16;
const strikesBeforeFlag = 3;

const turnReach = 260;

const offenceNames: Record<number, string> = {
  [offence.jumpStart]: "Jump start",
  [offence.gridPosition]: "Incorrect starting position",
  [offence.trackLimits]: "Track limits",
  [offence.leftTrackPosition]: "Leaving the track and gaining an advantage",
  [offence.leftTrackTime]: "Leaving the track and gaining an advantage",
  [offence.unsafeRejoin]: "Rejoining the track unsafely",
  [offence.collision]: "Causing a collision",
  [offence.forcingOff]: "Forcing another driver off the track",
  [offence.blueFlags]: "Ignoring blue flags",
  [offence.yellowSingle]: "Failing to slow for yellow flags",
  [offence.yellowDouble]: "Failing to slow for double yellow flags",
  [offence.yellowOvertake]: "Overtaking under yellow flags",
  [offence.impeding]: "Impeding another driver",
  [offence.pitSpeeding]: "Speeding in the pit lane",
  [offence.directionChanges]: "More than one change of direction",
  [offence.movingUnderBraking]: "Moving under braking",
  [offence.penaltyNotServed]: "Penalty not served",
  [offence.penaltyImproper]: "Penalty not served correctly",
  [offence.vscDelta]: "Exceeding the VSC delta time",
  [offence.safetyCarDelta]: "Exceeding the safety car delta time",
  [offence.neutralisedOvertake]: "Overtaking under the safety car",
  [offence.safetyCarPass]: "Overtaking the safety car",
  [offence.safetyCarGap]: "Not within ten car lengths behind the safety car",
  [offence.restartOvertake]: "Overtaking before the line at the restart",
  [offence.redFlag]: "Failing to slow for the red flag",
  [offence.unsafeRelease]: "Unsafe release",
};

function offenceName(code: number): string {
  return offenceNames[code] ?? "Driving infringement";
}

const penaltyNames: Record<number, string> = {
  [penalty.time5]: "5 second time penalty",
  [penalty.time10]: "10 second time penalty",
  [penalty.driveThrough]: "Drive-through penalty",
  [penalty.stopGo]: "10 second stop-and-go penalty",
  [penalty.reprimand]: "Reprimand",
  [penalty.blackWhite]: "Black and white flag",
  [penalty.disqualified]: "Disqualified",
  [penalty.lapDeleted]: "Lap time deleted",
  [penalty.warning]: "Warning",
};

function penaltyName(code: number, value: number): string {
  const amount = String(Math.round(value));
  if (code === penalty.timeAdded) return `${amount} seconds added to race time`;
  if (code === penalty.grid) return `${amount} place grid penalty`;
  return penaltyNames[code] ?? "";
}

export function turnAt(distance: number, turns: Turn[]): string {
  let best: Turn | null = null;
  let gap = Infinity;
  for (const turn of turns) {
    const d = Math.abs(turn.distance - distance);
    if (d < gap) {
      gap = d;
      best = turn;
    }
  }
  return best && gap <= turnReach ? `Turn ${String(best.number)}` : "";
}

function trackLimitsCount(strikes: number): string {
  return `Warning ${String(Math.min(strikes, strikesBeforeFlag))} of ${String(strikesBeforeFlag)}`;
}

function place(message: StewardMessage, turns: Turn[]): string {
  const onGrid =
    message.offence === offence.jumpStart ||
    message.offence === offence.gridPosition;
  return onGrid ? "" : turnAt(message.distance, turns);
}

function joined(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" - ");
}

function trackLimitsNotice(
  message: StewardMessage,
  turns: Turn[],
  racing: boolean,
): Notice | null {
  const where = place(message, turns);
  if (message.penalty === penalty.lapDeleted)
    return racing
      ? null
      : {
          kind: "warning",
          title: "Lap invalidated",
          detail: joined("Track limits", where),
          seconds: 4,
        };
  if (message.penalty === penalty.blackWhite)
    return {
      kind: "warning",
      title: "Black and white flag",
      detail: joined("Track limits", where, "Next one is a penalty"),
      seconds: 6,
    };
  return {
    kind: "warning",
    title: "Track limits",
    detail: joined(
      `Lap ${String(message.lap)} time deleted`,
      where,
      trackLimitsCount(message.count),
    ),
    seconds: 5,
  };
}

function cause(message: StewardMessage, name: (car: number) => string) {
  const subject = offenceName(message.offence);
  if (message.other < 0) return subject;
  if (message.offence === offence.collision)
    return `${subject} with ${name(message.other)}`;
  if (message.offence === offence.forcingOff)
    return `Forcing ${name(message.other)} off the track`;
  if (message.offence === offence.impeding)
    return `Impeding ${name(message.other)}`;
  return subject;
}

type PlayerNotice = (
  message: StewardMessage,
  name: (car: number) => string,
  where: string,
) => Notice;

const playerNotices: Record<number, PlayerNotice> = {
  [stage.noted]: (message, name, where) => ({
    kind: "investigation",
    title: "Under investigation",
    detail: joined(cause(message, name), where),
    seconds: 5,
  }),
  [stage.decision]: (message, name, where) => ({
    kind: "penalty",
    title: penaltyName(message.penalty, message.value),
    detail:
      message.offence === offence.penaltyNotServed &&
      message.penalty === penalty.timeAdded
        ? "Unserved time penalty"
        : joined(cause(message, name), where),
    seconds: 7,
  }),
  [stage.noAction]: (message, name, where) => ({
    kind: "info",
    title: "No further action",
    detail: joined(cause(message, name), where),
    seconds: 4,
  }),
  [stage.instruction]: (message, name) => ({
    kind: "warning",
    title: "Give the position back",
    detail: `Let ${name(message.other)} past within ${String(Math.round(message.value))} seconds`,
    seconds: 6,
  }),
  [stage.returned]: (message, name) => ({
    kind: "info",
    title: "Position returned",
    detail: `No further action - ${name(message.other)}`,
    seconds: 4,
  }),
  [stage.served]: (message) => ({
    kind: "info",
    title: "Penalty served",
    detail: penaltyName(message.penalty, message.value),
    seconds: 4,
  }),
  [stage.warning]: (message, _name, where) => ({
    kind: "warning",
    title: penaltyName(message.penalty, message.value) || "Warning",
    detail: joined(offenceName(message.offence), where),
    seconds: 5,
  }),
};

function aboutPlayer(
  message: StewardMessage,
  name: (car: number) => string,
  turns: Turn[],
  racing: boolean,
): Notice | null {
  if (
    message.stage === stage.warning &&
    message.offence === offence.trackLimits
  )
    return trackLimitsNotice(message, turns, racing);
  const build = playerNotices[message.stage];
  return build ? build(message, name, place(message, turns)) : null;
}

function aboutVictim(
  message: StewardMessage,
  name: (car: number) => string,
): Notice | null {
  if (message.stage !== stage.decision) return null;
  return {
    kind: "info",
    title: `${name(message.car)} penalised`,
    detail: `${penaltyName(message.penalty, message.value)} - ${offenceName(message.offence)}`,
    seconds: 5,
  };
}

const controlNotices: Record<number, (value: number) => Notice> = {
  [controlEvent.vsc]: () => ({
    kind: "flag",
    title: "Virtual safety car",
    detail: "Keep your delta positive - no overtaking",
    seconds: 6,
  }),
  [controlEvent.vscEnding]: () => ({
    kind: "flag",
    title: "VSC ending",
    detail: "Green flag in a few seconds",
    seconds: 5,
  }),
  [controlEvent.safetyCar]: () => ({
    kind: "flag",
    title: "Safety car deployed",
    detail: "Slow down and close up behind - no overtaking",
    seconds: 6,
  }),
  [controlEvent.safetyCarIn]: () => ({
    kind: "flag",
    title: "Safety car in this lap",
    detail: "No overtaking until the control line",
    seconds: 6,
  }),
  [controlEvent.green]: () => ({
    kind: "info",
    title: "Green flag",
    detail: "Track clear - racing resumes",
    seconds: 4,
  }),
  [controlEvent.red]: () => ({
    kind: "penalty",
    title: "Red flag",
    detail: "Session suspended - slow down, no overtaking",
    seconds: 7,
  }),
  [controlEvent.suspended]: (value) => ({
    kind: "warning",
    title: "Race suspended",
    detail: `Cars lined up on the grid - restart in ${String(Math.round(value))} seconds`,
    seconds: 6,
  }),
  [controlEvent.resume]: () => ({
    kind: "flag",
    title: "Race resumes",
    detail: "Standing restart from the grid",
    seconds: 5,
  }),
  [controlEvent.rolling]: () => ({
    kind: "flag",
    title: "Rolling start",
    detail: "Follow the safety car - racing starts at the control line",
    seconds: 6,
  }),
  [controlEvent.lineup]: () => ({
    kind: "info",
    title: "Lined up on the grid",
    detail: "Lights out and away we go",
    seconds: 4,
  }),
};

export function noticeFor(
  message: StewardMessage,
  name: (car: number) => string,
  turns: Turn[],
  racing: boolean,
): Notice | null {
  if (message.stage === stage.control)
    return controlNotices[message.offence]?.(message.value) ?? null;
  if (message.stage === stage.flag || message.stage === stage.clear)
    return null;
  if (message.car === 0) return aboutPlayer(message, name, turns, racing);
  if (message.other === 0) return aboutVictim(message, name);
  return null;
}

export function penaltyBadge(car: StewardCar): string {
  if (car.disqualified) return "DSQ";
  if (car.pending === "drive-through") return "DT";
  if (car.pending === "stop-go") return "SG";
  const time = car.owedTime + car.timeAdded;
  return time > 0 ? `+${String(Math.round(time))}s` : "";
}

export function pitPenaltyFor(car: StewardCar): PitPenalty {
  if (car.pending !== "none") return { kind: car.pending, seconds: 0 };
  return car.owedTime > 0
    ? { kind: "time", seconds: car.owedTime }
    : { kind: "none", seconds: 0 };
}

export function pitInstruction(car: StewardCar): string {
  if (car.pending === "drive-through")
    return `Drive-through - box within ${String(car.crossingsLeft + 1)} laps`;
  if (car.pending === "stop-go")
    return `Stop-and-go - box within ${String(car.crossingsLeft + 1)} laps`;
  if (car.owedTime > 0)
    return `+${String(Math.round(car.owedTime))}s served at your next stop`;
  return "";
}

export function parseMessages(values: Float64Array): StewardMessage[] {
  const count = Math.floor(values.length / messageFields);
  return Array.from({ length: count }, (_, i) => {
    const at = (k: number) => values[i * messageFields + k] ?? 0;
    return {
      id: at(0),
      time: at(1),
      lap: at(2),
      car: at(3),
      other: at(4),
      offence: at(5),
      stage: at(6),
      penalty: at(7),
      value: at(8),
      distance: at(9),
      count: at(10),
      points: at(11),
    };
  });
}

export function parseCar(values: ArrayLike<number>): StewardCar {
  const at = (k: number) => values[k] ?? 0;
  const pending = at(2);
  return {
    strikes: at(0),
    owedTime: at(1),
    pending:
      pending === 1 ? "drive-through" : pending === 2 ? "stop-go" : "none",
    crossingsLeft: at(3),
    points: at(4),
    reprimands: at(5),
    disqualified: at(6) !== 0,
    lapInvalid: at(7) !== 0,
    lastLapInvalid: at(8) !== 0,
    timeAdded: at(9),
    blue: at(10) !== 0,
    flag: at(11),
    gridDrop: at(12),
    drivingReprimands: at(13),
    offTracks: at(14),
    giveBackTo: at(15) > 0 ? at(15) - 1 : null,
  };
}
