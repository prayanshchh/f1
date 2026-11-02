import * as THREE from "three/webgpu";
import { float, int, sampler, texture, uniform, vec2, wgslFn } from "three/tsl";

const hashSeed = 3735928584;
const finestFrequency = 0.7;
const tableMargin = 4;
const hashLevels = 255;

function rotate(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function latticeHash(x: number, y: number): number {
  let a = (hashSeed + x) >>> 0;
  let b = (hashSeed + y) >>> 0;
  let c = hashSeed;
  c = ((c ^ b) - rotate(b, 14)) >>> 0;
  a = ((a ^ c) - rotate(c, 11)) >>> 0;
  b = ((b ^ a) - rotate(a, 25)) >>> 0;
  c = ((c ^ b) - rotate(b, 16)) >>> 0;
  a = ((a ^ c) - rotate(c, 4)) >>> 0;
  b = ((b ^ a) - rotate(a, 14)) >>> 0;
  c = ((c ^ b) - rotate(b, 24)) >>> 0;
  return c & 15;
}

const tableTexture = new THREE.DataTexture(
  new Uint8Array(1),
  1,
  1,
  THREE.RedFormat,
  THREE.UnsignedByteType,
);
tableTexture.minFilter = THREE.LinearFilter;
tableTexture.magFilter = THREE.LinearFilter;
tableTexture.generateMipmaps = false;
const tableOrigin = uniform(new THREE.Vector2());
const tableSize = uniform(new THREE.Vector2(1, 1));

export function latticeSpan(low: number, high: number): [number, number] {
  const start = Math.floor(Math.min(0, low) * finestFrequency) - tableMargin;
  const end = Math.ceil(Math.max(0, high) * finestFrequency) + tableMargin;
  return [start, end - start];
}

export function buildNoiseTable(world: THREE.Box3): void {
  const [minX, width] = latticeSpan(world.min.x, world.max.x);
  const [minY, height] = latticeSpan(world.min.y, world.max.y);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data[y * width + x] = latticeHash(minX + x, minY + y);
  tableTexture.image = { data, width, height };
  tableTexture.needsUpdate = true;
  tableOrigin.value.set(minX, minY);
  tableSize.value.set(width, height);
}

const gradient = wgslFn(`
fn flat_noise_gradient(level: f32, x: f32, y: f32) -> f32 {
  let h: u32 = u32(round(level * ${String(hashLevels)}.0));
  let u: f32 = select(y, x, h < 8u);
  let v: f32 = select(select(0.0, x, (h == 12u) || (h == 14u)), y, h < 4u);
  return select(u, -u, (h & 1u) != 0u) + select(v, -v, (h & 2u) != 0u);
}
`);

const perlin = wgslFn(
  `
fn flat_noise_perlin(p: vec2<f32>, table: texture_2d<f32>, table_sampler: sampler, origin: vec2<f32>, size: vec2<f32>) -> f32 {
  let cell: vec2<f32> = floor(p);
  let fx: f32 = p.x - cell.x;
  let fy: f32 = p.y - cell.y;
  let s: f32 = ((fx * fx) * fx) * ((fx * ((fx * 6.0) - 15.0)) + 10.0);
  let t: f32 = ((fy * fy) * fy) * ((fy * ((fy * 6.0) - 15.0)) + 10.0);
  let s1: f32 = 1.0 - s;
  let corners: vec4<f32> = textureGather(0, table, table_sampler, (cell - origin + vec2<f32>(1.0)) / size);
  let v0: f32 = flat_noise_gradient(corners.w, fx, fy);
  let v1: f32 = flat_noise_gradient(corners.z, fx - 1.0, fy);
  let v2: f32 = flat_noise_gradient(corners.x, fx, fy - 1.0);
  let v3: f32 = flat_noise_gradient(corners.y, fx - 1.0, fy - 1.0);
  return 0.982 * (((1.0 - t) * ((v0 * s1) + (v1 * s))) + (t * ((v2 * s1) + (v3 * s))));
}
`,
  [gradient] as never[],
);

const fractal = wgslFn(
  `
fn flat_noise_fractal(start: vec2<f32>, octaves: i32, table: texture_2d<f32>, table_sampler: sampler, origin: vec2<f32>, size: vec2<f32>) -> f32 {
  var total: f32 = 0.0;
  var amplitude: f32 = 1.0;
  var p: vec2<f32> = start;
  for (var i: i32 = 0; i < octaves; i++) {
    total = total + (amplitude * flat_noise_perlin(p, table, table_sampler, origin, size));
    amplitude = amplitude * 0.5;
    p = p * vec2<f32>(2.0);
  }
  return total;
}
`,
  [perlin] as never[],
);

export function flatNoise(
  position: THREE.Node,
  octaves: number,
): THREE.Node<"float"> {
  return float(
    fractal({
      start: position,
      octaves: int(octaves),
      table: texture(tableTexture),
      table_sampler: sampler(tableTexture),
      origin: vec2(tableOrigin),
      size: vec2(tableSize),
    }) as THREE.Node<"float">,
  );
}
