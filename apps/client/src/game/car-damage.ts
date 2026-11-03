import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  float,
  instancedBufferAttribute,
  length,
  max,
  mix,
  positionLocal,
  sign,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";

export const damageZone = { none: 0, wingLeft: 1, wingRight: 2, rearWing: 3 };

const partIndex = { wingLeft: 0, wingRight: 1, rearWing: 6 } as const;
export const partCount = 11;
const noseHalf = 0.2;
const wingFront = 2.08;
const wingTop = 0.42;
const rearBack = -2.12;
const rearBottom = 0.52;
const droopFrom = 0.5;
const droopSlope = 0.38;
const droopBack = 0.1;
const rearSag = 0.14;
const frontHinge = new THREE.Vector3(0.0, 0.2, 2.4);
const rearHinge = new THREE.Vector3(0.0, 0.62, -2.3);
const bendFrom = 0.2;
const bendFull = 0.55;
const breakAt = 0.7;
const debrisCapacity = 320;
const sparkCapacity = 600;
const debrisLife = 25;
const sparkLife = 0.45;
const gravity = 9.81;
const bounce = 0.35;
const groundDrag = 3.5;

export type DamageLook = Float32Array;

export function newLook(): DamageLook {
  return new Float32Array(8);
}

function zoneOf(x: number, y: number, z: number): number {
  if (z > wingFront && y < wingTop && Math.abs(x) > noseHalf)
    return x > 0 ? damageZone.wingLeft : damageZone.wingRight;
  if (z < rearBack && y > rearBottom) return damageZone.rearWing;
  return damageZone.none;
}

function triangleZones(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  zones: Uint8Array,
): void {
  for (let v = 0; v + 2 < zones.length; v += 3) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      x += position.getX(v + k) / 3;
      y += position.getY(v + k) / 3;
      z += position.getZ(v + k) / 3;
    }
    zones.fill(zoneOf(x, y, z), v, v + 3);
  }
}

export function zeroZones(geometry: THREE.BufferGeometry): void {
  if ("damageZone" in geometry.attributes) return;
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "damageZone",
    new THREE.BufferAttribute(new Float32Array(count), 1),
  );
}

type Positions = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function centroidZone(position: Positions, corner: number[]): number {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of corner) {
    x += position.getX(v) / 3;
    y += position.getY(v) / 3;
    z += position.getZ(v) / 3;
  }
  return zoneOf(x, y, z);
}

function splitBoundary(
  position: Positions,
  zones: Uint8Array,
  indices: number[],
): { extra: number[]; extraZones: number[] } {
  const extra: number[] = [];
  const extraZones: number[] = [];
  const copies = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const corner = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0];
    const zone = centroidZone(position, corner);
    corner.forEach((v, k) => {
      if (zones[v] === zone) return;
      const key = v * 4 + zone;
      let copy = copies.get(key);
      if (copy === undefined) {
        copy = zones.length + extra.length;
        copies.set(key, copy);
        extra.push(v);
        extraZones.push(zone);
      }
      indices[t + k] = copy;
    });
  }
  return { extra, extraZones };
}

