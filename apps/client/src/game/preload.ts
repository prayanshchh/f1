import * as THREE from "three/webgpu";
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

export function loaded(): Promise<void> {
  if (loading <= 0) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}

interface GpuBackend {
  device: GPUDevice;
}

interface UploadRecord {
  initialized?: boolean;
  version?: number;
  isDefaultTexture?: boolean;
}

interface UploadedTextures {
  has(texture: THREE.Texture): boolean;
  get(texture: THREE.Texture): UploadRecord;
}

const releasable = new Set<THREE.Texture>();

export function releaseOnceUploaded<T extends THREE.Texture>(texture: T): T {
  releasable.add(texture);
  return texture;
}

function fileImage(data: unknown): data is ImageBitmap | HTMLImageElement {
  return data instanceof ImageBitmap || data instanceof HTMLImageElement;
}

function pixelData(data: unknown): data is { width: number; height: number } {
  return (
    typeof data === "object" &&
    data !== null &&
    ArrayBuffer.isView((data as { data?: unknown }).data)
  );
}

function slotTextures(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials: THREE.Material[] = [object.material as THREE.Material]
      .flat()
      .filter(Boolean);
    for (const material of materials)
      for (const value of Object.values(material) as unknown[])
        if (value instanceof THREE.Texture && fileImage(value.source.data))
          releasable.add(value as THREE.Texture);
  });
}

export function releaseUploadedImages(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
): void {
  slotTextures(scene);
  const uploaded = (renderer as unknown as { _textures: UploadedTextures })
    ._textures;
  for (const texture of releasable) {
    if (!uploaded.has(texture)) continue;
    const record = uploaded.get(texture);
    if (record.initialized !== true || record.isDefaultTexture === true)
      continue;
    if (record.version !== texture.version) continue;
    const data: unknown = texture.source.data;
    if (!fileImage(data) && !pixelData(data)) continue;
    texture.source.data = { width: data.width, height: data.height };
    if (data instanceof ImageBitmap) data.close();
  }
  releasable.clear();
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
