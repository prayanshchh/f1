import * as THREE from "three/webgpu";

const minTriangles = 5000;
const smallMeshRadius = 300;
const smallCell = 60;
const largeCell = 200;
const forestCell = 200;
const staleShare = 0.25;
const casterLayer = 1;
const instanceStride = 16;
const auxiliaryCell = 400;
const auxiliaryForestCell = 800;
const attributeInstances = 1025;

interface Cell {
  sphere: THREE.Sphere;
  size: number;
  visible: boolean;
  shown: boolean;
  end: number;
  runs: number[];
}

export interface SphereTest {
  intersectsSphere(sphere: THREE.Sphere): boolean;
}

function cellKey(x: number, z: number, cell: number): number {
  return Math.floor(x / cell) * 100003 + Math.floor(z / cell);
}

class CellSet {
  readonly cells: Cell[] = [];
  private readonly lookup = new Map<number, number>();

  slot(key: number): Cell {
    let at = this.lookup.get(key);
    if (at === undefined) {
      at = this.cells.length;
      this.lookup.set(key, at);
      this.cells.push({
        sphere: new THREE.Sphere(),
        size: 0,
        visible: true,
        shown: true,
        end: 0,
        runs: [],
      });
    }
    return this.cells[at] as Cell;
  }

  bake(matrix: THREE.Matrix4): void {
    for (const cell of this.cells) cell.sphere.applyMatrix4(matrix);
  }

  look(frustum: SphereTest): boolean {
    let entered = false;
    let stale = 0;
    let total = 0;
    for (const cell of this.cells) {
      cell.visible = frustum.intersectsSphere(cell.sphere);
      if (cell.visible && !cell.shown) entered = true;
      if (cell.shown) {
        total += cell.size;
        if (!cell.visible) stale += cell.size;
      }
    }
    return entered || stale > total * staleShare;
  }
}

function addRun(cell: Cell, start: number, count: number): void {
  const last = cell.runs.length - 2;
  if (
    last >= 0 &&
    (cell.runs[last] ?? 0) + (cell.runs[last + 1] ?? 0) === start
  )
    cell.runs[last + 1] = (cell.runs[last + 1] ?? 0) + count;
  else cell.runs.push(start, count);
  cell.end = start + count;
  cell.size += count;
}

function boundCell(
  cell: Cell,
  position: THREE.BufferAttribute,
  corners: ArrayLike<number>,
): void {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const visit = (use: () => void) => {
    for (let r = 0; r < cell.runs.length; r += 2) {
      const start = cell.runs[r] ?? 0;
      const end = start + (cell.runs[r + 1] ?? 0);
      for (let i = start; i < end; i++) {
        point.fromBufferAttribute(position, corners[i] ?? 0);
        use();
      }
    }
  };
  visit(() => box.expandByPoint(point));
  box.getBoundingSphere(cell.sphere);
  let furthest = 0;
  visit(() => {
    furthest = Math.max(furthest, point.distanceToSquared(cell.sphere.center));
  });
  cell.sphere.radius = Math.sqrt(furthest);
}

function markUpload(
  index: THREE.BufferAttribute,
  start: number,
  count: number,
): void {
  const align = 4 / index.array.BYTES_PER_ELEMENT;
  const first = start - (start % align);
  const end = Math.ceil((start + count) / align) * align;
  index.addUpdateRange(first, Math.min(end, index.array.length) - first);
}

function flipCells(
  cells: Cell[],
  source: Uint16Array | Uint32Array | Float32Array,
  target: THREE.TypedArray,
  upload: (start: number, count: number) => void,
): number {
  let end = 0;
  for (const cell of cells) {
    if (cell.visible !== cell.shown) {
      for (let r = 0; r < cell.runs.length; r += 2) {
        const start = cell.runs[r] ?? 0;
        const count = cell.runs[r + 1] ?? 0;
        if (cell.visible)
          target.set(source.subarray(start, start + count), start);
        else target.fill(0, start, start + count);
        upload(start, count);
      }
      cell.shown = cell.visible;
    }
    if (cell.shown) end = Math.max(end, cell.end);
  }
  return end;
}

export class CulledMesh {
  private readonly set = new CellSet();
  private readonly source: Uint16Array | Uint32Array;
  private readonly index: THREE.BufferAttribute;
  private readonly order: Cell[] = [];

