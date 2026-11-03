import type { CameraPose } from "./buildup-shots.ts";
import { carField, carStride, frameIndex } from "./frame-layout.ts";
import { putData, putStyle, putText } from "./hud-dom.ts";
import type { ReplayTape } from "./replay.ts";
import { ReplayCamera, type Station } from "./replay-camera.ts";

const openBefore = 8;
const shuttle = 4;
const slowRate = 0.25;

export interface ReplayHooks {
  flashbackRange(): [number, number] | null;
  flashback(time: number): boolean;
  resume(): void;
  lapAt(lap: number): string;
}

export class ReplayView {
  private time = 0;
  private playing = true;
  private slow = false;
  private hold = 0;
  private lastWall = 0;
  private open = false;
  readonly frame = new Float64Array(frameIndex.size);
  readonly cars: Float64Array;
  private readonly parts: Record<string, HTMLElement> = {};
  private readonly view: ReplayCamera;

  constructor(
    private readonly root: HTMLElement,
    private readonly tape: ReplayTape,
    stations: Station[],
    trackLength: number,
    private readonly names: string[],
    private readonly hooks: ReplayHooks,
  ) {
    this.cars = new Float64Array(tape.carCount * carStride);
    this.view = new ReplayCamera(stations, trackLength);
    root.innerHTML = `
      <div class="replay-badge"><i></i>Replay</div>
      <div class="replay-tag"><b data-replay="lap"></b><span data-replay="ago"></span></div>
      <div class="replay-bar">
        <div class="replay-track" data-replay="track">
          <div class="replay-zone" data-replay="zone"></div>
          <div class="replay-fill" data-replay="fill"></div>
          <div class="replay-head" data-replay="head"></div>
        </div>
        <div class="replay-controls">
          <button type="button" data-replay="back"><kbd>←</kbd>Rewind</button>
          <button type="button" data-replay="play"><kbd>Space</kbd><span data-replay="play-label">Pause</span></button>
          <button type="button" data-replay="forward"><kbd>→</kbd>Forward</button>
          <button type="button" data-replay="slow"><kbd>S</kbd><span data-replay="speed">1×</span></button>
          <button type="button" data-replay="camera"><kbd>C</kbd><span data-replay="camera-label"></span></button>
          <button type="button" data-replay="car"><kbd>↑↓</kbd><span data-replay="car-label"></span></button>
          <button type="button" class="flash" data-replay="flash"><kbd>F</kbd>Flashback</button>
          <button type="button" data-replay="exit"><kbd>Esc</kbd>Resume</button>
        </div>
      </div>`;
    root.querySelectorAll<HTMLElement>("[data-replay]").forEach((node) => {
      this.parts[node.dataset["replay"] ?? ""] = node;
    });
    this.bindButtons();
    root.hidden = true;
  }

  get active(): boolean {
    return this.open;
  }

  private part(id: string): HTMLElement {
    const node = this.parts[id];
    if (!node) throw new Error(`replay overlay is missing ${id}`);
    return node;
  }

  private bindButtons(): void {
    const click = (id: string, run: () => void) => {
      this.part(id).addEventListener("click", run);
    };
    click("back", () => {
      this.seek(this.time - 5);
    });
    click("forward", () => {
      this.seek(this.time + 5);
    });
    click("play", () => {
      this.playing = !this.playing;
    });
    click("slow", () => {
      this.slow = !this.slow;
    });
    click("camera", () => {
      this.nextCamera();
    });
    click("car", () => {
      this.nextCar(1);
    });
    click("flash", () => {
      this.flashback();
    });
    click("exit", () => {
      this.close(true);
    });
    this.part("track").addEventListener("pointerdown", (event) => {
      const box = this.part("track").getBoundingClientRect();
      const share = (event.clientX - box.left) / Math.max(1, box.width);
      this.seek(this.tape.start + share * (this.tape.end - this.tape.start));
    });
  }

