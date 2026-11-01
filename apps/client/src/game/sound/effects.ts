import { BandPass, OnePole, type Random, sine, sineMask } from "./dsp.ts";

const kerbWavelength = 0.565;
const kerbHarmonics = [
  { multiple: 1, gain: 0.052 },
  { multiple: 2, gain: 0.021 },
  { multiple: 3, gain: 0.006 },
];
const kerbRumbleGain = 1;
const roughGain = 0.65;
const scrubGain = 0.15;
const lockGain = 0.33;
const brakeGain = 0.008;
const clickGain = 0.32;
const impactGain = 1.6;
const blockRate = (sampleRate: number) => sampleRate / 128;

export class KerbVoice {
  private readonly level: OnePole;
  private readonly rumble: BandPass;
  private readonly phases = kerbHarmonics.map(() => 0);
  private readonly sampleRate: number;
  private readonly random: Random;
  private gain = 0;

  constructor(sampleRate: number, random: Random) {
    this.sampleRate = sampleRate;
    this.random = random;
    this.level = new OnePole(0, 0.018, blockRate(sampleRate));
    this.rumble = new BandPass(55, 1.1, sampleRate);
  }

  render(out: Float32Array, amount: number, speed: number): void {
    const start = this.gain;
    this.gain = this.level.step(amount);
    const step = (this.gain - start) / out.length;
    const increment = speed / kerbWavelength / this.sampleRate;
    for (let i = 0; i < out.length; i++) {
      const gain = start + step * i;
      let value = this.rumble.tick(this.random.next()) * kerbRumbleGain;
      kerbHarmonics.forEach((harmonic, h) => {
        const phase = (this.phases[h] ?? 0) + increment * harmonic.multiple;
        this.phases[h] = phase - Math.floor(phase);
        value += harmonic.gain * (sine[(phase * 16384) & sineMask] ?? 0) * 8;
      });
      out[i] = (out[i] ?? 0) + gain * value;
    }
  }
}

export class RoughVoice {
  private readonly level: OnePole;
  private readonly low: BandPass;
  private readonly mid: BandPass;
  private readonly random: Random;
  private gain = 0;

  constructor(sampleRate: number, random: Random) {
    this.random = random;
    this.level = new OnePole(0, 0.03, blockRate(sampleRate));
    this.low = new BandPass(120, 0.9, sampleRate);
    this.mid = new BandPass(620, 0.8, sampleRate);
  }

  render(out: Float32Array, amount: number): void {
    const start = this.gain;
    this.gain = this.level.step(amount);
    const step = (this.gain - start) / out.length;
    for (let i = 0; i < out.length; i++) {
      const noise = this.random.next();
      const value = this.low.tick(noise) + 0.6 * this.mid.tick(noise);
      out[i] = (out[i] ?? 0) + (start + step * i) * roughGain * value;
    }
  }
}

export class TyreVoice {
  private readonly scrubLevel: OnePole;
  private readonly lockLevel: OnePole;
  private readonly scrub: BandPass[];
  private readonly lock: BandPass[];
  private readonly random: Random;
  private readonly sampleRate: number;
  private scrubGainNow = 0;
  private lockGainNow = 0;
  private spot = 0;

  constructor(sampleRate: number, random: Random) {
    this.random = random;
    this.sampleRate = sampleRate;
    this.scrubLevel = new OnePole(0, 0.05, blockRate(sampleRate));
    this.lockLevel = new OnePole(0, 0.025, blockRate(sampleRate));
    this.scrub = [1150, 2350, 4300].map(
      (frequency) => new BandPass(frequency, 2.4, sampleRate),
    );
    this.lock = [720, 1560, 2980].map(
      (frequency) => new BandPass(frequency, 11, sampleRate),
    );
  }

  private sum(filters: BandPass[], noise: number): number {
    let value = 0;
    for (const filter of filters) value += filter.tick(noise);
    return value;
  }

  render(out: Float32Array, scrub: number, lock: number, speed: number): void {
    const scrubStart = this.scrubGainNow;
    const lockStart = this.lockGainNow;
    this.scrubGainNow = this.scrubLevel.step(scrub);
    this.lockGainNow = this.lockLevel.step(lock);
    const n = out.length;
    const scrubStep = (this.scrubGainNow - scrubStart) / n;
    const lockStep = (this.lockGainNow - lockStart) / n;
    const spotStep = speed / (2 * Math.PI * 0.34) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      const noise = this.random.next();
      this.spot = (this.spot + spotStep) % 1;
      const judder = 0.72 + 0.28 * (sine[(this.spot * 16384) & sineMask] ?? 0);
      const scrubbed = this.sum(this.scrub, noise) * scrubGain;
      const locked = this.sum(this.lock, noise) * lockGain * judder;
      out[i] =
        (out[i] ?? 0) +
        (scrubStart + scrubStep * i) * scrubbed +
        (lockStart + lockStep * i) * locked * 3;
    }
  }
}

export class BrakeVoice {
  private readonly level: OnePole;
  private readonly band: BandPass;
  private readonly random: Random;
  private gain = 0;

  constructor(sampleRate: number, random: Random) {
    this.random = random;
    this.level = new OnePole(0, 0.06, blockRate(sampleRate));
    this.band = new BandPass(3400, 0.8, sampleRate);
  }

  render(out: Float32Array, amount: number): void {
    const start = this.gain;
    this.gain = this.level.step(amount);
    const step = (this.gain - start) / out.length;
    for (let i = 0; i < out.length; i++) {
      out[i] =
        (out[i] ?? 0) +
        (start + step * i) * brakeGain * this.band.tick(this.random.next()) * 6;
    }
  }
}

