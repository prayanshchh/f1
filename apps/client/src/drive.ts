import {
  PitStop,
  steerCommand,
  type PitControl,
  type PitDrive,
  type PitLayout,
} from "./game/pitstop.ts";
import frameUrl from "../../../content/tracks/hill-country/sd-frame.json?url";
import mapUrl from "../../../content/tracks/hill-country/circuit-map.json?url";
import "@fontsource-variable/saira/wdth.css";
import "./drive.css";
import "./front.css";
import "./buildup.css";
import "./tutorial.css";
import * as THREE from "three/webgpu";
import {
  boostMode,
  ersModes,
  fuelMixes,
  nextErsMode,
  OvertakeDetector,
  toggleBoost,
} from "./game/energy.ts";
import {
  carField,
  carStride,
  carWheel,
  Engine,
  frameIndex,
  loadSpeedDreams,
  type RaceSystems,
  sessionKinds,
  type SessionPlan,
  setupSource,
} from "./game/engine.ts";
import {
  currentDriver,
  type Driver,
  driverOutbox,
  rememberDriver,
} from "./game/api.ts";
import { playBuildUp, type Weather } from "./game/buildup.ts";
import type { GridSpot } from "./game/buildup-shots.ts";
import { FrontEnd } from "./game/front-end.ts";
import { Hud, type HudOptions, lapTime, signed } from "./game/hud.ts";
import type { TrackMap } from "./game/minimap.ts";
import { sdlKeycode } from "./game/keys.ts";
import {
  retirementLabel,
  tyreRoughness,
  wingRequested,
} from "./game/damage.ts";
import {
  compoundIndex,
  compounds,
  nextCompound,
  wearScale,
} from "./game/tyres.ts";
import { idealCompound } from "./game/weather.ts";
import { IncidentCam } from "./game/incident-cam.ts";
import { InstantReplay } from "./game/instant-replay.ts";
import { LapTrace } from "./game/laptrace.ts";
import { Menu } from "./game/menu.ts";
import type { CarStatus } from "./game/mfd.ts";
import { type PadCommands, PadLink } from "./game/pad.ts";
import { PlayerError, playerMessage } from "./game/player-error.ts";
import { readyCard } from "./game/ready-card.ts";
import { Atmosphere } from "./game/atmosphere.ts";
import { RaceLog } from "./game/race-log.ts";
import { loadReference, rememberReference } from "./game/reference.ts";
import { fetchJson, Scene } from "./game/scene.ts";
import { GameSound, openAudio } from "./game/sound/game-sound.ts";
import { Music } from "./game/sound/music.ts";
import { LightCue, StartLights } from "./game/start-lights.ts";
import {
  flagCaption,
  flagTitle,
  pitPenaltyFor,
  stage as stewardStage,
  type StewardCar,
  type StewardMessage,
} from "./game/stewards.ts";
import { surname } from "./game/tower.ts";
import { Studio } from "./game/studio.ts";
import {
  fieldGrid,
  type GridEntry,
  gridOrder,
  type PlayerSeat,
  seatDriver,
  startingGrid,
  teamOf,
} from "./game/teams.ts";
import {
  applySettings,
  carOf,
  choices,
  loadSettings,
  saveSettings,
  type Settings,
  stageOf,
  trackOf,
} from "./game/settings.ts";
import type { CourseTurn } from "./game/tutorial.ts";
import {
  type TutorialHooks,
  type TutorialLive,
  TutorialRun,
  type TutorialTrack,
} from "./game/tutorial-run.ts";
import {
  armTutorial,
  consumeTutorial,
  keptChanges,
  rememberTutorial,
  tutorialSettings,
  tutorialStatus,
} from "./game/tutorial-settings.ts";
import {
  difficultyScale,
  lastSlot,
  loadWeekend,
  planWeekend,
  saveWeekend,
  segmentNames,
  type Stage,
  type WeekendPlan,
  type WeekendState,
} from "./game/weekend.ts";
import { WeekendFlow } from "./game/weekend-flow.ts";
import { showActions } from "./game/weekend-ui.ts";

const canvas = document.querySelector<HTMLCanvasElement>(
  "[data-testid=drive-canvas]",
);
const status = document.querySelector<HTMLElement>(
  "[data-testid=drive-status]",
);
const statusText = document.querySelector<HTMLElement>("[data-status-text]");
const hudRoot = document.querySelector<HTMLElement>("[data-testid=hud]");
const autostartKey = "revracers.autostart";

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`drive page markup is missing ${selector}`);
  return found;
}

function padLink(): PadLink {
  return new PadLink(element("[data-pad=panel]"), element("[data-pad=badge]"));
}

function setStatus(text: string): void {
  if (status) status.hidden = text === "";
  if (statusText && text) statusText.textContent = text;
}

function toHub(): void {
  const url = new URL(location.href);
  url.searchParams.delete("tutorial");
  location.assign(url);
}

function restart(autostart: boolean): void {
  if (autostart) sessionStorage.setItem(autostartKey, "1");
  location.reload();
}

