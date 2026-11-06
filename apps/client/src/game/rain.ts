import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  cross,
  float,
  fract,
  instancedBufferAttribute,
  length,
  max,
  mix,
  normalize,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { carField, carStride, frameIndex } from "./engine.ts";
import { keepMirrorMask } from "./mirror-mask.ts";

export interface StreakLayer {
  count: number;
  box: THREE.Vector3;
  minimum: number;
  maximum: number;
  pixelWidth: number;
  nearFrom: number;
  nearTo: number;
  brightness: number;
}

export const nearRain: StreakLayer = {
  count: 9000,
  box: new THREE.Vector3(36, 36, 18),
  minimum: 0.45,
  maximum: 1.6,
  pixelWidth: 0.0011,
  nearFrom: 1.2,
  nearTo: 6,
  brightness: 0.16,
};

export const farRain: StreakLayer = {
  count: 7000,
  box: new THREE.Vector3(170, 170, 70),
  minimum: 2.6,
  maximum: 5,
  pixelWidth: 0.0013,
  nearFrom: 14,
  nearTo: 30,
  brightness: 0.24,
};

const fallSpeed = 9.5;
const windDrift = new THREE.Vector3(0.6, 0.3, 0);
const streakShutter = 1 / 55;
const eyeShare = 0.18;
const lightRainShare = 0.25;
const sprayCapacity = 3600;
const sprayStartSpeed = 8;
const sprayFullSpeed = 55;
const sprayRate = 36;
const sprayLife = 1.3;
const sprayStartSize = 0.8;
const sprayPeakSize = 7;
const sprayOpacity = 0.34;
const sprayCarry = 0.42;
const sprayRise = 1.6;
const spraySpread = 1.1;
const sprayDrag = 1.6;
const sprayLift = 0.2;
const sprayNearFrom = 1.6;
const sprayNearTo = 9;
const sprayWaterFloor = 0.04;
const sprayTexture = 64;
const sprayEmitters = [
  [-2.05, -0.74, 0.34],
  [-2.05, 0.74, 0.34],
  [-2.75, 0, 0.5],
] as const;
const drawReach = 260;
const jetRate = 64;
const mistRate = 44;
const mistLife = 0.32;
const mistStartSize = 0.3;
const mistPeakSize = 0.8;
const mistOpacity = 0.42;
const mistCarry = 0.94;
const mistRise = 1.2;
const mistAhead = 0.95;
const mistBehind = 0.35;
const mistTrack = 0.74;
const mistSpread = 0.15;
const mistHeight = 0.3;
const mistRiseSpread = 0.25;
const mistNear = 0.5;
const ownMistRate = 1.5;
const ownMistOpacity = 0.48;
const ownMistNear = 0.3;
const spritePull = 0.5;
const spritePullReach = 0.35;
const jetLife = 0.75;
const jetStartSize = 0.35;
const jetPeakSize = 3.4;
const jetOpacity = 0.9;
const jetCarry = 0.86;
const jetRise = 4;
const jetBehind = -2.15;
const jetTrack = 0.74;
const jetHeight = 0.3;
const jetNear = 0.6;
const ownNear = 2.5;
export interface RainState {
  rain: number;
  water: number;
}

interface Puff {
  age: number;
  life: number;
  start: number;
  size: number;
  alpha: number;
  spin: number;
  turn: number;
  near: number;
  drag: number;
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
  jets: number;
  mist: number;
}

function streakGeometry(dropCount: number): THREE.BufferGeometry {
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

  constructor(private readonly layer: StreakLayer) {
    const { box } = layer;
    const geometry = streakGeometry(layer.count);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    keepMirrorMask(material, true);
    const seed = attribute<"vec3">("position", "vec3");
    const corner = attribute<"vec2">("corner", "vec2");
    const size = vec3(box.x, box.y, box.z);
    const fall = vec3(windDrift.x, windDrift.y, -fallSpeed);
    const drifted = seed.mul(size).add(fall.mul(this.time)).sub(this.eye);
    const local = fract(drifted.div(size)).sub(0.5).mul(size);
    const centre = this.eye.add(local);
    const distance = length(local);
    const motion = this.relative.mul(streakShutter);
    const span = max(length(motion), layer.minimum);
    const along = normalize(motion).mul(span.min(layer.maximum));
    const toEye = normalize(this.eye.sub(centre));
    const side = normalize(cross(along, toEye)).mul(
      distance.mul(layer.pixelWidth),
    );
    material.positionNode = centre
      .add(along.mul(corner.y.sub(0.5)))
      .add(side.mul(corner.x.sub(0.5).mul(2)));
    const across = float(1).sub(corner.x.sub(0.5).abs().mul(2));
    const fadeEnds = smoothstep(0, 0.35, corner.y).mul(
      smoothstep(1, 0.65, corner.y),
    );
    const near = smoothstep(layer.nearFrom, layer.nearTo, distance).mul(
      smoothstep(box.z * 0.95, box.z * 0.6, distance),
    );
    material.colorNode = vec4(this.brightness, 1);
    material.opacityNode = across
      .mul(fadeEnds)
      .mul(near)
      .mul(float(layer.minimum).div(span).sqrt().min(1));
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
      this.layer.count *
        Math.min(1, lightRainShare + (1 - lightRainShare) * rain),
    );
    const shown = rain > 0.01;
    this.mesh.visible = shown;
    if (!shown) return;
    this.mesh.geometry.setDrawRange(0, count * 6);
    this.time.value = time;
    this.eye.value.copy(eye);
    this.relative.value
      .set(windDrift.x, windDrift.y, -fallSpeed)
      .addScaledVector(this.eyeVelocity, -eyeShare);
    this.brightness.value
      .copy(light)
      .multiplyScalar(this.layer.brightness * Math.min(1, 0.4 + rain));
  }
}

