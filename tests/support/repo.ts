import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

function runAsync(
  command: string,
  args: readonly string[],
  options: Required<RunOptions>,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: environment(options.env),
    });
    let stdout = "";
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, output });
    });
  });
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

export interface CargoPackage {
  name: string;
  edition: string;
  manifest_path: string;
  targets: { kind: string[] }[];
  dependencies: { name: string; kind: string | null }[];
}

export function cargoPackages(): CargoPackage[] {
  const metadata = run("cargo", [
    "metadata",
    "--format-version",
    "1",
    "--no-deps",
    "--locked",
  ]);
  if (metadata.code !== 0) {
    throw new Error(`cargo metadata failed: ${metadata.output}`);
  }
  return (JSON.parse(metadata.stdout) as { packages: CargoPackage[] }).packages;
}

export function hasExtension(
  file: string,
  extensions: readonly string[],
): boolean {
  return extensions.includes(path.extname(file));
}

function nodeModulesDirectories(): string[] {
  return listRepoFiles()
    .filter((file) => path.basename(file) === "package.json")
    .map((file) => path.join(path.dirname(file), "node_modules"))
    .filter((directory) => existsSync(path.join(repoRoot, directory)));
}

const probeCargoTargetDirectory = path.join(repoRoot, "target", "probe");

export interface ProbeCopy {
  root: string;
  write: (file: string, content: string) => void;
  append: (file: string, content: string) => void;
  read: (file: string) => string;
  run: (command: string, args: readonly string[]) => Promise<RunResult>;
  runScript: (script: string) => Promise<RunResult>;
  remove: () => void;
}

export function createProbeCopy(): ProbeCopy {
  const root = mkdtempSync(path.join(tmpdir(), "repo-probe-"));
  for (const file of listRepoFiles()) {
    const destination = path.join(root, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(repoRoot, file), destination);
  }
  for (const directory of nodeModulesDirectories()) {
    symlinkSync(
      path.join(repoRoot, directory),
      path.join(root, directory),
      "dir",
    );
  }
  const runInCopy = (command: string, args: readonly string[]) =>
    runAsync(command, args, {
      cwd: root,
      env: { CARGO_TARGET_DIR: probeCargoTargetDirectory },
    });
  return {
    root,
    write(file, content) {
      const destination = path.join(root, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    },
    append(file, content) {
      appendFileSync(path.join(root, file), content);
    },
    read(file) {
      return readFileSync(path.join(root, file), "utf8");
    },
    run: runInCopy,
    runScript(script) {
      return runInCopy("pnpm", ["--silent", "run", script]);
    },
    remove() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
