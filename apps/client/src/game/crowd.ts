import * as THREE from "three/webgpu";
import { alphaTestedOrder } from "./road.ts";
import { SkyLitMaterial } from "./sky-ambient.ts";
import {
  attribute,
  cos,
  float,
  floor,
  fract,
  instancedBufferAttribute,
  mix,
  normalize,
  positionGeometry,
  sin,
  step,
  texture,
  time,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import albedoUrl from "../../../../content/tracks/hill-country/textures/baked/people_albedo.png?url";
import crowdUrl from "../../../../content/tracks/hill-country/crowd.bin?url";
import maskUrl from "../../../../content/tracks/hill-country/textures/baked/people_mask.png?url";
import { releaseOnceUploaded } from "./preload.ts";

const stride = 8;
const tileSize = 600;
const personHeight = 2;
const personWidth = 1;
const atlasColumns = 8;
const atlasRows = 4;
const alphaCutoff = 0.5;
const bobHeight = 0.05;
const bobRate = 3.2;
const skinGain = 1.0;
const heightJitter = 0.07;
const fanColours: [string, number][] = [
  ["#f2f2f0", 14],
  ["#1b1b1d", 12],
  ["#1d2b4f", 9],
  ["#8a8d91", 6],
  ["#b8b9bb", 4],
  ["#c8202a", 7],
  ["#ff7a1a", 7],
  ["#19a7a0", 3],
  ["#2453c7", 5],
  ["#f4c20d", 3],
  ["#1f7a3a", 2],
  ["#e8508e", 2],
  ["#6b1f2b", 2],
  ["#6fb7e8", 3],
  ["#c8b48a", 3],
  ["#3e5a7e", 3],
];
const flagShare = 0.02;
const flagSize = [0.95, 0.6] as const;
const flagGrip = 1.35;
const flagPole = 1.25;
const flagSegments = [10, 4] as const;
const flagWave = 0.12;
const flagRate = 5.5;
const flagPairs = [
  ["#ff7a1a", "#1b1b1d"],
  ["#c8202a", "#f4c20d"],
  ["#1d2b4f", "#f2f2f0"],
  ["#19a7a0", "#f2f2f0"],
  ["#2453c7", "#c8202a"],
  ["#1f7a3a", "#f2f2f0"],
  ["#f2f2f0", "#c8202a"],
  ["#1b1b1d", "#f4c20d"],
] as const;

function pickWeighted(roll: number): THREE.Color {
  const total = fanColours.reduce((sum, [, weight]) => sum + weight, 0);
  let left = roll * total;
  for (const [colour, weight] of fanColours) {
    left -= weight;
    if (left <= 0) return new THREE.Color(colour);
  }
  return new THREE.Color(fanColours[0]?.[0] ?? "#ffffff");
}

function roll(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const eyeModel = uniform(new THREE.Vector3());
const spriteCells = atlasColumns * atlasRows;

type Atlas = CanvasImageSource & { width: number; height: number };

function alphaOf(image: Atlas): Float32Array {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas for the crowd atlas");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const alpha = new Float32Array(image.width * image.height);
  for (let i = 0; i < alpha.length; i++)
    alpha[i] = (rgba[i * 4 + 3] ?? 0) / 255;
  return alpha;
}

function halved(level: Float32Array, width: number, height: number) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const next = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const sx = Math.min(width - 1, x * 2 + dx);
        const sy = Math.min(height - 1, y * 2 + dy);
        sum += level[sy * width + sx] ?? 0;
      }
      next[y * w + x] = sum / 4;
    }
  return { next, w, h };
}

function grow(
  box: number[],
  left: number,
  right: number,
  top: number,
  bottom: number,
) {
  box[0] = Math.min(box[0] ?? 1, THREE.MathUtils.clamp(left, 0, 1));
  box[1] = Math.max(box[1] ?? 0, THREE.MathUtils.clamp(right, 0, 1));
  box[2] = Math.min(box[2] ?? 1, THREE.MathUtils.clamp(top, 0, 1));
  box[3] = Math.max(box[3] ?? 0, THREE.MathUtils.clamp(bottom, 0, 1));
}

function markTexel(
  boxes: number[][],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const left = ((x - 1) / w) * atlasColumns;
  const right = ((x + 2) / w) * atlasColumns;
  const top = ((y - 1) / h) * atlasRows;
  const bottom = ((y + 2) / h) * atlasRows;
  const lastColumn = Math.min(atlasColumns, Math.ceil(right)) - 1;
  const lastRow = Math.min(atlasRows, Math.ceil(bottom)) - 1;
  for (let row = Math.max(0, Math.floor(top)); row <= lastRow; row++)
    for (
      let column = Math.max(0, Math.floor(left));
      column <= lastColumn;
      column++
    ) {
      const box = boxes[row * atlasColumns + column];
      if (box)
        grow(box, left - column, right - column, top - row, bottom - row);
    }
}

