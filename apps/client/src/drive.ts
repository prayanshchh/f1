import {
  PitStop,
  steerCommand,
  type PitDrive,
  type PitLayout,
} from "./game/pitstop.ts";
import "@fontsource-variable/saira/wdth.css";
import "./drive.css";
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
import { Hud, type HudOptions, type TrackMap } from "./game/hud.ts";
import { sdlKeycode } from "./game/keys.ts";
import { compoundIndex, nextCompound, wearScale } from "./game/tyres.ts";
import { LapTrace } from "./game/laptrace.ts";
import { Menu } from "./game/menu.ts";
import { SdAssets } from "./game/models.ts";
import { type PadCommands, PadLink } from "./game/pad.ts";
import { Atmosphere } from "./game/atmosphere.ts";
import { Scene } from "./game/scene.ts";
import { GameSound } from "./game/sound/game-sound.ts";
import {
  applySettings,
  carOf,
  defaults,
  loadSettings,
  type Settings,
  stageOf,
  trackOf,
} from "./game/settings.ts";
import {
  difficultyScale,
  loadWeekend,
  planWeekend,
  saveWeekend,
  segmentNames,
  type Stage,
  type WeekendPlan,
} from "./game/weekend.ts";
import { WeekendFlow } from "./game/weekend-flow.ts";

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

function referenceKey(settings: Settings): string {
  return `f1.best.${settings.track}.${carOf(settings).car}`;
}

function loadReference(
  settings: Settings,
): { trace: number[]; sectors: number[] } | null {
  try {
    const stored = JSON.parse(
      localStorage.getItem(referenceKey(settings)) ?? "null",
    ) as { trace: number[]; sectors: number[] } | null;
    return stored &&
      Array.isArray(stored.trace) &&
      Array.isArray(stored.sectors)
      ? stored
      : null;
  } catch {
    return null;
  }
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
    atmosphere.update(scene.atmosphere);
    atmosphere.render();
  };
}

function raceControls(engine: Engine, hud: Hud, settings: Settings) {
  let cruise = settings.ersMode === boostMode ? 1 : settings.ersMode;
  let padBoost = 0;
  let padErs = 0;
  let padPage = 0;
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
      padPage = pressed.page;
      padBoost = pressed.boost;
      padErs = pressed.ers;
    },
  };
}

const fieldCar = "22mp1-sector-mcl36";
const wearShortestRace = 28;
const shortQualifying = 0.5;
const fieldReferenceLap = 97.5;

