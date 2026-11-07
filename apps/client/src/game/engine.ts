import createSpeedDreams, {
  type SpeedDreamsModule,
} from "../../wasm/speed-dreams.js";
import type { WeekendPlan } from "./weekend.ts";
import type { EnergyInfo } from "./energy.ts";
import type { CarStatus } from "./mfd.ts";
import type { TyreInfo } from "./tyres.ts";
import type { WeatherInfo } from "./weather.ts";
import type { SetupSource } from "./settings.ts";
import type { CarAudio } from "./sound/sound-state.ts";
import type { TrackLocal } from "./sky.ts";
import {
  carFields,
  messageFields,
  parseCar,
  parseMessages,
  type StewardCar,
  type StewardMessage,
} from "./stewards.ts";

export { carField, carStride, carWheel, frameIndex } from "./frame-layout.ts";
import { carStride, frameIndex } from "./frame-layout.ts";
import type { Pass } from "./highlights.ts";

const telemetrySize = 40;
const weatherFields = 13;
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
  dynamicWeather: boolean;
  weatherSeed: number;
  compound: number;
  wearScale: number;
  isRace: boolean;
  ersMode: number;
  fuelMix: number;
  ersAssist: boolean;
  straightAssist: boolean;
  countdown: number;
  lightInterval: number;
  rules: RaceRules;
}

interface RaceRules {
  safetyCar: number;
  redFlags: boolean;
  rollingStart: boolean;
  interventions: boolean;
}

export interface RaceControlInfo {
  state: number;
  safetyCarShown: boolean;
  signalTime: number;
  countdown: number;
  delta: number;
  redSectors: number;
  suspendedLeft: number;
  lineups: number;
  safetyCarLights: boolean;
  vscEndingLeft: number;
  restarts: number;
  caught: boolean;
}

export interface SessionPlan {
  kind: SessionKind;
  laps: number;
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
  toRun: number;
  totalLaps: number;
  startDelay: number;
  chequered: boolean;
  leaderLaps: number;
  invalidLap: boolean;
  offTracks: number;
  playerRun: number;
  onTrack: number;
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
  disqualified: boolean;
  finishTime: number;
  eliminated: boolean;
  contacts: number;
  progress: number;
  overtake: boolean;
  inPit: boolean;
  segments: number[];
}

const timingStride = 20;
const sessionFields = 12;
const practiceGridSlot = 1;
const messageBatch = 32;
const passBatch = 32;
const passFields = 5;
const raceControlFields = 16;
const marshalSectors = 24;

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
    for (const stint of entrant.stints)
      module._sdFieldStint(index, stint.compound, stint.from);
  });
  module._sdSessionConfigure(plan.kind, plan.laps, plan.difficulty, plan.seed);
  module._sdSessionReference(plan.reference);
}

function configureRules(module: SpeedDreamsModule, race: RaceSystems): void {
  module._sdStewardsLights(race.lightInterval);
  module._sdRaceControlConfigure(
    race.rules.safetyCar,
    race.rules.redFlags ? 1 : 0,
    race.rules.rollingStart ? 1 : 0,
  );
  module._sdRaceControlInterventions(race.rules.interventions ? 1 : 0);
}

export class Engine {
  private carsMemory = 0;
  private timingMemory = 0;
  private sessionMemory = 0;
  private qualifyingMemory = 0;
  private damageMemory = 0;
  private passMemory = 0;

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
    else module._sdPracticeGridSlot(practiceGridSlot);
    module._sdRaceCountdown(race.countdown);
    configureRules(module, race);
    module._sdInputAssist(assist ? 1 : 0);
    module._sdInputAntiLock(antiLock ? 1 : 0);
    module._sdTyresConfigure(race.compound, race.wearScale);
    module._sdWeatherConfigure(race.dynamicWeather ? 1 : 0, race.weatherSeed);
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
      toRun: at(3),
      totalLaps: at(4),
      startDelay: at(5),
      chequered: at(6) !== 0,
      leaderLaps: at(7),
      invalidLap: at(8) !== 0,
      offTracks: at(9),
      playerRun: at(10),
      onTrack: at(11),
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
        retired: at(12) === 2 || at(12) === 3,
        disqualified: at(12) === 3,
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

  stewardMessages(after: number): StewardMessage[] {
    const pointer = this.module._malloc(messageBatch * messageFields * 8);
    const found: StewardMessage[] = [];
    let last = after;
    for (;;) {
      const count = this.module._sdStewardsMessages(
        pointer,
        messageBatch,
        last,
      );
      const batch = parseMessages(
        new Float64Array(
          this.module.HEAPF64.buffer,
          pointer,
          count * messageFields,
        ).slice(),
      );
      found.push(...batch);
      last = batch.at(-1)?.id ?? last;
      if (count < messageBatch) break;
    }
    this.module._free(pointer);
    return found;
  }

