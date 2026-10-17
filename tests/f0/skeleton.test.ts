import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";
import {
  cargoPackages,
  listRepoFiles,
  listTrackedFiles,
  readManifest,
  readRepoFile,
  repoRoot,
  run,
  runScript,
} from "../support/repo.ts";

function mentionsScript(command: string, script: string): boolean {
  return new RegExp(`(^|[\\s"'])${script}($|[\\s"'&;|])`).test(command);
}

test("root package.json is a private ES module package with the build, test and verify scripts", () => {
  const manifest = readManifest("package.json");
  expect(manifest.private).toBe(true);
  expect(manifest.type).toBe("module");
  expect(typeof manifest.engines?.["node"]).toBe("string");
  const scripts = manifest.scripts ?? {};
  for (const script of [
    "check",
    "build",
    "test",
    "test:rust",
    "test:e2e",
    "verify",
  ]) {
    expect(typeof scripts[script], `missing script ${script}`).toBe("string");
  }
  const verify = scripts["verify"] ?? "";
  for (const part of ["check", "test:rust", "build", "test", "test:e2e"]) {
    expect(mentionsScript(verify, part), `verify must run ${part}`).toBe(true);
  }
  expect(scripts["test"]).toMatch(/\bvitest run\b/);
  expect(scripts["test:e2e"]).toMatch(/\bplaywright test\b/);
  expect(scripts["test:rust"]).toMatch(/\bcargo test\b.*--workspace/);
  expect(scripts["test:rust"]).toMatch(/--locked/);
});

function expectScriptsUsePnpm(file: string): void {
  for (const [name, command] of Object.entries(
    readManifest(file).scripts ?? {},
  )) {
    expect(command, `${file} ${name} must use pnpm`).not.toMatch(
      /(^|[\s&|;(])(npm|npx|yarn)(\s|$)/,
    );
  }
}

test("dependencies are managed by the pinned pnpm and nothing else", () => {
  const manifest = readManifest("package.json");
  expect(manifest.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  expect(
    manifest.workspaces,
    "pnpm reads workspaces from pnpm-workspace.yaml, not package.json",
  ).toBeUndefined();
  const workspace = parse(readRepoFile("pnpm-workspace.yaml")) as {
    packages?: string[];
  } | null;
  const packages = workspace?.packages ?? [];
  expect(
    packages.includes("apps/*") || packages.includes("apps/client"),
    "pnpm-workspace.yaml packages must include apps/client",
  ).toBe(true);
  expect(listTrackedFiles()).toContain("pnpm-lock.yaml");
  for (const file of listRepoFiles()) {
    expect(
      path.basename(file),
      `${file}: only pnpm-lock.yaml may lock dependencies`,
    ).not.toMatch(
      /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/,
    );
    if (path.basename(file) === "package.json") {
      expectScriptsUsePnpm(file);
    }
  }
});

test("the client is a Vite app whose page loads src/main.ts", () => {
  const manifest = readManifest("apps/client/package.json");
  expect(manifest.private).toBe(true);
  expect(manifest.scripts?.["build"]).toMatch(/\bvite build\b/);
  expect(manifest.scripts?.["preview"]).toMatch(/\bvite preview\b/);
  expect(existsSync(path.join(repoRoot, "apps/client/src/main.ts"))).toBe(true);
  expect(readRepoFile("apps/client/index.html")).toMatch(
    /<script\s+type="module"\s+src="\/src\/main\.ts"\s*><\/script>/,
  );
});

test("the Node version is pinned and is the one running these tests", () => {
  const pinFiles = [".nvmrc", ".node-version"].filter((file) =>
    existsSync(path.join(repoRoot, file)),
  );
  expect(pinFiles, "exactly one of .nvmrc or .node-version").toHaveLength(1);
  const pinned = readRepoFile(pinFiles[0] ?? "").trim();
  expect(pinned).toMatch(/^v?\d+\.\d+\.\d+$/);
  expect(process.versions.node.split(".")[0]).toBe(
    pinned.replace(/^v/, "").split(".")[0],
  );
});

test("the Rust toolchain is pinned with rustfmt, clippy and the WebAssembly target", () => {
  const toolchain = readRepoFile("rust-toolchain.toml");
  expect(toolchain).toMatch(/^\[toolchain\]$/m);
  expect(toolchain).toMatch(/^channel\s*=\s*"\d+\.\d+\.\d+"$/m);
  expect(toolchain).toMatch(/^components\s*=\s*\[[^\]]*"rustfmt"[^\]]*\]$/m);
  expect(toolchain).toMatch(/^components\s*=\s*\[[^\]]*"clippy"[^\]]*\]$/m);
  expect(toolchain).toMatch(
    /^targets\s*=\s*\[[^\]]*"wasm32-unknown-unknown"[^\]]*\]$/m,
  );
  const active = run("rustup", ["show", "active-toolchain"]);
  expect(active.code, active.output).toBe(0);
  expect(active.stdout).toMatch(/rust-toolchain\.toml/);
  const targets = run("rustup", ["target", "list", "--installed"]);
  expect(targets.code, targets.output).toBe(0);
  expect(targets.stdout).toMatch(/^wasm32-unknown-unknown$/m);
});

test("the Cargo workspace contains the physics library crate on edition 2024", () => {
  const rootManifest = readRepoFile("Cargo.toml");
  expect(rootManifest).toMatch(/^\[workspace\]$/m);
  expect(rootManifest).toMatch(/^resolver\s*=\s*"3"$/m);
  expect(listTrackedFiles()).toContain("Cargo.lock");
  const packages = cargoPackages();
  const physics = packages.find((entry) => entry.name === "physics");
  expect(physics, "a package named physics must exist").toBeDefined();
  expect(path.relative(repoRoot, physics?.manifest_path ?? "")).toBe(
    path.join("crates", "physics", "Cargo.toml"),
  );
  expect(
    physics?.targets.some((target) =>
      target.kind.some((kind) => ["lib", "rlib", "cdylib"].includes(kind)),
    ),
  ).toBe(true);
  for (const entry of packages) {
    expect(entry.edition, `${entry.name} edition`).toBe("2024");
  }
});

test("the physics crate compiles for WebAssembly", () => {
  const build = run("cargo", [
    "build",
    "--package",
    "physics",
    "--target",
    "wasm32-unknown-unknown",
    "--locked",
  ]);
  expect(build.code, build.output).toBe(0);
});

test("the Rust tests pass and the production build writes the client page", () => {
  const rust = runScript("test:rust");
  expect(rust.code, rust.output).toBe(0);
  const build = runScript("build");
  expect(build.code, build.output).toBe(0);
  expect(existsSync(path.join(repoRoot, "apps/client/dist/index.html"))).toBe(
    true,
  );
});

test("build output, dependencies and OS junk are ignored and never committed", () => {
  for (const file of [
    "node_modules/example/index.js",
    "apps/client/node_modules/example/index.js",
    "apps/client/dist/index.html",
    "target/debug/physics",
    "test-results/report.json",
    "playwright-report/index.html",
    ".DS_Store",
    "apps/client/.DS_Store",
  ]) {
    const ignored = run("git", ["check-ignore", "--quiet", "--no-index", file]);
    expect(ignored.code, `${file} must be ignored by .gitignore`).toBe(0);
  }
  const junk = listTrackedFiles().filter((file) =>
    /(^|\/)(node_modules|dist|target|test-results|playwright-report)\/|(^|\/)\.DS_Store$|\.log$|\.tsbuildinfo$/.test(
      file,
    ),
  );
  expect(junk).toEqual([]);
});