  constructor(
    private readonly mesh: THREE.Mesh,
    cellSize: number,
    private readonly inPlace: boolean,
  ) {
    const position = mesh.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    this.index = mesh.geometry.index as THREE.BufferAttribute;
    this.source = (this.index.array as Uint16Array | Uint32Array).slice();
    const { source } = this;
    for (let i = 0; i < source.length; i += 3) {
      const a = source[i] ?? 0;
      const b = source[i + 1] ?? 0;
      const c = source[i + 2] ?? 0;
      const cell = this.set.slot(
        cellKey(
          (position.getX(a) + position.getX(b) + position.getX(c)) / 3,
          (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3,
          cellSize,
        ),
      );
      addRun(cell, i, 3);
      if (!inPlace) this.order.push(cell);
    }
    for (const cell of this.set.cells) boundCell(cell, position, source);
    mesh.frustumCulled = false;
  }

  bake(): void {
    this.set.bake(this.mesh.matrixWorld);
  }

  keep(kept: Set<unknown>): void {
    kept.add(this.index);
  }

  private collapse(): number {
    return flipCells(
      this.set.cells,
      this.source,
      this.index.array,
      (start, count) => {
        markUpload(this.index, start, count);
      },
    );
  }

  private compact(): number {
    const target = this.index.array;
    const { source } = this;
    for (const cell of this.set.cells) cell.shown = cell.visible;
    let count = 0;
    for (let triangle = 0; triangle < this.order.length; triangle++) {
      if (!this.order[triangle]?.shown) continue;
      const i = triangle * 3;
      target[count++] = source[i] ?? 0;
      target[count++] = source[i + 1] ?? 0;
      target[count++] = source[i + 2] ?? 0;
    }
    this.index.clearUpdateRanges();
    markUpload(this.index, 0, count);
    return count;
  }

  update(frustum: SphereTest): void {
    if (!this.set.look(frustum)) return;
    const count = this.inPlace ? this.collapse() : this.compact();
    this.index.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, count);
    this.mesh.visible = count > 0;
  }
}

export class CulledForest {
  private readonly set = new CellSet();
  private readonly source: Float32Array;

  constructor(private readonly mesh: THREE.InstancedMesh) {
    this.source = (mesh.instanceMatrix.array as Float32Array).slice();
    const bounds = mesh.geometry.boundingSphere;
    if (!bounds) throw new Error("forest mesh has no bounds");
    const matrix = new THREE.Matrix4();
    const placed = new THREE.Sphere();
    const boxes = new Map<Cell, THREE.Box3>();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      placed.copy(bounds).applyMatrix4(matrix);
      const cell = this.set.slot(
        cellKey(placed.center.x, placed.center.z, forestCell),
      );
      addRun(cell, i * instanceStride, instanceStride);
      const box = boxes.get(cell) ?? new THREE.Box3();
      box.union(placed.getBoundingBox(new THREE.Box3()));
      boxes.set(cell, box);
    }
    boxes.forEach((box, cell) => box.getBoundingSphere(cell.sphere));
    mesh.frustumCulled = false;
  }

  bake(): void {
    this.set.bake(this.mesh.matrixWorld);
  }

  keep(kept: Set<unknown>): void {
    kept.add(this.mesh.instanceMatrix);
  }

  update(frustum: SphereTest): void {
    if (!this.set.look(frustum)) return;
    const { instanceMatrix } = this.mesh;
    const end = flipCells(
      this.set.cells,
      this.source,
      instanceMatrix.array,
      (start, count) => {
        instanceMatrix.addUpdateRange(start, count);
      },
    );
    instanceMatrix.needsUpdate = true;
    this.mesh.count = end / instanceStride;
    this.mesh.visible = end > 0;
  }
}

function copyPlacement(from: THREE.Mesh, to: THREE.Mesh): void {
  to.name = from.name;
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
  to.scale.copy(from.scale);
  to.renderOrder = from.renderOrder;
  to.receiveShadow = from.receiveShadow;
}

function casterCopy(mesh: THREE.Mesh): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes))
    geometry.setAttribute(name, attribute);
  const index = mesh.geometry.index as THREE.BufferAttribute;
  geometry.setIndex(new THREE.BufferAttribute(index.array.slice(), 1));
  geometry.boundingSphere = mesh.geometry.boundingSphere;
  const copy = new THREE.Mesh(geometry, mesh.material);
  copyPlacement(mesh, copy);
  copy.castShadow = true;
  copy.receiveShadow = false;
  copy.layers.set(casterLayer);
  mesh.parent?.add(copy);
  return copy;
}

function tileCounts(
  source: ArrayLike<number>,
  position: THREE.BufferAttribute,
  cellSize: number,
): { keys: Float64Array; sizes: Map<number, number> } {
  const keys = new Float64Array(source.length / 3);
  const sizes = new Map<number, number>();
  for (let i = 0; i < source.length; i += 3) {
    const a = source[i] ?? 0;
    const b = source[i + 1] ?? 0;
    const c = source[i + 2] ?? 0;
    const key = cellKey(
      (position.getX(a) + position.getX(b) + position.getX(c)) / 3,
      (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3,
      cellSize,
    );
    keys[i / 3] = key;
    sizes.set(key, (sizes.get(key) ?? 0) + 3);
  }
  return { keys, sizes };
}

function tileTriangles(
  source: ArrayLike<number>,
  position: THREE.BufferAttribute,
  cellSize: number,
): Uint32Array[] {
  const { keys, sizes } = tileCounts(source, position, cellSize);
  const tiles = new Map<number, Uint32Array>();
  const filled = new Map<number, number>();
  for (const [key, size] of sizes) tiles.set(key, new Uint32Array(size));
  for (let i = 0; i < source.length; i += 3) {
    const key = keys[i / 3] ?? 0;
    const at = filled.get(key) ?? 0;
    tiles
      .get(key)
      ?.set([source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0], at);
    filled.set(key, at + 3);
  }
  return Array.from(tiles.values());
}

function tiledCopies(
  mesh: THREE.Mesh,
  cellSize: number,
  group: THREE.Group,
): void {
  const position = mesh.geometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  const source = (mesh.geometry.index as THREE.BufferAttribute).array;
  for (const tile of tileTriangles(source, position, cellSize)) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes))
      geometry.setAttribute(name, attribute);
    geometry.setIndex(new THREE.BufferAttribute(tile, 1));
    geometry.boundingSphere = mesh.geometry.boundingSphere;
    const piece = new THREE.Mesh(geometry, mesh.material);
    Object.assign(piece, { boundingSphere: cornerSphere(position, tile) });
    copyPlacement(mesh, piece);
    group.add(piece);
  }
}

