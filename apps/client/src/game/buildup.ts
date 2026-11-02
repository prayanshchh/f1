import * as THREE from "three/webgpu";
import { ordinal } from "./buildup-ordinal.ts";
import {
  buildUpStages,
  type Stage,
  stageAt,
  type StageId,
  type StagePosition,
  skipTarget,
} from "./buildup-timeline.ts";
import {
  type CameraPose,
  poseAt,
  shots,
  type TrackPoint,
  walkShot,
} from "./buildup-shots.ts";
import { carPortraits, type CarPortrait } from "./car-portraits.ts";
import { CircuitMap, type MapPose, mixPose } from "./circuit-map.ts";
import { renderDisplay } from "./display.ts";
import { el, prompt } from "./dom.ts";
import { flagUrl } from "./flags.ts";
import type { Scene } from "./scene.ts";
import { teamLogo } from "./team-logos.ts";
import type { GridEntry } from "./teams.ts";
import { teams } from "./teams.ts";
import { WavingFlag } from "./waving-flag.ts";

const mapCentre: [number, number, number] = [780, 0, -130];
const fadeSeconds = 0.4;
const stageEase = 1.1;
const partners = 10;
const miles = 0.621371;
const eventName = "United States Grand Prix 2026";
const eventCountry = "US";
const eventPlace = "Austin - USA";

const mapPoses: Record<string, [MapPose, MapPose]> = {
  "map-sectors": [
    {
      azimuth: 2.14,
      elevation: 0.68,
      distance: 2500,
      target: mapCentre,
      fov: 34,
    },
    {
      azimuth: 2.24,
      elevation: 0.62,
      distance: 2380,
      target: mapCentre,
      fov: 34,
    },
  ],
  "map-zones": [
    {
      azimuth: -1.22,
      elevation: 0.56,
      distance: 2500,
      target: [880, 0, -230],
      fov: 34,
    },
    {
      azimuth: -1.32,
      elevation: 0.5,
      distance: 2400,
      target: [880, 0, -230],
      fov: 34,
    },
  ],
  "map-turns": [
    {
      azimuth: -1.02,
      elevation: 0.26,
      distance: 2500,
      target: [800, 30, -60],
      fov: 30,
    },
    {
      azimuth: -0.86,
      elevation: 0.2,
      distance: 2380,
      target: [800, 40, -60],
      fov: 30,
    },
  ],
};

export interface Weather {
  temperature: number;
  label: string;
  icon: "sun" | "cloud" | "rain";
}

export interface BuildUpOptions {
  renderer: THREE.WebGPURenderer;
  world: Scene;
  drawWorld: () => void;
  frame: Float64Array;
  track: TrackPoint;
  trackLength: number;
  kind: "practice" | "race";
  grid: GridEntry[];
  playerDistance: number;
  playerLateral: number;
  playerSlot: number;
  weather: Weather;
  seek: number;
}

function logoMark(): HTMLElement {
  const box = el("div", "bu-card-logo");
  box.innerHTML = '<svg class="f1"><use href="#f1-logo" /></svg><b>26</b>';
  return box;
}

function chevrons(): [HTMLElement, HTMLElement] {
  return [el("i", "bu-chevron top"), el("i", "bu-chevron bottom")];
}

function weatherIcon(icon: Weather["icon"]): HTMLElement {
  const box = el("div", `bu-weather-icon ${icon}`);
  box.innerHTML =
    icon === "sun"
      ? '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="14"/><g stroke-width="5" stroke-linecap="round"><path d="M32 4v8M32 52v8M4 32h8M52 32h8M12 12l6 6M46 46l6 6M12 52l6-6M46 18l6-6"/></g></svg>'
      : '<svg viewBox="0 0 64 64"><path d="M18 46a12 12 0 0 1-1-24 16 16 0 0 1 30 3 10.500 10.500 0 0 1-1 21Z"/><g stroke-width="4" stroke-linecap="round"><path d="M22 52l-3 7M34 52l-3 7M46 52l-3 7"/></g></svg>';
  return box;
}

