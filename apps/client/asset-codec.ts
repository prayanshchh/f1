import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

type Extensions = Record<string, unknown>;

interface BufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  extensions?: Extensions;
}

interface Accessor {
  bufferView?: number;
  componentType: number;
  type: string;
  sparse?: {
    indices: { bufferView: number };
    values: { bufferView: number };
  };
}

interface Primitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  targets?: Record<string, number>[];
}

interface Image {
  bufferView?: number;
  mimeType?: string;
}

interface Texture {
  source?: number;
  extensions?: Extensions;
}

interface Gltf {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: { byteLength: number; uri?: string; extensions?: Extensions }[];
  bufferViews?: BufferView[];
  accessors?: Accessor[];
  meshes?: { primitives: Primitive[] }[];
  images?: Image[];
  textures?: Texture[];
}

type Use =
  | { kind: "vertex"; size: number }
  | { kind: "index"; size: number; triangles: boolean }
  | { kind: "image"; image: number }
  | { kind: "other" };

type Mode = "ATTRIBUTES" | "TRIANGLES" | "INDICES";

interface Plan {
  modes: Mode[];
  size: number;
  count: number;
}

interface Encoded {
  bytes: Uint8Array;
  mode: Mode;
  size: number;
  count: number;
}

const glbMagic = 0x46546c67;
const jsonType = 0x4e4f534a;
const binType = 0x004e4942;
const meshoptName = "EXT_meshopt_compression";
const webpName = "EXT_texture_webp";
const compressedAlready = [
  meshoptName,
  "KHR_meshopt_compression",
  "KHR_draco_mesh_compression",
];
const webpLimit = 16383;
const triangleMode = 4;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const colourChunks = ["iCCP", "gAMA", "cHRM", "sRGB", "sBIT"];
const components: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};
const componentBytes: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function align(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function readGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array } {
  const view = dataView(bytes);
  if (bytes.length < 20 || view.getUint32(0, true) !== glbMagic)
    throw new Error("not a GLB file");
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== jsonType)
    throw new Error("GLB has no JSON chunk");
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as Gltf;
  const at = 20 + jsonLength;
  if (at + 8 > bytes.length || view.getUint32(at + 4, true) !== binType)
    return { json, bin: new Uint8Array(0) };
  return {
    json,
    bin: bytes.subarray(at + 8, at + 8 + view.getUint32(at, true)),
  };
}

function chunk(type: number, body: Uint8Array, pad: number): Uint8Array {
  const out = new Uint8Array(8 + align(body.length)).fill(pad, 8);
  const view = dataView(out);
  view.setUint32(0, align(body.length), true);
  view.setUint32(4, type, true);
  out.set(body, 8);
  return out;
}

