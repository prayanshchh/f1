import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createApi,
  type Db,
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

const newKey = () => randomBytes(32).toString("base64url");
const uuid = () => crypto.randomUUID();

describe.each(backends)("api on %s", (_name, open) => {
  let db: Db;
  let app: ReturnType<typeof createApi>;

  beforeAll(async () => {
    db = open();
    await migrate(db);
    app = createApi(db);
  });

  afterAll(() => db.close());

  const client = (key: string | null = null): Client => {
    const call: Client["call"] = async (method, url, body, headers = {}) =>
      app.request(url, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
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

  const join = async (key: string) => {
    const response = await client().call("POST", "/api/players", { key });
    expect(response.status).toBe(200);
    return ((await response.json()) as { driver: { id: string } }).driver;
  };

  const signedUp = async (key = newKey()) => {
    await join(key);
    return client(key);
  };

  const session = (overrides: object = {}) => ({
    track: "hill-country",
    car: "revracer-26",
    team: "velza",
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

  describe("players", () => {
    test("a new key makes a driver who is not onboarded yet", async () => {
      const driver = await signedUp();
      const { driver: me } = await driver.json<{
        driver: { onboarded: boolean };
      }>("GET", "/api/me");
      expect(me.onboarded).toBe(false);
    });

    test("the same key always comes back as the same driver", async () => {
      const key = newKey();
      const first = await join(key);
      const again = await join(key);
      expect(again.id).toBe(first.id);
      const { driver: me } = await client(key).json<{
        driver: { id: string };
      }>("GET", "/api/me");
      expect(me.id).toBe(first.id);
    });

    test("every key is its own driver", async () => {
      const one = await join(newKey());
      const two = await join(newKey());
      expect(two.id).not.toBe(one.id);
    });

    test("saving the profile onboards the driver and persists it", async () => {
      const driver = await signedUp();
      await driver.json("PUT", "/api/me", profile);
      const { driver: me } = await driver.json<{
        driver: Record<string, unknown>;
      }>("GET", "/api/me");
      expect(me).toMatchObject({ ...profile, onboarded: true });
    });

    test("renaming keeps the same driver and their laps", async () => {
      const key = newKey();
      const { id } = await join(key);
      const driver = client(key);
      await driver.json("PUT", "/api/me", profile);
      const race = await startSession(driver);
      await driver.json(
        "PUT",
        `/api/sessions/${race}/laps/1`,
        lap(95_000, [30_000, 35_000, 30_000]),
      );
      const { driver: renamed } = await driver.json<{
        driver: { id: string; firstName: string };
      }>("PUT", "/api/me", { ...profile, firstName: "Mira" });
      expect(renamed).toMatchObject({ id, firstName: "Mira" });
      const summary = await driver.json<{ totals: { laps: number } }>(
        "GET",
        "/api/profile",
      );
      expect(summary.totals.laps).toBe(1);
    });

    test("two players can have the same name", async () => {
      for (const driver of [await signedUp(), await signedUp()]) {
        const response = await driver.call("PUT", "/api/me", profile);
        expect(response.status).toBe(200);
      }
    });

    test("the database never holds the key itself", async () => {
      const key = newKey();
      await join(key);
      const rows = await db.query<Record<string, unknown>>(
        "SELECT * FROM drivers",
      );
      expect(JSON.stringify(rows)).not.toContain(key);
    });

    test.each([
      ["a missing key", {}],
      ["a short key", { key: "abc" }],
      ["a key with bad characters", { key: `${newKey().slice(1)}!` }],
      ["a key that is not text", { key: 12 }],
    ])("rejects %s", async (_label, body) => {
      const response = await client().call("POST", "/api/players", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ field: "key" });
    });

    test("a form post cannot make a player, which blocks cross-site forms", async () => {
      const response = await app.request("/api/players", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key: newKey() }).toString(),
      });
      expect(response.status).toBe(400);
    });

    test("requests without a known key are refused everywhere", async () => {
      const unknown = client(newKey());
      const anonymous = client();
      const malformed = (url: string) =>
        anonymous.call("GET", url, undefined, { authorization: "Bearer x" });
      for (const url of [
        "/api/me",
        "/api/profile",
        "/api/profile/sessions",
        "/api/references/hill-country/x",
      ]) {
        expect((await anonymous.call("GET", url)).status, url).toBe(401);
        expect((await unknown.call("GET", url)).status, url).toBe(401);
        expect((await malformed(url)).status, url).toBe(401);
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
    const url = "/api/references/hill-country/revracer-26";
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

    test("a lap deleted for track limits stays in the history but is never a best", async () => {
      const driver = await signedUp();
      const race = await startSession(driver);
      await driver.json(
        "PUT",
        `/api/sessions/${race}/laps/1`,
        lap(92_000, [31_000, 31_000, 30_000]),
      );
      await driver.json("PUT", `/api/sessions/${race}/laps/2`, {
        ...lap(85_000, [27_000, 29_000, 29_000]),
        valid: false,
      });
      const summary = await driver.json<{
        bests: { timeMs: number; bestSectorsMs: number[] }[];
      }>("GET", "/api/profile");
      expect(summary.bests[0]?.timeMs).toBe(92_000);
      expect(summary.bests[0]?.bestSectorsMs).toEqual([31_000, 31_000, 30_000]);
      const { session } = await driver.json<{
        session: { lapTimes: { lap: number; valid: boolean }[] };
      }>("GET", `/api/profile/sessions/${race}`);
      expect(session.lapTimes).toEqual([
        expect.objectContaining({ lap: 1, valid: true }),
        expect.objectContaining({ lap: 2, valid: false }),
      ]);
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
        "other-car",
        "revracer-26",
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
  const directory = mkdtempSync(path.join(tmpdir(), "revracers-api-"));

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test("keeps data across restarts and migrating twice changes nothing", async () => {
    const dataDir = path.join(directory, "not", "created", "yet");
    const first = embeddedDb(dataDir);
    await migrate(first);
    const key = newKey();
    const join = (db: Db) =>
      createApi(db).request("/api/players", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
    const created = await join(first);
    expect(created.status).toBe(200);
    const { driver } = (await created.json()) as { driver: { id: string } };
    await first.close();

    const second = embeddedDb(dataDir);
    await migrate(second);
    const again = (await (await join(second)).json()) as {
      driver: { id: string };
    };
    expect(again.driver.id).toBe(driver.id);
    const rows = await second.query("SELECT id FROM drivers");
    expect(rows).toHaveLength(1);
    await second.close();
  });
});
