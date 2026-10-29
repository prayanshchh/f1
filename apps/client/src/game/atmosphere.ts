import * as THREE from "three/webgpu";
import {
  dot,
  exp,
  float,
  getViewPosition,
  max,
  mix,
  normalize,
  pass,
  pow,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";

const hazeDistance = 1400;
const hazeMax = 0.82;
const hazeWarmth = 0.35;
const sunHalo = 0.3;
const sunHaloPower = 18;
const sunDisc = 2.5;
const sunDiscPower = 1400;
const veil = 0.09;
const veilPower = 3;
const skyHaze = 0.7;
const skyHazeHeight = 0.32;
const warmGrade = new THREE.Vector3(1.06, 1.0, 0.9);

export interface AtmosphereState {
  sunDirection: THREE.Vector3;
  haze: THREE.Color;
  sun: THREE.Color;
}

export class Atmosphere {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly sunView = uniform(new THREE.Vector3(0, 0, -1));
  private readonly hazeColor = uniform(new THREE.Color());
  private readonly sunColor = uniform(new THREE.Color());

  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode("output");
    const depth = scenePass.getTextureNode("depth").r;
    const view = getViewPosition(
      uv(),
      depth,
      uniform(camera.projectionMatrixInverse),
    );
    const direction = normalize(view);
    const toSun = max(dot(direction, this.sunView), 0);
    const ground = float(1).sub(step(0.999999, depth));
    const haze = float(1)
      .sub(exp(view.length().div(hazeDistance).negate()))
      .mul(hazeMax)
      .mul(ground);
    const tint = mix(
      mix(this.hazeColor, this.sunColor, hazeWarmth),
      this.sunColor,
      pow(toSun, 12),
    );
    const glare = this.sunColor
      .mul(
        pow(toSun, sunHaloPower)
          .mul(sunHalo)
          .add(pow(toSun, sunDiscPower).mul(sunDisc))
          .mul(float(1).sub(ground)),
      )
      .add(this.sunColor.mul(pow(toSun, veilPower).mul(veil)));
    const up = uniform(camera.matrixWorld)
      .mul(vec4(direction, 0))
      .xyz.normalize().z;
    const horizon = float(1)
      .sub(smoothstep(0, skyHazeHeight, up))
      .mul(skyHaze)
      .mul(float(1).sub(ground));
    const graded = mix(color.rgb, tint, max(haze, horizon))
      .add(glare)
      .mul(vec3(warmGrade.x, warmGrade.y, warmGrade.z));
    this.pipeline = new THREE.RenderPipeline(renderer, vec4(graded, 1));
    this.pipeline.outputColorTransform = false;
  }

  update(state: AtmosphereState): void {
    this.sunView.value
      .copy(state.sunDirection)
      .transformDirection(this.camera.matrixWorldInverse);
    this.hazeColor.value.copy(state.haze);
    this.sunColor.value.copy(state.sun);
  }

  render(): void {
    this.pipeline.render();
  }
}
