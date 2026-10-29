import { frameIndex, type HudInfo, outOfRaceState } from "./engine.ts";
import type { LapResult, LapTrace } from "./laptrace.ts";
import type { HudPart } from "./settings.ts";

export function lapTime(seconds: number | null): string {
  if (seconds === null || !(seconds > 0)) return "--:--.---";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes)}:${rest.toFixed(3).padStart(6, "0")}`;
}

function shortTime(seconds: number | null): string {
  if (seconds === null || !(seconds > 0)) return "--:--.---";
  return seconds < 60 ? seconds.toFixed(3) : lapTime(seconds);
}

export function signed(seconds: number): string {
  return `${seconds < 0 ? "-" : "+"}${Math.abs(seconds).toFixed(3)}`;
}

function gearLabel(gear: number): string {
  if (gear < 0) return "R";
  if (gear === 0) return "N";
  return String(gear);
}

function tyreState(temp: number, optimal: number): string {
  const d = temp - optimal;
  if (d < -25) return "cold";
  if (d < -10) return "cool";
  if (d > 25) return "hot";
  if (d > 10) return "warm";
  return "ok";
}

function replay(element: HTMLElement | SVGElement, name: string): void {
  element.classList.remove(name);
  void element.getBoundingClientRect();
  element.classList.add(name);
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}

const revLeds = 15;
const lightCount = 5;
const sectorColors = ["map-s1", "map-s2", "map-s3"];

export interface TrackMap {
  points: [number, number][];
  length: number;
}

export interface HudOptions {
  totalLaps: number | null;
  parts: Record<HudPart, boolean>;
  session: string;
  reference: number | null;
  map: TrackMap | null;
}

interface Toast {
  kind: string;
  title: string;
  detail: string;
  until: number;
}

export class Hud {
  readonly laps: LapResult[] = [];
  private readonly find: (id: string) => HTMLElement;
  private readonly leds: HTMLElement[] = [];
  private readonly lights: HTMLElement[] = [];
  private readonly sectorCells: HTMLElement[] = [];
  private readonly tyres: { text: HTMLElement; shape: Element }[] = [];
  private readonly rows: {
    root: HTMLElement;
    pos: HTMLElement;
    gap: HTMLElement;
    tyre: HTMLElement;
  }[] = [];
  private mapCar: SVGCircleElement | null = null;
  private mapPath: SVGPathElement | null = null;
  private mapLength = 1;
  private sessionBest: number | null = null;
  private toast: Toast | null = null;
  private toastShown = "";
  private freezeUntil = 0;
  private extraUntil = 0;
  private lastActiveSector = -1;
  private lapFuel: number | null = null;
  private fuelAtLapStart: number | null = null;
  private lastLap = -1;
  private deltaShown = 0;
  private finalLapShown = false;
  private tyreMood = "ok";
  private countdown = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly trace: LapTrace,
    private readonly options: HudOptions,
  ) {
    this.find = (id: string) => {
      const element = root.querySelector<HTMLElement>(`[data-hud="${id}"]`);
      if (!element) throw new Error(`missing HUD element ${id}`);
      return element;
    };
    const strip = this.find("leds");
    for (let i = 0; i < revLeds; i++) {
      const led = document.createElement("i");
      led.className = i < 5 ? "g" : i < 10 ? "r" : "b";
      strip.append(led);
      this.leds.push(led);
    }
    const gantry = this.find("lights");
    for (let i = 0; i < lightCount; i++) {
      const light = document.createElement("i");
      gantry.append(light);
      this.lights.push(light);
    }
    const sectors = this.find("sectors");
    const count = trace.sectors(0).times.length;
    for (let i = 0; i < count; i++) {
      const cell = document.createElement("div");
      cell.textContent = `S${String(i + 1)}`;
      sectors.append(cell);
      this.sectorCells.push(cell);
    }
    for (const id of ["fl", "fr", "rl", "rr"]) {
      const text = this.find(`tyre-${id}`);
      const shape = this.find(`tyre-shape-${id}`);
      this.tyres.push({ text, shape });
    }
    this.find("session").textContent = options.session;
    this.find("lap-total").textContent = options.totalLaps
      ? ` / ${String(options.totalLaps)}`
      : "";
    this.buildRows();
    this.buildMap(options.map);
    this.setParts(options.parts);
  }

  setParts(parts: Record<HudPart, boolean>): void {
    for (const [part, on] of Object.entries(parts))
      this.root.classList.toggle(`no-${part}`, !on);
  }

  update(frame: Float64Array, info: HudInfo, now: number): void {
    const value = (index: number) => frame[index] ?? 0;
    const time = value(frameIndex.time);
    const laps = value(frameIndex.laps);
    const distance = value(frameIndex.distFromStart);
    const current = value(frameIndex.curLapTime);
    const result = this.trace.sample(
      laps,
      distance,
      current,
      value(frameIndex.lastLapTime),
    );
    if (result) {
      this.laps.push(result);
      this.showLap(result, now);
    }
    this.updateDash(value, info);
    this.updateTiming(value, laps, distance, current, now);
    this.updateFuel(info, laps);
    this.updateTyres(info);
    this.updateInputs(value);
    this.updateLights(time);
    this.updateMap(distance);
    this.updateWarnings(info, laps, now);
    this.updateToast(now);
  }

  private buildRows(): void {
    const list = this.find("rows");
    const names = ["You", "Personal Best"];
    for (const name of names) {
      const root = document.createElement("li");
      const pos = document.createElement("span");
      pos.className = "row-pos";
      const label = document.createElement("span");
      label.className = "row-name";
      label.textContent = name;
      const tyre = document.createElement("i");
      tyre.className = "row-tyre";
      const gap = document.createElement("b");
      gap.className = "row-gap";
      const flag = document.createElement("i");
      flag.className = "row-flag";
      flag.innerHTML = '<svg><use href="#stopwatch" /></svg>';
      root.append(pos, label, tyre, gap, flag);
      root.dataset["me"] = name === "You" ? "1" : "";
      root.hidden = name !== "You" && this.options.reference === null;
      list.append(root);
      this.rows.push({ root, pos, gap, tyre });
    }
    this.renderRows();
  }

  private renderRows(): void {
    const mine = this.sessionBest;
    const reference = this.options.reference;
    const entries = [
      { row: this.rows[0], time: mine },
      { row: this.rows[1], time: reference },
    ];
    const ranked = [...entries].sort(
      (a, b) => (a.time ?? Infinity) - (b.time ?? Infinity),
    );
    const fastest = ranked[0]?.time ?? null;
    ranked.forEach((entry, i) => {
      const row = entry.row;
      if (!row) return;
      row.root.style.order = String(i);
      row.pos.textContent = String(i + 1);
      const isMe = row.root.dataset["me"] === "1";
      row.root.classList.toggle(
        "fastest",
        fastest !== null && entry.time === fastest,
      );
      row.gap.textContent =
        isMe || mine === null || entry.time === null
          ? "--:--.---"
          : signed(entry.time - mine);
    });
  }

  private buildMap(map: TrackMap | null): void {
    const root = this.find("map") as unknown as SVGSVGElement;
    if (!map || map.points.length < 3) {
      root.classList.add("empty");
      return;
    }
    const xs = map.points.map((p) => p[0]);
    const ys = map.points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const size = 300;
    const pad = 22;
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxY - minY, 1);
    const offX = (size - (maxX - minX) * scale) / 2;
    const offY = (size - (maxY - minY) * scale) / 2;
    const project = (p: [number, number]): [number, number] => [
      offX + (p[0] - minX) * scale,
      size - (offY + (p[1] - minY) * scale),
    ];
    const screen = map.points.map(project);
    root.setAttribute("viewBox", `0 0 ${String(size)} ${String(size)}`);
    const d = `M${screen.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}Z`;
    const groups = this.find("map-sectors");
    groups.append(
      svg("path", { d, class: "map-edge" }),
      svg("path", { d, class: "map-line" }),
    );
    const boundaries = this.trace.boundaries;
    const cuts = [0, ...boundaries, map.length];
    const step = map.length / (map.points.length - 1 || 1);
    cuts.slice(0, -1).forEach((start, i) => {
      const end = cuts[i + 1] ?? map.length;
      const from = Math.floor(start / step);
      const to = Math.min(screen.length - 1, Math.ceil(end / step));
      const part = screen.slice(from, to + 1);
      if (part.length < 2) return;
      const pd = `M${part.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}`;
      groups.append(
        svg("path", {
          d: pd,
          class: `map-sector ${sectorColors[i] ?? ""}`,
          "data-sector": i,
        }),
      );
    });
    const marks = this.find("map-marks");
    const at = (distance: number): [number, number] =>
      screen[Math.min(screen.length - 1, Math.round(distance / step))] ?? [
        0, 0,
      ];
    const [sx, sy] = at(0);
    marks.append(
      svg("rect", {
        x: sx - 7,
        y: sy - 4,
        width: 14,
        height: 8,
        class: "map-start",
      }),
    );
    boundaries.forEach((b, i) => {
      const [x, y] = at(b);
      const ring = svg("circle", { cx: x, cy: y, r: 6, class: "map-split" });
      marks.append(ring);
      const [lx, ly] = at((b + (cuts[i] ?? 0)) / 2);
      const label = svg("text", { x: lx, y: ly, class: "map-num" });
      label.textContent = String(i + 1);
      marks.append(label);
    });
    const [lx, ly] = at(((boundaries.at(-1) ?? 0) + map.length) / 2);
    const label = svg("text", { x: lx, y: ly, class: "map-num" });
    label.textContent = String(boundaries.length + 1);
    marks.append(label);
    this.mapPath = svg("path", { d, class: "map-hidden" });
    groups.append(this.mapPath);
    this.mapLength = map.length;
    this.mapCar = this.find("map-car") as unknown as SVGCircleElement;
  }

  private updateMap(distance: number): void {
    if (!this.mapCar || !this.mapPath) return;
    const total = this.mapPath.getTotalLength();
    const point = this.mapPath.getPointAtLength(
      ((((distance / this.mapLength) % 1) + 1) % 1) * total,
    );
    this.mapCar.setAttribute("cx", point.x.toFixed(1));
    this.mapCar.setAttribute("cy", point.y.toFixed(1));
  }

  private updateDash(value: (index: number) => number, info: HudInfo): void {
    const rpm = value(frameIndex.rpm) * (30 / Math.PI);
    const redLine = Math.max(1, value(frameIndex.rpmRedLine) * (30 / Math.PI));
    this.find("speed").textContent = String(
      Math.round(Math.abs(value(frameIndex.speed)) * 3.6),
    );
    this.find("gear").textContent = gearLabel(value(frameIndex.gear));
    this.find("rpm").textContent = String(Math.round(rpm));
    const fraction = rpm / redLine;
    const lit = Math.round(((fraction - 0.7) / 0.28) * revLeds);
    this.leds.forEach((led, i) => {
      led.classList.toggle("on", i < lit);
    });
    this.find("leds").classList.toggle("flash", fraction > 0.98);
    const ring = this.find("rpm-ring");
    ring.style.strokeDashoffset = String(100 - Math.min(1, fraction) * 75);
    ring.dataset["zone"] =
      fraction > 0.97 ? "limit" : fraction > 0.85 ? "high" : "";
    const damage = info.maxDamage > 0 ? info.damage / info.maxDamage : 0;
    const box = this.find("damage");
    box.style.setProperty("--damage", String(Math.min(1, damage)));
    box.hidden = damage < 0.02;
  }

  private updateTiming(
    value: (index: number) => number,
    laps: number,
    distance: number,
    current: number,
    now: number,
  ): void {
    const total = this.options.totalLaps;
    this.find("lap").textContent = String(
      total ? Math.max(1, Math.min(laps, total)) : Math.max(1, laps),
    );
    if (now > this.freezeUntil) {
      this.find("current").textContent = shortTime(laps > 0 ? current : 0);
      this.find("main").dataset["state"] = "";
    }
    const best = value(frameIndex.bestLapTime);
    this.find("best").textContent = lapTime(best);
    this.find("last").textContent = lapTime(value(frameIndex.lastLapTime));
    this.find("extra").classList.toggle("open", now < this.extraUntil);
    this.updateSectors(laps, distance, now);
    this.updateDelta(laps, distance, current);
  }

  private updateSectors(laps: number, distance: number, now: number): void {
    const sectors = this.trace.sectors(distance);
    this.sectorCells.forEach((cell, i) => {
      const status = sectors.status[i] ?? null;
      cell.dataset["status"] =
        status ?? (i === sectors.active && laps > 0 ? "live" : "");
    });
    this.root
      .querySelectorAll<SVGPathElement>(".map-sector")
      .forEach((path) => {
        const i = Number(path.dataset["sector"]);
        path.dataset["status"] = sectors.status[i] ?? "";
      });
    if (sectors.active === this.lastActiveSector) return;
    const closed = sectors.active - 1;
    const time = sectors.times[closed];
    if (time !== undefined && time !== null) {
      const cell = this.sectorCells[closed];
      if (cell) replay(cell, "fill");
      const split = sectors.times
        .slice(0, closed + 1)
        .reduce<number>((sum, t) => sum + (t ?? 0), 0);
      this.find("current").textContent = shortTime(split);
      this.find("main").dataset["state"] = sectors.status[closed] ?? "";
      replay(this.find("main"), "flash");
      this.freezeUntil = now + 3;
    }
    this.lastActiveSector = sectors.active;
  }

  private updateDelta(laps: number, distance: number, current: number): void {
    const delta = this.trace.delta(distance, current);
    const widget = this.find("delta");
    if (delta === null) {
      widget.dataset["state"] = "idle";
      this.find("delta-value").textContent = laps > 0 ? "--.---" : "";
      return;
    }
    this.deltaShown += (delta - this.deltaShown) * 0.25;
    const shown = this.deltaShown;
    widget.dataset["state"] = shown <= 0 ? "ahead" : "behind";
    this.find("delta-value").textContent = signed(shown);
  }

  private updateFuel(info: HudInfo, laps: number): void {
    if (laps !== this.lastLap) {
      if (
        this.fuelAtLapStart !== null &&
        laps === this.lastLap + 1 &&
        this.lastLap >= 1
      ) {
        const used = this.fuelAtLapStart - info.fuel;
        if (used > 0.05) this.lapFuel = used;
      }
      this.fuelAtLapStart = info.fuel;
      this.lastLap = laps;
    }
    const share = Math.min(1, info.fuel / Math.max(1, info.tank));
    this.find("fuel").textContent = `${String(Math.round(share * 100))}%`;
    this.find("fuel-ring").style.strokeDashoffset = String(100 - share * 75);
    const lapsLeft = this.lapFuel ? info.fuel / this.lapFuel : null;
    const low = lapsLeft !== null && lapsLeft < 1.2;
    this.find("dash").classList.toggle("low-fuel", low);
    this.find("status").textContent =
      lapsLeft === null
        ? `${info.fuel.toFixed(1)} L`
        : `Fuel ${lapsLeft.toFixed(1)} laps`;
  }

  private updateTyres(info: HudInfo): void {
    const order = [1, 0, 3, 2];
    const moods: string[] = [];
    this.tyres.forEach((tyre, i) => {
      const wheel = order[i] ?? 0;
      const temp = info.tyreTemp[wheel] ?? 0;
      const optimal = info.tyreOptimal[wheel] ?? temp;
      const mood = tyreState(temp, optimal);
      moods.push(mood);
      tyre.shape.setAttribute("data-state", mood);
      const wear = Math.max(0, Math.min(1, info.tyreTread[wheel] ?? 1));
      tyre.text.dataset["state"] = mood;
      tyre.text.innerHTML = `<span><b>${String(Math.round(temp - 273.15))}°C</b><i class="dot"></i></span><span><b>${String(Math.round((1 - wear) * 100))}%</b><i class="wear"></i></span>`;
    });
    const mood = moods.includes("hot")
      ? "hot"
      : moods.includes("cold")
        ? "cold"
        : moods.every((m) => m === "ok")
          ? "ok"
          : "warm";
    if (mood !== this.tyreMood) {
      this.tyreMood = mood;
      for (const row of this.rows) row.tyre.dataset["state"] = mood;
    }
  }

  private updateInputs(value: (index: number) => number): void {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    this.find("in-throttle").style.transform =
      `scaleX(${String(clamp(value(frameIndex.accel)))})`;
    this.find("in-brake").style.transform =
      `scaleX(${String(clamp(value(frameIndex.brake)))})`;
  }

  private updateLights(time: number): void {
    const gantry = this.find("lights");
    const lit =
      time < 0 ? Math.min(lightCount, Math.floor((time + 2) / 0.4) + 1) : 0;
    this.lights.forEach((light, i) => {
      light.classList.toggle("on", i < lit);
    });
    if (time < 0) this.countdown = true;
    gantry.classList.toggle("show", this.countdown && time < 1);
    gantry.classList.toggle("out", time >= 0);
  }

  private updateWarnings(info: HudInfo, laps: number, now: number): void {
    let text = "";
    if (info.state & 0x0400) text = "Out of fuel";
    else if (info.state & 0x0200) text = "Car broken";
    else if (info.state & outOfRaceState) text = "Retired";
    if (text) {
      this.toast = {
        kind: "warn",
        title: text,
        detail: "Press Esc to restart the session",
        until: Infinity,
      };
      return;
    }
    const total = this.options.totalLaps;
    if (total && total > 1 && laps === total && !this.finalLapShown) {
      this.finalLapShown = true;
      this.toast = {
        kind: "final",
        title: "Final lap",
        detail: `Lap ${String(total)} of ${String(total)}`,
        until: now + 4,
      };
    }
  }

  private updateToast(now: number): void {
    const element = this.find("toast");
    const toast = this.toast && now < this.toast.until ? this.toast : null;
    const key = toast ? `${toast.kind}|${toast.title}|${toast.detail}` : "";
    if (key === this.toastShown) return;
    this.toastShown = key;
    if (!toast) {
      element.classList.remove("show");
      this.toast = null;
      return;
    }
    element.dataset["kind"] = toast.kind;
    this.find("toast-title").textContent = toast.title;
    this.find("toast-detail").textContent = toast.detail;
    this.find("toast-icon").innerHTML =
      `<use href="#${toast.kind === "final" || toast.kind === "warn" ? "flag" : "stopwatch"}" />`;
    element.classList.remove("show");
    void element.getBoundingClientRect();
    element.classList.add("show");
  }

  private showLap(result: LapResult, now: number): void {
    const previous = this.sessionBest;
    if (previous === null || result.time < previous) {
      this.sessionBest = result.time;
      this.renderRows();
    }
    if (result.best) {
      const first = this.options.reference === null && previous === null;
      this.toast = {
        kind: "pb",
        title: first ? "Fastest lap" : "Personal best",
        detail: `Lap ${String(result.lap)} - ${lapTime(result.time)}`,
        until: now + 5,
      };
    }
    this.find("current").textContent = lapTime(result.time);
    this.find("main").dataset["state"] = result.best ? "pb" : "slower";
    replay(this.find("main"), "flash");
    this.freezeUntil = now + 4;
    this.extraUntil = now + 10;
    this.find("previous-row").hidden = this.laps.length < 2;
    this.lastActiveSector = -1;
  }
}
