import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  PitStop,
  gradeTurnIn,
  stopDuration,
  steerCommand,
  type PitControl,
  type PitDrive,
  type PitLayout,
} from "../../apps/client/src/game/pitstop.ts";
import { type RaceSystems, statusReader } from "../support/race-systems.ts";
import { startCota, wasm } from "../support/speed-dreams.ts";
import { repoRoot } from "../support/repo.ts";

const layout = (
  JSON.parse(
    readFileSync(
      path.join(repoRoot, "content/tracks/cota/sd-frame.json"),
      "utf8",
    ),
  ) as { pit: PitLayout }
).pit;

describe("turn-in timing", () => {
  test("grades a press by how far it was from the optimal moment", () => {
    expect(gradeTurnIn(0.05)).toBe("optimal");
    expect(gradeTurnIn(-0.2)).toBe("good");
    expect(gradeTurnIn(0.8)).toBe("early");
    expect(gradeTurnIn(-0.8)).toBe("late");
  });

  test("makes a mistimed turn-in cost stop time", () => {
    expect(stopDuration("late")).toBeGreaterThan(stopDuration("optimal"));
    expect(stopDuration("optimal")).toBe(2.5);
  });

  test("a front wing change adds the time a real nose change takes", () => {
    expect(stopDuration("optimal", true)).toBeGreaterThan(9.5);
    expect(stopDuration("optimal", true)).toBeLessThan(12.5);
  });
});

interface Lap {
  phases: Set<string>;
  finished: boolean;
  parkedAlong: number;
  parkedLateral: number;
  fuelBefore: number;
  fuelAfter: number;
  startFuel: number;
  fastestInLane: number;
  stopTime: number;
  wingBefore: number;
  wingAfter: number;
  floorAfter: number;
}

const ahead = (from: number, to: number) =>
  (((to - from) % layout.length) + layout.length) % layout.length;

function approach(armed: boolean, distance: number, look: number): PitDrive {
  const fromEntry = ahead(layout.entry - 30, distance + look);
  const entering =
    armed && fromEntry < ahead(layout.entry - 30, layout.wallEnd);
  return {
    lateral: entering ? Math.min(layout.fastLane, fromEntry * 0.14) : 0,
    lookahead: look,
    speed: 22,
  };
}

function sample(m: RaceSystems) {
  const frame = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  const [time, cos, sin] = [frame[0], frame[1], frame[2]].map((v) => v ?? 0);
  const [x, y] = [frame[13], frame[14]].map((v) => v ?? 0);
  const [speed, distance, toMiddle] = [frame[45], frame[53], frame[54]].map(
    (v) => v ?? 0,
  );
  return {
    time: time ?? 0,
    heading: Math.atan2(sin ?? 0, cos ?? 1),
    x: x ?? 0,
    y: y ?? 0,
    speed: Math.abs(speed ?? 0),
    distance: distance ?? 0,
    toMiddle: toMiddle ?? 0,
  };
}

function record(
  lap: Lap,
  control: PitControl,
  car: ReturnType<typeof sample>,
  lateral: number,
  fuel: number,
): void {
  if (control.phase === "service" && !lap.phases.has("service")) {
    lap.parkedAlong = ahead(car.distance, layout.boxDistance);
    lap.parkedLateral = lateral;
    lap.fuelBefore = fuel;
  }
  lap.phases.add(control.phase);
  if (control.limit > 0 && control.phase === "lane")
    lap.fastestInLane = Math.max(lap.fastestInLane, car.speed * 3.6);
  lap.finished = lap.phases.has("release") && control.phase === "lane";
}

function service(m: RaceSystems, lap: Lap, control: PitControl): void {
  m._sdPitService(lap.startFuel, control.wingChange ? 1 : 0);
  m._sdStep(1);
  lap.stopTime = control.stopTime ?? 0;
}

async function driveStop(replaceWing = false): Promise<Lap> {
  const m = await startCota<RaceSystems>();
  const status = statusReader(m);
  const out = m._malloc(12);
  const hud = m._malloc(8 * 32);
  const point = (d: number, l: number) => {
    m._sdTrackLocal2Global(d, l, out);
    return Array.from(new Float32Array(m.HEAPF32.buffer, out, 3));
  };
  const fuel = () => {
    m._sdHudInfo(hud);
    return new Float64Array(m.HEAPF64.buffer, hud, 32)[0] ?? 0;
  };
  const pit = new PitStop(layout, false);
  pit.requestWing(replaceWing);
  m._sdInputSteerDirect(1);
  m._sdStep(1000);
  const lap: Lap = {
    phases: new Set(),
    finished: false,
    parkedAlong: 99,
    parkedLateral: 0,
    fuelBefore: 0,
    fuelAfter: 0,
    startFuel: fuel(),
    fastestInLane: 0,
    stopTime: 0,
    wingBefore: 0.6,
    wingAfter: 0,
    floorAfter: 0,
  };
  m._sdCarDamageSet(0, lap.wingBefore);
  m._sdCarDamageSet(4, 0.5);
  let armed = false;
  for (let tick = 0; tick < 200000 && !lap.finished; tick++) {
    const car = sample(m);
    armed ||= car.distance > 1000 && car.distance < 5000;
    const toTurn = ahead(car.distance, layout.boxDistance - 34);
    const control = pit.update(
      car,
      car.time,
      armed && toTurn / Math.max(car.speed, 1) < 0.04,
    );
    m._sdInputSpeedLimit(control.limit);
    m._sdInputPitHold(control.hold ? 1 : 0);
    const target =
      control.drive ??
      approach(armed, car.distance, Math.max(8, car.speed * 0.45));
    const reach = car.distance + target.lookahead;
    const command = steerCommand(
      car,
      point(reach, target.lateral - pit.shiftAt(reach)),
      target.speed,
    );
    m._sdInputAnalog(1, command.steer, command.throttle, command.brake);
    record(lap, control, car, car.toMiddle + pit.shiftAt(car.distance), fuel());
    if (control.serviceNow) {
      service(m, lap, control);
      lap.fuelAfter = fuel();
      lap.wingAfter = status().part(0);
      lap.floorAfter = status().part(4);
    }
    m._sdStep(1);
  }
  return lap;
}

describe.skipIf(!existsSync(wasm))("pit stop in the engine", () => {
  test("parks in the box, services the car and rejoins the fast lane", async () => {
    const lap = await driveStop();
    expect([...lap.phases]).toEqual(
      expect.arrayContaining(["lane", "boxing", "service", "release"]),
    );
    expect(lap.finished).toBe(true);
    expect(
      Math.min(lap.parkedAlong, layout.length - lap.parkedAlong),
    ).toBeLessThan(1.6);
    expect(Math.abs(lap.parkedLateral - layout.boxLateral)).toBeLessThan(1);
    expect(lap.fuelAfter).toBeGreaterThan(lap.fuelBefore);
    expect(lap.fuelAfter).toBeGreaterThan(lap.startFuel - 0.5);
    expect(lap.fastestInLane).toBeLessThan(84);
    expect(lap.wingAfter).toBe(lap.wingBefore);
  }, 120_000);

  test("asking for a new front wing makes the stop longer and fits it", async () => {
    const plain = await driveStop();
    const withWing = await driveStop(true);
    expect(withWing.stopTime).toBeGreaterThan(plain.stopTime + 7);
    expect(withWing.wingAfter).toBe(0);
    expect(withWing.floorAfter).toBeGreaterThan(0.4);
  }, 240_000);
});
