import * as THREE from "three/webgpu";

const builtLift = 0.008;
const builtColumns = [0, 0.0833, 0.3333, 0.875, 1];
const builtRise = [0, 0.007, 0.016, 0.02, 0.02];
const columnSteps = 24;
const rowStep = 100;
const rowReach = 2.5;
const sameVertex = 1e-3;
const lipFoot = 0.002;
const slabFloor = 0.004;
const topColumns = [0.012, 0.06, 0.25, 0.6, 0.965, 0.985, 1];
const topRise = [0.006, 0.0125, 0.018, 0.022, 0.024, 0.0225, 0.019];
const faceFoot = -0.012;
const faceDepth = 0.03;

export interface KerbRow {
  inner: THREE.Vector3;
  outer: THREE.Vector3;
  taper: number;
  along: number;
}

export interface BuiltRow {
  points: (THREE.Vector3 | null)[];
  along: number;
}

interface Section {
  u: number;
  height: (taper: number) => number;
  across: number;
}

interface Strip {
  sections: Section[];
  facing: (lateral: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3;
}

const up = new THREE.Vector3(0, 1, 0);

function columnOf(u: number): number {
  const step = Math.round(u * columnSteps);
  return builtColumns.findIndex((c) => Math.round(c * columnSteps) === step);
}

function builtHeight(column: number, taper: number): number {
  return builtLift + (builtRise[column] ?? 0) * taper;
}

function solveRow(points: THREE.Vector3[], along: number): KerbRow {
  const p0 = points[0] ?? new THREE.Vector3();
  const p2 = points[2] ?? p0;
  const p4 = points[4] ?? p0;
  const u2 = builtColumns[2] ?? 0;
  const rise2 = builtRise[2] ?? 0;
  const rise4 = builtRise[4] ?? 0;
  const y0 = p0.y - builtLift;
  const a = p4.y - builtLift;
  const b = p2.y - builtLift - y0 * (1 - u2);
  const taper = THREE.MathUtils.clamp(
    (b - u2 * a) / (rise2 - u2 * rise4),
    0,
    1,
  );
  const inner = p0.clone().addScaledVector(up, -builtLift);
  const outer = p4.clone().addScaledVector(up, -builtHeight(4, taper));
  return { inner, outer, taper, along };
}

export function builtPoint(row: KerbRow, column: number): THREE.Vector3 {
  return row.inner
    .clone()
    .lerp(row.outer, builtColumns[column] ?? 0)
    .addScaledVector(up, builtHeight(column, row.taper));
}

function groupByAlong(uv: THREE.BufferAttribute): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < uv.count; i++) {
    const key = Math.round(uv.getY(i) * rowStep);
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  }
  return groups;
}

function rowStarts(
  members: number[],
  key: number,
  at: (i: number) => THREE.Vector3,
  uv: THREE.BufferAttribute,
): BuiltRow[] {
  const starts: BuiltRow[] = [];
  for (const i of members) {
    if (columnOf(uv.getX(i)) !== 0) continue;
    const p = at(i);
    const known = starts.some(
      (r) => (r.points[0]?.distanceTo(p) ?? Infinity) < sameVertex,
    );
    if (known) continue;
    const points: (THREE.Vector3 | null)[] = builtColumns.map(() => null);
    points[0] = p;
    starts.push({ points, along: key / rowStep });
  }
  return starts;
}

