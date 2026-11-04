import racingLineUrl from "../../../../content/tracks/hill-country/racing-line.json?url";
import { type Engine, frameIndex } from "./engine.ts";
import { hurtOf, Incidents } from "./incidents.ts";
import type { CarStatus } from "./mfd.ts";
import type { PadLink } from "./pad.ts";
import { LineReader, type RacingLineData } from "./racing-line.ts";
import type { PitPhase } from "./pitstop.ts";
import { fetchJson } from "./scene.ts";
import { SlowClock } from "./slow-clock.ts";
import {
  type Action,
  type CourseTurn,
  type Finish,
  type Pedals,
  Tutorial,
  type TutorialSample,
} from "./tutorial.ts";
import { TutorialScreen } from "./tutorial-view.ts";
import type { TyreInfo } from "./tyres.ts";

export interface TutorialHooks {
  root: HTMLElement;
  engine: Engine;
  pad: PadLink;
  menuOpen: () => boolean;
  mfdPage: () => string;
  mute: (muted: boolean) => void;
  finish: (result: Finish) => void;
}

export interface TutorialLive {
  frame: Float64Array;
  surfaces: number[];
  pit: PitPhase;
  boost: boolean;
  status: CarStatus;
  tyres: TyreInfo;
}

export interface TutorialTrack {
  turns: CourseTurn[];
}

type Held = Record<"left" | "right" | "up" | "down", boolean>;

const arrows: Partial<Record<string, keyof Held>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
const keyActions: Partial<Record<string, "confirm" | "skip" | "keyboard">> = {
  Enter: "confirm",
  Escape: "skip",
  k: "keyboard",
  K: "keyboard",
};
const cameraKey = /^(c|C|F[2-9]|F1[01])$/;
const offSurface = 2;
const offWheels = 3;

