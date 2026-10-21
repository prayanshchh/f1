import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

function matchesUnitPaths(files, patterns) {
  return files.some((file) =>
    patterns.some((pattern) => path.matchesGlob(file, pattern)),
  );
}

function changedFiles(eventName, event) {
  if (eventName === "pull_request") {
    return gitFiles([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      `${event.pull_request.base.sha}...${event.pull_request.head.sha}`,
    ]);
  }
  if (eventName === "push") {
    return /^0+$/.test(event.before)
      ? gitFiles(["ls-tree", "-r", "--name-only", "-z", event.after])
      : gitFiles([
          "diff",
          "--name-only",
          "--no-renames",
          "-z",
          event.before,
          event.after,
        ]);
  }
  throw new Error(`Unsupported change event: ${eventName}`);
}

function gitFiles(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

if (import.meta.main) {
  const patterns = (process.env.UNIT_PATHS ?? "")
    .split("\n")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  if (patterns.length === 0) {
    throw new Error("A unit workflow must declare its affected paths");
  }
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const affected =
    eventName === "workflow_dispatch" ||
    matchesUnitPaths(changedFiles(eventName, event), patterns);
  appendFileSync(process.env.GITHUB_OUTPUT, `affected=${affected}\n`);
  process.stdout.write(`Unit suite ${affected ? "selected" : "skipped"}\n`);
}
