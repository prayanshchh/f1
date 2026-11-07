import { crc32 } from "node:zlib";
import {
  Accessor,
  Document,
  NodeIO,
  type GLTF,
  type Texture,
  type TypedArray,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { losslessWebp, packGlb } from "../../apps/client/asset-codec.ts";

const side = 48;
const triangleStrip = 5;

function grid(): {
  positions: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
} {
  const positions = new Float32Array(side * side * 3);
  const uvs = new Float32Array(side * side * 2);
  for (let row = 0; row < side; row++)
    for (let column = 0; column < side; column++) {
      const at = row * side + column;
      positions.set(
        [column * 0.25, Math.sin(row * 0.3) * 0.7, row * 0.25],
        at * 3,
      );
      uvs.set([column / (side - 1), row / (side - 1)], at * 2);
    }
  return { positions, uvs };
}

function triangles(): Uint16Array<ArrayBuffer> {
  const out: number[] = [];
  for (let row = 0; row < side - 1; row++)
    for (let column = 0; column < side - 1; column++) {
      const at = row * side + column;
      out.push(at, at + side, at + 1, at + 1, at + side, at + side + 1);
    }
  return new Uint16Array(out);
}

function strip(): Uint32Array<ArrayBuffer> {
  const out: number[] = [];
  for (let column = 0; column < side; column++) out.push(column, column + side);
  return new Uint32Array(out);
}

function pattern(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      pixels[at] = (x * 7) & 255;
      pixels[at + 1] = (y * 5) & 255;
      pixels[at + 2] = ((x ^ y) * 3) & 255;
      pixels[at + 3] = (x + y) % 9 === 0 ? 0 : 255;
    }
  return pixels;
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp(pattern(width, height), { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

function withChunk(image: Buffer, type: string, body: Buffer): Buffer {
  const name = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([name, body])));
  const headerEnd = 8 + 25;
  return Buffer.concat([
    image.subarray(0, headerEnd),
    length,
    name,
    body,
    check,
    image.subarray(headerEnd),
  ]);
}

function gammaTagged(image: Buffer): Buffer {
  const gamma = Buffer.alloc(4);
  gamma.writeUInt32BE(45455);
  return withChunk(image, "gAMA", gamma);
}

function deepPng(): Promise<Buffer> {
  return sharp(pattern(32, 32), { raw: { width: 32, height: 32, channels: 4 } })
    .toColourspace("rgb16")
    .png()
    .toBuffer();
}

function rgba(image: Uint8Array): Promise<Buffer> {
  return sharp(image).toColourspace("srgb").ensureAlpha().raw().toBuffer();
}

function accessor(
  document: Document,
  type: GLTF.AccessorType,
  array: TypedArray,
) {
  return document
    .createAccessor()
    .setType(type)
    .setArray(array)
    .setBuffer(document.getRoot().listBuffers()[0] ?? null);
}

function texture(
  document: Document,
  image: Uint8Array,
  mimeType: string,
): Texture {
  return document.createTexture().setImage(image).setMimeType(mimeType);
}

async function model(): Promise<Uint8Array> {
  const document = new Document();
  document.createBuffer();
  const { positions, uvs } = grid();
  const normals = new Float32Array(positions.length).map((_, i) =>
    i % 3 === 1 ? 1 : 0,
  );
  const joints = new Uint16Array(side * side * 4).map((_, i) =>
    i % 4 === 0 ? 1 : 0,
  );
  const weights = new Float32Array(side * side * 4).map((_, i) =>
    i % 4 === 0 ? 1 : 0,
  );
  const material = document
    .createMaterial()
    .setBaseColorTexture(texture(document, await png(64, 64), "image/png"))
    .setMetallicRoughnessTexture(
      texture(document, gammaTagged(await png(64, 64)), "image/png"),
    )
    .setNormalTexture(texture(document, await deepPng(), "image/png"))
    .setOcclusionTexture(
      texture(
        document,
        await sharp(pattern(32, 32), {
          raw: { width: 32, height: 32, channels: 4 },
        })
          .jpeg()
          .toBuffer(),
        "image/jpeg",
      ),
    );
  const surface = document
    .createPrimitive()
    .setAttribute("POSITION", accessor(document, "VEC3", positions))
    .setAttribute("NORMAL", accessor(document, "VEC3", normals))
    .setAttribute("TEXCOORD_0", accessor(document, "VEC2", uvs))
    .setAttribute("JOINTS_0", accessor(document, "VEC4", joints))
    .setAttribute("WEIGHTS_0", accessor(document, "VEC4", weights))
    .setIndices(accessor(document, "SCALAR", triangles()))
    .setMaterial(material)
    .addTarget(
      document.createPrimitiveTarget().setAttribute(
        "POSITION",
        accessor(
          document,
          "VEC3",
          positions.map((value) => value * 0.01),
        ),
      ),
    );
  const ribbon = document
    .createPrimitive()
    .setMode(triangleStrip)
    .setAttribute("POSITION", accessor(document, "VEC3", positions.slice()))
    .setIndices(accessor(document, "SCALAR", strip()));
  const joint = document.createNode("joint");
  const mesh = document.createMesh().addPrimitive(surface).addPrimitive(ribbon);
  const body = document
    .createNode("body")
    .setMesh(mesh)
    .setSkin(
      document
        .createSkin()
        .addJoint(joint)
        .setInverseBindMatrices(
          accessor(
            document,
            "MAT4",
            new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
          ),
        ),
    );
  const sampler = document
    .createAnimationSampler()
    .setInput(accessor(document, "SCALAR", new Float32Array([0, 1, 2])))
    .setOutput(
      accessor(document, "VEC3", new Float32Array([0, 0, 0, 1, 2, 3, 0, 0, 0])),
    );
  document
    .createAnimation()
    .addSampler(sampler)
    .addChannel(
      document
        .createAnimationChannel()
        .setTargetNode(joint)
        .setTargetPath("translation")
        .setSampler(sampler),
    );
  document.createScene().addChild(body).addChild(joint);
  return new NodeIO().writeBinary(document);
}

async function read(bytes: Uint8Array): Promise<Document> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
    .readBinary(bytes);
}

