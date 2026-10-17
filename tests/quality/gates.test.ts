import { describe, expect, test } from "vitest";
import {
  createProbeCopy,
  readManifest,
  runScript,
  type ProbeCopy,
} from "../support/repo.ts";

const gates = ["format:check", "lint", "typecheck", "unused", "duplicates"];
const clientProbe = "apps/client/src/probe.ts";
const rustLibrary = "crates/physics/src/lib.rs";

interface Probe {
  name: string;
  gate: string;
  apply: (copy: ProbeCopy) => void;
  expect: RegExp[];
}

function clippyLint(name: string): RegExp {
  const hyphenated = name.replaceAll("_", "-");
  return new RegExp(`(clippy::${name}|clippy::${hyphenated}|#${name})\\b`);
}

function writeFile(file: string, content: string) {
  return (copy: ProbeCopy) => {
    copy.write(file, content);
  };
}

function appendFile(file: string, content: string) {
  return (copy: ProbeCopy) => {
    copy.append(file, content);
  };
}

const writeClient = (content: string) => writeFile(clientProbe, content);
const appendRust = (content: string) => appendFile(rustLibrary, `\n${content}`);

const branches = Array.from(
  { length: 21 },
  (_, index) =>
    `  if (value === ${String(index)}) {\n    total += ${String(index)};\n  }\n`,
).join("");

const longRustBody = "    total += 1;\n".repeat(120);

const clonedBody = Array.from({ length: 12 }, (_, index) => {
  const step = `step${String(index)}`;
  return `  const ${step} = input * ${String(index + 2)} + Math.round(input / ${String(index + 3)});\n  output.push(${step} - ${String(index)});\n`;
}).join("");

function clone(name: string): string {
  return `export function ${name}(input: number): number[] {\n  const output: number[] = [];\n${clonedBody}  return output;\n}\n`;
}

