import { el } from "./dom.ts";
import { downloadsFromNow } from "./preload.ts";
import { teamOf } from "./teams.ts";

export function paintTeam(team: string): void {
  document.documentElement.style.setProperty("--team", teamOf(team).brand);
}

export class LoadBar {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;
  private shown = 0;
  private frame = 0;

  constructor(element: HTMLElement = el("div", "load-bar")) {
    this.element = element;
    this.fill = element.querySelector("i") ?? element.appendChild(el("i"));
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
    this.fill.style.transform = `scaleX(${String(this.shown)})`;
    this.element.setAttribute(
      "aria-valuenow",
      String(Math.round(this.shown * 100)),
    );
  }
}
