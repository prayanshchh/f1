import {
  PitStop,
  steerCommand,
  type PitDrive,
  type PitLayout,
} from "./game/pitstop.ts";
import frameUrl from "../../../content/tracks/cota/sd-frame.json?url";
import mapUrl from "../../../content/tracks/cota/circuit-map.json?url";
import "@fontsource-variable/saira/wdth.css";
import "./drive.css";
import "./front.css";
import "./buildup.css";
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
import { FrontEnd } from "./game/front-end.ts";
import {
  Hud,
  type HudOptions,
  lapTime,
  signed,
  type TrackMap,
} from "./game/hud.ts";
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
import { LapTrace } from "./game/laptrace.ts";
import { Menu } from "./game/menu.ts";
import type { CarStatus } from "./game/mfd.ts";
import { type PadCommands, PadLink } from "./game/pad.ts";
import { Atmosphere } from "./game/atmosphere.ts";
import { RaceLog } from "./game/race-log.ts";
import { loadReference, rememberReference } from "./game/reference.ts";
import { fetchJson, Scene } from "./game/scene.ts";
import { GameSound, openAudio } from "./game/sound/game-sound.ts";
import { StartLights } from "./game/start-lights.ts";
import {
  pitPenaltyFor,
  raceControlState,
  type StewardCar,
  type Turn,
} from "./game/stewards.ts";
import { surname } from "./game/tower.ts";
import { Studio } from "./game/studio.ts";
import { type PlayerSeat, startingGrid } from "./game/teams.ts";
import {
  applySettings,
  carOf,
  choices,
  loadSettings,
  type Settings,
  stageOf,
  trackOf,
} from "./game/settings.ts";
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
const hudRoot = document.querySelector<HTMLElement>("[data-testid=hud]");
const autostartKey = "f1.autostart";

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`drive page markup is missing ${selector}`);
  return found;
}

function padLink(): PadLink {
  return new PadLink(element("[data-pad=panel]"), element("[data-pad=badge]"));
}

