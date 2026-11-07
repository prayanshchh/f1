import { ersModes, fuelMixes, nominalFuelPerLap } from "./energy.ts";
import { el } from "./dom.ts";
import { graphicsLevelOf } from "./graphics-mode.ts";
import { carArt } from "./mfd.ts";
import { ParamDoc } from "./params.ts";
import { compounds } from "./tyres.ts";
import { raceLapOptions, raceLaps } from "./weekend.ts";
import {
  autoFuelLaps,
  applyWeather,
  carOf,
  cars,
  choices,
  defaults,
  type HudPart,
  hudParts,
  readSetup,
  saveSettings,
  type Settings,
  type SetupItem,
  type SetupSource,
  stageOf,
  trackOf,
  tracks,
  weatherOf,
  weatherPresets,
} from "./settings.ts";

export type MenuAction =
  "start" | "resume" | "restart" | "back" | "replay" | "quit";

interface Option {
  id: string;
  label: string;
}

interface ChoiceRow {
  kind: "choice";
  label: string;
  info: string;
  options: readonly Option[];
  get: () => string;
  set: (id: string) => void;
  rerender?: boolean;
}

interface NumberRow {
  kind: "number";
  label: string;
  info: string;
  min: number;
  max: number;
  step: number;
  base: number;
  get: () => number;
  set: (v: number) => void;
  format: (v: number) => string;
  range: string;
  rerender?: boolean;
}

type Row = ChoiceRow | NumberRow;

interface Tab {
  id: string;
  label: string;
  title: string;
  info: string;
  setup: boolean;
  rows: () => Row[];
  reset: () => void;
}

const onOff: Option[] = [
  { id: "off", label: "Off" },
  { id: "on", label: "On" },
];

const setupInfo: Record<string, string> = {
  "front-wing":
    "Higher front wing angles add front downforce, sharpening turn-in at the cost of top speed.",
  "rear-wing":
    "Higher rear wing angles add rear downforce and stability, but increase drag on the straights.",
  "final-drive":
    "A shorter final drive improves acceleration; a longer one raises top speed in the highest gear.",
  gear: "Lower ratios lengthen the gear for more speed; higher ratios shorten it for stronger acceleration.",
  camber:
    "More negative camber improves cornering grip but raises tyre temperatures and wear.",
  toe: "Toe-out sharpens turn-in; toe-in adds straight-line stability at the cost of tyre wear.",
  spring:
    "Stiffer springs keep the platform stable for aero; softer springs absorb bumps and kerbs better.",
  arb: "A stiffer anti-roll bar reduces body roll and shifts balance toward understeer on that axle.",
  heave:
    "The heave spring controls how the car settles under downforce at high speed.",
  height:
    "Lower ride height improves aero efficiency, but the floor may bottom out over bumps and kerbs.",
  packers: "Packers limit suspension travel before the bump stops engage.",
  "slow-bump":
    "Slow bump damping controls weight transfer when braking, turning and accelerating.",
  "slow-rebound":
    "Slow rebound damping controls how quickly the suspension extends after load transfer.",
  "fast-bump":
    "Fast bump damping controls how the car reacts to kerbs and sharp bumps.",
  "fast-rebound":
    "Fast rebound damping controls how quickly the wheel drops back after a bump.",
  pressure:
    "Higher pressures reduce rolling resistance and heat build-up; lower pressures increase the contact patch and grip.",
  "brake-pressure":
    "Higher brake pressure increases stopping power but makes it easier to lock the wheels.",
  "brake-bias":
    "Moving bias forward makes the fronts lock first; moving it rearward helps rotation but can destabilise the rear.",
  "steer-lock":
    "The maximum angle the front wheels can turn. More lock helps hairpins, less lock calms high-speed corners.",
  "steer-speed": "How fast the steering can move from lock to lock.",
};

const tabIntro: Record<string, string> = {
  session:
    "Choose the circuit, the car and the type of session, and set the weather conditions.",
  strategy:
    "Choose the tyre you start on, how fast tyres wear, how much fuel you carry and how the battery deploys. These follow the 2026 regulations.",
  assists:
    "Contains driver assist settings that allow you to make controlling the car easier or more authentic.",
  rules:
    "Choose how the International Motor Racing Federation starts the race. A spin, crash or stop you are part of waves local yellow flags.",
  graphics:
    "Choose how the race is drawn. The game picks Ultra or Low for this computer the first time, and you can switch at any moment, also with G during a race.",
  osd: "Contains settings that allow you to customise the way the on-screen display is shown.",
  audio:
    "Music plays in the menus, the pre-race build-up and after a win. There is no music while you drive.",
  Aerodynamics:
    "Adjust the front and rear wings in order to achieve the desired level of aerodynamic performance and balance.",
  Transmission:
    "Adjust the gear ratios and final drive to suit the length of the straights and the speed of the corners.",
  "Suspension Geometry":
    "Adjust the angles of the wheels and the steering to fine-tune grip, response and tyre wear.",
  Suspension:
    "Stiff suspension improves response and keeps the aero platform stable; soft suspension rides kerbs and bumps better.",
  Brakes:
    "Adjust the strength of the brakes and how the braking force is split between the front and rear axles.",
  Tyres: "Adjust tyre pressures to manage grip and temperatures over a stint.",
};

