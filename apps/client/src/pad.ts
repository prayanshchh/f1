import "./pad.css";

const fullLock = Math.PI / 4 / 1.3;
const sensitivities = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const defaultSensitivity = sensitivities.indexOf(1);
const sensitivityKey = "f1pad.sensitivity";
const calibrateTime = 3000;
const sampleTime = 1000;
const deadZone = 0.03;
const curve = 1.3;
const gravityTime = 0.04;
const minGravity = 3;
const riseTime: Record<Pedal, number> = { gas: 1.2, brake: 0.8 };
const fallTime: Record<Pedal, number> = { gas: 0.2, brake: 0.15 };

type Pedal = "gas" | "brake";

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

function wrapDegrees(degrees: number): number {
  return Math.round((wrap((degrees * Math.PI) / 180) * 180) / Math.PI);
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

function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
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
  private socket: WebSocket | null = null;
  private gravity: [number, number] = [0, 0];
  private gravityAt = 0;
  private center: number | null = null;
  private calibration: { until: number; sin: number; cos: number } | null =
    null;
  private sensitivity = savedSensitivity();
  private steer = 0;
  private baseAngle = screen.orientation.angle;
  private frameAt = 0;

  async start(): Promise<void> {
    if (isPortrait())
      throw new Error("Turn the phone sideways, then tap Start.");
    await this.requestMotion();
    await this.keepAwake();
    this.baseAngle = screen.orientation.angle;
    await (screen.orientation as unknown as Lockable)
      .lock?.("landscape")
      .catch(() => undefined);
    document.addEventListener("visibilitychange", () => {
      void this.keepAwake();
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
    element("center").addEventListener("click", () => {
      this.calibrate();
    });
    element("less").addEventListener("click", () => {
      this.setSensitivity(this.sensitivity - 1);
    });
    element("more").addEventListener("click", () => {
      this.setSensitivity(this.sensitivity + 1);
    });
    this.setSensitivity(this.sensitivity);
    this.connect();
    this.layout();
    this.calibrate();
    requestAnimationFrame((time) => {
      this.tick(time);
    });
  }

  private async keepAwake(): Promise<void> {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible")
      return;
    await navigator.wakeLock.request("screen").catch(() => undefined);
  }

  private async requestMotion(): Promise<void> {
    const motion = DeviceMotionEvent as unknown as Permissioned;
    if (!motion.requestPermission) return;
    const state = await motion.requestPermission();
    if (state !== "granted")
      throw new Error("Motion access was not allowed. Reload and tap Allow.");
  }

  private connect(): void {
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__pad/ws?role=pad`,
    );
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      this.setLink(true);
    });
    socket.addEventListener("message", (event) => {
      this.onFeedback(event.data);
    });
    socket.addEventListener("close", () => {
      this.setLink(false);
      this.socket = null;
      window.setTimeout(() => {
        this.connect();
      }, 1000);
    });
    this.socket = socket;
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
    if (sin !== 0 || cos !== 0) this.center = Math.atan2(sin, cos);
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

  private setLink(on: boolean): void {
    element("dot").classList.toggle("on", on);
    element("link").textContent = on ? "Live" : "Reconnecting";
  }

  private onFeedback(data: unknown): void {
    if (typeof data !== "string") return;
    const message: unknown = JSON.parse(data);
    if (
      typeof message !== "object" ||
      message === null ||
      !("speed" in message) ||
      !("gear" in message)
    )
      return;
    const gear = Number(message.gear);
    element("speed").textContent = String(Math.round(Number(message.speed)));
    element("gear").textContent =
      gear < 0 ? "R" : gear === 0 ? "N" : String(gear);
  }

  private onMotion(event: DeviceMotionEvent): void {
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
    const [x, y] = this.gravity;
    if (Math.hypot(x, y) < minGravity) return;
    const angle = Math.atan2(y, x);
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
    this.wheel.setAttribute(
      "transform",
      `rotate(${String(-this.steer * 90)} 100 100)`,
    );
  }

  private onTouch(event: TouchEvent): void {
    const onButton = Array.from(event.changedTouches).some(
      (touch) =>
        touch.target instanceof Element && touch.target.closest("button"),
    );
    if (!onButton) event.preventDefault();
    const active = new Set<number>();
    for (const touch of Array.from(event.touches)) {
      active.add(touch.identifier);
      if (this.touches.has(touch.identifier)) continue;
      const pedal = this.pedalAt(this.toLocalX(touch.clientX, touch.clientY));
      if (pedal) this.touches.set(touch.identifier, pedal);
    }
    for (const id of this.touches.keys())
      if (!active.has(id)) this.touches.delete(id);
  }

  private pedalAt(x: number): Pedal | null {
    if (x < 1 / 3) return "brake";
    if (x > 2 / 3) return "gas";
    return null;
  }

  private tick(time: number): void {
    const dt =
      this.frameAt === 0 ? 0 : Math.min(0.1, (time - this.frameAt) / 1000);
    this.frameAt = time;
    this.updateCalibration(time);
    const held = new Set(this.touches.values());
    for (const pedal of ["gas", "brake"] as const) {
      const step = held.has(pedal)
        ? dt / riseTime[pedal]
        : -dt / fallTime[pedal];
      this.pedals[pedal] = Math.min(1, Math.max(0, this.pedals[pedal] + step));
      this.fills[pedal].style.height = `${String(this.pedals[pedal] * 100)}%`;
    }
    this.send();
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
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      new Float32Array([this.steer, this.pedals.gas, this.pedals.brake]),
    );
  }
}

const startScreen = element("start");
const watchPortrait = () => {
  document.body.classList.toggle(
    "need-landscape",
    !startScreen.hidden && isPortrait(),
  );
};
window.addEventListener("resize", watchPortrait);
watchPortrait();
element("go").addEventListener("click", () => {
  new Pad()
    .start()
    .then(() => {
      startScreen.hidden = true;
      element("error").textContent = "";
      watchPortrait();
    })
    .catch((error: unknown) => {
      element("error").textContent =
        error instanceof Error ? error.message : String(error);
    });
});
