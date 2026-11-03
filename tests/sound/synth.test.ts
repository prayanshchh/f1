import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CarSynth,
  idleState,
  type SynthState,
} from "../../apps/client/src/game/sound/synth.ts";
import type { EngineTables } from "../../apps/client/src/game/sound/engine-voice.ts";
import { TurboVoice } from "../../apps/client/src/game/sound/effects.ts";
import { repoRoot } from "../support/repo.ts";

const sampleRate = 48000;
const blockSize = 128;
const tables = JSON.parse(
  readFileSync(
    path.join(repoRoot, "apps/client/src/game/sound/tables.json"),
    "utf8",
  ),
) as EngineTables;
const fingerprint = JSON.parse(
  readFileSync(
    path.join(repoRoot, "tests/sound/f1-25-onboard-fingerprint.json"),
    "utf8",
  ),
) as { edges: number[]; levels: number[]; rpm: number[] };

const driving: SynthState = {
  ...idleState,
  rpm: 12000,
  load: 1,
  speed: 70,
  gear: 5,
  master: 1,
};

function render(
  seconds: number,
  state: (time: number) => SynthState,
  settle = 0.4,
): Float32Array {
  const synth = new CarSynth(tables, sampleRate, blockSize);
  const blocks = Math.floor((seconds * sampleRate) / blockSize);
  const skip = Math.floor((settle * sampleRate) / blockSize);
  const out = new Float32Array((blocks - skip) * blockSize);
  const left = new Float32Array(blockSize);
  const right = new Float32Array(blockSize);
  for (let block = 0; block < blocks; block++) {
    synth.set(state((block * blockSize) / sampleRate));
    synth.process({ left, right });
    if (block >= skip) out.set(left, (block - skip) * blockSize);
  }
  return out;
}

function amplitudeAt(signal: Float32Array, frequency: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < signal.length; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / signal.length);
    const angle = (2 * Math.PI * frequency * i) / sampleRate;
    const sample = signal[i] ?? 0;
    re += sample * window * Math.cos(angle);
    im += sample * window * Math.sin(angle);
  }
  return (4 * Math.hypot(re, im)) / signal.length;
}

function peakNear(
  signal: Float32Array,
  centre: number,
  spread: number,
): number {
  let best = centre;
  let level = -1;
  for (let f = centre * (1 - spread); f <= centre * (1 + spread); f += 1) {
    const amplitude = amplitudeAt(signal, f);
    if (amplitude > level) {
      level = amplitude;
      best = f;
    }
  }
  return best;
}

function bandLevels(signal: Float32Array, edges: number[]): number[] {
  const size = 8192;
  const levels = new Array<number>(edges.length - 1).fill(0);
  let frames = 0;
  for (let start = 0; start + size <= signal.length; start += size) {
    const segment = signal.subarray(start, start + size);
    edges.slice(0, -1).forEach((low, band) => {
      const high = edges[band + 1] ?? low;
      const step = Math.max(sampleRate / size, (high - low) / 12);
      let power = 0;
      let count = 0;
      for (let f = low; f < high; f += step) {
        power += amplitudeAt(segment, f) ** 2;
        count++;
      }
      levels[band] = (levels[band] ?? 0) + power / Math.max(1, count);
    });
    frames++;
  }
  return levels.map((power) => 10 * Math.log10(power / frames + 1e-14));
}

function peak(signal: Float32Array): number {
  let top = 0;
  for (const sample of signal) top = Math.max(top, Math.abs(sample));
  return top;
}

function rms(signal: Float32Array): number {
  let sum = 0;
  for (const sample of signal) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, signal.length));
}

describe("engine voice", () => {
  test.each([7000, 9500, 12000])("firing order follows %i rpm", (rpm) => {
    const signal = render(1.4, () => ({ ...driving, rpm }));
    const firing = rpm / 20;
    expect(peakNear(signal, firing, 0.03) / firing).toBeCloseTo(1, 2);
  });

  test("matches the spectrum measured from F1 25 onboard gameplay", () => {
    const sweep = fingerprint.rpm;
    const signal = render(sweep.length * 0.5 + 0.4, (time) => ({
      ...driving,
      rpm: sweep[Math.min(sweep.length - 1, Math.floor(time / 0.5))] ?? 11000,
    }));
    const ours = bandLevels(signal, fingerprint.edges);
    const delta = ours.map((level, i) => (fingerprint.levels[i] ?? 0) - level);
    const offset = [...delta].sort((a, b) => a - b)[delta.length >> 1] ?? 0;
    const error = Math.sqrt(
      delta.reduce((sum, d) => sum + (d - offset) ** 2, 0) / delta.length,
    );
    expect(error).toBeLessThan(3.5);
  });

  test("lifting off changes the sound without silencing it", () => {
    const on = render(1.2, () => ({ ...driving, rpm: 9000 }));
    const off = render(1.2, () => ({ ...driving, rpm: 9000, load: 0 }));
    expect(rms(off)).toBeGreaterThan(rms(on) * 0.2);
    const top = (signal: Float32Array) =>
      amplitudeAt(signal, (9000 / 120) * 31);
    expect(top(off)).not.toBeCloseTo(top(on), 6);
  });

  test("a gear change glides rather than clicks in the pitch", () => {
    const signal = render(1.2, (time) => ({
      ...driving,
      rpm: time < 0.8 ? 12400 : 10700,
      gear: time < 0.8 ? 4 : 5,
    }));
    let worst = 0;
    for (let i = 1; i < signal.length; i++)
      worst = Math.max(
        worst,
        Math.abs((signal[i] ?? 0) - (signal[i - 1] ?? 0)),
      );
    expect(worst).toBeLessThan(0.5);
    expect(peak(signal)).toBeLessThanOrEqual(1);
  });
});