function noise(size: number, seed: number): (x: number, y: number) => number {
  const grid = Array.from({ length: size * size }, (_, k) => {
    const v = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
  });
  const at = (x: number, y: number) =>
    grid[(((y % size) + size) % size) * size + (((x % size) + size) % size)] ??
    0;
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

function puffTexture(): THREE.DataTexture {
  const size = sprayTexture;
  const data = new Uint8Array(size * size * 4);
  const octaves = [noise(4, 1), noise(8, 2), noise(16, 3), noise(32, 4)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let cloud = 0;
      let weight = 0.5;
      octaves.forEach((octave, k) => {
        const cells = 4 << k;
        cloud += octave(u * cells, v * cells) * weight;
        weight *= 0.5;
      });
      const radial = Math.hypot(u - 0.5, v - 0.5) * 2;
      const falloff = Math.max(0, 1 - radial);
      const soft = falloff * falloff * (3 - 2 * falloff);
      const value = Math.max(0, Math.min(1, soft * (0.35 + cloud * 1.25)));
      const at = (y * size + x) * 4;
      data[at] = Math.round(value * 255);
      data[at + 1] = data[at];
      data[at + 2] = data[at];
      data[at + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(data, size, size);
  map.colorSpace = THREE.NoColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

export class Spray {
  readonly root: THREE.Mesh;
  private readonly puffs: (Puff | undefined)[] = [];
  private readonly centre: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
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
    this.look = new THREE.InstancedBufferAttribute(
      new Float32Array(sprayCapacity * 3),
      3,
    );
    const material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    keepMirrorMask(material);
    const centre = instancedBufferAttribute(this.centre, "vec4" as const);
    const look = instancedBufferAttribute(this.look, "vec3" as const);
    const puff = texture(puffTexture(), uv()).r;
    const toPuff = centre.xyz.sub(cameraPosition);
    const reach = length(toPuff);
    const near = smoothstep(
      look.z,
      look.z.mul(sprayNearTo / sprayNearFrom),
      reach,
    );
    const pull = centre.w.mul(spritePull).min(reach.mul(spritePullReach));
    const shrink = reach.sub(pull).div(reach);
    material.positionNode = cameraPosition.add(toPuff.mul(shrink));
    material.scaleNode = centre.w.mul(shrink);
    material.rotationNode = look.y;
    material.colorNode = vec4(
      this.tint.mul(mix(float(0.86), float(1.04), uv().y)),
      1,
    );
    material.opacityNode = look.x.mul(puff).mul(near);
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
    const previous = this.tracked.get(id) ?? {
      x,
      y,
      owed: 0,
      jets: 0,
      mist: 0,
    };
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
      previous.jets = 0;
      previous.mist = 0;
      return;
    }
    const strength = Math.min(1, wet * 2.2) * pace;
    this.release(previous, id === 0, vx, vy, pace, strength, dt);
  }

  private release(
    previous: Tracked,
    own: boolean,
    vx: number,
    vy: number,
    pace: number,
    strength: number,
    dt: number,
  ): void {
    previous.mist += mistRate * (own ? ownMistRate : 1) * strength * dt;
    while (previous.mist >= 1) {
      previous.mist -= 1;
      this.tyreMist(vx, vy, strength, own);
    }
    previous.jets += jetRate * strength * dt;
    while (previous.jets >= 1) {
      previous.jets -= 1;
      this.jet(vx, vy, strength, own ? ownNear : jetNear);
    }
    previous.owed += sprayRate * strength * dt;
    while (previous.owed >= 1) {
      previous.owed -= 1;
      this.plume(vx, vy, pace, strength, own ? ownNear : sprayNearFrom);
    }
  }

  private plume(
    vx: number,
    vy: number,
    pace: number,
    strength: number,
    near: number,
  ): void {
    const [ex, ey, ez] =
      sprayEmitters[Math.floor(Math.random() * sprayEmitters.length)] ??
      sprayEmitters[0];
    this.point
      .set(
        ex - Math.random() * 0.5,
        ey + (Math.random() - 0.5) * 0.35,
        ez + Math.random() * 0.2,
      )
      .applyMatrix4(this.matrix);
    const spread = () => (Math.random() - 0.5) * spraySpread * 2;
    this.puffs[this.cursor] = {
      age: 0,
      life: sprayLife * (0.65 + Math.random() * 0.7),
      start: sprayStartSize,
      size: sprayPeakSize * (0.55 + 0.45 * pace) * (0.7 + Math.random() * 0.6),
      alpha: sprayOpacity * (0.45 + 0.55 * strength),
      spin: Math.random() * Math.PI * 2,
      turn: (Math.random() - 0.5) * 0.8,
      near,
      drag: sprayDrag,
      x: this.point.x,
      y: this.point.y,
      z: this.point.z,
      vx: vx * sprayCarry + spread(),
      vy: vy * sprayCarry + spread(),
      vz: sprayRise * (0.5 + Math.random()),
    };
    this.cursor = (this.cursor + 1) % sprayCapacity;
  }

  private tyreMist(
    vx: number,
    vy: number,
    strength: number,
    own: boolean,
  ): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    this.point
      .set(
        mistAhead - Math.random() * mistBehind,
        side * (mistTrack + Math.random() * mistSpread),
        mistHeight + Math.random() * mistRiseSpread,
      )
      .applyMatrix4(this.matrix);
    this.puffs[this.cursor] = {
      age: 0,
      life: mistLife * (0.7 + Math.random() * 0.6),
      start: mistStartSize,
      size: mistPeakSize * (0.7 + Math.random() * 0.6),
      alpha: (own ? ownMistOpacity : mistOpacity) * (0.5 + 0.5 * strength),
      spin: Math.random() * Math.PI * 2,
      turn: (Math.random() - 0.5) * 3,
      near: own ? ownMistNear : mistNear,
      drag: 0,
      x: this.point.x,
      y: this.point.y,
      z: this.point.z,
      vx: vx * mistCarry + (Math.random() - 0.5) * 0.8,
      vy: vy * mistCarry + (Math.random() - 0.5) * 0.8,
      vz: mistRise * (0.6 + Math.random() * 0.8),
    };
    this.cursor = (this.cursor + 1) % sprayCapacity;
  }

  private jet(vx: number, vy: number, strength: number, near: number): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    this.point
      .set(
        jetBehind - Math.random() * 0.3,
        side * jetTrack * (0.85 + Math.random() * 0.3),
        jetHeight,
      )
      .applyMatrix4(this.matrix);
    this.puffs[this.cursor] = {
      age: 0,
      life: jetLife * (0.7 + Math.random() * 0.6),
      start: jetStartSize,
      size: jetPeakSize * (0.75 + Math.random() * 0.5),
      alpha: jetOpacity * (0.5 + 0.5 * strength),
      spin: Math.random() * Math.PI * 2,
      turn: (Math.random() - 0.5) * 2,
      near,
      drag: sprayDrag,
      x: this.point.x,
      y: this.point.y,
      z: this.point.z,
      vx: vx * jetCarry + (Math.random() - 0.5) * 1.2,
      vy: vy * jetCarry + (Math.random() - 0.5) * 1.2,
      vz: jetRise * (0.7 + Math.random() * 0.6),
    };
    this.cursor = (this.cursor + 1) % sprayCapacity;
  }

  private advance(dt: number): void {
    const centre = this.centre.array as Float32Array;
    const look = this.look.array as Float32Array;
    let alive = false;
    for (let i = 0; i < sprayCapacity; i++) {
      const puff = this.puffs[i];
      if (!puff || puff.age >= puff.life) {
        centre[i * 4 + 3] = 0;
        look[i * 3] = 0;
        continue;
      }
      alive = true;
      puff.age += dt;
      const drag = Math.exp(-puff.drag * dt);
      puff.vx *= drag;
      puff.vy *= drag;
      puff.vz *= Math.exp(-0.8 * dt);
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.z += puff.vz * dt;
      puff.spin += puff.turn * dt;
      const t = Math.min(1, puff.age / puff.life);
      const size = puff.start + (puff.size - puff.start) * Math.sqrt(t);
      centre[i * 4] = puff.x;
      centre[i * 4 + 1] = puff.y;
      centre[i * 4 + 2] = puff.z + size * sprayLift;
      centre[i * 4 + 3] = size;
      look[i * 3] = puff.alpha * (1 - t) * (1 - t) * Math.min(1, t * 8);
      look[i * 3 + 1] = puff.spin;
      look[i * 3 + 2] = puff.near;
    }
    this.root.visible = alive;
    if (!alive) return;
    this.centre.needsUpdate = true;
    this.look.needsUpdate = true;
  }
}
