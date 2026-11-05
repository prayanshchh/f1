import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import type { Connect, Plugin } from "vite";
import { createApi, type Db, openDatabase } from "../api/src/index.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const shared = globalThis as typeof globalThis & {
  revracersDatabases?: Map<string, Promise<Db>>;
};

function database(): Promise<Db> {
  const connectionString = process.env["DATABASE_URL"];
  const directory =
    process.env["REVRACERS_DATA_DIR"] ?? path.join(repoRoot, ".data/postgres");
  const key = connectionString ?? directory;
  const open = (shared.revracersDatabases ??= new Map());
  let db = open.get(key);
  if (!db) {
    db = openDatabase(connectionString, directory);
    db.catch(() => open.delete(key));
    open.set(key, db);
  }
  return db;
}

async function apiMiddleware(): Promise<Connect.NextHandleFunction> {
  const db = await database();
  const listener = getRequestListener(createApi(db).fetch);
  return (request, response, next) => {
    if (request.url?.startsWith("/api/")) void listener(request, response);
    else next();
  };
}

export function apiServer(): Plugin {
  return {
    name: "revracers-api",
    async configureServer(server) {
      server.middlewares.use(await apiMiddleware());
    },
    async configurePreviewServer(server) {
      server.middlewares.use(await apiMiddleware());
    },
  };
}
