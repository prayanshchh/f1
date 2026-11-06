import { MeshoptDecoder } from "meshoptimizer/decoder";

export interface ImageJob {
  kind: "image";
  id: number;
  url: string;
  alpha: string | null;
  shade: string | null;
  posterize: number;
  memory: WebAssembly.Memory;
  pointer: number;
  width: number;
  height: number;
}

export interface TrackJob {
  kind: "track";
  id: number;
  url: string;
  millimetre: number;
}

export interface DecodedMesh {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface TrackGroup {
  positions: Float32Array;
  uvs: Float32Array;
  colours: Uint32Array;
  near: Uint32Array;
  far: Uint32Array | null;
}

export interface TrackResult {
  id: number;
  groups: TrackGroup[];
  error?: string;
}

export interface ImageResult {
  id: number;
  error?: string;
}

async function pixels(
  url: string,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, width, height).data;
}

function applyAlpha(colour: Uint8ClampedArray, alpha: Uint8ClampedArray) {
  for (let i = 3; i < colour.length; i += 4) colour[i] = alpha[i - 3] ?? 255;
}

const carbonGain = 0.6;
const paletteSamples = 16384;
const paletteRounds = 10;

const decode = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const encode = Uint8Array.from({ length: 4096 }, (_, i) => {
  const v = i / 4095;
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
});

function applyCarbon(colour: Uint8ClampedArray, orm: Uint8ClampedArray) {
  for (let i = 0; i < colour.length; i += 4) {
    const gain = (1 + (carbonGain * (orm[i + 2] ?? 0)) / 255) * 4095;
    for (let c = i; c < i + 3; c++)
      colour[c] =
        encode[
          Math.min(4095, Math.round((decode[colour[c] ?? 0] ?? 0) * gain))
        ] ?? 0;
  }
}

const valueAt = (values: ArrayLike<number>, i: number): number =>
  values[i] ?? 0;

function nearestCentre(
  centres: Float64Array,
  r: number,
  g: number,
  b: number,
): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < centres.length; i += 3) {
    const d =
      (valueAt(centres, i) - r) ** 2 +
      (valueAt(centres, i + 1) - g) ** 2 +
      (valueAt(centres, i + 2) - b) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i / 3;
    }
  }
  return best;
}

function samplesOf(colour: Uint8ClampedArray): Float64Array {
  const texels = colour.length / 4;
  const step = Math.max(1, Math.floor(texels / paletteSamples));
  const count = Math.ceil(texels / step);
  const samples = new Float64Array(count * 3);
  for (let k = 0; k < count; k++)
    for (let c = 0; c < 3; c++)
      samples[k * 3 + c] = valueAt(colour, k * step * 4 + c);
  return samples;
}

function spreadCentres(samples: Float64Array, count: number): Float64Array {
  const centres = new Float64Array(count * 3);
  centres.set(samples.subarray(0, 3));
  const gap = new Float64Array(samples.length / 3).fill(Infinity);
  for (let k = 1; k < count; k++) {
    let pick = 0;
    for (let i = 0; i < gap.length; i++) {
      const from = (k - 1) * 3;
      const d = nearestGap(samples, i, centres, from);
      gap[i] = Math.min(valueAt(gap, i), d);
      if (valueAt(gap, i) > valueAt(gap, pick)) pick = i;
    }
    centres.set(samples.subarray(pick * 3, pick * 3 + 3), k * 3);
  }
  return centres;
}

function nearestGap(
  samples: Float64Array,
  i: number,
  centres: Float64Array,
  at: number,
): number {
  return (
    (valueAt(samples, i * 3) - valueAt(centres, at)) ** 2 +
    (valueAt(samples, i * 3 + 1) - valueAt(centres, at + 1)) ** 2 +
    (valueAt(samples, i * 3 + 2) - valueAt(centres, at + 2)) ** 2
  );
}

function refine(samples: Float64Array, centres: Float64Array): void {
  const sums = new Float64Array((centres.length / 3) * 4);
  for (let i = 0; i < samples.length; i += 3) {
    const k = nearestCentre(
      centres,
      valueAt(samples, i),
      valueAt(samples, i + 1),
      valueAt(samples, i + 2),
    );
    for (let c = 0; c < 3; c++)
      sums[k * 4 + c] = valueAt(sums, k * 4 + c) + valueAt(samples, i + c);
    sums[k * 4 + 3] = valueAt(sums, k * 4 + 3) + 1;
  }
  for (let k = 0; k < centres.length / 3; k++) {
    const n = valueAt(sums, k * 4 + 3);
    if (n)
      for (let c = 0; c < 3; c++)
        centres[k * 3 + c] = valueAt(sums, k * 4 + c) / n;
  }
}