const typeScriptProbes: Probe[] = [
  {
    name: "a console.log left in client code",
    gate: "lint",
    apply: writeClient(
      'export function probe(): void {\n  console.log("probe");\n}\n',
    ),
    expect: [/no-console/],
  },
  {
    name: "a debugger statement",
    gate: "lint",
    apply: writeClient("export function probe(): void {\n  debugger;\n}\n"),
    expect: [/no-debugger/],
  },
  {
    name: "an any type",
    gate: "lint",
    apply: writeClient(
      "export function probe(value: any): string {\n  return String(value);\n}\n",
    ),
    expect: [/no-explicit-any/],
  },
  {
    name: "an unused variable",
    gate: "lint",
    apply: writeClient(
      "export function probe(): number {\n  const unused = 1;\n  return 2;\n}\n",
    ),
    expect: [/no-unused-vars/],
  },
  {
    name: "a promise nobody waits for",
    gate: "lint",
    apply: writeClient(
      "export function probe(): void {\n  Promise.resolve(1);\n}\n",
    ),
    expect: [/no-floating-promises/],
  },
  {
    name: "an empty catch that hides an error",
    gate: "lint",
    apply: writeClient(
      "export function probe(text: string): unknown {\n  try {\n    return JSON.parse(text);\n  } catch {}\n  return null;\n}\n",
    ),
    expect: [/\bno-empty\b(?!-)/],
  },
  {
    name: "a non-null assertion",
    gate: "lint",
    apply: writeClient(
      "export function probe(values: number[]): number {\n  return values[0]!;\n}\n",
    ),
    expect: [/no-non-null-assertion/],
  },
  {
    name: "a function with 22 paths through it",
    gate: "lint",
    apply: writeClient(
      `export function probe(value: number): number {\n  let total = 0;\n${branches}  return total;\n}\n`,
    ),
    expect: [/\bcomplexity\b/],
  },
  {
    name: "a type error",
    gate: "typecheck",
    apply: writeClient('export const probe: number = "text";\n'),
    expect: [/TS2322/, /probe\.ts/],
  },
  {
    name: "a type error in test code",
    gate: "typecheck",
    apply: writeFile(
      "tests/support/probe.ts",
      'export const probe: number = "text";\n',
    ),
    expect: [/TS2322/, /probe\.ts/],
  },
  {
    name: "unformatted TypeScript",
    gate: "format:check",
    apply: writeClient("export const probe   =   1\n"),
    expect: [/probe\.ts/],
  },
  {
    name: "a file nothing imports",
    gate: "unused",
    apply: writeFile("apps/client/src/orphan.ts", "export const orphan = 1;\n"),
    expect: [/orphan\.ts/],
  },
  {
    name: "an export nothing uses",
    gate: "unused",
    apply: (copy) => {
      copy.write(
        "apps/client/src/used.ts",
        "export function usedProbe(): number {\n  return 1;\n}\n\nexport function unusedProbe(): number {\n  return 2;\n}\n",
      );
      copy.append(
        "apps/client/src/main.ts",
        '\nimport { usedProbe } from "./used";\n\nusedProbe();\n',
      );
    },
    expect: [/unusedProbe/],
  },
  {
    name: "a dependency nothing imports",
    gate: "unused",
    apply: (copy) => {
      const file = "apps/client/package.json";
      const manifest = JSON.parse(copy.read(file)) as {
        dependencies?: Record<string, string>;
      };
      manifest.dependencies = { ...manifest.dependencies, "left-pad": "1.3.0" };
      copy.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    expect: [/left-pad/],
  },
  {
    name: "copy-pasted code",
    gate: "duplicates",
    apply: (copy) => {
      copy.write("apps/client/src/clone-a.ts", clone("cloneA"));
      copy.write("apps/client/src/clone-b.ts", clone("cloneB"));
    },
    expect: [/clone-a\.ts/, /clone-b\.ts/],
  },
];

const commentProbes: Probe[] = [
  {
    name: "a line comment in TypeScript",
    gate: "lint",
    apply: writeClient(
      "export function probe(): number {\n  // returns one\n  return 1;\n}\n",
    ),
    expect: [/probe\.ts/, /comment/i],
  },
  {
    name: "a block comment that switches ESLint off to hide a console.log",
    gate: "lint",
    apply: writeClient(
      '/* eslint-disable */\nexport function probe(): void {\n  console.log("probe");\n}\n',
    ),
    expect: [/probe\.ts/, /comment/i],
  },
  {
    name: "a comment in a JavaScript config file",
    gate: "lint",
    apply: writeFile("probe.config.mjs", "// note\nexport default {};\n"),
    expect: [/probe\.config\.mjs/, /comment/i],
  },
  {
    name: "a line comment in Rust",
    gate: "lint",
    apply: appendRust(
      "pub fn probe_comment() -> u32 {\n    // one\n    1\n}\n",
    ),
    expect: [/lib\.rs/, /comment/i],
  },
  {
    name: "a doc comment in Rust",
    gate: "lint",
    apply: appendRust(
      "/// Returns one.\npub fn probe_doc() -> u32 {\n    1\n}\n",
    ),
    expect: [/lib\.rs/, /comment/i],
  },
  {
    name: "a comment in CSS",
    gate: "lint",
    apply: writeFile(
      "apps/client/src/probe.css",
      "/* note */\nbody {\n  margin: 0;\n}\n",
    ),
    expect: [/probe\.css/, /comment/i],
  },
  {
    name: "a comment in HTML",
    gate: "lint",
    apply: appendFile("apps/client/index.html", "<!-- note -->\n"),
    expect: [/index\.html/, /comment/i],
  },
  {
    name: "a comment in YAML",
    gate: "lint",
    apply: appendFile(".github/workflows/ci.yml", "# note\n"),
    expect: [/ci\.yml/, /comment/i],
  },
];

const disabledTestProbes: Probe[] = [
  {
    name: "a skipped Vitest test",
    gate: "lint",
    apply: writeFile(
      "tests/probe.test.ts",
      'import { expect, test } from "vitest";\n\ntest.skip("probe", () => {\n  expect(1).toBe(1);\n});\n',
    ),
    expect: [/probe\.test\.ts/, /disabled|skip/i],
  },
  {
    name: "a focused Vitest test",
    gate: "lint",
    apply: writeFile(
      "tests/probe.test.ts",
      'import { expect, test } from "vitest";\n\ntest.only("probe", () => {\n  expect(1).toBe(1);\n});\n',
    ),
    expect: [/probe\.test\.ts/, /focused|only/i],
  },
  {
    name: "a skipped Playwright test",
    gate: "lint",
    apply: writeFile(
      "tests/probe.e2e.ts",
      'import { expect, test } from "@playwright/test";\n\ntest.skip("probe", () => {\n  expect(1).toBe(1);\n});\n',
    ),
    expect: [/probe\.e2e\.ts/, /disabled|skip/i],
  },
  {
    name: "a focused Playwright test",
    gate: "lint",
    apply: writeFile(
      "tests/probe.e2e.ts",
      'import { expect, test } from "@playwright/test";\n\ntest.only("probe", () => {\n  expect(1).toBe(1);\n});\n',
    ),
    expect: [/probe\.e2e\.ts/, /focused|only/i],
  },
  {
    name: "an ignored Rust test",
    gate: "lint",
    apply: appendRust(
      "#[cfg(test)]\nmod probe_tests {\n    #[test]\n    #[ignore]\n    fn ignored() {}\n}\n",
    ),
    expect: [/lib\.rs/, /ignore/],
  },
];

const rustProbes: Probe[] = [
  {
    name: "a println! left in Rust",
    gate: "lint",
    apply: appendRust('pub fn probe_print() {\n    println!("probe");\n}\n'),
    expect: [clippyLint("print_stdout")],
  },
  {
    name: "an eprintln! left in Rust",
    gate: "lint",
    apply: appendRust('pub fn probe_print() {\n    eprintln!("probe");\n}\n'),
    expect: [clippyLint("print_stderr")],
  },
  {
    name: "a dbg! left in Rust",
    gate: "lint",
    apply: appendRust(
      "pub fn probe_debug(value: u32) -> u32 {\n    dbg!(value)\n}\n",
    ),
    expect: [clippyLint("dbg_macro")],
  },
  {
    name: "a todo! placeholder",
    gate: "lint",
    apply: appendRust("pub fn probe_todo() -> u32 {\n    todo!()\n}\n"),
    expect: [clippyLint("todo")],
  },
  {
    name: "an unimplemented! placeholder",
    gate: "lint",
    apply: appendRust(
      "pub fn probe_unimplemented() -> u32 {\n    unimplemented!()\n}\n",
    ),
    expect: [clippyLint("unimplemented")],
  },
  {
    name: "an unwrap that can crash",
    gate: "lint",
    apply: appendRust(
      "pub fn probe_unwrap(value: Option<u32>) -> u32 {\n    value.unwrap()\n}\n",
    ),
    expect: [clippyLint("unwrap_used")],
  },
  {
    name: "an expect that can crash",
    gate: "lint",
    apply: appendRust(
      'pub fn probe_expect(value: Option<u32>) -> u32 {\n    value.expect("value")\n}\n',
    ),
    expect: [clippyLint("expect_used")],
  },
  {
    name: "an explicit panic",
    gate: "lint",
    apply: appendRust('pub fn probe_panic() {\n    panic!("probe");\n}\n'),
    expect: [clippyLint("panic")],
  },
  {
    name: "a Rust function nothing calls",
    gate: "lint",
    apply: appendRust("fn probe_dead() {}\n"),
    expect: [/never used/],
  },
  {
    name: "an unsafe block",
    gate: "lint",
    apply: appendRust(
      "pub fn probe_unsafe(values: &[u32]) -> u32 {\n    unsafe { *values.as_ptr() }\n}\n",
    ),
    expect: [/unsafe[-_]code/],
  },
  {
    name: "a 120-line Rust function",
    gate: "lint",
    apply: appendRust(
      `pub fn probe_long() -> u64 {\n    let mut total = 0;\n${longRustBody}    total\n}\n`,
    ),
    expect: [clippyLint("too_many_lines")],
  },
  {
    name: "an allow attribute that silences a lint",
    gate: "lint",
    apply: appendRust(
      "#[allow(clippy::unwrap_used)]\npub fn probe_allow(value: Option<u32>) -> u32 {\n    value.unwrap()\n}\n",
    ),
    expect: [/lib\.rs/],
  },
  {
    name: "an expect attribute that silences a lint",
    gate: "lint",
    apply: appendRust(
      '#[expect(clippy::unwrap_used, reason = "probe")]\npub fn probe_expect_attribute(value: Option<u32>) -> u32 {\n    value.unwrap()\n}\n',
    ),
    expect: [/lib\.rs/],
  },
  {
    name: "unformatted Rust",
    gate: "format:check",
    apply: appendRust("pub fn probe_format(){}\n"),
    expect: [/lib\.rs/],
  },
  {
    name: "a Rust dependency nothing uses",
    gate: "unused",
    apply: (copy) => {
      const file = "crates/physics/Cargo.toml";
      const manifest = copy.read(file);
      copy.write(
        file,
        /^\[dependencies\]\s*$/m.test(manifest)
          ? manifest.replace(
              /^\[dependencies\]\s*$/m,
              '[dependencies]\nitoa = "1"',
            )
          : `${manifest}\n[dependencies]\nitoa = "1"\n`,
      );
    },
    expect: [/itoa/],
  },
];

test("check runs every static gate and the repository passes it", () => {
  const check = readManifest("package.json").scripts?.["check"] ?? "";
  for (const gate of gates) {
    expect(check, `check must run ${gate}`).toMatch(
      new RegExp(`(^|[\\s"'])${gate}($|[\\s"'&;|])`),
    );
  }
  const result = runScript("check");
  expect(result.code, result.output).toBe(0);
});

test("an untouched copy of the repository passes every gate the probes use", async () => {
  const copy = createProbeCopy();
  try {
    for (const gate of gates) {
      const result = await copy.runScript(gate);
      expect(result.code, `${gate}: ${result.output}`).toBe(0);
    }
  } finally {
    copy.remove();
  }
});

describe.concurrent("each kind of sloppy code is rejected by its gate", () => {
  test.for([
    ...typeScriptProbes,
    ...commentProbes,
    ...disabledTestProbes,
    ...rustProbes,
  ])("$gate rejects $name", async (probe, { expect }) => {
    const copy = createProbeCopy();
    try {
      probe.apply(copy);
      const result = await copy.runScript(probe.gate);
      expect(result.code, `${probe.gate} accepted ${probe.name}`).not.toBe(0);
      for (const pattern of probe.expect) {
        expect(result.output).toMatch(pattern);
      }
    } finally {
      copy.remove();
    }
  });
});
