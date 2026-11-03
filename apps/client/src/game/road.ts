import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  dot,
  exp,
  float,
  materialEmissive,
  materialRoughness,
  mix,
  mx_noise_float,
  normalView,
  positionViewDirection,
  positionWorld,
  reflectVector,
  renderGroup,
  smoothstep,
  step,
  materialColor,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CSMShadowNode } from "three/examples/jsm/csm/CSMShadowNode.js";
import { SkyLitMaterial } from "./sky-ambient.ts";
import type { SkyState } from "./sky.ts";
import apronAUrl from "../../../../content/tracks/hill-country/textures/baked/apron_a.png?url";
import apronBUrl from "../../../../content/tracks/hill-country/textures/baked/apron_b.png?url";
import streaksUrl from "../../../../content/tracks/hill-country/textures/baked/asphalt_streaks.png?url";
import terrainUrl from "../../../../content/tracks/hill-country/textures/baked/terrain_albedo.jpg?url";
import grainUrl from "../../../../content/tracks/hill-country/textures/source/asphalt_track_base_color.jpg?url";
import { frustumContains } from "./world-culler.ts";
import { releaseOnceUploaded } from "./preload.ts";

const asphaltDark = 0.115;
const asphaltLight = 0.155;
const asphaltMean = 0.0152;
const asphaltContrast = 0.55;
const asphaltTint = vec3(1.0, 0.985, 0.965);
const streakStrength = 0.2;
const streakAcross = 1 / 7;
const streakAlong = 1 / 24;
const apronShade = 0.5;
const grassMean = 0.315;
const grassDetail = 0.5;
const terrainGain = 0.62;
const maskEdge = 0.07;
const paintGrain = 0.24;
const paintRed = vec3(0.44, 0.052, 0.042);
const paintTeal = vec3(0.075, 0.3, 0.15);
const paintBlue = vec3(0.035, 0.06, 0.26);
const paintWhite = vec3(0.72, 0.72, 0.68);
const concreteColor = vec3(0.3, 0.295, 0.275);
const runoffAsphalt = vec3(0.14, 0.135, 0.13);
const paintRoughness = 0.62;
const grassRoughness = 0.95;
const startLampRows = 2;
const startLampRed = vec3(6, 0.15, 0.05);
const rubberWidth = 1.3;
const lineHalfWidth = 1.0;
const lineBlend = 1.2;
const wetFrom = 0.015;
const wetFull = 0.28;
const wetDarkening = 0.5;
const wetRoughness = 0.55;
const puddleScale = 0.055;
const puddleFrom = 0.38;
const puddleDarkening = 0.55;
const puddleRoughness = 0.06;
const reflectionWet = 0.09;
const reflectionPuddle = 0.38;
const fresnelBase = 0.04;
const kerbWetDarkening = 0.3;
const grassWetDarkening = 0.2;
const rubberDarkening = 0.42;
const rubberSmoothing = 0.3;
const shadowMapSize = 2048;
const shadowDistance = 4000;
const shadowSoftness = 1.5;
const cascadeEnds = [24, 90, 340, 1600];
const cascadePeriods = [1, 2, 4, 8];
const cascadePixels = [4096, 4096, 2048, 2048];
const casterMargin = 6;
export const shadowOnlyLayer = 1;
export const alphaTestedOrder = 1;
const shadowMask = (1 << 0) | (1 << shadowOnlyLayer);
const bodyContact = { x: 0.07, hx: 2.3, hy: 0.72, reach: 0.75, strength: 0.62 };
const tyreContacts = [
  [1.49, -0.74, 0.2, 0.15],
  [1.49, 0.74, 0.2, 0.15],
  [-2.01, -0.74, 0.22, 0.2],
  [-2.01, 0.74, 0.22, 0.2],
] as const;
const tyreSizes = [
  [0.36, 0.155],
  [0.36, 0.155],
  [0.366, 0.205],
  [0.366, 0.205],
] as const;
const tyreShadowSoftness = 0.03;
const tyreReach = 0.26;
const tyreStrength = 0.88;
const contactRange = 6;
const tyreHubMargin = 0.5;
const groundMaterials =
  /(asphalt|road paint|road kerb|road grass|pit strip|pit red)$/;
