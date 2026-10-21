import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
