import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export interface RunResult {
  code: number | null;
  stdout: string;
  output: string;
}

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
}

function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...extra };
}

export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: environment(options.env),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    code: result.status,
    stdout: result.stdout,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

export function runScript(script: string): RunResult {
  return run("pnpm", ["--silent", "run", script]);
}

function gitFiles(root: string, args: readonly string[]): string[] {
  const result = run("git", ["ls-files", "-z", ...args], { cwd: root });
  if (result.code !== 0) {
    throw new Error(`git ls-files failed: ${result.output}`);
  }
  return result.stdout
    .split("\0")
    .filter((file) => file !== "")
    .filter((file) => existsSync(path.join(root, file)))
    .sort();
}

export function listRepoFiles(): string[] {
  return gitFiles(repoRoot, ["--cached", "--others", "--exclude-standard"]);
}

export function listTrackedFiles(): string[] {
  return gitFiles(repoRoot, ["--cached"]);
}

export function readRepoFile(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

function readJson(file: string): unknown {
  return JSON.parse(readRepoFile(file));
}

export interface PackageManifest {
  private?: boolean;
  type?: string;
  packageManager?: string;
  workspaces?: unknown;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
}

export function readManifest(file: string): PackageManifest {
  return readJson(file) as PackageManifest;
}

export function hasExtension(
  file: string,
  extensions: readonly string[],
): boolean {
  return extensions.includes(path.extname(file));
}
