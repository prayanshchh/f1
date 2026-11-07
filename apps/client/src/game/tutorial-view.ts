import { sensitivities } from "../pad-signal.ts";
import { el } from "./dom.ts";
import type {
  Card,
  Spot,
  TutorialEvent,
  TutorialView,
  Widget,
} from "./tutorial.ts";

const spots: Record<Spot, string> = {
  mfd: ".hud .mfd",
  battery: ".hud .ring-left",
  "phone-key": ".hud [data-help=phone]",
  "menu-tabs": "[data-menu=tabs]",
  "menu-main": ".menu .menu-main",
  "menu-replay": "[data-menu=replay]",
  "menu-restart": "[data-menu=start]",
  "menu-quit": "[data-menu=quit]",
  "menu-resume": "[data-menu=resume]",
};

const toastSeconds = 2.6;
const remeasure = 0.5;

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
  private phone: PhoneMock | null = null;

  constructor(private readonly root: HTMLElement) {
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

  set covered(covered: boolean) {
    this.root.classList.toggle("covered", covered);
  }

  close(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  render(view: TutorialView, now: number): void {
    this.root.dataset["mode"] = view.mode;
    this.root.dataset["step"] = view.id;
    this.root.classList.toggle("low", view.card?.low === true);
    this.root.classList.toggle("high", view.card?.high === true);
    this.paintCard(view);
    this.paintLive(view);
    this.paintSpot(view.card?.spot ?? null, view.mode, now);
    this.paintCoach(view);
    this.paintAlert(view);
    this.toast.classList.toggle("show", now < this.toastUntil);
  }

  play(events: TutorialEvent[], now: number): void {
    for (const event of events) {
      if (event.kind === "tick") this.chime.play([880, 1318.5]);
      if (event.kind === "alert") this.chime.play([392, 330], 0.1);
      if (event.kind === "rewind") this.showToast("Undone", "No damage", now);
    }
  }

  private showToast(title: string, detail: string, now: number): void {
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
        ].join("|")
      : "";
    if (key === this.shownKey) return;
    const fresh = view.id !== this.card.dataset["step"];
    this.shownKey = key;
    this.card.hidden = !shown;
    if (!shown) return;
    this.card.dataset["step"] = view.id;
    this.card.classList.toggle("compact", shown.compact);
    this.card.replaceChildren(...this.cardParts(view, shown));
    if (!fresh) return;
    this.card.classList.remove("enter");
    void this.card.getBoundingClientRect();
    this.card.classList.add("enter");
  }

  private cardParts(view: TutorialView, shown: Card): HTMLElement[] {
    const parts: HTMLElement[] = [el("h2", "tut-title", shown.title)];
    if (!shown.compact && shown.body !== "")
      parts.push(el("p", "tut-body", shown.body));
    const widget = shown.widget ? this.widget(shown.widget, view) : null;
    if (widget) parts.push(widget);
    return parts;
  }

  private widget(widget: Widget, view: TutorialView): HTMLElement {
    if (widget === "controls") return this.controls(view);
    if (widget === "legend") return legend();
    this.phone = phoneMock(phoneHints[widget]);
    return this.phone.root;
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
    this.paintPhone(view.sensitivity);
  }

  private paintPhone(sensitivity: number | null): void {
    const phone = this.phone;
    if (!phone?.root.isConnected) return;
    const value = sensitivity ?? 1;
    phone.value.textContent = `${value.toFixed(2)}×`;
    phone.bar.style.width = `${String(sensitivityShare(value) * 100)}%`;
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
    );
  }
}

const phoneHints = {
  "pad-center": "Center",
  "pad-sensitivity": "sensitivity",
  "pad-boost": "Boost",
} as const;

interface PhoneMock {
  root: HTMLElement;
  value: HTMLElement;
  bar: HTMLElement;
}

const padButtons = [
  ["ERS", "Medium"],
  ["Display", "MFD"],
  ["Next stop", "Wing"],
  ["Next stop", "Tyres"],
  ["Batt", "Boost"],
  ["Steering", "Center"],
] as const;
function sensitivityShare(value: number): number {
  const step = sensitivities.findIndex((s) => s >= value - 0.001);
  const index = step < 0 ? sensitivities.length - 1 : step;
  return index / (sensitivities.length - 1);
}

function phonePedal(name: string): HTMLElement {
  const pedal = el("div", `tut-phone-pedal ${name.toLowerCase()}`);
  pedal.append(el("i"), el("small", "", name));
  return pedal;
}

function phoneSensitivity(hint: boolean): PhoneMock {
  const row = el("div", "tut-phone-sens");
  const value = el("b");
  const bar = el("i");
  const track = el("span");
  track.append(bar);
  const meter = el("div", "tut-phone-meter");
  meter.append(el("small", "", "Sensitivity"), value, track);
  const hit = hint ? "tut-phone-hit" : "";
  row.append(el("span", hit, "−"), meter, el("span", hit, "+"));
  return { root: row, value, bar };
}

function phoneMock(hint: string): PhoneMock {
  const status = el("div", "tut-phone-status");
  status.append(el("i"), el("span", "", "Connected"));
  const dial = el("div", "tut-phone-dial");
  dial.append(el("b", "", "0"), el("small", "", "km/h"));
  const readout = el("div", "tut-phone-read");
  readout.append(dial, el("b", "tut-phone-gear", "N"));
  const grid = el("div", "tut-phone-grid");
  for (const [label, name] of padButtons) {
    const button = el("span", name === "Center" ? "center" : "");
    button.classList.toggle("tut-phone-hit", name === hint);
    button.append(el("small", "", label), el("b", "", name));
    grid.append(button);
  }
  const sensitivity = phoneSensitivity(hint === "sensitivity");
  const middle = el("div", "tut-phone-mid");
  middle.append(status, readout, sensitivity.root, grid);
  const screen = el("div", "tut-phone-screen");
  screen.append(phonePedal("Brake"), middle, phonePedal("Gas"));
  const root = el("div", "tut-phone");
  root.append(screen);
  return { ...sensitivity, root };
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
