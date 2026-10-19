import path from "node:path";
import { freePort, startService, type Service } from "../../support/process.ts";
import { repoRoot } from "../../support/repo.ts";

export const lobbyEntry = path.join(repoRoot, "services/lobby/src/main.ts");

export const regions = [
  {
    id: "eu-west",
    name: "Europe West",
    server: "https://eu.example.test:4433",
  },
  { id: "us-east", name: "US East", server: "https://us.example.test:4433" },
  {
    id: "ap-south",
    name: "Asia Pacific South",
    server: "https://ap.example.test:4433",
  },
];

export interface Lobby {
  url: string;
  service: Service;
}

export function lobbyEnvironment(
  port: number,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    PORT: String(port),
    HOST: "127.0.0.1",
    PUBLIC_URL: `http://127.0.0.1:${String(port)}`,
    LOBBY_REGIONS: JSON.stringify(regions),
    ...extra,
  };
}

export async function startLobby(
  extra: Record<string, string> = {},
): Promise<Lobby> {
  const port = await freePort();
  const service = await startService(process.execPath, [lobbyEntry], {
    env: lobbyEnvironment(port, extra),
    ready: (line) => {
      try {
        const event = JSON.parse(line) as { event?: string; port?: number };
        return event.event === "listening" && event.port === port;
      } catch {
        return false;
      }
    },
    timeoutMs: 30_000,
  });
  return { url: `http://127.0.0.1:${String(port)}`, service };
}

export interface CreatedRoom {
  code: string;
  link: string;
  region: string;
}

export async function createRoom(
  lobby: Lobby,
  region = "eu-west",
): Promise<CreatedRoom> {
  const response = await fetch(`${lobby.url}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ region }),
  });
  if (response.status !== 201) {
    throw new Error(
      `creating a room returned ${String(response.status)}: ${await response.text()}`,
    );
  }
  return (await response.json()) as CreatedRoom;
}
