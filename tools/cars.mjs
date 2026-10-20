import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { PNG } from "pngjs";
import { format } from "prettier";

const car = { id: "vanta-26", name: "Vanta V26" };
const directory = path.join("content/cars", car.id);
const detail = [0.85, 0.52, 0.35, 0.23];
const maskSize = 1024;
const tyreRadius = 0.355;
const axles = {
  front: { z: 1.75, x: 0.78, width: 0.3 },
  rear: { z: -1.45, x: 0.76, width: 0.37 },
};
const eye = [0, 0.72, 0.38];
const steeringWheel = [0, 0.5, 0.72];

const liveries = [
  {
    id: "ember",
    name: "Ember",
    primary: "#d8471c",
    secondary: "#1b1d22",
    accent: "#f2c230",
    number: 7,
  },
  {
    id: "glacier",
    name: "Glacier",
    primary: "#e8eef2",
    secondary: "#1f5fa8",
    accent: "#00b3a4",
    number: 21,
  },
  {
    id: "nightjar",
    name: "Nightjar",
    primary: "#16233b",
    secondary: "#c9ccd1",
    accent: "#e5338c",
    number: 64,
  },
];

const materials = {
  livery: { color: [1, 1, 1, 1], metallic: 0.3, roughness: 0.35 },
  carbon: { color: [0.03, 0.03, 0.035, 1], metallic: 0.2, roughness: 0.45 },
  interior: { color: [0.05, 0.05, 0.06, 1], metallic: 0, roughness: 0.7 },
  rubber: { color: [0.02, 0.02, 0.02, 1], metallic: 0, roughness: 0.85 },
  rim: { color: [0.18, 0.18, 0.2, 1], metallic: 1, roughness: 0.3 },
};

const centralKeys = [
  [-1.95, 0.07, 0.14, 0.38],
  [-1.5, 0.13, 0.09, 0.52],
  [-1.0, 0.19, 0.06, 0.68],
  [-0.5, 0.24, 0.05, 0.86],
  [-0.15, 0.26, 0.05, 0.92],
  [0.2, 0.3, 0.05, 0.62],
  [0.7, 0.28, 0.05, 0.6],
  [1.1, 0.22, 0.06, 0.55],
  [1.75, 0.15, 0.11, 0.44],
  [2.3, 0.09, 0.14, 0.34],
  [2.85, 0.05, 0.17, 0.26],
];

const sidepodKeys = [
  [-1.2, 0.05, 0.1, 0.26],
  [-0.7, 0.16, 0.08, 0.4],
  [-0.2, 0.22, 0.07, 0.5],
  [0.3, 0.22, 0.08, 0.52],
  [0.55, 0.12, 0.12, 0.42],
];

const floorKeys = [
  [-1.9, 0.5, 0.03, 0.12],
  [-1.3, 0.62, 0.03, 0.06],
  [0.6, 0.7, 0.03, 0.06],
  [1.1, 0.3, 0.04, 0.07],
];

const signedPow = (value, power) => Math.sign(value) * Math.abs(value) ** power;

const smooth = (t) => t * t * (3 - 2 * t);

function window(value, from, to, ramp) {
  const rise = Math.min(1, Math.max(0, (value - from) / ramp));
  const fall = Math.min(1, Math.max(0, (to - value) / ramp));
  return smooth(Math.min(rise, fall));
}

function endCap(v) {
  return Math.sqrt(
    Math.sin((Math.PI / 2) * Math.min(1, Math.min(v, 1 - v) / 0.04)),
  );
}

function steps(base, scale, minimum) {
  return Math.max(minimum, Math.round((base * scale) / 4) * 4);
}

