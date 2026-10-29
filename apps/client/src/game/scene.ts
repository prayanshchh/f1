import * as THREE from "three/webgpu";
import vantaUrl from "../../../../content/cars/vanta-26/lod0.glb?url";
import roadUrl from "../../../../content/tracks/cota/road.glb?url";
import { SdCar } from "./car.ts";
import { frameIndex, type Engine } from "./engine.ts";
import { GltfCar, placeOnTrack, type TrackFrame } from "./gltf.ts";
import { SdLighting } from "./materials.ts";
import type { SdAssets } from "./models.ts";
import { castShadows, loadRoad, setStartLights, Sunlight } from "./road.ts";
import type { AtmosphereState } from "./atmosphere.ts";
import { SdSky, type TrackLocal } from "./sky.ts";

const flipX = new THREE.Matrix4().makeScale(-1, 1, 1);

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(67.5, 1, 1, 41000);
  private readonly view = new THREE.Matrix4();
  private viewMirrored = false;
  private readonly domeColors: THREE.BufferAttribute;
  private readonly dome: THREE.Mesh;
  private readonly background = new THREE.Group();
  private readonly sunlight: Sunlight;
  readonly atmosphere: AtmosphereState = {
    sunDirection: new THREE.Vector3(),
    haze: new THREE.Color(),
    sun: new THREE.Color(),
  };

  private constructor(
    private readonly lighting: SdLighting,
    private readonly sky: SdSky,
    private readonly local: TrackLocal,
    private readonly car: SdCar | GltfCar,
    track: THREE.Object3D,
    background: THREE.Object3D,
  ) {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(SdSky.domeVertices(), 3),
    );
    this.domeColors = new THREE.BufferAttribute(
      new Float32Array(sky.current.domeColors),
      3,
    );
    geometry.setAttribute("color", this.domeColors);
    geometry.setIndex(SdSky.domeIndices());
    this.dome = new THREE.Mesh(geometry, this.lighting.dome());
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.background.matrixAutoUpdate = false;
    this.background.renderOrder = -1;
    this.background.add(background);
    background.traverse((object) => {
      object.renderOrder = -1;
      object.frustumCulled = false;
    });
    this.scene.add(this.dome, this.background, track, car.root);
    this.sunlight = new Sunlight(this.scene);
    castShadows(car.root);
  }

  static async load(
    engine: Engine,
    assets: SdAssets,
    category: string,
    name: string,
    body: string,
    anisotropy: number,
  ): Promise<Scene> {
    const lighting = new SdLighting();
    const trackDir = `tracks/${category}/${name}/`;
    const local = engine.trackLocal();
    const [track, background, car] = await Promise.all([
      Scene.loadTrack(engine, assets, lighting, trackDir, name, anisotropy),
      name === "cota"
        ? Promise.resolve(new THREE.Group())
        : assets.model("data/objects/background-sky.ac", {
            car: false,
            searchPath: [trackDir, "data/textures/", "data/objects/"],
            material: (options) => lighting.fixedFunction(options),
          }),
      body === "vanta"
        ? GltfCar.load(vantaUrl, lighting, new THREE.Color("#d8471c"))
        : SdCar.load(assets, lighting, engine.carInfo()),
    ]);
    return new Scene(lighting, new SdSky(local), local, car, track, background);
  }

  private static async loadTrack(
    engine: Engine,
    assets: SdAssets,
    lighting: SdLighting,
    trackDir: string,
    name: string,
    anisotropy: number,
  ): Promise<THREE.Object3D> {
    if (assets.exists(`${trackDir}${name}.acc`)) {
      return assets.model(`${trackDir}${name}.acc`, {
        car: false,
        searchPath: [trackDir, "data/textures/"],
        material: (options) => lighting.shadowMapped(options),
      });
    }
    if (name !== "cota") throw new Error(`no 3D model for track ${name}`);
    const frame = (await (
      await fetch("/wasm/sd-frame.json")
    ).json()) as TrackFrame;
    const start = engine.trackPoint(0, 0);
    const road = await loadRoad(roadUrl, anisotropy);
    const group = new THREE.Group();
    group.add(placeOnTrack(road, frame, start));
    return group;
  }

  get mirrored(): boolean {
    return this.viewMirrored;
  }

  update(frame: Float64Array): void {
    this.car.update(frame);

    const c = frameIndex.camera;
    const at = (k: number) => frame[c + k] ?? 0;
    this.car.setDraw(at(19) !== 0, at(20) !== 0);
    this.view.fromArray(frame, c);
    const det = this.view.determinant();
    if (Math.abs(det) > 1e-6) {
      this.viewMirrored = det < 0;
      if (this.viewMirrored) this.view.premultiply(flipX);
      this.camera.matrixWorld.copy(this.view).invert();
      this.camera.matrixWorldInverse.copy(this.view);
    }
    if (
      this.camera.fov !== at(16) ||
      this.camera.near !== at(17) ||
      this.camera.far !== at(18)
    ) {
      this.camera.fov = at(16);
      this.camera.near = at(17);
      this.camera.far = at(18);
      this.camera.updateProjectionMatrix();
    }

    const [, , , , , , , , , , , , eyeX, eyeY, eyeZ] =
      this.camera.matrixWorld.elements;
    const time = frame[frameIndex.time] ?? 0;
    setStartLights(time);
    const sky = this.sky.update(time, time, eyeX, eyeY);
    this.lighting.update(sky, this.camera);
    this.sunlight.update(sky, eyeX, eyeY, eyeZ);
    this.atmosphere.sunDirection.copy(this.sunlight.direction);
    this.atmosphere.haze.setRGB(...sky.fogColor);
    this.atmosphere.sun.setRGB(
      sky.sunColor[0],
      sky.sunColor[1],
      sky.sunColor[2],
    );
    (this.domeColors.array as Float32Array).set(sky.domeColors);
    this.domeColors.needsUpdate = true;
    this.dome.position.set(eyeX, eyeY, 0);
    this.background.matrix.makeTranslation(
      eyeX,
      eyeY,
      Math.trunc(this.local.worldZ) / 2,
    );
    this.background.matrixWorldNeedsUpdate = true;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
