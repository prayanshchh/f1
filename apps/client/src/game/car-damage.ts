import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  abs,
  attribute,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  fract,
  int,
  max,
  mix,
  mx_noise_float,
  normalGeometry,
  positionGeometry,
  positionLocal,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const partIndex = {
  wingLeft: 0,
  wingRight: 1,
  sidepodLeft: 2,
  sidepodRight: 3,
  floor: 4,
  diffuser: 5,
  rearWing: 6,
  suspension: 7,
} as const;
export const partCount = 11;
export const tyreState = 3;
export const carState = partCount + 4 * tyreState;

type Point = [number, number, number];

interface ZoneSpec {
  name: string;
  inside: (x: number, y: number, z: number) => boolean;
  hinge: Point;
  axis: Point;
  bend: number;
  tear?: (x: number, y: number, z: number) => number;
  arm?: { left: boolean; front: boolean; reach: number };
}

const wingBack = 2.12;
const wingTop = 0.42;
const wingInner = 0.12;
const wingOuter = 0.58;

function frontWing(x: number, z: number): boolean {
  return x > wingBack && z < wingTop;
}

function rearNeck(x: number, y: number, z: number): boolean {
  return Math.abs(y) < 0.06 && z < 0.8 && x > -2.03;
}

function noise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function lumpy(x: number, y: number, z: number): number {
  const cell = 0.11;
  const ix = Math.floor(x / cell);
  const iy = Math.floor(y / cell);
  const iz = Math.floor(z / cell);
  return noise(ix, iy, iz);
}

function floorTear(x: number, y: number, z: number): number {
  const edge = (0.77 - Math.abs(y)) * 2.2;
  const end = Math.max(0, 0.35 - Math.abs(x + 0.3)) * 0.6;
  const seed = 0.12 + edge + end + 0.42 * (lumpy(x, y, z) - 0.5);
  return Math.min(0.98, Math.max(0.01, seed));
}

function diffuserTear(x: number, y: number, z: number): number {
  const back = (x + 2.2) * 0.9;
  const seed = 0.1 + back + 0.45 * (lumpy(x, y, z) - 0.5);
  return Math.min(0.98, Math.max(0.01, seed));
}

const zoneSpecs: ZoneSpec[] = [
  {
    name: "wingOuterLeft",
    inside: (x, y, z) => frontWing(x, z) && y > wingOuter,
    hinge: [2.42, wingOuter, 0.07],
    axis: [-1, 0, 0.3],
    bend: 0.26,
  },
  {
    name: "wingInnerLeft",
    inside: (x, y, z) => frontWing(x, z) && y > wingInner,
    hinge: [2.5, wingInner, 0.09],
    axis: [-1, 0, 0.45],
    bend: 0.13,
  },
  {
    name: "wingOuterRight",
    inside: (x, y, z) => frontWing(x, z) && y < -wingOuter,
    hinge: [2.42, -wingOuter, 0.07],
    axis: [1, 0, 0.3],
    bend: 0.26,
  },
  {
    name: "wingInnerRight",
    inside: (x, y, z) => frontWing(x, z) && y < -wingInner,
    hinge: [2.5, -wingInner, 0.09],
    axis: [1, 0, 0.45],
    bend: 0.13,
  },
  {
    name: "wingCentre",
    inside: (x, _y, z) => x > 2.18 && z < 0.13,
    hinge: [2.5, 0, 0.09],
    axis: [0, 1, 0],
    bend: 0,
  },
  {
    name: "rearFlap",
    inside: (x, y, z) => x < -2.14 && z > 0.775 && Math.abs(y) < 0.545,
    hinge: [-2.16, 0, 0.8],
    axis: [0.3, -1, 0],
    bend: 0.42,
  },
  {
    name: "rearMain",
    inside: (x, y, z) =>
      x < -1.88 && z > 0.585 && Math.abs(y) < 0.6 && !rearNeck(x, y, z),
    hinge: [-1.96, 0, 0.78],
    axis: [1, 0.55, 0],
    bend: 0.17,
  },
  {
    name: "mirrorLeft",
    inside: (x, y, z) => x > 0.5 && x < 0.8 && y > 0.29 && z > 0.6,
    hinge: [0.67, 0.3, 0.61],
    axis: [-1, 0, 0.2],
    bend: 0.7,
  },
  {
    name: "mirrorRight",
    inside: (x, y, z) => x > 0.5 && x < 0.8 && y < -0.29 && z > 0.6,
    hinge: [0.67, -0.3, 0.61],
    axis: [1, 0, 0.2],
    bend: 0.7,
  },
  {
    name: "floorLeft",
    inside: (x, y, z) => x > -1.3 && x < 0.75 && z < 0.17 && y > 0.5,
    hinge: [-0.3, 0.6, 0.05],
    axis: [0, 0, 1],
    bend: 0,
    tear: floorTear,
  },
  {
    name: "floorRight",
    inside: (x, y, z) => x > -1.3 && x < 0.75 && z < 0.17 && y < -0.5,
    hinge: [-0.3, -0.6, 0.05],
    axis: [0, 0, 1],
    bend: 0,
    tear: floorTear,
  },
  {
    name: "diffuser",
    inside: (x, y, z) =>
      x < -1.42 &&
      z < 0.37 &&
      Math.abs(y) < 0.56 &&
      !(Math.abs(y) < 0.07 && z > 0.2),
    hinge: [-1.9, 0, 0.15],
    axis: [0, 0, 1],
    bend: 0,
    tear: diffuserTear,
  },
];

