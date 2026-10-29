import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const roadMaterial =
  /\| (asphalt|pit asphalt|paint white|paint red|paint blue|Rubber racing line pigment|dry grass macro|concrete) \|/;

const kinds = [
  ["pit asphalt", "pit"],
  ["asphalt", "asphalt"],
  ["Rubber", "rubber"],
  ["grass", "grass"],
  ["concrete", "concrete"],
];

function surfaceKind(name) {
  const match = kinds.find(([needle]) => name.includes(needle));
  if (match) return match[1];
  return name.includes("paint")
    ? name.replace(/.*paint (\w+).*/, "paint-$1")
    : "other";
}

function primitiveTriangles(primitive, m, kind) {
  const position = primitive.getAttribute("POSITION");
  const indices = primitive.getIndices();
  const count = indices ? indices.getCount() : position.getCount();
  const index = (i) => (indices ? indices.getScalar(i) : i);
  const v = [0, 0, 0];
  const world = (i) => {
    position.getElement(index(i), v);
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    ];
  };
  const triangles = [];
  for (let t = 0; t + 2 < count; t += 3)
    triangles.push({ a: world(t), b: world(t + 1), c: world(t + 2), kind });
  return triangles;
}

function roadTriangles(doc) {
  const triangles = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const primitive of mesh.listPrimitives()) {
      const name = primitive.getMaterial()?.getName() ?? "";
      if (roadMaterial.test(name))
        triangles.push(
          ...primitiveTriangles(
            primitive,
            node.getWorldMatrix(),
            surfaceKind(name),
          ),
        );
    }
  }
  return triangles;
}

const cell = 4;
const key = (i, j) => `${i},${j}`;

function buildGrid(triangles) {
  const grid = new Map();
  for (const tri of triangles) {
    const xs = [tri.a[0], tri.b[0], tri.c[0]];
    const zs = [tri.a[2], tri.b[2], tri.c[2]];
    for (
      let i = Math.floor(Math.min(...xs) / cell);
      i <= Math.floor(Math.max(...xs) / cell);
      i++
    ) {
      for (
        let j = Math.floor(Math.min(...zs) / cell);
        j <= Math.floor(Math.max(...zs) / cell);
        j++
      ) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(tri);
      }
    }
  }
  return grid;
}

function heightAt({ a, b, c, kind }, x, z) {
  const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(d) < 1e-12) return null;
  const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
  const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
  const l3 = 1 - l1 - l2;
  if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) return null;
  return { y: l1 * a[1] + l2 * b[1] + l3 * c[1], kind };
}

export async function loadRoad(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const triangles = roadTriangles(await io.read(file));
  const grid = buildGrid(triangles);
  return {
    count: triangles.length,
    heights(x, z) {
      const list =
        grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? [];
      return list
        .map((tri) => heightAt(tri, x, z))
        .filter((hit) => hit !== null);
    },
  };
}
