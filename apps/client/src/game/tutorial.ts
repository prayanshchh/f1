import { mfdPages } from "./mfd.ts";
import type { PitPhase } from "./pitstop.ts";
import type { Cue } from "./racing-line.ts";
import type { Turn } from "./stewards.ts";

type Control = "keyboard" | "phone";
type Mode = "modal" | "banner" | "freeze" | "pause";
export type Spot =
  | "mfd"
  | "battery"
  | "phone-key"
  | "menu-tabs"
  | "menu-main"
  | "menu-replay"
  | "menu-restart"
  | "menu-quit"
  | "menu-resume";
export type Command = "pause" | "panel";
export type Widget =
  "controls" | "legend" | "pad-center" | "pad-sensitivity" | "pad-boost";
export type Finish = "done" | "skipped";

export interface Pedals {
  steer: number;
  throttle: number;
  brake: number;
}

export interface TutorialSample {
  now: number;
  input: Pedals;
  phone: boolean;
  travel: number;
  speed: number;
  raceTime: number;
  cue: Cue["kind"];
  brakeIn: number | null;
  offTrack: boolean;
  mfd: string;
  cameras: number;
  rewinds: number;
  pit: PitPhase;
  boost: boolean;
  retired: boolean;
  crashed: boolean;
  gear: number;
  menu: boolean;
  panel: boolean;
  sensitivity: number | null;
  centers: number | null;
}

export interface Card {
  title: string;
  body: string;
  widget: Widget | null;
  spot: Spot | null;
  compact: boolean;
  low: boolean;
  high: boolean;
}

interface Check {
  label: string;
  done: boolean;
}

export interface TutorialView {
  id: string;
  mode: Mode;
  card: Card | null;
  control: Control;
  coach: Cue["kind"] | null;
  alert: Card | null;
  checks: Check[];
  input: Pedals;
  sensitivity: number | null;
}

export type TutorialEvent =
  | { kind: "tick" }
  | { kind: "rewind" }
  | { kind: "alert" }
  | { kind: "command"; command: Command }
  | { kind: "slow"; speed: number };

export type CourseTurn = Turn & { side?: string };

export interface Course {
  length: number;
  turns: CourseTurn[];
}

const reaction = 0.12;
const slowLead = 0.25;
const steerHold = 0.25;
const offTrackDelay = 0.5;
const backOnTrack = 1;
const stuckDelay = 3;
const stuckSpeed = 2;
const damageShown = 8;
const reverseLead = 30;
const reverseTime = 5;
const reverseMoving = 0.3;
const carCameras = 6;
const reads = {
  welcome: 3,
  line: 5,
  reverse: 4,
  center: 5,
  steering: 5,
  pause: 2,
  finish: 2,
} as const;
const tourRead = 1.5;
const resumeSpeed = 25 / 3.6;
const rewindSpeed = 15 / 3.6;
const phoneReads = {
  phone: 4,
  code: 8,
} as const;

export function freezeDistance(speed: number): number {
  return 4 + speed * (reaction + slowLead);
}

function coachLead(speed: number): number {
  return 6 + speed * 0.6;
}

interface Context {
  control: Control;
  chosen: boolean;
  commanded: boolean;
  age: number;
  startCameras: number;
  startSensitivity: number | null;
  startCenters: number | null;
  seenMfd: Set<string>;
  checks: Record<string, boolean>;
  heldSince: number | null;
  rewinds: number;
  reversed: number;
  reverseAt: number | null;
}

interface Step {
  id: string;
  mode: Mode;
  hold?: boolean;
  from?: number;
  to?: number;
  passive?: boolean;
  minTime?: number;
  coach?: boolean;
  calm?: boolean;
  tour?: boolean;
  command?: Command;
  auto?: { after: number; everyone?: boolean };
  skip?: (s: TutorialSample, c: Context) => boolean;
  card?: (s: TutorialSample, c: Context) => Card;
  done: (s: TutorialSample, c: Context) => boolean;
  leave?: (s: TutorialSample, c: Context) => void;
}

function card(title: string, body: string, extra: Partial<Card> = {}): Card {
  return {
    title,
    body,
    widget: null,
    spot: null,
    compact: false,
    low: false,
    high: false,
    ...extra,
  };
}

function glance(title: string): Card {
  return card(title, "", { compact: true });
}

