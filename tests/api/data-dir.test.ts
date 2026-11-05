import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger, createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, test } from "vitest";
import { embeddedDb } from "../../apps/api/src/index.ts";
import { apiServer } from "../../apps/client/api-server.ts";
import { repoRoot } from "../support/repo.ts";

const dataDir = () =>
  path.join(mkdtempSync(path.join(os.tmpdir(), "revracers-db-")), "postgres");

function holdInAnotherProcess(directory: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "--experimental-transform-types",
      "--no-warnings",
      path.join(repoRoot, "tests/support/hold-data-dir.ts"),
      directory,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  return new Promise((opened, failed) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("open")) opened(child);
    });
    child.once("exit", (code) => {
      failed(new Error(`holder exited with ${String(code)}`));
    });
  });
}

const gone = (child: ChildProcess) =>
  new Promise((done) => {
    child.once("exit", done);
    child.kill("SIGKILL");
  });

describe("the local database folder", () => {
  let holder: ChildProcess | null = null;
  let server: ViteDevServer | null = null;

  afterEach(async () => {
    holder?.kill("SIGKILL");
    holder = null;
    await server?.close();
    server = null;
  });

  test("refuses a second process while one holds it, and the data survives that process dying", async () => {
    const directory = dataDir();
    holder = await holdInAnotherProcess(directory);
    expect(() => embeddedDb(directory)).toThrow(
      new RegExp(`in use by process ${String(holder.pid)}`),
    );
    await gone(holder);
    holder = null;
    const db = embeddedDb(directory);
    expect(await db.query("select n from marks")).toEqual([{ n: 7 }]);
    await db.close();
  }, 60_000);

  test("refuses a second open in the same process until the first is closed", async () => {
    const directory = dataDir();
    const first = embeddedDb(directory);
    await first.exec(
      "create table marks (n int); insert into marks values (3)",
    );
    expect(() => embeddedDb(directory)).toThrow(/in use by process/);
    await first.close();
    const second = embeddedDb(directory);
    expect(await second.query("select n from marks")).toEqual([{ n: 3 }]);
    await second.close();
  }, 60_000);

  test("keeps serving players across a dev server restart", async () => {
    process.env["REVRACERS_DATA_DIR"] = dataDir();
    const errors: string[] = [];
    const logger = createLogger("silent");
    logger.error = (message) => {
      errors.push(message);
    };
    server = await createServer({
      configFile: false,
      root: mkdtempSync(path.join(os.tmpdir(), "revracers-root-")),
      plugins: [apiServer()],
      server: { port: 0, strictPort: false },
      customLogger: logger,
    });
    await server.listen();
    const join = async () => {
      const origin = server?.resolvedUrls?.local[0] ?? "";
      const answer = await fetch(new URL("/api/players", origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: randomBytes(32).toString("base64url") }),
      });
      return answer.status;
    };
    expect(await join()).toBe(200);
    await server.restart();
    expect(errors).toEqual([]);
    expect(await join()).toBe(200);
  }, 60_000);
});
