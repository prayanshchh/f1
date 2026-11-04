import {
  type Browser,
  type BrowserContext,
  type BrowserType,
  type CDPSession,
  type Page,
  chromium,
  devices,
  expect,
  webkit,
} from "@playwright/test";

export type Pedal = "gas" | "brake";
export type PadButton = "ers" | "boost" | "page" | "wing" | "center" | "retry";
export type Stamp = [number, number];
export type Sample = [number, number, number, number];

export interface PhoneKind {
  name: string;
  engine: BrowserType;
  channel?: string;
  device: string;
  portrait: string;
  ios: boolean;
}

export const phoneKinds: PhoneKind[] = [
  {
    name: "iPhone",
    engine: webkit,
    device: "iPhone 15 landscape",
    portrait: "iPhone 15",
    ios: true,
  },
  {
    name: "Android",
    engine: chromium,
    channel: "chrome",
    device: "Pixel 7 landscape",
    portrait: "Pixel 7",
    ios: false,
  },
];

interface Reading {
  x: number;
  y: number;
  z: number;
}

export interface Tilt {
  up: Reading;
  beta: number;
  gamma: number;
}

interface PhoneProbe {
  tilts: [number, number, number][];
  sent: Sample[];
  tilt: Tilt | null;
  muted: boolean;
  links: string[];
}

interface GameProbe {
  received: Sample[];
  handed: Stamp[];
  car: Sample[];
  peers: RTCPeerConnection[];
}

interface DebugEngine {
  frame(): Float64Array;
  update(now: number): Float64Array;
  analog(input: { steer: number } | null, direct?: boolean): void;
  energyInfo(): { mode: number };
}

interface ProbeWindow {
  padProbe: PhoneProbe;
  gameProbe: GameProbe;
  f1Debug: { engine: DebugEngine };
}

interface Sendable {
  prototype: { send: (data: unknown) => void };
}

interface Listenable {
  prototype: {
    addEventListener: (
      type: string,
      listener: unknown,
      options?: unknown,
    ) => void;
  };
}

interface MotionInit {
  initDeviceMotionEvent(
    type: string,
    bubbles: boolean,
    cancelable: boolean,
    acceleration: Reading | null,
    withGravity: Reading,
    rotation: null,
    interval: number,
  ): void;
}

interface OrientationInit {
  initDeviceOrientationEvent(
    type: string,
    bubbles: boolean,
    cancelable: boolean,
    alpha: number,
    beta: number,
    gamma: number,
    absolute: boolean,
  ): void;
}

const standardGravity = 9.81;
const restingLean = Math.atan2(4, 9);
const touchPoint = { gas: 0.85, brake: 0.15 };
const touchId = { gas: 1, brake: 2 };

export function phoneTilt(degreesLeft: number): Tilt {
  const angle = (degreesLeft * Math.PI) / 180;
  const flat = Math.cos(restingLean);
  const up = {
    x: flat * Math.cos(angle),
    y: -flat * Math.sin(angle),
    z: Math.sin(restingLean),
  };
  return { up, beta: Math.asin(up.y), gamma: Math.atan2(-up.x, up.z) };
}

function quaternionOf(tilt: Tilt) {
  const half = (angle: number) => [Math.sin(angle / 2), Math.cos(angle / 2)];
  const [sb = 0, cb = 1] = half(tilt.beta);
  const [sg = 0, cg = 1] = half(tilt.gamma);
  return { x: sb * cg, y: cb * sg, z: sb * sg, w: cb * cg };
}

