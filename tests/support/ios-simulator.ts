import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const proxyPort = 9421;
const pagePort = proxyPort + 1;

interface Device {
  udid: string;
  name: string;
  state: string;
}

interface Listing {
  url: string;
  webSocketDebuggerUrl: string;
}

interface InspectorMessage {
  id?: number;
  method?: string;
  params?: {
    targetInfo?: { targetId: string; type: string; isProvisional?: boolean };
    newTargetId?: string;
    message?: string;
  };
  result?: { result?: { value?: unknown }; wasThrown?: boolean };
  error?: { message: string };
}

async function has(command: string): Promise<boolean> {
  return run("which", [command]).then(
    () => true,
    () => false,
  );
}

async function iPhones(): Promise<Device[]> {
  const { stdout } = await run("xcrun", [
    "simctl",
    "list",
    "devices",
    "available",
    "-j",
  ]);
  const listing = JSON.parse(stdout) as { devices: Record<string, Device[]> };
  return Object.entries(listing.devices)
    .filter(([runtime]) => runtime.includes("iOS"))
    .flatMap(([, devices]) => devices)
    .filter((device) => device.name.startsWith("iPhone"));
}

export async function simulatorReady(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  if (!(await has("xcrun")) || !(await has("ios_webkit_debug_proxy")))
    return false;
  return (await iPhones().catch(() => [])).length > 0;
}

async function inspectorSocket(): Promise<string> {
  for (let tries = 0; tries < 40; tries++) {
    const { stdout } = await run("lsof", ["-aUc", "launchd_sim"]).catch(() => ({
      stdout: "",
    }));
    const sockets = [
      ...new Set(stdout.match(/\/\S*webinspectord_sim\.socket/g) ?? []),
    ];
    if (sockets.length > 1)
      throw new Error("Shut down all but one iOS Simulator first.");
    if (sockets[0]) return sockets[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the iOS Simulator has no web inspector socket");
}

export class SafariPage {
  private serial = 0;
  private target: string | null = null;
  private readonly waiting = new Map<
    number,
    (message: InspectorMessage) => void
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.receive(JSON.parse(String(event.data)) as InspectorMessage);
    });
  }

  static async connect(url: string): Promise<SafariPage> {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", reject);
    });
    const page = new SafariPage(socket);
    for (let tries = 0; tries < 50 && !page.target; tries++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (!page.target) throw new Error("Safari page never became inspectable");
    return page;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const reply = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (reply.error) throw new Error(reply.error.message);
    if (reply.result?.wasThrown)
      throw new Error(`Safari threw: ${JSON.stringify(reply.result.result)}`);
    return reply.result?.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }

  private call(method: string, params: object): Promise<InspectorMessage> {
    this.serial += 2;
    const inner = this.serial;
    const message = JSON.stringify({ id: inner, method, params });
    return new Promise((resolve) => {
      this.waiting.set(inner, resolve);
      this.socket.send(
        JSON.stringify({
          id: inner + 1,
          method: "Target.sendMessageToTarget",
          params: { targetId: this.target, message },
        }),
      );
    });
  }

  private receive(message: InspectorMessage): void {
    this.follow(message);
    if (message.method !== "Target.dispatchMessageFromTarget") return;
    const inner = JSON.parse(
      message.params?.message ?? "{}",
    ) as InspectorMessage;
    const done = this.waiting.get(inner.id ?? -1);
    if (!done) return;
    this.waiting.delete(inner.id ?? -1);
    done(inner);
  }

  private follow(message: InspectorMessage): void {
    const info = message.params?.targetInfo;
    if (
      message.method === "Target.targetCreated" &&
      info?.type === "page" &&
      !info.isProvisional
    )
      this.target = info.targetId;
    if (message.method === "Target.didCommitProvisionalTarget")
      this.target = message.params?.newTargetId ?? this.target;
  }
}

export class Simulator {
  private constructor(
    private readonly udid: string,
    private readonly proxy: ChildProcess,
    private readonly bootedHere: boolean,
  ) {}

  static async boot(): Promise<Simulator> {
    const devices = await iPhones();
    const device =
      devices.find((candidate) => candidate.state === "Booted") ?? devices[0];
    if (!device) throw new Error("no iPhone simulator is installed");
    const bootedHere = device.state !== "Booted";
    if (bootedHere) await run("xcrun", ["simctl", "boot", device.udid]);
    await run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
    await run("xcrun", [
      "simctl",
      "launch",
      device.udid,
      "com.apple.mobilesafari",
    ]).catch(() => undefined);
    const proxy = spawn(
      "ios_webkit_debug_proxy",
      [
        "-s",
        `unix:${await inspectorSocket()}`,
        "-c",
        `null:${String(proxyPort)},:${String(pagePort)}-${String(pagePort + 8)}`,
        "-F",
      ],
      { stdio: "ignore" },
    );
    return new Simulator(device.udid, proxy, bootedHere);
  }

  async open(url: string): Promise<SafariPage> {
    for (const listing of await this.pages()) {
      if (listing.url === "about:blank") continue;
      const old = await SafariPage.connect(listing.webSocketDebuggerUrl);
      await old.evaluate(`(location.replace("about:blank"), true)`);
      old.close();
    }
    for (let tries = 0; ; tries++) {
      const opened = await run("xcrun", [
        "simctl",
        "openurl",
        this.udid,
        url,
      ]).then(
        () => true,
        (error: unknown) => {
          if (tries >= 3) throw error;
          return false;
        },
      );
      if (opened) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    for (let tries = 0; tries < 100; tries++) {
      const pages = await this.pages();
      const page = pages.find((listing) => listing.url === url);
      if (page) return SafariPage.connect(page.webSocketDebuggerUrl);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Safari never opened ${url}`);
  }

  private async pages(): Promise<Listing[]> {
    for (let tries = 0; tries < 20; tries++) {
      const pages = await fetch(`http://127.0.0.1:${String(pagePort)}/json`)
        .then((response) => response.json() as Promise<Listing[]>)
        .catch(() => null);
      if (pages) return pages;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("ios_webkit_debug_proxy did not start");
  }

  async close(): Promise<void> {
    this.proxy.kill();
    if (this.bootedHere) await run("xcrun", ["simctl", "shutdown", this.udid]);
  }
}
