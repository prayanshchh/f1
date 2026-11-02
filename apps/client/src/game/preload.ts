import type * as THREE from "three/webgpu";
import { DefaultLoadingManager } from "three/webgpu";

const settleFrames = 3;
let loading = 0;
let waiting: (() => void)[] = [];
const itemStart = DefaultLoadingManager.itemStart.bind(DefaultLoadingManager);
const itemEnd = DefaultLoadingManager.itemEnd.bind(DefaultLoadingManager);
DefaultLoadingManager.itemStart = (url: string) => {
  loading += 1;
  itemStart(url);
};
DefaultLoadingManager.itemEnd = (url: string) => {
  loading -= 1;
  itemEnd(url);
  if (loading > 0) return;
  for (const resolve of waiting) resolve();
  waiting = [];
};

function loaded(): Promise<void> {
  if (loading <= 0) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}

interface GpuBackend {
  device: GPUDevice;
}

export async function uploadEverything(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  draw: () => void,
): Promise<void> {
  await loaded();
  const hidden: THREE.Object3D[] = [];
  const culled: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (!object.visible) {
      hidden.push(object);
      object.visible = true;
    }
    if (object.frustumCulled) {
      culled.push(object);
      object.frustumCulled = false;
    }
  });
  draw();
  for (const object of hidden) object.visible = false;
  for (const object of culled) object.frustumCulled = true;
  for (let frame = 0; frame < settleFrames; frame += 1) draw();
  await (
    renderer.backend as unknown as GpuBackend
  ).device.queue.onSubmittedWorkDone();
}
