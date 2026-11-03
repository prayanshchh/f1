import * as THREE from "three/webgpu";
import type { CameraPose } from "./buildup-shots.ts";
import { carField, carStride, frameIndex } from "./frame-layout.ts";

const stationSpacing = 170;
const stationReach = 21;
const stationHeight = 4.5;
const stationLead = 35;
const stationHold = 95;
const tvFrame = 9;
const tvFovMin = 3.5;
const tvFovMax = 42;
const chaseBack = 7;
const chaseUp = 2.1;
const chaseAhead = 5;
const tcamBack = -0.224;
const tcamUp = 1.022;
const tcamPitch = (-11.27 * Math.PI) / 180;
const tcamFov = 48.6;
const heliBack = 35;
const heliSide = 30;
const heliUp = 48;
const heliFov = 26;
const sideOffset = 6.5;

const replayCameras = [
  { id: "tv", label: "TV Camera" },
  { id: "chase", label: "Chase" },
  { id: "tcam", label: "T-Cam" },
  { id: "side", label: "Trackside Follow" },
  { id: "heli", label: "Helicopter" },
] as const;

export type CameraId = (typeof replayCameras)[number]["id"];

export interface Station {
  distance: number;
  eye: [number, number, number];
}

export function trackStations(
  length: number,
  point: (distance: number, lateral: number) => [number, number, number],
): Station[] {
  const stations: Station[] = [];
  for (let d = 0; d < length; d += stationSpacing) {
    const [ax, ay] = point(d - 25, 0);
    const [bx, by] = point(d, 0);
    const [cx, cy] = point(d + 25, 0);
    const turn = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    const outside = turn > 0 ? -1 : 1;
    const [x, y, z] = point(d, outside * stationReach);
    stations.push({ distance: d, eye: [x, y, z + stationHeight] });
  }
  return stations;
}

function ahead(from: number, to: number, length: number): number {
  const d = (((to - from) % length) + length) % length;
  return d > length / 2 ? d - length : d;
}

export class ReplayCamera {
  private camera = 0;
  target = 0;
  private station = -1;
  private frame: Float64Array = new Float64Array(frameIndex.size);
  private cars: Float64Array = new Float64Array(0);
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(
    private readonly stations: Station[],
    private readonly trackLength: number,
  ) {}

  get label(): string {
    return replayCameras[this.camera]?.label ?? "";
  }

  cut(): void {
    this.station = -1;
  }

  next(): void {
    this.camera = (this.camera + 1) % replayCameras.length;
    this.cut();
  }

  use(id: CameraId): void {
    this.camera = Math.max(
      0,
      replayCameras.findIndex((c) => c.id === id),
    );
    this.cut();
  }

  follow(target: number): void {
    this.target = target;
    this.cut();
  }

  pose(frame: Float64Array, cars: Float64Array): CameraPose {
    this.frame = frame;
    this.cars = cars;
    return this.aim();
  }

  private targetMatrix(): void {
    const base = this.target * carStride;
    if (this.target === 0) this.matrix.fromArray(this.frame, frameIndex.posMat);
    else this.matrix.fromArray(this.cars, base);
    this.position.setFromMatrixPosition(this.matrix);
    this.matrix.extractBasis(this.forward, this.left, this.up);
  }

  private targetDistance(): number {
    return this.target === 0
      ? (this.frame[frameIndex.distFromStart] ?? 0)
      : (this.cars[this.target * carStride + carField.distance] ?? 0);
  }

  private aim(): CameraPose {
    this.targetMatrix();
    const id: CameraId = replayCameras[this.camera]?.id ?? "tv";
    const p = this.position;
    const at = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];
    const offset = (back: number, side: number, rise: number) =>
      p
        .clone()
        .addScaledVector(this.forward, -back)
        .addScaledVector(this.left, side)
        .addScaledVector(this.up, rise);
    if (id === "chase")
      return {
        eye: at(offset(chaseBack, 0, chaseUp)),
        target: at(offset(-chaseAhead, 0, 0.7)),
        fov: 55,
      };
    if (id === "tcam") {
      const eye = offset(-tcamBack, 0, tcamUp);
      const look = eye
        .clone()
        .addScaledVector(this.forward, 10 * Math.cos(tcamPitch))
        .addScaledVector(this.up, 10 * Math.sin(tcamPitch));
      return { eye: at(eye), target: at(look), fov: tcamFov };
    }
    if (id === "side")
      return {
        eye: at(offset(1.5, sideOffset, 0.9)),
        target: at(offset(-1, 0, 0.5)),
        fov: 50,
      };
    if (id === "heli")
      return {
        eye: at(offset(heliBack, heliSide, heliUp)),
        target: at(offset(0, 0, 0)),
        fov: heliFov,
      };
    return this.tvPose();
  }

  private tvPose(): CameraPose {
    const distance = this.targetDistance();
    const current = this.stations[this.station];
    const passed = current
      ? ahead(current.distance, distance, this.trackLength)
      : Infinity;
    if (!current || passed > stationHold || passed < -stationHold * 2) {
      let best = 0;
      let bestGap = Infinity;
      this.stations.forEach((station, i) => {
        const gap = Math.abs(
          ahead(distance + stationLead, station.distance, this.trackLength),
        );
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      });
      this.station = best;
    }
    const eye = this.stations[this.station]?.eye ?? [0, 0, 0];
    const target: [number, number, number] = [
      this.position.x,
      this.position.y,
      this.position.z + 0.5,
    ];
    const range = Math.hypot(
      target[0] - eye[0],
      target[1] - eye[1],
      target[2] - eye[2],
    );
    const fov = THREE.MathUtils.clamp(
      THREE.MathUtils.radToDeg(2 * Math.atan(tvFrame / Math.max(1, range))),
      tvFovMin,
      tvFovMax,
    );
    return { eye, target, fov };
  }
}
