import * as THREE from "three/webgpu";
import type { CarInfo } from "./car.ts";
import { carField, carStride } from "./engine.ts";
import type { SdLighting, SurfaceOptions } from "./materials.ts";
import type { SdAssets } from "./models.ts";
import { compounds } from "./tyres.ts";

const wheelCount = 4;
const wheelsFrom = 16;
const wheelFields = 6;
const groundSink = 0.025;
const drawDistance = 900;
const wheelDistance = 220;
const shadowDistance = 90;
const spinBlur = 60;
const sidewallRadius = 0.86;

function matrix(): THREE.Group {
  const object = new THREE.Group();
  object.matrixAutoUpdate = false;
  return object;
}

interface WheelNode {
  pivot: THREE.Group;
  spin: THREE.Group;
}

interface FieldCar {
  root: THREE.Group;
  wheels: WheelNode[];
  rings: THREE.Mesh[];
  casters: THREE.Mesh[];
  shadowOn: boolean;
  compound: number;
  spin: number;
}

interface Parts {
  body: THREE.Group;
  driver: THREE.Group | null;
  wheel: THREE.Group[];
  surfaces: Map<THREE.Material, SurfaceOptions>;
}

const scratch = new THREE.Matrix4();

function paintTeam(
  object: THREE.Object3D,
  paint: (material: THREE.Material) => THREE.Material,
): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh)
      child.material = paint(child.material as THREE.Material);
  });
}

async function loadParts(
  assets: SdAssets,
  lighting: SdLighting,
  info: CarInfo,
): Promise<Parts> {
  const surfaces = new Map<THREE.Material, SurfaceOptions>();
  const carDir = `cars/models/${info.name}/`;
  const searchPath = [carDir, "data/objects/", "data/textures/"];
  const shaded = (options: SurfaceOptions) => {
    const material = lighting.carShader(options);
    surfaces.set(material, options);
    return material;
  };
  const flat = (options: SurfaceOptions) => lighting.shadowMapped(options);
  const wheelFile = (prefix: string, j: number) =>
    assets.find(`${prefix}${String(j)}.acc`, searchPath) ?? "";
  const driverFile = info.drivers[0]?.model;
  const [body, driver, slow, fast] = await Promise.all([
    assets.model(`${carDir}${info.name}.acc`, {
      car: true,
      searchPath,
      material: shaded,
    }),
    driverFile
      ? assets.model(`${carDir}${driverFile}`, {
          car: true,
          searchPath,
          material: flat,
        })
      : null,
    assets.model(wheelFile(info.frontWheel, 0), {
      car: true,
      searchPath,
      material: flat,
    }),
    assets.model(wheelFile(info.frontWheel, 3), {
      car: true,
      searchPath,
      material: flat,
    }),
  ]);
  return { body, driver, wheel: [slow, fast], surfaces };
}

export class FieldCars {
  readonly root = new THREE.Group();
  private readonly cars: FieldCar[] = [];
  private readonly ringMaterials: THREE.Material[];
  private readonly eye = new THREE.Vector3();

  private constructor(
    private readonly lighting: SdLighting,
    private readonly info: CarInfo,
  ) {
    this.ringMaterials = compounds.map((compound) =>
      lighting.unlit(new THREE.Color(compound.colour)),
    );
  }

  static async load(
    assets: SdAssets,
    lighting: SdLighting,
    info: CarInfo,
    colours: string[],
  ): Promise<FieldCars> {
    const field = new FieldCars(lighting, info);
    const parts = await loadParts(assets, lighting, info);
    const palette = new Map<string, Map<THREE.Material, THREE.Material>>();
    for (const colour of colours) {
      const cache =
        palette.get(colour) ?? new Map<THREE.Material, THREE.Material>();
      palette.set(colour, cache);
      field.cars.push(field.build(parts, colour, cache));
    }
    return field;
  }