function sample(keys, z) {
  const index = Math.max(
    0,
    keys.findIndex((key, position) => z <= (keys[position + 1] ?? key)[0]),
  );
  const from = keys[Math.min(index, keys.length - 2)];
  const to = keys[Math.min(index + 1, keys.length - 1)];
  const t = smooth(Math.min(1, Math.max(0, (z - from[0]) / (to[0] - from[0]))));
  return from.map((value, field) => value + (to[field] - value) * t).slice(1);
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function vertex(positions, index) {
  return [
    positions[index * 3],
    positions[index * 3 + 1],
    positions[index * 3 + 2],
  ];
}

function smoothNormals(positions, indices) {
  const keys = [];
  const sums = new Map();
  for (let index = 0; index < positions.length / 3; index += 1) {
    const key = vertex(positions, index)
      .map((value) => value.toFixed(5))
      .join(",");
    keys.push(key);
    sums.set(key, [0, 0, 0]);
  }
  for (let offset = 0; offset < indices.length; offset += 3) {
    const corners = [0, 1, 2].map((corner) =>
      vertex(positions, indices[offset + corner]),
    );
    const face = cross(
      subtract(corners[1], corners[0]),
      subtract(corners[2], corners[0]),
    );
    for (let corner = 0; corner < 3; corner += 1) {
      const sum = sums.get(keys[indices[offset + corner]]);
      for (let axis = 0; axis < 3; axis += 1) {
        sum[axis] += face[axis];
      }
    }
  }
  return keys.flatMap((key) => normalize(sums.get(key)));
}

function signedVolume(positions, indices) {
  let volume = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const [a, b, c] = [0, 1, 2].map((corner) =>
      vertex(positions, indices[offset + corner]),
    );
    const [x, y, z] = cross(b, c);
    volume += a[0] * x + a[1] * y + a[2] * z;
  }
  return volume;
}

function grid(nu, nv, point) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= nv; j += 1) {
    for (let i = 0; i <= nu; i += 1) {
      positions.push(...point(i / nu, j / nv));
      uvs.push(i / nu, 1 - j / nv);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = j * row + i;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  if (signedVolume(positions, indices) < 0) {
    for (let offset = 0; offset < indices.length; offset += 3) {
      [indices[offset + 1], indices[offset + 2]] = [
        indices[offset + 2],
        indices[offset + 1],
      ];
    }
  }
  return {
    positions,
    uvs,
    indices,
    normals: smoothNormals(positions, indices),
  };
}

function cockpitDip(z, cx, cy) {
  const across = Math.max(0, 1 - (cx / 0.75) ** 2) ** 2;
  return 0.2 * window(z, 0.1, 0.95, 0.15) * across * Math.max(0, cy);
}

function loft({ keys, exponent, nu, nv, centreX = 0, dip = false }) {
  const from = keys[0][0];
  const to = keys[keys.length - 1][0];
  return grid(nu, nv, (u, v) => {
    const z = from + (to - from) * v;
    const [halfWidth, bottom, top] = sample(keys, z);
    const cap = endCap(v);
    const cx = signedPow(Math.cos(2 * Math.PI * u), 2 / exponent);
    const cy = signedPow(Math.sin(2 * Math.PI * u), 2 / exponent);
    const lowered = dip ? cockpitDip(z, cx, cy) : 0;
    return [
      centreX + halfWidth * cap * cx,
      (bottom + top) / 2 + ((top - bottom) / 2) * cap * cy - lowered,
      z,
    ];
  });
}

function slab({ x = 0, halfWidth, bottom, top, back, front, nu, nv }) {
  return loft({
    keys: [
      [back, halfWidth, bottom, top],
      [front, halfWidth, bottom, top],
    ],
    exponent: 8,
    nu,
    nv,
    centreX: x,
  });
}

function airfoil(c) {
  return (
    5 *
    (0.2969 * Math.sqrt(c) -
      0.126 * c -
      0.3516 * c ** 2 +
      0.2843 * c ** 3 -
      0.1036 * c ** 4)
  );
}

function wing({ span, chord, z, y, thickness, angle, nu, nv }) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return grid(nu, nv, (u, v) => {
    const theta = 2 * Math.PI * u;
    const along = ((1 - Math.cos(theta)) / 2) * chord;
    const up =
      Math.sign(Math.sin(theta)) *
      airfoil(along / chord) *
      thickness *
      chord *
      endCap(v);
    return [
      span * (v - 0.5),
      y + along * sin + up * cos,
      z - along * cos + up * sin,
    ];
  });
}

