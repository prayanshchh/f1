import * as THREE from "three/webgpu";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CarEnvironment } from "./carpaint.ts";
import { detailFor, detailLevels } from "./detail-level.ts";
import { carField, carStride, carWheel } from "./frame-layout.ts";
import {
  contactShadow,
  gltfToSdCar,
  makeDamageable,
  wheelRest,
} from "./gltf.ts";
import { type DamageLook, newLook } from "./car-damage.ts";
import { teamModel } from "./grid.ts";
import { compounds } from "./tyres.ts";
import { spinBlur, treadOf, type TyreLook, tyreLook } from "./tyre-paint.ts";

const wheelCount = 4;
const drawDistance = 900;
const wheelDistance = 220;
const shadowDistance = 90;
const shortestFrame = 1 / 240;
const longestFrame = 1 / 20;
const wheelParts = new Set(["tyre", "rim"]);
const referenceHeight = 2160;

function matrix(): THREE.Group {
  const object = new THREE.Group();
  object.matrixAutoUpdate = false;
  return object;
}

interface WheelShape {
  meshes: THREE.Mesh[];
  centre: THREE.Vector3;
  radius: number;
  width: number;
}

interface Template {
  body: THREE.Object3D;
  wheels: WheelShape[];
  levels: THREE.Object3D[];
  axleMid: number;
  wheelHeight: number;
}

interface WheelNode {
  pivot: THREE.Group;
  spin: THREE.Group;
}

interface FieldCar {
  root: THREE.Group;
  model: THREE.Group;
  body: THREE.Object3D;
  levels: THREE.Object3D[];
  detail: number;
  floor: number;
  wheels: WheelNode[];
  look: TyreLook;
  radius: number;
  casters: THREE.Mesh[];
  shadowOn: boolean;
  compound: number;
  placed: boolean;
  axleMid: number;
  wheelHeight: number;
  damage: DamageLook;
}

const scratch = new THREE.Matrix4();

function wheelOf(x: number, y: number): number {
  return (x > 0 ? 0 : 2) + (y > 0 ? 1 : 0);
}

const readers = ["getX", "getY", "getZ", "getW"] as const;

function splitWheels(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const picks: number[][] = Array.from({ length: wheelCount }, () => []);
  for (let v = 0; v < position.count; v += 3) {
    let x = 0;
    let y = 0;
    for (let k = 0; k < 3; k++) {
      x += position.getX(v + k);
      y += position.getY(v + k);
    }
    picks[wheelOf(x, y)]?.push(v, v + 1, v + 2);
  }
  return picks.map((list) => {
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const size = attribute.itemSize;
      const array = new Float32Array(list.length * size);
      list.forEach((vertex, i) => {
        for (let k = 0; k < size; k++)
          array[i * size + k] = attribute[readers[k] ?? "getX"](vertex);
      });
      part.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    return part;
  });
}

function wheelShapes(model: THREE.Object3D): WheelShape[] {
  model.updateMatrixWorld(true);
  const parts: THREE.Mesh[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (
      object.type === "Mesh" &&
      wheelParts.has((mesh.material as THREE.Material).name)
    )
      parts.push(mesh);
  });
  const shapes = Array.from({ length: wheelCount }, () => ({
    meshes: [] as THREE.Mesh[],
    box: new THREE.Box3(),
  }));
  for (const mesh of parts) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(
      scratch.multiplyMatrices(gltfToSdCar, mesh.matrixWorld),
    );
    splitWheels(geometry).forEach((part, i) => {
      part.computeBoundingBox();
      if (part.boundingBox) shapes[i]?.box.union(part.boundingBox);
      shapes[i]?.meshes.push(
        new THREE.Mesh(part, mesh.material as THREE.Material),
      );
    });
    mesh.removeFromParent();
  }
  return shapes.map(({ meshes, box }) => {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    for (const mesh of meshes)
      mesh.geometry.translate(-centre.x, -centre.y, -centre.z);
    return {
      meshes,
      centre,
      radius: Math.max(size.x, size.z) / 2,
      width: size.y,
    };
  });
}

function flatPositions(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.getAttribute("position");
  const flat = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    flat[i * 3] = position.getX(i);
    flat[i * 3 + 1] = position.getY(i);
    flat[i * 3 + 2] = position.getZ(i);
  }
  return flat;
}

function simplified(
  geometry: THREE.BufferGeometry,
  error: number,
): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const source = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count }, (_, i) => i);
  const [indices] = MeshoptSimplifier.simplify(
    source,
    flatPositions(geometry),
    3,
    0,
    error,
    ["ErrorAbsolute"],
  );
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes))
    result.setAttribute(name, attribute);
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  result.boundingSphere = geometry.boundingSphere;
  return result;
}

