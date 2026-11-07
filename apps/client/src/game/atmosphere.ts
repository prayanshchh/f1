import * as THREE from "three/webgpu";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import {
  atan,
  Break,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  getViewPosition,
  hash,
  If,
  length,
  Loop,
  max,
  min,
  mix,
  normalize,
  pass,
  pow,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const clearHaze = 16000;
const dropRows = [3, 6, 11];
const dropShare = 0.38;
const dropBlownOff = 0.45;
const dropRefraction = 0.06;
const dropBlur = 0.012;
const dropTaps = 8;
const dropFloor = 0.002;
const dropScatter = 0.08;
const dropRim = 0.18;
const dropGlint = 0.04;
const dropLifeSlow = 0.12;
const dropLifeFast = 1.1;
const dropRadiusSmall = 0.07;
const dropRadiusLarge = 0.28;
const dropRun = 0.22;
const dropSlide = 0.05;
const dropStretch = 0.9;
const dropWobble = 0.12;
const dropSoftness = 0.55;
const dropTrail = 3.2;
const dropTrailShare = 0.75;
const hazeMax = 0.92;
const mistFrom = 2;
const mistTo = 40;
const mirrorFloor = 0.004;
const mirrorStart = 0.6;
const mirrorSteps = 12;
const mirrorGrowth = 1.6;
const mirrorRefine = 4;
const mirrorThickness = 0.3;
const mirrorThicknessMin = 0.5;
const mirrorEdge = 0.06;
const mirrorBlur = 0.009;
const mirrorBlurGrowth = 0.05;
const mirrorAside = 0.6;
const mirrorTaps: [number, number][] = [
  [0, 0],
  [1, 1],
  [-1, -1],
  [-1, 2],
  [1, -2],
];
const mirrorReach = 220;
const mirrorSky = 1000;
const glowStreak = 0.025;
const glowTaps = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const hazeForward = 0.35;
const bloomStrength = 0.1;
const bloomRadius = 0.55;
const bloomThreshold = 1.6;
const bloomResolution = 0.25;
const renderScale = 1;
const multisamples = 4;
const detailScaleMax = 1.5;
const detailPixels = 3.6e6;
const detailSharpen = 0.7;
const grade = new THREE.Vector3(1.0, 1.0, 1.0);
const shockGrey = 0.68;
const shockBright = 1.25;

export interface AtmosphereState {
  sunDirection: THREE.Vector3;
  haze: THREE.Color;
  sun: THREE.Color;
  exposure: number;
  visibility: number;
  lensWater: number;
  reflections: number;
  mist: number;
  airflow: number;
  time: number;
  detail: boolean;
  glare: number;
  glowMirror: number;
  sheen: number;
  shock: number;
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
  return Fn(() => {
    const result = vec3(0).toVar();
    const scaled = at.mul(vec2(aspect.mul(rows), float(rows)));
    const cell = floor(scaled);
    const seed = cell.x
      .mul(37.13)
      .add(cell.y.mul(91.7))
      .add(rows * 3.1)
      .toVar();
    const present = step(
      hash(seed),
      amount.mul(dropShare).mul(float(1).sub(airflow.mul(dropBlownOff))),
    );
    If(present.greaterThan(0), () => {
      const rate = mix(float(dropLifeSlow), float(dropLifeFast), airflow);
      const phase = fract(time.mul(rate).add(hash(seed.add(4.2))));
      const away = normalize(at.sub(vec2(0.5, 0.55)));
      const flow = normalize(
        mix(vec2(0, -1), away.mul(vec2(1, 0.6)).add(vec2(0, 0.5)), airflow),
      );
      const across = vec2(flow.y.negate(), flow.x);
      const radius = mix(
        float(dropRadiusSmall),
        float(dropRadiusLarge),
        hash(seed.add(7.3)).pow(2.2),
      );
      const run = airflow.mul(phase).mul(dropRun).add(phase.mul(dropSlide));
      const start = vec2(hash(seed.add(1.7)), hash(seed.add(2.9)))
        .mul(0.36)
        .add(0.32);
      const offset = fract(scaled)
        .sub(start)
        .sub(flow.mul(run.sub(dropRun * 0.5)));
      const along = offset.dot(flow);
      const side = offset.dot(across);
      const stretch = float(1).add(airflow.mul(dropStretch));
      const angle = atan(side, along);
      const wobble = float(1).add(
        angle
          .mul(3)
          .add(hash(seed.add(5.1)).mul(6.3))
          .sin()
          .mul(dropWobble),
      );
      const reach = radius.mul(wobble);
      const shape = vec2(along.div(stretch), side);
      const distance = length(shape);
      const life = smoothstep(0, 0.05, phase).mul(smoothstep(1, 0.75, phase));
      const body = smoothstep(reach, reach.mul(dropSoftness), distance);
      const behind = along.negate().div(radius);
      const trail = smoothstep(radius.mul(0.32), float(0), side.abs())
        .mul(smoothstep(0, 0.4, behind))
        .mul(smoothstep(dropTrail, dropTrail * 0.3, behind))
        .mul(airflow)
        .mul(dropTrailShare);
      const inside = fract(scaled).sub(0.5).abs();
      const window = smoothstep(0.5, 0.36, inside.x).mul(
        smoothstep(0.5, 0.36, inside.y),
      );
      const mask = body.max(trail).mul(life).mul(window);
      const bend = shape
        .div(reach)
        .mul(body)
        .add(across.mul(side.div(radius.mul(0.32))).mul(trail));
      result.assign(vec3(bend.mul(mask), mask));
    });
    return result;
  })() as THREE.Node<"vec3">;
}

export class Atmosphere {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly sunView = uniform(new THREE.Vector3(0, 0, -1));
  private readonly hazeColor = uniform(new THREE.Color());
  private readonly sunColor = uniform(new THREE.Color());
  private readonly hazeDistance = uniform(clearHaze);
  private readonly lensWater = uniform(0);
  private readonly airflow = uniform(0);
  private readonly lensTime = uniform(0);
  private readonly aspect = uniform(16 / 9);
  private readonly sharpen = uniform(0);
  private readonly shock = uniform(0);
  private readonly texel = uniform(new THREE.Vector2());
  private readonly reflections = uniform(0);
  private readonly glowMirror = uniform(0);
  private readonly sheen = uniform(0);
  private readonly depthNear = uniform(0);
  private readonly depthFar = uniform(0);
  private glow: ReturnType<typeof bloom> | null = null;
  private readonly mist = uniform(0);
  private readonly upView = uniform(new THREE.Vector3(0, 1, 0));
  private readonly scenePass: ReturnType<typeof pass>;
  private detail = false;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scenePass = pass(scene, camera, {
      samples: multisamples,
      storeMultisampledColorBuffer: false,
    });
    this.scenePass = scenePass;
    const resolved = scenePass.getTextureNode("output");
    const depthTexture = scenePass.getTextureNode("depth");
    const depth = depthTexture.r;
    const view = getViewPosition(
      uv(),
      depth,
      uniform(camera.projectionMatrixInverse),
    );
    const toSun = max(dot(normalize(view), this.sunView), 0);
    const ground = step(1e-7, depth);
    const mist = smoothstep(mistFrom, mistTo, view.length()).mul(this.mist);
    const haze = float(1)
      .sub(exp(view.length().div(this.hazeDistance).negate()))
      .max(mist)
      .mul(hazeMax)
      .mul(ground);
    const tint = mix(
      this.hazeColor,
      this.sunColor,
      pow(toSun, 8).mul(hazeForward),
    );
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
    const projection = uniform(camera.projectionMatrix);
    const glow = bloom(resolved, bloomStrength, bloomRadius, bloomThreshold);
    glow.setResolutionScale(bloomResolution);
    this.glow = glow;
    const glowTexture = (
      glow as unknown as { getTextureNode(): THREE.TextureNode }
    ).getTextureNode();
    const sceneDepthAt = (at: THREE.Node<"vec2">) =>
      this.depthFar.negate().div(depthTexture.sample(at).r.add(this.depthNear));
    const wetRoad = Fn(() => {
      const colour = crisp.toVar();
      If(this.reflections.greaterThan(0), () => {
        const share = float(1).sub(resolved.a).clamp(0, 1).toVar();
        colour.assign(
          mix(
            colour,
            this.hazeColor,
            share.mul(this.sheen).mul(this.reflections).min(1),
          ),
        );
        If(share.greaterThan(mirrorFloor), () => {
          const ray = normalize(view).reflect(this.upView).toVar();
          const clipView = projection.mul(vec4(view, 1)).toVar();
          const clipRay = projection.mul(vec4(ray, 0)).toVar();
          const screenAt = (t: THREE.Node<"float"> | number) => {
            const clip = clipView.add(clipRay.mul(t));
            const at = clip.xy.div(clip.w).mul(0.5).add(0.5);
            return vec2(at.x, at.y.oneMinus());
          };
          const depthAt = (t: THREE.Node<"float">) => view.z.add(ray.z.mul(t));
          const hit = float(0).toVar();
          const near = float(0).toVar();
          const far = float(mirrorStart).toVar();
          const behind = (t: THREE.Node<"float">) =>
            sceneDepthAt(screenAt(t)).sub(depthAt(t));
          Loop(mirrorSteps, () => {
            const at = screenAt(far).toVar();
            const depth = depthAt(far);
            const outside = at.x
              .lessThan(0)
              .or(at.x.greaterThan(1))
              .or(at.y.lessThan(0))
              .or(at.y.greaterThan(1))
              .or(depth.greaterThan(-0.05));
            If(outside, () => {
              Break();
            });
            const gap = sceneDepthAt(at).sub(depth);
            const thickness = far.mul(mirrorThickness).add(mirrorThicknessMin);
            If(gap.greaterThan(0).and(gap.lessThan(thickness)), () => {
              hit.assign(1);
              Break();
            });
            near.assign(far);
            far.assign(far.mul(mirrorGrowth));
          });
          If(hit.greaterThan(0), () => {
            Loop(mirrorRefine, () => {
              const middle = near.add(far).mul(0.5);
              If(behind(middle).greaterThan(0), () => {
                far.assign(middle);
              }).Else(() => {
                near.assign(middle);
              });
            });
            const at = screenAt(far);
            const border = min(at, vec2(1).sub(at));
            const edge = smoothstep(0, mirrorEdge, border.x).mul(
              smoothstep(0, mirrorEdge, border.y),
            );
            const spread = vec2(float(mirrorAside).div(this.aspect), 1).mul(
              float(mirrorBlur).mul(float(1).add(far.mul(mirrorBlurGrowth))),
            );
            const seen = mirrorTaps
              .map(([x, y]) =>
                resolved
                  .sample(at.add(spread.mul(vec2(x, y))))
                  .rgb.min(vec3(bloomThreshold)),
              )
              .reduce((a, b) => a.add(b))
              .div(mirrorTaps.length);
            const fade = smoothstep(mirrorReach, mirrorReach * 0.6, far);
            colour.assign(
              mix(
                colour,
                seen,
                share.mul(edge).mul(fade).mul(this.reflections),
              ),
            );
          });
          If(this.glowMirror.greaterThan(0), () => {
            const at = screenAt(mirrorSky);
            const border = min(at, vec2(1).sub(at));
            const edge = smoothstep(0, mirrorEdge, border.x).mul(
              smoothstep(0, mirrorEdge, border.y),
            );
            const seen = glowTaps
              .map(
                (k) => glowTexture.sample(at.add(vec2(0, glowStreak * k))).rgb,
              )
              .reduce((a, b) => a.add(b))
              .div(glowTaps.length);
            colour.addAssign(
              seen
                .mul(share)
                .mul(edge)
                .mul(this.glowMirror)
                .mul(this.reflections),
            );
          });
        });
      });
      return colour;
    })();
    const graded = mix(wetRoad, tint, haze)
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
        const drop = layers.reduce((a, b) => a.add(b)).toVar();
        const mask = drop.z.min(1).toVar();
        If(mask.greaterThan(dropFloor), () => {
          const bend = drop.xy.div(drop.z.max(1e-3));
          const widen = vec2(float(1).div(this.aspect), 1);
          const at = uv().sub(bend.mul(widen).mul(dropRefraction));
          const blur = widen.mul(dropBlur);
          const ring = Array.from({ length: dropTaps }, (_, k) => {
            const turn = (k / dropTaps) * Math.PI * 2;
            const reach = k % 2 === 0 ? 1 : 0.5;
            return vec2(Math.cos(turn) * reach, Math.sin(turn) * reach);
          });
          const taps = ring
            .map((k): THREE.Node<"vec4"> =>
              resolved.sample(at.add(k.mul(blur))),
            )
            .reduce((a, b) => a.add(b))
            .div(dropTaps);
          const seen = mix(
            taps.rgb,
            this.hazeColor,
            float(1)
              .sub(taps.a)
              .clamp(0, 1)
              .mul(this.sheen)
              .mul(this.reflections)
              .min(1),
          );
          const seenDepth = depthTexture.sample(at).r;
          const seenView = getViewPosition(
            at,
            seenDepth,
            uniform(camera.projectionMatrixInverse),
          );
          const seenHaze = float(1)
            .sub(exp(seenView.length().div(this.hazeDistance).negate()))
            .mul(hazeMax)
            .mul(step(1e-7, seenDepth));
          const edge = bend.length().min(1);
          const rim = float(1).sub(smoothstep(0.55, 1, edge).mul(dropRim));
          const glint = smoothstep(0.25, 0, bend.sub(vec2(-0.35, 0.4)).length())
            .mul(dropGlint)
            .mul(mask);
          const lit = mix(mix(seen, tint, seenHaze), tint, dropScatter)
            .mul(rim)
            .add(tint.mul(glint))
            .add(glow.rgb);
          result.assign(mix(result, lit, mask));
        });
      });
      return result;
    })();
    const grey = vec3(dot(wetLens, vec3(0.2126, 0.7152, 0.0722)));
    const shaken = mix(
      wetLens,
      grey.mul(shockBright),
      this.shock.mul(shockGrey),
    );
    this.pipeline = new THREE.RenderPipeline(renderer, vec4(shaken, 1));
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
    if (this.glow) this.glow.strength.value = bloomStrength * state.glare;
    this.reflections.value = state.reflections;
    this.glowMirror.value = state.glowMirror;
    this.sheen.value = state.sheen;
    const lens = this.camera.projectionMatrix.elements;
    this.depthNear.value = lens[10];
    this.depthFar.value = lens[14];
    this.mist.value = state.mist;
    this.upView.value
      .set(0, 0, 1)
      .transformDirection(this.camera.matrixWorldInverse);
    this.airflow.value = state.airflow;
    this.lensTime.value = state.time;
    this.shock.value = state.shock;
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
  }
}