export function installPhoneProbe(options: {
  ios: boolean;
  motion: string;
}): void {
  const clock = () => performance.timeOrigin + performance.now();
  const radians = Math.PI / 180;
  const floats = (data: unknown): number[] => {
    if (data instanceof ArrayBuffer && data.byteLength >= 12)
      return [...new Float32Array(data, 0, 3)];
    if (ArrayBuffer.isView(data) && data.byteLength >= 12)
      return [...new Float32Array(data.buffer, data.byteOffset, 3)];
    return [];
  };
  const probe: PhoneProbe = {
    tilts: [],
    sent: [],
    tilt: null,
    muted: false,
    links: [],
  };
  Object.assign(window, { padProbe: probe });
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(config?: RTCConfiguration) {
      super(config);
      const note = (what: string) => {
        probe.links.push(`${String(Math.round(performance.now()))} ${what}`);
      };
      note("created");
      this.addEventListener("icegatheringstatechange", () => {
        note(`gathering ${this.iceGatheringState}`);
      });
      this.addEventListener("icecandidate", (event) => {
        note(`candidate ${event.candidate?.candidate ?? "end"}`);
      });
      this.addEventListener("connectionstatechange", () => {
        note(`connection ${this.connectionState}`);
      });
    }
  };
  window.addEventListener(
    "deviceorientation",
    (event) => {
      if (event.beta === null || event.gamma === null) return;
      const beta = event.beta * radians;
      const gamma = event.gamma * radians;
      probe.tilts.push([
        clock(),
        -Math.sin(gamma) * Math.cos(beta),
        Math.sin(beta),
      ]);
    },
    { capture: true },
  );
  const channel = (window as unknown as { RTCDataChannel?: Sendable })
    .RTCDataChannel;
  if (channel) {
    const send = channel.prototype.send;
    channel.prototype.send = function (this: unknown, data: unknown) {
      if (probe.muted) return;
      const [steer, gas, brake] = floats(data);
      if (steer !== undefined)
        probe.sent.push([clock(), steer, gas ?? 0, brake ?? 0]);
      Reflect.apply(send, this, [data]);
    };
  }
  if (!options.ios) return;
  const ask = () => Promise.resolve(options.motion);
  Object.assign(DeviceMotionEvent, { requestPermission: ask });
  Object.assign(DeviceOrientationEvent, { requestPermission: ask });
  window.setInterval(() => {
    const tilt = probe.tilt;
    if (!tilt) return;
    const orientation = document.createEvent("DeviceOrientationEvent");
    (orientation as unknown as OrientationInit).initDeviceOrientationEvent(
      "deviceorientation",
      false,
      false,
      0,
      tilt.beta / radians,
      tilt.gamma / radians,
      false,
    );
    window.dispatchEvent(orientation);
    const motion = document.createEvent("DeviceMotionEvent");
    (motion as unknown as MotionInit).initDeviceMotionEvent(
      "devicemotion",
      false,
      false,
      null,
      {
        x: -tilt.up.x * 9.81,
        y: -tilt.up.y * 9.81,
        z: -tilt.up.z * 9.81,
      },
      null,
      16,
    );
    window.dispatchEvent(motion);
  }, 16);
}

export function installGameProbe(): void {
  const clock = () => performance.timeOrigin + performance.now();
  const probe: GameProbe = { received: [], handed: [], car: [], peers: [] };
  Object.assign(window, { gameProbe: probe });
  const channel = (window as unknown as { RTCDataChannel?: Listenable })
    .RTCDataChannel;
  if (channel) {
    const add = channel.prototype.addEventListener;
    channel.prototype.addEventListener = function (
      this: unknown,
      type: string,
      listener: unknown,
      options?: unknown,
    ) {
      if (type === "message" && typeof listener === "function") {
        const wrapped = function (this: unknown, event: MessageEvent) {
          if (
            event.data instanceof ArrayBuffer &&
            event.data.byteLength >= 12
          ) {
            const [steer = 0, gas = 0, brake = 0] = new Float32Array(
              event.data,
              0,
              3,
            );
            probe.received.push([clock(), steer, gas, brake]);
          }
          return Reflect.apply(listener, this, [event]) as unknown;
        };
        Reflect.apply(add, this, [type, wrapped, options]);
        return;
      }
      Reflect.apply(add, this, [type, listener, options]);
    };
  }
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Native {
    constructor(config?: RTCConfiguration) {
      super(config);
      probe.peers.push(this);
    }
  };
}

