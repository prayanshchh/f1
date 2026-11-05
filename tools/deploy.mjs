import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "apps/client/dist");
const site = "https://revracers.com";
const bucket = "revracers-assets";
const assetLimit = 25 * 1024 * 1024;
const partSize = 16 * 1024 * 1024;
const uploadTries = 4;
const headers = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function upload(key, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      run("pnpm", [
        "exec",
        "wrangler",
        "r2",
        "object",
        "put",
        `${bucket}/${key}`,
        "--file",
        file,
        "--remote",
      ]);
      return;
    } catch (error) {
      if (attempt >= uploadTries) throw error;
    }
  }
}

function uploadInParts(key, file) {
  const scratch = mkdtempSync(path.join(tmpdir(), "revracers-part-"));
  const input = openSync(file, "r");
  const buffer = Buffer.alloc(partSize);
  try {
    for (let index = 0; ; index++) {
      const read = readSync(input, buffer, 0, partSize, index * partSize);
      if (read === 0) return;
      const part = path.join(scratch, String(index));
      writeFileSync(part, buffer.subarray(0, read));
      upload(`${key}/${String(index).padStart(3, "0")}`, part);
      rmSync(part);
    }
  } finally {
    closeSync(input);
    rmSync(scratch, { recursive: true, force: true });
  }
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

async function live(key, size) {
  const response = await fetch(`${site}/${key}`).catch((error) => {
    throw new Error(`cannot reach ${site} to check ${key}; check the network`, {
      cause: error,
    });
  });
  await response.body?.cancel();
  return response.ok && Number(response.headers.get("content-length")) === size;
}

run("pnpm", ["run", "build"]);

const big = files(dist)
  .filter((file) => statSync(file).size > assetLimit)
  .map((file) => path.relative(dist, file).split(path.sep).join("/"));

for (const key of big) {
  if (await live(key, statSync(path.join(dist, key)).size)) {
    process.stdout.write(`already in R2: ${key}\n`);
    continue;
  }
  uploadInParts(key, path.join(dist, key));
}

writeFileSync(path.join(dist, ".assetsignore"), `${big.join("\n")}\n`);
writeFileSync(path.join(dist, "_headers"), headers);
run("pnpm", ["exec", "wrangler", "deploy"]);
