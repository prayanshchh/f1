import * as THREE from "three/webgpu";
import { fitSkyAmbient } from "./sky-ambient.ts";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import {
  asin,
  atan,
  float,
  fract,
  min,
  mix,
  normalize,
  positionLocal,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";

const skyFiles = import.meta.glob<string>(
  "../../../../content/tracks/hill-country/sky/*",
  { query: "?url", import: "default", eager: true },
);

const domeRadius = 20000;
const sunPeak = 200;
const skySaturation = 0.78;
const skyGain = 1.25;
const sunShare = 3.5;
const minSunSine = 0.2;
const targetMidtone = 1.4;
const maxExposure = 6;
const skyNames = [
  "circuit",
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "dusk",
  "night",
] as const;
const nightElevation = (-8 * Math.PI) / 180;
const nightDim = 0.3;

export interface SkyMeta {
  elevation: number;
  azimuth: number;
  keepTop: number;
  skyRadiance: number[];
  horizon: number[];
  sunColor: number[];
}

function fileUrl(name: string): string {
  const entry = Object.entries(skyFiles).find(([key]) =>
    key.endsWith(`/${name}`),
  );
  if (!entry) throw new Error(`missing sky asset ${name}`);
  return entry[1];
}

async function chooseSky(
  elevation: number,
  afternoon: boolean,
): Promise<{ name: string; meta: SkyMeta }> {
  const metas = await Promise.all(
    skyNames.map(async (name) => ({
      name,
      meta: (await (await fetch(fileUrl(`${name}.json`))).json()) as SkyMeta,
    })),
  );
  const fits = (name: string) => {
    if (elevation < nightElevation) return name === "night";
    if (name === "night") return false;
    if (name === "dawn" || name === "morning") return !afternoon;
    if (name === "afternoon" || name === "dusk") return afternoon;
    return true;
  };
  const usable = metas.filter((sky) => fits(sky.name));
  return usable.reduce((best, sky) =>
    Math.abs(sky.meta.elevation - elevation) <
    Math.abs(best.meta.elevation - elevation)
      ? sky
      : best,
  );
}

export class SkyBox {
  readonly mesh: THREE.Mesh;
  readonly environmentRotation = new THREE.Euler();
  private readonly kappa = uniform(0);
  private readonly rotation = new THREE.Matrix4();

  private constructor(
    sky: THREE.Texture,
    readonly environment: THREE.Texture,
    readonly meta: SkyMeta,
    private readonly darkness: number,
  ) {
    const direction = normalize(positionLocal);
    const u = fract(
      this.kappa
        .sub(atan(direction.y, direction.x))
        .div(2 * Math.PI)
        .add(0.5),
    );
    const fromTop = float(0.5).sub(asin(direction.z).div(Math.PI));
    const v = float(1).sub(fromTop.div(meta.keepTop));
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    const radiance = min(texture(sky, vec2(u, v)).rgb, vec3(sunPeak));
    const grey = radiance.dot(vec3(0.2126, 0.7152, 0.0722));
    material.colorNode = mix(vec3(grey), radiance, skySaturation).mul(skyGain);
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(domeRadius, 64, 32),
      material,
    );
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  static async load(elevation: number, afternoon: boolean): Promise<SkyBox> {
    const { name, meta } = await chooseSky(elevation, afternoon);
    const loader = new HDRLoader();
    const [sky, environment] = await Promise.all([
      loader.loadAsync(fileUrl(`${name}.hdr`)),
      loader.loadAsync(fileUrl(`${name}-env.hdr`)),
    ]);
    sky.wrapS = THREE.RepeatWrapping;
    sky.wrapT = THREE.ClampToEdgeWrapping;
    sky.minFilter = THREE.LinearFilter;
    sky.magFilter = THREE.LinearFilter;
    sky.generateMipmaps = false;
    environment.mapping = THREE.EquirectangularReflectionMapping;
    fitSkyAmbient(environment);
    return new SkyBox(sky, environment, meta, name === "night" ? nightDim : 1);
  }

  get sunIntensity(): number {
    const radiance = this.meta.skyRadiance[1] ?? 0;
    return (
      (sunShare * Math.PI * radiance) /
      Math.max(Math.sin(this.meta.elevation), minSunSine)
    );
  }

  get exposure(): number {
    const radiance = this.meta.skyRadiance[1] ?? 1;
    return (
      Math.min(maxExposure, targetMidtone / ((1 + sunShare) * radiance)) *
      this.darkness
    );
  }

  update(sun: THREE.Vector3, eyeX: number, eyeY: number, scene: THREE.Scene) {
    const kappa = this.meta.azimuth + Math.atan2(sun.y, sun.x);
    this.kappa.value = kappa;
    this.mesh.position.set(eyeX, eyeY, 0);
    const c = Math.cos(kappa);
    const s = Math.sin(kappa);
    this.rotation.set(c, 0, s, 0, -s, 0, c, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    this.environmentRotation.setFromRotationMatrix(this.rotation);
    scene.environmentRotation.copy(this.environmentRotation);
  }
}
