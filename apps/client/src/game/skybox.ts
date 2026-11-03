import * as THREE from "three/webgpu";
import { fitSkyAmbient } from "./sky-ambient.ts";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import {
  asin,
  atan,
  float,
  Fn,
  fract,
  If,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { releaseOnceUploaded } from "./preload.ts";

const skyFiles = import.meta.glob<string>(
  "../../../../content/tracks/cota/sky/*",
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
const overcastLevel = 0.9;
const overcastZenith = 0.68;
const overcastGround = 0.8;
const overcastTint = new THREE.Vector3(0.93, 0.96, 1.0);
const cloudScale = 1.4;
const cloudContrast = 0.22;
const cloudDrift = 0.004;

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
  readonly overcast = uniform(0);
  readonly overcastLight = uniform(1);
  readonly cloudTime = uniform(0);
  private readonly kappa = uniform(0);
  private readonly rotation = new THREE.Matrix4();

  private constructor(
    private readonly sky: THREE.Texture,
    readonly environment: THREE.Texture,
    readonly meta: SkyMeta,
    private readonly darkness: number,
  ) {
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    material.colorNode = this.radiance(normalize(positionLocal));
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(domeRadius, 64, 32),
      material,
    );
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  radiance(direction: THREE.Node<"vec3">, detailed = true): THREE.Node<"vec3"> {
    const u = fract(
      this.kappa
        .sub(atan(direction.y, direction.x))
        .div(2 * Math.PI)
        .add(0.5),
    );
    const fromTop = float(0.5).sub(asin(direction.z).div(Math.PI));
    const v = float(1).sub(fromTop.div(this.meta.keepTop));
    const radiance = min(texture(this.sky, vec2(u, v)).rgb, vec3(sunPeak));
    const grey = radiance.dot(vec3(0.2126, 0.7152, 0.0722));
    const clear = mix(vec3(grey), radiance, skySaturation).mul(skyGain);
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const horizon = (0.2126 * hr + 0.7152 * hg + 0.0722 * hb) * skyGain;
    const up = smoothstep(0, 0.85, direction.z);
    const gradient = mix(float(1), float(overcastZenith), up).mul(
      mix(
        float(overcastGround),
        float(1),
        smoothstep(-0.05, 0.02, direction.z),
      ),
    );
    const plane = direction.xy
      .div(max(direction.z, 0.06))
      .mul(cloudScale)
      .add(vec2(this.cloudTime.mul(cloudDrift), 0));
    const clouds = detailed
      ? float(1).add(
          mx_fractal_noise_float(vec3(plane, this.cloudTime.mul(0.002)), 3)
            .mul(cloudContrast)
            .mul(up.max(0.15)),
        )
      : float(1);
    const cloudy = vec3(overcastTint.x, overcastTint.y, overcastTint.z).mul(
      gradient
        .mul(clouds)
        .mul(horizon * overcastLevel)
        .mul(this.overcastLight),
    );
    if (!detailed) return mix(clear, cloudy, this.overcast);
    return Fn(() => {
      const result = clear.toVar();
      If(this.overcast.greaterThan(0), () => {
        result.assign(mix(clear, cloudy, this.overcast));
      });
      return result;
    })();
  }

  static async load(elevation: number, afternoon: boolean): Promise<SkyBox> {
    const { name, meta } = await chooseSky(elevation, afternoon);
    const loader = new HDRLoader();
    const [sky, environment] = await Promise.all([
      loader.loadAsync(fileUrl(`${name}.hdr`)),
      loader.loadAsync(fileUrl(`${name}-env.hdr`)),
    ]);
    releaseOnceUploaded(sky);
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
