import "./pad.css";
import {
  controlChannel,
  delay,
  gathered,
  inputChannel,
  peerConfig,
  postOffer,
  waitAnswer,
} from "./pad-signal.ts";
import { PlayerError, playerMessage } from "./game/player-error.ts";

const fullLock = Math.PI / 4 / 1.3;
const sensitivities = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const defaultSensitivity = sensitivities.indexOf(1);
const sensitivityKey = "f1pad.sensitivity";
const calibrateTime = 3000;
const sampleTime = 1000;
const deadZone = 0.03;
const curve = 1.3;
const gravityTime = 0.04;
const standardGravity = 9.81;
const minTilt = 0.3;
const degrees = Math.PI / 180;
const vibrateFrom = 0.15;
const vibratePulse = 60;
const resendAfter = 12;
const maxBuffered = 1024;
const openTimeout = 10_000;
const lostAfter = 3000;
const retryDelay = 1500;
const maxPedalStep = 0.25;
const pedalBite = 1 / 60;
const roomPattern = /^[A-Za-z0-9_-]{22}$/;
const pedalReach = 0.03;
const riseTime: Record<Pedal, number> = { gas: 1.2, brake: 0.8 };
const fallTime: Record<Pedal, number> = { gas: 0.2, brake: 0.15 };
const boostSettle = 600;

type Pedal = "gas" | "brake";
type LinkState = "connecting" | "live" | "waiting" | "lost" | "blocked";

interface Permissioned {
  requestPermission?: () => Promise<string>;
}

interface Lockable {
  lock?: (orientation: string) => Promise<void>;
}

