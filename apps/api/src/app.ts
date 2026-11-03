import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { hashPassword, newToken, tokenHash, verifyPassword } from "./auth.ts";
import type { Db } from "./db.ts";
import { padRoutes } from "./pad.ts";
import { PadRooms, RoomsFull } from "./pad-rooms.ts";
import {
  addLap,
  createDriver,
  createSession,
  type Driver,
  driverForToken,
  dropToken,
  findLogin,
  finishSession,
  isUsernameTaken,
  listSessions,
  loadReference,
  profileSummary,
  recordFailedLogin,
  recordLogin,
  saveReference,
  sessionDetail,
  storeToken,
  updateProfile,
} from "./store.ts";
import {
  type Body,
  checkDate,
  checkId,
  checkInteger,
  checkLap,
  checkPassword,
  checkProfile,
  checkReference,
  checkSession,
  checkSlug,
  checkUsername,
  Invalid,
} from "./validate.ts";

const cookieName = "f1_session";
const cookieSeconds = 60 * 60 * 24 * 60;
const defaultPageSize = 20;
const maxPageSize = 50;

type Env = { Variables: { driver: Driver } };

export interface ApiOptions {
  secureCookies: boolean;
  dummyPasswordHash: string;
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

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isLocked(until: Date | string | null | undefined): boolean {
  return !!until && new Date(until).getTime() > Date.now();
}

function pageSize(value: string | undefined): number {
  return value === undefined
    ? defaultPageSize
    : checkInteger(Number(value), "limit", 1, maxPageSize);
}

function param(c: Context, name: string): string {
  return c.req.param(name) ?? "";
}

export function createApi(db: Db, options: ApiOptions): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((error, c) => {
    if (error instanceof Invalid)
      return c.json({ error: error.message, field: error.field }, 400);
    if (error instanceof RoomsFull)
      return c.json({ error: "Too many games are pairing." }, 503);
    throw error;
  });

  padRoutes(app, options.padRooms ?? new PadRooms(), options.padWait ?? 20_000);

  const startSession = async (c: Context, driver: Driver) => {
    const token = newToken();
    await storeToken(db, tokenHash(token), driver.id);
    setCookie(c, cookieName, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: options.secureCookies,
      path: "/api",
      maxAge: cookieSeconds,
    });
  };

  const signedIn = createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, cookieName);
    const driver = token ? await driverForToken(db, tokenHash(token)) : null;
    if (!driver) return c.json({ error: "Sign in first." }, 401);
    c.set("driver", driver);
    await next();
    return undefined;
  });

  app.post("/api/auth/register", async (c) => {
    const body = await readBody(c);
    const username = checkUsername(body["username"]);
    const password = checkPassword(body["password"]);
    const hash = await hashPassword(password);
    const driver = await createDriver(db, username, hash).catch(
      (error: unknown) => {
        if (isUsernameTaken(error))
          throw new Invalid("That name is taken.", "username");
        throw error;
      },
    );
    await startSession(c, driver);
    return c.json({ driver }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const body = await readBody(c);
    const found = await findLogin(db, text(body["username"]));
    const matches = await verifyPassword(
      text(body["password"]),
      found?.row.password_hash ?? options.dummyPasswordHash,
    );
    if (isLocked(found?.row.locked_until))
      return c.json({ error: "Too many tries. Wait a minute." }, 429);
    if (!found || !matches) {
      if (found) await recordFailedLogin(db, found.driver.id);
      return c.json({ error: "Wrong name or password." }, 401);
    }
    await recordLogin(db, found.driver.id);
    await startSession(c, found.driver);
    return c.json({ driver: found.driver });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, cookieName);
    if (token) await dropToken(db, tokenHash(token));
    deleteCookie(c, cookieName, { path: "/api" });
    return c.json({ ok: true });
  });

  app.use("/api/me", signedIn);
  app.use("/api/sessions/*", signedIn);
  app.use("/api/references/*", signedIn);
  app.use("/api/profile", signedIn);
  app.use("/api/profile/*", signedIn);

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

export function dummyPasswordHash(): Promise<string> {
  return hashPassword(newToken());
}
