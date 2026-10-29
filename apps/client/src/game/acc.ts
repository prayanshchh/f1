import * as THREE from "three/webgpu";

const surfaceTypeLineLoop = 1;
const surfaceTypeLineStrip = 2;
const surfaceTypeTriangleFan = 3;
const surfaceTypeTriangleStrip = 4;
const surfaceTypeMask = 0xf;
const surfaceShaded = 1 << 4;
const surfaceTwoSided = 1 << 5;

export const acToSd = new THREE.Matrix4().set(
  1,
  0,
  0,
  0,
  0,
  0,
  -1,
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

type V2 = [number, number];
type V3 = [number, number, number];
type TexCoords = [V2, V2, V2, V2];

interface AccMaterial {
  translucent: boolean;
}

interface AccTextureState {
  names: [string, string, string, string];
  blockTransparent: boolean;
}

export interface AccGeode {
  name: string;
  transparentGroup: boolean;
  material: AccMaterial;
  texture: AccTextureState;
  twoSided: boolean;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

class Reader {
  private position = 0;
  constructor(private readonly text: string) {}

  get done(): boolean {
    return this.position >= this.text.length;
  }

  private isSpace(index: number): boolean {
    const code = this.text.charCodeAt(index);
    return code === 32 || (code >= 9 && code <= 13);
  }

  token(): string {
    while (this.position < this.text.length && this.isSpace(this.position))
      this.position++;
    const start = this.position;
    while (this.position < this.text.length && !this.isSpace(this.position))
      this.position++;
    return this.text.slice(start, this.position);
  }

  number(): number {
    return Number.parseFloat(this.token());
  }

  string(): string {
    while (this.position < this.text.length && this.isSpace(this.position))
      this.position++;
    if (this.text[this.position] !== '"') return this.token();
    const end = this.text.indexOf('"', this.position + 1);
    const close = end < 0 ? this.text.length : end;
    const value = this.text.slice(this.position + 1, close);
    this.position = close + 1;
    return value;
  }

  line(): string {
    const end = this.text.indexOf("\n", this.position);
    const close = end < 0 ? this.text.length : end;
    const value = this.text.slice(this.position, close);
    this.position = close + 1;
    return value;
  }

  skip(count: number): void {
    this.position += count;
  }
}

type Matrix = number[];

const identity = (): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const m = (matrix: Matrix, r: number, c: number) => matrix[r * 4 + c] ?? 0;

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      out.push(
        m(a, r, 0) * m(b, 0, c) +
          m(a, r, 1) * m(b, 1, c) +
          m(a, r, 2) * m(b, 2, c) +
          m(a, r, 3) * m(b, 3, c),
      );
  return out;
}

function preMult(matrix: Matrix, [x, y, z]: V3): V3 {
  const d =
    1 /
    (m(matrix, 0, 3) * x +
      m(matrix, 1, 3) * y +
      m(matrix, 2, 3) * z +
      m(matrix, 3, 3));
  const column = (c: number) =>
    Math.fround(
      (m(matrix, 0, c) * x +
        m(matrix, 1, c) * y +
        m(matrix, 2, c) * z +
        m(matrix, 3, c)) *
        d,
    );
  return [column(0), column(1), column(2)];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (v: V3): V3 => {
  const length = Math.hypot(...v);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v;
};

interface VertexIndex {
  vertexIndex: number;
  refIndex: number;
}

const noTexCoords: TexCoords = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

class VertexSet {
  private readonly vertices: V3[] = [];
  private readonly refs: TexCoords[][] = [];

  get size(): number {
    return this.vertices.length;
  }

  addVertex(vertex: V3): void {
    this.vertices.push(vertex);
    this.refs.push([]);
  }

  getVertex(index: number): V3 {
    return this.vertices[index] ?? [0, 0, 0];
  }

  addRefData(index: number, texCoords: TexCoords): VertexIndex {
    const refs = this.refs[index];
    if (!refs) return { vertexIndex: 0, refIndex: 0 };
    refs.push(texCoords);
    return { vertexIndex: index, refIndex: refs.length - 1 };
  }

  texCoords(index: VertexIndex): TexCoords {
    return this.refs[index.vertexIndex]?.[index.refIndex] ?? noTexCoords;
  }
}

interface Ref {
  index: number;
  texCoords: TexCoords;
}

function needsTessellation(points: V3[]): boolean {
  const v0 = points[0] ?? [0, 0, 0];
  const at = (i: number) => points[i] ?? v0;
  let prevEdgeNormal: V3 = [0, 0, 0];
  let weightedNormal: V3 = [0, 0, 0];
  let need = false;
  for (let i = 2; i < points.length; ++i) {
    const newNormal = cross(sub(at(i - 1), v0), sub(at(i), v0));
    if (!need) {
      if (3 < points.length && dot(newNormal, weightedNormal) < 0) need = true;
      if (i < 3) {
        prevEdgeNormal = newNormal;
      } else {
        const edgeNormal = cross(
          sub(at(i - 1), at(i - 2)),
          sub(at(i), at(i - 2)),
        );
        if (dot(edgeNormal, prevEdgeNormal) < 0) need = true;
        prevEdgeNormal = edgeNormal;
      }
    }
    weightedNormal = add(weightedNormal, newNormal);
  }
  return need;
}

class Builder {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];
  constructor(private readonly vertexSet: VertexSet) {}

  push(index: VertexIndex): number {
    this.positions.push(...this.vertexSet.getVertex(index.vertexIndex));
    this.uvs.push(...this.vertexSet.texCoords(index)[0]);
    return this.positions.length / 3 - 1;
  }

  fan(polygon: VertexIndex[]): void {
    const base = polygon.map((index) => this.push(index));
    const first = base[0] ?? 0;
    for (let i = 1; i + 1 < base.length; i++)
      this.indices.push(first, base[i] ?? first, base[i + 1] ?? first);
  }

  strip(strip: VertexIndex[]): void {
    const base = strip.map((index) => this.push(index));
    for (let i = 2; i < base.length; i++) {
      const [a = 0, b = 0, c = 0] = [base[i - 2], base[i - 1], base[i]];
      this.indices.push(...(i % 2 === 1 ? [a, c, b] : [a, b, c]));
    }
  }

  tessellate(polygon: VertexIndex[]): void {
    const base = polygon.map((index) => this.push(index));
    const points = polygon.map((index) =>
      this.vertexSet.getVertex(index.vertexIndex),
    );
    for (const triangle of tessellate(points))
      this.indices.push(...triangle.map((k) => base[k] ?? 0));
  }
}

class SurfaceBin {
  private refs: Ref[] = [];
  private readonly triangles: VertexIndex[][] = [];
  private readonly quads: VertexIndex[][] = [];
  private readonly polygons: VertexIndex[][] = [];
  private readonly toTessellate: VertexIndex[][] = [];
  private readonly strips: VertexIndex[][] = [];

  constructor(
    readonly flags: number,
    private readonly vertexSet: VertexSet,
  ) {}

  private get type(): number {
    return this.flags & surfaceTypeMask;
  }

  get isLine(): boolean {
    return (
      this.type === surfaceTypeLineLoop || this.type === surfaceTypeLineStrip
    );
  }

  get twoSided(): boolean {
    return (this.flags & surfaceTwoSided) !== 0;
  }

  beginPrimitive(nRefs: number): boolean {
    this.refs = [];
    return nRefs >= (this.isLine ? 2 : 3);
  }

  vertex(index: number, texCoords: TexCoords): void {
    this.refs.push({ index, texCoords });
  }

  private add(ref: Ref, texCoords = ref.texCoords): VertexIndex {
    return this.vertexSet.addRefData(ref.index, texCoords);
  }

  endPrimitive(): void {
    if (this.isLine) return;
    const refs = this.refs;
    if (this.type === surfaceTypeTriangleStrip) {
      this.strips.push(refs.map((ref) => this.add(ref)));
      return;
    }
    if (
      needsTessellation(refs.map((ref) => this.vertexSet.getVertex(ref.index)))
    ) {
      if (this.type === surfaceTypeTriangleFan) this.fanTriangles(refs);
      else this.toTessellate.push(refs.map((ref) => this.add(ref)));
      return;
    }
    const target =
      refs.length === 3
        ? this.triangles
        : refs.length === 4
          ? this.quads
          : this.polygons;
    target.push(refs.map((ref) => this.add(ref)));
  }

  private fanTriangles(refs: Ref[]): void {
    const tricount = refs.length - 2;
    const [first] = refs;
    if (!first) return;
    const vertexIndex = this.add(first);
    for (let i = 1; i < tricount; i++) {
      const current = refs[i];
      const next = refs[i + 1];
      if (!current || !next) break;
      const vertexIndex1 = this.add(current);
      const vertexIndex2 = this.add(next, current.texCoords);
      const distinct =
        new Set([
          vertexIndex.vertexIndex,
          vertexIndex1.vertexIndex,
          vertexIndex2.vertexIndex,
        ]).size === 3;
      if (distinct)
        this.triangles.push([vertexIndex, vertexIndex1, vertexIndex2]);
    }
  }

  finalize(): Pick<
    AccGeode,
    "positions" | "normals" | "uvs" | "indices"
  > | null {
    const builder = new Builder(this.vertexSet);
    this.toTessellate.forEach((polygon) => {
      builder.tessellate(polygon);
    });
    this.triangles.forEach((triangle) => {
      builder.fan(triangle);
    });
    this.quads.forEach((quad) => {
      builder.fan(quad);
    });
    this.polygons.forEach((polygon) => {
      builder.fan(polygon);
    });
    this.strips.forEach((strip) => {
      builder.strip(strip);
    });
    if (builder.indices.length === 0) return null;
    const positions = new Float32Array(builder.positions);
    return {
      positions,
      normals: smooth(positions, builder.indices),
      uvs: new Float32Array(builder.uvs),
      indices: new Uint32Array(builder.indices),
    };
  }
}

function smooth(positions: Float32Array, indices: number[]): Float32Array {
  const vertex = (i: number): V3 => [
    positions[i * 3] ?? 0,
    positions[i * 3 + 1] ?? 0,
    positions[i * 3 + 2] ?? 0,
  ];
  const keyOf = (i: number) => vertex(i).join(",");
  const sums = new Map<string, V3>();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const corners = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0];
    const [v1, v2, v3] = corners.map(vertex) as [V3, V3, V3];
    const unit = normalize(cross(sub(v2, v1), sub(v3, v1)));
    for (const corner of corners)
      sums.set(keyOf(corner), add(sums.get(keyOf(corner)) ?? [0, 0, 0], unit));
  }
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 3; i++)
    normals.set(normalize(sums.get(keyOf(i)) ?? [0, 0, 0]), i * 3);
  return normals;
}

