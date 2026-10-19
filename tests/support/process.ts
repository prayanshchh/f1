import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { repoRoot } from "./repo.ts";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === "string") {
          reject(new Error("no port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

export interface Service {
  child: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: () => string;
  exited: Promise<number | null>;
  stop: () => Promise<number | null>;
}

export interface StartOptions {
  env?: Record<string, string>;
  cwd?: string;
  ready: (line: string) => boolean;
  timeoutMs?: number;
}

export async function startService(
  command: string,
  args: readonly string[],
  options: StartOptions,
): Promise<Service> {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...options.env },
  });
  const stdout: string[] = [];
  let errors = "";
  let pending = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      resolve(code);
    });
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${command} did not report ready in time\nstdout:\n${stdout.join("\n")}\nstderr:\n${errors}`,
        ),
      );
    }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        stdout.push(line);
        if (options.ready(line)) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    void exited.then((code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `${command} exited with ${String(code)} before it was ready\nstdout:\n${stdout.join("\n")}\nstderr:\n${errors}`,
        ),
      );
    });
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    return exited;
  };
  try {
    await ready;
  } catch (error) {
    await stop();
    throw error;
  }
  return { child, stdout, stderr: () => errors, exited, stop };
}