const setupParts: Record<string, string> = {
  Aerodynamics: '[data-part^="wing-"], [data-part="rear-wing"]',
  Transmission: '[data-part="engine"], [data-part="diffuser"]',
  "Suspension Geometry": '[data-part="wishbones"], [data-part^="suspension-"]',
  Suspension: '[data-part="springs"]',
  Brakes: '[data-part="brakes"]',
  Tyres: ".tyre",
};

const sideArt = (side: string): string =>
  `<g transform="scale(${side} 1)">
    <path d="M-78 318 L-30 302 M-78 332 L-30 334 M-78 346 L-32 376 M-78 902 L-14 870 M-78 918 L-14 912 M-78 934 L-14 944"/>
  </g>`;
const springArt = (side: string): string =>
  `<g transform="scale(${side} 1)">
    <rect x="-24" y="300" width="12" height="56" rx="4"/>
    <rect x="-30" y="808" width="12" height="56" rx="4"/>
  </g>`;
const brakeArt = (side: string): string =>
  `<g transform="scale(${side} 1)">
    <rect x="-128" y="298" width="16" height="66" rx="4"/>
    <rect x="-134" y="306" width="28" height="18" rx="4"/>
    <rect x="-132" y="880" width="16" height="70" rx="4"/>
    <rect x="-138" y="888" width="28" height="18" rx="4"/>
  </g>`;
const setupArt = `
  <g class="part setup" data-part="wishbones">${sideArt("1")}${sideArt("-1")}</g>
  <g class="part setup" data-part="springs">${springArt("1")}${springArt("-1")}<path d="M-30 292 L30 292 M-34 800 L34 800"/></g>
  <g class="part setup" data-part="brakes">${brakeArt("1")}${brakeArt("-1")}</g>`;

const setupOrder = [
  "Aerodynamics",
  "Transmission",
  "Suspension Geometry",
  "Suspension",
  "Brakes",
  "Tyres",
];

function decimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? (text.split(".")[1] ?? "").length : 0;
}

function infoKey(id: string): string {
  if (id.startsWith("gear-")) return "gear";
  return setupInfo[id] ? id : id.replace(/^(front|rear)-/, "");
}

function stripMode(s: Settings): string {
  if (s.session === "race") return `Race - ${String(s.laps)} Laps`;
  if (s.session === "qualifying") return "Qualifying - Q1 Q2 Q3";
  if (s.session === "weekend")
    return s.qualifying === "skip"
      ? `Race From The Back - ${String(s.laps)} Laps`
      : `Qualifying + Race - ${String(s.laps)} Laps`;
  return "Practice";
}

function introOf(tab: string): string {
  return tabIntro[tab] ?? "";
}

export class Menu {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabBar: HTMLElement;
  private readonly info: HTMLElement;
  private tab = "session";
  private focus = 0;
  private rows: Row[] = [];
  private rowElements: HTMLElement[] = [];
  private inSession = false;
  private replays = true;
  private resolve: ((action: MenuAction) => void) | null = null;
  private readonly initial: string;
  private store: (settings: Settings) => void = saveSettings;
  private guardKey: ((event: KeyboardEvent) => boolean) | null = null;