export function spriteBounds(
  alpha: Float32Array,
  width: number,
  height: number,
): THREE.Vector4[] {
  const boxes = Array.from({ length: spriteCells }, () => [1, 0, 1, 0]);
  let level = alpha;
  let w = width;
  let h = height;
  for (;;) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if ((level[y * w + x] ?? 0) >= alphaCutoff)
          markTexel(boxes, x, y, w, h);
    if (w === 1 && h === 1) break;
    ({ next: level, w, h } = halved(level, w, h));
  }
  return boxes.map(([left = 0, right = 0, top = 0, bottom = 0]) =>
    right > left && bottom > top
      ? new THREE.Vector4(left, right, top, bottom)
      : new THREE.Vector4(),
  );
}

function material(
  albedo: THREE.Texture,
  mask: THREE.Texture,
  boxes: ReturnType<typeof uniformArray>,
  origin: THREE.InstancedBufferAttribute,
  shirt: THREE.InstancedBufferAttribute,
) {
  const result = new SkyLitMaterial({
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
    alphaTest: alphaCutoff,
  });
  const place = vec4(
    instancedBufferAttribute(origin) as ReturnType<typeof vec4>,
  );
  const tint = vec4(instancedBufferAttribute(shirt) as ReturnType<typeof vec4>);
  const toEye = eyeModel.sub(place.xyz);
  const flat = normalize(vec2(toEye.x, toEye.z));
  const right = vec3(flat.y, 0, flat.x.negate());
  const phase = place.x.mul(0.37).add(place.z.mul(0.71));
  const bob = sin(time.mul(bobRate).add(phase)).abs().mul(bobHeight);
  const box = boxes.element(
    floor(tint.w).toInt(),
  ) as unknown as THREE.Node<"vec4">;
  const across = mix(box.x, box.y, positionGeometry.x.add(0.5));
  const down = mix(box.z, box.w, float(1).sub(positionGeometry.y));
  result.positionNode = place.xyz
    .add(right.mul(across.sub(0.5).mul(personWidth).mul(place.w)))
    .add(
      vec3(0, float(1).sub(down).mul(personHeight).mul(place.w).add(bob), 0),
    );
  const cell = varying(floor(tint.w));
  const sprite = vec2(
    cell.mod(atlasColumns).add(varying(across)).div(atlasColumns),
    floor(cell.div(atlasColumns)).add(varying(down)).div(atlasRows),
  );
  const colour = texture(albedo, sprite);
  const shirtMask = texture(mask, sprite).r;
  const painted = mix(
    colour.rgb.mul(skinGain),
    colour.rgb.mul(varying(tint.xyz)).mul(1.1),
    shirtMask,
  );
  result.colorNode = vec4(painted, colour.a);
  result.normalNode = vec3(0, 0.25, 0.97);
  return result;
}

function flagGeometry(): THREE.BufferGeometry {
  const cloth = new THREE.PlaneGeometry(1, 1, ...flagSegments);
  cloth.translate(0.5, 0.5, 0);
  const pole = new THREE.PlaneGeometry(0.03, 1);
  pole.translate(-0.015, 0.5, 0);
  const parts = [cloth, pole].map((part, index) => {
    const geometry = part.toNonIndexed();
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute(
      "cloth",
      new THREE.BufferAttribute(new Float32Array(count).fill(1 - index), 1),
    );
    return geometry;
  });
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "cloth"]) {
    const arrays = parts.map(
      (part) => part.getAttribute(name).array as Float32Array,
    );
    const size = parts[0]?.getAttribute(name).itemSize ?? 1;
    const joined = new Float32Array(
      arrays.reduce((sum, array) => sum + array.length, 0),
    );
    let at = 0;
    for (const array of arrays) {
      joined.set(array, at);
      at += array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(joined, size));
  }
  return merged;
}

function flagMaterial(
  place: THREE.InstancedBufferAttribute,
  colours: THREE.InstancedBufferAttribute,
  second: THREE.InstancedBufferAttribute,
) {
  const result = new SkyLitMaterial({
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });
  const at = vec4(instancedBufferAttribute(place) as ReturnType<typeof vec4>);
  const first = vec4(
    instancedBufferAttribute(colours) as ReturnType<typeof vec4>,
  );
  const other = vec3(
    instancedBufferAttribute(second) as ReturnType<typeof vec3>,
  );
  const cloth = attribute<"float">("cloth", "float");
  const toEye = eyeModel.sub(at.xyz);
  const flat = normalize(vec2(toEye.x, toEye.z));
  const right = vec3(flat.y, 0, flat.x.negate());
  const forward = vec3(flat.x, 0, flat.y);
  const u = positionGeometry.x;
  const swing = time.mul(flagRate).add(at.w.mul(6.3)).sub(u.mul(4.5));
  const wave = sin(swing).mul(u).mul(flagWave);
  const sweep = cos(time.mul(1.3).add(at.w.mul(3)))
    .mul(0.25)
    .mul(u);
  const width = mix(float(1), float(flagSize[0]), cloth);
  const tall = mix(float(flagPole), float(flagSize[1]), cloth);
  const lift = mix(
    float(flagGrip - 0.15),
    float(flagGrip + flagPole - flagSize[1]),
    cloth,
  );
  result.positionNode = at.xyz
    .add(right.mul(u.mul(width)))
    .add(forward.mul(wave.add(sweep).mul(cloth)))
    .add(vec3(0, positionGeometry.y.mul(tall).add(lift), 0));
  const slope = cos(swing)
    .mul(u)
    .mul(flagWave * 4.5)
    .mul(cloth);
  result.normalNode = normalize(vec3(slope.negate(), 0, 1));
  const pattern = floor(first.w);
  const band = mix(
    step(0.5, fract(uv().y.mul(1.5))),
    step(0.33, uv().x).mul(step(uv().x, 0.66)),
    step(0.5, pattern),
  );
  const fabric = mix(first.xyz, other, band);
  result.colorNode = mix(vec3(0.08, 0.08, 0.09), fabric, cloth);
  return result;
}

