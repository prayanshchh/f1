import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import * as THREE from "three/webgpu";
import type { CarEnvironment } from "../carpaint.ts";
import { FieldCars } from "../field-cars.ts";
import { carFile } from "../teams.ts";
import {
  paintGain,
  type TyreLook,
  tyreLook,
  wallFrom,
  wallRubber,
  wallTo,
  whitePaint,
} from "../tyre-paint.ts";
import { compounds } from "../tyres.ts";
import type { CorridorView, Placed } from "./corridor-view.ts";
import {
  flatMesh,
  type FlatMesh,
  type GeometryData,
  liveryColour,
  srgbColour,
  type Swatch,
  wallColour,
  smoothSwatch,
  withoutSmallParts,
} from "./toon-car.ts";

export interface TyreWall {
  paint: number[];
  white: number[];
}

const swatchSize = 512;
const swatchColours = 6;
const playerDetail = 1;
const detailLines = 200;
const wheelParts = new Set(["tyre", "rim"]);
const wheelError = 0.004;
const shadowSize = 64;
const shadowDarkness = 0.55;
const compoundColours = compounds.map(
  (compound) => new THREE.Color(compound.colour),
);
const fallbackCompound = tyreLook().compound;

function flatten(
  geometry: THREE.BufferGeometry,
  name: string,
  size: number,
): Float32Array {
  const count = geometry.getAttribute("position").count;
  const out = new Float32Array(count * size);
  if (!geometry.hasAttribute(name)) return out;
  const attribute = geometry.getAttribute(name);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < size; k++)
      out[i * size + k] = attribute.getComponent(i, k);
  return out;
}

function geometryData(geometry: THREE.BufferGeometry): GeometryData {
  const count = geometry.getAttribute("position").count;
  const indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count }, (_, i) => i);
  return {
    positions: flatten(geometry, "position", 3),
    normals: flatten(geometry, "normal", 3),
    uvs: flatten(geometry, "uv", 2),
    indices,
  };
}

function simplifiedWheel(data: GeometryData): GeometryData {
  const remap = MeshoptSimplifier.generatePositionRemap(data.positions, 3);
  const welded = Uint32Array.from(data.indices, (i) => remap[i] ?? i);
  const [indices] = MeshoptSimplifier.simplify(
    welded,
    data.positions,
    3,
    Math.floor((welded.length * 0.2) / 3) * 3,
    wheelError,
    ["ErrorAbsolute", "Permissive"],
  );
  return { ...data, indices };
}

function drawable(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh)) return false;
  const geometry: THREE.BufferGeometry = (object as THREE.Mesh).geometry;
  return geometry.hasAttribute("normal");
}

function wallPixels(wall: TyreWall, compound: THREE.Color): Uint8Array {
  const rubber = new THREE.Color(wallRubber, wallRubber, wallRubber);
  const paint = compound.clone().multiplyScalar(paintGain);
  const white = new THREE.Color(whitePaint, whitePaint, whitePaint);
  const pixels = new Uint8Array(wall.paint.length * 4);
  wall.paint.forEach((amount, i) => {
    const colour = rubber
      .clone()
      .lerp(paint, amount)
      .lerp(white, wall.white[i] ?? 0)
      .convertLinearToSRGB();
    pixels.set(
      [colour.r * 255, colour.g * 255, colour.b * 255, 255].map(Math.round),
      i * 4,
    );
  });
  return pixels;
}

function compoundOf(mesh: THREE.Mesh): THREE.Color {
  return (
    (mesh.userData as { tyre?: TyreLook }).tyre?.compound ?? fallbackCompound
  );
}

function flatColour(mesh: THREE.Mesh): THREE.Color {
  const material = mesh.material as THREE.MeshStandardMaterial;
  if (!mesh.geometry.hasAttribute("color")) return material.color;
  const colours = mesh.geometry.getAttribute("color");
  return new THREE.Color(colours.getX(0), colours.getY(0), colours.getZ(0));
}

function shadowPixels(): Uint8Array {
  const pixels = new Uint8Array(shadowSize * shadowSize * 4);
  for (let y = 0; y < shadowSize; y++)
    for (let x = 0; x < shadowSize; x++) {
      const r = Math.hypot(
        ((x + 0.5) / shadowSize - 0.5) * 2,
        ((y + 0.5) / shadowSize - 0.5) * 2,
      );
      const t = THREE.MathUtils.clamp((r - 0.35) / 0.65, 0, 1);
      const fade = 1 - t * t * (3 - 2 * t);
      pixels[(y * shadowSize + x) * 4 + 3] = Math.round(
        255 * fade * shadowDarkness,
      );
    }
  return pixels;
}

export class CorridorCars {
  private readonly ids = new Map<string, number>();
  private readonly wheels = new Map<string, GeometryData>();
  private readonly placed: Placed[] = [];
  private readonly propPlaced: Placed[] = [];
  private readonly shadowTexture: number;

  private constructor(
    private readonly view: CorridorView,
    private readonly field: FieldCars,
    private readonly teams: string[],
    private readonly swatches: Map<string, Swatch>,
    private readonly wall: TyreWall,
  ) {
    field.resize(detailLines);
    field.holdDetail(0, playerDetail);
    this.shadowTexture = view.rawTexture(
      shadowPixels(),
      shadowSize,
      shadowSize,
      4,
    );
  }