function simplifiedBody(body: THREE.Object3D, error: number): THREE.Group {
  const level = matrix();
  level.matrix.copy(body.matrix);
  body.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (object.type !== "Mesh") return;
    const copy = new THREE.Mesh(
      simplified(mesh.geometry, error),
      mesh.material,
    );
    copy.userData = mesh.userData;
    level.add(copy);
  });
  return level;
}

function staticWheels(wheels: WheelShape[], error: number): THREE.Mesh[] {
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const shape of wheels)
    for (const mesh of shape.meshes) {
      const material = mesh.material as THREE.Material;
      const placed = mesh.geometry
        .clone()
        .translate(shape.centre.x, shape.centre.y, shape.centre.z);
      groups.set(material, [...(groups.get(material) ?? []), placed]);
    }
  return Array.from(groups, ([material, parts]) => {
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    const welded = mergeVertices(merged);
    merged.dispose();
    return new THREE.Mesh(simplified(welded, error), material);
  });
}

function detailModels(body: THREE.Object3D, wheels: WheelShape[]) {
  return detailLevels.map(({ error, spinning }) => {
    const level = new THREE.Group();
    level.add(simplifiedBody(body, error));
    if (!spinning) level.add(...staticWheels(wheels, error));
    return level;
  });
}

async function loadTemplate(
  team: string,
  env: CarEnvironment,
): Promise<Template> {
  const model = await teamModel(team, env);
  const wheels = wheelShapes(model);
  makeDamageable(model, newLook(), (mesh) => {
    const name = (mesh.material as THREE.Material).name;
    return name.endsWith("atlas") || name === "carbon-part";
  });
  const body = matrix();
  body.matrix.copy(gltfToSdCar);
  body.add(model);
  const mean = (pick: (shape: WheelShape) => number) =>
    wheels.reduce((sum, shape) => sum + pick(shape), 0) / wheels.length;
  return {
    body,
    wheels,
    levels: detailModels(body, wheels),
    axleMid: mean((shape) => shape.centre.x),
    wheelHeight: mean((shape) => shape.centre.z),
  };
}

export class FieldCars {
  readonly root = new THREE.Group();
  private readonly cars: FieldCar[] = [];
  private readonly compoundColours = compounds.map(
    (compound) => new THREE.Color(compound.colour),
  );
  private readonly eye = new THREE.Vector3();
  private updatedAt = 0;
  private viewHeight = referenceHeight;

  private constructor(private readonly first: number) {}

  static async load(
    teams: string[],
    env: CarEnvironment,
    first = 1,
  ): Promise<FieldCars> {
    await MeshoptSimplifier.ready;
    const field = new FieldCars(first);
    const unique = [...new Set(teams)];
    const templates = new Map(
      await Promise.all(
        unique.map(
          async (team) =>
            [team, await loadTemplate(team, env)] as [string, Template],
        ),
      ),
    );
    for (const team of teams) {
      const template = templates.get(team);
      if (!template) throw new Error(`no field model for ${team}`);
      field.cars.push(field.build(template));
    }
    return field;
  }

