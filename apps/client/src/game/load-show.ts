import { downloadTotals } from "./preload.ts";

const slideMs = 12_000;
const fadeMs = 1_600;
const tickMs = 200;
const slideCount = 13;
const megabyte = 1_000_000;

const loadSlides = Array.from(
  { length: slideCount },
  (_, index) => `/loading/${String(index + 1).padStart(2, "0")}.jpg`,
);

export interface Soundtrack {
  readonly blocked: boolean;
  start(): void;
}

function size(bytes: number): string {
  if (bytes >= 1000 * megabyte)
    return `${(bytes / (1000 * megabyte)).toFixed(2)} GB`;
  return `${(bytes / megabyte).toFixed(1)} MB`;
}

export class LoadShow {
  private armed = false;
  private showing = false;
  private slide = -1;
  private shown = 0;
  private slideTimer = 0;
  private tickTimer = 0;
  private readonly frames: HTMLImageElement[];
  private readonly bytes: HTMLElement | null;
  private readonly line: HTMLElement | null;
  private readonly fill: HTMLElement | null;
  private readonly sound: HTMLElement | null;
  private readonly watcher: MutationObserver;
  private soundtrack: Soundtrack | null = null;

  constructor(private readonly root: HTMLElement) {
    this.frames = Array.from(
      root.querySelectorAll<HTMLImageElement>("[data-show-slide]"),
    );
    this.bytes = root.querySelector("[data-show-bytes]");
    this.line = root.querySelector("[data-show-line]");
    this.fill = this.line?.querySelector("i") ?? null;
    this.sound = root.querySelector("[data-show-sound]");
    this.watcher = new MutationObserver(() => {
      this.sync();
    });
  }

  attach(soundtrack: Soundtrack): void {
    this.soundtrack = soundtrack;
    if (this.showing) soundtrack.start();
  }

  arm(): void {
    if (this.armed) return;
    this.armed = true;
    this.watcher.observe(this.root, { attributeFilter: ["hidden"] });
    this.watcher.observe(document.body, {
      attributeFilter: ["data-drive-status"],
    });
    this.sync();
  }

  private sync(): void {
    if (!this.armed) return;
    if (this.root.hidden || document.body.dataset["driveStatus"] === "error")
      this.end();
    else this.begin();
  }

  private begin(): void {
    if (this.showing) return;
    this.showing = true;
    this.root.classList.add("showing");
    this.soundtrack?.start();
    this.next();
    this.slideTimer = window.setInterval(() => {
      this.next();
    }, slideMs);
    this.tick();
    this.tickTimer = window.setInterval(() => {
      this.tick();
    }, tickMs);
  }

  private end(): void {
    if (!this.showing) return;
    this.showing = false;
    window.clearInterval(this.slideTimer);
    window.clearInterval(this.tickTimer);
    this.root.classList.remove("showing");
    this.paint(1);
  }

  private next(): void {
    this.slide = (this.slide + 1) % loadSlides.length;
    const frame = this.frames.find((each) => !each.classList.contains("on"));
    const wanted = loadSlides[this.slide];
    if (!frame || !wanted) return;
    if (!frame.src.endsWith(wanted)) frame.src = wanted;
    if (frame.complete && frame.naturalWidth > 0) this.reveal(frame);
    else
      frame.onload = () => {
        this.reveal(frame);
      };
  }

  private reveal(frame: HTMLImageElement): void {
    frame.onload = null;
    if (!this.showing) return;
    const other = this.frames.find((each) => each !== frame);
    frame.classList.add("on");
    other?.classList.remove("on");
    window.setTimeout(() => {
      const upcoming = loadSlides[(this.slide + 1) % loadSlides.length];
      if (other && upcoming && !other.classList.contains("on"))
        other.src = upcoming;
    }, fadeMs);
  }

  private tick(): void {
    const { received, expected, planned } = downloadTotals();
    if (this.sound) this.sound.hidden = this.soundtrack?.blocked !== true;
    if (!planned || expected <= 0 || !this.bytes) return;
    const done = Math.min(received, expected);
    this.paint(done / expected);
    this.bytes.textContent = `${size(done)} / ${size(expected)} · ${String(Math.floor(this.shown * 100))}%`;
  }

  private paint(fraction: number): void {
    this.shown = Math.min(1, Math.max(this.shown, fraction));
    this.fill?.style.setProperty("--fill", String(this.shown));
    this.line?.setAttribute(
      "aria-valuenow",
      String(Math.round(this.shown * 100)),
    );
  }
}