const skyReflecting =
  /(road asphalt|pit asphalt|apron asphalt|road paint|road kerb|pit strip|pit red|track marks|glass)$/;
const blendedMaterials = new Set(["track track marks"]);
const alphaCutoffs: Record<string, number> = {
  "track debris fence": 0.5,
  "track pit decals": 0.35,
};
const shadowCasters =
  /^(wall|fence_steel|stand_seats|stand_concrete|roofs|rooftops|columns|tower_plates|tower_core|veil|gantry|light_panel|paddock|billboard|prop)/;
const depthOffsets: Record<string, number> = {
  "track road paint": -1,
  "track road kerb": -1,
  "track pit decals": -2,
  "track track marks": -1.5,
  "track road grass": 1,
  "track pit asphalt": 0.5,
  "track apron asphalt": 0.25,
  "track pit strip": -1,
  "track pit red": -1,
  "track terrain": 2,
};

function sharpen(map: THREE.Texture | null, anisotropy: number): void {
  if (!map) return;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;
}

const contactCentre = uniform(new THREE.Vector2()).setGroup(renderGroup);
const contactForward = uniform(new THREE.Vector2(1, 0)).setGroup(renderGroup);

export function setCarContact(x: number, y: number, fx: number, fy: number) {
  contactCentre.value.set(x, y);
  contactForward.value.set(fx, fy);
}

const contactShade = Fn(() => {
  const offset = positionWorld.xy.sub(contactCentre);
  const result = float(1).toVar();
  If(offset.dot(offset).lessThan(contactRange * contactRange), () => {
    const along = offset.dot(contactForward);
    const across = offset.y
      .mul(contactForward.x)
      .sub(offset.x.mul(contactForward.y));
    const box = (x: number, y: number, hx: number, hy: number) => {
      const dx = along.sub(x).abs().sub(hx).max(0);
      const dy = across.sub(y).abs().sub(hy).max(0);
      return dx.mul(dx).add(dy.mul(dy)).sqrt();
    };
    const fade = (distance: ReturnType<typeof box>, reach: number) =>
      float(1).sub(smoothstep(0, reach, distance));
    let shade = float(1).sub(
      fade(
        box(bodyContact.x, 0, bodyContact.hx, bodyContact.hy),
        bodyContact.reach,
      ).mul(bodyContact.strength),
    );
    for (const [x, y, hx, hy] of tyreContacts)
      shade = shade.mul(
        float(1).sub(fade(box(x, y, hx, hy), tyreReach).mul(tyreStrength)),
      );
    result.assign(shade);
  });
  return result;
});

const sunDirection = uniform(new THREE.Vector3(0, 0, 1)).setGroup(renderGroup);
const tyresPresent = uniform(0).setGroup(renderGroup);
const tyres = tyreSizes.map(() => ({
  centre: uniform(new THREE.Vector3()).setGroup(renderGroup),
  axis: uniform(new THREE.Vector3(0, 1, 0)).setGroup(renderGroup),
}));
const tyreHub = uniform(new THREE.Vector3()).setGroup(renderGroup);
const tyreHubReach = uniform(0).setGroup(renderGroup);
const hubPoint = new THREE.Vector3();

export function setTyreShadows(
  present: boolean,
  wheels: { centre: THREE.Vector3; axis: THREE.Vector3 }[],
): void {
  tyresPresent.value = present ? 1 : 0;
  hubPoint.set(0, 0, 0);
  wheels.forEach((wheel, i) => {
    tyres[i]?.centre.value.copy(wheel.centre);
    tyres[i]?.axis.value.copy(wheel.axis);
    hubPoint.add(wheel.centre);
  });
  hubPoint.divideScalar(wheels.length);
  tyreHub.value.copy(hubPoint);
  let reach = 0;
  wheels.forEach((wheel, i) => {
    const [radius, halfWidth] = tyreSizes[i] ?? [0, 0];
    reach = Math.max(
      reach,
      wheel.centre.distanceTo(hubPoint) + Math.hypot(radius, halfWidth),
    );
  });
  tyreHubReach.value = reach * reach + tyreHubMargin;
}

