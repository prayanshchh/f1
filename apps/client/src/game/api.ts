import { type Deliver, Outbox } from "./race-log.ts";

export interface Driver {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  number: number | null;
  team: string | null;
  onboarded: boolean;
}

export interface DriverProfile {
  firstName: string;
  lastName: string;
  nationality: string;
  number: number;
  team: string;
}

export interface ServerReference {
  timeMs: number;
  sectorsMs: number[];
  bestSectorsMs: number[];
  trace: string;
}

export interface PersonalBest {
  track: string;
  car: string;
  team: string;
  timeMs: number;
  sectorsMs: (number | null)[];
  bestSectorsMs: number[];
  setAt: string;
}

export interface ProfileSummary {
  totals: { sessions: number; races: number; laps: number; timeMs: number };
  bests: PersonalBest[];
}

export interface SessionSummary {
  id: string;
  kind: "practice" | "race";
  track: string;
  team: string;
  plannedLaps: number | null;
  conditions: Record<string, unknown>;
  startedAt: string;
  finished: boolean;
  laps: number;
  bestMs: number;
  totalMs: number;
}

export interface LapRow {
  lap: number;
  timeMs: number;
  sectorsMs: (number | null)[];
  compound: string | null;
  valid: boolean;
}

export interface SessionDetail extends SessionSummary {
  lapTimes: LapRow[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field: string | null,
  ) {
    super(message);
  }
}

const unreachable = "The server could not be reached.";
const requestTimeoutMs = 10_000;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const signal = AbortSignal.timeout(requestTimeoutMs);
  const init: RequestInit =
    body === undefined
      ? { method, signal }
      : {
          method,
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        };
  const response = await fetch(path, init);
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: string; field?: string }) | null;
  if (!response.ok || payload === null)
    throw new ApiError(
      payload?.error ?? unreachable,
      response.status,
      payload?.field ?? null,
    );
  return payload;
}

export const api = {
  async me(): Promise<Driver | null> {
    try {
      return (await request<{ driver: Driver }>("GET", "/api/me")).driver;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  async register(username: string, password: string): Promise<Driver> {
    return (
      await request<{ driver: Driver }>("POST", "/api/auth/register", {
        username,
        password,
      })
    ).driver;
  },
  async login(username: string, password: string): Promise<Driver> {
    return (
      await request<{ driver: Driver }>("POST", "/api/auth/login", {
        username,
        password,
      })
    ).driver;
  },
  async logout(): Promise<void> {
    await request("POST", "/api/auth/logout", {});
  },
  async saveProfile(profile: DriverProfile): Promise<Driver> {
    return (await request<{ driver: Driver }>("PUT", "/api/me", profile))
      .driver;
  },
  async reference(track: string, car: string): Promise<ServerReference | null> {
    return (
      await request<{ reference: ServerReference | null }>(
        "GET",
        `/api/references/${track}/${car}`,
      )
    ).reference;
  },
  profile(): Promise<ProfileSummary> {
    return request("GET", "/api/profile");
  },
  sessions(
    before: string | null,
  ): Promise<{ sessions: SessionSummary[]; next: string | null }> {
    const query = before ? `?before=${encodeURIComponent(before)}` : "";
    return request("GET", `/api/profile/sessions${query}`);
  },
  async session(id: string): Promise<SessionDetail> {
    return (
      await request<{ session: SessionDetail }>(
        "GET",
        `/api/profile/sessions/${id}`,
      )
    ).session;
  },
};

const deliver: Deliver = async (call) => {
  const response = await fetch(call.path, {
    method: call.method,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(call.body),
  });
  if (response.ok) return "done";
  return response.status >= 500 || response.status === 401 ? "retry" : "drop";
};

const retrySeconds = 30;

const driverKey = "f1.driver";

function cachedDriver(): Driver | null {
  try {
    return JSON.parse(
      localStorage.getItem(driverKey) ?? "null",
    ) as Driver | null;
  } catch {
    return null;
  }
}

export function rememberDriver(driver: Driver | null): void {
  if (driver) localStorage.setItem(driverKey, JSON.stringify(driver));
  else localStorage.removeItem(driverKey);
}

export async function currentDriver(): Promise<Driver | null> {
  try {
    const driver = await api.me();
    rememberDriver(driver);
    return driver;
  } catch {
    return cachedDriver();
  }
}

export function driverOutbox(driverId: string): Outbox {
  const outbox = new Outbox(`f1.outbox.${driverId}`, localStorage, deliver);
  window.addEventListener("online", () => {
    void outbox.flush();
  });
  window.setInterval(() => {
    void outbox.flush();
  }, retrySeconds * 1000);
  void outbox.flush();
  return outbox;
}