function by(c: Context, keyboard: string, phone: string): string {
  return c.control === "phone" ? phone : keyboard;
}

function holdFor(s: TutorialSample, c: Context, wanted: boolean): boolean {
  if (!wanted) {
    c.heldSince = null;
    return false;
  }
  c.heldSince ??= s.now;
  return s.now - c.heldSince >= steerHold;
}

function nearBrake(s: TutorialSample, lead = freezeDistance): boolean {
  return s.brakeIn !== null && s.brakeIn <= lead(s.speed);
}

function after(seconds: number) {
  return (_s: TutorialSample, c: Context) => c.age >= seconds;
}

function welcomeSteps(): Step[] {
  return [
    {
      id: "welcome",
      mode: "modal",
      hold: true,
      card: () =>
        card(
          "Driving School",
          "One lap to learn the basics. Press Esc to skip.",
        ),
      done: after(reads.welcome),
    },
    {
      id: "controls",
      mode: "modal",
      hold: true,
      card: (s) =>
        card(
          "Phone or keyboard?",
          s.phone
            ? "Phone connected."
            : "Press P to use your phone, or K for the keyboard.",
        ),
      done: (s, c) => s.phone || c.chosen,
      leave: (s, c) => {
        c.control = s.phone ? "phone" : "keyboard";
      },
    },
  ];
}

function check(
  id: string,
  action: "left" | "right" | "brake" | "gas",
  words: [title: string, keyboard: string, phone: string],
  held: (s: TutorialSample) => boolean,
): Step {
  const [title, keyboard, phone] = words;
  return {
    id,
    mode: "modal",
    hold: true,
    card: (_s, c) =>
      card(title, by(c, keyboard, phone), { widget: "controls" }),
    done: (s, c) => holdFor(s, c, held(s)),
    leave: (_s, c) => {
      c.checks[action] = true;
    },
  };
}

function steeringSteps(): Step[] {
  return [
    check(
      "steer-left",
      "left",
      ["Steer left", "Hold ←", "Tilt left"],
      (s) => s.input.steer >= 0.5,
    ),
    check(
      "steer-right",
      "right",
      ["Steer right", "Hold →", "Tilt right"],
      (s) => s.input.steer <= -0.5,
    ),
    check(
      "brake-pedal",
      "brake",
      ["Brake", "Hold ↓", "Hold Brake"],
      (s) => s.input.brake >= 0.8,
    ),
    check(
      "gas-pedal",
      "gas",
      ["Accelerate", "Hold ↑", "Hold Gas"],
      (s) => s.input.throttle >= 0.8,
    ),
    ...padSteps(),
    {
      id: "lights-wait",
      mode: "banner",
      card: (s) => glance(s.input.throttle > 0.3 ? "Not yet!" : "Wait for it…"),
      done: (s) => s.raceTime >= 0,
    },
    {
      id: "go",
      mode: "banner",
      minTime: 1,
      card: () => glance("Go!"),
      done: (s) => s.input.throttle >= 0.5 && s.speed >= 12,
    },
  ];
}

interface Place {
  at: (turn: number) => number;
  length: number;
}

function lineSteps(p: Place): Step[] {
  const t1 = p.at(1);
  return [
    {
      id: "line",
      mode: "pause",
      from: t1 - 260,
      card: () =>
        card("Follow the line", "", {
          widget: "legend",
        }),
      done: after(reads.line),
    },
    {
      id: "line-wait",
      mode: "banner",
      to: t1 - 20,
      passive: true,
      card: () => glance("Red coming up"),
      done: (s) => nearBrake(s),
    },
    {
      id: "t1-brake",
      mode: "freeze",
      to: t1,
      skip: (s) => !nearBrake(s),
      card: (s, c) =>
        card(
          "Brake!",
          s.input.brake >= 0.5 && s.input.throttle > 0.15
            ? by(c, "Let go of ↑", "Let go of Gas")
            : by(c, "Let go of ↑ and hold ↓", "Let go of Gas, hold Brake"),
        ),
      done: (s) => s.input.throttle <= 0.15 && s.input.brake >= 0.5,
    },
    {
      id: "t1-keep",
      mode: "banner",
      to: t1 - 5,
      passive: true,
      minTime: 0.4,
      coach: true,
      card: () => glance("Keep braking till it's green"),
      done: (s) => !nearBrake(s, coachLead),
    },
    drive("follow", t1, p.at(11) + 150),
  ];
}