const tyreSunlight = Fn(() => {
  const fromHub = positionWorld.sub(tyreHub);
  const towardSun = fromHub.dot(sunDirection);
  const result = float(1).toVar();
  If(
    fromHub.dot(fromHub).sub(towardSun.mul(towardSun)).lessThan(tyreHubReach),
    () => {
      const open = tyres.map((tyre, i) => {
        const [radius, halfWidth] = tyreSizes[i] ?? [0, 0];
        const offset = positionWorld.sub(tyre.centre);
        const across = offset.dot(tyre.axis);
        const sunAcross = sunDirection.dot(tyre.axis);
        const radial = offset.sub(tyre.axis.mul(across));
        const sunRadial = sunDirection.sub(tyre.axis.mul(sunAcross));
        const a = sunRadial.dot(sunRadial).max(1e-4);
        const b = radial.dot(sunRadial);
        const c = radial.dot(radial).sub(radius * radius);
        const root = b.mul(b).sub(a.mul(c)).max(0).sqrt();
        const safeAcross = sunAcross
          .abs()
          .max(1e-4)
          .mul(step(0, sunAcross).mul(2).sub(1));
        const enter = float(-halfWidth).sub(across).div(safeAcross);
        const leave = float(halfWidth).sub(across).div(safeAcross);
        const from = b.negate().sub(root).div(a).max(enter.min(leave)).max(0);
        const to = b.negate().add(root).div(a).min(enter.max(leave));
        const blocked = smoothstep(0, tyreShadowSoftness, to.sub(from));
        return float(1).sub(blocked.mul(tyresPresent));
      });
      result.assign(open.reduce((all, one) => all.mul(one)));
    },
  );
  return result;
});

const withTyreSunlight = ((shadow: ReturnType<typeof tyreSunlight>) =>
  shadow.mul(tyreSunlight())) as unknown as () => THREE.Node;

const wetLine = uniform(0).setGroup(renderGroup);
const wetOff = uniform(0).setGroup(renderGroup);

export function setWetness(line: number, off: number): void {
  wetLine.value = line;
  wetOff.value = off;
}

export type SkyRadiance = (direction: THREE.Node<"vec3">) => THREE.Node<"vec3">;

function emissiveOf(material: THREE.MeshStandardNodeMaterial) {
  return (material.emissiveNode ?? materialEmissive) as THREE.Node<"vec3">;
}

function wetOf(water: THREE.Node<"float">) {
  return smoothstep(wetFrom, wetFull, water);
}

function lineWater() {
  const offset = uv(1).x.abs();
  const share = float(lineHalfWidth + lineBlend)
    .sub(offset)
    .div(lineBlend)
    .clamp(0, 1);
  return mix(wetOff, wetLine, share);
}

function puddles(water: THREE.Node<"float">) {
  const noise = mx_noise_float(vec3(positionWorld.xy.mul(puddleScale), 0.0));
  const depth = water.sub(puddleFrom).mul(2.2);
  return smoothstep(0.15, 0.45, noise.mul(0.5).add(depth));
}

function skyGlint(sky: SkyRadiance | null, strength: THREE.Node<"float">) {
  if (!sky) return vec3(0);
  const facing = dot(normalView, positionViewDirection).abs().oneMinus();
  const fresnel = float(fresnelBase).add(
    float(1 - fresnelBase).mul(facing.pow(5)),
  );
  return sky(reflectVector).mul(fresnel).mul(strength);
}

