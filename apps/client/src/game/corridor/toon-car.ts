import * as THREE from "three/webgpu";

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface FlatMesh {
  positions: Float32Array;
  normals: Float32Array;
  colours: Uint32Array;
  indices: Uint32Array;
}

export interface Swatch {
  pixels: Uint8Array;
  size: number;
}

const vividSaturation = 0.4;
const vividLightness = 0.45;
const slenderLength = 0.25;
const slenderWidth = 0.07;
const smallPart = 0.3;
const smoothRadius = 2;
const smoothPasses = 2;
const swatchTaps = [
  [1 / 3, 1 / 3, 1 / 3],
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
  [1 / 6, 1 / 6, 2 / 3],
];

const at = (values: ArrayLike<number>, i: number): number => values[i] ?? 0;

function packColour(r: number, g: number, b: number): number {
  return (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
}

export function srgbColour(colour: THREE.Color): number {
  const srgb = colour.clone().convertLinearToSRGB();
  return packColour(
    Math.round(srgb.r * 255),
    Math.round(srgb.g * 255),
    Math.round(srgb.b * 255),
  );
}

export function flatMesh(
  data: GeometryData,
  colourOf: (triangle: number) => number,
  keep: Uint8Array | null = null,
): FlatMesh {
  const triangles: number[] = [];
  for (let t = 0; t < data.indices.length / 3; t++)
    if (!keep || keep[t]) triangles.push(t);
  const positions = new Float32Array(triangles.length * 9);
  const normals = new Float32Array(triangles.length * 9);
  const colours = new Uint32Array(triangles.length * 3);
  triangles.forEach((t, k) => {
    const colour = colourOf(t);
    for (let j = 0; j < 3; j++) {
      const v = at(data.indices, t * 3 + j);
      positions.set(data.positions.subarray(v * 3, v * 3 + 3), (k * 3 + j) * 3);
      normals.set(data.normals.subarray(v * 3, v * 3 + 3), (k * 3 + j) * 3);
      colours[k * 3 + j] = colour;
    }
  });
  return {
    positions,
    normals,
    colours,
    indices: Uint32Array.from({ length: triangles.length * 3 }, (_, i) => i),
  };
}

const vivid = new Map<number, number>();

function cartoon(colour: number): number {
  const known = vivid.get(colour);
  if (known !== undefined) return known;
  const c = new THREE.Color().setRGB(
    (colour & 255) / 255,
    ((colour >> 8) & 255) / 255,
    ((colour >> 16) & 255) / 255,
    THREE.LinearSRGBColorSpace,
  );
  const hsl = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.LinearSRGBColorSpace);
  if (hsl.s > vividSaturation && hsl.l < vividLightness)
    c.setHSL(hsl.h, hsl.s, vividLightness, THREE.LinearSRGBColorSpace);
  const out = packColour(
    Math.round(c.r * 255),
    Math.round(c.g * 255),
    Math.round(c.b * 255),
  );
  vivid.set(colour, out);
  return out;
}

function swatchAt(swatch: Swatch, u: number, v: number): number {
  const wrap = (x: number) => x - Math.floor(x);
  const x = Math.min(swatch.size - 1, Math.floor(wrap(u) * swatch.size));
  const y = Math.min(swatch.size - 1, Math.floor(wrap(v) * swatch.size));
  const i = (y * swatch.size + x) * 4;
  return cartoon(
    packColour(
      at(swatch.pixels, i),
      at(swatch.pixels, i + 1),
      at(swatch.pixels, i + 2),
    ),
  );
}

export function liveryColour(
  swatch: Swatch,
  data: GeometryData,
): (triangle: number) => number {
  return (t) => {
    const corners = [0, 1, 2].map((j) => at(data.indices, t * 3 + j));
    const votes = new Map<number, number>();
    let best = 0;
    let most = 0;
    for (const weights of swatchTaps) {
      let u = 0;
      let v = 0;
      corners.forEach((corner, j) => {
        u += at(weights, j) * at(data.uvs, corner * 2);
        v += at(weights, j) * at(data.uvs, corner * 2 + 1);
      });
      const colour = swatchAt(swatch, u, v);
      const count = (votes.get(colour) ?? 0) + 1;
      votes.set(colour, count);
      if (count > most) {
        most = count;
        best = colour;
      }
    }
    return best;
  };
}

