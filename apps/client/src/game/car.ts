import * as THREE from "three/webgpu";
import { frameIndex } from "./engine.ts";
import type { SdLighting } from "./materials.ts";
import type { SdAssets } from "./models.ts";

const deg = Math.PI / 180;
const wheelMaxVel = [20.0, 40.0, 70.0];
const driverSteer = [0.03, 0.07, 0.13, 0.21, 0.3, 0.45, 0.7];

export interface Placement {
  model: string;
  xpos: number;
  ypos: number;
  zpos: number;
  angle: number;
}

interface Gauge extends Placement {
  factor: number;
  minAngle: number;
}

export interface CarInfo {
  name: string;
  wheelRadius: number[];
  tireWidth: number[];
  brakeDiskRadius: number[];
  steerWheelRot: number;
  steerWheel: Placement | null;
  drivers: Placement[];
  speedometer: Gauge | null;
  tachometer: Gauge | null;
  frontWheel: string;
  rearWheel: string;
}

function driverIndex(steerangle: number, count: number): number {
  const bins = count > 14 ? driverSteer.length : driverSteer.length - 1;
  const magnitude = Math.abs(steerangle);
  if (magnitude <= 0.03) return 0;
  const limits = driverSteer.slice(1, bins);
  const found = limits.findIndex((limit) => magnitude <= limit);
  const bin = found < 0 ? bins : found + 1;
  return steerangle > 0 ? bin : bins + bin;
}

function wheelVariant(spinVel: number): number {
  let j = 0;
  for (; j < 3; j++) if (Math.abs(spinVel) < (wheelMaxVel[j] ?? 0)) break;
  return j;
}

function brake(
  lighting: SdLighting,
  wheelIndex: number,
  tireWidth: number,
  brakeDiskRadius: number,
) {
  const brakeBranch = 32;
  const brakeAngle = (2.0 * Math.PI) / brakeBranch;
  const brakeOffset = 0.1;
  const right = wheelIndex === 0 || wheelIndex === 2;
  const front = wheelIndex < 2;
  const curAngle = front
    ? -(Math.PI / 2.0 + brakeAngle)
    : Math.PI / 2.0 - brakeAngle;
  const bOffset = right
    ? brakeOffset - tireWidth / 2.0
    : tireWidth / 2.0 - brakeOffset;
  const group = new THREE.Group();
  const add = (vertices: number[], indices: number[], color: THREE.Color) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    const material = lighting.unlit(color);
    group.add(new THREE.Mesh(geometry, material));
    return color;
  };
  const strip = (count: number) => {
    const indices: number[] = [];
    for (let i = 2; i < count; i++)
      indices.push(...(i % 2 === 1 ? [i - 2, i, i - 1] : [i - 2, i - 1, i]));
    return indices;
  };

  const hubRadius = brakeDiskRadius * 0.6;
  const hub = [0, bOffset, 0];
  for (let i = 0; i < brakeBranch; i++) {
    const alpha = Math.fround((i * 2.0 * Math.PI) / (brakeBranch - 1));
    hub.push(hubRadius * Math.cos(alpha), bOffset, hubRadius * Math.sin(alpha));
  }
  const hubIndices: number[] = [];
  for (let i = 1; i + 1 < hub.length / 3; i++) hubIndices.push(0, i, i + 1);
  add(hub, hubIndices, new THREE.Color(0, 0, 0));

  const disc: number[] = [];
  for (let i = 0; i < brakeBranch / 2 + 2; i++) {
    const alpha = curAngle + (i * 2.0 * Math.PI) / (brakeBranch - 1);
    disc.push(
      brakeDiskRadius * Math.cos(alpha),
      bOffset,
      brakeDiskRadius * Math.sin(alpha),
    );
    disc.push(
      brakeDiskRadius * Math.cos(alpha) * 0.6,
      bOffset,
      brakeDiskRadius * Math.sin(alpha) * 0.6,
    );
  }
  const discColor = add(
    disc,
    strip(disc.length / 3),
    new THREE.Color(0.1, 0.1, 0.1),
  );

  const caliper: number[] = [];
  for (let i = 0; i < brakeBranch / 2 - 2; i++) {
    const alpha = -curAngle + (i * 2.0 * Math.PI) / (brakeBranch - 1);
    caliper.push(
      (brakeDiskRadius + 0.02) * Math.cos(alpha),
      bOffset,
      (brakeDiskRadius + 0.02) * Math.sin(alpha),
    );
    caliper.push(
      brakeDiskRadius * Math.cos(alpha) * 0.6,
      bOffset,
      brakeDiskRadius * Math.sin(alpha) * 0.6,
    );
  }
  add(caliper, strip(caliper.length / 3), new THREE.Color(0.2, 0.2, 0.2));
  return { group, discColor };
}

interface Wheel {
  transform2: THREE.Object3D;
  transform1: THREE.Object3D;
  variants: THREE.Object3D[];
  discColor: THREE.Color;
}

const matrix = () => {
  const object = new THREE.Group();
  object.matrixAutoUpdate = false;
  return object;
};

export class SdCar {
  readonly root = matrix();
  private readonly wheels: Wheel[] = [];
  private readonly drivers: THREE.Object3D[] = [];
  private readonly driverLocs: THREE.Object3D[] = [];
  private readonly steerRot = matrix();
  private readonly speedometerRot = matrix();
  private readonly tachometerRot = matrix();
  private readonly scratch = new THREE.Matrix4();

  private constructor(private readonly info: CarInfo) {}

