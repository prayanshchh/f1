import createSpeedDreams, {
  type SpeedDreamsModule,
} from "../../wasm/speed-dreams.js";
import type { WeekendPlan } from "./weekend.ts";
import type { EnergyInfo } from "./energy.ts";
import type { CarStatus } from "./mfd.ts";
import type { TyreInfo } from "./tyres.ts";
import type { SetupSource } from "./settings.ts";
import type { CarAudio } from "./sound/sound-state.ts";
import type { TrackLocal } from "./sky.ts";

export const frameIndex = {
  time: 0,
  posMat: 1,
  wheels: 17,
  speed: 45,
  rpm: 46,
  rpmRedLine: 47,
  gear: 48,
  laps: 49,
  curLapTime: 50,
  lastLapTime: 51,
  bestLapTime: 52,
  distFromStart: 53,
  toMiddle: 54,
  steer: 55,
  accel: 56,
  brake: 57,
  raceState: 58,
  dammage: 59,
  camera: 60,
  brakeTemp: 84,
  size: 88,
} as const;

const telemetrySize = 40;
const telemetryWheels = 8;

export interface WheelGrip {
  slip: number;
  load: number;
}

export interface HudInfo {
  fuel: number;
  tank: number;
  damage: number;
  maxDamage: number;
  state: number;
  totalLaps: number;
  tyreTemp: number[];
  tyreOptimal: number[];
  tyreCondition: number[];
  tyreTread: number[];
}

export interface RaceSystems {
  compound: number;
  wearScale: number;
  isRace: boolean;
  ersMode: number;
  fuelMix: number;
  ersAssist: boolean;
  straightAssist: boolean;
}

export interface SessionPlan {
  kind: SessionKind;
  laps: number;
  lengthScale: number;
  difficulty: number;
  seed: number;
  reference: number;
  field: WeekendPlan;
}

export const sessionKinds = {
  practice: 0,
  race: 1,
  qualifying: 2,
} as const;

type SessionKind = (typeof sessionKinds)[keyof typeof sessionKinds];

export const sessionPhase = {
  running: 0,
  flag: 1,
  complete: 2,
  done: 3,
} as const;

export interface SessionInfo {
  kind: number;
  phase: number;
  segment: number;
  clock: number;
  totalLaps: number;
  startDelay: number;
  chequered: boolean;
  leaderLaps: number;
  invalidLap: boolean;
  offTracks: number;
}

export interface CarTiming {
  index: number;
  position: number;
  status: number;
  laps: number;
  best: number;
  last: number;
  gapLeader: number;
  gapAhead: number;
  lapsDown: number;
  compound: number;
  tyreAge: number;
  pits: number;
  segmentBest: number;
  finished: boolean;
  retired: boolean;
  finishTime: number;
  eliminated: boolean;
  contacts: number;
  progress: number;
  overtake: boolean;
  inPit: boolean;
  segments: number[];
}

export const carStride = 49;
export const carField = {
  speed: 40,
  steer: 41,
  brake: 42,
  rpm: 43,
  gear: 44,
  compound: 45,
  visible: 46,
  toMiddle: 47,
  distance: 48,
} as const;
const timingStride = 20;
const sessionFields = 10;

export const outOfRaceState = 0x0400 | 0x0200 | 0x0004 | 0x0008 | 0x0010;

export async function loadSpeedDreams(): Promise<SpeedDreamsModule> {
  return createSpeedDreams({
    print: () => undefined,
    printErr: () => undefined,
  });
}

export function setupSource(module: SpeedDreamsModule): SetupSource {
  const limits = module.cwrap("sdCarLimits", "number", [
    "string",
    "string",
    "string",
    "string",
    "number",
  ]);
  return {
    fs: module.FS,
    limits: (car, path, key, unit) => {
      const pointer = module._malloc(24);
      const found = limits(car, path, key, unit, pointer) !== 0;
      const [value = 0, min = 0, max = 0] = Array.from(
        new Float64Array(module.HEAPF64.buffer, pointer, 3),
      );
      module._free(pointer);
      return found ? { value, min, max } : null;
    },
  };
}

