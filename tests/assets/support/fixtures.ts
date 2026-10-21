import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Document, NodeIO, type Texture } from "@gltf-transform/core";
import { PNG } from "pngjs";
import type { AssetBudgets } from "../../support/asset-budgets.ts";

export function pngBytes(width: number, height: number, seed: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      png.data[offset] = (x * 7 + seed * 13) % 256;
      png.data[offset + 1] = (y * 5 + seed * 29) % 256;
      png.data[offset + 2] = ((x ^ y) + seed * 3) % 256;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export interface ModelOptions {
  cells: number;
  baseColor: number;
  normal: number;
}

function grid(cells: number) {
  const size = cells + 1;
  const positions = new Float32Array(size * size * 3);
  const normals = new Float32Array(size * size * 3);
  const uvs = new Float32Array(size * size * 2);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const vertex = row * size + column;
      const u = column / cells;
      const v = row / cells;
      positions.set(
        [u * 4 - 2, Math.sin(u * 9) * Math.cos(v * 7) * 0.4, v * 3 - 1.5],
        vertex * 3,
      );
      normals.set([0, 1, 0], vertex * 3);
      uvs.set([u, v], vertex * 2);
    }
  }
  const indices = new Uint32Array(cells * cells * 6);
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const corner = row * size + column;
      indices.set(
        [
          corner,
          corner + size,
          corner + 1,
          corner + 1,
          corner + size,
          corner + size + 1,
        ],
        (row * cells + column) * 6,
      );
    }
  }
  return { positions, normals, uvs, indices };
}

export async function modelBytes(options: ModelOptions): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const data = grid(options.cells);
  const accessor = (
    type: "VEC3" | "VEC2" | "SCALAR",
    array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  ) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const image = (name: string, size: number, seed: number): Texture =>
    document
      .createTexture(name)
      .setImage(pngBytes(size, size, seed))
      .setMimeType("image/png");
  const material = document
    .createMaterial("paint")
    .setBaseColorTexture(image("base", options.baseColor, 1))
    .setNormalTexture(image("normal", options.normal, 2))
    .setMetallicFactor(0.4)
    .setRoughnessFactor(0.5);
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", data.positions))
    .setAttribute("NORMAL", accessor("VEC3", data.normals))
    .setAttribute("TEXCOORD_0", accessor("VEC2", data.uvs))
    .setIndices(accessor("SCALAR", data.indices))
    .setMaterial(material);
  const mesh = document.createMesh("surface").addPrimitive(primitive);
  const node = document.createNode("surface").setMesh(mesh);
  const scene = document.createScene("scene").addChild(node);
  document.getRoot().setDefaultScene(scene);
  return new NodeIO().writeBinary(document);
}

export interface SourceAsset {
  id: string;
  class?: string;
  model?: string;
  texture?: string;
  colorSpace?: string;
}

export interface SourceTree {
  root: string;
  out: string;
  budgets: string;
  write: (file: string, content: string | Uint8Array) => void;
  remove: () => void;
}

export function sourceTree(): SourceTree {
  const root = mkdtempSync(path.join(tmpdir(), "assets-"));
  const write = (file: string, content: string | Uint8Array) => {
    const destination = path.join(root, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  };
  return {
    root,
    out: path.join(root, "out"),
    budgets: path.join(root, "budgets.json"),
    write,
    remove() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export const fixtureBudgets: AssetBudgets = {
  lodCount: { car: 4, prop: 3 },
  tiers: {
    ultra: {
      maxTextureSize: 256,
      triangles: { car: 20_000, prop: 6_000 },
      bytes: { car: 4_000_000, prop: 1_000_000 },
    },
    high: {
      maxTextureSize: 128,
      triangles: { car: 12_000, prop: 3_000 },
      bytes: { car: 2_000_000, prop: 500_000 },
    },
    medium: {
      maxTextureSize: 64,
      triangles: { car: 6_000, prop: 1_500 },
      bytes: { car: 1_000_000, prop: 250_000 },
    },
    low: {
      maxTextureSize: 64,
      triangles: { car: 3_000, prop: 800 },
      bytes: { car: 600_000, prop: 150_000 },
    },
    basic: {
      maxTextureSize: 32,
      triangles: { car: 1_500, prop: 400 },
      bytes: { car: 300_000, prop: 100_000 },
    },
  },
};