function nearestRow(rows: BuiltRow[], p: THREE.Vector3): number {
  let best = -1;
  let bestDistance = rowReach;
  rows.forEach((row, i) => {
    const distance = row.points[0]?.distanceTo(p) ?? Infinity;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

function claim(row: BuiltRow, column: number, p: THREE.Vector3): boolean {
  const known = row.points[column];
  if (!known) {
    row.points[column] = p;
    return true;
  }
  return known.distanceTo(p) <= sameVertex;
}

export function readRows(geometry: THREE.BufferGeometry): {
  rows: BuiltRow[];
  rowOf: Int32Array;
} {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const at = (i: number) =>
    new THREE.Vector3().fromBufferAttribute(position, i);
  const rows: BuiltRow[] = [];
  const rowOf = new Int32Array(position.count).fill(-1);
  for (const [key, members] of groupByAlong(uv)) {
    const starts = rowStarts(members, key, at, uv);
    for (const i of members) {
      const column = columnOf(uv.getX(i));
      const p = at(i);
      const near = column < 0 ? -1 : nearestRow(starts, p);
      const row = starts[near];
      if (row && claim(row, column, p)) rowOf[i] = rows.length + near;
    }
    rows.push(...starts);
  }
  return { rows, rowOf };
}

function rowPairs(
  geometry: THREE.BufferGeometry,
  rowOf: Int32Array,
): [number, number][] {
  const index = geometry.getIndex();
  const count = index?.count ?? geometry.getAttribute("position").count;
  const vertex = (k: number) => (index ? index.getX(k) : k);
  const pairs = new Map<string, [number, number]>();
  for (let k = 0; k < count; k += 3) {
    const found = new Set(
      [0, 1, 2].map((j) => rowOf[vertex(k + j)] ?? -1).filter((r) => r >= 0),
    );
    if (found.size !== 2) continue;
    const [a = 0, b = 0] = [...found].sort((x, y) => x - y);
    pairs.set(`${String(a)}:${String(b)}`, [a, b]);
  }
  return [...pairs.values()];
}

export function kerbRows(geometry: THREE.BufferGeometry): {
  rows: KerbRow[];
  pairs: [number, number][];
  built: BuiltRow[];
} {
  const { rows: built, rowOf } = readRows(geometry);
  const complete = built.map((row) => row.points.every((p) => p !== null));
  const rows = built.map((row) =>
    solveRow(
      row.points.map((p) => p ?? new THREE.Vector3()),
      row.along,
    ),
  );
  const pairs = rowPairs(geometry, rowOf).filter(
    ([a, b]) => complete[a] === true && complete[b] === true,
  );
  return { rows, pairs, built };
}

function slab(): Strip[] {
  const top = topColumns.map((u, i) => ({
    u,
    height: (taper: number) => slabFloor + (topRise[i] ?? 0) * taper,
    across: u,
  }));
  const first = top[0] ?? { u: 0, height: () => slabFloor, across: 0 };
  const last = top.at(-1) ?? first;
  return [
    {
      sections: [{ u: 0, height: () => lipFoot, across: 0 }, first],
      facing: (lateral, out) => out.copy(up).sub(lateral),
    },
    { sections: top, facing: (_lateral, out) => out.copy(up) },
    {
      sections: [
        { u: 1, height: last.height, across: 1 },
        { u: 1, height: () => faceFoot, across: 1 + faceDepth },
      ],
      facing: (lateral, out) => out.copy(lateral),
    },
  ];
}

class Builder {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];
  private readonly lateral = new THREE.Vector3();
  private readonly expected = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();

  constructor(
    private readonly rows: KerbRow[],
    private readonly pairs: [number, number][],
  ) {}

  strip(strip: Strip, order: number[]): void {
    const slot = new Map<number, number>();
    for (const r of order) {
      const row = this.rows[r];
      if (row) slot.set(r, this.place(row, strip.sections));
    }
    for (const [a, b] of this.pairs) {
      const sa = slot.get(a);
      const sb = slot.get(b);
      const row = this.rows[a];
      if (sa !== undefined && sb !== undefined && row)
        this.quads(strip, row, sa, sb);
    }
  }

  private place(row: KerbRow, sections: Section[]): number {
    const first = this.positions.length / 3;
    for (const section of sections) {
      this.a
        .copy(row.inner)
        .lerp(row.outer, section.u)
        .addScaledVector(up, section.height(row.taper));
      this.positions.push(this.a.x, this.a.y, this.a.z);
      this.uvs.push(section.across, row.along);
    }
    return first;
  }

  private vertex(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.fromArray(this.positions, i * 3);
  }

  private quads(strip: Strip, row: KerbRow, sa: number, sb: number): void {
    this.lateral
      .subVectors(row.outer, row.inner)
      .projectOnPlane(up)
      .normalize();
    strip.facing(this.lateral, this.expected);
    for (let c = 0; c + 1 < strip.sections.length; c++) {
      const p = this.vertex(sa + c, this.a);
      this.normal
        .subVectors(this.vertex(sb + c, this.b), p)
        .cross(this.vertex(sa + c + 1, this.c).sub(p));
      const [i, j, k, l] = [sa + c, sb + c, sa + c + 1, sb + c + 1];
      if (this.normal.dot(this.expected) >= 0)
        this.indices.push(i, j, k, k, j, l);
      else this.indices.push(i, k, j, k, l, j);
    }
  }
}

export function reliefKerbs(
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const { rows, pairs } = kerbRows(geometry);
  const builder = new Builder(rows, pairs);
  const order = [...new Set(pairs.flat())].sort((x, y) => x - y);
  for (const strip of slab()) builder.strip(strip, order);
  const relief = new THREE.BufferGeometry();
  relief.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(builder.positions, 3),
  );
  relief.setAttribute("uv", new THREE.Float32BufferAttribute(builder.uvs, 2));
  relief.setIndex(builder.indices);
  relief.computeVertexNormals();
  relief.computeBoundingSphere();
  return relief;
}
