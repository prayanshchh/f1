import * as THREE from "three/webgpu";
import { texture, uv } from "three/tsl";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { frameIndex } from "./engine.ts";
import { contactShadow, gltfToSdCar, wheelRest } from "./gltf.ts";
import { finish } from "./road.ts";
import { carFile, gridTeamOrder, teams } from "./teams.ts";

const visibleDistance = 700;
const leaveAfterLap = 2;
const headingProbe = 2;
const shadowDistance = 30;
const envStrength = 0.65;
const atlasMaterials = new Set(["body", "cockpit", "helmet"]);

export interface GridSlot {
  distance: number;
  offset: number;
}

type TrackPoint = (
  distance: number,
  lateral: number,
) => [number, number, number];

async function textureOf(url: string, sRgb: boolean): Promise<THREE.Texture> {
  const map = await new THREE.TextureLoader().loadAsync(url);
  map.flipY = false;
  map.colorSpace = sRgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return map;
}

async function teamMaterials(
  team: string,
  env: THREE.Texture,
): Promise<(source: THREE.MeshStandardMaterial) => THREE.Material> {
  const [albedo, orm, tyre] = await Promise.all([
    textureOf(carFile(team, "albedo-lod.jpg"), true),
    textureOf(carFile(team, "orm-lod.jpg"), false),
    textureOf(carFile("shared", "tyre.jpg"), true),
  ]);
  const made = new Map<string, THREE.Material>();
  return (source) => {
    const existing = made.get(source.name);
    if (existing) return existing;
    const material = new THREE.MeshStandardNodeMaterial({
      name: source.name,
      color: source.color,
      roughness: source.roughness,
      metalness: source.metalness,
    });
    material.envMap = env;
    material.envMapIntensity = envStrength;
    material.envMapRotation.set(Math.PI / 2, 0, 0);
    if (atlasMaterials.has(source.name)) {
      material.color.set(1, 1, 1);
      material.map = albedo;
      material.roughnessNode = texture(orm, uv()).g;
      material.metalnessNode = texture(orm, uv()).b.mul(0);
      material.aoNode = texture(orm, uv()).r;
    }
    if (source.name === "tyre") {
      material.color.set(1, 1, 1);
      material.map = tyre;
    }
    finish(material);
    made.set(source.name, material);
    return material;
  };
}

export async function teamModel(
  team: string,
  env: THREE.Texture,
): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(carFile(team, "lod.glb"));
  const material = await teamMaterials(team, env);
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = material(object.material as THREE.MeshStandardMaterial);
  });
  return gltf.scene;
}

export class GridCars {
  readonly root = new THREE.Group();
  private placed = false;
  playerSlot = 0;
  private shown = false;
  private readonly centre = new THREE.Vector3();

  private constructor(
    private readonly cars: THREE.Object3D[],
    private readonly slots: GridSlot[],
    private readonly point: TrackPoint,
  ) {
    this.root.visible = false;
  }

  static async load(
    player: string,
    slots: GridSlot[],
    point: TrackPoint,
    env: THREE.Texture,
  ): Promise<GridCars> {
    const models = new Map(
      await Promise.all(
        teams.map(
          async (team) =>
            [team.id, await teamModel(team.id, env)] as [
              string,
              THREE.Object3D,
            ],
        ),
      ),
    );
    const cars = gridTeamOrder(player)
      .slice(1)
      .map((id) => {
        const model = models.get(id);
        if (!model) throw new Error(`no grid model for ${id}`);
        const axes = new THREE.Group();
        axes.matrixAutoUpdate = false;
        axes.matrix.copy(gltfToSdCar);
        axes.add(model.clone());
        const car = new THREE.Group();
        car.matrixAutoUpdate = false;
        const contact = contactShadow(wheelRest);
        contact.userData["contact"] = true;
        car.add(axes, contact);
        return car;
      });
    return new GridCars(cars, slots, point);
  }

  private locate(player: THREE.Vector3) {
    let best = { slot: 0, side: 1, gap: Infinity };
    this.slots.forEach((slot, index) => {
      for (const side of [1, -1]) {
        const [x, y] = this.point(slot.distance, slot.offset * side);
        const gap = Math.hypot(x - player.x, y - player.y);
        if (gap < best.gap) best = { slot: index, side, gap };
      }
    });
    return best;
  }

  private place(player: THREE.Vector3): void {
    const { slot, side } = this.locate(player);
    this.playerSlot = slot;
    const own = this.slots[slot];
    if (!own) return;
    const ownPoint = new THREE.Vector3(
      ...this.point(own.distance, own.offset * side),
    );
    const ahead = new THREE.Vector3(
      ...this.point(own.distance + headingProbe, own.offset * side),
    )
      .sub(ownPoint)
      .normalize();
    const along = player.clone().sub(ownPoint).dot(ahead);
    const others = this.slots.filter((_, index) => index !== slot);
    this.cars.forEach((car, index) => {
      const target = others[index];
      if (!target) return;
      const lateral = target.offset * side;
      const distance = target.distance + along;
      const at = new THREE.Vector3(...this.point(distance, lateral));
      const forward = new THREE.Vector3(
        ...this.point(distance + headingProbe, lateral),
      )
        .sub(at)
        .normalize();
      const left = new THREE.Vector3(0, 0, 1).cross(forward).normalize();
      const up = forward.clone().cross(left);
      car.matrix.makeBasis(forward, left, up).setPosition(at);
      car.userData["position"] = at;
      this.root.add(car);
    });
    this.centre.copy(player);
    this.placed = true;
  }

  hide(hidden: boolean): void {
    this.root.visible = !hidden && this.shown;
  }

  private updateShadows(eye: THREE.Vector3): void {
    for (const car of this.cars) {
      const position = car.userData["position"] as THREE.Vector3 | undefined;
      const near = position ? position.distanceTo(eye) < shadowDistance : false;
      if (car.userData["near"] === near) continue;
      car.userData["near"] = near;
      car.traverse((object) => {
        if (object instanceof THREE.Mesh && !object.userData["contact"])
          object.castShadow = near;
      });
    }
  }

  update(frame: Float64Array, eye: THREE.Vector3): void {
    const pose = frameIndex.posMat;
    const player = new THREE.Vector3(
      frame[pose + 12] ?? 0,
      frame[pose + 13] ?? 0,
      frame[pose + 14] ?? 0,
    );
    if (!this.placed) this.place(player);
    const lap = frame[frameIndex.laps] ?? 0;
    const near = eye.distanceTo(this.centre) < visibleDistance;
    this.shown = lap < leaveAfterLap && near;
    this.root.visible = this.shown;
    if (this.shown) this.updateShadows(eye);
  }
}
