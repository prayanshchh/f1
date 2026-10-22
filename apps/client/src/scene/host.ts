import type { SceneOptions, SceneRequest, SceneResponse } from "./protocol.ts";
export type SceneFrame = Extract<SceneResponse, { type: "frame" }>;
export interface SceneHost {
  send: (message: SceneRequest, transfer?: Transferable[]) => void;
  stop: () => void;
}
export function showFailure(error: unknown): void {
  document.body.dataset["renderStatus"] = "error";
  const alert =
    document.querySelector('[role="alert"]') ?? document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.textContent = error instanceof Error ? error.message : String(error);
  document.body.append(alert);
}

export function hostScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
  onFrame: (frame: SceneFrame) => void,
): SceneHost {
  const worker = new Worker(new URL("./render.worker.ts", import.meta.url), {
    type: "module",
  });
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
      showFailure(new Error(data.message));
      return;
    }
    onFrame(data);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    stop();
    showFailure(new Error(event.message));
  };
  const offscreen = canvas.transferControlToOffscreen();
  send({ type: "start", canvas: offscreen, options, ...size() }, [offscreen]);
  observer.observe(canvas, { box: "device-pixel-content-box" });
  window.addEventListener("resize", () => {
    send({ type: "resize", ...size() });
  });
  window.addEventListener("pagehide", stop, { once: true });
  return { send, stop };
}
