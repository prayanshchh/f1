import type { Db } from "./server-db.ts";
import type {
  LapBody,
  Profile,
  ReferenceBody,
  SessionBody,
} from "./validate.ts";

export interface Driver {
  id: string;
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  number: number | null;
  team: string | null;
  onboarded: boolean;
}

interface DriverRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  nationality: string | null;
  number: number | null;
  team: string | null;
  onboarded_at: Date | string | null;
}

const driverColumns =
  "id, first_name, last_name, nationality, number, team, onboarded_at";

function toDriver(row: DriverRow): Driver {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    nationality: row.nationality,
    number: row.number,
    team: row.team,
    onboarded: row.onboarded_at !== null,
  };
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export async function driverForKey(
  db: Db,
  hash: string,
): Promise<Driver | null> {
  const [row] = await db.query<DriverRow>(
    `SELECT ${driverColumns} FROM drivers WHERE key_hash = $1`,
    [hash],
  );
  return row ? toDriver(row) : null;
}

export async function joinPlayer(db: Db, hash: string): Promise<Driver> {
  await db.query(
    "INSERT INTO drivers (key_hash) VALUES ($1) ON CONFLICT (key_hash) DO NOTHING",
    [hash],
  );
  const driver = await driverForKey(db, hash);
  if (!driver) throw new Error("player was not created");
  return driver;
}

export async function updateProfile(
  db: Db,
  id: string,
  profile: Profile,
): Promise<Driver> {
  const [row] = await db.query<DriverRow>(
    `UPDATE drivers SET first_name = $2, last_name = $3, nationality = $4,
       number = $5, team = $6, onboarded_at = COALESCE(onboarded_at, now())
     WHERE id = $1 RETURNING ${driverColumns}`,
    [
      id,
      profile.firstName,
      profile.lastName,
      profile.nationality,
      profile.number,
      profile.team,
    ],
  );
  if (!row) throw new Error("driver is gone");
  return toDriver(row);
}

