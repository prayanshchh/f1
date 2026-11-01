import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  accelerateTo,
  energyReader,
  lapsIndex,
  type RaceSystems,
  speedOf,
  startRace,
  statusReader,
} from "../support/race-systems.ts";
import { wasm } from "../support/speed-dreams.ts";

const none = 0;
const medium = 1;
const boost = 3;
const full = 4e6;

function fuelOf(m: RaceSystems): number {
  const memory = m._malloc(24 * 8);
  (m as unknown as { _sdHudInfo: (out: number) => void })._sdHudInfo(memory);
  return new Float64Array(m.HEAPF64.buffer, memory, 24)[0] ?? 0;
}

function flatOut(m: RaceSystems, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(1);
  }
}

describe.runIf(existsSync(wasm))("ERS and fuel from the engine", () => {
  test("Boost drains the battery at the full 350 kW", async () => {
    const m = await startRace({ mode: boost });
    const read = energyReader(m);
    expect(read().battery).toBe(full);
    accelerateTo(m, 40);
    const start = read().battery;
    flatOut(m, 1000);
    const used = start - read().battery;
    expect(used / 2).toBeGreaterThan(300e3);
    expect(used / 2).toBeLessThanOrEqual(351e3);
  });

  test("an empty battery means less acceleration than a charged one", async () => {
    const measure = async (mode: number) => {
      const m = await startRace({ mode });
      accelerateTo(m, 30);
      const from = speedOf(m);
      flatOut(m, 800);
      return speedOf(m) - from;
    };
    expect(await measure(boost)).toBeGreaterThan((await measure(none)) * 1.2);
  });

  test("None never deploys and Medium deploys less than Boost", async () => {
    const used = async (mode: number) => {
      const m = await startRace({ mode });
      const read = energyReader(m);
      accelerateTo(m, 20);
      const start = read().battery;
      flatOut(m, 800);
      return start - read().battery;
    };
    expect(await used(none)).toBeLessThanOrEqual(0);
    const mid = await used(medium);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan((await used(boost)) * 0.6);
  });

  test("braking recharges the battery and lifting recharges it too", async () => {
    const m = await startRace({ mode: boost });
    const read = energyReader(m);
    accelerateTo(m, 60);
    const low = read().battery;
    expect(low).toBeLessThan(full);
    m._sdEnergyMode(none);
    m._sdInputAnalog(1, 0, 0, 0.35);
    m._sdStep(500);
    const braked = read().battery;
    expect(braked).toBeGreaterThan(low);
    expect(braked - low).toBeLessThanOrEqual(351e3 + 1);
    m._sdInputAnalog(1, 0, 0, 0);
    m._sdStep(100);
    expect(read().battery).toBeGreaterThan(braked);
  });

  test("harvesting stops at the per-lap limit and at a full battery", async () => {
    const m = await startRace({ mode: boost });
    const read = energyReader(m);
    for (let cycle = 0; cycle < 60; cycle++) {
      accelerateTo(m, 45);
      m._sdInputAnalog(1, 0, 0, 0.3);
      m._sdStep(400);
      const now = read();
      expect(now.battery).toBeLessThanOrEqual(full);
      expect(now.harvested).toBeLessThanOrEqual(now.harvestLimit + 1);
    }
    expect(read().harvestLimit).toBe(7.5e6);
  }, 120000);

  test("practice has overtake always on; a race arms it for the next lap only", async () => {
    expect(energyReader(await startRace())().overtake).toBe(true);
    const m = await startRace({ race: true });
    const read = energyReader(m);
    expect(read().overtake).toBe(false);
    expect(read().harvestLimit).toBe(8.5e6);
    m._sdEnergyOvertake(1);
    expect(read().armed).toBe(true);
    const lap = () =>
      new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88)[lapsIndex] ?? 0;
    for (let tick = 0; tick < 3000 && lap() < 1; tick++) {
      m._sdInputAnalog(1, 0, 0.5, 0);
      m._sdStep(1);
    }
    expect(lap()).toBeGreaterThanOrEqual(1);
    m._sdStep(1);
    expect(read().overtake).toBe(true);
    expect(read().armed).toBe(false);
    expect(read().harvestLimit).toBe(9e6);
  });

  test("fuel burns with throttle, and richer mixes burn more", async () => {
    const burn = async (mix: number) => {
      const m = await startRace({ mix, fuel: 50 });
      m._sdStep(1000);
      const start = fuelOf(m);
      flatOut(m, 2500);
      return start - fuelOf(m);
    };
    const standard = await burn(1);
    expect(standard).toBeGreaterThan(0.06);
    expect(standard).toBeLessThan(0.14);
    expect(await burn(0)).toBeLessThan(standard);
    expect(await burn(3)).toBeGreaterThan(standard);
  });
});