function triple(values: Float32Array, at: number): [number, number, number] {
  return [values[at] ?? 0, values[at + 1] ?? 0, values[at + 2] ?? 0];
}

function flagPair(person: number): [THREE.Color, THREE.Color] {
  const [a, b] =
    flagPairs[Math.floor(roll(person, 9) * flagPairs.length)] ?? flagPairs[0];
  return [new THREE.Color(a), new THREE.Color(b)];
}

function flags(values: Float32Array): THREE.InstancedMesh {
  const chosen: number[] = [];
  for (let i = 0; i < values.length; i += stride)
    if (roll(i / stride, 7) < flagShare) chosen.push(i);
  const place = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 4),
    4,
  );
  const colours = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 4),
    4,
  );
  const second = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 3),
    3,
  );
  const mesh = new THREE.InstancedMesh(
    flagGeometry(),
    flagMaterial(place, colours, second),
    chosen.length,
  );
  const matrix = new THREE.Matrix4();
  chosen.forEach((source, i) => {
    const person = source / stride;
    const [x, north, up] = triple(values, source);
    place.setXYZW(i, x, up, -north, roll(person, 8));
    const [a, b] = flagPair(person);
    colours.setXYZW(i, a.r, a.g, a.b, roll(person, 10) < 0.5 ? 0 : 1);
    second.setXYZ(i, b.r, b.g, b.b);
    matrix.makeTranslation(x, up + flagGrip, -north);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export class Crowd {
  readonly root = new THREE.Group();
  private readonly inverse = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();

  private constructor() {}

  static async load(): Promise<Crowd> {
    const crowd = new Crowd();
    const loader = new THREE.TextureLoader();
    const atlas = async (url: string, colorSpace: string) => {
      const map = releaseOnceUploaded(await loader.loadAsync(url));
      map.flipY = false;
      map.colorSpace = colorSpace;
      return map;
    };
    const [albedo, mask, response] = await Promise.all([
      atlas(albedoUrl, THREE.SRGBColorSpace),
      atlas(maskUrl, THREE.NoColorSpace),
      fetch(crowdUrl),
    ]);
    const image = albedo.image as Atlas;
    const boxes = uniformArray(
      spriteBounds(alphaOf(image), image.width, image.height),
      "vec4",
    );
    const values = new Float32Array(await response.arrayBuffer());
    const tiles = new Map<string, number[]>();
    for (let i = 0; i < values.length; i += stride) {
      const key = `${String(Math.floor((values[i] ?? 0) / tileSize))}|${String(Math.floor((values[i + 1] ?? 0) / tileSize))}`;
      const list = tiles.get(key) ?? [];
      list.push(i);
      tiles.set(key, list);
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const matrix = new THREE.Matrix4();
    for (const indices of tiles.values()) {
      const origin = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 4),
        4,
      );
      const shirt = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 4),
        4,
      );
      const mesh = new THREE.InstancedMesh(
        plane,
        material(albedo, mask, boxes, origin, shirt),
        indices.length,
      );
      indices.forEach((source, i) => {
        const x = values[source] ?? 0;
        const north = values[source + 1] ?? 0;
        const up = values[source + 2] ?? 0;
        const person = source / stride;
        const scale = 1 + (roll(person, 1) - 0.5) * 2 * heightJitter;
        origin.setXYZW(i, x, up, -north, scale);
        const fan = pickWeighted(roll(person, 2)).multiplyScalar(
          0.82 + 0.25 * roll(person, 3),
        );
        shirt.setXYZW(i, fan.r, fan.g, fan.b, values[source + 4] ?? 0);
        matrix.makeScale(personHeight, personHeight, personHeight);
        matrix.setPosition(x, up, -north);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.computeBoundingSphere();
      mesh.renderOrder = alphaTestedOrder;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      crowd.root.add(mesh);
    }
    crowd.root.add(flags(values));
    return crowd;
  }

  update(eye: THREE.Vector3): void {
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    eyeModel.value.copy(this.scratch.copy(eye).applyMatrix4(this.inverse));
  }
}
