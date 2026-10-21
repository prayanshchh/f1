import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".context/**",
      "**/dist/**",
      "target/**",
      "apps/client/wasm/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-console": "error", complexity: ["error", 10] },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
  },
  {
    files: ["**/*.test.ts"],
    plugins: { vitest },
    rules: {
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
    },
  },
  {
    files: ["**/*.e2e.ts"],
    plugins: { playwright },
    rules: {
      "playwright/no-skipped-test": "error",
      "playwright/no-focused-test": "error",
      "playwright/expect-expect": [
        "error",
        { assertFunctionPatterns: ["^expect"] },
      ],
    },
  },
);
