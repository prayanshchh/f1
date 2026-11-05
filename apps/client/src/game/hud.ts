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
import { DamageMonitor, partDamaged, retirementLabel } from "./damage.ts";
import { Dash } from "./dash.ts";
import {
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
import { weatherCall, type WeatherInfo } from "./weather.ts";
import { MiniMap, type TrackMap } from "./minimap.ts";
import { putData, putHidden, putText } from "./hud-dom.ts";
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

function replay(element: HTMLElement | SVGElement, name: string): void {
  element.classList.remove(name);
  void element.getBoundingClientRect();
  element.classList.add(name);
}

const tyreMessages: Record<string, { title: string; detail: string }> = {
  punctured: { title: "Puncture", detail: "A tyre has worn through" },
  critical: { title: "Tyres critical", detail: "Grip is falling off a cliff" },
  worn: { title: "Tyres worn", detail: "Expect less grip from here" },
};

const pitTyres = [0, 1, 2, 3, 4];
const marshalSectors = 24;
const noticeQueue = 4;

const lampLens = `<b></b><svg viewBox="-32 -32 64 64" aria-hidden="true">${[
  [0, 1],
  [6, 6],
  [12, 12],
  [18, 18],
  [24, 24],
]
  .flatMap(([radius = 0, count = 1]) =>
    Array.from({ length: count }, (_, k) => {
      const a = (k / count) * Math.PI * 2 + radius * 0.05;
      return `<circle r="1.7" cx="${(Math.cos(a) * radius).toFixed(1)}" cy="${(Math.sin(a) * radius).toFixed(1)}" />`;
    }),
  )
  .join("")}</svg>`;
const blackWhiteShown = 8;

export interface HudOptions {
  totalLaps: number | null;
  parts: Record<HudPart, boolean>;
  session: string;
  reference: number | null;
  map: TrackMap | null;
  field: Entrant[] | null;
  qualifying: boolean;
  start: StartLights;
  startHint: boolean;
  rewindRetired: boolean;
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

function fuelState(
  fuel: number,
  perLap: number,
  total: number | null,
  delta: number,
): string {
  if (fuel < perLap) return "critical";
  return (total ? delta < 0 : delta < 1.2) ? "low" : "";
}

function turnInGrade(control: PitControl): PitControl["grade"] {
  return control.phase === "boxing" || control.phase === "service"
    ? control.grade
    : null;
}

export class Hud {
  readonly laps: LapResult[] = [];
  private readonly find: (id: string) => HTMLElement;
  private readonly dash: Dash;
  private readonly lights: HTMLElement[] = [];
  private readonly sectorCells: HTMLElement[] = [];
  private readonly mfd: Mfd;
  private readonly rows: {
    root: HTMLElement;
    pos: HTMLElement;
    gap: HTMLElement;
    tyre: HTMLElement;
  }[] = [];
  private readonly minimap: MiniMap;
  private sessionBest: number | null = null;
  private toast: Toast | null = null;
  private weatherKey = "";
  private readonly damage = new DamageMonitor();
  private toastShown = "";
  private inPit = false;
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
  private lit = 0;
  private readonly tower: Tower | null;
  private tyreChoice = -1;
  private readonly notices: Notice[] = [];
  private noticeUntil = 0;
  private noticeShown = "";
  private readonly incidents = new Map<number, StewardMessage>();
  private blackWhiteUntil = 0;
  private flagKey = "";
  private lastDistance = 0;
  private start: StartLights;
  private signalAt = 0;
  private neutralDelta: { label: string; value: number } | null = null;
  private lineupsSeen = 0;
  private positionShown = "";

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
    this.dash = new Dash(this.find("dash"), this.find);
    const gantry = this.find("lights");
    for (let i = 0; i < startLightCount; i++) {
      const light = document.createElement("i");
      light.innerHTML = lampLens;
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
    this.paintTeam(options.field?.[0]?.colour);
    this.tower = options.field
      ? new Tower(this.find("rows"), options.field, options.qualifying)
      : null;
    if (!this.tower) this.buildRows();
    this.minimap = new MiniMap(
      this.find,
      options.map,
      {
        boundaries: trace.boundaries,
        detection: detectionPoint(options.map?.length ?? 1),
        flagSectors: marshalSectors,
      },
      options.field,
    );
    this.setParts(options.parts);
  }

  private paintTeam(colour: string | undefined): void {
    if (!colour) return;
    this.find("timer").style.setProperty("--team", colour);
    this.find("map").style.setProperty("--me", colour);
  }

  toggleTower(): void {
    if (!this.tower) return;
    this.root.classList.toggle("tower-full", this.tower.toggleFull());
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
    const position = this.find("position");
    if (!mine) position.replaceChildren();
    else if (
      this.positionShown !== `${String(mine.position)}/${String(total)}`
    ) {
      this.positionShown = `${String(mine.position)}/${String(total)}`;
      const of = document.createElement("span");
      of.textContent = ` / ${String(total)}`;
      position.replaceChildren(String(mine.position), of);
    }
    if (this.options.qualifying)
      this.find("session").textContent = segmentNames[info.segment] ?? "Q";
    this.minimap.field(cars);
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
    weather: WeatherInfo,
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
    this.dash.update({
      speedKph: value(frameIndex.speed) * 3.6,
      gear: value(frameIndex.gear),
      rpm: value(frameIndex.rpm) * (30 / Math.PI),
      redLine: value(frameIndex.rpmRedLine) * (30 / Math.PI),
      throttle: value(frameIndex.accel),
      brake: value(frameIndex.brake),
    });
    this.updateTiming(value, laps, distance, current, now);
    this.updateEnergy(energy, info, value);
    this.updateTyres(tyres);
    this.mfd.update(tyres, status, weather);
    this.dash.damaged(partDamaged(status));
    this.updateLights(time);
    this.minimap.player(distance);
    this.updateWarnings(status, tyres, laps, now);
    this.updateWeatherCall(weather, tyres, now);
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
      if (message.stage === stage.flag)
        this.incidents.set(message.car, message);
      const notice = noticeFor(
        message,
        view.name,
        view.turns,
        view.racing,
        this.incidents,
      );
      if (!notice) continue;
      if (notice.kind === "flag" || notice.kind === "penalty") {
        this.notices.unshift(notice);
        this.noticeUntil = 0;
      } else this.notices.push(notice);
      if (this.notices.length > noticeQueue) this.notices.pop();
    }
    this.showNotice(now);
    const badge = penaltyBadge(car);
    const tag = this.find("penalty");
    putHidden(tag, badge === "");
    putText(tag, badge);
    this.updateFlagPanel(car, flags, now);
    this.minimap.flags(flags);
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
    const length = this.minimap.length;
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

  notify(title: string, detail: string, now: number): void {
    this.toast = { kind: "info", title, detail, until: now + 3 };
  }

  rewindLaps(count: number): void {
    this.laps.length = Math.min(this.laps.length, count);
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
    this.inPit = active;
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
    this.dash.energy(energy);
    putText(
      this.find("bias"),
      `${String(Math.round(energy.brakeBias * 100))}%`,
    );
    this.updateErs(energy);
    this.updateFuel(energy, info, value);
  }

  private updateErs(energy: EnergyInfo): void {
    const boosting = energy.mode === boostMode;
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
    const distance = value(frameIndex.distFromStart) / this.minimap.length;
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
    putData(
      this.find("fuel-can"),
      "state",
      fuelState(info.fuel, perLap, total, delta),
    );
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

  restartLights(lights: StartLights, signalAt: number): void {
    this.start = lights;
    this.signalAt = signalAt;
    this.countdown = false;
  }

  get litLights(): number {
    return this.lit;
  }

  private updateLights(raceTime: number): void {
    if (this.options.qualifying) return;
    const gantry = this.find("lights");
    const time = raceTime - this.signalAt;
    const lit = this.start.lit(time);
    this.lit = lit;
    this.lights.forEach((light, i) => {
      light.classList.toggle("on", i < lit);
    });
    if (time < 0) this.countdown = true;
    gantry.classList.toggle("show", this.countdown && time < 1);
    gantry.classList.toggle("out", time >= 0);
    this.find("start-hint").classList.toggle(
      "show",
      this.options.startHint && this.countdown && time < 0,
    );
  }

  updateRaceControl(rc: RaceControlInfo): void {
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
        detail: this.options.rewindRetired ? "Rewind with R" : "Session over",
        until: Infinity,
      };
      return;
    }
    if (this.toast?.until === Infinity) this.toast = null;
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

  private updateWeatherCall(
    weather: WeatherInfo,
    tyres: TyreInfo,
    now: number,
  ): void {
    const call = weatherCall(weather, tyres.compound);
    if (call.key === this.weatherKey) return;
    this.weatherKey = call.key;
    if (call.message)
      this.toast = { kind: "warn", ...call.message, until: now + 6 };
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
    const live = this.toast && now < this.toast.until ? this.toast : null;
    if (!live) this.toast = null;
    const toast = this.inPit ? null : live;
    const key = toast ? `${toast.kind}|${toast.title}|${toast.detail}` : "";
    if (key === this.toastShown) return;
    this.toastShown = key;
    if (!toast) {
      element.classList.remove("show");
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
