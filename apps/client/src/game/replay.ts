import { carField, carStride, frameIndex } from "./frame-layout.ts";

export const tapeRate = 30;
const tapeSeconds = 180;
const frameWheelStride = 7;
const carWheelStride = 6;
const carWheelsFrom = 16;
const angleSlots = [3, 4, 5];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function blendPose(
  a: Float32Array,
  b: Float32Array,
  from: number,
  out: Float64Array,
  to: number,
  t: number,
): void {
  for (let k = 0; k < 16; k++)
    out[to + k] = lerp(a[from + k] ?? 0, b[from + k] ?? 0, t);
  for (let column = 0; column < 3; column++) {
    const at = to + column * 4;
    const x = out[at] ?? 0;
    const y = out[at + 1] ?? 0;
    const z = out[at + 2] ?? 0;
    const size = Math.hypot(x, y, z) || 1;
    out[at] = x / size;
    out[at + 1] = y / size;
    out[at + 2] = z / size;
  }
}

function blendWheels(
  a: Float32Array,
  b: Float32Array,
  from: number,
  out: Float64Array,
  to: number,
  stride: number,
  t: number,
): void {
  for (let w = 0; w < 4; w++)
    for (let k = 0; k < stride; k++) {
      const i = w * stride + k;
      const x = a[from + i] ?? 0;
      const y = b[from + i] ?? 0;
      out[to + i] = angleSlots.includes(k) ? lerpAngle(x, y, t) : lerp(x, y, t);
    }
}

function blendFrame(
  a: Float32Array,
  b: Float32Array,
  out: Float64Array,
  t: number,
): void {
  for (let k = 0; k < frameIndex.size; k++)
    out[k] = lerp(a[k] ?? 0, b[k] ?? 0, t);
  blendPose(a, b, frameIndex.posMat, out, frameIndex.posMat, t);
  blendWheels(
    a,
    b,
    frameIndex.wheels,
    out,
    frameIndex.wheels,
    frameWheelStride,
    t,
  );
}

function blendCar(
  a: Float32Array,
  b: Float32Array,
  out: Float64Array,
  car: number,
  t: number,
): void {
  const base = car * carStride;
  for (let k = 0; k < carStride; k++)
    out[base + k] = lerp(a[base + k] ?? 0, b[base + k] ?? 0, t);
  blendPose(a, b, base, out, base, t);
  const wheels = base + carWheelsFrom;
  blendWheels(a, b, wheels, out, wheels, carWheelStride, t);
  const nearest = t < 0.5 ? a : b;
  for (const k of [carField.compound, carField.visible])
    out[base + k] = nearest[base + k] ?? 0;
}

export class ReplayTape {
  private readonly capacity: number;
  private readonly times: Float64Array;
  private readonly frames: Float32Array[];
  private readonly cars: Float32Array[];
  private head = 0;
  private count = 0;
  private lastTime = -Infinity;

  constructor(
    readonly carCount: number,
    seconds = tapeSeconds,
  ) {
    this.capacity = Math.ceil(tapeRate * seconds) + 1;
    this.times = new Float64Array(this.capacity);
    this.frames = Array.from(
      { length: this.capacity },
      () => new Float32Array(frameIndex.size),
    );
    this.cars = Array.from(
      { length: this.capacity },
      () => new Float32Array(carCount * carStride),
    );
  }

  get start(): number {
    return this.count === 0 ? 0 : (this.times[this.slot(0)] ?? 0);
  }

  get end(): number {
    return this.count === 0 ? 0 : (this.times[this.slot(this.count - 1)] ?? 0);
  }

  get empty(): boolean {
    return this.count < 2;
  }

  private slot(index: number): number {
    return (this.head + index) % this.capacity;
  }

  private append(time: number): number {
    this.lastTime = time;
    const at = this.slot(this.count);
    if (this.count === this.capacity)
      this.head = (this.head + 1) % this.capacity;
    else this.count++;
    this.times[at] = time;
    return at;
  }

  record(frame: Float64Array, cars: Float64Array | null): void {
    const time = frame[frameIndex.time] ?? 0;
    if (time < this.lastTime) this.cut(time);
    if (time - this.lastTime < 1 / tapeRate - 1e-6) return;
    const at = this.append(time);
    this.frames[at]?.set(frame.subarray(0, frameIndex.size));
    if (cars) this.cars[at]?.set(cars.subarray(0, this.carCount * carStride));
  }

  copy(from: number, to: number): ReplayTape {
    const first = this.find(from);
    const last = this.find(to);
    const clip = new ReplayTape(this.carCount, (last - first + 1) / tapeRate);
    for (let i = first; i <= last && this.count > 0; i++) {
      const source = this.slot(i);
      const at = clip.append(this.times[source] ?? 0);
      const frame = this.frames[source];
      const cars = this.cars[source];
      if (frame) clip.frames[at]?.set(frame);
      if (cars) clip.cars[at]?.set(cars);
    }
    return clip;
  }

  cut(after: number): void {
    while (
      this.count > 0 &&
      (this.times[this.slot(this.count - 1)] ?? 0) > after
    )
      this.count--;
    this.lastTime = this.count > 0 ? this.end : -Infinity;
  }

  private find(time: number): number {
    let low = 0;
    let high = this.count - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.times[this.slot(mid)] ?? 0) <= time) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  sample(time: number, frame: Float64Array, cars: Float64Array): boolean {
    if (this.empty) return false;
    const clamped = Math.max(this.start, Math.min(this.end, time));
    const i = this.find(clamped);
    const j = Math.min(this.count - 1, i + 1);
    const ta = this.times[this.slot(i)] ?? 0;
    const tb = this.times[this.slot(j)] ?? 0;
    const t = tb > ta ? (clamped - ta) / (tb - ta) : 0;
    const fa = this.frames[this.slot(i)];
    const fb = this.frames[this.slot(j)];
    const ca = this.cars[this.slot(i)];
    const cb = this.cars[this.slot(j)];
    if (!fa || !fb || !ca || !cb) return false;
    blendFrame(fa, fb, frame, t);
    frame[frameIndex.time] = clamped;
    for (let c = 0; c < this.carCount; c++) blendCar(ca, cb, cars, c, t);
    return true;
  }
}
