import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import type { Plugin, Rolldown } from "vite";
import { losslessWebp, packGlb, pngInfo } from "./asset-codec.ts";

const packVersion = "1";
const packable = /\.(?:glb|png)\?url$/;
const compressible = /\.(?:glb|hdr|bin)$/;
const unchanged = "unchanged";
const brotliShare = 0.95;
const squeeze = promisify(brotliCompress);

function digest(kind: string, bytes: Uint8Array): string {
  return createHash("sha256")
    .update(`${kind}:${packVersion}:`)
    .update(bytes)
    .digest("hex");
}

function stored(file: string): Promise<Buffer | null> {
  return readFile(file).catch(() => null);
}

async function store(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

function pack(source: Buffer): Promise<Uint8Array | null> {
  if (pngInfo(source)) return losslessWebp(source, true);
  if (source.subarray(0, 4).toString("latin1") !== "glTF")
    return Promise.resolve(null);
  return packGlb(source);
}

class AssetCache {
  private readonly used = new Set<string>();

  constructor(private readonly root: string) {}

  private entry(kind: string, name: string): string {
    const entry = path.join(this.root, kind, name);
    this.used.add(entry);
    return entry;
  }

  async packed(file: string): Promise<string | null> {
    const source = await readFile(file);
    const folder = this.entry("packed", digest(path.extname(file), source));
    if (await stored(path.join(folder, unchanged))) return null;
    const name = path.basename(file).replace(/\.png$/, ".webp");
    const target = path.join(folder, name);
    if (await stored(target)) return target;
    const bytes = await pack(source);
    await store(
      bytes ? target : path.join(folder, unchanged),
      bytes ?? new Uint8Array([1]),
    );
    return bytes ? target : null;
  }

  async brotli(source: Uint8Array): Promise<Uint8Array | null> {
    const file = this.entry("brotli", digest("br", source));
    const hit = await stored(file);
    if (hit) return hit.length > 0 ? hit : null;
    const squeezed = await squeeze(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_LGWIN]: constants.BROTLI_MAX_WINDOW_BITS,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    });
    const kept = squeezed.length <= source.length * brotliShare;
    await store(file, kept ? squeezed : new Uint8Array());
    return kept ? squeezed : null;
  }

  async prune(): Promise<void> {
    for (const kind of ["packed", "brotli"]) {
      const folder = path.join(this.root, kind);
      const entries = await readdir(folder).catch(() => []);
      await Promise.all(
        entries
          .map((entry) => path.join(folder, entry))
          .filter((entry) => !this.used.has(entry))
          .map((entry) => rm(entry, { recursive: true, force: true })),
      );
    }
  }
}

function assetBytes(asset: Rolldown.OutputAsset): Uint8Array {
  return typeof asset.source === "string"
    ? Buffer.from(asset.source)
    : asset.source;
}

export function assetPack(): Plugin {
  let cache = new AssetCache("");
  const packing = new Map<string, Promise<string | null>>();
  return {
    name: "revracers-asset-pack",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      cache = new AssetCache(path.join(config.cacheDir, "revracers-assets"));
    },
    async resolveId(source, importer, options) {
      if (!packable.test(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      const file = resolved?.id.split("?")[0];
      if (!resolved || !file) return resolved;
      if (!packing.has(file)) packing.set(file, cache.packed(file));
      const packed = await packing.get(file);
      return packed ? `${packed}?url` : resolved;
    },
    generateBundle: {
      order: "pre",
      async handler(_options, bundle) {
        const assets = Object.values(bundle).filter(
          (file): file is Rolldown.OutputAsset =>
            file.type === "asset" && compressible.test(file.fileName),
        );
        await Promise.all(
          assets.map(async (asset) => {
            const squeezed = await cache.brotli(assetBytes(asset));
            if (squeezed)
              this.emitFile({
                type: "asset",
                fileName: `${asset.fileName}.br`,
                source: squeezed,
              });
          }),
        );
        await cache.prune();
      },
    },
  };
}
