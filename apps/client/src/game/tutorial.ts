import type { PitPhase } from "./pitstop.ts";
import type { Cue } from "./racing-line.ts";
import type { Turn } from "./stewards.ts";

export type Control = "keyboard" | "phone";
export type Action =
  | "gas"
  | "brake"
  | "left"
  | "right"
  | "mfd"
  | "camera"
  | "rewind"
  | "confirm"
  | "skip"
  | "phone"
  | "keyboard"
  | "finish"
  | "boost"
  | "pause"
  | "resume"
  | "code"
  | "close"
  | "next";
type Mode = "modal" | "banner" | "freeze" | "pause";
export type Spot =
  | "mfd"
  | "battery"
  | "phone-key"
  | "pad-panel"
  | "menu-tabs"
  | "menu-main"
  | "menu-replay"
  | "menu-restart"
  | "menu-quit"
  | "menu-resume";
export type Command = "pause" | "resume" | "panel";
export type Widget = "controls" | "legend" | "lights";
type Tone = "info" | "go" | "brake" | "lift";
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
}

export interface Card {
  title: string;
  body: string;
  actions: Action[];
  tone: Tone;
  widget: Widget | null;
  spot: Spot | null;
  compact: boolean;
  low: boolean;
  clear: boolean;
}

interface Check {
  label: string;
  done: boolean;
}

export interface TutorialView {
  id: string;
  chapter: string;
  step: number;
  steps: number;
  mode: Mode;
  card: Card | null;
  control: Control;
  coach: Cue["kind"] | null;
  alert: Card | null;
  checks: Check[];
  input: Pedals;
}

export type TutorialEvent =
  | { kind: "tick" }
  | { kind: "rewind" }
  | { kind: "alert" }
  | { kind: "command"; command: Command };

export type CourseTurn = Turn & { side?: string };

export interface Course {
  length: number;
  turns: CourseTurn[];
}

const reaction = 0.12;
const slowLead = 0.25;
const steerHold = 0.25;
const confirmDelay = 0.6;
const offTrackDelay = 0.5;
const backOnTrack = 1;
const stuckDelay = 3;
const stuckSpeed = 2;
const damageShown = 8;
const reverseLead = 30;
const reverseDistance = 4;

export function freezeDistance(speed: number): number {
  return 4 + speed * (reaction + slowLead);
}

function coachLead(speed: number): number {
  return 6 + speed * 0.6;
}

interface Context {
  control: Control;
  chosen: boolean;
  confirmed: boolean;
  age: number;
  startCameras: number;
  startMfd: string;
  checks: Record<string, boolean>;
  heldSince: number | null;
  rewinds: number;
  furthest: number;
}

interface Step {
  id: string;
  chapter: string;
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
  skip?: (s: TutorialSample, c: Context) => boolean;
  card: (s: TutorialSample, c: Context) => Card;
  done: (s: TutorialSample, c: Context) => boolean;
  leave?: (s: TutorialSample, c: Context) => void;
}

function card(
  title: string,
  body: string,
  actions: Action[] = [],
  extra: Partial<Card> = {},
): Card {
  return {
    title,
    body,
    actions,
    tone: "info",
    widget: null,
    spot: null,
    compact: false,
    low: false,
    clear: false,
    ...extra,
  };
}

