import { type ChildProcess, spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { Plugin, ViteDevServer } from "vite";
import { type PhoneSite, phoneSitePath } from "./src/game/pad-address.ts";

const tunnelAddress = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const checkTries = 40;
const checkPause = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

const publicDns = new Resolver();
publicDns.setServers(["1.1.1.1", "8.8.8.8"]);

function answers(host: string, address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = https.get(
      {
        host: address,
        servername: host,
        headers: { host },
        path: "/pad.html",
        timeout: checkPause * 3,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => {
      resolve(false);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function reachable(origin: string): Promise<boolean> {
  const host = new URL(origin).hostname;
  for (let attempt = 0; attempt < checkTries; attempt++) {
    const [address] = await publicDns.resolve4(host).catch(() => []);
    if (address && (await answers(host, address))) return true;
    await wait(checkPause);
  }
  return false;
}

function openTunnel(port: number, site: PhoneSite): ChildProcess {
  const tunnel = spawn(
    "cloudflared",
    ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${String(port)}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let found = false;
  const read = (chunk: Buffer) => {
    const match = tunnelAddress.exec(chunk.toString());
    if (found || !match) return;
    found = true;
    const origin = match[0];
    void reachable(origin).then((ok) => {
      site.origin = ok ? origin : null;
      site.problem = ok ? null : `${origin} never answered`;
    });
  };
  tunnel.stdout.on("data", read);
  tunnel.stderr.on("data", read);
  tunnel.on("error", () => {
    site.problem =
      "cloudflared is not installed: run `brew install cloudflared` and restart the dev server";
  });
  return tunnel;
}

export function phoneTunnel(): Plugin {
  return {
    name: "f1-phone-tunnel",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      const site: PhoneSite = { origin: null, problem: null };
      let tunnel: ChildProcess | null = null;
      server.middlewares.use(phoneSitePath, (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(site));
      });
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address() as AddressInfo | null;
        if (address) tunnel = openTunnel(address.port, site);
      });
      server.httpServer?.on("close", () => {
        tunnel?.kill();
      });
    },
  };
}
