import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const script = fileURLToPath(
  new URL("../../tools/build-engine.mjs", import.meta.url),
);

export function engineBuild(): Plugin {
  return {
    name: "revracers-engine-build",
    apply: "serve",
    buildStart() {
      execFileSync(process.execPath, [script], { stdio: "inherit" });
    },
  };
}