  static async load(
    view: CorridorView,
    teams: string[],
    env: CarEnvironment,
    wall: TyreWall,
  ): Promise<CorridorCars> {
    await MeshoptSimplifier.ready;
    const unique = [...new Set(teams)];
    const [field, ...pixels] = await Promise.all([
      FieldCars.load(teams, env, 0),
      ...unique.map((team) =>
        view.swatch(
          carFile(team, "albedo-lod.jpg"),
          carFile(team, "orm-lod.jpg"),
          swatchSize,
          swatchColours,
        ),
      ),
    ]);
    const swatches = new Map(
      unique.map(
        (team, i) =>
          [
            team,
            smoothSwatch({
              pixels: pixels[i] ?? new Uint8Array(4),
              size: swatchSize,
            }),
          ] as const,
      ),
    );
    const cars = new CorridorCars(view, field, teams, swatches, wall);
    cars.prime();
    return cars;
  }

  private prime(): void {
    this.field.root.children.forEach((root, i) => {
      const team = this.teams[i] ?? this.teams[0] ?? "";
      root.traverse((object) => {
        if (!drawable(object)) return;
        if ((object.material as THREE.Material).name !== "tyre")
          this.meshId(object, team);
        else
          for (const compound of compoundColours) this.tyreId(object, compound);
      });
    });
  }

  private cached(key: string, build: () => number): number {
    const known = this.ids.get(key);
    if (known !== undefined) return known;
    const id = build();
    this.ids.set(key, id);
    return id;
  }

  private wheelData(geometry: THREE.BufferGeometry): GeometryData {
    const known = this.wheels.get(geometry.uuid);
    if (known) return known;
    const data = simplifiedWheel(geometryData(geometry));
    this.wheels.set(geometry.uuid, data);
    return data;
  }

  private flatId(mesh: THREE.Mesh, flat: FlatMesh, lit = true): number {
    const id = this.view.mesh(
      { positions: flat.positions, uvs: null, indices: flat.indices },
      -1,
      lit ? flat.normals : null,
      [1, 1, 1],
      flat.colours,
    );
    if ((mesh.material as THREE.Material).side === THREE.FrontSide)
      this.view.cull(id);
    return id;
  }

  private tyreId(mesh: THREE.Mesh, compound: THREE.Color): number {
    const key = `${mesh.geometry.uuid}:tyre:${compound.getHexString()}`;
    return this.cached(key, () => {
      const data = this.wheelData(mesh.geometry);
      const pixels = wallPixels(this.wall, compound);
      return this.flatId(
        mesh,
        flatMesh(data, wallColour(pixels, wallFrom, wallTo, data)),
      );
    });
  }

  private paintedMesh(mesh: THREE.Mesh, team: string, atlas: boolean): number {
    const material = mesh.material as THREE.Material;
    const data = wheelParts.has(material.name)
      ? this.wheelData(mesh.geometry)
      : geometryData(mesh.geometry);
    const swatch = this.swatches.get(team);
    if (atlas && swatch)
      return this.flatId(mesh, flatMesh(data, liveryColour(swatch, data)));
    const colour = srgbColour(flatColour(mesh));
    return this.flatId(
      mesh,
      flatMesh(data, () => colour, withoutSmallParts(data)),
      false,
    );
  }

  private meshId(mesh: THREE.Mesh, team: string): number {
    const material = mesh.material as THREE.Material;
    const uuid = mesh.geometry.uuid;
    if (material.transparent)
      return this.cached(`${uuid}:shadow`, () =>
        this.view.mesh(geometryData(mesh.geometry), this.shadowTexture),
      );
    if (material.name === "tyre") return this.tyreId(mesh, compoundOf(mesh));
    const atlas = material.name.endsWith("atlas");
    return this.cached(`${uuid}:${atlas ? team : material.uuid}`, () =>
      this.paintedMesh(mesh, team, atlas),
    );
  }

  private collect(object: THREE.Object3D, team: string): void {
    if (!object.visible) return;
    if (drawable(object))
      this.placed.push({
        mesh: this.meshId(object, team),
        matrix: object.matrixWorld,
        last: (object.material as THREE.Material).transparent,
      });
    for (const child of object.children) this.collect(child, team);
  }

  props(root: THREE.Object3D): Placed[] {
    this.propPlaced.length = 0;
    if (!root.visible) return this.propPlaced;
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!drawable(object) || !object.visible) return;
      this.propPlaced.push({
        mesh: this.propId(object),
        matrix: object.matrixWorld,
        last: false,
      });
    });
    return this.propPlaced;
  }

  private propId(mesh: THREE.Mesh): number {
    const material = mesh.material as THREE.MeshStandardMaterial;
    return this.cached(`${mesh.geometry.uuid}:prop:${material.uuid}`, () => {
      const colour = srgbColour(material.color);
      return this.flatId(
        mesh,
        flatMesh(geometryData(mesh.geometry), () => colour),
      );
    });
  }

  update(cars: Float64Array, camera: THREE.Camera): Placed[] {
    this.field.update(cars, camera);
    this.field.root.updateMatrixWorld(true);
    this.placed.length = 0;
    this.field.root.children.forEach((root, i) => {
      this.collect(root, this.teams[i] ?? this.teams[0] ?? "");
    });
    return this.placed;
  }
}
