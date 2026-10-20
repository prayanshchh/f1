import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { repoRoot, runScript } from "../support/repo.ts";

test("the Rust tests pass and the production build writes the client page", () => {
  const rust = runScript("test:rust");
  expect(rust.code, rust.output).toBe(0);
  const build = runScript("build");
  expect(build.code, build.output).toBe(0);
  expect(existsSync(path.join(repoRoot, "apps/client/dist/index.html"))).toBe(
    true,
  );
});
