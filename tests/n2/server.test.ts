import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cratePath, normalDependencies } from "../support/rust.ts";
import {
  buildServer,
  startServer,
  testTrack,
  writeTrack,
  type GameServer,
} from "./support/server.ts";

let executable: string;
let server: GameServer;

beforeAll(async () => {
  executable = buildServer();
  server = await startServer(executable);
});

afterAll(async () => {
  await server.stop();
});

test("the server crate runs the shared physics natively over WebTransport", () => {
  expect(cratePath("server")).toBe("crates/server");
  expect(normalDependencies("server")).toEqual(
    expect.arrayContaining(["contracts", "physics", "wtransport"]),
  );
});

test("the server reports a real port and the SHA-256 hash of its certificate", () => {
  expect(server.port).toBeGreaterThan(0);
  expect(server.port).toBeLessThan(65_536);
  expect(server.certificateHash).toMatch(/^[0-9a-f]{64}$/);
});

test("each start uses a fresh short-lived certificate", async () => {
  const other = await startServer(executable);
  try {
    expect(other.certificateHash).not.toBe(server.certificateHash);
    expect(other.port).not.toBe(server.port);
  } finally {
    await other.stop();
  }
});

test("the server stops cleanly on SIGTERM", async () => {
  const other = await startServer(executable);
  expect(await other.service.stop()).toBe(0);
});

function runServer(args: string[]): {
  code: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 20_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test.each([
  ["no arguments", () => []],
  [
    "a missing track file",
    () => ["--listen", "127.0.0.1:0", "--track", "/definitely/not/here.json"],
  ],
  [
    "an unparseable listen address",
    () => [
      "--listen",
      "nowhere",
      "--track",
      writeTrack(JSON.stringify(testTrack)).file,
    ],
  ],
  [
    "a track that is not JSON",
    () => ["--listen", "127.0.0.1:0", "--track", writeTrack("{ name").file],
  ],
  [
    "an invalid track",
    () => [
      "--listen",
      "127.0.0.1:0",
      "--track",
      writeTrack(JSON.stringify({ ...testTrack, width: -1 })).file,
    ],
  ],
  ["an unknown option", () => ["--listen", "127.0.0.1:0", "--fast"]],
])("the server refuses to start with %s", (label, args) => {
  const result = runServer(args());
  expect(result.code, label).not.toBe(0);
  expect(result.code, `${label}: must exit, not crash`).not.toBeNull();
  expect(result.stdout, label).not.toMatch(/listening/);
  expect(result.stderr.trim(), label).not.toBe("");
  expect(result.stderr, label).not.toMatch(/panicked/);
});
