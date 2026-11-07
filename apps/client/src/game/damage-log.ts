import type { WheelTyre } from "./tyres.ts";

const partChange = 1e-4;
const tyreChange = 0.004;
const capacity = 6000;
const tyreKeys = [
  "surface",
  "carcass",
  "pressure",
  "wear",
  "lock",
  "spin",
  "grip",
  "flat",
  "leak",
  "cut",
  "dirt",
  "gravel",
  "flatAt",
  "shred",
  "water",
] as const satisfies readonly (keyof WheelTyre)[];
const watched = new Set<keyof WheelTyre>([
  "wear",
  "flat",
  "leak",
  "shred",
  "dirt",
  "gravel",
  "water",
]);

interface Track<T> {
  times: number[];
  values: T[];
}

function newTrack<T>(): Track<T> {
  return { times: [], values: [] };
}

function latest<T>(track: Track<T>, time: number): T | null {
  let low = 0;
  let high = track.times.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((track.times[mid] ?? Infinity) <= time) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found < 0 ? null : (track.values[found] ?? null);
}

function push<T>(track: Track<T>, time: number, value: T): void {
  const last = track.times.length - 1;
  if (last >= 0 && (track.times[last] ?? -Infinity) >= time) {
    track.times[last] = time;
    track.values[last] = value;
    return;
  }
  track.times.push(time);
  track.values.push(value);
  if (track.times.length > capacity) {
    track.times.splice(0, track.times.length - capacity);
    track.values.splice(0, track.values.length - capacity);
  }
}

function cutTrack<T>(track: Track<T>, time: number): void {
  let keep = track.times.length;
  while (keep > 0 && (track.times[keep - 1] ?? 0) > time) keep -= 1;
  track.times.length = keep;
  track.values.length = keep;
}

function packTyres(wheels: WheelTyre[]): Float32Array {
  const packed = new Float32Array(wheels.length * tyreKeys.length);
  wheels.forEach((wheel, i) => {
    tyreKeys.forEach((key, k) => {
      packed[i * tyreKeys.length + k] = wheel[key];
    });
  });
  return packed;
}

function unpackTyres(packed: Float32Array): WheelTyre[] {
  const count = packed.length / tyreKeys.length;
  return Array.from({ length: count }, (_, i) => {
    const wheel = {} as Record<keyof WheelTyre, number>;
    tyreKeys.forEach((key, k) => {
      wheel[key] = packed[i * tyreKeys.length + k] ?? 0;
    });
    return wheel;
  });
}

function tyresMoved(was: Float32Array | undefined, now: Float32Array): boolean {
  if (!was || was.length !== now.length) return true;
  for (let k = 0; k < now.length; k++) {
    const key = tyreKeys[k % tyreKeys.length];
    if (!key || !watched.has(key)) continue;
    if (Math.abs((was[k] ?? 0) - (now[k] ?? 0)) > tyreChange) return true;
  }
  return false;
}

export class DamageLog {
  private readonly cars: Track<Float32Array>[] = [];
  private readonly tyres = newTrack<Float32Array>();

  record(time: number, state: ArrayLike<number>, stride: number): void {
    const count = Math.floor(state.length / stride);
    for (let car = 0; car < count; car++) {
      const track = (this.cars[car] ??= newTrack());
      const at = car * stride;
      const was = track.values[track.values.length - 1];
      if (!moved(was, state, at, stride)) continue;
      const values = new Float32Array(stride);
      for (let k = 0; k < stride; k++) values[k] = state[at + k] ?? 0;
      push(track, time, values);
    }
  }

  recordTyres(time: number, wheels: WheelTyre[]): void {
    const packed = packTyres(wheels);
    if (!tyresMoved(this.tyres.values[this.tyres.values.length - 1], packed))
      return;
    push(this.tyres, time, packed);
  }

  partsAt(car: number, time: number): Float32Array | null {
    const track = this.cars[car];
    return track ? latest(track, time) : null;
  }

  tyresAt(time: number): WheelTyre[] | null {
    const packed = latest(this.tyres, time);
    return packed ? unpackTyres(packed) : null;
  }

  get carCount(): number {
    return this.cars.length;
  }

  cut(time: number): void {
    for (const track of this.cars) cutTrack(track, time);
    cutTrack(this.tyres, time);
  }
}

function moved(
  was: Float32Array | undefined,
  state: ArrayLike<number>,
  at: number,
  stride: number,
): boolean {
  for (let k = 0; k < stride; k++) {
    const now = state[at + k] ?? 0;
    if (Math.abs((was?.[k] ?? 0) - now) > partChange) return true;
  }
  return false;
}
