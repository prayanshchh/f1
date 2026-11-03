import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import type { Connect, Plugin } from "vite";
import { createApi, openDatabase } from "../api/src/index.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

async function apiMiddleware(): Promise<Connect.NextHandleFunction> {
  const db = await openDatabase(
    process.env["DATABASE_URL"],
    process.env["REVRACERS_DATA_DIR"] ?? path.join(repoRoot, ".data/postgres"),
  );
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
