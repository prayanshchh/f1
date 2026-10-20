import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";
import {
  cargoPackages,
  listRepoFiles,
  readRepoFile,
  repoRoot,
} from "../support/repo.ts";
import integrationConfig from "../../vitest.integration.config.ts";
import unitConfig from "../../vitest.unit.config.ts";
import browserConfig from "../../playwright.config.ts";
import ciBrowserConfig from "../../playwright.ci.config.ts";

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
  needs?: unknown;
  uses?: string;
  with?: Record<string, unknown>;
  steps?: Step[];
  "continue-on-error"?: unknown;
}

interface Trigger {
  branches?: string[];
  paths?: string[];
}

interface Workflow {
  on?: Record<string, Trigger | null>;
  jobs?: Record<string, Job>;
}

function loadWorkflow(file: string): Workflow {
  return parse(readRepoFile(`.github/workflows/${file}`)) as Workflow;
}

function workflows(): [string, Workflow][] {
  return readdirSync(path.join(repoRoot, ".github/workflows"))
    .filter((file) => file.endsWith(".yml"))
    .map((file) => [file, loadWorkflow(file)]);
}

function allSteps(workflow: Workflow): Step[] {
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

function crateWorkflows(): [string, Workflow, Job][] {
  return workflows().flatMap(([file, workflow]) =>
    Object.values(workflow.jobs ?? {})
      .filter((job) => typeof job.with?.["crate"] === "string")
      .map((job): [string, Workflow, Job] => [file, workflow, job]),
  );
}

function unitPaths(workflow: Workflow): string[] {
  const runner = Object.values(workflow.jobs ?? {}).find(
    (job) => job.uses === "./.github/workflows/_unit.yml",
  );
  const paths = runner?.with?.["paths"];
  return typeof paths === "string" ? paths.trim().split("\n") : [];
}

test("integration and quality run on every push to main and every pull request", () => {
  for (const file of ["ci.yml", "quality.yml"]) {
    const triggers = loadWorkflow(file).on;
    expect(typeof triggers, "on: must be a mapping").toBe("object");
    expect(triggers?.["push"]?.branches, "push to main").toContain("main");
    expect(Object.hasOwn(triggers ?? {}, "pull_request"), "pull_request").toBe(
      true,
    );
    expect(triggers?.["push"]?.paths, "push is never path limited").toBe(
      undefined,
    );
    expect(triggers?.["pull_request"]?.paths, "every PR is tested").toBe(
      undefined,
    );
  }
});

test("CI installs exactly what the lockfiles and pins say before running tests", () => {
  const pinFile = [".nvmrc", ".node-version"].find((file) =>
    existsSync(path.join(repoRoot, file)),
  );
  const action = parse(readRepoFile(".github/actions/setup/action.yml")) as {
    runs: { steps: Step[] };
  };
  const steps = action.runs.steps;
  const position = (predicate: (step: Step) => boolean, label: string) => {
    const index = steps.findIndex(predicate);
    expect(index, `missing step: ${label}`).not.toBe(-1);
    return index;
  };
  const pnpm = position(
    (step) =>
      /^pnpm\/action-setup@/.test(step.uses ?? "") &&
      step.with?.["version"] === undefined,
    "pnpm/action-setup reading packageManager",
  );
  const node = position(
    (step) =>
      /^actions\/setup-node@/.test(step.uses ?? "") &&
      step.with?.["node-version-file"] === pinFile,
    "actions/setup-node reading the runtime pin",
  );
  const install = position(
    (step) => /\bpnpm install --frozen-lockfile\b/.test(step.run ?? ""),
    "locked installation",
  );
  const browsers = position(
    (step) => /\bplaywright install\b/.test(step.run ?? ""),
    "Chrome installation",
  );
  position((step) => /cargo-machete/.test(step.run ?? ""), "cargo-machete");
  expect(pnpm).toBeLessThan(node);
  expect(node).toBeLessThan(install);
  expect(install).toBeLessThan(browsers);
  for (const [, workflow] of workflows()) {
    for (const job of Object.values(workflow.jobs ?? {})) {
      if (job.uses !== undefined) {
        continue;
      }
      const checkout = (job.steps ?? []).findIndex((step) =>
        /^actions\/checkout@/.test(step.uses ?? ""),
      );
      const setup = (job.steps ?? []).findIndex(
        (step) => step.uses === "./.github/actions/setup",
      );
      expect(checkout).toBeGreaterThanOrEqual(0);
      if (setup !== -1) {
        expect(setup).toBeGreaterThan(checkout);
      } else {
        expect(job).toEqual(loadWorkflow("_unit.yml").jobs?.["changes"]);
      }
    }
  }
  expectPinnedInstalls([
    ...steps,
    ...workflows().flatMap(([, w]) => allSteps(w)),
  ]);
});

function expectPinnedInstalls(steps: Step[]): void {
  for (const step of steps) {
    const command = step.run ?? "";
    expect(command, "use pnpm").not.toMatch(/(^|[\s&|;(])(npm|npx|yarn)(\s|$)/);
    for (const installCommand of command.match(
      /\bpnpm (install|i|add)\b[^\n&|;]*/g,
    ) ?? []) {
      expect(installCommand).toMatch(/^pnpm install --frozen-lockfile\b/);
    }
  }
}

function expectNoIgnoredFailure(part: Job | Step, label: string): void {
  expect(Object.hasOwn(part, "continue-on-error"), label).toBe(false);
  expect(String(part.if ?? ""), label).not.toMatch(/\bfalse\b/);
}

test("CI never ignores a failing step", () => {
  for (const [file, workflow] of workflows()) {
    for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
      expectNoIgnoredFailure(job, `${file}: ${name}`);
      for (const step of job.steps ?? []) {
        const label = `${file}: ${name}: ${step.name ?? step.uses ?? step.run ?? ""}`;
        expectNoIgnoredFailure(step, label);
        expect(step.run ?? "", label).not.toMatch(
          /\|\|\s*(true\b|:(\s|$)|exit\s+0\b)|;\s*exit\s+0\b/,
        );
      }
    }
  }
});

test("each Rust crate has its own conditional unit workflow", () => {
  const entries = crateWorkflows();
  const packages = cargoPackages();
  expect(entries.map(([, , job]) => job.with?.["crate"]).sort()).toEqual(
    packages.map((entry) => entry.name).sort(),
  );
  for (const [file, workflow, job] of entries) {
    const crate = String(job.with?.["crate"]);
    const paths = unitPaths(workflow);
    expect(paths, `${file}: own crate`).toContain(`crates/${crate}/**`);
    expect(paths, `${file}: workflow edits`).toContain(
      `.github/workflows/${file}`,
    );
    expect(paths, `${file}: dependencies`).toContain("Cargo.*");
    expect(workflow.on?.["push"]?.paths).toBeUndefined();
    expect(workflow.on?.["pull_request"]?.paths).toBeUndefined();
    expect(Object.hasOwn(workflow.on ?? {}, "pull_request")).toBe(true);
    expect(workflow.on?.["push"]?.branches).toContain("main");
    expect(paths).toContain(".github/scripts/unit-changes.mjs");
    expect(job.uses).toBe("./.github/workflows/_unit.yml");
  }
  const commands = allSteps(loadWorkflow("_unit.yml"))
    .map((step) => step.run ?? "")
    .join("\n");
  expect(commands).toMatch(/cargo test --locked --package "\$UNIT_CRATE"/);
  expect(commands).not.toMatch(/cargo test[^\n]*--workspace/);
  expect(commands).toMatch(/--include-ignored/);
});

function affectedCrates(files: string[]): string[] {
  return crateWorkflows()
    .filter(([, workflow]) =>
      files.some((file) =>
        unitPaths(workflow).some((pattern) => path.matchesGlob(file, pattern)),
      ),
    )
    .map(([, , job]) => String(job.with?.["crate"]))
    .sort();
}

test.each([
  { files: ["crates/tyre/src/lib.rs"], crates: ["tyre"] },
  { files: ["crates/aero/src/lib.rs"], crates: ["aero"] },
  { files: ["crates/powertrain/src/engine.rs"], crates: ["powertrain"] },
  {
    files: ["crates/chassis/src/lib.rs"],
    crates: ["chassis", "chassis-replay", "physics-wasm"],
  },
  {
    files: ["crates/contracts/src/lib.rs"],
    crates: [
      "chassis",
      "chassis-replay",
      "contracts",
      "physics",
      "physics-wasm",
      "replay",
      "scenario",
    ],
  },
  { files: ["docs/ci.md"], crates: [] },
  { files: ["tests/p2/rust/tyre.rs"], crates: ["tyre"] },
  { files: ["tests/p1/rust/chassis.rs"], crates: ["chassis"] },
  {
    files: ["crates/aero/src/old.rs", "crates/tyre/src/new.rs"],
    crates: ["aero", "tyre"],
  },
])("unit selection for $files", ({ files, crates }) => {
  expect(affectedCrates(files)).toEqual(crates);
});

test("shared Rust pins fan out to every crate", () => {
  const packages = cargoPackages()
    .map((entry) => entry.name)
    .sort();
  for (const file of ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"]) {
    expect(affectedCrates([file]), file).toEqual(packages);
  }
});

test("integration jobs run independently and never invoke the full unit sweep", () => {
  const integration = loadWorkflow("ci.yml");
  const commands = allSteps(integration).map((step) => step.run ?? "");
  expect(commands).toContain(
    "pnpm run test:integration --exclude 'tests/n1/**' --exclude 'tests/n2/**'",
  );
  expect(commands).toContain(
    "pnpm run test:e2e --config playwright.ci.config.ts",
  );
  expect(commands.join("\n")).not.toMatch(/pnpm run (verify|test:rust)\b/);
  for (const job of Object.values(integration.jobs ?? {})) {
    expect(job.if).toBeUndefined();
    expect(job.needs).toBeUndefined();
  }
  const browserSetup = integration.jobs?.["browser"]?.steps?.find(
    (step) => step.uses === "./.github/actions/setup",
  );
  expect(browserSetup?.with?.["chrome"]).toBe("true");
  expect(browserSetup?.with?.["wasm-bindings"]).toBe("true");
});

test("CI excludes only N1/N2 browser suites and keeps R1/G3 enabled", () => {
  expect(ciBrowserConfig.testDir).toBe(browserConfig.testDir);
  expect(ciBrowserConfig.testMatch).toEqual(browserConfig.testMatch);
  const ignores = ciBrowserConfig.testIgnore;
  expect(ignores).toEqual(["**/n1/**", "**/n2/**"]);
  const patterns = Array.isArray(ignores)
    ? ignores.filter(
        (pattern): pattern is string => typeof pattern === "string",
      )
    : [];
  const browserFiles = listRepoFiles().filter((file) =>
    file.endsWith(".e2e.ts"),
  );
  const excluded = browserFiles.filter((file) =>
    patterns.some((pattern) => path.matchesGlob(file, pattern)),
  );
  expect(excluded.sort()).toEqual(
    browserFiles.filter((file) => /^tests\/n[12]\//.test(file)).sort(),
  );
  expect(excluded.length).toBeGreaterThan(0);
  for (const group of ["r1", "g3"]) {
    const files = browserFiles.filter((file) =>
      file.startsWith(`tests/${group}/`),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => excluded.includes(file))).toBe(false);
  }
});

test("G1 input remains an enabled unit suite", () => {
  expect(loadWorkflow("unit-input.yml").jobs?.["input"]?.with?.["suite"]).toBe(
    "tests/g1",
  );
  expect(
    unitConfig.test?.include?.some((pattern) =>
      path.matchesGlob("tests/g1/input.test.ts", pattern),
    ),
  ).toBe(true);
});

test("every native test file belongs to exactly one unit or integration suite", () => {
  const groups = [
    unitConfig.test?.include ?? [],
    integrationConfig.test?.include ?? [],
  ];
  const files = listRepoFiles().filter((file) => file.endsWith(".test.ts"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const owners = groups.filter((patterns) =>
      patterns.some((pattern) => path.matchesGlob(file, pattern)),
    );
    expect(owners.length, file).toBe(1);
  }
  const foundation = loadWorkflow("unit-foundation.yml").jobs?.["foundation"];
  expect(foundation?.with?.["exclude"]).toBe("tests/f0/workspace.test.ts");
  const workspacePaths = unitPaths(loadWorkflow("unit-workspace.yml"));
  expect(workspacePaths.some((pattern) => pattern.startsWith("crates/"))).toBe(
    false,
  );
});

test("unaffected unit jobs are skipped before allocating a test runner", () => {
  const workflow = loadWorkflow("_unit.yml");
  const unit = workflow.jobs?.["unit"];
  expect(unit?.needs).toBe("changes");
  expect(unit?.if).toBe("needs.changes.outputs.affected == 'true'");
  const steps = workflow.jobs?.["changes"]?.steps ?? [];
  expect(
    steps.some((step) => step.run === "node .github/scripts/unit-changes.mjs"),
  ).toBe(true);
  expect(steps.some((step) => step.uses === "./.github/actions/setup")).toBe(
    false,
  );
  expect(
    steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with?.[
      "fetch-depth"
    ],
  ).toBe(0);
});

test("all unit workflows report a check even when their suite is unaffected", () => {
  for (const [, caller] of workflows().filter(([file]) =>
    file.startsWith("unit-"),
  )) {
    expect(Object.hasOwn(caller.on ?? {}, "pull_request")).toBe(true);
    expect(caller.on?.["pull_request"]?.paths).toBeUndefined();
    expect(caller.on?.["push"]?.branches).toEqual(["main"]);
    expect(unitPaths(caller).length).toBeGreaterThan(0);
  }
});
