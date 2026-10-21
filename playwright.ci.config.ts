import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testIgnore: ["**/n1/**", "**/n2/**"],
});
