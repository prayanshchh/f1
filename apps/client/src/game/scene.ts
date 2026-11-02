import * as THREE from "three/webgpu";
import crewUrl from "../../../../content/tracks/cota/crew.glb?url";
import racingLineUrl from "../../../../content/tracks/cota/racing-line.json?url";
import trackUrl from "../../../../content/tracks/cota/track.json?url";
import roadUrl from "../../../../content/tracks/cota/road.glb?url";
import { frameIndex, type Engine, type HudInfo } from "./engine.ts";
import { GltfCar, placeOnTrack, type TrackFrame } from "./gltf.ts";
import { GridCars, type GridSlot } from "./grid.ts";
import {
  loadRoad,
  releaseCpuCopies,
  setCarContact,
  setStartLights,
  Sunlight,
} from "./road.ts";
import { Rumble, type RumbleWheel, type Shake } from "./rumble.ts";
import type { AtmosphereState } from "./atmosphere.ts";
import type { RacingLineData, RacingLineMode } from "./racing-line.ts";
import { RacingLineView } from "./racing-line-view.ts";
import { PitCrew } from "./pit-crew.ts";
import { uploadEverything } from "./preload.ts";
import { PitGate } from "./pit-gate.ts";
import type { PitControl, PitLayout } from "./pitstop.ts";
import { SkidMarks } from "./skidmarks.ts";
import { SdSky } from "./sky.ts";
import { SkyBox } from "./skybox.ts";
import { Crowd } from "./crowd.ts";
import { TyreSmoke } from "./tyre-smoke.ts";
import { WorldCuller } from "./world-culler.ts";
import type { TyreInfo } from "./tyres.ts";

