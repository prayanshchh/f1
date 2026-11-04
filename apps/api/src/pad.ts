import { type Context, type Env, Hono } from "hono";
import type { PadRooms } from "./pad-rooms.ts";
import { checkId, checkInteger, Invalid, invalidAnswer } from "./validate.ts";

const roomPattern = /^[A-Za-z0-9_-]{22}$/;
const maxSdp = 20_000;

function checkRoom(c: Context): string {
  const room = c.req.param("room") ?? "";
  if (!roomPattern.test(room)) throw new Invalid("room is not valid.", "room");
  return room;
}

async function readSdp(c: Context): Promise<string> {
  const body: unknown = await c.req.json().catch(() => null);
  const sdp =
    typeof body === "object" && body !== null && "sdp" in body
      ? body.sdp
      : null;
  if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > maxSdp)
    throw new Invalid("sdp is not valid.", "sdp");
  return sdp;
}

function offerId(c: Context): string {
  return checkId(c.req.param("id"));
}

export function padRoutes<E extends Env>(
  app: Hono<E>,
  rooms: PadRooms,
  wait: number,
): void {
  app.use("/api/pad/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.post("/api/pad/:room/offers", async (c) => {
    const offer = rooms.offer(checkRoom(c), await readSdp(c));
    if (!offer) return c.json({ error: "Too many phones are pairing." }, 429);
    return c.json({ id: offer.id, seq: offer.seq }, 201);
  });

  app.get("/api/pad/:room/offers", async (c) => {
    const room = checkRoom(c);
    const after = checkInteger(
      Number(c.req.query("after") ?? 0),
      "after",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    if (rooms.offers(room, after).length === 0)
      await rooms.wait(room, wait, c.req.raw.signal);
    return c.json({ offers: rooms.offers(room, after) });
  });

  app.put("/api/pad/:room/answers/:id", async (c) => {
    const stored = rooms.answer(checkRoom(c), offerId(c), await readSdp(c));
    return stored ? c.body(null, 204) : c.json({ error: "Not found." }, 404);
  });

  app.get("/api/pad/:room/answers/:id", async (c) => {
    const room = checkRoom(c);
    const id = offerId(c);
    let answer = rooms.answerFor(room, id);
    if (answer === null) {
      await rooms.wait(room, wait, c.req.raw.signal);
      answer = rooms.answerFor(room, id);
    }
    if (answer === undefined) return c.json({ error: "Not found." }, 404);
    return answer === null ? c.body(null, 204) : c.json({ sdp: answer });
  });
}

export function padApp(rooms: PadRooms, wait: number): Hono {
  const app = new Hono();
  app.onError(invalidAnswer);
  padRoutes(app, rooms, wait);
  return app;
}
