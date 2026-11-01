import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  abs,
  cos,
  exp,
  float,
  floor,
  fract,
  interleavedGradientNoise,
  mix,
  mx_cell_noise_float,
  mx_fractal_noise_float,
  output,
  positionWorld,
  renderGroup,
  renderOutput,
  screenCoordinate,
  sin,
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
import { flatNoise } from "./flat-noise.ts";
import type { SkyState } from "./sky.ts";

const asphaltAlbedo = 5;
const asphaltMean = 0.0152;
const asphaltContrast = 1.8;
const asphaltTint = vec3(0.96, 0.98, 1.03);
const apronShade = 0.5;
const grassTint = 0.85;
const mowStripe = 0.08;
const grassMacro = 0.18;
const clumpScale = 0.35;
const clumpStrength = 0.16;
const patchScale = 1 / 45;
const vergeDryness = 0.35;
const hillDryness = 0.65;
const strawTint = vec3(1.25, 1.08, 0.62);
const leafScale = 0.9;
const crowdSpacing = 1 / 0.5;
const startLightCount = 5;
const startLightLead = 2;
const startLightInterval = 0.4;
const startLampRows = 2;
const startLampRed = vec3(6, 0.15, 0.05);
const crowdRow = 1 / 0.85;
const crowdEmpty = 0.12;
const crowdHead = 0.68;
const crowdSkin = vec3(0.32, 0.22, 0.16);
const crowdPalette: [number, THREE.Color][] = [
  [0, new THREE.Color(0.04, 0.04, 0.05)],
  [0.24, new THREE.Color(0.62, 0.62, 0.6)],
  [0.38, new THREE.Color(0.05, 0.07, 0.18)],
  [0.48, new THREE.Color(0.22, 0.22, 0.23)],
  [0.58, new THREE.Color(0.45, 0.05, 0.04)],
  [0.66, new THREE.Color(0.75, 0.32, 0.04)],
  [0.72, new THREE.Color(0.08, 0.17, 0.48)],
  [0.8, new THREE.Color(0.04, 0.26, 0.1)],
  [0.87, new THREE.Color(0.62, 0.52, 0.08)],
  [0.93, new THREE.Color(0.42, 0.36, 0.28)],
];
const crowdSeat = vec3(0.3, 0.04, 0.04);
const leafContrast = 0.6;
const macroScale = 0.045;
const macroStrength = 0.14;
const rubberWidth = 1.3;
const rubberDarkening = 0.42;
const rubberSmoothing = 0.3;
const shadowRadius = 70;
const shadowDistance = 200;
const shadowSoftness = 1.5;
const shadowPixels = 8192;
const sunIntensity = 6;
const skyIntensity = 2;
const groundColor = new THREE.Color(0.22, 0.24, 0.16);
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
const goldenAngle = 2.399963229728653;
const shadowTaps = [0, 1, 2, 3, 4].map((i) => {
  const reach = Math.sqrt((i + 0.5) / 5);
  const angle = i * goldenAngle;
  return [Math.cos(angle) * reach, Math.sin(angle) * reach] as const;
});
const tyreHubMargin = 0.5;
const groundMaterials =
  /(asphalt|road paint|road kerb|road runoff|road grass|pit strip|pit red|terrain)$/;
const blendedMaterials = new Set(["cota track marks"]);
const alphaCutoffs: Record<string, number> = {
  "cota debris fence": 0.5,
  "cota painted ads": 0.35,
  "cota pit decals": 0.35,
};
const shadowCasters =
  /^(wall|fence_steel|seats|stand_concrete|roofs|columns|facade|tower|veil|gantry|light_panel|paddock|billboard)/;
const depthOffsets: Record<string, number> = {
  "cota road paint": -1,
  "cota road kerb": -1,
  "cota road runoff": -1,
  "cota painted ads": -2,
  "cota pit decals": -2,
  "cota track marks": -1.5,
  "cota road grass": 1,
  "cota pit asphalt": 0.5,
  "cota apron asphalt": 0.25,
  "cota pit strip": -1,
  "cota pit red": -1,
  "cota terrain": 2,
};

