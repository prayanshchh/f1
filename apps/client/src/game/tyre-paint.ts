import * as THREE from "three/webgpu";
import {
  atan,
  attribute,
  dFdx,
  dFdy,
  float,
  fract,
  fwidth,
  mix,
  sign,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { type CarEnvironment, useEnvironment } from "./carpaint.ts";
import { carFile } from "./teams.ts";
import { releaseOnceUploaded } from "./preload.ts";
import { screenBump } from "./track-surface.ts";
import { compounds } from "./tyres.ts";

type FloatNode = THREE.Node<"float">;

export const tyreAttribute = "tyre";
export const wallFrom = 0.224;
export const wallTo = 0.36;
const treadHalf = 0.21;
const blocks = 3;
const taps = 5;
const turn = Math.PI * 2;
export const wallRubber = 0.018;
const treadRubber = 0.021;
const wornRubber = 0.032;
const pickupRubber = 0.011;
export const paintGain = 0.82;
export const whitePaint = 0.6;
const wallRoughness = 0.5;
const paintRoughness = 0.4;
const treadRoughness = 0.52;
const pickupRoughness = 0.92;
const reliefStrength = 0.022;
const averagedFrom = 0.12;
const averagedTo = 0.35;
const shutter = 0.5;
const cleanPickup = 0.4;
const reflection = 0.5;
const interSipes = 30;
const wetSipes = 38;
const interSlant = 1.4;
const wetSlant = 0.9;
const interSipeWidth = 0.16;
const wetSipeWidth = 0.22;
const ringWidth = 0.025;
const grooveShade = 0.45;
const grooveDepth = 0.6;
const wetRoughness = 0.45;
const wetCoat = 0.3;
const wetCoatRoughness = 0.5;

export interface TyreLook {
  compound: THREE.Color;
  blur: number;
  wear: number;
  tread: number;
}

export const tyreWetness = uniform(0);

export function tyreLook(): TyreLook {
  return {
    compound: new THREE.Color(compounds[1].colour),
    blur: 0,
    wear: 0,
    tread: 0,
  };
}

export function treadOf(compound: number): number {
  const id = compounds[compound]?.id;
  if (id === "wet") return 2;
  return id === "inter" ? 1 : 0;
}

function band(phase: THREE.Node<"float">, width: number, smear: FloatNode) {
  const centre = fract(phase).sub(0.5).abs();
  const edge = fwidth(phase).add(smear).max(1e-4);
  const sharp = smoothstep(
    float(width / 2).add(edge),
    float(width / 2).sub(edge),
    centre,
  );
  return mix(sharp, float(width), smoothstep(0.2, 0.6, edge));
}

function grooves(
  angle: FloatNode,
  across: FloatNode,
  tread: FloatNode,
  blur: FloatNode,
): FloatNode {
  const wet = step(1.5, tread);
  const inter = step(0.5, tread).mul(float(1).sub(wet));
  const sipePitch = mix(float(interSipes), float(wetSipes), wet);
  const sipeSlant = mix(float(interSlant), float(wetSlant), wet);
  const phase = angle.mul(sipePitch).add(across.mul(sipeSlant));
  const smear = blur.mul(sipePitch);
  const sipe = mix(
    band(phase, interSipeWidth, smear),
    band(phase, wetSipeWidth, smear),
    wet,
  );
  const inside = smoothstep(
    mix(float(0.26), float(0.1), wet),
    mix(float(0.34), float(0.16), wet),
    across,
  ).mul(
    smoothstep(
      mix(float(0.8), float(0.9), wet),
      mix(float(0.72), float(0.84), wet),
      across,
    ),
  );
  const ring = (centre: number) =>
    smoothstep(
      float(ringWidth).add(fwidth(across)),
      float(ringWidth).sub(fwidth(across)).max(0),
      across.sub(centre).abs(),
    );
  const rings = ring(0.37).max(ring(0.7)).mul(wet);
  return sipe.mul(inside).max(rings).mul(wet.add(inter));
}

export function spinBlur(radiansPerSecond: number, seconds: number): number {
  return Math.min(Math.abs(radiansPerSecond) * seconds * shutter, turn) / turn;
}

function tyreMap(anisotropy: number): THREE.Texture {
  const map = releaseOnceUploaded(
    new THREE.TextureLoader().load(carFile("shared", "tyre.png")),
  );
  map.flipY = false;
  map.colorSpace = THREE.NoColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = anisotropy;
  return map;
}

const origin = new THREE.Vector3();

function groupOf(x: number, z: number, midZ: number, split: boolean): number {
  if (!split) return 0;
  return (x > 0 ? 0 : 1) + (z > midZ ? 0 : 2);
}

export function markTyres(geometry: THREE.BufferGeometry, split: boolean) {
  const position = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const midZ = (box.min.z + box.max.z) / 2;
  const boxes = Array.from({ length: 4 }, () => new THREE.Box3());
  const point = new THREE.Vector3();
  const groups = new Uint8Array(position.count);
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    const group = groupOf(point.x, point.z, midZ, split);
    groups[i] = group;
    boxes[group]?.expandByPoint(point);
  }
  const centres = boxes.map((b) => b.getCenter(new THREE.Vector3()));
  const halves = boxes.map((b) => (b.max.x - b.min.x) / 2);
  const local = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const group = groups[i] ?? 0;
    const centre = centres[group] ?? origin;
    local[i * 4] = position.getX(i) - centre.x;
    local[i * 4 + 1] = position.getY(i) - centre.y;
    local[i * 4 + 2] = position.getZ(i) - centre.z;
    local[i * 4 + 3] = halves[group] ?? 0;
  }
  geometry.setAttribute(tyreAttribute, new THREE.BufferAttribute(local, 4));
}

