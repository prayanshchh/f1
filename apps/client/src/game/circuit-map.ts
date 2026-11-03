import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  float,
  fract,
  mix,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import mapUrl from "../../../../content/tracks/hill-country/circuit-map.json?url";

const pink = new THREE.Color(0.86, 0.26, 0.3);
const teal = new THREE.Color(0.2, 0.45, 0.54);
const roadWidth = 40;
const laneWidth = 24;
const aisleWidth = 3.4;
const trackGlowWidth = 66;
const trackBandWidth = 22;
const trackCoreWidth = 6;
const zoneWidth = 18;
const elevationScale = 4.6;
const elevationBase = 4;
const horizonRadii = [5300, 5650, 6050];
const horizonCentre = new THREE.Vector2(780, -130);
const buildingTop = new THREE.Color(0.15, 0.27, 0.32);
const buildingSide = new THREE.Color(0.055, 0.11, 0.14);
const parkingColour = new THREE.Color(0.035, 0.07, 0.085);
const waterColour = new THREE.Color(0.02, 0.05, 0.08);
const zoneGreen = new THREE.Color(0.44, 0.95, 0.2);
const detectionPurple = new THREE.Color(0.86, 0.2, 0.92);

export interface CircuitData {
  roads: number[][];
  lanes: number[][];
  aisles: number[][];
  parking: number[][];
  water: number[][];
  buildings: { height: number; footprint: number[] }[];
  track: { length: number; points: number[] };
  turns: { number: number; distance: number; side: string }[];
  sectors: number[];
  straights: [number, number][];
  speedTrap: number;
}

type Path = [number, number, number][];

class Ribbon {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly heights: number[] = [];
  readonly indices: number[] = [];

  add(path: Path, width: number, lifted: boolean): void {
    const base = this.positions.length / 3;
    path.forEach((point, index) => {
      const before = path[Math.max(0, index - 1)] ?? point;
      const after = path[Math.min(path.length - 1, index + 1)] ?? point;
      const dx = after[0] - before[0];
      const dz = after[2] - before[2];
      const length = Math.hypot(dx, dz) || 1;
      const nx = (-dz / length) * (width / 2);
      const nz = (dx / length) * (width / 2);
      for (const side of [-1, 1]) {
        this.positions.push(point[0] + nx * side, 0, point[2] + nz * side);
        this.uvs.push(index, (side + 1) / 2);
        this.heights.push(lifted ? point[1] : 0);
      }
      if (index === 0) return;
      const a = base + (index - 1) * 2;
      this.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    });
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute(
      "lift",
      new THREE.Float32BufferAttribute(this.heights, 1),
    );
    geometry.setIndex(this.indices);
    return geometry;
  }
}

function pathOf(flat: number[], y = 0): Path {
  const path: Path = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    path.push([flat[i] ?? 0, y, flat[i + 1] ?? 0]);
  return path;
}

function ribbonOf(paths: number[][], width: number): THREE.BufferGeometry {
  const ribbon = new Ribbon();
  for (const flat of paths) ribbon.add(pathOf(flat), width, false);
  return ribbon.geometry();
}

function glowMaterial(
  colour: THREE.Color,
  power: number,
  strength: number,
  lift: THREE.UniformNode<"float", number> | null = null,
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const across = float(1).sub(abs(uv().y.mul(2).sub(1)));
  material.colorNode = vec3(colour.r, colour.g, colour.b);
  material.opacityNode = pow(across, float(power)).mul(strength);
  if (lift)
    material.positionNode = vec3(
      positionLocal.x,
      attribute<"float">("lift", "float").mul(lift).add(0.5),
      positionLocal.z,
    );
  return material;
}

function capFaces(
  contour: THREE.Vector2[],
  base: number,
  indices: number[],
): void {
  for (const [a = 0, b = 0, c = 0] of THREE.ShapeUtils.triangulateShape(
    contour,
    [],
  ))
    indices.push(base + a, base + b, base + c);
}

function flatArea(
  polygons: number[][],
  colour: THREE.Color,
  y: number,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const flat of polygons) {
    const contour = pathOf(flat).map(([x, , z]) => new THREE.Vector2(x, z));
    const base = positions.length / 3;
    for (const point of contour) positions.push(point.x, y, point.y);
    capFaces(contour, base, indices);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.colorNode = vec3(colour.r, colour.g, colour.b);
  return new THREE.Mesh(geometry, material);
}