function configureField(module: SpeedDreamsModule, plan: SessionPlan): void {
  const add = module.cwrap("sdFieldAdd", null, [
    "string",
    "string",
    "string",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
  ]);
  module._sdFieldClear();
  plan.field.entrants.forEach((entrant, index) => {
    const slot = plan.field.slots[index] ?? index;
    if (entrant.player)
      module._sdFieldPlayer(entrant.teamIndex, entrant.seat, slot);
    else
      add(
        entrant.name,
        entrant.code,
        entrant.team,
        entrant.teamIndex,
        entrant.seat,
        slot,
        entrant.speed,
        entrant.raceSpeed,
        1,
      );
    module._sdFieldPlan(index, entrant.speed, entrant.raceSpeed, entrant.power);
    entrant.runs.forEach((runs, segment) => {
      for (const at of runs) module._sdFieldRun(index, segment, at);
    });
    for (const stint of entrant.stints)
      module._sdFieldStint(index, stint.compound, stint.from);
  });
  module._sdSessionConfigure(
    plan.kind,
    plan.laps,
    plan.lengthScale,
    plan.difficulty,
    plan.seed,
  );
  module._sdSessionReference(plan.reference);
}

export class Engine {
  private carsMemory = 0;
  private timingMemory = 0;
  private sessionMemory = 0;
  private qualifyingMemory = 0;

  private constructor(
    private readonly module: SpeedDreamsModule,
    readonly carCount: number,
  ) {}

  static start(
    module: SpeedDreamsModule,
    category: string,
    track: string,
    car: string,
    assist: boolean,
    antiLock: boolean,
    now: number,
    race: RaceSystems,
    session: SessionPlan | null,
  ): Engine {
    if (session) configureField(module, session);
    module._sdInputAssist(assist ? 1 : 0);
    module._sdInputAntiLock(antiLock ? 1 : 0);
    module._sdTyresConfigure(race.compound, race.wearScale);
    module._sdEnergyConfigure(
      race.isRace ? 1 : 0,
      race.ersMode,
      race.fuelMix,
      race.ersAssist ? 1 : 0,
    );
    const init = module.cwrap("sdInit", "number", [
      "string",
      "string",
      "string",
      "string",
      "number",
    ]);
    const status = init(
      category,
      track,
      "config/raceman/quickrace.xml",
      car,
      now,
    );
    if (status !== 0) {
      throw new Error(
        `Speed Dreams failed to start the race (${String(status)})`,
      );
    }
    module._sdEnergyStraight(race.straightAssist ? 1 : 0, 0);
    return new Engine(module, session ? session.field.entrants.length : 1);
  }

  cars(): Float64Array {
    this.carsMemory ||= this.module._malloc(
      this.carCount * carStride * Float64Array.BYTES_PER_ELEMENT,
    );
    this.module._sdCars(this.carsMemory);
    return new Float64Array(
      this.module.HEAPF64.buffer,
      this.carsMemory,
      this.carCount * carStride,
    );
  }

  session(): SessionInfo {
    this.sessionMemory ||= this.module._malloc(
      sessionFields * Float64Array.BYTES_PER_ELEMENT,
    );
    this.module._sdSessionInfo(this.sessionMemory);
    const v = new Float64Array(
      this.module.HEAPF64.buffer,
      this.sessionMemory,
      sessionFields,
    );
    const at = (i: number) => v[i] ?? 0;
    return {
      kind: at(0),
      phase: at(1),
      segment: at(2),
      clock: at(3),
      totalLaps: at(4),
      startDelay: at(5),
      chequered: at(6) !== 0,
      leaderLaps: at(7),
      invalidLap: at(8) !== 0,
      offTracks: at(9),
    };
  }

