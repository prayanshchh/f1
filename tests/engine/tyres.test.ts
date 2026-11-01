import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  accelerateTo,
  peakBraking,
  speedOf,
  startRace,
  tyreReader,
} from "../support/race-systems.ts";
import { wasm } from "../support/speed-dreams.ts";

const soft = 0;
const medium = 1;
const hard = 2;
const inter = 3;
const wet = 4;
const windows = [93, 95, 98, 72, 58];
const windowOf = (compound: number) => windows[compound] ?? 95;

describe.runIf(existsSync(wasm))("tyres from the engine", () => {
  test("dry grip falls in order: soft, medium, hard, inter, wet", async () => {
    const grip: number[] = [];
    for (const compound of [soft, medium, hard, inter, wet])
      grip.push(await peakBraking({}, compound, windowOf(compound), 0));
    for (let i = 1; i < grip.length; i++)
      expect(grip[i - 1] ?? 0).toBeGreaterThan(grip[i] ?? 0);
  }, 120000);

  test("in the rain inters and wets beat slicks", async () => {
    const options = { rain: "little" };
    const slick = await peakBraking(options, soft, windowOf(soft), 0);
    const intermediate = await peakBraking(options, inter, windowOf(inter), 0);
    const fullWet = await peakBraking(options, wet, windowOf(wet), 0);
    expect(intermediate).toBeGreaterThan(slick * 1.15);
    expect(fullWet).toBeGreaterThan(slick * 1.05);
    const heavy = { rain: "heavy" };
    expect(await peakBraking(heavy, wet, windowOf(wet), 0)).toBeGreaterThan(
      await peakBraking(heavy, inter, windowOf(inter), 0),
    );
  }, 180000);

  test("worn tyres lose grip, and past the cliff they lose a lot", async () => {
    const fresh = await peakBraking({}, medium, windowOf(medium), 0);
    const used = await peakBraking({}, medium, windowOf(medium), 0.6);
    const gone = await peakBraking({}, medium, windowOf(medium), 0.95);
    expect(used).toBeLessThan(fresh * 0.99);
    expect(gone).toBeLessThan(used * 0.92);
  }, 120000);

  test("cold and overheated tyres grip less than tyres in their window", async () => {
    const good = await peakBraking({}, medium, windowOf(medium), 0);
    expect(await peakBraking({}, medium, 40, 0)).toBeLessThan(good * 0.85);
    expect(await peakBraking({}, medium, 140, 0)).toBeLessThan(good * 0.85);
  }, 120000);

  test("driving heats the tyres, raises pressure and wears the tread", async () => {
    const m = await startRace();
    const read = tyreReader(m);
    m._sdTyresFit(medium, 40, 0);
    const before = read();
    const coldPressure = before.pressure(2);
    accelerateTo(m, 70);
    for (let tick = 0; tick < 2000; tick++) {
      m._sdInputAnalog(1, tick % 400 < 200 ? 0.15 : -0.15, 0.6, 0);
      m._sdStep(1);
    }
    const after = read();
    expect(after.surface(2)).toBeGreaterThan(before.surface(2) + 3);
    expect(after.pressure(2)).toBeGreaterThan(coldPressure);
    expect(after.wear(2)).toBeGreaterThan(0);
    expect(after.carcass(2)).toBeLessThan(after.surface(2));
  });

  test("hard tyres wear slower than softs through the same weave", async () => {
    const worn = async (compound: number) => {
      const m = await startRace({ compound });
      const read = tyreReader(m);
      accelerateTo(m, 40);
      m._sdTyresFit(compound, windowOf(compound), 0.3);
      for (let tick = 0; tick < 1500; tick++) {
        m._sdInputAnalog(1, tick % 500 < 250 ? 0.06 : -0.06, 0.25, 0);
        m._sdStep(1);
      }
      return (read().wear(0) + read().wear(1)) / 2 - 0.3;
    };
    const softWear = await worn(soft);
    const hardWear = await worn(hard);
    expect(hardWear).toBeGreaterThan(0);
    expect(softWear).toBeGreaterThan(hardWear * 1.2);
  });

  test("a straight-line stop on full pedal locks up and reports how hard", async () => {
    const m = await startRace();
    const read = tyreReader(m);
    accelerateTo(m, 40);
    m._sdTyresFit(medium, 95, 0);
    const before = read().wear(0);
    let peak = 0;
    m._sdInputAnalog(1, 0, 0, 1);
    for (let tick = 0; tick < 400 && speedOf(m) > 10; tick++) {
      m._sdStep(1);
      peak = Math.max(peak, read().lock(0));
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(read().wear(0)).toBeGreaterThan(before);
  });

  test("gentle braking never reports a lock-up", async () => {
    const m = await startRace();
    const read = tyreReader(m);
    accelerateTo(m, 40);
    m._sdTyresFit(medium, 95, 0);
    let peak = 0;
    m._sdInputAnalog(1, 0, 0, 0.1);
    for (let tick = 0; tick < 400; tick++) {
      m._sdStep(1);
      peak = Math.max(peak, read().lock(0));
    }
    expect(peak).toBeLessThan(0.05);
  });
});
