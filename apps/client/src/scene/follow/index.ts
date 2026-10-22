import type { Object3D, PerspectiveCamera, Scene } from "three/webgpu";
import type { TrackData, Vec3 } from "../../contracts/index.ts";
import { createPoseBuffer, type PoseSample } from "./poses.ts";
import { createRoad } from "./road.ts";
import { placeChase } from "./chase.ts";

export interface FollowRequest {
  type: "pose";
  pose: PoseSample;
}
export interface FollowReport {
  type: "rendered";
  tick: number;
  position: Vec3;
}

export function createFollow() {
  let track: TrackData | undefined;
  let port: MessagePort | undefined;
  let car: Object3D | undefined;
  const poses = createPoseBuffer(12);
  return {
    connect(value: TrackData, channel: MessagePort): void {
      if (port !== undefined)
        throw new Error("The drive view is already connected");
      track = value;
      port = channel;
      channel.onmessage = ({ data }: MessageEvent<FollowRequest>) => {
        poses.push(data.pose, performance.now());
      };
    },
    update(scene: Scene, camera: PerspectiveCamera): void {
      if (port === undefined || track === undefined) return;
      if (car === undefined) {
        car = scene.getObjectByName("car");
        if (car === undefined) throw new Error("The scene has no car to drive");
        scene.add(createRoad(track));
      }
      const pose = poses.at(performance.now());
      if (pose === null) return;
      car.position.set(pose.position.x, pose.position.y, pose.position.z);
      car.quaternion.set(
        pose.orientation.x,
        pose.orientation.y,
        pose.orientation.z,
        pose.orientation.w,
      );
      placeChase(camera, pose);
      port.postMessage({
        type: "rendered",
        tick: pose.tick,
        position: pose.position,
      } satisfies FollowReport);
    },
  };
}
