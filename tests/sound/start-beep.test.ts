import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { EngineTables } from "../../apps/client/src/game/sound/engine-voice.ts";
import {
  renderStartBeep,
  type StartBeep,
} from "../../apps/client/src/game/sound/start-beep.ts";
import { CarSynth, idleState } from "../../apps/client/src/game/sound/synth.ts";
import { repoRoot } from "../support/repo.ts";

const sampleRate = 48000;
const blockSize = 128;
const body = [0.01, 0.1] as const;
const hissFloor = -40;

interface Fingerprint {
  pitch: number;
  aboveIdle: number;
  harmonics: number[];
  window: number;
  times: number[];
  envelope: number[];
  noise: {
    edges: number[];
    frame: number;
    neighbours: number;
    plateau: number[];
    times: number[];
    envelope: number[];
  };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));
}

const reference = readJson(
  "tests/sound/start-beep-fingerprint.json",
) as Fingerprint;
const beep = withSilence(
  renderStartBeep(
    readJson("apps/client/src/game/sound/start-beep.json") as StartBeep,
    sampleRate,
  ),
  0.6,
);

function withSilence(signal: Float32Array, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  out.set(signal);
  return out;
}

function slice(signal: Float32Array, from: number, to: number): Float32Array {
  return signal.subarray(
    Math.round(from * sampleRate),
    Math.round(to * sampleRate),
  );
}

function toneLevel(signal: Float32Array, frequency: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < signal.length; i++) {
    const window =
      0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (signal.length - 1));
    const angle = (2 * Math.PI * frequency * i) / sampleRate;
    const sample = (signal[i] ?? 0) * window;
    re += sample * Math.cos(angle);
    im -= sample * Math.sin(angle);
  }
  return Math.hypot(re, im);
}

function decibels(value: number, reference: number): number {
  return 20 * Math.log10(value / reference + 1e-12);
}

function aWeight(frequency: number): number {
  const f2 = frequency * frequency;
  const response =
    (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) *
      Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) *
      (f2 + 12194 ** 2));
  return response * 10 ** (2 / 20);
}

function weightedPower(signal: Float32Array): number {
  const size = 4096;
  let total = 0;
  let frames = 0;
  for (let start = 0; start + size <= signal.length; start += size / 2) {
    const frame = signal.subarray(start, start + size);
    let windowPower = 0;
    for (let i = 0; i < size; i++)
      windowPower +=
        (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))) ** 2;
    let power = 0;
    for (let bin = 1; bin < size / 2; bin++) {
      const frequency = (bin * sampleRate) / size;
      power += (toneLevel(frame, frequency) * aWeight(frequency)) ** 2;
    }
    total += (2 * power) / (size * windowPower);
    frames++;
  }
  return total / frames;
}

function idleEngine(seconds: number): Float32Array {
  const synth = new CarSynth(
    readJson("apps/client/src/game/sound/tables.json") as EngineTables,
    sampleRate,
    blockSize,
  );
  const blocks = Math.floor((seconds * sampleRate) / blockSize);
  const settle = Math.floor((0.5 * sampleRate) / blockSize);
  const out = new Float32Array((blocks - settle) * blockSize);
  const left = new Float32Array(blockSize);
  const right = new Float32Array(blockSize);
  synth.set({ ...idleState, master: 1 });
  for (let block = 0; block < blocks; block++) {
    synth.process({ left, right });
    if (block >= settle) out.set(left, (block - settle) * blockSize);
  }
  return out;
}

function framePower(signal: Float32Array, start: number, frame: number) {
  const segment = slice(signal, start, start + frame / sampleRate);
  return Array.from({ length: frame / 2 + 1 }, (_, bin) => ({
    frequency: (bin * sampleRate) / frame,
    power: toneLevel(segment, (bin * sampleRate) / frame) ** 2,
  }));
}

function hissBins(
  signal: Float32Array,
  start: number,
  from: number,
  to: number,
) {
  const { frame } = reference.noise;
  return framePower(signal, start, frame).filter(({ frequency }) => {
    const harmonic = Math.max(1, Math.round(frequency / reference.pitch));
    const tonal =
      Math.abs(frequency - harmonic * reference.pitch) <
      (3 * sampleRate) / frame;
    return !tonal && frequency >= from && frequency < to;
  });
}

