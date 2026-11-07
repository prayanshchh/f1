import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { PNG } from "pngjs";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { hullOf, widenedStrip, withCartoonWheel } from "./shapes.mjs";

const say = (...parts) => process.stdout.write(`${parts.join(" ")}\n`);

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const root = path.resolve(import.meta.dirname, "../..");
const trackDir = path.join(root, "content/tracks/hill-country");
const site = path.join(root, "content/tracks/hill-country/low");
const work = path.join(root, "build/corridor/toon");
mkdirSync(work, { recursive: true });
mkdirSync(site, { recursive: true });

const chunkLength = 50;
const millimetre = 1000;
const normalSteps = 50;
const coarseWeld = 3;
const uvWeight = 0.05;
const sunTowards = normalise([0.42, 0.82, 0.38]);
const ambient = 0.58;
const flatShade = ambient + (1 - ambient) * sunTowards[1];

const asphalt = [112, 113, 116];
const grass = [92, 168, 58];
const paint = [244, 244, 240];
const steel = [52, 54, 60];
const concrete = [206, 206, 200];
const white = [236, 236, 232];

const looks = {
  road: { colour: asphalt, error: [0.01, 0.08], lock: true },
  "pit lane": { colour: [120, 120, 123], error: [0.01, 0.08], lock: true },
  "pit apron": { colour: [132, 132, 130], error: [0.01, 0.08], lock: true },
  kerbs: { texture: "kerb", error: [0.01, 0.05] },
  verges: { colour: grass, layer: "ground", error: [0.02, 0.05], lock: true },
  terrain: { colour: [98, 160, 62], layer: "ground", error: [0.3, 0.8] },
  "edge lines": {
    colour: paint,
    layer: "decal",
    error: [0.01, 0.05],
    shape: widenedStrip(2),
  },
  markings: { colour: paint, layer: "decal" },
  "pit lines": { colour: paint, layer: "decal" },
  "pit red line": { colour: [204, 36, 40], layer: "decal" },
  "pit decals": { texture: "pit-decals", layer: "decal" },
  "wall concrete": { colour: concrete, error: [0.03, 0.1], weld: coarseWeld },
  "wall tecpro": {
    colour: [150, 152, 156],
    error: [0.03, 0.1],
    weld: coarseWeld,
  },
  walls: { colour: concrete, error: [0.03, 0.1], weld: coarseWeld },
  "wall boards": { texture: "boards", error: [0.01, 0.05] },
  "billboard boards": { texture: "boards" },
  "gantry boards": { texture: "boards" },
  "paddock banner": { texture: "boards" },
  "pit strip": { texture: "boards" },
  "distance boards": { texture: "distance" },
  "billboard posts": { colour: steel },
  "billboard tower": { colour: steel, error: [0.05, 0.3], weld: coarseWeld },
  "gantry steel": { colour: steel },
  "distance backs": { colour: steel },
  "distance posts": { colour: steel },
  "light panel": { colour: [24, 24, 26] },
  "start lamps": { colour: [40, 12, 12] },
  "stand seats": { colour: [58, 96, 176], error: [0, 0.2], weld: coarseWeld },
  "stand concrete": { colour: white },
  columns: { colour: [150, 154, 160], error: [0, 0.2], weld: coarseWeld },
  roofs: { colour: white },
  rooftops: { colour: [178, 180, 182], error: [0, 0.2], weld: coarseWeld },
  "tower plates": { colour: white },
  "tower core": { colour: [70, 110, 150] },
  veil: { colour: [206, 36, 44], shape: hullOf },
  "paddock back": { colour: [160, 164, 172] },
  "paddock canopy": { colour: white, error: [0, 0.2], weld: coarseWeld },
  "paddock concrete": { colour: [170, 170, 166] },
  "paddock fascia": { colour: [60, 64, 76] },
  "paddock floor": { colour: [140, 140, 138] },
  "paddock inner": { colour: [150, 152, 158] },
  "paddock panels": { colour: [84, 92, 108], error: [0, 0.2] },
  "paddock screens": { colour: [40, 110, 170] },
  "paddock steel": {
    colour: [120, 124, 130],
    error: [0.05, 0.3],
    weld: coarseWeld,
  },
  "paddock tower": { colour: steel },
  "paddock white": { colour: white },
  "paddock lights": { colour: [250, 246, 230] },
  "prop crane": { colour: [236, 176, 24], error: [0, 0.2] },
  "prop hut": { colour: white, shape: withCartoonWheel },
  "prop marquee": { colour: [246, 246, 242], error: [0, 0.2] },
  "prop marshal": { colour: [236, 120, 24] },
  "prop steel": { colour: steel, error: [0, 0.2] },
  "prop dark": { colour: [30, 30, 34] },
  "prop skyline": { colour: [166, 180, 200], far: true },
  horizon: {
    colour: [132, 166, 118],
    layer: "ground",
    far: true,
    error: [25, 25],
  },
};

