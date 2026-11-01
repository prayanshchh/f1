export interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
}

const sineBits = 14;
export const sineMask = (1 << sineBits) - 1;
export const sine = Float32Array.from({ length: 1 << sineBits }, (_, i) =>
  Math.sin((2 * Math.PI * i) / (1 << sineBits)),
);

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 2147483648 - 1;
  }
}

export class OnePole {
  value: number;
  private readonly coefficient: number;

  constructor(initial: number, seconds: number, rate: number) {
    this.value = initial;
    this.coefficient = 1 - Math.exp(-1 / (seconds * rate));
  }

  step(target: number): number {
    this.value += (target - this.value) * this.coefficient;
    return this.value;
  }
}

export class BandPass {
  private readonly b0: number;
  private readonly a1: number;
  private readonly a2: number;
  private z1 = 0;
  private z2 = 0;

  constructor(frequency: number, q: number, sampleRate: number) {
    const w =
      (2 * Math.PI * Math.min(frequency, 0.45 * sampleRate)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  tick(input: number): number {
    const output = this.b0 * input + this.z1;
    this.z1 = -this.a1 * output + this.z2;
    this.z2 = -this.b0 * input - this.a2 * output;
    return output;
  }
}

export function lookup(
  axis: readonly number[],
  value: number,
): [number, number] {
  const last = axis.length - 1;
  const first = axis[0] ?? 0;
  const final = axis[last] ?? first;
  if (value <= first) return [0, 0];
  if (value >= final) return [last - 1, 1];
  const step = (final - first) / last;
  const position = (value - first) / step;
  const index = Math.min(Math.floor(position), last - 1);
  return [index, position - index];
}