function wrapEngine(): void {
  const clock = () => performance.timeOrigin + performance.now();
  const w = window as unknown as ProbeWindow;
  const engine = w.f1Debug.engine;
  const probe = w.gameProbe;
  const update = engine.update.bind(engine);
  const analog = engine.analog.bind(engine);
  engine.update = (now: number) => {
    const frame = update(now);
    probe.car.push([
      clock(),
      frame[55] ?? Number.NaN,
      frame[56] ?? Number.NaN,
      frame[57] ?? Number.NaN,
    ]);
    return frame;
  };
  engine.analog = (input, direct) => {
    probe.handed.push([clock(), input ? input.steer : Number.NaN]);
    analog(input, direct);
  };
}

export function peerRoutes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const types: string[] = [];
    for (const peer of (window as unknown as ProbeWindow).gameProbe.peers) {
      if (peer.connectionState !== "connected") continue;
      const stats = await peer.getStats();
      const byId = new Map<string, Record<string, unknown>>();
      stats.forEach((report: Record<string, unknown>) => {
        byId.set(String(report["id"]), report);
      });
      for (const report of byId.values()) {
        if (report["type"] !== "transport") continue;
        const pair = byId.get(String(report["selectedCandidatePairId"]));
        const local = byId.get(String(pair?.["localCandidateId"]));
        const remote = byId.get(String(pair?.["remoteCandidateId"]));
        types.push(
          `${String(local?.["candidateType"])}-${String(remote?.["candidateType"])}`,
        );
      }
    }
    return types;
  });
}

export function nodeClock(): number {
  return performance.timeOrigin + performance.now();
}

export interface ClockOffset {
  offset: number;
  error: number;
}

export async function clockOffset(
  page: Page | (() => Promise<number>),
): Promise<ClockOffset> {
  const read =
    typeof page === "function"
      ? page
      : () => page.evaluate(() => performance.timeOrigin + performance.now());
  let best: ClockOffset = { offset: 0, error: Infinity };
  for (let i = 0; i < 20; i++) {
    const before = nodeClock();
    const remote = await read();
    const after = nodeClock();
    const error = (after - before) / 2;
    if (error < best.error)
      best = { offset: remote - (before + after) / 2, error };
  }
  return best;
}

function deviceOf(name: string) {
  const device = devices[name];
  if (!device) throw new Error(`Playwright has no device called ${name}`);
  return device;
}

export interface PhoneOptions {
  motion?: string;
  portrait?: boolean;
  strictCertificates?: boolean;
}

export class Phone {
  private readonly touches = new Map<Pedal, { x: number; y: number }>();
  private readonly requested: string[] = [];

  private constructor(
    readonly page: Page,
    private readonly context: BrowserContext,
    private readonly sensors: CDPSession | null,
  ) {}

  static async open(
    browser: Browser,
    kind: PhoneKind,
    url: string,
    options: PhoneOptions = {},
  ): Promise<Phone> {
    const context = await browser.newContext({
      ...deviceOf(options.portrait ? kind.portrait : kind.device),
      ignoreHTTPSErrors: options.strictCertificates !== true,
    });
    await context.addInitScript(installPhoneProbe, {
      ios: kind.ios,
      motion: options.motion ?? "granted",
    });
    if (!kind.ios)
      await context.grantPermissions([
        "accelerometer",
        "gyroscope",
        "magnetometer",
      ]);
    const page = await context.newPage();
    const sensors = kind.ios ? null : await context.newCDPSession(page);
    const phone = new Phone(page, context, sensors);
    page.on("request", (request) => {
      phone.requested.push(request.url());
    });
    page.on("websocket", (socket) => {
      phone.requested.push(socket.url());
    });
    await page.goto(url);
    await phone.enableSensors();
    await phone.tilt(0);
    return phone;
  }

  private async enableSensors(): Promise<void> {
    if (!this.sensors) return;
    for (const type of [
      "relative-orientation",
      "accelerometer",
      "linear-acceleration",
      "gyroscope",
    ] as const) {
      await this.sensors.send("Emulation.setSensorOverrideEnabled", {
        enabled: true,
        type,
      });
      if (type !== "relative-orientation")
        await this.sensors.send("Emulation.setSensorOverrideReadings", {
          type,
          reading: { xyz: { x: 0, y: 0, z: 0 } },
        });
    }
  }

