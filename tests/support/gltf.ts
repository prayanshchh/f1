import { readFileSync } from "node:fs";
import {
  getBounds,
  NodeIO,
  type Document,
  type Node,
  type vec3,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const TRIANGLES = 4;

export async function readModel(file: string): Promise<Document> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return io.read(file);
}

function meshTriangles(node: Node): number {
  const mesh = node.getMesh();
  if (mesh === null) {
    return 0;
  }
  return mesh.listPrimitives().reduce((total, primitive) => {
    if (primitive.getMode() !== TRIANGLES) {
      throw new Error(`mesh ${mesh.getName()} has a non-triangle primitive`);
    }
    const count =
      primitive.getIndices()?.getCount() ??
      primitive.getAttribute("POSITION")?.getCount() ??
      0;
    return total + count / 3;
  }, 0);
}

function visit(node: Node, action: (node: Node) => void): void {
  action(node);
  for (const child of node.listChildren()) {
    visit(child, action);
  }
}

export function sceneNodes(document: Document): Node[] {
  const nodes: Node[] = [];
  for (const scene of document.getRoot().listScenes()) {
    for (const child of scene.listChildren()) {
      visit(child, (node) => nodes.push(node));
    }
  }
  return nodes;
}

export function triangleCount(document: Document): number {
  return sceneNodes(document).reduce(
    (total, node) => total + meshTriangles(node),
    0,
  );
}

export function sceneBounds(document: Document): { min: vec3; max: vec3 } {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (scene === undefined) {
    throw new Error("the model has no scene");
  }
  return getBounds(scene);
}

export function nodeBounds(node: Node): { min: vec3; max: vec3 } {
  return getBounds(node);
}

export interface GlbJson {
  asset?: { version?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  images?: { mimeType?: string; uri?: string; bufferView?: number }[];
  textures?: { source?: number; extensions?: Record<string, unknown> }[];
  bufferViews?: {
    byteOffset?: number;
    byteLength: number;
    extensions?: Record<string, unknown>;
  }[];
  meshes?: unknown[];
}

export interface Glb {
  json: GlbJson;
  binary: Uint8Array;
}

export function parseGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    throw new Error("not a GLB file");
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error("GLB version must be 2");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error("GLB length header does not match the file size");
  }
  let offset = 12;
  let json: GlbJson | undefined;
  let binary: Uint8Array = new Uint8Array();
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(chunk)) as GlbJson;
    } else if (type === 0x004e4942) {
      binary = chunk;
    }
    offset += 8 + length;
  }
  if (json === undefined) {
    throw new Error("GLB has no JSON chunk");
  }
  return { json, binary };
}

export function readGlb(file: string): Glb {
  return parseGlb(new Uint8Array(readFileSync(file)));
}

export function embeddedImages(glb: Glb): Uint8Array[] {
  return (glb.json.images ?? []).map((image, index) => {
    const view =
      image.bufferView === undefined
        ? undefined
        : glb.json.bufferViews?.[image.bufferView];
    if (view === undefined) {
      throw new Error(`image ${String(index)} is not embedded in the GLB`);
    }
    const start = view.byteOffset ?? 0;
    return glb.binary.subarray(start, start + view.byteLength);
  });
}

export interface Ktx2Info {
  vkFormat: number;
  width: number;
  height: number;
  depth: number;
  layers: number;
  faces: number;
  levels: number;
  supercompression: number;
  colorModel: number;
  transfer: number;
  levelBytes: number[];
}

const ktx2Identifier = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
];

export function isKtx2(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 80 &&
    ktx2Identifier.every((value, index) => bytes[index] === value)
  );
}

export function ktx2Info(bytes: Uint8Array): Ktx2Info {
  if (!isKtx2(bytes)) {
    throw new Error("not a KTX2 file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number) => view.getUint32(offset, true);
  const levels = word(40);
  const levelBytes = Array.from({ length: Math.max(levels, 1) }, (_, level) => {
    const entry = 80 + level * 24;
    const start = Number(view.getBigUint64(entry, true));
    const length = Number(view.getBigUint64(entry + 8, true));
    if (length === 0 || start + length > bytes.byteLength) {
      throw new Error(`KTX2 level ${String(level)} is empty or out of range`);
    }
    return length;
  });
  const dfd = word(48);
  return {
    vkFormat: word(12),
    width: word(20),
    height: word(24),
    depth: word(28),
    layers: word(32),
    faces: word(36),
    levels,
    supercompression: word(44),
    colorModel: bytes[dfd + 12] ?? -1,
    transfer: bytes[dfd + 14] ?? -1,
    levelBytes,
  };
}
