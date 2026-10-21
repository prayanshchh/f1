import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    globalSetup: [],
    include: [
      "tests/f0/**/*.test.ts",
      "tests/p1/unit.test.ts",
      "tests/p2/**/*.test.ts",
      "tests/p3/**/*.test.ts",
      "tests/p4/**/*.test.ts",
      "tests/g1/**/*.test.ts",
      "tests/g2/**/*.test.ts",
      "tests/c1/livery.test.ts",
      "tests/quality/**/*.test.ts",
    ],
  },
});
