import * as THREE from "three/webgpu";
import {
  Discard,
  Fn,
  If,
  attribute,
  clamp,
  dot,
  exp,
  float,
  max,
  mix,
  normalViewGeometry,
  normalize,
  positionView,
  pow,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import type { SkyState } from "./sky.ts";

const globalAmbient = 0.1;
const light0Diffuse = 0.2;
const materialDiffuse = 0.8;
const carSpecular = 0.8;
const carSmoothness = 300.0;
const alphaClamp = 0.65;

export class SdLighting {
  readonly sunView = uniform(new THREE.Vector3());
  readonly sunDirectionView = uniform(new THREE.Vector3());
  readonly upView = uniform(new THREE.Vector3());
  readonly sceneAmbient = uniform(new THREE.Vector3());
  readonly sceneDiffuse = uniform(new THREE.Vector3());
  readonly materialAmbient = uniform(0);
  readonly materialEmission = uniform(0);
  readonly sunColor = uniform(new THREE.Vector4());
  readonly fogColor = uniform(new THREE.Vector3());
  readonly fogDensity = uniform(0);
  private readonly scratch = new THREE.Vector4();

  update(sky: SkyState, camera: THREE.Camera): void {
    const view = camera.matrixWorldInverse;
    const [sx, sy, sz] = sky.sunPosition;
    this.scratch.set(sx, sy, sz, 1).applyMatrix4(view);
    this.sunView.value.set(this.scratch.x, this.scratch.y, this.scratch.z);
    this.scratch.set(sx, sy, sz, 0).applyMatrix4(view);
    this.sunDirectionView.value.set(
      this.scratch.x,
      this.scratch.y,
      this.scratch.z,
    );
    this.scratch.set(0, 0, 1, 0).applyMatrix4(view);
    this.upView.value.set(this.scratch.x, this.scratch.y, this.scratch.z);
    this.sceneAmbient.value.fromArray(sky.sceneAmbient);
    this.sceneDiffuse.value.fromArray(sky.sceneDiffuse);
    this.materialAmbient.value = sky.materialAmbient;
    this.materialEmission.value = sky.materialEmission;
    this.sunColor.value.fromArray(sky.sunColor);
    this.fogColor.value.fromArray(sky.fogColor);
    this.fogDensity.value = sky.fogDensity;
  }

  private litColor() {
    const n = normalViewGeometry;
    const toSun = normalize(this.sunView.sub(positionView));
    const c = vec3(this.materialEmission)
      .add(vec3(globalAmbient * 1).mul(this.materialAmbient))
      .add(this.sceneAmbient.mul(this.materialAmbient))
      .add(
        vec3(
          max(dot(n, normalize(this.upView)), 0).mul(
            light0Diffuse * materialDiffuse,
          ),
        ),
      )
      .add(this.sceneDiffuse.mul(max(dot(n, toSun), 0)).mul(materialDiffuse));
    return clamp(c, 0, 1);
  }

  private fog(color: Parameters<typeof mix>[1]) {
    const z = positionView.z;
    const factor = clamp(
      exp(this.fogDensity.mul(this.fogDensity).mul(z).mul(z).negate()),
      0,
      1,
    );
    return mix(this.fogColor, color, factor);
  }

  shadowMapped(options: SurfaceOptions): THREE.MeshBasicNodeMaterial {
    const material = baseMaterial(options);
    const { map } = options;
    material.fragmentNode = Fn(() => {
      const tint = vec4(uniform(options.color ?? new THREE.Color(1, 1, 1)), 1);
      const base = map ? texture(map, uv()).mul(tint) : tint;
      const color = vec4(this.litColor(), 1).mul(base).toVar();
      if (options.alphaClamp)
        If(color.a.lessThanEqual(alphaClamp), () => Discard());
      return color;
    })();
    return material;
  }

  fixedFunction(options: SurfaceOptions): THREE.MeshBasicNodeMaterial {
    const material = baseMaterial(options);
    const { map } = options;
    material.fragmentNode = Fn(() => {
      const tint = vec4(uniform(options.color ?? new THREE.Color(1, 1, 1)), 1);
      const base = map ? texture(map, uv()).mul(tint) : tint;
      const color = vec4(this.litColor(), 1).mul(base).toVar();
      if (options.alphaClamp)
        If(color.a.lessThanEqual(alphaClamp), () => Discard());
      return vec4(this.fog(color.rgb), color.a);
    })();
    return material;
  }

  carShader(options: SurfaceOptions): THREE.MeshBasicNodeMaterial {
    const material = baseMaterial(options);
    const { map } = options;
    material.fragmentNode = Fn(() => {
      const n = normalViewGeometry;
      const v = normalize(positionView.negate());
      const l = normalize(this.sunDirectionView);
      const h = normalize(l.add(v));
      const cosTh = max(0.0, dot(n, h));
      const cosTi = max(0.0, dot(n, l));
      const diffuse = map ? texture(map, uv()) : vec4(0, 0, 0, 1);
      const ambient = vec4(
        this.materialAmbient,
        this.materialAmbient,
        this.materialAmbient,
        1,
      );
      const specular = vec4(carSpecular, carSpecular, carSpecular, 1)
        .mul(pow(cosTh, carSmoothness))
        .mul(carSmoothness);
      const fcolor = ambient
        .mul(diffuse)
        .add(diffuse.add(specular).mul(this.sunColor).mul(cosTi))
        .toVar();
      return clamp(vec4(this.fog(fcolor.rgb), fcolor.a), 0, 1);
    })();
    return material;
  }

  unlit(color: THREE.Color): THREE.MeshBasicNodeMaterial {
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
    });
    const value = uniform(color);
    material.fragmentNode = vec4(value, float(1));
    return material;
  }

  dome(): THREE.MeshBasicNodeMaterial {
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    material.fragmentNode = vec4(attribute("color", "vec3"), 1);
    return material;
  }
}

export interface SurfaceOptions {
  map: THREE.Texture | null;
  color?: THREE.Color;
  translucent: boolean;
  alphaClamp: boolean;
  twoSided: boolean;
}

function baseMaterial(options: SurfaceOptions): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({
    side: options.twoSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: options.translucent,
    depthWrite: true,
  });
}
