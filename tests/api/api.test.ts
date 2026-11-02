import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createApi,
  type Db,
  dummyPasswordHash,
  embeddedDb,
  migrate,
  serverDb,
} from "../../apps/api/src/index.ts";

const realPostgres = process.env["TEST_DATABASE_URL"];

interface Client {
  call: (
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  json: <T>(method: string, url: string, body?: unknown) => Promise<T>;
}

const backends: [string, () => Db][] = [
  ["embedded Postgres", () => embeddedDb()],
  ...(realPostgres
    ? ([["server Postgres", () => serverDb(realPostgres)]] as [
        string,
        () => Db,
      ][])
    : []),
];

let serial = 0;
const uniqueName = () => {
  serial += 1;
  return `driver_${String(serial)}_${Date.now().toString(36)}`;
};
const uuid = () => crypto.randomUUID();
const password = "correct horse battery";

describe.each(backends)("api on %s", (_name, open) => {
  let db: Db;
  let app: ReturnType<typeof createApi>;

  beforeAll(async () => {
    db = open();
    await migrate(db);
    app = createApi(db, {
      secureCookies: false,
      dummyPasswordHash: await dummyPasswordHash(),
    });
  });

  afterAll(() => db.close());

  const client = (): Client => {
    let cookie = "";
    const call: Client["call"] = async (method, url, body, headers = {}) => {
      const response = await app.request(url, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0] ?? "";
      return response;
    };
    return {
      call,
      json: async <T>(method: string, url: string, body?: unknown) => {
        const response = await call(method, url, body);
        expect(response.ok, `${method} ${url} ${String(response.status)}`).toBe(
          true,
        );
        return (await response.json()) as T;
      },
    };
  };

  const signedUp = async (username = uniqueName()) => {
    const driver = client();
    const response = await driver.call("POST", "/api/auth/register", {
      username,
      password,
    });
    expect(response.status).toBe(201);
    return driver;
  };

  const session = (overrides: object = {}) => ({
    track: "cota",
    car: "22mp1-sector-mcl36",
    team: "vanta",
    kind: "race",
    plannedLaps: 5,
    conditions: { rain: "none" },
    startedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  });

  const lap = (timeMs: number, sectorsMs: (number | null)[]) => ({
    timeMs,
    sectorsMs,
    compound: "medium",
  });

  const startSession = async (driver: Client, overrides: object = {}) => {
    const id = uuid();
    await driver.json("PUT", `/api/sessions/${id}`, session(overrides));
    return id;
  };

  const profile = {
    firstName: "Asha",
    lastName: "Rao",
    nationality: "IN",
    number: 44,
    team: "meridian",
  };

  describe("accounts", () => {
    test("a new driver stays signed in and is not onboarded yet", async () => {
      const driver = await signedUp();
      const { driver: me } = await driver.json<{
        driver: { onboarded: boolean };
      }>("GET", "/api/me");
      expect(me.onboarded).toBe(false);
    });

    test("saving the profile onboards the driver and persists it", async () => {
      const driver = await signedUp();
      await driver.json("PUT", "/api/me", profile);
      const { driver: me } = await driver.json<{
        driver: Record<string, unknown>;
      }>("GET", "/api/me");
      expect(me).toMatchObject({ ...profile, onboarded: true });
    });

    test("names differing only by case are the same driver", async () => {
      const name = uniqueName();
      await signedUp(name);
      const response = await client().call("POST", "/api/auth/register", {
        username: name.toUpperCase(),
        password,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ field: "username" });
    });

    test.each([
      ["short name", { username: "ab", password }, "username"],
      ["bad name", { username: "no spaces!", password }, "username"],
      [
        "short password",
        { username: "valid_name", password: "1234567" },
        "password",
      ],
    ])("rejects a %s", async (_label, body, field) => {
      const response = await client().call("POST", "/api/auth/register", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ field });
    });

    test("a form post cannot register, which blocks cross-site forms", async () => {
      const response = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: uniqueName(),
          password,
        }).toString(),
      });
      expect(response.status).toBe(400);
    });

    test("signing in works with any case and a wrong password does not", async () => {
      const name = uniqueName();
      await signedUp(name);
      const wrong = await client().call("POST", "/api/auth/login", {
        username: name,
        password: "wrong password",
      });
      expect(wrong.status).toBe(401);
      const right = client();
      await right.json("POST", "/api/auth/login", {
        username: name.toUpperCase(),
        password,
      });
      expect((await right.call("GET", "/api/me")).status).toBe(200);
    });

    test("an unknown driver gets the same answer as a wrong password", async () => {
      const response = await client().call("POST", "/api/auth/login", {
        username: uniqueName(),
        password,
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Wrong name or password.",
      });
    });

    test("repeated failures lock the account even for the right password", async () => {
      const name = uniqueName();
      await signedUp(name);
      for (let attempt = 0; attempt < 5; attempt++) {
        const failed = await client().call("POST", "/api/auth/login", {
          username: name,
          password: "wrong password",
        });
        expect(failed.status).toBe(401);
      }
      const locked = await client().call("POST", "/api/auth/login", {
        username: name,
        password,
      });
      expect(locked.status).toBe(429);
    });

    test("signing out ends the session on the server", async () => {
      const driver = await signedUp();
      const replay = (await driver.call("GET", "/api/me")).status;
      expect(replay).toBe(200);
      await driver.json("POST", "/api/auth/logout", {});
      expect((await driver.call("GET", "/api/me")).status).toBe(401);
    });

    test("an expired token is refused", async () => {
      const driver = await signedUp();
      await db.exec(
        "UPDATE auth_tokens SET expires_at = now() - interval '1 second'",
      );
      expect((await driver.call("GET", "/api/me")).status).toBe(401);
    });

    test("requests without a session are refused everywhere", async () => {
      const anonymous = client();
      for (const url of [
        "/api/me",
        "/api/profile",
        "/api/profile/sessions",
        "/api/references/cota/x",
      ]) {
        expect((await anonymous.call("GET", url)).status, url).toBe(401);
      }
    });
  });

  describe("profile validation", () => {
    test.each([
      ["firstName", { firstName: "" }],
      ["firstName", { firstName: "<script>" }],
      ["lastName", { lastName: "x".repeat(25) }],
      ["nationality", { nationality: "india" }],
      ["number", { number: 0 }],
      ["number", { number: 100 }],
      ["number", { number: 4.5 }],
      ["team", { team: "../etc" }],
    ])("rejects a bad %s %j", async (field, override) => {
      const driver = await signedUp();
      const response = await driver.call("PUT", "/api/me", {
        ...profile,
        ...override,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ field });
    });

    test("accepts names from any alphabet", async () => {
      const driver = await signedUp();
      const { driver: me } = await driver.json<{
        driver: { firstName: string; lastName: string };
      }>("PUT", "/api/me", {
        ...profile,
        firstName: "प्रयांश",
        lastName: "O'Brien-Núñez",
      });
      expect(me.firstName).toBe("प्रयांश");
      expect(me.lastName).toBe("O'Brien-Núñez");
    });
  });

  describe("laps", () => {
    test("resending a lap after a lost reply does not duplicate it", async () => {
      const driver = await signedUp();
      const id = await startSession(driver);
      const url = `/api/sessions/${id}/laps/1`;
      await driver.json("PUT", url, lap(90_000, [30_000, 30_000, 30_000]));
      await driver.json("PUT", url, lap(90_000, [30_000, 30_000, 30_000]));
      const { session: stored } = await driver.json<{
        session: { lapTimes: unknown[]; laps: number };
      }>("GET", `/api/profile/sessions/${id}`);
      expect(stored.laps).toBe(1);
      expect(stored.lapTimes).toHaveLength(1);
    });

    test("recreating a session after a lost reply keeps its laps", async () => {
      const driver = await signedUp();
      const id = uuid();
      await driver.json("PUT", `/api/sessions/${id}`, session());
      await driver.json(
        "PUT",
        `/api/sessions/${id}/laps/1`,
        lap(90_000, [30_000, 30_000, 30_000]),
      );
      await driver.json("PUT", `/api/sessions/${id}`, session());
      const { session: stored } = await driver.json<{
        session: { laps: number };
      }>("GET", `/api/profile/sessions/${id}`);
      expect(stored.laps).toBe(1);
    });

    test("sectors must add up to the lap", async () => {
      const driver = await signedUp();
      const id = await startSession(driver);
      const response = await driver.call(
        "PUT",
        `/api/sessions/${id}/laps/1`,
        lap(90_000, [30_000, 30_000, 20_000]),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ field: "sectorsMs" });
    });

    test("a lap with a missed sector is kept and the sector stays empty", async () => {
      const driver = await signedUp();
      const id = await startSession(driver);
      await driver.json(
        "PUT",
        `/api/sessions/${id}/laps/1`,
        lap(90_000, [30_000, null, 30_000]),
      );
      const { session: stored } = await driver.json<{
        session: { lapTimes: { sectorsMs: (number | null)[] }[] };
      }>("GET", `/api/profile/sessions/${id}`);
      expect(stored.lapTimes[0]?.sectorsMs).toEqual([30_000, null, 30_000]);
    });

    test.each([
      ["zero time", lap(0, [1, 1, 1])],
      ["fractional time", lap(90_000.5, [30_000, 30_000, 30_000.5])],
      ["no sectors", lap(90_000, [])],
      ["negative sector", lap(90_000, [-1, 45_000, 45_001])],
    ])("rejects a lap with %s", async (_label, body) => {
      const driver = await signedUp();
      const id = await startSession(driver);
      const response = await driver.call(
        "PUT",
        `/api/sessions/${id}/laps/1`,
        body,
      );
      expect(response.status).toBe(400);
    });

    test("a driver cannot read or write another driver's session", async () => {
      const owner = await signedUp();
      const other = await signedUp();
      const id = await startSession(owner);
      await owner.json(
        "PUT",
        `/api/sessions/${id}/laps/1`,
        lap(90_000, [30_000, 30_000, 30_000]),
      );
      const read = await other.call("GET", `/api/profile/sessions/${id}`);
      expect(read.status).toBe(404);
      const write = await other.call(
        "PUT",
        `/api/sessions/${id}/laps/2`,
        lap(80_000, [20_000, 30_000, 30_000]),
      );
      expect(write.status).toBe(404);
      const overwrite = await other.call(
        "PUT",
        `/api/sessions/${id}`,
        session({ team: "corvus" }),
      );
      expect(overwrite.status).toBe(404);
      const finish = await other.call("POST", `/api/sessions/${id}/finish`);
      expect(finish.status).toBe(404);
    });

    test("finishing marks the race finished and is safe to repeat", async () => {
      const driver = await signedUp();
      const id = await startSession(driver);
      await driver.json(
        "PUT",
        `/api/sessions/${id}/laps/1`,
        lap(90_000, [30_000, 30_000, 30_000]),
      );
      await driver.json("POST", `/api/sessions/${id}/finish`);
      await driver.json("POST", `/api/sessions/${id}/finish`);
      const { session: stored } = await driver.json<{
        session: { finished: boolean };
      }>("GET", `/api/profile/sessions/${id}`);
      expect(stored.finished).toBe(true);
    });
  });

  describe("delta reference", () => {
    const trace = Buffer.from(
      new Float32Array([0, 0.5, 1, Number.NaN]).buffer,
    ).toString("base64");
    const url = "/api/references/cota/22mp1-sector-mcl36";
    const reference = (timeMs: number, sectorsMs: number[], data = trace) => ({
      timeMs,
      sectorsMs,
      trace: data,
    });

    interface Stored {
      reference: {
        timeMs: number;
        sectorsMs: number[];
        bestSectorsMs: number[];
        trace: string;
      } | null;
    }

    test("is empty for a new driver", async () => {
      const driver = await signedUp();
      expect(await driver.json<Stored>("GET", url)).toEqual({
        reference: null,
      });
    });

    test("the trace comes back byte for byte, including NaN", async () => {
      const driver = await signedUp();
      await driver.json(
        "PUT",
        url,
        reference(90_000, [30_000, 30_000, 30_000]),
      );
      const stored = await driver.json<Stored>("GET", url);
      expect(stored.reference?.trace).toBe(trace);
    });

    test("only a faster lap replaces the reference", async () => {
      const driver = await signedUp();
      const fast = reference(90_000, [30_000, 30_000, 30_000]);
      await driver.json("PUT", url, fast);
      const slower = await driver.json<{ stored: boolean }>(
        "PUT",
        url,
        reference(95_000, [31_000, 32_000, 32_000]),
      );
      expect(slower.stored).toBe(false);
      expect((await driver.json<Stored>("GET", url)).reference?.timeMs).toBe(
        90_000,
      );
      const faster = await driver.json<{ stored: boolean }>(
        "PUT",
        url,
        reference(89_000, [29_000, 30_000, 30_000]),
      );
      expect(faster.stored).toBe(true);
      expect((await driver.json<Stored>("GET", url)).reference?.timeMs).toBe(
        89_000,
      );
    });

    test("best sectors come from any lap, not just the fastest one", async () => {
      const driver = await signedUp();
      const id = await startSession(driver);
      await driver.json(
        "PUT",
        `/api/sessions/${id}/laps/1`,
        lap(90_000, [29_000, 31_000, 30_000]),
      );
      await driver.json(
        "PUT",
        `/api/sessions/${id}/laps/2`,
        lap(92_000, [33_000, 30_000, 29_000]),
      );
      await driver.json(
        "PUT",
        url,
        reference(90_000, [29_000, 31_000, 30_000]),
      );
      const stored = await driver.json<Stored>("GET", url);
      expect(stored.reference?.sectorsMs).toEqual([29_000, 31_000, 30_000]);
      expect(stored.reference?.bestSectorsMs).toEqual([29_000, 30_000, 29_000]);
    });

    test("references are private to each driver", async () => {
      const owner = await signedUp();
      await owner.json("PUT", url, reference(90_000, [30_000, 30_000, 30_000]));
      const other = await signedUp();
      expect((await other.json<Stored>("GET", url)).reference).toBeNull();
    });

    test("a missing sector cannot become a reference", async () => {
      const driver = await signedUp();
      const response = await driver.call("PUT", url, {
        timeMs: 90_000,
        sectorsMs: [30_000, null, 30_000],
        trace,
      });
      expect(response.status).toBe(400);
    });

    test.each(["not base64!", "x".repeat(400_001)])(
      "rejects a bad trace",
      async (bad) => {
        const driver = await signedUp();
        const response = await driver.call(
          "PUT",
          url,
          reference(90_000, [30_000, 30_000, 30_000], bad),
        );
        expect(response.status).toBe(400);
      },
    );
  });

  describe("history", () => {
    test("the summary adds up laps, races and the ideal lap", async () => {
      const driver = await signedUp();
      const race = await startSession(driver);
      const practice = await startSession(driver, {
        kind: "practice",
        plannedLaps: null,
        startedAt: "2026-11-01T11:00:00.000Z",
      });
      await driver.json(
        "PUT",
        `/api/sessions/${race}/laps/1`,
        lap(90_000, [29_000, 31_000, 30_000]),
      );
      await driver.json(
        "PUT",
        `/api/sessions/${practice}/laps/1`,
        lap(92_000, [33_000, 30_000, 29_000]),
      );
      const summary = await driver.json<{
        totals: object;
        bests: { timeMs: number; bestSectorsMs: number[] }[];
      }>("GET", "/api/profile");
      expect(summary.totals).toEqual({
        sessions: 2,
        races: 1,
        laps: 2,
        timeMs: 182_000,
      });
      expect(summary.bests).toHaveLength(1);
      expect(summary.bests[0]?.timeMs).toBe(90_000);
      expect(summary.bests[0]?.bestSectorsMs).toEqual([29_000, 30_000, 29_000]);
    });

    test("an empty driver has an empty summary", async () => {
      const driver = await signedUp();
      expect(await driver.json("GET", "/api/profile")).toEqual({
        totals: { sessions: 0, races: 0, laps: 0, timeMs: 0 },
        bests: [],
      });
    });

    test("bests are kept per car so physics changes do not mix", async () => {
      const driver = await signedUp();
      const a = await startSession(driver);
      const b = await startSession(driver, { car: "other-car" });
      await driver.json(
        "PUT",
        `/api/sessions/${a}/laps/1`,
        lap(90_000, [30_000, 30_000, 30_000]),
      );
      await driver.json(
        "PUT",
        `/api/sessions/${b}/laps/1`,
        lap(80_000, [20_000, 30_000, 30_000]),
      );
      const summary = await driver.json<{ bests: { car: string }[] }>(
        "GET",
        "/api/profile",
      );
      expect(summary.bests.map((best) => best.car).sort()).toEqual([
        "22mp1-sector-mcl36",
        "other-car",
      ]);
    });

    test("sessions list newest first, page, and skip sessions with no laps", async () => {
      const driver = await signedUp();
      const ids: string[] = [];
      for (let day = 1; day <= 3; day++) {
        const id = await startSession(driver, {
          startedAt: `2026-10-0${String(day)}T10:00:00.000Z`,
        });
        ids.push(id);
        await driver.json(
          "PUT",
          `/api/sessions/${id}/laps/1`,
          lap(90_000, [30_000, 30_000, 30_000]),
        );
      }
      await startSession(driver, { startedAt: "2026-10-09T10:00:00.000Z" });
      interface Page {
        sessions: { id: string; laps: number; bestMs: number }[];
        next: string | null;
      }
      const first = await driver.json<Page>(
        "GET",
        "/api/profile/sessions?limit=2",
      );
      expect(first.sessions.map((s) => s.id)).toEqual([ids[2], ids[1]]);
      expect(first.sessions[0]).toMatchObject({ laps: 1, bestMs: 90_000 });
      expect(first.next).not.toBeNull();
      const second = await driver.json<Page>(
        "GET",
        `/api/profile/sessions?limit=2&before=${encodeURIComponent(first.next ?? "")}`,
      );
      expect(second.sessions.map((s) => s.id)).toEqual([ids[0]]);
      expect(second.next).toBeNull();
    });

    test("rejects a bad page size and a bad cursor", async () => {
      const driver = await signedUp();
      const big = await driver.call("GET", "/api/profile/sessions?limit=999");
      expect(big.status).toBe(400);
      const cursor = await driver.call(
        "GET",
        "/api/profile/sessions?before=yesterday",
      );
      expect(cursor.status).toBe(400);
    });

    test("a malformed session id is a clean error, not a database error", async () => {
      const driver = await signedUp();
      const response = await driver.call(
        "GET",
        "/api/profile/sessions/not-a-uuid",
      );
      expect(response.status).toBe(400);
    });
  });
});

describe("embedded database on disk", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "f1-api-"));

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test("keeps data across restarts and migrating twice changes nothing", async () => {
    const dataDir = path.join(directory, "not", "created", "yet");
    const first = embeddedDb(dataDir);
    await migrate(first);
    const app = createApi(first, {
      secureCookies: false,
      dummyPasswordHash: await dummyPasswordHash(),
    });
    const created = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "restart_me", password }),
    });
    expect(created.status).toBe(201);
    await first.close();

    const second = embeddedDb(dataDir);
    await migrate(second);
    const rows = await second.query<{ username: string }>(
      "SELECT username FROM drivers",
    );
    expect(rows.map((row) => row.username)).toEqual(["restart_me"]);
    await second.close();
  });
});
