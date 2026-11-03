import {
  boostMode,
  detectionPoint,
  type EnergyInfo,
  ersModes,
  fuelBurnPerLap,
  fuelLapsDelta,
  fuelMixes,
} from "./energy.ts";
import type { PitControl } from "./pitstop.ts";
import { DamageMonitor, retirementLabel } from "./damage.ts";
import {
  carStride,
  type CarTiming,
  frameIndex,
  type HudInfo,
  type RaceControlInfo,
  type SessionInfo,
} from "./engine.ts";
import { Tower } from "./tower.ts";
import { type Entrant, segmentNames } from "./weekend.ts";
import type { LapResult, LapTrace, SectorState } from "./laptrace.ts";
import { type CarStatus, Mfd } from "./mfd.ts";
import { closedPolyline, type Polyline, pointAlong } from "./polyline.ts";
import { putAttr, putData, putHidden, putStyle, putText } from "./hud-dom.ts";
import type { HudPart } from "./settings.ts";
import { type StartLights, startLightCount } from "./start-lights.ts";
import {
  federation,
  type Notice,
  noticeFor,
  penalty,
  penaltyBadge,
  pitInstruction,
  raceControlState,
  stage,
  type StewardCar,
  type StewardMessage,
  turnAt,
  type Turn,
} from "./stewards.ts";
import { compounds, type TyreInfo, wearState } from "./tyres.ts";

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

function sectorLabel(index: number, sectors: SectorState): string {
  const delta = sectors.deltas[index];
  if (delta !== null && delta !== undefined) return signed(delta);
  const time = sectors.times[index];
  if (time !== null && time !== undefined) return time.toFixed(3);
  return `S${String(index + 1)}`;
}

function rowGap(
  isMe: boolean,
  time: number | null,
  mine: number | null,
): string {
  if (isMe || time === null) return "--:--.---";
  return mine === null ? lapTime(time) : signed(time - mine);
}

function gearLabel(gear: number): string {
  if (gear < 0) return "R";
  if (gear === 0) return "N";
  return String(gear);
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

const tyreMessages: Record<string, { title: string; detail: string }> = {
  punctured: { title: "Puncture", detail: "A tyre has worn through" },
  critical: { title: "Tyres critical", detail: "Grip is falling off a cliff" },
  worn: { title: "Tyres worn", detail: "Expect less grip from here" },
};

function ersState(energy: EnergyInfo, share: number): string {
  if (energy.overtakeActive) return "overtake";
  return share <= 0.01 ? "empty" : "normal";
}

function ersLabel(energy: EnergyInfo, boosting: boolean): string {
  if (!boosting) return ersModes[energy.mode]?.label ?? "";
  return energy.overtakeActive ? "Overtake Boost" : "Boost Active";
}

const revLeds = 15;
const pitTyres = [0, 1, 2];
const marshalSectors = 24;
const noticeQueue = 4;
const blackWhiteShown = 8;
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
  field: Entrant[] | null;
  qualifying: boolean;
  start: StartLights;
  onLap: (lap: LapResult) => void;
  stewards: StewardView;
}

interface StewardView {
  turns: Turn[];
  name: (car: number) => string;
  racing: boolean;
}

interface FlagShown {
  flag: string;
  title: string;
  detail: string;
}

function yellowFlag(
  flags: number[],
  sector: number,
  where: string,
): FlagShown | null {
  const here = flags[sector] ?? 0;
  const ahead = flags[(sector + 1) % marshalSectors] ?? 0;
  if (here === 2)
    return {
      flag: "double",
      title: "Double yellow",
      detail: "Slow down - be ready to stop",
    };
  if (here === 1)
    return {
      flag: "yellow",
      title: "Yellow flag",
      detail: "Slow down - no overtaking",
    };
  if (ahead === 0) return null;
  return {
    flag: ahead === 2 ? "double" : "yellow",
    title: ahead === 2 ? "Double yellow ahead" : "Yellow flag ahead",
    detail: where || "Next marshal post",
  };
}