function element(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-pad=${name}]`);
  if (!found) throw new Error(`missing pad element ${name}`);
  return found;
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function wrapDegrees(degreesValue: number): number {
  return Math.round(wrap(degreesValue * degrees) / degrees);
}

function shape(value: number): number {
  const magnitude = Math.min(1, Math.abs(value));
  if (magnitude < deadZone) return 0;
  return Math.sign(value) * ((magnitude - deadZone) / (1 - deadZone)) ** curve;
}

function savedSensitivity(): number {
  const raw = localStorage.getItem(sensitivityKey);
  const saved = Number(raw);
  return raw !== null &&
    Number.isInteger(saved) &&
    saved >= 0 &&
    saved < sensitivities.length
    ? saved
    : defaultSensitivity;
}

function pulse(rumble: number): void {
  if ("vibrate" in navigator && rumble > vibrateFrom)
    navigator.vibrate(vibratePulse);
}

function onAButton(touch: Touch): boolean {
  return (
    touch.target instanceof Element && touch.target.closest("button") !== null
  );
}

function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

function padRoom(): string | null {
  const room = location.hash.slice(1);
  return roomPattern.test(room) ? room : null;
}

function opened(channel: RTCDataChannel): Promise<boolean> {
  return new Promise((resolve) => {
    if (channel.readyState === "open") {
      resolve(true);
      return;
    }
    const timer = window.setTimeout(() => {
      resolve(false);
    }, openTimeout);
    channel.addEventListener("open", () => {
      window.clearTimeout(timer);
      resolve(true);
    });
    channel.addEventListener("close", () => {
      window.clearTimeout(timer);
      resolve(false);
    });
  });
}

function ended(pc: RTCPeerConnection, channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    let lostTimer = 0;
    channel.addEventListener("close", () => {
      resolve();
    });
    pc.addEventListener("connectionstatechange", () => {
      window.clearTimeout(lostTimer);
      if (pc.connectionState === "failed" || pc.connectionState === "closed")
        resolve();
      else if (pc.connectionState === "disconnected")
        lostTimer = window.setTimeout(resolve, lostAfter);
    });
  });
}

class PhoneLink {
  private input: RTCDataChannel | null = null;
  private running = false;

  constructor(
    private readonly room: string,
    private readonly onState: (state: LinkState) => void,
    private readonly onFeedback: (message: object) => void,
    private readonly onReplaced: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.onState("connecting");
    void this.run();
  }

  send(data: Float32Array<ArrayBuffer>): void {
    const input = this.input;
    if (input?.readyState !== "open" || input.bufferedAmount > maxBuffered)
      return;
    input.send(data);
  }

  private stopped(): boolean {
    return !this.running;
  }

  private async run(): Promise<void> {
    while (this.running) {
      const outcome = await this.session().catch(() => "lost" as const);
      if (this.stopped()) return;
      this.onState(outcome);
      await delay(retryDelay);
    }
  }

  private async session(): Promise<LinkState> {
    const pc = new RTCPeerConnection(peerConfig);
    const input = pc.createDataChannel(inputChannel, {
      ordered: false,
      maxRetransmits: 0,
    });
    const leave = () => {
      pc.close();
    };
    window.addEventListener("pagehide", leave);
    try {
      const control = pc.createDataChannel(controlChannel);
      control.addEventListener("message", (event) => {
        this.receive(event.data);
      });
      await pc.setLocalDescription(await pc.createOffer());
      const id = await postOffer(this.room, await gathered(pc));
      const answer = await waitAnswer(this.room, id);
      if (answer === null) return "waiting";
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      if (!(await opened(input))) return "blocked";
      this.input = input;
      this.onState("live");
      await ended(pc, input);
      return "lost";
    } finally {
      window.removeEventListener("pagehide", leave);
      if (this.input === input) this.input = null;
      pc.close();
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    const message: unknown = JSON.parse(data);
    if (typeof message !== "object" || message === null) return;
    if ("replaced" in message) {
      this.running = false;
      this.input?.close();
      this.onReplaced();
      return;
    }
    this.onFeedback(message);
  }
}

class Pad {
  private readonly root = element("root");
  private readonly wheel = element("wheel");
  private readonly fills: Record<Pedal, HTMLElement> = {
    gas: element("gas"),
    brake: element("brake"),
  };
  private readonly touches = new Map<number, Pedal>();
  private readonly pedals: Record<Pedal, number> = { gas: 0, brake: 0 };
  private readonly link: PhoneLink;
  private pedalsAt = 0;
  private gravity: [number, number] = [0, 0];
  private gravityAt = 0;
  private fused = false;
  private center: number | null = null;
  private angle: number | null = null;
  private calibration: { until: number; sin: number; cos: number } | null =
    null;
  private sensitivity = savedSensitivity();
  private steer = 0;
  private baseAngle = screen.orientation.angle;
  private boostPresses = 0;
  private boosting = false;
  private boostTapAt = -Infinity;
  private ersPresses = 0;
  private pagePresses = 0;
  private wingPresses = 0;
  private tyrePresses = 0;
  private sequence = 0;
  private sentAt = 0;

  constructor(room: string) {
    this.link = new PhoneLink(
      room,
      (state) => {
        this.showLink(state);
      },
      (message) => {
        this.onFeedback(message);
      },
      () => {
        this.showReplaced();
      },
    );
  }

  async start(): Promise<void> {
    if (isPortrait())
      throw new PlayerError("Turn the phone sideways, then tap Start.");
    await this.requestMotion();
    void this.keepAwake();
    this.baseAngle = screen.orientation.angle;
    void (screen.orientation as unknown as Lockable)
      .lock?.("landscape")
      .catch(() => undefined);
    this.listen();
    this.setSensitivity(this.sensitivity);
    this.link.start();
    this.layout();
    this.calibrate();
    requestAnimationFrame((time) => {
      this.tick(time);
    });
  }

  private listen(): void {
    document.addEventListener("visibilitychange", () => {
      this.onVisibility();
    });
    window.addEventListener("deviceorientation", (event) => {
      this.onOrientation(event);
    });
    window.addEventListener("devicemotion", (event) => {
      this.onMotion(event);
    });
    for (const type of [
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
    ] as const) {
      this.root.addEventListener(
        type,
        (event) => {
          this.onTouch(event);
        },
        { passive: false },
      );
    }
    window.addEventListener("resize", () => {
      this.layout();
    });
    screen.orientation.addEventListener("change", () => {
      this.layout();
    });
    this.listenButtons();
  }

  private listenButtons(): void {
    const press = (name: string, action: () => void) => {
      element(name).addEventListener("click", () => {
        action();
        this.send();
      });
    };
    press("boost", () => {
      this.boostPresses++;
      this.boostTapAt = performance.now();
      this.showBoost(!this.boosting);
    });
    press("ers", () => {
      this.ersPresses++;
    });
    press("page", () => {
      this.pagePresses++;
    });
    press("wing", () => {
      this.wingPresses++;
    });
    press("tyre", () => {
      this.tyrePresses++;
    });
    press("center", () => {
      this.calibrate();
    });
    press("less", () => {
      this.setSensitivity(this.sensitivity - 1);
    });
    press("more", () => {
      this.setSensitivity(this.sensitivity + 1);
    });
    element("retry").addEventListener("click", () => {
      element("notice").hidden = true;
      this.link.start();
    });
  }

  private async keepAwake(): Promise<void> {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible")
      return;
    const lock = await navigator.wakeLock
      .request("screen")
      .catch(() => undefined);
    lock?.addEventListener("release", () => {
      void this.keepAwake();
    });
  }

  private async requestMotion(): Promise<void> {
    const asks: Promise<string>[] = [];
    for (const type of [
      DeviceOrientationEvent,
      DeviceMotionEvent,
    ] as unknown as Permissioned[])
      if (type.requestPermission) asks.push(type.requestPermission());
    if (asks.length === 0) return;
    const states = await Promise.all(asks);
    if (states.some((state) => state !== "granted"))
      throw new PlayerError(
        "Motion access was not allowed. Reload and tap Allow.",
      );
  }

  private onVisibility(): void {
    if (document.visibilityState === "visible") {
      void this.keepAwake();
      return;
    }
    this.advancePedals(performance.now());
    this.touches.clear();
    this.pedals.gas = 0;
    this.pedals.brake = 0;
    this.send();
  }

  private calibrate(): void {
    this.calibration = {
      until: performance.now() + calibrateTime,
      sin: 0,
      cos: 0,
    };
    this.steer = 0;
    element("calibrate").hidden = false;
  }

  private updateCalibration(time: number): void {
    if (!this.calibration) return;
    const remaining = this.calibration.until - time;
    element("count").textContent = String(
      Math.max(1, Math.ceil(remaining / 1000)),
    );
    if (remaining > 0) return;
    const { sin, cos } = this.calibration;
    this.center = sin !== 0 || cos !== 0 ? Math.atan2(sin, cos) : this.angle;
    this.calibration = null;
    element("calibrate").hidden = true;
  }

  private setSensitivity(index: number): void {
    this.sensitivity = Math.min(sensitivities.length - 1, Math.max(0, index));
    localStorage.setItem(sensitivityKey, String(this.sensitivity));
    element("sens").textContent =
      `${(sensitivities[this.sensitivity] ?? 1).toFixed(2)}×`;
    element("sensbar").style.width =
      `${String((this.sensitivity / (sensitivities.length - 1)) * 100)}%`;
  }

  private showLink(state: LinkState): void {
    const labels: Record<LinkState, string> = {
      connecting: "Connecting",
      live: "Live",
      waiting: "Waiting for game",
      lost: "Reconnecting",
      blocked: "No connection",
    };
    element("dot").classList.toggle("on", state === "live");
    element("link").textContent = labels[state];
    if (state === "blocked")
      this.showNotice(
        "Can't reach the game",
        "Phone and computer must be on the same Wi-Fi. If they are, this network keeps devices apart: turn on your phone's hotspot and join it from the computer.",
        false,
      );
    else if (state === "live") element("notice").hidden = true;
  }

  private showReplaced(): void {
    element("dot").classList.remove("on");
    element("link").textContent = "Not driving";
    this.showNotice(
      "Another phone is driving",
      "Tap below to drive with this phone instead.",
      true,
    );
  }

  private showNotice(title: string, text: string, retry: boolean): void {
    element("notice-title").textContent = title;
    element("notice-text").textContent = text;
    element("retry").hidden = !retry;
    element("notice").hidden = false;
  }

  private showEnergy(message: object): void {
    if (!("battery" in message && "mode" in message)) return;
    element("batt").textContent =
      `Batt ${String(Math.round(Number(message.battery) * 100))}%`;
    const boost = "boost" in message && message.boost === true;
    if (!boost) element("ers-mode").textContent = String(message.mode);
    if (performance.now() - this.boostTapAt > boostSettle)
      this.showBoost(boost);
  }

  private showBoost(on: boolean): void {
    this.boosting = on;
    element("boost").setAttribute("aria-pressed", String(on));
  }

  private onFeedback(message: object): void {
    if (!("speed" in message) || !("gear" in message)) return;
    this.showEnergy(message);
    if ("rumble" in message) pulse(Number(message.rumble));
    const gear = Number(message.gear);
    element("speed").textContent = String(Math.round(Number(message.speed)));
    element("gear").textContent =
      gear < 0 ? "R" : gear === 0 ? "N" : String(gear);
  }

  private onOrientation(event: DeviceOrientationEvent): void {
    if (event.beta === null || event.gamma === null) return;
    this.fused = true;
    const beta = event.beta * degrees;
    const gamma = event.gamma * degrees;
    this.tilt(-Math.sin(gamma) * Math.cos(beta), Math.sin(beta));
  }

  private onMotion(event: DeviceMotionEvent): void {
    if (this.fused) return;
    const a = event.accelerationIncludingGravity;
    if (a?.x == null || a.y == null) return;
    const now = event.timeStamp / 1000;
    const k =
      this.gravityAt === 0
        ? 1
        : 1 - Math.exp(-Math.max(0, now - this.gravityAt) / gravityTime);
    this.gravityAt = now;
    this.gravity = [
      this.gravity[0] + (a.x - this.gravity[0]) * k,
      this.gravity[1] + (a.y - this.gravity[1]) * k,
    ];
    this.tilt(
      this.gravity[0] / standardGravity,
      this.gravity[1] / standardGravity,
    );
  }

  private tilt(x: number, y: number): void {
    if (Math.hypot(x, y) < minTilt) return;
    const angle = Math.atan2(y, x);
    this.angle = angle;
    if (this.calibration) {
      if (performance.now() > this.calibration.until - sampleTime) {
        this.calibration.sin += Math.sin(angle);
        this.calibration.cos += Math.cos(angle);
      }
      this.steer = 0;
    } else {
      this.center ??= angle;
      this.steer = shape(
        (-wrap(angle - this.center) / fullLock) *
          (sensitivities[this.sensitivity] ?? 1),
      );
    }
    this.send();
  }

  private onTouch(event: TouchEvent): void {
    const onButton = Array.from(event.changedTouches).some(onAButton);
    if (!onButton) event.preventDefault();
    this.advancePedals(performance.now());
    const active = new Set<number>();
    for (const touch of Array.from(event.touches)) {
      active.add(touch.identifier);
      if (this.touches.has(touch.identifier) || onAButton(touch)) continue;
      const pedal = this.pedalAt(this.toLocalX(touch.clientX, touch.clientY));
      if (!pedal) continue;
      this.touches.set(touch.identifier, pedal);
      this.pedals[pedal] = Math.max(
        this.pedals[pedal],
        pedalBite / riseTime[pedal],
      );
    }
    for (const id of this.touches.keys())
      if (!active.has(id)) this.touches.delete(id);
    this.send();
  }

  private pedalAt(x: number): Pedal | null {
    const width = this.root.offsetWidth;
    const brake = this.fills.brake.closest<HTMLElement>(".pedal");
    const gas = this.fills.gas.closest<HTMLElement>(".pedal");
    if (!brake || !gas || width === 0) return null;
    const brakeEdge = (brake.offsetLeft + brake.offsetWidth) / width;
    const gasEdge = gas.offsetLeft / width;
    if (x <= brakeEdge + pedalReach) return "brake";
    if (x >= gasEdge - pedalReach) return "gas";
    return null;
  }

  private advancePedals(now: number): void {
    const dt =
      this.pedalsAt === 0
        ? 0
        : Math.min(maxPedalStep, Math.max(0, (now - this.pedalsAt) / 1000));
    this.pedalsAt = now;
    const held = new Set(this.touches.values());
    for (const pedal of ["gas", "brake"] as const) {
      const step = held.has(pedal)
        ? dt / riseTime[pedal]
        : -dt / fallTime[pedal];
      this.pedals[pedal] = Math.min(1, Math.max(0, this.pedals[pedal] + step));
    }
  }

  private tick(time: number): void {
    this.updateCalibration(time);
    if (performance.now() - this.sentAt >= resendAfter) this.send();
    for (const pedal of ["gas", "brake"] as const)
      this.fills[pedal].style.height = `${String(this.pedals[pedal] * 100)}%`;
    this.wheel.setAttribute(
      "transform",
      `rotate(${String(-this.steer * 90)} 100 100)`,
    );
    requestAnimationFrame((next) => {
      this.tick(next);
    });
  }

  private rotation(): number {
    return wrapDegrees(this.baseAngle - screen.orientation.angle);
  }

  private toLocalX(clientX: number, clientY: number): number {
    const radians = (-this.rotation() * Math.PI) / 180;
    const dx = clientX - window.innerWidth / 2;
    const dy = clientY - window.innerHeight / 2;
    return (
      (dx * Math.cos(radians) - dy * Math.sin(radians)) /
        this.root.offsetWidth +
      0.5
    );
  }

  private layout(): void {
    const rotation = this.rotation();
    const sideways = Math.abs(rotation) === 90;
    this.root.style.width = `${String(sideways ? window.innerHeight : window.innerWidth)}px`;
    this.root.style.height = `${String(sideways ? window.innerWidth : window.innerHeight)}px`;
    this.root.style.transform = `translate(-50%, -50%) rotate(${String(rotation)}deg)`;
  }

  private send(): void {
    const now = performance.now();
    this.advancePedals(now);
    this.sentAt = now;
    this.sequence += 1;
    this.link.send(
      new Float32Array([
        this.steer,
        this.pedals.gas,
        this.pedals.brake,
        this.boostPresses,
        this.ersPresses,
        this.pagePresses,
        this.wingPresses,
        this.tyrePresses,
        this.sequence,
      ]),
    );
  }
}

const startScreen = element("start");
const room = padRoom();
const watchPortrait = () => {
  document.body.classList.toggle(
    "need-landscape",
    !startScreen.hidden && isPortrait(),
  );
};
window.addEventListener("resize", watchPortrait);
window.addEventListener("hashchange", () => {
  location.reload();
});
watchPortrait();
if (!room)
  element("error").textContent =
    "Scan the QR code on the game screen to pair this phone.";
element("go").addEventListener("click", () => {
  if (!room) return;
  new Pad(room)
    .start()
    .then(() => {
      startScreen.hidden = true;
      element("error").textContent = "";
      watchPortrait();
    })
    .catch((error: unknown) => {
      element("error").textContent = playerMessage(
        error,
        "The pad could not start. Reload and tap Start again.",
      );
    });
});