function setStatus(text: string): void {
  if (status) {
    status.textContent = text;
    status.hidden = text === "";
  }
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

function showResults(hud: Hud, title: string): void {
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
        restart(true);
      },
    },
    {
      label: "Main Menu",
      run: () => {
        restart(false);
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
    return tyreChoice ?? (race ? nextCompound(fitted) : fitted);
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
const pitCompounds = 3;
const stewardPeriod = 0.1;
const fieldReferenceLap = 97.5;

function raceSystems(
  settings: Settings,
  stage: Stage | null,
  lights: StartLights,
): RaceSystems {
  return {
    countdown: lights.countdown,
    lightInterval: lights.interval,
    rules: {
      safetyCar: choices.safetyCar.findIndex(
        (c) => c.id === settings.safetyCar,
      ),
      redFlags: settings.redFlags,
      formationLap: settings.formationLap && stage === "race",
      rollingStart: settings.startType === "rolling" && stage === "race",
    },
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
  turns: Turn[],
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
  const renderer = new THREE.WebGPURenderer({
    canvas: target,
    reversedDepthBuffer: true,
    depth: false,
    alpha: false,
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  await renderer.init();
  return renderer;
}

function consumeAutostart(params: URLSearchParams): boolean {
  const restarted = sessionStorage.getItem(autostartKey) === "1";
  sessionStorage.removeItem(autostartKey);
  return restarted || params.has("autostart");
}

function chooseLights(
  stage: Stage | null,
  params: URLSearchParams,
): StartLights {
  return stage === "race" && !params.has("autostart")
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
}

async function runBuildUp(context: BuildUpContext): Promise<void> {
  const { renderer, scene, draw, engine, settings, seat, seek, kind, slot } =
    context;
  setStatus("Preparing the grid…");
  const opening = engine.update(performance.now() / 1000);
  scene.updateTyres(opening, engine.tyreInfo());
  scene.update(opening);
  const length = engine.trackLength();
  await playBuildUp(
    {
      renderer,
      world: scene,
      drawWorld: draw,
      frame: Float64Array.from(opening),
      track: (d, l) => engine.trackPoint(((d % length) + length) % length, l),
      trackLength: length,
      kind,
      grid: startingGrid(seat, slot),
      playerDistance: opening[frameIndex.distFromStart] ?? 0,
      playerLateral: opening[frameIndex.toMiddle] ?? 0,
      playerSlot: slot,
      weather: weatherFor(settings, engine.trackLocal().rain),
      seek: Number(seek ?? 0) || 0,
    },
    document.body,
    () => {
      setStatus("");
    },
  ).catch(() => {
    setStatus("");
  });
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

async function enterGame(
  renderer: THREE.WebGPURenderer,
  settings: Settings,
  menu: Menu,
): Promise<Driver> {
  const studio = new Studio(renderer);
  const front = new FrontEnd(element("[data-front=root]"), studio);
  front.open();
  setStatus("");
  void studio.preloadTeams();
  let driver = await currentDriver();
  for (;;) {
    driver ??= await front.welcome();
    if (!driver.onboarded) driver = await front.onboard(driver);
    rememberDriver(driver);
    const choice = await front.hub(driver);
    if (choice.action === "signout") {
      rememberDriver(null);
      driver = null;
      continue;
    }
    driver = choice.driver;
    rememberDriver(driver);
    settings.car = driver.team ?? settings.car;
    front.close();
    const action = await menu.run(false);
    if (action === "start") break;
    front.open();
  }
  studio.dispose();
  return driver;
}

async function signIn(
  autostart: boolean,
  renderer: THREE.WebGPURenderer,
  settings: Settings,
  menu: Menu,
): Promise<Driver | null> {
  if (autostart) return currentDriver();
  const driver = await enterGame(renderer, settings, menu);
  saveWeekend(null);
  return driver;
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
    throw new Error("This page needs WebGPU (Chrome 113 or newer).");

  const renderer = await createRenderer(canvas);

  const params = new URLSearchParams(location.search);
  setStatus("Loading Speed Dreams…");
  const module = await loadSpeedDreams();
  const settings = loadSettings(params);
  const source = setupSource(module);
  const menu = new Menu(source, settings);

  const autostart = consumeAutostart(params);
  const driver = await signIn(autostart, renderer, settings, menu);
  const audio = openAudio();

  const track = trackOf(settings);
  const setup = prepareSession(settings);
  const { stage, field, plan } = setup;
  const log = raceLog(driver, settings, stage);
  const lights = chooseLights(stage, params);
  const car = carOf(settings);
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
    raceSystems(settings, stage, lights),
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
  const { turns } = await fetchJson<{ turns: Turn[] }>(mapUrl);
  const hud = new Hud(
    hudRoot,
    trace,
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
  let buildingUp = false;
  let paused = false;
  let ended = false;
  let flow: WeekendFlow | null = null;
  const finished = () => ended || flow?.finished === true;
  const pause = () => {
    if (paused || finished()) return;
    paused = true;
    sound.mute(true);
    void menu.run(true).then((action) => {
      if (action === "resume") {
        hud.setParts(settings.hud);
        paused = false;
        sound.mute(false);
        return;
      }
      restart(true);
    });
  };

  const controls = raceControls(engine, hud, settings, stage === "race");

  const drive = (down: boolean, event: KeyboardEvent) => {
    if (down && event.code === "Space") pitPressed = true;
    if (controls.key(event, down)) return;
    const code = sdlKeycode(event);
    if (code === null) return;
    event.preventDefault();
    if (event.repeat) return;
    if (down && code === "p".charCodeAt(0)) pad.toggle();
    if (down) engine.viewKey(code, event.ctrlKey);
    engine.key(code, down);
  };
  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    if (buildingUp) return;
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
  scene.update(engine.update(performance.now() / 1000));
  setStatus("Preparing circuit…");
  await scene.warmUp(renderer, draw);
  setStatus("");
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
    log?.finish();
    sound.mute(true);
    window.setTimeout(() => {
      showResults(hud, sessionTitle(track.label, sessionLabel(stage), status));
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
      engine.setPitCompound(tyre);
      engine.pitService(startFuel, control.wingChange);
      controls.wingServed();
      controls.tyreServed();
    }
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
      canvas,
      hudRoot,
      labelsRoot: element("[data-hud=labels]"),
      resultsRoot: element("[data-results=root]"),
      settings,
      trackLabel: track.label,
      stage,
      field,
      restart,
    });
    flow.start();
  };
  let stewardSeen = 0;
  let stewardClock = 0;
  let lineups = 0;
  let restarts = 0;
  const watchRaceControl = () => {
    const rc = engine.raceControl();
    hud.updateRaceControl(rc);
    scene.setFormation(rc.state === raceControlState.formation);
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
  };
  let pitDriving = false;
  const step = (now: number) => {
    controls.pad(pad.pressed());
    if (!pitDriving) engine.analog(pad.current(now));
    const frame = engine.update(now);
    const steward = engine.stewardCar(0);
    const control = applyPit(frame, now, steward);
    pitDriving = control.drive !== null;
    watchStewards(steward, now);
    const rc = watchRaceControl();
    scene.updateSafetyCar(engine.safetyCarPose(), rc.safetyCarLights, now);
    if (flow) flow.update(now);
    else armOvertake(frame);
    const tyres = engine.tyreInfo();
    const energy = engine.energyInfo();
    const speedKph = Math.abs(frame[frameIndex.speed] ?? 0) * 3.6;
    const audio = engine.carAudio(frame);
    const rumble = scene.feel(
      audio.wheels,
      audio.speed,
      now,
      tyreRoughness(tyres),
    );
    pad.feedback(
      now,
      speedKph,
      frame[frameIndex.gear] ?? 0,
      rumble,
      energy.battery / energy.capacity,
      ersModes[energy.mode]?.label ?? "",
    );
    scene.update(frame);
    const info = engine.hudInfo();
    scene.setDash(info);
    scene.updateTyres(frame, tyres);
    scene.updatePit(control, frame);
    scene.marks.update(
      frame,
      engine.wheelGrip(),
      audio.wheels.map((w) => w.surface),
    );
    sound.update(audio);
    const status = engine.carStatus();
    hud.update(frame, info, tyres, energy, status, now, steward);
    hud.updatePit(control);
    watchBest();
    if (!flow && status.stopped) finishRace(status);
  };
  let flagLogged = false;
  const afterFlag = (now: number) => {
    if (!flagLogged) log?.finish();
    flagLogged = true;
    const frame = engine.update(now);
    flow?.update(now);
    scene.update(frame);
  };
  const seek = params.get("buildup");
  if (wantsBuildUp(settings, setup, autostart, seek)) {
    buildingUp = true;
    sound.mute(true);
    await runBuildUp({
      renderer,
      scene,
      draw,
      engine,
      settings,
      seat: playerSeat(driver, car.id),
      seek,
      kind: stage === "race" ? "race" : "practice",
      slot: gridSlot(setup, scene),
    });
    markBuildUpPlayed(setup);
    buildingUp = false;
    sound.mute(false);
    engine.update(performance.now() / 1000);
  }
  hudRoot.hidden = false;
  openWeekend();
  void renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000;
    const afterRace = flow?.finished === true;
    if (afterRace) afterFlag(now);
    else if (!paused && !ended) step(now);
    else if (!frameStale) return;
    frameStale = false;
    canvas.style.transform = scene.mirrored ? "scaleX(-1)" : "";
    draw();
  });
}

main().catch((error: unknown) => {
  document.body.dataset["driveStatus"] = "error";
  setStatus(error instanceof Error ? error.message : String(error));
});