  constructor(
    private readonly source: SetupSource,
    private readonly settings: Settings,
    private readonly interventions = false,
  ) {
    this.root = this.find("root");
    this.body = this.find("body");
    this.tabBar = this.find("tabs");
    this.info = this.find("info");
    this.initial = JSON.stringify({ ...settings, hud: null });
    this.find("reset").addEventListener("click", () => {
      this.resetTab();
    });
    this.find("start").addEventListener("click", () => {
      this.finish(this.inSession ? "restart" : "start");
    });
    this.find("resume").addEventListener("click", () => {
      this.finish(this.inSession ? "resume" : "back");
    });
    this.find("replay").addEventListener("click", () => {
      if (this.canReplay) this.finish("replay");
    });
    this.find("quit").addEventListener("click", () => {
      if (this.inSession) this.finish("quit");
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.root.hidden) return;
        event.stopPropagation();
        if (this.guardKey?.(event) === true) {
          event.preventDefault();
          return;
        }
        this.onKey(event);
      },
      true,
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  private get canReplay(): boolean {
    return this.inSession && this.replays;
  }

  setReplays(on: boolean): void {
    this.replays = on;
  }

  save(): void {
    this.store(this.settings);
  }

  useTutorial(store: (settings: Settings) => void): void {
    this.store = store;
  }

  guard(guardKey: (event: KeyboardEvent) => boolean): void {
    this.guardKey = guardKey;
  }

  async run(inSession: boolean): Promise<MenuAction> {
    this.inSession = inSession;
    this.find("resume-label").textContent = inSession ? "Resume" : "Back";
    this.find("replay").hidden = !this.canReplay;
    this.find("quit").hidden = !inSession;
    this.root.hidden = false;
    this.root.classList.toggle("paused", inSession);
    requestAnimationFrame(() => {
      this.root.classList.add("open");
    });
    this.show(this.tab);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private find(id: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(`[data-menu="${id}"]`);
    if (!node) throw new Error(`missing menu element ${id}`);
    return node;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLButtonElement && event.key === "Enter")
      return;
    const big = event.shiftKey;
    const actions: Record<string, () => void> = {
      Escape: () => {
        this.finish(this.inSession ? "resume" : "back");
      },
      Enter: () => {
        this.finish(this.inSession ? "restart" : "start");
      },
      ArrowUp: () => {
        this.moveFocus(-1);
      },
      ArrowDown: () => {
        this.moveFocus(1);
      },
      ArrowLeft: () => {
        this.nudge(-1, big);
      },
      ArrowRight: () => {
        this.nudge(1, big);
      },
      q: () => {
        this.cycleTab(-1);
      },
      e: () => {
        this.cycleTab(1);
      },
      r: () => {
        this.resetTab();
      },
      v: () => {
        if (this.canReplay) this.finish("replay");
      },
      m: () => {
        if (this.inSession) this.finish("quit");
      },
    };
    const aliases: Record<string, string> = {
      PageUp: "q",
      PageDown: "e",
    };
    const key = aliases[event.key] ?? event.key.toLowerCase();
    const action = actions[key] ?? actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  private finish(action: MenuAction): void {
    this.store(this.settings);
    this.root.classList.remove("open");
    this.root.hidden = true;
    this.resolve?.(action);
    this.resolve = null;
  }

  private tabs(): Tab[] {
    const car = carOf(this.settings).car;
    const groups = new Map<string, SetupItem[]>();
    for (const item of readSetup(this.source, car))
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    const setupTabs = setupOrder
      .filter((name) => groups.has(name))
      .map((name): Tab => ({
        id: name,
        label: name,
        title: "Modifying setup",
        info: tabIntro[name] ?? "",
        setup: true,
        rows: () => (groups.get(name) ?? []).map((item) => this.setupRow(item)),
        reset: () => {
          const values = this.settings.setup[car] ?? {};
          for (const item of groups.get(name) ?? [])
            Reflect.deleteProperty(values, item.id);
        },
      }));
    return [
      {
        id: "session",
        label: "Session",
        title: this.inSession ? "Paused" : "Race setup",
        info: introOf("session"),
        setup: false,
        rows: () => this.sessionRows(),
        reset: () => {
          Object.assign(this.settings, {
            session: defaults.session,
            buildUp: defaults.buildUp,
            laps: defaults.laps,
            difficulty: defaults.difficulty,
            startSlot: defaults.startSlot,
            qualifying: defaults.qualifying,
            rivalLaps: defaults.rivalLaps,
            timeOfDay: defaults.timeOfDay,
            clouds: defaults.clouds,
            rain: defaults.rain,
            season: defaults.season,
          });
        },
      },
      {
        id: "strategy",
        label: "Tyres & Energy",
        title: "Tyres & Energy",
        info: introOf("strategy"),
        setup: false,
        rows: () => this.strategyRows(),
        reset: () => {
          Object.assign(this.settings, {
            compound: defaults.compound,
            tyreWear: defaults.tyreWear,
            fuel: defaults.fuel,
            fuelMix: defaults.fuelMix,
            ersMode: defaults.ersMode,
            ersAssist: defaults.ersAssist,
            straightAssist: defaults.straightAssist,
          });
        },
      },
      {
        id: "assists",
        label: "Assists",
        title: "Assists",
        info: introOf("assists"),
        setup: false,
        rows: () => this.assistRows(),
        reset: () => {
          Object.assign(this.settings, {
            transmission: defaults.transmission,
            racingLine: defaults.racingLine,
            autoReverse: defaults.autoReverse,
            assist: defaults.assist,
            antiLock: defaults.antiLock,
            pitExperience: defaults.pitExperience,
            abs: defaults.abs,
            tc: defaults.tc,
            steerSensitivity: defaults.steerSensitivity,
            steerSpeedSensitivity: defaults.steerSpeedSensitivity,
            steerDeadZone: defaults.steerDeadZone,
          });
        },
      },
      {
        id: "rules",
        label: "Rules & Flags",
        title: "Rules & Flags",
        info: introOf("rules"),
        setup: false,
        rows: () => this.rulesRows(),
        reset: () => {
          Object.assign(this.settings, {
            safetyCar: defaults.safetyCar,
            redFlags: defaults.redFlags,
            startType: defaults.startType,
          });
        },
      },
      ...setupTabs,
      {
        id: "graphics",
        label: "Graphics",
        title: "Graphics",
        info: introOf("graphics"),
        setup: false,
        rows: () => this.graphicsRows(),
        reset: () => {
          this.settings.graphics = defaults.graphics;
        },
      },
      {
        id: "osd",
        label: "On-Screen Display",
        title: "On-Screen Display",
        info: introOf("osd"),
        setup: false,
        rows: () => this.osdRows(),
        reset: () => {
          this.settings.hud = { ...defaults.hud };
        },
      },
      {
        id: "audio",
        label: "Audio",
        title: "Audio",
        info: introOf("audio"),
        setup: false,
        rows: () => this.audioRows(),
        reset: () => {
          this.settings.musicVolume = defaults.musicVolume;
        },
      },
    ];
  }

  private current(): Tab {
    const all = this.tabs();
    return all.find((t) => t.id === this.tab) ?? (all[0] as Tab);
  }

  private tabStrip(): HTMLElement {
    const existing = this.tabBar.querySelector<HTMLElement>(".tab-strip");
    if (existing) return existing;
    const strip = el("div", "tab-strip");
    this.tabBar.replaceChildren(
      el("i", "btn-glyph", "Q"),
      strip,
      el("i", "btn-glyph", "E"),
    );
    return strip;
  }

  private show(tab: string, focus = 0, animate = true): void {
    this.tab = tab;
    const all = this.tabs();
    const active = this.current();
    const strip = this.tabStrip();
    strip.replaceChildren(
      ...all.map((t) => {
        const button = el("button", "tab", t.label);
        button.type = "button";
        button.classList.toggle("active", t.id === active.id);
        button.addEventListener("click", () => {
          if (t.id !== this.tab) this.show(t.id);
        });
        return button;
      }),
    );
    const shown = strip.querySelector<HTMLElement>(".tab.active");
    if (shown) {
      const left = shown.offsetLeft;
      const right = left + shown.offsetWidth;
      if (left < strip.scrollLeft) strip.scrollLeft = left;
      else if (right > strip.scrollLeft + strip.clientWidth)
        strip.scrollLeft = right - strip.clientWidth;
    }
    this.root.dataset["setup"] = active.setup ? "1" : "";
    this.rows = active.rows();
    this.focus = Math.max(0, Math.min(this.rows.length - 1, focus));
    this.rowElements = this.rows.map((row, i) => this.renderRow(row, i));
    this.body.replaceChildren(...this.rowElements);
    this.body.classList.remove("enter");
    if (animate) {
      void this.body.getBoundingClientRect();
      this.body.classList.add("enter");
    }
    this.find("title").textContent = active.title;
    this.paintFocus();
    this.refreshFooter();
  }

  private renderRow(row: Row, index: number): HTMLElement {
    const node = el("div", `mrow ${row.kind}`);
    node.style.setProperty("--i", String(index));
    const label = el("span", "mrow-label", row.label);
    const control = el("div", "mrow-ctl");
    const less = el("button", "arr less");
    const more = el("button", "arr more");
    less.type = "button";
    more.type = "button";
    less.tabIndex = -1;
    more.tabIndex = -1;
    less.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setFocus(index);
      this.nudge(-1, event.shiftKey);
    });
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setFocus(index);
      this.nudge(1, event.shiftKey);
    });
    control.append(less, more);
    if (row.kind === "number") {
      const bar = el("div", "bar");
      bar.append(el("i", "fill"), el("b", "base"));
      const span = row.max - row.min || 1;
      const base = bar.querySelector<HTMLElement>(".base");
      if (base)
        base.style.left = `${String(((row.base - row.min) / span) * 100)}%`;
      const drag = (event: PointerEvent) => {
        const rect = bar.getBoundingClientRect();
        const t = Math.max(
          0,
          Math.min(1, (event.clientX - rect.left) / rect.width),
        );
        this.setNumber(row, row.min + t * span, index);
      };
      bar.addEventListener("pointerdown", (event) => {
        this.setFocus(index);
        bar.setPointerCapture(event.pointerId);
        drag(event);
        const move = (e: PointerEvent) => {
          drag(e);
        };
        bar.addEventListener("pointermove", move);
        bar.addEventListener(
          "pointerup",
          () => {
            bar.removeEventListener("pointermove", move);
          },
          { once: true },
        );
      });
      control.append(bar);
    }
    control.append(el("output"));
    node.append(label, control);
    if (row.kind === "number") node.append(el("span", "mrow-range", row.range));
    node.addEventListener("pointerenter", () => {
      this.setFocus(index);
    });
    node.addEventListener("dblclick", () => {
      if (row.kind === "number") this.setNumber(row, row.base, index);
    });
    this.paintRow(node, row);
    return node;
  }

  private paintRow(node: HTMLElement, row: Row): void {
    const out = node.querySelector("output");
    const ends =
      row.kind === "choice"
        ? this.paintChoice(row, out)
        : this.paintNumber(node, row, out);
    node.querySelector(".less")?.classList.toggle("dim", ends.first);
    node.querySelector(".more")?.classList.toggle("dim", ends.last);
  }

  private paintChoice(
    row: ChoiceRow,
    out: HTMLOutputElement | null,
  ): { first: boolean; last: boolean } {
    const index = row.options.findIndex((o) => o.id === row.get());
    if (out) out.textContent = row.options[index]?.label ?? "";
    return { first: index <= 0, last: index >= row.options.length - 1 };
  }

  private paintNumber(
    node: HTMLElement,
    row: NumberRow,
    out: HTMLOutputElement | null,
  ): { first: boolean; last: boolean } {
    const v = row.get();
    const span = row.max - row.min || 1;
    if (out) out.textContent = row.format(v);
    node.style.setProperty(
      "--fill",
      `${String(((v - row.min) / span) * 100)}%`,
    );
    node.classList.toggle("changed", Math.abs(v - row.base) >= row.step / 2);
    return {
      first: v <= row.min + row.step / 2,
      last: v >= row.max - row.step / 2,
    };
  }

  private setFocus(index: number): void {
    if (index === this.focus) return;
    this.focus = index;
    this.paintFocus();
  }

  private moveFocus(delta: number): void {
    if (this.rows.length === 0) return;
    this.setFocus((this.focus + delta + this.rows.length) % this.rows.length);
    this.rowElements[this.focus]?.scrollIntoView({ block: "nearest" });
  }

  private paintFocus(): void {
    this.rowElements.forEach((node, i) => {
      node.classList.toggle("focus", i === this.focus);
    });
    const tab = this.current();
    const row = this.rows[this.focus];
    const head = el("div", "info-head");
    head.append(el("h3", "", tab.label), el("p", "", tab.info));
    const parts: HTMLElement[] = [];
    if (tab.setup) parts.push(this.carDrawing(tab.id));
    parts.push(head);
    if (row) {
      const detail = el("div", "info-row");
      detail.append(el("h4", "", row.label), el("p", "", row.info));
      parts.push(detail);
    }
    this.info.replaceChildren(...parts);
  }

  private cycleTab(delta: number): void {
    const all = this.tabs();
    const index = all.findIndex((t) => t.id === this.tab);
    const next = all[(index + delta + all.length) % all.length];
    if (next) this.show(next.id);
  }

  private nudge(direction: number, big: boolean): void {
    const row = this.rows[this.focus];
    if (!row) return;
    if (row.kind === "choice") {
      const index = row.options.findIndex((o) => o.id === row.get());
      const next = row.options[index + direction];
      if (!next) return;
      row.set(next.id);
      this.afterChange(row);
      return;
    }
    this.setNumber(
      row,
      row.get() + direction * row.step * (big ? 10 : 1),
      this.focus,
    );
  }

  private setNumber(row: NumberRow, raw: number, index: number): void {
    const snapped = Math.round((raw - row.min) / row.step) * row.step + row.min;
    const value = Number(
      Math.max(row.min, Math.min(row.max, snapped)).toFixed(
        decimals(row.step) + 2,
      ),
    );
    if (value === row.get()) return;
    row.set(value);
    this.focus = index;
    this.afterChange(row);
  }

  private afterChange(row: Row): void {
    this.store(this.settings);
    if (row.rerender) {
      this.show(this.tab, this.focus, false);
      return;
    }
    const node = this.rowElements[this.focus];
    if (node) {
      this.paintRow(node, row);
      node.classList.remove("bump");
      void node.getBoundingClientRect();
      node.classList.add("bump");
    }
    this.refreshFooter();
  }

  private refreshFooter(): void {
    const s = this.settings;
    const dirty = JSON.stringify({ ...s, hud: null }) !== this.initial;
    const tab = this.current();
    this.find("start-label").textContent = this.inSession
      ? "Restart Session"
      : "Start Session";
    this.find("note").textContent =
      this.inSession && dirty
        ? "Changes apply when the session restarts"
        : this.inSession
          ? "On-screen display changes apply on resume"
          : "";
    const car = carOf(s);
    const custom = Object.keys(s.setup[car.car] ?? {}).length > 0;
    this.find("subtitle").textContent = tab.setup
      ? `${car.label} - ${custom ? "Custom Setup" : "Default Setup"}`
      : `${trackOf(s).label} - ${car.label}`;
    this.find("strip-mode").textContent = stripMode(s);
    this.find("strip-track").textContent = trackOf(s).label;
    const label = (options: readonly Option[], id: string) =>
      options.find((c) => c.id === id)?.label ?? id;
    const stat = (small: string, big: string) => {
      const box = el("div");
      box.append(el("small", "", small), el("b", "", big));
      return box;
    };
    this.find("strip-right").replaceChildren(
      stat("Car", car.label),
      stat("Time", label(choices.timeOfDay, s.timeOfDay)),
      stat("Weather", weatherOf(s).label),
    );
  }

  private resetTab(): void {
    this.current().reset();
    this.store(this.settings);
    this.show(this.tab, this.focus, false);
  }

  private choice(
    label: string,
    info: string,
    options: readonly Option[],
    get: () => string,
    set: (id: string) => void,
    rerender = false,
  ): ChoiceRow {
    return { kind: "choice", label, info, options, get, set, rerender };
  }

  private toggle(
    label: string,
    info: string,
    get: () => boolean,
    set: (on: boolean) => void,
    rerender = false,
  ): ChoiceRow {
    return this.choice(
      label,
      info,
      onOff,
      () => (get() ? "on" : "off"),
      (id) => {
        set(id === "on");
      },
      rerender,
    );
  }

  private rulesRows(): Row[] {
    const s = this.settings;
    const interventions = [
      this.choice(
        "Safety Car",
        "Only crashes you are part of count. A touch that spins nobody gets no flag; a spin or a stop waves a local yellow. The Safety Car comes out only when your car, or a car you hit, spins or stops with very heavy damage. Reduced needs a wrecked car, Increased steps in at lighter damage, Off never deploys it.",
        choices.safetyCar,
        () => s.safetyCar,
        (id) => {
          s.safetyCar = id as Settings["safetyCar"];
        },
      ),
      this.toggle(
        "Red Flags",
        "When a car wrecked in a crash you are part of is left on the racing surface for 30 seconds, the race is suspended. Cars line up on the grid in race order, may change tyres and repair damage, and restart from a standing start.",
        () => s.redFlags,
        (v) => {
          s.redFlags = v;
        },
      ),
    ];
    return [
      ...(this.interventions ? interventions : []),
      this.choice(
        "Race Start",
        "Standing starts from the grid when the five red lights go out. Rolling starts behind the safety car: it peels into the pit lane after one lap and racing begins at the control line.",
        choices.startType,
        () => s.startType,
        (id) => {
          s.startType = id as Settings["startType"];
        },
      ),
    ];
  }

  private sessionRows(): Row[] {
    const s = this.settings;
    const rows: Row[] = [
      this.choice(
        "Circuit",
        tracks.map((t) => `${t.label}: ${t.detail}`).join(". ") + ".",
        tracks.map((t) => ({ id: t.id, label: t.label })),
        () => s.track,
        (id) => {
          s.track = id;
        },
        true,
      ),
      this.choice(
        "Team",
        "The team you drive for. In qualifying and races you take its second seat, and your pit box and name on the timing tower follow it.",
        cars.map((c) => ({ id: c.id, label: c.label })),
        () => s.car,
        (id) => {
          s.car = id;
        },
        true,
      ),
      this.choice(
        "Session Type",
        "Practice runs an open session alone to set lap times. Qualifying runs Q1, Q2 and Q3 against the full grid: an out lap, then one timed lap. Race goes straight to the grid. Race Weekend runs qualifying and then starts the race from the position you earned.",
        choices.session,
        () => s.session,
        (id) => {
          s.session = id as Settings["session"];
        },
        true,
      ),
    ];
    if (s.session !== "practice")
      rows.push({
        kind: "number",
        label: "AI Difficulty",
        info: "How fast the other 21 drivers are. At 110 the best of them drive at the limit of the car; each step down costs them about a tenth of a second a lap. The gaps between them come from the real 2026 Austin weekend.",
        min: 40,
        max: 110,
        step: 1,
        base: defaults.difficulty,
        get: () => s.difficulty,
        set: (v) => {
          s.difficulty = v;
        },
        format: (v) => String(v),
        range: "Min 40 - 110 Max",
      });
    if (s.session === "weekend")
      rows.push(
        this.choice(
          "Qualifying",
          "In Q1, Q2 and Q3 every car leaves the pits, does an out lap and then one timed lap. Cars go out one at a time, so there is no traffic, and the slowest six drop out after Q1 and Q2. Skip goes straight to the race and you start from the back of the grid.",
          choices.qualifying,
          () => s.qualifying,
          (id) => {
            s.qualifying = id as Settings["qualifying"];
          },
        ),
      );
    if (
      s.session === "qualifying" ||
      (s.session === "weekend" && s.qualifying === "run")
    )
      rows.push(
        this.choice(
          "Rival Laps",
          "Simulate gives the other 21 drivers their lap times straight away, so you only drive your own laps in Q1, Q2 and Q3. Watch sends them out on track one by one; you can still fast forward or skip from the garage.",
          choices.rivalLaps,
          () => s.rivalLaps,
          (id) => {
            s.rivalLaps = id as Settings["rivalLaps"];
          },
        ),
      );
    rows.push(
      this.toggle(
        "Pre-Race Build-Up",
        "Plays the circuit preview, track map and starting grid before the session. Restarting a session always skips it.",
        () => s.buildUp,
        (v) => {
          s.buildUp = v;
        },
      ),
    );
    if (s.session === "race")
      rows.push({
        kind: "number",
        label: "Starting Position",
        info: "Where you start on the grid when you skip qualifying.",
        min: 1,
        max: 22,
        step: 1,
        base: defaults.startSlot + 1,
        get: () => s.startSlot + 1,
        set: (v) => {
          s.startSlot = v - 1;
        },
        format: (v) => `P${String(v)}`,
        range: "Pole - P22",
      });
    if (s.session === "race" || s.session === "weekend")
      rows.push(
        this.choice(
          "Race Distance",
          `The number of laps in the race. A full race distance is ${String(raceLaps)} laps, 308 km.`,
          raceLapOptions().map((laps) => ({
            id: String(laps),
            label:
              laps === raceLaps
                ? `${String(laps)} Laps (Full)`
                : `${String(laps)} Laps`,
          })),
          () => String(s.laps),
          (id) => {
            s.laps = Number(id);
          },
          true,
        ),
      );
    rows.push(
      this.choice(
        "Time of Day",
        "Sets the position of the sun for the session.",
        choices.timeOfDay,
        () => s.timeOfDay,
        (id) => {
          s.timeOfDay = id as Settings["timeOfDay"];
        },
      ),
      this.choice(
        "Weather",
        "Sets the weather for the session. Light Cloud breaks the sky up with sunny spells, Overcast covers it in grey cloud, and the three wet settings bring more rain, more spray and less grip. Dynamic weather changes through the session and follows the forecast in the multi-function display.",
        weatherPresets,
        () => weatherOf(s).id,
        (id) => {
          applyWeather(s, id);
        },
      ),
      this.choice(
        "Season",
        "Sets the season, which changes the track temperature and the light.",
        choices.season,
        () => s.season,
        (id) => {
          s.season = id as Settings["season"];
        },
      ),
    );
    return rows;
  }

  private strategyRows(): Row[] {
    const s = this.settings;
    const tank = this.tank();
    const asOptions = (items: readonly { label: string }[]) =>
      items.map((item, i) => ({ id: String(i), label: item.label }));
    return [
      this.choice(
        "Starting Tyre",
        "Soft has the most grip and the shortest life. Medium balances the two. Hard lasts longest with the least dry grip. Intermediates and Wets clear water: they are the fastest tyres in the rain and overheat quickly on a dry track. Austin uses C4, C3 and C1.",
        compounds.map((c) => ({ id: c.id, label: c.label })),
        () => s.compound,
        (id) => {
          s.compound = id;
        },
      ),
      this.choice(
        "Tyre Wear",
        "Real Life matches real stints on this circuit at race pace: Soft about 21 laps, Medium 29 and Hard 40 before they fall away, with the tread gone about 27, 37 and 53 laps in. Push harder, lock up or hit things and they go sooner. Race Length speeds wear up for shorter races, up to five times.",
        choices.tyreWear,
        () => s.tyreWear,
        (id) => {
          s.tyreWear = id as Settings["tyreWear"];
        },
      ),
      {
        kind: "number",
        label: "Fuel Load",
        info: "Auto carries enough for the session plus one lap, at about 1.35 kg a lap. Carry less to run lighter and manage it with lift and coast. Running out of fuel stops the car.",
        min: 0,
        max: tank,
        step: 1,
        base: 0,
        get: () => s.fuel,
        set: (v) => {
          s.fuel = v;
        },
        format: (v) =>
          v > 0
            ? `${String(v)} kg (${(v / nominalFuelPerLap).toFixed(1)} Laps)`
            : `Auto (${String(autoFuelLaps(s, stageOf(s, "race")))} Laps)`,
        range: `Min 0 - ${String(tank)} Max`,
      },
      this.choice(
        "Fuel Mix",
        "Lean burns about 10% less fuel for about 4% less engine power. Rich and Max add up to 4% power and burn up to 14% more. Change it while driving with F.",
        fuelMixes.map((m, i) => ({ id: String(i), label: m.label })),
        () => String(s.fuelMix),
        (id) => {
          s.fuelMix = Number(id);
        },
      ),
      this.choice(
        "Starting ERS Mode",
        "None saves the battery. Medium deploys 150 kW and is about energy neutral. Hotlap deploys 250 kW and drains it. Boost gives the full 350 kW up to the regulation speed limit and empties the 4 MJ battery in about 11 seconds. Change the mode with M and toggle Boost with B.",
        asOptions(ersModes),
        () => String(s.ersMode),
        (id) => {
          s.ersMode = Number(id);
        },
      ),
      this.toggle(
        "Active Aero Assist",
        "On, Straight Mode opens by itself at full throttle on straights. Off, press X to arm it. It closes when you brake or lift.",
        () => s.straightAssist,
        (v) => {
          s.straightAssist = v;
        },
      ),
      this.toggle(
        "ERS Assist",
        "Chooses the deployment mode for you from the battery level. Boost stays manual.",
        () => s.ersAssist,
        (v) => {
          s.ersAssist = v;
        },
      ),
    ];
  }

  private assistRows(): Row[] {
    const s = this.settings;
    const rows: Row[] = [
      this.choice(
        "Gearbox",
        "Automatic shifts for you. Manual uses E to shift up and Q to shift down.",
        [
          { id: "auto", label: "Automatic" },
          { id: "sequential", label: "Manual" },
        ],
        () => s.transmission,
        (id) => {
          s.transmission = id as Settings["transmission"];
        },
      ),
      this.choice(
        "Dynamic Racing Line",
        "With this assist enabled there will be a racing line displayed on the track, coloured to show when to accelerate, lift and brake. This line can be displayed for corners only or all of the time.",
        choices.racingLine,
        () => s.racingLine,
        (id) => {
          s.racingLine = id as Settings["racingLine"];
        },
      ),
      this.toggle(
        "Auto Reverse",
        "Selects reverse automatically when you hold the brake while stopped.",
        () => s.autoReverse,
        (v) => {
          s.autoReverse = v;
        },
      ),
      this.choice(
        "Pit Stop Experience",
        "Immersive tests your timing: press Space, or the brake on your phone, as the turn-in countdown reaches zero. Broadcast turns in for you with a perfect stop.",
        choices.pitExperience,
        () => s.pitExperience,
        (id) => {
          s.pitExperience = id as Settings["pitExperience"];
        },
      ),
      this.toggle(
        "Steering Assist",
        "Smooths keyboard and phone steering and adds its own traction control. Turn it off to use Speed Dreams' own ABS, traction control and steering sensitivity.",
        () => s.assist,
        (v) => {
          s.assist = v;
        },
        true,
      ),
    ];
    if (s.assist) {
      rows.push(
        this.toggle(
          "Anti-Lock Brakes",
          "Off, as in a real race car, a heavy stop can lock the wheels: tyre smoke, flat spots and extra wear, sized by how hard the lock is. The brakes still ease off while you are steering. On prevents lock-ups altogether.",
          () => s.antiLock,
          (v) => {
            s.antiLock = v;
          },
        ),
      );
      return rows;
    }
    const slider = (
      label: string,
      info: string,
      min: number,
      max: number,
      step: number,
      base: number,
      get: () => number,
      set: (v: number) => void,
    ): NumberRow => ({
      kind: "number",
      label,
      info,
      min,
      max,
      step,
      base,
      get,
      set,
      format: (v) => v.toFixed(2),
      range: `Min ${String(min)} - ${String(max)} Max`,
    });
    rows.push(
      this.toggle(
        "Anti-Lock Brakes",
        "Prevents the wheels from locking under heavy braking.",
        () => s.abs,
        (v) => {
          s.abs = v;
        },
      ),
      this.toggle(
        "Traction Control",
        "Limits wheelspin when accelerating.",
        () => s.tc,
        (v) => {
          s.tc = v;
        },
      ),
      slider(
        "Steering Sensitivity",
        "How strongly the car responds to steering input.",
        0.1,
        1.5,
        0.05,
        defaults.steerSensitivity,
        () => s.steerSensitivity,
        (v) => {
          s.steerSensitivity = v;
        },
      ),
      slider(
        "Steering Speed Sensitivity",
        "Reduces steering input as speed rises.",
        0,
        1.5,
        0.05,
        defaults.steerSpeedSensitivity,
        () => s.steerSpeedSensitivity,
        (v) => {
          s.steerSpeedSensitivity = v;
        },
      ),
      slider(
        "Steering Deadzone",
        "Ignores small steering inputs around the centre.",
        0,
        0.3,
        0.01,
        defaults.steerDeadZone,
        () => s.steerDeadZone,
        (v) => {
          s.steerDeadZone = v;
        },
      ),
    );
    return rows;
  }

  private graphicsRows(): Row[] {
    const s = this.settings;
    return [
      this.choice(
        "Graphics Quality",
        "Ultra draws the full circuit with the graphics card. Low draws a simpler, cartoon-style circuit and cars on the processor at full screen resolution, without replays, so the game runs without a graphics card. Switches straight away; press G during a race to swap.",
        choices.graphics,
        () => graphicsLevelOf(s.graphics),
        (id) => {
          s.graphics = id as Settings["graphics"];
        },
      ),
    ];
  }

  private audioRows(): Row[] {
    const s = this.settings;
    return [
      {
        kind: "number",
        label: "Music Volume",
        info: "The volume of the menu, build-up and victory music.",
        min: 0,
        max: 100,
        step: 5,
        base: defaults.musicVolume,
        get: () => s.musicVolume,
        set: (v) => {
          s.musicVolume = v;
        },
        format: (v) => (v === 0 ? "Off" : `${String(v)}%`),
        range: "Off - 100%",
      },
    ];
  }

  private osdRows(): Row[] {
    const s = this.settings;
    const info: Record<HudPart, string> = {
      delta:
        "Enable or disable the delta time on the on-screen display. It compares your current lap with your best lap.",
      sectors:
        "Shows the sector strip above the lap timer. Purple marks a best sector, yellow a slower one.",
      map: "Shows the track map with sectors and your position.",
      proximity:
        "Shows a red arrow on the left or right when a car is alongside or close behind you.",
      lights: "Shows the start lights on the on-screen display.",
      fuel: "Shows the battery gauge and fuel status on the dashboard.",
      tyres:
        "Shows tyre compound, temperatures, wear and pressures in the multi-function display.",
      inputs: "Shows throttle and brake inputs under the gear indicator.",
      help: "Shows the button prompts in the corner of the screen.",
    };
    return (Object.keys(hudParts) as HudPart[]).map((id) =>
      this.toggle(
        hudParts[id],
        info[id],
        () => s.hud[id],
        (v) => {
          s.hud[id] = v;
        },
      ),
    );
  }

  private setupRow(item: SetupItem): NumberRow {
    const car = carOf(this.settings).car;
    const values = (this.settings.setup[car] ??= {});
    const show = (v: number) =>
      `${(v * item.scale).toFixed(decimals(item.step * item.scale))} ${item.unit}`.trim();
    return {
      kind: "number",
      label: item.label,
      info: setupInfo[infoKey(item.id)] ?? "",
      min: item.min,
      max: item.max,
      step: item.step,
      base: item.base,
      get: () => values[item.id] ?? item.base,
      set: (v) => {
        if (Math.abs(v - item.base) < item.step / 2)
          Reflect.deleteProperty(values, item.id);
        else values[item.id] = v;
      },
      format: show,
      range: `Min ${show(item.min)} - ${show(item.max)} Max`,
    };
  }

  private carDrawing(tab: string): HTMLElement {
    const box = el("div", "info-car");
    box.innerHTML = `<svg viewBox="100 -192 940 384" aria-hidden="true"><g transform="rotate(-90)">${carArt}${setupArt}</g></svg>`;
    const focus = setupParts[tab];
    if (focus)
      box.querySelectorAll(focus).forEach((part) => {
        part.classList.add("on");
      });
    return box;
  }

  private tank(): number {
    const car = carOf(this.settings).car;
    const model = ParamDoc.read(
      this.source.fs,
      `/sd/data/cars/models/${car}/${car}.xml`,
    );
    return model?.num("Car", "fuel tank")?.value ?? 100;
  }
}
