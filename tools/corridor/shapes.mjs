import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

const wheelHeight = 30;
const wheelReach = 6;
const wheelSegments = 36;
const wheelSpokes = 8;
const rimDepth = 1.6;
const rimWidth = 1.4;
const spokeSize = 0.9;
const hubSize = 3.2;
const legSize = 1.4;
const legSpread = 0.55;
const legStance = 4;

function solid(triangles) {
  const positions = new Float32Array(triangles.length * 9);
  const normals = new Float32Array(triangles.length * 9);
  triangles.forEach(({ corners, outward }, t) => {
    const [a, b, c] = corners;
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    const centroid = a.clone().add(b).add(c).divideScalar(3);
    if (normal.dot(centroid.sub(outward)) < 0) normal.negate();
    corners.forEach((corner, j) => {
      corner.toArray(positions, t * 9 + j * 3);
      normal.toArray(normals, t * 9 + j * 3);
    });
  });
  return {
    positions,
    normals,
    uvs: null,
    indices: Uint32Array.from({ length: triangles.length * 3 }, (_, i) => i),
  };
}

function quad(list, outward, a, b, c, d) {
  list.push({ corners: [a, b, c], outward }, { corners: [a, c, d], outward });
}

function prism(list, ring, outward) {
  const [a, b, c, d, e, f, g, h] = ring;
  quad(list, outward, a, b, c, d);
  quad(list, outward, e, f, g, h);
  quad(list, outward, a, b, f, e);
  quad(list, outward, b, c, g, f);
  quad(list, outward, c, d, h, g);
  quad(list, outward, d, a, e, h);
}

function beam(list, from, to, size, hint) {
  const along = new THREE.Vector3().subVectors(to, from).normalize();
  const side = new THREE.Vector3().crossVectors(along, hint);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize().multiplyScalar(size / 2);
  const lift = new THREE.Vector3()
    .crossVectors(side, along)
    .normalize()
    .multiplyScalar(size / 2);
  const corner = (end, s, l) =>
    end.clone().addScaledVector(side, s).addScaledVector(lift, l);
  const signs = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  const middle = from.clone().add(to).multiplyScalar(0.5);
  prism(
    list,
    [
      ...signs.map(([s, l]) => corner(from, s, l)),
      ...signs.map(([s, l]) => corner(to, s, l)),
    ],
    middle,
  );
}

function points(source, triangles) {
  const out = [];
  for (const t of triangles)
    for (let j = 0; j < 3; j++) {
      const v = source.indices[t * 3 + j];
      out.push(new THREE.Vector3().fromArray(source.positions, v * 3));
    }
  return out;
}

export function hullOf(source) {
  const all = [];
  for (let v = 0; v < source.positions.length / 3; v++)
    all.push(new THREE.Vector3().fromArray(source.positions, v * 3));
  const hull = new ConvexHull().setFromPoints(all);
  const centre = all
    .reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .divideScalar(all.length);
  const list = [];
  for (const face of hull.faces) {
    const loop = [];
    let edge = face.edge;
    do {
      loop.push(edge.head().point.clone());
      edge = edge.next;
    } while (edge !== face.edge);
    for (let k = 1; k + 1 < loop.length; k++)
      list.push({ corners: [loop[0], loop[k], loop[k + 1]], outward: centre });
  }
  return solid(list);
}

function components(source) {
  const count = source.positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const seen = new Map();
  for (let v = 0; v < count; v++) {
    const key = [0, 1, 2]
      .map((c) => Math.round(source.positions[v * 3 + c] * 100))
      .join(",");
    const first = seen.get(key);
    if (first === undefined) seen.set(key, v);
    else parent[find(v)] = find(first);
  }
  for (let t = 0; t < source.indices.length; t += 3) {
    parent[find(source.indices[t + 1])] = find(source.indices[t]);
    parent[find(source.indices[t + 2])] = find(source.indices[t]);
  }
  const groups = new Map();
  for (let t = 0; t < source.indices.length / 3; t++) {
    const root = find(source.indices[t * 3]);
    const list = groups.get(root);
    if (list) list.push(t);
    else groups.set(root, [t]);
  }
  return [...groups.values()];
}

function wheelFrom(pts) {
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) {
    lo.min(p);
    hi.max(p);
  }
  const mid = lo.clone().add(hi).multiplyScalar(0.5);
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const p of pts) {
    xx += (p.x - mid.x) ** 2;
    zz += (p.z - mid.z) ** 2;
    xz += (p.x - mid.x) * (p.z - mid.z);
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  const plane = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const axis = new THREE.Vector3(-plane.z, 0, plane.x);
  let near = Infinity;
  let far = -Infinity;
  for (const p of pts) {
    const s = new THREE.Vector3().subVectors(p, mid).dot(plane);
    near = Math.min(near, s);
    far = Math.max(far, s);
  }
  const radius = (far - near) / 2;
  const centre = mid
    .clone()
    .addScaledVector(plane, (far + near) / 2)
    .setY(hi.y - radius);
  return { centre, plane, axis, radius, ground: lo.y };
}

