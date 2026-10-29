import * as THREE from "three/webgpu";
import {
  abs,
  exp,
  float,
  fract,
  mx_fractal_noise_float,
  output,
  positionWorld,
  renderOutput,
  smoothstep,
  texture,
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
const shadowCasters = /^(wall |fence steel)/;
const depthOffsets: Record<string, number> = {
  "cota road paint": -1,
  "cota road kerb": -1,
  "cota road runoff": -1,
  "cota painted ads": -2,
  "cota pit asphalt": 1,
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
  const macro = float(1).add(
    mx_fractal_noise_float(positionWorld.xy.mul(macroScale), 3).mul(grassMacro),
  );
  const stripe = source.name.endsWith("grass")
    ? float(1).add(
        smoothstep(0.2, 0.3, abs(fract(uv().x.mul(0.5)).sub(0.5)))
          .sub(0.5)
          .mul(mowStripe * 2),
      )
    : float(1);
  material.colorNode = texture(source.map, uv())
    .rgb.mul(grassTint)
    .mul(macro)
    .mul(stripe);
}

function surface(
  source: THREE.MeshStandardMaterial,
  anisotropy: number,
): THREE.MeshStandardNodeMaterial {
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

export class Sunlight {
  readonly sun = new THREE.DirectionalLight(0xffffff, sunIntensity);
  readonly sky = new THREE.HemisphereLight(0xffffff, groundColor, skyIntensity);
  private readonly direction = new THREE.Vector3();

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