const textures = {
  boards: { source: "boards_base_color", flags: 2 | 16 },
  distance: { source: "distance_base_color", flags: 2 | 16 },
  "pit-decals": { source: "pit_decals_base_color", flags: 1 | 2, alpha: true },
};
const kerbColours = [
  [214, 34, 40],
  [246, 246, 244],
];
const stripeTexels = 32;
const surfaceMeshes = new Set(["road", "pit lane", "pit apron", "kerbs"]);
const surfaceCell = 2;
const sinkDepth = 0.08;
const sky = { zenith: [70, 138, 226], horizon: [196, 222, 244] };
const ground = [98, 160, 62];

function normalise(v) {
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
}

const track = JSON.parse(
  readFileSync(path.join(trackDir, "track.json"), "utf8"),
);
const centre = track.centerline;
const pit = track.pitLane.centerline;
const along = [0];
for (let i = 1; i < centre.length; i++)
  along.push(
    along[i - 1] +
      Math.hypot(centre[i].x - centre[i - 1].x, centre[i].z - centre[i - 1].z),
  );
const lapLength =
  along.at(-1) +
  Math.hypot(centre[0].x - centre.at(-1).x, centre[0].z - centre.at(-1).z);
const chunkCount = Math.ceil(lapLength / chunkLength);

const cell = 16;
const cellKey = (gx, gz) => gx * 100003 + gz;

function grid(points) {
  const map = new Map();
  points.forEach((p, i) => {
    const key = cellKey(Math.floor(p.x / cell), Math.floor(p.z / cell));
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  });
  return map;
}