describe.runIf(existsSync(wasm))("car status beyond Speed Dreams", () => {
  const wingLeft = 0;
  const wingRight = 1;
  const rearWing = 6;

  test("hitting a barrier head on damages the front wing, not the rear", async () => {
    const m = await startRace();
    const read = statusReader(m);
    let front = 0;
    let rear = 0;
    for (let tick = 0; tick < 30000 && front <= 0.02; tick++) {
      m._sdInputAnalog(1, 0, 1, 0);
      m._sdStep(1);
      const now = read();
      front = now.part(wingLeft) + now.part(wingRight);
      rear = now.part(rearWing);
    }
    expect(front).toBeGreaterThan(0.02);
    expect(rear).toBeLessThan(front);
  }, 120000);

  test("a wrecked front wing really costs high-speed grip", async () => {
    const stop = async (damaged: boolean) => {
      const m = await startRace();
      m._sdInputAntiLock(1);
      accelerateTo(m, 75);
      if (damaged) {
        m._sdCarDamageSet(wingLeft, 1);
        m._sdCarDamageSet(wingRight, 1);
        m._sdStep(5);
      }
      m._sdInputAnalog(1, 0, 0, 1);
      m._sdStep(100);
      return speedOf(m);
    };
    expect(await stop(true)).toBeGreaterThan((await stop(false)) + 0.2);
  });

  test("brakes heat under braking and cool on the straight", async () => {
    const m = await startRace();
    const read = statusReader(m);
    accelerateTo(m, 60);
    const before = read().brake(2);
    m._sdInputAnalog(1, 0, 0, 0.4);
    m._sdStep(350);
    const hot = read().brake(2);
    expect(hot).toBeGreaterThan(before + 100);
    m._sdInputAnalog(1, 0, 0.4, 0);
    m._sdStep(1000);
    expect(read().brake(2)).toBeLessThan(hot);
  });

  test("the engine warms flat out and is modelled even on Rookie", async () => {
    const m = await startRace();
    const read = statusReader(m);
    const start = read().engine;
    flatOut(m, 2000);
    expect(read().engine).toBeGreaterThan(start);
  });

  test("Straight Mode needs arming when the assist is off, and closes on lift", async () => {
    const m = await startRace();
    const energy = energyReader(m);
    m._sdEnergyStraight(0, 0);
    accelerateTo(m, 50);
    flatOut(m, 200);
    expect(energy().straight).toBe(0);
    m._sdEnergyStraight(0, 1);
    flatOut(m, 300);
    expect(energy().straight).toBeGreaterThan(0.5);
    m._sdInputAnalog(1, 0, 0, 0.3);
    m._sdStep(100);
    expect(energy().straight).toBe(0);
  });

  test("a tighter differential evens out the rear wheels under power", async () => {
    const spread = async (percent: number) => {
      const m = await startRace();
      accelerateTo(m, 30);
      m._sdEnergyDifferential(percent);
      let total = 0;
      for (let tick = 0; tick < 400; tick++) {
        m._sdInputAnalog(1, 0.25, 0.7, 0);
        m._sdStep(1);
        const frame = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
        total += Math.abs(
          (frame[17 + 2 * 7 + 6] ?? 0) - (frame[17 + 3 * 7 + 6] ?? 0),
        );
      }
      return total;
    };
    expect(await spread(100)).toBeLessThan(await spread(10));
  });
});
