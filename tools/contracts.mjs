import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";

const directory = "apps/client/src/contracts";
const file = `${directory}/index.ts`;
const source = execFileSync(
  "cargo",
  ["run", "--quiet", "--locked", "--package", "contracts", "--bin", "generate"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const formatted = await format(source, { parser: "typescript" });
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== formatted) {
    throw new Error(`${directory} is stale; run pnpm run contracts:generate`);
  }
} else {
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, formatted);
}