function cell(text: string, className = ""): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function showResults(
  hud: Hud,
  title: string,
  again: (autostart: boolean) => void,
): void {
  const best = hud.laps.reduce<number | null>(
    (b, lap) => (b === null || lap.time < b ? lap.time : b),
    null,
  );
  const total = hud.laps.reduce((sum, lap) => sum + lap.time, 0);
  const sectorCount = hud.laps[0]?.sectors.length ?? 3;
  const bestSectors = Array.from({ length: sectorCount }, (_, i) =>
    Math.min(...hud.laps.map((lap) => lap.sectors[i] ?? Infinity)),
  );
  element("[data-results=title]").textContent = title;
  element("[data-results=summary]").textContent =
    `Total ${lapTime(total)} · Best ${lapTime(best)}`;
  element("[data-results=head]").replaceChildren(
    ...[
      "Lap",
      ...bestSectors.map((_, i) => `S${String(i + 1)}`),
      "Time",
      "Gap",
    ].map((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      return th;
    }),
  );
  element("[data-results=laps]").replaceChildren(
    ...hud.laps.map((lap, index) => {
      const row = document.createElement("tr");
      row.style.setProperty("--i", String(index));
      row.classList.toggle("best", lap.time === best);
      row.append(
        cell(String(lap.lap), "pos"),
        ...lap.sectors.map((t, i) =>
          cell(t.toFixed(3), t === bestSectors[i] ? "purple" : ""),
        ),
        cell(lapTime(lap.time), lap.time === best ? "purple time" : "time"),
        cell(
          best === null || lap.time === best ? "" : signed(lap.time - best),
          "gap",
        ),
      );
      return row;
    }),
  );
  const root = element("[data-results=root]");
  root.hidden = false;
  requestAnimationFrame(() => {
    root.classList.add("open");
  });
  showActions([
    {
      label: "Restart Session",
      run: () => {
        again(true);
      },
    },
    {
      label: "Main Menu",
      run: () => {
        again(false);
      },
    },
  ]);
}

function sessionTitle(
  track: string,
  session: string,
  status: CarStatus,
): string {
  const ended = status.stopped
    ? ` - Session ended: ${retirementLabel(status.retired)}`
    : "";
  return `${track} - ${session}${ended}`;
}

function trackMap(engine: Engine): TrackMap {
  const length = engine.trackLength();
  const count = Math.max(64, Math.min(600, Math.round(length / 10)));
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const [x, y] = engine.trackPoint((i / count) * length, 0);
    return [x, y] as [number, number];
  });
  return { points, length };
}

function fitStage(): void {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty("--s", String(scale));
}

function drawer(renderer: THREE.WebGPURenderer, scene: Scene): () => void {
  const atmosphere = new Atmosphere(renderer, scene.scene, scene.camera);
  return () => {
    scene.commitMoves();
    scene.hideUnseenCrew();
    atmosphere.update(scene.atmosphere);
    atmosphere.render();
    scene.renderAuxiliary(renderer);
  };
}

function raceControls(
  engine: Engine,
  hud: Hud,
  settings: Settings,
  race: boolean,
) {
  let cruise = settings.ersMode === boostMode ? 1 : settings.ersMode;
  let padBoost = 0;
  let padErs = 0;
  let padPage = 0;
  let padWing = 0;
  let padTyre = 0;
  let wingChoice: boolean | null = null;
  let tyreChoice: number | null = null;
  const tyreWanted = () => {
    const fitted = engine.tyreInfo().compound;
    if (tyreChoice !== null) return tyreChoice;
    if (!race) return fitted;
    const weather = engine.weather();
    return idealCompound(
      Math.max(weather.lineWater, weather.forecast[0] ?? 0),
      weather,
      fitted > 2 ? 1 : nextCompound(fitted),
    );
  };
  const pickTyre = (compound: number) => {
    tyreChoice = compound;
  };
  const cycleTyre = () => {
    tyreChoice = (tyreWanted() + 1) % pitCompounds;
  };
  const wingWanted = () => wingRequested(wingChoice, engine.carStatus());
  const flipWing = () => {
    wingChoice = !wingWanted();
  };
  const cycleErs = () => {
    cruise = nextErsMode(engine.energyInfo().mode, cruise);
    engine.setErsMode(cruise);
  };
  const flipBoost = () => {
    const mode = engine.energyInfo().mode;
    if (mode !== boostMode) cruise = mode;
    engine.setErsMode(toggleBoost(mode, cruise));
  };
  const nudgeBias = (delta: number) => {
    engine.setBrakeBias(engine.energyInfo().brakeBias + delta);
  };
  const keys: Record<string, () => void> = {
    b: flipBoost,
    m: cycleErs,
    f: () => {
      engine.setFuelMix((engine.energyInfo().fuelMix + 1) % fuelMixes.length);
    },
    "[": () => {
      nudgeBias(-0.01);
    },
    "]": () => {
      nudgeBias(0.01);
    },
    y: () => {
      hud.nextMfdPage();
    },
    tab: () => {
      hud.toggleTower();
    },
    n: flipWing,
    t: cycleTyre,
    "1": () => {
      pickTyre(0);
    },
    "2": () => {
      pickTyre(1);
    },
    "3": () => {
      pickTyre(2);
    },
    x: () => {
      engine.armStraight();
    },
    ",": () => {
      engine.setDifferential(engine.energyInfo().differential - 5);
    },
    ".": () => {
      engine.setDifferential(engine.energyInfo().differential + 5);
    },
  };
  return {
    key(event: KeyboardEvent, down: boolean): boolean {
      const action = keys[event.key.toLowerCase()];
      if (!action) return false;
      event.preventDefault();
      if (down && !event.repeat) action();
      return true;
    },
    pad(pressed: PadCommands): void {
      if (pressed.boost !== padBoost) flipBoost();
      if (pressed.ers !== padErs) cycleErs();
      if (pressed.page !== padPage) hud.nextMfdPage();
      if (pressed.wing !== padWing) flipWing();
      if (pressed.tyre !== padTyre) cycleTyre();
      padPage = pressed.page;
      padWing = pressed.wing;
      padTyre = pressed.tyre;
      padBoost = pressed.boost;
      padErs = pressed.ers;
    },
    wingChange: wingWanted,
    wingServed(): void {
      wingChoice = null;
    },
    tyre: tyreWanted,
    tyreServed(): void {
      tyreChoice = null;
    },
  };
}

