import * as THREE from "three/webgpu";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
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
  pass,
  pow,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const hazeDistance = 1400;
const hazeMax = 0.82;
const hazeWarmth = 0.35;
const sunHalo = 0.3;
const sunDisc = 2.5;
const sunDiscPower = 1400;
const veil = 0.09;
const skyHaze = 0.7;
const skyHazeHeight = 0.32;
const warmGrade = new THREE.Vector3(1.03, 1.0, 0.95);
const antialiasSamples = 4;
const blurSamples = 8;
const blurShutter = 0.55;
const blurLimit = 0.045;
const blurNear = 5;
const blurFar = 14;
const bloomStrength = 0.14;
const bloomRadius = 0.5;
const bloomThreshold = 0.92;
const skyDepth = 0.999999;

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
  private readonly previousView = uniform(new THREE.Matrix4());

  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const scenePass = pass(scene, camera, { samples: antialiasSamples });
    scenePass.renderTarget.storeMultisampledColorBuffer = false;
    const sharp = scenePass.getTextureNode("output");
    const depth = scenePass.getTextureNode("depth").r;
    const viewToClip = uniform(camera.projectionMatrixInverse);
    const viewToWorld = uniform(camera.matrixWorld);
    const graded = Fn(() => {
      const view = getViewPosition(uv(), depth, viewToClip).toVar();
      const distance = view.length().toVar();
      const before = this.previousView.mul(viewToWorld.mul(vec4(view, 1)));
      const beforeUv = before.xy.div(before.w).mul(vec2(0.5, -0.5)).add(0.5);
      const rawVelocity = uv().sub(beforeUv).mul(blurShutter).toVar();
      const speed = rawVelocity.length();
      const velocity = rawVelocity
        .div(max(speed, 1e-5))
        .mul(min(speed, blurLimit))
        .mul(smoothstep(blurNear, blurFar, distance))
        .toVar();
      const color = sharp.rgb.toVar();
      If(velocity.dot(velocity).greaterThan(0), () => {
        Loop(
          { start: int(1), end: int(blurSamples), type: "int", condition: "<" },
          ({ i }) => {
            const along = float(i)
              .div(blurSamples - 1)
              .sub(0.5);
            color.addAssign(sharp.sample(uv().add(velocity.mul(along))).rgb);
          },
        );
        color.divAssign(blurSamples);
      });
      const direction = view.div(distance).toVar();
      const toSun = max(dot(direction, this.sunView), 0).toVar();
      const sun3 = toSun.mul(toSun).mul(toSun).toVar();
      const sun6 = sun3.mul(sun3).toVar();
      const sun12 = sun6.mul(sun6).toVar();
      const tint = mix(
        mix(this.hazeColor, this.sunColor, hazeWarmth),
        this.sunColor,
        sun12,
      );
      const light = this.sunColor.mul(sun3.mul(veil)).toVar();
      const blend = float(0).toVar();
      If(depth.lessThan(skyDepth), () => {
        blend.assign(
          float(1)
            .sub(exp(distance.div(hazeDistance).negate()))
            .mul(hazeMax),
        );
      }).Else(() => {
        light.assign(
          this.sunColor
            .mul(
              sun12
                .mul(sun6)
                .mul(sunHalo)
                .add(pow(toSun, sunDiscPower).mul(sunDisc)),
            )
            .add(light),
        );
        const up = viewToWorld.mul(vec4(direction, 0)).xyz.normalize().z;
        blend.assign(
          float(1)
            .sub(smoothstep(0, skyHazeHeight, up))
            .mul(skyHaze),
        );
      });
      return mix(color, tint, blend)
        .add(light)
        .mul(vec3(warmGrade.x, warmGrade.y, warmGrade.z));
    })();
    const glow = bloom(
      vec4(graded, 1),
      bloomStrength,
      bloomRadius,
      bloomThreshold,
    );
    this.pipeline = new THREE.RenderPipeline(
      renderer,
      vec4(graded, 1).add(glow),
    );
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
    this.previousView.value
      .copy(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
  }
}
