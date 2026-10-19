import { test } from "vitest";
import { expectPortableCrate, expectRustSpecPasses } from "../support/rust.ts";

test("the tyre crate is plain Rust that builds for WebAssembly and uses only portable float math", () => {
  expectPortableCrate("tyre", ["libm", "serde"]);
});

test("the tyre curve specification passes", () => {
  expectRustSpecPasses({
    crate: "tyre",
    target: "spec",
    file: "tests/p2/rust/tyre.rs",
  });
});
