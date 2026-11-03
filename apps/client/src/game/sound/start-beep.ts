export interface StartBeep {
  pitch: number;
  harmonics: (number | null)[];
  attack: number;
  decay: number;
  sustain: number;
  hold: number;
  release: number;
  gain: number;
  noise: BeepNoise;
}

interface BeepNoise {
  seed: number;
  kernel: number[];
  boost: number;
  decay: number;
  hold: number;
  release: number;
}

function gate(time: number, hold: number, release: number): number {
  return Math.min(1, Math.max(0, 1 - (time - hold) / release));
}

function toneEnvelope(beep: StartBeep, time: number): number {
  const rise = Math.min(1, time / beep.attack);
  const fall =
    time < beep.attack
      ? 1
      : beep.sustain +
        (1 - beep.sustain) * Math.exp(-(time - beep.attack) / beep.decay);
  return rise * fall * gate(time, beep.hold, beep.release);
}

function noiseEnvelope(beep: StartBeep, time: number): number {
  const { noise } = beep;
  const rise = Math.min(1, time / beep.attack);
  const after = Math.max(0, time - beep.attack);
  const fall = 1 + (noise.boost - 1) * Math.exp(-after / noise.decay);
  return rise * fall * gate(time, noise.hold, noise.release);
}

function whiteNoise(seed: number, length: number): Float64Array {
  const out = new Float64Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1) * Math.sqrt(3);
  }
  return out;
}

function hiss(noise: BeepNoise, length: number): Float64Array {
  const white = whiteNoise(noise.seed, length);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    const taps = Math.min(noise.kernel.length, i + 1);
    for (let k = 0; k < taps; k++)
      sum += (noise.kernel[k] ?? 0) * (white[i - k] ?? 0);
    out[i] = sum;
  }
  return out;
}

function tone(beep: StartBeep, length: number, sampleRate: number) {
  const wave = new Float64Array(length);
  beep.harmonics.forEach((level, index) => {
    if (level === null) return;
    const amplitude = 10 ** (level / 20);
    const step = (2 * Math.PI * beep.pitch * (index + 1)) / sampleRate;
    for (let i = 0; i < length; i++)
      wave[i] = (wave[i] ?? 0) + amplitude * Math.sin(step * i);
  });
  let peak = 0;
  for (const sample of wave) peak = Math.max(peak, Math.abs(sample));
  return wave.map((sample) => sample / peak);
}

export function renderStartBeep(
  beep: StartBeep,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  const end = Math.max(
    beep.hold + beep.release,
    beep.noise.hold + beep.noise.release,
  );
  const length = Math.floor(end * sampleRate) + 1;
  const wave = tone(beep, length, sampleRate);
  const noise = hiss(beep.noise, length);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    out[i] =
      ((wave[i] ?? 0) * toneEnvelope(beep, time) +
        (noise[i] ?? 0) * noiseEnvelope(beep, time)) *
      beep.gain;
  }
  return out;
}
