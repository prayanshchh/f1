import { renderSVG } from "uqr";

const staleAfter = 0.25;
const feedbackInterval = 0.1;

export interface PadInput {
  steer: number;
  throttle: number;
  brake: number;
}

interface PadInfo {
  padUrl: string;
  setupUrl: string;
}

function isPadInfo(value: unknown): value is PadInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "padUrl" in value &&
    "setupUrl" in value
  );
}

export class PadLink {
  private socket: WebSocket | null = null;
  private input: PadInput = { steer: 0, throttle: 0, brake: 0 };
  private receivedAt = -Infinity;
  private sentAt = -Infinity;

  constructor(
    private readonly panel: HTMLElement,
    private readonly badge: HTMLElement,
  ) {
    this.connect();
    void this.loadInfo();
  }

  toggle(): void {
    this.panel.hidden = !this.panel.hidden;
  }

  current(now: number): PadInput | null {
    return now - this.receivedAt < staleAfter ? this.input : null;
  }

  feedback(now: number, speed: number, gear: number): void {
    if (
      now - this.sentAt < feedbackInterval ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    this.sentAt = now;
    this.socket.send(JSON.stringify({ speed, gear }));
  }

  private connect(): void {
    const socket = new WebSocket(`ws://${location.host}/__pad/ws?role=game`);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => {
      this.receive(event.data);
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      this.setPads(0);
      window.setTimeout(() => {
        this.connect();
      }, 2000);
    });
    this.socket = socket;
  }

  private receive(data: unknown): void {
    if (data instanceof ArrayBuffer) this.receiveInput(data);
    else if (typeof data === "string") this.receiveStatus(data);
  }

  private receiveInput(data: ArrayBuffer): void {
    if (data.byteLength < 12) return;
    const [steer = 0, throttle = 0, brake = 0] = new Float32Array(data, 0, 3);
    this.input = { steer, throttle, brake };
    this.receivedAt = performance.now() / 1000;
  }

  private receiveStatus(data: string): void {
    const message: unknown = JSON.parse(data);
    if (
      typeof message === "object" &&
      message !== null &&
      "pads" in message &&
      typeof message.pads === "number"
    )
      this.setPads(message.pads);
  }

  private setPads(count: number): void {
    this.badge.hidden = count === 0;
    if (count > 0) this.panel.hidden = true;
  }

  private async loadInfo(): Promise<void> {
    const response = await fetch("/__pad/info");
    const info: unknown = await response.json();
    if (!isPadInfo(info)) return;
    this.fill("pad", info.padUrl);
    this.fill("setup", info.setupUrl);
  }

  private fill(name: string, url: string): void {
    const qr = this.panel.querySelector<HTMLElement>(`[data-pad=${name}-qr]`);
    const text = this.panel.querySelector<HTMLElement>(
      `[data-pad=${name}-url]`,
    );
    if (qr) qr.innerHTML = renderSVG(url, { border: 2 });
    if (text) text.textContent = url;
  }
}
