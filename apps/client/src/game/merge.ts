import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function placedCopy(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  keep: readonly string[],
): THREE.BufferGeometry {
  const copy = new THREE.BufferGeometry();
  for (const name of keep) {
    const attribute = source.getAttribute(name) as
      THREE.BufferAttribute | undefined;
    if (attribute) copy.setAttribute(name, attribute.clone());
  }
  if (source.index) copy.setIndex(source.index.clone());
  return copy.applyMatrix4(matrix);
}

export function mergedMesh(
  parts: THREE.BufferGeometry[],
  material: THREE.Material,
): THREE.Mesh {
  const geometry = mergeGeometries(parts);
  if (!(geometry as THREE.BufferGeometry | null))
    throw new Error("parts cannot be merged");
  for (const part of parts) part.dispose();
  return new THREE.Mesh(geometry, material);
}
