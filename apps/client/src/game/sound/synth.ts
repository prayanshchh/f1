import { OnePole, Random, type StereoBuffer } from "./dsp.ts";
import {
  BrakeVoice,
  ImpactVoice,
  KerbVoice,
  RoughVoice,
  ShiftVoice,
  TurboVoice,
  TyreVoice,
  WetVoice,
} from "./effects.ts";
import { EngineVoice, type EngineTables } from "./engine-voice.ts";

export interface SynthState {
  rpm: number;
  load: number;
  speed: number;
  gear: number;
  kerb: number;
  rough: number;
  scrub: number;
  lock: number;
  brake: number;
  impact: number;
  rain: number;
  spray: number;
  master: number;
}

export const idleState: SynthState = {
  rpm: 4160,
  load: 0,
  speed: 0,
  gear: 0,
  kerb: 0,
  rough: 0,
  scrub: 0,
  lock: 0,
  brake: 0,
  impact: 0,
  rain: 0,
  spray: 0,
  master: 0,
};

const clipStart = 0.7;
const stationarySpeed = 3;
const stationaryGain = 0.56;
const engineGain = 1.9;

function softClip(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= clipStart) return value;
  const excess = (magnitude - clipStart) / (1 - clipStart);
  const limited = clipStart + (1 - clipStart) * Math.tanh(excess);
  return value < 0 ? -limited : limited;
}

export class CarSynth {
  private readonly engine: EngineVoice;
  private readonly kerb: KerbVoice;
  private readonly rough: RoughVoice;
  private readonly tyre: TyreVoice;
  private readonly brake: BrakeVoice;
  private readonly shift: ShiftVoice;
  private readonly impact: ImpactVoice;
  private readonly turbo: TurboVoice;
  private readonly wet: WetVoice;
  private readonly rpm: OnePole;
  private readonly load: OnePole;
  private readonly speed: OnePole;
  private readonly master: OnePole;
  private readonly engineBus: Float32Array;
  private readonly sideBus: Float32Array;
  private target: SynthState = idleState;
  private gear = 0;
  private lastImpact = 0;
  private masterGain = 0;

  constructor(tables: EngineTables, sampleRate: number, blockSize = 128) {
    const random = new Random(0x2f6e2b1);
    const rate = sampleRate / blockSize;
    this.engine = new EngineVoice(tables, sampleRate, random);
    this.kerb = new KerbVoice(sampleRate, random);
    this.rough = new RoughVoice(sampleRate, random);
    this.tyre = new TyreVoice(sampleRate, random);
    this.brake = new BrakeVoice(sampleRate, random);
    this.shift = new ShiftVoice(sampleRate, random);
    this.impact = new ImpactVoice(sampleRate, random);
    this.turbo = new TurboVoice(sampleRate);
    this.wet = new WetVoice(sampleRate);
    this.rpm = new OnePole(idleState.rpm, 0.018, rate);
    this.load = new OnePole(0, 0.05, rate);
    this.speed = new OnePole(0, 0.05, rate);
    this.master = new OnePole(0, 0.04, rate);
    this.engineBus = new Float32Array(blockSize);
    this.sideBus = new Float32Array(blockSize);
  }

  set(state: SynthState): void {
    this.target = state;
  }

  private events(state: SynthState): void {
    if (state.gear !== this.gear) {
      if (this.gear !== 0 && state.gear !== 0) this.shift.trigger();
      this.gear = state.gear;
    }
    if (state.impact > this.lastImpact) this.impact.trigger(state.impact);
    this.lastImpact = state.impact;
  }

  private renderEngine(state: SynthState, speed: number): void {
    const startRpm = this.rpm.value;
    const rpm = this.rpm.step(state.rpm);
    const load = this.load.step(state.load);
    this.engineBus.fill(0);
    this.engine.render(this.engineBus, startRpm, rpm, load, speed);
    this.turbo.render(this.engineBus, load, rpm);
    const idle = speed < stationarySpeed ? stationaryGain : 1;
    const dip = this.shift.dip() * idle * engineGain;
    for (let i = 0; i < this.engineBus.length; i++)
      this.engineBus[i] = (this.engineBus[i] ?? 0) * dip;
  }

  private renderEffects(state: SynthState, speed: number): void {
    this.sideBus.fill(0);
    this.kerb.render(this.sideBus, state.kerb, speed);
    this.rough.render(this.sideBus, state.rough);
    this.tyre.render(this.sideBus, state.scrub, state.lock, speed);
    this.brake.render(this.sideBus, state.brake);
    this.impact.render(this.sideBus);
    this.wet.render(this.sideBus, state.rain, state.spray);
    this.shift.render(this.engineBus);
  }

  private mix(out: StereoBuffer, state: SynthState): void {
    const start = this.masterGain;
    this.masterGain = this.master.step(state.master);
    const step = (this.masterGain - start) / out.left.length;
    for (let i = 0; i < out.left.length; i++) {
      const gain = start + step * i;
      const value = softClip(
        gain * ((this.engineBus[i] ?? 0) + (this.sideBus[i] ?? 0)),
      );
      out.left[i] = value;
      out.right[i] = value;
    }
  }

  process(out: StereoBuffer): void {
    const state = this.target;
    this.events(state);
    const speed = this.speed.step(state.speed);
    this.renderEngine(state, speed);
    this.renderEffects(state, speed);
    this.mix(out, state);
  }
}
