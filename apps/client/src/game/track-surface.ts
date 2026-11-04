import * as THREE from "three/webgpu";
import {
  dFdx,
  dFdy,
  dot,
  faceDirection,
  float,
  floor,
  fract,
  fwidth,
  hash,
  max,
  mix,
  mx_noise_float,
  normalView,
  positionView,
  positionWorld,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
  vertexStage,
} from "three/tsl";

type FloatNode = THREE.Node<"float">;
type ColourNode = THREE.Node<"vec3">;

const asphaltTile = 2;
const patchCell = 46;
const patchShare = 0.4;
const patchTone = 0.82;
const patchSeam = 0.05;
const crackScale = vec2(0.21, 0.075);
const crackWidth = 0.018;
const crackDensity = 0.022;
const crackTone = 0.42;
const crackRoughness = 0.3;
const blotchScale = 0.045;
const blotchStrength = 0.11;
const mottleScale = 0.6;
const mottleStrength = 0.07;
const coarseScale = 0.27;
const coarseContrast = 0.35;
const kerbBlock = 0.5;
const kerbRed = vec3(0.5, 0.042, 0.03);
const kerbWhite = vec3(0.74, 0.74, 0.71);
const kerbGrain = 0.3;
const kerbRubber = 0.62;
const kerbSeam = 0.035;
const kerbGroove = 0.012;
const kerbWidth = 1.5;
const kerbTile = 5;
const kerbGrainScale = 0.9;
const kerbNose = 0.12;
const kerbLip = 0.1;
const kerbRise = 0.03;
const kerbGrooveDepth = 0.006;
const kerbGrainDepth = 0.0012;
const kerbPaintRoughness = 0.5;
const kerbRubberRoughness = 0.72;
const lushGreen = vec3(0.062, 0.15, 0.03);
const lushShare = 0.72;
const patchScale = 0.07;
const tuftScale = 1.3;
const tuftStrength = 0.12;
const dryShare = 0.45;
const dryTint = vec3(1.45, 1.05, 0.7);
const lushLuminance = 0.075;
const mowWidth = 4.5;
const mowStrength = 0.09;
const terrainMowAngle = 0.62;

function aa(edge: FloatNode, value: FloatNode): FloatNode {
  const width = fwidth(value).max(1e-4);
  return smoothstep(edge.sub(width), edge.add(width), value);
}

function boxDistance(
  lateral: FloatNode,
  along: FloatNode,
  centre: THREE.Node<"vec2">,
  half: THREE.Node<"vec2">,
): FloatNode {
  return max(
    lateral.sub(centre.x).abs().sub(half.x),
    along.sub(centre.y).abs().sub(half.y),
  );
}

function patches(lateral: FloatNode, along: FloatNode) {
  const cell = floor(along.div(patchCell));
  const roll = (salt: number) => hash(cell.add(salt));
  const present = float(1).sub(
    smoothstep(patchShare - 0.01, patchShare, roll(1.3)),
  );
  const length = mix(float(0.22), float(0.7), roll(2.9)).mul(patchCell);
  const start = roll(4.1).mul(float(patchCell).sub(length));
  const width = mix(float(3.2), float(9), roll(6.7));
  const offset = mix(float(-6), float(6), roll(8.3));
  const centre = vec2(
    offset,
    cell.mul(patchCell).add(start).add(length.mul(0.5)),
  );
  const distance = boxDistance(
    lateral,
    along,
    centre,
    vec2(width.mul(0.5), length.mul(0.5)),
  );
  const inside = float(1)
    .sub(aa(float(0), distance))
    .mul(present);
  const seam = float(1)
    .sub(smoothstep(0, patchSeam, distance.abs()))
    .mul(present);
  return { inside, seam };
}

function cracks(lateral: FloatNode, along: FloatNode) {
  const field = mx_noise_float(
    vec2(lateral.mul(crackScale.x), along.mul(crackScale.y)).add(2.7),
  );
  const width = fwidth(field).mul(1.2).add(crackWidth);
  const line = float(1).sub(smoothstep(width.mul(0.35), width, field.abs()));
  const where = smoothstep(
    0.05,
    0.25,
    vertexStage(
      mx_noise_float(vec2(lateral, along).mul(crackDensity).add(9.1)),
    ),
  );
  return line.mul(where);
}

export interface AsphaltDetail {
  tone: FloatNode;
  roughness: FloatNode;
}

export function screenBump(
  height: FloatNode,
  scale: number,
): THREE.Node<"vec3"> {
  const slopeX = dFdx(height).mul(scale);
  const slopeY = dFdy(height).mul(scale);
  const sigmaX = dFdx(positionView).normalize();
  const sigmaY = dFdy(positionView).normalize();
  const r1 = sigmaY.cross(normalView);
  const r2 = normalView.cross(sigmaX);
  const det = sigmaX.dot(r1).mul(faceDirection);
  const gradient = det.sign().mul(slopeX.mul(r1).add(slopeY.mul(r2)));
  return det.abs().mul(normalView).sub(gradient).normalize();
}