  private build(template: Template): FieldCar {
    const root = matrix();
    root.visible = false;
    const model = new THREE.Group();
    const contact = contactShadow(wheelRest);
    const body = template.body.clone();
    const levels = template.levels.map((level) => level.clone());
    const damage = newLook();
    const look = tyreLook();
    for (const part of [body, ...levels])
      part.traverse((object) => {
        if ((object.userData as { damage?: DamageLook }).damage)
          object.userData = { ...object.userData, damage };
        const material = (object as THREE.Mesh).material as
          THREE.Material | undefined;
        if (material?.name === "tyre") object.userData = { tyre: look };
      });
    for (const level of levels) level.visible = false;
    model.add(body, ...levels, contact);
    root.add(model);
    const wheels = template.wheels.map((shape) =>
      this.buildWheel(shape, root, look),
    );
    const casters: THREE.Mesh[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (object.type === "Mesh" && mesh !== contact) casters.push(mesh);
    });
    for (const mesh of casters) mesh.castShadow = true;
    this.root.add(root);
    return {
      root,
      model,
      body,
      levels,
      detail: 0,
      floor: 0,
      wheels,
      look,
      radius:
        template.wheels.reduce((sum, shape) => sum + shape.radius, 0) /
        template.wheels.length,
      casters,
      shadowOn: true,
      compound: -1,
      placed: false,
      axleMid: template.axleMid,
      wheelHeight: template.wheelHeight,
      damage,
    };
  }

  private buildWheel(
    shape: WheelShape,
    root: THREE.Group,
    look: TyreLook,
  ): WheelNode {
    const spin = matrix();
    for (const mesh of shape.meshes) {
      const copy = mesh.clone();
      if ((mesh.material as THREE.Material).name === "tyre")
        copy.userData = { tyre: look };
      spin.add(copy);
    }
    const pivot = matrix();
    pivot.matrix.makeTranslation(shape.centre);
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin };
  }

  private place(car: FieldCar, data: Float64Array, at: number): void {
    const w = (i: number, k: number) =>
      data[at + carWheel.from + i * carWheel.stride + k] ?? 0;
    const mean = (k: number) =>
      [0, 1, 2, 3].reduce((sum, i) => sum + w(i, k), 0) / wheelCount;
    car.model.position.set(mean(0) - car.axleMid, 0, mean(2) - car.wheelHeight);
    car.placed = true;
  }

  private updateWheels(
    car: FieldCar,
    data: Float64Array,
    at: number,
    seconds: number,
  ): void {
    car.look.blur = spinBlur(
      (data[at + carField.speed] ?? 0) / car.radius,
      seconds,
    );
    car.wheels.forEach((wheel, i) => {
      const w = (k: number) =>
        data[at + carWheel.from + i * carWheel.stride + k] ?? 0;
      wheel.spin.matrix.makeRotationY(w(4));
      wheel.pivot.matrix
        .makeTranslation(w(0), w(1), w(2))
        .multiply(scratch.makeRotationZ(w(5)));
      wheel.pivot.matrix.multiply(scratch.makeRotationX(w(3)));
    });
  }

  private setCompound(car: FieldCar, compound: number): void {
    if (compound === car.compound) return;
    car.compound = compound;
    const colour = this.compoundColours[compound] ?? this.compoundColours[1];
    if (colour) car.look.compound.copy(colour);
    car.look.tread = treadOf(compound);
  }

  private setShadow(car: FieldCar, on: boolean): void {
    if (car.shadowOn === on) return;
    car.shadowOn = on;
    for (const mesh of car.casters) mesh.castShadow = on;
  }

  damageOf(index: number): DamageLook | null {
    return this.cars[index - 1]?.damage ?? null;
  }

  hide(hidden: boolean): void {
    this.root.visible = !hidden;
  }

  holdDetail(index: number, level: number): void {
    const car = this.cars[index];
    if (car) car.floor = level;
  }

  resize(height: number): void {
    this.viewHeight = Math.max(1, height);
  }

  private setDetail(car: FieldCar, detail: number): void {
    if (detail === car.detail) return;
    car.detail = detail;
    car.body.visible = detail === 0;
    car.levels.forEach((level, i) => {
      level.visible = detail === i + 1;
    });
    const spinning = detail === 0 || detailLevels[detail - 1]?.spinning;
    for (const wheel of car.wheels) wheel.pivot.visible = spinning === true;
  }

  update(data: Float64Array, camera: THREE.Camera): void {
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const lens = camera.projectionMatrix.elements[5];
    const spread = 2 / (Math.max(lens, 1e-6) * this.viewHeight);
    const now = performance.now();
    const seconds = THREE.MathUtils.clamp(
      (now - this.updatedAt) / 1000,
      shortestFrame,
      longestFrame,
    );
    this.updatedAt = now;
    this.cars.forEach((car, i) => {
      this.updateCar(car, data, (i + this.first) * carStride, seconds, spread);
    });
  }

  private distanceOf(data: Float64Array, at: number): number {
    return Math.hypot(
      (data[at + 12] ?? 0) - this.eye.x,
      (data[at + 13] ?? 0) - this.eye.y,
      (data[at + 14] ?? 0) - this.eye.z,
    );
  }

  private updateCar(
    car: FieldCar,
    data: Float64Array,
    at: number,
    seconds: number,
    spread: number,
  ): void {
    const distance = this.distanceOf(data, at);
    const shown =
      (data[at + carField.visible] ?? 0) !== 0 && distance < drawDistance;
    car.root.visible = shown;
    if (!shown) return;
    if (!car.placed) this.place(car, data, at);
    car.root.matrix.fromArray(data, at);
    car.root.matrixWorldNeedsUpdate = true;
    this.setShadow(car, distance < shadowDistance);
    this.setCompound(car, data[at + carField.compound] ?? 1);
    this.setDetail(
      car,
      Math.max(car.floor, detailFor(car.detail, distance * spread)),
    );
    const spinning = car.wheels[0]?.pivot.visible === true;
    if (spinning && distance < wheelDistance)
      this.updateWheels(car, data, at, seconds);
  }
}
