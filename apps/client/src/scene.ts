import "./scene.css";
import {
  cameras,
  sceneOptions,
  type SceneRequest,
  type SceneResponse,
  type SceneTimings,
} from "./scene/protocol.ts";

function fail(error: unknown): void {
  document.body.dataset["renderStatus"] = "error";
  const alert =
    document.querySelector('[role="alert"]') ?? document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.textContent = error instanceof Error ? error.message : String(error);
  document.body.append(alert);
}

function showTimings(timings: SceneTimings): void {
  const overlay = document.querySelector<HTMLOutputElement>(
    '[data-testid="gpu-timings"]',
  );
  if (overlay === null) {
    throw new Error("The scene timing display is missing.");
  }
  for (const [key, value] of Object.entries(timings)) {
    overlay.dataset[key] = String(value);
  }
  const gpu =
    typeof timings.gpuMs === "number"
      ? `${timings.gpuMs.toFixed(2)} ms`
      : timings.gpuMs;
  overlay.textContent = `${timings.fps.toFixed(1)} FPS · ${timings.frameMs.toFixed(2)} ms/frame · GPU ${gpu}\n${timings.backend.toUpperCase()} / ${timings.tier} · ${timings.resolution} · ${String(timings.meshes)} meshes`;
}

function startScene(): void {
  const options = sceneOptions(location.search);
  const canvas = document.querySelector<HTMLCanvasElement>(
    '[data-testid="scene-canvas"]',
  );
  if (canvas === null) {
    throw new Error("The scene canvas is missing.");
  }
  const worker = new Worker(
    new URL("./scene/render.worker.ts", import.meta.url),
    { type: "module" },
  );
  const send = (message: SceneRequest, transfer: Transferable[] = []) => {
    worker.postMessage(message, transfer);
  };
  const size = () => {
    const rect = canvas.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width * devicePixelRatio)),
      height: Math.max(1, Math.round(rect.height * devicePixelRatio)),
    };
  };
  const observer = new ResizeObserver(() => {
    send({ type: "resize", ...size() });
  });
  const stop = () => {
    observer.disconnect();
    worker.terminate();
  };
  worker.onmessage = ({ data }: MessageEvent<SceneResponse>) => {
    if (data.type === "error") {
      stop();
      fail(new Error(data.message));
      return;
    }
    showTimings(data.timings);
    document.body.dataset["camera"] = data.camera;
    document.body.dataset["renderStatus"] = "ready";
  };
  worker.onerror = (event) => {
    event.preventDefault();
    stop();
    fail(new Error(event.message));
  };
  const offscreen = canvas.transferControlToOffscreen();
  send({ type: "start", canvas: offscreen, options, ...size() }, [offscreen]);
  observer.observe(canvas, { box: "device-pixel-content-box" });
  let cameraIndex = 0;
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "c" && !event.repeat) {
      cameraIndex = (cameraIndex + 1) % cameras.length;
      send({ type: "camera", camera: cameras[cameraIndex] ?? "chase" });
    }
  });
  window.addEventListener("resize", () => {
    send({ type: "resize", ...size() });
  });
  window.addEventListener("pagehide", stop, { once: true });
}

try {
  startScene();
} catch (error) {
  fail(error);
}
