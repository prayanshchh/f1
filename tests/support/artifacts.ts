import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot, run } from "./repo.ts";
import { releaseExecutable } from "./cargo.ts";

const wasmDirectory = path.join(repoRoot, "apps", "client", "wasm");
const wasmFiles = ["physics.js", "physics_bg.wasm"];

export interface Artifacts {
  directory: string;
  problem: string | null;
}

function buildWasm(): void {
  const build = run("pnpm", ["--silent", "run", "build:wasm"]);
  if (build.code !== 0) {
    throw new Error(`pnpm run build:wasm failed:\n${build.output}`);
  }
  for (const file of wasmFiles) {
    if (!existsSync(path.join(wasmDirectory, file))) {
      throw new Error(
        `pnpm run build:wasm did not write apps/client/wasm/${file}`,
      );
    }
  }
}

export function buildArtifacts(): Artifacts {
  const directory = mkdtempSync(path.join(tmpdir(), "f1-artifacts-"));
  try {
    buildWasm();
    for (const file of wasmFiles) {
      copyFileSync(path.join(wasmDirectory, file), path.join(directory, file));
    }
    copyFileSync(
      releaseExecutable(["--package", "replay"]),
      path.join(directory, "replay"),
    );
    return { directory, problem: null };
  } catch (error) {
    return { directory, problem: String(error) };
  }
}

export function removeArtifacts(artifacts: Artifacts): void {
  rmSync(artifacts.directory, { recursive: true, force: true });
}