  raceControl(): RaceControlInfo {
    const v = this.doubles(raceControlFields, (p) => {
      this.module._sdRaceControlInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      state: at(0),
      safetyCarShown: at(1) !== 0,
      signalTime: at(4),
      countdown: at(5),
      delta: at(6),
      redSectors: at(7),
      suspendedLeft: at(9),
      lineups: at(10),
      safetyCarLights: at(11) !== 0,
      vscEndingLeft: at(12),
      restarts: at(14),
      caught: at(15) !== 0,
    };
  }

  safetyCarPose(): number[] | null {
    const pointer = this.module._malloc(16 * 8);
    const shown = this.module._sdSafetyCarPose(pointer) !== 0;
    const pose = Array.from(
      new Float64Array(this.module.HEAPF64.buffer, pointer, 16),
    );
    this.module._free(pointer);
    return shown ? pose : null;
  }

  stewardCar(index: number): StewardCar {
    return parseCar(
      this.doubles(carFields, (p) => {
        this.module._sdStewardsCar(index, p);
      }),
    );
  }

  stewardFlags(): number[] {
    return this.doubles(marshalSectors, (p) => {
      this.module._sdStewardsFlags(p, marshalSectors);
    });
  }

  grid(): number[] {
    const pointer = this.module._malloc(this.carCount * 4);
    const count = this.module._sdSessionGrid(pointer);
    const order = Array.from(
      new Int32Array(this.module.HEAPF64.buffer, pointer, count),
    );
    this.module._free(pointer);
    return order;
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

  queuePlayerRun(): boolean {
    return this.module._sdSessionPlayerRun() !== 0;
  }

  timeScale(scale: number): void {
    this.module._sdTimeScale(scale);
  }

  slowPlayer(speed: number): void {
    this.module._sdPlayerSlowTo(speed);
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

  pitService(fuel: number, frontWing: boolean): void {
    this.module._sdPitService(fuel, frontWing ? 1 : 0);
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

  carsDamage(): Float64Array {
    const parts = 11;
    this.damageMemory ||= this.module._malloc(this.carCount * parts * 8);
    const count = this.module._sdCarsDamage(this.damageMemory);
    return new Float64Array(
      this.module.HEAPF64.buffer,
      this.damageMemory,
      this.carCount * count,
    ).slice();
  }

  passes(from: number): { total: number; list: Pass[] } {
    this.passMemory ||= this.module._malloc(passBatch * passFields * 8);
    const total = this.module._sdSessionPasses(
      this.passMemory,
      passBatch,
      from,
    );
    const count = Math.max(0, Math.min(passBatch, total - from));
    const v = new Float64Array(
      this.module.HEAPF64.buffer,
      this.passMemory,
      count * passFields,
    );
    const list = Array.from({ length: count }, (_, k): Pass => {
      const at = (i: number) => v[k * passFields + i] ?? 0;
      return {
        time: at(0),
        passer: at(1),
        passed: at(2),
        position: at(3),
        lap: at(4),
      };
    });
    return { total, list };
  }

  heap(): Uint8Array {
    return new Uint8Array(this.module.HEAPF64.buffer);
  }

  resync(now: number): void {
    this.resume(now);
    this.module._sdInputRelease();
  }

  resume(now: number): void {
    this.module._sdResync(now);
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

  weather(): WeatherInfo {
    const v = this.doubles(weatherFields, (p) => {
      this.module._sdWeatherInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      rain: at(0),
      lineWater: at(1),
      offWater: at(2),
      carWater: at(3),
      clock: at(4),
      slickLimit: at(5),
      interLimit: at(6),
      forecast: v.slice(7, weatherFields),
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
      rain: 0,
      water: 0,
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
    const v = this.doubles(64, (p) => {
      this.module._sdTyresInfo(p);
    });
    const at = (i: number) => v[i] ?? 0;
    return {
      compound: at(0),
      age: at(1),
      low: at(2),
      high: at(3),
      wheels: [0, 1, 2, 3].map((i) => {
        const o = 4 + i * 15;
        return {
          surface: at(o),
          carcass: at(o + 1),
          pressure: at(o + 2),
          wear: at(o + 3),
          lock: at(o + 4),
          spin: at(o + 5),
          grip: at(o + 6),
          flat: at(o + 7),
          leak: at(o + 8),
          cut: at(o + 9),
          dirt: at(o + 10),
          gravel: at(o + 11),
          flatAt: at(o + 12),
          shred: at(o + 13),
          water: at(o + 14),
        };
      }),
    };
  }

  carStatus(): CarStatus {
    const v = this.doubles(19, (p) => {
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
        suspension: [0, 1, 2, 3].map((i) => at(8 + i)),
      },
      brakes: [0, 1, 2, 3].map((i) => at(12 + i)),
      retired: at(16),
      stopped: at(17) !== 0,
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
