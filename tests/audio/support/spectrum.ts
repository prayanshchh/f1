function at(values: Float64Array, index: number): number {
  return values[index] ?? 0;
}

function swap(values: Float64Array, a: number, b: number): void {
  const held = at(values, a);
  values[a] = at(values, b);
  values[b] = held;
}

function reverseBits(real: Float64Array, imaginary: Float64Array): void {
  const size = real.length;
  for (let index = 1, mirrored = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; mirrored & bit; bit >>= 1) {
      mirrored ^= bit;
    }
    mirrored ^= bit;
    if (index < mirrored) {
      swap(real, index, mirrored);
      swap(imaginary, index, mirrored);
    }
  }
}

function butterfly(
  real: Float64Array,
  imaginary: Float64Array,
  a: number,
  b: number,
  angle: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const re = at(real, b) * cos - at(imaginary, b) * sin;
  const im = at(real, b) * sin + at(imaginary, b) * cos;
  real[b] = at(real, a) - re;
  imaginary[b] = at(imaginary, a) - im;
  real[a] = at(real, a) + re;
  imaginary[a] = at(imaginary, a) + im;
}

function fft(real: Float64Array, imaginary: Float64Array): void {
  reverseBits(real, imaginary);
  const size = real.length;
  for (let length = 2; length <= size; length <<= 1) {
    const step = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let offset = 0; offset < length / 2; offset += 1) {
        butterfly(
          real,
          imaginary,
          start + offset,
          start + offset + length / 2,
          step * offset,
        );
      }
    }
  }
}

interface Spectrum {
  magnitudes: Float64Array;
  binHz: number;
}

function spectrum(
  samples: Float32Array,
  rate: number,
  from: number,
  to: number,
): Spectrum {
  const start = Math.floor(from * rate);
  const length = Math.floor((to - from) * rate);
  const size = 2 ** Math.ceil(Math.log2(length * 4));
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < length; index += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (length - 1));
    real[index] = (samples[start + index] ?? 0) * hann;
  }
  fft(real, imaginary);
  const magnitudes = new Float64Array(size / 2);
  for (let bin = 0; bin < size / 2; bin += 1) {
    magnitudes[bin] = Math.hypot(real[bin] ?? 0, imaginary[bin] ?? 0);
  }
  return { magnitudes, binHz: rate / size };
}

function magnitudeAt(result: Spectrum, hz: number): number {
  return result.magnitudes[Math.round(hz / result.binHz)] ?? 0;
}

export function fundamental(
  samples: Float32Array,
  rate: number,
  from: number,
  to: number,
): number {
  const result = spectrum(samples, rate, from, to);
  let best = { hz: 0, score: Number.NEGATIVE_INFINITY };
  for (let hz = 80; hz <= 1200; hz += result.binHz / 2) {
    let score = 0;
    for (let harmonic = 1; harmonic <= 4; harmonic += 1) {
      score += Math.log(magnitudeAt(result, hz * harmonic) + 1e-9);
    }
    if (score > best.score) {
      best = { hz, score };
    }
  }
  return best.hz;
}

export function rms(
  samples: Float32Array,
  rate: number,
  from: number,
  to: number,
): number {
  const slice = samples.subarray(
    Math.floor(from * rate),
    Math.floor(to * rate),
  );
  let total = 0;
  for (const value of slice) {
    total += value * value;
  }
  return Math.sqrt(total / Math.max(1, slice.length));
}

export function bandEnergy(
  samples: Float32Array,
  rate: number,
  from: number,
  to: number,
  low: number,
  high: number,
): number {
  const result = spectrum(samples, rate, from, to);
  let total = 0;
  for (
    let bin = Math.ceil(low / result.binHz);
    bin <= Math.floor(high / result.binHz);
    bin += 1
  ) {
    total += (result.magnitudes[bin] ?? 0) ** 2;
  }
  return total;
}

export function centroid(
  samples: Float32Array,
  rate: number,
  from: number,
  to: number,
): number {
  const result = spectrum(samples, rate, from, to);
  let weighted = 0;
  let total = 0;
  for (const [bin, magnitude] of result.magnitudes.entries()) {
    weighted += bin * result.binHz * magnitude;
    total += magnitude;
  }
  return weighted / total;
}
