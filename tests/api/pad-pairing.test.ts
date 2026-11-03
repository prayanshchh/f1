import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createApi,
  type Db,
  dummyPasswordHash,
  embeddedDb,
} from "../../apps/api/src/index.ts";
import { PadRooms } from "../../apps/api/src/pad-rooms.ts";

const wait = 400;
const offerLife = 30_000;
const maxPending = 3;
const offerSdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=offer\r\n";
const answerSdp = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\na=answer\r\n";

let serial = 0;
const newRoom = () => {
  serial += 1;
  return `room${String(serial).padStart(18, "0")}`;
};

describe("phone pad pairing", () => {
  let db: Db;
  let now = 0;
  let app: ReturnType<typeof createApi>;

  beforeAll(async () => {
    db = embeddedDb();
    await db.exec("select 1");
    app = createApi(db, {
      secureCookies: false,
      dummyPasswordHash: await dummyPasswordHash(),
      padRooms: new PadRooms({ offerLife, maxPending }, () => now),
      padWait: wait,
    });
  });

  afterAll(() => db.close());

  const call = (method: string, url: string, sdp?: string) =>
    app.request(url, {
      method,
      ...(sdp === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sdp }),
          }),
    });

  const offer = async (room: string, sdp = offerSdp) => {
    const response = await call("POST", `/api/pad/${room}/offers`, sdp);
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; seq: number };
  };

  const offers = async (room: string, after = 0) => {
    const response = await call(
      "GET",
      `/api/pad/${room}/offers?after=${String(after)}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      offers: { id: string; seq: number; sdp: string }[];
    };
    return body.offers;
  };

  const timed = async <T>(work: T | Promise<T>) => {
    const start = performance.now();
    const result = await work;
    return { result, ms: performance.now() - start };
  };

  test("a phone's offer wakes the waiting game and the game's answer wakes the waiting phone", async () => {
    const room = newRoom();
    const gameWaiting = timed(offers(room));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const { id } = await offer(room);
    const seen = await gameWaiting;
    expect(seen.ms).toBeLessThan(wait / 2);
    expect(seen.result).toEqual([{ id, seq: 1, sdp: offerSdp }]);

    const phoneWaiting = timed(call("GET", `/api/pad/${room}/answers/${id}`));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const answered = await call(
      "PUT",
      `/api/pad/${room}/answers/${id}`,
      answerSdp,
    );
    expect(answered.status).toBe(204);
    const reply = await phoneWaiting;
    expect(reply.ms).toBeLessThan(wait / 2);
    expect(reply.result.status).toBe(200);
    expect(reply.result.headers.get("cache-control")).toBe("no-store");
    expect(await reply.result.json()).toEqual({ sdp: answerSdp });

    const again = await call("GET", `/api/pad/${room}/answers/${id}`);
    expect(again.status).toBe(404);
  });

  test("a game only sees offers made to its own room, newer than the last one it saw and not yet answered", async () => {
    const room = newRoom();
    const other = newRoom();
    const first = await offer(room);
    const second = await offer(room);
    await offer(other);
    expect((await offers(room)).map((o) => o.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect((await offers(room, first.seq)).map((o) => o.id)).toEqual([
      second.id,
    ]);

    await call("PUT", `/api/pad/${room}/answers/${second.id}`, answerSdp);
    const late = await timed(offers(room, first.seq));
    expect(late.result).toEqual([]);
    expect(late.ms).toBeGreaterThanOrEqual(wait - 50);
  });

  test("a phone with no answer yet is told to keep waiting, and an offer nobody answers expires", async () => {
    const room = newRoom();
    const { id } = await offer(room);
    const pending = await call("GET", `/api/pad/${room}/answers/${id}`);
    expect(pending.status).toBe(204);

    now += offerLife + 1;
    expect(await offers(room)).toEqual([]);
    const expired = await call("GET", `/api/pad/${room}/answers/${id}`);
    expect(expired.status).toBe(404);
    const late = await call("PUT", `/api/pad/${room}/answers/${id}`, answerSdp);
    expect(late.status).toBe(404);
  });

  test("a room holds a bounded number of waiting phones", async () => {
    const room = newRoom();
    for (let i = 0; i < maxPending; i++) await offer(room);
    const refused = await call("POST", `/api/pad/${room}/offers`, offerSdp);
    expect(refused.status).toBe(429);
  });

  test.each([
    ["a malformed room", "POST", "/api/pad/short/offers", offerSdp, 400],
    [
      "a body that is not SDP",
      "POST",
      `/api/pad/${"a".repeat(22)}/offers`,
      "hello",
      400,
    ],
    [
      "an oversized SDP",
      "POST",
      `/api/pad/${"a".repeat(22)}/offers`,
      `v=0\r\n${"a".repeat(20_000)}`,
      400,
    ],
    [
      "an answer for an unknown offer",
      "PUT",
      `/api/pad/${"a".repeat(22)}/answers/${crypto.randomUUID()}`,
      answerSdp,
      404,
    ],
    [
      "an answer for an offer id that is not a uuid",
      "PUT",
      `/api/pad/${"a".repeat(22)}/answers/nope`,
      answerSdp,
      400,
    ],
  ])("refuses %s", async (_name, method, url, sdp, status) => {
    const response = await call(method, url, sdp);
    expect(response.status).toBe(status);
  });
});