const hubs = [
  {
    name: "armFrontRight",
    front: true,
    left: false,
    x: 1.7,
    y: 0.78,
    z: 0.352,
  },
  { name: "armFrontLeft", front: true, left: true, x: 1.7, y: 0.78, z: 0.352 },
  {
    name: "armRearRight",
    front: false,
    left: false,
    x: -1.7,
    y: 0.75,
    z: 0.355,
  },
  { name: "armRearLeft", front: false, left: true, x: -1.7, y: 0.75, z: 0.355 },
];
const armReach = { front: 0.62, rear: 0.6 };
const armSpan = { front: 0.32, rear: 0.24 };
const armInboard = 0.36;

for (const hub of hubs) {
  const side = hub.left ? 1 : -1;
  const reach = hub.front ? armReach.front : armReach.rear;
  zoneSpecs.push({
    name: hub.name,
    inside: (x, y, z) =>
      Math.abs(x - hub.x) < (hub.front ? armSpan.front : armSpan.rear) &&
      y * side > reach - armInboard &&
      y * side < reach + 0.04 &&
      z > 0.13 &&
      z < 0.58,
    hinge: [hub.x, side * hub.y, hub.z],
    axis: [0, 0, 1],
    bend: 0,
    arm: { left: hub.left, front: hub.front, reach },
  });
}

const zoneCount = zoneSpecs.length;
const firstArm = zoneCount - hubs.length + 1;
export const zoneId = Object.fromEntries(
  zoneSpecs.map((spec, i) => [spec.name, i + 1]),
) as Record<string, number>;

export function detaches(id: number): boolean {
  const spec = zoneSpecs[id - 1];
  return spec !== undefined && !spec.tear && !spec.arm;
}

export function wheelHub(wheel: number): THREE.Vector3 {
  const hub = hubs[wheel] ?? hubs[0];
  const side = hub?.left ? 1 : -1;
  return new THREE.Vector3(hub?.x ?? 0, side * (hub?.y ?? 0), hub?.z ?? 0);
}

export function wheelGone(bend: number): boolean {
  return bend >= 1.5;
}

function toGltf([x, y, z]: Point): Point {
  return [y, z, x];
}

export function zoneCentre(id: number): THREE.Vector3 {
  const [x, y, z] = zoneSpecs[id - 1]?.hinge ?? [0, 0, 0];
  return new THREE.Vector3(x, y, z);
}

const wheelCentres = [
  [1.7, 0.3525],
  [-1.7, 0.355],
] as const;
const wheelReach = 0.43;
const wheelInside = 0.565;

function onWheel(x: number, y: number, z: number): boolean {
  if (Math.abs(y) < wheelInside) return false;
  return wheelCentres.some(
    ([cx, cz]) => Math.hypot(x - cx, z - cz) < wheelReach,
  );
}

function zoneAt(gx: number, gy: number, gz: number, arms: boolean): number {
  const x = gz;
  const y = gx;
  const z = gy;
  if (onWheel(x, y, z)) return 0;
  const found = zoneSpecs.findIndex(
    (spec) => (arms || !spec.arm) && spec.inside(x, y, z),
  );
  return found + 1;
}

