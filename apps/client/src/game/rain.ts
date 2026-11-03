import * as THREE from "three/webgpu";
import {
  attribute,
  cross,
  float,
  fract,
  instancedBufferAttribute,
  length,
  max,
  mix,
  normalize,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { carField, carStride, frameIndex } from "./engine.ts";

const dropCount = 14000;
const boxSize = new THREE.Vector3(36, 36, 18);
const fallSpeed = 9.5;
const windDrift = new THREE.Vector3(0.6, 0.3, 0);
const streakShutter = 1 / 55;
const streakMinimum = 0.35;
const streakMaximum = 2.6;
const streakWidth = 0.0085;
const streakBrightness = 1.0;
const lightRainShare = 0.25;
const sprayCapacity = 1400;
const sprayStartSpeed = 5;
const sprayFullSpeed = 45;
const sprayRate = 70;
const sprayLife = 0.85;
const sprayStartSize = 0.9;
const sprayPeakSize = 7.5;
const sprayOpacity = 0.17;
const sprayCarry = 0.55;
const sprayRise = 1.6;
const spraySpread = 1.4;
const sprayBehind = -2.3;
const sprayHeight = 0.35;
const sprayHalfTrack = 0.7;
const sprayWaterFloor = 0.04;
const drawReach = 260;

export interface RainState {
  rain: number;
  water: number;
}

interface Puff {
  age: number;
  life: number;
  size: number;
  alpha: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

interface Tracked {
  x: number;
  y: number;
  owed: number;
}

function streakGeometry(): THREE.BufferGeometry {
  const seeds = new Float32Array(dropCount * 4 * 3);
  const corners = new Float32Array(dropCount * 4 * 2);
  const index = new Uint32Array(dropCount * 6);
  const corner = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (let i = 0; i < dropCount; i++) {
    const seed = [Math.random(), Math.random(), Math.random()];
    for (let k = 0; k < 4; k++) {
      seeds.set(seed, (i * 4 + k) * 3);
      corners.set(corner[k] ?? [0, 0], (i * 4 + k) * 2);
    }
    index.set(
      [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3],
      i * 6,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute("corner", new THREE.BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

export class RainStreaks {
  readonly mesh: THREE.Mesh;
  private readonly time = uniform(0);
  private readonly eye = uniform(new THREE.Vector3());
  private readonly relative = uniform(new THREE.Vector3(0, 0, -fallSpeed));
  private readonly brightness = uniform(new THREE.Color());
  private readonly previousEye = new THREE.Vector3();
  private readonly eyeVelocity = new THREE.Vector3();
  private lastTime: number | null = null;

  constructor() {
    const geometry = streakGeometry();
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const seed = attribute<"vec3">("position", "vec3");
    const corner = attribute<"vec2">("corner", "vec2");
    const size = vec3(boxSize.x, boxSize.y, boxSize.z);
    const fall = vec3(windDrift.x, windDrift.y, -fallSpeed);
    const drifted = seed.mul(size).add(fall.mul(this.time)).sub(this.eye);
    const local = fract(drifted.div(size)).sub(0.5).mul(size);
    const centre = this.eye.add(local);
    const motion = this.relative.mul(streakShutter);
    const span = max(length(motion), streakMinimum);
    const along = normalize(motion).mul(span.min(streakMaximum));
    const toEye = normalize(this.eye.sub(centre));
    const side = normalize(cross(along, toEye)).mul(streakWidth);
    material.positionNode = centre
      .add(along.mul(corner.y.sub(0.5)))
      .add(side.mul(corner.x.sub(0.5).mul(2)));
    const across = float(1).sub(corner.x.sub(0.5).abs().mul(2));
    const fadeEnds = smoothstep(0, 0.35, corner.y).mul(
      smoothstep(1, 0.65, corner.y),
    );
    const distance = length(local);
    const near = smoothstep(boxSize.z * 0.95, 2.5, distance);
    material.colorNode = vec4(this.brightness, 1);
    material.opacityNode = across
      .mul(fadeEnds)
      .mul(near)
      .mul(float(streakMinimum).div(span).sqrt().min(1));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  update(
    rain: number,
    eye: THREE.Vector3,
    time: number,
    light: THREE.Color,
  ): void {
    const dt =
      this.lastTime === null
        ? 0
        : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    if (dt > 0)
      this.eyeVelocity.subVectors(eye, this.previousEye).divideScalar(dt);
    this.previousEye.copy(eye);
    const count = Math.round(
      dropCount * Math.min(1, lightRainShare + (1 - lightRainShare) * rain),
    );
    const shown = rain > 0.01;
    this.mesh.visible = shown;
    if (!shown) return;
    this.mesh.geometry.setDrawRange(0, count * 6);
    this.time.value = time;
    this.eye.value.copy(eye);
    this.relative.value
      .set(windDrift.x, windDrift.y, -fallSpeed)
      .sub(this.eyeVelocity);
    this.brightness.value
      .copy(light)
      .multiplyScalar(streakBrightness * Math.min(1, 0.4 + rain));
  }
}

export class Spray {
  readonly root: THREE.Mesh;
  private readonly puffs: (Puff | undefined)[] = [];
  private readonly centre: THREE.InstancedBufferAttribute;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly tint = uniform(new THREE.Color());
  private readonly tracked = new Map<number, Tracked>();
  private readonly matrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private cursor = 0;
  private lastTime: number | null = null;

  constructor() {
    this.centre = new THREE.InstancedBufferAttribute(
      new Float32Array(sprayCapacity * 4),
      4,
    );
    this.fade = new THREE.InstancedBufferAttribute(
      new Float32Array(sprayCapacity),
      1,
    );
    const material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    const centre = instancedBufferAttribute(this.centre, "vec4" as const);
    const fade = instancedBufferAttribute(this.fade, "float" as const);
    const radial = length(uv().sub(float(0.5)));
    const soft = smoothstep(float(0.5), float(0.05), radial);
    material.positionNode = vec3(centre.x, centre.y, centre.z);
    material.scaleNode = centre.w;
    material.colorNode = vec4(mix(this.tint, this.tint.mul(1.15), soft), 1);
    material.opacityNode = fade.mul(soft.mul(soft));
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      material,
      sprayCapacity,
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.root = mesh;
  }

  update(
    time: number,
    state: RainState,
    player: Float64Array,
    cars: Float64Array | null,
    eye: THREE.Vector3,
    light: THREE.Color,
  ): void {
    const dt =
      this.lastTime === null
        ? 0
        : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    this.tint.value.copy(light);
    if (dt <= 0) return;
    const wet = Math.max(0, state.water - sprayWaterFloor);
    this.emit(
      0,
      player,
      frameIndex.posMat,
      player[frameIndex.speed] ?? 0,
      wet,
      dt,
      eye,
    );
    if (cars) {
      const count = Math.floor(cars.length / carStride);
      for (let i = 1; i < count; i++) {
        const base = i * carStride;
        if ((cars[base + carField.visible] ?? 0) === 0) continue;
        this.emit(
          i,
          cars,
          base,
          cars[base + carField.speed] ?? 0,
          wet,
          dt,
          eye,
        );
      }
    }
    this.advance(dt);
  }

  private emit(
    id: number,
    source: Float64Array,
    offset: number,
    speed: number,
    wet: number,
    dt: number,
    eye: THREE.Vector3,
  ): void {
    this.matrix.fromArray(source, offset);
    const [, , , , , , , , , , , , x, y] = this.matrix.elements;
    const previous = this.tracked.get(id) ?? { x, y, owed: 0 };
    const vx = (x - previous.x) / dt;
    const vy = (y - previous.y) / dt;
    previous.x = x;
    previous.y = y;
    this.tracked.set(id, previous);
    const pace = Math.max(
      0,
      Math.min(
        1,
        (speed - sprayStartSpeed) / (sprayFullSpeed - sprayStartSpeed),
      ),
    );
    const far = Math.hypot(x - eye.x, y - eye.y) > drawReach;
    if (wet <= 0 || pace <= 0 || far || Math.hypot(vx, vy) > 150) {
      previous.owed = 0;
      return;
    }
    const strength = Math.min(1, wet * 2.2) * pace;
    previous.owed += sprayRate * strength * dt;
    while (previous.owed >= 1) {
      previous.owed -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.point
        .set(
          sprayBehind - Math.random() * 0.6,
          side * sprayHalfTrack * (0.6 + Math.random() * 0.5),
          sprayHeight,
        )
        .applyMatrix4(this.matrix);
      const spread = () => (Math.random() - 0.5) * spraySpread * 2;
      this.puffs[this.cursor] = {
        age: 0,
        life: sprayLife * (0.7 + Math.random() * 0.6),
        size: sprayPeakSize * (0.6 + 0.4 * pace) * (0.75 + Math.random() * 0.5),
        alpha: sprayOpacity * (0.45 + 0.55 * strength),
        x: this.point.x,
        y: this.point.y,
        z: this.point.z,
        vx: vx * sprayCarry + spread(),
        vy: vy * sprayCarry + spread(),
        vz: sprayRise * (0.4 + Math.random()),
      };
      this.cursor = (this.cursor + 1) % sprayCapacity;
    }
  }

  private advance(dt: number): void {
    const centre = this.centre.array as Float32Array;
    const fade = this.fade.array as Float32Array;
    let alive = false;
    for (let i = 0; i < sprayCapacity; i++) {
      const puff = this.puffs[i];
      if (!puff || puff.age >= puff.life) {
        centre[i * 4 + 3] = 0;
        fade[i] = 0;
        continue;
      }
      alive = true;
      puff.age += dt;
      const drag = Math.exp(-2.4 * dt);
      puff.vx *= drag;
      puff.vy *= drag;
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.z += puff.vz * dt;
      const t = Math.min(1, puff.age / puff.life);
      centre[i * 4] = puff.x;
      centre[i * 4 + 1] = puff.y;
      centre[i * 4 + 2] = puff.z;
      centre[i * 4 + 3] =
        sprayStartSize + (puff.size - sprayStartSize) * Math.sqrt(t);
      fade[i] = puff.alpha * (1 - t) * Math.min(1, t * 10);
    }
    this.root.visible = alive;
    if (!alive) return;
    this.centre.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}