export function finish(material: THREE.NodeMaterial): void {
  material.outputNode = renderOutput(
    output,
    THREE.ACESFilmicToneMapping,
    THREE.SRGBColorSpace,
  );
}

function sharpen(map: THREE.Texture | null, anisotropy: number): void {
  if (!map) return;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;
}

class DirectLighting extends THREE.PhysicalLightingModel {
  override indirectSpecular(): void {
    return;
  }

  override ambientOcclusion(): void {
    return;
  }
}

class RoadMaterial extends THREE.MeshStandardNodeMaterial {
  override setupLightingModel(): THREE.PhysicalLightingModel {
    return new DirectLighting();
  }
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

function shadeAsphalt(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
): void {
  if (!source.map) return;
  const macro = float(1).add(
    flatNoise(positionWorld.xy.mul(macroScale), 3).mul(macroStrength),
  );
  const line = uv(1);
  const band = exp(line.x.div(rubberWidth).pow(2).negate()).mul(line.y);
  const grain = vec3(texture(source.map, uv()).rgb.dot(vec3(1 / 3)))
    .sub(asphaltMean)
    .mul(asphaltContrast)
    .add(asphaltMean)
    .max(0);
  const apron = source.name.includes("apron") ? apronShade : 1;
  material.colorNode = grain
    .mul(asphaltAlbedo)
    .mul(apron)
    .mul(asphaltTint)
    .mul(macro)
    .mul(float(1).sub(band.mul(rubberDarkening)));
  if (source.roughnessMap)
    material.roughnessNode = texture(source.roughnessMap, uv()).g.mul(
      float(1).sub(band.mul(rubberSmoothing)),
    );
}

function shadeGrass(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
): void {
  if (!source.map) return;
  const verge = source.name.endsWith("grass");
  const ground = positionWorld.xy;
  const macro = float(1).add(
    flatNoise(ground.mul(macroScale), 3).mul(grassMacro),
  );
  const clumps = float(1).add(
    flatNoise(ground.mul(clumpScale), 2).mul(clumpStrength),
  );
  const stripe = verge
    ? float(1).add(
        smoothstep(0.2, 0.3, abs(fract(uv().x.mul(0.5)).sub(0.5)))
          .sub(0.5)
          .mul(mowStripe * 2),
      )
    : float(1);
  const patches = smoothstep(
    0.0,
    0.55,
    flatNoise(ground.mul(patchScale), 3),
  ).mul(verge ? vergeDryness : hillDryness);
  const green = texture(source.map, uv()).rgb.mul(grassTint);
  const straw = vec3(green.dot(vec3(0.3, 0.59, 0.11))).mul(strawTint);
  material.colorNode = mix(green, straw, patches)
    .mul(macro)
    .mul(clumps)
    .mul(stripe);
}

function shadeCanopy(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
): void {
  const clumps = mx_fractal_noise_float(positionWorld.mul(leafScale), 3);
  material.colorNode = vec3(source.color.r, source.color.g, source.color.b).mul(
    float(1).add(clumps.mul(leafContrast)),
  );
}

function applyShading(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
): void {
  if (source.name.endsWith("asphalt")) shadeAsphalt(material, source);
  if (source.name.endsWith("canopy")) shadeCanopy(material, source);
  if (source.name.endsWith("grass") || source.name.endsWith("terrain"))
    shadeGrass(material, source);
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
): THREE.MeshStandardNodeMaterial {
  if (source.name === "cota crowd") return crowdMaterial();
  if (source.name === "cota start lamps") return startLampMaterial();
  const offset = depthOffsets[source.name] ?? 0;
  const material = new RoadMaterial({
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
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset * 4,
  });
  for (const map of [source.map, source.normalMap, source.roughnessMap])
    sharpen(map, anisotropy);
  applyShading(material, source);
  finish(material);
  return material;
}

export async function loadRoad(
  url: string,
  anisotropy: number,
): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = surface(
      object.material as THREE.MeshStandardMaterial,
      anisotropy,
    );
    object.receiveShadow = true;
    object.castShadow = shadowCasters.test(object.name);
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

export function setStartLights(raceTime: number): void {
  startLightsLit.value =
    raceTime < 0
      ? Math.min(
          startLightCount,
          Math.floor((raceTime + startLightLead) / startLightInterval) + 1,
        )
      : 0;
}

function startLampMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new RoadMaterial({
    roughness: 0.3,
    color: new THREE.Color(0.04, 0.01, 0.01),
    side: THREE.DoubleSide,
  });
  const lamp = uv();
  const on = step(lamp.x, startLightsLit).mul(step(startLampRows, lamp.y));
  material.emissiveNode = startLampRed.mul(on);
  finish(material);
  return material;
}

function crowdMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new RoadMaterial({ roughness: 0.9 });
  material.colorNode = Fn(() => {
    const seat = positionWorld.mul(vec3(crowdSpacing, crowdSpacing, crowdRow));
    const cell = floor(seat);
    const pick = mx_cell_noise_float(cell);
    const shirt = vec3(0).toVar();
    for (const [threshold, colour] of crowdPalette)
      shirt.assign(
        mix(shirt, vec3(colour.r, colour.g, colour.b), step(threshold, pick)),
      );
    const shade = mx_cell_noise_float(cell.add(17.3)).mul(0.5).add(0.75);
    const occupied = step(crowdEmpty, mx_cell_noise_float(cell.add(91.1)));
    const head = step(crowdHead, fract(seat.z));
    const across = fract(seat.x).sub(0.5).abs();
    const outline = float(1).sub(smoothstep(0.3, 0.5, across).mul(0.55));
    const person = mix(shirt.mul(shade), crowdSkin, head).mul(outline);
    return mix(crowdSeat, person, occupied);
  })();
  finish(material);
  return material;
}

const rotatedShadowFilter = Fn(
  ({
    depthTexture,
    shadowCoord,
  }: {
    depthTexture: THREE.DepthTexture;
    shadowCoord: THREE.Node<"vec3">;
  }) => {
    const phi = interleavedGradientNoise(screenCoordinate.xy)
      .mul(6.28318530718)
      .toVar();
    const c = cos(phi).toVar();
    const s = sin(phi).toVar();
    const tap = ([x, y]: readonly [number, number]) =>
      texture(
        depthTexture,
        shadowCoord.xy.add(
          vec2(c.mul(x).sub(s.mul(y)), s.mul(x).add(c.mul(y))).mul(
            shadowSoftness / shadowPixels,
          ),
        ),
      ).compare(shadowCoord.z) as unknown as THREE.Node<"float">;
    return shadowTaps
      .map(tap)
      .reduce((sum, one) => sum.add(one))
      .mul(1 / 5);
  },
);

export class Sunlight {
  readonly sun = new THREE.DirectionalLight(0xffffff, sunIntensity);
  readonly sky = new THREE.HemisphereLight(0xffffff, groundColor, skyIntensity);
  readonly direction = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.sky.position.set(0, 0, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowPixels, shadowPixels);
    const camera = this.sun.shadow.camera;
    camera.left = -shadowRadius;
    camera.right = shadowRadius;
    camera.top = shadowRadius;
    camera.bottom = -shadowRadius;
    camera.near = 1;
    camera.far = shadowDistance * 2;
    this.sun.shadow.bias = -0.00006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = shadowSoftness;
    Object.assign(this.sun.shadow, {
      filterNode: rotatedShadowFilter,
      discardColorBuffer: true,
    });
    scene.add(this.sun, this.sun.target, this.sky);
  }

  update(state: SkyState, eyeX: number, eyeY: number, eyeZ: number): void {
    const [sx, sy, sz] = state.sunPosition;
    this.direction.set(sx - eyeX, sy - eyeY, sz).normalize();
    sunDirection.value.copy(this.direction);
    this.sun.target.position.set(eyeX, eyeY, eyeZ);
    this.sun.position
      .copy(this.direction)
      .multiplyScalar(shadowDistance)
      .add(this.sun.target.position);
    const [r, g, b] = state.sunColor;
    this.sun.color.setRGB(r, g, b);
    const [fr, fg, fb] = state.fogColor;
    this.sky.color.setRGB(fr, fg, fb);
    this.sun.intensity = this.direction.z > 0 ? sunIntensity : 0;
  }
}

export function castShadows(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
}
