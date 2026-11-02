import * as THREE from "three/webgpu";
import { attribute, float, uniform, vec4 } from "three/tsl";

export function unlitMaterial(color: THREE.Color): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.fragmentNode = vec4(uniform(color), float(1));
  return material;
}

export function domeMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  material.fragmentNode = vec4(attribute("color", "vec3"), 1);
  return material;
}
