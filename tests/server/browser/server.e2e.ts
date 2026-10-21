import { expect, test, type Browser, type Page } from "@playwright/test";
import type {
  ClientMessage,
  Input,
  ServerMessage,
  Snapshot,
} from "../../../apps/client/src/contracts/index.ts";
import { pedals } from "../../support/sim.ts";
import { recordProblems } from "../../support/bundle.ts";
import {
  buildServer,
  startServer,
  testTrack,
  type GameServer,
} from "../support/server.ts";

interface SessionState {
  closed: boolean;
  error: string | null;
}

interface Client {
  open: (url: string, hash: string) => Promise<number>;
  send: (id: number, message: unknown) => Promise<void>;
  sendText: (id: number, text: string) => Promise<void>;
  take: (id: number) => ServerMessage[];
  state: (id: number) => SessionState;
  close: (id: number) => void;
}

declare global {
  interface Window {
    client: Client;
  }
}

function installClient(): void {
  interface Session {
    transport: WebTransport;
    writer: WritableStreamDefaultWriter<Uint8Array>;
    messages: ServerMessage[];
    closed: boolean;
    error: string | null;
  }
  const sessions = new Map<number, Session>();
  let next = 0;
  const get = (id: number): Session => {
    const session = sessions.get(id);
    if (session === undefined) {
      throw new Error(`no session ${String(id)}`);
    }
    return session;
  };
  const listen = async (
    session: Session,
    readable: ReadableStream<Uint8Array>,
  ) => {
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        for (
          let end = buffer.indexOf("\n");
          end >= 0;
          end = buffer.indexOf("\n")
        ) {
          session.messages.push(
            JSON.parse(buffer.slice(0, end)) as ServerMessage,
          );
          buffer = buffer.slice(end + 1);
        }
      }
    } catch (error) {
      session.error = String(error);
    }
    session.closed = true;
  };
  window.client = {
    async open(url, hash) {
      const value = Uint8Array.from(
        (hash.match(/../g) ?? []).map((pair) => parseInt(pair, 16)),
      );
      const transport = new WebTransport(url, {
        serverCertificateHashes: [{ algorithm: "sha-256", value }],
      });
      await transport.ready;
      const stream = await transport.createBidirectionalStream();
      const writable = stream.writable as WritableStream<Uint8Array>;
      const readable = stream.readable as ReadableStream<Uint8Array>;
      const session: Session = {
        transport,
        writer: writable.getWriter(),
        messages: [],
        closed: false,
        error: null,
      };
      const id = next;
      next += 1;
      sessions.set(id, session);
      void listen(session, readable);
      void transport.closed.then(
        () => {
          session.closed = true;
        },
        (error: unknown) => {
          session.closed = true;
          session.error = String(error);
        },
      );
      return id;
    },
    async send(id, message) {
      await get(id).writer.write(
        new TextEncoder().encode(`${JSON.stringify(message)}\n`),
      );
    },
    async sendText(id, text) {
      await get(id).writer.write(new TextEncoder().encode(text));
    },
    take(id) {
      const session = get(id);
      const messages = session.messages;
      session.messages = [];
      return messages;
    },
    state(id) {
      const { closed, error } = get(id);
      return { closed, error };
    },
    close(id) {
      get(id).transport.close();
    },
  };
}

let executable: string;
let server: GameServer;

test.beforeAll(async () => {
  test.setTimeout(600_000);
  executable = buildServer();
  server = await startServer(executable);
});

test.afterAll(async () => {
  await server.stop();
});

async function clientPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/__n2/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>n2</title></head><body></body></html>',
    }),
  );
  await page.addInitScript(installClient);
  await page.goto("/__n2/index.html");
  return page;
}

function roomUrl(room: string): string {
  return `https://127.0.0.1:${String(server.port)}/rooms/${room}`;
}

