import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { cargoPackages, repoRoot, run } from "./repo.ts";

export interface RustSpec {
  crate: string;
  target: string;
  file: string;
}

function declaredRustTests(file: string): string[] {
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  return [
    ...source.matchAll(/#\[test\]\s*(?:#\[[^\]]*\]\s*)*fn\s+([a-z0-9_]+)/g),
  ]
    .map((match) => match[1] ?? "")
    .sort();
}

function expectRustSpecWired(spec: RustSpec): void {
  const entry = cargoPackages().find((item) => item.name === spec.crate);
  expect(entry, `cargo package ${spec.crate} must exist`).toBeDefined();
  const target = entry?.targets.find(
    (item) => item.name === spec.target && item.kind.includes("test"),
  );
  expect(
    target,
    `${spec.crate} must declare [[test]] name = "${spec.target}"`,
  ).toBeDefined();
  expect(
    path.relative(repoRoot, target?.src_path ?? ""),
    `${spec.crate} test ${spec.target} must use the spec file itself`,
  ).toBe(spec.file);
}

export function expectRustSpecPasses(spec: RustSpec): void {
  expectRustSpecWired(spec);
  const declared = declaredRustTests(spec.file);
  expect(declared.length, `${spec.file} declares tests`).toBeGreaterThan(0);
  const args = [
    "test",
    "--locked",
    "--package",
    spec.crate,
    "--test",
    spec.target,
  ];
  const listed = run("cargo", [...args, "--", "--list", "--format", "terse"]);
  expect(listed.code, listed.output).toBe(0);
  const names = listed.stdout
    .split("\n")
    .filter((line) => line.endsWith(": test"))
    .map((line) => line.slice(0, -": test".length))
    .sort();
  expect(names, "every declared Rust test must run, none ignored").toEqual(
    declared,
  );
  const result = run("cargo", [...args, "--", "--include-ignored"]);
  expect(result.code, result.output).toBe(0);
  expect(result.output).toMatch(
    new RegExp(
      `test result: ok\\. ${String(declared.length)} passed; 0 failed; 0 ignored`,
    ),
  );
}

const platformFloatMethods =
  /\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|exp2|exp_m1|ln|ln_1p|log|log2|log10|powf|powi|hypot|cbrt|mul_add|sin_cos)\s*\(/;

function rustSources(directory: string): string[] {
  return readdirSync(path.join(repoRoot, directory), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => file.endsWith(".rs"))
    .map((file) => path.join(directory, file));
}

export function expectPortableFloatMath(directory: string): void {
  const files = rustSources(directory);
  expect(files.length, `${directory} has Rust sources`).toBeGreaterThan(0);
  const offenders = files.flatMap((file) =>
    readFileSync(path.join(repoRoot, file), "utf8")
      .split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => platformFloatMethods.test(line))
      .map(({ index }) => `${file}:${String(index + 1)}`),
  );
  expect(
    offenders,
    "use libm for transcendental float math so WebAssembly and native builds agree bit for bit",
  ).toEqual([]);
}

export function normalDependencies(crate: string): string[] {
  const entry = cargoPackages().find((item) => item.name === crate);
  expect(entry, `cargo package ${crate} must exist`).toBeDefined();
  return (entry?.dependencies ?? [])
    .filter((dependency) => dependency.kind === null)
    .map((dependency) => dependency.name)
    .sort();
}

export function cratePath(crate: string): string {
  const entry = cargoPackages().find((item) => item.name === crate);
  expect(entry, `cargo package ${crate} must exist`).toBeDefined();
  return path.relative(repoRoot, path.dirname(entry?.manifest_path ?? ""));
}

export function expectPortableCrate(
  crate: string,
  allowedDependencies: readonly string[],
): void {
  expect(cratePath(crate)).toBe(path.join("crates", crate));
  expect(
    normalDependencies(crate).filter(
      (name) => !allowedDependencies.includes(name),
    ),
    `${crate} may only depend on ${allowedDependencies.join(", ")}`,
  ).toEqual([]);
  expectPortableFloatMath(path.join("crates", crate, "src"));
  const build = run("cargo", [
    "build",
    "--locked",
    "--package",
    crate,
    "--target",
    "wasm32-unknown-unknown",
  ]);
  expect(build.code, build.output).toBe(0);
}