function tube(curve, radius, nu, nv) {
  return grid(nu, nv, (u, v) => {
    const centre = curve(v);
    const tangent = normalize(
      subtract(curve(Math.min(1, v + 0.001)), curve(Math.max(0, v - 0.001))),
    );
    const reference = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const normal = normalize(cross(tangent, reference));
    const binormal = cross(tangent, normal);
    const theta = 2 * Math.PI * u;
    const r = radius * endCap(v);
    return [0, 1, 2].map(
      (axis) =>
        centre[axis] +
        r * (Math.cos(theta) * normal[axis] + Math.sin(theta) * binormal[axis]),
    );
  });
}

function line(from, to) {
  return (t) => from.map((value, axis) => value + (to[axis] - value) * t);
}

function haloCurve(t) {
  const phi = (t - 0.5) * 2 * Math.PI * 0.82;
  const rise = window(t, 0, 1, 0.12);
  return [0.27 * Math.sin(phi), 0.6 + 0.22 * rise, 0.42 + 0.34 * Math.cos(phi)];
}

function polyline(points) {
  return (v) => {
    const scaled = v * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(scaled));
    const t = scaled - index;
    return points[index].map(
      (value, axis) => value + (points[index + 1][axis] - value) * t,
    );
  };
}

function lathe(profile, nu, nv) {
  return grid(nu, nv, (u, v) => {
    const [x, rho] = profile(v);
    const theta = 2 * Math.PI * u;
    return [x, rho * Math.cos(theta), rho * Math.sin(theta)];
  });
}

function tyreProfile(width) {
  const inner = 0.215;
  const centre = (tyreRadius + inner) / 2;
  const half = (tyreRadius - inner) / 2;
  return (v) => [
    (width / 2) * signedPow(Math.cos(2 * Math.PI * v), 0.5),
    centre + half * signedPow(Math.sin(2 * Math.PI * v), 0.5),
  ];
}

function rimProfile(width) {
  const a = width / 2 - 0.015;
  return polyline([
    [a, 0],
    [a - 0.01, 0.05],
    [a - 0.03, 0.2],
    [a, 0.229],
    [-a, 0.229],
    [-a + 0.03, 0.2],
    [-a + 0.01, 0.05],
    [-a, 0],
  ]);
}

function mirrored(build) {
  return [build(1), build(-1)];
}

function wings(s) {
  const span = steps(120, s, 12);
  const around = steps(40, s, 8);
  const front = [0, 1, 2].map((element) =>
    wing({
      span: 1.8,
      chord: 0.24 - element * 0.05,
      z: 2.95 - element * 0.17,
      y: 0.07 + element * 0.06,
      thickness: 0.12,
      angle: 0.12 + element * 0.22,
      nu: around,
      nv: span,
    }),
  );
  const rear = [0, 1].map((element) =>
    wing({
      span: 1.0,
      chord: 0.3 - element * 0.12,
      z: -1.95 - element * 0.24,
      y: 0.74 + element * 0.12,
      thickness: 0.14,
      angle: 0.1 + element * 0.3,
      nu: around,
      nv: steps(80, s, 8),
    }),
  );
  return [...front, ...rear];
}

function endplates(s) {
  const nu = steps(16, s, 8);
  const nv = steps(24, s, 4);
  return [
    ...mirrored((side) =>
      slab({
        x: side * 0.9,
        halfWidth: 0.01,
        bottom: 0.04,
        top: 0.28,
        back: 2.45,
        front: 2.97,
        nu,
        nv,
      }),
    ),
    ...mirrored((side) =>
      slab({
        x: side * 0.51,
        halfWidth: 0.01,
        bottom: 0.38,
        top: 0.95,
        back: -2.25,
        front: -1.85,
        nu,
        nv,
      }),
    ),
  ];
}

function suspension(s) {
  const nu = steps(12, s, 4);
  const nv = steps(16, s, 2);
  const arms = [];
  for (const axle of Object.values(axles)) {
    const hub = axle.x - axle.width / 2 - 0.02;
    for (const side of [1, -1]) {
      for (const [height, rake] of [
        [0.42, 0.2],
        [0.42, -0.2],
        [0.16, 0.25],
        [0.16, -0.25],
      ]) {
        arms.push(
          tube(
            line(
              [side * 0.12, height, axle.z + rake],
              [side * hub, height - 0.03, axle.z],
            ),
            0.016,
            nu,
            nv,
          ),
        );
      }
    }
  }
  return arms;
}