  timing(): CarTiming[] {
    this.timingMemory ||= this.module._malloc(
      this.carCount * timingStride * Float64Array.BYTES_PER_ELEMENT,
    );
    this.qualifyingMemory ||= this.module._malloc(
      3 * Float64Array.BYTES_PER_ELEMENT,
    );
    this.module._sdTiming(this.timingMemory);
    const v = new Float64Array(
      this.module.HEAPF64.buffer,
      this.timingMemory,
      this.carCount * timingStride,
    ).slice();
    return Array.from({ length: this.carCount }, (_, index) => {
      const at = (k: number) => v[index * timingStride + k] ?? 0;
      this.module._sdQualifyingTimes(index, this.qualifyingMemory);
      const q = new Float64Array(
        this.module.HEAPF64.buffer,
        this.qualifyingMemory,
        3,
      );
      return {
        index,
        position: at(0),
        status: at(1),
        laps: at(2),
        best: at(3),
        last: at(4),
        gapLeader: at(5),
        gapAhead: at(6),
        lapsDown: at(7),
        compound: at(8),
        tyreAge: at(9),
        pits: at(10),
        segmentBest: at(11),
        finished: at(12) === 1,
        retired: at(12) === 2,
        finishTime: at(13),
        eliminated: at(14) !== 0,
        contacts: at(15),
        progress: at(16),
        overtake: at(17) !== 0,
        inPit: at(18) !== 0,
        segments: [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0],
      };
    });
  }

  pitLaneClear(): boolean {
    return this.module._sdAiPlayerLaneClear() !== 0;
  }

  advanceSession(): number {
    return this.module._sdSessionAdvance();
  }

  simulateSession(): void {
    this.module._sdSessionSimulate();
  }

  playerInGarage(on: boolean): void {
    this.module._sdSessionPlayerGarage(on ? 1 : 0);
  }

  timeScale(scale: number): void {
    this.module._sdTimeScale(scale);
  }

  setPitCompound(compound: number): void {
    this.module._sdSessionPitCompound(compound);
  }

  autopilot(on: boolean): void {
    this.module._sdFieldAutopilot(on ? 1 : 0);
  }

  playerBox(): number {
    return this.module._sdFieldPlayerBox();
  }

  speedLimit(metresPerSecond: number): void {
    this.module._sdInputSpeedLimit(metresPerSecond);
  }

  pitHold(on: boolean): void {
    this.module._sdInputPitHold(on ? 1 : 0);
  }

  pitService(fuel: number): void {
    this.module._sdPitService(fuel);
  }

  viewKey(code: number, ctrl: boolean): boolean {
    return this.module._sdViewKey(code, ctrl ? 1 : 0) !== 0;
  }

  viewResize(width: number, height: number): void {
    this.module._sdViewResize(Math.round(width), Math.round(height));
  }

  analog(
    input: { steer: number; throttle: number; brake: number } | null,
    direct = false,
  ): void {
    this.module._sdInputSteerDirect(direct ? 1 : 0);
    if (input)
      this.module._sdInputAnalog(1, input.steer, input.throttle, input.brake);
    else this.module._sdInputAnalog(0, 0, 0, 0);
  }

  key(code: number, down: boolean): void {
    this.module._sdKey(code, down ? 1 : 0);
  }

  update(now: number): Float64Array {
    this.module._sdUpdate(now);
    return this.frame();
  }

  frame(): Float64Array {
    return new Float64Array(
      this.module.HEAPF64.buffer,
      this.module._sdFrame(),
      frameIndex.size,
    );
  }

  private doubles(count: number, fill: (pointer: number) => void): number[] {
    const pointer = this.module._malloc(count * 8);
    fill(pointer);
    const values = Array.from(
      new Float64Array(this.module.HEAPF64.buffer, pointer, count),
    );
    this.module._free(pointer);
    return values;
  }

