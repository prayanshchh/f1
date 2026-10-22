import type { PerspectiveCamera, Scene, WebGPURenderer } from "three/webgpu";
import { createRenderer } from "./renderer.ts";
import { loadScene, placeCamera } from "./world.ts";
import { createFollow } from "./follow/index.ts";
import type {
  Camera,
  SceneRequest,
  SceneResponse,
  SceneTimings,
} from "./protocol.ts";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<SceneRequest>) => void;
  postMessage: (message: SceneResponse) => void;
};

let renderer: WebGPURenderer | undefined;
let scene: Scene;
let camera: PerspectiveCamera | undefined;
let view: Camera = "chase";
let width = 1;
let height = 1;
let stopped = false;
let timestamps = false;
let resolving = false;
let lastTime = 0;
let windowStart = 0;
let windowFrames = 0;
let timings: SceneTimings;
const follow = createFollow();

function fail(error: unknown): void {
  if (stopped) {
    return;
  }
  stopped = true;
  scope.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

function resize(): void {
  renderer?.setSize(width, height, false);
  if (camera !== undefined) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function graphicsError(info: unknown): void {
  const message =
    typeof info === "object" && info !== null && "message" in info
      ? info.message
      : info;
  fail(new Error(String(message)));
}

async function resolveGpuTime(): Promise<void> {
  if (resolving || renderer === undefined) {
    return;
  }
  resolving = true;
  try {
    const duration = await renderer.resolveTimestampsAsync();
    if (duration !== undefined && duration > 0) {
      timings.gpuMs = duration;
    }
  } finally {
    resolving = false;
  }
}

function frame(time: number): void {
  if (stopped || renderer === undefined || camera === undefined) {
    return;
  }
  try {
    follow.update(scene, camera);
    renderer.render(scene, camera);
    timings.frames += 1;
    if (lastTime > 0) {
      timings.frameMs = time - lastTime;
      windowFrames += 1;
    } else {
      windowStart = time;
    }
    lastTime = time;
    const elapsed = time - windowStart;
    if (elapsed >= 500) {
      timings.fps = (windowFrames * 1000) / elapsed;
      windowFrames = 0;
      windowStart = time;
    }
    timings.resolution = `${String(width)}x${String(height)}`;
    if (timestamps) {
      resolveGpuTime().catch(fail);
    }
    scope.postMessage({ type: "frame", timings, camera: view });
  } catch (error) {
    fail(error);
  }
}

async function start(
  request: Extract<SceneRequest, { type: "start" }>,
): Promise<void> {
  const created = await createRenderer(request.canvas, request.options);
  renderer = created.renderer;
  timestamps = created.timestamps;
  renderer.onDeviceLost = (info) => {
    fail(new Error(`The graphics device was lost: ${info.message}`));
  };
  renderer.onError = graphicsError;
  const loaded = await loadScene(created.tier);
  scene = loaded.scene;
  camera = loaded.camera;
  placeCamera(camera, view);
  resize();
  timings = {
    fps: 0,
    frames: 0,
    frameMs: 0,
    gpuMs: "unavailable",
    backend: created.backend,
    tier: created.tier,
    resolution: "",
    meshes: loaded.meshes,
  };
  await renderer.compileAsync(scene, camera);
  await renderer.setAnimationLoop(frame);
}

scope.onmessage = ({ data }) => {
  if (data.type === "drive") {
    follow.connect(data.track, data.port);
  } else if (data.type === "camera") {
    view = data.camera;
    if (camera !== undefined) {
      placeCamera(camera, view);
    }
  } else {
    width = data.width;
    height = data.height;
    if (data.type === "start") {
      start(data).catch(fail);
    } else {
      resize();
    }
  }
};
