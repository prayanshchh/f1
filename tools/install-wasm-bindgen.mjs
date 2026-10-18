import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const lock = readFileSync("Cargo.lock", "utf8");
const version = lock.match(
  /\[\[package\]\]\nname = "wasm-bindgen"\nversion = "([^"]+)"/,
)?.[1];
if (version === undefined) {
  throw new Error("Cargo.lock does not contain wasm-bindgen");
}
execFileSync(
  "cargo",
  ["install", "wasm-bindgen-cli", "--version", version, "--locked"],
  {
    stdio: "inherit",
  },
);
