import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { type Db, migrate, serverDb } from "./server-db.ts";

export function embeddedDb(directory?: string): Db {
  if (directory) mkdirSync(directory, { recursive: true });
  const client = new PGlite(directory);
  return {
    async query<Row>(text: string, params: unknown[] = []) {
      return (await client.query<Row>(text, params)).rows;
    },
    async exec(text) {
      await client.exec(text);
    },
    close: () => client.close(),
  };
}

export async function openDatabase(
  connectionString: string | undefined,
  directory: string,
): Promise<Db> {
  const db = connectionString
    ? serverDb(connectionString)
    : embeddedDb(directory);
  await migrate(db);
  return db;
}
