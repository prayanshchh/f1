export interface FileEnv {
  ASSETS: Fetcher;
  BIG_FILES: R2Bucket;
}

const immutable = "public, max-age=31536000, immutable";
const compressible = /^\/assets\/[^/]+\.(?:glb|hdr|bin)$/;
const contentTypes: Record<string, string> = {
  glb: "model/gltf-binary",
  hdr: "image/vnd.radiance",
  bin: "application/octet-stream",
};

function contentType(pathname: string): string {
  return (
    contentTypes[pathname.split(".").pop() ?? ""] ?? "application/octet-stream"
  );
}

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
  env: FileEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const key = pathname.slice(1);
  const { objects } = await env.BIG_FILES.list({ prefix: `${key}/` });
  if (objects.length === 0) return null;
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
      "content-type": contentType(pathname),
    },
  });
}

async function staticFile(
  pathname: string,
  request: Request,
  env: FileEnv,
): Promise<Response | null> {
  const response = await env.ASSETS.fetch(
    new Request(new URL(pathname, request.url), { method: request.method }),
  );
  if (response.ok) return response;
  await response.body?.cancel();
  return null;
}

async function storedFile(
  pathname: string,
  request: Request,
  env: FileEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  return (
    (await staticFile(pathname, request, env)) ?? bigFile(pathname, env, ctx)
  );
}

function variant(
  response: Response,
  pathname: string,
  brotli: boolean,
): Response {
  const headers = new Headers(response.headers);
  headers.set("content-type", contentType(pathname));
  headers.set("cache-control", immutable);
  headers.set("vary", "accept-encoding");
  if (brotli) headers.set("content-encoding", "br");
  return new Response(response.body, {
    status: 200,
    headers,
    encodeBody: brotli ? "manual" : "automatic",
  });
}

const notFound = (): Response => new Response("Not found.", { status: 404 });

export async function serveFile(
  request: Request,
  env: FileEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!compressible.test(pathname))
    return (await bigFile(pathname, env, ctx)) ?? notFound();
  const packed = await storedFile(`${pathname}.br`, request, env, ctx);
  if (packed) return variant(packed, pathname, true);
  const plain = await storedFile(pathname, request, env, ctx);
  return plain ? variant(plain, pathname, false) : notFound();
}
