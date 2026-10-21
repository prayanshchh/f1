import { expect, test } from "vitest";
import {
  affectedCrates,
  workspaceCrates,
} from "../../.github/scripts/affected.ts";

const manifests: Record<string, string> = {
  "crates/a/Cargo.toml":
    '[package]\nname = "a"\n\n[dependencies]\nlibm = "0.2"\n',
  "crates/b/Cargo.toml":
    '[package]\nname = "b"\n\n[dependencies]\na = { path = "../a" }\n',
  "crates/c/Cargo.toml":
    '[package]\nname = "c"\n\n[dependencies]\nserde = "1"\n\n[[test]]\nname = "spec"\npath = "../../tests/c/spec.rs"\n',
  "crates/d/Cargo.toml":
    '[package]\nname = "d"\n\n[dependencies]\nrand = "0.9"\n',
};

function root(members: string[], lints = "deny"): string {
  return `[workspace]\nmembers = [${members.map((member) => `"${member}"`).join(", ")}]\n\n[workspace.lints.clippy]\nunwrap_used = "${lints}"\n`;
}

function lockPackage(
  name: string,
  version: string,
  dependencies: string[] = [],
): string {
  const list =
    dependencies.length === 0
      ? ""
      : `dependencies = [\n${dependencies.map((dependency) => ` "${dependency}",\n`).join("")}]\n`;
  return `[[package]]\nname = "${name}"\nversion = "${version}"\n${list}`;
}

function lock(libm = "0.2.15", extra: string[] = []): string {
  return [
    "version = 4\n",
    lockPackage("a", "0.1.0", ["libm"]),
    lockPackage("b", "0.1.0", ["a"]),
    lockPackage("c", "0.1.0", ["serde"]),
    lockPackage("libm", libm),
    lockPackage("serde", "1.0.0"),
    ...extra,
  ].join("\n");
}

const members = ["crates/a", "crates/b", "crates/c"];
const base = { root: root(members), lock: lock() };

function select(files: string[], after = base, workspace = members): string[] {
  const crates = workspaceCrates(
    root(workspace),
    (file) => manifests[file] ?? "",
  );
  return affectedCrates({ files, crates, before: base, after });
}

test.each([
  { files: ["crates/a/src/lib.rs"], crates: ["a", "b"] },
  { files: ["crates/b/src/lib.rs"], crates: ["b"] },
  { files: ["crates/c/Cargo.toml"], crates: ["c"] },
  { files: ["tests/c/spec.rs"], crates: ["c"] },
  {
    files: ["apps/client/src/main.ts", "package.json", "pnpm-lock.yaml"],
    crates: [],
  },
  { files: ["docs/notes.md"], crates: [] },
  { files: ["rust-toolchain.toml"], crates: ["a", "b", "c"] },
  { files: ["clippy.toml"], crates: ["a", "b", "c"] },
])("changing $files runs unit tests for $crates", ({ files, crates }) => {
  expect(select(files)).toEqual(crates);
});

test("a lockfile bump runs the crates that depend on the bumped package", () => {
  expect(
    select(["Cargo.lock"], { root: base.root, lock: lock("0.2.16") }),
  ).toEqual(["a", "b"]);
});

test("adding a crate with new dependencies runs only the new crate", () => {
  const workspace = [...members, "crates/d"];
  const after = {
    root: root(workspace),
    lock: lock("0.2.15", [
      lockPackage("d", "0.1.0", ["rand"]),
      lockPackage("rand", "0.9.0"),
    ]),
  };
  expect(
    select(
      [
        "Cargo.toml",
        "Cargo.lock",
        "crates/d/Cargo.toml",
        "crates/d/src/lib.rs",
      ],
      after,
      workspace,
    ),
  ).toEqual(["d"]);
});

test("changing shared workspace settings runs every crate", () => {
  expect(
    select(["Cargo.toml"], { root: root(members, "warn"), lock: base.lock }),
  ).toEqual(["a", "b", "c"]);
});
