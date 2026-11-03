import type { Stamp } from "./phone-pad.ts";

export interface TiltStep {
  degreesLeft: number;
  setAt: number;
  reading: { x: number; y: number };
}

export interface Logs {
  tilts: [number, number, number][];
  sent: Stamp[];
  received: Stamp[];
  handed: Stamp[];
  car: Stamp[];
}

export interface StepResult {
  degreesLeft: number;
  phoneSends: number;
  phoneReaches90: number;
  network: number;
  gameUses: number;
  carStarts: number;
  carReaches90: number;
  carDelta: number;
}

export interface Spread {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

const changed = 0.005;
const sameFloat = 1e-6;
const sameTilt = 0.01;

function lastBefore(log: Stamp[], time: number): number {
  let value = Number.NaN;
  for (const [at, v] of log) {
    if (at >= time) break;
    if (!Number.isNaN(v)) value = v;
  }
  return value;
}

function firstStamp(
  log: Stamp[],
  from: number,
  until: number,
  accept: (value: number) => boolean,
): Stamp | null {
  for (const stamp of log)
    if (stamp[0] >= from && stamp[0] < until && accept(stamp[1])) return stamp;
  return null;
}

function tiltAt(logs: Logs, step: TiltStep): number {
  const match = logs.tilts.find(
    ([at, x, y]) =>
      at >= step.setAt &&
      Math.abs(x - step.reading.x) < sameTilt &&
      Math.abs(y - step.reading.y) < sameTilt,
  );
  return match ? match[0] : Number.NaN;
}

interface Window {
  from: number;
  until: number;
}

function moveOf(log: Stamp[], window: Window) {
  const before = lastBefore(log, window.from);
  const after = lastBefore(log, window.until);
  const reach = Math.abs(after - before) * 0.9;
  const starts = firstStamp(
    log,
    window.from,
    window.until,
    (v) => Math.abs(v - before) > changed,
  );
  const settles = firstStamp(
    log,
    window.from,
    window.until,
    (v) => Math.abs(v - before) >= reach && reach > changed,
  );
  return { before, after, starts, settles };
}

function timeOf(stamp: Stamp | null): number {
  return stamp ? stamp[0] : Number.NaN;
}

function valueOf(stamp: Stamp | null): number {
  return stamp ? stamp[1] : Number.NaN;
}

function stepResult(logs: Logs, step: TiltStep, window: Window): StepResult {
  const phone = moveOf(logs.sent, window);
  const sentAt = timeOf(phone.starts);
  const sentValue = valueOf(phone.starts);
  const arrivedAt = timeOf(
    firstStamp(
      logs.received,
      sentAt,
      window.until,
      (v) => Math.abs(v - sentValue) < sameFloat,
    ),
  );
  const handedAt = timeOf(
    firstStamp(
      logs.handed,
      arrivedAt,
      window.until,
      (v) => Math.abs(v - phone.before) > changed,
    ),
  );
  const car = moveOf(logs.car, window);
  return {
    degreesLeft: step.degreesLeft,
    phoneSends: sentAt - window.from,
    phoneReaches90: timeOf(phone.settles) - window.from,
    network: arrivedAt - sentAt,
    gameUses: handedAt - arrivedAt,
    carStarts: timeOf(car.starts) - window.from,
    carReaches90: timeOf(car.settles) - window.from,
    carDelta: car.after - car.before,
  };
}

export function analyseSteps(logs: Logs, steps: TiltStep[]): StepResult[] {
  const starts = steps.map((step) => tiltAt(logs, step));
  return steps.map((step, i) =>
    stepResult(logs, step, {
      from: starts[i] ?? Number.NaN,
      until: starts[i + 1] ?? Infinity,
    }),
  );
}

export function spread(values: number[]): Spread {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN;
  return {
    samples: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? Number.NaN,
  };
}

export function shiftLog<T extends [number, ...number[]]>(
  log: T[],
  offset: number,
): T[] {
  return log.map((entry) => {
    const copy = [...entry] as T;
    copy[0] = entry[0] - offset;
    return copy;
  });
}

export function frameInterval(log: Stamp[]): number {
  const gaps = log
    .slice(1)
    .map((stamp, i) => stamp[0] - (log[i]?.[0] ?? Number.NaN));
  return spread(gaps).p50;
}