function wetAsphalt(
  material: THREE.MeshStandardNodeMaterial,
  water: () => THREE.Node<"float">,
  sky: SkyRadiance | null,
  pooled: boolean,
): void {
  const wet = () => wetOf(water());
  const pool = () => (pooled ? puddles(water()) : float(0));
  const shade = mix(float(1), float(1 - wetDarkening), wet()).mul(
    mix(float(1), float(1 - puddleDarkening), pool()),
  );
  material.colorNode = (material.colorNode ?? materialColor).mul(shade);
  const rough = material.roughnessNode ?? materialRoughness;
  material.roughnessNode = mix(
    mix(rough as ReturnType<typeof float>, float(wetRoughness), wet()),
    float(puddleRoughness),
    pool(),
  );
  const glint = skyGlint(
    sky,
    wet()
      .mul(reflectionWet)
      .add(pool().mul(reflectionPuddle - reflectionWet)),
  );
  material.emissiveNode = emissiveOf(material).add(glint);
}

function wetPaint(
  material: THREE.MeshStandardNodeMaterial,
  sky: SkyRadiance | null,
): void {
  const wet = wetOf(wetOff);
  material.colorNode = (material.colorNode ?? materialColor).mul(
    mix(float(1), float(1 - kerbWetDarkening), wet),
  );
  const rough = material.roughnessNode ?? materialRoughness;
  material.roughnessNode = mix(
    rough as ReturnType<typeof float>,
    float(wetRoughness),
    wet,
  );
  material.emissiveNode = emissiveOf(material).add(
    skyGlint(sky, wet.mul(reflectionWet * 0.7)),
  );
}

function wetGrass(material: THREE.MeshStandardNodeMaterial): void {
  material.colorNode = (material.colorNode ?? materialColor).mul(
    mix(float(1), float(1 - grassWetDarkening), wetOf(wetOff)),
  );
}

function applyWetness(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
  sky: SkyRadiance | null,
): void {
  const name = source.name;
  if (name.endsWith("road asphalt")) wetAsphalt(material, lineWater, sky, true);
  else if (name.endsWith("asphalt"))
    wetAsphalt(material, () => wetOff, sky, !name.includes("pit"));
  else if (/(road paint|road kerb|pit strip|pit red)$/.test(name))
    wetPaint(material, sky);
  else if (/(road grass|terrain)$/.test(name)) wetGrass(material);
}

export interface BakedGround {
  apronA: THREE.Texture;
  apronB: THREE.Texture;
  streaks: THREE.Texture;
  terrain: THREE.Texture;
  grain: THREE.Texture;
}

function rubber() {
  const line = uv(1);
  return exp(line.x.div(rubberWidth).pow(2).negate()).mul(line.y);
}

function asphaltGrain(source: THREE.MeshStandardMaterial) {
  const grain = texture(source.map as THREE.Texture, uv())
    .rgb.dot(vec3(1 / 3))
    .div(asphaltMean);
  return mix(float(1), grain, asphaltContrast);
}

function shadeRoad(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
  baked: BakedGround,
): void {
  if (!source.map) return;
  const photo = texture(baked.apronB, uv(2)).b;
  const streak = texture(
    baked.streaks,
    vec2(uv().x.mul(streakAcross), uv().y.mul(streakAlong)),
  ).r;
  const tone = mix(
    float(asphaltDark),
    float(asphaltLight),
    smoothstep(0.08, 0.42, photo),
  );
  const band = rubber();
  material.colorNode = asphaltGrain(source)
    .mul(tone)
    .mul(asphaltTint)
    .mul(float(1).add(streak.sub(0.5).mul(streakStrength)))
    .mul(float(1).sub(band.mul(rubberDarkening)));
  if (source.roughnessMap)
    material.roughnessNode = texture(source.roughnessMap, uv()).g.mul(
      float(1).sub(band.mul(rubberSmoothing)),
    );
}

function shadePaved(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
): void {
  if (!source.map) return;
  const shade = source.name.includes("apron") ? apronShade : 1;
  material.colorNode = asphaltGrain(source)
    .mul(float(asphaltLight * shade))
    .mul(asphaltTint);
  if (source.roughnessMap)
    material.roughnessNode = texture(source.roughnessMap, uv()).g;
}