function lookUniforms() {
  const fallback = tyreLook();
  const lookOf = (object: THREE.Object3D | null | undefined) =>
    (object?.userData as { tyre?: TyreLook } | undefined)?.tyre ?? fallback;
  const compound = uniform(new THREE.Color());
  compound.onObjectUpdate(({ object }) => {
    compound.value.copy(lookOf(object).compound);
  });
  const blur = uniform(0);
  blur.onObjectUpdate(({ object }) => {
    blur.value = lookOf(object).blur;
  });
  const wear = uniform(0);
  wear.onObjectUpdate(({ object }) => {
    wear.value = lookOf(object).wear;
  });
  const pattern = uniform(0);
  pattern.onObjectUpdate(({ object }) => {
    pattern.value = lookOf(object).tread;
  });
  return { compound, blur, wear, pattern };
}

function buildMaterial(map: THREE.Texture): THREE.MeshPhysicalNodeMaterial {
  const material = new THREE.MeshPhysicalNodeMaterial({ name: "tyre" });
  const { compound, blur, wear, pattern } = lookUniforms();
  const local = attribute<"vec4">(tyreAttribute, "vec4");
  const axial = local.x;
  const radial = vec2(local.y, local.z);
  const radius = radial.length();
  const across = axial.abs().div(local.w.max(1e-4));
  const facing = sign(axial).negate();
  const angle = atan(local.z, local.y).div(turn);
  const spin = (d: THREE.Node<"vec2">) =>
    local.y
      .mul(d.y)
      .sub(local.z.mul(d.x))
      .div(radius.mul(radius).max(1e-6))
      .div(turn);
  const dx = dFdx(radial);
  const dy = dFdy(radial);
  const wallV = radius.sub(wallFrom).div((wallTo - wallFrom) * blocks);
  const treadV = axial
    .add(treadHalf)
    .div(treadHalf * 2 * blocks)
    .add(1 / blocks);
  const sampled = (
    u: THREE.Node<"float">,
    v: THREE.Node<"float">,
    face: THREE.Node<"float">,
    dv: [THREE.Node<"float">, THREE.Node<"float">],
  ): THREE.Node<"vec3"> => {
    const spacing = blur.div(taps - 1);
    const gx = vec2(spin(dx).mul(face).abs().max(spacing), dv[0]);
    const gy = vec2(spin(dy).mul(face), dv[1]);
    let sum: THREE.Node<"vec3"> = vec3(0);
    for (let k = 0; k < taps; k++) {
      const offset = blur.mul(k / (taps - 1) - 0.5);
      sum = sum.add(texture(map, vec2(u.add(offset), v)).grad(gx, gy).rgb);
    }
    return sum.div(taps);
  };
  const wallU = angle.mul(facing);
  const wallSharp = sampled(wallU, wallV, facing, [dFdx(wallV), dFdy(wallV)]);
  const wallAverage = texture(map, vec2(wallU, wallV.add(2 / blocks))).grad(
    vec2(0, dFdx(wallV)),
    vec2(0, dFdy(wallV)),
  ).rgb;
  const wall = mix(
    wallSharp,
    wallAverage,
    smoothstep(averagedFrom, averagedTo, blur),
  );
  const tread = texture(map, vec2(angle, treadV)).grad(
    vec2(spin(dx).abs().max(blur), dFdx(treadV)),
    vec2(spin(dy), dFdy(treadV)),
  ).rgb;
  const onTread = float(1).sub(smoothstep(0.86, 0.97, across));
  const onWall = float(1).sub(onTread);
  const groove = grooves(angle, across, pattern, blur).mul(onTread);
  const paint = vec3(
    wall.r.mul(onWall),
    wall.g.mul(onWall),
    mix(wall.b, tread.b, onTread),
  );
  const grain = tread.r.sub(0.5).mul(2);
  const blobs = tread.g.sub(0.5).mul(2);
  const pickup = smoothstep(
    0.35,
    0.75,
    blobs.add(smoothstep(0.62, 0.9, across).mul(0.6)).sub(0.45),
  )
    .mul(smoothstep(0.55, 0.85, across))
    .mul(onTread)
    .mul(mix(float(cleanPickup), float(1), wear));
  const scrubbed = mix(float(treadRubber), float(wornRubber), wear).mul(
    grain.mul(0.12).add(1),
  );
  const rubber = mix(float(wallRubber), scrubbed, onTread);
  const base = vec3(
    mix(rubber, float(pickupRubber), pickup).mul(
      float(1).sub(groove.mul(1 - grooveShade)),
    ),
  );
  const coloured = compound.mul(paintGain);
  const withCompound = mix(base, coloured, paint.r);
  material.colorNode = mix(withCompound, vec3(whitePaint), paint.g);
  const painted = paint.r.max(paint.g);
  const surface = mix(
    float(wallRoughness),
    float(treadRoughness).add(wear.mul(0.12)),
    onTread,
  );
  const dryRoughness = mix(
    mix(surface, float(paintRoughness), painted),
    float(pickupRoughness),
    pickup,
  );
  material.roughnessNode = mix(
    dryRoughness,
    dryRoughness.min(wetRoughness),
    tyreWetness,
  );
  material.metalnessNode = float(0);
  material.clearcoatNode = tyreWetness
    .mul(wetCoat)
    .mul(float(1).sub(groove.mul(0.6)));
  material.clearcoatRoughnessNode = float(wetCoatRoughness);
  material.normalNode = screenBump(
    paint.b.add(pickup.mul(0.25)).sub(groove.mul(grooveDepth)),
    reliefStrength,
  );
  return material;
}

const shared = new WeakMap<CarEnvironment, THREE.Material>();

export function tyreMaterial(
  env: CarEnvironment,
  anisotropy: number,
): THREE.Material {
  const known = shared.get(env);
  if (known) return known;
  const material = buildMaterial(tyreMap(anisotropy));
  useEnvironment(material, env, reflection);
  shared.set(env, material);
  return material;
}