function grow(geometry: THREE.BufferGeometry, extra: number[]): void {
  const count = geometry.getAttribute("position").count;
  const total = count + extra.length;
  for (const [name, source] of Object.entries(geometry.attributes)) {
    const size = source.itemSize;
    const array = new Float32Array(total * size);
    for (let v = 0; v < count; v++)
      for (let k = 0; k < size; k++)
        array[v * size + k] = source.getComponent(v, k);
    extra.forEach((from, i) => {
      for (let k = 0; k < size; k++)
        array[(count + i) * size + k] = source.getComponent(from, k);
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
}

export function tagDamageZones(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute("position");
  const zones = new Uint8Array(position.count);
  for (let v = 0; v < position.count; v++)
    zones[v] = zoneOf(position.getX(v), position.getY(v), position.getZ(v));
  const any = zones.some((zone) => zone !== damageZone.none);
  const index = geometry.getIndex();
  if (!index) {
    if (any) triangleZones(position, zones);
    geometry.setAttribute(
      "damageZone",
      new THREE.BufferAttribute(Float32Array.from(zones), 1),
    );
    return any;
  }
  if (!any) return false;
  const indices = Array.from(index.array as ArrayLike<number>);
  const { extra, extraZones } = splitBoundary(position, zones, indices);
  grow(geometry, extra);
  const allZones = new Float32Array(zones.length + extra.length);
  allZones.set(zones);
  allZones.set(extraZones, zones.length);
  geometry.setAttribute("damageZone", new THREE.BufferAttribute(allZones, 1));
  geometry.setIndex(
    allZones.length > 65535
      ? new THREE.Uint32BufferAttribute(indices, 1)
      : indices,
  );
  return true;
}

const intact = new Float32Array(8);

function lookOf(object: THREE.Object3D | null): DamageLook {
  if (!object) return intact;
  return (object.userData as { damage?: DamageLook }).damage ?? intact;
}

export function damageable(material: THREE.NodeMaterial): void {
  const bent = uniform(new THREE.Vector4());
  const gone = uniform(new THREE.Vector4());
  bent.onObjectUpdate(({ object }) => {
    const look = lookOf(object);
    bent.value.fromArray(look, 0);
    gone.value.fromArray(look, 3);
  });
  gone.onObjectUpdate(() => undefined);
  const zone = attribute<"float">("damageZone", "float");
  const left = step(0.5, zone).mul(step(zone, 1.5));
  const right = step(1.5, zone).mul(step(zone, 2.5));
  const rear = step(2.5, zone);
  const front = left.add(right);
  const p = positionLocal;
  const outer = max(abs(p.x).sub(droopFrom), 0);
  const frontBend = left.mul(bent.x).add(right.mul(bent.y));
  const drop = vec3(0, outer.mul(-droopSlope), outer.mul(-droopBack))
    .mul(frontBend)
    .add(vec3(0, abs(p.x).mul(-rearSag), 0).mul(rear.mul(bent.z)));
  const hinge = mix(
    vec3(rearHinge.x, rearHinge.y, rearHinge.z),
    vec3(sign(p.x).mul(frontHinge.x), frontHinge.y, frontHinge.z),
    front,
  );
  const broken = left.mul(gone.x).add(right.mul(gone.y)).add(rear.mul(gone.z));
  material.positionNode = mix(p.add(drop), hinge, broken);
}

export interface LookChange {
  part: "wingLeft" | "wingRight" | "rearWing";
  broke: boolean;
}

export function updateLook(
  look: DamageLook,
  damage: Float64Array,
  offset: number,
): LookChange[] {
  const changes: LookChange[] = [];
  const parts = ["wingLeft", "wingRight", "rearWing"] as const;
  parts.forEach((part, k) => {
    const value = damage[offset + partIndex[part]] ?? 0;
    const bend = Math.min(
      1,
      Math.max(0, (value - bendFrom) / (bendFull - bendFrom)),
    );
    const broken = value >= breakAt ? 1 : 0;
    const wasBent = look[k] ?? 0;
    const wasBroken = look[3 + k] ?? 0;
    if (broken > wasBroken) changes.push({ part, broke: true });
    else if (bend > 0 && wasBent === 0) changes.push({ part, broke: false });
    look[k] = bend;
    look[3 + k] = broken;
  });
  return changes;
}

const partPoint: Record<LookChange["part"], [number, number, number]> = {
  wingLeft: [2.5, 0.55, 0.15],
  wingRight: [2.5, -0.55, 0.15],
  rearWing: [-2.3, 0, 0.8],
};

interface Piece {
  age: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  angle: number;
  ground: number;
  size: number;
}

interface Spark {
  age: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export class Debris {
  readonly root = new THREE.Group();
  private readonly shards: THREE.InstancedMesh;
  private readonly sparks: THREE.Mesh;
  private readonly sparkData: THREE.InstancedBufferAttribute;
  private readonly pieces: (Piece | undefined)[] = [];
  private readonly flying: (Spark | undefined)[] = [];
  private pieceCursor = 0;
  private sparkCursor = 0;
  private readonly point = new THREE.Vector3();
  private readonly scratch = new THREE.Object3D();
  private lastTime: number | null = null;

  constructor() {
    const shard = new THREE.TetrahedronGeometry(1, 0);
    shard.scale(1, 0.18, 0.6);
    const material = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(0.035, 0.036, 0.04),
      roughness: 0.45,
      metalness: 0.1,
    });
    this.shards = new THREE.InstancedMesh(shard, material, debrisCapacity);
    this.shards.frustumCulled = false;
    this.shards.castShadow = true;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < debrisCapacity; i++) this.shards.setMatrixAt(i, hidden);
    this.sparkData = new THREE.InstancedBufferAttribute(
      new Float32Array(sparkCapacity * 4),
      4,
    );
    const sparkMaterial = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const data = instancedBufferAttribute(this.sparkData, "vec4" as const);
    const glow = smoothstep(float(0.5), float(0), length(uv().sub(0.5)));
    sparkMaterial.positionNode = vec3(data.x, data.y, data.z);
    sparkMaterial.scaleNode = data.w;
    sparkMaterial.colorNode = vec4(9, 4.2, 1.2, 1);
    sparkMaterial.opacityNode = glow.mul(step(0.001, data.w));
    this.sparks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      sparkMaterial,
      sparkCapacity,
    );
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.root.add(this.shards, this.sparks);
  }

  spawn(
    carMatrix: THREE.Matrix4,
    velocity: THREE.Vector3,
    change: LookChange,
  ): void {
    const [px, py, pz] = partPoint[change.part];
    this.point.set(px, py, pz).applyMatrix4(carMatrix);
    const ground = this.point.z - pz - 0.25;
    const count = change.broke ? 14 : 4;
    for (let i = 0; i < count; i++) {
      const jitter = () => (Math.random() - 0.5) * 2;
      this.pieces[this.pieceCursor] = {
        age: 0,
        x: this.point.x + jitter() * 0.3,
        y: this.point.y + jitter() * 0.3,
        z: this.point.z,
        vx: velocity.x * (0.5 + Math.random() * 0.4) + jitter() * 4,
        vy: velocity.y * (0.5 + Math.random() * 0.4) + jitter() * 4,
        vz: 1 + Math.random() * 3,
        spin: jitter() * 18,
        angle: Math.random() * Math.PI,
        ground,
        size: (change.broke ? 0.09 : 0.045) * (0.5 + Math.random()),
      };
      this.pieceCursor = (this.pieceCursor + 1) % debrisCapacity;
    }
    this.sparkBurst(velocity, change.broke ? 60 : 25);
  }

  private sparkBurst(velocity: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const jitter = () => (Math.random() - 0.5) * 2;
      this.flying[this.sparkCursor] = {
        age: Math.random() * 0.1,
        x: this.point.x,
        y: this.point.y,
        z: this.point.z,
        vx: velocity.x * 0.7 + jitter() * 9,
        vy: velocity.y * 0.7 + jitter() * 9,
        vz: Math.random() * 6,
      };
      this.sparkCursor = (this.sparkCursor + 1) % sparkCapacity;
    }
  }

  update(time: number): void {
    const dt =
      this.lastTime === null
        ? 0
        : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    if (dt <= 0) return;
    this.updatePieces(dt);
    this.updateSparks(dt);
  }

  private updatePieces(dt: number): void {
    let shown = 0;
    for (const piece of this.pieces) {
      if (!piece || piece.age > debrisLife) continue;
      piece.age += dt;
      piece.vz -= gravity * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.z += piece.vz * dt;
      if (piece.z < piece.ground) {
        piece.z = piece.ground;
        piece.vz = Math.abs(piece.vz) * bounce;
        const drag = Math.exp(-groundDrag * dt);
        piece.vx *= drag;
        piece.vy *= drag;
        piece.spin *= drag;
      }
      piece.angle += piece.spin * dt;
      this.scratch.position.set(piece.x, piece.y, piece.z + piece.size * 0.15);
      this.scratch.rotation.set(piece.angle * 0.3, 0, piece.angle);
      this.scratch.scale.setScalar(piece.size);
      this.scratch.updateMatrix();
      this.shards.setMatrixAt(shown++, this.scratch.matrix);
    }
    this.shards.count = shown;
    if (shown > 0) this.shards.instanceMatrix.needsUpdate = true;
  }

  private updateSparks(dt: number): void {
    const data = this.sparkData.array as Float32Array;
    let alive = false;
    for (let i = 0; i < sparkCapacity; i++) {
      const spark = this.flying[i];
      if (!spark || spark.age > sparkLife) {
        data[i * 4 + 3] = 0;
        continue;
      }
      alive = true;
      spark.age += dt;
      spark.vz -= gravity * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.z += spark.vz * dt;
      data[i * 4] = spark.x;
      data[i * 4 + 1] = spark.y;
      data[i * 4 + 2] = spark.z;
      data[i * 4 + 3] = 0.05 * (1 - spark.age / sparkLife);
    }
    this.sparks.visible = alive;
    if (alive) this.sparkData.needsUpdate = true;
  }

  clear(): void {
    this.pieces.length = 0;
    this.flying.length = 0;
    this.shards.count = 0;
    this.sparks.visible = false;
  }
}