function raceSystems(settings: Settings, stage: Stage | null): RaceSystems {
  return {
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
    lengthScale: settings.qualifyingLength === "short" ? shortQualifying : 1,
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
}

function prepareSession(settings: Settings): SessionSetup {
  const weekend = settings.session === "weekend" ? loadWeekend() : null;
  const stage = stageOf(settings, weekend?.stage ?? null);
  if (!stage) return { stage, field: null, plan: null };
  if (carOf(settings).car !== fieldCar) settings.car = defaults.car;
  const field = planWeekend(
    settings.team,
    settings.startSlot,
    weekend?.grid ?? null,
  );
  return { stage, field, plan: sessionPlan(settings, stage, field) };
}

function fieldColours(field: WeekendPlan | null) {
  const [player, ...rivals] = field?.entrants ?? [];
  return {
    player: player?.colour ?? null,
    rivals: rivals.map((entrant) => entrant.colour),
  };
}

function referenceLap(reference: { sectors: number[] } | null): number | null {
  return reference ? reference.sectors.reduce((a, b) => a + b, 0) : null;
}

function sessionLabel(stage: Stage | null): string {
  if (stage === "race") return "Race";
  return stage === "qualifying" ? (segmentNames[0] ?? "Q1") : "Practice";
}

function hudOptions(
  settings: Settings,
  setup: SessionSetup,
  engine: Engine,
  best: number | null,
  lightLead: number | null,
): HudOptions {
  return {
    totalLaps: setup.stage === "race" ? settings.laps : null,
    parts: settings.hud,
    session: sessionLabel(setup.stage),
    reference: best,
    map: trackMap(engine),
    field: setup.field?.entrants ?? null,
    qualifying: setup.stage === "qualifying",
    lightLead: lightLead ?? 2,
    lightInterval: lightLead === null ? 0.4 : 1,
  };
}

async function startRenderer(
  target: HTMLCanvasElement,
): Promise<THREE.WebGPURenderer> {
  if (!("gpu" in navigator))
    throw new Error("This page needs WebGPU (Chrome 113 or newer).");
  const renderer = new THREE.WebGPURenderer({
    canvas: target,
    antialias: true,
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  await renderer.init();
  return renderer;
}

async function runMenu(menu: Menu, params: URLSearchParams): Promise<void> {
  const autostart =
    sessionStorage.getItem(autostartKey) === "1" || params.has("autostart");
  sessionStorage.removeItem(autostartKey);
  if (autostart) return;
  setStatus("");
  await menu.run(false);
  saveWeekend(null);
}

async function pitLayout(
  engine: Engine,
  field: WeekendPlan | null,
): Promise<PitLayout> {
  const { pit } = (await (await fetch("/wasm/sd-frame.json")).json()) as {
    pit: PitLayout;
  };
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

async function main(): Promise<void> {
  if (!canvas || !hudRoot) throw new Error("drive page markup is missing");
  fitStage();
  window.addEventListener("resize", fitStage);
  const renderer = await startRenderer(canvas);

  const params = new URLSearchParams(location.search);
  setStatus("Loading Speed Dreams…");
  const module = await loadSpeedDreams();
  const settings = loadSettings(params);
  const source = setupSource(module);
  const menu = new Menu(source, settings);
  await runMenu(menu, params);

  const track = trackOf(settings);
  const setup = prepareSession(settings);
  const { stage, field, plan } = setup;
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
    raceSystems(settings, stage),
    plan,
  );
  if (params.has("autopilot")) engine.autopilot(true);
  const lightLead = stage === "race" ? engine.session().startDelay : null;
  const assets = await SdAssets.open("/wasm/sd/");
  const colours = fieldColours(field);
  const scene = await Scene.load(
    engine,
    assets,
    car.body,
    renderer.getMaxAnisotropy(),
    settings.racingLine,
    colours.rivals,
    lightLead,
    colours.player,
  );
  const draw = drawer(renderer, scene);

  const reference = loadReference(settings);
  const trace = new LapTrace(
    engine.trackLength(),
    engine.sectorBoundaries(),
    reference,
  );
  const bestOfReference = referenceLap(reference);
  const hud = new Hud(
    hudRoot,
    trace,
    hudOptions(settings, setup, engine, bestOfReference, lightLead),
  );
  const pad = padLink();
  const sound = await GameSound.start();
  hudRoot.hidden = false;

  const resize = () => {
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
  let paused = false;
  let flow: WeekendFlow | null = null;
  const finished = () => flow?.finished === true;
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

  const controls = raceControls(engine, hud, settings);

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
    if (event.key === "Escape") {
      event.preventDefault();
      if (down && !event.repeat) pause();
    } else if (!paused && !finished()) {
      drive(down, event);
    }
  };
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));

  engine.update(performance.now() / 1000);
  setStatus("");
  document.body.dataset["driveStatus"] = "running";

  const layout = await pitLayout(engine, field);
  const pit = new PitStop(layout, settings.pitExperience === "broadcast");
  scene.placePit(layout, (d, l) => engine.trackPoint(d, l));
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

  let savedBest = bestOfReference ?? Infinity;
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
  const applyPit = (frame: Float64Array, now: number) => {
    const { padInput, pressed } = pitButton(now);
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
      if (stage === "race")
        engine.setPitCompound(nextCompound(engine.tyreInfo().compound));
      engine.pitService(startFuel);
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
      startFuel,
      restart,
    });
    flow.start();
  };
  openWeekend();
  const saveBestLap = () => {
    const bestTime = trace.bestTime ?? Infinity;
    if (bestTime >= savedBest) return;
    savedBest = bestTime;
    localStorage.setItem(
      referenceKey(settings),
      JSON.stringify(trace.reference),
    );
  };
  const step = (now: number) => {
    controls.pad(pad.pressed());
    const frame = engine.update(now);
    const control = applyPit(frame, now);
    if (flow) flow.update(now);
    else armOvertake(frame);
    const tyres = engine.tyreInfo();
    const energy = engine.energyInfo();
    const speedKph = Math.abs(frame[frameIndex.speed] ?? 0) * 3.6;
    const audio = engine.carAudio(frame);
    const rumble = scene.feel(audio.wheels, audio.speed, now);
    pad.feedback(
      now,
      speedKph,
      frame[frameIndex.gear] ?? 0,
      rumble,
      energy.battery / energy.capacity,
      ersModes[energy.mode]?.label ?? "",
    );
    scene.update(frame);
    scene.updateTyres(frame, tyres);
    scene.updatePit(control, frame);
    scene.marks.update(
      frame,
      engine.wheelGrip(),
      audio.wheels.map((w) => w.surface),
    );
    sound.update(audio);
    hud.update(frame, engine.hudInfo(), tyres, energy, engine.carStatus(), now);
    hud.updatePit(control);
    saveBestLap();
  };
  const afterFlag = (now: number) => {
    const frame = engine.update(now);
    flow?.update(now);
    scene.update(frame);
  };
  if (params.has("debug"))
    Object.assign(window, { f1Debug: { engine, scene, renderer } });
  void renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000;
    if (finished()) afterFlag(now);
    else if (!paused) step(now);
    canvas.style.transform = scene.mirrored ? "scaleX(-1)" : "";
    draw();
  });
}

main().catch((error: unknown) => {
  document.body.dataset["driveStatus"] = "error";
  setStatus(error instanceof Error ? error.message : String(error));
});
