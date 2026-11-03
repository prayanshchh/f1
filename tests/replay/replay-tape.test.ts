import { describe, expect, test } from "vitest";
import {
  carStride,
  frameIndex,
} from "../../apps/client/src/game/frame-layout.ts";
import { ReplayTape, tapeRate } from "../../apps/client/src/game/replay.ts";

const spinAngle = frameIndex.wheels + 4;

function frameAt(time: number, x: number, heading: number, spin: number) {
  const frame = new Float64Array(frameIndex.size);
  frame[frameIndex.time] = time;
  const p = frameIndex.posMat;
  frame.set(
    [
      Math.cos(heading),
      Math.sin(heading),
      0,
      0,
      -Math.sin(heading),
      Math.cos(heading),
      0,
      0,
      0,
      0,
      1,
      0,
      x,
      0,
      0,
      1,
    ],
    p,
  );
  frame[spinAngle] = spin;
  return frame;
}

function carsAt(x: number): Float64Array {
  const cars = new Float64Array(2 * carStride);
  cars.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1], carStride);
  return cars;
}

describe("replay tape", () => {
  test("plays back between samples, turning the short way round", () => {
    const tape = new ReplayTape(2);
    const step = 1 / tapeRate;
    tape.record(frameAt(0, 0, 0, 3.0), carsAt(10));
    tape.record(frameAt(step, 3, 0.2, -3.0), carsAt(13));
    const frame = new Float64Array(frameIndex.size);
    const cars = new Float64Array(2 * carStride);
    expect(tape.sample(step / 2, frame, cars)).toBe(true);
    expect(frame[frameIndex.posMat + 12]).toBeCloseTo(1.5, 6);
    expect(cars[carStride + 12]).toBeCloseTo(11.5, 6);
    const spin = frame[spinAngle] ?? 0;
    expect(Math.abs(Math.abs(spin) - Math.PI)).toBeLessThan(0.2);
    const forwardX = frame[frameIndex.posMat] ?? 0;
    const forwardY = frame[frameIndex.posMat + 1] ?? 0;
    expect(Math.hypot(forwardX, forwardY)).toBeCloseTo(1, 6);
    expect(Math.atan2(forwardY, forwardX)).toBeCloseTo(0.1, 2);
  });

  test("a flashback cuts the tape and recording carries on from there", () => {
    const tape = new ReplayTape(2);
    for (let i = 0; i <= 90; i++)
      tape.record(frameAt(i / tapeRate, i, 0, 0), carsAt(i));
    expect(tape.end).toBeCloseTo(3, 6);
    tape.cut(1.5);
    expect(tape.end).toBeLessThanOrEqual(1.5);
    tape.record(frameAt(1.6, 500, 0, 0), carsAt(500));
    const frame = new Float64Array(frameIndex.size);
    const cars = new Float64Array(2 * carStride);
    tape.sample(1.6, frame, cars);
    expect(frame[frameIndex.posMat + 12]).toBeCloseTo(500, 6);
    tape.sample(99, frame, cars);
    expect(frame[frameIndex.time]).toBeCloseTo(1.6, 6);
  });
});