function writeGlb(json: Gltf, bin: Uint8Array): Uint8Array {
  const head = chunk(
    jsonType,
    new TextEncoder().encode(JSON.stringify(json)),
    0x20,
  );
  const body = chunk(binType, bin, 0);
  const out = new Uint8Array(12 + head.length + body.length);
  const view = dataView(out);
  view.setUint32(0, glbMagic, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  out.set(head, 12);
  out.set(body, 12 + head.length);
  return out;
}

export function pngInfo(bytes: Uint8Array): {
  width: number;
  height: number;
  depth: number;
  chunks: Set<string>;
} | null {
  if (bytes.length < 33 || pngSignature.some((byte, i) => bytes[i] !== byte))
    return null;
  const view = dataView(bytes);
  const chunks = new Set<string>();
  for (let at = 8; at + 8 <= bytes.length; at += view.getUint32(at) + 12)
    chunks.add(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    depth: bytes[24] ?? 0,
    chunks,
  };
}

function rgba(image: Uint8Array): Promise<Buffer> {
  return sharp(image).toColourspace("srgb").ensureAlpha().raw().toBuffer();
}

function webpReady(png: Uint8Array, colourTagsMatter: boolean): boolean {
  const info = pngInfo(png);
  if (!info || info.depth !== 8 || info.chunks.has("iCCP")) return false;
  if (info.width > webpLimit || info.height > webpLimit) return false;
  return (
    !colourTagsMatter || !colourChunks.some((name) => info.chunks.has(name))
  );
}

export async function losslessWebp(
  png: Uint8Array,
  colourTagsMatter: boolean,
): Promise<Uint8Array | null> {
  if (!webpReady(png, colourTagsMatter)) return null;
  const webp = await sharp(png)
    .webp({ lossless: true, exact: true, effort: 4, quality: 75 })
    .toBuffer();
  if (webp.length >= png.length) return null;
  const [before, after] = await Promise.all([rgba(png), rgba(webp)]);
  return before.equals(after) ? new Uint8Array(webp) : null;
}

function elementSize(accessor: Accessor): number {
  return (
    (components[accessor.type] ?? 0) *
    (componentBytes[accessor.componentType] ?? 0)
  );
}

function addUse(
  uses: Map<number, Use[]>,
  view: number | undefined,
  use: Use,
): void {
  if (view === undefined) return;
  uses.set(view, [...(uses.get(view) ?? []), use]);
}

function primitiveUses(
  gltf: Gltf,
  primitive: Primitive,
  uses: Map<number, Use[]>,
): void {
  const accessors = gltf.accessors ?? [];
  const vertex = [
    ...Object.values(primitive.attributes),
    ...(primitive.targets ?? []).flatMap((target) => Object.values(target)),
  ];
  for (const index of vertex) {
    const accessor = accessors[index];
    if (accessor)
      addUse(uses, accessor.bufferView, {
        kind: "vertex",
        size: elementSize(accessor),
      });
  }
  const indices =
    primitive.indices === undefined ? undefined : accessors[primitive.indices];
  if (indices)
    addUse(uses, indices.bufferView, {
      kind: "index",
      size: elementSize(indices),
      triangles: (primitive.mode ?? triangleMode) === triangleMode,
    });
}

function viewUses(gltf: Gltf): Map<number, Use[]> {
  const uses = new Map<number, Use[]>();
  for (const mesh of gltf.meshes ?? [])
    for (const primitive of mesh.primitives)
      primitiveUses(gltf, primitive, uses);
  for (const [image, entry] of (gltf.images ?? []).entries())
    addUse(uses, entry.bufferView, { kind: "image", image });
  otherUses(gltf, uses);
  return uses;
}

function otherUses(gltf: Gltf, uses: Map<number, Use[]>): void {
  for (const accessor of gltf.accessors ?? []) {
    addUse(uses, accessor.sparse?.indices.bufferView, { kind: "other" });
    addUse(uses, accessor.sparse?.values.bufferView, { kind: "other" });
    if (accessor.bufferView !== undefined && !uses.has(accessor.bufferView))
      addUse(uses, accessor.bufferView, { kind: "other" });
  }
}

function vertexPlan(view: BufferView, uses: Use[]): Plan | null {
  const sizes = new Set(
    uses.map((use) => (use.kind === "vertex" ? use.size : 0)),
  );
  const size = view.byteStride ?? (sizes.size === 1 ? [...sizes][0] : 0) ?? 0;
  if (size <= 0 || size % 4 !== 0 || size > 256 || view.byteLength % size !== 0)
    return null;
  return { modes: ["ATTRIBUTES"], size, count: view.byteLength / size };
}

function indexPlan(view: BufferView, uses: Use[]): Plan | null {
  const first = uses[0];
  if (first?.kind !== "index" || (first.size !== 2 && first.size !== 4))
    return null;
  if (uses.some((use) => use.kind !== "index" || use.size !== first.size))
    return null;
  const count = view.byteLength / first.size;
  const triangles =
    count % 3 === 0 &&
    uses.every((use) => use.kind === "index" && use.triangles);
  const modes: Mode[] = triangles ? ["TRIANGLES", "INDICES"] : ["INDICES"];
  return { modes, size: first.size, count };
}

function plan(view: BufferView, uses: Use[] | undefined): Plan | null {
  if (!uses?.length) return null;
  if (uses.every((use) => use.kind === "vertex")) return vertexPlan(view, uses);
  if (uses.every((use) => use.kind === "index")) return indexPlan(view, uses);
  return null;
}

function decodes(
  encoded: Uint8Array,
  data: Uint8Array,
  plan: Plan,
  mode: Mode,
): boolean {
  const decoded = new Uint8Array(plan.count * plan.size);
  try {
    MeshoptDecoder.decodeGltfBuffer(
      decoded,
      plan.count,
      plan.size,
      encoded,
      mode,
    );
  } catch {
    return false;
  }
  return Buffer.from(decoded.buffer).equals(
    Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  );
}

function encode(data: Uint8Array, plan: Plan): Encoded | null {
  for (const mode of plan.modes) {
    const bytes = MeshoptEncoder.encodeGltfBuffer(
      data,
      plan.count,
      plan.size,
      mode,
    );
    if (bytes.length < data.length && decodes(bytes, data, plan, mode))
      return { bytes, mode, size: plan.size, count: plan.count };
  }
  return null;
}

class BinWriter {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): number {
    const at = align(this.length);
    if (at > this.length) this.parts.push(new Uint8Array(at - this.length));
    this.parts.push(bytes);
    this.length = at + bytes.length;
    return at;
  }

  bytes(): Uint8Array {
    return Buffer.concat(this.parts);
  }
}