function flagFor(
  car: StewardCar,
  flags: number[],
  sector: number,
  blackWhite: boolean,
  where: string,
): FlagShown | null {
  if (car.disqualified)
    return {
      flag: "black",
      title: "Black flag",
      detail: "Disqualified - return to the pits",
    };
  if (car.blue)
    return {
      flag: "blue",
      title: "Blue flag",
      detail: "Let the faster car through",
    };
  const yellow = yellowFlag(flags, sector, where);
  if (yellow) return yellow;
  if (blackWhite)
    return {
      flag: "black-white",
      title: "Black and white flag",
      detail: "Final warning",
    };
  const instruction = pitInstruction(car);
  return instruction
    ? { flag: "penalty", title: "Penalty", detail: instruction }
    : null;
}

interface RaceStatus {
  state: string;
  label: string;
  detail: string;
}

const raceStatuses: Record<number, RaceStatus> = {
  [raceControlState.formation]: {
    state: "formation",
    label: "Formation lap",
    detail: "No overtaking",
  },
  [raceControlState.vsc]: {
    state: "yellow",
    label: "Virtual safety car",
    detail: "Keep delta positive",
  },
  [raceControlState.vscEnding]: {
    state: "yellow",
    label: "VSC ending",
    detail: "Green flag soon",
  },
  [raceControlState.safetyCar]: {
    state: "yellow",
    label: "Safety car",
    detail: "No overtaking",
  },
  [raceControlState.safetyCarIn]: {
    state: "yellow",
    label: "Safety car",
    detail: "In this lap",
  },
  [raceControlState.restart]: {
    state: "green",
    label: "Restart",
    detail: "Overtake after the line",
  },
  [raceControlState.red]: {
    state: "red",
    label: "Red flag",
    detail: "Slow down",
  },
  [raceControlState.suspended]: {
    state: "red",
    label: "Red flag",
    detail: "Race suspended",
  },
};

function raceStatus(rc: RaceControlInfo): RaceStatus | null {
  return raceStatuses[rc.state] ?? null;
}

function neutralDelta(
  rc: RaceControlInfo,
): { label: string; value: number } | null {
  const vsc =
    rc.state === raceControlState.vsc ||
    rc.state === raceControlState.vscEnding ||
    rc.state === raceControlState.red;
  const chasing =
    (rc.state === raceControlState.safetyCar ||
      rc.state === raceControlState.safetyCarIn) &&
    !rc.caught;
  if (vsc) return { label: "VSC Delta", value: rc.delta };
  return chasing ? { label: "SC Delta", value: rc.delta } : null;
}

interface Toast {
  kind: string;
  title: string;
  detail: string;
  until: number;
}

function turnInGrade(control: PitControl): PitControl["grade"] {
  return control.phase === "boxing" || control.phase === "service"
    ? control.grade
    : null;
}

