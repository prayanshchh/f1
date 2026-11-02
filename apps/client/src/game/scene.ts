import * as THREE from "three/webgpu";
import crewUrl from "../../../../content/tracks/cota/crew.glb?url";
import frameUrl from "../../../../content/tracks/cota/sd-frame.json?url";
import racingLineUrl from "../../../../content/tracks/cota/racing-line.json?url";
import trackUrl from "../../../../content/tracks/cota/track.json?url";
import roadUrl from "../../../../content/tracks/cota/road.glb?url";
import { carEnvironment } from "./carpaint.ts";
import { frameIndex, type Engine, type HudInfo } from "./engine.ts";
import { GltfCar, placeOnTrack, type TrackFrame } from "./gltf.ts";
import { GridCars, type GridSlot } from "./grid.ts";
import { domeMaterial } from "./materials.ts";
import {
  castShadows,
  loadRoad,
  setCarContact,
  setStartLights,
  Sunlight,
} from "./road.ts";
import { Rumble, type RumbleWheel, type Shake } from "./rumble.ts";
import type { AtmosphereState } from "./atmosphere.ts";
import type { CameraPose } from "./buildup-shots.ts";
import type { RacingLineData, RacingLineMode } from "./racing-line.ts";
import { RacingLineView } from "./racing-line-view.ts";
import { PitCrew } from "./pit-crew.ts";
import { PitGate } from "./pit-gate.ts";
import type { PitControl, PitLayout } from "./pitstop.ts";
import { SkidMarks } from "./skidmarks.ts";
import type { StartLights } from "./start-lights.ts";
import { SdSky } from "./sky.ts";
import { TyreSmoke } from "./tyre-smoke.ts";
import type { TyreInfo } from "./tyres.ts";

const gateLead = 30;
const flipX = new THREE.Matrix4().makeScale(-1, 1, 1);
const kelvinOffset = 273.15;
const cinematicShadowRadius = 420;
const cinematicNear = 0.5;
const cinematicFar = 41000;
const upAxis = new THREE.Vector3(0, 0, 1);

export async function fetchJson<T>(url: string): Promise<T> {
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
  private readonly cinematicLook = new THREE.Matrix4();
  private shake: Shake | null = null;
  private lastFeel = 0;
  private viewMirrored = false;
  private cinematic: CameraPose | null = null;
  private readonly domeColors: THREE.BufferAttribute;
  private readonly dome: THREE.Mesh;
  private readonly sunlight: Sunlight;
  private readonly smoke = new TyreSmoke();
  readonly marks = new SkidMarks();
  readonly gate = new PitGate();
  readonly atmosphere: AtmosphereState = {
    sunDirection: new THREE.Vector3(),
    haze: new THREE.Color(),
    sun: new THREE.Color(),
  };

  private constructor(
    private readonly sky: SdSky,
    private readonly car: GltfCar,
    private readonly grid: GridCars,
    track: THREE.Object3D,
    private readonly racingLine: RacingLineView,
    readonly crew: PitCrew,
    private readonly lapScale: number,
    private readonly lights: StartLights,
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
    this.dome = new THREE.Mesh(geometry, domeMaterial());
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome, track, car.root, grid.root, this.smoke.root);
    this.sunlight = new Sunlight(this.scene);
    this.scene.add(this.marks.mesh, this.crew.root, this.gate.mesh);
    castShadows(car.root);
  }

  static async load(
    engine: Engine,
    team: string,
    renderer: THREE.WebGPURenderer,
    lineMode: RacingLineMode,
    lights: StartLights,
  ): Promise<Scene> {
    const anisotropy = renderer.getMaxAnisotropy();
    const local = engine.trackLocal();
    const env = carEnvironment(renderer);
    const point = engine.trackPoint.bind(engine);
    const [frame, road, data, crew, car, gridData] = await Promise.all([
      fetchJson<TrackFrame>(frameUrl),
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
    const track = new THREE.Group();
    track.add(
      placeOnTrack(road, frame, start),
      placeOnTrack(racingLine.root, frame, start),
    );
    return new Scene(
      new SdSky(local),
      car,
      grid,
      track,
      racingLine,
      crew,
      data.length / engine.trackLength(),
      lights,
    );
  }

  feel(wheels: RumbleWheel[], speed: number, now: number): number {
    this.shake = this.rumble.update(wheels, speed, now - this.lastFeel, now);
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
    const shadow = this.sunlight.sun.shadow;
    shadow.autoUpdate = false;
    this.car.renderAuxiliary(renderer, this.scene, (hidden) => {
      this.grid.hide(hidden);
    });
    shadow.autoUpdate = true;
  }

  setDash(info: HudInfo): void {
    this.car.setDash({
      fuel: info.tank > 0 ? info.fuel / info.tank : 0,
      tyres: info.tyreTemp.map((kelvin) => kelvin - kelvinOffset),
    });
  }

  get playerSlot(): number {
    return this.grid.playerSlot;
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

  setCinematic(pose: CameraPose | null): void {
    this.cinematic = pose;
    this.racingLine.root.visible = pose === null;
    if (pose) this.sunlight.setReach(cinematicShadowRadius);
    else this.sunlight.resetReach();
  }

  private applyCinematic(pose: CameraPose): void {
    const eye = new THREE.Vector3(...pose.eye);
    this.cinematicLook.lookAt(eye, new THREE.Vector3(...pose.target), upAxis);
    this.cinematicLook.setPosition(eye);
    this.camera.matrixWorld.copy(this.cinematicLook);
    this.camera.matrixWorldInverse.copy(this.cinematicLook).invert();
    this.viewMirrored = false;
    this.car.setDraw(true, true);
    this.setLens(pose.fov, cinematicNear, cinematicFar);
  }

  private setLens(fov: number, near: number, far: number): void {
    if (
      this.camera.fov === fov &&
      this.camera.near === near &&
      this.camera.far === far
    )
      return;
    this.camera.fov = fov;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  private applyDriverView(frame: Float64Array): void {
    const c = frameIndex.camera;
    const at = (k: number) => frame[c + k] ?? 0;
    this.car.setDraw(at(19) !== 0, at(20) !== 0);
    this.view.fromArray(frame, c);
    this.applyShake();
    const det = this.view.determinant();
    if (Math.abs(det) > 1e-6) {
      this.viewMirrored = det < 0;
      if (this.viewMirrored) this.view.premultiply(flipX);
      this.camera.matrixWorld.copy(this.view).invert();
      this.camera.matrixWorldInverse.copy(this.view);
    }
    this.setLens(at(16), at(17), at(18));
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

    if (this.cinematic) this.applyCinematic(this.cinematic);
    else this.applyDriverView(frame);

    const [, , , , , , , , , , , , eyeX, eyeY, eyeZ] =
      this.camera.matrixWorld.elements;
    this.grid.update(frame, new THREE.Vector3(eyeX, eyeY, eyeZ));
    const time = frame[frameIndex.time] ?? 0;
    setStartLights(this.cinematic ? 0 : this.lights.lit(time));
    const sky = this.sky.update(time, time, eyeX, eyeY);
    const [focusX, focusY, focusZ] = this.cinematic?.target ?? [
      eyeX,
      eyeY,
      eyeZ,
    ];
    this.sunlight.update(sky, focusX, focusY, focusZ);
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
  }

  updateTyres(frame: Float64Array, tyres: TyreInfo): void {
    this.smoke.update(frame, tyres, this.car.wheelRadii());
    this.car.setCompound(tyres.compound);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