  show(wallNow: number): boolean {
    if (this.tape.empty) return false;
    this.open = true;
    this.time = Math.max(this.tape.start, this.tape.end - openBefore);
    this.playing = true;
    this.slow = false;
    this.hold = 0;
    this.view.follow(0);
    this.lastWall = wallNow;
    this.root.hidden = false;
    return true;
  }

  close(resume: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    if (resume) this.hooks.resume();
  }

  private seek(time: number): void {
    this.time = Math.max(this.tape.start, Math.min(this.tape.end, time));
    this.view.cut();
  }

  private nextCamera(): void {
    this.view.next();
  }

  private nextCar(step: number): void {
    const count = this.tape.carCount;
    for (let k = 1; k <= count; k++) {
      const candidate = (this.view.target + step * k + count * k) % count;
      if ((this.cars[candidate * carStride + carField.visible] ?? 0) !== 0) {
        this.view.follow(candidate);
        return;
      }
    }
  }

  private flashback(): void {
    if (this.hooks.flashback(this.time)) this.close(false);
  }

  key(event: KeyboardEvent, down: boolean): void {
    event.preventDefault();
    const key = event.key.toLowerCase();
    if (key === "arrowleft" || key === "arrowright") {
      const sign = key === "arrowleft" ? -1 : 1;
      this.hold = down ? sign : this.hold === sign ? 0 : this.hold;
      return;
    }
    if (!down || event.repeat) return;
    const actions: Record<string, () => void> = {
      " ": () => {
        this.playing = !this.playing;
      },
      s: () => {
        this.slow = !this.slow;
      },
      c: () => {
        this.nextCamera();
      },
      arrowup: () => {
        this.nextCar(-1);
      },
      arrowdown: () => {
        this.nextCar(1);
      },
      f: () => {
        this.flashback();
      },
      escape: () => {
        this.close(true);
      },
      r: () => {
        this.close(true);
      },
    };
    actions[key]?.();
  }

  update(wallNow: number): CameraPose | null {
    const dt = Math.max(0, Math.min(0.1, wallNow - this.lastWall));
    this.lastWall = wallNow;
    const rate = this.hold !== 0 ? this.hold * shuttle : this.playing ? 1 : 0;
    this.time += dt * rate * (this.slow && this.hold === 0 ? slowRate : 1);
    if (this.time >= this.tape.end) {
      this.time = this.tape.end;
      if (this.hold === 0) this.playing = false;
    }
    this.time = Math.max(this.tape.start, this.time);
    if (!this.tape.sample(this.time, this.frame, this.cars)) return null;
    this.updateOverlay();
    return this.view.pose(this.frame, this.cars);
  }

  private updateOverlay(): void {
    this.updateTimeline();
    putText(
      this.part("lap"),
      this.hooks.lapAt(this.frame[frameIndex.laps] ?? 0),
    );
    const ago = this.tape.end - this.time;
    putText(this.part("ago"), ago < 0.05 ? "Live" : `-${ago.toFixed(1)} s`);
    putText(this.part("play-label"), this.playing ? "Pause" : "Play");
    putText(this.part("speed"), this.slow ? "¼×" : "1×");
    putText(this.part("camera-label"), this.view.label);
    putText(this.part("car-label"), this.names[this.view.target] ?? "");
  }

  private updateTimeline(): void {
    const span = Math.max(1e-3, this.tape.end - this.tape.start);
    const share = (t: number) =>
      `${String(((t - this.tape.start) / span) * 100)}%`;
    putStyle(this.part("head"), "left", share(this.time));
    putStyle(this.part("fill"), "width", share(this.time));
    const zone = this.hooks.flashbackRange();
    const zoneNode = this.part("zone");
    putStyle(zoneNode, "left", zone ? share(zone[0]) : "0%");
    putStyle(
      zoneNode,
      "width",
      zone ? `${String(((zone[1] - zone[0]) / span) * 100)}%` : "0%",
    );
    const canFlash = zone !== null && this.time >= zone[0] - 0.5;
    putData(this.part("flash"), "ready", canFlash ? "yes" : "no");
  }
}
