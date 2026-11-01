import {
  BandPass,
  dbToGain,
  lookup,
  OnePole,
  type Random,
  sine,
  sineMask,
} from "./dsp.ts";

export interface EngineTables {
  rpm: number[];
  bands: number[];
  on: number[][];
  off: number[][];
  noiseOn: number[][];
  noiseOff: number[][];
}

const flutterSeconds = 0.05;
const wanderSeconds = 0.03;
const flutterDepth = 0.28;
const wanderDepth = 0.0012;
const noiseBinScale = 0.0383;
const limitRatio = 0.45;
const silence = 1e-6;
const roadLowHz = 250;
const roadHighHz = 4000;
const roadFullSpeed = 25;
const roadMinimum = 0.15;

function flatten(rows: number[][]): Float32Array {
  return Float32Array.from(rows.flat());
}

function oscillate(
  out: Float32Array,
  from: number,
  [startInc, endInc]: [number, number],
  [startGain, endGain]: [number, number],
): number {
  const n = out.length;
  const incStep = (endInc - startInc) / n;
  const gainStep = (endGain - startGain) / n;
  let phase = from;
  let inc = startInc;
  let gain = startGain;
  for (let i = 0; i < n; i++) {
    phase += inc;
    inc += incStep;
    gain += gainStep;
    out[i] = (out[i] ?? 0) + gain * (sine[(phase * 16384) & sineMask] ?? 0);
  }
  return phase - Math.floor(phase);
}

export class EngineVoice {
  private readonly orders: number;
  private readonly on: Float32Array;
  private readonly off: Float32Array;
  private readonly noiseOn: Float32Array;
  private readonly noiseOff: Float32Array;
  private readonly bandCount: number;
  private readonly phases: Float64Array;
  private readonly gains: Float32Array;
  private readonly next: Float32Array;
  private readonly flutter: OnePole[];
  private readonly wander: OnePole[];
  private readonly filters: BandPass[];
  private readonly bandGains: Float32Array;
  private readonly bandNext: Float32Array;

  private readonly tables: EngineTables;
  private readonly sampleRate: number;
  private readonly random: Random;

  constructor(tables: EngineTables, sampleRate: number, random: Random) {
    this.tables = tables;
    this.sampleRate = sampleRate;
    this.random = random;
    this.orders = tables.on[0]?.length ?? 0;
    this.bandCount = tables.bands.length - 1;
    this.on = flatten(tables.on);
    this.off = flatten(tables.off);
    this.noiseOn = flatten(tables.noiseOn);
    this.noiseOff = flatten(tables.noiseOff);
    this.phases = new Float64Array(this.orders);
    for (let k = 0; k < this.orders; k++)
      this.phases[k] = random.next() * 0.5 + 0.5;
    this.gains = new Float32Array(this.orders);
    this.next = new Float32Array(this.orders);
    const blockRate = sampleRate / 128;
    this.flutter = Array.from(
      { length: this.orders },
      () => new OnePole(0, flutterSeconds, blockRate),
    );
    this.wander = Array.from(
      { length: this.orders },
      () => new OnePole(0, wanderSeconds, blockRate),
    );
    this.filters = Array.from({ length: this.bandCount }, (_, b) => {
      const low = tables.bands[b] ?? 40;
      const high = tables.bands[b + 1] ?? 80;
      return new BandPass(
        Math.sqrt(low * high),
        Math.sqrt(low * high) / (high - low),
        sampleRate,
      );
    });
    this.bandGains = new Float32Array(this.bandCount);
    this.bandNext = new Float32Array(this.bandCount);
  }

  private interpolate(
    table: Float32Array,
    width: number,
    row: number,
    mix: number,
    column: number,
  ): number {
    const a = table[row * width + column] ?? -120;
    const b = table[(row + 1) * width + column] ?? a;
    return a + (b - a) * mix;
  }

  private partialTargets(rpm: number, load: number): void {
    const [row, mix] = lookup(this.tables.rpm, rpm);
    const frequency = rpm / 120;
    for (let k = 0; k < this.orders; k++) {
      const onDb = this.interpolate(this.on, this.orders, row, mix, k);
      const offDb = this.interpolate(this.off, this.orders, row, mix, k);
      const db = offDb + (onDb - offDb) * load;
      const shake = this.flutter[k]?.step(this.random.next() * 8) ?? 0;
      const audible =
        (k + 1) * frequency < limitRatio * this.sampleRate ? 1 : 0;
      this.next[k] = audible * dbToGain(db) * Math.exp(shake * flutterDepth);
    }
  }

  private roadShare(band: number, speed: number): number {
    const centre = this.tables.bands[band] ?? 0;
    if (centre >= roadLowHz && centre <= roadHighHz) return 1;
    const moving = Math.min(1, Math.max(0, speed / roadFullSpeed));
    return roadMinimum + (1 - roadMinimum) * moving * moving;
  }

  private noiseTargets(rpm: number, load: number, speed: number): void {
    const [row, mix] = lookup(this.tables.rpm, rpm);
    for (let b = 0; b < this.bandCount; b++) {
      const onDb = this.interpolate(this.noiseOn, this.bandCount, row, mix, b);
      const offDb = this.interpolate(
        this.noiseOff,
        this.bandCount,
        row,
        mix,
        b,
      );
      this.bandNext[b] =
        (dbToGain(offDb + (onDb - offDb) * load) / noiseBinScale) *
        this.roadShare(b, speed);
    }
  }

  private renderPartial(
    out: Float32Array,
    k: number,
    startRpm: number,
    endRpm: number,
  ): void {
    const start = this.gains[k] ?? 0;
    const end = this.next[k] ?? 0;
    this.gains[k] = end;
    if (start < silence && end < silence) return;
    const wobble =
      1 + (this.wander[k]?.step(this.random.next() * 8) ?? 0) * wanderDepth;
    const multiple = ((k + 1) * wobble) / this.sampleRate;
    this.phases[k] = oscillate(
      out,
      this.phases[k] ?? 0,
      [(multiple * startRpm) / 120, (multiple * endRpm) / 120],
      [start, end],
    );
  }

  private renderPartials(
    out: Float32Array,
    startRpm: number,
    endRpm: number,
  ): void {
    for (let k = 0; k < this.orders; k++)
      this.renderPartial(out, k, startRpm, endRpm);
  }

  private renderNoise(out: Float32Array): void {
    const n = out.length;
    for (let b = 0; b < this.bandCount; b++) {
      const filter = this.filters[b];
      if (!filter) continue;
      const start = this.bandGains[b] ?? 0;
      const end = this.bandNext[b] ?? 0;
      this.bandGains[b] = end;
      const step = (end - start) / n;
      let gain = start;
      for (let i = 0; i < n; i++) {
        gain += step;
        out[i] = (out[i] ?? 0) + gain * filter.tick(this.random.next());
      }
    }
  }

  render(
    out: Float32Array,
    startRpm: number,
    endRpm: number,
    load: number,
    speed: number,
  ): void {
    this.partialTargets(endRpm, load);
    this.noiseTargets(endRpm, load, speed);
    this.renderPartials(out, startRpm, endRpm);
    this.renderNoise(out);
  }
}
