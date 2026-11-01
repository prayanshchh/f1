import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  exp,
  float,
  floor,
  fract,
  mix,
  mx_cell_noise_float,
  mx_fractal_noise_float,
  output,
  positionWorld,
  renderOutput,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SkyState } from "./sky.ts";

const asphaltAlbedo = 5;
const asphaltMean = 0.0152;
const asphaltContrast = 1.8;
const asphaltTint = vec3(0.96, 0.98, 1.03);
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
const shadowDistance = 400;
const sunIntensity = 6;
const skyIntensity = 2;
const groundColor = new THREE.Color(0.22, 0.24, 0.16);
const alphaCutoffs: Record<string, number> = {
  "cota debris fence": 0.5,
  "cota painted ads": 0.35,
};
const shadowCasters =
  /^(wall|fence_steel|seats|stand_concrete|roofs|columns|facade|tower|veil|gantry|light_panel)/;
const depthOffsets: Record<string, number> = {
  "cota road paint": -1,
  "cota road kerb": -1,
  "cota road runoff": -1,
  "cota painted ads": -2,
  "cota road grass": 1,
  "cota pit asphalt": 0.5,
  "cota terrain": 2,
};

function finish(material: THREE.MeshStandardNodeMaterial): void {
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

function shadeAsphalt(
  material: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
): void {
  if (!source.map) return;
  const macro = float(1).add(
    mx_fractal_noise_float(positionWorld.xy.mul(macroScale), 3).mul(
      macroStrength,
    ),
  );
  const line = uv(1);
  const band = exp(line.x.div(rubberWidth).pow(2).negate()).mul(line.y);
  const grain = vec3(texture(source.map, uv()).rgb.dot(vec3(1 / 3)))
    .sub(asphaltMean)
    .mul(asphaltContrast)
    .add(asphaltMean)
    .max(0);
  material.colorNode = grain
    .mul(asphaltAlbedo)
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
    mx_fractal_noise_float(ground.mul(macroScale), 3).mul(grassMacro),
  );
  const clumps = float(1).add(
    mx_fractal_noise_float(ground.mul(clumpScale), 2).mul(clumpStrength),
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
    mx_fractal_noise_float(ground.mul(patchScale), 3),
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

function surface(
  source: THREE.MeshStandardMaterial,
  anisotropy: number,
): THREE.MeshStandardNodeMaterial {
  if (source.name === "cota crowd") return crowdMaterial();
  if (source.name === "cota start lamps") return startLampMaterial();
  const offset = depthOffsets[source.name] ?? 0;
  const material = new THREE.MeshStandardNodeMaterial({
    name: source.name,
    map: source.map,
    normalMap: source.normalMap,
    roughnessMap: source.roughnessMap,
    roughness: source.roughness,
    metalness: source.metalness,
    color: source.color,
    side: THREE.DoubleSide,
    alphaTest: alphaCutoffs[source.name] ?? 0,
    alphaToCoverage: source.name.endsWith("fence"),
    polygonOffset: offset !== 0,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset * 4,
  });
  for (const map of [source.map, source.normalMap, source.roughnessMap])
    sharpen(map, anisotropy);
  if (source.name.endsWith("asphalt")) shadeAsphalt(material, source);
  if (source.name.endsWith("canopy")) shadeCanopy(material, source);
  if (source.name.endsWith("grass") || source.name.endsWith("terrain"))
    shadeGrass(material, source);
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

const startLightsLit = uniform(0);

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
  const material = new THREE.MeshStandardNodeMaterial({
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
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
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

export class Sunlight {
  readonly sun = new THREE.DirectionalLight(0xffffff, sunIntensity);
  readonly sky = new THREE.HemisphereLight(0xffffff, groundColor, skyIntensity);
  readonly direction = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.sky.position.set(0, 0, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const camera = this.sun.shadow.camera;
    camera.left = -shadowRadius;
    camera.right = shadowRadius;
    camera.top = shadowRadius;
    camera.bottom = -shadowRadius;
    camera.near = 1;
    camera.far = shadowDistance * 2;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target, this.sky);
  }

  update(state: SkyState, eyeX: number, eyeY: number, eyeZ: number): void {
    const [sx, sy, sz] = state.sunPosition;
    this.direction.set(sx - eyeX, sy - eyeY, sz).normalize();
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