  static async load(
    assets: SdAssets,
    lighting: SdLighting,
    info: CarInfo,
  ): Promise<SdCar> {
    const car = new SdCar(info);
    const carDir = `cars/models/${info.name}/`;
    const searchPath = [
      "drivers/human/0/",
      carDir,
      "data/objects/",
      "data/textures/",
    ];
    const model = (file: string, shaded = false) =>
      assets.model(file, {
        car: true,
        searchPath,
        material: (options) =>
          shaded ? lighting.carShader(options) : lighting.shadowMapped(options),
      });
    const optional = (placement: Placement | null) =>
      placement ? model(`${carDir}${placement.model}`) : null;
    const wheelFile = (prefix: string, j: number) =>
      assets.find(`${prefix}${String(j)}.acc`, searchPath) ?? "";
    const wheelSet = (prefix: string) =>
      Promise.all([0, 1, 2, 3].map((j) => model(wheelFile(prefix, j))));

    const [body, steer, speedometer, tachometer, drivers, front, rear] =
      await Promise.all([
        model(`${carDir}${info.name}.acc`, true),
        optional(info.steerWheel),
        optional(info.speedometer),
        optional(info.tachometer),
        Promise.all(
          info.drivers.map((driver) => model(`${carDir}${driver.model}`)),
        ),
        wheelSet(info.frontWheel),
        wheelSet(info.rearWheel),
      ]);

    car.root.add(body);
    car.addDrivers(drivers);
    if (steer && info.steerWheel)
      car.addPlaced(car.steerRot, info.steerWheel, steer);
    if (speedometer && info.speedometer)
      car.addPlaced(car.speedometerRot, info.speedometer, speedometer);
    if (tachometer && info.tachometer)
      car.addPlaced(car.tachometerRot, info.tachometer, tachometer);
    for (let i = 0; i < 4; i++) car.addWheel(lighting, i, i < 2 ? front : rear);
    return car;
  }

  private addDrivers(drivers: THREE.Object3D[]): void {
    drivers.forEach((driver, i) => {
      const placement = this.info.drivers[i];
      if (!placement) return;
      const driverLoc = matrix();
      driverLoc.matrix.makeTranslation(
        placement.xpos,
        placement.ypos,
        placement.zpos,
      );
      driver.visible = false;
      driverLoc.add(driver);
      this.drivers.push(driver);
      this.driverLocs.push(driverLoc);
      this.root.add(driverLoc);
    });
  }

  private addPlaced(
    rotation: THREE.Object3D,
    placement: Placement,
    model: THREE.Object3D,
  ): void {
    const branch = matrix();
    branch.matrix
      .makeTranslation(placement.xpos, placement.ypos, placement.zpos)
      .multiply(new THREE.Matrix4().makeRotationY(placement.angle * deg));
    rotation.add(model);
    branch.add(rotation);
    this.root.add(branch);
  }

  private addWheel(
    lighting: SdLighting,
    i: number,
    models: THREE.Object3D[],
  ): void {
    const dia = (this.info.wheelRadius[i] ?? 0) * 2;
    const width = this.info.tireWidth[i] ?? 0;
    const whlsize = matrix();
    whlsize.matrix.makeScale(dia, width, dia);
    const variants = models.map((model) => {
      const clone = model.clone();
      clone.visible = false;
      whlsize.add(clone);
      return clone;
    });
    let sized: THREE.Object3D = whlsize;
    if (i === 0 || i === 2) {
      const flip = matrix();
      flip.matrix.makeRotationZ(Math.PI);
      flip.add(whlsize);
      sized = flip;
    }
    const transform1 = matrix();
    transform1.add(sized);
    const transform2 = matrix();
    transform2.add(transform1);
    const { group, discColor } = brake(
      lighting,
      i,
      width,
      this.info.brakeDiskRadius[i] ?? 0,
    );
    transform2.add(group);
    this.root.add(transform2);
    this.wheels.push({ transform2, transform1, variants, discColor });
  }

  setDraw(current: boolean, driver: boolean): void {
    this.root.visible = current;
    for (const loc of this.driverLocs) loc.visible = driver;
  }

  update(frame: Float64Array): void {
    const at = (index: number) => frame[index] ?? 0;
    this.root.matrix.fromArray(frame, frameIndex.posMat);
    this.root.matrixWorldNeedsUpdate = true;

    const steerangle = Math.fround(at(frameIndex.steer));
    const selected = driverIndex(steerangle, this.drivers.length);
    this.drivers.forEach((driver, i) => (driver.visible = i === selected));

    const { speedometer, tachometer } = this.info;
    if (speedometer)
      this.speedometerRot.matrix.makeRotationX(
        (speedometer.minAngle +
          Math.abs(at(frameIndex.speed)) * speedometer.factor) *
          deg,
      );
    if (tachometer)
      this.tachometerRot.matrix.makeRotationX(
        (tachometer.minAngle + at(frameIndex.rpm) * tachometer.factor) * deg,
      );
    this.steerRot.matrix.makeRotationX(-steerangle * this.info.steerWheelRot);

    this.wheels.forEach((wheel, i) => {
      const w = (k: number) => at(frameIndex.wheels + i * 7 + k);
      wheel.transform1.matrix.makeRotationY(w(4));
      wheel.transform2.matrix
        .makeTranslation(w(0), w(1), w(2))
        .multiply(this.scratch.makeRotationZ(w(5)))
        .multiply(this.scratch.clone().makeRotationX(w(3)));
      const variant = wheelVariant(w(6));
      wheel.variants.forEach((v, j) => (v.visible = j === variant));
      const temp = at(frameIndex.brakeTemp + i);
      wheel.discColor.setRGB(
        0.1 + temp * 1.5,
        0.1 + temp * 0.3,
        0.1 - temp * 0.3,
      );
    });
    this.root.updateMatrixWorld(true);
  }
}