function seedAt(zone: number, gx: number, gy: number, gz: number): number {
  return zoneSpecs[zone - 1]?.tear?.(gz, gx, gy) ?? 0;
}

type Positions = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function centroid(position: Positions, corner: number[]): Point {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of corner) {
    x += position.getX(v) / 3;
    y += position.getY(v) / 3;
    z += position.getZ(v) / 3;
  }
  return [x, y, z];
}

function tears(zone: number): boolean {
  return zoneSpecs[zone - 1]?.tear !== undefined;
}

interface Split {
  extra: number[];
  values: number[];
}

function splitTriangles(
  position: Positions,
  zones: Float32Array,
  indices: number[],
  arms: boolean,
): Split {
  const extra: number[] = [];
  const values: number[] = [];
  const copies = new Map<number, number>();
  const total = () => zones.length + extra.length;
  for (let t = 0; t < indices.length; t += 3) {
    const corner = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0];
    const [cx, cy, cz] = centroid(position, corner);
    const zone = zoneAt(cx, cy, cz, arms);
    const own = tears(zone);
    const value = own ? zone + seedAt(zone, cx, cy, cz) : zone;
    corner.forEach((v, k) => {
      if (!own && zones[v] === value) return;
      const key = own ? -1 - t * 3 - k : v * 64 + zone;
      let copy = own ? undefined : copies.get(key);
      if (copy === undefined) {
        copy = total();
        if (!own) copies.set(key, copy);
        extra.push(v);
        values.push(value);
      }
      indices[t + k] = copy;
    });
  }
  return { extra, values };
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

export function zeroZones(geometry: THREE.BufferGeometry): void {
  if ("damageZone" in geometry.attributes) return;
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "damageZone",
    new THREE.BufferAttribute(new Float32Array(count), 1),
  );
}

function indexed(geometry: THREE.BufferGeometry): number[] {
  const index = geometry.getIndex();
  if (index) return Array.from(index.array as ArrayLike<number>);
  const count = geometry.getAttribute("position").count;
  return Array.from({ length: count }, (_, i) => i);
}

export function tagDamageZones(
  geometry: THREE.BufferGeometry,
  arms = false,
): boolean {
  const position = geometry.getAttribute("position");
  const zones = new Float32Array(position.count);
  for (let v = 0; v < position.count; v++)
    zones[v] = zoneAt(
      position.getX(v),
      position.getY(v),
      position.getZ(v),
      arms,
    );
  const indices = indexed(geometry);
  const { extra, values } = splitTriangles(position, zones, indices, arms);
  if (extra.length === 0 && !zones.some((zone) => zone !== 0)) return false;
  grow(geometry, extra);
  const all = new Float32Array(zones.length + extra.length);
  all.set(zones);
  all.set(values, zones.length);
  geometry.setAttribute("damageZone", new THREE.BufferAttribute(all, 1));
  geometry.setIndex(indices);
  return true;
}

const scrapeAt = 12;
const flagAt = 15;
const armsAt = 16;
const lookSize = 20;

export type DamageLook = Float32Array;

export function newLook(): DamageLook {
  return new Float32Array(lookSize);
}

const intact = newLook();

function lookOf(object: THREE.Object3D | null | undefined): DamageLook {
  return (
    (object?.userData as { damage?: DamageLook } | undefined)?.damage ?? intact
  );
}

const gone = 2;
const floorTearMost = 0.42;

