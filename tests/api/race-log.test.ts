import { describe, expect, test, vi } from "vitest";
import {
  decodeTrace,
  encodeTrace,
  type DeliveryResult,
  Outbox,
  type PendingCall,
  RaceLog,
} from "../../apps/client/src/game/race-log.ts";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const call = (path: string, body: unknown = {}): PendingCall => ({
  method: "PUT",
  path,
  body,
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Outbox", () => {
  test("delivers in order, even when added faster than it sends", async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const box = new Outbox("k", memoryStore(), async (item) => {
      seen.push(item.path);
      if (seen.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return "done";
    });
    box.add(call("/a"));
    box.add(call("/b"));
    box.add(call("/c"));
    await settled();
    expect(seen).toEqual(["/a"]);
    release();
    await settled();
    expect(seen).toEqual(["/a", "/b", "/c"]);
    expect(box.pending).toBe(0);
  });

  test("keeps the queue through a reload while the server is down", async () => {
    const store = memoryStore();
    const offline = new Outbox("k", store, () =>
      Promise.reject(new Error("offline")),
    );
    offline.add(call("/session"));
    offline.add(call("/session/laps/1"));
    await settled();
    expect(offline.pending).toBe(2);

    const seen: string[] = [];
    const back = new Outbox("k", store, (item) => {
      seen.push(item.path);
      return Promise.resolve("done");
    });
    await back.flush();
    expect(seen).toEqual(["/session", "/session/laps/1"]);
    expect(back.pending).toBe(0);
    const empty = new Outbox("k", store, () => Promise.resolve("done"));
    expect(empty.pending).toBe(0);
  });

  test("a retry stops the queue so later laps cannot overtake the session", async () => {
    const seen: string[] = [];
    const results: DeliveryResult[] = ["retry", "done", "done"];
    const box = new Outbox("k", memoryStore(), (item) => {
      seen.push(item.path);
      return Promise.resolve(results.shift() ?? "done");
    });
    box.add(call("/session"));
    box.add(call("/session/laps/1"));
    await settled();
    expect(seen).toEqual(["/session"]);
    await box.flush();
    expect(seen).toEqual(["/session", "/session", "/session/laps/1"]);
  });

  test("a rejected call is dropped so it cannot block the queue forever", async () => {
    const seen: string[] = [];
    const box = new Outbox("k", memoryStore(), (item) => {
      seen.push(item.path);
      return Promise.resolve(item.path === "/bad" ? "drop" : "done");
    });
    box.add(call("/bad"));
    box.add(call("/good"));
    await settled();
    expect(seen).toEqual(["/bad", "/good"]);
    expect(box.pending).toBe(0);
  });

  test("a newer call to the same address replaces the waiting one", async () => {
    const bodies: unknown[] = [];
    const results: DeliveryResult[] = ["retry"];
    const box = new Outbox("k", memoryStore(), (item) => {
      bodies.push(item.body);
      return Promise.resolve(results.shift() ?? "done");
    });
    box.add(call("/first"));
    await settled();
    box.add(call("/reference", { timeMs: 95000 }));
    box.add(call("/reference", { timeMs: 90000 }));
    await box.flush();
    expect(bodies.at(-1)).toEqual({ timeMs: 90000 });
    expect(box.pending).toBe(0);
  });

  test("survives corrupt storage and a full disk", async () => {
    const store = memoryStore();
    store.setItem("k", "{not json");
    const setItem = vi.fn(() => {
      throw new Error("quota");
    });
    const box = new Outbox("k", { getItem: store.getItem, setItem }, () =>
      Promise.resolve("done"),
    );
    expect(box.pending).toBe(0);
    box.add(call("/a"));
    await settled();
    expect(box.pending).toBe(0);
  });
});

describe("RaceLog", () => {
  const race = {
    id: "11111111-1111-4111-8111-111111111111",
    track: "hill-country",
    car: "revracer-26",
    team: "velza",
    kind: "race" as const,
    plannedLaps: 5,
    conditions: {},
    startedAt: "2026-11-01T10:00:00.000Z",
  };
  const recording = () => {
    const calls: PendingCall[] = [];
    const box = new Outbox("k", memoryStore(), (item) => {
      calls.push(item);
      return Promise.resolve("done");
    });
    return { calls, log: new RaceLog(box, race) };
  };
  const lap = {
    lap: 1,
    time: 92.1234,
    sectors: [30.0004, 31.5, 30.623],
    best: true,
    delta: null,
    valid: true,
  };

  test("a session with no laps writes nothing", async () => {
    const { calls, log } = recording();
    log.finish();
    await settled();
    expect(calls).toEqual([]);
  });

  test("the session is created once, before its first lap", async () => {
    const { calls, log } = recording();
    log.lap(lap, "soft");
    log.lap({ ...lap, lap: 2 }, "soft");
    await settled();
    expect(calls.map((item) => item.path)).toEqual([
      `/api/sessions/${race.id}`,
      `/api/sessions/${race.id}/laps/1`,
      `/api/sessions/${race.id}/laps/2`,
    ]);
    expect(calls[0]?.body).not.toHaveProperty("id");
  });

  test("times become whole milliseconds and a missed sector becomes null", async () => {
    const { calls, log } = recording();
    log.lap({ ...lap, sectors: [30.0004, 0, 30.623] }, "soft");
    await settled();
    expect(calls[1]?.body).toEqual({
      timeMs: 92123,
      sectorsMs: [30000, null, 30623],
      compound: "soft",
      valid: true,
    });
  });

  test("a personal best sends its sectors and an exact sum", async () => {
    const { calls, log } = recording();
    log.personalBest({ trace: [0, 1, 2], sectors: [30.0004, 31.5, 30.623] });
    await settled();
    expect(calls[0]?.path).toBe(`/api/references/${race.track}/${race.car}`);
    expect(calls[0]?.body).toMatchObject({
      timeMs: 92123,
      sectorsMs: [30000, 31500, 30623],
    });
  });
});

describe("trace encoding", () => {
  test("round trips times and keeps gaps in the lap as NaN", () => {
    const trace = [0, 12.5, Number.NaN, 90.25];
    const decoded = decodeTrace(encodeTrace(trace));
    expect(decoded[0]).toBe(0);
    expect(decoded[1]).toBeCloseTo(12.5, 3);
    expect(Number.isNaN(decoded[2])).toBe(true);
    expect(decoded[3]).toBeCloseTo(90.25, 3);
  });

  test("handles a full lap of the circuit, one sample per metre", () => {
    const trace = Array.from({ length: 5479 }, (_, i) => i * 0.0165);
    const decoded = decodeTrace(encodeTrace(trace));
    expect(decoded).toHaveLength(5479);
    expect(decoded[5478]).toBeCloseTo(90.39, 2);
  });
});
