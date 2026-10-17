import { expect, test } from "vitest";
import { createProbeCopy, type ProbeCopy } from "../support/repo.ts";

const identity = [
  "-c",
  "user.name=Probe",
  "-c",
  "user.email=probe@example.com",
  "-c",
  "commit.gpgsign=false",
];

async function commit(copy: ProbeCopy, message: string) {
  const added = await copy.run("git", ["add", "-A"]);
  expect(added.code, added.output).toBe(0);
  return copy.run("git", [...identity, "commit", "-m", message]);
}

test("installing dependencies sets up a pre-commit hook that accepts clean code and blocks sloppy code", async () => {
  const copy = createProbeCopy();
  try {
    const init = await copy.run("git", ["init", "-q", "-b", "master"]);
    expect(init.code, init.output).toBe(0);
    const prepare = await copy.runScript("prepare");
    expect(prepare.code, prepare.output).toBe(0);

    const clean = await commit(copy, "clean");
    expect(clean.code, clean.output).toBe(0);

    copy.write(
      "apps/client/src/probe.ts",
      'export function probe(): void {\n  console.log("probe");\n}\n',
    );
    const sloppy = await commit(copy, "sloppy");
    expect(sloppy.code, "the hook let a console.log through").not.toBe(0);
    expect(sloppy.output).toMatch(/no-console/);
    const log = await copy.run("git", ["log", "--format=%s"]);
    expect(log.stdout.trim().split("\n")).toEqual(["clean"]);
  } finally {
    copy.remove();
  }
});