function tessellate(points: V3[]): V3[] {
  let normal: V3 = [0, 0, 0];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] ?? a;
    normal = add(normal, [
      (a[1] - b[1]) * (a[2] + b[2]),
      (a[2] - b[2]) * (a[0] + b[0]),
      (a[0] - b[0]) * (a[1] + b[1]),
    ]);
  });
  const magnitude = normal.map(Math.abs);
  const axis = magnitude.indexOf(Math.max(...magnitude));
  const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  const contour = points.map((p) => new THREE.Vector2(p[u as 0], p[v as 0]));
  const reverse =
    THREE.ShapeUtils.isClockWise(contour) !== normal[axis as 0] < 0;
  return THREE.ShapeUtils.triangulateShape(contour, []).map(
    ([a = 0, b = 0, c = 0]): V3 => (reverse ? [a, c, b] : [a, b, c]),
  );
}

type BinKey =
  "line" | "smoothDouble" | "smoothSingle" | "flatDouble" | "flatSingle";
const binOrder: BinKey[] = [
  "line",
  "smoothDouble",
  "smoothSingle",
  "flatDouble",
  "flatSingle",
];

function binKey(flags: number): BinKey {
  const type = flags & surfaceTypeMask;
  if (type === surfaceTypeLineLoop || type === surfaceTypeLineStrip)
    return "line";
  const twoSided = (flags & surfaceTwoSided) !== 0;
  if (flags & surfaceShaded) return twoSided ? "smoothDouble" : "smoothSingle";
  return twoSided ? "flatDouble" : "flatSingle";
}

