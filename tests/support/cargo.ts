import { run } from "./repo.ts";

export function releaseExecutable(selector: readonly string[]): string {
  const build = run("cargo", [
    "build",
    "--release",
    "--locked",
    ...selector,
    "--message-format",
    "json-render-diagnostics",
  ]);
  if (build.code !== 0) {
    throw new Error(
      `cargo build ${selector.join(" ")} failed:\n${build.output}`,
    );
  }
  const executable = build.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { executable?: string | null })
    .map((message) => message.executable)
    .find((file) => typeof file === "string" && file !== "");
  if (executable === undefined || executable === null) {
    throw new Error(`cargo build ${selector.join(" ")} built no executable`);
  }
  return executable;
}