function boostSteps(p: Place): Step[] {
  return [
    {
      id: "boost",
      mode: "pause",
      from: p.at(11) + 150,
      card: (_s, c) =>
        card(
          "Boost",
          by(
            c,
            "Press B for extra power.",
            "Tap Boost on your phone for extra power.",
          ),
          {
            spot: "battery",
            widget: c.control === "phone" ? "pad-boost" : null,
          },
        ),
      done: (s) => s.boost,
    },
    drive("boosting", p.at(11) + 150, p.at(12) + 150),
  ];
}

function progress(seen: number, total: number): string {
  return `${String(seen)} of ${String(total)}.`;
}

function camerasSeen(s: TutorialSample, c: Context): number {
  return Math.min(carCameras, 1 + s.cameras - c.startCameras);
}

function screensSeen(s: TutorialSample, c: Context): number {
  c.seenMfd.add(s.mfd);
  return c.seenMfd.size;
}

function viewSteps(p: Place): Step[] {
  return [
    {
      id: "camera",
      mode: "pause",
      from: p.at(12) + 150,
      card: (s, c) =>
        s.cameras > c.startCameras
          ? card(
              "Camera",
              `Keep pressing C to see every view. ${progress(camerasSeen(s, c), carCameras)}`,
              { high: true },
            )
          : card(
              "Camera",
              by(
                c,
                "Press C to change the view. Keep pressing C to go through every camera.",
                "Press C on the keyboard. Keep pressing C to go through every camera.",
              ),
              { high: true },
            ),
      done: (s, c) => camerasSeen(s, c) >= carCameras,
    },
    {
      id: "screens",
      mode: "pause",
      card: (s, c) =>
        screensSeen(s, c) > 1
          ? card(
              "Screens",
              `${by(
                c,
                "Keep pressing Y to see every screen.",
                "Keep pressing Y, or Display on your phone, to see every screen.",
              )} ${progress(screensSeen(s, c), mfdPages.length)}`,
              { spot: "mfd" },
            )
          : card(
              "Screens",
              by(
                c,
                "Press Y to change the screen at the bottom right. Keep pressing Y to see every screen.",
                "Press Y, or Display on your phone, to change the screen at the bottom right. Keep pressing Y to see every screen.",
              ),
              { spot: "mfd" },
            ),
      done: (s, c) => screensSeen(s, c) >= mfdPages.length,
    },
    drive("drive", p.at(12) + 150, p.length + reverseLead),
  ];
}

function reverseSteps(p: Place): Step[] {
  return [
    {
      id: "reverse",
      mode: "pause",
      from: p.length + reverseLead,
      card: (_s, c) =>
        card(
          "Reverse",
          by(
            c,
            "Brake to a stop, then keep holding ↓ to go backwards.",
            "Brake to a stop, then keep holding Brake to go backwards.",
          ),
        ),
      done: after(reads.reverse),
    },
    {
      id: "reversing",
      mode: "banner",
      calm: true,
      card: (s, c) =>
        s.gear < 0
          ? glance(by(c, "Keep holding ↓", "Keep holding Brake"))
          : glance("Brake to a stop"),
      done: reversedLongEnough,
    },
  ];
}

function reversedLongEnough(s: TutorialSample, c: Context): boolean {
  const moving = s.gear < 0 && s.speed > reverseMoving;
  if (moving && c.reverseAt !== null) c.reversed += s.raceTime - c.reverseAt;
  c.reverseAt = moving ? s.raceTime : null;
  return c.reversed >= reverseTime;
}

function phoneSteps(): Step[] {
  return [
    {
      id: "phone",
      mode: "pause",
      command: "panel",
      auto: { after: phoneReads.phone },
      card: (s) =>
        card(
          "Phone",
          s.phone
            ? "Press P any time in a race to connect another phone."
            : "Press P any time in a race to steer with your phone.",
          { spot: "phone-key" },
        ),
      done: (s) => s.panel,
    },
    {
      id: "phone-code",
      mode: "pause",
      command: "panel",
      auto: { after: phoneReads.code },
      done: (s) => !s.panel,
    },
  ];
}

