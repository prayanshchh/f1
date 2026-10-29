import "./drive.css";
import * as THREE from "three/webgpu";
import {
  Engine,
  frameIndex,
  loadSpeedDreams,
  setupSource,
} from "./game/engine.ts";
import { Hud, lapTime } from "./game/hud.ts";
import { sdlKeycode } from "./game/keys.ts";
import { LapTrace } from "./game/laptrace.ts";
import { Menu } from "./game/menu.ts";
import { SdAssets } from "./game/models.ts";
import { PadLink } from "./game/pad.ts";
import { Scene } from "./game/scene.ts";
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

function showResults(hud: Hud): void {
  const best = hud.laps.reduce<number | null>(
    (b, lap) => (b === null || lap.time < b ? lap.time : b),
    null,
  );
  const total = hud.laps.reduce((sum, lap) => sum + lap.time, 0);
  element("[data-results=summary]").textContent =
    `Total ${lapTime(total)} · Best ${lapTime(best)}`;
  element("[data-results=laps]").replaceChildren(
    ...hud.laps.map((lap) => {
      const item = document.createElement("li");
      item.classList.toggle("best", lap.time === best);
      item.innerHTML = `<span>Lap ${String(lap.lap)}</span><b>${lapTime(lap.time)}</b><small>${lap.sectors.map((t) => t.toFixed(3)).join(" · ")}</small>`;
      return item;
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

async function main(): Promise<void> {
  if (!canvas || !hudRoot) throw new Error("drive page markup is missing");
  if (!("gpu" in navigator))
    throw new Error("This page needs WebGPU (Chrome 113 or newer).");

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  await renderer.init();

  const params = new URLSearchParams(location.search);
  setStatus("Loading Speed Dreams…");
  const module = await loadSpeedDreams();
  const settings = loadSettings(params);
  const source = setupSource(module);
  const menu = new Menu(source, settings);

  const autostart =
    sessionStorage.getItem(autostartKey) === "1" || params.has("autostart");
  sessionStorage.removeItem(autostartKey);
  if (!autostart) {
    setStatus("");
    await menu.run(false);
  }

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
    performance.now() / 1000,
  );
  const assets = await SdAssets.open("/wasm/sd/");
  const scene = await Scene.load(
    engine,
    assets,
    track.category,
    track.id,
    car.body,
  );

  const reference = loadReference(settings);
  const trace = new LapTrace(
    engine.trackLength(),
    engine.sectorBoundaries(),
    reference,
  );
  const totalLaps = settings.session === "race" ? settings.laps : null;
  const hud = new Hud(hudRoot, trace, {
    totalLaps,
    parts: settings.hud,
    reference: reference
      ? `vs best ${lapTime(reference.sectors.reduce((a, b) => a + b, 0))}`
      : "vs session best",
  });
  const pad = padLink();
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

  let paused = false;
  let finished = false;
  const pause = () => {
    if (paused || finished) return;
    paused = true;
    void menu.run(true).then((action) => {
      if (action === "resume") {
        hud.setParts(settings.hud);
        paused = false;
        return;
      }
      restart(true);
    });
  };

  const drive = (down: boolean, event: KeyboardEvent) => {
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
    } else if (!paused && !finished) {
      drive(down, event);
    }
  };
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));

  engine.update(performance.now() / 1000);
  setStatus("");
  document.body.dataset["driveStatus"] = "running";

  let savedBest = reference
    ? reference.sectors.reduce((a, b) => a + b, 0)
    : Infinity;
  const step = (now: number) => {
    engine.analog(pad.current(now));
    const frame = engine.update(now);
    pad.feedback(
      now,
      Math.abs(frame[frameIndex.speed] ?? 0) * 3.6,
      frame[frameIndex.gear] ?? 0,
    );
    scene.update(frame);
    hud.update(frame, engine.hudInfo(), now);
    const bestTime = trace.bestTime ?? Infinity;
    if (bestTime < savedBest) {
      savedBest = bestTime;
      localStorage.setItem(
        referenceKey(settings),
        JSON.stringify(trace.reference),
      );
    }
    if (totalLaps !== null && (frame[frameIndex.laps] ?? 0) > totalLaps) {
      finished = true;
      window.setTimeout(() => {
        showResults(hud);
      }, 1500);
    }
  };
  void renderer.setAnimationLoop(() => {
    if (!paused && !finished) step(performance.now() / 1000);
    canvas.style.transform = scene.mirrored ? "scaleX(-1)" : "";
    renderer.render(scene.scene, scene.camera);
  });
}

main().catch((error: unknown) => {
  document.body.dataset["driveStatus"] = "error";
  setStatus(error instanceof Error ? error.message : String(error));
});
