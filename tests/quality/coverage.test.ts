import { existsSync } from "node:fs";
import path from "node:path";
import * as prettier from "prettier";
import { expect, test } from "vitest";
import {
  cargoPackages,
  hasExtension,
  listRepoFiles,
  readRepoFile,
  repoRoot,
  run,
} from "../support/repo.ts";

const scriptExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const typeScriptExtensions = [".ts", ".tsx", ".mts", ".cts"];

interface TypeScriptProject {
  file: string;
  compilerOptions: Record<string, unknown>;
  files: string[];
}

function resolvedProjects(): TypeScriptProject[] {
  return listRepoFiles()
    .filter((file) => /(^|\/)tsconfig[^/]*\.json$/.test(file))
    .map((file) => {
      const shown = run("pnpm", ["exec", "tsc", "--showConfig", "-p", file]);
      expect(shown.code, `${file}: ${shown.output}`).toBe(0);
      const config = JSON.parse(shown.stdout) as {
        compilerOptions?: Record<string, unknown>;
        files?: string[];
      };
      const directory = path.dirname(file);
      return {
        file,
        compilerOptions: config.compilerOptions ?? {},
        files: (config.files ?? []).map((entry) =>
          path.normalize(path.join(directory, entry)),
        ),
      };
    });
}

test("every TypeScript project that compiles files uses the strict settings", () => {
  const projects = resolvedProjects().filter(
    (project) => project.files.length > 0,
  );
  expect(projects.length).toBeGreaterThan(0);
  const required = {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noPropertyAccessFromIndexSignature: true,
    verbatimModuleSyntax: true,
  };
  for (const project of projects) {
    for (const [option, value] of Object.entries(required)) {
      expect(
        project.compilerOptions[option],
        `${project.file}: ${option}`,
      ).toBe(value);
    }
    expect(
      project.compilerOptions["allowJs"],
      `${project.file}: allowJs`,
    ).not.toBe(true);
  }
});

test("every TypeScript file belongs to a TypeScript project", () => {
  const covered = new Set(
    resolvedProjects().flatMap((project) => project.files),
  );
  const typeScriptFiles = listRepoFiles().filter((file) =>
    hasExtension(file, typeScriptExtensions),
  );
  expect(typeScriptFiles.length).toBeGreaterThan(0);
  expect(
    typeScriptFiles.filter((file) => !covered.has(path.normalize(file))),
  ).toEqual([]);
});

test("every JavaScript and TypeScript file is linted with zero warnings", () => {
  const files = listRepoFiles().filter((file) =>
    hasExtension(file, scriptExtensions),
  );
  expect(files.length).toBeGreaterThan(0);
  const lint = run("pnpm", [
    "exec",
    "eslint",
    "--max-warnings",
    "0",
    "--",
    ...files,
  ]);
  expect(lint.code, lint.output).toBe(0);
});

test("every file Prettier can format is checked by Prettier", async () => {
  const ignorePath = [".gitignore", ".prettierignore"]
    .map((name) => path.join(repoRoot, name))
    .filter((name) => existsSync(name));
  const unchecked: string[] = [];
  for (const file of listRepoFiles()) {
    const absolute = path.join(repoRoot, file);
    const { inferredParser } = await prettier.getFileInfo(absolute);
    const { ignored } = await prettier.getFileInfo(absolute, { ignorePath });
    if (inferredParser !== null && ignored && file !== "pnpm-lock.yaml") {
      unchecked.push(file);
    }
  }
  expect(unchecked).toEqual([]);
});

test("every Rust crate inherits the workspace lint tables", () => {
  const rootManifest = readRepoFile("Cargo.toml");
  expect(rootManifest).toMatch(/^\[workspace\.lints\.rust\]$/m);
  expect(rootManifest).toMatch(/^\[workspace\.lints\.clippy\]$/m);
  const packages = cargoPackages();
  expect(packages.length).toBeGreaterThan(0);
  for (const entry of packages) {
    expect(
      readRepoFile(path.relative(repoRoot, entry.manifest_path)),
      `${entry.name} must inherit workspace lints`,
    ).toMatch(/^\[lints\]\r?\nworkspace\s*=\s*true\s*$/m);
  }
});
