import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { repoRoot } from "../support/repo.ts";

const config = path.join(repoRoot, "wrangler.jsonc");
const partSize = 64 * 1024;

function bytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = (i * seed + (i >> 7)) & 255;
  return out;
}

function noise(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

const small = bytes(200_000, 3);
const plain = bytes(90_000, 5);
const big = noise(300_000, 7);
const smallBrotli = brotliCompressSync(small);
const bigBrotli = brotliCompressSync(big);

interface Bucket {
  put(key: string, value: Uint8Array): Promise<unknown>;
}

interface DevWorker {
  fetch(path: string): Promise<{
    status: number;
    headers: Headers;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  stop(): Promise<void>;
}

interface Wrangler {
  getPlatformProxy(options: {
    configPath: string;
    persist: { path: string };
  }): Promise<{ env: { BIG_FILES: Bucket }; dispose(): Promise<void> }>;
  unstable_dev(script: string, options: object): Promise<DevWorker>;
}

const wranglerModule = "wrangler";
const wrangler = (await import(wranglerModule)) as Wrangler;

let worker: DevWorker;
let scratch: string;
let bigParts = 0;

async function seedBucket(persist: string): Promise<void> {
  const proxy = await wrangler.getPlatformProxy({
    configPath: config,
    persist: { path: path.join(persist, "v3") },
  });
  try {
    for (let at = 0; at < bigBrotli.length; at += partSize, bigParts++)
      await proxy.env.BIG_FILES.put(
        `assets/big.glb.br/${String(bigParts).padStart(3, "0")}`,
        bigBrotli.subarray(at, at + partSize),
      );
  } finally {
    await proxy.dispose();
  }
}

beforeAll(async () => {
  process.env["CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"] ??=
    "postgres://revracers:revracers@127.0.0.1:9/revracers";
  scratch = mkdtempSync(path.join(tmpdir(), "revracers-serving-"));
  const assets = path.join(scratch, "dist");
  mkdirSync(path.join(assets, "assets"), { recursive: true });
  writeFileSync(path.join(assets, "index.html"), "<!doctype html>");
  writeFileSync(path.join(assets, "assets/small.glb"), small);
  writeFileSync(path.join(assets, "assets/small.glb.br"), smallBrotli);
  writeFileSync(path.join(assets, "assets/plain.hdr"), plain);
  const persist = path.join(scratch, "state");
  await seedBucket(persist);
  worker = await wrangler.unstable_dev(
    path.join(repoRoot, "apps/worker/src/index.ts"),
    {
      config,
      assets,
      persistTo: persist,
      logLevel: "error",
      experimental: { disableExperimentalWarning: true },
    },
  );
});

afterAll(async () => {
  await worker.stop();
  rmSync(scratch, { recursive: true, force: true });
});

async function body(response: {
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe("serving the big game files", () => {
  test("a model with a brotli copy is sent brotli-encoded and decodes to the original", async () => {
    const response = await worker.fetch("/assets/small.glb");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("content-type")).toBe("model/gltf-binary");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect((await body(response)).equals(small)).toBe(true);
  });

  test("a file without a brotli copy is sent as it is", async () => {
    const response = await worker.fetch("/assets/plain.hdr");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-type")).toBe("image/vnd.radiance");
    expect((await body(response)).equals(plain)).toBe(true);
  });

  test("a brotli copy stored in parts in R2 is stitched and sent encoded", async () => {
    expect(bigParts).toBeGreaterThanOrEqual(3);
    const response = await worker.fetch("/assets/big.glb");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect((await body(response)).equals(big)).toBe(true);
  });

  test("asking for the brotli copy itself returns its exact stored bytes", async () => {
    const response = await worker.fetch("/assets/big.glb.br");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(Number(response.headers.get("content-length"))).toBe(
      bigBrotli.length,
    );
    expect((await body(response)).equals(bigBrotli)).toBe(true);
  });

  test("a missing file is a 404", async () => {
    const response = await worker.fetch("/assets/missing.glb");
    expect(response.status).toBe(404);
    await response.arrayBuffer();
  });
});