function grassDetailFrom(source: THREE.MeshStandardMaterial) {
  const detail = texture(source.map as THREE.Texture, uv())
    .rgb.dot(vec3(1 / 3))
    .div(grassMean);
  return mix(float(1), detail, grassDetail);
}

function crisp(mask: THREE.Node) {
  return smoothstep(
    float(0.5 - maskEdge),
    float(0.5 + maskEdge),
    mask as ReturnType<typeof float>,
  );
}

function shadeApron(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
  baked: BakedGround,
): void {
  if (!source.map) return;
  const a = texture(baked.apronA, uv(1));
  const b = texture(baked.apronB, uv(1));
  const detail = grassDetailFrom(source);
  const concrete = crisp(b.r);
  const paved = crisp(b.g);
  const teal = crisp(a.g);
  const blue = crisp(a.b);
  const red = crisp(a.r);
  const white = crisp(a.a);
  const grass = texture(baked.terrain, uv(2)).rgb.mul(terrainGain).mul(detail);
  const hard = mix(
    float(1),
    texture(baked.grain, uv())
      .rgb.dot(vec3(1 / 3))
      .div(asphaltMean),
    paintGrain,
  );
  let color = mix(grass, concreteColor.mul(hard), concrete);
  color = mix(color, runoffAsphalt.mul(hard), paved);
  color = mix(color, paintTeal.mul(hard), teal);
  color = mix(color, paintBlue.mul(hard), blue);
  color = mix(color, paintRed.mul(hard), red);
  color = mix(color, paintWhite.mul(hard), white);
  material.colorNode = color;
  const sealed = concrete.max(paved).max(teal).max(blue).max(red).max(white);
  material.roughnessNode = mix(
    float(grassRoughness),
    float(paintRoughness),
    sealed,
  );
}

function shadeTerrain(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
  baked: BakedGround,
): void {
  if (!source.map) return;
  material.colorNode = texture(baked.terrain, uv(1))
    .rgb.mul(terrainGain)
    .mul(grassDetailFrom(source));
  material.roughnessNode = float(grassRoughness);
}

function shadeAsphaltSurface(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
  baked: BakedGround | null,
): void {
  if (baked && source.name.includes("road")) shadeRoad(material, source, baked);
  else shadePaved(material, source);
}

const shadersBySuffix: {
  suffix: string;
  shade: (
    material: THREE.MeshStandardNodeMaterial,
    source: THREE.MeshStandardMaterial,
    baked: BakedGround | null,
  ) => void;
}[] = [
  { suffix: "asphalt", shade: shadeAsphaltSurface },
  {
    suffix: "road grass",
    shade: (material, source, baked) => {
      if (baked) shadeApron(material, source, baked);
    },
  },
  {
    suffix: "terrain",
    shade: (material, source, baked) => {
      if (baked) shadeTerrain(material, source, baked);
    },
  },
  {
    suffix: "horizon",
    shade: (material) => {
      material.roughnessNode = float(1);
    },
  },
];

function applyShading(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
  baked: BakedGround | null,
  sky: SkyRadiance | null,
): void {
  shadersBySuffix
    .find(({ suffix }) => source.name.endsWith(suffix))
    ?.shade(material, source, baked);
  if (baked) applyWetness(material, source, sky);
  if (groundMaterials.test(source.name)) {
    material.colorNode = (material.colorNode ?? materialColor).mul(
      contactShade(),
    );
    material.receivedShadowNode = withTyreSunlight;
  }
}

export function surface(
  source: THREE.MeshStandardMaterial,
  anisotropy: number,
  baked: BakedGround | null = null,
  sky: SkyRadiance | null = null,
): THREE.MeshStandardNodeMaterial {
  if (source.name === "track start lamps") return startLampMaterial();
  const offset = depthOffsets[source.name] ?? 0;
  const Material = skyReflecting.test(source.name)
    ? THREE.MeshStandardNodeMaterial
    : SkyLitMaterial;
  const material = new Material({
    name: source.name,
    map: source.map,
    normalMap: source.normalMap,
    roughnessMap: source.roughnessMap,
    roughness: source.roughness,
    metalness: source.metalness,
    color: source.color,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    emissiveIntensity: source.emissiveIntensity,
    side: THREE.DoubleSide,
    alphaTest: alphaCutoffs[source.name] ?? 0,
    alphaToCoverage: source.name.endsWith("fence"),
    transparent: blendedMaterials.has(source.name),
    depthWrite: !blendedMaterials.has(source.name),
    polygonOffset: offset !== 0,
    polygonOffsetFactor: -offset,
    polygonOffsetUnits: -offset * 4,
  });
  for (const map of [source.map, source.normalMap, source.roughnessMap])
    sharpen(map, anisotropy);
  applyShading(material, source, baked, sky);
  return material;
}

