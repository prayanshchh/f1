import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";

export function unlitMaterial(color: THREE.Color): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.colorNode = uniform(color);
  return material;
}