  trackLocal(): TrackLocal {
    const v = this.doubles(10, (p) => {
      this.module._sdTrackInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      timeOfDay: at(0),
      sunAscension: at(1),
      rain: at(2),
      visibility: at(3),
      worldX: at(7) - at(4) + 1,
      worldY: at(8) - at(5) + 1,
      worldZ: at(9) - at(6) + 1,
    };
  }

  wheelGrip(): WheelGrip[] {
    const v = this.doubles(telemetrySize, (p) => {
      this.module._sdTelemetry(p);
    });
    return [0, 1, 2, 3].map((i) => {
      const at = (k: number) => v[telemetryWheels + i * 6 + k] ?? 0;
      return { slip: Math.hypot(at(0), at(1)), load: at(4) };
    });
  }

  carAudio(frame: Float64Array): CarAudio {
    const v = this.doubles(22, (p) => {
      this.module._sdAudio(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      rpm: frame[frameIndex.rpm] ?? 0,
      redline: frame[frameIndex.rpmRedLine] ?? 1,
      throttle: frame[frameIndex.accel] ?? 0,
      brake: frame[frameIndex.brake] ?? 0,
      gear: frame[frameIndex.gear] ?? 0,
      damage: frame[frameIndex.dammage] ?? 0,
      speed: at(20),
      wheels: [0, 1, 2, 3].map((i) => ({
        skid: at(i * 5),
        spin: at(i * 5 + 1),
        radius: at(i * 5 + 2),
        surface: at(i * 5 + 3),
        load: at(i * 5 + 4),
      })),
    };
  }

  hudInfo(): HudInfo {
    const v = this.doubles(22, (p) => {
      this.module._sdHudInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    const wheels = (o: number) => [0, 1, 2, 3].map((i) => at(o + i));
    return {
      fuel: at(0),
      tank: at(1),
      damage: at(2),
      maxDamage: at(3),
      state: at(4),
      totalLaps: at(5),
      tyreTemp: wheels(6),
      tyreOptimal: wheels(10),
      tyreCondition: wheels(14),
      tyreTread: wheels(18),
    };
  }

  tyreInfo(): TyreInfo {
    const v = this.doubles(32, (p) => {
      this.module._sdTyresInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      compound: at(0),
      age: at(1),
      low: at(2),
      high: at(3),
      wheels: [0, 1, 2, 3].map((i) => {
        const o = 4 + i * 7;
        return {
          surface: at(o),
          carcass: at(o + 1),
          pressure: at(o + 2),
          wear: at(o + 3),
          lock: at(o + 4),
          spin: at(o + 5),
          grip: at(o + 6),
        };
      }),
    };
  }

  carStatus(): CarStatus {
    const v = this.doubles(12, (p) => {
      this.module._sdCarStatus(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      engineTemp: at(0),
      damage: {
        wingLeft: at(1),
        wingRight: at(2),
        sidepodLeft: at(3),
        sidepodRight: at(4),
        floor: at(5),
        diffuser: at(6),
        rearWing: at(7),
      },
      brakes: [0, 1, 2, 3].map((i) => at(8 + i)),
    };
  }

  energyInfo(): EnergyInfo {
    const v = this.doubles(19, (p) => {
      this.module._sdEnergyInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      battery: at(0),
      capacity: at(1),
      harvested: at(2),
      harvestLimit: at(3),
      deployed: at(4),
      motorPower: at(5),
      icePower: at(6),
      mode: at(7),
      fuelMix: at(8),
      overtakeActive: at(9) !== 0,
      overtakeArmed: at(10) !== 0,
      lastLapFuel: at(11),
      brakeBias: at(14),
      straightMode: at(16),
      differential: at(17),
      straightArmed: at(18) !== 0,
    };
  }

  setErsMode(mode: number): void {
    this.module._sdEnergyMode(mode);
  }

  setFuelMix(mix: number): void {
    this.module._sdEnergyFuelMix(mix);
  }

  armOvertake(): void {
    this.module._sdEnergyOvertake(1);
  }

  setDifferential(percent: number): void {
    this.module._sdEnergyDifferential(percent);
  }

  armStraight(): void {
    this.module._sdEnergyStraight(0, 1);
  }

  setBrakeBias(share: number): void {
    this.module._sdEnergyBrakeBias(share);
  }

  trackLength(): number {
    return this.module._sdTrackLength();
  }

  sectorBoundaries(): number[] {
    const pointer = this.module._malloc(16 * 8);
    const count = this.module._sdTrackSectors(pointer, 16);
    const values = Array.from(
      new Float64Array(this.module.HEAPF64.buffer, pointer, count),
    );
    this.module._free(pointer);
    const length = this.trackLength();
    return values.filter((d) => d > 0 && d < length).sort((a, b) => a - b);
  }

  trackPoint(toStart: number, toMiddle: number): [number, number, number] {
    const out = this.module._malloc(12);
    this.module._sdTrackLocal2Global(toStart, toMiddle, out);
    const point = new Float32Array(this.module.HEAPF32.buffer, out, 3);
    const result: [number, number, number] = [
      point[0] ?? 0,
      point[1] ?? 0,
      point[2] ?? 0,
    ];
    this.module._free(out);
    return result;
  }
}