function bytesOf(item: Accessor): Buffer {
  const array = item.getArray();
  if (!array) throw new Error("accessor without data");
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function required(bytes: Uint8Array): string[] {
  const length = Buffer.from(bytes).readUInt32LE(12);
  const json = JSON.parse(
    Buffer.from(bytes.subarray(20, 20 + length)).toString(),
  ) as {
    extensionsRequired?: string[];
  };
  return json.extensionsRequired ?? [];
}

describe("lossless asset packing", () => {
  test("a packed model decodes to the same geometry, skin, animation and pixels", async () => {
    const original = await model();
    const packed = await packGlb(original);
    if (!packed) throw new Error("model was not packed");
    expect(packed.length).toBeLessThan(original.length);
    expect(required(packed)).toEqual(
      expect.arrayContaining(["EXT_meshopt_compression", "EXT_texture_webp"]),
    );
    const [before, after] = await Promise.all([read(original), read(packed)]);
    const accessorsBefore = before.getRoot().listAccessors();
    const accessorsAfter = after.getRoot().listAccessors();
    expect(accessorsAfter).toHaveLength(accessorsBefore.length);
    accessorsBefore.forEach((item, index) => {
      const other = accessorsAfter[index];
      if (!other) throw new Error(`accessor ${String(index)} missing`);
      expect([
        other.getType(),
        other.getComponentType(),
        other.getNormalized(),
      ]).toEqual([
        item.getType(),
        item.getComponentType(),
        item.getNormalized(),
      ]);
      expect(bytesOf(other).equals(bytesOf(item))).toBe(true);
    });
    const texturesBefore = before.getRoot().listTextures();
    const texturesAfter = after.getRoot().listTextures();
    expect(texturesAfter.map((item) => item.getMimeType())).toEqual([
      "image/webp",
      "image/webp",
      "image/png",
      "image/jpeg",
    ]);
    for (const [index, item] of texturesBefore.entries()) {
      const imageBefore = item.getImage();
      const imageAfter = texturesAfter[index]?.getImage();
      if (!imageBefore || !imageAfter) throw new Error("texture without image");
      if (item.getMimeType() === texturesAfter[index]?.getMimeType())
        expect(Buffer.from(imageAfter).equals(Buffer.from(imageBefore))).toBe(
          true,
        );
      else {
        expect(Buffer.from(imageAfter).readUInt32LE(4) + 8).toBe(
          imageAfter.length,
        );
        expect((await rgba(imageAfter)).equals(await rgba(imageBefore))).toBe(
          true,
        );
      }
    }
  });

  test("text that is not a model, like a Git LFS pointer, is refused", async () => {
    const pointer = Buffer.from(
      "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n",
    );
    await expect(packGlb(pointer)).rejects.toThrow("not a GLB file");
  });

  test("a model that is already meshopt compressed is left alone", async () => {
    const packed = await packGlb(await model());
    if (!packed) throw new Error("model was not packed");
    await expect(packGlb(packed)).resolves.toBeNull();
  });
});

describe("lossless WebP for loose textures", () => {
  test("keeps every pixel, including colour under transparent pixels", async () => {
    const source = await png(96, 40);
    const webp = await losslessWebp(source, true);
    if (!webp) throw new Error("png was not converted");
    expect(webp.length).toBeLessThan(source.length);
    const decoded = await sharp(webp).ensureAlpha().raw().toBuffer();
    expect(decoded.equals(pattern(96, 40))).toBe(true);
  });

  test("leaves colour-tagged PNGs alone when the browser would colour-correct them", async () => {
    const tagged = gammaTagged(await png(64, 64));
    await expect(losslessWebp(tagged, true)).resolves.toBeNull();
    const inModel = await losslessWebp(tagged, false);
    if (!inModel) throw new Error("tagged png in a model was not converted");
    expect((await rgba(inModel)).equals(await rgba(tagged))).toBe(true);
  });

  test("leaves 16-bit PNGs and PNGs taller than WebP allows alone", async () => {
    await expect(losslessWebp(await deepPng(), false)).resolves.toBeNull();
    await expect(losslessWebp(await png(4, 16384), false)).resolves.toBeNull();
  });
});