function mirrors(s) {
  const nu = steps(20, s, 8);
  const nv = steps(12, s, 4);
  return mirrored((side) =>
    loft({
      keys: [
        [0.72, 0.07, 0.6, 0.66],
        [0.82, 0.07, 0.6, 0.66],
      ],
      exponent: 3,
      nu,
      nv,
      centreX: side * 0.42,
    }),
  );
}

function bodyParts(s) {
  return {
    livery: [
      loft({
        keys: centralKeys,
        exponent: 2.6,
        nu: steps(112, s, 12),
        nv: steps(220, s, 24),
        dip: true,
      }),
      ...mirrored((side) =>
        loft({
          keys: sidepodKeys,
          exponent: 3,
          nu: steps(64, s, 8),
          nv: steps(100, s, 12),
          centreX: side * 0.48,
        }),
      ),
      ...endplates(s),
    ],
    carbon: [
      loft({
        keys: floorKeys,
        exponent: 10,
        nu: steps(48, s, 8),
        nv: steps(120, s, 12),
      }),
      ...wings(s),
      tube(haloCurve, 0.022, steps(16, s, 6), steps(120, s, 16)),
      tube(
        line([0, 0.82, 0.76], [0, 0.6, 0.98]),
        0.02,
        steps(16, s, 6),
        steps(20, s, 4),
      ),
      ...suspension(s),
      ...mirrors(s),
    ],
  };
}

function cockpitParts(s) {
  return {
    interior: [
      loft({
        keys: [
          [0.05, 0.2, 0.3, 0.58],
          [0.25, 0.18, 0.25, 0.5],
          [0.45, 0.16, 0.2, 0.32],
        ],
        exponent: 3,
        nu: steps(40, s, 8),
        nv: steps(40, s, 6),
      }),
      slab({
        halfWidth: 0.2,
        bottom: 0.38,
        top: 0.5,
        back: 0.8,
        front: 0.92,
        nu: steps(24, s, 8),
        nv: steps(12, s, 4),
      }),
    ],
  };
}

function steeringParts(s) {
  const nu = steps(24, s, 8);
  const nv = steps(8, s, 4);
  return {
    carbon: [
      slab({
        halfWidth: 0.11,
        bottom: -0.07,
        top: 0.07,
        back: -0.025,
        front: 0.025,
        nu,
        nv,
      }),
      ...mirrored((side) =>
        slab({
          x: side * 0.125,
          halfWidth: 0.025,
          bottom: -0.07,
          top: 0.06,
          back: -0.03,
          front: 0.03,
          nu,
          nv,
        }),
      ),
    ],
  };
}

function wheelParts(axle, s) {
  const around = steps(128, s, 16);
  return {
    rubber: [lathe(tyreProfile(axle.width), around, steps(40, s, 8))],
    rim: [lathe(rimProfile(axle.width), around, steps(28, s, 7))],
  };
}

function merge(parts) {
  const offsets = parts.map((_, index) =>
    parts
      .slice(0, index)
      .reduce((total, part) => total + part.positions.length / 3, 0),
  );
  return {
    positions: parts.flatMap((part) => part.positions),
    normals: parts.flatMap((part) => part.normals),
    uvs: parts.flatMap((part) => part.uvs),
    indices: parts.flatMap((part, index) =>
      part.indices.map((value) => value + (offsets[index] ?? 0)),
    ),
  };
}

function accessor(document, buffer, type, array) {
  return document
    .createAccessor()
    .setType(type)
    .setArray(array)
    .setBuffer(buffer);
}