function packable(gltf: Gltf): boolean {
  const used = gltf.extensionsUsed ?? [];
  return (
    gltf.buffers?.length === 1 &&
    gltf.buffers[0]?.uri === undefined &&
    !compressedAlready.some((name) => used.includes(name))
  );
}

function useWebp(gltf: Gltf, images: Set<number>): void {
  for (const image of images) {
    const entry = gltf.images?.[image];
    if (entry) entry.mimeType = "image/webp";
  }
  for (const texture of gltf.textures ?? []) {
    if (texture.source === undefined || !images.has(texture.source)) continue;
    texture.extensions = {
      ...texture.extensions,
      [webpName]: { source: texture.source },
    };
    delete texture.source;
  }
}

function requireExtension(gltf: Gltf, name: string): void {
  gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), name])];
  gltf.extensionsRequired = [
    ...new Set([...(gltf.extensionsRequired ?? []), name]),
  ];
}

function pngImage(gltf: Gltf, uses: Use[] | undefined): number | null {
  const use = uses?.length === 1 ? uses[0] : undefined;
  if (use?.kind !== "image") return null;
  return gltf.images?.[use.image]?.mimeType === "image/png" ? use.image : null;
}

interface Packing {
  gltf: Gltf;
  out: BinWriter;
  fallback: number;
  webp: Set<number>;
  compressed: number;
}

async function packView(
  packing: Packing,
  view: BufferView,
  data: Uint8Array,
  uses: Use[] | undefined,
): Promise<void> {
  const viewPlan = plan(view, uses);
  const encoded = viewPlan ? encode(data, viewPlan) : null;
  if (encoded) {
    const byteOffset = packing.out.push(encoded.bytes);
    view.buffer = 1;
    view.byteOffset = packing.fallback;
    view.extensions = {
      ...view.extensions,
      [meshoptName]: {
        buffer: 0,
        byteOffset,
        byteLength: encoded.bytes.length,
        byteStride: encoded.size,
        count: encoded.count,
        mode: encoded.mode,
      },
    };
    packing.fallback += align(view.byteLength);
    packing.compressed += 1;
    return;
  }
  const image = pngImage(packing.gltf, uses);
  const webp = image === null ? null : await losslessWebp(data, false);
  if (image !== null && webp) packing.webp.add(image);
  view.byteOffset = packing.out.push(webp ?? data);
  if (webp) view.byteLength = webp.length;
}

export async function packGlb(bytes: Uint8Array): Promise<Uint8Array | null> {
  const { json: gltf, bin } = readGlb(bytes);
  if (!packable(gltf)) return null;
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const uses = viewUses(gltf);
  const packing: Packing = {
    gltf,
    out: new BinWriter(),
    fallback: 0,
    webp: new Set(),
    compressed: 0,
  };
  for (const [index, view] of (gltf.bufferViews ?? []).entries()) {
    const start = view.byteOffset ?? 0;
    await packView(
      packing,
      view,
      bin.subarray(start, start + view.byteLength),
      uses.get(index),
    );
  }
  if (packing.compressed === 0 && packing.webp.size === 0) return null;
  useWebp(gltf, packing.webp);
  if (packing.webp.size > 0) requireExtension(gltf, webpName);
  gltf.buffers = [{ byteLength: packing.out.length }];
  if (packing.compressed > 0) {
    gltf.buffers.push({
      byteLength: packing.fallback,
      extensions: { [meshoptName]: { fallback: true } },
    });
    requireExtension(gltf, meshoptName);
  }
  const packed = writeGlb(gltf, packing.out.bytes());
  return packed.length < bytes.length ? packed : null;
}
