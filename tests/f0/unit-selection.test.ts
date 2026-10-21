import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { repoRoot } from "../support/repo.ts";

function withRepository(check: (directory: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "f1-unit-selection-"));
  try {
    git(directory, "init", "--initial-branch=master");
    writeFileSync(path.join(directory, "tyre.rs"), "tyre");
    writeFileSync(path.join(directory, "aero.rs"), "aero");
    commit(directory);
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

function commit(directory: string): string {
  git(directory, "add", ".");
  git(
    directory,
    "-c",
    "user.name=CI selection test",
    "-c",
    "user.email=ci@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "--message=fixture",
  );
  return git(directory, "rev-parse", "HEAD");
}

function select(
  directory: string,
  name: string,
  event: unknown,
  patterns: string,
): string {
  const eventFile = path.join(directory, "event.json");
  const outputFile = path.join(directory, "output.txt");
  writeFileSync(eventFile, JSON.stringify(event));
  writeFileSync(outputFile, "");
  execFileSync(
    process.execPath,
    [path.join(repoRoot, ".github/scripts/unit-changes.mjs")],
    {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: name,
        GITHUB_EVENT_PATH: eventFile,
        GITHUB_OUTPUT: outputFile,
        UNIT_PATHS: patterns,
      },
    },
  );
  return readFileSync(outputFile, "utf8").trim();
}

test("PR selection includes earlier commits and excludes changes only on master", () => {
  withRepository((directory) => {
    git(directory, "checkout", "--quiet", "-b", "feature");
    writeFileSync(path.join(directory, "tyre.rs"), "changed tyre");
    commit(directory);
    writeFileSync(path.join(directory, "docs.md"), "later commit");
    const head = commit(directory);
    git(directory, "checkout", "--quiet", "master");
    writeFileSync(path.join(directory, "aero.rs"), "master only");
    const base = commit(directory);
    const event = {
      pull_request: { base: { sha: base }, head: { sha: head } },
    };
    expect(select(directory, "pull_request", event, "tyre.rs")).toBe(
      "affected=true",
    );
    expect(select(directory, "pull_request", event, "aero.rs")).toBe(
      "affected=false",
    );
  });
});

test("push selection includes both rename paths and deletions", () => {
  withRepository((directory) => {
    const before = git(directory, "rev-parse", "HEAD");
    git(directory, "mv", "tyre.rs", "renamed.rs");
    rmSync(path.join(directory, "aero.rs"));
    const after = commit(directory);
    for (const file of ["tyre.rs", "renamed.rs", "aero.rs"]) {
      expect(select(directory, "push", { before, after }, file)).toBe(
        "affected=true",
      );
    }
    expect(select(directory, "push", { before, after }, "chassis.rs")).toBe(
      "affected=false",
    );
    expect(
      select(
        directory,
        "push",
        { before: "0".repeat(40), after },
        "renamed.rs",
      ),
    ).toBe("affected=true");
  });
});

test("manual runs explicitly select the suite even without matching changes", () => {
  withRepository((directory) => {
    expect(select(directory, "workflow_dispatch", {}, "unrelated/**")).toBe(
      "affected=true",
    );
  });
});
