import { spawnSync } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { mkdtempSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, type PluginOption, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  padAddress,
  type PhoneSite,
  phoneSitePath,
} from "../../apps/client/src/game/pad-address.ts";
import { repoRoot } from "../support/repo.ts";

const room = "phoneLinkRoom012345678";
const loopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/;
const tunnelWait = 180_000;
const hasTunnel =
  spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status === 0;

describe("the phone code on the game screen", () => {
  test("on the dev server it waits for the secure phone link instead of pointing at localhost", () => {
    const opening: PhoneSite = { origin: null, problem: null };
    expect(padAddress("http://localhost:5173", opening, room)).toBeNull();
    const ready: PhoneSite = {
      origin: "https://quiet-river.trycloudflare.com",
      problem: null,
    };
    expect(padAddress("http://localhost:5173", ready, room)).toBe(
      `https://quiet-river.trycloudflare.com/pad.html#${room}`,
    );
  });

  test("a deployed game links phones to its own site", () => {
    expect(padAddress("https://play.example.com", null, room)).toBe(
      `https://play.example.com/pad.html#${room}`,
    );
  });
});

const publicDns = new Resolver();
publicDns.setServers(["1.1.1.1", "8.8.8.8"]);

async function overInternet(
  url: string,
  method: "GET" | "POST",
): Promise<number> {
  const target = new URL(url);
  const [address] = await publicDns.resolve4(target.hostname);
  if (!address) throw new Error(`${target.hostname} has no address`);
  const body = method === "POST" ? JSON.stringify({ sdp: "v=0" }) : "";
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method,
        host: address,
        servername: target.hostname,
        path: target.pathname,
        headers: { host: target.hostname, "content-type": "application/json" },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

describe.runIf(hasTunnel)("the dev server's phone link", () => {
  let server: ViteDevServer;
  let site: PhoneSite = { origin: null, problem: null };

  beforeAll(async () => {
    process.env["F1_DATA_DIR"] = mkdtempSync(
      path.join(os.tmpdir(), "f1-link-"),
    );
    const { default: config } =
      await import("../../apps/client/vite.config.ts");
    const plugins = (config.plugins ?? []).filter(
      (plugin: PluginOption) =>
        !(
          plugin &&
          "name" in plugin &&
          plugin.name === "revracers-engine-build"
        ),
    );
    server = await createServer({
      ...config,
      configFile: false,
      plugins,
      root: path.join(repoRoot, "apps/client"),
      server: { ...config.server, port: 0, host: "127.0.0.1" },
      logLevel: "silent",
    });
    await server.listen();
    const { port } = server.httpServer?.address() as AddressInfo;
    const started = Date.now();
    while (!site.origin && !site.problem && Date.now() - started < tunnelWait) {
      const answer = await fetch(
        `http://127.0.0.1:${String(port)}${phoneSitePath}`,
      );
      site = (await answer.json()) as PhoneSite;
      if (!site.origin) await new Promise((done) => setTimeout(done, 1000));
    }
  }, tunnelWait + 60_000);

  afterAll(async () => {
    await server.close();
  });

  test("is a public https address, never this computer's localhost", () => {
    expect(site.problem).toBeNull();
    expect(site.origin).toMatch(/^https:\/\//);
    expect(site.origin).not.toMatch(loopback);
  });

  test("opens the pad and the pairing service from outside this computer", async () => {
    const origin = site.origin ?? "";
    expect(await overInternet(`${origin}/pad.html`, "GET")).toBe(200);
    expect(await overInternet(`${origin}/api/pad/${room}/offers`, "POST")).toBe(
      201,
    );
  }, 60_000);
});
