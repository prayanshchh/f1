import * as THREE from "three/webgpu";
import {
  float,
  floor,
  fract,
  instancedBufferAttribute,
  length,
  pow,
  smoothstep,
  step,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import {
  type LookChange,
  detaches,
  wheelHub,
  zoneCentre,
} from "./car-damage.ts";

export type Ground = (x: number, y: number) => number;
export type Walls = (x: number, y: number) => ArrayLike<number> | null;

interface World {
  ground: Ground;
  walls: Walls;
}

interface PieceShape {
  meshes: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  centre: THREE.Vector3;
  half: THREE.Vector3;
}

export type CarPieces = Map<number, PieceShape>;

interface WheelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  userData: Record<string, unknown>;
}

export interface WheelPiece {
  parts: WheelPart[];
  radius: number;
  width: number;
}

interface Spawn {
  time: number;
  car: number;
  change: LookChange;
  matrix: THREE.Matrix4;
  velocity: THREE.Vector3;
  seed: number;
}

interface Path {
  start: number;
  rate: number;
  samples: Float32Array;
  count: number;
}

interface Piece {
  spawn: Spawn;
  path: Path;
  object: THREE.Object3D;
}

interface Shard {
  spawn: Spawn;
  path: Path;
  size: number;
  colour: THREE.Color;
}

const pieceRate = 60;
const shardRate = 30;
const longest = 9;
const substeps = 3;
const gravity = 9.81;
const groundGrip = 5.5;
const airDrag = 0.35;
const bounce = 0.28;
const settleRate = 7;
const restSpeed = 0.22;
const restSpin = 0.6;
const shardCapacity = 900;
const sparkCapacity = 700;
const puffCapacity = 160;
const sparkLife = 0.5;
const puffLife = 1.8;
const puffOpacity = 0.38;
const copiesPerPart = 2;
const regroundDistance = 3;
const wallBounce = 0.3;
const wallScrub = 0.75;

const shardCounts: Record<LookChange["kind"], number> = {
  break: 15,
  bend: 5,
  tear: 9,
  scrape: 2,
  wheel: 12,
};
const sparkCounts: Record<LookChange["kind"], number> = {
  break: 70,
  bend: 30,
  tear: 40,
  scrape: 26,
  wheel: 60,
};
const puffCounts: Record<LookChange["kind"], number> = {
  break: 4,
  bend: 1,
  tear: 2,
  scrape: 0,
  wheel: 3,
};