async function connect(page: Page, room: string): Promise<number> {
  return page.evaluate(([url, hash]) => window.client.open(url, hash), [
    roomUrl(room),
    server.certificateHash,
  ] as const);
}

async function send(
  page: Page,
  id: number,
  message: ClientMessage | Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([session, payload]) => window.client.send(session, payload),
    [id, message] as const,
  );
}

async function take(page: Page, id: number): Promise<ServerMessage[]> {
  return page.evaluate((session) => window.client.take(session), id);
}

async function waitFor<T extends ServerMessage["type"]>(
  page: Page,
  id: number,
  type: T,
  timeout = 5000,
): Promise<Extract<ServerMessage, { type: T }>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = (await take(page, id)).find(
      (message) => message.type === type,
    );
    if (found !== undefined) {
      return found as Extract<ServerMessage, { type: T }>;
    }
    await page.waitForTimeout(20);
  }
  throw new Error(`no ${type} message within ${String(timeout)} ms`);
}

async function join(page: Page, room: string, name: string) {
  const id = await connect(page, room);
  await send(page, id, { type: "join", name });
  const welcome = await waitFor(page, id, "welcome");
  return { id, welcome };
}

async function snapshotsFor(
  page: Page,
  id: number,
  milliseconds: number,
): Promise<{ snapshot: Snapshot; lastInputTick: number }[]> {
  await take(page, id);
  await page.waitForTimeout(milliseconds);
  return (await take(page, id)).flatMap((message) =>
    message.type === "snapshot" ? [message] : [],
  );
}

function uniqueRoom(): string {
  return `room${Math.random().toString(36).slice(2, 12)}`;
}

function carOf(snapshot: Snapshot, id: number) {
  return snapshot.cars.find((car) => car.id === id);
}

function speedOf(snapshot: Snapshot, id: number): number {
  const car = carOf(snapshot, id);
  return car === undefined
    ? Number.NaN
    : Math.hypot(car.velocity.x, car.velocity.y, car.velocity.z);
}

test("a client joins and receives snapshots every 8 ticks at 62.5 per second", async ({
  browser,
}) => {
  const page = await clientPage(browser);
  const problems = recordProblems(page);
  const room = uniqueRoom();
  const { id, welcome } = await join(page, room, "Ana");
  expect(welcome.setup.track).toEqual(testTrack);
  expect(welcome.setup.cars.map((car) => car.id)).toContain(welcome.carId);
  const snapshots = await snapshotsFor(page, id, 2000);
  expect(snapshots.length).toBeGreaterThanOrEqual(100);
  expect(snapshots.length).toBeLessThanOrEqual(150);
  const ticks = snapshots.map((message) => message.snapshot.tick);
  const steps = ticks.slice(1).map((tick, index) => tick - (ticks[index] ?? 0));
  for (const step of steps) {
    expect(step).toBeGreaterThanOrEqual(8);
    expect(step % 8).toBe(0);
  }
  expect(
    steps.filter((step) => step === 8).length / steps.length,
  ).toBeGreaterThanOrEqual(0.9);
  for (const tick of ticks) {
    expect(tick % 8).toBe(0);
  }
  expect(
    carOf(snapshots.at(-1)?.snapshot ?? { tick: 0, cars: [] }, welcome.carId),
  ).toBeDefined();
  expect(problems).toEqual([]);
});

