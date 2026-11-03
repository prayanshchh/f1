import * as THREE from "three/webgpu";
import { alphaTestedOrder } from "./road.ts";
import { SkyLitMaterial } from "./sky-ambient.ts";
import {
  float,
  floor,
  instancedBufferAttribute,
  mix,
  normalize,
  positionGeometry,
  sin,
  texture,
  time,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import albedoUrl from "../../../../content/tracks/hill-country/textures/baked/people_albedo.png?url";
import crowdUrl from "../../../../content/tracks/hill-country/crowd.bin?url";
import maskUrl from "../../../../content/tracks/hill-country/textures/baked/people_mask.png?url";

const stride = 8;
const tileSize = 600;
const personHeight = 2;
const personWidth = 1;
const atlasColumns = 8;
const atlasRows = 4;
const alphaCutoff = 0.5;
const bobHeight = 0.05;
const bobRate = 3.2;
const skinGain = 1.0;

const eyeModel = uniform(new THREE.Vector3());

function material(
  albedo: THREE.Texture,
  mask: THREE.Texture,
  origin: THREE.InstancedBufferAttribute,
  shirt: THREE.InstancedBufferAttribute,
) {
  const result = new SkyLitMaterial({
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
    alphaTest: alphaCutoff,
  });
  const place = vec4(
    instancedBufferAttribute(origin) as ReturnType<typeof vec4>,
  );
  const tint = vec4(instancedBufferAttribute(shirt) as ReturnType<typeof vec4>);
  const toEye = eyeModel.sub(place.xyz);
  const flat = normalize(vec2(toEye.x, toEye.z));
  const right = vec3(flat.y, 0, flat.x.negate());
  const bob = sin(time.mul(bobRate).add(place.w.mul(40)))
    .abs()
    .mul(bobHeight);
  result.positionNode = place.xyz
    .add(right.mul(positionGeometry.x.mul(personWidth)))
    .add(vec3(0, positionGeometry.y.mul(personHeight).add(bob), 0));
  const cell = varying(floor(tint.w));
  const sprite = vec2(
    cell.mod(atlasColumns).add(uv().x).div(atlasColumns),
    floor(cell.div(atlasColumns)).add(float(1).sub(uv().y)).div(atlasRows),
  );
  const colour = texture(albedo, sprite);
  const shirtMask = texture(mask, sprite).r;
  const painted = mix(
    colour.rgb.mul(skinGain),
    colour.rgb.mul(varying(tint.xyz)).mul(1.1),
    shirtMask,
  );
  result.colorNode = vec4(painted, colour.a);
  result.normalNode = vec3(0, 0.25, 0.97);
  return result;
}

export class Crowd {
  readonly root = new THREE.Group();
  private readonly inverse = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();

  private constructor() {}

  static async load(): Promise<Crowd> {
    const crowd = new Crowd();
    const loader = new THREE.TextureLoader();
    const atlas = async (url: string, colorSpace: string) => {
      const map = await loader.loadAsync(url);
      map.flipY = false;
      map.colorSpace = colorSpace;
      return map;
    };
    const [albedo, mask, response] = await Promise.all([
      atlas(albedoUrl, THREE.SRGBColorSpace),
      atlas(maskUrl, THREE.NoColorSpace),
      fetch(crowdUrl),
    ]);
    const values = new Float32Array(await response.arrayBuffer());
    const tiles = new Map<string, number[]>();
    for (let i = 0; i < values.length; i += stride) {
      const key = `${String(Math.floor((values[i] ?? 0) / tileSize))}|${String(Math.floor((values[i + 1] ?? 0) / tileSize))}`;
      const list = tiles.get(key) ?? [];
      list.push(i);
      tiles.set(key, list);
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const matrix = new THREE.Matrix4();
    for (const indices of tiles.values()) {
      const origin = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 4),
        4,
      );
      const shirt = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 4),
        4,
      );
      const mesh = new THREE.InstancedMesh(
        plane,
        material(albedo, mask, origin, shirt),
        indices.length,
      );
      indices.forEach((source, i) => {
        const x = values[source] ?? 0;
        const north = values[source + 1] ?? 0;
        const up = values[source + 2] ?? 0;
        origin.setXYZW(i, x, up, -north, values[source + 3] ?? 0);
        shirt.setXYZW(
          i,
          values[source + 5] ?? 1,
          values[source + 6] ?? 1,
          values[source + 7] ?? 1,
          values[source + 4] ?? 0,
        );
        matrix.makeScale(personHeight, personHeight, personHeight);
        matrix.setPosition(x, up, -north);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.computeBoundingSphere();
      mesh.renderOrder = alphaTestedOrder;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      crowd.root.add(mesh);
    }
    return crowd;
  }

  update(eye: THREE.Vector3): void {
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    eyeModel.value.copy(this.scratch.copy(eye).applyMatrix4(this.inverse));
  }
}