function random(seed: number): () => number {
  let state = Math.floor(seed * 4294967295) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

const up = new THREE.Vector3(0, 0, 1);
const axisScratch = new THREE.Vector3();
const thinWorld = new THREE.Vector3();
const settleTurn = new THREE.Quaternion();
const spinTurn = new THREE.Quaternion();

interface Body {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  spin: THREE.Vector3;
  half: THREE.Vector3;
}

function thinAxis(half: THREE.Vector3): THREE.Vector3 {
  if (half.x <= half.y && half.x <= half.z) return new THREE.Vector3(1, 0, 0);
  if (half.y <= half.z) return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function reach(body: Body): number {
  axisScratch.copy(up).applyQuaternion(body.rotation.clone().invert());
  return (
    Math.abs(axisScratch.x) * body.half.x +
    Math.abs(axisScratch.y) * body.half.y +
    Math.abs(axisScratch.z) * body.half.z
  );
}

class GroundPatch {
  private x = Infinity;
  private y = Infinity;
  private z = 0;
  private dx = 0;
  private dy = 0;
  private wallX = Infinity;
  private wallY = Infinity;
  private readonly sides = new Float64Array(8);
  readonly normal = new THREE.Vector3();

  constructor(private readonly world: World) {}

  at(x: number, y: number): number {
    if (Math.hypot(x - this.x, y - this.y) > regroundDistance) {
      this.x = x;
      this.y = y;
      this.z = this.world.ground(x, y);
      this.dx = this.world.ground(x + 1, y) - this.z;
      this.dy = this.world.ground(x, y + 1) - this.z;
    }
    return this.z + this.dx * (x - this.x) + this.dy * (y - this.y);
  }

  wall(position: THREE.Vector3, floor: number): number {
    const { x, y } = position;
    if (Math.hypot(x - this.wallX, y - this.wallY) > regroundDistance) {
      this.wallX = x;
      this.wallY = y;
      const found = this.world.walls(x, y);
      if (found) this.sides.set(found);
      else this.sides.fill(-1);
    }
    return this.through(0, position, floor) || this.through(1, position, floor);
  }

  private through(side: number, position: THREE.Vector3, floor: number) {
    const height = this.sides[side * 4 + 3] ?? -1;
    if (height < 0 || position.z > floor + height) return 0;
    const nx = this.sides[side * 4 + 1] ?? 0;
    const ny = this.sides[side * 4 + 2] ?? 0;
    const inside =
      (this.sides[side * 4] ?? 0) +
      nx * (position.x - this.wallX) +
      ny * (position.y - this.wallY);
    if (inside >= 0) return 0;
    this.normal.set(nx, ny, 0);
    return -inside;
  }
}

function bounceOffWall(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  patch: GroundPatch,
  floor: number,
): boolean {
  const depth = patch.wall(position, floor);
  if (depth <= 0) return false;
  const n = patch.normal;
  position.addScaledVector(n, depth);
  const into = velocity.dot(n);
  if (into < 0) velocity.addScaledVector(n, -(1 + wallBounce) * into);
  velocity.x *= wallScrub;
  velocity.y *= wallScrub;
  return true;
}

function settle(body: Body, thin: THREE.Vector3, dt: number): void {
  thinWorld.copy(thin).applyQuaternion(body.rotation);
  const target = thinWorld.z >= 0 ? up : up.clone().negate();
  settleTurn.setFromUnitVectors(thinWorld, target);
  spinTurn.identity().slerp(settleTurn, Math.min(1, settleRate * dt));
  body.rotation.premultiply(spinTurn).normalize();
}

function stepBody(
  body: Body,
  thin: THREE.Vector3,
  patch: GroundPatch,
  dt: number,
): boolean {
  const { position, velocity, rotation, spin } = body;
  velocity.z -= gravity * dt;
  velocity.multiplyScalar(Math.exp(-airDrag * dt));
  position.addScaledVector(velocity, dt);
  const angle = spin.length() * dt;
  if (angle > 0) {
    spinTurn.setFromAxisAngle(axisScratch.copy(spin).normalize(), angle);
    rotation.premultiply(spinTurn).normalize();
  }
  const ground = patch.at(position.x, position.y);
  if (bounceOffWall(position, velocity, patch, ground))
    spin.multiplyScalar(0.6);
  const floor = ground + reach(body);
  if (position.z > floor) return false;
  position.z = floor;
  if (velocity.z < 0) velocity.z = -velocity.z * bounce;
  const flat = Math.hypot(velocity.x, velocity.y);
  const slowed = Math.max(0, flat - groundGrip * dt);
  const scale = flat > 0 ? slowed / flat : 0;
  velocity.x *= scale;
  velocity.y *= scale;
  spin.multiplyScalar(Math.exp(-4 * dt));
  settle(body, thin, dt);
  return true;
}

function resting(body: Body): boolean {
  return body.velocity.length() < restSpeed && body.spin.length() < restSpin;
}

function simulate(body: Body, world: World, start: number, rate: number): Path {
  const thin = thinAxis(body.half);
  const patch = new GroundPatch(world);
  const limit = Math.ceil(longest * rate) + 1;
  const samples = new Float32Array(limit * 7);
  const dt = 1 / rate / substeps;
  let count = 0;
  const write = () => {
    body.position.toArray(samples, count * 7);
    body.rotation.toArray(samples, count * 7 + 3);
    count += 1;
  };
  write();
  let grounded = 0;
  while (count < limit) {
    let touched = false;
    for (let k = 0; k < substeps; k++)
      touched = stepBody(body, thin, patch, dt) || touched;
    grounded = touched ? grounded + 1 : 0;
    write();
    if (grounded > 4 && resting(body)) break;
  }
  if (count > 1) {
    thinWorld.copy(thin).applyQuaternion(body.rotation);
    settleTurn.setFromUnitVectors(
      thinWorld,
      thinWorld.z >= 0 ? up : up.clone().negate(),
    );
    body.rotation.premultiply(settleTurn).normalize();
    body.position.z = patch.at(body.position.x, body.position.y) + reach(body);
    count -= 1;
    write();
  }
  return { start, rate, samples, count };
}

const wheelBounce = 0.42;
const wheelRoll = 3.2;
const wheelScrub = 2.6;
const wheelSlide = 7;
const wheelFlat = 1.25;
const wheelSteady = 9;
const wheelLean = 0.35;
const wheelLongest = 14;
const wheelUpright = 9;
const wheelDrag = 0.003;
const wheelTires = 8;

interface Roller {
  age: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  heading: number;
  tilt: number;
  tiltRate: number;
  turn: number;
  turnRate: number;
}

const wheelTurn = new THREE.Quaternion();
const wheelTilt = new THREE.Quaternion();
const wheelSpin = new THREE.Quaternion();
const forwardAxis = new THREE.Vector3(1, 0, 0);
const axleAxis = new THREE.Vector3(0, 1, 0);

function rollerRotation(roller: Roller, out: THREE.Quaternion): void {
  wheelTurn.setFromAxisAngle(up, roller.heading);
  wheelTilt.setFromAxisAngle(forwardAxis, roller.tilt);
  wheelSpin.setFromAxisAngle(axleAxis, roller.turn);
  out.copy(wheelTurn).multiply(wheelTilt).multiply(wheelSpin);
}

function stepRoller(
  roller: Roller,
  piece: WheelPiece,
  patch: GroundPatch,
  rand: () => number,
  dt: number,
): boolean {
  const { position, velocity } = roller;
  roller.age += dt;
  velocity.z -= gravity * dt;
  position.addScaledVector(velocity, dt);
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed > 0.4) roller.heading = Math.atan2(velocity.y, velocity.x);
  const lying = Math.abs(roller.tilt) > wheelFlat;
  const lean = Math.abs(Math.sin(roller.tilt));
  const reachDown =
    piece.radius * Math.abs(Math.cos(roller.tilt)) + (piece.width / 2) * lean;
  const ground = patch.at(position.x, position.y);
  if (bounceOffWall(position, velocity, patch, ground))
    roller.tiltRate += (rand() - 0.5) * 6;
  const floor = ground + reachDown;
  roller.tilt += roller.tiltRate * dt;
  roller.turn += roller.turnRate * dt;
  if (position.z > floor) return false;
  position.z = floor;
  if (velocity.z < -0.8) {
    velocity.z = -velocity.z * wheelBounce;
    roller.tiltRate = roller.tiltRate * 0.4 + (rand() - 0.5) * 2.4;
  } else velocity.z = Math.max(0, velocity.z);
  const slowing = lying
    ? wheelSlide
    : wheelRoll + wheelScrub * lean + wheelDrag * speed * speed;
  const kept = speed > 0 ? Math.max(0, speed - slowing * dt) / speed : 0;
  velocity.x *= kept;
  velocity.y *= kept;
  if (lying) {
    const flat = Math.sign(roller.tilt || 1) * (Math.PI / 2);
    roller.tilt += (flat - roller.tilt) * Math.min(1, 8 * dt);
    roller.tiltRate = 0;
    roller.turnRate *= Math.exp(-3 * dt);
    return true;
  }
  const steady =
    Math.min(1, speed / wheelSteady) *
    THREE.MathUtils.clamp(wheelTires + 1 - roller.age, 0, 1);
  const fall =
    (gravity / piece.radius) * Math.sin(roller.tilt) * (1 - steady) -
    roller.tilt * wheelUpright * steady;
  roller.tiltRate += (fall - roller.tiltRate * (1 + 3 * steady)) * dt;
  const curve =
    (-gravity * Math.tan(roller.tilt) * wheelLean * dt) / Math.max(2, speed);
  const c = Math.cos(curve);
  const s = Math.sin(curve);
  const vx = velocity.x;
  velocity.x = vx * c - velocity.y * s;
  velocity.y = vx * s + velocity.y * c;
  roller.turnRate = speed / piece.radius;
  return true;
}

function rollWheel(
  spawn: Spawn,
  hub: THREE.Vector3,
  piece: WheelPiece,
  world: World,
  rand: () => number,
): Path {
  spawn.matrix.decompose(carPosition, carRotation, carScale);
  const outward = new THREE.Vector3(0, hub.y >= 0 ? 1 : -1, 0).applyQuaternion(
    carRotation,
  );
  const velocity = spawn.velocity
    .clone()
    .multiplyScalar(0.65 + rand() * 0.25)
    .addScaledVector(outward, 3 + rand() * 4);
  velocity.z = 2.5 + rand() * 3.5;
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(carRotation);
  const roller: Roller = {
    age: 0,
    position: hub.clone().applyMatrix4(spawn.matrix),
    velocity,
    heading: Math.atan2(forward.y, forward.x),
    tilt: 0,
    tiltRate: (rand() - 0.5) * 7,
    turn: 0,
    turnRate: spawn.velocity.length() / piece.radius,
  };
  const patch = new GroundPatch(world);
  const limit = Math.ceil(wheelLongest * pieceRate) + 1;
  const samples = new Float32Array(limit * 7);
  const dt = 1 / pieceRate / substeps;
  const rotation = new THREE.Quaternion();
  let count = 0;
  const write = () => {
    roller.position.toArray(samples, count * 7);
    rollerRotation(roller, rotation);
    rotation.toArray(samples, count * 7 + 3);
    count += 1;
  };
  write();
  while (count < limit) {
    let touched = false;
    for (let k = 0; k < substeps; k++)
      touched = stepRoller(roller, piece, patch, rand, dt) || touched;
    write();
    const still =
      Math.abs(roller.tilt) > wheelFlat && roller.velocity.length() < restSpeed;
    if (touched && still) break;
  }
  return { start: spawn.time, rate: pieceRate, samples, count };
}

const sampleA = new THREE.Quaternion();
const sampleB = new THREE.Quaternion();

function sample(
  path: Path,
  time: number,
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
): void {
  const at = Math.max(0, (time - path.start) * path.rate);
  const i = Math.min(path.count - 1, Math.floor(at));
  const j = Math.min(path.count - 1, i + 1);
  const t = Math.min(1, at - i);
  const s = path.samples;
  position.set(
    THREE.MathUtils.lerp(s[i * 7] ?? 0, s[j * 7] ?? 0, t),
    THREE.MathUtils.lerp(s[i * 7 + 1] ?? 0, s[j * 7 + 1] ?? 0, t),
    THREE.MathUtils.lerp(s[i * 7 + 2] ?? 0, s[j * 7 + 2] ?? 0, t),
  );
  sampleA.fromArray(s, i * 7 + 3);
  sampleB.fromArray(s, j * 7 + 3);
  rotation.slerpQuaternions(sampleA, sampleB, t);
}

const carRotation = new THREE.Quaternion();
const carScale = new THREE.Vector3();
const carPosition = new THREE.Vector3();

function launch(
  spawn: Spawn,
  centre: THREE.Vector3,
  half: THREE.Vector3,
  rand: () => number,
  heavy: boolean,
): Body {
  spawn.matrix.decompose(carPosition, carRotation, carScale);
  const jitter = () => (rand() - 0.5) * 2;
  const position = centre.clone().applyMatrix4(spawn.matrix);
  const keep = heavy ? 0.55 + rand() * 0.25 : 0.4 + rand() * 0.5;
  const scatter = heavy ? 2.6 : 5.5;
  const side = new THREE.Vector3(0, centre.y >= 0 ? 1 : -1, 0).applyQuaternion(
    carRotation,
  );
  const velocity = spawn.velocity
    .clone()
    .multiplyScalar(keep)
    .addScaledVector(side, (heavy ? 1.2 : 2) * rand())
    .add(new THREE.Vector3(jitter() * scatter, jitter() * scatter, 0));
  velocity.z = (heavy ? 1.6 : 2.2) + rand() * (heavy ? 2.6 : 4.5);
  const spinSize = heavy ? 5 + rand() * 7 : 10 + rand() * 18;
  const spin = new THREE.Vector3(jitter(), jitter(), jitter())
    .normalize()
    .multiplyScalar(spinSize);
  return {
    position,
    velocity,
    rotation: carRotation.clone(),
    spin,
    half: half.clone(),
  };
}

function plateGeometry(rand: () => number): THREE.BufferGeometry {
  const corners = 5 + Math.floor(rand() * 3);
  const shape = new THREE.Shape();
  for (let k = 0; k < corners; k++) {
    const a = (k / corners) * Math.PI * 2 + (rand() - 0.5) * 0.7;
    const r = 0.55 + rand() * 0.45;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * (0.35 + rand() * 0.5);
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.08,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.04);
  return geometry;
}

const fromGltf = new THREE.Matrix4().set(
  0,
  0,
  1,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);

export function gltfWheelPiece(
  pivot: THREE.Object3D,
  radius: number,
  width: number,
): WheelPiece {
  pivot.updateMatrixWorld(true);
  const toPivot = pivot.matrixWorld.clone().invert();
  const parts: WheelPart[] = [];
  pivot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const mesh = object as THREE.Mesh;
    const material = mesh.material;
    if (Array.isArray(material)) return;
    parts.push({
      geometry: mesh.geometry,
      material,
      matrix: fromGltf.clone().multiply(toPivot).multiply(mesh.matrixWorld),
      userData: mesh.userData,
    });
  });
  return { parts, radius, width };
}