function createMesh(document, buffer, name, groups, palette) {
  const mesh = document.createMesh(name);
  for (const [material, parts] of Object.entries(groups)) {
    const data = merge(parts);
    mesh.addPrimitive(
      document
        .createPrimitive()
        .setMaterial(palette[material])
        .setIndices(
          accessor(document, buffer, "SCALAR", new Uint32Array(data.indices)),
        )
        .setAttribute(
          "POSITION",
          accessor(document, buffer, "VEC3", new Float32Array(data.positions)),
        )
        .setAttribute(
          "NORMAL",
          accessor(document, buffer, "VEC3", new Float32Array(data.normals)),
        )
        .setAttribute(
          "TEXCOORD_0",
          accessor(document, buffer, "VEC2", new Float32Array(data.uvs)),
        ),
    );
  }
  return mesh;
}

function createPalette(document) {
  return Object.fromEntries(
    Object.entries(materials).map(([name, { color, metallic, roughness }]) => [
      name,
      document
        .createMaterial(name)
        .setBaseColorFactor(color)
        .setMetallicFactor(metallic)
        .setRoughnessFactor(roughness),
    ]),
  );
}

function buildLod(s) {
  const document = new Document();
  const buffer = document.createBuffer();
  const palette = createPalette(document);
  const mesh = (name, groups) =>
    createMesh(document, buffer, name, groups, palette);
  const steering = document
    .createNode("steering-wheel")
    .setTranslation(steeringWheel)
    .setMesh(mesh("steering-wheel", steeringParts(s)));
  const cockpit = document
    .createNode("cockpit")
    .setMesh(mesh("cockpit", cockpitParts(s)))
    .addChild(steering);
  const body = document
    .createNode("body")
    .setMesh(mesh("body", bodyParts(s)))
    .addChild(cockpit);
  const scene = document
    .createScene("car")
    .addChild(body)
    .addChild(document.createNode("eye").setTranslation(eye));
  for (const [axleName, axle] of Object.entries(axles)) {
    const wheelMesh = mesh(`wheel-${axleName}`, wheelParts(axle, s));
    for (const [suffix, side] of [
      ["l", 1],
      ["r", -1],
    ]) {
      scene.addChild(
        document
          .createNode(`wheel-${axleName[0]}${suffix}`)
          .setTranslation([side * axle.x, tyreRadius, axle.z])
          .setMesh(wheelMesh),
      );
    }
  }
  document.getRoot().setDefaultScene(scene);
  return document;
}

function maskWeights(u, v) {
  const pixel = 1.5 / maskSize;
  const edge = (distance) => Math.min(1, Math.max(0, 0.5 + distance / pixel));
  const stripe = edge(0.03 - Math.abs(u - 0.25));
  const nose = edge(v - 0.93);
  const accent = Math.max(stripe, nose);
  const lower = edge(0.22 - Math.abs(u - 0.75));
  const secondary = (1 - accent) * lower;
  return [accent, secondary];
}

function buildMask() {
  const png = new PNG({ width: maskSize, height: maskSize });
  for (let row = 0; row < maskSize; row += 1) {
    for (let column = 0; column < maskSize; column += 1) {
      const [accent, secondary] = maskWeights(
        (column + 0.5) / maskSize,
        1 - (row + 0.5) / maskSize,
      );
      const blue = Math.round(accent * 255);
      const green = Math.round(secondary * 255);
      const offset = (row * maskSize + column) * 4;
      png.data[offset] = 255 - blue - green;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

async function writeJson(file, value) {
  writeFileSync(
    path.join(directory, file),
    await format(JSON.stringify(value), { parser: "json" }),
  );
}

const io = new NodeIO();
mkdirSync(path.join(directory, "liveries"), { recursive: true });
const lods = [];
for (const [level, scale] of detail.entries()) {
  const file = `lod${String(level)}.glb`;
  writeFileSync(
    path.join(directory, file),
    await io.writeBinary(buildLod(scale)),
  );
  lods.push(file);
}
writeFileSync(path.join(directory, "livery-mask.png"), buildMask());
const liveryFiles = [];
for (const livery of liveries) {
  const file = `liveries/${livery.id}.json`;
  await writeJson(file, livery);
  liveryFiles.push(file);
}
await writeJson("car.json", {
  ...car,
  lods,
  liveryMask: "livery-mask.png",
  liveries: liveryFiles,
});
