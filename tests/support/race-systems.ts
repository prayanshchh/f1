import { type SpeedDreams, startCircuit } from "./speed-dreams.ts";

export const wheelFields = 10;
const tyreFields = 44;
const energyFields = 17;

export interface Options {
  compound?: number;
  wear?: number;
  race?: boolean;
  mode?: number;
  mix?: number;
  fuel?: number;
  rain?: string;
}

export interface RaceSystems extends SpeedDreams {
  _sdTrackLength: () => number;
  _sdInputAntiLock: (on: number) => void;
  _sdTyresConfigure: (compound: number, scale: number) => void;
  _sdTyresFit: (compound: number, temperature: number, wear: number) => void;
  _sdTyresInfo: (out: number) => void;
  _sdEnergyConfigure: (
    race: number,
    mode: number,
    mix: number,
    assist: number,
  ) => void;
  _sdEnergyMode: (mode: number) => void;
  _sdPitService: (fuel: number, frontWing: number) => void;
  _sdCarStatus: (out: number) => void;
  _sdCarDamageSet: (part: number, value: number) => void;
  _sdCarImpact: (
    forward: number,
    left: number,
    dvForward: number,
    dvLeft: number,
  ) => void;
  _sdTyreDamage: (wheel: number, cut: number, flat: number) => void;
  _sdEnergyDifferential: (percent: number) => void;
  _sdEnergyStraight: (assisted: number, armed: number) => void;
  _sdEnergyFuelMix: (mix: number) => void;
  _sdEnergyOvertake: (armed: number) => void;
  _sdEnergyInfo: (out: number) => void;
  FS: {
    readFile: (path: string, options: { encoding: "utf8" }) => string;
    writeFile: (path: string, data: string) => void;
  };
}

const setupFile = "/sd/local/drivers/human/cars/revracer-26/default.xml";
const raceFile = "/sd/local/config/raceman/quickrace.xml";

export async function startRace(options: Options = {}): Promise<RaceSystems> {
  return startCircuit<RaceSystems>((m) => {
    m._sdTyresConfigure(options.compound ?? 1, options.wear ?? 1);
    m._sdEnergyConfigure(
      options.race ? 1 : 0,
      options.mode ?? 1,
      options.mix ?? 1,
      0,
    );
    if (options.fuel !== undefined)
      m.FS.writeFile(
        setupFile,
        m.FS.readFile(setupFile, { encoding: "utf8" }).replace(
          "</params>",
          `<section name="Car"><attnum name="initial fuel" unit="l" val="${String(options.fuel)}"/></section></params>`,
        ),
      );
    if (options.rain)
      m.FS.writeFile(
        raceFile,
        m.FS.readFile(raceFile, { encoding: "utf8" }).replace(
          'name="rain" val="none"',
          `name="rain" val="${options.rain}"`,
        ),
      );
  });
}

export function tyreReader(m: RaceSystems) {
  const memory = m._malloc(tyreFields * 8);
  return () => {
    m._sdTyresInfo(memory);
    const v = new Float64Array(m.HEAPF64.buffer, memory, tyreFields).slice();
    const field = (wheel: number, k: number) =>
      v[4 + wheel * wheelFields + k] ?? 0;
    return {
      compound: v[0] ?? 0,
      surface: (w: number) => field(w, 0),
      carcass: (w: number) => field(w, 1),
      pressure: (w: number) => field(w, 2),
      wear: (w: number) => field(w, 3),
      lock: (w: number) => field(w, 4),
      spin: (w: number) => field(w, 5),
      grip: (w: number) => field(w, 6),
      flat: (w: number) => field(w, 7),
      leak: (w: number) => field(w, 8),
      cut: (w: number) => field(w, 9),
    };
  };
}

export function energyReader(m: RaceSystems) {
  const memory = m._malloc(energyFields * 8);
  return () => {
    m._sdEnergyInfo(memory);
    const v = new Float64Array(m.HEAPF64.buffer, memory, energyFields).slice();
    return {
      battery: v[0] ?? 0,
      capacity: v[1] ?? 0,
      harvested: v[2] ?? 0,
      harvestLimit: v[3] ?? 0,
      motor: v[5] ?? 0,
      overtake: v[9] === 1,
      armed: v[10] === 1,
      deployLevel: v[15] ?? 0,
      straight: v[16] ?? 0,
    };
  };
}

export const speedIndex = 45;
export const lapsIndex = 49;
export const fuelIndex = 0;

export function speedOf(m: RaceSystems): number {
  return new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88)[speedIndex] ?? 0;
}

export function accelerateTo(m: RaceSystems, speed: number): void {
  for (let tick = 0; tick < 12000 && speedOf(m) < speed; tick++) {
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(1);
  }
}

export async function peakBraking(
  options: Options,
  compound: number,
  temperature: number,
  wear: number,
): Promise<number> {
  const m = await startRace({ ...options, compound });
  m._sdInputAntiLock(1);
  accelerateTo(m, 42);
  m._sdInputAnalog(1, 0, 0, 0);
  m._sdStep(10);
  m._sdTyresFit(compound, temperature, wear);
  const from = speedOf(m);
  let ticks = 0;
  m._sdInputAnalog(1, 0, 0, 1);
  while (speedOf(m) > 25 && ticks < 5000) {
    m._sdStep(1);
    ticks++;
  }
  return ticks > 0 ? (from - speedOf(m)) / (ticks * 0.002) : 0;
}

const statusFields = 19;

export function statusReader(m: RaceSystems) {
  const memory = m._malloc(statusFields * 8);
  return () => {
    m._sdCarStatus(memory);
    const v = new Float64Array(m.HEAPF64.buffer, memory, statusFields).slice();
    return {
      engine: v[0] ?? 0,
      part: (i: number) => v[1 + i] ?? 0,
      brake: (i: number) => v[12 + i] ?? 0,
      retired: v[16] ?? 0,
      stopped: v[17] === 1,
      power: v[18] ?? 0,
    };
  };
}
