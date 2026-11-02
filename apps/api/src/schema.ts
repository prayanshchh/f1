export const migrations = [
  `
  CREATE TABLE IF NOT EXISTS drivers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL,
    username_key text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    first_name text,
    last_name text,
    nationality text,
    number integer CHECK (number BETWEEN 1 AND 99),
    team text,
    failed_logins integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    onboarded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash text PRIMARY KEY,
    driver_id uuid NOT NULL REFERENCES drivers ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_tokens_driver ON auth_tokens (driver_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY,
    driver_id uuid NOT NULL REFERENCES drivers ON DELETE CASCADE,
    track text NOT NULL,
    car text NOT NULL,
    team text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('practice', 'race')),
    planned_laps integer,
    conditions jsonb NOT NULL DEFAULT '{}',
    started_at timestamptz NOT NULL,
    finished_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS sessions_driver_started
    ON sessions (driver_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS laps (
    session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
    lap integer NOT NULL CHECK (lap > 0),
    driver_id uuid NOT NULL REFERENCES drivers ON DELETE CASCADE,
    track text NOT NULL,
    car text NOT NULL,
    time_ms integer NOT NULL CHECK (time_ms > 0),
    sector_ms integer[] NOT NULL,
    compound text,
    set_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, lap)
  );
  CREATE INDEX IF NOT EXISTS laps_driver_best
    ON laps (driver_id, track, car, time_ms);

  CREATE TABLE IF NOT EXISTS lap_references (
    driver_id uuid NOT NULL REFERENCES drivers ON DELETE CASCADE,
    track text NOT NULL,
    car text NOT NULL,
    time_ms integer NOT NULL CHECK (time_ms > 0),
    sector_ms integer[] NOT NULL,
    trace bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (driver_id, track, car)
  );
  `,
  `
  ALTER TABLE laps ADD COLUMN IF NOT EXISTS valid boolean NOT NULL DEFAULT true;
  `,
];