function tunedSteering(s: TutorialSample, c: Context): boolean {
  if (s.sensitivity === null) return c.age >= reads.steering;
  c.startSensitivity ??= s.sensitivity;
  return s.sensitivity !== c.startSensitivity;
}

function centered(s: TutorialSample, c: Context): boolean {
  if (s.centers === null) return c.age >= reads.center;
  c.startCenters ??= s.centers;
  return s.centers !== c.startCenters;
}

function padSteps(): Step[] {
  const noPhone = (s: TutorialSample) => !s.phone;
  return [
    {
      id: "pad-center",
      mode: "modal",
      hold: true,
      skip: noPhone,
      card: () =>
        card(
          "Steering center",
          "Hold your phone level, tap Center and keep it still for the countdown. That becomes straight ahead.",
          { widget: "pad-center" },
        ),
      done: centered,
    },
    {
      id: "pad-sensitivity",
      mode: "modal",
      hold: true,
      skip: noPhone,
      card: () =>
        card(
          "Steering sensitivity",
          "Tap − for gentler steering or + for sharper steering.",
          { widget: "pad-sensitivity" },
        ),
      done: tunedSteering,
    },
  ];
}

function tour(
  id: string,
  spot: Spot,
  words: [title: string, body: string],
  low = false,
): Step {
  const [title, body] = words;
  return {
    id,
    mode: "pause",
    tour: true,
    card: () => card(title, body, { spot, low }),
    done: (s, c) => c.age >= tourRead || !s.menu,
  };
}

function menuSteps(): Step[] {
  return [
    {
      id: "pause",
      mode: "pause",
      command: "pause",
      auto: { after: reads.pause, everyone: true },
      card: () => card("Pause", "Press Esc any time to pause the race."),
      done: (s) => s.menu,
    },
    tour("menu-pages", "menu-tabs", [
      "Settings",
      "Q and E switch pages: session, tyres and energy, assists, rules, car setup, display and audio.",
    ]),
    tour(
      "menu-options",
      "menu-main",
      [
        "Every option",
        "↑ ↓ pick a setting and ← → change it. The panel on the right explains each one.",
      ],
      true,
    ),
    tour("menu-replay", "menu-replay", [
      "Replay & Flashback",
      "V shows the last moments again, or rewinds so you can retry.",
    ]),
    tour("menu-restart", "menu-restart", [
      "Restart",
      "↵ starts this session again from the grid.",
    ]),
    tour("menu-quit", "menu-quit", [
      "Main Menu",
      "M stops the session and takes you back to the main menu.",
    ]),
    tour("menu-resume", "menu-resume", [
      "Resume",
      "Esc takes you back to the race.",
    ]),
  ];
}

function finishSteps(): Step[] {
  return [
    {
      id: "finish",
      mode: "pause",
      tour: true,
      card: () => card("You're ready to race!", ""),
      done: after(reads.finish),
    },
  ];
}

function drive(id: string, from: number, to: number): Step {
  return {
    id,
    mode: "banner",
    from,
    to,
    passive: true,
    coach: true,
    card: () => glance("Follow the line"),
    done: () => false,
  };
}

function script(course: Course): Step[] {
  const byNumber = new Map(course.turns.map((t) => [t.number, t]));
  const place: Place = {
    at: (turn) => byNumber.get(turn)?.distance ?? 0,
    length: course.length,
  };
  return [
    ...welcomeSteps(),
    ...steeringSteps(),
    ...lineSteps(place),
    ...boostSteps(place),
    ...viewSteps(place),
    ...reverseSteps(place),
    ...phoneSteps(),
    ...menuSteps(),
    ...finishSteps(),
  ];
}

function emptyContext(): Context {
  return {
    control: "keyboard",
    chosen: false,
    commanded: false,
    age: 0,
    startCameras: 0,
    startSensitivity: null,
    startCenters: null,
    seenMfd: new Set(),
    checks: {},
    heldSince: null,
    rewinds: 0,
    reversed: 0,
    reverseAt: null,
  };
}

const idleSample: TutorialSample = {
  now: 0,
  input: { steer: 0, throttle: 0, brake: 0 },
  phone: false,
  travel: 0,
  speed: 0,
  raceTime: -1,
  cue: "accelerate",
  brakeIn: null,
  offTrack: false,
  mfd: "quick",
  cameras: 0,
  rewinds: 0,
  pit: "track",
  boost: false,
  retired: false,
  crashed: false,
  gear: 1,
  menu: false,
  panel: false,
  sensitivity: null,
  centers: null,
};

