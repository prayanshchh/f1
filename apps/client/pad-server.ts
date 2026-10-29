import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { Plugin, ViteDevServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";

const padPort = 5200;
const setupPort = 5201;
const certDir = path.join(os.homedir(), ".f1-pad");
const socketPath = "/__pad/ws";

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (info) => info !== undefined && info.family === "IPv4" && !info.internal,
    )
    .map((info) => info?.address ?? "");
}

function localHostName(): string {
  try {
    return `${execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim()}.local`;
  } catch {
    return `${os.hostname()}.local`;
  }
}

function openssl(args: string[]): void {
  execFileSync("openssl", args, { cwd: certDir, stdio: "ignore" });
}

function ensureCertificates(names: string[]): {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
} {
  mkdirSync(certDir, { recursive: true });
  if (!existsSync(path.join(certDir, "ca.crt"))) {
    openssl([
      "req",
      "-x509",
      "-new",
      "-nodes",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-days",
      "3650",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-subj",
      "/CN=F1 Pad Local CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ]);
  }
  const wanted = names.join(",");
  const namesFile = path.join(certDir, "server.names");
  if (!existsSync(namesFile) || readFileSync(namesFile, "utf8") !== wanted) {
    const san = names
      .map((name) => (net.isIP(name) ? `IP:${name}` : `DNS:${name}`))
      .join(",");
    writeFileSync(
      path.join(certDir, "server.ext"),
      `subjectAltName=${san}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n`,
    );
    openssl([
      "req",
      "-new",
      "-nodes",
      "-newkey",
      "rsa:2048",
      "-keyout",
      "server.key",
      "-out",
      "server.csr",
      "-subj",
      "/CN=F1 Pad",
    ]);
    openssl([
      "x509",
      "-req",
      "-in",
      "server.csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      "server.crt",
      "-days",
      "825",
      "-sha256",
      "-extfile",
      "server.ext",
    ]);
    writeFileSync(namesFile, wanted);
  }
  return {
    key: readFileSync(path.join(certDir, "server.key")),
    cert: readFileSync(path.join(certDir, "server.crt")),
    ca: readFileSync(path.join(certDir, "ca.crt")),
  };
}

class Relay {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly games = new Set<WebSocket>();
  private readonly pads = new Set<WebSocket>();

  accept(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    role: "game" | "pad",
  ): void {
    this.server.handleUpgrade(request, socket, head, (client) => {
      const own = role === "game" ? this.games : this.pads;
      const peers = role === "game" ? this.pads : this.games;
      own.add(client);
      this.announce();
      client.on("message", (data, isBinary) => {
        for (const peer of peers)
          if (peer.readyState === WebSocket.OPEN)
            peer.send(data, { binary: isBinary });
      });
      client.on("close", () => {
        own.delete(client);
        this.announce();
      });
    });
  }

  private announce(): void {
    const message = JSON.stringify({ pads: this.pads.size });
    for (const game of this.games)
      if (game.readyState === WebSocket.OPEN) game.send(message);
  }
}

function proxyRequest(target: number) {
  return (request: http.IncomingMessage, response: http.ServerResponse) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: target,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: `127.0.0.1:${String(target)}` },
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  };
}

function proxyUpgrade(
  target: number,
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const upstream = net.connect(target, "127.0.0.1", () => {
    const lines = [`${request.method ?? "GET"} ${request.url ?? "/"} HTTP/1.1`];
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i] ?? "";
      lines.push(
        `${name}: ${name.toLowerCase() === "host" ? `127.0.0.1:${String(target)}` : (request.rawHeaders[i + 1] ?? "")}`,
      );
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function setupPage(padUrl: string): string {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>F1 phone setup</title>
<body style="font:17px system-ui;padding:20px;line-height:1.5">
<h2>Phone controller setup</h2>
<p><b>Once per phone:</b> <a href="/ca.crt">download the certificate</a>, then open Settings → Profile Downloaded → Install. Then Settings → General → About → Certificate Trust Settings → turn on “F1 Pad Local CA”.</p>
<p><b>Then:</b> <a href="${padUrl}">open the controller</a>.</p></body>`;
}

function roleOf(url: string | undefined): "game" | "pad" | null {
  if (!url?.startsWith(socketPath)) return null;
  return new URL(url, "http://local").searchParams.get("role") === "pad"
    ? "pad"
    : "game";
}

interface PadUrls {
  padUrl: string;
  setupUrl: string;
}

function padUrls(): PadUrls {
  const host = lanAddresses()[0] ?? "127.0.0.1";
  return {
    padUrl: `https://${host}:${String(padPort)}/pad.html`,
    setupUrl: `http://${host}:${String(setupPort)}/`,
  };
}

function start(
  server: ViteDevServer,
  vitePort: number,
  { padUrl, setupUrl }: PadUrls,
): void {
  const names = [
    ...new Set([...lanAddresses(), "127.0.0.1", "localhost", localHostName()]),
  ];
  const certificates = ensureCertificates(names);
  const relay = new Relay();

  server.httpServer?.on(
    "upgrade",
    (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
      const role = roleOf(request.url);
      if (role) relay.accept(request, socket, head, role);
    },
  );

  const secure = https.createServer(
    { key: certificates.key, cert: certificates.cert },
    proxyRequest(vitePort),
  );
  secure.on(
    "upgrade",
    (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
      if (roleOf(request.url) === "pad")
        relay.accept(request, socket, head, "pad");
      else proxyUpgrade(vitePort, request, socket, head);
    },
  );
  secure.listen(padPort, "0.0.0.0");

  const setup = http.createServer((request, response) => {
    if (request.url === "/ca.crt") {
      response.writeHead(200, {
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": 'attachment; filename="f1-pad-ca.crt"',
      });
      response.end(certificates.ca);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(setupPage(padUrl));
  });
  setup.listen(setupPort, "0.0.0.0");

  server.httpServer?.on("close", () => {
    secure.close();
    setup.close();
  });
  server.config.logger.info(
    `  ➜  Phone pad: ${padUrl}  (first time: ${setupUrl})`,
  );
}

export function padRelay(): Plugin {
  return {
    name: "f1-pad-relay",
    apply: "serve",
    configureServer(server) {
      const urls = padUrls();
      server.middlewares.use("/__pad/info", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(urls));
      });
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (address && typeof address === "object")
          start(server, address.port, urls);
      });
    },
  };
}
