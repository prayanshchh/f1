import * as THREE from "three/webgpu";
import { float, positionWorld, texture, uniform, vec2, vec3 } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  wallLeft: number;
  wallRight: number;
}

export interface PitSpan {
  entry: number;
  exit: number;
}

export interface Pole {
  base: THREE.Vector3;
  head: THREE.Vector3;
  aim: THREE.Vector3;
  power: number;
}

export interface FloodMap {
  data: Float32Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
  texel: number;
}

const spacing = 50;
const clearance = 3.5;
const baseHeight = 21;
const heightPerMetre = 0.22;
const tallest = 34;
const buried = 6;
const aimBeyond = 2.5;
const beamInner = Math.cos((40 * Math.PI) / 180);
const beamOuter = Math.cos((78 * Math.PI) / 180);
const reach = 150;
const margin = 160;
const texelTarget = 0.8;
const largestMap = 2048;
const brightest = 3;
const poleRadius = 0.2;
const headWidth = 3.6;
const headHeight = 1.9;
const headDepth = 0.35;
const lampColumns = 4;
const lampRows = 2;
const lampSize = 0.74;
const lampColour = new THREE.Color(1, 0.96, 0.9);
const lampPeak = 60;

function lengths(points: TrackPoint[]): number[] {
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) break;
    along.push((along[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return along;
}

function inPit(distance: number, pit: PitSpan | null): boolean {
  if (!pit) return false;
  return pit.entry > pit.exit
    ? distance >= pit.entry || distance <= pit.exit
    : distance >= pit.entry && distance <= pit.exit;
}

function poleAt(
  points: TrackPoint[],
  index: number,
  side: 1 | -1,
): Pole | null {
  const point = points[index];
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  if (!point || !before || !after) return null;
  const tx = after.x - before.x;
  const tz = after.z - before.z;
  const length = Math.hypot(tx, tz);
  if (length === 0) return null;
  const nx = (tz / length) * side;
  const nz = (-tx / length) * side;
  const wall = side === 1 ? point.wallLeft : point.wallRight;
  const lateral = wall + clearance;
  const height = Math.min(tallest, baseHeight + heightPerMetre * lateral);
  const x = point.x + nx * lateral;
  const z = point.z + nz * lateral;
  const aim = new THREE.Vector3(
    point.x - nx * aimBeyond,
    point.y,
    point.z - nz * aimBeyond,
  );
  const head = new THREE.Vector3(x, point.y + height, z);
  return {
    base: new THREE.Vector3(x, point.y - buried, z),
    head,
    aim,
    power: head.distanceToSquared(aim),
  };
}

function nearest(along: number[], distance: number): number {
  let low = 0;
  let high = along.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((along[middle] ?? 0) < distance) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function layoutPoles(points: TrackPoint[], pit: PitSpan | null): Pole[] {
  const along = lengths(points);
  const lap = along[along.length - 1] ?? 0;
  const count = Math.max(1, Math.round(lap / spacing));
  const step = lap / count;
  const poles: Pole[] = [];
  for (let k = 0; k < count; k++)
    for (const side of [1, -1] as const) {
      const distance = (k + (side === 1 ? 0 : 0.5)) * step;
      const placed = side === 1 && inPit(distance, pit) ? -1 : side;
      const pole = poleAt(points, nearest(along, distance), placed);
      if (pole) poles.push(pole);
    }
  return poles;
}

function beam(cosine: number): number {
  const t = Math.min(
    1,
    Math.max(0, (cosine - beamOuter) / (beamInner - beamOuter)),
  );
  return t * t * (3 - 2 * t);
}

export function inWorld(poles: Pole[], toWorld: THREE.Matrix4): Pole[] {
  return poles.map((pole) => ({
    base: pole.base.clone().applyMatrix4(toWorld),
    head: pole.head.clone().applyMatrix4(toWorld),
    aim: pole.aim.clone().applyMatrix4(toWorld),
    power: pole.power,
  }));
}

export function sampleFlood(map: FloodMap, x: number, y: number): number {
  const column = Math.floor((x - map.originX) / map.texel);
  const row = Math.floor((y - map.originY) / map.texel);
  if (column < 0 || row < 0 || column >= map.width || row >= map.height)
    return 0;
  return map.data[row * map.width + column] ?? 0;
}

export function floodMap(track: THREE.Vector3[], lamps: Pole[]): FloodMap {
  const xs = track.map((p) => p.x);
  const ys = track.map((p) => p.y);
  const originX = Math.min(...xs) - margin;
  const originY = Math.min(...ys) - margin;
  const spanX = Math.max(...xs) + margin - originX;
  const spanY = Math.max(...ys) + margin - originY;
  const texel = Math.max(texelTarget, Math.max(spanX, spanY) / largestMap);
  const width = Math.ceil(spanX / texel);
  const height = Math.ceil(spanY / texel);
  const data = new Float32Array(width * height);
  const levels = track
    .filter((_, i) => i % 5 === 0)
    .map((p) => worldLight(lamps, p.x, p.y, p.z))
    .sort((a, b) => a - b);
  const median = levels[Math.floor(levels.length / 2)] ?? 1;
  for (const lamp of lamps)
    addLamp(data, lamp, { width, height, originX, originY, texel });
  for (let i = 0; i < data.length; i++)
    data[i] = Math.min(brightest, (data[i] ?? 0) / median);
  return { data, width, height, originX, originY, texel };
}

interface Grid {
  width: number;
  height: number;
  originX: number;
  originY: number;
  texel: number;
}

function addLamp(data: Float32Array, lamp: Pole, grid: Grid): void {
  const { width, height, originX, originY, texel } = grid;
  const hx = lamp.head.x;
  const hy = lamp.head.y;
  const dz = lamp.aim.z - lamp.head.z;
  if (dz >= 0) return;
  const ax = lamp.aim.x - hx;
  const ay = lamp.aim.y - hy;
  const axis = Math.sqrt(ax * ax + ay * ay + dz * dz);
  const ux = ax / axis;
  const uy = ay / axis;
  const uz = dz / axis;
  const power = lamp.power;
  const span = beamInner - beamOuter;
  const fromRow = Math.max(0, Math.floor((hy - reach - originY) / texel));
  const toRow = Math.min(height - 1, Math.ceil((hy + reach - originY) / texel));
  for (let row = fromRow; row <= toRow; row++) {
    const dy = originY + (row + 0.5) * texel - hy;
    const left = reach * reach - dy * dy - dz * dz;
    if (left <= 0) continue;
    const across = Math.sqrt(left);
    const fromColumn = Math.max(0, Math.floor((hx - across - originX) / texel));
    const toColumn = Math.min(
      width - 1,
      Math.ceil((hx + across - originX) / texel),
    );
    const rowBase = row * width;
    const partial = dy * dy + dz * dz;
    const facingY = dy * uy + dz * uz;
    for (let column = fromColumn; column <= toColumn; column++) {
      const dx = originX + (column + 0.5) * texel - hx;
      const squared = dx * dx + partial;
      const distance = Math.sqrt(squared);
      const t = ((dx * ux + facingY) / distance - beamOuter) / span;
      if (t <= 0) continue;
      const b = t >= 1 ? 1 : t * t * (3 - 2 * t);
      data[rowBase + column] =
        (data[rowBase + column] ?? 0) +
        (power * (-dz / distance) * b) / squared;
    }
  }
}

function worldLight(poles: Pole[], x: number, y: number, z: number): number {
  return poles.reduce((sum, pole) => sum + worldLamp(pole, x, y, z), 0);
}

function worldLamp(pole: Pole, x: number, y: number, z: number): number {
  const dx = x - pole.head.x;
  const dy = y - pole.head.y;
  const dz = z - pole.head.z;
  const squared = dx * dx + dy * dy + dz * dz;
  if (squared > reach * reach || dz >= 0) return 0;
  const distance = Math.sqrt(squared);
  const ax = pole.aim.x - pole.head.x;
  const ay = pole.aim.y - pole.head.y;
  const az = pole.aim.z - pole.head.z;
  const axis = Math.hypot(ax, ay, az);
  const facing = (dx * ax + dy * ay + dz * az) / (distance * axis);
  return (pole.power * (-dz / distance) * beam(facing)) / squared;
}

function lampGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < lampRows; row++)
    for (let column = 0; column < lampColumns; column++) {
      const plane = new THREE.PlaneGeometry(lampSize, lampSize);
      plane.translate(
        (column - (lampColumns - 1) / 2) * (headWidth / lampColumns),
        (row - (lampRows - 1) / 2) * (headHeight / lampRows),
        headDepth / 2 + 0.01,
      );
      parts.push(plane);
    }
  return mergeGeometries(parts);
}

export class Floodlights {
  readonly root = new THREE.Group();
  placed: THREE.Object3D | null = null;
  readonly glow = uniform(0);
  readonly cover: THREE.Node<"float">;
  private readonly map: THREE.DataTexture;

  constructor(poles: Pole[], flood: FloodMap) {
    const half = new Uint16Array(flood.data.length);
    for (let i = 0; i < half.length; i++)
      half[i] = THREE.DataUtils.toHalfFloat(flood.data[i] ?? 0);
    this.map = new THREE.DataTexture(
      half,
      flood.width,
      flood.height,
      THREE.RedFormat,
      THREE.HalfFloatType,
    );
    this.map.minFilter = THREE.LinearFilter;
    this.map.magFilter = THREE.LinearFilter;
    this.map.generateMipmaps = false;
    this.map.needsUpdate = true;
    const size = vec2(flood.width * flood.texel, flood.height * flood.texel);
    const at = positionWorld.xy
      .sub(vec2(flood.originX, flood.originY))
      .div(size);
    this.cover = texture(this.map, at).r;
    this.root.add(...this.meshes(poles));
  }

  private meshes(poles: Pole[]): THREE.Mesh[] {
    const metal = new THREE.MeshStandardNodeMaterial({
      color: 0x5a5d60,
      roughness: 0.55,
      metalness: 0.7,
    });
    const lamp = new THREE.MeshBasicNodeMaterial();
    lamp.colorNode = vec3(lampColour.r, lampColour.g, lampColour.b).mul(
      float(lampPeak).mul(this.glow).add(0.04),
    );
    const pole = new THREE.CylinderGeometry(poleRadius, poleRadius * 1.5, 1, 8);
    pole.translate(0, 0.5, 0);
    const head = new THREE.BoxGeometry(headWidth, headHeight, headDepth);
    const poleMesh = new THREE.InstancedMesh(pole, metal, poles.length);
    const headMesh = new THREE.InstancedMesh(head, metal, poles.length);
    const lampMesh = new THREE.InstancedMesh(
      lampGeometry(),
      lamp,
      poles.length,
    );
    const matrix = new THREE.Matrix4();
    const look = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    poles.forEach((p, i) => {
      matrix.makeScale(1, p.head.y - p.base.y, 1).setPosition(p.base);
      poleMesh.setMatrixAt(i, matrix);
      look.lookAt(p.aim, p.head, up).setPosition(p.head);
      headMesh.setMatrixAt(i, look);
      lampMesh.setMatrixAt(i, look);
    });
    for (const mesh of [poleMesh, headMesh, lampMesh]) {
      mesh.computeBoundingSphere();
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    return [poleMesh, headMesh, lampMesh];
  }
}
