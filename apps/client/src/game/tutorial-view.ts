import { el } from "./dom.ts";
import type {
  Action,
  Card,
  Control,
  Spot,
  TutorialEvent,
  TutorialView,
  Widget,
} from "./tutorial.ts";

type Prompt = [glyph: string, label: string];

const keyboardPrompts: Record<Action, Prompt> = {
  gas: ["↑", "Accelerate"],
  brake: ["↓", "Brake"],
  left: ["←", "Steer left"],
  right: ["→", "Steer right"],
  mfd: ["Y", "Next screen"],
  camera: ["C", "Change view"],
  rewind: ["R", "Undo"],
  confirm: ["Enter", "Continue"],
  skip: ["Esc", "Skip tutorial"],
  phone: ["P", "Use my phone"],
  keyboard: ["K", "Use keyboard"],
  finish: ["Enter", "Finish"],
  boost: ["B", "Boost"],
  pause: ["Esc", "Pause"],
  resume: ["Esc", "Resume"],
  code: ["P", "Show code"],
  close: ["P", "Close"],
  next: ["Space", "Next"],
};

const phonePrompts: Partial<Record<Action, Prompt>> = {
  gas: ["Gas", "Hold"],
  brake: ["Brake", "Hold"],
  left: ["Tilt", "Tilt left"],
  right: ["Tilt", "Tilt right"],
  confirm: ["Brake", "Continue"],
  finish: ["Brake", "Finish"],
  boost: ["Boost", "Tap"],
  pause: ["Brake", "Pause"],
  resume: ["Brake", "Resume"],
  next: ["Brake", "Next"],
};

const spots: Record<Spot, string> = {
  mfd: ".hud .mfd",
  battery: ".hud .ring-left",
  "phone-key": ".hud [data-help=phone]",
  "pad-panel": "[data-pad=panel]",
  "menu-tabs": "[data-menu=tabs]",
  "menu-main": ".menu .menu-main",
  "menu-replay": "[data-menu=replay]",
  "menu-restart": "[data-menu=start]",
  "menu-quit": "[data-menu=quit]",
  "menu-resume": "[data-menu=resume]",
};

const clickable = new Set<Action>([
  "confirm",
  "skip",
  "phone",
  "keyboard",
  "finish",
  "pause",
  "resume",
  "code",
  "close",
  "next",
]);

const toastSeconds = 2.6;
const remeasure = 0.5;
const lightGap = 0.6;
const lightsCycle = 5;
const lightsOut = 3.6;
const goShown = 1;

function promptFor(action: Action, control: Control): Prompt {
  return (
    (control === "phone" ? phonePrompts[action] : undefined) ??
    keyboardPrompts[action]
  );
}

class Chime {
  private context: AudioContext | null = null;

  play(notes: number[], volume = 0.12): void {
    this.context ??= new AudioContext();
    const context = this.context;
    if (context.state === "suspended") void context.resume();
    notes.forEach((frequency, i) => {
      const start = context.currentTime + i * 0.09;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
      gain.connect(context.destination);
      const tone = context.createOscillator();
      tone.type = "sine";
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(start);
      tone.stop(start + 0.45);
    });
  }
}

