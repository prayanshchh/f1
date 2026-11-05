import * as THREE from "three/webgpu";

const minTriangles = 5000;
const smallMeshRadius = 300;
const smallCell = 60;
const largeCell = 200;
const forestCell = 200;
const staleShare = 0.25;
const instanceStride = 16;

interface Cell {
  sphere: THREE.Sphere;
  size: number;
  visible: boolean;
  shown: boolean;
  end: number;
  runs: number[];
  seen: number;
}

interface RunOrder {
  starts: Int32Array;
  ends: Int32Array;
  cells: Cell[];
}

export interface SphereTest {
  intersectsSphere(sphere: THREE.Sphere): boolean;
  containsSphere?(sphere: THREE.Sphere): boolean;
}

export function frustumContains(
  frustum: THREE.Frustum,
  sphere: THREE.Sphere,
): boolean {
  for (const plane of frustum.planes)
    if (plane.distanceToPoint(sphere.center) < sphere.radius) return false;
  return true;
}

interface Node {
  sphere: THREE.Sphere;
  first: number;
  last: number;
  next: number;
  leaf: boolean;
  quiet: boolean;
}

const leafCells = 8;
const viewGroups = 6;
const narrowCellLimit = 4096;
const boundSlack = 1e-6;

interface Tally {
  entered: boolean;
  stale: number;
  total: number;
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
        seen: 0,
      });
    }
    return this.cells[at] as Cell;
  }

  private sorted: Cell[] = [];
  private nodes: Node[] = [];
  private readonly tally: Tally = { entered: false, stale: 0, total: 0 };

  bake(matrix: THREE.Matrix4): void {
    for (const cell of this.cells) cell.sphere.applyMatrix4(matrix);
    this.nodes = [];
  }

  private build(): void {
    this.sorted = this.cells.slice();
    this.nodes = [];
    if (this.sorted.length > 0) this.split(0, this.sorted.length);
  }

  private split(first: number, last: number): void {
    const node: Node = {
      sphere: this.enclose(first, last),
      first,
      last,
      next: 0,
      leaf: last - first <= leafCells,
      quiet: false,
    };
    this.nodes.push(node);
    if (!node.leaf) {
      const part = this.sorted.slice(first, last);
      const axis = widestAxis(part);
      part.sort((a, b) => a.sphere.center[axis] - b.sphere.center[axis]);
      for (let i = 0; i < part.length; i++)
        this.sorted[first + i] = part[i] as Cell;
      const middle = first + Math.floor(part.length / 2);
      this.split(first, middle);
      this.split(middle, last);
    }
    node.next = this.nodes.length;
  }

  private enclose(first: number, last: number): THREE.Sphere {
    const box = new THREE.Box3();
    for (let i = first; i < last; i++) {
      const { center } = (this.sorted[i] as Cell).sphere;
      box.expandByPoint(center);
    }
    const sphere = new THREE.Sphere();
    box.getCenter(sphere.center);
    let radius = 0;
    for (let i = first; i < last; i++) {
      const child = (this.sorted[i] as Cell).sphere;
      radius = Math.max(
        radius,
        sphere.center.distanceTo(child.center) + child.radius,
      );
    }
    sphere.radius = radius + boundSlack * (1 + radius);
    return sphere;
  }

  gather(view: SphereTest, stamp: number): void {
    if (this.nodes.length === 0 && this.cells.length > 0) this.build();
    let at = 0;
    while (at < this.nodes.length) {
      const node = this.nodes[at] as Node;
      if (!view.intersectsSphere(node.sphere)) {
        at = node.next;
        continue;
      }
      if (!node.leaf) {
        at += 1;
        continue;
      }
      for (let i = node.first; i < node.last; i++) {
        const cell = this.sorted[i] as Cell;
        if (cell.shown && view.intersectsSphere(cell.sphere)) cell.seen = stamp;
      }
      at = node.next;
    }
  }

  runOrder(): RunOrder {
    const extents = this.cells.map((cell) => {
      let start = Infinity;
      let end = 0;
      for (let r = 0; r < cell.runs.length; r += 2) {
        start = Math.min(start, cell.runs[r] ?? 0);
        end = Math.max(end, (cell.runs[r] ?? 0) + (cell.runs[r + 1] ?? 0));
      }
      return { start, end, cell };
    });
    extents.sort((a, b) => a.start - b.start);
    return {
      starts: Int32Array.from(extents, (extent) => extent.start),
      ends: Int32Array.from(extents, (extent) => extent.end),
      cells: extents.map((extent) => extent.cell),
    };
  }

  get cellCount(): number {
    return this.cells.length;
  }

  look(frustum: SphereTest): boolean {
    if (this.nodes.length === 0 && this.cells.length > 0) this.build();
    const tally = this.tally;
    tally.entered = false;
    tally.stale = 0;
    tally.total = 0;
    let at = 0;
    while (at < this.nodes.length) at = this.visit(at, frustum);
    return this.changed();
  }

  private changed(): boolean {
    const { entered, stale, total } = this.tally;
    return entered || stale > total * staleShare;
  }

  private visit(at: number, frustum: SphereTest): number {
    const node = this.nodes[at] as Node;
    if (!frustum.intersectsSphere(node.sphere)) {
      if (!node.quiet) node.quiet = this.mark(node, false);
      return node.next;
    }
    node.quiet = false;
    if (frustum.containsSphere?.(node.sphere)) {
      this.mark(node, true);
      for (let i = at + 1; i < node.next; i++)
        (this.nodes[i] as Node).quiet = false;
      return node.next;
    }
    if (!node.leaf) return at + 1;
    for (let i = node.first; i < node.last; i++) {
      const cell = this.sorted[i] as Cell;
      this.count(cell, frustum.intersectsSphere(cell.sphere));
    }
    return node.next;
  }

  private mark(node: Node, visible: boolean): boolean {
    let quiet = true;
    for (let i = node.first; i < node.last; i++) {
      const cell = this.sorted[i] as Cell;
      if (cell.shown) quiet = false;
      this.count(cell, visible);
    }
    return quiet;
  }

  private count(cell: Cell, visible: boolean): void {
    cell.visible = visible;
    const tally = this.tally;
    if (visible && !cell.shown) tally.entered = true;
    if (cell.shown) {
      tally.total += cell.size;
      if (!visible) tally.stale += cell.size;
    }
  }
}

