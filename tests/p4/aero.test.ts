import { test } from "vitest";
import { expectPortableCrate, expectRustSpecPasses } from "../support/rust.ts";

test("the aero crate is plain Rust that builds for WebAssembly and uses only portable float math", () => {
  expectPortableCrate("aero", ["libm", "serde"]);
});

test("the aero target-curve and active-aero specification passes", () => {
  expectRustSpecPasses({
    crate: "aero",
    target: "spec",
    file: "tests/p4/rust/aero.rs",
  });
});
