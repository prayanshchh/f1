import * as THREE from "three/webgpu";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { taau } from "three/examples/jsm/tsl/display/TAAUNode.js";
import {
  dot,
  exp,
  float,
  Fn,
  getViewPosition,
  If,
  int,
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

const hazeDistance = 16000;
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
const grade = new THREE.Vector3(1.0, 1.0, 1.0);

export interface AtmosphereState {
  sunDirection: THREE.Vector3;
  haze: THREE.Color;
  sun: THREE.Color;
  exposure: number;
}

export class Atmosphere {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly sunView = uniform(new THREE.Vector3(0, 0, -1));
  private readonly hazeColor = uniform(new THREE.Color());
  private readonly sunColor = uniform(new THREE.Color());
  private readonly previousView = uniform(new THREE.Matrix4());

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
      .sub(exp(view.length().div(hazeDistance).negate()))
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
    const blurred = Fn(() => {
      const sum = resolved.rgb.toVar();
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
    this.pipeline = new THREE.RenderPipeline(renderer, vec4(graded, 1));
  }

  update(state: AtmosphereState): void {
    this.sunView.value
      .copy(state.sunDirection)
      .transformDirection(this.camera.matrixWorldInverse);
    this.hazeColor.value.copy(state.haze);
    this.sunColor.value.copy(state.sun);
    this.renderer.toneMappingExposure = state.exposure;
  }

  render(): void {
    this.pipeline.render();
    this.previousView.value
      .copy(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
  }
}
