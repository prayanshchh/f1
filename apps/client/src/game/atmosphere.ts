import * as THREE from "three/webgpu";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { taau } from "three/examples/jsm/tsl/display/TAAUNode.js";
import {
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  getViewPosition,
  hash,
  If,
  int,
  length,
  Loop,
  max,
  min,
  mix,
  mrt,
  normalize,
  output,
  pass,
  pow,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  velocity,
  vec3,
  vec4,
} from "three/tsl";

const clearHaze = 16000;
const dropRows = [11, 19];
const dropShare = 0.55;
const dropRefraction = 0.035;
const dropShade = 0.12;
const dropLifeSlow = 0.22;
const dropLifeFast = 1.6;
const dropStreak = 0.9;
const hazeMax = 0.92;
const hazeForward = 0.35;
const blurSamples = 8;
const blurShutter = 0.55;
const blurLimit = 0.045;
const blurNear = 5;
const blurFar = 14;
const bloomStrength = 0.1;
const bloomRadius = 0.55;
const bloomThreshold = 1.6;
const bloomResolution = 0.25;
const renderScale = 0.72;
const detailScaleMax = 1.5;
const detailPixels = 3.6e6;
const detailSharpen = 0.7;
const grade = new THREE.Vector3(1.0, 1.0, 1.0);

export interface AtmosphereState {
  sunDirection: THREE.Vector3;
  haze: THREE.Color;
  sun: THREE.Color;
  exposure: number;
  visibility: number;
  lensWater: number;
  airflow: number;
  time: number;
  detail: boolean;
}

type FloatNode = THREE.Node<"float">;

function dropLayer(
  at: THREE.Node<"vec2">,
  rows: number,
  amount: FloatNode,
  airflow: FloatNode,
  time: FloatNode,
  aspect: FloatNode,
) {
  const scaled = at.mul(vec2(aspect.mul(rows), float(rows)));
  const cell = floor(scaled);
  const seed = cell.x
    .mul(37.13)
    .add(cell.y.mul(91.7))
    .add(rows * 3.1);
  const present = step(hash(seed), amount.mul(dropShare));
  const rate = mix(float(dropLifeSlow), float(dropLifeFast), airflow);
  const phase = fract(time.mul(rate).add(hash(seed.add(4.2))));
  const away = normalize(at.sub(0.5).add(vec2(0, -0.08)));
  const centre = vec2(hash(seed.add(1.7)), hash(seed.add(2.9)))
    .mul(0.5)
    .add(0.25)
    .add(away.mul(airflow.mul(phase).mul(dropStreak * 0.3)));
  const offset = fract(scaled).sub(centre);
  const radius = mix(float(0.1), float(0.28), hash(seed.add(7.3))).mul(
    float(1).sub(airflow.mul(0.4)),
  );
  const life = smoothstep(0, 0.08, phase).mul(smoothstep(1, 0.7, phase));
  const mask = smoothstep(radius, radius.mul(0.7), length(offset))
    .mul(present)
    .mul(life);
  return vec3(offset.div(radius).mul(mask), mask) as THREE.Node<"vec3">;
}