  private build(
    parts: Parts,
    colour: string,
    cache: Map<THREE.Material, THREE.Material>,
  ): FieldCar {
    const root = matrix();
    root.visible = false;
    const body = parts.body.clone();
    const team = new THREE.Color(colour);
    paintTeam(body, (material) => {
      const surface = parts.surfaces.get(material);
      if (!surface) return material;
      let painted = cache.get(material);
      if (!painted) {
        painted = this.lighting.carShader({ ...surface, team });
        cache.set(material, painted);
      }
      return painted;
    });
    root.add(body);
    const placement = this.info.drivers[0];
    if (parts.driver && placement) {
      const driver = parts.driver.clone();
      const seat = matrix();
      seat.matrix.makeTranslation(
        placement.xpos,
        placement.ypos,
        placement.zpos,
      );
      seat.add(driver);
      root.add(seat);
    }
    const rings: THREE.Mesh[] = [];
    const wheels = Array.from({ length: wheelCount }, (_, i) =>
      this.buildWheel(parts, i, root, rings),
    );
    const casters: THREE.Mesh[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (object.type === "Mesh" && !rings.includes(mesh)) casters.push(mesh);
    });
    this.root.add(root);
    return {
      root,
      wheels,
      rings,
      casters,
      shadowOn: false,
      compound: -1,
      spin: 0,
    };
  }

  private buildWheel(
    parts: Parts,
    index: number,
    root: THREE.Group,
    rings: THREE.Mesh[],
  ): WheelNode {
    const diameter = (this.info.wheelRadius[index] ?? 0.33) * 2;
    const width = this.info.tireWidth[index] ?? 0.3;
    const sized = matrix();
    sized.matrix.makeScale(diameter, width, diameter);
    if (index === 0 || index === 2)
      sized.matrix.premultiply(scratch.makeRotationZ(Math.PI));
    parts.wheel.forEach((model, variant) => {
      const copy = model.clone();
      copy.visible = variant === 0;
      sized.add(copy);
    });
    const spin = matrix();
    spin.add(sized);
    const pivot = matrix();
    pivot.add(spin);
    const ring = new THREE.TorusGeometry(
      (this.info.wheelRadius[index] ?? 0.33) * sidewallRadius,
      0.012,
      5,
      28,
    );
    ring.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(ring, this.ringMaterials[1]);
      mesh.position.set(0, (side * width) / 2, 0);
      pivot.add(mesh);
      rings.push(mesh);
    }
    root.add(pivot);
    return { pivot, spin };
  }

  private updateWheels(car: FieldCar, data: Float64Array, at: number): void {
    const speed = Math.abs(data[at + carField.speed] ?? 0);
    car.spin += speed * 0.05;
    const blurred = speed > spinBlur;
    car.wheels.forEach((wheel, i) => {
      const w = (k: number) => data[at + wheelsFrom + i * wheelFields + k] ?? 0;
      wheel.spin.matrix.makeRotationY(w(4));
      wheel.pivot.matrix
        .makeTranslation(w(0), w(1), w(2))
        .multiply(scratch.makeRotationZ(w(5)));
      wheel.pivot.matrix.multiply(scratch.makeRotationX(w(3)));
      const sized = wheel.spin.children[0];
      sized?.children.forEach((child, variant) => {
        child.visible = (variant === 1) === blurred;
      });
    });
  }

  private setCompound(car: FieldCar, compound: number): void {
    if (compound === car.compound) return;
    car.compound = compound;
    const material = this.ringMaterials[compound] ?? this.ringMaterials[1];
    if (!material) return;
    for (const ring of car.rings) ring.material = material;
  }

  private setShadow(car: FieldCar, on: boolean): void {
    if (car.shadowOn === on) return;
    car.shadowOn = on;
    for (const mesh of car.casters) mesh.castShadow = on;
  }

  update(data: Float64Array, camera: THREE.Camera): void {
    this.eye.setFromMatrixPosition(camera.matrixWorld);
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
      car.root.matrix.fromArray(data, at);
      car.root.matrix.elements[14] -= groundSink;
      car.root.matrixWorldNeedsUpdate = true;
      this.setShadow(car, distance < shadowDistance);
      this.setCompound(car, data[at + carField.compound] ?? 1);
      if (distance < wheelDistance) this.updateWheels(car, data, at);
    });
  }
}
