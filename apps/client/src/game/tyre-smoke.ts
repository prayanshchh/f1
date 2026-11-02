import * as THREE from "three/webgpu";
import {
  float,
  instancedBufferAttribute,
  length,
  output,
  renderOutput,
  smoothstep,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { frameIndex } from "./engine.ts";
import {
  puffPeakSize,
  puffsPerSecond,
  puffStartSize,
  smokeIntensity,
  type TyreInfo,
} from "./tyres.ts";

const capacity = 480;
const lifeBase = 0.45;
const lifeGain = 0.75;
const opacityBase = 0.16;
const opacityGain = 0.5;
const carryVelocity = 0.45;
const riseSpeed = 0.5;
const spreadSpeed = 0.5;
const wheelStride = 7;

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

export class TyreSmoke {
  readonly root: THREE.Mesh;
  private readonly puffs: Puff[] = [];
  private readonly centre: THREE.InstancedBufferAttribute;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly matrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private readonly carPosition = new THREE.Vector3();
  private readonly previous = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly owed = [0, 0, 0, 0];
  private cursor = 0;
  private lastTime: number | null = null;

  constructor() {
    this.centre = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    );
    this.fade = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity),
      1,
    );
    const material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    const centre = instancedBufferAttribute(this.centre, "vec4" as const);
    const fade = instancedBufferAttribute(this.fade, "float" as const);
    const soft = smoothstep(
      float(0.5),
      float(0.08),
      length(uv().sub(float(0.5))),
    );
    material.positionNode = vec3(centre.x, centre.y, centre.z);
    material.scaleNode = centre.w;
    material.colorNode = vec4(1, 1, 1, 1);
    material.opacityNode = fade.mul(soft);
    material.outputNode = renderOutput(
      output,
      THREE.NoToneMapping,
      THREE.SRGBColorSpace,
    );
    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.root = mesh;
  }

  update(frame: Float64Array, tyres: TyreInfo, radius: number[]): void {
    const time = frame[frameIndex.time] ?? 0;
    const dt =
      this.lastTime === null
        ? 0
        : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    this.matrix.fromArray(frame, frameIndex.posMat);
    this.carPosition.setFromMatrixPosition(this.matrix);
    if (dt > 0)
      this.velocity
        .subVectors(this.carPosition, this.previous)
        .divideScalar(dt);
    this.previous.copy(this.carPosition);
    if (dt <= 0) return;
    const speed = Math.abs(frame[frameIndex.speed] ?? 0);
    tyres.wheels.forEach((wheel, i) => {
      const rate = puffsPerSecond(wheel.lock, wheel.spin, speed);
      const owed = (this.owed[i] ?? 0) + rate * dt;
      const count = Math.floor(owed);
      this.owed[i] = owed - count;
      const intensity = smokeIntensity(wheel.lock, wheel.spin);
      for (let k = 0; k < count; k++)
        this.spawn(frame, i, radius[i] ?? 0.33, intensity);
    });
    this.advance(dt);
  }

  private spawn(
    frame: Float64Array,
    wheel: number,
    radius: number,
    intensity: number,
  ): void {
    const base = frameIndex.wheels + wheel * wheelStride;
    this.point
      .set(
        frame[base] ?? 0,
        frame[base + 1] ?? 0,
        (frame[base + 2] ?? 0) - radius + 0.1,
      )
      .applyMatrix4(this.matrix);
    const spread = () => (Math.random() - 0.5) * spreadSpeed * 2;
    const puff: Puff = {
      age: 0,
      life: lifeBase + lifeGain * intensity * (0.7 + Math.random() * 0.6),
      size: puffPeakSize(intensity) * (0.75 + Math.random() * 0.5),
      alpha: opacityBase + opacityGain * intensity,
      x: this.point.x,
      y: this.point.y,
      z: this.point.z,
      vx: this.velocity.x * carryVelocity + spread(),
      vy: this.velocity.y * carryVelocity + spread(),
      vz: riseSpeed * (0.6 + Math.random() * 0.8),
    };
    this.puffs[this.cursor] = puff;
    this.cursor = (this.cursor + 1) % capacity;
  }

  private advance(dt: number): void {
    const centre = this.centre.array as Float32Array;
    const fade = this.fade.array as Float32Array;
    let alive = false;
    for (let i = 0; i < capacity; i++) {
      const puff = this.puffs[i];
      if (!puff || puff.age >= puff.life) {
        centre[i * 4 + 3] = 0;
        fade[i] = 0;
        continue;
      }
      alive = true;
      puff.age += dt;
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.z += puff.vz * dt;
      const t = Math.min(1, puff.age / puff.life);
      centre[i * 4] = puff.x;
      centre[i * 4 + 1] = puff.y;
      centre[i * 4 + 2] = puff.z;
      centre[i * 4 + 3] =
        puffStartSize + (puff.size - puffStartSize) * Math.sqrt(t);
      fade[i] = puff.alpha * (1 - t) * Math.min(1, t * 12);
    }
    this.root.visible = alive;
    if (!alive) return;
    this.centre.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}
