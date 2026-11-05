import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { type Db, migrate, serverDb } from "./server-db.ts";

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lock(directory: string): () => void {
  const file = `${directory}.lock`;
  for (;;) {
    try {
      const handle = openSync(file, "wx");
      writeSync(handle, String(process.pid));
      closeSync(handle);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = Number(readFileSync(file, "utf8"));
      if (!(holder > 0) || running(holder)) {
        throw new Error(
          `${directory} is in use by process ${String(holder)}. Stop it first, or delete ${file} if that process is not a RevRacers server.`,
          { cause: error },
        );
      }
      unlinkSync(file);
    }
  }
  const release = () => {
    try {
      if (Number(readFileSync(file, "utf8")) === process.pid) unlinkSync(file);
    } catch {
      return;
    }
  };
  process.once("exit", release);
  return () => {
    process.off("exit", release);
    release();
  };
}

export function embeddedDb(directory?: string): Db {
  if (directory) mkdirSync(directory, { recursive: true });
  const unlock = directory ? lock(directory) : () => undefined;
  const client = new PGlite(directory);
  return {
    async query<Row>(text: string, params: unknown[] = []) {
      return (await client.query<Row>(text, params)).rows;
    },
    async exec(text) {
      await client.exec(text);
    },
    async close() {
      await client.close();
      unlock();
    },
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