function groupsOf(data: GeometryData): Int32Array {
  const count = data.positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (at(parent, root) !== root) {
      parent[root] = at(parent, at(parent, root));
      root = at(parent, root);
    }
    return root;
  };
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const seen = new Map<string, number>();
  for (let v = 0; v < count; v++) {
    const key = [0, 1, 2]
      .map((c) => Math.round(at(data.positions, v * 3 + c) * 1000))
      .join(",");
    const first = seen.get(key);
    if (first === undefined) seen.set(key, v);
    else join(v, first);
  }
  for (let i = 0; i < data.indices.length; i += 3) {
    join(at(data.indices, i + 1), at(data.indices, i));
    join(at(data.indices, i + 2), at(data.indices, i));
  }
  return Int32Array.from({ length: count }, (_, v) => find(v));
}

export function withoutSmallParts(data: GeometryData): Uint8Array {
  const group = groupsOf(data);
  const boxes = new Map<number, THREE.Box3>();
  for (let v = 0; v < group.length; v++) {
    const box = boxes.get(at(group, v)) ?? new THREE.Box3();
    box.expandByPoint(new THREE.Vector3().fromArray(data.positions, v * 3));
    boxes.set(at(group, v), box);
  }
  const slender = new Set<number>();
  for (const [root, box] of boxes) {
    const size = box
      .getSize(new THREE.Vector3())
      .toArray()
      .sort((a, b) => a - b);
    const thin = at(size, 2) > slenderLength && at(size, 1) < slenderWidth;
    if (thin || at(size, 2) < smallPart) slender.add(root);
  }
  const triangles = data.indices.length / 3;
  return Uint8Array.from({ length: triangles }, (_, t) =>
    slender.has(at(group, at(data.indices, t * 3))) ? 0 : 1,
  );
}

export function wallColour(
  pixels: Uint8Array,
  from: number,
  to: number,
  data: GeometryData,
): (triangle: number) => number {
  const rows = pixels.length / 4;
  return (t) => {
    let radius = 0;
    for (let j = 0; j < 3; j++) {
      const v = at(data.indices, t * 3 + j);
      radius +=
        Math.hypot(at(data.positions, v * 3), at(data.positions, v * 3 + 2)) /
        3;
    }
    const share = THREE.MathUtils.clamp((radius - from) / (to - from), 0, 1);
    const i = Math.min(rows - 1, Math.floor(share * rows)) * 4;
    return packColour(at(pixels, i), at(pixels, i + 1), at(pixels, i + 2));
  };
}

function commonest(
  pixels: Uint8Array,
  size: number,
  x: number,
  y: number,
): number {
  const votes = new Map<number, number>();
  let best = 0;
  let most = 0;
  for (let dy = -smoothRadius; dy <= smoothRadius; dy++)
    for (let dx = -smoothRadius; dx <= smoothRadius; dx++) {
      const sx = Math.min(size - 1, Math.max(0, x + dx));
      const sy = Math.min(size - 1, Math.max(0, y + dy));
      const i = (sy * size + sx) * 4;
      const colour = packColour(
        at(pixels, i),
        at(pixels, i + 1),
        at(pixels, i + 2),
      );
      const count = (votes.get(colour) ?? 0) + 1;
      votes.set(colour, count);
      if (count > most) {
        most = count;
        best = colour;
      }
    }
  return best;
}

export function smoothSwatch(swatch: Swatch): Swatch {
  let pixels = swatch.pixels;
  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = new Uint8Array(pixels.length);
    for (let y = 0; y < swatch.size; y++)
      for (let x = 0; x < swatch.size; x++) {
        const colour = commonest(pixels, swatch.size, x, y);
        const i = (y * swatch.size + x) * 4;
        next[i] = colour & 255;
        next[i + 1] = (colour >> 8) & 255;
        next[i + 2] = (colour >> 16) & 255;
        next[i + 3] = 255;
      }
    pixels = next;
  }
  return { pixels, size: swatch.size };
}
