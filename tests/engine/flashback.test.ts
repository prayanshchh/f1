import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { HeapHistory } from "../../apps/client/src/game/flashback.ts";
import { sessionKind, startField } from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";

const fieldSize = 22;
const carStride = 49;
const stepsPerChunk = 10;
const chunkSeconds = stepsPerChunk / 500;

const page = 4096;

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : a.length;
}

describe("flashback history", () => {
  test("a buffer filling page by page keeps recent flashback points", () => {
    const heap = new Uint8Array(64 * page);
    for (let i = 0; i < 10 * page; i++) heap[i] = (i * 31 + 7) & 0xff;
    const history = new HeapHistory<Uint8Array>(() => heap);
    const ringStart = 20 * page;
    const sampleBytes = 56;
    const samples = Math.floor((21 * page) / sampleBytes);
    const dt = 1 / 120;
    let sample = 0;
    let time = 0;
    for (let tick = 1; tick <= 960; tick++) {
      time = tick * dt;
      for (let k = 0; k < 2; k++) {
        const at = ringStart + (sample % samples) * sampleBytes;
        heap.fill((tick & 0xfe) | 1, at, at + sampleBytes);
        sample++;
      }
      heap[5 * page + (tick % 64)] = tick & 0xff;
      history.tick(time, dt, () => heap.slice());
    }
    heap[50 * page + 100] = 7;
    const moment = history.rewind(time - 3, time);
    if (!moment) throw new Error("no flashback point was kept");
    expect(moment.time).toBeGreaterThan(time - 3.6);
    expect(firstDifference(heap, moment.extra)).toBe(-1);
  });
});

describe.runIf(existsSync(wasm))("flashback", () => {
  test("rewinding the whole field replays the race exactly", async () => {
    const m = await startField({
      kind: sessionKind.race,
      laps: 5,
      seed: 5,
      rain: "little",
    });
    const out = m._malloc(fieldSize * carStride * 8);
    const cars = () => {
      m._sdCars(out);
      return Array.from(
        new Float64Array(m.HEAPF64.buffer, out, fieldSize * carStride),
      );
    };
    const history = new HeapHistory(() => new Uint8Array(m.HEAPF64.buffer));
    let time = 0;
    const chunk = () => {
      m._sdStep(stepsPerChunk);
      time += chunkSeconds;
      history.tick(time, chunkSeconds, () => time);
    };
    while (time < 30) chunk();
    expect(history.trackedPages).toBeGreaterThan(0);
    const original: number[][] = [];
    const mark = time;
    while (time < mark + 4) {
      chunk();
      original.push(cars());
    }
    const moment = history.rewind(mark - 6, time);
    if (!moment) throw new Error("no flashback point was kept");
    expect(moment.extra).toBe(moment.time);
    expect(moment.time).toBeGreaterThan(mark - 7);
    time = moment.time;
    while (time < mark - 1e-9) {
      m._sdStep(stepsPerChunk);
      time += chunkSeconds;
    }
    const replayed: number[][] = [];
    for (let i = 0; i < original.length; i++) {
      m._sdStep(stepsPerChunk);
      replayed.push(cars());
    }
    expect(replayed).toEqual(original);
  });
});
