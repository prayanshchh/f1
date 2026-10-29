import { ParamDoc } from "./params.ts";
import {
  carOf,
  cars,
  choices,
  defaults,
  type HudPart,
  hudParts,
  practiceFuelLaps,
  readSetup,
  saveSettings,
  type Settings,
  type SetupItem,
  type SetupSource,
  trackOf,
  tracks,
} from "./settings.ts";

export type MenuAction = "start" | "resume" | "restart";

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
  assists:
    "Contains driver assist settings that allow you to make controlling the car easier or more authentic.",
  osd: "Contains settings that allow you to customise the way the on-screen display is shown.",
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

const setupOrder = [
  "Aerodynamics",
  "Transmission",
  "Suspension Geometry",
  "Suspension",
  "Brakes",
  "Tyres",
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function decimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? (text.split(".")[1] ?? "").length : 0;
}

function infoKey(id: string): string {
  if (id.startsWith("gear-")) return "gear";
  return setupInfo[id] ? id : id.replace(/^(front|rear)-/, "");
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
  private resolve: ((action: MenuAction) => void) | null = null;
  private readonly initial: string;

  constructor(
    private readonly source: SetupSource,
    private readonly settings: Settings,
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
      this.finish("resume");
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.root.hidden) return;
        event.stopPropagation();
        this.onKey(event);
      },
      true,
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  async run(inSession: boolean): Promise<MenuAction> {
    this.inSession = inSession;
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
        if (this.inSession) this.finish("resume");
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
    saveSettings(this.settings);
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
        info: tabIntro["session"] ?? "",
        setup: false,
        rows: () => this.sessionRows(),
        reset: () => {
          Object.assign(this.settings, {
            session: defaults.session,
            laps: defaults.laps,
            fuel: defaults.fuel,
            timeOfDay: defaults.timeOfDay,
            clouds: defaults.clouds,
            rain: defaults.rain,
            season: defaults.season,
          });
        },
      },
      {
        id: "assists",
        label: "Assists",
        title: "Assists",
        info: tabIntro["assists"] ?? "",
        setup: false,
        rows: () => this.assistRows(),
        reset: () => {
          Object.assign(this.settings, {
            skill: defaults.skill,
            transmission: defaults.transmission,
            autoReverse: defaults.autoReverse,
            assist: defaults.assist,
            abs: defaults.abs,
            tc: defaults.tc,
            steerSensitivity: defaults.steerSensitivity,
            steerSpeedSensitivity: defaults.steerSpeedSensitivity,
            steerDeadZone: defaults.steerDeadZone,
          });
        },
      },
      ...setupTabs,
      {
        id: "osd",
        label: "On-Screen Display",
        title: "On-Screen Display",
        info: tabIntro["osd"] ?? "",
        setup: false,
        rows: () => this.osdRows(),
        reset: () => {
          this.settings.hud = { ...defaults.hud };
        },
      },
    ];
  }

  private current(): Tab {
    const all = this.tabs();
    return all.find((t) => t.id === this.tab) ?? (all[0] as Tab);
  }

  private show(tab: string, focus = 0, animate = true): void {
    this.tab = tab;
    const all = this.tabs();
    const active = this.current();
    this.tabBar.replaceChildren(
      ...all.map((t) => {
        const button = el("button", "tab", t.label);
        button.type = "button";
        button.classList.toggle("active", t.id === active.id);
        button.addEventListener("click", () => {
          if (t.id !== this.tab) this.show(t.id);
        });
        return button;
      }),
      el("i", "btn-glyph", "Q"),
      el("i", "btn-glyph", "E"),
    );
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
    if (tab.setup) parts.push(this.carDrawing());
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
    saveSettings(this.settings);
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
    this.find("resume").hidden = !this.inSession;
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
    this.find("strip-mode").textContent =
      s.session === "race" ? `Race - ${String(s.laps)} Laps` : "Practice";
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
      stat(
        "Weather",
        s.rain === "none"
          ? label(choices.clouds, s.clouds)
          : label(choices.rain, s.rain),
      ),
    );
  }

  private resetTab(): void {
    this.current().reset();
    saveSettings(this.settings);
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

  private sessionRows(): Row[] {
    const s = this.settings;
    const fuel = this.fuelInfo();
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
        "Car",
        cars.map((c) => `${c.label}: ${c.detail}`).join(". ") + ".",
        cars.map((c) => ({ id: c.id, label: c.label })),
        () => s.car,
        (id) => {
          s.car = id;
        },
        true,
      ),
      this.choice(
        "Session Type",
        "Practice runs an open session to set lap times. Race runs a fixed number of laps and ends with the classification.",
        choices.session,
        () => s.session,
        (id) => {
          s.session = id as Settings["session"];
        },
        true,
      ),
    ];
    if (s.session === "race")
      rows.push({
        kind: "number",
        label: "Race Distance",
        info: "The number of laps in the race.",
        min: 1,
        max: 99,
        step: 1,
        base: defaults.laps,
        get: () => s.laps,
        set: (v) => {
          s.laps = v;
        },
        format: (v) => `${String(v)} Laps`,
        range: "Min 1 - 99 Max",
        rerender: true,
      });
    rows.push(
      {
        kind: "number",
        label: "Fuel Load",
        info: "Auto fills enough fuel for the session plus one lap. Running out of fuel stops the car.",
        min: 0,
        max: fuel.tank,
        step: 1,
        base: 0,
        get: () => s.fuel,
        set: (v) => {
          s.fuel = v;
        },
        format: (v) => {
          const laps =
            v > 0
              ? v / fuel.perLap
              : s.session === "race"
                ? s.laps + 1
                : practiceFuelLaps + 1;
          return v > 0
            ? `${String(v)} L (${laps.toFixed(1)} Laps)`
            : `Auto (${laps.toFixed(1)} Laps)`;
        },
        range: `Min 0 - ${String(fuel.tank)} Max`,
      },
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
        "Clouds",
        "Sets the cloud cover over the circuit.",
        choices.clouds,
        () => s.clouds,
        (id) => {
          s.clouds = id as Settings["clouds"];
        },
      ),
      this.choice(
        "Rain",
        "Sets the amount of rain. Wet weather reduces grip.",
        choices.rain,
        () => s.rain,
        (id) => {
          s.rain = id as Settings["rain"];
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

  private assistRows(): Row[] {
    const s = this.settings;
    const rows: Row[] = [
      this.choice(
        "Driving Proficiency",
        "Speed Dreams scales downforce with skill: Arcade x4, Rookie x3, Amateur x2, Semi-pro and Pro x1. Semi-pro and Pro also turn on tyre temperature, tyre wear and full damage.",
        choices.skill,
        () => s.skill,
        (id) => {
          s.skill = id as Settings["skill"];
        },
      ),
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
      this.toggle(
        "Auto Reverse",
        "Selects reverse automatically when you hold the brake while stopped.",
        () => s.autoReverse,
        (v) => {
          s.autoReverse = v;
        },
      ),
      this.toggle(
        "Steering Assist",
        "Smooths keyboard and phone steering and adds its own traction control and ABS. Turn it off to use Speed Dreams' own ABS, traction control and steering sensitivity.",
        () => s.assist,
        (v) => {
          s.assist = v;
        },
        true,
      ),
    ];
    if (s.assist) return rows;
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

  private osdRows(): Row[] {
    const s = this.settings;
    const info: Record<HudPart, string> = {
      delta:
        "Enable or disable the delta time on the on-screen display. It compares your current lap with your best lap.",
      sectors:
        "Shows the sector strip above the lap timer. Purple marks a best sector, yellow a slower one.",
      map: "Shows the track map with sectors and your position.",
      lights: "Shows the start lights on the on-screen display.",
      fuel: "Shows the fuel gauge on the left of the dashboard.",
      tyres: "Shows tyre temperatures and wear in the multi-function display.",
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

  private carDrawing(): HTMLElement {
    const box = el("div", "info-car");
    box.innerHTML =
      '<svg viewBox="0 0 520 130" aria-hidden="true"><path d="M8 96 L60 92 L72 78 L118 78 L132 70 L196 66 L228 46 L262 44 L282 58 L330 60 L372 56 L420 52 L470 40 L506 40 L510 86 L470 92 L440 98 L130 100 L60 104 Z"/><circle cx="118" cy="96" r="30"/><circle cx="118" cy="96" r="8"/><circle cx="440" cy="96" r="30"/><circle cx="440" cy="96" r="8"/><path d="M468 40 L470 20 L512 18 L512 40"/><path d="M8 96 L4 108 L64 108"/><path d="M232 46 Q250 24 272 28"/></svg>';
    return box;
  }

  private fuelInfo(): { tank: number; perLap: number } {
    const car = carOf(this.settings).car;
    const model = ParamDoc.read(
      this.source.fs,
      `/sd/data/cars/models/${car}/${car}.xml`,
    );
    const tank = model?.num("Car", "fuel tank")?.value ?? 100;
    const factor = model?.num("Engine", "fuel cons factor")?.value ?? 1;
    return { tank, perLap: trackOf(this.settings).length * 0.0005 * factor };
  }
}