const controlChecks = [
  ["left", "Steer left"],
  ["right", "Steer right"],
  ["brake", "Brake"],
  ["gas", "Accelerate"],
] as const;

export class Tutorial {
  private readonly steps: Step[];
  private readonly context = emptyContext();
  private index = 0;
  private begun = false;
  private startedAt = 0;
  private sample = idleSample;
  private offSince: number | null = null;
  private onSince: number | null = null;
  private stuckSince: number | null = null;
  private alert: Card | null = null;
  private crashAt: number | null = null;
  private pitting = false;
  private menuWas = false;
  private result: Finish | null = null;

  constructor(course: Course) {
    this.steps = script(course);
  }

  get finished(): Finish | null {
    return this.result;
  }

  get holding(): boolean {
    return this.current?.hold === true;
  }

  get frozen(): boolean {
    const mode = this.current?.mode;
    return this.begun && (mode === "freeze" || mode === "pause");
  }

  get touring(): boolean {
    return this.current?.tour === true;
  }

  private get current(): Step | undefined {
    return this.steps[this.index];
  }

  press(action: "skip" | "keyboard"): boolean {
    const step = this.current;
    if (!step || !this.begun || this.result) return false;
    if (action === "skip") return this.skipFrom(step);
    if (step.id !== "controls") return false;
    this.context.chosen = true;
    return true;
  }

  private skipFrom(step: Step): boolean {
    if (step.id !== "welcome" && step.id !== "controls")
      return this.frozen || this.holding;
    this.result = "skipped";
    return true;
  }

  skip(): void {
    this.result ??= "skipped";
  }

  update(s: TutorialSample): TutorialEvent[] {
    if (this.result) return [];
    const events: TutorialEvent[] = [];
    this.sample = s;
    if (s.phone) this.context.control = "phone";
    this.phoneCommand(s, events);
    this.watchRewinds(s, events);
    this.watchMenu(s, events);
    if (!this.watchPit(s, events)) {
      this.advance(s, events);
      this.watchAlert(s, events);
    }
    return events;
  }

  private shared() {
    const c = this.context;
    return {
      control: c.control,
      checks: controlChecks.map(([key, label]) => ({
        label,
        done: c.checks[key] === true,
      })),
      input: this.sample.input,
      sensitivity: this.sample.sensitivity,
    };
  }

  get view(): TutorialView {
    const s = this.sample;
    const c = this.context;
    const shared = this.shared();
    if (this.pitting)
      return {
        ...shared,
        id: "pit",
        mode: "banner",
        card: null,
        coach: null,
        alert: null,
      };
    const step = this.begun ? this.current : undefined;
    return {
      ...shared,
      id: step?.id ?? "",
      mode: step?.mode ?? "banner",
      card: step?.card?.(s, c) ?? null,
      coach: this.coach(),
      alert: this.alert,
    };
  }

  private coach(): TutorialView["coach"] {
    const step = this.current;
    if (!step || step.mode !== "banner" || step.hold === true) return null;
    if (this.begun && step.coach !== true) return null;
    return nearBrake(this.sample, coachLead) ? "brake" : this.sample.cue;
  }

  private phoneCommand(s: TutorialSample, events: TutorialEvent[]): void {
    const step = this.current;
    const c = this.context;
    const auto = step?.auto;
    if (!this.begun || c.commanded || !step?.command || !auto) return;
    if (auto.everyone !== true && c.control !== "phone") return;
    if (s.now - this.startedAt < auto.after) return;
    c.commanded = true;
    events.push({ kind: "command", command: step.command });
  }

  private watchRewinds(s: TutorialSample, events: TutorialEvent[]): void {
    if (s.rewinds <= this.context.rewinds) return;
    this.context.rewinds = s.rewinds;
    this.alert = null;
    events.push({ kind: "rewind" }, { kind: "slow", speed: rewindSpeed });
  }

  private watchMenu(s: TutorialSample, events: TutorialEvent[]): void {
    if (this.menuWas && !s.menu)
      events.push({ kind: "slow", speed: resumeSpeed });
    this.menuWas = s.menu;
  }

