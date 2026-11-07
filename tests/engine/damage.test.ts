import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  accelerateTo,
  type RaceSystems,
  speedOf,
  startRace,
  statusReader,
  tyreReader,
} from "../support/race-systems.ts";
import { Pilot, runStint } from "../support/pilot.ts";
import { wasm } from "../support/speed-dreams.ts";

const wingLeft = 0;
const wingRight = 1;
const sidepodLeft = 2;
const sidepodRight = 3;
const floor = 4;
const diffuser = 5;
const rearWing = 6;
const suspension = 7;
const frontRight = 0;
const frontLeft = 1;
const rearRight = 2;
const rearLeft = 3;
const pullUpBits = 0x04 | 0x08 | 0x10;
const tick = 0.002;
const seconds = (s: number) => Math.round(s / tick);

function telemetry(m: RaceSystems) {
  const memory = m._malloc(40 * 8);
  return () => {
    m._sdTelemetry(memory);
    return new Float64Array(m.HEAPF64.buffer, memory, 40).slice();
  };
}

const wheelLoad = (t: Float64Array, wheel: number) => t[12 + wheel * 6] ?? 0;

async function downforce(parts: number[], value = 1) {
  const m = await startRace({ wear: 0 });
  const read = telemetry(m);
  m._sdStep(1000);
  for (const part of parts) m._sdCarDamageSet(part, value);
  m._sdInputAnalog(1, 0, 1, 0);
  while (speedOf(m) < 8) m._sdStep(1);
  const low = read();
  const frontStatic = wheelLoad(low, 0) + wheelLoad(low, 1);
  const rearStatic = wheelLoad(low, 2) + wheelLoad(low, 3);
  while (speedOf(m) < 60) m._sdStep(1);
  const high = read();
  const front = wheelLoad(high, 0) + wheelLoad(high, 1) - frontStatic;
  const rear = wheelLoad(high, 2) + wheelLoad(high, 3) - rearStatic;
  return { front, rear, total: front + rear };
}

function hudState(m: RaceSystems) {
  const memory = m._malloc(32 * 8);
  m._sdHudInfo(memory);
  return new Float64Array(m.HEAPF64.buffer, memory, 32)[4] ?? 0;
}

function carHeight(m: RaceSystems): number {
  return new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88)[15] ?? 0;
}

function trackHeight(m: RaceSystems): number {
  const frame = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  const out = m._malloc(12);
  m._sdTrackLocal2Global(frame[53] ?? 0, frame[54] ?? 0, out);
  return new Float32Array(m.HEAPF32.buffer, out, 3)[2] ?? 0;
}

async function wallCrash(speed: number, steer: number) {
  const m = await startRace({ wear: 0 });
  m._sdStep(1000);
  const pilot = new Pilot(m, 1);
  pilot.driveUntil(() => speedOf(m) >= speed);
  m._sdInputAnalog(1, steer, 0.7, 0);
  m._sdStep(seconds(3));
  return { m, status: statusReader(m), tyres: tyreReader(m) };
}

