import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "apps/client/dist");
const site = "https://revracers.com";
const bucket = "revracers-assets";
const assetLimit = 25 * 1024 * 1024;
const partSize = 16 * 1024 * 1024;
const uploadTries = 4;
const storedKey = "big-files.json";
const oldFilesGrace = 10 * 60 * 1000;
const headers = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function wrangler(args, stdio = "inherit") {
  execFileSync("pnpm", ["exec", "wrangler", ...args], { cwd: root, stdio });
}

function partKey(key, index) {
  return `${key}/${String(index).padStart(3, "0")}`;
}

function upload(key, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      wrangler([
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
      upload(partKey(key, index), part);
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

function readStored() {
  const scratch = mkdtempSync(path.join(tmpdir(), "revracers-stored-"));
  const file = path.join(scratch, storedKey);
  try {
    wrangler(
      [
        "r2",
        "object",
        "get",
        `${bucket}/${storedKey}`,
        "--file",
        file,
        "--remote",
      ],
      ["ignore", "ignore", "pipe"],
    );
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (String(error.stderr).includes("The specified key does not exist"))
      return [];
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function writeStored(stored) {
  const scratch = mkdtempSync(path.join(tmpdir(), "revracers-stored-"));
  const file = path.join(scratch, storedKey);
  try {
    writeFileSync(file, JSON.stringify(stored));
    upload(storedKey, file);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function remove(file) {
  for (let index = 0; index < file.parts; index++)
    wrangler([
      "r2",
      "object",
      "delete",
      `${bucket}/${partKey(file.key, index)}`,
      "--remote",
    ]);
  process.stdout.write(`deleted from R2: ${file.key}\n`);
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

if (!process.env.GITHUB_ACTIONS) {
  process.stderr.write(
    "Deploys run only on GitHub Actions, one at a time. Use `pnpm run deploy`, or `pnpm run deploy -- -f commit=<sha>` to roll back.\n",
  );
  process.exit(1);
}

const stored = readStored();
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
const current = big.map((key) => ({
  key,
  parts: Math.ceil(statSync(path.join(dist, key)).size / partSize),
}));
const used = new Set(big);
const old = stored.filter((file) => !used.has(file.key));
writeStored([...old, ...current]);
wrangler(["deploy"]);

if (old.length > 0) {
  process.stdout.write(
    `waiting ${oldFilesGrace / 60000} minutes for pages still loading the old files\n`,
  );
  await sleep(oldFilesGrace);
  for (const file of old) remove(file);
}
writeStored(current);
