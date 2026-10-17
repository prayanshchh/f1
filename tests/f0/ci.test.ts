import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { readRepoFile, repoRoot } from "../support/repo.ts";

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string | boolean;
  with?: Record<string, unknown>;
  "continue-on-error"?: unknown;
}

interface Job {
  if?: string | boolean;
  steps?: Step[];
  "continue-on-error"?: unknown;
}

interface Workflow {
  on?: {
    push?: { branches?: string[]; paths?: unknown };
    pull_request?: { paths?: unknown } | null;
  };
  jobs?: Record<string, Job>;
}

function loadWorkflow(): Workflow {
  return parse(readRepoFile(".github/workflows/ci.yml")) as Workflow;
}

function allSteps(workflow: Workflow): Step[] {
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

const runsVerify = (step: Step) => /\bpnpm run verify\b/.test(step.run ?? "");

test("CI runs on every push to master and on every pull request", () => {
  const triggers = loadWorkflow().on;
  expect(typeof triggers, "on: must be a mapping").toBe("object");
  expect(triggers?.push?.branches, "push to master").toContain("master");
  expect(Object.hasOwn(triggers ?? {}, "pull_request"), "pull_request").toBe(
    true,
  );
  expect(triggers?.push?.paths, "push must not be limited to paths").toBe(
    undefined,
  );
  expect(
    triggers?.pull_request?.paths,
    "PRs must not be limited to paths",
  ).toBe(undefined);
});

test("CI installs exactly what the lockfiles and pins say, then runs verify", () => {
  const workflow = loadWorkflow();
  const pinFile = [".nvmrc", ".node-version"].find((file) =>
    existsSync(path.join(repoRoot, file)),
  );
  const verifyJobs = Object.values(workflow.jobs ?? {}).filter((job) =>
    (job.steps ?? []).some(runsVerify),
  );
  expect(verifyJobs, "exactly one job runs pnpm run verify").toHaveLength(1);
  const steps = verifyJobs[0]?.steps ?? [];
  const position = (predicate: (step: Step) => boolean, label: string) => {
    const index = steps.findIndex(predicate);
    expect(index, `missing step: ${label}`).not.toBe(-1);
    return index;
  };
  const checkout = position(
    (step) => /^actions\/checkout@/.test(step.uses ?? ""),
    "actions/checkout",
  );
  const setupPnpm = position(
    (step) =>
      /^pnpm\/action-setup@/.test(step.uses ?? "") &&
      step.with?.["version"] === undefined,
    "pnpm/action-setup taking its version from packageManager",
  );
  const setupNode = position(
    (step) =>
      /^actions\/setup-node@/.test(step.uses ?? "") &&
      step.with?.["node-version-file"] === pinFile,
    `actions/setup-node with node-version-file ${String(pinFile)}`,
  );
  const install = position(
    (step) => /\bpnpm install --frozen-lockfile\b/.test(step.run ?? ""),
    "pnpm install --frozen-lockfile",
  );
  const browsers = position(
    (step) => /\bplaywright install\b/.test(step.run ?? ""),
    "playwright install",
  );
  const machete = position(
    (step) =>
      /cargo-machete/.test(
        `${step.run ?? ""} ${JSON.stringify(step.with ?? {})}`,
      ),
    "cargo-machete installation",
  );
  const verify = position(runsVerify, "verify");
  expect(checkout).toBeLessThan(setupPnpm);
  expect(setupPnpm).toBeLessThan(setupNode);
  expect(setupNode).toBeLessThan(install);
  expect(install).toBeLessThan(browsers);
  expect(browsers).toBeLessThan(verify);
  expect(machete).toBeLessThan(verify);
  for (const step of allSteps(workflow)) {
    const command = step.run ?? "";
    expect(command, "use pnpm").not.toMatch(/(^|[\s&|;(])(npm|npx|yarn)(\s|$)/);
    for (const installCommand of command.match(
      /\bpnpm (install|i|add)\b[^\n&|;]*/g,
    ) ?? []) {
      expect(installCommand).toMatch(/^pnpm install --frozen-lockfile\b/);
    }
  }
});

function expectNoIgnoredFailure(part: Job | Step, label: string): void {
  expect(Object.hasOwn(part, "continue-on-error"), label).toBe(false);
  expect(String(part.if ?? ""), label).not.toMatch(/\bfalse\b/);
}

const runsBrowserTests = (step: Step) =>
  /\bpnpm run (verify|test:e2e)\b|\bplaywright test\b/.test(step.run ?? "");

test("CI runs the browser tests inside a virtual display big enough for every test window", () => {
  const browserSteps = allSteps(loadWorkflow()).filter(runsBrowserTests);
  expect(
    browserSteps.length,
    "a step must run the browser tests",
  ).toBeGreaterThan(0);
  for (const step of browserSteps) {
    const command = step.run ?? "";
    expect(command, "Chrome needs a display on Linux").toMatch(/^xvfb-run\s/);
    const screen = /-screen\s+0\s+(\d+)x(\d+)x(\d+)/.exec(command);
    expect(screen, `${command} must set the virtual screen size`).not.toBe(
      null,
    );
    const [, width = "0", height = "0", depth = "0"] = screen ?? [];
    expect(Number(width), "screen width").toBeGreaterThanOrEqual(1440);
    expect(Number(height), "screen height").toBeGreaterThanOrEqual(900);
    expect(Number(depth), "screen colour depth").toBe(24);
  }
});

test("CI never ignores a failing step", () => {
  for (const [name, job] of Object.entries(loadWorkflow().jobs ?? {})) {
    expectNoIgnoredFailure(job, name);
    for (const step of job.steps ?? []) {
      const label = `${name}: ${step.name ?? step.uses ?? step.run ?? ""}`;
      expectNoIgnoredFailure(step, label);
      expect(step.run ?? "", label).not.toMatch(
        /\|\|\s*(true\b|:(\s|$)|exit\s+0\b)|;\s*exit\s+0\b/,
      );
    }
  }
});
