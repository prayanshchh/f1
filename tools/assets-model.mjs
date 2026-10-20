import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import {
  cloneDocument,
  getTextureColorSpace,
  listTextureSlots,
  meshopt,
  prune,
  simplify,
  weld,
} from "@gltf-transform/functions";
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from "meshoptimizer";
import { fail, formatCount } from "./assets-config.mjs";
import {
  checkTexture,
  decodePng,
  encodeKtx2,
  fitTexture,
} from "./assets-texture.mjs";

const TRIANGLES = 4;
const SIMPLIFY_ATTEMPTS = 8;

let io;

async function modelIo() {
  if (io === undefined) {
    await Promise.all([
      MeshoptDecoder.ready,
      MeshoptEncoder.ready,
      MeshoptSimplifier.ready,
    ]);
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  }
  return io;
}

function primitiveTriangles(primitive, label) {
  if (primitive.getMode() !== TRIANGLES) {
    fail(`${label}: every primitive must be a triangle list`);
  }
  const count =
    primitive.getIndices()?.getCount() ??
    primitive.getAttribute("POSITION")?.getCount() ??
    0;
  return count / 3;
}

function nodeTriangles(node, label) {
  const own = (node.getMesh()?.listPrimitives() ?? []).reduce(
    (total, primitive) => total + primitiveTriangles(primitive, label),
    0,
  );
  return node
    .listChildren()
    .reduce((total, child) => total + nodeTriangles(child, label), own);
}

function triangleCount(document, label) {
  return document
    .getRoot()
    .listScenes()
    .flatMap((scene) => scene.listChildren())
    .reduce((total, node) => total + nodeTriangles(node, label), 0);
}

function textureImage(texture, index, label) {
  const name = `${label} texture "${texture.getName() || String(index)}"`;
  if (texture.getMimeType() !== "image/png") {
    fail(`${name}: must be a PNG, got ${texture.getMimeType()}`);
  }
  const image = decodePng(texture.getImage() ?? new Uint8Array(), name);
  return {
    image,
    name,
    srgb: getTextureColorSpace(texture) === "srgb",
    normal: listTextureSlots(texture).includes("normalTexture"),
    encoded: new Map(),
  };
}

export async function loadModel(asset, budgets, tier) {
  const label = `asset "${asset.id}"`;
  let document;
  try {
    document = await (await modelIo()).readBinary(asset.bytes);
  } catch (error) {
    return fail(`${label}: cannot read ${asset.path} (${error.message})`);
  }
  await document.transform(prune());
  const triangles = triangleCount(document, label);
  const budget = budgets.tiers[tier];
  const limit = budget.triangles[asset.class];
  if (triangles === 0) {
    fail(`${label}: ${asset.path} has no triangles`);
  }
  if (triangles > limit) {
    fail(
      `${label} (${tier}): ${formatCount(triangles)} triangles is over the ${asset.class} budget of ${formatCount(limit)}`,
    );
  }
  const textures = document
    .getRoot()
    .listTextures()
    .map((texture, index) => textureImage(texture, index, label));
  for (const texture of textures) {
    checkTexture(texture.image, texture.name, tier, budget.maxTextureSize);
  }
  return { document, triangles, textures, label };
}

async function encodedTexture(source, limit) {
  const fitted = fitTexture(source.image, limit, source.srgb);
  const key = `${String(fitted.width)}x${String(fitted.height)}`;
  const cached = source.encoded.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const bytes = await encodeKtx2(fitted, source, source.name);
  source.encoded.set(key, bytes);
  return bytes;
}

async function compressTextures(model, limit) {
  const document = cloneDocument(model.document);
  document.createExtension(KHRTextureBasisu).setRequired(true);
  const textures = document.getRoot().listTextures();
  for (const [index, source] of model.textures.entries()) {
    textures[index]
      ?.setImage(await encodedTexture(source, limit))
      .setMimeType("image/ktx2");
  }
  return document;
}

async function simplified(document, original, target, label) {
  let ratio = target / original;
  for (let attempt = 0; attempt < SIMPLIFY_ATTEMPTS; attempt += 1) {
    const lod = cloneDocument(document);
    await lod.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 1 }),
    );
    const count = triangleCount(lod, label);
    if (count === 0) {
      break;
    }
    if (count <= target) {
      return { lod, count };
    }
    ratio *= (target / count) * 0.95;
  }
  return fail(
    `${label}: cannot simplify ${formatCount(original)} triangles down to ${formatCount(target)}`,
  );
}

async function encodeLod(lod) {
  await lod.transform(
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  return (await modelIo()).writeBinary(lod);
}

export async function modelLods(model, assetClass, budgets, tier) {
  const budget = budgets.tiers[tier];
  const document = await compressTextures(model, budget.maxTextureSize);
  const label = `${model.label} (${tier})`;
  const lods = [];
  let target = Math.min(model.triangles, budget.triangles[assetClass]);
  for (let level = 0; level < budgets.lodCount[assetClass]; level += 1) {
    if (target < 1) {
      fail(
        `${label}: too few triangles for ${String(budgets.lodCount[assetClass])} detail levels`,
      );
    }
    const { lod, count } =
      target === model.triangles
        ? { lod: cloneDocument(document), count: target }
        : await simplified(document, model.triangles, target, label);
    lods.push({ level, triangles: count, bytes: await encodeLod(lod) });
    target = Math.floor(count / 2);
  }
  return lods;
}
