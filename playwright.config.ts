import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

function dockerRunning(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

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
  projects: [
    { name: "app", testIgnore: "**/pad/**" },
    {
      name: "phone-pad",
      testMatch: "pad/**/*.e2e.ts",
      testIgnore: ["**/ios-simulator.e2e.ts", "**/network/**"],
    },
    ...(process.env["CI"] || dockerRunning()
      ? [{ name: "pad-network", testMatch: "pad/network/*.e2e.ts" }]
      : []),
    ...(process.platform === "darwin"
      ? [{ name: "ios-simulator", testMatch: "pad/ios-simulator.e2e.ts" }]
      : []),
  ],
  webServer: {
    command:
      "pnpm run build && pnpm --filter ./apps/client run preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
