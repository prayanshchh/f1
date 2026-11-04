import pg from "pg";
import { migrations } from "./schema.ts";

const migrationLock = 727001;

export interface Db {
  query<Row>(text: string, params?: unknown[]): Promise<Row[]>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

export function serverDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return {
    async query<Row>(text: string, params: unknown[] = []) {
      const result = await pool.query(text, params);
      return result.rows as Row[];
    },
    async exec(text) {
      await pool.query(text);
    },
    close: () => pool.end(),
  };
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = await db.query<{ version: number }>(
    "SELECT version FROM schema_migrations",
  );
  const done = new Set(applied.map((row) => row.version));
  for (const [index, sql] of migrations.entries()) {
    if (done.has(index)) continue;
    await db.exec(`BEGIN;
      SELECT pg_advisory_xact_lock(${String(migrationLock)});
      ${sql}
      INSERT INTO schema_migrations (version) VALUES (${String(index)})
        ON CONFLICT DO NOTHING;
      COMMIT;`);
  }
}