export class Atmosphere {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly sunView = uniform(new THREE.Vector3(0, 0, -1));
  private readonly hazeColor = uniform(new THREE.Color());
  private readonly sunColor = uniform(new THREE.Color());
  private readonly previousView = uniform(new THREE.Matrix4());
  private readonly hazeDistance = uniform(clearHaze);
  private readonly lensWater = uniform(0);
  private readonly airflow = uniform(0);
  private readonly lensTime = uniform(0);
  private readonly aspect = uniform(16 / 9);
  private readonly sharpen = uniform(0);
  private readonly texel = uniform(new THREE.Vector2());
  private readonly scenePass: ReturnType<typeof pass>;
  private detail = false;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scenePass = pass(scene, camera, { samples: 0 });
    scenePass.setMRT(mrt({ output, velocity }));
    scenePass.setResolutionScale(renderScale);
    this.scenePass = scenePass;
    scenePass.getTexture("velocity").format = THREE.RGFormat;
    const color = scenePass.getTextureNode("output");
    const motion = scenePass.getTextureNode("velocity");
    const depthTexture = scenePass.getTextureNode("depth");
    const depth = depthTexture.r;
    const view = getViewPosition(
      uv(),
      depth,
      uniform(camera.projectionMatrixInverse),
    );
    const toSun = max(dot(normalize(view), this.sunView), 0);
    const ground = step(1e-7, depth);
    const haze = float(1)
      .sub(exp(view.length().div(this.hazeDistance).negate()))
      .mul(hazeMax)
      .mul(ground);
    const tint = mix(
      this.hazeColor,
      this.sunColor,
      pow(toSun, 8).mul(hazeForward),
    );
    const stable = taau(color, depthTexture, motion, camera);
    const resolved = stable.getTextureNode();
    const world = uniform(camera.matrixWorld).mul(vec4(view, 1));
    const before = this.previousView.mul(world);
    const beforeUv = before.xy.div(before.w).mul(vec2(0.5, -0.5)).add(0.5);
    const rawSmear = uv().sub(beforeUv).mul(blurShutter);
    const speed = rawSmear.length();
    const smear = rawSmear
      .div(max(speed, 1e-5))
      .mul(min(speed, blurLimit))
      .mul(smoothstep(blurNear, blurFar, view.length()));
    const crisp = Fn(() => {
      const centre = resolved.rgb.toVar();
      If(this.sharpen.greaterThan(0), () => {
        const tap = (x: number, y: number) =>
          resolved.sample(uv().add(this.texel.mul(vec2(x, y)))).rgb;
        const north = tap(0, -1);
        const south = tap(0, 1);
        const east = tap(1, 0);
        const west = tap(-1, 0);
        const low = min(min(min(north, south), min(east, west)), centre);
        const high = max(max(max(north, south), max(east, west)), centre);
        const edge = centre.mul(4).sub(north).sub(south).sub(east).sub(west);
        centre.assign(
          centre.add(edge.mul(this.sharpen.mul(0.25))).clamp(low, high),
        );
      });
      return centre;
    })();
    const blurred = Fn(() => {
      const sum = crisp.toVar();
      If(smear.dot(smear).greaterThan(0), () => {
        Loop(
          { start: int(1), end: int(blurSamples), type: "int", condition: "<" },
          ({ i }) => {
            const along = float(i)
              .div(blurSamples - 1)
              .sub(0.5);
            sum.addAssign(resolved.sample(uv().add(smear.mul(along))).rgb);
          },
        );
        sum.divAssign(blurSamples);
      });
      return sum;
    })();
    const glow = bloom(stable, bloomStrength, bloomRadius, bloomThreshold);
    glow.setResolutionScale(bloomResolution);
    const graded = mix(blurred, tint, haze)
      .add(glow.rgb)
      .mul(vec3(grade.x, grade.y, grade.z));
    const wetLens = Fn(() => {
      const result = graded.toVar();
      If(this.lensWater.greaterThan(0.001), () => {
        const layers = dropRows.map((rows) =>
          dropLayer(
            uv(),
            rows,
            this.lensWater,
            this.airflow,
            this.lensTime,
            this.aspect,
          ),
        );
        const drop = layers.reduce((a, b) => a.add(b));
        const mask = drop.z.min(1);
        const bent = uv().sub(drop.xy.mul(dropRefraction));
        const seen = resolved.sample(bent).rgb;
        const lit = mix(seen, seen.mul(1 - dropShade), drop.xy.length().min(1));
        result.assign(mix(result, mix(lit, tint, haze), mask));
      });
      return result;
    })();
    this.pipeline = new THREE.RenderPipeline(renderer, vec4(wetLens, 1));
  }

  update(state: AtmosphereState): void {
    this.sunView.value
      .copy(state.sunDirection)
      .transformDirection(this.camera.matrixWorldInverse);
    this.hazeColor.value.copy(state.haze);
    this.sunColor.value.copy(state.sun);
    this.renderer.toneMappingExposure = state.exposure;
    this.hazeDistance.value = state.visibility;
    this.lensWater.value = state.lensWater;
    this.airflow.value = state.airflow;
    this.lensTime.value = state.time;
    this.aspect.value = this.camera.aspect;
    const size = this.renderer.getDrawingBufferSize(this.texel.value);
    const pixels = Math.max(1, size.x * size.y);
    size.set(1 / Math.max(1, size.x), 1 / Math.max(1, size.y));
    if (state.detail !== this.detail) {
      this.detail = state.detail;
      const fit = Math.sqrt(detailPixels / pixels);
      this.scenePass.setResolutionScale(
        state.detail
          ? Math.min(detailScaleMax, Math.max(renderScale, fit))
          : renderScale,
      );
      this.sharpen.value = state.detail ? detailSharpen : 0;
    }
  }

  render(): void {
    this.pipeline.render();
    this.previousView.value
      .copy(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
  }
}