export class Hud {
  readonly laps: LapResult[] = [];
  private readonly find: (id: string) => HTMLElement;
  private readonly leds: HTMLElement[] = [];
  private readonly lights: HTMLElement[] = [];
  private readonly sectorCells: HTMLElement[] = [];
  private readonly mfd: Mfd;
  private readonly rows: {
    root: HTMLElement;
    pos: HTMLElement;
    gap: HTMLElement;
    tyre: HTMLElement;
  }[] = [];
  private mapCar: SVGCircleElement | null = null;
  private mapLine: Polyline | null = null;
  private mapLength = 1;
  private sectorPaths: SVGPathElement[] = [];
  private sessionBest: number | null = null;
  private toast: Toast | null = null;
  private readonly damage = new DamageMonitor();
  private toastShown = "";
  private freezeUntil = 0;
  private extraUntil = 0;
  private lastActiveSector = -1;
  private tyreShown = -1;
  private overtakeArmed = false;
  private lastNow = 0;
  private deltaShown = 0;
  private finalLapShown = false;
  private tyreStage = "ok";
  private countdown = false;
  private readonly tower: Tower | null;
  private mapScreen: [number, number][] = [];
  private readonly mapDots: SVGCircleElement[] = [];
  private tyreChoice = -1;
  private readonly notices: Notice[] = [];
  private noticeUntil = 0;
  private noticeShown = "";
  private blackWhiteUntil = 0;
  private flagKey = "";
  private mapFlags: SVGPathElement[] = [];
  private lastDistance = 0;
  private start: StartLights;
  private signalAt = 0;
  private raceState: number = raceControlState.green;
  private neutralDelta: { label: string; value: number } | null = null;
  private lineupsSeen = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly trace: LapTrace,
    private readonly options: HudOptions,
  ) {
    const found = new Map<string, HTMLElement>();
    this.find = (id: string) => {
      const known = found.get(id);
      if (known) return known;
      const element = root.querySelector<HTMLElement>(`[data-hud="${id}"]`);
      if (!element) throw new Error(`missing HUD element ${id}`);
      found.set(id, element);
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
    for (let i = 0; i < startLightCount; i++) {
      const light = document.createElement("i");
      gantry.append(light);
      this.lights.push(light);
    }
    const sectors = this.find("sectors");
    const count = trace.sectors(0).times.length;
    for (let i = 0; i < count; i++) {
      const cell = document.createElement("div");
      putText(cell, `S${String(i + 1)}`);
      sectors.append(cell);
      this.sectorCells.push(cell);
    }
    this.start = options.start;
    this.mfd = new Mfd(this.find("mfd"), this.find);
    putText(this.find("steward-logo"), federation.short);
    putText(this.find("session"), options.session);
    putText(
      this.find("lap-total"),
      options.totalLaps ? ` / ${String(options.totalLaps)}` : "",
    );
    this.tower = options.field
      ? new Tower(this.find("rows"), options.field, options.qualifying)
      : null;
    if (!this.tower) this.buildRows();
    this.buildMap(options.map);
    this.buildFieldDots();
    this.setParts(options.parts);
  }

  toggleTower(): void {
    if (!this.tower) return;
    this.root.classList.toggle("tower-full", this.tower.toggleFull());
  }

  private buildFieldDots(): void {
    const field = this.options.field;
    if (!field) return;
    const marks = this.find("map-field");
    field.forEach((entrant, i) => {
      if (i === 0) return;
      const dot = svg("circle", { r: 5, class: "map-rival" });
      dot.style.fill = entrant.colour;
      marks.append(dot);
      this.mapDots.push(dot);
    });
  }

  updateField(
    cars: Float64Array,
    timing: CarTiming[],
    info: SessionInfo,
    penalties: string[],
  ): void {
    this.tower?.update(timing, penalties);
    const total = timing.length;
    const mine = timing[0];
    this.find("position").textContent = mine
      ? `${String(mine.position)} / ${String(total)}`
      : "";
    if (this.options.qualifying)
      this.find("session").textContent = segmentNames[info.segment] ?? "Q";
    this.updateFieldDots(cars);
  }

  private updateFieldDots(cars: Float64Array): void {
    const count = this.mapScreen.length - 1;
    if (count <= 0) return;
    this.mapDots.forEach((dot, i) => {
      const at = (i + 1) * carStride;
      const visible = (cars[at + 46] ?? 0) !== 0;
      dot.style.display = visible ? "" : "none";
      if (!visible) return;
      const t = (((cars[at + 48] ?? 0) / this.mapLength) % 1) * count;
      const a = this.mapScreen[Math.floor(t)];
      const b = this.mapScreen[Math.floor(t) + 1] ?? a;
      if (!a || !b) return;
      const f = t - Math.floor(t);
      dot.setAttribute("cx", (a[0] + (b[0] - a[0]) * f).toFixed(1));
      dot.setAttribute("cy", (a[1] + (b[1] - a[1]) * f).toFixed(1));
    });
  }

  setParts(parts: Record<HudPart, boolean>): void {
    for (const [part, on] of Object.entries(parts))
      this.root.classList.toggle(`no-${part}`, !on);
  }

  update(
    frame: Float64Array,
    info: HudInfo,
    tyres: TyreInfo,
    energy: EnergyInfo,
    status: CarStatus,
    now: number,
    steward: StewardCar,
  ): void {
    this.lastNow = now;
    const value = (index: number) => frame[index] ?? 0;
    const time = value(frameIndex.time);
    const laps = value(frameIndex.laps);
    const distance = value(frameIndex.distFromStart);
    const current = value(frameIndex.curLapTime);
    this.lastDistance = distance;
    const result = this.trace.sample(
      laps,
      distance,
      current,
      value(frameIndex.lastLapTime),
      !steward.lastLapInvalid,
    );
    putData(this.find("main"), "invalid", steward.lapInvalid ? "1" : "");
    if (result) {
      this.laps.push(result);
      this.showLap(result, now);
      this.options.onLap(result);
    }
    this.updateDash(value);
    this.updateTiming(value, laps, distance, current, now);
    this.updateEnergy(energy, info, value);
    this.updateTyres(tyres);
    this.mfd.update(tyres, status);
    this.updateInputs(value);
    this.updateLights(time);
    this.updateMap(distance);
    this.updateWarnings(status, tyres, laps, now);
    this.updateToast(now);
  }

  updateStewards(
    messages: StewardMessage[],
    car: StewardCar,
    flags: number[],
    now: number,
  ): void {
    const view = this.options.stewards;
    for (const message of messages) {
      if (
        message.car === 0 &&
        message.stage === stage.warning &&
        message.penalty === penalty.blackWhite
      )
        this.blackWhiteUntil = now + blackWhiteShown;
      const notice = noticeFor(message, view.name, view.turns, view.racing);
      if (!notice) continue;
      if (this.notices.length >= noticeQueue) this.notices.shift();
      this.notices.push(notice);
    }
    this.showNotice(now);
    const badge = penaltyBadge(car);
    const tag = this.find("penalty");
    putHidden(tag, badge === "");
    putText(tag, badge);
    this.updateFlagPanel(car, flags, now);
    this.mapFlags.forEach((path, k) => {
      putData(path, "flag", String(flags[k] ?? 0));
    });
  }

  private showNotice(now: number): void {
    const element = this.find("steward");
    if (now < this.noticeUntil) return;
    const next = this.notices.shift();
    if (!next) {
      if (this.noticeShown !== "") element.classList.remove("show");
      this.noticeShown = "";
      return;
    }
    this.noticeUntil = now + next.seconds;
    this.noticeShown = `${next.title}|${next.detail}`;
    putData(element, "kind", next.kind);
    putText(this.find("steward-title"), next.title);
    putText(this.find("steward-detail"), next.detail);
    element.classList.remove("show");
    void element.getBoundingClientRect();
    element.classList.add("show");
  }

  private updateFlagPanel(car: StewardCar, flags: number[], now: number): void {
    const length = this.mapLength;
    const sector = Math.min(
      marshalSectors - 1,
      Math.max(
        0,
        Math.floor(
          ((((this.lastDistance / length) % 1) + 1) % 1) * marshalSectors,
        ),
      ),
    );
    const nextMiddle = ((sector + 1.5) * length) / marshalSectors;
    const shown = flagFor(
      car,
      flags,
      sector,
      now < this.blackWhiteUntil,
      turnAt(nextMiddle % length, this.options.stewards.turns),
    );
    const panel = this.find("flag");
    const key = shown ? `${shown.flag}|${shown.title}|${shown.detail}` : "";
    if (key === this.flagKey) return;
    this.flagKey = key;
    putHidden(panel, !shown);
    if (!shown) return;
    putData(panel, "flag", shown.flag);
    putText(this.find("flag-title"), shown.title);
    putText(this.find("flag-detail"), shown.detail);
  }

  setWingChoice(replace: boolean): void {
    this.find("wing-change").textContent = replace ? "Replace +8s" : "Keep";
  }

  setTyreChoice(compound: number): void {
    if (compound === this.tyreChoice) return;
    this.tyreChoice = compound;
    this.find("pit-tyre-options").replaceChildren(
      ...pitTyres.map((index) => {
        const tyre = compounds[index] ?? compounds[0];
        const option = document.createElement("span");
        option.classList.toggle("active", index === compound);
        const badge = document.createElement("i");
        badge.textContent = tyre.letter;
        badge.style.setProperty("--tyre", tyre.colour);
        option.append(badge, tyre.label);
        return option;
      }),
    );
  }

  updatePit(control: PitControl): void {
    const active = control.phase !== "track";
    putHidden(this.find("pit-tyres"), !control.choosingTyres);
    this.updatePitPanel(control, active);
    this.updatePitBanner(control, active);
    this.updatePitTurn(control);
  }

  private updatePitPanel(control: PitControl, active: boolean): void {
    putHidden(this.find("pit-panel"), !active || control.pitTime === null);
    putText(this.find("pit-time"), (control.pitTime ?? 0).toFixed(1));
    const running = control.serviceProgress * (control.estimate ?? 0);
    const stop =
      control.stopTime ?? (control.phase === "service" ? running : null);
    putText(this.find("pit-stop"), stop === null ? "-.-" : stop.toFixed(1));
  }

  private updatePitBanner(control: PitControl, active: boolean): void {
    const banner = this.find("pit-banner");
    putHidden(banner, !active || control.limit <= 0);
    const limitKph = Math.round(control.limit * 3.6);
    putData(banner, "over", String(control.speedKph > limitKph + 1));
    putText(this.find("pit-limit"), String(limitKph));
    putText(this.find("pit-speed"), String(Math.round(control.speedKph)));
    putText(
      this.find("pit-distance"),
      control.distanceToBox === null
        ? ""
        : `Your box - ${String(Math.round(control.distanceToBox))}m`,
    );
  }

  private showPenaltyHold(control: PitControl, left: number): void {
    const turn = this.find("pit-turn");
    putHidden(turn, false);
    putData(turn, "grade", "late");
    putText(this.find("pit-turn-value"), left.toFixed(1));
    putText(
      this.find("pit-turn-hint"),
      control.penalty.kind === "stop-go"
        ? "Stop-and-go - no work allowed"
        : "Serving penalty before work starts",
    );
  }

  private updatePitTurn(control: PitControl): void {
    if (control.penaltyLeft !== null) {
      this.showPenaltyHold(control, control.penaltyLeft);
      return;
    }
    const turn = this.find("pit-turn");
    const grade = turnInGrade(control);
    putHidden(turn, control.countdown === null && grade === null);
    putData(turn, "grade", grade ?? "");
    putText(
      this.find("pit-turn-value"),
      grade?.toUpperCase() ?? (control.countdown ?? 0).toFixed(1),
    );
    putText(
      this.find("pit-turn-hint"),
      grade
        ? `Estimated stop time ${(control.estimate ?? 0).toFixed(1)}s`
        : "Press Space / Brake",
    );
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
      putText(label, name);
      const tyre = document.createElement("i");
      tyre.className = "row-tyre";
      const gap = document.createElement("b");
      gap.className = "row-gap";
      const flag = document.createElement("i");
      flag.className = "row-flag";
      flag.innerHTML = '<svg><use href="#stopwatch" /></svg>';
      root.append(pos, label, tyre, gap, flag);
      putData(root, "me", name === "You" ? "1" : "");
      putHidden(root, name !== "You" && this.options.reference === null);
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
      putText(row.pos, String(i + 1));
      const isMe = row.root.dataset["me"] === "1";
      row.root.classList.toggle(
        "fastest",
        fastest !== null && entry.time === fastest,
      );
      putText(row.gap, rowGap(isMe, entry.time, mine));
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
    this.mapScreen = screen;
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
      putText(label, String(i + 1));
      marks.append(label);
    });
    const flagGroup = this.find("map-flags");
    this.mapFlags = Array.from({ length: marshalSectors }, (_, k) => {
      const from = Math.floor((k * map.length) / marshalSectors / step);
      const to = Math.min(
        screen.length - 1,
        Math.ceil(((k + 1) * map.length) / marshalSectors / step),
      );
      const part = screen.slice(from, to + 1);
      const path = svg("path", {
        d: `M${part.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}`,
        class: "map-flag",
      });
      flagGroup.append(path);
      return path;
    });
    const [lx, ly] = at(((boundaries.at(-1) ?? 0) + map.length) / 2);
    const label = svg("text", { x: lx, y: ly, class: "map-num" });
    putText(label, String(boundaries.length + 1));
    marks.append(label);
    const [dx, dy] = at(detectionPoint(map.length));
    marks.append(svg("circle", { cx: dx, cy: dy, r: 7, class: "map-detect" }));
    this.mapLine = closedPolyline(
      screen.map((p) => [Number(p[0].toFixed(1)), Number(p[1].toFixed(1))]),
    );
    this.sectorPaths = Array.from(
      this.root.querySelectorAll<SVGPathElement>(".map-sector"),
    );
    this.mapLength = map.length;
    this.mapCar = this.find("map-car") as unknown as SVGCircleElement;
  }

  private updateMap(distance: number): void {
    if (!this.mapCar || !this.mapLine) return;
    const [x, y] = pointAlong(
      this.mapLine,
      ((((distance / this.mapLength) % 1) + 1) % 1) * this.mapLine.total,
    );
    putAttr(this.mapCar, "cx", x.toFixed(1));
    putAttr(this.mapCar, "cy", y.toFixed(1));
  }

  private updateDash(value: (index: number) => number): void {
    const rpm = value(frameIndex.rpm) * (30 / Math.PI);
    const redLine = Math.max(1, value(frameIndex.rpmRedLine) * (30 / Math.PI));
    putText(
      this.find("speed"),
      String(Math.round(Math.abs(value(frameIndex.speed)) * 3.6)),
    );
    putText(this.find("gear"), gearLabel(value(frameIndex.gear)));
    putText(this.find("rpm"), String(Math.round(rpm)));
    const fraction = rpm / redLine;
    const lit = Math.round(((fraction - 0.7) / 0.28) * revLeds);
    this.leds.forEach((led, i) => {
      led.classList.toggle("on", i < lit);
    });
    this.find("leds").classList.toggle("flash", fraction > 0.98);
    const ring = this.find("rpm-ring");
    putStyle(
      ring,
      "stroke-dashoffset",
      String(100 - Math.min(1, fraction) * 75),
    );
    putData(
      ring,
      "zone",
      fraction > 0.97 ? "limit" : fraction > 0.85 ? "high" : "",
    );
  }

  private updateTiming(
    value: (index: number) => number,
    laps: number,
    distance: number,
    current: number,
    now: number,
  ): void {
    const total = this.options.totalLaps;
    putText(
      this.find("lap"),
      String(total ? Math.max(1, Math.min(laps, total)) : Math.max(1, laps)),
    );
    if (now > this.freezeUntil) {
      putText(this.find("current"), shortTime(laps > 0 ? current : 0));
      putData(this.find("main"), "state", "");
    }
    const best = value(frameIndex.bestLapTime);
    putText(this.find("best"), lapTime(best));
    putText(this.find("last"), lapTime(value(frameIndex.lastLapTime)));
    this.find("extra").classList.toggle("open", now < this.extraUntil);
    this.updateSectors(laps, distance, now);
    this.updateDelta(laps, distance, current);
  }

  private updateSectors(laps: number, distance: number, now: number): void {
    const sectors = this.trace.sectors(distance);
    this.sectorCells.forEach((cell, i) => {
      const status = sectors.status[i] ?? null;
      putData(
        cell,
        "status",
        status ?? (i === sectors.active && laps > 0 ? "live" : ""),
      );
      putText(cell, sectorLabel(i, sectors));
    });
    this.sectorPaths.forEach((path) => {
      const i = Number(path.dataset["sector"]);
      putData(path, "status", sectors.status[i] ?? "");
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
      putText(this.find("current"), shortTime(split));
      putData(this.find("main"), "state", sectors.status[closed] ?? "");
      replay(this.find("main"), "flash");
      this.freezeUntil = now + 3;
    }
    this.lastActiveSector = sectors.active;
  }

  private updateDelta(laps: number, distance: number, current: number): void {
    const widget = this.find("delta");
    const neutral = this.neutralDelta;
    putData(widget, "mode", neutral ? "neutral" : "");
    putText(this.find("delta-label"), neutral?.label ?? "Delta");
    if (neutral) {
      putData(widget, "state", neutral.value >= 0 ? "ahead" : "behind");
      putText(this.find("delta-value"), signed(neutral.value));
      return;
    }
    const delta = this.trace.delta(distance, current);
    if (delta === null) {
      putData(widget, "state", "idle");
      putText(this.find("delta-value"), laps > 0 ? "--.---" : "");
      return;
    }
    this.deltaShown += (delta - this.deltaShown) * 0.25;
    const shown = this.deltaShown;
    putData(widget, "state", shown <= 0 ? "ahead" : "behind");
    putText(this.find("delta-value"), signed(shown));
  }

  private updateEnergy(
    energy: EnergyInfo,
    info: HudInfo,
    value: (index: number) => number,
  ): void {
    const share = Math.min(1, energy.battery / Math.max(1, energy.capacity));
    const harvest = Math.min(
      1,
      energy.harvested / Math.max(1, energy.harvestLimit),
    );
    putData(this.find("dash"), "ers", ersState(energy, share));
    putText(this.find("batt"), `${String(Math.round(share * 100))}%`);
    putStyle(
      this.find("batt-ring"),
      "stroke-dashoffset",
      String(100 - share * 75),
    );
    putStyle(
      this.find("harvest-ring"),
      "stroke-dashoffset",
      String(100 - harvest * 100),
    );
    putHidden(this.find("s-mode"), energy.straightMode < 0.5);
    putText(
      this.find("bias"),
      `${String(Math.round(energy.brakeBias * 100))}%`,
    );
    this.updateErs(energy);
    this.updateFuel(energy, info, value);
  }

  private updateErs(energy: EnergyInfo): void {
    const boosting = energy.mode === boostMode;
    putText(this.find("status"), ersLabel(energy, boosting));
    putText(this.find("ers-mode"), ersModes[energy.mode]?.label ?? "");
    putText(this.find("boost-state"), boosting ? "Disable" : "Boost");
    putText(this.find("diff"), `${String(Math.round(energy.differential))}%`);
    if (energy.overtakeArmed && !this.overtakeArmed)
      this.toast = {
        kind: "pb",
        title: "Overtake",
        detail: "Available next lap",
        until: this.lastNow + 3,
      };
    this.overtakeArmed = energy.overtakeArmed;
  }

  private updateFuel(
    energy: EnergyInfo,
    info: HudInfo,
    value: (index: number) => number,
  ): void {
    const perLap = fuelBurnPerLap(energy.lastLapFuel);
    const total = this.options.totalLaps;
    const distance = value(frameIndex.distFromStart) / this.mapLength;
    const lapsDone = Math.max(0, value(frameIndex.laps) - 1) + distance;
    const remaining = total ? Math.max(0, total - lapsDone) : 0;
    const delta = fuelLapsDelta(info.fuel, perLap, remaining);
    const label = this.find("fuel-delta");
    putText(
      label,
      `${total ? (delta >= 0 ? "+" : "") : ""}${delta.toFixed(2)} Laps`,
    );
    putData(label, "state", !total || delta >= 0 ? "ok" : "short");
    putText(this.find("fuel-mix"), fuelMixes[energy.fuelMix]?.label ?? "");
    const low = total ? delta < 0 : delta < 1.2;
    putHidden(this.find("fuel-can"), !low);
    this.find("dash").classList.toggle("low-fuel", info.fuel < perLap);
  }

  private updateTyres(tyres: TyreInfo): void {
    const compound = compounds[tyres.compound] ?? compounds[1];
    if (tyres.compound !== this.tyreShown && !this.tower) {
      this.tyreShown = tyres.compound;
      for (const row of this.rows) {
        putText(row.tyre, compound.letter);
        row.tyre.style.setProperty("--tyre", compound.colour);
      }
    }
  }

  nextMfdPage(): void {
    this.mfd.next();
  }

  private updateInputs(value: (index: number) => number): void {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    putStyle(
      this.find("in-throttle"),
      "transform",
      `scaleX(${String(clamp(value(frameIndex.accel)))})`,
    );
    putStyle(
      this.find("in-brake"),
      "transform",
      `scaleX(${String(clamp(value(frameIndex.brake)))})`,
    );
  }

  restartLights(lights: StartLights, signalAt: number): void {
    this.start = lights;
    this.signalAt = signalAt;
    this.countdown = false;
  }

  private updateLights(raceTime: number): void {
    if (this.options.qualifying) return;
    const gantry = this.find("lights");
    const time = raceTime - this.signalAt;
    const formation = this.raceState === raceControlState.formation;
    const lit = formation ? 0 : this.start.lit(time);
    this.lights.forEach((light, i) => {
      light.classList.toggle("on", i < lit);
    });
    if (time < 0 && !formation) this.countdown = true;
    gantry.classList.toggle("show", this.countdown && time < 1);
    gantry.classList.toggle("out", time >= 0);
  }

  updateRaceControl(rc: RaceControlInfo): void {
    this.raceState = rc.state;
    const status = raceStatus(rc);
    const strip = this.find("rc-status");
    putHidden(strip, !status);
    if (status) {
      putData(strip, "state", status.state);
      putText(this.find("rc-label"), status.label);
      putText(this.find("rc-detail"), status.detail);
    }
    const screen = this.find("rc-screen");
    const suspended = rc.state === raceControlState.suspended;
    putHidden(screen, !suspended);
    if (suspended)
      putText(
        this.find("rc-screen-detail"),
        `Race suspended - restart in ${String(Math.ceil(rc.suspendedLeft + rc.countdown))}s`,
      );
    this.neutralDelta = neutralDelta(rc);
    if (rc.lineups !== this.lineupsSeen) {
      this.lineupsSeen = rc.lineups;
      replay(this.find("lineup-fade"), "play");
    }
  }

  private updateWarnings(
    status: CarStatus,
    tyres: TyreInfo,
    laps: number,
    now: number,
  ): void {
    const retired = retirementLabel(status.retired);
    if (retired) {
      this.toast = {
        kind: "warn",
        title: retired,
        detail: "Session over",
        until: Infinity,
      };
      return;
    }
    this.updateTyreWarning(tyres, now);
    const alert = this.damage.update(status, tyres);
    if (alert) this.toast = { kind: "warn", ...alert, until: now + 6 };
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

  private updateTyreWarning(tyres: TyreInfo, now: number): void {
    const worst = Math.max(...tyres.wheels.map((wheel) => wheel.wear));
    const stage = wearState(worst);
    if (stage === this.tyreStage) return;
    this.tyreStage = stage;
    const message = tyreMessages[stage];
    if (message) this.toast = { kind: "warn", ...message, until: now + 5 };
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
    putData(element, "kind", toast.kind);
    putText(this.find("toast-title"), toast.title);
    putText(this.find("toast-detail"), toast.detail);
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
      if (!this.tower) this.renderRows();
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
    putText(this.find("current"), lapTime(result.time));
    putData(this.find("main"), "state", result.best ? "pb" : "slower");
    replay(this.find("main"), "flash");
    this.freezeUntil = now + 4;
    this.extraUntil = now + 10;
    putHidden(this.find("previous-row"), this.laps.length < 2);
    this.lastActiveSector = -1;
  }
}