function posterize(colour: Uint8ClampedArray, count: number): void {
  const samples = samplesOf(colour);
  const centres = spreadCentres(samples, count);
  for (let round = 0; round < paletteRounds; round++) refine(samples, centres);
  const lookup = new Int16Array(32768).fill(-1);
  for (let i = 0; i < colour.length; i += 4) {
    const key =
      ((valueAt(colour, i) >> 3) << 10) |
      ((valueAt(colour, i + 1) >> 3) << 5) |
      (valueAt(colour, i + 2) >> 3);
    if (valueAt(lookup, key) < 0)
      lookup[key] = nearestCentre(
        centres,
        valueAt(colour, i),
        valueAt(colour, i + 1),
        valueAt(colour, i + 2),
      );
    const k = valueAt(lookup, key) * 3;
    for (let c = 0; c < 3; c++)
      colour[i + c] = Math.round(valueAt(centres, k + c));
  }
}

async function image(job: ImageJob): Promise<void> {
  const [colour, alpha, shade] = await Promise.all([
    pixels(job.url, job.width, job.height),
    job.alpha ? pixels(job.alpha, job.width, job.height) : null,
    job.shade ? pixels(job.shade, job.width, job.height) : null,
  ]);
  if (alpha) applyAlpha(colour, alpha);
  if (shade) applyCarbon(colour, shade);
  if (job.posterize) posterize(colour, job.posterize);
  new Uint8Array(job.memory.buffer, job.pointer, colour.length).set(colour);
}

const padded = (bytes: number) => bytes + ((4 - (bytes % 4)) % 4);
const vertexSize = 20;

function group(bytes: Uint8Array, view: DataView, at: number, scale: number) {
  const count = view.getUint32(at, true);
  const nearCount = view.getUint32(at + 4, true);
  const farCount = view.getUint32(at + 8, true);
  const vertexBytes = view.getUint32(at + 12, true);
  const nearBytes = view.getUint32(at + 16, true);
  const farBytes = view.getUint32(at + 20, true);
  const uvLo = [view.getFloat32(at + 24, true), view.getFloat32(at + 28, true)];
  const uvStep = [
    view.getFloat32(at + 32, true),
    view.getFloat32(at + 36, true),
  ];
  let offset = at + 40;
  const raw = new Uint8Array(count * vertexSize);
  MeshoptDecoder.decodeVertexBuffer(
    raw,
    count,
    vertexSize,
    bytes.subarray(offset, offset + vertexBytes),
  );
  offset += padded(vertexBytes);
  const indices = (length: number, size: number) => {
    const out = new Uint32Array(length);
    MeshoptDecoder.decodeIndexBuffer(
      new Uint8Array(out.buffer),
      length,
      4,
      bytes.subarray(offset, offset + size),
    );
    offset += padded(size);
    return out;
  };
  const near = indices(nearCount, nearBytes);
  const far = farCount > 0 ? indices(farCount, farBytes) : null;
  const fields = new DataView(raw.buffer);
  const positions = new Float32Array(count * 3);
  const colours = new Uint32Array(count);
  const uvs = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    const base = v * vertexSize;
    for (let c = 0; c < 3; c++)
      positions[v * 3 + c] = fields.getInt32(base + c * 4, true) / scale;
    colours[v] = fields.getUint32(base + 12, true);
    uvs[v * 2] =
      (uvLo[0] ?? 0) + fields.getUint16(base + 16, true) * (uvStep[0] ?? 0);
    uvs[v * 2 + 1] =
      (uvLo[1] ?? 0) + fields.getUint16(base + 18, true) * (uvStep[1] ?? 0);
  }
  return { group: { positions, uvs, colours, near, far }, next: offset };
}

async function track(job: TrackJob): Promise<TrackGroup[]> {
  const response = await fetch(job.url);
  if (!response.body) throw new Error(`empty ${job.url}`);
  const buffer = await new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
  await MeshoptDecoder.ready;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const groups: TrackGroup[] = [];
  let at = 0;
  while (at < buffer.byteLength) {
    const next = group(bytes, view, at, job.millimetre);
    groups.push(next.group);
    at = next.next;
  }
  return groups;
}

self.onmessage = (event: MessageEvent<ImageJob | TrackJob>) => {
  const job = event.data;
  if (job.kind === "image") {
    image(job).then(
      () => {
        self.postMessage({ id: job.id } satisfies ImageResult);
      },
      (error: unknown) => {
        self.postMessage({
          id: job.id,
          error: String(error),
        } satisfies ImageResult);
      },
    );
    return;
  }
  track(job).then(
    (groups) => {
      const transfer = groups.flatMap((g) => [
        g.positions.buffer,
        g.uvs.buffer,
        g.colours.buffer,
        g.near.buffer,
        ...(g.far ? [g.far.buffer] : []),
      ]);
      self.postMessage({ id: job.id, groups } satisfies TrackResult, {
        transfer,
      });
    },
    (error: unknown) => {
      self.postMessage({
        id: job.id,
        groups: [],
        error: String(error),
      } satisfies TrackResult);
    },
  );
};
