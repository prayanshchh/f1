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

const contentTypes: Record<string, string> = {
  glb: "model/gltf-binary",
  hdr: "image/vnd.radiance",
};

async function streamParts(
  bucket: R2Bucket,
  keys: string[],
  writable: WritableStream,
): Promise<void> {
  try {
    for (const key of keys) {
      const part = await bucket.get(key);
      if (!part) throw new Error(`missing part ${key}`);
      await part.body.pipeTo(writable, { preventClose: true });
    }
    await writable.close();
  } catch (error) {
    await writable.abort(error);
  }
}

async function bigFile(
  pathname: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const key = pathname.slice(1);
  const { objects } = await env.BIG_FILES.list({ prefix: `${key}/` });
  if (objects.length === 0) return new Response("Not found.", { status: 404 });
  const size = objects.reduce((total, part) => total + part.size, 0);
  const { readable, writable } = new FixedLengthStream(size);
  ctx.waitUntil(
    streamParts(
      env.BIG_FILES,
      objects.map((part) => part.key),
      writable,
    ),
  );
  return new Response(readable, {
    headers: {
      "cache-control": immutable,
      "content-type":
        contentTypes[key.split(".").pop() ?? ""] ?? "application/octet-stream",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const room = padPath.exec(pathname)?.[1];
    if (room)
      return env.PAD_ROOMS.get(env.PAD_ROOMS.idFromName(room)).fetch(request);
    if (pathname.startsWith("/api/")) return api(request, env, ctx);
    return bigFile(pathname, env, ctx);
  },
} satisfies ExportedHandler<Env>;
