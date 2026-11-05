import * as THREE from "three/webgpu";
import {
  atan,
  attribute,
  dFdx,
  dFdy,
  float,
  Fn,
  fract,
  If,
  max,
  mix,
  positionGeometry,
  sign,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { type CarEnvironment, useEnvironment } from "./carpaint.ts";
import { carFile } from "./teams.ts";
import { releaseOnceUploaded } from "./preload.ts";
import { screenBump } from "./track-surface.ts";
import { compounds } from "./tyres.ts";

export const tyreAttribute = "tyre";
const wallFrom = 0.224;
const wallTo = 0.36;
const treadHalf = 0.21;
const blocks = 3;
const taps = 5;
const turn = Math.PI * 2;
const wallRubber = 0.018;
const treadRubber = 0.021;
const wornRubber = 0.032;
const pickupRubber = 0.011;
const paintGain = 0.82;
const whitePaint = 0.6;
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
const rimRadius = 0.2286;
const treadRadius = 0.354;
const maxSag = 0.085;
const sagEase = 0.006;
const bulge = 0.55;
const flatDepth = 0.007;
const flatShort = 0.045;
const flatLong = 0.115;
const treadDepth = 0.011;
const chunkDepth = 0.075;
const scuffedRubber = 0.11;
const lumpRubber = 0.02;
const flatSpotDull = 0.04;
const flatSpotBright = 0.1;
const flatGouge = 0.012;
const carcassDark = 0.03;
const carcassLight = 0.075;
const tornRoughness = 0.78;
const chunkTipRoughness = 0.42;
const grooveRubber = 0.006;
const grooveRoughness = 0.9;
const wetRings = [0.16, 0.36, 0.56, 0.76];
const ringHalf = 0.016;
const sipeDepth = 0.55;
const treadedRubber = 0.05;
const treadedRoughness = 0.66;
const treadedWetRoughness = 0.3;
const treadedWetDarken = 0;
const wetSheen = 2.2;
const grassDirt = new THREE.Color(0.036, 0.035, 0.027);
const grassBlade = new THREE.Color(0.038, 0.048, 0.026);
const gravelDust = new THREE.Color(0.19, 0.182, 0.17);
const gritSpeck = new THREE.Color(0.36, 0.345, 0.32);
const wetDarken = 0.4;
const wetRoughness = 0.22;

export interface TyreLook {
  compound: THREE.Color;
  pattern: number;
  blur: number;
  wear: number;
  flat: number;
  flatTurn: number;
  shred: number;
  sag: number;
  down: THREE.Vector2;
  dirt: number;
  gravel: number;
  wet: number;
}

export function tyreLook(): TyreLook {
  return {
    compound: new THREE.Color(compounds[1].colour),
    pattern: 0,
    blur: 0,
    wear: 0,
    flat: 0,
    flatTurn: 0,
    shred: 0,
    sag: 0,
    down: new THREE.Vector2(-1, 0),
    dirt: 0,
    gravel: 0,
    wet: 0,
  };
}

export function treadPattern(compound: number): number {
  return Math.max(0, compound - 2);
}

export function deflatedSag(leak: number): number {
  const deflated = THREE.MathUtils.clamp(leak, 0, 1);
  return maxSag * deflated * deflated;
}

export function spinBlur(radiansPerSecond: number, seconds: number): number {
  return Math.min(Math.abs(radiansPerSecond) * seconds * shutter, turn) / turn;
}

function tyreMap(name: string, anisotropy: number): THREE.Texture {
  const map = releaseOnceUploaded(
    new THREE.TextureLoader().load(carFile("shared", name)),
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
  const compound = uniform(new THREE.Vector4());
  const surface = uniform(new THREE.Vector4());
  const coat = uniform(new THREE.Vector4());
  const shape = uniform(new THREE.Vector4());
  compound.onObjectUpdate(({ object }) => {
    const look = lookOf(object);
    const { r, g, b } = look.compound;
    compound.value.set(r, g, b, detailed(look) ? 1 : 0);
  });
  surface.onObjectUpdate(({ object }) => {
    const look = lookOf(object);
    surface.value.set(look.wear, look.flat, look.flatTurn, look.shred);
  });
  coat.onObjectUpdate(({ object }) => {
    const look = lookOf(object);
    coat.value.set(look.dirt, look.gravel, look.wet, look.pattern);
  });
  shape.onObjectUpdate(({ object }) => {
    const look = lookOf(object);
    shape.value.set(look.sag, look.down.x, look.down.y, look.blur);
  });
  return { compound, surface, coat, shape };
}

function detailed(look: TyreLook): boolean {
  return (
    look.wear > 0.3 ||
    look.flat > 0 ||
    look.shred > 0 ||
    look.dirt > 0 ||
    look.pattern > 0
  );
}

type FloatNode = THREE.Node<"float">;
type Vec2Node = THREE.Node<"vec2">;
type Vec4Node = THREE.Node<"vec4">;

function fetchWhen(
  wanted: THREE.Node<"bool">,
  idle: Vec4Node,
  fetch: (...inputs: Vec2Node[]) => Vec4Node,
  ...inputs: Vec2Node[]
): Vec4Node {
  return Fn(() => {
    const result = idle.toVar();
    const held = inputs.map((input) => input.toVar());
    If(wanted, () => {
      result.assign(fetch(...held));
    });
    return result;
  })();
}

function wrapped(turns: FloatNode): FloatNode {
  return fract(turns.add(0.5)).sub(0.5);
}

function buildMaterial(
  map: THREE.Texture,
  condition: THREE.Texture,
): THREE.MeshPhysicalNodeMaterial {
  const material = new THREE.MeshPhysicalNodeMaterial({ name: "tyre" });
  const { compound, surface, coat, shape } = lookUniforms();
  const blur = shape.w;
  const wear = surface.x;
  const flat = surface.y;
  const shred = surface.w;
  const local = attribute<"vec4">(tyreAttribute, "vec4");
  const axial = local.x;
  const radial = vec2(local.y, local.z);
  const radius = radial.length();
  const across = axial.abs().div(local.w.max(1e-4));
  const facing = sign(axial).negate();
  const angle = atan(local.z, local.y).div(turn);
  const conditionV = axial.div(treadHalf * 4).add(0.25);
  const patternV = axial.div(local.w.max(1e-4)).mul(0.25).add(0.75);
  const flatSpan = mix(float(flatShort), float(flatLong), flat);
  const flatArc = (spread: FloatNode) =>
    wrapped(angle.sub(surface.z))
      .abs()
      .mul(turn * treadRadius)
      .sub(spread.mul(turn * treadRadius * 0.5))
      .max(0);
  const tearFrom = mix(float(0.78), float(0.42), shred.sqrt());
  const tearAt = (tear: FloatNode) =>
    smoothstep(tearFrom.sub(0.025), tearFrom.add(0.025), tear);

  const wallHeight = radius.sub(rimRadius).max(0);
  const wallShare = wallHeight.div(treadRadius - rimRadius).min(1);
  const down = vec2(shape.y, shape.z);
  const reach = radial
    .dot(down)
    .div(radius.max(1e-4))
    .mul(treadRadius)
    .sub(float(treadRadius).sub(shape.x))
    .max(0);
  const squeeze = reach.mul(reach).div(reach.add(sagEase));
  const vertexTear = smoothstep(
    tearFrom.sub(0.1),
    tearFrom.add(0.1),
    fetchWhen(
      shred.greaterThan(0),
      vec4(0),
      (at) => texture(condition, at).level(float(5)),
      vec2(angle, conditionV),
    ).a,
  ).mul(step(0.001, shred));
  const spot = float(1)
    .sub(smoothstep(flatSpan.mul(0.55), flatSpan, flatArc(float(0))))
    .mul(flat.mul(flatDepth));
  const tornDepth = shred.mul(shred).mul(chunkDepth).add(treadDepth);
  const sunk = squeeze
    .mul(wallShare)
    .add(spot.add(vertexTear.mul(tornDepth)).mul(wallShare.mul(wallShare)));
  const bulged = sign(axial).mul(
    squeeze.mul(bulge).mul(sin(wallShare.mul(Math.PI))),
  );
  const scale = radius.sub(sunk).div(radius.max(1e-4));
  material.positionNode = vec3(
    positionGeometry.x.add(bulged),
    positionGeometry.y.add(local.y.mul(scale.sub(1))),
    positionGeometry.z.add(local.z.mul(scale.sub(1))),
  );

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
  const aroundX = spin(dx).abs().max(blur);
  const aroundY = spin(dy);
  const tread = texture(map, vec2(angle, treadV)).grad(
    vec2(aroundX, dFdx(treadV)),
    vec2(aroundY, dFdy(treadV)),
  ).rgb;
  const detail = compound.w.greaterThan(0.5);
  const conditionAt = (at: Vec2Node, gx: Vec2Node, gy: Vec2Node) =>
    texture(condition, at).grad(gx, gy);
  const worn = fetchWhen(
    detail,
    vec4(0.5, 0.5, 0.5, 0),
    conditionAt,
    vec2(angle, conditionV),
    vec2(aroundX, dFdx(conditionV)),
    vec2(aroundY, dFdy(conditionV)),
  );
  const pattern = fetchWhen(
    detail,
    vec4(0, 0, 0, 0.5),
    conditionAt,
    vec2(angle, patternV),
    vec2(aroundX, dFdx(patternV)),
    vec2(aroundY, dFdy(patternV)),
  );
  const onTread = float(1).sub(smoothstep(0.86, 0.97, across));
  const onWall = float(1).sub(onTread);
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

  const scuff = smoothstep(0.68, 1, wear);
  const matte = smoothstep(0.3, 0.9, wear);
  const grained = smoothstep(0.3, 0.8, wear);
  const cover = smoothstep(
    float(0.9).sub(grained.mul(0.32)),
    float(1.1).sub(grained.mul(0.32)),
    worn.g,
  ).mul(grained);
  const ripple = worn.r.sub(0.5);
  const granular = smoothstep(0.55, 1, wear)
    .mul(smoothstep(0.55, 1, wear))
    .add(shred.mul(0.6))
    .min(1);
  const lumps = worn.b.sub(0.5);
  const marbles = smoothstep(0.85, 0.9, worn.b).mul(granular).mul(onTread);
  const cracks = pattern.b;
  const torn = tearAt(worn.a.add(worn.b.sub(0.5).mul(0.45)))
    .mul(step(0.001, shred))
    .mul(onTread.max(smoothstep(0.31, 0.34, radius)));
  const tearEdge = smoothstep(0.15, 0.5, torn).mul(
    float(1).sub(smoothstep(0.5, 0.9, torn)),
  );
  const flatSpread = blur.mul(2);
  const flatMask = float(1)
    .sub(smoothstep(flatSpan.mul(0.45), flatSpan, flatArc(flatSpread)))
    .mul(flatSpan.div(flatSpan.add(flatSpread.mul(turn * treadRadius))))
    .mul(float(1).sub(smoothstep(0.75, 0.95, across)))
    .mul(smoothstep(0, 0.6, flat))
    .mul(onTread);
  const flatRim = smoothstep(
    flatSpan.mul(0.55),
    flatSpan.mul(0.85),
    flatArc(flatSpread),
  )
    .mul(
      float(1).sub(
        smoothstep(flatSpan.mul(0.85), flatSpan.mul(1.1), flatArc(flatSpread)),
      ),
    )
    .mul(flatMask.max(smoothstep(0, 0.08, flat).mul(onTread).mul(0.5)));
  const ringEdge = dFdx(across).abs().add(dFdy(across).abs()).max(0.004);
  const rings = wetRings
    .map((ring) =>
      float(1).sub(
        smoothstep(
          ringEdge.negate().add(ringHalf),
          ringEdge.add(ringHalf),
          across.sub(ring).abs(),
        ),
      ),
    )
    .reduce((a, b) => a.max(b));
  const grooveDepth = pattern.r
    .mul(step(0.5, coat.w))
    .mul(step(coat.w, 1.5))
    .add(pattern.g.mul(sipeDepth).max(rings).mul(step(1.5, coat.w)))
    .mul(float(1).sub(wear.mul(0.75)))
    .mul(onTread)
    .mul(float(1).sub(torn));
  const dirtReach = mix(
    smoothstep(0.3, 0.35, radius).mul(0.55),
    float(1),
    onTread,
  );
  const dirtFrom = float(1.05).sub(coat.x.mul(0.6));
  const dirty = smoothstep(
    dirtFrom.sub(blur.mul(1.5)),
    dirtFrom.add(0.22).add(blur.mul(1.5)),
    worn.g.mul(0.5).add(pattern.a.mul(0.5)),
  )
    .mul(dirtReach)
    .mul(step(0.001, coat.x))
    .max(smoothstep(0.35, 1, coat.x).mul(coat.y).mul(dirtReach).mul(0.9))
    .mul(float(1).sub(grooveDepth.mul(0.8)));
  const wetness = smoothstep(0.02, 0.3, coat.z);
  const treaded = step(0.5, coat.w);

  const fresh = mix(
    mix(float(treadRubber), float(wornRubber), wear),
    float(treadedRubber),
    treaded,
  ).mul(grain.mul(0.12).add(1));
  const treadTone = mix(
    mix(fresh, float(scuffedRubber), scuff),
    float(lumpRubber),
    shred.mul(0.7),
  )
    .mul(lumps.mul(granular).mul(0.7).add(1))
    .mul(ripple.mul(cover).mul(-0.9).add(1));
  const spotTone = mix(
    mix(
      float(flatSpotDull),
      float(flatSpotBright),
      smoothstep(0.3, 0.7, tread.r),
    ),
    float(flatGouge),
    smoothstep(0.16, 0.3, lumps),
  );
  const rubber = mix(
    float(wallRubber).mul(float(1).add(scuff.mul(0.45))),
    mix(
      mix(mix(treadTone, float(lumpRubber), marbles), spotTone, flatMask),
      float(lumpRubber),
      flatRim.mul(0.7),
    ),
    onTread,
  );
  const grooved = mix(rubber, float(grooveRubber), grooveDepth);
  const base = vec3(mix(grooved, float(pickupRubber), pickup));
  const coloured = compound.xyz.mul(paintGain);
  const withCompound = mix(base, coloured, paint.r);
  const painted = mix(withCompound, vec3(whitePaint), paint.g);
  const carcass = mix(float(carcassDark), float(carcassLight), worn.b)
    .mul(float(1).sub(cracks.mul(0.8)))
    .mul(float(1).sub(tearEdge.mul(0.85)));
  const shredded = mix(
    painted,
    vec3(carcass, carcass.mul(0.97), carcass.mul(0.93)),
    torn,
  );
  const grass = mix(
    vec3(grassDirt.r, grassDirt.g, grassDirt.b),
    vec3(grassBlade.r, grassBlade.g, grassBlade.b),
    smoothstep(0.5, 0.8, worn.r).mul(0.7),
  );
  const soil = mix(
    grass,
    vec3(gravelDust.r, gravelDust.g, gravelDust.b),
    coat.y,
  ).mul(lumps.mul(mix(float(0.8), float(0.35), coat.y)).add(1));
  const speck = smoothstep(0.74, 0.86, pattern.a).mul(coat.y);
  const soiled = mix(
    shredded,
    mix(soil, vec3(gritSpeck.r, gritSpeck.g, gritSpeck.b), speck),
    dirty,
  );
  material.colorNode = soiled.mul(
    float(1).sub(
      wetness.mul(mix(float(wetDarken), float(treadedWetDarken), treaded)),
    ),
  );
  const isPainted = paint.r.max(paint.g);
  const rough = mix(
    float(wallRoughness).add(scuff.mul(0.12)),
    mix(float(treadRoughness), float(treadedRoughness), treaded)
      .add(matte.mul(0.16))
      .add(scuff.mul(0.2))
      .sub(ripple.mul(cover).mul(0.2))
      .sub(marbles.mul(0.2))
      .add(flatMask.mul(0.2)),
    onTread,
  );
  const wetRough = mix(
    float(wetRoughness),
    float(treadedWetRoughness),
    treaded.mul(onTread),
  );
  const dry = mix(
    mix(
      mix(
        mix(rough, float(paintRoughness), isPainted),
        float(pickupRoughness),
        pickup,
      ),
      mix(
        float(tornRoughness),
        float(chunkTipRoughness),
        smoothstep(0.08, 0.2, lumps),
      ),
      torn,
    ),
    float(0.96),
    dirty,
  );
  material.roughnessNode = mix(
    mix(dry, wetRough, wetness.mul(0.7)),
    float(grooveRoughness),
    grooveDepth,
  );
  material.metalnessNode = float(0);
  material.specularIntensityNode = float(1)
    .sub(torn.mul(float(0.55).add(smoothstep(0.1, 0.5, cracks).mul(0.4))))
    .sub(dirty.mul(0.4))
    .mul(wetness.mul(wetSheen).mul(float(1).sub(grooveDepth)).add(1));
  const relief = paint.b
    .add(pickup.mul(0.25))
    .add(ripple.mul(cover).mul(2.2))
    .add(lumps.mul(granular).mul(1.3))
    .add(marbles.mul(1.6))
    .add(tread.r.sub(0.5).mul(flatMask).mul(3))
    .sub(smoothstep(0.16, 0.3, lumps).mul(flatMask).mul(1.5))
    .sub(grooveDepth.mul(2.2))
    .sub(torn.mul(1.2))
    .add(tearEdge.mul(0.8))
    .add(lumps.mul(torn).mul(14))
    .sub(cracks.mul(torn).mul(5))
    .add(max(pattern.a.sub(0.5), 0).mul(dirty).mul(1.2));
  material.normalNode = screenBump(relief, reliefStrength);
  return material;
}

const shared = new WeakMap<CarEnvironment, THREE.Material>();

export function tyreMaterial(
  env: CarEnvironment,
  anisotropy: number,
): THREE.Material {
  const known = shared.get(env);
  if (known) return known;
  const material = buildMaterial(
    tyreMap("tyre.png", anisotropy),
    tyreMap("tyre-condition.png", anisotropy),
  );
  useEnvironment(material, env, reflection);
  shared.set(env, material);
  return material;
}
