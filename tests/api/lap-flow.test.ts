import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createApi,
  type Db,
  embeddedDb,
  migrate,
} from "../../apps/api/src/index.ts";
import { LapTrace } from "../../apps/client/src/game/laptrace.ts";
import {
  decodeTrace,
  type Deliver,
  Outbox,
  RaceLog,
} from "../../apps/client/src/game/race-log.ts";

const length = 5478;
const boundaries = [1577, 3769];
const sectorSpeeds = [60, 70, 55];

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function driveLap(trace: LapTrace, lap: number, pace: number) {
  let clock = 0;
  for (let distance = 0; distance < length; distance += 8) {
    trace.sample(lap, distance, clock, 0);
    const sector = boundaries.filter((b) => distance >= b).length;
    clock += 8 / ((sectorSpeeds[sector] ?? 60) * pace);
  }
  const lapTime = clock;
  return trace.sample(lap + 1, 0, 0, lapTime);
}

describe("a lap from the game reaches the database and comes back as a delta", () => {
  let db: Db;
  let app: ReturnType<typeof createApi>;
  const authorization = `Bearer ${randomBytes(32).toString("base64url")}`;

  beforeAll(async () => {
    db = embeddedDb();
    await migrate(db);
    app = createApi(db);
    const joined = await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: authorization.slice("Bearer ".length) }),
    });
    expect(joined.status).toBe(200);
  });

  afterAll(() => db.close());

  const deliver: Deliver = async (call) => {
    const response = await app.request(call.path, {
      method: call.method,
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(call.body),
    });
    if (response.ok) return "done";
    throw new Error(`${call.path}: ${await response.text()}`);
  };

  const read = async <T>(path: string): Promise<T> => {
    const response = await app.request(path, { headers: { authorization } });
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  };

  test("second session starts with the stored best and shows real sector gaps", async () => {
    const race = {
      id: crypto.randomUUID(),
      track: "hill-country",
      car: "revracer-26",
      team: "corvus",
      kind: "race" as const,
      plannedLaps: 2,
      conditions: { rain: "none" },
      startedAt: new Date().toISOString(),
    };
    const outbox = new Outbox("k", memoryStore(), deliver);
    const log = new RaceLog(outbox, race);
    const first = new LapTrace(length, boundaries);
    const lap1 = driveLap(first, 1, 1);
    expect(lap1).not.toBeNull();
    if (!lap1) return;
    log.lap(lap1, "medium");
    const lap2 = driveLap(first, 2, 1.02);
    expect(lap2).not.toBeNull();
    if (!lap2) return;
    log.lap(lap2, "medium");
    const best = first.reference;
    expect(best).not.toBeNull();
    if (!best) return;
    log.personalBest(best);
    log.finish();
    await outbox.flush();
    expect(outbox.pending).toBe(0);

    const { session } = await read<{
      session: {
        finished: boolean;
        lapTimes: { timeMs: number; sectorsMs: (number | null)[] }[];
      };
    }>(`/api/profile/sessions/${race.id}`);
    expect(session.finished).toBe(true);
    expect(session.lapTimes).toHaveLength(2);
    for (const stored of session.lapTimes) {
      const sum = stored.sectorsMs.reduce<number>(
        (total, ms) => total + (ms ?? 0),
        0,
      );
      expect(Math.abs(sum - stored.timeMs)).toBeLessThanOrEqual(2);
      expect(stored.sectorsMs).not.toContain(null);
    }

    const { reference } = await read<{
      reference: {
        timeMs: number;
        sectorsMs: number[];
        bestSectorsMs: number[];
        trace: string;
      };
    }>(`/api/references/${race.track}/${race.car}`);
    expect(reference.timeMs).toBe(session.lapTimes[1]?.timeMs);

    const second = new LapTrace(length, boundaries, {
      trace: decodeTrace(reference.trace),
      sectors: reference.sectorsMs.map((ms) => ms / 1000),
      fastestSectors: reference.bestSectorsMs.map((ms) => ms / 1000),
    });
    expect(second.bestTime).toBeCloseTo(reference.timeMs / 1000, 2);

    let clock = 0;
    for (let distance = 0; distance < 2000; distance += 8) {
      second.sample(1, distance, clock, 0);
      const sector = boundaries.filter((b) => distance >= b).length;
      clock += 8 / ((sectorSpeeds[sector] ?? 60) * 0.99);
    }
    const state = second.sectors(1999);
    const fasterLapS1 = reference.sectorsMs[0] ?? 0;
    expect(state.deltas[0]).toBeGreaterThan(0);
    expect(state.deltas[0]).toBeCloseTo(
      (state.times[0] ?? 0) - fasterLapS1 / 1000,
      3,
    );
    expect(state.status[0]).toBe("slower");
    const delta = second.delta(1990, clock);
    expect(delta).not.toBeNull();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(2);
  });
});