const gateLead = 30;
const onboardReach = 3;
const crewReach = 12;
const flipX = new THREE.Matrix4().makeScale(-1, 1, 1);
const sunGlow = 2.4;
const kelvinOffset = 273.15;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to load ${url}`);
  return (await response.json()) as T;
}

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(67.5, 1, 1, 41000);
  private readonly view = new THREE.Matrix4();
  private readonly rumble = new Rumble();
  private readonly shakeMatrix = new THREE.Matrix4();
  private shake: Shake | null = null;
  private lastFeel = 0;
  private readonly eye = new THREE.Vector3();
  private readonly carPosition = new THREE.Vector3();
  private viewMirrored = false;
  private readonly sunlight: Sunlight;
  private readonly smoke = new TyreSmoke();
  private readonly moving: THREE.Object3D[];
  private readonly viewFrustum = new THREE.Frustum();
  private mirrorViews: THREE.Frustum[] = [];
  private readonly seen = {
    intersectsSphere: (sphere: THREE.Sphere): boolean =>
      this.viewFrustum.intersectsSphere(sphere) ||
      this.mirrorViews.some((view) => view.intersectsSphere(sphere)),
  };
  private readonly viewMatrix = new THREE.Matrix4();
  private warming = false;
  private readonly crewBounds = new THREE.Sphere(
    new THREE.Vector3(),
    crewReach,
  );
  readonly marks = new SkidMarks();
  readonly gate = new PitGate();
  readonly atmosphere: AtmosphereState = {
    sunDirection: new THREE.Vector3(),
    haze: new THREE.Color(),
    sun: new THREE.Color(),
    exposure: 1,
  };

  private constructor(
    private readonly sky: SdSky,
    private readonly skyBox: SkyBox,
    private readonly people: Crowd,
    private readonly car: GltfCar,
    private readonly grid: GridCars,
    track: THREE.Object3D,
    private readonly road: THREE.Object3D,
    private readonly culler: WorldCuller,
    private readonly racingLine: RacingLineView,
    readonly crew: PitCrew,
    private readonly lapScale: number,
  ) {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.scene.environment = skyBox.environment;
    this.scene.add(skyBox.mesh, track, car.root, grid.root, this.smoke.root);
    const { sunColor, horizon } = skyBox.meta;
    const colour = new THREE.Color(
      sunColor[0] ?? 1,
      sunColor[1] ?? 1,
      sunColor[2] ?? 1,
    );
    this.sunlight = new Sunlight(
      this.scene,
      skyBox.sunIntensity,
      colour,
      skyBox.meta.elevation,
    );
    this.atmosphere.sun.copy(colour).multiplyScalar(sunGlow);
    this.atmosphere.haze.setRGB(
      horizon[0] ?? 1,
      horizon[1] ?? 1,
      horizon[2] ?? 1,
    );
    this.atmosphere.exposure = skyBox.exposure;
    this.scene.add(this.marks.mesh, this.crew.root, this.gate.mesh);
    this.moving = [
      skyBox.mesh,
      car.root,
      grid.root,
      this.crew.root,
      this.gate.mesh,
    ];
    this.scene.updateMatrixWorld(true);
    this.scene.matrixWorldAutoUpdate = false;
    culler.bake();
  }

  static async load(
    engine: Engine,
    team: string,
    renderer: THREE.WebGPURenderer,
    lineMode: RacingLineMode,
  ): Promise<Scene> {
    const anisotropy = renderer.getMaxAnisotropy();
    const local = engine.trackLocal();
    const hours = local.timeOfDay / 3600;
    const elevation = ((90 - 15 * Math.abs(hours - 12)) * Math.PI) / 180;
    const skyBox = await SkyBox.load(elevation, hours > 12);
    const env = {
      texture: skyBox.environment,
      rotation: skyBox.environmentRotation,
    };
    const point = engine.trackPoint.bind(engine);
    const [frame, people, road, data, crew, car, gridData] = await Promise.all([
      fetchJson<TrackFrame>("/wasm/sd-frame.json"),
      Crowd.load(),
      loadRoad(roadUrl, anisotropy),
      fetchJson<RacingLineData>(racingLineUrl),
      PitCrew.load(crewUrl, anisotropy),
      GltfCar.load(team, renderer, env),
      fetchJson<{ length: number; grid: GridSlot[] }>(trackUrl),
    ]);
    const lengthScale = engine.trackLength() / gridData.length;
    const grid = await GridCars.load(
      team,
      gridData.grid.map((slot) => ({
        distance: slot.distance * lengthScale,
        offset: slot.offset,
      })),
      point,
      env,
    );
    const racingLine = new RacingLineView(data, data.profile, lineMode);
    const start = engine.trackPoint(0, 0);
    const placed = placeOnTrack(road, frame, start);
    placed.updateMatrixWorld(true);
    const culler = new WorldCuller(road);
    const track = new THREE.Group();
    track.add(
      placed,
      placeOnTrack(people.root, frame, start),
      placeOnTrack(racingLine.root, frame, start),
    );
    return new Scene(
      new SdSky(local),
      skyBox,
      people,
      car,
      grid,
      track,
      road,
      culler,
      racingLine,
      crew,
      data.length / engine.trackLength(),
    );
  }

  feel(
    wheels: RumbleWheel[],
    speed: number,
    now: number,
    tyreRough: number,
  ): number {
    this.shake = this.rumble.update(
      wheels,
      speed,
      now - this.lastFeel,
      now,
      tyreRough,
    );
    this.lastFeel = now;
    this.car.setRumble(this.shake.heave, this.shake.roll);
    return this.shake.amount;
  }

  updatePit(control: PitControl, frame: Float64Array): void {
    const active = control.phase === "service";
    const eye = new THREE.Vector3().setFromMatrixPosition(
      this.camera.matrixWorld,
    );
    const carMatrix = new THREE.Matrix4().fromArray(frame, frameIndex.posMat);
    const { lift, wheelsOff } = this.crew.update(
      control.serviceProgress,
      active,
      active ? carMatrix : null,
      eye,
      performance.now() / 1000,
    );
    this.car.setPitService(lift, wheelsOff);
    this.gate.update(control.countdown);
  }

  placePit(
    layout: PitLayout,
    point: (distance: number, lateral: number) => [number, number, number],
  ): void {
    const lateral = layout.boxLateral - layout.shift;
    const [x, y, z] = point(layout.boxDistance, lateral);
    const [x2, y2] = point(layout.boxDistance + 2, lateral);
    this.crew.setAnchor(x, y, z, Math.atan2(y2 - y, x2 - x));
    const turn = layout.boxDistance - gateLead;
    const gateLateral = layout.fastLane - layout.shift;
    const [gx, gy, gz] = point(turn, gateLateral);
    const [hx, hy] = point(turn + 2, gateLateral);
    this.gate.place(gx, gy, gz, Math.atan2(hy - gy, hx - gx));
  }

  renderAuxiliary(renderer: THREE.WebGPURenderer): void {
    this.sunlight.freeze();
    this.crew.root.visible = true;
    this.car.renderAuxiliary(renderer, this.scene);
  }

  setDash(info: HudInfo): void {
    this.car.setDash({
      fuel: info.tank > 0 ? info.fuel / info.tank : 0,
      tyres: info.tyreTemp.map((kelvin) => kelvin - kelvinOffset),
    });
  }

  get mirrored(): boolean {
    return this.viewMirrored;
  }

  private updateContact(frame: Float64Array): void {
    const pose = frameIndex.posMat;
    setCarContact(
      frame[pose + 12] ?? 0,
      frame[pose + 13] ?? 0,
      frame[pose] ?? 1,
      frame[pose + 1] ?? 0,
    );
  }

  private applyShake(): void {
    if (!this.shake) return;
    this.view.premultiply(
      this.shakeMatrix
        .makeRotationZ(this.shake.cameraRoll)
        .setPosition(this.shake.cameraX, this.shake.cameraY, 0),
    );
  }

  update(frame: Float64Array): void {
    this.car.update(frame);
    this.updateContact(frame);
    this.racingLine.update(
      (frame[frameIndex.distFromStart] ?? 0) * this.lapScale,
      Math.abs(frame[frameIndex.speed] ?? 0),
    );

    const c = frameIndex.camera;
    const at = (k: number) => frame[c + k] ?? 0;
    this.view.fromArray(frame, c);
    this.applyShake();
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
      this.sunlight.refit();
    }

    const [, , , , , , , , , , , , eyeX, eyeY, eyeZ] =
      this.camera.matrixWorld.elements;
    this.grid.update(frame);
    this.car.setDraw(
      at(19) !== 0,
      at(20) !== 0,
      this.eye
        .set(eyeX, eyeY, eyeZ)
        .distanceToSquared(
          this.carPosition.setFromMatrixPosition(this.car.root.matrix),
        ) <
        onboardReach * onboardReach,
    );
    const time = frame[frameIndex.time] ?? 0;
    setStartLights(time);
    const sky = this.sky.update(time, time, eyeX, eyeY);
    this.sunlight.update(sky, eyeX, eyeY, eyeZ);
    this.atmosphere.sunDirection.copy(this.sunlight.direction);
    this.skyBox.update(this.sunlight.direction, eyeX, eyeY, this.scene);
    this.people.update(this.eye.set(eyeX, eyeY, eyeZ));
  }

  commitMoves(): void {
    for (const object of this.moving)
      if (object.visible) object.updateMatrixWorld();
    this.sunlight.commit();
    if (this.warming) return;
    this.viewMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.viewFrustum.setFromProjectionMatrix(
      this.viewMatrix,
      this.camera.coordinateSystem,
      this.camera.reversedDepth,
    );
    this.mirrorViews = this.car.mirrorViews();
    this.culler.update(this.seen, this.sunlight);
  }

  hideUnseenCrew(): void {
    if (this.warming) return;
    this.crewBounds.center.setFromMatrixPosition(this.crew.root.matrixWorld);
    this.crew.root.visible =
      this.seen.intersectsSphere(this.crewBounds) ||
      this.sunlight.intersectsSphere(this.crewBounds);
  }

  async warmUp(
    renderer: THREE.WebGPURenderer,
    draw: () => void,
  ): Promise<void> {
    this.warming = true;
    this.crew.bake();
    await uploadEverything(renderer, this.scene, () => {
      draw();
      this.sunlight.freeze();
      this.car.warmMirrors(renderer, this.scene);
    });
    this.warming = false;
    releaseCpuCopies(this.road, this.culler.retained());
  }

  updateTyres(frame: Float64Array, tyres: TyreInfo): void {
    this.smoke.update(frame, tyres, this.car.wheelRadii());
    this.car.setCompound(tyres.compound);
    this.car.setDeflation(tyres.wheels.map((wheel) => wheel.leak));
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sunlight.refit();
  }
}