describe.runIf(existsSync(wasm))("damage from the engine", () => {
  test("a car that breaks in a crash stays on the ground and the session ends", async () => {
    const { m, status } = await wallCrash(80, 0.3);
    let highest = -Infinity;
    let states = 0;
    for (let i = 0; i < seconds(25) && !status().stopped; i++) {
      m._sdInputAnalog(1, 0, 1, 0);
      m._sdStep(1);
      states |= hudState(m);
      highest = Math.max(highest, carHeight(m) - trackHeight(m));
    }
    expect(status().retired).toBeGreaterThan(0);
    expect(status().stopped).toBe(true);
    expect(states & pullUpBits).toBe(0);
    expect(highest).toBeLessThan(1);
    expect(Math.abs(speedOf(m))).toBeLessThan(1.5);
  }, 60000);

  test("running out of fuel stops the car without lifting it", async () => {
    const m = await startRace({ fuel: 1, race: true });
    const status = statusReader(m);
    m._sdStep(1000);
    const pilot = new Pilot(m, 0.9);
    let states = 0;
    let highest = -Infinity;
    pilot.driveUntil(() => {
      states |= hudState(m);
      highest = Math.max(highest, carHeight(m) - trackHeight(m));
      return status().stopped;
    }, seconds(200));
    expect(status().retired).toBe(4);
    expect(status().stopped).toBe(true);
    expect(states & pullUpBits).toBe(0);
    expect(highest).toBeLessThan(1);
  }, 60000);

  test("a light touch leaves parts alone, a hard one breaks what it hit", async () => {
    const m = await startRace();
    const status = statusReader(m);
    const tyres = tyreReader(m);
    m._sdStep(5);
    m._sdCarImpact(2, 0.7, 0, -1);
    m._sdStep(1);
    for (let part = 0; part < 11; part++) expect(status().part(part)).toBe(0);
    m._sdStep(seconds(0.5));
    m._sdCarImpact(2, 0.7, -3, -9);
    m._sdStep(1);
    const hit = status();
    expect(hit.part(wingLeft)).toBeGreaterThan(hit.part(wingRight));
    expect(hit.part(sidepodLeft)).toBeGreaterThanOrEqual(
      hit.part(sidepodRight),
    );
    expect(hit.part(rearWing)).toBe(0);
    expect(hit.part(diffuser)).toBe(0);
    expect(hit.part(suspension + frontLeft)).toBeGreaterThanOrEqual(
      hit.part(suspension + frontRight),
    );
    expect(tyres().cut(frontLeft)).toBeGreaterThan(tyres().cut(frontRight));
  });

  test.each([
    ["nose right", 2, -0.7, -14, 6, [wingRight], [rearWing, diffuser]],
    ["tail", -2.5, 0.2, 16, 0, [rearWing, diffuser], [wingLeft, wingRight]],
    ["left flank", 0.1, 0.8, 0, -18, [sidepodLeft], [sidepodRight, rearWing]],
  ])(
    "a hit on the %s damages the parts there",
    async (_name, forward, left, dvForward, dvLeft, broken, intact) => {
      const m = await startRace();
      const status = statusReader(m);
      m._sdStep(5);
      m._sdCarImpact(forward, left, dvForward, dvLeft);
      m._sdStep(1);
      const after = status();
      for (const part of broken) expect(after.part(part)).toBeGreaterThan(0.1);
      for (const part of intact) expect(after.part(part)).toBe(0);
    },
  );

  test("a hard hit on a wheel crushes its tyre, a light one only cuts it", async () => {
    const m = await startRace();
    const tyres = tyreReader(m);
    m._sdStep(5);
    m._sdCarImpact(1.8, 0.8, -3, -9);
    m._sdStep(1);
    expect(tyres().cut(frontLeft)).toBeGreaterThan(0);
    expect(tyres().shred(frontLeft)).toBe(0);
    expect(tyres().leak(frontLeft)).toBeLessThan(1);
    m._sdStep(seconds(0.5));
    m._sdCarImpact(1.8, 0.8, -6, -34);
    m._sdStep(1);
    const crushed = tyres();
    expect(crushed.leak(frontLeft)).toBe(1);
    expect(crushed.shred(frontLeft)).toBeGreaterThan(0.3);
    expect(crushed.shred(frontRight)).toBe(0);
  });

  test("a massive hit on a wheel tears it off and ends the race, a hard one only breaks it", async () => {
    const m = await startRace();
    const status = statusReader(m);
    const lost = () => {
      const out = m._malloc(64 * 8);
      const stride = m._sdCarsDamage(out);
      return new Float64Array(m.HEAPF64.buffer, out, stride)[
        suspension + frontLeft
      ];
    };
    m._sdStep(5);
    m._sdCarImpact(1.8, 0.8, -6, -34);
    m._sdStep(1);
    expect(status().part(suspension + frontLeft)).toBeGreaterThan(0.5);
    expect(lost()).toBeLessThanOrEqual(1);
    expect(status().retired).toBe(0);
    m._sdStep(seconds(0.5));
    m._sdCarImpact(1.8, 0.8, -8, -47);
    m._sdStep(1);
    expect(lost()).toBe(2);
    expect(status().retired).toBeGreaterThan(0);
  });

  test("hitting a real wall damages the side that touched it", async () => {
    const left = await wallCrash(40, 0.04);
    const right = await wallCrash(40, -0.04);
    const l = left.status();
    const r = right.status();
    expect(l.part(wingLeft)).toBeGreaterThan(l.part(wingRight));
    expect(r.part(wingRight)).toBeGreaterThan(r.part(wingLeft));
    expect(l.part(suspension + frontLeft)).toBeGreaterThan(0);
    expect(r.part(suspension + frontRight)).toBeGreaterThan(0);
  }, 60000);

  test("debris finds the real ground and barriers anywhere on the lap", async () => {
    const m = (await startRace()) as RaceSystems & {
      _sdGroundHeight: (x: number, y: number) => number;
      _sdTrackBarrier: (x: number, y: number, out: number) => void;
    };
    const point = m._malloc(12);
    const sides = m._malloc(8 * 8);
    const wrong: number[] = [];
    for (let d = 0; d < m._sdTrackLength(); d += 25) {
      m._sdTrackLocal2Global(d, 0, point);
      const [x = 0, y = 0, z = 0] = new Float32Array(
        m.HEAPF32.buffer,
        point,
        3,
      );
      m._sdTrackBarrier(x, y, sides);
      const [left = 0, , , , right = 0] = new Float64Array(
        m.HEAPF64.buffer,
        sides,
        8,
      );
      if (
        Math.abs(m._sdGroundHeight(x, y) - z) > 0.05 ||
        left <= 0 ||
        right <= 0
      )
        wrong.push(d);
    }
    expect(wrong).toEqual([]);
  });

  test("a stop replaces only the front wing, and only when asked", async () => {
    const m = await startRace();
    const status = statusReader(m);
    m._sdStep(5);
    const others = [
      sidepodLeft,
      sidepodRight,
      floor,
      diffuser,
      rearWing,
      suspension + frontRight,
      suspension + rearLeft,
    ];
    for (const part of [wingLeft, wingRight, ...others])
      m._sdCarDamageSet(part, 0.4);
    m._sdPitService(50, 0);
    m._sdStep(1);
    expect(status().part(wingLeft)).toBe(0.4);
    expect(status().part(wingRight)).toBe(0.4);
    m._sdPitService(50, 1);
    m._sdStep(1);
    expect(status().part(wingLeft)).toBe(0);
    expect(status().part(wingRight)).toBe(0);
    for (const part of others) expect(status().part(part)).toBe(0.4);
  });

  test("a head-on crash ends the session", async () => {
    const m = await startRace();
    const status = statusReader(m);
    m._sdStep(5);
    m._sdCarImpact(2.5, 0.1, -80, 0);
    m._sdStep(1);
    expect(status().retired).toBe(1);
  });

  test("each aero part removes its real share of downforce", async () => {
    const clean = await downforce([]);
    const wing = await downforce([wingLeft, wingRight]);
    const rear = await downforce([rearWing]);
    const floorGone = await downforce([floor]);
    const chip = await downforce([wingLeft, wingRight], 0.2);
    expect(wing.front).toBeLessThan(clean.front * 0.55);
    expect(rear.rear).toBeLessThan(clean.rear * 0.75);
    expect(floorGone.total).toBeLessThan(clean.total * 0.72);
    expect(floorGone.total).toBeLessThan(rear.total);
    expect(chip.front).toBeLessThan(clean.front * 0.92);
    expect(chip.front).toBeGreaterThan(clean.front * 0.8);
    expect(wing.front / wing.total).toBeLessThan(clean.front / clean.total);
    expect(rear.front / rear.total).toBeGreaterThan(clean.front / clean.total);
  }, 60000);

  async function cornering(parts: number[]) {
    const m = await startRace({ wear: 0 });
    const read = telemetry(m);
    m._sdInputSteerDirect(1);
    m._sdStep(1000);
    accelerateTo(m, 60);
    for (const part of parts) m._sdCarDamageSet(part, 1);
    m._sdInputAnalog(1, 0.09, 0.3, 0);
    let yaw = 0;
    let frontSlip = 0;
    let rearSlip = 0;
    for (let i = 0; i < 250; i++) {
      m._sdStep(1);
      const t = read();
      const speed = Math.max(1, Math.hypot(t[0] ?? 0, t[1] ?? 0));
      yaw = Math.max(yaw, Math.abs(t[2] ?? 0));
      frontSlip = Math.max(frontSlip, Math.abs((t[8] ?? 0) / speed));
      rearSlip = Math.max(rearSlip, Math.abs((t[20] ?? 0) / speed));
    }
    return { yaw, balance: frontSlip - rearSlip };
  }

  test("no front wing understeers, no rear wing oversteers", async () => {
    const clean = await cornering([]);
    const noFront = await cornering([wingLeft, wingRight]);
    const noRear = await cornering([rearWing]);
    expect(noFront.balance).toBeGreaterThan(clean.balance);
    expect(noRear.balance).toBeLessThan(clean.balance);
  }, 60000);

  async function drift(part: number): Promise<number> {
    const m = await startRace({ wear: 0 });
    m._sdInputSteerDirect(1);
    m._sdStep(1000);
    accelerateTo(m, 50);
    m._sdCarDamageSet(part, 1);
    const yaw = () => {
      const f = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
      return Math.atan2(f[2] ?? 0, f[1] ?? 1);
    };
    const start = yaw();
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(seconds(1));
    return yaw() - start;
  }

  test("one-sided wing damage pulls the car toward the broken side", async () => {
    const left = await drift(wingLeft);
    const right = await drift(wingRight);
    expect(left).toBeGreaterThan(right);
    expect(left - right).toBeGreaterThan(0.01);
  }, 60000);

  test("bent suspension steers the wheel off line", async () => {
    const clean = await drift(floor);
    const bent = await drift(suspension + frontLeft);
    expect(Math.abs(bent - clean)).toBeGreaterThan(0.01);
  }, 60000);

  test("wrecked sidepods overheat the engine and cut its power", async () => {
    const run = async (parts: number[]) => {
      const m = await startRace({ wear: 0, fuel: 100, race: true });
      const status = statusReader(m);
      m._sdStep(1000);
      for (const part of parts) m._sdCarDamageSet(part, 1);
      const pilot = new Pilot(m, 0.8);
      let peak = 0;
      let lowest = 1;
      pilot.driveUntil(() => {
        peak = Math.max(peak, status().engine);
        lowest = Math.min(lowest, status().power);
        return pilot.lapsDone() >= 3;
      });
      return { peak, lowest };
    };
    const clean = await run([]);
    const wrecked = await run([sidepodLeft, sidepodRight]);
    expect(clean.lowest).toBe(1);
    expect(wrecked.peak).toBeGreaterThan(clean.peak + 15);
    expect(wrecked.lowest).toBeLessThan(0.9);
  }, 120000);
});