const sparkData = (count: number) =>
  new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);

export class Debris {
  readonly root = new THREE.Group();
  private readonly spawns: Spawn[] = [];
  private readonly pieces: Piece[] = [];
  private readonly shards: (Shard | undefined)[] = [];
  private readonly slots = new Map<string, THREE.Object3D[]>();
  private readonly owners = new Map<THREE.Object3D, Piece>();
  private readonly shapes = new Map<number, CarPieces>();
  private readonly wheels = new Map<
    string,
    { object: THREE.Object3D; piece: WheelPiece }
  >();
  private readonly plates: THREE.InstancedMesh;
  private readonly sparkMesh: THREE.InstancedMesh;
  private readonly sparkAttr = sparkData(sparkCapacity);
  private readonly puffMesh: THREE.InstancedMesh;
  private readonly puffAttr = sparkData(puffCapacity);
  private shardCursor = 0;
  private shardsAt = 0;
  private shardsDirty = true;
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly world: World = { ground: () => 0, walls: () => null };

  constructor() {
    this.root.matrixAutoUpdate = false;
    const rand = random(0.37);
    const plate = plateGeometry(rand);
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.42,
      metalness: 0.05,
    });
    this.plates = new THREE.InstancedMesh(plate, material, shardCapacity);
    this.plates.frustumCulled = false;
    this.plates.castShadow = true;
    this.plates.receiveShadow = true;
    for (let i = 0; i < shardCapacity; i++) {
      this.plates.setMatrixAt(i, this.hidden);
      this.plates.setColorAt(i, new THREE.Color(0.03, 0.031, 0.034));
    }
    this.sparkMesh = this.sprites(this.sparkAttr, sparkCapacity, true);
    this.puffMesh = this.sprites(this.puffAttr, puffCapacity, false);
    this.root.add(this.plates, this.sparkMesh, this.puffMesh);
  }

  private sprites(
    data: THREE.InstancedBufferAttribute,
    count: number,
    hot: boolean,
  ): THREE.InstancedMesh {
    const material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const node = instancedBufferAttribute(data, "vec4" as const);
    const round = length(uv().sub(0.5));
    material.positionNode = vec3(node.x, node.y, node.z);
    material.scaleNode = node.w.abs();
    if (hot) {
      material.colorNode = vec4(9, 4.2, 1.2, 1);
      material.opacityNode = smoothstep(float(0.5), float(0), round).mul(
        step(0.001, node.w),
      );
    } else {
      const fade = fract(node.w);
      material.scaleNode = floor(node.w).mul(0.01);
      material.colorNode = vec4(0.8, 0.8, 0.78, 1);
      material.opacityNode = smoothstep(float(0.5), float(0), round)
        .mul(pow(float(1).sub(fade), 2).mul(puffOpacity))
        .mul(smoothstep(0, 0.04, fade))
        .mul(step(0.001, node.w));
    }
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      material,
      count,
    );
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  setGround(ground: Ground): void {
    this.world.ground = ground;
  }

  setWalls(walls: Walls): void {
    this.world.walls = walls;
  }

  addCar(car: number, pieces: CarPieces): void {
    this.shapes.set(car, pieces);
    for (const [zone, shape] of pieces) {
      const copies: THREE.Object3D[] = [];
      for (let k = 0; k < copiesPerPart; k++) {
        const object = new THREE.Group();
        object.matrixAutoUpdate = false;
        object.visible = false;
        const inner = new THREE.Group();
        inner.matrixAutoUpdate = false;
        inner.matrix
          .copy(fromGltf)
          .multiply(
            new THREE.Matrix4().makeTranslation(
              -shape.centre.y,
              -shape.centre.z,
              -shape.centre.x,
            ),
          );
        for (const { geometry, material } of shape.meshes) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          inner.add(mesh);
        }
        object.add(inner);
        this.root.add(object);
        copies.push(object);
      }
      this.slots.set(`${String(car)}:${String(zone)}`, copies);
    }
  }

  addWheels(car: number, wheels: WheelPiece[]): void {
    wheels.forEach((piece, i) => {
      const object = new THREE.Group();
      object.matrixAutoUpdate = false;
      object.visible = false;
      for (const part of piece.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.matrix);
        mesh.userData = part.userData;
        object.add(mesh);
      }
      this.root.add(object);
      this.wheels.set(`${String(car)}:${String(i)}`, { object, piece });
    });
  }

  spawn(
    time: number,
    car: number,
    matrix: THREE.Matrix4,
    velocity: THREE.Vector3,
    change: LookChange,
  ): void {
    const key = change.zone + (change.kind === "wheel" ? 37 : 0);
    const seed =
      ((time * 7919 + car * 104729 + key * 1299709) % 1000003) / 1000003;
    const spawn: Spawn = {
      time,
      car,
      change,
      matrix: matrix.clone(),
      velocity: velocity.clone(),
      seed,
    };
    this.spawns.push(spawn);
    this.launchPiece(spawn);
    this.launchWheel(spawn);
    this.launchShards(spawn);
  }

  private launchWheel(spawn: Spawn): void {
    if (spawn.change.kind !== "wheel") return;
    const slot = this.wheels.get(
      `${String(spawn.car)}:${String(spawn.change.zone)}`,
    );
    if (!slot) return;
    const old = this.owners.get(slot.object);
    if (old) this.pieces.splice(this.pieces.indexOf(old), 1);
    const piece = {
      spawn,
      path: rollWheel(
        spawn,
        wheelHub(spawn.change.zone),
        slot.piece,
        this.world,
        random(spawn.seed),
      ),
      object: slot.object,
    };
    this.owners.set(slot.object, piece);
    this.pieces.push(piece);
  }

  private centreOf(spawn: Spawn, rand: () => number): THREE.Vector3 {
    if (spawn.change.kind === "wheel") return wheelHub(spawn.change.zone);
    if (spawn.change.zone > 0) return zoneCentre(spawn.change.zone);
    return new THREE.Vector3(0.3, rand() > 0.5 ? 0.62 : -0.62, 0.1);
  }

  private launchPiece(spawn: Spawn): void {
    if (spawn.change.kind !== "break") return;
    const shape = this.shapes.get(spawn.car)?.get(spawn.change.zone);
    const copies = this.slots.get(
      `${String(spawn.car)}:${String(spawn.change.zone)}`,
    );
    if (!shape || !copies) return;
    const rand = random(spawn.seed);
    const object =
      copies.find((copy) => !this.owners.has(copy)) ??
      copies.reduce((a, b) =>
        (this.owners.get(a)?.spawn.time ?? 0) <=
        (this.owners.get(b)?.spawn.time ?? 0)
          ? a
          : b,
      );
    const old = this.owners.get(object);
    if (old) this.pieces.splice(this.pieces.indexOf(old), 1);
    const body = launch(spawn, shape.centre, shape.half, rand, true);
    const piece = {
      spawn,
      path: simulate(body, this.world, spawn.time, pieceRate),
      object,
    };
    this.owners.set(object, piece);
    this.pieces.push(piece);
  }

  private launchShards(spawn: Spawn): void {
    const rand = random(spawn.seed * 0.73 + 0.11);
    const centre = this.centreOf(spawn, rand);
    const count = shardCounts[spawn.change.kind];
    for (let i = 0; i < count; i++) {
      const big = spawn.change.kind === "break" && rand() < 0.15;
      const size =
        0.03 +
        rand() ** 2 * (spawn.change.kind === "break" ? 0.14 : 0.06) +
        (big ? 0.12 + rand() * 0.1 : 0);
      const half = new THREE.Vector3(size, size * 0.55, 0.008);
      const from = centre
        .clone()
        .add(
          new THREE.Vector3(
            (rand() - 0.5) * 0.4,
            (rand() - 0.5) * 0.3,
            rand() * 0.1,
          ),
        );
      const body = launch(spawn, from, half, rand, false);
      const colour =
        rand() < 0.08
          ? new THREE.Color(0.16, 0.16, 0.17)
          : new THREE.Color(
              0.022 + rand() * 0.02,
              0.023 + rand() * 0.02,
              0.026 + rand() * 0.02,
            );
      this.shards[this.shardCursor] = {
        spawn,
        path: simulate(body, this.world, spawn.time, shardRate),
        size,
        colour,
      };
      this.plates.setColorAt(this.shardCursor, colour);
      this.shardCursor = (this.shardCursor + 1) % shardCapacity;
    }
    this.shardsDirty = true;
    if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;
  }

  cut(time: number): void {
    const keep = (spawn: Spawn) => spawn.time <= time;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      if (!piece || keep(piece.spawn)) continue;
      this.owners.delete(piece.object);
      piece.object.visible = false;
      this.pieces.splice(i, 1);
    }
    this.shards.forEach((shard, i) => {
      if (shard && !keep(shard.spawn)) this.shards[i] = undefined;
    });
    this.shardsDirty = true;
    for (let i = this.spawns.length - 1; i >= 0; i--)
      if (!keep(this.spawns[i] as Spawn)) this.spawns.splice(i, 1);
  }

  clear(): void {
    this.cut(-Infinity);
  }

  update(time: number): void {
    for (const piece of this.pieces) {
      const shown = piece.spawn.time <= time;
      piece.object.visible = shown;
      if (!shown) continue;
      sample(piece.path, time, this.position, this.rotation);
      piece.object.matrix.compose(
        this.position,
        this.rotation,
        this.scale.set(1, 1, 1),
      );
      piece.object.updateMatrixWorld(true);
    }
    this.updateShards(time);
    this.updateSparks(time);
    this.updatePuffs(time);
  }

  private shardsStill(from: number, to: number): boolean {
    const early = Math.min(from, to);
    const late = Math.max(from, to);
    return this.shards.every(
      (shard) =>
        !shard ||
        late < Math.min(shard.spawn.time, shard.path.start) ||
        early > shard.path.start + (shard.path.count - 1) / shard.path.rate,
    );
  }

  private updateShards(time: number): void {
    if (!this.shardsDirty && this.shardsStill(this.shardsAt, time)) return;
    this.shardsAt = time;
    this.shardsDirty = false;
    let shown = 0;
    this.shards.forEach((shard, i) => {
      if (!shard || shard.spawn.time > time) {
        this.plates.setMatrixAt(i, this.hidden);
        return;
      }
      sample(shard.path, time, this.position, this.rotation);
      this.matrix.compose(
        this.position,
        this.rotation,
        this.scale.set(shard.size, shard.size * 0.55, 0.1),
      );
      this.plates.setMatrixAt(i, this.matrix);
      shown += 1;
    });
    this.plates.visible = shown > 0;
    this.plates.instanceMatrix.needsUpdate = true;
  }

  private recent(time: number, life: number): Spawn[] {
    const found: Spawn[] = [];
    for (let i = this.spawns.length - 1; i >= 0; i--) {
      const spawn = this.spawns[i];
      if (!spawn) continue;
      if (time - spawn.time > life + 1) break;
      if (spawn.time <= time && time - spawn.time <= life) found.push(spawn);
    }
    return found;
  }

  private updateSparks(time: number): void {
    const data = this.sparkAttr.array as Float32Array;
    data.fill(0);
    let n = 0;
    for (const spawn of this.recent(time, sparkLife)) {
      const rand = random(spawn.seed * 0.51 + 0.29);
      const origin = this.origin(spawn);
      const count = sparkCounts[spawn.change.kind];
      for (let i = 0; i < count && n < sparkCapacity; i++) {
        const delay = rand() * 0.12;
        const age = time - spawn.time - delay;
        const vx = spawn.velocity.x * 0.7 + (rand() - 0.5) * 18;
        const vy = spawn.velocity.y * 0.7 + (rand() - 0.5) * 18;
        const vz = rand() * 6;
        const life = sparkLife * (0.5 + rand() * 0.5);
        if (age < 0 || age > life) continue;
        data[n * 4] = origin.x + vx * age;
        data[n * 4 + 1] = origin.y + vy * age;
        data[n * 4 + 2] = Math.max(
          origin.z - 0.3,
          origin.z + vz * age - 0.5 * gravity * age * age,
        );
        data[n * 4 + 3] = 0.05 * (1 - age / life);
        n += 1;
      }
    }
    this.sparkMesh.visible = n > 0;
    if (n > 0) this.sparkAttr.needsUpdate = true;
  }

  private updatePuffs(time: number): void {
    const data = this.puffAttr.array as Float32Array;
    data.fill(0);
    let n = 0;
    for (const spawn of this.recent(time, puffLife)) {
      const rand = random(spawn.seed * 0.91 + 0.07);
      const origin = this.origin(spawn);
      const count = puffCounts[spawn.change.kind];
      for (let i = 0; i < count && n < puffCapacity; i++) {
        const delay = rand() * 0.15;
        const scatterX = (rand() - 0.5) * 0.6;
        const scatterY = (rand() - 0.5) * 0.6;
        const driftX = (rand() - 0.5) * 1.4;
        const driftY = (rand() - 0.5) * 1.4;
        const age = time - spawn.time - delay;
        if (age < 0 || age > puffLife) continue;
        const drift = 1 - Math.exp(-age * 2.2);
        data[n * 4] =
          origin.x + scatterX + (spawn.velocity.x * 0.06 + driftX) * drift;
        data[n * 4 + 1] =
          origin.y + scatterY + (spawn.velocity.y * 0.06 + driftY) * drift;
        data[n * 4 + 2] = origin.z + 0.35 + age * 0.35;
        const size = 0.8 + 1.7 * (1 - Math.exp(-age * 1.6));
        data[n * 4 + 3] =
          Math.floor(size * 100) + Math.min(0.99, age / puffLife);
        n += 1;
      }
    }
    this.puffMesh.visible = n > 0;
    if (n > 0) this.puffAttr.needsUpdate = true;
  }

  private origin(spawn: Spawn): THREE.Vector3 {
    const centre =
      spawn.change.kind === "wheel"
        ? wheelHub(spawn.change.zone)
        : spawn.change.zone > 0
          ? zoneCentre(spawn.change.zone)
          : new THREE.Vector3(0.3, 0, 0.1);
    return centre.applyMatrix4(spawn.matrix);
  }
}