export function asphaltDetail(grain: THREE.Texture): AsphaltDetail {
  const lateral = uv().x.mul(asphaltTile);
  const along = uv().y.mul(asphaltTile);
  const world = positionWorld.xy;
  const blotch = vertexStage(
    mx_noise_float(world.mul(blotchScale).add(0.5)),
  ).mul(blotchStrength);
  const mottle = mx_noise_float(world.mul(mottleScale).add(3.3)).mul(
    mottleStrength,
  );
  const coarse = texture(grain, vec2(uv().y, uv().x.negate()).mul(coarseScale))
    .rgb.dot(vec3(1 / 3))
    .div(0.0152);
  const { inside, seam } = patches(lateral, along);
  const crack = cracks(lateral, along);
  const tone = float(1)
    .add(blotch)
    .add(mottle)
    .mul(mix(float(1), coarse, coarseContrast))
    .mul(mix(float(1), float(patchTone), inside))
    .mul(float(1).sub(seam.mul(0.35)))
    .mul(mix(float(1), float(crackTone), crack));
  return {
    tone,
    roughness: mix(float(1), float(crackRoughness / 0.8), crack),
  };
}

export function shadeKerb(
  material: THREE.MeshStandardNodeMaterial,
  grain: THREE.Texture,
): void {
  const across = uv().x;
  const along = uv().y;
  const phase = fract(along);
  const white = aa(float(kerbBlock), phase).mul(
    float(1).sub(aa(float(1 - 0.004), phase)),
  );
  const groove = float(1)
    .sub(smoothstep(0, kerbGroove, phase.sub(kerbBlock).abs()))
    .max(
      float(1).sub(smoothstep(0, kerbGroove, phase.min(float(1).sub(phase)))),
    );
  const concrete = texture(
    grain,
    uv().mul(vec2(kerbWidth, kerbTile)).mul(kerbGrainScale),
  )
    .rgb.dot(vec3(1 / 3))
    .div(0.0152);
  const speck = mix(float(1), concrete, kerbGrain);
  const streak = mx_noise_float(vec2(across.mul(9), along.mul(1.6)).add(4.4))
    .mul(0.5)
    .add(0.5);
  const ridden = float(1).sub(smoothstep(0.15, 0.75, across));
  const rubber = smoothstep(0.45, 0.85, streak.add(ridden.mul(0.35))).mul(
    ridden.mul(0.8).add(0.2),
  );
  const seam = float(1).sub(smoothstep(0, kerbSeam, across));
  const paint = mix(kerbRed, kerbWhite, white).mul(speck);
  const marked = mix(paint, paint.mul(1 - kerbRubber), rubber);
  material.colorNode = marked
    .mul(float(1).sub(seam.mul(0.55)))
    .mul(float(1).sub(groove.mul(0.4)));
  material.roughnessNode = mix(
    float(kerbPaintRoughness),
    float(kerbRubberRoughness),
    rubber,
  );
  const metres = across.mul(kerbWidth);
  const nose = smoothstep(0, kerbNose, metres).mul(kerbRise);
  const lip = smoothstep(kerbWidth - kerbLip, kerbWidth, metres).mul(
    kerbRise * 0.6,
  );
  const height = nose
    .sub(lip)
    .sub(groove.mul(kerbGrooveDepth))
    .add(concrete.mul(kerbGrainDepth));
  material.normalNode = screenBump(height, 1);
}

export function lushGrass(photo: ColourNode, share: FloatNode): ColourNode {
  const luminance = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  const lush = lushGreen.mul(luminance.div(lushLuminance).clamp(0.7, 1.35));
  const growing = smoothstep(0.004, 0.02, photo.g.sub(photo.b)).max(share);
  const patches = mx_noise_float(positionWorld.xy.mul(patchScale).add(7.7));
  const tufts = mx_noise_float(positionWorld.xy.mul(tuftScale).add(1.9));
  const dry = smoothstep(0.35, 0.8, patches).mul(dryShare);
  const tinted = mix(lush, lush.mul(dryTint), dry).mul(
    tufts.mul(tuftStrength).add(1),
  );
  return mix(photo, tinted, growing.mul(lushShare).max(share));
}

function stripes(coordinate: FloatNode): FloatNode {
  const band = fract(coordinate.div(mowWidth * 2));
  const edge = fwidth(coordinate.div(mowWidth * 2)).max(1e-4);
  const light = smoothstep(
    float(0.5).sub(edge),
    float(0.5).add(edge),
    band,
  ).sub(smoothstep(float(1).sub(edge), float(1), band));
  const fade = float(1).sub(smoothstep(0.08, 0.3, edge));
  return float(1).add(
    light
      .sub(0.5)
      .mul(mowStrength * 2)
      .mul(fade),
  );
}

export function mownAlong(lateral: FloatNode): FloatNode {
  return stripes(lateral);
}

export function mownWorld(): FloatNode {
  const across = positionWorld.x
    .mul(Math.cos(terrainMowAngle))
    .add(positionWorld.y.mul(Math.sin(terrainMowAngle)));
  return stripes(across);
}