export async function createSession(
  db: Db,
  id: string,
  driverId: string,
  session: SessionBody,
): Promise<boolean> {
  await db.query(
    `INSERT INTO sessions (id, driver_id, track, car, team, kind, planned_laps,
       conditions, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      driverId,
      session.track,
      session.car,
      session.team,
      session.kind,
      session.plannedLaps,
      JSON.stringify(session.conditions),
      session.startedAt,
    ],
  );
  return ownsSession(db, id, driverId);
}

async function ownsSession(
  db: Db,
  id: string,
  driverId: string,
): Promise<boolean> {
  const rows = await db.query(
    "SELECT 1 FROM sessions WHERE id = $1 AND driver_id = $2",
    [id, driverId],
  );
  return rows.length > 0;
}

export async function addLap(
  db: Db,
  sessionId: string,
  driverId: string,
  lap: number,
  body: LapBody,
): Promise<boolean> {
  if (!(await ownsSession(db, sessionId, driverId))) return false;
  await db.query(
    `INSERT INTO laps (session_id, lap, driver_id, track, car, time_ms,
       sector_ms, compound, valid)
     SELECT id, $3, driver_id, track, car, $4, $5::integer[], $6, $7
     FROM sessions WHERE id = $1 AND driver_id = $2
     ON CONFLICT (session_id, lap) DO NOTHING`,
    [
      sessionId,
      driverId,
      lap,
      body.timeMs,
      body.sectorsMs,
      body.compound,
      body.valid,
    ],
  );
  return true;
}

export async function finishSession(
  db: Db,
  sessionId: string,
  driverId: string,
): Promise<boolean> {
  const rows = await db.query(
    `UPDATE sessions SET finished_at = COALESCE(finished_at, now())
     WHERE id = $1 AND driver_id = $2 RETURNING id`,
    [sessionId, driverId],
  );
  return rows.length > 0;
}

export async function saveReference(
  db: Db,
  driverId: string,
  track: string,
  car: string,
  body: ReferenceBody,
): Promise<boolean> {
  const rows = await db.query(
    `INSERT INTO lap_references (driver_id, track, car, time_ms, sector_ms, trace)
     VALUES ($1, $2, $3, $4, $5::integer[], decode($6, 'base64'))
     ON CONFLICT (driver_id, track, car) DO UPDATE SET
       time_ms = EXCLUDED.time_ms,
       sector_ms = EXCLUDED.sector_ms,
       trace = EXCLUDED.trace,
       updated_at = now()
     WHERE EXCLUDED.time_ms < lap_references.time_ms
     RETURNING time_ms`,
    [driverId, track, car, body.timeMs, body.sectorsMs, body.trace],
  );
  return rows.length > 0;
}

interface BestSectorRow {
  track: string;
  car: string;
  position: number;
  best: number;
}

async function bestSectors(
  db: Db,
  driverId: string,
  track?: string,
  car?: string,
): Promise<BestSectorRow[]> {
  return db.query<BestSectorRow>(
    `SELECT l.track, l.car, u.position::int AS position, min(u.value)::int AS best
     FROM laps l, unnest(l.sector_ms) WITH ORDINALITY AS u(value, position)
     WHERE l.driver_id = $1 AND l.valid
       AND ($2::text IS NULL OR l.track = $2)
       AND ($3::text IS NULL OR l.car = $3)
     GROUP BY l.track, l.car, u.position
     ORDER BY u.position`,
    [driverId, track ?? null, car ?? null],
  );
}

export interface Reference {
  timeMs: number;
  sectorsMs: number[];
  bestSectorsMs: number[];
  trace: string;
}

export async function loadReference(
  db: Db,
  driverId: string,
  track: string,
  car: string,
): Promise<Reference | null> {
  const [row] = await db.query<{
    time_ms: number;
    sector_ms: number[];
    trace: string;
  }>(
    `SELECT time_ms, sector_ms, encode(trace, 'base64') AS trace
     FROM lap_references WHERE driver_id = $1 AND track = $2 AND car = $3`,
    [driverId, track, car],
  );
  if (!row) return null;
  const best = await bestSectors(db, driverId, track, car);
  return {
    timeMs: row.time_ms,
    sectorsMs: row.sector_ms,
    bestSectorsMs: row.sector_ms.map((own, index) =>
      Math.min(own, best[index]?.best ?? own),
    ),
    trace: row.trace.replaceAll("\n", ""),
  };
}

export interface ProfileSummary {
  totals: { sessions: number; races: number; laps: number; timeMs: number };
  bests: {
    track: string;
    car: string;
    team: string;
    timeMs: number;
    sectorsMs: (number | null)[];
    bestSectorsMs: number[];
    setAt: string;
  }[];
}

export async function profileSummary(
  db: Db,
  driverId: string,
): Promise<ProfileSummary> {
  const [totals] = await db.query<{
    sessions: number;
    races: number;
    laps: number;
    time_ms: number;
  }>(
    `SELECT count(DISTINCT s.id)::int AS sessions,
       count(DISTINCT s.id) FILTER (WHERE s.kind = 'race')::int AS races,
       count(*)::int AS laps,
       COALESCE(sum(l.time_ms), 0)::float8 AS time_ms
     FROM laps l JOIN sessions s ON s.id = l.session_id
     WHERE l.driver_id = $1`,
    [driverId],
  );
  const bests = await db.query<{
    track: string;
    car: string;
    team: string;
    time_ms: number;
    sector_ms: (number | null)[];
    set_at: Date | string;
  }>(
    `SELECT DISTINCT ON (l.track, l.car) l.track, l.car, s.team, l.time_ms,
       l.sector_ms, l.set_at
     FROM laps l JOIN sessions s ON s.id = l.session_id
     WHERE l.driver_id = $1 AND l.valid
     ORDER BY l.track, l.car, l.time_ms, l.set_at`,
    [driverId],
  );
  const sectors = await bestSectors(db, driverId);
  return {
    totals: {
      sessions: totals?.sessions ?? 0,
      races: totals?.races ?? 0,
      laps: totals?.laps ?? 0,
      timeMs: totals?.time_ms ?? 0,
    },
    bests: bests.map((row) => ({
      track: row.track,
      car: row.car,
      team: row.team,
      timeMs: row.time_ms,
      sectorsMs: row.sector_ms,
      bestSectorsMs: sectors
        .filter((s) => s.track === row.track && s.car === row.car)
        .map((s) => s.best),
      setAt: iso(row.set_at),
    })),
  };
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

interface SessionRow {
  id: string;
  kind: "practice" | "race";
  track: string;
  team: string;
  planned_laps: number | null;
  conditions: Record<string, unknown>;
  started_at: Date | string;
  finished_at: Date | string | null;
  laps: number;
  best_ms: number;
  total_ms: number;
}

function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    kind: row.kind,
    track: row.track,
    team: row.team,
    plannedLaps: row.planned_laps,
    conditions: row.conditions,
    startedAt: iso(row.started_at),
    finished: row.finished_at !== null,
    laps: row.laps,
    bestMs: row.best_ms,
    totalMs: row.total_ms,
  };
}

const sessionSelect = `SELECT s.id, s.kind, s.track, s.team, s.planned_laps,
    s.conditions, s.started_at, s.finished_at, count(l.lap)::int AS laps,
    min(l.time_ms)::int AS best_ms, sum(l.time_ms)::float8 AS total_ms
  FROM sessions s JOIN laps l ON l.session_id = s.id`;

export async function listSessions(
  db: Db,
  driverId: string,
  before: string | null,
  limit: number,
): Promise<{ sessions: SessionSummary[]; next: string | null }> {
  const rows = await db.query<SessionRow>(
    `${sessionSelect}
     WHERE s.driver_id = $1 AND ($2::timestamptz IS NULL OR s.started_at < $2)
     GROUP BY s.id ORDER BY s.started_at DESC LIMIT $3`,
    [driverId, before, limit + 1],
  );
  const page = rows.slice(0, limit).map(toSummary);
  return {
    sessions: page,
    next: rows.length > limit ? (page.at(-1)?.startedAt ?? null) : null,
  };
}

export interface SessionDetail extends SessionSummary {
  lapTimes: {
    lap: number;
    timeMs: number;
    sectorsMs: (number | null)[];
    compound: string | null;
  }[];
}

export async function sessionDetail(
  db: Db,
  driverId: string,
  id: string,
): Promise<SessionDetail | null> {
  const [row] = await db.query<SessionRow>(
    `${sessionSelect} WHERE s.driver_id = $1 AND s.id = $2 GROUP BY s.id`,
    [driverId, id],
  );
  if (!row) return null;
  const laps = await db.query<{
    lap: number;
    time_ms: number;
    sector_ms: (number | null)[];
    compound: string | null;
    valid: boolean;
  }>(
    `SELECT lap, time_ms, sector_ms, compound, valid FROM laps
     WHERE session_id = $1 ORDER BY lap`,
    [id],
  );
  return {
    ...toSummary(row),
    lapTimes: laps.map((lap) => ({
      lap: lap.lap,
      timeMs: lap.time_ms,
      sectorsMs: lap.sector_ms,
      compound: lap.compound,
      valid: lap.valid,
    })),
  };
}
