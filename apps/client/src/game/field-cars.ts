import * as THREE from "three/webgpu";
import type { CarEnvironment } from "./carpaint.ts";
import { carField, carStride } from "./engine.ts";
import { carWheel } from "./frame-layout.ts";
import {
  contactShadow,
  gltfToSdCar,
  makeDamageable,
  wheelRest,
} from "./gltf.ts";
import { type DamageLook, newLook } from "./car-damage.ts";
import { teamModel } from "./grid.ts";
import { compounds } from "./tyres.ts";
import { spinBlur, type TyreLook, tyreLook } from "./tyre-paint.ts";

const wheelCount = 4;
const drawDistance = 900;
const wheelDistance = 220;
const shadowDistance = 90;
const shortestFrame = 1 / 240;
const longestFrame = 1 / 20;
const wheelParts = new Set(["tyre", "rim"]);

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

  static async load(teams: string[], env: CarEnvironment): Promise<FieldCars> {
    const field = new FieldCars();
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
    const damage = newLook();
    body.traverse((object) => {
      if ((object.userData as { damage?: DamageLook }).damage)
        object.userData = { ...object.userData, damage };
    });
    model.add(body, contact);
    root.add(model);
    const look = tyreLook();
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

  update(data: Float64Array, camera: THREE.Camera): void {
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const now = performance.now();
    const seconds = THREE.MathUtils.clamp(
      (now - this.updatedAt) / 1000,
      shortestFrame,
      longestFrame,
    );
    this.updatedAt = now;
    this.cars.forEach((car, i) => {
      const at = (i + 1) * carStride;
      const visible = (data[at + carField.visible] ?? 0) !== 0;
      const x = data[at + 12] ?? 0;
      const y = data[at + 13] ?? 0;
      const z = data[at + 14] ?? 0;
      const distance = Math.hypot(
        x - this.eye.x,
        y - this.eye.y,
        z - this.eye.z,
      );
      const shown = visible && distance < drawDistance;
      car.root.visible = shown;
      if (!shown) return;
      if (!car.placed) this.place(car, data, at);
      car.root.matrix.fromArray(data, at);
      car.root.matrixWorldNeedsUpdate = true;
      this.setShadow(car, distance < shadowDistance);
      this.setCompound(car, data[at + carField.compound] ?? 1);
      if (distance < wheelDistance) this.updateWheels(car, data, at, seconds);
    });
  }
}