export interface AccOptions {
  car: boolean;
  skin: string;
  textureExists: (name: string) => boolean;
}

function stripPath(texname: string): string {
  if (!(
    texname.startsWith("/") ||
    (/^[A-Za-z]$/.test(texname.charAt(0)) && texname.charAt(1) === ":")
  ))
    return texname;
  const backslash = texname.lastIndexOf("\\");
  const name = backslash >= 0 ? texname.slice(backslash + 1) : texname;
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function isTransparentName(name: string): boolean {
  return (
    name.startsWith(":WI") ||
    name.startsWith("RIM") ||
    name.startsWith("WI") ||
    name.startsWith("GLASS")
  );
}

interface ObjectState {
  textureId: number;
  texnames: [string, string, string, string];
  transform: Matrix;
  parentTransform: Matrix;
  vertexSet: VertexSet;
  textureOffset: V2;
  textureRepeat: V2;
  name: string;
}

class AccParser {
  private readonly materials: AccMaterial[] = [];
  readonly geodes: AccGeode[] = [];
  private transparentGroup = false;
  private blockTransparent = false;
  private readonly stream: Reader;

  constructor(
    text: string,
    private readonly options: AccOptions,
  ) {
    this.stream = new Reader(text);
    if (this.stream.token().slice(0, 4) !== "AC3D")
      throw new Error("not an AC3D file");
    while (!this.stream.done) this.readObject(identity());
  }

  private readonly handlers: Record<string, (state: ObjectState) => boolean> = {
    MATERIAL: () => this.readMaterial(),
    OBJECT: () => {
      this.stream.token();
      if (this.options.car) this.transparentGroup = false;
      return false;
    },
    crease: () => (this.stream.number(), false),
    data: () => (this.stream.skip(this.stream.number()), false),
    shader: (state) => ((state.name = this.stream.string()), false),
    name: (state) => this.readName(state),
    texture: (state) => this.readTexture(state),
    texrep: (state) => (
      (state.textureRepeat = [this.stream.number(), this.stream.number()]),
      false
    ),
    texoff: (state) => (
      (state.textureOffset = [this.stream.number(), this.stream.number()]),
      false
    ),
    rot: (state) => {
      for (let n = 0; n < 3; ++n)
        for (let r = 0; r < 3; ++r)
          state.transform[r * 4 + n] = this.stream.number();
      return false;
    },
    loc: (state) => {
      for (let n = 0; n < 3; ++n)
        state.transform[12 + n] = this.stream.number();
      return false;
    },
    url: () => (this.stream.token(), false),
    numvert: (state) => this.readVertices(state),
    numsurf: (state) => this.readSurfaces(state),
    kids: (state) => {
      const num = this.stream.number();
      this.stream.line();
      for (let n = 0; n < num; n++)
        this.readObject(multiply(state.transform, state.parentTransform));
      return true;
    },
  };

  private readObject(parentTransform: Matrix): void {
    const state: ObjectState = {
      textureId: 0,
      texnames: ["", "", "", ""],
      transform: identity(),
      parentTransform,
      vertexSet: new VertexSet(),
      textureOffset: [0, 0],
      textureRepeat: [1, 1],
      name: "",
    };
    while (!this.stream.done) {
      const handler = this.handlers[this.stream.token()];
      if (handler?.(state)) return;
    }
  }

  private readMaterial(): boolean {
    this.stream.string();
    const values: number[] = [];
    for (const count of [3, 3, 3, 3, 1, 1]) {
      this.stream.token();
      for (let i = 0; i < count; i++) values.push(this.stream.number());
    }
    this.materials.push({ translucent: 0 < (values[13] ?? 0) });
    this.stream.line();
    return false;
  }

  private readName(state: ObjectState): boolean {
    state.name = this.stream.string();
    this.blockTransparent = false;
    if (this.options.car) {
      const transparent = isTransparentName(state.name);
      if (transparent) this.transparentGroup = true;
      this.blockTransparent = !transparent;
    }
    return false;
  }

  private readTexture(state: ObjectState): boolean {
    let texname = stripPath(this.stream.string());
    if (texname === "empty_texture_no_mapping") texname = "";
    if (!this.options.car) {
      if (state.textureId < 4) state.texnames[state.textureId as 0] = texname;
    } else if (state.textureId === 0) {
      state.texnames[0] = this.skinned(texname);
    }
    state.textureId++;
    return false;
  }

  private skinned(texname: string): string {
    if (!this.options.skin) return texname;
    const dot = texname.lastIndexOf(".");
    const basename = dot >= 0 ? texname.slice(0, dot) : texname;
    const extension = dot >= 0 ? texname.slice(dot) : "";
    const name = `${basename}-${this.options.skin}${extension}`;
    return this.options.textureExists(name) ? name : texname;
  }

  private readVertices(state: ObjectState): boolean {
    const currentTransform = multiply(state.transform, state.parentTransform);
    const num = this.stream.number();
    if (num === 0) return false;
    this.stream.line();
    for (let n = 0; n < num; ++n) {
      const [x = 0, y = 0, z = 0] = this.stream
        .line()
        .trim()
        .split(/\s+/)
        .map(Number.parseFloat);
      state.vertexSet.addVertex(
        preMult(currentTransform, [
          Math.fround(x),
          Math.fround(y),
          Math.fround(z),
        ]),
      );
    }
    return false;
  }

  private expect(token: string, name: string): void {
    if (this.stream.token() !== token)
      throw new Error(`expected ${token} while reading ${name}`);
  }

  private readRefs(state: ObjectState, bin: SurfaceBin, nRefs: number): void {
    const accept = bin.beginPrimitive(nRefs);
    for (let i = 0; i < nRefs; ++i) {
      const index = this.stream.number();
      if (state.vertexSet.size <= index)
        throw new Error(`invalid vertex index in ${state.name}`);
      const parts = this.stream
        .line()
        .trim()
        .split(" ")
        .filter(Boolean)
        .map(Number.parseFloat);
      const texCoords = [0, 1, 2, 3].map((unit): V2 => [
        Math.fround(
          state.textureOffset[0] +
            Math.fround(parts[unit * 2] ?? 0) * state.textureRepeat[0],
        ),
        Math.fround(
          state.textureOffset[1] +
            Math.fround(parts[unit * 2 + 1] ?? 0) * state.textureRepeat[1],
        ),
      ]) as TexCoords;
      if (accept) bin.vertex(index, texCoords);
    }
    if (accept) bin.endPrimitive();
  }

  private readSurfaces(state: ObjectState): boolean {
    const texture: AccTextureState = {
      names: [...state.texnames],
      blockTransparent: this.blockTransparent,
    };
    const num = this.stream.number();
    const bins = this.materials.map(() => new Map<BinKey, SurfaceBin>());
    for (let n = 0; n < num; ++n) {
      this.expect("SURF", state.name);
      const flags = Number.parseInt(this.stream.token());
      this.expect("mat", state.name);
      const materialBins = bins[this.stream.number()];
      if (!materialBins) throw new Error(`invalid material in ${state.name}`);
      const key = binKey(flags);
      const bin =
        materialBins.get(key) ?? new SurfaceBin(flags, state.vertexSet);
      materialBins.set(key, bin);
      this.expect("refs", state.name);
      this.readRefs(state, bin, this.stream.number());
    }
    bins.forEach((materialBins, i) => {
      this.finalize(
        materialBins,
        this.materials[i] ?? { translucent: false },
        texture,
        state.name,
      );
    });
    return false;
  }

  private finalize(
    bins: Map<BinKey, SurfaceBin>,
    material: AccMaterial,
    texture: AccTextureState,
    name: string,
  ): void {
    for (const key of binOrder) {
      const bin = bins.get(key);
      const built = bin && !bin.isLine ? bin.finalize() : null;
      if (bin && built) {
        this.geodes.push({
          ...built,
          name,
          transparentGroup: this.transparentGroup,
          material,
          texture,
          twoSided: bin.twoSided,
        });
      }
    }
  }
}

export function parseAcc(text: string, options: AccOptions): AccGeode[] {
  return new AccParser(text, options).geodes;
}