test("two clients in one room see both cars and the same world", async ({
  browser,
}) => {
  const first = await clientPage(browser);
  const second = await clientPage(browser);
  const room = uniqueRoom();
  const ana = await join(first, room, "Ana");
  const ben = await join(second, room, "Ben");
  expect(ben.welcome.carId).not.toBe(ana.welcome.carId);
  expect(ben.welcome.setup.cars.map((car) => car.id).sort()).toEqual(
    [ana.welcome.carId, ben.welcome.carId].sort(),
  );
  const [fromAna, fromBen] = await Promise.all([
    snapshotsFor(first, ana.id, 1000),
    snapshotsFor(second, ben.id, 1000),
  ]);
  for (const message of [...fromAna, ...fromBen]) {
    expect(message.snapshot.cars.map((car) => car.id).sort()).toEqual(
      [ana.welcome.carId, ben.welcome.carId].sort(),
    );
  }
  const byTick = new Map(
    fromAna.map((message) => [message.snapshot.tick, message.snapshot]),
  );
  const shared = fromBen.filter((message) => byTick.has(message.snapshot.tick));
  expect(shared.length).toBeGreaterThan(20);
  for (const message of shared) {
    expect(message.snapshot).toEqual(byTick.get(message.snapshot.tick));
  }
});

async function drive(
  page: Page,
  id: number,
  input: Input,
  milliseconds: number,
): Promise<number> {
  let tick = 0;
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    tick += 1;
    await send(page, id, { type: "input", tick, input });
    await page.waitForTimeout(25);
  }
  return tick;
}

test("inputs drive only the sender's car and are acknowledged", async ({
  browser,
}) => {
  const first = await clientPage(browser);
  const second = await clientPage(browser);
  const room = uniqueRoom();
  const ana = await join(first, room, "Ana");
  const ben = await join(second, room, "Ben");
  const lastTick = await drive(first, ana.id, pedals({ throttle: 1 }), 1500);
  await first.waitForTimeout(200);
  const anaView = await snapshotsFor(first, ana.id, 300);
  const benView = await snapshotsFor(second, ben.id, 300);
  const latest = anaView.at(-1);
  if (latest === undefined) {
    throw new Error("no snapshots");
  }
  expect(latest.lastInputTick).toBe(lastTick);
  expect(speedOf(latest.snapshot, ana.welcome.carId)).toBeGreaterThan(5);
  expect(speedOf(latest.snapshot, ben.welcome.carId)).toBe(0);
  expect(benView.at(-1)?.lastInputTick).toBe(0);
});

test("a late joiner does not reset the cars already racing", async ({
  browser,
}) => {
  const first = await clientPage(browser);
  const second = await clientPage(browser);
  const room = uniqueRoom();
  const ana = await join(first, room, "Ana");
  await drive(first, ana.id, pedals({ throttle: 1 }), 1000);
  const before = (await snapshotsFor(first, ana.id, 200)).at(-1);
  await join(second, room, "Ben");
  const after = (await snapshotsFor(first, ana.id, 500)).at(0);
  const distance = (snapshot: Snapshot | undefined) =>
    carOf(snapshot ?? { tick: 0, cars: [] }, ana.welcome.carId)?.lapDistance ??
    Number.NaN;
  expect(after?.snapshot.tick ?? 0).toBeGreaterThan(before?.snapshot.tick ?? 0);
  expect(distance(after?.snapshot)).toBeGreaterThan(distance(before?.snapshot));
  expect(
    speedOf(after?.snapshot ?? { tick: 0, cars: [] }, ana.welcome.carId),
  ).toBeGreaterThan(1);
});

test("a client that leaves disappears from the room", async ({ browser }) => {
  const first = await clientPage(browser);
  const second = await clientPage(browser);
  const room = uniqueRoom();
  const ana = await join(first, room, "Ana");
  const ben = await join(second, room, "Ben");
  await second.evaluate((session) => {
    window.client.close(session);
  }, ben.id);
  await first.waitForTimeout(1000);
  const latest = (await snapshotsFor(first, ana.id, 300)).at(-1);
  expect(latest?.snapshot.cars.map((car) => car.id)).toEqual([
    ana.welcome.carId,
  ]);
});

test("rooms are isolated from each other", async ({ browser }) => {
  const first = await clientPage(browser);
  const second = await clientPage(browser);
  const ana = await join(first, uniqueRoom(), "Ana");
  await join(second, uniqueRoom(), "Ben");
  const latest = (await snapshotsFor(first, ana.id, 500)).at(-1);
  expect(latest?.snapshot.cars).toHaveLength(1);
});

