import path from "node:path";
import { expect, test } from "vitest";
import { cargoPackages, readRepoFile, repoRoot } from "../support/repo.ts";

test("every Rust crate inherits the workspace lint tables", () => {
  const packages = cargoPackages();
  expect(packages.length).toBeGreaterThan(0);
  for (const entry of packages) {
    expect(
      readRepoFile(path.relative(repoRoot, entry.manifest_path)),
      `${entry.name} must inherit workspace lints`,
    ).toMatch(/^\[lints\]\r?\nworkspace\s*=\s*true\s*$/m);
  }
});
