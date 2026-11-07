import { DurableObject } from "cloudflare:workers";
import { createApi } from "../../api/src/app.ts";
import { padApp } from "../../api/src/pad.ts";
import { PadRooms } from "../../api/src/pad-rooms.ts";
import { migrate, serverDb } from "../../api/src/server-db.ts";
import { type FileEnv, serveFile } from "./files.ts";

interface Env extends FileEnv {
  PAD_ROOMS: DurableObjectNamespace<PadRoom>;
  HYPERDRIVE: Hyperdrive;
}

const padPath = /^\/api\/pad\/([A-Za-z0-9_-]{22})\//;
const padWait = 20_000;
let migrated = false;

export class PadRoom extends DurableObject<Env> {
  private readonly app = padApp(
    new PadRooms({ firstSeq: Date.now() }),
    padWait,
  );

  override async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }
}

async function api(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const db = serverDb(env.HYPERDRIVE.connectionString);
  try {
    if (!migrated) {
      await migrate(db);
      migrated = true;
    }
    return await createApi(db).fetch(request);
  } finally {
    ctx.waitUntil(db.close());
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const room = padPath.exec(pathname)?.[1];
    if (room)
      return env.PAD_ROOMS.get(env.PAD_ROOMS.idFromName(room)).fetch(request);
    if (pathname.startsWith("/api/")) return api(request, env, ctx);
    return serveFile(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
