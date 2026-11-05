import { revBars } from "./dom.ts";
import { downloadsFromNow } from "./preload.ts";

export class LoadBar {
  readonly element: HTMLElement;
  private readonly bars: HTMLElement[];
  private shown = 0;
  private frame = 0;

  constructor(element: HTMLElement = revBars("loader meter")) {
    this.element = element;
    this.bars = Array.from(element.querySelectorAll<HTMLElement>("i"));
    element.classList.add("meter");
    element.removeAttribute("aria-hidden");
    element.setAttribute("role", "progressbar");
    element.setAttribute("aria-valuemin", "0");
    element.setAttribute("aria-valuemax", "100");
    this.paint();
  }

  set(fraction: number): void {
    this.stop();
    this.advance(fraction);
  }

  reset(): void {
    this.stop();
    this.shown = 0;
    this.paint();
  }

  follow(share: () => number, from = 0, to = 1): void {
    this.stop();
    this.advance(from);
    const step = () => {
      this.advance(from + (to - from) * share());
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  followDownloads(from: number, to: number): void {
    this.follow(downloadsFromNow(), from, to);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  private advance(fraction: number): void {
    this.shown = Math.min(1, Math.max(this.shown, fraction));
    this.paint();
  }

  private paint(): void {
    this.bars.forEach((bar, index) => {
      const fill = this.shown * this.bars.length - index;
      bar.style.setProperty("--fill", String(Math.min(1, Math.max(0, fill))));
    });
    this.element.setAttribute(
      "aria-valuenow",
      String(Math.round(this.shown * 100)),
    );
  }
}
