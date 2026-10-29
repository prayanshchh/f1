import { ParamDoc } from "./params.ts";
import {
  carOf,
  cars,
  choices,
  defaults,
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

type Tab = "session" | "driver" | "setup" | "hud";
export type MenuAction = "start" | "resume" | "restart";

const tabs: { id: Tab; label: string }[] = [
  { id: "session", label: "Session" },
  { id: "driver", label: "Driver" },
  { id: "setup", label: "Car setup" },
  { id: "hud", label: "HUD" },
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

export class Menu {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabBar: HTMLElement;
  private tab: Tab = "session";
  private inSession = false;
  private resolve: ((action: MenuAction) => void) | null = null;
  private readonly initial: string;

  constructor(
    private readonly source: SetupSource,
    private readonly settings: Settings,
  ) {
    const find = (id: string) => {
      const node = document.querySelector<HTMLElement>(`[data-menu="${id}"]`);
      if (!node) throw new Error(`missing menu element ${id}`);
      return node;
    };
    this.root = find("root");
    this.body = find("body");
    this.tabBar = find("tabs");
    this.initial = JSON.stringify({ ...settings, hud: null });
    for (const tab of tabs) {
      const button = el("button", "tab", tab.label);
      button.type = "button";
      button.dataset["tab"] = tab.id;
      button.addEventListener("click", () => {
        this.show(tab.id);
      });
      this.tabBar.append(button);
    }
    find("reset").addEventListener("click", () => {
      this.resetTab();
    });
    find("start").addEventListener("click", () => {
      this.finish(this.inSession ? "restart" : "start");
    });
    find("resume").addEventListener("click", () => {
      this.finish("resume");
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.root.hidden) return;
        event.stopPropagation();
        if (event.key === "Escape" && this.inSession) this.finish("resume");
        if (
          event.key === "Enter" &&
          !(event.target instanceof HTMLButtonElement)
        )
          this.finish(this.inSession ? "restart" : "start");
      },
      true,
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(tab: Tab = this.tab): void {
    this.tab = tab;
    for (const button of Array.from(this.tabBar.children)) {
      if (button instanceof HTMLElement)
        button.classList.toggle("active", button.dataset["tab"] === tab);
    }
    this.body.replaceChildren(...this.render(tab));
    this.body.dataset["tab"] = tab;
    this.refreshFooter();
  }

  async run(inSession: boolean): Promise<MenuAction> {
    this.inSession = inSession;
    const title = document.querySelector<HTMLElement>("[data-menu=title]");
    if (title) title.textContent = inSession ? "Paused" : "Race setup";
    this.root.hidden = false;
    requestAnimationFrame(() => {
      this.root.classList.add("open");
    });
    this.show();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private finish(action: MenuAction): void {
    saveSettings(this.settings);
    this.root.classList.remove("open");
    this.root.hidden = true;
    this.resolve?.(action);
    this.resolve = null;
  }

  private changed(): void {
    saveSettings(this.settings);
    this.refreshFooter();
  }

  private refreshFooter(): void {
    const dirty =
      JSON.stringify({ ...this.settings, hud: null }) !== this.initial;
    const start = document.querySelector<HTMLElement>("[data-menu=start]");
    const resume = document.querySelector<HTMLElement>("[data-menu=resume]");
    const note = document.querySelector<HTMLElement>("[data-menu=note]");
    const subtitle = document.querySelector<HTMLElement>(
      "[data-menu=subtitle]",
    );
    if (start) start.textContent = this.inSession ? "Restart session" : "Start";
    if (resume) resume.hidden = !this.inSession;
    if (note)
      note.textContent =
        this.inSession && dirty
          ? "Changes apply when the session restarts"
          : this.inSession
            ? "HUD changes apply on resume"
            : "Enter to start";
    if (subtitle)
      subtitle.textContent = `${trackOf(this.settings).label} · ${carOf(this.settings).label} · ${this.settings.session === "race" ? `${String(this.settings.laps)} laps` : "Practice"}`;
  }

  private resetTab(): void {
    const s = this.settings;
    if (this.tab === "session") {
      Object.assign(s, {
        session: defaults.session,
        laps: defaults.laps,
        fuel: defaults.fuel,
        timeOfDay: defaults.timeOfDay,
        clouds: defaults.clouds,
        rain: defaults.rain,
        season: defaults.season,
      });
    }
    if (this.tab === "driver") {
      Object.assign(s, {
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
    }
    if (this.tab === "setup") s.setup[carOf(s).car] = {};
    if (this.tab === "hud") s.hud = { ...defaults.hud };
    this.changed();
    this.show();
  }

  private render(tab: Tab): HTMLElement[] {
    if (tab === "session") return this.sessionTab();
    if (tab === "driver") return this.driverTab();
    if (tab === "setup") return this.setupTab();
    return this.hudTab();
  }

  private sessionTab(): HTMLElement[] {
    const s = this.settings;
    const fuel = this.fuelInfo();
    const rows: HTMLElement[] = [
      this.group("Circuit", [
        this.cards(
          tracks.map((t) => ({ id: t.id, label: t.label, detail: t.detail })),
          () => s.track,
          (id) => {
            s.track = id;
          },
        ),
      ]),
      this.group("Car", [
        this.cards(
          cars.map((c) => ({ id: c.id, label: c.label, detail: c.detail })),
          () => s.car,
          (id) => {
            s.car = id;
          },
        ),
      ]),
      this.group("Session", [
        this.row(
          "Type",
          this.segmented(
            choices.session,
            () => s.session,
            (id) => {
              s.session = id;
            },
            true,
          ),
        ),
        ...(s.session === "race"
          ? [
              this.row(
                "Laps",
                this.stepper(s.laps, 1, 99, (v) => {
                  s.laps = v;
                }),
              ),
            ]
          : []),
        this.row(
          "Fuel",
          this.slider({
            min: 0,
            max: fuel.tank,
            step: 1,
            value: s.fuel,
            base: 0,
            format: (v) => {
              const laps =
                v > 0
                  ? v / fuel.perLap
                  : s.session === "race"
                    ? s.laps + 1
                    : practiceFuelLaps + 1;
              const litres =
                v > 0
                  ? `${String(v)} L`
                  : `Auto · ${(laps * fuel.perLap).toFixed(1)} L`;
              return `${litres} · ≈ ${laps.toFixed(1)} laps`;
            },
            onChange: (v) => {
              s.fuel = v;
            },
          }),
        ),
      ]),
      this.group("Conditions", [
        this.row(
          "Time of day",
          this.segmented(
            choices.timeOfDay,
            () => s.timeOfDay,
            (id) => {
              s.timeOfDay = id;
            },
          ),
        ),
        this.row(
          "Clouds",
          this.segmented(
            choices.clouds,
            () => s.clouds,
            (id) => {
              s.clouds = id;
            },
          ),
        ),
        this.row(
          "Rain",
          this.segmented(
            choices.rain,
            () => s.rain,
            (id) => {
              s.rain = id;
            },
          ),
        ),
        this.row(
          "Season",
          this.segmented(
            choices.season,
            () => s.season,
            (id) => {
              s.season = id;
            },
          ),
        ),
      ]),
    ];
    return rows;
  }

  private driverTab(): HTMLElement[] {
    const s = this.settings;
    const assistRows = s.assist
      ? [
          el(
            "p",
            "hint",
            "The input assist smooths keyboard and phone steering and adds its own traction control and ABS. Turn it off to use Speed Dreams' own ABS, traction control and steering sensitivity.",
          ),
        ]
      : [
          this.row(
            "ABS",
            this.toggle(
              () => s.abs,
              (v) => {
                s.abs = v;
              },
            ),
          ),
          this.row(
            "Traction control",
            this.toggle(
              () => s.tc,
              (v) => {
                s.tc = v;
              },
            ),
          ),
          this.row(
            "Steering sensitivity",
            this.slider({
              min: 0.1,
              max: 1.5,
              step: 0.05,
              value: s.steerSensitivity,
              base: defaults.steerSensitivity,
              format: (v) => v.toFixed(2),
              onChange: (v) => {
                s.steerSensitivity = v;
              },
            }),
          ),
          this.row(
            "Speed sensitivity",
            this.slider({
              min: 0,
              max: 1.5,
              step: 0.05,
              value: s.steerSpeedSensitivity,
              base: defaults.steerSpeedSensitivity,
              format: (v) => v.toFixed(2),
              onChange: (v) => {
                s.steerSpeedSensitivity = v;
              },
            }),
          ),
          this.row(
            "Dead zone",
            this.slider({
              min: 0,
              max: 0.3,
              step: 0.01,
              value: s.steerDeadZone,
              base: defaults.steerDeadZone,
              format: (v) => v.toFixed(2),
              onChange: (v) => {
                s.steerDeadZone = v;
              },
            }),
          ),
        ];
    return [
      this.group("Skill", [
        this.row(
          "Level",
          this.segmented(
            choices.skill,
            () => s.skill,
            (id) => {
              s.skill = id;
            },
          ),
        ),
        el(
          "p",
          "hint",
          "Speed Dreams scales downforce with skill: Arcade ×4, Rookie ×3, Amateur ×2, Semi-pro and Pro ×1. Semi-pro and Pro also turn on tyre temperature, tyre wear and full damage.",
        ),
      ]),
      this.group("Gearbox", [
        this.row(
          "Shifting",
          this.segmented(
            choices.transmission,
            () => s.transmission,
            (id) => {
              s.transmission = id;
            },
          ),
        ),
        this.row(
          "Auto reverse",
          this.toggle(
            () => s.autoReverse,
            (v) => {
              s.autoReverse = v;
            },
          ),
        ),
      ]),
      this.group("Assists", [
        this.row(
          "Input assist",
          this.toggle(
            () => s.assist,
            (v) => {
              s.assist = v;
              this.show();
            },
          ),
        ),
        ...assistRows,
      ]),
    ];
  }

  private setupTab(): HTMLElement[] {
    const car = carOf(this.settings).car;
    const values = (this.settings.setup[car] ??= {});
    const items = readSetup(this.source, car);
    const groups = new Map<string, SetupItem[]>();
    for (const item of items)
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    const intro = el(
      "p",
      "hint",
      `${carOf(this.settings).label} — values start at the Speed Dreams garage defaults. The dot under each slider marks the default.`,
    );
    return [
      intro,
      ...Array.from(groups.entries()).map(([name, list]) =>
        this.group(
          name,
          list.map((item) =>
            this.row(
              item.label,
              this.slider({
                min: item.min,
                max: item.max,
                step: item.step,
                value: values[item.id] ?? item.base,
                base: item.base,
                format: (v) =>
                  `${(v * item.scale).toFixed(decimals(item.step * item.scale))} ${item.unit}`.trim(),
                onChange: (v) => {
                  if (Math.abs(v - item.base) < item.step / 2)
                    Reflect.deleteProperty(values, item.id);
                  else values[item.id] = v;
                },
              }),
            ),
          ),
        ),
      ),
    ];
  }

  private hudTab(): HTMLElement[] {
    const s = this.settings;
    return [
      this.group(
        "Show on screen",
        Object.entries(hudParts).map(([id, label]) =>
          this.row(
            label,
            this.toggle(
              () => s.hud[id as keyof typeof hudParts],
              (v) => {
                s.hud[id as keyof typeof hudParts] = v;
              },
            ),
          ),
        ),
      ),
    ];
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

  private group(title: string, children: HTMLElement[]): HTMLElement {
    const section = el("section", "group");
    section.append(el("h2", "", title), ...children);
    return section;
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    const row = el("div", "row");
    row.append(el("label", "", label), control);
    return row;
  }

  private cards(
    options: { id: string; label: string; detail: string }[],
    get: () => string,
    set: (id: string) => void,
  ): HTMLElement {
    const wrap = el("div", "cards");
    for (const option of options) {
      const card = el("button", "card");
      card.type = "button";
      card.append(el("b", "", option.label), el("span", "", option.detail));
      card.classList.toggle("active", get() === option.id);
      card.addEventListener("click", () => {
        set(option.id);
        this.changed();
        this.show();
      });
      wrap.append(card);
    }
    return wrap;
  }

  private segmented<T extends string>(
    options: readonly { id: T; label: string }[],
    get: () => T,
    set: (id: T) => void,
    rerender = false,
  ): HTMLElement {
    const wrap = el("div", "segmented");
    const buttons = options.map((option) => {
      const button = el("button", "", option.label);
      button.type = "button";
      button.addEventListener("click", () => {
        set(option.id);
        for (const [i, b] of buttons.entries())
          b.classList.toggle("active", options[i]?.id === get());
        this.changed();
        if (rerender) this.show();
      });
      return button;
    });
    for (const [i, b] of buttons.entries())
      b.classList.toggle("active", options[i]?.id === get());
    wrap.append(...buttons);
    return wrap;
  }

  private toggle(get: () => boolean, set: (on: boolean) => void): HTMLElement {
    const button = el("button", "toggle");
    button.type = "button";
    button.append(el("i"));
    button.classList.toggle("on", get());
    button.addEventListener("click", () => {
      set(!get());
      button.classList.toggle("on", get());
      this.changed();
    });
    return button;
  }

  private stepper(
    value: number,
    min: number,
    max: number,
    set: (v: number) => void,
  ): HTMLElement {
    const wrap = el("div", "stepper");
    const less = el("button", "", "−");
    const more = el("button", "", "+");
    const out = el("output", "", String(value));
    let current = value;
    const step = (d: number) => {
      current = Math.max(min, Math.min(max, current + d));
      out.textContent = String(current);
      set(current);
      this.changed();
    };
    less.type = "button";
    more.type = "button";
    less.addEventListener("click", () => {
      step(-1);
    });
    more.addEventListener("click", () => {
      step(1);
    });
    wrap.append(less, out, more);
    return wrap;
  }

  private slider(spec: {
    min: number;
    max: number;
    step: number;
    value: number;
    base: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
  }): HTMLElement {
    const wrap = el("div", "slider");
    const input = el("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.value);
    const out = el("output");
    const mark = el("i", "base");
    const span = spec.max - spec.min || 1;
    mark.style.left = `${String(((spec.base - spec.min) / span) * 100)}%`;
    const paint = () => {
      const v = Number(input.value);
      out.textContent = spec.format(v);
      wrap.style.setProperty(
        "--fill",
        `${String(((v - spec.min) / span) * 100)}%`,
      );
      wrap.classList.toggle(
        "changed",
        Math.abs(v - spec.base) >= spec.step / 2,
      );
    };
    input.addEventListener("input", () => {
      spec.onChange(Number(input.value));
      paint();
      this.changed();
    });
    input.addEventListener("dblclick", () => {
      input.value = String(spec.base);
      spec.onChange(spec.base);
      paint();
      this.changed();
    });
    const track = el("div", "slider-track");
    track.append(input, mark);
    wrap.append(track, out);
    paint();
    return wrap;
  }
}