function nearest(points, map, x, z) {
  const cx = Math.floor(x / cell);
  const cz = Math.floor(z / cell);
  let best = -1;
  let bestDistance = Infinity;
  const visit = (gx, gz) => {
    for (const i of map.get(cellKey(gx, gz)) ?? []) {
      const d = (points[i].x - x) ** 2 + (points[i].z - z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
  };
  for (let ring = 0; ring < 1000; ring++) {
    if (best >= 0 && (ring - 1) * cell > Math.sqrt(bestDistance)) break;
    for (let d = -ring; d <= ring; d++) {
      visit(cx + d, cz - ring);
      if (ring > 0) visit(cx + d, cz + ring);
    }
    for (let d = -ring + 1; d <= ring - 1; d++) {
      visit(cx - ring, cz + d);
      visit(cx + ring, cz + d);
    }
  }
  return { index: best, distance: Math.sqrt(bestDistance) };
}

const centreGrid = grid(centre);
const pitGrid = grid(pit);
const pitAnchor = pit.map((p) => nearest(centre, centreGrid, p.x, p.z).index);
const chunkCell = 2;
const chunkCache = new Map();

function chunkAt(x, z) {
  const key = cellKey(Math.floor(x / chunkCell), Math.floor(z / chunkCell));
  const known = chunkCache.get(key);
  if (known !== undefined) return known;
  const main = nearest(centre, centreGrid, x, z);
  const lane = nearest(pit, pitGrid, x, z);
  const index =
    lane.index >= 0 && lane.distance < main.distance
      ? pitAnchor[lane.index]
      : main.index;
  const chunk = Math.min(
    chunkCount - 1,
    Math.floor(along[index] / chunkLength),
  );
  chunkCache.set(key, chunk);
  return chunk;
}

function shade(n) {
  const facing = Math.max(
    0,
    n[0] * sunTowards[0] + n[1] * sunTowards[1] + n[2] * sunTowards[2],
  );
  return (ambient + (1 - ambient) * facing) / flatShade;
}

function quantiseUvs(uvs) {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i < uvs.length; i += 2)
    for (let c = 0; c < 2; c++) {
      lo[c] = Math.min(lo[c], uvs[i + c]);
      hi[c] = Math.max(hi[c], uvs[i + c]);
    }
  if (!Number.isFinite(lo[0])) return { lo: [0, 0], step: [1, 1], q: [] };
  const step = lo.map((l, c) => Math.max(hi[c] - l, 1e-6) / 65535);
  const q = Array.from(uvs, (u, i) =>
    Math.round((u - lo[i % 2]) / step[i % 2]),
  );
  return { lo, step, q };
}

function encode(group) {
  const count = group.positions.length / 3;
  const uv = quantiseUvs(group.uvs);
  const vertex = Buffer.alloc(count * 20);
  for (let v = 0; v < count; v++) {
    for (let c = 0; c < 3; c++)
      vertex.writeInt32LE(
        Math.round(group.positions[v * 3 + c] * millimetre),
        v * 20 + c * 4,
      );
    vertex.writeUInt32LE(group.colours[v] >>> 0, v * 20 + 12);
    vertex.writeUInt16LE(uv.q[v * 2] ?? 0, v * 20 + 16);
    vertex.writeUInt16LE(uv.q[v * 2 + 1] ?? 0, v * 20 + 18);
  }
  const vertexBytes = MeshoptEncoder.encodeVertexBuffer(
    new Uint8Array(vertex.buffer, vertex.byteOffset, vertex.length),
    count,
    20,
  );
  const indexBytes = (index) =>
    MeshoptEncoder.encodeIndexBuffer(
      new Uint8Array(index.buffer, index.byteOffset, index.byteLength),
      index.length,
      4,
    );
  const near = indexBytes(group.near);
  const far =
    group.far === group.near ? new Uint8Array(0) : indexBytes(group.far);
  const pad = (n) => Buffer.alloc((4 - (n % 4)) % 4);
  return Buffer.concat([
    Buffer.from(
      new Uint32Array([
        count,
        group.near.length,
        group.far === group.near ? 0 : group.far.length,
        vertexBytes.length,
        near.length,
        far.length,
      ]).buffer,
    ),
    Buffer.from(new Float32Array([...uv.lo, ...uv.step]).buffer),
    Buffer.from(vertexBytes),
    pad(vertexBytes.length),
    Buffer.from(near),
    pad(near.length),
    Buffer.from(far),
    pad(far.length),
  ]);
}

function simplified(part, index, error, lock) {
  if (!error || index.length < 300) return index;
  const flags = lock ? ["LockBorder", "ErrorAbsolute"] : ["ErrorAbsolute"];
  if (part.uvs.length === 0) {
    const [result] = MeshoptSimplifier.simplify(
      index,
      part.positions,
      3,
      0,
      error,
      flags,
    );
    return result;
  }
  const [result] = MeshoptSimplifier.simplifyWithAttributes(
    index,
    part.positions,
    3,
    part.uvs,
    2,
    [uvWeight, uvWeight],
    null,
    0,
    error,
    flags,
  );
  return result;
}

function vertexKey(source, v) {
  const key = [];
  for (let c = 0; c < 3; c++)
    key.push(Math.round(source.positions[v * 3 + c] * millimetre));
  if (source.normals)
    for (let c = 0; c < 3; c++)
      key.push(
        Math.round(
          source.normals[v * 3 + c] * (source.normalSteps ?? normalSteps),
        ),
      );
  if (source.uvs)
    for (let c = 0; c < 2; c++)
      key.push(Math.round(source.uvs[v * 2 + c] * 65536));
  return key.join(",");
}

function compact(source, triangles) {
  const map = new Map();
  const positions = [];
  const normals = [];
  const uvs = [];
  const index = new Uint32Array(triangles.length * 3);
  let k = 0;
  for (const t of triangles)
    for (let j = 0; j < 3; j++) {
      const v = source.indices[t * 3 + j];
      const key = vertexKey(source, v);
      let id = map.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        map.set(key, id);
        positions.push(...source.positions.subarray(v * 3, v * 3 + 3));
        normals.push(
          ...(source.normals?.subarray(v * 3, v * 3 + 3) ?? [0, 1, 0]),
        );
        if (source.uvs) uvs.push(...source.uvs.subarray(v * 2, v * 2 + 2));
      }
      index[k++] = id;
    }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    index,
  };
}

