import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "tests/f1/**/*.test.ts",
      "tests/p1/chassis.test.ts",
      "tests/t1/**/*.test.ts",
      "tests/t2/**/*.test.ts",
      "tests/c1/car.test.ts",
      "tests/c2/**/*.test.ts",
      "tests/n1/**/*.test.ts",
      "tests/n2/**/*.test.ts",
    ],
  },
});
