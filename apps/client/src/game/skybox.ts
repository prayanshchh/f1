import * as THREE from "three/webgpu";
import {
  fitSkyAmbient,
  setAmbientOvercast,
  useNightAmbient,
} from "./sky-ambient.ts";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import {
  asin,
  atan,
  exp,
  float,
  floor,
  Fn,
  fract,
  If,
  max,
  min,
  mix,
  modelViewProjection,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { releaseOnceUploaded } from "./preload.ts";
import { alphaTestedOrder } from "./road.ts";

const skyFiles = import.meta.glob<string>(
  "../../../../content/tracks/hill-country/sky/*",
  { query: "?url", import: "default", eager: true },
);

const domeRadius = 20000;
const sunPeak = 200;
const skySaturation = 0.78;
const skyGain = 1.25;
const sunShare = 3.5;
const lowSunSine = 0.49;
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
const skyGrades: Partial<Record<string, [number, number, number]>> = {
  dawn: [0.82, 0.95, 1.13],
  dusk: [0.72, 1, 1],
};
const nightElevation = (-8 * Math.PI) / 180;
const skyExposures: Partial<Record<string, number>> = { dawn: 0.7, night: 0.3 };
const overcastLevel = 1.2;
const overcastZenith = 0.68;
const overcastGround = 0.8;
const overcastTint = new THREE.Vector3(0.93, 0.96, 1.0);
const overcastEnvGround = 0.55;
const envStep = 0.04;
const cloudScale = 1.4;
const cloudContrast = 0.16;
const cloudMassScale = 0.35;
const cloudMassContrast = 0.42;
const cloudHorizon = 0.18;
const cloudDrift = 0.004;
const cumulusScale = 0.55;
const cumulusEdge = 0.2;
const cumulusBase = 0.5;
const cumulusTop = 1.15;
const cumulusSilver = 0.45;
const nightZenith = new THREE.Vector3(0.0012, 0.0036, 0.0115);
const nightHorizon = new THREE.Vector3(0.011, 0.017, 0.028);
const nightGlow = new THREE.Vector3(0.022, 0.024, 0.026);
const nightGlowHeight = 0.07;
const nightGround = new THREE.Vector3(0.05, 0.05, 0.047);
const nightCloudLevel = 0.03;
const nightExposure = 1;
const lampCells = 40;
const lampLow = 0.12;
const lampHigh = 0.7;
const lampSpread = 0.007;
const lampRadiance = 60;

export interface SkyMeta {
  elevation: number;
  azimuth: number;
  keepTop: number;
  skyRadiance: number[];
  horizon: number[];
  sunColor: number[];
}

function graded(meta: SkyMeta, grade: THREE.Vector3): SkyMeta {
  const scale = (v: number[]) => v.map((x, i) => x * grade.getComponent(i));
  const sun = scale(meta.sunColor);
  const brightest = Math.max(...sun);
  return {
    ...meta,
    skyRadiance: scale(meta.skyRadiance),
    horizon: scale(meta.horizon),
    sunColor: sun.map((x) => x / brightest),
  };
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
  readonly broken = uniform(0);
  private readonly sunAt = uniform(new THREE.Vector3(0, 0, 1));
  readonly night: THREE.UniformNode<"float", number>;
  private readonly kappa = uniform(0);
  private readonly rotation = new THREE.Matrix4();

  readonly environment: THREE.Texture;
  private readonly envOvercast = uniform(0);
  private readonly envBlend: THREE.QuadMesh;
  private readonly envTarget: THREE.RenderTarget;
  private envShown = -1;

  private constructor(
    private readonly sky: THREE.Texture,
    clearEnvironment: THREE.Texture,
    readonly meta: SkyMeta,
    private readonly exposureScale: number,
    private readonly nightShare: number,
    private readonly grade: THREE.Vector3,
  ) {
    this.night = uniform(nightShare);
    const { width, height } = clearEnvironment.image as {
      width: number;
      height: number;
    };
    this.envTarget = new THREE.RenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    this.environment = this.envTarget.texture;
    this.environment.mapping = THREE.EquirectangularReflectionMapping;
    this.environment.colorSpace = THREE.LinearSRGBColorSpace;
    const blend = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
    });
    const up = uv().y.sub(0.5).mul(Math.PI).sin();
    const tint = vec3(grade.x, grade.y, grade.z);
    const clearLight = texture(clearEnvironment, uv()).rgb.mul(tint);
    const overcastLight = mix(
      clearLight.mul(overcastEnvGround),
      vec3(overcastTint.x, overcastTint.y, overcastTint.z)
        .mul(this.overcastLevelAt(up))
        .mul(this.horizonLevel),
      smoothstep(-0.05, 0.02, up),
    );
    const dayLight = mix(clearLight, overcastLight, this.envOvercast);
    blend.colorNode =
      nightShare > 0
        ? mix(dayLight, this.nightEnvironment(up), this.night)
        : dayLight;
    this.envBlend = new THREE.QuadMesh(blend);
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthWrite: false,
    });
    const clip = modelViewProjection as unknown as THREE.Node<"vec4">;
    material.vertexNode = vec4(clip.xy, 0, clip.w);
    material.colorNode = this.radiance(normalize(positionLocal));
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(domeRadius, 64, 32),
      material,
    );
    this.mesh.renderOrder = alphaTestedOrder + 1;
    this.mesh.frustumCulled = false;
  }

  private get horizonLevel(): number {
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const day =
      (0.2126 * hr + 0.7152 * hg + 0.0722 * hb) * skyGain * overcastLevel;
    return day + (nightCloudLevel - day) * this.nightShare;
  }

  private nightSky(up: THREE.Node<"float">): THREE.Node<"vec3"> {
    const above = up.max(0);
    const gradient = mix(
      vec3(nightHorizon.x, nightHorizon.y, nightHorizon.z),
      vec3(nightZenith.x, nightZenith.y, nightZenith.z),
      smoothstep(0, 0.6, above),
    );
    const glow = vec3(nightGlow.x, nightGlow.y, nightGlow.z).mul(
      exp(above.div(nightGlowHeight).negate()),
    );
    return mix(
      vec3(nightGround.x, nightGround.y, nightGround.z).mul(0.2),
      gradient.add(glow),
      smoothstep(-0.03, 0.0, up),
    );
  }

  private nightEnvironment(up: THREE.Node<"float">): THREE.Node<"vec3"> {
    const cell = uv().x.mul(lampCells);
    const id = floor(cell);
    const seed = fract(sin(id.mul(12.9898)).mul(43758.5453));
    const height = mix(float(lampLow), float(lampHigh), seed);
    const across = fract(cell)
      .sub(0.5)
      .mul((2 * Math.PI) / lampCells)
      .mul(height.cos());
    const rise = uv().y.sub(0.5).mul(Math.PI).sub(height);
    const lamp = exp(
      across
        .mul(across)
        .add(rise.mul(rise))
        .div(-2 * lampSpread * lampSpread),
    ).mul(lampRadiance);
    const ground = vec3(nightGround.x, nightGround.y, nightGround.z);
    const sky = this.nightSky(up);
    return mix(ground, sky, smoothstep(-0.05, 0.02, up)).add(
      vec3(1, 0.96, 0.9).mul(lamp),
    );
  }

  private overcastLevelAt(up: THREE.Node<"float">): THREE.Node<"float"> {
    return mix(float(1), float(overcastZenith), smoothstep(0, 0.85, up)).mul(
      mix(float(overcastGround), float(1), smoothstep(-0.05, 0.02, up)),
    );
  }

  refreshEnvironment(renderer: THREE.WebGPURenderer, overcast: number): void {
    const level = Math.round(overcast / envStep) * envStep;
    if (level === this.envShown) return;
    this.envShown = level;
    this.envOvercast.value = level;
    if (this.nightShare > 0)
      useNightAmbient(this.nightAmbient(true), this.nightAmbient(false));
    setAmbientOvercast(level, this.horizonLevel);
    const previous = renderer.getRenderTarget();
    const { toneMapping, outputColorSpace } = renderer;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setRenderTarget(this.envTarget);
    this.envBlend.render(renderer);
    renderer.setRenderTarget(previous);
    renderer.toneMapping = toneMapping;
    renderer.outputColorSpace = outputColorSpace;
    this.environment.needsPMREMUpdate = true;
  }

  private nightAmbient(upward: boolean): THREE.Color {
    const sky = upward ? nightHorizon : nightGround;
    const share = this.nightShare * Math.PI * (upward ? 1 : 0.5);
    return new THREE.Color(sky.x * share, sky.y * share, sky.z * share);
  }

  radiance(direction: THREE.Node<"vec3">, detailed = true): THREE.Node<"vec3"> {
    const day = this.dayRadiance(direction, detailed);
    if (this.nightShare <= 0) return day;
    return mix(day, this.nightSky(direction.z), this.night);
  }

  private dayRadiance(
    direction: THREE.Node<"vec3">,
    detailed: boolean,
  ): THREE.Node<"vec3"> {
    const u = fract(
      this.kappa
        .sub(atan(direction.y, direction.x))
        .div(2 * Math.PI)
        .add(0.5),
    );
    const fromTop = float(0.5).sub(asin(direction.z).div(Math.PI));
    const v = float(1).sub(fromTop.div(this.meta.keepTop));
    const radiance = min(texture(this.sky, vec2(u, v)).rgb, vec3(sunPeak)).mul(
      vec3(this.grade.x, this.grade.y, this.grade.z),
    );
    const grey = radiance.dot(vec3(0.2126, 0.7152, 0.0722));
    const clear = mix(vec3(grey), radiance, skySaturation).mul(skyGain);
    const gradient = this.overcastLevelAt(direction.z);
    const plane = direction.xy
      .div(max(direction.z, 0.06))
      .mul(cloudScale)
      .add(vec2(this.cloudTime.mul(cloudDrift), 0))
      .toVar();
    const masses = mx_fractal_noise_float(
      vec3(plane.mul(cloudMassScale), this.cloudTime.mul(0.001)),
      2,
    );
    const clouds = detailed
      ? float(1).add(
          mx_fractal_noise_float(vec3(plane, this.cloudTime.mul(0.002)), 3)
            .mul(cloudContrast)
            .add(masses.mul(cloudMassContrast))
            .mul(smoothstep(-0.02, cloudHorizon, direction.z)),
        )
      : float(1);
    const cloudy = vec3(overcastTint.x, overcastTint.y, overcastTint.z).mul(
      gradient.mul(clouds).mul(this.horizonLevel).mul(this.overcastLight),
    );
    if (!detailed) return mix(clear, cloudy, this.overcast);
    const up = direction.z.toVar();
    const towardSun = direction.dot(this.sunAt).mul(0.5).add(0.5).toVar();
    return Fn(() => {
      const result = clear.toVar();
      If(this.broken.greaterThan(0), () => {
        result.assign(this.cumulus(result, plane, up, towardSun));
      });
      If(this.overcast.greaterThan(0), () => {
        result.assign(mix(result, cloudy, this.overcast));
      });
      return result;
    })();
  }

  private cumulus(
    clear: THREE.Node<"vec3">,
    plane: THREE.Node<"vec2">,
    up: THREE.Node<"float">,
    towardSun: THREE.Node<"float">,
  ): THREE.Node<"vec3"> {
    const shape = mx_fractal_noise_float(
      vec3(plane.mul(cumulusScale), this.cloudTime.mul(0.0015)),
      4,
    );
    const threshold = mix(float(0.32), float(-0.22), this.broken);
    const density = smoothstep(threshold, threshold.add(cumulusEdge), shape)
      .mul(smoothstep(0.0, 0.1, up))
      .mul(0.97);
    const core = smoothstep(threshold, threshold.add(0.55), shape);
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const horizon = vec3(hr, hg, hb).mul(skyGain);
    const [sr = 1, sg = 1, sb = 1] = this.meta.sunColor;
    const lit = horizon
      .mul(cumulusTop)
      .mul(mix(vec3(1), vec3(sr, sg, sb), 0.5));
    const shade = horizon.mul(cumulusBase).mul(vec3(0.92, 0.95, 1.0));
    const silver = towardSun.pow(6).mul(cumulusSilver).add(1);
    const cloud = mix(lit, shade, core).mul(silver);
    return mix(clear, cloud, density);
  }

  static async load(
    elevation: number,
    afternoon: boolean,
    night: number,
  ): Promise<SkyBox> {
    const { name, meta } = await chooseSky(elevation, afternoon);
    const loader = new HDRLoader();
    const dome = night >= 1 ? `${name}-env.hdr` : `${name}.hdr`;
    const [sky, environment] = await Promise.all([
      loader.loadAsync(fileUrl(dome)),
      loader.loadAsync(fileUrl(`${name}-env.hdr`)),
    ]);
    releaseOnceUploaded(sky);
    sky.wrapS = THREE.RepeatWrapping;
    sky.wrapT = THREE.ClampToEdgeWrapping;
    sky.minFilter = THREE.LinearFilter;
    sky.magFilter = THREE.LinearFilter;
    sky.generateMipmaps = false;
    environment.mapping = THREE.EquirectangularReflectionMapping;
    const grade = new THREE.Vector3(...(skyGrades[name] ?? [1, 1, 1]));
    fitSkyAmbient(environment, grade);
    return new SkyBox(
      sky,
      environment,
      graded(meta, grade),
      skyExposures[name] ?? 1,
      night,
      grade,
    );
  }

  get overcastHorizon(): THREE.Color {
    const level = this.horizonLevel;
    return new THREE.Color(
      overcastTint.x * level,
      overcastTint.y * level,
      overcastTint.z * level,
    );
  }

  get sunIntensity(): number {
    const radiance = this.meta.skyRadiance[1] ?? 0;
    const sine = Math.max(Math.sin(this.meta.elevation), 0);
    return (
      sunShare * Math.PI * radiance * Math.min(1 / sine, sine / lowSunSine ** 2)
    );
  }

  get sunStrength(): number {
    return Math.min(1, Math.max(Math.sin(this.meta.elevation), 0) / lowSunSine);
  }

  get exposure(): number {
    const radiance = this.meta.skyRadiance[1] ?? 1;
    const day =
      Math.min(maxExposure, targetMidtone / ((1 + sunShare) * radiance)) *
      this.exposureScale;
    return day + (nightExposure - day) * this.nightShare;
  }

  get nightHaze(): THREE.Color {
    return new THREE.Color(nightHorizon.x, nightHorizon.y, nightHorizon.z);
  }

  update(sun: THREE.Vector3, eyeX: number, eyeY: number, scene: THREE.Scene) {
    this.sunAt.value.copy(sun);
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