function buildingsMesh(data: CircuitData): THREE.Mesh {
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number, c: THREE.Color) => {
    positions.push(x, y, z);
    colours.push(c.r, c.g, c.b);
    return positions.length / 3 - 1;
  };
  for (const { height, footprint } of data.buildings) {
    const ring = pathOf(footprint);
    const contour = ring.map(([x, , z]) => new THREE.Vector2(x, z));
    const top = height * 1.7;
    const base = positions.length / 3;
    for (const point of contour) vertex(point.x, top, point.y, buildingTop);
    capFaces(contour, base, indices);
    ring.forEach(([x, , z], index) => {
      const [nx = 0, , nz = 0] = ring[(index + 1) % ring.length] ?? [];
      const a = vertex(x, 0, z, buildingSide);
      const b = vertex(nx, 0, nz, buildingSide);
      const c = vertex(nx, top, nz, buildingSide);
      const d = vertex(x, top, z, buildingSide);
      indices.push(a, b, c, a, c, d);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  return new THREE.Mesh(geometry, material);
}

function ringMesh(
  at: THREE.Vector3,
  colour: THREE.Color,
  fade: THREE.UniformNode<"float", number>,
): THREE.Mesh {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = vec3(colour.r, colour.g, colour.b);
  material.opacityNode = fade;
  const mesh = new THREE.Mesh(new THREE.RingGeometry(34, 58, 48), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(at.x, 2, at.z);
  return mesh;
}

export interface MapPose {
  azimuth: number;
  elevation: number;
  distance: number;
  target: [number, number, number];
  fov: number;
}

export function mixPose(a: MapPose, b: MapPose, t: number): MapPose {
  const blend = (x: number, y: number) => x + (y - x) * t;
  return {
    azimuth: blend(a.azimuth, b.azimuth),
    elevation: blend(a.elevation, b.elevation),
    distance: blend(a.distance, b.distance),
    target: [
      blend(a.target[0], b.target[0]),
      blend(a.target[1], b.target[1]),
      blend(a.target[2], b.target[2]),
    ],
    fov: blend(a.fov, b.fov),
  };
}

export class CircuitMap {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 10, 30000);
  readonly lift = uniform(0);
  readonly zones = uniform(0);
  readonly fade = uniform(1);
  private readonly points: THREE.Vector3[];

  private constructor(readonly data: CircuitData) {
    this.points = this.centreline();
    this.scene.background = new THREE.Color(0, 0, 0);
    this.buildGround();
    this.buildTrack();
    this.buildZones();
  }

  static async load(): Promise<CircuitMap> {
    const response = await fetch(mapUrl);
    if (!response.ok) throw new Error("failed to load the circuit map");
    return new CircuitMap((await response.json()) as CircuitData);
  }

  private centreline(): THREE.Vector3[] {
    const flat = this.data.track.points;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3)
      points.push(
        new THREE.Vector3(flat[i] ?? 0, flat[i + 1] ?? 0, flat[i + 2] ?? 0),
      );
    return points;
  }

  private elevated(point: THREE.Vector3): number {
    const low = Math.min(...this.lowest());
    return (point.y - low + elevationBase) * elevationScale;
  }

  private lowestHeight: number[] | null = null;

  private lowest(): number[] {
    this.lowestHeight ??= [Math.min(...this.points.map((p) => p.y))];
    return this.lowestHeight;
  }

  pointAt(distance: number): THREE.Vector3 {
    const length = this.data.track.length;
    const wrapped = ((distance % length) + length) % length;
    const index = Math.floor((wrapped / length) * this.points.length);
    return (this.points[index] ?? new THREE.Vector3()).clone();
  }

  raisedAt(distance: number): THREE.Vector3 {
    const point = this.pointAt(distance);
    return new THREE.Vector3(
      point.x,
      this.elevated(point) * this.lift.value,
      point.z,
    );
  }

  private buildGround(): void {
    const { data } = this;
    const add = (mesh: THREE.Mesh, order: number) => {
      mesh.renderOrder = order;
      this.scene.add(mesh);
    };
    add(flatArea(data.parking, parkingColour, -1), 0);
    add(flatArea(data.water, waterColour, -0.8), 0);
    add(
      new THREE.Mesh(
        ribbonOf(data.aisles, aisleWidth),
        glowMaterial(teal, 0.7, 0.75),
      ),
      1,
    );
    add(
      new THREE.Mesh(
        ribbonOf(data.lanes, laneWidth),
        glowMaterial(pink, 1.6, 0.42),
      ),
      2,
    );
    add(
      new THREE.Mesh(
        ribbonOf(data.roads, roadWidth),
        glowMaterial(pink, 1.4, 0.62),
      ),
      2,
    );
    add(buildingsMesh(data), 3);
    const arcs = new Ribbon();
    for (const radius of horizonRadii) {
      const path: Path = [];
      for (let i = 0; i <= 240; i++) {
        const angle = (i / 240) * Math.PI * 2;
        path.push([
          horizonCentre.x + Math.cos(angle) * radius,
          0,
          horizonCentre.y + Math.sin(angle) * radius,
        ]);
      }
      arcs.add(path, 150, false);
    }
    add(new THREE.Mesh(arcs.geometry(), glowMaterial(pink, 1.1, 0.55)), 2);
  }

  private raisedPath(): Path {
    const closed = [...this.points, this.points[0] ?? new THREE.Vector3()];
    return closed.map((p) => [p.x, this.elevated(p), p.z]);
  }

  private buildTrack(): void {
    const path = this.raisedPath();
    const layer = (
      width: number,
      colour: THREE.Color,
      power: number,
      strength: number,
    ) => {
      const ribbon = new Ribbon();
      ribbon.add(path, width, true);
      const mesh = new THREE.Mesh(
        ribbon.geometry(),
        glowMaterial(colour, power, strength, this.lift),
      );
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    };
    this.buildWall(path);
    layer(trackGlowWidth, new THREE.Color(0.95, 0.05, 0.05), 1.4, 0.75);
    layer(trackBandWidth, new THREE.Color(1, 0.1, 0.09), 0.25, 1);
    layer(trackCoreWidth, new THREE.Color(1, 1, 1), 0.2, 1);
  }

  private buildWall(path: Path): void {
    const positions: number[] = [];
    const lifts: number[] = [];
    const levels: number[] = [];
    const indices: number[] = [];
    path.forEach(([x, top, z], index) => {
      positions.push(x, 0, z, x, 0, z);
      lifts.push(0, top);
      levels.push(0, top);
      if (index === 0) return;
      const a = (index - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("lift", new THREE.Float32BufferAttribute(lifts, 1));
    geometry.setAttribute("level", new THREE.Float32BufferAttribute(levels, 1));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const level = attribute<"float">("level", "float");
    const stripes = smoothstep(0.62, 0.95, fract(level.div(9)));
    material.positionNode = vec3(
      positionLocal.x,
      level.mul(this.lift),
      positionLocal.z,
    );
    material.colorNode = mix(
      vec3(0.62, 0.02, 0.02),
      vec3(1, 0.2, 0.16),
      stripes,
    );
    material.opacityNode = this.lift
      .greaterThan(0.01)
      .select(float(0.92), float(0));
    const wall = new THREE.Mesh(geometry, material);
    wall.renderOrder = 5;
    wall.frustumCulled = false;
    this.scene.add(wall);
  }

  private spanPath(from: number, to: number): Path {
    const length = this.data.track.length;
    const span = (to - from + length) % length || length;
    const steps = Math.max(2, Math.round(span / 10));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const p = this.pointAt(from + (span * i) / steps);
      return [p.x, 0, p.z];
    });
  }

  private buildZones(): void {
    const ribbon = new Ribbon();
    for (const [from, to] of this.data.straights)
      ribbon.add(this.spanPath(from, to), zoneWidth, false);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.colorNode = vec3(zoneGreen.r, zoneGreen.g, zoneGreen.b);
    material.opacityNode = this.zones;
    const mesh = new THREE.Mesh(ribbon.geometry(), material);
    mesh.position.y = 3;
    mesh.renderOrder = 7;
    this.scene.add(mesh);
    this.scene.add(
      ringMesh(
        this.pointAt(this.data.track.length * 0.94),
        zoneGreen,
        this.zones,
      ),
      ringMesh(this.pointAt(this.data.speedTrap), detectionPurple, this.zones),
    );
  }

  setPose(pose: MapPose, aspect: number): void {
    const [tx, ty, tz] = pose.target;
    const flat = Math.cos(pose.elevation) * pose.distance;
    this.camera.position.set(
      tx + Math.cos(pose.azimuth) * flat,
      ty + Math.sin(pose.elevation) * pose.distance,
      tz + Math.sin(pose.azimuth) * flat,
    );
    this.camera.aspect = aspect;
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateMatrixWorld();
  }

  project(world: THREE.Vector3): { x: number; y: number; depth: number } {
    const ndc = world.clone().project(this.camera);
    return {
      x: (ndc.x + 1) / 2,
      y: (1 - ndc.y) / 2,
      depth: world.distanceTo(this.camera.position),
    };
  }

  dispose(): void {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      (object.geometry as THREE.BufferGeometry).dispose();
      (object.material as THREE.Material).dispose();
    });
  }
}
