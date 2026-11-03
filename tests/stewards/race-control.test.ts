import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  offence,
  raceControlState,
  stage,
  type StewardMessage,
} from "../../apps/client/src/game/stewards.ts";
import {
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import { Pilot } from "../support/pilot.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import {
  carMotion,
  type Rules,
  sessionKind,
  startField,
  subset,
  timingOf,
  type Weekend,
} from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";
import {
  frameOf,
  type Stewarded,
  stewardMessages,
} from "../support/stewards.ts";

type Raced = Weekend & Stewarded & RaceSystems;

const fieldCars = 8;
const stepsPerSample = 50;
const lapSeconds = 130;
const distanceIndex = 53;
const lapIndex = 49;
const speedIndex = 45;

function field(cars: number): WeekendPlan {
  return subset(planWeekend("corvus", 3, null), cars);
}

async function race(laps: number, rules: Rules, autopilot = true) {
  return (await startField({
    kind: sessionKind.race,
    laps,
    seed: 2,
    plan: field(fieldCars),
    autopilot,
    rules,
  })) as unknown as Raced;
}

function controlState(m: Raced): number {
  const pointer = m._malloc(16 * 8);
  m._sdRaceControlInfo(pointer);
  const state = new Float64Array(m.HEAPF64.buffer, pointer, 1)[0] ?? 0;
  m._free(pointer);
  return state;
}

function time(m: Raced): number {
  return frameOf(m)[0] ?? 0;
}

function order(m: Raced): number[] {
  return timingOf(m, fieldCars)
    .filter((row) => !row.retired)
    .sort((a, b) => a.position - b.position)
    .map((row) => row.index);
}

function gridOrder(plan: WeekendPlan): number[] {
  let rival = 0;
  const cars = plan.entrants.map((entrant, entry) => ({
    index: entrant.player ? 0 : ++rival,
    slot: plan.slots[entry] ?? entry,
  }));
  return cars.sort((a, b) => a.slot - b.slot).map((car) => car.index);
}

function allDone(m: Raced): boolean {
  return timingOf(m, fieldCars).every((row) => row.finished || row.retired);
}

function runRace(m: Raced, seconds: number, each?: () => void): number[] {
  const seen: number[] = [];
  for (let s = 0; s < seconds * 500 && !allDone(m); s += stepsPerSample) {
    m._sdStep(stepsPerSample);
    const state = controlState(m);
    if (seen.at(-1) !== state) seen.push(state);
    each?.();
  }
  return seen;
}

function decisions(m: Raced, car?: number): StewardMessage[] {
  return stewardMessages(m).filter(
    (message) =>
      message.stage === stage.decision &&
      (car === undefined || message.car === car),
  );
}

function holdOnGrid(m: Raced): void {
  while (time(m) < 0) {
    m._sdInputAnalog(1, 0, 0, 1);
    m._sdStep(5);
  }
}

function stopStep(m: Raced, pilot: Pilot, where: number): boolean {
  const frame = frameOf(m);
  const speed = Math.abs(frame[speedIndex] ?? 0);
  const lap = frame[lapIndex] ?? 0;
  const past = lap === 1 && (frame[distanceIndex] ?? 0) > where;
  if (!past) {
    pilot.tick();
    return false;
  }
  m._sdInputAnalog(1, 0, 0, speed > 0.5 ? 1 : 0);
  m._sdStep(1);
  return speed < 0.5;
}

function stopOnTrack(m: Raced, where: number) {
  const pilot = new Pilot(m, 0.85);
  holdOnGrid(m);
  let stoppedAt = -1;
  let deployedAt = -1;
  for (let s = 0; s < 2 * lapSeconds * 500 && deployedAt < 0; s++) {
    if (stopStep(m, pilot, where) && stoppedAt < 0) stoppedAt = time(m);
    if (controlState(m) === raceControlState.safetyCar) deployedAt = time(m);
  }
  return { stoppedAt, deployedAt };
}