describe("turbo", () => {
  const strongestTone = (signal: Float32Array, low: number, high: number) => {
    let best = low;
    let level = -1;
    for (let f = low; f <= high; f += 10) {
      const amplitude = amplitudeAt(signal, f);
      if (amplitude > level) {
        level = amplitude;
        best = f;
      }
    }
    return best;
  };
  const tail = (signal: Float32Array, seconds: number) =>
    signal.subarray(signal.length - Math.floor(seconds * sampleRate));

  test("spools towards the measured ceiling and ignores gear changes", () => {
    const signal = render(9, (time) => ({
      ...driving,
      rpm: 11000 + ((time * 1000) % 1200),
      gear: 4 + Math.floor(time / 1.2),
    }));
    expect(strongestTone(tail(signal, 0.4), 5000, 5700)).toBeGreaterThan(5340);
    expect(strongestTone(tail(signal, 0.4), 5000, 5700)).toBeLessThan(5500);
  });

  const turboTone = (seconds: number, load: (time: number) => number) => {
    const turbo = new TurboVoice(sampleRate);
    const blocks = Math.floor((seconds * sampleRate) / blockSize);
    const signal = new Float32Array(blocks * blockSize);
    for (let block = 0; block < blocks; block++) {
      const time = (block * blockSize) / sampleRate;
      const out = signal.subarray(block * blockSize, (block + 1) * blockSize);
      turbo.render(out, load(time), 12000);
    }
    return strongestTone(tail(signal, 0.3), 3500, 7000);
  };

  test("a sustained lift-off spools down without a whistle", () => {
    const at = turboTone(10, (time) => (time < 8 ? 1 : 0));
    expect(at).toBeGreaterThan(4300);
    expect(at).toBeLessThan(4900);
  });

  test("a brief throttle cut during a shift keeps the turbo spooled", () => {
    const at = turboTone(8.6, (time) => (time > 8 && time < 8.06 ? 0 : 1));
    expect(at).toBeGreaterThan(5300);
    expect(at).toBeLessThan(5600);
  });
});

describe("kerbs", () => {
  test.each([40, 70])("ridge pitch follows speed at %i m/s", (speed) => {
    const state = { ...driving, rpm: 9000, speed };
    const on = render(1.4, () => ({ ...state, kerb: 1 }));
    const off = render(1.4, () => state);
    const pitch = speed / 0.565;
    expect(amplitudeAt(on, pitch)).toBeGreaterThan(amplitudeAt(off, pitch) * 4);
  });

  test("road driving has no ridge tone", () => {
    const pitch = 70 / 0.565;
    const road = render(1.4, () => ({ ...driving, rpm: 9000 }));
    const kerb = render(1.4, () => ({ ...driving, rpm: 9000, kerb: 1 }));
    expect(amplitudeAt(road, pitch)).toBeLessThan(amplitudeAt(kerb, pitch) / 4);
  });
});

describe("tyres, brakes and impacts", () => {
  const quiet = { ...driving, rpm: 8000, load: 0 };
  const tyreBand = (signal: Float32Array) =>
    [720, 1560, 2980].reduce((sum, f) => sum + amplitudeAt(signal, f), 0);

  test("a locked wheel is audibly louder in the tyre band than rolling", () => {
    const rolling = render(1.4, () => quiet);
    const locked = render(1.4, () => ({ ...quiet, lock: 1 }));
    expect(tyreBand(locked)).toBeGreaterThan(tyreBand(rolling) * 2);
  });

  test("scrub, brake and rough surfaces each raise the level", () => {
    const base = rms(render(1.2, () => quiet));
    for (const change of [{ scrub: 1 }, { brake: 1 }, { rough: 1 }])
      expect(rms(render(1.2, () => ({ ...quiet, ...change })))).toBeGreaterThan(
        base,
      );
  });

  test("an impact fires once and decays", () => {
    const signal = render(
      2.4,
      (time) => ({ ...quiet, impact: time > 0.6 && time < 0.65 ? 1 : 0 }),
      0.3,
    );
    const slice = (from: number, to: number) =>
      signal.subarray(
        Math.floor((from - 0.3) * sampleRate),
        Math.floor((to - 0.3) * sampleRate),
      );
    expect(rms(slice(0.62, 0.8))).toBeGreaterThan(rms(slice(0.3, 0.55)) * 1.5);
    expect(rms(slice(1.9, 2.3))).toBeLessThan(rms(slice(0.62, 0.8)) * 0.8);
  });
});

describe("output safety", () => {
  test("stays finite and in range through a chaotic state sequence", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const signal = render(4, () => ({
      rpm: next() * 16000,
      load: next(),
      speed: next() * 100,
      gear: Math.floor(next() * 9) - 1,
      kerb: next(),
      rough: next(),
      scrub: next(),
      lock: next(),
      brake: next(),
      impact: next(),
      rain: next(),
      spray: next(),
      master: 1,
    }));
    expect(signal.every(Number.isFinite)).toBe(true);
    expect(peak(signal)).toBeLessThanOrEqual(1);
  });

  test("muting silences the output", () => {
    const signal = render(1.5, (time) => ({
      ...driving,
      master: time < 0.6 ? 1 : 0,
    }));
    const tail = signal.subarray(signal.length - 12000);
    expect(rms(tail)).toBeLessThan(1e-4);
  });

  test("same inputs give the same samples", () => {
    const a = render(0.8, () => driving);
    const b = render(0.8, () => driving);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
