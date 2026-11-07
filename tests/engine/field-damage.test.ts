import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { chase, duel, type Rammer } from "../support/ram.ts";
import { wasm } from "../support/speed-dreams.ts";
import { frameOf } from "../support/stewards.ts";

const parts = 11;
const wingLeft = 0;
const wingRight = 1;
const diffuser = 5;
const rearWing = 6;
const contact = 5.5;

interface Damaged extends Rammer {
  _sdCarsDamage: (out: number) => number;
  _sdCarBreakDown: (index: number) => void;
}

function hold(m: Damaged, seconds: number): void {
  const end = (frameOf(m)[0] ?? 0) + seconds;
  m._sdInputPitHold(1);
  while ((frameOf(m)[0] ?? 0) < end) {
    m._sdInputAnalog(1, 0, 0, 0);
    m._sdStep(5);
  }
  m._sdInputPitHold(0);
}

function damageOf(m: Damaged, car: number): Float64Array {
  const memory = m._malloc(2 * parts * 8);
  m._sdCarsDamage(memory);
  const all = new Float64Array(m.HEAPF64.buffer, memory, 2 * parts).slice();
  m._free(memory);
  return all.subarray(car * parts, (car + 1) * parts);
}

function ram(m: Damaged, seconds: number): void {
  const end = (frameOf(m)[0] ?? 0) + seconds;
  while ((frameOf(m)[0] ?? 0) < end) {
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(1);
  }
}

describe.runIf(existsSync(wasm))("damage on AI cars", () => {
  test("running into the AI car ahead breaks its tail and the rammer's nose", async () => {
    const m = (await duel()) as Damaged;
    hold(m, 6);
    m._sdCarBreakDown(1);
    hold(m, 4);
    expect(chase(m, 60, contact)).toBeLessThan(contact);
    ram(m, 1.5);
    const rammer = damageOf(m, 0);
    const hit = damageOf(m, 1);
    const tail = Math.max(hit[rearWing] ?? 0, hit[diffuser] ?? 0);
    const nose = Math.max(rammer[wingLeft] ?? 0, rammer[wingRight] ?? 0);
    expect(tail).toBeGreaterThan(0.05);
    expect(nose).toBeGreaterThan(0.05);
    expect(Math.max(hit[wingLeft] ?? 0, hit[wingRight] ?? 0)).toBeLessThan(
      tail,
    );
    expect(rammer[rearWing]).toBe(0);
  }, 120_000);

  test("an AI car that is never touched stays whole", async () => {
    const m = (await duel()) as Damaged;
    hold(m, 30);
    expect(Array.from(damageOf(m, 1))).toEqual(new Array(parts).fill(0));
  }, 120_000);
});
