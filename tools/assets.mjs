import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  AssetError,
  fail,
  formatCount,
  readBudgets,
  readSources,
  tiers,
} from "./assets-config.mjs";
import { loadModel, modelLods } from "./assets-model.mjs";
import {
  checkTexture,
  decodePng,
  encodeKtx2,
  fitTexture,
} from "./assets-texture.mjs";

const validationTier = tiers[0];

async function loadAsset(asset, budgets) {
  if (asset.class !== undefined) {
    return { ...asset, model: await loadModel(asset, budgets, validationTier) };
  }
  const label = `asset "${asset.id}"`;
  const image = decodePng(asset.bytes, label);
  checkTexture(
    image,
    label,
    validationTier,
    budgets.tiers[validationTier].maxTextureSize,
  );
  return { ...asset, image, encoded: new Map() };
}

async function modelEntry(asset, budgets, tier, files) {
  const lods = (await modelLods(asset.model, asset.class, budgets, tier)).map(
    (lod) => {
      const file = `${asset.id}.lod${String(lod.level)}.glb`;
      files.set(`${tier}/${file}`, lod.bytes);
      return { file, triangles: lod.triangles, bytes: lod.bytes.byteLength };
    },
  );
  const bytes = lods.reduce((total, lod) => total + lod.bytes, 0);
  const limit = budgets.tiers[tier].bytes[asset.class];
  if (bytes > limit) {
    fail(
      `asset "${asset.id}" (${tier}): ${formatCount(bytes)} bytes is over the ${asset.class} budget of ${formatCount(limit)} bytes`,
    );
  }
  return { id: asset.id, class: asset.class, lods, bytes };
}

async function textureEntry(asset, budgets, tier, files) {
  const srgb = asset.colorSpace === "srgb";
  const fitted = fitTexture(
    asset.image,
    budgets.tiers[tier].maxTextureSize,
    srgb,
  );
  const key = `${String(fitted.width)}x${String(fitted.height)}`;
  const encoded =
    asset.encoded.get(key) ??
    (await encodeKtx2(fitted, { srgb, normal: false }, `asset "${asset.id}"`));
  asset.encoded.set(key, encoded);
  const file = `${asset.id}.ktx2`;
  files.set(`${tier}/${file}`, encoded);
  const texture = {
    file,
    width: fitted.width,
    height: fitted.height,
    bytes: encoded.byteLength,
  };
  return { id: asset.id, texture, bytes: texture.bytes };
}

async function tierPack(assets, budgets, tier, files) {
  const entries = [];
  for (const asset of assets) {
    entries.push(
      asset.model === undefined
        ? await textureEntry(asset, budgets, tier, files)
        : await modelEntry(asset, budgets, tier, files),
    );
  }
  const manifest = {
    tier,
    assets: entries,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
  };
  files.set(
    `${tier}/manifest.json`,
    new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  return manifest;
}

function writePacks(out, files) {
  const parent = path.dirname(out);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, `.${path.basename(out)}-`));
  try {
    for (const [file, bytes] of files) {
      const destination = path.join(staging, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
    }
    rmSync(out, { recursive: true, force: true });
    renameSync(staging, out);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function options() {
  try {
    return parseArgs({
      options: {
        source: { type: "string", default: "content" },
        out: { type: "string", default: "build/assets" },
        budgets: { type: "string", default: "content/budgets.json" },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    return fail(error.message);
  }
}

async function main() {
  const values = options();
  const budgets = readBudgets(path.resolve(values.budgets));
  const sources = readSources(path.resolve(values.source));
  const assets = [];
  for (const source of sources) {
    assets.push(await loadAsset(source, budgets));
  }
  const files = new Map();
  const summary = [];
  for (const tier of tiers) {
    const manifest = await tierPack(assets, budgets, tier, files);
    summary.push(
      `${tier}: ${String(manifest.assets.length)} assets, ${formatCount(manifest.bytes)} bytes\n`,
    );
  }
  const out = path.resolve(values.out);
  writePacks(out, files);
  process.stdout.write(`${summary.join("")}wrote ${out}\n`);
}

try {
  await main();
} catch (error) {
  if (!(error instanceof AssetError)) {
    throw error;
  }
  process.stderr.write(`assets:build failed: ${error.message}\n`);
  process.exitCode = 1;
}