const wearShortestRace = 28;
const pitCompounds = 5;
const stewardPeriod = 0.1;
const damagePeriod = 0.1;
const fieldReferenceLap = 97.5;

function raceSystems(
  settings: Settings,
  stage: Stage | null,
  lights: StartLights,
  interventions: boolean,
): RaceSystems {
  return {
    countdown: lights.countdown,
    lightInterval: lights.interval,
    rules: {
      safetyCar: choices.safetyCar.findIndex(
        (c) => c.id === settings.safetyCar,
      ),
      redFlags: settings.redFlags,
      rollingStart: settings.startType === "rolling" && stage === "race",
      interventions,
    },
    dynamicWeather: settings.rain === "dynamic",
    weatherSeed: Math.floor(Math.random() * 1_000_000) + 1,
    compound: stage === "qualifying" ? 0 : compoundIndex(settings.compound),
    wearScale: wearScale(
      stage === "qualifying" ? "real" : settings.tyreWear,
      stage === "race" ? "race" : "practice",
      Math.max(settings.laps, wearShortestRace),
    ),
    isRace: stage === "race",
    ersMode: settings.ersMode,
    fuelMix: settings.fuelMix,
    ersAssist: settings.ersAssist,
    straightAssist: settings.straightAssist,
  };
}

function sessionPlan(
  settings: Settings,
  stage: Stage,
  field: WeekendPlan,
): SessionPlan {
  return {
    kind: stage === "race" ? sessionKinds.race : sessionKinds.qualifying,
    laps: settings.laps,
    difficulty: difficultyScale(settings.difficulty),
    seed: Math.floor(Math.random() * 1_000_000),
    reference: fieldReferenceLap,
    field,
  };
}

interface SessionSetup {
  stage: Stage | null;
  field: WeekendPlan | null;
  plan: SessionPlan | null;
  weekend: WeekendState | null;
}

function prepareSession(settings: Settings): SessionSetup {
  const weekend = settings.session === "weekend" ? loadWeekend() : null;
  const stage = stageOf(settings, weekend?.stage ?? null);
  if (!stage) return { stage, field: null, plan: null, weekend };
  const skipped = settings.session === "weekend" && !weekend?.grid;
  const field = planWeekend(
    carOf(settings).id,
    skipped ? lastSlot : settings.startSlot,
    weekend?.grid ?? null,
  );
  return {
    stage,
    field,
    plan: sessionPlan(settings, stage, field),
    weekend,
  };
}

function rivalCars(field: WeekendPlan | null): string[] {
  return (field?.entrants ?? []).slice(1).map((entrant) => entrant.car);
}

function sessionLabel(stage: Stage | null): string {
  if (stage === "race") return "Race";
  return stage === "qualifying" ? (segmentNames[0] ?? "Q1") : "Practice";
}

function driverName(field: WeekendPlan | null, car: number): string {
  const entrant = field?.entrants[car];
  return entrant && car > 0 ? surname(entrant) : "You";
}

function hudOptions(
  settings: Settings,
  setup: SessionSetup,
  engine: Engine,
  best: number | null,
  lights: StartLights,
  turns: CourseTurn[],
  onLap: HudOptions["onLap"],
): HudOptions {
  return {
    stewards: {
      turns,
      name: (car) => driverName(setup.field, car),
      racing: setup.stage === "race",
    },
    totalLaps: setup.stage === "race" ? settings.laps : null,
    parts: settings.hud,
    session: sessionLabel(setup.stage),
    reference: best,
    map: trackMap(engine),
    field: setup.field?.entrants ?? null,
    qualifying: setup.stage === "qualifying",
    start: lights,
    startHint: setup.stage === "race" && settings.startType === "standing",
    rewindRetired: false,
    onLap,
  };
}

async function pitLayout(
  engine: Engine,
  field: WeekendPlan | null,
): Promise<PitLayout> {
  const { pit } = await fetchJson<{ pit: PitLayout }>(frameUrl);
  return field ? { ...pit, boxDistance: engine.playerBox() } : pit;
}

function pitInput(frame: Float64Array, laneClear: boolean) {
  return {
    distance: frame[frameIndex.distFromStart] ?? 0,
    toMiddle: frame[frameIndex.toMiddle] ?? 0,
    speed: Math.abs(frame[frameIndex.speed] ?? 0),
    laneClear,
  };
}

function poseOf(frame: Float64Array) {
  const posMat = frameIndex.posMat;
  return {
    x: frame[posMat + 12] ?? 0,
    y: frame[posMat + 13] ?? 0,
    heading: Math.atan2(frame[posMat + 1] ?? 0, frame[posMat] ?? 1),
    speed: Math.abs(frame[frameIndex.speed] ?? 0),
  };
}

