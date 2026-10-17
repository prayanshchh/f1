import { defineConfig } from "@playwright/test";

const softwareGpuArguments = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.e2e.ts",
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    launchOptions: {
      args: process.platform === "linux" ? softwareGpuArguments : [],
    },
  },
  webServer: {
    command:
      "pnpm run build && pnpm --filter ./apps/client run preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