function cartoonWheel({ centre, plane, axis, radius, ground }) {
  const list = [];
  const up = new THREE.Vector3(0, 1, 0);
  const at = (angle, r, depth) =>
    centre
      .clone()
      .addScaledVector(plane, Math.cos(angle) * r)
      .addScaledVector(up, Math.sin(angle) * r)
      .addScaledVector(axis, depth);
  for (let i = 0; i < wheelSegments; i++) {
    const a0 = (i / wheelSegments) * Math.PI * 2;
    const a1 = ((i + 1) / wheelSegments) * Math.PI * 2;
    const inner = radius - rimWidth;
    const half = rimDepth / 2;
    prism(
      list,
      [
        at(a0, radius, half),
        at(a0, inner, half),
        at(a0, inner, -half),
        at(a0, radius, -half),
        at(a1, radius, half),
        at(a1, inner, half),
        at(a1, inner, -half),
        at(a1, radius, -half),
      ],
      at((a0 + a1) / 2, radius - rimWidth / 2, 0),
    );
  }
  for (let k = 0; k < wheelSpokes; k++) {
    const angle = (k / wheelSpokes) * Math.PI * 2;
    beam(list, centre, at(angle, radius - rimWidth / 2, 0), spokeSize, axis);
  }
  beam(
    list,
    centre.clone().addScaledVector(axis, -hubSize / 2),
    centre.clone().addScaledVector(axis, hubSize / 2),
    hubSize,
    up,
  );
  for (const side of [-1, 1])
    for (const stance of [-1, 1]) {
      const foot = centre
        .clone()
        .addScaledVector(plane, side * radius * legSpread)
        .addScaledVector(axis, stance * legStance)
        .setY(ground);
      beam(list, centre, foot, legSize, axis);
    }
  return solid(list);
}

function merged(parts) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (const part of parts) {
    const base = positions.length / 3;
    positions.push(...part.positions);
    normals.push(...part.normals);
    for (const i of part.indices) indices.push(i + base);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: null,
    indices: Uint32Array.from(indices),
  };
}

function subset(source, triangles) {
  const pts = points(source, triangles);
  const normals = [];
  for (const t of triangles)
    for (let j = 0; j < 3; j++) {
      const v = source.indices[t * 3 + j];
      normals.push(
        ...(source.normals?.subarray(v * 3, v * 3 + 3) ?? [0, 1, 0]),
      );
    }
  return {
    positions: Float32Array.from(pts.flatMap((p) => p.toArray())),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from({ length: pts.length }, (_, i) => i),
  };
}

function insideWheel(wheel, pts) {
  const centroid = pts
    .reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .divideScalar(pts.length);
  const offset = new THREE.Vector3().subVectors(centroid, wheel.centre);
  return (
    Math.abs(offset.dot(wheel.axis)) < wheelReach &&
    Math.abs(offset.dot(wheel.plane)) < wheel.radius + wheelReach &&
    centroid.y > wheel.ground - 1
  );
}

export function withCartoonWheel(source) {
  const parts = components(source).map((triangles) => ({
    triangles,
    pts: points(source, triangles),
  }));
  const tall = parts.filter(({ pts }) => {
    const ys = pts.map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys) > wheelHeight;
  });
  if (!tall.length) return source;
  const wheel = wheelFrom(tall.flatMap(({ pts }) => pts));
  const rest = parts
    .filter(({ pts }) => !insideWheel(wheel, pts))
    .map(({ triangles }) => subset(source, triangles));
  return merged([cartoonWheel(wheel), ...rest]);
}

export function widenedStrip(factor) {
  return (source) => {
    const p = source.positions;
    const partner = new Int32Array(p.length / 3).fill(-1);
    const gap = (a, b) =>
      Math.hypot(
        p[a * 3] - p[b * 3],
        p[a * 3 + 1] - p[b * 3 + 1],
        p[a * 3 + 2] - p[b * 3 + 2],
      );
    for (let t = 0; t < source.indices.length; t += 3) {
      const [a, b, c] = source.indices.subarray(t, t + 3);
      const [x, y] = [
        [a, b],
        [b, c],
        [c, a],
      ].reduce((best, pair) =>
        gap(pair[0], pair[1]) < gap(best[0], best[1]) ? pair : best,
      );
      partner[x] = y;
      partner[y] = x;
    }
    const positions = Float32Array.from(p);
    for (let v = 0; v < partner.length; v++) {
      const other = partner[v];
      if (other < 0) continue;
      for (let c = 0; c < 3; c++) {
        const mid = (p[v * 3 + c] + p[other * 3 + c]) / 2;
        positions[v * 3 + c] = mid + (p[v * 3 + c] - mid) * factor;
      }
    }
    return { ...source, positions };
  };
}
