import { execFileSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "apps/client/dist");
const site = "https://revracers.com";
const bucket = "revracers-assets";
const assetLimit = 25 * 1024 * 1024;
const types = {
  ".glb": "model/gltf-binary",
  ".hdr": "image/vnd.radiance",
  ".wasm": "application/wasm",
  ".js": "text/javascript",
};
const headers = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
`;

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

async function live(key) {
  const response = await fetch(`${site}/${key}`, { method: "HEAD" }).catch(
    () => null,
  );
  return response?.ok === true;
}

run("pnpm", ["run", "build"]);

const big = files(dist)
  .filter((file) => statSync(file).size > assetLimit)
  .map((file) => path.relative(dist, file).split(path.sep).join("/"));

for (const key of big) {
  if (await live(key)) {
    process.stdout.write(`already in R2: ${key}\n`);
    continue;
  }
  run("pnpm", [
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--file",
    path.join(dist, key),
    "--content-type",
    types[path.extname(key)] ?? "application/octet-stream",
    "--remote",
  ]);
}

writeFileSync(path.join(dist, ".assetsignore"), `${big.join("\n")}\n`);
writeFileSync(path.join(dist, "_headers"), headers);
run("pnpm", ["exec", "wrangler", "deploy"]);
