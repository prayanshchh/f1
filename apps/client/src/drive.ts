import {
  PitStop,
  steerCommand,
  type PitDrive,
  type PitLayout,
} from "./game/pitstop.ts";
import frameUrl from "../../../content/tracks/cota/sd-frame.json?url";
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
import { Hud, lapTime, signed, type TrackMap } from "./game/hud.ts";
import { sdlKeycode } from "./game/keys.ts";
import { compoundIndex, compounds, wearScale } from "./game/tyres.ts";
import { LapTrace } from "./game/laptrace.ts";
import { Menu } from "./game/menu.ts";
import { type PadCommands, PadLink } from "./game/pad.ts";
import { Atmosphere } from "./game/atmosphere.ts";
import { RaceLog } from "./game/race-log.ts";
import { loadReference, rememberReference } from "./game/reference.ts";
import { fetchJson, Scene } from "./game/scene.ts";
import { GameSound } from "./game/sound/game-sound.ts";
import { StartLights } from "./game/start-lights.ts";
import { Studio } from "./game/studio.ts";
import { type PlayerSeat, startingGrid } from "./game/teams.ts";
import {
  applySettings,
  carOf,
  loadSettings,
  type Settings,
  trackOf,
} from "./game/settings.ts";

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
  element("[data-results=restart]").addEventListener("click", () => {
    restart(true);
  });
  element("[data-results=menu]").addEventListener("click", () => {
    restart(false);
  });
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
    scene.renderAuxiliary(renderer);
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

function raceSystems(settings: Settings, lights: StartLights): RaceSystems {
  return {
    countdown: lights.countdown,
    compound: compoundIndex(settings.compound),
    wearScale: wearScale(settings.tyreWear, settings.session, settings.laps),
    isRace: settings.session === "race",
    ersMode: settings.ersMode,
    fuelMix: settings.fuelMix,
    ersAssist: settings.ersAssist,
    straightAssist: settings.straightAssist,
  };
}

