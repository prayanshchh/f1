import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three/webgpu";
import type { TrackData } from "../../contracts/index.ts";
import { ribbon } from "./ribbon.ts";

function ground(track: TrackData): Mesh {
  const xs = track.centerline.map((p) => p.x);
  const zs = track.centerline.map((p) => p.z);
  const xmin = Math.min(...xs),
    xmax = Math.max(...xs);
  const zmin = Math.min(...zs),
    zmax = Math.max(...zs);
  const size = Math.max(xmax - xmin, zmax - zmin) + 1000;
  const mesh = new Mesh(
    new PlaneGeometry(size, size),
    new MeshStandardMaterial({ color: 0x3d5a3a, roughness: 1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    (xmin + xmax) / 2,
    Math.min(...track.centerline.map((p) => p.y)) - 0.5,
    (zmin + zmax) / 2,
  );
  return mesh;
}

export function createRoad(track: TrackData): Group {
  const data = ribbon(track);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  const road = new Group();
  road.name = "road";
  road.add(
    new Mesh(
      geometry,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    ),
    ground(track),
  );
  const first = track.centerline[0],
    next = track.centerline[1];
  if (first === undefined || next === undefined)
    throw new Error("The start line needs two points");
  const line = new Mesh(
    new PlaneGeometry(track.width, 0.8),
    new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 }),
  );
  line.rotation.order = "YXZ";
  line.rotation.set(
    -Math.PI / 2,
    Math.atan2(next.x - first.x, next.z - first.z),
    0,
  );
  line.position.set(first.x, first.y + 0.02, first.z);
  road.add(line);
  return road;
}
