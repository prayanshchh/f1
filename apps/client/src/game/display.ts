import * as THREE from "three/webgpu";
import { output, renderOutput, texture } from "three/tsl";

const displaySamples = 4;
const bufferSize = new THREE.Vector2();
let screen: { target: THREE.RenderTarget; quad: THREE.QuadMesh } | null = null;

function finish(material: THREE.Material): void {
  (material as THREE.NodeMaterial).outputNode = renderOutput(
    output,
    THREE.ACESFilmicToneMapping,
    THREE.SRGBColorSpace,
  );
}

export function finishAll(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) finish(object.material as THREE.Material);
  });
}

function withDisplayOutput(
  renderer: THREE.WebGPURenderer,
  draw: () => void,
): void {
  const { toneMapping, outputColorSpace, toneMappingExposure } = renderer;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMappingExposure = 1;
  draw();
  renderer.toneMapping = toneMapping;
  renderer.outputColorSpace = outputColorSpace;
  renderer.toneMappingExposure = toneMappingExposure;
}

function screenTarget(renderer: THREE.WebGPURenderer) {
  renderer.getDrawingBufferSize(bufferSize);
  if (!screen) {
    const target = new THREE.RenderTarget(bufferSize.x, bufferSize.y, {
      samples: displaySamples,
    });
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = texture(target.texture);
    screen = { target, quad: new THREE.QuadMesh(material) };
  }
  screen.target.setSize(bufferSize.x, bufferSize.y);
  return screen;
}

export function renderDisplay(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  const { target, quad } = screenTarget(renderer);
  const previous = renderer.getRenderTarget();
  withDisplayOutput(renderer, () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    quad.render(renderer);
  });
}
