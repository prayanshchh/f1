import { createReadStream, readFileSync, statSync } from "node:fs";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  createApi,
  dummyPasswordHash,
  embeddedDb,
} from "../../../apps/api/src/index.ts";

const root = fileURLToPath(
  new URL("../../../apps/client/dist", import.meta.url),
);
const harness = process.env["HARNESS_ROOT"] ?? "";
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
};

const api = createApi(embeddedDb(), {
  secureCookies: true,
  dummyPasswordHash: await dummyPasswordHash(),
});

async function callApi(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const closed = new AbortController();
  response.on("close", () => {
    closed.abort();
  });
  const bodyless = request.method === "GET" || request.method === "HEAD";
  const reply = await api.fetch(
    new Request(`https://site${request.url ?? "/"}`, {
      method: request.method ?? "GET",
      headers: Object.entries(request.headers).flatMap(
        ([name, value]): [string, string][] =>
          typeof value === "string" ? [[name, value]] : [],
      ),
      signal: closed.signal,
      ...(bodyless
        ? {}
        : { body: Readable.toWeb(request) as ReadableStream, duplex: "half" }),
    }),
  );
  const headers: Record<string, string> = { ...isolation };
  reply.headers.forEach((value, name) => {
    headers[name] = value;
  });
  response.writeHead(reply.status, headers);
  response.end(Buffer.from(await reply.arrayBuffer()));
}

function serveFile(request: IncomingMessage, response: ServerResponse): void {
  const pathname = decodeURIComponent(
    new URL(request.url ?? "/", "https://site").pathname,
  );
  const base = pathname.startsWith("/harness/") ? harness : root;
  const local = pathname.startsWith("/harness/")
    ? pathname.slice("/harness".length)
    : pathname;
  const file = path.join(base, local === "/" ? "index.html" : local);
  const found =
    base !== "" &&
    file.startsWith(base) &&
    statSync(file, { throwIfNoEntry: false });
  if (!found || !found.isFile()) {
    response.writeHead(404, isolation).end();
    return;
  }
  response.writeHead(200, {
    ...isolation,
    "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": found.size,
  });
  createReadStream(file).pipe(response);
}

https
  .createServer(
    {
      key: readFileSync(process.env["SITE_KEY"] ?? ""),
      cert: readFileSync(process.env["SITE_CERT"] ?? ""),
    },
    (request, response) => {
      if (request.url?.startsWith("/api/"))
        void callApi(request, response).catch(() => {
          response.writeHead(500).end();
        });
      else serveFile(request, response);
    },
  )
  .listen(Number(process.env["SITE_PORT"] ?? 8443), "0.0.0.0");