function fitImage(map: THREE.Texture, limit: number): void {
  const image = map.image as { width: number; height: number };
  const scale = limit / Math.max(image.width, image.height);
  if (scale >= 1) return;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.floor(image.width * scale)),
    Math.max(1, Math.floor(image.height * scale)),
  );
  canvas
    .getContext("2d")
    ?.drawImage(
      map.image as CanvasImageSource,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  map.image = canvas;
}

async function loadBaked(
  anisotropy: number,
  limit: number,
): Promise<BakedGround> {
  const loader = new THREE.TextureLoader();
  const load = async (url: string, colorSpace: string) => {
    const map = releaseOnceUploaded(await loader.loadAsync(url));
    fitImage(map, limit);
    map.flipY = false;
    map.colorSpace = colorSpace;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = anisotropy;
    return map;
  };
  const [apronA, apronB, streaks, terrain, grain] = await Promise.all([
    load(apronAUrl, THREE.NoColorSpace),
    load(apronBUrl, THREE.NoColorSpace),
    load(streaksUrl, THREE.NoColorSpace),
    load(terrainUrl, THREE.SRGBColorSpace),
    load(grainUrl, THREE.SRGBColorSpace),
  ]);
  streaks.wrapS = THREE.RepeatWrapping;
  grain.wrapS = THREE.RepeatWrapping;
  return { apronA, apronB, streaks, terrain, grain };
}

export async function loadRoad(
  url: string,
  anisotropy: number,
  textureLimit: number,
  sky: SkyRadiance | null = null,
): Promise<THREE.Object3D> {
  const [gltf, baked] = await Promise.all([
    new GLTFLoader().loadAsync(url),
    loadBaked(anisotropy, textureLimit),
  ]);
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = surface(
      object.material as THREE.MeshStandardMaterial,
      anisotropy,
      baked,
      sky,
    );
    object.receiveShadow = true;
    object.castShadow = shadowCasters.test(object.name);
    if ((object.material as THREE.Material).alphaTest > 0)
      object.renderOrder = alphaTestedOrder;
  });
  return gltf.scene;
}

function releaseGeometry(mesh: THREE.Mesh, kept: Set<unknown>): void {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  if (mesh instanceof THREE.InstancedMesh) mesh.computeBoundingSphere();
  const attributes = [
    ...Object.values(mesh.geometry.attributes),
    mesh.geometry.index,
    mesh instanceof THREE.InstancedMesh ? mesh.instanceMatrix : null,
  ];
  for (const attribute of attributes)
    if (attribute instanceof THREE.BufferAttribute && !kept.has(attribute))
      attribute.array = attribute.array.slice(0, 0);
}

function releaseImage(map: THREE.Texture | null): void {
  const image: unknown = map?.source.data;
  if (!map || !(image instanceof ImageBitmap)) return;
  map.source.data = { width: image.width, height: image.height };
  image.close();
}

export function releaseCpuCopies(
  root: THREE.Object3D,
  kept: Set<unknown>,
): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    releaseGeometry(object as THREE.Mesh, kept);
    const material = object.material as THREE.MeshStandardMaterial;
    releaseImage(material.map);
    releaseImage(material.normalMap);
    releaseImage(material.roughnessMap);
    releaseImage(material.emissiveMap);
  });
}

const startLightsLit = uniform(0).setGroup(renderGroup);

export function setStartLights(lit: number): void {
  startLightsLit.value = lit;
}

function startLampMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.3,
    color: new THREE.Color(0.04, 0.01, 0.01),
    side: THREE.DoubleSide,
  });
  const lamp = uv();
  const on = step(lamp.x, startLightsLit).mul(step(startLampRows, lamp.y));
  material.emissiveNode = startLampRed.mul(on);
  return material;
}

export class Sunlight {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly direction = new THREE.Vector3();
  private readonly cascades: CSMShadowNode;
  private tick = 0;
  private scale = 1;
  private readonly reach = new THREE.Sphere();

  constructor(
    scene: THREE.Scene,
    private readonly intensity: number,
    colour: THREE.Color,
    private readonly elevation: number,
  ) {
    this.sun.color.copy(colour);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const camera = this.sun.shadow.camera;
    camera.near = 1;
    camera.far = shadowDistance;
    camera.layers.mask = shadowMask;
    this.sun.shadow.bias = -0.00004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = shadowSoftness;
    const cloneShadow = this.sun.shadow.clone.bind(this.sun.shadow);
    let cloned = 0;
    this.sun.shadow.clone = () => {
      const shadow = Object.assign(cloneShadow(), {
        discardColorBuffer: true,
      });
      const pixels = cascadePixels[cloned++] ?? shadowMapSize;
      shadow.mapSize.set(pixels, pixels);
      return shadow;
    };
    this.cascades = new CSMShadowNode(this.sun, {
      cascades: cascadeEnds.length,
      maxFar: cascadeEnds[cascadeEnds.length - 1],
      mode: "custom",
      lightMargin: shadowDistance / 2,
      customSplitsCallback: (_count, _near, far, target) => {
        target.length = 0;
        for (const end of cascadeEnds) target.push(end / far);
      },
    });
    this.cascades.fade = true;
    this.sun.shadow.shadowNode = this.cascades;
    scene.add(this.sun, this.sun.target);
  }

  dim(scale: number): void {
    this.scale = scale;
  }

  refit(): void {
    if (this.cascades.camera) this.cascades.updateFrustums();
  }

  intersectsSphere(sphere: THREE.Sphere): boolean {
    this.reach.copy(sphere);
    this.reach.radius += casterMargin;
    const lights = this.cascades.lights;
    return (
      lights.length === 0 ||
      lights.some(({ shadow }) =>
        shadow ? shadow.getFrustum().intersectsSphere(this.reach) : true,
      )
    );
  }

  containsSphere(sphere: THREE.Sphere): boolean {
    this.reach.copy(sphere);
    this.reach.radius += casterMargin;
    const lights = this.cascades.lights;
    return (
      lights.length === 0 ||
      lights.some(({ shadow }) =>
        shadow ? frustumContains(shadow.getFrustum(), this.reach) : true,
      )
    );
  }

  commit(): void {
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    for (const light of this.cascades.lights) {
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
    }
  }

  freeze(): void {
    for (const { shadow } of this.cascades.lights)
      if (shadow) shadow.autoUpdate = false;
  }

  private schedule(): void {
    this.tick++;
    this.cascades.lights.forEach(({ shadow }, index) => {
      if (!shadow) return;
      const period = cascadePeriods[index] ?? 1;
      shadow.autoUpdate = (this.tick + index) % period === 0;
    });
  }

  update(state: SkyState, eyeX: number, eyeY: number, eyeZ: number): void {
    const [sx, sy] = state.sunPosition;
    const azimuth = Math.atan2(sy - eyeY, sx - eyeX);
    const level = Math.cos(this.elevation);
    this.direction.set(
      level * Math.cos(azimuth),
      level * Math.sin(azimuth),
      Math.sin(this.elevation),
    );
    sunDirection.value.copy(this.direction);
    this.sun.target.position.set(eyeX, eyeY, eyeZ);
    this.sun.position
      .copy(this.direction)
      .multiplyScalar(shadowDistance)
      .add(this.sun.target.position);
    this.sun.intensity = this.intensity * this.scale;
    this.schedule();
  }
}