interface Picked {
  material: THREE.Material;
  source: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  corners: number[];
}

function meshZones(mesh: THREE.Mesh): Map<number, number[]> {
  const lists = new Map<number, number[]>();
  const geometry = mesh.geometry;
  if (!("damageZone" in geometry.attributes)) return lists;
  const tag = geometry.getAttribute("damageZone");
  const index = geometry.getIndex();
  const count = index ? index.count : tag.count;
  const corner = (i: number) => (index ? index.getX(i) : i);
  for (let t = 0; t + 2 < count; t += 3) {
    const zone = Math.floor(tag.getX(corner(t)));
    if (!detaches(zone)) continue;
    const list = lists.get(zone) ?? [];
    list.push(corner(t), corner(t + 1), corner(t + 2));
    lists.set(zone, list);
  }
  return lists;
}

function zoneTriangles(
  model: THREE.Object3D,
  skip: ReadonlySet<THREE.Object3D>,
): Map<number, Picked[]> {
  model.updateMatrixWorld(true);
  const toModel = model.matrixWorld.clone().invert();
  const found = new Map<number, Picked[]>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || skip.has(object)) return;
    const mesh = object as THREE.Mesh;
    const material = mesh.material;
    if (Array.isArray(material)) return;
    const matrix = toModel.clone().multiply(mesh.matrixWorld);
    for (const [zone, corners] of meshZones(mesh)) {
      const picks = found.get(zone) ?? [];
      picks.push({ material, source: mesh.geometry, matrix, corners });
      found.set(zone, picks);
    }
  });
  return found;
}

