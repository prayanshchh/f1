import * as THREE from "three/webgpu";

const width = 1.96;
const bevel = 0.1;
const cabinWidth = 1.42;
const wheelRadius = 0.36;
const wheelWidth = 0.3;
const wheelBase = 2.72;
const track = 1.7;
const barLength = 1.15;
const flashRate = 7;
const paint = 0xd9dde3;
const accent = 0xff6a00;

const bodyOutline: [number, number][] = [
  [2.32, 0.24],
  [2.36, 0.46],
  [2.2, 0.6],
  [1.4, 0.78],
  [0.62, 0.86],
  [-1.5, 0.93],
  [-2.2, 1.0],
  [-2.34, 0.92],
  [-2.32, 0.44],
  [-2.18, 0.22],
];

const cabinOutline: [number, number][] = [
  [0.66, 0.84],
  [0.05, 1.2],
  [-0.85, 1.22],
  [-1.6, 0.93],
];

function extruded(
  outline: [number, number][],
  depth: number,
  rounding: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(
    outline.map(([x, z]) => new THREE.Vector2(x, z)),
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - rounding * 2,
    bevelEnabled: rounding > 0,
    bevelThickness: rounding,
    bevelSize: rounding,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, depth / 2 - rounding, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.castShadow = true;
  return part;
}

function box(
  size: [number, number, number],
  at: [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const part = mesh(new THREE.BoxGeometry(...size), material);
  part.position.set(...at);
  return part;
}

function wheel(
  x: number,
  y: number,
  tyre: THREE.Material,
  rim: THREE.Material,
) {
  const group = new THREE.Group();
  group.add(
    mesh(
      new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 24),
      tyre,
    ),
    mesh(
      new THREE.CylinderGeometry(
        wheelRadius * 0.62,
        wheelRadius * 0.62,
        wheelWidth + 0.01,
        12,
      ),
      rim,
    ),
  );
  group.position.set(x, y, wheelRadius);
  return group;
}

export class SafetyCar {
  readonly root = new THREE.Group();
  private readonly beacons: THREE.MeshStandardMaterial[];

  constructor() {
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
    const body = new THREE.MeshStandardMaterial({
      color: paint,
      metalness: 0.7,
      roughness: 0.32,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0c0f14,
      metalness: 0.2,
      roughness: 0.08,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x16171c,
      roughness: 0.6,
    });
    const stripe = new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.4,
    });
    const tyre = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.9,
    });
    const rim = new THREE.MeshStandardMaterial({
      color: 0xb8bcc4,
      metalness: 0.9,
      roughness: 0.25,
    });
    const head = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff4e0,
      emissiveIntensity: 2,
    });
    const tail = new THREE.MeshStandardMaterial({
      color: 0x550000,
      emissive: 0xff1a10,
      emissiveIntensity: 1.5,
    });
    this.beacons = [0, 1].map(
      () =>
        new THREE.MeshStandardMaterial({
          color: 0x553300,
          emissive: 0xffa000,
          emissiveIntensity: 0,
        }),
    );
    const side = width / 2;
    this.root.add(
      mesh(extruded(bodyOutline, width, bevel), body),
      mesh(extruded(cabinOutline, cabinWidth, 0.06), glass),
      box([4.5, 0.02, 0.09], [0, side + 0.005, 0.62], stripe),
      box([4.5, 0.02, 0.09], [0, -side - 0.005, 0.62], stripe),
      box([4.4, width - 0.1, 0.12], [0, 0, 0.2], trim),
      box([0.06, 0.38, 0.08], [2.3, side - 0.32, 0.56], head),
      box([0.06, 0.38, 0.08], [2.3, -side + 0.32, 0.56], head),
      box([0.05, 0.42, 0.07], [-2.33, side - 0.3, 0.84], tail),
      box([0.05, 0.42, 0.07], [-2.33, -side + 0.3, 0.84], tail),
      box([0.34, barLength, 0.06], [-0.4, 0, 1.25], trim),
      box([0.26, 0.4, 0.09], [-0.4, 0.33, 1.3], this.beacons[0] ?? trim),
      box([0.26, 0.4, 0.09], [-0.4, -0.33, 1.3], this.beacons[1] ?? trim),
    );
    for (const x of [wheelBase / 2, -wheelBase / 2])
      for (const y of [track / 2, -track / 2])
        this.root.add(wheel(x, y, tyre, rim));
  }

  update(pose: ArrayLike<number> | null, lightsOn: boolean, now: number) {
    this.root.visible = pose !== null;
    if (!pose) return;
    this.root.matrix.fromArray(pose);
    this.root.matrixWorldNeedsUpdate = true;
    const phase = Math.sin(now * flashRate) > 0;
    this.beacons.forEach((beacon, i) => {
      beacon.emissiveIntensity = lightsOn && phase === (i === 0) ? 4 : 0;
    });
  }
}