function packColour(rgb, factor) {
  const [r, g, b] = rgb.map((c) =>
    Math.max(0, Math.min(255, Math.round(c * factor))),
  );
  return (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(trackDir, "road.glb"));
const groups = [];
const materials = [];
const materialIndex = new Map();

function materialOf(name) {
  const look = looks[name];
  const key = look.texture
    ? `texture:${look.texture}:${look.layer ?? ""}`
    : `paint:${look.layer ?? ""}`;
  if (!materialIndex.has(key)) {
    materialIndex.set(key, materials.length);
    materials.push({
      texture: look.texture ?? null,
      layer: look.layer ?? null,
    });
  }
  return materialIndex.get(key);
}

function worldPositions(node, primitive) {
  const matrix = node.getWorldMatrix();
  const raw = primitive.getAttribute("POSITION").getArray();
  const positions = new Float32Array(raw.length);
  for (let v = 0; v < raw.length / 3; v++) {
    const [x, y, z] = raw.subarray(v * 3, v * 3 + 3);
    for (let r = 0; r < 3; r++)
      positions[v * 3 + r] =
        matrix[r] * x + matrix[4 + r] * y + matrix[8 + r] * z + matrix[12 + r];
  }
  return positions;
}

function indicesOf(primitive, count) {
  return (
    primitive.getIndices()?.getArray() ??
    Uint32Array.from({ length: count }, (_, i) => i)
  );
}

const surfaceGrid = new Map();
const surfaceKey = (x, z) =>
  Math.floor(x / surfaceCell) * 1000003 + Math.floor(z / surfaceCell);
for (const node of doc.getRoot().listNodes()) {
  if (!node.getMesh() || !surfaceMeshes.has(node.getName())) continue;
  for (const primitive of node.getMesh().listPrimitives()) {
    const p = worldPositions(node, primitive);
    const index = indicesOf(primitive, p.length / 3);
    for (let t = 0; t < index.length; t += 3) {
      const corners = [0, 1, 2].map((j) => {
        const v = index[t + j];
        return [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
      });
      const xs = corners.map((c) => c[0]);
      const zs = corners.map((c) => c[2]);
      for (
        let x = Math.min(...xs);
        x < Math.max(...xs) + surfaceCell;
        x += surfaceCell
      )
        for (
          let z = Math.min(...zs);
          z < Math.max(...zs) + surfaceCell;
          z += surfaceCell
        ) {
          const key = surfaceKey(x, z);
          const list = surfaceGrid.get(key);
          if (list) list.push(corners);
          else surfaceGrid.set(key, [corners]);
        }
    }
  }
}

function surfaceHeight(x, z) {
  let best = null;
  for (const [a, b, c] of surfaceGrid.get(surfaceKey(x, z)) ?? []) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const h = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (best === null || h > best) best = h;
  }
  return best;
}

function sinkUnderSurface(positions, indices) {
  const covered = new Uint8Array(positions.length / 3);
  for (let v = 0; v < covered.length; v++) {
    const h = surfaceHeight(positions[v * 3], positions[v * 3 + 2]);
    if (h === null) continue;
    covered[v] = 1;
    positions[v * 3 + 1] = Math.min(positions[v * 3 + 1], h - sinkDepth);
  }
  const kept = [];
  for (let t = 0; t < indices.length; t += 3)
    if (!(
      covered[indices[t]] &&
      covered[indices[t + 1]] &&
      covered[indices[t + 2]]
    ))
      kept.push(indices[t], indices[t + 1], indices[t + 2]);
  return Uint32Array.from(kept);
}

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  const name = node.getName();
  if (!mesh || !looks[name]) continue;
  const look = looks[name];
  for (const primitive of mesh.listPrimitives()) {
    const world = worldPositions(node, primitive);
    const read = {
      positions: world,
      normals: primitive.getAttribute("NORMAL")?.getArray() ?? null,
      uvs: look.texture
        ? (primitive.getAttribute("TEXCOORD_0")?.getArray() ?? null)
        : null,
      indices: indicesOf(primitive, world.length / 3),
    };
    const shaped = look.shape ? look.shape(read) : read;
    const source = { ...shaped, normalSteps: look.weld };
    const { positions } = source;
    if (look.layer === "ground" && !look.far)
      source.indices = sinkUnderSurface(positions, source.indices);
    const byChunk = new Map();
    const triangles = source.indices.length / 3;
    for (let t = 0; t < triangles; t++) {
      let x = 0;
      let z = 0;
      for (let j = 0; j < 3; j++) {
        const v = source.indices[t * 3 + j];
        x += positions[v * 3];
        z += positions[v * 3 + 2];
      }
      const chunk = look.far ? -1 : chunkAt(x / 3, z / 3);
      const list = byChunk.get(chunk);
      if (list) list.push(t);
      else byChunk.set(chunk, [t]);
    }
    for (const [chunk, list] of byChunk) {
      const part = compact(source, list);
      const [nearError, farError] = look.error ?? [0, 0];
      const near = simplified(part, part.index, nearError, !!look.lock);
      const far =
        farError && farError !== nearError
          ? simplified(part, near, farError, !!look.lock)
          : near;
      const colours = new Uint32Array(part.positions.length / 3);
      for (let v = 0; v < colours.length; v++)
        colours[v] = look.colour
          ? packColour(
              look.colour,
              shade(part.normals.subarray(v * 3, v * 3 + 3)),
            )
          : 0xffffffff;
      groups.push({
        name,
        chunk,
        material: materialOf(name),
        positions: part.positions,
        uvs: part.uvs,
        colours,
        near,
        far,
      });
    }
  }
}