function cornerSphere(
  position: THREE.BufferAttribute,
  corners: Uint32Array,
): THREE.Sphere {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const corner of corners)
    box.expandByPoint(point.fromBufferAttribute(position, corner));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  let furthest = 0;
  for (const corner of corners) {
    point.fromBufferAttribute(position, corner);
    furthest = Math.max(furthest, point.distanceToSquared(sphere.center));
  }
  sphere.radius = Math.sqrt(furthest);
  return sphere;
}

function tiledForest(mesh: THREE.InstancedMesh, group: THREE.Group): void {
  const groups = new Map<number, number[]>();
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    const key = cellKey(
      matrix.elements[12],
      matrix.elements[14],
      auxiliaryForestCell,
    );
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  }
  for (const members of groups.values()) {
    const piece = new THREE.InstancedMesh(
      mesh.geometry,
      mesh.material,
      members.length,
    );
    piece.instanceMatrix = new THREE.InstancedBufferAttribute(
      new Float32Array(16 * Math.max(attributeInstances, members.length)),
      16,
    );
    members.forEach((source, target) => {
      mesh.getMatrixAt(source, matrix);
      piece.setMatrixAt(target, matrix);
    });
    piece.computeBoundingSphere();
    copyPlacement(mesh, piece);
    group.add(piece);
  }
}

export function showCasters(camera: THREE.Camera): void {
  camera.layers.enable(casterLayer);
}

export class WorldCuller {
  private readonly seen: (CulledMesh | CulledForest)[] = [];
  private readonly cast: CulledMesh[] = [];
  private readonly mainGroups = new Map<THREE.Object3D, THREE.Group>();
  private readonly auxiliaryGroups = new Map<THREE.Object3D, THREE.Group>();

  constructor(root: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object as THREE.Mesh);
    });
    for (const mesh of meshes) this.add(mesh);
    this.showAuxiliary(false);
  }

  private groupFor(
    groups: Map<THREE.Object3D, THREE.Group>,
    mesh: THREE.Mesh,
  ): THREE.Group {
    const parent = mesh.parent as THREE.Object3D;
    let group = groups.get(parent);
    if (!group) {
      group = new THREE.Group();
      parent.add(group);
      groups.set(parent, group);
    }
    return group;
  }

  private add(mesh: THREE.Mesh): void {
    const auxiliary = this.groupFor(this.auxiliaryGroups, mesh);
    const main = this.groupFor(this.mainGroups, mesh);
    if (mesh instanceof THREE.InstancedMesh) {
      tiledForest(mesh as THREE.InstancedMesh, auxiliary);
      main.add(mesh);
      this.seen.push(new CulledForest(mesh as THREE.InstancedMesh));
      return;
    }
    const { index, boundingSphere } = mesh.geometry;
    if (!index || index.count / 3 < minTriangles) return;
    const radius = boundingSphere?.radius ?? 0;
    const cell = radius < smallMeshRadius ? smallCell : largeCell;
    if (radius < cell) return;
    if (mesh.castShadow) {
      this.cast.push(new CulledMesh(casterCopy(mesh), smallCell, false));
      mesh.castShadow = false;
    }
    tiledCopies(
      mesh,
      radius < smallMeshRadius ? smallCell : auxiliaryCell,
      auxiliary,
    );
    main.add(mesh);
    this.seen.push(new CulledMesh(mesh, cell, true));
  }

  showAuxiliary(on: boolean): void {
    for (const group of this.auxiliaryGroups.values()) group.visible = on;
    for (const group of this.mainGroups.values()) group.visible = !on;
  }

  bake(): void {
    for (const item of [...this.seen, ...this.cast]) item.bake();
  }

  retained(): Set<unknown> {
    const kept = new Set<unknown>();
    for (const item of [...this.seen, ...this.cast]) item.keep(kept);
    return kept;
  }

  update(main: SphereTest, sun: SphereTest): void {
    for (const item of this.seen) item.update(main);
    for (const item of this.cast) item.update(sun);
  }
}