class BuildUpView {
  readonly root = el("div", "buildup");
  readonly title = el("section", "bu-card title");
  readonly weather = el("section", "bu-card weather");
  readonly mapUi = el("div", "bu-map-ui");
  readonly tags = el("div", "bu-tags");
  readonly partners = el("div", "bu-partners");
  readonly stats = el("div", "bu-stats");
  readonly flagSign = el("div", "bu-flag-sign");
  readonly gridBox = el("section", "bu-grid");
  readonly caption = el("section", "bu-caption");
  readonly fade = el("div", "bu-fade");
  readonly wipe = el("div", "bu-wipe");
  readonly skip: HTMLElement;

  constructor(host: HTMLElement, options: BuildUpOptions, skip: () => void) {
    const stage = el("div", "stage");
    this.title.append(
      ...chevrons(),
      logoMark(),
      el("h1", "", eventName.toUpperCase()),
    );
    const reading = el("div", "bu-weather");
    const numbers = el("div", "");
    numbers.append(
      el("b", "", `${String(options.weather.temperature)}°C`),
      el("span", "", options.weather.label),
    );
    reading.append(weatherIcon(options.weather.icon), numbers);
    this.weather.append(...chevrons(), logoMark(), reading);
    const place = el("header", "bu-place");
    const flag = el("img", "flag");
    flag.src = flagUrl(eventCountry);
    flag.alt = "";
    place.append(el("b", "", eventPlace.toUpperCase()), flag);
    this.buildStats(options.trackLength);
    this.buildPartners();
    this.mapUi.append(place, this.tags, this.stats, this.partners);
    this.flagSign.append(el("small", "", "Starting"), el("b", "", "Grid"));
    const skipper = prompt("↵", "Skip");
    skipper.classList.add("bu-skip");
    skipper.addEventListener("click", skip);
    this.skip = skipper;
    stage.append(
      this.title,
      this.weather,
      this.mapUi,
      this.flagSign,
      this.gridBox,
      this.caption,
      this.skip,
    );
    this.wipe.innerHTML =
      '<i></i><i></i><svg class="f1"><use href="#f1-logo" /></svg>';
    this.root.append(this.fade, stage, this.wipe);
    host.append(this.root);
  }

  private buildStats(length: number): void {
    const km = length / 1000;
    const distance = el("div", "");
    distance.append(
      el("b", "", "Track Distance"),
      el(
        "strong",
        "",
        `${km.toFixed(3)} KM / ${(km * miles).toFixed(3)} MILES`,
      ),
    );
    const turns = el("div", "");
    turns.append(el("b", "", "Turns"), el("strong", "", "20"));
    this.stats.append(distance, turns);
  }

  private buildPartners(): void {
    const names = teams.flatMap((team) => team.sponsors.slice(0, 1));
    const row = el("div", "bu-partner-row");
    row.append(...names.slice(0, partners).map((name) => el("span", "", name)));
    this.partners.append(el("small", "", "Global Partners"), row);
  }

  dispose(): void {
    this.root.remove();
  }
}

function setOn(node: HTMLElement, on: boolean): void {
  node.classList.toggle("on", on);
}

function isOn(node: HTMLElement): boolean {
  return node.classList.contains("on");
}

function gridSlot(
  entry: GridEntry | undefined,
  portrait: CarPortrait | undefined,
  side: "left" | "right",
): HTMLElement {
  const slot = el("div", `bu-slot ${side}`);
  if (!entry) return slot;
  slot.style.setProperty("--brand", entry.team.brand);
  slot.classList.toggle("player", entry.player);
  const place = el("div", "bu-slot-place");
  place.append(
    el("b", "", String(entry.position)),
    el("sup", "", ordinal(entry.position)),
  );
  const car = el("img", "bu-slot-car");
  car.src = (side === "left" ? portrait?.left : portrait?.right) ?? "";
  car.alt = "";
  const names = el("div", "bu-slot-names");
  names.append(
    el("span", "", entry.first),
    el("b", "", entry.last.toUpperCase()),
    el("small", "", `#${String(entry.number)} · ${entry.team.name}`),
  );
  const brand = el("div", "bu-slot-brand");
  const flag = el("img", "flag");
  flag.src = flagUrl(entry.nationality);
  flag.alt = "";
  brand.append(teamLogo(entry.team.id, entry.team.brand), flag);
  slot.append(place, car, brand, names);
  return slot;
}