  async tilt(degreesLeft: number): Promise<Tilt> {
    const tilt = phoneTilt(degreesLeft);
    if (this.sensors) {
      await this.sensors.send("Emulation.setSensorOverrideReadings", {
        type: "relative-orientation",
        reading: { quaternion: quaternionOf(tilt) },
      });
      await this.sensors.send("Emulation.setSensorOverrideReadings", {
        type: "accelerometer",
        reading: {
          xyz: {
            x: tilt.up.x * standardGravity,
            y: tilt.up.y * standardGravity,
            z: tilt.up.z * standardGravity,
          },
        },
      });
      return tilt;
    }
    await this.page.evaluate((value) => {
      (window as unknown as ProbeWindow).padProbe.tilt = value;
    }, tilt);
    return tilt;
  }

  async start(): Promise<void> {
    await this.page.locator("[data-pad=go]").click();
  }

  async startAndCalibrate(): Promise<void> {
    await this.start();
    await expect(this.page.locator("[data-pad=link]")).toHaveText("Live", {
      timeout: 10_000,
    });
    await expect(this.page.locator("[data-pad=calibrate]")).toBeHidden({
      timeout: 6_000,
    });
  }

  async text(name: string): Promise<string> {
    return (await this.page.locator(`[data-pad=${name}]`).textContent()) ?? "";
  }

  async tap(button: PadButton): Promise<void> {
    await this.page.locator(`[data-pad=${button}]`).click();
  }

  async press(pedal: Pedal): Promise<void> {
    const box = await this.page.locator("[data-pad=root]").boundingBox();
    if (!box) throw new Error("pad is not on screen");
    this.touches.set(pedal, {
      x: box.x + box.width * touchPoint[pedal],
      y: box.y + box.height / 2,
    });
    await this.touch("touchstart", pedal);
  }

  async release(pedal: Pedal): Promise<void> {
    const point = this.touches.get(pedal);
    if (!point) return;
    this.touches.delete(pedal);
    await this.touch("touchend", pedal, point);
  }

  private async touch(
    type: string,
    pedal: Pedal,
    changed = this.touches.get(pedal),
  ): Promise<void> {
    const toTouch = (name: Pedal, at: { x: number; y: number }) => ({
      identifier: touchId[name],
      clientX: at.x,
      clientY: at.y,
    });
    const active = [...this.touches].map(([name, at]) => toTouch(name, at));
    await this.page.locator("[data-pad=root]").dispatchEvent(type, {
      touches: active,
      targetTouches: active,
      changedTouches: changed ? [toTouch(pedal, changed)] : [],
    });
  }

  async keepApart(): Promise<void> {
    const strip = (sdp: string) =>
      sdp
        .split("\r\n")
        .filter((line) => !line.startsWith("a=candidate"))
        .join("\r\n");
    await this.context.route("**/api/pad/*/offers", async (route) => {
      const body = route.request().postDataJSON() as { sdp: string };
      await route.continue({
        postData: JSON.stringify({ sdp: strip(body.sdp) }),
      });
    });
    await this.context.route("**/api/pad/*/answers/*", async (route) => {
      const response = await route.fetch();
      if (response.status() !== 200) {
        await route.fulfill({ response });
        return;
      }
      const body = (await response.json()) as { sdp: string };
      await route.fulfill({ response, json: { sdp: strip(body.sdp) } });
    });
  }

  async bringTogether(): Promise<void> {
    await this.context.unrouteAll({ behavior: "ignoreErrors" });
  }

