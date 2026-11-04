import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type Browser, type Page, chromium, expect } from "@playwright/test";
import { type Sample, installGameProbe, peerRoutes } from "./phone-pad.ts";

const run = promisify(execFile);
const repo = fileURLToPath(new URL("../..", import.meta.url));
const browserImage = "mcr.microsoft.com/playwright:v1.64.1-noble";
const toolsImage = "revracers-pad-nettools";
const tools =
  "FROM alpine:3.22\nRUN apk add --no-cache iproute2 iproute2-tc iptables\n";
const label = "revracers.padlab";
const serverPort = "3000";

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { maxBuffer: 1 << 24 });
  return stdout.trim();
}

export async function dockerReady(): Promise<boolean> {
  return docker("info", "--format", "{{.ServerVersion}}").then(
    () => true,
    () => false,
  );
}

async function ensureTools(): Promise<void> {
  const found = await docker("images", "-q", toolsImage);
  if (found) return;
  const build = execFile("docker", ["build", "-q", "-t", toolsImage, "-"]);
  build.stdin?.end(tools);
  await new Promise((resolve, reject) => {
    build.on("exit", (code) => {
      if (code === 0) resolve(null);
      else reject(new Error("could not build the network tools image"));
    });
  });
}

async function removeLabs(filter: string): Promise<void> {
  const containers = await docker("ps", "-aq", "--filter", filter);
  if (containers) await docker("rm", "-f", ...containers.split("\n"));
  const networks = await docker("network", "ls", "-q", "--filter", filter);
  if (networks) await docker("network", "rm", ...networks.split("\n"));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => {
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
  });
}

function reachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    https
      .get(url, { rejectUnauthorized: false }, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      })
      .on("error", () => {
        resolve(false);
      });
  });
}

async function poll<T>(
  attempt: () => Promise<T | null>,
  what: string,
): Promise<T> {
  for (let tries = 0; tries < 120; tries++) {
    const result = await attempt();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} did not come up`);
}

export class Lab {
  private serial = 0;
  private server: ChildProcess | null = null;
  private origin = "";

  private constructor(
    private readonly id: string,
    private readonly files: string,
  ) {}

  static async open(): Promise<Lab> {
    await removeLabs(`label=${label}`);
    await ensureTools();
    const files = mkdtempSync(path.join(tmpdir(), "padlab-"));
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=revracers",
      "-keyout",
      path.join(files, "site.key"),
      "-out",
      path.join(files, "site.crt"),
    ]);
    await run(
      "pnpm",
      [
        "exec",
        "vite",
        "build",
        path.join(repo, "tests/pad/network"),
        "--outDir",
        path.join(files, "harness"),
        "--base",
        "/harness/",
        "--emptyOutDir",
        "--logLevel",
        "warn",
      ],
      { cwd: path.join(repo, "apps/client") },
    );
    return new Lab(randomBytes(3).toString("hex"), files);
  }

  async network(name: string): Promise<string> {
    const full = this.name(name);
    await docker("network", "create", "--label", this.tag(), full);
    return full;
  }

  async site(): Promise<string> {
    if (this.server) return this.origin;
    const port = await freePort();
    this.server = spawn(
      process.execPath,
      [
        "--experimental-transform-types",
        "--no-warnings",
        path.join(repo, "tests/pad/network/site.ts"),
      ],
      {
        env: {
          ...process.env,
          SITE_KEY: path.join(this.files, "site.key"),
          SITE_CERT: path.join(this.files, "site.crt"),
          HARNESS_ROOT: path.join(this.files, "harness"),
          SITE_PORT: String(port),
        },
        stdio: "ignore",
      },
    );
    await poll(
      async () =>
        (await reachable(`https://127.0.0.1:${String(port)}/phonepad`)) || null,
      "the site",
    );
    this.origin = `https://host.docker.internal:${String(port)}`;
    return this.origin;
  }

  async browser(
    name: string,
    networks: string[],
    extra: string[] = [],
  ): Promise<Browser> {
    const [first, ...rest] = networks;
    const full = this.name(name);
    await docker(
      "run",
      "-d",
      "--name",
      full,
      "--label",
      this.tag(),
      "--network",
      first ?? "",
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      `127.0.0.1::${serverPort}`,
      "-v",
      `${repo}:/repo:ro`,
      ...extra,
      browserImage,
      "node",
      "/repo/node_modules/@playwright/test/cli.js",
      "run-server",
      "--port",
      serverPort,
      "--host",
      "0.0.0.0",
    );
    for (const network of rest)
      await docker("network", "connect", network, full);
    const address = (await docker("port", full, serverPort)).split("\n")[0];
    return poll(
      () => chromium.connect(`ws://${address ?? ""}/`).catch(() => null),
      `the ${name} browser`,
    );
  }

  async ip(name: string, network: string): Promise<string> {
    return docker(
      "inspect",
      "-f",
      `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
      this.name(name),
    );
  }

  async inside(name: string, script: string): Promise<void> {
    await docker(
      "run",
      "--rm",
      "--network",
      `container:${this.name(name)}`,
      "--cap-add",
      "NET_ADMIN",
      toolsImage,
      "sh",
      "-ec",
      script,
    );
  }

  async reset(): Promise<void> {
    await removeLabs(`label=${this.tag()}`);
    this.serial += 1;
  }

  async close(): Promise<void> {
    this.server?.kill();
    await removeLabs(`label=${label}`);
    rmSync(this.files, { recursive: true, force: true });
  }

  private tag(): string {
    return `${label}=${this.id}`;
  }

  private name(part: string): string {
    return `padlab-${this.id}-${String(this.serial)}-${part}`;
  }
}

export class NetworkGame {
  private constructor(readonly page: Page) {}

  static async open(browser: Browser, site: string): Promise<NetworkGame> {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addInitScript(installGameProbe);
    const page = await context.newPage();
    await page.goto(`${site}/harness/`);
    return new NetworkGame(page);
  }

  async padUrl(): Promise<string> {
    const url = this.page.locator("[data-pad=pad-url]");
    await expect(url).toHaveText(/^https:\/\//);
    return (await url.textContent()) ?? "";
  }

  badge() {
    return this.page.locator("[data-pad=badge]");
  }

  steer(): Promise<number | null> {
    return this.page.evaluate(() => {
      const game = (
        window as unknown as {
          padGame: { input: () => { steer: number } | null };
        }
      ).padGame;
      return game.input()?.steer ?? null;
    });
  }

  received(): Promise<Sample[]> {
    return this.page.evaluate(
      () =>
        (window as unknown as { gameProbe: { received: Sample[] } }).gameProbe
          .received,
    );
  }

  routes(): Promise<string[]> {
    return peerRoutes(this.page);
  }
}
