import { test } from "vitest";
import { expectPortableCrate, expectRustSpecPasses } from "../support/rust.ts";

test("the powertrain crate is plain Rust that builds for WebAssembly and uses only portable float math", () => {
  expectPortableCrate("powertrain", ["libm", "serde"]);
});

test("the wheel-torque and energy-balance specification passes", () => {
  expectRustSpecPasses({
    crate: "powertrain",
    target: "spec",
    file: "tests/p3/rust/powertrain.rs",
  });
});