export class TutorialScreen {
  private readonly dim = el("div", "tut-dim");
  private readonly spot = el("div", "tut-spot");
  private readonly stack = el("div", "tut-stack");
  private readonly card = el("section", "tut-card");
  private readonly coach = el("div", "tut-coach");
  private readonly alert = el("section", "tut-alert");
  private readonly toast = el("div", "tut-toast");
  private readonly chime = new Chime();
  private shownKey = "";
  private alertKey = "";
  private spotTarget: Spot | null = null;
  private measuredAt = -Infinity;
  private toastUntil = 0;
  private wheel: SVGGElement | null = null;
  private pedals: HTMLElement[] = [];
  private checks: HTMLElement[] = [];
  private lights: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly act: (action: Action) => void,
  ) {
    for (const part of [this.spot, this.card, this.coach, this.alert])
      part.hidden = true;
    this.stack.append(this.card, this.coach);
    root.replaceChildren(
      this.dim,
      this.spot,
      this.stack,
      this.alert,
      this.toast,
    );
    root.hidden = false;
  }

  set hidden(hidden: boolean) {
    this.root.classList.toggle("away", hidden);
  }

  close(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  render(view: TutorialView, now: number): void {
    this.root.dataset["mode"] = view.card ? view.mode : "idle";
    this.root.dataset["step"] = view.id;
    this.root.classList.toggle("low", view.card?.low === true);
    this.root.classList.toggle("clear", view.card?.clear === true);
    this.paintCard(view);
    this.paintLive(view);
    this.paintLights(now);
    this.paintSpot(view.card?.spot ?? null, view.mode, now);
    this.paintCoach(view);
    this.paintAlert(view);
    this.toast.classList.toggle("show", now < this.toastUntil);
  }

  play(events: TutorialEvent[], now: number): void {
    for (const event of events) {
      if (event.kind === "tick") this.chime.play([880, 1318.5]);
      if (event.kind === "alert") this.chime.play([392, 330], 0.1);
      if (event.kind === "rewind")
        this.showToast("Undone", "No damage", "info", now);
    }
  }

  private showToast(
    title: string,
    detail: string,
    kind: string,
    now: number,
  ): void {
    this.toast.dataset["kind"] = kind;
    this.toast.replaceChildren(el("b", "", title), el("span", "", detail));
    this.toast.classList.remove("show");
    void this.toast.getBoundingClientRect();
    this.toastUntil = now + toastSeconds;
  }

  private paintCard(view: TutorialView): void {
    const shown = view.card;
    const key = shown
      ? [
          view.id,
          view.mode,
          view.control,
          shown.title,
          shown.body,
          shown.compact,
          shown.actions.join(),
        ].join("|")
      : "";
    if (key === this.shownKey) return;
    const fresh = view.id !== this.card.dataset["step"];
    this.shownKey = key;
    this.card.hidden = !shown;
    if (!shown) return;
    this.card.dataset["step"] = view.id;
    this.card.dataset["tone"] = shown.tone;
    this.card.classList.toggle("compact", shown.compact);
    this.card.replaceChildren(...this.cardParts(view, shown));
    if (!fresh) return;
    this.card.classList.remove("enter");
    void this.card.getBoundingClientRect();
    this.card.classList.add("enter");
  }

  private cardParts(view: TutorialView, shown: Card): HTMLElement[] {
    const head = el("header", "tut-head");
    const bar = el("i", "tut-progress");
    bar.style.setProperty(
      "--done",
      String(view.step / Math.max(1, view.steps - 1)),
    );
    head.append(el("span", "tut-chapter", view.chapter), bar);
    const parts = [head, el("h2", "tut-title", shown.title)];
    if (!shown.compact && shown.body !== "")
      parts.push(el("p", "tut-body", shown.body));
    const widget = shown.widget ? this.widget(shown.widget, view) : null;
    if (widget) parts.push(widget);
    if (shown.actions.length > 0 && !shown.compact)
      parts.push(this.actions(shown.actions, view));
    return parts;
  }

  private actions(actions: Action[], view: TutorialView): HTMLElement {
    const row = el("div", "tut-actions");
    for (const action of actions) {
      const [glyph, label] = promptFor(action, view.control);
      const press = clickable.has(action) && view.mode !== "banner";
      const item = el(press ? "button" : "span", `tut-action ${action}`);
      if (item instanceof HTMLButtonElement) {
        item.type = "button";
        item.addEventListener("click", () => {
          this.act(action);
        });
      }
      item.dataset["action"] = action;
      const key = el("kbd", view.control === "phone" ? "pad" : "", glyph);
      item.append(key, el("span", "", label));
      row.append(item);
    }
    return row;
  }

  private widget(widget: Widget, view: TutorialView): HTMLElement {
    if (widget === "controls") return this.controls(view);
    if (widget === "legend") return legend();
    this.lights = lightsDemo();
    return this.lights;
  }

  private controls(view: TutorialView): HTMLElement {
    const box = el("div", "tut-controls");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-70 -50 140 100");
    svg.classList.add("tut-wheel");
    svg.innerHTML =
      '<g><path class="rim" d="M-42 -32h84a14 14 0 0 1 14 14v22a28 28 0 0 1-28 28h-56a28 28 0 0 1-28-28v-22a14 14 0 0 1 14-14z"/><rect class="screen" x="-20" y="-22" width="40" height="22" rx="4"/><line class="mark" x1="0" y1="-46" x2="0" y2="-34"/></g>';
    this.wheel = svg.querySelector("g");
    const pedal = (name: string) => {
      const column = el("div", `tut-pedal ${name}`);
      const fill = el("i");
      column.append(fill, el("small", "", name));
      return { column, fill };
    };
    const brake = pedal("brake");
    const gas = pedal("gas");
    this.pedals = [brake.fill, gas.fill];
    const list = el("ul", "tut-checks");
    this.checks = view.checks.map((check) => {
      const item = el("li", "", check.label);
      list.append(item);
      return item;
    });
    box.append(brake.column, svg, gas.column, list);
    return box;
  }

  private paintLive(view: TutorialView): void {
    const { steer, throttle, brake } = view.input;
    this.wheel?.setAttribute("transform", `rotate(${String(-steer * 110)})`);
    const [brakeFill, gasFill] = this.pedals;
    brakeFill?.style.setProperty("--v", String(brake));
    gasFill?.style.setProperty("--v", String(throttle));
    view.checks.forEach((check, i) => {
      this.checks[i]?.classList.toggle("done", check.done);
    });
  }

  private paintLights(now: number): void {
    const row = this.lights;
    if (!row?.isConnected) return;
    const phase = now % lightsCycle;
    const lit = phase < lightsOut ? Math.floor(phase / lightGap) + 1 : 0;
    row.querySelectorAll("i").forEach((light, i) => {
      light.classList.toggle("on", i < lit);
    });
    row.classList.toggle(
      "go",
      phase >= lightsOut && phase < lightsOut + goShown,
    );
  }

  private paintSpot(target: Spot | null, mode: string, now: number): void {
    const changed = target !== this.spotTarget;
    this.spotTarget = target;
    this.spot.hidden = target === null;
    this.root.classList.toggle("spotlit", target !== null);
    this.spot.dataset["mode"] = mode;
    if (!target || (!changed && now - this.measuredAt < remeasure)) return;
    this.measuredAt = now;
    const found = document.querySelector<HTMLElement>(spots[target]);
    const box = found?.getBoundingClientRect();
    if (!box || box.width === 0) {
      this.spot.hidden = true;
      return;
    }
    const pad = 10;
    const hole = {
      "--hole-x": `${String(box.left - pad)}px`,
      "--hole-y": `${String(box.top - pad)}px`,
      "--hole-w": `${String(box.width + pad * 2)}px`,
      "--hole-h": `${String(box.height + pad * 2)}px`,
    };
    for (const [name, value] of Object.entries(hole))
      this.root.style.setProperty(name, value);
    Object.assign(this.spot.style, {
      left: hole["--hole-x"],
      top: hole["--hole-y"],
      width: hole["--hole-w"],
      height: hole["--hole-h"],
    });
  }

  private paintCoach(view: TutorialView): void {
    const cue = view.coach;
    this.coach.hidden = cue === null;
    if (cue === null || this.coach.dataset["cue"] === cue) return;
    this.coach.dataset["cue"] = cue;
    const labels = {
      accelerate: "Accelerate",
      lift: "Stop accelerating",
      brake: "Brake",
    };
    this.coach.replaceChildren(el("i"), el("b", "", labels[cue]));
  }

  private paintAlert(view: TutorialView): void {
    const shown = view.alert;
    const key = shown ? `${shown.title}|${shown.body}|${view.control}` : "";
    if (key === this.alertKey) return;
    this.alertKey = key;
    this.alert.hidden = !shown;
    if (!shown) return;
    this.alert.replaceChildren(
      el("b", "", shown.title),
      el("p", "", shown.body),
      this.actions(shown.actions, { ...view, mode: "banner" }),
    );
  }
}

function legend(): HTMLElement {
  const row = el("div", "tut-legend");
  for (const [cue, label] of [
    ["accelerate", "Accelerate"],
    ["lift", "Stop accelerating"],
    ["brake", "Brake"],
  ] as const) {
    const chip = el("span", `tut-cue ${cue}`);
    chip.append(el("i"), el("b", "", label));
    row.append(chip);
  }
  return row;
}

function lightsDemo(): HTMLElement {
  const row = el("div", "tut-lights");
  for (let i = 0; i < 5; i++) row.append(el("i"));
  row.append(el("b", "", "Go!"));
  return row;
}
