import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { frameIndex } from "./engine.ts";
import type { SdLighting } from "./materials.ts";

const gltfToSdWorld = new THREE.Matrix4().set(
  1,
  0,
  0,
  0,
  0,
  0,
  -1,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);
const gltfToSdCar = new THREE.Matrix4().set(
  0,
  0,
  1,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);
const wheelNames = ["wheel-fr", "wheel-fl", "wheel-rr", "wheel-rl"] as const;
const steeringWheelRotation = 2.0;

export interface TrackFrame {
  origin: number[];
  heading: number;
}

function useSdLighting(
  root: THREE.Object3D,
  lighting: SdLighting,
  override?: (name: string) => THREE.Color | undefined,
): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.material as THREE.MeshStandardMaterial;
    const map = source.map;
    if (map) map.colorSpace = THREE.NoColorSpace;
    object.material = lighting.shadowMapped({
      map,
      color:
        override?.(source.name) ?? source.color.clone().convertLinearToSRGB(),
      translucent: source.transparent,
      alphaClamp: source.alphaTest > 0,
      twoSided: source.side === THREE.DoubleSide,
    });
  });
}

export function placeOnTrack(
  object: THREE.Object3D,
  frame: TrackFrame,
  sdStart: [number, number, number],
): THREE.Object3D {
  const [ox = 0, oy = 0, oz = 0] = frame.origin;
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.matrix
    .makeTranslation(sdStart[0], sdStart[1], sdStart[2])
    .multiply(new THREE.Matrix4().makeRotationZ(-frame.heading))
    .multiply(new THREE.Matrix4().makeTranslation(-ox, oz, -oy))
    .multiply(gltfToSdWorld);
  root.add(object);
  return root;
}

interface Wheel {
  pivot: THREE.Object3D;
  spin: THREE.Object3D;
  rest: THREE.Vector3;
  restZ: number | null;
}

export class GltfCar {
  readonly root = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly wheels: Wheel[] = [];
  private steeringWheel: THREE.Object3D | null = null;
  private visualAxleMid = 0;
  private offsetReady = false;

  static async load(
    url: string,
    lighting: SdLighting,
    livery: THREE.Color,
  ): Promise<GltfCar> {
    const car = new GltfCar();
    const gltf = await new GLTFLoader().loadAsync(url);
    useSdLighting(gltf.scene, lighting, (name) =>
      name === "livery" ? livery : undefined,
    );
    const axes = new THREE.Group();
    axes.matrixAutoUpdate = false;
    axes.matrix.copy(gltfToSdCar);
    axes.add(gltf.scene);
    car.model.add(axes);
    car.root.matrixAutoUpdate = false;
    car.root.add(car.model);
    for (const name of wheelNames) {
      const pivot = gltf.scene.getObjectByName(name);
      const spin = gltf.scene.getObjectByName(`${name}-spin`);
      if (!pivot || !spin) throw new Error(`car model has no ${name}`);
      car.wheels.push({
        pivot,
        spin,
        rest: pivot.position.clone(),
        restZ: null,
      });
    }
    car.steeringWheel = gltf.scene.getObjectByName("steering-wheel") ?? null;
    car.visualAxleMid =
      ((car.wheels[0]?.rest.z ?? 0) + (car.wheels[2]?.rest.z ?? 0)) / 2;
    return car;
  }

  setDraw(current: boolean): void {
    this.root.visible = current;
  }

  update(frame: Float64Array): void {
    this.root.matrix.fromArray(frame, frameIndex.posMat);
    this.root.matrixWorldNeedsUpdate = true;
    const wheel = (i: number, k: number) =>
      frame[frameIndex.wheels + i * 7 + k] ?? 0;
    if (!this.offsetReady) {
      this.model.position.x =
        (wheel(0, 0) + wheel(1, 0) + wheel(2, 0) + wheel(3, 0)) / 4 -
        this.visualAxleMid;
      this.offsetReady = true;
    }
    this.wheels.forEach((w, i) => {
      w.restZ ??= wheel(i, 2);
      w.pivot.position.set(
        w.rest.x,
        w.rest.y + (wheel(i, 2) - w.restZ),
        w.rest.z,
      );
      w.pivot.rotation.set(0, 0, 0);
      w.pivot.rotateY(wheel(i, 5));
      w.pivot.rotateZ(wheel(i, 3));
      w.spin.rotation.set(wheel(i, 4), 0, 0);
    });
    this.steeringWheel?.rotation.set(
      0,
      0,
      -(frame[frameIndex.steer] ?? 0) * steeringWheelRotation,
    );
  }
}
