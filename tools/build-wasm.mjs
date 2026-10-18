import { execFileSync } from "node:child_process";
import path from "node:path";

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--no-deps", "--locked"],
    {
      encoding: "utf8",
    },
  ),
);
execFileSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "--package",
    "physics-wasm",
    "--target",
    "wasm32-unknown-unknown",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "wasm-bindgen",
  [
    path.join(
      metadata.target_directory,
      "wasm32-unknown-unknown/release/physics_wasm.wasm",
    ),
    "--target",
    "web",
    "--out-dir",
    "apps/client/wasm",
    "--out-name",
    "physics",
  ],
  { stdio: "inherit" },
);