describe.runIf(existsSync(wasm))(
  "punctures and lock-ups from the engine",
  () => {
    async function onBackStraight(wheel: number | null) {
      const m = await startRace({ wear: 0, fuel: 60, race: true });
      m._sdStep(1000);
      const pilot = new Pilot(m, 0.75);
      pilot.driveUntil(() => pilot.lapsDone() >= 1 && pilot.distance() > 2860);
      if (wheel !== null) m._sdTyreDamage(wheel, 1, 0);
      return { m, pilot };
    }

    async function topSpeed(wheel: number | null) {
      const { m, pilot } = await onBackStraight(wheel);
      pilot.scale = 1;
      let peak = 0;
      pilot.driveUntil(() => {
        peak = Math.max(peak, speedOf(m) * 3.6);
        return pilot.distance() > 3640;
      }, seconds(60));
      return peak;
    }

    test("a flat tyre keeps real speed on the straight but loses a lot of it", async () => {
      const clean = await topSpeed(null);
      const front = await topSpeed(frontLeft);
      const rear = await topSpeed(rearLeft);
      expect(clean).toBeGreaterThan(290);
      expect(front).toBeGreaterThan(205);
      expect(front).toBeLessThan(250);
      expect(rear).toBeGreaterThan(190);
      expect(rear).toBeLessThan(250);
    }, 120000);

    async function turnRate(wheel: number, steer: number) {
      const { m } = await onBackStraight(wheel);
      const read = telemetry(m);
      let peak = 0;
      for (let i = 0; i < 400; i++) {
        m._sdInputAnalog(1, steer, 0.2, 0);
        m._sdStep(1);
        peak = Math.max(peak, Math.abs(read()[2] ?? 0));
      }
      return peak;
    }

    test("a front flat does not want to turn away from the flat side", async () => {
      const left = 0.06;
      const right = -0.06;
      expect(await turnRate(frontLeft, right)).toBeLessThan(
        (await turnRate(frontLeft, left)) * 0.85,
      );
      expect(await turnRate(frontRight, left)).toBeLessThan(
        (await turnRate(frontRight, right)) * 0.85,
      );
    }, 120000);

    async function yawWander(wheel: number | null) {
      const { m, pilot } = await onBackStraight(wheel);
      const read = telemetry(m);
      pilot.scale = 0.45;
      const rates: number[] = [];
      for (let i = 0; i < seconds(4); i++) {
        pilot.tick();
        if (i > seconds(1)) rates.push(read()[2] ?? 0);
      }
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      return Math.sqrt(
        rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length,
      );
    }

    test("a flat tyre makes the car unstable even in a straight line", async () => {
      const clean = await yawWander(null);
      expect(await yawWander(frontLeft)).toBeGreaterThan(clean * 2);
      expect(await yawWander(rearLeft)).toBeGreaterThan(clean * 2);
    }, 120000);

    test("a puncture collapses grip and pressure and drags the floor", async () => {
      const m = await startRace({ wear: 0 });
      const tyres = tyreReader(m);
      const status = statusReader(m);
      const pilot = new Pilot(m, 0.5);
      m._sdStep(1000);
      pilot.driveUntil(() => speedOf(m) > 20);
      const healthy = tyres();
      m._sdTyreDamage(rearRight, 1, 0);
      for (let i = 0; i < seconds(10); i++) pilot.tick();
      const after = tyres();
      expect(after.leak(rearRight)).toBe(1);
      expect(after.pressure(rearRight)).toBe(0);
      expect(after.grip(rearRight)).toBeLessThan(healthy.grip(rearRight) * 0.3);
      expect(after.grip(rearLeft)).toBeGreaterThan(
        healthy.grip(rearLeft) * 0.9,
      );
      expect(status().part(floor)).toBeGreaterThan(0);
    }, 60000);

    test("a punctured car can still limp back to the pits", async () => {
      const m = await startRace({ wear: 0, fuel: 100, race: true });
      m._sdStep(1000);
      const pilot = new Pilot(m, 0.5);
      pilot.driveUntil(() => pilot.lapsDone() >= 1);
      m._sdTyreDamage(frontRight, 1, 0);
      pilot.driveUntil(() => pilot.lapsDone() >= 2, seconds(400));
      expect(pilot.lapsDone()).toBeGreaterThanOrEqual(2);
      expect(pilot.offTrack()).toBeLessThan(14);
    }, 60000);

    test("a cut tyre leaks slowly, a tyre worn through blows out", async () => {
      const m = await startRace();
      const tyres = tyreReader(m);
      m._sdStep(1000);
      m._sdTyreDamage(frontLeft, 0.7, 0);
      m._sdStep(seconds(5));
      expect(tyres().leak(frontLeft)).toBeGreaterThan(0.02);
      expect(tyres().leak(frontLeft)).toBeLessThan(0.1);
      m._sdTyresFit(1, 95, 1);
      m._sdStep(seconds(1));
      for (const wheel of [0, 1, 2, 3]) expect(tyres().leak(wheel)).toBe(1);
    });

    test("a flat tyre only shreds while it is driven on, and a new set is whole", async () => {
      const m = await startRace({ wear: 0 });
      const tyres = tyreReader(m);
      const pilot = new Pilot(m, 0.5);
      m._sdStep(1000);
      m._sdTyreDamage(frontLeft, 1, 0);
      m._sdStep(seconds(3));
      expect(tyres().leak(frontLeft)).toBe(1);
      expect(tyres().shred(frontLeft)).toBe(0);
      for (let i = 0; i < seconds(15); i++) pilot.tick();
      const driven = tyres();
      expect(driven.shred(frontLeft)).toBeGreaterThan(0.2);
      expect(driven.shred(frontRight)).toBe(0);
      m._sdPitService(50, 0);
      m._sdStep(1);
      expect(tyres().shred(frontLeft)).toBe(0);
    }, 60000);

    test("a lock-up leaves its flat spot at one place on the tyre", async () => {
      const m = await startRace();
      const tyres = tyreReader(m);
      const pilot = new Pilot(m, 0.95);
      m._sdStep(1000);
      pilot.driveUntil(() => pilot.lapsDone() >= 1 && speedOf(m) >= 70);
      m._sdTyresFit(1, 95, 0);
      m._sdInputAnalog(1, 0, 0, 1);
      for (let i = 0; i < 5000 && speedOf(m) > 5; i++) m._sdStep(1);
      const locked = tyres();
      expect(locked.flat(frontRight)).toBeGreaterThan(0.05);
      pilot.scale = 0.6;
      for (let i = 0; i < seconds(5); i++) pilot.tick();
      const later = tyres();
      expect(later.flat(frontRight)).toBeCloseTo(locked.flat(frontRight), 2);
      expect(later.flatAt(frontRight)).toBeCloseTo(
        locked.flatAt(frontRight),
        3,
      );
    }, 60000);

    test("a new set of tyres fixes a puncture and flat spots", async () => {
      const m = await startRace();
      const tyres = tyreReader(m);
      m._sdStep(1000);
      m._sdTyreDamage(rearLeft, 1, 0.5);
      m._sdStep(seconds(1));
      expect(tyres().leak(rearLeft)).toBe(1);
      m._sdPitService(50, 0);
      m._sdStep(1);
      expect(tyres().leak(rearLeft)).toBe(0);
      expect(tyres().flat(rearLeft)).toBe(0);
      expect(tyres().cut(rearLeft)).toBe(0);
    });

    async function stopFrom(speed: number, antiLock: number) {
      const m = await startRace();
      const tyres = tyreReader(m);
      const pilot = new Pilot(m, 0.95);
      m._sdInputAntiLock(antiLock);
      m._sdStep(1000);
      pilot.driveUntil(() => pilot.lapsDone() >= 1 && speedOf(m) >= speed);
      m._sdTyresFit(1, 95, 0);
      let distance = 0;
      m._sdInputAnalog(1, 0, 0, 1);
      for (let i = 0; i < 5000 && speedOf(m) > 5; i++) {
        distance += speedOf(m) * tick;
        m._sdStep(1);
      }
      const t = tyres();
      return { distance, wear: t.wear(0), flat: t.flat(0), heat: t.surface(0) };
    }

    test("a lock-up flat-spots the tyre, heats it, wears it and stops worse", async () => {
      const locked = await stopFrom(70, 0);
      const clean = await stopFrom(70, 1);
      expect(clean.flat).toBeLessThan(0.01);
      expect(locked.flat).toBeGreaterThan(0.05);
      expect(locked.wear).toBeGreaterThan(clean.wear * 8);
      expect(locked.heat).toBeGreaterThan(clean.heat + 15);
      expect(locked.distance).toBeGreaterThan(clean.distance);
    }, 60000);

    test("a badly flat-spotted tyre loses grip and finally blows", async () => {
      const m = await startRace();
      const tyres = tyreReader(m);
      m._sdStep(1000);
      m._sdTyresFit(1, 95, 0);
      m._sdStep(1);
      const before = tyres().grip(frontLeft);
      m._sdTyreDamage(frontLeft, 0, 0.9);
      m._sdStep(2);
      expect(tyres().grip(frontLeft)).toBeLessThan(before * 0.95);
      expect(tyres().leak(frontLeft)).toBe(0);
      m._sdTyreDamage(frontLeft, 0, 1);
      m._sdStep(seconds(1));
      expect(tyres().leak(frontLeft)).toBe(1);
    });
  },
);

describe.runIf(existsSync(wasm))("tyre life at Austin", () => {
  test.each([
    ["soft", 0, 18, 26],
    ["medium", 1, 25, 33],
    ["hard", 2, 35, 46],
  ])(
    "%s reaches 70%% wear at race pace when real stints end",
    async (_name, compound, low, high) => {
      const { lapsToWear } = await runStint(compound, 0.89, 0.7);
      expect(lapsToWear).toBeGreaterThanOrEqual(low);
      expect(lapsToWear).toBeLessThanOrEqual(high);
    },
    180000,
  );

  test("pushing harder uses the same tyre up much sooner", async () => {
    const gentle = await runStint(1, 0.82, 0.4);
    const normal = await runStint(1, 0.89, 0.4);
    const pushing = await runStint(1, 0.94, 0.4);
    expect(gentle.lapsToWear).toBeGreaterThan(normal.lapsToWear);
    expect(normal.lapsToWear).toBeGreaterThan(pushing.lapsToWear * 1.4);
  }, 240000);
});