class Director {
  private readonly stages: Stage[];
  private clock: number;
  private lastNow = 0;
  private shownPair = -1;
  private shownCaption = -1;
  private readonly lit = new Set<HTMLElement>();
  private readonly labels = new Map<string, HTMLElement>();
  private readonly handlers: Record<StageId, (at: StagePosition) => void>;
  private map: CircuitMap | null = null;
  private flag: WavingFlag | null = null;
  private portraits = new Map<string, CarPortrait>();
  readonly view: BuildUpView;
  private resolve: () => void = () => undefined;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!["Enter", " ", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.skip();
  };

  constructor(
    private readonly options: BuildUpOptions,
    host: HTMLElement,
  ) {
    this.stages = buildUpStages(
      options.kind,
      Math.ceil(options.grid.length / 2),
    );
    this.clock = options.seek;
    this.view = new BuildUpView(host, options, () => {
      this.skip();
    });
    this.handlers = {
      black: () => {
        this.drawBlack();
      },
      title: (at) => {
        this.world(poseAt(shots.title, at.progress, options.track));
        this.show(this.view.title, at.time > 1.8 && at.time < 8.2);
      },
      weather: (at) => {
        this.world(poseAt(shots.weather, at.progress, options.track));
        this.show(this.view.weather, at.time > 2.6 && at.time < 7);
      },
      "map-sectors": (at) => {
        this.mapStage("map-sectors", at);
      },
      "map-zones": (at) => {
        this.mapStage("map-zones", at);
      },
      "map-turns": (at) => {
        this.mapStage("map-turns", at);
      },
      hill: (at) => {
        this.world(poseAt(shots.hill, at.progress, options.track));
      },
      flag: (at) => {
        this.drawFlag();
        this.show(this.view.flagSign, at.time > 0.8);
      },
      grid: (at) => {
        this.drawFlag();
        this.gridStage(at);
      },
      walk: (at) => {
        const shot = walkShot(
          at.stage.index,
          options.playerDistance,
          options.playerLateral,
          options.playerSlot,
        );
        this.world(poseAt(shot, at.progress, options.track));
        this.captionStage(at);
      },
      wipe: (at) => {
        this.wipeStage(at);
      },
    };
  }

  async prepare(): Promise<void> {
    const [map, flag, portraits] = await Promise.all([
      CircuitMap.load(),
      WavingFlag.load(flagUrl(eventCountry)),
      this.options.kind === "race"
        ? carPortraits(this.options.renderer)
        : Promise.resolve(new Map<string, CarPortrait>()),
    ]);
    this.map = map;
    this.flag = flag;
    this.portraits = portraits;
    this.buildLabels(map);
  }

  private skip(): void {
    this.clock = skipTarget(this.stages, this.clock);
  }

  private tag(id: string, text: string, className: string): HTMLElement {
    const node = el("div", `bu-tag ${className}`);
    node.append(el("span", "", text));
    this.labels.set(id, node);
    return node;
  }

  private buildLabels(map: CircuitMap): void {
    const { tags } = this.view;
    tags.append(
      this.tag("start", "Start / Finish", "big"),
      this.tag("s1", "Sector 1", ""),
      this.tag("s2", "Sector 2", ""),
      this.tag("s3", "Sector 3", ""),
      this.tag("detect", "Overtake Detection", ""),
      this.tag("mode1", "Straight Mode 1", ""),
      this.tag("mode2", "Straight Mode 2", ""),
      this.tag("trap", "Speed Trap", ""),
    );
    for (const turn of map.data.turns) {
      const disc = el("b", "bu-turn", String(turn.number));
      this.labels.set(`t${String(turn.number)}`, disc);
      tags.append(disc);
    }
  }

  private labelPlaces(map: CircuitMap): Record<string, [string, number]> {
    const { sectors, straights, speedTrap, track } = map.data;
    const [a = 0, b = 0] = sectors;
    const mid = (span: [number, number] | undefined) => {
      const [from = 0, to = 0] = span ?? [];
      const length = ((to - from + track.length) % track.length) / 2;
      return from + length;
    };
    return {
      start: ["map-sectors", 0],
      s1: ["map-sectors", a / 2],
      s2: ["map-sectors", (a + b) / 2],
      s3: ["map-sectors", (b + track.length) / 2],
      detect: ["map-zones", track.length * 0.94],
      mode1: ["map-zones", mid(straights[0])],
      mode2: ["map-zones", mid(straights[1])],
      trap: ["map-zones", speedTrap],
    };
  }

