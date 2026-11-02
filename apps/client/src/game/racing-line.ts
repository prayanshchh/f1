export interface SpeedProfile {
  lapTime: number;
  speed: number[];
  braking: number[];
}

export interface RacingLineData {
  length: number;
  x: number[];
  y: number[];
  z: number[];
  profile: SpeedProfile;
}

export type RacingLineMode = "full" | "corners" | "off";

export interface Cue {
  kind: "accelerate" | "lift" | "brake";
  decel: number;
}

export interface Tile {
  index: number;
  distance: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
}

const brakeDecel = 6;
const liftDecel = 1;
const liftLead = 0.35;
const cornerCurvature = 1 / 220;
const cornerBefore = 90;
const cornerAfter = 40;
const cornerSpacing = 3.2;
const straightSpacing = 6.4;

export function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function at(values: number[], i: number): number {
  const n = values.length;
  return values[((i % n) + n) % n] ?? 0;
}

function cueFor(decel: number): Cue["kind"] {
  if (decel >= brakeDecel) return "brake";
  return decel >= liftDecel ? "lift" : "accelerate";
}

function warnBeforeBraking(
  result: Cue[],
  speed: number[],
  start: number,
  step: number,
  count: number,
): void {
  const n = result.length;
  const kind = (k: number) => result[(start + k) % n]?.kind;
  for (let k = count - 1; k > 0; k--) {
    if (kind(k) !== "brake" || kind(k - 1) === "brake") continue;
    const lead = Math.ceil((liftLead * at(speed, start + k)) / step);
    for (let m = 1; m <= lead && k - m >= 0; m++) {
      const cue = result[(start + k - m) % n];
      if (cue?.kind === "accelerate") cue.kind = "lift";
    }
  }
}

export function planCues(
  result: Cue[],
  profile: SpeedProfile,
  length: number,
  carDistance: number,
  carSpeed: number,
  reach: number,
): void {
  const v = profile.speed;
  const b = profile.braking;
  const n = v.length;
  const step = length / n;
  const start = Math.floor(wrap(carDistance, length) / step);
  const count = Math.min(n, Math.ceil(reach / step));
  for (let k = 0; k < count; k++) {
    const cue = result[(start + k) % n];
    if (cue) {
      cue.kind = "accelerate";
      cue.decel = 0;
    }
  }
  let carried = Math.max(0, carSpeed);
  for (let k = 0; k < count; k++) {
    const j = (start + k) % n;
    const gain = Math.max(0, at(v, j + 1) ** 2 - at(v, j) ** 2);
    const next = Math.sqrt(carried * carried + gain);
    const limit = at(b, j + 1);
    if (next <= limit) {
      carried = next;
      continue;
    }
    const decel = Math.max(0, (carried * carried - limit * limit) / (2 * step));
    const cue = result[j];
    if (cue) {
      cue.kind = cueFor(decel);
      cue.decel = decel;
    }
    carried = limit;
  }
  warnBeforeBraking(result, v, start, step, count);
}

export function emptyPlan(size: number): Cue[] {
  return Array.from({ length: size }, () => ({ kind: "accelerate", decel: 0 }));
}

export function cues(
  profile: SpeedProfile,
  length: number,
  carDistance: number,
  carSpeed: number,
): Cue[] {
  const result = emptyPlan(profile.speed.length);
  planCues(result, profile, length, carDistance, carSpeed, length);
  return result;
}

function curvature(data: RacingLineData, i: number): number {
  const heading = (j: number) =>
    Math.atan2(
      at(data.z, j + 1) - at(data.z, j),
      at(data.x, j + 1) - at(data.x, j),
    );
  const turn = heading(i) - heading(i - 1);
  const step = data.length / data.x.length;
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) / step;
}

export function cornerMask(
  data: RacingLineData,
  profile: SpeedProfile,
): boolean[] {
  const n = data.x.length;
  const step = data.length / n;
  const ideal = cues(profile, data.length, 0, profile.speed[0] ?? 0);
  const core = ideal.map(
    (cue, i) =>
      cue.kind !== "accelerate" || curvature(data, i) > cornerCurvature,
  );
  const mask = Array.from({ length: n }, () => false);
  const before = Math.round(cornerBefore / step);
  const after = Math.round(cornerAfter / step);
  core.forEach((on, i) => {
    if (!on) return;
    for (let k = -before; k <= after; k++) mask[wrap(i + k, n)] = true;
  });
  return mask;
}

export function layTiles(data: RacingLineData, corners: boolean[]): Tile[] {
  const n = data.x.length;
  const step = data.length / n;
  const tiles: Tile[] = [];
  let distance = 0;
  while (distance < data.length - cornerSpacing / 2) {
    const index = Math.min(n - 1, Math.round(distance / step));
    const dx = at(data.x, index + 1) - at(data.x, index - 1);
    const dz = at(data.z, index + 1) - at(data.z, index - 1);
    const dy = at(data.y, index + 1) - at(data.y, index - 1);
    tiles.push({
      index,
      distance,
      x: at(data.x, index),
      y: at(data.y, index),
      z: at(data.z, index),
      heading: Math.atan2(dz, dx),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    });
    distance += corners[index] ? cornerSpacing : straightSpacing;
  }
  return tiles;
}