test("ping is answered with the same client time and a server tick advancing at 500 per second", async ({
  browser,
}) => {
  const page = await clientPage(browser);
  const { id } = await join(page, uniqueRoom(), "Ana");
  await send(page, id, { type: "ping", clientTime: 1234.5678 });
  const first = await waitFor(page, id, "pong");
  expect(first.clientTime).toBe(1234.5678);
  const started = Date.now();
  await page.waitForTimeout(1000);
  await send(page, id, { type: "ping", clientTime: 2 });
  const second = await waitFor(page, id, "pong");
  const rate =
    ((second.serverTick - first.serverTick) * 1000) / (Date.now() - started);
  expect(rate).toBeGreaterThanOrEqual(450);
  expect(rate).toBeLessThanOrEqual(550);
});

test("a room holds 22 cars and rejects the 23rd driver", async ({
  browser,
}) => {
  const page = await clientPage(browser);
  const room = uniqueRoom();
  for (let seat = 0; seat < 22; seat += 1) {
    await join(page, room, `Driver ${String(seat)}`);
  }
  const spare = await connect(page, room);
  await send(page, spare, { type: "join", name: "Spare" });
  const rejected = await waitFor(page, spare, "rejected");
  expect(rejected.reason.trim()).not.toBe("");
});

async function expectRejectedAndClosed(page: Page, id: number): Promise<void> {
  const rejected = await waitFor(page, id, "rejected");
  expect(rejected.reason.trim()).not.toBe("");
  await expect
    .poll(
      () => page.evaluate((session) => window.client.state(session).closed, id),
      { timeout: 3000 },
    )
    .toBe(true);
}

test.describe("misbehaving clients are rejected and disconnected", () => {
  const cases: [string, (page: Page, id: number) => Promise<void>][] = [
    [
      "input before joining",
      (page, id) =>
        send(page, id, {
          type: "input",
          tick: 1,
          input: pedals({ throttle: 1 }),
        }),
    ],
    [
      "text that is not JSON",
      (page, id) =>
        page.evaluate(
          (session) => window.client.sendText(session, "go fast\n"),
          id,
        ),
    ],
    [
      "an unknown message type",
      (page, id) => send(page, id, { type: "teleport" }),
    ],
    [
      "a name that is too long",
      (page, id) => send(page, id, { type: "join", name: "x".repeat(25) }),
    ],
    [
      "an empty name",
      (page, id) => send(page, id, { type: "join", name: "  " }),
    ],
    [
      "an out-of-range input after joining",
      async (page, id) => {
        await send(page, id, { type: "join", name: "Ana" });
        await waitFor(page, id, "welcome");
        await send(page, id, {
          type: "input",
          tick: 1,
          input: pedals({ throttle: 7 }),
        });
      },
    ],
    [
      "a second join",
      async (page, id) => {
        await send(page, id, { type: "join", name: "Ana" });
        await waitFor(page, id, "welcome");
        await send(page, id, { type: "join", name: "Ana again" });
      },
    ],
  ];

  for (const [label, misbehave] of cases) {
    test(label, async ({ browser }) => {
      const page = await clientPage(browser);
      const id = await connect(page, uniqueRoom());
      await misbehave(page, id);
      await expectRejectedAndClosed(page, id);
    });
  }
});

test("an invalid room path is refused", async ({ browser }) => {
  const page = await clientPage(browser);
  for (const room of ["Bad Room", "ab", "x".repeat(33)]) {
    const outcome = await page.evaluate(
      async ([url, hash]) => {
        try {
          const id = await window.client.open(url, hash);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return window.client.state(id).closed ? "closed" : "open";
        } catch {
          return "refused";
        }
      },
      [roomUrl(encodeURIComponent(room)), server.certificateHash] as const,
    );
    expect(outcome, room).not.toBe("open");
  }
});
