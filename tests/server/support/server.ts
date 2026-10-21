import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { square } from "../../support/sim.ts";
import { releaseExecutable } from "../../support/cargo.ts";
import { startService, type Service } from "../../support/process.ts";

export interface GameServer {
  port: number;
  certificateHash: string;
  service: Service;
  stop: () => Promise<void>;
}

export function buildServer(): string {
  return releaseExecutable(["--bin", "server"]);
}

export function writeTrack(content: string): {
  file: string;
  remove: () => void;
} {
  const directory = mkdtempSync(path.join(tmpdir(), "server-track-"));
  const file = path.join(directory, "track.json");
  writeFileSync(file, content);
  return {
    file,
    remove() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export const testTrack = square(400, "Server test square");

interface Listening {
  event: string;
  port: number;
  certificateHash: string;
}

function listening(line: string): Listening | null {
  try {
    const event = JSON.parse(line) as Partial<Listening>;
    return event.event === "listening" &&
      typeof event.port === "number" &&
      typeof event.certificateHash === "string"
      ? (event as Listening)
      : null;
  } catch {
    return null;
  }
}

export async function startServer(executable: string): Promise<GameServer> {
  const track = writeTrack(JSON.stringify(testTrack));
  const service = await startService(
    executable,
    ["--listen", "127.0.0.1:0", "--track", track.file],
    {
      ready: (line) => listening(line) !== null,
      timeoutMs: 30_000,
    },
  );
  const event = service.stdout.map(listening).find((entry) => entry !== null);
  if (event === undefined) {
    throw new Error("the server did not report where it listens");
  }
  return {
    port: event.port,
    certificateHash: event.certificateHash,
    service,
    async stop() {
      await service.stop();
      track.remove();
    },
  };
}
