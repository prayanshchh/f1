import * as THREE from "three/webgpu";
import { texture, uv } from "three/tsl";
import { frameIndex } from "./frame-layout.ts";
import { type CarEnvironment, useEnvironment } from "./carpaint.ts";
import { contactShadow, gltfToSdCar, wheelRest } from "./gltf.ts";
import { gltfLoader } from "./gltf-loader.ts";
import { mergedMesh, placedCopy } from "./merge.ts";
import { loaded, releaseOnceUploaded } from "./preload.ts";
import { carFile, gridTeamOrder, teams } from "./teams.ts";
import { markTyres, tyreAttribute, tyreMaterial } from "./tyre-paint.ts";

const leaveAfterLap = 2;
const headingProbe = 2;
const envStrength = 1;
const atlasMaterials = new Set(["body", "cockpit", "helmet"]);
const anisotropy = 16;
const textured = ["position", "normal", "uv"] as const;
const plain = ["position", "normal"] as const;
const tyred = ["position", "normal", tyreAttribute] as const;

export interface GridSlot {
  distance: number;
  offset: number;
}

type TrackPoint = (
  distance: number,
  lateral: number,
) => [number, number, number];

const maxAnisotropy = 16;

function textureOf(url: string, sRgb: boolean): THREE.Texture {
  const map = releaseOnceUploaded(new THREE.TextureLoader().load(url));
  map.flipY = false;
  map.anisotropy = anisotropy;
  map.colorSpace = sRgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = maxAnisotropy;
  return map;
}

function flatMaterial(
  source: THREE.MeshStandardMaterial,
  env: CarEnvironment,
): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    name: source.name,
    roughness: source.roughness,
    metalness: source.metalness,
    vertexColors: true,
  });
  useEnvironment(material, env, envStrength);
  return material;
}

function atlasMaterial(
  team: string,
  env: CarEnvironment,
): THREE.MeshStandardNodeMaterial {
  const orm = textureOf(carFile(team, "orm-lod.jpg"), false);
  const material = new THREE.MeshStandardNodeMaterial({
    name: `${team} atlas`,
    map: textureOf(carFile(team, "albedo-lod.jpg"), true),
  });
  useEnvironment(material, env, envStrength);
  material.roughnessNode = texture(orm, uv()).g;
  material.metalnessNode = texture(orm, uv()).b.mul(0);
  material.aoNode = texture(orm, uv()).r;
  return material;
}

interface TeamPart {
  geometry: THREE.BufferGeometry;
  source: THREE.MeshStandardMaterial;
}

async function teamParts(team: string): Promise<TeamPart[]> {
  const gltf = await gltfLoader().loadAsync(carFile(team, "lod.glb"));
  const parts: TeamPart[] = [];
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if ((object.material as THREE.Material).name === "tyre")
      markTyres(object.geometry as THREE.BufferGeometry, true);
    parts.push({
      geometry: object.geometry as THREE.BufferGeometry,
      source: object.material as THREE.MeshStandardMaterial,
    });
  });
  return parts;
}

class Batches {
  private readonly groups = new Map<
    string,
    { material: THREE.Material; parts: THREE.BufferGeometry[] }
  >();

  add(
    key: string,
    material: () => THREE.Material,
    part: THREE.BufferGeometry,
  ): void {
    const group = this.groups.get(key) ?? { material: material(), parts: [] };
    group.parts.push(part);
    this.groups.set(key, group);
  }

  meshes(): THREE.Mesh[] {
    return Array.from(this.groups.values(), ({ material, parts }) =>
      mergedMesh(parts, material),
    );
  }
}

function addParts(
  batches: Batches,
  team: string,
  parts: TeamPart[],
  matrix: THREE.Matrix4,
  env: CarEnvironment,
): void {
  for (const { geometry, source } of parts) {
    if (atlasMaterials.has(source.name))
      batches.add(
        team,
        () => atlasMaterial(team, env),
        placedCopy(geometry, matrix, textured),
      );
    else if (source.name === "tyre")
      batches.add(
        "tyre",
        () => tyreMaterial(env, maxAnisotropy),
        placedCopy(geometry, matrix, tyred),
      );
    else
      batches.add(
        source.name,
        () => flatMaterial(source, env),
        tinted(placedCopy(geometry, matrix, plain), source.color),
      );
  }
}

export async function teamModel(
  team: string,
  env: CarEnvironment,
): Promise<THREE.Object3D> {
  const batches = new Batches();
  addParts(batches, team, await teamParts(team), new THREE.Matrix4(), env);
  const model = new THREE.Group();
  model.add(...batches.meshes());
  await loaded();
  return model;
}

function tinted(
  part: THREE.BufferGeometry,
  colour: THREE.Color,
): THREE.BufferGeometry {
  const count = part.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colour.toArray(colours, i * 3);
  part.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return part;
}

export class GridCars {
  readonly root = new THREE.Group();
  private placed = false;
  playerSlot = 0;
  private readonly batches = new Batches();

  private constructor(
    private readonly teamsInOrder: string[],
    private readonly parts: Map<string, TeamPart[]>,
    private readonly slots: GridSlot[],
    private readonly point: TrackPoint,
    private readonly env: CarEnvironment,
  ) {
    this.root.visible = false;
  }

  static async load(
    player: string,
    slots: GridSlot[],
    point: TrackPoint,
    env: CarEnvironment,
  ): Promise<GridCars> {
    const parts = new Map(
      await Promise.all(
        teams.map(
          async (team) =>
            [team.id, await teamParts(team.id)] as [string, TeamPart[]],
        ),
      ),
    );
    return new GridCars(
      gridTeamOrder(player).slice(1),
      parts,
      slots,
      point,
      env,
    );
  }

  private addCar(team: string, matrix: THREE.Matrix4): void {
    const placed = new THREE.Matrix4().multiplyMatrices(matrix, gltfToSdCar);
    addParts(this.batches, team, this.parts.get(team) ?? [], placed, this.env);
  }

  private build(contacts: THREE.BufferGeometry[]): void {
    const meshes = this.batches.meshes();
    for (const mesh of meshes) mesh.castShadow = true;
    const contact = contactShadow(wheelRest);
    const shadows = mergedMesh(contacts, contact.material as THREE.Material);
    shadows.renderOrder = contact.renderOrder;
    this.root.add(...meshes, shadows);
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
    const contact = contactShadow(wheelRest);
    contact.updateMatrix();
    const contacts: THREE.BufferGeometry[] = [];
    const matrix = new THREE.Matrix4();
    this.teamsInOrder.forEach((team, index) => {
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
      matrix.makeBasis(forward, left, up).setPosition(at);
      this.addCar(team, matrix);
      contacts.push(
        placedCopy(
          contact.geometry,
          new THREE.Matrix4().multiplyMatrices(matrix, contact.matrix),
          textured,
        ),
      );
    });
    this.build(contacts);
    this.placed = true;
  }

  update(frame: Float64Array): void {
    const pose = frameIndex.posMat;
    const player = new THREE.Vector3(
      frame[pose + 12] ?? 0,
      frame[pose + 13] ?? 0,
      frame[pose + 14] ?? 0,
    );
    if (!this.placed) this.place(player);
    const lap = frame[frameIndex.laps] ?? 0;
    this.root.visible = lap < leaveAfterLap;
  }
}