function widestAxis(cells: Cell[]): "x" | "y" | "z" {
  const box = new THREE.Box3();
  for (const cell of cells) box.expandByPoint(cell.sphere.center);
  const size = box.getSize(new THREE.Vector3());
  if (size.x >= size.y && size.x >= size.z) return "x";
  return size.y >= size.z ? "y" : "z";
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

function seenSpans(order: RunOrder, stamp: number): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < order.starts.length; i++) {
    if (order.cells[i]?.seen !== stamp) continue;
    const start = order.starts[i] ?? 0;
    const end = order.ends[i] ?? 0;
    const last = spans[spans.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  }
  return spans;
}

function gapBefore(spans: [number, number][], i: number): number {
  return (spans[i]?.[0] ?? 0) - (spans[i - 1]?.[1] ?? 0);
}

function capped(merged: [number, number][]): [number, number][] {
  const extra = merged.length - viewGroups;
  if (extra <= 0) return merged;
  const closed = new Set(
    merged
      .map((_, i) => i)
      .slice(1)
      .sort((a, b) => gapBefore(merged, a) - gapBefore(merged, b))
      .slice(0, extra),
  );
  const result: [number, number][] = [];
  merged.forEach(([start, end], i) => {
    const last = result[result.length - 1];
    if (last && closed.has(i)) last[1] = end;
    else result.push([start, end]);
  });
  return result;
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
  private narrow: THREE.Mesh | null = null;
  private runOrder: RunOrder | null = null;
  private stamp = 0;
  private shown = true;

  constructor(
    private readonly mesh: THREE.Mesh,
    cellSize: number,
    private readonly inPlace: boolean,
    shared: Uint16Array | Uint32Array | null = null,
  ) {
    const position = mesh.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    this.index = mesh.geometry.index as THREE.BufferAttribute;
    this.source =
      shared ?? (this.index.array as Uint16Array | Uint32Array).slice();
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

  get original(): Uint16Array | Uint32Array {
    return this.source;
  }

  addNarrowView(): void {
    if (this.set.cellCount > narrowCellLimit) return;
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(
      this.mesh.geometry.attributes,
    ))
      geometry.setAttribute(name, attribute);
    geometry.setIndex(this.index);
    geometry.boundingSphere = this.mesh.geometry.boundingSphere;
    const copy = new THREE.Mesh(geometry, [
      this.mesh.material as THREE.Material,
    ]);
    copyPlacement(this.mesh, copy);
    copy.castShadow = false;
    copy.frustumCulled = false;
    copy.visible = false;
    this.mesh.parent?.add(copy);
    this.narrow = copy;
    this.runOrder = this.set.runOrder();
  }

  focus(view: SphereTest | null): void {
    const narrow = this.narrow;
    if (!narrow) return;
    if (!view) {
      narrow.visible = false;
      this.mesh.visible = this.shown;
      return;
    }
    this.stamp += 1;
    this.set.gather(view, this.stamp);
    const { geometry } = narrow;
    geometry.clearGroups();
    const order = this.runOrder;
    if (!order) return;
    for (const [start, end] of capped(seenSpans(order, this.stamp)))
      geometry.addGroup(start, end - start, 0);
    this.shown = this.mesh.visible;
    this.mesh.visible = false;
    narrow.visible = geometry.groups.length > 0;
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

function casterCopy(mesh: THREE.Mesh, layer: number): THREE.Mesh {
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
  copy.layers.set(layer);
  mesh.parent?.add(copy);
  return copy;
}

export class WorldCuller {
  private readonly seen: (CulledMesh | CulledForest)[] = [];
  private readonly cast: CulledMesh[][];

  constructor(
    root: THREE.Object3D,
    private readonly casterLayers: number[],
  ) {
    this.cast = casterLayers.map(() => []);
    const meshes: THREE.Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object as THREE.Mesh);
    });
    for (const mesh of meshes) this.add(mesh);
  }

  private add(mesh: THREE.Mesh): void {
    if (mesh instanceof THREE.InstancedMesh) {
      this.seen.push(new CulledForest(mesh as THREE.InstancedMesh));
      return;
    }
    const { index, boundingSphere } = mesh.geometry;
    if (!index || index.count / 3 < minTriangles) return;
    const radius = boundingSphere?.radius ?? 0;
    const cell = radius < smallMeshRadius ? smallCell : largeCell;
    if (radius < cell) return;
    const seen = new CulledMesh(mesh, cell, true);
    if (mesh.castShadow) {
      this.casterLayers.forEach((layer, cascade) => {
        this.cast[cascade]?.push(
          new CulledMesh(
            casterCopy(mesh, layer),
            smallCell,
            false,
            seen.original,
          ),
        );
      });
      mesh.castShadow = false;
    }
    this.seen.push(seen);
  }

  bake(): void {
    for (const item of [...this.seen, ...this.cast.flat()]) item.bake();
  }

  retained(): Set<unknown> {
    const kept = new Set<unknown>();
    for (const item of [...this.seen, ...this.cast.flat()]) item.keep(kept);
    return kept;
  }

  narrowViews(): void {
    for (const item of this.seen)
      if (item instanceof CulledMesh) item.addNarrowView();
  }

  focus(view: SphereTest | null): void {
    for (const item of this.seen)
      if (item instanceof CulledMesh) item.focus(view);
  }

  update(main: SphereTest, cascades: SphereTest[]): void {
    for (const item of this.seen) item.update(main);
    this.cast.forEach((items, cascade) => {
      const view = cascades[cascade];
      if (view) for (const item of items) item.update(view);
    });
  }
}
