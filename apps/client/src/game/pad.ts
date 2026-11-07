import { renderSVG } from "uqr";
import {
  controlChannel,
  delay,
  gathered,
  inputChannel,
  type PadOffer,
  peerConfig,
  postAnswer,
  waitOffers,
} from "../pad-signal.ts";
import { padAddress, phoneSite } from "./pad-address.ts";

const staleAfter = 0.6;
const feedbackInterval = 0.1;
const connectTimeout = 15_000;
const listenRetry = 2000;
const releaseDelay = 500;
const lostAfter = 3000;
const roomKey = "revracers.padRoom";
const roomPattern = /^[A-Za-z0-9_-]{22}$/;
const inputBytes = 36;
const packetFloats = 11;
const siteRetry = 1500;
const siteTries = 80;
const openingNote = "Opening a secure link for your phone…";

export interface PadInput {
  steer: number;
  throttle: number;
  brake: number;
}

interface PadFeedback {
  speed: number;
  gear: number;
  rumble: number;
  battery: number;
  mode: string;
  boost: boolean;
}

export interface PadCommands {
  boost: number;
  ers: number;
  page: number;
  wing: number;
  tyre: number;
}

interface Phone {
  pc: RTCPeerConnection;
  control: RTCDataChannel | null;
}

const idle: PadInput = { steer: 0, throttle: 0, brake: 0 };
const commandNames = ["boost", "ers", "page", "wing", "tyre"] as const;

function newRoom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function padRoom(): string {
  const saved = sessionStorage.getItem(roomKey);
  if (saved && roomPattern.test(saved)) return saved;
  const room = newRoom();
  sessionStorage.setItem(roomKey, room);
  return room;
}

export class PadLink {
  private readonly room = padRoom();
  private phone: Phone | null = null;
  private input: PadInput = idle;
  private steering: number | null = null;
  private centered: number | null = null;
  private readonly totals: PadCommands = {
    boost: 0,
    ers: 0,
    page: 0,
    wing: 0,
    tyre: 0,
  };
  private counters: number[] | null = null;
  private sequence = -1;
  private receivedAt = -Infinity;
  private sentAt = -Infinity;
  private seen = 0;
  private linked = false;
  private listening: AbortController | null = null;

  constructor(
    private readonly panel: HTMLElement,
    private readonly badge: HTMLElement,
  ) {
    void this.showCode();
    window.addEventListener("pagehide", () => {
      this.phone?.pc.close();
    });
    this.updateListening();
  }

  toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    this.updateListening();
  }

  close(): void {
    this.panel.hidden = true;
    this.updateListening();
  }

  get connected(): boolean {
    return this.linked;
  }

  get sensitivity(): number | null {
    return this.phone ? this.steering : null;
  }

  get centers(): number | null {
    return this.phone ? this.centered : null;
  }

  get panelOpen(): boolean {
    return !this.panel.hidden;
  }

  current(now: number): PadInput | null {
    return this.phone && now - this.receivedAt < staleAfter ? this.input : null;
  }

  pressed(): PadCommands {
    return { ...this.totals };
  }

  feedback(now: number, state: PadFeedback): void {
    const control = this.phone?.control;
    if (now - this.sentAt < feedbackInterval || control?.readyState !== "open")
      return;
    this.sentAt = now;
    control.send(JSON.stringify(state));
  }

  private updateListening(): void {
    const wanted = !this.phone || !this.panel.hidden;
    if (wanted && !this.listening) {
      this.listening = new AbortController();
      void this.listen(this.listening.signal);
    } else if (!wanted && this.listening) {
      this.listening.abort();
      this.listening = null;
    }
  }

  private async listen(signal: AbortSignal): Promise<void> {
    for (;;) {
      const offers = await waitOffers(this.room, this.seen, signal).catch(
        () => null,
      );
      if (signal.aborted) return;
      if (!offers) {
        await delay(listenRetry);
        continue;
      }
      for (const offer of offers) {
        this.seen = Math.max(this.seen, offer.seq);
        void this.accept(offer).catch(() => undefined);
      }
    }
  }

  private async accept(offer: PadOffer): Promise<void> {
    const pc = new RTCPeerConnection(peerConfig);
    const phone: Phone = { pc, control: null };
    pc.addEventListener("datachannel", (event) => {
      this.attach(phone, event.channel);
    });
    let lostTimer = 0;
    pc.addEventListener("connectionstatechange", () => {
      window.clearTimeout(lostTimer);
      if (pc.connectionState === "failed") this.drop(phone);
      else if (pc.connectionState === "disconnected")
        lostTimer = window.setTimeout(() => {
          this.drop(phone);
        }, lostAfter);
    });
    window.setTimeout(() => {
      if (this.phone !== phone && pc.connectionState !== "connected")
        pc.close();
    }, connectTimeout);
    await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    if (!(await postAnswer(this.room, offer.id, await gathered(pc))))
      pc.close();
  }

  private attach(phone: Phone, channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("close", () => {
      this.drop(phone);
    });
    if (channel.label === controlChannel) {
      phone.control = channel;
      return;
    }
    if (channel.label !== inputChannel) return;
    channel.addEventListener("message", (event) => {
      if (this.phone === phone) this.receive(event.data);
    });
    channel.addEventListener("open", () => {
      this.activate(phone);
    });
    if (channel.readyState === "open") this.activate(phone);
  }

  private activate(phone: Phone): void {
    if (this.phone === phone) return;
    const old = this.phone;
    this.phone = phone;
    this.input = idle;
    this.steering = null;
    this.centered = null;
    this.counters = null;
    this.sequence = -1;
    this.receivedAt = -Infinity;
    this.setConnected(true);
    if (old) this.replace(old);
  }

  private replace(phone: Phone): void {
    if (phone.control?.readyState === "open")
      phone.control.send(JSON.stringify({ replaced: true }));
    window.setTimeout(() => {
      phone.pc.close();
    }, releaseDelay);
  }

  private drop(phone: Phone): void {
    if (this.phone === phone) {
      this.phone = null;
      this.input = idle;
      this.steering = null;
      this.centered = null;
      this.receivedAt = -Infinity;
      this.setConnected(false);
    }
    phone.pc.close();
  }

  private receive(data: unknown): void {
    if (!(data instanceof ArrayBuffer) || data.byteLength < inputBytes) return;
    const floats = Math.min(packetFloats, Math.floor(data.byteLength / 4));
    const values = Array.from(new Float32Array(data, 0, floats));
    const value = (i: number) => values[i] ?? 0;
    if (value(8) <= this.sequence) return;
    this.sequence = value(8);
    this.input = { steer: value(0), throttle: value(1), brake: value(2) };
    this.steering = values[9] ?? null;
    this.centered = values[10] ?? null;
    this.count(values.slice(3, 8));
    this.receivedAt = performance.now() / 1000;
  }

  private count(next: number[]): void {
    const last = this.counters;
    this.counters = next.map((value, i) =>
      Math.max(value, last?.[i] ?? -Infinity),
    );
    if (!last) return;
    commandNames.forEach((name, i) => {
      const pressed = (next[i] ?? 0) - (last[i] ?? 0);
      if (pressed > 0) this.totals[name] += pressed;
    });
  }

  private setConnected(on: boolean): void {
    this.linked = on;
    this.badge.hidden = !on;
    if (on) this.panel.hidden = true;
    this.updateListening();
  }

  private async showCode(): Promise<void> {
    for (let attempt = 0; attempt < siteTries; attempt++) {
      const site = await phoneSite();
      const url = padAddress(location.origin, site, this.room);
      if (url) {
        this.paintCode(url, url);
        return;
      }
      this.paintCode(null, site?.problem ?? openingNote);
      if (site?.problem) return;
      await delay(siteRetry);
    }
  }

  private paintCode(url: string | null, caption: string): void {
    const qr = this.panel.querySelector<HTMLElement>("[data-pad=pad-qr]");
    const text = this.panel.querySelector<HTMLElement>("[data-pad=pad-url]");
    const code = this.panel.querySelector<HTMLElement>("[data-pad=pad-code]");
    code?.classList.toggle("waiting", !url);
    if (qr) qr.innerHTML = url ? renderSVG(url, { border: 2 }) : "";
    if (text) text.textContent = caption;
  }
}