  private advance(s: TutorialSample, events: TutorialEvent[]): void {
    for (let guard = 0; guard <= this.steps.length; guard++) {
      const step = this.current;
      if (!step) {
        this.result = "done";
        return;
      }
      if (!this.begun) {
        if (step.from !== undefined && s.travel < step.from) return;
        this.begin(s);
        if (this.skipped(step, s)) {
          this.next();
          continue;
        }
      }
      this.context.age = s.now - this.startedAt;
      if (!this.complete(step, s, events)) return;
      this.next();
    }
  }

  private begin(s: TutorialSample): void {
    const c = this.context;
    this.begun = true;
    this.startedAt = s.now;
    c.age = 0;
    c.commanded = false;
    c.startCameras = s.cameras;
    c.startSensitivity = s.sensitivity;
    c.startCenters = s.centers;
    c.seenMfd = new Set([s.mfd]);
    c.heldSince = null;
    c.reversed = 0;
    c.reverseAt = null;
  }

  private watchPit(s: TutorialSample, events: TutorialEvent[]): boolean {
    if (s.pit === "track") {
      this.pitting = false;
      return false;
    }
    if (!this.pitting) {
      events.push({ kind: "alert" });
      this.alert = null;
    }
    this.pitting = true;
    return true;
  }

  private next(): void {
    this.index++;
    this.begun = false;
    if (this.index >= this.steps.length) this.result = "done";
  }

  private skipped(step: Step, s: TutorialSample): boolean {
    const beyond = step.to !== undefined && s.travel > step.to;
    return beyond || (step.skip?.(s, this.context) ?? false);
  }

  private complete(
    step: Step,
    s: TutorialSample,
    events: TutorialEvent[],
  ): boolean {
    const c = this.context;
    const beyond = passed(step, s);
    const done = !beyond && c.age >= (step.minTime ?? 0) && step.done(s, c);
    if (!beyond && !done) return false;
    step.leave?.(s, c);
    if (done && !step.passive) events.push({ kind: "tick" });
    if (step.mode === "pause")
      events.push({ kind: "slow", speed: resumeSpeed });
    return true;
  }

  private watchAlert(s: TutorialSample, events: TutorialEvent[]): void {
    const step = this.current;
    const driving =
      step !== undefined &&
      !this.holding &&
      !this.frozen &&
      s.raceTime > 0 &&
      step.id !== "lights-wait";
    const next = driving ? this.alertFor(s) : null;
    if (next && !this.alert) events.push({ kind: "alert" });
    this.alert = next;
  }

  private alertFor(s: TutorialSample): Card | null {
    this.offSince = s.offTrack ? (this.offSince ?? s.now) : null;
    this.onSince = s.offTrack ? null : (this.onSince ?? s.now);
    this.stuckSince = s.speed < stuckSpeed ? (this.stuckSince ?? s.now) : null;
    if (s.retired) return retiredCard;
    if (this.crashing(s)) return crashCard;
    return this.drivingAlert(s);
  }

  private drivingAlert(s: TutorialSample): Card | null {
    if (this.offTrack(s)) return offTrackCard;
    if (this.current?.calm === true) return null;
    return since(this.stuckSince, s.now) >= stuckDelay ? stuckCard : null;
  }

  private crashing(s: TutorialSample): boolean {
    this.crashAt = s.crashed ? (this.crashAt ?? s.now) : null;
    return this.crashAt !== null && s.now - this.crashAt < damageShown;
  }

  private offTrack(s: TutorialSample): boolean {
    if (since(this.offSince, s.now) >= offTrackDelay) return true;
    return (
      this.alert === offTrackCard && since(this.onSince, s.now) < backOnTrack
    );
  }
}

function passed(step: Step, s: TutorialSample): boolean {
  const stopped = step.mode === "freeze" || step.mode === "pause";
  return step.to !== undefined && s.travel > step.to && !stopped;
}

function since(start: number | null, now: number): number {
  return start === null ? -Infinity : now - start;
}

const offTrackCard = card("Off track", "Steer back on, or press R to undo.");

const stuckCard = card("Get going", "Accelerate, or press R to undo.");

const crashCard = card("Crash!", "Press R to undo it. No damage.");

const retiredCard = card("Car's too damaged", "Press R to undo the crash.");
