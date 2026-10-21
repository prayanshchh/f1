import { expect, test } from "vitest";
import { cargoPackages } from "../support/repo.ts";
import {
  expectPortableFloatMath,
  expectRustSpecPasses,
  normalDependencies,
} from "../support/rust.ts";

test("the chassis crate is portable Rust shared by the browser and the server", () => {
  expect(
    normalDependencies("chassis").filter(
      (name) =>
        !["contracts", "libm", "serde", "bincode", "sha2"].includes(name),
    ),
  ).toEqual([]);
  expectPortableFloatMath("crates/chassis/src");
  expect(normalDependencies("physics-wasm")).toContain("chassis");
  const binaries = cargoPackages().flatMap((entry) =>
    entry.targets
      .filter((target) => target.kind.includes("bin"))
      .map((target) => target.name),
  );
  expect(binaries).toContain("chassis-replay");
});

test("the chassis specification passes", () => {
  expectRustSpecPasses({
    crate: "chassis",
    target: "spec",
    file: "tests/p1/rust/chassis.rs",
  });
});