  async goSilent(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as ProbeWindow).padProbe.muted = true;
    });
  }

  async logs(): Promise<{ tilts: [number, number, number][]; sent: Sample[] }> {
    return this.page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).padProbe;
      return { tilts: probe.tilts, sent: probe.sent };
    });
  }

  requests(): string[] {
    return [...this.requested];
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

export interface CarControls {
  steer: number;
  throttle: number;
  brake: number;
  speedKph: number;
  gear: number;
}

export class Game {
  private readonly pairingAsks: string[] = [];
  private readonly openAsks = new Set<unknown>();

  private constructor(readonly page: Page) {
    const pairing = /\/api\/pad\/[^/]+\/offers/;
    page.on("request", (request) => {
      if (!pairing.test(request.url())) return;
      this.pairingAsks.push(request.url());
      this.openAsks.add(request);
    });
    page.on("requestfinished", (request) => this.openAsks.delete(request));
    page.on("requestfailed", (request) => this.openAsks.delete(request));
  }

  pairingRequests(): { sent: number; open: number } {
    return { sent: this.pairingAsks.length, open: this.openAsks.size };
  }

  static async open(browser: Browser, baseURL: string): Promise<Game> {
    const page = await browser.newPage({
      baseURL,
      viewport: { width: 1280, height: 720 },
    });
    await page.addInitScript(installGameProbe);
    await page.addInitScript(() => {
      localStorage.setItem(
        "revracers.settings",
        JSON.stringify({ session: "practice" }),
      );
    });
    await page.goto("/?autostart&debug");
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 170_000 },
    );
    await page.evaluate(wrapEngine);
    return new Game(page);
  }

  async padUrl(): Promise<string> {
    const url = this.page.locator("[data-pad=pad-url]");
    await expect(url).toHaveText(/^https?:\/\//);
    return url.innerText();
  }

  controls(): Promise<CarControls> {
    return this.page.evaluate(() => {
      const frame = (window as unknown as ProbeWindow).f1Debug.engine.frame();
      return {
        steer: frame[55] ?? Number.NaN,
        throttle: frame[56] ?? Number.NaN,
        brake: frame[57] ?? Number.NaN,
        speedKph: Math.abs(frame[45] ?? 0) * 3.6,
        gear: frame[48] ?? Number.NaN,
      };
    });
  }

  ersMode(): Promise<number> {
    return this.page.evaluate(
      () => (window as unknown as ProbeWindow).f1Debug.engine.energyInfo().mode,
    );
  }

  async settledSteer(): Promise<number> {
    let last = Number.NaN;
    await expect
      .poll(
        async () => {
          const now = (await this.controls()).steer;
          const steady = Math.abs(now - last) < 0.002;
          last = now;
          return steady;
        },
        { intervals: [150], timeout: 5_000 },
      )
      .toBe(true);
    return last;
  }

  async leftKeySign(): Promise<number> {
    await this.page.keyboard.down("ArrowLeft");
    await expect
      .poll(async () => Math.abs((await this.controls()).steer))
      .toBeGreaterThan(0.2);
    const steer = (await this.controls()).steer;
    await this.page.keyboard.up("ArrowLeft");
    await expect
      .poll(async () => Math.abs((await this.controls()).steer))
      .toBeLessThan(0.02);
    return Math.sign(steer);
  }

  phoneBadge() {
    return this.page.locator("[data-pad=badge]");
  }

  async showPairing(): Promise<void> {
    const panel = this.page.locator("[data-pad=panel]");
    if (await panel.isHidden()) await this.page.keyboard.press("p");
    await expect(panel).toBeVisible();
  }

  async resume(): Promise<void> {
    const menu = this.page.locator("[data-menu=root]");
    if (await menu.isVisible()) await this.page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(this.page.locator("[data-pad=panel]")).toBeHidden();
  }

  async logs(): Promise<Omit<GameProbe, "peers">> {
    return this.page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).gameProbe;
      return {
        received: probe.received,
        handed: probe.handed,
        car: probe.car,
      };
    });
  }

  route(): Promise<string[]> {
    return peerRoutes(this.page);
  }

  async clearLogs(): Promise<void> {
    await this.page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).gameProbe;
      probe.received.length = 0;
      probe.handed.length = 0;
      probe.car.length = 0;
    });
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

export async function launchPhoneBrowser(kind: PhoneKind): Promise<Browser> {
  return kind.engine.launch({ channel: kind.channel ?? "", args: [] });
}