function typing(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function offTrack(surfaces: number[]): boolean {
  return (
    surfaces.filter((surface) => surface >= offSurface).length >= offWheels
  );
}

function strongest(a: number, b: number): number {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

export class TutorialRun {
  static async load(
    hooks: TutorialHooks,
    track: TutorialTrack,
  ): Promise<TutorialRun> {
    const data = await fetchJson<RacingLineData>(racingLineUrl);
    return new TutorialRun(hooks, data, track);
  }

  private readonly machine: Tutorial;
  private readonly clock = new SlowClock();
  private readonly screen: TutorialScreen;
  private readonly reader: LineReader;
  private readonly length: number;
  private readonly held: Held = {
    left: false,
    right: false,
    up: false,
    down: false,
  };
  private cameras = 0;
  private rewinds = 0;
  private readonly incidents = new Incidents();
  private live: TutorialLive | null = null;
  private muted = false;
  private ended = false;
  private wasHolding = true;

  private constructor(
    private readonly hooks: TutorialHooks,
    data: RacingLineData,
    track: TutorialTrack,
  ) {
    this.length = hooks.engine.trackLength();
    this.reader = new LineReader(
      data.profile,
      data.length,
      data.length / this.length,
    );
    this.machine = new Tutorial({
      length: this.length,
      ...track,
    });
    this.clock.hold();
    this.screen = new TutorialScreen(hooks.root, (action) => {
      this.act(action);
    });
    window.addEventListener(
      "keydown",
      (event) => {
        this.onKey(event, true);
      },
      true,
    );
    window.addEventListener(
      "keyup",
      (event) => {
        this.onKey(event, false);
      },
      true,
    );
    window.addEventListener("blur", () => {
      this.release();
    });
  }

  get holding(): boolean {
    return this.machine.holding;
  }

  get quiet(): boolean {
    return this.machine.frozen;
  }

  get busy(): boolean {
    return this.machine.holding || this.machine.frozen || !this.clock.realTime;
  }

  time(now: number): number {
    this.pace();
    const time = this.clock.time(now);
    if (this.clock.takeResync()) this.hooks.engine.resume(now);
    return time;
  }

  rewindTarget(now: number): number {
    return this.incidents.target(now);
  }

  rewound(): void {
    this.rewinds++;
    this.incidents.rewound();
  }

  replayed(): void {
    this.screen.hidden = true;
  }

  update(now: number, live: TutorialLive): void {
    this.live = live;
    this.incidents.update(
      live.frame[frameIndex.time] ?? 0,
      hurtOf(live.status, live.tyres),
      offTrack(live.surfaces),
      live.status.retired !== 0,
    );
    this.tick(now);
  }

  idle(now: number): void {
    this.tick(now);
  }

  skip(): void {
    this.machine.skip();
    this.end();
  }

  stop(): void {
    this.ended = true;
    this.screen.close();
  }

  private tick(now: number): void {
    const live = this.live;
    if (!live || this.ended) return;
    this.screen.hidden = false;
    const events = this.machine.update(this.sample(now, live));
    this.screen.play(events, now);
    this.screen.render(this.machine.view, now);
    this.muteFrozen();
    this.end();
  }

  private sample(now: number, live: TutorialLive): TutorialSample {
    const value = (index: number) => live.frame[index] ?? 0;
    const distance = value(frameIndex.distFromStart);
    const speed = Math.abs(value(frameIndex.speed));
    const reading = this.reader.read(distance, speed);
    return {
      now,
      input: this.input(now),
      phone: this.hooks.pad.connected,
      travel: (value(frameIndex.laps) - 1) * this.length + distance,
      speed,
      raceTime: value(frameIndex.time),
      cue: reading.cue,
      brakeIn: reading.brakeIn,
      offTrack: offTrack(live.surfaces),
      mfd: this.hooks.mfdPage(),
      cameras: this.cameras,
      rewinds: this.rewinds,
      pit: live.pit,
      boost: live.boost,
      retired: live.status.retired !== 0,
      crashed: this.incidents.crashed,
    };
  }

  private input(now: number): Pedals {
    const keys = this.held;
    const keyboard = {
      steer: Number(keys.left) - Number(keys.right),
      throttle: Number(keys.up),
      brake: Number(keys.down),
    };
    const phone = this.hooks.pad.current(now);
    if (!phone) return keyboard;
    return {
      steer: strongest(phone.steer, keyboard.steer),
      throttle: Math.max(phone.throttle, keyboard.throttle),
      brake: Math.max(phone.brake, keyboard.brake),
    };
  }

  private pace(): void {
    const holding = this.machine.holding;
    if (this.machine.frozen) this.clock.slow();
    else if (!holding) this.clock.run(this.wasHolding);
    this.wasHolding = holding;
  }

  private muteFrozen(): void {
    const quiet = this.machine.frozen;
    if (quiet === this.muted) return;
    this.muted = quiet;
    this.hooks.mute(quiet);
  }

  private end(): void {
    const result = this.machine.finished;
    if (this.ended || !result) return;
    this.stop();
    this.hooks.finish(result);
  }

  private act(action: Action): void {
    if (action === "phone") {
      this.hooks.pad.toggle();
      return;
    }
    if (action === "skip" || action === "keyboard") {
      this.machine.press(action);
      return;
    }
    this.machine.press("confirm");
  }

  private release(): void {
    this.held.left = false;
    this.held.right = false;
    this.held.up = false;
    this.held.down = false;
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const arrow = arrows[event.key];
    const menu = this.hooks.menuOpen();
    if (arrow) {
      this.held[arrow] = down && !menu;
      return;
    }
    if (down && !event.repeat && !menu && !typing(event)) this.command(event);
  }

  private command(event: KeyboardEvent): void {
    if (this.ended) return;
    if (cameraKey.test(event.key) && !event.ctrlKey) {
      this.cameras++;
      return;
    }
    const action = keyActions[event.key];
    if (!action || !this.machine.press(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
