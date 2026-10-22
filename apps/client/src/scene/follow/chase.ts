import { Quaternion, Vector3, type PerspectiveCamera } from "three/webgpu";
import type { PoseSample } from "./poses.ts";

const behind = 6.5;
const height = 2;
const ahead = 6;
const lookHeight = 0.6;

export function placeChase(camera: PerspectiveCamera, pose: PoseSample): void {
  const q = pose.orientation;
  const forward = new Vector3(0, 0, 1).applyQuaternion(
    new Quaternion(q.x, q.y, q.z, q.w),
  );
  forward.y = 0;
  if (forward.length() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  const position = new Vector3(
    pose.position.x,
    pose.position.y,
    pose.position.z,
  );
  camera.position
    .copy(position)
    .addScaledVector(forward, -behind)
    .add(new Vector3(0, height, 0));
  camera.lookAt(
    position.addScaledVector(forward, ahead).add(new Vector3(0, lookHeight, 0)),
  );
  camera.updateMatrixWorld();
}
