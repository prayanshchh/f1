import "./scene.css";
import { cameras, sceneOptions, type SceneTimings } from "./scene/protocol.ts";
import { hostScene, showFailure } from "./scene/host.ts";

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
  const host = hostScene(canvas, options, (data) => {
    showTimings(data.timings);
    document.body.dataset["camera"] = data.camera;
    document.body.dataset["renderStatus"] = "ready";
  });
  let cameraIndex = 0;
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "c" && !event.repeat) {
      cameraIndex = (cameraIndex + 1) % cameras.length;
      host.send({ type: "camera", camera: cameras[cameraIndex] ?? "chase" });
    }
  });
}

try {
  startScene();
} catch (error) {
  showFailure(error);
}