function ramp(value: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

function staged(value: number, bendFrom: number, breakAt: number): number {
  if (value >= breakAt) return gone;
  return ramp(value, bendFrom, breakAt);
}

function zoneStates(parts: ArrayLike<number>, at: number): number[] {
  const part = (k: number) => parts[at + k] ?? 0;
  const wingLeft = part(partIndex.wingLeft);
  const wingRight = part(partIndex.wingRight);
  const podLeft = part(partIndex.sidepodLeft);
  const podRight = part(partIndex.sidepodRight);
  const floorDamage = part(partIndex.floor);
  const rear = part(partIndex.rearWing);
  const tearSide = (pod: number) =>
    ramp(floorDamage * 0.75 + pod * 0.45, 0.12, 1) * floorTearMost;
  return [
    staged(wingLeft, 0.15, 0.45),
    staged(wingLeft, 0.3, 0.7),
    staged(wingRight, 0.15, 0.45),
    staged(wingRight, 0.3, 0.7),
    Math.min(wingLeft, wingRight) >= 0.7 ? gone : 0,
    staged(rear, 0.15, 0.45),
    staged(rear, 0.35, 0.7),
    staged(podLeft, 0.4, 0.75),
    staged(podRight, 0.4, 0.75),
    tearSide(podLeft),
    tearSide(podRight),
    ramp(part(partIndex.diffuser), 0.08, 1),
  ];
}

function scrapes(parts: ArrayLike<number>, at: number): number[] {
  const part = (k: number) => parts[at + k] ?? 0;
  const floorDamage = part(partIndex.floor);
  const side = (pod: number, wing: number) =>
    Math.min(1, Math.max(pod * 1.1, floorDamage * 0.55, wing * 0.25));
  const nose = Math.max(part(partIndex.wingLeft), part(partIndex.wingRight));
  return [
    side(part(partIndex.sidepodLeft), part(partIndex.wingLeft)),
    side(part(partIndex.sidepodRight), part(partIndex.wingRight)),
    Math.min(1, nose * 0.6),
  ];
}

export interface LookChange {
  zone: number;
  kind: "break" | "bend" | "tear" | "scrape" | "wheel";
  amount: number;
}

const bendStep = 0.12;
const tearStep = 0.08;
const scrapeStep = 0.15;

function zoneChange(zone: number, was: number, now: number): LookChange | null {
  if (now >= gone && was < gone) return { zone, kind: "break", amount: 1 };
  if (now >= gone || now <= was) return null;
  const step = tears(zone) ? tearStep : bendStep;
  if (Math.floor(now / step) === Math.floor(was / step)) return null;
  return { zone, kind: tears(zone) ? "tear" : "bend", amount: now - was };
}

export function updateLook(
  look: DamageLook,
  damage: ArrayLike<number>,
  offset: number,
): LookChange[] {
  const changes: LookChange[] = [];
  zoneStates(damage, offset).forEach((now, k) => {
    const was = look[k] ?? 0;
    const change = zoneChange(k + 1, was, now);
    if (change) changes.push(change);
    look[k] = now;
  });
  scrapes(damage, offset).forEach((now, k) => {
    const was = look[scrapeAt + k] ?? 0;
    if (Math.floor(now / scrapeStep) > Math.floor(was / scrapeStep))
      changes.push({ zone: 0, kind: "scrape", amount: now - was });
    look[scrapeAt + k] = now;
  });
  for (let wheel = 0; wheel < hubs.length; wheel++) {
    const now = damage[offset + partIndex.suspension + wheel] ?? 0;
    const was = look[armsAt + wheel] ?? 0;
    if (wheelGone(now) && !wheelGone(was))
      changes.push({ zone: wheel, kind: "wheel", amount: 1 });
    look[armsAt + wheel] = now;
  }
  look[flagAt] = 0;
  look[flagAt] = look.some((v) => v > 0) ? 1 : 0;
  return changes;
}

function lookUniforms() {
  const block = (at: number) => {
    const node = uniform(new THREE.Vector4());
    node.onObjectUpdate(({ object }) => {
      node.value.fromArray(lookOf(object), at);
    });
    return node;
  };
  return {
    z0: block(0),
    z1: block(4),
    z2: block(8),
    scrape: block(scrapeAt),
    arms: block(armsAt),
  };
}

let shared: ReturnType<typeof lookUniforms> | null = null;

function looks(): ReturnType<typeof lookUniforms> {
  shared ??= lookUniforms();
  return shared;
}

const hinges = uniformArray(
  [
    new THREE.Vector4(),
    ...zoneSpecs.map((spec) => {
      const [x, y, z] = toGltf(spec.hinge);
      return new THREE.Vector4(x, y, z, spec.bend);
    }),
  ],
  "vec4",
);
const armMode = 3;
const slumpFrom = 0.2;
const slumpCamber = 0.4;
const slumpToe = 0.24;
const slumpDrop = 0.05;
const slumpBack = 0.11;
const slumpOut = 0.17;
const lostArmDrop = 0.16;
const axes = uniformArray(
  [
    new THREE.Vector4(0, 1, 0, 0),
    ...zoneSpecs.map((spec) => {
      if (spec.arm)
        return new THREE.Vector4(
          spec.arm.left ? 1 : -1,
          spec.arm.front ? 1 : 0,
          spec.arm.reach,
          armMode,
        );
      const axis = new THREE.Vector3(...toGltf(spec.axis)).normalize();
      return new THREE.Vector4(axis.x, axis.y, axis.z, spec.tear ? 1 : 0);
    }),
  ],
  "vec4",
);

type FloatNode = THREE.Node<"float">;
type Vec3Node = THREE.Node<"vec3">;

function select4(zone: FloatNode, first: number, values: THREE.Node<"vec4">) {
  const ids = vec4(first, first + 1, first + 2, first + 3);
  const hit = step(abs(vec4(zone, zone, zone, zone).sub(ids)), vec4(0.25));
  return dot(values, hit);
}

function stretchedArm(
  p: Vec3Node,
  hub: Vec3Node,
  axis: THREE.Node<"vec4">,
  bend: FloatNode,
): Vec3Node {
  const side = axis.x;
  const front = axis.y;
  const reach = axis.z;
  const lost = step(1.5, bend);
  const amount = clamp(bend.sub(slumpFrom).div(1 - slumpFrom), 0, 1).pow(1.3);
  const camber = side.mul(slumpCamber).mul(amount);
  const toe = side
    .mul(slumpToe)
    .mul(amount)
    .mul(mix(float(-0.6), float(1), front));
  const shift = vec3(
    side.mul(slumpOut).mul(amount),
    amount.mul(slumpDrop).add(lost.mul(lostArmDrop)).negate(),
    mix(float(slumpBack * 0.6), float(-slumpBack), front).mul(amount),
  );
  const end = vec3(side.mul(reach), p.y, p.z).sub(hub);
  const tilted = vec3(
    end.x.mul(cos(camber)).sub(end.y.mul(sin(camber))),
    end.x.mul(sin(camber)).add(end.y.mul(cos(camber))),
    end.z,
  );
  const turned = vec3(
    tilted.x.mul(cos(toe)).add(tilted.z.mul(sin(toe))),
    tilted.y,
    tilted.z.mul(cos(toe)).sub(tilted.x.mul(sin(toe))),
  );
  const moved = turned.add(shift).sub(end);
  const weight = smoothstep(reach.sub(armInboard), reach, abs(p.x));
  return p.add(moved.mul(weight));
}

export function damageable(material: THREE.NodeMaterial): void {
  const { z0, z1, z2, arms } = looks();
  const tag = attribute<"float">("damageZone", "float");
  const zone = floor(tag);
  const seed = fract(tag);
  const state = select4(zone, 1, z0)
    .add(select4(zone, 5, z1))
    .add(select4(zone, 9, z2));
  const bend = select4(zone, firstArm, arms);
  const slot = int(zone);
  const hinge = hinges.element(slot) as unknown as THREE.Node<"vec4">;
  const axis = axes.element(slot) as unknown as THREE.Node<"vec4">;
  const arm = step(armMode - 0.5, axis.w);
  const tearing = step(0.5, axis.w).mul(float(1).sub(arm));
  const broken = mix(
    step(1.5, state),
    step(seed, state).mul(step(0.001, state)),
    tearing,
  );
  const angle = clamp(state, 0, 1).mul(hinge.w).mul(float(1).sub(tearing));
  const k = mix(axis.xyz, vec3(0, 1, 0), arm);
  const p = positionLocal;
  const v = p.sub(hinge.xyz);
  const turned = v
    .mul(cos(angle))
    .add(cross(k, v).mul(sin(angle)))
    .add(k.mul(dot(k, v)).mul(float(1).sub(cos(angle))))
    .add(hinge.xyz);
  material.positionNode = mix(
    mix(turned, hinge.xyz, broken),
    stretchedArm(p, hinge.xyz, axis, bend),
    arm,
  );
}

export interface ScrapeInput {
  colour: Vec3Node;
  roughness: FloatNode;
  height?: FloatNode;
  coat?: FloatNode;
}

export interface Scraped {
  colour: Vec3Node;
  roughness: FloatNode;
  height: FloatNode;
  coat: FloatNode;
}

const scrapeTop = 0.47;
const scrapeBottom = 0.03;

const edgeBand = 0.022;

function scrapeMask(): THREE.Node<"vec2"> {
  const { scrape } = looks();
  return Fn(() => {
    const found = vec2(0, 0).toVar();
    const p = positionGeometry.toVar();
    const amounts = scrape.toVar();
    If(amounts.w.greaterThan(0.5), () => {
      const x = p.z;
      const y = p.x;
      const z = p.y;
      const sideAmount = mix(amounts.y, amounts.x, step(0, y));
      const ragged = mx_noise_float(p.mul(7.5))
        .mul(0.085)
        .add(mx_noise_float(p.mul(23)).mul(0.03))
        .add(mx_noise_float(p.mul(61)).mul(0.012));
      const taper = smoothstep(-1.95, -1.35, x).mul(smoothstep(1.25, 0.95, x));
      const lead = mix(float(0.62), float(1), smoothstep(-0.6, 0.4, x));
      const reach = mix(float(scrapeBottom), float(scrapeTop), sideAmount)
        .mul(mix(float(0.45), lead, taper))
        .add(ragged);
      const along = step(0.13, abs(y))
        .mul(step(-1.95, x))
        .mul(step(x, 1.2))
        .mul(step(0.02, sideAmount));
      const flank = along.mul(step(z, reach));
      const flankEdge = flank.mul(smoothstep(reach.sub(edgeBand), reach, z));
      const noseReach = mix(float(0.02), float(0.2), amounts.z).add(
        ragged.mul(0.5),
      );
      const noseOn = step(1.9, x)
        .mul(step(abs(y), 0.16))
        .mul(step(0.05, amounts.z));
      const nose = noseOn.mul(step(z, noseReach));
      const noseEdge = nose.mul(
        smoothstep(noseReach.sub(edgeBand), noseReach, z),
      );
      found.assign(vec2(max(flank, nose), max(flankEdge, noseEdge)));
    });
    return found;
  })();
}

function ridged(q: Vec3Node, scale: number): FloatNode {
  return float(1).sub(abs(mx_noise_float(q.mul(scale))));
}

export function scraped(input: ScrapeInput): Scraped {
  const found = scrapeMask().toVar();
  const mask = found.x;
  const edge = found.y;
  const p = positionGeometry;
  const wear = Fn(() => {
    const value = vec2(0.5, 0).toVar();
    const q = p.toVar();
    If(mask.greaterThan(0), () => {
      const coarse = ridged(q, 64).pow(3);
      const fine = ridged(q, 170).pow(2);
      const fleck = step(0.35, mx_noise_float(q.mul(140)));
      value.assign(vec2(coarse.mul(0.62).add(fine.mul(0.38)), fleck));
    });
    return value;
  })().toVar();
  const crumple = wear.x;
  const carbon = vec3(0.07, 0.067, 0.062).mul(crumple.mul(1.9).add(0.25));
  const upright = smoothstep(0.8, 0.45, abs(normalGeometry.y));
  const torn = mix(
    carbon,
    vec3(0.3, 0.29, 0.28),
    edge.mul(upright).mul(wear.y).mul(0.7),
  );
  return {
    colour: mix(input.colour, torn, mask),
    roughness: mix(
      input.roughness,
      mix(float(0.6), float(0.34), crumple),
      mask,
    ),
    height: mix(input.height ?? float(0), crumple.mul(2.2), mask),
    coat: (input.coat ?? float(0)).mul(float(1).sub(mask)),
  };
}

export interface WheelSlump {
  camber: number;
  toe: number;
  drop: number;
  back: number;
  out: number;
}

export function wheelSlump(
  bend: number,
  left: boolean,
  front: boolean,
): WheelSlump {
  const amount = ramp(Math.min(1, bend), slumpFrom, 1) ** 1.3;
  const side = left ? 1 : -1;
  return {
    camber: side * slumpCamber * amount,
    toe: side * slumpToe * amount * (front ? 1 : -0.6),
    drop: slumpDrop * amount,
    back: (front ? -slumpBack : slumpBack * 0.6) * amount,
    out: side * slumpOut * amount,
  };
}
