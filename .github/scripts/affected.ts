import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Crate {
  name: string;
  directory: string;
  paths: string[];
}

export interface Manifests {
  root: string;
  lock: string;
}

export interface Change {
  files: string[];
  crates: Crate[];
  before: Manifests;
  after: Manifests;
}

const everyCrateFiles = new Set([
  "rust-toolchain.toml",
  "clippy.toml",
  ".github/workflows/ci.yml",
  ".github/actions/setup/action.yml",
  ".github/scripts/affected.ts",
]);

const membersList = /^members\s*=\s*\[[^\]]*\]\s*$/m;

function within(file: string, owned: string): boolean {
  return file === owned || file.startsWith(`${owned}/`);
}

function lockBlocks(lock: string): Map<string, string> {
  return new Map(
    lock
      .split("[[package]]")
      .slice(1)
      .map((block) => [
        block.trim(),
        /^name = "([^"]+)"/m.exec(block)?.[1] ?? "",
      ]),
  );
}

function changedPackages(before: string, after: string): Set<string> {
  const old = lockBlocks(before);
  const now = lockBlocks(after);
  const changed = (from: Map<string, string>, to: Map<string, string>) =>
    [...from].filter(([block]) => !to.has(block)).map(([, name]) => name);
  return new Set([...changed(now, old), ...changed(old, now)]);
}

function lockDependencies(lock: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const [block, name] of lockBlocks(lock)) {
    const list = /^dependencies = \[([^\]]*)\]/m.exec(block)?.[1] ?? "";
    const names = [...list.matchAll(/"([^" ]+)/g)].map(
      (match) => match[1] ?? "",
    );
    graph.set(name, [...(graph.get(name) ?? []), ...names]);
  }
  return graph;
}

function reaches(
  graph: Map<string, string[]>,
  from: string,
  targets: Set<string>,
): boolean {
  const seen = new Set<string>();
  const pending = [from];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (targets.has(name)) {
      return true;
    }
    if (!seen.has(name)) {
      seen.add(name);
      pending.push(...(graph.get(name) ?? []));
    }
  }
  return false;
}

function changesEveryCrate(change: Change): boolean {
  return (
    change.files.some((file) => everyCrateFiles.has(file)) ||
    change.before.root.replace(membersList, "") !==
      change.after.root.replace(membersList, "")
  );
}

export function affectedCrates(change: Change): string[] {
  if (changesEveryCrate(change)) {
    return change.crates.map((crate) => crate.name).sort();
  }
  const directories = new Set(change.crates.map((crate) => crate.directory));
  const changed = (owned: string[]) =>
    owned.some((entry) => change.files.some((file) => within(file, entry)));
  const touched = new Set([
    ...change.crates
      .filter((crate) => changed([crate.directory]))
      .map((crate) => crate.name),
    ...changedPackages(change.before.lock, change.after.lock),
  ]);
  const graph = lockDependencies(change.after.lock);
  return change.crates
    .filter(
      (crate) =>
        reaches(graph, crate.name, touched) ||
        changed(crate.paths.filter((entry) => !directories.has(entry))),
    )
    .map((crate) => crate.name)
    .sort();
}

export function workspaceCrates(
  root: string,
  read: (file: string) => string,
): Crate[] {
  const members = /^members\s*=\s*\[([^\]]*)\]/m.exec(root)?.[1] ?? "";
  return [...members.matchAll(/"([^"]+)"/g)].map((match) => {
    const directory = match[1] ?? "";
    const manifest = read(path.join(directory, "Cargo.toml"));
    const name = /^name\s*=\s*"([^"]+)"/m.exec(manifest)?.[1];
    if (name === undefined) {
      throw new Error(`${directory}/Cargo.toml has no package name`);
    }
    const paths = [...manifest.matchAll(/\bpath\s*=\s*"([^"]+)"/g)].map(
      (entry) => path.join(directory, entry[1] ?? ""),
    );
    return { name, directory, paths };
  });
}

interface GitHubEvent {
  before?: string;
  after?: string;
  pull_request?: { base: { sha: string }; head: { sha: string } };
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function showAt(revision: string, file: string): string {
  try {
    return execFileSync("git", ["show", `${revision}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function comparedRange(event: GitHubEvent): [string, string] | undefined {
  if (event.pull_request !== undefined) {
    const head = event.pull_request.head.sha;
    return [
      git(["merge-base", event.pull_request.base.sha, head]).trim(),
      head,
    ];
  }
  if (
    event.before !== undefined &&
    event.after !== undefined &&
    !/^0+$/.test(event.before)
  ) {
    return [event.before, event.after];
  }
  return undefined;
}

function selection(event: GitHubEvent): { crates: string[]; code: boolean } {
  const range = comparedRange(event);
  const root = readFileSync("Cargo.toml", "utf8");
  const crates = workspaceCrates(root, (file) => readFileSync(file, "utf8"));
  if (range === undefined) {
    return { crates: crates.map((crate) => crate.name).sort(), code: true };
  }
  const [base, head] = range;
  const files = git(["diff", "--name-only", "--no-renames", "-z", base, head])
    .split("\0")
    .filter(Boolean);
  const manifests = (revision: string) => ({
    root: showAt(revision, "Cargo.toml"),
    lock: showAt(revision, "Cargo.lock"),
  });
  return {
    crates: affectedCrates({
      files,
      crates,
      before: manifests(base),
      after: manifests(head),
    }),
    code: files.some((file) => !/(^docs\/|\.md$)/.test(file)),
  };
}

if (import.meta.main) {
  const event = JSON.parse(
    readFileSync(process.env["GITHUB_EVENT_PATH"] ?? "", "utf8"),
  ) as GitHubEvent;
  const { crates, code } = selection(event);
  appendFileSync(
    process.env["GITHUB_OUTPUT"] ?? "",
    `crates=${JSON.stringify(crates)}\ncode=${String(code)}\n`,
  );
  process.stdout.write(
    `Rust crates: ${crates.join(", ") || "none"}\nCode changed: ${String(code)}\n`,
  );
}
