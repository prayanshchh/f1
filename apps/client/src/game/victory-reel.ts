import type { CameraPose } from "./buildup-shots.ts";
import { carStride, frameIndex } from "./frame-layout.ts";
import { putText } from "./hud-dom.ts";
import type { ReplayTape } from "./replay.ts";
import { type CameraId, ReplayCamera, type Station } from "./replay-camera.ts";

export interface ReelShot {
  tape: ReplayTape;
  title: string;
  detail: string;
  camera: CameraId;
}

export interface Winner {
  first: string;
  last: string;
  team: string;
}

const captionDelay = 0.6;

export class VictoryReel {
  private shots: ReelShot[] = [];
  private index = 0;
  private time = 0;
  private lastWall = 0;
  private playing = false;
  private done: () => void = () => undefined;
  readonly frame = new Float64Array(frameIndex.size);
  readonly cars: Float64Array;
  private readonly view: ReplayCamera;
  private readonly parts: Record<string, HTMLElement> = {};

  constructor(
    private readonly root: HTMLElement,
    stations: Station[],
    trackLength: number,
    carCount: number,
  ) {
    this.cars = new Float64Array(carCount * carStride);
    this.view = new ReplayCamera(stations, trackLength);
    root.innerHTML = `
      <div class="reel-head"><small>Race Winner</small><b data-reel="name"></b><span data-reel="team"></span></div>
      <div class="reel-caption" data-reel="caption"><b data-reel="title"></b><span data-reel="detail"></span></div>
      <div class="reel-dots" data-reel="dots"></div>
      <button type="button" class="reel-skip" data-reel="skip"><kbd>↵</kbd>Skip</button>`;
    root.querySelectorAll<HTMLElement>("[data-reel]").forEach((node) => {
      this.parts[node.dataset["reel"] ?? ""] = node;
    });
    this.part("skip").addEventListener("click", () => {
      this.finish();
    });
    root.hidden = true;
  }

  get active(): boolean {
    return this.playing;
  }

  private part(id: string): HTMLElement {
    const node = this.parts[id];
    if (!node) throw new Error(`victory reel is missing ${id}`);
    return node;
  }

  play(
    shots: ReelShot[],
    winner: Winner,
    wallNow: number,
    done: () => void,
  ): boolean {
    const usable = shots.filter((shot) => !shot.tape.empty);
    if (usable.length === 0) return false;
    this.shots = usable;
    this.done = done;
    this.playing = true;
    this.lastWall = wallNow;
    putText(this.part("name"), `${winner.first} ${winner.last.toUpperCase()}`);
    putText(this.part("team"), winner.team);
    this.part("dots").replaceChildren(
      ...usable.map(() => document.createElement("i")),
    );
    this.root.hidden = false;
    this.cue(0);
    return true;
  }

  key(event: KeyboardEvent, down: boolean): void {
    event.preventDefault();
    if (down && !event.repeat && ["Enter", " ", "Escape"].includes(event.key))
      this.finish();
  }

  private cue(index: number): void {
    const shot = this.shots[index];
    if (!shot) {
      this.finish();
      return;
    }
    this.index = index;
    this.time = shot.tape.start;
    this.view.use(shot.camera);
    this.view.follow(0);
    putText(this.part("title"), shot.title);
    putText(this.part("detail"), shot.detail);
    this.part("caption").classList.remove("on");
    Array.from(this.part("dots").children).forEach((dot, k) => {
      dot.classList.toggle("on", k === index);
    });
  }

  update(wallNow: number): CameraPose | null {
    const shot = this.shots[this.index];
    if (!this.playing || !shot) return null;
    const dt = Math.max(0, Math.min(0.1, wallNow - this.lastWall));
    this.lastWall = wallNow;
    this.time += dt;
    if (this.time > shot.tape.end) {
      this.cue(this.index + 1);
      return this.update(wallNow);
    }
    this.part("caption").classList.toggle(
      "on",
      this.time - shot.tape.start > captionDelay,
    );
    if (!shot.tape.sample(this.time, this.frame, this.cars)) return null;
    return this.view.pose(this.frame, this.cars);
  }

  private finish(): void {
    if (!this.playing) return;
    this.playing = false;
    this.root.hidden = true;
    this.shots = [];
    this.done();
  }
}
