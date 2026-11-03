import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { keyHash } from "./auth.ts";
import type { Db } from "./db.ts";
import { padRoutes } from "./pad.ts";
import { PadRooms, RoomsFull } from "./pad-rooms.ts";
import {
  addLap,
  createSession,
  type Driver,
  driverForKey,
  finishSession,
  joinPlayer,
  listSessions,
  loadReference,
  profileSummary,
  saveReference,
  sessionDetail,
  updateProfile,
} from "./store.ts";
import {
  type Body,
  checkDate,
  checkId,
  checkInteger,
  checkKey,
  checkLap,
  checkProfile,
  checkReference,
  checkSession,
  checkSlug,
  Invalid,
} from "./validate.ts";

const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/;
const defaultPageSize = 20;
const maxPageSize = 50;

type Env = { Variables: { driver: Driver } };

export interface ApiOptions {
  padRooms?: PadRooms;
  padWait?: number;
}

async function readBody(c: Context): Promise<Body> {
  if (!c.req.header("content-type")?.startsWith("application/json"))
    throw new Invalid("Send JSON.", "body");
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new Invalid("Send a JSON object.", "body");
  return body as Body;
}

function pageSize(value: string | undefined): number {
  return value === undefined
    ? defaultPageSize
    : checkInteger(Number(value), "limit", 1, maxPageSize);
}

function param(c: Context, name: string): string {
  return c.req.param(name) ?? "";
}

export function createApi(db: Db, options: ApiOptions = {}): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((error, c) => {
    if (error instanceof Invalid)
      return c.json({ error: error.message, field: error.field }, 400);
    if (error instanceof RoomsFull)
      return c.json({ error: "Too many games are pairing." }, 503);
    throw error;
  });

  padRoutes(app, options.padRooms ?? new PadRooms(), options.padWait ?? 20_000);

  const knownPlayer = createMiddleware<Env>(async (c, next) => {
    const key = bearer.exec(c.req.header("authorization") ?? "")?.[1];
    const driver = key ? await driverForKey(db, keyHash(key)) : null;
    if (!driver) return c.json({ error: "Unknown player." }, 401);
    c.set("driver", driver);
    await next();
    return undefined;
  });

  app.post("/api/players", async (c) => {
    const key = checkKey((await readBody(c))["key"]);
    return c.json({ driver: await joinPlayer(db, keyHash(key)) });
  });

  app.use("/api/me", knownPlayer);
  app.use("/api/sessions/*", knownPlayer);
  app.use("/api/references/*", knownPlayer);
  app.use("/api/profile", knownPlayer);
  app.use("/api/profile/*", knownPlayer);

  app.get("/api/me", (c) => c.json({ driver: c.get("driver") }));

  app.put("/api/me", async (c) => {
    const profile = checkProfile(await readBody(c));
    const driver = await updateProfile(db, c.get("driver").id, profile);
    return c.json({ driver });
  });

  app.put("/api/sessions/:id", async (c) => {
    const id = checkId(param(c, "id"));
    const session = checkSession(await readBody(c));
    const owned = await createSession(db, id, c.get("driver").id, session);
    return owned ? c.json({ id }) : c.json({ error: "Not found." }, 404);
  });

  app.put("/api/sessions/:id/laps/:lap", async (c) => {
    const lap = checkInteger(Number(param(c, "lap")), "lap", 1, 1000);
    const saved = await addLap(
      db,
      checkId(param(c, "id")),
      c.get("driver").id,
      lap,
      checkLap(await readBody(c)),
    );
    return saved ? c.json({ ok: true }) : c.json({ error: "Not found." }, 404);
  });

  app.post("/api/sessions/:id/finish", async (c) => {
    const done = await finishSession(
      db,
      checkId(param(c, "id")),
      c.get("driver").id,
    );
    return done ? c.json({ ok: true }) : c.json({ error: "Not found." }, 404);
  });

  app.get("/api/references/:track/:car", async (c) => {
    const reference = await loadReference(
      db,
      c.get("driver").id,
      checkSlug(param(c, "track"), "track"),
      checkSlug(param(c, "car"), "car"),
    );
    return c.json({ reference });
  });

  app.put("/api/references/:track/:car", async (c) => {
    const stored = await saveReference(
      db,
      c.get("driver").id,
      checkSlug(param(c, "track"), "track"),
      checkSlug(param(c, "car"), "car"),
      checkReference(await readBody(c)),
    );
    return c.json({ stored });
  });

  app.get("/api/profile", async (c) =>
    c.json(await profileSummary(db, c.get("driver").id)),
  );

  app.get("/api/profile/sessions", async (c) => {
    const before = c.req.query("before");
    return c.json(
      await listSessions(
        db,
        c.get("driver").id,
        before === undefined ? null : checkDate(before, "before"),
        pageSize(c.req.query("limit")),
      ),
    );
  });

  app.get("/api/profile/sessions/:id", async (c) => {
    const session = await sessionDetail(
      db,
      c.get("driver").id,
      checkId(param(c, "id")),
    );
    return session ? c.json({ session }) : c.json({ error: "Not found." }, 404);
  });

  return app;
}
