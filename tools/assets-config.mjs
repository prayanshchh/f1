import { readFileSync } from "node:fs";
import path from "node:path";

export const tiers = ["ultra", "high", "medium", "low", "basic"];

export const assetClasses = ["car", "prop"];

const colorSpaces = ["srgb", "linear"];

export class AssetError extends Error {}

export function fail(message) {
  throw new AssetError(message);
}

export function formatCount(value) {
  return value.toLocaleString("en-US");
}

function readJson(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return fail(
      `${file}: cannot read the file (${error.code ?? error.message})`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail(`${file}: invalid JSON (${error.message})`);
  }
}

function plainObject(value, where) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object`);
  }
  return value;
}

function exactKeys(object, keys, where) {
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) {
      fail(`${where}: unknown field "${key}"`);
    }
  }
  for (const key of keys) {
    if (!(key in object)) {
      fail(`${where}: missing "${key}"`);
    }
  }
}

function record(value, keys, where, check) {
  const object = plainObject(value, where);
  exactKeys(object, keys, where);
  return Object.fromEntries(
    keys.map((key) => [key, check(object[key], `${where}.${key}`)]),
  );
}

function positiveInteger(value, where) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${where} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function textureLimit(value, where) {
  positiveInteger(value, where);
  if (!isPowerOfTwo(value)) {
    fail(`${where} must be a power of two, got ${formatCount(value)}`);
  }
  return value;
}

function perClass(value, where) {
  return record(value, assetClasses, where, positiveInteger);
}

function tierBudget(value, where) {
  const object = plainObject(value, where);
  exactKeys(object, ["maxTextureSize", "triangles", "bytes"], where);
  return {
    maxTextureSize: textureLimit(
      object.maxTextureSize,
      `${where}.maxTextureSize`,
    ),
    triangles: perClass(object.triangles, `${where}.triangles`),
    bytes: perClass(object.bytes, `${where}.bytes`),
  };
}

export function readBudgets(file) {
  const object = plainObject(readJson(file), file);
  exactKeys(object, ["lodCount", "tiers"], file);
  return {
    lodCount: perClass(object.lodCount, `${file} lodCount`),
    tiers: record(object.tiers, tiers, `${file} tiers`, tierBudget),
  };
}

function sourceFile(root, value, label) {
  if (
    typeof value !== "string" ||
    value === "" ||
    path.isAbsolute(value) ||
    path.normalize(value).startsWith("..")
  ) {
    fail(`${label}: ${JSON.stringify(value)} must be a path inside ${root}`);
  }
  try {
    return new Uint8Array(readFileSync(path.join(root, value)));
  } catch (error) {
    return fail(
      `${label}: cannot read ${value} (${error.code ?? error.message})`,
    );
  }
}

function oneOf(value, allowed, field, label) {
  if (!allowed.includes(value)) {
    fail(
      `${label}: ${field} must be ${allowed.map((entry) => `"${entry}"`).join(" or ")}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function modelAsset(entry, root, label) {
  exactKeys(entry, ["id", "class", "model"], label);
  return {
    id: entry.id,
    class: oneOf(entry.class, assetClasses, "class", label),
    path: entry.model,
    bytes: sourceFile(root, entry.model, label),
  };
}

function textureAsset(entry, root, label) {
  exactKeys(entry, ["id", "texture", "colorSpace"], label);
  return {
    id: entry.id,
    colorSpace: oneOf(entry.colorSpace, colorSpaces, "colorSpace", label),
    path: entry.texture,
    bytes: sourceFile(root, entry.texture, label),
  };
}

function sourceAsset(value, root, where) {
  const entry = plainObject(value, where);
  if (
    typeof entry.id !== "string" ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)
  ) {
    fail(`${where}: id ${JSON.stringify(entry.id)} must be kebab-case`);
  }
  const label = `asset "${entry.id}"`;
  if ("model" in entry) {
    return modelAsset(entry, root, label);
  }
  if ("texture" in entry) {
    return textureAsset(entry, root, label);
  }
  return fail(
    `${label}: needs either "model" and "class", or "texture" and "colorSpace"`,
  );
}

export function readSources(root) {
  const file = path.join(root, "assets.json");
  const manifest = plainObject(readJson(file), file);
  exactKeys(manifest, ["assets"], file);
  if (!Array.isArray(manifest.assets)) {
    fail(`${file}: "assets" must be an array`);
  }
  const seen = new Set();
  return manifest.assets.map((value, index) => {
    const asset = sourceAsset(value, root, `${file} assets[${String(index)}]`);
    if (seen.has(asset.id)) {
      fail(`asset "${asset.id}": duplicate id`);
    }
    seen.add(asset.id);
    return asset;
  });
}
