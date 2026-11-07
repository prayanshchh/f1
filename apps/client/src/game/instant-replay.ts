import type { Engine } from "./engine.ts";
import { frameIndex } from "./frame-layout.ts";
import { HeapHistory } from "./flashback.ts";
import { Highlights, type Pass } from "./highlights.ts";
import type { Hud } from "./hud.ts";
import type { LapTrace, LapTraceState } from "./laptrace.ts";
import { ReplayTape } from "./replay.ts";
import { type Station, trackStations } from "./replay-camera.ts";
import { ReplayView } from "./replay-view.ts";
import type { Scene } from "./scene.ts";
import { type ReelShot, VictoryReel, type Winner } from "./victory-reel.ts";

const finishSeconds = 7;

interface Rewind {
  trace: LapTraceState;
  laps: number;
}

export interface InstantReplayContext {
  engine: Engine;
  scene: Scene;
  hud: Hud;
  trace: LapTrace;
  root: HTMLElement;
  reelRoot: HTMLElement;
  hidden: HTMLElement[];
  names: string[];
  totalLaps: number | null;
  onTrack: () => boolean;
  mute: (muted: boolean) => void;
}

export class InstantReplay {
  readonly tape: ReplayTape;
  readonly stations: Station[];
  private readonly history: HeapHistory<Rewind>;
  private readonly view: ReplayView;
  private readonly highlights: Highlights;
  private readonly reel: VictoryReel;
  private simTime = -Infinity;

  constructor(private readonly ctx: InstantReplayContext) {
    const { engine } = ctx;
    engine.cars();
    engine.carsDamage();
    engine.carsTyres();
    engine.passes(0);
    this.tape = new ReplayTape(engine.carCount);
    this.history = new HeapHistory(() => engine.heap());
    this.highlights = new Highlights(0, (from, to) => this.tape.copy(from, to));
    const length = engine.trackLength();
    const point = (d: number, l: number) =>
      engine.trackPoint(((d % length) + length) % length, l);
    const stations = trackStations(length, point, (d, side) => {
      const [x, y] = point(d, 0);
      const barrier = engine.barriers(x, y);
      const k = side > 0 ? 0 : 4;
      return (barrier[k + 3] ?? -1) < 0 ? Infinity : (barrier[k] ?? Infinity);
    });
    this.stations = stations;
    this.reel = new VictoryReel(
      ctx.reelRoot,
      stations,
      length,
      engine.carCount,
    );
    this.view = new ReplayView(
      ctx.root,
      this.tape,
      stations,
      length,
      ctx.names,
      {
        flashbackRange: () => this.range(),
        flashback: (time) => this.flashback(time),
        resume: () => {
          this.leave();
        },
        lapAt: (lap) => this.lapLabel(lap),
      },
    );
  }

  get active(): boolean {
    return this.view.active || this.reel.active;
  }

  record(frame: Float64Array, cars: Float64Array | null): void {
    const time = frame[frameIndex.time] ?? 0;
    const dt = Number.isFinite(this.simTime)
      ? Math.max(0, time - this.simTime)
      : 0;
    this.simTime = time;
    const { engine, trace, hud } = this.ctx;
    this.tape.record(frame, cars ?? engine.cars());
    const { total, list } = engine.passes(this.highlights.from);
    this.highlights.update(time, total, list);
    this.history.tick(
      time,
      dt,
      () => ({ trace: trace.save(), laps: hud.laps.length }),
      this.ctx.onTrack(),
    );
  }

  open(now: number): void {
    if (this.view.active || !this.view.show(now)) return;
    this.ctx.mute(true);
    for (const node of this.ctx.hidden) node.hidden = true;
  }

  jumpBack(time: number): boolean {
    return !this.view.active && this.flashback(time);
  }

  key(event: KeyboardEvent, down: boolean): void {
    if (this.reel.active) this.reel.key(event, down);
    else this.view.key(event, down);
  }

  frame(now: number): void {
    const source = this.reel.active ? this.reel : this.view;
    const pose = source.update(now);
    if (!pose) return;
    const { scene } = this.ctx;
    scene.setCinematic(pose);
    scene.update(source.frame);
    scene.updateField(source.cars);
  }

  celebrate(winner: Winner, done: () => void): boolean {
    const shots: ReelShot[] = this.highlights.reel().map((clip) => ({
      tape: clip.tape,
      title: this.lapLabel(clip.passes[0]?.lap ?? 1),
      detail: this.passCaption(clip.passes),
      camera: "tv",
    }));
    shots.push({
      tape: this.tape.copy(this.tape.end - finishSeconds, this.tape.end),
      title: this.lapLabel(this.ctx.totalLaps ?? 1),
      detail: "Takes the chequered flag",
      camera: "chase",
    });
    const { scene } = this.ctx;
    const started = this.reel.play(
      shots,
      winner,
      performance.now() / 1000,
      () => {
        scene.atmosphere.detail = false;
        scene.setCinematic(null);
        for (const node of this.ctx.hidden) node.hidden = false;
        done();
      },
    );
    if (!started) return false;
    scene.atmosphere.detail = true;
    for (const node of this.ctx.hidden) node.hidden = true;
    return true;
  }

  private passCaption(passes: Pass[]): string {
    const names = [
      ...new Set(passes.map((pass) => this.ctx.names[pass.passed] ?? "")),
    ];
    const who =
      names.length > 2 ? `${String(names.length)} cars` : names.join(" and ");
    const position = Math.min(...passes.map((pass) => pass.position));
    return position === 1
      ? `Takes the lead from ${who}`
      : `Passes ${who} for P${String(position)}`;
  }

  private range(): [number, number] | null {
    if (!this.ctx.onTrack()) return null;
    const usable = this.history.usable();
    const first = usable[0];
    const last = usable[usable.length - 1];
    return first && last ? [first.time, last.time] : null;
  }

  private flashback(time: number): boolean {
    if (!this.ctx.onTrack()) return false;
    const moment = this.history.rewind(time, this.simTime);
    if (!moment) return false;
    const rewound = this.simTime - moment.time;
    const { trace, hud } = this.ctx;
    trace.load(moment.extra.trace);
    hud.rewindLaps(moment.extra.laps);
    this.tape.cut(moment.time);
    this.ctx.scene.cutDebris(moment.time);
    this.simTime = moment.time;
    this.leave();
    hud.notify(
      "Flashback",
      `Rewound ${rewound.toFixed(1)} s`,
      performance.now() / 1000,
    );
    return true;
  }

  private leave(): void {
    const { engine, scene } = this.ctx;
    engine.resync(performance.now() / 1000);
    scene.setCinematic(null);
    for (const node of this.ctx.hidden) node.hidden = false;
    this.ctx.mute(false);
  }

  private lapLabel(lap: number): string {
    const total = this.ctx.totalLaps;
    const shown = Math.max(1, total ? Math.min(lap, total) : lap);
    return total
      ? `Lap ${String(shown)} / ${String(total)}`
      : `Lap ${String(shown)}`;
  }
}
