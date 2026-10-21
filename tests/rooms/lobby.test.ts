import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freePort, startService } from "../support/process.ts";
import {
  createRoom,
  lobbyEntry,
  lobbyEnvironment,
  regions,
  startLobby,
  type Lobby,
} from "./support/lobby.ts";

let lobby: Lobby;

beforeAll(async () => {
  lobby = await startLobby();
});

afterAll(async () => {
  await lobby.service.stop();
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface Reply {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

async function call(
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const response = await fetch(`${lobby.url}${route}`, {
    method,
    headers:
      body === undefined
        ? headers
        : { "content-type": "application/json", ...headers },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: parseJson(text),
    text,
  };
}

interface Joined {
  playerId: string;
  token: string;
  server: string;
}

async function join(code: string, name: string): Promise<Joined> {
  const reply = await call("POST", `/api/rooms/${code}/players`, { name });
  expect(reply.status, reply.text).toBe(201);
  return reply.body as Joined;
}

test("regions are listed without exposing server addresses", async () => {
  const reply = await call("GET", "/api/regions");
  expect(reply.status).toBe(200);
  expect(reply.headers.get("content-type")).toMatch(/^application\/json/);
  expect(reply.headers.get("x-content-type-options")).toBe("nosniff");
  expect(reply.body).toEqual({
    regions: regions.map(({ id, name }) => ({ id, name })),
  });
});

test("creating a room in a region returns a shareable link", async () => {
  const reply = await call("POST", "/api/rooms", { region: "us-east" });
  expect(reply.status).toBe(201);
  const room = reply.body as { code: string; link: string; region: string };
  expect(Object.keys(room).sort()).toEqual(["code", "link", "region"]);
  expect(room.region).toBe("us-east");
  expect(room.code).toMatch(/^[a-z0-9]{10,}$/);
  expect(room.link).toBe(`${lobby.url}/join/${room.code}`);
  const info = await call("GET", `/api/rooms/${room.code}`);
  expect(info.status).toBe(200);
  expect(info.body).toEqual({
    code: room.code,
    region: "us-east",
    players: [],
    capacity: 22,
  });
});

test("room codes are unique and unguessable", async () => {
  const codes = await Promise.all(
    Array.from({ length: 300 }, async () => (await createRoom(lobby)).code),
  );
  expect(new Set(codes).size).toBe(codes.length);
  const prefixes = new Set(codes.map((code) => code.slice(0, 6)));
  expect(prefixes.size, "codes must not be sequential").toBe(codes.length);
});

describe("joining a room", () => {
  test("adds the player and hands out the region's game server", async () => {
    const room = await createRoom(lobby, "ap-south");
    const ana = await join(room.code, "  Ana  ");
    expect(Object.keys(ana).sort()).toEqual(["playerId", "server", "token"]);
    expect(ana.server).toBe("https://ap.example.test:4433");
    expect(ana.token.length).toBeGreaterThanOrEqual(20);
    await join(room.code, "Ben");
    const info = await call("GET", `/api/rooms/${room.code}`);
    expect((info.body as { players: unknown[] }).players).toEqual([
      { name: "Ana" },
      { name: "Ben" },
    ]);
  });

  test("rejects duplicate names regardless of case", async () => {
    const room = await createRoom(lobby);
    await join(room.code, "Max");
    expect(
      (await call("POST", `/api/rooms/${room.code}/players`, { name: "max" }))
        .status,
    ).toBe(409);
  });

  test("allows exactly 22 players", async () => {
    const room = await createRoom(lobby);
    for (let seat = 0; seat < 22; seat += 1) {
      await join(room.code, `Driver ${String(seat)}`);
    }
    expect(
      (await call("POST", `/api/rooms/${room.code}/players`, { name: "Spare" }))
        .status,
    ).toBe(409);
  });

  test.each([
    ["an empty name", { name: "   " }],
    ["a 25 character name", { name: "x".repeat(25) }],
    ["a name with control characters", { name: "Ana\u0007" }],
    ["a name that is not text", { name: 7 }],
    ["an unknown field", { name: "Ana", car: 1 }],
  ])("rejects %s", async (_label, body) => {
    const room = await createRoom(lobby);
    expect(
      (await call("POST", `/api/rooms/${room.code}/players`, body)).status,
    ).toBe(400);
  });

  test("an unknown room is not found", async () => {
    expect(
      (await call("POST", "/api/rooms/nosuchroom00/players", { name: "Ana" }))
        .status,
    ).toBe(404);
    expect((await call("GET", "/api/rooms/nosuchroom00")).status).toBe(404);
  });
});

test("a player can leave only with their own token", async () => {
  const room = await createRoom(lobby);
  const ana = await join(room.code, "Ana");
  const ben = await join(room.code, "Ben");
  const route = `/api/rooms/${room.code}/players/${ana.playerId}`;
  expect((await call("DELETE", route)).status).toBe(401);
  expect(
    (
      await call("DELETE", route, undefined, {
        authorization: `Bearer ${ben.token}`,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call("DELETE", route, undefined, {
        authorization: `Bearer ${ana.token}`,
      })
    ).status,
  ).toBe(204);
  const info = await call("GET", `/api/rooms/${room.code}`);
  expect((info.body as { players: unknown[] }).players).toEqual([
    { name: "Ben" },
  ]);
  expect(
    (
      await call("DELETE", route, undefined, {
        authorization: `Bearer ${ana.token}`,
      })
    ).status,
  ).toBe(404);
});

describe("bad requests are refused with the right status", () => {
  test.each([
    ["an unknown region", "POST", "/api/rooms", { region: "moon" }, 400],
    ["a missing region", "POST", "/api/rooms", {}, 400],
    [
      "an unknown field",
      "POST",
      "/api/rooms",
      { region: "eu-west", private: true },
      400,
    ],
    ["broken JSON", "POST", "/api/rooms", "{ region", 400],
    ["a JSON array", "POST", "/api/rooms", "[]", 400],
    ["an unknown route", "GET", "/api/nothing", undefined, 404],
    [
      "a wrong method on rooms",
      "PUT",
      "/api/rooms",
      { region: "eu-west" },
      405,
    ],
    ["a wrong method on regions", "DELETE", "/api/regions", undefined, 405],
  ] as const)("%s", async (_label, method, route, body, status) => {
    const reply = await call(method, route, body);
    expect(reply.status, reply.text).toBe(status);
    expect(reply.headers.get("content-type")).toMatch(/^application\/json/);
    expect((reply.body as { error?: unknown } | null)?.error).toEqual(
      expect.any(String),
    );
  });

  test("a body that is not JSON is unsupported", async () => {
    const response = await fetch(`${lobby.url}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "region=eu-west",
    });
    expect(response.status).toBe(415);
  });

  test("an oversized body is refused", async () => {
    const reply = await call("POST", "/api/rooms", {
      region: "eu-west",
      padding: "x".repeat(64 * 1024),
    });
    expect(reply.status).toBe(413);
  });

  test("a wrong method names the allowed ones", async () => {
    const reply = await call("PUT", "/api/rooms");
    expect(reply.headers.get("allow")).toBe("POST");
  });
});

test("the join page escapes player names and shows an alert for unknown rooms", async () => {
  const missing = await fetch(`${lobby.url}/join/nosuchroom00`);
  expect(missing.status).toBe(404);
  expect(missing.headers.get("content-type")).toMatch(/^text\/html/);
  expect(missing.headers.get("content-security-policy")).toMatch(/default-src/);
  expect(await missing.text()).toMatch(/role="alert"/);
  const room = await createRoom(lobby);
  await join(room.code, "<img src=x onerror=alert(1)>");
  const page = await (await fetch(room.link)).text();
  expect(page).not.toContain("<img src=x");
});

test("rooms expire after the configured idle time", async () => {
  const short = await startLobby({ ROOM_TTL_SECONDS: "1" });
  try {
    const room = await createRoom(short);
    expect((await fetch(`${short.url}/api/rooms/${room.code}`)).status).toBe(
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await fetch(`${short.url}/api/rooms/${room.code}`)).status).toBe(
      404,
    );
  } finally {
    await short.service.stop();
  }
});

test("the lobby shuts down cleanly on SIGTERM", async () => {
  const other = await startLobby();
  expect(await other.service.stop()).toBe(0);
});

test.each([
  ["regions that are not JSON", { LOBBY_REGIONS: "eu-west" }],
  ["no regions", { LOBBY_REGIONS: "[]" }],
  [
    "a region without a server",
    { LOBBY_REGIONS: JSON.stringify([{ id: "x", name: "X" }]) },
  ],
  ["a port that is not a number", { PORT: "http" }],
  ["a time to live that is not a number", { ROOM_TTL_SECONDS: "soon" }],
])("the lobby refuses to start with %s", async (_label, change) => {
  const port = await freePort();
  const result = startService(process.execPath, [lobbyEntry], {
    env: lobbyEnvironment(port, change),
    ready: (line) => line.includes("listening"),
    timeoutMs: 15_000,
  });
  await expect(result).rejects.toThrow(/exited with [1-9]/);
});