describe.runIf(existsSync(wasm))("race control", () => {
  test("a car stopped on the racing line brings out the safety car within seconds", async () => {
    const m = await race(3, {}, false);
    const { stoppedAt, deployedAt } = stopOnTrack(m, 3000);
    expect(stoppedAt).toBeGreaterThan(0);
    expect(deployedAt - stoppedAt).toBeGreaterThan(2);
    expect(deployedAt - stoppedAt).toBeLessThan(6);
  }, 600_000);

  test("behind the safety car the field queues without passing and racing resumes at the line", async () => {
    const m = await race(3, {});
    let deployed = false;
    let queued: number[] = [];
    let restarted: number[] = [];
    const pits = () => timingOf(m, fieldCars).map((row) => row.pits);
    let pitsAtDeploy: number[] = [];
    const seen = runRace(m, 6 * lapSeconds, () => {
      if (!deployed && time(m) > 60) {
        deployed = m._sdRaceControlDeploy(2) === 1;
        pitsAtDeploy = pits();
      }
      const state = controlState(m);
      if (state === raceControlState.safetyCarIn && queued.length === 0)
        queued = order(m);
      if (
        state === raceControlState.green &&
        deployed &&
        restarted.length === 0
      )
        restarted = order(m);
    });
    expect(seen).toEqual([
      raceControlState.lights,
      raceControlState.green,
      raceControlState.safetyCar,
      raceControlState.safetyCarIn,
      raceControlState.restart,
      raceControlState.green,
    ]);
    const stopped = pits().map((count, i) => count > (pitsAtDeploy[i] ?? 0));
    const kept = (list: number[]) => list.filter((car) => !stopped[car]);
    expect(kept(restarted)).toEqual(kept(queued));
    const neutralOffences: number[] = [
      offence.neutralisedOvertake,
      offence.safetyCarPass,
      offence.safetyCarDelta,
      offence.safetyCarGap,
      offence.restartOvertake,
    ];
    expect(
      decisions(m).filter((d) => neutralOffences.includes(d.offence)),
    ).toEqual([]);
  }, 600_000);

  test("a red flag lines the field up in race order, restarts it from the lights and the race still runs to the flag", async () => {
    const m = await race(3, {});
    let before: number[] = [];
    let lined: number[] = [];
    let deployed = false;
    const seen = runRace(m, 4 * lapSeconds, () => {
      if (!deployed && time(m) > 60) {
        before = order(m);
        deployed = m._sdRaceControlDeploy(3) === 1;
      }
      if (controlState(m) === raceControlState.suspended && lined.length === 0)
        lined = order(m);
    });
    expect(deployed).toBe(true);
    expect(seen).toEqual(
      expect.arrayContaining([
        raceControlState.red,
        raceControlState.suspended,
        raceControlState.lights,
        raceControlState.green,
      ]),
    );
    expect(lined).toEqual(before);
    const rows = timingOf(m, fieldCars);
    expect(rows.filter((row) => row.finished).length).toBeGreaterThanOrEqual(
      fieldCars - 1,
    );
  }, 600_000);

  test("on a formation lap the field drives a lap, forms up in grid order and still races the full distance", async () => {
    const laps = 2;
    const m = await race(laps, { formationLap: true });
    expect(time(m)).toBeLessThan(-100);
    let furthest = 0;
    let lined: number[] = [];
    const seen = runRace(m, 4 * lapSeconds, () => {
      if (controlState(m) === raceControlState.formation)
        furthest = Math.max(furthest, frameOf(m)[distanceIndex] ?? 0);
      if (controlState(m) === raceControlState.lights && lined.length === 0)
        lined = order(m);
    });
    expect(seen.slice(0, 3)).toEqual([
      raceControlState.formation,
      raceControlState.lights,
      raceControlState.green,
    ]);
    expect(furthest).toBeGreaterThan(2000);
    expect(lined).toEqual(gridOrder(field(fieldCars)));
    const winner = timingOf(m, fieldCars).find((row) => row.position === 1);
    expect(winner?.finished).toBe(true);
    expect(winner?.laps).toBe(laps + 1);
    expect(
      decisions(m).filter((d) => d.offence === offence.formationOvertake),
    ).toEqual([]);
  }, 600_000);

  test("cars waiting their turn to leave the grid keep their wheels straight", async () => {
    const m = await race(2, { formationLap: true });
    m._sdStep(250);
    let parked = 0;
    let locked = 0;
    for (let s = 0; s < 2 * 500; s += stepsPerSample) {
      m._sdStep(stepsPerSample);
      for (const car of carMotion(m, fieldCars).slice(1)) {
        if (car.speed > 0.5) continue;
        parked++;
        if (Math.abs(car.steer) > 0.5) locked++;
      }
    }
    expect(parked).toBeGreaterThan(fieldCars);
    expect(locked / parked).toBeLessThan(0.05);
  });

  test("a rolling start keeps the field behind the safety car until the line", async () => {
    const m = await race(2, { rollingStart: true });
    let atGreen: number[] = [];
    const seen = runRace(m, 3 * lapSeconds, () => {
      if (controlState(m) === raceControlState.green && atGreen.length === 0)
        atGreen = order(m);
    });
    expect(seen.slice(0, 4)).toEqual([
      raceControlState.lights,
      raceControlState.safetyCarIn,
      raceControlState.restart,
      raceControlState.green,
    ]);
    expect(atGreen.slice(0, 3)).toEqual(
      gridOrder(field(fieldCars)).slice(0, 3),
    );
  }, 600_000);

  test("racing on through a virtual safety car breaks the delta and is penalised", async () => {
    const m = await race(3, {}, false);
    const pilot = new Pilot(m, 0.85);
    holdOnGrid(m);
    let deployed = false;
    for (let s = 0; s < 3 * lapSeconds * 500 && !allDone(m); s++) {
      pilot.tick();
      if (!deployed && time(m) > 40) deployed = m._sdRaceControlDeploy(1) === 1;
      if (deployed && controlState(m) === raceControlState.green) break;
    }
    for (let s = 0; s < 15 * 500; s++) pilot.tick();
    expect(deployed).toBe(true);
    const mine = decisions(m, 0).filter(
      (message) => message.offence === offence.vscDelta,
    );
    expect(mine).toHaveLength(1);
  }, 600_000);
});