  private placeLabel(node: HTMLElement, map: CircuitMap, world: THREE.Vector3) {
    const spot = map.project(world);
    node.style.left = `${(spot.x * 1920).toFixed(1)}px`;
    node.style.top = `${(spot.y * 1080).toFixed(1)}px`;
    return spot;
  }

  private updateLabels(id: string, map: CircuitMap, progress: number): void {
    for (const [name, [stage, distance]] of Object.entries(
      this.labelPlaces(map),
    )) {
      const node = this.labels.get(name);
      if (!node) continue;
      const on = stage === id && progress > 0.08 && progress < 0.93;
      setOn(node, on);
      if (on) this.placeLabel(node, map, map.raisedAt(distance));
    }
    map.data.turns.forEach((turn, index) => {
      const node = this.labels.get(`t${String(turn.number)}`);
      if (!node) return;
      const reveal = 0.18 + (index / map.data.turns.length) * 0.32;
      const on = id === "map-turns" && progress > reveal && progress < 0.95;
      setOn(node, on);
      if (!on) return;
      const spot = this.placeLabel(
        node,
        map,
        map.raisedAt(turn.distance).add(new THREE.Vector3(0, 38, 0)),
      );
      const size = Math.min(1.5, 1900 / spot.depth);
      node.style.setProperty("--size", size.toFixed(3));
      node.style.zIndex = String(Math.round(10000 - spot.depth));
    });
  }

  private mapStage(id: string, at: StagePosition): void {
    const map = this.map;
    const poses = mapPoses[id];
    if (!map || !poses) return;
    const lifting = id === "map-turns";
    map.lift.value = lifting
      ? Math.min(1, Math.max(0, (at.time - 0.2) / stageEase))
      : 0;
    map.zones.value = id === "map-zones" ? Math.min(1, at.time / 0.7) : 0;
    const canvas = this.options.renderer.domElement;
    map.setPose(
      mixPose(poses[0], poses[1], at.progress),
      canvas.clientWidth / canvas.clientHeight,
    );
    this.updateLabels(id, map, at.progress);
    this.show(this.view.mapUi, true);
    this.show(this.view.stats, !lifting);
    this.show(this.view.partners, lifting && at.time > 0.9);
    renderDisplay(this.options.renderer, map.scene, map.camera);
  }

  private world(pose: CameraPose): void {
    this.options.world.setCinematic(pose);
    this.options.world.update(this.options.frame);
    this.options.drawWorld();
  }

  private drawBlack(): void {
    const { renderer } = this.options;
    renderer.setClearColor(0x000000);
    renderer.clear();
  }

  private drawFlag(): void {
    if (this.flag)
      renderDisplay(this.options.renderer, this.flag.scene, this.flag.camera);
  }

  private gridStage(at: StagePosition): void {
    const { grid } = this.options;
    if (at.stage.index !== this.shownPair) {
      this.shownPair = at.stage.index;
      this.renderPair(at.stage.index, grid);
    }
    const pairCount = Math.ceil(grid.length / 2);
    this.show(
      this.view.gridBox,
      at.stage.index < pairCount - 1 || at.progress < 0.92,
    );
    this.view.gridBox.classList.toggle("leaving", at.progress > 0.9);
  }

  private renderPair(index: number, grid: GridEntry[]): void {
    const first = grid[index * 2];
    const second = grid[index * 2 + 1];
    const box = this.view.gridBox;
    const title = el("div", "bu-grid-event", eventName.toUpperCase());
    const card = el("div", "bu-grid-card");
    const head = el("h2", "", "Starting Grid");
    const rows = el("div", "bu-grid-rows");
    for (let row = Math.max(0, index * 2 - 2); row < index * 2 + 6; row++) {
      const entry = grid[row];
      if (!entry) continue;
      const mark = el("i", row % 2 ? "even" : "odd", String(entry.position));
      mark.classList.toggle(
        "current",
        row === index * 2 || row === index * 2 + 1,
      );
      rows.append(mark);
    }
    card.append(
      head,
      rows,
      gridSlot(second, second && this.portraits.get(second.team.id), "left"),
      gridSlot(first, first && this.portraits.get(first.team.id), "right"),
    );
    box.replaceChildren(title, card);
  }