groups.sort((a, b) => a.chunk - b.chunk || a.material - b.material);

const boxes = new Map();
for (const g of groups) {
  const box = boxes.get(g.chunk) ?? {
    lo: [Infinity, Infinity, Infinity],
    hi: [-Infinity, -Infinity, -Infinity],
  };
  for (let i = 0; i < g.positions.length; i += 3)
    for (let c = 0; c < 3; c++) {
      box.lo[c] = Math.min(box.lo[c], g.positions[i + c]);
      box.hi[c] = Math.max(box.hi[c], g.positions[i + c]);
    }
  boxes.set(g.chunk, box);
}

const tally = new Map();
for (const g of groups) {
  const t = tally.get(g.name) ?? { source: 0, near: 0, far: 0 };
  t.near += g.near.length / 3;
  t.far += g.far.length / 3;
  tally.set(g.name, t);
}
for (const [name, t] of tally)
  say(name.padEnd(22), String(t.near).padStart(8), String(t.far).padStart(8));

for (const file of readdirSync(site))
  if (file !== "tyre-wall.json") rmSync(path.join(site, file));

const packed = gzipSync(Buffer.concat(groups.map(encode)), { level: 9 });
writeFileSync(path.join(site, "toon.bin"), packed);

function webp(rgba, width, height, out, options) {
  const scratch = path.join(work, "scratch.png");
  const png = new PNG({ width, height });
  png.data = rgba;
  writeFileSync(scratch, PNG.sync.write(png, { deflateLevel: 1 }));
  execFileSync("cwebp", ["-quiet", "-m", "4", ...options, scratch, "-o", out]);
  return readFileSync(out).length;
}

const textureManifest = {};
let textureBytes = 0;
for (const texture of doc.getRoot().listTextures()) {
  const entry = Object.entries(textures).find(
    ([, info]) => info.source === texture.getName(),
  );
  if (!entry) continue;
  const [key, info] = entry;
  const png = PNG.sync.read(Buffer.from(texture.getImage()));
  const rgba = Buffer.from(png.data);
  textureBytes += webp(
    rgba,
    png.width,
    png.height,
    path.join(site, `${key}.webp`),
    ["-q", "95", "-noalpha"],
  );
  let alpha = null;
  if (info.alpha) {
    const grey = Buffer.alloc(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      grey[i] = grey[i + 1] = grey[i + 2] = rgba[i + 3];
      grey[i + 3] = 255;
    }
    alpha = `${key}-alpha.webp`;
    textureBytes += webp(grey, png.width, png.height, path.join(site, alpha), [
      "-lossless",
      "-noalpha",
    ]);
  }
  textureManifest[key] = {
    file: `${key}.webp`,
    alpha,
    width: png.width,
    height: png.height,
    flags: info.flags,
  };
}

const manifest = {
  chunkLength,
  chunkCount,
  millimetre,
  materials,
  textures: textureManifest,
  patterns: {
    kerb: {
      colours: kerbColours.flatMap((colour) =>
        Array.from({ length: stripeTexels }, () => colour),
      ),
      flags: 2,
    },
  },
  sky,
  ground,
  chunks: [...boxes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chunk, box]) => ({ chunk, lo: box.lo, hi: box.hi })),
  groups: groups.map((g) => ({
    chunk: g.chunk,
    material: g.material,
  })),
};
writeFileSync(path.join(site, "manifest.json"), JSON.stringify(manifest));

const near = groups.reduce((n, g) => n + g.near.length / 3, 0);
const far = groups.reduce((n, g) => n + g.far.length / 3, 0);
say(
  `groups ${groups.length}, near ${near} tris, far ${far} tris, meshes ${(packed.length / 1e6).toFixed(2)} MB, textures ${(textureBytes / 1e6).toFixed(2)} MB`,
);
