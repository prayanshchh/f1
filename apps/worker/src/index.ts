import { DurableObject } from "cloudflare:workers";
import { createApi } from "../../api/src/app.ts";
import { padApp } from "../../api/src/pad.ts";
import { PadRooms } from "../../api/src/pad-rooms.ts";
import { migrate, serverDb } from "../../api/src/server-db.ts";

interface Env {
  BIG_FILES: R2Bucket;
  PAD_ROOMS: DurableObjectNamespace<PadRoom>;
  HYPERDRIVE: Hyperdrive;
}

const padPath = /^\/api\/pad\/([A-Za-z0-9_-]{22})\//;
const padWait = 20_000;
const immutable = "public, max-age=31536000, immutable";
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

async function bigFile(pathname: string, env: Env): Promise<Response> {
  const object = await env.BIG_FILES.get(pathname.slice(1));
  if (!object) return new Response("Not found.", { status: 404 });
  const headers = new Headers({ "cache-control": immutable });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const room = padPath.exec(pathname)?.[1];
    if (room)
      return env.PAD_ROOMS.get(env.PAD_ROOMS.idFromName(room)).fetch(request);
    if (pathname.startsWith("/api/")) return api(request, env, ctx);
    return bigFile(pathname, env);
  },
} satisfies ExportedHandler<Env>;