async function createRenderer(
  target: HTMLCanvasElement,
): Promise<THREE.WebGPURenderer> {
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

function consumeAutostart(params: URLSearchParams): boolean {
  const restarted = sessionStorage.getItem(autostartKey) === "1";
  sessionStorage.removeItem(autostartKey);
  return restarted || params.has("autostart");
}

function chooseLights(
  settings: Settings,
  params: URLSearchParams,
): StartLights {
  return settings.session === "race" && !params.has("autostart")
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
}

async function runBuildUp(context: BuildUpContext): Promise<void> {
  const { renderer, scene, draw, engine, settings, seat, seek } = context;
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
      kind: settings.session,
      grid: startingGrid(seat, scene.playerSlot),
      playerDistance: opening[frameIndex.distFromStart] ?? 0,
      playerLateral: opening[frameIndex.toMiddle] ?? 0,
      playerSlot: scene.playerSlot,
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

function raceLog(driver: Driver | null, settings: Settings): RaceLog | null {
  if (!driver) return null;
  return new RaceLog(driverOutbox(driver.id), {
    id: crypto.randomUUID(),
    track: settings.track,
    car: carOf(settings).car,
    team: settings.car,
    kind: settings.session,
    plannedLaps: settings.session === "race" ? settings.laps : null,
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
  const driver = autostart
    ? await currentDriver()
    : await enterGame(renderer, settings, menu);
  const log = raceLog(driver, settings);
  const lights = chooseLights(settings, params);

  const track = trackOf(settings);
  const car = carOf(settings);
  applySettings(source, settings);
  setStatus(`Loading ${track.label}…`);
  const engine = Engine.start(
    module,
    track.category,
    track.id,
    car.car,
    settings.assist,
    settings.antiLock,
    performance.now() / 1000,
    raceSystems(settings, lights),
  );
  const scene = await Scene.load(
    engine,
    car.id,
    renderer,
    settings.racingLine,
    lights,
  );
  const draw = drawer(renderer, scene);

  const reference = await loadReference(driver, settings.track, car.car);
  const trace = new LapTrace(
    engine.trackLength(),
    engine.sectorBoundaries(),
    reference,
  );
  const totalLaps = settings.session === "race" ? settings.laps : null;
  const sessionLabel = settings.session === "race" ? "Race" : "Practice";
  const hud = new Hud(hudRoot, trace, {
    totalLaps,
    parts: settings.hud,
    session: sessionLabel,
    reference: trace.bestTime,
    map: trackMap(engine),
    start: lights,
    onLap: (lap) => {
      log?.lap(lap, compoundId(engine.tyreInfo().compound));
    },
  });
  const pad = padLink();
  const sound = await GameSound.start();

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
  let buildingUp = false;
  let paused = false;
  let finished = false;
  const pause = () => {
    if (paused || finished) return;
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
    if (buildingUp) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (down && !event.repeat) pause();
    } else if (!paused && !finished) {
      drive(down, event);
    }
  };
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));

  engine.update(performance.now() / 1000);
  setStatus("");
  document.body.dataset["driveStatus"] = "running";

  const { pit: layout } = await fetchJson<{ pit: PitLayout }>(frameUrl);
  const pit = new PitStop(layout, settings.pitExperience === "broadcast");
  scene.placePit(layout, (d, l) => engine.trackPoint(d, l));
  const startFuel = engine.hudInfo().fuel;
  let padBrakeWas = false;
  const steerToward = (frame: Float64Array, drive: PitDrive) => {
    const ahead = (frame[frameIndex.distFromStart] ?? 0) + drive.lookahead;
    const posMat = frameIndex.posMat;
    return steerCommand(
      {
        x: frame[posMat + 12] ?? 0,
        y: frame[posMat + 13] ?? 0,
        heading: Math.atan2(frame[posMat + 1] ?? 0, frame[posMat] ?? 1),
        speed: Math.abs(frame[frameIndex.speed] ?? 0),
      },
      engine.trackPoint(ahead, drive.lateral - pit.shiftAt(ahead)),
      drive.speed,
    );
  };

  const watchBest = bestLapWatcher(trace, (best) => {
    rememberReference(driver, settings.track, car.car, best);
    log?.personalBest(best);
  });
  const finishRace = () => {
    finished = true;
    log?.finish();
    sound.mute(true);
    window.setTimeout(() => {
      showResults(hud, `${track.label} - ${sessionLabel}`);
    }, 1500);
  };
  const detector = new OvertakeDetector(engine.trackLength());
  const armOvertake = (frame: Float64Array) => {
    const distance = frame[frameIndex.distFromStart] ?? 0;
    const gap = trace.delta(distance, frame[frameIndex.curLapTime] ?? 0);
    if (detector.crossing(distance, gap)) engine.armOvertake();
  };
  const applyPit = (frame: Float64Array, now: number) => {
    const padInput = pad.current(now);
    const brakeDown = (padInput?.brake ?? 0) > 0.5;
    const pressed = pitPressed || (brakeDown && !padBrakeWas);
    padBrakeWas = brakeDown;
    pitPressed = false;
    const distance = frame[frameIndex.distFromStart] ?? 0;
    const control = pit.update(
      {
        distance,
        toMiddle: frame[frameIndex.toMiddle] ?? 0,
        speed: Math.abs(frame[frameIndex.speed] ?? 0),
      },
      now,
      pressed,
    );
    engine.speedLimit(control.limit);
    engine.pitHold(control.hold);
    engine.analog(
      control.drive ? steerToward(frame, control.drive) : padInput,
      control.drive !== null,
    );
    if (control.serviceNow) engine.pitService(startFuel);
    return control;
  };
  const step = (now: number) => {
    controls.pad(pad.pressed());
    const frame = engine.update(now);
    const control = applyPit(frame, now);
    armOvertake(frame);
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
    hud.update(frame, info, tyres, energy, engine.carStatus(), now);
    hud.updatePit(control);
    watchBest();
    if (totalLaps !== null && (frame[frameIndex.laps] ?? 0) > totalLaps)
      finishRace();
  };
  const seek = params.get("buildup");
  if (!autostart && settings.buildUp && seek !== "off") {
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
    });
    buildingUp = false;
    sound.mute(false);
    engine.update(performance.now() / 1000);
  }
  hudRoot.hidden = false;
  void renderer.setAnimationLoop(() => {
    if (!paused && !finished) step(performance.now() / 1000);
    canvas.style.transform = scene.mirrored ? "scaleX(-1)" : "";
    draw();
  });
}

main().catch((error: unknown) => {
  document.body.dataset["driveStatus"] = "error";
  setStatus(error instanceof Error ? error.message : String(error));
});
