import * as THREE from "three/webgpu";
import { carField, carStride, type CarTiming } from "./engine.ts";
import { putData, putStyle, putText } from "./hud-dom.ts";
import { surname } from "./tower.ts";
import type { Entrant } from "./weekend.ts";

const nearest = 7;
const farthest = 150;
const fadeFrom = 105;
const lift = 1.2;
const shown = 6;

interface Tag {
  root: HTMLElement;
  position: HTMLElement;
}

interface Candidate {
  car: number;
  distance: number;
  x: number;
  y: number;
}

export class CarTags {
  private readonly tags: Tag[];
  private readonly view = new THREE.Matrix4();
  private readonly point = new THREE.Vector4();
  private readonly eye = new THREE.Vector3();
  private readonly spot = new THREE.Vector3();
  private positions = new Map<number, number>();

  constructor(
    private readonly root: HTMLElement,
    private readonly field: Entrant[],
  ) {
    this.tags = field.map((entrant) => {
      const tag = document.createElement("div");
      tag.className = "car-tag";
      tag.style.setProperty("--team", entrant.colour);
      const inner = document.createElement("div");
      const position = document.createElement("b");
      const bar = document.createElement("i");
      const name = document.createElement("span");
      name.textContent = surname(entrant);
      inner.append(position, bar, name);
      tag.append(inner);
      putData(tag, "on", "");
      root.append(tag);
      return { root: tag, position };
    });
  }

  timing(rows: CarTiming[]): void {
    this.positions = new Map(rows.map((row) => [row.index, row.position]));
  }

  update(cars: Float64Array | null, camera: THREE.Camera): void {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const picked = cars ? this.pick(cars, camera, width, height) : [];
    const keep = new Set(picked.map((c) => c.car));
    this.tags.forEach((tag, car) => {
      if (!keep.has(car)) putData(tag.root, "on", "");
    });
    for (const candidate of picked) this.place(candidate);
  }

  private pick(
    cars: Float64Array,
    camera: THREE.Camera,
    width: number,
    height: number,
  ): Candidate[] {
    this.view.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const found: Candidate[] = [];
    for (let car = 1; car < this.field.length; car++) {
      const seen = this.project(cars, car, width, height);
      if (seen) found.push(seen);
    }
    return found.sort((a, b) => a.distance - b.distance).slice(0, shown);
  }

  private project(
    cars: Float64Array,
    car: number,
    width: number,
    height: number,
  ): Candidate | null {
    const at = car * carStride;
    if (cars[at + carField.visible] === 0) return null;
    const [x = 0, y = 0, z = 0] = cars.subarray(at + 12, at + 15);
    const distance = this.eye.distanceTo(this.spot.set(x, y, z + lift));
    if (distance < nearest || distance > farthest) return null;
    return this.onScreen(car, distance, width, height);
  }

  private onScreen(
    car: number,
    distance: number,
    width: number,
    height: number,
  ): Candidate | null {
    const { x, y, z } = this.spot;
    this.point.set(x, y, z, 1).applyMatrix4(this.view);
    if (this.point.w <= 0) return null;
    const sx = (this.point.x / this.point.w + 1) * 0.5 * width;
    const sy = (1 - this.point.y / this.point.w) * 0.5 * height;
    const inside = sx >= 0 && sx <= width && sy >= 0 && sy <= height;
    return inside ? { car, distance, x: sx, y: sy } : null;
  }

  private place(candidate: Candidate): void {
    const tag = this.tags[candidate.car];
    if (!tag) return;
    const fade = Math.min(
      1,
      Math.max(0, (farthest - candidate.distance) / (farthest - fadeFrom)),
    );
    putData(tag.root, "on", "1");
    putText(
      tag.position,
      String(this.positions.get(candidate.car) ?? candidate.car + 1),
    );
    putStyle(
      tag.root,
      "transform",
      `translate(${candidate.x.toFixed(1)}px, ${candidate.y.toFixed(1)}px)`,
    );
    putStyle(tag.root, "opacity", fade.toFixed(2));
  }
}