function glance(title: string, tone: Tone = "info"): Card {
  return card(title, "", [], { compact: true, tone });
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

const confirmed = (_s: TutorialSample, c: Context) => c.confirmed;

const chapters = {
  welcome: "Driving School",
  steering: "1 · Steering",
  line: "2 · Racing Line",
  boost: "3 · Boost",
  camera: "4 · Camera",
  screens: "5 · Screens",
  reverse: "6 · Reverse",
  phone: "7 · Phone",
  menu: "8 · Pause Menu",
} as const;

function welcomeSteps(): Step[] {
  return [
    {
      id: "welcome",
      chapter: chapters.welcome,
      mode: "modal",
      hold: true,
      card: () =>
        card("Driving School", "One lap to learn the basics.", [
          "confirm",
          "skip",
        ]),
      done: confirmed,
    },
    {
      id: "controls",
      chapter: chapters.welcome,
      mode: "modal",
      hold: true,
      card: (s) =>
        card("Phone or keyboard?", s.phone ? "Phone connected." : "", [
          "phone",
          "keyboard",
        ]),
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
    chapter: chapters.steering,
    mode: "modal",
    hold: true,
    card: (_s, c) =>
      card(title, by(c, keyboard, phone), [action], { widget: "controls" }),
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
    {
      id: "lights",
      chapter: chapters.steering,
      mode: "modal",
      hold: true,
      card: () =>
        card("Lights out", "When they go out, accelerate.", ["confirm"], {
          widget: "lights",
        }),
      done: confirmed,
    },
    {
      id: "lights-wait",
      chapter: chapters.steering,
      mode: "banner",
      card: (s) => glance(s.input.throttle > 0.3 ? "Not yet!" : "Wait for it…"),
      done: (s) => s.raceTime >= 0,
    },
    {
      id: "go",
      chapter: chapters.steering,
      mode: "banner",
      minTime: 1,
      card: () => glance("Go!", "go"),
      done: (s) => s.input.throttle >= 0.5 && s.speed >= 12,
    },
  ];
}

interface Place {
  at: (turn: number) => number;
  length: number;
}

function lineSteps(p: Place): Step[] {
  const chapter = chapters.line;
  const t1 = p.at(1);
  return [
    {
      id: "line",
      chapter,
      mode: "pause",
      from: t1 - 260,
      card: () =>
        card("Follow the line", "", ["confirm"], { widget: "legend" }),
      done: confirmed,
    },
    {
      id: "line-wait",
      chapter,
      mode: "banner",
      to: t1 - 20,
      passive: true,
      card: () => glance("Red coming up"),
      done: (s) => nearBrake(s),
    },
    {
      id: "t1-brake",
      chapter,
      mode: "freeze",
      to: t1,
      skip: (s) => !nearBrake(s),
      card: (s, c) =>
        card(
          "Brake!",
          s.input.brake >= 0.5 && s.input.throttle > 0.15
            ? by(c, "Let go of ↑", "Let go of Gas")
            : by(c, "Let go of ↑ and hold ↓", "Let go of Gas, hold Brake"),
          ["brake"],
          { tone: "brake" },
        ),
      done: (s) => s.input.throttle <= 0.15 && s.input.brake >= 0.5,
    },
    {
      id: "t1-keep",
      chapter,
      mode: "banner",
      to: t1 - 5,
      passive: true,
      minTime: 0.4,
      coach: true,
      card: () => glance("Keep braking till it's green", "brake"),
      done: (s) => !nearBrake(s, coachLead),
    },
    drive("follow", chapter, t1, p.at(11) + 150),
  ];
}

function boostSteps(p: Place): Step[] {
  return [
    {
      id: "boost",
      chapter: chapters.boost,
      mode: "pause",
      from: p.at(11) + 150,
      card: (s, c) =>
        card(
          "Boost",
          by(c, "Press B for extra power.", "Tap Boost for extra power."),
          s.boost ? ["boost", "confirm"] : ["boost"],
          { spot: "battery", tone: "go" },
        ),
      done: (s, c) => s.boost && c.confirmed,
    },
    drive("boosting", chapters.boost, p.at(11) + 150, p.at(12) + 150),
  ];
}

function viewSteps(p: Place): Step[] {
  return [
    {
      id: "camera",
      chapter: chapters.camera,
      mode: "pause",
      from: p.at(12) + 150,
      card: (s, c) =>
        s.cameras > c.startCameras
          ? card(
              "Camera",
              "Keep pressing C for more views, then pick the one you like.",
              ["camera", "confirm"],
              { clear: true },
            )
          : card(
              "Camera",
              by(
                c,
                "Press C to change the view. Keep pressing C to go through every camera.",
                "Press C on the keyboard. Keep pressing C to go through every camera.",
              ),
              ["camera"],
              { clear: true },
            ),
      done: (s, c) => s.cameras > c.startCameras && c.confirmed,
    },
    {
      id: "screens",
      chapter: chapters.screens,
      mode: "pause",
      card: (s, c) =>
        s.mfd !== c.startMfd
          ? card(
              "Screens",
              by(
                c,
                "Keep pressing Y for the weather, tyre temperatures, wear and pressures.",
                "Keep tapping Display for the weather, tyre temperatures, wear and pressures.",
              ),
              ["mfd", "confirm"],
              { spot: "mfd" },
            )
          : card(
              "Screens",
              by(
                c,
                "Press Y to change the screen at the bottom right. Keep pressing Y to see them all.",
                "Tap Display to change the screen at the bottom right. Keep tapping to see them all.",
              ),
              ["mfd"],
              { spot: "mfd" },
            ),
      done: (s, c) => s.mfd !== c.startMfd && c.confirmed,
    },
    drive("drive", chapters.screens, p.at(12) + 150, p.length + reverseLead),
  ];
}

function reverseSteps(p: Place): Step[] {
  return [
    {
      id: "reverse",
      chapter: chapters.reverse,
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
          ["confirm"],
        ),
      done: confirmed,
    },
    {
      id: "reversing",
      chapter: chapters.reverse,
      mode: "banner",
      calm: true,
      card: (s, c) =>
        s.gear < 0
          ? glance(by(c, "Keep holding ↓", "Keep holding Brake"), "go")
          : glance("Brake to a stop", "brake"),
      done: (s, c) => {
        c.furthest = Math.max(c.furthest, s.travel);
        return s.gear < 0 && c.furthest - s.travel >= reverseDistance;
      },
    },
  ];
}

function phoneSteps(): Step[] {
  return [
    {
      id: "phone",
      chapter: chapters.phone,
      mode: "pause",
      command: "panel",
      card: (s) =>
        card(
          "Phone",
          s.phone
            ? "Press P any time in a race to connect another phone."
            : "Press P any time in a race to steer with your phone.",
          ["code"],
          { spot: "phone-key" },
        ),
      done: (s) => s.panel,
    },
    {
      id: "phone-code",
      chapter: chapters.phone,
      mode: "pause",
      command: "panel",
      card: () =>
        card(
          "Scan to connect",
          "Point your phone camera here. Phone and computer on the same Wi-Fi or hotspot.",
          ["close"],
          { spot: "pad-panel", low: true },
        ),
      done: (s) => !s.panel,
    },
  ];
}

function tour(
  id: string,
  spot: Spot,
  title: string,
  body: string,
  low = false,
): Step {
  return {
    id,
    chapter: chapters.menu,
    mode: "pause",
    tour: true,
    card: () => card(title, body, ["next"], { spot, low }),
    done: (s, c) => c.confirmed || !s.menu,
  };
}

function menuSteps(): Step[] {
  return [
    {
      id: "pause",
      chapter: chapters.menu,
      mode: "pause",
      command: "pause",
      card: () =>
        card("Pause", "Press Esc any time to pause the race.", ["pause"]),
      done: (s) => s.menu,
    },
    tour(
      "menu-pages",
      "menu-tabs",
      "Settings",
      "Q and E switch pages: session, tyres and energy, assists, rules, car setup, display and audio.",
    ),
    tour(
      "menu-options",
      "menu-main",
      "Every option",
      "↑ ↓ pick a setting and ← → change it. The panel on the right explains each one.",
      true,
    ),
    tour(
      "menu-replay",
      "menu-replay",
      "Replay & Flashback",
      "V shows the last moments again, or rewinds so you can retry.",
    ),
    tour(
      "menu-restart",
      "menu-restart",
      "Restart",
      "↵ starts this session again from the grid.",
    ),
    tour(
      "menu-quit",
      "menu-quit",
      "Main Menu",
      "M stops the session and takes you back to the main menu.",
    ),
    {
      id: "menu-resume",
      chapter: chapters.menu,
      mode: "pause",
      tour: true,
      command: "resume",
      card: () =>
        card(
          "Resume",
          "Esc takes you back to the race. Try it now.",
          ["resume"],
          { spot: "menu-resume", tone: "go" },
        ),
      done: (s) => !s.menu,
    },
  ];
}

function finishSteps(): Step[] {
  return [
    {
      id: "finish",
      chapter: chapters.menu,
      mode: "pause",
      card: () => card("You're ready to race!", "", ["finish"], { tone: "go" }),
      done: confirmed,
    },
  ];
}

function drive(id: string, chapter: string, from: number, to: number): Step {
  return {
    id,
    chapter,
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
    confirmed: false,
    age: 0,
    startCameras: 0,
    startMfd: "",
    checks: {},
    heldSince: null,
    rewinds: 0,
    furthest: -Infinity,
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
  private brakeWas = 0;
  private offSince: number | null = null;
  private onSince: number | null = null;
  private stuckSince: number | null = null;
  private alert: Card | null = null;
  private crashAt: number | null = null;
  private pitting = false;
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

  press(action: "confirm" | "skip" | "keyboard"): boolean {
    const step = this.current;
    if (!step || !this.begun || this.result) return false;
    if (action === "skip") return this.skipFrom(step);
    if (step.id === "controls") {
      this.context.chosen = true;
      return true;
    }
    if (action === "keyboard") return false;
    this.confirm();
    return step.mode !== "banner";
  }

  private skipFrom(step: Step): boolean {
    if (step.id !== "welcome") return false;
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
    this.phoneConfirm(s, events);
    this.watchRewinds(s, events);
    if (!this.watchPit(s, events)) {
      this.advance(s, events);
      this.watchAlert(s, events);
    }
    this.context.confirmed = false;
    return events;
  }

  private shared() {
    const c = this.context;
    return {
      chapter: this.current?.chapter ?? "",
      step: this.index,
      steps: this.steps.length,
      control: c.control,
      checks: controlChecks.map(([key, label]) => ({
        label,
        done: c.checks[key] === true,
      })),
      input: this.sample.input,
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
      card: step?.card(s, c) ?? null,
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

  private confirm(): void {
    if (this.sample.now - this.startedAt >= confirmDelay)
      this.context.confirmed = true;
  }

  private phoneConfirm(s: TutorialSample, events: TutorialEvent[]): void {
    const pressed = s.input.brake >= 0.6 && this.brakeWas < 0.3;
    if (s.input.brake >= 0.6 || s.input.brake < 0.3)
      this.brakeWas = s.input.brake;
    if (!pressed || this.context.control !== "phone" || !this.begun) return;
    const command = this.current?.command;
    if (!command) this.confirm();
    else if (this.sample.now - this.startedAt >= confirmDelay)
      events.push({ kind: "command", command });
  }

  private watchRewinds(s: TutorialSample, events: TutorialEvent[]): void {
    if (s.rewinds <= this.context.rewinds) return;
    this.context.rewinds = s.rewinds;
    this.alert = null;
    events.push({ kind: "rewind" });
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
    c.startCameras = s.cameras;
    c.startMfd = s.mfd;
    c.heldSince = null;
    c.furthest = -Infinity;
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
    this.context.confirmed = false;
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

const offTrackCard = card(
  "Off track",
  "Steer back on, or press R to undo.",
  ["rewind"],
  { tone: "brake" },
);

const stuckCard = card("Get going", "Accelerate, or press R to undo.", [
  "gas",
  "rewind",
]);

const crashCard = card("Crash!", "Press R to undo it. No damage.", ["rewind"], {
  tone: "brake",
});

const retiredCard = card(
  "Car's too damaged",
  "Press R to undo the crash.",
  ["rewind"],
  { tone: "brake" },
);
