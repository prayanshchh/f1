import * as THREE from "three/webgpu";
import { carEnvironment } from "./carpaint.ts";
import { withDisplayOutput } from "./display.ts";
import { gltfToSdCar } from "./gltf.ts";
import { teamModel } from "./grid.ts";
import { teams } from "./teams.ts";

const width = 1024;
const height = 640;

const rowAlignment = 256;

export interface CarPortrait {
  left: string;
  right: string;
}

function portraitScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const sky = new THREE.HemisphereLight(0xffffff, 0x20242c, 1.8);
  sky.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(6, 3, 7);
  const fill = new THREE.DirectionalLight(0xdfe7ff, 1.3);
  fill.position.set(6, -5, 2);
  scene.add(sky, key, fill);
  return scene;
}

async function toImage(
  renderer: THREE.WebGPURenderer,
  target: THREE.RenderTarget,
): Promise<string> {
  const pixels = (await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    width,
    height,
  )) as Uint8Array;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas available");
  const stride = Math.ceil((width * 4) / rowAlignment) * rowAlignment;
  const image = context.createImageData(width, height);
  for (let row = 0; row < height; row++)
    image.data.set(
      pixels.subarray(row * stride, row * stride + width * 4),
      row * width * 4,
    );
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.92);
  });
  return blob ? URL.createObjectURL(blob) : "";
}

export async function carPortraits(
  renderer: THREE.WebGPURenderer,
): Promise<Map<string, CarPortrait>> {
  const env = carEnvironment(renderer);
  const scene = portraitScene();
  const camera = new THREE.PerspectiveCamera(20, width / height, 0.1, 100);
  camera.up.set(0, 0, 1);
  const target = new THREE.RenderTarget(width, height, { samples: 4 });
  const previous = renderer.getRenderTarget();
  const clearAlpha = renderer.getClearAlpha();
  renderer.setClearAlpha(0);
  const shoot = async (side: number) => {
    camera.position.set(7.2, side * 5.4, 2);
    camera.lookAt(0.35, side * -0.1, 0.42);
    renderer.setRenderTarget(target);
    withDisplayOutput(renderer, () => {
      renderer.render(scene, camera);
    });
    return toImage(renderer, target);
  };
  const portraits = new Map<string, CarPortrait>();
  for (const team of teams) {
    const model = await teamModel(team.id, env).catch(() => null);
    if (!model) continue;
    const axes = new THREE.Group();
    axes.matrixAutoUpdate = false;
    axes.matrix.copy(gltfToSdCar);
    axes.add(model);
    scene.add(axes);
    portraits.set(team.id, { right: await shoot(1), left: await shoot(-1) });
    scene.remove(axes);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      (object.geometry as THREE.BufferGeometry).dispose();
      const material = object.material as THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
    });
  }
  renderer.setRenderTarget(previous);
  renderer.setClearAlpha(clearAlpha);
  target.dispose();
  env.texture.dispose();
  return portraits;
}