export class ShiftVoice {
  private readonly click: BandPass;
  private readonly random: Random;
  private readonly clickDecay: number;
  private readonly dipDecay: number;
  private clickLevel = 0;
  private dipLevel = 0;

  constructor(sampleRate: number, random: Random) {
    this.random = random;
    this.click = new BandPass(2600, 0.7, sampleRate);
    this.clickDecay = Math.exp(-1 / (0.006 * sampleRate));
    this.dipDecay = Math.exp(-128 / (0.11 * sampleRate));
  }

  trigger(): void {
    this.clickLevel = 1;
    this.dipLevel = 1;
  }

  dip(): number {
    this.dipLevel *= this.dipDecay;
    return Math.pow(10, (-1 * this.dipLevel) / 20);
  }

  render(out: Float32Array): void {
    if (this.clickLevel < 1e-4) return;
    for (let i = 0; i < out.length; i++) {
      this.clickLevel *= this.clickDecay;
      out[i] =
        (out[i] ?? 0) +
        this.clickLevel * clickGain * this.click.tick(this.random.next());
    }
  }
}

export class ImpactVoice {
  private readonly thud: BandPass;
  private readonly crunch: BandPass;
  private readonly random: Random;
  private readonly decay: number;
  private level = 0;

  constructor(sampleRate: number, random: Random) {
    this.random = random;
    this.thud = new BandPass(70, 0.9, sampleRate);
    this.crunch = new BandPass(1300, 0.6, sampleRate);
    this.decay = Math.exp(-1 / (0.13 * sampleRate));
  }

  trigger(strength: number): void {
    this.level = Math.max(this.level, Math.min(1, strength));
  }

  render(out: Float32Array): void {
    if (this.level < 1e-4) return;
    for (let i = 0; i < out.length; i++) {
      this.level *= this.decay;
      const noise = this.random.next();
      const value = this.thud.tick(noise) * 2.4 + this.crunch.tick(noise);
      out[i] = (out[i] ?? 0) + this.level * impactGain * value;
    }
  }
}

const spoolFloor = 4150;
const spoolCeiling = 5461;
const spoolSeconds = 2.45;
const liftSeconds = 1.5;
const liftJump = 1.23;
const bladeRatio = 5 / 3;
const compressorGain = 0.0164;
const turbineGain = 0.0044;
const liftFrom = 0.6;
const liftTo = 0.2;
const liftHoldSeconds = 0.15;
const whistleSeconds = 1.5;
const whistleTurbine = 2.2;
const whistleCompressor = 0.45;
const turboStartRpm = 6000;
const turboFullRpm = 9000;

export class TurboVoice {
  private readonly sampleRate: number;
  private readonly glide: OnePole;
  private readonly level: OnePole;
  private readonly spoolUp: number;
  private readonly spoolDown: number;
  private readonly liftBlocks: number;
  private readonly whistleDecay: number;
  private whistle = 0;
  private lifted = 0;
  private spool = spoolFloor;
  private primed = false;
  private gain = 0;
  private lowPhase = 0;
  private highPhase = 0;

  constructor(sampleRate: number) {
    const rate = blockRate(sampleRate);
    this.sampleRate = sampleRate;
    this.glide = new OnePole(spoolFloor, 0.04, rate);
    this.level = new OnePole(0, 0.15, rate);
    this.spoolUp = 1 - Math.exp(-1 / (spoolSeconds * rate));
    this.spoolDown = 1 - Math.exp(-1 / (liftSeconds * rate));
    this.liftBlocks = liftHoldSeconds * rate;
    this.whistleDecay = Math.exp(-1 / (whistleSeconds * rate));
  }

  private advance(load: number): void {
    if (load >= liftFrom) this.primed = true;
    this.lifted = load <= liftTo ? this.lifted + 1 : 0;
    const coasting = this.lifted >= this.liftBlocks;
    if (coasting && this.primed) {
      this.primed = false;
      this.spool *= liftJump;
      this.whistle = 1;
    }
    this.whistle = coasting ? this.whistle * this.whistleDecay : 0;
    const target = coasting
      ? spoolFloor
      : spoolFloor + (spoolCeiling - spoolFloor) * load;
    this.spool +=
      (target - this.spool) * (coasting ? this.spoolDown : this.spoolUp);
  }

  render(out: Float32Array, load: number, rpm: number): void {
    this.advance(load);
    const span = (rpm - turboStartRpm) / (turboFullRpm - turboStartRpm);
    const start = this.gain;
    this.gain = this.level.step(Math.max(0, Math.min(1, span)));
    const step = (this.gain - start) / out.length;
    const low = this.glide.step(this.spool) / this.sampleRate;
    const high = low * bladeRatio;
    const lowGain =
      compressorGain * (1 + (whistleCompressor - 1) * this.whistle);
    const highGain = turbineGain * (1 + (whistleTurbine - 1) * this.whistle);
    for (let i = 0; i < out.length; i++) {
      this.lowPhase = (this.lowPhase + low) % 1;
      this.highPhase = (this.highPhase + high) % 1;
      const tone =
        lowGain * (sine[(this.lowPhase * 16384) & sineMask] ?? 0) +
        highGain * (sine[(this.highPhase * 16384) & sineMask] ?? 0);
      out[i] = (out[i] ?? 0) + (start + step * i) * tone;
    }
  }
}