function neighbourhood(values: number[], size: number): number[] {
  const half = Math.floor(size / 2);
  return values.map((_, i) => {
    let sum = 0;
    for (let k = i - half; k <= i + half; k++)
      sum += values[Math.min(values.length - 1, Math.max(0, k))] ?? 0;
    return sum / size;
  });
}

function meanPower(bins: { power: number }[]): number {
  return bins.reduce((sum, bin) => sum + bin.power, 0) / bins.length;
}

describe("start light beep", () => {
  test("has the pitch and harmonic balance of the reference beep", () => {
    const steady = slice(beep, ...body);
    const levels = reference.harmonics.map((_, i) =>
      toneLevel(steady, reference.pitch * (i + 1)),
    );
    const fundamental = levels[0] ?? 1;
    levels.forEach((level, i) => {
      const expected = reference.harmonics[i] ?? 0;
      const tolerance = expected < hissFloor ? 3 : 0.5;
      expect(
        Math.abs(decibels(level, fundamental) - expected),
        `harmonic ${String(i + 1)}`,
      ).toBeLessThan(tolerance);
    });
    const nearby = [-6, -3, 3, 6].map((shift) =>
      toneLevel(steady, reference.pitch + shift),
    );
    for (const level of nearby) expect(level).toBeLessThan(fundamental);
  });

  test("rises, settles and cuts off like the reference beep", () => {
    const levels = reference.times.map((time) =>
      toneLevel(slice(beep, time, time + reference.window), reference.pitch),
    );
    const top = Math.max(...levels);
    levels.forEach((level, i) => {
      const expected = Math.max(reference.envelope[i] ?? 0, -30);
      expect(
        Math.abs(Math.max(decibels(level, top), -30) - expected),
        `${String(reference.times[i])} s`,
      ).toBeLessThan(1.5);
    });
  });

  test("carries the reference's hiss in every band, relative to the tone", () => {
    const tone = toneLevel(slice(beep, ...body), reference.pitch);
    const { edges, plateau, times } = reference.noise;
    const settled = times.filter((time) => time >= 0.1 && time <= 0.28);
    edges.slice(0, -1).forEach((low, band) => {
      const high = edges[band + 1] ?? low;
      const power =
        settled.reduce(
          (sum, time) => sum + meanPower(hissBins(beep, time, low, high)),
          0,
        ) / settled.length;
      expect(
        Math.abs(decibels(Math.sqrt(power), tone) - (plateau[band] ?? 0)),
        `${String(low)}-${String(high)} Hz`,
      ).toBeLessThan(1.5);
    });
  });

  test("the hiss flares at the start, holds for about 0.3 s and then stops like the reference", () => {
    const { times, envelope } = reference.noise;
    const levels = neighbourhood(
      times.map((time) => meanPower(hissBins(beep, time, 1000, 12000))),
      reference.noise.neighbours,
    );
    const settled = times
      .map((time, i) => (time >= 0.1 && time <= 0.28 ? (levels[i] ?? 0) : null))
      .filter((level) => level !== null);
    const plateau =
      settled.reduce((sum, level) => sum + level, 0) / settled.length;
    levels.forEach((level, i) => {
      const ours = Math.max(10 * Math.log10(level / plateau + 1e-12), -15);
      const expected = Math.max(envelope[i] ?? 0, -15);
      expect(Math.abs(ours - expected), `${String(times[i])} s`).toBeLessThan(
        3.5,
      );
    });
  });

  test("sits as far above the idling engine as the reference beep sits above its background", () => {
    const steady = slice(beep, ...body);
    const lift =
      10 * Math.log10(weightedPower(steady) / weightedPower(idleEngine(1.5)));
    expect(lift).toBeGreaterThan(reference.aboveIdle - 1.5);
    expect(lift).toBeLessThan(reference.aboveIdle + 1.5);
  }, 120_000);
});
