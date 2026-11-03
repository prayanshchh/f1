import {
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import { type SpeedDreams, startCota } from "./speed-dreams.ts";

const timingStride = 20;
const carStride = 49;
const sessionFields = 12;
const statFields = 6;
const stepsPerCall = 20;
const secondsPerCall = stepsPerCall / 500;

export const sessionKind = { race: 1, qualifying: 2 } as const;
export const sessionPhase = { running: 0, complete: 2 } as const;
export const carStatus = {
  outLap: 1,
  flyingLap: 2,
  garage: 5,
  knockedOut: 8,
  queued: 9,
} as const;

export interface Weekend extends SpeedDreams {
  _free: (pointer: number) => void;
  _sdTyresConfigure: (compound: number, scale: number) => void;
  _sdEnergyConfigure: (
    race: number,
    mode: number,
    mix: number,
    assist: number,
  ) => void;
  _sdFieldClear: () => void;
  _sdFieldPlayer: (teamIndex: number, seat: number, slot: number) => void;
  _sdFieldPlan: (
    index: number,
    speed: number,
    raceSpeed: number,
    power: number,
  ) => void;
  _sdFieldStint: (index: number, compound: number, from: number) => void;
  _sdFieldAutopilot: (on: number) => void;
  _sdSessionConfigure: (
    kind: number,
    laps: number,
    difficulty: number,
    seed: number,
  ) => void;
  _sdSessionInfo: (out: number) => void;
  _sdSessionStats: (out: number) => void;
  _sdSessionAdvance: () => number;
  _sdSessionSimulate: () => void;
  _sdSessionPlayerRun: () => number;
  _sdSessionGrid: (out: number) => number;
  _sdQualifyingTimes: (index: number, out: number) => void;
  _sdTiming: (out: number) => void;
  _sdCars: (out: number) => void;
}

export interface FieldOptions {
  kind: number;
  laps: number;
  seed: number;
  wear?: number;
  plan?: WeekendPlan;
  autopilot?: boolean;
}

export async function startField(options: FieldOptions): Promise<Weekend> {
  const plan = options.plan ?? planWeekend("corvus", 10, null);
  return startCota<Weekend>((m) => {
    m._sdTyresConfigure(1, options.wear ?? 1);
    m._sdEnergyConfigure(options.kind === sessionKind.race ? 1 : 0, 1, 1, 1);
    const add = m.cwrap("sdFieldAdd", "null", [
      "string",
      "string",
      "string",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]);
    m._sdFieldClear();
    plan.entrants.forEach((entrant, index) => {
      const slot = plan.slots[index] ?? index;
      if (entrant.player)
        m._sdFieldPlayer(entrant.teamIndex, entrant.seat, slot);
      else
        add(
          entrant.name,
          entrant.code,
          entrant.team,
          entrant.teamIndex,
          entrant.seat,
          slot,
          entrant.speed,
          entrant.raceSpeed,
          1,
        );
      m._sdFieldPlan(index, entrant.speed, entrant.raceSpeed, entrant.power);
      for (const stint of entrant.stints)
        m._sdFieldStint(index, stint.compound, stint.from);
    });
    m._sdSessionConfigure(options.kind, options.laps, 1, options.seed);
    if (options.autopilot ?? true) m._sdFieldAutopilot(1);
  });
}

function read(
  m: Weekend,
  size: number,
  fill: (pointer: number) => void,
): Float64Array {
  const pointer = m._malloc(size * 8);
  fill(pointer);
  const values = new Float64Array(m.HEAPF64.buffer, pointer, size).slice();
  m._free(pointer);
  return values;
}

export function sessionOf(m: Weekend) {
  const v = read(m, sessionFields, (p) => {
    m._sdSessionInfo(p);
  });
  return {
    phase: v[1] ?? 0,
    segment: v[2] ?? 0,
    toRun: v[3] ?? 0,
    playerRun: v[10] ?? 0,
    onTrack: v[11] ?? -1,
  };
}

export function phaseOf(m: Weekend): number {
  return sessionOf(m).phase;
}

export function statsOf(m: Weekend) {
  const v = read(m, statFields, (p) => {
    m._sdSessionStats(p);
  });
  return {
    contacts: v[0] ?? 0,
    walls: v[2] ?? 0,
    overtakes: v[3] ?? 0,
    pits: v[5] ?? 0,
  };
}

export function timingOf(m: Weekend, cars: number) {
  const v = read(m, cars * timingStride, (p) => {
    m._sdTiming(p);
  });
  return Array.from({ length: cars }, (_, index) => {
    const field = (k: number) => v[index * timingStride + k] ?? 0;
    return {
      index,
      position: field(0),
      status: field(1),
      laps: field(2),
      best: field(3),
      lastLap: field(4),
      compound: field(8),
      pits: field(10),
      finished: field(12) === 1,
      retired: field(12) === 2,
      finishTime: field(13),
      segmentBest: field(11),
      eliminated: field(14) === 1,
    };
  });
}

export function carPoses(m: Weekend, cars: number) {
  const v = read(m, cars * carStride, (p) => {
    m._sdCars(p);
  });
  return Array.from({ length: cars }, (_, index) => {
    const at = (k: number) => v[index * carStride + k] ?? 0;
    return {
      x: at(12),
      y: at(13),
      headingX: at(0),
      headingY: at(1),
      frontAxle: Math.max(at(16), at(22)),
    };
  });
}

export function trackPoint(m: Weekend, distance: number, lateral: number) {
  const pointer = m._malloc(12);
  m._sdTrackLocal2Global(distance, lateral, pointer);
  const [x = 0, y = 0] = new Float32Array(m.HEAPF64.buffer, pointer, 2);
  m._free(pointer);
  return { x, y };
}

export function qualifyingTimes(m: Weekend, index: number): number[] {
  return Array.from(
    read(m, 3, (p) => {
      m._sdQualifyingTimes(index, p);
    }),
  );
}

export function gridOf(m: Weekend, cars: number): number[] {
  const pointer = m._malloc(cars * 4);
  const count = m._sdSessionGrid(pointer);
  const grid = Array.from(
    new Int32Array(m.HEAPF64.buffer, pointer, count).slice(),
  );
  m._free(pointer);
  return grid;
}

export function runUntilComplete(
  m: Weekend,
  limitSeconds: number,
  onSecond?: () => void,
): void {
  const calls = limitSeconds / secondsPerCall;
  for (let call = 0; call < calls; call++) {
    m._sdStep(stepsPerCall);
    if (call % 25 !== 0) continue;
    onSecond?.();
    if (phaseOf(m) === sessionPhase.complete) return;
  }
}