  private captionStage(at: StagePosition): void {
    if (at.stage.index !== this.shownCaption) {
      this.shownCaption = at.stage.index;
      this.renderCaption(at.stage.index);
    }
    this.show(this.view.caption, at.time > 0.6 && at.progress < 0.93);
  }

  private renderCaption(index: number): void {
    const { grid } = this.options;
    const box = this.view.caption;
    box.className = "bu-caption";
    if (index === 0) {
      box.classList.add("fact");
      const head = el("header", "");
      const flag = el("img", "flag");
      flag.src = flagUrl(eventCountry);
      flag.alt = "";
      head.append(el("b", "", "AUSTIN"), flag);
      box.replaceChildren(
        head,
        el(
          "p",
          "",
          "Turn 1 sits at the top of a steep climb from the grid, with a wide apex that invites several lines into the corner.",
        ),
      );
      return;
    }
    const slot = this.options.playerSlot;
    const neighbour = grid[slot > 0 ? slot - 1 : slot + 1];
    const entry = index === 1 ? neighbour : grid[slot];
    if (!entry) return;
    const names = el("h3", "");
    names.append(
      el("span", "", `${entry.first} `),
      el("b", "", entry.last.toUpperCase()),
    );
    box.replaceChildren(
      el("small", "", `${String(entry.position)}${ordinal(entry.position)}`),
      names,
      el("span", "", entry.team.fullName),
    );
  }

  private wipeStage(at: StagePosition): void {
    const { world } = this.options;
    setOn(this.view.wipe, true);
    if (at.progress > 0.5) world.setCinematic(null);
    else world.setCinematic(poseAt(shots.hill, 1, this.options.track));
    world.update(this.options.frame);
    this.options.drawWorld();
  }

  private show(node: HTMLElement, on: boolean): void {
    if (on) this.lit.add(node);
  }

  private applyVisibility(): void {
    const v = this.view;
    for (const node of [
      v.title,
      v.weather,
      v.mapUi,
      v.stats,
      v.partners,
      v.flagSign,
      v.gridBox,
      v.caption,
    ]) {
      const on = this.lit.has(node);
      if (isOn(node) !== on) setOn(node, on);
    }
    this.lit.clear();
  }

  private fade(at: StagePosition): void {
    const left = at.stage.end - at.stage.start - at.time;
    const cut = at.stage.id === "grid" || at.stage.id === "wipe";
    const edge = Math.min(at.time, left) / fadeSeconds;
    this.view.fade.style.opacity = cut
      ? "0"
      : String(Math.max(0, 1 - Math.min(1, edge)));
  }

  private tick(now: number): void {
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.clock += dt;
    const at = stageAt(this.stages, this.clock);
    if (!at) {
      this.resolve();
      return;
    }
    this.fade(at);
    this.handlers[at.stage.id](at);
    this.applyVisibility();
  }

  play(): Promise<void> {
    window.addEventListener("keydown", this.onKey, true);
    this.lastNow = performance.now();
    return new Promise((resolve) => {
      this.resolve = resolve;
      void this.options.renderer.setAnimationLoop(() => {
        this.tick(performance.now());
      });
    });
  }

  finish(): void {
    window.removeEventListener("keydown", this.onKey, true);
    void this.options.renderer.setAnimationLoop(null);
    this.options.world.setCinematic(null);
    this.map?.dispose();
    this.flag?.dispose();
    for (const portrait of this.portraits.values()) {
      URL.revokeObjectURL(portrait.left);
      URL.revokeObjectURL(portrait.right);
    }
    this.view.dispose();
  }
}

export async function playBuildUp(
  options: BuildUpOptions,
  host: HTMLElement,
  ready: () => void,
): Promise<void> {
  const director = new Director(options, host);
  try {
    await director.prepare();
    ready();
    await director.play();
  } finally {
    director.finish();
  }
}