async function createRenderer(
  target: HTMLCanvasElement,
): Promise<THREE.WebGPURenderer> {
  const adapter = await navigator.gpu.requestAdapter();
  const renderer = new THREE.WebGPURenderer({
    canvas: target,
    reversedDepthBuffer: true,
    depth: false,
    alpha: false,
    requiredLimits: adapter
      ? { maxTextureDimension2D: adapter.limits.maxTextureDimension2D }
      : {},
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  await renderer.init();
  return renderer;
}

function typing(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function consumeAutostart(params: URLSearchParams): boolean {
  const restarted = sessionStorage.getItem(autostartKey) === "1";
  sessionStorage.removeItem(autostartKey);
  return restarted || params.has("autostart");
}

function chooseLights(
  stage: Stage | null,
  params: URLSearchParams,
  tutorial: boolean,
): StartLights {
  return tutorial || (stage === "race" && !params.has("autostart"))
    ? StartLights.race(Math.random())
    : StartLights.quick();
}

function compoundId(index: number): string {
  return compounds[index]?.id ?? "medium";
}

function playerSeat(driver: Driver | null, team: string): PlayerSeat {
  return {
    team,
    first: driver?.firstName ?? "You",
    last: driver?.lastName ?? "",
    number: driver?.number ?? 1,
    nationality: driver?.nationality ?? "US",
  };
}

function bestLapWatcher(
  trace: LapTrace,
  store: (best: { trace: number[]; sectors: number[] }) => void,
): () => void {
  let saved = trace.bestTime ?? Infinity;
  return () => {
    const time = trace.bestTime ?? Infinity;
    if (time >= saved) return;
    saved = time;
    const best = trace.reference;
    if (best) store(best);
  };
}

interface BuildUpContext {
  renderer: THREE.WebGPURenderer;
  scene: Scene;
  draw: () => void;
  engine: Engine;
  settings: Settings;
  seat: PlayerSeat;
  seek: string | null;
  kind: "practice" | "race";
  slot: number;
  field: WeekendPlan | null;
  music: Music;
}

function parkedCars(live: Float64Array): Float64Array {
  const cars = Float64Array.from(live);
  for (let at = 0; at < cars.length; at += carStride) {
    cars[at + carField.steer] = 0;
    for (let wheel = 0; wheel < 4; wheel++)
      cars[at + carWheel.from + wheel * carWheel.stride + carWheel.yaw] = 0;
  }
  return cars;
}

function gridLineup(
  seat: PlayerSeat,
  slot: number,
  field: WeekendPlan | null,
  frame: Float64Array,
  cars: Float64Array | null,
): { grid: GridEntry[]; spots: GridSpot[] } {
  if (!field || !cars) return { grid: startingGrid(seat, slot), spots: [] };
  const spotOf = (index: number): GridSpot =>
    index === 0
      ? {
          distance: frame[frameIndex.distFromStart] ?? 0,
          lateral: frame[frameIndex.toMiddle] ?? 0,
        }
      : {
          distance: cars[index * carStride + carField.distance] ?? 0,
          lateral: cars[index * carStride + carField.toMiddle] ?? 0,
        };
  return {
    grid: fieldGrid(seat, field.entrants, field.slots),
    spots: gridOrder(field.slots).map(spotOf),
  };
}

async function runBuildUp(context: BuildUpContext): Promise<void> {
  const { renderer, scene, draw, engine, settings, seat, seek, kind, slot } =
    context;
  const { field, music } = context;
  setStatus("Preparing the grid…");
  const opening = engine.update(performance.now() / 1000);
  scene.updateTyres(opening, engine.tyreInfo());
  scene.update(opening);
  const length = engine.trackLength();
  const cars = field ? parkedCars(engine.cars()) : null;
  const lineup = gridLineup(seat, slot, field, opening, cars);
  scene.atmosphere.detail = true;
  await playBuildUp(
    {
      renderer,
      world: scene,
      drawWorld: draw,
      frame: Float64Array.from(opening),
      track: (d, l) => engine.trackPoint(((d % length) + length) % length, l),
      trackLength: length,
      kind,
      grid: lineup.grid,
      spots: lineup.spots,
      field: cars,
      onStage: (id) => {
        if (id === "wipe") music.stop();
      },
      playerDistance: opening[frameIndex.distFromStart] ?? 0,
      playerLateral: opening[frameIndex.toMiddle] ?? 0,
      playerSlot: slot,
      weather: weatherFor(settings, engine.trackLocal().rain),
      seek: Number(seek ?? 0) || 0,
    },
    document.body,
    () => {
      setStatus("");
      music.play("buildup");
    },
  ).catch(() => {
    setStatus("");
  });
  scene.atmosphere.detail = false;
  music.stop();
}

function raceLog(
  driver: Driver | null,
  settings: Settings,
  stage: Stage | null,
): RaceLog | null {
  if (!driver) return null;
  return new RaceLog(driverOutbox(driver.id), {
    id: crypto.randomUUID(),
    track: settings.track,
    car: carOf(settings).car,
    team: settings.car,
    kind: stage === "race" ? "race" : "practice",
    plannedLaps: stage === "race" ? settings.laps : null,
    conditions: {
      compound: settings.compound,
      timeOfDay: settings.timeOfDay,
      clouds: settings.clouds,
      rain: settings.rain,
      season: settings.season,
      transmission: settings.transmission,
      assist: settings.assist,
    },
    startedAt: new Date().toISOString(),
  });
}

function weatherFor(settings: Settings, rain: number): Weather {
  const seasonal: Record<string, number> = {
    spring: 24,
    summer: 33,
    autumn: 26,
    winter: 15,
  };
  const skies: Record<string, string> = {
    "no cloud": "Clear",
    "few clouds": "Light Cloud",
    "scarce clouds": "Light Cloud",
    "many clouds": "Cloudy",
    "full cover": "Overcast",
  };
  const wet = rain > 0;
  const overcast = ["many clouds", "full cover"].includes(settings.clouds);
  return {
    temperature:
      (seasonal[settings.season] ?? 27) - rain * 3 - (overcast ? 2 : 0),
    label: wet ? "Rain (Wet)" : `${skies[settings.clouds] ?? "Clear"} (Dry)`,
    icon: wet ? "rain" : overcast ? "cloud" : "sun",
  };
}

interface Entry {
  driver: Driver | null;
  tutorial: boolean;
}

async function firstVisit(front: FrontEnd, driver: Driver): Promise<boolean> {
  if (driver.onboarded || tutorialStatus() !== null) return false;
  if ((await front.tutorialOffer()) === "tutorial") return true;
  rememberTutorial("skipped");
  return false;
}

async function enterGame(
  renderer: THREE.WebGPURenderer,
  settings: Settings,
  menu: Menu,
  music: Music,
): Promise<Entry> {
  const studio = new Studio(renderer);
  const front = new FrontEnd(element("[data-front=root]"), studio);
  front.open();
  music.opening();
  void studio.preloadTeams();
  const known = await currentDriver();
  setStatus("");
  let driver = known ?? (await front.welcome());
  const leave = (tutorial: boolean): Entry => {
    front.close();
    studio.dispose();
    return { driver, tutorial };
  };
  for (;;) {
    if (await firstVisit(front, driver)) return leave(true);
    if (!driver.onboarded) {
      music.play("menu");
      driver = await front.onboard(driver);
    }
    rememberDriver(driver);
    const choice = await front.hub(driver);
    driver = choice.driver;
    rememberDriver(driver);
    settings.car = driver.team ?? settings.car;
    if (choice.action === "tutorial") return leave(true);
    front.close();
    music.play("menu");
    const action = await menu.run(false);
    if (action === "start") return leave(false);
    front.open();
  }
}

async function signIn(
  autostart: boolean,
  renderer: THREE.WebGPURenderer,
  settings: Settings,
  menu: Menu,
  music: Music,
): Promise<Entry> {
  if (autostart) return { driver: await currentDriver(), tutorial: false };
  const entry = await enterGame(renderer, settings, menu, music);
  saveWeekend(null);
  return entry;
}

async function enter(
  params: URLSearchParams,
  renderer: THREE.WebGPURenderer,
  settings: Settings,
  menu: Menu,
  music: Music,
): Promise<Entry & { autostart: boolean }> {
  const autostart = consumeAutostart(params);
  const entry = consumeTutorial(params)
    ? { driver: await currentDriver(), tutorial: true }
    : await signIn(autostart, renderer, settings, menu, music);
  return { ...entry, autostart: autostart || entry.tutorial };
}

function startTutorial(
  tutorial: boolean,
  settings: Settings,
  menu: Menu,
): void {
  if (!tutorial) return;
  const real = structuredClone(settings);
  Object.assign(settings, tutorialSettings(real));
  const start = structuredClone(settings);
  menu.useTutorial((now) => {
    saveSettings(keptChanges(real, start, now));
  });
}

function wantsBuildUp(
  settings: Settings,
  setup: SessionSetup,
  autostart: boolean,
  seek: string | null,
): boolean {
  const weekendRace =
    setup.weekend?.stage === "race" && setup.weekend.buildUpPlayed !== true;
  return (!autostart || weekendRace) && settings.buildUp && seek !== "off";
}

function markBuildUpPlayed(setup: SessionSetup): void {
  if (setup.weekend) saveWeekend({ ...setup.weekend, buildUpPlayed: true });
}

function gridSlot(setup: SessionSetup, scene: Scene): number {
  return setup.field ? (setup.field.slots[0] ?? 0) : scene.playerSlot;
}

function readyFirst(params: URLSearchParams, coach: TutorialRun | null) {
  return !params.has("autostart") && !coach;
}

function schoolHud(options: HudOptions, tutorial: boolean): HudOptions {
  return tutorial
    ? { ...options, session: "Tutorial", startHint: false, rewindRetired: true }
    : options;
}

async function schoolRun(
  tutorial: boolean,
  hooks: TutorialHooks,
  track: TutorialTrack,
): Promise<TutorialRun | null> {
  return tutorial ? TutorialRun.load(hooks, track) : null;
}

function debugHooks(
  params: URLSearchParams,
  engine: Engine,
  scene: Scene,
  renderer: THREE.WebGPURenderer,
): void {
  if (params.has("autopilot")) engine.autopilot(true);
  if (params.has("debug"))
    Object.assign(window, { f1Debug: { engine, scene, renderer } });
}

async function main(): Promise<void> {
  if (!canvas || !hudRoot) throw new Error("drive page markup is missing");
  fitStage();
  window.addEventListener("resize", fitStage);
  if (!("gpu" in navigator))
    throw new PlayerError("This page needs WebGPU (Chrome 113 or newer).");

  const renderer = await createRenderer(canvas);

  const params = new URLSearchParams(location.search);
  setStatus("Loading Speed Dreams…");
  const module = await loadSpeedDreams();
  const settings = loadSettings(params);
  const source = setupSource(module);
  const interventions = params.has("interventions");
  const menu = new Menu(source, settings, interventions);
  const music = new Music(() => settings.musicVolume / 100);

  const entry = await enter(params, renderer, settings, menu, music);
  const { driver, autostart } = entry;
  startTutorial(entry.tutorial, settings, menu);
  const audio = openAudio();

  const track = trackOf(settings);
  const setup = prepareSession(settings);
  const seek = params.get("buildup");
  if (wantsBuildUp(settings, setup, autostart, seek)) music.preload("buildup");
  const { stage, field, plan } = setup;
  const log = raceLog(driver, settings, stage);
  const lights = chooseLights(stage, params, entry.tutorial);
  const car = carOf(settings);
  const seat = playerSeat(driver, car.id);
  applySettings(source, settings, stage);
  setStatus(`Loading ${track.label}…`);
  const engine = Engine.start(
    module,
    track.category,
    track.id,
    car.car,
    settings.assist,
    settings.antiLock,
    performance.now() / 1000,
    raceSystems(settings, stage, lights, interventions),
    plan,
  );
  const scene = await Scene.load(
    engine,
    car.id,
    renderer,
    settings.racingLine,
    rivalCars(field),
    lights,
  );
  const draw = drawer(renderer, scene);
  debugHooks(params, engine, scene, renderer);

  const reference = await loadReference(driver, settings.track, car.car);
  const trace = new LapTrace(
    engine.trackLength(),
    engine.sectorBoundaries(),
    reference,
  );
  const { turns } = await fetchJson<{ turns: CourseTurn[] }>(mapUrl);
  const hud = new Hud(
    hudRoot,
    trace,
    schoolHud(
      hudOptions(
        settings,
        setup,
        engine,
        trace.bestTime,
        lights,
        turns,
        (lap) => {
          log?.lap(lap, compoundId(engine.tyreInfo().compound));
        },
      ),
      entry.tutorial,
    ),
  );
  const pad = padLink();
  const sound = await GameSound.start(audio);

  let frameStale = true;
  const resize = () => {
    frameStale = true;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    scene.resize(width, height);
    engine.viewResize(width, height);
  };
  window.addEventListener("resize", resize);
  resize();

  let pitPressed = false;
  let damageClock = 0;
  let replay: InstantReplay | null = null;
  let pitPhase = "track";
  const jumpBack = (school: TutorialRun) => {
    const now = engine.frame()[frameIndex.time] ?? 0;
    if (!replay?.jumpBack(school.rewindTarget(now))) return false;
    school.rewound();
    return true;
  };
  const openReplay = () => {
    if (finished() || coach?.busy === true) return;
    if (coach && jumpBack(coach)) return;
    replay?.open(performance.now() / 1000);
    if (replay?.active) coach?.replayed();
  };
  let buildingUp = false;
  let paused = false;
  let waiting = false;
  let ended = false;
  let flow: WeekendFlow | null = null;
  let coach: TutorialRun | null = null;
  const finished = () => ended || flow?.finished === true;
  const again = (auto: boolean) => {
    if (coach && auto) armTutorial();
    restart(auto);
  };
  const leave = () => {
    if (coach) coach.skip();
    else restart(true);
  };
  const pause = () => {
    if (paused || finished()) return;
    paused = true;
    sound.mute(true);
    void menu.run(true).then((action) => {
      if (action === "resume" || action === "replay") {
        pad.close();
        hud.setParts(settings.hud);
        paused = false;
        sound.mute(coach?.quiet ?? false);
        if (action === "replay") openReplay();
        return;
      }
      leave();
    });
  };

  const phoneKey = (event: KeyboardEvent) => {
    if (event.code !== "KeyP" || buildingUp || typing(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "keydown" || event.repeat) return;
    pad.toggle();
    if (pad.panelOpen && !waiting && coach?.holding !== true) pause();
  };
  window.addEventListener("keydown", phoneKey, true);
  window.addEventListener("keyup", phoneKey, true);

  const controls = raceControls(engine, hud, settings, stage === "race");

  const drive = (down: boolean, event: KeyboardEvent) => {
    if (down && event.code === "Space") pitPressed = true;
    if (controls.key(event, down)) return;
    const code = sdlKeycode(event);
    if (code === null) return;
    event.preventDefault();
    if (event.repeat) return;
    if (down) engine.viewKey(code, event.ctrlKey);
    engine.key(code, down);
  };
  const replayKey = (down: boolean, event: KeyboardEvent): boolean => {
    if (replay?.active) {
      replay.key(event, down);
      return true;
    }
    const wanted =
      down && event.key.toLowerCase() === "r" && !event.repeat && !paused;
    if (wanted) openReplay();
    return wanted;
  };
  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    if (buildingUp || replayKey(down, event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (down && !event.repeat) pause();
    } else if (!paused && !finished()) {
      drive(down, event);
    }
  };
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));

  const layout = await pitLayout(engine, field);
  const pit = new PitStop(layout, settings.pitExperience === "broadcast");
  scene.placePit(layout, (d, l) => engine.trackPoint(d, l));
  scene.setWeather(engine.weather());
  scene.update(engine.update(performance.now() / 1000));
  setStatus("Preparing circuit…");
  await scene.warmUp(renderer, draw);
  setStatus("");
  replay = new InstantReplay({
    engine,
    scene,
    hud,
    trace,
    root: element("[data-replay-root]"),
    reelRoot: element("[data-reel-root]"),
    hidden: [hudRoot],
    names: field
      ? field.entrants.map((entrant) =>
          entrant.player ? "You" : seatDriver(seat, entrant).last,
        )
      : ["You"],
    totalLaps: stage === "race" ? settings.laps : null,
    onTrack: () =>
      pitPhase === "track" && !finished() && (flow?.flashbackAllowed ?? true),
    mute: (muted) => {
      sound.mute(muted);
    },
  });
  const incident = new IncidentCam(
    element("[data-hud=incident]"),
    renderer,
    scene,
    replay.tape,
    replay.stations,
    engine.trackLength(),
  );
  const showIncidents = (messages: StewardMessage[]) => {
    const name = (car: number) => driverName(setup.field, car);
    for (const message of messages)
      if (message.stage === stewardStage.flag)
        incident.play(
          message.car,
          message.time,
          message.value,
          flagTitle(message),
          flagCaption(message, name, turns),
        );
  };
  document.body.dataset["driveStatus"] = "running";

  const startFuel = engine.hudInfo().fuel;
  let padBrakeWas = false;
  const steerToward = (frame: Float64Array, target: PitDrive) => {
    const ahead = (frame[frameIndex.distFromStart] ?? 0) + target.lookahead;
    return steerCommand(
      poseOf(frame),
      engine.trackPoint(ahead, target.lateral - pit.shiftAt(ahead)),
      target.speed,
    );
  };

  const watchBest = bestLapWatcher(trace, (best) => {
    rememberReference(driver, settings.track, car.car, best);
    log?.personalBest(best);
  });
  const finishRace = (status: CarStatus) => {
    ended = true;
    coach?.stop();
    log?.finish();
    sound.mute(true);
    music.play("menu");
    window.setTimeout(() => {
      showResults(
        hud,
        sessionTitle(track.label, sessionLabel(stage), status),
        again,
      );
    }, 1500);
  };
  const detector = new OvertakeDetector(engine.trackLength());
  const armOvertake = (frame: Float64Array) => {
    const distance = frame[frameIndex.distFromStart] ?? 0;
    const gap = trace.delta(distance, frame[frameIndex.curLapTime] ?? 0);
    if (detector.crossing(distance, gap)) engine.armOvertake();
  };
  const pitButton = (now: number) => {
    const padInput = pad.current(now);
    const brakeDown = (padInput?.brake ?? 0) > 0.5;
    const pressed = pitPressed || (brakeDown && !padBrakeWas);
    padBrakeWas = brakeDown;
    pitPressed = false;
    return { padInput, pressed };
  };
  let servedTyre: number | null = null;
  const freshTyre = () => servedTyre ?? controls.tyre();
  const applyPit = (frame: Float64Array, now: number, steward: StewardCar) => {
    const { padInput, pressed } = pitButton(now);
    pit.setPenalty(pitPenaltyFor(steward));
    const replaceWing = controls.wingChange();
    hud.setWingChoice(replaceWing);
    pit.requestWing(replaceWing);
    const tyre = controls.tyre();
    hud.setTyreChoice(tyre);
    const control = pit.update(
      pitInput(frame, engine.pitLaneClear()),
      now,
      pressed,
    );
    engine.speedLimit(control.limit);
    engine.pitHold(control.hold);
    engine.analog(
      control.drive ? steerToward(frame, control.drive) : padInput,
      control.drive !== null,
    );
    if (control.serviceNow) {
      servedTyre = tyre;
      engine.setPitCompound(tyre);
      engine.pitService(startFuel, control.wingChange);
      controls.wingServed();
      controls.tyreServed();
    } else if (control.phase !== "service") servedTyre = null;
    return control;
  };
  const openWeekend = () => {
    if (!field || !stage) return;
    flow = new WeekendFlow({
      engine,
      scene,
      hud,
      pit,
      sound,
      music,
      hudRoot,
      resultsRoot: element("[data-results=root]"),
      settings,
      trackLabel: track.label,
      stage,
      field,
      restart,
      celebrate: (done) =>
        replay.celebrate(
          { first: seat.first, last: seat.last, team: teamOf(seat.team).name },
          done,
        ),
    });
    flow.start();
  };
  const lightCue = new LightCue();
  let stewardSeen = 0;
  let stewardClock = 0;
  let lineups = 0;
  let restarts = 0;
  const watchRaceControl = () => {
    const rc = engine.raceControl();
    hud.updateRaceControl(rc);
    if (rc.lineups !== lineups) {
      lineups = rc.lineups;
      pit.abort();
    }
    if (rc.restarts !== restarts) {
      restarts = rc.restarts;
      const restart = StartLights.restart(rc.countdown);
      hud.restartLights(restart, rc.signalTime);
      scene.restartLights(restart, rc.signalTime);
    }
    return rc;
  };
  const watchStewards = (steward: StewardCar, now: number) => {
    if (now - stewardClock < stewardPeriod) return;
    stewardClock = now;
    const messages = engine.stewardMessages(stewardSeen);
    stewardSeen = messages.at(-1)?.id ?? stewardSeen;
    hud.updateStewards(messages, steward, engine.stewardFlags(), now);
    showIncidents(messages);
  };
  const beepLights = () => {
    if (lightCue.next(hud.litLights)) sound.startLight();
  };
  let pitDriving = false;
  const clock = (now: number) => (coach ? coach.time(now) : now);
  const teach = (
    now: number,
    live: Omit<TutorialLive, "pit">,
    control: PitControl,
  ) => {
    coach?.update(now, {
      ...live,
      pit: control.phase,
    });
  };
  const endIfStopped = (status: CarStatus) => {
    if (!flow && !coach && status.stopped) finishRace(status);
  };
  const idle = (now: number) => {
    coach?.idle(now);
    return frameStale;
  };
  const step = (now: number) => {
    controls.pad(pad.pressed());
    if (!pitDriving) engine.analog(pad.current(now));
    const frame = engine.update(clock(now));
    const steward = engine.stewardCar(0);
    const control = applyPit(frame, now, steward);
    pitDriving = control.drive !== null;
    watchStewards(steward, now);
    const rc = watchRaceControl();
    scene.updateSafetyCar(engine.safetyCarPose(), rc.safetyCarLights, now);
    pitPhase = control.phase;
    if (flow) flow.update(now);
    else armOvertake(frame);
    replay.record(frame, scene.fieldCars);
    const tyres = engine.tyreInfo();
    const energy = engine.energyInfo();
    const speedKph = Math.abs(frame[frameIndex.speed] ?? 0) * 3.6;
    const weather = engine.weather();
    const audio = engine.carAudio(frame);
    audio.rain = weather.rain;
    audio.water = weather.carWater;
    const rumble = scene.feel(
      audio.wheels,
      audio.speed,
      now,
      tyreRoughness(tyres),
    );
    pad.feedback(now, {
      speed: speedKph,
      gear: frame[frameIndex.gear] ?? 0,
      rumble,
      battery: energy.battery / energy.capacity,
      mode: ersModes[energy.mode]?.label ?? "",
      boost: energy.mode === boostMode,
    });
    scene.setWeather(weather);
    if (now - damageClock > damagePeriod) {
      damageClock = now;
      scene.setDamage(engine.carsDamage(), frame);
    }
    scene.update(frame);
    hud.tagCars(scene.fieldCars, scene.camera);
    incident.prepare(frame);
    const info = engine.hudInfo();
    scene.setDash(info);
    scene.updateTyres(frame, tyres);
    scene.updatePit(control, frame, freshTyre());
    scene.marks.update(
      frame,
      engine.wheelGrip(),
      audio.wheels.map((w) => w.surface),
    );
    sound.update(audio);
    const status = engine.carStatus();
    hud.update(frame, info, tyres, energy, status, now, steward, weather);
    beepLights();
    hud.updatePit(control);
    watchBest();
    teach(
      now,
      {
        frame,
        surfaces: audio.wheels.map((wheel) => wheel.surface),
        boost: energy.mode === boostMode,
        status,
        tyres,
      },
      control,
    );
    endIfStopped(status);
  };
  let flagLogged = false;
  const afterFlag = (now: number) => {
    if (!flagLogged) log?.finish();
    flagLogged = true;
    const frame = engine.update(now);
    flow?.update(now);
    scene.update(frame);
    incident.prepare(frame);
  };
  if (wantsBuildUp(settings, setup, autostart, seek)) {
    buildingUp = true;
    sound.mute(true);
    await runBuildUp({
      renderer,
      scene,
      draw,
      engine,
      settings,
      seat,
      seek,
      kind: stage === "race" ? "race" : "practice",
      slot: gridSlot(setup, scene),
      field,
      music,
    });
    markBuildUpPlayed(setup);
    buildingUp = false;
    sound.mute(false);
    engine.update(performance.now() / 1000);
  }
  music.stop();
  hudRoot.hidden = false;
  coach = await schoolRun(
    entry.tutorial,
    {
      root: element("[data-tutorial=root]"),
      engine,
      pad,
      menuOpen: () => menu.open,
      mfdPage: () => element("[data-hud=mfd]").dataset["page"] ?? "quick",
      mute: (muted) => {
        sound.mute(muted);
      },
      finish: (result) => {
        rememberTutorial(result);
        toHub();
      },
    },
    { turns },
  );
  waiting = readyFirst(params, coach);
  if (waiting)
    void readyCard(element("[data-ready=root]"), pad).then(() => {
      waiting = false;
    });
  openWeekend();
  const holdForReady = () => {
    if (frameStale) draw();
    frameStale = false;
  };
  void renderer.setAnimationLoop(() => {
    if (waiting) {
      holdForReady();
      return;
    }
    const now = performance.now() / 1000;
    if (replay.active) {
      replay.frame(now);
      draw();
      return;
    }
    const afterRace = flow?.finished === true;
    if (afterRace) afterFlag(now);
    else if (!paused && !ended) step(now);
    else if (!idle(now)) return;
    frameStale = false;
    canvas.style.transform = scene.mirrored ? "scaleX(-1)" : "";
    draw();
    incident.render();
  });
}

main().catch((error: unknown) => {
  document.body.dataset["driveStatus"] = "error";
  setStatus(
    playerMessage(error, "The race could not load. Reload to try again."),
  );
});
