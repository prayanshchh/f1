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
const replacedTrackSurfaces =
  /^(R02 PBR \| (pit )?asphalt|R02 PBR \| paint (white|red|blue)|R02 \| Rubber racing line pigment|R02 \| Drain recess and expansion joints|R02 \| Roadside grass \d)( \| game PBR)?$/;
const retiredSurfaces = /dry grass macro/;
const oldTrackside: [RegExp, number][] = [
  [/COTA \| (Galvanized|Charcoal) steel|Fine galvanized chain link/, 35],
  [/Architectural white coating/, 30],
];
const startGantryRadius = 15;
const centrelineCell = 20;

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

function hideReplacedSurfaces(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const name = (object.material as THREE.Material).name;
    if (replacedTrackSurfaces.test(name) || retiredSurfaces.test(name))
      object.visible = false;
  });
}

class CentrelineIndex {
  private readonly cells = new Map<string, [number, number][]>();

  constructor(points: [number, number][]) {
    for (const point of points) {
      const key = this.key(point[0], point[1]);
      const cell = this.cells.get(key);
      if (cell) cell.push(point);
      else this.cells.set(key, [point]);
    }
  }

  private key(x: number, z: number): string {
    return `${String(Math.floor(x / centrelineCell))},${String(Math.floor(z / centrelineCell))}`;
  }

  within(x: number, z: number, reach: number): boolean {
    const span = Math.ceil(reach / centrelineCell);
    const cx = Math.floor(x / centrelineCell);
    const cz = Math.floor(z / centrelineCell);
    for (let a = -span; a <= span; a++)
      for (let b = -span; b <= span; b++)
        for (const [px, pz] of this.cells.get(
          `${String(cx + a)},${String(cz + b)}`,
        ) ?? [])
          if (Math.hypot(px - x, pz - z) < reach) return true;
    return false;
  }
}

function retireOldBarriers(
  root: THREE.Object3D,
  centreline: [number, number][],
): void {
  const index = new CentrelineIndex(centreline);
  const corner = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const name = (object.material as THREE.Material).name;
    const reach = oldTrackside.find(([pattern]) => pattern.test(name))?.[1];
    if (reach === undefined) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const triangles = geometry.index;
    const position = geometry.getAttribute("position");
    if (!triangles) return;
    const kept: number[] = [];
    for (let i = 0; i < triangles.count; i += 3) {
      let x = 0;
      let z = 0;
      for (let k = 0; k < 3; k++) {
        corner
          .fromBufferAttribute(position, triangles.getX(i + k))
          .applyMatrix4(object.matrixWorld);
        x += corner.x / 3;
        z += corner.z / 3;
      }
      if (Math.hypot(x, z) < startGantryRadius || !index.within(x, z, reach))
        kept.push(
          triangles.getX(i),
          triangles.getX(i + 1),
          triangles.getX(i + 2),
        );
    }
    geometry.setIndex(kept);
  });
}

export async function loadGltfTrack(
  url: string,
  lighting: SdLighting,
  frame: TrackFrame,
  sdStart: [number, number, number],
  centreline: [number, number][],
): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(url);
  hideReplacedSurfaces(gltf.scene);
  retireOldBarriers(gltf.scene, centreline);
  useSdLighting(gltf.scene, lighting);
  return placeOnTrack(gltf.scene, frame, sdStart);
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