function copyTriangles(pick: Picked): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(pick.matrix);
  const point = new THREE.Vector3();
  for (const [name, attribute] of Object.entries(pick.source.attributes)) {
    const size = attribute.itemSize;
    const array = new Float32Array(pick.corners.length * size);
    pick.corners.forEach((v, i) => {
      for (let k = 0; k < size; k++)
        array[i * size + k] = attribute.getComponent(v, k);
      if (name === "position" || name === "normal") {
        point.fromArray(array, i * size);
        if (name === "position") point.applyMatrix4(pick.matrix);
        else point.applyMatrix3(normalMatrix).normalize();
        point.toArray(array, i * size);
      }
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  return geometry;
}

export function zonePieces(
  model: THREE.Object3D,
  skip: ReadonlySet<THREE.Object3D> = new Set(),
): CarPieces {
  const pieces: CarPieces = new Map();
  for (const [zone, picks] of zoneTriangles(model, skip)) {
    const meshes = picks.map((pick) => ({
      geometry: copyTriangles(pick),
      material: pick.material,
    }));
    const box = new THREE.Box3();
    for (const { geometry } of meshes) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox);
    }
    if (box.isEmpty()) continue;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    pieces.set(zone, {
      meshes,
      centre: new THREE.Vector3(centre.z, centre.x, centre.y),
      half: new THREE.Vector3(
        Math.max(0.01, size.z / 2),
        Math.max(0.01, size.x / 2),
        Math.max(0.01, size.y / 2),
      ),
    });
  }
  return pieces;
}
